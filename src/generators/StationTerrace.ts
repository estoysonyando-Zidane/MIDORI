import * as THREE from 'three';
import type { RealityData } from '../reality/RealityData';
import type { LocalTangentPlane } from '../core/Coordinates';
import { STATION_TERRACE_HEIGHT_M } from './BuildingGenerator';

/**
 * The raised ground of the station.
 *
 * In every photograph of 緑駅 the forecourt, the station floor and the
 * platform deck are one continuous level, and the rails are below it, held
 * back by the sheet piling along the platform's face. The DEM is a 10 m grid
 * and carries no such step, so the platform used to be a box standing on the
 * same ground the player walked on: the deck was 0.8 m over the player's
 * feet, the station floor with it, and the waiting room became a room you
 * could see into but not enter.
 *
 * This raises the ground itself over the footprints that make up the
 * terrace, so the player walks up onto the platform and in through the door,
 * and steps down to the rails where the piling is. It is a correction to the
 * terrain model, not new Reality Data: the shapes are the footprints already
 * in Reality Data, and the height is the platform's own.
 */

/** How far out from a footprint the ground ramps up to terrace level. */
const RAMP_M = 1.4;

interface Terrace {
  /** Footprint in World XZ, as a closed ring. */
  ring: THREE.Vector2[];
}

function signedArea(ring: THREE.Vector2[]): number {
  let area = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    area += a.x * b.y - b.x * a.y;
  }
  return area / 2;
}

/** Distance from a point to a ring: negative inside, positive outside. */
function signedDistance(x: number, z: number, ring: THREE.Vector2[]): number {
  let best = Infinity;
  let inside = false;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const lengthSq = dx * dx + dy * dy;
    let t = lengthSq > 0 ? ((x - a.x) * dx + (z - a.y) * dy) / lengthSq : 0;
    t = Math.max(0, Math.min(1, t));
    const d = Math.hypot(x - (a.x + t * dx), z - (a.y + t * dy));
    if (d < best) best = d;
    // ray cast along +x for the inside test
    if ((a.y > z) !== (b.y > z) && x < a.x + ((z - a.y) / (b.y - a.y)) * dx) inside = !inside;
  }
  return inside ? -best : best;
}

export class StationTerrace {
  private readonly terraces: Terrace[] = [];

  constructor(features: RealityData[], tangentPlane: LocalTangentPlane) {
    for (const feature of features) {
      const type = feature.properties.structure_type;
      if (type !== 'platform' && type !== 'plaza_pavement') continue;
      if (feature.geometry.type !== 'Polygon') continue;
      const ring = (feature.geometry.coordinates[0] as [number, number][])
        .slice(0, -1)
        .map(([lon, lat]) => {
          const local = tangentPlane.project(lat, lon);
          return new THREE.Vector2(local.x, local.z);
        });
      if (ring.length < 3) continue;
      // signedDistance's inside test does not care about winding, but keeping
      // the rings consistently wound makes them comparable if this ever grows
      // an outline or a union.
      if (signedArea(ring) < 0) ring.reverse();
      this.terraces.push({ ring });
    }
  }

  get count(): number {
    return this.terraces.length;
  }

  /**
   * Wraps a terrain height function so the ground stands at terrace level
   * over the station's footprints, ramping up over `RAMP_M` at their edges so
   * the step is walkable rather than a wall the player is stopped by.
   */
  wrap(heightAt: (x: number, z: number) => number): (x: number, z: number) => number {
    if (this.terraces.length === 0) return heightAt;
    return (x, z) => {
      let lift = 0;
      for (const terrace of this.terraces) {
        const d = signedDistance(x, z, terrace.ring);
        const t = THREE.MathUtils.clamp(1 - d / RAMP_M, 0, 1);
        if (t > 0) lift = Math.max(lift, t * STATION_TERRACE_HEIGHT_M);
      }
      return heightAt(x, z) + lift;
    };
  }
}
