// LLM 호출 계층: 노드는 이 인터페이스만 쓴다. 제공자(Gemini 무료 API ↔ 자체 서버)를 바꿔도 노드 코드는 그대로.
//
//   const llm = makeLlm({ provider: 'gemini', apiKey });
//   const intent = await llm.json({ system, prompt, schema: IntentSchema });
//
// json(): 응답을 JSON으로 파싱하고 Zod 스키마로 검사한다. 형식이 틀리면 오류 내용을 알려주고 한 번 더 요청한다(자기수정).
import { LlmError } from './errors.js';
import { geminiProvider } from './gemini.js';
import { openaiCompatProvider } from './openaiCompat.js';

export { LlmError };

const PROVIDERS = { gemini: geminiProvider, openai: openaiCompatProvider };

/**
 * @param provider   'gemini' | 'openai'(vLLM 등 OpenAI 호환 서버)
 * @param waits      재시도 대기(ms). 에이전트 90초 상한 안에서 끝나도록 짧게 둔다 (POC 스크립트는 10~60초)
 * @param fetchFn, sleep  테스트에서 주입
 */
export function makeLlm({ provider = 'gemini', waits = [2000, 5000], sleep = (ms) => new Promise((r) => setTimeout(r, ms)), onRetry, ...opts } = {}) {
  const make = PROVIDERS[provider];
  if (!make) throw new Error(`알 수 없는 LLM 제공자: ${provider}`);
  const p = make(opts);
  const usage = { calls: 0, retries: 0, repairs: 0, inputTokens: 0, outputTokens: 0 };

  // 혼잡(429·5xx)·네트워크 오류만 재시도, 나머지(키 오류 등)는 바로 실패
  async function generate(req) {
    for (let attempt = 0; ; attempt++) {
      try {
        usage.calls++;
        const r = await p.generate(req);
        usage.inputTokens += r.usage?.inputTokens ?? 0;
        usage.outputTokens += r.usage?.outputTokens ?? 0;
        return r.text;
      } catch (e) {
        if (!(e instanceof LlmError) || !e.retryable || attempt >= waits.length) throw e;
        usage.retries++;
        onRetry?.({ attempt: attempt + 1, code: e.code, waitMs: waits[attempt] });
        await sleep(waits[attempt]);
      }
    }
  }

  async function json({ system, prompt, images = [], schema, temperature = 0 }) {
    let text = await generate({ system, prompt, images, temperature, json: true });
    let problem = check(text, schema);
    if (!problem.ok) {
      usage.repairs++;
      const fix = `${prompt}\n\n[이전 응답]\n${text.slice(0, 2000)}\n\n[형식 오류]\n${problem.error}\n위 오류를 고쳐 JSON만 다시 출력하라.`;
      text = await generate({ system, prompt: fix, images, temperature, json: true });
      problem = check(text, schema);
      if (!problem.ok) throw new LlmError(`LLM 응답 형식 오류: ${problem.error}`, { code: 'BAD_FORMAT' });
    }
    return problem.value;
  }

  async function text({ system, prompt, images = [], temperature = 0.2 }) {
    return generate({ system, prompt, images, temperature, json: false });
  }

  return { json, text, usage, get model() { return p.model; }, init: p.init ?? (async () => {}) };
}

// JSON 파싱 + 스키마 검사. 코드 블록(```json)으로 감싼 응답도 받아준다.
export function check(text, schema) {
  let value;
  try {
    value = JSON.parse(String(text).trim().replace(/^```(?:json)?\s*|\s*```$/g, ''));
  } catch (e) {
    return { ok: false, error: `JSON 파싱 실패: ${e.message}` };
  }
  if (!schema) return { ok: true, value };
  const r = schema.safeParse(value);
  if (r.success) return { ok: true, value: r.data };
  const msg = r.error.issues.slice(0, 5).map((i) => `${i.path.join('.') || '(전체)'}: ${i.message}`).join('; ');
  return { ok: false, error: msg };
}
