// One resolver for every ref string in the packet, plus the line graph and the
// document-landing index. Pure functions over the packet: used by server and client.

export type Packet = any;
export type Line = { key: string; jurisdiction: string; form: string; line: string; label: string; value: any; rule: string; inputs: string[]; sources: string[]; note?: string };
export type Ev = { id: string; document_id: string; page: number; field: string; label: string; value: any; value_type: string; text_as_read: string; position: { x0: number; y0: number; x1: number; y1: number }; confidence: number };
export type Finding = { id: string; severity: 'error' | 'judgment' | 'warning' | 'info'; check: string; title: string; detail: string; refs: string[]; lines: string[]; amount?: number; tax_effect?: { federal: number; california: number; kind: string; basis: string }; fix?: string };

export type RefKind = 'line' | 'ev' | 'doc' | 'page' | 'qa' | 'msg' | 'call' | 'py' | 'agency' | 'asset' | 'household' | 'param' | 'fx' | 'timeline' | 'version' | 'what_if' | 'unknown';
export type RefNode = { ref: string; kind: RefKind; title: string; value?: any; docId?: string; page?: number; ev?: Ev; line?: Line; text?: string };

export function pointer(root: any, ptr: string): any {
  return ptr.split('/').slice(1).map(s => s.replace(/~1/g, '/').replace(/~0/g, '~'))
    .reduce((o, k) => (o == null ? undefined : o[k]), root);
}

export class Graph {
  P: Packet;
  docs: Record<string, any> = {};
  evs: Record<string, Ev> = {};
  evsByDoc: Record<string, Ev[]> = {};
  lines: Record<string, Record<string, Line>> = {};
  usedBy: Record<string, Record<string, string[]>> = {}; // version -> line key -> keys of lines that take it as input
  landings: Record<string, Record<string, string[]>> = {}; // version -> doc id -> line keys

  constructor(P: Packet) {
    this.P = P;
    for (const d of P.documents) this.docs[d.id] = d;
    for (const e of P.extracted_values) { this.evs[e.id] = e; (this.evsByDoc[e.document_id] ??= []).push(e); }
    for (const v of P.return_versions) {
      const L: Record<string, Line> = (this.lines[v.version] = {});
      const U: Record<string, string[]> = (this.usedBy[v.version] = {});
      const D: Record<string, string[]> = (this.landings[v.version] = {});
      for (const l of v.lines) L[l.key] = l;
      for (const l of v.lines) {
        for (const i of l.inputs) (U[i] ??= []).push(l.key);
        for (const s of l.sources) {
          // Prior-year refs land on the 2024 return (D06) or the prior preparer's file (D07).
          const py = s.startsWith('py:/return_2024') ? 'D06' : s.startsWith('py:') || s.startsWith('asset:') ? 'D07' : undefined;
          const d = this.evs[s]?.document_id ?? (this.docs[s] ? s : s.match(/^doc:(D\d+)/)?.[1]) ?? py;
          if (d && !D[d]?.includes(l.key)) (D[d] ??= []).push(l.key);
        }
      }
    }
  }

  line(key: string, version = 'v3'): Line | undefined { return this.lines[version]?.[key]; }

