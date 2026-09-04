/**
 * A record describing where a piece of Reality Data came from.
 * Reality Data never drops its source_ids — this is what keeps
 * "AI-completed" data from silently becoming "historical fact".
 */
export interface SourceDescriptor {
  id: string;
  /** Human-readable provenance, e.g. "OpenStreetMap way 12345" or "SYNTHETIC / TEST DATA". */
  label: string;
  /** ISO date the source data was captured/retrieved, if known. */
  retrievedAt?: string;
  /** Whether this source is known to describe the World's target date. */
  temporalCoverage: 'target-date' | 'current' | 'unknown';
}
