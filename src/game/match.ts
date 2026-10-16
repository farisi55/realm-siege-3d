import { clearR, sync } from '../render/units';
import { fxu, resetFx } from '../render/vfx';
import { ST } from './storage';
import { hideStage } from '../render/stage';
import { publishHud } from '../ui/hudData';
import { mini } from '../ui/minimap';
import { camUpd } from '../render/camera';
import { app } from './state';
import { createWorld, stepSim } from './sim/world';

/** Starts (or restarts) a match and prepares the 3D scene and HUD. */
export function startMatch(): void {
  clearR(); resetFx(); createWorld();
  const me = app.me, c = app.cam;
  c.k.x = me.x; c.k.y = me.y; c.o.x = c.o.y = 0; c.cy = -.785; c.cd = 48 / ST.get('zoom', 1);
  app.mode = 'play'; hideStage();
  for (const d in app.keys) app.keys[d].isDown = false;
}

/** One frame: simulation (unless paused/over), then camera, VFX and render-object sync. */
export function step(dt: number): void {
  const g = app.G, run = !g.over && !g.pause;
  if (run) {
    stepSim(dt);
    if ((g.mu += dt) > .06) { g.mu = 0; mini(); }
    if ((g.hu += dt) > .1) { g.hu = 0; publishHud(); }
  }
  camUpd(dt); fxu(run ? dt : 0); sync(g.pause ? 0 : dt);
}
