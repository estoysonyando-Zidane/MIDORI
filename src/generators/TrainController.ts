import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { RealityData } from '../reality/RealityData';
import type { LocalTangentPlane } from '../core/Coordinates';
import { RAIL_HEAD_M } from './TrackGeometry';

/**
 * A train working the 釧網本線 through 緑駅.
 *
 * The route is the railway centreline already in Reality Data (MLIT KSJ N02,
 * 2008 and 2011 editions, byte-identical across the World's target date), so
 * the train runs on the same geometry the trackbed is drawn from rather than
 * on a path invented for it.
 *
 * The line is single track and unelectrified, with a summer line speed of
 * 80 km/h; 緑 sits at 100.9 km. The stock is キハ54形500番台 — 21.30 m over
 * couplers, stainless bodied, two cars, which is what worked these services.
 *
 * TIME IS COMPRESSED. The real timetable gives 緑 four or five departures a
 * day in each direction; a World that honoured that would show a train about
 * once every four hours. `CYCLE` below is a deliberate playability choice and
 * is not a claim about the timetable.
 */

const LINE_SPEED_MPS = 80 / 3.6;      // 80 km/h summer line speed
const APPROACH_SPEED_MPS = 14;        // eased down for the 25‰ grade at 緑
const ACCELERATION_MPSS = 0.55;
const BRAKING_MPSS = 0.75;
const DWELL_S = 18;
const RUN_IN_M = 320;                 // how far out the train appears
const RUN_OUT_M = 320;                // how far past the platform it runs before recycling
const CAR_LENGTH_M = 21.3;
const CAR_GAP_M = 0.5;
const CAR_COUNT = 2;
// The railcar's own origin is the wheel contact point, so it rides at the
// rail head's height above the formation — the same figure the platform is
// measured from. See TrackGeometry.ts.
const RAIL_LIFT_M = RAIL_HEAD_M;

type Phase = 'approach' | 'dwell' | 'depart';

interface RoutePoint {
  position: THREE.Vector3;
  distance: number;
}

/**
 * Chains the railway LineStrings into one continuous route.
 *
 * The three features meet end to end but are not stored in running order, so
 * they are joined by matching endpoints rather than by assuming the order
 * they happen to appear in the file.
 */
function buildRoute(
  railways: RealityData[],
  tangentPlane: LocalTangentPlane,
  heightAt: (x: number, z: number) => number,
): RoutePoint[] {
  const chains: THREE.Vector3[][] = [];
  for (const feature of railways) {
    if (feature.geometry.type !== 'LineString') continue;
    const points = (feature.geometry.coordinates as [number, number][]).map(([lon, lat]) => {
      const local = tangentPlane.project(lat, lon);
      return new THREE.Vector3(local.x, heightAt(local.x, local.z) + RAIL_LIFT_M, local.z);
    });
    if (points.length >= 2) chains.push(points);
  }
  if (chains.length === 0) return [];

  const JOIN_TOLERANCE_M = 2;
  const route = chains.shift()!;
  let joined = true;
  while (chains.length > 0 && joined) {
    joined = false;
    for (let i = 0; i < chains.length; i++) {
      const chain = chains[i];
      const head = route[0];
      const tail = route[route.length - 1];
      if (tail.distanceTo(chain[0]) < JOIN_TOLERANCE_M) {
        route.push(...chain.slice(1));
      } else if (tail.distanceTo(chain[chain.length - 1]) < JOIN_TOLERANCE_M) {
        route.push(...chain.slice(0, -1).reverse());
      } else if (head.distanceTo(chain[chain.length - 1]) < JOIN_TOLERANCE_M) {
        route.unshift(...chain.slice(0, -1));
      } else if (head.distanceTo(chain[0]) < JOIN_TOLERANCE_M) {
        route.unshift(...chain.slice(1).reverse());
      } else {
        continue;
      }
      chains.splice(i, 1);
      joined = true;
      break;
    }
  }

  let distance = 0;
  const out: RoutePoint[] = [{ position: route[0], distance: 0 }];
  for (let i = 1; i < route.length; i++) {
    distance += route[i].distanceTo(route[i - 1]);
    out.push({ position: route[i], distance });
  }
  return out;
}

export class TrainController {
  private readonly cars: THREE.Object3D[] = [];
  private readonly route: RoutePoint[];
  private readonly stopDistance: number;
  private readonly totalLength: number;
  /** Half the formation, so the train berths alongside the station rather
   * than with its nose at it. */
  private readonly formationOffset: number;

  private phase: Phase = 'approach';
  private travelled: number;
  private speed = APPROACH_SPEED_MPS;
  private dwellRemaining = 0;

  readonly group = new THREE.Group();

