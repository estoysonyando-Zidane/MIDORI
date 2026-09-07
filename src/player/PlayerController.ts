import * as THREE from 'three';
import type { Settings } from '../state/Settings';

// Directive 07 §3: 4.2 m/s (~15 km/h) was a light jog, not a walk — average
// adult walking pace is ~1.4 m/s (5 km/h). Set to a brisk-but-plausible
// walking speed rather than the literal average, since the World's 2000m
// radius would otherwise take a very long time to cross on foot.
const WALK_SPEED = 1.6; // m/s
const GRAVITY = -19.6; // m/s^2
const EYE_HEIGHT = 1.7; // m
const PITCH_LIMIT = Math.PI / 2 - 0.05;
const MOUSE_SENSITIVITY = 0.0022;
// Directive 07 §3: lowered from 0.0032 — on a phone-sized drag range, the
// original value made it easy to overshoot a target heading.
const TOUCH_LOOK_SENSITIVITY = 0.0026;
const JOYSTICK_MAX_PX = 40;

// Directive 09.1 §6: there is no free-fly camera in this PoC, so "raise the
// camera high enough to see the Spatial Index overlay" is a single toggle
// (key M / a touch button) that flies to a fixed high vantage above the
// World origin and back, rather than continuous player-controlled altitude.
// The overlay's own visibility is still driven by actual height-above-ground
// (see main.ts), not by this flag, so a future free-fly control would just
// work without any change there.
const OVERVIEW_HEIGHT_M = 1300; // above the terrain height at the World origin
const OVERVIEW_PITCH = -1.35; // rad, close to straight down (a plan-ish view, not a grazing horizon shot)
const OVERVIEW_TRANSITION_S = 1.1;

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
  /** Live invert-axis settings (Directive 07 §1); read every look-delta. */
  settings: Settings;
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
  private readonly joystickRod: HTMLElement | null;
  private readonly settings: Settings;
  private locked = false;

  // Directive 09.1 §6: overview mode fly-to state
  private overviewActive = false;
  private transitioning = false;
  private transitionT = 0;
  private readonly transitionFrom = { pos: new THREE.Vector3(), yaw: 0, pitch: 0 };
  private readonly transitionTo = { pos: new THREE.Vector3(), yaw: 0, pitch: 0 };
  private readonly savedGroundState = { pos: new THREE.Vector3(), yaw: 0, pitch: 0 };
  private readonly onOverviewKeyDown = (e: KeyboardEvent) => {
    if (e.code === 'KeyM') this.toggleOverview();
  };

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
    this.joystickRod = this.joystick?.querySelector('.rod') ?? null;
    this.settings = options.settings;

    document.addEventListener('keydown', this.onKeyDown);
    document.addEventListener('keydown', this.onOverviewKeyDown);
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
    // Directive 07 §1: default is "grab the world and drag" (map/globe
    // style) — dragging left reveals what was to the right, dragging down
    // reveals the sky — which is the sign-flip of the typical FPS
    // mouse-look default (yaw/pitch -= delta). Each axis is independently
    // toggleable back to that typical convention via Settings.
    const xSign = this.settings.invertLookX ? 1 : -1;
    const ySign = this.settings.invertLookY ? 1 : -1;
    this.yaw += dx * sensitivity * xSign;
    this.pitch += dy * sensitivity * ySign;
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
        this.updateJoystickVisual(dx, dy);
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

  /**
   * Directive 07 §2: the knob translates toward the finger (as before) and
   * now also tilts in 3D like a real analog stick, plus a "rod" connecting
   * it back to the base center so the lean direction and magnitude read at
   * a glance rather than requiring the player to track a floating dot.
   */
  private updateJoystickVisual(dx: number, dy: number): void {
    if (this.joystickKnob) {
      const tiltX = (dy / JOYSTICK_MAX_PX) * 22; // deg: drag down tilts knob "away" (top recedes)
      const tiltY = (dx / JOYSTICK_MAX_PX) * -22; // deg: drag right tilts knob toward the viewer's right
      this.joystickKnob.style.transform =
        `translate(${dx}px, ${dy}px) rotateX(${tiltX}deg) rotateY(${tiltY}deg)`;
    }
    if (this.joystickRod) {
      const len = Math.hypot(dx, dy);
      if (len < 1) {
        this.joystickRod.style.opacity = '0';
      } else {
        const angleDeg = (Math.atan2(dy, dx) * 180) / Math.PI;
        this.joystickRod.style.opacity = '1';
        this.joystickRod.style.width = `${len}px`;
        this.joystickRod.style.transform = `rotate(${angleDeg}deg)`;
      }
    }
  }

  private handleTouchEnd(e: TouchEvent): void {
    for (const t of Array.from(e.changedTouches)) {
      if (t.identifier === this.stickTouchId) {
        this.stickTouchId = null;
        this.joyX = 0;
        this.joyY = 0;
        this.updateJoystickVisual(0, 0);
      }
      if (t.identifier === this.lookTouchId) {
        this.lookTouchId = null;
      }
    }
  }

  /** Directive 09.1 §6: flies to (or back from) a fixed high vantage above
   * the World origin. Also callable from a touch button (no 'M' key). */
  toggleOverview(): void {
    if (this.transitioning) return;
    this.transitionFrom.pos.copy(this.position);
    this.transitionFrom.yaw = this.yaw;
    this.transitionFrom.pitch = this.pitch;
    if (!this.overviewActive) {
      this.savedGroundState.pos.copy(this.position);
      this.savedGroundState.yaw = this.yaw;
      this.savedGroundState.pitch = this.pitch;
      const groundY = this.heightAt(0, 0);
      this.transitionTo.pos.set(0, groundY + OVERVIEW_HEIGHT_M, 0);
      this.transitionTo.yaw = this.yaw;
      this.transitionTo.pitch = OVERVIEW_PITCH;
      this.overviewActive = true;
    } else {
      this.transitionTo.pos.copy(this.savedGroundState.pos);
      this.transitionTo.yaw = this.savedGroundState.yaw;
      this.transitionTo.pitch = this.savedGroundState.pitch;
      this.overviewActive = false;
    }
    this.transitioning = true;
    this.transitionT = 0;
  }

  isOverview(): boolean {
    return this.overviewActive;
  }

  update(dt: number): void {
    if (this.transitioning) {
      this.transitionT = Math.min(1, this.transitionT + dt / OVERVIEW_TRANSITION_S);
      const t = this.transitionT * this.transitionT * (3 - 2 * this.transitionT); // smoothstep
      this.position.lerpVectors(this.transitionFrom.pos, this.transitionTo.pos, t);
      this.yaw = this.transitionFrom.yaw + (this.transitionTo.yaw - this.transitionFrom.yaw) * t;
      this.pitch = this.transitionFrom.pitch + (this.transitionTo.pitch - this.transitionFrom.pitch) * t;
      this.camera.position.copy(this.position);
      this.camera.quaternion.setFromEuler(new THREE.Euler(this.pitch, this.yaw, 0, 'YXZ'));
      if (this.transitionT >= 1) this.transitioning = false;
      return;
    }
    if (this.overviewActive) {
      // Parked at the overview vantage — no WASD/gravity, but still free to
      // look around from here via the same mouse/touch handlers.
      this.camera.position.copy(this.position);
      this.camera.quaternion.setFromEuler(new THREE.Euler(this.pitch, this.yaw, 0, 'YXZ'));
      return;
    }

    // Directive 07 §2: derived via the same Euler math used below for
    // `camera.quaternion.setFromEuler`, rather than a hand-written sin/cos
    // pair. The previous hand-written formula silently diverged from the
    // camera's real facing direction away from yaw 0/180° (maximally wrong,
    // fully mirrored, at yaw ±90°) — pressing "forward" at those headings
    // moved the player sideways relative to what they were looking at. This
    // guarantees movement is always relative to where the camera actually
    // faces.
    const lookEuler = new THREE.Euler(0, this.yaw, 0, 'YXZ');
    const forward = new THREE.Vector3(0, 0, -1).applyEuler(lookEuler);
    const right = new THREE.Vector3(1, 0, 0).applyEuler(lookEuler);

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
    document.removeEventListener('keydown', this.onOverviewKeyDown);
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
