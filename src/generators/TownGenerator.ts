import * as THREE from 'three';
import type { RealityData } from '../reality/RealityData';
import type { LocalTangentPlane } from '../core/Coordinates';

/**
 * 緑町 — the settlement the station sits in.
 *
 * The footprints are OpenStreetMap outlines imported by
 * scripts/import-osm-town.mjs, so their plan is survey-grade. Everything
 * above the plan is not: OSM carries no height, roof shape or colour for any
 * building here, and those are banded and hashed at import time. This
 * generator's job is to put a roof on each outline so the street reads as
 * the row of low houses with coloured tin roofs that photograph 003 shows,
 * rather than as a field of flat-topped boxes.
 *
 * Two roof shapes, chosen at import: a gable across the footprint's own long
 * axis for simple outlines, and a flat roof with a parapet for articulated
 * ones, where a single ridge would be thrown across wings that do not exist.
 */

/**
 * A wall panel with windows in it, drawn once and tiled over every building.
 *
 * OSM gives outlines and nothing else, so three hundred buildings arrived as
 * three hundred blank boxes — the single thing that most made the settlement
 * read as a diagram of a settlement. This is scenery, not evidence: it says
 * "these are buildings with windows", not "this building has these windows".
 * The proportions are a Hokkaido rural house's — a band of tall sashes above
 * a sill, with the wall's own siding lines across the rest.
 */
function makeWallTexture(): THREE.Texture {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, size, size);

  // horizontal siding lines
  ctx.strokeStyle = 'rgba(0,0,0,0.07)';
  ctx.lineWidth = 1;
  for (let y = 0; y < size; y += 14) {
    ctx.beginPath();
    ctx.moveTo(0, y + 0.5);
    ctx.lineTo(size, y + 0.5);
    ctx.stroke();
  }

  // two windows, sill about a third of the way up the storey
  const sill = Math.round(size * 0.34);
  const head = Math.round(size * 0.72);
  for (const x of [Math.round(size * 0.16), Math.round(size * 0.58)]) {
    const w = Math.round(size * 0.26);
    ctx.fillStyle = '#8d9aa2';
    ctx.fillRect(x - 3, size - head - 3, w + 6, head - sill + 6);
    ctx.fillStyle = '#31414b';
    ctx.fillRect(x, size - head, w, head - sill);
    ctx.fillStyle = 'rgba(255,255,255,0.16)';
    ctx.fillRect(x, size - head, w, Math.round((head - sill) * 0.35));
    ctx.fillStyle = '#8d9aa2';
    ctx.fillRect(x + w / 2 - 1.5, size - head, 3, head - sill);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  return texture;
}

/** Real-world size of one repeat of that panel. */
const WALL_TILE_M = { width: 4.2, height: 3.1 };

interface OrientedBox {
  centre: THREE.Vector2;
  /** Unit vector along the footprint's long axis. */
  axis: THREE.Vector2;
  halfLong: number;
  halfShort: number;
}

/**
 * The minimum-area rectangle enclosing a footprint, by rotating calipers over
 * its own edges: for a building outline the best rectangle always shares an
 * edge direction with the outline, so testing each edge is exact.
 */
function orientedBox(points: THREE.Vector2[]): OrientedBox {
  let best: OrientedBox | null = null;
  let bestArea = Infinity;

  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    const edge = new THREE.Vector2().subVectors(b, a);
    if (edge.lengthSq() < 1e-8) continue;
    edge.normalize();
    const normal = new THREE.Vector2(-edge.y, edge.x);

    let minU = Infinity; let maxU = -Infinity;
    let minV = Infinity; let maxV = -Infinity;
    for (const p of points) {
      const u = p.dot(edge);
      const v = p.dot(normal);
      if (u < minU) minU = u;
      if (u > maxU) maxU = u;
      if (v < minV) minV = v;
      if (v > maxV) maxV = v;
    }
    const width = maxU - minU;
    const depth = maxV - minV;
    const area = width * depth;
    if (area >= bestArea) continue;
    bestArea = area;

    const centre = new THREE.Vector2()
      .addScaledVector(edge, (minU + maxU) / 2)
      .addScaledVector(normal, (minV + maxV) / 2);
    const long = width >= depth;
    best = {
      centre,
      axis: long ? edge.clone() : normal.clone(),
      halfLong: (long ? width : depth) / 2,
      halfShort: (long ? depth : width) / 2,
    };
  }

  if (best) return best;
  // Degenerate outline — fall back to an axis-aligned box so nothing throws.
  const centre = points.reduce((acc, p) => acc.add(p), new THREE.Vector2()).divideScalar(points.length);
  return { centre, axis: new THREE.Vector2(1, 0), halfLong: 1, halfShort: 1 };
}

/** Walls: the footprint extruded from the ground to the eave. */
function wallGeometry(points: THREE.Vector2[], height: number): THREE.BufferGeometry {
  const shape = new THREE.Shape(points);
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: height, bevelEnabled: false });
  geometry.rotateX(-Math.PI / 2);
  return geometry;
}

/**
 * A gable roof over the footprint's oriented box: two sloping planes meeting
 * at a ridge along the long axis, closed by a triangle at each end, with the
 * eaves oversailing the wall.
 */
