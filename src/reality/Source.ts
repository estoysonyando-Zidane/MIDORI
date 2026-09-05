/**
 * A record describing where a piece of Reality Data came from, matching
 * the shape stored in a World's evidence/sources.json (Directive 02 §22).
 * Reality Data never drops its source_ids — this is what keeps
 * "AI-completed" data from silently becoming "historical fact".
 */
export interface SourceDescriptor {
  id: string;
  provider: string;
  dataset_name: string;
  url: string | null;
  /** Present for document-style sources that have no URL (Directive 02 §22). */
  document_title?: string;
  publisher?: string;
  access_date?: string;
  data_date?: string | null;
  publication_date?: string | null;
  license?: string;
  description: string;
  /** Whether this source is known to describe the World's target date. */
  temporal_coverage: 'target-date' | 'current' | 'unknown';
  /** Whether this source was actually retrieved this session, vs. just identified as a candidate. */
  status:
    | 'acquired'
    | 'acquired_indirectly'
    | 'acquired_as_operator_assertion'
    | 'not_acquired'
    | 'synthetic_not_real';
}

export interface SourceRegistry {
  world_id: string;
  sources: SourceDescriptor[];
}
