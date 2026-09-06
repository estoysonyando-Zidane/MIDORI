import type { SpatialIndexFile, FrontierFile } from './SpatialIndex';

/**
 * Directive 09 §8: this is the connection point a future generator can use
 * to look up an entity's Index position instead of re-deciding placement
 * the way Directive 08 had to (its own §5.3 postmortem). Nothing in the 3D
 * pipeline calls this yet — main.ts only loads it to prove the path works
 * and surface entity counts in the debug panel. The actual switch-over
 * (generators reading FROM the Index) is Directive 10's job.
 */
export class SpatialIndexLoader {
  static async load(placePath: string, baseUrl: string): Promise<SpatialIndexFile> {
    const res = await fetch(`${baseUrl}data/spatial_index/${placePath}/index.json`);
    if (!res.ok) {
      throw new Error(`SpatialIndexLoader: failed to fetch index.json for ${placePath} (${res.status})`);
    }
    return (await res.json()) as SpatialIndexFile;
  }

  static async loadFrontier(placePath: string, baseUrl: string): Promise<FrontierFile> {
    const res = await fetch(`${baseUrl}data/spatial_index/${placePath}/frontier.json`);
    if (!res.ok) {
      throw new Error(`SpatialIndexLoader: failed to fetch frontier.json for ${placePath} (${res.status})`);
    }
    return (await res.json()) as FrontierFile;
  }
}
