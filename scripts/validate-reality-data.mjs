#!/usr/bin/env node
/**
 * validate-reality-data — Directive 02 §31-32.
 *
 * Checks a World's Reality Data for structural and spatial sanity:
 *   geometry validity, coordinate validity, World bounds, duplicate IDs,
 *   missing source_ids, invalid confidence, invalid historical_status,
 *   orphaned POIs (event.location_id / origin.id references), railway
 *   continuity, road continuity, and coarse relative-distance sanity
 *   between named POIs (station / plaza / etc.).
 *
 * Usage: node scripts/validate-reality-data.mjs <worldDir>
 *   e.g. node scripts/validate-reality-data.mjs public/data/worlds/JP_HOKKAIDO_KIYOSATO_MIDORI_20100530
 *
 * Exits non-zero if any ERROR-level finding exists. WARN-level findings do
 * not fail the run (e.g. "no source_ids" on data that's explicitly synthetic).
 */
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const worldDir = process.argv[2];
if (!worldDir) {
  console.error('usage: node scripts/validate-reality-data.mjs <worldDir>');
  process.exit(2);
}

const CONFIDENCES = new Set(['A', 'B', 'C', 'U']);
const HISTORICAL_STATUSES = new Set(['confirmed', 'plausible', 'unknown', 'current-only']);

const errors = [];
const warnings = [];
function err(msg) { errors.push(msg); }
function warn(msg) { warnings.push(msg); }

