// 에이전트 실행 그래프 (설계서 v0.3 그림 1)
import { StateGraph, START, END, MemorySaver } from '@langchain/langgraph/web';
import { AgentState } from './state.js';
import { makeRoutes } from './routes.js';

export const NODE_NAMES = [
  'parseIntent', 'askUser', 'search', 'reformulateQuery', 'rankCandidates', 'awaitSelection',
  'fetchDetail', 'selectSizeImages', 'extractSpec', 'validateSpec', 'judgeFit',
  'analyzeFailure', 'writeRationale', 'finish',
];

// 사용자 입력을 기다리는 노드: 이 노드 직전에서 멈춤 (interrupt()는 브라우저용 진입점에서 동작하지 않음)
export const PAUSE_BEFORE = ['askUser', 'awaitSelection'];

/**
 * @param {Record<string, Function>} nodes  노드 이름 → (state) => 상태 갱신값
 * @param {{ checkpointer?, routes? }} options
 */
export function buildGraph(nodes, { checkpointer = new MemorySaver(), routes = makeRoutes() } = {}) {
  const missing = NODE_NAMES.filter((n) => typeof nodes[n] !== 'function');
  if (missing.length) throw new Error(`노드 함수가 없습니다: ${missing.join(', ')}`);

  const g = new StateGraph(AgentState);
  for (const n of NODE_NAMES) g.addNode(n, nodes[n]);

  return g
    .addEdge(START, 'parseIntent')
    .addConditionalEdges('parseIntent', routes.afterIntent, ['askUser', 'search'])
    .addEdge('askUser', 'search')
    .addConditionalEdges('search', routes.afterSearch, ['rankCandidates', 'reformulateQuery', 'finish'])
    .addEdge('reformulateQuery', 'search')
    .addEdge('rankCandidates', 'awaitSelection')
    .addEdge('awaitSelection', 'fetchDetail')
    .addConditionalEdges('fetchDetail', routes.afterDetail, ['selectSizeImages', 'judgeFit', 'finish'])
    .addConditionalEdges('selectSizeImages', routes.afterImages, ['extractSpec', 'judgeFit', 'finish'])
    .addEdge('extractSpec', 'validateSpec')
    .addConditionalEdges('validateSpec', routes.afterValidate, ['extractSpec', 'judgeFit', 'finish'])
    .addConditionalEdges('judgeFit', routes.afterJudge, ['writeRationale', 'awaitSelection', 'analyzeFailure', 'finish'])
    .addConditionalEdges('analyzeFailure', routes.afterFailure, ['reformulateQuery', 'finish'])
    .addEdge('writeRationale', 'finish')
    .addEdge('finish', END)
    .compile({ checkpointer, interruptBefore: PAUSE_BEFORE });
}
