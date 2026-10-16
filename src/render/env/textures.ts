import * as THREE from 'three';
import { tnoise } from './rand';

/** A seamless grey noise (mean about .5) that breaks up flat ground colors close up. Three octaves of tiling value noise. */
export function detailTexture(size = 128): THREE.DataTexture {
  const d = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size, v = y / size;
      let n = 0, a = .5, f = 4, tot = 0;
      for (let o = 0; o < 4; o++) { n += a * tnoise(u * f, v * f, f, 10 + o); tot += a; a *= .55; f *= 2; }
      const g = Math.max(0, Math.min(255, Math.round(n / tot * 255))), i = (y * size + x) * 4;
      d[i] = d[i + 1] = d[i + 2] = g; d[i + 3] = 255;
    }
  }
  const t = new THREE.DataTexture(d, size, size, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true;
  t.needsUpdate = true;
  return t;
}

/** The ground texture from painted RGBA bytes: clamped, mip-mapped, anisotropic where the GPU allows. */
export function splatTexture(data: Uint8Array<ArrayBuffer>, size: number, anisotropy = 4): THREE.DataTexture {
  const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true;
  t.anisotropy = anisotropy;
  t.needsUpdate = true;
  return t;
}

/** A soft round glow (white, alpha falling off smoothly): light pools on the ground, halos, contact shadows. */
export function glowTexture(size = 64, power = 2): THREE.DataTexture {
  const d = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (x + .5) / size * 2 - 1, dy = (y + .5) / size * 2 - 1, r = Math.min(1, Math.hypot(dx, dy)), a = Math.pow(1 - r * r, power) * (1 - r);
      const i = (y * size + x) * 4;
      d[i] = d[i + 1] = d[i + 2] = 255; d[i + 3] = Math.round(Math.max(0, a) * 255);
    }
  }
  const t = new THREE.DataTexture(d, size, size, THREE.RGBAFormat);
  t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearFilter; t.generateMipmaps = false; t.needsUpdate = true;
  return t;
}
