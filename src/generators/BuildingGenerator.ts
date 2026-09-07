import * as THREE from 'three';
import type { RealityData } from '../reality/RealityData';
import type { LocalTangentPlane } from '../core/Coordinates';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { makeLabelTexture, makeMuralTexture, makeStationNameboardTexture } from './stationGeometry';
import { blockerFromLocalBox } from '../player/Collision';
import { applyStationTextures } from './stationTextures';
import type { StationTextureSet } from './stationTextures';
import { RAIL_HEAD_M } from './TrackGeometry';

const DEFAULT_HEIGHT_M = 5;

/**
 * Platform deck above the rail head. 旧国鉄以来の地方交通線の低いホームで、
 * 緑駅の写真でも車両の床より明らかに低く、乗降にステップを使っている。
 */
export const PLATFORM_ABOVE_RAIL_M = 0.76;

/**
 * How high the station terrace stands above the formation the track is laid
 * on.
 *
 * In every photograph of 緑駅 the plaza, the station floor and the platform
 * deck are all one level, and the track is below, retained by the sheet
 * piling along the platform's face. The DEM is a 10 m grid and has no such
 * step in it, so the terrace is applied here.
 *
 * It is no longer a round number chosen to look right: it is the rail head's
 * own height above the formation — ballast, sleeper and rail, all national
 * standards, see TrackGeometry.ts — plus the platform's height above the
 * rail. The platform, the station floor and the railcar's wheels now all
 * follow from the same figure instead of three independent guesses.
 */
export const STATION_TERRACE_HEIGHT_M = RAIL_HEAD_M + PLATFORM_ABOVE_RAIL_M;

/** Directive 08 §4.3: colors for the small fixed-shape structures that
 * aren't plain building boxes. Anything not listed keeps the original
 * generic building color. */
/** Handled by TownGenerator, not by the generic box path below. */
const TOWN_STRUCTURE_TYPES = new Set([
  'town_building', 'bathhouse', 'school', 'post_office',
  'community_centre', 'police_box', 'fire_station', 'stage',
]);

/** Flat ground surfaces: school grounds, the sports field, the park golf
 *  course on the station forecourt. Drawn as a thin slab on the terrain. */
const SURFACE_STRUCTURE_TYPES = new Set([
  'school_grounds', 'sports_ground', 'park_golf', 'station_square',
]);

const STRUCTURE_COLORS: Record<string, number> = {
  container: 0x2f5a3a,
  level_crossing: 0x4a3b2a,
  // The forecourt really is painted green — photographs 001, 011, 016, 028,
  // 032 and 033 all show green-painted asphalt, worn through to grey in the
  // middle where the cars turn. An earlier pass here changed it to gravel on
  // the strength of the platform-side photographs, which is the wrong side of
  // the building: the gravel is behind, on the platform.
  plaza_pavement: 0x5c7d6e,
};

function projectRing(
  ring: [number, number][],
  tangentPlane: LocalTangentPlane,
): THREE.Vector2[] {
  // Shape space uses (x, -z) so that, after the rotation below, the
  // extrude depth becomes world Y (up) and shape-Y maps back to +Z.
  return ring.map(([lon, lat]) => {
    const local = tangentPlane.project(lat, lon);
    return new THREE.Vector2(local.x, -local.z);
  });
}

function extrudeFootprint(points: THREE.Vector2[], height: number, holePoints?: THREE.Vector2[]): THREE.BufferGeometry {
  const shape = new THREE.Shape(points);
  if (holePoints) shape.holes.push(new THREE.Path(holePoints));
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: height, bevelEnabled: false });
  geometry.rotateX(-Math.PI / 2);
  return geometry;
}

function centroidOf(points: THREE.Vector2[]): THREE.Vector2 {
  return points.reduce((acc, p) => acc.add(p), new THREE.Vector2()).divideScalar(points.length);
}

