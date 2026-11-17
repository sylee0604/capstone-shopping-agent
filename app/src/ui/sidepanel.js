// 사이드패널: 그래프 실행, 진행 표시, 일시정지 응답, 결과 표시, 중단 후 재개
// 실행 방식: real = 모든 노드 실제 구현(LLM은 의도 파악·스펙 추출에만) / mock = 전부 가짜(흐름 확인용 시나리오)
import { buildGraph } from '../agent/graph.js';
import { makeRoutes } from '../agent/routes.js';
import { runAgent } from '../agent/runner.js';
import { ChromeStorageSaver } from '../agent/chromeSaver.js';
import { makeMockNodes } from '../agent/mockNodes.js';
import { makeSearchNodes } from '../agent/nodes/searchNodes.js';
import { makeDetailNodes } from '../agent/nodes/detailNodes.js';
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
const REASON = { SIZE_OUT_OF_RANGE: '맞는 사이즈 없음', SIZE_SOLD_OUT: '맞는 사이즈 품절', SPEC_UNKNOWN: '사이즈 정보 없음', CONDITION_MISMATCH: '예산·소재 불일치', FETCH_FAILED: '상세 페이지 수집 실패', LLM_FAILED: 'LLM 혼잡으로 사이즈표 읽기 실패', LLM_LIMIT: 'LLM 사용량 한도(429)로 사이즈표 읽기 실패' };
const STATUS = { ok: '통과', uncertain: '확인 필요(재추출 상한)', source_anomaly: '원본 이상', retry: '오류 → 다시 읽기', from_sku: '사이즈표 없음 → 옵션 표기로 판정' };

const seen = {};                                                  // 상품 id → 화면 표시용 정보
const title = (id) => seen[id]?.title ?? CATALOG[id]?.title ?? id;

function describeIntent(it) {
  const parts = [it.item ?? it.category, [it.ageGroup, it.gender].filter(Boolean).join(' '), it.heightCm && (it.heightFrom === 'sizeLabel' ? `${it.sizeLabel} 사이즈(키 ${it.heightCm}cm로 가정)` : `키 ${it.heightCm}`), it.budgetKrw && `${it.budgetKrw.toLocaleString()}원 이하`].filter(Boolean);
  return parts.length ? parts.join(' · ') : '조건 없음';
}

