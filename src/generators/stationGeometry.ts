import * as THREE from 'three';

/**
 * Directive 08: low-level mesh-building helpers for the station building's
 * roof shapes. Extracted the same way ribbon.ts is shared by Road/Railway —
 * this is math, not a rendering pipeline of its own, so BuildingGenerator
 * remains the only Generator involved (Directive 08 §1: "駅舎専用の別
 * Rendererを作らない").
 *
 * All shapes are authored in a "building-local" frame: +X = across the
 * building's width, +Y = up, +Z = from the rear (track-side) wall toward
 * the front (public-side) wall. BuildingGenerator is responsible for
 * transforming a THREE.Group in this frame into world space.
 */

function pushTri(positions: number[], a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3): void {
  positions.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
}

function finishGeometry(positions: number[]): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
  geometry.computeVertexNormals();
  return geometry;
}

/**
 * A symmetric gable roof: ridge running along X at `ridgeY`, sloping down
 * to `eaveY` at z = ±halfDepth, spanning x = ±halfWidth. Closed with
 * triangular gable-end walls at both ends (winding verified by hand so
 * every face's outward normal actually points outward — see Directive 08
 * session notes for the derivation).
 */
export function buildGableRoof(halfWidth: number, halfDepth: number, eaveY: number, ridgeY: number): THREE.BufferGeometry {
  const A = new THREE.Vector3(-halfWidth, eaveY, -halfDepth);
  const B = new THREE.Vector3(halfWidth, eaveY, -halfDepth);
  const C = new THREE.Vector3(halfWidth, eaveY, halfDepth);
  const D = new THREE.Vector3(-halfWidth, eaveY, halfDepth);
  const R0 = new THREE.Vector3(-halfWidth, ridgeY, 0);
  const R1 = new THREE.Vector3(halfWidth, ridgeY, 0);

  const positions: number[] = [];
  pushTri(positions, A, R0, R1); // rear slope
  pushTri(positions, A, R1, B);
  pushTri(positions, D, R1, R0); // front slope
  pushTri(positions, D, C, R1);
  pushTri(positions, A, D, R0); // left gable end
  pushTri(positions, B, R1, C); // right gable end
  return finishGeometry(positions);
}

/**
 * A single-slope lean-to roof (the station's ホーム側下屋 canopy):
 * attaches at `innerZ`/`innerY` (the main wall's rear eave) and slopes
 * down and outward to `outerZ`/`outerY`, spanning x = ±halfWidth.
 */
export function buildLeanToRoof(
  halfWidth: number,
  innerZ: number,
  innerY: number,
  outerZ: number,
  outerY: number,
): THREE.BufferGeometry {
  const innerL = new THREE.Vector3(-halfWidth, innerY, innerZ);
  const innerR = new THREE.Vector3(halfWidth, innerY, innerZ);
  const outerL = new THREE.Vector3(-halfWidth, outerY, outerZ);
  const outerR = new THREE.Vector3(halfWidth, outerY, outerZ);

  const positions: number[] = [];
  pushTri(positions, innerL, outerR, outerL);
  pushTri(positions, innerL, innerR, outerR);
  return finishGeometry(positions);
}

/**
 * The porch's small gable roof: a constant-height ridge at `apexY` running
 * from `backZ` to `frontZ`, eaves at `eaveY`/x=±halfWidth, closed with a
 * single triangular gable-end wall at the front (the "三角ポーチ" pediment
 * visible from the plaza) — the back end merges into the main wall and
 * needs no cap.
 */
export function buildPorchRoof(
  halfWidth: number,
  backZ: number,
  frontZ: number,
  eaveY: number,
  apexY: number,
): THREE.BufferGeometry {
  const BL = new THREE.Vector3(-halfWidth, eaveY, backZ);
  const BR = new THREE.Vector3(halfWidth, eaveY, backZ);
  const FL = new THREE.Vector3(-halfWidth, eaveY, frontZ);
  const FR = new THREE.Vector3(halfWidth, eaveY, frontZ);
  const RidgeBack = new THREE.Vector3(0, apexY, backZ);
  const RidgeFront = new THREE.Vector3(0, apexY, frontZ);

  const positions: number[] = [];
  pushTri(positions, BL, FL, RidgeBack); // left slope
  pushTri(positions, FL, RidgeFront, RidgeBack);
  pushTri(positions, BR, RidgeBack, FR); // right slope
  pushTri(positions, FR, RidgeBack, RidgeFront);
  pushTri(positions, FL, FR, RidgeFront); // front gable-end (the pediment)
  return finishGeometry(positions);
}

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
