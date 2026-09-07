/**
 * A minimal Mapbox Vector Tile reader.
 *
 * Written here rather than pulled in as a dependency because the World needs
 * exactly one thing out of a vector tile — polygon rings with their tags —
 * and the format's whole surface for that is three protobuf messages and
 * three geometry commands. Vendoring 150 lines beats adding a dependency and
 * its transitive tree to a repository whose point is auditable provenance.
 *
 * Spec: https://github.com/mapbox/vector-tile-spec/tree/master/2.1
 */

class Reader {
  constructor(buffer) {
    this.buf = buffer;
    this.pos = 0;
  }

  get done() { return this.pos >= this.buf.length; }

  varint() {
    let result = 0;
    let shift = 0;
    for (;;) {
      const byte = this.buf[this.pos++];
      result += (byte & 0x7f) * 2 ** shift;
      if ((byte & 0x80) === 0) return result;
      shift += 7;
    }
  }

  /** Field header: returns { field, wire }. */
  key() {
    const tag = this.varint();
    return { field: tag >> 3, wire: tag & 0x07 };
  }

  bytes() {
    const length = this.varint();
    const slice = this.buf.subarray(this.pos, this.pos + length);
    this.pos += length;
    return slice;
  }

  double() {
    const value = new DataView(this.buf.buffer, this.buf.byteOffset + this.pos, 8).getFloat64(0, true);
    this.pos += 8;
    return value;
  }

  float() {
    const value = new DataView(this.buf.buffer, this.buf.byteOffset + this.pos, 4).getFloat32(0, true);
    this.pos += 4;
    return value;
  }

  /** Skips a field of the given wire type. */
  skip(wire) {
    if (wire === 0) this.varint();
    else if (wire === 1) this.pos += 8;
    else if (wire === 2) this.pos += this.varint();
    else if (wire === 5) this.pos += 4;
    else throw new Error(`unsupported wire type ${wire}`);
  }
}

function readValue(buffer) {
  const r = new Reader(buffer);
  while (!r.done) {
    const { field, wire } = r.key();
    switch (field) {
      case 1: return new TextDecoder().decode(r.bytes());
      case 2: return r.float();
      case 3: return r.double();
      case 4: return r.varint();
      case 5: return r.varint();
      case 6: { const v = r.varint(); return (v >> 1) ^ -(v & 1); }
      case 7: return r.varint() !== 0;
      default: r.skip(wire);
    }
  }
  return null;
}

/** Decodes MVT geometry commands into rings of tile-local integer coordinates. */
function decodeGeometry(numbers) {
  const rings = [];
  let ring = [];
  let x = 0;
  let y = 0;
  let i = 0;
  while (i < numbers.length) {
    const header = numbers[i++];
    const command = header & 0x7;
    const count = header >> 3;
    if (command === 1 || command === 2) {          // MoveTo / LineTo
      for (let n = 0; n < count; n++) {
        const dx = numbers[i++];
        const dy = numbers[i++];
        x += (dx >> 1) ^ -(dx & 1);
        y += (dy >> 1) ^ -(dy & 1);
        if (command === 1) {
          if (ring.length) rings.push(ring);
          ring = [];
        }
        ring.push([x, y]);
      }
    } else if (command === 7) {                     // ClosePath
      if (ring.length) {
        ring.push([ring[0][0], ring[0][1]]);
        rings.push(ring);
        ring = [];
      }
    } else {
      throw new Error(`unknown geometry command ${command}`);
    }
  }
  if (ring.length) rings.push(ring);
  return rings;
}

function readFeature(buffer, keys, values) {
  const r = new Reader(buffer);
  const feature = { id: null, type: 0, tags: {}, rings: [] };
  while (!r.done) {
    const { field, wire } = r.key();
    if (field === 1) feature.id = r.varint();
    else if (field === 2) {
      const packed = new Reader(r.bytes());
      const list = [];
      while (!packed.done) list.push(packed.varint());
      for (let i = 0; i + 1 < list.length; i += 2) feature.tags[keys[list[i]]] = values[list[i + 1]];
    } else if (field === 3) feature.type = r.varint();
    else if (field === 4) {
      const packed = new Reader(r.bytes());
      const numbers = [];
      while (!packed.done) numbers.push(packed.varint());
      feature.rings = decodeGeometry(numbers);
    } else r.skip(wire);
  }
  return feature;
}

function readLayer(buffer) {
  const r = new Reader(buffer);
  const layer = { name: '', extent: 4096, features: [] };
  const keys = [];
  const values = [];
  const rawFeatures = [];
  while (!r.done) {
    const { field, wire } = r.key();
    if (field === 1) layer.name = new TextDecoder().decode(r.bytes());
    else if (field === 2) rawFeatures.push(r.bytes());
    else if (field === 3) keys.push(new TextDecoder().decode(r.bytes()));
    else if (field === 4) values.push(readValue(r.bytes()));
    else if (field === 5) layer.extent = r.varint();
    else r.skip(wire);
  }
  layer.features = rawFeatures.map((f) => readFeature(f, keys, values));
  return layer;
}

/** Decodes one .pbf tile into named layers. */
export function decodeTile(buffer) {
  const r = new Reader(buffer);
  const layers = [];
  while (!r.done) {
    const { field, wire } = r.key();
    if (field === 3) layers.push(readLayer(r.bytes()));
    else r.skip(wire);
  }
  return layers;
}

/** Tile-local coordinates -> WGS84, for a tile at z/x/y with the given extent. */
export function tileToLonLat(z, tx, ty, extent) {
  const n = 2 ** z;
  return (px, py) => {
    const lon = ((tx + px / extent) / n) * 360 - 180;
    const t = Math.PI - 2 * Math.PI * (ty + py / extent) / n;
    const lat = (180 / Math.PI) * Math.atan(0.5 * (Math.exp(t) - Math.exp(-t)));
    return [lon, lat];
  };
}
