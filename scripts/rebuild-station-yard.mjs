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
const GSI = join(ROOT, 'scripts/data/gsi_midori.json');

/** 道路縁 — the surveyed edge of the road surface. */
const FT_ROAD_EDGE = 2201;

// ---------------------------------------------------------------------
// The offsets. Positive = away from the track, on the station building's
// side; positive "along" = toward 札弦/網走 (the direction the KSJ line
// leaves the station point).
// ---------------------------------------------------------------------

/** Platform edge to track centre: 1,475 mm.
 *
 *  Not a guess any more. 鉄道に関する技術上の基準を定める省令等の解釈基準
 *  (国鉄技第157号, SRC_MLIT_TECH_KAISHAKU) 第20条 第1図 — the 建築限界 for a
 *  普通鉄道 — puts the side limit at 1,475 mm from the track centre for
 *  anything up to 920 mm above rail level. A 760 mm platform is inside that
 *  band, so its edge stands there. The same article's table gives the other
 *  way to the same number: the 車両限界 基礎限界 is 1,425 mm half-width at
 *  that height (第4図, L2 = 2,850 mm) and a platform must clear it by 50 mm.
 *
 *  This was 1.8 m, with a comment saying that kept the modelled edge clear
 *  of the modelled railcar — a 325 mm slack the railway does not allow, and
 *  the reason the platform felt wide and the train felt far away. */
const PLATFORM_FACE_OFFSET_M = 1.475;
/** Platform width. Photographs 005, 013 and 014 show room for a row of
 *  planters plus a walking width in front of the building. */
const PLATFORM_WIDTH_M = 3.5;
/** Platform length. Photograph 013 shows it running far past the building
 *  in one direction and ending in painted steps just beyond it in the
 *  other. Which direction is which is not readable from the photographs;
 *  this puts the long leg toward 札弦. 緑 was a 一般駅 working freight until
 *  1982 with locomotive-hauled trains, so its platform is a long one — 60 m
 *  was short enough that the operator noticed it from inside the World. */
const PLATFORM_LONG_LEG_M = 90;
const PLATFORM_SHORT_LEG_M = 30;

/** Second track. Wikipedia 緑駅 §駅構造: 相対式ホーム2面2線 — two opposed
 *  platforms on two tracks, platform 2 reached by the 構内踏切.
 *
 *  4.1 m centres. 省令解釈基準 Ⅲ-11 第22条(1)① sets the floor: the 軌道中心間隔
 *  on a straight main line is the 車両限界 基礎限界's greatest width plus
 *  600 mm, i.e. 3,000 + 600 = 3,600 mm. 4.1 m is the 国鉄以来の停車場内の常用値
 *  and clears that; it is a choice within the rule, not a measurement. */
const TRACK_2_OFFSET_M = -4.1;
/** The floor 第22条 sets, kept here so the choice above can be checked. */
const MIN_TRACK_CENTRES_M = 3.6;

/** The passing loop.
 *
 *  A second track that runs parallel for ever is not a railway. 緑 is a
 *  交換駅: track 2 leaves track 1 through a turnout at each end of the yard,
 *  runs alongside the platform, and comes back. What is reconstructed here
 *  is that shape — two turnouts and the straight between them.
 *
 *  番数 is the frog number: a 1-in-N turnout opens sideways one metre for
 *  every N along. 省令解釈基準 第23条 refers turnout design to 鉄道構造物等
 *  設計標準（軌道構造）, which is not public; the one operator's standard I
 *  could read requires 8番以上の片開き (甲賀市線路構造実施基準 第23条18), so
 *  8番 is the shallowest a station like this would use. At 1-in-8 the 4.1 m
 *  offset takes 32.8 m of divergence.
 *
 *  The loop's length is NOT sourced. It is set so the straight covers the
 *  120 m platform with a train's length of standing room at each end. The
 *  1974-78 aerial photograph (SRC_GSI_PHOTO_GAZO1) shows the yard widened
 *  over several hundred metres, which is consistent, but at 1.2 m a pixel it
 *  cannot place a turnout. */
const TURNOUT_NUMBER = 8;
const LOOP_STRAIGHT_HALF_M = 110;

/** Building depth, from the Blender model's BODY_DEPTH_M. Its platform-side
 *  wall lands on the back edge of the platform, as the photographs show. */
