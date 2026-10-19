# Sound Pack V2 — Audio Quality Audit & Replacement Plan

**Scope:** all 62 shipped files in `public/audio/realm-siege/` (Sound Pack V1 integration, phase 6).
**Method:** measurable signal analysis only. **No listening pass has been performed** — every
"issue" below is a statement about measured signal properties (levels, spectra, timing, seams,
similarity), and every "sounds like" descriptor is a hypothesis to verify in the audition page.
**Game code, engine, simulation and audio assets were not modified by this audit.**

> **Status — implemented (phase 8).** This plan has since been executed as **Sound Pack V2**:
> the replacement assets, mapping, audio-layer code touches and the acceptance runs live in
> `doc/realm_siege_3d_sound_pack_v2/` (`README.md` · `PROVENANCE.md` · `manifest.json` ·
> `preview.html` · `masters/` + `tools/`). This audit is kept as the original evidence and the
> specification; §5E below is the exact deck the shipped files are validated against
> (`tools/validate.py`, decoded-side, PASS).

Evidence produced by this audit (`doc/sound_pack_v2_audit/`):

| File | What it is |
|---|---|
| `analyze.py` | measurement pipeline (ffmpeg decode → numpy analysis), writes `metrics.json` |
| `metrics.json` | per-file metrics for all 62 files + duplicate/similarity data |
| `timing.py` | prominent-transient timing + loop-seam + similarity report |
| `analysis_table.txt` | the compact master table (62 rows) as printed by `analyze.py` |
| `build_page.py` | generates the audition page from `metrics.json` + audit verdicts |
| `index.html` | **the audition/review page** — 7 categories, players, metrics, verdict controls, export |

---

## 0. TL;DR

- 62 files measured: all 44 100 Hz Ogg Vorbis; 59 mono, 3 stereo (wind/forest/river loops).
- The pack is technically clean: **zero byte-identical duplicates**, zero DC issues, leading
  silence ≈ 0 everywhere, only **2 clipped samples in the entire pack** (both in `forest-loop`).
- Verdicts: **KEEP 27 · REMIX 20 · REPLACE 5 · SPLIT 7 · UNUSED 3**.
- Four structural findings drive most of the V2 plan:
  1. **All five combined cast+impact clips are front-loaded** — their strongest energy is in the
     first ~110 ms, 17–25 dB down by the game's +250 ms ability release. The audible "impact"
     can never align with the resolved hit. Fix: **split** into `-windup` + `-impact` files and
     fire the impact through the existing paired impact defs (no engine change).
  2. **Spectral crowding**: 15 of 62 files put > 45 % of energy in the sub/60–120 Hz bands, and
     16 of 62 put > 75 % in a *single* band. Frequent combat feedback (`hero-hit` 84 % sub,
     `tower-impact` 90 % < 120 Hz, `lightning-punch` 66 % sub) is near-inaudible on phone/laptop
     speakers; several different mechanics share the same "low rush" timbre.
  3. **Identity collisions**: `magic-impact` backs 3 different events (core bolt, AK Q, EM Q) and
     `arrow-impact` backs 2 (generic arrow, SH poison). `healing-seed` is 0.993-similar to
     `ui/hero-select`; `nature-barrier`/`smoke-veil`/`arcane-shield` share one swell (0.986–0.987).
  4. **The two unused ambience loops can't be used as-is** because the game's forest/river
     emitters are positional (mono) while both files are genuinely stereo. Re-author as mono
     emitter loops and the existing synth emitters can be upgraded to files.

---

## 1. What was measured (and what was not)

Decode: `ffmpeg` (native 44 100 Hz, native channels) → PCM WAV; analysis: Python + numpy.

Measured per file: ffprobe container data (codec/sample-rate/channels/bitrate); duration; peak
dBFS; RMS dBFS; crest factor; clipped/near-full-scale sample counts; DC offset; leading/trailing
silence; silent-frame fraction; effective end (last frame within −40 dB of max); energy-centroid
time; attack time; prominent envelope events (local maxima within 15 dB of max, ≥ 40 ms apart);
8-band energy shares (20–60, 60–120, 120–350, 350–1 k, 1–3 k, 3–6 k, 6–12 k, 12–20 kHz);
spectral centroid; spectral flatness; 85 % rolloff; stereo side/mid level; loop-seam step;
md5 of file bytes and of decoded PCM; and pairwise similarity (normalized cosine of
band-shape + 24-point envelope fingerprint; a **screen**, not proof).

