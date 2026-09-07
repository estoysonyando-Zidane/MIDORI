import * as THREE from 'three';

/**
 * Photographic materials for the station building.
 *
 * The building's surfaces used to be flat colours derived from a handful of
 * numbers read off a photograph — which threw away almost everything the
 * photograph contained. These map the photograph itself onto the model: the
 * facade with its real window arrangement, mural, signage and rust streaks;
 * the siding's board lines; the roof's standing seams.
 *
 * Source: SRC_PHOTO_SET_USER_2026, the near-orthographic front elevation.
 * The crops are rectangular regions of that one frame, so the arrangement
 * and proportions come from the building rather than from a reconstruction
 * of it.
 */

export interface StationTextureSet {
  facade: THREE.Texture;
  pediment: THREE.Texture;
  siding: THREE.Texture;
  roof: THREE.Texture;
}

/** Real-world size of one tile of the siding crop, in metres. Taken from the
 * region of the photograph the crop came from, so the board lines land at
 * their true spacing however large the wall is. */
const SIDING_TILE_M = { width: 1.49, height: 0.715 };
/** Same, for the roof's standing seams. */
const ROOF_TILE_M = { width: 3.13, height: 0.462 };

function load(loader: THREE.TextureLoader, url: string, renderer: THREE.WebGLRenderer): THREE.Texture {
  const texture = loader.load(url);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
  return texture;
}

export function loadStationTextures(baseUrl: string, renderer: THREE.WebGLRenderer): StationTextureSet {
  const loader = new THREE.TextureLoader();
  const dir = `${baseUrl}assets/textures/`;

  const facade = load(loader, `${dir}midori_facade.jpg`, renderer);
  facade.wrapS = THREE.ClampToEdgeWrapping;
  facade.wrapT = THREE.ClampToEdgeWrapping;
  // The model's UVs run u along the building's +X, which is the viewer's
  // right when standing in front of the facade — the same direction the
  // photograph runs, so u needs no flip. v runs upward, but between
  // Blender's glTF export convention and three's own flip the image arrives
  // upside down, so only v is inverted. Doing it here rather than in the
  // geometry keeps the UVs meaning what they say.
  facade.center.set(0.5, 0.5);
  facade.repeat.set(1, -1);

  const pediment = load(loader, `${dir}midori_pediment.jpg`, renderer);
  pediment.wrapS = THREE.ClampToEdgeWrapping;
  pediment.wrapT = THREE.ClampToEdgeWrapping;
  // No flip here: unlike the facade, the pediment is mapped onto geometry
  // built in this file with UVs written directly, so the glTF export
  // convention that inverts the facade's v never applies to it.

  const siding = load(loader, `${dir}midori_siding.jpg`, renderer);
  siding.wrapS = THREE.RepeatWrapping;
  siding.wrapT = THREE.RepeatWrapping;
  // the model's non-facade UVs are in metres, so the repeat is 1/tile size
  siding.repeat.set(1 / SIDING_TILE_M.width, 1 / SIDING_TILE_M.height);

  const roof = load(loader, `${dir}midori_roof.jpg`, renderer);
  roof.wrapS = THREE.RepeatWrapping;
  roof.wrapT = THREE.RepeatWrapping;
  roof.repeat.set(1 / ROOF_TILE_M.width, 1 / ROOF_TILE_M.height);

  return { facade, pediment, siding, roof };
}

/**
 * Attaches the photographic maps to the materials the glTF asset arrives
 * with, matched by the names the Blender script gives them.
 *
 * The base colours stay as they are: a colour map multiplies the material's
 * colour, so leaving a tinted base would tint the photograph. Anything the
 * photograph covers is set to white so the image comes through as itself.
 */
export function applyStationTextures(root: THREE.Object3D, textures: StationTextureSet): void {
  const seen = new Set<THREE.Material>();
  root.traverse((node) => {
    const mesh = node as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.castShadow = true;
    mesh.receiveShadow = true;

    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const material of materials) {
      if (seen.has(material)) continue;
      seen.add(material);
      const standard = material as THREE.MeshStandardMaterial;
      switch (material.name) {
        case 'Facade_Photo':
          standard.map = textures.facade;
          standard.color.setRGB(1, 1, 1);
          standard.emissiveIntensity = 0;
          break;
        case 'Siding_PaleMint':
          standard.map = textures.siding;
          standard.color.setRGB(1, 1, 1);
          standard.emissiveIntensity = 0;
          break;
        case 'Roof_Metal':
          standard.map = textures.roof;
          standard.color.setRGB(1, 1, 1);
          break;
        default:
          continue;
      }
      standard.needsUpdate = true;
    }
  });
}
