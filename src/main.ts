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

// Directive 09.1 §6: how high above the actual ground (not sea level) the
// camera must be before the Index overlay appears. Tied to real
// height-above-ground rather than the overview-toggle flag, so a future
// free-fly camera would trigger it too, without any change here.
const OVERVIEW_AGL_THRESHOLD_M = 50;

// Directive 06 §1: resolves under whatever `base` vite.config.ts is built
// with (e.g. '/MIDORI/' on GitHub Pages), instead of assuming the app is
// served from the domain root.
const WORLD_URL = `${import.meta.env.BASE_URL}data/worlds/JP_HOKKAIDO_KIYOSATO_MIDORI_20100530`;

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
    const terrain = TerrainGenerator.generate(heightField, world.tangentPlane);
    heightAt = terrain.heightAt;
    world.group.add(terrain.mesh);
  }

  world.group.add(RailwayGenerator.generate(world.find('railway'), world.tangentPlane, heightAt));
  world.group.add(RoadGenerator.generate(world.find('road'), world.tangentPlane, heightAt));
  world.group.add(BuildingGenerator.generate(world.find('building'), world.tangentPlane, heightAt));

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
  const startY = heightAt(startX, startZ);
  const player = new PlayerController({
    camera: sceneManager.camera,
    domElement: sceneManager.renderer.domElement,
    heightAt,
    start: new THREE.Vector3(startX, startY, startZ),
    joystickElement: joystick,
    settings,
  });

  debugToggleTouch?.addEventListener('click', () => debugMode.toggle());
  overviewToggleTouch?.addEventListener('click', () => player.toggleOverview());

  // Directive 09.1 §6: the Spatial Index is now overlaid directly inside
  // the 3D World (no separate /map page) once the camera is far enough
  // above the ground — see the AGL check in the render loop below. Failure
  // to load must never block the World itself; the overlay just stays off.
  let indexOverlay: IndexOverlay | null = null;
  let groundFog: THREE.Fog | THREE.FogExp2 | null = null;
  SpatialIndexLoader.load('JP.01.546.MIDORI', import.meta.env.BASE_URL)
    .then((index) => {
      const byStatus = index.entities.reduce<Record<string, number>>((acc, e) => {
        acc[e.frontier_status] = (acc[e.frontier_status] ?? 0) + 1;
        return acc;
      }, {});
      debugMode.setSpatialIndexSummary(
        `${index.place_path} — ${index.entities.length} entities (${JSON.stringify(byStatus)})`,
      );
      indexOverlay = new IndexOverlay(
        indexOverlaySvg,
        unlocatedListEl,
        sceneManager.camera,
        sceneManager.renderer,
        world.tangentPlane,
        index,
      );
    })
    .catch((err) => console.warn('SpatialIndexLoader: not loaded', err));

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
    debugMode.update(player.position);

    // Directive 09.1 §6: overlay/credit/unlocated-list visibility follows
    // actual height above ground, not the overview-toggle flag directly.
    const agl = player.position.y - heightAt(player.position.x, player.position.z);
    const showOverlay = agl > OVERVIEW_AGL_THRESHOLD_M;
    osmCredit.style.display = showOverlay ? 'block' : 'none';
    document.body.classList.toggle('overview-mode', showOverlay);
    if (indexOverlay) {
      indexOverlay.setVisible(showOverlay);
      indexOverlay.update(heightAt);
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
