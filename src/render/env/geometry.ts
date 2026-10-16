import * as THREE from 'three';
import { mulberry32 } from './rand';

/**
 * Plant, rock and crystal shapes, built once from a few primitives into single vertex-colored geometries (no textures, no
 * per-species materials: the color is in the vertices, darker at the base and lighter at the tips, which also gives a cheap
 * ambient-occlusion look). Every species is one `BufferGeometry` that thousands of instances share.
 */

export type Rgb = [number, number, number];
export const c3 = (hex: number): Rgb => [(hex >> 16 & 255) / 255, (hex >> 8 & 255) / 255, (hex & 255) / 255];
export const lerp3 = (a: Rgb, b: Rgb, t: number): Rgb => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
/** Color function of the final position: from `a` at height `y0` to `b` at `y1`. */
export const ramp = (y0: number, y1: number, a: number, b: number): ColorFn => { const A = c3(a), B = c3(b); return (_x, y) => lerp3(A, B, Math.min(1, Math.max(0, (y - y0) / (y1 - y0)))); };
export type ColorFn = (x: number, y: number, z: number, ny: number) => Rgb;

/** Collects transformed, colored primitives into one geometry. Everything is expanded (no index) so faces can be flat. */
export class GeoBuilder {
  private pos: number[] = []; private nor: number[] = []; private col: number[] = [];
  private v = new THREE.Vector3(); private n = new THREE.Vector3(); private nm = new THREE.Matrix3();

  /** `flat`: faceted normals (low-poly look); otherwise the primitive's own (smooth) normals. */
  add(g: THREE.BufferGeometry, m: THREE.Matrix4, color: ColorFn, flat = true): this {
    const ng = g.index ? g.toNonIndexed() : g.clone();
    if (flat) ng.computeVertexNormals();
    this.nm.getNormalMatrix(m);
    const p = ng.attributes.position, nn = ng.attributes.normal;
    for (let i = 0; i < p.count; i++) {
      this.v.fromBufferAttribute(p, i).applyMatrix4(m);
      this.n.fromBufferAttribute(nn, i).applyMatrix3(this.nm).normalize();
      const c = color(this.v.x, this.v.y, this.v.z, this.n.y);
      this.pos.push(this.v.x, this.v.y, this.v.z); this.nor.push(this.n.x, this.n.y, this.n.z); this.col.push(c[0], c[1], c[2]);
    }
    ng.dispose();
    return this;
  }

  /** A flat polygon (triangle fan over `pts`, counter-clockwise seen from +y) with its own colors per point. */
  fan(pts: [number, number, number][], cols: Rgb[], normal: [number, number, number] = [0, 1, 0]): this {
    for (let i = 1; i < pts.length - 1; i++) for (const k of [0, i, i + 1]) { this.pos.push(...pts[k]); this.nor.push(...normal); this.col.push(...cols[k]); }
    return this;
  }

  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    return g;
  }
}

const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), E = new THREE.Euler(), S = new THREE.Vector3(), P = new THREE.Vector3();
export const place = (x: number, y: number, z: number, sx = 1, sy = sx, sz = sx, rx = 0, ry = 0, rz = 0): THREE.Matrix4 => M.compose(P.set(x, y, z), Q.setFromEuler(E.set(rx, ry, rz)), S.set(sx, sy, sz)).clone();

export const cyl = (rt: number, rb: number, h: number, seg: number): THREE.BufferGeometry => new THREE.CylinderGeometry(rt, rb, h, seg, 1);
export const cone = (r: number, h: number, seg: number): THREE.BufferGeometry => new THREE.ConeGeometry(r, h, seg, 1);
export const ico = (r: number, detail: number): THREE.BufferGeometry => new THREE.IcosahedronGeometry(r, detail);
export const box = (w: number, h: number, d: number): THREE.BufferGeometry => new THREE.BoxGeometry(w, h, d);
const QA = new THREE.Quaternion(), AX = new THREE.Vector3();
/** A transform that turns by `angle` about the axis (ax, ay, az) and moves to (x, y, z). */
export const placeAxis = (x: number, y: number, z: number, ax: number, ay: number, az: number, angle: number, sx = 1, sy = sx, sz = sx): THREE.Matrix4 => M.compose(P.set(x, y, z), QA.setFromAxisAngle(AX.set(ax, ay, az).normalize(), angle), S.set(sx, sy, sz)).clone();

