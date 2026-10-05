// 그래프 실행 도우미: 일시정지 지점에서 사용자 응답을 받아 재개
import { RECURSION_LIMIT } from './state.js';
import { PAUSE_BEFORE } from './graph.js';

/**
 * @param graph       buildGraph() 결과
 * @param input       { request } 등 초기 상태
 * @param threadId    검색 세션 id
 * @param onPause     (nodeName, state) => Promise<상태 갱신값>  — UI가 질문·선택을 받아 돌려줌
 * @param onUpdate    (update) => void  — 노드별 진행 표시 (선택)
 * @param resume      true면 저장된 체크포인트에서 이어서 실행 (input 무시)
 */
export async function runAgent(graph, input, { threadId, onPause, onUpdate, resume = false }) {
  const cfg = { configurable: { thread_id: threadId }, recursionLimit: RECURSION_LIMIT };
  let next = resume ? null : { ...input, startedAt: input.startedAt ?? Date.now() };
  if (resume) {
    // 사용자 입력을 기다리던 중에 끊겼다면, 먼저 응답부터 받는다
    const st = await graph.getState(cfg);
    if (st.next.length && PAUSE_BEFORE.includes(st.next[0])) await graph.updateState(cfg, await onPause(st.next[0], st.values));
  }
  for (;;) {
    for await (const chunk of await graph.stream(next, { ...cfg, streamMode: 'updates' })) onUpdate?.(chunk);
    const state = await graph.getState(cfg);
    if (!state.next.length) return state.values;                   // 끝
    const update = await onPause(state.next[0], state.values);     // askUser 또는 awaitSelection
    await graph.updateState(cfg, update);
    next = null;                                                   // 이어서 실행
  }
}
