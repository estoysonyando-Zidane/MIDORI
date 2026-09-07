import * as THREE from 'three';
import type { LocalTangentPlane } from '../core/Coordinates';

/**
 * Permanent way for a JR narrow-gauge local line.
 *
 * WHERE THESE NUMBERS COME FROM
 * -----------------------------
 * This file used to carry a block of figures with a source entry that said
 * "公知の規格値" and had no URL and no document name. That is not a source.
 * The numbers have been taken back to the documents that set them, and each
 * one below now says which article or figure it is from:
 *
 *   [省令解釈基準]  鉄道に関する技術上の基準を定める省令等の解釈基準
 *                  国鉄技第157号 (国土交通省鉄道局長通知)
 *                  https://www.mlit.go.jp/common/001968198.pdf
 *                  SRC_MLIT_TECH_KAISHAKU — read directly, text and 付図
 *   [JIS E 1101]   普通レール及び分岐器類用特殊レール
 *                  SRC_JIS_E1101
 *   [実施基準]      甲賀市線路構造実施基準 (信楽高原鐵道の線路構造実施基準)
 *                  SRC_SHIGARAKI_JISSHI_KIJUN — a real operator's filed
 *                  standard for a single-track non-electrified local line
 *
 * WHAT IS STILL NOT SOURCED
 * -------------------------
 * The sleeper's dimensions, the 39-per-25 m spacing and the 200 mm ballast
 * depth are the figures I have not yet found a public document for. They are
 * the standard values for a 木まくらぎ 乙線 and they are marked below, so the
 * gap is visible rather than hidden behind a confident-sounding constant.
 *
 * 釧網本線 is 単線・非電化 (SRC_WP_SENMO). Nothing here is a measurement of
 * this particular track: these are the national figures, which is exactly
 * why they can be relied on — they are identical from 緑 to anywhere else.
 */

/** 軌間. [省令解釈基準] Ⅲ-1 第12条(1): 普通鉄道の軌間は 0.762 / 1.067 /
 *  1.372 / 1.435 m のいずれか. Measured between the inner faces of the
 *  rail heads within 14 mm of the running surface ([実施基準] 第2条). */
export const TRACK_GAUGE_M = 1.067;
/** 50kgN rail, [JIS E 1101]: 高さ 153・頭部幅 65・腹部厚 15・底部幅 127 mm,
 *  計算質量 50.40 kg/m. */
export const RAIL_HEIGHT_M = 0.153;
export const RAIL_HEAD_WIDTH_M = 0.065;
export const RAIL_WEB_WIDTH_M = 0.015;
export const RAIL_FOOT_WIDTH_M = 0.127;
/** 定尺レール 25 m [JIS E 1101 表3 / 実施基準 第2条], so a joint every 25 m
 *  — the sound underfoot and the fishplates you can see from the platform. */
export const RAIL_LENGTH_M = 25;
/** レールは軌間内方へ 40 分の 1 の傾斜を付けて敷設する. [実施基準] 第23条4.
 *  Rails standing dead upright is one of the things that reads as a model. */
export const RAIL_CANT = 1 / 40;
/** Rail centres are the gauge plus one head width apart. */
export const RAIL_CENTRE_OFFSET_M = (TRACK_GAUGE_M + RAIL_HEAD_WIDTH_M) / 2;

/** 木まくらぎ 並型 2,100 × 240 × 140 mm. NOT YET SOURCED — see the header. */
export const SLEEPER_LENGTH_M = 2.1;
export const SLEEPER_WIDTH_M = 0.24;
export const SLEEPER_DEPTH_M = 0.14;
/** 39本/25 m on a 乙線. NOT YET SOURCED — see the header. For scale, the one
 *  operator's standard I could read sets 34本以上 for its lightest class
 *  ([実施基準] 第23条3), so 39 is the right order for a JR 地方交通線. */
export const SLEEPER_PITCH_M = 25 / 39;
/** タイプレート. 本線の木マクラギ使用区間では原則としてタイプレートを敷設する
 *  ([実施基準] 第23条13). Dimensions are not in that document; these are the
 *  proportions of a 50kgN 木まくらぎ用 tie plate. */
