#!/usr/bin/env node
/**
 * The places 緑 looks out at, recorded but not built.
 *
 * The operator's list named さくらの滝, 神の子池, 摩周湖の展望台 and 緑ダム.
 * さくらの滝 turned out to be 2.07 km from the station and is in the World
 * (scripts/import-rivers.mjs, LOC_SAKURA_NO_TAKI). These three are not: 8.8,
 * 13.7 and 11.3 km out, all inside the far terrain's 35 km but far outside
 * the 2.5 km the World is built at.
 *
 * WHAT IS AND IS NOT DONE HERE. Their positions are surveyed and are written
 * down, because a coordinate is cheap to be right about and expensive to
 * recover later. NOTHING IS DRAWN. At 243 m a cell the far terrain cannot
 * hold a spring, a waterfall or a viewing platform — 神の子池 is 220 m
 * across at its widest and would be a single cell — and a floating label
 * over a photographed landscape is a diagram element, not a place. The land
 * they stand on is already drawn; where exactly they are on it is data.
 *
 * WHICH 摩周湖の展望台. 清里町's own article lists 裏摩周展望台（摩周湖東部）
 * among the town's sights; 摩周湖第一展望台 is on the 弟子屈 side and is not
 * 清里's. 裏摩周 is the one a 緑町 resident means, and it is the one 国土地理
 * 院's place-name index has. Both readings are recorded on the feature.
 *
 * Run: node scripts/place-distant-landmarks.mjs
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const WORLD = join(ROOT, 'public/data/worlds/JP_HOKKAIDO_KIYOSATO_MIDORI_20100530');

/** 緑駅 — JP.01.546.MIDORI/STATION. */
const ORIGIN = { lat: 43.718020, lon: 144.505750 };
/** How far the far terrain reaches (scripts/fetch-far-terrain.mjs). */
const FAR_TERRAIN_REACH_M = 35000;

const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));
const writeJson = (p, v) => writeFileSync(p, `${JSON.stringify(v, null, 2)}\n`);

const LANDMARKS = [
  {
    id: 'LOC_KAMINOKOIKE',
    name: '神の子池',
    name_en: 'Kaminoko-ike',
    poi_type: 'spring',
    lat: 43.645211,
    lon: 144.550175,
    source_ids: ['SRC_GSI_PLACE_SEARCH', 'SRC_WIKI_JA_KIYOSATO'],
    position: 'B (public_gis — 国土地理院の地名検索が返す点。'
      + 'Wikipedia「神の子池」の座標 43°38′43″N 144°33′01″E とは 10 m 以内で一致する)',
    note: '摩周湖の伏流水が湧く池。清里町の記事が町の観光地として挙げる。'
      + '造形はしていない — 遠景地形は1セル 243 m で、この池はその1つ分ほどしかない。',
  },
  {
    id: 'LOC_URA_MASHU_LOOKOUT',
    name: '裏摩周展望台',
    name_en: 'Ura-Mashu Lookout',
    poi_type: 'viewpoint',
    lat: 43.603820,
    lon: 144.570948,
    source_ids: ['SRC_GSI_PLACE_SEARCH', 'SRC_WIKI_JA_KIYOSATO'],
    position: 'B (public_gis — 国土地理院の地名検索が名前つきで返す点)',
    note: '摩周湖東部、清里町側の展望台。清里町の記事が町の観光地として挙げるのはこちらで、'
      + '摩周湖第一展望台（43.4979, 144.4533 付近）は弟子屈町側。'
      + '依頼の「摩周湖展望台」がどちらを指すかは確認できていないので、'
      + '清里町の側であるこちらを置いた。造形はしていない。',
  },
  {
    id: 'LOC_MIDORI_DAM',
    name: '緑ダム',
    name_en: 'Midori Dam',
    poi_type: 'dam',
    lat: 43.670278,
    lon: 144.629167,
    source_ids: ['SRC_WIKI_JA_MIDORIDAM'],
    position: 'C (encyclopedia — Wikipedia「緑ダム」の緯度経度 43°40′13″N 144°37′45″E。'
      + '国土地理院の地名検索には無く、独立した裏づけは取れていない)',
    note: '斜里川水系アタクチャ川のロックフィルダム。堤高 73 m・堤頂長 345 m・'
      + '総貯水容量 710万 m³、灌漑用、事業主体は網走市。'
      + '着工 1974年・竣工 2003年なので、2010-05-30 には在る。'
      + '造形はしていない。遠景地形の1セルは 243 m で、堤頂長 345 m はその 1.4 個分。'
      + '堤体の形を 243 m 標本の上に作るのは、地形が持っていない情報を足すことになる。',
  },
];

function main() {
  const poi = readJson(join(WORLD, 'reality/poi.geojson'));
  const ids = new Set(LANDMARKS.map((l) => l.id));
  poi.features = poi.features.filter((f) => !ids.has(f.properties.id));

  const mLat = 111132.0;
  const mLon = 111320.0 * Math.cos((ORIGIN.lat * Math.PI) / 180);

  for (const l of LANDMARKS) {
    const east = (l.lon - ORIGIN.lon) * mLon;
    const north = (l.lat - ORIGIN.lat) * mLat;
    const distance = Math.hypot(east, north);
    const bearing = ((Math.atan2(east, north) * 180) / Math.PI + 360) % 360;
    poi.features.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [l.lon, l.lat] },
      properties: {
        id: l.id,
        name: l.name,
        name_en: l.name_en,
        poi_type: l.poi_type,
        confidence: l.source_ids.includes('SRC_GSI_PLACE_SEARCH') ? 'B' : 'C',
        evidence_type: l.source_ids.includes('SRC_GSI_PLACE_SEARCH') ? 'public_gis' : 'encyclopedia',
        historical_status: 'confirmed',
        position_status: 'located',
        // The World is built at 2.5 km. These are recorded, not built, and
        // the flag is what tells a generator to leave them alone.
        outside_world: true,
        distance_from_origin_m: Math.round(distance),
        bearing_from_origin_deg: Number(bearing.toFixed(1)),
        within_far_terrain: distance < FAR_TERRAIN_REACH_M,
        source_ids: l.source_ids,
        detail_confidence: {
          position: l.position,
          rendering: 'U (造形なし。遠景地形は1セル 243 m で、これらはその1〜2個分の大きさしかない。'
            + '写真を貼った風景の上に浮く名札は、場所ではなく図の要素になる)',
        },
        note: `scripts/place-distant-landmarks.mjs。緑駅から ${Math.round(distance)} m・`
          + `方位 ${bearing.toFixed(0)}°。World は半径 2.5 km で作っており、これはその外。`
          + `遠景地形（半径 35 km）の範囲内には入る。${l.note}`,
      },
    });
  }

  writeJson(join(WORLD, 'reality/poi.geojson'), poi);
  console.log('=== World の外の目印 ===');
  for (const l of LANDMARKS) {
    const f = poi.features.find((x) => x.properties.id === l.id);
    const p = f.properties;
    console.log(`  ${p.name.padEnd(8)} ${String(p.distance_from_origin_m).padStart(6)} m  `
      + `方位 ${String(p.bearing_from_origin_deg).padStart(5)}°  ${p.confidence}/${p.evidence_type}`);
  }
  console.log('  いずれも造形はしていない。座標だけを記録した。');
}

main();
