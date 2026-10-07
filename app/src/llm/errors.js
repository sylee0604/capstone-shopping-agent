// LLM 호출 오류. retryable이면 혼잡(429·5xx)·네트워크 문제라 잠시 뒤 다시 시도할 수 있다.
export class LlmError extends Error {
  constructor(message, { code, retryable = false } = {}) {
    super(message);
    this.name = 'LlmError';
    this.code = code;
    this.retryable = retryable;
  }
}
