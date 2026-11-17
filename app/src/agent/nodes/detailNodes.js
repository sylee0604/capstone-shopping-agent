// 상세 분석 단계 실제 노드: fetchDetail · selectSizeImages · extractSpec · validateSpec · judgeFit · writeRationale · analyzeFailure · finish
// API 절약: LLM은 extractSpec 한 곳에서만, 상품당 1회(검증 실패 시 +1회). 이미지 선별·판정·근거 문장은 코드로 한다.
import { ExtractSchema, EXTRACT_PROMPT, validateSpec } from '../spec.js';
import { parseTableText, hasFit } from '../tableText.js';
import { specStatus } from '../routes.js';
import { judgeFit, rationaleText, specFromSkus, judgeWanted } from '../judge.js';
import { NeedsLoginError } from './searchNodes.js';

const SIZE_WORDS = /尺码|尺寸|码数|尺碼|size|参考|身高|体重|胸围|衣长|裤长|裙长/i;
export const MAX_SIZE_IMAGES = 4;          // LLM에 보내는 이미지 수 (적을수록 빠르고 혼잡 오류도 덜 남)
export const MAX_SIZE_IMAGES_MANY = 8;     // 표처럼 보이는 이미지가 많을 때(5장 이상)는 작게 줄여 8장까지 한 번에 보냄

/** 사이즈표일 가능성이 높은 이미지 고르기 (코드). 한 번의 LLM 호출에 함께 넣어 LLM이 그중 사이즈표를 읽게 한다. */
export function pickSizeImages(images, max = MAX_SIZE_IMAGES) {
  const n = images.length;
  return images
    .map((im, i) => {
      let s = 0;
      if (SIZE_WORDS.test(`${im.alt} ${im.near}`)) s += 3;           // 주변 글자·대체 텍스트에 사이즈 관련 말
      const r = im.w && im.h ? im.h / im.w : 1;
      if (r < 0.25) s -= 2;                                          // 가로로 긴 띠 배너
      if (r >= 0.4 && r <= 2.5) s += 1;                              // 표 모양에 가까운 비율
      if (!im.gallery && n > 3 && i >= n * 0.3) s += 1;               // 사이즈표는 상세 설명 뒤쪽에 많음
      if (im.galleryLast) s += 2;                                     // 대표 사진 마지막 장에 사이즈표를 넣는 판매자가 많음
      return { url: im.url, i, s };
    })
    .sort((a, b) => b.s - a.s || b.i - a.i)
    .slice(0, max)
    .sort((a, b) => a.i - b.i)                                       // 원래 순서로 (이어진 표 대비)
    .map((x) => x.url);
}