/**
 * Shrinks a (possibly rotated) quadrilateral inward by `trim` meters on
 * every edge, for the platform's painted edge stripe (Directive 08 §4.2).
 * Works for any parallelogram, not just axis-aligned ones, by decomposing
 * each corner into its own local u/v components before shrinking them.
 */
function insetQuad(points: THREE.Vector2[], trim: number): THREE.Vector2[] {
  const center = centroidOf(points);
  const uAxis = new THREE.Vector2().subVectors(points[1], points[0]).normalize();
  const vAxis = new THREE.Vector2().subVectors(points[3], points[0]).normalize();
  return points.map((p) => {
    const rel = new THREE.Vector2().subVectors(p, center);
    const u = rel.dot(uAxis);
    const v = rel.dot(vAxis);
    const newU = u - Math.sign(u) * trim;
    const newV = v - Math.sign(v) * trim;
    return new THREE.Vector2()
      .addScaledVector(uAxis, newU)
      .addScaledVector(vAxis, newV)
      .add(center);
  });
}

/**
 * JR Hokkaido only began numbering stations (緑 = B67) in the second half of
 * the 2010s, so the nameboard carries no number in the World's 2010 target
 * year. Flip this together with the roof era in
 * scripts/blender/build_station.py when moving the World to a later date.
 */
const NAMEBOARD_WITH_NUMBER = false;

/** Directive 09.1/10: a live position resolved from the Spatial Index —
 * never a coordinate baked into Reality Data for this feature. */
export interface ResolvedPosition {
  lat: number;
  lon: number;
  /** Compass bearing (degrees, clockwise from north) the building's front
   * (porch/entrance) faces. */
  facadeBearingDeg: number;
}

/**
 * Directive 11 §4: the station building's solid form is no longer generated
 * here. It is loaded from `modelUrl` — a Blender-authored glTF asset built
 * by scripts/blender/build_station.py straight from spec v1.2's dimensions,
 * so the shape lives in an engine-neutral format rather than in this
 * renderer's code.
 *
 * What this function still builds are the planar elements Directive 11 §3.5
 * keeps on the Three.js side: the windows, the "みどり" signboards, the
 * "緑　駅" lettering, the mural band, the platform nameboard and the
 * entrance door. All of them are textured plane polygons, not solid form.
 *
 * Position and orientation come from `position` (resolved by the caller from
 * the Spatial Index entity JP.01.546.MIDORI/STATION_BUILDING — see main.ts),
 * never from `feature.geometry`, which this function does not read at all.
 * The GLB's origin is the centre of the building's ground contact plane and
 * its axes match this group's, so it needs no transform of its own.
 */