export const TIE_PLATE_LENGTH_M = 0.30;   // across the track
export const TIE_PLATE_WIDTH_M = 0.19;    // along the track, inside the sleeper
export const TIE_PLATE_DEPTH_M = 0.016;
/** 継目板 (fishplate), one each side of the joint, spanning the web. */
export const FISHPLATE_LENGTH_M = 0.50;   // along the track, bridging the joint
export const FISHPLATE_HEIGHT_M = 0.095;
export const FISHPLATE_DEPTH_M = 0.020;
/** 遊間: the gap left at a joint ([実施基準] 第23条10 requires one; the size
 *  varies with rail temperature, this is a mid-range value). */
export const RAIL_JOINT_GAP_M = 0.008;

/** 道床: thickness under the sleeper, shoulder width, and side slope. */
export const BALLAST_UNDER_SLEEPER_M = 0.2;
export const BALLAST_SHOULDER_M = 0.4;
export const BALLAST_SLOPE = 1.5;

/** Formation to the underside of the rail: the sleepers' top face. */
export const BALLAST_TOP_M = BALLAST_UNDER_SLEEPER_M + SLEEPER_DEPTH_M;
/**
 * Formation to the ballast surface between the sleepers.
 *
 * The crib is packed to somewhat below the sleeper top, so about the upper
 * half of each sleeper stands proud — which is the whole reason track reads
 * as track and not as a strip of gravel. Filling the crib flush to the
 * sleeper top, as this first did, buries them completely.
 */
export const BALLAST_SURFACE_M = BALLAST_UNDER_SLEEPER_M + SLEEPER_DEPTH_M * 0.45;
/** Formation to the top of the rail. Everything trackside is measured from
 *  here: the platform, and the railcar's wheels. */
export const RAIL_HEAD_M = BALLAST_TOP_M + RAIL_HEIGHT_M;

/**
 * 建築限界 — how close to the track anything may stand.
 *
 * [省令解釈基準] Ⅲ-9 第20条 第1図 (建築限界・普通鉄道): the side limit is
 * 1,475 mm from the track centre up to 920 mm above rail level, then steps
 * out to 1,575 / 1,625 / 1,650 / 1,900 mm as it rises. A 760 mm platform is
 * inside the first band, so its edge stands at 1.475 m — which is also the
 * 車両限界 基礎限界 half-width at that height (1,425 mm, [第4図] L2) plus the
 * 50 mm the same article requires between platform and vehicle.
 *
 * The platform used to be modelled at 1.8 m off centre with a comment saying
 * that kept the modelled edge clear of the modelled railcar. That is a
 * 325 mm gap the railway would not allow, and it is exactly the sort of
 * slack that makes a platform feel wrong to stand on.
 */
export const PLATFORM_EDGE_OFFSET_M = 1.475;
/** 車両限界 基礎限界 最大幅 3,000 mm. [省令解釈基準] 第4図 (L1). */
export const VEHICLE_GAUGE_WIDTH_M = 3.0;
/** 本線直線の軌道中心間隔の下限 = 車両限界の基礎限界の最大幅 + 600 mm.
 *  [省令解釈基準] Ⅲ-11 第22条(1)①. */
export const MIN_TRACK_CENTRES_M = VEHICLE_GAUGE_WIDTH_M + 0.6;

/** A point on a track centreline, with its direction and side vector. */
export interface TrackPoint {
  position: THREE.Vector3;
  tangent: THREE.Vector3;
  side: THREE.Vector3;
  distance: number;
}

const UP = new THREE.Vector3(0, 1, 0);

