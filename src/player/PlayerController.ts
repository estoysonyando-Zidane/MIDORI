import * as THREE from 'three';

const WALK_SPEED = 4.2; // m/s
const GRAVITY = -19.6; // m/s^2
const EYE_HEIGHT = 1.7; // m
const PITCH_LIMIT = Math.PI / 2 - 0.05;
const MOUSE_SENSITIVITY = 0.0022;
const TOUCH_LOOK_SENSITIVITY = 0.0032;
const JOYSTICK_MAX_PX = 40;

export interface PlayerControllerOptions {
  camera: THREE.PerspectiveCamera;
  domElement: HTMLElement;
  heightAt: (x: number, z: number) => number;
  start: THREE.Vector3;
  /**
   * On-screen virtual joystick element (Directive 06 §3). When present, touch
   * input inside it drives movement and touch elsewhere on `domElement`
   * drives look — this is how the iOS Safari path replaces Pointer Lock,
   * which that browser never implemented. Omit for a desktop-only setup.
   */
  joystickElement?: HTMLElement | null;
}

/**
 * First Person Controller. Desktop: WASD + mouse look via Pointer Lock.
 * Touch (Directive 06 §3, since iOS Safari has no Pointer Lock): a
 * virtual joystick for movement, drag-anywhere-else for look. Both input
 * paths feed the same movement/look state, decided per-pointer at runtime
 * rather than by a fixed "device type" flag, so a hybrid device (e.g. a
 * touchscreen laptop) gets both for free.
 *
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
  private readonly joystick: HTMLElement | null;
  private readonly joystickKnob: HTMLElement | null;
  private locked = false;

  // Touch joystick state
  private stickTouchId: number | null = null;
  private stickCenter = { x: 0, y: 0 };
  private joyX = 0;
  private joyY = 0;

  // Touch look-drag state
  private lookTouchId: number | null = null;
  private lastLookX = 0;
  private lastLookY = 0;

  private readonly onKeyDown = (e: KeyboardEvent) => this.keys.add(e.code);
  private readonly onKeyUp = (e: KeyboardEvent) => this.keys.delete(e.code);
  private readonly onMouseMove = (e: MouseEvent) => this.handleMouseMove(e);
  private readonly onPointerLockChange = () => {
    this.locked = document.pointerLockElement === this.domElement;
  };
  private readonly onClick = () => {
    // iOS Safari has no Pointer Lock API at all; requesting it there would
    // throw. Touch input never needs it (look is driven by drag instead).
    if (this.domElement.requestPointerLock) this.domElement.requestPointerLock();
  };
  private readonly onTouchStart = (e: TouchEvent) => this.handleTouchStart(e);
  private readonly onTouchMove = (e: TouchEvent) => this.handleTouchMove(e);
  private readonly onTouchEnd = (e: TouchEvent) => this.handleTouchEnd(e);

  constructor(options: PlayerControllerOptions) {
    this.camera = options.camera;
    this.domElement = options.domElement;
    this.heightAt = options.heightAt;
    this.position = options.start.clone();
    this.joystick = options.joystickElement ?? null;
    this.joystickKnob = this.joystick?.querySelector('.knob') ?? null;

    document.addEventListener('keydown', this.onKeyDown);
    document.addEventListener('keyup', this.onKeyUp);
    document.addEventListener('mousemove', this.onMouseMove);
    document.addEventListener('pointerlockchange', this.onPointerLockChange);
    this.domElement.addEventListener('click', this.onClick);

    // Bound to `document`, not `domElement`: the on-screen joystick is a
    // sibling <div> layered on top of the canvas, not a descendant of it, so
    // a touch landing on the joystick never bubbles to a canvas-only
    // listener. Zone (joystick vs. look) is decided by hit-testing the
    // touch's coordinates instead, which works regardless of which element
    // the browser picked as the DOM target.
    document.addEventListener('touchstart', this.onTouchStart, { passive: true });
    document.addEventListener('touchmove', this.onTouchMove, { passive: true });
    document.addEventListener('touchend', this.onTouchEnd, { passive: true });
    document.addEventListener('touchcancel', this.onTouchEnd, { passive: true });

    this.camera.position.copy(this.position);
  }

  private handleMouseMove(e: MouseEvent): void {
    if (!this.locked) return;
    this.applyLookDelta(e.movementX, e.movementY, MOUSE_SENSITIVITY);
  }

  private applyLookDelta(dx: number, dy: number, sensitivity: number): void {
    this.yaw -= dx * sensitivity;
    this.pitch -= dy * sensitivity;
    this.pitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, this.pitch));
  }

  private isInsideJoystick(clientX: number, clientY: number): boolean {
    if (!this.joystick) return false;
    const r = this.joystick.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    return Math.hypot(clientX - cx, clientY - cy) < r.width * 0.9;
  }

  private handleTouchStart(e: TouchEvent): void {
    for (const t of Array.from(e.changedTouches)) {
      if (this.stickTouchId === null && this.isInsideJoystick(t.clientX, t.clientY)) {
        this.stickTouchId = t.identifier;
        const r = this.joystick!.getBoundingClientRect();
        this.stickCenter = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      } else if (this.lookTouchId === null) {
        this.lookTouchId = t.identifier;
        this.lastLookX = t.clientX;
        this.lastLookY = t.clientY;
      }
    }
  }

  private handleTouchMove(e: TouchEvent): void {
    for (const t of Array.from(e.changedTouches)) {
      if (t.identifier === this.stickTouchId) {
        let dx = t.clientX - this.stickCenter.x;
        let dy = t.clientY - this.stickCenter.y;
        const len = Math.hypot(dx, dy);
        if (len > JOYSTICK_MAX_PX) {
          dx = (dx / len) * JOYSTICK_MAX_PX;
          dy = (dy / len) * JOYSTICK_MAX_PX;
        }
        if (this.joystickKnob) this.joystickKnob.style.transform = `translate(${dx}px, ${dy}px)`;
        this.joyX = dx / JOYSTICK_MAX_PX;
        this.joyY = dy / JOYSTICK_MAX_PX;
      } else if (t.identifier === this.lookTouchId) {
        const dx = t.clientX - this.lastLookX;
        const dy = t.clientY - this.lastLookY;
        this.lastLookX = t.clientX;
        this.lastLookY = t.clientY;
        this.applyLookDelta(dx, dy, TOUCH_LOOK_SENSITIVITY);
      }
    }
  }

  private handleTouchEnd(e: TouchEvent): void {
    for (const t of Array.from(e.changedTouches)) {
      if (t.identifier === this.stickTouchId) {
        this.stickTouchId = null;
        this.joyX = 0;
        this.joyY = 0;
        if (this.joystickKnob) this.joystickKnob.style.transform = 'translate(0, 0)';
      }
      if (t.identifier === this.lookTouchId) {
        this.lookTouchId = null;
      }
    }
  }

  update(dt: number): void {
    const forward = new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw) * -1);
    const right = new THREE.Vector3(Math.cos(this.yaw), 0, Math.sin(this.yaw));

    const move = new THREE.Vector3();
    if (this.keys.has('KeyW')) move.add(forward);
    if (this.keys.has('KeyS')) move.sub(forward);
    if (this.keys.has('KeyD')) move.add(right);
    if (this.keys.has('KeyA')) move.sub(right);
    // Joystick forward axis is inverted screen-Y (up on the stick = forward).
    move.addScaledVector(forward, -this.joyY);
    move.addScaledVector(right, this.joyX);
    if (move.lengthSq() > 1) move.normalize();
    if (move.lengthSq() > 0) {
      this.position.addScaledVector(move, WALK_SPEED * dt);
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
    document.removeEventListener('touchstart', this.onTouchStart);
    document.removeEventListener('touchmove', this.onTouchMove);
    document.removeEventListener('touchend', this.onTouchEnd);
    document.removeEventListener('touchcancel', this.onTouchEnd);
  }
}
