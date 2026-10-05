// 시나리오 테스트용 가짜 노드. script로 각 노드의 결과를 정해 흐름(분기·루프·상한)만 검증한다.
import { specStatus } from '../src/agent/routes.js';

export function makeMockNodes(script = {}, clock = { t: 0 }) {
  const trace = [];
  let searchCalls = 0, thrown = false;
  const hit = (name) => trace.push(name);

  const nodes = {
    parseIntent: () => { hit('parseIntent'); return { intent: { missing: [], queriesZh: ['女装卫衣'], ...script.intent } }; },
    askUser: (s) => { hit('askUser'); return { askedUser: true, intent: { ...s.intent, ...s.userAnswer, missing: [] } }; },
    search: (s) => {
      hit('search');
      const ids = script.searchResults?.[searchCalls++] ?? [];
      return { searchAttempts: s.searchAttempts + 1, candidates: ids.map((id) => ({ id })) };
    },
    reformulateQuery: (s) => {
      hit('reformulateQuery');
      // 후보가 있는데 왔다면 '후보 소진 후 재검색' → 새 라운드
      return s.candidates.length ? { round: s.round + 1, researchCount: s.researchCount + 1, searchAttempts: 0, candidates: [] } : {};
    },
    rankCandidates: (s) => { hit('rankCandidates'); return { candidates: s.candidates.filter((c) => !s.analyzed.includes(c.id)) }; },
    awaitSelection: () => { hit('awaitSelection'); return {}; },
    fetchDetail: (s) => {
      hit('fetchDetail');
      const id = s.selectedId, d = script.detail?.[id] ?? {};
      return { analyzed: [id], current: { productId: id, imageUrls: d.fetchFail ? [] : ['detail_1.jpg'], extractAttempts: 0, errors: [], status: null } };
    },
    selectSizeImages: (s) => {
      hit('selectSizeImages');
      const d = script.detail?.[s.current.productId] ?? {};
      return { current: { ...s.current, sizeImages: d.noSizeTable ? [] : ['detail_1.jpg'] } };
    },
    extractSpec: (s) => {
      hit('extractSpec');
      if (script.throwOnce === 'extractSpec' && !thrown) { thrown = true; throw new Error('가짜 네트워크 오류'); }
      if (script.advanceClockMs) clock.t += script.advanceClockMs;
      return { current: { ...s.current, extractAttempts: s.current.extractAttempts + 1, spec: { sizes: [] } } };
    },
    validateSpec: (s) => {
      hit('validateSpec');
      const id = s.current.productId, n = s.current.extractAttempts;
      const errors = script.validation?.[id]?.[n - 1] ?? [];
      return { current: { ...s.current, errors, status: specStatus({ errors, extractAttempts: n, repeated: script.repeated?.[id] }) } };
    },
    judgeFit: (s) => {
      hit('judgeFit');
      const c = s.current, id = c.productId;
      let r = script.verdict?.[id] ?? { verdict: '적합', size: 'M' };
      if (!c.imageUrls.length) r = { verdict: '부적합', unfitReason: 'FETCH_FAILED' };
      else if (!c.sizeImages?.length) r = { verdict: '부적합', unfitReason: 'SPEC_UNKNOWN' };
      return { results: [{ productId: id, round: s.round, specStatus: c.status, ...r }] };
    },
    nextCandidate: (s) => { hit('nextCandidate'); return { selectedId: s.candidates.find((c) => !s.analyzed.includes(c.id)).id }; },
    analyzeFailure: () => { hit('analyzeFailure'); return {}; },
    writeRationale: (s) => {
      hit('writeRationale');
      const r = s.results.at(-1);
      return { recommendation: { type: 'recommend', productId: r.productId, size: r.size, verdict: r.verdict, rationale: '(가짜 근거)' } };
    },
    finish: (s) => {
      hit('finish');
      return s.recommendation ? { log: [{ node: 'finish' }] }
        : { recommendation: { type: s.results.length ? 'fallback' : 'none' }, log: [{ node: 'finish' }] };
    },
  };
  return { nodes, trace };
}
