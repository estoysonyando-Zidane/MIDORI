#!/usr/bin/env node
/**
 * The join checks: does the World that was BUILT agree with the Reality Data
 * it was built from?
 *
 * validate-reality-data.mjs checks the data. tsc checks the types. Until
 * this existed, nothing checked the solids in between — and that is exactly
 * where this project's defects live. Five in one day, every one of them
 * found by a person looking at a phone:
 *
 *   sleepers laid along the rails instead of across them        → 1. 向き
 *   ...and so overlapping three deep at a 0.64 m pitch          → 2. 重なり
 *   a bathhouse's name on a building 22 m from the real one     → 3. 名札
 *   the station 20 m along the line from where it belongs       → 4. 根拠なし
 *
 * All four are catchable here, without rendering a single frame. The fourth
 * is worth being precise about: comparing the built coordinate against its
 * evidence would NOT have caught the station, because its evidence was the
 * line's station point and the building stood 8 m from it, inside any
 * sensible tolerance. What was missing was that the building's position
 * ALONG the line rested on nothing at all. So the check is not a tolerance,
 * it is a census: how much of this World stands on inference, and which
 * parts.
 *
 * Run:  node scripts/dump-world.mjs dump.json && node scripts/check-joins.mjs dump.json
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const WORLD = join(ROOT, 'public/data/worlds/JP_HOKKAIDO_KIYOSATO_MIDORI_20100530');
const DUMP = process.argv[2] ?? 'world-dump.json';

/** How far from perpendicular (or parallel) a repeated element may sit. */
const AXIS_TOLERANCE = 0.25;
/** Overlap: the summed volume of the elements over the volume they occupy
 *  together. Sleepers at the standard pitch come out just over 1.0; laid the
 *  wrong way round they were stacked three deep. */
const OVERLAP_RATIO_LIMIT = 1.5;

const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));

const problems = [];
const notes = [];
const fail = (check, text) => problems.push(`${check}: ${text}`);

function main() {
  const dump = readJson(DUMP);
  const objects = dump.objects ?? [];
  if (objects.length === 0) throw new Error(`${DUMP} has no placed objects`);

  checkAlongPath(objects);
  checkOverlap(objects);
  checkLabels(objects);
  checkVehicleGauge();
  censusOfInference();

  console.log('=== 接合の検査 ===');
  for (const n of notes) console.log(`  ${n}`);
  if (problems.length === 0) {
    console.log(`PASS — ${objects.length} placed objects, 0 violations`);
    return;
  }
  console.log('');
  for (const p of problems) console.error(`FAIL ${p}`);
  console.error(`\n${problems.length} violation(s)`);
  process.exitCode = 1;
}

/**
 * 1. 向き — elements repeated along a path sit as they declared they would.
 *
 * The tangent comes from the elements' own succession, not from a recorded
 * one: a first pass compared every sampled sleeper against the bearing at
 * the station and reported the ones a kilometre down a curve as violations.
 * Taking the direction from neighbours is correct on curves, and it is not
 * circular — it asks whether the element lies across the line it is repeated
 * along, rather than comparing a rotation to the rotation it was built from.
 */
