import * as THREE from 'three';

const WALK_SPEED = 4.2; // m/s
const GRAVITY = -19.6; // m/s^2
const EYE_HEIGHT = 1.7; // m
const PITCH_LIMIT = Math.PI / 2 - 0.05;

export interface PlayerControllerOptions {
  camera: THREE.PerspectiveCamera;
  domElement: HTMLElement;
  heightAt: (x: number, z: number) => number;
  start: THREE.Vector3;
}

/**
 * Minimal First Person Controller: WASD + mouse look (pointer lock),
 * gravity + ground detection against the Terrain's height field.
 * No jump, no collision with roads/buildings/railway — those are
 * explicitly out of scope for this PoC (Directive 01 §17).
 */
export class PlayerController {
  readonly position: THREE.Vector3;
  private velocityY = 0;
  private yaw = 0;
  private pitch = 0;

  private readonly keys = new Set<string>();
  private readonly camera: THREE.PerspectiveCamera;
  private readonly domElement: HTMLElement;
  private readonly heightAt: (x: number, z: number) => number;
  private locked = false;

  private readonly onKeyDown = (e: KeyboardEvent) => this.keys.add(e.code);
  private readonly onKeyUp = (e: KeyboardEvent) => this.keys.delete(e.code);
  private readonly onMouseMove = (e: MouseEvent) => this.handleMouseMove(e);
  private readonly onPointerLockChange = () => {
    this.locked = document.pointerLockElement === this.domElement;
  };
  private readonly onClick = () => this.domElement.requestPointerLock();

  constructor(options: PlayerControllerOptions) {
    this.camera = options.camera;
    this.domElement = options.domElement;
    this.heightAt = options.heightAt;
    this.position = options.start.clone();

    document.addEventListener('keydown', this.onKeyDown);
    document.addEventListener('keyup', this.onKeyUp);
    document.addEventListener('mousemove', this.onMouseMove);
    document.addEventListener('pointerlockchange', this.onPointerLockChange);
    this.domElement.addEventListener('click', this.onClick);

    this.camera.position.copy(this.position);
  }

  private handleMouseMove(e: MouseEvent): void {
    if (!this.locked) return;
    const sensitivity = 0.0022;
    this.yaw -= e.movementX * sensitivity;
    this.pitch -= e.movementY * sensitivity;
    this.pitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, this.pitch));
  }

  update(dt: number): void {
    const forward = new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw) * -1);
    const right = new THREE.Vector3(Math.cos(this.yaw), 0, Math.sin(this.yaw));

    const move = new THREE.Vector3();
    if (this.keys.has('KeyW')) move.add(forward);
    if (this.keys.has('KeyS')) move.sub(forward);
    if (this.keys.has('KeyD')) move.add(right);
    if (this.keys.has('KeyA')) move.sub(right);
    if (move.lengthSq() > 0) {
      move.normalize().multiplyScalar(WALK_SPEED * dt);
      this.position.add(move);
    }

    const ground = this.heightAt(this.position.x, this.position.z) + EYE_HEIGHT;
    this.velocityY += GRAVITY * dt;
    this.position.y += this.velocityY * dt;
    if (this.position.y <= ground) {
      this.position.y = ground;
      this.velocityY = 0;
    }

    this.camera.position.copy(this.position);
    const euler = new THREE.Euler(this.pitch, this.yaw, 0, 'YXZ');
    this.camera.quaternion.setFromEuler(euler);
  }

  dispose(): void {
    document.removeEventListener('keydown', this.onKeyDown);
    document.removeEventListener('keyup', this.onKeyUp);
    document.removeEventListener('mousemove', this.onMouseMove);
    document.removeEventListener('pointerlockchange', this.onPointerLockChange);
    this.domElement.removeEventListener('click', this.onClick);
  }
}
