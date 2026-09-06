import * as THREE from 'three';
import type { RealityData } from '../reality/RealityData';
import type { LocalTangentPlane } from '../core/Coordinates';
import { buildGableRoof, buildLeanToRoof, buildPorchRoof, makeLabelTexture, makeMuralTexture } from './stationGeometry';

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

/**
 * Directive 08 §4.1: the station building's compound mesh (walls, gable
 * roof, canopy, porch + pediment, door, signage, mural) built from the
 * feature's footprint polygon plus its spec-derived dimension properties.
 * All non-footprint dimensions default to the spec's own values so a
 * feature missing a property still renders sensibly, but every value that
 * matters here (public_data/worlds/.../reality/buildings.geojson) is set
 * explicitly, not left to these fallbacks.
 */
function buildStationBuilding(
  feature: RealityData,
  tangentPlane: LocalTangentPlane,
  heightAt: (x: number, z: number) => number,
): THREE.Group {
  const geometry = feature.geometry;
  if (geometry.type !== 'Polygon') throw new Error('station_building requires a Polygon footprint');
  const ring = geometry.coordinates[0];
  const corners = ring.slice(0, 4).map(([lon, lat]) => tangentPlane.project(lat, lon));
  const p0 = new THREE.Vector3(corners[0].x, 0, corners[0].z);
  const p1 = new THREE.Vector3(corners[1].x, 0, corners[1].z);
  const p2 = new THREE.Vector3(corners[2].x, 0, corners[2].z);
  const p3 = new THREE.Vector3(corners[3].x, 0, corners[3].z);

  const width = p0.distanceTo(p1);
  const depth = p0.distanceTo(p3);
  const right = new THREE.Vector3().subVectors(p1, p0).normalize(); // rear edge = width axis
  const forward = new THREE.Vector3().subVectors(p3, p0).normalize(); // rear->front = depth axis
  const center = new THREE.Vector3()
    .add(p0).add(p1).add(p2).add(p3)
    .multiplyScalar(0.25);
  const baseY = heightAt(center.x, center.z);

  const props = feature.properties as Record<string, number>;
  const eaveH = props.eave_height_m ?? 2.8;
  const porchApex = props.porch_apex_height_m ?? 4.8;
  const canopyDepth = props.canopy_depth_m ?? 2.75;
  const foundationRise = props.foundation_rise_m ?? 0.4;
  const porchWidth = props.porch_width_m ?? 1.8;
  const porchDepth = props.porch_depth_m ?? 1.2;
  const doorHeight = props.door_height_m ?? 2.2;
  const doorWidth = props.door_width_m ?? 1.8;
  // Roof pitch is not given by the spec (§4.2: "軒の出 深い（数値未確定）");
  // a conservative rise is used only so the main ridge stays well below the
  // porch's spec-given apex height (AC04) — this rise value itself is not
  // sourced. See evidence/reconstruction.json:STR_MIDORI_STATION_BUILDING.
  const ridgeRise = 0.8;
  const overhang = 0.3;

  const group = new THREE.Group();
  group.name = feature.id;
  group.userData.realityData = feature;
  group.position.set(center.x, baseY, center.z);
  group.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(right, new THREE.Vector3(0, 1, 0), forward));

  const wallMat = new THREE.MeshStandardMaterial({ color: 0xe8dfc8, roughness: 0.9 }); // 淡いクリーム色〜アイボリー
  const roofMat = new THREE.MeshStandardMaterial({ color: 0x1f3d2b, roughness: 0.7, side: THREE.DoubleSide }); // 濃緑・金属横葺き
  const gableWallMat = new THREE.MeshStandardMaterial({ color: 0xf2efe6, roughness: 0.85 }); // 白〜オフホワイト
  const trimMat = new THREE.MeshStandardMaterial({ color: 0x1f3d2b, roughness: 0.6 }); // 濃緑の縁取り
  const foundationMat = new THREE.MeshStandardMaterial({ color: 0x9a9a92, roughness: 1 });
  const doorMat = new THREE.MeshStandardMaterial({
    color: 0xbfd6dc, metalness: 0.3, roughness: 0.2, transparent: true, opacity: 0.75, side: THREE.DoubleSide,
  });

  const halfW = width / 2;
  const halfD = depth / 2;

  // foundation
  const foundation = new THREE.Mesh(new THREE.BoxGeometry(width * 0.98, foundationRise, depth * 0.98), foundationMat);
  foundation.position.set(0, foundationRise / 2, 0);
  group.add(foundation);

  // main walls
  const walls = new THREE.Mesh(new THREE.BoxGeometry(width, eaveH, depth), wallMat);
  walls.position.set(0, foundationRise + eaveH / 2, 0);
  group.add(walls);

  // main gable roof (ridge along X/width, per spec's photo: eave faces front/back)
  const roofBaseY = foundationRise + eaveH;
  const roof = new THREE.Mesh(buildGableRoof(halfW + overhang, halfD + overhang, roofBaseY, roofBaseY + ridgeRise), roofMat);
  group.add(roof);

  // ホーム側下屋 (canopy): extends from the rear wall (z=-halfD) further
  // toward the track by canopyDepth, sloping down slightly.
  const canopy = new THREE.Mesh(
    buildLeanToRoof(halfW, -halfD, roofBaseY, -(halfD + canopyDepth), roofBaseY - 0.3),
    roofMat,
  );
  group.add(canopy);

  // 三角ポーチ: protrudes from the front wall center (z=+halfD onward)
  const porchHalfW = porchWidth / 2;
  const porch = new THREE.Mesh(
    buildPorchRoof(porchHalfW, halfD, halfD + porchDepth, eaveH + foundationRise, porchApex + foundationRise),
    roofMat,
  );
  group.add(porch);
  // porch pediment (妻壁) — flat gable-end wall under the roof triangle
  const pedimentShape = new THREE.Shape([
    new THREE.Vector2(-porchHalfW, 0),
    new THREE.Vector2(porchHalfW, 0),
    new THREE.Vector2(0, porchApex - eaveH),
  ]);
  const pedimentGeom = new THREE.ShapeGeometry(pedimentShape);
  const pediment = new THREE.Mesh(pedimentGeom, gableWallMat);
  pediment.position.set(0, foundationRise + eaveH, halfD + porchDepth);
  group.add(pediment);

  // "緑　駅" sign on the pediment
  const signTexture = makeLabelTexture('緑　駅', { bg: 'rgba(0,0,0,0)', fg: '#1f7a3f', fontPx: 40 });
  const signMat = new THREE.MeshBasicMaterial({ map: signTexture, transparent: true, side: THREE.DoubleSide });
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(porchWidth * 0.9, (porchApex - eaveH) * 0.7), signMat);
  sign.position.set(0, foundationRise + eaveH + (porchApex - eaveH) * 0.35, halfD + porchDepth + 0.02);
  group.add(sign);

  // central double glass door, set into the front wall
  const door = new THREE.Mesh(new THREE.PlaneGeometry(doorWidth, doorHeight), doorMat);
  door.position.set(0, foundationRise + doorHeight / 2, halfD + 0.02);
  group.add(door);

  // ホーロー縦型駅名標 (platform-side enamel nameboard)
  const namebandTexture = makeLabelTexture('みどり', { bg: '#111111', fg: '#f5f5f5', fontPx: 40 });
  const namebandMat = new THREE.MeshBasicMaterial({ map: namebandTexture });
  const nameband = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 1.4), namebandMat);
  nameband.position.set(halfW * 0.5, foundationRise + eaveH * 0.55, -halfD - 0.02);
  nameband.rotation.y = Math.PI;
  group.add(nameband);

  // 4x「みどり」縦看板 (2 front, 2 platform side), confidence B per spec §4.5
  const boardTexture = makeLabelTexture('みどり', { bg: '#16215c', fg: '#ffffff', fontPx: 36 });
  const boardMat = new THREE.MeshBasicMaterial({ map: boardTexture });
  const boardPositions: [number, number, number, number][] = [
    [-halfW * 0.75, foundationRise + eaveH * 0.6, halfD + 0.02, 0],
    [halfW * 0.75, foundationRise + eaveH * 0.6, halfD + 0.02, 0],
    [-halfW * 0.75, foundationRise + eaveH * 0.6, -halfD - 0.02, Math.PI],
    [halfW * 0.3, foundationRise + eaveH * 0.6, -halfD - 0.02, Math.PI],
  ];
  for (const [x, y, z, ry] of boardPositions) {
    const board = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 1.1), boardMat);
    board.position.set(x, y, z);
    board.rotation.y = ry;
    group.add(board);
  }

  // 腰壁の壁画 (mural band), wraps front + platform sides
  const muralTexture = makeMuralTexture();
  const muralMat = new THREE.MeshBasicMaterial({ map: muralTexture });
  const muralHeight = eaveH * 0.4;
  const muralFront = new THREE.Mesh(new THREE.PlaneGeometry(width * 0.96, muralHeight), muralMat);
  muralFront.position.set(0, foundationRise + muralHeight / 2, halfD + 0.015);
  group.add(muralFront);
  const muralRear = new THREE.Mesh(new THREE.PlaneGeometry(width * 0.96, muralHeight), muralMat);
  muralRear.position.set(0, foundationRise + muralHeight / 2, -halfD - 0.015);
  muralRear.rotation.y = Math.PI;
  group.add(muralRear);

  // porch side trim (confidence-A dark green edge described in §4.3)
  const trimGeom = new THREE.BoxGeometry(porchWidth + 0.05, 0.06, porchDepth + 0.05);
  const trim = new THREE.Mesh(trimGeom, trimMat);
  trim.position.set(0, foundationRise + eaveH + 0.03, halfD + porchDepth / 2);
  group.add(trim);

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
 * special-cased into richer compound geometry (station building, platform)
 * or a distinct color (container/level_crossing/plaza_pavement); anything
 * without one keeps the original simple-box behavior unchanged.
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
      if (feature.geometry.type !== 'Polygon') continue;
      const ring = feature.geometry.coordinates[0];
      if (!ring || ring.length < 3) continue;

      const structureType = feature.properties.structure_type as string | undefined;

      if (structureType === 'station_building') {
        group.add(buildStationBuilding(feature, tangentPlane, heightAt));
        continue;
      }
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
}
