const EARTH_RADIUS_M = 6378137; // WGS84 equatorial radius

/**
 * Converts geographic coordinates (WGS84 lat/lon) into World-local
 * Three.js coordinates, via a Local Tangent Plane centered on the
 * World origin.
 *
 * This is the ONLY place lat/lon is allowed to turn into engine
 * coordinates — geometry generators must consume LocalPosition, never
 * raw lat/lon.
 *
 *   X = East   (meters from origin)
 *   Y = Up     (elevation, meters)
 *   Z = North  (meters from origin) — but Three.js is right-handed with
 *              -Z as "forward", so we store North as -Z to match the
 *              conventional camera-forward direction.
 */
export interface LocalPosition {
  x: number;
  y: number;
  z: number;
}

export class LocalTangentPlane {
  constructor(
    private readonly originLat: number,
    private readonly originLon: number,
  ) {}

  /** Projects a [lat, lon] pair (optionally with elevation) to local meters. */
  project(lat: number, lon: number, elevation = 0): LocalPosition {
    const latRad = (this.originLat * Math.PI) / 180;
    const dLat = ((lat - this.originLat) * Math.PI) / 180;
    const dLon = ((lon - this.originLon) * Math.PI) / 180;

    const north = dLat * EARTH_RADIUS_M;
    const east = dLon * EARTH_RADIUS_M * Math.cos(latRad);

    return { x: east, y: elevation, z: -north };
  }

  /** Inverse of project(), ignoring elevation. Useful for debug readouts. */
  unproject(x: number, z: number): [number, number] {
    const latRad = (this.originLat * Math.PI) / 180;
    const north = -z;
    const east = x;

    const dLat = north / EARTH_RADIUS_M;
    const dLon = east / (EARTH_RADIUS_M * Math.cos(latRad));

    const lat = this.originLat + (dLat * 180) / Math.PI;
    const lon = this.originLon + (dLon * 180) / Math.PI;
    return [lat, lon];
  }

  get origin(): [number, number] {
    return [this.originLat, this.originLon];
  }
}
