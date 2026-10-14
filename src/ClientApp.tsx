import { useEffect, useState } from 'react';
import type { Actor } from '../shared/policy.ts';
import { useEvents, post, attach, questionsOf, reveal, type WEvent } from './data.ts';
import { RoleSwitch } from './App.tsx';
import { AttachmentView } from './DocPane.tsx';
import { StatusMark } from './StatusMark.tsx';

// What the client sees: questions addressed to them, the documents they gave us, their uploads,
// and (later) approval and e-signature. The server sends nothing else to a client user.
export function ClientApp({ me, people }: { me: Actor; people: Actor[] }) {
  const [P, setP] = useState<any>(null);
  const { events, live } = useEvents(me.id);
  const [open, setOpen] = useState<{ kind: 'doc' | 'file'; id: string } | null>(null);
  useEffect(() => { fetch('/api/client', {}).then(r => r.json()).then(setP); }, [me.id]);
  if (!P) return <div className="loading">Loading…</div>;
  const questions = questionsOf(events);
  const waiting = questions.filter(q => !q.answers.length);
  const uploads = events.filter(e => e.type === 'evidence_attached');
  return (
    <div className="app client">
      <header className="topbar">
        <span className="client">Your 2025 tax return</span>
        <span className="version">Prepared by Miraflores</span>
        <span className={`live${live ? ' on' : ''}`} style={{ marginLeft: 'auto' }}>{live ? 'Live' : 'Offline'}</span>
        <RoleSwitch people={people} user={me.id} />
      </header>
      <main className="client-main">
        <section className="client-col">
          <h1>{waiting.length ? `${waiting.length} ${waiting.length === 1 ? 'question needs' : 'questions need'} your answer` : 'Nothing needs your answer right now'}</h1>
          <p className="muted">Your preparer asks here when something in your documents needs explaining. You can answer in words, attach a file, or both.</p>
          <ul className="client-questions">
            {[...waiting, ...questions.filter(q => q.answers.length)].map(q => <ClientQuestion key={q.q.seq} me={me} q={q.q} answers={q.answers} people={people} onFile={id => setOpen({ kind: 'file', id })} />)}
          </ul>

          <h2>Approval and e-signature</h2>
          <Approval me={me} events={events} />

          <h2>Your documents</h2>
          <ul className="client-docs">
            {P.documents.map((d: any) => <li key={d.id}><button onClick={() => setOpen({ kind: 'doc', id: d.id })}><span>{d.title}</span><span className="muted">received {d.received_at.slice(0, 10)}</span></button></li>)}
            {uploads.map(u => <li key={u.seq}><button onClick={() => setOpen({ kind: 'file', id: u.payload.id })}><span>{u.payload.name}</span><span className="muted">uploaded {u.at.slice(0, 10)}</span></button></li>)}
          </ul>
        </section>
        <aside className="docpane">
          {open?.kind === 'doc' && <ClientDoc me={me} doc={P.documents.find((d: any) => d.id === open.id)} />}
          {open?.kind === 'file' && (() => { const a = uploads.find(u => u.payload.id === open.id); return a ? <AttachmentView a={a} user={me.id} people={people} /> : null; })()}
          {!open && <p className="muted pane-hint">Select a document or file to see it here.</p>}
        </aside>
      </main>
    </div>
  );
}