Cross-checked against: `doc/realm_siege_3d_sound_pack_v1/sound_manifest.json` (durations,
volumes, loop/spatial flags) and the game code that routes every file (`src/audio/pack.ts`,
`combat.ts`, `abilities.ts`, `footsteps.ts`, `ambience.ts`) plus simulation timing
(melee contact +220 ms, ability release +250 ms).

**Not measured / not claimed:** anything requiring ears — timbre aesthetics, "does it feel good",
masking in a real match, platform speaker rendering. Those are exactly what the audition page
exists for. Usage of "thin", "harsh", "muddy" in this report always refers to the measured
band distribution, not to listening.

---

## 2. Pack-level measurements

| Metric | Result |
|---|---|
| Files | 62 (57 mapped, 5 unmapped) |
| Format | 100 % Ogg Vorbis @ 44 100 Hz |
| Channels | 59 mono (positional one-shots) + 3 stereo (`wind-loop`, `forest-loop`, `river-loop`) |
| Duration range | one-shots 0.087 s (`ui-click`) – 2.7 s (`defeat-stinger`); loops 4–8 s |
| Peak levels | 60 files within −5.2…−0.97 dBFS; **`forest-loop` peaks at 0.0 dBFS** |
| Clipped samples | **2** total, both in `forest-loop` — nowhere else |
| Exact duplicates | none (file bytes or decoded PCM) |
| Manifest drift | 4 files: `footstep-grass-3` +21 ms, `hero-respawn` +21 ms, `magic-impact` +22 ms, `flame-wave` +11 ms (trivial, noted for the manifest sync) |
| Single-band dominance (> 75 % in one band) | **16 files** |
| Low-heavy (> 45 % in sub + 60–120 Hz) | **15 files** — incl. `hero-hit` 89.5 %, `tower-impact` 89.8 %, `boss-attack` 89.8 %, `ground-slam` 82.3 %, `thunder-charge` 80.2 % |
| Energy below 60 Hz > 30 % | 7 files — `hero-hit` 84.1 %, `lightning-punch` 66.4 %, `tower-impact` 50.2 %, `death-mark` 44.5 %, `burning-zone-ignition` 45.9 %, `magic-impact` 36.3 %, `burning-zone-loop` 36.0 % |
| Loudness spread | file RMS −6.0 (`burning-zone-loop`) … −26.8 dBFS (`static-field`); with play-gains, **≈ 12 dB spread among simultaneously relevant cues** (static-field eff. ≈ −32.5 dBFS vs core-hit eff. ≈ −20.3 dBFS) |
| Loop seams (rel. peak) | `wind-loop` **−29.2 dB** (tick risk), `river-loop` −44.9 dB (borderline), `forest-loop` −58.5 dB, `burning-zone-loop` −68.3 dB |
| Stereo loops | genuinely stereo all three: side/mid = 0.1 dB (`forest`), 0.97 (`wind`), 2.3 (`river`) → incompatible with the mono positional emitter path as-is |

---

## 3. Findings by category

Legend — **KEEP** retain as-is · **REMIX** re-author same file/name · **REPLACE** new content,
new/or same name · **SPLIT** one file becomes windup + impact (or per-event variants) · **UNUSED**
unmapped asset.

### 3.1 Melee & ranged combat (9 files)

