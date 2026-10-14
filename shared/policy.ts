// Who may do what. The server enforces this; the client uses it only to hide actions a user cannot take.
import { isLot, isWorksheet, areaOf, type Graph } from './packet.ts';

export type Actor = { id: string; name: string; role: string; sensitive_data_clearance?: boolean; active_from?: string };
export type EventIn = { type: string; refs: string[]; payload: any };
export type StoredEvent = EventIn & { seq: number; at: string; actor: string };

const STAFF = ['preparer', 'reviewer', 'partner', 'firm_administrator', 'quality_reviewer'];
const WORKERS = ['preparer', 'reviewer', 'partner'];
const REVIEWERS = ['reviewer', 'partner', 'quality_reviewer'];

export const LEVELS = ['preparer', 'reviewer', 'partner'] as const;

// Event type -> roles allowed to create it. Anything not listed is server-only.
export const ALLOWED: Record<string, string[]> = {
  verified: WORKERS,
  verification_withdrawn: WORKERS,
  note: STAFF,
  client_question: WORKERS,
  client_answer: ['client'],
  review_note_opened: REVIEWERS,
  review_note_replied: STAFF,
  review_note_cleared: REVIEWERS,
  signed_off: WORKERS,
  signoff_withdrawn: WORKERS,
  adjusted: WORKERS,
  election_recorded: WORKERS,
  recompute_recorded: WORKERS,
  variance_explained: WORKERS,
  variance_explanation_withdrawn: WORKERS,
  adjustment_reversed: WORKERS,
  adjustment_approved: ['partner'],
  finding_resolved: ['reviewer', 'partner'],
  finding_reopened: ['reviewer', 'partner'],
};

// What each action is called in refusals and buttons.
export const VERB: Record<string, string> = {
  verified: 'verify a number', verification_withdrawn: 'withdraw a verification', note: 'add a note',
  review_note_opened: 'write a review note', review_note_replied: 'reply to a review note', review_note_cleared: 'clear a review note',
  adjusted: 'adjust a line', election_recorded: 'record an election', recompute_recorded: 'record a recompute', variance_explained: 'explain a variance', variance_explanation_withdrawn: 'withdraw a variance explanation', adjustment_reversed: 'reverse an adjustment', adjustment_approved: 'approve an adjustment', signed_off: 'sign off', client_question: 'send a question to the client', client_answer: 'answer a question', signoff_withdrawn: 'withdraw a sign-off', finding_resolved: 'resolve an open item', finding_reopened: 'reopen an open item',
};
export const can = (a: Actor | undefined, type: string) => !!a && isActive(a) && (ALLOWED[type] ?? []).includes(a.role);

export const isActive = (a: Actor, now = new Date().toISOString()) => !a.active_from || a.active_from <= now.slice(0, 10);

