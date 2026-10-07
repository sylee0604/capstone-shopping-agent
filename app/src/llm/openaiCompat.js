// OpenAI 호환 서버 (자체 GPU 서버의 vLLM + Qwen2.5-VL 등). 서버 지원이 확정되면 provider만 'openai'로 바꾼다.
import { LlmError } from './errors.js';

export function openaiCompatProvider({ baseUrl, apiKey = '', model = 'Qwen/Qwen2.5-VL-7B-Instruct', fetchFn = globalThis.fetch?.bind(globalThis), timeoutMs = 60_000 }) {
  if (!baseUrl) throw new LlmError('서버 주소가 설정되지 않았어요', { code: 'NO_URL' });
  return {
    model,
    async generate({ system, prompt, images = [], temperature = 0, json = false }) {
      const content = [...images.map((im) => ({ type: 'image_url', image_url: { url: `data:${im.mimeType};base64,${im.base64}` } })), { type: 'text', text: prompt }];
      const messages = [...(system ? [{ role: 'system', content: system }] : []), { role: 'user', content }];
      let r;
      try {
        r = await fetchFn(`${baseUrl.replace(/\/$/, '')}/v1/chat/completions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}) },
          body: JSON.stringify({ model, messages, temperature, max_tokens: 2048, ...(json ? { response_format: { type: 'json_object' } } : {}) }),
          signal: AbortSignal.timeout?.(timeoutMs),
        });
      } catch (e) {
        throw new LlmError(`네트워크 오류: ${e.message}`, { code: 'NETWORK', retryable: true });
      }
      if (!r.ok) throw new LlmError(`서버 오류 ${r.status}: ${(await r.text()).slice(0, 300)}`, { code: r.status, retryable: r.status >= 500 || r.status === 429 });
      const data = await r.json();
      const text = data.choices?.[0]?.message?.content ?? '';
      if (!text) throw new LlmError('빈 응답', { code: 'EMPTY', retryable: true });
      return { text, usage: { inputTokens: data.usage?.prompt_tokens ?? 0, outputTokens: data.usage?.completion_tokens ?? 0 } };
    },
  };
}