| File (mapped def) | Measured | Issue | Action | Verdict |
|---|---|---|---|---|
| `melee-swing-light.ogg` (`swing`) | 54 % energy > 3 kHz (25 % > 6 k), centroid 3.7 kHz, no content < 120 Hz, attack 0.0 s | Bright tonal hiss, no weapon body — and it is the wind-up for **every non-hero melee** (most-repeated combat cue) | Re-author: 90–350 Hz whoosh body + soft air; tame 6–12 kHz; optional 2nd take | REMIX |
| `melee-swing-heavy.ogg` (`swingHeavy`) | Balanced (44 % 120–350 + 32 % presence), tail covers +220 ms contact | none | retain | KEEP |
| `melee-impact-light.ogg` (`hitMelee`) | 85.9 % in 120–350 Hz, 0.2 % in 350–1 k, 1.8 % in 3–6 k | Narrow "box thump": no slap/snap, will not cut a fight | Add 2–5 kHz slap + 6–10 kHz tick | REMIX |
| `melee-impact-heavy.ogg` (`hitMeleeHeavy`) | 73.3 % below 120 Hz, 2.1 % presence | Rumble-forward; loses definition on small speakers | Add 300 Hz–3 kHz body layer | REMIX |
| `ranged-launch.ogg` (`bowShot`) | 57 % > 3 kHz (33 % 6–12 k), no < 350 Hz, RMS −26.2 | Hiss/air burst, no string body; quiet | Add 200–800 Hz string layer; ↑ RMS to ≈ −22 | REMIX |
| `arrow-impact.ogg` (`hitArrow` **+** `shPoisonHit`) | 74.8 % 120–350 Hz, otherwise balanced | One voice for two identities (generic vs poison) | Keep for `hitArrow`; new poison variant | SPLIT |
| `magic-launch.ogg` (`magicShot`) | 96 % in 120 Hz–1 kHz, centro 584, flat tone | No shimmer at all; "flat wumm" | Add 2–8 kHz shimmer + slow sweep | REMIX |
| `magic-impact.ogg` (`hitMagic` **+** `akStrikeHit` **+** `emFireHit`) | 36.3 % sub + 56.3 % 350 Hz–1 k, crest 16.5 | Three unrelated events, one generic boom; sub-heavy | Neutral remix for `hitMagic`; new arcane + fire variants | SPLIT |
| `shield-impact.ogg` (unmapped) | clean asset (43/53 % 350 Hz–3 kHz, crest 21.6) | no shield mechanic exists | keep unmapped | UNUSED |

### 3.2 Damage & death (3 files)

| File (def) | Measured | Issue | Action | Verdict |
|---|---|---|---|---|
| `hero-hit.ogg` (`heroHit`) | **84.1 % < 60 Hz**, centroid 96 Hz, 89.5 % < 120 Hz | The personal damage cue is essentially inaudible on phone/laptop speakers | Cut sub < 30 %; add 300 Hz–2 kHz tick + 80–150 Hz body | REMIX |
| `hero-death.ogg` (`dieBig`) | balanced dark dissolve, 1.05 s, rich 120 Hz–1 kHz | none | retain | KEEP |
| `hero-respawn.ogg` (`respawn`) | rising swell ≈ 1 s, balanced | none (+21 ms vs manifest) | retain | KEEP |

### 3.3 Heroes & abilities (20 files)

