import { describe, it, expect } from 'vitest';
import { readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { PACK, PACK_DIR, PACK_UNUSED, packUrl } from '../src/audio/pack';
import { SOUNDS } from '../src/audio/synth';

/**
 * Phase 6: the shipped sound pack is wired. This suite walks the real files under `public/audio/realm-siege/`, so a
 * renamed definition, a stale path, a stray asset or a file that silently backs nothing cannot pass unnoticed:
 *
 *  - every mapped definition carries its file URL (base-aware) and the manifest's `recommendedVolume` as `fileGain`;
 *  - every mapped file exists on disk (80 files shipped: 75 back definitions one-to-one, and 5 are deliberately
 *    unused, each with a stated reason — V2 split the V1 shared and combined files, so no file backs two defs now);
 *  - every file on disk is either mapped or listed in `PACK_UNUSED`.
 */

const ROOT = join(process.cwd(), 'public', PACK_DIR);

/** Every `.ogg` under the pack folder, as a pack-relative POSIX path. */
function shippedFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string, rel: string): void => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(join(dir, e.name), r);
      else if (e.name.endsWith('.ogg')) out.push(r);
    }
  };
  walk(ROOT, '');
  return out;
}

describe('sound pack: every shipped file is accounted for (phase 6)', () => {
  const disk = shippedFiles();
  const mapped = new Set(Object.values(PACK).map(e => e.file));

  it('ships the full pack: 80 files on disk, 75 of them mapped, 5 deliberately unused', () => {
    expect(disk.length).toBe(80);
    expect(mapped.size).toBe(75); // one file per definition since the V2 split
    expect(Object.keys(PACK_UNUSED).length).toBe(5);
    for (const f of disk) {
      expect(mapped.has(f) || f in PACK_UNUSED, `${f} backs nothing and is not listed in PACK_UNUSED`).toBe(true);
    }
    for (const f of mapped) expect(f in PACK_UNUSED, `${f} is both mapped and unused`).toBe(false);
  });

  it('every mapped definition exists and carries the file URL and the manifest gain', () => {
    for (const [name, entry] of Object.entries(PACK)) {
      const def = SOUNDS[name];
      expect(def, `PACK maps "${name}", which is missing from the manifest`).toBeTruthy();
      expect(def!.urls, `"${name}" has no urls`).toEqual([packUrl(entry.file)]);
      expect(def!.urls!.length, `"${name}" claims more than one file`).toBe(1);
      expect(packUrl(entry.file).endsWith(`${PACK_DIR}${entry.file}`)).toBe(true); // base-aware, never an absolute CDN path
      expect(def!.fileGain, `"${name}" lost its recommendedVolume`).toBe(entry.gain);
      expect(existsSync(join(ROOT, entry.file)), `missing file: ${entry.file}`).toBe(true);
    }
  });

  it('nothing else claims a pack file, and every unused file has a stated reason', () => {
    for (const [name, def] of Object.entries(SOUNDS)) {
      if (name in PACK) continue;
      expect(def.urls, `"${name}" unexpectedly references a file`).toBeUndefined(); // unmapped defs keep synthesizing
    }
    for (const [file, reason] of Object.entries(PACK_UNUSED)) {
      expect(reason.length, `no reason for ${file}`).toBeGreaterThan(20);
      expect(existsSync(join(ROOT, file)), `unused entry points at a missing file: ${file}`).toBe(true);
    }
  });
});
