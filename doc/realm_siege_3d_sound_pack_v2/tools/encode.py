#!/usr/bin/env python3
"""
Realm Siege 3D — Sound Pack V2 · encoder.

Takes every float32 master under `masters/` and writes the runtime OGG into
`public/audio/realm-siege/<same relative path>` with ffmpeg/libvorbis.

Export settings (documented in the pack README):
  - codec      libvorbis (the engine's existing OGG decode path; no pipeline change)
  - quality    `-q:a 7` VBR (~224 kbps stereo, ~128–160 kbps mono at 44.1 kHz). q5 was measured
    to inject up to ~0.6 dB decode overshoot (breaking the decoded ≤ −1 dBFS gate) and visible
    edge error on the beds (breaking the decoded loop-seam gate), so the pack ships at q7.
  - channels   exactly the master's channel count (mono SFX / stereo beds)
  - no loudness post-processing: the mix level is the pack manifest's `recommendedVolume`
    (see tools/design.py for the per-role targets).

The five V1 combined ability clips are deleted here — every other V1 file is left
untouched (they stay bit-exact).
"""
from pathlib import Path
import subprocess
import sys

HERE = Path(__file__).resolve().parent
MASTERS = HERE.parent / 'masters'
PACK = Path('public/audio/realm-siege')

# V1 combined clips whose material now ships as wind-up + impact pairs.
SUPERSEDED = [
    'heroes/arcane-knight/ground-slam.ogg',
    'heroes/arcane-knight/meteor-prison.ogg',
    'heroes/shadow-huntress/death-mark.ogg',
    'heroes/ember-mage/inferno-storm.ogg',
    'heroes/storm-warrior/thunder-charge.ogg',
]

def main() -> int:
    wavs = sorted(MASTERS.rglob('*.wav'))
    if not wavs:
        print('no masters found', file=sys.stderr)
        return 1
    for wav in wavs:
        rel = wav.relative_to(MASTERS).with_suffix('.ogg')
        dest = PACK / rel
        dest.parent.mkdir(parents=True, exist_ok=True)
        cmd = ['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-i', str(wav),
               '-c:a', 'libvorbis', '-q:a', '7', str(dest)]
        proc = subprocess.run(cmd, capture_output=True, text=True)
        if proc.returncode != 0:
            print(f'FAIL {rel}: {proc.stderr.strip()}', file=sys.stderr)
            return 1
        print(f'ok   {rel}')
    for rel in SUPERSEDED:
        p = PACK / rel
        if p.exists():
            p.unlink()
            print(f'rm   {rel} (superseded by the V2 wind-up/impact pair)')
    print(f'\n{len(wavs)} files encoded into {PACK}')
    return 0

if __name__ == '__main__':
    sys.exit(main())
