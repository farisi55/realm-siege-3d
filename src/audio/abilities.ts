import { app } from '../game/state';
import type { SndEv } from '../game/state';
import { snd } from './audio';
import type { LoopHandle } from './AudioManager';

/**
 * Phase 3: hero and ability audio.
 *
 * The simulation reports ability moments through the same `hooks.snd` stream as phase 2 (a committed cast, a projectile
 * release, a landing blast, a heal that actually restored health). This module turns the ability identity packed into
 * those events (`ab = hero index * 4 + slot`, hero order in `HR`) into a voice, reusing the phase-2 mix policy:
 * distance attenuation, the rolling budget, player priority and pitch variation all stay in `combat.ts`; here sits only
 * the hero/ability vocabulary and the lifecycle of the one sustained voice (Burning Zone's fire bed).
 *
 * Design rules (see also the README):
 *  - Every voice lives in the `synth.ts` manifest; any of them can later gain `urls` without touching this mapping.
 *  - A cue of `null` means "deliberately silent" (a basic cast with no wind-up voice); an absent entry means the event
 *    is not an ability moment and the generic combat mapping applies. Nothing falls back to a random generic sound.
 *  - Impacts are only emitted by the simulation when the effect really happened (bolt hit, blast, actual heal), so this
 *    layer never plays an impact for a miss, a cancelled cast or a heal wasted on a full-health ally.
 */

/** One ability voice choice; `loop` marks a sustained bed started instead of a one-shot. */
export interface AbilityCue { s: string; g: number; spread: number; range: number; force?: boolean; loop?: boolean }

/** Ability id used on the wire: `hero * 4 + slot`, with `HR` as the hero table. */
const A = (h: number, i: number): number => h * 4 + i;

// ------------------------------------------------------------------------------------------------ cast wind-ups / activations

/** The voice played the moment the simulation commits a cast (mana spent, cooldown started). */
const CAST: Record<number, AbilityCue> = {
  // Arcane Knight: charge, ward, slam wind-up, meteor build-up — all swelling into the +250 ms release below.
  [A(0, 0)]: { s: 'akStrikeCharge', g: .45, spread: .04, range: 1500 },
  [A(0, 1)]: { s: 'akShield', g: .75, spread: .03, range: 1500 },
  [A(0, 2)]: { s: 'akSlamWind', g: .6, spread: .03, range: 1500 },
  [A(0, 3)]: { s: 'akMeteorBuild', g: .85, spread: 0, range: 2400, force: true },
  // Shadow Huntress: the veil puff and the mark sting; dash and arrow casts are silent wind-ups.
  [A(1, 2)]: { s: 'shVeil', g: .65, spread: .04, range: 1400 },
  [A(1, 3)]: { s: 'shMark', g: .7, spread: .03, range: 2200, force: true },
  // Ember Mage: fire gathering, the ignition spark before the pool, the storm build-up.
  [A(2, 0)]: { s: 'emFireCharge', g: .5, spread: .05, range: 1500 },
  [A(2, 2)]: { s: 'emZone', g: .6, spread: .04, range: 1600 },
  [A(2, 3)]: { s: 'emStormBuild', g: .9, spread: 0, range: 2400, force: true },
  // Nature Guardian: seed in the soil, leaf ward, the gathering bloom of the ultimate.
  [A(3, 0)]: { s: 'ngSeed', g: .7, spread: .04, range: 1500 },
  [A(3, 2)]: { s: 'ngBarrier', g: .75, spread: .03, range: 1500 },
  [A(3, 3)]: { s: 'ngRebirthBuild', g: .85, spread: 0, range: 2400, force: true },
  // Storm Warrior: the charge wind-up and the rage activation (accents are layered inside the voice).
  [A(4, 2)]: { s: 'swCharge', g: .7, spread: .03, range: 1600 },
  [A(4, 3)]: { s: 'swRage', g: 1, spread: 0, range: 2400, force: true },
};

// --------------------------------------------------------------------------------------------------------------- releases

/** Bolt releases at the +250 ms execution: the hero's ranged identity, distinct from auto-attack bows. */
const LAUNCH: Record<number, AbilityCue> = {
  [A(0, 0)]: { s: 'akStrike', g: .65, spread: .04, range: 1600 },
  [A(1, 1)]: { s: 'shPoison', g: .6, spread: .05, range: 1600 },
  [A(2, 0)]: { s: 'emFireCast', g: .7, spread: .05, range: 1600 },
  [A(4, 0)]: { s: 'swPunch', g: .65, spread: .04, range: 1500 },
};

// ---------------------------------------------------------------------------------------------------------------- impacts

