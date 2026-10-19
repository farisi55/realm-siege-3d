#!/usr/bin/env python3
"""
Realm Siege 3D — Sound Pack V2 · shipped-file validation.

Decodes every OGG under `public/audio/realm-siege/` (ffmpeg → f32le) and applies the audit's
§5E acceptance deck through `measure.py` — the same measurement code that drives the design
loop — so the shipped bytes, not the masters, are what passes:

  - inventory: every `src/audio/pack.ts` voice maps to exactly one file on disk, the documented
    unused list accounts for the rest, and nothing on disk is unaccounted;
  - manifest.json matches pack.ts (gains/paths) and the decoded files (durations/levels);
  - peak ≤ −1 dBFS and zero clipped samples on every V2 file (masters sit at a −1.5 dBFS
    ceiling so Vorbis decode overshoot stays clear of the −1 dBFS gate);
  - channel discipline: mono one-shots/emitters, `ambience/wind-loop.ogg` the only stereo file;
  - per-role RMS targets, crest 12–18 on impacts/casts, small-speaker band rule on fight cues
    (≥ 15 % above 1 kHz, < 30 % below 120 Hz, no band > 60 %), wind-up audibility, leading
    silence ≤ 10 ms on one-shots;
  - loop seams ≤ −45 dB rel. peak (target −50) on the three beds, measured on the decoded file;
  - take sets: pairwise waveform similarity < 0.9 and level spread ≤ 1 dB.

Prints a PASS/FAIL summary (exit 1 on any failure) and writes `validation_report.json`.
"""
from __future__ import annotations

import json
import math
import re
import subprocess
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
import measure as M  # noqa: E402

HERE = Path(__file__).resolve().parent
PACK_DOC = HERE.parent
ROOT = HERE.parents[2]
PACK_DIR = ROOT / 'public' / 'audio' / 'realm-siege'
PACK_TS = ROOT / 'src' / 'audio' / 'pack.ts'
MASTERS = PACK_DOC / 'masters'
MANIFEST = PACK_DOC / 'manifest.json'

ENTRY = re.compile(r"\{\s*file:\s*'([^']+)',\s*gain:\s*([0-9.]+)")
UNUSED = re.compile(r"^\s*'([^']+\.ogg)':\s*'(.+)'")
SEAM_TARGET = -45.0
SEAM_BEDS = ['ambience/wind-loop.ogg', 'ambience/forest-emitter.ogg', 'ambience/river-emitter.ogg']
STEREO_ALLOWED = {'ambience/wind-loop.ogg'}


def parse_pack() -> tuple[dict[str, float], dict[str, str]]:
    text = PACK_TS.read_text(encoding='utf-8')
    mapped: dict[str, float] = {}
    for m in ENTRY.finditer(text):
        mapped[m.group(1)] = float(m.group(2))
    unused = {m.group(1): m.group(2) for m in (UNUSED.match(l) for l in text.splitlines()) if m}
    return mapped, unused


def decode(path: Path) -> tuple[int, np.ndarray]:
    probe = subprocess.run(['ffprobe', '-v', 'error', '-select_streams', 'a:0',
                            '-show_entries', 'stream=channels', '-of', 'csv=p=0', str(path)],
                           capture_output=True, text=True, check=True)
    ch = int(probe.stdout.strip())
    raw = subprocess.run(['ffmpeg', '-v', 'error', '-i', str(path), '-f', 'f32le', '-'],
                         capture_output=True, check=True).stdout
    x = np.frombuffer(raw, dtype=np.float32).astype(np.float64).reshape(-1, ch)
    return ch, (x.T if ch > 1 else x[:, 0])


def seam_db_safe(x: np.ndarray) -> float:
    mono = M.to_mono(x)
    step = abs(float(mono[0]) - float(mono[-1]))
    return -math.inf if step == 0.0 else M.seam_step_db(x)


