// 조건 분기 (설계서 v0.2 표 3). 모두 상태만 보고 다음 노드를 정하는 순수 함수.
import { LIMITS } from './state.js';

export function makeRoutes({ limits = LIMITS, now = () => Date.now() } = {}) {
  // 에이전트 작업 시간 = 끝난 구간들의 합 + 현재 구간 경과 (사용자 응답 대기는 구간에 포함되지 않음)
  const activeTime = (s) => s.activeMs + (s.segmentStartedAt != null ? now() - s.segmentStartedAt : 0);
  const late = (s) => activeTime(s) > limits.deadlineMs;
  const remaining = (s) => s.candidates.filter((c) => !s.analyzed.includes(c.id));

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
      return remaining(s).length ? 'awaitSelection' : 'analyzeFailure';   // 남은 후보 중에서 사용자가 다시 고름
    },

    afterFailure: (s) => {
      if (late(s)) return 'finish';
      return s.researchCount < limits.research ? 'reformulateQuery' : 'finish';   // 후보 소진 → 새로 검색
    },
  };
}

// 검증 결과로 추출 상태를 정하는 규칙 (validateSpec 노드에서 사용)
export function specStatus({ errors, extractAttempts, repeated }, limits = LIMITS) {
  if (!errors.length) return 'ok';
  if (extractAttempts <= limits.extractRetry) return 'retry';
  return repeated ? 'source_anomaly' : 'uncertain';   // 같은 값이 반복되면 원본 자체의 이상
}

