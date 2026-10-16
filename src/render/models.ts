import { mat, part } from './factory';
import { TCOL } from '../game/config';
import * as THREE from 'three';
import { coreModel, towerModel } from './env/structures';

// Characters (heroes, creeps, monsters) live in rigs.ts / heroes.ts / character.ts. This file keeps the non-character models:
// siege engine, the tower / core entry points, and the floating health / mana bars.
export const mkSiege=tc=>{const g=new THREE.Group();part(g,'box',mat(0x4a3a2a),0,.5,0,1.1,.5,1.6);part(g,'cyl',mat(0x222222),0,.95,.2,.25,1.2,.25).rotation.x=1.2;[-.6,.6].forEach(x=>part(g,'sph',mat(0x2a2a2a),x,.3,-.4,.35,.35,.35));part(g,'sph',mat(tc,tc,1),0,1,-.5,.2,.2,.2);return g};
// Towers and the core are built by env/structures.ts: merged stone and trim geometry, a lit crystal, a halo sprite and a light pool (no dynamic lights).
export const mkTower=tc=>towerModel(tc);
export const mkCore=tc=>coreModel(tc);
export const BG=new THREE.PlaneGeometry(1,1);
export const bmat=c=>new THREE.MeshBasicMaterial({color:c,depthTest:false,transparent:true});
export const BM=[0,1,2].map(i=>bmat(TCOL[i]));
export const BB=bmat(0);
export const MB=bmat(0x2f7bff);
BB.opacity=.7;
export function mkBar(u,w,y){const b=new THREE.Group(),bg=new THREE.Mesh(BG,BB),fg=new THREE.Mesh(BG,BM[u.team]);b.position.y=y;bg.scale.set(w,.24,1);fg.scale.set(w,.2,1);fg.position.z=.01;bg.renderOrder=fg.renderOrder=10;b.add(bg,fg);b.userData={fg,w};
 if(u.k==='hero'){const mb=new THREE.Mesh(BG,MB);mb.scale.set(w,.09,1);mb.position.set(0,-.2,.02);mb.renderOrder=10;b.add(mb);b.userData.mb=mb}return b}
