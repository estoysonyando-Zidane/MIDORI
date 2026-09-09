import * as THREE from 'three';

/**
 * The World's permanent inspection surface.
 *
 * This is NOT a debug hack to be added before a screenshot and stripped
 * afterwards. It was that, and the cost of re-adding it every time is why
 * almost no automated check ever got written: five defects in one day —
 * sleepers laid along the rails, a nameboard with its neighbours reversed,
 * the station 20 m from where it belongs, a bathhouse's name on the wrong
 * building — all reached the operator's phone before anything noticed, and
 * every one of them is catchable from `dump()` without rendering a frame.
 *
 * So it ships. It is how every automated check and every screenshot sees the
 * World, and removing it removes the checks.
 *
 * What the checks need is not the scene graph. It is the JOIN between the
 * Reality Data a thing came from and the solid that was actually built for
 * it: position, orientation, size, and what the thing claims as evidence.
 * That join is where this project's defects live.
 */

/** How a thing was placed, for the checks that read `dump()`. */
export interface InspectTag {
  /** What kind of thing this is: 'sleeper', 'building', 'nameboard', ... */
  kind: string;
  /**
   * For elements repeated along a path — sleepers, fences, poles, street
   * trees — how the element's longest axis should sit relative to the
   * path's tangent. Declared where the element is generated, so a new kind
   * of repeated element brings its own assertion with it.
   */
  alongPath?: 'perpendicular' | 'parallel';
  /** The path's tangent at this element, in World XZ. */
  tangent?: [number, number];
}

export interface PlacedObject {
  id: string;
  kind: string;
  /** World metres, the centre of the object's axis-aligned bounds. */
  pos: [number, number, number];
  /** World-space extents of those bounds. */
  size: [number, number, number];
  /** The object's own longest axis in World XZ, from its rotation. */
  longAxis?: [number, number];
  alongPath?: 'perpendicular' | 'parallel';
  tangent?: [number, number];
  /** Which contiguous sample run an instance belongs to, so a check can take
   *  the path's tangent from consecutive neighbours rather than trusting a
   *  single recorded one. */
  run?: number;
  /** Reality Data id and evidence, where the object came from one. */
  featureId?: string;
  evidenceType?: string;
  confidence?: string;
  sourceIds?: string[];
}

export interface WorldInspect {
  ready: Promise<void>;
  /** Resolves after `n` frames have actually been rendered. Throws if the
   *  loop is paused, because then it would wait for ever — `look()` renders
   *  on its own and needs no frame wait. Never wait on
   *  wall-clock time: the headless rasteriser here runs at under 1 fps, so a
   *  timeout is either far too short or silently flaky on a faster machine. */
  frames(n: number): Promise<void>;
  dump(): PlacedObject[];
  /** The scene graph itself.
   *
   *  Every other method here answers one question. This one exists so a
   *  check can ask a question nobody anticipated — where the triangles go,
   *  which material is used twice, what is parented to what — without a new
   *  method being added and shipped first. That cost is why almost no check
   *  ever got written before this file existed. */
  scene(): THREE.Object3D;
  /** What the renderer itself is carrying. Draw calls and triangles are per
   *  frame; geometries, textures and programs are what is resident. These
   *  are the numbers that decide whether the World runs on a phone — frame
   *  time measured here is not, because the headless rasteriser is software
   *  and about a thousand times slower than the GPU in a handset. */
  stats(): {
    objects: number; drawCalls: number; triangles: number;
    geometries: number; textures: number; programs: number;
  };
  /**
   * Points the camera and draws one frame.
   *
   * Screenshots belong on the permanent surface for the same reason dump()
   * does: taking them used to mean adding window.__scene/__camera/__renderer
   * by hand and stripping them afterwards, which is a cost paid every time
   * and therefore a reason not to look. `at` defaults to the World origin.
   */
  look(from: [number, number, number], at?: [number, number, number]): void;
  /**
   * Stops the render loop so `look()` is the last thing drawn.
   *
   * Without it a screenshot catches whatever the player's camera drew on the
   * next frame, and every shot comes back identical — which is exactly what
   * happened, and is indistinguishable from "the change did nothing".
   */
  pause(): void;
  resume(): void;
  /** World position of a named object's bounding-box centre, for aiming. */
  centreOf(name: string): [number, number, number] | null;
  /**
   * The height of the terrain SURFACE at a point, by raycast.
   *
   * Not the height function the generators sample — the mesh that is
   * actually drawn. The two coming apart is this project's recurring defect:
   * the station floated because the terrace raised the function and not the
   * mesh. Anything that should sit on the ground can be checked against
   * this, and anything that cannot be is an assumption nobody is testing.
   */
  groundY(x: number, z: number): number | null;
}

