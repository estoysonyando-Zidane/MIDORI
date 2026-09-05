import * as THREE from 'three';
import type { LocalTangentPlane } from '../core/Coordinates';

/**
 * Shared helper for RoadGenerator/RailwayGenerator: turns a lat/lon
 * LineString into a flat ribbon mesh draped onto terrain height, offset
 * slightly upward to avoid z-fighting with the terrain surface.
 */
export function buildRibbon(
  coordinates: [number, number][],
  tangentPlane: LocalTangentPlane,
  heightAt: (x: number, z: number) => number,
  widthMeters: number,
  liftMeters: number,
): THREE.BufferGeometry {
  const centerline = coordinates.map(([lon, lat]) => {
    const local = tangentPlane.project(lat, lon);
    return new THREE.Vector2(local.x, local.z);
  });

  const positions: number[] = [];
  const indices: number[] = [];
  const half = widthMeters / 2;

  for (let i = 0; i < centerline.length; i++) {
    const p = centerline[i];
    const prev = centerline[Math.max(0, i - 1)];
    const next = centerline[Math.min(centerline.length - 1, i + 1)];
    const dir = new THREE.Vector2().subVectors(next, prev);
    if (dir.lengthSq() === 0) dir.set(1, 0);
    dir.normalize();
    const normal = new THREE.Vector2(-dir.y, dir.x);

    const left = new THREE.Vector2().copy(p).addScaledVector(normal, half);
    const right = new THREE.Vector2().copy(p).addScaledVector(normal, -half);

    const leftY = heightAt(left.x, left.y) + liftMeters;
    const rightY = heightAt(right.x, right.y) + liftMeters;

    positions.push(left.x, leftY, left.y);
    positions.push(right.x, rightY, right.y);
  }

  for (let i = 0; i < centerline.length - 1; i++) {
    const a = i * 2;
    const b = a + 1;
    const c = a + 2;
    const d = a + 3;
    indices.push(a, c, b, b, c, d);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}
