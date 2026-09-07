#!/usr/bin/env node
/**
 * 緑駅前広場 and its stage.
 *
 * WHERE THIS COMES FROM
 * ---------------------
 * The World already knew about みどりのフェスティバル: Directive-era work put
 * TEMP_EVENT_MIDORI_FESTIVAL_20100530 into events.geojson at confidence A,
 * from きよさと観光協会's own post eight days after the 2010 event, with the
 * programme — クマゲラ太鼓（緑小学校児童）, 丸太転がし選手権, みどりのウォーキング.
 * What it did not know was where any of it happened: LOC_MIDORI_STATION_PLAZA
 * was a placeholder point whose note reads "No surveyed extent or verified
 * location exists for this plaza".
 *
 * Two things fix that:
 *
 *   1. OpenStreetMap carries the open ground beside the station under the
 *      name 緑駅前広場パークゴルフ場 — the park golf course laid out IN 緑駅前
 *      広場. Two polygons, 2,980 m² and 7,035 m². That is the square's
 *      extent, at OSM's standing (public_gis, and a tracing rather than a
 *      survey), which is better than a placeholder point.
 *
 *   2. The operator, who lived here, states that the festival is held in
 *      駅前広場, that there is a stage there, and that the 小学校 children's
 *      クマゲラ太鼓 was performed in front of it — they were there. First-hand
 *      testimony: evidence_type user_survey.
 *
 * 国土地理院's 電子国土基本図 has exactly one building standing alone inside
 * that open ground, 13.5 x 9.5 m, with nothing else in the square. Its
 * outline is survey; calling it the stage is an inference from the testimony
 * plus the fact that it is the only candidate, and it is recorded as such.
 *
 * TEMP_EVENT SEPARATION: the event does not define any of this geometry. The
 * square's extent comes from OSM and the stage's outline from GSI; the event
 * only points at them. Nothing here is reverse-inferred from the festival
 * having happened.
 *
 * Run:  node scripts/import-station-square.mjs
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const WORLD = join(ROOT, 'public/data/worlds/JP_HOKKAIDO_KIYOSATO_MIDORI_20100530');
const INDEX = join(ROOT, 'public/data/spatial_index/JP.01.546.MIDORI/index.json');
const GSI = join(ROOT, 'scripts/data/gsi_midori.json');

/** The lone structure in the square, from 国土地理院 (local metres from the
 *  station point). Matched by position rather than hard-coded geometry. */
const STAGE_AT = { east: 58.2, north: -33.6, tolerance: 6 };

const DEG = Math.PI / 180;
const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));
const writeJson = (p, v) => writeFileSync(p, `${JSON.stringify(v, null, 2)}\n`);

