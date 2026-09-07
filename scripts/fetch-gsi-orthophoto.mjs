#!/usr/bin/env node
/**
 * Drapes 国土地理院's aerial photography over the World's terrain.
 *
 * WHY
 * ---
 * The terrain carries real relief — 199 m across the World, 96 m within
 * 600 m of the station — but it was painted one flat green, so from every
 * viewpoint it read as a plane. Land cover is the thing the eye actually
 * uses to tell ground apart: the ploughed fields north of the town, the
 * forest edge, the gravel yards, the mown square, the tracks between them.
 * None of that can be invented convincingly, and all of it is already
 * photographed.
 *
 * シームレス空中写真 is 国土地理院's own imagery, openly licensed with
 * attribution. This fetches it over exactly the DEM's bounds and resamples
 * it out of Web Mercator into the DEM's own lat/lon grid, so the terrain
 * mesh's existing 0..1 UVs address it directly with no further mapping.
 *
 * 出典: 国土地理院「シームレス空中写真（地理院タイル）」
 *
 * Run:  node scripts/fetch-gsi-orthophoto.mjs
 */

import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const WORLD = join(ROOT, 'public/data/worlds/JP_HOKKAIDO_KIYOSATO_MIDORI_20100530');
const CACHE = join(ROOT, '.cache/gsi-photo');
const OUT_IMAGE = join(ROOT, 'public/assets/textures/midori_orthophoto.jpg');
const OUT_META = join(ROOT, 'public/assets/textures/midori_orthophoto.json');

const ENDPOINT = 'https://cyberjapandata.gsi.go.jp/xyz/seamlessphoto';
/** 1.7 m/px at this latitude — enough to read fields and tracks from the air,
 *  and small enough to ship. A detail texture supplies the close range. */
const ZOOM = 16;
const TILE = 256;
const OUTPUT_PX = 2048;

const DEG = Math.PI / 180;

function lonToTileX(lon, z) { return ((lon + 180) / 360) * 2 ** z; }
function latToTileY(lat, z) {
  const s = Math.sin(lat * DEG);
  return (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * 2 ** z;
}

function fetchTile(z, x, y) {
  mkdirSync(CACHE, { recursive: true });
  const path = join(CACHE, `${z}_${x}_${y}.jpg`);
  if (existsSync(path) && readFileSync(path).length > 500) return path;
  try {
    execFileSync('curl', [
      '-sS', '--fail', '-m', '45',
      '-A', 'MIDORI-worldbuild/1.0 (reality-to-world engine; research use)',
      '-o', path, `${ENDPOINT}/${z}/${x}/${y}.jpg`,
    ]);
    return readFileSync(path).length > 500 ? path : null;
  } catch {
    try { rmSync(path, { force: true }); } catch { /* nothing to remove */ }
    return null;
  }
}

function main() {
  const dem = JSON.parse(readFileSync(join(WORLD, 'reality/dem.json'), 'utf8'));
  const { west, east, south, north } = dem.bounds;

  const x0 = Math.floor(lonToTileX(west, ZOOM));
  const x1 = Math.ceil(lonToTileX(east, ZOOM));
  const y0 = Math.floor(latToTileY(north, ZOOM));
  const y1 = Math.ceil(latToTileY(south, ZOOM));

  let fetched = 0;
  let missing = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      if (fetchTile(ZOOM, x, y)) fetched++; else missing++;
    }
  }

  // The mosaic is stitched and resampled by Pillow: the tiles are Web
  // Mercator and the DEM is a lat/lon grid, so every output row has to be
  // looked up at its own Mercator y. Over 5 km the difference is only a few
  // metres, but a few metres is a field boundary in the wrong place.
  const script = `
import json, math, os
from PIL import Image
CACHE = ${JSON.stringify(CACHE)}
Z, TILE, OUT = ${ZOOM}, ${TILE}, ${OUTPUT_PX}
west, east, south, north = ${west}, ${east}, ${south}, ${north}
x0, x1, y0, y1 = ${x0}, ${x1}, ${y0}, ${y1}
mosaic = Image.new('RGB', ((x1 - x0) * TILE, (y1 - y0) * TILE), (90, 100, 80))
for y in range(y0, y1):
    for x in range(x0, x1):
        p = os.path.join(CACHE, f'{Z}_{x}_{y}.jpg')
        if os.path.exists(p):
            try: mosaic.paste(Image.open(p), ((x - x0) * TILE, (y - y0) * TILE))
            except Exception: pass

def lon_to_px(lon): return (((lon + 180.0) / 360.0) * 2 ** Z - x0) * TILE
def lat_to_px(lat):
    s = math.sin(math.radians(lat))
    return ((0.5 - math.log((1 + s) / (1 - s)) / (4 * math.pi)) * 2 ** Z - y0) * TILE

src = mosaic.load()
outimg = Image.new('RGB', (OUT, OUT))
dst = outimg.load()
xs = [lon_to_px(west + (east - west) * (i / (OUT - 1))) for i in range(OUT)]
W, H = mosaic.size
for j in range(OUT):
    lat = north - (north - south) * (j / (OUT - 1))
    sy = lat_to_px(lat)
    y_lo = max(0, min(H - 1, int(sy)))
    for i in range(OUT):
        x_lo = max(0, min(W - 1, int(xs[i])))
        dst[i, j] = src[x_lo, y_lo]
outimg.save(${JSON.stringify(OUT_IMAGE)}, quality=88, optimize=True)
print(json.dumps({'mosaic': mosaic.size, 'output': outimg.size}))
`;
  mkdirSync(dirname(OUT_IMAGE), { recursive: true });
  const result = execFileSync('python3', ['-c', script], { encoding: 'utf8' });

  const metresPerPixel = ((east - west) * Math.cos(((north + south) / 2) * DEG) * 111320) / OUTPUT_PX;
  writeFileSync(OUT_META, `${JSON.stringify({
    attribution: '出典: 国土地理院「シームレス空中写真（地理院タイル）」',
    source: ENDPOINT,
    zoom: ZOOM,
    fetched_at: new Date().toISOString().slice(0, 10),
    bounds: { west, east, south, north },
    size_px: OUTPUT_PX,
    metres_per_pixel: Number(metresPerPixel.toFixed(3)),
    note: 'DEM (reality/dem.json) と同じ範囲・同じ緯度経度グリッドに再標本化してある。'
      + '地形メッシュの 0..1 UV がそのままこの画像を指す。'
      + '写真そのものは撮影年不明の現在時点のものであり、2010年の地表ではない。',
  }, null, 2)}\n`);

  console.log('=== 空中写真 draped over the terrain ===');
  console.log(`tiles          ${fetched} fetched, ${missing} missing`);
  console.log(`mosaic/output  ${result.trim()}`);
  console.log(`ground sample  ${metresPerPixel.toFixed(2)} m per pixel`);
  console.log(`written        ${OUT_IMAGE}`);
}

main();
