// 사이즈표 스펙: 스키마(../../스키마/schema.js v1.2와 같은 구조), 추출 프롬프트(POC와 동일), 검증 규칙(POC + 측정 기준 규칙)
// LLM 응답은 칸이 빠지는 경우가 있어 비어 있는 칸은 null로 채워 받는다 (구조는 v1.2 그대로).
import { z } from 'zod';

const n = (t) => t.nullable().default(null);
const Range = z.tuple([z.number(), z.number().nullable()]);
const Girth = z.object({ value: z.union([z.number(), z.tuple([z.number(), z.number()])]), basis: z.enum(['단면', '둘레', '불명']) });
const Sleeve = z.object({ value: z.number(), from: z.enum(['어깨', '목', '불명']) });

export const SizeRow = z.object({
  label: z.coerce.string(),
  heightCm: n(Range), weightKg: n(Range), ageYears: n(Range),
  length: n(z.number()), chest: n(Girth), waist: n(Girth), hip: n(Girth),
  shoulder: n(z.number()), sleeve: n(Sleeve),
  extra: z.record(z.string(), z.coerce.string()).default({}),
});
export const Variant = z.object({ name: n(z.string()), fitHeightCm: n(Range), sizes: z.array(SizeRow).min(1) });
export const FitMatrix = z.object({ heightCm: z.array(z.number()), weightKg: z.array(z.number()), cells: z.array(z.array(z.string().nullable())) });
export const SpecSchema = z.object({
  category: z.enum(['상의', '하의', '원피스']).catch('상의'),
  weightUnit: z.enum(['kg', '斤', '추정_kg', '추정_斤', '없음']).catch('없음'),
  variants: z.array(Variant).min(1),
  fitMatrix: n(FitMatrix),
});
// LLM이 형식을 조금 다르게 줄 때 받아 주는 정리 단계 (값은 바꾸지 않고 모양만 맞춤)
//  "160-170" → [160,170], 170 → [170,170], "170以上" → [170,null], "48" → 48, 가슴 48 → {value:48, basis:'불명'}
const toNum = (v) => {
  if (typeof v === 'number') return v;
  if (typeof v !== 'string') return v;
  const m = v.replace(/,/g, '').match(/-?\d+(?:\.\d+)?/);
  return m ? Number(m[0]) : null;
};
const toRange = (v) => {
  if (v == null || v === '' || v === '/' || v === '-') return null;
  if (typeof v === 'number') return [v, v];
  if (typeof v === 'string') {
    const ns = (v.replace(/,/g, '').match(/\d+(?:\.\d+)?/g) ?? []).map(Number);
    if (!ns.length) return null;
    if (ns.length === 1) return /以上|이상|\+/.test(v) ? [ns[0], null] : [ns[0], ns[0]];
    return [ns[0], ns[1]];
  }
  if (Array.isArray(v)) {
    const a = v.map((x) => (x == null ? null : toNum(x)));
    if (!a.length || a[0] == null) return null;
    return a.length === 1 ? [a[0], a[0]] : [a[0], a[1] ?? null];
  }
  if (typeof v === 'object' && ('min' in v || 'max' in v)) return [toNum(v.min), v.max == null ? null : toNum(v.max)];
  return v;
};
const toGirth = (v) => {
  if (v == null || v === '') return null;
  if (typeof v === 'number' || typeof v === 'string') { const x = toNum(v); return x == null ? null : { value: x, basis: '불명' }; }
  if (typeof v === 'object' && !Array.isArray(v)) {
    const val = Array.isArray(v.value) ? v.value.map(toNum) : toNum(v.value);
    return val == null ? null : { value: val, basis: ['단면', '둘레', '불명'].includes(v.basis) ? v.basis : '불명' };
  }
  return v;
};
const toSleeve = (v) => {
  if (v == null || v === '') return null;
  if (typeof v !== 'object') { const x = toNum(v); return x == null ? null : { value: x, from: '불명' }; }
  const x = toNum(v.value);
  return x == null ? null : { value: x, from: ['어깨', '목', '불명'].includes(v.from) ? v.from : '불명' };
};
export function normalizeRaw(raw) {
  let r = Array.isArray(raw) ? raw[0] : raw;
  if (!r || typeof r !== 'object' || r.none === true) return r;
  if (!r.variants && Array.isArray(r.sizes)) r = { ...r, variants: [{ name: null, fitHeightCm: null, sizes: r.sizes }] };
  if (!Array.isArray(r.variants)) return r;
  return {
    ...r,
    fitMatrix: r.fitMatrix && Array.isArray(r.fitMatrix.cells) ? r.fitMatrix : null,
    variants: r.variants.map((v) => ({
      name: v.name ?? null,
      fitHeightCm: toRange(v.fitHeightCm),
      sizes: (v.sizes ?? []).map((s) => ({
        ...s,
        label: String(s.label ?? s.size ?? ''),
        heightCm: toRange(s.heightCm), weightKg: toRange(s.weightKg), ageYears: toRange(s.ageYears),
        length: s.length == null ? null : toNum(s.length), shoulder: s.shoulder == null ? null : toNum(s.shoulder),
        chest: toGirth(s.chest), waist: toGirth(s.waist), hip: toGirth(s.hip), sleeve: toSleeve(s.sleeve),
        extra: Object.fromEntries(Object.entries(s.extra && typeof s.extra === 'object' ? s.extra : {}).map(([k, x]) => [k, String(x)])),
      })),
    })),
  };
}

