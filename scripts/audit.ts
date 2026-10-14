// Independent audit of the packet. Trusts printed_content, agency records and arithmetic;
// does not trust extracted_values or return_versions. Writes findings.json and ERRORS.md.
// Run: node scripts/audit.ts
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const RAW = readFileSync(new URL('../data/okafor_lindqvist_2025_packet.json', import.meta.url));
const P: any = JSON.parse(RAW.toString('utf8'));
const PACKET_SHA256 = createHash('sha256').update(RAW).digest('hex');

// ---------- indexes ----------
const docs: Record<string, any> = Object.fromEntries(P.documents.map((d: any) => [d.id, d]));
const evs: Record<string, any> = Object.fromEntries(P.extracted_values.map((e: any) => [e.id, e]));
const evsByDoc: Record<string, any[]> = {};
for (const e of P.extracted_values) (evsByDoc[e.document_id] ??= []).push(e);
const versions: Record<string, any> = Object.fromEntries(P.return_versions.map((v: any) => [v.version, v]));
const linesOf = (v: string): Record<string, any> => Object.fromEntries(versions[v].lines.map((l: any) => [l.key, l]));
const V3 = linesOf('v3');
const RATES = versions.v3.tax_effect_rates;
const py = P.prior_years;
const agency = P.tax_agency_records;
const params = P.engine_reference.parameters;
const qa = (id: string) => P.client.questionnaire.find((q: any) => q.id === id);
const msg = (id: string) => P.client.messages.find((m: any) => m.id === id);
const pageText = (docId: string, page: number) => docs[docId].pages.find((p: any) => p.page === page)?.printed_content ?? '';
const docText = (docId: string) => docs[docId].pages.map((p: any) => p.printed_content).join(' ');
const num = (s: string) => Number(s.replace(/[,$]/g, ''));
const money = (n: number) => (n < 0 ? '-' : '') + Math.abs(n).toLocaleString('en-US', { maximumFractionDigits: 2 });
const round = (n: number) => Math.round(n);
const evVal = (id: string) => evs[id]?.value;
const CA_RES = P.household.residency.find((r: any) => r.state === 'CA');

// JSON pointer (RFC 6901) for py:/ and agency:/ refs
function pointer(root: any, ptr: string): any {
  return ptr.split('/').slice(1).map(s => s.replace(/~1/g, '/').replace(/~0/g, '~'))
    .reduce((o, k) => (o == null ? undefined : o[k]), root);
}

// ---------- findings ----------
type Severity = 'error' | 'judgment' | 'warning' | 'info';
type Effect = { federal: number; california: number; kind: 'tax' | 'balance_due'; basis: string };
type Finding = {
  id: string; severity: Severity; check: string; title: string; detail: string;
  refs: string[]; lines: string[]; amount?: number; tax_effect?: Effect; fix?: string;
};
const findings: Finding[] = [];
const checks: Record<string, { ran: number; failed: number }> = {};
function ran(check: string, n = 1) { (checks[check] ??= { ran: 0, failed: 0 }).ran += n; }
function add(f: Omit<Finding, 'id'>) {
  const c = (checks[f.check] ??= { ran: 0, failed: 0 });
  c.failed++;
  c.ran = Math.max(c.ran, c.failed); // hand-written rules count one run per finding
  findings.push({ id: '', ...f });
}
// delta x v3 rate (readme: tax effect = change x tax_effect_rates). caCat overrides the California category.
function effect(cat: string, delta: number, caCat = cat, note = ''): Effect {
  return {
    federal: round(delta * RATES[cat].federal_per_dollar),
    california: round(delta * RATES[caCat].california_per_dollar),
    kind: 'tax',
    basis: `${money(delta)} x v3 rate ${cat}${caCat !== cat ? ` (CA: ${caCat})` : ''}${note ? '; ' + note : ''}`,
  };
}
const inCA = (date: string) => date >= CA_RES.from && date <= CA_RES.to;

// =====================================================================
// 1. Extracted values vs printed_content
// =====================================================================
const LOT_RE = /\b([A-Z]{1,2}\d+) (.+?) ([\d.]+) sh acquired (\S+) sold (\S+) proceeds ([\d,.]+) basis ((?:[\d,.]+)|\(not reported\)) (?:wash sale loss disallowed ([\d,.]+) )?(short|long)-term (covered|noncovered)/g;
type PrintedLot = { doc: string; page: number; lot: string; desc: string; qty: number; acquired: string; sold: string; proceeds: number; basis: number | null; wash: number; term: string; covered: boolean };
const printedLots: Record<string, Record<string, PrintedLot>> = {};
for (const d of P.documents) {
  for (const p of d.pages) {
    for (const m of p.printed_content.matchAll(LOT_RE)) {
      (printedLots[d.id] ??= {})[m[1]] = {
        doc: d.id, page: p.page, lot: m[1], desc: m[2].trim(), qty: Number(m[3]), acquired: m[4], sold: m[5],
        proceeds: num(m[6]), basis: m[7].includes('not') ? null : num(m[7]), wash: m[8] ? num(m[8]) : 0,
        term: m[9], covered: m[10] === 'covered',
      };
    }
  }
}
const lotField = /^([A-Z]{1,2}\d+)_(\w+)$/;
const handled = new Set<string>();
for (const [docId, lots] of Object.entries(printedLots)) {
  const extracted: Record<string, Record<string, any>> = {};
  for (const e of evsByDoc[docId] ?? []) {
    const m = e.field.match(lotField);
    if (m) { (extracted[m[1]] ??= {})[m[2]] = e; handled.add(e.id); }
  }
  for (const [lot, pl] of Object.entries(lots)) {
    ran('extraction_vs_printed');
    const ex = extracted[lot];
    if (!ex) {
      if (versions.v3.documents_superseded.includes(docId)) continue;
      add({
        severity: 'error', check: 'extraction_vs_printed', title: `${docId} lot ${lot} printed on page ${pl.page} was never extracted`,
        detail: `${pl.desc} ${pl.qty} sh, acquired ${pl.acquired}, sold ${pl.sold}, proceeds ${money(pl.proceeds)}, basis ${pl.basis == null ? 'not reported' : money(pl.basis)} (${pl.term}-term ${pl.covered ? 'covered' : 'noncovered'}). Extraction status: ${docs[docId].extraction.status} - ${docs[docId].extraction.reason ?? ''}`,
        refs: [`doc:${docId}#page${pl.page}`], lines: [], amount: pl.proceeds - (pl.basis ?? 0) + pl.wash,
        tax_effect: effect(pl.term === 'short' ? 'stcg' : 'ltcg', pl.proceeds - (pl.basis ?? 0) + pl.wash, inCA(pl.sold) ? 'ca_source_income' : undefined),
        fix: `Add lot ${lot} to Form 8949 (box ${pl.term === 'short' ? (pl.covered ? 'A' : 'B') : (pl.covered ? 'D' : 'E')}).`,
      });
      continue;
    }
    const cmp: [string, any, any][] = [
      ['proceeds', ex.proceeds?.value, pl.proceeds], ['basis', ex.basis?.value, pl.basis ?? 0],
      ['wash', ex.wash?.value, pl.wash], ['acquired', (ex.acquired ?? ex.acq)?.value, pl.acquired],
      ['sold', ex.sold?.value, pl.sold], ['term', ex.term?.value, pl.term],
    ];
    for (const [f, got, want] of cmp) {
      if (got === undefined) continue;
      const bad = typeof want === 'number' ? Math.abs((got ?? 0) - want) > 0.005 : String(got) !== String(want);
      if (bad) {
        const e = ex[f] ?? ex.acq;
        add({
          severity: 'error', check: 'extraction_vs_printed', title: `${docId} lot ${lot} ${f}: read ${got}, printed ${want}`,
          detail: `Extracted value ${e.id} (confidence ${e.confidence}) disagrees with page ${pl.page}.`, refs: [e.id, `doc:${docId}#page${pl.page}`], lines: [],
        });
      }
    }
  }
}

// Mileage log: trips per page vs page total, and extracted page totals vs printed
for (const p of docs.D23.pages) {
  ran('extraction_vs_printed');
  const trips = [...p.printed_content.matchAll(/\) (\d+) mi/g)].map((m: any) => Number(m[1]));
  const printedTotal = num(p.printed_content.match(/Page total ([\d,]+)/)[1]);
  const ev = (evsByDoc.D23 ?? []).find(e => e.field === 'page_total' && e.page === p.page);
  const sum = trips.reduce((a, b) => a + b, 0);
  if (sum !== printedTotal) add({ severity: 'warning', check: 'extraction_vs_printed', title: `D23 page ${p.page}: trips sum to ${sum}, page total says ${printedTotal}`, detail: '', refs: [`doc:D23#page${p.page}`], lines: [] });
  if (ev && ev.value !== printedTotal) add({ severity: 'error', check: 'extraction_vs_printed', title: `D23 page ${p.page} total read as ${ev.value}, printed ${printedTotal}`, detail: '', refs: [ev.id], lines: [] });
}
for (const e of evsByDoc.D23) if (/^trip/.test(e.field) || e.field === 'page_total') handled.add(e.id);

// Care-provider names and tax IDs on Form 2441 vs the provider statements
for (const l of Object.values(V3) as any[]) {
  if (l.rule !== 'R-DEP-CARE-PROVIDER') continue;
  ran('extraction_vs_printed');
  const m = l.label.match(/Care provider: (.+), tax ID (\S+)/);
  const doc = evs[l.sources[0]].document_id;
  handled.add(l.sources.find((x: string) => evs[x]?.field === 'ein'));
  const txt = docText(doc);
  const printedTin = txt.match(/Tax ID (\d{2}-\d{7})/)?.[1];
  const printedName = txt.split(',')[0];
  if (printedTin && printedTin !== m[2]) add({
    severity: 'error', check: 'extraction_vs_printed', title: `${l.key} provider tax ID ${m[2]} does not match ${doc} (${printedTin})`,
    detail: `Digits transposed on extraction (${l.sources[0]}, confidence ${evs[l.sources[0]].confidence}). A wrong provider TIN on Form 2441 draws an IRS mismatch notice.`,
    refs: [l.sources[0], doc], lines: [l.key], fix: `Use ${printedTin}.`,
  });
  if (!txt.includes(m[1])) add({
    severity: 'warning', check: 'extraction_vs_printed', title: `${l.key} provider name "${m[1]}" not on ${doc} ("${printedName}")`,
    detail: `Engine label does not match the provider statement. 2024 return used "${py.return_2024.lines['F2441.provider']}".`,
    refs: [doc, 'py:/return_2024/lines/F2441.provider'], lines: [l.key], fix: `Use "${printedName}".`,
  });
}

