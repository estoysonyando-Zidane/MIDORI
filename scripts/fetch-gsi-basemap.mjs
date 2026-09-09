#!/usr/bin/env node
/**
 * Fetches 国土地理院 地理院地図Vector for 緑町 and writes a committed extract.
 *
 * WHY THIS AND NOT OPENSTREETMAP
 * ------------------------------
 * The town was first imported from OSM. OSM is not a primary source: the
 * extract's own tags say `source=Bing`, i.e. someone traced Microsoft's
 * aerial imagery, and the import trusted that tracing without ever looking
 * at an image. 地理院地図Vector is served by 国土地理院 from 電子国土基本図 —
 * the national base map, surveyed at 1/25,000 — and carries the surveyor's
 * own attributes: `ftCode` (feature class), `rnkWidth` (road width rank),
 * `snglDbl` (single or double track), and the 注記 (place-name) layer.
 *
 * Attribution: 出典 国土地理院「地理院地図Vector（地理院タイル）」.
 *
 * The decoded result is committed at scripts/data/gsi_midori.json so the
 * import is reproducible without network access. Re-run this only to refresh
 * it.
 *
 * Run:  node scripts/fetch-gsi-basemap.mjs
 */

import { writeFileSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodeTile, tileToLonLat } from './lib/mvt.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
/** Where the decoded features go, and how far out to fetch.
 *
 *  The default 5x5 block was sized around the settlement and reaches about
 *  1.6 km at its corners — which is why the World's water stopped 1.4 km out
 *  and さくらの滝, 2.07 km from the station and inside the World's own
 *  bounds, had no river running to it.
 *
 *  Widening the shared file would re-import the town from four times the
 *  area, and the town's identities have been fixed by hand more than once,
 *  so the wide fetch writes its own file instead and only the importers that
 *  ask for it read it: `--radius 5 --out scripts/data/gsi_midori_wide.json`.
 */
const OUT = join(ROOT, process.env.GSI_OUT ?? 'scripts/data/gsi_midori.json');

const CENTRE = { lat: 43.718020, lon: 144.505750 };  // JP.01.546.MIDORI/STATION
const ZOOM = 16;
const RADIUS_TILES = Number(process.env.GSI_RADIUS_TILES ?? 2);   // ±2 tiles ≈ 2.2 km across
const ENDPOINT = 'https://cyberjapandata.gsi.go.jp/xyz/experimental_bvmap';

/** Layers worth keeping, and what each is. */
const LAYERS = {
  building: '建築物 (ftCode 3101)',
  road: '道路 (中心線・道路縁)',
  railway: '鉄道',
  river: '水涯線',
  waterarea: '水域',
  label: '注記',
  contour: '等高線',
};

const DEG = Math.PI / 180;

function fetchTile(x, y) {
  const path = join(tmpdir(), `gsi_${ZOOM}_${x}_${y}.pbf`);
  try {
    execFileSync('curl', [
      '-sS', '--fail', '-m', '45',
      '-A', 'MIDORI-worldbuild/1.0 (reality-to-world engine; research use)',
      '-o', path, `${ENDPOINT}/${ZOOM}/${x}/${y}.pbf`,
    ]);
    const body = new Uint8Array(readFileSync(path));
    return body.length > 0 ? body : null;
  } catch {
    return null;
  } finally {
    try { rmSync(path, { force: true }); } catch { /* nothing to clean up */ }
  }
}

function tileOf(lat, lon, z) {
  const n = 2 ** z;
  const lr = lat * DEG;
  return {
    x: Math.floor(((lon + 180) / 360) * n),
    y: Math.floor(((1 - Math.log(Math.tan(lr) + 1 / Math.cos(lr)) / Math.PI) / 2) * n),
  };
}

function tileBounds(z, x, y) {
  const n = 2 ** z;
  const lon = (tx) => (tx / n) * 360 - 180;
  const lat = (ty) => {
    const t = Math.PI - (2 * Math.PI * ty) / n;
    return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(t) - Math.exp(-t)));
  };
  return { west: lon(x), east: lon(x + 1), north: lat(y), south: lat(y + 1) };
}

