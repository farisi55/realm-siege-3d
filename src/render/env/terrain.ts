import * as THREE from 'three';
import { K } from '../../game/config';
import { RING, STAGE, WORLD, terrainAt } from './height';
import { BOSS_PIT, SHRINES, SPRING, TEAM_COLOR } from './layout';
import { fbm, mix, smooth } from './rand';
import { MAGIC } from './palette';
import { SHARED } from './shared';

/**
 * The ground as meshes: the playfield (one grid that carries the shape; the colors come from the painted texture) and the ring of
 * hills around it (four strips that carry their colors in the vertices, fading into the haze at the far edge).
 */

// ---------------------------------------------------------------------------------------------------------------- geometry (pure)

/** The playfield: `(n + 1)^2` vertices over the map, uv = position / WORLD, normals from the height grid. */
export function innerGeometry(hg: Float32Array, n: number): THREE.BufferGeometry {
  const stride = n + 1, step = WORLD / n, V = stride * stride;
  const pos = new Float32Array(V * 3), nor = new Float32Array(V * 3), uv = new Float32Array(V * 2), idx = new Uint16Array(n * n * 6);
  for (let iz = 0; iz <= n; iz++) {
    for (let ix = 0; ix <= n; ix++) {
      const i = iz * stride + ix;
      pos[i * 3] = ix * step; pos[i * 3 + 1] = hg[i]; pos[i * 3 + 2] = iz * step;
      uv[i * 2] = ix / n; uv[i * 2 + 1] = iz / n;
      const hx0 = hg[iz * stride + Math.max(0, ix - 1)], hx1 = hg[iz * stride + Math.min(n, ix + 1)], hz0 = hg[Math.max(0, iz - 1) * stride + ix], hz1 = hg[Math.min(n, iz + 1) * stride + ix];
      const nx = (hx0 - hx1) / ((Math.min(n, ix + 1) - Math.max(0, ix - 1)) * step), nz = (hz0 - hz1) / ((Math.min(n, iz + 1) - Math.max(0, iz - 1)) * step), l = Math.hypot(nx, 1, nz);
      nor[i * 3] = nx / l; nor[i * 3 + 1] = 1 / l; nor[i * 3 + 2] = nz / l;
    }
  }
  let k = 0;
  for (let iz = 0; iz < n; iz++) {
    for (let ix = 0; ix < n; ix++) {
      const a = iz * stride + ix, b = a + 1, c = a + stride, d = c + 1;
      if ((ix + iz) & 1) { idx[k++] = a; idx[k++] = c; idx[k++] = b; idx[k++] = b; idx[k++] = c; idx[k++] = d; }
      else { idx[k++] = a; idx[k++] = c; idx[k++] = d; idx[k++] = a; idx[k++] = d; idx[k++] = b; }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.BufferAttribute(nor, 3)); g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  return g;
}

/** Colors of the hill ring. `edge` is the playfield's own color at the nearest border point, so the two meet without a seam. */
const FOREST = [.12, .29, .19], MOSS = [.2, .38, .21], DRY = [.3, .32, .2], ROCK = [.36, .39, .47], GLADE = [.19, .4, .21];
export function ringColor(u: number, v: number, h: number, ny: number, out: number[], o: number, edge: number[], outside: number): void {
  const n1 = fbm(u * .06, v * .06, 21, 3), n2 = fbm(u * .3 + 5, v * .3 - 2, 22, 2);
  let r = FOREST[0], g = FOREST[1], b = FOREST[2];
  const m = smooth(.35, .75, n1) * .7; r = mix(r, MOSS[0], m); g = mix(g, MOSS[1], m); b = mix(b, MOSS[2], m);
  const dr = smooth(.62, .85, n2) * .35; r = mix(r, DRY[0], dr); g = mix(g, DRY[1], dr); b = mix(b, DRY[2], dr);
  const rk = Math.max(smooth(9, 16, h) * .7, smooth(.3, .12, ny) * .9);
  r = mix(r, ROCK[0], rk); g = mix(g, ROCK[1], rk); b = mix(b, ROCK[2], rk);
  const gl = 1 - smooth(STAGE.flat, STAGE.edge + 8, Math.hypot(u - STAGE.x, v - STAGE.z)); // the glade round the hero-select pedestal
  r = mix(r, GLADE[0], gl); g = mix(g, GLADE[1], gl); b = mix(b, GLADE[2], gl);
  const s = 1 - smooth(0, 14, outside);
  out[o] = mix(r, edge[0], s); out[o + 1] = mix(g, edge[1], s); out[o + 2] = mix(b, edge[2], s);
}

export interface RingData {
  /** Strips as typed arrays: positions, normals, colors, indices (the mesh builder wraps them). */
  strips: { pos: Float32Array; nor: Float32Array; col: Float32Array; idx: Uint16Array }[];
}

/**
 * The hills round the map as four strips (north, south, west, east) cut from one grid, so normals and heights agree across the joins.
 * `step`: world units between vertices. `edgeColor(u, v, out)` gives the playfield color at a border point.
 */
export function ringData(step: number, edgeColor: (u: number, v: number, out: number[]) => void): RingData {
  const cells = Math.round((WORLD + RING * 2) / step), stride = cells + 1, o0 = -RING;
  const H = new Float32Array(stride * stride);
  for (let iz = 0; iz < stride; iz++) for (let ix = 0; ix < stride; ix++) H[iz * stride + ix] = terrainAt(o0 + ix * step, o0 + iz * step);
  const strips: RingData['strips'] = [], edge = [0, 0, 0], tmp = [0, 0, 0];
  // strip bounds in grid cells: [x0, x1) x [z0, z1)
  const a = Math.round(RING / step), b = Math.round((RING + WORLD) / step);
  const bounds = [[0, cells, 0, a], [0, cells, b, cells], [0, a, a, b], [b, cells, a, b]];
  for (const [x0, x1, z0, z1] of bounds) {
    const w = x1 - x0 + 1, h = z1 - z0 + 1, V = w * h, pos = new Float32Array(V * 3), nor = new Float32Array(V * 3), col = new Float32Array(V * 3), idx = new Uint16Array((w - 1) * (h - 1) * 6);
    for (let j = 0; j < h; j++) {
      for (let i = 0; i < w; i++) {
        const gx = x0 + i, gz = z0 + j, u = o0 + gx * step, v = o0 + gz * step, y = H[gz * stride + gx], o = (j * w + i) * 3;
        const hx0 = H[gz * stride + Math.max(0, gx - 1)], hx1 = H[gz * stride + Math.min(cells, gx + 1)], hz0 = H[Math.max(0, gz - 1) * stride + gx], hz1 = H[Math.min(cells, gz + 1) * stride + gx];
        const nx = (hx0 - hx1) / ((Math.min(cells, gx + 1) - Math.max(0, gx - 1)) * step), nz = (hz0 - hz1) / ((Math.min(cells, gz + 1) - Math.max(0, gz - 1)) * step), l = Math.hypot(nx, 1, nz);
        pos[o] = u; pos[o + 1] = y; pos[o + 2] = v;
        nor[o] = nx / l; nor[o + 1] = 1 / l; nor[o + 2] = nz / l;
        edgeColor(u, v, edge);
        const outside = Math.hypot(Math.max(0, -u, u - WORLD), Math.max(0, -v, v - WORLD));
        ringColor(u, v, y, 1 / l, tmp, 0, edge, outside);
        col[o] = tmp[0]; col[o + 1] = tmp[1]; col[o + 2] = tmp[2];
      }
    }
    let k = 0;
    for (let j = 0; j < h - 1; j++) for (let i = 0; i < w - 1; i++) {
      const p = j * w + i, q = p + 1, r = p + w, s = r + 1;
      if ((i + j) & 1) { idx[k++] = p; idx[k++] = r; idx[k++] = q; idx[k++] = q; idx[k++] = r; idx[k++] = s; }
      else { idx[k++] = p; idx[k++] = r; idx[k++] = s; idx[k++] = p; idx[k++] = s; idx[k++] = q; }
    }
    strips.push({ pos, nor, col, idx });
  }
  return { strips };
}

// ---------------------------------------------------------------------------------------------------------------- materials

const hex = (c: number): THREE.Color => new THREE.Color(c);
const world = (p: { x: number; y: number }): THREE.Vector2 => new THREE.Vector2(p.x * K, p.y * K);

/**
 * The playfield material: a standard lit material whose albedo is the painted texture. The patch adds two octaves of fine detail so
 * the ground never looks like a stretched picture up close, and makes the painted rune lines (alpha) glow in the color of their
 * region: team colors on each side's plaza and pads, violet in the boss arena, gold at the shrines, cyan at the spring.
 */
export function playfieldMaterial(splat: THREE.Texture, detail: THREE.Texture): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ map: splat, roughness: .96, metalness: 0 });
  m.onBeforeCompile = (s: any) => {
    s.uniforms.uDetail = { value: detail };
    s.uniforms.uTime = SHARED.time; s.uniforms.uRune = SHARED.rune;
    s.uniforms.uTeam0 = { value: hex(TEAM_COLOR[0]) }; s.uniforms.uTeam1 = { value: hex(TEAM_COLOR[1]) };
    s.uniforms.uCyan = { value: hex(MAGIC.cyan) }; s.uniforms.uViolet = { value: hex(MAGIC.violet) }; s.uniforms.uGold = { value: hex(MAGIC.gold) };
    s.uniforms.uArena = { value: world(BOSS_PIT) }; s.uniforms.uSpring = { value: world(SPRING) };
    s.uniforms.uShrines = { value: new THREE.Vector2(SHRINES.reduce((a, p) => a + p.x, 0) / SHRINES.length * K, SHRINES.reduce((a, p) => a + p.y, 0) / SHRINES.length * K) };
    s.vertexShader = s.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vTP;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvTP = position;');
    s.fragmentShader = s.fragmentShader
      .replace('#include <common>', `#include <common>
varying vec3 vTP;
uniform sampler2D uDetail; uniform float uTime, uRune;
uniform vec3 uTeam0, uTeam1, uCyan, uViolet, uGold; uniform vec2 uArena, uSpring, uShrines;
vec3 runeTint(vec2 p) {
  vec3 c = mix(uTeam1, uTeam0, step(p.x, p.y));
  c = mix(c, uViolet, 1.0 - smoothstep(9.0, 11.0, distance(p, uArena)));
  c = mix(c, uGold, 1.0 - smoothstep(19.0, 21.0, distance(p, uShrines)));
  return mix(c, uCyan, 1.0 - smoothstep(8.0, 10.0, distance(p, uSpring)));
}`)
      .replace('#include <map_fragment>', `#include <map_fragment>
float rune = texelColor.a; diffuseColor.a = 1.0;
float dA = texture2D(uDetail, vTP.xz * .31).r, dB = texture2D(uDetail, vTP.xz * .047 + .37).r;
diffuseColor.rgb *= (.8 + .4 * dA) * (.9 + .2 * dB);`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
totalEmissiveRadiance += runeTint(vTP.xz) * rune * uRune * (.8 + .2 * sin(uTime * 1.7 + vTP.x * .35 + vTP.z * .27)) * 1.15;`);
  };
  return m;
}

/** The hill ring: vertex colors, and the far edge dissolves into the haze (so there is no cliff at the end of the world). */
export function ringMaterial(detail: THREE.Texture): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .97, metalness: 0 });
  m.onBeforeCompile = (s: any) => {
    s.uniforms.uHaze = SHARED.haze; s.uniforms.uDetail = { value: detail };
    s.vertexShader = s.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vTP;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvTP = position;');
    s.fragmentShader = s.fragmentShader
      .replace('#include <common>', `#include <common>
varying vec3 vTP;
uniform vec3 uHaze; uniform sampler2D uDetail;`)
      .replace('#include <color_fragment>', `#include <color_fragment>
float dA = texture2D(uDetail, vTP.xz * .23).r, dB = texture2D(uDetail, vTP.xz * .037 + .21).r;
diffuseColor.rgb *= (.72 + .56 * dA) * (.85 + .3 * dB);`)
      .replace('#include <fog_fragment>', `#include <fog_fragment>
float outside = length(vec2(max(0.0, max(-vTP.x, vTP.x - ${WORLD.toFixed(1)})), max(0.0, max(-vTP.z, vTP.z - ${WORLD.toFixed(1)}))));
gl_FragColor.rgb = mix(gl_FragColor.rgb, uHaze, smoothstep(${(RING * .28).toFixed(1)}, ${(RING * .98).toFixed(1)}, outside));`);
  };
  return m;
}

// ---------------------------------------------------------------------------------------------------------------- the terrain object

export interface Terrain {
  group: THREE.Group;
  playfield: THREE.Mesh;
  ring: THREE.Mesh[];
  dispose(): void;
}

export function buildTerrain(o: { hg: Float32Array; n: number; splat: THREE.Texture; detail: THREE.Texture; pixels: Uint8Array; size: number; ringStep: number }): Terrain {
  const group = new THREE.Group(), geos: THREE.BufferGeometry[] = [], mats: THREE.Material[] = [];
  const pm = playfieldMaterial(o.splat, o.detail), rm = ringMaterial(o.detail);
  mats.push(pm, rm);
  const pg = innerGeometry(o.hg, o.n);
  geos.push(pg);
  const playfield = new THREE.Mesh(pg, pm);
  playfield.receiveShadow = true; playfield.name = 'terrain';
  group.add(playfield);

  // playfield color at the map border for the ring's seam (average of a small block)
  const N = o.size, px = o.pixels, pw = WORLD / N;
  const edgeColor = (u: number, v: number, out: number[]): void => {
    const cx = Math.min(N - 2, Math.max(1, Math.floor(Math.min(WORLD - .001, Math.max(0, u)) / pw))), cy = Math.min(N - 2, Math.max(1, Math.floor(Math.min(WORLD - .001, Math.max(0, v)) / pw)));
    let r = 0, g = 0, b = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const i = ((cy + dy) * N + cx + dx) * 4; r += px[i]; g += px[i + 1]; b += px[i + 2]; }
    out[0] = r / 2295; out[1] = g / 2295; out[2] = b / 2295;
  };
  const ring = ringData(o.ringStep, edgeColor), meshes: THREE.Mesh[] = [];
  for (const s of ring.strips) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(s.pos, 3)); g.setAttribute('normal', new THREE.BufferAttribute(s.nor, 3)); g.setAttribute('color', new THREE.BufferAttribute(s.col, 3));
    g.setIndex(new THREE.BufferAttribute(s.idx, 1));
    geos.push(g);
    const mesh = new THREE.Mesh(g, rm);
    mesh.receiveShadow = true; mesh.name = 'ring';
    meshes.push(mesh); group.add(mesh);
  }
  return { group, playfield, ring: meshes, dispose() { geos.forEach(g => g.dispose()); mats.forEach(m => m.dispose()); group.parent?.remove(group); } };
}