const BARK = ramp(0, 2.2, 0x4a3524, 0x6b4d36);

/** Conifer: trunk and four stacked cones, each darker at the bottom. `low`: fewer sides, for the far ring. Height about 5.4. */
export function pine(low = false): THREE.BufferGeometry {
  const seg = low ? 5 : 7, b = new GeoBuilder();
  b.add(cyl(.14, .22, 1.5, low ? 4 : 6), place(0, .75, 0), BARK);
  const layers: [number, number, number][] = [[1.3, 2.1, 2.4], [1.05, 1.9, 3.3], [.78, 1.7, 4.2], [.45, 1.2, 5.0]];
  for (const [r, h, y] of layers.slice(0, low ? 3 : 4)) b.add(cone(r, h, seg), place(0, y, 0, 1, 1, 1, 0, y * 1.7), ramp(y - h / 2, y + h / 2, 0x1b4630, 0x3e8a52));
  return b.build();
}

/** Broadleaf tree: short trunk, a cluster of faceted blobs, lighter on top. Height about 5.2. */
export function oak(low = false): THREE.BufferGeometry {
  const d = low ? 0 : 1, b = new GeoBuilder();
  b.add(cyl(.2, .32, 2.3, low ? 5 : 6), place(0, 1.15, 0), BARK);
  const blobs: [number, number, number, number][] = [[0, 3.5, 0, 1.55], [.95, 3.2, .45, 1.1], [-.85, 3.1, -.5, 1.05], [.1, 4.4, -.2, 1.0]];
  for (const [x, y, z, r] of blobs.slice(0, low ? 3 : 4)) b.add(ico(r, d), place(x, y, z, 1, .88, 1, 0, x * 3), ramp(y - r, y + r, 0x28602f, 0x62a54a));
  return b.build();
}

/** Tall jungle tree: a slim trunk and a broad flat crown that overhangs the ground. Height about 5.6. */
export function jungle(): THREE.BufferGeometry {
  const b = new GeoBuilder();
  b.add(cyl(.2, .38, 4.0, 6), place(0, 2, 0), ramp(0, 4, 0x3d2c20, 0x5a4332));
  b.add(ico(2.4, 1), place(0, 4.5, 0, 1, .5, 1), ramp(3.9, 5.5, 0x144e3a, 0x2f8a5c));
  for (const [x, z, r] of [[1.7, .6, 1.2], [-1.4, 1.1, 1.1], [-.2, -1.7, 1.15]] as const) b.add(ico(r, 1), place(x, 4.0, z, 1, .6, 1), ramp(3.4, 4.8, 0x124634, 0x2a7c52));
  b.add(cone(.45, 1.6, 5), place(0, 5.5, 0), ramp(5, 6.3, 0x1c6a48, 0x3a9a68));
  return b.build();
}

/** Round bush: three small blobs. Height about .9. */
export function bush(): THREE.BufferGeometry {
  const b = new GeoBuilder();
  for (const [x, y, z, r] of [[0, .4, 0, .58], [.45, .3, .2, .42], [-.38, .3, -.18, .4]] as const) b.add(ico(r, 0), place(x, y, z, 1, .85, 1, 0, x * 5), ramp(y - r, y + r, 0x255d31, 0x5aa447));
  return b.build();
}

