#!/usr/bin/env node
/**
 * Replaces the town with 国土地理院's own survey of it.
 *
 * The first import of 緑町 came from OpenStreetMap. That was wrong on the
 * one point that matters here: OSM is not a primary source. The extract's
 * own tags read `source=Bing` — someone traced Microsoft's aerial imagery —
 * and the import trusted the tracing without ever opening an image.
 *
 * This reads 地理院地図Vector instead: 国土地理院's 電子国土基本図, surveyed at
 * 1/25,000, fetched by scripts/fetch-gsi-basemap.mjs into a committed
 * extract. It brings its own attributes rather than a guess at them —
 * `ftCode` separates ordinary buildings (3101) from 堅ろう建物 (3111), and
 * `rnkWidth` on each road says how wide it is.
 *
 * 出典: 国土地理院「地理院地図Vector（地理院タイル）」
 *
 * WHAT IS STILL NOT MEASURED
 * --------------------------
 * The national base map is a plan. It carries no building height, no roof
 * shape and no colour, so those remain what they were: banded from footprint
 * area, and hashed from photograph 003's palette. They stay at confidence C
 * in each feature's detail_confidence. What changes is that the plan
 * underneath them is now the surveyor's rather than a volunteer's tracing.
 *
 * Names are the one thing GSI does not give for most of these. Its 注記
 * layer names only 緑駅, 緑郵便局, 斜里警察署緑駐在所 and 緑スキー場 here, so the
 * remaining identifications — 緑の湯, 緑町小学校, 緑センター, 消防庁舎 — are
 * carried over from OSM and Wikipedia and attached to the nearest GSI
 * footprint. That match is recorded as an inference, not as survey.
 *
 * Run:  node scripts/import-gsi-town.mjs
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const WORLD = join(ROOT, 'public/data/worlds/JP_HOKKAIDO_KIYOSATO_MIDORI_20100530');
const INDEX = join(ROOT, 'public/data/spatial_index/JP.01.546.MIDORI/index.json');
const GSI = join(ROOT, 'scripts/data/gsi_midori.json');
const OSM = join(ROOT, 'scripts/data/osm_midori.json');

const IMPORT_RADIUS_M = 800;

/** GSI feature codes used here. */
const FT_BUILDING = 3101;        // 建築物
const FT_BUILDING_SOLID = 3111;  // 堅ろう建物 (RC/steel — flat roofed, taller)
const FT_ROAD_CENTRE = 2701;     // 道路構成線
const FT_GARDEN_PATH = 2703;     // 庭園路等
const FT_FOOTPATH = 2203;        // 徒歩道

/**
 * 幅員ランク (rnkWidth) -> carriageway width. The ranks are bands, so these
 * are the middle of each band rather than a measurement of any one road.
 */
const WIDTH_BY_RANK = { 0: 3.0, 1: 2.6, 2: 4.2, 3: 8.0, 4: 15.0, 5: 20.0 };

/** Height bands, unchanged from the OSM import: GSI carries no height either. */
const HEIGHT_BANDS = [
  { maxAreaM2: 30, eave: 2.2, ridge: 3.1 },
  { maxAreaM2: 70, eave: 2.6, ridge: 4.0 },
  { maxAreaM2: 160, eave: 3.0, ridge: 5.0 },
  { maxAreaM2: 400, eave: 3.6, ridge: 6.0 },
  { maxAreaM2: Infinity, eave: 4.4, ridge: 7.2 },
];

const ROOF_PALETTE = ['#8c3a32', '#2f5a7a', '#2f6146', '#6b6f74', '#8a6a3a'];

/**
 * Identifications GSI does not carry, matched onto its footprints by
 * proximity. The coordinate is where OSM or GSI's own 注記 puts the thing;
 * the footprint it lands on is GSI's.
 */
const NAMED = [
  { name: '緑の湯', id: 'STR_MIDORI_ONSEN', type: 'bathhouse', eave: 3.4, ridge: 5.6, roof: '#8c3a32', from: 'osm' },
  { name: '緑町小学校', id: 'STR_MIDORI_SCHOOL', type: 'school', eave: 6.4, ridge: 8.6, roof: '#2f5a7a', from: 'osm' },
  { name: '緑郵便局', id: 'STR_MIDORI_POST_OFFICE', type: 'post_office', eave: 3.2, ridge: 4.6, roof: '#6b6f74', from: 'gsi_anno' },
  { name: '緑センター', id: 'STR_MIDORI_CENTRE', type: 'community_centre', eave: 3.8, ridge: 5.8, roof: '#2f6146', from: 'osm' },
  { name: '斜里警察署緑駐在所', id: 'STR_MIDORI_POLICE_BOX', type: 'police_box', eave: 2.9, ridge: 4.3, roof: '#6b6f74', from: 'gsi_anno' },
  { name: '第3分団消防庁舎', id: 'STR_MIDORI_FIRE_STATION', type: 'fire_station', eave: 4.2, ridge: 6.0, roof: '#8c3a32', from: 'osm' },
];

