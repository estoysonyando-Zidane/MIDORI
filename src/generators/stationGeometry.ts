import * as THREE from 'three';

/**
 * Canvas-drawn textures for the station building's flat, sign-like elements
 * — the signboards, the station-name lettering and the mural band.
 *
 * Directive 11 §4 moved the station's SOLID geometry (foundation, walls,
 * main roof, triangular porch, platform-side canopy) out of TypeScript and
 * into a Blender-authored glTF asset, so the gable/lean-to/porch mesh
 * builders that used to live here are gone — see
 * scripts/blender/build_station.py and
 * public/assets/models/midori_station.glb.
 *
 * What remains are the planar elements Directive 11 §3.5 deliberately kept
 * on the Three.js side, because they are textures on plane polygons rather
 * than solid form. They are still authored in the same "building-local"
 * frame the GLB uses: +X across the width, +Y up, +Z from the platform side
 * toward the plaza-facing front.
 */

/** Draws simple text on a canvas and returns it as a THREE.Texture. Used for
 * the station's signage/mural (Directive 08 §4.1) rather than importing
 * font/image assets the World doesn't otherwise depend on. */
export function makeLabelTexture(
  text: string,
  opts: { bg: string; fg: string; width?: number; height?: number; fontPx?: number },
): THREE.CanvasTexture {
  const width = opts.width ?? 256;
  const height = opts.height ?? 128;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = opts.bg;
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = opts.fg;
  ctx.font = `bold ${opts.fontPx ?? 48}px "Hiragino Sans", "Noto Sans JP", sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, width / 2, height / 2);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/**
 * Simplified tree-motif mural band (spec §4.6): a horizontal strip with a
 * pink band, a yellow band, and simplified round-crowned trees, left→right
 * repeating. Not a faithful reproduction of the photographed mural — a
 * schematic standing in for it, at the confidence the spec assigns (A for
 * the motif/color/range, this rendering technique itself is not sourced).
 */
export function makeMuralTexture(widthPx = 1024, heightPx = 256): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = widthPx;
  canvas.height = heightPx;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#e8dfc8';
  ctx.fillRect(0, 0, widthPx, heightPx);
  // pink band (bottom)
  ctx.fillStyle = '#e8a0b0';
  ctx.fillRect(0, heightPx * 0.8, widthPx, heightPx * 0.2);
  // yellow band (above pink)
  ctx.fillStyle = '#e8d05a';
  ctx.fillRect(0, heightPx * 0.62, widthPx, heightPx * 0.18);
  // trees
  const treeCount = 6;
  for (let i = 0; i < treeCount; i++) {
    const cx = ((i + 0.5) / treeCount) * widthPx;
    const trunkColor = '#cfd8dc';
    const crownColors = ['#3f6fb0', '#5a4fb0', '#7ec8e3'];
    ctx.fillStyle = trunkColor;
    ctx.fillRect(cx - widthPx * 0.01, heightPx * 0.45, widthPx * 0.02, heightPx * 0.35);
    ctx.fillStyle = crownColors[i % crownColors.length];
    ctx.beginPath();
    ctx.arc(cx, heightPx * 0.38, widthPx * 0.06, Math.PI, 0);
    ctx.fill();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}
