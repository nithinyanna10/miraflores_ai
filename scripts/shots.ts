// Screenshots of key screens for design review. Usage: node scripts/shots.ts [baseUrl]
import { chromium } from 'playwright';
import { existsSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';

const base = process.argv[2] ?? 'http://localhost:5173';
const out = new URL('../shots/', import.meta.url).pathname;
mkdirSync(out, { recursive: true });
// Use the Chromium already on this machine if Playwright's pinned build is missing.
const local = `${homedir()}/Library/Caches/ms-playwright/chromium-1228/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;
const browser = await chromium.launch(existsSync(local) ? { executablePath: local } : {});
// [name, hash, width, user (null = signed out), wait ms, reduced motion]
const shots: [string, string, number, string | null, number, boolean][] = [
  ['signin-mid-loop', '', 1440, null, 3300, false],
  ['signin-reduced-motion', '', 1440, null, 300, true],
  ['signin-1280', '', 1280, null, 300, true],
  ['home', '', 1280, 'st-02', 400, false],
  ['rsu-lot', '#line=F8949.B.N1', 1280, 'st-02', 400, false],
  ['document', '#src=D09', 1280, 'st-02', 400, false],
  ['ca-wages', '#line=SchCA540NR.1.E', 1280, 'st-02', 400, false],
  ['tablet', '#line=SchC.1', 1024, 'st-02', 400, false],
  ['signin-tablet', '', 900, null, 300, true],
];
for (const [name, hash, width, user, wait, reduced] of shots) {
  const ctx = await browser.newContext({ viewport: { width, height: 860 }, reducedMotion: reduced ? 'reduce' : 'no-preference' });
  if (user) await ctx.request.post(`${base}/api/session`, { data: { person: user } });
  const page = await ctx.newPage();
  await page.goto(user ? `${base}/app${hash}` : `${base}/`);
  await page.waitForSelector(user ? '.outline-area' : '.person');
  await page.waitForTimeout(wait);
  await page.screenshot({ path: `${out}${name}.png` });
  await page.close();
}
await browser.close();
console.log('wrote', shots.length, 'screenshots to shots/');
