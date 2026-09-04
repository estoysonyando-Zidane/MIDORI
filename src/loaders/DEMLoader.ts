import type { Confidence } from '../reality/Confidence';
import type { HistoricalStatus } from '../reality/RealityData';

/**
 * A regular height grid, in the units the source DEM was published in
 * (this project targets ~5m posting GSI DEM data). Rows run north->south,
 * columns run west->east, matching typical raster DEM layout.
 */
export interface HeightFieldSource {
  /** Grid corners in WGS84, describing the extent the heights cover. */
  bounds: {
    west: number;
    east: number;
    south: number;
    north: number;
  };
  cols: number;
  rows: number;
  /** Meters between adjacent posts, if uniform. Informational only. */
  resolution_m: number;
  /** row-major heights in meters, length === cols * rows. */
  heights: number[];
  confidence: Confidence;
  source_ids: string[];
  historical_status: HistoricalStatus;
  /**
   * Directive 02 §11: the DEM's own survey/measurement date, kept distinct
   * from the World's target_date — a DEM must never be treated as proof of
   * terrain shape on a date it wasn't measured on.
   */
  terrain_evidence_date?: string | null;
}

/**
 * Loads a normalized height-grid JSON. Real DEM rasters (GeoTIFF etc.) would
 * be pre-processed into this same shape by a build step — TerrainGenerator
 * never touches raster formats directly, only this normalized grid.
 */
export class DEMLoader {
  static async load(url: string): Promise<HeightFieldSource> {
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`DEMLoader: failed to fetch ${url} (${res.status})`);
    }
    return (await res.json()) as HeightFieldSource;
  }

  /** Bilinear height lookup at an arbitrary lat/lon within bounds. */
  static sample(field: HeightFieldSource, lat: number, lon: number): number {
    const { bounds, cols, rows, heights } = field;
    const u = ((lon - bounds.west) / (bounds.east - bounds.west)) * (cols - 1);
    const v = ((bounds.north - lat) / (bounds.north - bounds.south)) * (rows - 1);

    const u0 = Math.max(0, Math.min(cols - 1, Math.floor(u)));
    const v0 = Math.max(0, Math.min(rows - 1, Math.floor(v)));
    const u1 = Math.min(cols - 1, u0 + 1);
    const v1 = Math.min(rows - 1, v0 + 1);
    const fu = u - u0;
    const fv = v - v0;

    const h = (c: number, r: number) => heights[r * cols + c];
    const top = h(u0, v0) * (1 - fu) + h(u1, v0) * fu;
    const bottom = h(u0, v1) * (1 - fu) + h(u1, v1) * fu;
    return top * (1 - fv) + bottom * fv;
  }
}