  resolve(ref: string, version = 'v3'): RefNode {
    const P = this.P;
    const n = (kind: RefKind, title: string, extra: Partial<RefNode> = {}): RefNode => ({ ref, kind, title, ...extra });
    if (/^ev-\d+$/.test(ref)) {
      const e = this.evs[ref];
      return e ? n('ev', `${e.document_id} ${e.label}`, { value: e.value, docId: e.document_id, page: e.page, ev: e }) : n('unknown', ref);
    }
    if (/^D\d+$/.test(ref)) return this.docs[ref] ? n('doc', this.docs[ref].title, { docId: ref }) : n('unknown', ref);
    let m = ref.match(/^doc:(D\d+)#page(\d+)$/);
    if (m) return n('page', `${this.docs[m[1]]?.title ?? m[1]}, page ${m[2]}`, { docId: m[1], page: Number(m[2]) });
    m = ref.match(/^(qa|msg|call)-\d+$/);
    if (m) {
      const list = m[1] === 'qa' ? P.client.questionnaire : m[1] === 'msg' ? P.client.messages : P.client.call_notes;
      const x = list.find((q: any) => q.id === ref);
      if (!x) return n('unknown', ref);
      if (m[1] === 'qa') return n('qa', x.question, { value: x.answer, text: `${x.answered_by}: ${x.answer}` });
      if (m[1] === 'msg') return n('msg', `Message from ${x.from}, ${x.sent_at.slice(0, 10)}`, { text: x.text });
      return n('call', `Call ${x.date.slice(0, 10)} with ${x.participants.join(', ')}`, { text: x.notes.join(' ') });
    }
    if (ref.startsWith('py:')) return n('py', `Prior year ${ref.slice(4).replace(/\//g, ' / ')}`, { value: pointer(P.prior_years, ref.slice(3)) });
    if (ref.startsWith('agency:')) return n('agency', `Agency record ${ref.slice(8).replace(/\//g, ' / ')}`, { value: pointer(P.tax_agency_records, ref.slice(7)) });
    m = ref.match(/^asset:(.+)$/);
    if (m) {
      const a = P.return_versions.find((v: any) => v.version === version)?.assets.find((x: any) => x.asset_id === m![1])
        ?? P.prior_years.asset_records.find((x: any) => x.asset_id === m![1]);
      return a ? n('asset', a.description, { value: a }) : n('unknown', ref);
    }
    m = ref.match(/^household:(.+)$/);
    if (m) {
      const p = P.household.people.find((x: any) => x.id === m![1]);
      return p ? n('household', `${p.name} (${p.role})`, { value: p }) : n('household', `Household ${m[1]}`, { value: (P.household as any)[m[1]] });
    }
    m = ref.match(/^ref:param\.(.+)$/);
    if (m) return n('param', `Engine parameter ${m[1]}`, { value: P.engine_reference.parameters[m[1]] });
    m = ref.match(/^ref:fx\.(\w+)\.(\w+)$/);
    if (m) return n('fx', `${m[1]} per USD, ${m[2].replace('_', ' ')}`, { value: P.fx_rates[`${m[1]}_per_USD`]?.[m[2]] });
    m = ref.match(/^timeline:(.+)$/);
    if (m) {
      const t = P.timeline.find((x: any) => x.id === m![1]);
      return t ? n('timeline', `${t.event.replace(/_/g, ' ')}, ${t.at.slice(0, 10)}`, { text: t.detail ?? '' }) : n('unknown', ref);
    }
    m = ref.match(/^what_if:(.+)$/);
    if (m) {
      const w = P.what_if.alternatives.find((x: any) => x.id === m![1]);
      return w ? n('what_if', w.description, { value: w }) : n('unknown', ref);
    }
    if (/^v\d+$/.test(ref)) {
      const v = P.return_versions.find((x: any) => x.version === ref);
      return v ? n('version', `Return ${ref}, ${v.computed_at.slice(0, 10)}`, { text: v.trigger }) : n('unknown', ref);
    }
    const l = this.line(ref, version);
    if (l) return n('line', l.label, { value: l.value, line: l });
    return n('unknown', ref);
  }

  ruleText(rule: string): string { return this.P.engine_reference.rules[rule] ?? rule; }
}

// ---------- status ----------
export type Status = 'Unverified' | 'Verified' | 'Adjusted' | 'Question open' | 'Blocked' | 'Signed' | 'Reopened' | 'Frozen';
export const severityStatus = (s: Finding['severity']): Status | null => (s === 'error' ? 'Blocked' : s === 'judgment' || s === 'warning' ? 'Question open' : null);
const RANK: Record<string, number> = { Blocked: 3, 'Question open': 2, Unverified: 0 };
export const worse = (a: Status, b: Status) => ((RANK[a] ?? 0) >= (RANK[b] ?? 0) ? a : b);
// What to show for a line: its own status, unless something it is built from is worse.
export const shown = (own: Status, inh: Status): [Status, boolean] => ((RANK[inh] ?? 0) > (RANK[own] ?? 0) ? [inh, true] : [own, false]);

// Which hop of a line's thread a finding breaks: the first of the line's sources it names,
// else a source document it names, else the rule itself (arithmetic or treatment).
// Variances are questions about the line as a whole, not breaks in its proof: hop 'line'.
export function breakHop(line: Line, f: Finding, g: Graph): string {
  if (f.check === 'prior_year_variance') return 'line';
  const src = line.sources.find(s => f.refs.includes(s));
  if (src) return src;
  const docOf = (r: string) => g.evs[r]?.document_id ?? r.match(/^(?:doc:)?(D\d+)/)?.[1];
  const byDoc = line.sources.find(s => f.refs.some(r => docOf(r) && docOf(r) === docOf(s)));
  return byDoc ?? 'rule';
}

// ---------- money and dates ----------
export function fmt(v: any, cents = false): string {
  if (typeof v !== 'number') return v == null ? '' : String(v);
  if (Number.isNaN(v)) return '';
  if (Math.abs(v) < 1 && v !== 0 && !Number.isInteger(v)) return String(v); // ratios
  const s = Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: cents ? 2 : 0, maximumFractionDigits: cents ? 2 : 0 });
  return v < 0 ? `(${s})` : s;
}
export const isLot = (key: string) => /^F8949\.[A-Z]\.(?!total)/.test(key);