| File (def) | Measured | Issue | Action | Verdict |
|---|---|---|---|---|
| AK `arcane-strike.ogg` (`akStrike`) | 75.9 % in one band (350 Hz–1 k), tonal | Narrow hum, no arcane sweep; hit is the shared generic impact | Add 2–6 kHz sweep + tail; hit gets own file (§5B) | REMIX |
| AK `arcane-shield.ogg` (`akShield`) | 0.986 sim. `nature-barrier`, 0.984 sim. `core-critical` | Different mechanics share one protective-swell timbre | Re-author: ringing crystalline, tighter envelope | REMIX |
| AK `ground-slam.ogg` (`akSlamWind`+suppressor) | peak @0.01 s, −32.1 dBFS at +0.25 s (21 dB down), 82.3 % < 120 Hz | Combined clip front-loads; slam cannot align with the +250 ms hit | **split** windup/impact | SPLIT |
| AK `meteor-prison.ogg` (`akMeteorBuild`+suppr.) | peaks @0.0/0.07 s; −24.8 dBFS at +0.25 s | Buildup+explosion cannot match resolution | **split** | SPLIT |
| SH `shadow-dash.ogg` (`shDash`) | 54 % presence + low hints, 0.42 s whoosh | none | retain | KEEP |
| SH `poison-arrow.ogg` (`shPoison`) | 74.6 % 350 Hz–1 k launch body, distinct from `ranged-launch` | hit is shared (see SPLIT §3.1) | retain launch | KEEP |
| SH `smoke-veil.ogg` (`shVeil`) | 0.987 sim. `nature-barrier` | Stealth tool sounds like a heal | Dark airy noise bloom, no tonal swell | REMIX |
| SH `death-mark.ogg` (`shMark`+suppr.) | peak @0.01 s, 62 % < 120 Hz, −34.5 dBFS @ +0.25 s | Front-loaded; detonation can't align | **split** | SPLIT |
| EM `fire-bolt.ogg` (`emFireCast`) | 40 % > 3 kHz, flatness 0.069 (crackle), almost no < 350 Hz | Hiss-forward, no flame warmth; hit is shared | Add 300–900 Hz body; hit gets own file | REMIX |
| EM `flame-wave.ogg` (`emWave`) | 44.6 % 120–350 + 22 % 3–6 k rush | none | retain | KEEP |
| EM `burning-zone-ignition.ogg` (`emZoneFire`) | **76.9 % < 120 Hz**, crackle ≈ 5 % > 3 kHz | Sub swell, not an ignition | Rebuild around 2–8 kHz crackle | REMIX |
| EM `inferno-storm.ogg` (`emStormBuild`+suppr.) | peak @0.0 s, 78.6 % < 120 Hz, −30 dBFS @ +0.25 s | Rumble; can't align or cut | **split** + high fire layers | SPLIT |
| NG `healing-seed.ogg` (`ngSeed`) | 79.8 % one band; **0.993 sim. `ui/hero-select`**, 0.989 `level-up` | Healing chime is indistinguishable from menu UI | Organic re-author (marimba + leaf noise) | REMIX |
| NG `root-trap.ogg` (`ngRoot`) | 57 % 120–350 + earthy bands | none | retain | KEEP |
| NG `nature-barrier.ogg` (`ngBarrier`) | 0.986–0.987 sim. shield/smoke family | Identical timbre family | Organic bloom re-author | REMIX |
| NG `forest-rebirth.ogg` (`ngRebirthBuild`) | 1.65 s rising, broad-ish | none | retain | KEEP |
| SW `lightning-punch.ogg` (`swPunchHit`) | **66.4 % sub**, only ~4 % > 3 kHz | The punch is a sub thud; no crack | Cut sub; promote 2–6 kHz crack | REMIX |
| SW `static-field.ogg` (`swField`) | RMS −26.8 → **eff. −32.5 dBFS (~9–12 dB under peers)**, crest 23.3 | Will vanish in a fight | ↑ RMS ≈ −19, add hum layer, rebalance gain | REMIX |
| SW `thunder-charge.ogg` (`swCharge`+suppr.) | peak @0.015 s, 80.2 % < 120 Hz, −29.8 dBFS @ +0.25 s | Front-loaded low rush | **split** | SPLIT |
| SW `storm-rage.ogg` (`swRage`) | 30 % presence + 35 % low-mid, 1.05 s rise | none | retain | KEEP |

### 3.4 Towers, core & boss (8 files)

| File (def) | Measured | Issue | Action | Verdict |
|---|---|---|---|---|
| `tower-shot.ogg` (`siegeShot`) | 74.6 % 120–350 + 6.9 % 3–6 k edge | none | retain | KEEP |
| `tower-impact.ogg` (`hitHeavy`) | **89.8 % < 120 Hz** (50 % sub), RMS −17 | Barely audible on small speakers | Add 300 Hz–2 kHz crack | REMIX |
| `tower-destroy.ogg` (`collapseTower`) | 79.4 % < 120 Hz, 1.1 s | Low-heavy but a collapse may; mud-prone | retain (optional debris ticks) | KEEP |
| `core-hit.ogg` (`hitCore`) | **97.2 % in one band** (350 Hz–1 k), crest 14, **hottest file (−15.1 dB RMS)** | Pure tone, repeated on every core hit, global — fatigue + masking | Widen spectrum, −3 dB RMS, 2nd take optional | REMIX |
| `core-critical.ogg` (`coreCritical`) | 60 % 120–350 + 33 % presence, 1 s pulse | none | retain | KEEP |
| `core-destroy.ogg` (`coreCollapse`) | 1.65 s, energy tail | none | retain | KEEP |
| `boss-attack.ogg` (`bossAttack`) | **89.8 % < 120 Hz**, 0.987 sim. `thunder-charge`, 0.982 `ground-slam` | Boss shares the low-rush family; only rumbles | Add 200 Hz–2 kHz roar body | REMIX |
| `boss-death.ogg` (`bossDeath`) | 1.5 s, balanced 120 Hz–1 kHz | none | retain | KEEP |

### 3.5 UI & rewards (12 files)

