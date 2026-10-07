// 도메인 용어 사전 v0.1 (한국어 → 타오바오·1688 검색용 중국어). 의류 범위.
// - LLM이 고른 한국어 표준 용어를 이 사전으로 중국어 검색어로 바꾼다. 사전에 없는 말만 LLM 번역을 쓴다.
// - ko[0]이 표준 용어(LLM에 보여주는 선택지), 나머지는 같은 뜻의 다른 표현.
// - 초안: 중국어 표현은 팀원 검수 후 확정 (검수 결과는 docs가 아니라 이 파일에 바로 반영)

export const TERMS = [
  // ── 대상 (성별·연령) ──
  { type: 'target', ko: ['여성', '여자', '우먼'], zh: '女装' },
  { type: 'target', ko: ['남성', '남자', '맨즈'], zh: '男装' },
  { type: 'target', ko: ['여아', '여자아이', '딸'], zh: '女童' },
  { type: 'target', ko: ['남아', '남자아이', '아들'], zh: '男童' },
  { type: 'target', ko: ['아동', '키즈', '아이', '어린이'], zh: '童装' },
  { type: 'target', ko: ['공용', '남녀공용', '커플'], zh: '男女同款' },

  // ── 상의 ──
  { type: 'item', cat: '상의', ko: ['티셔츠', '티'], zh: 'T恤' },
  { type: 'item', cat: '상의', ko: ['반팔티', '반팔 티셔츠', '반팔'], zh: '短袖T恤' },
  { type: 'item', cat: '상의', ko: ['긴팔티', '긴팔 티셔츠', '롱슬리브'], zh: '长袖T恤' },
  { type: 'item', cat: '상의', ko: ['맨투맨', '스웨트셔츠'], zh: '圆领卫衣' },
  { type: 'item', cat: '상의', ko: ['후드티', '후디', '후드'], zh: '连帽卫衣' },
  { type: 'item', cat: '상의', ko: ['셔츠', '남방'], zh: '衬衫' },
  { type: 'item', cat: '상의', ko: ['블라우스'], zh: '衬衫' },
  { type: 'item', cat: '상의', ko: ['니트', '니트티'], zh: '针织衫' },
  { type: 'item', cat: '상의', ko: ['스웨터'], zh: '毛衣' },
  { type: 'item', cat: '상의', ko: ['가디건'], zh: '针织开衫' },
  { type: 'item', cat: '상의', ko: ['조끼', '베스트'], zh: '马甲' },
  { type: 'item', cat: '상의', ko: ['민소매', '나시', '슬리브리스'], zh: '无袖背心' },
  { type: 'item', cat: '상의', ko: ['크롭티', '크롭 상의'], zh: '短款上衣' },
  { type: 'item', cat: '상의', ko: ['폴로티', '카라티', 'PK티'], zh: 'POLO衫' },
  { type: 'item', cat: '상의', ko: ['상의', '탑'], zh: '上衣' },

  // ── 하의 ──
  { type: 'item', cat: '하의', ko: ['바지', '팬츠', '하의'], zh: '裤子' },
  { type: 'item', cat: '하의', ko: ['청바지', '데님팬츠', '진'], zh: '牛仔裤' },
  { type: 'item', cat: '하의', ko: ['슬랙스', '정장바지'], zh: '西装裤' },
  { type: 'item', cat: '하의', ko: ['면바지', '치노팬츠'], zh: '休闲裤' },
  { type: 'item', cat: '하의', ko: ['조거팬츠', '조거'], zh: '束脚裤' },
  { type: 'item', cat: '하의', ko: ['트레이닝바지', '추리닝', '운동복 바지'], zh: '运动裤' },
  { type: 'item', cat: '하의', ko: ['반바지', '숏팬츠'], zh: '短裤' },
  { type: 'item', cat: '하의', ko: ['레깅스'], zh: '打底裤' },
  { type: 'item', cat: '하의', ko: ['와이드팬츠', '통바지'], zh: '阔腿裤' },
  { type: 'item', cat: '하의', ko: ['카고바지', '카고팬츠'], zh: '工装裤' },
  { type: 'item', cat: '하의', ko: ['멜빵바지'], zh: '背带裤' },
  { type: 'item', cat: '하의', ko: ['치마', '스커트'], zh: '半身裙' },
  { type: 'item', cat: '하의', ko: ['미니스커트', '짧은 치마'], zh: '短裙' },
  { type: 'item', cat: '하의', ko: ['롱스커트', '긴 치마'], zh: '长半身裙' },
  { type: 'item', cat: '하의', ko: ['플리츠스커트', '주름치마'], zh: '百褶裙' },

  // ── 원피스 ──
  { type: 'item', cat: '원피스', ko: ['원피스', '드레스'], zh: '连衣裙' },
  { type: 'item', cat: '원피스', ko: ['셔츠원피스'], zh: '衬衫裙' },
  { type: 'item', cat: '원피스', ko: ['니트원피스'], zh: '针织连衣裙' },
  { type: 'item', cat: '원피스', ko: ['멜빵원피스', '점퍼스커트'], zh: '背带裙' },
  { type: 'item', cat: '원피스', ko: ['롱원피스', '맥시원피스'], zh: '长款连衣裙' },
  { type: 'item', cat: '원피스', ko: ['미니원피스'], zh: '短款连衣裙' },

  // ── 아웃터 ──
  { type: 'item', cat: '아웃터', ko: ['아웃터', '겉옷'], zh: '外套' },
  { type: 'item', cat: '아웃터', ko: ['자켓', '재킷', '점퍼'], zh: '夹克' },
  { type: 'item', cat: '아웃터', ko: ['코트'], zh: '大衣' },
  { type: 'item', cat: '아웃터', ko: ['트렌치코트', '바바리'], zh: '风衣' },
  { type: 'item', cat: '아웃터', ko: ['패딩', '다운점퍼'], zh: '羽绒服' },
  { type: 'item', cat: '아웃터', ko: ['경량패딩'], zh: '轻薄羽绒服' },
  { type: 'item', cat: '아웃터', ko: ['솜패딩'], zh: '棉服' },
  { type: 'item', cat: '아웃터', ko: ['바람막이'], zh: '防风外套' },
  { type: 'item', cat: '아웃터', ko: ['블레이저', '정장 자켓'], zh: '西装外套' },
  { type: 'item', cat: '아웃터', ko: ['청자켓', '데님자켓'], zh: '牛仔外套' },
  { type: 'item', cat: '아웃터', ko: ['플리스', '뽀글이'], zh: '摇粒绒外套' },
  { type: 'item', cat: '아웃터', ko: ['야구점퍼', '스타디움 자켓'], zh: '棒球服' },

  // ── 계절 ──
  { type: 'season', ko: ['봄'], zh: '春季' },
  { type: 'season', ko: ['여름'], zh: '夏季' },
  { type: 'season', ko: ['가을'], zh: '秋季' },
  { type: 'season', ko: ['겨울'], zh: '冬季' },
  { type: 'season', ko: ['봄가을', '간절기'], zh: '春秋' },

  // ── 소재 ──
  { type: 'material', ko: ['면', '순면', '코튼'], zh: '纯棉' },
  { type: 'material', ko: ['린넨', '마'], zh: '亚麻' },
  { type: 'material', ko: ['데님', '청'], zh: '牛仔' },
  { type: 'material', ko: ['니트 소재'], zh: '针织' },
  { type: 'material', ko: ['울', '모직'], zh: '羊毛' },
  { type: 'material', ko: ['캐시미어'], zh: '羊绒' },
  { type: 'material', ko: ['실크'], zh: '真丝' },
  { type: 'material', ko: ['쉬폰', '시폰'], zh: '雪纺' },
  { type: 'material', ko: ['코듀로이', '골덴'], zh: '灯芯绒' },
  { type: 'material', ko: ['기모'], zh: '加绒' },
  { type: 'material', ko: ['레이스'], zh: '蕾丝' },
  { type: 'material', ko: ['가죽', '레더'], zh: '皮革' },

  // ── 색상 ──
  { type: 'color', ko: ['검정', '블랙', '검은색'], zh: '黑色' },
  { type: 'color', ko: ['흰색', '화이트', '하얀색'], zh: '白色' },
  { type: 'color', ko: ['회색', '그레이'], zh: '灰色' },
  { type: 'color', ko: ['네이비', '남색'], zh: '藏青色' },
  { type: 'color', ko: ['베이지'], zh: '米色' },
  { type: 'color', ko: ['아이보리'], zh: '米白色' },
  { type: 'color', ko: ['파랑', '블루', '파란색'], zh: '蓝色' },
  { type: 'color', ko: ['하늘색', '스카이블루'], zh: '浅蓝色' },
  { type: 'color', ko: ['빨강', '레드', '빨간색'], zh: '红色' },
  { type: 'color', ko: ['분홍', '핑크'], zh: '粉色' },
  { type: 'color', ko: ['노랑', '옐로우', '노란색'], zh: '黄色' },
  { type: 'color', ko: ['초록', '그린', '초록색'], zh: '绿色' },
  { type: 'color', ko: ['카키'], zh: '卡其色' },
  { type: 'color', ko: ['갈색', '브라운'], zh: '棕色' },
  { type: 'color', ko: ['보라', '퍼플'], zh: '紫色' },
  { type: 'color', ko: ['와인', '버건디'], zh: '酒红色' },

  // ── 무늬·핏·스타일 ──
  { type: 'style', ko: ['꽃무늬', '플로럴'], zh: '碎花' },
  { type: 'style', ko: ['체크'], zh: '格子' },
  { type: 'style', ko: ['스트라이프', '줄무늬'], zh: '条纹' },
  { type: 'style', ko: ['도트', '땡땡이'], zh: '波点' },
  { type: 'style', ko: ['무지', '단색'], zh: '纯色' },
  { type: 'style', ko: ['캐릭터', '프린팅'], zh: '卡通印花' },
  { type: 'style', ko: ['캐주얼'], zh: '休闲' },
  { type: 'style', ko: ['오버핏', '루즈핏', '박시'], zh: '宽松' },
  { type: 'style', ko: ['슬림핏', '스키니'], zh: '修身' },
  { type: 'style', ko: ['하이웨스트'], zh: '高腰' },
  { type: 'style', ko: ['빅사이즈'], zh: '大码' },
  { type: 'style', ko: ['기본', '베이직'], zh: '基础款' },
  { type: 'style', ko: ['교복', '스쿨룩'], zh: '学院风' },
];

const byKo = new Map();
for (const t of TERMS) for (const k of t.ko) byKo.set(norm(k), t);

function norm(s) { return String(s).replace(/\s+/g, '').toLowerCase(); }

/** 한국어 용어 → 사전 항목 (없으면 null) */
export function lookup(ko) { return ko ? byKo.get(norm(ko)) ?? null : null; }

/** 종류별 표준 용어 목록 (LLM 프롬프트에 선택지로 제공) */
export function vocabulary(type, cat) {
  return TERMS.filter((t) => t.type === type && (!cat || t.cat === cat)).map((t) => t.ko[0]);
}
