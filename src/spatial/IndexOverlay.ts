import * as THREE from 'three';
import type { LocalTangentPlane } from '../core/Coordinates';
import type { SpatialIndexFile, SpatialEntity, FrontierStatus, IndexGeometry } from './SpatialIndex';

const SVG_NS = 'http://www.w3.org/2000/svg';
const LIFT_M = 6; // draw entities slightly above terrain so they aren't hidden under it

const FRONTIER_COLOR: Record<FrontierStatus, string> = {
  defined: '#4a9b8f',
  stub: '#d9a441',
  undefined: '#4b5a63',
};

/**
 * Directive 09.1 §6: the Spatial Index overlay lives INSIDE the 3D World —
 * an SVG layered on top of the WebGL canvas, with every entity projected
 * through the SAME live PerspectiveCamera (THREE's own Vector3.project),
 * so it tracks whatever the camera is doing rather than assuming a fixed
 * top-down view. Only entities with a non-null geometry (position_status
 * 'located' or 'approximate') are ever drawn — 'unlocated' entities are
 * listed in a side panel instead (§6.3): existence is shown, position is
 * not invented to make something appear on screen.
 */
export class IndexOverlay {
  private readonly svg: SVGSVGElement;
  private readonly unlocatedListEl: HTMLElement;
  private readonly located: SpatialEntity[];
  private readonly unlocated: SpatialEntity[];

  constructor(
    svg: SVGSVGElement,
    unlocatedListEl: HTMLElement,
    private readonly camera: THREE.PerspectiveCamera,
    private readonly renderer: THREE.WebGLRenderer,
    private readonly tangentPlane: LocalTangentPlane,
    index: SpatialIndexFile,
  ) {
    this.svg = svg;
    this.unlocatedListEl = unlocatedListEl;
    this.located = index.entities.filter((e) => e.geometry != null);
    this.unlocated = index.entities.filter((e) => e.geometry == null);
    this.renderUnlocatedList();
  }

  private renderUnlocatedList(): void {
    this.unlocatedListEl.innerHTML = '';
    const header = document.createElement('div');
    header.className = 'unlocated-header';
    header.textContent = `未特定（${this.unlocated.length}件）`;
    this.unlocatedListEl.appendChild(header);
    for (const e of this.unlocated) {
      const row = document.createElement('div');
      row.className = 'unlocated-row';
      row.textContent = e.name ?? e.id;
      this.unlocatedListEl.appendChild(row);
    }
  }

  setVisible(visible: boolean): void {
    this.svg.style.display = visible ? 'block' : 'none';
    this.unlocatedListEl.style.display = visible ? 'block' : 'none';
  }

  private allCoords(g: IndexGeometry): [number, number][] {
    if (g.type === 'Point') return [g.coordinates];
    if (g.type === 'LineString') return g.coordinates;
    if (g.type === 'MultiLineString') return g.coordinates.flat();
    return g.coordinates.flat();
  }

  private toScreen(lon: number, lat: number, heightAt: (x: number, z: number) => number): THREE.Vector3 | null {
    const local = this.tangentPlane.project(lat, lon);
    const y = heightAt(local.x, local.z) + LIFT_M;
    const world = new THREE.Vector3(local.x, y, local.z);
    const ndc = world.project(this.camera);
    if (ndc.z > 1 || ndc.z < -1) return null; // behind camera or outside near/far
    const w = this.renderer.domElement.clientWidth;
    const h = this.renderer.domElement.clientHeight;
    return new THREE.Vector3(((ndc.x + 1) / 2) * w, ((1 - ndc.y) / 2) * h, 0);
  }

  update(heightAt: (x: number, z: number) => number): void {
    if (this.svg.style.display === 'none') return;
    while (this.svg.firstChild) this.svg.removeChild(this.svg.firstChild);

    for (const e of this.located) {
      if (!e.geometry) continue;
      const color = FRONTIER_COLOR[e.frontier_status] ?? FRONTIER_COLOR.undefined;

      if (e.geometry.type === 'Point') {
        const [lon, lat] = e.geometry.coordinates;
        const p = this.toScreen(lon, lat, heightAt);
        if (!p) continue;
        const dot = document.createElementNS(SVG_NS, 'circle');
        dot.setAttribute('cx', String(p.x));
        dot.setAttribute('cy', String(p.y));
        dot.setAttribute('r', '5');
        dot.setAttribute('fill', color);
        dot.setAttribute('stroke', '#0a0e14');
        dot.setAttribute('stroke-width', '1.5');
        this.svg.appendChild(dot);
        if (e.name) this.appendLabel(p.x + 8, p.y - 8, e.name);
      } else if (e.geometry.type === 'LineString' || e.geometry.type === 'MultiLineString') {
        const lines = e.geometry.type === 'LineString' ? [e.geometry.coordinates] : e.geometry.coordinates;
        for (const line of lines) {
          const pts = line.map(([lon, lat]) => this.toScreen(lon, lat, heightAt)).filter((p): p is THREE.Vector3 => !!p);
          if (pts.length < 2) continue;
          const poly = document.createElementNS(SVG_NS, 'polyline');
          poly.setAttribute('points', pts.map((p) => `${p.x},${p.y}`).join(' '));
          poly.setAttribute('fill', 'none');
          poly.setAttribute('stroke', color);
          poly.setAttribute('stroke-width', '2.5');
          if (e.frontier_status === 'stub') poly.setAttribute('stroke-dasharray', '6,4');
          this.svg.appendChild(poly);
        }
      } else if (e.geometry.type === 'Polygon') {
        const ring = e.geometry.coordinates[0];
        const pts = ring.map(([lon, lat]) => this.toScreen(lon, lat, heightAt)).filter((p): p is THREE.Vector3 => !!p);
        if (pts.length < 3) continue;
        const poly = document.createElementNS(SVG_NS, 'polygon');
        poly.setAttribute('points', pts.map((p) => `${p.x},${p.y}`).join(' '));
        poly.setAttribute('fill', color);
        poly.setAttribute('fill-opacity', '0.2');
        poly.setAttribute('stroke', color);
        poly.setAttribute('stroke-width', '2');
        if (e.frontier_status === 'stub') poly.setAttribute('stroke-dasharray', '6,4');
        this.svg.appendChild(poly);
        if (e.name) {
          const cx = pts.reduce((a, p) => a + p.x, 0) / pts.length;
          const cy = pts.reduce((a, p) => a + p.y, 0) / pts.length;
          this.appendLabel(cx, cy, e.name);
        }
      }
    }
  }

  private appendLabel(x: number, y: number, text: string): void {
    const label = document.createElementNS(SVG_NS, 'text');
    label.setAttribute('x', String(x));
    label.setAttribute('y', String(y));
    label.setAttribute('class', 'index-overlay-label');
    label.textContent = text;
    this.svg.appendChild(label);
  }
}
