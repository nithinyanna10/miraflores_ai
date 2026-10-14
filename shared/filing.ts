// Filing state derived from the event log: readiness against the firm's required steps, the client's
// e-signatures, e-file submissions and agency responses, the freeze at filing, and amendments.
import type { Graph } from './packet.ts';
import { currentSignoffs, liveAdjustments, type StoredEvent } from './policy.ts';

export type Step = { step: string; done: boolean; missing?: string; refs?: string[] };

// Open items the way the workpaper counts them: opened by the audit, not resolved, not addressed by a live
// adjustment, not explained (variances).
export function openFindings(log: StoredEvent[]) {
  const resolved = new Set<string>(), reopened = new Set<string>();
  for (const e of log) {
    if (e.type === 'finding_resolved') { resolved.add(e.payload.id); reopened.delete(e.payload.id); }
    if (e.type === 'finding_reopened') resolved.delete(e.payload.id);
  }
  const addressed = new Set(Object.values(liveAdjustments(log)).map(a => a.payload.finding).filter(Boolean));
  const withdrawn = new Set(log.filter(e => e.type === 'variance_explanation_withdrawn').map(e => e.payload.explanation));
  const explained = new Set(log.filter(e => e.type === 'variance_explained' && !withdrawn.has(e.seq)).flatMap(e => Object.keys(e.payload.reasons)));
  return log.filter(e => e.type === 'finding_opened').map(e => e.payload).filter((f: any) => !resolved.has(f.id) && !addressed.has(f.id) && !explained.has(f.id));
}

export const signedBy = (log: StoredEvent[]) => {
  const sent = log.filter(e => e.type === 'sent_for_approval').at(-1);
  return sent ? log.filter(e => e.type === 'client_signed_8879' && e.seq > sent.seq) : [];
};

export function readiness(g: Graph, log: StoredEvent[]): Step[] {
  const P = g.P;
  const open = openFindings(log);
  const openOf = (pred: (f: any) => boolean) => open.filter(pred);
  const so = currentSignoffs(log, g).filter(s => s.scope === 'area:Whole return' && !s.reopened);
  const approved = new Set(log.filter(e => e.type === 'adjustment_approved').map(e => e.payload.adjustment));
  const pending = Object.values(liveAdjustments(log)).filter(a => a.payload.needs_partner && !approved.has(a.seq));
  const notesOpen = log.filter(e => e.type === 'review_note_opened' && !log.some(x => x.type === 'review_note_cleared' && x.payload.note === e.seq));
  const clients = P.firm.client_users.map((c: any) => c.id);
  const signers = new Set(signedBy(log).map(e => e.actor));
  const step = (name: string, issues: any[], missing: (n: number) => string, refs?: string[]): Step =>
    ({ step: name, done: issues.length === 0, missing: issues.length ? missing(issues.length) : undefined, refs });
  const steps = P.firm.starter_standards.required_steps as string[];
  const map: Record<string, Step> = {
    'Engagement letter and consents signed': step(steps[0], ['D01', 'D02'].filter(d => !g.docs[d]), n => `${n} document(s) missing`, ['D01', 'D02']),
    'Identity verified': step(steps[1], openOf(f => f.check === 'client_contradictions' && /SSN/.test(f.title)), n => `${n} identity mismatch(es) open`, ['D04', 'D05', 'D71']),
    'Prior-year return reviewed': step(steps[2], openOf(f => f.check === 'carryovers' || (f.check === 'client_contradictions' && /Prior preparer/.test(f.title) && f.severity !== 'info')), n => `${n} prior-year item(s) open`, ['D06', 'D07']),
    'All documents accounted for': step(steps[3], openOf(f => f.check === 'document_landings'), n => `${n} document(s) land nowhere with no reason`),
    'Prior-year variances explained': step(steps[4], openOf(f => f.check === 'prior_year_variance'), n => `${n} change(s) from 2024 not explained`),
    'Carryovers agreed to prior year': step(steps[5], openOf(f => f.check === 'carryovers' || f.check === 'basis_rollforward'), n => `${n} carryover or basis item(s) open`),
    'Estimated payments agreed to IRS and FTB records': step(steps[6], openOf(f => f.check === 'agency_payments' || /estimate/.test(f.title)), n => `${n} payment difference(s) open`, ['agency:/irs_account_transcript_2025', 'agency:/ftb_account']),
    'Due diligence completed': step(steps[7], openOf(f => /8867|due diligence/i.test(f.title)), () => 'Form 8867 not completed'),
    'Diagnostics resolved': step(steps[8], [...openOf(f => f.severity === 'error'), ...pending, ...notesOpen], n => `${n} blocking item(s): errors, review notes or adjustments awaiting the partner`),
    'Reviewer sign-off': step(steps[9], so.some(s => s.level === 'reviewer') ? [] : [1], () => 'No current reviewer sign-off on the whole return'),
    'Partner sign-off': step(steps[10], so.some(s => s.level === 'partner') ? [] : [1], () => 'No current partner sign-off on the whole return'),
    'Client approval and e-file authorization': step(steps[11], clients.filter((c: string) => !signers.has(c)), n => `${n} of ${clients.length} spouse(s) have not signed Form 8879`),
  };
  return steps.map(s => map[s] ?? { step: s, done: false, missing: 'Not tracked' });
}

