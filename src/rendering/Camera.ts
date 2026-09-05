import * as THREE from 'three';

export function createCamera(aspect: number): THREE.PerspectiveCamera {
  const camera = new THREE.PerspectiveCamera(70, aspect, 0.1, 4000);
  return camera;
}
