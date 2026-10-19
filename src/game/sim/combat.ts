import { clamp, dist } from '../util';
import { app, hooks } from '../state';
import { HR, TCC, TCOL, W } from '../config';
import { gain } from './units';
import { OB } from '../map';
export const reach=(a,b,r)=>dist(a,b)-b.r<=r;
export function near(u,rg,nj?){let b=null,bs=1e9;for(const o of app.all){if(o.dead||o.team===u.team)continue;
 if(o.team===2&&(u.k!=='hero'||nj))continue;if(u.team===2&&o.k!=='hero')continue;
 const d=dist(u,o)-o.r;if(d>rg)continue;const s=d+(o.k==='hero'&&u.k!=='hero'&&u.team<2?(o.ah>app.G.t?0:u.k==='tower'?500:170):0);if(s<bs){bs=s;b=o}}return b}
export function go(u,x,y,dt,m=1){const dx=x-u.x,dy=y-u.y,d=Math.hypot(dx,dy);if(d<2)return;const s=Math.min(d,u.sp*m*(u.bf>0?1.25:1)*dt);u.x+=dx/d*s;u.y+=dy/d*s;u.fa=Math.atan2(dy,dx)}
export function atk(u,t){u.cd=u.as/1000;u.at=.42;u.alt=!u.alt;u.fa=Math.atan2(t.y-u.y,t.x-u.x);const d=u.dmg*(u.bf>0?u.bm:1);
 if(u.rng<=160)hooks.snd({k:'swing',x:u.x,y:u.y,team:u.team,kind:u.k,player:u===app.me});
 app.G.ev.push([app.G.t+.22,()=>{if(u.dead||t.dead)return;
  if(u.rng>160){const kind=u.boss?'boss':u.k==='tower'||u.k==='siege'?'heavy':u.k==='core'?'magic':'arrow';hooks.snd({k:'launch',x:u.x,y:u.y,team:u.team,kind,player:u===app.me});app.P.push({x:u.x,y:u.y,t,s:u,dmg:d,sp:620,col:u.k==='hero'?u.def.c:TCOL[u.team],r:u.k==='tower'?7:4})}
  else if(reach(u,t,u.rng+40)){hurt(u,t,d,0,'melee');if(u.boss)blast(u,u.x,u.y,170,d*.7,700,0xff5ad0)}}])}
export function hurt(s,t,a,mg?,sk='melee',ab?){if(t.dead)return;if(t.k==='core'&&app.all.some(o=>o.k==='tower'&&o.team===t.team&&!o.dead))a*=.35;
 a*=100/(100+(mg?t.mr:t.ar)*2.5);t.hp-=a;t.ht=.3;
 const ik=t.k==='core'?'core':t.k==='tower'?'structure':sk; // impacts on structures keep their material voice; a blast is heard once via blast()
 if(ik!=='blast')hooks.snd({k:'hit',x:t.x,y:t.y,team:t.team,kind:ik,src:s?s.k:undefined,victim:t===app.me,player:s===app.me||t===app.me,big:!!t.boss,ab,uid:ab!==undefined&&s?s.id:undefined});
 if(t.boss&&!t.en&&t.hp<t.max*.4){t.en=1;t.dmg*=1.5;hooks.fx(t.x,t.y,260,1,0xff2a2a);hooks.ft(t.x,t.y-60,'ENRAGED','#ff5566')}if(s&&s.k==='hero'&&t.k==='hero')s.ah=app.G.t+3;hooks.ft(t.x,t.y-t.r-8,Math.round(a),mg?'#9fd0ff':'#ffffff');hooks.fx(t.x,t.y,12,.25,0xffffff);
 if(s&&s.ls&&s.k==='hero')s.hp=Math.min(s.max,s.hp+a*s.ls/100);
 if(t.k==='neutral'&&s)t.tgt=s;if(t.hp<=0)die(t,s)}
export function die(t,s){t.dead=true;const hero=t.k==='hero';hooks.snd({k:'die',x:t.x,y:t.y,team:t.team,kind:t.k,player:t===app.me||s===app.me,big:t.k==='tower'||t.k==='core'||!!t.boss,uid:t.id});
 hooks.fx(t.x,t.y,t.r*3,.6,hero?t.def.c:0xff9a3a);
 if(t.k==='neutral'&&s&&s.k==='hero'){s.bf=Math.max(s.bf,t.boss?40:10);s.bm=t.boss?1.4:1.2;hooks.fx(s.x,s.y,50,.6,0xffd04a)}
 if(t.k==='core'){hooks.finish(1-t.team);return}
 const hs=app.all.filter(o=>o.k==='hero'&&!o.dead&&o.team<2&&o.team!==t.team&&dist(o,t)<900),gd=hero?200+t.lv*30:t.g||0,xp=hero?110+t.lv*35:t.xp||0;
 if(s&&s.k==='hero'&&s.team!==t.team)gain(s,gd,0);else hs.forEach(h=>gain(h,gd*.5/hs.length,0));
 hs.forEach(h=>gain(h,0,xp/hs.length));
 if(t.k==='tower'){hooks.fx(t.x,t.y,160,.9,0xffaa44);app.all.forEach(o=>{if(o.k==='hero'&&o.team<2&&o.team!==t.team)gain(o,120,0)});hooks.feed((t.team?'Red':'Blue')+' tower destroyed',TCC[1-t.team])}
 if(hero){t.dt++;t.rs=6+t.lv*2;t.tgt=null;t.mv=null;if(s&&s.team<2)app.G.k[s.team]++;if(s&&s.k==='hero')s.kl++;
  hooks.feed((s&&s.def?s.def.n:'Minions')+' defeated '+t.def.n,TCC[s?s.team:2])}}
