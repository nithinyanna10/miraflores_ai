import { useEffect, useMemo, useState } from 'react';
import { Graph, SimulatedSource, severityStatus, worse, isLot, type Finding, type Status } from '../shared/packet.ts';

export type WEvent = { seq: number; at: string; actor: string; type: string; refs: string[]; payload: any };

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

function derive(g: Graph, events: WEvent[]) {
  const closed = new Set(events.filter(e => e.type === 'finding_resolved').map(e => e.payload.id));
  const findings: Finding[] = events.filter(e => e.type === 'finding_opened' && !closed.has(e.payload.id)).map(e => e.payload);
  const L = g.lines.v3;
  const byLine: Record<string, Finding[]> = {};
  const unplaced: Finding[] = [];
  // Everything a line is built from, transitively.
  const up: Record<string, Set<string>> = {};
  const upstream = (k: string): Set<string> => {
    if (up[k]) return up[k];
    up[k] = new Set();
    for (const i of L[k]?.inputs ?? []) { up[k].add(i); for (const x of upstream(i)) up[k].add(x); }
    return up[k];
  };
  for (const f of findings) {
    // A finding sits on the most upstream lines it names; totals built from them inherit it.
    const named = f.lines.filter(k => L[k]);
    const keys = named.filter(k => !named.some(j => j !== k && upstream(k).has(j)));
    if (!keys.length) unplaced.push(f);
    for (const k of keys) (byLine[k] ??= []).push(f);
  }
  const own = (k: string): Status => (byLine[k] ?? []).reduce<Status>((s, f) => worse(s, severityStatus(f.severity) ?? 'Unverified'), 'Unverified');
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
  const source = new SimulatedSource(g);
  return { findings, byLine, unplaced, own, inherited, blocking, source, lotKeys: Object.keys(L).filter(isLot) };
}

export type Workpaper = ReturnType<typeof useWorkpaper>;
