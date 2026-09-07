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
  | 'inference'
  /** Directive 09.1 §4: a person's own on-the-ground/on-map check (e.g.
   * reading real coordinates off a live map service) — distinct from
   * `inference` (no direct check at all) and from `official_record`
   * (a publisher's own document, not this session's/user's own act of
   * looking). */
  | 'user_survey';
