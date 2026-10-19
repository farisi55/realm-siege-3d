#!/usr/bin/env python3
"""
Realm Siege 3D — Sound Pack V2 audit: measurable signal analysis for all 62 pack files.

Reads the decoded WAVs (ffmpeg, native sample rate/channels) from the temp dir and writes
`metrics.json` next to this script. No game or audio file is modified.

Metrics per file:
  duration / sample rate / channels / vorbis bitrate (ffprobe), manifest cross-check
  peak dBFS, RMS dBFS, crest factor, clipped-sample count, DC offset
  leading/trailing silence, silent-frame fraction, effective end, energy-centroid time
  band energy shares 20 Hz–20 kHz (8 bands), spectral centroid, flatness, rolloff85
  RMS-envelope bursts (major transients with times — for combined cast/impact timing), attack time
  stereo side/mid level, loop-seam discontinuity, md5 of file + of decoded PCM
  near-duplicate detection (log-band + envelope fingerprint cosine similarity)

All numbers are objective; no listening judgement is made here.
"""
import json
import hashlib
import subprocess
import wave
from pathlib import Path

import numpy as np

REPO = Path(__file__).resolve().parents[2]
PACK = REPO / 'public' / 'audio' / 'realm-siege'
WAV = Path(r'C:/Users/banu.farisi/AppData/Local/Temp/opencode/realm_audit_wav')
MANIFEST = REPO / 'doc' / 'realm_siege_3d_sound_pack_v1' / 'sound_manifest.json'
OUT = Path(__file__).resolve().parent / 'metrics.json'

