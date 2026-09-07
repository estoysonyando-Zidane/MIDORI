#!/usr/bin/env node
/**
 * 緑の湯 — put the name on the building that is actually 緑の湯.
 *
 * It was on the wrong footprint. import-gsi-town.mjs took the name from
 * OSM/Wikipedia and attached it to whichever 電子国土基本図 outline was
 * nearest, and its own note admits the match was 22 m out. That outline is
 * 131 m². The building 10 m from the facility's coordinate is 590 m², and
 * the photographs and the 2011 aerial both show a substantial single-storey
 * facility with a car park, not a shed. The name was on the wrong building.
 *
 * So the identity moves to the 590 m² outline, and the 131 m² one goes back
 * to being an anonymous town building — it is a real surveyed footprint of
 * something, and there is no basis here for saying what.
 *
 * Appearance comes from photographs of the building (SRC_MIDORINOYU_PHOTOS):
 * a dark green metal roof over dark reddish-brown vertical board siding,
 * single storey, with a gabled entrance porch on log columns and a timber
 * lattice rail along the front terrace. Only the roof and wall colours are
 * applied — the porch and the rail are on a face this script cannot tell
 * from the plan, and guessing which one would be inventing.
 *
 * Run: node scripts/identify-midorinoyu.mjs
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const WORLD = join(ROOT, 'public/data/worlds/JP_HOKKAIDO_KIYOSATO_MIDORI_20100530');

/** Read off the photographs. */
const ROOF_COLOUR = '#3f5b4c';   // 濃緑の金属屋根
const WALL_COLOUR = '#6e4530';   // 赤褐色の縦板張り
const EAVE_M = 3.2;
const RIDGE_M = 6.0;

const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));
const writeJson = (p, v) => writeFileSync(p, `${JSON.stringify(v, null, 2)}\n`);

function centroid(ring) {
  const n = ring.length;
  return [ring.reduce((a, c) => a + c[0], 0) / n, ring.reduce((a, c) => a + c[1], 0) / n];
}

function main() {
  const buildings = readJson(join(WORLD, 'reality/buildings.geojson'));
  const poi = readJson(join(WORLD, 'reality/poi.geojson'));
  const facility = poi.features.find((f) => f.properties.id === 'FACILITY_MIDORINOYU');
  if (!facility) throw new Error('FACILITY_MIDORINOYU not found');
  const [plon, plat] = facility.geometry.coordinates;
  const mLat = 111132.0;
  const mLon = 111320.0 * Math.cos((plat * Math.PI) / 180);

  let best = null;
  let bestDistance = Infinity;
  for (const f of buildings.features) {
    if (f.geometry.type !== 'Polygon') continue;
    if (f.properties.gsi_ft_code !== 3101) continue;
    const [clon, clat] = centroid(f.geometry.coordinates[0].slice(0, -1));
    const d = Math.hypot((clon - plon) * mLon, (clat - plat) * mLat);
    if (d < bestDistance) { bestDistance = d; best = f; }
  }
  if (!best) throw new Error('no GSI building outline near the facility');

  // Anything else previously calling itself 緑の湯 goes back to anonymous.
  for (const f of buildings.features) {
    if (f === best) continue;
    if (f.properties.structure_type !== 'bathhouse') continue;
    f.properties.name = null;
    f.properties.structure_type = 'town_building';
    delete f.properties.wall_colour;
    f.properties.detail_confidence = {
      ...f.properties.detail_confidence,
      identification: 'U (unknown — 以前は緑の湯としていたが、その対応付けは22 m離れた別の外形への誤りだった。'
        + '実測された建築物であることは確かで、用途は不明)',
    };
    f.properties.note = `${f.properties.note ?? ''} scripts/identify-midorinoyu.mjs: `
      + '緑の湯の同定をこの外形から外した。';
    console.log(`  ${f.properties.id}: 緑の湯の名を外し、用途不明の建築物に戻した`);
  }

  const p = best.properties;
  p.name = '緑の湯';
  p.structure_type = 'bathhouse';
  p.roof_colour = ROOF_COLOUR;
  p.wall_colour = WALL_COLOUR;
  p.roof_shape = 'gable';
  p.eave_height_m = EAVE_M;
  p.ridge_height_m = RIDGE_M;
  for (const sid of ['SRC_KIYOSATO_TOWN_MIDORINOYU', 'SRC_MIDORINOYU_PHOTOS', 'SRC_GE_20110526']) {
    if (!p.source_ids.includes(sid)) p.source_ids.push(sid);
  }
  p.detail_confidence = {
    ...p.detail_confidence,
    identification: `B (public_gis + official_record — 清里町の施設情報にある緑の湯の座標から ${bestDistance.toFixed(0)} m。`
      + '同じ敷地で次に近い外形は131 m²で、写真と2011年の空中写真が示す規模と合わない)',
    eave_ridge_height: 'C (inference — 写真から平屋で軒が高い。実測ではない)',
    roof_colour: 'B (photograph — 濃緑の金属屋根)',
    wall_colour: 'B (photograph — 赤褐色の縦板張り)',
    porch_and_rail: 'not modelled — 写真には丸太柱の切妻ポーチと木の格子手すりが写るが、'
      + 'それが平面のどの面かは判断できないので作っていない',
  };
  p.note = `${p.note ?? ''} scripts/identify-midorinoyu.mjs: `
    + '緑の湯の同定をこの外形に移した。屋根と壁の色は写真から。'
    + '軒高・棟高は写真から平屋と読んだ推定で、実測ではない。';
  console.log(`  ${p.id}: 緑の湯に同定 (${bestDistance.toFixed(1)} m, ${p.area_m2} m2)`);

  facility.properties.geometry_note = `${facility.properties.geometry_note ?? ''} `
    + `2026年追記: 国土地理院の実測外形 ${p.id} (${p.area_m2} m2) が ${bestDistance.toFixed(0)} m の位置にあり、`
    + 'これを建物本体とした。以前は22 m離れた131 m²の別の外形に名前が付いていた。';
  if (!facility.properties.source_ids.includes('SRC_MIDORINOYU_PHOTOS')) {
    facility.properties.source_ids.push('SRC_MIDORINOYU_PHOTOS');
  }

  writeJson(join(WORLD, 'reality/buildings.geojson'), buildings);
  writeJson(join(WORLD, 'reality/poi.geojson'), poi);
  console.log('=== 緑の湯 ===');
}

main();
