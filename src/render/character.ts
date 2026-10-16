import * as THREE from 'three';
import { assets } from '../assets/AssetManager';
import { CharacterAnimationController, mapClips, proceduralClips } from './animation';
import type { AnimInput, AnimState, ClipSet } from './animation';
import { instantiateRig } from './rigs';
import { paletteFor, rigDef } from './heroes';
import { SelectionRing } from './selection';
import type { SelectMode } from './selection';
import { WeaponTrail } from './trail';
import type { Unit } from '../game/types';
import { wrapA } from '../game/util';
import { detach } from './scratch';
import { addRim, contactShadow } from './readability';

export type GlbSource = { group: THREE.Group; clips: THREE.AnimationClip[] };

export interface VisualOptions {
  /** Model key: 'arcane-knight', 'shadow-huntress', ..., 'melee-creep', 'ranged-creep', 'neutral', 'boss'. */
  key: string;
  /** In-game height in world units. */
  height: number;
  /** Glow / trail color: the hero color (creeps: the team color). */
  color: number;
  /** 0, 1 (teams) or 2 (neutral). */
  team: number;
  /** World radius of the unit, for the ground rings. */
  radius: number;
  /** Hero-class characters react to hits more strongly. */
  hero?: boolean;
  /** undefined: use a loaded GLB for `key` when there is one; null: force the procedural rig; or pass an instantiated model. */
  glb?: GlbSource | null;
  /** Particle hook supplied by the owner, so this class does not depend on the scene or VFX modules. */
  burst?: (x: number, y: number, z: number, color: number, n: number, speed: number, life: number) => void;
}

export interface VisualContext {
  /** False when the unit is far from the camera: events are still tracked, animation is skipped. */
  active?: boolean;
  selected?: SelectMode;
  /** The match is over; `win` is the winning team. */
  over?: boolean;
  win?: number;
}

interface FlashTarget { m: THREE.Material; basic: boolean; e0: THREE.Color; i0: number; c0: THREE.Color; }
const WHITE = new THREE.Color(1, 1, 1);
const V_A = new THREE.Vector3(), V_B = new THREE.Vector3();
const TRAIL_BASE = /^trailbase(\d*)$/i, TRAIL_TIP = /^trailtip(\d*)$/i;
let STUN: { geo: THREE.BufferGeometry; mat: THREE.MeshBasicMaterial } | null = null;
const stunParts = () => STUN || (STUN = { geo: new THREE.OctahedronGeometry(.11), mat: new THREE.MeshBasicMaterial({ color: 0xffee55, fog: false }) });

/**
 * Everything the player sees of one character, in one place:
 *
 *   root                  placed on the ground by the owner (units.ts / stage.ts); holds the selection ring
 *     facing              smoothed yaw
 *       shake             hit recoil + respawn pop
 *         rig             mixer root: the procedural skinned rig or the GLB scene

 * Weapon trails are world-space ribbons drawn by the shared pool in trail.ts (its group is added to the scene once), so a visual
 * needs nothing in the scene but `root`.
 *
 * It only READS the simulation (position, facing, hp, cooldowns, stun, dead). Attacks, casts and hits are recognised from changes
 * in those values, so combat, AI and the simulation never know that animation exists.
 */
export class CharacterVisual {
  readonly root = new THREE.Group();
  readonly facing = new THREE.Group();
  readonly rig = new THREE.Group();
  readonly anim: CharacterAnimationController;
  readonly ring: SelectionRing;
  readonly glb: boolean;
  readonly height: number;
  readonly clips: ClipSet;
  private shake = new THREE.Group();
  private trails: { trail: WeaponTrail; base: THREE.Object3D; tip: THREE.Object3D }[] = [];
  private flashes: FlashTarget[] = [];
  private materials: THREE.Material[] = [];
  private stunFx = new THREE.Group();
  private contact: THREE.Group;
  private hero: boolean;
  private teamColor: number;
  private burst?: VisualOptions['burst'];
  // sensing
  private init = false;
  private pHp = 0; private pCd = 0; private pAcd: number[] = []; private pDead = false;
  private px = 0; private py = 0; private v = 0;
  private yaw = 0;
  // reaction state
  private flash = 0; private lastFlash = 0; private recoil = 0; private pop = 1;
  private t = 0;