| File (def) | Measured | Issue | Action | Verdict |
|---|---|---|---|---|
| `ui-click.ogg` (`uiClick`) | 90.9 % 120–350 Hz, 0.087 s | Muffled by design; no measurable defect | retain (optional +2 kHz tick) | KEEP |
| `ui-hover.ogg` (`uiHover`) | 89.4 % 350 Hz–1 k, 0.107 s | none | retain | KEEP |
| `ui-confirm.ogg` (unmapped) | clean, 0.65 s | no distinct confirmation moment in the game | keep unmapped | UNUSED |
| `ui-error.ogg` (`uiError`) | 98.7 % 120–350 Hz, 0.24 s | Dull — appropriate for a refusal | retain | KEEP |
| `pause.ogg` / `resume.ogg` | 0.980 sim. — mirrored pair, intentional | none | retain | KEEP |
| `hero-select.ogg` (`uiSelect`) | 87.6 % one band | none in context (but see healing-seed split) | retain | KEEP |
| `match-start.ogg` (`matchStart`) | 1.55 s swell, sub foundation | none | retain | KEEP |
| `shop-open.ogg` (`shopOpen`) | 0.34 s metallic open | none | retain | KEEP |
| `item-purchase.ogg` (`shopBuy`) | 78.4 % 1–3 k; 0.985 sim. `gold-reward` | Same coin timbre at two scales | retain (family acceptable) | KEEP |
| `gold-reward.ogg` (`uiGold`) | 84.7 % 1–3 k sparkle | shares coin family with purchase | retain | KEEP |
| `level-up.ogg` (`uiLevel`) | 0.979/0.977 sim. `hero-select`/`ui-confirm` | The celebration sounds like a generic confirm | Growing arpeggio + 1.2–1.5 s tail | REMIX |

### 3.6 Music & ambience (6 files)

| File (def) | Measured | Issue | Action | Verdict |
|---|---|---|---|---|
| `victory-stinger.ogg` (`musicVictory`) | 2.6 s, broad spectrum | none | retain | KEEP |
| `defeat-stinger.ogg` (`musicDefeat`) | 2.7 s, dark descending, 57.7 % < 120 Hz | none (intended weight) | retain | KEEP |
| `wind-loop.ogg` (`ambWind`) | 8 s stereo, **seam −29.2 dB rel. peak**, 95 % < 120 Hz, crest 7.7 | Possible soft tick every 8 s; very dark | Crossfaded seam (< −50 dB); add faint 1–4 kHz air | REMIX |
| `forest-loop.ogg` (unmapped) | **0.0 dBFS peak, 2 clipped samples**, 79 % > 1 kHz (hiss-heavy), stereo side/mid 0.1 | Clipping + hiss; stereo can't serve positional emitter | Re-author as **`forest-emitter.ogg`** (mono, seam-safe, tamed hiss) | REPLACE |
| `river-loop.ogg` (unmapped) | 94.2 % in one band (120–350 Hz), stereo side/mid 2.3, RMS −7.4 | Narrow texture; stereo emitter mismatch | Re-author as **`river-emitter.ogg`** (mono, 200 Hz–4 kHz texture) | REPLACE |
| `burning-zone-loop.ogg` (unmapped) | 4 s mono, RMS −6.0 / crest 5.0 (heavily limited) | No persistent zone mechanic; over-limited | keep unmapped; normalize if ever used | UNUSED |

### 3.7 Footsteps & movement (4 files)

| File (def) | Measured | Issue | Action | Verdict |
|---|---|---|---|---|
| `footstep-grass-1.ogg` (`stepGrass`) | peak **−0.97 dBFS**; 0.992/0.988 sim. to takes 2/3 | > 3 dB hotter than 2/3 → random picks jump in level; three near-copies | Replace set with 4 varied, level-matched takes | REPLACE |
| `footstep-grass-2.ogg` (`stepGrass2`) | peak −4.29 dBFS; 0.997 sim. take 3 | near-copy | (same set replacement) | REPLACE |
| `footstep-grass-3.ogg` (`stepGrass3`) | peak −5.18; 46 ms near-empty tail; +21 ms vs manifest | near-copy + silent tail | (same set replacement) | REPLACE |
| `move-command.ogg` (`moveCommand`) | 99.7 % one band, 0.107 s, peak −3.4 (deliberately quiet) | none | retain | KEEP |