async function buildStationBuilding(
  feature: RealityData,
  position: ResolvedPosition,
  tangentPlane: LocalTangentPlane,
  heightAt: (x: number, z: number) => number,
  modelUrl: string,
  textures: StationTextureSet | null,
): Promise<THREE.Group> {
  const local = tangentPlane.project(position.lat, position.lon);
  const bearingRad = (position.facadeBearingDeg * Math.PI) / 180;
  // forward = the direction the front (porch) faces, in World XZ.
  // right×up=forward with up=(0,1,0) gives right=(forward.z,0,-forward.x)
  // — see Directive 10 session notes for the derivation (cross-checked
  // numerically against Directive 08's original hand-built basis).
  const forward = new THREE.Vector3(Math.sin(bearingRad), 0, -Math.cos(bearingRad));
  const right = new THREE.Vector3(forward.z, 0, -forward.x);
  // The station stands on the terrace, level with the platform deck, not on
  // the trackbed — see STATION_TERRACE_HEIGHT_M.
  const baseY = heightAt(local.x, local.z) + STATION_TERRACE_HEIGHT_M;

  // The solid form's dimensions now live in the Blender script and the GLB
  // it produces. What is still read here are the dimensions the planar
  // elements below are positioned against — they have to agree with the
  // model, so they come from the same Reality Data values the Blender
  // script's constants were taken from.
  const props = feature.properties as Record<string, number>;
  const width = props.width_m ?? 7.4;
  const depth = props.depth_m ?? 6.0;
  const porchBaseH = props.porch_base_height_m ?? 2.5;
  const porchApex = props.porch_apex_height_m ?? 5.0;
  const porchDepth = props.porch_depth_m ?? 1.0;
  const foundationRise = props.foundation_rise_m ?? 0.3;
  const doorHeight = props.door_height_m ?? 2.16;
  const doorWidth = props.door_width_m ?? 1.6;
  const wallThickness = props.wall_thickness_m ?? 0.15;
  // The entrance is off the building's centreline — see the Blender script.
  const doorCentreX = props.door_centre_x_m ?? 1.155;

  const group = new THREE.Group();
  group.name = feature.id;
  group.userData.realityData = feature;
  group.position.set(local.x, baseY, local.z);
  group.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(right, new THREE.Vector3(0, 1, 0), forward));

  const doorMat = new THREE.MeshStandardMaterial({
    color: 0xbfd6dc, metalness: 0.3, roughness: 0.2, transparent: true, opacity: 0.75, side: THREE.DoubleSide,
  });
  // Windows (spec v1.2 §4.6) must read as distinct glass, not signage, and
  // not blend into the wall — cycle 1 QA found the previous pale/low-opacity
  // tint hard to tell apart from the cream wall at a distance, so this is a
  // more saturated blue at higher opacity (still transparent/glass-like,
  // same role, not a new element).
  const windowMat = new THREE.MeshStandardMaterial({
    color: 0x5f93ab, metalness: 0.25, roughness: 0.15, transparent: true, opacity: 0.72, side: THREE.DoubleSide,
  });

  const halfW = width / 2;
  const halfD = depth / 2;

  // Directive 11 §4: the solid form — foundation, walls, main roof,
  // triangular porch and its trim, platform-side canopy — arrives as one
  // glTF asset. Its origin is the centre of the building's ground contact
  // plane and its axes match this group's, so it is added untransformed.
  const gltf = await new GLTFLoader().loadAsync(modelUrl);
  const shell = gltf.scene;
  shell.name = `${feature.id}__SHELL`;
  if (textures) applyStationTextures(shell, textures);
  group.add(shell);

  // ---------------------------------------------------------------
  // The facade photograph carries the windows, the mural, the entrance
  // surround and the signage, so none of those are rebuilt here any more.
  // What is left are the things the photograph cannot supply: the glazing
  // the player sees through into the waiting room, and the standing
  // nameboard out on the platform.
  // ---------------------------------------------------------------
  const glassMat = new THREE.MeshStandardMaterial({
    color: 0x9fb3bd, metalness: 0.25, roughness: 0.12,
    transparent: true, opacity: 0.35, side: THREE.DoubleSide,
  });
  const doorGlass = new THREE.Mesh(new THREE.PlaneGeometry(doorWidth - 0.1, doorHeight - 0.1), glassMat);
  doorGlass.position.set(doorCentreX, foundationRise + doorHeight / 2, halfD - 0.05);
  group.add(doorGlass);

  // 「緑　駅」 pediment. The porch's gable face carries the lettering; this
  // is the photograph of that face, set just in front of it.
  if (textures) {
    // Cut to the gable's own outline rather than pasted on as a rectangle,
    // and UV-mapped from the region of the photograph the crop came from, so
    // the lettering lands where it does on the building.
    const cx = 1.08;
    const half = 1.51;
    const zFace = halfD + porchDepth + 0.02;
    const CROP_X0 = -0.387;
    const CROP_X1 = 2.593;
    const CROP_Z0 = 2.496;
    const CROP_Z1 = 5.103;
    const corners: [number, number][] = [
      [cx - half, porchBaseH],
      [cx + half, porchBaseH],
      [cx, porchApex],
    ];
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(
      corners.flatMap(([x, y]) => [x, y, zFace]), 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(
      corners.flatMap(([x, y]) => [
        (x - CROP_X0) / (CROP_X1 - CROP_X0),
        (y - CROP_Z0) / (CROP_Z1 - CROP_Z0),
      ]), 2));
    geometry.computeVertexNormals();
    const pedimentPlane = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({
      map: textures.pediment, roughness: 0.85, side: THREE.DoubleSide,
    }));
    pedimentPlane.castShadow = false;
    group.add(pedimentPlane);
  }

  // 駅名標 — the standing nameboard on the platform.
  const nameboardTexture = makeStationNameboardTexture(NAMEBOARD_WITH_NUMBER);
  // A 駅名標 is read from both sides — from the platform and from the train.
  // One double-sided plane gave the correct face to the plaza, which nobody
  // stands on, and a mirror-image 「みどり」 to the platform, which is the only
  // side anyone actually reads it from. Two back-to-back single-sided faces
  // put the lettering the right way round in both directions.
  const nameboardMat = new THREE.MeshStandardMaterial({ map: nameboardTexture, roughness: 0.8 });
  for (const facing of [0, Math.PI]) {
    const nameboard = new THREE.Mesh(new THREE.PlaneGeometry(1.7, 0.85), nameboardMat);
    nameboard.rotation.y = facing;
    nameboard.position.set(-2.2, 1.85, -halfD - 2.2 + (facing === 0 ? 0.012 : -0.012));
    group.add(nameboard);
  }
  const postMat = new THREE.MeshStandardMaterial({ color: 0x7a3b32, roughness: 0.8 });
  for (const px of [-3.0, -1.4]) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 1.9, 8), postMat);
    post.position.set(px, 0.95, -halfD - 2.2);
    group.add(post);
  }
  const namebeam = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 1.6, 8), postMat);
  namebeam.rotation.z = Math.PI / 2;
  namebeam.position.set(-2.2, 1.9, -halfD - 2.2);
  group.add(namebeam);

  group.add(buildPlanters(halfD));

  // Two fluorescent battens on the waiting room's ceiling. Every photograph
  // of the interior has them lit, and without them the room the player just
  // walked into is a dark box.
  const ceilingH = (props.interior_ceiling_height_m ?? 2.6) + foundationRise;
  // The tube itself glows but is not pure white — a MeshBasicMaterial at
  // full white clipped to a featureless blob. The light is inverse-square,
  // so hanging it a hand's width below the ceiling put a 200× hotspot on the
  // plasterboard directly above it; dropping it to the batten's own height
  // and cutting the intensity leaves the room lit without the ceiling
  // burning out.
  const battenMat = new THREE.MeshStandardMaterial({
    color: 0xf2ecdc, emissive: 0xffefd0, emissiveIntensity: 0.9, roughness: 0.4,
  });
  for (const bz of [-1.3, 1.1]) {
    const batten = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.06, 0.12), battenMat);
    batten.position.set(0, ceilingH - 0.06, bz);
    group.add(batten);

    const lamp = new THREE.PointLight(0xffeccd, 4.5, 8, 2);
    lamp.position.set(0, ceilingH - 0.55, bz);
    group.add(lamp);
  }

  // ---------------------------------------------------------------
  // Wall collision. Without this the player walks straight through the
  // building and it never reads as a place with an inside — so the walls
  // become solid and the doorway becomes the way in. The lintel over the
  // door is deliberately not a blocker: that gap is the entrance.
  // ---------------------------------------------------------------
  const yaw = new THREE.Euler().setFromQuaternion(group.quaternion, 'YXZ').y;
  const doorLeft = doorCentreX - doorWidth / 2;
  const doorRight = doorCentreX + doorWidth / 2;
  const innerX = halfW - wallThickness;
  const wallTop = 3.4;
  const box = (x0: number, x1: number, z0: number, z1: number) =>
    blockerFromLocalBox(
      group.position,
      yaw,
      new THREE.Vector3(x0, 0, z0),
      new THREE.Vector3(x1, wallTop, z1),
    );
  group.userData.blockers = [
    box(-innerX, doorLeft, halfD - wallThickness, halfD),   // facade, left of the door
    box(doorRight, innerX, halfD - wallThickness, halfD),   // facade, right of the door
    box(-innerX, innerX, -halfD, -halfD + wallThickness),   // platform-side wall
    box(-halfW, -innerX, -halfD, halfD),                    // left end wall
    box(innerX, halfW, -halfD, halfD),                      // right end wall
  ];

  return group;
}