// Every other extracted value: the value must appear on its page.
function valueOnPage(e: any, txt: string): boolean {
  const v = e.value;
  if (v === null || v === undefined) return false;
  switch (e.value_type) {
    case 'money': case 'integer': case 'quantity': case 'percent': {
      const ns = [...txt.matchAll(/\d[\d,]*(?:\.\d+)?/g)].map(m => num(m[0]));
      return ns.some(n => Math.abs(n - Math.abs(v)) < 0.005 || (e.value_type === 'percent' && Math.abs(n - v * 100) < 0.005));
    }
    case 'date': { const [y, m, d] = String(v).split('-'); return txt.includes(v) || txt.includes(`${m}/${d}/${y}`) || txt.includes(`${m}/${y}`); }
    case 'boolean': return true; // checkboxes: nothing to compare against in text
    default: return txt.toLowerCase().includes(String(v).toLowerCase());
  }
}
for (const e of P.extracted_values) {
  if (handled.has(e.id) || e.confidence < 0.9) continue; // low confidence reported separately
  ran('extraction_vs_printed');
  const txt = pageText(e.document_id, e.page);
  if (valueOnPage(e, txt)) continue;
  // Value not printed. Is something else printed for that field?
  const usedBy = Object.values(V3).filter((l: any) => l.sources?.includes(e.id)).map((l: any) => l.key);
  const isZeroForBlank = e.value === 0 && e.text_as_read === '0.00';
  const sev: Severity = isZeroForBlank ? 'info' : (e.value === null ? 'warning' : 'error');
  add({
    severity: sev, check: 'extraction_vs_printed',
    title: `${e.document_id} ${e.label}: extracted ${JSON.stringify(e.value)} does not appear on page ${e.page}`,
    detail: `${e.id}, confidence ${e.confidence}, read as "${e.text_as_read}". Page says: "${txt.slice(0, 260)}${txt.length > 260 ? '...' : ''}"` + (usedBy.length ? ` Lands on: ${usedBy.join(', ')}.` : ' Not used on the return.'),
    refs: [e.id, `doc:${e.document_id}#page${e.page}`], lines: usedBy,
  });
}
for (const e of P.extracted_values) {
  if (e.confidence < 0.9) {
    ran('low_confidence');
    const usedBy = Object.values(V3).filter((l: any) => l.sources?.includes(e.id)).map((l: any) => l.key);
    add({
      severity: 'warning', check: 'low_confidence', title: `${e.document_id} ${e.label} read with confidence ${e.confidence}`,
      detail: `Value ${JSON.stringify(e.value)} ("${e.text_as_read}"). Page: "${pageText(e.document_id, e.page)}"` + (usedBy.length ? ` Lands on ${usedBy.join(', ')}.` : ''),
      refs: [e.id], lines: usedBy,
    });
  }
}

// =====================================================================
// 2. Duplicate documents, duplicate pages, same item reported twice
// =====================================================================
const moneySig = (docId: string) => (evsByDoc[docId] ?? []).filter(e => e.value_type === 'money' && e.value).map(e => `${e.field}=${e.value}`);
const docIds = Object.keys(docs);
const duplicateOf: Record<string, string> = {};
for (let i = 0; i < docIds.length; i++) for (let j = i + 1; j < docIds.length; j++) {
  const a = docs[docIds[i]], b = docs[docIds[j]];
  if (a.document_type !== b.document_type || a.tax_year !== b.tax_year) continue;
  const sa = moneySig(a.id), sb = new Set(moneySig(b.id));
  if (!sa.length) continue;
  ran('duplicate_documents');
  const overlap = sa.filter(x => sb.has(x)).length / Math.max(sa.length, sb.size);
  if (overlap < 0.8) continue;
  const corrected = a.marked_corrected || b.marked_corrected;
  if (!corrected) duplicateOf[b.id] = a.id;
  // does any v3 line take the same field from both?
  const both = (Object.values(V3) as any[]).filter(l => {
    const ds = (l.sources ?? []).filter((s: string) => evs[s]).map((s: string) => evs[s]);
    return ds.some((x: any) => x.document_id === a.id) && ds.some((x: any) => x.document_id === b.id && ds.some((y: any) => y.document_id === a.id && y.field === x.field));
  });
  add({
    severity: both.length ? 'error' : 'info', check: 'duplicate_documents',
    title: corrected ? `${b.id} is a CORRECTED reissue of ${a.id} (${Math.round(overlap * 100)}% of amounts identical)` : `${b.id} duplicates ${a.id} (${Math.round(overlap * 100)}% of amounts identical)`,
    detail: `${a.title} / ${b.title}. ${both.length ? 'Both are summed on ' + both.map(l => l.key).join(', ') : 'No v3 line takes the same field from both - counted once.'}`,
    refs: [a.id, b.id], lines: both.map(l => l.key),
  });
}
// Same page scanned twice inside one document
for (const d of P.documents) {
  const norm = (t: string) => t.replace(/^\([^)]*\)\s*/, '');
  for (let i = 0; i < d.pages.length; i++) for (let j = i + 1; j < d.pages.length; j++) {
    const a = norm(d.pages[i].printed_content), b = norm(d.pages[j].printed_content);
    if (a.length < 200 || a !== b) continue;
    ran('duplicate_documents');
    // page-level evs from both pages landing on the same line
    const pa = d.pages[i].page, pb = d.pages[j].page;
    const hit = (Object.values(V3) as any[]).filter(l => {
      const pages = (l.sources ?? []).filter((s: string) => evs[s]?.document_id === d.id).map((s: string) => evs[s].page);
      return pages.includes(pa) && pages.includes(pb);
    });
    const dupTotal = (evsByDoc[d.id] ?? []).find(e => e.page === pb && e.field === 'page_total')?.value;
    const eff = d.id === 'D23' && dupTotal ? effect('schc_profit', -dupTotal * params.mileage_rate, 'schc_profit', `${dupTotal} mi x ${params.mileage_rate}; also reduces SE tax`) : undefined;
    add({
      severity: hit.length ? 'error' : 'info', check: 'duplicate_documents',
      title: `${d.id} page ${pb} is a second scan of page ${pa}${hit.length ? ' and both are counted' : ''}`,
      detail: `${d.title}: page ${pb} reads "${d.pages[j].printed_content.slice(0, 90)}...". ${hit.length ? `${hit.map(l => `${l.key} (${money(l.value)})`).join(', ')} sums totals from both pages.` : ''}` +
        (dupTotal ? ` Business miles overstated by ${money(dupTotal)}; odometer ${evVal('ev-0478')}-${evVal('ev-0479')} = ${money(evVal('ev-0479') - evVal('ev-0478'))} total miles.` : ''),
      refs: [`doc:${d.id}#page${pa}`, `doc:${d.id}#page${pb}`], lines: hit.map(l => l.key),
      amount: dupTotal ? -dupTotal * params.mileage_rate : undefined, tax_effect: eff,
      fix: dupTotal ? `Exclude page ${pb}: business miles ${money(V3['SchC.44a'].value - dupTotal)}, car expense ${money((V3['SchC.44a'].value - dupTotal) * params.mileage_rate)}.` : undefined,
    });
  }
}
// One payer statement reported twice: equal Schedule B amounts whose source documents share an account number
{
  const sb = (Object.values(V3) as any[]).filter(l => /^SchB\.[15]\.\d+$/.test(l.key));
  for (let i = 0; i < sb.length; i++) for (let j = i + 1; j < sb.length; j++) {
    ran('duplicate_documents');
    if (sb[i].value !== sb[j].value) continue;
    const di = evs[sb[i].sources[0]]?.document_id, dj = evs[sb[j].sources[0]]?.document_id;
    if (!di || !dj || di === dj) continue;
    const acct = (t: string) => new Set([...t.matchAll(/ending (\d{4})/g)].map(m => m[1]));
    const ai = acct(docText(di)), aj = acct(docText(dj));
    const shared = [...ai].filter(x => aj.has(x));
    if (!shared.length) continue;
    add({
      severity: 'error', check: 'duplicate_documents',
      title: `Interest of ${money(sb[i].value)} counted twice: ${sb[i].key} and ${sb[j].key} are the same account (ending ${shared[0]})`,
      detail: `${di} ("${docs[di].title}") already includes the bank-sweep 1099-INT; ${dj} is the sweep bank's own copy of that same 1099-INT ("${docText(dj).slice(0, 120)}").`,
      refs: [sb[i].sources[0], sb[j].sources[0], di, dj], lines: [sb[i].key, sb[j].key, 'SchB.2'],
      amount: -sb[j].value, tax_effect: effect('interest', -sb[j].value), fix: `Remove ${sb[j].key}.`,
    });
  }
}

// =====================================================================
// 3. Corrected / superseded documents and what each version used
// =====================================================================
for (const d of P.documents.filter((d: any) => d.marked_corrected)) {
  const orig = P.documents.find((o: any) => o.id !== d.id && o.document_type === d.document_type && o.issuer === d.issuer && !o.marked_corrected);
  if (!orig) continue;
  ran('corrected_documents');
  const ov: Record<string, any> = Object.fromEntries((evsByDoc[orig.id] ?? []).map(e => [e.field, e]));
  const diffs = (evsByDoc[d.id] ?? []).filter(e => ov[e.field] && JSON.stringify(ov[e.field].value) !== JSON.stringify(e.value))
    .map(e => `${e.field}: ${JSON.stringify(ov[e.field].value)} -> ${JSON.stringify(e.value)}`);
  const usedBy = P.return_versions.map((v: any) => `${v.version}: ${v.documents_used.includes(d.id) ? d.id : v.documents_used.includes(orig.id) ? orig.id : 'neither'}`);
  const supersededOK = P.return_versions.every((v: any) => !v.documents_used.includes(d.id) || (v.documents_superseded.includes(orig.id) && !v.documents_used.includes(orig.id)));
  add({
    severity: supersededOK ? 'info' : 'error', check: 'corrected_documents',
    title: `${d.id} corrects ${orig.id}: ${diffs.length} field(s) changed`,
    detail: `${diffs.join('; ')}. Versions used: ${usedBy.join(', ')}. ${supersededOK ? 'Original superseded wherever the corrected copy is used.' : 'A version uses both or the wrong copy.'}`,
    refs: [orig.id, d.id], lines: [],
  });
}
// Broker summary vs detail: does the detail on the return add up to the broker's summary?
for (const [docId, sumField] of [['D31', 'b_summary_proceeds'], ['D74', 'st_proceeds']] as const) {
  ran('corrected_documents');
  const lots = Object.values(printedLots[docId] ?? {});
  const onReturn = (Object.values(V3) as any[]).filter(l => l.rule === 'R-8949-LOT' && l.sources.some((s: string) => evs[s]?.document_id === docId || evs[s]?.document_id === (docId === 'D31' ? 'D30' : docId)));
  const printedSum = lots.reduce((a, l) => a + l.proceeds, 0);
  const summary = docId === 'D74'
    ? evVal((evsByDoc.D74.find(e => e.field === 'st_proceeds')).id) + evVal((evsByDoc.D74.find(e => e.field === 'lt_proceeds')).id)
    : (evsByDoc[docId].find(e => e.field === sumField)).value;
  if (Math.abs(printedSum - summary) > 0.01 || onReturn.length !== lots.length) add({
    severity: 'warning', check: 'corrected_documents',
    title: `${docId}: ${lots.length} lots printed, ${onReturn.length} on the return (broker summary proceeds ${money(summary)})`,
    detail: `Lots printed but not on the return: ${lots.filter(pl => !onReturn.some(l => l.key.endsWith('.' + pl.lot))).map(pl => `${pl.lot} p${pl.page} proceeds ${money(pl.proceeds)}`).join(', ')}. The engine's own BROKER_SUMMARY_DETAIL_MISMATCH diagnostic flagged the 250 gap in every version; nothing resolved it.`, refs: [docId], lines: [],
  });
  else add({ severity: 'info', check: 'corrected_documents', title: `${docId}: all ${lots.length} lots on the return; detail proceeds ${money(printedSum)} = broker summary`, detail: '', refs: [docId], lines: [] });
}

