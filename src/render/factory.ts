import * as THREE from 'three';
export const GM={box:new THREE.BoxGeometry(1,1,1),cyl:new THREE.CylinderGeometry(1,1,1,10),sph:new THREE.SphereGeometry(1,12,9),cone:new THREE.ConeGeometry(1,1,8),ico:new THREE.IcosahedronGeometry(1,0)};
export const MT={};
export const mat=(c,e=0,ei=0)=>MT[c+'_'+e+'_'+ei]||(MT[c+'_'+e+'_'+ei]=new THREE.MeshStandardMaterial({color:c,roughness:.7,metalness:.1,emissive:e,emissiveIntensity:ei}));
export function part(p,g,m,x,y,z,a,b,c,n?,sh=1){const o=new THREE.Mesh(GM[g],m);o.position.set(x,y,z);o.scale.set(a,b,c);o.castShadow=!!sh;if(n)o.name=n;p.add(o);return o}
