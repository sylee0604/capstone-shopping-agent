// 의도 파악: LLM은 사용자 문장을 정해진 양식(IntentSchema)으로 옮기기만 하고,
// 누락 항목 판단·프로필 보충·중국어 검색어 조립은 결정적 코드가 맡는다.
import { z } from 'zod';
import { lookup, vocabulary } from '../data/terms.js';

const num = z.number().positive().nullable().default(null);
const list = z.array(z.string()).default([]);

export const IntentSchema = z.object({
  category: z.enum(['상의', '하의', '원피스', '아웃터']).nullable().default(null),
  item: z.string().nullable().default(null),          // 품목 표준 용어 (예: 후드티, 청바지)
  itemZh: z.string().nullable().default(null),        // 사전에 없는 품목일 때만 쓰는 LLM 번역
  ageGroup: z.enum(['성인', '아동']).nullable().default(null),
  gender: z.enum(['여성', '남성', '공용']).nullable().default(null),
  heightCm: num,
  weightKg: num,
  ageYears: num,
  sizeLabel: z.string().nullable().default(null),
  budgetKrw: num,                                      // 최대 예산(원)
  season: z.string().nullable().default(null),
  materials: list,
  colors: list,
  styles: list,
  extraZh: list,                                       // 사전에 없는 조건의 중국어 표현
});

export function intentPrompt(query) {
  const v = (t) => vocabulary(t).join(', ');
  const items = ['상의', '하의', '원피스', '아웃터'].map((c) => `${c}: ${vocabulary('item', c).join(', ')}`).join('\n');
  return {
    system: '너는 한국어 쇼핑 요청을 구조화된 검색 조건으로 옮기는 도구다. 문장에 없는 정보는 추측하지 말고 null 또는 빈 배열로 둔다. JSON만 출력한다.',
    prompt: `다음 요청을 아래 JSON 형식으로 옮겨라.

요청: """${query}"""

형식:
{"category": "상의|하의|원피스|아웃터|null", "item": "품목 표준 용어|null", "itemZh": "품목이 목록에 없을 때만 중국어|null",
 "ageGroup": "성인|아동|null", "gender": "여성|남성|공용|null",
 "heightCm": 숫자|null, "weightKg": 숫자|null, "ageYears": 숫자|null, "sizeLabel": "문자열|null",
 "budgetKrw": 숫자|null, "season": "봄|여름|가을|겨울|봄가을|null",
 "materials": [], "colors": [], "styles": [], "extraZh": []}

규칙:
- item은 아래 목록에서 가장 가까운 것을 고른다. 목록에 없으면 item에 한국어, itemZh에 타오바오 검색용 중국어를 쓴다.
${items}
- materials·colors·styles는 아래 목록의 용어만 쓴다. 목록에 없는 조건은 extraZh에 중국어로 넣는다.
  소재: ${v('material')}
  색상: ${v('color')}
  무늬·핏·스타일: ${v('style')}
- 여아·남아·딸·아들·아이는 ageGroup "아동"이고 성별도 채운다. 성별을 알 수 없으면 null.
- 금액은 원 단위 숫자로 바꾼다 (3만원 → 30000, 5만 원 이하 → 50000). 위안이면 1위안=190원으로 바꾼다.
- 키는 cm, 몸무게는 kg 숫자. "110 사이즈"처럼 사이즈만 말하면 sizeLabel에 넣는다.`,
  };
}

/** 사이드패널 프로필(키·몸무게·성별 등)로 문장에 없는 값을 채운다. 문장의 값이 우선. */
export function applyProfile(intent, profile = {}) {
  const out = { ...intent };
  for (const k of ['heightCm', 'weightKg', 'gender', 'ageGroup', 'ageYears']) if (out[k] == null && profile[k] != null && profile[k] !== '') out[k] = profile[k];
  // 아동 사이즈 110·120…은 키(cm) 기준 표기이므로 키가 없으면 사이즈 숫자를 키로 쓴다
  const n = Number(out.sizeLabel);
  if (out.heightCm == null && out.ageGroup === '아동' && n >= 70 && n <= 170) { out.heightCm = n; out.heightFrom = 'sizeLabel'; }
  if (out.category == null && out.item) out.category = lookup(out.item)?.cat ?? null;
  return out;
}

/** 검색·판정에 꼭 필요한데 비어 있는 항목 (되묻기 대상) */
export function findMissing(it) {
  const m = [];
  if (!it.category && !it.item) m.push('category');
  if (!it.ageGroup || !it.gender) m.push('target');
  if (it.heightCm == null) m.push('height');
  return m;
}

function targetZh(it) {
  if (it.ageGroup === '아동') return it.gender === '여성' ? '女童' : it.gender === '남성' ? '男童' : '童装';
  if (it.gender === '여성') return '女装';
  if (it.gender === '남성') return '男装';
  return it.gender === '공용' ? '男女同款' : '';
}

/**
 * 중국어 검색어 목록 (구체적 → 일반적). 검색 결과가 없으면 다음 검색어로 넘어간다.
 * 사전에 있는 용어는 사전 번역을, 없는 것만 LLM 번역(itemZh·extraZh)을 쓴다.
 */
export function buildQueries(it) {
  const t = targetZh(it);
  const item = lookup(it.item)?.zh ?? it.itemZh ?? lookup(it.category)?.zh ?? '';
  const season = lookup(it.season)?.zh ?? '';
  const attrs = [...it.colors, ...it.materials, ...it.styles].map((k) => lookup(k)?.zh).filter(Boolean);
  const extra = it.extraZh ?? [];
  const join = (...xs) => xs.flat().filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
  const qs = [
    join(t, season, attrs.slice(0, 2), extra.slice(0, 1), item),
    join(t, season, item),
    join(t, item),
  ];
  return [...new Set(qs)].filter(Boolean);
}

/** 문장 → 의도 (LLM 1회) */
export async function parseIntent(llm, query, profile) {
  const { system, prompt } = intentPrompt(query);
  const raw = await llm.json({ system, prompt, schema: IntentSchema });
  const it = applyProfile(raw, profile);
  return { ...it, missing: findMissing(it), queriesZh: buildQueries(it) };
}

/** 되묻기 응답을 반영 (LLM 없이 코드로) */
export function applyAnswer(intent, answer = {}) {
  const it = applyProfile({ ...intent, ...Object.fromEntries(Object.entries(answer).filter(([, v]) => v != null && v !== '')) });
  return { ...it, missing: findMissing(it), queriesZh: buildQueries(it) };
}
