import { createContext, useContext, useEffect, useState } from 'react';
import { can, LEVELS, scopeHash, scopeName, NEEDS_PARTNER_OVER, type Actor } from '../shared/policy.ts';
import { fmt, effectOf, type Finding, type Graph } from '../shared/packet.ts';
import { StatusMark } from './StatusMark.tsx';
import { post, attach, type Workpaper, type ReviewNote, type Question } from './data.ts';

export const Session = createContext<{ me?: Actor; people: Actor[]; w?: Workpaper; toast?: (t: Toast) => void }>({ people: [] });
export type Toast = { text: string; undo?: () => Promise<void> } | null;

// Bulk actions are one event covering many lines; undo is one compensating event.
export function useBulk() {
  const { me, w, toast } = useContext(Session);
  const bulkVerify = async (keys: string[], what: string) => {
    if (!me || !w) return;
    const values = Object.fromEntries(keys.map(k => [k, w.value!(k)]));
    const r = await fetch('/api/events', { method: 'POST', headers: { 'content-type': 'application/json', 'x-user': me.id }, body: JSON.stringify({ type: 'verified', refs: keys, payload: { method: 'agreed_to_source_document', values, bulk: true } }) });
    const ev = await r.json();
    if (!r.ok) return toast?.({ text: ev.error });
    toast?.({ text: `Verified ${what} against the broker statement.`, undo: async () => { await post(me.id, 'verification_withdrawn', keys, { undo: ev.seq }); toast?.({ text: `Undone: ${keys.length} verifications withdrawn.` }); } });
  };
  return { bulkVerify };
}
export const useSession = () => useContext(Session);
const nameOf = (people: Actor[], id: string) => people.find(p => p.id === id)?.name ?? id;
const when = (at: string) => new Date(at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

export const METHODS: Record<string, string> = {
  agreed_to_source_document: 'Agreed to the source document',
  recalculated: 'Recalculated',
  confirmed_with_client: 'Confirmed with the client',
  agreed_to_prior_year: 'Agreed to the prior year',
  agreed_to_third_party_record: 'Agreed to an IRS or FTB record',
};

function useAct() {
  const { me } = useSession();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const act = async (type: string, refs: string[], payload: any = {}) => {
    if (!me) return false;
    setBusy(true);
    const e = await post(me.id, type, refs, payload);
    setBusy(false); setError(e);
    return !e;
  };
  return { me, act, error, busy };
}

// ---------- line actions: verify, note, review note ----------
export type Form = null | 'verify' | 'note' | 'review' | 'attach' | 'ask' | 'adjust';
export type Prefill = { to?: number; reason?: string; finding?: string };
const signed = (n: number) => (n === 0 ? 'no change' : `${n > 0 ? '+' : '−'}${Math.abs(n).toLocaleString('en-US')}`);
export const effectLine = (e: { federal: number; california: number; kind: string }) => e.kind === 'none' ? 'Tax effect needs an engine recompute' : `${e.kind === 'balance_due' ? 'Balance due' : 'Tax'}: federal ${signed(e.federal)}, California ${signed(e.california)}`;
export function LineActions({ g, w, lineKey, form, setForm, prefill }: { g: Graph; w: Workpaper; lineKey: string; form: Form; setForm: (f: Form) => void; prefill?: Prefill }) {
  const { me, act, error, busy } = useAct();
  const { people } = useSession();
  const [method, setMethod] = useState('agreed_to_source_document');
  const [text, setText] = useState('');
  const l = g.line(lineKey)!;
  const v = w.verification![lineKey];
  const submit = async (type: string, payload: any) => { if (await act(type, [lineKey], payload)) { setForm(null); setText(''); } };
  const label = (l.label.length > 40 ? 'this line' : l.label);
  const cur = w.value!(lineKey);
  const adj = w.adjustments![lineKey];
  const [to, setTo] = useState('');
  const [authority, setAuthority] = useState('');
  const [revReason, setRevReason] = useState<string | null>(null);
  useEffect(() => { if (form === 'adjust') { setTo(prefill?.to != null ? String(prefill.to) : ''); setText(prefill?.reason ?? ''); } }, [form, prefill]);
  const toNum = Number(to.replace(/[,\s]/g, '').replace(/^\((.*)\)$/, '-$1'));
  const est = to.trim() && Number.isFinite(toNum) ? effectOf(g.P, l, toNum - cur) : null;
  return (
    <div className="line-actions">
      {adj && (
        <div className="adjustment">
          <p><StatusMark status={w.pendingApproval!.includes(adj) ? 'Blocked' : 'Adjusted'} /> <strong>Adjusted</strong> from {fmt(adj.payload.from)} to {fmt(adj.payload.to)} by {nameOf(people, adj.actor)} on {when(adj.at)}.</p>
          <p className="memo">{adj.payload.reason}{adj.payload.authority ? ` Authority: ${adj.payload.authority}.` : ''}</p>
          <p className="muted" title={adj.payload.effect.basis}>{effectLine(adj.payload.effect)}. {adj.payload.needs_partner ? (w.approved!.has(adj.seq) ? `Approved by ${nameOf(people, w.events.find(e => e.type === 'adjustment_approved' && e.payload.adjustment === adj.seq)!.actor)}.` : `Over ${NEEDS_PARTNER_OVER.toLocaleString('en-US')}: needs partner approval before filing.`) : ''}</p>
          <div className="action-row">
            {adj.payload.needs_partner && !w.approved!.has(adj.seq) && can(me, 'adjustment_approved') && me!.id !== adj.actor && <button className="btn" disabled={busy} onClick={() => act('adjustment_approved', [lineKey], { adjustment: adj.seq })}>Approve the adjustment</button>}
            {can(me, 'adjustment_reversed') && (revReason == null
              ? <button className="link" onClick={() => setRevReason('')}>Reverse it</button>
              : <><input aria-label="Why reverse it" placeholder="Why reverse it?" value={revReason} onChange={e => setRevReason(e.target.value)} autoFocus /><button className="btn quiet" disabled={busy || !revReason.trim()} onClick={async () => { if (await act('adjustment_reversed', [lineKey], { adjustment: adj.seq, reason: revReason.trim() })) setRevReason(null); }}>Reverse to {fmt(adj.payload.from)}</button></>)}
          </div>
        </div>
      )}
      {v && (
        <p className="verification">
          <StatusMark status={v.payload.value === l.value ? 'Verified' : 'Reopened'} />{' '}
          {v.payload.value === l.value ? 'Verified' : `Reopened: the value was ${fmt(v.payload.value)} when`} by {nameOf(people, v.actor)} on {when(v.at)}, {METHODS[v.payload.method]?.toLowerCase()}.
          {v.payload.note && <span className="memo"> {v.payload.note}</span>}
          {can(me, 'verification_withdrawn') && <button className="link" onClick={() => act('verification_withdrawn', [lineKey], { verification: v.seq })}>Withdraw</button>}
        </p>
      )}
      <div className="action-row">
        {can(me, 'verified') && !(v && v.payload.value === l.value) && <button className="btn" onClick={() => setForm(form === 'verify' ? null : 'verify')} aria-expanded={form === 'verify'}>Verify {label}<kbd>v</kbd></button>}
        {can(me, 'adjusted') && typeof l.value === 'number' && <button className="btn quiet" onClick={() => setForm(form === 'adjust' ? null : 'adjust')} aria-expanded={form === 'adjust'}>Adjust {label}</button>}
        {can(me, 'note') && <button className="btn quiet" onClick={() => setForm(form === 'note' ? null : 'note')} aria-expanded={form === 'note'}>Add a note<kbd>n</kbd></button>}
        {can(me, 'review_note_opened') && <button className="btn quiet" onClick={() => setForm(form === 'review' ? null : 'review')} aria-expanded={form === 'review'}>Write a review note</button>}
        {can(me, 'note') && <button className="btn quiet" onClick={() => setForm(form === 'attach' ? null : 'attach')} aria-expanded={form === 'attach'}>Attach a file</button>}
        {can(me, 'client_question') && <button className="btn quiet" onClick={() => setForm(form === 'ask' ? null : 'ask')} aria-expanded={form === 'ask'}>Send a question to the client</button>}
        {!me?.id || (!can(me, 'verified') && !can(me, 'note')) ? <span className="muted">{me ? `${me.name} can read this line but not change it.` : ''}</span> : null}
      </div>
      {form === 'verify' && (
        <form className="action-form" onSubmit={e => { e.preventDefault(); submit('verified', { method, note: text.trim() || undefined, value: l.value }); }}>
          <label>How did you verify {fmt(l.value)}?
            <select value={method} onChange={e => setMethod(e.target.value)} autoFocus>
              {g.P.firm.starter_standards.verification_types.map((t: string) => <option key={t} value={t}>{METHODS[t] ?? t}</option>)}
            </select>
          </label>
          <label>Note for the reviewer (optional)<textarea value={text} onChange={e => setText(e.target.value)} rows={2} /></label>
          <div className="action-row"><button className="btn" disabled={busy}>Record verification</button><button type="button" className="btn quiet" onClick={() => setForm(null)}>Cancel</button></div>
          {error && <p className="warn">{error}</p>}
        </form>
      )}
      {form === 'attach' && <AttachForm refs={[lineKey]} onDone={() => setForm(null)} staff />}
      {form === 'adjust' && (
        <form className="action-form" onSubmit={e => { e.preventDefault(); submit('adjusted', { from: cur, to: toNum, reason: text.trim(), authority: authority.trim() || undefined, finding: prefill?.finding }); }}>
          <label>Corrected amount (now {fmt(cur)}{adj ? `, ${fmt(l.value)} in the engine's return` : ''})<input inputMode="decimal" value={to} onChange={e => setTo(e.target.value)} autoFocus /></label>
          <label>Why. The reviewer and an examiner will read this.<textarea value={text} onChange={e => setText(e.target.value)} rows={3} /></label>
          <label>Authority relied on (code section, regulation, ruling; required for judgment calls)<input value={authority} onChange={e => setAuthority(e.target.value)} /></label>
          {est && <p className={est.kind === 'none' ? 'muted' : ''} title={est.basis}>{effectLine(est)}{Math.abs(est.federal) > NEEDS_PARTNER_OVER || Math.abs(est.california) > NEEDS_PARTNER_OVER ? '. Over 1,000, so the partner must approve it.' : '.'}</p>}
          <div className="action-row"><button className="btn" disabled={busy || !est || !text.trim()}>Record the adjustment</button><button type="button" className="btn quiet" onClick={() => setForm(null)}>Cancel</button></div>
          {prefill?.finding && <p className="muted">Recording this addresses {prefill.finding}.</p>}
          {error && <p className="warn">{error}</p>}
        </form>
      )}
      {form === 'ask' && (
        <form className="action-form" onSubmit={e => { e.preventDefault(); submit('client_question', { text: text.trim(), about: l.label }); }}>
          <label>Question for the client. They see only this text, not the workpaper.<textarea value={text} onChange={e => setText(e.target.value)} rows={3} autoFocus /></label>
          <div className="action-row"><button className="btn" disabled={busy || !text.trim()}>Send to the client</button><button type="button" className="btn quiet" onClick={() => setForm(null)}>Cancel</button></div>
          {error && <p className="warn">{error}</p>}
        </form>
      )}
      {(form === 'note' || form === 'review') && (
        <form className="action-form" onSubmit={e => { e.preventDefault(); submit(form === 'note' ? 'note' : 'review_note_opened', { text: text.trim() }); }}>
          <label>{form === 'note' ? 'Note' : 'Review note. It blocks filing until you clear it.'}<textarea value={text} onChange={e => setText(e.target.value)} rows={3} autoFocus /></label>
          <div className="action-row"><button className="btn" disabled={busy || !text.trim()}>{form === 'note' ? 'Save note' : 'Send to the preparer'}</button><button type="button" className="btn quiet" onClick={() => setForm(null)}>Cancel</button></div>
          {error && <p className="warn">{error}</p>}
        </form>
      )}
    </div>
  );
}

// ---------- attach a file as evidence ----------
export function AttachForm({ refs, onDone, staff = false, question }: { refs: string[]; onDone: () => void; staff?: boolean; question?: number }) {
  const { me } = useSession();
  const [file, setFile] = useState<File | null>(null);
  const [note, setNote] = useState('');
  const [share, setShare] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <form className="action-form" onSubmit={async e => {
      e.preventDefault(); if (!file || !me) return;
      setBusy(true); const r = await attach(me.id, file, refs, { note: note.trim() || undefined, share, question }); setBusy(false);
      r.error ? setError(r.error) : onDone();
    }}>
      <label>File (PDF, image or text, up to 15 MB)<input type="file" onChange={e => setFile(e.target.files?.[0] ?? null)} autoFocus /></label>
      <label>What does it show? (optional)<textarea value={note} onChange={e => setNote(e.target.value)} rows={2} /></label>
      {staff && <label className="check"><input type="checkbox" checked={share} onChange={e => setShare(e.target.checked)} /> The client may see this file</label>}
      <div className="action-row"><button className="btn" disabled={busy || !file}>Attach as evidence</button><button type="button" className="btn quiet" onClick={onDone}>Cancel</button></div>
      {error && <p className="warn">{error}</p>}
    </form>
  );
}

