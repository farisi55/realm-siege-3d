#!/usr/bin/env python3
"""
Realm Siege 3D — Sound Pack V2 · measurement library.

Audit-identical measurement (same STFT band method and loop-seam definition as
`doc/sound_pack_v2_audit/analyze.py`) plus the §5E acceptance checks, shared by the design
iteration scripts and `validate.py`.
"""
from __future__ import annotations

import numpy as np
from scipy import signal

SR = 44100
BANDS = [(20, 60), (60, 120), (120, 350), (350, 1000), (1000, 3000), (3000, 6000), (6000, 12000), (12000, 20000)]

# ---------------------------------------------------------------------------------------------------- basic metrics

def to_mono(x: np.ndarray) -> np.ndarray:
    return x.mean(axis=0) if x.ndim > 1 else x


def peak_db(x: np.ndarray) -> float:
    return 20 * np.log10(float(np.max(np.abs(x))) + 1e-12)


def rms_db(x: np.ndarray) -> float:
    return 20 * np.log10(float(np.sqrt(np.mean(x.astype(np.float64) ** 2))) + 1e-12)


def crest_db(x: np.ndarray) -> float:
    return peak_db(x) - rms_db(x)


def clipped_samples(x: np.ndarray) -> int:
    return int(np.count_nonzero(np.abs(x) >= 0.9997))


