# Prompt siap pakai — Integrasi Realm Siege 3D Sound Pack v1

Gunakan prompt ini setelah ZIP sound pack diekstrak atau file pack tersedia di workspace Puter AI. Jika ZIP diunggah ke Puter AI, minta agent membaca dan mengekstrak folder `audio/` dari arsip itu. Asset runtime harus berakhir di `public/audio/realm-siege/`.

---

You are working on the EXISTING Realm Siege 3D project (Three.js + TypeScript + Vite). The game is already playable and its existing generated/synthesized sound effects are functional, but their quality is not good enough.

A sound pack has been provided with 62 original audio files in Ogg Vorbis format, plus `sound_manifest.json` and `README.md`.

## NON-NEGOTIABLE RULES

1. Inspect the actual project before changing code.
2. Reuse the current audio engine, AudioContext, buses, settings, mute, volume preferences, UI, and lifecycle handling. Do NOT create a second AudioManager or a competing audio framework.
3. Replace the weak synthesized sound for an event with the corresponding OGG asset when that asset exists.
4. Keep Web Audio synthesis ONLY as a fallback if a file fails to load; do not play the fallback and the OGG together for the same event.
5. Preserve the current game simulation, combat, abilities, hero movement, AI, HUD, mobile touch controls, and desktop input.
6. Do not download audio from external URLs at runtime.
7. Do not use or imitate Dota 2's actual audio recordings or voice lines.
8. Do not play audio from the render/update loop. Connect audio to real gameplay events, exactly once per event.
9. Do not claim browser audio tests passed unless playback was actually tested.

## STEP 1 — INSTALL ASSETS

Find the sound pack archive or folder in the workspace. Copy its `audio/` directory without changing internal file names into:

`public/audio/realm-siege/`

The resulting examples must exist:

- `public/audio/realm-siege/ui/ui-click.ogg`
- `public/audio/realm-siege/combat/melee-swing-light.ogg`
- `public/audio/realm-siege/heroes/ember-mage/fire-bolt.ogg`
- `public/audio/realm-siege/structures/core-destroy.ogg`
- `public/audio/realm-siege/ambience/wind-loop.ogg`

Read `sound_manifest.json` and `README.md` from the pack. Do not guess paths. If the archive is not available in the workspace and these files are not present, stop and report that the assets need to be uploaded or copied; do not create fake missing files.

## STEP 2 — AUDIT CURRENT AUDIO INTEGRATION

Inspect the existing AudioManager/audio loader/event bus, current generated synthesis, volume controls, user-gesture initialization, and game events.

Identify the real code paths for:

- UI click, hero selection, shop, item purchase.
- Match start, pause, resume, victory, and defeat.
- Basic attack wind-up and confirmed hit.
- Physical/ranged projectile launch and impact.
- Magical projectile launch and impact.
- Skill cast and skill effect.
- Hero damage, death, and respawn.
- XP/level-up and meaningful gold rewards.
- Tower shot, hit, destruction.
- Core hit, critical-health transition, and destruction.
- Existing music and ambience lifecycle.

Do not refactor unrelated gameplay code. Reuse existing event hooks where possible.

## STEP 3 — LOAD PACK ASSETS

Use the existing asset-loading strategy. If there is no asset registry, extend the current audio module rather than adding another engine.

Use `import.meta.env.BASE_URL` or the project's established base-path helper when constructing static asset URLs so deployment works under Vite/Cloudflare Pages base paths. Do not hardcode a development-server hostname.

Use:
- Non-positional audio for UI, music, and stereo ambient loops.
- Positional audio for mono combat effects when world coordinates are available.
- Existing master/SFX/music/ambient/UI buses and the saved volume preferences.
- Decode/cache loaded audio rather than downloading/decoding the same file repeatedly.
- Safe failure handling and optional synthesis fallback when an OGG cannot be loaded.

The SFX should honor current settings. Do not override the player's saved settings on every match start.

