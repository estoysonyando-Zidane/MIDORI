#!/usr/bin/env node
/**
 * 緑町小学校 — corrected against Google Earth's 2011-05-26 imagery.
 *
 * WHY THIS DATE MATTERS
 * ---------------------
 * The World's target is 2010-05-30. Google Earth's historical slider holds a
 * frame from 2011-05-26: four days short of a year later, and the same point
 * in the same season. It is the closest thing to a photograph of this
 * World's moment that exists anywhere, and the operator supplied it.
 *
 * The imagery is Google's and is not redistributed — it is read the way the
 * user's own photographs are read, for shape and colour, and cited as
 * SRC_GMAP_PHOTOS.
 *
 * WHAT IT CORRECTED
 * -----------------
 *   * The school's roofs are RED. The import had them blue, which was a
 *     colour hashed from a palette because nothing said otherwise. All five
 *     buildings 国土地理院 has inside the school grounds share it, bar the
 *     long hall on the west side, which is pale.
 *   * The 運動場 is bare dirt with a marked running track on it, not the
 *     olive green a `leisure=pitch` tag defaults to here.
 *   * There is an asphalt yard between the buildings and the track, with
 *     play markings painted on it. Nothing in OSM or GSI carries it.
 *
 * Footprints stay 国土地理院's. What this script changes is what is on top of
 * them, which is what the imagery can actually settle.
 *
 * Run:  node scripts/import-school.mjs
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const WORLD = join(ROOT, 'public/data/worlds/JP_HOKKAIDO_KIYOSATO_MIDORI_20100530');
const OSM = join(ROOT, 'scripts/data/osm_midori.json');

/** Roof colours read off the 2011 frame. */
const SCHOOL_ROOF = '#c05a52';
const HALL_ROOF = '#e2ddc8';
/** The hall is the long, narrow, separately-standing building on the west
 *  side; everything else in the grounds is classroom or service block. */
const HALL_MIN_ASPECT = 1.8;
const HALL_MIN_AREA_M2 = 180;

const DEG = Math.PI / 180;
const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));
const writeJson = (p, v) => writeFileSync(p, `${JSON.stringify(v, null, 2)}\n`);

function ringMetres(ring, metres) {
  const r = ring.map(metres);
  return r[0][0] === r[r.length - 1][0] && r[0][1] === r[r.length - 1][1] ? r.slice(0, -1) : r;
}
function centroid(r) {
  return [r.reduce((a, p) => a + p[0], 0) / r.length, r.reduce((a, p) => a + p[1], 0) / r.length];
}
function inside(p, poly) {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]; const b = poly[j];
    if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) c = !c;
  }
  return c;
}

