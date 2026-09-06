import { LocalTangentPlane } from '../core/Coordinates';
import { SpatialIndexLoader } from '../spatial/SpatialIndexLoader';
import type { SpatialEntity, IndexGeometry, FrontierStatus } from '../spatial/SpatialIndex';
import { CONFIDENCE_LABEL } from '../reality/Confidence';

const PLACE_PATH = 'JP.01.546.MIDORI';
const SVG_NS = 'http://www.w3.org/2000/svg';

const FRONTIER_COLOR: Record<FrontierStatus, string> = {
  defined: '#4a9b8f',
  stub: '#d9a441',
  undefined: '#4b5a63',
};

const CATEGORY_KIND: Record<string, 'point' | 'line' | 'polygon'> = {
  railway_station: 'point', poi: 'point', facility: 'point', plaza: 'point', building: 'point',
  railway_line: 'line', road: 'line', river: 'line',
  forest: 'polygon', farmland: 'polygon', settlement: 'polygon', administrative_boundary: 'polygon',
};

async function bootstrap(): Promise<void> {
  const svg = document.getElementById('mapSvg') as unknown as SVGSVGElement;
  const wrap = document.getElementById('canvasWrap') as HTMLElement;
  const statsEl = document.getElementById('stats') as HTMLElement;
  const inspector = document.getElementById('inspector') as HTMLElement;
  const inspTitle = document.getElementById('inspTitle') as HTMLElement;
  const inspCat = document.getElementById('inspCat') as HTMLElement;
  const inspBadge = document.getElementById('inspBadge') as HTMLElement;
  const inspFields = document.getElementById('inspFields') as HTMLElement;
  const inspClose = document.getElementById('inspectorClose') as HTMLElement;

  const index = await SpatialIndexLoader.load(PLACE_PATH, import.meta.env.BASE_URL);

  // Anchor the local tangent plane on the station entity (or the index's
  // own extent centroid as a fallback) — purely a projection convenience
  // for this 2D view, unrelated to any World's origin resolution.
  const anchorEntity = index.entities.find((e) => e.category === 'railway_station') ?? index.entities[0];
  const [anchorLon, anchorLat] = firstCoord(anchorEntity.geometry);
  const plane = new LocalTangentPlane(anchorLat, anchorLon);

  const project2D = (lon: number, lat: number): [number, number] => {
    const p = plane.project(lat, lon);
    return [p.x, -p.z]; // screen Y grows downward; -z (north positive in project) becomes up
  };

  // ---- compute a bounding box (in projected meters) over every entity ----
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const expand = (x: number, y: number) => {
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    minY = Math.min(minY, y); maxY = Math.max(maxY, y);
  };
  for (const e of index.entities) {
    for (const [lon, lat] of allCoords(e.geometry)) {
      const [x, y] = project2D(lon, lat);
      expand(x, y);
    }
  }
  const pad = Math.max(50, (maxX - minX) * 0.08);
  minX -= pad; minY -= pad; maxX += pad; maxY += pad;
  const viewW = maxX - minX;
  const viewH = maxY - minY;
  svg.setAttribute('viewBox', `${minX} ${minY} ${viewW} ${viewH}`);

  const rootG = document.createElementNS(SVG_NS, 'g');
  rootG.setAttribute('id', 'zoomLayer');
  svg.appendChild(rootG);

  function frontierClass(status: FrontierStatus): string {
    return status === 'defined' ? 'defined' : status === 'stub' ? 'stub' : 'undefined';
  }

  function openInspector(e: SpatialEntity): void {
    inspTitle.textContent = e.name ?? '(名称未確定)';
    inspCat.textContent = `${e.category} — ${e.id}`;
    inspBadge.textContent = e.frontier_status;
    inspBadge.className = `frontier-badge ${frontierClass(e.frontier_status)}`;
    inspFields.innerHTML = '';
    const rows: [string, string][] = [
      ['id', e.id],
      ['confidence', `${e.confidence} (${CONFIDENCE_LABEL[e.confidence]})`],
      ['evidence_type', e.evidence_type ?? '(未設定)'],
      ['source_ids', e.source_ids.length ? e.source_ids.join(', ') : '(none)'],
      ['detail_ref', e.detail_ref ?? '(null — stub)'],
    ];
    if (e.orientation) rows.push(['facade_bearing_deg', `${e.orientation.facade_bearing_deg}°`]);
    if (e.note) rows.push(['note', e.note]);
    for (const [k, v] of rows) {
      const dt = document.createElement('dt'); dt.textContent = k;
      const dd = document.createElement('dd'); dd.textContent = v;
      inspFields.appendChild(dt); inspFields.appendChild(dd);
    }
    inspector.classList.add('open');
  }
  inspClose.addEventListener('click', () => inspector.classList.remove('open'));

  let definedCount = 0, stubCount = 0, undefinedCount = 0;

  for (const e of index.entities) {
    const kind = CATEGORY_KIND[e.category] ?? e.geometry_type;
    const color = FRONTIER_COLOR[e.frontier_status] ?? FRONTIER_COLOR.undefined;
    if (e.frontier_status === 'defined') definedCount++;
    else if (e.frontier_status === 'stub') stubCount++;
    else undefinedCount++;

    if (kind === 'point' || e.geometry.type === 'Point') {
      const [lon, lat] = firstCoord(e.geometry);
      const [x, y] = project2D(lon, lat);
      const dot = document.createElementNS(SVG_NS, 'circle');
      dot.setAttribute('class', 'entity-point');
      dot.setAttribute('cx', String(x));
      dot.setAttribute('cy', String(y));
      dot.setAttribute('r', '5');
      dot.setAttribute('fill', color);
      dot.setAttribute('stroke', '#0a0e14');
      dot.style.strokeDasharray = e.frontier_status === 'stub' ? '2,2' : '';
      dot.addEventListener('click', () => openInspector(e));
      rootG.appendChild(dot);

      if (e.name) {
        const label = document.createElementNS(SVG_NS, 'text');
        label.setAttribute('class', 'entity-label');
        label.setAttribute('x', String(x + 8));
        label.setAttribute('y', String(y - 8));
        label.textContent = e.name;
        rootG.appendChild(label);
      }
    } else if (e.geometry.type === 'LineString' || e.geometry.type === 'MultiLineString') {
      const lines = e.geometry.type === 'LineString' ? [e.geometry.coordinates] : e.geometry.coordinates;
      for (const line of lines) {
        const points = line.map(([lon, lat]) => project2D(lon, lat).join(',')).join(' ');
        const poly = document.createElementNS(SVG_NS, 'polyline');
        poly.setAttribute('class', 'entity-line');
        poly.setAttribute('points', points);
        poly.setAttribute('stroke', color);
        if (e.frontier_status === 'stub') poly.style.strokeDasharray = '6,4';
        poly.addEventListener('click', () => openInspector(e));
        rootG.appendChild(poly);
      }
    } else if (e.geometry.type === 'Polygon') {
      const ring = e.geometry.coordinates[0];
      const points = ring.map(([lon, lat]) => project2D(lon, lat).join(',')).join(' ');
      const poly = document.createElementNS(SVG_NS, 'polygon');
      poly.setAttribute('class', 'entity-poly');
      poly.setAttribute('points', points);
      poly.setAttribute('stroke', color);
      poly.setAttribute('fill', color);
      if (e.frontier_status === 'stub') poly.style.strokeDasharray = '6,4';
      poly.addEventListener('click', () => openInspector(e));
      rootG.appendChild(poly);
      if (e.name) {
        const c = ring.reduce((acc, [lon, lat]) => {
          const [x, y] = project2D(lon, lat);
          return [acc[0] + x / ring.length, acc[1] + y / ring.length];
        }, [0, 0]);
        const label = document.createElementNS(SVG_NS, 'text');
        label.setAttribute('class', 'entity-label');
        label.setAttribute('x', String(c[0]));
        label.setAttribute('y', String(c[1]));
        label.setAttribute('text-anchor', 'middle');
        label.textContent = e.name;
        rootG.appendChild(label);
      }
    }
  }

  statsEl.textContent =
    `entities: ${index.entities.length}\n` +
    `  defined:   ${definedCount}\n` +
    `  stub:      ${stubCount}\n` +
    `  undefined: ${undefinedCount}\n` +
    `last_updated: ${index.last_updated}`;

  // ---- pan + zoom (drag to pan, wheel to zoom, simple transform on the root <g>) ----
  let scale = 1;
  let tx = 0, ty = 0;
  let dragging = false;
  let lastX = 0, lastY = 0;

  function applyTransform(): void {
    rootG.setAttribute('transform', `translate(${tx} ${ty}) scale(${scale})`);
  }

  // No setPointerCapture here on purpose: capturing on `wrap` would make
  // every subsequent pointer event (including the click a plain tap
  // produces) target `wrap` instead of whatever entity is underneath,
  // silently breaking the inspector's click handlers. A small movement
  // threshold distinguishes an actual drag from a click instead.
  let movedPastThreshold = false;
  wrap.addEventListener('pointerdown', (ev) => {
    dragging = true;
    movedPastThreshold = false;
    lastX = ev.clientX; lastY = ev.clientY;
  });
  wrap.addEventListener('pointermove', (ev) => {
    if (!dragging) return;
    if (Math.abs(ev.clientX - lastX) > 3 || Math.abs(ev.clientY - lastY) > 3) {
      movedPastThreshold = true;
      wrap.classList.add('dragging');
    }
    if (!movedPastThreshold) return;
    const dx = (ev.clientX - lastX) * (viewW / wrap.clientWidth) / scale;
    const dy = (ev.clientY - lastY) * (viewH / wrap.clientHeight) / scale;
    tx += dx; ty += dy;
    lastX = ev.clientX; lastY = ev.clientY;
    applyTransform();
  });
  wrap.addEventListener('pointerup', () => {
    dragging = false;
    wrap.classList.remove('dragging');
  });
  wrap.addEventListener('wheel', (ev) => {
    ev.preventDefault();
    const factor = ev.deltaY < 0 ? 1.15 : 1 / 1.15;
    scale = Math.min(20, Math.max(0.3, scale * factor));
    applyTransform();
  }, { passive: false });
}

function firstCoord(g: IndexGeometry): [number, number] {
  if (g.type === 'Point') return g.coordinates;
  if (g.type === 'LineString') return g.coordinates[0];
  if (g.type === 'MultiLineString') return g.coordinates[0][0];
  return g.coordinates[0][0];
}

function allCoords(g: IndexGeometry): [number, number][] {
  if (g.type === 'Point') return [g.coordinates];
  if (g.type === 'LineString') return g.coordinates;
  if (g.type === 'MultiLineString') return g.coordinates.flat();
  return g.coordinates.flat();
}

bootstrap().catch((err) => {
  console.error(err);
  const statsEl = document.getElementById('stats');
  if (statsEl) statsEl.textContent = `Spatial Index load failed: ${(err as Error).message}`;
});
