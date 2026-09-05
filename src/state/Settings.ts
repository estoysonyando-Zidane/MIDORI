/**
 * In-app control settings (Directive 07 §1). Not persisted to localStorage —
 * the object is created once at bootstrap and mutated in place by whatever
 * UI toggles it; PlayerController reads the same reference every frame.
 *
 * Default is the "grab the world and drag" convention (map/globe-style):
 * dragging left reveals what was to the right, dragging down reveals the
 * sky. This is the opposite of the typical FPS mouse-look default, so both
 * axes are individually toggleable back to that convention.
 */
export class Settings {
  invertLookX = true;
  invertLookY = true;
}