function describe(node, u) {
  switch (node) {
    case 'parseIntent': return u.intent?.category || u.intent?.item ? `요청을 분석했어요${u.intent.by === 'rule' ? '(규칙)' : u.intent.by === 'fallback' ? '(LLM 오류 → 규칙+번역)' : '(LLM)'} · ${describeIntent(u.intent)}${u.intent.queriesZh?.length ? ` → ${u.intent.queriesZh[0]}` : ''}` : '요청을 분석했어요';
    case 'askUser': return `답변을 반영했어요 · ${describeIntent(u.intent ?? {})}`;
    case 'search': return `상품을 검색했어요${u.usedQueries?.length ? ` "${u.usedQueries[0]}"` : ''} · ${u.candidates.length}건`;
    case 'reformulateQuery': return u.round ? '조건에 맞는 상품이 없어 새로 검색해요' : '결과가 없어 검색어를 바꿔요';
    case 'rankCandidates': u.candidates.forEach((c) => (seen[c.id] = c)); return `후보 ${u.candidates.length}개를 골랐어요`;
    case 'awaitSelection': return '선택한 상품을 확인했어요';
    case 'fetchDetail': {
      const c = u.current;
      const base = c.specSource === 'sku' ? `상세 페이지를 읽었어요 · 옵션 ${c.skus.length}개에 사이즈 정보가 있어 사이즈표는 건너뛰어요` : `상세 페이지를 읽었어요 · 이미지 ${c.imageUrls.length}장${c.skus?.length ? `, 옵션 ${c.skus.length}개` : ''}`;
      const page = c.pageTitle ? ` · 페이지: ${c.pageTitle.slice(0, 30)}` : '';
      const opt = !c.imageUrls.length && c.skus?.length ? ` · 옵션 예: ${c.skus.slice(0, 3).map((k) => k.label.slice(0, 14)).join(' / ')}` : '';
      return c.pageMismatch ? `[주의] 고른 상품과 다른 페이지가 열렸어요${page} — ${base}` : `${base}${page}${opt}`;
    }
    case 'selectSizeImages': return u.current.sizeTableText ? '페이지에서 사이즈표(표)를 찾았어요' : u.current.sizeImages?.length ? `이미지 ${u.current.checkedImages ?? u.current.sizeImages.length}장 검사 → 표처럼 보이는 ${u.current.strictCount || u.current.sizeImages.length}장 중 ${u.current.sizeImages.length}장을 보냄${u.current.pickedIdx?.length ? ` (${u.current.pickedIdx.map((i) => `${i}번째`).join(', ')})` : ''}` : `이미지 ${u.current.checkedImages ?? 0}장 중 사이즈표로 보이는 것이 없어요${u.current.letterOnly ? ' (옵션도 S/M/L뿐)' : ''} → LLM 호출 안 함`;
    case 'extractSpec': return u.current.spec ? `사이즈표를 읽었어요${u.current.specSource === 'table' ? (u.current.llmNote ? ` (LLM 오류 ${u.current.llmNote} → 글자 표를 코드로 읽음)` : ' (글자 표, 코드로 읽음)') : u.current.specSource === 'table_llm' ? ` (글자 표, LLM ${u.current.extractAttempts}회차)` : ` (${u.current.extractAttempts}회차)`} · 사이즈 ${u.current.spec.variants[0].sizes.map((x) => x.label).join('/')}` : u.current.llmFailed ? (u.current.llmLimit ? 'LLM 사용량 한도(429) → 이 상품은 건너뛰어요' : `LLM 오류로 이 상품은 건너뛰어요 (${u.current.llmFailed.slice(0, 40)})`) : '이미지에서 사이즈표를 찾지 못했어요';
    case 'validateSpec': return `검증: ${STATUS[u.current.status]}${u.current.errors.length ? ` — ${u.current.errors[0]}` : ''}`;
    case 'judgeFit': { const r = u.results[0]; return `판정: ${r.verdict}${r.unfitReason ? ` (${REASON[r.unfitReason]})` : r.size ? ` · ${r.size}` : ''}`; }
    case 'analyzeFailure': return '후보를 모두 확인했지만 맞는 상품이 없어요';
    case 'writeRationale': return '추천 근거를 만들었어요';
    case 'finish': return '완료';
    default: return node;
  }
}

let saver, t0, steps, graphRef;
function log(text, kind = '') {
  const li = document.createElement('li');
  li.className = kind;
  li.innerHTML = `<span class="t">${((performance.now() - t0) / 1000).toFixed(1)}s</span><span>${esc(text)}</span>`;
  $('progress').append(li);
  li.scrollIntoView({ block: 'nearest' });
}

async function loadSettings() { return (await area.get('settings')).settings ?? { platform: 'taobao' }; }

