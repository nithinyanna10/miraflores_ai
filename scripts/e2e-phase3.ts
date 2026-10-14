// End-to-end check of Phase 3 flows. Usage: node scripts/e2e-phase3.ts [baseUrl]. Expects a fresh database.
import { chromium, type Page } from 'playwright';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';

const base = process.argv[2] ?? 'http://localhost:5173';
const local = `${homedir()}/Library/Caches/ms-playwright/chromium-1228/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;
const browser = await chromium.launch(existsSync(local) ? { executablePath: local } : {});
const ok = (v: unknown, m: string) => { if (!v) throw new Error('FAIL: ' + m); console.log('ok:', m); };
const errors: string[] = [];
async function as(user: string, hash: string): Promise<Page> {
  const p = await browser.newPage({ viewport: { width: 1280, height: 860 } });
  p.on('pageerror', e => errors.push(e.message));
  await p.addInitScript(u => localStorage.setItem('user', u), user);
  await p.goto(`${base}/${hash}`);
  await p.waitForSelector('.outline-area, .client-col');
  await p.waitForTimeout(300);
  return p;
}
const blocking = async (p: Page) => Number((await p.locator('.blocking').innerText()).match(/\d+/)![0]);

// 1. Apply the fix on gross receipts: prefilled, effect over 1,000, so it needs the partner
let p = await as('st-01', '#line=SchC.1');
const before = await blocking(p);
await p.click('.finding-error >> text=Apply the fix');
ok(await p.inputValue('.action-form input[inputmode=decimal]') === '151300', 'fix prefills the corrected amount (151,300)');
ok(await p.locator('.action-form').innerText().then(t => t.includes('federal −4,402') && t.includes('partner must approve')), 'live tax effect shown before recording, with the partner rule');
await p.click('text=Record the adjustment');
await p.waitForSelector('.adjustment');
ok(await p.locator('.thread-head s.was').innerText() === '163,700', 'original value kept, struck through');
ok(await blocking(p) === before, 'open item addressed (−1) but partner approval pending (+1)');
await p.screenshot({ path: 'shots/p3-adjusted.png' });
await p.close();

// 2. Reviewer cannot approve; partner can
p = await as('st-02', '#line=SchC.1');
ok(await p.locator('text=Approve the adjustment').count() === 0, 'reviewer has no approve button');
await p.close();
p = await as('st-03', '#line=SchC.1');
await p.click('text=Approve the adjustment');
await p.waitForSelector('text=Approved by Helen Strand');
ok(await blocking(p) === before - 1, 'partner approval clears the blocker');
await p.goto(`${base}/`); await p.waitForSelector('.adjusted-strip');
ok(await p.locator('.adjusted-strip').innerText().then(t => t.includes('federal tax by −4,402')), 'home shows the return as adjusted');
await p.screenshot({ path: 'shots/p3-home.png' });
await p.close();

// 3. Small adjustment, no approval needed; then reversed with a reason (original comes back)
p = await as('st-01', '#line=SchC.27a.1');
await p.click('.finding-error >> text=Apply the fix');
await p.click('text=Record the adjustment');
await p.waitForSelector('.adjustment');
ok(await p.locator('.adjustment').innerText().then(t => !t.includes('needs partner approval')), 'small adjustment needs no partner');
await p.click('text=Reverse it');
await p.fill('.adjustment input', 'Client says Spotify is used for in-store playlists at shoots.');
await p.click('text=Reverse to 6,850');
await p.waitForSelector('.adjustment', { state: 'detached' });
ok(await p.locator('.thread-head .big').innerText() === '6,850', 'reversal restores the original value');
ok(await p.locator('.finding-error').count() === 1, 'reversed adjustment re-opens its open item');
await p.close();

// 4. Since I last looked: Daniel looks, Priya works, Daniel sees exactly what changed
const daniel = await browser.newPage({ viewport: { width: 1280, height: 860 } });
await daniel.addInitScript(() => localStorage.setItem('user', 'st-02'));
await daniel.goto(`${base}/`); await daniel.waitForSelector('.outline-area'); await daniel.waitForTimeout(300);
await daniel.click('text=Nothing new').catch(() => {});
await daniel.locator('.drawer >> text=Mark all as seen').click().catch(() => {});

// 5. Bulk verify a broker rollup, then undo it in one click
p = await as('st-01', '#line=F8949.A.total');
const bulk = p.locator('.hop.bulk button').filter({ hasText: 'D74' });
const label = await bulk.innerText();
const n = Number(label.match(/the (\d+) sales/)![1]);
await bulk.click();
await p.waitForSelector('.toast >> text=Undo');
ok(await p.locator('.hop-meta').filter({ hasText: `${n} verified` }).count() === 1, `one action verified ${n} sales`);
await p.screenshot({ path: 'shots/p3-bulk.png' });
await p.click('.toast >> text=Undo');
await p.waitForSelector('.toast >> text=withdrawn');
ok(await p.locator('.hop-meta').filter({ hasText: 'verified' }).count() === 0, 'undo withdrew all of them');
await p.close();

await daniel.reload(); await daniel.waitForSelector('.outline-area'); await daniel.waitForTimeout(400);
const newCount = Number((await daniel.locator('.views .has-changes').innerText()).match(/\d+/)![0]);
ok(newCount >= 2, `reviewer sees ${newCount} changes since last looking`);
await daniel.click('.views .has-changes');
await daniel.waitForSelector('.drawer li');
ok(await daniel.locator('.drawer').innerText().then(t => t.includes('verified') && t.includes('Priya Raman')), 'drawer lists who did what');
await daniel.screenshot({ path: 'shots/p3-changes.png' });
await daniel.click('text=Mark all as seen');
ok(await daniel.locator('text=Nothing new').count() === 1, 'mark as seen clears the list');

// 6. Compare versions
await daniel.click('.views >> text=Versions');
await daniel.waitForSelector('.compare');
ok(await daniel.locator('.compare').innerText().then(t => t.includes('Ridgeline K-1') && t.includes('89 lines changed')), 'v2 to v3: trigger and 89 changed lines');
await daniel.screenshot({ path: 'shots/p3-compare.png' });

// 7. What-if decision needs a reason and an authority
await daniel.click('.views >> text=What-ifs');
await daniel.waitForSelector('.whatif');
await daniel.locator('.whatif').filter({ hasText: 'HVAC' }).locator('text=Record a decision').click();
await daniel.fill('.whatif textarea', 'Whole-system replacement with a permit restores a building system; not a repair.');
await daniel.fill('.whatif input', 'Treas. Reg. 1.263(a)-3(k)(1)(vi); 1.263(a)-3(e)(2)(ii)(B)');
await daniel.click('.whatif >> text=Adopt this');
await daniel.waitForSelector('.whatif >> text=decided to adopt');
ok(true, 'election recorded with reason and authority');
await daniel.screenshot({ path: 'shots/p3-whatif.png' });
await daniel.close();

ok(errors.length === 0, `no page errors ${errors.join('; ')}`);
await browser.close();
