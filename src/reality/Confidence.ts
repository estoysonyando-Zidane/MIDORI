/**
 * How certain we are that a piece of Reality Data reflects the real world
 * at the World's target date.
 *
 * A = Confirmed     — verified against a primary source for the target date.
 * B = Reconstructed — derived from a source that does not directly cover
 *                     the target date (e.g. present-day survey data used to
 *                     infer a historical feature that is known to be stable).
 * C = Assumed       — a reasonable guess with no direct source.
 * U = Unknown       — existence/position for the target date is not established.
 */
export type Confidence = 'A' | 'B' | 'C' | 'U';

export const CONFIDENCE_LABEL: Record<Confidence, string> = {
  A: 'Confirmed',
  B: 'Reconstructed',
  C: 'Assumed',
  U: 'Unknown',
};
