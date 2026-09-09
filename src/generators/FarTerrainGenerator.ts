import * as THREE from 'three';
import type { LocalTangentPlane } from '../core/Coordinates';

/**
 * The land past the edge of the World.
 *
 * 斜里岳 stands 18 km east of 緑 and 1,547 m up. From the platform it is the
 * eastern skyline. This World's horizon was a flat band of sky, which was
 * the largest single untruth left in it — and the same is true of the hills
 * that close the valley on both sides, of the 摩周 caldera rim to the south,
 * and of 清里の市街 15 km north.
 *
 * None of that should be walkable and none of it is. This is 国土地理院's own
 * elevation at 243 m a sample over a 70 km box, with their seamless aerial
 * photography draped on it: the shape and colour of the land, and nothing
 * else. The detailed World sits inside the hole cut out of its middle.
 *
 * TWO KNOWN ERRORS, both stated rather than hidden:
 *
 * 1. 243 m sampling cannot hold a summit cone. 斜里岳 measures 1,547 m and
 *    this surface reaches 1,477 m at the right place (17.9 km, bearing 73.0°
 *    against the real 17.9 km / 72.7°) — 70 m low, all of it the peak itself.
 * 2. The tangent plane is flat: no curvature drop is applied here, and none
 *    is applied to the near terrain either. Real ground 18 km away sits
 *    about 22 m below the plane once refraction is allowed for, and 96 m at
 *    the 35 km edge.
 *
 * They happen to run the same way for 斜里岳, so correcting only the second
 * would put the silhouette further from the truth, not nearer. Neither is
 * corrected; both are written down.
 */

export interface FarTerrainData {
  bounds: { west: number; east: number; south: number; north: number };
  grid: number;
  photo: string | null;
}

export interface FarTerrainOptions {
  /** Where the detailed terrain already covers, so this leaves a hole. */
  hole: { west: number; east: number; south: number; north: number };
  photoUrl?: string;
  renderer?: THREE.WebGLRenderer;
}

export class FarTerrainGenerator {
  static generate(
    data: FarTerrainData,
    heights: Int16Array,
    tangentPlane: LocalTangentPlane,
    options: FarTerrainOptions,
  ): THREE.Mesh {
    const { grid, bounds } = data;
    const { hole } = options;

    // A vertex per cell, positioned by projecting its lat/lon exactly the way
    // every other feature in the World is projected — so the far ground and
    // the near ground are in the same frame and meet without a step.
    const positions = new Float32Array(grid * grid * 3);
    const uvs = new Float32Array(grid * grid * 2);
    for (let j = 0; j < grid; j++) {
      const lat = bounds.north - ((j + 0.5) / grid) * (bounds.north - bounds.south);
      for (let i = 0; i < grid; i++) {
        const lon = bounds.west + ((i + 0.5) / grid) * (bounds.east - bounds.west);
        const local = tangentPlane.project(lat, lon);
        const k = j * grid + i;
        positions[k * 3] = local.x;
        positions[k * 3 + 1] = heights[k];
        positions[k * 3 + 2] = local.z;
        uvs[k * 2] = (i + 0.5) / grid;
        // texture.flipY is false, so v = 0 is the image's TOP row, which is
        // the box's north edge — the same row order the DEM is written in.
        // Flipping v here as well put the Sea of Okhotsk in the south and
        // the 斜里 plain out at sea.
        uvs[k * 2 + 1] = (j + 0.5) / grid;
      }
    }

    // Triangles, minus the ones over the detailed World. Leaving them in puts
    // a 243 m-sampled surface through the middle of a 30 m one, and the two
    // fight for every pixel of the ground the player is standing on.
    const indices: number[] = [];
    const insideHole = (i: number, j: number): boolean => {
      const lat = bounds.north - ((j + 0.5) / grid) * (bounds.north - bounds.south);
      const lon = bounds.west + ((i + 0.5) / grid) * (bounds.east - bounds.west);
      return lat > hole.south && lat < hole.north && lon > hole.west && lon < hole.east;
    };
    for (let j = 0; j < grid - 1; j++) {
      for (let i = 0; i < grid - 1; i++) {
        if (insideHole(i, j) && insideHole(i + 1, j) && insideHole(i, j + 1) && insideHole(i + 1, j + 1)) {
          continue;
        }
        const a = j * grid + i;
        const b = a + 1;
        const c = a + grid;
        const d = c + 1;
        indices.push(a, c, b, b, c, d);
      }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();

    const material = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1 });
    if (options.photoUrl) {
      const texture = new THREE.TextureLoader().load(options.photoUrl);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.flipY = false;
      if (options.renderer) {
        texture.anisotropy = Math.min(8, options.renderer.capabilities.getMaxAnisotropy());
      }
      material.map = texture;
    }

    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'FarTerrain';
    mesh.receiveShadow = false;
    mesh.castShadow = false;
    // The far ground must never be culled by the near fog's far plane or by
    // frustum bookkeeping: it IS the horizon.
    mesh.frustumCulled = false;
    mesh.renderOrder = -1;
    mesh.userData.inspect = { kind: 'far_terrain' };
    return mesh;
  }
}