// Variants of a value as it might be printed, for locating it in printed_content.
export function printedForms(e: Ev): string[] {
  const out = new Set<string>();
  if (e.text_as_read) out.add(e.text_as_read);
  const v = e.value;
  if (typeof v === 'number') {
    out.add(v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
    out.add(v.toLocaleString('en-US'));
    out.add(String(v));
    out.add(v.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 }));
    if (e.value_type === 'percent') out.add(`${Math.round(v * 1000) / 10}%`);
  } else if (e.value_type === 'date' && typeof v === 'string') {
    const [y, m, d] = v.split('-');
    out.add(`${m}/${d}/${y}`); out.add(v);
  } else if (v != null) out.add(String(v));
  return [...out].filter(Boolean).sort((a, b) => b.length - a.length);
}

// Where in the page text a field sits: anchor on the lot / trip / box token, then find the value after it.
// A match must be a whole token (19,240.00 must not match 0.00). When the value is not printed,
// return the anchor's clause with approx=true so the reader still sees where it should be.
const whole = (text: string, f: string, from: number): number => {
  for (let i = text.indexOf(f, from); i >= 0; i = text.indexOf(f, i + 1)) {
    const a = text[i - 1] ?? ' ', b = text[i + f.length] ?? ' ';
    if (!/[\w,.-]/.test(a) && !/\w/.test(b) && !(/[,.]/.test(b) && /\d/.test(text[i + f.length + 1] ?? ''))) return i;
  }
  return -1;
};
export function locate(text: string, e: Ev): { start: number; end: number; approx?: boolean } | null {
  let from = -1;
  const lot = e.field.match(/^([A-Z]{1,2}\d+)_/);
  const trip = e.field.match(/^trip(\d+)_/);
  const box = e.field.match(/^box(\d+[a-z]?)/i);
  if (lot) { const i = text.search(new RegExp(`\\b${lot[1]}\\b`)); if (i >= 0) from = i; }
  else if (trip) {
    const dates = [...text.matchAll(/\d{4}-\d{2}-\d{2} /g)];
    const d = dates[Number(trip[1]) - 1]; if (d) from = d.index!;
  } else if (box) { const i = text.search(new RegExp(`Box ${box[1]}\\b`, 'i')); if (i >= 0) from = i; }
  const anchored = from >= 0;
  if (!anchored) from = 0;
  for (const f of printedForms(e)) {
    const i = whole(text, f, from);
    if (i >= 0 && (!anchored || text.slice(from, i).split(';').length < 2)) return { start: i, end: i + f.length };
  }
  if (!anchored) for (const f of printedForms(e)) {
    const i = whole(text, f, 0);
    if (i >= 0) return { start: i, end: i + f.length };
  }
  if (anchored) { const end = text.indexOf(';', from); return { start: from, end: end < 0 ? text.length : end, approx: true }; }
  return null;
}

