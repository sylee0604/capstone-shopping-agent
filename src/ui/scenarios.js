// 사이드패널에서 고를 수 있는 가짜 시나리오 (2단계: 흐름 확인용)
export const CATALOG = {
  a: { title: '여아 봄 니트 원피스', priceCny: 89 },
  b: { title: '여아 꽃무늬 면 원피스', priceCny: 69 },
  c: { title: '여아 데님 멜빵 원피스', priceCny: 99 },
  d: { title: '여아 롱 셔츠 원피스', priceCny: 79 },
  e: { title: '여아 레이스 원피스', priceCny: 119 },
  f: { title: '여아 체크 원피스', priceCny: 59 },
};
const out = { verdict: '부적합', unfitReason: 'SIZE_OUT_OF_RANGE' };
const err = ['가슴 단면 3.2cm: 값 범위를 벗어남'];

export const SCENARIOS = {
  normal:    { label: '정상: 첫 상품이 맞음', script: { searchResults: [['a', 'b', 'c']], verdict: { a: { verdict: '적합', size: '110' } } } },
  ask:       { label: '되묻기: 성별 정보 없음', script: { intent: { missing: ['gender'] }, searchResults: [['a', 'b', 'c']], verdict: { a: { verdict: '적합', size: '110' } } } },
  next:      { label: '다음 후보: 첫 상품 사이즈 품절', script: { searchResults: [['a', 'b', 'c']], verdict: { a: { verdict: '부적합', unfitReason: 'SIZE_SOLD_OUT' }, b: { verdict: '적합', size: '110' } } } },
  reextract: { label: '재추출: 첫 추출에서 검증 실패', script: { searchResults: [['a', 'b']], validation: { a: [err, []] }, verdict: { a: { verdict: '적합', size: '110' } } } },
  uncertain: { label: '재추출 상한: 계속 검증 실패', script: { searchResults: [['a', 'b']], validation: { a: [err, err, err] }, verdict: { a: { verdict: '경계', size: '110' } } } },
  research:  { label: '후보 소진 → 재검색', script: { searchResults: [['a', 'b', 'c'], ['d', 'e', 'f']], verdict: { a: out, b: out, c: out, d: { verdict: '적합', size: '120' } } } },
  noresult:  { label: '검색 결과 없음', script: { searchResults: [[], [], []] } },
  timeout:   { label: '시간 초과 (90초)', script: { searchResults: [['a']], advanceClockMs: 100_000 } },
};
for (const s of Object.values(SCENARIOS)) s.script.catalog = CATALOG;
