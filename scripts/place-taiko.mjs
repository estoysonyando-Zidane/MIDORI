#!/usr/bin/env node
/**
 * クマゲラ太鼓 — the drums, in front of the stage on the station forecourt.
 *
 * The operator, who was there: 「舞台があるだろ？あそこの前でクマゲラ太鼓も
 * 演奏したんよ」. That is the whole of the evidence and it is worth being
 * plain about what it does and does not settle.
 *
 * What it settles: that a taiko group called クマゲラ太鼓 played in front of
 * this stage at みどりのフェスティバル. The World's target date, 2010-05-30,
 * is the last Sunday of May 2010, which is when きよさと観光協会 says the
 * festival is held (SRC_KIYOSATO_KANKOU_EVENTS), so drums standing on the
 * forecourt is what that day looked like rather than an ornament.
 *
 * The drums themselves are no longer a guess. A photograph of the group
 * playing (SRC_KUMAGERA_PHOTO) shows what they are, and it is not what was
 * modelled first: not 長胴太鼓 with hide tacked over both ends, but hollowed
 * logs lying on their sides, open to the audience so you look into the bore,
 * on vermilion X-stands with a white 「クマゲラ太鼓」 banner down the front of
 * each. Six of them in a row, on mown grass.
 *
 * What the photograph still does not settle: how far in front of the stage
 * the row stood, how far apart, and whether the row ran past the edge of the
 * frame. Those remain the guess.
 *
 * The photograph shows children playing them. No person is modelled here or
 * anywhere in this World, and the image is not copied into this repository.
 *
 * Run: node scripts/place-taiko.mjs
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const WORLD = join(ROOT, 'public/data/worlds/JP_HOKKAIDO_KIYOSATO_MIDORI_20100530');

/** The shell, read off SRC_KUMAGERA_PHOTO: a hollowed log about 0.9 m long
 *  with a bore around 0.5 m and a thick wall, open to the audience. */
const BORE_DIAMETER_M = 0.50;
const SHELL_LENGTH_M = 0.92;
/** Six is what the photograph shows in frame; the row may have run further
 *  than the picture does. */
const COUNT = 6;
const SPACING_M = 1.7;
/** How far out from the stage's front edge the row stands. */
const STANDOFF_M = 3.2;

function readJson(p) { return JSON.parse(readFileSync(p, 'utf8')); }
function writeJson(p, v) { writeFileSync(p, `${JSON.stringify(v, null, 2)}\n`); }

function main() {
  const buildings = readJson(join(WORLD, 'reality/buildings.geojson'));
  buildings.features = buildings.features.filter((f) => !String(f.properties.id).startsWith('STR_MIDORI_TAIKO_'));

  const stage = buildings.features.find((f) => f.properties.id === 'STR_MIDORI_STAGE');
  if (!stage) throw new Error('STR_MIDORI_STAGE not found');

  const ring = stage.geometry.coordinates[0].slice(0, -1);
  const lat = ring.reduce((a, c) => a + c[1], 0) / ring.length;
  const lon = ring.reduce((a, c) => a + c[0], 0) / ring.length;
  const mLat = 111132.0;
  const mLon = 111320.0 * Math.cos((lat * Math.PI) / 180);

  // The way the stage faces, and the line across its front.
  const facing = (stage.properties.facing_bearing_deg * Math.PI) / 180;
  const front = { east: Math.sin(facing), north: Math.cos(facing) };
  const across = { east: front.north, north: -front.east };

  // How far the stage itself reaches toward its front, so the row stands
  // clear of the deck rather than inside it.
  let reach = 0;
  for (const [clon, clat] of ring) {
    const e = (clon - lon) * mLon;
    const n = (clat - lat) * mLat;
    reach = Math.max(reach, e * front.east + n * front.north);
  }

  const added = [];
  for (let i = 0; i < COUNT; i++) {
    const across0 = (i - (COUNT - 1) / 2) * SPACING_M;
    const forward = reach + STANDOFF_M;
    const e = front.east * forward + across.east * across0;
    const n = front.north * forward + across.north * across0;
    const id = `STR_MIDORI_TAIKO_${i + 1}`;
    added.push(id);
    buildings.features.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [lon + e / mLon, lat + n / mLat] },
      properties: {
        id,
        name: 'クマゲラ太鼓 くり抜き胴の太鼓',
        structure_type: 'taiko',
        bore_diameter_m: BORE_DIAMETER_M,
        shell_length_m: SHELL_LENGTH_M,
        facing_bearing_deg: stage.properties.facing_bearing_deg,
        confidence: 'C',
        evidence_type: 'user_survey',
        historical_status: 'plausible',
        position_status: 'approximate',
        position_accuracy_m: 6,
        source_ids: ['SRC_USER_TESTIMONY_2026', 'SRC_KIYOSATO_KANKOU_EVENTS', 'SRC_KUMAGERA_PHOTO'],
        detail_confidence: {
          played_here: 'C (user_survey — 「舞台の前でクマゲラ太鼓も演奏した」当事者証言。'
            + '2010-05-30は5月最終日曜日で、きよさと観光協会のいう みどりのフェスティバル の日にあたる)',
          count_and_arrangement: 'B (contemporary_photo — 演奏中の写真に横一列で6台前後が写る。'
            + '列が写真の外まで続いていた可能性はある。舞台からの距離と間隔は写真からは測れない)',
          appearance: 'B (contemporary_photo — 刳り抜いた丸太の胴を横に寝かせ、'
            + '客側は胴の内側が見える開口、皮は反対側。朱塗りのX字台、台の正面に「クマゲラ太鼓」の白い幟。'
            + '寸法は写真からの目測)',
        },
        note: 'scripts/place-taiko.mjs。舞台の正面 '
          + `${STANDOFF_M} m 前、${SPACING_M} m 間隔で ${COUNT} 台。`
          + '位置の根拠は舞台（国土地理院の実測外形）とその向き。'
          + '太鼓と台と幟の形は演奏中の写真(SRC_KUMAGERA_PHOTO)から。'
          + '舞台からの距離と間隔は写真からは測れないので推定のまま。',
      },
    });
  }

  writeJson(join(WORLD, 'reality/buildings.geojson'), buildings);
  console.log(`クマゲラ太鼓: ${added.length} 台を舞台前 ${STANDOFF_M} m に配置 (${added.join(', ')})`);
}

main();
