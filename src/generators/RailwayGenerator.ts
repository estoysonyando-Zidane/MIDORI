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
 * Sleepers are instanced and only placed near the player's part of the
 * World; the ballast and the rails run the full length of every line,
 * because a rail that stops being a rail at 700 m is the thing you would
 * notice from the platform.
 */

/** How far from the World's centre the sleepers are laid. Beyond this the
 *  rails still run, on ballast, but the sleepers are below the size of a
 *  pixel and cost more than they show. */
const SLEEPER_RADIUS_M = 750;

export class RailwayGenerator {
  static generate(
    railwayData: RealityData[],
    tangentPlane: LocalTangentPlane,
    heightAt: (x: number, z: number) => number,
  ): THREE.Group {
    const group = new THREE.Group();
    group.name = 'Railway';

    const ballastMat = new THREE.MeshStandardMaterial({ color: 0x7a7168, roughness: 1 });
    const sleeperMat = new THREE.MeshStandardMaterial({ color: 0x3a2f26, roughness: 0.95 });
    // Rail: the head is polished by wheels and the web is rusted. One
    // material, biased to the bright side, because the head is what is seen.
    const railMat = new THREE.MeshStandardMaterial({ color: 0x9a9490, roughness: 0.35, metalness: 0.85 });

    const origin = new THREE.Vector3(0, 0, 0);
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

      allSleepers.push(...sleeperPlacements(path, origin, SLEEPER_RADIUS_M));
    }

    if (allSleepers.length > 0) {
      const sleepers = new THREE.InstancedMesh(sleeperGeometry, sleeperMat, allSleepers.length);
      allSleepers.forEach((m, i) => sleepers.setMatrixAt(i, m));
      sleepers.instanceMatrix.needsUpdate = true;
      sleepers.castShadow = true;
      sleepers.receiveShadow = true;
      sleepers.frustumCulled = false;
      sleepers.name = 'Sleepers';
      group.add(sleepers);
    }

    return group;
  }
}
