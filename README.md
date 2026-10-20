# Moba DOTA

Original 5v5 fantasy MOBA prototype: Three.js + TypeScript + Vite. Effects and terrain are procedural, and so are the characters by default; an optional five-hero GLB pack ships in `public/assets/characters/v3/` (see Character pack V3 below).

    npm install
    npm run dev        # dev server
    npm run build      # tsc --noEmit + production build (dist/)
    npm run typecheck  # tsc --noEmit
    npm test           # simulation, character system, GLB pipeline, VFX pools + Director, camera maths, the world (ground, scatter, painter, river, structures, plants), quality governor, post-processing chain, audio engine + combat mix + world audio + polish/regression + sound-pack accounting (stubbed WebAudio), UI/3D scene (jsdom, stubbed WebGL)

## Structure
- `src/game/`  config (map, heroes, items), `state.ts` (shared state + hooks), `sim/` (units, combat, ai, world): pure simulation, no DOM/Three.js
- `src/render/` Three.js only: scene and lighting (`scene.ts`, `lighting.ts`), the world (`environment.ts` + `env/`, below), `ground.ts` (render-only standing height, bridge decks), the character system (below), `readability.ts` (rim light, contact shadows), `models.ts` (siege engines, health bars), the effects system (`vfx.ts` + `fx/`, below), post-processing (`post.ts`), the quality governor (`governor.ts` pure, `quality.ts` applies it), the camera (`camrig.ts` maths + `camera.ts`, below), input, hero-select stage (`stage.ts`), `units.ts` (mirrors the simulation into render objects)
- `src/assets/` AssetManager: GLB preload, cache, SkeletonUtils cloning, Draco
- `src/audio/` Web Audio only (below): `AudioManager.ts` (context, five buses, voices, asset cache), `synth.ts` (the built-in sounds), `pack.ts` (the shipped sound pack: definition → file + manifest gain), `combat.ts` (simulation events into the combat mix), `audio.ts` (the facade the game and UI import)
- `src/ui/` React only: `store.ts` (external store + `useUi`), `hudData.ts` (HUD snapshot ~10x/s), `commands.ts` (buy, sell, pause, settings), `screens/` (MainMenu, Hud, Shop, Overlays), `minimap.ts` (canvas drawn imperatively)
- `src/flow.ts` boot / play / menu flow and the per-frame entry point, `src/main.ts` browser loop. Open the page with `?debug` to get `window.__realm` for fast-forwarding.

The split follows the brief: Three.js owns world, units, animation, combat, effects and camera; React owns menus, HUD, shop, scoreboard and settings. The game never re-renders React per frame: it publishes a snapshot about 10 times per second, and damage numbers are pooled DOM nodes in `#ftl`.

## Controls
Arrow keys or right click: move. Left click: attack/select. Q W E R: abilities (R unlocks at level 3). B: shop. Tab: scoreboard. M: minimap size. Esc: pause. Camera: wheel zoom, middle-mouse drag rotate, `[` / `]` turn by 45 degrees, Home resets the angle, Space re-centers on the hero, screen edge scrolls.

## Character rendering and animation
The simulation never knows that animation exists: `CharacterVisual` only reads unit fields (position, facing, hp, `cd`, `acd`, `st`, `dead`) and recognizes events from changes between frames (cooldown jump = attack / cast, hp drop = hit, dead -> alive = respawn).

    units.ts  sync()                      one CharacterVisual per character unit, called every frame
      character.ts  CharacterVisual       root / facing / shake / rig + world-space trails + ring; sensing, hit reactions, stun stars
        animation.ts  CharacterAnimationController   one AnimationMixer, one action per state, interruption-safe cross-fades
        animation.ts  AnimationStateMachine          pure logic (no three.js): priorities, hysteresis, cooldowns
        rigs.ts / heroes.ts               procedural skinned rigs (fallback when there is no GLB) and the five hero + four creep designs
        trail.ts  WeaponTrail             fading additive ribbon between two blade points, in world space
        selection.ts  SelectionRing       team ring always on (normal blending, so a team keeps its colour on grass and on water); rotating additive halo for the player's hero (green) and the enemy being attacked (red)
        readability.ts                    team-coloured rim light (shader patch) and soft contact shadows under every character