// 실행 방식에 맞는 그래프
async function makeGraph(run) {
  if (run.mode === 'real') {
    const { apiKey, model } = await loadSettings();
    const llm = makeLlm({ provider: 'gemini', apiKey, cachedModel: model, onRetry: ({ code, waitMs }) => log(`LLM 응답 지연(${code}) → ${waitMs / 1000}초 후 다시 시도`, 'pause') });
    const browser = makeChromeBrowser();
    const nodes = { ...makeSearchNodes({ llm, browser }), ...makeDetailNodes({ llm, browser }) };
    const g = buildGraph(nodes, { checkpointer: saver, routes: makeRoutes() });
    g.llmModel = () => llm.model;                                     // 고른 모델을 저장해 다음 실행 때 목록 조회 생략
    g.llmCalls = () => llm.usage.calls;                               // 실행 기록용 LLM 호출 수
    return g;
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

// 실행 중에 '시작'을 다시 누르면 지금 실행을 멈추고 새로 시작한다
let runToken = 0, cancelPause = null, abortCtl = null;
const cancelled = () => Object.assign(new Error('취소됨'), { cancelled: true });
function stopCurrent() {
  runToken++;
  abortCtl?.abort(); abortCtl = null;
  cancelPause?.(); cancelPause = null;
  $('pause').hidden = true;
}

function onPause(node, state) {
  return new Promise((resolve, reject) => {
    cancelPause = () => reject(cancelled());
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

const rng = (r, u) => (r ? (r[1] == null ? `${r[0]}${u}~` : r[0] === r[1] ? `${r[0]}${u}` : `${r[0]}~${r[1]}${u}`) : '-');
const activeSec = (v) => (v.activeMs + (v.segmentStartedAt != null ? Date.now() - v.segmentStartedAt : 0)) / 1000;

function showResult(v, run) {
  const r = v.recommendation, box = $('result');
  box.hidden = false;
  const history = v.results.map((x) => `<li>${esc(title(x.productId))} — ${esc(x.verdict)}${x.unfitReason ? ` (${REASON[x.unfitReason]})` : ` · ${esc(x.size)}`}${x.specStatus && x.specStatus !== 'ok' ? ` · ${STATUS[x.specStatus]}` : ''}</li>`).join('');
  let head;
  if (r?.type === 'recommend') {
    const c = seen[r.productId];
    // 값이 있는 칸만 보여 준다 (권장 키·몸무게, 실측: 총장·가슴·허리·어깨·소매)
    // 둘레/단면 이름: 모든 행이 둘레면 '가슴둘레', 모두 단면이면 '가슴 단면', 섞이거나 표에 기준이 없으면 '가슴' + 칸마다 표시
    const gName = (name, k) => {
      const bs = new Set((r.table ?? []).map((t) => t[k]?.basis).filter(Boolean));
      return bs.size === 1 && bs.has('둘레') ? `${name}둘레` : bs.size === 1 && bs.has('단면') ? `${name} 단면` : name;
    };
    const girth = (g, head) => (g == null ? '-' : `${[].concat(g.value).join('~')}${head.endsWith('둘레') || head.endsWith('단면') ? '' : g.basis === '단면' ? ' (단면)' : g.basis === '둘레' ? ' (둘레)' : ''}`);
    const chestH = gName('가슴', 'chest'), waistH = gName('허리', 'waist');
    const COLS = [
      ['권장 키', (t) => rng(t.heightCm, 'cm'), (t) => t.heightCm], ['권장 몸무게', (t) => rng(t.weightKg, 'kg'), (t) => t.weightKg],
      ['총장', (t) => t.length ?? '-', (t) => t.length], [chestH, (t) => girth(t.chest, chestH), (t) => t.chest], [waistH, (t) => girth(t.waist, waistH), (t) => t.waist],
      ['어깨너비', (t) => t.shoulder ?? '-', (t) => t.shoulder], ['소매길이', (t) => t.sleeve ?? '-', (t) => t.sleeve],
    ].filter(([, , has]) => r.table?.some((t) => has(t) != null));
    const tbl = r.table?.length ? `<table class="spec"><tr><th>사이즈</th>${COLS.map(([h]) => `<th>${h}</th>`).join('')}</tr>${r.table.map((t) => `<tr${t.label === r.size ? ' class="hit"' : ''}><td>${esc(t.label)}${t.fromSku ? ' (옵션)' : ''}</td>${COLS.map(([, f]) => `<td>${esc(f(t))}</td>`).join('')}</tr>`).join('')}</table>${COLS.length > COLS.filter(([h]) => h.startsWith('권장')).length ? `<p class="sub">실측 단위 cm${[chestH, waistH].some((h) => !h.endsWith('둘레')) ? ' · 단면 = 옷을 펼쳐 잰 한쪽 폭 (둘레의 약 절반)' : ''}</p>` : ''}` : '';
    head = `<h3>추천: ${esc(title(r.productId))}</h3><p class="big">${r.size ? `${esc(r.size)} 사이즈 · ` : ''}${esc(r.verdict)}</p><p>${esc(r.rationale)}</p>${r.specStatus === 'from_sku' ? '<p class="warn">옵션의 사이즈 정보(키·몸무게)로 판정했어요. 총장·가슴 같은 실측 치수는 상품 페이지에서 확인해 주세요.</p>' : r.specStatus !== 'ok' ? '<p class="warn">사이즈표를 확실히 읽지 못했어요. 원문을 확인해 주세요.</p>' : ''}${tbl}${c?.url ? `<p><a href="${safeUrl(c.url)}" target="_blank" rel="noopener">상품 페이지 열기</a></p>` : ''}`;
  } else if (r?.type === 'fallback') head = '<h3>맞는 상품을 찾지 못했어요</h3><p>조건을 바꾸거나 다른 검색어로 시도해 보세요.</p>';
  else if (v.analyzed.length) head = '<h3>시간 초과</h3><p>에이전트 작업 시간이 90초를 넘었어요. 다시 시도해 주세요.</p>';
  else head = '<h3>검색 결과 없음</h3><p>검색어를 바꿔 다시 찾아봤지만 상품이 없었어요.</p>';
  const queries = v.usedQueries?.length ? `<p class="sub">사용한 검색어</p><p>${v.usedQueries.map(esc).join(' → ')}</p>` : '';
  box.innerHTML = head + queries + (history ? `<p class="sub">판정 기록</p><ul class="hist">${history}</ul>` : '') +
    `<p class="meta">${steps}단계 · 에이전트 작업 ${activeSec(v).toFixed(1)}초 (응답 대기 제외) · 분석 ${v.analyzed.length}개 · 검색 라운드 ${v.round}</p>`;
}

async function execute(run, resume) {
  stopCurrent();
  const my = runToken, ctl = new AbortController();
  abortCtl = ctl;
  const live = () => my === runToken;
  $('start').textContent = '새로 시작'; $('resume').hidden = true; $('result').hidden = true; $('error').hidden = true;
  if (!resume) $('progress').innerHTML = '';
  t0 = performance.now(); steps = 0;
  try {
    const graph = await makeGraph(run);
    graphRef = graph;
    const final = await runAgent(graph, { request: { query: run.query, platform: run.platform, profile: run.profile } }, {
      threadId: run.threadId, resume, signal: ctl.signal,
      onPause: (node, st) => (live() ? onPause(node, st) : Promise.reject(cancelled())),
      onUpdate: (chunk) => { if (!live()) return; for (const [n, u] of Object.entries(chunk)) if (!n.startsWith('__')) { steps++; log(describe(n, u ?? {})); } },
    });
    if (!live()) return;
    showResult(final, run);
    run.llmCalls = (run.llmCalls ?? 0) + (graph.llmCalls?.() ?? 0);
    if (run.mode === 'real' && final.recommendation?.type === 'recommend') await appendRunLog(final, run);
    if (graph.llmModel?.()) { const st = await loadSettings(); if (st.model !== graph.llmModel()) await area.set({ settings: { ...st, model: graph.llmModel() } }); }
    await area.remove?.('activeRun');
  } catch (e) {
    if (!live() || e.cancelled || e.name === 'AbortError') return;      // 새 요청으로 바뀐 이전 실행은 조용히 끝냄
    try { run.llmCalls = (run.llmCalls ?? 0) + (graphRef?.llmCalls?.() ?? 0); await area.set({ activeRun: run }); } catch { /* 무시 */ }
    $('error').hidden = false;
    $('error').textContent = `실행이 멈췄어요: ${e.message}`;
    // 진단 정보: 형식 오류 때 LLM이 실제로 준 응답과 페이지에서 읽은 사이즈표 글자 (복사해서 확인용)
    try {
      const st = graphRef ? (await graphRef.getState({ configurable: { thread_id: run.threadId } })).values : null;
      const diag = [e.raw && `[LLM 응답]\n${e.raw}`, st?.current?.sizeTableText && `[페이지 사이즈표]\n${st.current.sizeTableText}`, st?.current?.url && `[상품] ${st.current.url}`].filter(Boolean).join('\n\n');
      if (diag) {
        const d = document.createElement('details');
        d.innerHTML = '<summary>진단 정보 (복사해서 보내 주세요)</summary><textarea readonly rows="8" style="width:100%;font-size:11px"></textarea>';
        d.querySelector('textarea').value = diag;
        $('error').append(d);
      }
    } catch { /* 진단 정보는 없어도 됨 */ }
    $('resume').hidden = false;
    $('resume').textContent = '이어서 하기';
  } finally {
    if (live()) { $('start').textContent = '시작'; abortCtl = null; cancelPause = null; }
  }
}

// ── 실행 기록: 추천까지 나온 실제 실행만 쌓고 CSV로 내보낸다 (보고서·발표 결과표용, "맞았나"는 직접 표시) ──
const LOG_KEY = 'runLog';
const SRC = { ok: '사이즈표', from_sku: '옵션 표기', uncertain: '사이즈표(확인 필요)', source_anomaly: '사이즈표(원본 이상)' };
async function appendRunLog(v, run) {
  const r = v.recommendation, c = seen[r.productId] ?? {};
  const entry = {
    시각: new Date().toLocaleString('ko-KR'), 요청: run.query, 쇼핑몰: run.platform === '1688' ? '1688' : '타오바오',
    상품명: c.title ?? '', 상품명_원문: c.titleZh ?? '', 상품주소: c.url ?? '',
    추천사이즈: r.size ?? '', 판정: r.verdict, 판정근거출처: SRC[r.specStatus] ?? r.specStatus ?? '', 근거: r.rationale ?? '',
    작업시간_초: activeSec(v).toFixed(1), 분석한상품수: v.analyzed.length, 검색라운드: v.round, LLM호출수: run.llmCalls ?? '',
    검색어: (v.usedQueries ?? []).join(' → '), 맞았나_OX: '',
  };
  const { runLog = [] } = await area.get(LOG_KEY);
  runLog.push(entry);
  await area.set({ [LOG_KEY]: runLog });
  renderLogCount(runLog.length);
}
function renderLogCount(n) { $('logCount').textContent = n; }
// 저장소가 키 순서를 바꾸므로 열 순서를 고정
const LOG_COLS = ['시각', '요청', '쇼핑몰', '상품명', '상품명_원문', '상품주소', '추천사이즈', '판정', '판정근거출처', '근거', '작업시간_초', '분석한상품수', '검색라운드', 'LLM호출수', '검색어', '맞았나_OX'];
function toCsv(rows) {
  const cols = LOG_COLS;
  const cell = (x) => `"${String(x ?? '').replace(/"/g, '""')}"`;
  return [cols.map(cell).join(','), ...rows.map((r) => cols.map((k) => cell(r[k])).join(','))].join('\r\n');
}
async function exportRunLog() {
  const { runLog = [] } = await area.get(LOG_KEY);
  if (!runLog.length) return;
  const d = new Date(), z = (n) => String(n).padStart(2, '0');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(['\ufeff' + toCsv(runLog)], { type: 'text/csv;charset=utf-8' }));   // BOM: 엑셀에서 한글 깨짐 방지
  a.download = `실행기록_${d.getFullYear()}${z(d.getMonth() + 1)}${z(d.getDate())}_${z(d.getHours())}${z(d.getMinutes())}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

function syncMode() {
  const real = $('mode').value === 'real';
  $('scenarioRow').hidden = real;
  $('modeNote').textContent = real ? '검색 → 사이즈 정보 읽기 → 판정까지 실제 실행 (LLM 호출: 상품당 0~1회, 요청 분석은 사전에 없는 품목만)' : 'LangGraph 흐름 확인용 · 노드는 가짜 함수';
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
    await area.set({ settings: { ...(await loadSettings()), apiKey: $('apiKey').value.trim(), platform: $('platform').value, heightCm: num($('heightCm').value), weightKg: num($('weightKg').value) } });
    $('saved').textContent = '저장했어요';
    setTimeout(() => ($('saved').textContent = ''), 1500);
  };

  renderLogCount(((await area.get(LOG_KEY)).runLog ?? []).length);
  $('logExport').onclick = exportRunLog;
  $('logClear').onclick = async () => {
    if ($('logClear').dataset.armed) { await area.set({ [LOG_KEY]: [] }); renderLogCount(0); $('logClear').textContent = '비우기'; delete $('logClear').dataset.armed; return; }
    $('logClear').dataset.armed = '1'; $('logClear').textContent = '한 번 더 누르면 비워요';         // 실수로 지우지 않게 두 번 누르기
    setTimeout(() => { delete $('logClear').dataset.armed; $('logClear').textContent = '비우기'; }, 3000);
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
    const query = $('query').value.trim();
    if (mode === 'real' && !query) { $('error').hidden = false; $('error').textContent = '요청을 입력해 주세요. 예: 남자 와이셔츠 키 179 75kg'; $('query').focus(); return; }
    const run = {
      threadId: `run-${Date.now()}`, mode, scenario: $('scenario').value, platform: s.platform ?? 'taobao',
      query: query || '여아 봄 원피스', profile: { heightCm: s.heightCm, weightKg: s.weightKg },
    };
    await area.set({ activeRun: run });
    execute(run, false);
  };
}
init();
