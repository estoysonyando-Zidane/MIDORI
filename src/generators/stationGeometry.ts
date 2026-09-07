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
 * 腰壁の壁画 — the painted band that runs low along the station's walls.
 *
 * Redrawn from the photographs, which show something quite different from
 * what Directive 08 guessed at: a **pale blue fan-shaped tree** rising out
 * of a **yellow horizontal band**, with a **pale pink band** beneath it,
 * repeating along the wall. The fan reads as a stylised broad-crowned tree
 * with a short trunk — appropriate for a station called 緑 (green).
 *
 * `count` is how many fans fit across the wall this texture is applied to,
 * so the motif keeps a constant real-world size on walls of different
 * lengths instead of stretching.
 */
export function makeMuralTexture(count = 4, widthPx = 1024, heightPx = 256): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = widthPx;
  canvas.height = heightPx;
  const ctx = canvas.getContext('2d')!;

  // The band sits on the building's own siding colour.
  ctx.fillStyle = '#e9ebdf';
  ctx.fillRect(0, 0, widthPx, heightPx);

  const pinkTop = heightPx * 0.74;
  const yellowTop = heightPx * 0.52;

  // fans first, so the bands overlap their trunks the way the painting does
  const cell = widthPx / count;
  for (let i = 0; i < count; i++) {
    const cx = (i + 0.5) * cell;
    const crownRadius = cell * 0.30;
    const crownBase = yellowTop + heightPx * 0.06;

    ctx.fillStyle = '#9fc6e0'; // trunk, same pale blue family
    ctx.fillRect(cx - cell * 0.022, crownBase - heightPx * 0.02, cell * 0.044, heightPx * 0.24);

    // broad fan crown
    ctx.fillStyle = '#7fb6dc';
    ctx.beginPath();
    ctx.moveTo(cx, crownBase);
    ctx.arc(cx, crownBase, crownRadius, Math.PI, 0);
    ctx.closePath();
    ctx.fill();

    // a lighter inner fan gives the ribbed look the painting has
    ctx.strokeStyle = '#cfe4f2';
    ctx.lineWidth = Math.max(1, cell * 0.012);
    for (let r = 1; r <= 4; r++) {
      ctx.beginPath();
      ctx.arc(cx, crownBase, (crownRadius * r) / 5, Math.PI, 0);
      ctx.stroke();
    }
  }

  ctx.fillStyle = '#e6cf62'; // yellow band
  ctx.fillRect(0, yellowTop, widthPx, pinkTop - yellowTop);
  ctx.fillStyle = '#e9c3d2'; // pale pink band beneath it
  ctx.fillRect(0, pinkTop, widthPx, heightPx - pinkTop);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/**
 * 駅名標 — the JR Hokkaido station nameboard, redrawn from the photographs:
 * 「みどり」 large, 「緑」 beneath it, the station number B67 in a magenta
 * ring, and a green band carrying the romanised name with the neighbouring
 * stations 川湯温泉 / 札弦 either side.
 *
 * `withNumber` is false for eras before JR Hokkaido introduced station
 * numbering, when the board carried no B67.
 */
export function makeStationNameboardTexture(withNumber: boolean): THREE.CanvasTexture {
  const width = 1024;
  const height = 512;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#f4f2ec';
  ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = '#c8c4ba';
  ctx.lineWidth = 6;
  ctx.strokeRect(3, 3, width - 6, height - 6);

  ctx.fillStyle = '#1a1a1a';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `600 168px "Hiragino Sans", "Noto Sans JP", sans-serif`;
  ctx.fillText('み ど り', width / 2, height * 0.28);

  ctx.font = `500 62px "Hiragino Sans", "Noto Sans JP", sans-serif`;
  ctx.fillText('緑', width / 2, height * 0.50);

  if (withNumber) {
    const cx = width * 0.80;
    const cy = height * 0.44;
    ctx.strokeStyle = '#d3417f';
    ctx.lineWidth = 7;
    ctx.beginPath();
    ctx.arc(cx, cy, 52, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = '#d3417f';
    ctx.font = `700 40px "Helvetica Neue", Arial, sans-serif`;
    ctx.fillText('B', cx, cy - 20);
    ctx.fillText('67', cx, cy + 20);
  }

  // green band with the romanisation and a dot at each end
  const bandY = height * 0.62;
  const bandH = height * 0.10;
  ctx.fillStyle = '#3ba85a';
  ctx.fillRect(width * 0.06, bandY, width * 0.88, bandH);
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(width * 0.10, bandY + bandH / 2, bandH * 0.30, 0, Math.PI * 2);
  ctx.arc(width * 0.90, bandY + bandH / 2, bandH * 0.30, 0, Math.PI * 2);
  ctx.fill();
  ctx.font = `600 40px "Helvetica Neue", Arial, sans-serif`;
  ctx.fillText('Midori', width / 2, bandY + bandH / 2 + 2);

  ctx.fillStyle = '#1a1a1a';
  ctx.font = `500 44px "Hiragino Sans", "Noto Sans JP", sans-serif`;
  ctx.fillText('かわゆおんせん', width * 0.26, height * 0.80);
  ctx.fillText('さっつる', width * 0.76, height * 0.80);
  ctx.font = `400 26px "Helvetica Neue", Arial, sans-serif`;
  ctx.fillStyle = '#4a4a4a';
  ctx.fillText('Kawayuonsen', width * 0.26, height * 0.90);
  ctx.fillText('Sattsuru', width * 0.76, height * 0.90);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}
