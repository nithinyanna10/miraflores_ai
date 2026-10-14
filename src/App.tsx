import { useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { breakHop, fmt, areaOf, isLot, severityStatus, labelMaker, type Finding, type Graph } from '../shared/packet.ts';
import { useWorkpaper, type Workpaper } from './data.ts';
import { Outline, buildAreas, visibleRows, lotLabel } from './Outline.tsx';
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
const toggled = (s: Set<string>, x: string) => { const n = new Set(s); n.has(x) ? n.delete(x) : n.add(x); return n; };

export function App() {
  const w = useWorkpaper();
  const [sel, setSel] = useState<Sel>(readHash);
  const [cursorKey, setCursorKey] = useState<string>();
  const [openAreas, setOpenAreas] = useState<Set<string>>(new Set());
  const [showWs, setShowWs] = useState<Set<string>>(new Set());
  const [palette, setPalette] = useState(false);
  const [user, setUser] = useState(() => { try { return localStorage.getItem('user') ?? 'st-02'; } catch { return 'st-02'; } });
  useEffect(() => { const f = () => setSel(readHash()); addEventListener('popstate', f); return () => removeEventListener('popstate', f); }, []);
  useEffect(() => { try { localStorage.setItem('user', user); } catch {} }, [user]);

  const g = w.g;
  const areas = useMemo(() => (g && w.byLine ? buildAreas(g, w) : []), [g, w.byLine, w.verified]);
  const rows = visibleRows(areas, openAreas, showWs);

  const go = (s: Sel) => { setSel(s); writeHash(s); };
  const openLine = (k: string, src?: string) => {
    if (!g) return;
    const l = g.line(k);
    const brk = (w.byLine![k] ?? []).map(f => breakHop(l!, f, g)).find(h => h !== 'rule' && h !== 'line');
    go({ line: k, src: src ?? brk ?? l?.sources.find(s => g.evs[s]) ?? l?.sources[0] });
    setCursorKey(k);
  };
  // Keep the selected line's area open, and its worksheet lines if it is one.
  useEffect(() => {
    const a = areas.find(a => [...a.rows, ...a.worksheet].some(r => r.key === sel.line));
    if (!a) return;
    setOpenAreas(s => (s.has(a.area) ? s : new Set(s).add(a.area)));
    if (a.worksheet.some(r => r.key === sel.line)) setShowWs(s => (s.has(a.area) ? s : new Set(s).add(a.area)));
  }, [sel.line, areas]);
  // A shared link may name a line without a source: pick the default once data is in.
  useEffect(() => { if (g && w.byLine && sel.line && !sel.src) openLine(sel.line); }, [g, w.byLine, sel.line]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setPalette(p => !p); return; }
      const t = e.target as HTMLElement;
      if (palette || t.closest('input, textarea, select')) return;
      const i = rows.findIndex(r => r.key === cursorKey);
      if (e.key === 'j') setCursorKey(rows[Math.min(rows.length - 1, i + 1)]?.key);
      else if (e.key === 'k') setCursorKey(rows[Math.max(0, i - 1)]?.key);
      else if (e.key === 'Enter' && t === document.body && cursorKey) openLine(cursorKey);
      else if (e.key === 'Escape') go({});
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, [rows, cursorKey, palette, g]);

  if (!g || !w.byLine) return <div className="loading">Loading the 2025 return…</div>;
  const people = [...g.P.firm.staff, ...g.P.firm.client_users];

  return (
    <div className="app">
      <header className="topbar">
        <button className="client" onClick={() => go({})} title="Back to the return">Okafor-Lindqvist 2025</button>
        <span className="version" title={g.P.return_versions.at(-1).trigger}>Return v3</span>
        <button className="blocking" onClick={() => go({})}><StatusMark status="Blocked" /> {w.blocking!.length} blocking filing</button>
        <button className="search" onClick={() => setPalette(true)}>Search <kbd>⌘K</kbd></button>
        <label className="role"><span className="sr">Working as</span>
          <select value={user} onChange={e => setUser(e.target.value)} aria-label="Working as">
            {people.map((p: any) => <option key={p.id} value={p.id}>{p.name}, {p.role.replace(/_/g, ' ')}</option>)}
          </select>
        </label>
        <span className={`live${w.live ? ' on' : ''}`} title={w.live ? 'Changes from colleagues appear as they happen' : 'Not connected; changes from others appear on reload'}>{w.live ? 'Live' : 'Offline'}</span>
      </header>
      <main className={`panes${sel.line || sel.src ? '' : ' is-home'}`}>
        <Outline g={g} w={w} areas={areas} open={openAreas} showWs={showWs}
          toggle={a => setOpenAreas(s => toggled(s, a))} toggleWs={a => setShowWs(s => toggled(s, a))}
          selected={sel.line} cursorKey={cursorKey} onSelect={k => openLine(k)} />
        <section className="middle" aria-live="polite">
          {sel.line && g.line(sel.line)
            ? <Thread g={g} w={w} lineKey={sel.line} src={sel.src} onLine={openLine} onSrc={src => go({ ...sel, src })} />
            : <Home g={g} w={w} onFinding={f => openFinding(g, f, openLine, src => go({ src }))} onLine={k => openLine(k)} />}
        </section>
        <DocPane g={g} w={w} refStr={sel.src} onLine={openLine} onSrc={src => go({ ...sel, src })}
          hint={sel.line && !g.line(sel.line)?.sources.length ? 'This line is built only from other lines. Open one of them in the proof thread to follow it to a document.' : undefined} />
      </main>
      <Connector deps={[sel.line, sel.src]} />
      {palette && <Palette g={g} onClose={() => setPalette(false)} onPick={(kind, ref) => {
        setPalette(false);
        if (kind === 'line') openLine(ref);
        else if (kind === 'ev') { const k = Object.values(g.lines.v3).find(l => l.sources.includes(ref))?.key; k ? openLine(k, ref) : go({ src: ref }); }
        else go({ ...sel, src: ref });
      }} />}
    </div>
  );
}

