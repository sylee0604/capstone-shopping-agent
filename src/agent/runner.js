// 그래프 실행 도우미: 일시정지 지점에서 사용자 응답을 받아 재개
import { RECURSION_LIMIT } from './state.js';

/**
 * @param graph       buildGraph() 결과
 * @param input       { request } 등 초기 상태
 * @param threadId    검색 세션 id
 * @param onPause     (nodeName, state) => Promise<상태 갱신값>  — UI가 질문·선택을 받아 돌려줌
 * @param onUpdate    (update) => void  — 노드별 진행 표시 (선택)
 */
export async function runAgent(graph, input, { threadId, onPause, onUpdate, resume = false }) {
  const cfg = { configurable: { thread_id: threadId }, recursionLimit: RECURSION_LIMIT };
  let next = resume ? null : { ...input, startedAt: input.startedAt ?? Date.now() };
  for (;;) {
    for await (const chunk of await graph.stream(next, { ...cfg, streamMode: 'updates' })) onUpdate?.(chunk);
    const state = await graph.getState(cfg);
    if (!state.next.length) return state.values;                   // 끝
    const update = await onPause(state.next[0], state.values);     // askUser 또는 awaitSelection
    await graph.updateState(cfg, update);
    next = null;                                                   // 이어서 실행
  }
}
