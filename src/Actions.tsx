import { createContext, useContext, useState } from 'react';
import { can, LEVELS, scopeHash, scopeName, type Actor } from '../shared/policy.ts';
import { fmt, type Finding, type Graph } from '../shared/packet.ts';
import { StatusMark } from './StatusMark.tsx';
import { post, type Workpaper, type ReviewNote } from './data.ts';

export const Session = createContext<{ me?: Actor; people: Actor[] }>({ people: [] });
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
export type Form = null | 'verify' | 'note' | 'review';
export function LineActions({ g, w, lineKey, form, setForm }: { g: Graph; w: Workpaper; lineKey: string; form: Form; setForm: (f: Form) => void }) {
  const { me, act, error, busy } = useAct();
  const { people } = useSession();
  const [method, setMethod] = useState('agreed_to_source_document');
  const [text, setText] = useState('');
  const l = g.line(lineKey)!;
  const v = w.verification![lineKey];
  const submit = async (type: string, payload: any) => { if (await act(type, [lineKey], payload)) { setForm(null); setText(''); } };
  const label = (l.label.length > 40 ? 'this line' : l.label);
  return (
    <div className="line-actions">
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
        {can(me, 'note') && <button className="btn quiet" onClick={() => setForm(form === 'note' ? null : 'note')} aria-expanded={form === 'note'}>Add a note<kbd>n</kbd></button>}
        {can(me, 'review_note_opened') && <button className="btn quiet" onClick={() => setForm(form === 'review' ? null : 'review')} aria-expanded={form === 'review'}>Write a review note</button>}
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