// Returns a plain-English refusal, or null if allowed. `log` is every event so far.
export function refuse(a: Actor | undefined, e: EventIn, log: StoredEvent[], g: Graph): string | null {
  if (!a) return 'Pick who you are in the role switcher first.';
  if (!isActive(a)) return `${a.name} starts on ${a.active_from} and cannot act on this return yet.`;
  const roles = ALLOWED[e.type];
  if (!roles) return `${e.type.replace(/_/g, ' ')} is recorded by the system, not by people.`;
  if (!roles.includes(a.role)) return `A ${a.role.replace(/_/g, ' ')} cannot ${VERB[e.type]}.`;
  if (!e.refs.length) return 'Say what this applies to.';

  if (e.type === 'verified' && !g.P.firm.starter_standards.verification_types.includes(e.payload?.method))
    return 'Choose how the number was verified.';
  if (['note', 'review_note_opened', 'review_note_replied', 'finding_resolved'].includes(e.type) && !String(e.payload?.text ?? '').trim())
    return 'Write the note first.';

  if (e.type === 'client_question' && !String(e.payload?.text ?? '').trim()) return 'Write the question first.';
  // Firm rule: every judgment call records the authority relied on.
  if (e.type === 'election_recorded' && (!String(e.payload?.reason ?? '').trim() || !String(e.payload?.authority ?? '').trim() || !['adopt', 'reject'].includes(e.payload?.decision)))
    return 'Record the decision, the reason and the authority relied on.';
  if (e.type === 'recompute_recorded') {
    const ids: number[] = e.payload?.adjustments ?? [];
    if (!ids.length || !ids.every(id => log.some(x => x.type === 'adjusted' && x.seq === id))) return 'Name the adjustments this recompute covers.';
    if (!String(e.payload?.text ?? '').trim()) return 'Say how the knock-on effect was handled: recomputed by hand, adjusted, or immaterial and why.';
  }
  // Each prior-year variance needs its own reason, even when explained in bulk.
  if (e.type === 'variance_explained') {
    const reasons = e.payload?.reasons ?? {};
    const ids = Object.keys(reasons);
    if (!ids.length) return 'Pick at least one change from 2024.';
    const missing = ids.filter(id => !String(reasons[id] ?? '').trim());
    if (missing.length) return `Each change needs its own reason. Missing: ${missing.join(', ')}.`;
  }
  if (e.type === 'adjusted') {
    const l = g.lines.v3[e.refs[0]];
    if (!l || typeof l.value !== 'number') return 'Only numeric return lines can be adjusted.';
    if (typeof e.payload?.to !== 'number' || !Number.isFinite(e.payload.to)) return 'Enter the corrected amount.';
    if (!String(e.payload?.reason ?? '').trim()) return 'Say why. The reason stays with the adjustment for the reviewer and the examiner.';
    const cur = currentValue(g, log, l.key);
    if (e.payload?.from !== cur) return `The line is now ${cur}, not ${e.payload?.from}. Reload and look again.`;
    if (e.payload.to === cur) return 'That is the current amount.';
  }
  if (e.type === 'adjustment_reversed' || e.type === 'adjustment_approved') {
    const adj = log.find(x => x.type === 'adjusted' && x.seq === e.payload?.adjustment);
    if (!adj) return 'That adjustment does not exist.';
    if (log.some(x => x.type === 'adjustment_reversed' && x.payload?.adjustment === adj.seq)) return 'That adjustment was already reversed.';
    if (e.type === 'adjustment_reversed' && !String(e.payload?.reason ?? '').trim()) return 'Say why it is being reversed.';
    if (e.type === 'adjustment_approved') {
      if (!adj.payload.needs_partner) return 'That adjustment does not need partner approval.';
      if (adj.actor === a.id) return 'You made this adjustment, so another partner must approve it.';
      if (log.some(x => x.type === 'adjustment_approved' && x.payload?.adjustment === adj.seq)) return 'Already approved.';
    }
  }
  if (e.type === 'client_answer') {
    const q = log.find(x => x.type === 'client_question' && x.seq === e.payload?.question);
    if (!q) return 'That question does not exist.';
    if (!String(e.payload?.text ?? '').trim() && !(e.payload?.attachments ?? []).length) return 'Write an answer or attach a file.';
  }
  if (e.type === 'review_note_replied' || e.type === 'review_note_cleared') {
    const opened = log.find(x => x.type === 'review_note_opened' && x.seq === e.payload?.note);
    if (!opened) return 'That review note does not exist.';
    if (log.some(x => x.type === 'review_note_cleared' && x.payload?.note === opened.seq)) return 'That review note is already cleared.';
    if (e.type === 'review_note_cleared' && opened.actor !== a.id && a.role !== 'partner') return 'Only the reviewer who wrote the note, or the partner, can clear it.';
  }

  if (e.type === 'signed_off') {
    const level = e.payload?.level;
    if (!LEVELS.includes(level)) return 'Say which level you are signing at.';
    if (level !== a.role) return `You can only sign off as ${a.role}.`;
    // Firm rule: a person may not review or sign off on work they prepared.
    if (level !== 'preparer') {
      const scope = scopeLines(g, e.refs[0]);
      const prepared = log.some(x => x.actor === a.id && (x.type === 'verified' || (x.type === 'signed_off' && x.payload?.level === 'preparer')) && x.refs.some(r => r === e.refs[0] || scope.includes(r)));
      if (prepared) return `You prepared part of ${scopeName(e.refs[0])}, so someone else must sign off on it as ${level}.`;
      const below = LEVELS[LEVELS.indexOf(level) - 1];
      if (!currentSignoffs(log, g).some(s => s.scope === e.refs[0] && s.level === below && !s.reopened)) return `${scopeName(e.refs[0])} needs a current ${below} sign-off first.`;
    }
    if (e.payload?.hash !== scopeHash(g, log, e.refs[0])) return 'The work changed while you were signing. Reload and look again.';
  }
  return null;
}