  constructor(o: VisualOptions) {
    this.height = o.height; this.hero = !!o.hero; this.burst = o.burst;
    this.teamColor = o.team === 0 ? 0x3b9cff : o.team === 1 ? 0xff4a5a : 0xb28cff;
    const src = o.glb === undefined ? assets.instantiate(o.key, o.height) : o.glb;
    this.glb = !!src;
    if (src) {
      this.rig.add(src.group);
      this.clips = mapClips(src.clips);
      const bases = new Map<string, THREE.Object3D>(), tips = new Map<string, THREE.Object3D>();
      src.group.traverse(n => {
        const mesh = n as THREE.Mesh;
        if (mesh.isMesh) {
          mesh.frustumCulled = false;
          const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
          const own = mats.map(m => m.clone());
          mesh.material = Array.isArray(mesh.material) ? own : own[0];
          own.forEach(m => this.track(m));
        }
        let m = TRAIL_BASE.exec(n.name); if (m) bases.set(m[1], n);
        m = TRAIL_TIP.exec(n.name); if (m) tips.set(m[1], n);
      });
      for (const [k, base] of bases) { const tip = tips.get(k); if (tip) this.addTrail(o.color, base, tip); }
      this.anim = new CharacterAnimationController(this.rig, this.clips, false);
    } else {
      const def = rigDef(o.key) || rigDef('melee-creep');
      const inst = instantiateRig(def, paletteFor(def.id, o.color, o.team));
      inst.group.scale.setScalar(o.height / def.height);
      this.rig.add(inst.group);
      inst.materials.forEach(m => this.track(m, true));
      inst.trails.forEach(t => this.addTrail(o.color, t.base, t.tip));
      this.clips = proceduralClips(def.style);
      this.anim = new CharacterAnimationController(this.rig, this.clips, true);
    }
    this.anim.update(0); // pose the rig at once: no frame in the bind pose
    this.ring = new SelectionRing(Math.max(.9, o.radius * 1.5), o.team === 0 ? 0x3b9cff : o.team === 1 ? 0xff4a5a : 0xb28cff, o.hero ? .85 : .6);
    this.shake.add(this.rig); this.facing.add(this.shake);
    this.contact = contactShadow(Math.max(.9, o.radius * 1.5), this.teamColor, !!o.hero).group;
    this.root.add(this.facing, this.ring.group, this.contact);
    const sp = stunParts();
    for (let i = 0; i < 3; i++) { const m = new THREE.Mesh(sp.geo, sp.mat), a = i / 3 * Math.PI * 2; m.position.set(Math.cos(a) * .5, 0, Math.sin(a) * .5); this.stunFx.add(m); }
    this.stunFx.position.y = o.height + .35; this.stunFx.visible = false;
    this.root.add(this.stunFx);
  }

  private track(m: THREE.Material, owned = true): void {
    const std = m as THREE.MeshStandardMaterial, basic = m as THREE.MeshBasicMaterial;
    if (owned) this.materials.push(m);
    if ((m as THREE.MeshStandardMaterial).isMeshStandardMaterial) addRim(m as THREE.MeshStandardMaterial, this.teamColor, this.hero ? .5 : .32);
    if (std.emissive) this.flashes.push({ m, basic: false, e0: std.emissive.clone(), i0: std.emissiveIntensity, c0: new THREE.Color() });
    else if (basic.color) this.flashes.push({ m, basic: true, e0: new THREE.Color(), i0: 1, c0: basic.color.clone() });
  }

