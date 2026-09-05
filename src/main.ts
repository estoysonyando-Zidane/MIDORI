import * as THREE from 'three';
import { WorldLoader } from './loaders/WorldLoader';
import { TerrainGenerator } from './generators/TerrainGenerator';
import { RailwayGenerator } from './generators/RailwayGenerator';
import { RoadGenerator } from './generators/RoadGenerator';
import { BuildingGenerator } from './generators/BuildingGenerator';
import { SceneManager } from './rendering/SceneManager';
import { PlayerController } from './player/PlayerController';
import { DebugMode } from './debug/DebugMode';

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

  if (IS_TOUCH_DEVICE) document.body.classList.add('touch-controls');

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
  });

  debugToggleTouch?.addEventListener('click', () => debugMode.toggle());

  if (IS_TOUCH_DEVICE) {
    // iOS Safari has no Pointer Lock to wait on — a tap just dismisses the
    // blocker and hands input straight to PlayerController's touch handlers.
    blocker.addEventListener(
      'touchstart',
      () => blocker.classList.add('hidden'),
      { once: true },
    );
  } else {
    blocker.addEventListener('click', () => sceneManager.renderer.domElement.requestPointerLock());
    document.addEventListener('pointerlockchange', () => {
      const locked = document.pointerLockElement === sceneManager.renderer.domElement;
      blocker.classList.toggle('hidden', locked);
    });
  }

  sceneManager.start((dt) => {
    player.update(dt);
    debugMode.update(player.position);
  });
}

bootstrap().catch((err) => {
  console.error(err);
  const blocker = document.getElementById('blocker');
  if (blocker) {
    blocker.textContent = `World load failed: ${(err as Error).message}`;
  }
});
