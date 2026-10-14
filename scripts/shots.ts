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
  ['signin-mid-loop', '', 1280, null, 4600, false],
  ['signin-reduced-motion', '', 1280, null, 300, true],
  ['home', '', 1280, 'st-02', 400, false],
  ['rsu-lot', '#line=F8949.B.N1', 1280, 'st-02', 400, false],
  ['document', '#src=D09', 1280, 'st-02', 400, false],
  ['ca-wages', '#line=SchCA540NR.1.E', 1280, 'st-02', 400, false],
  ['tablet', '#line=SchC.1', 1024, 'st-02', 400, false],
  ['signin-tablet', '', 900, null, 300, true],
];
for (const [name, hash, width, user, wait, reduced] of shots) {
  const page = await browser.newPage({ viewport: { width, height: 860 }, reducedMotion: reduced ? 'reduce' : 'no-preference' });
  await page.addInitScript(u => { if (u) localStorage.setItem('user', u); else localStorage.removeItem('user'); }, user);
  await page.goto(base + '/' + hash);
  await page.waitForSelector(user ? '.outline-area' : '.people');
  await page.waitForTimeout(wait);
  await page.screenshot({ path: `${out}${name}.png` });
  await page.close();
}
await browser.close();
console.log('wrote', shots.length, 'screenshots to shots/');
