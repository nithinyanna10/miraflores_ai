// Every number the demo shows must tie to ERRORS.md. Run: node scripts/reconcile.ts
// 1. For every audit finding whose fix states an amount for its line, the app's effect (effectOf) equals the
//    finding's tax effect in findings.json / ERRORS.md.
// 2. The mid-season scenario adjusts only through audit findings, each with that finding's exact effect.
// 3. The approval summary = v3 + the sum of those effects, printed as a reconciliation table.
import { readFileSync } from 'node:fs';
import { Graph, effectOf, proposedValue } from '../shared/packet.ts';
import { finalSummary } from '../shared/filing.ts';
import type { StoredEvent } from '../shared/policy.ts';
import { seedMidSeason } from '../server/scenario.ts';

const P = JSON.parse(readFileSync(new URL('../data/okafor_lindqvist_2025_packet.json', import.meta.url), 'utf8'));
const F = JSON.parse(readFileSync(new URL('../findings.json', import.meta.url), 'utf8'));
const g = new Graph(P);
const fail: string[] = [];
const fmt = (n: number) => (n < 0 ? '−' : '+') + Math.abs(n).toLocaleString('en-US');

// 1. Fix amounts and effects agree between the audit and the app
let checked = 0;
for (const f of F.findings) {
  const l = f.lines.map((k: string) => g.line(k)).find((x: any) => x && proposedValue(f, x) !== undefined);
  if (!l || !f.tax_effect) continue;
  const to = proposedValue(f, l)!;
  checked++;
  const e = effectOf(P, l, to - l.value);
  if (Math.abs(e.federal - f.tax_effect.federal) > 1 || Math.abs(e.california - f.tax_effect.california) > 1)
    fail.push(`${f.id} ${l.key}: app effect ${fmt(e.federal)}/${fmt(e.california)} vs ERRORS.md ${fmt(f.tax_effect.federal)}/${fmt(f.tax_effect.california)}`);
}
console.log(`1. ${checked} findings with a stated fix amount: app effect = ERRORS.md effect${fail.length ? ' (FAILED)' : ''}`);
fail.forEach(x => console.log('   ' + x));

// 2. Replay the mid-season scenario in memory
const log: StoredEvent[] = [];
const append = (actor: string, type: string, refs: string[], payload: any, at = '2026-03-04T09:30:00Z') => {
  const e = { seq: log.length + 1, at, actor, type, refs, payload } as StoredEvent;
  log.push(e);
  return e;
};
for (const f of F.findings) if (f.severity !== 'info') append('audit', 'finding_opened', [...f.lines, ...f.refs], f);
seedMidSeason(g, append, () => log);
const adjustments = log.filter(e => e.type === 'adjusted');
const byId = Object.fromEntries(F.findings.map((f: any) => [f.id, f]));
for (const a of adjustments) {
  const f = byId[a.payload.finding];
  if (!f) { fail.push(`scenario adjusts ${a.refs[0]} without an audit finding`); continue; }
  if (proposedValue(f, g.line(a.refs[0])!) !== a.payload.to) fail.push(`${f.id}: scenario sets ${a.refs[0]} to ${a.payload.to}, the fix says ${proposedValue(f, g.line(a.refs[0])!)}`);
  if (a.payload.effect.federal !== f.tax_effect.federal || a.payload.effect.california !== f.tax_effect.california)
    fail.push(`${f.id}: scenario effect ${fmt(a.payload.effect.federal)}/${fmt(a.payload.effect.california)} vs ERRORS.md ${fmt(f.tax_effect.federal)}/${fmt(f.tax_effect.california)}`);
}
console.log(`2. ${adjustments.length} scenario adjustments, each an audit finding's fix with its ERRORS.md effect`);

// 3. The reconciliation the client-approval summary rests on
const v3 = P.return_versions.find((v: any) => v.version === 'v3').summary;
const S = finalSummary(g, log);
let fed = 0, ca = 0;
console.log('\n3. Approval summary = v3 + adjustment effects (first order, change x v3 rate)\n');
console.log('   finding  line              federal tax   California tax');
for (const a of adjustments) {
  const e = a.payload.effect; fed += e.federal; ca += e.california;
  console.log(`   ${a.payload.finding.padEnd(8)} ${a.refs[0].padEnd(17)} ${fmt(e.federal).padStart(11)} ${fmt(e.california).padStart(16)}`);
}
console.log(`   ${'total'.padEnd(26)} ${fmt(fed).padStart(11)} ${fmt(ca).padStart(16)}`);
console.log(`\n   Federal: v3 total tax ${v3.federal.total_tax.toLocaleString()} ${fmt(fed)} = ${S.federal.total_tax.toLocaleString()}; balance ${v3.federal.balance_due.toLocaleString()} owed ${fmt(fed)} = ${S.federal.balance_due < 0 ? `refund ${(-S.federal.balance_due).toLocaleString()}` : `owed ${S.federal.balance_due.toLocaleString()}`}`);
console.log(`   California: v3 total tax ${v3.california.total_tax.toLocaleString()} ${fmt(ca)} = ${S.california.total_tax.toLocaleString()}; refund ${(-v3.california.balance_due).toLocaleString()} becomes ${(-S.california.balance_due).toLocaleString()}`);
if (S.federal.total_tax !== v3.federal.total_tax + fed || S.california.total_tax !== v3.california.total_tax + ca) fail.push('approval summary does not equal v3 + adjustment effects');

// What the rest of ERRORS.md would add if every error were fixed
const errs = F.findings.filter((f: any) => f.severity === 'error' && f.tax_effect);
const applied = new Set(adjustments.map(a => a.payload.finding));
const rest = errs.filter((f: any) => !applied.has(f.id));
const sum = (fs: any[], k: 'federal' | 'california', kind: string) => fs.filter(f => f.tax_effect.kind === kind).reduce((a, f) => a + f.tax_effect[k], 0);
console.log(`\n   ERRORS.md, all ${errs.length} errors with an effect. Tax: federal ${fmt(sum(errs, 'federal', 'tax'))}, California ${fmt(sum(errs, 'california', 'tax'))}; payments (balance due): federal ${fmt(sum(errs, 'federal', 'balance_due'))}, California ${fmt(sum(errs, 'california', 'balance_due'))}; header total ${fmt(F.error_tax_effect_total.federal)} / ${fmt(F.error_tax_effect_total.california)} is tax + payments` +
  `\n   Tax = scenario ${fmt(fed)} / ${fmt(ca)} + not yet applied ${fmt(sum(rest, 'federal', 'tax'))} / ${fmt(sum(rest, 'california', 'tax'))} (${rest.map((f: any) => f.id).join(', ')})`);
if (sum(errs, 'federal', 'tax') !== fed + sum(rest, 'federal', 'tax')) fail.push('scenario + remaining does not equal the ERRORS.md total');
if (F.error_tax_effect_total.federal !== errs.reduce((a: number, f: any) => a + f.tax_effect.federal, 0)) fail.push('ERRORS.md header total does not equal the sum of its errors');

if (fail.length) { console.error('\nFAIL\n' + fail.map(x => '  ' + x).join('\n')); process.exit(1); }
console.log('\nreconcile: ok');