function main() {
  const gsi = readJson(GSI);
  const [centreLon, centreLat] = gsi.centre;
  const scale = { east: Math.cos(centreLat * DEG) * 111320.0, north: 110574.0 };
  const metres = ([lon, lat]) => [(lon - centreLon) * scale.east, (lat - centreLat) * scale.north];

  const buildings = readJson(join(WORLD, 'reality/buildings.geojson'));
  const poi = readJson(join(WORLD, 'reality/poi.geojson'));
  const events = readJson(join(WORLD, 'reality/events.geojson'));
  const index = readJson(INDEX);

  // ---- 1. the square ----------------------------------------------------
  const squares = buildings.features.filter((f) => f.properties.structure_type === 'park_golf'
    || f.properties.structure_type === 'station_square');
  if (squares.length === 0) throw new Error('no 緑駅前広場 polygons found — run import-osm-town.mjs first');

  let totalArea = 0;
  // Each polygon's own centre is kept: the square comes in two pieces, one
  // beside the station and a strip running north, and averaging them puts
  // the "centre" in neither.
  const centres = [];
  for (const square of squares) {
    const ring = square.geometry.coordinates[0].map(metres);
    const n = ring.length - 1;
    let area = 0;
    for (let i = 0; i < n; i++) area += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
    area = Math.abs(area / 2);
    totalArea += area;
    centres.push({
      area,
      ring,
      at: [
        ring.slice(0, n).reduce((a, p) => a + p[0], 0) / n,
        ring.slice(0, n).reduce((a, p) => a + p[1], 0) / n,
      ],
    });

    square.properties.structure_type = 'station_square';
    square.properties.name = '緑駅前広場';
    square.properties.surface_colour = '#6d8a4e';
    square.properties.current_use = 'パークゴルフ場';
    square.properties.note =
      '緑駅前広場。範囲はOpenStreetMapが「緑駅前広場パークゴルフ場」として持つ外形による'
      + '（public_gis だが実測ではなく航空写真のトレース）。'
      + 'みどりのフェスティバルの会場であることは当事者証言（user_survey）。'
      + 'この範囲は行事の存在から逆算したものではない。';
    square.properties.source_ids = ['SRC_OSM_OVERPASS', 'SRC_USER_TESTIMONY_2026'];
    square.properties.detail_confidence = {
      extent: 'B (public_gis — OSM。ただしトレース由来)',
      is_festival_venue: 'B (user_survey — 当事者証言)',
      surface: 'C (inference — 空中写真では刈られた芝地)',
    };
  }
  // The square the stage stands in is the one nearest it, and that is the
  // one the stage faces across.
  const squareCentre = centres.reduce((best, c) => (
    Math.hypot(c.at[0] - STAGE_AT.east, c.at[1] - STAGE_AT.north)
      < Math.hypot(best.at[0] - STAGE_AT.east, best.at[1] - STAGE_AT.north) ? c : best
  )).at;

  // ---- 2. the stage -----------------------------------------------------
  let stage = null;
  for (const feature of gsi.features) {
    if (feature.layer !== 'building' || feature.type !== 3) continue;
    const ring = feature.rings[0];
    if (!ring || ring.length < 4) continue;
    const local = ring.map(metres);
    const n = local.length - 1;
    const centre = [
      local.slice(0, n).reduce((a, p) => a + p[0], 0) / n,
      local.slice(0, n).reduce((a, p) => a + p[1], 0) / n,
    ];
    if (Math.hypot(centre[0] - STAGE_AT.east, centre[1] - STAGE_AT.north) > STAGE_AT.tolerance) continue;
    stage = { ring, centre };
    break;
  }
  if (!stage) throw new Error('the stage footprint was not found in the GSI extract');

  // the stage faces the open ground, so its front is whichever way the
  // square's centre lies from it
  const facing = ((Math.atan2(squareCentre[0] - stage.centre[0], squareCentre[1] - stage.centre[1]) / DEG) + 360) % 360;

  // import-gsi-town.mjs has already brought this footprint in as an ordinary
  // town building; without dropping that copy the stage is built inside a
  // house, windows and all.
  buildings.features = buildings.features.filter((f) => {
    if (f.properties.id === 'STR_MIDORI_STAGE') return false;
    if (!String(f.properties.id).startsWith('BLDG_GSI_')) return true;
    const r = f.geometry.coordinates[0].map(metres);
    const n = r.length - 1;
    const c = [
      r.slice(0, n).reduce((a, p) => a + p[0], 0) / n,
      r.slice(0, n).reduce((a, p) => a + p[1], 0) / n,
    ];
    return Math.hypot(c[0] - stage.centre[0], c[1] - stage.centre[1]) > 1;
  });
  const closed = stage.ring[0][0] === stage.ring[stage.ring.length - 1][0]
    && stage.ring[0][1] === stage.ring[stage.ring.length - 1][1]
    ? stage.ring : [...stage.ring, stage.ring[0]];
  buildings.features.push({
    type: 'Feature',
    geometry: { type: 'Polygon', coordinates: [closed] },
    properties: {
      id: 'STR_MIDORI_STAGE',
      name: '緑駅前広場 舞台',
      structure_type: 'stage',
      deck_height_m: 0.9,
      roof_height_m: 4.6,
      facing_bearing_deg: Number(facing.toFixed(1)),
      confidence: 'C',
      evidence_type: 'user_survey',
      historical_status: 'plausible',
      source_ids: ['SRC_GSI_BVMAP', 'SRC_USER_TESTIMONY_2026'],
      detail_confidence: {
        footprint: 'B (public_gis — 国土地理院 電子国土基本図 ftCode 3101)',
        is_a_stage: 'C (inference — 「駅前広場に舞台がある」は当事者証言 A 相当だが、'
          + 'GSIのこの外形がその舞台だと同定したのは推論。広場内に単独で建つ構造物は他にない)',
        deck_and_roof_height: 'C (inference — 屋外ステージの一般的な寸法)',
        facing: 'C (inference — 広場の重心の方を向くものとした)',
      },
      note: 'scripts/import-station-square.mjs。外形は国土地理院の実測、'
        + '「舞台である」という同定は当事者証言にもとづく推論。'
        + 'みどりのフェスティバルでクマゲラ太鼓がこの前で演奏された（証言）。',
    },
  });

  // ---- 3. the plaza POI stops being a placeholder -----------------------
  const plaza = poi.features.find((f) => f.properties.id === 'LOC_MIDORI_STATION_PLAZA');
  if (plaza) {
    plaza.geometry.coordinates = [
      Number((squareCentre[0] / scale.east + centreLon).toFixed(7)),
      Number((squareCentre[1] / scale.north + centreLat).toFixed(7)),
    ];
    plaza.properties.confidence = 'B';
    plaza.properties.evidence_type = 'public_gis';
    plaza.properties.existence = 'confirmed';
    plaza.properties.source_ids = ['SRC_OSM_OVERPASS', 'SRC_USER_TESTIMONY_2026'];
    plaza.properties.geometry_note =
      `範囲は STR_MIDORI_PLAZA (OSM「緑駅前広場パークゴルフ場」外形、計 ${Math.round(totalArea)} m²) を参照。`
      + '以前の「実測された範囲は存在しない」という状態は解消したが、外形はOSMのトレースであって測量ではない。';
  }

  // ---- 4. the event points at them --------------------------------------
  const festival = events.features.find((f) => f.properties.id === 'TEMP_EVENT_MIDORI_FESTIVAL_20100530');
  if (festival) {
    festival.properties.venue_ids = ['STR_MIDORI_STATION_SQUARE', 'STR_MIDORI_STAGE'];
    festival.properties.source_ids = [...new Set([...(festival.properties.source_ids ?? []), 'SRC_USER_TESTIMONY_2026'])];
    festival.properties.note = `${festival.properties.note ?? ''}\n\n`
      + '2026年追記: 当事者（当時 緑小学校の児童）の証言により、会場が駅前広場であること、'
      + 'そこに舞台があること、クマゲラ太鼓がその舞台の前で演奏されたことを確認した (user_survey)。'
      + '会場および舞台のジオメトリは OSM / 国土地理院 由来であり、この行事の存在から逆算したものではない '
      + '(TEMP_EVENT 分離)。'
      + `なお 2010-05-30 は日曜日で、5月の最終日曜日にあたる — きよさと観光協会が現在も掲げる`
      + '「毎年5月最終日曜日」という開催規則と整合する。';
  }

  // ---- 5. Index ---------------------------------------------------------
  index.entities = index.entities.filter((e) => e.id !== 'JP.01.546.MIDORI/STATION_SQUARE'
    && e.id !== 'JP.01.546.MIDORI/FESTIVAL_STAGE');
  index.entities.push({
    id: 'JP.01.546.MIDORI/FESTIVAL_STAGE',
    name: '緑駅前広場 舞台',
    category: 'facility',
    geometry_type: 'point',
    geometry: { type: 'Point', coordinates: [
      Number((stage.centre[0] / scale.east + centreLon).toFixed(7)),
      Number((stage.centre[1] / scale.north + centreLat).toFixed(7)),
    ] },
    confidence: 'C',
    evidence_type: 'user_survey',
    source_ids: ['SRC_GSI_BVMAP', 'SRC_USER_TESTIMONY_2026'],
    frontier_status: 'defined',
    detail_ref: 'reality/buildings.geojson#STR_MIDORI_STAGE',
    note: '外形は国土地理院 電子国土基本図の建築物。舞台であるという同定は当事者証言にもとづく推論。',
    position_status: 'located',
  });

  writeJson(join(WORLD, 'reality/buildings.geojson'), buildings);
  writeJson(join(WORLD, 'reality/poi.geojson'), poi);
  writeJson(join(WORLD, 'reality/events.geojson'), events);
  writeJson(INDEX, index);

  console.log('=== 緑駅前広場 ===');
  console.log(`square         ${squares.length} polygons, ${Math.round(totalArea)} m² total`);
  console.log(`square centre  E ${squareCentre[0].toFixed(1)}  N ${squareCentre[1].toFixed(1)} (from the station point)`);
  console.log(`stage          at E ${stage.centre[0].toFixed(1)} N ${stage.centre[1].toFixed(1)}, facing ${facing.toFixed(0)}°`);
  console.log(`event          ${festival ? 'linked to the square and the stage' : 'NOT FOUND'}`);
  console.log(`plaza POI      ${plaza ? 'moved onto the square' : 'NOT FOUND'}`);
}

main();
