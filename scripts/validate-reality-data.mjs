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
 * Directive 05 Task 4: any feature with empty source_ids is always flagged,
 * regardless of confidence — reported in its own "EMPTY SOURCE_IDS" section,
 * counted separately from ERRORS/WARNINGS so it can't get lost inside a
 * larger warning count. Confidence A/B with empty source_ids is still a hard
 * ERROR (unchanged); confidence C/U with empty source_ids lands here instead
 * of the general WARNINGS list.
 *
 * Usage: node scripts/validate-reality-data.mjs <worldDir>
 *   e.g. node scripts/validate-reality-data.mjs public/data/worlds/JP_HOKKAIDO_KIYOSATO_MIDORI_20100530
 *
 * Exits non-zero if any ERROR-level finding exists. WARN-level findings do
 * not fail the run (e.g. "no source_ids" on data that's explicitly synthetic).
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const worldDir = process.argv[2];
if (!worldDir) {
  console.error('usage: node scripts/validate-reality-data.mjs <worldDir>');
  process.exit(2);
}

const CONFIDENCES = new Set(['A', 'B', 'C', 'U']);
const HISTORICAL_STATUSES = new Set(['confirmed', 'plausible', 'unknown', 'current-only']);
const EVIDENCE_TYPES = new Set([
  'contemporary_record', 'contemporary_photo', 'official_record', 'public_gis',
  'encyclopedia', 'satellite_imagery', 'secondary_photo', 'inference',
]);
// Directive 08 §7.1: these evidence types alone can never justify confidence A.
const WEAK_EVIDENCE_FOR_A = new Set(['encyclopedia', 'secondary_photo', 'inference']);
// Directive 08 §7.2: ids from this prefix set are "spec-derived" and must
// always carry source_ids, regardless of confidence (unlike the generic
// A/B-only rule below, which predates this directive).
const SPEC_DERIVED_PREFIXES = ['STR_MIDORI_', 'TEMP_EVENT_'];

const errors = [];
const warnings = [];
const emptySourceIds = []; // Directive 05 Task 4: tallied separately from `warnings`
const evidenceTypeMissing = []; // Directive 08 §7.3: tallied separately, warning only
let eventSpatialLeakCount = 0; // Directive 08 §7.4
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
      evidence_type: p.evidence_type, // intentionally left undefined if absent — see §7.3
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
  const hasSourceIds = Array.isArray(f.source_ids) && f.source_ids.length > 0;
  const isSpecDerived = SPEC_DERIVED_PREFIXES.some((prefix) => f.id.startsWith(prefix));
  if (!hasSourceIds) {
    if (f.confidence === 'A' || f.confidence === 'B') {
      err(`${f.type}/${f.id}: confidence ${f.confidence} but no source_ids — A/B must be traceable to a source`);
    } else if (isSpecDerived) {
      // Directive 08 §7.2: spec-derived objects need source_ids at every
      // confidence level, not just A/B — even a C/U inference should cite
      // what it was inferred from.
      err(`${f.type}/${f.id}: spec-derived object (MIDORI_STATION_REALITY_SPEC) but no source_ids`);
    } else {
      emptySourceIds.push(`${f.type}/${f.id}: no source_ids (confidence ${f.confidence})`);
    }
  }
  if (f.confidence === 'A' && f.historical_status === 'unknown') {
    warn(`${f.type}/${f.id}: confidence A (Confirmed) but historical_status unknown — double check this is intentional`);
  }

  // ---- Directive 08 §7.1: evidence_type/confidence consistency ----
  if (f.evidence_type !== undefined && !EVIDENCE_TYPES.has(f.evidence_type)) {
    err(`${f.type}/${f.id}: invalid evidence_type "${f.evidence_type}"`);
  } else if (f.confidence === 'A' && f.evidence_type && WEAK_EVIDENCE_FOR_A.has(f.evidence_type)) {
    err(`${f.type}/${f.id}: confidence A but evidence_type "${f.evidence_type}" cannot by itself justify Confirmed`);
  }
  // ---- Directive 08 §7.3: evidence_type missing (warning only) ----
  if (f.evidence_type === undefined) {
    evidenceTypeMissing.push(`${f.type}/${f.id}: evidence_type not set`);
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

// ---- Directive 08 §7.4: TEMP_EVENT_* must not carry spatial child objects ----
// (i.e. "activities" may list strings, but nothing under a TEMP_EVENT_* id's
// properties may itself be a spatial object — an array element or nested
// value carrying a `geometry` key would mean a tent/stage/vehicle was
// derived from the event's mere existence, which spec §10.3 forbids.)
function containsGeometryLeak(value) {
  if (Array.isArray(value)) return value.some(containsGeometryLeak);
  if (value && typeof value === 'object') {
    if ('geometry' in value) return true;
    return Object.values(value).some(containsGeometryLeak);
  }
  return false;
}
for (const f of allFeatures.filter((f) => f.id.startsWith('TEMP_EVENT_'))) {
  for (const [key, value] of Object.entries(f.properties)) {
    if (key === 'activities') continue; // plain string list, not spatial
    if (containsGeometryLeak(value)) {
      err(`event/${f.id}: property "${key}" appears to carry a spatial child object — events must not derive space from existence (spec §10.3)`);
      eventSpatialLeakCount++;
    }
  }
}

// ---- Directive 08 AC01: SRC_GSI_AERIAL_20051007 must never be registered ----
const sourcesPath = join(worldDir, config.evidence?.sources ?? '');
if (config.evidence?.sources && existsSync(sourcesPath)) {
  const registry = readJSON(sourcesPath);
  if ((registry.sources ?? []).some((s) => s.id === 'SRC_GSI_AERIAL_20051007')) {
    err('evidence/sources.json: SRC_GSI_AERIAL_20051007 is registered but spec §2 explicitly excludes it from use as evidence');
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

// ---- Directive 09 §9: Spatial Index checks ----
// The Index lives outside any single World's directory (it's date-independent
// — Directive 09 §3), at public/data/spatial_index/<place_path>/. We locate
// it relative to worldDir's grandparent (public/data/) since that's the only
// anchor this script is given; detail_ref paths are resolved against worldDir
// itself, which holds for as long as there is exactly one World for this place.
const spatialErrors = [];
const spatialWarnings = [];
let spatialStubCount = 0;
function spatialErr(msg) { spatialErrors.push(msg); }
function spatialWarn(msg) { spatialWarnings.push(msg); }

// Directive 09 §2.1: the Index must never carry appearance/look information —
// that's Reality Data's job. Any of these keys on an entity is a violation.
const APPEARANCE_KEYS = new Set([
  'color', 'colour', 'material', 'texture', 'height_m', 'width_m', 'depth_m',
  'dimensions', 'roughness', 'metalness', 'opacity', 'model', 'mesh',
]);

const publicDataDir = join(worldDir, '..', '..');
const spatialIndexRoot = join(publicDataDir, 'spatial_index');
if (existsSync(spatialIndexRoot)) {
  for (const placePath of readdirSync(spatialIndexRoot)) {
    const placeDir = join(spatialIndexRoot, placePath);
    const indexPath = join(placeDir, 'index.json');
    if (!existsSync(indexPath)) continue;
    const index = readJSON(indexPath);

    for (const e of index.entities ?? []) {
      // 9.1: entity id must be "<place_path>/UPPER_SNAKE"
      const idPattern = new RegExp(`^${placePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/[A-Z0-9_]+$`);
      if (!idPattern.test(e.id)) {
        spatialErr(`${e.id}: id does not match "<place_path>/UPPER_SNAKE" (place_path=${placePath})`);
      }

      // 9.2 / 9.3: detail_ref
      if (e.detail_ref === null || e.detail_ref === undefined) {
        if (e.frontier_status === 'defined') {
          spatialErr(`${e.id}: frontier_status=defined but detail_ref is null`);
        }
      } else {
        const [relPath, fragment] = e.detail_ref.split('#');
        const absPath = join(worldDir, relPath);
        if (!existsSync(absPath)) {
          spatialErr(`${e.id}: detail_ref "${e.detail_ref}" — file does not exist (${relPath})`);
        } else if (fragment) {
          const fc = readJSON(absPath);
          const found = (fc.features ?? []).some((f) => (f.properties ?? {}).id === fragment);
          if (!found) {
            spatialErr(`${e.id}: detail_ref "${e.detail_ref}" — no feature with id "${fragment}" in ${relPath}`);
          }
        }
      }

      // 9.4: no appearance/look fields
      for (const key of Object.keys(e)) {
        if (APPEARANCE_KEYS.has(key)) {
          spatialErr(`${e.id}: carries appearance field "${key}" — Index must not hold look/material/dimension data`);
        }
      }

      // 9.5: position consistency with the Reality Data it points at (Point only)
      if (e.detail_ref && e.geometry?.type === 'Point') {
        const [relPath, fragment] = e.detail_ref.split('#');
        const absPath = join(worldDir, relPath);
        if (fragment && existsSync(absPath)) {
          const fc = readJSON(absPath);
          const target = (fc.features ?? []).find((f) => (f.properties ?? {}).id === fragment);
          if (target?.geometry?.type === 'Point') {
            const [tlon, tlat] = target.geometry.coordinates;
            const [elon, elat] = e.geometry.coordinates;
            const d = metersFromOrigin(tlat, tlon, elat, elon);
            if (d > 1) {
              spatialWarn(`${e.id}: Index position is ${d.toFixed(1)}m from detail_ref target's position (${e.detail_ref})`);
            }
          }
        }
      }

      // 9.6: tally stubs
      if (e.frontier_status === 'stub') spatialStubCount++;
    }
  }
} else {
  spatialWarn('no public/data/spatial_index/ directory found — Directive 09 Spatial Index not present');
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
if (emptySourceIds.length) {
  console.log(`\nEMPTY SOURCE_IDS (${emptySourceIds.length}) — tracked separately, does not fail the run:`);
  for (const w of emptySourceIds) console.log(`  ○ ${w}`);
}
if (evidenceTypeMissing.length) {
  console.log(`\nEVIDENCE_TYPE MISSING (${evidenceTypeMissing.length}) — Directive 08 §7.3, warning only:`);
  for (const w of evidenceTypeMissing) console.log(`  ○ ${w}`);
}
if (!errors.length && !warnings.length && !emptySourceIds.length && !evidenceTypeMissing.length) {
  console.log('No issues found.');
}

console.log(`\nDirective 08 §7 checks: 7.1 evidence_type/confidence consistency — ${errors.filter((e) => e.includes('cannot by itself justify')).length} violation(s); 7.2 spec-derived source_ids — ${errors.filter((e) => e.includes('spec-derived object')).length} violation(s); 7.3 evidence_type missing — ${evidenceTypeMissing.length} flagged (warning); 7.4 event spatial leak — ${eventSpatialLeakCount} violation(s)`);

if (spatialErrors.length) {
  console.log(`\nSPATIAL INDEX ERRORS (${spatialErrors.length}):`);
  for (const e of spatialErrors) console.log(`  ✗ ${e}`);
}
if (spatialWarnings.length) {
  console.log(`\nSPATIAL INDEX WARNINGS (${spatialWarnings.length}):`);
  for (const w of spatialWarnings) console.log(`  ! ${w}`);
}
console.log(
  `\nDirective 09 §9 checks: 9.1 id format — ${spatialErrors.filter((e) => e.includes('does not match')).length} violation(s); ` +
  `9.2 detail_ref existence — ${spatialErrors.filter((e) => e.includes('file does not exist') || e.includes('no feature with id')).length} violation(s); ` +
  `9.3 defined-without-detail_ref — ${spatialErrors.filter((e) => e.includes('detail_ref is null')).length} violation(s); ` +
  `9.4 appearance leak — ${spatialErrors.filter((e) => e.includes('appearance field')).length} violation(s); ` +
  `9.5 position mismatch — ${spatialWarnings.filter((w) => w.includes('Index position is')).length} flagged (warning); ` +
  `9.6 stub entity count — ${spatialStubCount} (info)`
);

const totalErrors = errors.length + spatialErrors.length;
console.log(`\n${totalErrors === 0 ? 'PASS' : 'FAIL'} (${errors.length} errors, ${warnings.length} warnings, ${emptySourceIds.length} empty-source_ids, ${evidenceTypeMissing.length} evidence_type-missing, ${spatialErrors.length} spatial-index-errors, ${spatialWarnings.length} spatial-index-warnings)`);
process.exit(totalErrors === 0 ? 0 : 1);
