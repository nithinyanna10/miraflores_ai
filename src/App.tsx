import { useEffect, useMemo, useState } from 'react';
import { breakHop, fmt, areaOf, severityStatus, shown, type Finding, type Graph } from '../shared/packet.ts';
import { useWorkpaper, type Workpaper } from './data.ts';
import { Outline, outlineRows } from './Outline.tsx';
import { Thread } from './Thread.tsx';
import { DocPane } from './DocPane.tsx';
import { Palette } from './Palette.tsx';
import { StatusMark } from './StatusMark.tsx';

type Sel = { line?: string; src?: string };
const readHash = (): Sel => Object.fromEntries(new URLSearchParams(location.hash.slice(1)));
const writeHash = (s: Sel) => {
  const q = new URLSearchParams(Object.entries(s).filter(([, v]) => v) as [string, string][]).toString();
  if (q !== location.hash.slice(1)) history.pushState(null, '', q ? `#${q}` : location.pathname);
};

export function App() {
  const w = useWorkpaper();
  const [sel, setSel] = useState<Sel>(readHash);
  const [cursor, setCursor] = useState(0);
  const [palette, setPalette] = useState(false);
  const [user, setUser] = useState(() => { try { return localStorage.getItem('user') ?? 'st-02'; } catch { return 'st-02'; } });
  useEffect(() => { const f = () => setSel(readHash()); addEventListener('popstate', f); return () => removeEventListener('popstate', f); }, []);
  useEffect(() => { try { localStorage.setItem('user', user); } catch {} }, [user]);

  const g = w.g;
  const rows = useMemo(() => (g && w.byLine ? outlineRows(g, w) : []), [g, w.byLine]);

  const go = (s: Sel) => { setSel(s); writeHash(s); };
  // A shared link may name a line without a source: pick the default once data is in.
  useEffect(() => { if (g && w.byLine && sel.line && !sel.src) openLine(sel.line); }, [g, w.byLine, sel.line]);
  const openLine = (k: string, src?: string) => {
    if (!g) return;
    const l = g.line(k);
    // Default source: where the thread breaks, else the first extracted field.
    const brk = (w.byLine![k] ?? []).map(f => breakHop(l!, f, g)).find(h => h !== 'rule' && h !== 'line');
    go({ line: k, src: src ?? brk ?? l?.sources.find(s => g.evs[s]) ?? l?.sources[0] });
    const i = rows.findIndex(r => r.key === k); if (i >= 0) setCursor(i);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setPalette(p => !p); return; }
      const t = e.target as HTMLElement;
      if (palette || t.closest('input, textarea, select')) return;
      if (e.key === 'j') setCursor(c => Math.min(rows.length - 1, c + 1));
      else if (e.key === 'k') setCursor(c => Math.max(0, c - 1));
      else if (e.key === 'Enter' && t === document.body && rows[cursor]) openLine(rows[cursor].key);
      else if (e.key === 'Escape') go({});
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, [rows, cursor, palette, g]);

  if (!g || !w.byLine) return <div className="loading">Loading the 2025 return…</div>;
  const people = [...g.P.firm.staff, ...g.P.firm.client_users];
  const me = people.find((p: any) => p.id === user);

  return (
    <div className="app">
      <header className="topbar">
        <button className="client" onClick={() => go({})} title="Back to the return">Okafor-Lindqvist 2025</button>
        <span className="version" title={g.P.return_versions.at(-1).trigger}>Return v3, computed Jun 23, 2026</span>
        <label className="role">Working as
          <select value={user} onChange={e => setUser(e.target.value)}>
            {people.map((p: any) => <option key={p.id} value={p.id}>{p.name}, {p.role.replace(/_/g, ' ')}</option>)}
          </select>
        </label>
        <button className="blocking" onClick={() => go({})}><StatusMark status="Blocked" /> {w.blocking!.length} blocking filing</button>
        <span className={`live${w.live ? ' on' : ''}`} title={w.live ? 'Receiving changes from colleagues as they happen' : 'Not connected; changes from others will appear on reload'}>{w.live ? 'Live' : 'Offline'}</span>
        <button className="search" onClick={() => setPalette(true)}>Search lines, documents, refs <kbd>⌘K</kbd></button>
      </header>
      <main className="panes">
        <Outline g={g} w={w} rows={rows} selected={sel.line} cursor={cursor} onSelect={k => openLine(k)} />
        <section className="middle" aria-live="polite">
          {sel.line && g.line(sel.line)
            ? <Thread g={g} w={w} lineKey={sel.line} src={sel.src} onLine={openLine} onSrc={src => go({ ...sel, src })} />
            : <Home g={g} w={w} me={me} onFinding={f => openFinding(g, w, f, openLine, src => go({ src }))} />}
        </section>
        <DocPane g={g} w={w} refStr={sel.src} onLine={openLine} hint={sel.line && !g.line(sel.line)?.sources.length ? 'This line is built only from other lines. Open an input line in the proof thread to follow it to a document.' : undefined} />
      </main>
      {palette && <Palette g={g} onClose={() => setPalette(false)} onPick={(kind, ref) => {
        setPalette(false);
        if (kind === 'line') openLine(ref);
        else if (kind === 'ev') { const k = Object.values(g.lines.v3).find(l => l.sources.includes(ref))?.key; k ? openLine(k, ref) : go({ src: ref }); }
        else go({ ...sel, src: ref });
      }} />}
    </div>
  );
}

