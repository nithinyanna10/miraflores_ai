// End-to-end check of Phase 2 flows. Usage: node scripts/e2e-phase2.ts [baseUrl]  (default: the local dev stack)
// Expects a fresh database (it asserts on counts).
import { chromium, type Page } from 'playwright';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';

const base = process.argv[2] ?? 'http://localhost:5173';
const local = `${homedir()}/Library/Caches/ms-playwright/chromium-1228/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;
const browser = await chromium.launch(existsSync(local) ? { executablePath: local } : {});
const ok = (v: unknown, m: string) => { if (!v) throw new Error('FAIL: ' + m); console.log('ok:', m); };
const errors: string[] = [];

async function as(user: string, hash: string): Promise<Page> {
  // Sign in the way a person does: the server sets the session cookie.
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  await ctx.request.post(`${base}/api/session`, { data: { person: user } });
  const p = await ctx.newPage();
  p.on('pageerror', e => errors.push(e.message));
  await p.goto(`${base}/app${hash}`);
  await p.waitForSelector('.outline-area, .client-col');
  await p.waitForTimeout(300);
  return p;
}

// 1. Preparer verifies wages with the keyboard
let p = await as('st-01', '#line=F1040.1a');
await p.keyboard.press('v');
await p.selectOption('.action-form select', 'agreed_to_source_document');
await p.fill('.action-form textarea', 'Agreed box 1 on both W-2s; D10 is a duplicate image of D09.');
await p.click('text=Record verification');
await p.waitForSelector('.verification');
ok(await p.locator('.verification').innerText().then(t => t.includes('Verified by Priya Raman')), 'preparer verification recorded and shown');
await p.screenshot({ path: 'shots/p2-verified.png' });

// 2. Preparer signs off on Wages
await p.click('button:has-text("Sign off on Wages")');
await p.waitForSelector('.signoff-row:has-text("Signed by Priya")');
ok(true, 'preparer sign-off on Wages');
await p.close();

// 3. Reviewer cannot verify-then-review their own work, but can review Priya's
p = await as('st-02', '#line=F1040.1a');
await p.click('button:has-text("Sign off on Wages")');
await p.waitForSelector('.signoff-row:has-text("Signed by Daniel")');
ok(true, 'reviewer sign-off on Wages after preparer');
// Reviewer writes a review note on gross receipts
await p.goto(`${base}/app#line=SchC.1`); await p.waitForSelector('.thread');
await p.click('text=Write a review note');
await p.fill('.action-form textarea', 'Tie gross receipts to the 1099-NECs and the 1099-K before we file. Show the Atlas overlap.');
await p.click('text=Send to the preparer');
await p.waitForSelector('.review-note');
ok(await p.locator('.blocking').innerText().then(t => t.startsWith('20')), 'open review note adds to the blocking count (19 + 1)');
await p.close();

// 4. Preparer verifies another wages line: the reviewer's sign-off reopens
p = await as('st-01', '#line=F8959.1');
await p.keyboard.press('v');
await p.click('text=Record verification');
await p.waitForSelector('.verification');
await p.waitForSelector('.signoff-row .reopened');
ok(true, 'new evidence in Wages reopens existing sign-offs');
await p.screenshot({ path: 'shots/p2-reopened.png' });
await p.close();

// 5. Masking: Marcus (no clearance) sees masked numbers and cannot unmask
p = await as('st-04', '#src=D08');
const txt = await p.locator('.printed').first().innerText();
ok(!txt.includes('666-41-2287') && txt.includes('•••-••-2287'), 'SSN masked for staff without clearance');
ok(await p.locator('.mask-bar').innerText().then(t => t.includes('does not have sensitive-data clearance')), 'no unmask button without clearance');
ok(await p.locator('button:has-text("Verify")').count() === 0, 'nothing to verify on a document view');
await p.screenshot({ path: 'shots/p2-masked.png' });
await p.close();

// 6. Priya unmasks; the view is logged and shown
p = await as('st-01', '#src=D08');
await p.click('text=Show the masked numbers on this page');
await p.waitForSelector('.view-log li');
ok(await p.locator('.printed').first().innerText().then(t => t.includes('666-41-2287')), 'cleared staff can unmask');
ok(await p.locator('.view-log').innerText().then(t => t.includes('Priya Raman')), 'unmasked view logged on the document');
await p.screenshot({ path: 'shots/p2-unmasked.png' });
await p.close();

// 7. Home shows the review note first among blockers
p = await as('st-03', '');
await p.screenshot({ path: 'shots/p2-home.png' });
ok(await p.locator('.item-list li').first().innerText().then(t => t.includes('Tie gross receipts')), 'review note leads the blocking list');
await p.close();

