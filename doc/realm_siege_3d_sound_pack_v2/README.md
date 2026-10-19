# Realm Siege 3D — Original Sound Pack v2

**What it is:** the shipped audio pack for the browser MOBA *Realm Siege 3D* — 80 Ogg Vorbis
files under `public/audio/realm-siege/`, wired by `src/audio/pack.ts` and validated against the
phase-7 audit's measurable acceptance deck (`doc/sound_pack_v2_audit/AUDIT_REPORT.md` §5E).

**Character:** layered dark-fantasy / stylized MOBA sound design. Strong transients, full but
controlled bodies, distinct attack / impact / tail separation, layered magic, restrained reverb,
and a deliberate band character per cue — the goal is separation in a busy mix, not loudness.

**Where everything lives**

| Path | What it is |
|---|---|
| `public/audio/realm-siege/` | the shipped OGGs the game loads |
| `doc/realm_siege_3d_sound_pack_v2/masters/` | the float32 WAV masters (source of truth for V2 files) |
| `doc/realm_siege_3d_sound_pack_v2/tools/design.py` | the DSP recipes that render every V2 master |
| `doc/realm_siege_3d_sound_pack_v2/tools/encode.py` | masters → shipped OGGs (ffmpeg / libvorbis) |
| `doc/realm_siege_3d_sound_pack_v2/tools/measure.py` | audit-identical measurement + §5E checks |
| `doc/realm_siege_3d_sound_pack_v2/tools/validate.py` | final acceptance run on the decoded OGGs |
| `doc/realm_siege_3d_sound_pack_v2/tools/manifest.py` | regenerates `manifest.json` from `pack.ts` + the files |
| `doc/realm_siege_3d_sound_pack_v2/tools/preview.py` | regenerates `preview.html` (the listening page) |
| `doc/realm_siege_3d_sound_pack_v2/manifest.json` | per-file record: voice, gain, role, duration, decoded levels |
| `doc/realm_siege_3d_sound_pack_v2/PROVENANCE.md` | authorship / license record |
| `doc/realm_siege_3d_sound_pack_v2/preview.html` | local audition page for all 80 files (unused marked) |

> **Honesty note (read this first).** Every V2 file is **procedurally synthesized** from
> original DSP code — oscillators, filtered noise, particle grains and envelopes written for this
> pack in `tools/design.py`. There are **no recordings, no Foley, no sample libraries, no ripped
> or extracted material** from this or any other game; nothing here is derived from Dota 2 or any
> commercial title. See §7. These are *designed synthetic* assets: they solve the measured
> problems of V1 (buried impacts, sub-only cues, duplicated identities, looping seams) and they
> are honest about what synthesis can and cannot do — they do not claim AAA Foley fidelity.

---

## 1. What V2 changes

V2 implements the replacement plan from the phase-7 audit (`doc/sound_pack_v2_audit/`). The
architecture is untouched: one `AudioManager`, the same ten `src/audio/*` modules, the same
public API, the same Web Audio synth as the fallback when a file is missing.

