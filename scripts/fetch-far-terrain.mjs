#!/usr/bin/env node
/**
 * The land beyond the World: 斜里岳 and the hills that close 緑町 in.
 *
 * The detailed World is 5 km across. Everything the operator named next —
 * 斜里岳 18 km east, 摩周湖の展望台 25 km south, 神の子池 9 km, 清里の市街
 * 15 km — is outside it, and the answer is not to make the walkable World
 * forty kilometres wide. It is that they should be VISIBLE. Standing on the
 * platform at 緑, 斜里岳 fills the eastern skyline; this World's horizon was
 * a flat band of sky, which is the largest single untruth left in it.
 *
 * 国土地理院 serves its elevation tiles at z=10 as well as z=14, one tile
 * covering 28 km at this latitude, so a 70 km surround is twelve tiles at
 * about 110 m a sample. The same seamless aerial photography covers it at
 * z=11. Neither is detailed enough to walk on and neither is meant to be:
 * this is the shape and colour of the land past the edge, and nothing else.
 *
 * Run: node scripts/fetch-far-terrain.mjs
 */

import { writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(ROOT, 'public/assets/terrain');

/** The World's origin: 緑駅. */
const LAT0 = 43.71802;
const LON0 = 144.50575;
/** How far out the far terrain reaches. 35 km takes in 斜里岳 (18 km),
 *  摩周湖第一展望台 (25 km), 神の子池 (9 km) and 清里の市街 (15 km). */
const REACH_M = 35000;
/** Samples across the box. 288 over 70 km is 243 m a cell — enough for a
 *  mountain's silhouette at 18 km, and 166 KB as Int16. */
const GRID = 288;

const DEM_ZOOM = 12;
const PHOTO_ZOOM = 11;
const TILE = 256;

const bounds = {
  south: LAT0 - REACH_M / 111132.0,
  north: LAT0 + REACH_M / 111132.0,
  west: LON0 - REACH_M / (111320.0 * Math.cos((LAT0 * Math.PI) / 180)),
  east: LON0 + REACH_M / (111320.0 * Math.cos((LAT0 * Math.PI) / 180)),
};

const lonToX = (lon, z) => ((lon + 180) / 360) * 2 ** z;
const latToY = (lat, z) => {
  const r = (lat * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z;
};

/** node fetch is refused by the tile service; curl is not. */
function get(url) {
  try {
    return execFileSync('curl', ['-sS', '--fail', url], { maxBuffer: 1 << 28 });
  } catch {
    return null;
  }
}

function fetchDem() {
  const x0 = Math.floor(lonToX(bounds.west, DEM_ZOOM));
  const x1 = Math.floor(lonToX(bounds.east, DEM_ZOOM));
  const y0 = Math.floor(latToY(bounds.north, DEM_ZOOM));
  const y1 = Math.floor(latToY(bounds.south, DEM_ZOOM));

  const tiles = new Map();
  let got = 0;
  for (let x = x0; x <= x1; x++) {
    for (let y = y0; y <= y1; y++) {
      const body = get(`https://cyberjapandata.gsi.go.jp/xyz/dem/${DEM_ZOOM}/${x}/${y}.txt`);
      if (!body) continue;
      const rows = body.toString('utf8').trim().split('\n')
        .map((line) => line.split(',').map((v) => (v === 'e' ? NaN : Number(v))));
      tiles.set(`${x}/${y}`, rows);
      got++;
    }
  }
  console.log(`  標高タイル ${got} 枚 (z=${DEM_ZOOM})`);

  // MAXIMUM over each output cell, not a point sample.
  //
  // This was a point sample at z=10 and it cost the World its mountain.
  // A 243 m cell that happens to land on a shoulder records the shoulder,
  // so every summit in the far terrain came out low — 斜里岳 at 1,477 m
  // against its real 1,547 m. That 70 m is not cosmetic: measured from the
  // platform, the ridge 7.3 km east subtends 4.34° and the sunken summit
  // only 4.30°, so the mountain was hidden behind the ridge by four
  // hundredths of a degree. At its true height it clears by 0.18°.
  //
  // A silhouette is made of ridge lines, and a ridge line is a maximum.
  // Sampling at z=12 (27.6 m) and taking the highest sample in each output
  // cell — about 80 of them — is what the far terrain should always have
  // done. Nothing is invented: every value is still 国土地理院's own.
  const SUB = 9;                       // 9x9 samples per output cell
  const heights = new Int16Array(GRID * GRID);
  let min = Infinity;
  let max = -Infinity;
  let missing = 0;
  const sampleAt = (lat, lon) => {
    const fy = latToY(lat, DEM_ZOOM);
    const fx = lonToX(lon, DEM_ZOOM);
    const ty = Math.floor(fy);
    const tx = Math.floor(fx);
    const py = Math.min(TILE - 1, Math.floor((fy - ty) * TILE));
    const px = Math.min(TILE - 1, Math.floor((fx - tx) * TILE));
    return tiles.get(`${tx}/${ty}`)?.[py]?.[px];
  };
  const dLat = (bounds.north - bounds.south) / GRID;
  const dLon = (bounds.east - bounds.west) / GRID;
  for (let j = 0; j < GRID; j++) {
    const lat0 = bounds.north - (j / GRID) * (bounds.north - bounds.south);
    for (let i = 0; i < GRID; i++) {
      const lon0 = bounds.west + (i / GRID) * (bounds.east - bounds.west);
      let best = NaN;
      for (let sj = 0; sj < SUB; sj++) {
        const lat = lat0 - ((sj + 0.5) / SUB) * dLat;
        for (let si = 0; si < SUB; si++) {
          const lon = lon0 + ((si + 0.5) / SUB) * dLon;
          const v = sampleAt(lat, lon);
          if (Number.isFinite(v) && !(v <= best)) best = v;
        }
      }
      const h = Number.isFinite(best) ? best : 0;
      if (!Number.isFinite(best)) missing++;
      heights[j * GRID + i] = Math.round(h);
      if (h < min) min = h;
      if (h > max) max = h;
    }
  }
  return { heights, min, max, missing };
}

/**
 * The drape. Decoded and re-encoded with jpeg-js rather than a canvas: the
 * repository already depends on it for the near orthophoto, and adding a
 * native canvas build for one image is a poor trade.
 */
async function fetchPhoto() {
  const jpeg = (await import('jpeg-js')).default;
  const x0 = Math.floor(lonToX(bounds.west, PHOTO_ZOOM));
  const x1 = Math.floor(lonToX(bounds.east, PHOTO_ZOOM));
  const y0 = Math.floor(latToY(bounds.north, PHOTO_ZOOM));
  const y1 = Math.floor(latToY(bounds.south, PHOTO_ZOOM));

  const mw = (x1 - x0 + 1) * TILE;
  const mh = (y1 - y0 + 1) * TILE;
  const mosaic = new Uint8Array(mw * mh * 4).fill(110);
  let got = 0;
  for (let x = x0; x <= x1; x++) {
    for (let y = y0; y <= y1; y++) {
      const body = get(`https://cyberjapandata.gsi.go.jp/xyz/seamlessphoto/${PHOTO_ZOOM}/${x}/${y}.jpg`);
      if (!body || body.length < 1000) continue;
      let tile;
      try {
        tile = jpeg.decode(body, { useTArray: true });
      } catch {
        continue;
      }
      const ox = (x - x0) * TILE;
      const oy = (y - y0) * TILE;
      for (let r = 0; r < tile.height && oy + r < mh; r++) {
        for (let c = 0; c < tile.width && ox + c < mw; c++) {
          const s = (r * tile.width + c) * 4;
          const d = ((oy + r) * mw + (ox + c)) * 4;
          mosaic[d] = tile.data[s];
          mosaic[d + 1] = tile.data[s + 1];
          mosaic[d + 2] = tile.data[s + 2];
          mosaic[d + 3] = 255;
        }
      }
      got++;
    }
  }
  console.log(`  空中写真タイル ${got} 枚 (z=${PHOTO_ZOOM})`);
  if (got === 0) return false;

  // Resample out of Web Mercator into the same lat/lon grid the DEM uses, so
  // the drape and the shape line up cell for cell.
  const SIZE = 1024;
  const out = new Uint8Array(SIZE * SIZE * 4);
  for (let j = 0; j < SIZE; j++) {
    const lat = bounds.north - ((j + 0.5) / SIZE) * (bounds.north - bounds.south);
    const sy = Math.min(mh - 1, Math.max(0, Math.round((latToY(lat, PHOTO_ZOOM) - y0) * TILE)));
    for (let i = 0; i < SIZE; i++) {
      const lon = bounds.west + ((i + 0.5) / SIZE) * (bounds.east - bounds.west);
      const sx = Math.min(mw - 1, Math.max(0, Math.round((lonToX(lon, PHOTO_ZOOM) - x0) * TILE)));
      const s = (sy * mw + sx) * 4;
      const d = (j * SIZE + i) * 4;
      out[d] = mosaic[s];
      out[d + 1] = mosaic[s + 1];
      out[d + 2] = mosaic[s + 2];
      out[d + 3] = 255;
    }
  }
  // COLOUR-MATCH TO THE NEAR GROUND.
  //
  // The seamless photography served at z=11 over this region is a satellite
  // composite, not the aerial imagery served at z=16: geographically exact —
  // オホーツク海, 屈斜路湖, 摩周湖, 斜里岳's star of ridges and the 斜里 plain's
  // field grid are all in it — but dark and heavily blue, so farmland reads
  // as navy where the near ground three kilometres away reads as olive. The
  // two meet at the World's edge and the seam was the loudest thing in the
  // frame.
  //
  // The fix is not a taste adjustment: it is measured. Both images cover the
  // near World's bounds, so that overlap is the same ground photographed
  // twice, and the transform that carries one channel's mean and spread onto
  // the other's is the correction. Geography is untouched; only tone is.
  //
  // A plain ratio was tried first and is wrong: the satellite red channel is
  // dark enough that matching its MEAN by multiplication wants a gain of six,
  // which drives everything above R=41 to 255 and leaves the rest black. The
  // photograph came back bimodal — 43% of pixels in the bottom eighth of the
  // red range, 23% in the top — and the hillsides past the World's edge went
  // salmon pink. Mean and spread together, as an offset and a bounded gain,
  // move the colour without tearing the histogram in half.
  if (process.env.MIDORI_FAR_RAW) writeFileSync(process.env.MIDORI_FAR_RAW, Buffer.from(out));
  const tone = await matchToNearOrthophoto(out, SIZE);
  if (tone) {
    for (let k = 0; k < out.length; k += 4) {
      out[k] = tone.lut[0][out[k]];
      out[k + 1] = tone.lut[1][out[k + 1]];
      out[k + 2] = tone.lut[2][out[k + 2]];
    }
    console.log(`  近景オルソに合わせた色調補正 ${tone.report}`);
  }

  const encoded = jpeg.encode({ data: out, width: SIZE, height: SIZE }, 80);
  writeFileSync(join(OUT_DIR, 'midori_far_photo.jpg'), encoded.data);
  return true;
}

/**
 * The per-channel tone curve that makes the far photo's overlap with the near
 * orthophoto read as the same ground. Returns null if the near image is not
 * there, in which case the far one is left as served.
 *
 * Per channel: subtract the far mean, scale by the ratio of the two spreads,
 * add the near mean. The scale is bounded to [0.6, 2.0] — outside that the
 * satellite channel carries too little variation to stretch honestly, and
 * stretching it anyway is what clips.
 */
async function matchToNearOrthophoto(far, size) {
  const jpeg = (await import('jpeg-js')).default;
  const nearPath = join(ROOT, 'public/assets/textures/midori_orthophoto.jpg');
  const metaPath = join(ROOT, 'public/assets/textures/midori_orthophoto.json');
  let nearMeta;
  let nearImage;
  try {
    nearMeta = JSON.parse(readFileSync(metaPath, 'utf8'));
    nearImage = jpeg.decode(readFileSync(nearPath), { useTArray: true });
  } catch {
    return null;
  }
  const nb = nearMeta.bounds;

  const stats = (data, width, height, step, pick) => {
    const sum = [0, 0, 0];
    const sumSq = [0, 0, 0];
    let n = 0;
    for (let j = 0; j < height; j += step) {
      for (let i = 0; i < width; i += step) {
        if (!pick(i, j)) continue;
        const k = (j * width + i) * 4;
        for (let c = 0; c < 3; c++) {
          const v = data[k + c];
          sum[c] += v;
          sumSq[c] += v * v;
        }
        n++;
      }
    }
    if (n < 16) return null;
    return [0, 1, 2].map((c) => ({
      mean: sum[c] / n,
      sd: Math.sqrt(Math.max(1, sumSq[c] / n - (sum[c] / n) ** 2)),
    }));
  };

  const nearStats = stats(nearImage.data, nearImage.width, nearImage.height, 3, () => true);
  // the overlap is 5 km of a 70 km image — about 36 cells square — so it is
  // sampled every pixel, not every third
  const farStats = stats(far, size, size, 1, (i, j) => {
    const lon = bounds.west + ((i + 0.5) / size) * (bounds.east - bounds.west);
    const lat = bounds.north - ((j + 0.5) / size) * (bounds.north - bounds.south);
    return lon >= nb.west && lon <= nb.east && lat >= nb.south && lat <= nb.north;
  });
  if (!nearStats || !farStats) return null;

  const CHANNEL = ['R', 'G', 'B'];
  const lut = [];
  const report = [];
  for (let c = 0; c < 3; c++) {
    const gain = Math.min(2.0, Math.max(0.6, nearStats[c].sd / farStats[c].sd));
    const table = new Uint8Array(256);
    for (let v = 0; v < 256; v++) {
      const mapped = (v - farStats[c].mean) * gain + nearStats[c].mean;
      table[v] = Math.min(255, Math.max(0, Math.round(mapped)));
    }
    lut.push(table);
    report.push(`${CHANNEL[c]} ${farStats[c].mean.toFixed(0)}→${nearStats[c].mean.toFixed(0)} ×${gain.toFixed(2)}`);
  }
  return { lut, report: report.join(' / ') };
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  console.log('=== 遠景地形 ===');
  const { heights, min, max, missing } = fetchDem();
  writeFileSync(join(OUT_DIR, 'midori_far_dem.bin'), Buffer.from(heights.buffer));
  const photo = await fetchPhoto();

  writeFileSync(join(OUT_DIR, 'midori_far_terrain.json'), `${JSON.stringify({
    note: '緑駅を中心に半径 35 km の地形。国土地理院の標高タイル(z=10)とシームレス空中写真(z=11)を、'
      + '同じ緯度経度グリッドに再標本化したもの。歩ける精度ではなく、World の外の land の形と色。'
      + 'midori_far_dem.bin は Int16 リトルエンディアン、行は北から南、列は西から東。'
      + '各セルは z=12 タイルを 9x9 に細かく読んだうちの最大値 — 稜線は最大値でできているため。',
    attribution: '出典: 国土地理院（地理院タイル 標高タイル・シームレス空中写真）',
    source_dem: `https://cyberjapandata.gsi.go.jp/xyz/dem/${DEM_ZOOM}/{x}/{y}.txt`,
    source_photo: `https://cyberjapandata.gsi.go.jp/xyz/seamlessphoto/${PHOTO_ZOOM}/{x}/{y}.jpg`,
    fetched_at: new Date().toISOString().slice(0, 10),
    bounds,
    grid: GRID,
    metres_per_cell: Number(((REACH_M * 2) / GRID).toFixed(1)),
    elevation_range_m: [min, max],
    missing_samples: missing,
    photo: photo ? 'midori_far_photo.jpg' : null,
  }, null, 2)}\n`);

  console.log(`  ${GRID}x${GRID}、1セル ${((REACH_M * 2) / GRID).toFixed(0)} m、標高 ${min}〜${max} m、欠測 ${missing}`);
  console.log('  → public/assets/terrain/');
}

main();
