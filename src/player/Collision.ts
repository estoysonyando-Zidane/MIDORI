import * as THREE from 'three';

/**
 * Wall collision for the World.
 *
 * The player used to walk through everything, so a building had no inside —
 * you passed through the wall and out the other side without ever being in
 * a room. This gives structures a footprint the player is pushed out of, so
 * a doorway becomes the way in rather than a decoration.
 *
 * Each blocker is an upright box that may be rotated about the vertical
 * axis (the station building sits at the track's bearing, not on the World
 * axes). Collision is resolved in the box's own frame, which makes it a
 * plain 2D problem: convert the player's position into that frame, and if
 * it lands inside the rectangle, push it out through the nearest face.
 */
export interface Blocker {
  /** Centre of the box in World space. */
  centre: THREE.Vector3;
  /** Half extents along the box's own x / y / z. */
  halfExtents: THREE.Vector3;
  /** Rotation of the box about the World's Y axis, in radians. */
  yaw: number;
}

const PLAYER_RADIUS_M = 0.32;

const UP = new THREE.Vector3(0, 1, 0);
const OFFSET = new THREE.Vector3();
const PUSH = new THREE.Vector3();

/** Builds an upright blocker from a box expressed in some object's local
 * frame, given that object's world position and yaw. */
export function blockerFromLocalBox(
  origin: THREE.Vector3,
  yaw: number,
  localMin: THREE.Vector3,
  localMax: THREE.Vector3,
): Blocker {
  const localCentre = new THREE.Vector3().addVectors(localMin, localMax).multiplyScalar(0.5);
  const half = new THREE.Vector3().subVectors(localMax, localMin).multiplyScalar(0.5);
  const rotated = localCentre.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
  return {
    centre: new THREE.Vector3().addVectors(origin, rotated),
    halfExtents: half,
    yaw,
  };
}

export class CollisionWorld {
  private readonly blockers: Blocker[] = [];

  add(blocker: Blocker): void {
    this.blockers.push(blocker);
  }

  addAll(blockers: Blocker[]): void {
    for (const blocker of blockers) this.blockers.push(blocker);
  }

  get count(): number {
    return this.blockers.length;
  }

  /**
   * Pushes `position` out of anything it has ended up inside. Mutates and
   * returns the vector. Vertical extent is respected, so the player can walk
   * under a canopy but not through the wall beneath it.
   */
  resolve(position: THREE.Vector3, eyeHeight: number): THREE.Vector3 {
    // The player is a vertical capsule; test the span they actually occupy.
    const feet = position.y - eyeHeight;
    const head = position.y;

    for (const blocker of this.blockers) {
      const bottom = blocker.centre.y - blocker.halfExtents.y;
      const top = blocker.centre.y + blocker.halfExtents.y;
      if (head < bottom || feet > top) continue;

      // Into the blocker's own frame. The rotation is done with three's own
      // applyAxisAngle rather than a hand-written matrix, so it is certain to
      // be the exact inverse of the one blockerFromLocalBox used to place the
      // box — writing that inverse out by hand got the sign convention
      // backwards and silently rotated every blocker the wrong way.
      OFFSET.set(position.x - blocker.centre.x, 0, position.z - blocker.centre.z)
        .applyAxisAngle(UP, -blocker.yaw);

      const limitX = blocker.halfExtents.x + PLAYER_RADIUS_M;
      const limitZ = blocker.halfExtents.z + PLAYER_RADIUS_M;
      const overlapX = limitX - Math.abs(OFFSET.x);
      const overlapZ = limitZ - Math.abs(OFFSET.z);
      if (overlapX <= 0 || overlapZ <= 0) continue;

      // push out along whichever axis needs the least movement
      if (overlapX < overlapZ) {
        PUSH.set(OFFSET.x >= 0 ? overlapX : -overlapX, 0, 0);
      } else {
        PUSH.set(0, 0, OFFSET.z >= 0 ? overlapZ : -overlapZ);
      }

      PUSH.applyAxisAngle(UP, blocker.yaw);
      position.x += PUSH.x;
      position.z += PUSH.z;
    }
    return position;
  }
}
