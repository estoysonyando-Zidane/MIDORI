import * as THREE from 'three';
import type { RealityData } from '../reality/RealityData';
import type { LocalTangentPlane } from '../core/Coordinates';

const DEFAULT_HEIGHT_M = 5;

/**
 * building footprint + estimated height -> simple extruded box mesh.
 * Not an attempt at building appearance — footprint accuracy and
 * approximate massing only, per Directive 01 §15.
 */
export class BuildingGenerator {
  static generate(
    buildingData: RealityData[],
    tangentPlane: LocalTangentPlane,
    heightAt: (x: number, z: number) => number,
  ): THREE.Group {
    const group = new THREE.Group();
    group.name = 'Buildings';

    const material = new THREE.MeshStandardMaterial({ color: 0x8a7f6b, roughness: 0.95 });

    for (const feature of buildingData) {
      if (feature.geometry.type !== 'Polygon') continue;
      const ring = feature.geometry.coordinates[0];
      if (!ring || ring.length < 3) continue;

      // Shape space uses (x, -z) so that, after the rotation below, the
      // extrude depth becomes world Y (up) and shape-Y maps back to +Z.
      const points = ring.map(([lon, lat]) => {
        const local = tangentPlane.project(lat, lon);
        return new THREE.Vector2(local.x, -local.z);
      });

      const shape = new THREE.Shape(points);
      const buildingHeight = (feature.properties.height_m as number | undefined) ?? DEFAULT_HEIGHT_M;
      const geometry = new THREE.ExtrudeGeometry(shape, {
        depth: buildingHeight,
        bevelEnabled: false,
      });
      geometry.rotateX(-Math.PI / 2);

      const centroid = points.reduce((acc, p) => acc.add(p), new THREE.Vector2()).divideScalar(points.length);
      const base = heightAt(centroid.x, -centroid.y);

      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.set(0, base, 0);
      mesh.name = feature.id;
      mesh.userData.realityData = feature;
      group.add(mesh);
    }

    return group;
  }
}
