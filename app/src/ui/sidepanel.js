// 사이드패널: 그래프 실행, 진행 표시, 일시정지 응답, 결과 표시, 중단 후 재개
// 실행 방식: real = 검색 단계 실제 노드(LLM·타오바오) + 분석 단계 가짜 노드 / mock = 전부 가짜(시나리오)
import { buildGraph } from '../agent/graph.js';
import { makeRoutes } from '../agent/routes.js';
import { runAgent } from '../agent/runner.js';
import { ChromeStorageSaver } from '../agent/chromeSaver.js';
import { makeMockNodes } from '../agent/mockNodes.js';
import { makeSearchNodes } from '../agent/nodes/searchNodes.js';
import { makeLlm } from '../llm/client.js';
import { makeChromeBrowser } from '../browser/chromeBrowser.js';
import { SCENARIOS, CATALOG } from './scenarios.js';

const $ = (id) => document.getElementById(id);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const area = globalThis.chrome?.storage?.local ?? {               // 확장 밖(일반 페이지)에서 열었을 때 대비
  get: async (k) => ({ [k]: JSON.parse(localStorage.getItem(k) ?? 'null') }),
  set: async (o) => Object.entries(o).forEach(([k, v]) => localStorage.setItem(k, JSON.stringify(v))),
  remove: async (k) => localStorage.removeItem(k),
};
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const safeUrl = (u) => (/^https:\/\//.test(u ?? '') ? esc(u) : '');
const won = (n) => (n == null ? '' : `약 ${Math.round(n).toLocaleString()}원`);

const MOCK_DELAY = 350;
const REASON = { SIZE_OUT_OF_RANGE: '맞는 사이즈 없음', SIZE_SOLD_OUT: '맞는 사이즈 품절', SPEC_UNKNOWN: '사이즈 정보 없음', CONDITION_MISMATCH: '예산·소재 불일치', FETCH_FAILED: '상세 페이지 수집 실패' };
const STATUS = { ok: '통과', uncertain: '확인 필요(재추출 상한)', source_anomaly: '원본 이상', retry: '오류 → 다시 읽기' };

const seen = {};                                                  // 상품 id → 화면 표시용 정보
const title = (id) => seen[id]?.title ?? CATALOG[id]?.title ?? id;

function describeIntent(it) {
  const parts = [it.item ?? it.category, [it.ageGroup, it.gender].filter(Boolean).join(' '), it.heightCm && `키 ${it.heightCm}`, it.budgetKrw && `${it.budgetKrw.toLocaleString()}원 이하`].filter(Boolean);
  return parts.length ? parts.join(' · ') : '조건 없음';
}

function describe(node, u) {
  switch (node) {
    case 'parseIntent': return u.intent?.category || u.intent?.item ? `요청을 분석했어요 · ${describeIntent(u.intent)}${u.intent.queriesZh?.length ? ` → ${u.intent.queriesZh[0]}` : ''}` : '요청을 분석했어요';
    case 'askUser': return `답변을 반영했어요 · ${describeIntent(u.intent ?? {})}`;
    case 'search': return `상품을 검색했어요${u.usedQueries?.length ? ` "${u.usedQueries[0]}"` : ''} · ${u.candidates.length}건`;
    case 'reformulateQuery': return u.round ? '조건에 맞는 상품이 없어 새로 검색해요' : '결과가 없어 검색어를 바꿔요';
    case 'rankCandidates': u.candidates.forEach((c) => (seen[c.id] = c)); return `후보 ${u.candidates.length}개를 골랐어요`;
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
  li.innerHTML = `<span class="t">${((performance.now() - t0) / 1000).toFixed(1)}s</span><span>${esc(text)}</span>`;
  $('progress').append(li);
  li.scrollIntoView({ block: 'nearest' });
}

async function loadSettings() { return (await area.get('settings')).settings ?? { platform: 'taobao' }; }

// 실행 방식에 맞는 그래프. real: 검색 단계는 실제 노드, 분석 단계(상세 페이지~근거)는 아직 가짜 노드
async function makeGraph(run) {
  if (run.mode === 'real') {
    const { apiKey } = await loadSettings();
    const llm = makeLlm({ provider: 'gemini', apiKey, onRetry: ({ code, waitMs }) => log(`LLM 응답 지연(${code}) → ${waitMs / 1000}초 후 다시 시도`, 'pause') });
    const nodes = { ...makeMockNodes({}).nodes, ...makeSearchNodes({ llm, browser: makeChromeBrowser() }) };
    return buildGraph(nodes, { checkpointer: saver, routes: makeRoutes() });
  }
  const clock = { t: 0 };
  const { nodes } = makeMockNodes(SCENARIOS[run.scenario].script, clock);
  const delayed = Object.fromEntries(Object.entries(nodes).map(([n, fn]) => [n, async (s) => { await sleep(MOCK_DELAY); return fn(s); }]));
  return buildGraph(delayed, { checkpointer: saver, routes: makeRoutes({ now: () => Date.now() + clock.t }) });
}

// 되묻기 양식: 비어 있는 항목만 묻는다
const FIELDS = {
  gender: { q: '아이 성별', html: () => `<select name="gender"><option value="여성">여아</option><option value="남성">남아</option><option value="공용">공용</option></select>` },
  category: { q: '어떤 옷인가요', html: () => `<select name="category">${['상의', '하의', '원피스', '아웃터'].map((c) => `<option>${c}</option>`).join('')}</select>` },
  target: { q: '누가 입나요', html: (it) => `<select name="target">${[['성인', '여성', '여성'], ['성인', '남성', '남성'], ['아동', '여성', '여아'], ['아동', '남성', '남아'], ['아동', '공용', '아동 공용']].map(([a, g, l]) => `<option value="${a}|${g}" ${it.ageGroup === a && it.gender === g ? 'selected' : ''}>${l}</option>`).join('')}</select>` },
  height: { q: '키(cm)', html: () => '<input name="heightCm" type="number" min="50" max="220" required />' },
};

function onPause(node, state) {
  return new Promise((resolve) => {
    const box = $('pause');
    box.hidden = false;
    if (node === 'askUser') {
      const it = state.intent ?? {};
      const missing = (it.missing ?? []).filter((m) => FIELDS[m]);
      box.innerHTML = `<p class="q">몇 가지만 알려 주세요</p><form>${missing.map((m) => `<label class="field">${FIELDS[m].q}${FIELDS[m].html(it)}</label>`).join('')}<button class="primary">확인</button></form>`;
      box.querySelector('form').onsubmit = (e) => {
        e.preventDefault();
        const f = Object.fromEntries(new FormData(e.target));
        const ans = {};
        if (f.gender) ans.gender = f.gender;
        if (f.category) ans.category = f.category;
        if (f.target) [ans.ageGroup, ans.gender] = f.target.split('|');
        if (f.heightCm) ans.heightCm = Number(f.heightCm);
        box.hidden = true;
        log(`→ ${Object.values(ans).join(', ')}`, 'user');
        resolve({ userAnswer: ans });
      };
    } else {
      const list = state.candidates.filter((c) => !state.analyzed.includes(c.id));
      list.forEach((c) => (seen[c.id] = c));
      const last = state.results.at(-1);
      const again = last && last.round === state.round;
      const head = again ? `<p class="note">${esc(title(last.productId))}: ${esc(REASON[last.unfitReason] ?? last.verdict)}</p><p class="q">남은 후보 중에서 다시 골라 주세요</p>`
        : `<p class="q">분석할 상품을 골라 주세요${state.round > 1 ? ' (새로 검색한 후보)' : ''}</p>`;
      box.innerHTML = head + list.map((c) => {
        const krw = c.priceKrw ?? (c.priceCny != null ? c.priceCny * 190 : null);
        return `<div class="card">${c.image ? `<img src="${safeUrl(c.image)}" alt="" referrerpolicy="no-referrer" />` : ''}<div class="info"><b>${esc(c.title)}</b>
          <small>¥${esc(c.priceCny ?? '?')} · ${won(krw)}${c.overBudget ? '<span class="tag">예산 초과</span>' : ''}${c.sales ? ` · ${esc(c.sales)}` : ''}</small>
          ${c.url ? `<a href="${safeUrl(c.url)}" target="_blank" rel="noopener">상품 페이지</a>` : ''}</div><button data-id="${esc(c.id)}">선택</button></div>`;
      }).join('');
      box.querySelectorAll('button[data-id]').forEach((b) => (b.onclick = () => { box.hidden = true; log(`→ ${title(b.dataset.id)} 선택`, 'user'); resolve({ selectedId: b.dataset.id }); }));
    }
    log(node === 'askUser' ? '질문에 답해 주세요 (일시정지)' : '상품을 골라 주세요 (일시정지)', 'pause');
  });
}

const activeSec = (v) => (v.activeMs + (v.segmentStartedAt != null ? Date.now() - v.segmentStartedAt : 0)) / 1000;

function showResult(v, run) {
  const r = v.recommendation, box = $('result');
  box.hidden = false;
  const history = v.results.map((x) => `<li>${esc(title(x.productId))} — ${esc(x.verdict)}${x.unfitReason ? ` (${REASON[x.unfitReason]})` : ` · ${esc(x.size)}`}${x.specStatus && x.specStatus !== 'ok' ? ` · ${STATUS[x.specStatus]}` : ''}</li>`).join('');
  let head;
  if (r?.type === 'recommend') {
    const c = seen[r.productId];
    head = `<h3>추천: ${esc(title(r.productId))}</h3><p class="big">${esc(r.size)} 사이즈 · ${esc(r.verdict)}</p><p>${esc(r.rationale)}</p>${r.specStatus !== 'ok' ? '<p class="warn">사이즈표를 확실히 읽지 못했어요. 원문을 확인해 주세요.</p>' : ''}${c?.url ? `<p><a href="${safeUrl(c.url)}" target="_blank" rel="noopener">상품 페이지 열기</a></p>` : ''}`;
    if (run.mode === 'real') head += '<p class="warn">※ 지금은 분석 단계가 가짜라 판정·근거는 예시예요.</p>';
  } else if (r?.type === 'fallback') head = '<h3>맞는 상품을 찾지 못했어요</h3><p>조건을 바꾸거나 다른 검색어로 시도해 보세요.</p>';
  else if (v.analyzed.length) head = '<h3>시간 초과</h3><p>에이전트 작업 시간이 90초를 넘었어요. 다시 시도해 주세요.</p>';
  else head = '<h3>검색 결과 없음</h3><p>검색어를 바꿔 다시 찾아봤지만 상품이 없었어요.</p>';
  const queries = v.usedQueries?.length ? `<p class="sub">사용한 검색어</p><p>${v.usedQueries.map(esc).join(' → ')}</p>` : '';
  box.innerHTML = head + queries + (history ? `<p class="sub">판정 기록</p><ul class="hist">${history}</ul>` : '') +
    `<p class="meta">${steps}단계 · 에이전트 작업 ${activeSec(v).toFixed(1)}초 (응답 대기 제외) · 분석 ${v.analyzed.length}개 · 검색 라운드 ${v.round}</p>`;
}

async function execute(run, resume) {
  $('start').disabled = true; $('resume').hidden = true; $('result').hidden = true; $('error').hidden = true;
  if (!resume) $('progress').innerHTML = '';
  t0 = performance.now(); steps = 0;
  try {
    const graph = await makeGraph(run);
    const final = await runAgent(graph, { request: { query: run.query, platform: run.platform, profile: run.profile } }, {
      threadId: run.threadId, resume, onPause,
      onUpdate: (chunk) => { for (const [n, u] of Object.entries(chunk)) if (!n.startsWith('__')) { steps++; log(describe(n, u ?? {})); } },
    });
    showResult(final, run);
    await area.remove?.('activeRun');
  } catch (e) {
    $('error').hidden = false;
    $('error').textContent = `실행이 멈췄어요: ${e.message}`;
    $('resume').hidden = false;
    $('resume').textContent = '이어서 하기';
  } finally {
    $('start').disabled = false;
  }
}

function syncMode() {
  const real = $('mode').value === 'real';
  $('scenarioRow').hidden = real;
  $('modeNote').textContent = real ? '검색까지 실제로 동작 · 상세 분석·판정은 아직 가짜' : 'LangGraph 흐름 확인용 · 노드는 가짜 함수';
}

async function init() {
  $('scenario').innerHTML = Object.entries(SCENARIOS).map(([k, s]) => `<option value="${k}">${esc(s.label)}</option>`).join('');
  const st = await loadSettings();
  $('apiKey').value = st.apiKey ?? '';
  $('platform').value = st.platform ?? 'taobao';
  $('heightCm').value = st.heightCm ?? '';
  $('weightKg').value = st.weightKg ?? '';
  if (!st.apiKey) $('settings').open = true;
  $('mode').onchange = syncMode;
  syncMode();
  $('saveSettings').onclick = async () => {
    const num = (v) => (v === '' ? null : Number(v));
    await area.set({ settings: { apiKey: $('apiKey').value.trim(), platform: $('platform').value, heightCm: num($('heightCm').value), weightKg: num($('weightKg').value) } });
    $('saved').textContent = '저장했어요';
    setTimeout(() => ($('saved').textContent = ''), 1500);
  };

  saver = await ChromeStorageSaver.load(area);
  const { activeRun } = await area.get('activeRun');
  if (activeRun) {
    try {
      const st2 = await (await makeGraph(activeRun)).getState({ configurable: { thread_id: activeRun.threadId } });
      if (st2.next?.length) {
        $('resume').hidden = false;
        $('resume').textContent = `이어서 하기: "${activeRun.query}"`;
      }
    } catch { /* 키가 없는 등 그래프를 만들 수 없으면 이어서 하기 숨김 */ }
  }
  $('resume').onclick = async () => {
    const { activeRun } = await area.get('activeRun');
    $('progress').innerHTML = '';
    t0 = performance.now();
    log('저장된 상태에서 이어서 실행해요', 'pause');
    execute(activeRun, true);
  };
  $('start').onclick = async () => {
    const s = await loadSettings();
    const mode = $('mode').value;
    if (mode === 'real' && !s.apiKey) { $('settings').open = true; $('error').hidden = false; $('error').textContent = '설정에서 Gemini API 키를 먼저 저장해 주세요.'; return; }
    const run = {
      threadId: `run-${Date.now()}`, mode, scenario: $('scenario').value, platform: s.platform ?? 'taobao',
      query: $('query').value.trim() || '여아 봄 원피스', profile: { heightCm: s.heightCm, weightKg: s.weightKg },
    };
    await area.set({ activeRun: run });
    execute(run, false);
  };
}
init();
