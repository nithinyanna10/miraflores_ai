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
          const d = this.evs[s]?.document_id ?? (this.docs[s] ? s : s.match(/^doc:(D\d+)/)?.[1]);
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