// ---------- document source ----------
export type Highlight = { docId: string; page: number; span: { start: number; end: number; approx?: boolean } | null; box: Ev['position'] | null; evId: string };
export interface DocumentSource {
  pages(docId: string): { page: number; text: string }[];
  highlight(ev: Ev): Highlight;
}
export class SimulatedSource implements DocumentSource {
  g: Graph;
  constructor(g: Graph) { this.g = g; }
  pages(docId: string): { page: number; text: string }[] { return (this.g.docs[docId]?.pages ?? []).map((p: any) => ({ page: p.page, text: p.printed_content })); }
  highlight(ev: Ev): Highlight {
    const text = this.pages(ev.document_id).find(p => p.page === ev.page)?.text ?? '';
    return { docId: ev.document_id, page: ev.page, span: locate(text, ev), box: ev.position, evId: ev.id };
  }
}

// ---------- areas for the outline ----------
export const AREAS: [string, RegExp][] = [
  ['Wages', /^(F1040\.1[az]$|F8959|Sch3\.11)/],
  ['Interest and dividends', /^(SchB|F1040\.2|F1040\.3)/],
  ['Retirement and HSA', /^(F8606|F1040\.4|F8889|Sch1\.13)/],
  ['Capital gains', /^(F8949|SchD|F1040\.7)/],
  ['Business', /^(SchC|SchSE|F4562-C|Sch1\.(3|15|16|17)$|F8995)/],
  ['Rentals and sale', /^(SchE\.(\d+[AB]|1[AB]|2[AB])$|F4562-E|F4797|F8582|SchE\.26$)/],
  ['K-1s and basis', /^(SchE\.(28|32|41)|F7203)/],
  ['Deductions and credits', /^(SchA|F8283|F1040\.(12|13|14)$|F8812|F8863|F2441|F8867|F1040\.19)/],
  ['Tax and payments', /^(F1040|Sch1|Sch2|Sch3|F6251|F8960|F2210)/],
  ['Foreign accounts', /^F8938/],
  ['California', /^(SchCA540NR|F540NR|FTB|ScheduleS)/],
];
export const areaOf = (key: string) => AREAS.find(([, re]) => re.test(key))?.[0] ?? 'Other';

// ---------- presentation helpers shared by every view ----------
export function formName(form: string): string {
  const m: Record<string, string> = { F1040: 'Form 1040', SchCA540NR: 'Schedule CA (540NR)', F540NR: 'Form 540NR', 'F4562-C': 'Form 4562, business', 'F4562-E': 'Form 4562, rentals', FTB3885A: 'FTB 3885A', FTB5805: 'FTB 5805', ScheduleS: 'Schedule S' };
  if (m[form]) return m[form];
  if (/^Sch/.test(form)) return 'Schedule ' + form.slice(3);
  if (/^F\d/.test(form)) return 'Form ' + form.slice(1);
  return form;
}

// Worksheet lines: arithmetic steps a reviewer does not review on their own.
// Pass-through carries (same value as their one input) and generic step labels, unless on a main form.
const MAIN_FORM = /^(F1040|F540NR)\./;
const GENERIC = /^(line \d|add lines|combine lines|.*\bline \d+ (minus|divided by)|.*\(line \d+ \/ line \d+\)|total \(part [ivx]+\)|amount from schedule)/i;
export function isWorksheet(l: Line, L: Record<string, Line>): boolean {
  if (l.sources.length) return false;
  if (GENERIC.test(l.label)) return true;
  if (MAIN_FORM.test(l.key)) return false;
  if (l.inputs.length === 1 && L[l.inputs[0]] && L[l.inputs[0]].value === l.value) return true;
  return false;
}

