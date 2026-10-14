// End-to-end check of Phase 4 (filing and after). Usage: node scripts/e2e-phase4.ts [baseUrl]
// Resets the demo to the mid-season scenario first (as the firm administrator).
import { chromium, type Page, type BrowserContext } from 'playwright';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';

const base = process.argv[2] ?? 'http://localhost:5173';
const local = `${homedir()}/Library/Caches/ms-playwright/chromium-1228/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;
const browser = await chromium.launch(existsSync(local) ? { executablePath: local } : {});
const ok = (v: unknown, m: string) => { if (!v) throw new Error('FAIL: ' + m); console.log('ok:', m); };
const errors: string[] = [];
const ctxs: Record<string, BrowserContext> = {};
async function as(user: string, path: string): Promise<Page> {
  const ctx = ctxs[user] ??= await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
  await ctx.request.post(`${base}/api/session`, { data: { person: user } });
  const p = await ctx.newPage();
  p.on('pageerror', e => errors.push(e.message));
  await p.goto(`${base}${path}`);
  await p.waitForSelector('.outline-area, .client-col');
  await p.waitForTimeout(300);
  return p;
}
const admin = await browser.newContext();
await admin.request.post(`${base}/api/session`, { data: { person: 'st-05' } });
ok((await admin.request.post(`${base}/api/admin/reset`, { data: { scenario: 'midseason' } })).ok(), 'reset to mid-season');

// 1. Whole-return sign-offs in order: preparer, reviewer, partner
for (const [who, level] of [['st-01', 'preparer'], ['st-02', 'reviewer'], ['st-03', 'partner']]) {
  const p = await as(who, '/app');
  await p.locator('.home .signoffs').getByText('Sign off on the whole return').click();
  const Level = level[0].toUpperCase() + level.slice(1);
  await p.locator('.home .signoff-row').filter({ hasText: Level }).filter({ hasText: 'Signed by' }).waitFor();
  ok(true, `${level} signed off on the whole return`);
  await p.close();
}

// 2. Partner sends for approval; both spouses sign Form 8879 with a PIN
let p = await as('st-03', '/app#view=filing');
await p.click('text=Send to the client for approval');
await p.waitForSelector('text=Sent by Helen Strand');
ok(true, 'sent to the client for approval');
await p.close();
for (const [who, pin] of [['cu-01', '41207'], ['cu-02', '88310']]) {
  p = await as(who, '/app');
  await p.waitForSelector('.client-approval');
  await p.check('.client-approval input[type=checkbox]');
  await p.fill('.client-approval input[inputmode=numeric]', pin);
  await p.click('text=Sign Forms 8879 and FTB 8879');
  await p.waitForSelector('text=You signed on');
  ok(true, `${who} signed Forms 8879`);
  await p.close();
}
const ev = await (await ctxs['st-02'].request.get(`${base}/api/events`)).json();
ok(!JSON.stringify(ev).includes('"41207"') && JSON.stringify(ev).includes('•1207'), 'signature PINs are masked in the event log');

// 3. Transmit with an override; the IRS rejects for Theo's SSN (the audit's open item); FTB holds
p = await as('st-03', '/app#view=filing');
ok(await p.locator('.steps').innerText().then(t => t.includes('Client approval and e-file authorization')), 'readiness lists the required steps');
await p.fill('.filing textarea', 'Partner decision for the demo: transmit with documented open items; see the steps list.');
await p.click('text=Transmit to the IRS and FTB');
await p.click('text=Record the IRS response');
await p.waitForSelector('text=R0000-504-02');
ok(await p.locator('text=The audit flagged this before filing').count() === 1, 'rejection links back to the open item the audit raised');
await p.click('text=Record the FTB response');
await p.waitForSelector('text=STATE-HOLD');
await p.close();

// 4. Reviewer resolves the SSN item; retransmit; IRS accepts and the return freezes; FTB accepts
p = await as('st-02', '/app#line=F8812.4');
await p.click('text=Resolve with a reason');
await p.fill('.action-form textarea', "Theo's SSN corrected to 666-74-3390 per his Social Security card (D71) and the 2024 return; organizer typo.");
await p.click('.action-form button.btn');
await p.waitForTimeout(500);
await p.close();
// The resolution is new evidence on the whole return: reviewer and partner sign-offs reopen and are signed again.
for (const who of ['st-01', 'st-02', 'st-03']) {
  p = await as(who, '/app');
  ok(await p.locator('.home .signoffs').innerText().then(t => t.includes('Reopened')), `${who} sees the whole-return sign-offs reopened by the fix, and signs again`);
  await p.locator('.home .signoffs').getByText('Sign off on the whole return').click();
  await p.waitForTimeout(400);
  await p.close();
}
p = await as('st-03', '/app#view=filing');
await p.fill('.filing textarea', 'Retransmitting after correcting the dependent SSN; other items documented.');
await p.click('text=Transmit again');
await p.click('text=Record the IRS response');
await p.waitForSelector('text=IRS accepted');
await p.click('text=Record the FTB response');
await p.waitForSelector('text=FTB accepted');
ok(await p.locator('text=Frozen on').count() === 1, 'federal acceptance froze the return');
await p.screenshot({ path: 'shots/p4-filing.png', fullPage: true });

// 5. After the freeze, changes are refused until an amendment is opened
const refused = await ctxs['st-01'].request.post(`${base}/api/events`, { data: { type: 'verified', refs: ['SchC.8'], payload: { method: 'recalculated', value: 2100 } } });
ok(refused.status() === 403 && (await refused.json()).error.includes('frozen'), 'frozen return refuses changes');
await p.fill('input[aria-label="Why amend"]', 'HVAC replacement should have been capitalized (Treas. Reg. 1.263(a)-3).');
await p.click('text=Open an amendment');
await p.waitForSelector('text=Amendment opened by Helen Strand');
const allowed = await ctxs['st-01'].request.post(`${base}/api/events`, { data: { type: 'verified', refs: ['SchC.8'], payload: { method: 'recalculated', value: 2100 } } });
ok(allowed.ok(), 'open amendment allows changes on top of the frozen return');

// 6. Notice response packet (2028 Letter 566) and carry-forward to 2026
const [dl] = await Promise.all([p.waitForEvent('download'), p.click('text=Build the response packet')]);
const html = readFileSync(await dl.path(), 'utf8');
ok(html.includes('Noncash charitable') && html.includes('1098-C') && html.includes('frozen at filing') && !/666-\d\d-\d{4}/.test(html), 'response packet: both items, evidence, frozen hash, no raw SSNs');
const [dl2] = await Promise.all([p.waitForEvent('download'), p.click('text=Carry forward and download the 2026 opening file')]);
const opening = JSON.parse(readFileSync(await dl2.path(), 'utf8'));
ok(opening.carryovers.federal.minimum_tax_credit_from_2025_amt === 3871, 'carry-forward file has the AMT credit for 2026');
await p.close();

// 7. Client sees the filing; replay shows the past read-only
p = await as('cu-01', '/app');
ok(await p.locator('text=accepted by the IRS').count() === 1, 'client sees the accepted return');
await p.close();
p = await as('st-02', '/app#view=season');
await p.fill('.season input[type=date]', '2026-03-15');
await p.click('.season button:has-text("Replay")');
await p.waitForSelector('.replay-bar');
await p.click('.outline-area:has-text("Wages")');
ok(await p.locator('.signoff-row').filter({ hasText: 'Signed by Daniel' }).count() === 0, 'replay as of Mar 15: the reviewer had not signed Wages yet');
ok(await p.locator('button:has-text("Sign off on Wages")').count() === 0, 'replay is read-only');
await p.screenshot({ path: 'shots/p4-replay.png' });
await p.close();

ok(errors.length === 0, `no page errors ${errors.join('; ')}`);
await browser.close();
