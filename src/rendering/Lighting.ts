import * as THREE from 'three';

/**
 * Sun and sky for the World's target moment.
 *
 * This used to be "a plain directional sun standing in for real solar
 * position data" pointed at an arbitrary direction, which happened to leave
 * the station's facade in shadow from every approach — the building read as
 * flat grey no matter what colour its materials actually were. That was
 * diagnosed as a material problem more than once; it was a lighting problem.
 *
 * The direction below is the sun's actual position over 緑 (43.72°N,
 * 144.51°E) on a late-May morning, the World's target date: azimuth about
 * 97° (a little south of due east) at about 45° altitude. The station's
 * facade looks ENE, so the morning sun falls across it, which is also when
 * the photographs the building was measured from were taken.
 *
 * Converted into the World's local tangent plane, where +X is east, +Y is
 * up and −Z is north:
 *     east  = sin(azimuth) · cos(altitude)
 *     north = cos(azimuth) · cos(altitude)      (so z = −north)
 *     up    = sin(altitude)
 */
const SUN_AZIMUTH_DEG = 97;
const SUN_ALTITUDE_DEG = 45;
const SUN_DISTANCE_M = 400;

function sunPosition(): THREE.Vector3 {
  const azimuth = THREE.MathUtils.degToRad(SUN_AZIMUTH_DEG);
  const altitude = THREE.MathUtils.degToRad(SUN_ALTITUDE_DEG);
  const horizontal = Math.cos(altitude);
  return new THREE.Vector3(
    Math.sin(azimuth) * horizontal,
    Math.sin(altitude),
    -Math.cos(azimuth) * horizontal,
  ).multiplyScalar(SUN_DISTANCE_M);
}

export function createLighting(): THREE.Group {
  const group = new THREE.Group();
  group.name = 'Lighting';

  const sun = new THREE.DirectionalLight(0xfff3e2, 2.0);
  sun.position.copy(sunPosition());

  // Shadows. Without them nothing in the World sits on the ground — every
  // object floats on its own flat shading, which reads as a diagram rather
  // than a place. The map is focused on the station and its surroundings
  // rather than the whole 2 km World, because a shadow map stretched over
  // the whole terrain resolves nothing at the scale a person walking around
  // actually looks at.
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 900;
  sun.shadow.camera.left = -90;
  sun.shadow.camera.right = 90;
  sun.shadow.camera.top = 90;
  sun.shadow.camera.bottom = -90;
  sun.shadow.bias = -0.0006;
  sun.shadow.normalBias = 0.03;
  group.add(sun);
  group.add(sun.target);

  // Sky-and-ground bounce. A single flat ambient term made every surface
  // facing away from the sun collapse to the same grey; a hemisphere light
  // fills those faces with sky colour from above and with the colour of the
  // ground below, so a cream wall still reads as cream in shade.
  const sky = new THREE.HemisphereLight(0xcfe0ee, 0x6f7a52, 0.85);
  group.add(sky);

  return group;
}
