import { W } from './config';
export const rnd=(a,b)=>a+Math.random()*(b-a);
export const dist=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
export const hex=n=>'#'+n.toString(16).padStart(6,'0');
export const mir=p=>[W-p[0],W-p[1]];
export const clamp=(v,a,b)=>Math.min(b,Math.max(a,v));
export const wrapA=a=>Math.atan2(Math.sin(a),Math.cos(a));
