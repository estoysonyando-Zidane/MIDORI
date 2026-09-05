import * as THREE from 'three';

export function createLighting(): THREE.Group {
  const group = new THREE.Group();
  group.name = 'Lighting';

  // Late-May, Hokkaido: a plain directional sun standing in for real
  // solar-position data, which is out of scope for this PoC.
  const sun = new THREE.DirectionalLight(0xfff2e0, 2.2);
  sun.position.set(-120, 180, 80);
  sun.castShadow = false;
  group.add(sun);

  const ambient = new THREE.AmbientLight(0xbfd4e0, 0.6);
  group.add(ambient);

  return group;
}
