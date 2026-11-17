// 그래프 실행 도우미: 일시정지 지점에서 사용자 응답을 받아 재개
import { RECURSION_LIMIT } from './state.js';
import { PAUSE_BEFORE } from './graph.js';

/**
 * @param graph       buildGraph() 결과
 * @param input       { request } 등 초기 상태 (resume이면 무시)
 * @param threadId    검색 세션 id
 * @param onPause     (nodeName, state) => Promise<상태 갱신값>  — UI가 질문·선택을 받아 돌려줌
 * @param onUpdate    (update) => void  — 노드별 진행 표시 (선택)
 * @param resume      true면 저장된 체크포인트에서 이어서 실행
 * @param now         시계 (테스트에서 주입)
 *
 * 시간 상한(90초)은 에이전트가 일한 시간만 센다. 그래프가 멈출 때마다 그 구간의 시간을
 * activeMs에 더하고, 사용자 응답 뒤 새 구간을 시작한다. 중단 후 재개할 때도 새 구간으로 시작한다.
 */
export async function runAgent(graph, input, { threadId, onPause, onUpdate, resume = false, now = () => Date.now(), signal }) {
  // signal: 새 요청으로 바꿀 때 실행 중인 그래프를 멈추는 데 쓴다 (진행 중인 단계가 끝나면 다음 단계로 가지 않음)
  const cfg = { configurable: { thread_id: threadId }, recursionLimit: RECURSION_LIMIT, ...(signal ? { signal } : {}) };

  // 일시정지: 구간 시간을 정산하고(대기 전에 저장해 두어야 패널을 닫아도 남음) 응답을 받은 뒤 새 구간 시작
  async function pause(state) {
    const v = state.values;
    if (v.segmentStartedAt != null) {
      await graph.updateState(cfg, { activeMs: v.activeMs + (now() - v.segmentStartedAt), segmentStartedAt: null });
    }
    const answer = await onPause(state.next[0], (await graph.getState(cfg)).values);
    await graph.updateState(cfg, { ...answer, segmentStartedAt: now() });
  }

  let next;
  if (resume) {
    const st = await graph.getState(cfg);
    if (st.next.length && PAUSE_BEFORE.includes(st.next[0])) await pause(st);
    else await graph.updateState(cfg, { segmentStartedAt: now() });   // 오류로 끊긴 구간은 버리고 새로 시작
    next = null;
  } else {
    const t = now();
    next = { ...input, startedAt: t, activeMs: 0, segmentStartedAt: t };
  }

  for (;;) {
    if (signal?.aborted) throw Object.assign(new Error('취소됨'), { cancelled: true });
    for await (const chunk of await graph.stream(next, { ...cfg, streamMode: 'updates' })) {
      if (signal?.aborted) throw Object.assign(new Error('취소됨'), { cancelled: true });
      onUpdate?.(chunk);
    }
    const state = await graph.getState(cfg);
    if (!state.next.length) return state.values;                    // 끝
    await pause(state);                                             // askUser 또는 awaitSelection
    next = null;
  }
}
