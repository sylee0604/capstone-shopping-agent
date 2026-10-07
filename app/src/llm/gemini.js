// Gemini API (무료 등급). POC 스크립트(poc_extract.py)와 같은 방식: 키는 헤더로, 모델은 flash 계열 최신 버전 자동 선택.
import { LlmError } from './errors.js';

const API = 'https://generativelanguage.googleapis.com/v1beta';
const BAD = ['lite', 'image', 'tts', 'live', 'audio', 'embedding', 'exp', 'preview', '8b'];

// 모델 이름 목록에서 flash 계열 중 버전이 가장 높은 것부터 정렬
export function rankFlashModels(names) {
  let c = names.filter((n) => n.includes('flash') && !BAD.some((b) => n.includes(b)));
  if (!c.length) c = names.filter((n) => n.includes('flash'));
  if (!c.length) c = names;
  const ver = (n) => Number((n.match(/gemini-(\d+(?:\.\d+)?)/) ?? [])[1] ?? 0);
  return [...c].sort((a, b) => ver(b) - ver(a));
}

export function geminiProvider({ apiKey, model, fetchFn = globalThis.fetch?.bind(globalThis), timeoutMs = 60_000 }) {
  if (!apiKey) throw new LlmError('Gemini API 키가 설정되지 않았어요', { code: 'NO_KEY' });
  const headers = { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey };
  const self = { model };

  async function call(url, init) {
    let r;
    try {
      r = await fetchFn(url, { ...init, signal: AbortSignal.timeout?.(timeoutMs) });
    } catch (e) {
      throw new LlmError(`네트워크 오류: ${e.message}`, { code: 'NETWORK', retryable: true });
    }
    if (r.ok) return r.json();
    const body = (await r.text()).slice(0, 500);
    const retryable = [429, 500, 502, 503, 504].includes(r.status);
    const hint = r.status === 400 || r.status === 403 ? ' (API 키를 확인해 주세요)' : r.status === 429 ? ' (무료 사용량 한도)' : '';
    throw new LlmError(`Gemini 오류 ${r.status}${hint}: ${body}`, { code: r.status, retryable });
  }

  // 모델을 지정하지 않았으면 처음 한 번 목록을 받아 고른다
  self.init = async () => {
    if (self.model) return;
    const data = await call(`${API}/models?pageSize=200`, { headers });
    const names = (data.models ?? []).filter((m) => m.supportedGenerationMethods?.includes('generateContent')).map((m) => m.name.split('/').pop());
    self.model = rankFlashModels(names)[0];
    if (!self.model) throw new LlmError('사용할 수 있는 Gemini 모델이 없어요', { code: 'NO_MODEL' });
  };

  self.generate = async ({ system, prompt, images = [], temperature = 0, json = false }) => {
    await self.init();
    const parts = images.map((im) => ({ inline_data: { mime_type: im.mimeType, data: im.base64 } }));
    parts.push({ text: prompt });
    const body = {
      contents: [{ role: 'user', parts }],
      generationConfig: { temperature, ...(json ? { responseMimeType: 'application/json' } : {}) },
      ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
    };
    const data = await call(`${API}/models/${self.model}:generateContent`, { method: 'POST', headers, body: JSON.stringify(body) });
    const cand = data.candidates?.[0];
    const text = (cand?.content?.parts ?? []).map((p) => p.text ?? '').join('');
    if (!text) throw new LlmError(`빈 응답 (${cand?.finishReason ?? data.promptFeedback?.blockReason ?? '이유 없음'})`, { code: 'EMPTY', retryable: true });
    const u = data.usageMetadata ?? {};
    return { text, usage: { inputTokens: u.promptTokenCount ?? 0, outputTokens: u.candidatesTokenCount ?? 0 } };
  };

  return self;
}
