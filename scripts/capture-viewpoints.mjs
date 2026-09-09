#!/usr/bin/env node
/**
 * 定点を撮り、測り、並べる — この World を「見る」ための仕組み。
 *
 * なぜこれが要るのか。このプロジェクトで見つかった不具合の大半は、データが
 * 正しいまま見た目が壊れていたもの（縁端の線が白い／信号機が列車の当たる高さ
 * にある／川が地面の下にある／森が空の帯で終わる）で、どれも「見て」初めて
 * 分かった。ところがその「見る」は毎回、使い捨ての shoot.mjs を書き、カメラ
 * 座標を手で計算し、PNG を1枚ずつ眺める作業だった。同じ構図を二度撮れないので、
 * 直す前と後を比べることもできなかった。
 *
 * ここでやること:
 *   1. scripts/viewpoints.json の定点を、**名前の付いた地物からの相対位置**で
 *      解決する。構内の寸法が変われば定点も一緒に動く。
 *   2. 各フレームを測る。空の比・植生比・輝度・コントラスト・エッジ密度・色数。
 *      これらは「真っ黒」「空しか写っていない」「地面に埋まっている」「霧で
 *      潰れた」「World が空になった」を機械が気づける量。
 *   3. 一覧画像（コンタクトシート）に並べる。
 *   4. 前回の測定と比べ、閾値を超えた変化を回帰として報告する。
 *
 * フレーム時間は測らない。ここのラスタライザはソフトウェアで、携帯やPCのGPUの
 * 代わりにはならない。描画コストは scripts/measure-budget.mjs が別に測る。
 *
 *   npx vite preview --host 127.0.0.1 --port 4174 --strictPort &
 *   node scripts/capture-viewpoints.mjs [--out build/viewpoints] [--baseline]
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const jpeg = require('jpeg-js');
let chromium;
try { ({ chromium } = require('playwright')); }
catch { ({ chromium } = require('/opt/node22/lib/node_modules/playwright/index.js')); }

const args = process.argv.slice(2);
const argOf = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const OUT = join(ROOT, argOf('--out', 'build/viewpoints'));
const IS_BASELINE = args.includes('--baseline');
// CI のラスタライザは手元と同じ絵を出すとは限らないので、差分比較は明示的に切れる。
// 破綻の検出（真っ黒・単色・空だけ）は環境に依らないので常に走る。
const NO_COMPARE = args.includes('--no-baseline');
const URL = process.env.MIDORI_URL ?? 'http://127.0.0.1:4174/MIDORI/';
const BASELINE = join(ROOT, 'scripts/viewpoint-baseline.json');
const W = 900, H = 560;
const DEG = Math.PI / 180;

/* ---------------------------------------------------------------- *
 * 一枚のフレームから測れること
 *
 * 空・植生・輝度は色から。エッジ密度は隣の画素との差の平均で、World に
 * どれだけ「もの」があるかの代わりになる — 木を全部消すとここが落ちる。
 * 色数は 5bit に量子化した相異なる色の数で、単色に潰れたことを捕まえる。
 * ---------------------------------------------------------------- */
function measure(jpegBuffer) {
  const im = jpeg.decode(jpegBuffer, { useTArray: true });
  const { width, height, data } = im;
  let sky = 0, green = 0, lumaSum = 0, luma2 = 0, n = 0;
  const colours = new Set();
  const lum = new Float32Array(width * height);
  let firstNonSkyRow = height;

  for (let y = 0; y < height; y++) {
    let rowSky = 0;
    for (let x = 0; x < width; x++) {
      const k = (y * width + x) * 4;
      const R = data[k], G = data[k + 1], B = data[k + 2];
      const L = 0.2126 * R + 0.7152 * G + 0.0722 * B;
      lum[y * width + x] = L;
      lumaSum += L; luma2 += L * L; n++;
      // 空: 青が赤より明確に強く、かつ明るい
      const isSky = B > R + 18 && L > 120;
      if (isSky) { sky++; rowSky++; }
      // 植生: 緑が他の2つより強い
      if (G > R + 12 && G > B + 12) green++;
      colours.add(((R >> 3) << 10) | ((G >> 3) << 5) | (B >> 3));
    }
    if (firstNonSkyRow === height && rowSky < width * 0.5) firstNonSkyRow = y;
  }

  // エッジ密度 — 右と下との輝度差の平均。World の「詰まり具合」。
  let edge = 0, edgeN = 0;
  for (let y = 0; y < height - 1; y += 2) {
    for (let x = 0; x < width - 1; x += 2) {
      const i = y * width + x;
      edge += Math.abs(lum[i] - lum[i + 1]) + Math.abs(lum[i] - lum[i + width]);
      edgeN++;
    }
  }
  const mean = lumaSum / n;
  return {
    sky: +(sky / n).toFixed(4),
    green: +(green / n).toFixed(4),
    luma: +mean.toFixed(1),
    contrast: +Math.sqrt(Math.max(0, luma2 / n - mean * mean)).toFixed(1),
    edges: +(edge / edgeN / 2).toFixed(2),
    unique: colours.size,
    horizon: +(firstNonSkyRow / height).toFixed(3),
  };
}

