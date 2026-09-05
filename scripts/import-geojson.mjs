#!/usr/bin/env node
/**
 * import-geojson — Directive 02 §29-30 conversion tool.
 *
 * Normalizes a raw GeoJSON FeatureCollection (e.g. exported from GSI/MLIT
 * GML or Shapefile data, or from OSM, via external GIS tooling) into the
 * RealityData shape this engine's GeoJSONLoader expects: every feature gets
 * an id, confidence, source_ids, and historical_status — defaulted to the
 * safest values (confidence "U", historical_status "unknown") rather than
 * silently inherited from whatever was already in the raw file, per
 * Directive 02 §3 ("史実として確認できないものをA/Bに昇格させてはならない").
 *
 * Usage:
 *   node scripts/import-geojson.mjs <input.geojson> <out.geojson> \
 *     --id-prefix ROAD --confidence U --historical-status unknown \
 *     --source-ids SRC_GSI_FGD_MENU,SRC_OSM_OVERPASS
 *
 * Flags are applied to every feature uniformly. For per-feature confidence
 * (e.g. "some roads confirmed by aerial photo, others not"), edit the output
 * file directly afterward — this tool only gets you to a valid starting point.
 */
import { readFileSync, writeFileSync } from 'node:fs';

function parseArgs(argv) {
  const positional = [];
  const flags = { confidence: 'U', historicalStatus: 'unknown', idPrefix: 'FEATURE', sourceIds: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--confidence') flags.confidence = argv[++i];
    else if (a === '--historical-status') flags.historicalStatus = argv[++i];
    else if (a === '--id-prefix') flags.idPrefix = argv[++i];
    else if (a === '--source-ids') flags.sourceIds = argv[++i].split(',').filter(Boolean);
    else positional.push(a);
  }
  return { positional, flags };
}

const { positional, flags } = parseArgs(process.argv.slice(2));
const [inputPath, outputPath] = positional;
if (!inputPath || !outputPath) {
  console.error('usage: node scripts/import-geojson.mjs <input.geojson> <out.geojson> [--id-prefix X] [--confidence A|B|C|U] [--historical-status confirmed|plausible|unknown|current-only] [--source-ids ID1,ID2]');
  process.exit(2);
}

const VALID_CONFIDENCE = new Set(['A', 'B', 'C', 'U']);
const VALID_HISTORICAL = new Set(['confirmed', 'plausible', 'unknown', 'current-only']);
if (!VALID_CONFIDENCE.has(flags.confidence)) {
  console.error(`invalid --confidence "${flags.confidence}"`);
  process.exit(2);
}
if (!VALID_HISTORICAL.has(flags.historicalStatus)) {
  console.error(`invalid --historical-status "${flags.historicalStatus}"`);
  process.exit(2);
}

const raw = JSON.parse(readFileSync(inputPath, 'utf8'));
if (raw.type !== 'FeatureCollection' || !Array.isArray(raw.features)) {
  console.error(`${inputPath} is not a GeoJSON FeatureCollection`);
  process.exit(2);
}

let skipped = 0;
const features = raw.features
  .map((f, i) => {
    if (!f.geometry || !['Point', 'LineString', 'Polygon'].includes(f.geometry.type)) {
      skipped++;
      return null;
    }
    const existing = f.properties ?? {};
    return {
      type: 'Feature',
      geometry: { type: f.geometry.type, coordinates: f.geometry.coordinates },
      properties: {
        id: existing.id ?? `${flags.idPrefix}_${String(i).padStart(3, '0')}`,
        ...existing,
        confidence: existing.confidence ?? flags.confidence,
        historical_status: existing.historical_status ?? flags.historicalStatus,
        source_ids: existing.source_ids ?? flags.sourceIds,
      },
    };
  })
  .filter(Boolean);

writeFileSync(outputPath, JSON.stringify({ type: 'FeatureCollection', features }));
console.log(`wrote ${features.length} features to ${outputPath}${skipped ? ` (skipped ${skipped} unsupported geometries)` : ''}`);
