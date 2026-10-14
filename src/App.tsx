import { useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { breakHop, fmt, areaOf, isLot, severityStatus, labelMaker, type Finding, type Graph } from '../shared/packet.ts';
import { useWorkpaper, type Workpaper } from './data.ts';
import { Outline, buildAreas, visibleRows, lotLabel } from './Outline.tsx';
import { Thread } from './Thread.tsx';
import { DocPane } from './DocPane.tsx';
import { Palette } from './Palette.tsx';
import { StatusMark } from './StatusMark.tsx';
import { Session, SignoffPanel, ExplainVariances, type Form, type Toast } from './Actions.tsx';
import { can, type Actor } from '../shared/policy.ts';
import { ClientApp } from './ClientApp.tsx';
import { ChangesDrawer, Compare, WhatIfs, readCursor, writeCursor } from './Views.tsx';

type Sel = { line?: string; src?: string; view?: string; a?: string; b?: string };
const readHash = (): Sel => Object.fromEntries(new URLSearchParams(location.hash.slice(1)));
const writeHash = (s: Sel) => {
  const q = new URLSearchParams(Object.entries(s).filter(([, v]) => v) as [string, string][]).toString();
  if (q !== location.hash.slice(1)) history.pushState(null, '', q ? `#${q}` : location.pathname);
};
const toggled = (s: Set<string>, x: string) => { const n = new Set(s); n.has(x) ? n.delete(x) : n.add(x); return n; };

// The role switcher stands in for sign-in (per the brief). Switching user reloads, so every
// fetch and the live stream are re-scoped by the server to what that user may see.
export function RoleSwitch({ people, user }: { people: Actor[]; user: string }) {
  return (
    <label className="role"><span className="sr">Working as</span>
      <select value={user} aria-label="Working as" onChange={e => { try { localStorage.setItem('user', e.target.value); } catch {} location.reload(); }}>
        {people.map(p => <option key={p.id} value={p.id}>{p.name}, {p.role.replace(/_/g, ' ')}{p.role !== 'client' && !p.sensitive_data_clearance ? ', no clearance' : ''}</option>)}
      </select>
    </label>
  );
}

export function App() {
  const [people, setPeople] = useState<Actor[] | null>(null);
  const user = (() => { try { return localStorage.getItem('user') ?? 'st-02'; } catch { return 'st-02'; } })();
  useEffect(() => { fetch('/api/people').then(r => r.json()).then(setPeople); }, []);
  if (!people) return <div className="loading">Loading…</div>;
  const me = people.find(p => p.id === user) ?? people.find(p => p.id === 'st-02')!;
  return me.role === 'client' ? <ClientApp me={me} people={people} /> : <StaffApp user={me.id} people={people} />;
}

function StaffApp({ user, people }: { user: string; people: Actor[] }) {
  const w = useWorkpaper(user);
  const [sel, setSel] = useState<Sel>(readHash);
  const [cursorKey, setCursorKey] = useState<string>();
  const [openAreas, setOpenAreas] = useState<Set<string>>(new Set());
  const [showWs, setShowWs] = useState<Set<string>>(new Set());
  const [palette, setPalette] = useState(false);
  const [form, setForm] = useState<Form>(null);
  const [toast, setToast] = useState<Toast>(null);
  const [drawer, setDrawer] = useState(false);
  const [cursor, setCursor] = useState<number | null>(null);
  useEffect(() => { if (cursor == null && w.events.length) setCursor(readCursor(user, w.events.at(-1)!.seq)); }, [w.events.length]);
  // Changes by other people after this viewer's cursor.
  const changes = cursor == null ? [] : w.events.filter(e => e.seq > cursor && e.actor !== user && e.actor !== 'audit');
  const changedLines = new Set(changes.flatMap(e => e.refs));
  useEffect(() => setForm(null), [sel.line]);
  useEffect(() => { const f = () => setSel(readHash()); addEventListener('popstate', f); return () => removeEventListener('popstate', f); }, []);

  const g = w.g;
  const areas = useMemo(() => (g && w.byLine ? buildAreas(g, w) : []), [g, w.byLine, w.verified]);
  const rows = visibleRows(areas, openAreas, showWs);

  const me = people.find(p => p.id === user);
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
      else if (e.key === 'Escape') { if (form) setForm(null); else go({}); }
      else if (e.key === 'v' && sel.line && can(me, 'verified')) { e.preventDefault(); setForm('verify'); }
      else if (e.key === 'n' && sel.line && can(me, 'note')) { e.preventDefault(); setForm('note'); }
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, [rows, cursorKey, palette, g, form, sel.line, user]);

  if (!g || !w.byLine) return <div className="loading">Loading the 2025 return…</div>;
  const blockingCount = w.blocking!.length + w.openNotes!.length + w.pendingApproval!.length;

  return (
    <Session.Provider value={{ me, people, w, toast: setToast }}>
    <div className="app">
      <header className="topbar">
        <button className="client" onClick={() => go({})} title="Back to the return">Okafor-Lindqvist 2025</button>
        <span className="version" title={g.P.return_versions.at(-1).trigger}>Return v3</span>
        <button className="blocking" onClick={() => go({})}><StatusMark status="Blocked" /> {blockingCount} blocking filing</button>
        <nav className="views" aria-label="Views">
          <button className={changes.length ? 'has-changes' : ''} onClick={() => setDrawer(!drawer)}>{changes.length ? `${changes.length} new since you looked` : 'Nothing new'}</button>
          <button aria-current={sel.view === 'compare'} onClick={() => go({ view: 'compare', a: 'v2', b: 'v3' })}>Versions</button>
          <button aria-current={sel.view === 'whatif'} onClick={() => go({ view: 'whatif' })}>What-ifs</button>
        </nav>
        <button className="search" onClick={() => setPalette(true)}>Search <kbd>⌘K</kbd></button>
        {me?.role === 'firm_administrator' && <ResetDemo user={user} />}
        <RoleSwitch people={people} user={user} />
        <span className={`live${w.live ? ' on' : ''}`} title={w.live ? 'Changes from colleagues appear as they happen' : 'Not connected; changes from others appear on reload'}>{w.live ? 'Live' : 'Offline'}</span>
      </header>
      <main className={`panes${sel.view ? ' is-view' : sel.line || sel.src ? '' : ' is-home'}`}>
        <Outline g={g} w={w} areas={areas} open={openAreas} showWs={showWs}
          toggle={a => setOpenAreas(s => toggled(s, a))} toggleWs={a => setShowWs(s => toggled(s, a))}
          selected={sel.line} cursorKey={cursorKey} onSelect={k => openLine(k)} changed={changedLines} />
        <section className="middle" aria-live="polite">
          {sel.view === 'compare' ? <Compare g={g} w={w} a={sel.a ?? 'v2'} b={sel.b ?? 'v3'} onPick={(a, b) => go({ view: 'compare', a, b })} onLine={k => openLine(k)} />
          : sel.view === 'whatif' ? <WhatIfs g={g} w={w} onLine={k => openLine(k)} />
          : sel.line && g.line(sel.line)
            ? <Thread g={g} w={w} lineKey={sel.line} src={sel.src} onLine={openLine} onSrc={src => go({ ...sel, src })} form={form} setForm={setForm} />
            : <Home g={g} w={w} onFinding={f => openFinding(g, f, openLine, src => go({ src }))} onLine={k => openLine(k)} />}
        </section>
        <DocPane g={g} w={w} refStr={sel.src} onLine={openLine} onSrc={src => go({ ...sel, src })}
          hint={sel.line && !g.line(sel.line)?.sources.length ? 'This line is built only from other lines. Open one of them in the proof thread to follow it to a document.' : undefined} />
      </main>
      {drawer && <ChangesDrawer g={g} w={w} changes={changes} onLine={k => openLine(k)} onClose={() => setDrawer(false)} onSeen={() => { const s = w.events.at(-1)!.seq; writeCursor(user, s); setCursor(s); setDrawer(false); }} />}
      <Connector deps={[sel.line, sel.src]} />
      {toast && <div className="toast" role="status"><span>{toast.text}</span>{toast.undo && <button className="btn quiet" onClick={toast.undo}>Undo</button>}<button className="link" onClick={() => setToast(null)} aria-label="Dismiss">Dismiss</button></div>}
      {palette && <Palette g={g} onClose={() => setPalette(false)} onPick={(kind, ref) => {
        setPalette(false);
        if (kind === 'line') openLine(ref);
        else if (kind === 'ev') { const k = Object.values(g.lines.v3).find(l => l.sources.includes(ref))?.key; k ? openLine(k, ref) : go({ src: ref }); }
        else go({ ...sel, src: ref });
      }} />}
    </div>
    </Session.Provider>
  );
}

