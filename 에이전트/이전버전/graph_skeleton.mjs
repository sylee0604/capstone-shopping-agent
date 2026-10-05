// 에이전트 실행 그래프 뼈대 v0.1 — 설계서(에이전트_그래프_설계서_v0.1.docx)와 같은 구조
// 실행 준비: npm install @langchain/langgraph @langchain/core
// 노드 함수는 buildGraph(nodes)에 주입 (POC에서는 가짜 함수)
import { StateGraph, Annotation, START, END, MemorySaver } from '@langchain/langgraph/web';
export const LIMITS = { searchRetry: 2, extractRetry: 2, maxCandidates: 3, research: 1, deadlineMs: 90_000 };
const last = (a, b) => (b === undefined ? a : b);
export const AgentState = Annotation.Root({
  request: Annotation(), intent: Annotation(), askedUser: Annotation({ reducer: last, default: () => false }),
  searchAttempts: Annotation({ reducer: last, default: () => 0 }), researchCount: Annotation({ reducer: last, default: () => 0 }),
  candidates: Annotation({ reducer: last, default: () => [] }), selectedId: Annotation(),
  analyzed: Annotation({ reducer: (a, b) => a.concat(b), default: () => [] }),
  current: Annotation(), results: Annotation({ reducer: (a, b) => a.concat(b), default: () => [] }),
  recommendation: Annotation(), startedAt: Annotation(),
  log: Annotation({ reducer: (a, b) => a.concat(b), default: () => [] }),
});
const late = s => Date.now() - s.startedAt > LIMITS.deadlineMs;
export const route = {
  intent: s => (s.intent?.missing?.length && !s.askedUser ? 'askUser' : 'search'),
  search: s => late(s) ? 'finish' : s.candidates.length ? 'rankCandidates' : s.searchAttempts <= LIMITS.searchRetry ? 'reformulateQuery' : 'finish',
  detail: s => (s.current?.imageUrls?.length ? 'selectSizeImages' : 'judgeFit'),
  images: s => (s.current?.sizeImages?.length ? 'extractSpec' : 'judgeFit'),
  validate: s => (s.current.errors.length && s.current.extractAttempts <= LIMITS.extractRetry && !late(s) ? 'extractSpec' : 'judgeFit'),
  judge: s => {
    const r = s.results.at(-1);
    if (r.verdict === '적합' || r.verdict === '경계') return 'writeRationale';
    const left = s.candidates.filter(c => !s.analyzed.includes(c.id));
    return s.analyzed.length < LIMITS.maxCandidates && left.length && !late(s) ? 'nextCandidate' : 'analyzeFailure';
  },
  failure: s => (s.researchCount < LIMITS.research && s.results.every(r => r.unfitReason === 'SIZE_OUT_OF_RANGE') && !late(s) ? 'reformulateQuery' : 'finish'),
};
export function buildGraph(nodes, checkpointer = new MemorySaver()) {
  return new StateGraph(AgentState)
    .addNode('parseIntent', nodes.parseIntent).addNode('askUser', nodes.askUser)
    .addNode('search', nodes.search).addNode('reformulateQuery', nodes.reformulateQuery)
    .addNode('rankCandidates', nodes.rankCandidates).addNode('awaitSelection', nodes.awaitSelection)
    .addNode('fetchDetail', nodes.fetchDetail).addNode('selectSizeImages', nodes.selectSizeImages)
    .addNode('extractSpec', nodes.extractSpec).addNode('validateSpec', nodes.validateSpec)
    .addNode('judgeFit', nodes.judgeFit).addNode('nextCandidate', nodes.nextCandidate)
    .addNode('analyzeFailure', nodes.analyzeFailure).addNode('writeRationale', nodes.writeRationale)
    .addNode('finish', nodes.finish)
    .addEdge(START, 'parseIntent')
    .addConditionalEdges('parseIntent', route.intent, ['askUser', 'search'])
    .addEdge('askUser', 'search')
    .addConditionalEdges('search', route.search, ['rankCandidates', 'reformulateQuery', 'finish'])
    .addEdge('reformulateQuery', 'search')
    .addEdge('rankCandidates', 'awaitSelection')
    .addEdge('awaitSelection', 'fetchDetail')
    .addConditionalEdges('fetchDetail', route.detail, ['selectSizeImages', 'judgeFit'])
    .addConditionalEdges('selectSizeImages', route.images, ['extractSpec', 'judgeFit'])
    .addEdge('extractSpec', 'validateSpec')
    .addConditionalEdges('validateSpec', route.validate, ['extractSpec', 'judgeFit'])
    .addConditionalEdges('judgeFit', route.judge, ['writeRationale', 'nextCandidate', 'analyzeFailure'])
    .addEdge('nextCandidate', 'fetchDetail')
    .addConditionalEdges('analyzeFailure', route.failure, ['reformulateQuery', 'finish'])
    .addEdge('writeRationale', 'finish')
    .addEdge('finish', END)
    .compile({ checkpointer, interruptBefore: ['askUser', 'awaitSelection'] });
}
