# 쇼핑 의사결정 에이전트 (app)

멀티모달 LLM 및 에이전틱 엔지니어링 기반 글로벌 쇼핑 의사결정 지원 시스템의 1차 프로토타입 코드.

## 구조
```
src/agent/
  state.js        공유 상태(AgentState)와 상한(LIMITS)
  routes.js       조건 분기(순수 함수) — 설계서 표 3
  graph.js        그래프 조립 — 설계서 그림 1 (노드 15개, askUser·awaitSelection 직전 일시정지)
  runner.js       실행 도우미: 일시정지 시 UI 응답을 받아 재개, 저장된 상태에서 이어서 실행
  chromeSaver.js  chrome.storage.local 체크포인트 (최근 10개 실행 보관)
  mockNodes.js    가짜 노드 (LLM·브라우저 없이 흐름만 검증)
src/ui/
  sidepanel.js    사이드패널 화면: 진행 표시, 질문·상품 선택, 결과, 이어서 하기
  scenarios.js    화면에서 고를 수 있는 가짜 시나리오 8개
extension/        manifest.json, sidepanel.html/css, background.js, 아이콘
scripts/build.mjs 번들링(esbuild) → dist/
test/             시나리오 테스트, 체크포인트 저장·복원 테스트
```

## 실행
```
npm install
npm test          # 테스트
npm run build     # 확장 프로그램 빌드 → dist/
```

## 크롬에 설치 (개발용)
1. chrome://extensions 접속 → 오른쪽 위 **개발자 모드** 켜기
2. **압축해제된 확장 프로그램을 로드합니다** → `app\dist` 폴더 선택
3. 툴바의 퍼즐 아이콘 → **쇼핑 에이전트 v2 (개발용)** (파란 v2 아이콘) 클릭 → 사이드패널 열림
4. 시나리오를 고르고 **시작**

기존 데모(중국 쇼핑 어시스턴트)와 이름·아이콘이 달라 함께 설치해도 됩니다. 코드를 고친 뒤에는 `npm run build` 후 확장 프로그램 카드의 새로고침 버튼을 누르세요.

## 현재 단계
- [x] 1단계: 뼈대 검증 — 가짜 노드로 분기·루프·상한·일시정지·재개 확인 (테스트 15개)
- [x] 2단계: Chrome 확장(사이드패널)에서 같은 그래프 실행, chrome.storage 체크포인트 — 자동 브라우저 테스트로 시나리오 8개 + 패널 닫고 이어서 하기 확인, 콘솔 오류 없음
- [ ] 3단계: 노드를 실제 구현으로 교체 (11~15주)

## 참고
- 설계서: `../에이전트/에이전트_그래프_설계서_v0.3.docx`
- 스키마: `../스키마/schema.js`, `../스키마/정규화_규칙.md`
- 브라우저용 진입점(`@langchain/langgraph/web`)에서는 `interrupt()`가 동작하지 않아 `interruptBefore` + `updateState`로 일시정지를 구현함
- LangGraph 기본 단계 상한(25)으로는 최악의 경우를 다 돌 수 없어 `RECURSION_LIMIT = 150`으로 설정 (테스트 10)
- 시간 상한 90초는 에이전트 작업 시간만 계산 (사용자 응답 대기 제외, runner.js에서 구간별 정산)
- 부적합 판정 후에는 남은 후보를 다시 보여주고 사용자가 고름. 후보를 모두 확인하면 새로 검색 (최대 1회)
