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

/**
 * The stage in 緑駅前広場.
 *
 * 国土地理院 gives the outline; that it is a stage, and that the school
 * children's クマゲラ太鼓 was played in front of it at みどりのフェスティバル,
 * is the operator's own testimony. So the outline is survey and the form —
 * a raised deck under a roof on posts, open to the square — is what an
 * outdoor community stage is, not a measurement of this one.
 */
/**
 * 長胴太鼓 on an X-stand.
 *
 * A 二尺 drum: a single hollowed trunk with a belly wider than its heads,
 * hide tacked round each rim, sitting tilted on two crossed timbers so it
 * can be struck standing. The shape is the standard one — no photograph of
 * クマゲラ太鼓's own drums could be found — and the feature that places it
 * says so.
 */
function buildTaiko(
  feature: RealityData,
  tangentPlane: LocalTangentPlane,
  heightAt: (x: number, z: number) => number,
): THREE.Group {
  const group = new THREE.Group();
  group.name = feature.id;
  group.userData.realityData = feature;

  const [lon, lat] = feature.geometry.coordinates as [number, number];
  const local = tangentPlane.project(lat, lon);
  const base = heightAt(local.x, local.z);
  const facing = ((feature.properties.facing_bearing_deg as number | undefined) ?? 0) * (Math.PI / 180);

  const head = ((feature.properties.head_diameter_m as number | undefined) ?? 0.6) / 2;
  const belly = head * 1.20;
  const length = head * 2.35;          // 胴長, a little over one head diameter
  const standHeight = 0.62;

  const bodyMat = new THREE.MeshStandardMaterial({ color: 0x6b3f24, roughness: 0.7 });
  const headMat = new THREE.MeshStandardMaterial({ color: 0xe4d3ac, roughness: 0.85 });
  const tackMat = new THREE.MeshStandardMaterial({ color: 0xb8a271, roughness: 0.45, metalness: 0.6 });
  const standMat = new THREE.MeshStandardMaterial({ color: 0x3a2b1e, roughness: 0.8 });

  // The barrel: a lathe so the belly bulges, rather than a plain cylinder.
  const half = length / 2;
  const points: THREE.Vector2[] = [];
  const steps = 10;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const y = -half + t * length;
    const bulge = Math.sin(t * Math.PI);
    points.push(new THREE.Vector2(head + (belly - head) * bulge, y));
  }
  const barrel = new THREE.Mesh(new THREE.LatheGeometry(points, 20), bodyMat);

  const drum = new THREE.Group();
  drum.add(barrel);
  for (const end of [-1, 1]) {
    const skin = new THREE.Mesh(new THREE.CylinderGeometry(head * 1.04, head * 1.04, 0.03, 20), headMat);
    skin.position.y = end * half;
    drum.add(skin);
    // 鋲: the row of tacks holding the hide to the shell
    const tacks = new THREE.InstancedMesh(
      new THREE.SphereGeometry(0.014, 6, 5), tackMat, 20,
    );
    for (let i = 0; i < 20; i++) {
      const a = (i / 20) * Math.PI * 2;
      tacks.setMatrixAt(i, new THREE.Matrix4().makeTranslation(
        Math.cos(a) * head * 1.01, end * (half - 0.045), Math.sin(a) * head * 1.01,
      ));
    }
    tacks.instanceMatrix.needsUpdate = true;
    drum.add(tacks);
  }
  // Lay it on its side and tilt it back, the way a 斜め台 holds it.
  drum.rotation.z = Math.PI / 2;
  drum.rotation.x = -0.42;
  drum.position.y = standHeight + belly * 0.55;
  drum.castShadow = true;

  const stand = new THREE.Group();
  for (const side of [-1, 1]) {
    for (const lean of [-1, 1]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.055, standHeight + belly * 0.5, 0.055), standMat);
      leg.position.set(side * head * 0.75, (standHeight + belly * 0.5) / 2, lean * head * 0.5);
      leg.rotation.x = lean * 0.28;
      stand.add(leg);
    }
  }

  const whole = new THREE.Group();
  whole.add(stand, drum);
  whole.rotation.y = -facing;
  whole.position.set(local.x, base, local.z);
  whole.traverse((o) => { o.castShadow = true; o.receiveShadow = true; });
  group.add(whole);
  return group;
}

