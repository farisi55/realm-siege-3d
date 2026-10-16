import { $ } from '../ui/dom';
import * as THREE from 'three';
import { ATMO } from './env/palette';

/** The renderer, the scene, the camera and the lights that never go away. Everything else (ground, plants, buildings, effects) lives in the scene. */
export const rd = new THREE.WebGLRenderer({ antialias: true });
export const sn = new THREE.Scene();
export const cm = new THREE.PerspectiveCamera(45, 1, 1, 600);
export const RC = new THREE.Raycaster();
export const pl0 = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
rd.shadowMap.enabled = true;
rd.shadowMap.type = THREE.PCFSoftShadowMap;
rd.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
$('g').appendChild(rd.domElement);

// Haze and sky share one color at the horizon (atmosphere.ts animates near / far with the zoom and draws the sky dome over the background).
sn.background = new THREE.Color(ATMO.fog);
sn.fog = new THREE.Fog(ATMO.fog, 60, 220);

/** The sun: the only shadow-casting light. lighting.ts keeps its shadow box on the action; the map is made once here. */
export const sun = new THREE.DirectionalLight(ATMO.sun, ATMO.sunI);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -44, right: 44, top: 44, bottom: -44, near: 1, far: 240 });
sun.shadow.camera.updateProjectionMatrix();
sun.shadow.bias = -.0005;
sun.shadow.normalBias = .04;
export const hemi = new THREE.HemisphereLight(ATMO.skyL, ATMO.groundL, ATMO.hemiI);
/** The one scene point light: the flash of a spell or an explosion (vfx.ts). Static lights were replaced by glow decals and emissive parts, which cost nothing per pixel. */
export const fl = new THREE.PointLight(0xffaa55, 0, 60);
sn.add(hemi, sun, sun.target, fl);

export const rsz = (): void => { rd.setSize(innerWidth, innerHeight); cm.aspect = innerWidth / innerHeight; cm.updateProjectionMatrix(); };
addEventListener('resize', rsz);
rsz();
