// 상세 분석 단계 실제 노드 테스트: LLM·브라우저는 가짜. 모든 노드가 실제 구현인 그래프 전체를 돌린다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildGraph } from '../src/agent/graph.js';
import { makeRoutes } from '../src/agent/routes.js';
import { runAgent } from '../src/agent/runner.js';
import { makeSearchNodes } from '../src/agent/nodes/searchNodes.js';
import { makeDetailNodes, pickSizeImages } from '../src/agent/nodes/detailNodes.js';
import { judgeFit, rationaleText, stockOf, specFromSkus, judgeWanted } from '../src/agent/judge.js';
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

test('D10 페이지의 사이즈표(HTML 표)를 글자로 읽었으면 코드로 바로 읽음 (LLM·이미지 없음), 못 읽는 모양이면 LLM에 글자로', async () => {
  const llm = fakeLlm([KIDS]);
  const browser = fakeBrowser({ products: [{ id: 'p1' }] });
  const detail = browser.detail;
  browser.detail = async (a) => ({ ...(await detail(a)), sizeTableText: '尺码 | 身高 | 体重\n110 | 106-115 | 16-20\n120 | 116-125 | 19-24' });
  const v = await runAll(llm, browser);
  assert.equal(llm.calls.length, 0);
  assert.equal(browser.loaded.length, 0);
  assert.equal(v.recommendation.size, '120');

  const llm2 = fakeLlm([KIDS]);
  const b2 = fakeBrowser({ products: [{ id: 'p1' }] });
  const d2 = b2.detail;
  b2.detail = async (a) => ({ ...(await d2(a)), sizeTableText: '尺码表\n110 106-115 16-20\n120 116-125 19-24' });   // 칸 구분이 없는 덩어리
  await runAll(llm2, b2);
  assert.equal(llm2.calls[0].images.length, 0);
  assert.match(llm2.calls[0].prompt, /글자로 옮긴 것[\s\S]*116-125/);
});

test('D11 호형(175/96A) 표: 키 179cm → 가장 가까운 큰 사이즈(180), 표에 없으면 옵션(SKU)에서 보탬', () => {
  const shirt = spec([row('170/88A', [170, 170], [68, 68]), row('175/92A', [175, 175], [74, 74]), row('175/96A', [175, 175], [80, 80])], { category: '상의' });
  const skus = ['170/88A', '175/92A', '175/96A', '180/100A', '185/104A'].map((label) => ({ label, soldOut: false }));
  const r = judgeFit(shirt, { heightCm: 179, weightKg: 75 }, skus);
  assert.deepEqual([r.verdict, r.size], ['적합', '180/100A']);
  const noSku = judgeFit(shirt, { heightCm: 179, weightKg: 75 });
  assert.deepEqual([noSku.verdict, noSku.size], ['경계', '175/96A']);       // 표에서 가장 큰 사이즈, 작을 수 있음
  assert.equal(judgeFit(shirt, { heightCm: 174, weightKg: 70 }).size, '175/92A');
});

test('D12 키×몸무게 매트릭스: 범위 밖이면 가까운 칸을 믿지 않고, 사이에 있으면 큰 쪽', () => {
  const m = spec([row('S', [165, 165], null), row('M', [170, 170], null), row('L', [175, 175], null)], { fitMatrix: { heightCm: [165, 170, 175], weightKg: [55, 65, 75], cells: [['S', 'M', 'M'], ['M', 'M', 'L'], ['M', 'L', 'L']] } });
  assert.equal(judgeFit(m, { heightCm: 168, weightKg: 60 }).size, 'M');            // 168 → 170 행, 60 → 65 열
  const out = judgeFit(m, { heightCm: 185, weightKg: 75 });
  assert.equal(out.verdict, '부적합');                                            // 매트릭스 밖 → 사이즈별 규칙 → 가장 큰 L도 10cm 작음
});

