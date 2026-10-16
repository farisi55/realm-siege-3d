import * as THREE from 'three';
import { assets } from '../assets/AssetManager';
import { Anim, mapClips } from './animation';
import { mkChar } from './models';
import { mat, part } from './factory';

export interface Actor { g: THREE.Group; anim: Anim; glb: boolean; }

/**
 * Builds a character for gameplay or the hero-select stage. If a GLB was loaded for `key` it is cloned
 * (SkeletonUtils) and its clips are mapped to the game's animation states; otherwise the procedural rig is used.
 * Gameplay code only ever sees an Actor, so models can be swapped without touching combat or AI.
 */
export function createActor(key: string, color: number, variant: number, teamColor: number, height: number): Actor {
  const inst = assets.instantiate(key, height);
  if (inst) {
    part(inst.group, 'cyl', mat(teamColor, teamColor, 1), 0, .03, 0, .7, .04, .7, undefined, 0);
    return { g: inst.group, anim: new Anim(inst.group, mapClips(inst.clips)), glb: true };
  }
  const g = mkChar(color, variant, teamColor);
  return { g, anim: new Anim(g), glb: false };
}
