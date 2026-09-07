import * as THREE from 'three';
import type { RealityData } from '../reality/RealityData';
import type { LocalTangentPlane } from '../core/Coordinates';
import {
  BALLAST_TOP_M,
  FISHPLATE_DEPTH_M,
  FISHPLATE_HEIGHT_M,
  FISHPLATE_LENGTH_M,
  RAIL_CENTRE_OFFSET_M,
  RAIL_HEIGHT_M,
  SLEEPER_DEPTH_M,
  SLEEPER_LENGTH_M,
  SLEEPER_WIDTH_M,
  TIE_PLATE_DEPTH_M,
  TIE_PLATE_LENGTH_M,
  TIE_PLATE_WIDTH_M,
  ballastProfile,
  jointDistances,
  pointAt,
  railProfile,
  sleeperPlacements,
  sweepProfile,
  trackPath,
} from './TrackGeometry';

/**
 * The permanent way.
 *
 * This used to be a 3 m brown ribbon with a comment saying position and
 * direction were all Directive 01 asked for. That is no longer the standard
 * this World is held to: the track is the one thing here whose dimensions
 * are published national figures rather than anyone's reading of a
 * photograph, so it is built to them — ballast prism, timber sleepers at
 * 39 per 25 m, and 50kgN rail in its real section at 1,067 mm gauge. See
 * TrackGeometry.ts for every figure and where it comes from.
 *
 * Ballast, sleepers and rails all run the full length of every line — out
 * to 札弦 one way and 川湯温泉 the other, past the World's own 2 km radius.
 * Track that stops being track partway is the thing you would notice from
 * the platform, and 8,500 sleepers is one instanced draw.
 */

/**
 * A crushed-stone pattern for the ballast.
 *
 * Ballast at a flat colour is the same failure as ground at a flat colour:
 * at eye level it reads as a painted ramp rather than as loose stone. This
 * is 40 mm crushed rock — angular, high contrast, no colour of its own
 * beyond the grey it multiplies.
 */
