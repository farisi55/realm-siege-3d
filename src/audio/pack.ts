/**
 * Sound Pack V2: the original Realm Siege 3D pack ("Realm Siege 3D Original Sound Pack v2", 80 local Ogg files under
 * `public/audio/realm-siege/`). This module is the single place that knows which shipped file backs which `synth.ts`
 * definition:
 *
 *  - `PACK` maps a definition name to its file plus the pack's `recommendedVolume` (`SoundDef.fileGain`). `synth.ts`
 *    applies the table to the definitions right after the literal, and the engine prefers a decoded file over the
 *    synthesizer whenever one loaded — so the pack replaces the synthesized voices with no caller changes, and a
 *    missing or undecodable file silently falls back to synthesis (`load()` resolves to null, never throws).
 *  - `PACK_UNUSED` records the few files that are deliberately not wired, each with the reason; the accounting test
 *    checks that every file on disk is either mapped or listed here (so a stray asset can never pass silently).
 *  - URLs go through `import.meta.env.BASE_URL` (the same pattern as `assets/AssetManager`), so a non-root deploy
 *    still resolves them.
 *
 * Every mapping keeps the game's event identity: the file plays on the exact cue the definition already sits on
 * (cast wind-up, release, confirmed impact, death, structure loss), never on a second, extra moment.
 *
 * V2 changes from V1 (see `doc/realm_siege_3d_sound_pack_v2/README.md` for the full record):
 *  - every ability that shipped one combined clip now ships a wind-up file + an impact file (five pairs), so the
 *    impact lands on the game's resolved hit instead of being buried in the cast;
 *  - the three shared generic impacts got per-identity files (`arrow-impact-poison`, `magic-impact-arcane`,
 *    `magic-impact-fire`); `magic-impact` stays for the neutral hit;
 *  - the most repeated cues gained variation takes (`swing`/`2`/`3`, `hitMelee`/`2`/`3`, four grass and three water
 *    footsteps — see `combat.ts`/`footsteps.ts`);
 *  - water footsteps and mono emitter loops for `ambForest`/`ambRiver` closed the two missing-asset gaps;
 *  - `recommendedVolume` values keep the V1 mix levels except the two rebalances the audit asked for (`swField` up
 *    so the field is audible, `hitCore` down so the repeated hit stops dominating) and the bed gains, which track the
 *    quieter, cleaner V2 bed masters.
 */

export interface PackEntry {
  /** File path relative to the pack folder, e.g. `ui/ui-click.ogg`. */
  file: string;
  /** The pack manifest's `recommendedVolume`: the file's initial gain (the synth keeps its own mix level). */
  gain: number;
}

/** Folder under `public/` the pack ships in. */
export const PACK_DIR = 'audio/realm-siege/';

const BASE: string = (import.meta as any).env?.BASE_URL ?? './';

/** Absolute (base-aware) URL of one pack file: `packUrl('ui/ui-click.ogg')`. */
export function packUrl(rel: string): string {
  return `${BASE}${PACK_DIR}${rel}`;
}

/**
 * Definition name → shipped file. V2 maps one file per definition (the V1 shared-impact files were split); variation
 * defs (`swing2`, `stepGrass2`, …) each back their own take so the take rotation changes the sound, not just the pitch.
 */
