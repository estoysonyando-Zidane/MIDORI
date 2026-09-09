import * as THREE from 'three';
import type { RealityData } from '../reality/RealityData';
import type { LocalTangentPlane } from '../core/Coordinates';

/**
 * 札弦川 and the pond.
 *
 * There was no water in this World at all. 国土地理院's 水涯線 had been in
 * the imported data since the town arrived and nothing read it.
 *
 * NO CHANNEL IS CUT, AND THAT IS DELIBERATE.
 *
 * A first pass sank the ground along the water's line so the river would sit
 * in a bed. It cannot work and it should not: the terrain mesh has a vertex
 * every 30 m, so a 3.6 m ditch falls between two of them and never appears
 * in the surface — only in the height FUNCTION, which is exactly the split
 * that made the station building float over un-raised ground earlier in this
 * project. The player would have sunk into a field that still looked flat.
 *
 * Widening the dip until the mesh could hold it would mean inventing a
 * thirty-metre valley for a three-metre stream, on a DEM that records no
 * such thing. So the water is laid on the terrain as surveyed, sunk far
 * enough not to z-fight and no further, with a wet fringe at its edge. What
 * is drawn is where the water runs, which is what 国土地理院 measured.
 */

/**
 * The wet fringe drawn just outside the water: gravel and mud, the band that
 * makes an edge read as a bank rather than as a colour change in a field.
 */
const FRINGE_M = 1.6;
/**
 * How far ABOVE the terrain surface the water is laid.
 *
 * This was a sink of 0.18 m, meant to stop the water z-fighting the ground.
 * It buried it: measured against the terrain mesh by raycast, the flat
 * reaches came out 0.15-0.20 m below the surface, which is exactly the
 * amount they were pushed down. The river was drawn correctly and was
 * underground, which from every camera is indistinguishable from not having
 * been drawn at all.
 */
const LIFT_M = 0.06;

function ringToWorld(ring: [number, number][], tangentPlane: LocalTangentPlane): THREE.Vector3[] {
  return ring.map(([lon, lat]) => {
    const local = tangentPlane.project(lat, lon);
    return new THREE.Vector3(local.x, 0, local.z);
  });
}

export class WaterGenerator {
  static generate(
    features: RealityData[],
    tangentPlane: LocalTangentPlane,
    heightAt: (x: number, z: number) => number,
  ): THREE.Group {
    const group = new THREE.Group();
    group.name = 'Water';

    // Standing water in a small river: dark, reflective, not blue. A river
    // in Hokkaido farmland reads as the colour of what is above and behind
    // it, so most of the effect is in the reflection rather than the tint.
    // A first pass used a dark slate blue at 0.86 opacity, which over the
    // orthophoto's dark forest floor was indistinguishable from the ground.
    // A small river under trees is dark, but it is dark AND smooth, and the
    // smoothness is the whole signal: it reads as water because it holds the
    // sky while everything around it does not. So: opaque, very low
    // roughness, and enough environment reflection to carry the sky down
    // into it.
    const material = new THREE.MeshStandardMaterial({
      // Bright enough to hold the sky, dark enough to be a stream in a wood
      // rather than a concrete channel: a first pass at roughness 0.06 came
      // out near-white.
      color: 0x44646c,
      roughness: 0.18,
      metalness: 0.35,
      envMapIntensity: 1.1,
      // The ribbon's triangles are wound from the line's own direction, which
      // flips with the direction the river happens to run: half the reaches
      // were back-facing and culled, and a culled surface is indistinguishable
      // from an undrawn one. A flat sheet has no inside to hide.
      side: THREE.DoubleSide,
    });

    // Wet gravel and mud at the water's edge.
    const fringeMaterial = new THREE.MeshStandardMaterial({
      color: 0x7a7060, roughness: 1, side: THREE.DoubleSide,
    });

    /** Sweeps a flat ribbon of the given half-width along a polyline. */
    const ribbon = (points: THREE.Vector3[], halfWidth: number, lift: number): THREE.BufferGeometry | null => {
      const positions: number[] = [];
      const normals: number[] = [];
      for (let i = 1; i < points.length; i++) {
        const a = points[i - 1];
        const b = points[i];
        const dx = b.x - a.x;
        const dz = b.z - a.z;
        const length = Math.hypot(dx, dz);
        if (length < 1e-4) continue;
        const sx = (-dz / length) * halfWidth;
        const sz = (dx / length) * halfWidth;
        const ay = heightAt(a.x, a.z) + lift;
        const by = heightAt(b.x, b.z) + lift;
        const quad = [
          [a.x - sx, ay, a.z - sz], [b.x - sx, by, b.z - sz], [b.x + sx, by, b.z + sz],
          [a.x - sx, ay, a.z - sz], [b.x + sx, by, b.z + sz], [a.x + sx, ay, a.z + sz],
        ];
        for (const [px, py, pz] of quad) {
          positions.push(px, py, pz);
          normals.push(0, 1, 0);
        }
      }
      if (positions.length === 0) return null;
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
      return geometry;
    };

    for (const feature of features) {
      const lift = LIFT_M;

      if (feature.geometry.type === 'LineString') {
        const points = ringToWorld(feature.geometry.coordinates as [number, number][], tangentPlane);
        if (points.length < 2) continue;
        const halfWidth = ((feature.properties.width_m as number | undefined) ?? 3.6) / 2;

        const fringe = ribbon(points, halfWidth + FRINGE_M, lift * 0.4);
        if (fringe) {
          const bank = new THREE.Mesh(fringe, fringeMaterial);
          bank.name = `${feature.id}_FRINGE`;
          bank.receiveShadow = true;
          group.add(bank);
        }

        const surface = ribbon(points, halfWidth, lift);
        if (!surface) continue;
        const mesh = new THREE.Mesh(surface, material);
        mesh.name = feature.id;
        mesh.userData.realityData = feature;
        mesh.userData.inspect = { kind: 'water' };
        mesh.receiveShadow = true;
        group.add(mesh);
        continue;
      }

      if (feature.geometry.type === 'Polygon') {
        const ring = (feature.geometry.coordinates[0] as [number, number][]).slice(0, -1)
          .map(([lon, lat]) => {
            const local = tangentPlane.project(lat, lon);
            return new THREE.Vector2(local.x, -local.z);
          });
        if (ring.length < 3) continue;
        const shape = new THREE.ShapeGeometry(new THREE.Shape(ring));
        const source = shape.getAttribute('position');
        const positions = new Float32Array(source.count * 3);
        for (let i = 0; i < source.count; i++) {
          const x = source.getX(i);
          const z = -source.getY(i);
          positions[i * 3] = x;
          positions[i * 3 + 1] = heightAt(x, z) + lift;
          positions[i * 3 + 2] = z;
        }
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        if (shape.index) geometry.setIndex(shape.index.clone());
        geometry.computeVertexNormals();
        shape.dispose();
        const mesh = new THREE.Mesh(geometry, material);
        mesh.name = feature.id;
        mesh.userData.realityData = feature;
        mesh.receiveShadow = true;
        group.add(mesh);
      }
    }

    return group;
  }
}