function gableRoofGeometry(box: OrientedBox, eave: number, ridge: number, overhang: number): THREE.BufferGeometry {
  const halfLong = box.halfLong + overhang;
  const halfShort = box.halfShort + overhang;
  const along = new THREE.Vector3(box.axis.x, 0, box.axis.y);
  const across = new THREE.Vector3(-box.axis.y, 0, box.axis.x);
  const centre = new THREE.Vector3(box.centre.x, 0, box.centre.y);

  const at = (u: number, v: number, y: number) => new THREE.Vector3()
    .copy(centre)
    .addScaledVector(along, u)
    .addScaledVector(across, v)
    .setY(y);

  // eave corners, then the two ridge ends
  const e00 = at(-halfLong, -halfShort, eave);
  const e01 = at(-halfLong, halfShort, eave);
  const e10 = at(halfLong, -halfShort, eave);
  const e11 = at(halfLong, halfShort, eave);
  const r0 = at(-halfLong, 0, ridge);
  const r1 = at(halfLong, 0, ridge);

  const positions: number[] = [];
  const tri = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3) => {
    positions.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
  };
  // two slopes
  tri(e00, e10, r1); tri(e00, r1, r0);
  tri(e11, e01, r0); tri(e11, r0, r1);
  // gable ends
  tri(e00, r0, e01);
  tri(e11, r1, e10);
  // undersides, so the roof is not see-through from below
  tri(e00, e01, e11); tri(e00, e11, e10);

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  return geometry;
}

/** A flat roof: a slab standing slightly proud of the walls. */
function flatRoofGeometry(points: THREE.Vector2[], thickness: number): THREE.BufferGeometry {
  const shape = new THREE.Shape(points);
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: false });
  geometry.rotateX(-Math.PI / 2);
  return geometry;
}

export class TownGenerator {
  static generate(
    features: RealityData[],
    tangentPlane: LocalTangentPlane,
    heightAt: (x: number, z: number) => number,
  ): THREE.Group {
    const group = new THREE.Group();
    group.name = 'Town';

    // Materials are shared by colour so three hundred buildings cost a
    // handful of draw calls' worth of state rather than six hundred.
    const wallMaterials = new Map<string, THREE.Material>();
    const roofMaterials = new Map<string, THREE.Material>();
    const wallTexture = makeWallTexture();
    wallTexture.repeat.set(1 / WALL_TILE_M.width, 1 / WALL_TILE_M.height);
    wallTexture.anisotropy = 8;
    const wallFor = (key: string, colour: number) => {
      let material = wallMaterials.get(key);
      if (!material) {
        material = new THREE.MeshStandardMaterial({ color: colour, roughness: 0.92, map: wallTexture });
        wallMaterials.set(key, material);
      }
      return material;
    };
    const roofFor = (hex: string) => {
      let material = roofMaterials.get(hex);
      if (!material) {
        material = new THREE.MeshStandardMaterial({ color: new THREE.Color(hex), roughness: 0.55, metalness: 0.2 });
        roofMaterials.set(hex, material);
      }
      return material;
    };

    // Siding colours in the settlement: the photographs show pale creams and
    // greys, with the colour carried by the roof rather than the walls.
    const WALL_COLOURS = [0xdcdad2, 0xd6d8d0, 0xcfd2cc, 0xe2ded4];

    for (const feature of features) {
      const type = feature.properties.structure_type as string | undefined;
      if (type !== 'town_building'
        && type !== 'bathhouse' && type !== 'school' && type !== 'post_office'
        && type !== 'community_centre' && type !== 'police_box' && type !== 'fire_station') continue;
      if (feature.geometry.type !== 'Polygon') continue;

      const ring = (feature.geometry.coordinates[0] as [number, number][]).slice(0, -1);
      if (ring.length < 3) continue;
      const points = ring.map(([lon, lat]) => {
        const local = tangentPlane.project(lat, lon);
        // Shape space is (x, -z), matching BuildingGenerator's convention.
        return new THREE.Vector2(local.x, -local.z);
      });

      const eave = (feature.properties.eave_height_m as number | undefined) ?? 3.0;
      const ridge = (feature.properties.ridge_height_m as number | undefined) ?? eave + 1.6;
      const roofHex = (feature.properties.roof_colour as string | undefined) ?? '#6b6f74';
      const shape = (feature.properties.roof_shape as string | undefined) ?? 'gable';

      const centre = points.reduce((acc, p) => acc.add(p), new THREE.Vector2()).divideScalar(points.length);
      const base = heightAt(centre.x, -centre.y);

      const wallIndex = Math.abs(Math.round(centre.x * 7 + centre.y * 13)) % WALL_COLOURS.length;
      const walls = new THREE.Mesh(wallGeometry(points, eave), wallFor(String(wallIndex), WALL_COLOURS[wallIndex]));
      walls.position.set(0, base, 0);
      walls.castShadow = true;
      walls.receiveShadow = true;
      walls.name = feature.id;
      walls.userData.realityData = feature;
      group.add(walls);

      let roof: THREE.Mesh;
      if (shape === 'gable') {
        // The oriented box works in shape space, where y is -z; the roof is
        // built in World XZ, so the axis' second component flips back.
        const box = orientedBox(points);
        const worldBox: OrientedBox = {
          centre: new THREE.Vector2(box.centre.x, -box.centre.y),
          axis: new THREE.Vector2(box.axis.x, -box.axis.y),
          halfLong: box.halfLong,
          halfShort: box.halfShort,
        };
        // The roof's underside sits a few centimetres above the wall's top
        // face rather than exactly on it: coplanar faces z-fight, and over
        // three hundred buildings that reads as stripes across the whole town.
        roof = new THREE.Mesh(gableRoofGeometry(worldBox, eave + 0.04, ridge, 0.4), roofFor(roofHex));
        roof.position.set(0, base, 0);
      } else {
        roof = new THREE.Mesh(flatRoofGeometry(points, 0.35), roofFor(roofHex));
        roof.position.set(0, base + eave - 0.08, 0);
      }
      roof.castShadow = true;
      roof.receiveShadow = true;
      group.add(roof);
    }

    return group;
  }
}
