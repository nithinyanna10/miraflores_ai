import { useState } from 'react';
import { fmt, type Graph } from '../shared/packet.ts';
import { can, currentSignoffs } from '../shared/policy.ts';
import { StatusMark } from './StatusMark.tsx';
import { post, type Workpaper } from './data.ts';
import { useSession } from './Actions.tsx';
import type { AreaInfo } from './Outline.tsx';

// Budget areas (firm.budget_hours) mapped to the outline areas they cover.
const COVERS: Record<string, string[]> = {
  intake_and_engagement: [],
  wages_and_stock_compensation: ['Wages'],
  investments_and_digital_assets: ['Interest and dividends', 'Capital gains', 'Foreign accounts'],
  business: ['Business'],
  rentals_and_sale: ['Rentals and sale'],
  pass_throughs_and_basis: ['K-1s and basis'],
  deductions_and_credits: ['Deductions and credits', 'Retirement and HSA'],
  california: ['California'],
  partner_review: ['Tax and payments'],
};
const nice = (k: string) => k.replace(/_/g, ' ').replace(/^\w/, c => c.toUpperCase());
const when = (at: string) => new Date(at).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });

export function FirmView({ g, w, areas, onLine }: { g: Graph; w: Workpaper; areas: AreaInfo[]; onLine: (k: string) => void }) {
  const { me, people } = useSession();
  const [hours, setHours] = useState('');
  const [area, setArea] = useState('investments_and_digital_assets');
  const [error, setError] = useState<string | null>(null);
  const budget = g.P.firm.budget_hours as Record<string, number>;
  const name = (id: string) => people.find(p => p.id === id)?.name ?? id;
  const time = w.events.filter(e => e.type === 'time_logged');
  const logged = (a: string) => time.filter(e => e.payload.area === a).reduce((s, e) => s + Number(e.payload.hours), 0);
  const start = g.P.firm.assignment_at_start;
  const assignedTo = (a: string) => w.events.filter(e => e.type === 'assigned' && e.payload.area === a).at(-1)?.payload.person ?? start.preparer;
  const signoffs = currentSignoffs(w.events, g);
  const levelOf = (covered: string[]) => {
    if (!covered.length) return '';
    const lv = (lvl: string) => covered.every(a => signoffs.some(s => s.scope === `area:${a}` && s.level === lvl && !s.reopened));
    const reopened = covered.some(a => signoffs.some(s => s.scope === `area:${a}` && s.reopened));
    return reopened ? 'Reopened' : lv('partner') ? 'Partner' : lv('reviewer') ? 'Reviewer' : lv('preparer') ? 'Preparer' : 'Not signed';
  };
  const totalB = Object.values(budget).reduce((a, b) => a + b, 0), totalL = Object.keys(budget).reduce((a, k) => a + logged(k), 0);
  const today = new Date().toISOString().slice(0, 10);
  const days = (d: string) => Math.round((Date.parse(d) - Date.parse(today)) / 864e5);
  const views = w.events.filter(e => e.type.startsWith('sensitive_view'));
  const seesLog = me && ['firm_administrator', 'partner'].includes(me.role);

  return (
    <article className="firm">
      <h1>Firm</h1>
      <section>
        <h2>Work by area</h2>
        <table className="ledger compact">
          <thead><tr><th>Area</th><th>Preparer</th><th className="num">Open</th><th className="num">Verified</th><th>Signed to</th><th className="num">Budget h</th><th className="num">Logged h</th><th className="num">Over</th></tr></thead>
          <tbody>{Object.keys(budget).map(k => {
            const cov = areas.filter(a => COVERS[k]?.includes(a.area));
            const open = cov.reduce((s, a) => s + a.open, 0), ver = cov.reduce((s, a) => s + a.verified, 0), rev = cov.reduce((s, a) => s + a.reviewable, 0);
            const over = logged(k) - budget[k];
            return (
              <tr key={k}>
                <th scope="row">{nice(k)}{cov.length ? <span className="muted"> ({cov.map(a => a.area).join(', ')})</span> : ''}</th>
                <td>{name(assignedTo(k))}</td>
                <td className="num">{cov.length ? open : ''}</td>
                <td className="num">{cov.length ? `${ver}/${rev}` : ''}</td>
                <td>{levelOf(cov.map(a => a.area))}</td>
                <td className="num">{budget[k].toFixed(1)}</td>
                <td className="num">{logged(k).toFixed(1)}</td>
                <td className={`num${over > 0 ? ' warn' : ''}`}>{over > 0 ? `+${over.toFixed(1)}` : ''}</td>
              </tr>
            );
          })}
            <tr><th scope="row"><strong>Total</strong></th><td /><td /><td /><td /><td className="num"><strong>{totalB.toFixed(1)}</strong></td><td className="num"><strong>{totalL.toFixed(1)}</strong></td><td className={`num${totalL > totalB ? ' warn' : ''}`}>{totalL > totalB ? `+${(totalL - totalB).toFixed(1)}` : ''}</td></tr>
          </tbody>
        </table>
        {can(me, 'time_logged') && (
          <div className="action-row">
            <select value={area} onChange={e => setArea(e.target.value)} aria-label="Area">{Object.keys(budget).map(k => <option key={k} value={k}>{nice(k)}</option>)}</select>
            <input aria-label="Hours" inputMode="decimal" placeholder="Hours" value={hours} onChange={e => setHours(e.target.value)} style={{ maxWidth: 90 }} />
            <button className="btn quiet" disabled={!Number(hours)} onClick={async () => { const x = await post(me!.id, 'time_logged', ['area:Whole return'], { area, hours: Number(hours) }); setError(x); if (!x) setHours(''); }}>Log time</button>
            {can(me, 'assigned') && <AssignControl g={g} area={area} />}
          </div>
        )}
        {error && <p className="warn">{error}</p>}
      </section>

      <section>
        <h2>Deadlines</h2>
        <table className="ledger compact"><tbody>{g.P.firm.deadlines.map((d: any) => {
          const n = days(d.date);
          return <tr key={d.what}><th scope="row">{d.what}</th><td className="num">{d.date}</td><td className={n < 0 ? 'muted' : n <= 7 ? 'warn' : ''}>{n < 0 ? `${-n} ${n === -1 ? 'day' : 'days'} ago` : n === 0 ? 'today' : n === 1 ? 'tomorrow' : `in ${n} days`}</td></tr>;
        })}</tbody></table>
      </section>

      <section>
        <h2>Who saw unmasked SSNs and account numbers</h2>
        {!seesLog ? <p className="muted">The view log is for the firm administrator and the partner.</p> : views.length === 0 ? <p className="muted">Nobody has unmasked anything yet.</p> : (
          <table className="ledger compact"><thead><tr><th>When</th><th>Who</th><th>What</th><th>Result</th></tr></thead>
            <tbody>{views.map(e => {
              const n = g.resolve(e.refs[0]);
              return <tr key={e.seq}><td>{when(e.at)}</td><td>{name(e.actor)}, {people.find(p => p.id === e.actor)?.role.replace(/_/g, ' ')}</td><td>{n.title}</td><td className={e.type === 'sensitive_view_refused' ? 'warn' : ''}>{e.type === 'sensitive_view_refused' ? 'Refused: no clearance' : 'Shown'}</td></tr>;
            })}</tbody>
          </table>
        )}
      </section>
    </article>
  );
}

function AssignControl({ g, area }: { g: Graph; area: string }) {
  const { me } = useSession();
  const [person, setPerson] = useState('st-04');
  const staff = g.P.firm.staff.filter((s: any) => ['preparer', 'reviewer', 'partner'].includes(s.role));
  return (
    <>
      <select value={person} onChange={e => setPerson(e.target.value)} aria-label="Assign to">{staff.map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
      <button className="btn quiet" onClick={() => post(me!.id, 'assigned', ['area:Whole return'], { area, person })}>Assign {area.replace(/_/g, ' ')}</button>
    </>
  );
}
