#!/usr/bin/env node
/**
 * What this World costs to draw, at the size it is actually played.
 *
 * The operator asked whether it is heavy on the phone, and nothing here
 * could answer. This measures the numbers that decide it, at an iPhone's
 * viewport and device pixel ratio.
 *
 * WHAT IS NOT MEASURED, AND WHY. Frame time. The rasteriser in this session's
 * headless Chromium is software; it renders this World at under one frame a
 * second, which says nothing about a handset's GPU. Quoting it as a phone
 * figure would be a fabrication. What CAN be measured honestly is the work
 * handed to whatever GPU is there — draw calls, triangles, resident
 * geometries and textures, shader programs — and the bytes that have to come
 * down the wire before any of it can start.
 *
 * Run against a served build:
 *   npx vite preview --host 127.0.0.1 --port 4174 --strictPort &
 *   node scripts/measure-budget.mjs
 */

import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
let chromium;
try {
  ({ chromium } = require('playwright'));
} catch {
  ({ chromium } = require('/opt/node22/lib/node_modules/playwright/index.js'));
}

const URL = process.env.MIDORI_URL ?? 'http://127.0.0.1:4174/MIDORI/';
/** iPhone 14 Pro in portrait: 393 x 852 CSS px at DPR 3. The renderer caps
 *  its pixel ratio at 2, so 786 x 1704 device pixels is what it draws. */
const VIEWPORTS = [
  { name: 'iPhone 14 Pro 縦', width: 393, height: 852, dpr: 3 },
  { name: 'iPhone SE 縦', width: 375, height: 667, dpr: 2 },
  { name: 'デスクトップ', width: 1440, height: 900, dpr: 1 },
];

const kb = (bytes) => `${(bytes / 1024).toFixed(0)} KB`;

async function measure(browser, vp) {
  const context = await browser.newContext({
    viewport: { width: vp.width, height: vp.height },
    deviceScaleFactor: vp.dpr,
  });
  const page = await context.newPage();

  const transfer = new Map();
  page.on('response', async (res) => {
    try {
      const headers = res.headers();
      const length = Number(headers['content-length'] ?? 0);
      const url = res.url();
      const ext = (url.split('?')[0].match(/\.([a-z0-9]+)$/i) ?? [, 'other'])[1].toLowerCase();
      transfer.set(url, { ext, bytes: length || (await res.body().catch(() => Buffer.alloc(0))).length });
    } catch { /* a response body that cannot be read is not worth failing over */ }
  });

  const started = Date.now();
  await page.goto(URL, { waitUntil: 'networkidle', timeout: 180000 });
  await page.waitForFunction(() => window.__world, null, { timeout: 180000 });
  await page.evaluate(() => window.__world.ready);
  const readyMs = Date.now() - started;
  await page.evaluate(() => window.__world.frames(3));

  const stats = await page.evaluate(() => window.__world.stats());
  // Where the triangles are. A total is not actionable; this says which
  // handful of meshes to argue with. Counted off the geometry rather than
  // off the renderer, so instanced meshes are counted once per instance —
  // which is what the GPU actually draws.
  const census = await page.evaluate(() => {
    const rows = new Map();
    const scene = window.__world.scene?.() ?? null;
    const add = (name, tris, calls) => {
      const row = rows.get(name) ?? { tris: 0, meshes: 0 };
      row.tris += tris;
      row.meshes += calls;
      rows.set(name, row);
    };
    const walk = (o) => {
      const g = o.geometry;
      if (g) {
        const index = g.index ? g.index.count : (g.attributes.position?.count ?? 0);
        const instances = o.isInstancedMesh ? o.count : 1;
        let label = o.userData?.inspect?.kind
          ?? o.userData?.realityData?.properties?.structure_type
          ?? (o.name || o.parent?.name || o.type);
        label = String(label).replace(/_[0-9a-z]{4,}$/i, '');
        add(label, (index / 3) * instances, 1);
      }
      for (const c of o.children ?? []) walk(c);
    };
    if (scene) walk(scene);
    return [...rows.entries()].map(([name, r]) => ({ name, ...r }));
  });
  await context.close();

  const byExt = new Map();
  let total = 0;
  for (const { ext, bytes } of transfer.values()) {
    byExt.set(ext, (byExt.get(ext) ?? 0) + bytes);
    total += bytes;
  }
  return { vp, stats, readyMs, total, byExt, census };
}

async function main() {
  const executablePath = '/opt/pw-browsers/chromium';
  const browser = await chromium.launch(
    (await import('node:fs')).existsSync(executablePath) ? { executablePath } : {},
  );

  console.log('=== 描画の見積り ===');
  console.log('（フレーム時間は測っていない。ここのラスタライザはソフトウェアで、');
  console.log('　携帯のGPUの代わりにはならない。測っているのはGPUに渡す仕事の量）');
  console.log('');

  let first = null;
  for (const vp of VIEWPORTS) {
    const r = await measure(browser, vp);
    first ??= r;
    const s = r.stats;
    console.log(`${r.vp.name}  ${r.vp.width}x${r.vp.height} @${r.vp.dpr}x`);
    console.log(`  描画コール ${s.drawCalls}   三角形 ${s.triangles.toLocaleString()}`);
    console.log(`  常駐 ジオメトリ ${s.geometries} / テクスチャ ${s.textures} / シェーダ ${s.programs}`);
    console.log(`  シーンのオブジェクト ${s.objects}   起動まで ${(r.readyMs / 1000).toFixed(1)} s（ソフトウェア描画込み）`);
    console.log('');
  }

  const census = (first.census ?? []).filter((r) => r.tris > 0)
    .sort((a, b) => b.tris - a.tris).slice(0, 12);
  if (census.length > 0) {
    const all = census.reduce((a, r) => a + r.tris, 0);
    console.log('三角形の行き先（多い順）');
    for (const r of census) {
      console.log(`  ${r.name.padEnd(22)} ${Math.round(r.tris).toLocaleString().padStart(11)}`
        + `  (${((r.tris / all) * 100).toFixed(0)}%, メッシュ ${r.meshes})`);
    }
    console.log('');
  }

  console.log('転送量（初回、キャッシュなし）');
  const sorted = [...first.byExt.entries()].sort((a, b) => b[1] - a[1]);
  for (const [ext, bytes] of sorted) console.log(`  ${ext.padEnd(8)} ${kb(bytes).padStart(9)}`);
  console.log(`  ${'合計'.padEnd(7)} ${kb(first.total).padStart(9)}`);

  await browser.close();
}

main();