test('D13 옵션에서 보탠 사이즈의 근거는 실측이 아니라 체형 기준으로 표시', () => {
  const shirt = spec([row('170/88A', [170, 170], [68, 68]), row('175/96A', [175, 175], [80, 80])], { category: '상의' });
  const r = judgeFit(shirt, { heightCm: 179, weightKg: 75 }, [{ label: '180/100A', soldOut: false }]);
  const txt = rationaleText(r, shirt);
  assert.match(txt, /옵션에서 찾은 사이즈.*체형 기준/);
  assert.doesNotMatch(txt, /실측/);
});

test('D14 사이즈표가 없으면 옵션 이름(110cm, 建议身高)으로 판정', () => {
  const skus = [{ label: '100cm(建议身高90-100)', soldOut: false }, { label: '110cm(建议身高100-110)', soldOut: false }, { label: '120cm(建议身高110-120)', soldOut: true }];
  const sp = specFromSkus(skus);
  assert.deepEqual(sp.variants[0].sizes.map((x) => [x.label, x.heightCm]), [['100', [90, 100]], ['110', [100, 110]], ['120', [110, 120]]]);
  assert.equal(judgeFit(sp, { heightCm: 108, ageGroup: '아동' }, skus).size, '110');
  assert.equal(specFromSkus([{ label: '红色' }, { label: '蓝色' }]), null);
});

test('D15 "110 사이즈"라고 말하면 표의 110을 그대로 추천 (판매자 기준이 달라도)', () => {
  const shifted = spec([row('110', [95, 105], null), row('120', [106, 115], null)]);   // 키 110이면 120 범위인 표
  const r = judgeWanted(shifted, '110', [{ label: '110cm', soldOut: false }]);
  assert.deepEqual([r.verdict, r.size], ['적합', '110']);
  assert.match(r.reason[0], /요청하신 110 사이즈.*권장 키 95~105cm/);
  assert.equal(judgeWanted(shifted, '110', [{ label: '110cm', soldOut: true }]).unfitReason, 'SIZE_SOLD_OUT');
});

test('D16 대표 사진 마지막 장은 사이즈표 후보에 우선 포함', () => {
  const imgs = Array.from({ length: 12 }, (_, i) => ({ url: `d${i}`, w: 750, h: 1000, alt: '', near: '' }));
  imgs.push({ url: 'g-last', w: 0, h: 0, alt: '', near: '', gallery: true, galleryLast: true });
  assert.ok(pickSizeImages(imgs).includes('g-last'));
});

test('D17 옵션에 호형과 斤 몸무게를 적어 둔 경우 (175/84A 33推荐135~142斤)', () => {
  const L = ['165/72A 29推荐107~112斤', '170/74A 30推荐113~118斤', '170/78A 31推荐119~126斤', '175/82A 32推荐127~134斤', '175/84A 33推荐135~142斤',
    '175/88A 34推荐143~150斤', '175/90A 35推荐151~160斤', '180/92A 36推荐161~170斤', '180/96A 38推荐177~180斤', '185/100A 40推荐181~200斤',
    '185/108A 42推荐201~212斤', '165/70A 28推荐100~106斤', '185/112A 44推荐213~230斤'];
  const skus = L.map((label) => ({ label, soldOut: /^165\/70A|^185\/112A/.test(label) }));
  const sp = specFromSkus(skus);
  const r175 = sp.variants[0].sizes.find((x) => x.label === '175/84A 33');
  assert.deepEqual([r175.heightCm, r175.weightKg], [[175, 175], [67.5, 71]]);
  assert.equal(sp.weightUnit, '斤');
  const a = judgeFit(sp, { heightCm: 174, weightKg: 70 }, skus);           // 키 175 옵션 중 몸무게 67.5~71kg
  assert.deepEqual([a.verdict, a.size], ['적합', '175/84A 33']);
  assert.equal(a.stock, true);
  const b = judgeFit(sp, { heightCm: 179, weightKg: 75 }, skus);           // 키 180 옵션 중 가장 작은 것
  assert.equal(b.size, '180/92A 36');
});

