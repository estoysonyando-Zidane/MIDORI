import type { Confidence } from './Confidence';

/**
 * Why a given piece of Reality Data ended up with the confidence/status it
 * has — Directive 02 §24. Kept as a separate, keyed record rather than
 * inline on RealityData so the reasoning trail survives independently of
 * any single geometry file, and multiple Reality Data ids can point at the
 * same reconstruction record if useful.
 */
export interface ReconstructionRecord {
  id: string;
  historical_reconstruction: {
    target_date: string;
    evidence: string[]; // SourceDescriptor ids
    confidence: Confidence;
    reason: string;
  };
}

export interface ReconstructionLog {
  world_id: string;
  records: ReconstructionRecord[];
  unresolved?: { note: string }[];
}