/** Fan of curved leaves. Smooth normals pointing up so it lights evenly. Height about .8. Draw double-sided. */
export function fern(): THREE.BufferGeometry {
  const rnd = mulberry32(5), b = new GeoBuilder(), n = 9;
  for (let i = 0; i < n; i++) {
    const a = i / n * Math.PI * 2 + rnd() * .5, len = .75 + rnd() * .35, lift = .35 + rnd() * .25, w = .13 + rnd() * .05, ca = Math.cos(a), sa = Math.sin(a);
    const pt = (t: number): [number, number, number] => [ca * len * t, Math.sin(t * Math.PI * .55) * lift * (1 - t * .3) + .02, sa * len * t];
    const rows = [0, .35, .7, 1].map(pt), widths = [w * .5, w, w * .8, 0];
    const cols: Rgb[] = [c3(0x1b4a2b), c3(0x2d6e3a), c3(0x468d4a), c3(0x66b45a)];
    for (let k = 0; k < 3; k++) {
      const [x0, y0, z0] = rows[k], [x1, y1, z1] = rows[k + 1], w0 = widths[k], w1 = widths[k + 1];
      const px = -sa, pz = ca; // perpendicular, horizontal
      const A: [number, number, number] = [x0 + px * w0, y0, z0 + pz * w0], B: [number, number, number] = [x0 - px * w0, y0, z0 - pz * w0], C: [number, number, number] = [x1 - px * w1, y1, z1 - pz * w1], D: [number, number, number] = [x1 + px * w1, y1, z1 + pz * w1];
      b.fan([A, D, C, B].reverse() as [number, number, number][], [cols[k], cols[k + 1], cols[k + 1], cols[k]]);
    }
  }
  return b.build();
}

/** A clump of grass blades: tapered, bent a little, dark at the root and bright at the tip. Height about .55 to .9. Draw double-sided. */
export function grass(): THREE.BufferGeometry {
  const rnd = mulberry32(9), b = new GeoBuilder(), n = 7;
  for (let i = 0; i < n; i++) {
    const a = rnd() * Math.PI * 2, r = rnd() * .22, h = .5 + rnd() * .42, w = .055 + rnd() * .03, bend = .1 + rnd() * .22, ba = rnd() * Math.PI * 2;
    const ox = Math.cos(a) * r, oz = Math.sin(a) * r, dx = Math.cos(ba) * bend, dz = Math.sin(ba) * bend, px = -Math.sin(ba), pz = Math.cos(ba);
    const root = c3(0x1c4a24), mid = c3(0x3d8a38), tip = c3(0x8cc85c);
    const p0: [number, number, number] = [ox + px * w, 0, oz + pz * w], p1: [number, number, number] = [ox - px * w, 0, oz - pz * w];
    const p2: [number, number, number] = [ox + dx * .35 + px * w * .7, h * .55, oz + dz * .35 + pz * w * .7], p3: [number, number, number] = [ox + dx * .35 - px * w * .7, h * .55, oz + dz * .35 - pz * w * .7];
    const p4: [number, number, number] = [ox + dx, h, oz + dz];
    b.fan([p1, p0, p2, p3], [root, root, mid, mid]);
    b.fan([p3, p2, p4], [mid, mid, tip]);
  }
  return b.build();
}

/** Three stems with small six-petal flower heads in different colors. Height about .7. Draw double-sided. */
export function flowers(): THREE.BufferGeometry {
  const b = new GeoBuilder(), heads: [number, number, number, number, number][] = [[0, 0, .62, 0xfff2c8, 0xffc94a], [.28, .12, .5, 0xff9ac8, 0xff5c9a], [-.22, .2, .56, 0xc9a8ff, 0x8a62ff]];
  heads.forEach(([x, z, h, petal, center], k) => {
    const g = c3(0x2c6a30), g2 = c3(0x58a048), w = .02;
    b.fan([[x - w, 0, z], [x + w, 0, z], [x + w, h, z], [x - w, h, z]], [c3(0x1c4a24), c3(0x1c4a24), g2, g2]);
    b.fan([[x, 0, z - w], [x, 0, z + w], [x, h, z + w], [x, h, z - w]], [g, g, g2, g2]);
    const pts: [number, number, number][] = [[x, h + .03, z]], cols: Rgb[] = [c3(center)];
    for (let i = 0; i <= 6; i++) { const a = i / 6 * Math.PI * 2 + k; pts.push([x + Math.cos(a) * .15, h + .01, z + Math.sin(a) * .15]); cols.push(c3(petal)); }
    b.fan(pts, cols);
  });
  return b.build();
}

