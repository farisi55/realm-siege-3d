import { app } from '../game/state';
import type { SndEv } from '../game/state';
import { snd } from './audio';

/**
 * Phase 3: hero and ability audio.
 *
 * The simulation reports ability moments through the same `hooks.snd` stream as phase 2 (a committed cast, a projectile
 * release, a landing blast, a heal that actually restored health). This module turns the ability identity packed into
 * those events (`ab = hero index * 4 + slot`, hero order in `HR`) into a voice, reusing the phase-2 mix policy:
 * distance attenuation, the rolling budget, player priority and pitch variation all stay in `combat.ts`; here sits only
 * the hero/ability vocabulary.
 *
 * Design rules (see also the README):
 *  - Every voice lives in the `synth.ts` manifest; the shipped sound pack attaches its files to those definitions
 *    (`pack.ts`), so the mapping below never changes when a file ships.
 *  - A cue of `null` means "deliberately silent" (a basic cast with no wind-up voice); an absent entry means the event
 *    is not an ability moment and the generic combat mapping applies. Nothing falls back to a random generic sound.
 *  - Impacts are only emitted by the simulation when the effect really happened (bolt hit, blast, actual heal), so this
 *    layer never plays an impact for a miss, a cancelled cast or a heal wasted on a full-health ally.
 *  - Combined pack clips (one file containing the wind-up *and* the impact) suppress their paired synth impact as soon
 *    as the file is loaded (`LINKED` + `hasAsset`), so one hit never plays two impacts. Sound Pack V2 split all five
 *    combined clips into a wind-up file + an impact file, so the table is empty by design; the mechanism stays for a
 *    future clip that ships combined. Without files the fallback layers play exactly as before.
 *  - No ability sustains: Burning Zone is an instant AoE, so its ignition is a one-shot (the pack's ignition clip, or
 *    the short synth fire in fallback) — never a loop played for a zone that does not exist.
 */

/** One ability voice choice: `s` is a name in `synth.ts`, `g` its gain, `spread` the random pitch range, `range` the world distance it stays audible to. */
export interface AbilityCue { s: string; g: number; spread: number; range: number; force?: boolean }

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
  [A(2, 2)]: { s: 'emZoneFire', g: .55, spread: .04, range: 1800 }, // ignition whoomph; a one-shot, never a sustained bed
  [A(2, 3)]: { s: 'emStormImpact', g: 1.15, spread: 0, range: 1e9, force: true },
  [A(3, 1)]: { s: 'ngRoot', g: .85, spread: .03, range: 1600 },
  [A(4, 0)]: { s: 'swPunchHit', g: .8, spread: .05, range: 1500 },
  [A(4, 1)]: { s: 'swField', g: .9, spread: .03, range: 1700 },
  [A(4, 2)]: { s: 'swChargeHit', g: 1, spread: .02, range: 1800 },
};

/**
 * Combined clips: a mapped cast voice whose file also contains the ability's impact would suppress the paired synth
 * impact below while that file is loaded — never two impacts for one effect. Sound Pack V2 split every combined clip
 * into a wind-up file + an impact file, so no entry needs suppressing today (the wind-up and impact are separate
 * files and separate moments); the mechanism stays for a future clip that ships combined.
 */
const LINKED: Record<number, string> = {};

/** The one ability that turns its per-target heal events into a single major wave instead of confirmations. */
const REBIRTH = A(3, 3);
/** When a Rebirth wave last fired (sim time): all its heal events arrive in the same tick. */
let rebirthAt = -1;

/** Forgets the per-ability dedup state; called by `resetCombatAudio()` (fresh match, panel restart) and the tests. */
export function resetAbilityAudio(): void { rebirthAt = -1; }

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
    case 'hit': {
      // Structures keep their material voice (hitStructure / hitCore) even when an ability dealt the damage.
      if (e.kind === 'core' || e.kind === 'structure') return undefined;
      const partner = LINKED[ab];
      if (partner && snd.hasAsset(partner)) return null; // the combined clip already contained this impact
      return HIT[ab] ?? null;
    }
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