// 여러 이미지 중 사이즈표가 없으면 {"none": true}
export const ExtractSchema = z.preprocess(normalizeRaw, z.union([z.object({ none: z.literal(true) }), SpecSchema]));

export const EXTRACT_PROMPT = `너는 중국 쇼핑몰(타오바오·티몰·1688) 의류 사이즈표 이미지를 구조화 데이터로 옮기는 추출기다.
이미지에 적힌 그대로 읽어서 아래 JSON 형식으로만 답하라. 설명 문장은 쓰지 마라.

{
  "category": "상의" | "하의" | "원피스",
  "weightUnit": "kg" | "斤" | "추정_kg" | "추정_斤" | "없음",
  "variants": [
    {
      "name": 표가 여러 개일 때 표 이름(예 "长款", "加长版 108CM"), 하나면 null,
      "fitHeightCm": 권장 키가 사이즈가 아니라 표(버전) 전체에 붙어 있으면 [최소,최대], 아니면 null,
      "sizes": [
        {
          "label": 사이즈 원문 그대로 (예 "110", "160/84A/S", "M/2尺", "W29"),
          "heightCm": [최소,최대] 또는 null,
          "weightKg": [최소,최대] 또는 null,
          "ageYears": [최소,최대] 또는 null,
          "length": 총장 숫자(衣长/裙长/裤长/总长) 또는 null,
          "chest": {"value": 숫자 또는 [최소,최대], "basis": "단면"|"둘레"|"불명"} 또는 null,
          "waist": 위와 같은 형식 또는 null,
          "hip": 위와 같은 형식 또는 null,
          "shoulder": 숫자 또는 null,
          "sleeve": {"value": 숫자, "from": "어깨"|"목"|"불명"} 또는 null,
          "extra": {"원문 머리글": "원문 값", ...}
        }
      ]
    }
  ],
  "fitMatrix": 키×몸무게→사이즈 매트릭스가 있으면 {"heightCm":[...], "weightKg":[...], "cells":[[...]]}, 없으면 null
}

규칙:
1. 斤(진)은 0.5kg이다. 斤 값은 2로 나눠 weightKg에 넣고 weightUnit은 "斤". 단위가 안 적혀 있으면 키 대비 몸무게가 자연스러운 쪽으로 판단해 "추정_斤" 또는 "추정_kg".
2. 범위 "100-110"은 [100,110], 단일값 "110"은 [110,110], 상한이 없으면("14岁以上") [14,null]. 개월(个月)은 12로 나눠 ageYears.
3. "36*2", "35×2" 표기는 value 36, basis "단면". 머리글이 "胸围1/2"이면 basis "단면". 그 외에는 값의 크기로 단면/둘레를 판단하고, 판단할 수 없으면 "불명". "平铺测量" 문구만으로 단면이라고 판단하지 마라.
4. 连肩袖长, 또는 袖长인데 값이 목 뒤 중심부터 잰 화장 수준이면 sleeve.from "목", 어깨부터면 "어깨".
5. 기본 칸(키, 몸무게, 나이, 총장, 가슴, 허리, 엉덩이, 어깨, 소매)이 아닌 치수(下摆, 袖口, 脚口, 裤脚, 档深, 前档, 后档, 股下, 大腿围, 后中长, 充绒量 등)는 extra에 원문 머리글과 원문 값 그대로 넣는다.
6. 사이즈가 가로로 나열된 표도 사이즈별로 나눠 적는다. 권장 키·몸무게 표가 따로 있으면 사이즈 라벨로 합친다.
7. 값이 "/", "-", 빈칸이면 null. 판매자 실수로 보여도 고치지 말고 적힌 그대로 적는다.
8. 길이 버전(小个子/常规款/高个子 등)이 열로 나열된 표는 버전별 variants로 나누고, 각 버전의 length에 그 열의 값을 넣는다.
9. 총장 머리글이 둘 이상이면(예: 衣长과 裙长이 함께 있음) length는 null로 두고 둘 다 extra에 넣는다.
10. 치수가 아닌 속성 칸(备注, 是否开裆 등)은 기록하지 않는다.
11. 이미지가 여러 장이면 사이즈표가 있는 이미지만 읽는다. 사이즈표가 여러 장에 이어져 있으면 합친다. 사이즈표가 하나도 없으면 {"none": true}만 출력한다.`;