## STEP 4 — MAP AUDIO TO GAMEPLAY EVENTS

### UI and match events

- UI hover -> `ui/ui-hover.ogg` (desktop hover only; debounce; optional on touch).
- UI click -> `ui/ui-click.ogg`.
- Successful confirmation -> `ui/ui-confirm.ogg`.
- Invalid action / unavailable skill -> `ui/ui-error.ogg`, rate-limited.
- Hero selected -> `ui/hero-select.ogg`.
- Match start -> `ui/match-start.ogg`.
- Pause / resume -> `ui/pause.ogg` / `ui/resume.ogg`.
- Shop opened -> `ui/shop-open.ogg`.
- Successful item purchase -> `ui/item-purchase.ogg`.
- Hero level-up -> `ui/level-up.ogg`.
- Meaningful gold award -> `ui/gold-reward.ogg`, rate-limited.
- Victory / defeat -> respective stinger, once per transition.

### Basic combat

- Light melee attack wind-up -> `combat/melee-swing-light.ogg`.
- Heavy melee attack wind-up -> `combat/melee-swing-heavy.ogg`.
- Confirmed melee hit -> choose `combat/melee-impact-light.ogg` or `combat/melee-impact-heavy.ogg`.
- Physical/ranged projectile launch -> `combat/ranged-launch.ogg`.
- Confirmed arrow/physical ranged impact -> `combat/arrow-impact.ogg`.
- Magic projectile launch -> `combat/magic-launch.ogg`.
- Confirmed magic impact -> `combat/magic-impact.ogg`.
- Player hero receives meaningful damage -> `combat/hero-hit.ogg`, with throttle and priority.
- Shield actually blocks damage -> `combat/shield-impact.ogg`.
- Hero death/respawn -> `combat/hero-death.ogg` / `combat/hero-respawn.ogg`.
- Player-issued move command -> `combat/move-command.ogg`, debounced.
- Player locomotion footsteps -> randomly select `combat/footstep-grass-1.ogg`, `-2.ogg`, or `-3.ogg` at movement-speed-based cadence; stop when stationary, dead, or interrupted.

Avoid stacking all impact clips on a single hit. Pick the best primary impact, and only add a secondary cue when it has a different clear role.

### Hero ability mapping

Resolve hero/ability from actual game definitions. In the current intended design the mapping is:

- Arcane Knight — Arcane Strike -> `heroes/arcane-knight/arcane-strike.ogg`
- Arcane Knight — Shield Wall -> `heroes/arcane-knight/arcane-shield.ogg`
- Arcane Knight — Ground Slam -> `heroes/arcane-knight/ground-slam.ogg`
- Arcane Knight — Meteor Prison -> `heroes/arcane-knight/meteor-prison.ogg`
- Shadow Huntress — Shadow Dash -> `heroes/shadow-huntress/shadow-dash.ogg`
- Shadow Huntress — Poison Arrow -> `heroes/shadow-huntress/poison-arrow.ogg`
- Shadow Huntress — Smoke Veil -> `heroes/shadow-huntress/smoke-veil.ogg`
- Shadow Huntress — Death Mark -> `heroes/shadow-huntress/death-mark.ogg`
- Ember Mage — Fire Bolt -> `heroes/ember-mage/fire-bolt.ogg`
- Ember Mage — Flame Wave -> `heroes/ember-mage/flame-wave.ogg`
- Ember Mage — Burning Zone -> `heroes/ember-mage/burning-zone-ignition.ogg`
- Ember Mage — Inferno Storm -> `heroes/ember-mage/inferno-storm.ogg`
- Nature Guardian — Healing Seed -> `heroes/nature-guardian/healing-seed.ogg`
- Nature Guardian — Root Trap -> `heroes/nature-guardian/root-trap.ogg`
- Nature Guardian — Nature Barrier -> `heroes/nature-guardian/nature-barrier.ogg`
- Nature Guardian — Forest Rebirth -> `heroes/nature-guardian/forest-rebirth.ogg`
- Storm Warrior — Lightning Punch -> `heroes/storm-warrior/lightning-punch.ogg`
- Storm Warrior — Static Field -> `heroes/storm-warrior/static-field.ogg`
- Storm Warrior — Thunder Charge -> `heroes/storm-warrior/thunder-charge.ogg`
- Storm Warrior — Storm Rage -> `heroes/storm-warrior/storm-rage.ogg`

