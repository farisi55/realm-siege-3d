import { app } from '../game/state';
import { HR } from '../game/config';
import { ui } from './store';
import type { ScoreRow } from './store';

/** Copies HUD numbers into the store. Called ~10x per second from the game loop. */
export function publishHud(): void {
  const { me, G, all } = app;
  if (!me || !G) return;
  const towers = (t: number) => all.filter(o => o.k === 'tower' && o.team === t).length;
  const score: ScoreRow[] | null = ui.get().scoreboard
    ? all.filter(o => o.k === 'hero').sort((a, b) => a.team - b.team).map(o => ({ team: o.team, name: o.def.n, lv: o.lv, kills: o.kl, deaths: o.dt, me: o === me }))
    : null;
  ui.set({
    fps: app.fps,
    hud: {
      hero: HR.indexOf(me.def), lv: me.lv, hp: me.hp, max: me.max, mp: me.mp, mmax: me.mmax, xp: me.xp, xpNext: 90 + me.lv * 70, gold: Math.floor(me.g),
      cds: me.acd.slice(), items: Array.from({ length: 6 }, (_, i) => me.it[i]?.n ?? null), kills: [G.k[0], G.k[1]], time: G.t, towers: [towers(0), towers(1)],
      countdown: G.st === 'prep' ? `Match begins in ${Math.ceil(10 - G.t)}` : me.dead ? `Respawn in ${Math.ceil(me.rs)}` : '', score,
    },
  });
}