// ---------- questions sent to the client, as staff see them ----------
export function ClientQuestions({ questions, onAttachment }: { questions: Question[]; onAttachment: (ref: string) => void }) {
  const { people } = useSession();
  if (!questions.length) return null;
  return (
    <div className="review-notes">
      {questions.map(({ q, answers }) => (
        <div key={q.seq} className={`review-note question${answers.length ? ' is-cleared' : ''}`}>
          <p className="finding-title"><StatusMark status={answers.length ? 'Verified' : 'Question open'} /> <span><strong className="finding-state">{answers.length ? 'Client answered.' : 'Waiting on the client.'}</strong> {nameOf(people, q.actor)} asked on {when(q.at)}</span></p>
          <p className="memo note-text">{q.payload.text}</p>
          {answers.map(a => (
            <div key={a.seq} className="memo note-reply"><span className="label">{nameOf(people, a.actor)}</span>{a.payload.text}
              {(a.payload.attachments ?? []).map((id: string) => <button key={id} className="link" onClick={() => onAttachment(`att:${id}`)}>Open the attached file</button>)}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

// ---------- review notes on a line ----------
export function ReviewNotes({ notes }: { notes: ReviewNote[] }) {
  const { me, people } = useSession();
  const { act, error, busy } = useAct();
  const [reply, setReply] = useState<Record<number, string>>({});
  if (!notes.length) return null;
  return (
    <div className="review-notes">
      {notes.map(n => (
        <div key={n.open.seq} className={`review-note${n.cleared ? ' is-cleared' : ''}`}>
          <p className="finding-title"><StatusMark status={n.cleared ? 'Verified' : 'Blocked'} /> <span><strong className="finding-state">{n.cleared ? 'Review note cleared.' : 'Review note, blocks filing.'}</strong> {nameOf(people, n.open.actor)}, {when(n.open.at)}</span></p>
          <p className="memo note-text">{n.open.payload.text}</p>
          {n.replies.map(r => <p key={r.seq} className="memo note-reply"><span className="label">{nameOf(people, r.actor)}</span>{r.payload.text}</p>)}
          {n.cleared && <p className="muted note-reply">Cleared by {nameOf(people, n.cleared.actor)} on {when(n.cleared.at)}.</p>}
          {!n.cleared && (
            <div className="action-row">
              {can(me, 'review_note_replied') && <>
                <input aria-label="Reply" placeholder="Reply" value={reply[n.open.seq] ?? ''} onChange={e => setReply({ ...reply, [n.open.seq]: e.target.value })} />
                <button className="btn quiet" disabled={busy || !reply[n.open.seq]?.trim()} onClick={async () => { if (await act('review_note_replied', n.open.refs, { note: n.open.seq, text: reply[n.open.seq] })) setReply({ ...reply, [n.open.seq]: '' }); }}>Reply</button>
              </>}
              {can(me, 'review_note_cleared') && (me!.id === n.open.actor || me!.role === 'partner') && <button className="btn" disabled={busy} onClick={() => act('review_note_cleared', n.open.refs, { note: n.open.seq })}>Clear the note</button>}
            </div>
          )}
        </div>
      ))}
      {error && <p className="warn">{error}</p>}
    </div>
  );
}

// ---------- resolve an open item (reviewer / partner) ----------
export function ResolveFinding({ f }: { f: Finding }) {
  const { me, act, error, busy } = useAct();
  const [text, setText] = useState('');
  const [open, setOpen] = useState(false);
  if (!can(me, 'finding_resolved')) return null;
  return open ? (
    <form className="action-form" onSubmit={async e => { e.preventDefault(); if (await act('finding_resolved', [...f.lines, ...f.refs], { id: f.id, text: text.trim() })) setOpen(false); }}>
      <label>Why is this resolved? Name the evidence or authority.<textarea value={text} onChange={e => setText(e.target.value)} rows={2} autoFocus /></label>
      <div className="action-row"><button className="btn" disabled={busy || !text.trim()}>Resolve {f.id}</button><button type="button" className="btn quiet" onClick={() => setOpen(false)}>Cancel</button></div>
      {error && <p className="warn">{error}</p>}
    </form>
  ) : <button className="why" onClick={e => { e.stopPropagation(); setOpen(true); }}>Resolve with a reason</button>;
}

// ---------- sign-offs on an area (or the whole return) ----------
export function SignoffPanel({ g, w, scope }: { g: Graph; w: Workpaper; scope: string }) {
  const { me, people } = useSession();
  const { act, error, busy } = useAct();
  const name = scopeName(scope);
  return (
    <div className="signoffs">
      {LEVELS.map(level => {
        const s = w.signoffs!.filter(x => x.scope === scope && x.level === level).at(-1);
        const mine = me?.role === level && can(me, 'signed_off');
        return (
          <div key={level} className="signoff-row">
            <StatusMark status={s ? (s.reopened ? 'Reopened' : 'Signed') : 'Unverified'} />
            <span className="signoff-level">{level[0].toUpperCase() + level.slice(1)}</span>
            {s ? <span className={`signoff-text${s.reopened ? ' reopened' : ''}`}>{s.reopened ? `Reopened. Changed since ${nameOf(people, s.actor)} signed on ${when(s.at)}` : `Signed by ${nameOf(people, s.actor)}, ${when(s.at)}`}</span> : <span className="signoff-text muted">Not signed</span>}
            {mine && (!s || s.reopened) && <button className="btn quiet" disabled={busy} onClick={() => act('signed_off', [scope], { level, hash: scopeHash(g, w.events, scope) })}>Sign off on {name}</button>}
            {mine && s && !s.reopened && s.actor === me!.id && <button className="link" disabled={busy} onClick={() => act('signoff_withdrawn', [scope], { signoff: s.seq })}>Withdraw</button>}
          </div>
        );
      })}
      {error && <p className="warn">{error}</p>}
    </div>
  );
}