  private constructor(route: RoutePoint[], stopDistance: number, model: THREE.Object3D) {
    this.group.name = 'Train_Kiha54';
    this.route = route;
    this.totalLength = route[route.length - 1].distance;
    const formationLength = CAR_COUNT * CAR_LENGTH_M + (CAR_COUNT - 1) * CAR_GAP_M;
    this.formationOffset = formationLength / 2;
    this.stopDistance = stopDistance + this.formationOffset;
    this.travelled = Math.max(0, this.stopDistance - RUN_IN_M);

    for (let i = 0; i < CAR_COUNT; i++) {
      const car = i === 0 ? model : model.clone(true);
      car.name = `Kiha54_Car_${i + 1}`;
      this.cars.push(car);
      this.group.add(car);
    }
  }

  /**
   * Loads the railcar and places it on the route, stopping at whichever point
   * on the line is closest to `platformAt`.
   */
  static async create(options: {
    railways: RealityData[];
    tangentPlane: LocalTangentPlane;
    heightAt: (x: number, z: number) => number;
    modelUrl: string;
    platformAt: THREE.Vector3;
  }): Promise<TrainController | null> {
    const route = buildRoute(options.railways, options.tangentPlane, options.heightAt);
    if (route.length < 2) return null;

    let stopDistance = route[0].distance;
    let best = Infinity;
    for (const point of route) {
      const d = point.position.distanceTo(options.platformAt);
      if (d < best) {
        best = d;
        stopDistance = point.distance;
      }
    }

    const gltf = await new GLTFLoader().loadAsync(options.modelUrl);
    gltf.scene.traverse((node) => {
      const mesh = node as THREE.Mesh;
      if (mesh.isMesh) {
        mesh.castShadow = true;
        mesh.receiveShadow = true;
      }
    });
    return new TrainController(route, stopDistance, gltf.scene);
  }

  /** Position and tangent at an arc length along the route. */
  private sample(distance: number): { position: THREE.Vector3; tangent: THREE.Vector3 } {
    const clamped = THREE.MathUtils.clamp(distance, 0, this.totalLength);
    let i = 1;
    while (i < this.route.length - 1 && this.route[i].distance < clamped) i++;
    const a = this.route[i - 1];
    const b = this.route[i];
    const span = Math.max(1e-6, b.distance - a.distance);
    const t = THREE.MathUtils.clamp((clamped - a.distance) / span, 0, 1);
    return {
      position: new THREE.Vector3().lerpVectors(a.position, b.position, t),
      tangent: new THREE.Vector3().subVectors(b.position, a.position).normalize(),
    };
  }

  update(dt: number): void {
    switch (this.phase) {
      case 'approach': {
        const remaining = this.stopDistance - this.travelled;
        // start braking at the point where the remaining distance is exactly
        // what this speed needs to stop in
        const brakingDistance = (this.speed * this.speed) / (2 * BRAKING_MPSS);
        if (remaining <= brakingDistance) {
          this.speed = Math.max(0, this.speed - BRAKING_MPSS * dt);
        } else {
          this.speed = Math.min(APPROACH_SPEED_MPS, this.speed + ACCELERATION_MPSS * dt);
        }
        this.travelled += this.speed * dt;
        if (remaining <= 0.4 || this.speed <= 0.05) {
          this.travelled = this.stopDistance;
          this.speed = 0;
          this.phase = 'dwell';
          this.dwellRemaining = DWELL_S;
        }
        break;
      }
      case 'dwell': {
        this.dwellRemaining -= dt;
        if (this.dwellRemaining <= 0) this.phase = 'depart';
        break;
      }
      case 'depart': {
        this.speed = Math.min(LINE_SPEED_MPS, this.speed + ACCELERATION_MPSS * dt);
        this.travelled += this.speed * dt;
        if (this.travelled > this.stopDistance + RUN_OUT_M || this.travelled >= this.totalLength) {
          this.travelled = Math.max(0, this.stopDistance - RUN_IN_M);
          this.speed = APPROACH_SPEED_MPS * 0.6;
          this.phase = 'approach';
        }
        break;
      }
    }

    // Place each car behind the one in front, along the route, so the
    // formation follows the curve instead of being rigid.
    const up = new THREE.Vector3(0, 1, 0);
    for (let i = 0; i < this.cars.length; i++) {
      const centre = this.travelled - i * (CAR_LENGTH_M + CAR_GAP_M) - CAR_LENGTH_M / 2;
      const { position, tangent } = this.sample(centre);
      const car = this.cars[i];
      car.position.copy(position);
      const side = new THREE.Vector3().crossVectors(tangent, up).normalize();
      car.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(tangent, up, side));
      car.visible = centre > -CAR_LENGTH_M && centre < this.totalLength + CAR_LENGTH_M;
    }
  }
}
