#!/usr/bin/env node
/**
 * Rebuilds the 緑駅 station yard as one consistent plan.
 *
 * WHY THIS EXISTS
 * ---------------
 * Every footprint in the yard — the station building's position, both
 * platforms, the plaza pavement — was placed separately, by eye, in
 * Directive 08, and each one is recorded in the data as
 * `confidence: "C", evidence_type: "inference"` with a note saying the
 * coordinate is a placement convenience rather than a measurement.
 *
 * Placed separately, they do not agree with each other. Measured on the
 * shipped data, the railway centreline passed 4.0 m from the centre of a
 * 6.0 m deep building: its platform-side wall stood 1.0 m from the track,
 * inside the loading gauge, and the platform polygons overlapped both the
 * building and the line. A train run on that centreline goes through the
 * station building. No amount of surfacing fixes a plan that is wrong.
 *
 * WHAT THIS DOES
 * --------------
 * Re-derives the whole yard from ONE anchor and a small number of stated
 * offsets, so the parts are consistent by construction rather than by luck:
 *
 *   anchor   JP.01.546.MIDORI/STATION — confidence A, public_gis
 *            (MLIT KSJ N02 2008/2011 + Wikidata), which is also the first
 *            vertex of the railway centreline, i.e. a point ON the track.
 *   axis     the local bearing of the KSJ centreline at that point.
 *   offsets  measured perpendicular to the track, listed below with the
 *            reason for each.
 *
 * The result is not survey data and is not promoted: every rewritten
 * feature keeps confidence C, and its evidence_type stays `inference`.
 * What changes is that the inference is now one coherent reconstruction
 * with its reasoning written down, instead of six independent guesses.
 *
 * Run:  node scripts/rebuild-station-yard.mjs
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const WORLD = join(ROOT, 'public/data/worlds/JP_HOKKAIDO_KIYOSATO_MIDORI_20100530');
const INDEX = join(ROOT, 'public/data/spatial_index/JP.01.546.MIDORI/index.json');

// ---------------------------------------------------------------------
// The offsets. Positive = away from the track, on the station building's
// side; positive "along" = toward 札弦/網走 (the direction the KSJ line
// leaves the station point).
// ---------------------------------------------------------------------

/** Platform edge to track centre. JR low platforms sit about 1.5-1.7 m off
 *  centre; 1.8 m keeps the modelled edge clear of the modelled railcar. */
const PLATFORM_FACE_OFFSET_M = 1.8;
/** Platform width. Photographs 005, 013 and 014 show room for a row of
 *  planters plus a walking width in front of the building. */
const PLATFORM_WIDTH_M = 3.5;
/** Platform length. Photograph 013 shows it running far past the building
 *  in one direction and ending in painted steps just beyond it in the
 *  other. Which direction is which is not readable from the photographs;
 *  this puts the long leg toward 札弦. */
const PLATFORM_LONG_LEG_M = 52;
const PLATFORM_SHORT_LEG_M = 8;

/** Second track. Wikipedia 緑駅 §駅構造: 相対式ホーム2面2線 — two opposed
 *  platforms on two tracks, platform 2 reached by the 構内踏切. 4.1 m is
 *  the JR standard centre-to-centre spacing on plain line. */
const TRACK_2_OFFSET_M = -4.1;

/** Building depth, from the Blender model's BODY_DEPTH_M. Its platform-side
 *  wall lands on the back edge of the platform, as the photographs show. */
const BUILDING_DEPTH_M = 6.0;
const BUILDING_WIDTH_M = 7.4;

/** Forecourt. Photographs 011, 016, 028 and 032 show a broad green-painted
 *  apron running the width of the building and well out in front of it;
 *  none of them gives a dimension, so these are read off the apparent
 *  proportions in 032 against the building's known 7.4 m width. */
const PLAZA_DEPTH_M = 17;
const PLAZA_HALF_WIDTH_M = 13;

/** 構内踏切 — the timber boards across both tracks at the platform's short
 *  end (photographs 013 and 014). */
const CROSSING_ALONG_M = PLATFORM_SHORT_LEG_M + 3.5;
const CROSSING_LENGTH_M = 3.0;

const DEG = Math.PI / 180;

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}
function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

/** Metres per degree at this latitude — the World is 2 km across, so a
 *  local tangent approximation is exact enough by three orders of
 *  magnitude. */
function scaleAt(lat) {
  return { east: Math.cos(lat * DEG) * 111320.0, north: 110574.0 };
}

