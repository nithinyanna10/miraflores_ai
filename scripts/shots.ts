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
const shots: [string, string, number][] = [
  ['home', '', 1280],
  ['wages', '#line=F1040.1a', 1280],
  ['rsu-lot', '#line=F8949.B.N1', 1280],
  ['ca-wages', '#line=SchCA540NR.1.E', 1280],
  ['box-a-rollup', '#line=F8949.A.total', 1280],
  ['interest', '#line=SchB.2', 1280],
  ['qa-source', '#line=Sch1.17&src=qa-25', 1280],
  ['tablet', '#line=SchC.1', 1024],
  ['paystub', '#src=D73', 1280],
];
for (const [name, hash, width] of shots) {
  const page = await browser.newPage({ viewport: { width, height: 860 } });
  await page.goto(base + '/' + hash);
  await page.waitForSelector('.outline-row');
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${out}${name}.png` });
  await page.close();
}
await browser.close();
console.log('wrote', shots.length, 'screenshots to shots/');