| Change | Detail |
|---|---|
| **Split the five combined clips** | Ground Slam, Meteor Prison, Death Mark, Inferno Storm and Thunder Charge each shipped *one* clip with wind-up + impact baked together — the audit measured their impacts 15–26 dB down by the game's +250 ms release, so they could never align with the resolved hit. V2 ships a **wind-up file + impact file** per ability (10 files; the 5 combined V1 files are deleted). The impact definitions (`akSlamImpact`, `akMeteorImpact`, `shMarkBurst`, `emStormImpact`, `swChargeHit`) already fire on the resolved hit. |
| **Per-identity impacts** | `magic-impact` backed three unrelated events and `arrow-impact` two. V2 adds `arrow-impact-poison.ogg` (Shadow Huntress), `magic-impact-arcane.ogg` (Arcane Knight), `magic-impact-fire.ogg` (Ember Mage); `magic-impact.ogg` was remixed down to a neutral arcane tick. |
| **Variation takes for the most repeated cues** | Three distinct light-swing takes, three distinct light-impact takes, four grass and three water footsteps. Take selection is a deterministic rotation (`combat.ts` / `footsteps.ts`) plus the engine's existing small pitch/gain nudge — see §4. |
| **Gap assets** | `footstep-water-1/2/3.ogg` (the river surface had only a synth) and mono emitter loops `forest-emitter.ogg` / `river-emitter.ogg` for the positional `ambForest` / `ambRiver` emitters. |
| **20 in-place remixes** | Same filenames, no code change: the thin/harsh swings and launches, the sub-heavy impacts and ignitions, the colliding swell/chime families, `core-hit`, `level-up` and the 29 dB seam on `wind-loop`. |
| **Two gain rebalances (audit-named)** | `swField` up (the static field was ~9–12 dB under its peers), `hitCore` down (~4 dB — the repeated global core hit was dominating). Every other `recommendedVolume` is unchanged from V1. |
| **Bed mix levels** | The V2 beds ship at the §5E file level (−22 dB RMS); the manifest gains (`.5 / .45 / .5`) restore roughly the V1 mix level on the ambient bus. |

**Code touched (audio layer only — no engine, simulation or gameplay change):** `pack.ts`
(the table below + `PACK_UNUSED`), `abilities.ts` (`LINKED` is now empty — the mechanism is kept
for any future combined clip), `combat.ts` + `footsteps.ts` (take rotation across the new
files), `synth.ts` (fallbacks for every new definition), `world.ts` (preload list), and the five
audio test suites. `AudioManager.ts` is untouched.

---

## 2. Ship inventory & accounting

```
80 files on disk = 75 mapped + 5 deliberately unused
75 mapped        = 47 V2-authored (re-rendered) + 28 kept bit-exact from V1
```

- The 28 kept files were not part of the audit's replace/remix set; they ship untouched (and stay
  bit-exact — `encode.py` never rewrites them).
- The 5 unused files are all V1-era assets whose trigger never existed or was superseded; they
  still ship inside the build (deleting them is a separate call) and are listed with reasons in
  §8, in `pack.ts` (`PACK_UNUSED`) and in `manifest.json`.
- The accounting is enforced: `tests/audio-pack.test.ts` fails if any file on disk is neither
  mapped nor listed unused, and `tools/validate.py` re-checks it against `pack.ts`.

---

## 3. The mapping (definition → file → gain)

One file per definition — no shared files in V2. Parentheses are the manifest's
`recommendedVolume` (`fileGain`). ● = V2-authored file (re-rendered or new), ○ = kept V1 file.

