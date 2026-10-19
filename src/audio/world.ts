import { app } from '../game/state';
import { ui } from '../ui/store';
import { playUI, setDuck, setListener, stopAll } from './audio';
import { musicScene, musicTick, resetMusic } from './music';
import { ambienceOff, ambienceOn, ambienceTick } from './ambience';
import { footstepsReset, footstepsTick } from './footsteps';
import { resetCombatAudio } from './combat';

/**
 * Phase 4: the world tick — the one place that turns the game's coarse state (mode, match over, pause, HUD numbers)
 * into audio decisions, once per rendered frame. Everything here is either idempotent or guarded by a stage change, so
 * running it at 144 Hz is free:
 *
 *  - The listener follows the camera focus and yaw, so spatial voices track what the player sees.
 *  - Music scene: menu bed in the menus, match bed during a match, one stinger when a match ends.
 *  - Ambience: the fixed world emitters are on exactly while a match is live, off in menus and after the end.
 *  - Footsteps advance only from the movement the simulation actually produced (never while paused).
 *  - Pause ducks the gameplay buses to a quarter (the UI stays crisp); resuming restores them.
 *  - Level-ups and gold gains are *watched*, not injected into the simulation: the HUD snapshot is the interface, so
 *    `uiLevel` / `uiGold` fire for real progression without one new sim event. The +2.3/s passive income only steps
 *    the floored gold by a coin per snapshot, so it stays silent — `uiGold` is for rewards, not for bookkeeping.
 */

/** Every voice phase 4 adds — the manifest check in the tests and the README table both read this list. */
export const WORLD_SOUNDS = [
  'musicMenu', 'musicMatch', 'musicVictory', 'musicDefeat',
  'ambWind', 'ambRiver', 'ambForest', 'ambBase', 'ambDistant',
  'stepGrass', 'stepGrass2', 'stepGrass3', 'stepGrass4', 'stepWater', 'stepWater2', 'stepWater3',
  'uiHover', 'uiSelect', 'shopOpen', 'shopClose', 'shopBuy', 'shopSell', 'uiLevel', 'uiGold', 'uiPause', 'uiResume',
] as const;

/** How much the world drops to while paused (music, sfx and ambience; the UI bus is never ducked). */
const PAUSE_DUCK = .25;

/**
 * Smallest gold gain (in one HUD snapshot) that counts as a reward voice. The passive income line (`h.g += 2.3*dt`
 * in the sim) crosses a whole number every ~0.43 s, which used to tick `uiGold` ~2.3 times a second for the whole
 * match — a metronome under everything else. A real reward is a jump: creep bounties are 22–48, a tower bonus 120,
 * a hero kill 200+, so a threshold of 8 keeps every one of them and swallows the drip.
 */
const GOLD_REWARD = 8;

type Stage = 'none' | 'menu' | 'live' | 'over';
let stage: Stage = 'none';
let lv = 1, gold = 0, time = -1;

/** Back to the pristine state (tests, teardown): silence everything phase 4 owns and forget the progression watch. */
export function worldAudioReset(): void {
  resetMusic();
  ambienceOff();
  footstepsReset();
  setDuck(1);
  stage = 'none';
  lv = 1; gold = 0; time = -1;
}

/** One frame of world audio. Cheap enough to call unconditionally from the render loop. */
export function worldAudioTick(dt: number): void {
  const G = app.G, cam = app.cam;
  setListener(cam.k.x, cam.k.y, cam.cy);

  const next: Stage = app.mode !== 'play' || !G ? 'menu' : G.over ? 'over' : 'live';
  if (next !== stage) {
    if (stage !== 'none') {
      // Leaving a stage: the world goes quiet, the combat loops stop, nothing of the old scene survives the swap.
      stopAll('music');
      ambienceOff();
      footstepsReset();
      resetCombatAudio();
      setDuck(1);
    }
    stage = next;
    if (next === 'live') { lv = 1; gold = 0; time = -1; } // a fresh match: never re-announce yesterday's numbers
  }

  if (stage === 'menu') musicScene('menu');
  else if (stage === 'over') musicScene(G!.win === 0 ? 'victory' : 'defeat');
  else {
    musicScene('match');
    ambienceOn();
    if (G!.pause) setDuck(PAUSE_DUCK);
    else { setDuck(1); footstepsTick(dt); }
  }

  musicTick();
  ambienceTick();
  if (stage === 'live' && !G!.pause) rewards();
}

/** Level-ups and gold gains, read from the HUD snapshot: the reward voices announce real progression, throttled. */
function rewards(): void {
  const h = ui.get().hud;
  if (!h) { lv = 1; gold = 0; time = -1; return; }
  if (time < 0 || h.time < time) { lv = h.lv; gold = h.gold; time = h.time; return; } // adopting a running match: silent
  if (h.lv > lv) playUI('uiLevel');
  else if (h.gold - gold >= GOLD_REWARD && !ui.get().shop) playUI('uiGold'); // a reward jump; the passive drip and shop sales stay quiet
  lv = h.lv; gold = h.gold; time = h.time;
}
