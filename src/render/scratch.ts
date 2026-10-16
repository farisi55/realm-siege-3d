import * as THREE from 'three';
export const E3=new THREE.Euler;
export const Q3=new THREE.Quaternion;
export const V3=new THREE.Vector3;
export const M4=new THREE.Matrix4;
export const SV=new THREE.Vector3;
export const CC=new THREE.Color;
/** Object3D.removeFromParent only exists from three r129. */
export const detach = (o: THREE.Object3D): void => { if (o.parent) o.parent.remove(o); };
