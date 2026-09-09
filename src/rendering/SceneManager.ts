import * as THREE from 'three';
import { noteRenderedFrame } from '../debug/WorldInspect';
import { createCamera } from './Camera';
import { createLighting } from './Lighting';

/**
 * A sky-and-ground probe for the World's metal surfaces.
 *
 * A metal in a physically-based renderer is almost entirely reflection: with
 * nothing to reflect it renders near-black, which is why the railcar's
 * stainless body came out as flat grey no matter what colour it was given.
 * This is a two-stop gradient — sky above, ground below — prefiltered into an
 * environment map, so metal picks up bright sky on its upper faces and dark
 * ground underneath, the way it does outdoors.
 */
function buildSkyEnvironment(renderer: THREE.WebGLRenderer): THREE.Texture {
  const probe = new THREE.Scene();
  const geometry = new THREE.SphereGeometry(1, 24, 16);
  const material = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    uniforms: {
      sky: { value: new THREE.Color(0xc4dcee) },
      horizon: { value: new THREE.Color(0xdfe7ea) },
      ground: { value: new THREE.Color(0x4d5340) },
    },
    vertexShader: `
      varying vec3 vDirection;
      void main() {
        vDirection = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform vec3 sky; uniform vec3 horizon; uniform vec3 ground;
      varying vec3 vDirection;
      void main() {
        float h = vDirection.y;
        vec3 c = h > 0.0 ? mix(horizon, sky, pow(h, 0.6)) : mix(horizon, ground, pow(-h, 0.5));
        gl_FragColor = vec4(c, 1.0);
      }
    `,
  });
  probe.add(new THREE.Mesh(geometry, material));

  const pmrem = new THREE.PMREMGenerator(renderer);
  const target = pmrem.fromScene(probe);
  pmrem.dispose();
  geometry.dispose();
  material.dispose();
  return target.texture;
}

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
    // Aerial perspective, not a curtain.
    //
    // Linear fog from 200 m to 1,800 m turned everything past the World's own
    // edge into flat sky — which was fine while there was nothing out there,
    // and wrong the moment 斜里岳 arrived 18 km east. Real distance haze
    // fades a mountain toward the sky colour without erasing it: exponential
    // falloff at this density leaves about a third of the contrast at 18 km,
    // which is what the range looks like from 緑 on a clear day.
    this.scene.fog = new THREE.FogExp2(0xbfd8e8, 0.00006);

    this.camera = createCamera(window.innerWidth / window.innerHeight);

    // A 60 km far plane needs a depth buffer that can hold it: without this
    // the near World z-fights itself.
    this.renderer = new THREE.WebGLRenderer({ antialias: true, logarithmicDepthBuffer: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    // Without tone mapping the renderer clamps anything over white, so a lit
    // interior turned into a flat white blob around each lamp and the sunlit
    // walls lost their surface. A filmic curve compresses those highlights
    // back into range and keeps the shaded side off pure black, which is what
    // a camera does and what makes the two sides of a wall read as one wall.
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.35;
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    container.appendChild(this.renderer.domElement);

    this.scene.add(createLighting());
    this.scene.environment = buildSkyEnvironment(this.renderer);
    // The hemisphere light already fills unlit faces with sky and ground
    // colour; the probe now does the same job with direction, so it is
    // dialled back rather than added on top of it.
    this.scene.environmentIntensity = 0.55;

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
    // The inspection surface counts real frames, so automated checks can
    // wait on rendering rather than on wall-clock time — at under 1 fps in
    // the headless rasteriser a timeout is a guess, not a wait.
    noteRenderedFrame(this.renderer);
  }

  dispose(): void {
    window.removeEventListener('resize', this.onResize);
    this.renderer.setAnimationLoop(null);
    this.renderer.dispose();
  }
}
