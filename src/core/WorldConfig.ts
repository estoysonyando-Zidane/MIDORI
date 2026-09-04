export interface WorldOrigin {
  type: 'poi' | 'latlon';
  /** POI id, when type === 'poi'. */
  id?: string;
  /** [lat, lon], when type === 'latlon'. */
  latlon?: [number, number];
}

export interface WorldBounds {
  type: 'radius';
  radius_m: number;
}

export interface WorldLocation {
  country: string;
  prefecture: string;
  municipality: string;
  district: string;
}

/**
 * The declarative definition of a World: place x date, and nothing else.
 * No World-specific value may be hardcoded outside of this file's data —
 * changing place/date means loading a different WorldConfig, not editing code.
 */
export interface WorldConfig {
  world_id: string;
  name: string;
  location: WorldLocation;
  date: string; // ISO date, the World's target date
  timezone: string;
  coordinate_system: 'WGS84';
  origin: WorldOrigin;
  bounds: WorldBounds;
  /** Relative paths (under this world's data directory) to Reality Data files. */
  data: {
    dem?: string;
    railway?: string;
    roads?: string;
    buildings?: string;
    poi?: string;
  };
}
