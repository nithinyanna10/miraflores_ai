import { useEffect, useRef, useState } from 'react';
import { fmt, isLot, labelMaker, type Graph, type RefNode } from '../shared/packet.ts';
import { StatusMark } from './StatusMark.tsx';
import { reveal, type Workpaper } from './data.ts';
import { useSession } from './Actions.tsx';
import { isActive } from '../shared/policy.ts';

// Right pane: the source. A facsimile (from DocumentSource) for fields, pages and documents;
// otherwise the record itself (questionnaire answer, message, prior-year value).
export function DocPane({ g, w, refStr, onLine, onSrc, hint }: { g: Graph; w: Workpaper; refStr?: string; onLine: (k: string, src?: string) => void; onSrc: (r: string) => void; hint?: string }) {
  const box = useRef<HTMLElement>(null);
  const { me, people } = useSession();
  const [plain, setPlain] = useState<Record<string, string>>({});
  const [revealErr, setRevealErr] = useState<string | null>(null);
  useEffect(() => { setPlain({}); setRevealErr(null); }, [refStr, me?.id]);
  const n: RefNode | null = refStr ? g.resolve(refStr) : null;
  const docId = n?.docId;
  const hl = n?.ev ? w.source!.highlight(n.ev) : null;
  useEffect(() => {
    const el = box.current?.querySelector('mark') ?? box.current?.querySelector(`[data-page="${n?.page}"]`);
    if (el) el.scrollIntoView({ block: 'center' }); else box.current?.scrollTo({ top: 0 });
  }, [refStr]);

  if (!n) return <aside className="docpane" ref={box} aria-label="Documents">{hint ? <p className="muted pane-hint">{hint}</p> : <DocIndex g={g} w={w} onDoc={onSrc} />}</aside>;

  if (!docId) return (
    <aside className="docpane" ref={box} aria-label="Source record">
      <header className="doc-head"><p className="doc-kicker">{n.kind === 'unknown' ? 'Unresolved reference' : 'Record'}</p><h2>{n.title}</h2></header>
      <div className="sheet record">
        {n.text && <p className="memo">{n.text}</p>}
        {n.value !== undefined && !n.text && (typeof n.value === 'object' ? <Record v={n.value} /> : <p className="record-value">{fmt(n.value)}</p>)}
      </div>
    </aside>
  );

  const d = g.docs[docId];
  const pages = w.source!.pages(docId);
  const fieldLands = n.ev ? Object.values(g.lines.v3).filter(l => l.sources.includes(n.ev!.id)).map(l => l.key) : [];
  const docLands = g.landings.v3[docId] ?? [];
  const cites = w.findings!.filter(f => f.refs.some(r => r === docId || g.evs[r]?.document_id === docId || r.startsWith(`doc:${docId}#`)));
  const reason = landingReason(g, w, docId);

  return (
    <aside className="docpane" ref={box} aria-label={`Document ${docId}`}>
      <header className="doc-head">
        <p className="doc-kicker">{docId}, received {d.received_at.slice(0, 10)}{d.marked_corrected ? ', marked CORRECTED by the issuer' : ''}{d.extraction.status !== 'extracted' ? `. ${d.extraction.reason}` : ''}</p>
        <h2>{d.title}</h2>
        {n.ev && <p className="doc-field">{hl?.span && !hl.span.approx ? 'Marked' : 'Looking for'}: <strong>{n.ev.label}</strong> <span className="num">{fmt(n.ev.value)}</span>{hl && (!hl.span || hl.span.approx) && <span className="warn">Not printed on the page.{hl.span ? ' Its entry is underlined.' : ''}</span>}</p>}
      </header>
      <div className="pages">
        {pages.map(p => {
          const mark = hl && hl.page === p.page && hl.span;
          const pageRef = `doc:${docId}#page${p.page}`;
          const text = plain[pageRef] ?? p.text; // masking keeps length, so marks still line up
          const masked = p.text.includes('•');
          const mayReveal = me && (me.role === 'client' || (me.sensitive_data_clearance && isActive(me)));
          return (
            <section key={p.page} className="sheet facsimile" data-page={p.page} aria-label={`Page ${p.page}`}>
              {pages.length > 1 && <p className="page-no">Page {p.page} of {pages.length}</p>}
              {masked && !plain[pageRef] && (
                <p className="mask-bar">
                  {mayReveal
                    ? <button className="link" onClick={async () => { const r = await reveal(me!.id, pageRef); r.error ? setRevealErr(r.error) : setPlain({ ...plain, [pageRef]: r.value }); }}>Show the masked numbers on this page. Your view is logged.</button>
                    : <span>SSNs and account numbers are masked: {me?.name ?? 'this user'} does not have sensitive-data clearance.</span>}
                  {revealErr && <span className="warn"> {revealErr}</span>}
                </p>
              )}
              <p className="printed">{mark ? <>{text.slice(0, mark.start)}<mark className={mark.approx ? 'approx' : ''}>{text.slice(mark.start, mark.end)}</mark>{text.slice(mark.end)}</> : text}</p>
            </section>
          );
        })}
      </div>
      <footer className="also">
        {cites.length > 0 && <section><h3>Open items citing this document</h3><ul className="link-list">{cites.map(f => {
          const k = f.lines.find(x => g.line(x));
          return <li key={f.id}><button onClick={() => k && onLine(k)} disabled={!k}><StatusMark status={f.severity === 'error' ? 'Blocked' : 'Question open'} /> <span>{f.title}</span></button></li>;
        })}</ul></section>}
        {n.ev && <section><h3>This field is used on</h3>{fieldLands.length ? <Lands g={g} w={w} keys={fieldLands} onLine={k => onLine(k, n.ev!.id)} /> : <p className="muted">No line.</p>}</section>}
        {(() => {
          const views = w.events.filter(e => (e.type === 'sensitive_viewed' || e.type === 'sensitive_view_refused') && e.refs.some(r => r.startsWith(`doc:${docId}#`) || g.evs[r]?.document_id === docId));
          return views.length > 0 && <section><h3>Unmasked views of this document</h3><ul className="view-log">{views.map(e => (
            <li key={e.seq} className={e.type === 'sensitive_view_refused' ? 'warn' : ''}>{people.find(p => p.id === e.actor)?.name ?? e.actor}, {new Date(e.at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}{e.type === 'sensitive_view_refused' ? ': refused, no clearance' : ''}</li>
          ))}</ul></section>;
        })()}
        <section><h3>This document lands on</h3>{docLands.length ? <Lands g={g} w={w} keys={docLands} onLine={k => onLine(k)} /> : <p className={reason.explained ? 'muted' : 'warn'}>{reason.text}</p>}</section>
      </footer>
    </aside>
  );
}

export function landingReason(g: Graph, w: Workpaper, docId: string): { text: string; explained: boolean } {
  const f = w.audit?.findings.find(x => x.check === 'document_landings' && x.refs.length === 1 && x.refs[0] === docId);
  const m = f?.title.match(/lands on no v3 line \((.*)\)$/);
  return m ? { text: `No landing: ${m[1]}`, explained: true } : { text: 'No landing, and no reason recorded', explained: false };
}

function Lands({ g, w, keys, onLine }: { g: Graph; w: Workpaper; keys: string[]; onLine: (k: string) => void }) {
  const [all, setAll] = useState(false);
  const label = labelMaker(Object.values(g.lines.v3));
  const shown = all ? keys : keys.slice(0, 5);
  return (
    <ul className="link-list">
      {shown.map(k => { const own = w.own!(k); return <li key={k}><button onClick={() => onLine(k)}>{own !== 'Unverified' ? <StatusMark status={own} /> : <span />} <span>{label(g.line(k)!)}</span> <span className="num">{fmt(g.line(k)!.value, isLot(k))}</span></button></li>; })}
      {keys.length > 5 && <li><button className="more" onClick={() => setAll(!all)}>{all ? 'Show fewer' : `Show all ${keys.length}`}</button></li>}
    </ul>
  );
}

// Home right pane: every document, where it landed, and the ones that landed nowhere.
function DocIndex({ g, w, onDoc }: { g: Graph; w: Workpaper; onDoc: (id: string) => void }) {
  const docs = Object.values(g.docs) as any[];
  const none = docs.filter(d => !(g.landings.v3[d.id]?.length));
  return (
    <section className="docindex">
      <h2>Documents</h2>
      <p className="muted">{docs.length} received. {none.length} land on no line; {none.filter(d => !landingReason(g, w, d.id).explained).length} of those have no reason recorded.</p>
      <ul>
        {docs.map(d => {
          const n = g.landings.v3[d.id]?.length ?? 0;
          const r = n ? null : landingReason(g, w, d.id);
          return (
            <li key={d.id}><button onClick={() => onDoc(d.id)}>
              <span className="ref">{d.id}</span>
              <span className="docindex-title">{d.title}</span>
              {n ? <span className="num muted">{n} {n === 1 ? 'line' : 'lines'}</span> : <span className={r!.explained ? 'muted' : 'warn'} title={r!.text}>{r!.explained ? 'No landing, explained' : 'No landing'}</span>}
            </button></li>
          );
        })}
      </ul>
    </section>
  );
}

function Record({ v }: { v: any }) {
  if (Array.isArray(v)) return <ol className="record-list">{v.map((x, i) => <li key={i}><Record v={x} /></li>)}</ol>;
  if (v && typeof v === 'object') return <dl className="record-dl">{Object.entries(v).map(([k, x]) => <div key={k}><dt>{k.replace(/_/g, ' ')}</dt><dd>{typeof x === 'object' && x ? <Record v={x} /> : <span className="num">{fmt(x)}</span>}</dd></div>)}</dl>;
  return <span className="num">{fmt(v)}</span>;
}
