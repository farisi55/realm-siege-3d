export const minimap: { canvas: HTMLCanvasElement | null } = { canvas: null };
import { LN, W } from '../game/config';
import { app } from '../game/state';
import { dist } from '../game/util';
export function mini(){const c=minimap.canvas;if(!c)return;const x=c.getContext('2d'),S=c.width/W;x.fillStyle='#0b1018';x.fillRect(0,0,c.width,c.height);
 x.strokeStyle='#3a3550';x.lineWidth=5;LN.forEach(l=>{x.beginPath();l.forEach((p,i)=>x[i?'lineTo':'moveTo'](p[0]*S,p[1]*S));x.stroke()});
 for(const u of app.all){if(u.dead)continue;
  if(u.team===1&&u.k!=='tower'&&u.k!=='core'&&!app.all.some(a=>a.team===0&&!a.dead&&dist(a,u)<900))continue;
  x.fillStyle=u.team===2?'#b28cff':u.team?'#ff4a5a':'#3b9cff';const z=u.k==='core'?9:u.k==='tower'?5:u.k==='hero'?6:2.5;x.fillRect(u.x*S-z/2,u.y*S-z/2,z,z)}
 x.strokeStyle='#fff';x.lineWidth=1.5;x.beginPath();x.arc(app.me.x*S,app.me.y*S,8,0,6.3);x.stroke();
 const v=app.view;x.strokeStyle='#ffffff66';x.strokeRect(v.x*S,v.y*S,v.width*S,v.height*S)}
