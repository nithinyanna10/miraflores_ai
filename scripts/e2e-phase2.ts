// End-to-end check of Phase 2 flows against a running dev stack. Usage: node scripts/e2e-phase2.ts
// Expects a fresh database (it asserts on counts).
import { chromium, type Page } from 'playwright';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';

const base = 'http://localhost:5173';
const local = `${homedir()}/Library/Caches/ms-playwright/chromium-1228/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;
const browser = await chromium.launch(existsSync(local) ? { executablePath: local } : {});
const ok = (v: unknown, m: string) => { if (!v) throw new Error('FAIL: ' + m); console.log('ok:', m); };
const errors: string[] = [];

async function as(user: string, hash: string): Promise<Page> {
  const p = await browser.newPage({ viewport: { width: 1280, height: 860 } });
  p.on('pageerror', e => errors.push(e.message));
  await p.addInitScript(u => localStorage.setItem('user', u), user);
  await p.goto(`${base}/${hash}`);
  await p.waitForSelector('.outline-area');
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
await p.goto(`${base}/#line=SchC.1`); await p.waitForSelector('.thread');
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

ok(errors.length === 0, `no page errors ${errors.join('; ')}`);
await browser.close();
