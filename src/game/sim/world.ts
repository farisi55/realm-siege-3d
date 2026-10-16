import { mk, rc, spawnCamp, spawnCreep, wave } from './units';
import { BASE, CAMP, HR, SP, TW } from '../config';
import { mir } from '../util';
import { aiBuy, up } from './ai';
import { coll, pup } from './combat';
import { app } from '../state';

/** Builds a fresh match: structures, 10 heroes, jungle camps. Pure simulation, no DOM or Three.js. */
export function createWorld(): void {
  app.all = []; app.P = [];
  app.G = { t: 0, wv: 0, q: [], ev: [], k: [0, 0], st: 'prep', pause: false, over: false, ft: 0, hu: 0, mu: 0, cu: 0, nw: 0, camps: [] };
  for(let t=0;t<2;t++){mk({k:'core',team:t,x:BASE[t][0],y:BASE[t][1],hp:3500,dmg:60,rng:360,as:1200,ar:15,mr:10,r:56});
  for(let L=0;L<3;L++)(t?TW[2-L].map(mir):TW[L]).forEach(p=>mk({k:'tower',team:t,x:p[0],y:p[1],hp:1500,dmg:85,rng:400,as:1000,ar:12,mr:8,r:28}))}
 const hero=(t,i,d,lane,ai)=>{const u=mk({k:'hero',team:t,def:HR[d],lv:1,xp:0,g:600,it:[],acd:[0,0,0,0],kl:0,dt:0,ai,lane,j:lane==='j',wi:1,rs:0,mp:1,mmax:1,hp:1,x:SP[t][0]+(i%3-1)*45,y:SP[t][1]-(i>>1)*45,r:18});rc(u,1);return u};
 app.me=hero(0,0,app.sel,1,false);
 [0,2,1,'j'].forEach((l,i)=>hero(0,i+1,(app.sel+i+1)%5,l,true));
 [1,0,2,1,'j'].forEach((l,i)=>hero(1,i,[2,0,4,1,3][i],l,true));
 app.all.forEach(h=>{if(h.ai){aiBuy(h);aiBuy(h)}});
 app.G.camps=CAMP.map(p=>({x:p[0],y:p[1],m:[],rs:0,boss:0})).concat([{x:1000,y:1000,m:[],rs:0,boss:1}]);app.G.camps.forEach(spawnCamp);
}

/** Advances the simulation by dt seconds (prep countdown, waves, timed events, camps, units, collisions, projectiles). */
export function stepSim(dt: number): void {
  const g = app.G;
  g.t += dt;
  if (g.st === 'prep' && g.t >= 10) { g.st = 'play'; g.nw = g.t; }
  if (g.st !== 'play') return;
  if (g.t >= g.nw) { wave(); g.nw += 20; }
  if (g.q.length) { const k = []; for (const e of g.q) { if (e[0] <= g.t) spawnCreep(e[1], e[2], e[3]); else k.push(e); } g.q = k; }
  if (g.ev.length) { const k = []; for (const e of g.ev) { if (e[0] <= g.t) e[1](); else k.push(e); } g.ev = k; }
  if ((g.cu += dt) > .5) {
    g.cu = 0;
    g.camps.forEach(c => {
      if (c.m.length && c.m.every(m => m.dead)) { c.m = []; c.rs = g.t + (c.boss ? 180 : 50); }
      if (!c.m.length && g.t >= c.rs) spawnCamp(c);
    });
  }
  for (const u of app.all) if (!u.dead || u.k === 'hero') up(u, dt);
  coll(); pup(dt);
  app.all = app.all.filter(u => !u.dead || u.k === 'hero');
}
