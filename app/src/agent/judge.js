// 적합도 판정 (결정적 코드, LLM 없음): 사이즈표 + 키·몸무게 + 재고 → 적합 / 경계 / 부적합
// 경계: 키·몸무게 중 하나만 맞거나 범위 끝에서 조금 벗어남(키 3cm, 몸무게 2kg 이내), 또는 권장 키·몸무게가 없는 표
const TOL = { h: 3, w: 2 };
const norm = (s) => String(s ?? '').replace(/\s+/g, '').toUpperCase();
const inRange = (x, r, tol = 0) => r != null && x != null && x >= r[0] - tol && (r[1] == null || x <= r[1] + tol);
const fmt = (r, unit) => (r ? (r[1] == null ? `${r[0]}${unit} 이상` : r[0] === r[1] ? `${r[0]}${unit}` : `${r[0]}~${r[1]}${unit}`) : null);

/** SKU 목록에서 사이즈 라벨의 재고 상태: true(있음) / false(품절) / null(SKU 정보로 확인 못 함) */
export function stockOf(label, skus = []) {
  if (!skus.length) return null;
  const L = norm(label);
  const hit = skus.find((k) => norm(k.label) === L) ?? skus.find((k) => { const K = norm(k.label); return K.includes(L) || L.includes(K); });
  return hit ? !hit.soldOut : null;
}

/**
 * @param spec     추출된 사이즈표 (SpecSchema)
 * @param body     { heightCm, weightKg, ageGroup }
 * @param skus     [{ label, soldOut }]
 * @returns { verdict, size, unfitReason?, reason: [근거 문장], row? }
 */