function main() {
  const index = readJson(INDEX);
  const buildings = readJson(join(WORLD, 'reality/buildings.geojson'));
  const railway = readJson(join(WORLD, 'reality/railway.geojson'));

  const station = index.entities.find((e) => e.id === 'JP.01.546.MIDORI/STATION');
  if (!station) throw new Error('anchor entity JP.01.546.MIDORI/STATION not found');
  const [anchorLon, anchorLat] = station.geometry.coordinates;
  const scale = scaleAt(anchorLat);

  // Local track bearing: the KSJ centreline's direction at the anchor.
  const chain = railway.features
    .filter((f) => f.geometry.type === 'LineString')
    .map((f) => f.geometry.coordinates)
    .find((cs) => cs.some(([lon, lat]) => Math.abs(lon - anchorLon) < 1e-6 && Math.abs(lat - anchorLat) < 1e-6));
  if (!chain || chain.length < 2) throw new Error('no railway LineString passes through the anchor');
  const [aLon, aLat] = chain[0];
  const [bLon, bLat] = chain[1];
  const alongEast = (bLon - aLon) * scale.east;
  const alongNorth = (bLat - aLat) * scale.north;
  const alongLength = Math.hypot(alongEast, alongNorth);
  const along = { east: alongEast / alongLength, north: alongNorth / alongLength };
  // "out" is along rotated 90 degrees clockwise seen from above, chosen so
  // that it points at the station building rather than away from it.
  let out = { east: along.north, north: -along.east };
  const buildingEntity = index.entities.find((e) => e.id === 'JP.01.546.MIDORI/STATION_BUILDING');
  const oldE = (buildingEntity.geometry.coordinates[0] - anchorLon) * scale.east;
  const oldN = (buildingEntity.geometry.coordinates[1] - anchorLat) * scale.north;
  if (oldE * out.east + oldN * out.north < 0) out = { east: -out.east, north: -out.north };

  const bearing = (v) => ((Math.atan2(v.east, v.north) / DEG) + 360) % 360;
  const trackBearing = bearing(along);
  const facadeBearing = bearing(out);

  /** (along, out) in metres -> [lon, lat]. */
  const at = (a, o) => [
    anchorLon + (along.east * a + out.east * o) / scale.east,
    anchorLat + (along.north * a + out.north * o) / scale.north,
  ];
  /** A closed rectangle in (along, out) metres. */
  const rect = (a0, a1, o0, o1) => [[at(a0, o0), at(a1, o0), at(a1, o1), at(a0, o1), at(a0, o0)]];

  const platformBack = PLATFORM_FACE_OFFSET_M + PLATFORM_WIDTH_M;
  const buildingCentreOut = platformBack + BUILDING_DEPTH_M / 2;
  const facadeOut = platformBack + BUILDING_DEPTH_M;

  const report = [];
  const note = (id, text) => report.push(`${id}: ${text}`);

  // ---- Spatial Index -------------------------------------------------
  const buildingCoords = at(0, buildingCentreOut);
  buildingEntity.geometry.coordinates = buildingCoords;
  buildingEntity.orientation.facade_bearing_deg = Number(facadeBearing.toFixed(1));
  buildingEntity.orientation.note =
    '正面(三角ポーチのある面)は駅前広場側、ホーム側下屋は線路側。方位角は駅点における釧網本線センターラインの接線に直交する向きとして再計算した値。';
  buildingEntity.position_accuracy_m = 8;
  buildingEntity.note =
    'scripts/rebuild-station-yard.mjs による再構成。駅点(confidence A / public_gis)を唯一のアンカーとし、'
    + `線路中心からホーム面 ${PLATFORM_FACE_OFFSET_M} m、ホーム幅 ${PLATFORM_WIDTH_M} m、`
    + `駅舎奥行 ${BUILDING_DEPTH_M} m の順に積み上げて中心を決めている。`
    + '旧座標は Directive 08 が実装上の都合で置いたもので、線路中心から 4.0 m — 6.0 m 奥行の建物の'
    + 'ホーム側壁が線路から 1.0 m の位置に来る、建築限界上ありえない配置だった。'
    + '実測ではないので confidence C / inference のまま据え置く。';
  note('STATION_BUILDING', `moved to ${buildingCentreOut.toFixed(2)} m from the track centreline, facade bearing ${facadeBearing.toFixed(1)}°`);

  const platformCentreAlong = (PLATFORM_SHORT_LEG_M - PLATFORM_LONG_LEG_M) / 2;
  const platformEntity = index.entities.find((e) => e.id === 'JP.01.546.MIDORI/PLATFORM_1');
  platformEntity.geometry.coordinates = at(platformCentreAlong, PLATFORM_FACE_OFFSET_M + PLATFORM_WIDTH_M / 2);
  platformEntity.confidence = 'C';
  platformEntity.evidence_type = 'inference';
  platformEntity.position_accuracy_m = 8;
  platformEntity.note =
    'scripts/rebuild-station-yard.mjs による再構成。'
    + `長さ ${PLATFORM_LONG_LEG_M + PLATFORM_SHORT_LEG_M} m、幅 ${PLATFORM_WIDTH_M} m、線路中心からホーム面 ${PLATFORM_FACE_OFFSET_M} m。`
    + '長さと幅は写真013/014の見えから、線路中心からの離れはJRの低ホームの一般値による。';
  note('PLATFORM_1', `${PLATFORM_LONG_LEG_M + PLATFORM_SHORT_LEG_M} m x ${PLATFORM_WIDTH_M} m strip alongside the track`);

  // Platform 2. Wikipedia 緑駅 §駅構造 states 相対式ホーム2面2線 and that
  // platform 2 is reached across the 構内踏切 — so it is opposed to platform
  // 1 on the far side of track 2, not absent. An earlier pass in this
  // session read the photographs as showing a single platform face and was
  // about to delete this entity; the encyclopedia is the better evidence for
  // a configuration that a 400 px photograph taken from one end cannot
  // settle either way.
  const platform2Out = TRACK_2_OFFSET_M - PLATFORM_FACE_OFFSET_M;
  const platform2 = index.entities.find((e) => e.id === 'JP.01.546.MIDORI/PLATFORM_2');
  platform2.geometry = { type: 'Point', coordinates: at(platformCentreAlong, platform2Out - PLATFORM_WIDTH_M / 2) };
  platform2.detail_ref = 'reality/buildings.geojson#STR_MIDORI_PLATFORM_2';
  platform2.position_status = 'approximate';
  platform2.frontier_status = 'defined';
  platform2.confidence = 'C';
  platform2.evidence_type = 'inference';
  platform2.position_accuracy_m = 8;
  platform2.note =
    'scripts/rebuild-station-yard.mjs による再構成。Wikipedia「緑駅」§駅構造の「相対式ホーム2面2線」'
    + 'および「2番のりばへは構内踏切を通る」という記述に従い、2番線の向こう側に1番線と相対して置いている。'
    + `線路中心間隔 ${Math.abs(TRACK_2_OFFSET_M)} m はJRの平面区間の標準値、ホームの寸法は1番線と同じとした。`;
  note('PLATFORM_2', `opposed platform beyond track 2, ${Math.abs(platform2Out).toFixed(1)} m from the main track`);

  const plazaEntity = index.entities.find((e) => e.id === 'JP.01.546.MIDORI/STATION_PLAZA');
  plazaEntity.geometry.coordinates = at(0, facadeOut + PLAZA_DEPTH_M / 2);
  plazaEntity.position_accuracy_m = 12;
  plazaEntity.note =
    'scripts/rebuild-station-yard.mjs による再構成。広場が緑色に塗装されている事実は写真によりconfidence Aだが、'
    + 'ここで与えている位置と範囲は駅舎正面に接する矩形として構成したもので、実測ではない。';
  note('STATION_PLAZA', `${PLAZA_HALF_WIDTH_M * 2} m x ${PLAZA_DEPTH_M} m apron against the facade`);

  // ---- Reality Data --------------------------------------------------
  const byId = new Map(buildings.features.map((f) => [f.properties.id, f]));

  byId.get('STR_MIDORI_STATION_BUILDING').geometry.coordinates = buildingCoords;

  const platformFeature = byId.get('STR_MIDORI_PLATFORM_1');
  platformFeature.geometry.coordinates = rect(
    -PLATFORM_LONG_LEG_M, PLATFORM_SHORT_LEG_M,
    PLATFORM_FACE_OFFSET_M, platformBack,
  );
  platformFeature.properties.length_m = PLATFORM_LONG_LEG_M + PLATFORM_SHORT_LEG_M;
  platformFeature.properties.width_m = PLATFORM_WIDTH_M;
  // Which ring edge faces the track. The painted edge stripe belongs on that
  // one only — painting it round all four sides put a warning line along the
  // back of the platform, where nothing arrives.
  platformFeature.properties.track_edge_index = 0;
  platformFeature.properties.note =
    'scripts/rebuild-station-yard.mjs による再構成 — 駅点を基準に線路方向へ展開した矩形。'
    + '旧ポリゴンは駅舎と線路の双方に重なっていた。';

  const platform2Feature = byId.get('STR_MIDORI_PLATFORM_2');
  platform2Feature.geometry.coordinates = rect(
    -PLATFORM_LONG_LEG_M, PLATFORM_SHORT_LEG_M,
    platform2Out - PLATFORM_WIDTH_M, platform2Out,
  );
  platform2Feature.properties.length_m = PLATFORM_LONG_LEG_M + PLATFORM_SHORT_LEG_M;
  platform2Feature.properties.width_m = PLATFORM_WIDTH_M;
  // platform 2 is built from its back edge outward, so its track face is the
  // far edge of the ring rather than the near one
  platform2Feature.properties.track_edge_index = 2;
  platform2Feature.properties.note =
    'scripts/rebuild-station-yard.mjs による再構成 — 相対式2面2線の対向ホーム。旧ポリゴンは線路と重なっていた。';

  const crossing = byId.get('STR_MIDORI_LEVEL_CROSSING');
  crossing.geometry.coordinates = rect(
    CROSSING_ALONG_M - CROSSING_LENGTH_M / 2, CROSSING_ALONG_M + CROSSING_LENGTH_M / 2,
    platform2Out, PLATFORM_FACE_OFFSET_M,
  );
  crossing.properties.note =
    'scripts/rebuild-station-yard.mjs による再構成 — ホーム端から副本線を越えるまでの板張り。写真013/014。';

  const plazaFeature = byId.get('STR_MIDORI_PLAZA_PAVEMENT');
  plazaFeature.geometry.coordinates = rect(
    -PLAZA_HALF_WIDTH_M, PLAZA_HALF_WIDTH_M,
    facadeOut, facadeOut + PLAZA_DEPTH_M,
  );
  plazaFeature.properties.note =
    'scripts/rebuild-station-yard.mjs による再構成 — 駅舎正面に接する矩形。'
    + '緑色塗装であることは写真によりA、この形状と範囲はC。';

  const container = byId.get('STR_MIDORI_RAIL_CONTAINER');
  container.geometry.coordinates = rect(-16, -10, facadeOut - 1.0, facadeOut + 1.5);
  container.properties.note =
    'scripts/rebuild-station-yard.mjs による再構成 — 写真032が広場の脇に置いているのに合わせた位置。'
    + '形式・寸法は依然として不明(12ft級と推定)。';

  // Track 2. Photographs 013, 014 and 034 all show a second track, and the
  // encyclopedia names it as a のりば; the KSJ centreline carries only the
  // through route, so it has to be reconstructed here.
  railway.features = railway.features.filter(
    (f) => f.properties.id !== 'RAIL_SENMO_MIDORI_LOOP' && f.properties.id !== 'RAIL_SENMO_MIDORI_TRACK2');
  railway.features.push({
    type: 'Feature',
    geometry: {
      type: 'LineString',
      coordinates: [at(-150, TRACK_2_OFFSET_M), at(60, TRACK_2_OFFSET_M)],
    },
    properties: {
      id: 'RAIL_SENMO_MIDORI_TRACK2',
      name: '釧網本線 緑駅 2番線',
      confidence: 'C',
      evidence_type: 'inference',
      historical_status: 'plausible',
      source_ids: ['SRC_PHOTO_SET_USER_2026', 'SRC_WIKI_JA_MIDORI'],
      note:
        'Wikipedia「緑駅」§駅構造の「相対式ホーム2面2線」と、写真013/014/034に写る2本目の線路による。'
        + '国土数値情報(KSJ N02)は本線のセンターラインしか持たないため、2番線はここで再構成した。'
        + '線路中心間隔4.1 mはJRの平面区間の標準値、延長と分岐位置は資料からは決まらないので便宜的な値。',
    },
  });
  note('RAIL_SENMO_MIDORI_TRACK2', `second platform track added at ${Math.abs(TRACK_2_OFFSET_M)} m centres`);

  writeJson(INDEX, index);
  writeJson(join(WORLD, 'reality/buildings.geojson'), buildings);
  writeJson(join(WORLD, 'reality/railway.geojson'), railway);

  console.log('=== 緑駅 station yard rebuilt ===');
  console.log(`anchor            ${anchorLat.toFixed(6)}, ${anchorLon.toFixed(6)}  (STATION, confidence A)`);
  console.log(`track bearing     ${trackBearing.toFixed(1)}°`);
  console.log(`facade bearing    ${facadeBearing.toFixed(1)}°  (perpendicular, away from the track)`);
  console.log(`platform face     ${PLATFORM_FACE_OFFSET_M.toFixed(2)} m from track centre`);
  console.log(`platform back     ${platformBack.toFixed(2)} m`);
  console.log(`building centre   ${buildingCentreOut.toFixed(2)} m   (was 4.00 m)`);
  console.log(`building facade   ${facadeOut.toFixed(2)} m`);
  console.log(`plaza             ${facadeOut.toFixed(2)} m .. ${(facadeOut + PLAZA_DEPTH_M).toFixed(2)} m`);
  console.log(`track 2           ${TRACK_2_OFFSET_M.toFixed(2)} m`);
  console.log(`platform 2        ${(TRACK_2_OFFSET_M - PLATFORM_FACE_OFFSET_M).toFixed(2)} m .. ${(TRACK_2_OFFSET_M - PLATFORM_FACE_OFFSET_M - PLATFORM_WIDTH_M).toFixed(2)} m`);
  console.log('');
  for (const line of report) console.log(`  ${line}`);
}

main();
