import * as THREE from 'three';
import { createCamera } from './Camera';
import { createLighting } from './Lighting';

/**
 * Owns Scene / Camera / Renderer and the render loop only.
 * It does not know how a World's meshes are produced — callers add
 * whatever THREE.Object3D they like via `scene`.
 */
export class SceneManager {
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  readonly renderer: THREE.WebGLRenderer;

  private readonly onResize = () => this.handleResize();
  private animationHandle: ((dt: number) => void) | null = null;
  private lastTime = performance.now();

  constructor(container: HTMLElement) {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0xbfd8e8);
    this.scene.fog = new THREE.Fog(0xbfd8e8, 200, 1800);

    this.camera = createCamera(window.innerWidth / window.innerHeight);

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    container.appendChild(this.renderer.domElement);

    this.scene.add(createLighting());

    window.addEventListener('resize', this.onResize);
  }

  private handleResize(): void {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  start(onFrame: (dt: number) => void): void {
    this.animationHandle = onFrame;
    this.lastTime = performance.now();
    this.renderer.setAnimationLoop(() => this.tick());
  }

  private tick(): void {
    const now = performance.now();
    const dt = Math.min(0.1, (now - this.lastTime) / 1000);
    this.lastTime = now;
    this.animationHandle?.(dt);
    this.renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    window.removeEventListener('resize', this.onResize);
    this.renderer.setAnimationLoop(null);
    this.renderer.dispose();
  }
}
