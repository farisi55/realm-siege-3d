import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { FXAAShader } from 'three/examples/jsm/shaders/FXAAShader.js';
import { app } from '../game/state';
import { rd, sn, cm } from './scene';

/**
 * The picture after the scene is drawn:
 *
 *   RenderPass           the scene, into a multisampled target (MSAA, WebGL2)
 *   UnrealBloomPass      only the brightest, magical things glow (crystals, runes, spell cores); strength and threshold are kept low,
 *                        the picture must never look hazy
 *   FXAA                 only where the target cannot be multisampled (WebGL1)
 *   finish               one cheap full-screen pass: a soft highlight shoulder (bright stone never clips to flat white), a little
 *                        contrast, a touch less saturation, warm highlights and cool shadows, a gentle vignette, and a dither that
 *                        removes banding from the sky and the haze
 *
 * The Bloom setting turns the bloom pass off; the finish pass always runs, so the picture keeps one look. When the composer cannot
 * be built (an old GPU, a stubbed renderer in the tests) the scene is drawn directly and nothing else changes.
 */

export const BLOOM = { strength: .34, radius: .55, threshold: .86 };

/** The finishing pass. Everything is display-referred: no tone mapping or color management is involved, so the grade is a few multiplies. */
export const FinishShader = {
  uniforms: { tDiffuse: { value: null as THREE.Texture | null }, uVignette: { value: .24 }, uGrade: { value: 1 }, uSeed: { value: 0 } },
  vertexShader: `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`,
  fragmentShader: `
uniform sampler2D tDiffuse;
uniform float uVignette, uGrade, uSeed;
varying vec2 vUv;
float h(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233)) + uSeed) * 43758.5453); }
void main() {
  vec3 c = texture2D(tDiffuse, vUv).rgb;
  vec3 g = c;
  vec3 hi = max(g - .86, 0.0);
  g = min(g, vec3(.86)) + .14 * (1.0 - exp(-hi / .14));
  g = (g - .45) * 1.07 + .45;
  float l = dot(g, vec3(.299, .587, .114));
  g = mix(vec3(l), g, .93);
  g += vec3(.022, .011, -.014) * smoothstep(.5, 1.0, l) + vec3(-.01, -.002, .016) * (1.0 - smoothstep(.0, .45, l));
  c = mix(c, g, uGrade);
  float r = length((vUv - .5) * vec2(1.15, 1.0));
  c *= 1.0 - uVignette * smoothstep(.36, .82, r);
  c += (h(gl_FragCoord.xy) + h(gl_FragCoord.xy + 7.1) - 1.0) / 255.0;
  gl_FragColor = vec4(max(c, 0.0), 1.0);
}`,
};

interface Chain { composer: EffectComposer; bloom: UnrealBloomPass; finish: ShaderPass; fxaa: ShaderPass | null; msaa: boolean }
let chain: Chain | null = null;
let failed = false;
/** Set by the quality governor: the lowest level draws no bloom at all. */
let bloomAllowed = true;
let frameNo = 0;

function build(): Chain | null {
  try {
    const w = innerWidth, h = innerHeight, dpr = rd.getPixelRatio();
    const msaa = !!rd.capabilities.isWebGL2;
    const target = msaa ? new THREE.WebGLMultisampleRenderTarget(w * dpr, h * dpr) : undefined;
    const composer = new EffectComposer(rd, target);
    composer.setPixelRatio(dpr); // a supplied target would otherwise keep the composer at one pixel per CSS pixel
    composer.addPass(new RenderPass(sn, cm));
    const bloom = new UnrealBloomPass(new THREE.Vector2(w, h), BLOOM.strength, BLOOM.radius, BLOOM.threshold);
    composer.addPass(bloom);
    let fxaa: ShaderPass | null = null;
    if (!msaa) { fxaa = new ShaderPass(FXAAShader); composer.addPass(fxaa); }
    const finish = new ShaderPass(FinishShader as unknown as THREE.Shader);
    composer.addPass(finish);
    const c = { composer, bloom, finish, fxaa, msaa };
    composer.setSize(w, h);
    syncFxaa(c, w * dpr, h * dpr);
    return c;
  } catch (e) {
    failed = true;
    console.warn('Post-processing unavailable, rendering the scene directly:', e);
    return null;
  }
}

function syncFxaa(c: Chain, pw: number, ph: number): void {
  if (c.fxaa) (c.fxaa.material as THREE.ShaderMaterial).uniforms['resolution'].value.set(1 / pw, 1 / ph);
}

/** Draws one frame: through the composer, or straight to the screen when the composer is not available. */
export function renderFrame(): void {
  if (!failed && !chain) chain = build();
  if (!chain) { rd.render(sn, cm); return; }
  chain.bloom.enabled = app.bloom && bloomAllowed;
  chain.finish.uniforms['uSeed'].value = (++frameNo % 64) * 1.618;
  chain.composer.render();
}

/** The composer follows the window (the canvas size itself is `rsz` in scene.ts). */
export function resizePost(): void {
  if (!chain) return;
  const w = innerWidth, h = innerHeight, dpr = rd.getPixelRatio();
  chain.composer.setPixelRatio(dpr);
  chain.composer.setSize(w, h);
  syncFxaa(chain, w * dpr, h * dpr);
}

/** The quality governor's switch for the bloom pass (on top of the player's Bloom setting). */
export function allowBloom(on: boolean): void { bloomAllowed = on; }

/** What was built, for the settings screen, the tests and the debug console. */
export function postInfo(): { active: boolean; msaa: boolean; fxaa: boolean; bloom: boolean; passes: number } {
  const c = chain;
  return { active: !!c, msaa: !!c?.msaa, fxaa: !!c?.fxaa, bloom: !!c && c.bloom.enabled, passes: c ? c.composer.passes.length : 0 };
}

addEventListener('resize', resizePost);