function openFinding(g: Graph, w: Workpaper, f: Finding, openLine: (k: string, src?: string) => void, showSrc: (r: string) => void) {
  const k = f.lines.find(x => g.line(x));
  if (k) { const h = breakHop(g.line(k)!, f, g); openLine(k, h === 'rule' || h === 'line' ? undefined : h); }
  else if (f.refs[0]) showSrc(f.refs.find(r => g.resolve(r).kind !== 'unknown') ?? f.refs[0]);
}

function Home({ g, w, me, onFinding }: { g: Graph; w: Workpaper; me: any; onFinding: (f: Finding) => void }) {
  const L = g.lines.v3;
  const fed: [string, string][] = [['Adjusted gross income', 'F1040.11'], ['Taxable income', 'F1040.15'], ['Total tax', 'F1040.24'], ['Total payments', 'F1040.33'], ['Amount owed', 'F1040.37'], ['Estimated tax penalty', 'F1040.38']];
  const ca: [string, string][] = [['California AGI', 'F540NR.32'], ['Taxable income', 'F540NR.35'], ['Total tax', 'F540NR.64'], ['Total payments', 'F540NR.78'], ['Overpaid', 'F540NR.97']];
  const questions = w.findings!.filter(f => f.severity === 'judgment' || (f.severity === 'warning' && f.check !== 'prior_year_variance'));
  const swings = w.findings!.filter(f => f.check === 'prior_year_variance');
  const item = (f: Finding) => {
    const k = f.lines.find(x => L[x]);
    return (
      <li key={f.id}><button onClick={() => onFinding(f)}>
        <StatusMark status={severityStatus(f.severity)!} />
        <span className="item-title">{f.title}</span>
        <span className="item-where">{k ? areaOf(k) : 'Whole return'}</span>
        <span className="item-effect num">{f.tax_effect ? `${fmt(f.tax_effect.federal)} / ${fmt(f.tax_effect.california)}` : ''}</span>
      </button></li>
    );
  };
  return (
    <article className="home">
      <p className="muted">{me ? `Signed in as ${me.name}.` : ''} Select any number in the return to see what it is built from. Press ⌘K to search, j and k to move, Enter to open.</p>
      <section className="ledger-pair">
        {[['Federal Form 1040', fed], ['California Form 540NR', ca]].map(([title, rows]: any) => (
          <table key={title} className="ledger">
            <caption>{title}</caption>
            <tbody>{rows.map(([label, k]: [string, string]) => <tr key={k}><th scope="row"><button onClick={() => onFinding({ lines: [k], refs: [] } as any)}>{label}</button></th><td className="num">{fmt(L[k].value)}</td><td>{(([s, i]) => <StatusMark status={s} inherited={i} />)(shown(w.own!(k), w.inherited!(k)))}</td></tr>)}</tbody>
          </table>
        ))}
      </section>
      <section className="items">
        <h2><StatusMark status="Blocked" size={14} /> {w.blocking!.length} items blocking filing</h2>
        <p className="muted">Each one breaks the proof thread of the line it affects. Tax effect is first order (change x v3 rate), shown federal / California.</p>
        <ul className="item-list">{w.blocking!.map(item)}</ul>
      </section>
      <section className="items">
        <h2><StatusMark status="Question open" size={14} /> {questions.length} questions and judgment calls</h2>
        <ul className="item-list">{questions.map(item)}</ul>
      </section>
      <details className="items">
        <summary><h2>{swings.length} changes from 2024 over the firm threshold (10% and 1,000) need an explanation</h2></summary>
        <ul className="item-list">{swings.map(item)}</ul>
      </details>
    </article>
  );
}
