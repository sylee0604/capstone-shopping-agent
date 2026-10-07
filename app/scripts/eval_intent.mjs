// 의도 파악 정확도 측정 (필드 단위). LLM이 문장을 양식으로 옮긴 결과(프로필 보충 전)를 정답과 비교한다.
//
//   cd app
//   node scripts/eval_intent.mjs                 전체 30문장
//   node scripts/eval_intent.mjs --only i01,i02  일부만
//   node scripts/eval_intent.mjs --model gemini-2.5-flash
//
// API 키: 저장소 최상위 gemini_key.txt (POC와 같은 파일). 결과: eval/결과/날짜_intent.json
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeLlm } from '../src/llm/client.js';
import { intentPrompt, IntentSchema } from '../src/agent/intent.js';
import { lookup } from '../src/data/terms.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = join(HERE, '..');
const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
const GAP_MS = 4500;                                           // 무료 등급 분당 요청 제한 대비

const key = readFileSync(join(APP, '..', 'gemini_key.txt'), 'utf8').trim();
const { cases } = JSON.parse(readFileSync(join(APP, 'eval', 'intent_cases.json'), 'utf8'));
const only = opt('--only')?.split(',');
const todo = only ? cases.filter((c) => only.includes(c.id)) : cases;

// 같은 사전 항목이면 같은 값으로 본다 (예: 추리닝 = 트레이닝바지)
const canon = (v) => (typeof v === 'string' ? lookup(v)?.ko[0] ?? v.trim() : v);
function same(pred, exp) {
  if (Array.isArray(exp)) {
    const a = new Set((pred ?? []).map(canon)), b = new Set(exp.map(canon));
    return a.size === b.size && [...b].every((x) => a.has(x));
  }
  if (exp === null) return pred === null || pred === undefined;
  if (typeof exp === 'number') return Number(pred) === exp;
  return canon(pred) === canon(exp);
}

const llm = makeLlm({ provider: 'gemini', apiKey: key, model: opt('--model') ?? undefined, waits: [10_000, 20_000, 40_000],
  onRetry: ({ code, waitMs }) => console.log(`   서버 응답 ${code} → ${waitMs / 1000}초 후 재시도`) });
await llm.init();
console.log(`모델: ${llm.model} · ${todo.length}문장`);

const rows = [];
const field = {};                                               // 필드별 [맞음, 전체]
for (const [i, c] of todo.entries()) {
  if (i) await new Promise((r) => setTimeout(r, GAP_MS));
  const t = Date.now();
  let pred, error;
  try {
    const { system, prompt } = intentPrompt(c.query);
    pred = await llm.json({ system, prompt, schema: IntentSchema });
  } catch (e) { error = e.message; }
  const wrong = [];
  for (const [f, exp] of Object.entries(c.expect)) {
    field[f] ??= [0, 0];
    field[f][1]++;
    if (pred && same(pred[f], exp)) field[f][0]++;
    else wrong.push({ field: f, expected: exp, got: pred?.[f] });
  }
  rows.push({ id: c.id, query: c.query, sec: (Date.now() - t) / 1000, error, wrong, pred });
  console.log(`${c.id} ${error ? `오류: ${error}` : wrong.length ? `틀림 ${wrong.map((w) => `${w.field}(${JSON.stringify(w.got)}≠${JSON.stringify(w.expected)})`).join(', ')}` : '모두 맞음'}  "${c.query}"`);
}

const total = Object.values(field).reduce((a, [o, n]) => [a[0] + o, a[1] + n], [0, 0]);
const pct = ([o, n]) => (n ? `${((o / n) * 100).toFixed(1)}% (${o}/${n})` : '-');
console.log('\n필드별 정확도');
for (const [f, v] of Object.entries(field)) console.log(`  ${f.padEnd(10)} ${pct(v)}`);
console.log(`전체 ${pct(total)} · 문장 단위 완전 정답 ${rows.filter((r) => !r.error && !r.wrong.length).length}/${rows.length}`);
console.log(`LLM 호출 ${llm.usage.calls}회 (재시도 ${llm.usage.retries}, 형식 수정 ${llm.usage.repairs})`);

const d = new Date(), z2 = (n) => String(n).padStart(2, '0');
const stamp = `${d.getFullYear()}${z2(d.getMonth() + 1)}${z2(d.getDate())}_${z2(d.getHours())}${z2(d.getMinutes())}`;
mkdirSync(join(APP, 'eval', '결과'), { recursive: true });
const out = join(APP, 'eval', '결과', `${stamp}_intent.json`);
writeFileSync(out, JSON.stringify({ model: llm.model, time: stamp, fields: Object.fromEntries(Object.entries(field).map(([f, v]) => [f, pct(v)])), total: pct(total), usage: llm.usage, rows }, null, 2));
console.log('결과 저장:', out);