/**
 * Instances are sampled as CONTIGUOUS RUNS, not by striding the whole set.
 *
 * A first pass strode 8,600 sleepers and compared each against one recorded
 * tangent — so sleepers a kilometre down a curving line were measured
 * against the bearing at the station and reported as violations. Runs of
 * neighbours let the check take the tangent from the elements themselves,
 * which is both correct on curves and not circular: it asks whether the
 * element lies across the line it is repeated along, rather than comparing
 * a rotation to the rotation it was built from.
 */
const SAMPLE_RUNS = 4;
const SAMPLE_RUN_LENGTH = 24;

function longAxisOf(object: THREE.Object3D, size: THREE.Vector3): [number, number] {
  // The object's local axis with the greatest extent, taken into World XZ.
  const geometry = (object as THREE.Mesh).geometry as THREE.BufferGeometry | undefined;
  const local = new THREE.Vector3(1, 0, 0);
  if (geometry) {
    geometry.computeBoundingBox();
    const b = geometry.boundingBox!;
    const e = new THREE.Vector3().subVectors(b.max, b.min);
    if (e.z > e.x && e.z > e.y) local.set(0, 0, 1);
    else if (e.y > e.x && e.y > e.z) local.set(0, 1, 0);
  } else if (size.z > size.x) {
    local.set(0, 0, 1);
  }
  const world = local.applyQuaternion(object.getWorldQuaternion(new THREE.Quaternion()));
  const length = Math.hypot(world.x, world.z);
  return length < 1e-6 ? [1, 0] : [world.x / length, world.z / length];
}