// =====================================================================
// 4. Recompute every sum and carry line from its inputs; every lot from its sources
// =====================================================================
const asNum = (x: any) => (typeof x === 'number' ? x : NaN);
function signCombos(n: number): number[][] {
  const out: number[][] = [];
  for (let m = 0; m < 1 << n; m++) out.push(Array.from({ length: n }, (_, i) => (m >> i) & 1 ? -1 : 1));
  return out;
}
const sumFails: any[] = [];
for (const v of P.return_versions) {
  const L = linesOf(v.version);
  for (const l of v.lines) {
    if ((l.rule !== 'R-SUM' && l.rule !== 'R-CARRY') || !l.inputs.length) continue; // input-less R-SUM lines sum sources: checked below
    ran('recompute_sums');
    let inputs: string[] = [...l.inputs];
    // Schedule CA column D = A - B + C (engine lists only column A)
    if (/^SchCA540NR\.\d+\.D$/.test(l.key) && inputs.length === 1) {
      const base = l.key.slice(0, -2);
      for (const c of ['B', 'C']) if (L[`${base}.${c}`]) inputs.push(`${base}.${c}`);
    }
    const vals = inputs.map(k => asNum(L[k]?.value));
    const missing = inputs.filter(k => !L[k]);
    if (vals.some(Number.isNaN) && !missing.length) continue; // text lines
    const vs = vals.map(x => (Number.isNaN(x) ? 0 : x));
    const tol = 1.01;
    let ok = false, how = '';
    const tryIt = (signs: number[]) => {
      const s = vs.reduce((a, x, i) => a + signs[i] * x, 0);
      if (Math.abs(s - l.value) <= tol) { ok = true; how = inputs.map((k, i) => `${signs[i] < 0 ? '-' : '+'}${k}`).join(' '); }
      return ok;
    };
    if (l.rule === 'R-CARRY' && vs.length) { ok = vs.some(x => Math.abs(x - l.value) <= tol) || tryIt(vs.map(() => 1)); }
    else if (!tryIt(vs.map(() => 1)) && !tryIt(vs.map((_, i) => (i ? -1 : 1)))) {
      if (vs.length <= 4) signCombos(vs.length).some(tryIt);
      // Floors: a sum line may floor at zero (e.g. AMT = max(0, TMT - regular))
      if (!ok && l.value === 0) ok = vs.length === 2 && vs[0] - vs[1] <= 0;
    }
    if (!ok) sumFails.push({
      version: v.version, severity: 'error', check: 'recompute_sums',
      title: `${v.version} ${l.key} (${l.label}) = ${money(l.value)}, inputs give ${money(vs.reduce((a, b) => a + b, 0))}`,
      detail: `Inputs: ${inputs.map((k, i) => `${k}=${money(vs[i])}`).join(', ')}${missing.length ? `; missing lines: ${missing.join(', ')}` : ''}.`,
      refs: [], lines: [l.key],
    });
  }
  // 8949 lots: proceeds - basis + adjustment, each from its own source values
  for (const l of v.lines.filter((l: any) => l.rule === 'R-8949-LOT')) {
    ran('recompute_sums');
    const m = l.label.match(/proceeds (\d[\d,]*(?:\.\d+)?), basis (\d[\d,]*(?:\.\d+)?)(?:, adjustment (\w) (-?\d[\d,]*(?:\.\d+)?))?/);
    if (!m) continue;
    const calc = num(m[1]) - num(m[2]) + (m[4] ? num(m[4]) : 0);
    if (Math.abs(calc - l.value) > 0.01) sumFails.push({ version: v.version, severity: 'error', check: 'recompute_sums', title: `${v.version} ${l.key} = ${l.value}, label arithmetic gives ${calc}`, detail: l.label, refs: l.sources, lines: [l.key] });
    const srcMoney = l.sources.map((s: string) => evs[s]).filter((e: any) => e && /_(proceeds|basis)$/.test(e.field));
    for (const e of srcMoney) {
      const labelled = e.field.endsWith('proceeds') ? num(m[1]) : num(m[2]);
      if (e.value != null && Math.abs(e.value - labelled) > 0.01 && !(e.field.endsWith('basis') && l.sources.some((s: string) => evs[s]?.field?.endsWith('adjusted_basis'))))
        sumFails.push({ version: v.version, severity: 'error', check: 'recompute_sums', title: `${v.version} ${l.key}: label ${e.field.split('_')[1]} ${labelled} vs source ${e.id} ${e.value}`, detail: '', refs: [e.id], lines: [l.key] });
    }
  }
  // 8949 box totals: proceeds/basis/adjustments in the label vs lot sums
  for (const l of v.lines.filter((l: any) => /^F8949\.[A-Z]\.total$/.test(l.key))) {
    ran('recompute_sums');
    const lots = l.inputs.map((k: string) => L[k]);
    const parts = lots.map((x: any) => x.label.match(/proceeds (\d[\d,]*(?:\.\d+)?), basis (\d[\d,]*(?:\.\d+)?)(?:, adjustment \w (-?\d[\d,]*(?:\.\d+)?))?/)).filter(Boolean);
    const P_ = parts.reduce((a: number, m: any) => a + num(m[1]), 0), B_ = parts.reduce((a: number, m: any) => a + num(m[2]), 0);
    const lm = l.label.match(/proceeds (\d[\d,]*(?:\.\d+)?); basis (\d[\d,]*(?:\.\d+)?)/);
    if (lm && parts.length === lots.length && (Math.abs(num(lm[1]) - P_) > 0.02 || Math.abs(num(lm[2]) - B_) > 0.02))
      sumFails.push({ version: v.version, severity: 'error', check: 'recompute_sums', title: `${v.version} ${l.key}: label totals differ from lots`, detail: `label proceeds ${lm[1]} basis ${lm[2]}; lots ${money(P_)} / ${money(B_)}`, refs: [], lines: [l.key] });
  }
}
// Report v3 failures, and earlier-version failures only where v3 no longer fails on that line
for (const f of sumFails) {
  const { version, ...rest } = f;
  if (version !== 'v3' && sumFails.some(g => g.version === 'v3' && g.lines[0] === f.lines[0])) continue;
  add(rest);
}
// Rules where the line should equal the plain sum of its money sources
const SOURCE_SUM_RULES = new Set(['R-SUM', 'R-W2-BOX1-SUM', 'R-W2-BOX2-SUM', 'R-W2-BOX17-SUM', 'R-BOOKS-LINE', 'R-RENTAL-LINE', 'R-K1', 'R-MILEAGE-PAGE-TOTALS', 'R-CHARITY-CASH', 'R-DEP-CARE-PROVIDER', 'R-ESTIMATED-PAYMENTS', 'R-CA-ESTIMATED-PAYMENTS']);
for (const l of Object.values(V3) as any[]) {
  if (!SOURCE_SUM_RULES.has(l.rule) || (l.rule === 'R-SUM' && l.inputs.length)) continue;
  ran('recompute_sums');
  const ms = l.sources.map((s: string) => evs[s]).filter((e: any) => e && e.value_type === 'money');
  if (!ms.length) continue;
  // Sources may corroborate each other (books + contractor report): accept the sum of any one document's values
  const byDoc: Record<string, number> = {};
  for (const e of ms) byDoc[e.document_id] = (byDoc[e.document_id] ?? 0) + e.value;
  const s = ms.reduce((a: number, e: any) => a + e.value, 0);
  if (Math.abs(s - l.value) > 1 && ![...Object.values(byDoc), ...ms.map((e: any) => e.value)].some(x => Math.abs(x - l.value) <= 1)) add({
    severity: 'warning', check: 'recompute_sums', title: `${l.key} = ${money(l.value)}; document sources support ${money(s)}`,
    detail: `${l.label}. Sources: ${ms.map((e: any) => `${e.id} ${e.document_id} ${e.field} ${money(e.value)}`).join('; ')}. ${l.note ?? ''}`,
    refs: l.sources, lines: [l.key],
  });
}

// =====================================================================
// 5. Version deltas explained by changes_from_previous
// =====================================================================
for (let i = 1; i < P.return_versions.length; i++) {
  const a = P.return_versions[i - 1], b = P.return_versions[i];
  const La = linesOf(a.version), Lb = linesOf(b.version);
  const listed = new Map(b.changes_from_previous.map((c: any) => [c.key, c]));
  const actual: any[] = [];
  for (const k of new Set([...Object.keys(La), ...Object.keys(Lb)])) {
    const x = La[k]?.value, y = Lb[k]?.value;
    if (JSON.stringify(x) !== JSON.stringify(y)) actual.push({ key: k, old: x, new: y });
  }
  ran('version_deltas', actual.length + listed.size);
  const unlisted = actual.filter(c => !listed.has(c.key));
  const wrong = actual.filter(c => listed.has(c.key) && ((listed.get(c.key) as any).new !== c.new || ((listed.get(c.key) as any).old ?? undefined) !== c.old));
  const phantom = [...listed.keys()].filter(k => !actual.some(c => c.key === k));
  const docsAdded = b.documents_used.filter((d: string) => !a.documents_used.includes(d));
  const docsDropped = a.documents_used.filter((d: string) => !b.documents_used.includes(d));
  add({
    severity: unlisted.length || wrong.length || phantom.length ? 'warning' : 'info', check: 'version_deltas',
    title: `${a.version} -> ${b.version}: ${actual.length} lines changed, ${listed.size} listed in changes_from_previous`,
    detail: `Trigger: ${b.trigger} Documents added: ${docsAdded.join(', ') || 'none'}; dropped: ${docsDropped.join(', ') || 'none'}; newly superseded: ${b.documents_superseded.filter((d: string) => !a.documents_superseded.includes(d)).join(', ') || 'none'}. ` +
      `Federal total tax ${money(a.summary.federal.total_tax)} -> ${money(b.summary.federal.total_tax)}; CA ${money(a.summary.california.total_tax)} -> ${money(b.summary.california.total_tax)}.` +
      (unlisted.length ? ` Unlisted changes: ${unlisted.map(c => `${c.key} ${c.old}->${c.new}`).join('; ')}.` : '') +
      (wrong.length ? ` Listed with wrong values: ${wrong.map(c => c.key).join(', ')}.` : '') +
      (phantom.length ? ` Listed but not actually changed: ${phantom.join(', ')}.` : ''),
    refs: [a.version, b.version], lines: unlisted.map(c => c.key),
  });
  // Docs added with no effect on any line
  for (const d of docsAdded) {
    const used = b.lines.some((l: any) => l.sources.some((s: string) => s === d || evs[s]?.document_id === d));
    if (!used) add({ severity: 'warning', check: 'version_deltas', title: `${b.version} lists ${d} as used but no line draws on it`, detail: docs[d].title, refs: [d], lines: [] });
  }
}

