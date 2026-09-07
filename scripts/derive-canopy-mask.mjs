#!/usr/bin/env node
/**
 * Derives where the forest is, from the aerial photograph.
 *
 * The trees used to be scattered at random in a ring around the station,
 * thinned near the line and pushed off the buildings. Nothing about that
 * scatter knew where the forest actually is, so the treeline — which is the
 * backdrop of every photograph ever taken at 緑駅, and the thing you are
 * looking at while you wait — fell wherever the random number generator put
 * it, cutting across fields and stopping short of the hillside.
 *
 * 国土地理院's aerial photograph is already draped on the terrain and it
 * records the canopy directly: forest reads dark (V ≈ 60-80) while worked
 * ground, roofs and roads read bright (V ≈ 120-135). This classifies each
 * pixel, downsamples to a coarse grid, and writes it as a packed 1-bit mask
 * the World can sample when it plants.
 *
 * The individual trees are still not survey data — where one particular tree
 * stands is not evidence, and this stays out of Reality Data for that reason.
 * What IS taken from the photograph is the EXTENT of the wood, which is a
 * measurement.
 *
 * The photograph is the undated seamless composite, so the canopy edge is a
 * recent one, not 2010's. Forest edges move slowly; the alternative was a
 * random number.
 *
 * Run: node scripts/derive-canopy-mask.mjs
 */

import jpeg from 'jpeg-js';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const TEXTURES = join(ROOT, 'public/assets/textures');

/** Canopy is dark. Worked fields, gravel, roofs and road are not. */
const VALUE_MAX = 95;
/** ...and not blue-dark, which is water and deep shadow on open ground. */
const MIN_GREEN_OVER_RED = -6;
/** Grid the mask is written at. 512 cells over ~4.9 km is 9.6 m a cell,
 *  about the size of one mature crown group — finer than that is more
 *  precision than a 2.4 m/px photograph supports. */
const GRID = 512;
/** A cell counts as wooded when this share of its pixels are. */
const CELL_THRESHOLD = 0.5;
/**
 * How far out from the wood the scrub band reaches, in cells.
 *
 * 藪 cannot be separated from grass by colour at 2.4 m a pixel — that is a
 * limit of the photograph, not of the classifier. What CAN be derived is
 * where the wood ends, and in Hokkaido a forest edge carries ササ and low
 * scrub for a few metres before it gives way to worked ground. So the scrub
 * band is the ring just outside the canopy: derived from the mask by
 * morphology, not invented, and not claimed to be a survey of undergrowth.
 */
const EDGE_CELLS = 2;

function main() {
  const meta = JSON.parse(readFileSync(join(TEXTURES, 'midori_orthophoto.json'), 'utf8'));
  const image = jpeg.decode(readFileSync(join(TEXTURES, 'midori_orthophoto.jpg')), { useTArray: true });

  const counts = new Uint32Array(GRID * GRID);
  const totals = new Uint32Array(GRID * GRID);
  for (let y = 0; y < image.height; y++) {
    const gy = Math.min(GRID - 1, Math.floor((y / image.height) * GRID));
    for (let x = 0; x < image.width; x++) {
      const i = (y * image.width + x) * 4;
      const r = image.data[i];
      const g = image.data[i + 1];
      const b = image.data[i + 2];
      const value = Math.max(r, g, b);
      const cell = gy * GRID + Math.min(GRID - 1, Math.floor((x / image.width) * GRID));
      totals[cell]++;
      if (value <= VALUE_MAX && g - r >= MIN_GREEN_OVER_RED) counts[cell]++;
    }
  }

  const bytes = new Uint8Array((GRID * GRID) / 8);
  let wooded = 0;
  for (let c = 0; c < GRID * GRID; c++) {
    if (totals[c] > 0 && counts[c] / totals[c] >= CELL_THRESHOLD) {
      bytes[c >> 3] |= 1 << (c & 7);
      wooded++;
    }
  }

  // The scrub ring: not wooded, but within EDGE_CELLS of something that is.
  const edge = new Uint8Array((GRID * GRID) / 8);
  let edgeCount = 0;
  const wooded_at = (x, y) => {
    if (x < 0 || y < 0 || x >= GRID || y >= GRID) return false;
    const c = y * GRID + x;
    return ((bytes[c >> 3] >> (c & 7)) & 1) === 1;
  };
  for (let y = 0; y < GRID; y++) {
    for (let x = 0; x < GRID; x++) {
      if (wooded_at(x, y)) continue;
      let near = false;
      for (let dy = -EDGE_CELLS; dy <= EDGE_CELLS && !near; dy++) {
        for (let dx = -EDGE_CELLS; dx <= EDGE_CELLS; dx++) {
          if (wooded_at(x + dx, y + dy)) { near = true; break; }
        }
      }
      if (near) {
        const c = y * GRID + x;
        edge[c >> 3] |= 1 << (c & 7);
        edgeCount++;
      }
    }
  }

  const out = {
    note: 'Canopy extent classified from the draped aerial photograph by scripts/derive-canopy-mask.mjs. '
      + 'Bit c of the packed array is cell (c % grid, floor(c / grid)), x east from bounds.west and '
      + 'y south from bounds.north — the same grid as the photograph and the DEM. '
      + '1 = wooded. Not Reality Data: the extent is measured, the individual trees are not.',
    attribution: meta.attribution,
    derived_from: 'public/assets/textures/midori_orthophoto.jpg',
    classifier: { value_max: VALUE_MAX, min_green_over_red: MIN_GREEN_OVER_RED, cell_threshold: CELL_THRESHOLD },
    bounds: meta.bounds,
    grid: GRID,
    metres_per_cell: Number((meta.metres_per_pixel * (meta.size_px / GRID)).toFixed(2)),
    wooded_fraction: Number((wooded / (GRID * GRID)).toFixed(3)),
    scrub_fraction: Number((edgeCount / (GRID * GRID)).toFixed(3)),
    edge_cells: EDGE_CELLS,
    packed_base64: Buffer.from(bytes).toString('base64'),
    scrub_packed_base64: Buffer.from(edge).toString('base64'),
  };
  writeFileSync(join(TEXTURES, 'midori_canopy.json'), `${JSON.stringify(out, null, 2)}\n`);
  console.log(`canopy mask ${GRID}x${GRID}, ${out.metres_per_cell} m a cell, `
    + `wooded ${(out.wooded_fraction * 100).toFixed(1)}%, scrub band ${(out.scrub_fraction * 100).toFixed(1)}%`);
  console.log(`written to public/assets/textures/midori_canopy.json (${(bytes.length / 1024).toFixed(0)} KB packed)`);
}

main();
