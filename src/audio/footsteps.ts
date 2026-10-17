import { app } from '../game/state';
import type { Unit } from '../game/types';
import { surfaceAt } from '../game/map';
import { playSFX } from './audio';

/**
 * Phase 4: footsteps from real movement.
 *
 * There is no "walk" event in the simulation, so this module watches the position the world already publishes: each
 * tick it measures how far every mover travelled since the last one and counts that distance against a stride. Cadence
 * therefore follows actual speed for free — a slowed hero steps slower, Wind Boots and Smoke Veil quicken it — and a
 * unit that stands still, is dead, is stunned or was teleported (`st > 0`, `dead`, or a jump larger than any gait)
 * never plants a phantom step. The ground comes from `map.surfaceAt` (the river runs along `x = y`), so grass and
 * shallow water tick differently.
 *
 * The player's steps are the loud ones; AI and creep steps are a low-priority texture: only near the listener, only a
 * few per window, always quieter. Everything is positional — the engine's falloff and pan tame the rest.
 */

/** World units per step; cadence = speed / stride, so ~3.8 steps/s for a 235-speed hero. */
const PLAYER_STRIDE = 62, AI_STRIDE = 74;
/** AI footsteps only exist within this range of the camera focus, and at most `AI_BURST` start per `AI_WINDOW` seconds. */
const AI_RANGE = 430, AI_BURST = 3, AI_WINDOW = .5;
/** A one-tick jump bigger than this is a dash, blink or respawn — never a step. */
const TELEPORT = 90;

interface Track { x: number; y: number; acc: number }
const tracks = new Map<Unit, Track>();
let aiAt = -1, aiUsed = 0;

/** Clears the gait memory (menu, match end, restart): the next match never inherits an old position. */
export function footstepsReset(): void { tracks.clear(); aiAt = -1; aiUsed = 0; }
/** How many units are currently being tracked (debug/tests). */
export function footstepTracks(): number { return tracks.size; }

/** One frame of gait: player first (priority), then a budgeted, range-limited AI layer. `dt` is the rendered frame time. */
export function footstepsTick(dt: number): void {
  if (dt <= 0) return;
  const G = app.G, me = app.me, cam = app.cam;
  const stopped = !G || G.over || G.pause;
  if (me) {
    if (stopped || me.dead || me.st > 0) tracks.delete(me); // pause/death/stun never advance the gait
    else gait(me, PLAYER_STRIDE, 1);
  }
  if (stopped) return;
  for (const u of app.all) {
    if (u === me) continue; // the player already had its turn
    if (u.dead || u.k === 'tower' || u.k === 'core' || !u.k) { tracks.delete(u); continue; }
    if (u.st > 0) { tracks.delete(u); continue; }
    if (Math.hypot(u.x - cam.k.x, u.y - cam.k.y) > AI_RANGE) continue; // out of earshot: not worth tracking
    gait(u, AI_STRIDE, .32);
  }
}

/** Advances one unit's gait by its actual displacement and plants a step when a stride is complete. */
function gait(u: Unit, stride: number, gain: number): void {
  const t = tracks.get(u) ?? { x: u.x, y: u.y, acc: 0 };
  tracks.set(u, t);
  const dx = u.x - t.x, dy = u.y - t.y;
  t.x = u.x; t.y = u.y;
  const d = Math.hypot(dx, dy);
  if (d > TELEPORT) { t.acc = 0; return; } // dash / respawn / blink: nothing was walked
  if (d <= 0) return;
  t.acc += d;
  if (t.acc < stride) return;
  t.acc -= stride;
  if (gain < 1 && !allowAI()) return;
  const water = surfaceAt(u.x, u.y) === 'water';
  playSFX(water ? 'stepWater' : 'stepGrass', { pos: { x: u.x, y: u.y }, gain, rate: 1 + (Math.random() * 2 - 1) * .06 });
}

/** The creep/AI step budget: a few per short window, reset with sim time so a paused clock never starves it. */
function allowAI(): boolean {
  const t = app.G ? app.G.t : 0;
  if (t - aiAt > AI_WINDOW || t < aiAt) { aiAt = t; aiUsed = 0; }
  if (aiUsed >= AI_BURST) return false;
  aiUsed++;
  return true;
}
