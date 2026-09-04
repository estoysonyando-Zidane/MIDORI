import type { WorldConfig } from '../core/WorldConfig';
import { LocalTangentPlane } from '../core/Coordinates';
import { World } from '../core/World';
import type { RealityData } from '../reality/RealityData';
import type { SourceRegistry } from '../reality/Source';
import type { ReconstructionLog } from '../reality/Reconstruction';
import { GeoJSONLoader } from './GeoJSONLoader';
import { DEMLoader, type HeightFieldSource } from './DEMLoader';

export interface LoadedWorld {
  world: World;
  heightField: HeightFieldSource | null;
}

/**
 * Orchestrates the full Reality Data -> World pipeline for a single World:
 *   world.json (config) -> POI/railway/road/building GeoJSON -> DEM grid
 *   -> World origin resolution -> World instance.
 *
 * Generators are NOT invoked here — WorldLoader's job stops at producing
 * normalized RealityData and a resolved coordinate frame.
 */
export class WorldLoader {
  static async load(worldDirUrl: string): Promise<LoadedWorld> {
    const configRes = await fetch(`${worldDirUrl}/world.json`);
    if (!configRes.ok) {
      throw new Error(`WorldLoader: failed to fetch world.json from ${worldDirUrl}`);
    }
    const config = (await configRes.json()) as WorldConfig;

    const realityData: RealityData[] = [];

    let poiData: RealityData[] = [];
    if (config.data.poi) {
      poiData = await GeoJSONLoader.load(`${worldDirUrl}/${config.data.poi}`, 'poi', 'POI');
      realityData.push(...poiData);
    }

    if (config.data.railway) {
      realityData.push(
        ...(await GeoJSONLoader.load(`${worldDirUrl}/${config.data.railway}`, 'railway', 'RAIL')),
      );
    }

    if (config.data.roads) {
      realityData.push(
        ...(await GeoJSONLoader.load(`${worldDirUrl}/${config.data.roads}`, 'road', 'ROAD')),
      );
    }

    if (config.data.buildings) {
      realityData.push(
        ...(await GeoJSONLoader.load(`${worldDirUrl}/${config.data.buildings}`, 'building', 'BLDG')),
      );
    }

    if (config.data.events) {
      realityData.push(
        ...(await GeoJSONLoader.load(`${worldDirUrl}/${config.data.events}`, 'event', 'EVENT')),
      );
    }

    let heightField: HeightFieldSource | null = null;
    if (config.data.dem) {
      heightField = await DEMLoader.load(`${worldDirUrl}/${config.data.dem}`);
    }

    let sources: SourceRegistry['sources'] = [];
    if (config.evidence?.sources) {
      const res = await fetch(`${worldDirUrl}/${config.evidence.sources}`);
      if (res.ok) sources = ((await res.json()) as SourceRegistry).sources;
    }

    let reconstruction: ReconstructionLog['records'] = [];
    if (config.evidence?.reconstruction) {
      const res = await fetch(`${worldDirUrl}/${config.evidence.reconstruction}`);
      if (res.ok) reconstruction = ((await res.json()) as ReconstructionLog).records;
    }

    const [originLat, originLon] = WorldLoader.resolveOrigin(config, poiData);
    const tangentPlane = new LocalTangentPlane(originLat, originLon);

    const world = new World(config, tangentPlane, realityData, sources, reconstruction);
    return { world, heightField };
  }

  private static resolveOrigin(config: WorldConfig, poiData: RealityData[]): [number, number] {
    if (config.origin.type === 'latlon' && config.origin.latlon) {
      return config.origin.latlon;
    }
    if (config.origin.type === 'poi' && config.origin.id) {
      const poi = poiData.find((p) => p.id === config.origin.id);
      if (poi && poi.geometry.type === 'Point') {
        const [lon, lat] = poi.geometry.coordinates;
        return [lat, lon];
      }
      throw new Error(`WorldLoader: origin POI "${config.origin.id}" not found in POI data`);
    }
    throw new Error('WorldLoader: WorldConfig.origin could not be resolved');
  }
}