/** Impacts, blasts and landings; every entry here is only reachable when the effect truly resolved. */
const HIT: Record<number, AbilityCue> = {
  [A(0, 0)]: { s: 'akStrikeHit', g: .75, spread: .06, range: 1500 },
  [A(0, 2)]: { s: 'akSlamImpact', g: .95, spread: .03, range: 1700 },
  [A(0, 3)]: { s: 'akMeteorImpact', g: 1.1, spread: 0, range: 1e9, force: true },
  [A(1, 0)]: { s: 'shDash', g: .9, spread: .04, range: 1500 },
  [A(1, 1)]: { s: 'shPoisonHit', g: .7, spread: .07, range: 1500 },
  [A(1, 3)]: { s: 'shMarkBurst', g: 1.05, spread: 0, range: 1e9, force: true },
  [A(2, 0)]: { s: 'emFireHit', g: .8, spread: .06, range: 1600 },
  [A(2, 1)]: { s: 'emWave', g: .9, spread: .04, range: 1800 },
  [A(2, 2)]: { s: 'emZoneFire', g: .55, spread: .04, range: 1800, loop: true }, // ignition whoomph + subdued fire bed
  [A(2, 3)]: { s: 'emStormImpact', g: 1.15, spread: 0, range: 1e9, force: true },
  [A(3, 1)]: { s: 'ngRoot', g: .85, spread: .03, range: 1600 },
  [A(4, 0)]: { s: 'swPunchHit', g: .8, spread: .05, range: 1500 },
  [A(4, 1)]: { s: 'swField', g: .9, spread: .03, range: 1700 },
  [A(4, 2)]: { s: 'swChargeHit', g: 1, spread: .02, range: 1800 },
};

/** The one ability that turns its per-target heal events into a single major wave instead of confirmations. */
const REBIRTH = A(3, 3);

// ------------------------------------------------------------------------------------------------------------------ loops

const loops = new Map<number, LoopHandle>();
/** When a Rebirth wave last fired (per ability, sim time): all its heal events arrive in the same tick. */
let rebirthAt = -1;

/** The mix layer calls this for a `loop` cue: one sustained fire bed per owner, replaced if the same hero re-ignites.
 *  The bed keeps its world position, so the engine pans it as the camera moves (phase 4). */
export function startAbilityLoop(uid: number | undefined, name: string, gain: number, rate: number, pos?: { x: number; y: number }): void {
  if (uid === undefined) return;
  stopAbilityLoop(uid);
  const h = snd.startLoop('sfx', name, pos ? { gain, rate, pos } : { gain, rate });
  if (h) loops.set(uid, h);
}

/** Stops the fire bed of one owner (fired when that unit dies). Safe for units that never ignited one. */
export function stopAbilityLoop(uid: number): void {
  const h = loops.get(uid);
  if (h) { h.stop(); loops.delete(uid); }
}

/** Stops every ability loop; called by `resetCombatAudio()` (fresh match, panel restart) and the tests. */
export function stopAbilityLoops(): void {
  for (const h of loops.values()) h.stop();
  loops.clear();
  rebirthAt = -1;
}

/** How many fire beds are live right now (debug/tests). */
export function activeAbilityLoops(): number { return loops.size; }

// ------------------------------------------------------------------------------------------------------------------ mapping

/**
 * Maps an ability event to its voice. `undefined` means "not an ability moment" (the generic combat cue applies),
 * `null` means "deliberately silent".
 */
export function abilityCue(e: SndEv): AbilityCue | null | undefined {
  const ab = e.ab;
  if (ab === undefined) return undefined;
  switch (e.k) {
    case 'cast': return CAST[ab] ?? null;
    case 'launch': return LAUNCH[ab] ?? null;
    case 'hit':
      // Structures keep their material voice (hitStructure / hitCore) even when an ability dealt the damage.
      if (e.kind === 'core' || e.kind === 'structure') return undefined;
      return HIT[ab] ?? null;
    case 'heal': {
      if (ab === REBIRTH) {
        const t = app.G ? app.G.t : 0;
        if (rebirthAt >= 0 && t - rebirthAt < .5) return null; // one wave per cast, not one per healed ally
        rebirthAt = t;
        return { s: 'ngRebirthPulse', g: 1, spread: 0, range: 1e9, force: true };
      }
      return { s: 'healPulse', g: .55, spread: .06, range: 1500 };
    }
    default: return undefined; // swing / die / respawn: not ability voices
  }
}

/** Every voice this layer can name (manifest check in the tests and the README table). */
export function abilitySoundNames(): string[] {
  const names = new Set<string>();
  for (const t of [CAST, LAUNCH, HIT]) for (const c of Object.values(t)) names.add(c.s);
  names.add('healPulse');
  names.add('ngRebirthPulse');
  return [...names];
}
