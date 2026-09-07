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
  /** The ring just outside the canopy — see derive-canopy-mask.mjs. */
  scrub_packed_base64?: string;
}

export class CanopyMask {
  private readonly bits: Uint8Array;
  private readonly scrubBits: Uint8Array | null;

  constructor(private readonly data: CanopyMaskData, private readonly tangentPlane: LocalTangentPlane) {
    this.bits = CanopyMask.unpack(data.packed_base64);
    this.scrubBits = data.scrub_packed_base64 ? CanopyMask.unpack(data.scrub_packed_base64) : null;
  }

  private static unpack(base64: string): Uint8Array {
    const binary = atob(base64);
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
    return out;
  }

  /** Cell index for a World position, or -1 outside the photograph. */
  private cellAt(x: number, z: number): number {
    const [lat, lon] = this.tangentPlane.unproject(x, z);
    const b = this.data.bounds;
    const u = (lon - b.west) / (b.east - b.west);
    const v = (b.north - lat) / (b.north - b.south);
    if (u < 0 || u >= 1 || v < 0 || v >= 1) return -1;
    return Math.floor(v * this.data.grid) * this.data.grid + Math.floor(u * this.data.grid);
  }

  /** True in the scrub ring at the edge of the wood. */
  scrubAt(x: number, z: number): boolean {
    if (!this.scrubBits) return false;
    const cell = this.cellAt(x, z);
    if (cell < 0) return false;
    return ((this.scrubBits[cell >> 3] >> (cell & 7)) & 1) === 1;
  }

  get metresPerCell(): number { return this.data.metres_per_cell; }

  /** True where the photograph shows canopy. Outside the photograph's bounds
   *  it answers false: better a bare edge than a forest invented past the
   *  end of the evidence. */
  at(x: number, z: number): boolean {
    const cell = this.cellAt(x, z);
    if (cell < 0) return false;
    return ((this.bits[cell >> 3] >> (cell & 7)) & 1) === 1;
  }
}