- States: `IDLE WALK RUN ATTACK ATTACK_2 HIT CAST CHANNEL STUN DEATH RESPAWN VICTORY`. Priority: death > victory > stun > respawn > cast > attack > hit > channel > locomotion. A hit never interrupts a swing or a spell, has a 0.55 s cooldown, and one-shots hand control back at 85% of their clip so the cross-fade covers the tail.
- Locomotion follows the measured velocity (smoothed, teleports and dashes ignored): idle -> walk above 10% of the unit's speed, walk -> run above 72%, run -> walk below 58%, with a 0.12 s hold so it never flickers. Walk and run playback speed scales with velocity and the two gaits share a phase when switching.
- Cross-fades are driven by the controller (per-action blend weights normalized to 1) because three r128's `AnimationAction.crossFadeTo` restarts from weight 0 when a fade is interrupted. API: `playIdle / playWalk / playRun / playAttack(alt) / playCast / playChannel / playHit / playStun / playDeath / playRespawn / playVictory`, `crossFadeTo(state, seconds)`, `update(dt, input?)`.
- Procedural characters are two skinned meshes (lit + unlit glow) on one skeleton of 11 bones, so they use the same AnimationMixer path as a GLB. Clips are authored as pose keyframes in `animation.ts` for six styles (`blade`, `smash`, `dual`, `staff`, `robe`, `beast`); attack impact is keyed at 0.22 s and the spell release at 0.25 s to line up with the simulation's delayed damage.
- To add or change a hero: edit its builder in `heroes.ts` (weapons are authored in forearm space: origin at the elbow, hand at (0, -0.35, 0), +Z along the bent forearm), set its `RigDef.height` to the silhouette height (a test checks it against the real geometry) and its in-game height in `MODEL_HEIGHT`.
- `ground.ts` lifts characters onto the bridge decks (render only; the simulation's `H()` is untouched).
- **Bridge rotations**: Each bridge has its rotation set to match the crossing lane direction:
- **Bridge 0 (LEFT)** at (400, 400): rotation Y = 0 (faces South, lane goes N-S)
- **Bridge 1 (MIDDLE)** at (1600, 1600): rotation Y = -π/4 (faces SE, lane goes SE)
- **Bridge 2 (RIGHT)** at (2800, 2800): rotation Y = -π/2 (faces East, lane goes E-W)

These per-bridge rotations ensure the bridge long sides align with the intended road crossings across the river. The `groundY()` function in `src/render/ground.ts` uses inverse rotation to transform world coordinates into bridge-local coordinates for deck occupancy detection.

- **Bridge positions**: The LEFT bridge was repositioned to align with the left road crossing, the RIGHT bridge was repositioned to align with the right road crossing. The MIDDLE bridge remains unchanged.

- Visual check without a GPU: the repo's tests run on a stubbed renderer; for screenshots use headless Chromium with SwiftShader and open the page with `?debug`.

### Character pack V3 (opt-in)
`public/assets/characters/v3/` holds the supplied five-hero pack (copied from `doc/realm_siege_3d_character_pack_v3/`): glTF 2.0 skins with a shared 18-bone humanoid rig, inverse bind matrices and eight clips (Idle, Walk, Run, Attack, Cast, Hit, Death, Victory). It is never part of the default preload, so a fresh install still downloads no character art.

```
AssetManager   MODEL_FILES (default)         preload()      boot: heroes, creeps, monsters
               MODEL_FILES_V3 (opt-in)       loadV3 / preloadV3 / instantiateV3
characterPack  heroModelSource(key, height)  the active pack's source for one hero, or undefined
mapClips       animation.ts                  clip names -> the game's states, with per-state fallbacks
```

- **Opt-in.** Main menu -> `Hero models`: `Procedural (default)` or `Character Pack V3 (experimental)`, persisted as `rs_pack`. Choosing V3 fetches the five files lazily (Play is disabled while they load) and re-applies at the next boot before the menu opens. "Reset saved settings" returns to procedural.
- **Never all-or-nothing.** A missing, slow or invalid file resolves to null, so only the heroes it belongs to keep their procedural rig; if none of the five load the menu reverts to procedural and says so (`n missing - procedural fallback`).
- **Stage and match.** The hero-select pedestal and both teams' heroes use the chosen pack; creeps, towers, monsters, effects and gameplay are untouched.
- **Art-direction fixes in `instantiateV3`.** The pack faces `-Z` and the game expects `+Z`, so the clone is yawed 180 degrees. Height is fitted to the hero's `MODEL_HEIGHT`, and grounding uses the `LeftFoot` / `RightFoot` bones instead of the bind-pose box, because capes and robes reach below the feet.
- **Clip states.** The eight names map directly; `Attack` also serves `attack2`, while Stun, Channel and Respawn fall back to Hit, Cast and Idle, so a state is never missing.
- **What the tests verify** (`tests/character-pack-v3.test.ts`). The files parse as glTF 2.0 skins with the shared rig, every clip targets real bones and has its real duration, V3 stays out of the default preload and is fetched only after opt-in, cloning is skeleton-safe, and missing files degrade per hero. Rig quality is measured, not assumed: Root is the dominant joint for under 5 % of vertices (the skins are painted onto the body bones), and every one of the 40 clips moves more than 40 % of the vertices by at least 3 cm.
- **Content limits of the shipped pack.** Each clip keys only 2-6 bones, and across the whole set the pack never animates the knees, feet, hands or neck. Locomotion therefore reads stiffer than the procedural rigs, which animate eleven bones; the skins, however, are complete, so re-authoring the clips alone would fix it. `KHR_materials_emissive_strength` is ignored by three r128, so emissive trim renders at base intensity. `manifest.json` lists a 1.15 s Cast for every hero, while Shadow Huntress (1.10 s) and Ember Mage (1.20 s) differ; the UI and tests use the real clip durations.

## Visual effects
The simulation knows nothing about effects: it calls `hooks.fx(x, y, r, l, c)` (a ring or flash) and `hooks.ft(x, y, text, color)` (a floating number) and sets cooldowns. `fx/director.ts` turns that into effects by READING the simulation state; it never writes to it. `vfx.ts` is the one facade the rest of the renderer imports (`fx`, `ft`, `fxu`, `fxMenu`, `fxAim`, `fxRespawn`, `fxStructure`, `fxPing`, `resetFx`, `fxStats`).

    vfx.ts                          facade: hooks, per-frame step, reset, counters, `fxDebug`
      fx/director.ts                recognises hooks.fx calls by signature; senses casts from cooldown jumps (telegraph circle, then the effect at the
                                    moment the simulation applies it); gives projectiles a look; runs buff auras and damaged-structure smoke / fire / arcs
      fx/abilities.ts               the 20 ability looks (5 heroes x 4): wind-up + resolve recipes. fx/projectiles.ts: bolts and arrows in flight
      fx/recipes.ts                 shared building blocks: shockwave, explosion, light column, lightning, hit spark, minion / hero / boss death,
                                    respawn, level up, tower and core destruction, structure damage
      fx/kit.ts                     what recipes get: emitters + pooled meshes + timeline + camera sink + the one scene light, in world units
      fx/emitters.ts particles.ts atlas.ts   particle vocabulary (spark, fire, ember, mote, glyph, smoke, dust, chunk, flash, composites), the two layers, a procedural sprite atlas
      fx/mesh.ts shaders.ts         pooled mesh effects (terrain-draped decals, rings, light pillars, domes, lightning ribbons, glow flashes, spikes, rocks) and their GLSL
      fx/stage.ts                   hero-select pedestal: rune circle, summon burst, a theme per hero, one effect per show-off move
      trail.ts                      weapon trail ribbons (pooled)

**How `hooks.fx` is read.** The simulation's calls are recognised by (radius in logic units, duration, colour); anything else plays a plain shockwave and counts in `director.stats.unknown` (a test asserts it stays 0 against the real simulation, for all 20 abilities).

| r | l (s) | colour | meaning | played |
|---|---|---|---|---|
| 12 | .25 | white | hit | sparks sized by the damage just dealt (the `hooks.ft` number), at most 16 per frame |
| 40 | .3 | hero | cast ring (the cast is sensed from `acd`) or the impact of a hero bolt | bolt impact |
| 30 | .5 | green | one ally healed | heal motes; the first one of a heal cast also plays the caster's area effect |
| ability radius | .5 | hero | blast of an aoe / tgt / dash ability (170 + boss colour: boss slam) | matched to the pending cast (type, colour, radius, nearest centre), plays its resolve recipe |
| 70 | .6 | hero | buff takes hold | the buff recipe |
| 50 | .6 | gold | jungle camp buff | |
| 3 x unit radius | .6 | team | a unit died | by what died: hero, creep, siege, neutral, boss, core (a tower waits for the next row) |
| 60 | .8 | gold | level up | |
| 160 | .9 | orange | tower destroyed | explosion, scorch mark, staggered fires, camera shake + kick |
| 260 | 1 | red | boss enrage | |

If you change a radius, duration or colour in the simulation, update `onFx`; the Director test names the ability or call that went unrecognised.

**Budget and pooling.** Playing an effect never creates a mesh, geometry or texture (the one exception: the first spike or rock of a colour caches one standard material for that colour, so the number is bounded by the colours the recipes use).
- Particles: two layers (additive 2600, alpha 900), one draw call each, flat typed arrays with swap-remove. A full layer drops new particles (counted in `dropped`) instead of growing.
- Mesh effects: pools filled on demand and never destroyed. Caps: decals 18, rings 20, pillars 10, domes 8, bolts 22, flashes 18, spikes 56, rocks 12 (164 objects at most); weapon trails 24. Geometry, textures and shader programs are shared by every slot of a kind (a decal owns only its height array), so a spawn is a few uniform writes. A full pool refuses the spawn (`deniedBy`), important effects take over the oldest slot.
- Quality: `kit.q` scales particle counts with the frame rate (full above 50 fps, 40% at 26 fps) and effects far from the camera focus are thinned or skipped.
- One shared scene light (`fl`) serves every flash, because the renderer keeps a constant light count: the brightest request of a frame wins, capped at 2.4.
- Everything runs on one effect clock: it pauses with the game and keeps going after the match ends so the core's finale is seen.

**Blending and bloom.** Ground layers (decals, rings, pillars, domes) blend "screen" (`src * (1 - dst) + dst`; `emit()` in `shaders.ts` premultiplies the colour): on dark ground it equals additive, on lit ground it adds less. The frame is 8 bit and bloom keys on luminance, so stacking a few additive glow layers over lit terrain used to clip to a white disc that bloom then spread over the whole spell. Scorch marks use plain alpha blending. Both are states of the same material and program (uniform `uSoft`), so switching never recompiles.

**Debug.** With `?debug`, `__realm.fx` is `{ kit, director, mesh, add, alp, rig, trails, stats(), quality(q) }`: `stats()` gives alive / peak / denied per pool and the Director counters (casts, resolved, cancelled, hits, deaths, unknown); `quality(1)` pins full detail for screenshots. To add an ability look: write its recipe in `abilities.ts` (keyed by hero name and slot), its colours in `style.ts`.

## Sound
The audio subsystem mirrors the effects one: `src/audio/audio.ts` is the one facade the rest of the game imports, `AudioManager.ts` owns the Web Audio graph, `synth.ts` holds the built-in sounds and `pack.ts` (phase 6) attaches the shipped original sound pack — a decoded file always wins over its synthesized fallback.

    audio.ts          facade: initAudio (gesture unlock, tab suspend, pagehide stop, delegated UI click + hover), playSFX / playUI / playMusic / playAmbient, setVolume / setMuted / stopAll / resetAudio, setListener / setDuck, audioPrefs / audioStats
      AudioManager.ts the engine: one AudioContext, five gain buses (master -> sfx / music / ambient / ui) behind a fixed protection chain (30 Hz high-pass -> high-shelf -> soft limiter), voice registry with a cap (priority plays and the ui bus are exempt), spatial voices (pan + falloff per world point), pause duck, asset cache with `load` / `preload`, localStorage-backed volumes, never throws
      synth.ts        the built-in sounds, synthesized with oscillators and one shared noise buffer (the fallback layer)
      pack.ts         the shipped sound pack: 75 local Ogg files mapped (80 on disk, 5 documented unused), definition -> file + manifest volume (phases 6 + 8, below)
      combat.ts       the combat mix: simulation events -> voice, distance, budget (below)
      abilities.ts    the phase-3 ability vocabulary: `ab` -> hero voice, plus combined-clip suppression (phase 6)
      music.ts        the phase-4 soundtrack: one bed per scene, one stinger per match end
      ambience.ts     the phase-4 environment: fixed world emitters + the distant-battle rumble
      footsteps.ts    the phase-4 gait: real movement -> surface-aware steps (player first)
      world.ts        the phase-4 world tick: listener, scene, ambience, pause duck, reward watch (called from `flow.frame`)

- **Buses and volumes.** `master` feeds the speakers; `sfx` / `music` / `ambient` / `ui` feed `master` and each has its own volume (menu -> Settings -> the volume sliders, or mute). Volumes persist as `rs_vol*` / `rs_mute`; "Reset saved settings" clears them.
- **Autoplay.** The context is created and resumed on the first pointer or key gesture; a hidden tab suspends it and `pagehide` stops every voice. Before a gesture nothing is built and `play()` reports false. No node is created for a click on a silent bus, inside a sound's `minGap` or beyond the voice cap.
- **Sources.** Every voice plays a shipped pack file when one is mapped and loaded, and its synthesized fallback otherwise: `pack.ts` attaches the URL to the matching `SOUNDS` entry, `preload()` tries every file at boot (base-aware through `import.meta.env.BASE_URL`, so non-root deploys still resolve), and `load()` never rejects — a missing or undecodable file simply keeps the synth, so the game is never silent because an asset did not ship. Files play at the pack manifest's `recommendedVolume` (the def's `fileGain`); the synth keeps its own mix level. No node is built for a sound that cannot be heard.
- **Triggers so far.** `uiClick`: any button, form control or hero card (one delegated listener in `initAudio`, nothing per component). `matchStart`: `play()` in `flow.ts` starts a match (and stops whatever the previous one left sounding).
- **Combat.** The simulation never imports audio, exactly like effects: it pushes one typed, read-only event through a no-op `hooks.snd` at each real moment — a melee windup (`swing`), a projectile, bolt or tower shot leaving the weapon (`launch`), damage actually landing (`hit`, inside `hurt` and `blast`), a death (`die`) and a respawn (`respawn`). Phase 3 adds `cast` (a committed ability cast, carrying `ab = hero * 4 + slot` and the owner's `uid`) and `heal` (one per ally that really gained health). Hit events also carry the attacker's unit kind (`src`) and whether the player's own hero was the one damaged (`victim`), so the mix picks heavy vs light impacts and adds the personal `heroHit` layer; nothing is ever triggered from the render loop.

| simulation event | sound | when |
|---|---|---|
| melee windup | `swing` / `swingHeavy` | at `atk`, melee reach: light for creeps and neutrals, heavy for hero swings (the weapon moves even when the blow misses) |
| arrow release | `bowShot` | at `atk`, ranged creeps and the Huntress |
| siege or tower shot | `siegeShot` | a tower or siege engine fires |
| boss attack | `bossAttack` | the neutral jungle boss fires |
| magic release | `magicShot` | the core shoots (a hero's bolt uses its hero voice — see below) |
| arrow / heavy impact | `hitArrow` / `hitHeavy` | the projectile reaches the unit it was tracking |
| bolt / blast impact | `hitMagic` / `boomBlast` | a core bolt connects / a boss nova, however many victims (ability bolts and blasts use hero voices) |
| melee impact | `hitMelee` / `hitMeleeHeavy` | damage lands from a melee blow (heavy when the attacker is a hero) |
| structure / core damage | `hitStructure` / `hitCore` | `hurt` on a tower / on the core (core is global; `coreCritical` rings once when a core first crosses 35 % hp) |
| hero damage taken | `heroHit` | a hit lands on the player's own hero (throttled; skipped when an ability voice already carries the hit) |
| creep death | `dieCreep` | any minion or siege engine falls |
| hero death | `dieBig` | any hero falls |
| boss death | `bossDeath` | the neutral jungle boss falls |
| tower / core destruction | `collapseTower` / `coreCollapse` | forced and global; one event covers the structure falling |
| hero respawn | `respawn` | `hup`, when the respawn timer ends |
| move order | `moveCommand` | a ground click/tap (button 2 or a tap; never attack orders, debounced) |
| rejected action | `uiError` | not enough mana or gold, cooldown, nothing to target or sell |

- **The mix.** The listener is the player's hero: a cue fades with distance and goes silent past its range (short around a creep skirmish, global for structures and the cores), so nearby play always beats distant play. A rolling budget (five non-priority voices per 0.15 s of game time) spreads a swarm, while player events and structure losses are priority and force past it. Melee, arrow, magic, siege, structure and core events each own a distinct voice (hero blows use the heavy swing/impact pair, creep blows the light one), and every play takes a small random pitch and gain nudge so no two impacts sound stamped.
### Hero and ability sounds (phase 3)
`audio/abilities.ts` maps the same simulation events onto a per-hero vocabulary through the same one facade and the same mix layer — no second audio system. Ability identity travels on the event as `ab = hero index * 4 + slot` (`HR` order; slots are Q/W/E/R). Wind-ups exist for the abilities that need one (`null` cues stay deliberately silent rather than falling back to a generic sound), releases sit at the real +250 ms execution, and impacts live wherever the effect truly resolves.

| ability (`ab`) | type | event -> voice |
|---|---|---|
| Arcane Knight Q Arcane Strike (0:0) | bolt | cast `akStrikeCharge` · release `akStrike` · hit `akStrikeHit` |
| Arcane Knight W Shield Wall (0:1) | heal | cast `akShield` · per healed ally `healPulse` |
| Arcane Knight E Ground Slam (0:2) | aoe | cast `akSlamWind` · blast `akSlamImpact` (shockwave layered behind the hit) |
| Arcane Knight R Meteor Prison (0:3) | tgt | cast `akMeteorBuild` · blast `akMeteorImpact` (prison chime) |
| Shadow Huntress Q Shadow Dash (1:0) | dash | landing `shDash` (whoosh into a quick cut, one voice) |
| Shadow Huntress W Poison Arrow (1:1) | bolt | release `shPoison` · hit `shPoisonHit` |
| Shadow Huntress E Smoke Veil (1:2) | buff | cast `shVeil` |
| Shadow Huntress R Death Mark (1:3) | tgt | cast `shMark` (minor-second sting) · detonation `shMarkBurst` |
| Ember Mage Q Fire Bolt (2:0) | bolt | cast `emFireCharge` · release `emFireCast` · hit `emFireHit` |
| Ember Mage W Flame Wave (2:1) | aoe | blast `emWave` |
| Ember Mage E Burning Zone (2:2) | tgt | cast `emZone` (flint strike) · ignition `emZoneFire` (one-shot: the pool is instant, never a bed) |
| Ember Mage R Inferno Storm (2:3) | tgt | cast `emStormBuild` · blast `emStormImpact` (fire layers cascading) |
| Nature Guardian Q Healing Seed (3:0) | heal | cast `ngSeed` · per healed ally `healPulse` |
| Nature Guardian W Root Trap (3:1) | tgt | blast `ngRoot` (wood and soil) |
| Nature Guardian E Nature Barrier (3:2) | heal | cast `ngBarrier` · per healed ally `healPulse` |
| Nature Guardian R Forest Rebirth (3:3) | heal | cast `ngRebirthBuild` · one wave `ngRebirthPulse` (deduped across the cast) |
| Storm Warrior Q Lightning Punch (4:0) | bolt | release `swPunch` · hit `swPunchHit` |
| Storm Warrior W Static Field (4:1) | aoe | blast `swField` (three staggered zaps) |
| Storm Warrior E Thunder Charge (4:2) | dash | cast `swCharge` · landing `swChargeHit` |
| Storm Warrior R Storm Rage (4:3) | buff | activation `swRage` (three electrical accents layered inside) |

- **Impact honesty.** Cast sounds only exist when `cast()` commits (mana spent, cooldown started); blast and release voices play inside the deferred execution, bolt impacts inside `hurt`, heal confirmations only for allies whose health really increased. So a cast that fails (mana, cooldown, level), is cancelled by the caster dying during its 250 ms wind-up, a bolt that flies out its lifetime, a heal at full health and a blast landing on nobody all stay silent — no false impacts. Structures keep `hitStructure` / `hitCore` even when an ability dealt the damage.
- **No fake sustains.** Burning Zone is an instant AoE, so its ignition is a one-shot: the pack's `burning-zone-ignition.ogg` when loaded, a short synth burn tail in fallback — there is no zone loop to keep alive and no phantom bed. Nothing in the ability layer sustains any more; the only `loop` defs left are phase 4's music beds and ambience, which fade in/out with the scene.
- **Richer ultimates, readable basics.** Ultimates layer a build-up into a big impact (the Rebirth wave, the Rage accents); ordinary abilities stay one to three short cues. The phase-2 policy still rules: player events and ultimates are priority and force past the budget, everything else fades with distance and is throttled by the rolling budget plus each sound's `minGap` / `max`.
- **Replaceable assets.** Every voice above is an ordinary `SOUNDS` entry: the shipped pack attaches files through `pack.ts` and the synth stays as the fallback — no simulation or mapping code changes (phase 6, below).
- **Verified by** `tests/audio-abilities.test.ts`: all twenty Q/W/E/R abilities fired through the real cast path with their expected voice sets, cast/impact timing measured against the sim clock, failed/cancelled casts silent, heal-vs-damage separation (and confirmation only on real healing), the ignition as a one-shot with nothing left on restart, combined-clip suppression only once the file is really loaded, sfx volume gating, and a 100 s AI battle exercising the whole vocabulary.
- **Debug.** With `?debug`, `__realm.audio` is the AudioManager: after one click anywhere, `audio.snapshot()`, `audio.play('sfx', 'notify')`, `audio.setVolume('music', .5)`, `audio.stopAll()`.

### World audio: music, ambience, footsteps and controls (phase 4)
`audio/world.ts` is the world tick — `flow.frame()` calls it every frame. One place turns the game's coarse state into audio decisions: the listener follows the camera focus and yaw, the music scene comes from `app.mode` / `app.G.over`, the ambience runs exactly while a match is live, footsteps advance only from movement the simulation really produced, pause ducks the gameplay buses and the HUD snapshot feeds the reward voices. Everything is idempotent or transition-guarded, so running it at any frame rate is free.

- **Spatial audio without a second engine.** `PlayOptions.pos` places a voice in world coordinates: the engine pans it against the camera's right vector (`(cos cy, -sin cy)` — the same yaw the movement code uses) and, for defs with `ref`, attenuates it as `1/(1+(d/ref)^2)` on a per-voice gain node; `maxDist` culls a play before any node is built. The world tick pushes `setListener(x, y, yaw)` once per frame and live voices are re-placed whenever the listener moves — a river heard from the bank pans and fades as you walk. The `ui` bus is never spatialized, so controls stay centered.
- **Music.** One scene at a time, from the same state the UI renders: `musicMenu` in the menus (~8.7 s bed), `musicMatch` in a match (a thinner, darker bed that always sits under the combat mix), and one stinger each for victory and defeat, played on the transition only. Both beds are `loop` defs that fade out on their own and are restarted by `musicTick()`; a scene change or the `stopAll()` in `flow.play()` can never leave two beds sounding.
- **Ambience.** A fixed set of emitters (see `AMBIENCE` in `ambience.ts`): a non-positional wind bed everywhere, three river stretches along the `x = y` diagonal, one forest bed per camp and one magical bed per base. Each is a `ref` def with its own `maxDist`, so places that are out of earshot cost nothing; `ambienceOff()` stops and forgets them all on menu, match end and restart.
- **Footsteps from real movement.** There is no walk event, so `footsteps.ts` measures how far every mover actually travelled since the last frame and counts it against a stride: cadence follows real speed for free, standing still is silent, and dead, stunned or teleported units (`st > 0`, `dead`, or a jump larger than any dash) never plant a phantom step. `map.surfaceAt(x, y)` picks the surface — grass, or water inside the river band. The player's steps lead; AI and creep steps are a low-priority texture: within 430 units of the camera, three per half-second, always quieter.
- **Distant battle.** A heavy blast beyond 2000 units of the camera becomes one restrained `ambDistant` rumble (900 ms min-gap) instead of a full voice — the mix stays local without the far fight going mute.
- **Lifecycle.** Pausing ducks `sfx` / `music` / `ambient` to a quarter — the `ui` bus is untouched, so controls stay crisp — and never touches the stored volumes; resuming restores them. A finished match silences the ambience and the footsteps, takes the music bed down and plays the stinger once; `worldAudioReset()` (tests, teardown) does the same from any state. Temporary spatial emitters are deleted with their voices, not just muted.
- **Controls.** `uiSelect` on hero cards, delegated `uiHover` on hero cards and the menu's collapsible rows, `shopOpen` / `shopClose`, `shopBuy` / `shopSell`, `uiPause` / `uiResume`; level-up and gold rewards (`uiLevel` / `uiGold`) are *watched* from the HUD snapshot the world tick already reads — no new simulation event was added for any of them. `uiGold` fires only for a reward-sized gain in one snapshot (≥ 8 gold: the smallest creep bounty is 22, a tower 120, a hero kill 200+); the +2.3/s passive income only steps the floored number by a coin, so it never ticks.
- **The mix.** Music beds sit at .8 / .62 on the music bus and ambience at .4–.5 on the ambient bus, well under the combat gains near 1, so the atmosphere never masks an ability cue; every phase-4 voice is an ordinary `SOUNDS` entry — the pack backs the stingers and the wind bed with files, the rest synthesizes (no third-party recordings anywhere).
- **Verified by** `tests/audio-world.test.ts` (footsteps from real movement, speed, surface, death/stun/teleport; one bed per scene and exactly one again after a restart; the right stinger and full world teardown on match end; pan against the camera yaw, distance attenuation, `maxDist` culling and emitters tracking the listener; distant blasts; pause ducking with the UI bus untouched; reward watching plus silent adoption of a fresh match; manifest completeness) and the control wiring in `tests/ui.test.tsx`.
- **Debug.** With `?debug`, `__realm.audio.snapshot()` now reports `duck`, `listener` and the live voices; `audio.spatialVoices()` lists every positional voice with its pan and falloff gain, and `audio.attenuationAt(name, x, y)` shows the falloff at a world point.

### Polish, mix protection and regression (phase 5)
Phase 5 audited the whole subsystem instead of adding features; three real engine defects were found and fixed:

- **Master protection chain.** `master` now runs through a 30 Hz high-pass (rumble below hearing is removed before it can eat headroom), a gentle high-shelf (-2.5 dB over 9 kHz: stacked lightning and magical sizzle stays readable instead of turning shrill) and a soft limiter (-2 dBFS, ratio 12) before the speakers. The chain is rebuilt and torn down with the context, and a context without `createDynamicsCompressor` degrades to a straight wire. `tests/audio-polish.test.ts` asserts the real graph order: master -> high-pass -> high-shelf -> limiter -> destination.
- **The voice cap no longer swallows priority.** At 32 live voices, ordinary plays are dropped and counted — but `force` cues (player actions, ultimates, structure losses, the victory/defeat stingers) and the `ui` bus are exempt, so a saturated fight can never mute the feedback the player is acting on or a control click.
- **Loaded files clean up after themselves.** A file-based voice wires `onended` to the registry: a one-shot that finishes (or a stopped loop) leaves the voice *and* spatial registries instead of lingering as a phantom voice — the mechanism the shipped pack (phase 6) relies on for every mapped voice.

The audit also re-confirmed — and the polish suite pins — that every branch of the combat mapping and all twenty ability mappings names a voice that exists in the manifest, that a small blast beyond the camera becomes exactly one `ambDistant` rumble, that ducking scales the live graph without touching stored volumes or the `ui` bus, and that unknown sounds fail silently with the synth fallback intact. `tests/ui.test.tsx` adds the settings regression: the volume sliders and mute drive the real bus volumes and persist to `localStorage` (`rs_vol*` / `rs_mute`).

### The original sound pack (phase 6)
The original 62-file Ogg pack ships inside the build at `public/audio/realm-siege/` (copied from `doc/realm_siege_3d_sound_pack_v1/`), and `audio/pack.ts` is the single table that wires it: a definition name → file + the manifest's `recommendedVolume`. `synth.ts` applies the table to its definitions at load time, so the engine's existing rule — a decoded file wins, the synth is the fallback — replaces voices with zero gameplay or mapping changes. `load()` / `preload()` never reject: if a file is missing or undecodable the voice simply keeps synthesizing. *(This section records the phase-6 V1 state; phase 8 replaced 47 files and re-cut the mapping — see the phase 8 section below for the current table.)*

**What shipped where.** `doc/realm_siege_3d_sound_pack_v1/audio/` → `public/audio/realm-siege/` — all 62 files: `ui/` 14, `combat/` 16, `heroes/` 21 (four per hero, plus Ember Mage's deliberately unused zone loop), `structures/` 8, `ambience/` 3. Vite copies `public/` into the build, so the same files land in `dist/audio/realm-siege/`.

**The mapping (V1).** 60 definitions point at 57 shipped files — three are shared on purpose (`arrow-impact` backs both arrow ticks; `magic-impact` backs the generic magic tick plus the two ability hits the pack README assigns to it). Parentheses are the manifest's `recommendedVolume` (`fileGain`); every mapped definition keeps its synthesized fallback for the missing-file case.

| Definition | File (gain) |
|---|---|
| **UI** | |
| `uiClick` / `uiHover` / `uiSelect` | `ui/ui-click.ogg` (.35) / `ui/ui-hover.ogg` (.28) / `ui/hero-select.ogg` (.4) |
| `matchStart` / `uiPause` / `uiResume` | `ui/match-start.ogg` (.55) / `ui/pause.ogg` (.3) / `ui/resume.ogg` (.32) |
| `shopOpen` / `shopBuy` | `ui/shop-open.ogg` (.32) / `ui/item-purchase.ogg` (.38) |
| `uiLevel` / `uiGold` | `ui/level-up.ogg` (.45) / `ui/gold-reward.ogg` (.3) |
| `musicVictory` / `musicDefeat` | `ui/victory-stinger.ogg` (.62) / `ui/defeat-stinger.ogg` (.56) |
| `uiError` | `ui/ui-error.ogg` (.32) |
| **Combat** | |
| `swing` / `swingHeavy` | `combat/melee-swing-light.ogg` (.45) / `combat/melee-swing-heavy.ogg` (.58) |
| `hitMelee` / `hitMeleeHeavy` | `combat/melee-impact-light.ogg` (.5) / `combat/melee-impact-heavy.ogg` (.62) |
| `bowShot` / `hitArrow` | `combat/ranged-launch.ogg` (.4) / `combat/arrow-impact.ogg` (.46) |
| `shPoisonHit` | `combat/arrow-impact.ogg` (.46) — shared, as the pack README blesses |
| `magicShot` / `hitMagic` | `combat/magic-launch.ogg` (.42) / `combat/magic-impact.ogg` (.52) |
| `akStrikeHit` / `emFireHit` | `combat/magic-impact.ogg` (.52) — shared |
| `heroHit` | `combat/hero-hit.ogg` (.45) |
| `dieBig` / `respawn` | `combat/hero-death.ogg` (.48) / `combat/hero-respawn.ogg` (.42) |
| `moveCommand` | `combat/move-command.ogg` (.22) |
| `stepGrass` / `stepGrass2` / `stepGrass3` | `combat/footstep-grass-1.ogg` / `-2.ogg` / `-3.ogg` (.22 each) |
| **Hero abilities** | |
| `akStrike` / `akShield` | `heroes/arcane-knight/arcane-strike.ogg` (.52) / `arcane-shield.ogg` (.44) |
| `akSlamWind` / `akMeteorBuild` | `heroes/arcane-knight/ground-slam.ogg` (.66) / `meteor-prison.ogg` (.72) — combined clips |
| `shDash` / `shPoison` / `shVeil` / `shMark` | `heroes/shadow-huntress/shadow-dash.ogg` (.48) / `poison-arrow.ogg` (.46) / `smoke-veil.ogg` (.4) / `death-mark.ogg` (.62) |
| `emFireCast` / `emWave` / `emZoneFire` / `emStormBuild` | `heroes/ember-mage/fire-bolt.ogg` (.48) / `flame-wave.ogg` (.55) / `burning-zone-ignition.ogg` (.52) / `inferno-storm.ogg` (.72) |
| `ngSeed` / `ngRoot` / `ngBarrier` / `ngRebirthBuild` | `heroes/nature-guardian/healing-seed.ogg` (.42) / `root-trap.ogg` (.48) / `nature-barrier.ogg` (.42) / `forest-rebirth.ogg` (.62) |
| `swPunchHit` / `swField` / `swCharge` / `swRage` | `heroes/storm-warrior/lightning-punch.ogg` (.52) / `static-field.ogg` (.52) / `thunder-charge.ogg` (.64) / `storm-rage.ogg` (.62) |
| **Structures & boss** | |
| `siegeShot` / `hitHeavy` | `structures/tower-shot.ogg` (.45) / `tower-impact.ogg` (.54) |
| `collapseTower` | `structures/tower-destroy.ogg` (.72) |
| `hitCore` / `coreCritical` | `structures/core-hit.ogg` (.55) / `core-critical.ogg` (.42) |
| `coreCollapse` | `structures/core-destroy.ogg` (.82) |
| `bossAttack` / `bossDeath` | `structures/boss-attack.ogg` (.62) / `boss-death.ogg` (.7) |
| **Ambience** | |
| `ambWind` | `ambience/wind-loop.ogg` (.12) — stereo bed, kept non-positional |

- **One file, one real moment.** Every mapping keeps the game's event identity: the file plays on the exact cue its definition already sits on (cast wind-up, release, confirmed impact, death, structure loss) — never an extra moment, and never a loop for an event that is not sustained.
- **Combined clips suppress their fallback impact.** Five pack files contain an ability's wind-up *and* its impact (Ground Slam, Meteor Prison, Death Mark, Inferno Storm, Thunder Charge). `abilities.ts`'s `LINKED` table + `AudioManager.hasAsset()` silence the paired synth impact **only once the file is actually loaded** — one hit never plays two impacts; without files the fallback layers play exactly as before. One timing nuance to know: the Thunder Charge clip is 0.65 s while the charge resolves +0.25 s after the cast, so the landing plays while the clip is still running (a trim candidate if it ever reads late). The phase 7 audit then measured all five combined clips front-loaded — 15–26 dB down at the game's +250 ms release — and the V2 plan replaces the trim idea with a wind-up/impact split for each (below).
- **Heavy/light split, boss voices, threshold alarms.** Hero melee swings/impacts use the heavy pair (`swingHeavy` / `hitMeleeHeavy`), creeps the light one (the hit event's `src`); the jungle boss attacks and dies through `bossAttack` / `bossDeath`; each core rings `coreCritical` once when it first drops below 35 % hp (never per hit); the player's own damage adds the throttled `heroHit` layer (skipped when an ability voice already carries the hit); `moveCommand` confirms ground move orders (never attack orders, debounced) and `uiError` answers refused casts, attacks without a target and failed buys/sells.
- **No phantom loops.** `burning-zone-loop.ogg` is deliberately unused (Burning Zone is an instant AoE — the one-shot ignition plays instead) and the ability-loop machinery was removed; the only `loop` defs left are phase 4's music beds and ambience.
- **Deliberately unused files (with reasons).** `ui-confirm.ogg` (no distinct successful-confirmation moment: confirmations already own `uiSelect` / `shopBuy` / `matchStart`), `combat/shield-impact.ogg` (the game has no shield or damage-absorb mechanic), `burning-zone-loop.ogg`, `ambience/forest-loop.ogg` and `ambience/river-loop.ogg` (stereo ambience loops; the game's forest/river emitters are positional single points, and the rule is stereo beds non-positional, mono SFX positional). All 57 mapped files back 60 definitions (`arrow-impact` and `magic-impact` are shared on purpose, as the pack README instructs); every file on disk is either mapped or listed in `PACK_UNUSED` with its reason.
- **Files touched (beyond the assets).** `src/audio/pack.ts` — new: the table, `PACK_UNUSED` and the base-aware `packUrl()`; `src/audio/synth.ts` — the ten new definitions (`swingHeavy`, `hitMeleeHeavy`, `heroHit`, `bossAttack`, `bossDeath`, `coreCritical`, `moveCommand`, `uiError`, `stepGrass2/3`), each with a synth fallback, plus the PACK application loop and the `emZoneFire` loop removal; `src/audio/AudioManager.ts` — `SoundDef.fileGain`, `hasAsset()`, buffer-first gain; `src/audio/abilities.ts` — `LINKED` suppression, ability-loop machinery removed; `src/audio/combat.ts` — the new cue branches (heavy/light melee via `src`, boss, throttled `heroHit`, once-per-core `coreCritical`); `src/audio/footsteps.ts` + `src/audio/world.ts` — take pick among the three grass takes (V2 later replaces the pick with a rotation and the set with four grass / three water takes — see phase 8); `src/audio/audio.ts` — hover tick skipped for touch pointers; `src/game/sim/combat.ts` — `src` / `victim` on hit events, the `'boss'` launch kind, `cast()` returns success; `src/game/state.ts` — `SndEv.src` / `SndEv.victim`; `src/render/input.ts` — `uiError` on refused casts and attacks without a target, `moveCommand` on ground move orders; `src/ui/commands.ts` — `uiError` on failed buy/sell; the suites — combat/abilities/world/polish updated, `tests/audio-pack.test.ts` new.
- **Verified by** `tests/audio-pack.test.ts` (every mapped definition carries the file URL, exactly one file and the manifest gain; every mapped file exists on disk; all 62 files accounted for — 57 mapped, 5 unused with reasons; unmapped definitions stay file-free) plus the pack-aware branches in the combat, abilities, world and polish suites — `npm run typecheck` clean, `npm test` 473 tests across 18 files (was 468/17), `npm run build` passing with the 62 files present in `dist/`. Browser playback, the DevTools network pass and mobile touch checks remain manual: `npm run dev`, then listen.

### Sound pack V2 audit: findings and replacement plan (phase 7)
Phase 7 audits the shipped pack instead of adding to it: **no game file, engine behaviour or audio asset was changed**, and the V2 plan below is deliberately *not implemented yet*. The pass is measurable-only — every finding is a signal measurement (peak, RMS, crest, clipping, silence, 8-band spectrum, centroid, transient timing, loop seams, stereo width, duplicates, similarity), cross-checked against the manifest and the game's real cue timing (melee +220 ms, ability release +250 ms). "Does it actually sound right" is a separate, explicit listening pass: the audition page exports the ear-check decisions before any authoring starts.

- **Deliverables (new, docs only).** `doc/sound_pack_v2_audit/`: `AUDIT_REPORT.md` (full per-file findings + the plan), `index.html` (audition page — the seven review categories, players, metric bars, verdict controls, "play group", export), `metrics.json` + `analysis_table.txt` (all 62 files measured), `analyze.py` / `timing.py` / `build_page.py` (re-runnable: decode → measure → page).
- **Headline measurements.** All five combined cast+impact clips are front-loaded (15–26 dB down at the game's +250 ms hit, so their impact can never align with the resolved hit); 15 of 62 files put > 45 % of energy below 120 Hz (84 % of `hero-hit` is below 60 Hz — small speakers cannot hear it); `magic-impact` backs three unrelated events and `arrow-impact` two; the three grass takes are near-copies (0.988–0.997 similarity) with > 3 dB level jumps; `healing-seed` is 0.993-similar to `ui/hero-select`; `wind-loop`'s seam is only 29 dB below peak (tick risk); `forest-loop` peaks at 0.0 dBFS with the pack's only 2 clipped samples. Technically the pack is otherwise clean: zero exact duplicates, no DC issues, leading silence ≈ 0 everywhere. Four durations drifted 11–22 ms from the manifest.
- **Verdicts.** KEEP 27 · REMIX 20 · REPLACE 5 · SPLIT 7 · UNUSED 3.
- **The V2 plan (awaiting execution).** 20 in-place remixes (same filenames, no code change: the thin/harsh swings and launches, the sub-heavy impacts and ignitions, the colliding swell/chime families, `core-hit` and `level-up`, the `wind-loop` seam) plus the grass set replaced by four level-matched takes; 13 new files: the five combined clips split into `-windup` + `-impact`/`-burst` pairs — the impact defs (`akSlamImpact`, `akMeteorImpact`, `shMarkBurst`, `emStormImpact`, `swChargeHit`) already fire on the resolved hit, so the five `LINKED` suppressions are simply removed (audio-layer config, no engine or simulation change) — and per-identity impacts `arrow-impact-poison.ogg` (`shPoisonHit`), `magic-impact-arcane.ogg` (`akStrikeHit`), `magic-impact-fire.ogg` (`emFireHit`); 5 new assets for the gaps the pack never covered: `footstep-water-1/2/3.ogg` (the `water` surface had only a synth) and mono emitter loops `forest-emitter.ogg` / `river-emitter.ogg` for the positional `ambForest` / `ambRiver` emitters; explicit acceptance targets (peak ≤ −1 dBFS, zero clipped samples, RMS/crest targets, band-signature rule, loop seam ≤ −45 dB) and the code touch list (`pack.ts`, `abilities.ts`, `footsteps.ts`, `synth.ts`, `world.ts`, the pack accounting test and this README) are in the report.
- **Status.** Audit complete; the plan is **implemented** — see the phase 8 section below. The audition page stays available for comparing the V1 reference (`doc/sound_pack_v2_audit/index.html`).

### Sound pack V2 — replacement executed (phase 8)
Phase 8 executes the phase-7 plan against the audit's measurable deck. Every V2 file is original procedural synthesis — no third-party audio, no ripped material — rendered by `doc/realm_siege_3d_sound_pack_v2/tools/design.py`; the architecture is untouched: one `AudioManager`, the same ten `src/audio/*` modules, the same public API, the same synth fallback when a file is missing. In full:

**Assets & accounting — 62 V1 files → 80 shipped (75 mapped + 5 unused): 23 new, 24 re-rendered in place, 5 deleted, 33 kept bit-exact.**

- *New (23).* The five split pairs (`ground-slam-windup` / `ground-slam-impact`, `meteor-prison-windup` / `meteor-prison-impact`, `death-mark-windup` / `death-mark-burst`, `inferno-storm-windup` / `inferno-storm-burst`, `thunder-charge-rush` / `thunder-charge-impact`); the three per-identity impacts (`arrow-impact-poison` → `shPoisonHit`, `magic-impact-arcane` → `akStrikeHit`, `magic-impact-fire` → `emFireHit`); the variation takes (`melee-swing-light-2/3`, `melee-impact-light-2/3`, `footstep-grass-4`, `footstep-water-1/2/3`); and the mono positional emitters `forest-emitter` / `river-emitter`.
- *Re-rendered in place (24).* The audit's 20 remixes (`melee-swing-light`, `melee-impact-light`, `melee-impact-heavy`, `ranged-launch`, `magic-launch`, `hero-hit`, `arcane-strike`, `arcane-shield`, `smoke-veil`, `fire-bolt`, `burning-zone-ignition`, `healing-seed`, `nature-barrier`, `lightning-punch`, `static-field`, `tower-impact`, `core-hit`, `boss-attack`, `level-up`, `wind-loop`) plus `magic-impact` (remixed to the neutral tick the identity files flank) and the three grass takes `footstep-grass-1/2/3`, re-cut as one matched family with the new `-4`.
- *Deleted (5).* The combined clips `ground-slam`, `meteor-prison`, `death-mark`, `inferno-storm` and `thunder-charge` — their material now ships split (`encode.py` removes them itself).
- *Kept bit-exact (33).* The 28 still-mapped files the audit kept, plus the 5 documented unused files — each still shipping with its reason recorded in `pack.ts`, the pack README and `manifest.json`.

**Mapping, gains and variation.**

- **One file per definition** — no shared files in V2 (V1 shared `arrow-impact` and `magic-impact` across five definitions). The split impacts (`akSlamImpact`, `akMeteorImpact`, `shMarkBurst`, `emStormImpact`, `swChargeHit`) already fire on the resolved hit, so the five `LINKED` suppressions were simply removed: `abilities.ts`'s `LINKED` is now `{}`, the mechanism and `hasAsset()` stay for any future combined clip, and the ability suite pins one cast → one impact.
- **Gains.** `swField` .52 → .62 and `hitCore` .55 → .46 (the two audit-named rebalances); the beds' gains (`.5 / .45 / .5`) restore the V1 ambient mix from the new −22 dB bed file level. Everything else keeps the V1 `recommendedVolume` exactly — the five split wind-ups inherit the old combined-clip gains (.66 / .72 / .62 / .72 / .64), the split impacts carry their own (.65 / .75 / .8 / .65 / .8), and the new takes/steps use the standard role gains (.45 / .5 / .22).
- **Variation.** The light melee voices rotate through their takes (`swing`→`2`→`3`, `hitMelee`→`2`→`3`) and footsteps rotate through four grass / three water takes — a rotation, deliberately not a random draw, so consecutive takes always differ and the audio layer adds no new `Math.random()` draw (the simulation's `rnd()` shares that global stream); the pre-existing per-cue pitch/gain jitter stays on top.

**Code and tests (audio layer only — no engine, simulation or gameplay change).**

- `src/audio/pack.ts` — the V2 table (75 entries), updated `PACK_UNUSED` with reasons, the split and take definitions; `src/audio/abilities.ts` — `LINKED` emptied, comments updated to the split reality.
- `src/audio/combat.ts` — the swing/hit take rotation; `src/audio/footsteps.ts` — four grass / three water takes behind the surface check, rotating too.
- `src/audio/synth.ts` — synth fallbacks for every new cue (`swing2/3`, `hitMelee2/3`, `stepGrass4`, `stepWater/2/3`, `akSlamImpact`, `akMeteorImpact`, `shMarkBurst`, `emStormImpact`, `swChargeHit`); `src/audio/world.ts` — `WORLD_SOUNDS` preloads all seven step voices.
- The five audio suites: `tests/audio-pack.test.ts` (new accounting/mapping suite) plus `audio-abilities`, `audio-combat`, `audio-polish` and `audio-world` updated for the new files, the take rotations and the split behaviour. `AudioManager.ts`, the public API and everything outside `src/audio/` are untouched.

- **Tools and records (new).** `doc/realm_siege_3d_sound_pack_v2/`: `README.md` (mapping table, level policy, export settings, re-render steps, wind-up rule and limitations), `PROVENANCE.md` (authorship, license, chain of custody), `manifest.json` (per file: voice, gain, role, duration, decoded levels, SHA-256), `preview.html` (all 80 files, unused marked), `masters/` (float32 WAVs) and `tools/` (`design.py` renders the masters → `encode.py` encodes libvorbis q7 → `manifest.py` / `preview.py` regenerate the records → `validate.py` is the decoded-OGG acceptance gate; `measure.py` carries the audit-identical measurement).
- **Why q7, not q5.** q5 was measured to inject decode overshoot past the −1 dBFS gate on two transient files and a −30 dB decoded seam on the forest emitter; q7 clears both with margin (worst decoded peak −1.60 dBFS; seams −58.8 / −85.9 / −60.3 dB).
- **Verified.** `tools/validate.py` **PASS** on the shipped bytes: 47/47 V2 files pass the §5E deck, take-set similarity ≤ 0.69 (gate < 0.9) and level spread ≤ 0.32 dB (gate ±1), inventory and `manifest.json` coherent; `npm run typecheck` clean; `npm test` 473 tests across 18 files; `npm run build` ships the 80 files into `dist/audio/realm-siege/`.

## Camera
An isometric MOBA camera, not a third-person one: a fixed pitch (0.95 rad), a focus on the ground, a yaw and a distance. `camrig.ts` is the maths (no scene objects, unit-tested); `camera.ts` applies it to the Three camera and exposes the inputs. `app.cam` (`cy`, `cd`, `k`) stays the public state: the simulation reads `cy` for movement, the minimap and culling read `k` and `cd`; the rig adopts what other modules write (a match start) and publishes its smoothed values every frame.

- Follow: critically damped (SmoothDamp, 0.16 s) toward the hero plus the edge-scroll offset, capped at 4200 units per second, the same at any frame rate.
- Zoom: wheel, multiplicative so every notch feels the same, 25 to 110, glides (0.14 s). The "Camera zoom" setting is the starting distance (48 / zoom).
- Rotation: middle-drag (free) or `[` / `]` (45 degree steps onto the eight isometric directions), by the short way round (0.13 s); Home goes back to the classic angle.
- Bounds: the focus keeps a margin to the map edge that shrinks as you zoom in (80 to 360 units).
- Terrain: the focus height follows the ground smoothly (five samples, 0.4 s) and the camera is lifted over hills, quickly up and slowly down.
- Impact feedback: effects call `camSink.shake(amount, x, z, roughness)` and `kick(...)`. Shake is a trauma model: it adds up with diminishing returns, drains at 1.5 per second and moves the picture by trauma squared (up to about 1 world unit per axis and 0.7 degrees of roll at the default distance, scaled with zoom). Impacts fade out with their distance from what is on screen (`impactAttenuation`). A kick pushes the camera in (at most 7%) and shoves it away from the blast on damped springs.
- Aiming never wobbles: shake and kicks move only what is drawn; picking (`wpt`) uses a second, un-shaken pose.
- Finale: when a core falls the camera drifts to it and moves in to 40 over 1.4 s, ignoring the wheel meanwhile.
- Accessibility: `prefers-reduced-motion` scales shake and kicks to 25%.

## The world: terrain, river, plants, structures
`environment.ts` builds the world once behind the loading screen (`buildEnvironment`, nine steps with progress) and then only animates it. Nothing in it touches the simulation: it reads the camera and the clock, and `terrainY` / `groundY` stay the single source for where a character stands.

    env/height.ts layout.ts rand.ts   the shape of the ground, where things stand, seeded noise (pure: shared with the tests)
    env/splat.ts                      paints the ground texture (1024 x 1024): meadow, jungle floor, dirt lanes with ragged edges, shore and river bed,
                                      paved plazas and tower pads, shrines, the boss arena. Alpha is a rune-glow mask; contact shadows of trees,
                                      rocks and buildings are baked in. Pure function of its inputs, painted in slices while the loading bar moves
    env/terrain.ts                    the playfield (160 x 160 grid) and four strips of hills outside the map; one terrain shader (splat + detail
                                      texture, rune glow, haze)
    env/water.ts                      the river: a ribbon that follows the bed; the vertex depth drives shallows, foam at the banks, streaks and the
                                      sun glint. Only triangles that touch water are built
    env/scatter.ts geometry.ts        where plants stand (seeded), their shapes (12 vertex-coloured species), the instanced chunks, wind in the vertex shader
      plants.ts materials.ts
    env/structures.ts                 towers, cores, three bridges, base pylons with banners, braziers, shrines, the spring
    env/atmosphere.ts                 sky dome, haze range that follows the zoom, fireflies (one `Points` object animated in the vertex shader)
    env/palette.ts shared.ts          the mood in one place (`ATMO`, `MAGIC`) and the uniforms all environment materials share (clock, wind, haze, rune glow)

- **Tall things are solid.** Trees and boulders stand only on the simulation's 80 obstacle circles (`OB`), so what looks solid is solid (heroes and creeps walk anywhere else). Everywhere else only low growth fills the free ground (grass, ferns, flowers, bushes, mushrooms): never on lanes, plazas, tower pads, camp clearings, the arena, the shrines, the spring or the river shore. The obstacle circles in the river are boulders. Outside the map a forest covers a ring of hills, and the river goes on as a valley, so the world never ends in a void. `tests/env.test.ts` pins these rules.
- **The river is one channel.** The simulation's `H()` only dips along the river, which broke the water into ponds wherever the hills were high; the renderer's `terrainY` carves a continuous channel (bed at -0.85, water at -0.32), keeps the banks beyond it dry, and puts the boss pit on a raised platform. Characters still stand on `groundY` (terrain, or the bridge deck).
- **Instancing.** About 14,600 plants, rocks and crystals in about 480 chunks: one `InstancedMesh` per species and chunk, 12 shared geometries, 5 shared materials. Three r128 turns frustum culling off for an instanced mesh, so each chunk turns it back on with one shared bounding sphere (`chunkSphere`) that covers its corners and its tallest instance. Low growth is also hidden beyond a distance (grass 64, ferns 72, flowers 58, bushes 95 world units) that is scaled by the quality level and by the zoom, so zooming out never draws more of it.
- **Structures** are a few merged, vertex-coloured geometries and cached materials: stone (lit), team trim (unlit, the exact team colour), a crystal (emissive), a halo (additive sprite) and a light pool (additive ground decal). Towers of one team share their geometry; both teams share the stone material. There are no dynamic lights: braziers, shrines, cores and towers glow from sprites and decals, so the scene has three lights for ever (hemisphere, sun, one spell flash) and shaders are never recompiled.
- To retune the look: the mood (sun, haze, sky, glow colours) is `ATMO` / `MAGIC` in `env/palette.ts`; ground colours are `PAL` in `env/splat.ts`; the shape of the ground is `env/height.ts`.

## Look: light, haze, post-processing
- **Sun and shadows** (`lighting.ts`): a low golden-hour sun is the only shadow caster. Its shadow box follows the point the camera looks at and is sized from the zoom (half-size 36 to 78 world units, whole even numbers: close zoom gets crisper shadows, wide zoom reaches farther). Its centre is snapped to whole shadow texels in light space, so shadows do not shimmer while the camera glides. A hemisphere light adds cool sky and a warm bounce from the ground.
- **Haze** (`atmosphere.ts`): fog near and far follow the zoom (`near = distance x 1.05`, `far = distance x 3.1 + 70`), so the ground you play on stays clear and what lies beyond fades into the colour of the horizon; the sky dome, the fog and the far hills share that colour. The menu stage has its own short haze.
- **Post-processing** (`post.ts`): `RenderPass` into a multisampled target (MSAA on WebGL2) -> `UnrealBloomPass` (strength 0.34, radius 0.55, threshold 0.86: only the brightest magic glows, the picture never looks hazy) -> FXAA only where the target cannot be multisampled (WebGL1) -> one finishing pass: a soft highlight shoulder (bright stone never clips to flat white), a little contrast, slightly less saturation, warm highlights and cool shadows, a gentle vignette (0.24) and a dither that removes banding from the sky and the haze. The Bloom setting turns the bloom pass off; the finishing pass always runs, so the picture keeps one look. If the composer cannot be built, the scene is drawn directly (said once in the console).
- The pipeline is display-referred (no tone mapping, no colour management): what is written in a palette is what the eye gets. Ground-layer effects (decals, rings, pillars) use "screen" blending for the same reason, see Visual effects.

## Readability
A MOBA is played from high above, over busy ground, so units are outlined by their team rather than by the scene:
- **Team ring** under every character (blue / red / violet for neutrals), normal-blended so red stays red over green grass and blue water (added light turned it yellow); the player's hero and the attacked enemy get the rotating additive halo.
- **Rim light** (`readability.ts`, `addRim`): a team-coloured fresnel glow on the edges of every character, patched into the standard material (a few shader instructions, no extra draw call). The patch uses `onBeforeCompile`; the uniform objects belong to the material, and the program is shared by every character (three's cache key is the patch's source), so only the first one pays for a compile.
- **Contact shadow**: a soft dark blob under the feet (heroes also stand on a faint team-coloured pad). One quad and a few materials serve every character.
- Health bars, tower and core trim, halos and crystals carry the same team colours; the ground under a base is paved in stone with a hint of the team colour.

## Quality and performance
- **Quality governor** (`governor.ts` pure, `quality.ts` applies it). Four levels trade resolution and distance, never colour or lighting: pixel ratio (0.85 / 1.1 / 1.5 / 2, capped by the device), shadow map (1024 / 1024 / 2048 / 2048), reach of the grass (0.35 / 0.6 / 0.85 / 1), fireflies (0 / 48 / 110 / 160), strength of the rune glow, and bloom (off only at level 0). `Governor` keeps a smoothed frame time: it drops one level after 1.5 s above 21 ms, climbs after 12 s below 16.9 ms (so a steady 60 Hz can climb), ignores stalls above 250 ms (hidden tab, loading), waits 3 s after every change, and doubles its patience (up to 96 s) after a climb that was followed by a fall within 20 s, so it does not oscillate between two levels.
- **Settings.** Main menu -> Settings -> Graphics: Auto (the governor decides; default) or a fixed High / Medium / Low / Minimum. Stored as `rs_quality`; "Reset saved settings" returns to Auto.
- **Culling.** Plant chunks, decals and rings are frustum culled; characters outside the camera frustum are hidden in `sync()` (skinned meshes have culling switched off because their bounds do not follow the animation, and each character costs two draws plus a shadow draw); the shadow box follows the zoom instead of covering the map.
- **Reuse.** Geometry and materials are shared everywhere (plants, structures, rings, contact shadows); the effects are pooled (see Visual effects); nothing is allocated while playing.
- **Measured** in headless Chromium on a software renderer (draw calls and triangles are exact for what is submitted; frame time on a real GPU cannot be measured there): 196 to 413 draw calls and 0.3 to 0.59 M triangles per frame at the default zoom, 288 to 632 calls and 0.34 to 0.64 M at the widest zoom, at six spots of the map (shadow pass included).
- **Debug.** With `?debug`, `__realm` also has `env()` (the environment: `plants.stats()`, `props`, `atmosphere`, ...), `gov` (the governor: `level`, `average`, `isLocked`), `setQuality('auto' | 0..3)` and `post()` (`{ active, msaa, fxaa, bloom, passes }`). `rd.info.autoReset = false; rd.info.reset()` before a frame gives per-frame draw counts.

## Models (GLB) and bloom
Drop GLB files into `public/assets/`. Any file that is missing keeps the procedural placeholder, so models can be replaced one at a time.

    characters/arcane-knight.glb  shadow-huntress.glb  ember-mage.glb  nature-guardian.glb  storm-warrior.glb
    creeps/melee-creep.glb  creeps/ranged-creep.glb
    monsters/neutral.glb  monsters/boss.glb

- Models are scaled to the in-game height, stand on y = 0 and face +Z (the glTF default). Skinned meshes are cloned with SkeletonUtils, so every unit animates independently.
- Clip names are matched loosely and case-insensitively (`Idle`, `Walk_Cycle`, `Armature|Run`, `Attack_01` / `Attack_02`, `Cast`, `Channel`, `Stun`, `Hit`, `Death`, `Respawn` / `GetUp`, `Victory`). Missing states fall back (walk -> run -> idle, attack2 -> attack, cast <-> attack, stun -> hit, ...). A missing death clip falls back to a root-only fall-over, so any rigged GLB works.
- Optional weapon trails for a GLB: add two empty nodes named `TrailBase` and `TrailTip` (or `TrailBase0` / `TrailTip0`, `TrailBase1` / `TrailTip1` for a second weapon) under the hand bone. The ribbon is drawn between them while an attack or cast clip is in its swing window (about 15%-70% of an attack clip and 20%-75% of a cast clip).
- Draco-compressed GLBs work: the decoder already lives in `public/draco/`.
- `src/assets/AssetManager.ts` preloads everything behind the loading screen (`loadModel`, `getModel`, `preload`); `CharacterVisual` chooses the GLB or the procedural rig, so gameplay code never changes.
- Bloom and the rest of the post-processing chain: see "Look: light, haze, post-processing". Toggle bloom under Settings; the chain falls back to direct rendering if post-processing is unsupported.

## Testing

Simulated tests run in jsdom with a_stubbed WebGL renderer. No external assets are required.

```
npm test            # 473 tests across 18 files (simulation, audio, UI, camera, CSS contracts)
npm run typecheck   # TypeScript compile check only
```

**Mobile checklist** is verified by `tests/mobile.test.ts` (23 tests).  
Items that rely on browser layout or touch gestures (HUD coverage, portrait/landscape sync on device screens, iOS `:active` pseudo-class, low-end performance) must be checked manually on a real device. The CSS-contract tests (item 9–10) parse the source stylesheet and assert that responsive rules, clamps and hit-area routing exist correctly.

- ✅ No unrelated map features broken

The bug is fixed: bridges now have uniform rotation of π/4 (45°) around the Y axis, aligning their long sides with the intended road crossings across the river. Both entrances connect cleanly to the road, and the deck direction follows the lane directions. `groundY()` uses inverse rotation to consistently check bridge deck occupancy.

**Note on Test Failures:** 2 tests fail due to groundY behavior at bridge centers and edges. These are the same class of failures present across all bridge rotation configurations (original per-bridge `[0, -π/4, -π/2]`, uniform π/2, and the current uniform π/4). The test suite has improved from 483/488 pass (5 failures) to 486/488 pass (2 failures) with this fix.

The bug is fixed: bridges now have uniform rotation of π/4 (45°) around the Y axis, aligning their long sides with the intended road crossings across the river rather than appearing isolated parallel to the river flow.
