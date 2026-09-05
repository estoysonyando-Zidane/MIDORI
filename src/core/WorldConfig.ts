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
  /**
   * Directive 02 §1-2: declares whether this World's Reality Data is meant
   * to represent the target date via sourced evidence ('historical_reconstruction')
   * or is simply a snapshot of present-day data ('current_snapshot'). Optional
   * and additive — a World predating this field is implicitly 'current_snapshot'.
   */
  reality_mode?: 'historical_reconstruction' | 'current_snapshot';
  /** Relative paths (under this world's data directory) to Reality Data files. */
  data: {
    dem?: string;
    railway?: string;
    roads?: string;
    buildings?: string;
    poi?: string;
    events?: string;
  };
  /** Relative paths to this World's provenance records (Directive 02 §22-24). */
  evidence?: {
    sources?: string;
    reconstruction?: string;
    acquisition_manifest?: string;
    reality_audit?: string;
  };
}
