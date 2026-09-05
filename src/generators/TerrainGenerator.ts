import * as THREE from 'three';
import type { HeightFieldSource } from '../loaders/DEMLoader';
import { DEMLoader } from '../loaders/DEMLoader';
import type { LocalTangentPlane } from '../core/Coordinates';

export interface GeneratedTerrain {
  mesh: THREE.Mesh;
  /** Ground height (Three.js Y, meters) at an arbitrary World-local x/z. */
  heightAt(x: number, z: number): number;
}

/**
 * DEM file -> height array -> vertices -> indices -> BufferGeometry -> Mesh.
 * This is the generator's only responsibility; it does not know about roads,
 * railways, or the player.
 *
 * `lod` is accepted but unused today — a single mesh is produced regardless
 * of value. It exists so a future LOD generator can swap in without callers
 * changing: `near`/`far` will eventually select target resolution.
 */
export class TerrainGenerator {
  static generate(
    heightField: HeightFieldSource,
    tangentPlane: LocalTangentPlane,
    _lod: 'near' | 'far' = 'near',
  ): GeneratedTerrain {
    const { cols, rows, bounds } = heightField;
    const vertexCount = cols * rows;
    const positions = new Float32Array(vertexCount * 3);
    const uvs = new Float32Array(vertexCount * 2);

    for (let r = 0; r < rows; r++) {
      const lat = bounds.north - (r / (rows - 1)) * (bounds.north - bounds.south);
      for (let c = 0; c < cols; c++) {
        const lon = bounds.west + (c / (cols - 1)) * (bounds.east - bounds.west);
        const elevation = heightField.heights[r * cols + c];
        const local = tangentPlane.project(lat, lon, elevation);

        const vi = r * cols + c;
        positions[vi * 3 + 0] = local.x;
        positions[vi * 3 + 1] = local.y;
        positions[vi * 3 + 2] = local.z;
        uvs[vi * 2 + 0] = c / (cols - 1);
        uvs[vi * 2 + 1] = r / (rows - 1);
      }
    }

    const indices: number[] = [];
    for (let r = 0; r < rows - 1; r++) {
      for (let c = 0; c < cols - 1; c++) {
        const a = r * cols + c;
        const b = a + 1;
        const cIdx = a + cols;
        const d = cIdx + 1;
        indices.push(a, cIdx, b, b, cIdx, d);
      }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    geometry.computeBoundingBox();

    // Directive 05 Task 1 diagnostic: report what was actually built, not what
    // was assumed. Cheap relative to the rest of generation; left in place.
    {
      let nanCount = 0;
      for (let i = 0; i < positions.length; i++) if (Number.isNaN(positions[i])) nanCount++;
      // eslint-disable-next-line no-console
      console.debug('[TerrainGenerator] vertices=%d indices=%d nanCount=%d bbox=%o', vertexCount, indices.length, nanCount, geometry.boundingBox);
    }

    const material = new THREE.MeshStandardMaterial({
      color: 0x3f4f38,
      flatShading: false,
      roughness: 1,
      metalness: 0,
      // Directive 05: a byte-identical copy of this geometry rendered
      // invisible under the default FrontSide in a different three.js build
      // (r128 UMD, used by the standalone preview artifact) until forced to
      // DoubleSide — confirmed by toggling `side` on the live mesh and
      // diffing screenshots. This repo's own runtime (three r169 via npm)
      // did not reproduce the culling in that same test, but DoubleSide is
      // cheap for a single terrain mesh and removes the failure mode
      // entirely, so it stays on here too as a defensive hedge.
      side: THREE.DoubleSide,
    });

    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'Terrain';
    mesh.receiveShadow = true;

    const heightAt = (x: number, z: number): number => {
      const [lat, lon] = tangentPlane.unproject(x, z);
      return DEMLoader.sample(heightField, lat, lon);
    };

    return { mesh, heightAt };
  }
}
