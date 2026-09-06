import type { Confidence } from '../reality/Confidence';
import type { EvidenceType } from '../reality/EvidenceType';

/**
 * Directive 09: the Spatial Index is a layer ABOVE Reality Data — it only
 * ever answers "what is here, where, how sure, how far along". It never
 * carries appearance (color/material/dimensions/texture/3D shape); that
 * stays the responsibility of Reality Data, referenced via `detail_ref`.
 * Collapsing this separation turns the Index into a second spec document
 * with its own drift risk — see Directive 09 §2.1.
 */
export type FrontierStatus = 'defined' | 'stub' | 'undefined';

export type EntityCategory =
  | 'railway_station'
  | 'railway_line'
  | 'road'
  | 'river'
  | 'building'
  | 'facility'
  | 'forest'
  | 'farmland'
  | 'settlement'
  | 'plaza'
  | 'administrative_boundary'
  | 'poi';

export type IndexGeometry =
  | { type: 'Point'; coordinates: [number, number] }
  | { type: 'LineString'; coordinates: [number, number][] }
  | { type: 'MultiLineString'; coordinates: [number, number][][] }
  | { type: 'Polygon'; coordinates: [number, number][][] };

export interface SpatialEntity {
  id: string;
  name: string | null;
  category: EntityCategory;
  geometry_type: 'point' | 'line' | 'polygon';
  geometry: IndexGeometry;
  confidence: Confidence;
  evidence_type?: EvidenceType;
  source_ids: string[];
  frontier_status: FrontierStatus;
  /** Path (relative to the World dir) + optional "#featureId" into Reality
   * Data holding this entity's actual appearance. Null for a stub. */
  detail_ref: string | null;
  orientation?: { facade_bearing_deg: number; note: string };
  note?: string | null;
}

export interface SpatialIndexFile {
  place_path: string;
  name: string;
  parent: string | null;
  coordinate_system: string;
  extent: IndexGeometry;
  frontier_status: FrontierStatus;
  entities: SpatialEntity[];
  last_updated: string;
}

export interface FrontierArea {
  id: string;
  status: FrontierStatus;
  extent: IndexGeometry | Record<string, never>;
  note: string;
}

export interface FrontierFile {
  place_path: string;
  defined_extent: IndexGeometry;
  areas: FrontierArea[];
  next_recommended: string[];
}