  private addTrail(color: number, base: THREE.Object3D, tip: THREE.Object3D): void {
    this.trails.push({ trail: new WeaponTrail(color), base, tip });
  }

  get hasTrails(): boolean { return this.trails.length > 0; }
  /** True while any weapon trail ribbon is visible. */
  get trailActive(): boolean { return this.trails.some(t => t.trail.visible); }
  /** Which weapons currently draw a ribbon (one entry per weapon). */
  get trailsOn(): boolean[] { return this.trails.map(t => t.trail.visible); }
  /** Forgets every ribbon at once (the visual is hidden or far away). */
  clearTrails(): void { for (const t of this.trails) t.trail.clear(); }
  /** 0..1 white-out of the hit flash right now. */
  get flashLevel(): number { return this.flash; }
  get selection(): SelectMode { return this.ring.mode; }
  get state(): AnimState { return this.anim.state; }
  /** Smoothed measured speed in logic units per second. */
  get speed(): number { return this.v; }

  /** Compares the unit with the previous frame and reports what just happened to it. */
  private sense(u: Unit): { attack: 0 | 1 | 2; cast: boolean; hit: boolean; dmg: number; respawn: boolean } {
    const ev = { attack: 0 as 0 | 1 | 2, cast: false, hit: false, dmg: 0, respawn: false };
    if (!this.init) {
      this.init = true; this.px = u.x; this.py = u.y; this.yaw = u.fa !== undefined ? Math.PI / 2 - u.fa : 0;
      this.facing.rotation.y = this.yaw;
    } else {
      // The simulation resets `cd` to the attack interval when an attack starts and sets `acd[i]` to the cooldown when a spell is cast.
      if (!u.dead && u.cd > this.pCd + 1e-4) ev.attack = u.alt ? 2 : 1;
      if (u.acd) for (let i = 0; i < u.acd.length; i++) if (u.acd[i] > (this.pAcd[i] || 0) + 1e-4) ev.cast = true;
      if (!u.dead && u.hp < this.pHp - 1e-3) { ev.hit = true; ev.dmg = this.pHp - u.hp; }
      ev.respawn = this.pDead && !u.dead;
    }
    this.pHp = u.hp; this.pCd = u.cd; this.pDead = !!u.dead;
    if (u.acd) for (let i = 0; i < u.acd.length; i++) this.pAcd[i] = u.acd[i];
    return ev;
  }

  /** Hit reaction: white flash, recoil away from the hit and a few sparks. `frac` is the damage as a fraction of max hp. */
  react(frac: number, x?: number, y?: number, z?: number): void {
    const f = Math.min(1, Math.max(0, frac));
    this.flash = Math.min(1, .6 + f * 3);
    this.recoil = Math.min(.55, (this.hero ? .1 : .16) + f * (this.hero ? 1.1 : 2));
    if (this.burst && x !== undefined) this.burst(x, y + this.height * .6, z, 0xffe6b0, Math.round(3 + f * 22), 3.2, .35);
  }

