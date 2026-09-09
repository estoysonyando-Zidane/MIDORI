#!/usr/bin/env node
/**
 * キハ40 826 standing on 2番線.
 *
 * The operator asked for it: 「キハ40は緑駅が二車線だから奥側に一旦設置」.
 * 「一旦」 is the right word and this file keeps it. What is being placed is
 * a vehicle the World has good evidence FOR — SRC_PHOTO_20090520 is a
 * photograph of キハ40 826 standing at this platform on 2009-05-20, with the
 * station's own mural and 駅名標 in the same frame — put somewhere the World
 * has no evidence for it standing.
 *
 * Against it: Wikipedia's current entry says 「夜間滞泊は設定されておらず、
 * 当駅発着列車は知床斜里に留置され、運用の前後に当駅との間で回送される」.
 * That is a statement about today's working, not 2010's, but it is the only
 * statement there is, and it points away from a car being left at 緑. So the
 * placement is recorded as what it is: a request, on a plausible track, with
 * the evidence that argues against it written into the feature.
 *
 * Which track: 2番線, the far side, as asked. That is the side a car can be
 * stood on without blocking the line, which is what a 交換設備 is for.
 *
 * Run: node scripts/place-stabled-railcar.mjs
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const WORLD = join(ROOT, 'public/data/worlds/JP_HOKKAIDO_KIYOSATO_MIDORI_20100530');
const INDEX = join(ROOT, 'public/data/spatial_index/JP.01.546.MIDORI/index.json');

/* Kept in step with scripts/rebuild-station-yard.mjs. */
const PLATFORM_LONG_LEG_M = 116;
const PLATFORM_SHORT_LEG_M = 4;
const TRACK_2_OFFSET_M = -4.1;
/** 全長 21,300 mm — 国鉄キハ40系気動車(2代) の主要寸法. */
const CAR_LENGTH_M = 21.30;

const DEG = Math.PI / 180;
const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));
const writeJson = (p, v) => writeFileSync(p, `${JSON.stringify(v, null, 2)}\n`);

function main() {
  const index = readJson(INDEX);
  const buildings = readJson(join(WORLD, 'reality/buildings.geojson'));
  const railway = readJson(join(WORLD, 'reality/railway.geojson'));

  buildings.features = buildings.features
    .filter((f) => f.properties.id !== 'STR_MIDORI_STABLED_KIHA40');

  const station = index.entities.find((e) => e.id === 'JP.01.546.MIDORI/STATION');
  const [anchorLon, anchorLat] = station.geometry.coordinates;
  const mLat = 111132.0;
  const mLon = 111320.0 * Math.cos(anchorLat * DEG);

  const chain = railway.features
    .find((f) => f.properties.id === 'RAIL_SENMO_KSJ_001').geometry.coordinates;
  const dE = (chain[1][0] - chain[0][0]) * mLon;
  const dN = (chain[1][1] - chain[0][1]) * mLat;
  const len = Math.hypot(dE, dN);
  const along = { east: dE / len, north: dN / len };
  const out = { east: along.north, north: -along.east };
  const trackBearing = ((Math.atan2(along.east, along.north) / DEG) + 360) % 360;

  const buildingEntity = index.entities.find((e) => e.id === 'JP.01.546.MIDORI/STATION_BUILDING');
  const bE = (buildingEntity.geometry.coordinates[0] - anchorLon) * mLon;
  const bN = (buildingEntity.geometry.coordinates[1] - anchorLat) * mLat;
  const stationAlong = bE * along.east + bN * along.north;
  const platformCentre = stationAlong + (PLATFORM_SHORT_LEG_M - PLATFORM_LONG_LEG_M) / 2;

  const a = platformCentre;
  const coordinates = [
    anchorLon + (along.east * a + out.east * TRACK_2_OFFSET_M) / mLon,
    anchorLat + (along.north * a + out.north * TRACK_2_OFFSET_M) / mLat,
  ];

  buildings.features.push({
    type: 'Feature',
    geometry: { type: 'Point', coordinates },
    properties: {
      id: 'STR_MIDORI_STABLED_KIHA40',
      name: '緑駅 2番線に留置されたキハ40 826',
      structure_type: 'railcar',
      model: 'kiha40',
      car_length_m: CAR_LENGTH_M,
      facing_bearing_deg: Number(trackBearing.toFixed(1)),
      confidence: 'C',
      evidence_type: 'inference',
      historical_status: 'plausible',
      position_status: 'approximate',
      position_accuracy_m: 60,
      source_ids: ['SRC_USER_DIRECTIVE_02', 'SRC_PHOTO_20090520', 'SRC_WIKI_JA_MIDORI'],
      detail_confidence: {
        vehicle: 'B (contemporary_photo — SRC_PHOTO_20090520 は 2009-05-20 に緑駅の'
          + 'ホームに停まるキハ40 826 を写した写真。駅の壁画と駅名標が同じ画面に入っている。'
          + 'この形式のこの塗色の車がこの駅に来ていたことは、写真で分かる)',
        standing_here: 'U (依頼者の指示による配置。Wikipedia「緑駅」は'
          + '「夜間滞泊は設定されておらず、当駅発着列車は知床斜里に留置され」と書いており、'
          + 'これは現在の運用についての記述だが、緑に車を置くことに対しては反証の側に立つ。'
          + '2010-05-30 に留置車があったという根拠はない)',
        which_track: 'C (inference — 2番線は本線を塞がずに車を置ける側で、交換設備とはそのためのもの。'
          + '依頼者の指定でもある)',
      },
      note: 'scripts/place-stabled-railcar.mjs。ホーム中央、2番線の線路中心上に'
        + `車体長 ${CAR_LENGTH_M} m の1両を置く。これは「一旦設置」であって、`
        + '2010-05-30 当日に留置車があったという主張ではない。',
    },
  });

  writeJson(join(WORLD, 'reality/buildings.geojson'), buildings);
  console.log('=== 2番線 留置車 ===');
  console.log(`track bearing   ${trackBearing.toFixed(1)}°`);
  console.log(`along           ${platformCentre.toFixed(1)} m  out ${TRACK_2_OFFSET_M} m`);
  console.log(`coordinates     ${coordinates[1].toFixed(6)}, ${coordinates[0].toFixed(6)}`);
}

main();