/** Projects a LineString onto the terrain and measures it. */
export function trackPath(
  coordinates: [number, number][],
  tangentPlane: LocalTangentPlane,
  heightAt: (x: number, z: number) => number,
): TrackPoint[] {
  const positions = coordinates.map(([lon, lat]) => {
    const local = tangentPlane.project(lat, lon);
    return new THREE.Vector3(local.x, heightAt(local.x, local.z), local.z);
  });
  if (positions.length < 2) return [];

  const out: TrackPoint[] = [];
  let distance = 0;
  for (let i = 0; i < positions.length; i++) {
    const previous = positions[Math.max(0, i - 1)];
    const next = positions[Math.min(positions.length - 1, i + 1)];
    const tangent = new THREE.Vector3().subVectors(next, previous);
    if (tangent.lengthSq() < 1e-9) tangent.set(0, 0, 1);
    tangent.normalize();
    if (i > 0) distance += positions[i].distanceTo(positions[i - 1]);
    out.push({
      position: positions[i],
      tangent,
      side: new THREE.Vector3().crossVectors(tangent, UP).normalize(),
      distance,
    });
  }
  return out;
}

/**
 * Sweeps a cross-section along a path.
 *
 * `profile` is given in the track's own frame: u across the track (metres
 * from the centreline, positive to the side vector) and v up from the
 * formation. The ring is closed, so a profile of four points makes a solid
 * bar and a profile of four points with a wide base makes a ballast prism.
 */
export function sweepProfile(path: TrackPoint[], profile: [number, number][]): THREE.BufferGeometry {
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];

  // v runs in metres around the profile rather than by point index, so a
  // material can tile at a real size — ballast has to look like 40 mm stone
  // whichever face of the prism you are looking at.
  const perimeter: number[] = [0];
  for (let p = 1; p <= profile.length; p++) {
    const a = profile[p - 1];
    const b = profile[p % profile.length];
    perimeter.push(perimeter[p - 1] + Math.hypot(b[0] - a[0], b[1] - a[1]));
  }

  const at = (point: TrackPoint, u: number, v: number) => new THREE.Vector3()
    .copy(point.position).addScaledVector(point.side, u).addScaledVector(UP, v);

  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1];
    const b = path[i];
    for (let p = 0; p < profile.length; p++) {
      const [u0, v0] = profile[p];
      const [u1, v1] = profile[(p + 1) % profile.length];
      const a0 = at(a, u0, v0);
      const a1 = at(a, u1, v1);
      const b0 = at(b, u0, v0);
      const b1 = at(b, u1, v1);
      // two triangles per face, wound so the outside faces out
      const quad = [a0, b0, b1, a0, b1, a1];
      const edge = new THREE.Vector3().subVectors(b0, a0);
      const rung = new THREE.Vector3().subVectors(a1, a0);
      const normal = new THREE.Vector3().crossVectors(edge, rung).normalize();
      // quad order is a0, b0, b1, a0, b1, a1 — the first of each pair is on
      // the `a` cross-section, and the 1-suffixed ones are the next profile
      // point round
      const vAlong = [a.distance, b.distance, b.distance, a.distance, b.distance, a.distance];
      const vRound = [perimeter[p], perimeter[p], perimeter[p + 1], perimeter[p], perimeter[p + 1], perimeter[p + 1]];
      for (let k = 0; k < quad.length; k++) {
        positions.push(quad[k].x, quad[k].y, quad[k].z);
        normals.push(normal.x, normal.y, normal.z);
        uvs.push(vAlong[k], vRound[k]);
      }
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  return geometry;
}

/** The ballast prism: flat top the width of the sleepers plus shoulders,
 *  battered sides down to the formation. */
export function ballastProfile(): [number, number][] {
  const top = SLEEPER_LENGTH_M / 2 + BALLAST_SHOULDER_M;
  const bottom = top + BALLAST_SURFACE_M * BALLAST_SLOPE;
  return [
    [-bottom, 0],
    [bottom, 0],
    [top, BALLAST_SURFACE_M],
    [-top, BALLAST_SURFACE_M],
  ];
}

/**
 * One rail, as its real cross-section: foot, web and head.
 *
 * `centreOffset` is the rail's own centre, signed in the track's side
 * direction. The section is tilted RAIL_CANT toward the track centre, about
 * the middle of its foot, which is how rail is actually laid ([実施基準]
 * 第23条4) and what makes the head sit slightly inboard of the foot.
 */