| Definition | File (gain) |
|---|---|
| **UI** | |
| `uiClick` ○ | `ui/ui-click.ogg` (.35) |
| `uiHover` ○ | `ui/ui-hover.ogg` (.28) |
| `uiSelect` ○ | `ui/hero-select.ogg` (.4) |
| `matchStart` ○ | `ui/match-start.ogg` (.55) |
| `uiPause` ○ / `uiResume` ○ | `ui/pause.ogg` (.3) / `ui/resume.ogg` (.32) |
| `shopOpen` ○ / `shopBuy` ○ | `ui/shop-open.ogg` (.32) / `ui/item-purchase.ogg` (.38) |
| `uiLevel` ● | `ui/level-up.ogg` (.45) |
| `uiGold` ○ | `ui/gold-reward.ogg` (.3) |
| `uiError` ○ | `ui/ui-error.ogg` (.32) |
| `musicVictory` ○ / `musicDefeat` ○ | `ui/victory-stinger.ogg` (.62) / `ui/defeat-stinger.ogg` (.56) |
| **Combat** | |
| `swing` / `swing2` / `swing3` ●●● | `combat/melee-swing-light.ogg` / `-2.ogg` / `-3.ogg` (.45 each) |
| `swingHeavy` ○ | `combat/melee-swing-heavy.ogg` (.58) |
| `hitMelee` / `hitMelee2` / `hitMelee3` ●●● | `combat/melee-impact-light.ogg` / `-2.ogg` / `-3.ogg` (.5 each) |
| `hitMeleeHeavy` ● | `combat/melee-impact-heavy.ogg` (.62) |
| `bowShot` ● | `combat/ranged-launch.ogg` (.4) |
| `hitArrow` ○ | `combat/arrow-impact.ogg` (.46) |
| `shPoisonHit` ● | `combat/arrow-impact-poison.ogg` (.46) |
| `magicShot` ● | `combat/magic-launch.ogg` (.42) |
| `hitMagic` ● | `combat/magic-impact.ogg` (.52) |
| `akStrikeHit` ● | `combat/magic-impact-arcane.ogg` (.52) |
| `emFireHit` ● | `combat/magic-impact-fire.ogg` (.52) |
| `heroHit` ● | `combat/hero-hit.ogg` (.45) |
| `dieBig` ○ / `respawn` ○ | `combat/hero-death.ogg` (.48) / `combat/hero-respawn.ogg` (.42) |
| `moveCommand` ○ | `combat/move-command.ogg` (.22) |
| `stepGrass` / `2` / `3` / `4` ●●●● | `combat/footstep-grass-1.ogg` … `-4.ogg` (.22 each; `-4` new, `-1/2/3` remixed) |
| `stepWater` / `2` / `3` ●●● | `combat/footstep-water-1.ogg` / `-2.ogg` / `-3.ogg` (.22 each) |
| **Hero abilities** | |
| `akStrike` ● | `heroes/arcane-knight/arcane-strike.ogg` (.52) |
| `akShield` ● | `heroes/arcane-knight/arcane-shield.ogg` (.44) |
| `akSlamWind` ● / `akSlamImpact` ● | `heroes/arcane-knight/ground-slam-windup.ogg` (.66) / `ground-slam-impact.ogg` (.65) — split |
| `akMeteorBuild` ● / `akMeteorImpact` ● | `heroes/arcane-knight/meteor-prison-windup.ogg` (.72) / `meteor-prison-impact.ogg` (.75) — split |
| `shDash` ○ | `heroes/shadow-huntress/shadow-dash.ogg` (.48) |
| `shPoison` ○ | `heroes/shadow-huntress/poison-arrow.ogg` (.46) |
| `shVeil` ● | `heroes/shadow-huntress/smoke-veil.ogg` (.4) |
| `shMark` ● / `shMarkBurst` ● | `heroes/shadow-huntress/death-mark-windup.ogg` (.62) / `death-mark-burst.ogg` (.8) — split |
| `emFireCast` ● | `heroes/ember-mage/fire-bolt.ogg` (.48) |
| `emWave` ○ | `heroes/ember-mage/flame-wave.ogg` (.55) |
| `emZoneFire` ● | `heroes/ember-mage/burning-zone-ignition.ogg` (.52) |
| `emStormBuild` ● / `emStormImpact` ● | `heroes/ember-mage/inferno-storm-windup.ogg` (.72) / `inferno-storm-burst.ogg` (.65) — split |
| `ngSeed` ● | `heroes/nature-guardian/healing-seed.ogg` (.42) |
| `ngRoot` ○ | `heroes/nature-guardian/root-trap.ogg` (.48) |
| `ngBarrier` ● | `heroes/nature-guardian/nature-barrier.ogg` (.42) |
| `ngRebirthBuild` ○ | `heroes/nature-guardian/forest-rebirth.ogg` (.62) |
| `swPunchHit` ● | `heroes/storm-warrior/lightning-punch.ogg` (.52) |
| `swField` ● | `heroes/storm-warrior/static-field.ogg` (.62 — rebalance) |
| `swCharge` ● / `swChargeHit` ● | `heroes/storm-warrior/thunder-charge-rush.ogg` (.64) / `thunder-charge-impact.ogg` (.8) — split |
| `swRage` ○ | `heroes/storm-warrior/storm-rage.ogg` (.62) |
| **Structures & boss** | |
| `siegeShot` ○ | `structures/tower-shot.ogg` (.45) |
| `hitHeavy` ● | `structures/tower-impact.ogg` (.54) |
| `collapseTower` ○ | `structures/tower-destroy.ogg` (.72) |
| `hitCore` ● | `structures/core-hit.ogg` (.46 — rebalance) |
| `coreCritical` ○ | `structures/core-critical.ogg` (.42) |
| `coreCollapse` ○ | `structures/core-destroy.ogg` (.82) |
| `bossAttack` ● | `structures/boss-attack.ogg` (.62) |
| `bossDeath` ○ | `structures/boss-death.ogg` (.7) |
| **Ambience** | |
| `ambWind` ● | `ambience/wind-loop.ogg` (.5) — stereo bed, non-positional |
| `ambForest` ● | `ambience/forest-emitter.ogg` (.45) — mono positional emitter |
| `ambRiver` ● | `ambience/river-emitter.ogg` (.5) — mono positional emitter |