function makeBallastTexture(): THREE.Texture {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#6f6862';
  ctx.fillRect(0, 0, size, size);

  // deterministic, so the track looks the same on every load
  let seed = 0x2545f491;
  const rand = () => {
    seed = (Math.imul(seed ^ (seed >>> 15), seed | 1) + 0x6d2b79f5) >>> 0;
    return ((seed >>> 8) & 0xffff) / 0xffff;
  };

  // Each stone is drawn four times, wrapped, so the tile has no seam.
  for (let i = 0; i < 900; i++) {
    const cx = rand() * size;
    const cy = rand() * size;
    const r = 2.5 + rand() * 4.5;
    const shade = 90 + Math.floor(rand() * 95);
    ctx.fillStyle = `rgb(${shade},${shade - 4},${shade - 10})`;
    for (const [ox, oy] of [[0, 0], [size, 0], [0, size], [size, size], [-size, 0], [0, -size]]) {
      ctx.beginPath();
      const n = 5 + Math.floor(rand() * 2);
      for (let k = 0; k < n; k++) {
        const a = (k / n) * Math.PI * 2;
        const rr = r * (0.65 + 0.35 * ((k * 7 + i) % 5) / 4);
        const x = cx + ox + Math.cos(a) * rr;
        const y = cy + oy + Math.sin(a) * rr;
        if (k === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.fill();
    }
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  // one tile per 1.6 m of ballast — a 256 px tile over 1.6 m is 6 mm a pixel,
  // about right for 40 mm stone
  texture.repeat.set(1 / 1.6, 1 / 1.6);
  return texture;
}

const UP = new THREE.Vector3(0, 1, 0);

export class RailwayGenerator {
  static generate(
    railwayData: RealityData[],
    tangentPlane: LocalTangentPlane,
    heightAt: (x: number, z: number) => number,
  ): THREE.Group {
    const group = new THREE.Group();
    group.name = 'Railway';

    const ballastMat = new THREE.MeshStandardMaterial({
      color: 0xffffff, roughness: 1, map: makeBallastTexture(),
    });
    const sleeperMat = new THREE.MeshStandardMaterial({ color: 0x3a2f26, roughness: 0.95 });
    // Rail: the head is polished by wheels and the web is rusted. One
    // material, biased to the bright side, because the head is what is seen.
    const railMat = new THREE.MeshStandardMaterial({ color: 0x9a9490, roughness: 0.35, metalness: 0.85 });

    // Fastenings are steel, and darker and shinier than the rail's flank.
    const steelMat = new THREE.MeshStandardMaterial({ color: 0x6a635d, roughness: 0.55, metalness: 0.7 });

    // The instance basis (see sleeperPlacements) maps local X across the track
    // and local Z along it, so the 2.1 m dimension is X. Built the other way
    // round, as this was, every sleeper lay 2.1 m ALONG the rails at a 0.64 m
    // pitch — they overlapped three deep and the track read as a plank.
    const sleeperGeometry = new THREE.BoxGeometry(SLEEPER_LENGTH_M, SLEEPER_DEPTH_M, SLEEPER_WIDTH_M);
    const allSleepers: THREE.Matrix4[] = [];
    const allTiePlates: THREE.Matrix4[] = [];
    const allFishplates: THREE.Matrix4[] = [];
    // Everything bolted to the rail is drawn only where the player can be —
    // a tie plate is 300 mm long and there are 17,000 of them over 5.5 km.
    const FASTENING_RADIUS_M = 320;
    const centre = new THREE.Vector3(0, 0, 0);
    const basis = new THREE.Matrix4();
    const quaternion = new THREE.Quaternion();
    const unit = new THREE.Vector3(1, 1, 1);

    for (const feature of railwayData) {
      if (feature.geometry.type !== 'LineString') continue;
      const path = trackPath(feature.geometry.coordinates as [number, number][], tangentPlane, heightAt);
      if (path.length < 2) continue;

      const ballast = new THREE.Mesh(sweepProfile(path, ballastProfile()), ballastMat);
      ballast.name = feature.id;
      ballast.userData.realityData = feature;
      ballast.receiveShadow = true;
      group.add(ballast);

      for (const side of [-1, 1]) {
        const rail = new THREE.Mesh(sweepProfile(path, railProfile(side * RAIL_CENTRE_OFFSET_M)), railMat);
        rail.name = `${feature.id}_Rail_${side > 0 ? 'R' : 'L'}`;
        rail.castShadow = true;
        rail.receiveShadow = true;
        group.add(rail);
      }

      // The whole line, both ways out of the station — 札弦 to the north-west
      // and 川湯温泉 to the south-east. An earlier version laid sleepers only
      // within 750 m of the World's centre, so the track stopped being track
      // at exactly the distance you can still see it from the platform. At
      // the standard pitch the full 5.5 km is about 8,500 boxes, which is one
      // instanced draw.
      allSleepers.push(...sleeperPlacements(path, null, 0));

      // タイプレート: one under each rail seat, on the sleeper's top face.
      for (const seat of sleeperPlacements(path, centre, FASTENING_RADIUS_M)) {
        for (const side of [-1, 1]) {
          const m = new THREE.Matrix4().copy(seat);
          m.multiply(new THREE.Matrix4().makeTranslation(
            side * RAIL_CENTRE_OFFSET_M,
            SLEEPER_DEPTH_M / 2 + TIE_PLATE_DEPTH_M / 2,
            0,
          ));
          allTiePlates.push(m);
        }
      }

      // 継目板: a pair bolted across the web at every 25 m rail joint.
      for (const d of jointDistances(path, centre, FASTENING_RADIUS_M)) {
        const p = pointAt(path, d);
        if (!p) continue;
        const normal = new THREE.Vector3().crossVectors(p.side, UP).normalize();
        quaternion.setFromRotationMatrix(basis.makeBasis(p.side, UP, normal));
        for (const side of [-1, 1]) {
          for (const face of [-1, 1]) {
            const position = new THREE.Vector3().copy(p.position)
              .addScaledVector(p.side, side * RAIL_CENTRE_OFFSET_M + face * 0.042)
              .add(new THREE.Vector3(0, BALLAST_TOP_M + RAIL_HEIGHT_M * 0.45, 0));
            allFishplates.push(new THREE.Matrix4().compose(position, quaternion, unit));
          }
        }
      }
    }

    if (allSleepers.length > 0) {
      const sleepers = new THREE.InstancedMesh(sleeperGeometry, sleeperMat, allSleepers.length);
      allSleepers.forEach((m, i) => sleepers.setMatrixAt(i, m));
      sleepers.instanceMatrix.needsUpdate = true;
      sleepers.castShadow = true;
      sleepers.receiveShadow = true;
      sleepers.frustumCulled = false;
      sleepers.name = 'Sleepers';
      // Creosoted timber weathers unevenly; a flat brown row of 8,500
      // identical boxes reads as a comb rather than as sleepers.
      sleepers.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(allSleepers.length * 3), 3);
      for (let i = 0; i < allSleepers.length; i++) {
        const t = 0.78 + 0.44 * (((i * 2654435761) >>> 0) % 1000) / 1000;
        sleepers.instanceColor.setXYZ(i, t, t * 0.97, t * 0.92);
      }
      sleepers.instanceColor.needsUpdate = true;
      group.add(sleepers);
    }

    if (allTiePlates.length > 0) {
      const plates = new THREE.InstancedMesh(
        new THREE.BoxGeometry(TIE_PLATE_LENGTH_M, TIE_PLATE_DEPTH_M, TIE_PLATE_WIDTH_M),
        steelMat, allTiePlates.length,
      );
      allTiePlates.forEach((m, i) => plates.setMatrixAt(i, m));
      plates.instanceMatrix.needsUpdate = true;
      plates.castShadow = true;
      plates.receiveShadow = true;
      plates.frustumCulled = false;
      plates.name = 'TiePlates';
      group.add(plates);
    }

    if (allFishplates.length > 0) {
      const plates = new THREE.InstancedMesh(
        new THREE.BoxGeometry(FISHPLATE_DEPTH_M, FISHPLATE_HEIGHT_M, FISHPLATE_LENGTH_M),
        steelMat, allFishplates.length,
      );
      allFishplates.forEach((m, i) => plates.setMatrixAt(i, m));
      plates.instanceMatrix.needsUpdate = true;
      plates.castShadow = true;
      plates.frustumCulled = false;
      plates.name = 'Fishplates';
      group.add(plates);
    }

    return group;
  }
}
