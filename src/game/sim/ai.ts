import { dist } from '../util';
import { app } from '../state';
import { atk, cast, go, near, reach } from './combat';
import { BASE, IT, SP, path } from '../config';
import { rc } from './units';
export function aiCast(h,t){const d=dist(h,t);for(let i=0;i<4;i++){const a=h.def.ab[i],T=a[2];if(h.acd[i]>0||h.mp<a[4]||(i===3&&h.lv<3))continue;
 const ok=T==='heal'?app.all.some(o=>o.k==='hero'&&o.team===h.team&&!o.dead&&o.hp<o.max*.65&&dist(o,h)<a[6]):T==='buff'?d<350:T==='aoe'?d<a[6]:T==='dash'?d>180&&d<a[6]:d<(T==='tgt'?600:a[6]);
 if(ok){cast(h,i,t.x,t.y);return}}}
export function aiBuy(h){if(h.it.length>=6)return;const c=IT.filter(i=>i[1]<=h.g);if(!c.length)return;const i=c.reduce((a,b)=>b[1]>a[1]?b:a);h.g-=i[1];h.it.push({n:i[0],c:i[1],b:i[2]});rc(h)}
export function ai(h,dt){const b=BASE[h.team];
 if(h.hp<h.max*.3)h.rt=1;else if(h.rt&&h.hp>h.max*.85)h.rt=0;
 if(Math.hypot(h.x-b[0],h.y-b[1])<350)aiBuy(h);
 if(h.rt){go(h,SP[h.team][0],SP[h.team][1],dt);return}
 if((h.tt-=dt)<=0){h.tgt=near(h,480,!h.j);h.tt=.4}
 const t=h.tgt&&!h.tgt.dead?h.tgt:null;
 if(t){aiCast(h,t);if(reach(h,t,h.rng)){if(h.cd<=0)atk(h,t)}else go(h,t.x,t.y,dt);return}
 if(h.j){let n=null,bd=2400;for(const o of app.all)if(o.team===2&&!o.dead){const d=dist(h,o);if(d<bd){bd=d;n=o}}if(n){go(h,n.x,n.y,dt);return}}
 const p=path(h.team,h.j?1:h.lane),w=p[Math.min(h.wi,p.length-1)];
 if(Math.hypot(h.x-w[0],h.y-w[1])<110&&h.wi<p.length-1)h.wi++;
 const ally=app.all.some(o=>o.team===h.team&&!o.dead&&(o.k==='melee'||o.k==='ranged'||o.k==='siege')&&dist(o,h)<650),
  tw=app.all.some(o=>o.k==='tower'&&o.team!==h.team&&!o.dead&&dist(o,h)<560);
 if(ally||!tw)go(h,w[0],w[1],dt)}
export function hup(h,dt){
 if(h.dead){h.rs-=dt;if(h.rs<=0){h.dead=false;h.x=SP[h.team][0];h.y=SP[h.team][1];rc(h,1);h.tgt=null;h.mv=null;h.rt=0}return}
 for(let i=0;i<4;i++)h.acd[i]=Math.max(0,h.acd[i]-dt);
 h.mp=Math.min(h.mmax,h.mp+(h.mmax*.01+1.5)*dt);h.hp=Math.min(h.max,h.hp+h.max*.004*dt);h.g+=2.3*dt;
 const b=BASE[h.team];if(Math.hypot(h.x-b[0],h.y-b[1])<330){h.hp=Math.min(h.max,h.hp+h.max*.08*dt);h.mp=Math.min(h.mmax,h.mp+h.mmax*.08*dt)}
 if(h.st>0){h.st-=dt;return}
 if(h.ai)return ai(h,dt);
 const K=app.keys,fw=(K.up.isDown?1:0)-(K.down.isDown?1:0),rt=(K.right.isDown?1:0)-(K.left.isDown?1:0),dx=-fw*Math.sin(app.cam.cy)+rt*Math.cos(app.cam.cy),dy=-fw*Math.cos(app.cam.cy)-rt*Math.sin(app.cam.cy);
 if(dx||dy){h.tgt=null;h.mv=null;const n=Math.hypot(dx,dy);go(h,h.x+dx/n*50,h.y+dy/n*50,dt);return}
 if(h.tgt&&h.tgt.dead)h.tgt=null;const t=h.tgt;
 if(t){if(reach(h,t,h.rng)){if(h.cd<=0)atk(h,t)}else go(h,t.x,t.y,dt);return}
 if(h.mv){go(h,h.mv.x,h.mv.y,dt);if(dist(h,h.mv)<6)h.mv=null;return}
 const e=near(h,h.rng+40);if(e&&h.cd<=0)atk(h,e)}
export function up(u,dt){u.cd-=dt;u.bf-=dt;if(u.k==='hero')return hup(u,dt);
 if(u.st>0){u.st-=dt;return}
 if(u.k==='tower'||u.k==='core'){const t=near(u,u.rng);if(t&&u.cd<=0)atk(u,t);return}
 if(u.tgt&&u.tgt.dead)u.tgt=null;
 if((u.tt-=dt)<=0){u.tgt=near(u,u.k==='neutral'?260:380);u.tt=.35}
 const t=u.tgt;
 if(u.k==='neutral'){const a=Math.hypot(u.x-u.hx,u.y-u.hy);if(a>520||(!t&&a>8)){u.tgt=null;go(u,u.hx,u.hy,dt,1.6);u.hp=Math.min(u.max,u.hp+u.max*.1*dt);return}}
 if(t){if(reach(u,t,u.rng)){if(u.cd<=0)atk(u,t)}else go(u,t.x,t.y,dt);return}
 if(u.k!=='neutral'){const p=path(u.team,u.L),w=p[u.wp];if(Math.hypot(u.x-w[0],u.y-w[1])<90&&u.wp<p.length-1)u.wp++;go(u,w[0],w[1],dt)}}
