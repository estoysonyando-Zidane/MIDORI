import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { RealityData } from '../reality/RealityData';
import type { LocalTangentPlane } from '../core/Coordinates';
import { RAIL_HEAD_M } from './TrackGeometry';

/**
 * A railcar standing still on a track, as against the one that runs through.
 *
 * 緑 has two platform tracks, so something can be stood on the far one while
 * the line stays open — which is the whole reason a 交換駅 exists. What is
 * stood there is a placement, not a finding: Wikipedia's current entry says
 * 「夜間滞泊は設定されておらず、当駅発着列車は知床斜里に留置され」, so a car
 * left at 緑 is not something this World can claim about 2010-05-30. The
 * feature's own note says so, and says who asked for it.
 *
 * The model sits with its wheels on the rail head, like the running train,
 * and is turned to the track's own bearing.
 */
export class StabledRailcar {
  static async create(options: {
    feature: RealityData;
    modelUrl: string;
    tangentPlane: LocalTangentPlane;
    heightAt: (x: number, z: number) => number;
  }): Promise<THREE.Group> {
    const { feature, tangentPlane, heightAt } = options;
    const [lon, lat] = feature.geometry.coordinates as [number, number];
    const local = tangentPlane.project(lat, lon);

    const gltf = await new GLTFLoader().loadAsync(options.modelUrl);
    const model = gltf.scene;
    model.traverse((node) => {
      const mesh = node as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
    });

    const group = new THREE.Group();
    group.name = feature.id;
    group.userData.realityData = feature;
    group.userData.inspect = { kind: 'stabled_railcar' };
    group.add(model);
    group.position.set(local.x, heightAt(local.x, local.z) + RAIL_HEAD_M, local.z);
    // The GLB is exported Y-up with the car's length on local X and its nose
    // at +X — which is why TrainController orients a running car by making a
    // basis out of (tangent, up, side). A standing car is oriented the same
    // way, from the bearing it is facing rather than from a route tangent,
    // so the two cannot drift apart.
    const facing = ((feature.properties.facing_bearing_deg as number | undefined) ?? 0) * (Math.PI / 180);
    const up = new THREE.Vector3(0, 1, 0);
    const tangent = new THREE.Vector3(Math.sin(facing), 0, -Math.cos(facing));
    const side = new THREE.Vector3().crossVectors(tangent, up).normalize();
    group.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(tangent, up, side));
    return group;
  }
}
