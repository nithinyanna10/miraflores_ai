import { useEffect, useRef, useState } from 'react';
import type { Actor } from '../shared/policy.ts';

type Person = Actor & { credential?: string | null };
type Meta = { firm: string; client: string; return: string; extended?: string };

// One plain line per role: what this person can do here. The server enforces all of it.
const CAN: Record<string, string> = {
  preparer: 'Prepares and verifies lines; can\'t sign off on areas they prepared.',
  reviewer: 'Reviews the work, writes review notes that block filing, signs off on what they did not prepare.',
  partner: 'Approves adjustments over 1,000, clears any review note, signs off last and transmits.',
  firm_administrator: 'Resets the demo and reads the view log; cannot change the return.',
  quality_reviewer: 'Reviews returns after filing.',
  client: 'Answers the firm\'s questions, sees their own documents, approves and signs.',
};
const ROLE: Record<string, string> = { preparer: 'Preparer', reviewer: 'Reviewer', partner: 'Partner', firm_administrator: 'Firm administrator', quality_reviewer: 'Quality reviewer', client: 'Client' };
const initials = (name: string) => name.split(' ').map(w => w[0]).join('').slice(0, 2);
const longDate = (d: string) => new Date(d + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
const emailOf = (p: Person, firm: string) => `${p.name.toLowerCase().replace(/[^a-z ]/g, '').split(' ').join('.')}@${firm.toLowerCase()}.example`;

export async function signOut() {
  await fetch('/api/session', { method: 'DELETE' });
  location.href = '/';
}

export function SignIn({ people }: { people: Person[] }) {
  const [meta, setMeta] = useState<Meta | null>(null);
  const ordered = [...people.filter(p => p.role !== 'client'), ...people.filter(p => p.role === 'client')];
  const [sel, setSel] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => { fetch('/api/meta').then(r => r.json()).then(setMeta); }, []);
  const p = ordered[sel];
  const today = new Date().toISOString().slice(0, 10);

  const signIn = async (person: Person) => {
    setBusy(true); setError(null);
    const r = await fetch('/api/session', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ person: person.id }) });
    if (!r.ok) { setBusy(false); return setError((await r.json()).error); }
    const next = new URLSearchParams(location.search).get('next');
    location.href = next && next.startsWith('/app') ? next : '/app';
  };
  // Arrow keys move the selection; Enter signs in (unless typing in the card's fields).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest('input')) return;
      if (e.key === 'ArrowDown') { e.preventDefault(); setSel(s => Math.min(ordered.length - 1, s + 1)); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); setSel(s => Math.max(0, s - 1)); }
      else if (e.key === 'Enter' && p && !busy) { e.preventDefault(); signIn(p); }
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, [sel, ordered.length, busy]);
  useEffect(() => { list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' }); }, [sel]);

  const row = (q: Person) => {
    const i = ordered.indexOf(q);
    const notYet = q.active_from && q.active_from > today;
    return (
      <button key={q.id} role="option" aria-selected={i === sel} className={`person${i === sel ? ' is-selected' : ''}`} onClick={() => setSel(i)} onDoubleClick={() => signIn(q)}>
        <span className="avatar" aria-hidden>{initials(q.name)}</span>
        <span className="person-text">
          <span className="person-name">{q.name}</span>
          <span className="person-role">{ROLE[q.role] ?? q.role}{q.credential ? `, ${q.credential}` : ''}</span>
          <span className="person-can">{notYet ? `Starts ${longDate(q.active_from!)}; can read but not act yet.` : CAN[q.role]}</span>
        </span>
      </button>
    );
  };

  return (
    <main className="signin">
      <section className="signin-fun" aria-label="Animation: a magnifying glass finds a receipt counted twice">
        <Doubles />
        <p className="muted">We find the doubles so you don't have to.</p>
      </section>

      <section className="signin-center">
        <p className="signin-firm">{meta?.firm ?? 'Miraflores'}</p>
        <h1 className="signin-title">Sign in to your workspace</h1>
        {p && (
          <form className="signin-card" onSubmit={e => { e.preventDefault(); signIn(p); }}>
            <header><span className="avatar large" aria-hidden>{initials(p.name)}</span><span><strong>{p.name}</strong><span className="muted">{ROLE[p.role]}{p.credential ? `, ${p.credential}` : ''}</span></span></header>
            <label>Email<input value={emailOf(p, meta?.firm ?? 'miraflores')} readOnly /></label>
            <label>Password<input type="password" placeholder="Not checked in this prototype" autoComplete="off" /></label>
            <button className="btn primary" disabled={busy}>{busy ? 'Signing in…' : `Sign in as ${p.name.split(' ')[0]}`}</button>
            {error && <p className="warn">{error}</p>}
            <p className="muted small">No real authentication in this prototype. Pick a person on the right.</p>
          </form>
        )}
        {meta && <p className="muted small signin-return">{meta.client}, {meta.return}.{meta.extended ? <><br />Extended due date {longDate(meta.extended)}</> : null}</p>}
      </section>

      <section className="signin-people">
        <h2>Choose who's signing in</h2>
        <div ref={list} role="listbox" aria-label="People" aria-activedescendant={p?.id}>
          <h3>Firm</h3>
          {ordered.filter(q => q.role !== 'client').map(row)}
          <h3>Client</h3>
          {ordered.filter(q => q.role === 'client').map(row)}
        </div>
      </section>
    </main>
  );
}

// A magnifying glass hops onto a receipt; two identical coins pop out ("counted twice"); it does a double
// take; one coin goes poof; a teal "Checked" stamp thumps down; happy wiggle. Base styles are the final frame.
function Doubles() {
  return (
    <svg className="doubles" viewBox="0 0 280 260" role="img" aria-label="A magnifying glass finds a duplicate coin on a receipt, removes it, and stamps the receipt Checked.">
      <g className="receipt">
        <path d="M95 92 H185 V222 L176 214 L167 222 L158 214 L149 222 L140 214 L131 222 L122 214 L113 222 L104 214 L95 222 Z" />
        <line x1="108" y1="112" x2="172" y2="112" /><line x1="108" y1="126" x2="160" y2="126" /><line x1="108" y1="140" x2="168" y2="140" /><line x1="108" y1="154" x2="150" y2="154" />
      </g>
      <g className="coin coin-a"><circle cx="108" cy="50" r="16" /><circle cx="108" cy="50" r="9" className="inner" /></g>
      <g className="coin coin-b"><circle cx="172" cy="50" r="16" /><circle cx="172" cy="50" r="9" className="inner" /></g>
      <g className="puff"><circle cx="164" cy="42" r="6" /><circle cx="181" cy="46" r="5" /><circle cx="171" cy="60" r="7" /></g>
      <text className="twice" x="140" y="16">counted twice</text>
      <g className="stamp"><circle cx="140" cy="176" r="28" /><text x="140" y="180">Checked</text></g>
      <g className="glass">
        <g className="glass-body">
          <line x1="232" y1="118" x2="252" y2="140" className="handle" />
          <circle cx="216" cy="102" r="22" className="lens" />
          <g className="eyes"><circle cx="209" cy="100" r="3" /><circle cx="223" cy="100" r="3" /></g>
        </g>
      </g>
    </svg>
  );
}