  /**
   * Per-frame update from the simulation state. `dt` 0 (paused) only senses.
   * The owner must have placed `root` (ground position) before calling, so weapon trails sample the right world position.
   */
  update(u: Unit, dt: number, ctx: VisualContext = {}, wx = 0, wy = 0, wz = 0): void {
    const ev = this.sense(u);
    if (dt <= 0) return;
    const active = ctx.active !== false;
    if (ev.respawn) this.pop = 0;
    // Measured speed. Teleports (dash, respawn) are ignored: a real unit never covers this much ground in one frame.
    const maxSpeed = u.k === 'hero' ? u.sp : u.sp * 1.75, d = Math.hypot(u.x - this.px, u.y - this.py), raw = d / dt;
    if (raw <= 3 * Math.max(maxSpeed, 100) + 300) this.v += (raw - this.v) * (1 - Math.exp(-dt * 14));
    this.px = u.x; this.py = u.y;
    if (u.dead) this.v = 0;
    if (!active) { this.clearTrails(); return; }

    if (u.fa !== undefined && !u.dead) {
      this.yaw += wrapA(Math.PI / 2 - u.fa - this.yaw) * Math.min(1, dt * (ev.attack || ev.cast || this.anim.state === 'ATTACK' || this.anim.state === 'ATTACK_2' || this.anim.state === 'CAST' ? 22 : 10));
      this.facing.rotation.y = this.yaw;
    }
    const over = !!ctx.over, mine = over && ctx.win === u.team;
    const input: AnimInput = {
      dead: !!u.dead, defeat: over && !mine && u.k === 'hero', victory: mine, stunned: u.st > 0 && !u.dead,
      speed: this.v, maxSpeed, attack: ev.attack, cast: ev.cast, hit: ev.hit,
    };
    this.anim.update(dt, input);
    if (ev.hit) this.react(ev.dmg / Math.max(1, u.max), wx, wy, wz);
    this.reactions(dt);
    this.stunFx.visible = input.stunned;
    if (input.stunned) { this.stunFx.rotation.y += dt * 5; this.stunFx.position.y = this.height + .35 + Math.sin(this.t * 6) * .05; }
    this.ring.group.visible = !u.dead;
    this.contact.visible = !u.dead;
    this.ring.setMode(u.dead ? 'none' : ctx.selected || 'none');
    this.ring.update(dt);
    this.sampleTrails(dt);
  }

  /** Hero-select preview: the animation is driven with `anim.playX()`; this advances it. */
  preview(dt: number): void {
    this.anim.update(dt);
    this.reactions(dt);
    this.ring.setMode('player');
    this.ring.update(dt);
    this.sampleTrails(dt);
  }

  private reactions(dt: number): void {
    this.t += dt;
    this.flash = Math.max(0, this.flash - dt * 7);
    if (this.flash > 0 || this.lastFlash > 0) {
      for (const f of this.flashes) {
        if (f.basic) (f.m as THREE.MeshBasicMaterial).color.copy(f.c0).multiplyScalar(1 + this.flash * 2.2);
        else { const m = f.m as THREE.MeshStandardMaterial; m.emissive.copy(f.e0).lerp(WHITE, this.flash); m.emissiveIntensity = f.i0 + this.flash * .85; }
      }
    }
    this.lastFlash = this.flash;
    this.recoil *= Math.exp(-dt * 12);
    this.shake.position.z = -this.recoil;
    if (this.pop < 1) {
      this.pop = Math.min(1, this.pop + dt * 2.2);
      const k = this.pop - 1, s = 1 + (k * k * (2.7 * k + 1.7)); // ease-out-back
      this.shake.scale.setScalar(Math.max(.01, s));
    } else if (this.shake.scale.x !== 1) this.shake.scale.setScalar(1);
  }

  private sampleTrails(dt: number): void {
    if (!this.trails.length) return;
    const swinging = this.anim.swinging, st = this.anim.state;
    let updated = false;
    this.trails.forEach((t, i) => {
      // Dual weapons: the right hand draws trail 0 on ATTACK, the left trail 1 on ATTACK_2; casts use every weapon.
      const on = swinging && (this.trails.length < 2 || st === 'CAST' || (st === 'ATTACK' ? i === 0 : i === 1));
      if (on && !updated) { this.root.updateWorldMatrix(true, true); updated = true; }
      if (on) { t.base.getWorldPosition(V_A); t.tip.getWorldPosition(V_B); t.trail.update(dt, true, V_A, V_B); } else t.trail.update(dt, false);
    });
  }

  dispose(): void {
    this.anim.dispose();
    this.trails.forEach(t => t.trail.dispose());
    this.ring.dispose();
    this.materials.forEach(m => m.dispose());
    detach(this.root);
  }
}
