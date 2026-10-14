import { useEffect, useMemo, useRef, useState } from 'react';
import { breakHop, fmt, isLot, locate, severityStatus, shown, type Finding, type Graph, type Line, type Status } from '../shared/packet.ts';
import { StatusMark } from './StatusMark.tsx';
import type { Workpaper } from './data.ts';

type Props = { g: Graph; w: Workpaper; lineKey: string; src?: string; onLine: (k: string, src?: string) => void; onSrc: (ref: string) => void };

const effectText = (f: Finding) => {
  const e = f.tax_effect;
  if (!e) return null;
  const s = (n: number) => (n === 0 ? 'no change' : `${n > 0 ? '+' : '-'}${Math.abs(n).toLocaleString('en-US')}`);
  return <span title={e.basis}>{e.kind === 'balance_due' ? 'Balance due' : 'Tax'}: federal {s(e.federal)}, California {s(e.california)}</span>;
};

function FindingCard({ f }: { f: Finding }) {
  const st = severityStatus(f.severity)!;
  return (
    <div className={`finding finding-${f.severity}`} role="note">
      <div className="finding-head"><StatusMark status={st} /><strong>{st}</strong><span className="ref">{f.id}</span></div>
      <p className="finding-title">{f.title}</p>
      {f.detail && <p className="memo">{f.detail}</p>}
      {f.fix && <p className="finding-fix"><span className="label">Fix</span> {f.fix}</p>}
      {f.tax_effect && <p className="finding-effect">{effectText(f)}</p>}
    </div>
  );
}

function Hop({ id, i, status, inherited, broken, dashed, children, active, onClick, label }: { id?: string; i: number; status: Status; inherited?: boolean; broken?: boolean; dashed?: boolean; children: React.ReactNode; active?: boolean; onClick?: () => void; label?: string }) {
  return (
    <li id={id ? `hop-${id}` : undefined} className={`hop${broken ? ' is-broken' : ''}${dashed ? ' is-dashed' : ''}${active ? ' is-active' : ''}`} style={{ '--i': i } as React.CSSProperties}>
      <span className="hop-seg" aria-hidden />
      <span className="hop-marker"><StatusMark status={status} inherited={inherited} /></span>
      {onClick ? <button className="hop-body" onClick={onClick} aria-label={label}>{children}</button> : <div className="hop-body">{children}</div>}
    </li>
  );
}

