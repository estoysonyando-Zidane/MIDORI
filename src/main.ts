import * as THREE from 'three';
import { WorldLoader } from './loaders/WorldLoader';
import { TerrainGenerator } from './generators/TerrainGenerator';
import { RailwayGenerator } from './generators/RailwayGenerator';
import { RoadGenerator } from './generators/RoadGenerator';
import { BuildingGenerator } from './generators/BuildingGenerator';
import { SceneManager } from './rendering/SceneManager';
import { PlayerController } from './player/PlayerController';
import { DebugMode } from './debug/DebugMode';
import { Settings } from './state/Settings';
import { SpatialIndexLoader } from './spatial/SpatialIndexLoader';
import { IndexOverlay } from './spatial/IndexOverlay';
import { CollisionWorld } from './player/Collision';
import { TrainController } from './generators/TrainController';
import { loadStationTextures } from './generators/stationTextures';
import { VegetationGenerator } from './generators/VegetationGenerator';
import { CanopyMask } from './generators/CanopyMask';
import { StationTerrace } from './generators/StationTerrace';
import { TownGenerator } from './generators/TownGenerator';
import type { Blocker } from './player/Collision';
import type { ResolvedPosition } from './generators/BuildingGenerator';

const PLACE_PATH = 'JP.01.546.MIDORI';

// Directive 09.1 §6: how high above the actual ground (not sea level) the
// camera must be before the Index overlay appears. Tied to real
// height-above-ground rather than the overview-toggle flag, so a future
// free-fly camera would trigger it too, without any change here.
const OVERVIEW_AGL_THRESHOLD_M = 50;

// Directive 06 §1: resolves under whatever `base` vite.config.ts is built
// with (e.g. '/MIDORI/' on GitHub Pages), instead of assuming the app is
// served from the domain root.
const WORLD_URL = `${import.meta.env.BASE_URL}data/worlds/JP_HOKKAIDO_KIYOSATO_MIDORI_20100530`;

// Directive 11 §3.3: the station building's solid form, authored in Blender
// from spec v1.2 and exported as engine-neutral glTF.
const STATION_MODEL_URL = `${import.meta.env.BASE_URL}assets/models/midori_station.glb`;

// キハ54形500番台 — the railcar that worked these services through 緑駅.
const RAILCAR_MODEL_URL = `${import.meta.env.BASE_URL}assets/models/kiha54.glb`;

const IS_TOUCH_DEVICE = 'ontouchstart' in window || navigator.maxTouchPoints > 0;