/**
 * Footprints in the extract that are not buildings on the ground.
 *
 * 電子国土基本図 is a survey, but the vector tiles it is served through are
 * not free of artefacts. This one is a polygon 23 m from the track in front
 * of the station whose outline is congruent to the stage in 緑駅前広場, 74 m
 * away — the same five edges to a tenth of a millimetre, which two real
 * buildings do not share. The operator, standing in the World, reports there
 * is no building there. Dropped, with both reasons recorded rather than
 * silently filtered.
 *
 * Positions are local metres from the station point.
 */
const EXCLUDED = [
  {
    east: 11.4,
    north: 24.3,
    tolerance: 4,
    why: '駅前に実在しない建物。国土地理院のベクトルタイル上で、74 m離れた駅前広場の舞台と'
      + '完全に合同な外形（5辺が0.1 mm単位で一致）として現れており、データ由来の重複と判断した。'
      + '現地を知る当事者も「駅の前に建物はない」と証言している。',
  },
];

const DEG = Math.PI / 180;

function readJson(path) { return JSON.parse(readFileSync(path, 'utf8')); }
function writeJson(path, value) { writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`); }

function hash32(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

function main() {
  const gsi = readJson(GSI);
  const osm = readJson(OSM);
  const [centreLon, centreLat] = gsi.centre;
  const scale = { east: Math.cos(centreLat * DEG) * 111320.0, north: 110574.0 };
  const metres = ([lon, lat]) => [(lon - centreLon) * scale.east, (lat - centreLat) * scale.north];

  const buildings = readJson(join(WORLD, 'reality/buildings.geojson'));
  const roads = readJson(join(WORLD, 'reality/roads.geojson'));
  const index = readJson(INDEX);

  // ---- where the named things are, before anything is rebuilt -----------
  const anchors = [];
  for (const named of NAMED) {
    let at = null;
    if (named.from === 'gsi_anno') {
      const label = gsi.features.find((f) => f.layer === 'label' && f.tags.knj === named.name);
      if (label) at = label.rings[0][0];
    }
    if (!at) {
      const way = osm.elements.find((e) => e.type === 'way' && e.tags?.name === named.name)
        ?? (named.name === '緑町小学校'
          ? osm.elements.find((e) => e.type === 'way' && e.tags?.building === 'school')
          : undefined);
      if (way) {
        const pts = way.geometry.map(metres);
        at = [
          pts.reduce((a, p) => a + p[0], 0) / pts.length / scale.east + centreLon,
          pts.reduce((a, p) => a + p[1], 0) / pts.length / scale.north + centreLat,
        ];
      }
    }
    if (at) anchors.push({ ...named, at: metres(at) });
  }

  // ---- clear the previous import ---------------------------------------
  buildings.features = buildings.features.filter(
    (f) => !f.properties.id.startsWith('BLDG_OSM_')
      && !f.properties.id.startsWith('BLDG_GSI_')
      && !NAMED.some((n) => n.id === f.properties.id),
  );
  roads.features = roads.features.filter((f) => !f.properties.id.startsWith('ROAD_GSI_'));

  // ---- buildings --------------------------------------------------------
  let imported = 0;
  let clipped = 0;
  const dropped = [];
  const claimed = new Set();

  for (const feature of gsi.features) {
    if (feature.layer !== 'building') continue;
    if (feature.tags.ftCode !== FT_BUILDING && feature.tags.ftCode !== FT_BUILDING_SOLID) continue;
    // The layer carries each building twice: once as an area and once as the
    // line of its outline. Only the area is a building.
    if (feature.type !== 3) continue;
    const ring = feature.rings[0];
    if (!ring || ring.length < 4) continue;

    const closed = ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1]
      ? ring : [...ring, ring[0]];
    const local = closed.map(metres);
    const n = local.length - 1;
    const centre = [
      local.slice(0, n).reduce((a, p) => a + p[0], 0) / n,
      local.slice(0, n).reduce((a, p) => a + p[1], 0) / n,
    ];
    if (Math.hypot(centre[0], centre[1]) > IMPORT_RADIUS_M) continue;
    const excluded = EXCLUDED.find(
      (x) => Math.hypot(centre[0] - x.east, centre[1] - x.north) <= x.tolerance,
    );
    if (excluded) { dropped.push(excluded.why); continue; }

    let area = 0;
    for (let i = 0; i < n; i++) area += local[i][0] * local[i + 1][1] - local[i + 1][0] * local[i][1];
    area = Math.abs(area / 2);
    if (area < 6) continue;

    // nearest unclaimed identification, if one is close enough to be this one
    let named = null;
    let best = 30;
    for (const anchor of anchors) {
      if (claimed.has(anchor.id)) continue;
      const d = Math.hypot(anchor.at[0] - centre[0], anchor.at[1] - centre[1]);
      if (d < best) { best = d; named = anchor; }
    }
    if (named) claimed.add(named.id);

    const solid = feature.tags.ftCode === FT_BUILDING_SOLID;
    const band = HEIGHT_BANDS.find((b) => area <= b.maxAreaM2);
    const key = `${centre[0].toFixed(1)},${centre[1].toFixed(1)}`;
    if (feature.tile_clipped) clipped++;

    buildings.features.push({
      type: 'Feature',
      geometry: { type: 'Polygon', coordinates: [closed] },
      properties: {
        id: named?.id ?? `BLDG_GSI_${Math.abs(hash32(key)).toString(36)}`,
        name: named?.name ?? null,
        structure_type: named?.type ?? 'town_building',
        gsi_ft_code: feature.tags.ftCode,
        area_m2: Math.round(area),
        eave_height_m: named?.eave ?? (solid ? band.eave + 1.2 : band.eave),
        ridge_height_m: named?.ridge ?? (solid ? band.eave + 1.5 : band.ridge),
        roof_colour: named?.roof ?? ROOF_PALETTE[hash32(key) % ROOF_PALETTE.length],
        // 堅ろう建物 are concrete or steel framed and flat roofed; so is
        // anything whose plan is too articulated for one ridge to be honest.
        roof_shape: solid || n > 6 ? 'flat' : 'gable',
        confidence: 'B',
        evidence_type: 'public_gis',
        historical_status: 'plausible',
        source_ids: ['SRC_GSI_BVMAP'],
        ...(feature.tile_clipped ? { tile_clipped: true } : {}),
        detail_confidence: {
          footprint: `B (public_gis — 国土地理院 電子国土基本図 ftCode ${feature.tags.ftCode}, 1/25000)`,
          identification: named
            ? `C (inference — 名称は${named.from === 'gsi_anno' ? '地理院注記' : 'OSM/Wikipedia'}由来、最寄りのGSI外形に${best.toFixed(0)} mで対応付けたもの)`
            : 'U (unknown — GSIは用途名を持たない)',
          eave_ridge_height: 'C (inference — 面積から段階分け。GSIも高さを持たない)',
          roof_colour: 'C (inference — 写真003の色をIDのハッシュで割当)',
          roof_shape: 'C (inference)',
          ...(feature.tile_clipped ? { footprint_completeness: 'C — タイル境界で切れている可能性あり' } : {}),
        },
        note: 'scripts/import-gsi-town.mjs による取り込み。出典: 国土地理院「地理院地図Vector（地理院タイル）」。'
          + '外形は実測（電子国土基本図）だが、高さ・屋根形状・屋根色はGSIも持たないため推定。',
      },
    });
    imported++;
  }

  // ---- roads ------------------------------------------------------------
  let roadCount = 0;
  for (const feature of gsi.features) {
    if (feature.layer !== 'road') continue;
    const ft = feature.tags.ftCode;
    if (ft !== FT_ROAD_CENTRE && ft !== FT_GARDEN_PATH && ft !== FT_FOOTPATH) continue;
    for (const ring of feature.rings) {
      if (ring.length < 2) continue;
      const local = ring.map(metres);
      if (local.every((p) => Math.hypot(p[0], p[1]) > IMPORT_RADIUS_M)) continue;
      const rank = feature.tags.rnkWidth;
      const width = ft === FT_FOOTPATH ? 1.4
        : ft === FT_GARDEN_PATH ? 2.0
          : (WIDTH_BY_RANK[rank] ?? 3.0);
      const key = ring.map((p) => p.join(',')).join(';');
      roads.features.push({
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: ring },
        properties: {
          id: `ROAD_GSI_${Math.abs(hash32(key)).toString(36)}`,
          width_m: width,
          gsi_ft_code: ft,
          road_category_code: feature.tags.rdCtg ?? null,
          width_rank: rank ?? null,
          confidence: 'B',
          evidence_type: 'public_gis',
          historical_status: 'plausible',
          source_ids: ['SRC_GSI_BVMAP'],
          detail_confidence: {
            centreline: 'B (public_gis — 国土地理院 電子国土基本図)',
            width: `C (inference — 幅員ランク ${rank ?? '不明'} の帯の中央値。個々の道路の実測値ではない)`,
          },
          note: 'scripts/import-gsi-town.mjs。出典: 国土地理院「地理院地図Vector（地理院タイル）」。',
        },
      });
      roadCount++;
    }
  }

  // ---- 注記: what the surveyor actually names here -----------------------
  index.entities = index.entities.filter((e) => !e.id.startsWith('JP.01.546.MIDORI/TOWN_'));
  let labelled = 0;
  for (const anchor of anchors) {
    if (!claimed.has(anchor.id)) continue;
    const hit = buildings.features.find((f) => f.properties.id === anchor.id);
    if (!hit) continue;
    const ring = hit.geometry.coordinates[0];
    const n = ring.length - 1;
    index.entities.push({
      id: `JP.01.546.MIDORI/TOWN_${anchor.id.replace('STR_MIDORI_', '')}`,
      name: anchor.name,
      category: 'building',
      geometry_type: 'point',
      geometry: { type: 'Point', coordinates: [
        Number((ring.slice(0, n).reduce((a, p) => a + p[0], 0) / n).toFixed(8)),
        Number((ring.slice(0, n).reduce((a, p) => a + p[1], 0) / n).toFixed(8)),
      ] },
      confidence: 'B',
      evidence_type: 'public_gis',
      source_ids: ['SRC_GSI_BVMAP', ...(anchor.from === 'osm' ? ['SRC_OSM_OVERPASS'] : [])],
      frontier_status: 'defined',
      detail_ref: `reality/buildings.geojson#${anchor.id}`,
      note: `外形は国土地理院 電子国土基本図。名称は${anchor.from === 'gsi_anno' ? '地理院地図の注記' : 'OSM/Wikipedia'}由来で、`
        + '最寄りの外形に対応付けた推定であり、GSI自身がこの建物にこの名称を与えているわけではない。',
      position_status: 'located',
    });
    labelled++;
  }

  // Names GSI itself carries that are not buildings — 緑スキー場 among them,
  // which is the only large open venue the surveyor names in 緑町.
  for (const feature of gsi.features) {
    if (feature.layer !== 'label') continue;
    const name = feature.tags.knj;
    if (!name || ['緑駅', '緑町', '清里町', '釧網本線', '札弦川'].includes(name)) continue;
    if (NAMED.some((n) => n.name === name)) continue;
    const [lon, lat] = feature.rings[0][0];
    const slug = { '緑スキー場': 'SKI_GROUND' }[name] ?? `ANNO_${Math.abs(hash32(name)).toString(36)}`;
    index.entities.push({
      id: `JP.01.546.MIDORI/TOWN_${slug}`,
      name,
      category: 'facility',
      geometry_type: 'point',
      geometry: { type: 'Point', coordinates: [lon, lat] },
      confidence: 'B',
      evidence_type: 'public_gis',
      source_ids: ['SRC_GSI_BVMAP'],
      frontier_status: 'stub',
      detail_ref: null,
      note: '国土地理院 電子国土基本図の注記。位置は注記のアンカー点で、施設の範囲ではない。',
      position_status: 'approximate',
      position_accuracy_m: 60,
    });
    labelled++;
  }

  writeJson(join(WORLD, 'reality/buildings.geojson'), buildings);
  writeJson(join(WORLD, 'reality/roads.geojson'), roads);
  writeJson(INDEX, index);

  console.log('=== 緑町 rebuilt from 国土地理院 電子国土基本図 ===');
  console.log(`buildings      ${imported} (${clipped} cut by a tile edge, ${dropped.length} dropped as artefacts)`);
  console.log(`roads          ${roadCount} segments with surveyed width ranks`);
  console.log(`index entries  ${labelled}`);
  for (const named of NAMED) {
    console.log(`  ${claimed.has(named.id) ? '✓' : '·'} ${named.name}`);
  }
}

main();
