import * as THREE from 'three';
import type { HeightFieldSource } from '../loaders/DEMLoader';
import { DEMLoader } from '../loaders/DEMLoader';
import type { LocalTangentPlane } from '../core/Coordinates';

/**
 * A high-frequency detail pattern, multiplied over the aerial photograph so
 * the ground still has grain when the player is standing on it.
 *
 * At 2.4 m per pixel the photograph is right about where every field, track
 * and tree line is, and useless at arm's length — from eye height it is a
 * soft blur. This is what a metre of ground looks like: no colour of its
 * own, just light and shade, so it darkens and lifts the photograph's own
 * colours instead of replacing them.
 */
function makeGroundDetail(): THREE.Texture {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const image = ctx.createImageData(size, size);

  // value noise at three octaves, wrapped so the tile repeats seamlessly
  const lattice: number[][] = [];
  for (let o = 0; o < 3; o++) {
    const n = 4 << o;
    const grid: number[] = [];
    let seed = 0x9e3779b9 + o * 0x85ebca6b;
    for (let i = 0; i < n * n; i++) {
      seed = (Math.imul(seed ^ (seed >>> 15), seed | 1) + 0x6d2b79f5) >>> 0;
      grid.push(((seed >>> 8) & 0xffff) / 0xffff);
    }
    lattice.push(grid);
  }
  const sample = (o: number, u: number, v: number) => {
    const n = 4 << o;
    const grid = lattice[o];
    const x = u * n;
    const y = v * n;
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const fx = x - xi;
    const fy = y - yi;
    const sx = fx * fx * (3 - 2 * fx);
    const sy = fy * fy * (3 - 2 * fy);
    const at = (a: number, b: number) => grid[(((b % n) + n) % n) * n + (((a % n) + n) % n)];
    const top = at(xi, yi) * (1 - sx) + at(xi + 1, yi) * sx;
    const bottom = at(xi, yi + 1) * (1 - sx) + at(xi + 1, yi + 1) * sx;
    return top * (1 - sy) + bottom * sy;
  };

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const v = y / size;
      const n = sample(0, u, v) * 0.5 + sample(1, u, v) * 0.32 + sample(2, u, v) * 0.18;
      // centred on mid grey so the multiply neither darkens nor lifts overall
      const value = Math.round(150 + (n - 0.5) * 150);
      const i = (y * size + x) * 4;
      image.data[i] = value;
      image.data[i + 1] = value;
      image.data[i + 2] = value;
      image.data[i + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  return texture;
}

export interface TerrainOptions {
  /** URL of the aerial photograph covering exactly the DEM's bounds. */
  orthophotoUrl?: string;
  renderer?: THREE.WebGLRenderer;
}

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
    options: TerrainOptions = {},
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
    });

    if (options.orthophotoUrl) {
      // The mesh's UVs already run 0..1 across the DEM's bounds and the
      // photograph is resampled onto exactly those bounds, so it needs no
      // mapping of its own — only flipY off, because v = 0 is the DEM's
      // north edge and that is the image's first row, not its last.
      const photo = new THREE.TextureLoader().load(options.orthophotoUrl);
      photo.colorSpace = THREE.SRGBColorSpace;
      photo.flipY = false;
      photo.wrapS = THREE.ClampToEdgeWrapping;
      photo.wrapT = THREE.ClampToEdgeWrapping;
      if (options.renderer) photo.anisotropy = options.renderer.capabilities.getMaxAnisotropy();
      material.map = photo;
      material.color.setRGB(1, 1, 1);

      const detail = makeGroundDetail();
      if (options.renderer) detail.anisotropy = options.renderer.capabilities.getMaxAnisotropy();
      // The detail is addressed in metres off the vertex position rather than
      // by multiplying the terrain's 0..1 UV by a few thousand: at that
      // magnitude the fractional part is what carries the pattern, and it is
      // the first thing float precision loses.
      material.onBeforeCompile = (shader) => {
        shader.uniforms.detailMap = { value: detail };
        shader.vertexShader = shader.vertexShader
          .replace('#include <common>', `#include <common>
            varying vec2 vDetailUv;`)
          .replace('#include <begin_vertex>', `#include <begin_vertex>
            vDetailUv = position.xz;`);
        shader.fragmentShader = shader.fragmentShader
          .replace('#include <common>', `#include <common>
            uniform sampler2D detailMap;
            varying vec2 vDetailUv;`)
          .replace('#include <map_fragment>', `#include <map_fragment>
            {
              float dist = length(vViewPosition);
              // two octaves an octave and a half apart, so the tile never
              // announces itself at any one distance
              // one repeat per 1.2 m up close, per 5 m further out
              float fine = texture2D(detailMap, vDetailUv / 1.2).r;
              float coarse = texture2D(detailMap, vDetailUv / 5.0).r;
              float grain = mix(coarse, fine, 1.0 - smoothstep(8.0, 90.0, dist));
              float near = 1.0 - smoothstep(40.0, 500.0, dist);
              diffuseColor.rgb *= mix(1.0, 0.45 + grain * 1.25, 0.8 * near);
            }`);
      };
      // a material whose shader is patched needs a distinct cache key or
      // three reuses the unpatched program for it
      material.customProgramCacheKey = () => 'terrain-orthophoto-detail';
    }

    const mesh = new THREE.Mesh(geometry, material);
    mesh.receiveShadow = true;
    mesh.name = 'Terrain';
    mesh.receiveShadow = true;

    const heightAt = (x: number, z: number): number => {
      const [lat, lon] = tangentPlane.unproject(x, z);
      return DEMLoader.sample(heightField, lat, lon);
    };

    return { mesh, heightAt };
  }
}