The split wind-ups keep the old combined clips' gains; the new split impacts take their own mix
gains (per the audit plan). `preview.html` plays all 80 files, grouped the same way, with the
unused set marked.

---

## 4. Sound direction & variation

- **Attack / impact / tail** are separated by construction: a click/slap transient, a tonal
  body, and a band-specific tail (crackle, debris, chimney hiss…) each have their own layer in
  the recipe, so the mix keeps a readable hit at any volume.
- **Controls applied to V1's measured problems** (audit §3): impacts gained real high layers and
  lost boom-only bodies (small-speaker rule: < 30 % below 120 Hz, ≥ 15 % above 1 kHz on every
  fight cue); swings and launches gained mid-band body so they read on phone speakers; the
  identity collisions were re-voiced into distinct families (arcane = hollow FM + chime,
  fire = crackle + warm roar + ember tail, poison = fizz + wet thud).
- **Variation takes.** The most repeated combat cues ship as families of *meaningfully distinct*
  takes: three light swings, three light melee impacts (different centre frequencies, envelopes
  and tail textures — not volume-only clones), four grass steps, three water steps. Each take is
  level-matched to its family (within ±1 dB) and pairwise waveform similarity is < 0.69
  (gate: < 0.9). Take selection rotates deterministically in `combat.ts` and `footsteps.ts`;
  the pre-existing per-cue pitch/gain jitter still runs on top, and arrows and tower shots keep
  only that nudge, by design. *Take selection adds no new `Math.random()` draw* — the
  simulation's `rnd()` shares the global stream, so the audio layer rotates instead of drawing.
- **One cast, one impact.** The five `LINKED` suppressions that silenced a synth fallback impact
  under a combined file are gone because the combined files are gone; each split impact fires on
  the game's own resolved-hit event, and the ability suite pins that a cast never produces two
  impacts.

---

## 5. Level policy (measurable, not uniform normalization)

Nothing is uniformly normalized: each file is scaled to a **role target** and lifted/trimmed
once more by its `pack.ts` gain. The rules (from audit §5E, enforced by `measure.py` →
`validate.py` on the *decoded* OGGs):

| Role | File RMS target | Notes |
|---|---|---|
| Impacts & feedback | −16 ± 2 dB | crest 12–18 dB |
| Launches & casts (incl. swings) | −20 ± 2 dB | crest 12–18 dB |
| Split impacts | −16 ± 2 dB | crest 12–18 dB |
| Split wind-ups | −22 ± 2 dB | relaxed band rule (below) |
| Footsteps (take sets) | −21 ± 1.5 dB | level-matched within the family (±1 dB) |
| UI / stingers | −20 ± 3 / −18 ± 2 dB | |
| Beds | −22 ± 3 dB | manifest gain restores the mix level |

- **Peak discipline:** masters are limited to **−1.65 dBFS** true peak so that even with Vorbis
  decode overshoot every shipped file decodes at ≤ −1 dBFS with zero clipped samples (measured
  worst case at the shipped encoder setting: −1.60).