// Review the summary the partner sent, then sign Forms 8879 and FTB 8879 with a PIN you choose.
function Approval({ me, events }: { me: Actor; events: WEvent[] }) {
  const [pin, setPin] = useState('');
  const [agree, setAgree] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const sent = events.filter(e => e.type === 'sent_for_approval').at(-1);
  const filed = events.find(e => e.type === 'return_frozen');
  const mine = sent && events.find(e => e.type === 'client_signed_8879' && e.actor === me.id && e.seq > sent.seq);
  const fmtN = (n: number) => Math.abs(n).toLocaleString('en-US');
  if (filed) return <p className="client-approval"><span><StatusMark status="Signed" /> Your federal return was accepted by the IRS on {filed.at.slice(0, 10)} ({filed.payload.submission}). California follows the federal acceptance.</span></p>;
  if (!sent) return <p className="muted">When your return is ready, you will review a summary and sign Forms 8879 and FTB 8879 here. It is not ready yet.</p>;
  const S = sent.payload.summary;
  return (
    <div className="client-approval">
      <table className="ledger compact"><tbody>
        <tr><th scope="row">Federal tax</th><td className="num">{fmtN(S.federal.total_tax)}</td></tr>
        <tr><th scope="row">{S.federal.balance_due >= 0 ? 'Federal amount you owe' : 'Federal refund'}</th><td className="num">{fmtN(S.federal.balance_due)}</td></tr>
        <tr><th scope="row">California tax</th><td className="num">{fmtN(S.california.total_tax)}</td></tr>
        <tr><th scope="row">{S.california.balance_due >= 0 ? 'California amount you owe' : 'California refund'}</th><td className="num">{fmtN(S.california.balance_due)}</td></tr>
      </tbody></table>
      {mine ? <p><StatusMark status="Signed" /> You signed on {mine.at.slice(0, 10)}. We will file once both of you have signed.</p> : (
        <form className="action-form" onSubmit={async e => {
          e.preventDefault(); setBusy(true);
          const err = await post(me.id, 'client_signed_8879', ['area:Whole return'], { pin, agree });
          setBusy(false); setError(err);
        }}>
          <label className="check"><input type="checkbox" checked={agree} onChange={e => setAgree(e.target.checked)} /> I reviewed the return and the amounts above, and I authorize Miraflores to file it electronically.</label>
          <label>Your 5-digit signature PIN (any five digits you choose)<input inputMode="numeric" maxLength={5} value={pin} onChange={e => setPin(e.target.value.replace(/\D/g, ''))} /></label>
          <div className="action-row"><button className="btn" disabled={busy || !agree || pin.length !== 5}>Sign Forms 8879 and FTB 8879</button></div>
          {error && <p className="warn">{error}</p>}
        </form>
      )}
    </div>
  );
}

function ClientQuestion({ me, q, answers, people, onFile }: { me: Actor; q: WEvent; answers: WEvent[]; people: Actor[]; onFile: (id: string) => void }) {
  const [text, setText] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const name = (id: string) => people.find(p => p.id === id)?.name ?? id;
  const send = async () => {
    setBusy(true); setError(null);
    const ids: string[] = [];
    if (file) {
      const r = await attach(me.id, file, q.refs, { question: q.seq });
      if (r.error) { setBusy(false); return setError(r.error); }
      ids.push(r.id!);
    }
    const err = await post(me.id, 'client_answer', q.refs, { question: q.seq, text: text.trim(), attachments: ids });
    setBusy(false);
    if (err) setError(err); else { setText(''); setFile(null); }
  };
  return (
    <li className={`client-question${answers.length ? ' is-answered' : ''}`}>
      <p className="finding-title"><StatusMark status={answers.length ? 'Verified' : 'Question open'} /> <span>{name(q.actor)} asked on {q.at.slice(0, 10)}</span></p>
      <p className="memo">{q.payload.text}</p>
      {answers.map(a => <div key={a.seq} className="memo note-reply"><span className="label">{name(a.actor)}</span>{a.payload.text}{(a.payload.attachments ?? []).map((id: string) => <button key={id} className="link" onClick={() => onFile(id)}>Your attached file</button>)}</div>)}
      {!answers.length && (
        <form className="action-form" onSubmit={e => { e.preventDefault(); send(); }}>
          <label>Your answer<textarea value={text} onChange={e => setText(e.target.value)} rows={3} /></label>
          <label>Attach a file (optional)<input type="file" onChange={e => setFile(e.target.files?.[0] ?? null)} /></label>
          <div className="action-row"><button className="btn" disabled={busy || (!text.trim() && !file)}>Send your answer</button></div>
          {error && <p className="warn">{error}</p>}
        </form>
      )}
    </li>
  );
}

function ClientDoc({ me, doc }: { me: Actor; doc: any }) {
  const [plain, setPlain] = useState<Record<number, string>>({});
  useEffect(() => setPlain({}), [doc.id]);
  return (
    <>
      <header className="doc-head"><p className="doc-kicker">Received {doc.received_at.slice(0, 10)}</p><h2>{doc.title}</h2></header>
      <div className="pages">
        {doc.pages.map((p: any) => (
          <section key={p.page} className="sheet facsimile">
            {doc.pages.length > 1 && <p className="page-no">Page {p.page} of {doc.pages.length}</p>}
            {p.printed_content.includes('•') && !plain[p.page] && <p className="mask-bar"><button className="link" onClick={async () => { const r = await reveal(me.id, `doc:${doc.id}#page${p.page}`); if (r.value) setPlain({ ...plain, [p.page]: r.value }); }}>Show the full numbers on this page</button></p>}
            <p className="printed">{plain[p.page] ?? p.printed_content}</p>
          </section>
        ))}
      </div>
    </>
  );
}
