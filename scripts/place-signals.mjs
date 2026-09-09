#!/usr/bin/env node
/**
 * 緑駅の常置信号機 — the signals in the station yard.
 *
 * WHY THERE ARE SIGNALS HERE AT ALL, which is the part that has a document
 * behind it:
 *
 *   釧網本線's 閉塞方式 is 特殊自動閉塞式（電子符号照査式）(SRC_WP_SENMO).
 *   省令解釈基準 Ⅶ-1 第54条関係 4 — 「単線運転をする区間における自動閉そく式
 *   及び特殊自動閉そく式の閉そく装置は、進路が相対する出発信号機相互間を連鎖
 *   させるものであること」 — so a passing station on this line HAS departure
 *   signals, and they are what the block system interlocks. 第117条関係 1 の
 *   定義: 場内信号機 は停車場に進入する列車に対し、出発信号機 は停車場から
 *   進出する列車に対し信号を現示するもの。緑 is a 停車場 with a 交換設備 and
 *   two platform tracks, so trains enter under a 場内信号機 and leave under
 *   an 出発信号機, one per track per direction: two home, four departure.
 *
 *   Both 2018 photographs corroborate it — colour-light heads on masts at
 *   the platform and away down the line in each direction, their backs the
 *   same weathered rust orange.
 *
 * WHAT IS NOT SOURCED, and is therefore inference:
 *
 *   Where along the line each one stands. A home signal must be outside the
 *   outermost turnout and a departure signal at the departure end of its
 *   track, and that is all the rule fixes; the actual distances at 緑 are
 *   not in anything reachable. They are placed from the yard's own geometry
 *   and say so.
 *
 *   Whether the home signals carry two heads or a 進路表示機. 第55条関係 5
 *   requires a home signal per route unless a route indicator is fitted, and
 *   緑 has two routes from each approach. One head is modelled.
 *
 * Run: node scripts/place-signals.mjs
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const WORLD = join(ROOT, 'public/data/worlds/JP_HOKKAIDO_KIYOSATO_MIDORI_20100530');
const INDEX = join(ROOT, 'public/data/spatial_index/JP.01.546.MIDORI/index.json');

/* The yard's own numbers, kept in step with scripts/rebuild-station-yard.mjs.
 * If that file's platform or loop changes, these move with it. */
const PLATFORM_FACE_OFFSET_M = 1.475;
const PLATFORM_WIDTH_M = 3.5;
const PLATFORM_LONG_LEG_M = 116;
const PLATFORM_SHORT_LEG_M = 4;
const TRACK_2_OFFSET_M = -4.1;
const TURNOUT_NUMBER = 8;
const LOOP_STRAIGHT_HALF_M = 110;

/** How far past the platform's end a departure signal stands. Inference. */
const DEPARTURE_BEYOND_PLATFORM_M = 8;
/** How far outside the turnout a home signal stands. Inference. */
const HOME_BEYOND_TURNOUT_M = 60;
/** Where the head sits relative to its own track's centre, on the platform
 *  side. SRC_COMMONS_MIDORI_PLATFORM_2018 shows the head on a cantilever
 *  arm out over the track, not beside it. 1.2 m also clears the 建築限界 of
 *  省令解釈基準 第20条 第1図 at the head's height. */
const HEAD_OVER_TRACK_M = 1.2;
/** Home signals stand beside a single track, no arm. Japanese practice puts
 *  a signal to the LEFT of the direction of travel; no document in hand
 *  states it, so it is recorded as convention. */
const HOME_SIDE_OFFSET_M = 2.6;

const DEG = Math.PI / 180;
const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));
const writeJson = (p, v) => writeFileSync(p, `${JSON.stringify(v, null, 2)}\n`);