/**
 * The flower planters along the platform frontage.
 *
 * Photographs 005, 013 and 014 all show a row of them in front of the
 * building — timber half-barrels and concrete tubs, planted and clearly
 * tended. They are the most distinctive thing about this platform and the
 * World had none.
 *
 * THAT there are planters here is evidence; exactly where each one stands is
 * not. They are laid out along the frontage on a fixed pattern, in the
 * building's own frame, so they follow it wherever the Index puts it.
 */
function buildPlanters(halfD: number): THREE.Group {
  const group = new THREE.Group();
  group.name = 'Planters';

  const timber = new THREE.MeshStandardMaterial({ color: 0x6b4a33, roughness: 0.95 });
  const concrete = new THREE.MeshStandardMaterial({ color: 0x9c968c, roughness: 1 });
  const soil = new THREE.MeshStandardMaterial({ color: 0x3b2f26, roughness: 1 });
  const foliage = new THREE.MeshStandardMaterial({ color: 0x4e7a3a, roughness: 0.9 });
  const blooms = [0xd94f4f, 0xe8c34a, 0xd97fb0, 0xe8e2d0].map(
    (color) => new THREE.MeshStandardMaterial({ color, roughness: 0.7 }),
  );

  // (x along the frontage, distance out from the platform-side wall, barrel?)
  // They stand under and just beyond the canopy, well back from the platform
  // edge — an earlier pass had them out on the very lip of the drop.
  const layout: [number, number, boolean][] = [
    [-3.3, 1.1, false], [-1.9, 2.0, true], [-0.4, 1.2, false],
    [1.3, 2.1, true], [2.8, 1.1, false], [4.2, 1.9, true],
  ];

  layout.forEach(([x, out, barrel], index) => {
    const z = -halfD - out;
    const radius = barrel ? 0.34 : 0.28;
    const height = barrel ? 0.42 : 0.30;

    const tub = new THREE.Mesh(
      new THREE.CylinderGeometry(radius, radius * 0.88, height, barrel ? 12 : 8),
      barrel ? timber : concrete,
    );
    tub.position.set(x, height / 2, z);
    tub.castShadow = true;
    tub.receiveShadow = true;
    group.add(tub);

    const fill = new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.9, radius * 0.9, 0.04, 10), soil);
    fill.position.set(x, height - 0.02, z);
    group.add(fill);

    // a low mound of leaves with a few flower heads standing out of it
    const mound = new THREE.Mesh(new THREE.SphereGeometry(radius * 0.95, 8, 5), foliage);
    mound.scale.set(1, 0.55, 1);
    mound.position.set(x, height + 0.10, z);
    mound.castShadow = true;
    group.add(mound);

    for (let i = 0; i < 5; i++) {
      const angle = (i / 5) * Math.PI * 2 + index;
      const r = radius * 0.55;
      const bloom = new THREE.Mesh(
        new THREE.SphereGeometry(0.055, 6, 4),
        blooms[(index + i) % blooms.length],
      );
      bloom.position.set(x + Math.cos(angle) * r, height + 0.22, z + Math.sin(angle) * r);
      group.add(bloom);
    }
  });

  return group;
}