/** 空 or 真っ黒 or 単色 — 撮れていないことの検出。閾値ではなく破綻の検出。 */
function sanity(m) {
  const bad = [];
  if (m.unique < 40) bad.push('色が40未満 — 単色に潰れている（描画されていない可能性）');
  if (m.luma < 12) bad.push('ほぼ真っ黒');
  if (m.luma > 245) bad.push('ほぼ真っ白（露出破綻）');
  if (m.sky > 0.92) bad.push('画面のほぼ全部が空 — カメラが上を向いているか World が無い');
  if (m.edges < 0.6 && m.sky < 0.9) bad.push('エッジがほぼ無い — 何も建っていない可能性');
  return bad;
}

/** viewpoints.json の from/look を実座標に解決する。 */
async function resolve(page, spec) {
  const centre = async (name) => page.evaluate((n) => window.__world.centreOf(n), name);
  let from;
  if (spec.from.world) from = spec.from.world;
  else {
    const c = await centre(spec.from.feature);
    if (!c) throw new Error(`定点 ${spec.id}: 地物 ${spec.from.feature} が World に無い`);
    const o = spec.from.offset ?? [0, 0, 0];
    from = [c[0] + o[0], c[1] + o[1], c[2] + o[2]];
  }
  let at;
  if (spec.look.world) at = spec.look.world;
  else if (spec.look.feature) {
    const c = await centre(spec.look.feature);
    if (!c) throw new Error(`定点 ${spec.id}: 注視先 ${spec.look.feature} が無い`);
    at = c;
  } else {
    // 方位と俯角から 300 m 先の点を作る
    const b = (spec.look.bearing ?? 0) * DEG;
    const p = (spec.look.pitch ?? 0) * DEG;
    const d = 300;
    at = [from[0] + Math.sin(b) * d * Math.cos(p), from[1] + Math.sin(p) * d, from[2] - Math.cos(b) * d * Math.cos(p)];
  }
  if (spec.look.pitch !== undefined && spec.look.feature) at = [at[0], at[1] + Math.tan(spec.look.pitch * DEG) * 0.0, at[2]];
  return { from, at };
}

/** 撮った JPEG を1枚に並べる。 */
function contactSheet(shots, cols = 3) {
  const decoded = shots.map((s) => jpeg.decode(s.buffer, { useTArray: true }));
  const scale = 3;
  const tw = Math.floor(W / scale), th = Math.floor(H / scale);
  const pad = 6, label = 14;
  const rows = Math.ceil(decoded.length / cols);
  const sw = cols * (tw + pad) + pad;
  const sh = rows * (th + pad + label) + pad;
  const out = new Uint8Array(sw * sh * 4).fill(28);
  for (let i = 0; i < decoded.length; i++) {
    const im = decoded[i];
    const cx = pad + (i % cols) * (tw + pad);
    const cy = pad + Math.floor(i / cols) * (th + pad + label) + label;
    for (let y = 0; y < th; y++) {
      const sy = Math.min(im.height - 1, Math.floor((y / th) * im.height));
      for (let x = 0; x < tw; x++) {
        const sx = Math.min(im.width - 1, Math.floor((x / tw) * im.width));
        const s = (sy * im.width + sx) * 4, d = ((cy + y) * sw + cx + x) * 4;
        out[d] = im.data[s]; out[d + 1] = im.data[s + 1]; out[d + 2] = im.data[s + 2]; out[d + 3] = 255;
      }
    }
    // ラベル代わりの色帯（不具合があれば赤）
    const flag = shots[i].problems.length > 0;
    for (let y = 0; y < label - 3; y++) for (let x = 0; x < tw; x++) {
      const d = ((cy - label + y) * sw + cx + x) * 4;
      out[d] = flag ? 200 : 90; out[d + 1] = flag ? 50 : 110; out[d + 2] = flag ? 45 : 100; out[d + 3] = 255;
    }
  }
  for (let i = 3; i < out.length; i += 4) out[i] = 255;
  return jpeg.encode({ data: out, width: sw, height: sh }, 88).data;
}