**Missing surface:** `map.ts` `surfaceAt` returns `'water' | 'grass'` and water movement is
audible gameplay — but the pack ships **no water footsteps**; `stepWater` is a synth-only
fallback. This is the single concrete "missing variation" gap in category 7.

---

## 4. Systemic findings (cross-cutting)

**S1 — Combined clips can't align with the game's hit (+250 ms).** Measured envelope level at
+0.25 s relative to each clip's own peak: `ground-slam` −21 dB, `meteor-prison` −15 dB,
`death-mark` −26 dB, `inferno-storm` −22 dB, `thunder-charge` −18 dB. All five put their
strongest transients in 0.0–0.11 s. The current integration fires them at **cast**; the paired
impact defs that would fire at the **resolved hit** are silenced by `LINKED`. V2 splits the files
and lets the existing paired defs carry the impact — the timing fix is achieved by *using* the
mechanism that exists, not by changing the engine or the simulation.

**S2 — Spectral crowding / small-speaker problem.** 15/62 files > 45 % in sub+60–120 Hz; 16/62
> 75 % in one band. Simultaneous cues (creeps trading, tower impacts, hero-hit, ultimates) all
sum into 60–350 Hz → mud and masking, while phone/laptop speakers reproduce almost none of it.
V2 assigns each family a band signature instead of everyone living in the basement: melee =
body + 2–5 kHz slap; magic = 2–8 kHz shimmer; nature = rustle 300 Hz–4 kHz; storm = 2–6 kHz
crack; structures = crack + reduced sub.

**S3 — Loudness imbalance.** Effective level spread across frequently-co-heard cues ≈ 12 dB
(`core-hit` eff. ≈ −20.3 dBFS vs `static-field` eff. ≈ −32.5 dBFS). `core-hit` is the hottest
file and repeats globally; `static-field` is the quietest ability. V2 adds explicit RMS targets
(§5E) and two gain rebalances (`swField`, `hitCore`).

**S4 — Repetition clusters (screen, corroborated by level/duration).** Grass takes 0.988–0.997;
`healing-seed`↔`hero-select` 0.993, ↔`level-up` 0.989; protective swells `arcane-shield`↔
`nature-barrier`↔`smoke-veil` 0.986–0.987; low-rush family `thunder-charge`↔`boss-attack` 0.987,
`ground-slam`↔`boss-attack` 0.982; coin family `item-purchase`↔`gold-reward` 0.985; `pause`↔
`resume` 0.980 (**intentional** mirror, not a defect). Note the similarity metric is
shape-based and over-resembles simple one-shot decays in general (e.g. `magic-launch`↔
`shop-open` 0.975 is coincidental); only clusters with corroborating evidence (near-equal
durations/levels or same-context defs) are actioned above.

**S5 — Shared files.** `arrow-impact` → 2 defs, `magic-impact` → 3 defs (by V1 design). Both are
split in V2 so each identity has its own file.

**S6 — Loops.** Seams: `wind-loop` −29.2 dB rel. peak is the one real risk (audible-as-tick
hypothesis to confirm by ear); `river-loop` −44.9 dB borderline. All three stereo beds are
genuinely stereo (side/mid 0.1–2.3 dB) — good for a non-positional bed, but the reason they
cannot be dropped into the game's **positional** forest/river emitters, which are mono.
`forest-loop` additionally clips (2 samples) and is hiss-heavy (79 % > 1 kHz).

