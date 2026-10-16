import { BASE, CAMP, LN, W } from './config';
import { clamp } from './util';
export const OB=[];
(()=>{let s=11;const R=()=>(s=(s*16807)%2147483647)/2147483647,
 dl=(x,y)=>{let m=1e9;for(const l of LN)for(let i=0;i<2;i++){const a=l[i],b=l[i+1],dx=b[0]-a[0],dy=b[1]-a[1],t=Math.max(0,Math.min(1,((x-a[0])*dx+(y-a[1])*dy)/(dx*dx+dy*dy)));m=Math.min(m,Math.hypot(x-a[0]-t*dx,y-a[1]-t*dy))}return m};
 for(let i=0;i<900&&OB.length<80;i++){const x=R()*W,y=R()*W,r=24+R()*26;
  if(dl(x,y)>150+r&&Math.hypot(x-1600,y-1600)>r+60&&BASE.every(b=>Math.hypot(x-b[0],y-b[1])>450)&&[...CAMP,[1000,1000],[2200,2200]].every(c=>Math.hypot(x-c[0],y-c[1])>190+r)&&OB.every(o=>Math.hypot(x-o.x,y-o.y)>o.r+r+30))OB.push({x,y,r},{x:W-x,y:W-y,r})}})();
export const laneD=(x,y)=>{let m=1e9;for(const l of LN)for(let i=0;i<2;i++){const a=l[i],b=l[i+1],dx=b[0]-a[0],dy=b[1]-a[1],t=clamp(((x-a[0])*dx+(y-a[1])*dy)/(dx*dx+dy*dy),0,1);m=Math.min(m,Math.hypot(x-a[0]-t*dx,y-a[1]-t*dy))}return m};
export const H=(x,y)=>{const f=clamp((laneD(x,y)-90)/220,0,1)*clamp((Math.min(Math.hypot(x-360,y-2840),Math.hypot(x-2840,y-360))-380)/260,0,1),rv=1-clamp(Math.abs(x-y)/1.414/150,0,1);return f*(Math.sin(x*.004)*Math.cos(y*.0035)*1.8+Math.sin(x*.011+y*.007)*.6+.8)-rv*.9};