export function installWorldInspect(
  scene: THREE.Scene,
  renderer: THREE.WebGLRenderer,
  camera: THREE.PerspectiveCamera,
  ready: Promise<void>,
  resumeLoop?: () => void,
): WorldInspect {
  let frameCount = 0;
  const box = new THREE.Box3();
  const size = new THREE.Vector3();
  const centre = new THREE.Vector3();
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  const raycaster = new THREE.Raycaster();
  let paused = false;

  const inspect: WorldInspect = {
    ready,
    frames(n) {
      // A paused World renders nothing, so frameCount never reaches the
      // target and this waits for ever — a check that hangs is worse than
      // one that fails, so say so instead. After pause(), look() draws by
      // itself and no frame wait is needed.
      if (paused) {
        return Promise.reject(new Error(
          'frames() was called while the World is paused; it would never resolve. '
          + 'look() renders on its own — drop the frames() call, or resume() first.',
        ));
      }
      const target = frameCount + n;
      return new Promise<void>((resolve) => {
        const tick = () => (frameCount >= target ? resolve() : requestAnimationFrame(tick));
        tick();
      });
    },
    dump() {
      const out: PlacedObject[] = [];
      scene.traverse((object) => {
        const tag = object.userData.inspect as InspectTag | undefined;
        const feature = object.userData.realityData as
          { properties?: Record<string, unknown> } | undefined;
        if (!tag && !feature) return;

        const kind = tag?.kind
          ?? (feature?.properties?.structure_type as string | undefined)
          ?? 'feature';
        const featureId = feature?.properties?.id as string | undefined;

        const instanced = object as THREE.InstancedMesh;
        if (instanced.isInstancedMesh) {
          const matrix = new THREE.Matrix4();
          const indices: number[] = [];
          for (let r = 0; r < SAMPLE_RUNS; r++) {
            const start = Math.floor((instanced.count / SAMPLE_RUNS) * r);
            for (let k = 0; k < SAMPLE_RUN_LENGTH && start + k < instanced.count; k++) {
              indices.push(start + k);
            }
          }
          for (const i of indices) {
            instanced.getMatrixAt(i, matrix);
            matrix.premultiply(instanced.matrixWorld);
            matrix.decompose(position, quaternion, scale);
            instanced.geometry.computeBoundingBox();
            const b = instanced.geometry.boundingBox!;
            const e = new THREE.Vector3().subVectors(b.max, b.min).multiply(scale);
            const local = e.z > e.x ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(1, 0, 0);
            const world = local.applyQuaternion(quaternion);
            const length = Math.hypot(world.x, world.z) || 1;
            out.push({
              id: `${object.name || kind}#${i}`,
              run: Math.floor(indices.indexOf(i) / SAMPLE_RUN_LENGTH),
              kind,
              pos: [position.x, position.y, position.z],
              size: [e.x, e.y, e.z],
              longAxis: [world.x / length, world.z / length],
              alongPath: tag?.alongPath,
              tangent: tag?.tangent,
            });
          }
          return;
        }

        box.setFromObject(object);
        if (box.isEmpty()) return;
        box.getSize(size);
        box.getCenter(centre);
        out.push({
          id: object.name || featureId || kind,
          kind,
          pos: [centre.x, centre.y, centre.z],
          size: [size.x, size.y, size.z],
          longAxis: longAxisOf(object, size),
          alongPath: tag?.alongPath,
          tangent: tag?.tangent,
          featureId,
          evidenceType: feature?.properties?.evidence_type as string | undefined,
          confidence: feature?.properties?.confidence as string | undefined,
          sourceIds: feature?.properties?.source_ids as string[] | undefined,
        });
      });
      return out;
    },
    pause() { paused = true; renderer.setAnimationLoop(null); },
    resume() { paused = false; resumeLoop?.(); },
    look(from, at = [0, 0, 0]) {
      camera.position.set(from[0], from[1], from[2]);
      camera.lookAt(at[0], at[1], at[2]);
      camera.updateMatrixWorld(true);
      renderer.render(scene, camera);
    },
    groundY(x, z) {
      const terrain = scene.getObjectByName('Terrain');
      if (!terrain) return null;
      raycaster.set(new THREE.Vector3(x, 5000, z), new THREE.Vector3(0, -1, 0));
      const hits = raycaster.intersectObject(terrain, true);
      return hits.length > 0 ? hits[0].point.y : null;
    },
    centreOf(name) {
      const object = scene.getObjectByName(name);
      if (!object) return null;
      const bounds = new THREE.Box3().setFromObject(object);
      if (bounds.isEmpty()) return null;
      const c = bounds.getCenter(new THREE.Vector3());
      return [c.x, c.y, c.z];
    },
    scene() {
      return scene;
    },
    stats() {
      const info = renderer.info;
      let objects = 0;
      scene.traverse(() => { objects++; });
      return {
        objects,
        drawCalls: info.render.calls,
        triangles: info.render.triangles,
        geometries: info.memory.geometries,
        textures: info.memory.textures,
        programs: info.programs?.length ?? 0,
      };
    },
  };

  const countFrame = () => { frameCount++; };
  (renderer as unknown as { __onAfterFrame?: () => void }).__onAfterFrame = countFrame;
  (window as unknown as { __world: WorldInspect }).__world = inspect;
  return inspect;
}

/** Called once per rendered frame by SceneManager. */
export function noteRenderedFrame(renderer: THREE.WebGLRenderer): void {
  (renderer as unknown as { __onAfterFrame?: () => void }).__onAfterFrame?.();
}
