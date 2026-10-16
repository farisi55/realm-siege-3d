/**
 * The mood of the map in one place: low golden-hour sun, cool blue haze, a little magic in the glow colors.
 * Lighting, sky, fog, water, the terrain shader and the finishing pass all read from here, so retuning the look is a one-file change.
 * Colors are 0xRRGGBB; the pipeline is display-referred (no color management), so what is written here is what the eye gets.
 */
export const ATMO = {
  /** Directional sun and its offset from the point it looks at (world units). */
  sun: 0xffdcae, sunI: 1.12, sunOffset: [30, 70, 24] as const,
  /** Hemisphere fill: cool sky, green-brown bounce from the ground. */
  skyL: 0xa6bfff, groundL: 0x3f4d2e, hemiI: .8,
  /** Distance haze and the colors of the sky dome (zenith, mid, horizon and the warm glow around the sun). */
  fog: 0xa3b4d0, zenith: 0x2f4f8f, mid: 0x6d97cf, horizon: 0xbccce2, glow: 0xffc690,
};

/** Glow colors of the magic in the world (rune lines, crystals, water highlights). */
export const MAGIC = {
  cyan: 0x5ee6ff, violet: 0xb07cff, gold: 0xffc65a, ember: 0xff9a50,
};
