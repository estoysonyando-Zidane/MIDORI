#!/usr/bin/env node
/**
 * Imports 緑町 itself — the settlement around the station — from OSM.
 *
 * WHY
 * ---
 * The World had two synthetic building boxes standing in for a town, placed
 * to have something on the terrain. Wikipedia 緑駅 §駅周辺 says the settlement
 * spreads along 北海道道1115号摩周湖斜里線 and names 清里町役場緑町支所,
 * 斜里警察署緑駐在所, 緑郵便局 and 緑の湯; OpenStreetMap has all of that plus
 * roughly 300 building footprints, the 緑町小学校 grounds and the road names.
 *
 * Those footprints are survey-grade compared with anything else available
 * here, so the town comes in as `confidence: "B", evidence_type:
 * "public_gis"` — the same standing as the KSJ road and rail centrelines
 * already in the World.
 *
 * WHAT IS NOT EVIDENCE
 * --------------------
 * OSM gives outlines, not buildings. It carries no height for any of these
 * (one `building:levels` tag in three hundred), no roof shape and no colour.
 * Heights are therefore banded from footprint area, and roof colour is
 * assigned by a deterministic hash from the palette in photograph 003 —
 * the red, blue and green tin roofs along the main street. Both are
 * scenery: they are recorded at `confidence: "C"` in `detail_confidence`
 * so nothing downstream can mistake them for measurements.
 *
 * The extract is committed at scripts/data/osm_midori.json so this is
 * reproducible without network access.
 *
 * Run:  node scripts/import-osm-town.mjs
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const WORLD = join(ROOT, 'public/data/worlds/JP_HOKKAIDO_KIYOSATO_MIDORI_20100530');
const INDEX = join(ROOT, 'public/data/spatial_index/JP.01.546.MIDORI/index.json');
const EXTRACT = join(ROOT, 'scripts/data/osm_midori.json');

/** Nothing beyond this from the station — the World's walkable core. */
const IMPORT_RADIUS_M = 800;

/**
 * Height bands. No OSM building here carries a height, so these come from
 * what the footprint can be: a 20 m² outline in this settlement is a shed,
 * a 90 m² one is a single-storey house with a roof on it, and the one
 * 1,800 m² outline is the school. Photograph 003 shows the street is
 * single-storey almost throughout.
 */
const HEIGHT_BANDS = [
  { maxAreaM2: 30, eave: 2.2, ridge: 3.1 },
  { maxAreaM2: 70, eave: 2.6, ridge: 4.0 },
  { maxAreaM2: 160, eave: 3.0, ridge: 5.0 },
  { maxAreaM2: 400, eave: 3.6, ridge: 6.0 },
  { maxAreaM2: Infinity, eave: 4.4, ridge: 7.2 },
];

/** Roof colours read off photograph 003 — the tin roofs along the street. */
const ROOF_PALETTE = ['#8c3a32', '#2f5a7a', '#2f6146', '#6b6f74', '#8a6a3a'];

/** Buildings whose use OSM names, and how the World should treat them. */
const NAMED_STRUCTURES = {
  '緑の湯': { id: 'STR_MIDORI_ONSEN', type: 'bathhouse', eave: 3.4, ridge: 5.6, roof: '#8c3a32' },
  // The school building carries no name in OSM — only the grounds around it
  // do — so it is matched on `building=school` instead, below.
  '緑町小学校': { id: 'STR_MIDORI_SCHOOL', type: 'school', eave: 6.4, ridge: 8.6, roof: '#2f5a7a' },
  '緑郵便局': { id: 'STR_MIDORI_POST_OFFICE', type: 'post_office', eave: 3.2, ridge: 4.6, roof: '#6b6f74' },
  '緑センター': { id: 'STR_MIDORI_CENTRE', type: 'community_centre', eave: 3.8, ridge: 5.8, roof: '#2f6146' },
  '斜里警察署緑駐在所': { id: 'STR_MIDORI_POLICE_BOX', type: 'police_box', eave: 2.9, ridge: 4.3, roof: '#6b6f74' },
  '第3分団消防庁舎': { id: 'STR_MIDORI_FIRE_STATION', type: 'fire_station', eave: 4.2, ridge: 6.0, roof: '#8c3a32' },
};

