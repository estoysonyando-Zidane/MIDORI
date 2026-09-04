import * as THREE from 'three';
import type { RealityData } from '../reality/RealityData';
import type { LocalTangentPlane } from '../core/Coordinates';
import { buildRibbon } from './ribbon';

const DEFAULT_ROAD_WIDTH_M = 4;
const LIFT_M = 0.08;

/**
 * road centerline (GeoJSON LineString) -> Mesh. Kept separate from
 * RailwayGenerator, and returns individual named meshes rather than a single
 * merged mesh, because a future Road Network (player/NPC/vehicle navigation)
 * needs per-segment identity, not just a renderable surface.
 */
export class RoadGenerator {
  static generate(
    roadData: RealityData[],
    tangentPlane: LocalTangentPlane,
    heightAt: (x: number, z: number) => number,
  ): THREE.Group {
    const group = new THREE.Group();
    group.name = 'Roads';

    const material = new THREE.MeshStandardMaterial({ color: 0x444444, roughness: 1 });

    for (const feature of roadData) {
      if (feature.geometry.type !== 'LineString') continue;
      const width = (feature.properties.width_m as number | undefined) ?? DEFAULT_ROAD_WIDTH_M;
      const geometry = buildRibbon(feature.geometry.coordinates, tangentPlane, heightAt, width, LIFT_M);
      const mesh = new THREE.Mesh(geometry, material);
      mesh.name = feature.id;
      mesh.userData.realityData = feature;
      group.add(mesh);
    }

    return group;
  }
}
