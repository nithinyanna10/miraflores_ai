import { useEffect, useRef } from 'react';
import { fmt, type Graph, type RefNode } from '../shared/packet.ts';
import { StatusMark } from './StatusMark.tsx';
import type { Workpaper } from './data.ts';

// Right pane: the source. A document facsimile (from DocumentSource) when the ref is a field,
// page or document; otherwise the record itself (questionnaire answer, message, prior-year value...).
export function DocPane({ g, w, refStr, onLine, hint }: { g: Graph; w: Workpaper; refStr?: string; onLine: (k: string, src?: string) => void; hint?: string }) {
  const box = useRef<HTMLDivElement>(null);
  const n: RefNode | null = refStr ? g.resolve(refStr) : null;
  const docId = n?.docId;
  const hl = n?.ev ? w.source!.highlight(n.ev) : null;
  useEffect(() => {
    const el = box.current?.querySelector('mark') ?? box.current?.querySelector(`[data-page="${n?.page}"]`);
    el?.scrollIntoView({ block: 'center' });
    if (!el) box.current?.scrollTo({ top: 0 });
  }, [refStr]);

  if (!n) return <aside className="docpane empty" ref={box}><p className="muted">{hint ?? 'Select a source in the proof thread to see it here, with the field marked on the page.'}</p></aside>;

  if (!docId) return (
    <aside className="docpane" ref={box} aria-label="Source record">
      <header className="doc-head"><p className="hop-kind">{n.kind === 'unknown' ? 'Unresolved reference' : 'Record'} <span className="ref">{n.ref}</span></p><h2>{n.title}</h2></header>
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
  const noLandingReason = w.audit?.findings.find(f => f.check === 'document_landings' && f.refs.length === 1 && f.refs[0] === docId)?.title.replace(/^.*?lands on no v3 line/, 'Lands on no line');

  return (
    <aside className="docpane" ref={box} aria-label={`Document ${docId}`}>
      <header className="doc-head">
        <p className="hop-kind"><span className="ref">{docId}</span> {d.document_type}, {d.pages.length} {d.pages.length === 1 ? 'page' : 'pages'}{d.marked_corrected ? ', marked CORRECTED by issuer' : ''}</p>
        <h2>{d.title}</h2>
        <p className="muted">Received {d.received_at.slice(0, 10)} from {d.uploaded_by}. Extraction {d.extraction.status}{d.extraction.reason ? `: ${d.extraction.reason}` : ''}</p>
        {n.ev && <p className="doc-field">Marked: <strong>{n.ev.label}</strong> <span className="num">{fmt(n.ev.value)}</span>{hl && (!hl.span || hl.span.approx) && <span className="warn"> This value is not printed on the page.{hl.span ? ' The entry it belongs to is underlined.' : ''}</span>}</p>}
      </header>
      <div className="pages">
        {pages.map(p => {
          const mark = hl && hl.page === p.page && hl.span;
          return (
            <section key={p.page} className="sheet facsimile" data-page={p.page} aria-label={`Page ${p.page}`}>
              <p className="page-no">Page {p.page} of {pages.length}</p>
              <p className="printed">
                {mark ? <>{p.text.slice(0, mark.start)}<mark className={mark.approx ? 'approx' : ''}>{p.text.slice(mark.start, mark.end)}</mark>{p.text.slice(mark.end)}</> : p.text}
              </p>
            </section>
          );
        })}
      </div>
      <footer className="also">
        {n.ev && <><h3>This field is used on</h3>{fieldLands.length ? <Lands g={g} w={w} keys={fieldLands} onLine={k => onLine(k, n.ev!.id)} /> : <p className="muted">No line uses this field.</p>}</>}
        {(() => {
          const cites = w.findings!.filter(f => f.refs.some(r => r === docId || g.evs[r]?.document_id === docId || r.startsWith(`doc:${docId}#`)));
          return cites.length > 0 && <><h3>Open items that cite this document</h3><ul className="link-list">{cites.map(f => {
            const k = f.lines.find(x => g.line(x));
            return <li key={f.id}><button onClick={() => k && onLine(k)} disabled={!k}><StatusMark status={f.severity === 'error' ? 'Blocked' : 'Question open'} /> <span>{f.title}</span> <span className="ref">{f.id}</span></button></li>;
          })}</ul></>;
        })()}
        <h3>This document lands on</h3>
        {docLands.length ? <Lands g={g} w={w} keys={docLands} onLine={k => onLine(k)} /> : <p className="memo">{noLandingReason ?? 'Lands on no line, and no reason has been recorded. Record one or link it to a line.'}</p>}
      </footer>
    </aside>
  );
}

function Lands({ g, w, keys, onLine }: { g: Graph; w: Workpaper; keys: string[]; onLine: (k: string) => void }) {
  const shown = keys.slice(0, 40);
  return (
    <ul className="link-list">
      {shown.map(k => <li key={k}><button onClick={() => onLine(k)}><StatusMark status={w.own!(k)} /> <span>{g.line(k)!.label}</span> <span className="num">{fmt(g.line(k)!.value, /^F8949\.[A-Z]\.(?!total)/.test(k))}</span></button></li>)}
      {keys.length > shown.length && <li className="muted">and {keys.length - shown.length} more lines</li>}
    </ul>
  );
}

function Record({ v }: { v: any }) {
  if (Array.isArray(v)) return <ol className="record-list">{v.map((x, i) => <li key={i}><Record v={x} /></li>)}</ol>;
  if (v && typeof v === 'object') return <dl className="record-dl">{Object.entries(v).map(([k, x]) => <div key={k}><dt>{k.replace(/_/g, ' ')}</dt><dd>{typeof x === 'object' && x ? <Record v={x} /> : <span className="num">{fmt(x)}</span>}</dd></div>)}</dl>;
  return <span className="num">{fmt(v)}</span>;
}