// 옵션이 S/M/L 같은 글자 사이즈뿐인지 (숫자 사이즈·호형·키 정보가 없음)
const LETTER = /^(X{0,4}S|M|X{0,4}L|[2-6]XL|XXS|均码|F|FREE|ONE ?SIZE)$/i;
export function letterSizesOnly(skus = []) {
  const raw = skus.map((k) => String(k.label).trim());
  const letters = raw.filter((l) => LETTER.test(l.replace(/[\s(（].*$/, ''))).length;
  const numeric = raw.some((l) => /\d{2,3}|斤|身高|体重/.test(l));       // 숫자 사이즈·호형·괄호 속 키/몸무게 안내
  return letters >= 2 && !numeric;
}

const stableKey = (spec) => JSON.stringify(spec?.variants?.map((v) => v.sizes.map((s) => [s.label, s.heightCm, s.weightKg, s.chest?.value])) ?? null);

export function makeDetailNodes({ llm, browser }) {
  return {
    async fetchDetail(s) {
      const id = s.selectedId;
      const c = s.candidates.find((x) => x.id === id) ?? {};
      const platform = s.request.platform ?? 'taobao';
      let d = await browser.detail({ url: c.url, platform });
      if (d.blocked) throw new NeedsLoginError(platform);
      // 페이지가 옵션에 사이즈 정보가 있다고 보고 사이즈표·이미지를 건너뛰었는데, 옵션으로 판정할 수 없으면 같은 페이지를 끝까지 다시 읽는다
      if (d.skuRich) {
        const sp = specFromSkus(d.skus);
        if (!(sp && sp.variants[0].sizes.filter((r) => r.heightCm || r.weightKg).length >= 2)) d = { ...(await browser.detail({ url: c.url, platform, full: true })), reread: true };
      }
      // 옵션 이름만으로 판정할 수 있으면(키·몸무게 범위나 호형이 적혀 있음) 사이즈표 추출(LLM)을 건너뛴다
      const skuSpec = specFromSkus(d.skus);
      const usable = skuSpec && skuSpec.variants[0].sizes.filter((r) => r.heightCm || r.weightKg).length >= 2 ? skuSpec : null;
      // 열린 페이지가 고른 상품인지 확인 (상품 id 비교). 광고 카드는 주소에 id가 없어 열린 페이지의 id를 기록만 한다
      const idOf = (u) => (String(u || '').match(/[?&]id=(\d+)/) || [])[1] ?? null;
      const wantId = idOf(c.url), pageId = idOf(d.url);
      const pageMismatch = Boolean(wantId && pageId && wantId !== pageId);
      return {
        analyzed: [id],
        current: { productId: id, url: c.url, pageUrl: d.url ?? null, pageTitle: (d.title || '').slice(0, 60), pageMismatch, title: c.title, images: d.images, imageUrls: d.images.map((x) => x.url), skus: d.skus, sizeTableText: d.sizeTableText || '', extractAttempts: 0, errors: [], status: usable ? 'from_sku' : null, spec: usable, specSource: usable ? 'sku' : null },
        log: [{ node: 'fetchDetail', reread: Boolean(d.reread), skuSample: d.skus.slice(0, 3).map((k) => k.label), wantId, pageId, pageMismatch, images: d.images.length, skus: d.skus.length, sizeTable: Boolean(d.sizeTableText), sizeButton: d.sizeButton }],
      };
    },

    async selectSizeImages(s) {
      // 페이지의 글자 표에 권장 키·몸무게가 있으면 이미지는 보지 않는다. 실측 치수만 있으면 이미지에서 키·몸무게 표를 더 찾는다
      // (코드로 못 읽는 모양의 글자 표는 LLM이 글자만 읽는다)
      if (s.current.sizeTableText) {
        const ts = parseTableText(s.current.sizeTableText);
        if (!ts || hasFit(ts)) return { current: { ...s.current, sizeImages: [] } };
      }
      // 후보를 넉넉히 고른 뒤 표처럼 보이는지 LLM 없이 확인 (2 = 표, 1 = 표일 수도).
      // 옵션이 S/M/L뿐인 상품은 사이즈표가 없는 경우가 많아 '표일 수도'(글자 많은 홍보 이미지 등)는 보내지 않는다 → LLM 호출 없이 바로 '사이즈표 없음'
      // 판별은 LLM 없이 이 컴퓨터에서 하므로 상세 이미지를 거의 다(최대 40장) 검사한다 (사이즈표가 페이지 앞쪽에 있어도 놓치지 않게)
      const cands = pickSizeImages(s.current.images ?? [], 40);
      const look = browser.chartLike ? await browser.chartLike(cands) : Object.fromEntries(cands.map((u) => [u, 1]));
      const score = (u) => (look[u] === true ? 1 : +look[u] || 0);
      const level = (u) => Math.floor(score(u));
      // '표'가 여러 장이면 표다운 순서로 최대 4장 → 페이지 순서로 되돌려 보냄 (이어진 표 대비)
      // 이미지 주변 글자·대체 텍스트에 사이즈 관련 말(尺码 등)이 있으면 우선
      const near = Object.fromEntries((s.current.images ?? []).map((x) => [x.url, SIZE_WORDS.test(`${x.alt ?? ''} ${x.near ?? ''}`) ? 1 : 0]));
      const strict = cands.filter((u) => level(u) >= 2).sort((a, b) => (near[b] ?? 0) - (near[a] ?? 0) || score(b) - score(a));
      const maybe = cands.filter((u) => level(u) === 1);
      const letterOnly = letterSizesOnly(s.current.skus);
      const order = (u) => cands.indexOf(u);
      const pool = strict.length ? strict : letterOnly ? [] : maybe;
      // 글자 표가 이미 있으면(키·몸무게 표만 더 찾는 경우) 4장까지만 보내 응답을 가볍게
      const max = pool.length > MAX_SIZE_IMAGES && !s.current.sizeTableText ? MAX_SIZE_IMAGES_MANY : MAX_SIZE_IMAGES;
      const sizeImages = pool.slice(0, max).sort((a, b) => order(a) - order(b));
      const all = (s.current.images ?? []).map((x) => x.url);
      const pickedIdx = sizeImages.map((u) => all.indexOf(u) + 1);
      return { current: { ...s.current, sizeImages, checkedImages: cands.length, strictCount: strict.length, pickedIdx, letterOnly } };
    },

    async extractSpec(s) {
      const c = s.current;
      // 페이지의 사이즈표가 글자 표면 먼저 코드로 읽는다 (LLM 없음). 못 읽거나 검증에서 문제가 나면 LLM으로
      const tableSpec = c.sizeTableText ? parseTableText(c.sizeTableText) : null;
      if (tableSpec && !c.errors?.length && c.specSource !== 'table' && (hasFit(tableSpec) || !c.sizeImages?.length)) {
        return { current: { ...c, prevKey: null, spec: tableSpec, specSource: 'table', extractAttempts: c.extractAttempts + 1 } };
      }
      // 5장 이상이면 작게 줄여 보냄 (폭 800px·높이 2000px 안: 표 글자는 읽히고 응답은 덜 느려짐)
      const imgs = c.sizeImages ?? [];
      const images = imgs.length ? await browser.loadImages(imgs, imgs.length > MAX_SIZE_IMAGES ? { maxW: 800, maxH: 2000 } : undefined) : [];
      const tableNote = !c.sizeTableText ? '' : images.length
        ? `\n\n[상품 페이지의 사이즈표를 글자로 옮긴 것 — 실측 치수는 이 표를, 권장 키·몸무게는 이미지의 표를 읽어 같은 사이즈끼리 합쳐라]\n${c.sizeTableText}`
        : `\n\n[상품 페이지의 사이즈표를 글자로 옮긴 것 — 이미지 대신 이 표를 읽어라]\n${c.sizeTableText}`;
      const feedback = c.errors?.length
        ? `\n\n[이전 답변에서 발견된 문제]\n- ${c.errors.join('\n- ')}\n이미지를 다시 확인해 고쳐서 전체 JSON을 다시 출력하라. 원본이 실제로 그렇다면 그대로 두어도 된다.`
        : '';
      let spec = null;
      if (images.length || tableNote) {
        try {
          const r = await llm.json({ prompt: EXTRACT_PROMPT + tableNote + feedback, images, schema: ExtractSchema });
          spec = r.none ? null : r;
        } catch (e) {
          // 혼잡(503·429)·시간 초과는 실행을 멈추지 않고 이 상품만 '읽기 실패'로 → 다른 후보를 고르게 한다. 키 오류·형식 오류(진단 표시)는 멈춤
          if (!e.retryable) throw e;
          // LLM이 안 되면 글자 표에서 읽은 실측 치수라도 쓴다 (권장 키·몸무게가 없어 '경계'로 안내됨)
          if (tableSpec) return { current: { ...c, prevKey: null, spec: tableSpec, specSource: 'table', llmNote: `${e.code ?? ''}`, extractAttempts: c.extractAttempts + 1 } };
          return { current: { ...c, spec: null, llmFailed: `${e.code ?? ''} ${e.message}`.trim().slice(0, 120), llmLimit: e.code === 429, extractAttempts: c.extractAttempts + 1 } };
        }
      }
      return { current: { ...c, prevKey: stableKey(c.spec), spec, specSource: c.sizeTableText ? 'table_llm' : 'image', extractAttempts: c.extractAttempts + 1 } };
    },

    async validateSpec(s) {
      const c = s.current;
      const errors = c.spec ? validateSpec(c.spec) : [];
      const repeated = Boolean(c.spec) && c.prevKey === stableKey(c.spec);      // 다시 읽어도 같으면 원본 자체의 이상
      return { current: { ...c, errors, status: specStatus({ errors, extractAttempts: c.extractAttempts, repeated }) } };
    },

    async judgeFit(s) {
      const c = s.current, it = s.intent ?? {};
      // 사이즈표가 없으면 옵션 이름의 사이즈 표기(110cm, 建议身高 등)로 대신 판정
      const fromSku = c.specSource === 'sku' ? c.spec : !c.spec ? specFromSkus(c.skus) : null;
      const spec = c.spec ?? fromSku;
      let r;
      if (!c.imageUrls.length && !c.sizeTableText && !spec) r = c.skus?.length || c.pageTitle
        ? { verdict: '부적합', unfitReason: 'SPEC_UNKNOWN', reason: ['상세 페이지에서 사이즈표나 설명 이미지를 찾지 못했어요 (옵션에도 키·몸무게 정보 없음)'] }
        : { verdict: '부적합', unfitReason: 'FETCH_FAILED', reason: ['상세 페이지를 읽지 못했어요'] };
      else if (c.llmFailed && !spec && c.llmLimit) r = { verdict: '부적합', unfitReason: 'LLM_LIMIT', reason: ['LLM 무료 사용량 한도(429)에 걸려 사이즈표를 읽지 못했어요. 하루 한도는 한국 시간 오후 5시(서머타임 기간엔 4시)에 초기화돼요'] };
      else if (c.llmFailed && !spec) r = { verdict: '부적합', unfitReason: 'LLM_FAILED', reason: ['LLM 서버가 혼잡해 사이즈표를 읽지 못했어요. 다른 후보를 고르거나 잠시 뒤 다시 시도해 주세요'] };
      else if (!spec && c.checkedImages && !c.sizeImages?.length && c.letterOnly) r = { verdict: '부적합', unfitReason: 'SPEC_UNKNOWN', reason: [`사이즈표가 없어요 (옵션이 S/M/L 같은 글자 사이즈뿐이고, 이미지 ${c.checkedImages}장 중 표로 보이는 것도 없음)`] };
      else if (!spec && c.checkedImages && !c.sizeImages?.length) r = { verdict: '부적합', unfitReason: 'SPEC_UNKNOWN', reason: [`사이즈표가 없어요 (옵션에 사이즈 정보가 없고, 이미지 ${c.checkedImages}장 중 표로 보이는 것도 없음)`] };
      else {
        // "110 사이즈"처럼 사이즈를 직접 말했으면(키는 말하지 않음) 그 사이즈를 우선
        r = (it.heightFrom === 'sizeLabel' && judgeWanted(spec, it.sizeLabel, c.skus)) || judgeFit(spec, { heightCm: it.heightCm, weightKg: it.weightKg, ageGroup: it.ageGroup }, c.skus);
        if (fromSku) r = { ...r, reason: [c.specSource === 'sku' ? '상품 옵션에 적힌 사이즈 정보로 판정했어요' : '사이즈표가 없어 옵션의 사이즈 표기로 판정했어요', ...(r.reason ?? [])] };
      }
      return { results: [{ productId: c.productId, round: s.round, specStatus: fromSku ? 'from_sku' : c.status, ...r }], ...(fromSku ? { current: { ...c, spec: fromSku } } : {}) };
    },

    async analyzeFailure(s) {
      return { log: [{ node: 'analyzeFailure', reasons: s.results.filter((r) => r.round === s.round).map((r) => r.unfitReason) }] };
    },

    async writeRationale(s) {
      const r = s.results.at(-1), c = s.current;
      const table = c.spec?.variants?.[0]?.sizes?.map((x) => ({ label: x.label, heightCm: x.heightCm, weightKg: x.weightKg, length: x.length, chest: x.chest, waist: x.waist, shoulder: x.shoulder, sleeve: x.sleeve?.value ?? null })) ?? [];
      if (r.row?.fromSku && !table.some((t) => t.label === r.size)) table.push({ label: r.size, heightCm: r.row.heightCm, weightKg: null, fromSku: true });
      return { recommendation: { type: 'recommend', productId: r.productId, size: r.size, verdict: r.verdict, specStatus: r.specStatus, rationale: rationaleText(r, c.spec), table } };
    },

    async finish(s) {
      return s.recommendation ? { log: [{ node: 'finish' }] }
        : { recommendation: { type: s.results.length ? 'fallback' : 'none' }, log: [{ node: 'finish' }] };
    },
  };
}
