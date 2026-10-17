import { app } from '../game/state';
import type { SndEv } from '../game/state';
import { snd } from './audio';

/**
 * Combat audio: the bridge between the simulation's `hooks.snd` events and the phase-1 engine.
 *
 * The simulation emits one event per *real* moment — melee windup, projectile release, damage landing, death,
 * respawn — and this layer decides which voice it gets, how loud, how varied and whether it may play at all:
 *
 *  - Distance attenuation around the player's hero: nearby combat is loud, distant skirmishes fade out entirely.
 *  - A rolling budget (a few non-priority voices per short window) plus the engine's per-sound `minGap`/`max`
 *    keep thirty creeps trading blows from turning into a wall of noise.
 *  - Player events and structure losses are priority: they bypass the budget and play with a small gain lift.
 *  - Every voice gets a little random pitch/gain so repeated hits never sound machine-stamped.
 *
 * Nothing here touches combat math or its timing; the events are read-only notifications.
 */

/** One voice choice: `s` is a name in `synth.ts`, `g` its gain, `spread` the random pitch range, `range` the world distance it stays audible to. */
interface Cue { s: string; g: number; spread: number; range: number; force?: boolean }

/** Rolling budget: at most `BUDGET` non-priority voices per `WINDOW` seconds of *simulation* time across the whole battle. */
const WINDOW = .15;
const BUDGET = 5;
let windowAt = -1;
let windowN = 0;

/** The simulation clock: budget windows follow game time, so pausing or fast-forwarding behaves like the real match. */
const simNow = (): number => (app.G ? app.G.t : 0);

function allow(priority: boolean): boolean {
  const now = simNow();
  if (now - windowAt > WINDOW) { windowAt = now; windowN = 0; }
  if (windowN >= BUDGET && !priority) return false;
  windowN++;
  return true;
}

/** Which voice a simulation event reaches for; `null` means deliberately silent. */
function cueOf(e: SndEv): Cue | null {
  switch (e.k) {
    case 'swing':
      return { s: 'swing', g: .5, spread: .07, range: 1250 };
    case 'launch':
      if (e.kind === 'heavy') return { s: 'siegeShot', g: .8, spread: .04, range: 1600 };
      if (e.kind === 'magic') return { s: 'magicShot', g: .6, spread: .05, range: 1400 };
      return { s: 'bowShot', g: .6, spread: .05, range: 1350 };
    case 'hit':
      switch (e.kind) {
        case 'structure': return { s: 'hitStructure', g: .8, spread: .05, range: 1600 };
        case 'core': return { s: 'hitCore', g: 1, spread: .04, range: 1e9, force: true };
        case 'blast': return { s: 'boomBlast', g: e.big ? 1 : .9, spread: .06, range: 1800 };
        case 'heavy': return { s: 'hitHeavy', g: .85, spread: .05, range: 1500 };
        case 'magic': return { s: 'hitMagic', g: .7, spread: .07, range: 1400 };
        case 'arrow': return { s: 'hitArrow', g: .6, spread: .08, range: 1250 };
        default: return { s: 'hitMelee', g: .8, spread: .07, range: 1200 };
      }
    case 'die':
      if (e.kind === 'core') return { s: 'coreCollapse', g: 1.15, spread: 0, range: 1e9, force: true };
      if (e.kind === 'tower') return { s: 'collapseTower', g: 1, spread: .03, range: 1e9, force: true };
      if (e.kind === 'hero' || e.big) return { s: 'dieBig', g: .9, spread: .04, range: 2400 };
      return { s: 'dieCreep', g: .6, spread: .09, range: 1000 };
    case 'respawn':
      return { s: 'respawn', g: .7, spread: .05, range: 1e9, force: true };
  }
}

/** Resets the rolling budget: a fresh match starts with a clear window (also used by the tests). */
export function resetCombatAudio(): void { windowAt = -1; windowN = 0; }

/** `hooks.snd`: called once by the simulation for every combat event; never from the render loop. */
export function sndEvent(e: SndEv): void {
  const cue = cueOf(e);
  if (!cue) return;
  const me = app.me;
  let att = 1;
  if (me) {
    const d = Math.hypot(e.x - me.x, e.y - me.y);
    if (d > cue.range) return; // too far to matter: the nearby fight keeps the mix
    att = 1 / (1 + (d / 460) ** 2); // ~1 at the hero's feet, ~.5 at half a screen, ~.1 across the map
  }
  const priority = cue.force || !!e.player;
  if (!allow(priority)) return;
  const gain = cue.g * (.2 + .8 * att) * (e.player ? 1.3 : 1) * (1 - Math.random() * .1);
  const rate = 1 + (Math.random() * 2 - 1) * cue.spread;
  snd.play('sfx', cue.s, { gain, rate, force: priority });
}
