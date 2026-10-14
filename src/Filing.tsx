import { useState } from 'react';
import { fmt, labelMaker, type Graph } from '../shared/packet.ts';
import { can } from '../shared/policy.ts';
import { readiness, efileState, frozenAt, openAmendment, signedBy, finalSummary } from '../shared/filing.ts';
import { StatusMark } from './StatusMark.tsx';
import { post, type Workpaper, type WEvent } from './data.ts';
import { useSession, METHODS } from './Actions.tsx';

const longDate = (d: string) => new Date(d.length === 10 ? d + 'T12:00:00Z' : d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
const money = (n: number) => (n < 0 ? `refund ${fmt(-n)}` : `${fmt(n)} owed`);

function useAct() {
  const { me } = useSession();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const act = async (type: string, refs: string[], payload: any = {}) => {
    if (!me) return false;
    setBusy(true); const e = await post(me.id, type, refs, payload); setBusy(false); setError(e);
    return !e;
  };
  return { me, act, error, busy };
}

export function FilingView({ g, w, onLine }: { g: Graph; w: Workpaper; onLine: (k: string) => void }) {
  const { me, people } = useSession();
  const { act, error, busy } = useAct();
  const [override, setOverride] = useState('');
  const [reason, setReason] = useState('');
  const log = w.events;
  const steps = readiness(g, log);
  const ef = efileState(g, log);
  const frozen = frozenAt(log);
  const amend = openAmendment(log);
  const sent = log.filter(e => e.type === 'sent_for_approval').at(-1);
  const signed = signedBy(log);
  const clients = g.P.firm.client_users;
  const name = (id: string) => (id === 'system' ? 'The workpaper' : people.find(p => p.id === id)?.name ?? id);
  const unmet = steps.filter(s => !s.done);
  const S = sent?.payload.summary ?? finalSummary(g, log);

  return (
    <article className="filing">
      <h1>Filing</h1>

      <section>
        <h2>{unmet.length ? `Ready to file: ${steps.length - unmet.length} of ${steps.length} required steps done` : 'Ready to file: every required step is done'}</h2>
        <ol className="steps">
          {steps.map(s => (
            <li key={s.step}><StatusMark status={s.done ? 'Verified' : 'Blocked'} /> <span><span className={s.done ? '' : 'step-open'}>{s.step}</span>{s.missing && <span className="muted">: {s.missing}</span>}</span></li>
          ))}
        </ol>
      </section>

      <section>
        <h2>Client approval and e-signature</h2>
        {sent ? (
          <>
            <p>Sent by {name(sent.actor)} on {longDate(sent.at)}. Federal tax {fmt(S.federal.total_tax)}, {money(S.federal.balance_due)}; California tax {fmt(S.california.total_tax)}, {money(S.california.balance_due)}.{S.estimated ? ' Amounts include first-order estimates for adjusted lines.' : ''}</p>
            <ul className="plain">{clients.map((c: any) => { const s = signed.find(x => x.actor === c.id); return <li key={c.id}><StatusMark status={s ? 'Signed' : 'Unverified'} /> {c.name}: {s ? `signed Forms 8879 and FTB 8879 on ${longDate(s.at)}` : 'not signed yet'}</li>; })}</ul>
          </>
        ) : <p className="muted">Not sent yet. The partner sends it after signing off on the whole return.</p>}
        {can(me, 'sent_for_approval') && !frozen && <button className="btn quiet" disabled={busy} onClick={() => act('sent_for_approval', ['area:Whole return'])}>{sent ? 'Send the updated return again' : 'Send to the client for approval'}</button>}
      </section>

      <section>
        <h2>E-file</h2>
        {ef.transmissions.length === 0 && <p className="muted">Not transmitted.</p>}
        <ol className="plain timeline-list">
          {log.filter(e => e.type === 'efile_transmitted' || e.type === 'efile_response' || e.type === 'return_frozen').map(e => <li key={e.seq} className="efile-row">{efileLine(e, name, g, onLine)}</li>)}
        </ol>
        {ef.awaiting && (
          <p className="action-row">
            <span className="muted">Waiting for the {ef.next?.jurisdiction === 'federal' ? 'IRS' : 'FTB'}. In this prototype the agencies' responses replay from the packet's records, in order.</span>
            {can(me, 'efile_response') && <button className="btn quiet" disabled={busy} onClick={() => act('efile_response', ['area:Whole return'], { index: ef.nextIndex })}>Record the {ef.next?.jurisdiction === 'federal' ? 'IRS' : 'FTB'} response</button>}
          </p>
        )}
        {!ef.awaiting && !(ef.fedAccepted && ef.caAccepted) && can(me, 'efile_transmitted') && (
          <div className="action-form">
            {unmet.filter(s => !['Partner sign-off', 'Client approval and e-file authorization'].includes(s.step)).length > 0 && (
              <label>Some required steps are not done. To transmit anyway, write why (it is recorded with the transmission).<textarea rows={2} value={override} onChange={e => setOverride(e.target.value)} /></label>
            )}
            <div className="action-row"><button className="btn" disabled={busy} onClick={async () => { if (await act('efile_transmitted', ['area:Whole return'], { override: override.trim() || undefined })) setOverride(''); }}>{ef.transmissions.length ? 'Transmit again' : 'Transmit to the IRS and FTB'}</button></div>
          </div>
        )}
      </section>

      {frozen && (
        <section>
          <h2>Filed</h2>
          <p><StatusMark status="Frozen" /> Frozen on {longDate(frozen.at)} at the federal acceptance ({frozen.payload.submission}). Event {frozen.payload.cursor}, return hash <span className="ref">{frozen.payload.hash}</span>. Every change after this needs an amendment.</p>
          {amend ? (
            <>
              <p className="memo">Amendment opened by {name(amend.actor)} on {longDate(amend.at)}: {amend.payload.reason}</p>
              <p className="muted">Adjustments made now are tagged to this amendment; the filed values stay as filed.</p>
              {can(me, 'amendment_filed') && <button className="btn quiet" disabled={busy} onClick={() => act('amendment_filed', ['area:Whole return'], { amendment: amend.seq, summary: finalSummary(g, log) })}>File the amendment (Forms 1040-X and 540NR amended)</button>}
            </>
          ) : can(me, 'amendment_opened') && (
            <div className="action-row">
              <input aria-label="Why amend" placeholder="Why amend the filed return?" value={reason} onChange={e => setReason(e.target.value)} />
              <button className="btn quiet" disabled={busy || !reason.trim()} onClick={async () => { if (await act('amendment_opened', ['area:Whole return'], { reason: reason.trim() })) setReason(''); }}>Open an amendment</button>
            </div>
          )}
          <AfterFiling g={g} w={w} frozen={frozen} />
        </section>
      )}
      {error && <p className="warn">{error}</p>}
    </article>
  );
}

function efileLine(e: WEvent, name: (id: string) => string, g: Graph, onLine: (k: string) => void) {
  if (e.type === 'efile_transmitted') return <><StatusMark status="Unverified" /><span>{longDate(e.at)}: {name(e.actor)} transmitted the federal and California returns.{e.payload.override ? <span className="memo"> Transmitted with steps open: {e.payload.override}</span> : ''}</span></>;
  if (e.type === 'return_frozen') return <><StatusMark status="Frozen" /><span>{longDate(e.at)}: return frozen at filing.</span></>;
  const r = e.payload.record;
  const who = r.jurisdiction === 'federal' ? 'IRS' : 'FTB';
  if (r.status === 'accepted') return <><StatusMark status="Signed" /><span>{who} accepted ({r.submission_id}).</span></>;
  const theo = /Theo/.test(r.errors?.[0]?.message ?? '');
  return (
    <><StatusMark status="Blocked" /><span>{who} {r.status.replace(/_/g, ' ')}: {r.errors?.map((x: any) => `${x.code} ${x.message}`).join('; ')}
      {theo && <> <button className="link" onClick={() => onLine('F8812.4')}>The audit flagged this before filing (Theo's SSN). Open it</button></>}</span></>
  );
}

// After filing: payments and their cost, the 2028 notice and its response packet, and carry-forward to 2026.
function AfterFiling({ g, w, frozen }: { g: Graph; w: Workpaper; frozen: WEvent }) {
  const { me } = useSession();
  const { act, error, busy } = useAct();
  const P = g.P, R = P.post_filing_rates;
  const bal = frozen.payload.summary.federal.balance_due;
  const paid = P.timeline.find((t: any) => t.event === 'federal_balance_paid');
  const refund = P.timeline.find((t: any) => t.event === 'california_refund_issued');
  const days = paid ? Math.round((Date.parse(paid.at) - Date.parse('2026-04-15T00:00:00Z')) / 864e5) : 0;
  const months = Math.ceil(days / 30.4);
  const interest = Math.max(0, bal) * R.irs_underpayment_interest_rate_annual * days / 365;
  const ftp = Math.max(0, bal) * R.irs_failure_to_pay_penalty_per_month * months;
  const notices = P.tax_agency_records.notices as any[];
  const prepared = (id: string) => w.events.find(e => e.type === 'notice_response_prepared' && e.payload.notice === id);
  const carried = w.events.find(e => e.type === 'carried_forward');
  return (
    <>
      <h3>Payments after filing</h3>
      <ul className="plain">
        <li>{paid ? `${longDate(paid.at)}: federal balance of about ${fmt(bal)} paid by direct debit.` : 'Federal balance not paid yet.'} Paid {days} days after April 15: estimated interest {fmt(Math.round(interest))} and failure-to-pay penalty {fmt(Math.round(ftp))} ({months} months at {R.irs_failure_to_pay_penalty_per_month * 100}%). The extension extended the time to file, not to pay; the transcript shows 196/276 assessed on 2026-08-03.</li>
        <li>{refund ? `${longDate(refund.at)}: California refund of about ${fmt(-frozen.payload.summary.california.balance_due)} issued by direct deposit.` : 'California refund pending.'}</li>
      </ul>
      <h3>Notices</h3>
      <ul className="plain">
        {notices.map(n => (
          <li key={n.id}>
            <StatusMark status={/Resolved/.test(n.status ?? '') ? 'Verified' : 'Question open'} /> {n.agency} {n.type}, tax year {n.tax_year}, dated {longDate(n.dated)}{n.response_due ? `, response due ${longDate(n.response_due)}` : ''}. {n.summary ?? ''}{n.status ? ` ${n.status}` : ''}
            {n.items_under_examination && <ul>{n.items_under_examination.map((i: string) => <li key={i} className="memo">{i}</li>)}</ul>}
            {n.items_under_examination && (
              <p className="action-row">
                {prepared(n.id) && <span className="muted">Response packet prepared {longDate(prepared(n.id)!.at)}.</span>}
                {can(me, 'notice_response_prepared') && <button className="btn quiet" disabled={busy} onClick={async () => { downloadNoticePacket(g, w, n); await act('notice_response_prepared', ['area:Whole return', 'D72'], { notice: n.id }); }}>Build the response packet</button>}
              </p>
            )}
          </li>
        ))}
      </ul>
      <h3>Carry forward to 2026</h3>
      <CarryForward g={g} w={w} />
      <p className="action-row">
        {carried && <span className="muted">Carried forward by {carried.actor} on {longDate(carried.at)}.</span>}
        {can(me, 'carried_forward') && <button className="btn quiet" disabled={busy} onClick={async () => { download(`okafor-lindqvist-2026-opening.json`, JSON.stringify(openingBalances(g, w), null, 2), 'application/json'); await act('carried_forward', ['area:Whole return'], {}); }}>Carry forward and download the 2026 opening file</button>}
      </p>
      {error && <p className="warn">{error}</p>}
    </>
  );
}

// ---------- carry-forward ----------
function openingBalances(g: Graph, w: Workpaper) {
  const v3 = g.P.return_versions.find((v: any) => v.version === 'v3');
  const open = w.findings!.filter(f => f.severity !== 'info');
  return {
    for_tax_year: 2026, from_return: '2025 as filed (v3 plus adjustments)', prepared_at: new Date().toISOString(),
    carryovers: v3.carryovers_out,
    assets_end_of_2025: v3.assets.filter((a: any) => !a.disposed).map((a: any) => ({ asset_id: a.asset_id, description: a.description, federal_accumulated: a.federal.accumulated_end, california_accumulated: a.california.accumulated_end })),
    adjustments_made: Object.values(w.adjustments!).map(a => ({ line: a.refs[0], from: a.payload.from, to: a.payload.to, reason: a.payload.reason, authority: a.payload.authority })),
    planning: g.P.planning_reference_2026,
    open_items_for_next_year: open.map(f => ({ id: f.id, title: f.title })),
    prior_preparer_items_still_open: g.P.prior_years.prior_preparer_workpaper.open_items_left_by_prior_preparer.filter((s: string) => /3520/.test(s)),
  };
}
function CarryForward({ g, w }: { g: Graph; w: Workpaper }) {
  const v3 = g.P.return_versions.find((v: any) => v.version === 'v3');
  const c = v3.carryovers_out.federal;
  const rows: [string, any][] = [
    ['Minimum tax credit from the 2025 AMT (Form 8801 in 2026)', c.minimum_tax_credit_from_2025_amt],
    ['SEP contribution not deductible for 2025', c.sep_contribution_not_deductible_for_2025],
    ['Ridgeline capital account, end of 2025', c.ridgeline_capital_account_end],
    ['Woodworks stock basis, end of 2025', c.scorp_stock_basis_end],
    ['IRA nondeductible basis (Ngozi)', c.ira_nondeductible_basis_ngozi],
    ['California depreciation differences', Object.entries(v3.carryovers_out.california.depreciation_basis_differences).map(([k, v]) => `${k} ${fmt(v as number)}`).join('; ')],
  ];
  return (
    <>
      <table className="ledger compact"><tbody>{rows.map(([l, v]) => <tr key={l}><th scope="row">{l}</th><td className="num">{typeof v === 'number' ? fmt(v) : v ?? 'none'}</td></tr>)}</tbody></table>
      <p className="muted">2026 estimates: {g.P.planning_reference_2026.federal_safe_harbor} Due {g.P.planning_reference_2026.federal_estimate_due_dates.map(longDate).join(', ')}. {g.P.planning_reference_2026.known_2026_changes_for_this_household.join(' ')}</p>
    </>
  );
}

// ---------- the notice response packet: one self-contained HTML file ----------
const NOTICE_LINES: [RegExp, string[]][] = [[/Noncash charitable/i, ['F8283.A1.stock', 'F8283.A1.vehicle', 'SchA.12']], [/gross receipts/i, ['SchC.1']]];
function downloadNoticePacket(g: Graph, w: Workpaper, n: any) {
  const label = labelMaker(Object.values(g.lines.v3));
  const esc = (s: any) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
  const name = (id: string) => [...g.P.firm.staff, ...g.P.firm.client_users].find((p: any) => p.id === id)?.name ?? id;
  const frozen = frozenAt(w.events);
  const section = (item: string) => {
    const keys = NOTICE_LINES.find(([re]) => re.test(item))?.[1] ?? [];
    return `<section><h2>${esc(item)}</h2>${keys.map(k => {
      const l = g.line(k)!;
      const adj = w.events.filter(e => e.type === 'adjusted' && e.refs[0] === k);
      const ver = w.events.filter(e => e.type === 'verified' && e.refs.includes(k));
      const q = w.events.filter(e => (e.type === 'client_question' || e.type === 'client_answer') && e.refs.includes(k));
      const files = w.events.filter(e => e.type === 'evidence_attached' && e.refs.includes(k));
      const fs = w.allFindings!.filter(f => f.lines.includes(k));
      const srcs = l.sources.map(s => g.resolve(s));
      return `<h3>${esc(label(l))} <small>${esc(l.key)}</small></h3>
        <p>As filed: <b>${fmt(w.value!(k))}</b>${adj.length ? ` (engine computed ${fmt(l.value)})` : ''}. Rule: ${esc(g.ruleText(l.rule))}</p>
        ${l.note ? `<p class="memo">${esc(l.note)}</p>` : ''}
        <h4>Sources</h4><ul>${srcs.map(s => `<li>${esc(s.title)}${s.value !== undefined && typeof s.value !== 'object' ? `: ${esc(fmt(s.value))}` : ''}${s.ev ? `<blockquote>${esc(g.docs[s.ev.document_id].pages.find((p: any) => p.page === s.ev!.page)?.printed_content)}</blockquote>` : s.text ? `<blockquote>${esc(s.text)}</blockquote>` : ''}</li>`).join('')}</ul>
        ${adj.length ? `<h4>Adjustments</h4><ul>${adj.map(a => `<li>${esc(name(a.actor))}, ${a.at.slice(0, 10)}: ${fmt(a.payload.from)} to ${fmt(a.payload.to)}. ${esc(a.payload.reason)} ${a.payload.authority ? `Authority: ${esc(a.payload.authority)}.` : ''}</li>`).join('')}</ul>` : ''}
        ${fs.length ? `<h4>Review findings</h4><ul>${fs.map(f => `<li>${esc(f.title)}${w.resolution![f.id] ? ` Resolved: ${esc(w.resolution![f.id]!.payload.text)}` : w.addressedBy![f.id] ? ' Addressed by the adjustment above.' : ''}</li>`).join('')}</ul>` : ''}
        ${ver.length ? `<h4>Verification</h4><ul>${ver.map(v => `<li>${esc(name(v.actor))}, ${v.at.slice(0, 10)}: ${esc(METHODS[v.payload.method] ?? v.payload.method)}${v.payload.note ? `. ${esc(v.payload.note)}` : ''}</li>`).join('')}</ul>` : ''}
        ${q.length ? `<h4>Correspondence with the taxpayers</h4><ul>${q.map(e => `<li>${esc(name(e.actor))}, ${e.at.slice(0, 10)}: ${esc(e.payload.text)}</li>`).join('')}</ul>` : ''}
        ${files.length ? `<h4>Attached evidence</h4><ul>${files.map(f => `<li>${esc(f.payload.name)} (sha256 ${f.payload.id.slice(0, 16)}…)</li>`).join('')}</ul>` : ''}`;
    }).join('')}</section>`;
  };
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Response to ${esc(n.type)}, tax year ${n.tax_year}</title>
<style>body{font:15px/1.55 Georgia,serif;color:#18202E;max-width:820px;margin:40px auto;padding:0 20px}h1,h2,h3,h4{font-family:system-ui,sans-serif}h2{border-top:1px solid #D3D9E0;padding-top:16px}small{color:#5B6573;font-weight:400}blockquote{margin:6px 0 10px;padding:8px 12px;background:#F3F5F7;border-left:3px solid #D3D9E0}.memo{font-style:italic}</style></head><body>
<h1>Response to IRS ${esc(n.type)}</h1>
<p>Taxpayers: ${esc(g.P.household.people.filter((p: any) => p.role !== 'dependent').map((p: any) => p.name).join(' and '))}. Tax year ${n.tax_year}. Letter dated ${n.dated}; response due ${n.response_due}.</p>
<p>Prepared by ${esc(g.P.firm.name)} from the workpaper as frozen at filing on ${frozen?.at.slice(0, 10) ?? '(not filed)'} (return hash ${frozen?.payload.hash ?? ''}). Taxpayer identification numbers are masked.</p>
${(n.items_under_examination ?? []).map(section).join('')}
</body></html>`;
  download(`response-${n.id}.html`, html, 'text/html');
}

function download(name: string, body: string, type: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([body], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// ---------- the season: the packet's timeline and the workpaper's own events, with replay ----------
export function Season({ g, w, asOf, onAsOf }: { g: Graph; w: Workpaper; asOf?: string; onAsOf: (d?: string) => void }) {
  const { people } = useSession();
  const [d, setD] = useState(asOf ?? '2026-07-10');
  const name = (id: string | null) => (!id ? '' : id === 'system' ? 'The workpaper' : id === 'audit' ? 'The audit' : people.find(p => p.id === id)?.name ?? id);
  const items = [
    ...g.P.timeline.map((t: any) => ({ at: t.at, who: name(t.actor), what: `${t.event.replace(/_/g, ' ')}${t.detail ? `: ${t.detail}` : ''}`, packet: true })),
    ...w.events.filter(e => e.type !== 'finding_opened' && e.type !== 'sensitive_viewed').map(e => ({ at: e.at, who: name(e.actor), what: e.type.replace(/_/g, ' ') + (e.payload?.text ? `: ${e.payload.text}` : e.payload?.reason ? `: ${e.payload.reason}` : ''), packet: false })),
  ].sort((a, b) => a.at.localeCompare(b.at));
  return (
    <article className="season">
      <h1>The season</h1>
      <p className="muted">The packet's timeline and everything people did in the workpaper, in order. Replay shows the whole workpaper as it stood at the end of any day, read-only.</p>
      <p className="action-row">
        <label>Show the workpaper as of <input type="date" value={d} min="2026-01-12" max="2028-02-28" onChange={e => setD(e.target.value)} /></label>
        <button className="btn quiet" onClick={() => onAsOf(d)}>Replay</button>
        {asOf && <button className="link" onClick={() => onAsOf(undefined)}>Back to now</button>}
      </p>
      <ol className="plain timeline-list">
        {items.map((x, i) => (
          <li key={i} className={x.packet ? 'from-packet' : ''}>
            <span className="tl-date">{x.at.slice(0, 10)}</span>
            <span>{x.who ? `${x.who}: ` : ''}{x.what}</span>
          </li>
        ))}
      </ol>
    </article>
  );
}
