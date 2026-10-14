// End-to-end check of Phase 5 (records and firm view). Usage: node scripts/e2e-phase5.ts [baseUrl]
// Resets the demo to the mid-season scenario first.
import { chromium, type Page } from 'playwright';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { resetIfLive } from './live.ts';

const base = process.argv[2] ?? 'http://localhost:5173';
const local = `${homedir()}/Library/Caches/ms-playwright/chromium-1228/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;
const browser = await chromium.launch(existsSync(local) ? { executablePath: local } : {});
try {
const ok = (v: unknown, m: string) => { if (!v) throw new Error('FAIL: ' + m); console.log('ok:', m); };
const errors: string[] = [];
async function as(user: string, path: string): Promise<Page> {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.request.post(`${base}/api/session`, { data: { person: user } });
  const p = await ctx.newPage();
  p.on('pageerror', e => errors.push(e.message));
  await p.goto(`${base}${path}`);
  await p.waitForSelector('.outline-area');
  await p.waitForTimeout(300);
  return p;
}
const admin = await browser.newContext();
await admin.request.post(`${base}/api/session`, { data: { person: 'st-05' } });
ok((await admin.request.post(`${base}/api/admin/reset`, { data: { scenario: 'midseason' } })).ok(), 'reset to mid-season');

// 1. Every record renders and states its tie-out
let p = await as('st-03', '/app#view=records');
const expect: Record<string, (t: string[]) => boolean> = {
  depreciation: t => t.length === 3 && t.every(x => x.includes(' = ')),
  sales: t => t.some(x => x.includes('D74') && x.includes(' = ')) && t.some(x => x.includes('D31') && x.includes('≠')),
  books: t => t.some(x => x.includes('= Schedule C line 31 as the engine computed it')),
  rentals: t => t.length === 1,
  carryovers: t => t.length === 1,
  basis: t => t.some(x => x.includes('21,215 = 21,215')),
  state: t => t.some(x => x.includes('California share')),
};
for (const rec of ['summary', 'depreciation', 'sales', 'books', 'rentals', 'k1', 'state', 'carryovers', 'basis', 'prior']) {
  await p.goto(`${base}/app#view=records&rec=${rec}`);
  await p.waitForSelector('.record-body h2');
  const ties = await p.locator('.tie').allInnerTexts();
  if (expect[rec]) ok(expect[rec](ties), `${rec}: tie-out ${expect[rec].toString().slice(6, 60)}`);
  else ok(await p.locator('.record-body table').count() > 0, `${rec}: renders`);
}
await p.goto(`${base}/app#view=records&rec=books`); await p.waitForSelector('.adjusted-note');
ok(await p.locator('.adjusted-note').innerText().then(t => t.includes('F-005')), 'books to tax shows the Schedule C adjustments separately, by audit finding');
await p.close();

// 2. View log: firm administrator sees it, a preparer does not (server-side)
p = await as('st-05', '/app#view=firm');
ok(await p.locator('.firm').innerText().then(t => t.includes('Refused: no clearance') && t.includes('Marcus Bell')), 'firm administrator sees the view log, including the refusal');
await p.close();
p = await as('st-01', '/app#view=firm');
ok(await p.locator('.firm').innerText().then(t => t.includes('The view log is for the firm administrator')), 'preparer is told the view log is not theirs');
const evs = await (await p.context().request.get(`${base}/api/events`)).json();
ok(!evs.some((e: any) => e.type === 'sensitive_view_refused' && e.actor !== 'st-01'), 'server does not send other people\'s views to a preparer');

// 3. Time and budget; assignment
const before = Number((await p.locator('tr:has-text("Business (Business)") td').nth(5).innerText()));
await p.selectOption('.firm select[aria-label="Area"]', 'business');
await p.fill('.firm input[aria-label="Hours"]', '1.5');
await p.click('text=Log time');
await p.waitForTimeout(500);
ok(Number(await p.locator('tr:has-text("Business (Business)") td').nth(5).innerText()) === before + 1.5, 'logged time adds to the area');
ok(await p.locator('tr:has-text("Investments and digital assets") td').first().innerText().then(t => t.includes('Marcus Bell')), 'mid-season assignment shows Marcus on investments');
await p.close();

// 4. Search finds what people wrote, and opens the line it was written on
p = await as('st-02', '/app');
await p.keyboard.press('Meta+k');
await p.keyboard.type('CryptoNorth');
await p.waitForTimeout(200);
await p.keyboard.press('Enter');
await p.waitForSelector('.thread');
ok(p.url().includes('line=F8949.H.C6'), 'search on a client answer opens the line it answers');
await p.close();

ok(errors.length === 0, `no page errors ${errors.join('; ')}`);
} finally {
  await browser.close();
  await resetIfLive(base);
}
