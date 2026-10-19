#!/usr/bin/env python3
"""
Realm Siege 3D — Sound Pack V2 · original procedural sound design.

Every V2 asset is generated here from first principles with numpy/scipy DSP:  filtered
noise, time-varying band-pass masks (swishes), resonant bodies with pitch envelopes,
FM/bell tones, electric zaps, fire crackle grains, synthetic-impulse reverb tails and
seamless-loop wrapping.  No third-party recordings or samples are used anywhere — this
file is the complete provenance of the pack (see PROVENANCE.md).

Outputs:
  masters/…            clean 44.1 kHz float32 WAV masters (one per asset)
  …/render_report.txt  per-file peak / RMS / crest / duration, checked against the V2 role targets

Run:  python doc/realm_siege_3d_sound_pack_v2/tools/design.py
Encode (separate step): tools/encode.py writes the runtime OGGs into public/audio/realm-siege/.
"""
import sys
from pathlib import Path

import numpy as np
from scipy import signal

SR = 44100
HERE = Path(__file__).resolve().parent
MASTERS = HERE.parent / 'masters'

# ====================================================================================================== primitives

def n_of(dur: float) -> int:
    return int(round(dur * SR))

def tt(n: int) -> np.ndarray:
    return np.arange(n, dtype=np.float64) / SR

def env(n: int, atk: float, dec: float) -> np.ndarray:
    """attack (linear) into exponential decay, the workhorse transient envelope."""
    t = tt(n)
    return np.where(t < atk, t / max(atk, 1e-6), np.exp(-(t - atk) / max(dec, 1e-6)))

def env_rise(n: int, atk: float, at: float = 0.0) -> np.ndarray:
    """smooth rise then hold (for buildups); `at` delays the start."""
    t = tt(n)
    e = np.clip((t - at) / max(atk, 1e-6), 0.0, 1.0)
    return e * e * (3 - 2 * e)

def noise(n: int, seed: int) -> np.ndarray:
    return np.random.default_rng(seed).standard_normal(n) * 0.25

def bp(x: np.ndarray, f1: float, f2: float, o: int = 4) -> np.ndarray:
    ny = SR / 2
    lo = max(f1, 1.0) / ny; hi = min(f2, ny * 0.999) / ny
    if not (0 < lo < hi < 1):
        return x
    return signal.sosfiltfilt(signal.butter(o, [lo, hi], 'band', output='sos'), x)

def lp(x: np.ndarray, f: float, o: int = 4) -> np.ndarray:
    ny = SR / 2
    return signal.sosfiltfilt(signal.butter(o, min(f, ny * 0.999) / ny, 'low', output='sos'), x)

def hp(x: np.ndarray, f: float, o: int = 4) -> np.ndarray:
    ny = SR / 2
    return signal.sosfiltfilt(signal.butter(o, max(f, 1.0) / ny, 'high', output='sos'), x)

def cream(x: np.ndarray, drive: float = 1.2) -> np.ndarray:
    """gentle tanh saturation: trims peaks, adds subtle harmonics (never hard clips)."""
    return np.tanh(x * drive) / np.tanh(drive)

def tv_band(x: np.ndarray, points, q: float = 1.2, nfft: int = 1024, hop: int = 256) -> np.ndarray:
    """
    Time-varying gaussian band-pass: `points` = [(t, centre_hz), …] with the bandwidth centre/q.
    STFT + per-frame mask + windowed overlap-add, so a cut can move through the spectrum cleanly.
    """
    n = len(x)
    pad = nfft
    xp = np.concatenate([np.zeros(pad), x, np.zeros(pad + nfft)])
    win = np.hanning(nfft)
    frames = 1 + (len(xp) - nfft) // hop
    times = (np.arange(frames) * hop - pad + nfft / 2) / SR
    cs = np.interp(times, [p[0] for p in points], [p[1] for p in points])
    freqs = np.fft.rfftfreq(nfft, 1 / SR)
    out = np.zeros(len(xp) + nfft)
    wsum = np.zeros(len(xp) + nfft)
    for i in range(frames):
        seg = xp[i * hop:i * hop + nfft] * win
        X = np.fft.rfft(seg)
        c = float(max(cs[i], 40.0)); w = float(max(c / q, 50.0))
        y = np.fft.irfft(X * np.exp(-0.5 * ((freqs - c) / w) ** 2), nfft)
        out[i * hop:i * hop + nfft] += y * win
        wsum[i * hop:i * hop + nfft] += win * win
    return (out / np.maximum(wsum, 1e-6))[pad:pad + n]

def reso(n: int, f0: float, f1: float | None = None, tau: float = 0.1, atk: float = 0.002,
         amp: float = 1.0, phase: float = 0.0) -> np.ndarray:
    """decaying resonant tone; optional exponential pitch glide f0 → f1 (phase-integrated)."""
    t = tt(n)
    if f1 is None or abs(f1 - f0) < 1e-9:
        ph = 2 * np.pi * f0 * t
    else:
        k = np.log(f1 / f0) / max(t[-1], 1e-9)
        ph = 2 * np.pi * f0 * (np.exp(k * t) - 1) / k
    return np.sin(ph + phase) * env(n, atk, tau) * amp

def fm(n: int, fc: float, ratio: float = 2.0, index: float = 2.0, tau: float = 0.2,
       atk: float = 0.003, fc1: float | None = None, amp: float = 1.0) -> np.ndarray:
    """FM voice (carrier + ratio modulator + decaying envelope); the `fc1` glide keeps it moving."""
    t = tt(n)
    fc_t = np.full(n, fc) if fc1 is None else fc * (fc1 / fc) ** (t / max(t[-1], 1e-9))
    ph = 2 * np.pi * np.cumsum(fc_t) / SR
    mod = np.sin(2 * np.pi * ratio * np.cumsum(fc_t) / SR)
    return np.sin(ph + index * mod) * env(n, atk, tau) * amp

def grains(n: int, times, f_lo: float, f_hi: float, dur: float = 0.008, amp: float = 0.2,
           seed: int = 7) -> np.ndarray:
    """particle sparkles: tiny band-passed noise bursts at the given times, randomised centre/length."""
    out = np.zeros(n)
    rng = np.random.default_rng(seed)
    for t0 in times:
        i0 = int(t0 * SR)
        if i0 >= n:
            continue
        m = int(dur * SR * rng.uniform(0.6, 1.6))
        c = rng.uniform(f_lo, f_hi)
        g = bp(noise(m, seed + i0), c * 0.75, c * 1.35, 2) * env(m, 0.0006, dur * 0.4) * amp
        out[i0:i0 + len(g)] += g[:max(0, n - i0)]
    return out

def _ir(dur: float, tau: float, damp: float, seed: int) -> np.ndarray:
    n = n_of(dur)
    x = np.random.default_rng(seed).standard_normal(n) * np.exp(-tt(n) / tau)
    x = lp(x, damp, 2)
    x[:int(0.002 * SR)] *= np.linspace(0, 1, int(0.002 * SR))
    return x / (np.sqrt((x * x).sum()) + 1e-9)