/** A boulder: a displaced icosahedron with flat faces, moss on top, dark at the foot. Radius about 1. */
export function rock(seed = 3): THREE.BufferGeometry {
  const rnd = mulberry32(seed), g = ico(1, 1), p = g.attributes.position, v = new THREE.Vector3();
  const k = new Map<string, number>(); // the same displacement for vertices that share a position
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const key = v.x.toFixed(3) + ',' + v.y.toFixed(3) + ',' + v.z.toFixed(3);
    let d = k.get(key); if (d === undefined) { d = .82 + rnd() * .36; k.set(key, d); }
    v.multiplyScalar(d); p.setXYZ(i, v.x, v.y, v.z);
  }
  const grey = c3(0x7d8493), dark = c3(0x4d5262), moss = c3(0x557f3f);
  return new GeoBuilder().add(g, place(0, .55, 0, 1.1, .72, 1), (_x, y, _z, ny) => { const m = lerp3(dark, grey, Math.min(1, (y + .1) / .8)); return lerp3(m, moss, Math.max(0, Math.min(1, (ny - .55) * 2.2)) * .85); }).build();
}

/** A cluster of five crystals leaning outward. White-ish vertex colors: the instance color supplies the hue. Height about 1.6. Use an unlit material. */
export function crystal(): THREE.BufferGeometry {
  const b = new GeoBuilder(), rnd = mulberry32(21);
  const col: ColorFn = (_x, y) => { const t = Math.min(1, y / 1.5); return [.62 + .38 * t, .62 + .38 * t, .7 + .3 * t]; };
  [[0, 0, 1.5, 0, 0], [.34, .15, 1.0, .35, .5], [-.3, .22, 1.1, -.4, 3.5], [.1, -.34, .8, .5, 2.2], [-.2, -.28, .9, -.45, 5.2]].forEach(([x, z, h, lean, ang]) => {
    const g = cone(.17, h, 5);
    b.add(g, place(x, h / 2 - .05, z, 1, 1, 1, lean * Math.cos(ang), 0, lean * Math.sin(ang)), col, true);
    b.add(cyl(.17, .2, h * .22, 5), place(x, h * .08, z, 1, 1, 1, lean * Math.cos(ang), 0, lean * Math.sin(ang)), (_x, y) => [.42 + y * .2, .42 + y * .2, .5], true);
    rnd();
  });
  return b.build();
}

/** Three small mushrooms (cyan, magenta, amber caps). Self-lit, so use an unlit material. Height about .5. */
export function mushrooms(): THREE.BufferGeometry {
  const b = new GeoBuilder();
  [[0, 0, .42, .2, 0x59e0ff], [.3, .12, .3, .15, 0xff6ad5], [-.2, .24, .26, .13, 0xffc063]].forEach(([x, z, h, r, cap]) => {
    b.add(cyl(r * .35, r * .45, h, 5), place(x, h / 2, z), () => [.82, .78, .66], true);
    b.add(new THREE.SphereGeometry(r, 7, 4, 0, Math.PI * 2, 0, Math.PI / 2), place(x, h, z, 1, .7, 1), (_x, y) => { const c = c3(cap), t = .75 + .25 * Math.min(1, (y - h) / (r * .7) + .2); return [c[0] * t, c[1] * t, c[2] * t]; }, false);
  });
  return b.build();
}

/** A single shared bounding sphere for chunked instancing: centered `h / 2` above the chunk centre, reaching the chunk's corners and the tallest instance. */
export function chunkSphere(g: THREE.BufferGeometry, chunk: number, height: number): void {
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, height / 2, 0), Math.hypot(chunk / 2 * Math.SQRT2, height / 2) + 2);
  g.boundingBox = null;
}
