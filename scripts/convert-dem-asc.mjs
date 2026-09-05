#!/usr/bin/env node
/**
 * convert-dem-asc — Directive 02 §11, §30 conversion tool.
 *
 * Converts an ESRI ASCII Grid (.asc) DEM into this engine's normalized
 * height-grid JSON (src/loaders/DEMLoader.ts HeightFieldSource shape).
 *
 * ESRI ASCII Grid header (all six keys required, order flexible):
 *   ncols, nrows, xllcorner, yllcorner, cellsize, NODATA_value
 * followed by nrows rows of ncols space-separated height values, row 0 = north.
 *
 * This assumes the grid's x/y are already in decimal-degree WGS84 lon/lat
 * (i.e. already reprojected — GSI DEM in JGD2011 is geographic, so this
 * usually holds without extra reprojection; if your source is in a projected
 * CRS such as JGD2011 / Japan Plane Rectangular CS, reproject to WGS84
 * lon/lat with GIS tooling before running this).
 *
 * GSI's own DEM5 distribution format is JPGIS2.0/GML, not ASCII Grid — this
 * converter deliberately does NOT parse that format (see acquisition_manifest.json
 * DEM entry for why: untested-against-a-real-sample GML parsing was judged too
 * risky to ship). Convert GML -> ASCII Grid with QGIS (or gdal_translate) first.
 *
 * Usage:
 *   node scripts/convert-dem-asc.mjs <input.asc> <out dem.json> \
 *     --confidence B --historical-status unknown \
 *     --source-ids SRC_GSI_DEM5_TILES --terrain-evidence-date 2023
 */
import { readFileSync, writeFileSync } from 'node:fs';

function parseArgs(argv) {
  const positional = [];
  const flags = { confidence: 'U', historicalStatus: 'unknown', sourceIds: [], terrainEvidenceDate: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--confidence') flags.confidence = argv[++i];
    else if (a === '--historical-status') flags.historicalStatus = argv[++i];
    else if (a === '--source-ids') flags.sourceIds = argv[++i].split(',').filter(Boolean);
    else if (a === '--terrain-evidence-date') flags.terrainEvidenceDate = argv[++i];
    else positional.push(a);
  }
  return { positional, flags };
}

const { positional, flags } = parseArgs(process.argv.slice(2));
const [inputPath, outputPath] = positional;
if (!inputPath || !outputPath) {
  console.error('usage: node scripts/convert-dem-asc.mjs <input.asc> <out dem.json> [--confidence B] [--historical-status unknown] [--source-ids ID1,ID2] [--terrain-evidence-date 2023]');
  process.exit(2);
}

const text = readFileSync(inputPath, 'utf8');
const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);

const header = {};
let dataStartLine = 0;
const HEADER_KEYS = new Set(['ncols', 'nrows', 'xllcorner', 'yllcorner', 'xllcenter', 'yllcenter', 'cellsize', 'nodata_value']);
for (let i = 0; i < lines.length; i++) {
  const parts = lines[i].trim().split(/\s+/);
  const key = parts[0].toLowerCase();
  if (HEADER_KEYS.has(key) && parts.length === 2) {
    header[key] = Number(parts[1]);
    dataStartLine = i + 1;
  } else {
    break;
  }
}

const required = ['ncols', 'nrows', 'cellsize'];
for (const k of required) {
  if (!(k in header)) {
    console.error(`missing required ASCII Grid header key: ${k}`);
    process.exit(2);
  }
}
if (!('xllcorner' in header) && !('xllcenter' in header)) {
  console.error('missing xllcorner/xllcenter');
  process.exit(2);
}
if (!('yllcorner' in header) && !('yllcenter' in header)) {
  console.error('missing yllcorner/yllcenter');
  process.exit(2);
}

const cols = header.ncols;
const rows = header.nrows;
const cellsize = header.cellsize;
const nodata = header.nodata_value ?? -9999;
const xll = header.xllcorner ?? header.xllcenter;
const yll = header.yllcorner ?? header.yllcenter;

const west = xll;
const east = xll + cellsize * cols;
const south = yll;
const north = yll + cellsize * rows;

const heights = [];
for (let i = dataStartLine; i < lines.length; i++) {
  const values = lines[i].trim().split(/\s+/).map(Number);
  for (const v of values) heights.push(v);
}

if (heights.length !== cols * rows) {
  console.error(`expected ${cols * rows} height values (ncols*nrows), got ${heights.length}`);
  process.exit(2);
}

let nodataCount = 0;
for (let i = 0; i < heights.length; i++) {
  if (heights[i] === nodata) {
    nodataCount++;
    heights[i] = 0; // no interpolation attempted — flat-fill, and the count below is surfaced so this isn't silent
  }
}
if (nodataCount > 0) {
  console.warn(`WARNING: ${nodataCount} NODATA cells were zero-filled (no interpolation). Review before treating this DEM as reliable.`);
}

const out = {
  bounds: { west, east, south, north },
  cols,
  rows,
  resolution_m: cellsize * 111320, // rough deg->m; fine for the ~5m-class grids this targets at these latitudes
  confidence: flags.confidence,
  historical_status: flags.historicalStatus,
  source_ids: flags.sourceIds,
  terrain_evidence_date: flags.terrainEvidenceDate,
  heights,
};

writeFileSync(outputPath, JSON.stringify(out));
console.log(`wrote ${cols}x${rows} height grid to ${outputPath}`);