// The thread's last hop: a connector from the selected step to the marked text on the page.
function Connector({ deps }: { deps: unknown[] }) {
  const [d, setD] = useState<{ path: string; x: number; y: number; broken: boolean; off: boolean } | null>(null);
  useLayoutEffect(() => {
    let raf = 0;
    const update = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const hop = document.querySelector('.hop.is-active > .hop-body');
        const target = document.querySelector('.docpane mark, .docpane .record');
        const pane = document.querySelector('.docpane'), mid = document.querySelector('.middle');
        if (!hop || !target || !pane || !mid) return setD(null);
        const a = hop.getBoundingClientRect(), b = target.getBoundingClientRect(), pr = pane.getBoundingClientRect(), mr = mid.getBoundingClientRect();
        if (a.bottom < mr.top + 8 || a.top > mr.bottom - 8 || pr.left < mr.right - 4) return setD(null); // stacked layout: no connector
        const x1 = a.right, y1 = a.top + 18;
        const raw = b.top + Math.min(b.height / 2, 12);
        // End in the page margin beside the marked line, not across the printed text.
        const sheet = target.closest('.sheet')?.getBoundingClientRect() ?? b;
        const y2 = Math.min(Math.max(raw, pr.top + 12), pr.bottom - 12), x2 = sheet.left + 14;
        const cx = (x1 + x2) / 2;
        setD({ path: `M${x1} ${y1} C ${cx} ${y1}, ${cx} ${y2}, ${x2} ${y2}`, x: x2, y: y2, broken: !!hop.closest('.is-broken'), off: raw !== y2 });
      });
    };
    update();
    const t = setTimeout(update, 120);
    addEventListener('scroll', update, true);
    addEventListener('resize', update);
    return () => { clearTimeout(t); cancelAnimationFrame(raf); removeEventListener('scroll', update, true); removeEventListener('resize', update); };
  }, deps);
  if (!d) return null;
  return (
    <svg className={`connector${d.broken ? ' is-broken' : ''}${d.off ? ' is-off' : ''}`} aria-hidden>
      <path key={String(deps)} d={d.path} pathLength={1} />
      <circle cx={d.x} cy={d.y} r={3.5} />
    </svg>
  );
}

function openFinding(g: Graph, f: Finding, openLine: (k: string, src?: string) => void, showSrc: (r: string) => void) {
  const k = f.lines.find(x => g.line(x));
  if (k) { const h = breakHop(g.line(k)!, f, g); openLine(k, h === 'rule' || h === 'line' ? undefined : h); }
  else if (f.refs[0]) showSrc(f.refs.find(r => g.resolve(r).kind !== 'unknown') ?? f.refs[0]);
}

const effectSize = (f: Finding) => Math.abs(f.tax_effect?.federal ?? 0) + Math.abs(f.tax_effect?.california ?? 0);