/** Directive 08 §4.2: platform box with a distinct teal painted edge band. */
function buildPlatform(
  feature: RealityData,
  tangentPlane: LocalTangentPlane,
  heightAt: (x: number, z: number) => number,
): THREE.Group {
  const group = new THREE.Group();
  group.name = feature.id;
  group.userData.realityData = feature;

  const geometry = feature.geometry;
  if (geometry.type !== 'Polygon') throw new Error('platform requires a Polygon footprint');
  const ring = geometry.coordinates[0];
  const points = projectRing(ring.slice(0, 4) as [number, number][], tangentPlane);
  // The stored height_m was itself an inference ("0.75-0.85 m, C"); the
  // derived one is the rail head plus the standard low-platform height, so
  // the deck and the rails cannot drift apart.
  const height = STATION_TERRACE_HEIGHT_M;
  const edgeWidth = (feature.properties.edge_width_m as number | undefined) ?? 0.225;

  const centroid = centroidOf(points);
  const base = heightAt(centroid.x, -centroid.y);

  // Photographs 013 and 014 show the platform retained by dark steel sheet
  // piling, not a plain earth bank: vertical piles with horizontal walings
  // bolted across them, and a coping along the top. The source frames are
  // 400-560 px wide, far too coarse to crop as a texture, so the piling is
  // modelled instead — at the 400 mm pitch of standard 鋼矢板, which is a
  // catalogue dimension rather than something read off the photograph.
  const bodyMat = new THREE.MeshStandardMaterial({ color: 0x3c3a35, roughness: 0.85, metalness: 0.25 });
  const body = new THREE.Mesh(extrudeFootprint(points, height), bodyMat);
  body.position.set(0, base, 0);
  body.receiveShadow = true;
  group.add(body);

  // The deck itself is gravel, a different surface from the steel face.
  const deckMat = new THREE.MeshStandardMaterial({ color: 0x8a837a, roughness: 1 });
  const deck = new THREE.Mesh(extrudeFootprint(points, 0.02), deckMat);
  deck.position.set(0, base + height, 0);
  deck.receiveShadow = true;
  group.add(deck);

  group.add(buildSheetPiling(points, base, height, bodyMat));

  // The painted warning line goes on the track edge only. Painting it round
  // the whole ring, as this did, drew a line along the back of the platform
  // where nothing arrives — and on an opposed pair, along the two faces that
  // look at each other across the tracks.
  const edgeMat = new THREE.MeshStandardMaterial({ color: 0x1f7a72, roughness: 0.6 }); // ティール（青緑）
  const trackEdge = feature.properties.track_edge_index as number | undefined;
  const stripe = trackEdge === undefined
    ? extrudeFootprint(points, 0.02, insetQuad(points, edgeWidth))
    : extrudeFootprint(edgeStripe(points, trackEdge, edgeWidth), 0.02);
  const edge = new THREE.Mesh(stripe, edgeMat);
  edge.position.set(0, base + height + 0.02, 0);
  group.add(edge);

  return group;
}