// E-file: transmissions, and agency responses replayed in order from the packet's agency records.
export function efileState(g: Graph, log: StoredEvent[]) {
  const records = g.P.tax_agency_records.efile as any[];
  const responses = log.filter(e => e.type === 'efile_response');
  const transmissions = log.filter(e => e.type === 'efile_transmitted');
  // The next record the agencies send. A rejection whose cause the workpaper already fixed (its open item,
  // which cites agency:/efile/<i>, is closed) cannot happen: skip it and the state return it held.
  const open = new Set(openFindings(log).flatMap((f: any) => f.refs));
  let i = responses.length ? responses.at(-1)!.payload.index + 1 : 0;
  while (records[i] && records[i].status === 'rejected' && !open.has(`agency:/efile/${i}`)) i += 2;
  const nextIndex = records[i] ? i : -1;
  const next = records[i];
  const lastFed = [...responses].reverse().find(r => records[r.payload.index].jurisdiction === 'federal');
  const lastCa = [...responses].reverse().find(r => records[r.payload.index].jurisdiction === 'california');
  const fedAccepted = lastFed && records[lastFed.payload.index].status === 'accepted';
  const caAccepted = lastCa && records[lastCa.payload.index].status === 'accepted';
  // A response is due once per jurisdiction per transmission.
  const awaiting = transmissions.length > 0 && !!next && responses.filter(r => r.seq > transmissions.at(-1)!.seq).length < 2;
  return { records, responses, transmissions, next, nextIndex, awaiting, fedAccepted, caAccepted };
}

export const frozenAt = (log: StoredEvent[]) => log.find(e => e.type === 'return_frozen');
export const openAmendment = (log: StoredEvent[]) => {
  const a = log.filter(e => e.type === 'amendment_opened').at(-1);
  return a && !log.some(e => e.type === 'amendment_filed' && e.payload.amendment === a.seq) ? a : undefined;
};

// The return as finalized for approval: v3 plus each live adjustment's estimated effect. Labelled as an
// estimate wherever it is shown, because the engine cannot be rerun.
export function finalSummary(g: Graph, log: StoredEvent[]) {
  const v3 = g.P.return_versions.find((v: any) => v.version === 'v3').summary;
  const t = { fedTax: 0, caTax: 0, fedBal: 0, caBal: 0 };
  for (const a of Object.values(liveAdjustments(log))) {
    const e = a.payload.effect;
    if (e.kind === 'tax') { t.fedTax += e.federal; t.caTax += e.california; }
    if (e.kind === 'balance_due') { t.fedBal += e.federal; t.caBal += e.california; }
  }
  return {
    federal: { total_tax: v3.federal.total_tax + t.fedTax, payments: v3.federal.payments - t.fedBal, balance_due: v3.federal.balance_due + t.fedTax + t.fedBal },
    california: { total_tax: v3.california.total_tax + t.caTax, payments: v3.california.payments - t.caBal, balance_due: v3.california.balance_due + t.caTax + t.caBal },
    estimated: Object.keys(liveAdjustments(log)).length > 0,
  };
}
