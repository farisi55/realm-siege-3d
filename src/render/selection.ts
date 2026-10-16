import * as THREE from 'three';
import { detach } from './scratch';

export type SelectMode = 'none' | 'player' | 'target';

/** A flat ring made of `n` dashes, in the XZ plane, radii r0..r1. */
function dashedRing(r0: number, r1: number, n: number, fill: number, steps = 4): THREE.BufferGeometry {
  const pos: number[] = [], idx: number[] = [];
  for (let i = 0; i < n; i++) {
    const a0 = i / n * Math.PI * 2, a1 = a0 + fill * Math.PI * 2 / n, base = i * (steps + 1) * 2;
    for (let s = 0; s <= steps; s++) {
      const a = a0 + (a1 - a0) * s / steps, c = Math.cos(a), sn = Math.sin(a);
      pos.push(c * r0, 0, sn * r0, c * r1, 0, sn * r1);
    }
    for (let s = 0; s < steps; s++) { const k = base + s * 2; idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  return g;
}

let GEO: { base: THREE.BufferGeometry; dash: THREE.BufferGeometry; pulse: THREE.BufferGeometry; ticks: THREE.BufferGeometry } | null = null;
const geos = () => GEO || (GEO = {
  base: new THREE.RingGeometry(.9, 1, 40).rotateX(-Math.PI / 2),
  dash: dashedRing(1.12, 1.34, 14, .6),
  pulse: new THREE.RingGeometry(.97, 1.03, 48).rotateX(-Math.PI / 2),
  ticks: dashedRing(.66, .86, 4, .22, 2),
});
const MATS = new Map<string, THREE.MeshBasicMaterial>();
/** A flat, unlit ground decal. Additive for glows (the selection halo); normal for the team ring, whose color must stay the team's color on green grass and on blue water alike (red added to green is yellow). */
const glowMat = (color: number, opacity: number, additive = true): THREE.MeshBasicMaterial => {
  const key = color + ':' + opacity + (additive ? '' : ':n');
  let m = MATS.get(key);
  if (!m) MATS.set(key, m = new THREE.MeshBasicMaterial({
    color, transparent: true, opacity, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending, depthWrite: false, side: THREE.DoubleSide, fog: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  }));
  return m;
};

export const RING_COLOR = { player: 0x6dffb4, target: 0xff4a4a } as const;

/**
 * Ground rings under a character: a thin team-colored base ring that is always on, plus a rotating dashed halo for the
 * player's own hero ('player') or the enemy the player is attacking ('target').
 * `radius` is the world radius of the unit; all meshes share geometry and materials.
 */
export class SelectionRing {
  readonly group = new THREE.Group();
  mode: SelectMode = 'none';
  private base: THREE.Mesh;
  private halo = new THREE.Group();
  private dash: THREE.Mesh;
  private pulse: THREE.Mesh;
  private ticks: THREE.Mesh;
  private t = Math.random() * 6;

  constructor(radius: number, teamColor: number, baseOpacity = .7) {
    const g = geos();
    this.base = new THREE.Mesh(g.base, glowMat(teamColor, baseOpacity, false));
    this.dash = new THREE.Mesh(g.dash, glowMat(RING_COLOR.player, .95));
    this.pulse = new THREE.Mesh(g.pulse, glowMat(RING_COLOR.player, .7));
    this.ticks = new THREE.Mesh(g.ticks, glowMat(RING_COLOR.player, .9));
    for (const m of [this.base, this.dash, this.pulse, this.ticks]) m.renderOrder = 5; // frustum culling stays on: a ring off screen is not drawn
    this.halo.add(this.dash, this.pulse, this.ticks);
    this.halo.visible = false;
    this.group.add(this.base, this.halo);
    this.group.position.y = .12;
    this.group.scale.setScalar(radius);
  }

  setRadius(r: number): void { this.group.scale.setScalar(r); }

  setMode(mode: SelectMode): void {
    if (mode === this.mode) return;
    this.mode = mode;
    this.halo.visible = mode !== 'none';
    if (mode !== 'none') {
      const c = RING_COLOR[mode];
      this.dash.material = glowMat(c, .95); this.pulse.material = glowMat(c, .7); this.ticks.material = glowMat(c, .9);
      this.ticks.visible = mode === 'target';
    }
  }

  update(dt: number): void {
    this.t += dt;
    if (this.mode === 'none') return;
    const player = this.mode === 'player';
    this.dash.rotation.y += dt * (player ? 1.1 : -1.9);
    this.ticks.rotation.y -= dt * 2.4;
    const s = 1 + Math.sin(this.t * (player ? 3 : 7)) * (player ? .035 : .06);
    this.pulse.scale.set(s, 1, s);
    this.halo.scale.setScalar(player ? 1 : 1 + Math.max(0, Math.sin(this.t * 7)) * .05);
  }

  dispose(): void { detach(this.group); }
}
