import * as THREE from 'three';
import type { LocalTangentPlane } from '../core/Coordinates';

/**
 * Permanent way for a JR narrow-gauge local line.
 *
 * The railway used to be a 3 m brown ribbon with a comment admitting it was
 * "no rail cross-section or sleeper geometry". Track is the one thing about
 * this place whose dimensions are not in doubt anywhere — they are national
 * standards, published, and identical from 緑 to anywhere else on the
 * network — so it is the one thing there is no excuse for approximating.
 *
 * 釧網本線 is a 単線・非電化 地方交通線 (乙線). Every figure below is that
 * standard, not a measurement of this particular track:
 *
 *   軌間            1,067 mm   — 内側軌間、レール頭部内面間
 *   レール           50kgN     — 高さ 153 mm、頭部幅 65 mm、底部幅 127 mm
 *   まくらぎ          木まくらぎ並型 2,100 × 240 × 140 mm
 *   まくらぎ配置      39本/25 m (乙線) → 641 mm 間隔
 *   道床厚           200 mm (まくらぎ下)
 *   道床肩幅          400 mm、のり面 1:1.5
 *
 * Everything else in the World is built on top of these: the rail head's
 * height above the formation sets where the platform deck goes and where
 * the railcar's wheels sit, so those follow from one number instead of
 * three independent guesses.
 */

/** 軌間: between the inner faces of the rail heads. */
export const TRACK_GAUGE_M = 1.067;
/** 50kgN rail. */
export const RAIL_HEIGHT_M = 0.153;
export const RAIL_HEAD_WIDTH_M = 0.065;
export const RAIL_FOOT_WIDTH_M = 0.127;
/** Rail centres are the gauge plus one head width apart. */
export const RAIL_CENTRE_OFFSET_M = (TRACK_GAUGE_M + RAIL_HEAD_WIDTH_M) / 2;

/** 木まくらぎ 並型. */
export const SLEEPER_LENGTH_M = 2.1;
export const SLEEPER_WIDTH_M = 0.24;
export const SLEEPER_DEPTH_M = 0.14;
/** 39本/25 m on a 乙線. */
export const SLEEPER_PITCH_M = 25 / 39;

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

/** One rail, as its real cross-section: foot, web and head. */
export function railProfile(centreOffset: number): [number, number][] {
  const base = BALLAST_TOP_M;
  const foot = RAIL_FOOT_WIDTH_M / 2;
  const head = RAIL_HEAD_WIDTH_M / 2;
  const web = 0.016;
  const footTop = base + 0.028;
  const headBottom = base + RAIL_HEIGHT_M - 0.042;
  const o = centreOffset;
  return [
    [o - foot, base],
    [o + foot, base],
    [o + foot, footTop],
    [o + web, footTop + 0.012],
    [o + web, headBottom],
    [o + head, headBottom + 0.010],
    [o + head, base + RAIL_HEIGHT_M],
    [o - head, base + RAIL_HEIGHT_M],
    [o - head, headBottom + 0.010],
    [o - web, headBottom],
    [o - web, footTop + 0.012],
    [o - foot, footTop],
  ];
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