// 8. Preparer attaches a file and sends the client a question about the crypto lot with no basis
p = await as('st-01', '#line=F8949.H.C6');
await p.click('text=Attach a file');
await p.setInputFiles('.action-form input[type=file]', { name: 'coinhaven-basis-workpaper.txt', mimeType: 'text/plain', buffer: Buffer.from('Lot C6: transfer-in 2025-06-01. Client says bought 03/15/2021 for 3,050 on CryptoNorth.') });
await p.fill('.action-form textarea', 'Our notes on lot C6 before asking the client.');
await p.click('text=Attach as evidence');
await p.waitForSelector('.hop:has-text("coinhaven-basis-workpaper.txt")');
ok(true, 'staff attachment lands on the line as evidence');
await p.click('.hop:has-text("coinhaven-basis-workpaper.txt") .hop-body');
await p.waitForSelector('.attachment iframe');
ok(true, 'attachment opens in the document pane');
await p.click('text=Send a question to the client');
await p.fill('.action-form textarea', 'For the 0.05 BTC sold on June 18: can you send the CryptoNorth purchase record or the bank statement showing the 3,050 payment on 03/15/2021?');
await p.click('text=Send to the client');
await p.waitForSelector('.question');
ok(true, 'question to the client recorded on the line');
await p.close();

// 9. Client view: only their question and documents; no internal items; server refuses the workpaper
p = await as('cu-01', '');
await p.waitForSelector('.client-question');
const body = await p.locator('body').innerText();
ok(body.includes('1 question needs your answer'), 'client sees the one question addressed to them');
ok(!body.includes('Tie gross receipts') && !body.includes('blocking') && !body.includes('Blocked'), 'client sees no review notes or open items');
ok(!body.includes('coinhaven-basis-workpaper.txt'), 'client does not see staff files not shared with them');
const api = await p.evaluate(async () => ({
  packet: (await fetch('/api/packet', { headers: { 'x-user': 'st-02' } })).status, // a forged header must not help
  findings: (await fetch('/api/findings', { headers: { 'x-user': 'cu-01' } })).status,
  types: [...new Set<string>((await (await fetch('/api/events', { headers: { 'x-user': 'cu-01' } })).json()).map((e: any) => e.type))],
}));
ok(api.packet === 403 && api.findings === 403, 'server refuses the workpaper to a client, even with a forged x-user header');
ok(api.types.every((t: string) => ['client_question', 'client_answer', 'evidence_attached', 'sensitive_viewed'].includes(t)), `client receives only client events (${api.types.join(', ')})`);
await p.fill('.client-question textarea', 'Attached is the bank statement line for the purchase.');
await p.setInputFiles('.client-question input[type=file]', { name: 'bank-statement-2021-03.txt', mimeType: 'text/plain', buffer: Buffer.from('03/15/2021  CRYPTONORTH EXCHANGE  -3,050.00') });
await p.click('text=Send your answer');
await p.waitForSelector('.client-question.is-answered');
ok(true, 'client answers with a file');
await p.screenshot({ path: 'shots/p2-client.png' });
await p.close();

// 10. The answer and the client's file become evidence on the line
p = await as('st-02', '#line=F8949.H.C6');
await p.waitForSelector('.question.is-cleared');
ok(await p.locator('.hop:has-text("bank-statement-2021-03.txt")').count() === 1, "client's file is evidence on the line");
await p.screenshot({ path: 'shots/p2-evidence.png' });
await p.close();

// 11. No session: data is refused, and a deep link goes through sign-in and comes back to the same line
const anon = await browser.newContext({ viewport: { width: 1440, height: 900 } });
ok((await anon.request.get(`${base}/api/events`)).status() === 401, 'no session, no events');
ok((await anon.request.get(`${base}/api/packet`, { headers: { 'x-user': 'st-02' } })).status() === 401, 'no session, no packet (header ignored)');
const ap = await anon.newPage();
await ap.goto(`${base}/app#line=SchC.1`);
await ap.waitForSelector('.person');
ok(ap.url().includes('/?next='), 'deep link redirects to sign-in');
await ap.locator('.person').filter({ hasText: 'Helen Strand' }).click();
await ap.click('text=Sign in as Helen');
await ap.waitForSelector('.thread');
ok(ap.url().includes('/app#line=SchC.1'), 'after sign-in, back on the requested line');
ok(await ap.locator('.me').innerText().then(t => t.includes('Helen Strand')), 'header shows who is signed in');
await ap.click('text=Change role');
await ap.waitForSelector('.person');
ok((await anon.request.get(`${base}/api/events`)).status() === 401, 'Change role signs out');
await anon.close();

ok(errors.length === 0, `no page errors ${errors.join('; ')}`);
await browser.close();
