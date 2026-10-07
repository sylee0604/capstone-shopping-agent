// 검색 단계 실제 노드 테스트: LLM·브라우저는 가짜, 분석 단계는 아직 가짜 노드(mockNodes)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildGraph } from '../src/agent/graph.js';
import { makeRoutes } from '../src/agent/routes.js';
import { runAgent } from '../src/agent/runner.js';
import { makeMockNodes } from '../src/agent/mockNodes.js';
import { makeSearchNodes, NeedsLoginError } from '../src/agent/nodes/searchNodes.js';
import { applyProfile, buildQueries, findMissing, IntentSchema } from '../src/agent/intent.js';
import { rankProducts } from '../src/agent/rank.js';

const BASE = IntentSchema.parse({});
const intent = (o) => ({ ...BASE, ...o });

// 가짜 LLM: 호출 순서대로 정해 둔 값을 돌려주고, 받은 요청을 기록
function fakeLlm(outputs) {
  const calls = [];
  return { calls, async json(req) { calls.push(req); const o = outputs.shift(); if (!o) throw new Error('예상 밖 LLM 호출'); return req.schema ? req.schema.parse(o) : o; } };
}
// 가짜 브라우저: 검색어 → 상품 목록
function fakeBrowser(byQuery, { blockedOnce = false } = {}) {
  const searched = [];
  let blocked = blockedOnce;
  return {
    searched,
    async search({ query }) {
      if (blocked) { blocked = false; return { products: [], blocked: true }; }
      searched.push(query);
      return { products: (byQuery[query] ?? []).map((p) => ({ salesNum: 100, priceCny: 50, ...p, titleZh: p.titleZh ?? query })), blocked: false };
    },
    async cnyToKrw() { return 200; },
    async translate(texts) { return texts.map((t) => `[번역]${t}`); },
  };
}

function graphWith(llm, browser, script = {}) {
  const mock = makeMockNodes(script);
  const nodes = { ...mock.nodes, ...makeSearchNodes({ llm, browser }) };
  return buildGraph(nodes, { routes: makeRoutes() });
}
const pickFirst = async (node, s) => (node === 'askUser' ? { userAnswer: { gender: '여성' } } : { selectedId: s.candidates.find((c) => !s.analyzed.includes(c.id)).id });
let n = 0;
const run = (g, query, profile, onPause = pickFirst) => runAgent(g, { request: { query, profile } }, { threadId: `t${n++}`, onPause });

test('S1 의도 파악: 사전 번역으로 검색어 조립, 아동 사이즈 숫자를 키로 사용', () => {
  const it = applyProfile(intent({ category: '원피스', item: '원피스', ageGroup: '아동', gender: '여성', sizeLabel: '110', season: '봄', styles: ['꽃무늬'], budgetKrw: 30000 }));
  assert.equal(it.heightCm, 110);
  assert.deepEqual(findMissing(it), []);
  assert.deepEqual(buildQueries(it), ['女童 春季 碎花 连衣裙', '女童 春季 连衣裙', '女童 连衣裙']);
});

test('S2 사전에 없는 품목·조건은 LLM 번역(itemZh·extraZh) 사용, 프로필로 키·성별 보충', () => {
  const it = applyProfile(intent({ item: '점프수트', itemZh: '连体裤', category: '원피스', ageGroup: '성인', extraZh: ['V领'] }), { gender: '여성', heightCm: 162, weightKg: 50 });
  assert.equal(it.gender, '여성');
  assert.equal(it.heightCm, 162);
  assert.deepEqual(buildQueries(it), ['女装 V领 连体裤', '女装 连体裤']);
  assert.deepEqual(findMissing(applyProfile(intent({ item: '후드티' }))), ['target', 'height']);
});

test('S3 정상: 의도 파악 → 검색 → 후보 3개(번역·원화) → 선택 → (가짜 분석) 추천', async () => {
  const llm = fakeLlm([{ category: '상의', item: '후드티', ageGroup: '성인', gender: '여성', heightCm: 160 }]);
  const products = [1, 2, 3, 4, 5].map((i) => ({ id: `p${i}`, titleZh: `女装 连帽卫衣 款${i}`, salesNum: i * 100, priceCny: 60 + i }));
  const browser = fakeBrowser({ '女装 连帽卫衣': products });
  const v = await run(graphWith(llm, browser), '여자 후드티, 키 160', {});
  assert.deepEqual(browser.searched, ['女装 连帽卫衣']);
  assert.deepEqual(v.candidates.map((c) => c.id), ['p5', 'p4', 'p3']);      // 판매량 순
  assert.equal(v.candidates[0].title, '[번역]女装 连帽卫衣 款5');
  assert.equal(v.candidates[0].priceKrw, 65 * 200);
  assert.equal(v.recommendation.type, 'recommend');
  assert.equal(llm.calls.length, 1);
});