- **Band rules:** every cue heard in fights keeps < 30 % of its energy below 120 Hz and ≥ 15 %
  above 1 kHz; no single band may hold > 60 % of the energy of a frequently heard cue.
- **Take families** are matched to their quietest member before the family is written, so the
  rotation can never jump in level.
- **Wind-up rule (documented relaxation):** split wind-ups are deliberate low-forward swells —
  the tension should be *felt*. They are held to a relaxed rule instead of the fight-cue rule:
  < 80 % below 120 Hz and ≥ 15 % in 120 Hz–1 kHz (so they still read on a phone speaker). They
  are excluded from the small-speaker fight rule by design because their impact partner lands
  250 ms later and carries the intelligibility.
- **Manifest gains** (the two audit rebalances plus the beds) are the *only* `recommendedVolume`
  changes; everything else keeps the V1 mix level exactly. `manifest.json` records both the file
  level and the gain so the effective mix level of every voice is verifiable.

---

## 6. Export settings & how to re-render

**Masters:** float32 WAV, 44.1 kHz, mono for one-shots/emitters, stereo only for the wind bed.

**Shipped OGGs:** `ffmpeg -c:a libvorbis -q:a 7` (VBR) — exactly the master's channel count, no
loudness post-processing. Why q7: at q5 the measured decode overshoot broke the decoded
≤ −1 dBFS gate on two transient files (`burning-zone-ignition` decoded at −0.89 dBFS, a 0.6 dB
overshoot) and the decoded loop seam on `forest-emitter` came out at only −30 dB; at q7 both
pass with margin (worst decoded peak −1.60 dBFS; seams −59/−86/−60 dB). Reproduce with:

```sh
python doc/realm_siege_3d_sound_pack_v2/tools/design.py    # render all V2 masters (numpy/scipy)
python doc/realm_siege_3d_sound_pack_v2/tools/encode.py    # masters → public/audio/realm-siege/ (ffmpeg)
python doc/realm_siege_3d_sound_pack_v2/tools/manifest.py  # refresh manifest.json from pack.ts + files
python doc/realm_siege_3d_sound_pack_v2/tools/preview.py   # refresh preview.html
python doc/realm_siege_3d_sound_pack_v2/tools/validate.py  # acceptance run on the decoded OGGs
```

Requirements: Python 3.10+, `numpy`, `scipy`, and `ffmpeg` (with libvorbis) on `PATH`.
`tools/report.py` prints the per-file tuning table during authoring (masters side);
`tools/validate.py` is the final gate (decoded side) and writes `validation_report.json`.

**Beds and loop seams.** The three beds are stationary textures rendered ~9.4 s long; the writer
slides an 8.0 s window across that length and takes the offset whose wrap is quietest, then
glues the endpoints (a ≤ 0.02 %-of-peak correction spread over the last 120 ms) so the loop
point carries no value step. The remaining seam is codec-bound, which is why the seam is
measured on the decoded file and why the beds encode at q7 (see above). Master seam: exact 0;
shipped: −59 dB, −86 dB, −60 dB (gate −45).

---

## 7. Provenance

**All 80 files are original work created for this project. No third-party audio is used.**

- 47 V2 files: synthesized by `tools/design.py` (numpy/scipy) from the recipes in that file —
  none of them samples, resamples, or embeds any external recording.
- 28 kept files + 5 unused files: the V1 pack, which was likewise procedurally synthesized for
  this project (`doc/realm_siege_3d_sound_pack_v1/`).
- The in-game fallback is still the Web Audio synth in `src/audio/synth.ts` — also original.

`PROVENANCE.md` carries the per-family record (recipes, seeds, tool versions) and the license
statement. There is no attribution requirement beyond this repository's own license, because
there are no external sources to attribute.

---

## 8. Unused files (updated list)

All five still ship inside the build; none is wired to a definition. Reasons are duplicated in
`pack.ts` (`PACK_UNUSED`), `manifest.json` and here because the pack accounting test checks all
three stay in sync.

