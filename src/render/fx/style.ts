import * as THREE from 'three';

/** Colors one hero's effects are built from: the hero color, a hot near-white, a deep shade and an accent for contrast. */
export interface Palette { main: number; hot: number; dark: number; accent: number; }

const A = new THREE.Color(), B = new THREE.Color();
export const mixHex = (a: number, b: number, t: number): number => A.setHex(a).lerp(B.setHex(b), t).getHex();
export const lighten = (c: number, t: number): number => mixHex(c, 0xffffff, t);
export const darken = (c: number, t: number): number => mixHex(c, 0x000000, t);

/** Per-hero palettes, keyed by the hero name in `HR`. Unknown colors get a derived palette (see `paletteOf`). */
export const HERO_PALETTE: Record<string, Palette> = {
  'Arcane Knight': { main: 0x6aa8ff, hot: 0xd6e8ff, dark: 0x2a4a9a, accent: 0xffd27a },
  'Shadow Huntress': { main: 0xb06bff, hot: 0xeed4ff, dark: 0x3a1a5a, accent: 0x7dff6a },
  'Ember Mage': { main: 0xff8a3a, hot: 0xffe6a8, dark: 0x7a1a08, accent: 0xffd04a },
  'Nature Guardian': { main: 0x4ee08a, hot: 0xd6ffe0, dark: 0x1a6a3a, accent: 0xffe6a0 },
  'Storm Warrior': { main: 0xffe14a, hot: 0xffffff, dark: 0x9a6a00, accent: 0x6ac8ff },
};

const cache = new Map<number, Palette>();
/** Palette for a hero by name; for anything else (creeps, buildings, boss) one derived from `color`. */
export function paletteOf(name: string | undefined, color: number): Palette {
  const p = name && HERO_PALETTE[name];
  if (p) return p;
  let d = cache.get(color);
  if (!d) cache.set(color, d = { main: color, hot: lighten(color, .7), dark: darken(color, .55), accent: lighten(color, .35) });
  return d;
}

/** Colors shared by non-hero effects. */
export const COLORS = {
  fireHot: 0xffe9a0, fire: 0xff7a1a, fireDeep: 0xc4300a, ember: 0xffa040,
  smoke: 0x34343e, smokeLight: 0x6a6a76, dust: 0x9a8a6c, rock: 0x6a5a48, rockDark: 0x3c342c,
  gold: 0xffd04a, heal: 0x6fff8a, white: 0xffffff, steel: 0xcfd6ff, blood: 0xff2a2a, boss: 0xff5ad0,
  poison: 0x7dff6a, poisonDeep: 0x2f9a2a, lightning: 0xfff08a, electric: 0x6ac8ff,
} as const;
