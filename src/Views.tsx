import { useMemo, useState } from 'react';
import { areaOf, fmt, isLot, labelMaker, type Graph } from '../shared/packet.ts';
import { can } from '../shared/policy.ts';
import { StatusMark } from './StatusMark.tsx';
import { post, type Workpaper, type WEvent } from './data.ts';
import { useSession } from './Actions.tsx';

const nameOf = (people: { id: string; name: string }[], id: string) => (id === 'audit' ? 'The audit' : people.find(p => p.id === id)?.name ?? id);
const when = (at: string) => new Date(at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

// ---------- since I last looked ----------
// The cursor is per viewer and per browser (a convenience, not a record): the last event seq they saw.
const cursorKey = (user: string) => `seen:${user}`;
export function readCursor(user: string, latest: number): number {
  try {
    const v = localStorage.getItem(cursorKey(user));
    // First visit, or the log was reset since: nothing is "new".
    if (v == null || Number(v) > latest) { localStorage.setItem(cursorKey(user), String(latest)); return latest; }
    return Number(v);
  } catch { return latest; }
}
export function writeCursor(user: string, seq: number) { try { localStorage.setItem(cursorKey(user), String(seq)); } catch {} }

export const describeEvent = (e: WEvent): string => {
  const p = e.payload ?? {};
  switch (e.type) {
    case 'verified': return p.bulk ? `verified ${e.refs.length} lines` : 'verified';
    case 'verification_withdrawn': return p.undo ? `undid a bulk verification of ${e.refs.length} lines` : 'withdrew a verification';
    case 'adjusted': return `adjusted from ${fmt(p.from)} to ${fmt(p.to)}`;
    case 'adjustment_reversed': return 'reversed an adjustment';
    case 'adjustment_approved': return 'approved an adjustment';
    case 'review_note_opened': return `wrote a review note: ${p.text}`;
    case 'review_note_replied': return `replied: ${p.text}`;
    case 'review_note_cleared': return 'cleared a review note';
    case 'signed_off': return `signed off as ${p.level}`;
    case 'finding_resolved': return `resolved ${p.id}`;
    case 'note': return `noted: ${p.text}`;
    case 'evidence_attached': return `attached ${p.name}`;
    case 'client_question': return `asked the client: ${p.text}`;
    case 'client_answer': return `answered: ${p.text}`;
    case 'sensitive_viewed': return 'viewed unmasked data';
    default: return e.type.replace(/_/g, ' ');
  }
};

export function ChangesDrawer({ g, w, changes, onLine, onClose, onSeen }: { g: Graph; w: Workpaper; changes: WEvent[]; onLine: (k: string) => void; onClose: () => void; onSeen: () => void }) {
  const { people } = useSession();
  const label = labelMaker(Object.values(g.lines.v3));
  return (
    <div className="drawer" role="dialog" aria-label="Changes since you last looked">
      <header><h2>{changes.length} {changes.length === 1 ? 'change' : 'changes'} since you last looked</h2><button className="link" onClick={onClose}>Close</button></header>
      <ul>
        {changes.map(e => {
          const k = e.refs.find(r => g.line(r));
          return (
            <li key={e.seq}><button onClick={() => k && onLine(k)} disabled={!k}>
              <span className="drawer-who">{nameOf(people, e.actor)}, {when(e.at)}</span>
              <span>{describeEvent(e)}{k ? <> on <strong>{isLot(k) ? g.line(k)!.label.replace(/ \(acquired.*$/, '') : label(g.line(k)!)}</strong></> : ''}{e.refs.length > 1 && k ? ` and ${e.refs.length - 1} more` : ''}</span>
            </button></li>
          );
        })}
      </ul>
      <button className="btn" onClick={onSeen}>Mark all as seen</button>
    </div>
  );
}

// ---------- compare versions ----------
export function Compare({ g, w, a, b, onPick, onLine }: { g: Graph; w: Workpaper; a: string; b: string; onPick: (a: string, b: string) => void; onLine: (k: string) => void }) {
  const P = g.P;
  const versions: string[] = P.return_versions.map((v: any) => v.version);
  const va = P.return_versions.find((v: any) => v.version === a), vb = P.return_versions.find((v: any) => v.version === b);
  const [showLots, setShowLots] = useState(false);
  const rows = useMemo(() => {
    const La = g.lines[a], Lb = g.lines[b];
    const keys = [...new Set([...Object.keys(La), ...Object.keys(Lb)])];
    return keys.filter(k => JSON.stringify(La[k]?.value) !== JSON.stringify(Lb[k]?.value)).map(k => ({ k, from: La[k]?.value, to: Lb[k]?.value, line: Lb[k] ?? La[k] }));
  }, [a, b]);
  const label = labelMaker(Object.values(g.lines[b]));
  const byArea: Record<string, typeof rows> = {};
  for (const r of rows) if (showLots || !isLot(r.k)) (byArea[areaOf(r.k)] ??= []).push(r);
  const added = vb.documents_used.filter((d: string) => !va.documents_used.includes(d));
  const superseded = vb.documents_superseded.filter((d: string) => !va.documents_superseded.includes(d));
  const S = (s: any, x: string) => s.federal[x];
  return (
    <article className="compare">
      <header>
        <h1>Compare versions</h1>
        <div className="action-row">
          <select value={a} onChange={e => onPick(e.target.value, b)} aria-label="From version">{versions.map(v => <option key={v}>{v}</option>)}</select>
          <span>to</span>
          <select value={b} onChange={e => onPick(a, e.target.value)} aria-label="To version">{versions.map(v => <option key={v}>{v}</option>)}</select>
        </div>
        <p className="memo">{vb.trigger}</p>
        <p className="muted">Documents added: {added.length ? added.map((d: string) => `${d} ${g.docs[d].title}`).join('; ') : 'none'}. Superseded: {superseded.length ? superseded.join(', ') : 'none'}.</p>
      </header>
      <table className="ledger">
        <thead><tr><th /><th className="num">{a}</th><th className="num">{b}</th><th className="num">Change</th></tr></thead>
        <tbody>
          {[['Federal AGI', 'agi'], ['Federal total tax', 'total_tax'], ['Federal balance due', 'balance_due']].map(([lab, x]) => (
            <tr key={x}><th scope="row">{lab}</th><td className="num">{fmt(S(va.summary, x))}</td><td className="num">{fmt(S(vb.summary, x))}</td><td className="num">{fmt(S(vb.summary, x) - S(va.summary, x))}</td></tr>
          ))}
          {[['California tax', 'total_tax'], ['California balance due', 'balance_due']].map(([lab, x]) => (
            <tr key={lab}><th scope="row">{lab}</th><td className="num">{fmt(va.summary.california[x])}</td><td className="num">{fmt(vb.summary.california[x])}</td><td className="num">{fmt(vb.summary.california[x] - va.summary.california[x])}</td></tr>
          ))}
        </tbody>
      </table>
      <p className="muted">{rows.length} lines changed{rows.some(r => isLot(r.k)) ? '. ' : ''}{rows.some(r => isLot(r.k)) && <button className="link" onClick={() => setShowLots(!showLots)}>{showLots ? 'Hide' : 'Show'} the {rows.filter(r => isLot(r.k)).length} sale lines</button>}</p>
      {Object.entries(byArea).map(([area, rs]) => (
        <section key={area} className="items">
          <h2>{area}</h2>
          <table className="ledger compact"><tbody>
            {rs.map(r => (
              <tr key={r.k}>
                <th scope="row"><button onClick={() => onLine(r.k)} disabled={!g.line(r.k)}>{isLot(r.k) ? r.line.label.replace(/ \(acquired.*$/, '') + `, lot ${r.k.split('.').pop()}` : label(r.line)}</button></th>
                <td className="num muted">{r.from === undefined ? 'added' : fmt(r.from, isLot(r.k))}</td>
                <td className="num">{r.to === undefined ? 'removed' : fmt(r.to, isLot(r.k))}</td>
                <td className="num muted">{typeof r.from === 'number' && typeof r.to === 'number' ? fmt(r.to - r.from, isLot(r.k)) : ''}</td>
              </tr>
            ))}
          </tbody></table>
        </section>
      ))}
    </article>
  );
}

// ---------- what-ifs (precomputed by the engine) ----------
export function WhatIfs({ g, w, onLine }: { g: Graph; w: Workpaper; onLine: (k: string) => void }) {
  const { me, people } = useSession();
  const [open, setOpen] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [authority, setAuthority] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const label = labelMaker(Object.values(g.lines.v3));
  const decisions = w.events.filter(e => e.type === 'election_recorded');
  return (
    <article className="whatifs">
      <h1>What-ifs</h1>
      <p className="muted">The engine computed these alternatives to the v3 return. Choosing one is a judgment call: record the decision, the reason and the authority relied on.</p>
      {g.P.what_if.alternatives.map((a: any) => {
        const d = decisions.filter(e => e.payload.id === a.id).at(-1);
        const sgn = (n: number) => (n === 0 ? 'no change' : `${n > 0 ? '+' : '−'}${Math.abs(n).toLocaleString('en-US')}`);
        return (
          <section key={a.id} className="whatif">
            <h2>{a.description}</h2>
            <p className="whatif-effect">Federal tax {sgn(a.federal.total_tax_change)}{a.federal.penalty_change ? `, penalty ${sgn(a.federal.penalty_change)}` : ''}; California tax {sgn(a.california.total_tax_change)}. {a.changed_lines.length} lines change.</p>
            {d ? <p className="memo"><StatusMark status="Signed" /> {nameOf(people, d.actor)} decided to {d.payload.decision === 'adopt' ? 'adopt' : 'keep the v3 treatment instead of'} this on {when(d.at)}. {d.payload.reason} {d.payload.authority ? `Authority: ${d.payload.authority}.` : ''}</p> : null}
            <details><summary>Lines that change</summary>
              <table className="ledger compact"><tbody>{a.changed_lines.slice(0, 40).map((c: any) => (
                <tr key={c.key}><th scope="row"><button onClick={() => onLine(c.key)} disabled={!g.line(c.key)}>{g.line(c.key) ? label(g.line(c.key)!) : c.key}</button></th><td className="num muted">{fmt(c.old)}</td><td className="num">{fmt(c.new)}</td></tr>
              ))}</tbody></table>
            </details>
            {can(me, 'election_recorded') && (open === a.id ? (
              <form className="action-form" onSubmit={async e => {
                e.preventDefault();
                const decision = (e.nativeEvent as SubmitEvent).submitter?.getAttribute('value');
                const x = await post(me!.id, 'election_recorded', a.changed_lines.map((c: any) => c.key).slice(0, 1).concat([`what_if:${a.id}`]), { id: a.id, decision, reason: reason.trim(), authority: authority.trim() });
                setErr(x); if (!x) { setOpen(null); setReason(''); setAuthority(''); }
              }}>
                <label>Why<textarea value={reason} onChange={e => setReason(e.target.value)} rows={2} autoFocus /></label>
                <label>Authority relied on<input value={authority} onChange={e => setAuthority(e.target.value)} /></label>
                <div className="action-row"><button className="btn" value="adopt" disabled={!reason.trim() || !authority.trim()}>Adopt this</button><button className="btn quiet" value="reject" disabled={!reason.trim() || !authority.trim()}>Keep the v3 treatment</button><button type="button" className="link" onClick={() => setOpen(null)}>Cancel</button></div>
                {err && <p className="warn">{err}</p>}
              </form>
            ) : <button className="btn quiet" onClick={() => setOpen(a.id)}>Record a decision</button>)}
          </section>
        );
      })}
      <p className="muted">Extension estimate (made from v2 on {g.P.what_if.extension.computed_at.slice(0, 10)}): federal {fmt(g.P.what_if.extension.federal.estimated_balance)} owed, paid {fmt(g.P.what_if.extension.federal.paid_with_form_4868)} with Form 4868; California {fmt(g.P.what_if.extension.california.estimated_balance)}, paid {fmt(g.P.what_if.extension.california.paid_with_ftb_3519)}.</p>
    </article>
  );
}