test('D18 옵션에 사이즈 정보가 있으면 사이즈표 추출(LLM)을 건너뛰고 바로 판정', async () => {
  const llm = fakeLlm([]);
  const browser = fakeBrowser({ products: [{ id: 'p1' }], detail: { p1: { images: [], skus: ['110cm(建议身高100-110)', '120cm(建议身高110-120)', '130cm(建议身高120-130)'].map((label) => ({ label, soldOut: false })) } } });
  const v = await runAll(llm, browser);
  assert.equal(llm.calls.length, 0);                     // LLM 호출 없음
  assert.equal(browser.loaded.length, 0);                // 이미지도 불러오지 않음
  assert.deepEqual([v.recommendation.size, v.recommendation.verdict], ['120', '적합']);
  assert.match(v.recommendation.rationale, /옵션에 적힌 사이즈 정보/);
});

test('D19 옵션은 S/M/L뿐이고 표처럼 보이는 이미지도 없으면 LLM을 부르지 않고 바로 "사이즈표 없음"', async () => {
  const llm = fakeLlm([KIDS]);
  const browser = fakeBrowser({ products: [{ id: 'p1', salesNum: 900 }, { id: 'p2', salesNum: 100 }], detail: { p1: { skus: ['S', 'M', 'L'].map((label) => ({ label, soldOut: false })) } } });
  browser.chartLike = async (urls) => Object.fromEntries(urls.map((u) => [u, !u.includes('p1_')]));   // p1의 이미지는 모두 사진
  const v = await runAll(llm, browser);
  assert.equal(v.results[0].unfitReason, 'SPEC_UNKNOWN');
  assert.match(v.results[0].reason[0], /표로 보이는 것도 없음/);
  assert.equal(llm.calls.length, 1);                       // p1에서는 호출 없음, p2에서만 1회
  assert.equal(v.recommendation.productId, 'p2');
});

test('D20 옵션이 S/M/L뿐이면 "표일 수도"(글자 많은 홍보 이미지) 수준은 보내지 않고, 다른 상품에서는 보냄 (5장 이상이면 8장까지)', async () => {
  const llm = fakeLlm([KIDS]);
  const imgs = ['a', 'b', 'c', 'd', 'e'];
  const browser = fakeBrowser({ products: [{ id: 'p1', salesNum: 900 }, { id: 'p2', salesNum: 100 }], detail: { p1: { images: imgs, skus: ['S', 'M', 'L', 'XL', '黑色'].map((label) => ({ label, soldOut: false })) }, p2: { images: imgs } } });
  browser.chartLike = async (urls) => Object.fromEntries(urls.map((u) => [u, 1]));     // 모두 '표일 수도'
  const v = await runAll(llm, browser);
  assert.match(v.results[0].reason[0], /S\/M\/L/);
  assert.equal(llm.calls.length, 1);                        // p1은 호출 없음
  assert.equal(llm.calls[0].images.length, 5);              // 5장 이상이면 8장까지 (작게 줄여)
  assert.equal(v.recommendation.productId, 'p2');
});

test('D21 옵션이 S/M/L이어도 "표로 보임"(격자·열 구조) 이미지가 있으면 그것만 보냄', async () => {
  const llm = fakeLlm([KIDS]);
  const browser = fakeBrowser({ products: [{ id: 'p1' }], detail: { p1: { images: ['a', 'size', 'b'], skus: ['S', 'M', 'L'].map((label) => ({ label, soldOut: false })) } } });
  browser.chartLike = async (urls) => Object.fromEntries(urls.map((u) => [u, u.includes('_size') ? 2 : 1]));
  await runAll(llm, browser);
  assert.deepEqual(browser.loaded[0].map((u) => u.split('/').pop()), ['p1_size.jpg']);
});

test('D22 LLM 혼잡(503)·시간 초과면 실행을 멈추지 않고 그 상품만 LLM_FAILED → 남은 후보 선택', async () => {
  const outputs = [KIDS];
  let first = true;
  const llm = { calls: [], async json(req) { this.calls.push(req); if (first) { first = false; throw Object.assign(new Error('Gemini 오류 503'), { code: 'HTTP_503', retryable: true }); } return req.schema.parse(outputs.shift()); } };
  const v = await runAll(llm, fakeBrowser({ products: [{ id: 'p1', salesNum: 900 }, { id: 'p2', salesNum: 100 }] }));
  assert.equal(v.results[0].unfitReason, 'LLM_FAILED');
  assert.equal(v.recommendation.productId, 'p2');
  // 키 오류처럼 다시 해도 안 되는 오류는 그대로 멈춤
  const bad = { async json() { throw Object.assign(new Error('API 키 오류'), { code: 'AUTH', retryable: false }); } };
  await assert.rejects(runAll(bad, fakeBrowser({ products: [{ id: 'p1' }] })), /API 키/);
});