export function Thread({ g, w, lineKey, src, onLine, onSrc }: Props) {
  const l = g.line(lineKey)!;
  const fs = w.byLine![lineKey] ?? [];
  const breaks = useMemo(() => {
    const m: Record<string, Finding[]> = {};
    for (const f of fs) (m[breakHop(l, f, g)] ??= []).push(f);
    return m;
  }, [lineKey, fs]);
  const statusAt = (hop: string): Status => (breaks[hop] ?? []).reduce<Status>((s, f) => (severityStatus(f.severity) === 'Blocked' ? 'Blocked' : s === 'Blocked' ? s : severityStatus(f.severity) ?? s), 'Unverified');
  const own = w.own!(lineKey), inh = w.inherited!(lineKey);
  // Evidence named by a finding that the return never drew on.
  const ignored = useMemo(() => {
    const seen = new Set<string>();
    for (const f of fs) if (f.check !== 'prior_year_variance') for (const r of f.refs) {
      if (l.sources.includes(r) || g.line(r) || seen.has(r)) continue;
      if (g.resolve(r).kind !== 'unknown') seen.add(r);
    }
    return [...seen];
  }, [lineKey, fs]);
  const usedBy = g.usedBy.v3[lineKey] ?? [];
  const history = w.events.filter(e => e.refs.includes(lineKey));
  const srcStart = 1 + Math.min(l.inputs.length, 12);
  const root = useRef<HTMLElement>(null);
  // Bring the first break into view without losing the line itself.
  useEffect(() => { root.current?.querySelector('.hop.is-broken')?.scrollIntoView({ block: 'nearest' }); }, [lineKey]);

  return (
    <article className="thread" key={lineKey} ref={root}>
      <header className="thread-head">
        <p className="thread-key"><span className="ref">{l.key}</span> on the {l.jurisdiction === 'federal' ? 'federal' : 'California'} return</p>
        <h1><span className="num big">{fmt(l.value, isLot(l.key))}</span> <span className="thread-label">{l.label.replace(/ \((acquired|proceeds).*\)$/, '')}</span></h1>
        {isLot(l.key) && <p className="muted">{l.label.match(/\((acquired.*)\)$/)?.[1]}</p>}
        <p className="thread-status">
          <StatusMark status={own} /> {own}
          {own === 'Unverified' && inh !== 'Unverified' && <> <span className="muted">and built from lines that are</span> <StatusMark status={inh} inherited /> {inh}</>}
        </p>
        {Object.keys(breaks).some(h => h !== 'line') && (
          <p className="thread-breaks">The thread breaks at {Object.keys(breaks).filter(h => h !== 'line').map((h, j) => (
            <span key={h}>{j ? ', ' : ''}<button className="jump" onClick={() => { document.getElementById(`hop-${h}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' }); if (h !== 'rule') onSrc(h); }}>{h === 'rule' ? 'the rule' : g.resolve(h).title}</button></span>
          ))}.</p>
        )}
        {breaks.line?.map(f => <FindingCard key={f.id} f={f} />)}
      </header>

      <ol className="hops" aria-label="Proof thread">
        <Hop id="rule" i={0} status={statusAt('rule')} broken={!!breaks.rule}>
          <p className="hop-kind">Rule <abbr className="ref" title={g.ruleText(l.rule)}>{l.rule}</abbr></p>
          <p>{g.ruleText(l.rule)}</p>
          {l.note && <p className="memo">{l.note}</p>}
          {breaks.rule?.map(f => <FindingCard key={f.id} f={f} />)}
        </Hop>

        {l.inputs.length > 0 && <InputHops g={g} w={w} l={l} start={1} onLine={onLine} />}

        {l.sources.map((s, si) => {
          const n = g.resolve(s);
          const ev = n.ev;
          const text = ev ? g.docs[ev.document_id].pages.find((p: any) => p.page === ev.page)?.printed_content ?? '' : '';
          const found = ev ? locate(text, ev) : null;
          return (
            <Hop key={s} id={s} i={srcStart + si} status={statusAt(s)} broken={!!breaks[s]} active={src === s} onClick={() => onSrc(s)} label={`Show ${n.title}`}>
              <p className="hop-kind">{kindLabel(n.kind)} <span className="ref">{s}</span></p>
              <p className="hop-main"><span>{n.title}</span>{n.value !== undefined && typeof n.value !== 'object' && <span className="num">{fmt(n.value, ev?.value_type === 'money' && !Number.isInteger(n.value))}</span>}</p>
              {ev && <p className="hop-meta">{found && !found.approx ? `Printed on page ${ev.page} as "${text.slice(found.start, found.end)}"` : `Not printed on page ${ev.page}${ev.text_as_read ? '' : ' (read from a blank)'}`}. Read with confidence {ev.confidence}.</p>}
              {n.text && <p className="memo">{n.text}</p>}
              {breaks[s]?.map(f => <FindingCard key={f.id} f={f} />)}
            </Hop>
          );
        })}

        {ignored.map((r, ii) => {
          const n = g.resolve(r);
          return (
            <Hop key={r} i={srcStart + l.sources.length + ii} status="Question open" dashed active={src === r} onClick={() => onSrc(r)} label={`Show ${n.title}`}>
              <p className="hop-kind">Evidence the return did not use <span className="ref">{r}</span></p>
              <p className="hop-main"><span>{n.title}</span>{n.value !== undefined && typeof n.value !== 'object' && <span className="num">{fmt(n.value)}</span>}</p>
              {n.text && <p className="memo">{n.text}</p>}
            </Hop>
          );
        })}
      </ol>

      {usedBy.length > 0 && (
        <section className="thread-section">
          <h3>Flows into</h3>
          <ul className="link-list">{usedBy.map(k => <li key={k}><button onClick={() => onLine(k)}><StatusMark status={w.own!(k)} /> <span>{g.line(k)!.label}</span> <span className="num">{fmt(g.line(k)!.value)}</span></button></li>)}</ul>
        </section>
      )}
      <section className="thread-section">
        <h3>History</h3>
        {history.length ? <ul className="history">{history.map(e => <li key={e.seq}>{describe(e, g)}</li>)}</ul> : <p className="muted">Nothing recorded on this line yet.</p>}
      </section>
    </article>
  );
}

function InputHops({ g, w, l, start, onLine }: { g: Graph; w: Workpaper; l: Line; start: number; onLine: (k: string, src?: string) => void }) {
  const [open, setOpen] = useState<string | null>(null);
  const status = (k: string): [Status, boolean] => shown(w.own!(k), w.inherited!(k));
  const one = (k: string, idx: number) => {
    const x = g.line(k);
    const [st, inh] = status(k);
    return (
      <Hop key={k} i={idx} status={st} inherited={inh} broken={st === 'Blocked' && !inh} onClick={() => onLine(k)} label={`Open ${k}`}>
        <p className="hop-kind">Input line <span className="ref">{k}</span>{inh && <span className="muted"> problem upstream</span>}</p>
        <p className="hop-main"><span>{x ? (isLot(k) ? x.label.replace(/ \(acquired.*$/, '') : x.label) : `${k} (not on this return)`}</span><span className="num">{x ? fmt(x.value, isLot(k)) : ''}</span></p>
      </Hop>
    );
  };
  if (l.inputs.length <= 12) return <>{l.inputs.map((k, j) => one(k, start + j))}</>;
  // Large sets: roll up by broker; list only exceptions.
  const groups: Record<string, string[]> = {};
  for (const k of l.inputs) {
    const ev = g.line(k)?.sources.map(s => g.evs[s]).find(Boolean);
    const doc = ev?.document_id ?? 'other';
    (groups[doc] ??= []).push(k);
  }
  let j = start;
  return (
    <>
      {Object.entries(groups).map(([doc, ks]) => {
        const exceptions = ks.filter(k => w.byLine![k]?.length);
        const sum = ks.reduce((a, k) => a + (g.line(k)?.value ?? 0), 0);
        const st = exceptions.some(k => w.own!(k) === 'Blocked') ? 'Blocked' : exceptions.length ? 'Question open' : 'Unverified';
        return (
          <li key={doc} className="hop-group">
            <Hop i={j++} status={st as Status} broken={st === 'Blocked'} onClick={() => setOpen(open === doc ? null : doc)} label={`Show sales from ${doc}`}>
              <p className="hop-kind">Rollup <span className="ref">{doc}</span></p>
              <p className="hop-main"><span>{g.docs[doc]?.issuer ?? doc}: {ks.length} {ks.length === 1 ? 'sale' : 'sales'}, {exceptions.length ? `${exceptions.length} with open items` : 'no open items'}</span><span className="num">{fmt(sum, true)}</span></p>
              <p className="hop-meta">{open === doc ? 'Hide the sales' : ks.length === 1 ? 'Show the sale' : `Show all ${ks.length} sales`}</p>
            </Hop>
            <ol className="hops nested">{(open === doc ? ks : exceptions).map(k => one(k, j))}</ol>
          </li>
        );
      })}
    </>
  );
}

const kindLabel = (k: string) => ({ ev: 'Extracted field', doc: 'Document', page: 'Page not extracted', qa: 'Questionnaire answer', msg: 'Client message', call: 'Call note', py: 'Prior-year record', agency: 'Agency record', asset: 'Asset record', household: 'Household fact', param: 'Engine parameter', fx: 'Exchange rate', timeline: 'Timeline event', what_if: 'Engine alternative', version: 'Return version', line: 'Line', unknown: 'Unresolved reference' } as Record<string, string>)[k] ?? k;

function describe(e: { type: string; actor: string; at: string; payload: any }, g: Graph) {
  const who = e.actor === 'audit' ? 'The audit' : [...g.P.firm.staff, ...g.P.firm.client_users].find((p: any) => p.id === e.actor)?.name ?? e.actor;
  const when = new Date(e.at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  if (e.type === 'finding_opened') return <>{who} opened <span className="ref">{e.payload.id}</span> on {when}: {e.payload.title}</>;
  return <>{who}: {e.type.replace(/_/g, ' ')} on {when}</>;
}