# ------------------------------------------------------------------------------------------------------------- mapping
# file -> { defs (audio definition names the file backs), mid (manifest id), trigger, cat, group }
# Derived from src/audio/pack.ts (verbatim) and the sim/ability cue tables.
M = {
    # 1) melee & ranged combat -----------------------------------------------------------------------------------
    'combat/melee-swing-light.ogg':  dict(defs=['swing'],      mid='combat.melee_swing_light',  cat=1, group='Melee', trigger='Melee wind-up, non-hero attacker (creep/neutral swing cue)'),
    'combat/melee-swing-heavy.ogg':  dict(defs=['swingHeavy'], mid='combat.melee_swing_heavy',  cat=1, group='Melee', trigger='Melee wind-up, hero attacker (kind="hero")'),
    'combat/melee-impact-light.ogg': dict(defs=['hitMelee'],      mid='combat.melee_impact_light', cat=1, group='Melee', trigger='Confirmed melee hit, non-hero attacker'),
    'combat/melee-impact-heavy.ogg': dict(defs=['hitMeleeHeavy'], mid='combat.melee_impact_heavy', cat=1, group='Melee', trigger='Confirmed melee hit, hero attacker (src="hero")'),
    'combat/ranged-launch.ogg':      dict(defs=['bowShot'],    mid='combat.ranged_launch',     cat=1, group='Ranged', trigger='Ranged-creep arrow release (launch kind "arrow")'),
    'combat/arrow-impact.ogg':       dict(defs=['hitArrow', 'shPoisonHit'], mid='combat.arrow_impact', cat=1, group='Ranged', trigger='Arrow impact — SHARED: generic arrow tick + Shadow Huntress W poison hit'),
    'combat/magic-launch.ogg':       dict(defs=['magicShot'],  mid='combat.magic_launch',      cat=1, group='Magic', trigger='Core bolt release (launch kind "magic")'),
    'combat/magic-impact.ogg':       dict(defs=['hitMagic', 'akStrikeHit', 'emFireHit'], mid='combat.magic_impact', cat=1, group='Magic', trigger='Magic impact — SHARED: core bolt + AK Q hit + EM Q hit'),
    'combat/shield-impact.ogg':      dict(defs=[], mid='combat.shield_impact', cat=1, group='Magic', trigger='UNUSED — no shield/absorb mechanic in the game'),
    # 2) damage & death ------------------------------------------------------------------------------------------
    'combat/hero-hit.ogg':     dict(defs=['heroHit'], mid='combat.hero_hit',     cat=2, group='Damage', trigger='Player hero damaged (victim=true, 300 ms sim-clock throttle)'),
    'combat/hero-death.ogg':   dict(defs=['dieBig'],  mid='combat.hero_death',   cat=2, group='Death',  trigger='Any hero falls (die kind="hero"); also used for player death'),
    'combat/hero-respawn.ogg': dict(defs=['respawn'], mid='combat.hero_respawn', cat=2, group='Death',  trigger='Hero respawn timer ends'),
    # 3) heroes --------------------------------------------------------------------------------------------------
    'heroes/arcane-knight/arcane-strike.ogg':   dict(defs=['akStrike'],      mid='heroes/arcane-knight.arcane_strike',   cat=3, group='Arcane Knight', trigger='AK Q cast cue (+250 ms bolt release); hit → combat/magic-impact.ogg'),
    'heroes/arcane-knight/arcane-shield.ogg':   dict(defs=['akShield'],      mid='heroes/arcane-knight.arcane_shield',   cat=3, group='Arcane Knight', trigger='AK W (heal) activation'),
    'heroes/arcane-knight/ground-slam.ogg':     dict(defs=['akSlamWind'],    mid='heroes/arcane-knight.ground_slam',     cat=3, group='Arcane Knight', trigger='AK E — COMBINED clip (wind-up+slam); suppresses fallback akSlamImpact when loaded'),
    'heroes/arcane-knight/meteor-prison.ogg':   dict(defs=['akMeteorBuild'], mid='heroes/arcane-knight.meteor_prison',   cat=3, group='Arcane Knight', trigger='AK R — COMBINED clip (buildup+explosion); suppresses akMeteorImpact when loaded'),
    'heroes/shadow-huntress/shadow-dash.ogg':   dict(defs=['shDash'],        mid='heroes/shadow-huntress.shadow_dash',   cat=3, group='Shadow Huntress', trigger='SH Q dash'),
    'heroes/shadow-huntress/poison-arrow.ogg':  dict(defs=['shPoison'],      mid='heroes/shadow-huntress.poison_arrow',  cat=3, group='Shadow Huntress', trigger='SH W launch; hit → arrow-impact.ogg (shared)'),
    'heroes/shadow-huntress/smoke-veil.ogg':    dict(defs=['shVeil'],        mid='heroes/shadow-huntress.smoke_veil',    cat=3, group='Shadow Huntress', trigger='SH E buff activation'),
    'heroes/shadow-huntress/death-mark.ogg':    dict(defs=['shMark'],        mid='heroes/shadow-huntress.death_mark',    cat=3, group='Shadow Huntress', trigger='SH R — COMBINED clip (mark+burst); suppresses shMarkBurst when loaded'),
    'heroes/ember-mage/fire-bolt.ogg':          dict(defs=['emFireCast'],    mid='heroes/ember-mage.fire_bolt',          cat=3, group='Ember Mage', trigger='EM Q cast cue; hit → magic-impact.ogg (shared)'),
    'heroes/ember-mage/flame-wave.ogg':         dict(defs=['emWave'],        mid='heroes/ember-mage.flame_wave',         cat=3, group='Ember Mage', trigger='EM W area cast'),
    'heroes/ember-mage/burning-zone-ignition.ogg': dict(defs=['emZoneFire'], mid='heroes/ember-mage.burning_zone_ignition', cat=3, group='Ember Mage', trigger='EM E ignition one-shot'),
    'heroes/ember-mage/burning-zone-loop.ogg':  dict(defs=[], mid='heroes/ember-mage.burning_zone_loop', cat=6, group='Unused loops', trigger='UNUSED — zone is instant AoE, no persistent loop exists'),
    'heroes/ember-mage/inferno-storm.ogg':      dict(defs=['emStormBuild'],  mid='heroes/ember-mage.inferno_storm',      cat=3, group='Ember Mage', trigger='EM R — COMBINED clip (storm+bursts); suppresses emStormImpact when loaded'),
    'heroes/nature-guardian/healing-seed.ogg':  dict(defs=['ngSeed'],        mid='heroes/nature-guardian.healing_seed',  cat=3, group='Nature Guardian', trigger='NG Q heal'),
    'heroes/nature-guardian/root-trap.ogg':     dict(defs=['ngRoot'],        mid='heroes/nature-guardian.root_trap',     cat=3, group='Nature Guardian', trigger='NG W root activation'),
    'heroes/nature-guardian/nature-barrier.ogg': dict(defs=['ngBarrier'],    mid='heroes/nature-guardian.nature_barrier', cat=3, group='Nature Guardian', trigger='NG E barrier/heal activation'),
    'heroes/nature-guardian/forest-rebirth.ogg': dict(defs=['ngRebirthBuild'], mid='heroes/nature-guardian.forest_rebirth', cat=3, group='Nature Guardian', trigger='NG R ultimate; heal confirm kept on ngRebirthPulse'),
    'heroes/storm-warrior/lightning-punch.ogg': dict(defs=['swPunchHit'],    mid='heroes/storm-warrior.lightning_punch', cat=3, group='Storm Warrior', trigger='SW Q hit'),
    'heroes/storm-warrior/static-field.ogg':    dict(defs=['swField'],       mid='heroes/storm-warrior.static_field',    cat=3, group='Storm Warrior', trigger='SW W area cast'),
    'heroes/storm-warrior/thunder-charge.ogg':  dict(defs=['swCharge'],      mid='heroes/storm-warrior.thunder_charge',  cat=3, group='Storm Warrior', trigger='SW E — COMBINED clip (rush+thunder); suppresses swChargeHit when loaded'),
    'heroes/storm-warrior/storm-rage.ogg':      dict(defs=['swRage'],        mid='heroes/storm-warrior.storm_rage',      cat=3, group='Storm Warrior', trigger='SW R buff activation'),
    # 4) structures & boss ---------------------------------------------------------------------------------------
    'structures/tower-shot.ogg':     dict(defs=['siegeShot'],      mid='structures.tower_shot',     cat=4, group='Towers', trigger='Tower or siege-engine shot (launch kind "heavy")'),
    'structures/tower-impact.ogg':   dict(defs=['hitHeavy'],       mid='structures.tower_impact',   cat=4, group='Towers', trigger='Heavy projectile impact (tower/siege bolt connected)'),
    'structures/tower-destroy.ogg':  dict(defs=['collapseTower'],  mid='structures.tower_destroy',  cat=4, group='Towers', trigger='Tower destroyed (once, forced)'),
    'structures/core-hit.ogg':       dict(defs=['hitCore'],        mid='structures.core_hit',       cat=4, group='Core',   trigger='Core takes damage (global range)'),
    'structures/core-critical.ogg':  dict(defs=['coreCritical'],   mid='structures.core_critical',  cat=4, group='Core',   trigger='Core first crosses 35 % hp (once per team per match)'),
    'structures/core-destroy.ogg':   dict(defs=['coreCollapse'],   mid='structures.core_destroy',   cat=4, group='Core',   trigger='Core destroyed (once, forced; match end follows)'),
    'structures/boss-attack.ogg':    dict(defs=['bossAttack'],     mid='structures.boss_attack',    cat=4, group='Boss',   trigger='Neutral boss fires (launch kind "boss")'),
    'structures/boss-death.ogg':     dict(defs=['bossDeath'],      mid='structures.boss_death',     cat=4, group='Boss',   trigger='Neutral boss falls (die kind="neutral", big)'),
    # 5) UI & rewards --------------------------------------------------------------------------------------------
    'ui/ui-click.ogg':        dict(defs=['uiClick'],    mid='ui.ui_click',    cat=5, group='Core UI', trigger='Delegated click on any control'),
    'ui/ui-hover.ogg':        dict(defs=['uiHover'],    mid='ui.ui_hover',    cat=5, group='Core UI', trigger='Hover on hero cards/menu rows (90 ms gap; pointer only)'),
    'ui/ui-confirm.ogg':      dict(defs=[],             mid='ui.ui_confirm',  cat=5, group='Core UI', trigger='UNUSED — no distinct confirmation moment (select/buy/match-start own theirs)'),
    'ui/ui-error.ogg':        dict(defs=['uiError'],    mid='ui.ui_error',    cat=5, group='Core UI', trigger='Refused cast/attack or failed buy/sell'),
    'ui/pause.ogg':           dict(defs=['uiPause'],    mid='ui.pause',       cat=5, group='Core UI', trigger='Pause'),
    'ui/resume.ogg':          dict(defs=['uiResume'],   mid='ui.resume',      cat=5, group='Core UI', trigger='Resume'),
    'ui/hero-select.ogg':     dict(defs=['uiSelect'],   mid='ui.hero_select', cat=5, group='Menu & rewards', trigger='Hero card select'),
    'ui/match-start.ogg':     dict(defs=['matchStart'], mid='ui.match_start', cat=5, group='Menu & rewards', trigger='Match begins'),
    'ui/shop-open.ogg':       dict(defs=['shopOpen'],   mid='ui.shop_open',   cat=5, group='Menu & rewards', trigger='Shop opens'),
    'ui/item-purchase.ogg':   dict(defs=['shopBuy'],    mid='ui.item_purchase', cat=5, group='Menu & rewards', trigger='Item bought (sell reuses)'),
    'ui/level-up.ogg':        dict(defs=['uiLevel'],    mid='ui.level_up',    cat=5, group='Menu & rewards', trigger='Hero levels up (watched from HUD snapshot)'),
    'ui/gold-reward.ogg':     dict(defs=['uiGold'],     mid='ui.gold_reward', cat=5, group='Menu & rewards', trigger='Gold gain ≥ 8 in one snapshot (watched; passive income silent)'),
    # 6) music & ambience ----------------------------------------------------------------------------------------
    'ui/victory-stinger.ogg':      dict(defs=['musicVictory'], mid='ui.victory_stinger', cat=6, group='Stingers', trigger='Match victory (once; music bus)'),
    'ui/defeat-stinger.ogg':       dict(defs=['musicDefeat'],  mid='ui.defeat_stinger',  cat=6, group='Stingers', trigger='Match defeat (once; music bus)'),
    'ambience/wind-loop.ogg':      dict(defs=['ambWind'],      mid='ambience.wind_loop',   cat=6, group='Loops', trigger='Non-positional wind bed for the whole match (fade in/out)'),
    'ambience/forest-loop.ogg':    dict(defs=[],               mid='ambience.forest_loop', cat=6, group='Loops', trigger='UNUSED — stereo loop; forest emitters are positional points (def ambForest synthesizes)'),
    'ambience/river-loop.ogg':     dict(defs=[],               mid='ambience.river_loop',  cat=6, group='Loops', trigger='UNUSED — stereo loop; river emitters are positional points (def ambRiver synthesizes)'),
    # 7) footsteps & movement ------------------------------------------------------------------------------------
    'combat/footstep-grass-1.ogg': dict(defs=['stepGrass'],  mid='combat.footstep_grass_1', cat=7, group='Footsteps', trigger='Grass footstep, random pick 1 of 3; stride = speed-based cadence (~3.8/s max)'),
    'combat/footstep-grass-2.ogg': dict(defs=['stepGrass2'], mid='combat.footstep_grass_2', cat=7, group='Footsteps', trigger='Grass footstep, random pick 1 of 3'),
    'combat/footstep-grass-3.ogg': dict(defs=['stepGrass3'], mid='combat.footstep_grass_3', cat=7, group='Footsteps', trigger='Grass footstep, random pick 1 of 3'),
    'combat/move-command.ogg':     dict(defs=['moveCommand'], mid='combat.move_command',     cat=7, group='Movement', trigger='Ground move order (not attack), 90 ms gap; synth stepWater exists for water surfaces (no file)'),
}