test('D23 글자 사이즈만 있는 옵션 판별', async () => {
  const { letterSizesOnly } = await import('../src/agent/nodes/detailNodes.js');
  const L = (...xs) => xs.map((label) => ({ label }));
  assert.equal(letterSizesOnly(L('S', 'M', 'L', '2XL', '黑色')), true);
  assert.equal(letterSizesOnly(L('M（建议100-120斤）', 'L')), false);
  assert.equal(letterSizesOnly(L('110cm', '120cm')), false);
  assert.equal(letterSizesOnly(L('175/92A', 'L')), false);
  assert.equal(letterSizesOnly(L('黑色', '白色')), false);
});

test('D24 사용량 한도(429)면 재시도 없이 그 상품만 LLM_LIMIT → 남은 후보 선택', async () => {
  let first = true;
  const llm = { calls: [], async json(req) { this.calls.push(req); if (first) { first = false; throw Object.assign(new Error('Gemini 오류 429 (무료 사용량 한도)'), { code: 429, retryable: true }); } return req.schema.parse(KIDS); } };
  const v = await runAll(llm, fakeBrowser({ products: [{ id: 'p1', salesNum: 900 }, { id: 'p2', salesNum: 100 }] }));
  assert.equal(v.results[0].unfitReason, 'LLM_LIMIT');
  assert.match(v.results[0].reason[0], /사용량 한도/);
  assert.equal(v.recommendation.productId, 'p2');
});

test('D25 옵션 사이즈 목록: 키·몸무게가 적힌 옵션이 있으면 정보 없는 숫자 옵션(60, 61 …)은 뺀다', async () => {
  const { specFromSkus } = await import('../src/agent/judge.js');
  const skus = ['60', '61', '88', '170/88A(建议63-68kg)', '175/92A(建议68-74kg)', '180/100A(建议80-86kg)'].map((label) => ({ label }));
  const sp = specFromSkus(skus);
  assert.deepEqual(sp.variants[0].sizes.map((r) => r.label), ['170/88A', '175/92A', '180/100A']);
});

test('D26 옵션에 사이즈 정보가 있어 보였지만(建议拍大一码 등) 판정할 수 없으면 같은 페이지를 끝까지 다시 읽어 사이즈표 추출', async () => {
  const llm = fakeLlm([KIDS]);
  const browser = fakeBrowser({ products: [{ id: 'p1' }] });
  const calls = [];
  const full = await browser.detail({ url: 'https://item.taobao.com/item.htm?id=p1' });
  browser.detail = async (a) => {
    calls.push(Boolean(a.full));
    const skus = ['S【建议拍大一码】', 'M【建议拍大一码】'].map((label) => ({ label, soldOut: false }));
    return a.full ? { ...full, skus } : { images: [], skus, skuRich: true, blocked: false };
  };
  const v = await runAll(llm, browser);
  assert.deepEqual(calls, [false, true]);
  assert.equal(llm.calls.length, 1);
  assert.equal(v.recommendation.size, '120');
});

test('D27 페이지는 읽었는데 사이즈표·이미지가 없으면 "수집 실패"가 아니라 "사이즈 정보 없음"', async () => {
  const llm = fakeLlm([KIDS]);
  const browser = fakeBrowser({ products: [{ id: 'p1', salesNum: 900 }, { id: 'p2', salesNum: 100 }] });
  const detail = browser.detail;
  browser.detail = async (a) => (a.url.includes('p1') ? { images: [], skus: [{ label: 'S' }, { label: 'M' }], title: '某商品', blocked: false } : detail(a));
  const v = await runAll(llm, browser);
  assert.equal(v.results[0].unfitReason, 'SPEC_UNKNOWN');
  assert.match(v.results[0].reason[0], /사이즈표나 설명 이미지를 찾지 못했어요/);
});

