// 검색 단계 실제 노드: parseIntent · askUser · search · reformulateQuery · rankCandidates
// LLM은 의도 파악(1회)과 검색어 재구성(준비된 검색어를 다 쓴 경우에만)에만 쓴다.
import { z } from 'zod';
import { parseIntent, applyAnswer } from '../intent.js';
import { rankProducts } from '../rank.js';
import { LIMITS } from '../state.js';

const QueriesSchema = z.object({ queries: z.array(z.string().min(1)).min(1).max(3) });

const REASON_KO = { SIZE_OUT_OF_RANGE: '맞는 사이즈 없음', SIZE_SOLD_OUT: '맞는 사이즈 품절', SPEC_UNKNOWN: '사이즈 정보 없음', CONDITION_MISMATCH: '예산·소재 불일치', FETCH_FAILED: '상세 페이지 수집 실패' };

export class NeedsLoginError extends Error {
  constructor(platform) { super(`${platform === '1688' ? '1688' : '타오바오'} 로그인 또는 보안 확인이 필요해요. 열린 탭에서 로그인한 뒤 "이어서 하기"를 눌러 주세요.`); this.name = 'NeedsLoginError'; }
}

const nextQuery = (s) => (s.intent?.queriesZh ?? []).find((q) => !s.usedQueries.includes(q));

/** 준비된 검색어를 다 썼을 때 LLM에게 새 검색어를 받는다 */
export async function suggestQueries(llm, s) {
  const it = s.intent ?? {};
  const fails = s.results.filter((r) => r.round === s.round).map((r) => REASON_KO[r.unfitReason] ?? r.verdict);
  const { queries } = await llm.json({
    system: '너는 타오바오 검색어를 만드는 도구다. JSON만 출력한다.',
    prompt: `사용자 조건: ${JSON.stringify({ 대상: [it.ageGroup, it.gender], 품목: it.item ?? it.category, 계절: it.season, 소재: it.materials, 색상: it.colors, 스타일: it.styles, 키: it.heightCm, 예산원: it.budgetKrw })}
이미 써 본 검색어: ${JSON.stringify(s.usedQueries)}
${fails.length ? `앞 후보들이 맞지 않은 이유: ${fails.join(', ')}` : '앞 검색어로는 결과가 없었다.'}
다른 상품이 나오도록 이미 쓴 것과 겹치지 않는 중국어 검색어를 1~2개 만들어라. 동의어·상위 품목·덜 구체적인 표현을 써 본다.
형식: {"queries": ["...", "..."]}`,
    schema: QueriesSchema,
  });
  return queries.map((q) => q.trim()).filter((q) => q && !s.usedQueries.includes(q));
}

/**
 * @param llm      makeLlm() 결과
 * @param browser  makeChromeBrowser() 결과 또는 테스트용 가짜 { search, cnyToKrw, translate }
 */
export function makeSearchNodes({ llm, browser, limits = LIMITS }) {
  return {
    async parseIntent(s) {
      const intent = await parseIntent(llm, s.request.query, s.request.profile);
      return { intent, log: [{ node: 'parseIntent', intent }] };
    },

    async askUser(s) {
      return { askedUser: true, intent: applyAnswer(s.intent, s.userAnswer ?? {}) };
    },

    async search(s) {
      const query = nextQuery(s);
      if (!query) return { searchAttempts: s.searchAttempts + 1, candidates: [] };
      const platform = s.request.platform ?? 'taobao';
      const { products, blocked } = await browser.search({ platform, query });
      if (blocked) throw new NeedsLoginError(platform);
      const fresh = products.filter((p) => !s.analyzed.includes(p.id));
      return { searchAttempts: s.searchAttempts + 1, usedQueries: [query], candidates: fresh, log: [{ node: 'search', query, found: products.length, fresh: fresh.length }] };
    },

    async reformulateQuery(s) {
      const exhausted = s.candidates.length > 0;                  // 후보를 다 봤는데 맞는 게 없어서 온 경우
      const round = exhausted ? { round: s.round + 1, researchCount: s.researchCount + 1, searchAttempts: 0, candidates: [] } : {};
      if (nextQuery(s)) return round;                             // 준비된 검색어(더 일반적인 표현)가 남아 있으면 그걸로
      const more = await suggestQueries(llm, s);
      return { ...round, intent: { ...s.intent, queriesZh: [...(s.intent?.queriesZh ?? []), ...more] }, log: [{ node: 'reformulateQuery', added: more }] };
    },

    async rankCandidates(s) {
      const rate = await browser.cnyToKrw();
      const pool = s.candidates.filter((c) => !s.analyzed.includes(c.id));
      const top = rankProducts(pool, { budgetKrw: s.intent?.budgetKrw, query: s.usedQueries.at(-1) ?? '', rate, n: limits.maxCandidates });
      const titles = await browser.translate(top.map((c) => c.titleZh));
      return { candidates: top.map((c, i) => ({ ...c, title: titles[i] || c.titleZh })) };
    },
  };
}