// Labels that read the same for two different lines get their form appended.
export function labelMaker(lines: Line[]): (l: Line) => string {
  const count: Record<string, number> = {};
  for (const l of lines) count[l.label] = (count[l.label] ?? 0) + 1;
  return l => (count[l.label] > 1 ? `${l.label} (${formName(l.form)} line ${l.line})` : l.label);
}

// ---------- tax effect of changing a line ----------
// The engine cannot be rerun. Per the readme, effect = change x v3 tax_effect_rates[category].
// Each line maps to a rate category and a sign (an expense going up lowers profit), or to a
// payment/credit (1:1 on balance due or tax), or to nothing we can estimate honestly.
export type Effect = { federal: number; california: number; kind: 'tax' | 'balance_due' | 'none'; basis: string };
type Map_ = { cat: string; sign: number; ca?: string } | { pay: 'federal' | 'california' } | { credit: 'federal' | 'california' };
function effectMap(l: Line): Map_ | null {
  const k = l.key;
  const lot = k.match(/^F8949\.([A-Z])\./);
  if (lot) return { cat: 'DEFJKL'.includes(lot[1]) ? 'ltcg' : 'stcg', sign: 1 };
  if (/^SchD\.(1b|2|3|6)$/.test(k)) return { cat: 'stcg', sign: 1 };
  if (/^SchD\.(8b|9|10|11|12|13|14)$/.test(k)) return { cat: 'ltcg', sign: 1 };
  if (/^SchB\.(1|5)\.\d+$/.test(k)) return { cat: 'interest', sign: 1 };
  if (/^F1040\.1a$/.test(k)) return { cat: 'wages', sign: 1 };
  if (/^SchC\.1$/.test(k)) return { cat: 'schc_profit', sign: 1 };
  if (/^SchC\.(8|9|11|13|15|17|18|22|24a|24b|25|27a\.\d|30)$/.test(k) || /^F4562-C\.(12|14|19a)$/.test(k)) return { cat: 'schc_profit', sign: -1 };
  if (/^SchE\.3[AB]$/.test(k) || /^SchE\.28[AB]$/.test(k)) return { cat: 'ordinary_income', sign: 1 };
  if (/^SchE\.(9|11|12|14|16|18|19)[AB]$/.test(k)) return { cat: 'ordinary_income', sign: -1, ca: /A$/.test(k) ? 'ca_source_income' : undefined };
  if (/^Sch1\.(13|15|16|17)$/.test(k)) return { cat: 'adjustment', sign: 1 };
  if (/^SchA\.5[ab]$/.test(k)) return { cat: 'salt', sign: 1 };
  if (/^(SchA\.(8a|8c|11)|F8283\.)/.test(k)) return { cat: 'itemized', sign: 1 };
  if (/^SchCA540NR\.\d+\.E$/.test(k)) return { cat: 'ca_source_income', sign: 1 };
  if (/^(F1040\.(25a|26)|Sch3\.(10|11))$/.test(k)) return { pay: 'federal' };
  if (/^F540NR\.(71|72|73)$/.test(k)) return { pay: 'california' };
  if (/^(F1040\.19|Sch3\.1)$/.test(k)) return { credit: 'federal' };
  return null;
}
export function effectOf(P: Packet, l: Line, delta: number): Effect {
  const m = effectMap(l);
  const R = P.return_versions.find((v: any) => v.version === 'v3').tax_effect_rates;
  if (!m || typeof l.value !== 'number') return { federal: 0, california: 0, kind: 'none', basis: 'No rate applies to this line; the effect needs an engine recompute.' };
  if ('pay' in m) return { federal: m.pay === 'federal' ? -delta : 0, california: m.pay === 'california' ? -delta : 0, kind: 'balance_due', basis: 'Payments change the balance due 1:1.' };
  if ('credit' in m) return { federal: m.credit === 'federal' ? -delta : 0, california: m.credit === 'california' ? -delta : 0, kind: 'tax', basis: 'Credits change tax 1:1.' };
  // State and local taxes: the federal deduction is capped, so only the change in the capped amount counts
  // (the v3 salt rate is 0 because 5d is above the cap; a large cut crosses back under it).
  if (/^SchA\.5[ab]$/.test(l.key)) {
    const L = Object.fromEntries(P.return_versions.find((v: any) => v.version === 'v3').lines.map((x: Line) => [x.key, x.value]));
    const p = P.engine_reference.parameters;
    const cap = Math.max(p.salt_cap_floor, p.salt_cap - p.salt_cap_phase_rate * Math.max(0, L['F1040.11'] - p.salt_cap_phase_start));
    const fedChange = Math.min(cap, L['SchA.5d'] + delta) - L['SchA.5e'];
    return {
      federal: Math.round(fedChange * R.itemized.federal_per_dollar), california: Math.round(delta * R.salt.california_per_dollar), kind: 'tax',
      basis: `capped SALT changes by ${fedChange.toLocaleString('en-US')} x v3 itemized rate; California ${delta.toLocaleString('en-US')} x salt rate`,
    };
  }
  // A sale during California residency is fully California-source (readme): use ca_source_income.
  const sold = l.label.match(/sold (\d{4}-\d{2}-\d{2})/)?.[1];
  const caRes = P.household.residency.find((r: any) => r.state === 'CA');
  const d = delta * m.sign, ca = m.ca ?? (sold && caRes && sold >= caRes.from && sold <= caRes.to ? 'ca_source_income' : m.cat);
  return {
    federal: Math.round(d * R[m.cat].federal_per_dollar), california: Math.round(d * R[ca].california_per_dollar), kind: 'tax',
    basis: `${d > 0 ? '+' : ''}${d.toLocaleString('en-US')} x v3 ${m.cat} rate${ca !== m.cat ? ` (California: ${ca})` : ''}`,
  };
}