function Home({ g, w, onFinding, onLine }: { g: Graph; w: Workpaper; onFinding: (f: Finding) => void; onLine: (k: string) => void }) {
  const L = g.lines.v3, p = g.P.prior_years.return_2024.lines;
  const label = labelMaker(Object.values(L));
  const fed: [string, string, number | null][] = [
    ['Adjusted gross income', 'F1040.11', p['F1040.11']], ['Taxable income', 'F1040.15', p['F1040.15']], ['Total tax', 'F1040.24', p['F1040.24']],
    ['Total payments', 'F1040.33', p['F1040.33']], ['Amount owed (refund)', 'F1040.37', -p['F1040.34']], ['Estimated tax penalty', 'F1040.38', null],
  ];
  const ca: [string, string, number | null][] = [
    ['California AGI', 'F540NR.32', p['CA540.17']], ['Taxable income', 'F540NR.35', p['CA540.19']], ['Total tax', 'F540NR.64', p['CA540.64']],
    ['Total payments', 'F540NR.78', p['CA540.71'] + p['CA540.72']], ['Refund (amount owed)', 'F540NR.97', -p['CA540.111']],
  ];
  const [allBlock, setAllBlock] = useState(false);
  const [allQ, setAllQ] = useState(false);
  const blockers = [...w.blocking!].sort((a, b) => effectSize(b) - effectSize(a));
  const questions = w.findings!.filter(f => f.severity === 'judgment' || (f.severity === 'warning' && f.check !== 'prior_year_variance')).sort((a, b) => effectSize(b) - effectSize(a));
  const swings = w.findings!.filter(f => f.check === 'prior_year_variance');
  const item = (f: Finding) => {
    const k = f.lines.find(x => L[x]);
    return (
      <li key={f.id}><button onClick={() => onFinding(f)}>
        <StatusMark status={severityStatus(f.severity)!} />
        <span className="item-title">{f.title.replace(/^(F|Sch)[\w-]*\.[\w.+]+ /, '')}<span className="item-where">{k ? `${areaOf(k)}, ${isLot(k) ? lotLabel(L[k]) : label(L[k])}` : 'Whole return'}</span></span>
        <span className="item-effect num">{f.tax_effect ? `${fmt(f.tax_effect.federal)} / ${fmt(f.tax_effect.california)}` : ''}</span>
      </button></li>
    );
  };
  const ledger = (title: string, prior: string, rows: [string, string, number | null][]) => (
    <table className="ledger">
      <caption>{title}</caption>
      <thead><tr><th scope="col" /><th scope="col" className="num">{prior}</th><th scope="col" className="num">2025</th><th scope="col" className="num">Change</th><th scope="col"><span className="sr">Status</span></th></tr></thead>
      <tbody>{rows.map(([lab, k, py]) => {
        const v = L[k].value, aff = w.affectedBy!(k);
        const own = (w.byLine![k] ?? []).some(f => f.severity === 'error') ? 'Blocked' : 'Unverified';
        return (
          <tr key={k}>
            <th scope="row"><button onClick={() => onLine(k)}>{lab}</button></th>
            <td className="num muted">{py == null ? '' : fmt(py)}</td>
            <td className="num">{fmt(v)}</td>
            <td className="num muted">{py == null ? '' : (v - py > 0 ? '+' : v - py < 0 ? '−' : '') + fmt(Math.abs(v - py))}</td>
            <td className="ledger-status">{own !== 'Unverified' ? <StatusMark status={own} /> : aff ? <span className="affected-text">affected by {aff}</span> : null}</td>
          </tr>
        );
      })}</tbody>
    </table>
  );
  return (
    <article className="home">
      <section className="ledger-pair">
        {ledger('Federal', '2024', fed)}
        {ledger('California', '2024 (Form 540)', ca)}
      </section>
      <section className="items">
        <h2><StatusMark status="Blocked" size={14} /> {blockers.length} items block filing</h2>
        <p className="muted">Largest tax effect first. Effect is federal / California, change times the v3 rate.</p>
        <ul className="item-list">{(allBlock ? blockers : blockers.slice(0, 5)).map(item)}</ul>
        {blockers.length > 5 && <button className="more" onClick={() => setAllBlock(!allBlock)}>{allBlock ? 'Show the top 5' : `Show all ${blockers.length}`}</button>}
      </section>
      <section className="items">
        <h2><StatusMark status="Question open" size={14} /> {questions.length} questions and judgment calls</h2>
        <ul className="item-list">{(allQ ? questions : questions.slice(0, 5)).map(item)}</ul>
        {questions.length > 5 && <button className="more" onClick={() => setAllQ(!allQ)}>{allQ ? 'Show the top 5' : `Show all ${questions.length}`}</button>}
      </section>
      <details className="items">
        <summary>{swings.length} changes from 2024 over the firm threshold need an explanation</summary>
        <ul className="item-list">{swings.map(item)}</ul>
      </details>
    </article>
  );
}
