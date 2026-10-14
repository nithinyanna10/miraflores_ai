import { useState } from 'react';
import { fmt, isLot, labelMaker, type Graph, type Line } from '../shared/packet.ts';
import { StatusMark } from './StatusMark.tsx';
import type { Workpaper } from './data.ts';
import { BOX_NAMES } from './Outline.tsx';

// The records a CPA expects, each computed from the packet plus live adjustments, each with a stated tie-out.
type R = { g: Graph; w: Workpaper; onLine: (k: string) => void };
const RECORDS: [string, string, (r: R) => JSX.Element][] = [
  ['summary', 'Return summary vs 2024', Summary],
  ['depreciation', 'Depreciation by asset', Depreciation],
  ['sales', 'Sales detail', Sales],
  ['books', 'Books to tax (Schedule C)', BooksToTax],
  ['rentals', 'Rentals and passive losses', Rentals],
  ['k1', 'K-1s', K1s],
  ['state', 'State split (CA / TX)', StateSplit],
  ['carryovers', 'Carryovers', Carryovers],
  ['basis', 'Basis by year', Basis],
  ['prior', 'Prior preparer vs us', PriorVsUs],
];

export function Records({ g, w, onLine, which, onPick }: R & { which?: string; onPick: (id: string) => void }) {
  const cur = RECORDS.find(r => r[0] === which) ?? RECORDS[0];
  const Body = cur[2];
  return (
    <article className="records">
      <nav className="records-nav" aria-label="Records">
        <h1>Records</h1>
        {RECORDS.map(([id, title]) => <button key={id} aria-current={id === cur[0]} onClick={() => onPick(id)}>{title}</button>)}
      </nav>
      <section className="record-body">
        <h2>{cur[1]}</h2>
        <Body g={g} w={w} onLine={onLine} />
      </section>
    </article>
  );
}