def verb(x: np.ndarray, dur: float = 0.35, tau: float = 0.13, damp: float = 3500,
         mix: float = 0.16, seed: int = 3) -> np.ndarray:
    """short designed reverb tail: convolve with a synthetic damped-noise impulse, mix under the dry."""
    wet = signal.fftconvolve(x, _ir(dur, tau, damp, seed))[:len(x) + n_of(dur) // 2]
    wet = wet / (np.max(np.abs(wet)) + 1e-9)
    out = np.zeros(len(wet))
    out[:len(x)] += x
    out += wet * (np.max(np.abs(x)) + 1e-9) * mix
    return out

def pad(x: np.ndarray, dur: float) -> np.ndarray:
    n = n_of(dur)
    if len(x) >= n:
        return x[:n]
    return np.concatenate([x, np.zeros(n - len(x))])

def norm(x: np.ndarray, peak_db: float = -1.65, rms_db: float | None = None) -> np.ndarray:
    """scale toward the role's RMS target but never above the peak ceiling (cap-only, never boosts past it).

    The ceiling is clamped to ≥ −1.65 dBFS: Vorbis decoding of transient-rich content overshoots the
    encoded peak by up to ~0.6 dB measured on this pack, and the audit gates the decoded files at
    ≤ −1 dBFS."""
    p = np.max(np.abs(x)) + 1e-12
    scale = (10 ** (min(peak_db, -1.65) / 20)) / p
    if rms_db is not None:
        r = np.sqrt(np.mean(x * x)) + 1e-12
        scale = min(scale, (10 ** (rms_db / 20)) / r)
    return x * scale

def loop_fix(x: np.ndarray, dur: float, search: float = 1.2) -> np.ndarray:
    """
    Seamless loop with a *measured* seam (audit §5E: ≤ −45 dB rel. peak, target −50): render longer
    than `dur`, slide the loop window across the search span and take the offset whose mid-signal
    sample step across the wrap is smallest (ties broken by wrap-slope mismatch), then glue the
    endpoints — a linear correction over the last 120 ms makes the final sample exactly equal the
    first, removing any value step at the wrap (standard boundary-match technique for beds; the
    correction is < −35 dB rel. peak and spread over 120 ms, i.e. inaudible next to the bed's own
    modulation).
    """
    n = n_of(dur)
    mid = x.mean(axis=0) if x.ndim > 1 else x
    m = max(1, min(n_of(search), len(mid) - n - 1))
    i = np.arange(m)
    d = mid[i] - mid[i + n]
    ds = (mid[i + 1] - mid[i]) - (mid[i + n] - mid[i + n - 1])
    best = int(np.argmin(np.abs(d) + 0.05 * np.abs(ds)))
    seg = x[..., best:best + n] if x.ndim > 1 else x[best:best + n]
    raw_step = abs(float(mid[best]) - float(mid[best + n]))
    g = max(1, n_of(0.120))
    delta = (seg[..., :1] - seg[..., -1:]) * np.linspace(0.0, 1.0, g)
    seg = seg.copy()
    seg[..., -g:] += delta
    mono = seg.mean(axis=0) if seg.ndim > 1 else seg
    step = abs(float(mono[0]) - float(mono[-1]))
    peak = float(np.max(np.abs(seg))) + 1e-12
    print(f'    loop seam: raw best step {20 * np.log10(raw_step / peak + 1e-12):6.1f} dB, '
          f'glued {20 * np.log10(step / peak + 1e-12):6.1f} dB rel peak')
    return seg

def fade_edges(x: np.ndarray, ms: float = 2.0) -> np.ndarray:
    n = n_of(ms / 1000)
    y = x.copy()
    y[:n] *= np.linspace(0, 1, n)
    y[-n:] *= np.linspace(1, 0, n)
    return y

def dup(x: np.ndarray) -> np.ndarray:
    return np.stack([x, x])

def decorrelate(x: np.ndarray, seed: int, ms: float = 0.0) -> np.ndarray:
    """stereo pair from one mono source: tiny all-pass-style phase scatter (for beds)."""
    n = len(x)
    a = x
    b = np.roll(x, int(0.004 * SR)) * 0.92 + noise(n, seed) * 0.08 * np.abs(x).mean() * 8
    d = int(ms * SR / 1000)
    if d:
        b = np.concatenate([np.zeros(d), x])[:n]
    return np.stack([a, b])

# ====================================================================================================== recipes
# Each recipe returns a mono (n,) or stereo (2, n) float array. Role loudness targets (audit §5E):
#   impacts/feedback −16±2 · launches/casts −20±2 · split windups −22±2 · split impacts −16±2 ·
#   UI/stingers −18±2 · beds −22±3 (the manifest gain restores the shipped mix level).
# Frequent fight cues also follow the small-speaker rule: <30 % below 120 Hz, ≥15 % above 1 kHz,
# no single band >60 %. Peak ceilings sit at −1.5 dBFS so Vorbis decode overshoot stays ≤ −1 dBFS.

def swing_light(v: int) -> np.ndarray:
    """Light weapon swish: moving band 1.6k→450 with body underneath and an air layer. 3 takes."""
    dur = 0.22 + 0.02 * (v - 2)
    n = n_of(dur)
    rng = np.random.default_rng(40 + v)
    body = tv_band(noise(n, 40 + v), [(0, 1500 + v * 180), (dur * .55, 700 + v * 90), (dur, 380)], q=1.15)
    bulk = bp(noise(n, 140 + v), 120, 420, 2) * env(n, 0.015, 0.085) * 0.5
    air = hp(noise(n, 240 + v), 4200, 2) * env(n, 0.012, 0.05) * (0.16 + 0.03 * v)
    x = cream(body * env(n, 0.014, 0.16) + bulk * rng.uniform(.85, 1.05) + air, 1.8)
    return norm(fade_edges(verb(x, .22, .09, 5000, .10, seed=5 + v)), -1.5, -19.0)

def impact_light(v: int) -> np.ndarray:
    """Light melee impact: slap-forward — slap + click over a short controlled body. 3 takes.

    The 1.5–5 kHz slap and the click carry the hit on phone speakers (audit §5E small-speaker rule);
    the sub stays tiny and no single band dominates."""
    n = n_of(0.24 + 0.02 * (v - 2))
    click = hp(noise(n, 60 + v), 2900 + v * 170, 2) * env(n, 0.0006, 0.006 + 0.0015 * v) * 0.85
    slap = bp(noise(n, 80 + v), 1500 + v * 210, 4900 + v * 230, 2) * env(n, 0.001, 0.18 + 0.02 * v) * 0.95
    sizzle = bp(noise(n, 90 + v), 2400, 8200, 2) * env(n, 0.002, 0.09) * 0.4
    body = reso(n, 172 - v * 6, 128 - v * 4, tau=0.08, atk=0.001, amp=0.3)
    wood = reso(n, 330 + v * 20, 255, tau=0.05, atk=0.001, amp=0.16)
    mid2 = reso(n, 560 - v * 8, 500, tau=0.065, atk=0.001, amp=0.22)
    sub = reso(n, 88, 68, tau=0.04, atk=0.001, amp=0.12)
    x = cream(click + slap + sizzle + body + wood + mid2 + sub, 1.25)
    return norm(fade_edges(verb(x, .2, .08, 5000, .1, seed=9 + v)), -1.5, -16.0)

def impact_heavy() -> np.ndarray:
    """Heavy melee impact: stone crunch — crack + slap + a short controlled sub, all reading small."""
    n = n_of(0.44)
    click = hp(noise(n, 90), 2600, 2) * env(n, 0.0005, 0.008) * 0.85
    crack = bp(noise(n, 91), 900, 3600, 2) * env(n, 0.001, 0.2) * 1.3
    slap = bp(noise(n, 92), 1800, 6200, 2) * env(n, 0.001, 0.075) * 0.85
    sizzle = bp(noise(n, 93), 2500, 8500, 2) * env(n, 0.003, 0.13) * 0.75
    sub = reso(n, 96, 58, tau=0.1, atk=0.001, amp=0.22)
    body = reso(n, 232, 168, tau=0.12, atk=0.001, amp=0.4)
    wood = reso(n, 336, 300, tau=0.06, atk=0.001, amp=0.28)
    ring = reso(n, 585, 560, tau=0.16, atk=0.002, amp=0.12)
    x = cream(click + crack + slap + sizzle + sub + body + wood + ring, 1.3)
    return norm(fade_edges(verb(x, .34, .16, 4200, .16, seed=11)), -1.5, -16.0)

def ranged_launch() -> np.ndarray:
    """Bow release: string twang + pluck body + a short arrow whoosh that cuts on small speakers."""
    n = n_of(0.30)
    pluck = reso(n, 300, 168, tau=0.07, atk=0.001, amp=0.3)
    pluck2 = reso(n, 604, 332, tau=0.05, atk=0.001, amp=0.18)
    twang = reso(n, 640, 240, tau=0.045, atk=0.0008, amp=0.22)
    whoosh = bp(noise(n, 310), 1700, 5200, 2) * env(n, 0.001, 0.1) * 1.2
    air = hp(noise(n, 312), 3600, 2) * env(n, 0.0015, 0.055) * 0.75
    string = bp(noise(n, 311), 250, 900, 2) * env(n, 0.001, 0.035) * 0.3
    x = cream(pluck + pluck2 + twang + whoosh + air + string, 1.2)
    return norm(fade_edges(verb(x, .25, .1, 5000, .12, seed=13)), -1.5, -19.5)

def magic_launch() -> np.ndarray:
    """Arcane release: rising FM bell + shimmer band + soft low foundation — no flat hum."""
    n = n_of(0.42)
    bell = fm(n, 500, ratio=2.01, index=2.4, tau=0.16, atk=0.004, fc1=880, amp=0.8)
    shimmer = tv_band(noise(n, 330), [(0.02, 2400), (0.2, 5200), (0.4, 7200)], q=0.9) * env(n, 0.03, 0.16) * 0.35
    spark = grains(n, [0.03, 0.09, 0.16, 0.24, 0.31], 5000, 9500, 0.006, 0.35, seed=301)
    lowb = reso(n, 128, 110, tau=0.13, atk=0.01, amp=0.3)
    x = bell + shimmer + spark + lowb
    return norm(fade_edges(verb(x, .4, .18, 6000, .18, seed=15)), -1.2, -19.5)

def magic_impact_neutral() -> np.ndarray:
    """Neutral magic impact: hollow energy pop under a wide sizzle top — no single band dominates."""
    n = n_of(0.42)
    pop = reso(n, 690, 240, tau=0.1, atk=0.001, amp=0.34)
    hollow = fm(n, 410, ratio=1.41, index=1.6, tau=0.1, atk=0.002, amp=0.3)
    sizzle = bp(noise(n, 350), 2600, 8500, 2) * env(n, 0.001, 0.2) * 1.3
    tick = hp(noise(n, 351), 5200, 2) * env(n, 0.0005, 0.006) * 0.7
    sub = reso(n, 104, 72, tau=0.08, atk=0.001, amp=0.18)
    x = cream(pop + hollow + sizzle + tick + sub, 1.25)
    return norm(fade_edges(verb(x, .3, .13, 5000, .14, seed=17)), -1.5, -17.0)

def hero_hit() -> np.ndarray:
    """Personal damage feedback: a sharp mid-high tick that reads on phone speakers (sub < 10 %)."""
    n = n_of(0.24)
    tick = bp(noise(n, 370), 1500, 4300, 2) * env(n, 0.0006, 0.15) * 1.5
    click = hp(noise(n, 371), 4200, 2) * env(n, 0.0005, 0.012) * 1.0
    knock = reso(n, 245, 182, tau=0.08, atk=0.001, amp=0.26)
    mid = reso(n, 520, 430, tau=0.04, atk=0.001, amp=0.1)
    sub = reso(n, 90, 72, tau=0.035, atk=0.001, amp=0.09)
    x = cream(tick + click + knock + mid + sub, 1.25)
    return norm(fade_edges(verb(x, .2, .08, 5000, .1, seed=19)), -1.5, -16.0)

def grass_step(v: int) -> np.ndarray:
    """One grass footfall (4 takes): muffled low body + leafy rustle with grain accents, level-matched."""
    dur = [0.17, 0.17, 0.18, 0.16][v - 1]
    n = n_of(dur)
    rng = np.random.default_rng(500 + v)
    lowf = [138, 122, 130, 148][v - 1]
    body = reso(n, lowf, lowf * 0.72, tau=0.055 + 0.008 * (v % 2), atk=0.002, amp=0.6)
    c_lo = [520, 620, 460, 560][v - 1]
    rustle = bp(noise(n, 520 + v), c_lo, c_lo * 3.1, 2) * env(n, 0.004, 0.075 + 0.012 * (v == 3))
    accents = grains(n, sorted(rng.uniform(0.012, dur * 0.55, 2 + v % 2)), 2600, 6400, 0.006,
                     amp=0.5, seed=540 + v)
    x = body + rustle * 0.8 + accents + hp(noise(n, 560 + v), 3600, 2) * env(n, 0.003, 0.03) * 0.12
    return norm(fade_edges(x, 1.5), -1.2, -21.0)

def water_step(v: int) -> np.ndarray:
    """One water footfall (3 takes): splash burst + droplet blips + soft low entry."""
    n = n_of(0.20 + 0.01 * (v % 2))
    n_ = n
    splash = bp(noise(n_, 600 + v), 1200 + 140 * v, 3600 + 160 * v, 2) * env(n_, 0.0015, 0.06 + 0.01 * v) * 0.9
    rng = np.random.default_rng(600 + v)
    drops = np.zeros(n_)
    for i in range(3):
        t0 = rng.uniform(0.02, 0.1)
        f0 = rng.uniform(420, 940)
        blip = reso(n_, f0, f0 * 1.45, tau=0.02, atk=0.0006, amp=0.4)
        i0 = int(t0 * SR)
        drops[i0:i0 + len(blip)] += blip[:max(0, n_ - i0)]
    low = lp(noise(n_, 640 + v), 330, 2) * env(n_, 0.002, 0.05) * 0.4
    tick = hp(noise(n_, 660 + v), 5400, 2) * env(n_, 0.0005, 0.004) * 0.35
    x = splash + drops + low + tick
    return norm(fade_edges(x, 1.5), -1.2, -20.5)

def arcane_strike() -> np.ndarray:
    """AK Q cue: an upward sword sweep wrapped in resonant arcane energy (cast → bolt)."""
    n = n_of(0.55)
    sweep = tv_band(noise(n, 700), [(0, 700), (0.22, 2200), (0.46, 3100)], q=1.3) * env(n, 0.02, 0.2)
    ring = fm(n, 620, ratio=2.76, index=2.6, tau=0.28, atk=0.006, fc1=880, amp=0.55)
    ring2 = fm(n, 930, ratio=1.5, index=1.4, tau=0.2, atk=0.01, fc1=1240, amp=0.3)
    spark = grains(n, [0.1, 0.2, 0.3, 0.38], 5500, 10000, 0.005, 0.3, seed=701)
    metal = reso(n, 1750, 1600, tau=0.09, atk=0.001, amp=0.14)
    x = sweep * 0.9 + ring + ring2 + spark + metal
    return norm(fade_edges(verb(x, .42, .19, 6500, .2, seed=21)), -1.2, -19.5)

def arcane_shield() -> np.ndarray:
    """AK W: crystalline ward activation — ringing glass chord, tight envelope, no low swell."""
    n = n_of(0.60)
    c1 = fm(n, 523, ratio=2.4, index=1.8, tau=0.32, atk=0.01, amp=0.5)
    c2 = fm(n, 659, ratio=2.76, index=1.6, tau=0.3, atk=0.015, amp=0.45)
    c3 = fm(n, 784, ratio=3.5, index=1.2, tau=0.26, atk=0.02, amp=0.35)
    shimmer = tv_band(noise(n, 720), [(0.02, 3600), (0.3, 6200)], q=0.9) * env(n, 0.09, 0.2) * 0.22
    glass = grains(n, [0.05, 0.14, 0.23, 0.33, 0.43], 7000, 11000, 0.005, 0.25, seed=721)
    body = reso(n, 196, 178, tau=0.22, atk=0.01, amp=0.2)
    x = c1 + c2 + c3 + shimmer + glass + body
    return norm(fade_edges(verb(x, .45, .2, 7500, .22, seed=23)), -1.2, -18.5)

def smoke_veil() -> np.ndarray:
    """SH E: dark airy bloom — purely noise-based (no tonal pitch), sinking centre."""
    n = n_of(0.52)
    bloom = tv_band(noise(n, 740), [(0.02, 420), (0.25, 260), (0.5, 170)], q=0.7) * env(n, 0.12, 0.22)
    hiss = hp(noise(n, 741), 4200, 2) * env_rise(n, 0.15) * env(n, 0.16, 0.2) * 0.2
    sub_air = lp(noise(n, 742), 190, 2) * env(n, 0.1, 0.25) * 0.32
    puff = bp(noise(n, 743), 500, 1400, 2) * env(n, 0.008, 0.08) * 0.4
    x = bloom + hiss + sub_air + puff
    return norm(fade_edges(verb(x, .5, .24, 3200, .2, seed=25)), -1.2, -18.5)

def fire_bolt() -> np.ndarray:
    """EM Q: hot launch — compact warm push + prominent crackle, readable on small speakers."""
    n = n_of(0.46)
    whoosh = tv_band(noise(n, 760), [(0, 620), (0.18, 380), (0.4, 300)], q=1.0) * env(n, 0.012, 0.14) * 0.5
    roar = lp(noise(n, 761), 240, 2) * env(n, 0.02, 0.2) * 0.35
    warm = fm(n, 385, ratio=1.0, index=1.1, tau=0.1, atk=0.004, fc1=300, amp=0.22)
    rng = np.random.default_rng(762)
    crack = grains(n, sorted(rng.uniform(0.02, 0.38, 11)), 3200, 7500, 0.006, amp=0.55, seed=763)
    fizz = bp(noise(n, 764), 2600, 9000, 2) * env(n, 0.002, 0.17) * 1.0
    x = cream(whoosh + roar + warm + crack + fizz, 1.8)
    return norm(fade_edges(verb(x, .35, .15, 5200, .14, seed=27)), -1.5, -19.5)

def burning_zone_ignition() -> np.ndarray:
    """EM E: ignition driven by 2–8 kHz crackle over a soft whoomp (audit: V1 was 77 % <120 Hz)."""
    n = n_of(0.55)
    whoomp = reso(n, 165, 96, tau=0.1, atk=0.003, amp=0.18)
    fire = lp(noise(n, 780), 900, 2) * env(n, 0.008, 0.26) * 0.8
    rng = np.random.default_rng(781)
    crack = grains(n, sorted(rng.uniform(0.015, 0.42, 26)), 2400, 8000, 0.006, amp=0.7, seed=782)
    fizz = bp(noise(n, 783), 2800, 9000, 2) * env(n, 0.002, 0.19) * 1.35
    ember = bp(noise(n, 784), 1800, 6500, 2) * env(n, 0.004, 0.34) * 1.5
    x = cream(whoomp + fire + crack + fizz + ember, 1.25)
    return norm(fade_edges(verb(x, .4, .18, 5000, .16, seed=29)), -1.5, -15.5)

def healing_seed() -> np.ndarray:
    """NG Q: warm organic growth — marimba-like FM notes over a leaf rustle (no UI chime)."""
    n = n_of(0.55)
    a = fm(n, 392, ratio=3.5, index=1.1, tau=0.24, atk=0.008, amp=0.6)
    b = fm(n, 523, ratio=3.5, index=1.0, tau=0.26, atk=0.008, amp=0.5)
    b = np.concatenate([np.zeros(n_of(0.11)), b])[:n]
    rustle = bp(noise(n, 800), 1600, 4800, 2) * env(n, 0.03, 0.2) * 0.3
    warm = reso(n, 196, 196, tau=0.2, atk=0.01, amp=0.22)
    x = a + b + rustle + warm
    return norm(fade_edges(verb(x, .45, .2, 5500, .18, seed=31)), -1.2, -18.5)

def nature_barrier() -> np.ndarray:
    """NG E: organic ward — leaf rustle + low wooden resonance (no glassy chord)."""
    n = n_of(0.60)
    rustle = tv_band(noise(n, 820), [(0.02, 1800), (0.3, 3200)], q=0.9) * env(n, 0.07, 0.26)
    wood = reso(n, 222, 208, tau=0.26, atk=0.01, amp=0.5)
    wood2 = reso(n, 333, 320, tau=0.2, atk=0.02, amp=0.3)
    soil = lp(noise(n, 821), 260, 2) * env(n, 0.05, 0.2) * 0.35
    leaf = grains(n, [0.1, 0.22, 0.36, 0.48], 3000, 7000, 0.006, 0.3, seed=822)
    x = rustle * 0.8 + wood + wood2 + soil + leaf
    return norm(fade_edges(verb(x, .48, .22, 4200, .18, seed=33)), -1.2, -18.5)

def lightning_punch() -> np.ndarray:
    """SW Q: electric impact — sharp crack first, zap body, controlled thump (sub < 30%)."""
    n = n_of(0.30)
    crack = hp(noise(n, 840), 2800, 2) * env(n, 0.0004, 0.006) * 1.0
    slap = bp(noise(n, 841), 900, 2600, 2) * env(n, 0.0008, 0.02) * 0.7
    zap = reso(n, 1400, 180, tau=0.11, atk=0.001, amp=0.5) + reso(n, 2800, 360, tau=0.07, atk=0.001, amp=0.25)
    thump = reso(n, 118, 74, tau=0.09, atk=0.001, amp=0.5)
    sparks = grains(n, [0.004, 0.03, 0.07, 0.12], 6000, 11000, 0.004, amp=0.35, seed=842)
    x = crack + slap + zap + thump + sparks
    return norm(fade_edges(verb(x, .26, .11, 5000, .13, seed=35)), -1.2, -15.5)

def static_field() -> np.ndarray:
    """SW W: a charged field cast — crackling electric air over a compact hum foundation."""
    n = n_of(0.85)
    hum = reso(n, 138, 138, tau=0.5, atk=0.04, amp=0.2) + reso(n, 276, 276, tau=0.4, atk=0.04, amp=0.12)
    air = bp(noise(n, 860), 2200, 7200, 2) * env_rise(n, 0.3) * env(n, 0.4, 0.3) * 0.8
    rng = np.random.default_rng(861)
    micro = grains(n, sorted(rng.uniform(0.05, 0.78, 20)), 3000, 9500, 0.005, amp=0.45, seed=862)
    rise = reso(n, 340, 560, tau=0.45, atk=0.18, amp=0.14)
    spark = hp(noise(n, 863), 5000, 2) * env(n, 0.001, 0.02) * 0.5
    x = cream(hum + air + micro + rise + spark, 1.2)
    return norm(fade_edges(verb(x, .5, .24, 6500, .2, seed=37)), -1.5, -19.0)

def tower_impact() -> np.ndarray:
    """Heavy structure impact: stone crunch + debris rain + a short controlled sub (small-speaker read)."""
    n = n_of(0.55)
    crack = bp(noise(n, 880), 700, 3800, 2) * env(n, 0.0008, 0.08) * 1.1
    debris = bp(noise(n, 881), 2400, 9000, 2) * env(n, 0.004, 0.26) * 0.95
    knock = reso(n, 250, 190, tau=0.09, atk=0.001, amp=0.45)
    sub = reso(n, 104, 62, tau=0.1, atk=0.001, amp=0.3)
    ring = reso(n, 520, 470, tau=0.11, atk=0.002, amp=0.16)
    x = cream(crack + debris + knock + sub + ring, 1.3)
    return norm(fade_edges(verb(x, .4, .18, 4200, .16, seed=39)), -1.5, -16.0)

def core_hit() -> np.ndarray:
    """Core hit: wide metallic toll — hollow crack + bell ring + debris rain (repeats globally)."""
    n = n_of(0.7)
    crack = bp(noise(n, 900), 600, 3800, 2) * env(n, 0.0006, 0.09) * 1.15
    debris = bp(noise(n, 901), 2200, 8500, 2) * env(n, 0.005, 0.5) * 1.05
    toll = fm(n, 392, ratio=1.5, index=1.1, tau=0.28, atk=0.003, amp=0.22)
    toll2 = reso(n, 578, 565, tau=0.24, atk=0.003, amp=0.12)
    ring = reso(n, 1880, 1820, tau=0.16, atk=0.002, amp=0.16)
    sub = reso(n, 78, 52, tau=0.14, atk=0.002, amp=0.28)
    x = cream(crack + debris + toll + toll2 + ring + sub, 1.25)
    return norm(fade_edges(verb(x, .5, .22, 4000, .18, seed=41)), -1.5, -17.5)

def boss_attack() -> np.ndarray:
    """Boss roar-slam: growling harmonic roar (200 Hz–2 kHz body per the audit) + crack + rumble."""
    n = n_of(0.8)
    t = tt(n)
    growl = np.zeros(n)
    for k, a in [(1, .45), (2, .4), (3, .3), (4, .2), (5, .12)]:
        f = 150 * k * (1 - 0.15 * t / t[-1])
        growl += np.sin(2 * np.pi * np.cumsum(f) / SR + k) * a
    am = 0.72 + 0.28 * np.sin(2 * np.pi * 26 * t)
    growl = growl * am * env(n, 0.02, 0.3)
    roar = bp(noise(n, 920), 320, 1700, 2) * env(n, 0.008, 0.26) * 1.5
    crack = bp(noise(n, 921), 1100, 4200, 2) * env(n, 0.0008, 0.06) * 1.8
    debris = bp(noise(n, 922), 2500, 8500, 2) * env(n, 0.004, 0.18) * 1.4
    sub = reso(n, 98, 62, tau=0.16, atk=0.005, amp=0.3)
    x = cream(growl * 0.55 + roar + crack + debris + sub, 1.25)
    return norm(fade_edges(verb(x, .45, .2, 3600, .16, seed=43)), -1.5, -17.5)

def level_up() -> np.ndarray:
    """Level-up: a growing five-note bell arpeggio with a real tail — owns the celebration (≠ hero-select)."""
    n = n_of(1.40)
    x = np.zeros(n)
    notes = [(523.25, 0.0), (659.25, 0.09), (783.99, 0.18), (1046.5, 0.28), (1318.5, 0.40)]
    for i, (f, at) in enumerate(notes):
        v = fm(n, f, ratio=2.76, index=1.6 + 0.1 * i, tau=0.32 + 0.05 * i, atk=0.006, amp=0.55 - 0.05 * i)
        i0 = n_of(at)
        x[i0:i0 + len(v)] += v[:max(0, n - i0)]
    spark = grains(n, [0.42, 0.52, 0.62, 0.75, 0.9], 6000, 12000, 0.005, 0.3, seed=940)
    tail_bell = fm(n, 2093, ratio=2.0, index=1.0, tau=0.5, atk=0.01, amp=0.12)
    tail_bell[:n_of(0.44)] = 0
    x = x + spark + tail_bell
    return norm(fade_edges(verb(x, .85, .34, 8000, .28, seed=45)), -1.2, -18.0)

def wind_loop() -> np.ndarray:
    """Wind bed (stereo): decorrelated filtered noise with slow gusts and a faint air layer.

    Rendered 9.4 s and cropped to the best 8.0 s window so the wrap step lands far below the
    texture's own sample steps (audit §5E seam target); the manifest gain restores the mix level."""
    dur = 9.4
    n = n_of(dur)
    t = tt(n)
    gust = 0.55 + 0.45 * (0.5 + 0.5 * np.sin(2 * np.pi * 0.083 * t + 1.1)) * (0.5 + 0.5 * np.sin(2 * np.pi * 0.047 * t))
    ch = []
    for s, ph in [(950, 0.0), (951, 2.0)]:
        stream = lp(noise(n, s), 520, 2) + bp(noise(n, s + 10), 180, 900, 2) * 0.7
        sway = np.clip(0.6 + 0.4 * np.sin(2 * np.pi * 0.05 * t + ph), 0, 1)
        hi = hp(noise(n, s + 20), 2600, 2) * 0.05 * gust
        ch.append(lp(stream * gust * sway, 700, 2) + hi)
    st = np.stack(ch)
    st = st / (np.max(np.abs(st)) + 1e-9) * 0.62
    st = loop_fix(cream(st, 1.1), 8.0)
    return norm_bed(st, -1.5, -22.0)

def norm_bed(x: np.ndarray, peak_db: float, rms_db: float) -> np.ndarray:
    """bed scaling: RMS target behind the same ≥ −1.65 dBFS peak ceiling (Vorbis overshoot headroom)."""
    p = np.max(np.abs(x)) + 1e-12
    r = np.sqrt(np.mean(x * x)) + 1e-12
    scale = min((10 ** (min(peak_db, -1.65) / 20)) / p, (10 ** (rms_db / 20)) / r)
    return x * scale

# ----------------------------------------------------------------------------------------- split wind-ups / impacts

def ground_slam_windup() -> np.ndarray:
    n = n_of(0.50)
    t = tt(n)
    rise = env_rise(n, 0.42)
    rumble = lp(noise(n, 1000), 220, 2) * rise * 0.55
    mid = reso(n, 170, 232, tau=0.4, atk=0.18, amp=0.3)
    sub = reso(n, 58, 92, tau=0.4, atk=0.3, amp=0.3)
    whip = tv_band(noise(n, 1001), [(0, 300), (0.4, 900)], q=1.0) * env(n, 0.05, 0.2) * 0.4
    air = bp(noise(n, 1002), 700, 3000, 2) * rise * 0.3
    x = rumble + mid + sub + whip + air
    return norm(fade_edges(verb(x, .3, .14, 3000, .12, seed=47)), -1.5, -21.5)

def ground_slam_impact() -> np.ndarray:
    n = n_of(0.55)
    sub = reso(n, 84, 48, tau=0.14, atk=0.001, amp=0.23)
    knock = reso(n, 175, 120, tau=0.09, atk=0.001, amp=0.4)
    crack = bp(noise(n, 1010), 900, 3200, 2) * env(n, 0.0008, 0.07) * 1.1
    debris = bp(noise(n, 1012), 2400, 9000, 2) * env(n, 0.004, 0.2) * 0.8
    wave = lp(noise(n, 1011), 300, 2) * env(n, 0.004, 0.3) * 0.4
    x = cream(sub + knock + crack + debris + wave, 1.3)
    return norm(fade_edges(verb(x, .45, .2, 3800, .2, seed=49)), -1.5, -16.0)

def meteor_prison_windup() -> np.ndarray:
    n = n_of(0.95)
    t = tt(n)
    rise = env_rise(n, 0.7, 0.08)
    sub = reso(n, 46, 84, tau=0.7, atk=0.1, amp=0.42)
    air = tv_band(noise(n, 1020), [(0, 500), (0.5, 1500)], q=1.0) * rise * 0.55
    whistle = fm(n, 1240, ratio=1.0, index=0.25, tau=0.6, atk=0.15, fc1=430, amp=0.3)
    pulse = np.zeros(n)
    for at, a in [(0.18, .3), (0.42, .45), (0.62, .6)]:
        p = reso(n, 68, 64, tau=0.09, atk=0.004, amp=a)
        i0 = n_of(at)
        pulse[i0:i0 + len(p)] += p[:max(0, n - i0)]
    bell = fm(n, 233, ratio=1.5, index=1.2, tau=0.4, atk=0.05, amp=0.2)
    x = sub + air + whistle + pulse + bell
    return norm(fade_edges(verb(x, .4, .2, 3000, .14, seed=51)), -1.5, -21.0)

def meteor_prison_impact() -> np.ndarray:
    n = n_of(0.70)
    sub = reso(n, 92, 44, tau=0.16, atk=0.001, amp=0.26)
    knock = reso(n, 200, 140, tau=0.1, atk=0.001, amp=0.5)
    crack = bp(noise(n, 1030), 1100, 3800, 2) * env(n, 0.0008, 0.05) * 1.2
    debris = bp(noise(n, 1032), 2400, 9500, 2) * env(n, 0.004, 0.24) * 0.9
    sparks = grains(n, [0.05, 0.14, 0.26, 0.4], 3000, 8000, 0.007, amp=0.45, seed=1033)
    x = cream(sub + knock + crack + debris + sparks, 1.3)
    return norm(fade_edges(verb(x, .55, .24, 3800, .2, seed=53)), -1.5, -16.0)

def death_mark_windup() -> np.ndarray:
    n = n_of(0.35)
    sting = reso(n, 220, 233, tau=0.3, atk=0.01, amp=0.6)
    sting2 = reso(n, 466, 492, tau=0.24, atk=0.01, amp=0.3)
    hiss = bp(noise(n, 1040), 2000, 6000, 2) * env(n, 0.02, 0.14) * 0.35
    low = lp(noise(n, 1041), 170, 2) * env(n, 0.01, 0.2) * 0.3
    x = sting + sting2 + hiss + low
    return norm(fade_edges(verb(x, .28, .13, 3400, .13, seed=55)), -1.5, -21.5)

def death_mark_burst() -> np.ndarray:
    n = n_of(0.60)
    sub = reso(n, 78, 50, tau=0.16, atk=0.001, amp=0.24)
    swell = tv_band(noise(n, 1050), [(0, 700), (0.3, 300)], q=0.8) * env(n, 0.01, 0.26) * 0.5
    dark = reso(n, 320, 240, tau=0.22, atk=0.002, amp=0.28)
    crack = bp(noise(n, 1052), 1000, 5000, 2) * env(n, 0.0008, 0.12) * 1.1
    hiss = bp(noise(n, 1051), 2800, 9000, 2) * env(n, 0.002, 0.5) * 0.9
    shimmer = bp(noise(n, 1053), 1500, 6000, 2) * env(n, 0.003, 0.3) * 0.6
    x = cream(sub + swell + dark + crack + hiss + shimmer, 1.3)
    return norm(fade_edges(verb(x, .5, .22, 3800, .2, seed=57)), -1.5, -16.0)

def inferno_storm_windup() -> np.ndarray:
    n = n_of(1.20)
    t = tt(n)
    rise = env_rise(n, 0.9, 0.06)
    roar = lp(noise(n, 1060), 320, 2) * rise * 0.5
    mid = reso(n, 148, 210, tau=0.9, atk=0.2, amp=0.22)
    wind = tv_band(noise(n, 1061), [(0, 500), (0.9, 1800)], q=1.0) * rise * 0.5
    rng = np.random.default_rng(1062)
    crack = grains(n, sorted(rng.uniform(0.15, 1.05, 16)), 2600, 8000, 0.006, amp=0.4, seed=1063)
    sub = reso(n, 52, 78, tau=0.9, atk=0.2, amp=0.3)
    x = roar + mid + wind + crack + sub
    return norm(fade_edges(verb(x, .45, .22, 3400, .15, seed=59)), -1.5, -21.0)

def inferno_storm_burst() -> np.ndarray:
    n = n_of(0.90)
    whoomp = reso(n, 150, 80, tau=0.24, atk=0.001, amp=0.24)
    fire = lp(noise(n, 1070), 1100, 2) * env(n, 0.004, 0.4) * 1.0
    rng = np.random.default_rng(1071)
    crack = grains(n, sorted(rng.uniform(0.01, 0.75, 32)), 2400, 8500, 0.008, amp=1.0, seed=1072)
    sizzle = bp(noise(n, 1073), 3000, 9500, 2) * env(n, 0.003, 0.32) * 1.3
    ember = bp(noise(n, 1074), 2000, 7000, 2) * env(n, 0.005, 0.4) * 1.5
    x = cream(whoomp + fire + crack + sizzle + ember, 1.25)
    return norm(fade_edges(verb(x, .55, .24, 4500, .18, seed=61)), -1.5, -16.0)

def thunder_charge_rush() -> np.ndarray:
    n = n_of(0.45)
    t = tt(n)
    rush = tv_band(noise(n, 1080), [(0, 320), (0.3, 1100), (0.44, 1500)], q=1.2) * env(n, 0.03, 0.18)
    hum = reso(n, 140, 150, tau=0.35, atk=0.05, amp=0.3)
    rng = np.random.default_rng(1081)
    static = grains(n, sorted(rng.uniform(0.05, 0.4, 12)), 4000, 9500, 0.005, amp=0.4, seed=1082)
    air = bp(noise(n, 1083), 1500, 6000, 2) * env(n, 0.02, 0.16) * 0.4
    x = rush * 0.9 + hum + static + air
    return norm(fade_edges(verb(x, .3, .14, 5000, .14, seed=63)), -1.5, -21.5)

def thunder_charge_impact() -> np.ndarray:
    n = n_of(0.55)
    crack = hp(noise(n, 1090), 2400, 2) * env(n, 0.0004, 0.01) * 0.7
    boom = reso(n, 104, 52, tau=0.18, atk=0.001, amp=0.24)
    zap = reso(n, 1900, 160, tau=0.15, atk=0.001, amp=0.35)
    debris = bp(noise(n, 1092), 3000, 9500, 2) * env(n, 0.003, 0.22) * 1.2
    roll = lp(noise(n, 1091), 420, 2) * env(n, 0.006, 0.4) * 0.6
    x = cream(crack + boom + zap + debris + roll, 1.5)
    return norm(fade_edges(verb(x, .5, .22, 4000, .18, seed=65)), -1.5, -16.0)

def arrow_impact_poison() -> np.ndarray:
    """Poison arrow impact: wet splat under an acidic fizz hiss — wide-band, small-speaker readable."""
    n = n_of(0.30)
    squish = lp(noise(n, 1100), 430, 2) * env(n, 0.0015, 0.05) * 0.5
    splat = bp(noise(n, 1101), 1000, 3000, 2) * env(n, 0.001, 0.06) * 0.8
    fizz = bp(noise(n, 1103), 2200, 8800, 2) * env(n, 0.001, 0.18) * 1.3
    rng = np.random.default_rng(1104)
    sparks = grains(n, sorted(rng.uniform(0.02, 0.24, 6)), 3500, 8500, 0.005, amp=0.4, seed=1102)
    thud = reso(n, 130, 96, tau=0.06, atk=0.001, amp=0.4)
    wet = reso(n, 300, 210, tau=0.04, atk=0.002, amp=0.2)
    x = cream(squish + splat + fizz + sparks + thud + wet, 1.3)
    return norm(fade_edges(verb(x, .22, .1, 4500, .12, seed=67)), -1.5, -16.5)

def magic_impact_arcane() -> np.ndarray:
    n = n_of(0.42)
    shatter = fm(n, 940, ratio=2.76, index=2.8, tau=0.22, atk=0.001, fc1=700, amp=0.8)
    shard = reso(n, 2100, 1900, tau=0.16, atk=0.001, amp=0.3)
    glass = grains(n, [0.01, 0.05, 0.1, 0.16, 0.24], 6000, 12000, 0.004, amp=0.4, seed=1110)
    sub = reso(n, 96, 70, tau=0.07, atk=0.001, amp=0.25)
    x = shatter + shard + glass + sub
    return norm(fade_edges(verb(x, .34, .15, 7000, .2, seed=69)), -1.2, -15.5)

def magic_impact_fire() -> np.ndarray:
    """Fire magic impact: ember-pop snap over a hot crackle tail — reads on small speakers."""
    n = n_of(0.38)
    pop = reso(n, 520, 190, tau=0.085, atk=0.001, amp=0.38)
    puff = lp(noise(n, 1120), 700, 2) * env(n, 0.002, 0.1) * 0.35
    rng = np.random.default_rng(1121)
    crack = grains(n, sorted(rng.uniform(0.01, 0.24, 16)), 2800, 7800, 0.008, amp=0.7, seed=1122)
    fizz = bp(noise(n, 1123), 2800, 9000, 2) * env(n, 0.001, 0.19) * 1.0
    sub = reso(n, 90, 66, tau=0.06, atk=0.001, amp=0.22)
    x = cream(pop + puff + crack + fizz + sub, 1.25)
    return norm(fade_edges(verb(x, .3, .13, 5000, .15, seed=71)), -1.5, -15.5)

def forest_emitter() -> np.ndarray:
    """Positional jungle-camp bed (mono): leafy mid rustle + faint insect shimmer, measured seam."""
    dur = 9.4
    n = n_of(dur)
    t = tt(n)
    gust = 0.5 + 0.5 * (0.5 + 0.5 * np.sin(2 * np.pi * 0.061 * t + 0.7)) * (0.5 + 0.5 * np.sin(2 * np.pi * 0.11 * t + 2.2))
    leaves = bp(noise(n, 1130), 600, 3000, 2) * gust * 0.9
    air = lp(noise(n, 1131), 480, 2) * 0.6 * gust
    shimmer = hp(noise(n, 1132), 6000, 2) * (0.5 + 0.5 * np.sin(2 * np.pi * 7.5 * t)) * 0.03
    x = loop_fix(leaves + air + shimmer, 8.0)
    return norm_bed(x, -1.5, -22.0)

def river_emitter() -> np.ndarray:
    """Positional river emitter (mono): flow body + burble blips, measured seam."""
    dur = 9.4
    n = n_of(dur)
    flow = lp(noise(n, 1140), 1100, 2) * 0.8 + bp(noise(n, 1141), 500, 3500, 2) * 0.5
    rng = np.random.default_rng(1142)
    x = flow
    for _ in range(9):
        t0 = rng.uniform(0.2, 8.6)
        f0 = rng.uniform(320, 880)
        b = reso(n, f0, f0 * rng.uniform(1.1, 1.5), tau=0.03, atk=0.001, amp=rng.uniform(0.25, 0.5))
        i0 = n_of(t0)
        x[i0:i0 + len(b)] += b[:max(0, n - i0)]
    x = loop_fix(x, 8.0)
    return norm_bed(x, -1.5, -22.0)

# ====================================================================================================== manifest
# pack-relative path → (recipe, channels)  ·  all files listed here are (re)written; V1 files not listed stay untouched.

def take(fn, v, *a):
    return lambda: fn(v, *a)

RECIPES = {
    # ---- combat (remixes + the three-take variation sets) --------------------------------------------------------
    'combat/melee-swing-light.ogg':    (take(swing_light, 1), 1),
    'combat/melee-swing-light-2.ogg':  (take(swing_light, 2), 1),
    'combat/melee-swing-light-3.ogg':  (take(swing_light, 3), 1),
    'combat/melee-impact-light.ogg':   (take(impact_light, 1), 1),
    'combat/melee-impact-light-2.ogg': (take(impact_light, 2), 1),
    'combat/melee-impact-light-3.ogg': (take(impact_light, 3), 1),
    'combat/melee-impact-heavy.ogg':   (impact_heavy, 1),
    'combat/ranged-launch.ogg':        (ranged_launch, 1),
    'combat/magic-launch.ogg':         (magic_launch, 1),
    'combat/magic-impact.ogg':         (magic_impact_neutral, 1),
    'combat/magic-impact-arcane.ogg':  (magic_impact_arcane, 1),
    'combat/magic-impact-fire.ogg':    (magic_impact_fire, 1),
    'combat/arrow-impact-poison.ogg':  (arrow_impact_poison, 1),
    'combat/hero-hit.ogg':             (hero_hit, 1),
    'combat/footstep-grass-1.ogg':     (take(grass_step, 1), 1),
    'combat/footstep-grass-2.ogg':     (take(grass_step, 2), 1),
    'combat/footstep-grass-3.ogg':     (take(grass_step, 3), 1),
    'combat/footstep-grass-4.ogg':     (take(grass_step, 4), 1),
    'combat/footstep-water-1.ogg':     (take(water_step, 1), 1),
    'combat/footstep-water-2.ogg':     (take(water_step, 2), 1),
    'combat/footstep-water-3.ogg':     (take(water_step, 3), 1),
    # ---- heroes --------------------------------------------------------------------------------------------------
    'heroes/arcane-knight/arcane-strike.ogg':      (arcane_strike, 1),
    'heroes/arcane-knight/arcane-shield.ogg':      (arcane_shield, 1),
    'heroes/arcane-knight/ground-slam-windup.ogg': (ground_slam_windup, 1),
    'heroes/arcane-knight/ground-slam-impact.ogg': (ground_slam_impact, 1),
    'heroes/arcane-knight/meteor-prison-windup.ogg': (meteor_prison_windup, 1),
    'heroes/arcane-knight/meteor-prison-impact.ogg': (meteor_prison_impact, 1),
    'heroes/shadow-huntress/smoke-veil.ogg':       (smoke_veil, 1),
    'heroes/shadow-huntress/death-mark-windup.ogg': (death_mark_windup, 1),
    'heroes/shadow-huntress/death-mark-burst.ogg':  (death_mark_burst, 1),
    'heroes/ember-mage/fire-bolt.ogg':              (fire_bolt, 1),
    'heroes/ember-mage/burning-zone-ignition.ogg':  (burning_zone_ignition, 1),
    'heroes/ember-mage/inferno-storm-windup.ogg':   (inferno_storm_windup, 1),
    'heroes/ember-mage/inferno-storm-burst.ogg':    (inferno_storm_burst, 1),
    'heroes/nature-guardian/healing-seed.ogg':      (healing_seed, 1),
    'heroes/nature-guardian/nature-barrier.ogg':    (nature_barrier, 1),
    'heroes/storm-warrior/lightning-punch.ogg':     (lightning_punch, 1),
    'heroes/storm-warrior/static-field.ogg':        (static_field, 1),
    'heroes/storm-warrior/thunder-charge-rush.ogg': (thunder_charge_rush, 1),
    'heroes/storm-warrior/thunder-charge-impact.ogg': (thunder_charge_impact, 1),
    # ---- structures ----------------------------------------------------------------------------------------------
    'structures/tower-impact.ogg': (tower_impact, 1),
    'structures/core-hit.ogg':     (core_hit, 1),
    'structures/boss-attack.ogg':  (boss_attack, 1),
    # ---- ui ------------------------------------------------------------------------------------------------------
    'ui/level-up.ogg': (level_up, 1),
    # ---- ambience ------------------------------------------------------------------------------------------------
    'ambience/wind-loop.ogg':      (wind_loop, 2),
    'ambience/forest-emitter.ogg': (forest_emitter, 1),
    'ambience/river-emitter.ogg':  (river_emitter, 1),
}

def main() -> None:
    out_dir = MASTERS
    report = []
    rendered: dict[str, np.ndarray] = {}
    for rel, (fn, ch) in sorted(RECIPES.items()):
        x = fn()
        if x.ndim == 1 and ch == 2:
            x = np.stack([x, x])
        rendered[rel] = x
    # §5E: take families are level-matched within ±1 dB — scale every member to the quietest take
    for group in [
        ['combat/melee-swing-light.ogg', 'combat/melee-swing-light-2.ogg', 'combat/melee-swing-light-3.ogg'],
        ['combat/melee-impact-light.ogg', 'combat/melee-impact-light-2.ogg', 'combat/melee-impact-light-3.ogg'],
        ['combat/footstep-grass-1.ogg', 'combat/footstep-grass-2.ogg', 'combat/footstep-grass-3.ogg', 'combat/footstep-grass-4.ogg'],
        ['combat/footstep-water-1.ogg', 'combat/footstep-water-2.ogg', 'combat/footstep-water-3.ogg'],
    ]:
        rs = [float(np.sqrt(np.mean(rendered[k] ** 2))) for k in group]
        tgt = min(rs)
        for k, r in zip(group, rs):
            rendered[k] = rendered[k] * (tgt / (r + 1e-12))
    from scipy.io import wavfile
    for rel, x in sorted(rendered.items()):
        peak = float(np.max(np.abs(x)))
        rms = float(np.sqrt(np.mean(x * x)))
        crest = 20 * np.log10(peak / (rms + 1e-12))
        pdb, rdb = 20 * np.log10(peak + 1e-12), 20 * np.log10(rms + 1e-12)
        clipped = int(np.count_nonzero(np.abs(x) >= 1.0))
        dest = out_dir / (rel[:-4] + '.wav')
        dest.parent.mkdir(parents=True, exist_ok=True)
        wavfile.write(str(dest), SR, x.astype(np.float32).T if x.ndim == 2 else x.astype(np.float32))
        dur = len(x) / SR if x.ndim == 1 else x.shape[1] / SR
        report.append(f'{rel:48s} dur {dur:5.2f}s ch {x.shape[0] if x.ndim == 2 else 1} peak {pdb:6.2f} rms {rdb:6.2f} crest {crest:5.1f} clip {clipped}')
    (HERE / 'render_report.txt').write_text('\n'.join(report) + '\n', encoding='utf-8')
    print('\n'.join(report))
    clipped = [r.split()[0] for r in report if not r.endswith('clip 0')]
    hot = [r for r in report if float(r.split('peak')[1].split()[0]) > -1.45]
    if clipped or hot:
        print(f'\nWARNING: {len(clipped)} clipped · {len(hot)} files above -1.45 dBFS')
    print(f'\n{len(report)} masters written to {MASTERS}')

if __name__ == '__main__':
    main()
