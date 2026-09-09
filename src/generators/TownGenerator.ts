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
 * The banner that hangs on the front of each drum stand: white cloth with
 * 「クマゲラ太鼓」 down it in vermilion. It is the one thing in the
 * photograph that names the group, so it is what makes the row read as
 * クマゲラ太鼓 rather than as generic drums.
 */
function makeTaikoBannerTexture(): THREE.CanvasTexture {
  const width = 128;
  const height = 512;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#f6f3ec';
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = '#c0332a';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = '700 62px "Hiragino Sans", "Noto Sans JP", sans-serif';
  const glyphs = ['ク', 'マ', 'ゲ', 'ラ', '太', '鼓'];
  glyphs.forEach((g, i) => {
    ctx.fillText(g, width / 2, height * 0.13 + (i * height * 0.145));
  });
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/**
 * クマゲラ太鼓 の太鼓。
 *
 * A first pass built a 長胴太鼓 — a barrel with hide tacked over both ends —
 * because that is what a taiko is if you have never seen this group's. A
 * photograph of them playing (SRC_KUMAGERA_PHOTO) shows something else: a
 * hollowed log lying on its side, open to the audience so you look straight
 * into the bore, with the head on the far end where the player stands. The
 * stands are vermilion X-frames and each carries a white banner down its
 * front with the group's name on it. 清里町 is a forestry town and these
 * read as locally made.
 *
 * The photograph shows children playing them. No person is modelled here or
 * anywhere in this World.
 */
function buildTaiko(
  feature: RealityData,
  tangentPlane: LocalTangentPlane,
  heightAt: (x: number, z: number) => number,
  bannerTexture: THREE.Texture,
): THREE.Group {
  const group = new THREE.Group();
  group.name = feature.id;
  group.userData.realityData = feature;

  const [lon, lat] = feature.geometry.coordinates as [number, number];
  const local = tangentPlane.project(lat, lon);
  const base = heightAt(local.x, local.z);
  const facing = ((feature.properties.facing_bearing_deg as number | undefined) ?? 0) * (Math.PI / 180);

  const bore = ((feature.properties.bore_diameter_m as number | undefined) ?? 0.50) / 2;
  const wall = 0.07;
  const outer = bore + wall;
  const length = (feature.properties.shell_length_m as number | undefined) ?? 0.92;
  const axisHeight = 0.82;

  const woodMat = new THREE.MeshStandardMaterial({ color: 0xc9ab7f, roughness: 0.85 });
  const innerMat = new THREE.MeshStandardMaterial({ color: 0x6d5334, roughness: 1, side: THREE.BackSide });
  const headMat = new THREE.MeshStandardMaterial({ color: 0xe6d6b0, roughness: 0.85 });
  const standMat = new THREE.MeshStandardMaterial({ color: 0xb03a2a, roughness: 0.65 });

  const drum = new THREE.Group();
  // shell, open at the audience end
  const shell = new THREE.Mesh(new THREE.CylinderGeometry(outer, outer * 0.97, length, 22, 1, true), woodMat);
  drum.add(shell);
  const boreWall = new THREE.Mesh(new THREE.CylinderGeometry(bore, bore * 0.97, length, 22, 1, true), innerMat);
  drum.add(boreWall);
  // the thick rim you see end-on
  const rim = new THREE.Mesh(new THREE.RingGeometry(bore, outer, 22), woodMat);
  rim.rotation.x = -Math.PI / 2;
  rim.position.y = length / 2;
  rim.material.side = THREE.DoubleSide;
  drum.add(rim);
  // the head, at the far end where the player stands
  const head = new THREE.Mesh(new THREE.CircleGeometry(outer * 1.02, 22), headMat);
  head.rotation.x = Math.PI / 2;
  head.position.y = -length / 2;
  head.material.side = THREE.DoubleSide;
  drum.add(head);

  // Lay it down so the bore faces the way the row faces.
  drum.rotation.x = Math.PI / 2;
  drum.position.y = axisHeight;

  // The X-stand: two crossed legs each side, plus a foot rail.
  const stand = new THREE.Group();
  for (const side of [-1, 1]) {
    for (const lean of [-1, 1]) {
      // The X tops out just under the drum's belly — run the legs past it
      // and they show through the open bore, which the drum's whole point is
      // that you can see down.
      const legLength = axisHeight - outer * 0.55;
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.06, legLength * 1.12, 0.06), standMat);
      leg.position.set(side * outer * 0.62, legLength * 0.5, 0);
      leg.rotation.x = lean * 0.42;
      stand.add(leg);
    }
    const foot = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, length * 1.15), standMat);
    foot.position.set(side * outer * 0.62, 0.03, 0);
    stand.add(foot);
  }
  const brace = new THREE.Mesh(new THREE.BoxGeometry(outer * 1.24, 0.055, 0.055), standMat);
  brace.position.set(0, (axisHeight - outer * 0.55) * 0.55, 0);
  stand.add(brace);

  // The banner, hanging on the audience side of the stand.
  // It hangs below the drum, clear of the bore — put it level with the axis
  // and it sits across the mouth, which is the one part of the drum the
  // photograph is emphatic about.
  const banner = new THREE.Mesh(
    new THREE.PlaneGeometry(0.26, 0.54),
    new THREE.MeshStandardMaterial({ map: bannerTexture, roughness: 0.95, side: THREE.DoubleSide }),
  );
  banner.position.set(0, 0.28, length * 0.56);
  stand.add(banner);

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

    let taikoBanner: THREE.Texture | undefined;
    for (const feature of features) {
      const type = feature.properties.structure_type as string | undefined;
      if (type === 'stage') {
        group.add(buildStage(feature, tangentPlane, heightAt));
        continue;
      }
      if (type === 'taiko') {
        taikoBanner ??= makeTaikoBannerTexture();
        group.add(buildTaiko(feature, tangentPlane, heightAt, taikoBanner));
        continue;
      }
      if (type === 'signal') {
        group.add(buildSignal(feature, tangentPlane, heightAt));
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

      // Most of the town has no photograph, so its walls come from a hash of
      // position over the pale sidings the photographs of 緑町 do show. Where
      // a building HAS been photographed, its own colour is recorded on the
      // feature and used instead — the hash is a stand-in for evidence, not a
      // thing to override evidence.
      const wallHex = feature.properties.wall_colour as string | undefined;
      const wallIndex = Math.abs(Math.round(centre.x * 7 + centre.y * 13)) % WALL_COLOURS.length;
      const wallMaterial = wallHex
        ? wallFor(wallHex, new THREE.Color(wallHex).getHex())
        : wallFor(String(wallIndex), WALL_COLOURS[wallIndex]);
      const walls = new THREE.Mesh(wallGeometry(points, eave), wallMaterial);
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

/* ------------------------------------------------------------------ *
 * 常置信号機 — the colour-light signals in the station yard.
 * ------------------------------------------------------------------ */

/** 省令解釈基準 Ⅶ-2 第55条関係 1(1) 備考3: 灯の直径は100ミリメートル以上. The
 *  floor is what is modelled; the real lens at 緑 was not measured. */
const SIGNAL_LAMP_DIAMETER_M = 0.10;
/** 同 備考4: 灯の中心間隔は200ミリメートル以上. Again the floor. */
const SIGNAL_LAMP_PITCH_M = 0.20;
/** The 背板 in the same figure is a stadium — straight sides, semicircular
 *  ends — with the lamps in one vertical column down its middle. */
const SIGNAL_BOARD_WIDTH_M = 0.44;
const SIGNAL_BOARD_DEPTH_M = 0.09;
/** Head height above the rail, and mast diameter.
 *
 *  4.05 m is read off the two 2018 photographs, where a signal beside the
 *  track stands about a railcar's height above it and the mast is a slim
 *  steel tube. That is fine BESIDE the track and wrong OVER it: 第64条 第4図
 *  puts the 車両限界 at 4,100 mm high and 3,000 mm wide, so a head hung
 *  1.2 m from the track centre at 4.05 m is inside the space a train
 *  occupies — the roof corner would take it off. 第20条(1)(2) permits a
 *  signal inside the 建築限界's 基礎限界 precisely because it is 車両の走行に
 *  必要なもの, but only 「車両の走行の安全を支障するおそれがない」 もの, which
 *  a head a train would strike is not.
 *
 *  So a bracket head is carried at 4.75 m: the board's underside then sits
 *  at 4.33 m, 230 mm clear of the 車両限界. `head_height_m` on the feature
 *  chooses; anything beside the track keeps the photographed 4.05 m. */
const SIGNAL_HEAD_CENTRE_M = 4.05;
const SIGNAL_MAST_DIAMETER_M = 0.165;
/** 第55条 1(10): 色灯式信号機及び灯列式信号機の背板の正面は、黒色とすること。 */
const SIGNAL_BOARD_FRONT = 0x14161a;
/** The back of the head and its snow hoods. Measured off the two 2018
 *  photographs, where every signal's back is the same weathered rust
 *  orange: rgb(155-180, 95-105, 80-90). */
const SIGNAL_BOARD_BACK = 0x9c5c4a;
const SIGNAL_STEEL = 0x9aa0a6;

/**
 * One 三位式色灯信号機: mast, optional cantilever arm, and a head carrying
 * green over yellow over red, in that order down the board, as 第55条関係
 * 1(1) の図 draws it.
 *
 * Every signal in this World stands at 停止 — the aspect a signal rests at
 * when no route is set, and the only one that can be shown without claiming
 * to know what was on the line at 10:30 on 2010-05-30. Nothing here is wired
 * to the train that runs through.
 */
function buildSignal(
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
  group.position.set(local.x, base, local.z);

  // `facing_bearing_deg` is the way the LAMPS look — back down the track at
  // the train that has to read them, so it is the reverse of that train's
  // direction of travel. `arm_length_m` is how far the head hangs out from
  // the mast, signed: positive is to the head's own left — left as the LAMPS
  // look, which is the reverse of the left of the train that reads them.
  //
  // The convention this file already uses for facing_bearing_deg (buildTaiko,
  // buildStage) is that local −Z points along the bearing once the group is
  // turned by −facing. So the extruded board needs no turn of its own: its
  // front face sits at z = 0 and looks down −Z.
  const facing = ((feature.properties.facing_bearing_deg as number) ?? 0) * (Math.PI / 180);
  const arm = (feature.properties.arm_length_m as number) ?? 0;
  group.rotation.y = -facing;

  const steel = new THREE.MeshStandardMaterial({ color: SIGNAL_STEEL, roughness: 0.7, metalness: 0.5 });
  const headCentre = (feature.properties.head_height_m as number | undefined) ?? SIGNAL_HEAD_CENTRE_M;
  const boardTop = headCentre + SIGNAL_BOARD_WIDTH_M / 2 + SIGNAL_LAMP_PITCH_M;

  const mast = new THREE.Mesh(
    new THREE.CylinderGeometry(SIGNAL_MAST_DIAMETER_M / 2, SIGNAL_MAST_DIAMETER_M / 2, boardTop, 10),
    steel,
  );
  mast.position.y = boardTop / 2;
  mast.castShadow = true;
  group.add(mast);

  // The arm runs from the mast to the head. Local +X is the head's right, so
  // a positive arm — the head to the mast's left — puts the head at −X.
  if (Math.abs(arm) > 0.05) {
    const beam = new THREE.Mesh(new THREE.BoxGeometry(Math.abs(arm), 0.12, 0.12), steel);
    beam.position.set(-arm / 2, boardTop - 0.1, 0);
    group.add(beam);
  }
  const headX = Math.abs(arm) > 0.05 ? -arm : 0;

  const boardShape = new THREE.Shape();
  const r = SIGNAL_BOARD_WIDTH_M / 2;
  const straight = SIGNAL_LAMP_PITCH_M;               // half the lamp column
  boardShape.absarc(0, straight, r, 0, Math.PI, false);
  boardShape.absarc(0, -straight, r, Math.PI, 2 * Math.PI, false);
  boardShape.closePath();
  const boardGeom = new THREE.ExtrudeGeometry(boardShape, {
    depth: SIGNAL_BOARD_DEPTH_M, bevelEnabled: false, curveSegments: 10,
  });
  const board = new THREE.Mesh(
    boardGeom,
    new THREE.MeshStandardMaterial({ color: SIGNAL_BOARD_FRONT, roughness: 0.85 }),
  );
  board.position.set(headX, headCentre, 0);
  board.castShadow = true;
  group.add(board);

  // the hooded back, so the signal reads as rust orange from behind — which
  // is how it is seen from the platform in both photographs
  const backing = new THREE.Mesh(
    new THREE.BoxGeometry(SIGNAL_BOARD_WIDTH_M, SIGNAL_BOARD_WIDTH_M + 2 * straight, 0.05),
    new THREE.MeshStandardMaterial({ color: SIGNAL_BOARD_BACK, roughness: 0.9 }),
  );
  backing.position.set(headX, headCentre, SIGNAL_BOARD_DEPTH_M + 0.025);
  group.add(backing);

  // green over yellow over red, the order in the figure. Only the red is
  // alight: a signal with no route set shows 停止.
  const aspects: Array<[number, number, boolean]> = [
    [SIGNAL_LAMP_PITCH_M, 0x2f7a3a, false],
    [0, 0x8a6a1e, false],
    [-SIGNAL_LAMP_PITCH_M, 0xd6402c, true],
  ];
  for (const [dy, colour, lit] of aspects) {
    const lens = new THREE.Mesh(
      new THREE.CylinderGeometry(SIGNAL_LAMP_DIAMETER_M / 2, SIGNAL_LAMP_DIAMETER_M / 2, 0.03, 12),
      new THREE.MeshStandardMaterial({
        color: colour,
        emissive: lit ? colour : 0x000000,
        emissiveIntensity: lit ? 1.4 : 0,
        roughness: 0.35,
      }),
    );
    lens.rotation.x = Math.PI / 2;
    lens.position.set(headX, headCentre + dy, -0.02);
    group.add(lens);
    // the hood over each lamp, open toward the driver
    const hood = new THREE.Mesh(
      new THREE.CylinderGeometry(SIGNAL_LAMP_DIAMETER_M * 0.62, SIGNAL_LAMP_DIAMETER_M * 0.62, 0.13, 12, 1, true),
      new THREE.MeshStandardMaterial({ color: SIGNAL_BOARD_BACK, roughness: 0.9, side: THREE.DoubleSide }),
    );
    hood.rotation.x = Math.PI / 2;
    hood.position.set(headX, headCentre + dy + 0.015, -0.09);
    group.add(hood);
  }

  return group;
}