export function blast(h,x,y,r,dm,st,col,ab?){hooks.snd({k:'hit',x,y,team:h.team,kind:'blast',player:h===app.me,big:!!h.boss,ab,uid:h.id});hooks.fx(x,y,r,.5,col);app.all.forEach(o=>{if(!o.dead&&o.team!==h.team&&Math.hypot(o.x-x,o.y-y)<r+o.r){hurt(h,o,dm,1,'blast');if(st&&o.k!=='tower'&&o.k!=='core')o.st=st/1000}})}
export function cast(h,i,tx,ty){const a=h.def.ab[i],T=a[2];
 if(h.acd[i]>0||h.mp<a[4]||(i===3&&h.lv<3)){if(!h.ai)hooks.ft(h.x,h.y-40,h.acd[i]>0?'On cooldown':i===3&&h.lv<3?'Unlocks at Lv3':'Not enough mana','#ffe066');return false}
 h.mp-=a[4];h.acd[i]=a[3];const ab=HR.indexOf(h.def)*4+i,an=Math.atan2(ty-h.y,tx-h.x),c=Math.cos(an),s=Math.sin(an),dm=a[5]*(1+h.ap/100)*(1+h.lv*.05),col=h.def.c,dd=Math.hypot(tx-h.x,ty-h.y);
 h.ct=.75;h.fa=an;hooks.fx(h.x,h.y,40,.3,col);
 hooks.snd({k:'cast',x:h.x,y:h.y,team:h.team,kind:T,player:h===app.me,ab,uid:h.id}); // one event per committed cast; a failed cast above never reaches this line
 app.G.ev.push([app.G.t+.25,()=>{if(h.dead)return;if(T==='bolt'){hooks.snd({k:'launch',x:h.x,y:h.y,team:h.team,kind:'magic',player:h===app.me,ab,uid:h.id});app.P.push({x:h.x,y:h.y,vx:c*720,vy:s*720,life:a[6]/720,s:h,dmg:dm,mg:1,col,r:9,ab})}
 else if(T==='aoe')blast(h,h.x,h.y,a[6],dm,a[7],col,ab);
 else if(T==='tgt'){const d=Math.min(dd,650);blast(h,h.x+c*d,h.y+s*d,a[6],dm,a[7],col,ab)}
 else if(T==='dash'){const d=Math.min(dd,a[6]);h.x=clamp(h.x+c*d,20,W-20);h.y=clamp(h.y+s*d,20,W-20);blast(h,h.x,h.y,130,dm,0,col,ab)}
 else if(T==='heal')app.all.forEach(o=>{if(o.k==='hero'&&o.team===h.team&&!o.dead&&dist(o,h)<=a[6]){const b4=o.hp;o.hp=Math.min(o.max,o.hp+dm);if(o.hp>b4)hooks.snd({k:'heal',x:o.x,y:o.y,team:o.team,kind:'hero',player:o===app.me||h===app.me,ab,uid:h.id});hooks.ft(o.x,o.y-30,'+'+Math.round(dm),'#7dff9a');hooks.fx(o.x,o.y,30,.5,0x6fff8a)}});
 else if(T==='buff'){h.bf=a[6];h.bm=1+a[5]/100;hooks.fx(h.x,h.y,70,.6,col)}}]);return true}
export function coll(){const a=app.all.filter(u=>!u.dead&&u.k!=='tower'&&u.k!=='core'),O=OB.concat(app.all.filter(u=>!u.dead&&(u.k==='tower'||u.k==='core')));
 for(let i=0;i<a.length;i++)for(let j=i+1;j<a.length;j++){const p=a[i],q=a[j],dx=q.x-p.x,dy=q.y-p.y,m=p.r+q.r;if(dx>m||dx<-m||dy>m||dy<-m)continue;const d=Math.hypot(dx,dy);if(d<m&&d>.01){const f=(m-d)/d*.25;p.x-=dx*f;p.y-=dy*f;q.x+=dx*f;q.y+=dy*f}}
 for(const u of a){for(const o of O){const dx=u.x-o.x,dy=u.y-o.y,m=u.r+o.r;if(dx>m||dx<-m||dy>m||dy<-m)continue;const d=Math.hypot(dx,dy)||1;if(d<m){const k=m-d;u.x+=(dx*k-dy*k*.3)/d;u.y+=(dy*k+dx*k*.3)/d}}
  u.x=Math.min(W-20,Math.max(20,u.x));u.y=Math.min(W-20,Math.max(20,u.y))}}
export function pup(dt){for(const p of app.P){
 if(p.t){if(p.t.dead){p.dead=1;continue}const dx=p.t.x-p.x,dy=p.t.y-p.y,d=Math.hypot(dx,dy),s=p.sp*dt;if(d<=s+p.t.r){hurt(p.s,p.t,p.dmg,0,p.s.k==='tower'||p.s.k==='siege'?'heavy':'arrow');p.dead=1}else{p.x+=dx/d*s;p.y+=dy/d*s}}
 else{p.x+=p.vx*dt;p.y+=p.vy*dt;p.life-=dt;const h=app.all.find(o=>!o.dead&&o.team!==p.s.team&&Math.hypot(o.x-p.x,o.y-p.y)<o.r+p.r);
  if(h){hurt(p.s,h,p.dmg,p.mg,'magic',p.ab);hooks.fx(p.x,p.y,40,.3,p.col);p.dead=1}else if(p.life<=0)p.dead=1}}
 app.P=app.P.filter(p=>!p.dead)}