function checkAlongPath(objects) {
  const groups = new Map();
  for (const o of objects) {
    if (!o.alongPath || !o.longAxis) continue;
    const key = `${o.kind}/${o.run ?? 0}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(o);
  }
  const worstByKind = new Map();
  for (const [key, run] of groups) {
    const kind = key.split('/')[0];
    // The tangent is the run's OWN direction, first element to last.
    //
    // Neighbours are not enough: tie plates and fishplates are placed in
    // lateral groups — two per sleeper, four per joint — so the step from
    // one to the next crosses the track rather than following it, and every
    // one of them was reported as a violation. Over a run the lateral
    // offsets cancel and what is left is the line.
    const a = run[0];
    const b = run[run.length - 1];
    const dx = b.pos[0] - a.pos[0];
    const dz = b.pos[2] - a.pos[2];
    const span = Math.hypot(dx, dz);
    if (span < 2) continue;   // too short to give a direction
    const tx = dx / span;
    const tz = dz / span;
    for (const o of run) {
      const [ax, az] = o.longAxis;
      const dot = Math.abs(tx * ax + tz * az);
      const off = o.alongPath === 'perpendicular' ? dot : 1 - dot;
      const seen = worstByKind.get(kind);
      if (!seen || off > seen.off) worstByKind.set(kind, { off, id: o.id, mode: o.alongPath });
    }
  }
  for (const [kind, worst] of worstByKind) {
    const count = objects.filter((o) => o.kind === kind).length;
    const verdict = worst.off <= AXIS_TOLERANCE ? 'ok' : 'VIOLATION';
    notes.push(`向き ${kind.padEnd(10)} n=${String(count).padStart(4)} `
      + `${worst.mode} 最悪のずれ ${worst.off.toFixed(3)} (${verdict})`);
    if (worst.off > AXIS_TOLERANCE) {
      fail('向き', `${kind} は経路に対し ${worst.mode} のはずが `
        + `${worst.off.toFixed(2)} ずれている（最悪 ${worst.id}）`);
    }
  }
}

/** 2. 重なり — repeated elements do not pile up on each other. */
function checkOverlap(objects) {
  const groups = new Map();
  for (const o of objects) {
    if (!o.alongPath) continue;
    if (!groups.has(o.kind)) groups.set(o.kind, []);
    groups.get(o.kind).push(o);
  }
  for (const [kind, list] of groups) {
    if (list.length < 2) continue;
    let summed = 0;
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    for (const o of list) {
      summed += o.size[0] * o.size[1] * o.size[2];
      for (let a = 0; a < 3; a++) {
        min[a] = Math.min(min[a], o.pos[a] - o.size[a] / 2);
        max[a] = Math.max(max[a], o.pos[a] + o.size[a] / 2);
      }
    }
    void summed;
    // The pitch is the spacing between NEIGHBOURS, taken inside a contiguous
    // sample run. Dividing the whole span by the sample count measures the
    // sampling, not the track, and reports 124 m between sleepers.
    const runs = new Map();
    for (const o of list) {
      const key = o.run ?? 0;
      if (!runs.has(key)) runs.set(key, []);
      runs.get(key).push(o);
    }
    // Project onto the run's direction and take the smallest non-zero step.
    // Measuring straight-line distance between neighbours reports 0.08 m
    // between fishplates, which is the gap between the two plates on one
    // joint, not the spacing of the joints.
    let pitch = Infinity;
    for (const run of runs.values()) {
      if (run.length < 3) continue;
      const dx = run[run.length - 1].pos[0] - run[0].pos[0];
      const dz = run[run.length - 1].pos[2] - run[0].pos[2];
      const span = Math.hypot(dx, dz);
      if (span < 2) continue;
      // Cluster first. Fishplates come four to a joint and tie plates two
      // to a sleeper: they are CO-LOCATED along the path by design, and
      // measuring the gap inside a group reports 0.03 m between joints and
      // calls the track nineteen deep. What stacks up is groups, not
      // elements, so the pitch is the gap between groups.
      const GROUP_GAP_M = 0.5;
      const along = run
        .map((o) => (o.pos[0] * dx + o.pos[2] * dz) / span)
        .sort((x, y) => x - y);
      const groupStarts = [along[0]];
      for (let i = 1; i < along.length; i++) {
        if (along[i] - along[i - 1] > GROUP_GAP_M) groupStarts.push(along[i]);
      }
      for (let i = 1; i < groupStarts.length; i++) {
        pitch = Math.min(pitch, groupStarts[i] - groupStarts[i - 1]);
      }
    }
    if (!Number.isFinite(pitch)) continue;
    const first = list[0];
    // How thick the element is ALONG the path — that is what stacks up.
    //
    // Taking the min or max axis instead makes this check blind to exactly
    // the defect it exists for: a sleeper turned to lie along the rails still
    // has a 0.24 m short side, so the ratio came out fine while the track
    // was three deep. Project the element's own extents onto the path.
    const runForFootprint = [...runs.values()].find((r) => r.length > 2) ?? list;
    const rdx = runForFootprint[runForFootprint.length - 1].pos[0] - runForFootprint[0].pos[0];
    const rdz = runForFootprint[runForFootprint.length - 1].pos[2] - runForFootprint[0].pos[2];
    const rspan = Math.hypot(rdx, rdz) || 1;
    const tx = rdx / rspan;
    const tz = rdz / rspan;
    const [lx, lz] = first.longAxis ?? [1, 0];
    const longExtent = Math.max(first.size[0], first.size[2]);
    const shortExtent = Math.min(first.size[0], first.size[2]);
    const alongDot = Math.abs(lx * tx + lz * tz);
    const footprint = longExtent * alongDot + shortExtent * Math.sqrt(Math.max(0, 1 - alongDot * alongDot));
    const ratio = footprint / pitch;
    const verdict = ratio <= OVERLAP_RATIO_LIMIT ? 'ok' : 'VIOLATION';
    notes.push(`重なり ${kind.padEnd(10)} 間隔 ${pitch.toFixed(2)} m に対し `
      + `最大辺 ${footprint.toFixed(2)} m — 比 ${ratio.toFixed(2)} (${verdict})`);
    if (ratio > OVERLAP_RATIO_LIMIT) {
      fail('重なり', `${kind} は間隔 ${pitch.toFixed(2)} m に対して `
        + `${footprint.toFixed(2)} m あり、${ratio.toFixed(1)} 重に重なっている`);
    }
  }
}

/** 3. 名札 — a named building is the nearest candidate to what names it. */
function checkLabels(objects) {
  // Areas legitimately share a name with the building inside them — a school
  // names its grounds, a park-golf course is two polygons. The duplicate
  // that matters is two BUILDINGS both claiming to be the same institution,
  // which is how 緑の湯 ended up on an outline 22 m from the real one.
  const AREA_TYPES = new Set([
    'school_grounds', 'sports_ground', 'park_golf', 'station_square',
    'school_yard', 'plaza_pavement', 'station_terrace',
  ]);
  const poi = readJson(join(WORLD, 'reality/poi.geojson'));
  const buildings = readJson(join(WORLD, 'reality/buildings.geojson'));
  const named = new Map();
  for (const f of buildings.features) {
    if (f.properties.name) named.set(f.properties.id, f.properties.name);
  }

  // Every POI that a building claims to be: is that building the nearest
  // outline to it?
  for (const p of poi.features) {
    const name = p.properties.name;
    if (!name || p.geometry.type !== 'Point') continue;
    // A POI that import-gsi-labels.mjs placed AT a building cannot be used
    // to test whether the name is on the nearest building: it would be
    // asking the same import to confirm itself.
    if (String(p.properties.id).startsWith('LOC_GSI_')) continue;
    const [plon, plat] = p.geometry.coordinates;
    const mLat = 111132.0;
    const mLon = 111320.0 * Math.cos((plat * Math.PI) / 180);

    let claimant = null;
    let nearest = null;
    let nearestDistance = Infinity;
    for (const f of buildings.features) {
      if (f.geometry.type !== 'Polygon') continue;
      // Areas are excluded here for the same reason as in the duplicate
      // test: a facility's name sits on its ground as well as its building,
      // and an area's centroid is not where its name belongs.
      if (AREA_TYPES.has(f.properties.structure_type)) continue;
      const ring = f.geometry.coordinates[0].slice(0, -1);
      const clon = ring.reduce((a, c) => a + c[0], 0) / ring.length;
      const clat = ring.reduce((a, c) => a + c[1], 0) / ring.length;
      const d = Math.hypot((clon - plon) * mLon, (clat - plat) * mLat);
      if (d < nearestDistance) { nearestDistance = d; nearest = f; }
      if (f.properties.name === name) claimant = { f, d };
    }
    if (!claimant) continue;
    if (claimant.f !== nearest) {
      fail('名札', `「${name}」は ${claimant.f.properties.id} (${claimant.d.toFixed(0)} m) に付いているが、`
        + `最も近い外形は ${nearest.properties.id} (${nearestDistance.toFixed(0)} m)`);
    } else {
      notes.push(`名札 「${name}」→ ${claimant.f.properties.id} (${claimant.d.toFixed(0)} m, 最近傍) ok`);
    }
  }

  // ...and no name identifies two DIFFERENT things.
  //
  // A name legitimately appears more than once: a school names both its
  // building and its grounds, a park-golf course is two polygons, six drums
  // share one name. What is not legitimate is the same institution claimed
  // by two outlines that are not part of each other — which is how 緑の湯
  // ended up named on a building 22 m from the real one. So the test is not
  // "appears once": it is "all the outlines carrying this name are the same
  // kind of thing and close enough to be parts of one".
  const MULTIPART_RADIUS_M = 30;
  const byName = new Map();
  for (const f of buildings.features) {
    const name = f.properties.name;
    if (!name || f.geometry.type !== 'Polygon') continue;
    if (AREA_TYPES.has(f.properties.structure_type)) continue;
    const ring = f.geometry.coordinates[0].slice(0, -1);
    const lon = ring.reduce((a, c) => a + c[0], 0) / ring.length;
    const lat = ring.reduce((a, c) => a + c[1], 0) / ring.length;
    if (!byName.has(name)) byName.set(name, []);
    byName.get(name).push({ id: f.properties.id, type: f.properties.structure_type, lon, lat });
  }
  for (const [name, list] of byName) {
    if (list.length < 2) continue;
    const mLat = 111132.0;
    const mLon = 111320.0 * Math.cos((list[0].lat * Math.PI) / 180);
    let far = null;
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const d = Math.hypot((list[i].lon - list[j].lon) * mLon, (list[i].lat - list[j].lat) * mLat);
        const sameKind = list[i].type === list[j].type;
        if (d > MULTIPART_RADIUS_M || !sameKind) {
          if (!far || d > far.d) far = { d, a: list[i], b: list[j], sameKind };
        }
      }
    }
    if (far) {
      fail('名札', `「${name}」が別々の地物に付いている: ${far.a.id} (${far.a.type}) と `
        + `${far.b.id} (${far.b.type})、${far.d.toFixed(0)} m 離れている`);
    } else {
      notes.push(`名札 「${name}」 ${list.length} 件は同種で ${MULTIPART_RADIUS_M} m 以内 — 多部分の地物として ok`);
    }
  }
}

/**
 * 4. 根拠なし — how much of this World stands on inference alone.
 *
 * Not a pass/fail. A count and a list, printed every run, because "the
 * number of things placed on nothing but a guess" is the ceiling on how
 * accurate this World can be, and it is the figure that would have made the
 * station building's position visible before anyone stood in it.
 */
/* ------------------------------------------------------------------ *
 * 車両限界 — is a signal head hung where a train has to be?
 *
 * 省令解釈基準 第64条 第4図 puts the 車両限界 at 4,100 mm high and 3,000 mm
 * wide for 軌間 1,067 mm. 第20条(1)(2) lets a signal — 車両の走行に必要な
 * もの — stand inside the 建築限界's 基礎限界, but only while it is
 * 「車両の走行の安全を支障するおそれがない」, and a thing a train would hit
 * is not that.
 *
 * This exists because the first pass at the signals hung a head 1.2 m from
 * the track centre at 4.05 m — inside the box a railcar occupies, where the
 * roof corner would have taken it off. Nothing in the World could say so.
 *
 * WHY THIS READS THE DATA AND NOT THE DUMP. A first attempt measured every
 * placed object's bounding box against the envelope. It cannot work: a road
 * draped down a slope has a bounding box several metres tall and a hundred
 * long, an L-shaped bracket signal's box covers ground the signal does not
 * occupy, and the dump has no rail height to measure against. It duly
 * reported a road 86 m from the line as fouling the gauge. A check that
 * reports the wrong thing is worse than no check — this project has been
 * bitten three times by defects in its own QA — so the box approach was
 * dropped rather than tuned.
 *
 * What CAN be checked exactly is the thing the defect was in: a signal's
 * head position is not measured off geometry, it is stated by the feature
 * (`arm_length_m` from the mast, `head_height_m` above the rail), and the
 * mast's own offset from its track is fixed by the yard. So the arithmetic
 * is done on those numbers. Anything else near the track is still unchecked,
 * and this says so rather than pretending otherwise.
 * ------------------------------------------------------------------ */

/** [省令解釈基準] 第64条 第4図: 最大高さ H1 4,100 mm, 最大幅 L1 3,000 mm. */
const VEHICLE_GAUGE_HEIGHT_M = 4.10;
const VEHICLE_GAUGE_HALF_WIDTH_M = 1.50;
/** The board's half-height, from TownGenerator's 背板幅 0.44 and 灯の中心間隔 0.20. */
const SIGNAL_BOARD_HALF_HEIGHT_M = 0.44 / 2 + 0.20;
/** The platform's back edge, where a bracket mast stands. */
const PLATFORM_BACK_M = 1.475 + 3.5;

function checkVehicleGauge() {
  const buildings = readJson(join(WORLD, 'reality/buildings.geojson'));
  const signals = buildings.features.filter((f) => f.properties.structure_type === 'signal');
  if (signals.length === 0) { notes.push('車両限界  信号機なし — 検査せず'); return; }

  let worst = null;
  for (const f of signals) {
    const p = f.properties;
    const arm = Math.abs(p.arm_length_m ?? 0);
    if (arm < 0.05) continue;                       // beside the track, not over it
    // Each mast stands 0.4 m behind its OWN platform's back edge, on either
    // side, so its offset from its own track is the same for both; the head
    // comes back along the arm from there.
    const mastFromTrack = PLATFORM_BACK_M + 0.4;
    const headFromTrack = Math.abs(mastFromTrack - arm);
    if (headFromTrack >= VEHICLE_GAUGE_HALF_WIDTH_M) continue;   // laterally clear
    const underside = (p.head_height_m ?? 0) - SIGNAL_BOARD_HALF_HEIGHT_M;
    const clearance = underside - VEHICLE_GAUGE_HEIGHT_M;
    if (!worst || clearance < worst.clearance) worst = { id: p.id, headFromTrack, underside, clearance };
  }
  if (!worst) { notes.push('車両限界  線路上に張り出す頭部なし'); return; }
  notes.push(`車両限界  線路上の頭部 最小余裕 ${worst.clearance.toFixed(2)} m`
    + `（下端 ${worst.underside.toFixed(2)} m、限界 ${VEHICLE_GAUGE_HEIGHT_M} m）`
    + `${worst.clearance >= 0 ? ' (ok)' : ''}`);
  if (worst.clearance < 0) {
    fail('車両限界', `${worst.id} の頭部が線路中心から ${worst.headFromTrack.toFixed(2)} m、`
      + `下端 ${worst.underside.toFixed(2)} m で、高さ ${VEHICLE_GAUGE_HEIGHT_M} m の車両限界の中にある`);
  }
}

function censusOfInference() {
  const dir = join(WORLD, 'reality');
  const rows = [];
  for (const file of readdirSync(dir)) {
    if (!file.endsWith('.geojson')) continue;
    const data = readJson(join(dir, file));
    for (const f of data.features ?? []) {
      const p = f.properties ?? {};
      if (!f.geometry) continue;
      if (p.evidence_type !== 'inference') continue;
      rows.push(`${p.id ?? '(no id)'} [${file.replace('.geojson', '')}] ${p.name ?? ''}`.trim());
    }
  }
  notes.push(`根拠なし（evidence_type: inference で形を持つもの）— ${rows.length} 件`);
  for (const r of rows) notes.push(`    ${r}`);
}

main();
