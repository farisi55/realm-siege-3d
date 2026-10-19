import type { Unit, GameState } from './types';

/** Single shared mutable state. The simulation owns the data; rendering and UI only read it. */
export const app = {
  all: [] as Unit[],
  P: [] as any[],
  G: null as GameState,
  me: null as Unit,
  sel: 0,
  mode: 'menu' as 'menu' | 'play',
  fps: 60,
  bloom: true,
  fr: 0,
  cam: { cy: -.785, cd: 48, cp: .95, k: { x: 1600, y: 1600 }, o: { x: 0, y: 0 } },
  keys: { left: { isDown: false }, right: { isDown: false }, up: { isDown: false }, down: { isDown: false } },
  view: { x: 0, y: 0, width: 1, height: 1 },
};

/** A combat sound event: the simulation reports one per meaningful moment (windup, release, impact, death, respawn). */
export interface SndEv {
  k: 'swing' | 'launch' | 'hit' | 'die' | 'respawn' | 'cast' | 'heal';
  x: number;
  y: number;
  team: number;
  /** Characterizes the event: unit kind for swing/die, weapon for launch, impact source for hit, ability type for cast. */
  kind: string;
  /** The attacker's unit kind on hit events (`hero`, `melee`, `ranged`, `siege`, `tower`, ...): the mix weighs the impact. */
  src?: string;
  /** The player's own hero was the one damaged: the mix may add a short personal feedback layer. */
  victim?: boolean;
  /** The player's own hero is involved: the audio layer gives these priority. */
  player?: boolean;
  /** Structurally important (tower, core, boss): survives more throttling. */
  big?: boolean;
  /** Ability identity when a hero ability caused the event: `hero index * 4 + slot` (hero order in `HR`). */
  ab?: number;
  /** The owning unit's id: lets the audio layer stop an ability loop when its owner dies. */
  uid?: number;
}

/** The simulation never imports rendering/UI: it calls these hooks, which main.ts wires up. */
export const hooks = {
  fx: (_x: number, _y: number, _r: number, _l: number, _c: number): void => {},
  ft: (_x: number, _y: number, _s: string | number, _c: string): void => {},
  feed: (_m: string, _c: string): void => {},
  finish: (_winner: number): void => {},
  /** One call per real combat event (never per frame); wired to the combat audio layer in `boot()`. */
  snd: (_e: SndEv): void => {},
};
