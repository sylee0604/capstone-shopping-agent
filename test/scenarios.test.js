// 설계서 v0.3 시나리오: 가짜 노드로 분기·루프·상한·일시정지·재개를 검증
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildGraph } from '../src/agent/graph.js';
import { makeRoutes } from '../src/agent/routes.js';
import { runAgent } from '../src/agent/runner.js';
import { makeMockNodes } from '../src/agent/mockNodes.js';

let seq = 0;
async function run(script, { answers = {}, userDelayMs = 0 } = {}) {
  const clock = { t: 0 };
  const now = () => clock.t;
  const { nodes, trace } = makeMockNodes(script, clock);
  const graph = buildGraph(nodes, { routes: makeRoutes({ now }) });
  const pauses = [], picks = [];
  const opts = {
    threadId: `t${++seq}`, now,
    onPause: async (node, s) => {
      pauses.push(node);
      clock.t += userDelayMs;                                         // 사용자가 고민하는 시간
      if (node === 'askUser') return { userAnswer: answers.askUser ?? { gender: '여아' } };
      const pick = s.candidates.find((c) => !s.analyzed.includes(c.id)).id;   // 남은 후보 중 첫 번째
      picks.push(pick);
      return { selectedId: pick };
    },
  };
  let final, error;
  try { final = await runAgent(graph, { request: { query: '테스트' } }, opts); } catch (e) { error = e; }
  return { final, trace, pauses, picks, graph, opts, error, clock };
}
const count = (trace, n) => trace.filter((x) => x === n).length;
const out = { verdict: '부적합', unfitReason: 'SIZE_OUT_OF_RANGE' };
const soldOut = { verdict: '부적합', unfitReason: 'SIZE_SOLD_OUT' };

test('1. 정보 충분, 첫 상품 적합', async () => {
  const { final, trace, pauses } = await run({ searchResults: [['a', 'b', 'c']] });
  assert.deepEqual(pauses, ['awaitSelection']);
  assert.deepEqual(final.analyzed, ['a']);
  assert.equal(final.recommendation.productId, 'a');
  assert.deepEqual(trace.slice(-2), ['writeRationale', 'finish']);
});

test('2. 성별 누락 → 되묻기 후 재개, 한 번만 묻기', async () => {
  const { final, trace, pauses } = await run({ intent: { missing: ['gender'] }, searchResults: [['a']] });
  assert.deepEqual(pauses, ['askUser', 'awaitSelection']);
  assert.equal(count(trace, 'askUser'), 1);
  assert.equal(final.intent.gender, '여아');
});

test('3. 검색 0건이 계속됨 → 재검색 2회 후 종료', async () => {
  const { final, trace, pauses } = await run({ searchResults: [[], [], [], []] });
  assert.equal(count(trace, 'search'), 3);
  assert.equal(count(trace, 'reformulateQuery'), 2);
  assert.deepEqual(pauses, []);
  assert.equal(final.recommendation.type, 'none');
});

test('4. 검증 실패 후 재추출에서 통과', async () => {
  const { final, trace } = await run({ searchResults: [['a']], validation: { a: [['가슴 값 비정상'], []] } });
  assert.equal(count(trace, 'extractSpec'), 2);
  assert.equal(final.results[0].specStatus, 'ok');
});

test('5. 검증 실패가 상한까지 반복 → 불확실 / 원본 이상으로 판정 진행', async () => {
  const e = ['라벨 중복'];
  const a = await run({ searchResults: [['a']], validation: { a: [e, e, e, e] } });
  assert.equal(count(a.trace, 'extractSpec'), 3);
  assert.equal(a.final.results[0].specStatus, 'uncertain');
  const b = await run({ searchResults: [['a']], validation: { a: [e, e, e] }, repeated: { a: true } });
  assert.equal(b.final.results[0].specStatus, 'source_anomaly');
});

test('6. 첫 상품 사이즈 품절 → 남은 두 후보를 다시 보여주고 사용자가 고름', async () => {
  const { final, pauses, picks } = await run({ searchResults: [['a', 'b', 'c']], verdict: { a: soldOut } });
  assert.deepEqual(pauses, ['awaitSelection', 'awaitSelection']);
  assert.deepEqual(picks, ['a', 'b']);
  assert.equal(final.recommendation.productId, 'b');
});