test('D28 표처럼 보이는 이미지가 많으면 표다운 순서로 골라 페이지 순서로 보냄 (앞쪽 이미지도 검사)', async () => {
  const llm = fakeLlm([KIDS]);
  const imgs = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k'];
  const browser = fakeBrowser({ products: [{ id: 'p1' }], detail: { p1: { images: imgs, skus: ['S', 'M', 'L'].map((label) => ({ label, soldOut: false })) } } });
  const sc = { a: 2.9, b: 2.05, c: 2.5, d: 2.1, e: 0, f: 2.7, g: 2.6, h: 2.01, i: 2.02, j: 2.03, k: 2.3 };
  browser.chartLike = async (urls) => Object.fromEntries(urls.map((u) => [u, sc[u.split('_')[1][0]]]));
  await runAll(llm, browser);
  assert.deepEqual(browser.loaded[0].map((u) => u.split('_')[1][0]), ['a', 'b', 'c', 'd', 'f', 'g', 'j', 'k']);   // 10장 중 점수 높은 8장 (h·i 제외)
});

test('D29 글자 표 읽기: 가로·세로 표, 斤 단위, 호형 키, 단면(宽)/둘레(围)', async () => {
  const { parseTableText } = await import('../src/agent/tableText.js');
  const a = parseTableText('尺码 | 身高(cm) | 体重(斤) | 胸围 | 衣长\nM | 165-170 | 110-125 | 108 | 68\nL | 170-175 | 125-140 | 112 | 70\nXL | 175-180 | 140-155 | 116 | 72');
  assert.equal(a.weightUnit, '斤');
  assert.deepEqual(a.variants[0].sizes[1].weightKg, [62.5, 70]);
  assert.deepEqual(a.variants[0].sizes[2].chest, { value: 116, basis: '둘레' });
  const b = parseTableText('尺码 | S | M | L\n身高 | 160/84A | 165/88A | 170/92A\n胸宽 | 50 | 52 | 54');
  assert.deepEqual(b.variants[0].sizes.map((x) => [x.label, x.heightCm[0], x.chest.basis]), [['S', 160, '단면'], ['M', 165, '단면'], ['L', 170, '단면']]);
  const c = parseTableText('尺码 | 身高 | 体重\nM | 170 | 120\nL | 175 | 135');      // 단위 없음, 키 170에 120 → 斤으로 추정
  assert.equal(c.weightUnit, '추정_斤');
  assert.equal(parseTableText('商品参数\n面料 | 棉\n产地 | 中国'), null);
  const tr = judgeFit(a, { heightCm: 172, weightKg: 66 });
  assert.deepEqual([tr.verdict, tr.size], ['적합', 'L']);
});

test('D30 글자 표가 실측 치수뿐이면 이미지에서 키·몸무게 표를 더 찾아 함께 LLM에, 표가 여러 개면 키·몸무게 표 기준으로 합침', async () => {
  const { parseTableText } = await import('../src/agent/tableText.js');
  const two = parseTableText('尺码 | 衣长 | 胸围 | 肩宽\nM | 68 | 112 | 46\nL | 70 | 116 | 47\n\n尺码 | 身高 | 体重\nM | 170-175 | 60-68kg\nL | 175-180 | 68-75kg');
  assert.deepEqual([two.variants[0].sizes[1].label, two.variants[0].sizes[1].heightCm, two.variants[0].sizes[1].length, two.variants[0].sizes[1].chest.value], ['L', [175, 180], 70, 116]);
  const llm = fakeLlm([KIDS]);
  const browser = fakeBrowser({ products: [{ id: 'p1' }], detail: { p1: { images: ['a', 'size', 'b'] } } });
  const detail = browser.detail;
  browser.detail = async (a) => ({ ...(await detail(a)), sizeTableText: '尺码 | 衣长 | 胸围\n110 | 58 | 60\n120 | 63 | 64' });
  const v = await runAll(llm, browser);
  assert.equal(llm.calls.length, 1);
  assert.ok(llm.calls[0].images.length >= 1);
  assert.match(llm.calls[0].prompt, /권장 키·몸무게는 이미지의 표를 읽어/);
  assert.equal(v.recommendation.size, '120');
});
