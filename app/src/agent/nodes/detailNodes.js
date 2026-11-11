// 상세 분석 단계 실제 노드: fetchDetail · selectSizeImages · extractSpec · validateSpec · judgeFit · writeRationale · analyzeFailure · finish
// API 절약: LLM은 extractSpec 한 곳에서만, 상품당 1회(검증 실패 시 +1회). 이미지 선별·판정·근거 문장은 코드로 한다.
import { ExtractSchema, EXTRACT_PROMPT, validateSpec } from '../spec.js';
import { specStatus } from '../routes.js';
import { judgeFit, rationaleText } from '../judge.js';
import { NeedsLoginError } from './searchNodes.js';

const SIZE_WORDS = /尺码|尺寸|码数|尺碼|size|参考|身高|体重|胸围|衣长|裤长|裙长/i;
export const MAX_SIZE_IMAGES = 5;

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
      if (n > 3 && i >= n * 0.3) s += 1;                             // 사이즈표는 상세 설명 뒤쪽에 많음
      return { url: im.url, i, s };
    })
    .sort((a, b) => b.s - a.s || b.i - a.i)
    .slice(0, max)
    .sort((a, b) => a.i - b.i)                                       // 원래 순서로 (이어진 표 대비)
    .map((x) => x.url);
}

const stableKey = (spec) => JSON.stringify(spec?.variants?.map((v) => v.sizes.map((s) => [s.label, s.heightCm, s.weightKg, s.chest?.value])) ?? null);

export function makeDetailNodes({ llm, browser }) {
  return {
    async fetchDetail(s) {
      const id = s.selectedId;
      const c = s.candidates.find((x) => x.id === id) ?? {};
      const platform = s.request.platform ?? 'taobao';
      const d = await browser.detail({ url: c.url, platform });
      if (d.blocked) throw new NeedsLoginError(platform);
      return {
        analyzed: [id],
        current: { productId: id, url: c.url, title: c.title, images: d.images, imageUrls: d.images.map((x) => x.url), skus: d.skus, sizeTableText: d.sizeTableText || '', extractAttempts: 0, errors: [], status: null, spec: null },
        log: [{ node: 'fetchDetail', images: d.images.length, skus: d.skus.length, sizeTable: Boolean(d.sizeTableText), sizeButton: d.sizeButton }],
      };
    },

    async selectSizeImages(s) {
      // 페이지에서 사이즈표를 글자로 읽었으면 이미지는 보내지 않는다 (더 정확하고 토큰도 적음)
      return { current: { ...s.current, sizeImages: s.current.sizeTableText ? [] : pickSizeImages(s.current.images ?? []) } };
    },

    async extractSpec(s) {
      const c = s.current;
      const images = c.sizeTableText ? [] : await browser.loadImages(c.sizeImages);
      const tableNote = c.sizeTableText ? `\n\n[상품 페이지의 사이즈표를 글자로 옮긴 것 — 이미지 대신 이 표를 읽어라]\n${c.sizeTableText}` : '';
      const feedback = c.errors?.length
        ? `\n\n[이전 답변에서 발견된 문제]\n- ${c.errors.join('\n- ')}\n이미지를 다시 확인해 고쳐서 전체 JSON을 다시 출력하라. 원본이 실제로 그렇다면 그대로 두어도 된다.`
        : '';
      let spec = null;
      if (images.length || tableNote) {
        const r = await llm.json({ prompt: EXTRACT_PROMPT + tableNote + feedback, images, schema: ExtractSchema });
        spec = r.none ? null : r;
      }
      return { current: { ...c, prevKey: stableKey(c.spec), spec, extractAttempts: c.extractAttempts + 1 } };
    },

    async validateSpec(s) {
      const c = s.current;
      const errors = c.spec ? validateSpec(c.spec) : [];
      const repeated = Boolean(c.spec) && c.prevKey === stableKey(c.spec);      // 다시 읽어도 같으면 원본 자체의 이상
      return { current: { ...c, errors, status: specStatus({ errors, extractAttempts: c.extractAttempts, repeated }) } };
    },

    async judgeFit(s) {
      const c = s.current, it = s.intent ?? {};
      let r;
      if (!c.imageUrls.length && !c.sizeTableText) r = { verdict: '부적합', unfitReason: 'FETCH_FAILED', reason: ['상세 페이지 이미지를 읽지 못했어요'] };
      else r = judgeFit(c.spec, { heightCm: it.heightCm, weightKg: it.weightKg, ageGroup: it.ageGroup }, c.skus);
      return { results: [{ productId: c.productId, round: s.round, specStatus: c.status, ...r }] };
    },

    async analyzeFailure(s) {
      return { log: [{ node: 'analyzeFailure', reasons: s.results.filter((r) => r.round === s.round).map((r) => r.unfitReason) }] };
    },

    async writeRationale(s) {
      const r = s.results.at(-1), c = s.current;
      const table = c.spec?.variants?.[0]?.sizes?.map((x) => ({ label: x.label, heightCm: x.heightCm, weightKg: x.weightKg })) ?? [];
      if (r.row?.fromSku && !table.some((t) => t.label === r.size)) table.push({ label: r.size, heightCm: r.row.heightCm, weightKg: null, fromSku: true });
      return { recommendation: { type: 'recommend', productId: r.productId, size: r.size, verdict: r.verdict, specStatus: r.specStatus, rationale: rationaleText(r, c.spec), table } };
    },

    async finish(s) {
      return s.recommendation ? { log: [{ node: 'finish' }] }
        : { recommendation: { type: s.results.length ? 'fallback' : 'none' }, log: [{ node: 'finish' }] };
    },
  };
}