function buildStage(
  feature: RealityData,
  tangentPlane: LocalTangentPlane,
  heightAt: (x: number, z: number) => number,
): THREE.Group {
  const group = new THREE.Group();
  group.name = feature.id;
  group.userData.realityData = feature;

  const ring = (feature.geometry.coordinates[0] as [number, number][]).slice(0, -1);
  const points = ring.map(([lon, lat]) => {
    const local = tangentPlane.project(lat, lon);
    return new THREE.Vector2(local.x, -local.z);
  });
  const centre = points.reduce((acc, p) => acc.add(p), new THREE.Vector2()).divideScalar(points.length);
  const base = heightAt(centre.x, -centre.y);

  const deckHeight = (feature.properties.deck_height_m as number | undefined) ?? 0.9;
  const roofHeight = (feature.properties.roof_height_m as number | undefined) ?? 4.6;
  const facing = ((feature.properties.facing_bearing_deg as number | undefined) ?? 0) * (Math.PI / 180);

  const deckMat = new THREE.MeshStandardMaterial({ color: 0x9d968a, roughness: 0.95 });
  const boardMat = new THREE.MeshStandardMaterial({ color: 0xa8865c, roughness: 0.85 });
  const postMat = new THREE.MeshStandardMaterial({ color: 0x6d6a63, roughness: 0.7, metalness: 0.3 });
  const roofMat = new THREE.MeshStandardMaterial({ color: 0x4a5a63, roughness: 0.5, metalness: 0.3 });
  const wallMat = new THREE.MeshStandardMaterial({ color: 0xd3d0c6, roughness: 0.9 });

  const deck = new THREE.Mesh(wallGeometry(points, deckHeight), deckMat);
  deck.position.set(0, base, 0);
  deck.castShadow = true;
  deck.receiveShadow = true;
  group.add(deck);

  const boards = new THREE.Mesh(flatRoofGeometry(points, 0.06), boardMat);
  boards.position.set(0, base + deckHeight, 0);
  boards.receiveShadow = true;
  group.add(boards);

  // the box the outline sits in, so posts and back wall follow the building
  const box = orientedBox(points);
  const along = new THREE.Vector3(box.axis.x, 0, -box.axis.y);
  const across = new THREE.Vector3(box.axis.y, 0, box.axis.x);
  const worldCentre = new THREE.Vector3(box.centre.x, base, -box.centre.y);
  const at = (u: number, v: number, y: number) => new THREE.Vector3()
    .copy(worldCentre).addScaledVector(along, u).addScaledVector(across, v).setY(base + y);

  // which way is the front: whichever of +across / -across points the way
  // the stage faces
  const front = new THREE.Vector3(Math.sin(facing), 0, -Math.cos(facing));
  const backSign = across.dot(front) > 0 ? -1 : 1;

  for (const u of [-box.halfLong + 0.5, 0, box.halfLong - 0.5]) {
    for (const v of [-box.halfShort + 0.4, box.halfShort - 0.4]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.16, roofHeight - deckHeight, 0.16), postMat);
      post.position.copy(at(u, v, deckHeight + (roofHeight - deckHeight) / 2));
      post.castShadow = true;
      group.add(post);
    }
  }

  const backWall = new THREE.Mesh(
    new THREE.BoxGeometry(box.halfLong * 2, roofHeight - deckHeight, 0.18),
    wallMat,
  );
  backWall.position.copy(at(0, backSign * (box.halfShort - 0.3), deckHeight + (roofHeight - deckHeight) / 2));
  backWall.quaternion.setFromRotationMatrix(
    new THREE.Matrix4().makeBasis(along, new THREE.Vector3(0, 1, 0), across),
  );
  backWall.castShadow = true;
  backWall.receiveShadow = true;
  group.add(backWall);

  const roof = new THREE.Mesh(
    new THREE.BoxGeometry(box.halfLong * 2 + 0.8, 0.22, box.halfShort * 2 + 0.8),
    roofMat,
  );
  roof.position.copy(at(0, 0, roofHeight));
  roof.quaternion.copy(backWall.quaternion);
  roof.castShadow = true;
  group.add(roof);

  return group;
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
      if (type === 'stage') {
        group.add(buildStage(feature, tangentPlane, heightAt));
        continue;
      }
      if (type === 'taiko') {
        group.add(buildTaiko(feature, tangentPlane, heightAt));
        continue;
      }
      if (type !== 'town_building'
        && type !== 'bathhouse' && type !== 'school' && type !== 'school_annex'
        && type !== 'post_office' && type !== 'community_centre'
        && type !== 'police_box' && type !== 'fire_station') continue;
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
