// 규칙 기반 요청 분석(quickParse) 정확도 측정 — LLM·API 키 없이 실행
//   cd app && node scripts/eval_intent_rule.mjs
// 주의: 평가 문장 30개를 보면서 규칙을 만들었으므로 참고치다 (새 문장으로 재측정 필요).
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { quickParse } from '../src/agent/intent.js';
import { lookup } from '../src/data/terms.js';

const APP = join(dirname(fileURLToPath(import.meta.url)), '..');
const { cases } = JSON.parse(readFileSync(join(APP, 'eval', 'intent_cases.json'), 'utf8'));
const canon = (v) => (typeof v === 'string' ? lookup(v)?.ko[0] ?? v.trim() : v);
function same(pred, exp) {
  if (Array.isArray(exp)) { const a = new Set((pred ?? []).map(canon)), b = new Set(exp.map(canon)); return a.size === b.size && [...b].every((x) => a.has(x)); }
  if (exp === null) return pred === null || pred === undefined;
  if (typeof exp === 'number') return Number(pred) === exp;
  return canon(pred) === canon(exp);
}
const field = {}, rows = [];
let ok = 0, tot = 0;
for (const c of cases) {
  const t = performance.now();
  const p = quickParse(c.query);
  const ms = +(performance.now() - t).toFixed(2);
  if (!p) { rows.push({ id: c.id, query: c.query, by: 'llm 필요' }); continue; }
  const wrong = [];
  for (const [f, e] of Object.entries(c.expect)) {
    field[f] ??= [0, 0]; field[f][1]++; tot++;
    if (same(p[f], e)) { ok++; field[f][0]++; } else wrong.push({ field: f, expected: e, got: p[f] });
  }
  rows.push({ id: c.id, query: c.query, by: 'rule', ms, wrong });
}
const rule = rows.filter((r) => r.by === 'rule');
const summary = {
  설명: '규칙 기반 요청 분석 (LLM 없음). 평가 문장을 보며 규칙을 만들었으므로 참고치',
  규칙처리: `${rule.length}/${cases.length}`,
  필드정확도: `${ok}/${tot} (${((ok / tot) * 100).toFixed(1)}%)`,
  문장완전정답: `${rule.filter((r) => !r.wrong.length).length}/${rule.length}`,
  필드별: Object.fromEntries(Object.entries(field).map(([f, [o, n]]) => [f, `${o}/${n}`])),
};
console.log(summary);
const d = new Date(), z = (n) => String(n).padStart(2, '0');
mkdirSync(join(APP, 'eval', '결과'), { recursive: true });
const out = join(APP, 'eval', '결과', `${d.getFullYear()}${z(d.getMonth() + 1)}${z(d.getDate())}_intent_rule.json`);
writeFileSync(out, JSON.stringify({ ...summary, rows }, null, 2));
console.log('결과 저장:', out);
