import { useEffect, useState } from 'react';
import type { Actor } from '../shared/policy.ts';

type Person = Actor & { credential?: string | null };
type Meta = { firm: string; client: string; return: string; extended?: string };

// One plain line per role: what this person can do here. The server enforces all of it.
const CAN: Record<string, string> = {
  preparer: 'Prepares and verifies lines; can\'t sign off on areas they prepared.',
  reviewer: 'Reviews the work, writes review notes that block filing, and signs off on areas they did not prepare.',
  partner: 'Approves adjustments over 1,000, clears any review note, and signs off last.',
  firm_administrator: 'Resets the demo and reads the view log; cannot change the return.',
  quality_reviewer: 'Reviews returns after filing.',
  client: 'Answers questions from the firm and sees their own documents; nothing internal.',
};
const ROLE: Record<string, string> = { preparer: 'Preparer', reviewer: 'Reviewer', partner: 'Partner', firm_administrator: 'Firm administrator', quality_reviewer: 'Quality reviewer', client: 'Client' };
const longDate = (d: string) => new Date(d + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

export function signInAs(id: string | null) {
  try { id ? localStorage.setItem('user', id) : localStorage.removeItem('user'); } catch {}
  location.hash = '';
  location.reload();
}

export function SignIn({ people }: { people: Person[] }) {
  const [meta, setMeta] = useState<Meta | null>(null);
  useEffect(() => { fetch('/api/meta').then(r => r.json()).then(setMeta); }, []);
  const today = new Date().toISOString().slice(0, 10);
  const row = (p: Person) => {
    const notYet = p.active_from && p.active_from > today;
    return (
      <li key={p.id}>
        <button onClick={() => signInAs(p.id)}>
          <span className="who"><strong>{p.name}</strong><span className="muted">{ROLE[p.role] ?? p.role}{p.credential ? `, ${p.credential}` : ''}</span></span>
          <span className="can">{notYet ? `Starts ${longDate(p.active_from!)}; can read the return but not act on it yet.` : CAN[p.role]}{p.role !== 'client' && !p.sensitive_data_clearance ? ' SSNs and account numbers stay masked.' : ''}</span>
          {p.role !== 'client' && p.sensitive_data_clearance && !notYet && <span className="badge">Sees unmasked SSNs</span>}
        </button>
      </li>
    );
  };
  return (
    <main className="signin">
      <section className="signin-story" aria-label="What this workpaper does">
        <ProofLoop />
        <p className="signin-line">Every number, traced to the page it came from.</p>
      </section>
      <section className="signin-people">
        <p className="muted">{meta?.firm ?? 'Miraflores'}</p>
        <h1>{meta?.client ?? 'Loading the return…'}</h1>
        {meta && <p className="signin-return">{meta.return[0].toUpperCase() + meta.return.slice(1)}{meta.extended ? <span className="muted">, extended due date {longDate(meta.extended)}</span> : null}</p>}
        <h2>Firm</h2>
        <ul className="people">{people.filter(p => p.role !== 'client').map(row)}</ul>
        <h2>Client</h2>
        <ul className="people">{people.filter(p => p.role === 'client').map(row)}</ul>
        <p className="muted signin-note">No passwords in this demo: choose a person to see the return as they would. The server checks every action against that person's role.</p>
      </section>
    </main>
  );
}

// The product in eight seconds: a field traced and verified, then a field that breaks the thread.
// Base styles are the final frame; the keyframes only run when motion is allowed.
function ProofLoop() {
  return (
    <svg className="loop" viewBox="0 0 640 430" role="img" aria-label="A W-2 field is traced to the Wages line, which becomes Verified. A 1099-B lot with zero basis breaks its thread in red; the fix reads: supplemental statement gives 19,100.">
      {/* W-2 page */}
      <g className="page">
        <rect x="30" y="30" width="250" height="170" rx="2" />
        <text x="50" y="62" className="doc-title">Form W-2  2025</text>
        <text x="50" y="84" className="doc-text">Corvane Systems, Inc.</text>
        <rect className="hl hl-1" x="44" y="100" width="222" height="26" rx="2" />
        <text x="50" y="118" className="doc-text">Box 1</text><text x="258" y="118" className="doc-text num-end">104,600.00</text>
        <text x="50" y="146" className="doc-text faint">Box 2</text><text x="258" y="146" className="doc-text faint num-end">15,800.00</text>
        <text x="50" y="174" className="doc-text faint">Box 5</text><text x="258" y="174" className="doc-text faint num-end">112,000.00</text>
      </g>
      {/* 1099-B page */}
      <g className="page">
        <rect x="30" y="230" width="250" height="170" rx="2" />
        <text x="50" y="262" className="doc-title">Form 1099-B  2025</text>
        <text x="50" y="284" className="doc-text">Lot N1, Corvane RSU</text>
        <text x="50" y="314" className="doc-text faint">Proceeds</text><text x="258" y="314" className="doc-text faint num-end">19,240.00</text>
        <rect className="hl hl-2" x="44" y="326" width="222" height="26" rx="2" />
        <text x="50" y="344" className="doc-text">Basis</text><text x="258" y="344" className="doc-text num-end">0.00</text>
      </g>
      {/* return lines */}
      <g className="line-card">
        <rect x="380" y="72" width="230" height="62" rx="2" />
        <text x="420" y="96" className="ui-small">Form 1040 line 1a</text>
        <text x="420" y="120" className="ui">Wages</text><text x="596" y="120" className="ui num-end strong">212,400</text>
        <circle className="st-open" cx="400" cy="103" r="7" />
        <g className="st-ok"><circle cx="400" cy="103" r="8" /><path d="M396 103 L399 106 L404.5 99.5" /></g>
      </g>
      <g className="line-card">
        <rect x="380" y="272" width="230" height="62" rx="2" />
        <text x="420" y="296" className="ui-small">Form 8949 box B, lot N1</text>
        <text x="420" y="320" className="ui">Short-term sale</text><text x="596" y="320" className="ui num-end strong">19,240</text>
        <circle className="st-open-2" cx="400" cy="303" r="7" />
        <g className="st-bad"><rect x="392" y="295" width="16" height="16" rx="1" /><path d="M396.5 299.5 L403.5 306.5 M403.5 299.5 L396.5 306.5" /></g>
      </g>
      {/* threads */}
      <path className="thread t1" d="M266 113 C 320 113, 330 103, 380 103" pathLength={1} />
      <path className="thread t2a" d="M266 339 C 300 339, 312 330, 322 322" pathLength={1} />
      <path className="thread t2b" d="M334 314 C 350 305, 360 303, 380 303" />
      <path className="break" d="M318 312 L340 324" />
      <text x="380" y="366" className="fix">Supplemental statement gives 19,100</text>
    </svg>
  );
}