| File | Why it is unused |
|---|---|
| `ui/ui-confirm.ogg` | There is no separate "successful confirmation" moment: confirmations already own dedicated voices (`uiSelect`, `shopBuy`, `matchStart`). |
| `combat/shield-impact.ogg` | The game has no shield / damage-absorb mechanic (Arcane Knight's shield is a heal). |
| `heroes/ember-mage/burning-zone-loop.ogg` | Burning Zone is an instant one-shot AoE — looping it would be a phantom sustain. |
| `ambience/forest-loop.ogg` | Superseded by `forest-emitter.ogg` (mono, seam-safe, positional). Kept as the archival V1 stereo master. |
| `ambience/river-loop.ogg` | Superseded by `river-emitter.ogg` (mono, positional). Kept as the archival V1 stereo master. |

---

## 9. Validation status

Run on the shipped bytes (`tools/validate.py`, exit 1 on any failure):

- **Inventory:** 80 on disk = 75 mapped + 5 unused; every `pack.ts` file present; nothing
  unaccounted; 1:1 file-per-definition (no shared files).
- **47/47 V2 files** pass: true peak ≤ −1 dBFS, zero clipped samples, role RMS targets, crest
  12–18 on impacts/casts, fight-cue band rules, wind-up audibility, leading silence ≤ 10 ms.
- **Beds:** seams −58.8 / −85.9 / −60.3 dB (gate ≤ −45, target −50); channels 1/1/2 as
  designed (wind stereo bed; emitters mono).
- **Take sets:** max pairwise similarity 0.69 (gate < 0.9); level spread ≤ 0.32 dB (gate ±1).
- **Manifest coherence:** `manifest.json` matches `pack.ts` gains/paths and the decoded
  durations/levels (a stale manifest fails the run).

What validation does **not** cover: subjective listening. Use `preview.html` (all 80 files, or
the phase-7 audition page `doc/sound_pack_v2_audit/index.html` for the V1 reference) for the ear
check; the measurable gates above are necessary but not sufficient for "sounds right".

---

## 10. Honest limitations

- **Synthesis, not Foley.** These are designed synthetic assets. They are engineered for mix
  readability and game feel, but they cannot match recorded material in micro-texture. No claim
  is made otherwise anywhere in this pack.
- **Stone footsteps are absent, not skipped by choice.** The simulation's `map.surfaceAt()`
  only ever returns `'water'` or `'grass'`, so there is no stone/wood/dirt surface hook to
  attach a file to; adding stone takes would be dead weight. If the world ever gains more
  surfaces, the water/grass pattern in `footsteps.ts` is the template.
- **Wind-up band rule is relaxed on purpose** (see §5) — split wind-ups are not fight cues.
- **Beds carry a codec-bound seam**, not a design seam: master seams are exact, the shipped
  seam numbers above are what the decoder produces, and they are inside the audit gate.
- **Kept V1 files are untouched** — where the audit said KEEP and no remix was scheduled, the
  bytes are deliberately identical, including any known minor quirks (they are out of V2 scope
  by the audit's own verdicts).
- **Take selection rotates; the jitter still randomizes.** Repeated hits and steps cycle through
  their takes deterministically (consecutive takes always differ), while the pre-existing
  per-cue pitch/gain jitter supplies the per-hit randomness. A *random take* draw was avoided
  because the simulation's `rnd()` shares the global `Math.random` stream — a take rotation adds
  no draw to it.

---

## 11. Integration status

- `src/audio/pack.ts` is authoritative and current (75 mapped + 5 unused); `synth.ts` applies it
  at load time, so a missing file still falls back to the synth.
- The five audio suites (`tests/audio-pack`, `audio-abilities`, `audio-combat`, `audio-polish`,
  `audio-world`) pin the mapping, accounting, rotation and the no-duplicate-impact rule.
- `npm run typecheck` clean · full `npm test` green · `npm run build` ships the same 80 files
  into `dist/audio/realm-siege/` (Vite copies `public/`).
- The player-facing mix is unchanged (the two audit-named rebalances and the bed gains aside);
  nothing else in the game reads these files.
