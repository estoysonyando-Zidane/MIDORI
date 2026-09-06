/**
 * How certain we are that a piece of Reality Data reflects the real world
 * at the World's target date.
 *
 * A = Confirmed — directly recorded by evidence covering the target date.
 * B = Supported — reasonably derivable from evidence; a single source is
 *                 fine if its content is internally stable/consistent.
 *                 (Directive 08 / spec v1.1 §1: redefined from "Reconstructed"
 *                 — this changed the definition text only. Existing B
 *                 judgments made under the old wording are not
 *                 re-evaluated retroactively.)
 * C = Assumed    — structurally inferred; evidence is insufficient.
 * U = Unknown    — no information. Never asserted as fact.
 *
 * `confidence` alone does not say *what kind* of evidence backs a claim —
 * see EvidenceType for that. The two are recorded separately so that, e.g.,
 * a single Wikipedia sentence can never by itself justify confidence A.
 */
export type Confidence = 'A' | 'B' | 'C' | 'U';

export const CONFIDENCE_LABEL: Record<Confidence, string> = {
  A: 'Confirmed',
  B: 'Supported',
  C: 'Assumed',
  U: 'Unknown',
};