test('S4 되묻기: 성별이 없으면 멈추고, 답을 받아 검색어를 다시 조립 (LLM 추가 호출 없음)', async () => {
  const llm = fakeLlm([{ category: '하의', item: '청바지', ageGroup: '성인', heightCm: 170 }]);
  const browser = fakeBrowser({ '女装 牛仔裤': [{ id: 'j1' }] });
  const paused = [];
  const v = await run(graphWith(llm, browser), '청바지 170', {}, async (node, s) => { paused.push(node); return pickFirst(node, s); });
  assert.deepEqual(paused, ['askUser', 'awaitSelection']);
  assert.deepEqual(v.intent.missing, []);
  assert.deepEqual(browser.searched, ['女装 牛仔裤']);
  assert.equal(llm.calls.length, 1);
});

test('S5 검색 0건: 준비된 더 일반적인 검색어로 → 그래도 없으면 LLM이 새 검색어', async () => {
  const llm = fakeLlm([
    { category: '원피스', item: '원피스', ageGroup: '아동', gender: '여성', heightCm: 120, season: '봄', colors: ['분홍'] },
    { queries: ['女童 裙子'] },
  ]);
  const browser = fakeBrowser({ '女童 裙子': [{ id: 'd1' }] });
  const v = await run(graphWith(llm, browser), '여아 봄 분홍 원피스 120', {});
  assert.deepEqual(browser.searched, ['女童 春季 粉色 连衣裙', '女童 春季 连衣裙', '女童 连衣裙']);   // 0건 3번 = 첫 시도 + 재검색 2회
  assert.equal(v.recommendation.type, 'none');                                                   // 재검색 상한(2회) 도달
  assert.equal(llm.calls.length, 1);                                                              // 준비된 검색어만으로 상한에 걸려 LLM은 안 부름
});

test('S6 준비된 검색어가 바닥나면 LLM에게 새 검색어를 받아 계속', async () => {
  const llm = fakeLlm([{ category: '상의', item: '셔츠', ageGroup: '성인', gender: '남성', heightCm: 175 }, { queries: ['男士 衬衣'] }]);
  const browser = fakeBrowser({ '男士 衬衣': [{ id: 's1' }] });
  const v = await run(graphWith(llm, browser), '남자 셔츠 175', {});
  assert.deepEqual(browser.searched, ['男装 衬衫', '男士 衬衣']);
  assert.match(llm.calls[1].prompt, /이미 써 본 검색어: \["男装 衬衫"\]/);
  assert.equal(v.recommendation.productId, 's1');
});

test('S7 후보 3개 모두 부적합 → 다음 라운드는 남은 검색어로, 이미 본 상품 제외', async () => {
  const llm = fakeLlm([{ category: '원피스', item: '원피스', ageGroup: '성인', gender: '여성', heightCm: 160, season: '여름' }]);
  const r1 = ['a', 'b', 'c', 'x'].map((id, i) => ({ id, salesNum: 1000 - i }));
  const r2 = ['a', 'b', 'd'].map((id) => ({ id }));
  const browser = fakeBrowser({ '女装 夏季 连衣裙': r1, '女装 连衣裙': r2 });
  const out = { verdict: '부적합', unfitReason: 'SIZE_OUT_OF_RANGE' };
  const v = await run(graphWith(llm, browser, { verdict: { a: out, b: out, c: out } }), '여름 원피스', {});
  assert.deepEqual(browser.searched, ['女装 夏季 连衣裙', '女装 连衣裙']);
  assert.equal(v.round, 2);
  assert.equal(v.recommendation.productId, 'd');              // a, b는 다시 보여주지 않음
});

test('S8 로그인 필요 페이지면 멈추고, 로그인 후 이어서 하기로 계속', async () => {
  const llm = fakeLlm([{ category: '상의', item: '니트', ageGroup: '성인', gender: '여성', heightCm: 158 }]);
  const browser = fakeBrowser({ '女装 针织衫': [{ id: 'k1' }] }, { blockedOnce: true });
  const g = graphWith(llm, browser);
  const input = { request: { query: '니트', profile: {} } };
  await assert.rejects(runAgent(g, input, { threadId: 'login', onPause: pickFirst }), NeedsLoginError);
  const v = await runAgent(g, input, { threadId: 'login', onPause: pickFirst, resume: true });
  assert.equal(v.recommendation.productId, 'k1');
  assert.equal(llm.calls.length, 1);                          // 의도 파악은 다시 하지 않음 (체크포인트)
});

test('S9 후보 선별: 예산 안 상품만, 예산 안에 없으면 초과 표시하고 보여줌', () => {
  const pool = [
    { id: 'cheap', titleZh: '女装 连衣裙', priceCny: 100, salesNum: 10 },
    { id: 'hot', titleZh: '女装 连衣裙', priceCny: 200, salesNum: 5000 },
    { id: 'nomatch', titleZh: '外套', priceCny: 90, salesNum: 10 },
  ];
  assert.deepEqual(rankProducts(pool, { budgetKrw: 25000, query: '女装 连衣裙', rate: 200 }).map((p) => p.id), ['cheap', 'nomatch']);
  const over = rankProducts(pool, { budgetKrw: 1000, query: '女装 连衣裙', rate: 200 });
  assert.equal(over[0].id, 'hot');
  assert.ok(over.every((p) => p.overBudget));
});
