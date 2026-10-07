// 에이전트 공유 상태 (설계서 v0.2 3장)
import { Annotation } from '@langchain/langgraph/web';

export const LIMITS = {
  searchRetry: 2,      // 검색 0건일 때 재검색 최대 횟수
  extractRetry: 2,     // 검증 실패 시 재추출 최대 횟수
  maxCandidates: 3,    // 한 라운드에 사용자에게 보여줄 후보 수
  research: 1,         // 후보 소진 후 재검색 최대 횟수
  deadlineMs: 90_000,  // 에이전트 작업 시간 상한 (사용자 응답을 기다린 시간은 제외)
};

// 그래프 한 번 실행의 최대 단계 수 (LangGraph 기본값 25로는 루프를 다 돌 수 없음)
export const RECURSION_LIMIT = 150;

const last = (a, b) => (b === undefined ? a : b);   // 덮어쓰기
const append = (a, b) => a.concat(b);               // 누적

export const AgentState = Annotation.Root({
  request: Annotation({ reducer: last, default: () => null }),       // 사용자 문장, 플랫폼, 프로필
  intent: Annotation({ reducer: last, default: () => null }),        // 해석된 조건 (missing: 누락 항목)
  userAnswer: Annotation({ reducer: last, default: () => null }),    // 되묻기 응답 (updateState로 주입)
  askedUser: Annotation({ reducer: last, default: () => false }),

  round: Annotation({ reducer: last, default: () => 1 }),            // 검색 라운드 (실패 후 재검색 시 +1)
  searchAttempts: Annotation({ reducer: last, default: () => 0 }),   // 이번 라운드 검색 시도 수
  researchCount: Annotation({ reducer: last, default: () => 0 }),
  usedQueries: Annotation({ reducer: append, default: () => [] }),   // 이미 써 본 중국어 검색어
  candidates: Annotation({ reducer: last, default: () => [] }),
  selectedId: Annotation({ reducer: last, default: () => null }),    // 사용자 선택 또는 다음 후보

  analyzed: Annotation({ reducer: append, default: () => [] }),      // 분석한 상품 id (전체 라운드)
  current: Annotation({ reducer: last, default: () => null }),       // 분석 중인 상품
  results: Annotation({ reducer: append, default: () => [] }),       // 상품별 판정 { productId, round, verdict, size, unfitReason, specStatus }

  recommendation: Annotation({ reducer: last, default: () => null }),
  startedAt: Annotation({ reducer: last, default: () => null }),         // 실행 시작 시각 (표시용)
  activeMs: Annotation({ reducer: last, default: () => 0 }),             // 지금까지 에이전트가 일한 시간 (일시정지 제외)
  segmentStartedAt: Annotation({ reducer: last, default: () => null }),  // 현재 작업 구간 시작 시각 (일시정지 중이면 null)
  log: Annotation({ reducer: append, default: () => [] }),
});