/** The quad covering one edge of a footprint, `width` metres deep inward. */
function edgeStripe(points: THREE.Vector2[], edgeIndex: number, width: number): THREE.Vector2[] {
  const a = points[edgeIndex % points.length];
  const b = points[(edgeIndex + 1) % points.length];
  const centre = centroidOf(points);
  const along = new THREE.Vector2().subVectors(b, a).normalize();
  // inward normal: whichever perpendicular points at the footprint's centre
  let inward = new THREE.Vector2(-along.y, along.x);
  if (inward.dot(new THREE.Vector2().subVectors(centre, a)) < 0) inward.negate();
  const offset = inward.multiplyScalar(width);
  return [
    a.clone(),
    b.clone(),
    b.clone().add(offset),
    a.clone().add(offset),
  ];
}

/** Pile pitch of standard 鋼矢板 (Type II and up), in metres. */
const SHEET_PILE_PITCH_M = 0.4;

/**
 * The vertical piles and horizontal walings on a platform's retaining face.
 *
 * Built as instances around the footprint's perimeter: the shape is what
 * makes the platform read as a retained embankment rather than a slab of
 * flat colour, and it is the same detail at every point along it.
 */
function buildSheetPiling(
  points: THREE.Vector2[],
  base: number,
  height: number,
  material: THREE.Material,
): THREE.Group {
  const group = new THREE.Group();
  group.name = 'SheetPiling';

  const RIB_WIDTH = 0.07;
  const RIB_PROUD = 0.05;
  const up = new THREE.Vector3(0, 1, 0);

  const ribs: THREE.Matrix4[] = [];
  const walings: THREE.Matrix4[] = [];
  const matrix = new THREE.Matrix4();
  const quaternion = new THREE.Quaternion();

  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    // shape space is (x, -z), so the World edge runs from (a.x,-a.y)
    const ax = a.x, az = -a.y;
    const bx = b.x, bz = -b.y;
    const dx = bx - ax, dz = bz - az;
    const length = Math.hypot(dx, dz);
    if (length < 1e-3) continue;
    const angle = Math.atan2(dx, dz);
    quaternion.setFromAxisAngle(up, angle);

    const count = Math.max(1, Math.round(length / SHEET_PILE_PITCH_M));
    for (let j = 0; j <= count; j++) {
      const t = j / count;
      ribs.push(matrix.compose(
        new THREE.Vector3(ax + dx * t, base + height / 2, az + dz * t),
        quaternion,
        new THREE.Vector3(1, 1, 1),
      ).clone());
    }
    // two walings across the piles, at a third and two thirds of the height
    for (const f of [0.34, 0.68]) {
      walings.push(matrix.compose(
        new THREE.Vector3(ax + dx / 2, base + height * f, az + dz / 2),
        quaternion,
        new THREE.Vector3(1, 1, length / 2),
      ).clone());
    }
  }

  // After the rotation above, the box's local +Z runs along the edge and
  // its local +X points out of the face — so the pile is thin in Z (its
  // width along the wall) and shallow in X (how far it stands proud).
  const ribGeom = new THREE.BoxGeometry(RIB_PROUD * 2, height, RIB_WIDTH);
  const ribMesh = new THREE.InstancedMesh(ribGeom, material, ribs.length);
  ribs.forEach((m, i) => ribMesh.setMatrixAt(i, m));
  ribMesh.instanceMatrix.needsUpdate = true;
  ribMesh.castShadow = true;
  ribMesh.frustumCulled = false;
  group.add(ribMesh);

  // scale z on the 2 m waling box gives the edge's own length
  const walingGeom = new THREE.BoxGeometry(RIB_PROUD * 1.4, 0.09, 2);
  const walingMesh = new THREE.InstancedMesh(walingGeom, material, walings.length);
  walings.forEach((m, i) => walingMesh.setMatrixAt(i, m));
  walingMesh.instanceMatrix.needsUpdate = true;
  walingMesh.castShadow = true;
  walingMesh.frustumCulled = false;
  group.add(walingMesh);

  return group;
}

