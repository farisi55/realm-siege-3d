/**
 * GLSL for the pooled mesh effects (decals, flat rings, light pillars, domes). Plain strings, so they can be unit-tested for structure
 * without a GPU; real compilation is checked in the running game (a shader error shows up as `THREE.WebGLProgram` in the console).
 * Everything is procedural: no texture is sampled, so one program serves every instance of an effect type.
 */

/** Hash / value-noise helpers shared by the fragment shaders (constant loop bounds only: valid in GLSL ES 1.0 too). */
export const NOISE = /* glsl */`
float hash21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float hash31(vec3 p) { p = fract(p * vec3(.1031, .1030, .0973)); p += dot(p, p.yxz + 33.33); return fract((p.x + p.y) * p.z); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f);
  return mix(mix(hash21(i), hash21(i + vec2(1., 0.)), f.x), mix(hash21(i + vec2(0., 1.)), hash21(i + vec2(1., 1.)), f.x), f.y);
}
float vnoise3(vec3 p) {
  vec3 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f);
  float a = mix(mix(hash31(i), hash31(i + vec3(1., 0., 0.)), f.x), mix(hash31(i + vec3(0., 1., 0.)), hash31(i + vec3(1., 1., 0.)), f.x), f.y);
  float b = mix(mix(hash31(i + vec3(0., 0., 1.)), hash31(i + vec3(1., 0., 1.)), f.x), mix(hash31(i + vec3(0., 1., 1.)), hash31(i + vec3(1., 1., 1.)), f.x), f.y);
  return mix(a, b, f.z);
}
float fbm(vec2 p) { float v = 0., a = .5; for (int i = 0; i < 4; i++) { v += a * vnoise(p); p = p * 2.03 + vec2(17.1, 9.2); a *= .5; } return v; }
`;

/**
 * Final colour of every ground-layer shader. With `uSoft` (the layers that add light) the colour is premultiplied, because the blend is
 * "screen" (see `setBlend` in mesh.ts): the light adds less the brighter the surface already is, so stacked layers over bright ground
 * (and the bloom pass behind them) can never burn a hole of pure white. Without it: plain alpha blending (scorch marks).
 */
export const EMIT = /* glsl */`
uniform float uSoft;
void emit(vec3 c, float a) { gl_FragColor = uSoft > .5 ? vec4(c * a, a) : vec4(c, a); }
`;

/** Decal styles (uniform `uStyle`). Keep in sync with `DECAL` in mesh.ts. */
export const DECAL_STYLES = ['aim', 'rune', 'fire', 'poison', 'lightning', 'heal', 'scorch', 'shadow', 'cracks', 'wave'] as const;