export function judgeFit(spec, body = {}, skus = []) {
  if (!spec?.variants?.length) return { verdict: '부적합', unfitReason: 'SPEC_UNKNOWN', reason: ['사이즈표를 찾지 못했어요'] };
  const { heightCm: h, weightKg: w } = body;

  // 키×몸무게 매트릭스: 키·몸무게가 표 범위 안(±2)일 때만 가장 가까운 칸을 쓴다. 범위 밖이면 아래 사이즈별 규칙으로
  if (spec.fitMatrix && h != null && w != null) {
    const m = spec.fitMatrix;
    const inside = (arr, x) => arr.length && x >= Math.min(...arr) - 2 && x <= Math.max(...arr) + 2;
    if (inside(m.heightCm, h) && inside(m.weightKg, w)) {
      const up = (arr, x) => { const i = arr.findIndex((v) => v >= x - 2); return i < 0 ? arr.length - 1 : i; };   // 2 이내로 넘으면 그 칸, 더 크면 다음(큰) 칸
      const label = m.cells[up(m.heightCm, h)]?.[up(m.weightKg, w)];
      if (label) return withStock({ verdict: '적합', size: label, reason: [`키 ${h}cm·몸무게 ${w}kg에 해당하는 칸이 ${label} 사이즈예요`] }, skus);
    }
  }

  // 길이 버전이 여러 개면 키에 맞는 버전, 없으면 첫 번째 표
  const variant = spec.variants.find((v) => inRange(h, v.fitHeightCm)) ?? spec.variants[0];
  const rows = mergeHaoxing(variant.sizes.map((s) => ({ ...s, heightCm: s.heightCm ?? variant.fitHeightCm })), skus);

  // 중국 호형(号型) 표기처럼 사이즈마다 키가 한 값(175/96A → 키 175)인 표: 키 이상인 가장 가까운 사이즈로 (179 → 180)
  const point = rows.length && rows.every((s) => s.heightCm && s.heightCm[0] === s.heightCm[1]);
  if (point && h != null) {
    const sorted = [...rows].sort((a, b) => a.heightCm[0] - b.heightCm[0] || (a.weightKg?.[0] ?? 0) - (b.weightKg?.[0] ?? 0));
    const fitsW = (s) => w == null || !s.weightKg || w <= s.weightKg[0] + 3;
    const inStock = (s) => stockOf(s.label, skus) !== false;
    const cand = sorted.filter((s) => s.heightCm[0] >= h - 2 && fitsW(s));
    const pick = cand.find(inStock);
    if (!pick && cand.length) return { verdict: '부적합', unfitReason: 'SIZE_SOLD_OUT', size: cand[0].label, reason: [`맞는 사이즈(${cand.map((x) => x.label).join(', ')})가 모두 품절이에요`] };
    if (pick) {
      const gap = pick.heightCm[0] - h;
      const reason = [`키 ${h}cm → ${pick.label}(기준 키 ${pick.heightCm[0]}cm)가 가장 가까운 큰 사이즈예요`];
      if (w != null && pick.weightKg) reason.push(`몸무게 ${w}kg → 기준 ${pick.weightKg[0]}kg${w > pick.weightKg[0] ? ' 보다 조금 무거움' : ' 이하'}`);
      return { verdict: gap <= 5 ? '적합' : '경계', size: pick.label, row: pick, stock: stockOf(pick.label, skus), reason: gap > 5 ? [...reason, `기준 키보다 ${gap}cm 커서 클 수 있어요`] : reason };
    }
    const top = sorted.at(-1);
    if (h - top.heightCm[0] <= 5) return { verdict: '경계', size: top.label, row: top, stock: stockOf(top.label, skus), reason: [`가장 큰 사이즈 ${top.label}(기준 키 ${top.heightCm[0]}cm)도 키 ${h}cm보다 작아요. 작을 수 있어요`] };
    return { verdict: '부적합', unfitReason: 'SIZE_OUT_OF_RANGE', reason: [`가장 큰 사이즈(${top.label})도 키 ${h}cm보다 많이 작아요`] };
  }
  const hasRanges = rows.some((s) => s.heightCm || s.weightKg);

  if (!hasRanges) {
    // 아동복 숫자 라벨(110, 120…)은 키 기준 표기 → 키 이상인 가장 작은 라벨
    const numeric = rows.filter((s) => /^\d{2,3}$/.test(s.label.trim()) && +s.label >= 70 && +s.label <= 170);
    if (body.ageGroup === '아동' && h != null && numeric.length) {
      const pick = numeric.filter((s) => +s.label >= h).sort((a, b) => a.label - b.label)[0];
      if (!pick) return { verdict: '부적합', unfitReason: 'SIZE_OUT_OF_RANGE', reason: [`가장 큰 사이즈(${numeric.at(-1).label})도 키 ${h}cm보다 작아요`] };
      const gap = +pick.label - h;
      return withStock({ verdict: gap <= 10 ? '적합' : '경계', size: pick.label, row: pick, reason: [`아동복 사이즈 ${pick.label}은 키 ${pick.label}cm 기준 표기예요 (현재 키 ${h}cm${gap > 10 ? ', 많이 클 수 있음' : ''})`] }, skus);
    }
    return { verdict: '경계', size: null, reason: ['이 사이즈표에는 권장 키·몸무게가 없어요. 아래 실측 치수를 평소 옷과 비교해 주세요'] };
  }

  const score = (s) => ({ hOk: inRange(h, s.heightCm), wOk: inRange(w, s.weightKg), hNear: inRange(h, s.heightCm, TOL.h), wNear: inRange(w, s.weightKg, TOL.w) });
  const scored = rows.map((s) => ({ s, ...score(s) }));
  const both = (x) => (h == null || !x.s.heightCm || x.hOk) && (w == null || !x.s.weightKg || x.wOk) && (x.hOk || x.wOk);
  const fit = scored.filter(both);
  const near = scored.filter((x) => !both(x) && (x.hOk || x.wOk || x.hNear || x.wNear));

  const reasonOf = (x) => [
    x.s.heightCm && h != null ? `키 ${h}cm → 권장 키 ${fmt(x.s.heightCm, 'cm')}${x.hOk ? ' 안' : ' 밖'}` : null,
    x.s.weightKg && w != null ? `몸무게 ${w}kg → 권장 ${fmt(x.s.weightKg, 'kg')}${x.wOk ? ' 안' : ' 밖'}` : null,
  ].filter(Boolean);

  // 맞는 사이즈 중 재고가 있는 가장 작은 것 → 없으면 경계 후보
  for (const [list, verdict] of [[fit, '적합'], [near, '경계']]) {
    if (!list.length) continue;
    const inStock = list.filter((x) => stockOf(x.s.label, skus) !== false);
    if (!inStock.length) return { verdict: '부적합', unfitReason: 'SIZE_SOLD_OUT', size: list[0].s.label, reason: [`맞는 사이즈(${list.map((x) => x.s.label).join(', ')})가 모두 품절이에요`] };
    const x = inStock[0];
    return { verdict, size: x.s.label, row: x.s, stock: stockOf(x.s.label, skus), reason: reasonOf(x) };
  }
  return { verdict: '부적합', unfitReason: 'SIZE_OUT_OF_RANGE', reason: [`키 ${h ?? '?'}cm${w != null ? `·몸무게 ${w}kg` : ''}에 맞는 사이즈가 없어요`] };
}

