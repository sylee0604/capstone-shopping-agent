// 사이즈표 스펙 추출 스키마 v1.2 (2026-10-05)
// 근거: 사이즈표 이미지 25장 분석 + 정답 라벨 5장 작성 결과
import { z } from 'zod';

// 둘레 개념이 있는 치수(가슴·허리·엉덩이)는 값과 측정 기준을 함께 기록
//  - '36*2', '35×2', '胸围1/2' 표기 → 단면 값(36, 35)과 basis '단면'
//  - 판정 코드에서는 toCircumference()로 항상 둘레로 변환해 비교
export const Girth = z.object({
  value: z.union([z.number(), z.tuple([z.number(), z.number()])]), // 52 또는 신축 범위 [74, 84]
  basis: z.enum(['단면', '둘레', '불명']),
});

// 소매는 어깨부터 잰 값과 화장(목 뒤 중심~소매 끝, 连肩袖长 등)을 구분
export const Sleeve = z.object({
  value: z.number(),
  from: z.enum(['어깨', '목', '불명']),
});

const Range = z.tuple([z.number(), z.number().nullable()]); // 단일값 110 → [110, 110], '14岁以上' → [14, null]

export const SizeRow = z.object({
  label: z.string(),               // 원문 그대로: "110", "160/84A/S", "M/2尺", "W29"
  heightCm: Range.nullable(),
  weightKg: Range.nullable(),      // 斤이면 ÷2 해서 저장 (원래 단위는 weightUnit에 기록)
  ageYears: Range.nullable(),      // 개월은 ÷12
  length: z.number().nullable(),   // 衣长 / 裙长 / 裤长 / 总长
  chest: Girth.nullable(),
  waist: Girth.nullable(),
  hip: Girth.nullable(),
  shoulder: z.number().nullable(),
  sleeve: Sleeve.nullable(),
  extra: z.record(z.string(), z.string()), // 기본 칸이 아닌 치수: 원문 머리글 → 원문 값 (下摆, 脚口, 档深, 大腿围, 后中长 …)
});

export const Variant = z.object({
  name: z.string().nullable(),      // 표가 여러 개일 때 이름: "长款", "加长版 108CM" …
  fitHeightCm: Range.nullable(),    // 권장 키가 사이즈가 아니라 버전 전체에 붙은 경우 (예: 길이 버전)
  sizes: z.array(SizeRow).min(1),
});

// 키 × 몸무게 → 사이즈 매트릭스 (판정은 코드가 프로필로 칸을 찾음)
export const FitMatrix = z.object({
  heightCm: z.array(z.number()),
  weightKg: z.array(z.number()),
  cells: z.array(z.array(z.string().nullable())),
});

export const SpecSchema = z.object({
  category: z.enum(['상의', '하의', '원피스']),            // 아웃터는 상의
  weightUnit: z.enum(['kg', '斤', '추정_kg', '추정_斤', '없음']),
  variants: z.array(Variant).min(1),
  fitMatrix: FitMatrix.nullable(),
});

// 판정 가능 조건: 각 사이즈에 (키·몸무게) 또는 (치수 1개 이상), 또는 fitMatrix 존재
export function isJudgeable(spec) {
  if (spec.fitMatrix) return true;
  return spec.variants.every(v => v.sizes.every(s =>
    s.heightCm || s.weightKg || v.fitHeightCm ||
    s.chest || s.waist || s.hip || s.length || s.shoulder));
}

export function toCircumference(g) {
  if (!g) return null;
  const f = x => (g.basis === '단면' ? x * 2 : x);
  return Array.isArray(g.value) ? g.value.map(f) : f(g.value);
}
