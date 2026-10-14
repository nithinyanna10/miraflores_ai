import { useEffect, useMemo, useRef, useState } from 'react';
import { breakHop, fmt, formName, isLot, labelMaker, locate, severityStatus, type Finding, type Graph, type Line, type Status } from '../shared/packet.ts';
import { StatusMark } from './StatusMark.tsx';
import { lotLabel } from './Outline.tsx';
import type { Workpaper } from './data.ts';
import { LineActions, ReviewNotes, ResolveFinding, ClientQuestions, RecomputeCards, ExplainVariances, METHODS, useSession, useBulk, type Form, type Prefill } from './Actions.tsx';
import { can } from '../shared/policy.ts';

type Props = { g: Graph; w: Workpaper; lineKey: string; src?: string; onLine: (k: string, src?: string) => void; onSrc: (ref: string) => void; form: Form; setForm: (f: Form) => void };

const signed = (n: number) => (n === 0 ? 'no change' : `${n > 0 ? '+' : '−'}${Math.abs(n).toLocaleString('en-US')}`);

// Problem, fix, effect: one line each. The reasoning is one click away.
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

export function FindingCard({ f, onApply }: { f: Finding; onApply?: (p: Prefill) => void }) {
  const [why, setWhy] = useState(false);
  const [explain, setExplain] = useState(false);
  const { me } = useSession();
  const st = severityStatus(f.severity)!;
  return (
    <div className={`finding finding-${f.severity}`} role="note">
      <p className="finding-title"><StatusMark status={st} /> <span><strong className="finding-state">{st}.</strong> {f.title.replace(/^(F|Sch)[\w-]*\.[\w.+]+ /, '')}</span></p>
      {f.fix && <p className="finding-line"><span className="label">Fix</span> {f.fix}</p>}
      {f.tax_effect && <p className="finding-line" title={f.tax_effect.basis}><span className="label">{f.tax_effect.kind === 'balance_due' ? 'Balance due' : 'Tax'}</span> federal {signed(f.tax_effect.federal)}, California {signed(f.tax_effect.california)}</p>}
      {f.detail && <button className="why" aria-expanded={why} onClick={e => { e.stopPropagation(); setWhy(!why); }}>{why ? 'Hide the reasoning' : 'Show the reasoning'}</button>}
      {why && <p className="memo why-text">{f.detail} <span className="ref">{f.id}</span></p>}
      <div className="action-row finding-actions">
        {f.check === 'prior_year_variance' && can(me, 'variance_explained') && !explain && <button className="btn quiet" onClick={() => setExplain(true)}>Explain this change</button>}
        {onApply && can(me, 'adjusted') && <button className="btn quiet" onClick={e => { e.stopPropagation(); onApply({ finding: f.id, reason: `${f.title} Fix per ${f.id}: ${f.fix ?? ''}` }); }}>Apply the fix</button>}
        <ResolveFinding f={f} />
      </div>
      {explain && <ExplainVariances items={[f]} onDone={() => setExplain(false)} />}
    </div>
  );
}

function Hop({ id, status, affected, broken, dashed, children, active, onClick, label }: { id?: string; status: Status; affected?: number; broken?: boolean; dashed?: boolean; children: React.ReactNode; active?: boolean; onClick?: () => void; label?: string }) {
  const marker = status === 'Unverified' && affected ? <span className="affected" title={`Affected by ${affected} open items upstream`} /> : <StatusMark status={status} />;
  return (
    <li id={id ? `hop-${id}` : undefined} className={`hop${broken ? ' is-broken' : ''}${broken && status === 'Question open' ? ' is-question' : ''}${dashed ? ' is-dashed' : ''}${active ? ' is-active' : ''}`}>
      <span className="hop-seg" aria-hidden />
      <span className="hop-marker">{marker}</span>
      {onClick ? <button className="hop-body" onClick={onClick} aria-label={label}>{children}</button> : <div className="hop-body">{children}</div>}
    </li>
  );
}

const Stage = ({ children }: { children: React.ReactNode }) => <li className="stage"><span className="hop-seg" aria-hidden /><span className="stage-label">{children}</span></li>;