// =====================================================================
// 6. 2025 vs 2024 swings against the firm's variance standard
// =====================================================================
{
  const std = P.firm.starter_standards.variance_review;
  const pyL = py.return_2024.lines, pyLab = py.return_2024.line_labels;
  const payer = (label: string) => label.replace(/^(Interest|Dividends|Ordinary dividends) - /, '').split(/[ (,]/).slice(0, 2).join(' ');
  const pairs: [string, string, string][] = []; // [py key, v3 key, label]
  const v3SchB = (Object.values(V3) as any[]).filter(l => /^SchB\.[15]\.\d+$/.test(l.key));
  const pySchB = Object.keys(pyL).filter(k => /^SchB\.[15]\.\d+$/.test(k));
  for (const k of pySchB) {
    const match = v3SchB.find(l => l.key.split('.')[1] === k.split('.')[1] && payer(l.label) === payer(pyLab[k]));
    pairs.push([k, match?.key ?? '', pyLab[k]]);
  }
  for (const l of v3SchB) if (!pairs.some(p => p[1] === l.key)) pairs.push(['', l.key, l.label]);
  for (const k of Object.keys(pyL)) if (!k.startsWith('SchB.1.') && !k.startsWith('SchB.5.') && V3[k] !== undefined) pairs.push([k, k, pyLab[k]]);
  pairs.push(['SchC.27a', 'SchC.27a.1+SchC.27a.2', 'Other expenses'], ['F8938', 'F8938.1.max', 'Form 8938 maximum value']);
  for (const [pk, vk, label] of pairs) {
    ran('prior_year_variance');
    const pv = pk ? pyL[pk] : 0;
    const cv = vk ? vk.split('+').reduce((a, k) => a + (asNum(V3[k]?.value) || 0), 0) : 0;
    if (typeof pv !== 'number' || Number.isNaN(cv)) continue;
    const d = cv - pv, pct = pv ? Math.abs(d / pv) * 100 : Infinity, signed = pv ? Math.round(d / Math.abs(pv) * 100) : 0;
    if (Math.abs(d) <= std.and_over_amount || pct <= std.flag_if_change_over_percent) continue;
    const note = pk && py.return_2024.notes[pk] ? ` 2024 note: "${py.return_2024.notes[pk]}"` : '';
    add({
      severity: 'warning', check: 'prior_year_variance',
      title: `${vk || '(none)'} ${label}: ${money(pv)} (2024) -> ${money(cv)} (2025), ${pv ? (signed > 0 ? '+' : '') + signed + '%' : 'new'}`,
      detail: (pk ? `2024 ${pk} (${py.return_2024.line_sources[pk]}).` : `No 2024 line for this payer${vk ? `: ${V3[vk.split('+')[0]]?.label}` : ''}.`) + note + ' Needs a variance explanation.',
      refs: pk ? [`py:/return_2024/lines/${pk}`] : [], lines: vk ? vk.split('+') : [],
    });
  }
}

// =====================================================================
// 7. Carryovers in vs prior years; carryovers out
// =====================================================================
for (const l of Object.values(V3) as any[]) {
  if (l.rule !== 'R-PRIOR-YEAR-CARRY') continue;
  ran('carryovers');
  const pyVals = l.sources.filter((s: string) => s.startsWith('py:')).map((s: string) => pointer(py, s.slice(3)));
  const sum = pyVals.reduce((a: number, x: any) => a + (typeof x === 'number' ? x : 0), 0);
  if (Math.abs(Math.abs(l.value) - Math.abs(sum)) > 1) add({
    severity: 'error', check: 'carryovers', title: `${l.key} carries ${money(l.value)}, prior-year record says ${money(sum)}`,
    detail: l.sources.join(', '), refs: l.sources, lines: [l.key],
  });
}
{
  // Recompute the 2024 capital loss carryover split from the 2024 return itself
  ran('carryovers');
  const st = -py.return_2024.lines['SchD.7'], lt = -py.return_2024.lines['SchD.15'], allowed = -py.return_2024.lines['SchD.21'];
  const stCarry = Math.max(0, st - allowed), ltCarry = lt - Math.max(0, allowed - st);
  const c = py.carryovers_into_2025;
  if (stCarry !== c.capital_loss_short || ltCarry !== c.capital_loss_long)
    add({ severity: 'error', check: 'carryovers', title: `2024 capital loss carryover recomputes to ST ${stCarry} / LT ${ltCarry}, records say ${c.capital_loss_short} / ${c.capital_loss_long}`, detail: '', refs: ['py:/carryovers_into_2025'], lines: ['SchD.6', 'SchD.14'] });
  // Passive loss allocation per the prior preparer's stated method
  ran('carryovers');
  const pr = py.return_2024.lines;
  const priorA = num(py.return_2024.line_labels['F8582.1c'].match(/A ([\d,]+)/)[1]), priorB = num(py.return_2024.line_labels['F8582.1c'].match(/B ([\d,]+)/)[1]);
  const lossA = -pr['SchE.21A'] + priorA, lossB = -pr['SchE.21B'] + priorB, unallowed = -pr['F8582.4'];
  const a = round(unallowed * lossA / (lossA + lossB)), b = unallowed - a;
  if (a !== c.passive_1450_fremont || b !== c.passive_1200_barton_hills)
    add({ severity: 'error', check: 'carryovers', title: `2024 suspended passive losses recompute to A ${a} / B ${b}, records say ${c.passive_1450_fremont} / ${c.passive_1200_barton_hills}`, detail: '', refs: ['py:/carryovers_into_2025'], lines: ['F8582.1c'] });
  // The prior preparer's printed carryover worksheet (D07 p6) vs structured carryovers
  ran('carryovers');
  const w = pageText('D07', 6);
  for (const [k, re] of [['capital_loss_short', /short-term ([\d,]+)/], ['capital_loss_long', /long-term ([\d,]+)/], ['passive_1450_fremont', /Fremont Way ([\d,]+)/], ['passive_1200_barton_hills', /4C ([\d,]+)/]] as const) {
    const m = w.match(re);
    if (m && num(m[1]) !== c[k]) add({ severity: 'error', check: 'carryovers', title: `D07 carryover worksheet ${k} ${m[1]} vs prior_years ${c[k]}`, detail: '', refs: ['doc:D07#page6', `py:/carryovers_into_2025/${k}`], lines: [] });
  }
  // Carryovers out of v3 that should tie to v3 lines / documents
  const co = versions.v3.carryovers_out.federal;
  const ties: [string, number, number, string[]][] = [
    ['minimum_tax_credit_from_2025_amt', co.minimum_tax_credit_from_2025_amt, V3['F6251.11'].value, ['F6251.11']],
    ['sep_contribution_not_deductible_for_2025', co.sep_contribution_not_deductible_for_2025, evVal('ev-0485') - V3['Sch1.16'].value, ['Sch1.16', 'ev-0485']],
    ['ridgeline_capital_account_end', co.ridgeline_capital_account_end, evVal('ev-0970'), ['ev-0970']],
    ['scorp_stock_basis_end', co.scorp_stock_basis_end, V3['F7203.15'].value, ['F7203.15']],
    ['ira_nondeductible_basis_ngozi', co.ira_nondeductible_basis_ngozi, V3['F8606.14'].value, ['F8606.14']],
  ];
  for (const [k, out, want, refs] of ties) {
    ran('carryovers');
    if (Math.abs(out - want) > 1) add({ severity: 'error', check: 'carryovers', title: `Carryover out ${k} ${out} does not tie to ${want}`, detail: '', refs, lines: [] });
  }
}

// =====================================================================
// 8. Basis rollforwards with gaps
// =====================================================================
{
  // S corporation stock basis: 2022 worksheet -> 2023 K-1 (D40) -> 2024 K-1 (prior return) -> 2025 K-1 (D39)
  ran('basis_rollforward');
  const rec = py.basis_records.scorp_lindqvist_family_woodworks;
  let basis = rec.find((r: any) => r.year === 2022).ending_stock_basis;
  const steps: string[] = [`2022 end ${money(basis)} (client worksheet, no K-1 in file)`];
  const k23 = Object.fromEntries((evsByDoc.D40 ?? []).map(e => [e.field, e.value]));
  const y23 = basis + (k23.box1 ?? 0) + (k23.box4 ?? 0) - (k23.box16d ?? 0);
  steps.push(`2023 ${money(basis)} + ${money(k23.box1)} + ${money(k23.box4)} - ${money(k23.box16d)} = ${money(y23)} (D40, received ${docs.D40.received_at.slice(0, 10)})`);
  const k24 = py.return_2024.K1_1120S;
  const y24 = y23 + k24.box1 - k24.box16D;
  steps.push(`2024 ${money(y23)} + ${money(k24.box1)} - ${money(k24.box16D)} = ${money(y24)}`);
  for (const v of ['v1', 'v2', 'v3']) {
    const beg = linesOf(v)['F7203.1'].value;
    if (beg !== y24) {
      const excess = linesOf(v)['F7203.excess'].value;
      add({
        severity: v === 'v3' ? 'error' : 'info', check: 'basis_rollforward',
        title: `${v} F7203.1 beginning stock basis ${money(beg)} vs rollforward ${money(y24)}`,
        detail: `${steps.join('; ')}. ${v} assumed no change for the missing year; gain from distributions in excess of basis in ${v}: ${money(excess)}.${v !== 'v3' ? ' Fixed in v3 once D40 arrived.' : ''}`,
        refs: ['py:/basis_records/scorp_lindqvist_family_woodworks', 'D40', 'D39'], lines: ['F7203.1'],
      });
    }
  }
  add({
    severity: 'info', check: 'basis_rollforward', title: `S corp basis rollforward now complete: 2024 ending basis ${money(y24)}; 2025 distributions ${money(evVal('ev-0977'))} exceed basis by ${money(V3['F7203.excess'].value)}`,
    detail: `${steps.join('; ')}. 2025: ${money(y24)} + ${money(evVal('ev-0975'))} + ${money(evVal('ev-0976'))} - ${money(evVal('ev-0977'))} -> ${money(V3['F7203.excess'].value)} capital gain (F8949.F.SCORP). Prior preparer "assumed basis sufficient" for 2024 without D40: it was, by ${money(y24)}. D39 notes ${money(evVal('ev-0982'))} Oregon composite tax is inside the distributions.`,
    refs: ['D40', 'D39', 'py:/prior_preparer_workpaper/notes/0'], lines: ['F7203.1', 'F7203.excess'],
  });

  // Partnership: capital account rollforward from D37 printed text; outside basis never computed
  ran('basis_rollforward');
  const t = docText('D37');
  const capBeg = num(t.match(/beginning ([\d,]+)/)[1]), inc = num(t.match(/net income ([\d,]+)/)[1]);
  const wd = num(t.match(/distributions \(([\d,]+)\)/)[1]), ftx = num(t.match(/foreign taxes \(([\d,]+)\)/)[1]), end = num(t.match(/ending ([\d,]+)/)[1]);
  const pyEnd = py.basis_records.partnership_ridgeline[0].ending_capital_account;
  const k1Income = evVal('ev-0964') + evVal('ev-0965') + evVal('ev-0966');
  add({
    severity: 'warning', check: 'basis_rollforward', title: `Ridgeline outside basis has never been computed (capital account only)`,
    detail: `Capital ${money(capBeg)} (2024 end per prior year ${money(pyEnd)}) + ${money(inc)} - ${money(wd)} - ${money(ftx)} = ${money(capBeg + inc - wd - ftx)} (K-1 says ${money(end)}). K-1 income items (box 2 + 5 + 9a) = ${money(k1Income)} vs current-year net income ${money(inc)}. Outside basis (capital + share of liabilities) is unknown; distributions of ${money(wd)} are only safe while basis exceeds them.`,
    refs: ['D37', 'py:/basis_records/partnership_ridgeline/0'], lines: ['SchE.28B'],
  });

  // IRA basis: 2024 Form 8606 line 14 vs Form 5498 for 2024 vs questionnaire
  ran('basis_rollforward');
  const b24 = py.basis_records.ira_nondeductible_basis_ngozi[0].form_8606_line_14;
  if (b24 !== evVal('ev-0991')) add({ severity: 'error', check: 'basis_rollforward', title: `IRA basis ${b24} vs 2024 Form 5498 ${evVal('ev-0991')}`, detail: '', refs: ['D42'], lines: ['F8606.2'] });

  // Depreciation: prior accumulated per year-by-year records vs v3 and the printed schedule (D07 p4); 2025 SL recompute
  const d07 = pageText('D07', 4);
  for (const a of py.asset_records) {
    ran('basis_rollforward');
    const fedAcc = Object.values(a.federal as Record<string, number>).reduce((x, y) => x + y, 0);
    const caAcc = Object.values(a.california as Record<string, number>).reduce((x, y) => x + y, 0);
    const v3a = versions.v3.assets.find((x: any) => x.asset_id === a.asset_id);
    const printed = d07.match(new RegExp(`${a.asset_id} .*? federal ([\\d,.]+) California ([\\d,.]+)`));
    const probs: string[] = [];
    if (printed && (Math.abs(num(printed[1]) - fedAcc) > 0.02 || Math.abs(num(printed[2]) - caAcc) > 0.02)) probs.push(`D07 schedule says fed ${printed[1]} / CA ${printed[2]}, year records sum to ${money(fedAcc)} / ${money(caAcc)}`);
    if (v3a && Math.abs(v3a.federal.prior_accumulated - fedAcc) > 0.02) probs.push(`v3 prior accumulated fed ${v3a.federal.prior_accumulated} vs ${fedAcc.toFixed(2)}`);
    if (v3a && Math.abs(v3a.california.prior_accumulated - caAcc) > 0.02) probs.push(`v3 prior accumulated CA ${v3a.california.prior_accumulated} vs ${caAcc.toFixed(2)}`);
    if (v3a && /SL \/ mid-month/.test(a.method)) {
      const annual = a.cost / a.life_years;
      const months = a.disposed ? Number(a.disposed.slice(5, 7)) - 0.5 : 12;
      const dep = Math.min(annual * months / 12, a.cost - fedAcc);
      if (Math.abs(dep - v3a.federal.depreciation_2025) > 0.05) probs.push(`2025 depreciation recomputes to ${dep.toFixed(2)}, v3 has ${v3a.federal.depreciation_2025}`);
    }
    if (!v3a && !a.disposed && a.method !== 'Section 179') probs.push('missing from v3 assets');
    if (probs.length) add({ severity: 'error', check: 'basis_rollforward', title: `Asset ${a.asset_id}: ${probs[0]}`, detail: probs.join('; '), refs: [`asset:${a.asset_id}`, 'doc:D07#page4'], lines: [] });
  }
  // Condo sale: recompute 4797 from the closing statement
  ran('basis_rollforward');
  const cs = docText('D51');
  const price = num(cs.match(/Contract sales price ([\d,.]+)/)[1]);
  const sell = num(cs.match(/commissions ([\d,.]+)/)[1]) + num(cs.match(/escrow fees ([\d,.]+)/)[1]);
  const cost = num(cs.match(/purchase \S+ for ([\d,.]+)/)[1]) + num(cs.match(/Flooring replaced \S+ for ([\d,.]+)/)[1]);
  const acc = versions.v3.assets.filter((x: any) => x.asset_id.startsWith('AUS')).reduce((s: number, x: any) => s + x.federal.accumulated_end, 0);
  const gain = price - (cost + sell - acc);
  if (Math.abs(gain - V3['F4797.25'].value) > 1) add({ severity: 'error', check: 'basis_rollforward', title: `Condo gain recomputes to ${money(gain)}, F4797.25 = ${money(V3['F4797.25'].value)}`, detail: '', refs: ['D51'], lines: ['F4797.25'] });
}

// =====================================================================
// 9. SEK conversions vs fx_rates
// =====================================================================
for (const l of Object.values(V3) as any[]) {
  const fxRef = l.sources.find((s: string) => s.startsWith('ref:fx.'));
  if (!fxRef) continue;
  ran('fx_conversion');
  const [, cur, rateKey] = fxRef.match(/^ref:fx\.(\w+)\.(\w+)$/);
  const rate = P.fx_rates[`${cur}_per_USD`][rateKey];
  const sek = evs[l.sources.find((s: string) => evs[s])];
  const usd = sek.value / rate;
  if (Math.abs(usd - l.value) > 1) add({ severity: 'error', check: 'fx_conversion', title: `${l.key}: ${money(sek.value)} SEK / ${rate} = ${money(round(usd))}, line says ${money(l.value)}`, detail: '', refs: [sek.id, fxRef], lines: [l.key] });
  const isIncome = /interest|dividend/i.test(l.label);
  const yr = Number(rateKey.slice(0, 4));
  if (isIncome && (yr !== P.household.tax_year || !rateKey.includes('average'))) {
    const right = Object.entries(P.fx_rates[`${cur}_per_USD`]).find(([k]) => k === `${P.household.tax_year}_average`);
    const correct = round(sek.value / (right![1] as number));
    add({
      severity: 'error', check: 'fx_conversion',
      title: `${l.key} converts 2025 income at the ${rateKey} rate (${rate}); 2025 average is ${right![1]}`,
      detail: `${money(sek.value)} SEK / ${right![1]} = ${money(correct)} vs ${money(l.value)} on the return. The 2024 return used 10.56 for 2024 interest; the engine reused it.`,
      refs: [sek.id, fxRef, `ref:fx.${cur}.${right![0]}`], lines: [l.key, 'SchB.2'],
      amount: correct - l.value, tax_effect: effect('interest', correct - l.value), fix: `Use ${right![0]}: ${money(correct)}.`,
    });
  }
}

// =====================================================================
// 10. Documents with zero landings, and unlanded values in documents that did land
// =====================================================================
const landingsByDoc: Record<string, Set<string>> = {};
const landedEvs = new Set<string>();
const ADMIN_TYPES = new Set(['engagement_letter', 'consent_7216', 'identity_document', 'irs_ip_pin_notice']);
{
  for (const l of Object.values(V3) as any[]) for (const s of [...l.sources, ...l.inputs]) {
    const d = evs[s]?.document_id ?? (docs[s] ? s : s.match(/^doc:(D\d+)/)?.[1]);
    if (evs[s]) landedEvs.add(s);
    if (d) (landingsByDoc[d] ??= new Set()).add(l.key);
    if (s.startsWith('py:')) {
      // prior-year refs land on D06 (return lines) / D07 (workpaper, assets, basis, carryovers)
      const target = s.startsWith('py:/return_2024') ? 'D06' : 'D07';
      (landingsByDoc[target] ??= new Set()).add(l.key);
    }
    if (s.startsWith('asset:')) (landingsByDoc.D07 ??= new Set()).add(l.key);
  }
  for (const d of P.documents) {
    ran('document_landings');
    const n = landingsByDoc[d.id]?.size ?? 0;
    if (n) continue;
    const superseded = versions.v3.documents_superseded.includes(d.id);
    const reason = duplicateOf[d.id] ? `duplicate image of ${duplicateOf[d.id]}, counted once` : superseded ? `superseded by a corrected copy in v3`
      : d.extraction.status === 'not_extracted' ? `not extracted: ${d.extraction.reason}`
      : ADMIN_TYPES.has(d.document_type) ? 'engagement / identity record: supports a required step, not a return number'
      : d.tax_year !== P.household.tax_year ? `tax year ${d.tax_year} document`
      : '';
    add({
      severity: reason ? 'info' : 'warning', check: 'document_landings',
      title: `${d.id} ${d.title}: lands on no v3 line${reason ? ` (${reason})` : ' and no reason is recorded'}`,
      detail: `${d.extraction.values} values extracted; ${versions.v3.documents_used.includes(d.id) ? 'listed in v3 documents_used' : 'not in v3 documents_used'}.`,
      refs: [d.id], lines: [],
    });
  }
  // Money values in tax-year documents that never landed (excluding detail already represented, e.g. D74 lots via line sources)
  for (const d of P.documents) {
    if (d.tax_year !== P.household.tax_year || ADMIN_TYPES.has(d.document_type) || versions.v3.documents_superseded.includes(d.id)) continue;
    const unl = (evsByDoc[d.id] ?? []).filter(e => e.value_type === 'money' && e.value && !landedEvs.has(e.id) && !/_(wash|basis|proceeds)$/.test(e.field) && !/^trip/.test(e.field));
    ran('document_landings', (evsByDoc[d.id] ?? []).length);
    if (!unl.length) continue;
    add({
      severity: 'info', check: 'document_landings', title: `${d.id}: ${unl.length} amount(s) not used on the return`,
      detail: unl.map(e => `${e.id} ${e.label} ${money(e.value)}`).join('; '), refs: unl.map(e => e.id), lines: [],
    });
  }
}

// =====================================================================
// 11. Questionnaire / client facts that contradict documents
// =====================================================================
{
  ran('client_contradictions', 10);
  const brokerLots = Object.entries(printedLots).filter(([d]) => !versions.v3.documents_superseded.includes(d)).reduce((a, [, l]) => a + Object.keys(l).length, 0);
  const daLots = (evsByDoc.D34 ?? []).filter(e => e.field.endsWith('_proceeds')).length;
  if (/^no/i.test(qa('qa-14').answer)) add({ severity: 'warning', check: 'client_contradictions', title: `qa-14 says no investments sold; brokers report ${brokerLots} sales`, detail: `D28 ${Object.keys(printedLots.D28).length}, D31 ${Object.keys(printedLots.D31).length}, D74 ${Object.keys(printedLots.D74).length} (direct indexing sells automatically). Confirm with client; organizer answers cannot be relied on for completeness.`, refs: ['qa-14', 'D28', 'D31', 'D74'], lines: ['SchD.16'] });
  if (/didn't really sell/i.test(qa('qa-15').answer)) add({ severity: 'warning', check: 'client_contradictions', title: `qa-15 "didn't really sell" vs ${daLots} dispositions on Form 1099-DA`, detail: `${money(evVal('ev-0907') ?? (evsByDoc.D34.find(e => e.field === 'total')).value)} gross proceeds on D34. "Moved things around" also explains lot C6 (transfer-in with no basis).`, refs: ['qa-15', 'D34'], lines: ['SchD.3', 'SchD.10'] });
  if (/none/i.test(qa('qa-31').answer)) add({ severity: 'info', check: 'client_contradictions', title: `qa-31 says no prior IRA basis; 2024 Form 8606 and Form 5498 for 2024 show ${money(py.basis_records.ira_nondeductible_basis_ngozi[0].form_8606_line_14)}`, detail: `D42: ${docText('D42')} The engine correctly used the 2024 basis (F8606.2); taxable conversion ${money(V3['F8606.18'].value)}. Record the client's answer as wrong.`, refs: ['qa-31', 'D42', 'py:/basis_records/ira_nondeductible_basis_ngozi/0'], lines: ['F8606.2'] });
  // qa-25: SE health insurance with employer coverage available
  if (/eligible|offer/i.test(qa('qa-25').answer) && V3['Sch1.17'].value > 0) add({
    severity: 'error', check: 'client_contradictions', title: `SE health insurance deduction ${money(V3['Sch1.17'].value)} claimed although Erik was eligible for employer coverage all year`,
    detail: `qa-25: "${qa('qa-25').answer}" IRC 162(l)(2)(B): no deduction for any month the self-employed person is eligible to participate in a subsidized plan of a spouse's employer. 2024 note: "${py.return_2024.notes['Sch1.17']}" The premiums stay nondeductible (itemized medical is below 7.5% of AGI).`,
    refs: ['qa-25', 'ev-0484', 'py:/return_2024/notes/Sch1.17'], lines: ['Sch1.17', 'Sch1.26', 'F8995.2.1'],
    amount: -V3['Sch1.17'].value, tax_effect: effect('adjustment', -V3['Sch1.17'].value, 'adjustment', 'also raises QBI by the same amount (x20% deduction), not captured'),
    fix: 'Remove Sch1.17.',
  });
  // qa-39 / call-01 vehicle donation: deduction limited to gross proceeds when the charity sells
  const v = V3['F8283.A1.vehicle'];
  const proceeds = evVal('ev-1054');
  if (v && proceeds < v.value) add({
    severity: 'error', check: 'client_contradictions', title: `Vehicle donation claimed at ${money(v.value)} (client's Kelley Blue Book estimate); Form 1098-C shows the charity sold it for ${money(proceeds)}`,
    detail: `D66 box 4a checked (arm's-length sale), 4c ${money(proceeds)}. IRC 170(f)(12): deduction limited to gross proceeds. The engine sourced qa-39 and the contribution date but not box 4c (ev-1054 lands nowhere). This is one of the two items the IRS examined in 2028 (Letter 566).`,
    refs: ['qa-39', 'call-01', 'ev-1054', 'D66', 'agency:/notices/1'], lines: ['F8283.A1.vehicle', 'SchA.12'],
    amount: proceeds - v.value, tax_effect: effect('itemized', proceeds - v.value), fix: `Deduct ${money(proceeds)}; attach Copy B of Form 1098-C.`,
  });
  // qa-41 vs EFTPS and IRS transcript
  const q4Claim = num(qa('qa-41').answer.match(/([\d,]+) I think/)?.[1] ?? '0');
  const tx = agency.irs_account_transcript_2025.at(-1).transactions.filter((t: any) => t.code === '670' && !/extension/i.test(t.description));
  const q4 = tx.find((t: any) => t.date.startsWith('2026-01'));
  if (q4 && q4Claim !== q4.amount) add({
    severity: 'error', check: 'client_contradictions', title: `Q4 federal estimate: client said ${money(q4Claim)} on 2026-01-14; IRS transcript shows ${money(q4.amount)} on ${q4.date}`,
    detail: `D67 (EFTPS) has no Q4 confirmation, so the engine fell back to the questionnaire answer "${qa('qa-41').answer}". IRS records: ${tx.map((t: any) => `${t.date} ${money(t.amount)}`).join(', ')}. F1040.26 and the 2210 penalty both use the wrong amount and date.`,
    refs: ['qa-41', 'D67', 'agency:/irs_account_transcript_2025/1'], lines: ['F1040.26', 'F2210.19', 'F1040.38'],
    amount: q4.amount - q4Claim, tax_effect: { federal: q4Claim - q4.amount, california: 0, kind: 'balance_due', basis: 'payments change balance due 1:1; penalty slightly higher (later date, smaller payment)' },
    fix: `F1040.26 = ${money(tx.reduce((a: number, t: any) => a + t.amount, 0))}; Q4 dated ${q4.date}.`,
  });
  // Theo SSN
  const theo = P.household.people.find((p: any) => p.id === 'theo');
  const card = evVal('ev-1080'), pyTheo = py.return_2024.dependents.find((d: any) => d.name.startsWith('Theo')).ssn;
  if (theo.ssn !== card) add({
    severity: 'error', check: 'client_contradictions', title: `Theo's SSN in the organizer (${theo.ssn.slice(0, 7)}xxxx) differs from his 2024 return (${pyTheo.slice(0, 7)}xxxx)`,
    detail: `Organizer ${theo.ssn} vs 2024 Form 1040 ${pyTheo} (D06, ${py.return_2024.prepared_by}) vs Social Security card D71 ${card} (received ${docs.D71.received_at.slice(0, 10)}, after the rejection). Comparing the organizer to the prior-year return on intake would have caught the transposition before e-file rejection ${agency.efile[0].errors[0].code}.`,
    refs: ['household:theo', 'ev-0012', 'D71', 'agency:/efile/0', 'msg-10'], lines: ['F8812.4'], fix: `Use ${card}.`,
  });
  // qa-45 + D09 + D73: Halvorsen CA wages
  const box16 = (evsByDoc.D09.find(e => e.field === 'box16')).value;
  const caYtd = evVal('ev-1081');
  if (/withholding California/i.test(qa('qa-45').answer) && box16 > caYtd) {
    const d = caYtd - box16;
    add({
      severity: 'error', check: 'client_contradictions', title: `California-source wages overstated by ${money(-d)}: Halvorsen W-2 box 16 ${money(box16)} includes Texas-period wages`,
      detail: `D09: "${docText('D09').match(/\(Employment began.*\)/)?.[0]}" qa-45: "${qa('qa-45').answer}" Paystub D73: CA taxable wages ${money(caYtd)} as of 07/15/2025 (work location changed to Austin effective 07/15). Engine rule R-CA-WAGES-SOURCE takes box 16 as California source. California withholding ${money(evVal('ev-0048'))} stays creditable.`,
      refs: ['ev-0047', 'ev-1081', 'D73', 'qa-45', 'D09'], lines: ['SchCA540NR.1.E', 'F540NR.32'],
      amount: d, tax_effect: effect('ca_source_income', d), fix: `SchCA540NR.1.E = Corvane ${money(evVal('ev-0030'))} + Halvorsen CA-period ${money(caYtd)} (+ any CA-period HSA add-back).`,
    });
  }
  // qa-26 SEP: contribution above the limit
  const sepC = evVal('ev-0485'), sepD = V3['Sch1.16'].value;
  if (sepC > sepD) add({
    severity: 'judgment', check: 'client_contradictions', title: `SEP contribution ${money(sepC)} exceeds the deductible limit ${money(sepD)} by ${money(sepC - sepD)}`,
    detail: `D26 deposited ${evVal('ev-0486')}. Excess contributions to a SEP are includible in Erik's income and subject to the 6% excise (Form 5329) unless withdrawn with earnings by the due date (2026-10-15). Engine carries ${money(versions.v3.carryovers_out.federal.sep_contribution_not_deductible_for_2025)} forward with no note. Any Sch C change (mileage, gross receipts, phone) moves this limit.`,
    refs: ['D26', 'qa-26'], lines: ['Sch1.16'], amount: sepC - sepD, fix: 'Advise withdrawal of the excess before 2026-10-15, or document the decision.',
  });
  // Prior preparer open item: Form 3520
  const open3520 = py.prior_preparer_workpaper.open_items_left_by_prior_preparer.find((s: string) => /3520/.test(s));
  if (open3520) add({
    severity: 'warning', check: 'client_contradictions', title: 'Prior preparer left Form 3520 (2023 foreign inheritance) unresolved',
    detail: `"${open3520}" qa-07: "${qa('qa-07').answer}" D36: "${docText('D36').match(/Account opened.*\)/)?.[0]}". Not a 2025 return item, but a penalty exposure (5% per month, up to 25%) the engagement should raise in writing.`,
    refs: ['py:/prior_preparer_workpaper/open_items_left_by_prior_preparer/3', 'qa-07', 'D36'], lines: [],
  });
  for (const [i, item] of py.prior_preparer_workpaper.open_items_left_by_prior_preparer.entries()) {
    if (/3520/.test(item)) continue;
    const status = /K-1/.test(item) ? `Resolved: D40 received ${docs.D40.received_at.slice(0, 10)}` : /5498/.test(item) ? `Resolved: D42 in file` : /square footage/.test(item) ? `Resolved for 2025: D24 (220 / 260 sq ft); 2024 claimed 300` : 'Open';
    add({ severity: 'info', check: 'client_contradictions', title: `Prior preparer open item: ${item}`, detail: status, refs: [`py:/prior_preparer_workpaper/open_items_left_by_prior_preparer/${i}`], lines: [] });
  }
}

// =====================================================================
// 12. Payments on the return vs IRS transcript and FTB account
// =====================================================================
{
  ran('agency_payments', 4);
  const last = agency.irs_account_transcript_2025.at(-1).transactions;
  const est = last.filter((t: any) => t.code === '670' && !/extension/i.test(t.description)).reduce((a: number, t: any) => a + t.amount, 0);
  const ext = last.filter((t: any) => t.code === '670' && /extension/i.test(t.description)).reduce((a: number, t: any) => a + t.amount, 0);
  if (ext !== V3['Sch3.10'].value) add({ severity: 'error', check: 'agency_payments', title: `Extension payment ${V3['Sch3.10'].value} vs IRS ${ext}`, detail: '', refs: ['agency:/irs_account_transcript_2025/1'], lines: ['Sch3.10'] });
  if (est !== V3['F1040.26'].value) { /* reported above with the questionnaire contradiction */ }
  const ftb25 = agency.ftb_account.tax_year_2025_payments.reduce((a: number, p: any) => a + p.amount, 0);
  const misdesig = agency.ftb_account.tax_year_2024_payments_after_filing;
  if (ftb25 !== V3['F540NR.72'].value) add({
    severity: 'error', check: 'agency_payments', title: `California estimated payments ${money(V3['F540NR.72'].value)} on the return; FTB credits ${money(ftb25)} to 2025`,
    detail: `FTB account: ${agency.ftb_account.tax_year_2025_payments.map((p: any) => `${p.date} ${money(p.amount)}`).join(', ')}. ${misdesig.map((p: any) => `${p.date} ${money(p.amount)}: ${p.note}`).join('; ')}. D68 printed: "2025-09-15 3,500.00 tax year 2024". Engine rule R-CA-ESTIMATED-PAYMENTS takes every payment dated 2025-04-01..2026-01-15 regardless of the tax year designated.`,
    refs: ['ev-1074', 'ev-1075', 'ev-1076', 'agency:/ftb_account', 'D68'], lines: ['F540NR.72', 'F540NR.97'],
    amount: ftb25 - V3['F540NR.72'].value, tax_effect: { federal: 0, california: V3['F540NR.72'].value - ftb25, kind: 'balance_due', basis: 'payments change refund 1:1' },
    fix: `Either claim ${money(ftb25)} or ask FTB in writing to move the 2024 credit to 2025 before filing; record the decision.`,
  });
  // CA withholding and federal withholding vs W-2s (distinct W-2s only)
  const w2 = ['D08', 'D09'];
  const fedW = w2.reduce((a, d) => a + evsByDoc[d].find(e => e.field === 'box2').value, 0);
  const caW = w2.reduce((a, d) => a + evsByDoc[d].find(e => e.field === 'box17').value, 0);
  if (fedW !== V3['F1040.25a'].value) add({ severity: 'error', check: 'agency_payments', title: `Federal withholding ${V3['F1040.25a'].value} vs W-2s ${fedW}`, detail: '', refs: w2, lines: ['F1040.25a'] });
  if (caW !== V3['F540NR.71'].value) add({ severity: 'error', check: 'agency_payments', title: `CA withholding ${V3['F540NR.71'].value} vs W-2s ${caW}`, detail: '', refs: w2, lines: ['F540NR.71'] });
  // Post-filing: an extension of time to file is not an extension to pay
  add({
    severity: 'info', check: 'agency_payments', title: `Extension paid ${money(ext)} against v2's estimate; any final balance due accrues interest and failure-to-pay penalty from 2026-04-15`,
    detail: `what_if.extension: ${JSON.stringify(P.what_if.extension.federal)}. Transcript (as of ${agency.irs_account_transcript_2025.at(-1).as_of}) assesses 196/276 after the 2026-07-20 payment. Rates: ${JSON.stringify(P.post_filing_rates)}.`,
    refs: ['timeline:extension-2026-04-14', 'agency:/irs_account_transcript_2025/1'], lines: ['Sch3.10', 'F1040.37'],
  });
}

// =====================================================================
// 13. Residency dates vs California proration
// =====================================================================
{
  ran('residency', 3);
  const days = (a: string, b: string) => (Date.parse(b) - Date.parse(a)) / 864e5 + 1;
  const caDays = days(CA_RES.from, CA_RES.to);
  const yearDays = days(`${P.household.tax_year}-01-01`, `${P.household.tax_year}-12-31`);
  if (caDays !== params.ca_resident_days || yearDays !== params.year_days) add({ severity: 'error', check: 'residency', title: `CA resident days ${caDays}/${yearDays} vs engine ${params.ca_resident_days}/${params.year_days}`, detail: '', refs: ['household:residency'], lines: [] });
  // Cross-check the move date across sources
  const moveDates = {
    'household.residency (TX from)': P.household.residency.find((r: any) => r.state === 'TX').from,
    'qa-02': qa('qa-02').answer.match(/(July \d+)/)?.[1],
    'D24 Austin office from': evVal('ev-0483'),
    'D73 work location Austin effective': docText('D73').match(/Austin, TX effective (\S+)\./)?.[1],
    'D61 Sacramento child care ends': docText('D61').match(/- (\w+ \d+), 2025/)?.[1],
  };
  add({ severity: 'info', check: 'residency', title: `CA residency ${CA_RES.from}..${CA_RES.to} = ${caDays} of ${yearDays} days; engine ratio ${params.ca_resident_days}/${params.year_days}`, detail: `Move date evidence: ${Object.entries(moveDates).map(([k, v]) => `${k}: ${v}`).join('; ')}.`, refs: ['household:residency', 'qa-02', 'ev-0483', 'D73'], lines: [] });
  // Every day-prorated California-amount line
  for (const l of Object.values(V3) as any[]) {
    if (!/SOURCE$/.test(l.rule) || !/by days/.test(P.engine_reference.rules[l.rule]) || l.inputs.length !== 1) continue;
    if (/R-CA-SCHE-SOURCE|R-CA-CAPGAIN-SOURCE/.test(l.rule)) continue; // mixed rules, not pure proration
    ran('residency');
    const exp = V3[l.inputs[0]].value * caDays / yearDays;
    if (Math.abs(exp - l.value) > 1) add({ severity: 'error', check: 'residency', title: `${l.key} = ${money(l.value)}; ${l.inputs[0]} x ${caDays}/${yearDays} = ${money(round(exp))}`, detail: '', refs: [], lines: [l.key] });
  }
}

// Identity facts entered by the client vs identity documents and the prior-year return
{
  const people = P.household.people;
  const pairs: [string, any, any, string[]][] = [
    ['Ngozi DOB vs driver license D04', people[0].dob, evVal('ev-0006'), ['household:ngozi', 'ev-0006']],
    ['Erik DOB vs driver license D05', people[1].dob, evVal('ev-0008'), ['household:erik', 'ev-0008']],
    ['Ngozi IP PIN vs CP01A D03', people[0].ip_pin, evVal('ev-0005'), ['household:ngozi', 'ev-0005']],
    ['Prior-year AGI for e-signature vs 2024 return', P.household.prior_year_agi_for_esignature, py.return_2024.lines['F1040.11'], ['ev-0010']],
    ['Ada SSN vs 2024 return and Form 1098-T', people[2].ssn, py.return_2024.dependents[0].ssn, ['household:ada', 'D59']],
  ];
  for (const [name, a, b, refs] of pairs) {
    ran('identity');
    if (String(a) !== String(b)) add({ severity: 'error', check: 'identity', title: `${name}: ${a} vs ${b}`, detail: '', refs, lines: [] });
  }
}

// =====================================================================
// 14. Independent recomputations of specific items (do not trust the engine)
// =====================================================================
{
  // RSU basis: supplemental statement (D11) vs basis used on Form 8949
  const supp = Object.fromEntries((evsByDoc.D11 ?? []).map(e => [e.field, e.value]));
  for (const lot of Object.values(printedLots.D28)) {
    if (!/RSU|ESPP/.test(lot.desc)) continue;
    ran('independent_recompute');
    const key = Object.keys(supp).find(k => k.endsWith('_acquired') && supp[k] === lot.acquired)?.replace('_acquired', '');
    if (!key) continue;
    const adj = supp[`${key}_adjusted_basis`];
    const line = (Object.values(V3) as any[]).find(l => l.rule === 'R-8949-LOT' && l.key.endsWith(`.${lot.lot}`));
    const usedBasis = num(line.label.match(/basis (\d[\d,]*(?:\.\d+)?)/)[1]) - (num(line.label.match(/adjustment \w (-?\d[\d,]*(?:\.\d+)?)/)?.[1] ?? '0'));
    if (Math.abs(usedBasis - adj) < 0.01) continue;
    const delta = -(adj - usedBasis);
    add({
      severity: 'error', check: 'independent_recompute',
      title: `${line.key} ${lot.desc} reported with basis ${money(usedBasis)}; supplemental statement gives ${money(adj)}`,
      detail: `D28 prints basis "(not reported)" (noncovered RSU shares); D11 ${key}: ${lot.qty} sh vested ${lot.acquired}, FMV taxed as wages at vest${lot.acquired.startsWith(String(P.household.tax_year)) ? ` (in 2025 W-2 box 1; D08 box 14 RSU ${money(evVal('ev-0027'))})` : ' (prior-year W-2)'}. Engine rule R-8949-LOT uses broker basis unless a supplemental statement is matched; it did not match ${key} to ${lot.lot}. Gain overstated by ${money(adj - usedBasis)} (double taxation of wages).`,
      refs: [line.sources.find((s: string) => evs[s]?.field.endsWith('_basis')), `doc:D11#page2`, `doc:D28#page${lot.page}`], lines: [line.key, lot.term === 'short' ? 'SchD.2' : 'SchD.9'],
      amount: delta, tax_effect: effect(lot.term === 'short' ? 'stcg' : 'ltcg', delta, inCA(lot.sold) ? 'ca_source_income' : undefined, inCA(lot.sold) ? 'sold during CA residency' : ''),
      fix: `Box ${lot.term === 'short' ? 'B' : 'E'}, basis ${money(adj)}, code B adjustment; gain ${money(lot.proceeds - adj)}.`,
    });
  }

  // Schedule C gross receipts vs 1099s and books
  ran('independent_recompute');
  const nec = ['D16', 'D17', 'D18', 'D19', 'D20'].reduce((a, d) => a + evsByDoc[d].find(e => e.field === 'box1').value, 0);
  const k = evVal('ev-0127'), books = evVal('ev-0086') + evVal('ev-0087');
  const viaCard = evVal('ev-0109'), no1099 = evVal('ev-0111');
  const recon = nec + no1099;
  const included = /deposited gross/.test(pageText('D15', 3)) && viaCard === k;
  add({
    severity: included && V3['SchC.1'].value > books ? 'error' : 'info', check: 'independent_recompute',
    title: `Schedule C gross receipts ${money(V3['SchC.1'].value)} double-count the ${money(k)} Form 1099-K`,
    detail: `Books revenue ${money(books)} (D14). D15 p3: Atlas paid ${money(evVal('ev-0110'))}, of which ${money(viaCard)} through Paywell, "deposited gross" and booked as sales - so the 1099-K is already in books. Reconciliation: 1099-NEC ${money(nec)} (Atlas ${money(evVal('ev-0110'))} includes the ${money(viaCard)} paid by card) + clients with no 1099 ${money(no1099)} = ${money(recon)} vs books ${money(books)}. Third parties reported ${money(nec + k)} (NEC + K); the ${money(viaCard)} overlap is the difference. Engine rule R-SCHC-GROSS adds 1099-K amounts it "could not match to a books deposit". The 2028 Letter 566 asks for exactly this reconciliation.`,
    refs: ['ev-0086', 'ev-0087', 'ev-0127', 'ev-0109', 'ev-0110', 'ev-0111', 'doc:D15#page3', 'agency:/notices/1'], lines: ['SchC.1'],
    amount: books - V3['SchC.1'].value, tax_effect: effect('schc_profit', books - V3['SchC.1'].value, 'schc_profit', 'includes SE tax and QBI'), fix: `SchC.1 = ${money(books)}.`,
  });

  // Mixed-use telephone and internet; personal subscription booked to software
  ran('independent_recompute');
  const call = P.client.call_notes[0].notes.join(' ');
  const phonePct = Number(call.match(/business share is (\d+)%/)?.[1]) / 100;
  const netPct = Number(call.match(/business use about (\d+)%/)?.[1]) / 100;
  const phone = evVal('ev-0101') ?? (evsByDoc.D14.find(e => e.field === 'Telephone')).value;
  const net = evVal('ev-0095');
  const disallow = round(phone * (1 - phonePct) + net * (1 - netPct));
  if (V3['SchC.25'].value === phone + net) add({
    severity: 'error', check: 'independent_recompute', title: `Telephone and internet deducted at 100%; client puts business use at ${phonePct * 100}% / ${netPct * 100}%`,
    detail: `D15: family mobile plan (4 lines) ${money(phone)}, home internet ${money(net)}. call-01: "${P.client.call_notes[0].notes[0]}" / "${P.client.call_notes[0].notes[1]}"`,
    refs: ['call-01', 'doc:D15#page2', 'ev-0095'], lines: ['SchC.25'], amount: -disallow, tax_effect: effect('schc_profit', -disallow), fix: `SchC.25 = ${money(phone + net - disallow)}.`,
  });
  const spotify = evVal('ev-0106');
  if (/Spotify Family/.test(call) && /personal/.test(call)) add({
    severity: 'error', check: 'independent_recompute', title: `Personal Spotify Family ${money(spotify)} in Schedule C software`,
    detail: `D15 p1 lists Spotify Family inside software and subscriptions ${money(evVal('ev-0099'))}; call-01: "${P.client.call_notes[0].notes[2]}"`,
    refs: ['ev-0106', 'call-01'], lines: ['SchC.27a.1'], amount: -spotify, tax_effect: effect('schc_profit', -spotify), fix: `SchC.27a.1 = ${money(evVal('ev-0099') - spotify)}.`,
  });

  // Home office simplified method: average monthly square footage from D24
  ran('independent_recompute');
  const sac = evVal('ev-0481'), aus = evVal('ev-0482'), start = evVal('ev-0483');
  let total = 0;
  for (let m = 1; m <= 12; m++) {
    // A month counts for the space used >= 15 days in it
    const ausDays = m < Number(start.slice(5, 7)) ? 0 : m > Number(start.slice(5, 7)) ? 31 : 32 - Number(start.slice(8, 10));
    total += ausDays >= 15 ? aus : sac;
  }
  const avg = total / 12;
  if (Math.abs(avg * params.home_office_rate - V3['SchC.30'].value) > 1) add({ severity: 'error', check: 'independent_recompute', title: `Home office recomputes to ${avg} sq ft avg x ${params.home_office_rate} = ${avg * params.home_office_rate}`, detail: '', refs: ['D24'], lines: ['SchC.30'] });

  // Mortgage interest: payoff interest already inside the Form 1098
  ran('independent_recompute');
  const payoff = evVal('ev-1032');
  if (V3['SchA.8a'].sources.includes('ev-1032') && V3['SchA.8a'].sources.includes('ev-1029') && /reported on the 2025 Form 1098/.test(docText('D56'))) add({
    severity: 'error', check: 'independent_recompute', title: `Payoff interest ${money(payoff)} counted twice in home mortgage interest`,
    detail: `D55 box 1 ${money(evVal('ev-1029'))} "(includes prepaid interest at closing and interest paid at payoff 11/20/2025)"; D56: "(Interest is reported on the 2025 Form 1098.)" SchA.8a adds both. ${V3['SchA.8a'].note}`,
    refs: ['ev-1032', 'ev-1029', 'D56', 'D55'], lines: ['SchA.8a'], amount: -payoff, tax_effect: effect('itemized', -payoff), fix: `SchA.8a = ${money(V3['SchA.8a'].value - payoff)}.`,
  });

  // Home real estate taxes: seller's share credited at closing
  ran('independent_recompute');
  const credit = evVal('ev-1027');
  if (V3['SchA.5b'].value === evVal('ev-1036')) {
    const newB = V3['SchA.5b'].value - credit, new5d = V3['SchA.5a'].value + newB;
    const cap = Math.max(params.salt_cap_floor, params.salt_cap - params.salt_cap_phase_rate * Math.max(0, V3['F1040.11'].value - params.salt_cap_phase_start));
    const fedChange = Math.min(cap, new5d) - V3['SchA.5e'].value;
    add({
      severity: 'error', check: 'independent_recompute', title: `Home property tax ${money(V3['SchA.5b'].value)} includes the seller's ${money(credit)} share`,
      detail: `D54: "Seller credit for 2025 county taxes 01/01/2025-07/07/2025: ${money(credit)}". The buyer paid the full 2025 bill through escrow (D57/D58) but deducts only the part for days owned (IRC 164(d)): ${money(newB)}. SALT drops from ${money(V3['SchA.5d'].value)} to ${money(new5d)}, under the ${money(cap)} cap - so the federal deduction falls ${money(-fedChange)} (the v3 SALT rate of 0 does not apply: threshold crossed). California itemized falls by the full ${money(credit)}.`,
      refs: ['ev-1027', 'ev-1036', 'ev-1038', 'D54'], lines: ['SchA.5b', 'SchA.5e', 'SchCA540NR.A.itemized'],
      amount: -credit,
      tax_effect: { federal: round(fedChange * RATES.itemized.federal_per_dollar), california: round(-credit * RATES.salt.california_per_dollar), kind: 'tax', basis: `federal: capped SALT change ${money(fedChange)} x itemized rate; CA: ${money(-credit)} x salt rate` },
      fix: `SchA.5b = ${money(newB)}.`,
    });
  }

  // HVAC: replacement of the whole system expensed as a repair
  ran('independent_recompute');
  const wi = P.what_if.alternatives.find((a: any) => a.id === 'hvac_improvement');
  if (/Installed new/.test(docText('D47')) && V3['SchE.14A'].value >= evVal('ev-1004')) add({
    severity: 'judgment', check: 'independent_recompute', title: `HVAC replacement ${money(evVal('ev-1004'))} at 1450 Fremont Way expensed as a repair`,
    detail: `D47: "${docText('D47').slice(0, 170)}..." call-01: "${P.client.call_notes[0].notes[4]}" Replacing the whole HVAC system is a restoration of a building system (Treas. Reg. 1.263(a)-3(k)) - capitalize over 27.5 years unless a safe harbor applies (de minimis 2,500 per invoice and small-taxpayer safe harbor do not fit). Engine what_if hvac_improvement gives the effect.`,
    refs: ['D47', 'ev-1001', 'qa-37', 'call-01', 'what_if:hvac_improvement'], lines: ['SchE.14A', 'F4562-E.total-A'],
    amount: evVal('ev-1004'), tax_effect: { federal: wi.federal.total_tax_change, california: wi.california.total_tax_change, kind: 'tax', basis: 'what_if hvac_improvement (engine)' },
    fix: 'Capitalize as a 27.5-year asset placed in service 2025-08-12; record the authority relied on.',
  });

  // Digital asset lot with no basis, client's later message
  ran('independent_recompute');
  const m7 = msg('msg-07').text;
  const claimed = num(m7.match(/for about ([\d,]+)/)[1]);
  const c6 = V3['F8949.H.C6'];
  if (c6) {
    const prc = evVal('ev-0882');
    add({
      severity: 'judgment', check: 'independent_recompute', title: `Coinhaven lot C6 reported with zero basis and a 17-day holding period; client says bought March 2021 for ${money(claimed)}`,
      detail: `D35 shows "TRANSFER-IN 2025-06-01 (cost basis unknown)". msg-07: "${m7}" If substantiated, C6 moves from box H (short) to box K (long) with gain ${money(prc - claimed)} instead of ${money(prc)}. Evidence is a single bank statement line; record what was obtained and the judgment.`,
      refs: ['ev-0918', 'ev-0919', 'msg-07'], lines: ['F8949.H.C6'],
      tax_effect: { federal: round(-prc * RATES.stcg.federal_per_dollar + (prc - claimed) * RATES.ltcg.federal_per_dollar), california: round(-claimed * RATES.ca_source_income.california_per_dollar), kind: 'tax', basis: 'remove ST gain, add LT gain; CA: sold during CA residency, basis reduces CA-source gain' },
    });
  }

  // Charity: handwritten receipt, client confirmation
  ran('independent_recompute');
  add({
    severity: 'judgment', check: 'independent_recompute', title: `St. Brigid gift read as ${money(evVal('ev-1049'))} at confidence ${evs['ev-1049'].confidence}; receipt prints "$?,500.00"`,
    detail: `D64: "${docText('D64')}" msg-08: "${msg('msg-08').text}" A gift of 250 or more needs a contemporaneous written acknowledgment; the acknowledgment is ambiguous, the bank record (check #2207) supports 1,500. Attach the bank record and the client's message as evidence.`,
    refs: ['ev-1049', 'msg-08', 'D64'], lines: ['SchA.11'],
  });

  // Compliance items surfaced by documents, not by numbers
  ran('independent_recompute', 3);
  add({ severity: 'warning', check: 'independent_recompute', title: 'Form 8867 due diligence not completed for the child tax credit / credit for other dependents', detail: `F8867.status = "${V3['F8867.status'].value}". Firm rule: "${P.firm.starter_standards.rules[3]}"`, refs: [], lines: ['F8867.status', 'F1040.19'] });
  add({ severity: 'warning', check: 'independent_recompute', title: `Contractors paid ${money(evVal('ev-0487'))} and ${money(evVal('ev-0488'))} with no Forms 1099-NEC (due ${P.firm.deadlines.find((d: any) => /1099-NEC/.test(d.what)).date})`, detail: `D27, qa-23, call-01. Schedule C line J answered "No". Outside engagement scope (D01) - advise in writing.`, refs: ['D27', 'qa-23', 'call-01', 'D01'], lines: ['SchC.I', 'SchC.J'] });
  add({ severity: 'info', check: 'independent_recompute', title: `Foreign account max ${money(V3['F8938.1.max'].value)} USD: Form 8938 required; FBAR outside engagement`, detail: `D36 max SEK ${money(evVal('ev-0962'))} / ${P.fx_rates.SEK_per_USD['2025_year_end']}. 2024 8938 max ${money(py.return_2024.lines.F8938)}.`, refs: ['D36', 'D01'], lines: ['F8938.req'] });
}

// ---------- spot recomputes that agree (recorded as passes) ----------
{
  const L = V3;
  const agree = (name: string, got: number, want: number) => { ran('independent_recompute'); if (Math.abs(got - want) > 1) add({ severity: 'error', check: 'independent_recompute', title: `${name}: return ${money(got)}, recomputed ${money(want)}`, detail: '', refs: [], lines: [] }); };
  const se = L['SchC.31'].value * params.se_factor;
  agree('SchSE.4a', L['SchSE.4a'].value, se);
  agree('SchSE.12', L['SchSE.12'].value, Math.min(se, params.ss_wage_base) * 0.124 + se * 0.029);
  agree('Sch1.16 SEP limit', L['Sch1.16'].value, Math.min(evVal('ev-0485'), 0.2 * (L['SchC.31'].value - L['SchSE.13'].value)));
  agree('F6251.2i ISO spread', L['F6251.2i'].value, evVal('ev-0079') * (evVal('ev-0078') - evVal('ev-0077')));
  agree('F8812.11 CTC phase-out', L['F8812.11'].value, Math.ceil(Math.max(0, L['F8812.1'].value - params.ctc_phaseout_start) / 1000) * 50);
  agree('Sch3.11 excess SS', L['Sch3.11'].value, evVal('ev-0019') + evVal('ev-0038') - params.ss_wage_base * 0.062);
  agree('F8960.17 NIIT', L['F8960.17'].value, 0.038 * Math.min(L['F8960.12'].value, L['F8960.13'].value - params.niit_threshold));
  agree('SchA.5e SALT cap', L['SchA.5e'].value, Math.min(L['SchA.5d'].value, Math.max(params.salt_cap_floor, params.salt_cap - params.salt_cap_phase_rate * Math.max(0, L['F1040.11'].value - params.salt_cap_phase_start))));
  agree('F8938.1.max', L['F8938.1.max'].value, Math.floor(evVal('ev-0962') / P.fx_rates.SEK_per_USD['2025_year_end']));
  agree('F2210.8 required annual payment', L['F2210.8'].value, Math.min(0.9 * L['F1040.24'].value, 1.1 * py.return_2024.lines['F1040.24']));
  agree('F8995.2.1 QBI', L['F8995.2.1'].value, L['SchC.31'].value - L['SchSE.13'].value - L['Sch1.16'].value - L['Sch1.17'].value);
  agree('F8606.18 taxable conversion', L['F8606.18'].value, evVal('ev-0987') - (evVal('ev-0993') + py.basis_records.ira_nondeductible_basis_ngozi[0].form_8606_line_14));
}

// ---------- output ----------
const ORDER: Severity[] = ['error', 'judgment', 'warning', 'info'];
findings.sort((a, b) => ORDER.indexOf(a.severity) - ORDER.indexOf(b.severity) || Math.abs(b.tax_effect?.federal ?? 0) + Math.abs(b.tax_effect?.california ?? 0) - Math.abs(a.tax_effect?.federal ?? 0) - Math.abs(a.tax_effect?.california ?? 0));
findings.forEach((f, i) => (f.id = `F-${String(i + 1).padStart(3, '0')}`));
const totals = (sev: Severity) => findings.filter(f => f.severity === sev && f.tax_effect).reduce((a, f) => ({ federal: a.federal + f.tax_effect!.federal, california: a.california + f.tax_effect!.california }), { federal: 0, california: 0 });

writeFileSync(new URL('../findings.json', import.meta.url), JSON.stringify({
  generated_by: 'scripts/audit.ts', packet_sha256: PACKET_SHA256, base_version: 'v3',
  checks, counts: Object.fromEntries(ORDER.map(s => [s, findings.filter(f => f.severity === s).length])),
  error_tax_effect_total: totals('error'), findings,
}, null, 1));

const fmtEff = (e?: Effect) => (e ? `${e.kind === 'balance_due' ? 'balance ' : ''}fed ${e.federal >= 0 ? '+' : ''}${money(e.federal)} / CA ${e.california >= 0 ? '+' : ''}${money(e.california)}` : '');
let md = `# Errors found in the packet\n\nGenerated by \`node scripts/audit.ts\` from packet sha256 \`${PACKET_SHA256.slice(0, 16)}\`. Base: return v3. ` +
  `Tax effects use v3 \`tax_effect_rates\` (delta x rate) unless noted; they are first-order and do not interact (the engine cannot be rerun).\n\n` +
  `| severity | count |\n|---|---|\n${ORDER.map(s => `| ${s} | ${findings.filter(f => f.severity === s).length} |`).join('\n')}\n\n` +
  `Net first-order effect of the **errors** on v3: federal ${money(totals('error').federal)}, California ${money(totals('error').california)} (negative = return overstates tax).\n\n` +
  `Checks run: ${Object.entries(checks).map(([k, c]) => `${k} ${c.ran - c.failed}/${c.ran} clean`).join('; ')}.\n\n`;
for (const s of ORDER) {
  const fs = findings.filter(f => f.severity === s);
  if (!fs.length) continue;
  md += `## ${s} (${fs.length})\n\n`;
  const compact = fs.filter(f => f.check === 'prior_year_variance' || f.severity === 'info');
  for (const f of fs.filter(f => !compact.includes(f))) {
    md += `### ${f.id} ${f.title}\n\n${f.detail}\n\n`;
    const meta = [f.lines.length && `Lines: ${f.lines.join(', ')}`, f.refs.length && `Refs: ${f.refs.join(', ')}`, f.tax_effect && `Effect: ${fmtEff(f.tax_effect)} (${f.tax_effect.basis})`, f.fix && `Fix: ${f.fix}`, `Check: \`${f.check}\``].filter(Boolean);
    md += meta.map(m => `- ${m}`).join('\n') + '\n\n';
  }
  if (compact.length) md += (compact.length < fs.length ? `### ${s === 'info' ? 'Checked' : 'Prior-year swings over the firm threshold (10% and 1,000) - each needs an explanation'}\n\n` : '') + compact.map(f => `- **${f.id}** ${f.title}${f.detail ? ` - ${f.detail}` : ''}`).join('\n') + '\n\n';
}
writeFileSync(new URL('../ERRORS.md', import.meta.url), md);
console.log(`${findings.length} findings:`, Object.fromEntries(ORDER.map(s => [s, findings.filter(f => f.severity === s).length])), 'error effect', totals('error'));
