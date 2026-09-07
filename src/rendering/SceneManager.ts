import * as THREE from 'three';
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
    this.scene.fog = new THREE.Fog(0xbfd8e8, 200, 1800);

    this.camera = createCamera(window.innerWidth / window.innerHeight);

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
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
  }

  dispose(): void {
    window.removeEventListener('resize', this.onResize);
    this.renderer.setAnimationLoop(null);
    this.renderer.dispose();
  }
}
