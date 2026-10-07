// LLM 호출 계층 테스트: 실제 API 대신 가짜 fetch로 응답·오류를 흉내 낸다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { makeLlm, check } from '../src/llm/client.js';
import { rankFlashModels } from '../src/llm/gemini.js';

const ok = (text) => ({ ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text }] } }], usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 } }) });
const fail = (status) => ({ ok: false, status, text: async () => `error ${status}` });

function fakeFetch(responses) {
  const calls = [];
  const fn = async (url, init) => { calls.push({ url, body: init?.body ? JSON.parse(init.body) : null, headers: init?.headers }); return responses.shift(); };
  return { fn, calls };
}
const noSleep = async () => {};
const Schema = z.object({ category: z.enum(['상의', '하의']), heightCm: z.number().nullable() });

test('L1 모델 자동 선택: flash 계열 최신 버전, lite·preview 제외', () => {
  assert.deepEqual(rankFlashModels(['gemini-2.5-flash', 'gemini-3.8-flash-lite', 'gemini-3.8-flash', 'gemini-4.0-flash-preview', 'gemini-2.5-pro']).slice(0, 2), ['gemini-3.8-flash', 'gemini-2.5-flash']);
});

test('L2 JSON 응답을 스키마로 검사해 돌려줌, 키는 헤더로만 보냄', async () => {
  const f = fakeFetch([ok('{"category":"상의","heightCm":150}')]);
  const llm = makeLlm({ apiKey: 'KEY', model: 'gemini-x', fetchFn: f.fn, sleep: noSleep });
  assert.deepEqual(await llm.json({ prompt: 'p', schema: Schema }), { category: '상의', heightCm: 150 });
  assert.equal(f.calls[0].headers['x-goog-api-key'], 'KEY');
  assert.ok(!f.calls[0].url.includes('KEY'));                       // 주소에 키가 들어가지 않음 (오류 메시지 노출 방지)
  assert.equal(f.calls[0].body.generationConfig.responseMimeType, 'application/json');
  assert.equal(llm.usage.inputTokens, 10);
});

test('L3 429·503은 짧게 기다렸다 재시도, 400은 바로 실패', async () => {
  const f = fakeFetch([fail(429), fail(503), ok('{"category":"하의","heightCm":null}')]);
  const waited = [];
  const llm = makeLlm({ apiKey: 'K', model: 'm', fetchFn: f.fn, sleep: async (ms) => waited.push(ms) });
  assert.equal((await llm.json({ prompt: 'p', schema: Schema })).category, '하의');
  assert.deepEqual(waited, [2000, 5000]);

  const g = fakeFetch([fail(400)]);
  const llm2 = makeLlm({ apiKey: 'K', model: 'm', fetchFn: g.fn, sleep: noSleep });
  await assert.rejects(llm2.json({ prompt: 'p', schema: Schema }), /400.*API 키/);
  assert.equal(g.calls.length, 1);
});

test('L4 재시도 상한을 넘으면 실패 (에이전트 시간 상한 보호)', async () => {
  const f = fakeFetch([fail(503), fail(503), fail(503), ok('{}')]);
  const llm = makeLlm({ apiKey: 'K', model: 'm', fetchFn: f.fn, sleep: noSleep });
  await assert.rejects(llm.json({ prompt: 'p' }), /503/);
  assert.equal(f.calls.length, 3);
});

test('L5 형식 오류면 오류 내용을 알려주고 한 번 더 요청 (자기수정)', async () => {
  const f = fakeFetch([ok('{"category":"모자","heightCm":150}'), ok('```json\n{"category":"상의","heightCm":150}\n```')]);
  const llm = makeLlm({ apiKey: 'K', model: 'm', fetchFn: f.fn, sleep: noSleep });
  assert.equal((await llm.json({ prompt: '원래 요청', schema: Schema })).category, '상의');
  assert.match(f.calls[1].body.contents[0].parts[0].text, /형식 오류[\s\S]*category/);
  assert.equal(llm.usage.repairs, 1);

  const g = fakeFetch([ok('not json'), ok('still not')]);
  const llm2 = makeLlm({ apiKey: 'K', model: 'm', fetchFn: g.fn, sleep: noSleep });
  await assert.rejects(llm2.json({ prompt: 'p' }), /형식 오류/);
});

test('L6 모델 미지정 시 목록에서 고른 뒤 호출', async () => {
  const list = { ok: true, status: 200, json: async () => ({ models: [{ name: 'models/gemini-2.5-flash', supportedGenerationMethods: ['generateContent'] }, { name: 'models/gemini-3.8-flash', supportedGenerationMethods: ['generateContent'] }] }) };
  const f = fakeFetch([list, ok('{"a":1}')]);
  const llm = makeLlm({ apiKey: 'K', fetchFn: f.fn, sleep: noSleep });
  await llm.json({ prompt: 'p' });
  assert.match(f.calls[1].url, /gemini-3\.8-flash:generateContent/);
  assert.equal(llm.model, 'gemini-3.8-flash');
});

test('L7 check(): 코드 블록 제거, 스키마 오류 경로 표시', () => {
  assert.equal(check('```json\n{"a":1}\n```').value.a, 1);
  assert.match(check('{"category":"x","heightCm":1}', Schema).error, /category/);
});
