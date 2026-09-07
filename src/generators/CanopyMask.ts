import type { LocalTangentPlane } from '../core/Coordinates';

/**
 * Where the forest is, read off 国土地理院's aerial photograph.
 *
 * scripts/derive-canopy-mask.mjs classifies the draped orthophoto — forest
 * reads dark, worked ground and roofs read bright — and writes the result as
 * a packed 1-bit grid over the same bounds as the photograph and the DEM.
 * This is the reader.
 *
 * The extent of the wood is a measurement off a photograph. Where any one
 * tree stands is not, which is why the trees themselves stay out of Reality
 * Data and are scattered inside this mask rather than recorded.
 */
export interface CanopyMaskData {
  bounds: { west: number; east: number; south: number; north: number };
  grid: number;
  metres_per_cell: number;
  packed_base64: string;
}

export class CanopyMask {
  private readonly bits: Uint8Array;

  constructor(private readonly data: CanopyMaskData, private readonly tangentPlane: LocalTangentPlane) {
    const binary = atob(data.packed_base64);
    this.bits = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) this.bits[i] = binary.charCodeAt(i);
  }

  get metresPerCell(): number { return this.data.metres_per_cell; }

  /** True where the photograph shows canopy. Outside the photograph's bounds
   *  it answers false: better a bare edge than a forest invented past the
   *  end of the evidence. */
  at(x: number, z: number): boolean {
    const [lat, lon] = this.tangentPlane.unproject(x, z);
    const b = this.data.bounds;
    const u = (lon - b.west) / (b.east - b.west);
    const v = (b.north - lat) / (b.north - b.south);
    if (u < 0 || u >= 1 || v < 0 || v >= 1) return false;
    const gx = Math.floor(u * this.data.grid);
    const gy = Math.floor(v * this.data.grid);
    const cell = gy * this.data.grid + gx;
    return ((this.bits[cell >> 3] >> (cell & 7)) & 1) === 1;
  }
}