export const DECAL_VERT = /* glsl */`
varying vec2 vP;
void main() {
  vP = position.xz;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

/** A disc in the XZ plane (unit radius, `vP` is the position inside it) painted by one of the styles below. */
export const DECAL_FRAG = /* glsl */`
uniform vec3 uColor;
uniform vec3 uColor2;
uniform float uAlpha;
uniform float uT;
uniform float uProg;
uniform float uStyle;
varying vec2 vP;
const float TAU = 6.28318530718;
${NOISE}
${EMIT}
float ringL(float r, float r0, float w) { return smoothstep(w, 0., abs(r - r0)); }
float tri(vec2 p, float rot, float R) {
  float a = atan(p.y, p.x) + rot, k = TAU / 3.;
  float d = cos(floor(.5 + a / k) * k - a) * length(p);
  return smoothstep(.016, 0., abs(d - R * .5));
}
void main() {
  vec2 p = vP;
  float r = length(p);
  if (r > 1.0) discard;
  float a = atan(p.y, p.x);
  vec3 col = uColor;
  float al = 0.;
  if (uStyle < .5) {
    // aim: edge ring, a ring that converges on the centre as uProg goes 0 -> 1, hatching, ticks and a small cross
    float edgeR = ringL(r, .965, .02);
    float conv = ringL(r, mix(1., 0., uProg), .04) * step(uProg, .98);
    float fill = smoothstep(0., 1., r) * .15 + .03;
    float stripes = step(.5, fract((p.x + p.y) * 5. - uT * .6)) * .06 * smoothstep(.2, .9, r);
    float tick = step(.5, fract(a / TAU * 36. + uT * .15)) * ringL(r, .9, .035) * .6;
    float cross = (smoothstep(.02, 0., abs(p.x)) * smoothstep(.12, .05, abs(p.y)) + smoothstep(.02, 0., abs(p.y)) * smoothstep(.12, .05, abs(p.x))) * .8;
    al = edgeR + conv * .9 + fill + stripes + tick + cross;
    col = mix(uColor, vec3(1.), edgeR * .5 + conv * .4);
  } else if (uStyle < 1.5) {
    // rune: concentric rings, rotating dashes and two counter-rotating hexagrams
    float aa = a + uT * .25;
    float rings = ringL(r, .965, .014) + ringL(r, .8, .009) * .7 + ringL(r, .56, .009) * .5 + ringL(r, .2, .011) * .6;
    float segs = floor(aa / TAU * 28.);
    float dash = step(.38, hash21(vec2(segs, 3.))) * ringL(r, .885, .055) * (.6 + .4 * sin(uT * 2. + segs));
    float star = max(tri(p, uT * .5, .56), tri(p, uT * .5 + TAU / 6., .56)) * .8 * step(r, .6);
    float star2 = max(tri(p, -uT * .35, .8), tri(p, -uT * .35 + TAU / 6., .8)) * .45 * step(r, .83);
    float glow = exp(-r * r * 3.) * .14 + smoothstep(1., .75, r) * .035;
    al = rings + dash * .8 + star + star2 + glow;
    col = mix(uColor, uColor2, smoothstep(.3, .95, r)) + vec3(.25) * rings * .5;
  } else if (uStyle < 2.5) {
    // fire: noisy flame field, hotter in the middle, flickering rim
    vec2 q = p * 2.4 + vec2(0., -uT * 1.1);
    float n = fbm(q) * .65 + fbm(q * 2.1 + 3.7 - uT * .5) * .35;
    float heat = n * (1.15 - r * .5) + .15 * (1. - r) - .25;
    float body = smoothstep(.12, .55, heat) * smoothstep(1., .72, r);
    vec3 em = mix(vec3(.9, .1, .02), uColor, smoothstep(.1, .5, heat));
    em = mix(em, uColor2, smoothstep(.45, .9, heat));
    float rim = ringL(r, .94 - n * .06, .045) * (.6 + .6 * n);
    al = body * 1.1 + rim * .8;
    col = em;
  } else if (uStyle < 3.5) {
    // poison / swamp: slow toxic swirl with rising bubbles
    vec2 q = p * 3. + vec2(uT * .25, uT * .18);
    float n = fbm(q + fbm(q * 1.7 + uT * .2));
    float body = smoothstep(.25, .7, n) * smoothstep(1., .6, r);
    float bub = smoothstep(.86, .93, vnoise(p * 9. + vec2(0., -uT * .9))) * smoothstep(1., .5, r);
    float rim = ringL(r, .95, .03) * .7;
    al = body * .75 + bub * .8 + rim;
    col = mix(uColor, uColor2, clamp(n * 1.2 + bub * .6, 0., 1.));
  } else if (uStyle < 4.5) {
    // lightning: a field of electric veins that re-rolls 16 times a second
    float ph = floor(uT * 16.);
    vec2 q = p * 4.2 + vec2(ph * 1.7, ph * .9);
    float e = abs(fbm(q) - .5);
    float veins = smoothstep(.05, 0., e) * smoothstep(1., .25, r);
    float rays = smoothstep(.05, 0., abs(fbm(vec2(a * 3., r * 2. + ph)) - .5)) * smoothstep(.1, .8, r) * smoothstep(1., .85, r);
    float glow = exp(-r * r * 2.2) * .12;
    float edgeR = ringL(r, .95, .02) * (.5 + .5 * step(.5, hash21(vec2(floor(a * 30.), ph))));
    al = veins * 1.1 + rays * .7 + glow + edgeR;
    col = mix(uColor, vec3(1.), veins * .7);
  } else if (uStyle < 5.5) {
    // heal: rising plus signs, a soft glow and a wave that keeps leaving the centre
    vec2 u = p * 3.2 + vec2(0., -uT * .35);
    vec2 g = fract(u) - .5;
    float plus = max(smoothstep(.09, .05, abs(g.x)) * smoothstep(.3, .22, abs(g.y)), smoothstep(.09, .05, abs(g.y)) * smoothstep(.3, .22, abs(g.x)));
    plus *= step(.45, hash21(floor(u))) * smoothstep(1., .5, r);
    float ph = fract(uT * .6);
    float wave = ringL(r, ph, .06) * (1. - ph);
    float edgeR = ringL(r, .955, .02);
    al = plus * .85 + exp(-r * r * 2.6) * .22 + wave * .5 + edgeR * .7;
    col = mix(uColor, uColor2, clamp(plus + edgeR * .5, 0., 1.));
  } else if (uStyle < 6.5) {
    // scorch: a burnt patch (normal blending) whose cracks glow and cool down as uProg goes 0 -> 1
    float n = fbm(p * 3.1 + 7.);
    float m = smoothstep(.92 + (n - .5) * .5, .15, r);
    float cr = smoothstep(.05, 0., abs(fbm(p * 7. + 2.) - .5)) * smoothstep(1., .2, r) * (1. - uProg);
    col = mix(vec3(.04, .03, .03), uColor, cr * .9);
    al = m * .6 + cr * .5;
  } else if (uStyle < 7.5) {
    // shadow: dark vortex with spiral arms and a bright rim
    float sw = a * 3. + r * 5. - uT * 2.2;
    float arms = smoothstep(.3, .9, sin(sw) * .5 + .5);
    float body = arms * smoothstep(1., .35, r) * (.4 + .6 * r) + exp(-r * r * 8.) * .5;
    float rim = ringL(r, .955, .02);
    al = body * .8 + rim * .9;
    col = mix(uColor, uColor2, clamp(arms * .6 + rim, 0., 1.));
  } else if (uStyle < 8.5) {
    // cracks: glowing fissures radiating from the centre
    float an = a + (fbm(p * 3.5) - .5) * 1.5;
    float rays = abs(sin(an * 4.5));
    float crack = smoothstep(.16, 0., rays * (.25 + r)) * smoothstep(1., .15, r);
    float front = ringL(r, mix(.1, 1., uProg), .05) * (1. - uProg);
    al = crack * (1.1 - uProg * .6) + front * .6 + exp(-r * r * 6.) * (1. - uProg) * .28;
    col = mix(uColor, uColor2, crack);
  } else {
    // wave: a shock ring that races to the edge (uProg 0 -> 1) with a glowing trail behind it
    float fr = 1. - pow(1. - uProg, 2.2);
    float w = mix(.07, .02, uProg);
    float front = ringL(r, fr, w);
    float halo = exp(-abs(r - fr) * 9.) * .2;
    float trail = r < fr ? exp((r - fr) * 7.) * .3 : 0.;
    al = (front * 1.1 + halo + trail) * smoothstep(1.01, .9, r);
    col = mix(uColor, vec3(1.), front * .5);
  }
  emit(col, clamp(al, 0., 1.) * uAlpha);
}`;

export const RING_VERT = /* glsl */`
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

