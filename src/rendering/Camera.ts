import * as THREE from 'three';

export function createCamera(aspect: number): THREE.PerspectiveCamera {
  // The far plane has to reach past the far terrain, or the horizon is
  // simply clipped away: at 4,000 m 斜里岳 at 18 km was never drawn at all,
  // which looks exactly like the far terrain not having been added.
  //
  // 0.3 m near instead of 0.1 keeps the depth ratio down to 200,000; the
  // renderer's logarithmic depth buffer covers the rest.
  const camera = new THREE.PerspectiveCamera(70, aspect, 0.3, 60000);
  return camera;
}