// ---------- adjustments: the original stays; the latest live adjustment wins ----------
export const NEEDS_PARTNER_OVER = 1000; // firm rule: adjustments with a tax effect over 1,000 need partner sign-off
export function liveAdjustments(log: StoredEvent[]): Record<string, StoredEvent> {
  const reversed = new Set(log.filter(x => x.type === 'adjustment_reversed').map(x => x.payload?.adjustment));
  const out: Record<string, StoredEvent> = {};
  for (const x of log) if (x.type === 'adjusted' && !reversed.has(x.seq)) out[x.refs[0]] = x;
  return out;
}
export function currentValue(g: Graph, log: StoredEvent[], key: string): any {
  return liveAdjustments(log)[key]?.payload.to ?? g.lines.v3[key]?.value;
}

// ---------- what a client may see ----------
// Clients see questions addressed to them, their own answers and uploads, files staff chose to share,
// and their own unmasking. Review notes, open items, judgment calls, verifications and sign-offs are internal.
export const CLIENT_TYPES = new Set(['client_question', 'client_answer', 'client_approved', 'client_signed_8879']);
export const ATTACH_ROLES = [...STAFF, 'client'];
export function visibleTo(a: Actor | undefined, e: StoredEvent, people: Actor[]): boolean {
  if (!a) return false;
  if (a.role !== 'client') return true;
  if (CLIENT_TYPES.has(e.type)) return true;
  const byClient = people.find(p => p.id === e.actor)?.role === 'client';
  if (e.type === 'evidence_attached') return byClient || !!e.payload?.shared_with_client;
  if (e.type === 'sensitive_viewed') return e.actor === a.id;
  return false;
}

// ---------- sign-off scopes: an area of the return, or the whole return ----------
export const scopeName = (scope: string) => (scope === 'area:Whole return' ? 'the whole return' : scope.replace(/^area:/, ''));
export function scopeLines(g: Graph, scope: string): string[] {
  const L = g.lines.v3;
  const area = scope.replace(/^area:/, '');
  return Object.values(L).filter(l => (area === 'Whole return' || areaOf(l.key) === area) && (isLot(l.key) || !isWorksheet(l, L))).map(l => l.key);
}

// What a sign-off covers: each line's value, its sources' values, and the evidence recorded on it.
// Any change to these after signing reopens the sign-off.
export function scopeHash(g: Graph, log: StoredEvent[], scope: string): string {
  const keys = scopeLines(g, scope);
  const set = new Set(keys);
  const evidence = log.filter(x => ['verified', 'verification_withdrawn', 'finding_resolved', 'finding_reopened', 'adjusted', 'adjustment_reversed', 'adjustment_approved'].includes(x.type) && x.refs.some(r => set.has(r))).map(x => x.seq);
  // Source refs, not source values: the packet is immutable, and masked copies must hash the same.
  const parts = keys.map(k => { const l = g.lines.v3[k]; return [k, l.value, l.sources]; });
  return fnv(JSON.stringify([parts, evidence]));
}

export type Signoff = { seq: number; scope: string; level: string; actor: string; at: string; reopened: boolean };
export function currentSignoffs(log: StoredEvent[], g: Graph): Signoff[] {
  const withdrawn = new Set(log.filter(x => x.type === 'signoff_withdrawn').map(x => x.payload?.signoff));
  return log.filter(x => x.type === 'signed_off' && !withdrawn.has(x.seq))
    .map(x => ({ seq: x.seq, scope: x.refs[0], level: x.payload.level, actor: x.actor, at: x.at, reopened: x.payload.hash !== scopeHash(g, log, x.refs[0]) }));
}

function fnv(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(16).padStart(8, '0');
}