/** A flat ring (quad scaled to the ring's radius): `uR` is the ring radius and `uW` its half width, both as fractions of the half size. */
export const RING_FRAG = /* glsl */`
uniform vec3 uColor;
uniform float uAlpha;
uniform float uR;
uniform float uW;
uniform float uTrail;
uniform float uDash;
uniform float uT;
varying vec2 vUv;
const float TAU = 6.28318530718;
${EMIT}
void main() {
  vec2 p = vUv * 2. - 1.;
  float r = length(p), d = r - uR;
  float edge = smoothstep(uW, 0., abs(d));
  float glow = exp(-abs(d) * 5. / max(uW, .02)) * .3;
  float trail = d < 0. ? exp(d * uTrail) * .4 : 0.;
  float a = (edge + glow + trail) * smoothstep(1., .9, r);
  if (uDash > .5) a *= .45 + .55 * step(.5, fract(atan(p.y, p.x) / TAU * uDash + uT * 2.));
  emit(uColor * (1. + edge * .8), a * uAlpha);
}`;

export const PILLAR_VERT = /* glsl */`
varying vec2 vUv;
varying vec3 vN;
varying vec3 vV;
void main() {
  vUv = uv;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vV = mv.xyz;
  vN = normalMatrix * normal;
  gl_Position = projectionMatrix * mv;
}`;

