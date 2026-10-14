import { useEffect, useMemo, useState } from 'react';
import { Graph, SimulatedSource, severityStatus, worse, isLot, type Finding, type Status } from '../shared/packet.ts';
import { currentSignoffs, type StoredEvent } from '../shared/policy.ts';

export type WEvent = StoredEvent;

// Writes go through the server, which checks the role; the reply is either the stored event or a reason.
export async function post(user: string, type: string, refs: string[], payload: any = {}): Promise<string | null> {
  const r = await fetch('/api/events', { method: 'POST', headers: { 'content-type': 'application/json', 'x-user': user }, body: JSON.stringify({ type, refs, payload }) });
  return r.ok ? null : (await r.json().catch(() => ({ error: 'The server refused.' }))).error;
}
export async function reveal(user: string, ref: string): Promise<{ value?: any; error?: string }> {
  const r = await fetch('/api/reveal', { method: 'POST', headers: { 'content-type': 'application/json', 'x-user': user }, body: JSON.stringify({ ref }) });
  return r.json();
}

export function useWorkpaper() {
  const [g, setG] = useState<Graph | null>(null);
  const [events, setEvents] = useState<WEvent[]>([]);
  const [live, setLive] = useState(false);
  const [audit, setAudit] = useState<{ findings: Finding[] } | null>(null);

  useEffect(() => {
    fetch('/api/packet').then(r => r.json()).then(P => setG(new Graph(P)));
    fetch('/api/findings').then(r => r.json()).then(setAudit);
    let last = 0;
    fetch('/api/events').then(r => r.json()).then((es: WEvent[]) => {
      setEvents(es); last = es.at(-1)?.seq ?? 0;
      const src = new EventSource('/api/stream');
      src.onopen = () => setLive(true);
      src.onerror = () => setLive(false);
      src.onmessage = m => {
        const e: WEvent = JSON.parse(m.data);
        if (e.seq > last) { last = e.seq; setEvents(prev => [...prev, e]); }
      };
    });
  }, []);

  const derived = useMemo(() => (g ? derive(g, events) : null), [g, events]);
  return { g, events, live, audit, ...derived };
}

export type ReviewNote = { open: WEvent; replies: WEvent[]; cleared?: WEvent };

function derive(g: Graph, events: WEvent[]) {
  const L = g.lines.v3;
  // Open items: opened by the audit, closed by a resolution, reopened by a reopen.
  const resolution: Record<string, WEvent | undefined> = {};
  for (const e of events) {
    if (e.type === 'finding_resolved') resolution[e.payload.id] = e;
    if (e.type === 'finding_reopened') resolution[e.payload.id] = undefined;
  }
  const allFindings: Finding[] = events.filter(e => e.type === 'finding_opened').map(e => e.payload);
  const findings = allFindings.filter(f => !resolution[f.id]);

  // Everything a line is built from, transitively.
  const up: Record<string, Set<string>> = {};
  const upstream = (k: string): Set<string> => {
    if (up[k]) return up[k];
    up[k] = new Set();
    for (const i of L[k]?.inputs ?? []) { up[k].add(i); for (const x of upstream(i)) up[k].add(x); }
    return up[k];
  };
  const byLine: Record<string, Finding[]> = {};
  const unplaced: Finding[] = [];
  for (const f of findings) {
    // A finding sits on the most upstream lines it names; totals built from them inherit it.
    const named = f.lines.filter(k => L[k]);
    const keys = named.filter(k => !named.some(j => j !== k && upstream(k).has(j)));
    if (!keys.length) unplaced.push(f);
    for (const k of keys) (byLine[k] ??= []).push(f);
  }

  // Review notes: open until the reviewer (or partner) clears them. Open notes block filing.
  const notes: ReviewNote[] = events.filter(e => e.type === 'review_note_opened').map(open => ({
    open,
    replies: events.filter(e => e.type === 'review_note_replied' && e.payload.note === open.seq),
    cleared: events.find(e => e.type === 'review_note_cleared' && e.payload.note === open.seq),
  }));
  const openNotes = notes.filter(n => !n.cleared);
  const notesByLine: Record<string, ReviewNote[]> = {};
  for (const n of notes) for (const r of n.open.refs) (notesByLine[r] ??= []).push(n);

  // Verifications: the latest one per line stands unless withdrawn. It records the value it saw;
  // if the line's value differs now, the verification is reopened.
  const verification: Record<string, WEvent | undefined> = {};
  for (const e of events) {
    if (e.type === 'verified') e.refs.forEach(r => (verification[r] = e));
    if (e.type === 'verification_withdrawn') e.refs.forEach(r => (verification[r] = undefined));
  }
  const verified = new Set(Object.keys(verification).filter(k => verification[k] && verification[k]!.payload.value === L[k]?.value));

  const own = (k: string): Status => {
    const s = (byLine[k] ?? []).reduce<Status>((s, f) => worse(s, severityStatus(f.severity) ?? 'Unverified'), 'Unverified');
    if (openNotes.some(n => n.open.refs.includes(k))) return 'Blocked';
    if (s !== 'Unverified') return s;
    const v = verification[k];
    return v ? (v.payload.value === L[k]?.value ? 'Verified' : 'Reopened') : 'Unverified';
  };
  // Status inherited from inputs: a total is only as good as what it is built from.
  const memo: Record<string, Status> = {};
  const inherited = (k: string, seen = new Set<string>()): Status => {
    if (memo[k]) return memo[k];
    if (seen.has(k)) return 'Unverified';
    seen.add(k);
    const s = (L[k]?.inputs ?? []).reduce<Status>((acc, i) => worse(acc, worse(own(i), inherited(i, seen))), 'Unverified');
    return (memo[k] = s);
  };
  const blocking = findings.filter(f => f.severity === 'error');
  // Variances are questions to explain, not problems that flow into totals.
  const affMemo: Record<string, number> = {};
  const affectedBy = (k: string) => (affMemo[k] ??= new Set([...upstream(k)].flatMap(u => (byLine[u] ?? []).filter(f => f.check !== 'prior_year_variance').map(f => f.id))).size);
  const signoffs = currentSignoffs(events, g);
  const source = new SimulatedSource(g);
  return {
    findings, allFindings, resolution, byLine, unplaced, own, inherited, affectedBy, upstream, blocking,
    notes, openNotes, notesByLine, verification, verified, signoffs, source, lotKeys: Object.keys(L).filter(isLot),
  };
}

export type Workpaper = ReturnType<typeof useWorkpaper>;