// ---------- shared bits ----------
const N = ({ k, r, cents = false }: { k: string; r: R; cents?: boolean }) => {
  const l = r.g.line(k);
  if (!l) return <span className="muted">none</span>;
  const adj = r.w.adjustments![k];
  return <button className={`num link-num${adj ? ' adjusted' : ''}`} onClick={() => r.onLine(k)} title={adj ? `Adjusted from ${fmt(l.value, cents)}` : l.label}>{fmt(r.w.value!(k), cents)}</button>;
};
function Tie({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return <p className={`tie${ok ? '' : ' no'}`}><StatusMark status={ok ? 'Verified' : 'Blocked'} /> <span>{children}</span></p>;
}
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const near = (a: number, b: number, tol = 1) => Math.abs(a - b) <= tol;

// ---------- 1. summary vs 2024 ----------
function Summary(r: R) {
  const { g, w } = r;
  const py = g.P.prior_years.return_2024;
  const label = labelMaker(Object.values(g.lines.v3));
  const keys = Object.keys(py.lines).filter(k => g.line(k) && typeof py.lines[k] === 'number' && /^(F1040|Sch1|SchC\.(1|28|31)$|SchD\.(7|15|16)$|SchE\.(21A|21B|26|32|41)$)/.test(k));
  const variance = (k: string) => w.allFindings!.find(f => f.check === 'prior_year_variance' && f.lines[0] === k);
  return (
    <>
      <p className="muted">2024 as filed by the prior preparer (D06) against 2025 as it now stands. A change over the firm threshold (10% and 1,000) needs an explanation.</p>
      <table className="ledger compact"><thead><tr><th /><th className="num">2024</th><th className="num">2025</th><th className="num">Change</th><th>Explanation</th></tr></thead>
        <tbody>{keys.map(k => {
          const v = variance(k), ex = v && w.explainedBy![v.id];
          return (
            <tr key={k}>
              <th scope="row">{label(g.line(k)!)}</th><td className="num muted">{fmt(py.lines[k])}</td><td className="num"><N k={k} r={r} /></td>
              <td className="num muted">{fmt(w.value!(k) - py.lines[k])}</td>
              <td>{!v ? <span className="muted">Under threshold</span> : ex ? <span className="memo small-memo">{ex.reason}</span> : <span className="warn">Needs an explanation</span>}</td>
            </tr>
          );
        })}</tbody>
      </table>
    </>
  );
}

// ---------- 2. depreciation by asset ----------
function Depreciation(r: R) {
  const { g } = r;
  const v3 = g.P.return_versions.find((v: any) => v.version === 'v3');
  const groups: Record<string, any[]> = {};
  for (const a of v3.assets) (groups[a.activity] ??= []).push(a);
  const ties: [string, string, number][] = [
    ['Rental: 1450 Fremont Way, Sacramento', 'F4562-E.total-A', 0], ['Rental: 1200 Barton Hills Dr Unit 4C, Austin', 'F4562-E.total-B', 0], ['Business: Lindqvist Studio', 'F4562-C.22', 0],
  ];
  return (
    <>
      <p className="muted">From the asset records (prior years) and v3's 2025 depreciation. California does not allow federal bonus depreciation, so the studio equipment and the 2021 appliances differ.</p>
      {Object.entries(groups).map(([act, as]) => {
        const fed = sum(as.map(a => a.federal.depreciation_2025)), ca = sum(as.map(a => a.california.depreciation_2025));
        const tie = ties.find(t => t[0] === act);
        return (
          <section key={act} className="record-group">
            <h3>{act}</h3>
            <table className="ledger compact"><thead><tr><th>Asset</th><th>In service</th><th>Method</th><th className="num">Cost</th><th className="num">Federal 2025</th><th className="num">Federal total</th><th className="num">CA 2025</th><th className="num">CA total</th><th className="num">AMT diff.</th></tr></thead>
              <tbody>{as.map(a => (
                <tr key={a.asset_id}><th scope="row">{a.description.replace(/^.* - /, '')}{a.disposed ? <span className="muted"> (sold {a.disposed})</span> : ''}</th><td className="nowrap">{a.placed_in_service}</td><td className="muted method">{a.method}</td><td className="num">{fmt(a.cost)}</td><td className="num">{fmt(a.federal.depreciation_2025, true)}</td><td className="num muted">{fmt(a.federal.accumulated_end, true)}</td><td className="num">{fmt(a.california.depreciation_2025, true)}</td><td className="num muted">{fmt(a.california.accumulated_end, true)}</td><td className="num muted">{fmt(a.amt.difference_from_regular, true)}</td></tr>
              ))}</tbody>
            </table>
            {tie && <Tie ok={near(fed, g.line(tie[1])!.value)}>Federal 2025 {fmt(fed, true)} = <N k={tie[1]} r={r} /> on {g.line(tie[1])!.label.toLowerCase()}. California {fmt(ca, true)}.</Tie>}
          </section>
        );
      })}
    </>
  );
}

// ---------- 3. sales detail ----------
function Sales(r: R) {
  const { g, w } = r;
  const [open, setOpen] = useState<string | null>(null);
  const lots = Object.values(g.lines.v3).filter(l => isLot(l.key));
  const parse = (l: Line) => { const m = l.label.match(/proceeds (\d[\d,]*(?:\.\d+)?), basis (\d[\d,]*(?:\.\d+)?)(?:, adjustment \w (-?\d[\d,]*(?:\.\d+)?))?/); const n = (s?: string) => Number((s ?? '0').replace(/,/g, '')); return m ? { p: n(m[1]), b: n(m[2]), a: n(m[3]) } : { p: 0, b: 0, a: 0 }; };
  const docOf = (l: Line) => l.sources.map(s => g.evs[s]?.document_id).find(Boolean) ?? 'K-1 / S corporation';
  const groups: Record<string, Line[]> = {};
  for (const l of lots) (groups[`${l.key.split('.')[1]}|${docOf(l)}`] ??= []).push(l);
  const ev = (doc: string, field: string) => g.evsByDoc[doc]?.find(e => e.field === field)?.value;
  const brokerTies: [string, number | undefined, number][] = [
    ['D74 Brightpath Advisors', (ev('D74', 'st_proceeds') ?? 0) + (ev('D74', 'lt_proceeds') ?? 0), sum(lots.filter(l => docOf(l) === 'D74').map(l => parse(l).p))],
    ['D31 Meridian Brokerage (corrected)', ev('D31', 'b_summary_proceeds'), sum(lots.filter(l => docOf(l) === 'D31').map(l => parse(l).p))],
    ['D34 Coinhaven 1099-DA', ev('D34', 'total'), sum(lots.filter(l => docOf(l) === 'D34').map(l => parse(l).p))],
  ];
  return (
    <>
      <p className="muted">{lots.length} sales on Form 8949, rolled up by box and broker. Lots with open items or adjustments are listed; open a rollup for every lot.</p>
      <table className="ledger compact"><thead><tr><th>Box and broker</th><th className="num">Sales</th><th className="num">Proceeds</th><th className="num">Basis</th><th className="num">Adjustments</th><th className="num">Gain as filed</th><th className="num">Gain now</th></tr></thead>
        <tbody>{Object.entries(groups).sort().map(([key, ls]) => {
          const [box, doc] = key.split('|');
          const ps = ls.map(parse);
          const exceptions = ls.filter(l => w.byLine![l.key]?.length || w.adjustments![l.key]);
          const shown = open === key ? ls : exceptions;
          return [
            <tr key={key} className="rollup"><th scope="row"><button onClick={() => setOpen(open === key ? null : key)}>Box {box} ({BOX_NAMES[box]?.toLowerCase()}), {g.docs[doc]?.issuer ?? doc}</button></th>
              <td className="num">{ls.length}</td><td className="num">{fmt(sum(ps.map(p => p.p)), true)}</td><td className="num">{fmt(sum(ps.map(p => p.b)), true)}</td><td className="num">{fmt(sum(ps.map(p => p.a)), true)}</td><td className="num">{fmt(sum(ls.map(l => l.value)), true)}</td><td className="num">{fmt(sum(ls.map(l => w.value!(l.key))), true)}</td></tr>,
            ...shown.map(l => (
              <tr key={l.key} className="lot"><th scope="row"><StatusMark status={w.own!(l.key)} /> {l.label.replace(/ \(acquired.*$/, '')}, lot {l.key.split('.').pop()}</th><td /><td className="num">{fmt(parse(l).p, true)}</td><td className="num">{fmt(parse(l).b, true)}</td><td className="num">{fmt(parse(l).a, true)}</td><td className="num muted">{fmt(l.value, true)}</td><td className="num"><N k={l.key} r={r} cents /></td></tr>
            )),
          ];
        })}</tbody>
      </table>
      {brokerTies.map(([name, summary, lotSum]) => summary != null && (
        <Tie key={name} ok={near(summary, lotSum, 0.01)}>{name}: broker summary proceeds {fmt(summary, true)} {near(summary, lotSum, 0.01) ? '=' : '≠'} lots on the return {fmt(lotSum, true)}{near(summary, lotSum, 0.01) ? '' : `; ${fmt(summary - lotSum, true)} missing (see the open item on the unextracted page)`}.</Tie>
      ))}
    </>
  );
}

// ---------- 4. books to tax ----------
function BooksToTax(r: R) {
  const { g, w } = r;
  const b = (field: string) => g.evsByDoc.D14.find(e => e.field === field)?.value ?? 0;
  // Reconcile to the engine's values (which must tie exactly), then show what adjustments change.
  const e = (k: string) => g.line(k)!.value;
  const v = (k: string) => w.value!(k);
  const booksNet = b('net_income');
  // Each reconciling item: books amount, tax amount, and its effect on net income (tax minus books, signed for profit).
  const items: [string, number, number, string][] = [
    ['Gross receipts (books revenue vs Schedule C line 1)', b('total_income'), e('SchC.1'), 'SchC.1'],
    ['Car and truck: actual fuel replaced by standard mileage', b('Car and truck - fuel'), e('SchC.9'), 'SchC.9'],
    ['Depreciation: books straight-line vs 100% special depreciation', b('Depreciation'), e('SchC.13'), 'SchC.13'],
    ['Health insurance (Erik): moved to Schedule 1 line 17', b('Insurance - health (Erik)'), 0, 'Sch1.17'],
    ['Meals: 50% limit', b('Meals'), e('SchC.24b'), 'SchC.24b'],
    ['Telephone and internet', b('Telephone') + b('Internet'), e('SchC.25'), 'SchC.25'],
    ['Software and subscriptions', b('Software and subscriptions'), e('SchC.27a.1'), 'SchC.27a.1'],
    ['Home office (not in books)', 0, e('SchC.30'), 'SchC.30'],
  ];
  const effect = (i: number) => (i === 0 ? items[0][2] - items[0][1] : items[i][1] - items[i][2]);
  const total = booksNet + sum(items.map((_, i) => effect(i)));
  const unchanged: [string, string][] = [['Advertising', 'SchC.8'], ['Bank and merchant fees', 'SchC.27a.2'], ['Contract labor', 'SchC.11'], ['Insurance - business liability', 'SchC.15'], ['Legal and professional', 'SchC.17'], ['Office expenses', 'SchC.18'], ['Supplies', 'SchC.22'], ['Travel', 'SchC.24a']];
  const diffs = unchanged.filter(([f, k]) => !near(b(f), e(k)));
  // Adjustments on Schedule C lines change profit by (income change) - (expense change).
  const schcAdj = Object.values(w.adjustments!).filter(a => /^SchC\./.test(a.refs[0]));
  const profitDelta = sum(schcAdj.map(a => (a.refs[0] === 'SchC.1' ? 1 : -1) * (a.payload.to - a.payload.from)));
  return (
    <>
      <p className="muted">QuickBooks profit and loss (D14, cash basis) to Schedule C net profit, item by item.</p>
      <table className="ledger compact"><thead><tr><th /><th className="num">Books</th><th className="num">Tax</th><th className="num">Effect on profit</th></tr></thead>
        <tbody>
          <tr><th scope="row"><strong>Net income per books</strong></th><td className="num">{fmt(booksNet)}</td><td /><td /></tr>
          {items.map(([lab, bk, tx, k], i) => <tr key={lab}><th scope="row"><button onClick={() => r.onLine(k)}>{lab}</button></th><td className="num muted">{fmt(bk)}</td><td className="num">{fmt(tx)}</td><td className="num">{fmt(effect(i))}</td></tr>)}
          <tr><th scope="row"><strong>Net profit, Schedule C line 31</strong></th><td /><td /><td className="num"><strong>{fmt(total)}</strong></td></tr>
        </tbody>
      </table>
      <Tie ok={near(total, e('SchC.31'))}>Books {fmt(booksNet)} plus reconciling items = {fmt(total)} = Schedule C line 31 as the engine computed it, <N k="SchC.31" r={r} />.</Tie>
      {schcAdj.length > 0 && <p className="adjusted-note"><StatusMark status="Adjusted" /> <span>{schcAdj.length} Schedule C {schcAdj.length === 1 ? 'adjustment changes' : 'adjustments change'} profit by {fmt(profitDelta)} ({schcAdj.map(a => a.payload.finding ?? a.refs[0]).join(', ')}), to an estimated {fmt(total + profitDelta)}. Line 31 is not recomputed (the engine cannot be rerun); the SEP and SE health insurance limits are flagged "needs recompute".</span></p>}
      <Tie ok={diffs.length === 0}>{diffs.length ? `Books and tax differ on: ${diffs.map(d => d[0]).join(', ')}` : `The other ${unchanged.length} expense lines carry from books unchanged.`}</Tie>
    </>
  );
}

// ---------- 5. rentals and passive losses ----------
function Rentals(r: R) {
  const { g } = r;
  const py = g.P.prior_years.carryovers_into_2025;
  const rows: [string, string][] = [['Rents received', '3'], ['Insurance', '9'], ['Management fees', '11'], ['Mortgage interest', '12'], ['Repairs', '14'], ['Taxes', '16'], ['Depreciation', '18'], ['Other (HOA)', '19'], ['Total expenses', '20'], ['Income or (loss)', '21'], ['Allowed after Form 8582', '22']];
  const cell = (row: string, p: 'A' | 'B') => (g.line(`SchE.${row}${p}`) ? <N k={`SchE.${row}${p}`} r={r} /> : <span className="muted">none</span>);
  const tieA = g.line('SchE.21A')!.value === g.line('SchE.3A')!.value - g.line('SchE.20A')!.value;
  const tieB = g.line('SchE.21B')!.value === g.line('SchE.3B')!.value - g.line('SchE.20B')!.value;
  return (
    <>
      <table className="ledger compact"><thead><tr><th /><th className="num">1450 Fremont Way</th><th className="num">1200 Barton Hills 4C</th></tr></thead>
        <tbody>
          {rows.map(([lab, row]) => <tr key={row}><th scope="row">{lab}</th><td className="num">{cell(row, 'A')}</td><td className="num">{cell(row, 'B')}</td></tr>)}
          <tr><th scope="row">Suspended losses from 2024 released</th><td className="num">{fmt(py.passive_1450_fremont)}</td><td className="num">{fmt(py.passive_1200_barton_hills)}</td></tr>
        </tbody>
      </table>
      <Tie ok={tieA && tieB}>Each property: income or loss = rents minus total expenses.</Tie>
      <p>The Austin condo was sold on 2025-10-15: Form 4797 gain <N k="F4797.25" r={r} />, of which unrecaptured section 1250 gain <N k="SchD.19" r={r} />. A fully taxable disposition frees that activity's suspended losses, and net passive income (<N k="F8582.4" r={r} />) allows all current and prior losses.</p>
      <p className="muted">Repairs at Fremont include the 11,000 HVAC replacement the audit questions as an improvement; see the what-if.</p>
    </>
  );
}

// ---------- 6. K-1s ----------
function K1s(r: R) {
  const { g } = r;
  const label = labelMaker(Object.values(g.lines.v3));
  const docs = ['D39', 'D37', 'D38'];
  return (
    <>
      {docs.map(d => (
        <section key={d} className="record-group">
          <h3>{g.docs[d].title}</h3>
          <table className="ledger compact"><tbody>
            {g.evsByDoc[d].map(e => {
              const lands = Object.values(g.lines.v3).filter(l => l.sources.includes(e.id));
              return <tr key={e.id}><th scope="row">{e.label}</th><td className="num">{fmt(e.value)}</td><td>{lands.length ? lands.map(l => <button key={l.key} className="link" onClick={() => r.onLine(l.key)}>{label(l)}</button>) : <span className="muted">Not on a return line</span>}</td></tr>;
            })}
          </tbody></table>
        </section>
      ))}
      <p className="muted">Woodworks: Oregon composite tax 1,580 was paid on Erik's behalf and is inside the distributions; California's Schedule S credit uses it. Ridgeline: the partnership's rental activity is not a trade or business, so no QBI.</p>
    </>
  );
}

// ---------- 7. state split ----------
function StateSplit(r: R) {
  const { g, w } = r;
  const rows: [string, string][] = [['1', 'Wages'], ['2', 'Taxable interest'], ['3', 'Ordinary dividends'], ['4', 'IRA distributions'], ['7', 'Capital gain'], ['12', 'Business income'], ['17', 'Rentals, partnerships, S corporations'], ['22', 'Total income'], ['26', 'Adjustments to income']];
  const c = (row: string, col: string) => (g.line(`SchCA540NR.${row}.${col}`) ? <N k={`SchCA540NR.${row}.${col}`} r={r} /> : '');
  const P = g.P.engine_reference.parameters;
  const caOpen = w.findings!.filter(f => f.lines.some(k => /^(SchCA540NR|F540NR)/.test(k)) && f.severity === 'error');
  return (
    <>
      <p className="muted">California resident {g.P.household.residency[0].from} to {g.P.household.residency[0].to} ({P.ca_resident_days} of {P.year_days} days), Texas resident after. Column E is the California-source amount; Texas has no income tax.</p>
      <table className="ledger compact"><thead><tr><th /><th className="num">A Federal</th><th className="num">B Subtract</th><th className="num">C Add</th><th className="num">D CA law</th><th className="num">E CA source</th></tr></thead>
        <tbody>{rows.map(([n, lab]) => <tr key={n}><th scope="row">{lab}</th><td className="num">{c(n, 'A')}</td><td className="num">{c(n, 'B')}</td><td className="num">{c(n, 'C')}</td><td className="num">{c(n, 'D')}</td><td className="num">{c(n, 'E')}</td></tr>)}</tbody>
      </table>
      <table className="ledger compact"><tbody>
        {[['F540NR.17', 'Total AGI under California law'], ['F540NR.32', 'California AGI'], ['F540NR.34', 'California share (line 32 / 17)'], ['F540NR.35', 'California taxable income'], ['F540NR.64', 'California total tax'], ['F540NR.78', 'Payments'], ['F540NR.97', 'Overpaid']].map(([k, lab]) => <tr key={k}><th scope="row">{lab}</th><td className="num"><N k={k} r={r} /></td></tr>)}
      </tbody></table>
      <Tie ok={near(Number(g.line('F540NR.34')!.value), g.line('F540NR.32')!.value / g.line('F540NR.17')!.value, 0.0001)}>California share {g.line('F540NR.34')!.value} = California AGI / total AGI.</Tie>
      {caOpen.length > 0 && <Tie ok={false}>{caOpen.length} California errors open: {caOpen.map(f => f.title).join('; ')}.</Tie>}
    </>
  );
}

// ---------- 8. carryovers ----------
function Carryovers(r: R) {
  const { g } = r;
  const into = g.P.prior_years.carryovers_into_2025;
  const out = g.P.return_versions.find((v: any) => v.version === 'v3').carryovers_out;
  const rows: [string, number | string, string, number | string][] = [
    ['Capital loss, short-term', into.capital_loss_short, 'SchD.6', out.federal.capital_loss_short],
    ['Capital loss, long-term', into.capital_loss_long, 'SchD.14', out.federal.capital_loss_long],
    ['Suspended passive loss, 1450 Fremont Way', into.passive_1450_fremont, 'SchE.22A', out.federal.passive_1450_fremont],
    ['Suspended passive loss, 1200 Barton Hills 4C', into.passive_1200_barton_hills, 'SchE.22B', out.federal.passive_1200_barton_hills],
    ['IRA nondeductible basis (Ngozi)', g.P.prior_years.basis_records.ira_nondeductible_basis_ngozi[0].form_8606_line_14, 'F8606.2', out.federal.ira_nondeductible_basis_ngozi],
    ['Minimum tax credit', into.amt_credit, 'F6251.11', out.federal.minimum_tax_credit_from_2025_amt],
    ['SEP contribution not deductible', 0, 'Sch1.16', out.federal.sep_contribution_not_deductible_for_2025],
  ];
  return (
    <>
      <table className="ledger compact"><thead><tr><th /><th className="num">From 2024</th><th>Used on</th><th className="num">To 2026</th></tr></thead>
        <tbody>{rows.map(([lab, i, k, o]) => <tr key={lab}><th scope="row">{lab}</th><td className="num">{fmt(i)}</td><td><button className="link" onClick={() => r.onLine(k)}>{g.line(k)?.label}</button></td><td className="num">{fmt(o)}</td></tr>)}</tbody>
      </table>
      <p className="muted">California: same capital loss and passive carryovers; depreciation basis differences to 2026: {Object.entries(out.california.depreciation_basis_differences).map(([k, v]) => `${k} ${fmt(v as number)}`).join(', ')}.</p>
      <Tie ok={g.line('SchD.6')!.value === -into.capital_loss_short && g.line('SchD.14')!.value === -into.capital_loss_long}>Capital loss carryovers used = 2024 carryover worksheet (D07 p6) = recomputed from the 2024 return by the audit.</Tie>
    </>
  );
}

// ---------- 9. basis by year ----------
function Basis(r: R) {
  const { g } = r;
  const rec = g.P.prior_years.basis_records;
  const k23 = Object.fromEntries(g.evsByDoc.D40.map(e => [e.field, e.value]));
  const k24 = g.P.prior_years.return_2024.K1_1120S;
  const k25 = Object.fromEntries(g.evsByDoc.D39.map(e => [e.field, e.value]));
  const b22 = rec.scorp_lindqvist_family_woodworks[0].ending_stock_basis;
  const b23 = b22 + k23.box1 + (k23.box4 ?? 0) - k23.box16d;
  const b24 = b23 + k24.box1 - k24.box16D;
  const before25 = b24 + k25.box1 + k25.box4;
  const rows: [string, number, number, number, number, string][] = [
    ['2022', NaN, NaN, NaN, b22, 'client worksheet in the prior file; no K-1'],
    ['2023', k23.box1 + (k23.box4 ?? 0), k23.box16d, b22, b23, 'D40, found by Erik and sent 2026-06-05; this was the gap'],
    ['2024', k24.box1, k24.box16D, b23, b24, '2024 K-1 on the prior return'],
    ['2025', k25.box1 + k25.box4, k25.box16d, b24, Math.max(0, before25 - k25.box16d), `D39; distributions exceed basis by ${fmt(k25.box16d - before25)}, taxed as capital gain`],
  ];
  return (
    <>
      <h3>Lindqvist Family Woodworks, S corporation stock basis (Erik, 20%)</h3>
      <table className="ledger compact"><thead><tr><th>Year</th><th className="num">Income</th><th className="num">Distributions</th><th className="num">Beginning</th><th className="num">Ending</th><th>Source</th></tr></thead>
        <tbody>{rows.map(([y, inc, dist, beg, end, src]) => <tr key={y}><th scope="row">{y}</th><td className="num">{fmt(inc)}</td><td className="num">{fmt(dist)}</td><td className="num">{fmt(beg)}</td><td className="num">{fmt(end)}</td><td className="muted">{src}</td></tr>)}</tbody>
      </table>
      <Tie ok={near(k25.box16d - before25, g.line('F7203.excess')!.value)}>Distributions in excess of basis {fmt(k25.box16d - before25)} = <N k="F7203.excess" r={r} /> on Form 7203 and Form 8949 box F.</Tie>
      <h3>Ridgeline Real Estate Fund III, capital account</h3>
      <p>2024 end {fmt(rec.partnership_ridgeline[0].ending_capital_account)} (prior return). 2025 end {fmt(g.evsByDoc.D37.find(e => e.field === 'cap_end')!.value)} (D37). Outside basis, including the share of liabilities, has never been computed; the audit leaves this open.</p>
      <h3>IRA basis (Ngozi)</h3>
      <p>7,000 at the end of 2024 (2024 Form 8606, confirmed by the Form 5498 for 2024, D42), plus 7,000 for 2025, all converted in 2025: basis to 2026 <N k="F8606.14" r={r} />.</p>
      <h3>Home, 7709 Barton Ridge Dr</h3>
      <p>Bought 2025-07-08 for {fmt(rec.home_7709_barton_ridge[0].price)} (D54). The seller's 6,912 share of 2025 county taxes was credited at closing, which is why the audit cuts the home property tax deduction.</p>
    </>
  );
}

// ---------- 10. prior preparer vs us ----------
function PriorVsUs(r: R) {
  const { g, w } = r;
  const pw = g.P.prior_years.prior_preparer_workpaper;
  const open = (pred: (f: any) => boolean) => w.findings!.some(pred);
  const rows: [string, string, string, boolean][] = [
    ['S corporation basis', pw.notes[0], '2023 K-1 obtained (D40); basis rolled forward to 2,300 at the end of 2024. Their assumption held, by 2,300.', true],
    ['IRA basis', pw.notes[1], 'Form 5498 for 2024 obtained (D42): basis 7,000 confirmed, though the client said "none".', true],
    ['Foreign account', pw.notes[2], 'Form 8938 required again (max 149,567); FBAR stays outside the engagement.', true],
    ['Fremont appliances', pw.notes[3], 'California depreciation continues (483.84 in 2025); 241.92 California basis left.', true],
    ['Home office', pw.notes[4], 'Measured this year (D24): 220 then 260 sq ft, average 240. 2024 claimed 300.', true],
    ['Form 3520 (2023 inheritance)', pw.open_items_left_by_prior_preparer[3], 'Still unresolved; raised with the client and carried forward to 2026.', !open(f => /3520/.test(f.title))],
    ['Self-employed health insurance', '2024: none; Erik was covered on Ngozi\'s employer plan.', `2025 engine claimed 14,400 although Erik could still join Ngozi's plan.${open(f => f.lines.includes('Sch1.17') && f.severity === 'error') ? ' Open.' : ' Resolved.'}`, !open(f => f.lines.includes('Sch1.17') && f.severity === 'error')],
    ['Capital loss carryover', '3,200 short-term, 11,000 long-term', 'Agreed to the 2024 return and recomputed independently; fully used in 2025.', true],
    ['Passive losses', 'Suspended 6,300 (Fremont) and 9,850 (condo), allocated by share of losses', 'Allocation recomputed and agreed; all released in 2025 (condo sold, net passive income).', true],
  ];
  return (
    <>
      <p className="muted">The prior preparer's notes and open items (D07) against how each was handled this year.</p>
      <table className="ledger compact"><thead><tr><th /><th>Delta River Tax Services, 2024</th><th>Miraflores, 2025</th></tr></thead>
        <tbody>{rows.map(([t, them, us, ok]) => <tr key={t}><th scope="row"><StatusMark status={ok ? 'Verified' : 'Question open'} /> {t}</th><td className="memo small-memo">{them}</td><td>{us}</td></tr>)}</tbody>
      </table>
    </>
  );
}
