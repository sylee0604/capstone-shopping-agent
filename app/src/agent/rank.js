// 후보 선별 (결정적 코드): 예산 필터 → 판매량·검색어 일치도 점수 → 상위 N개
// 요청 계절과 맞지 않는 계절만 적힌 상품명은 점수를 깎는다 (예: 봄 요청인데 "秋冬")
const SEASON_ZH = { 봄: '春', 여름: '夏', 가을: '秋', 겨울: '冬' };
export function seasonMismatch(title = '', season) {
  const want = season === '봄가을' ? ['春', '秋'] : SEASON_ZH[season] ? [SEASON_ZH[season]] : null;
  if (!want) return false;
  const has = ['春', '夏', '秋', '冬'].filter((c) => title.includes(c) && !/四季/.test(title));
  return has.length > 0 && !has.some((c) => want.includes(c));
}

export function rankProducts(pool, { budgetKrw = null, query = '', rate = 190, n = 3, season = null } = {}) {
  const withKrw = pool.map((p) => ({ ...p, priceKrw: p.priceCny != null ? Math.round(p.priceCny * rate) : null }));
  const inBudget = budgetKrw ? withKrw.filter((p) => p.priceKrw != null && p.priceKrw <= budgetKrw) : withKrw;
  // 예산 안에 상품이 없으면 예산 초과 상품이라도 보여주되 표시해 둔다
  const base = inBudget.length ? inBudget : withKrw.map((p) => ({ ...p, overBudget: Boolean(budgetKrw) }));

  const tokens = query.split(/\s+/).filter((t) => t && !['女装', '男装', '女童', '男童', '童装', '男女同款'].includes(t));
  const maxSales = Math.max(1, ...base.map((p) => p.salesNum || 0));
  const score = (p) => {
    const sales = Math.log1p(p.salesNum || 0) / Math.log1p(maxSales);        // 판매량 (로그 스케일)
    const match = tokens.length ? tokens.filter((t) => p.titleZh?.includes(t)).length / tokens.length : 0;
    return 0.6 * sales + 0.4 * match - (p.priceCny == null ? 0.2 : 0) - (seasonMismatch(p.titleZh, season) ? 0.5 : 0);   // 가격 못 읽음·계절 불일치는 뒤로
  };
  return base.map((p) => ({ ...p, score: Math.round(score(p) * 1000) / 1000 }))
    .sort((a, b) => b.score - a.score)
    .slice(0, n);
}