// SKU 옵션에 호형(180/100A 등)이 있는데 표에 빠진 사이즈는 옵션에서 키를 읽어 보탠다 (표가 잘려 읽힌 경우 대비)
const HAOXING = /(\d{3})\s*\/\s*(\d{2,3})\s*[ABYC]?/i;
export function mergeHaoxing(rows, skus = []) {
  const have = new Set(rows.map((r) => norm(r.label)));
  const add = [];
  for (const k of skus) {
    const m = String(k.label).match(HAOXING);
    if (!m || [...have].some((x) => x.includes(`${m[1]}/${m[2]}`))) continue;
    have.add(norm(k.label));
    add.push({ label: `${m[1]}/${m[2]}A`, heightCm: [+m[1], +m[1]], weightKg: null, chest: { value: +m[2], basis: '둘레' }, fromSku: true });
  }
  // 표의 행도 라벨이 호형이면 키를 라벨에서 채움
  const filled = rows.map((r) => { const m = String(r.label).match(HAOXING); return m && !r.heightCm ? { ...r, heightCm: [+m[1], +m[1]] } : r; });
  return add.length && filled.every((r) => r.heightCm && r.heightCm[0] === r.heightCm[1]) ? [...filled, ...add] : filled;
}

function withStock(r, skus) {
  const st = stockOf(r.size, skus);
  if (st === false) return { verdict: '부적합', unfitReason: 'SIZE_SOLD_OUT', size: r.size, reason: [`${r.size} 사이즈가 품절이에요`] };
  return { ...r, stock: st };
}

/** 판정 근거 문장 (LLM 대신 템플릿: API 호출을 줄이고, 판정에 없는 내용이 섞이지 않게) */
export function rationaleText(r, spec) {
  if (!r) return '';
  const lines = [...(r.reason ?? [])];
  if (r.row) {
    const d = [];
    if (r.row.length) d.push(`총장 ${r.row.length}cm`);
    if (r.row.chest) d.push(`가슴 ${r.row.chest.basis === '단면' ? `단면 ${r.row.chest.value}cm(둘레 약 ${[].concat(r.row.chest.value)[0] * 2}cm)` : `${r.row.chest.value}cm`}`);
    if (r.row.waist) d.push(`허리 ${r.row.waist.basis === '단면' ? `단면 ${r.row.waist.value}cm` : `${r.row.waist.value}cm`}`);
    if (d.length) lines.push(`${r.size} 실측: ${d.join(', ')}`);
  }
  if (r.stock === true) lines.push(`${r.size} 사이즈 재고 있음`);
  else if (r.stock === null && r.size) lines.push('재고는 상품 페이지에서 확인해 주세요');
  if (spec?.weightUnit?.includes('斤')) lines.push('표의 몸무게는 斤(0.5kg) 단위라 kg으로 바꿔 비교했어요');
  return lines.join(' · ');
}