export function railProfile(centreOffset: number): [number, number][] {
  const base = BALLAST_TOP_M;
  const foot = RAIL_FOOT_WIDTH_M / 2;
  const head = RAIL_HEAD_WIDTH_M / 2;
  const web = RAIL_WEB_WIDTH_M / 2;
  const footTop = 0.028;
  const headBottom = RAIL_HEIGHT_M - 0.042;
  // section in its own frame: u across, v up from the foot
  const section: [number, number][] = [
    [-foot, 0],
    [foot, 0],
    [foot, footTop],
    [web, footTop + 0.012],
    [web, headBottom],
    [head, headBottom + 0.010],
    [head, RAIL_HEIGHT_M],
    [-head, RAIL_HEIGHT_M],
    [-head, headBottom + 0.010],
    [-web, headBottom],
    [-web, footTop + 0.012],
    [-foot, footTop],
  ];
  // tilt toward the track centre: the top leans in by RAIL_CANT per unit up
  const lean = centreOffset >= 0 ? -RAIL_CANT : RAIL_CANT;
  return section.map(([u, v]) => [centreOffset + u + lean * v, base + v]);
}

/**
 * Where the rail joints fall along a path, as distances from its start.
 *
 * 定尺レール is 25 m, so on plain line the joints are 25 m apart. They are
 * what you hear from inside the railcar and what you see on the sleepers as
 * a pair of 継目板 bolted across the web.
 */
export function jointDistances(path: TrackPoint[], withinOf: THREE.Vector3 | null, radiusM: number): number[] {
  if (path.length < 2) return [];
  const total = path[path.length - 1].distance;
  const out: number[] = [];
  for (let d = RAIL_LENGTH_M; d < total; d += RAIL_LENGTH_M) {
    if (withinOf) {
      const p = pointAt(path, d);
      if (!p || p.position.distanceTo(withinOf) > radiusM) continue;
    }
    out.push(d);
  }
  return out;
}

/** Interpolates a path at a distance from its start. */
export function pointAt(path: TrackPoint[], distance: number): TrackPoint | null {
  if (path.length < 2) return null;
  let i = 1;
  while (i < path.length - 1 && path[i].distance < distance) i++;
  const a = path[i - 1];
  const b = path[i];
  const span = Math.max(1e-6, b.distance - a.distance);
  const t = THREE.MathUtils.clamp((distance - a.distance) / span, 0, 1);
  return {
    position: new THREE.Vector3().lerpVectors(a.position, b.position, t),
    tangent: b.tangent.clone(),
    side: b.side.clone(),
    distance,
  };
}

/** Sleeper placements along a path, at the standard pitch. */
export function sleeperPlacements(
  path: TrackPoint[],
  withinOf: THREE.Vector3 | null,
  radiusM: number,
): THREE.Matrix4[] {
  if (path.length < 2) return [];
  const total = path[path.length - 1].distance;
  const out: THREE.Matrix4[] = [];
  const matrix = new THREE.Matrix4();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3(1, 1, 1);
  const position = new THREE.Vector3();

  let index = 1;
  for (let d = 0; d <= total; d += SLEEPER_PITCH_M) {
    while (index < path.length - 1 && path[index].distance < d) index++;
    const a = path[index - 1];
    const b = path[index];
    const span = Math.max(1e-6, b.distance - a.distance);
    const t = THREE.MathUtils.clamp((d - a.distance) / span, 0, 1);
    position.lerpVectors(a.position, b.position, t);
    position.y += BALLAST_UNDER_SLEEPER_M + SLEEPER_DEPTH_M / 2;
    if (withinOf && position.distanceTo(withinOf) > radiusM) continue;
    // the sleeper's own length runs across the track
    quaternion.setFromRotationMatrix(
      new THREE.Matrix4().makeBasis(b.side, UP, new THREE.Vector3().crossVectors(b.side, UP).normalize()),
    );
    out.push(matrix.compose(position, quaternion, scale).clone());
  }
  return out;
}
