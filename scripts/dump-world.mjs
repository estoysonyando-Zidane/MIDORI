#!/usr/bin/env node
/**
 * Loads the built World in a headless browser and writes what was actually
 * placed in it, via window.__world.dump().
 *
 * This is the input to scripts/check-joins.mjs. Nothing here renders for
 * appearance — the point is the join between Reality Data and the solids
 * built from it, which needs no picture at all.
 *
 * Waiting is on RENDERED FRAMES, never on wall-clock time. The headless
 * rasteriser here runs at about 0.8 fps, so a timeout is a guess: too short
 * on this machine and silently flaky on a faster one.
 *
 * Run:  npm run build && npx vite preview --port 4174 &
 *       node scripts/dump-world.mjs [outputPath]
 */

import { writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
/**
 * Playwright comes from the project where it is a devDependency, and from
 * the sandbox's global install where it is not installed locally. Hard-coding
 * the sandbox path made this script unrunnable anywhere else, which is a poor
 * property for something meant to run in CI.
 */
function loadChromium() {
  for (const specifier of ['playwright', '/opt/node22/lib/node_modules/playwright/index.js']) {
    try {
      return require(specifier).chromium;
    } catch {
      // try the next one
    }
  }
  throw new Error('playwright not found: install it, or run where it is on the module path');
}
const chromium = loadChromium();
const EXECUTABLE = process.env.PLAYWRIGHT_CHROMIUM ?? '/opt/pw-browsers/chromium';

const URL = process.env.MIDORI_URL ?? 'http://127.0.0.1:4174/MIDORI/';
const OUT = process.argv[2] ?? 'world-dump.json';

// In CI, `playwright install` puts the browser where Playwright looks for
// it, so no executablePath is needed; in the sandbox it is at a fixed path.
const { existsSync } = await import('node:fs');
const browser = await chromium.launch(
  existsSync(EXECUTABLE) ? { executablePath: EXECUTABLE } : {},
);
const page = await browser.newPage({ viewport: { width: 900, height: 600 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e).slice(0, 300)));

await page.goto(URL, { waitUntil: 'networkidle', timeout: 180000 });
await page.waitForFunction(() => window.__world, null, { timeout: 180000 });
// Everything the World builds is added before the first frame it draws, so
// a handful of real frames is "settled".
await page.evaluate(() => window.__world.frames(4));

const dump = await page.evaluate(() => window.__world.dump());
const stats = await page.evaluate(() => window.__world.stats());
await browser.close();

writeFileSync(OUT, `${JSON.stringify({ stats, errors, objects: dump }, null, 2)}\n`);
console.log(`dumped ${dump.length} placed objects -> ${OUT}`);
console.log(`  scene objects ${stats.objects}, draw calls ${stats.drawCalls}, triangles ${stats.triangles}`);
if (errors.length) {
  console.error(`  page errors: ${errors.length}`);
  for (const e of errors) console.error(`    ${e}`);
  process.exit(1);
}
