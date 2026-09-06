import * as THREE from 'three';
import type { World } from '../core/World';
import { CONFIDENCE_LABEL } from '../reality/Confidence';

/**
 * Debug Mode (Directive 01 §23): grid, axes, world origin, bounding box,
 * POI markers, and a source/confidence readout. Hidden by default, toggled
 * with F1. Never shown during normal play.
 */
export class DebugMode {
  readonly group: THREE.Group;
  private visible = false;
  private readonly overlay: HTMLElement;
  private readonly world: World;
  private readonly onKeyDown = (e: KeyboardEvent) => {
    if (e.code === 'F1') {
      e.preventDefault();
      this.toggle();
    }
  };

  constructor(world: World) {
    this.world = world;
    this.group = new THREE.Group();
    this.group.name = 'Debug';
    this.group.visible = false;

    this.group.add(new THREE.GridHelper(2000, 100, 0xff5555, 0x445566));
    this.group.add(new THREE.AxesHelper(50));

    const originMarker = new THREE.Mesh(
      new THREE.SphereGeometry(1.5, 12, 12),
      new THREE.MeshBasicMaterial({ color: 0xff3333 }),
    );
    originMarker.position.set(0, 1.5, 0);
    this.group.add(originMarker);

    const radius = world.config.bounds.radius_m;
    const boundsBox = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(radius * 2, 60, radius * 2)),
      new THREE.LineBasicMaterial({ color: 0xffaa00 }),
    );
    boundsBox.position.y = 30;
    this.group.add(boundsBox);

    for (const poi of world.find('poi')) {
      if (poi.geometry.type !== 'Point') continue;
      const [lon, lat] = poi.geometry.coordinates;
      const local = world.tangentPlane.project(lat, lon);
      const marker = new THREE.Mesh(
        new THREE.ConeGeometry(1.2, 3, 8),
        new THREE.MeshBasicMaterial({ color: 0x33ccff }),
      );
      marker.position.set(local.x, 6, local.z);
      marker.userData.realityData = poi;
      this.group.add(marker);
    }

    this.overlay = document.getElementById('debug') as HTMLElement;
    document.addEventListener('keydown', this.onKeyDown);
  }

  /** Also callable from a touch-only on-screen button (Directive 06 §3) — F1 has no touch equivalent. */
  toggle(): void {
    this.visible = !this.visible;
    this.group.visible = this.visible;
    this.overlay.classList.toggle('visible', this.visible);
  }

  update(playerPos: THREE.Vector3): void {
    if (!this.visible) return;
    const [lat, lon] = this.world.tangentPlane.unproject(playerPos.x, playerPos.z);
    const lines = [
      `world_id: ${this.world.config.world_id}`,
      `date: ${this.world.config.date}  reality_mode: ${this.world.config.reality_mode ?? 'current_snapshot'}`,
      `origin: ${this.world.tangentPlane.origin.map((v) => v.toFixed(6)).join(', ')}`,
      `player local: (${playerPos.x.toFixed(1)}, ${playerPos.y.toFixed(1)}, ${playerPos.z.toFixed(1)})`,
      `player latlon: (${lat.toFixed(6)}, ${lon.toFixed(6)})`,
      '',
      'reality data:',
      ...this.world.realityData.flatMap((d) => {
        const src = d.source_ids.map((id) => this.world.sources.get(id)?.provider ?? id).join(',');
        const evidence = d.evidence_type ?? 'MISSING';
        const base = `  [${d.type}] ${d.id} conf=${d.confidence}(${CONFIDENCE_LABEL[d.confidence]}) evidence=${evidence} hist=${d.historical_status} src=${src || 'none'}`;
        const recon = this.world.reconstruction.get(d.id);
        if (!recon) return [base];
        return [base, `      reason: ${recon.historical_reconstruction.reason}`];
      }),
    ];
    this.overlay.textContent = lines.join('\n');
  }

  dispose(): void {
    document.removeEventListener('keydown', this.onKeyDown);
  }
}