export const PACK: Record<string, PackEntry> = {
  // ---- UI --------------------------------------------------------------------------------------------------------
  uiClick: { file: 'ui/ui-click.ogg', gain: .35 },
  uiHover: { file: 'ui/ui-hover.ogg', gain: .28 },
  uiSelect: { file: 'ui/hero-select.ogg', gain: .4 },
  matchStart: { file: 'ui/match-start.ogg', gain: .55 },
  uiPause: { file: 'ui/pause.ogg', gain: .3 },
  uiResume: { file: 'ui/resume.ogg', gain: .32 },
  shopOpen: { file: 'ui/shop-open.ogg', gain: .32 },
  shopBuy: { file: 'ui/item-purchase.ogg', gain: .38 },
  uiLevel: { file: 'ui/level-up.ogg', gain: .45 },
  uiGold: { file: 'ui/gold-reward.ogg', gain: .3 },
  musicVictory: { file: 'ui/victory-stinger.ogg', gain: .62 },
  musicDefeat: { file: 'ui/defeat-stinger.ogg', gain: .56 },
  uiError: { file: 'ui/ui-error.ogg', gain: .32 },

  // ---- Combat ----------------------------------------------------------------------------------------------------
  swing: { file: 'combat/melee-swing-light.ogg', gain: .45 },
  swing2: { file: 'combat/melee-swing-light-2.ogg', gain: .45 },
  swing3: { file: 'combat/melee-swing-light-3.ogg', gain: .45 },
  swingHeavy: { file: 'combat/melee-swing-heavy.ogg', gain: .58 },
  hitMelee: { file: 'combat/melee-impact-light.ogg', gain: .5 },
  hitMelee2: { file: 'combat/melee-impact-light-2.ogg', gain: .5 },
  hitMelee3: { file: 'combat/melee-impact-light-3.ogg', gain: .5 },
  hitMeleeHeavy: { file: 'combat/melee-impact-heavy.ogg', gain: .62 },
  bowShot: { file: 'combat/ranged-launch.ogg', gain: .4 },
  hitArrow: { file: 'combat/arrow-impact.ogg', gain: .46 },
  shPoisonHit: { file: 'combat/arrow-impact-poison.ogg', gain: .46 },
  magicShot: { file: 'combat/magic-launch.ogg', gain: .42 },
  hitMagic: { file: 'combat/magic-impact.ogg', gain: .52 },
  akStrikeHit: { file: 'combat/magic-impact-arcane.ogg', gain: .52 },
  emFireHit: { file: 'combat/magic-impact-fire.ogg', gain: .52 },
  heroHit: { file: 'combat/hero-hit.ogg', gain: .45 },
  dieBig: { file: 'combat/hero-death.ogg', gain: .48 },
  respawn: { file: 'combat/hero-respawn.ogg', gain: .42 },
  moveCommand: { file: 'combat/move-command.ogg', gain: .22 },
  stepGrass: { file: 'combat/footstep-grass-1.ogg', gain: .22 },
  stepGrass2: { file: 'combat/footstep-grass-2.ogg', gain: .22 },
  stepGrass3: { file: 'combat/footstep-grass-3.ogg', gain: .22 },
  stepGrass4: { file: 'combat/footstep-grass-4.ogg', gain: .22 },
  stepWater: { file: 'combat/footstep-water-1.ogg', gain: .22 },
  stepWater2: { file: 'combat/footstep-water-2.ogg', gain: .22 },
  stepWater3: { file: 'combat/footstep-water-3.ogg', gain: .22 },

  // ---- Hero abilities --------------------------------------------------------------------------------------------
  akStrike: { file: 'heroes/arcane-knight/arcane-strike.ogg', gain: .52 },
  akShield: { file: 'heroes/arcane-knight/arcane-shield.ogg', gain: .44 },
  akSlamWind: { file: 'heroes/arcane-knight/ground-slam-windup.ogg', gain: .66 },
  akSlamImpact: { file: 'heroes/arcane-knight/ground-slam-impact.ogg', gain: .65 },
  akMeteorBuild: { file: 'heroes/arcane-knight/meteor-prison-windup.ogg', gain: .72 },
  akMeteorImpact: { file: 'heroes/arcane-knight/meteor-prison-impact.ogg', gain: .75 },
  shDash: { file: 'heroes/shadow-huntress/shadow-dash.ogg', gain: .48 },
  shPoison: { file: 'heroes/shadow-huntress/poison-arrow.ogg', gain: .46 },
  shVeil: { file: 'heroes/shadow-huntress/smoke-veil.ogg', gain: .4 },
  shMark: { file: 'heroes/shadow-huntress/death-mark-windup.ogg', gain: .62 },
  shMarkBurst: { file: 'heroes/shadow-huntress/death-mark-burst.ogg', gain: .8 },
  emFireCast: { file: 'heroes/ember-mage/fire-bolt.ogg', gain: .48 },
  emWave: { file: 'heroes/ember-mage/flame-wave.ogg', gain: .55 },
  emZoneFire: { file: 'heroes/ember-mage/burning-zone-ignition.ogg', gain: .52 },
  emStormBuild: { file: 'heroes/ember-mage/inferno-storm-windup.ogg', gain: .72 },
  emStormImpact: { file: 'heroes/ember-mage/inferno-storm-burst.ogg', gain: .65 },
  ngSeed: { file: 'heroes/nature-guardian/healing-seed.ogg', gain: .42 },
  ngRoot: { file: 'heroes/nature-guardian/root-trap.ogg', gain: .48 },
  ngBarrier: { file: 'heroes/nature-guardian/nature-barrier.ogg', gain: .42 },
  ngRebirthBuild: { file: 'heroes/nature-guardian/forest-rebirth.ogg', gain: .62 },
  swPunchHit: { file: 'heroes/storm-warrior/lightning-punch.ogg', gain: .52 },
  swField: { file: 'heroes/storm-warrior/static-field.ogg', gain: .62 }, // V2 rebalance: V1 was ~9–12 dB under its peers
  swCharge: { file: 'heroes/storm-warrior/thunder-charge-rush.ogg', gain: .64 },
  swChargeHit: { file: 'heroes/storm-warrior/thunder-charge-impact.ogg', gain: .8 },
  swRage: { file: 'heroes/storm-warrior/storm-rage.ogg', gain: .62 },

  // ---- Structures & the jungle boss ------------------------------------------------------------------------------
  siegeShot: { file: 'structures/tower-shot.ogg', gain: .45 },
  hitHeavy: { file: 'structures/tower-impact.ogg', gain: .54 },
  collapseTower: { file: 'structures/tower-destroy.ogg', gain: .72 },
  hitCore: { file: 'structures/core-hit.ogg', gain: .46 }, // V2 rebalance: the repeated global hit loses ~4 dB
  coreCritical: { file: 'structures/core-critical.ogg', gain: .42 },
  coreCollapse: { file: 'structures/core-destroy.ogg', gain: .82 },
  bossAttack: { file: 'structures/boss-attack.ogg', gain: .62 },
  bossDeath: { file: 'structures/boss-death.ogg', gain: .7 },

  // ---- Ambience --------------------------------------------------------------------------------------------------
  ambWind: { file: 'ambience/wind-loop.ogg', gain: .5 }, // V2 beds ship at §5E file level (−22 dB RMS); the gain restores the V1 mix
  ambForest: { file: 'ambience/forest-emitter.ogg', gain: .45 },
  ambRiver: { file: 'ambience/river-emitter.ogg', gain: .5 },
};

/** Pack files deliberately left unwired, with the reason (reported in the README and checked by the test suite). */
export const PACK_UNUSED: Record<string, string> = {
  'ui/ui-confirm.ogg': 'no separate "successful confirmation" moment: confirmations already own dedicated voices (uiSelect, shopBuy, matchStart)',
  'combat/shield-impact.ogg': 'the game has no shield/absorb mechanic to attach it to (Arcane Knight W is a heal)',
  'heroes/ember-mage/burning-zone-loop.ogg': 'Burning Zone is an instant one-shot AoE: looping it would be a phantom sustain',
  'ambience/forest-loop.ogg': 'superseded by ambience/forest-emitter.ogg (V2, mono, seam-safe); kept as the archival V1 master, not wired',
  'ambience/river-loop.ogg': 'superseded by ambience/river-emitter.ogg (V2, mono, 200 Hz–4 kHz texture); kept as the archival V1 master, not wired',
};