**S7 — Missing assets found by the audit.** (a) water footsteps (surface exists, files don't);
(b) file loops for the existing positional emitters `ambForest`/`ambRiver` (and optionally
`ambBase`, which has no pack asset at all) — currently synthesized.

**S8 — Unused assets, dispositions.** `shield-impact` (retain unmapped; asset is clean),
`ui-confirm` (retain unmapped; no moment for it), `burning-zone-loop` (retain unmapped;
normalize if a zone mechanic ever ships), `forest-loop`/`river-loop` (content re-authored into
mono emitter files; originals superseded).

**S9 — Manifest drift.** 4 durations differ by 11–22 ms from the manifest — sync the manifest
when V2 ships (the pack test reads the same numbers).

---

## 5. Sound Pack V2 — the replacement plan

**Implemented as Sound Pack V2 (phase 8):** the shipped record is `doc/realm_siege_3d_sound_pack_v2/README.md`, and the decoded-file acceptance run is `tools/validate.py` there. This section stays as the specification the implementation was measured against.

### A. Remix in place — same filename, same def(s), no code change (20 files)

`combat/melee-swing-light.ogg` · `combat/melee-impact-light.ogg` · `combat/melee-impact-heavy.ogg`
· `combat/ranged-launch.ogg` · `combat/magic-launch.ogg` · `combat/hero-hit.ogg` ·
`heroes/arcane-knight/arcane-strike.ogg` · `heroes/arcane-knight/arcane-shield.ogg` ·
`heroes/shadow-huntress/smoke-veil.ogg` · `heroes/ember-mage/fire-bolt.ogg` ·
`heroes/ember-mage/burning-zone-ignition.ogg` · `heroes/nature-guardian/healing-seed.ogg` ·
`heroes/nature-guardian/nature-barrier.ogg` · `heroes/storm-warrior/lightning-punch.ogg` ·
`heroes/storm-warrior/static-field.ogg` · `structures/tower-impact.ogg` · `structures/core-hit.ogg`
· `structures/boss-attack.ogg` · `ui/level-up.ogg` · `ambience/wind-loop.ogg` — each with the
target change from §3 (23 files if counting the REPLACE-in-place footstep set below).

Also replaced in place (same filenames, new content, no code change):
`combat/footstep-grass-1.ogg`, `-2.ogg`, `-3.ogg` → 4 level-matched takes (see C for the 4th).

### B. Splits — new files + def wiring (13 new files)

**B1. Front-loaded combined clips → windup + impact** (the impact defs already exist in the
game and are exactly the events that fire at the resolved hit; the `LINKED` suppression for
each ability is deleted so the paired impact plays again):

| Ability | New windup file → def | New impact file → def | Code: remove `LINKED` entry |
|---|---|---|---|
| AK E | `heroes/arcane-knight/ground-slam-windup.ogg` → `akSlamWind` | `heroes/arcane-knight/ground-slam-impact.ogg` → `akSlamImpact` | `AK E` |
| AK R | `heroes/arcane-knight/meteor-prison-windup.ogg` → `akMeteorBuild` | `heroes/arcane-knight/meteor-prison-impact.ogg` → `akMeteorImpact` | `AK R` |
| SH R | `heroes/shadow-huntress/death-mark-windup.ogg` → `shMark` | `heroes/shadow-huntress/death-mark-burst.ogg` → `shMarkBurst` | `SH R` |
| EM R | `heroes/ember-mage/inferno-storm-windup.ogg` → `emStormBuild` | `heroes/ember-mage/inferno-storm-burst.ogg` → `emStormImpact` | `EM R` |
| SW E | `heroes/storm-warrior/thunder-charge-rush.ogg` → `swCharge` | `heroes/storm-warrior/thunder-charge-impact.ogg` → `swChargeHit` | `SW E` |

(The 5 old combined files — `ground-slam.ogg`, `meteor-prison.ogg`, `death-mark.ogg`,
`inferno-storm.ogg`, `thunder-charge.ogg` — are superseded and leave the pack.)

**B2. Shared generic impacts → per-identity files:**

| New file | Replaces (def) | Character target |
|---|---|---|
| `combat/arrow-impact-poison.ogg` | `arrow-impact` for `shPoisonHit` | wet/toxic hit, dark + 1–5 kHz splat |
| `combat/magic-impact-arcane.ogg` | `magic-impact` for `akStrikeHit` | crystalline shatter, 2–8 kHz ring |
| `combat/magic-impact-fire.ogg` | `magic-impact` for `emFireHit` | fire pop + sizzle tail |

`combat/magic-impact.ogg` stays for `hitMagic` (remixed, sub < 15 %).

### C. New assets — gaps the pack never covered (5 new files)

| New file | Def | Why |
|---|---|---|
| `combat/footstep-water-1.ogg` | `stepWater` | `surfaceAt` water exists; only synth fallback today |
| `combat/footstep-water-2.ogg` | `stepWater2` (new synth def) | surface variation (mirrors grass pick) |
| `combat/footstep-water-3.ogg` | `stepWater3` (new synth def) | surface variation |
| `ambience/forest-emitter.ogg` | `ambForest` (def exists, positional) | upgrade the synthesised jungle-camp emitters to a file loop |
| `ambience/river-emitter.ogg` | `ambRiver` (def exists, positional) | upgrade the synthesised river emitters to a file loop |

Optional (P2, only if the ear-check asks for more): `combat/footstep-grass-4.ogg` (`stepGrass4`),
`ambience/base-emitter.ogg` (`ambBase`), `combat/melee-swing-light-2.ogg` +
`combat/melee-impact-light-2.ogg` + random pick (anti-repetition for the most-repeated cues),
`structures/core-hit-2.ogg` (`hitCore2`).

### D. Code/config changes required (audio layer only — no engine, no simulation)

| File | Change |
|---|---|
| `src/audio/pack.ts` | add 18 entries (B1 impacts, B2 variants, C water + emitters); repoint `akSlamWind/akMeteorBuild/shMark/emStormBuild/swCharge` to the new windup files; `shPoisonHit` → `arrow-impact-poison.ogg`; `akStrikeHit` → `magic-impact-arcane.ogg`; `emFireHit` → `magic-impact-fire.ogg`; `ambForest`/`ambRiver` → emitter files; add `stepWater2/3` |
| `src/audio/abilities.ts` | `LINKED` becomes `{}` (all 5 combined-clip suppressions removed — mechanism stays for future use) |
| `src/audio/footsteps.ts` | water surface picks randomly from `stepWater/2/3` (mirrors the grass path) |
| `src/audio/synth.ts` | add `stepWater2`, `stepWater3` defs (synth fallbacks) — and optional P2 defs |
| `src/audio/world.ts` | add the new step defs to `WORLD_SOUNDS` (preload list) |
| `tests/audio-pack.test.ts` | update pinned accounting: 75 files on disk (62 − 5 combined + 18 new), mapped defs 60 → 67; update `README.md` phase table |

### E. Quality targets for every V2 asset (measurable acceptance)

- True peak ≤ −1 dBFS; **zero clipped samples**; leading silence ≤ 10 ms on one-shots.
- RMS targets (file level, before play-gain): impacts/feedback −16±2 · launches/casts −20±2 ·
  split impacts −16±2, split windups −22±2 · UI −20±3 · stingers −18±2 · beds −22±3.
- Crest 12–18 dB for impacts and casts (avoid both box-tone and over-limit).
- No single band > 60 % energy for cues heard frequently; any cue heard in fights keeps
  < 30 % below 120 Hz and ≥ 15 % above 1 kHz (small-speaker rule).
- Loops: seam step ≤ −45 dB rel. peak (target −50; `wind-loop` currently −29.2), no clipping,
  mono for positional emitters, stereo only for beds.
- Grass/water take sets: pairwise similarity < 0.9, level-matched within ±1 dB.

### F. Explicitly out of scope

Audio engine architecture, voice budget/throttle tuning (existing 32-voice cap, non-priority
budget, per-cue throttles stay), simulation timing, `recommendedVolume` changes beyond the two
named rebalances (`swField` up, `hitCore` down), and any content outside `public/audio/realm-siege/`.

---

## 6. Audition workflow (the "listen" half of the audit)

Open **`doc/sound_pack_v2_audit/index.html`** (double-click; if the browser blocks local media,
serve the repo with any static server and open the same path). The page:

- groups all 62 files into the seven requested review categories (which match §3);
- each row: audio player (+ loop toggle for beds), the mapped def(s) and game trigger, the
  measured metrics and band-shape bar, the audit finding, the recommended action, a **verdict
  selector** and a note field (saved in `localStorage`);
- **"play group"** walks a category sequentially — the fastest way to ear-test repetition,
  level jumps and family collisions; **"Export decisions (.md)"** downloads your overrides +
  notes for the V2 authoring brief.

Suggested listening checklist (the hypotheses this audit could not verify):
1. Grass takes: level-match and audible variation after replacement · 2. `wind-loop` seam tick
(after remix, loop ×30 on headphones) · 3. Split pairs land with the +250 ms hit (in-game, AK E /
AK R / SH R / EM R / SW E) · 4. Small-speaker test for the sub-heavy remixes (phone/laptop) ·
5. Team-fight mask test (both teams creeps + 2 ultimates) · 6. `static-field` audibility in a
fight · 7. AK vs EM vs neutral magic impacts distinguishable · 8. Poison vs generic arrow impact
identities · 9. Heal ≠ UI chime · 10. Level-up ≠ hero-select.