export function toCircumference(g) {
  if (!g) return null;
  const f = (x) => (g.basis === '단면' ? x * 2 : x);
  return Array.isArray(g.value) ? g.value.map(f) : f(g.value);
}
const first = (v) => (Array.isArray(v) ? v[0] : v);
const mid = (r) => (r ? (r[1] == null ? r[0] : (r[0] + r[1]) / 2) : null);

/** 검증 규칙 (결정적 코드). 오류 문장 목록을 돌려준다. */
export function validateSpec(spec) {
  const errs = [];
  if (!spec?.variants?.length) return ['사이즈표 형식이 비어 있음'];
  spec.variants.forEach((v, vi) => {
    const sizes = v.sizes;
    const labels = sizes.map((s) => s.label);
    if (new Set(labels).size !== labels.length) errs.push(`표 ${vi + 1}: 사이즈 라벨 중복 ${JSON.stringify(labels)} (원본이 그런지 다시 확인)`);
    for (const f of ['length', 'shoulder']) {
      const seq = sizes.map((s) => s[f]).filter((x) => typeof x === 'number');
      if (seq.some((b, i) => i && b < seq[i - 1])) errs.push(`표 ${vi + 1}: ${f} 값이 사이즈가 커지는데 줄어듦 ${JSON.stringify(seq)} (원본이 그런지 다시 확인)`);
    }
    for (const f of ['chest', 'waist', 'hip']) {
      const seq = sizes.map((s) => s[f] && first(s[f].value)).filter((x) => typeof x === 'number');
      if (seq.some((b, i) => i && b < seq[i - 1])) errs.push(`표 ${vi + 1}: ${f} 값이 사이즈가 커지는데 줄어듦 ${JSON.stringify(seq)} (원본이 그런지 다시 확인)`);
    }
    for (const s of sizes) {
      const h = mid(s.heightCm), w = mid(s.weightKg);
      if (h && w) {
        const bmi = w / (h / 100) ** 2;
        if (bmi > 32 || bmi < 10) { errs.push(`사이즈 ${s.label}: 키 ${h}cm 대비 몸무게 ${w}kg은 비현실적 (BMI ${bmi.toFixed(1)}) → 斤/kg 단위 확인`); break; }
      }
    }
    // 측정 기준 규칙 (테스트셋 오류 분석으로 추가): 둘레로 읽은 가슴이 키 대비 너무 작으면 단면일 가능성
    for (const s of sizes) {
      const ref = mid(s.heightCm) ?? mid(v.fitHeightCm) ?? (Number(s.label) >= 70 && Number(s.label) <= 190 ? Number(s.label) : null);
      const c = s.chest?.basis === '둘레' ? first(s.chest.value) : null;
      if (ref && c && c < ref * 0.45) { errs.push(`사이즈 ${s.label}: 가슴 둘레 ${c}cm는 키 ${ref}cm 대비 너무 작음 → 단면(한쪽 폭) 값인지 확인`); break; }
    }
  });
  return errs;
}