These names are intended references. Verify the actual hero IDs and ability names in the project. Do not map by Q/W/E/R index alone if ability order differs.

Trigger skill-specific sound on the correct cast/launch/impact transition. Avoid playing a full ultimate sound repeatedly if the simulation emits multiple effect events. A sound clip that already contains a major impact should not be layered with an equally loud duplicate impact.

For Burning Zone, use `burning-zone-loop.ogg` with `loop=true` ONLY if the game really creates a persistent zone. Start it when the zone appears and stop/fade it when the zone ends. If the current ability is a one-shot instant AoE, use only `burning-zone-ignition.ogg`.

### Structures and ambience

- Tower projectile launch -> `structures/tower-shot.ogg`.
- Tower hit -> `structures/tower-impact.ogg`.
- Tower destroyed -> `structures/tower-destroy.ogg`, once.
- Core hit -> `structures/core-hit.ogg`, rate-limited.
- Core first crosses critical HP threshold -> `structures/core-critical.ogg`, once only.
- Core destroyed -> `structures/core-destroy.ogg`, once, high priority.
- Boss attack/death -> `structures/boss-attack.ogg` / `structures/boss-death.ogg`, only if the game actually has this boss.
- Match ambience -> low-volume `ambience/wind-loop.ogg`.
- Jungle/river ambience -> optionally `forest-loop.ogg` / `river-loop.ogg` when location-aware handling exists. Do not start duplicate instances each frame.

Fade loops in/out and stop or duck conflicting audio on pause, victory, defeat, or match restart.

## STEP 5 — BALANCE AND PREVENT SPAM

- Use the manifest recommended volumes as initial per-asset gains, then multiply by the existing audio bus volume.
- Limit concurrent instances for footsteps, creep attacks, hero-hit, repeated projectile impacts, and gold rewards.
- Prioritize player actions, nearby dangerous enemies, ultimates, tower destruction, and core destruction.
- Do not play audio from render(), requestAnimationFrame(), or a per-frame health-bar update.
- Emit/play one sound per meaningful gameplay event.
- Do not loop sounds that are actually one-shots.
- Keep stereo ambience non-positional; positional SFX use mono assets.
- Keep AudioContext resume behavior tied to the existing Play/Start user interaction.

## STEP 6 — VALIDATION

Run existing project scripts from package.json, including typecheck, tests, and production build if defined.

Check that every mapped OGG file exists. Verify these end-to-end cases in the running browser if available:

1. UI click and hero select.
2. Basic melee swing + impact.
3. Ranged launch + impact.
4. All 20 Q/W/E/R ability mappings.
5. Hero hit, death, and respawn.
6. Item purchase and level-up.
7. Tower shot and destruction.
8. Core damage, critical transition, and destruction.
9. Victory/defeat stingers.
10. Volume sliders, mute, pause/resume, and restart.
11. No duplicate sound on one event.
12. No missing-asset requests in DevTools Network.
13. Mobile touch skill buttons remain functional.

Do not claim physical mobile/browser listening tests were performed unless they were actually done.

At the end, report:
- Files copied and changed.
- Existing engine reused.
- Event-to-file mapping summary.
- Assets that are intentionally unused because the matching gameplay feature is absent.
- Typecheck/test/build output.
- Any playback checks that remain manual.

DO NOT stop after copying files or creating a manifest. Connect the sound files to the running game and test the actual gameplay events.