const DEG = Math.PI / 180;

function readJson(path) { return JSON.parse(readFileSync(path, 'utf8')); }
function writeJson(path, value) { writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`); }

/** Deterministic, so the town looks the same on every import. */
function hash32(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

function main() {
  const extract = readJson(EXTRACT);
  const [centreLon, centreLat] = extract.query_centre;
  const scale = {
    east: Math.cos(centreLat * DEG) * 111320.0,
    north: 110574.0,
  };
  const metres = ([lon, lat]) => [(lon - centreLon) * scale.east, (lat - centreLat) * scale.north];

  const buildings = readJson(join(WORLD, 'reality/buildings.geojson'));
  const index = readJson(INDEX);

  // Clear anything a previous run of this script put in, plus the two
  // synthetic boxes it supersedes — real footprints now cover that ground.
  buildings.features = buildings.features.filter(
    (f) => !f.properties.id.startsWith('BLDG_OSM_')
      && !f.properties.id.startsWith('SURF_OSM_')
      && !Object.values(NAMED_STRUCTURES).some((s) => s.id === f.properties.id)
      && !f.properties.id.startsWith('BLDG_SYNTH_'),
  );
  index.entities = index.entities.filter((e) => !e.id.startsWith('JP.01.546.MIDORI/TOWN_'));

  let imported = 0;
  let named = 0;

  for (const element of extract.elements) {
    if (element.type !== 'way') continue;
    const tags = element.tags || {};
    if (!tags.building) continue;

    const ring = element.geometry.map((c) => c.slice());
    if (ring.length < 4) continue;
    // GeoJSON wants the ring closed; OSM ways for areas already are, but a
    // few are not, and an open ring silently draws a sliver.
    const first = ring[0];
    const last = ring[ring.length - 1];
    if (first[0] !== last[0] || first[1] !== last[1]) ring.push(first.slice());

    const local = ring.map(metres);
    const centre = local.slice(0, -1).reduce(
      (acc, p) => [acc[0] + p[0] / (local.length - 1), acc[1] + p[1] / (local.length - 1)],
      [0, 0],
    );
    if (Math.hypot(centre[0], centre[1]) > IMPORT_RADIUS_M) continue;

    let area = 0;
    for (let i = 0; i < local.length - 1; i++) {
      area += local[i][0] * local[i + 1][1] - local[i + 1][0] * local[i][1];
    }
    area = Math.abs(area / 2);
    if (area < 6) continue; // below this it is a hut outline, not a building

    const name = tags.name ?? (tags.building === 'school' ? '緑町小学校' : undefined);
    const structure = name ? NAMED_STRUCTURES[name] : undefined;
    const band = HEIGHT_BANDS.find((b) => area <= b.maxAreaM2);
    const roof = ROOF_PALETTE[hash32(String(element.id)) % ROOF_PALETTE.length];

    const eave = structure?.eave ?? (tags.building === 'greenhouse' ? 2.4 : band.eave);
    const ridge = structure?.ridge ?? (tags.building === 'greenhouse' ? 3.2 : band.ridge);

    buildings.features.push({
      type: 'Feature',
      geometry: { type: 'Polygon', coordinates: [ring] },
      properties: {
        id: structure?.id ?? `BLDG_OSM_${element.id}`,
        name: name ?? null,
        structure_type: structure?.type ?? 'town_building',
        osm_building: tags.building,
        area_m2: Math.round(area),
        eave_height_m: eave,
        ridge_height_m: ridge,
        roof_colour: structure?.roof ?? roof,
        // A gable spanning the footprint's bounding box only reads correctly
        // over a simple outline. Anything more articulated than that — the
        // school's 29-vertex plan, for one — gets a flat roof rather than a
        // ridge thrown across wings it does not have.
        roof_shape: local.length - 1 <= 6 ? 'gable' : 'flat',
        confidence: 'B',
        evidence_type: 'public_gis',
        historical_status: 'plausible',
        source_ids: ['SRC_OSM_OVERPASS'],
        detail_confidence: {
          footprint: 'B (public_gis — OSM way ' + element.id + ')',
          eave_ridge_height: 'C (inference — banded from footprint area; OSM carries no height here)',
          roof_colour: 'C (inference — palette from photograph 003, assigned by a hash of the OSM id)',
          roof_shape: 'C (inference — a gable along the footprint\'s long axis)',
        },
        note: 'scripts/import-osm-town.mjs による取り込み。外形はOSM(public_gis)だが、'
          + '高さ・屋根形状・屋根色はOSMに情報がないため推定であり、detail_confidence に C として記録している。',
      },
    });
    imported++;

    if (structure) {
      named++;
      index.entities.push({
        id: `JP.01.546.MIDORI/TOWN_${structure.id.replace('STR_MIDORI_', '')}`,
        name,
        category: 'building',
        geometry_type: 'point',
        geometry: { type: 'Point', coordinates: [
          Number((centre[0] / scale.east + centreLon).toFixed(8)),
          Number((centre[1] / scale.north + centreLat).toFixed(8)),
        ] },
        confidence: 'B',
        evidence_type: 'public_gis',
        source_ids: ['SRC_OSM_OVERPASS'],
        frontier_status: 'defined',
        detail_ref: `reality/buildings.geojson#${structure.id}`,
        note: `OpenStreetMap way ${element.id} (${tags.amenity ?? tags.building})。`
          + 'scripts/import-osm-town.mjs による取り込み。外形は実測相当だが、建物の高さ・外観は推定。',
        position_status: 'located',
      });
    }
  }

  // Open ground the town is organised around: the school's grounds and its
  // sports field, and the park golf course laid out on the station forecourt.
  // Without them the vegetation scatter plants a forest over all three.
  const SURFACES = {
    'amenity=school': { type: 'school_grounds', colour: '#6f7a52' },
    'leisure=pitch': { type: 'sports_ground', colour: '#7a7f57' },
    'leisure=miniature_golf': { type: 'park_golf', colour: '#5f7d4a' },
  };
  let surfaces = 0;
  for (const element of extract.elements) {
    if (element.type !== 'way') continue;
    const tags = element.tags || {};
    const key = Object.keys(SURFACES).find((k) => {
      const [tag, value] = k.split('=');
      return tags[tag] === value;
    });
    if (!key) continue;
    const ring = element.geometry.map((c) => c.slice());
    if (ring.length < 4) continue;
    const first = ring[0];
    const last = ring[ring.length - 1];
    if (first[0] !== last[0] || first[1] !== last[1]) ring.push(first.slice());
    const local = ring.map(metres);
    const centre = local.slice(0, -1).reduce(
      (acc, p) => [acc[0] + p[0] / (local.length - 1), acc[1] + p[1] / (local.length - 1)],
      [0, 0],
    );
    if (Math.hypot(centre[0], centre[1]) > IMPORT_RADIUS_M) continue;
    buildings.features.push({
      type: 'Feature',
      geometry: { type: 'Polygon', coordinates: [ring] },
      properties: {
        id: `SURF_OSM_${element.id}`,
        name: tags.name ?? null,
        structure_type: SURFACES[key].type,
        surface_colour: SURFACES[key].colour,
        height_m: 0.05,
        confidence: 'B',
        evidence_type: 'public_gis',
        historical_status: 'plausible',
        source_ids: ['SRC_OSM_OVERPASS'],
        note: 'scripts/import-osm-town.mjs による取り込み。範囲はOSM(public_gis)、地表の色は推定。',
      },
    });
    surfaces++;
  }

  writeJson(join(WORLD, 'reality/buildings.geojson'), buildings);
  writeJson(INDEX, index);

  console.log('=== 緑町 imported from OSM ===');
  console.log(`extract        ${extract.elements.length} elements, radius ${extract.radius_m} m`);
  console.log(`buildings      ${imported} within ${IMPORT_RADIUS_M} m`);
  console.log(`named          ${named}`);
  console.log(`ground surfaces ${surfaces}`);
  for (const [name, s] of Object.entries(NAMED_STRUCTURES)) {
    const hit = buildings.features.find((f) => f.properties.id === s.id);
    console.log(`  ${hit ? '✓' : '·'} ${name} (${s.type})${hit ? ` — ${hit.properties.area_m2} m²` : ' — not in the extract'}`);
  }
}

main();
