import * as THREE from 'three';
import type { RealityData } from '../reality/RealityData';
import type { LocalTangentPlane } from '../core/Coordinates';
import { buildGableRoofZAxis, buildLeanToRoof, buildPorchRoof, makeLabelTexture, makeMuralTexture } from './stationGeometry';

const DEFAULT_HEIGHT_M = 5;

/** Directive 08 §4.3: colors for the small fixed-shape structures that
 * aren't plain building boxes. Anything not listed keeps the original
 * generic building color. */
const STRUCTURE_COLORS: Record<string, number> = {
  container: 0x2f5a3a,
  level_crossing: 0x4a3b2a,
  plaza_pavement: 0x2e6b3e,
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
 * Directive 10 §4.3 / spec v1.2: the station building's compound mesh.
 * Position and orientation come from `position` (resolved by the caller
 * from the Spatial Index entity JP.01.546.MIDORI/STATION_BUILDING — see
 * main.ts) — never from `feature.geometry`, which this function does not
 * read at all. Only dimensions/appearance come from Reality Data
 * (`feature.properties`).
 *
 * Roof ridge runs along local +Z (the depth/front-back axis) per spec
 * v1.2 §4.3 — Directive 08 built it along +X (width axis) because v1.1
 * never defined the ridge direction; that produced the "twisted floating
 * panel" failure this rebuild corrects. See stationGeometry.ts for the
 * per-triangle winding derivation.
 */
function buildStationBuilding(
  feature: RealityData,
  position: ResolvedPosition,
  tangentPlane: LocalTangentPlane,
  heightAt: (x: number, z: number) => number,
): THREE.Group {
  const local = tangentPlane.project(position.lat, position.lon);
  const bearingRad = (position.facadeBearingDeg * Math.PI) / 180;
  // forward = the direction the front (porch) faces, in World XZ.
  // right×up=forward with up=(0,1,0) gives right=(forward.z,0,-forward.x)
  // — see Directive 10 session notes for the derivation (cross-checked
  // numerically against Directive 08's original hand-built basis).
  const forward = new THREE.Vector3(Math.sin(bearingRad), 0, -Math.cos(bearingRad));
  const right = new THREE.Vector3(forward.z, 0, -forward.x);
  const baseY = heightAt(local.x, local.z);

  const props = feature.properties as Record<string, number>;
  const width = props.width_m ?? 7.0;
  const depth = props.depth_m ?? 6.0;
  const eaveH = props.eave_height_m ?? 3.5;
  const ridgeH = props.ridge_height_m ?? 4.5;
  const porchApex = props.porch_apex_height_m ?? 4.8;
  const porchBaseH = props.porch_base_height_m ?? 2.6;
  const canopyDepth = props.canopy_depth_m ?? 2.75;
  const foundationRise = props.foundation_rise_m ?? 0.4;
  const porchWidth = props.porch_width_m ?? 2.6;
  const porchDepth = props.porch_depth_m ?? 1.0;
  const doorHeight = props.door_height_m ?? 2.25;
  const doorWidth = props.door_width_m ?? 1.8;
  // Directive 10 / spec v1.2 §4.3 gives the slope as an exact relationship
  // — eave 3.5m to ridge 4.5m over a half-width of exactly 3.5m (the
  // wall's own half-width, not a wider figure) — so the main roof carries
  // NO overhang beyond the wall face; adding one would silently change the
  // slope away from spec's stated ~16°. (Confirmed: atan(1.0/3.5) = 15.95°.)

  const group = new THREE.Group();
  group.name = feature.id;
  group.userData.realityData = feature;
  group.position.set(local.x, baseY, local.z);
  group.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(right, new THREE.Vector3(0, 1, 0), forward));

  // Directive 10 Visual QA cycle 1 finding: on faces angled away from the
  // scene's single directional sun (src/rendering/Lighting.ts, not touched
  // here — it's shared by the whole World), a purely diffuse cream material
  // shades down to a flat gray, visually reproducing Directive 08's "gray
  // wall" defect through lighting rather than color. A small matching
  // emissive term keeps the cream/off-white hue readable in shadow without
  // changing the material's declared (spec-derived) color or adding new
  // geometry.
  const wallMat = new THREE.MeshStandardMaterial({
    color: 0xe8dfc8, roughness: 0.9, emissive: 0xe8dfc8, emissiveIntensity: 0.12,
  }); // 淡いクリーム色〜アイボリー、全周
  const roofMat = new THREE.MeshStandardMaterial({ color: 0x1f3d2b, roughness: 0.7, side: THREE.DoubleSide }); // 濃緑・金属横葺き
  const gableWallMat = new THREE.MeshStandardMaterial({
    color: 0xf2efe6, roughness: 0.85, emissive: 0xf2efe6, emissiveIntensity: 0.12,
  }); // 白〜オフホワイト
  const trimMat = new THREE.MeshStandardMaterial({ color: 0x1f3d2b, roughness: 0.6 }); // 濃緑の縁取り
  const foundationMat = new THREE.MeshStandardMaterial({ color: 0x9a9a92, roughness: 1 });
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
  // Directive 10 / spec v1.2 §4.3: "各高さ（地面＝舗装面を0とする）" — eave/
  // ridge/porch heights are ALL measured from true ground (y=0), and the
  // v1.2-corrected 3.5m eave figure already INCLUDES the foundation rise
  // (v1.1's 2.8m had dropped the foundation entirely — spec §13-1). So the
  // foundation is a sub-span of eaveH, not stacked additively on top of it
  // the way Directive 08 built it.
  const wallTopY = eaveH;
  const wallSidingHeight = eaveH - foundationRise;

  // foundation (visible concrete plinth, y=0..foundationRise)
  const foundation = new THREE.Mesh(new THREE.BoxGeometry(width * 0.98, foundationRise, depth * 0.98), foundationMat);
  foundation.position.set(0, foundationRise / 2, 0);
  group.add(foundation);

  // main walls (siding, y=foundationRise..eaveH) — a single box, single
  // material: all four faces are the same cream siding (spec v1.2 §4.4
  // "適用範囲: 建物の全周（四面すべて）").
  const walls = new THREE.Mesh(new THREE.BoxGeometry(width, wallSidingHeight, depth), wallMat);
  walls.position.set(0, foundationRise + wallSidingHeight / 2, 0);
  group.add(walls);

  // main gable roof — ridge along Z (spec v1.2 §4.3), eaves flush with the
  // wall top (wallTopY) so there is no vertical gap between wall and roof.
  const roof = new THREE.Mesh(
    buildGableRoofZAxis(halfW, -halfD, halfD, wallTopY, ridgeH),
    roofMat,
  );
  group.add(roof);

  // ホーム側下屋 (canopy): attaches at the west wall's top (eave height),
  // extends further west (toward the track) by canopyDepth, sloping down.
  const canopy = new THREE.Mesh(
    buildLeanToRoof(halfW, -halfD, wallTopY, -(halfD + canopyDepth), wallTopY - 0.3),
    roofMat,
  );
  group.add(canopy);

  // 三角ポーチ: a small separate gable protruding east from the main
  // building's east wall, base at porchBaseH, apex at porchApex — nearly
  // equilateral, narrowing upward (spec v1.2 §4.3).
  const porchHalfW = porchWidth / 2;
  const porch = new THREE.Mesh(
    buildPorchRoof(porchHalfW, halfD, halfD + porchDepth, porchBaseH, porchApex),
    roofMat,
  );
  group.add(porch);
  // porch pediment (妻壁) — the visible triangular wall face under the roof
  const pedimentShape = new THREE.Shape([
    new THREE.Vector2(-porchHalfW, 0),
    new THREE.Vector2(porchHalfW, 0),
    new THREE.Vector2(0, porchApex - porchBaseH),
  ]);
  const pediment = new THREE.Mesh(new THREE.ShapeGeometry(pedimentShape), gableWallMat);
  pediment.position.set(0, porchBaseH, halfD + porchDepth);
  group.add(pediment);

  // "緑　駅" sign on the pediment
  const signTexture = makeLabelTexture('緑　駅', { bg: 'rgba(0,0,0,0)', fg: '#1f7a3f', fontPx: 40 });
  const signMat = new THREE.MeshBasicMaterial({ map: signTexture, transparent: true, side: THREE.DoubleSide });
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(porchWidth * 0.75, (porchApex - porchBaseH) * 0.7), signMat);
  sign.position.set(0, porchBaseH + (porchApex - porchBaseH) * 0.4, halfD + porchDepth + 0.02);
  group.add(sign);

  // porch trim (concrete-green edge described in spec §4.4)
  const trim = new THREE.Mesh(new THREE.BoxGeometry(porchWidth + 0.05, 0.06, porchDepth + 0.05), trimMat);
  trim.position.set(0, porchBaseH + 0.03, halfD + porchDepth / 2);
  group.add(trim);

  // central double glass door, set into the front (east) wall
  const door = new THREE.Mesh(new THREE.PlaneGeometry(doorWidth, doorHeight), doorMat);
  door.position.set(0, foundationRise + doorHeight / 2, halfD + 0.02);
  group.add(door);

  // Directive 10 / spec v1.2 §4.6: windows are glass, distinct from the
  // navy "みどり" signboards — left→right: 2 small waist-high windows,
  // 1 large window, [door], 2 large windows. Exact widths/positions are
  // not given by the spec (confidence C/U on window dimensions) — laid
  // out to fill the wall either side of the door without overlapping it.
  const smallWindowY = 1.0 + 0.275; // waist-high, ~0.55m tall centered ~1.0-1.55m from ground
  const smallWindow = () => new THREE.Mesh(new THREE.PlaneGeometry(0.55, 0.55), windowMat);
  const w1 = smallWindow(); w1.position.set(-2.85, smallWindowY, halfD + 0.02); group.add(w1);
  const w2 = smallWindow(); w2.position.set(-2.2, smallWindowY, halfD + 0.02); group.add(w2);

  const bigWindowY = 1.6;
  const bigWindow = (w: number) => new THREE.Mesh(new THREE.PlaneGeometry(w, 1.8), windowMat);
  const w3 = bigWindow(1.0); w3.position.set(-1.4, bigWindowY, halfD + 0.02); group.add(w3);
  const w4 = bigWindow(1.1); w4.position.set(1.55, bigWindowY, halfD + 0.02); group.add(w4);
  const w5 = bigWindow(0.9); w5.position.set(2.6, bigWindowY, halfD + 0.02); group.add(w5);

  // ホーロー縦型駅名標 (platform-side enamel nameboard) — separate from windows/boards
  const namebandTexture = makeLabelTexture('みどり', { bg: '#111111', fg: '#f5f5f5', fontPx: 40 });
  const namebandMat = new THREE.MeshBasicMaterial({ map: namebandTexture });
  const nameband = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 1.4), namebandMat);
  nameband.position.set(halfW * 0.5, eaveH * 0.55, -halfD - 0.02);
  nameband.rotation.y = Math.PI;
  group.add(nameband);

  // 4x「みどり」縦看板 (2 front, 2 platform side) — navy boards, distinct
  // from the glass windows above (spec v1.2 §4.6/§4.7)
  const boardTexture = makeLabelTexture('みどり', { bg: '#16215c', fg: '#ffffff', fontPx: 36 });
  const boardMat = new THREE.MeshBasicMaterial({ map: boardTexture });
  const boardPositions: [number, number, number, number][] = [
    [-3.1, eaveH * 0.6, halfD + 0.02, 0],
    [3.1, eaveH * 0.6, halfD + 0.02, 0],
    [-halfW * 0.75, eaveH * 0.6, -halfD - 0.02, Math.PI],
    [halfW * 0.3, eaveH * 0.6, -halfD - 0.02, Math.PI],
  ];
  for (const [x, y, z, ry] of boardPositions) {
    const board = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 1.1), boardMat);
    board.position.set(x, y, z);
    board.rotation.y = ry;
    group.add(board);
  }

  // 腰壁の壁画 (mural band): a continuous band along the FULL width of the
  // front (east) and platform-side (west) walls, low on the wall (spec
  // v1.2 §4.8: "地面から約1.0–1.2mの帯" — a band whose top sits ~1.0-1.2m
  // up from the ground, not a fragment covering only part of the wall).
  const muralTexture = makeMuralTexture();
  const muralMat = new THREE.MeshBasicMaterial({ map: muralTexture });
  const muralBottom = 0; // "地面から" — true ground, not the foundation top
  const muralTop = 1.1;
  const muralHeight = muralTop - muralBottom;
  const muralFront = new THREE.Mesh(new THREE.PlaneGeometry(width, muralHeight), muralMat);
  muralFront.position.set(0, muralBottom + muralHeight / 2, halfD + 0.015);
  group.add(muralFront);
  const muralRear = new THREE.Mesh(new THREE.PlaneGeometry(width, muralHeight), muralMat);
  muralRear.position.set(0, muralBottom + muralHeight / 2, -halfD - 0.015);
  muralRear.rotation.y = Math.PI;
  group.add(muralRear);

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
  const height = (feature.properties.height_m as number | undefined) ?? 0.8;
  const edgeWidth = (feature.properties.edge_width_m as number | undefined) ?? 0.225;

  const centroid = centroidOf(points);
  const base = heightAt(centroid.x, -centroid.y);

  const bodyMat = new THREE.MeshStandardMaterial({ color: 0x6b6258, roughness: 1 }); // 暗色の波形鋼板/矢板 + 砂利敷き
  const body = new THREE.Mesh(extrudeFootprint(points, height), bodyMat);
  body.position.set(0, base, 0);
  group.add(body);

  const edgeMat = new THREE.MeshStandardMaterial({ color: 0x1f7a72, roughness: 0.6 }); // ティール（青緑）
  const insetPoints = insetQuad(points, edgeWidth);
  const edge = new THREE.Mesh(extrudeFootprint(points, 0.02, insetPoints), edgeMat);
  edge.position.set(0, base + height, 0);
  group.add(edge);

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

      if (feature.geometry.type !== 'Polygon') continue;
      const ring = feature.geometry.coordinates[0];
      if (!ring || ring.length < 3) continue;

      if (structureType === 'platform') {
        group.add(buildPlatform(feature, tangentPlane, heightAt));
        continue;
      }

      const points = projectRing(ring, tangentPlane);
      const buildingHeight = (feature.properties.height_m as number | undefined) ?? DEFAULT_HEIGHT_M;
      const geometry = extrudeFootprint(points, buildingHeight);
      const centroid = centroidOf(points);
      const base = heightAt(centroid.x, -centroid.y);

      const material = structureType && STRUCTURE_COLORS[structureType] !== undefined
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
   * a Reality Data polygon. `feature` still supplies dimensions/appearance. */
  static generateStationBuilding(
    feature: RealityData,
    position: ResolvedPosition,
    tangentPlane: LocalTangentPlane,
    heightAt: (x: number, z: number) => number,
  ): THREE.Group {
    return buildStationBuilding(feature, position, tangentPlane, heightAt);
  }
}
