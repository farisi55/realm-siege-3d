import { app, hooks } from '../state';
import { CT, SP } from '../config';
import { rnd } from '../util';
/** Stable per-unit ids (audio loop ownership): the simulation reads them; nothing gameplay-facing depends on them. */
let nuid=1;
export function mk(o){const u={x:0,y:0,team:0,k:'creep',dmg:10,rng:60,as:1000,ar:0,mr:0,sp:150,cd:0,tt:0,tgt:null,dead:false,r:14,st:0,bf:0,bm:1,ls:0,ap:0,...o};u.max=o.hp||1;u.hp=u.max;if(u.id===undefined)u.id=nuid++;app.all.push(u);return u}
export function rc(h,full?){const d=h.def,L=h.lv-1,a={d:0,as:0,ar:0,mr:0,hp:0,mp:0,sp:0,ls:0,ap:0};h.it.forEach(i=>{for(const k in i.b)a[k]+=i.b[k]});
 const pr=h.max?h.hp/h.max:1,pm=h.mmax?h.mp/h.mmax:1;
 h.max=d.hp+d.g[0]*L+a.hp;h.mmax=d.mp+d.g[1]*L+a.mp;h.dmg=d.dmg+d.g[2]*L+a.d;h.as=d.as/(1+a.as/100);h.ar=d.ar+L*.9+a.ar;h.mr=d.mr+L*.5+a.mr;h.sp=d.sp+a.sp;h.ls=a.ls;h.ap=a.ap;h.rng=d.rng;
 h.hp=full?h.max:h.max*pr;h.mp=full?h.mmax:h.mmax*pm}
export function gain(h,g,x){h.g+=g;h.xp+=x;let n;while(h.lv<15&&h.xp>=(n=90+h.lv*70)){h.xp-=n;h.lv++;rc(h);hooks.fx(h.x,h.y,60,.8,0xffe066);hooks.ft(h.x,h.y-50,'LEVEL '+h.lv,'#ffe066')}}
export function spawnCamp(c){const N=c.boss?[[3800,95,400,700,40,130]]:[[700,40,70,100,20,90],[420,28,40,60,15,80],[260,18,25,40,12,70]];
 c.m=N.map((n,i)=>{const a=i*2.1,o=c.boss?0:34;return mk({k:'neutral',team:2,boss:c.boss,hp:n[0],dmg:n[1],g:n[2],xp:n[3],r:n[4],rng:n[5],as:1100,ar:4,mr:4,sp:130,x:c.x+Math.cos(a)*o,y:c.y+Math.sin(a)*o,hx:c.x,hy:c.y})})}
export function spawnCreep(t,L,k){const c=CT[k],s=1+app.G.t/900;mk({k,team:t,L,wp:1,x:SP[t][0]+rnd(-35,35),y:SP[t][1]+rnd(-35,35),hp:c.hp*s,dmg:c.dmg*Math.sqrt(s),rng:c.rng,as:c.as,ar:c.ar,sp:c.sp,r:c.r,g:c.g,xp:c.xp})}
export function wave(){app.G.wv++;for(let t=0;t<2;t++)for(let L=0;L<3;L++){const ks=['melee','melee','melee','ranged'];if(app.G.wv%3===0)ks.push('siege');ks.forEach((k,i)=>app.G.q.push([app.G.t+i*.8,t,L,k]))}}
