#!/usr/bin/env python3
"""
Realm Siege 3D — Sound Pack V2 · manifest generator.

Emits `manifest.json` next to this pack's docs: the per-file record of every shipped OGG —
voice name and recommended gain read from `src/audio/pack.ts`, decoded level metrics
(peak / RMS / crest), duration, channel count, the §5E role target, whether the file is
V2-authored (present under `masters/`) or a kept V1 file, plus the documented unused list.

Re-run after any re-encode:

    python doc/realm_siege_3d_sound_pack_v2/tools/manifest.py
"""
from __future__ import annotations

from pathlib import Path
import json
import hashlib
import re
import subprocess
import sys

import numpy as np

HERE = Path(__file__).resolve().parent
PACK_DOC = HERE.parent
ROOT = HERE.parents[2]
PACK_DIR = ROOT / 'public' / 'audio' / 'realm-siege'
PACK_TS = ROOT / 'src' / 'audio' / 'pack.ts'
MASTERS = PACK_DOC / 'masters'
OUT = PACK_DOC / 'manifest.json'

sys.path.insert(0, str(HERE))
import measure as M  # noqa: E402

ENTRY = re.compile(r"\{\s*file:\s*'([^']+)',\s*gain:\s*([0-9.]+)")
UNUSED = re.compile(r"^\s*'([^']+\.ogg)':\s*'(.+)'")
SR = 44100


def parse_pack() -> tuple[list[tuple[str, str, float]], list[dict[str, str]]]:
    text = PACK_TS.read_text(encoding='utf-8')
    entries: list[tuple[str, str, float]] = []
    for m in ENTRY.finditer(text):
        voice = text[:m.start()].rsplit('\n', 1)[-1].split(':')[0].strip()
        entries.append((voice, m.group(1), float(m.group(2))))
    unused = []
    for line in text.splitlines():
        m = UNUSED.match(line)
        if m:
            unused.append({'path': m.group(1), 'reason': m.group(2)})
    return entries, unused


def decode(path: Path) -> tuple[int, float, np.ndarray]:
    probe = subprocess.run(['ffprobe', '-v', 'error', '-select_streams', 'a:0',
                            '-show_entries', 'stream=channels', '-of', 'csv=p=0', str(path)],
                           capture_output=True, text=True, check=True)
    ch = int(probe.stdout.strip())
    raw = subprocess.run(['ffmpeg', '-v', 'error', '-i', str(path), '-f', 'f32le', '-'],
                         capture_output=True, check=True).stdout
    x = np.frombuffer(raw, dtype=np.float32).astype(np.float64).reshape(-1, ch)
    return ch, len(x) / SR, (x.T if ch > 1 else x[:, 0])


def main() -> int:
    entries, unused = parse_pack()
    if not entries:
        print('no pack entries parsed from pack.ts', file=sys.stderr)
        return 1
    master_set = {str(p.relative_to(MASTERS)).replace('\\', '/').replace('.wav', '.ogg')
                  for p in MASTERS.rglob('*.wav')}

    files = []
    for voice, rel, gain in entries:
        path = PACK_DIR / rel
        if not path.exists():
            print(f'MISSING {rel}', file=sys.stderr)
            return 1
        ch, dur, x = decode(path)
        role = M.V2_ROLES.get(rel)
        files.append({
            'voice': voice,
            'path': rel,
            'gain': gain,
            'role': role[2] if role else ('v1-kept' if rel not in master_set else 'unknown'),
            'v2': rel in master_set,
            'channels': ch,
            'durationS': round(dur, 3),
            'peakDb': round(M.peak_db(x), 2),
            'rmsDb': round(M.rms_db(x), 2),
            'crestDb': round(M.crest_db(x), 1),
            'sha256': hashlib.sha256(path.read_bytes()).hexdigest(),
        })

    manifest = {
        'pack': 'realm-siege',
        'version': 2,
        'source': 'all files are original procedural DSP renders (see PROVENANCE.md); no third-party audio',
        'provenance': {
            'authorship': 'original procedural synthesis for this project — no recordings, no sample libraries, no ripped assets',
            'masters': 'masters/*.wav (float32 · 44.1 kHz) — byte-reproducible from the pinned recipe',
            'recipe': 'tools/design.py (numpy/scipy, Python 3.12, fixed seeds)',
        },
        'export': {
            'masterFormat': 'float32 WAV · 44.1 kHz',
            'codec': 'libvorbis (ffmpeg)',
            'quality': '-q:a 7 VBR',
            'channels': 'mono one-shots / stereo beds, as authored',
            'levelPolicy': 'role RMS target set in tools/design.py (§5E); runtime mix via pack.ts recommendedVolume',
        },
        'counts': {
            'totalOnDisk': len(entries) + len(unused),
            'mapped': len(entries),
            'v2Authored': sum(1 for f in files if f['v2']),
            'v1Kept': sum(1 for f in files if not f['v2']),
            'unused': len(unused),
        },
        'files': files,
        'unused': unused,
    }
    OUT.write_text(json.dumps(manifest, indent=2) + '\n', encoding='utf-8')
    c = manifest['counts']
    print(f"manifest.json written: {c['totalOnDisk']} on disk = {c['mapped']} mapped "
          f"({c['v2Authored']} V2 + {c['v1Kept']} V1 kept) + {c['unused']} unused")
    return 0


if __name__ == '__main__':
    sys.exit(main())