async function main() {
  const centre = tileOf(CENTRE.lat, CENTRE.lon, ZOOM);
  const features = [];
  // The tiles carry the same polygon more than once — one tile here holds 127
  // building features with only 80 distinct outlines — so features are keyed
  // by their own geometry and tags, and the first copy wins. The key sorts
  // the vertices before hashing them: the repeats are not byte-identical,
  // because the same ring comes back started at a different vertex, so a
  // signature that respected vertex order caught none of them.
  const seen = new Set();
  let duplicates = 0;
  let tiles = 0;
  let clipped = 0;

  for (let dy = -RADIUS_TILES; dy <= RADIUS_TILES; dy++) {
    for (let dx = -RADIUS_TILES; dx <= RADIUS_TILES; dx++) {
      const x = centre.x + dx;
      const y = centre.y + dy;
      // Fetched through curl rather than node's fetch: the tile service
      // answers 403 to the latter from this environment, and a tile fetch
      // that silently returns nothing is worse than a dependency on curl.
      const body = fetchTile(x, y);
      if (!body) {
        console.warn(`  tile ${ZOOM}/${x}/${y}: not fetched`);
        continue;
      }
      tiles++;
      const layers = decodeTile(body);
      const bounds = tileBounds(ZOOM, x, y);

      for (const layer of layers) {
        if (!(layer.name in LAYERS)) continue;
        const project = tileToLonLat(ZOOM, x, y, layer.extent);

        for (const feature of layer.features) {
          if (feature.rings.length === 0) continue;
          const rings = feature.rings.map((ring) => ring.map(([px, py]) => {
            const [lon, lat] = project(px, py);
            return [Number(lon.toFixed(7)), Number(lat.toFixed(7))];
          }));

          // Every tile carries a buffer of geometry from its neighbours, so a
          // building near an edge arrives once per tile it touches. Each
          // feature is kept by the single tile its centroid falls inside, and
          // that tile's copy runs into the buffer, so the shape is whole.
          const flat = rings.flat();
          const cx = flat.reduce((a, p) => a + p[0], 0) / flat.length;
          const cy = flat.reduce((a, p) => a + p[1], 0) / flat.length;
          if (cx < bounds.west || cx >= bounds.east || cy > bounds.north || cy <= bounds.south) continue;

          // A ring that still touches the tile's own edge after that test is
          // one the buffer did not save; flag it rather than silently
          // shipping a building with a straight cut across it.
          const touchesEdge = feature.type === 3 && feature.rings.some((ring) => ring.some(
            ([px, py]) => px <= 0 || py <= 0 || px >= layer.extent || py >= layer.extent,
          ));
          if (touchesEdge) clipped++;

          const vertices = rings.flat().map((p) => `${p[0]},${p[1]}`).sort().join(';');
          const signature = `${layer.name}|${feature.type}|${JSON.stringify(feature.tags)}|${vertices}`;
          if (seen.has(signature)) { duplicates++; continue; }
          seen.add(signature);

          features.push({
            layer: layer.name,
            type: feature.type,           // 1 point, 2 line, 3 polygon
            tags: feature.tags,
            rings,
            ...(touchesEdge ? { tile_clipped: true } : {}),
          });
        }
      }
    }
  }

  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, `${JSON.stringify({
    note: '出典: 国土地理院「地理院地図Vector（地理院タイル）」experimental_bvmap。'
      + `緑駅 (${CENTRE.lat}, ${CENTRE.lon}) を中心に zoom ${ZOOM} のタイル ${2 * RADIUS_TILES + 1}×${2 * RADIUS_TILES + 1} 枚を取得し、`
      + 'scripts/lib/mvt.mjs でデコードしたもの。各フィーチャは重心が属するタイル1枚だけが保持している。',
    source: ENDPOINT,
    attribution: '国土地理院「地理院地図Vector（地理院タイル）」',
    fetched_at: new Date().toISOString().slice(0, 10),
    centre: [CENTRE.lon, CENTRE.lat],
    zoom: ZOOM,
    layers: LAYERS,
    features,
  }, null, 0)}\n`);

  const byLayer = {};
  for (const f of features) byLayer[f.layer] = (byLayer[f.layer] || 0) + 1;
  console.log('=== 地理院地図Vector fetched ===');
  console.log(`tiles          ${tiles}`);
  console.log(`features       ${features.length}`);
  for (const [name, count] of Object.entries(byLayer).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${name.padEnd(12)} ${String(count).padStart(5)}   ${LAYERS[name]}`);
  }
  console.log(`duplicate copies dropped: ${duplicates} (signatures held: ${seen.size})`);
  console.log(`polygons still cut by a tile edge: ${clipped}`);
  console.log(`written to     ${OUT}`);
}

main();
