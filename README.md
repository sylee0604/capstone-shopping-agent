# 쇼핑 의사결정 에이전트 (app)

멀티모달 LLM 및 에이전틱 엔지니어링 기반 글로벌 쇼핑 의사결정 지원 시스템의 1차 프로토타입 코드.

## 구조
```
src/agent/
  state.js    공유 상태(AgentState)와 상한(LIMITS)
  routes.js   조건 분기(순수 함수) — 설계서 표 3
  graph.js    그래프 조립 — 설계서 그림 1 (노드 15개, askUser·awaitSelection 직전 일시정지)
  runner.js   실행 도우미: 일시정지 시 UI 응답을 받아 재개
test/
  mockNodes.js        가짜 노드 (LLM·브라우저 없이 흐름만 검증)
  scenarios.test.js   설계서 6장 시나리오
```

## 실행
```
npm install
npm test
```

## 현재 단계
- [x] 1단계: 뼈대 검증 — 가짜 노드로 분기·루프·상한·일시정지·재개 확인
- [ ] 2단계: Chrome 확장(사이드패널)에서 같은 그래프 실행, chrome.storage 체크포인트
- [ ] 3단계: 노드를 실제 구현으로 교체 (11~15주)

## 참고
- 설계서: `../에이전트/에이전트_그래프_설계서_v0.2.docx`
- 스키마: `../스키마/schema.js`, `../스키마/정규화_규칙.md`
- 브라우저용 진입점(`@langchain/langgraph/web`)에서는 `interrupt()`가 동작하지 않아 `interruptBefore` + `updateState`로 일시정지를 구현함
- LangGraph 기본 단계 상한(25)으로는 최악의 경우를 다 돌 수 없어 `RECURSION_LIMIT = 150`으로 설정 (테스트 10)