/** An open cylinder of light: brightest at the foot, soft at the silhouette, streaks scrolling upwards. `uCut` is the visible height (0..1). */
export const PILLAR_FRAG = /* glsl */`
uniform vec3 uColor;
uniform vec3 uColor2;
uniform float uAlpha;
uniform float uT;
uniform float uCut;
varying vec2 vUv;
varying vec3 vN;
varying vec3 vV;
${NOISE}
${EMIT}
void main() {
  float fres = abs(dot(normalize(vN), normalize(-vV)));
  float v = vUv.y;
  float a = pow(1. - v, 1.25) * smoothstep(0., .04, v) * smoothstep(uCut, uCut - .18, v);
  float n = vnoise(vec2(vUv.x * 16., v * 3. - uT * 1.8));
  a *= (.55 + .9 * n) * pow(fres, 1.3);
  a += pow(1. - v, 6.) * .25 * fres;
  emit(mix(uColor, uColor2, v * .8 + n * .2), clamp(a, 0., 1.) * uAlpha);
}`;

/** Shared by dome / fireball. */
export const DOME_VERT = /* glsl */`
varying vec3 vN;
varying vec3 vV;
varying vec3 vO;
void main() {
  vO = position;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vV = mv.xyz;
  vN = normalMatrix * normal;
  gl_Position = projectionMatrix * mv;
}`;

/** A sphere shell. Style 0: energy shield (fresnel rim and a faint lattice). Style 1: turbulent fireball. `uProg` runs 0 -> 1 over the effect. */
export const DOME_FRAG = /* glsl */`
uniform vec3 uColor;
uniform vec3 uColor2;
uniform float uAlpha;
uniform float uT;
uniform float uProg;
uniform float uStyle;
varying vec3 vN;
varying vec3 vV;
varying vec3 vO;
${NOISE}
${EMIT}
void main() {
  vec3 n = normalize(vN), v = normalize(-vV);
  float fres = 1. - abs(dot(n, v));
  vec3 col = uColor;
  float al = 0.;
  if (uStyle < .5) {
    float rim = pow(fres, 2.4);
    vec3 g = abs(fract(vO * 5.) - .5);
    float lat = smoothstep(.06, 0., min(min(g.x, g.y), g.z)) * .35 * (.4 + .6 * fres);
    float sweep = smoothstep(.12, 0., abs(vO.y - (fract(uT * .5) * 2. - 1.))) * .35;
    al = rim * .9 + lat + sweep + .06 * smoothstep(-1., 1., vO.y);
    col = mix(uColor, uColor2, rim);
  } else {
    float n3 = vnoise3(vO * 2.6 + vec3(0., -uT * 3., 0.)) * .6 + vnoise3(vO * 5.2 - uT * 2.) * .4;
    float heat = clamp(n3 * 1.4 - uProg * .7 + (1. - fres) * .45, 0., 1.);
    col = mix(uColor, uColor2, smoothstep(.35, .85, heat));
    col = mix(vec3(.5, .08, .02), col, smoothstep(.05, .5, heat));
    al = (.35 + heat * .9) * (1. - uProg * .5) * (.4 + .6 * (1. - fres * .6));
  }
  emit(col, clamp(al, 0., 1.) * uAlpha);
}`;