export function Thread({ g, w, lineKey, src, onLine, onSrc, form, setForm }: Props) {
  const l = g.line(lineKey)!;
  const [prefill, setPrefill] = useState<Prefill>();
  const apply = (f: Finding) => (p: Prefill) => { setPrefill({ ...p, to: proposedValue(f, l) }); setForm('adjust'); };
  const label = labelMaker(Object.values(g.lines.v3));
  const fs = w.byLine![lineKey] ?? [];
  const breaks = useMemo(() => {
    const m: Record<string, Finding[]> = {};
    for (const f of fs) (m[breakHop(l, f, g)] ??= []).push(f);
    return m;
  }, [lineKey, fs]);
  const statusAt = (hop: string): Status => (breaks[hop] ?? []).reduce<Status>((s, f) => (s === 'Blocked' ? s : severityStatus(f.severity) ?? s), 'Unverified');
  const own = w.own!(lineKey), affected = w.affectedBy!(lineKey);
  const ignored = useMemo(() => {
    const seen = new Set<string>();
    for (const f of fs) if (f.check !== 'prior_year_variance') for (const r of f.refs) {
      if (l.sources.includes(r) || g.line(r) || seen.has(r)) continue;
      if (g.resolve(r).kind !== 'unknown') seen.add(r);
    }
    return [...seen];
  }, [lineKey, fs]);
  const usedBy = g.usedBy.v3[lineKey] ?? [];
  const history = w.events.filter(e => e.refs.includes(lineKey) && !['finding_opened', 'review_note_opened', 'review_note_replied', 'review_note_cleared', 'client_question', 'client_answer'].includes(e.type));
  const root = useRef<HTMLElement>(null);
  useEffect(() => { root.current?.querySelector('.hop.is-broken')?.scrollIntoView({ block: 'nearest' }); }, [lineKey]);
  const breakHops = Object.keys(breaks).filter(h => h !== 'line');

  return (
    <article className="thread" key={lineKey} ref={root}>
      <header className="thread-head">
        <p className="thread-key">{isLot(l.key) ? `Form 8949, box ${l.line.split('.')[0]}, lot ${l.line.split('.')[1]}` : `${formName(l.form)} line ${l.line}`}</p>
        <h1>{w.adjustments![lineKey] && <s className="num was" title="The engine's value">{fmt(l.value, isLot(l.key))}</s>}<span className="num big">{fmt(w.value!(lineKey), isLot(l.key))}</span> <span className="thread-label">{isLot(l.key) ? lotLabel(l) : label(l)}</span></h1>
        {!(w.verification![lineKey] && (own === 'Verified' || own === 'Reopened')) && <p className="thread-status">
          {own !== 'Unverified'
            ? <><StatusMark status={own} /> {own}{breakHops.length > 0 && <>, breaks at {breakHops.map((h, j) => (
              <span key={h}>{j ? ', ' : ''}<button className="jump" onClick={() => { document.getElementById(`hop-${h}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' }); if (h !== 'rule') onSrc(h); }}>{h === 'rule' ? 'the rule' : g.resolve(h).title}</button></span>
            ))}</>}</>
            : <><StatusMark status={own} /> {own}</>}
          {affected > 0 && <span className="muted">. {own !== 'Unverified' ? 'Also affected' : 'Affected'} by {affected} open {affected === 1 ? 'item' : 'items'} upstream</span>}
        </p>}
        <ReviewNotes notes={w.notesByLine![lineKey] ?? []} />
        <ClientQuestions questions={w.questionsByRef![lineKey] ?? []} onAttachment={onSrc} />
        <RecomputeCards g={g} w={w} lineKey={lineKey} />
        {breaks.line?.map(f => <FindingCard key={f.id} f={f} />)}
        <LineActions g={g} w={w} lineKey={lineKey} form={form} setForm={setForm} prefill={prefill} />
      </header>

      <ol className="hops" aria-label="Proof thread">
        <Stage>Computed by</Stage>
        <Hop id="rule" status={statusAt('rule')} broken={!!breaks.rule}>
          <p className="hop-main"><span>{g.ruleText(l.rule)}</span></p>
          {l.note && <p className="memo">{l.note}</p>}
          {breaks.rule?.map(f => <FindingCard key={f.id} f={f} onApply={proposedValue(f, l) !== undefined ? apply(f) : undefined} />)}
        </Hop>

        {l.inputs.length > 0 && <><Stage>Built from {l.inputs.length} {l.inputs.length === 1 ? 'line' : 'lines'}</Stage><InputHops g={g} w={w} l={l} onLine={onLine} label={label} /></>}

        {l.sources.length > 0 && <Stage>Read from</Stage>}
        {groupClean(g, l, breaks).map(grp => grp.length >= 3 ? (
          <Hop key={grp[0]} id={grp[0]} status="Unverified" active={grp.includes(src ?? '')} onClick={() => onSrc(grp[0])} label={`Show ${g.evs[grp[0]].document_id} on the document`}>
            <p className="hop-main"><span>{g.docs[g.evs[grp[0]].document_id].title}, page {g.evs[grp[0]].page}</span></p>
            <p className="hop-meta">{grp.length} fields read, all match the printed page</p>
            <ul className="field-list">{grp.map(s => <li key={s}><span>{g.evs[s].label.replace(/^Lot \w+ /, '')}</span><span className="num">{fmt(g.evs[s].value, g.evs[s].value_type === 'money' && !Number.isInteger(g.evs[s].value))}</span></li>)}</ul>
          </Hop>
        ) : grp.map(s => {
          const n = g.resolve(s);
          const ev = n.ev;
          const text = ev ? g.docs[ev.document_id].pages.find((p: any) => p.page === ev.page)?.printed_content ?? '' : '';
          const found = ev ? locate(text, ev) : null;
          const problem = ev && (!found || found.approx ? `Not on the printed page${ev.text_as_read ? '' : '; read from a blank'}` : ev.confidence < 0.9 ? `Read with low confidence (${ev.confidence})` : '');
          return (
            <Hop key={s} id={s} status={statusAt(s)} broken={!!breaks[s]} active={src === s} onClick={() => onSrc(s)} label={`Show ${n.title} on the document`}>
              <p className="hop-main"><span>{n.title}</span>{n.value !== undefined && typeof n.value !== 'object' && <span className="num">{fmt(n.value, ev?.value_type === 'money' && !Number.isInteger(n.value))}</span>}</p>
              {problem && <p className="hop-problem">{problem}</p>}
              {!ev && n.text && <p className="memo clamp">{n.text}</p>}
              {breaks[s]?.map(f => <FindingCard key={f.id} f={f} onApply={proposedValue(f, l) !== undefined ? apply(f) : undefined} />)}
            </Hop>
          );
        }))}

        {(w.attachmentsByRef![lineKey] ?? []).length > 0 && <Stage>Evidence attached</Stage>}
        {(w.attachmentsByRef![lineKey] ?? []).map(a => (
          <Hop key={a.seq} id={`att:${a.payload.id}`} status="Unverified" active={src === `att:${a.payload.id}`} onClick={() => onSrc(`att:${a.payload.id}`)} label={`Open ${a.payload.name}`}>
            <p className="hop-main"><span>{a.payload.name}</span><span className="muted">{Math.max(1, Math.round(a.payload.size / 1024))} KB</span></p>
            <p className="hop-meta">Attached by {[...g.P.firm.staff, ...g.P.firm.client_users].find((p: any) => p.id === a.actor)?.name ?? a.actor}{a.payload.shared_with_client ? ', shared with the client' : ''}</p>
            {a.payload.note && <p className="memo clamp">{a.payload.note}</p>}
          </Hop>
        ))}
        {ignored.length > 0 && <Stage>Cited by an open item, not used by the return</Stage>}
        {ignored.map(r => {
          const n = g.resolve(r);
          return (
            <Hop key={r} id={r} status="Question open" dashed active={src === r} onClick={() => onSrc(r)} label={`Show ${n.title}`}>
              <p className="hop-main"><span>{n.title}</span>{n.value !== undefined && typeof n.value !== 'object' && <span className="num">{fmt(n.value)}</span>}</p>
              {n.text && <p className="memo clamp">{n.text}</p>}
            </Hop>
          );
        })}
      </ol>

      {usedBy.length > 0 && (
        <section className="thread-section">
          <h3>Flows into</h3>
          <ul className="link-list">{usedBy.map(k => <li key={k}><button onClick={() => onLine(k)}><span /><span>{label(g.line(k)!)}</span> <span className="num">{fmt(g.line(k)!.value)}</span></button></li>)}</ul>
        </section>
      )}
      {history.length > 0 && (
        <section className="thread-section">
          <h3>History</h3>
          <ul className="history">{history.map(e => <li key={e.seq}>{describe(e, g)}</li>)}</ul>
        </section>
      )}
    </article>
  );
}

// Sources in thread order; clean extracted fields from one document page collapse into one group.
function groupClean(g: Graph, l: Line, breaks: Record<string, Finding[]>): string[][] {
  const out: string[][] = [];
  const groups: Record<string, string[]> = {};
  for (const s of l.sources) {
    const ev = g.evs[s];
    const txt = ev ? g.docs[ev.document_id].pages.find((p: any) => p.page === ev.page)?.printed_content ?? '' : '';
    const loc = ev ? locate(txt, ev) : null;
    const clean = ev && !breaks[s] && loc && !loc.approx && ev.confidence >= 0.9;
    if (!clean) { out.push([s]); continue; }
    const key = `${ev.document_id}#${ev.page}`;
    if (!groups[key]) out.push((groups[key] = []));
    groups[key].push(s);
  }
  return out.flatMap(grp => (grp.length >= 3 ? [grp] : grp.map(s => [s])));
}

function InputHops({ g, w, l, onLine, label }: { g: Graph; w: Workpaper; l: Line; onLine: (k: string, src?: string) => void; label: (l: Line) => string }) {
  const [open, setOpen] = useState<string | null>(null);
  const { me } = useSession();
  const { bulkVerify } = useBulk();
  const one = (k: string) => {
    const x = g.line(k);
    const own = w.own!(k);
    return (
      <Hop key={k} status={own} affected={w.affectedBy!(k)} broken={own === 'Blocked'} onClick={() => onLine(k)} label={`Open ${k}`}>
        <p className="hop-main"><span>{x ? (isLot(k) ? lotLabel(x) : label(x)) : `${k} (not on this return)`}</span><span className="num">{x ? fmt(x.value, isLot(k)) : ''}</span></p>
      </Hop>
    );
  };
  if (l.inputs.length <= 12) return <>{l.inputs.map(one)}</>;
  // Large sets: one row per broker; only exceptions listed.
  const groups: Record<string, string[]> = {};
  for (const k of l.inputs) {
    const ev = g.line(k)?.sources.map(s => g.evs[s]).find(Boolean);
    (groups[ev?.document_id ?? 'other'] ??= []).push(k);
  }
  return (
    <>
      {Object.entries(groups).map(([doc, ks]) => {
        const exceptions = ks.filter(k => w.byLine![k]?.length);
        const sum = ks.reduce((a, k) => a + (g.line(k)?.value ?? 0), 0);
        const clean = ks.filter(k => w.own!(k) === 'Unverified');
        const nVer = ks.filter(k => w.verified!.has(k)).length;
        const st: Status = exceptions.some(k => w.own!(k) === 'Blocked') ? 'Blocked' : exceptions.length ? 'Question open' : nVer === ks.length ? 'Verified' : 'Unverified';
        return (
          <li key={doc} className="hop-group">
            <ol className="hops">
              <Hop status={st} onClick={() => setOpen(open === doc ? null : doc)} label={`Show sales from ${doc}`}>
                <p className="hop-main"><span>{g.docs[doc]?.issuer ?? doc}, {ks.length} {ks.length === 1 ? 'sale' : 'sales'}{exceptions.length ? `, ${exceptions.length} with open items` : ''}</span><span className="num">{fmt(sum, true)}</span></p>
                <p className="hop-meta">{open === doc ? 'Hide the sales' : ks.length === 1 ? 'Show the sale' : `Show all ${ks.length} sales`}{nVer ? `. ${nVer} verified` : ''}</p>
              </Hop>
              {can(me, 'verified') && clean.length > 1 && (
                <li className="hop bulk"><span className="hop-seg" aria-hidden /><button className="btn quiet" onClick={() => bulkVerify(clean, `${clean.length} sales from ${g.docs[doc]?.issuer ?? doc}`)}>Verify the {clean.length} sales with no open items against {doc}</button></li>
              )}
            </ol>
            <ol className="hops nested">{(open === doc ? ks : exceptions).map(one)}</ol>
          </li>
        );
      })}
    </>
  );
}

function describe(e: { type: string; actor: string; at: string; payload: any }, g: Graph) {
  const who = [...g.P.firm.staff, ...g.P.firm.client_users].find((p: any) => p.id === e.actor)?.name ?? e.actor;
  const when = new Date(e.at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  const what: Record<string, string> = {
    verified: `verified, ${(METHODS[e.payload?.method] ?? '').toLowerCase()}${e.payload?.note ? `: ${e.payload.note}` : ''}`,
    verification_withdrawn: 'withdrew the verification', note: e.payload?.text, evidence_attached: `attached ${e.payload?.name}`, client_question: `asked the client: ${e.payload?.text}`, client_answer: `answered: ${e.payload?.text}`, finding_resolved: `resolved ${e.payload?.id}: ${e.payload?.text}`,
    finding_reopened: `reopened ${e.payload?.id}`, sensitive_viewed: 'viewed unmasked data',
  };
  return <>{who}, {when}: {what[e.type] ?? e.type.replace(/_/g, ' ')}</>;
}
