import * as THREE from 'three';
import type { RealityData } from '../reality/RealityData';
import type { LocalTangentPlane } from '../core/Coordinates';
import { buildRibbon } from './ribbon';

const RAILWAY_WIDTH_M = 3; // rough trackbed/ballast width, not a rail-gauge model
const LIFT_M = 0.15;

/**
 * GeoJSON LineString (railway centerline) -> Coordinate Transform ->
 * Line -> Railway Mesh. No rail cross-section or sleeper geometry —
 * position and direction are what Directive 01 requires, nothing more.
 */
export class RailwayGenerator {
  static generate(
    railwayData: RealityData[],
    tangentPlane: LocalTangentPlane,
    heightAt: (x: number, z: number) => number,
  ): THREE.Group {
    const group = new THREE.Group();
    group.name = 'Railway';

    const material = new THREE.MeshStandardMaterial({ color: 0x5a4a3a, roughness: 0.9 });

    for (const feature of railwayData) {
      if (feature.geometry.type !== 'LineString') continue;
      const geometry = buildRibbon(
        feature.geometry.coordinates,
        tangentPlane,
        heightAt,
        RAILWAY_WIDTH_M,
        LIFT_M,
      );
      const mesh = new THREE.Mesh(geometry, material);
      mesh.name = feature.id;
      mesh.userData.realityData = feature;
      group.add(mesh);
    }

    return group;
  }
}