// ---------- knock-on effects the rate estimate does not capture ----------
// The engine cannot be rerun, so we do not propagate adjustments into dependent totals.
// Where a change is known to move a non-linear line, that line is flagged "needs recompute"
// and someone records how it was handled. Sources: readme ("schc_profit also drives SE tax and QBI";
// "SEP and SE health insurance also change the QBI deduction, which the adjustment rate does not capture")
// and the engine's own limits (R-SEP-LIMIT, R-SEHI).
export type KnockOn = { line: string; why: string };
export function knockOns(key: string): KnockOn[] {
  if (/^(SchC\.|F4562-C\.)/.test(key)) return [
    { line: 'Sch1.16', why: 'The SEP deduction is limited to 20% of net profit less half the SE tax (R-SEP-LIMIT); a Schedule C change moves the limit.' },
    { line: 'Sch1.17', why: 'The self-employed health insurance deduction is limited by business income less half SE tax and SEP (R-SEHI).' },
  ];
  if (/^Sch1\.(16|17)$/.test(key)) return [
    { line: 'F8995.2.1', why: 'SEP and SE health insurance reduce qualified business income; the adjustment rate does not capture the QBI deduction (readme).' },
  ];
  return [];
}

// The amount a finding's fix proposes for this line, if it states one.
export function proposedValue(f: Finding, l: Line): number | undefined {
  const fix = f.fix ?? '';
  const n = (s: string) => Number(s.replace(/,/g, ''));
  let m = fix.match(new RegExp(`${l.key.replace(/\./g, '\\.')} = (-?[\\d,]+)`));
  if (m) return n(m[1]);
  if (new RegExp(`^Remove ${l.key.replace(/\./g, '\\.')}\\b`).test(fix)) return 0;
  if (/^F8949\./.test(l.key) && (m = fix.match(/gain (-?[\d,]+)/))) return n(m[1]);
  if ((m = fix.match(/^(?:Deduct|Use [\w ]+:) (-?[\d,]+)/))) return n(m[1]);
  return undefined;
}

