// 상세 분석 단계 실제 노드 테스트: LLM·브라우저는 가짜. 모든 노드가 실제 구현인 그래프 전체를 돌린다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildGraph } from '../src/agent/graph.js';
import { makeRoutes } from '../src/agent/routes.js';
import { runAgent } from '../src/agent/runner.js';
import { makeSearchNodes } from '../src/agent/nodes/searchNodes.js';
import { makeDetailNodes, pickSizeImages } from '../src/agent/nodes/detailNodes.js';
import { judgeFit, rationaleText, stockOf } from '../src/agent/judge.js';
import { validateSpec } from '../src/agent/spec.js';

const row = (label, h, w, extra = {}) => ({ label, heightCm: h, weightKg: w, ageYears: null, length: null, chest: null, waist: null, hip: null, shoulder: null, sleeve: null, extra: {}, ...extra });
const spec = (sizes, more = {}) => ({ category: '원피스', weightUnit: 'kg', variants: [{ name: null, fitHeightCm: null, sizes }], fitMatrix: null, ...more });
const KIDS = spec([row('110', [106, 115], [16, 20]), row('120', [116, 125], [19, 24]), row('130', [126, 135], [23, 28])]);

test('D1 사이즈표 후보 이미지: 주변 글자에 尺码 등이 있는 이미지 우선, 원래 순서 유지', () => {
  const imgs = Array.from({ length: 10 }, (_, i) => ({ url: `u${i}`, w: 750, h: 1000, alt: '', near: '' }));
  imgs[2].near = '尺码表 参考';
  imgs[0].h = 100;                                    // 가로 띠 배너
  const pick = pickSizeImages(imgs, 3);
  assert.equal(pick.length, 3);
  assert.ok(pick.includes('u2'));
  assert.ok(!pick.includes('u0'));
  assert.deepEqual(pick, [...pick].sort((a, b) => a.slice(1) - b.slice(1)));
});

test('D2 판정: 키·몸무게 모두 맞으면 적합, 하나만 맞으면 경계, 아무것도 안 맞으면 부적합', () => {
  assert.equal(judgeFit(KIDS, { heightCm: 120, weightKg: 21 }).size, '120');
  assert.equal(judgeFit(KIDS, { heightCm: 120, weightKg: 21 }).verdict, '적합');
  const b = judgeFit(KIDS, { heightCm: 120, weightKg: 26 });   // 키는 120, 몸무게는 130 범위
  assert.equal(b.verdict, '경계');
  assert.equal(judgeFit(KIDS, { heightCm: 150, weightKg: 40 }).unfitReason, 'SIZE_OUT_OF_RANGE');
  assert.equal(judgeFit(KIDS, { heightCm: 137 }).verdict, '경계');    // 범위 끝에서 3cm 이내
});

test('D3 재고: 맞는 사이즈가 품절이면 부적합(SIZE_SOLD_OUT), 라벨 표기가 조금 달라도 찾음', () => {
  assert.equal(stockOf('120', [{ label: '120cm', soldOut: false }]), true);
  const r = judgeFit(KIDS, { heightCm: 120, weightKg: 21 }, [{ label: '110cm', soldOut: false }, { label: '120cm', soldOut: true }]);
  assert.equal(r.unfitReason, 'SIZE_SOLD_OUT');
});

test('D4 권장 키가 없는 표: 아동 숫자 라벨은 키 기준, 성인은 경계(실측 비교 안내)', () => {
  const noRange = spec([row('110', null, null), row('120', null, null), row('130', null, null)]);
  const k = judgeFit(noRange, { heightCm: 118, ageGroup: '아동' });
  assert.deepEqual([k.verdict, k.size], ['적합', '120']);
  const adult = spec([row('M', null, null, { length: 70 }), row('L', null, null, { length: 72 })]);
  const a = judgeFit(adult, { heightCm: 165, ageGroup: '성인' });
  assert.equal(a.verdict, '경계');
  assert.equal(a.size, null);
});

test('D5 키×몸무게 매트릭스와 근거 문장(斤 단위 안내 포함)', () => {
  const m = spec([row('S', null, null), row('M', null, null)], { weightUnit: '斤', fitMatrix: { heightCm: [155, 165], weightKg: [45, 55], cells: [['S', 'M'], ['M', 'M']] } });
  const r = judgeFit(m, { heightCm: 157, weightKg: 47 });
  assert.equal(r.size, 'S');
  assert.match(rationaleText(r, m), /斤/);
});

test('D6 검증 규칙: 둘레로 읽은 가슴이 키 대비 너무 작으면 오류 (테스트셋 dress01 유형)', () => {
  const bad = spec([row('110', [106, 115], null, { chest: { value: 48, basis: '둘레' } })]);
  assert.match(validateSpec(bad)[0], /단면/);
  const ok = spec([row('110', [106, 115], null, { chest: { value: 48, basis: '단면' } })]);
  assert.deepEqual(validateSpec(ok), []);
});

