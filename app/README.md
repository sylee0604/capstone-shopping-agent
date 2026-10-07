# 쇼핑 의사결정 에이전트 (app)

멀티모달 LLM 및 에이전틱 엔지니어링 기반 글로벌 쇼핑 의사결정 지원 시스템의 1차 프로토타입 코드.

## 구조
```
src/agent/
  state.js          공유 상태(AgentState)와 상한(LIMITS)
  routes.js         조건 분기(순수 함수) — 설계서 표 3
  graph.js          그래프 조립 — 설계서 그림 1 (노드 14개, askUser·awaitSelection 직전 일시정지)
  runner.js         실행 도우미: 일시정지 시 UI 응답을 받아 재개, 저장된 상태에서 이어서 실행
  chromeSaver.js    chrome.storage.local 체크포인트 (최근 10개 실행 보관)
  intent.js         의도 파악: LLM 양식(Zod) + 누락 판단·프로필 보충·검색어 조립(코드)
  rank.js           후보 선별: 예산 필터, 판매량·검색어 일치도 점수
  nodes/searchNodes.js  검색 단계 실제 노드 (parseIntent·askUser·search·reformulateQuery·rankCandidates)
  mockNodes.js      가짜 노드 (분석 단계는 아직 이것을 씀)
src/llm/            LLM 호출 계층: Gemini(무료 API) ↔ OpenAI 호환 자체 서버 교체 가능, 재시도·형식 검사·자기수정
src/browser/        타오바오·1688 검색 결과 수집 (데모 스크래핑 코드 정리), 환율, 상품명 번역
src/data/terms.js   도메인 용어 사전 v0.1 (한→중 의류 용어 100건, 검수 필요)
src/ui/             사이드패널 화면, 가짜 시나리오 8개
extension/          manifest.json, sidepanel.html/css, background.js, 아이콘
eval/               의도 파악 평가셋(30문장), 측정 결과
scripts/            build.mjs(번들링), eval_intent.mjs(의도 파악 정확도 측정)
test/               흐름·체크포인트·LLM 계층·검색 노드 테스트 (31개)
```

## 실행
```
npm install
npm test                        # 테스트 (네트워크 없이 가짜 LLM·브라우저로)
npm run build                   # 확장 프로그램 빌드 → dist/
node scripts/eval_intent.mjs    # 의도 파악 정확도 측정 (저장소 최상위 gemini_key.txt 필요)
```

## 크롬에 설치 (개발용)
1. chrome://extensions → **개발자 모드** 켜기 → **압축해제된 확장 프로그램을 로드합니다** → `app\dist` 선택
   (이미 설치했다면 카드의 새로고침 버튼)
2. 툴바의 **쇼핑 에이전트 v2 (개발용)** 아이콘 → 사이드패널
3. **설정 · 내 정보**에 Gemini API 키 저장 (이 브라우저의 chrome.storage에만 저장)
4. 실행 방식 **실제 검색**으로 요청을 넣고 **시작** → 타오바오 탭이 열리며 검색 → 후보 3개 중 선택
   - 타오바오에 로그인되어 있어야 함. 로그인·보안 확인 화면이 뜨면 처리한 뒤 **이어서 하기**
   - 상세 분석·판정은 아직 가짜 노드라 결과는 예시

## 현재 단계
- [x] 1단계: 뼈대 검증 — 가짜 노드로 분기·루프·상한·일시정지·재개 확인
- [x] 2단계: Chrome 확장(사이드패널)에서 같은 그래프 실행, chrome.storage 체크포인트
- [ ] 3단계: 노드를 실제 구현으로 교체 (2학기 3~7주차)
  - [x] LLM 호출 계층, 의도 파악, 용어 사전, 검색·재검색, 후보 선별 (3주차)
  - [ ] 상세 페이지 수집, 사이즈표 선별, 스펙 추출·검증 (4~5주차)
  - [ ] 적합도 판정, 근거 생성 (6~7주차)

## 참고
- 설계서: `../에이전트/에이전트_그래프_설계서_v0.3.docx`
- 스키마: `../스키마/schema.js`, `../스키마/정규화_규칙.md`
- 브라우저용 진입점(`@langchain/langgraph/web`)에서는 `interrupt()`가 동작하지 않아 `interruptBefore` + `updateState`로 일시정지를 구현함
- LangGraph 기본 단계 상한(25)으로는 최악의 경우를 다 돌 수 없어 `RECURSION_LIMIT = 150`으로 설정
- 시간 상한 90초는 에이전트 작업 시간만 계산 (사용자 응답 대기 제외, runner.js에서 구간별 정산)
- LLM 재시도 대기는 2초·5초로 짧게 둠 (90초 상한 안에서 끝나도록). 측정 스크립트는 10~40초
- 검색어: 사전에 있는 용어는 사전 번역, 없는 것만 LLM 번역. 결과가 없으면 더 일반적인 검색어 → 그래도 없으면 LLM이 새 검색어
