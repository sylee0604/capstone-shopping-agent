// 페이지의 사이즈표(HTML 표)를 글자로 옮긴 것을 LLM 없이 코드로 읽는다.
// 형식: 줄 = 표의 행, 칸은 " | "로 구분, 표와 표 사이는 빈 줄 (scrapers.js의 tableText)
// 읽을 수 없는 모양이면 null → 기존처럼 LLM에게 맡긴다.
import { SpecSchema } from './spec.js';

const COLS = [
  ['height', /身高/],
  ['weight', /体重/],
  ['chest', /胸围|胸宽|胸围宽/],
  ['length', /衣长|后中长|裤长|裙长|全长|前长/],
  ['waist', /腰围|腰宽/],
  ['hip', /臀围|臀宽/],
  ['shoulder', /肩宽/],
  ['sleeve', /袖长/],
  ['label', /尺码|尺寸|码数|号型|规格|^码$|size/i],
];
const keyOf = (h) => (COLS.find(([, re]) => re.test(h)) ?? [null])[0];

const nums = (s) => (String(s).replace(/,/g, '').match(/\d+(?:\.\d+)?/g) ?? []).map(Number);
function range(s) {
  const t = String(s ?? '').trim();
  if (!t || /^[-/—–~]$/.test(t)) return null;
  const hx = t.match(/^(\d{3})\s*\/\s*\d{2,3}/);           // 170/88A → 키 170
  if (hx) return [+hx[1], +hx[1]];
  const ns = nums(t);
  if (!ns.length) return null;
  if (ns.length === 1) return /以上|\+|≥/.test(t) ? [ns[0], null] : /以下|≤/.test(t) ? [0, ns[0]] : [ns[0], ns[0]];
  return [ns[0], ns[1]];
}
const num = (s) => { const ns = nums(s); return ns.length ? ns[0] : null; };

function rowsOf(block) {
  return block.split('\n').map((l) => l.split(' | ').map((c) => c.replace(/\s+/g, ' ').trim())).filter((r) => r.length >= 2);
}

/** @returns 스펙(SpecSchema) 또는 null */
export function parseTableText(text) {
  for (const block of String(text ?? '').split(/\n\s*\n/)) {
    let rows = rowsOf(block);
    if (rows.length < 3) continue;
    const known = (cells) => cells.filter((c) => keyOf(c)).length;
    // 세로 표(첫 열에 항목 이름)면 가로로 돌린다
    if (known(rows.map((r) => r[0])) >= 2 && known(rows[0]) < 2) {
      const w = Math.max(...rows.map((r) => r.length));
      rows = Array.from({ length: w }, (_, j) => rows.map((r) => r[j] ?? ''));
    }
    const head = rows[0];
    const cols = head.map(keyOf);
    if (!cols.includes('label')) cols[0] = cols[0] ?? 'label';
    const li = cols.indexOf('label');
    const has = (k) => cols.includes(k);
    if (li < 0 || !['height', 'weight', 'chest', 'length', 'waist'].some(has)) continue;

    const wHead = head[cols.indexOf('weight')] ?? '';
    const body = rows.slice(1).filter((r) => r[li] && !keyOf(r[li]));
    let sizes = body.map((r) => {
      const get = (k) => (has(k) ? r[cols.indexOf(k)] : null);
      const girth = (k) => {
        const v = num(get(k));
        return v == null ? null : { value: v, basis: /宽/.test(head[cols.indexOf(k)]) ? '단면' : '둘레' };
      };
      return {
        label: r[li], heightCm: range(get('height')), weightKg: range(get('weight')), ageYears: null,
        length: num(get('length')), chest: girth('chest'), waist: girth('waist'), hip: girth('hip'),
        shoulder: num(get('shoulder')), sleeve: num(get('sleeve')) == null ? null : { value: num(get('sleeve')), from: '불명' },
        extra: {},
      };
    }).filter((s) => s.label);
    if (sizes.length < 2) continue;

    // 몸무게 단위: 머리글·값에 斤/kg가 있으면 그대로, 없으면 키와 비교해 너무 무거우면(BMI 32 초과) 斤으로 본다
    let unit = '없음';
    if (has('weight')) {
      const wText = `${wHead} ${body.map((r) => r[cols.indexOf('weight')]).join(' ')}`;
      if (/斤/.test(wText)) unit = '斤';
      else if (/kg|公斤|KG/i.test(wText)) unit = 'kg';
      else {
        const s = sizes.find((x) => x.heightCm && x.weightKg);
        const bmi = s ? ((s.weightKg[0] + (s.weightKg[1] ?? s.weightKg[0])) / 2) / ((s.heightCm[0] / 100) ** 2) : 0;
        unit = bmi > 32 ? '추정_斤' : '추정_kg';
      }
      if (unit.includes('斤')) sizes = sizes.map((x) => ({ ...x, weightKg: x.weightKg && [x.weightKg[0] / 2, x.weightKg[1] == null ? null : x.weightKg[1] / 2] }));
    }
    const category = has('length') && /裤长/.test(head[cols.indexOf('length')]) ? '하의' : /裙长/.test(head.join('')) ? '원피스' : '상의';
    const out = SpecSchema.safeParse({ category, weightUnit: unit, variants: [{ name: null, fitHeightCm: null, sizes }], fitMatrix: null });
    if (out.success) return out.data;
  }
  return null;
}
