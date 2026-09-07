import * as THREE from 'three';
import type { RealityData } from '../reality/RealityData';
import type { LocalTangentPlane } from '../core/Coordinates';
import {
  RAIL_CENTRE_OFFSET_M,
  SLEEPER_DEPTH_M,
  SLEEPER_LENGTH_M,
  SLEEPER_WIDTH_M,
  ballastProfile,
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

    const sleeperGeometry = new THREE.BoxGeometry(SLEEPER_WIDTH_M, SLEEPER_DEPTH_M, SLEEPER_LENGTH_M);
    const allSleepers: THREE.Matrix4[] = [];

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

    return group;
  }
}
