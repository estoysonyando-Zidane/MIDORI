#!/usr/bin/env node
/**
 * 札弦川 and the water around 緑町.
 *
 * There was no water anywhere in this World — not a drop — while
 * 国土地理院's 水涯線 and 水域 had been sitting in scripts/data/gsi_midori.json
 * since the town was imported, unused. The 札弦川 meanders past 350 m east of
 * the station, a tributary comes down the west side, and there is a small
 * pond north-east of the town.
 *
 * HOW WIDE THE RIVER IS, AND HOW THAT IS KNOWN.
 * 電子国土基本図 draws 水涯線 as a SINGLE line here, not as a pair of banks.
 * At 1/25,000 a watercourse wide enough to have two mapped banks is drawn
 * with two lines; one line is the convention for a narrower one. So the
 * width is not measured — it is bounded by the way the map is drawn, and
 * the value below is a reading of that convention, recorded as inference.
 *
 * Run: node scripts/import-rivers.mjs
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const WORLD = join(ROOT, 'public/data/worlds/JP_HOKKAIDO_KIYOSATO_MIDORI_20100530');
const GSI = join(ROOT, 'scripts/data/gsi_midori.json');

/** ftCode 5301: 水涯線. Drawn as one line, so under the 1/25,000 threshold
 *  for a two-bank watercourse. */
const FT_WATER_EDGE = 5301;
/** ftCode 5000 / 5201: 水域とその外周線 — a pond, mapped as an area. */
const FT_WATER_AREA = 5000;

const CHANNEL_WIDTH_M = 3.6;
/** How far the water sits below the surrounding ground. The 10 m DEM has no
 *  channel in it at all, so without this the river is a blue ribbon painted
 *  across a field. */
const CHANNEL_DEPTH_M = 1.1;

const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));
const writeJson = (p, v) => writeFileSync(p, `${JSON.stringify(v, null, 2)}\n`);

const NOTE = 'scripts/import-rivers.mjs による取り込み。出典: 国土地理院「地理院地図Vector（地理院タイル）」。'
  + '線形は実測（電子国土基本図）。'
  + `幅 ${CHANNEL_WIDTH_M} m と河床の深さ ${CHANNEL_DEPTH_M} m は実測ではない: `
  + '1/25000で水涯線が単線で描かれていることから、二条の岸を持つ幅には達しないと読んだもの。'
  + 'DEM(10 mメッシュ)に河道は刻まれていないので、地面はここで下げている。';

function main() {
  const gsi = readJson(GSI);
  const features = [];
  let lines = 0;
  let areas = 0;

  for (const f of gsi.features) {
    if (f.layer !== 'river' && f.layer !== 'waterarea') continue;
    const ft = f.tags.ftCode;

    if (f.type === 2 && ft === FT_WATER_EDGE) {
      for (const ring of f.rings) {
        if (ring.length < 2) continue;
        lines++;
        features.push({
          type: 'Feature',
          geometry: { type: 'LineString', coordinates: ring },
          properties: {
            id: `WATER_GSI_LINE_${lines.toString().padStart(3, '0')}`,
            name: null,
            water_type: 'stream',
            width_m: CHANNEL_WIDTH_M,
            depth_m: CHANNEL_DEPTH_M,
            gsi_ft_code: ft,
            confidence: 'B',
            evidence_type: 'public_gis',
            historical_status: 'plausible',
            position_status: 'located',
            source_ids: ['SRC_GSI_BVMAP'],
            detail_confidence: {
              alignment: 'B (public_gis — 国土地理院 電子国土基本図 水涯線 ftCode 5301)',
              width: 'C (inference — 1/25000で単線。二条の岸を持つ幅には達しないという読み)',
              depth: 'C (inference — DEMに河道が無いための造形。実測ではない)',
            },
            note: NOTE,
          },
        });
      }
      continue;
    }

    if (f.type === 3 && ft === FT_WATER_AREA) {
      for (const ring of f.rings) {
        if (ring.length < 4) continue;
        areas++;
        const closed = ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1]
          ? ring : [...ring, ring[0]];
        features.push({
          type: 'Feature',
          geometry: { type: 'Polygon', coordinates: [closed] },
          properties: {
            id: `WATER_GSI_AREA_${areas.toString().padStart(3, '0')}`,
            name: null,
            water_type: 'pond',
            depth_m: CHANNEL_DEPTH_M,
            gsi_ft_code: ft,
            confidence: 'B',
            evidence_type: 'public_gis',
            historical_status: 'plausible',
            position_status: 'located',
            source_ids: ['SRC_GSI_BVMAP'],
            detail_confidence: {
              outline: 'B (public_gis — 国土地理院 電子国土基本図 水域 ftCode 5000)',
              depth: 'C (inference — 見た目のための値。実測ではない)',
            },
            note: NOTE,
          },
        });
      }
    }
  }

  writeJson(join(WORLD, 'reality/water.geojson'), { type: 'FeatureCollection', features });
  console.log(`水 ${features.length} 件（水涯線 ${lines}、水域 ${areas}）→ reality/water.geojson`);
}

main();