const BUILDING_DEPTH_M = 6.0;
const BUILDING_WIDTH_M = 7.4;

/** Forecourt. That it is green-painted asphalt is confidence A from the
 *  photographs; how far it reaches is not in any of them. An earlier pass
 *  guessed a 26 x 17 m rectangle. The far edge is now taken from 国土地理院's
 *  surveyed 道路縁 (ftCode 2201) — the kerb of the road that runs past the
 *  station — so the apron ends where the road really starts. It turns out to
 *  be a narrow strip, about 5 m at its tightest, not the square the guess
 *  made of it. */
/** How far the forecourt runs back past the station, away from the road. */
const PLAZA_BEHIND_M = 14;
/** Margin past the point where the road actually arrives, so the paving and
 *  the carriageway overlap instead of stopping short of each other. */
const PLAZA_PAST_ROAD_M = 5;
/** Used only if neither the road's end nor the surveyed kerb can be found. */
const PLAZA_FALLBACK_DEPTH_M = 6;
const PLAZA_FALLBACK_ALONG_M = 16;

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

/**
 * Builds a lookup from position along the track to the distance out at which
 * the nearest surveyed road edge sits, so the forecourt can end where the
 * road does. Returns null where no edge runs near that point.
 */
function roadEdgeProfile(gsi, anchorLat, anchorLon, scale, along, out) {
  const points = [];
  for (const feature of gsi.features) {
    if (feature.layer !== 'road' || feature.tags.ftCode !== FT_ROAD_EDGE) continue;
    for (const ring of feature.rings) {
      for (const [lon, lat] of ring) {
        // into metres about the yard's anchor, then onto the yard's own axes
        const e = (lon - anchorLon) * scale.east;
        const n = (lat - anchorLat) * scale.north;
        const a = e * along.east + n * along.north;
        const o = e * out.east + n * out.north;
        if (o > 0 && o < 60 && Math.abs(a) < 120) points.push([a, o]);
      }
    }
  }
  if (points.length < 2) return () => null;
  points.sort((p, q) => p[0] - q[0]);
  return (a) => {
    // The nearest edge to the station within a window along the track — the
    // apron ends at the first kerb, not at whichever vertex happens to be
    // closest along the line.
    let nearest = null;
    for (const [pa, po] of points) {
      if (Math.abs(pa - a) > 25) continue;
      if (nearest === null || po < nearest) nearest = po;
    }
    return nearest;
  };
}

/**
 * How far along the track the road actually reaches the station.
 *
 * 駅前通り arrives diagonally and stops at the forecourt. Taking the nearest
 * road END rather than the nearest road POINT is the whole trick: the
 * carriageway runs past the station at a distance for hundreds of metres,
 * and only its terminus says where the forecourt has to be.
 */
