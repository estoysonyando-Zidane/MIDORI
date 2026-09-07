import * as THREE from 'three';

/**
 * The forest around 緑.
 *
 * Every photograph of this place has trees in it — the station sits in a
 * clearing with mixed birch and conifer coming right up to the line, and the
 * hills behind are solid forest. The World had bare green terrain, which is
 * the single largest reason it did not read as a real place.
 *
 * These trees are NOT survey data and are deliberately not Reality Data.
 * That the site is wooded is evidence; where any individual tree stands is
 * not. They are placed by a deterministic scatter so the World looks the
 * same on every load.
 *
 * WHERE the wood is, though, is a measurement: `canopyAt` comes from
 * CanopyMask, which reads the extent off 国土地理院's own photograph. Before
 * that the scatter was a ring around the station that knew nothing about the
 * ground under it, so the treeline — the backdrop of every photograph taken
 * at this station, and what you look at while you wait — fell wherever the
 * random number generator put it, across fields and short of the hillside.
 */

export interface VegetationOptions {
  heightAt: (x: number, z: number) => number;
  /** Centre of the clearing — the station. */
  clearingCentre: THREE.Vector3;
  /** No trees within this radius of the clearing centre. */
  clearingRadiusM: number;
  /** How far out from the centre to plant. */
  extentM: number;
  /** Polylines (railway, roads) to keep clear of, in World XZ. */
  keepClearOf: THREE.Vector3[][];
  keepClearRadiusM: number;
  /** Circles to leave alone — the town's buildings and its open ground.
   *  Trees growing through three hundred houses is the single loudest way to
   *  say "this scatter has never met the settlement it is scattered over". */
  keepClearOfCircles?: { x: number; z: number; radius: number }[];
  /** Where the aerial photograph shows canopy. When given, nothing is
   *  planted outside it, so the treeline is the real one instead of the
   *  edge of a random ring. */
  canopyAt?: (x: number, z: number) => boolean;
  count: number;
}

/** Deterministic scatter, so the forest is the same on every load. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function distanceToPolylines(x: number, z: number, lines: THREE.Vector3[][]): number {
  let best = Infinity;
  for (const line of lines) {
    for (let i = 1; i < line.length; i++) {
      const a = line[i - 1];
      const b = line[i];
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const lengthSq = dx * dx + dz * dz;
      let t = lengthSq > 0 ? ((x - a.x) * dx + (z - a.z) * dz) / lengthSq : 0;
      t = Math.max(0, Math.min(1, t));
      const px = a.x + t * dx;
      const pz = a.z + t * dz;
      const d = Math.hypot(x - px, z - pz);
      if (d < best) best = d;
    }
  }
  return best;
}

/** A conifer: a tapered trunk with two stacked cones. */
function coniferGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const trunk = new THREE.CylinderGeometry(0.11, 0.17, 2.2, 5);
  trunk.translate(0, 1.1, 0);
  const lower = new THREE.ConeGeometry(1.5, 4.2, 7);
  lower.translate(0, 3.9, 0);
  const upper = new THREE.ConeGeometry(0.95, 3.4, 7);
  upper.translate(0, 6.4, 0);
  parts.push(trunk, lower, upper);
  return mergeGeometries(parts);
}

/** A birch: a pale slender trunk with a rounded crown. */
function birchGeometry(): THREE.BufferGeometry {
  const trunk = new THREE.CylinderGeometry(0.09, 0.13, 4.4, 5);
  trunk.translate(0, 2.2, 0);
  const crown = new THREE.SphereGeometry(1.9, 8, 6);
  crown.scale(1, 1.25, 1);
  crown.translate(0, 5.5, 0);
  return mergeGeometries([trunk, crown]);
}

/** Minimal geometry merge — enough for these few static shapes. */
function mergeGeometries(list: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const positions: number[] = [];
  const normals: number[] = [];
  for (const geometry of list) {
    const nonIndexed = geometry.index ? geometry.toNonIndexed() : geometry;
    positions.push(...Array.from(nonIndexed.getAttribute('position').array as Float32Array));
    const normal = nonIndexed.getAttribute('normal');
    if (normal) normals.push(...Array.from(normal.array as Float32Array));
    if (nonIndexed !== geometry) nonIndexed.dispose();
    geometry.dispose();
  }
  const merged = new THREE.BufferGeometry();
  merged.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  if (normals.length === positions.length) {
    merged.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  } else {
    merged.computeVertexNormals();
  }
  return merged;
}

export class VegetationGenerator {
  static generate(options: VegetationOptions): THREE.Group {
    const group = new THREE.Group();
    group.name = 'Vegetation';

    const random = mulberry32(0x9e3779b9);

    // Two crown greens sampled from the photographs: the dark blue-green of
    // the conifers and the lighter yellow-green of the birch in leaf.
    const conifer = new THREE.MeshStandardMaterial({ color: 0x2f4a33, roughness: 0.95 });
    const birch = new THREE.MeshStandardMaterial({ color: 0x5c7a3e, roughness: 0.95 });

    const coniferGeom = coniferGeometry();
    const birchGeom = birchGeometry();

    const placements: { conifer: THREE.Matrix4[]; birch: THREE.Matrix4[] } = { conifer: [], birch: [] };
    const matrix = new THREE.Matrix4();
    const quaternion = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    const position = new THREE.Vector3();

    let attempts = 0;
    while (placements.conifer.length + placements.birch.length < options.count && attempts < options.count * 30) {
      attempts++;
      // Sampling uniformly by AREA (sqrt) spreads a fixed budget of trees
      // evenly and leaves the near wood too thin to read as wood. Sampling
      // uniformly by RADIUS puts density ∝ 1/r: thick where the player
      // stands, thinning with distance, where the photograph on the terrain
      // carries the colour anyway.
      const angle = random() * Math.PI * 2;
      const radius = options.clearingRadiusM + random() * (options.extentM - options.clearingRadiusM);
      const x = options.clearingCentre.x + Math.cos(angle) * radius;
      const z = options.clearingCentre.z + Math.sin(angle) * radius;

      // The photograph decides first: it already knows the fields, the
      // lineside, the yard and the streets are not wooded.
      if (options.canopyAt && !options.canopyAt(x, z)) continue;
      if (distanceToPolylines(x, z, options.keepClearOf) < options.keepClearRadiusM) continue;
      if (options.keepClearOfCircles?.some((c) => Math.hypot(x - c.x, z - c.z) < c.radius)) continue;

      const y = options.heightAt(x, z);
      position.set(x, y, z);
      quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), random() * Math.PI * 2);
      const s = 0.75 + random() * 0.6;
      scale.set(s, s * (0.85 + random() * 0.4), s);
      matrix.compose(position, quaternion, scale);

      // conifers dominate on the slopes, birch closer in
      const isConifer = random() < 0.55 + 0.3 * (radius / options.extentM);
      (isConifer ? placements.conifer : placements.birch).push(matrix.clone());
    }

    for (const [geometry, material, list] of [
      [coniferGeom, conifer, placements.conifer],
      [birchGeom, birch, placements.birch],
    ] as [THREE.BufferGeometry, THREE.Material, THREE.Matrix4[]][]) {
      if (list.length === 0) continue;
      const mesh = new THREE.InstancedMesh(geometry, material, list.length);
      list.forEach((m, i) => mesh.setMatrixAt(i, m));
      mesh.instanceMatrix.needsUpdate = true;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      // the scatter is fixed, so three never needs to re-derive its bounds
      mesh.frustumCulled = false;
      group.add(mesh);
    }

    return group;
  }
}
