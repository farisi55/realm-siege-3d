#!/usr/bin/env python3
"""
Realm Siege 3D — Sound Pack V2 audit, part 2: prominent-transient timing + similarity review.

Reads metrics.json + the decoded WAVs and prints:
  - the prominent envelope peaks (>=5 dB prominence) of key files: combined cast/impact clips,
    plus the worst offenders found in part 1 (sub-heavy, harsh, clipped)
  - the level at the game's real cue offsets (+220 ms melee impact / +250 ms ability release)
    relative to the clip's own loudest transient
  - the loop-seam discontinuity of every looping file
  - the top near-duplicate pairs and the variant groups the game actually cycles (grass steps)
"""
import json
import wave
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
WAV = Path(r'C:/Users/banu.farisi/AppData/Local/Temp/opencode/realm_audit_wav')
M = json.loads((HERE / 'metrics.json').read_text(encoding='utf-8'))

def env_of(rel, hop_s=0.005):
    with wave.open(str(WAV / (rel.replace('/', '__')[:-4] + '.wav')), 'rb') as w:
        sr, ch, n = w.getframerate(), w.getnchannels(), w.getnframes()
        raw = w.readframes(n)
    x = np.frombuffer(raw, dtype='<i2').astype(np.float64).reshape(-1, ch) / 32768.0
    mid = x.mean(axis=1)
    hop = max(1, int(sr * hop_s))
    nf = len(mid) // hop
    e = np.sqrt(np.mean(mid[:nf * hop].reshape(nf, hop) ** 2, axis=1))
    db = 20 * np.log10(np.maximum(e, 1e-9))
    return np.array([db[max(0, i - 1):i + 2].mean() for i in range(nf)]), 0.005

def peaks(db, floor_rel=15.0):
    """Major envelope events: local maxima within `floor_rel` dB of the strongest, >=40 ms apart."""
    if len(db) == 0:
        return []
    thr = float(db.max()) - floor_rel
    cand = []
    for i in range(len(db)):
        if db[i] < thr:
            continue
        left_ok = i == 0 or db[i] >= db[i - 1]
        right_ok = i == len(db) - 1 or db[i] > db[i + 1]
        if left_ok and right_ok:
            cand.append(i)
    cand.sort(key=lambda i: -db[i])
    keep = []
    for i in cand:
        if all(abs(i - k) * 0.005 >= 0.04 for k in keep):
            keep.append(i)
        if len(keep) >= 6:
            break
    return sorted((round(i * 0.005, 3), round(float(db[i]), 1)) for i in keep)

def level_at(db, t):
    i = int(t / 0.005)
    return round(float(db[i]), 1) if 0 <= i < len(db) else None

KEY = [
    'heroes/arcane-knight/ground-slam.ogg',
    'heroes/arcane-knight/meteor-prison.ogg',
    'heroes/shadow-huntress/death-mark.ogg',
    'heroes/ember-mage/inferno-storm.ogg',
    'heroes/storm-warrior/thunder-charge.ogg',
    'combat/melee-swing-light.ogg', 'combat/melee-swing-heavy.ogg',
    'combat/melee-impact-light.ogg', 'combat/melee-impact-heavy.ogg',
    'combat/hero-hit.ogg', 'structures/tower-impact.ogg',
    'combat/ranged-launch.ogg', 'heroes/ember-mage/fire-bolt.ogg',
    'combat/magic-impact.ogg', 'combat/magic-launch.ogg', 'ui/ui-click.ogg',
    'combat/footstep-grass-1.ogg', 'combat/footstep-grass-2.ogg', 'combat/footstep-grass-3.ogg',
]

print('== prominent transients (time s, level dBFS, prominence dB) ==')
for rel in KEY:
    db, _ = env_of(rel)
    a = M['files'][rel]
    pk = peaks(db)
    top = sorted(pk, key=lambda p: -p[1])[:3]
    print(f"\n{rel}  dur={a['duration']}s  attack={a['attack_time']}s  centroid={a['centroid_hz']}Hz  flat={a['flatness']}")
    print('   events:', '  '.join(f"@{t}s {lv}dB" for t, lv in pk))
    print(f"   strongest: {top}")
    print(f"   level @+0.22s = {level_at(db, .22)} dBFS   @+0.25s = {level_at(db, .25)} dBFS   "
          f"@+0.50s = {level_at(db, .50)} dBFS   effective_end={a['effective_end']}s  centroid_time={a['energy_centroid']}s")

print('\n== loop seams (loops must not click: seam should be tiny vs peak) ==')
for rel, a in M['files'].items():
    if a.get('loop_seam') is not None:
        peak_lin = 10 ** (a['peak_db'] / 20)
        ratio_db = 20 * np.log10(max(a['loop_seam'], 1e-9) / peak_lin)
        print(f"{rel:44s} seam={a['loop_seam']:.5f}  seam-vs-peak {ratio_db:6.1f} dB   RMS {a['rms_db']} dB  stereo {a['channels']}ch side-mid {a['side_minus_mid_db']} dB")

print('\n== exact duplicates ==')
print(M['duplicates'])

print('\n== top 30 near-duplicate pairs (cosine of band-shape + envelope fingerprint) ==')
for s, a, b in M['near_duplicates'][:30]:
    print(f"  {s:.3f}  {a}  <->  {b}")