function main() {
  const osm = readJson(OSM);
  const [centreLon, centreLat] = osm.query_centre;
  const scale = { east: Math.cos(centreLat * DEG) * 111320.0, north: 110574.0 };
  const metres = ([lon, lat]) => [(lon - centreLon) * scale.east, (lat - centreLat) * scale.north];
  const back = ([e, n]) => [
    Number((e / scale.east + centreLon).toFixed(8)),
    Number((n / scale.north + centreLat).toFixed(8)),
  ];

  const buildings = readJson(join(WORLD, 'reality/buildings.geojson'));

  const groundsWay = osm.elements.find((e) => e.tags && e.tags.amenity === 'school');
  if (!groundsWay) throw new Error('the school grounds polygon is not in the OSM extract');
  const grounds = ringMetres(groundsWay.geometry, metres);

  // ---- the buildings ----------------------------------------------------
  let recoloured = 0;
  let hall = null;
  // The yard is measured against the MAIN block, not against every building
  // in the grounds: taking the bounds of all of them pushes it south past a
  // detached annexe and leaves a gap where the imagery shows none.
  const complexBounds = { minE: Infinity, maxE: -Infinity, minN: Infinity, maxN: -Infinity };
  let mainArea = 0;

  for (const feature of buildings.features) {
    if (feature.geometry.type !== 'Polygon') continue;
    const type = feature.properties.structure_type;
    // school_annex is included so a second run reconsiders what the first
    // one retagged — the script has to be idempotent or the yard ends up
    // measured against whatever survived the previous pass.
    if (type !== 'town_building' && type !== 'school' && type !== 'school_annex') continue;
    const r = ringMetres(feature.geometry.coordinates[0], metres);
    if (!inside(centroid(r), grounds)) continue;

    const es = r.map((p) => p[0]); const ns = r.map((p) => p[1]);
    const width = Math.max(...es) - Math.min(...es);
    const depth = Math.max(...ns) - Math.min(...ns);
    const aspect = Math.max(width, depth) / Math.max(1e-6, Math.min(width, depth));
    const area = feature.properties.area_m2 ?? width * depth;

    const isHall = aspect >= HALL_MIN_ASPECT && area >= HALL_MIN_AREA_M2;
    if (isHall) hall = feature.properties.id;

    feature.properties.structure_type = type === 'school' ? 'school' : 'school_annex';
    feature.properties.roof_colour = isHall ? HALL_ROOF : SCHOOL_ROOF;
    if (isHall) {
      feature.properties.eave_height_m = 5.2;
      feature.properties.ridge_height_m = 8.4;
      feature.properties.roof_shape = 'gable';
      feature.properties.name = feature.properties.name ?? '緑町小学校 体育館';
    } else if (type !== 'school') {
      feature.properties.eave_height_m = Math.max(3.2, feature.properties.eave_height_m ?? 3.2);
      feature.properties.ridge_height_m = Math.max(4.6, feature.properties.ridge_height_m ?? 4.6);
    }
    feature.properties.source_ids = [...new Set([...(feature.properties.source_ids ?? []), 'SRC_GMAP_PHOTOS'])];
    feature.properties.detail_confidence = {
      ...(feature.properties.detail_confidence ?? {}),
      roof_colour: 'B (secondary_photo — Google Earth 2011-05-26 の画像で赤系であることを確認。'
        + '以前はパレットからのハッシュで青にしていた)',
    };
    feature.properties.note = `${feature.properties.note ?? ''} `
      + '屋根色は Google Earth 2011年5月26日の画像による（目標日2010-05-30の4日違い・同季節）。画像は再配布していない。';

    if (!isHall && area > mainArea) {
      mainArea = area;
      complexBounds.minE = Math.min(...es);
      complexBounds.maxE = Math.max(...es);
      complexBounds.minN = Math.min(...ns);
      complexBounds.maxN = Math.max(...ns);
    }
    recoloured++;
  }

  // ---- the running track ------------------------------------------------
  let track = null;
  for (const feature of buildings.features) {
    if (feature.properties.structure_type !== 'sports_ground') continue;
    const r = ringMetres(feature.geometry.coordinates[0], metres);
    if (!inside(centroid(r), grounds)) continue;
    feature.properties.name = '緑町小学校 運動場';
    // Bare, rolled dirt with a marked oval on it — not turf.
    feature.properties.surface_colour = '#a49480';
    feature.properties.source_ids = [...new Set([...(feature.properties.source_ids ?? []), 'SRC_GMAP_PHOTOS'])];
    feature.properties.note = 'グラウンド。範囲はOSM、地表が芝ではなく転圧された土でトラックが引かれていることは '
      + 'Google Earth 2011年5月26日の画像による。';
    track = { bounds: {
      minE: Math.min(...r.map((p) => p[0])), maxE: Math.max(...r.map((p) => p[0])),
      minN: Math.min(...r.map((p) => p[1])), maxN: Math.max(...r.map((p) => p[1])),
    } };
  }

  // ---- the asphalt yard -------------------------------------------------
  // Between the buildings' south edge and the track's west edge, inside the
  // grounds. Derived from those two shapes rather than measured off the
  // screenshot: the imagery says the yard is there and fills that gap.
  buildings.features = buildings.features.filter((f) => f.properties.id !== 'SURF_SCHOOL_YARD');
  if (track && Number.isFinite(complexBounds.minE)) {
    const west = complexBounds.minE - 2;
    const east = Math.min(track.bounds.minE - 3, complexBounds.maxE + 4);
    // hard against the main block's south face, running back 26 m
    const north = complexBounds.minN + 1;
    const south = Math.max(Math.min(...grounds.map((p) => p[1])) + 4, north - 26);
    if (east > west + 8 && north > south + 6) {
      buildings.features.push({
        type: 'Feature',
        geometry: { type: 'Polygon', coordinates: [[
          back([west, south]), back([east, south]), back([east, north]), back([west, north]), back([west, south]),
        ]] },
        properties: {
          id: 'SURF_SCHOOL_YARD',
          name: '緑町小学校 校庭',
          structure_type: 'school_yard',
          surface_colour: '#4c4b49',
          height_m: 0.05,
          confidence: 'C',
          evidence_type: 'secondary_photo',
          historical_status: 'plausible',
          source_ids: ['SRC_GMAP_PHOTOS'],
          detail_confidence: {
            existence: 'B (secondary_photo — Google Earth 2011-05-26。校舎とトラックの間に舗装され'
              + '遊具の線が引かれた yard があることは画像で明瞭)',
            extent: 'C (inference — 校舎の南縁とトラックの西縁の間として構成。画像から画素実測したものではない)',
          },
          note: 'アスファルトの校庭。存在は Google Earth 2011年5月26日の画像による。'
            + '範囲は校舎とグラウンドの位置関係から構成したもので実測ではない。画像は再配布していない。',
        },
      });
    }
  }

  writeJson(join(WORLD, 'reality/buildings.geojson'), buildings);

  console.log('=== 緑町小学校 (Google Earth 2011-05-26) ===');
  console.log(`buildings recoloured  ${recoloured}  (roofs red, was a hashed blue)`);
  console.log(`hall identified       ${hall ?? 'none'}`);
  console.log(`running track         ${track ? 'surface corrected to bare dirt' : 'NOT FOUND'}`);
  console.log(`asphalt yard          ${buildings.features.some((f) => f.properties.id === 'SURF_SCHOOL_YARD') ? 'added' : 'not added'}`);
}

main();