async function main() {
  const spec = JSON.parse(readFileSync(join(ROOT, 'scripts/viewpoints.json'), 'utf8'));
  mkdirSync(OUT, { recursive: true });
  const exe = '/opt/pw-browsers/chromium';
  const browser = await chromium.launch(existsSync(exe) ? { executablePath: exe } : {});
  const page = await browser.newPage({ viewport: { width: W, height: H } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 200)));

  let waited = 0;
  for (;;) {
    try { await page.goto(URL, { waitUntil: 'networkidle', timeout: 30000 }); break; }
    catch (e) { waited += 30; if (waited > 150) throw e; }
  }
  await page.waitForFunction(() => window.__world, null, { timeout: 180000 });
  await page.evaluate(() => window.__world.ready);
  await page.evaluate(() => window.__world.frames(4));
  await page.evaluate(() => {
    window.__world.pause();
    for (const id of ['blocker', 'hint']) { const e = document.getElementById(id); if (e) e.style.display = 'none'; }
  });

  const shots = [];
  for (const vp of spec.viewpoints) {
    const { from, at } = await resolve(page, vp);
    // look() renders synchronously, and the World is paused, so there is no
    // frame to wait for — waiting on one here is what hung the first version.
    await page.evaluate(([f, a]) => window.__world.look(f, a), [from, at]);
    await page.waitForTimeout(220);
    const buffer = await page.screenshot({ type: 'jpeg', quality: 88 });
    writeFileSync(join(OUT, `${vp.id}.jpg`), buffer);
    const m = measure(buffer);
    const problems = sanity(m);
    shots.push({ id: vp.id, name: vp.name, from, at, metrics: m, problems, buffer });
  }
  await browser.close();

  writeFileSync(join(OUT, 'contact-sheet.jpg'), contactSheet(shots));
  const report = {
    captured_at: new Date().toISOString(),
    viewport: [W, H],
    page_errors: errors,
    views: shots.map(({ buffer, ...r }) => r),
  };
  writeFileSync(join(OUT, 'metrics.json'), `${JSON.stringify(report, null, 2)}\n`);

  console.log('=== 定点撮影 ===');
  console.log('id                 sky   green  luma  contr edges uniq  horizon');
  for (const s of shots) {
    const m = s.metrics;
    console.log(`${s.id.padEnd(18)} ${String(m.sky).padEnd(6)} ${String(m.green).padEnd(6)} `
      + `${String(m.luma).padEnd(5)} ${String(m.contrast).padEnd(5)} ${String(m.edges).padEnd(5)} `
      + `${String(m.unique).padEnd(5)} ${m.horizon}`);
    for (const p of s.problems) console.log(`    ！ ${p}`);
  }
  if (errors.length) { console.log('\nページのエラー:'); for (const e of errors) console.log('  ' + e); }

  // 前回との比較
  if (IS_BASELINE) {
    writeFileSync(BASELINE, `${JSON.stringify({
      note: 'capture-viewpoints.mjs --baseline で更新する基準値。差分の判定にだけ使い、正しさの根拠にはしない。',
      captured_at: report.captured_at,
      views: Object.fromEntries(shots.map((s) => [s.id, s.metrics])),
    }, null, 2)}\n`);
    console.log(`\n基準値を更新した → ${BASELINE}`);
  } else if (!NO_COMPARE && existsSync(BASELINE)) {
    const base = JSON.parse(readFileSync(BASELINE, 'utf8')).views;
    const LIMITS = { sky: 0.08, green: 0.08, luma: 22, contrast: 12, edges: 1.2, unique: 0.4 };
    const drift = [];
    for (const s of shots) {
      const b = base[s.id];
      if (!b) { drift.push(`${s.id}: 基準値に無い（新しい定点）`); continue; }
      for (const [k, lim] of Object.entries(LIMITS)) {
        const d = k === 'unique' ? Math.abs(s.metrics[k] - b[k]) / Math.max(1, b[k]) : Math.abs(s.metrics[k] - b[k]);
        if (d > lim) drift.push(`${s.id}.${k}: ${b[k]} → ${s.metrics[k]}（限度 ${lim}）`);
      }
    }
    console.log('');
    if (drift.length === 0) console.log('基準値との差: なし');
    else { console.log(`基準値からの変化 ${drift.length} 件 — 意図した変更か確かめること:`); for (const d of drift) console.log('  ・' + d); }
  }
  const broken = shots.filter((s) => s.problems.length);
  console.log(`\n${broken.length === 0 ? 'PASS' : 'FAIL'} — ${shots.length} 定点、破綻 ${broken.length} 件`);
  console.log(`→ ${OUT}/contact-sheet.jpg`);
  if (broken.length) process.exitCode = 1;
}

main();
