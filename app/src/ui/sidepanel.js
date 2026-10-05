// 사이드패널: 그래프 실행, 진행 표시, 일시정지 응답, 결과 표시, 중단 후 재개
import { buildGraph } from '../agent/graph.js';
import { makeRoutes } from '../agent/routes.js';
import { runAgent } from '../agent/runner.js';
import { ChromeStorageSaver } from '../agent/chromeSaver.js';
import { makeMockNodes } from '../agent/mockNodes.js';
import { SCENARIOS, CATALOG } from './scenarios.js';

const $ = (id) => document.getElementById(id);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const area = globalThis.chrome?.storage?.local ?? {               // 확장 밖(일반 페이지)에서 열었을 때 대비
  get: async (k) => ({ [k]: JSON.parse(localStorage.getItem(k) ?? 'null') }),
  set: async (o) => Object.entries(o).forEach(([k, v]) => localStorage.setItem(k, JSON.stringify(v))),
  remove: async (k) => localStorage.removeItem(k),
};
const STEP_DELAY = 350;
const REASON = { SIZE_OUT_OF_RANGE: '맞는 사이즈 없음', SIZE_SOLD_OUT: '맞는 사이즈 품절', SPEC_UNKNOWN: '사이즈 정보 없음', CONDITION_MISMATCH: '예산·소재 불일치', FETCH_FAILED: '상세 페이지 수집 실패' };
const STATUS = { ok: '통과', uncertain: '확인 필요(재추출 상한)', source_anomaly: '원본 이상', retry: '오류 → 다시 읽기' };
const title = (id) => CATALOG[id]?.title ?? id;

function describe(node, u) {
  switch (node) {
    case 'parseIntent': return '요청을 분석했어요';
    case 'askUser': return `답변을 반영했어요 (${u.intent?.gender ?? ''})`;
    case 'search': return `상품을 검색했어요 · ${u.candidates.length}건`;
    case 'reformulateQuery': return u.round ? '조건에 맞는 상품이 없어 새로 검색해요' : '결과가 없어 검색어를 바꿔요';
    case 'rankCandidates': return '후보를 정리했어요';
    case 'awaitSelection': return '선택한 상품을 확인했어요';
    case 'fetchDetail': return `상세 페이지를 읽었어요 · ${title(u.current.productId)}`;
    case 'selectSizeImages': return '사이즈표 이미지를 찾았어요';
    case 'extractSpec': return `사이즈표를 읽었어요 (${u.current.extractAttempts}회차)`;
    case 'validateSpec': return `검증: ${STATUS[u.current.status]}${u.current.errors.length ? ` — ${u.current.errors[0]}` : ''}`;
    case 'judgeFit': { const r = u.results[0]; return `판정: ${r.verdict}${r.unfitReason ? ` (${REASON[r.unfitReason]})` : ` · ${r.size}`}`; }
    case 'analyzeFailure': return '후보를 모두 확인했지만 맞는 상품이 없어요';
    case 'writeRationale': return '추천 근거를 만들었어요';
    case 'finish': return '완료';
    default: return node;
  }
}

let saver, t0, steps;
function log(text, kind = '') {
  const li = document.createElement('li');
  li.className = kind;
  li.innerHTML = `<span class="t">${((performance.now() - t0) / 1000).toFixed(1)}s</span><span>${text}</span>`;
  $('progress').append(li);
  li.scrollIntoView({ block: 'nearest' });
}

function makeGraph(scenarioKey) {
  const clock = { t: 0 };
  const { nodes } = makeMockNodes(SCENARIOS[scenarioKey].script, clock);
  const delayed = Object.fromEntries(Object.entries(nodes).map(([n, fn]) => [n, async (s) => { await sleep(STEP_DELAY); return fn(s); }]));
  return buildGraph(delayed, { checkpointer: saver, routes: makeRoutes({ now: () => Date.now() + clock.t }) });
}