/**
 * building footprint + estimated height -> simple extruded box mesh.
 * Not an attempt at building appearance — footprint accuracy and
 * approximate massing only, per Directive 01 §15.
 *
 * Directive 08: features carrying a `structure_type` property are
 * special-cased into richer compound geometry (platform) or a distinct
 * color (container/level_crossing/plaza_pavement); anything without one
 * keeps the original simple-box behavior unchanged.
 *
 * Directive 10: the station building is no longer built from this loop at
 * all — its position must come from the Spatial Index (not a Reality Data
 * polygon), so it is generated separately via `generateStationBuilding`,
 * called explicitly by main.ts once the Index has been fetched. Any
 * feature with structure_type "station_building" is skipped here.
 */
export class BuildingGenerator {
  static generate(
    buildingData: RealityData[],
    tangentPlane: LocalTangentPlane,
    heightAt: (x: number, z: number) => number,
  ): THREE.Group {
    const group = new THREE.Group();
    group.name = 'Buildings';

    const defaultMaterial = new THREE.MeshStandardMaterial({ color: 0x8a7f6b, roughness: 0.95 });

    for (const feature of buildingData) {
      const structureType = feature.properties.structure_type as string | undefined;
      if (structureType === 'station_building') continue; // Directive 10 §2: generated separately, position from Spatial Index
      // The settlement is built by TownGenerator, which puts a roof on each
      // outline instead of leaving it a flat-topped box.
      if (TOWN_STRUCTURE_TYPES.has(structureType ?? '')) continue;

      if (feature.geometry.type !== 'Polygon') continue;
      const ring = feature.geometry.coordinates[0];
      if (!ring || ring.length < 3) continue;

      if (structureType === 'platform') {
        group.add(buildPlatform(feature, tangentPlane, heightAt));
        continue;
      }

      const points = projectRing(ring, tangentPlane);

      if (SURFACE_STRUCTURE_TYPES.has(structureType ?? '')) {
        // The terrain now carries 国土地理院's aerial photograph, which already
        // shows this ground as it is. These stay only as a light tint that
        // says "this area is one thing" — laid on opaque they replaced a
        // photograph of the real surface with a flat colour, which is a step
        // backwards.
        const colour = new THREE.Color((feature.properties.surface_colour as string | undefined) ?? '#6f7a52');
        const surfaceCentroid = centroidOf(points);
        const slab = new THREE.Mesh(
          extrudeFootprint(points, 0.06),
          new THREE.MeshStandardMaterial({
            color: colour, roughness: 1, transparent: true, opacity: 0.35, depthWrite: false,
          }),
        );
        slab.position.set(0, heightAt(surfaceCentroid.x, -surfaceCentroid.y), 0);
        slab.receiveShadow = true;
        slab.name = feature.id;
        slab.userData.realityData = feature;
        group.add(slab);
        continue;
      }

      const buildingHeight = (feature.properties.height_m as number | undefined) ?? DEFAULT_HEIGHT_M;
      const geometry = extrudeFootprint(points, buildingHeight);
      const centroid = centroidOf(points);
      // The forecourt and the rail container beside it are on the station
      // terrace, level with the platform deck and the station floor; the
      // 構内踏切 stays down at the rails, which is the point of it.
      const onTerrace = structureType === 'plaza_pavement' || structureType === 'container';
      const base = heightAt(centroid.x, -centroid.y) + (onTerrace ? STATION_TERRACE_HEIGHT_M : 0);

      const material = structureType === 'plaza_pavement'
        ? new THREE.MeshStandardMaterial({
          color: STRUCTURE_COLORS.plaza_pavement, roughness: 0.95, transparent: true, opacity: 0.5, depthWrite: false,
        })
        : structureType && STRUCTURE_COLORS[structureType] !== undefined
          ? new THREE.MeshStandardMaterial({ color: STRUCTURE_COLORS[structureType], roughness: 0.9 })
          : defaultMaterial;

      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.set(0, base, 0);
      mesh.name = feature.id;
      mesh.userData.realityData = feature;
      group.add(mesh);
    }

    return group;
  }

  /** Directive 10 §2/AC08: the station building, generated separately from
   * the main loop because its position comes from the Spatial Index, not
   * a Reality Data polygon.
   *
   * Directive 11 §4: asynchronous, because the solid form is now fetched as
   * a glTF asset from `modelUrl` rather than generated in code. `feature`
   * still supplies the dimensions the remaining planar elements sit
   * against. */
  static generateStationBuilding(
    feature: RealityData,
    position: ResolvedPosition,
    tangentPlane: LocalTangentPlane,
    heightAt: (x: number, z: number) => number,
    modelUrl: string,
    textures: StationTextureSet | null,
  ): Promise<THREE.Group> {
    return buildStationBuilding(feature, position, tangentPlane, heightAt, modelUrl, textures);
  }
}
