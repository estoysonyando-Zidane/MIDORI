#!/usr/bin/env node
/**
 * Names the town from 国土地理院's 注記.
 *
 * The World had three POI. The town around them was 175 anonymous boxes,
 * so there was nothing to walk toward and nothing to recognise. 電子国土
 * 基本図 carries 注記 (ftCode 100) — the names printed on the map — and
 * they were already sitting in scripts/data/gsi_midori.json, unused.
 *
 * A 注記 point is where the TEXT is placed, not where the building is:
 * the label for 緑駅 sits 42 m north and 26 m west of the station's own
 * surveyed coordinate. So each name is snapped to the nearest imported
 * building footprint; only if there is none within reach does the label's
 * own point stand, and then the POI says so.
 *
 * Run: node scripts/import-gsi-labels.mjs
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const WORLD = join(ROOT, 'public/data/worlds/JP_HOKKAIDO_KIYOSATO_MIDORI_20100530');
const GSI = join(ROOT, 'scripts/data/gsi_midori.json');

/** 注記分類コード (annoCtg) → what kind of thing the name belongs to.
 *  Only names of PLACES ON THE GROUND are taken. The administrative and
 *  natural-feature names (110 市町村, 210/800 町丁字, 322 河川, 421 鉄道路線,
 *  422 駅) name areas and lines, not buildings, and 緑駅 is already in the
 *  World with a surveyed coordinate. */
const FACILITY_CATEGORIES = {
  531: { kind: 'ski_area', snap: false },
  883: { kind: 'police_box', snap: true },
  887: { kind: 'post_office', snap: true },
};

/** How far a name may be moved onto a footprint. 注記 are placed clear of
 *  the symbol they belong to, so a few tens of metres is normal; beyond
 *  that the nearest building is probably somebody else's. */
const SNAP_RADIUS_M = 60;

function readJson(p) { return JSON.parse(readFileSync(p, 'utf8')); }
function writeJson(p, v) { writeFileSync(p, `${JSON.stringify(v, null, 2)}\n`); }

function metresPerDegree(lat) {
  return { lat: 111132.0, lon: 111320.0 * Math.cos((lat * Math.PI) / 180) };
}

function centroid(ring) {
  let x = 0; let y = 0;
  for (const [lon, lat] of ring) { x += lon; y += lat; }
  return [x / ring.length, y / ring.length];
}

function main() {
  const gsi = readJson(GSI);
  const buildings = readJson(join(WORLD, 'reality/buildings.geojson'));
  const poi = readJson(join(WORLD, 'reality/poi.geojson'));

  const labels = gsi.features.filter((f) => f.layer === 'label' && FACILITY_CATEGORIES[f.tags.annoCtg]);
  // re-runnable: drop what a previous run added
  poi.features = poi.features.filter((f) => !String(f.properties.id).startsWith('LOC_GSI_'));
  for (const b of buildings.features) {
    if (b.properties.gsi_label_applied) {
      delete b.properties.name;
      delete b.properties.gsi_label_applied;
    }
  }

  const report = [];
  for (const label of labels) {
    const [lon, lat] = label.rings[0][0];
    const rule = FACILITY_CATEGORIES[label.tags.annoCtg];
    const m = metresPerDegree(lat);

    let best = null;
    let bestDistance = Infinity;
    if (rule.snap) {
      for (const feature of buildings.features) {
        if (!String(feature.properties.id).startsWith('BLDG_GSI_')) continue;
        if (feature.geometry.type !== 'Polygon') continue;
        const [clon, clat] = centroid(feature.geometry.coordinates[0]);
        const d = Math.hypot((clon - lon) * m.lon, (clat - lat) * m.lat);
        if (d < bestDistance) { bestDistance = d; best = feature; }
      }
    }
    const snapped = best !== null && bestDistance <= SNAP_RADIUS_M;

    let coordinates = [lon, lat];
    if (snapped) {
      // 国土地理院's own placement of the name wins over an earlier
      // identification that matched an OSM/Wikipedia name to whatever
      // outline happened to be nearest. That older method put 緑の湯 on a
      // building 22 m from the real one, and left 緑郵便局 and
      // 斜里警察署緑駐在所 each claimed by two outlines 33 m apart. Clearing
      // the other claim here is what stops this import from creating the
      // duplicate rather than merely not being the cause of it.
      for (const other of buildings.features) {
        if (other === best) continue;
        if (other.properties.name !== label.tags.knj) continue;
        other.properties.name = null;
        other.properties.structure_type = 'town_building';
        other.properties.detail_confidence = {
          ...other.properties.detail_confidence,
          identification: `U (unknown — 以前この外形を「${label.tags.knj}」としていたが、`
            + '国土地理院の注記はより近い別の外形を指している。実測された建築物であることは確かで、用途は不明)',
        };
        other.properties.note = `${other.properties.note ?? ''} `
          + `scripts/import-gsi-labels.mjs: 「${label.tags.knj}」の同定をこの外形から外した。`;
        report.push(`${label.tags.knj.padEnd(12)} 旧同定 ${other.properties.id} を用途不明に戻した`);
      }
      coordinates = centroid(best.geometry.coordinates[0]);
      best.properties.name = label.tags.knj;
      best.properties.gsi_label_applied = true;
      if (!best.properties.source_ids.includes('SRC_GSI_BVMAP')) {
        best.properties.source_ids.push('SRC_GSI_BVMAP');
      }
    }

    poi.features.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates },
      properties: {
        id: `LOC_GSI_${rule.kind.toUpperCase()}`,
        name: label.tags.knj,
        name_kana: label.tags.kana ?? undefined,
        facility_kind: rule.kind,
        confidence: 'B',
        historical_status: 'plausible',
        position_status: snapped ? 'located' : 'approximate',
        position_accuracy_m: snapped ? undefined : 80,
        source_ids: ['SRC_GSI_BVMAP'],
        evidence_type: 'public_gis',
        note: snapped
          ? `国土地理院 電子国土基本図の注記（分類コード ${label.tags.annoCtg}）。注記点は文字の配置位置なので、`
            + `${bestDistance.toFixed(0)} m 離れた最寄りの建築物フットプリントの重心に寄せた。`
            + '注記が指す建物がこの建物であることは注記点の近さから推定したもので、地理院が両者を結び付けているわけではない。'
          : `国土地理院 電子国土基本図の注記（分類コード ${label.tags.annoCtg}）。文字の配置位置そのもので、`
            + '施設の位置ではない。範囲を持つ地物なので建物には寄せていない。'
            + '2010-05-30 当時の営業状況は確認していない。',
      },
    });
    report.push(`${label.tags.knj.padEnd(12)} ${snapped ? `snapped ${bestDistance.toFixed(0)} m to ${best.properties.id}` : 'label point kept (approximate)'}`);
  }

  writeJson(join(WORLD, 'reality/poi.geojson'), poi);
  writeJson(join(WORLD, 'reality/buildings.geojson'), buildings);

  console.log('=== 注記の取り込み ===');
  for (const line of report) console.log(' ', line);
  console.log(`POI ${poi.features.length} 件`);
}

main();