// Firm administrator only (the server checks too). Clients never see this.
function ResetDemo({ user }: { user: string }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const run = async (scenario: string) => {
    setBusy(scenario);
    const r = await fetch('/api/admin/reset', { method: 'POST', headers: { 'content-type': 'application/json', 'x-user': user }, body: JSON.stringify({ scenario }) });
    if (!r.ok) { setBusy(null); setError((await r.json()).error); }
    // success: the server tells every open browser (this one included) to reload
  };
  return (
    <div className="reset">
      <button className="btn quiet" onClick={() => setOpen(!open)} aria-expanded={open}>Reset demo</button>
      {open && (
        <div className="reset-panel" role="dialog" aria-label="Reset the demo">
          <p>This erases every verification, note, adjustment, sign-off, question and file for everyone. The packet and the audit's open items stay.</p>
          <button className="btn" disabled={!!busy} onClick={() => run('clean')}>{busy === 'clean' ? 'Resetting…' : 'Clean start'}</button>
          <p className="muted">Only the 94 open items from the audit.</p>
          <button className="btn" disabled={!!busy} onClick={() => run('midseason')}>{busy === 'midseason' ? 'Resetting…' : 'Mid-season, as of July 2026'}</button>
          <p className="muted">Wages and Interest signed; Interest reopened by a later verification; RSU and gross-receipts adjustments approved by the partner; two client questions answered; one review note open.</p>
          {error && <p className="warn">{error}</p>}
          <button className="link" onClick={() => setOpen(false)}>Cancel</button>
        </div>
      )}
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
        setD({ path: `M${x1} ${y1} C ${cx} ${y1}, ${cx} ${y2}, ${x2} ${y2}`, x: x2, y: y2, broken: !!hop.closest('.is-broken') && !hop.closest('.is-question'), off: raw !== y2 });
      });
    };
    update();
    const t = setTimeout(update, 120);
    addEventListener('scroll', update, true);
    addEventListener('resize', update);
    // Layout also moves when forms open or records appear: follow the content, not just scrolling.
    const ro = new ResizeObserver(update);
    document.querySelectorAll('.middle > *, .docpane').forEach(el => ro.observe(el));
    return () => { clearTimeout(t); cancelAnimationFrame(raf); ro.disconnect(); removeEventListener('scroll', update, true); removeEventListener('resize', update); };
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
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [explaining, setExplaining] = useState(false);
  const blockers = [...w.blocking!].sort((a, b) => effectSize(b) - effectSize(a));
  const notes = w.openNotes!;
  const pending = w.pendingApproval!;
  const adj = Object.values(w.adjustments!);
  const E = w.adjustedEffect!;
  const sgn = (n: number) => (n === 0 ? 'no change' : `${n > 0 ? '+' : '−'}${Math.abs(n).toLocaleString('en-US')}`);
  const questions = w.findings!.filter(f => f.severity === 'judgment' || (f.severity === 'warning' && f.check !== 'prior_year_variance')).sort((a, b) => effectSize(b) - effectSize(a));
  const swings = w.findings!.filter(f => f.check === 'prior_year_variance');
  const item = (f: Finding) => <li key={f.id}>{itemButton(f)}</li>;
  const itemButton = (f: Finding) => {
    const k = f.lines.find(x => L[x]);
    return (
      <button onClick={() => onFinding(f)}>
        <StatusMark status={severityStatus(f.severity)!} />
        <span className="item-title">{f.title.replace(/^(F|Sch)[\w-]*\.[\w.+]+ /, '')}<span className="item-where">{k ? `${areaOf(k)}, ${isLot(k) ? lotLabel(L[k]) : label(L[k])}` : 'Whole return'}</span></span>
        <span className="item-effect num">{f.tax_effect ? `${fmt(f.tax_effect.federal)} / ${fmt(f.tax_effect.california)}` : ''}</span>
      </button>
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
      {adj.length > 0 && (
        <p className="adjusted-strip"><StatusMark status="Adjusted" /> {adj.length} {adj.length === 1 ? 'adjustment' : 'adjustments'} so far change federal tax by {sgn(E.fedTax)} and California tax by {sgn(E.caTax)}{E.fedBal || E.caBal ? `; payments change the federal balance by ${sgn(E.fedBal)} and California by ${sgn(E.caBal)}` : ''}. First-order estimate at v3 rates; the engine would recompute.</p>
      )}
      <section className="ledger-pair">
        {ledger('Federal', '2024', fed)}
        {ledger('California', '2024 (Form 540)', ca)}
      </section>
      <section className="items">
        <h2><StatusMark status="Blocked" size={14} /> {blockers.length + notes.length + pending.length} items block filing</h2>
        <p className="muted">Largest tax effect first. Effect is federal / California, change times the v3 rate.</p>
        <ul className="item-list">
          {pending.map(a => <li key={a.seq}><button onClick={() => onLine(a.refs[0])}><StatusMark status="Blocked" /><span className="item-title">Partner approval needed: {L[a.refs[0]] ? label(L[a.refs[0]]) : a.refs[0]} adjusted from {fmt(a.payload.from)} to {fmt(a.payload.to)}<span className="item-where">{a.payload.reason}</span></span><span className="item-effect num">{fmt(a.payload.effect.federal)} / {fmt(a.payload.effect.california)}</span></button></li>)}
          {notes.map(n => <li key={n.open.seq}><button onClick={() => onLine(n.open.refs[0])}><StatusMark status="Blocked" /><span className="item-title"><span className="memo">{n.open.payload.text}</span><span className="item-where">Review note on {L[n.open.refs[0]] ? label(L[n.open.refs[0]]) : n.open.refs[0]}</span></span><span /></button></li>)}
          {(allBlock ? blockers : blockers.slice(0, 5)).map(item)}
        </ul>
        {blockers.length > 5 && <button className="more" onClick={() => setAllBlock(!allBlock)}>{allBlock ? 'Show the top 5' : `Show all ${blockers.length}`}</button>}
      </section>
      <section className="items">
        <h2><StatusMark status="Question open" size={14} /> {questions.length + w.openRecomputes!.length} questions and judgment calls</h2>
        <ul className="item-list">
          {w.openRecomputes!.map(r => <li key={r.line}><button onClick={() => onLine(r.line)}><StatusMark status="Question open" /><span className="item-title">Needs recompute: {L[r.line] ? label(L[r.line]) : r.line}<span className="item-where">Because {r.adjustments.map(a => (L[a.refs[0]] ? label(L[a.refs[0]]) : a.refs[0])).join(', ')} {r.adjustments.length === 1 ? 'was' : 'were'} adjusted. {r.why}</span></span><span /></button></li>)}{(allQ ? questions : questions.slice(0, 5)).map(item)}</ul>
        {questions.length > 5 && <button className="more" onClick={() => setAllQ(!allQ)}>{allQ ? 'Show the top 5' : `Show all ${questions.length}`}</button>}
      </section>
      <section className="items">
        <h2>Sign-off on the whole return</h2>
        <SignoffPanel g={g} w={w} scope="area:Whole return" />
      </section>
      <details className="items" open={explaining || picked.size > 0 || undefined}>
        <summary>{swings.length ? `${swings.length} changes from 2024 over the firm threshold need an explanation` : 'Every change from 2024 over the firm threshold is explained'}</summary>
        {explaining
          ? <ExplainVariances items={swings.filter(f => picked.has(f.id))} onDone={() => { setExplaining(false); setPicked(new Set()); }} />
          : <>
            <div className="action-row bulk-bar">
              <label className="check"><input type="checkbox" checked={picked.size === swings.length && swings.length > 0} onChange={e => setPicked(e.target.checked ? new Set(swings.map(f => f.id)) : new Set())} /> Select all</label>
              <button className="btn quiet" disabled={!picked.size} onClick={() => setExplaining(true)}>Explain the {picked.size || ''} selected</button>
            </div>
            <ul className="item-list pickable">{swings.map(f => (
              <li key={f.id}><input type="checkbox" aria-label={`Select ${f.title}`} checked={picked.has(f.id)} onChange={e => { const n = new Set(picked); e.target.checked ? n.add(f.id) : n.delete(f.id); setPicked(n); }} />{itemButton(f)}</li>
            ))}</ul>
          </>}
      </details>
    </article>
  );
}
