import * as THREE from 'three';
import type { WorldConfig } from './WorldConfig';
import { LocalTangentPlane } from './Coordinates';
import type { RealityData } from '../reality/RealityData';
import type { SourceDescriptor } from '../reality/Source';
import type { ReconstructionRecord } from '../reality/Reconstruction';

/**
 * A World is the assembled result of the Reality Data -> Generator pipeline:
 * a config, a coordinate frame, the normalized Reality Data that produced it,
 * and the Three.js Group ready to be added to a Scene.
 *
 * A World has no notion of "the player" — it is a valid, complete object
 * whether or not anyone is standing in it.
 */
export class World {
  readonly config: WorldConfig;
  readonly tangentPlane: LocalTangentPlane;
  readonly realityData: RealityData[];
  readonly group: THREE.Group;
  /** Directive 02 §22: this World's provenance registry, keyed by source id. Empty if not loaded. */
  readonly sources: Map<string, SourceDescriptor>;
  /** Directive 02 §24: why each Reality Data id ended up with its confidence/status. */
  readonly reconstruction: Map<string, ReconstructionRecord>;

  constructor(
    config: WorldConfig,
    tangentPlane: LocalTangentPlane,
    realityData: RealityData[],
    sources: SourceDescriptor[] = [],
    reconstruction: ReconstructionRecord[] = [],
  ) {
    this.config = config;
    this.tangentPlane = tangentPlane;
    this.realityData = realityData;
    this.group = new THREE.Group();
    this.group.name = `World:${config.world_id}`;
    this.sources = new Map(sources.map((s) => [s.id, s]));
    this.reconstruction = new Map(reconstruction.map((r) => [r.id, r]));
  }

  find(type: RealityData['type']): RealityData[] {
    return this.realityData.filter((d) => d.type === type);
  }

  findById(id: string): RealityData | undefined {
    return this.realityData.find((d) => d.id === id);
  }
}
