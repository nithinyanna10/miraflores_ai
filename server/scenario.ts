// Mid-season demo state, dated along the packet's timeline (work started 2026-03-09 ... v3 on 2026-06-23 ...
// client messages 2026-06-30 and 2026-07-01). Every event is one a person could have created through the API:
// sign-off hashes and adjustment effects are computed exactly as the live endpoints compute them.
import { effectOf, proposedValue, type Graph } from '../shared/packet.ts';
import { scopeHash, scopeLines, NEEDS_PARTNER_OVER, type StoredEvent } from '../shared/policy.ts';

type Append = (actor: string, type: string, refs: string[], payload: any, at?: string) => StoredEvent;

export function seedMidSeason(g: Graph, append: Append, log: () => StoredEvent[]) {
  const P = g.P;
  const findings = log().filter(e => e.type === 'finding_opened').map(e => e.payload);
  // The audit finding whose fix states an amount for this line: every scenario adjustment is one of these.
  const errorOn = (key: string) => findings.find(f => f.severity === 'error' && f.lines.includes(key) && proposedValue(f, g.lines.v3[key]) !== undefined);
  const varianceOn = (key: string) => findings.find(f => f.check === 'prior_year_variance' && f.lines[0] === key);
  const at = (d: string) => `${d}:00Z`;
  const L = g.lines.v3;
  const msg = (id: string) => P.client.messages.find((m: any) => m.id === id).text;

  const verify = (who: string, keys: string[], when: string, note?: string) =>
    append(who, 'verified', keys, keys.length === 1 ? { method: 'agreed_to_source_document', value: L[keys[0]].value, note } : { method: 'agreed_to_source_document', values: Object.fromEntries(keys.map(k => [k, L[k].value])), bulk: true }, at(when));
  const signoff = (who: string, area: string, level: string, when: string) =>
    append(who, 'signed_off', [`area:${area}`], { level, hash: scopeHash(g, log(), `area:${area}`) }, at(when));
  const adjust = (who: string, key: string, to: number, when: string, reason: string, authority?: string) => {
    const f = errorOn(key);
    const effect = effectOf(P, L[key], to - L[key].value);
    return append(who, 'adjusted', [key], {
      from: L[key].value, to, reason, authority, finding: f?.id, effect,
      needs_partner: Math.abs(effect.federal) > NEEDS_PARTNER_OVER || Math.abs(effect.california) > NEEDS_PARTNER_OVER,
    }, at(when));
  };
  const clean = (area: string) => scopeLines(g, `area:${area}`).filter(k => !findings.some(f => f.severity !== 'info' && f.check !== 'prior_year_variance' && f.lines.includes(k)) && typeof L[k].value === 'number');

  // Wages: verified, variance explained, signed by preparer and reviewer.
  verify('st-01', clean('Wages'), '2026-03-10T15:20');
  const wv = varianceOn('F1040.1a');
  if (wv) append('st-01', 'variance_explained', ['F1040.1a'], { reasons: { [wv.id]: 'New job at Halvorsen Data from 2026-06-02 alongside Corvane wages to 05-16, plus 2 RSU vests (D08 box 14, 38,200). Both W-2s agreed; D10 is a duplicate image of D09.' } }, at('2026-03-10T15:40'));
  signoff('st-01', 'Wages', 'preparer', '2026-03-12T17:05');
  signoff('st-02', 'Wages', 'reviewer', '2026-03-20T14:10');

  // Interest: two fixes, the rest verified, signed by preparer and reviewer...
  adjust('st-01', 'SchB.1.2', 0, '2026-03-13T16:00', 'D29 is the sweep bank\'s copy of the bank-sweep 1099-INT already on the Northlake composite (D28, account ending 7731). Counted once.');
  adjust('st-01', 'SchB.1.6', 1871, '2026-03-13T16:12', 'Swedish interest is 2025 income: converted at the 2025 average rate (9.86), not the 2024 rate the engine reused.', 'IRS yearly average currency exchange rates (irs.gov); the engine\'s fx table, 2025_average');
  verify('st-01', clean('Interest and dividends').filter(k => !['SchB.1.2', 'SchB.1.6', 'SchB.1.8'].includes(k)), '2026-03-13T16:30');
  signoff('st-01', 'Interest and dividends', 'preparer', '2026-03-14T10:00');
  signoff('st-02', 'Interest and dividends', 'reviewer', '2026-03-20T14:30');
  // ...then the Ridgeline K-1 arrived (v3) and its interest was verified: both sign-offs reopen.
  verify('st-01', ['SchB.1.8'], '2026-06-24T15:00', 'Agreed to D37 box 5 (K-1 received 2026-06-22).');

  // Business: the call on 2026-03-26 settled three fixes; gross receipts needed the partner.
  const gr = adjust('st-01', 'SchC.1', 151300, '2026-03-27T16:45', 'The 12,400 on Form 1099-K is the card portion of Atlas Outdoor Gear\'s 41,200, already deposited gross in the books (D15 p3). Books 151,300 = 1099-NEC 142,000 + clients with no 1099 9,300.');
  adjust('st-01', 'SchC.25', 2172, '2026-03-27T17:00', 'Business share per call-01: mobile plan 70% of 2,160, home internet 50% of 1,320.', 'IRC 262; Treas. Reg. 1.262-1(b)(1)');
  adjust('st-01', 'SchC.27a.1', 6634, '2026-03-27T17:05', 'Spotify Family (216) is personal per call-01.', 'IRC 262');
  append('st-03', 'adjustment_approved', ['SchC.1'], { adjustment: gr.seq }, at('2026-04-02T18:00'));

  // Capital gains: RSU basis from the supplemental statement (D11); each over 1,000, all approved.
  const rsu = [adjust('st-01', 'F8949.B.N1', 140, '2026-03-28T15:00', 'Basis 19,100 per D11 (RSU-2502, vested 02/15/2025, FMV in W-2 box 1). Broker reported no basis (noncovered).', 'Treas. Reg. 1.6045-1(d)(6); Form 8949 instructions, code B'),
    adjust('st-01', 'F8949.B.N3', -620, '2026-03-28T15:05', 'Basis 19,100 per D11 (RSU-2505, vested 05/15/2025).', 'Treas. Reg. 1.6045-1(d)(6); Form 8949 instructions, code B'),
    adjust('st-01', 'F8949.E.N4', 5880, '2026-03-28T15:10', 'Basis 9,420 per D11 (RSU-2308, vested 08/15/2023).', 'Treas. Reg. 1.6045-1(d)(6); Form 8949 instructions, code B')];
  for (const a of rsu) append('st-03', 'adjustment_approved', [a.refs[0]], { adjustment: a.seq }, at('2026-04-02T18:10'));

  // After v3: two questions to the client, both answered (the packet's own messages).
  const q1 = append('st-01', 'client_question', ['F8949.H.C6'], { text: 'For the 0.05 BTC sold on June 18 with no cost on Coinhaven: where and when was it bought, and for how much? Any record helps.' }, at('2026-06-24T16:00'));
  const q2 = append('st-01', 'client_question', ['SchA.11'], { text: 'The St. Brigid receipt is hard to read: was the December gift 1,500 or 7,500? A bank record would settle it.' }, at('2026-06-24T16:05'));
  append('cu-02', 'client_answer', ['F8949.H.C6'], { question: q1.seq, text: msg('msg-07') }, at('2026-06-30T18:02'));
  append('cu-01', 'client_answer', ['SchA.11'], { question: q2.seq, text: msg('msg-08') }, at('2026-07-01T16:40'));

  // Staffing and time: Marcus joined 2026-03-24 (timeline) and took investments; hours logged by area.
  append('st-05', 'assigned', ['area:Whole return'], { area: 'investments_and_digital_assets', person: 'st-04' }, at('2026-03-24T15:30'));
  const hours: [string, string, number, string][] = [
    ['st-01', 'intake_and_engagement', 1.0, '2026-03-09T16:00'], ['st-01', 'wages_and_stock_compensation', 2.5, '2026-03-10T17:00'],
    ['st-01', 'investments_and_digital_assets', 3.0, '2026-03-13T17:00'], ['st-04', 'investments_and_digital_assets', 2.5, '2026-03-28T17:00'],
    ['st-01', 'business', 4.0, '2026-03-27T18:00'], ['st-01', 'rentals_and_sale', 2.0, '2026-04-01T17:00'], ['st-01', 'pass_throughs_and_basis', 2.5, '2026-06-24T17:00'],
    ['st-02', 'wages_and_stock_compensation', 0.8, '2026-03-20T15:00'], ['st-02', 'investments_and_digital_assets', 1.0, '2026-03-20T16:00'], ['st-03', 'partner_review', 0.5, '2026-04-02T18:30'],
  ];
  for (const [who, area, h, when] of hours) append(who, 'time_logged', ['area:Whole return'], { area, hours: h }, at(when));
  // The view log: Priya unmasked a W-2 to check the SSN; Marcus (no clearance) tried and was refused.
  append('st-01', 'sensitive_viewed', ['doc:D08#page1'], {}, at('2026-03-10T15:05'));
  append('st-04', 'sensitive_view_refused', ['doc:D09#page1'], { reason: 'no sensitive-data clearance' }, at('2026-03-28T14:20'));

  // An open review note the preparer still has to answer.
  append('st-02', 'review_note_opened', ['Sch1.16'], { text: 'SEP contribution 18,000 vs deductible 15,214. Did we advise Erik to withdraw the 2,786 excess with earnings before 10/15? Document the advice or the decision.' }, at('2026-06-25T13:30'));
}
