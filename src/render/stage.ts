import { slug } from '../assets/AssetManager';
import { GM, mat } from './factory';
import { cm, sn } from './scene';
import { followSun } from './lighting';
import { app } from '../game/state';
import { HR } from '../game/config';
import { CharacterVisual } from './character';
import { heroModelSource } from './characterPack';
import { modelHeight } from './heroes';
import type { CharacterAnimationController } from './animation';
import { fxMenu, fxOnReset, kit } from './vfx';
import { StageFx } from './fx/stage';
import type { StageCue } from './fx/stage';
import { paletteOf } from './fx/style';
import * as THREE from 'three';

let PV: CharacterVisual | null = null, PVs = '', PVt = 0, PVk = 0, PVc = -1;
export const PX = 80;
export const PZ = -40;
export const ped = new THREE.Mesh(GM.cyl, mat(0x2a3048));
export const pedL = new THREE.PointLight(0xffffff, 1.3, 30);
ped.scale.set(3.6, .5, 3.6);
ped.position.set(PX, -.2, PZ);
ped.receiveShadow = true;
pedL.position.set(PX + 2, 5, PZ + 5);
sn.add(ped, pedL);

/** Effects of the pedestal: the rune circle, the summoning burst, the theme particles and one effect per show-off move. */
export const stageFx = new StageFx(kit, PX, PZ, .08, 3.3);
fxOnReset(() => stageFx.reset());

/** Show-off loop on the hero-select pedestal: idle, both attacks, a spell, a run and the victory pose. */
const CUES: [number, (a: CharacterAnimationController) => void, StageCue][] = [
  [0, a => a.playIdle(.25), 'idle'],
  [2.2, a => a.playAttack(false), 'attack'],
  [3.1, a => a.playAttack(true), 'attack2'],
  [4.2, a => a.playCast(), 'cast'],
  [5.6, a => a.playRun(.2), 'run'],
  [7.4, a => a.playVictory(.25), 'victory'],
];
const PERIOD = 9.4;

export function pvShow(): void {
  const sig = `${app.sel}:${app.pack}`;
  if (PVs === sig && PV) return;
  PVs = sig;
  if (PV) PV.dispose();
  const h = HR[app.sel];
  const key = slug(h.n), height = modelHeight(key);
  PV = new CharacterVisual({ key, height, color: h.c, team: 0, radius: .9, hero: true, glb: heroModelSource(key, height) });
  PV.root.position.set(PX, 0, PZ);
  PV.root.scale.setScalar(1.6);
  sn.add(PV.root);
  PV.anim.playIdle(0);
  PVt = 0; PVc = -1; PVk = 1;
  // Bright hero colors (the Storm Warrior's gold) would blow out under their own colored light: dim it by the color's luminance.
  pedL.color.setHex(h.c); pedL.intensity = 1.35 - .75 * (pedL.color.r * .3 + pedL.color.g * .59 + pedL.color.b * .11);
  ped.visible = pedL.visible = PV.root.visible = true;
  stageFx.show(h.n, paletteOf(h.n, h.c), 1.6, true);
}

export function prev(dt: number): void {
  if (!PV) return;
  PVt += dt;
  PV.root.rotation.y += dt * .7;
  stageFx.setYaw(PV.root.rotation.y);
  const ph = PVt % PERIOD;
  let c = 0;
  for (let i = 0; i < CUES.length; i++) if (ph >= CUES[i][0]) c = i;
  if (c !== PVc) { PVc = c; CUES[c][1](PV.anim); stageFx.cue(CUES[c][2]); }
  PV.preview(dt);
  PVk *= 1 - Math.min(1, dt * 3);
  cm.position.set(PX - 1.8, 3.4, PZ + 11 + PVk * 6);
  cm.lookAt(PX - 3, 2.2, PZ);
  followSun(PX, 0, PZ, 14);
  stageFx.update(dt);
  fxMenu(dt);
}

export function hideStage(): void {
  if (PV) { PV.root.visible = false; PV.clearTrails(); }
  ped.visible = pedL.visible = false;
  stageFx.hide();
}
export function resetStage(): void { PVs = ''; }