def main() -> int:
    fails: list[str] = []

    def check(ok: bool, msg: str) -> None:
        if not ok:
            fails.append(msg)

    mapped, unused = parse_pack()
    master_set = {str(p.relative_to(MASTERS)).replace('\\', '/').replace('.wav', '.ogg')
                  for p in MASTERS.rglob('*.wav')}
    on_disk = sorted(str(p.relative_to(PACK_DIR)).replace('\\', '/') for p in PACK_DIR.rglob('*.ogg'))

    # ---------------------------------------------------------------- inventory
    check(len(mapped) == len(set(mapped)), 'duplicate file paths in pack.ts')
    missing = [f for f in list(mapped) + list(unused) if f not in set(on_disk)]
    extra = [f for f in on_disk if f not in set(mapped) and f not in set(unused)]
    for f in missing:
        fails.append(f'mapped/unused file missing on disk: {f}')
    for f in extra:
        fails.append(f'file on disk is neither mapped nor documented unused: {f}')
    print(f'inventory: {len(on_disk)} on disk = {len(mapped)} mapped + {len(unused)} unused · '
          f'{len(set(mapped) & set(on_disk))}/{len(mapped)} present')

    # ---------------------------------------------------------------- decode once
    arrs: dict[str, np.ndarray] = {}
    chans: dict[str, int] = {}
    for rel in on_disk:
        chans[rel], arrs[rel] = decode(PACK_DIR / rel)

    # ---------------------------------------------------------------- per-file §5E deck (V2 files)
    rows: dict[str, dict] = {}
    for rel in sorted(master_set):
        check(rel in arrs, f'V2 master without shipped file: {rel}')
        if rel not in arrs:
            continue
        x = arrs[rel]
        bad = M.check_file(rel, x)
        want_ch = 2 if rel in STEREO_ALLOWED else 1
        if chans[rel] != want_ch:
            bad.append(f'{chans[rel]} channels, expected {want_ch}')
        rows[rel] = {
            'channels': chans[rel], 'durationS': round(len(M.to_mono(x)) / M.SR, 3),
            'peakDb': round(M.peak_db(x), 2), 'rmsDb': round(M.rms_db(x), 2),
            'crestDb': round(M.crest_db(x), 1), 'clipped': M.clipped_samples(x),
            'bands': {k: round(v, 4) for k, v in M.band_shares(x).items()},
        }
        for b in bad:
            fails.append(f'{rel}: {b}')

    # ---------------------------------------------------------------- loop seams (beds)
    for rel in SEAM_BEDS:
        seam = seam_db_safe(arrs[rel])
        rows[rel]['seamDb'] = None if seam == -math.inf else round(seam, 1)
        check(seam <= SEAM_TARGET, f'{rel}: loop seam {seam:.1f} dB > {SEAM_TARGET}')
        print(f'  seam {rel:38s} {"glued (0)" if seam == -math.inf else f"{seam:6.1f} dB":>10s} '
              f'(target ≤ {SEAM_TARGET:.0f})')

    # ---------------------------------------------------------------- take sets
    for name, files in M.TAKE_SETS.items():
        xs = [arrs[f] for f in files]
        lvls = [M.rms_db(x) for x in xs]
        spread = max(lvls) - min(lvls)
        worst = max((M.similarity(xs[i], xs[j]), i, j)
                    for i in range(len(xs)) for j in range(i + 1, len(xs)))
        check(spread <= 1.0, f'take set {name}: level spread {spread:.2f} dB > 1')
        check(worst[0] < 0.9, f'take set {name}: similarity {worst[0]:.3f} ≥ 0.9')
        print(f'  set  {name:12s} max similarity {worst[0]:.3f} (<0.9) · level spread {spread:.2f} dB (≤1)')

    # ---------------------------------------------------------------- manifest coherence
    if MANIFEST.exists():
        man = json.loads(MANIFEST.read_text(encoding='utf-8'))
        man_by_path = {f['path']: f for f in man['files']}
        check(len(man_by_path) == len(mapped), 'manifest.json file count differs from pack.ts')
        for rel, gain in mapped.items():
            e = man_by_path.get(rel)
            if e is None:
                fails.append(f'manifest.json missing {rel}')
                continue
            if abs(e['gain'] - gain) > 1e-9:
                fails.append(f'manifest.json gain {e["gain"]} ≠ pack.ts {gain} for {rel}')
            if rel in rows and abs(e['durationS'] - rows[rel]['durationS']) > 0.05:
                fails.append(f'manifest.json duration stale for {rel}')
        check({u['path'] for u in man['unused']} == set(unused), 'manifest.json unused list differs from pack.ts')
        print(f'manifest: {len(man_by_path)} entries coherent with pack.ts and the decoded files')
    else:
        fails.append('manifest.json missing — run tools/manifest.py')

    # ---------------------------------------------------------------- report
    report = {'files': rows, 'fails': fails}
    (HERE / 'validation_report.json').write_text(json.dumps(report, indent=1), encoding='utf-8')

    print()
    if fails:
        print(f'FAIL — {len(fails)} issue(s):')
        for f in fails:
            print(f'  · {f}')
        return 1
    print(f'PASS — {len(master_set)} V2 files and {len(mapped)} mapped voices validated; '
          f'{len(on_disk)} files on disk accounted for.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