LOOPS = {'ambience/wind-loop.ogg', 'ambience/forest-loop.ogg', 'ambience/river-loop.ogg', 'heroes/ember-mage/burning-zone-loop.ogg'}

# ------------------------------------------------------------------------------------------------------------- probe
def probe(p: Path) -> dict:
    r = subprocess.run(['ffprobe', '-v', 'error', '-select_streams', 'a:0', '-show_entries',
                        'stream=codec_name,sample_rate,channels,bit_rate:format=duration,format_tags',
                        '-of', 'json', str(p)], capture_output=True, text=True)
    j = json.loads(r.stdout or '{}')
    st = (j.get('streams') or [{}])[0]
    fm = j.get('format') or {}
    return dict(codec=st.get('codec_name'), sr=int(st['sample_rate']) if st.get('sample_rate') else None,
                channels=int(st['channels']) if st.get('channels') else None,
                bitrate=int(st['bit_rate']) if st.get('bit_rate') else None,
                duration=float(fm['duration']) if fm.get('duration') else None,
                tags=fm.get('format_tags') or {})

# ------------------------------------------------------------------------------------------------------------- math
def dbf(x):
    return 20.0 * np.log10(max(float(x), 1e-9))

def analyze(wav: Path, is_loop: bool) -> dict:
    with wave.open(str(wav), 'rb') as w:
        sr, ch, n = w.getframerate(), w.getnchannels(), w.getnframes()
        raw = w.readframes(n)
    i16 = np.frombuffer(raw, dtype='<i2').astype(np.float64)
    if i16.size == 0:
        return dict(error='empty')
    x = i16.reshape(-1, ch) / 32768.0
    dur = len(x) / sr
    mid = x.mean(axis=1)
    side = (x[:, 0] - x[:, 1]) / 2.0 if ch >= 2 else None

    peak = float(np.abs(x).max())
    rms = float(np.sqrt(np.mean(x ** 2)))
    clipped = int(np.count_nonzero(np.abs(i16) >= 32766))
    near = int(np.count_nonzero(np.abs(i16) >= 32735))  # >= -0.02 dBFS
    dc = float(mid.mean())
    side_mid_db = None
    if side is not None and ch == 2:
        sm = float(np.sqrt(np.mean(side ** 2)))
        mm = float(np.sqrt(np.mean(mid ** 2)))
        side_mid_db = dbf(sm) - dbf(mm) if mm > 1e-9 else None

    # envelope (5 ms frames, non-overlapping)
    hop = max(1, int(sr * 0.005))
    nf = len(mid) // hop
    env = np.sqrt(np.mean(mid[:nf * hop].reshape(nf, hop) ** 2, axis=1)) if nf else np.zeros(0)
    env_db = 20 * np.log10(np.maximum(env, 1e-9))
    # edge-safe 3-tap smoothing (zero-padding would inflate the file start/end)
    sm = np.array([env_db[max(0, i - 1):i + 2].mean() for i in range(nf)]) if nf else env_db
    max_db = float(sm.max()) if nf else -120.0
    silent = sm < -60.0
    lead = float(np.argmax(~silent) * 0.005) if (~silent).any() else dur
    trail_start = len(silent) - int(np.argmax(~silent[::-1])) if (~silent).any() else 0
    need = max_db - 40.0
    eff_idx = np.nonzero(sm > need)[0]
    eff_end = float(eff_idx[-1] * 0.005) if eff_idx.size else 0.0
    att_idx = int(np.argmax(sm)) if nf else 0
    energy = env ** 2
    ecent = float(np.searchsorted(np.cumsum(energy), energy.sum() * 0.5) * 0.005) if energy.sum() > 0 else 0.0

    # bursts: prominent envelope maxima (>= max-15 dB, >= 60 ms apart), strongest first, top 4
    bursts = []
    if nf >= 3:
        wnd = max(1, int(0.06 / 0.005))
        cand = [i for i in range(1, nf - 1) if sm[i] >= sm[i - 1] and sm[i] >= sm[i + 1] and sm[i] >= max_db - 15]
        for i in sorted(cand, key=lambda k: -sm[k]):
            t = i * 0.005
            if all(abs(t - b[0]) >= 0.06 for b in bursts):
                bursts.append((round(t, 3), round(float(sm[i]), 1)))
            if len(bursts) >= 4:
                break
        bursts.sort()

    # STFT
    nfft, hspan = 2048, 1024
    win = np.hanning(nfft)
    frames = max(0, (len(mid) - nfft) // hspan + 1)
    freqs = np.fft.rfftfreq(nfft, 1.0 / sr)
    spec = None
    centroid_sum, flat_sum, wsum = 0.0, 0.0, 0.0
    for k in range(frames):
        seg = mid[k * hspan:k * hspan + nfft] * win
        P = np.abs(np.fft.rfft(seg)) ** 2
        spec = P if spec is None else spec + P
        e = P.sum() + 1e-12
        eps = max(float(P.mean()) * 1e-10, 1e-15)
        centroid_sum += (freqs * P).sum() / e * e
        flat_sum += (np.exp(np.mean(np.log(P + eps))) / (P.mean() + eps)) * e
        wsum += e
    bands_def = [(20, 60), (60, 120), (120, 350), (350, 1000), (1000, 3000), (3000, 6000), (6000, 12000), (12000, 20000)]
    band_shares = {}
    centroid = flatness = roll85 = None
    if spec is not None and wsum > 0:
        centroid = float(centroid_sum / wsum)
        flatness = float(flat_sum / wsum)
        tot = 0.0
        for lo, hi in bands_def:
            m = (freqs >= lo) & (freqs < hi)
            band_shares[f'{lo}-{hi}'] = float(spec[m].sum())
            tot += float(spec[m].sum())
        band_shares = {k: round(v / tot, 4) for k, v in band_shares.items()}
        cum = np.cumsum(spec); roll85 = float(freqs[np.searchsorted(cum, cum[-1] * 0.85)])

    seam = None
    if is_loop:
        seam = float(abs(mid[0] - mid[-1]))
    md5pcm = hashlib.md5(raw).hexdigest()

    return dict(duration=round(dur, 4), sr=sr, channels=ch, frames=n,
                peak_db=round(dbf(peak), 2), rms_db=round(dbf(rms), 2), crest_db=round(dbf(peak) - dbf(rms), 2),
                clipped_samples=clipped, near_fullscale=near, dc_offset=round(dc, 6),
                lead_silence=round(lead, 3), trail_silence=round(max(0.0, dur - eff_end - 0.005), 3) if eff_idx.size else round(dur, 3),
                silence_frac=round(float(silent.mean()), 3) if nf else 1.0,
                effective_end=round(eff_end, 3), attack_time=round(att_idx * 0.005, 3), energy_centroid=round(ecent, 3),
                bursts=bursts, centroid_hz=round(centroid) if centroid else None,
                flatness=round(flatness, 4) if flatness is not None else None,
                roll85_hz=round(roll85) if roll85 else None, bands=band_shares,
                side_minus_mid_db=round(side_mid_db, 2) if side_mid_db is not None else None,
                loop_seam=round(seam, 5) if seam is not None else None,
                md5_file=None, md5_pcm=md5pcm)

def main():
    man = json.loads(MANIFEST.read_text(encoding='utf-8'))
    man_by_file = {s['file']: s for s in man['sounds']}
    files = sorted(str(p.relative_to(PACK)).replace('\\', '/') for p in PACK.rglob('*.ogg'))
    assert len(files) == 62, f'expected 62 files, found {len(files)}'
    out = {}
    for rel in files:
        wav = WAV / (rel.replace('/', '__')[:-4] + '.wav')
        if not wav.exists():
            raise SystemExit(f'missing decoded wav for {rel}')
        pr = probe(PACK / rel)
        a = analyze(wav, rel in LOOPS)
        a['md5_file'] = hashlib.md5((PACK / rel).read_bytes()).hexdigest()
        a['probe'] = pr
        mm = man_by_file.get(rel, {})
        a['manifest'] = dict(id=mm.get('id'), duration=mm.get('durationSeconds'), volume=mm.get('recommendedVolume'),
                             loop=mm.get('loop'), spatial=mm.get('spatial'), description=mm.get('description'),
                             trigger=mm.get('trigger'), dur_delta=round(a['duration'] - mm['durationSeconds'], 4) if mm.get('durationSeconds') else None)
        a.update(M[rel])
        out[rel] = a

    # duplicate checks ---------------------------------------------------------------------------------------
    dup_pcm, dup_file = {}, {}
    for rel, a in out.items():
        dup_file.setdefault(a['md5_file'], []).append(rel)
        dup_pcm.setdefault(a['md5_pcm'], []).append(rel)
    duplicates = dict(exact_file=[v for v in dup_file.values() if len(v) > 1],
                      exact_pcm=[v for v in dup_pcm.values() if len(v) > 1])

    # near-duplicate similarity: normalized [band shares + envelope fingerprint] cosine ----------------------
    def feat(a):
        rel = next(k for k, v in out.items() if v is a)
        p = WAV / (rel.replace('/', '__')[:-4] + '.wav')
        with wave.open(str(p), 'rb') as w:
            sr, ch, n = w.getframerate(), w.getnchannels(), w.getnframes()
            raw = w.readframes(n)
        i16 = np.frombuffer(raw, dtype='<i2').astype(np.float64).reshape(-1, ch) / 32768.0
        mid = i16.mean(axis=1)
        hop = max(1, int(sr * 0.005))
        nf = len(mid) // hop
        env = np.sqrt(np.mean(mid[:nf * hop].reshape(nf, hop) ** 2, axis=1)) if nf else np.zeros(1)
        fp = np.interp(np.linspace(0, 1, 24), np.linspace(0, 1, len(env)), env)
        fp = fp / (np.linalg.norm(fp) + 1e-12)
        b = np.array([a['bands'].get(k, 0.0) for k in ['20-60', '60-120', '120-350', '350-1000', '1000-3000', '3000-6000', '6000-12000', '12000-20000']])
        b = np.sqrt(b); b = b / (np.linalg.norm(b) + 1e-12)
        return np.concatenate([b * 0.7, fp * 0.7])

    rels = list(out)
    F = {r: feat(out[r]) for r in rels}
    sims = []
    for i, a in enumerate(rels):
        for b in rels[i + 1:]:
            va, vb = F[a], F[b]
            denom = np.linalg.norm(va) * np.linalg.norm(vb)
            s = float(np.dot(va, vb) / denom) if denom else 0.0
            sims.append((round(s, 3), a, b))
    sims.sort(reverse=True)

    json.dump(dict(generated_by='analyze.py', repo=str(REPO), files=out,
                   duplicates=duplicates, near_duplicates=sims[:40]),
              OUT.open('w', encoding='utf-8'), indent=1)
    print(f'wrote {OUT} — {len(out)} files, {len(duplicates["exact_file"])} exact-duplicate groups')
    print('\nfile | dur | sr/ch | peak | rms | crest | clip | leadS | sub% | 3-6k% | centroid | flat | bursts')
    for rel in rels:
        a = out[rel]
        b = a['bands'] or {}
        print(f"{rel:52s} {a['duration']:5.2f} {a['sr']}/{a['channels']} "
              f"{a['peak_db']:6.1f} {a['rms_db']:6.1f} {a['crest_db']:5.1f} {a['clipped_samples']:5d} {a['lead_silence']:5.3f} "
              f"{100*b.get('20-60',0):4.1f} {100*(b.get('3000-6000',0)+b.get('6000-12000',0)):4.1f} "
              f"{(a['centroid_hz'] or 0):6d} {(a['flatness'] if a['flatness'] is not None else -1):5.3f} {a['bursts']}")

if __name__ == '__main__':
    main()