def band_shares(x: np.ndarray) -> dict[str, float]:
    """Audit method: summed Hann-STFT power (nfft 2048 / hop 1024) split into the §5E bands, share 0..1."""
    mono = to_mono(x)
    nfft, hop = 2048, 1024
    win = np.hanning(nfft)
    frames = max(0, (len(mono) - nfft) // hop + 1)
    freqs = np.fft.rfftfreq(nfft, 1.0 / SR)
    spec = None
    for k in range(frames):
        P = np.abs(np.fft.rfft(mono[k * hop:k * hop + nfft] * win)) ** 2
        spec = P if spec is None else spec + P
    if spec is None:
        return {f'{lo}-{hi}': 0.0 for lo, hi in BANDS}
    out, tot = {}, 1e-30
    for lo, hi in BANDS:
        m = (freqs >= lo) & (freqs < hi)
        out[f'{lo}-{hi}'] = float(spec[m].sum())
        tot += float(spec[m].sum())
    return {k: v / tot for k, v in out.items()}


def band_peak(x: np.ndarray, f1: float, f2: float) -> float:
    sos = signal.butter(2, [f1 / (SR / 2), min(f2, SR / 2 * .999) / (SR / 2)], 'band', output='sos')
    return float(np.max(np.abs(signal.sosfiltfilt(sos, to_mono(x)))))


def lead_silence_s(x: np.ndarray) -> float:
    """Audit method: 5 ms frame RMS frames below −60 dBFS are silent; the first sounding frame's time."""
    mono = to_mono(x)
    hop = int(SR * .005)
    nf = len(mono) // hop
    if not nf:
        return len(mono) / SR
    env = np.sqrt(np.mean(mono[:nf * hop].reshape(nf, hop) ** 2, axis=1))
    silent = 20 * np.log10(np.maximum(env, 1e-9)) < -60.0
    return float(np.argmax(~silent) * .005) if (~silent).any() else len(mono) / SR


def seam_step_db(x: np.ndarray) -> float:
    """Audit definition: |first − last sample| of the mid signal, in dB relative to the file peak."""
    mono = to_mono(x)
    return 20 * np.log10(abs(float(mono[0]) - float(mono[-1]))) - peak_db(mono)


def wrap_continuity(x: np.ndarray, ms: float = 100.0) -> dict[str, float]:
    """Extra loop evidence: wrap step vs the signal's own adjacent-sample step distribution (an outlier
    check — for a broadband texture a raw sample step far below the internal p99 is not a discontinuity),
    and the level/spectrum change across the wrap."""
    mono = to_mono(x)
    d = np.abs(np.diff(mono))
    step = abs(float(mono[0]) - float(mono[-1]))
    p99 = float(np.percentile(d, 99))
    n = int(SR * ms / 1000)
    lvl_a = rms_db(mono[-n:])
    lvl_b = rms_db(mono[:n])
    sa = band_shares(mono[-n:])
    sb = band_shares(mono[:n])
    l1 = sum(abs(sa[k] - sb[k]) for k in sa)
    return {'step': step, 'p99_internal': p99, 'step_over_p99': step / (p99 + 1e-12),
            'level_delta_db': lvl_b - lvl_a, 'band_l1_delta': l1}


def similarity(a: np.ndarray, b: np.ndarray) -> float:
    """Normalized cross-correlation peak of two takes (audit §5E: take sets stay < 0.9)."""
    from scipy.signal import fftconvolve
    x = to_mono(a).astype(np.float64)
    y = to_mono(b).astype(np.float64)
    x = x - x.mean()
    y = y - y.mean()
    c = fftconvolve(x, y[::-1], mode='full')
    den = np.sqrt((x * x).sum() * (y * y).sum()) + 1e-12
    return float(np.max(np.abs(c)) / den)


# ---------------------------------------------------------------------------------------------------- deck of files

# The role of every V2 file: (rms target dB, tolerance) — §5E; `None` = no RMS verdict (kept V1 files).
# 'impact' also enforces crest 12–18; fight cues (any cue heard in fights) get the small-speaker rule.
V2_ROLES: dict[str, tuple[float, float, str]] = {
    # combat impacts & feedback — impacts −16±2, crest 12–18, small-speaker rule
    'combat/melee-impact-light.ogg': (-16, 2, 'impact'),
    'combat/melee-impact-light-2.ogg': (-16, 2, 'impact'),
    'combat/melee-impact-light-3.ogg': (-16, 2, 'impact'),
    'combat/melee-impact-heavy.ogg': (-16, 2, 'impact'),
    'combat/hero-hit.ogg': (-16, 2, 'impact'),
    'combat/arrow-impact-poison.ogg': (-16, 2, 'impact'),
    'combat/magic-impact.ogg': (-16, 2, 'impact'),
    'combat/magic-impact-arcane.ogg': (-16, 2, 'impact'),
    'combat/magic-impact-fire.ogg': (-16, 2, 'impact'),
    'structures/tower-impact.ogg': (-16, 2, 'impact'),
    'structures/core-hit.ogg': (-16, 2, 'impact'),
    'structures/boss-attack.ogg': (-16, 2, 'impact'),
    'heroes/ember-mage/burning-zone-ignition.ogg': (-16, 2, 'impact'),
    'heroes/arcane-knight/ground-slam-impact.ogg': (-16, 2, 'split-impact'),
    'heroes/arcane-knight/meteor-prison-impact.ogg': (-16, 2, 'split-impact'),
    'heroes/shadow-huntress/death-mark-burst.ogg': (-16, 2, 'split-impact'),
    'heroes/ember-mage/inferno-storm-burst.ogg': (-16, 2, 'split-impact'),
    'heroes/storm-warrior/thunder-charge-impact.ogg': (-16, 2, 'split-impact'),
    # swings are wind-ups, not impacts: RMS −20±2, no crest verdict, small-speaker rule
    'combat/melee-swing-light.ogg': (-20, 2, 'cast'),
    'combat/melee-swing-light-2.ogg': (-20, 2, 'cast'),
    'combat/melee-swing-light-3.ogg': (-20, 2, 'cast'),
    # launches & casts −20±2, crest 12–18
    'combat/ranged-launch.ogg': (-20, 2, 'cast'),
    'combat/magic-launch.ogg': (-20, 2, 'cast'),
    'heroes/arcane-knight/arcane-strike.ogg': (-20, 2, 'cast'),
    'heroes/arcane-knight/arcane-shield.ogg': (-20, 2, 'cast'),
    'heroes/shadow-huntress/smoke-veil.ogg': (-20, 2, 'cast'),
    'heroes/ember-mage/fire-bolt.ogg': (-20, 2, 'cast'),
    'heroes/nature-guardian/healing-seed.ogg': (-20, 2, 'cast'),
    'heroes/nature-guardian/nature-barrier.ogg': (-20, 2, 'cast'),
    'heroes/storm-warrior/lightning-punch.ogg': (-20, 2, 'cast'),
    'heroes/storm-warrior/static-field.ogg': (-20, 2, 'cast'),
    # split wind-ups −22±2
    'heroes/arcane-knight/ground-slam-windup.ogg': (-22, 2, 'windup'),
    'heroes/arcane-knight/meteor-prison-windup.ogg': (-22, 2, 'windup'),
    'heroes/shadow-huntress/death-mark-windup.ogg': (-22, 2, 'windup'),
    'heroes/ember-mage/inferno-storm-windup.ogg': (-22, 2, 'windup'),
    'heroes/storm-warrior/thunder-charge-rush.ogg': (-22, 2, 'windup'),
    # stingers / UI −18±2 / −20±3
    'ui/level-up.ogg': (-18, 2, 'stinger'),
    # footsteps (level-matched take sets, ±1 within the set)
    'combat/footstep-grass-1.ogg': (-21, 1.5, 'step'),
    'combat/footstep-grass-2.ogg': (-21, 1.5, 'step'),
    'combat/footstep-grass-3.ogg': (-21, 1.5, 'step'),
    'combat/footstep-grass-4.ogg': (-21, 1.5, 'step'),
    'combat/footstep-water-1.ogg': (-21, 1.5, 'step'),
    'combat/footstep-water-2.ogg': (-21, 1.5, 'step'),
    'combat/footstep-water-3.ogg': (-21, 1.5, 'step'),
    # beds −22±3 (manifest gain restores the shipped mix level)
    'ambience/wind-loop.ogg': (-22, 3, 'bed'),
    'ambience/forest-emitter.ogg': (-22, 3, 'bed'),
    'ambience/river-emitter.ogg': (-22, 3, 'bed'),
}

# Cues heard constantly in fights → the small-speaker rule (≥15 % above 1 kHz, <30 % below 120 Hz,
# no single band > 60 %). Matches the audit's §3 flagged files plus everything adjacent to them.
FIGHT_CUES = [
    'combat/melee-swing-light.ogg', 'combat/melee-swing-light-2.ogg', 'combat/melee-swing-light-3.ogg',
    'combat/melee-impact-light.ogg', 'combat/melee-impact-light-2.ogg', 'combat/melee-impact-light-3.ogg',
    'combat/melee-impact-heavy.ogg', 'combat/hero-hit.ogg', 'combat/magic-impact.ogg',
    'combat/magic-impact-arcane.ogg', 'combat/magic-impact-fire.ogg', 'combat/arrow-impact-poison.ogg',
    'combat/ranged-launch.ogg', 'combat/magic-launch.ogg',
    'structures/tower-impact.ogg', 'structures/core-hit.ogg', 'structures/boss-attack.ogg',
    'heroes/storm-warrior/lightning-punch.ogg', 'heroes/shadow-huntress/smoke-veil.ogg',
    'heroes/ember-mage/fire-bolt.ogg', 'heroes/arcane-knight/arcane-strike.ogg',
    'heroes/arcane-knight/ground-slam-impact.ogg', 'heroes/arcane-knight/meteor-prison-impact.ogg',
    'heroes/shadow-huntress/death-mark-burst.ogg', 'heroes/ember-mage/inferno-storm-burst.ogg',
    'heroes/storm-warrior/thunder-charge-impact.ogg', 'heroes/ember-mage/burning-zone-ignition.ogg',
]

TAKE_SETS = {
    'swings': ['combat/melee-swing-light.ogg', 'combat/melee-swing-light-2.ogg', 'combat/melee-swing-light-3.ogg'],
    'melee hits': ['combat/melee-impact-light.ogg', 'combat/melee-impact-light-2.ogg', 'combat/melee-impact-light-3.ogg'],
    'grass steps': ['combat/footstep-grass-1.ogg', 'combat/footstep-grass-2.ogg', 'combat/footstep-grass-3.ogg', 'combat/footstep-grass-4.ogg'],
    'water steps': ['combat/footstep-water-1.ogg', 'combat/footstep-water-2.ogg', 'combat/footstep-water-3.ogg'],
}


def check_file(rel: str, x: np.ndarray) -> list[str]:
    """Every §5E verdict that applies to one file; returns a list of human-readable failures."""
    bad: list[str] = []
    bands = band_shares(x)
    role = V2_ROLES.get(rel)
    if role is not None:
        tgt, tol, kind = role
        r = rms_db(x)
        if abs(r - tgt) > tol:
            bad.append(f'rms {r:.2f} outside {tgt:.0f}±{tol} ({kind})')
        if kind in ('impact', 'cast', 'split-impact'):
            c = crest_db(x)
            if not (12 <= c <= 18):
                bad.append(f'crest {c:.1f} outside 12–18')
    if rel in FIGHT_CUES:
        top = max(bands, key=bands.get)
        below = bands['20-60'] + bands['60-120']
        above1k = sum(v for k, v in bands.items() if k in ('1000-3000', '3000-6000', '6000-12000', '12000-20000'))
        if bands[top] > .60:
            bad.append(f'band {top} {bands[top]*100:.0f}% > 60%')
        if below > .30:
            bad.append(f'{below*100:.0f}% below 120 Hz > 30%')
        if above1k < .15:
            bad.append(f'{above1k*100:.0f}% above 1 kHz < 15%')
    if role is not None and role[2] == 'windup':
        # wind-ups are deliberate low-forward swells, but they must stay audible on small speakers
        below = bands['20-60'] + bands['60-120']
        mid = bands['120-350'] + bands['350-1000']
        if below > .80:
            bad.append(f'{below*100:.0f}% below 120 Hz > 80% (windup audibility)')
        if mid < .15:
            bad.append(f'{mid*100:.0f}% in 120 Hz–1 kHz < 15% (windup audibility)')
    if peak_db(x) > -1.0:
        bad.append(f'peak {peak_db(x):.2f} > -1 dBFS')
    if clipped_samples(x):
        bad.append(f'{clipped_samples(x)} clipped samples')
    if rel.endswith(('.ogg',)) and role is not None and role[2] not in ('bed',):
        lead = lead_silence_s(x)
        if lead > .010:
            bad.append(f'leading silence {lead*1000:.1f} ms > 10')
    return bad
