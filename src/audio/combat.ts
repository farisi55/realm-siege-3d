import { app } from '../game/state';
import type { SndEv } from '../game/state';
import { snd } from './audio';
import { abilityCue, resetAbilityAudio } from './abilities';
import { distantBattle } from './ambience';

/**
 * Phase 2: combat audio — the bridge between the simulation's `hooks.snd` events and the engine.
 *
 * The simulation emits one event per *real* moment — melee windup, projectile release, damage landing, death,
 * respawn — and this layer decides which voice it gets, how loud, how varied and whether it may play at all:
 *
 *  - Distance attenuation around the player's hero: nearby combat is loud, distant skirmishes fade out entirely.
 *  - Every play carries its world position, so the engine pans it against the camera yaw (phase 4); heavy blasts beyond
 *    the view become a single restrained distant rumble instead of a full voice.
 *  - Hero blows carry more weight than creep blows: the event's `src` picks the heavy/light melee voices.
 *  - A rolling budget (a few non-priority voices per short window) plus the engine's per-sound `minGap`/`max`
 *    keep thirty creeps trading blows from turning into a wall of noise.
 *  - Player events, the personal `heroHit` layer and structure losses are priority: they bypass the budget.
 *  - Each core warns exactly once when it first drops below critical health, and the jungle boss has its own attack
 *    and death voices: rare moments that must not be swallowed by generic impact traffic.
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

/**
 * Core critical: each core warns exactly once when it first drops below 35% hp (the game keeps no other threshold) —
 * a threshold crossing, never a per-hit pulse. The set is cleared by `resetCombatAudio()`, so a fresh match re-arms
 * both cores. The warning is layered on top of the hit's own toll: `coreCritical` is a pulse, not an impact.
 */
const CORE_CRITICAL = .35;
const critical = new Set<number>();

/** The personal feedback layer (`heroHit`) is throttled in simulation time: a fast creep volley stays readable. */
const HERO_HIT_GAP = .3;
let heroHitAt = -1e9;

/**
 * V2 variation takes: the light melee voices are the most repeated cues in a match (every creep swing and every creep
 * hit), so the pack ships three purpose-built takes per voice and the mapping rotates through them. A rotation (rather
 * than a random pick) guarantees consecutive hits always differ, and — just as important — keeps the audio layer from
 * drawing on the shared `Math.random` stream the simulation uses for its own decisions. The engine's small pitch/gain
 * jitter still runs on top of the rotation.
 */
const MELEE_SWINGS = ['swing', 'swing2', 'swing3'] as const;
const MELEE_HITS = ['hitMelee', 'hitMelee2', 'hitMelee3'] as const;
let swingTake = 0, hitTake = 0;
const nextSwing = (): string => MELEE_SWINGS[swingTake++ % MELEE_SWINGS.length];
const nextHit = (): string => MELEE_HITS[hitTake++ % MELEE_HITS.length];

/** Which voice a simulation event reaches for; `null` means deliberately silent. */
function cueOf(e: SndEv): Cue | null {
  const ab = abilityCue(e); // hero-ability identity wins; `undefined` = not an ability moment
  if (ab !== undefined) return ab;
  switch (e.k) {
    case 'swing':
      return e.kind === 'hero'
        ? { s: 'swingHeavy', g: .55, spread: .06, range: 1250 }
        : { s: nextSwing(), g: .5, spread: .07, range: 1250 };
    case 'launch':
      if (e.kind === 'boss') return { s: 'bossAttack', g: .85, spread: .04, range: 1800 };
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
        default: return e.src === 'hero'
          ? { s: 'hitMeleeHeavy', g: .85, spread: .06, range: 1300 }
          : { s: nextHit(), g: .8, spread: .07, range: 1200 };
      }
    case 'die':
      if (e.kind === 'core') return { s: 'coreCollapse', g: 1.15, spread: 0, range: 1e9, force: true };
      if (e.kind === 'tower') return { s: 'collapseTower', g: 1, spread: .03, range: 1e9, force: true };
      if (e.kind === 'hero') return { s: 'dieBig', g: .9, spread: .04, range: 2400 };
      if (e.kind === 'neutral' && e.big) return { s: 'bossDeath', g: .95, spread: .03, range: 2400 };
      return { s: 'dieCreep', g: .6, spread: .09, range: 1000 };
    case 'respawn':
      return { s: 'respawn', g: .7, spread: .05, range: 1e9, force: true };
    case 'cast': case 'heal': return null; // an ability moment without an `ab` id never guesses a generic voice
  }
}

/** Resets the rolling budget and the once-per-match state: a fresh match starts clear (also used by the tests). */
export function resetCombatAudio(): void { windowAt = -1; windowN = 0; critical.clear(); heroHitAt = -1e9; swingTake = 0; hitTake = 0; resetAbilityAudio(); }

/** The first drop of a core below critical health: one forced pulse from the core's position (never per hit). */
function coreWarning(e: SndEv): void {
  if (critical.has(e.team)) return;
  const core = app.all.find(u => u.k === 'core' && u.team === e.team && !u.dead);
  if (!core || core.hp / core.max > CORE_CRITICAL) return;
  critical.add(e.team);
  snd.play('sfx', 'coreCritical', { gain: .75, force: true, pos: { x: core.x, y: core.y } });
}

/** `hooks.snd`: called once by the simulation for every combat event; never from the render loop. */
export function sndEvent(e: SndEv): void {
  // Phase 6: a core crossing into critical health warns once (independent of the hit's own voice below).
  if (e.k === 'hit' && e.kind === 'core') coreWarning(e);
  // Phase 4: a heavy blast far outside the view becomes a restrained distant rumble instead of a full voice.
  if (e.k === 'hit' && e.kind === 'blast' && !e.player && !e.big) {
    const cam = app.cam;
    const d = Math.hypot(e.x - cam.k.x, e.y - cam.k.y);
    if (d > 2000) distantBattle(e.x, e.y, d / 4200);
  }
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
  const pos = { x: e.x, y: e.y }; // plays panned by the engine: gameplay is heard where it happens
  snd.play('sfx', cue.s, { gain, rate, force: priority, pos });
  // The player's own damage: a short personal layer over the material impact, throttled in sim time. Skipped when an
  // ability voice already told the story (`ab`), exactly as the pack README asks: never stack those for one hit.
  if (e.victim && e.ab === undefined) {
    const t = simNow();
    if (t - heroHitAt >= HERO_HIT_GAP) {
      heroHitAt = t;
      snd.play('sfx', 'heroHit', { gain: .6 * (.35 + .65 * att), rate: 1 + (Math.random() * 2 - 1) * .05, force: true, pos });
    }
  }
}
