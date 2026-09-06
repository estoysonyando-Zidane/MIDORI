/**
 * What kind of evidence backs a piece of Reality Data — distinct from
 * `confidence` (how sure we are). Directive 08 / MIDORI_STATION_REALITY_SPEC
 * v1.1 §1: a source's *type* and how *certain* it makes us are separate
 * questions, so "confidence=A / evidence_type=encyclopedia" (a single
 * Wikipedia mention treated as Confirmed) is never a valid combination —
 * see the validator's evidence_type/confidence consistency check.
 */
export type EvidenceType =
  | 'contemporary_record'
  | 'contemporary_photo'
  | 'official_record'
  | 'public_gis'
  | 'encyclopedia'
  | 'satellite_imagery'
  | 'secondary_photo'
  | 'inference';