function roadArrivalAlong(gsi, anchorLat, anchorLon, scale, along, out, facadeOut) {
  let best = null;
  let bestDistance = 60;
  for (const feature of gsi.features) {
    if (feature.layer !== 'road') continue;
    if (feature.tags.ftCode !== 2701 && feature.tags.ftCode !== 2703) continue;
    for (const ring of feature.rings) {
      for (const [lon, lat] of [ring[0], ring[ring.length - 1]]) {
        const e = (lon - anchorLon) * scale.east;
        const n = (lat - anchorLat) * scale.north;
        const a = e * along.east + n * along.north;
        const o = e * out.east + n * out.north;
        // an end that stops in front of the building, not one out in the town
        if (o < facadeOut - 6 || o > facadeOut + 26) continue;
        const distance = Math.hypot(a, o - facadeOut);
        if (distance < bestDistance) { bestDistance = distance; best = a; }
      }
    }
  }
  return best;
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

  // How far the forecourt reaches, measured against the surveyed road edge
  // rather than guessed. `outAtAlong` returns the road edge's distance from
  // the track at a given point along it.
  const gsiData = readJson(GSI);
  const outAtAlong = roadEdgeProfile(gsiData, anchorLat, anchorLon, scale, along, out);
  // Where the road actually reaches the station. 駅前通り comes in from the
  // north-east and stops at the forecourt; a forecourt that ends short of
  // that leaves the road finishing in a field, which is what it did.
  const roadArrival = roadArrivalAlong(gsiData, anchorLat, anchorLon, scale, along, out, facadeOut);
  const plazaFarAlong = (roadArrival === null ? PLAZA_FALLBACK_ALONG_M : roadArrival) + PLAZA_PAST_ROAD_M;
  const plazaFar = (a) => {
    const edge = outAtAlong(a);
    return edge === null ? facadeOut + PLAZA_FALLBACK_DEPTH_M : Math.max(facadeOut + 2.5, edge);
  };
  const plazaDepthMid = plazaFar(0) - facadeOut;

  const plazaEntity = index.entities.find((e) => e.id === 'JP.01.546.MIDORI/STATION_PLAZA');
  plazaEntity.geometry.coordinates = at((plazaFarAlong - PLAZA_BEHIND_M) / 2, facadeOut + plazaDepthMid / 2);
  plazaEntity.position_accuracy_m = 12;
  plazaEntity.note =
    'scripts/rebuild-station-yard.mjs による再構成。広場が緑色に塗装されている事実は写真によりconfidence A。'
    + '奥行きは国土地理院 電子国土基本図の道路縁(ftCode 2201)までの距離として決めており、'
    + `駅舎正面から約 ${plazaDepthMid.toFixed(1)} m。以前の版はここを17 mの矩形と推定していたが、実際には道路が駅舎のすぐ前を通る。`;
  note('STATION_PLAZA', `apron from the facade to the surveyed kerb, running ${(plazaFarAlong + PLAZA_BEHIND_M).toFixed(0)} m along to meet the road at ${roadArrival === null ? 'a fallback point' : `${roadArrival.toFixed(0)} m`}`);

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
  // A trapezium following the road edge rather than a rectangle: the road
  // runs away from the station at an angle, so the apron is wider at one end.
  plazaFeature.geometry.coordinates = [[
    at(-PLAZA_BEHIND_M, facadeOut),
    at(plazaFarAlong, facadeOut),
    at(plazaFarAlong, plazaFar(plazaFarAlong)),
    at(-PLAZA_BEHIND_M, plazaFar(-PLAZA_BEHIND_M)),
    at(-PLAZA_BEHIND_M, facadeOut),
  ]];
  plazaFeature.properties.note =
    'scripts/rebuild-station-yard.mjs による再構成 — 駅舎正面から国土地理院の道路縁(2201)までの台形で、'
    + '線路方向には道路（道路構成線 2701）が実際に到達する地点まで伸ばしてある。'
    + '以前は左右16 mの対称な帯だったため、道路が広場の手前20 mで途切れて畑の中で終わっていた。'
    + '緑色塗装であることは写真によりA、奥行きは道路縁までの実測距離、幅は推定でC。';
  plazaFeature.properties.source_ids = ['SRC_PHOTO_20090520', 'SRC_GSI_BVMAP'];

  // The terrace itself. The platform and the forecourt each raise the ground
  // under themselves, but the 6 m strip the station building stands on lay
  // between them and belonged to neither — so the building stood 1.25 m over
  // ground that had not been raised, and read as floating. This one polygon
  // spans the whole yard from the platform face to the forecourt's far edge.
  buildings.features = buildings.features.filter((f) => f.properties.id !== 'STR_MIDORI_STATION_TERRACE');
  buildings.features.push({
    type: 'Feature',
    geometry: { type: 'Polygon', coordinates: rect(
      -PLAZA_BEHIND_M, plazaFarAlong, PLATFORM_FACE_OFFSET_M, plazaFar(0),
    ) },
    properties: {
      id: 'STR_MIDORI_STATION_TERRACE',
      name: '緑駅 構内地盤',
      structure_type: 'station_terrace',
      confidence: 'C',
      evidence_type: 'inference',
      historical_status: 'plausible',
      source_ids: ['SRC_PHOTO_SET_USER_2026'],
      note: '駅前広場・駅舎の床・ホーム面が同一レベルであることは写真から明らか。'
        + 'DEMは10 mメッシュでこの段差を持たないため、地盤を持ち上げる範囲としてこのポリゴンを与えている。'
        + '見た目の要素ではなく、地形の補正のための形状。',
    },
  });

  const container = byId.get('STR_MIDORI_RAIL_CONTAINER');
  container.geometry.coordinates = rect(-22, -16, facadeOut - 1.0, facadeOut + 1.5);
  container.properties.note =
    'scripts/rebuild-station-yard.mjs による再構成 — 写真032が広場の脇に置いているのに合わせた位置。'
    + '形式・寸法は依然として不明(12ft級と推定)。';

  // Track 2. Photographs 013, 014 and 034 all show a second track, and the
  // encyclopedia names it as a のりば; the KSJ centreline carries only the
  // through route, so it has to be reconstructed here.
  railway.features = railway.features.filter(
    (f) => f.properties.id !== 'RAIL_SENMO_MIDORI_LOOP' && f.properties.id !== 'RAIL_SENMO_MIDORI_TRACK2');
  // The loop, centred on the platform: turnout, divergence at 1-in-N, the
  // straight past the platform, then back the same way.
  const platformCentre = (PLATFORM_SHORT_LEG_M - PLATFORM_LONG_LEG_M) / 2;
  const lead = Math.abs(TRACK_2_OFFSET_M) * TURNOUT_NUMBER;
  const loopStart = platformCentre - LOOP_STRAIGHT_HALF_M;
  const loopEnd = platformCentre + LOOP_STRAIGHT_HALF_M;
  const loopCoordinates = [
    at(loopStart - lead, 0),
    at(loopStart, TRACK_2_OFFSET_M),
    at(loopEnd, TRACK_2_OFFSET_M),
    at(loopEnd + lead, 0),
  ];
  railway.features.push({
    type: 'Feature',
    geometry: { type: 'LineString', coordinates: loopCoordinates },
    properties: {
      id: 'RAIL_SENMO_MIDORI_TRACK2',
      name: '釧網本線 緑駅 2番線（交換設備）',
      confidence: 'C',
      evidence_type: 'inference',
      historical_status: 'plausible',
      source_ids: [
        'SRC_PHOTO_SET_USER_2026', 'SRC_WIKI_JA_MIDORI',
        'SRC_MLIT_TECH_KAISHAKU', 'SRC_SHIGARAKI_JISSHI_KIJUN', 'SRC_GSI_PHOTO_GAZO1',
      ],
      note:
        'Wikipedia「緑駅」§駅構造の「相対式ホーム2面2線」と、写真013/014/034に写る2本目の線路による。'
        + '国土数値情報(KSJ N02)は本線のセンターラインしか持たないため、2番線はここで再構成した。'
        + `線路中心間隔 ${Math.abs(TRACK_2_OFFSET_M)} m は省令解釈基準 第22条(1)①の下限 ${MIN_TRACK_CENTRES_M} m`
        + '（車両限界の基礎限界の最大幅3,000 mm + 600 mm）を満たす国鉄以来の停車場内常用値。'
        + `両端に${TURNOUT_NUMBER}番片開き分岐器相当の開き（1:${TURNOUT_NUMBER}、リード ${lead.toFixed(1)} m）を置き、`
        + `ホームを含む ${LOOP_STRAIGHT_HALF_M * 2} m を平行区間とした。`
        + '以前は分岐を持たない平行2直線で、これは鉄道として成立していなかった。'
        + '分岐器の番数は甲賀市線路構造実施基準 第23条18の「8番以上の片開き」による下限であり、'
        + '緑駅の実際の番数と交換有効長は文献に当たれていない。分岐器のリードは直線近似で、'
        + 'トングレール・クロッシングの実形状は再現していない。',
    },
  });
  note('RAIL_SENMO_MIDORI_TRACK2',
    `passing loop: 1:${TURNOUT_NUMBER} turnouts, ${lead.toFixed(1)} m lead, ${LOOP_STRAIGHT_HALF_M * 2} m parallel`);

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
  console.log(`plaza             ${facadeOut.toFixed(2)} m .. ${plazaFar(0).toFixed(2)} m  (far edge from 国土地理院 道路縁)`);
  console.log(`track 2           ${TRACK_2_OFFSET_M.toFixed(2)} m`);
  console.log(`platform 2        ${(TRACK_2_OFFSET_M - PLATFORM_FACE_OFFSET_M).toFixed(2)} m .. ${(TRACK_2_OFFSET_M - PLATFORM_FACE_OFFSET_M - PLATFORM_WIDTH_M).toFixed(2)} m`);
  console.log('');
  for (const line of report) console.log(`  ${line}`);
}

main();
