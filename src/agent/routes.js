// 조건 분기 (설계서 v0.2 표 3). 모두 상태만 보고 다음 노드를 정하는 순수 함수.
import { LIMITS } from './state.js';

export function makeRoutes({ limits = LIMITS, now = () => Date.now() } = {}) {
  const late = (s) => s.startedAt != null && now() - s.startedAt > limits.deadlineMs;
  const roundResults = (s) => s.results.filter((r) => r.round === s.round);

  return {
    afterIntent: (s) => (s.intent?.missing?.length && !s.askedUser ? 'askUser' : 'search'),

    afterSearch: (s) => {
      if (late(s)) return 'finish';
      if (s.candidates.length) return 'rankCandidates';
      return s.searchAttempts <= limits.searchRetry ? 'reformulateQuery' : 'finish';
    },

    afterDetail: (s) => (late(s) ? 'finish' : s.current?.imageUrls?.length ? 'selectSizeImages' : 'judgeFit'),

    afterImages: (s) => (late(s) ? 'finish' : s.current?.sizeImages?.length ? 'extractSpec' : 'judgeFit'),

    afterValidate: (s) => {
      if (late(s)) return 'finish';
      return s.current?.status === 'retry' ? 'extractSpec' : 'judgeFit';
    },

    afterJudge: (s) => {
      if (late(s)) return 'finish';
      const r = s.results.at(-1);
      if (r?.verdict === '적합' || r?.verdict === '경계') return 'writeRationale';
      const left = s.candidates.filter((c) => !s.analyzed.includes(c.id));
      return roundResults(s).length < limits.maxCandidates && left.length ? 'nextCandidate' : 'analyzeFailure';
    },

    afterFailure: (s) => {
      if (late(s)) return 'finish';
      const rr = roundResults(s);
      const allOutOfRange = rr.length > 0 && rr.every((r) => r.unfitReason === 'SIZE_OUT_OF_RANGE');
      return allOutOfRange && s.researchCount < limits.research ? 'reformulateQuery' : 'finish';
    },
  };
}

// 검증 결과로 추출 상태를 정하는 규칙 (validateSpec 노드에서 사용)
export function specStatus({ errors, extractAttempts, repeated }, limits = LIMITS) {
  if (!errors.length) return 'ok';
  if (extractAttempts <= limits.extractRetry) return 'retry';
  return repeated ? 'source_anomaly' : 'uncertain';   // 같은 값이 반복되면 원본 자체의 이상
}