async function bootstrap(): Promise<void> {
  const app = document.getElementById('app') as HTMLElement;
  const blocker = document.getElementById('blocker') as HTMLElement;
  const joystick = document.getElementById('joystick');
  const debugToggleTouch = document.getElementById('debugToggleTouch');
  const overviewToggleTouch = document.getElementById('overviewToggleTouch');
  const indexOverlaySvg = document.getElementById('indexOverlay') as unknown as SVGSVGElement;
  const unlocatedListEl = document.getElementById('unlocatedList') as HTMLElement;
  const osmCredit = document.getElementById('osmCredit') as HTMLElement;
  const settingsToggle = document.getElementById('settingsToggle');
  const settingsPanel = document.getElementById('settingsPanel');
  const invertXToggle = document.getElementById('invertXToggle') as HTMLInputElement | null;
  const invertYToggle = document.getElementById('invertYToggle') as HTMLInputElement | null;
  const hint = document.getElementById('hint');

  if (IS_TOUCH_DEVICE) document.body.classList.add('touch-controls');

  // Directive 07 §1: in-app state, not localStorage — resets each load.
  const settings = new Settings();
  if (invertXToggle) invertXToggle.checked = settings.invertLookX;
  if (invertYToggle) invertYToggle.checked = settings.invertLookY;
  invertXToggle?.addEventListener('change', () => {
    settings.invertLookX = invertXToggle.checked;
  });
  invertYToggle?.addEventListener('change', () => {
    settings.invertLookY = invertYToggle.checked;
  });
  settingsToggle?.addEventListener('click', () => {
    settingsPanel?.classList.toggle('open');
  });

  const { world, heightField } = await WorldLoader.load(WORLD_URL);

  const sceneManager = new SceneManager(app);

  let heightAt = (_x: number, _z: number) => 0;

  if (heightField) {
    // 国土地理院's own aerial photography, resampled onto the DEM's grid, so
    // the ground carries the real fields, forest edges, tracks and yards
    // instead of one flat green. 出典: 国土地理院「シームレス空中写真」.
    const terrain = TerrainGenerator.generate(heightField, world.tangentPlane, {
      orthophotoUrl: `${import.meta.env.BASE_URL}assets/textures/midori_orthophoto.jpg`,
      renderer: sceneManager.renderer,
    });
    heightAt = terrain.heightAt;
    world.group.add(terrain.mesh);
  }

  // Directive 10 §2/AC08: the station building's position must come from
  // the Spatial Index, not a hardcoded Reality Data polygon — so the Index
  // is fetched here, before generation, rather than only afterward for the
  // debug/overview overlay as in Directive 09. If this fails, the station
  // building is simply not generated (no fallback coordinate) — everything
  // else in the World is unaffected.
  let spatialIndex: Awaited<ReturnType<typeof SpatialIndexLoader.load>> | null = null;
  try {
    spatialIndex = await SpatialIndexLoader.load(PLACE_PATH, import.meta.env.BASE_URL);
  } catch (err) {
    console.warn('SpatialIndexLoader: not loaded', err);
  }

  // The station's yard stands about 1.25 m above the ground the rails are
  // laid on — the forecourt, the station floor and the platform deck are all
  // one level in every photograph. `heightAt` is the bare DEM and knows
  // nothing about that. `groundAt` is the same terrain with that terrace
  // raised over the footprints Reality Data carries, ramped at the edges so
  // it can be walked up.
  //
  // This has to be built BEFORE the roads: 駅前通り runs onto the terrace to
  // reach the station, and laid at bare DEM height it was buried under the
  // bank — the road simply stopped in a field short of the building.
  const terrace = new StationTerrace(world.find('building'), world.tangentPlane);
  const groundAt = terrace.wrap(heightAt);

  // The railway keeps the bare terrain: the track is what the terrace is
  // measured up from, and it is the one thing that must not rise with it.
  world.group.add(RailwayGenerator.generate(world.find('railway'), world.tangentPlane, heightAt));
  world.group.add(RoadGenerator.generate(world.find('road'), world.tangentPlane, groundAt));
  world.group.add(BuildingGenerator.generate(world.find('building'), world.tangentPlane, heightAt));

  // 緑町 itself — about 300 OpenStreetMap footprints, each given a roof so
  // the street reads as the row of low houses with coloured tin roofs the
  // photographs show. See scripts/import-osm-town.mjs for what in this is
  // survey data (the outlines) and what is not (everything above them).
  world.group.add(TownGenerator.generate(world.find('building'), world.tangentPlane, heightAt));

  // Structures the player cannot walk through — currently the station
  // building's walls, so its waiting room is a room you enter through the
  // door rather than a shape you pass through.
  const collision = new CollisionWorld();

  // Photographic surfaces for the station — the facade, the siding's board
  // lines and the roof's standing seams, cropped from the front elevation.
  const stationTextures = loadStationTextures(import.meta.env.BASE_URL, sceneManager.renderer);

  // Where the station stands in the World — the train stops at the point on
  // the line closest to it. Falls back to the World origin if the station
  // could not be placed.
  let stationWorldPosition = new THREE.Vector3();

  const stationBuildingEntity = spatialIndex?.entities.find((e) => e.id === `${PLACE_PATH}/STATION_BUILDING`);
  const stationBuildingFeature = world.findById('STR_MIDORI_STATION_BUILDING');
  if (stationBuildingEntity?.geometry?.type === 'Point' && stationBuildingEntity.orientation && stationBuildingFeature) {
    const [lon, lat] = stationBuildingEntity.geometry.coordinates;
    const position: ResolvedPosition = { lat, lon, facadeBearingDeg: stationBuildingEntity.orientation.facade_bearing_deg };
    try {
      const stationGroup = await BuildingGenerator.generateStationBuilding(
        stationBuildingFeature,
        position,
        world.tangentPlane,
        heightAt,
        STATION_MODEL_URL,
        stationTextures,
      );
      world.group.add(stationGroup);
      stationWorldPosition = stationGroup.position.clone();
      collision.addAll((stationGroup.userData.blockers as Blocker[] | undefined) ?? []);
    } catch (err) {
      // Directive 11 §4: the station's solid form is an external glTF asset
      // now, so it can fail to load where generated geometry could not. The
      // rest of the World must still come up.
      console.warn('Station building not generated: model failed to load', err);
    }
  } else {
    console.warn('Station building not generated: Spatial Index entity or Reality Data feature missing.');
  }

  // A train working the line through the station. It runs on the same
  // railway centreline the trackbed is drawn from, stopping at whichever
  // point on the line is closest to the station building.
  let train: TrainController | null = null;
  try {
    train = await TrainController.create({
      railways: world.find('railway'),
      tangentPlane: world.tangentPlane,
      heightAt,
      modelUrl: RAILCAR_MODEL_URL,
      platformAt: stationWorldPosition,
    });
    if (train) world.group.add(train.group);
  } catch (err) {
    console.warn('Train not generated: model or route unavailable', err);
  }

  // The forest. Every photograph of 緑 has trees in it; the World had none,
  // which did more than anything else to make it read as a diagram rather
  // than a place. Scenery, not Reality Data — that the site is wooded is
  // evidence, where any individual tree stands is not.
  {
    const keepClearOf: THREE.Vector3[][] = [];
    for (const feature of [...world.find('railway'), ...world.find('road')]) {
      if (feature.geometry.type !== 'LineString') continue;
      keepClearOf.push((feature.geometry.coordinates as [number, number][]).map(([lon, lat]) => {
        const p = world.tangentPlane.project(lat, lon);
        return new THREE.Vector3(p.x, 0, p.z);
      }));
    }
    // Every building and open-ground footprint becomes a circle the scatter
    // steps around, so the forest stops at the settlement instead of growing
    // through it.
    const keepClearOfCircles = world.find('building')
      .filter((f) => f.geometry.type === 'Polygon')
      .map((f) => {
        const ring = (f.geometry.coordinates as [number, number][][])[0];
        let x = 0;
        let z = 0;
        const n = ring.length - 1;
        let maxR = 0;
        for (let i = 0; i < n; i++) {
          const local = world.tangentPlane.project(ring[i][1], ring[i][0]);
          x += local.x / n;
          z += local.z / n;
        }
        for (let i = 0; i < n; i++) {
          const local = world.tangentPlane.project(ring[i][1], ring[i][0]);
          maxR = Math.max(maxR, Math.hypot(local.x - x, local.z - z));
        }
        return { x, z, radius: maxR + 5 };
      });

    // Where the forest is, off 国土地理院's photograph rather than off a
    // random number generator. If it cannot be loaded the scatter still
    // runs, just without knowing the ground — the World does not fail
    // because a derived asset is missing.
    let canopy: CanopyMask | undefined;
    try {
      const response = await fetch(`${import.meta.env.BASE_URL}assets/textures/midori_canopy.json`);
      if (response.ok) canopy = new CanopyMask(await response.json(), world.tangentPlane);
    } catch {
      canopy = undefined;
    }

    world.group.add(VegetationGenerator.generate({
      heightAt,
      clearingCentre: stationWorldPosition,
      clearingRadiusM: canopy ? 12 : 33,
      // The mask reaches as far as the photograph does, so the wood can now
      // run to the hills instead of stopping at a 640 m ring.
      extentM: canopy ? 900 : 640,
      keepClearOf,
      keepClearRadiusM: 13,
      keepClearOfCircles,
      canopyAt: canopy ? (x, z) => canopy.at(x, z) : undefined,
      count: canopy ? 18000 : 7000,
    }));
  }

  sceneManager.scene.add(world.group);
  const debugMode = new DebugMode(world);
  sceneManager.scene.add(debugMode.group);

  // Player starts near the Midori Station POI, offset off the railway
  // centerline so they never spawn standing on the tracks.
  const stationPoi = world.find('poi').find((p) => p.id === 'LOC_MIDORI_STATION');
  let startX = 15;
  let startZ = 10;
  if (stationPoi && stationPoi.geometry.type === 'Point') {
    const [lon, lat] = stationPoi.geometry.coordinates;
    const local = world.tangentPlane.project(lat, lon);
    startX = local.x + 15;
    startZ = local.z + 10;
  }
  const startY = groundAt(startX, startZ);
  const player = new PlayerController({
    camera: sceneManager.camera,
    domElement: sceneManager.renderer.domElement,
    heightAt: groundAt,
    start: new THREE.Vector3(startX, startY, startZ),
    joystickElement: joystick,
    settings,
    collision,
  });

  debugToggleTouch?.addEventListener('click', () => debugMode.toggle());
  overviewToggleTouch?.addEventListener('click', () => player.toggleOverview());

  // Directive 09.1 §6: the Spatial Index is overlaid directly inside the 3D
  // World (no separate /map page) once the camera is far enough above the
  // ground — see the AGL check in the render loop below. Reuses the same
  // fetch done above for the station building's position.
  let indexOverlay: IndexOverlay | null = null;
  let groundFog: THREE.Fog | THREE.FogExp2 | null = null;
  if (spatialIndex) {
    const byStatus = spatialIndex.entities.reduce<Record<string, number>>((acc, e) => {
      acc[e.frontier_status] = (acc[e.frontier_status] ?? 0) + 1;
      return acc;
    }, {});
    debugMode.setSpatialIndexSummary(
      `${spatialIndex.place_path} — ${spatialIndex.entities.length} entities (${JSON.stringify(byStatus)})`,
    );
    indexOverlay = new IndexOverlay(
      indexOverlaySvg,
      unlocatedListEl,
      sceneManager.camera,
      sceneManager.renderer,
      world.tangentPlane,
      spatialIndex,
    );
  }

  // Directive 07 §4: minimal one-time operation hint — shown once per app
  // load right after the blocker clears, fades on its own, or a tap/click
  // dismisses it early. Not a tutorial: one line, no steps to click through.
  const showHint = () => {
    if (!hint) return;
    hint.textContent = IS_TOUCH_DEVICE
      ? 'ドラッグで視点 ／ 左下のスティックで移動 ／ 右上「俯瞰」で全体表示'
      : 'ドラッグで視点 ／ WASD で移動 ／ M で俯瞰';
    hint.classList.add('visible');
    const dismiss = () => hint.classList.remove('visible');
    hint.addEventListener('click', dismiss, { once: true });
    setTimeout(dismiss, 4000);
  };

  if (IS_TOUCH_DEVICE) {
    // iOS Safari has no Pointer Lock to wait on — a tap just dismisses the
    // blocker and hands input straight to PlayerController's touch handlers.
    blocker.addEventListener(
      'touchstart',
      () => {
        blocker.classList.add('hidden');
        showHint();
      },
      { once: true },
    );
  } else {
    blocker.addEventListener('click', () => sceneManager.renderer.domElement.requestPointerLock());
    let hintShown = false;
    document.addEventListener('pointerlockchange', () => {
      const locked = document.pointerLockElement === sceneManager.renderer.domElement;
      blocker.classList.toggle('hidden', locked);
      if (locked && !hintShown) {
        hintShown = true;
        showHint();
      }
    });
  }

  sceneManager.start((dt) => {
    player.update(dt);
    train?.update(dt);
    debugMode.update(player.position);

    // Directive 09.1 §6: overlay/credit/unlocated-list visibility follows
    // actual height above ground, not the overview-toggle flag directly.
    const agl = player.position.y - groundAt(player.position.x, player.position.z);
    const showOverlay = agl > OVERVIEW_AGL_THRESHOLD_M;
    osmCredit.style.display = showOverlay ? 'block' : 'none';
    document.body.classList.toggle('overview-mode', showOverlay);
    if (indexOverlay) {
      indexOverlay.setVisible(showOverlay);
      indexOverlay.update(groundAt);
    }
    // The ground-level fog (near=200, far=1800) is an atmospheric effect
    // for walking around at eye level — from a high overview vantage it
    // just washes the whole World out toward flat sky-blue, so it is
    // switched off entirely while overlooking, and restored at ground level.
    if (showOverlay && sceneManager.scene.fog) {
      groundFog = sceneManager.scene.fog;
      sceneManager.scene.fog = null;
    } else if (!showOverlay && !sceneManager.scene.fog && groundFog) {
      sceneManager.scene.fog = groundFog;
    }
  });
}

bootstrap().catch((err) => {
  console.error(err);
  const blocker = document.getElementById('blocker');
  if (blocker) {
    blocker.textContent = `World load failed: ${(err as Error).message}`;
  }
});
