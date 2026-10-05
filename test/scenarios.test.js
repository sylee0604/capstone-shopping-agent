// 설계서 v0.2 6장의 뼈대 검증 시나리오
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildGraph } from '../src/agent/graph.js';
import { makeRoutes } from '../src/agent/routes.js';
import { runAgent } from '../src/agent/runner.js';
import { makeMockNodes } from '../src/agent/mockNodes.js';

let seq = 0;
async function run(script, { answers = {}, clockStart = 0 } = {}) {
  const clock = { t: clockStart };
  const { nodes, trace } = makeMockNodes(script, clock);
  const graph = buildGraph(nodes, { routes: makeRoutes({ now: () => clock.t }) });
  const pauses = [];
  const opts = {
    threadId: `t${++seq}`,
    onPause: async (node, s) => {
      pauses.push(node);
      if (node === 'askUser') return { userAnswer: answers.askUser ?? { gender: '여아' } };
      return { selectedId: s.candidates[0].id };                     // 목록 첫 상품 선택
    },
  };
  const input = { request: { query: '테스트' }, startedAt: 0 };
  let final, error;
  try { final = await runAgent(graph, input, opts); } catch (e) { error = e; }
  return { final, trace, pauses, graph, opts, error };
}
const count = (trace, n) => trace.filter((x) => x === n).length;

test('1. 정보 충분, 첫 상품 적합', async () => {
  const { final, trace, pauses } = await run({ searchResults: [['a', 'b', 'c']] });
  assert.deepEqual(pauses, ['awaitSelection']);
  assert.deepEqual(final.analyzed, ['a']);
  assert.equal(final.recommendation.productId, 'a');
  assert.deepEqual(trace.slice(-2), ['writeRationale', 'finish']);
});

test('2. 성별 누락 → 되묻기 후 재개, 한 번만 묻기', async () => {
  const { final, trace, pauses } = await run({ intent: { missing: ['gender'] }, searchResults: [['a']] });
  assert.deepEqual(pauses, ['askUser', 'awaitSelection']);
  assert.equal(count(trace, 'askUser'), 1);
  assert.equal(final.intent.gender, '여아');
  assert.equal(final.recommendation.type, 'recommend');
});

test('3. 검색 0건이 계속됨 → 재검색 2회 후 종료', async () => {
  const { final, trace, pauses } = await run({ searchResults: [[], [], [], []] });
  assert.equal(count(trace, 'search'), 3);
  assert.equal(count(trace, 'reformulateQuery'), 2);
  assert.deepEqual(pauses, []);
  assert.equal(final.recommendation.type, 'none');
});

test('4. 검증 실패 후 재추출에서 통과', async () => {
  const { final, trace } = await run({ searchResults: [['a']], validation: { a: [['가슴 값 비정상'], []] } });
  assert.equal(count(trace, 'extractSpec'), 2);
  assert.equal(final.results[0].specStatus, 'ok');
});

test('5. 검증 실패가 상한까지 반복 → 불확실 / 원본 이상으로 판정 진행', async () => {
  const e = ['라벨 중복'];
  const a = await run({ searchResults: [['a']], validation: { a: [e, e, e, e] } });
  assert.equal(count(a.trace, 'extractSpec'), 3);                  // 1회 + 재추출 2회
  assert.equal(a.final.results[0].specStatus, 'uncertain');
  assert.ok(a.trace.includes('judgeFit'));
  const b = await run({ searchResults: [['a']], validation: { a: [e, e, e] }, repeated: { a: true } });
  assert.equal(b.final.results[0].specStatus, 'source_anomaly');
});

test('6. 첫 상품 부적합 → 다음 후보 적합', async () => {
  const { final, trace } = await run({ searchResults: [['a', 'b', 'c']], verdict: { a: { verdict: '부적합', unfitReason: 'SIZE_SOLD_OUT' } } });
  assert.equal(count(trace, 'nextCandidate'), 1);
  assert.deepEqual(final.analyzed, ['a', 'b']);
  assert.equal(final.recommendation.productId, 'b');
});

test('7. 후보 3개 모두 사이즈 범위 밖 → 재검색 1회 → 다시 실패하면 대안 제시', async () => {
  const out = { verdict: '부적합', unfitReason: 'SIZE_OUT_OF_RANGE' };
  const verdict = Object.fromEntries(['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((id) => [id, out]));
  const { final, trace, pauses } = await run({ searchResults: [['a', 'b', 'c', 'g'], ['d', 'e', 'f']], verdict });
  assert.equal(final.researchCount, 1);
  assert.equal(count(trace, 'analyzeFailure'), 2);
  assert.deepEqual(pauses, ['awaitSelection', 'awaitSelection']);  // 라운드마다 다시 선택
  assert.deepEqual(final.analyzed, ['a', 'b', 'c', 'd', 'e', 'f']); // 라운드당 3개, 'g'는 분석 안 함
  assert.equal(final.recommendation.type, 'fallback');
});

test('7-1. 부적합 사유가 섞여 있으면 재검색하지 않음', async () => {
  const { final, trace } = await run({ searchResults: [['a', 'b', 'c']], verdict: {
    a: { verdict: '부적합', unfitReason: 'SIZE_OUT_OF_RANGE' }, b: { verdict: '부적합', unfitReason: 'CONDITION_MISMATCH' }, c: { verdict: '부적합', unfitReason: 'SIZE_OUT_OF_RANGE' } } });
  assert.equal(count(trace, 'reformulateQuery'), 0);
  assert.equal(final.recommendation.type, 'fallback');
});

test('8. 전체 90초 초과 → 진행 중인 곳에서 종료', async () => {
  const { final, trace } = await run({ searchResults: [['a']], advanceClockMs: 100_000 });
  assert.ok(!trace.includes('judgeFit'));
  assert.equal(trace.at(-1), 'finish');
  assert.equal(final.recommendation.type, 'none');
});

test('9. 실행 중 오류로 중단 → 체크포인트에서 같은 노드부터 재개', async () => {
  const r = await run({ searchResults: [['a']], throwOnce: 'extractSpec' });
  assert.match(String(r.error), /가짜 네트워크 오류/);
  const final = await runAgent(r.graph, null, { ...r.opts, resume: true });
  assert.equal(count(r.trace, 'parseIntent'), 1);                  // 앞 단계는 다시 실행하지 않음
  assert.equal(count(r.trace, 'fetchDetail'), 1);
  assert.equal(count(r.trace, 'extractSpec'), 2);                  // 실패 1 + 재개 1
  assert.equal(final.recommendation.productId, 'a');
});

test('그래프 구조: 노드 15개, 일시정지 2곳', async () => {
  const { graph } = await run({ searchResults: [['a']] });
  const g = await graph.getGraphAsync();
  assert.equal(Object.keys(g.nodes).filter((n) => !n.startsWith('__')).length, 15);
});

test('10. 최악의 경우(후보 3개 모두 재추출 상한 + 부적합)에도 단계 수 상한에 걸리지 않음', async () => {
  const e = ['오류'], out = { verdict: '부적합', unfitReason: 'SIZE_OUT_OF_RANGE' };
  const { final, error, trace } = await run({ searchResults: [['a', 'b', 'c'], [], [], []],
    validation: { a: [e, e, e], b: [e, e, e], c: [e, e, e] }, verdict: { a: out, b: out, c: out } });
  assert.equal(error, undefined);
  assert.equal(count(trace, 'extractSpec'), 9);
  assert.equal(final.recommendation.type, 'fallback');
});
