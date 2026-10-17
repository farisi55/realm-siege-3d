# Realm Siege 3D

Original 5v5 fantasy MOBA prototype: Three.js + TypeScript + Vite. No external assets: models, effects and terrain are procedural.

    npm install
    npm run dev        # dev server
    npm run build      # tsc --noEmit + production build (dist/)
    npm run typecheck  # tsc --noEmit
    npm test           # simulation, character system, GLB pipeline, VFX pools + Director, camera maths, the world (ground, scatter, painter, river, structures, plants), quality governor, post-processing chain, audio engine + combat mix (stubbed WebAudio), UI/3D scene (jsdom, stubbed WebGL)

## Structure
- `src/game/`  config (map, heroes, items), `state.ts` (shared state + hooks), `sim/` (units, combat, ai, world): pure simulation, no DOM/Three.js
- `src/render/` Three.js only: scene and lighting (`scene.ts`, `lighting.ts`), the world (`environment.ts` + `env/`, below), `ground.ts` (render-only standing height, bridge decks), the character system (below), `readability.ts` (rim light, contact shadows), `models.ts` (siege engines, health bars), the effects system (`vfx.ts` + `fx/`, below), post-processing (`post.ts`), the quality governor (`governor.ts` pure, `quality.ts` applies it), the camera (`camrig.ts` maths + `camera.ts`, below), input, hero-select stage (`stage.ts`), `units.ts` (mirrors the simulation into render objects)
- `src/assets/` AssetManager: GLB preload, cache, SkeletonUtils cloning, Draco
- `src/audio/` Web Audio only (below): `AudioManager.ts` (context, five buses, voices, asset cache), `synth.ts` (the built-in sounds), `combat.ts` (simulation events into the combat mix), `audio.ts` (the facade the game and UI import)
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
- Visual check without a GPU: the repo's tests run on a stubbed renderer; for screenshots use headless Chromium with SwiftShader and open the page with `?debug`.

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
The audio subsystem mirrors the effects one: `src/audio/audio.ts` is the one facade the rest of the game imports, `AudioManager.ts` owns the Web Audio graph and `synth.ts` holds the built-in sounds.

    audio.ts          facade: initAudio (gesture unlock, tab suspend, pagehide stop, delegated UI click), playSFX / playUI / playMusic / playAmbient, setVolume / setMuted / stopAll / resetAudio, audioPrefs / audioStats
      AudioManager.ts the engine: one AudioContext, five gain buses (master -> sfx / music / ambient / ui), voice registry with a cap, asset cache with `load` / `preload`, localStorage-backed volumes, never throws
      synth.ts        the built-in sounds, synthesized with oscillators and one shared noise buffer (no external assets)
      combat.ts       the combat mix: simulation events -> voice, distance, budget (below)

- **Buses and volumes.** `master` feeds the speakers; `sfx` / `music` / `ambient` / `ui` feed `master` and each has its own volume (menu -> Settings -> the volume sliders, or mute). Volumes persist as `rs_vol*` / `rs_mute`; "Reset saved settings" clears them.
- **Autoplay.** The context is created and resumed on the first pointer or key gesture; a hidden tab suspends it and `pagehide` stops every voice. Before a gesture nothing is built and `play()` reports false. No node is created for a click on a silent bus, inside a sound's `minGap` or beyond the voice cap.
- **Sources.** Every sound is synthesized by default. To use a file instead, add `urls` to the sound in `SOUNDS`; `preload()` tries them at boot and the synth stays as the fallback whenever a file is missing or undecodable, so the game is never silent because an asset did not ship.
- **Triggers so far.** `uiClick`: any button, form control or hero card (one delegated listener in `initAudio`, nothing per component). `matchStart`: `play()` in `flow.ts` starts a match (and stops whatever the previous one left sounding).
- **Combat.** The simulation never imports audio, exactly like effects: it pushes one typed, read-only event through a no-op `hooks.snd` at each real moment — a melee windup (`swing`), a projectile, bolt or tower shot leaving the weapon (`launch`), damage actually landing (`hit`, inside `hurt` and `blast`), a death (`die`) and a respawn (`respawn`). `flow.ts` wires the hook to `combat.ts`, which picks the voice; nothing is ever triggered from the render loop.

| simulation event | sound | when |
|---|---|---|
| melee windup | `swing` | at `atk`, melee reach (the blade swings even when the blow misses) |
| arrow release | `bowShot` | at `atk`, ranged creeps and the Huntress |
| siege or tower shot | `siegeShot` | a tower or siege engine fires |
| magic release | `magicShot` | a hero bolt is pushed, or the core shoots |
| arrow / heavy impact | `hitArrow` / `hitHeavy` | the projectile reaches the unit it was tracking |
| bolt / blast impact | `hitMagic` / `boomBlast` | a ballistic bolt connects / one voice for a blast, however many victims |
| melee impact | `hitMelee` | damage lands from a melee blow |
| structure / core damage | `hitStructure` / `hitCore` | `hurt` on a tower / on the core (core is global) |
| creep death | `dieCreep` | any minion or siege engine falls |
| hero / boss death | `dieBig` | any hero or jungle boss falls |
| tower / core destruction | `collapseTower` / `coreCollapse` | forced and global; one event covers the structure falling |
| hero respawn | `respawn` | `hup`, when the respawn timer ends |

- **The mix.** The listener is the player's hero: a cue fades with distance and goes silent past its range (short around a creep skirmish, global for structures and the cores), so nearby play always beats distant play. A rolling budget (five non-priority voices per 0.15 s of game time) spreads a swarm, while player events and structure losses are priority and force past it. Melee, arrow, magic, siege, structure and core events each own a distinct voice, and every play takes a small random pitch and gain nudge so no two impacts sound stamped.
- **Debug.** With `?debug`, `__realm.audio` is the AudioManager: after one click anywhere, `audio.snapshot()`, `audio.play('sfx', 'notify')`, `audio.setVolume('music', .5)`, `audio.stopAll()`.

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