// 일시정지: 질문 또는 상품 목록을 보여주고 사용자의 클릭을 기다림
function onPause(node, state) {
  return new Promise((resolve) => {
    const box = $('pause');
    box.hidden = false;
    if (node === 'askUser') {
      box.innerHTML = `<p class="q">아이 성별을 알려주세요</p><div class="row">${['여아', '남아', '공용'].map((g) => `<button data-v="${g}">${g}</button>`).join('')}</div>`;
      box.querySelectorAll('button').forEach((b) => (b.onclick = () => { box.hidden = true; log(`→ ${b.dataset.v} 선택`, 'user'); resolve({ userAnswer: { gender: b.dataset.v } }); }));
    } else {
      const list = state.candidates.filter((c) => !state.analyzed.includes(c.id));
      const last = state.results.at(-1);
      const again = last && last.round === state.round;                 // 같은 라운드에서 다시 고르는 경우
      const head = again ? `<p class="note">${title(last.productId)}: ${REASON[last.unfitReason] ?? last.verdict}</p><p class="q">남은 후보 중에서 다시 골라 주세요</p>`
        : `<p class="q">분석할 상품을 골라 주세요${state.round > 1 ? ' (새로 검색한 후보)' : ''}</p>`;
      box.innerHTML = head + list.map((c) =>
        `<div class="card"><div><b>${c.title}</b><small>¥${c.priceCny} · 약 ${(c.priceCny * 190).toLocaleString()}원</small></div><button data-id="${c.id}">선택</button></div>`).join('');
      box.querySelectorAll('button').forEach((b) => (b.onclick = () => { box.hidden = true; log(`→ ${title(b.dataset.id)} 선택`, 'user'); resolve({ selectedId: b.dataset.id }); }));
    }
    log(node === 'askUser' ? '질문에 답해 주세요 (일시정지)' : '상품을 골라 주세요 (일시정지)', 'pause');
  });
}

const activeSec = (v) => (v.activeMs + (v.segmentStartedAt != null ? Date.now() - v.segmentStartedAt : 0)) / 1000;

function showResult(v) {
  const r = v.recommendation, box = $('result');
  box.hidden = false;
  const history = v.results.map((x) => `<li>${title(x.productId)} — ${x.verdict}${x.unfitReason ? ` (${REASON[x.unfitReason]})` : ` · ${x.size}`}${x.specStatus && x.specStatus !== 'ok' ? ` · ${STATUS[x.specStatus]}` : ''}</li>`).join('');
  let head;
  if (r?.type === 'recommend') head = `<h3>추천: ${title(r.productId)}</h3><p class="big">${r.size} 사이즈 · ${r.verdict}</p><p>${r.rationale}</p>${r.specStatus !== 'ok' ? '<p class="warn">사이즈표를 확실히 읽지 못했어요. 원문을 확인해 주세요.</p>' : ''}`;
  else if (r?.type === 'fallback') head = '<h3>맞는 상품을 찾지 못했어요</h3><p>조건을 바꾸거나 다른 검색어로 시도해 보세요.</p>';
  else if (v.analyzed.length) head = '<h3>시간 초과</h3><p>에이전트 작업 시간이 90초를 넘었어요. 다시 시도해 주세요.</p>';
  else head = '<h3>검색 결과 없음</h3><p>검색어를 두 번 바꿔 다시 찾아봤지만 상품이 없었어요.</p>';
  box.innerHTML = head + (history ? `<p class="sub">판정 기록</p><ul class="hist">${history}</ul>` : '') +
    `<p class="meta">${steps}단계 · 에이전트 작업 ${(activeSec(v)).toFixed(1)}초 (응답 대기 제외) · 분석 ${v.analyzed.length}개 · 검색 라운드 ${v.round}</p>`;
}

async function execute(run, resume) {
  $('start').disabled = true; $('resume').hidden = true; $('result').hidden = true; $('error').hidden = true;
  if (!resume) $('progress').innerHTML = '';
  t0 = performance.now(); steps = 0;
  try {
    const final = await runAgent(makeGraph(run.scenario), { request: { query: run.query } }, {
      threadId: run.threadId, resume, onPause,
      onUpdate: (chunk) => { for (const [n, u] of Object.entries(chunk)) if (!n.startsWith('__')) { steps++; log(describe(n, u ?? {})); } },
    });
    showResult(final);
    await area.remove?.('activeRun');
  } catch (e) {
    $('error').hidden = false;
    $('error').textContent = `실행이 중단됐어요: ${e.message}`;
    $('resume').hidden = false;
  } finally {
    $('start').disabled = false;
  }
}

async function init() {
  $('scenario').innerHTML = Object.entries(SCENARIOS).map(([k, s]) => `<option value="${k}">${s.label}</option>`).join('');
  saver = await ChromeStorageSaver.load(area);
  const { activeRun } = await area.get('activeRun');
  if (activeRun) {
    const st = await makeGraph(activeRun.scenario).getState({ configurable: { thread_id: activeRun.threadId } });
    if (st.next?.length) {
      $('resume').hidden = false;
      $('resume').textContent = `이어서 하기: "${activeRun.query}" (${SCENARIOS[activeRun.scenario].label})`;
    }
  }
  $('resume').onclick = async () => { const { activeRun } = await area.get('activeRun'); $('progress').innerHTML = '<li class="pause"><span class="t"></span><span>저장된 상태에서 이어서 실행해요</span></li>'; execute(activeRun, true); };
  $('start').onclick = async () => {
    const run = { threadId: `run-${Date.now()}`, scenario: $('scenario').value, query: $('query').value.trim() || '여아 봄 원피스' };
    await area.set({ activeRun: run });
    execute(run, false);
  };
}
init();