function readJSON(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

const configPath = join(worldDir, 'world.json');
if (!existsSync(configPath)) {
  console.error(`FATAL: no world.json at ${configPath}`);
  process.exit(2);
}
const config = readJSON(configPath);

const seenIds = new Map(); // id -> [types]
const allFeatures = []; // { id, type, geometry, properties, confidence, source_ids, historical_status }

function loadCollection(relPath, type) {
  if (!relPath) return [];
  const abs = join(worldDir, relPath);
  if (!existsSync(abs)) {
    warn(`${type}: declared in world.json (${relPath}) but file does not exist`);
    return [];
  }
  const fc = readJSON(abs);
  if (fc.type !== 'FeatureCollection' || !Array.isArray(fc.features)) {
    err(`${type}: ${relPath} is not a valid GeoJSON FeatureCollection`);
    return [];
  }
  return fc.features.map((f, i) => {
    const p = f.properties ?? {};
    const id = p.id ?? `${type}_${i}`;
    return {
      id,
      type,
      geometry: f.geometry,
      properties: p,
      confidence: p.confidence ?? 'U',
      source_ids: p.source_ids ?? [],
      historical_status: p.historical_status ?? 'unknown',
    };
  });
}

for (const [key, type] of [
  ['poi', 'poi'], ['railway', 'railway'], ['roads', 'road'],
  ['buildings', 'building'], ['events', 'event'],
]) {
  const features = loadCollection(config.data?.[key], type);
  for (const f of features) {
    allFeatures.push(f);
    const list = seenIds.get(f.id) ?? [];
    list.push(f.type);
    seenIds.set(f.id, list);
  }
}

// ---- duplicate IDs ----
for (const [id, types] of seenIds) {
  if (types.length > 1) err(`duplicate id "${id}" used by ${types.length} features (${types.join(', ')})`);
}

// ---- per-feature checks ----
function isFiniteCoord([lon, lat]) {
  return Number.isFinite(lon) && Number.isFinite(lat) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180;
}
function geometryValid(g) {
  if (!g) return false;
  if (g.type === 'Point') return Array.isArray(g.coordinates) && isFiniteCoord(g.coordinates);
  if (g.type === 'LineString') return Array.isArray(g.coordinates) && g.coordinates.length >= 2 && g.coordinates.every(isFiniteCoord);
  if (g.type === 'Polygon') return Array.isArray(g.coordinates) && g.coordinates.length >= 1 && g.coordinates[0].length >= 4 && g.coordinates[0].every(isFiniteCoord);
  return false;
}

const EARTH_R = 6378137;
function metersFromOrigin(originLat, originLon, lat, lon) {
  const latRad = originLat * Math.PI / 180;
  const dLat = (lat - originLat) * Math.PI / 180;
  const dLon = (lon - originLon) * Math.PI / 180;
  const north = dLat * EARTH_R;
  const east = dLon * EARTH_R * Math.cos(latRad);
  return Math.hypot(north, east);
}

let originLat = null, originLon = null;
if (config.origin?.type === 'poi') {
  const originFeature = allFeatures.find((f) => f.id === config.origin.id);
  if (!originFeature) {
    err(`world.json origin.id "${config.origin.id}" does not resolve to any loaded feature`);
  } else if (originFeature.geometry?.type === 'Point') {
    [originLon, originLat] = originFeature.geometry.coordinates;
  }
} else if (config.origin?.type === 'latlon') {
  [originLat, originLon] = config.origin.latlon;
}

const radius = config.bounds?.radius_m ?? Infinity;
const BOUNDS_BUFFER_RATIO = 1.25; // Directive 02 §33: continuity features may extend a bit past bounds

for (const f of allFeatures) {
  if (!geometryValid(f.geometry)) {
    err(`${f.type}/${f.id}: invalid or missing geometry (${f.geometry?.type ?? 'none'})`);
    continue;
  }
  if (!CONFIDENCES.has(f.confidence)) {
    err(`${f.type}/${f.id}: invalid confidence "${f.confidence}" (must be A/B/C/U)`);
  }
  if (!HISTORICAL_STATUSES.has(f.historical_status)) {
    err(`${f.type}/${f.id}: invalid historical_status "${f.historical_status}"`);
  }
  if (!Array.isArray(f.source_ids) || f.source_ids.length === 0) {
    if (f.confidence === 'A' || f.confidence === 'B') {
      err(`${f.type}/${f.id}: confidence ${f.confidence} but no source_ids — A/B must be traceable to a source`);
    } else {
      warn(`${f.type}/${f.id}: no source_ids (confidence ${f.confidence})`);
    }
  }
  if (f.confidence === 'A' && f.historical_status === 'unknown') {
    warn(`${f.type}/${f.id}: confidence A (Confirmed) but historical_status unknown — double check this is intentional`);
  }

  // World bounds check (with buffer for linear continuity features)
  if (originLat !== null && f.geometry.type !== 'Polygon') {
    const coords = f.geometry.type === 'Point' ? [f.geometry.coordinates] : f.geometry.coordinates;
    const buffer = (f.type === 'railway' || f.type === 'road') ? radius * BOUNDS_BUFFER_RATIO : radius;
    for (const c of coords) {
      const d = metersFromOrigin(originLat, originLon, c[1], c[0]);
      if (d > buffer) {
        warn(`${f.type}/${f.id}: a vertex is ${d.toFixed(0)}m from World origin (bounds radius ${radius}m, buffer ${buffer.toFixed(0)}m)`);
        break;
      }
    }
  }
}

// ---- orphaned references: event.location_id ----
const idIndex = new Set(allFeatures.map((f) => f.id));
for (const f of allFeatures.filter((f) => f.type === 'event')) {
  const locId = f.properties.location_id;
  if (locId && !idIndex.has(locId)) {
    err(`event/${f.id}: location_id "${locId}" does not resolve to any loaded feature (orphaned reference)`);
  }
}

// ---- railway / road continuity: no duplicate-vertex self-crossing check, just gap detection between features of same type isn't meaningful with 1 line; instead check each LineString has no degenerate (zero-length) consecutive points ----
for (const f of allFeatures.filter((f) => f.type === 'railway' || f.type === 'road')) {
  const coords = f.geometry.coordinates;
  for (let i = 1; i < coords.length; i++) {
    const [lon0, lat0] = coords[i - 1];
    const [lon1, lat1] = coords[i];
    if (lon0 === lon1 && lat0 === lat1) {
      err(`${f.type}/${f.id}: degenerate zero-length segment at vertex ${i}`);
    }
  }
  if (coords.length < 2) {
    err(`${f.type}/${f.id}: linear feature has fewer than 2 vertices — not continuous`);
  }
}

// ---- spatial sanity: named POIs shouldn't be absurdly far from the station ----
const station = allFeatures.find((f) => f.id === config.origin?.id);
if (station && station.geometry.type === 'Point') {
  const [slon, slat] = station.geometry.coordinates;
  for (const f of allFeatures.filter((f) => f.type === 'poi' && f.id !== station.id)) {
    if (f.geometry.type !== 'Point') continue;
    const [lon, lat] = f.geometry.coordinates;
    const d = metersFromOrigin(slat, slon, lat, lon);
    if (d > radius) {
      warn(`poi/${f.id}: ${d.toFixed(0)}m from the station — outside declared World bounds radius (${radius}m)`);
    }
  }
}

// ---- report ----
console.log(`Validated ${allFeatures.length} Reality Data features from ${worldDir}\n`);
if (errors.length) {
  console.log(`ERRORS (${errors.length}):`);
  for (const e of errors) console.log(`  ✗ ${e}`);
}
if (warnings.length) {
  console.log(`\nWARNINGS (${warnings.length}):`);
  for (const w of warnings) console.log(`  ! ${w}`);
}
if (!errors.length && !warnings.length) {
  console.log('No issues found.');
}

console.log(`\n${errors.length === 0 ? 'PASS' : 'FAIL'} (${errors.length} errors, ${warnings.length} warnings)`);
process.exit(errors.length === 0 ? 0 : 1);