// ── 그래프 전체 (모든 노드 실제 구현) ──
function fakeLlm(outputs) {
  const calls = [];
  return { calls, async json(req) { calls.push(req); const o = outputs.shift(); if (!o) throw new Error('예상 밖 LLM 호출'); return req.schema.parse(o); } };
}
function fakeBrowser({ detail = {}, products = [] } = {}) {
  const loaded = [];
  return {
    loaded,
    async search() { return { products: products.map((p) => ({ salesNum: 100, priceCny: 50, titleZh: '女童 连衣裙', url: `https://item.taobao.com/item.htm?id=${p.id}`, ...p })), blocked: false }; },
    async cnyToKrw() { return 200; },
    async translate(t) { return t; },
    async detail({ url }) {
      const id = url.split('=')[1];
      const d = detail[id] ?? {};
      return { images: (d.images ?? ['a', 'b']).map((u) => ({ url: `https://img.alicdn.com/${id}_${u}.jpg`, w: 750, h: 900, alt: '', near: u === 'size' ? '尺码' : '' })), skus: d.skus ?? [], blocked: false };
    },
    async loadImages(urls) { loaded.push(urls); return urls.map((url) => ({ url, mimeType: 'image/jpeg', base64: 'AAAA' })); },
  };
}
let n = 0;
async function runAll(llm, browser) {
  const nodes = { ...makeSearchNodes({ llm, browser }), ...makeDetailNodes({ llm, browser }) };
  const g = buildGraph(nodes, { routes: makeRoutes() });
  const pick = async (node, s) => ({ selectedId: s.candidates.find((c) => !s.analyzed.includes(c.id)).id });
  return runAgent(g, { request: { query: '여아 원피스 키 120 21kg', profile: {} } }, { threadId: `d${n++}`, onPause: pick });
}

test('D7 전체 흐름: 의도 파악은 규칙, 추출 1회 = LLM 1회로 추천과 근거까지', async () => {
  const llm = fakeLlm([KIDS]);                                  // 의도 파악은 규칙으로 (LLM 없음)
  const browser = fakeBrowser({ products: [{ id: 'p1' }], detail: { p1: { images: ['a', 'size', 'b'], skus: [{ label: '120cm', soldOut: false }] } } });
  const v = await runAll(llm, browser);
  assert.equal(llm.calls.length, 1);
  assert.equal(llm.calls[0].images.length, 3);                 // 후보 이미지를 한 번에 넣음
  assert.deepEqual([v.recommendation.type, v.recommendation.size, v.recommendation.verdict], ['recommend', '120', '적합']);
  assert.match(v.recommendation.rationale, /키 120cm → 권장 키 116~125cm 안/);
  assert.match(v.recommendation.rationale, /재고 있음/);
});

test('D8 검증 실패 → 오류를 알려 1회 재추출 → 통과', async () => {
  const bad = spec([row('110', [106, 115], [16, 20], { chest: { value: 48, basis: '둘레' } }), row('120', [116, 125], [19, 24], { chest: { value: 50, basis: '둘레' } })]);
  const good = spec([row('110', [106, 115], [16, 20], { chest: { value: 48, basis: '단면' } }), row('120', [116, 125], [19, 24], { chest: { value: 50, basis: '단면' } })]);
  const llm = fakeLlm([bad, good]);
  const v = await runAll(llm, fakeBrowser({ products: [{ id: 'p1' }] }));
  assert.equal(llm.calls.length, 2);
  assert.match(llm.calls[1].prompt, /이전 답변에서 발견된 문제[\s\S]*단면/);
  assert.equal(v.results[0].specStatus, 'ok');
  assert.equal(v.recommendation.size, '120');
});

test('D9 사이즈표 없음({"none":true}) → 부적합(SPEC_UNKNOWN) → 남은 후보 선택', async () => {
  const llm = fakeLlm([{ none: true }, KIDS]);
  const v = await runAll(llm, fakeBrowser({ products: [{ id: 'p1', salesNum: 900 }, { id: 'p2', salesNum: 100 }] }));
  assert.equal(v.results[0].unfitReason, 'SPEC_UNKNOWN');
  assert.equal(v.recommendation.productId, 'p2');
});

test('D10 페이지의 사이즈표(HTML 표)를 글자로 읽었으면 이미지 없이 글자로 추출', async () => {
  const llm = fakeLlm([KIDS]);
  const browser = fakeBrowser({ products: [{ id: 'p1' }] });
  const detail = browser.detail;
  browser.detail = async (a) => ({ ...(await detail(a)), sizeTableText: '尺码 | 身高 | 体重\n110 | 106-115 | 16-20\n120 | 116-125 | 19-24' });
  const v = await runAll(llm, browser);
  assert.equal(llm.calls[0].images.length, 0);
  assert.match(llm.calls[0].prompt, /글자로 옮긴 것[\s\S]*116-125/);
  assert.equal(browser.loaded.length, 0);
  assert.equal(v.recommendation.size, '120');
});
