import type { Confidence } from './Confidence';
import type { EvidenceType } from './EvidenceType';

export type RealityGeometry =
  | { type: 'Point'; coordinates: [number, number] }
  | { type: 'LineString'; coordinates: [number, number][] }
  | { type: 'Polygon'; coordinates: [number, number][][] };

export type RealityFeatureType = 'terrain' | 'railway' | 'road' | 'building' | 'poi' | 'event';

/**
 * Whether a feature is known to have existed, in its recorded form,
 * at the World's target date. This is intentionally separate from
 * `confidence`: a feature can be positionally confirmed (A) while its
 * historical existence at the target date is still unknown.
 */
export type HistoricalStatus = 'confirmed' | 'plausible' | 'unknown' | 'current-only';

/**
 * The normalized unit that flows from Loaders into Generators.
 * Raw GIS payloads are never passed to a Generator directly —
 * they must first be normalized into RealityData.
 */
export interface RealityData<P extends Record<string, unknown> = Record<string, unknown>> {
  id: string;
  type: RealityFeatureType;
  geometry: RealityGeometry;
  properties: P;
  confidence: Confidence;
  source_ids: string[];
  historical_status: HistoricalStatus;
  /**
   * Directive 08 / spec v1.1 §1: what kind of evidence this feature rests
   * on, separate from `confidence`. Optional and NOT defaulted to a guess —
   * a feature normalized without one is genuinely evidence_type-unknown
   * (flagged by the validator as a warning, not silently assumed).
   */
  evidence_type?: EvidenceType;
}
