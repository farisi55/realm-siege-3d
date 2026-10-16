import * as THREE from 'three';
import { ATMO } from './palette';
import { SHARED } from './shared';

/**
 * Everything in the air: the sky dome (gradient, a warm glow where the sun is, a few thin clouds), the haze that deepens with the
 * distance (its range follows the zoom, so the ground you play on stays clear and what lies beyond fades), and a small cloud of
 * fireflies that drift around the camera focus. The fireflies are one `Points` object animated entirely in the vertex shader:
 * a fixed buffer, no per-frame CPU work, one draw call.
 */

const SKY_VERT = `
varying vec3 vDir;
void main() {
  vDir = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position.z = gl_Position.w; // at the far plane: behind everything
}`;

const SKY_FRAG = `
uniform vec3 uZenith, uMid, uHorizon, uGlow, uSun;
uniform float uTime;
varying vec3 vDir;
float h21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vn(vec2 p) {
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1.0, 0.0)), f.x), mix(h21(i + vec2(0.0, 1.0)), h21(i + vec2(1.0, 1.0)), f.x), f.y);
}
void main() {
  vec3 d = normalize(vDir);
  float y = d.y;
  vec3 col = mix(uHorizon, uMid, smoothstep(0.0, .32, y));
  col = mix(col, uZenith, smoothstep(.22, .85, y));
  float s = max(dot(d, uSun), 0.0);
  col += uGlow * (pow(s, 5.0) * .26 + pow(s, 48.0) * .45);
  vec2 cp = d.xz / (max(y, 0.0) + .28) * 1.6 + vec2(uTime * .006, 0.0);
  float c = vn(cp) * .55 + vn(cp * 2.1 + 7.0) * .3 + vn(cp * 4.3 - 3.0) * .15;
  float cl = smoothstep(.5, .78, c) * smoothstep(.02, .22, y) * .5;
  col = mix(col, mix(vec3(1.0, .95, .9), uGlow, pow(s, 3.0) * .6), cl);
  gl_FragColor = vec4(col, 1.0);
}`;

const FLY_VERT = `
attribute vec4 seed;
uniform float uTime, uRadius, uSize, uPixel;
uniform vec3 uFocus;
varying float vA;
varying float vHue;
void main() {
  vec2 box = vec2(uRadius * 2.0);
  vec2 base = seed.xz * 911.0;
  vec2 rel = fract((base - uFocus.xz) / box) - .5;
  float fade = 1.0 - smoothstep(.34, .5, max(abs(rel.x), abs(rel.y)));
  vec3 p;
  p.xz = uFocus.xz + rel * box + vec2(sin(uTime * .21 * (.5 + seed.w) + seed.y * 30.0), cos(uTime * .17 * (.5 + seed.w) + seed.x * 30.0)) * 1.4;
  p.y = uFocus.y + .5 + seed.y * 5.0 + sin(uTime * .33 * (.5 + seed.w) + seed.z * 40.0) * .5;
  vec4 mv = viewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  float tw = .5 + .5 * sin(uTime * (1.1 + seed.w * 2.2) + seed.x * 60.0);
  vA = fade * (.25 + .75 * tw);
  vHue = seed.w;
  gl_PointSize = uSize * uPixel * (.6 + .6 * seed.z) * clamp(70.0 / -mv.z, .4, 1.6);
}`;

const FLY_FRAG = `
varying float vA;
varying float vHue;
void main() {
  float r = length(gl_PointCoord - .5) * 2.0;
  float a = (1.0 - smoothstep(.0, 1.0, r)); a *= a * vA;
  vec3 col = mix(vec3(.95, 1.0, .55), vec3(.55, .95, 1.0), step(.72, vHue));
  gl_FragColor = vec4(col * 1.4, a);
}`;

export class Atmosphere {
  readonly dome: THREE.Mesh;
  readonly flies: THREE.Points;
  private readonly uniforms: { [k: string]: THREE.IUniform };
  private readonly parts: { dispose(): void }[] = [];

  constructor(private readonly scene: THREE.Scene, flyCount = 160) {
    const sunDir = new THREE.Vector3(...ATMO.sunOffset).normalize();
    this.uniforms = {
      uZenith: { value: new THREE.Color(ATMO.zenith) }, uMid: { value: new THREE.Color(ATMO.mid) }, uHorizon: { value: new THREE.Color(ATMO.horizon) },
      uGlow: { value: new THREE.Color(ATMO.glow) }, uSun: { value: sunDir }, uTime: SHARED.time,
    };
    const dg = new THREE.SphereGeometry(1, 28, 14), dm = new THREE.ShaderMaterial({ vertexShader: SKY_VERT, fragmentShader: SKY_FRAG, uniforms: this.uniforms, side: THREE.BackSide, depthWrite: false, fog: false });
    this.dome = new THREE.Mesh(dg, dm);
    this.dome.scale.setScalar(480); this.dome.renderOrder = -1000; this.dome.frustumCulled = false; this.dome.name = 'sky';
    this.parts.push(dg, dm);

    const seed = new Float32Array(flyCount * 4), pos = new Float32Array(flyCount * 3);
    let s = 7;
    const rnd = (): number => (s = (s * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < flyCount * 4; i++) seed[i] = rnd();
    const fg = new THREE.BufferGeometry();
    fg.setAttribute('position', new THREE.BufferAttribute(pos, 3)); fg.setAttribute('seed', new THREE.BufferAttribute(seed, 4));
    const fu = { uTime: SHARED.time, uRadius: { value: 34 }, uSize: { value: 5 }, uPixel: { value: 1 }, uFocus: { value: new THREE.Vector3() } };
    const fm = new THREE.ShaderMaterial({ vertexShader: FLY_VERT, fragmentShader: FLY_FRAG, uniforms: fu, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
    this.flies = new THREE.Points(fg, fm);
    this.flies.frustumCulled = false; this.flies.renderOrder = 4; this.flies.name = 'fireflies';
    this.parts.push(fg, fm);
    scene.add(this.dome, this.flies);
  }

  /** Sets the haze range for a camera `dist` away from the ground it looks at (`menu`: the close hero-select camera). */
  static fogRange(dist: number, menu: boolean): [number, number] {
    return menu ? [26, 190] : [dist * 1.05, dist * 3.1 + 70];
  }

  /** Per frame: the dome follows the camera, the fog range follows the zoom, the fireflies follow the focus. */
  update(dt: number, cam: THREE.Vector3, focus: THREE.Vector3, dist: number, menu: boolean, pixelRatio = 1): void {
    SHARED.time.value += dt;
    this.dome.position.copy(cam);
    const fog = this.scene.fog as THREE.Fog | null;
    if (fog) { const [n, f] = Atmosphere.fogRange(dist, menu); fog.near += (n - fog.near) * Math.min(1, dt * 6 + .02); fog.far += (f - fog.far) * Math.min(1, dt * 6 + .02); }
    const fu = (this.flies.material as THREE.ShaderMaterial).uniforms;
    fu.uFocus.value.copy(focus); fu.uRadius.value = menu ? 14 : Math.min(60, 18 + dist * .45); fu.uPixel.value = pixelRatio;
  }

  setFireflies(on: boolean): void { this.flies.visible = on; }

  /** Draws only the first `n` fireflies (the quality governor). */
  setFireflyCount(n: number): void { this.flies.geometry.setDrawRange(0, Math.max(0, Math.floor(n))); this.flies.visible = n > 0; }

  dispose(): void { this.parts.forEach(p => p.dispose()); this.scene.remove(this.dome, this.flies); }
}
