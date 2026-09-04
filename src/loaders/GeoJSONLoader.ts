import type { Confidence } from '../reality/Confidence';
import type { HistoricalStatus, RealityData, RealityFeatureType, RealityGeometry } from '../reality/RealityData';

/**
 * Minimal GeoJSON shape we accept as Raw Source input. We only support the
 * geometry types RealityData itself supports (Point / LineString / Polygon) —
 * anything richer than that belongs to a future loader, not this one.
 */
interface RawGeoJSONFeature {
  type: 'Feature';
  geometry: RealityGeometry;
  properties: Record<string, unknown> & {
    id?: string;
    confidence?: Confidence;
    source_ids?: string[];
    historical_status?: HistoricalStatus;
  };
}

interface RawGeoJSONFeatureCollection {
  type: 'FeatureCollection';
  features: RawGeoJSONFeature[];
}

/**
 * Normalizes a Raw Source GeoJSON FeatureCollection into RealityData.
 *
 * This is the boundary described by Directive 01 §8: Raw Source -> Normalized
 * Data. A feature missing explicit confidence/source_ids/historical_status is
 * NOT silently trusted — it is normalized as confidence "U" / historical_status
 * "unknown" rather than assumed to be reliable.
 */
export class GeoJSONLoader {
  static parse(
    raw: RawGeoJSONFeatureCollection,
    featureType: RealityFeatureType,
    idPrefix: string,
  ): RealityData[] {
    return raw.features.map((feature, index) => {
      const { id, confidence, source_ids, historical_status, ...properties } = feature.properties;
      return {
        id: id ?? `${idPrefix}_${index.toString().padStart(3, '0')}`,
        type: featureType,
        geometry: feature.geometry,
        properties,
        confidence: confidence ?? 'U',
        source_ids: source_ids ?? [],
        historical_status: historical_status ?? 'unknown',
      } satisfies RealityData;
    });
  }

  static async load(
    url: string,
    featureType: RealityFeatureType,
    idPrefix: string,
  ): Promise<RealityData[]> {
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`GeoJSONLoader: failed to fetch ${url} (${res.status})`);
    }
    const raw = (await res.json()) as RawGeoJSONFeatureCollection;
    return GeoJSONLoader.parse(raw, featureType, idPrefix);
  }
}
