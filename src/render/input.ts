import { rd } from './scene';
import { MS, camHome, camRecenter, camRotate, camRotateStep, camZoom, wpt } from './camera';
import { fxAim, fxPing } from './vfx';
import { app, hooks } from '../game/state';
import { dist } from '../game/util';
import { cast } from '../game/sim/combat';
import { ui } from '../ui/store';
import { publishHud } from '../ui/hudData';
import { setPause, toggleShop } from '../ui/commands';
export const cv=rd.domElement;
export const KD={ArrowLeft:'left',ArrowRight:'right',ArrowUp:'up',ArrowDown:'down'};

/** The one activation path for every input: keyboard QWER, the HUD skill buttons and the attack button all land here.
 * `cast()` alone decides whether a spell fires (cooldown, mana, level, death), so pointer input can never bypass the rules.
 * The short per-slot window swallows the pointerdown + click pair a tap can produce, so one tap fires one cast at most. */
const lastCast=[0,0,0,0];
export function tryCast(i:number,aim?:{x:number;y:number}):void{
 if(app.mode!=='play'||!app.G||app.G.pause||app.G.over||app.G.st!=='play'||app.me.dead)return;
 const h=app.me;if(!h.def.ab[i])return;
 const t=performance.now();if(t-lastCast[i]<160)return;lastCast[i]=t;
 const p=aim||aimPoint(h,i);
 fxAim(p.x,p.y);cast(h,i,p.x,p.y);
}
/** Where a button cast aims: the selected target, else the nearest enemy in reach, else the direction the hero faces. */
function aimPoint(h,i:number){const a=h.def.ab[i],T=a[2];
 if(T==='aoe'||T==='heal'||T==='buff')return{x:h.x,y:h.y};
 const rg=T==='tgt'?650:a[6];
 const t=(h.tgt&&!h.tgt.dead&&dist(h,h.tgt)<=rg+h.tgt.r?h.tgt:null)||aimTarget(h,rg);
 if(t)return{x:t.x,y:t.y};
 if(h.mv)return{x:h.mv.x,y:h.mv.y};
 return{x:h.x+Math.cos(h.fa)*320,y:h.y+Math.sin(h.fa)*320};
}
/** Nearest living enemy within `rg`: units first, towers and cores only when nothing else is around. */
function aimTarget(h,rg:number){let u=null,us=1e9,s=null,ss=1e9;
 for(const o of app.all){if(o.dead||o.team===h.team)continue;const d=dist(h,o)-o.r;if(d>rg)continue;
  if(o.k==='tower'||o.k==='core'){if(d<ss){ss=d;s=o}}else if(d<us){us=d;u=o}}
 return u||s}
/** Attack button (touch): chase and basic-attack the nearest enemy; same rules as clicking a unit on the battlefield. */
export function tryAttack():void{
 if(app.mode!=='play'||!app.G||app.G.pause||app.G.over||app.G.st!=='play'||app.me.dead)return;
 const h=app.me,t=aimTarget(h,640);
 if(t){h.tgt=t;h.mv=null}else hooks.ft(h.x,h.y-40,'No target','#ffe066');
}

cv.addEventListener('contextmenu',e=>e.preventDefault());
cv.addEventListener('pointerdown',e=>{MS.x=e.clientX;MS.y=e.clientY;if(e.pointerType==='touch')MS.touch=1;if(app.mode!=='play'||!app.G||app.G.pause||app.G.over)return;if(e.isPrimary===false)return;if(e.button===1){MS.drag=1;e.preventDefault();return}if(app.me.dead||app.G.st!=='play')return;const w=wpt(e);
 if(e.button===2){app.me.tgt=null;app.me.mv=w;fxPing(w.x,w.y);return}const t=app.all.find(u=>!u.dead&&u.team!==0&&dist(u,w)<u.r+30);if(t){app.me.tgt=t;app.me.mv=null;fxPing(t.x,t.y,'attack')}else{app.me.tgt=null;app.me.mv=w;fxPing(w.x,w.y)}});
addEventListener('pointermove',e=>{if(e.pointerType!=='touch')MS.touch=0;if(MS.drag)camRotate(e.clientX-MS.x);MS.x=e.clientX;MS.y=e.clientY;MS.in=1});
addEventListener('pointerup',()=>MS.drag=0);
document.addEventListener('mouseleave',()=>MS.in=0);
cv.addEventListener('wheel',e=>{camZoom(e.deltaY);e.preventDefault()},{passive:false});

// Touch camera: two fingers on the battlefield pinch-zoom and rotate. One finger stays a tap-to-move/attack order.
const tp=new Map<number,{x:number;y:number}>();let pd=0,pa=0;
const tset=(e:PointerEvent)=>{tp.set(e.pointerId,{x:e.clientX,y:e.clientY});if(tp.size===2){const[a,b]=[...tp.values()];pd=Math.hypot(a.x-b.x,a.y-b.y);pa=Math.atan2(b.y-a.y,b.x-a.x)}};
cv.addEventListener('pointerdown',e=>{if(e.pointerType==='touch'&&app.mode==='play')tset(e)});
cv.addEventListener('pointermove',e=>{if(e.pointerType!=='touch'||!tp.has(e.pointerId))return;tp.set(e.pointerId,{x:e.clientX,y:e.clientY});
 if(tp.size===2){const[a,b]=[...tp.values()];const d=Math.hypot(a.x-b.x,a.y-b.y),g=Math.atan2(b.y-a.y,b.x-a.x);
  if(pd>0){camZoom((pd-d)*2);camRotate((g-pa)*160)}pd=d;pa=g}});
const tclear=(e:PointerEvent)=>{if(tp.delete(e.pointerId)&&tp.size<2)pd=0};
cv.addEventListener('pointerup',tclear);cv.addEventListener('pointercancel',tclear);

addEventListener('keydown',e=>{if(app.mode!=='play'||!app.G)return;const k=e.key,d=KD[k];if(d){app.keys[d].isDown=true;e.preventDefault();return}if(e.repeat)return;const u=k.toUpperCase(),i=k.length===1?'QWER'.indexOf(u):-1;
 if(i>=0){tryCast(i,wpt({clientX:MS.x,clientY:MS.y}));return}
 if(k===' '){camRecenter();e.preventDefault()}else if(k==='['){camRotateStep(-1)}else if(k===']'){camRotateStep(1)}else if(k==='Home'){camHome();e.preventDefault()}else if(k==='Tab'){ui.set({scoreboard:true});publishHud();e.preventDefault()}else if(u==='M')ui.set({minimapBig:!ui.get().minimapBig});else if(u==='B')toggleShop();else if(k==='Escape')setPause(!app.G.pause)});
addEventListener('keyup',e=>{const d=KD[e.key];if(d)app.keys[d].isDown=false;if(e.key==='Tab')ui.set({scoreboard:false})});
