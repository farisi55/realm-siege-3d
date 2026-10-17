import { snd } from './audio';
import type { LoopHandle } from './AudioManager';
import { BASE, CAMP, W } from '../game/config';

/**
 * Phase 4: the environment.
 *
 * The map is a known place — a river cutting the diagonal, jungle camps at fixed points, two magical bases in the
 * corners (see `game/map.ts` and `game/config.ts` for the same numbers). Ambience is therefore a fixed set of
 * emitters, each a `loop` definition started through the engine's spatial path: the engine pans and attenuates every
 * live emitter as the camera moves, and stops mattering beyond each definition's `maxDist` (the cull happens before
 * any node is built, so a far-away river costs nothing).
 *
 * The wind is the one non-positional bed: it plays everywhere at a whisper, the floor under the other layers. Each
 * emitter is tracked under its own key so `ambienceTick` can restart a bed that faded out and never start two copies
 * of the same point; `ambienceOff` stops and forgets them all (menu, match end, restart).
 */

interface Emitter {
  /** Stable identity of the emitter (several emitters can share one sound definition). */
  key: string;
  name: string;
  x: number;
  y: number;
}

/** Pillars of the world: the river runs where `x = y`, camps and bases are shared with map generation. */
export const AMBIENCE: readonly Emitter[] = [
  { key: 'wind', name: 'ambWind', x: NaN, y: NaN },
  ...([W * .22, W * .5, W * .78] as const).map((v, i) => ({ key: `river${i}`, name: 'ambRiver', x: v, y: v })),
  ...CAMP.map((c, i) => ({ key: `forest${i}`, name: 'ambForest', x: c[0], y: c[1] })),
  ...BASE.map((b, i) => ({ key: `base${i}`, name: 'ambBase', x: b[0], y: b[1] })),
];

let on = false;
const handles = new Map<string, LoopHandle>();
/** Emitters that were culled by their own `maxDist`; re-probed a couple of times a second instead of every frame. */
const missed = new Set<string>();
let tick = 0;

/** How many emitters are sounding right now (debug/tests). */
export function ambienceActive(): number { return handles.size; }
export function ambienceIsOn(): boolean { return on; }

/** Starts the environment (a match is live). Idempotent; the actual voices start on the next tick. */
export function ambienceOn(): void { on = true; ambienceTick(); }

/** Stops every emitter and forgets them (menu, match over, restart). */
export function ambienceOff(): void {
  on = false;
  for (const h of handles.values()) h.stop();
  handles.clear();
  missed.clear();
  tick = 0;
}

/** Ensures every emitter is sounding exactly once; called every frame while the environment is on. */
export function ambienceTick(): void {
  if (!on) return;
  tick++;
  for (const e of AMBIENCE) {
    const h = handles.get(e.key);
    if (h && h.live) continue; // already sounding
    if (h) { h.stop(); handles.delete(e.key); } // faded out on its own: replace it right away
    else if (missed.has(e.key) && tick % 30 !== 0) continue; // still out of earshot: check again soon, not every frame
    const pos = Number.isNaN(e.x) ? undefined : { x: e.x, y: e.y };
    const nh = snd.startLoop('ambient', e.name, pos ? { pos } : {});
    if (nh) { handles.set(e.key, nh); missed.delete(e.key); }
    else { handles.delete(e.key); missed.add(e.key); }
  }
}

/**
 * A muted swell for heavy combat far outside the view: the caller (`audio/combat.ts`) only reaches this for blasts
 * beyond 2000 units, and the definition's own `minGap`/`max` keep it to an occasional rumble. Restraint by design —
 * the atmosphere must stay quieter than anything the player can act on.
 */
export function distantBattle(x: number, y: number, loud: number): void {
  snd.play('ambient', 'ambDistant', { pos: { x, y }, gain: Math.max(.15, Math.min(.6, loud)) });
}