function main() {
  const index = readJson(INDEX);
  const buildings = readJson(join(WORLD, 'reality/buildings.geojson'));
  const railway = readJson(join(WORLD, 'reality/railway.geojson'));

  buildings.features = buildings.features
    .filter((f) => !String(f.properties.id).startsWith('STR_MIDORI_SIGNAL_'));

  const station = index.entities.find((e) => e.id === 'JP.01.546.MIDORI/STATION');
  if (!station) throw new Error('JP.01.546.MIDORI/STATION not found');
  const [anchorLon, anchorLat] = station.geometry.coordinates;
  const mLat = 111132.0;
  const mLon = 111320.0 * Math.cos(anchorLat * DEG);

  // the line's own direction, taken the way the yard rebuild takes it
  const chain = railway.features
    .find((f) => f.properties.id === 'RAIL_SENMO_KSJ_001').geometry.coordinates;
  const [aLon, aLat] = chain[0];
  const [bLon, bLat] = chain[1];
  const dE = (bLon - aLon) * mLon;
  const dN = (bLat - aLat) * mLat;
  const len = Math.hypot(dE, dN);
  const along = { east: dE / len, north: dN / len };
  const out = { east: along.north, north: -along.east };
  const trackBearing = ((Math.atan2(along.east, along.north) / DEG) + 360) % 360;

  // where the station building was put, so the platform and loop are found
  // at the same place the yard rebuild left them
  const buildingEntity = index.entities.find((e) => e.id === 'JP.01.546.MIDORI/STATION_BUILDING');
  const bE = (buildingEntity.geometry.coordinates[0] - anchorLon) * mLon;
  const bN = (buildingEntity.geometry.coordinates[1] - anchorLat) * mLat;
  const stationAlong = bE * along.east + bN * along.north;

  const at = (a, o) => [
    anchorLon + (along.east * a + out.east * o) / mLon,
    anchorLat + (along.north * a + out.north * o) / mLat,
  ];

  const platformCentre = stationAlong + (PLATFORM_SHORT_LEG_M - PLATFORM_LONG_LEG_M) / 2;
  const platformHalf = (PLATFORM_SHORT_LEG_M + PLATFORM_LONG_LEG_M) / 2;
  const platformBack = PLATFORM_FACE_OFFSET_M + PLATFORM_WIDTH_M;
  const lead = Math.abs(TRACK_2_OFFSET_M) * TURNOUT_NUMBER;

  // 札弦 is +along; 川湯温泉 is −along.
  const SATSURU = { sign: +1, name: '札弦', bearing: trackBearing };
  const KAWAYU = { sign: -1, name: '川湯温泉', bearing: (trackBearing + 180) % 360 };

  const features = [];
  const push = (id, name, coords, facing, armLength, props) => {
    features.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: coords },
      properties: {
        id,
        name,
        structure_type: 'signal',
        facing_bearing_deg: Number(facing.toFixed(1)),
        arm_length_m: Number(armLength.toFixed(2)),
        confidence: 'C',
        evidence_type: 'inference',
        historical_status: 'plausible',
        position_status: 'approximate',
        position_accuracy_m: 40,
        source_ids: [
          'SRC_WP_SENMO', 'SRC_WIKI_JA_MIDORI', 'SRC_MLIT_TECH_KAISHAKU',
          'SRC_COMMONS_MIDORI_PLATFORM_2018', 'SRC_COMMONS_MIDORI_CROSSING_2018',
        ],
        ...props,
      },
    });
  };

  // 出発信号機 — one per track per direction, past the end of the platform.
  //
  // A signal's face looks back at the train that reads it, so it points the
  // OPPOSITE way to that train's travel; and it stands to that train's left,
  // which for a platform track means the mast behind the platform and the
  // head out over the rails on an arm — which is what
  // SRC_COMMONS_MIDORI_PLATFORM_2018 shows.
  for (const dir of [SATSURU, KAWAYU]) {
    for (const track of [1, 2]) {
      const trackOut = track === 1 ? 0 : TRACK_2_OFFSET_M;
      const mastOut = track === 1
        ? platformBack + 0.4
        : TRACK_2_OFFSET_M - PLATFORM_FACE_OFFSET_M - PLATFORM_WIDTH_M - 0.4;
      const headOut = track === 1
        ? trackOut + HEAD_OVER_TRACK_M
        : trackOut - HEAD_OVER_TRACK_M;
      const a = platformCentre + dir.sign * (platformHalf + DEPARTURE_BEYOND_PLATFORM_M);
      // `arm_length_m` is measured to the head's own LEFT, meaning left as
      // the lamps look — which is the reverse of the departing train's left,
      // because the two face opposite ways.
      const armLeft = (headOut - mastOut) * dir.sign;
      push(
        `STR_MIDORI_SIGNAL_DEP_${track}_${dir.sign > 0 ? 'S' : 'K'}`,
        `緑駅 ${track}番線 出発信号機（${dir.name}方）`,
        at(a, mastOut),
        (dir.bearing + 180) % 360,
        armLeft,
        {
          signal_kind: 'departure',
          track_number: track,
          detail_confidence: {
            existence: 'B (official_record — 釧網本線は特殊自動閉塞式。省令解釈基準 第54条関係4 は'
              + '単線の特殊自動閉塞式について「進路が相対する出発信号機相互間を連鎖させる」と定める。'
              + '2018年の写真2点にも構内の色灯式信号機が写る)',
            position: 'C (inference — ホーム端から'
              + `${DEPARTURE_BEYOND_PLATFORM_M} m。緑駅の実際の建植位置は文献に当たれていない)`,
            appearance: 'C (省令解釈基準 第55条関係1(1)の図と備考による三位式色灯。'
              + '灯の直径100 mm・中心間隔200 mmは同備考の下限であって実測ではない。'
              + '背板正面の黒は同1(10)。背面の錆色は2018年の写真の実測)',
          },
          note: 'scripts/place-signals.mjs。現示は停止で固定。'
            + '2010-05-30当日の在線状況は分からないので、進路の設定されていない信号機が'
            + '示す現示を置いている。ワールド内の列車とは連動していない。',
        },
      );
    }
  }

  // 場内信号機 — outside the turnout at each end, beside the single track.
  for (const dir of [SATSURU, KAWAYU]) {
    const a = platformCentre + dir.sign * (LOOP_STRAIGHT_HALF_M + lead + HOME_BEYOND_TURNOUT_M);
    // A train arriving from this end travels the OTHER way, so the lamps
    // look back along dir.bearing and the signal stands on that train's
    // left: +out for one arriving from 札弦, −out for one from 川湯温泉.
    const side = dir.sign > 0 ? +HOME_SIDE_OFFSET_M : -HOME_SIDE_OFFSET_M;
    push(
      `STR_MIDORI_SIGNAL_HOME_${dir.sign > 0 ? 'S' : 'K'}`,
      `緑駅 場内信号機（${dir.name}方から進入する列車に対する）`,
      at(a, side),
      dir.bearing,
      0,
      {
        signal_kind: 'home',
        detail_confidence: {
          existence: 'B (official_record — 省令解釈基準 第117条関係1「場内信号機 停車場に進入する'
            + '列車に対し信号を現示するもの」。緑は交換設備を持つ停車場)',
          position: `C (inference — 分岐器の外方 ${HOME_BEYOND_TURNOUT_M} m。`
            + '分岐器の位置じたい 2番線の再構成に依る)',
          heads: 'C (inference — 第55条関係5 は進路ごとに場内信号機を設けるか進路表示機を'
            + '附属させることを求める。緑は各方向から2進路あるが、どちらであったかは'
            + '分からないので1機のみを置いている)',
        },
        note: 'scripts/place-signals.mjs。現示は停止で固定。'
          + '建植は進行方向左側という慣行によるが、これを述べた条文は手元にない。',
      },
    );
  }

  buildings.features.push(...features);
  writeJson(join(WORLD, 'reality/buildings.geojson'), buildings);

  console.log('=== 緑駅 常置信号機 ===');
  console.log(`track bearing   ${trackBearing.toFixed(1)}°  (札弦方)`);
  console.log(`platform        ${(platformCentre - platformHalf).toFixed(1)} .. ${(platformCentre + platformHalf).toFixed(1)} m`);
  console.log(`turnouts        ${(platformCentre - LOOP_STRAIGHT_HALF_M - lead).toFixed(1)} / ${(platformCentre + LOOP_STRAIGHT_HALF_M + lead).toFixed(1)} m`);
  for (const f of features) {
    console.log(`  ${f.properties.id.padEnd(30)} ${f.properties.name}`);
  }
  console.log(`${features.length} 機`);
}

main();