test('7. 후보 3개를 모두 고르고 모두 부적합 → 새로 검색 → 새 후보 중에서 다시 고름', async () => {
  const { final, trace, picks } = await run({ searchResults: [['a', 'b', 'c', 'x'], ['d', 'e', 'f']],
    verdict: { a: soldOut, b: out, c: out, d: { verdict: '적합', size: '120' } } });
  assert.deepEqual(picks, ['a', 'b', 'c', 'd']);                   // 'x'는 상위 3개에 들지 않아 보여주지 않음
  assert.equal(count(trace, 'analyzeFailure'), 1);
  assert.equal(final.round, 2);
  assert.equal(final.recommendation.productId, 'd');
});

test('7-1. 새로 검색한 후보도 모두 부적합 → 재검색 상한(1회) 후 대안 제시', async () => {
  const verdict = Object.fromEntries(['a', 'b', 'c', 'd', 'e', 'f'].map((id) => [id, out]));
  const { final, trace, picks } = await run({ searchResults: [['a', 'b', 'c'], ['d', 'e', 'f']], verdict });
  assert.equal(picks.length, 6);
  assert.equal(count(trace, 'analyzeFailure'), 2);
  assert.equal(final.researchCount, 1);
  assert.equal(final.recommendation.type, 'fallback');
});

test('8. 에이전트 작업 시간 90초 초과 → 진행 중인 곳에서 종료', async () => {
  const { final, trace } = await run({ searchResults: [['a']], advanceClockMs: 100_000 });
  assert.ok(!trace.includes('judgeFit'));
  assert.equal(trace.at(-1), 'finish');
  assert.equal(final.recommendation.type, 'none');
});

test('8-1. 사용자가 응답하는 데 걸린 시간은 90초에 넣지 않음', async () => {
  const { final, clock } = await run({ intent: { missing: ['gender'] }, searchResults: [['a', 'b']], verdict: { a: soldOut } },
    { userDelayMs: 200_000 });                                      // 응답마다 200초씩 고민
  assert.ok(clock.t >= 600_000);                                    // 실제로는 10분 넘게 흘렀지만
  assert.equal(final.recommendation.productId, 'b');                // 시간 초과 없이 끝까지 진행
  assert.equal(final.activeMs, 0);                                  // 에이전트 작업 시간은 0 (가짜 노드는 시간이 안 걸림)
});

test('9. 실행 중 오류로 중단 → 체크포인트에서 같은 노드부터 재개', async () => {
  const r = await run({ searchResults: [['a']], throwOnce: 'extractSpec' });
  assert.match(String(r.error), /가짜 네트워크 오류/);
  const final = await runAgent(r.graph, null, { ...r.opts, resume: true });
  assert.equal(count(r.trace, 'parseIntent'), 1);
  assert.equal(count(r.trace, 'fetchDetail'), 1);
  assert.equal(count(r.trace, 'extractSpec'), 2);
  assert.equal(final.recommendation.productId, 'a');
});

test('10. 최악의 경우(후보마다 재추출 상한 + 부적합, 재검색 포함)에도 단계 수 상한에 걸리지 않음', async () => {
  const e = ['오류'];
  const ids = ['a', 'b', 'c', 'd', 'e', 'f'];
  const { final, error, trace } = await run({ searchResults: [['a', 'b', 'c'], ['d', 'e', 'f']],
    validation: Object.fromEntries(ids.map((id) => [id, [e, e, e]])), verdict: Object.fromEntries(ids.map((id) => [id, out])) });
  assert.equal(error, undefined);
  assert.equal(count(trace, 'extractSpec'), 18);
  assert.equal(final.recommendation.type, 'fallback');
});

test('그래프 구조: 노드 14개', async () => {
  const { graph } = await run({ searchResults: [['a']] });
  const g = await graph.getGraphAsync();
  assert.equal(Object.keys(g.nodes).filter((n) => !n.startsWith('__')).length, 14);
});
