#!/usr/bin/env python3
"""
Realm Siege 3D — Sound Pack V2 audit, part 3: generate the audition/review page.

Reads metrics.json and emits `index.html`: all 62 pack files grouped into the seven review
categories, each with an audio player, the measured metrics, its mapped game event(s), the
audit finding + recommended action, and a verdict control. Verdict overrides and free-text
notes persist in localStorage and can be exported as a markdown checklist.

No game file is touched; this writes doc/sound_pack_v2_audit/index.html only.
"""
import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
M = json.loads((HERE / 'metrics.json').read_text(encoding='utf-8'))

# file -> (verdict, issue, action)  — the audit's conclusions, one row per shipped file.
REVIEW = {
 'combat/melee-swing-light.ogg': ('REMIX',
   'Thin, bright swipe: 54% of energy above 3 kHz (25% above 6 kHz), centroid 3.7 kHz, no body below 120 Hz — a tonal hiss rather than a weapon whoosh; it plays for every creep wind-up (the most-repeated combat cue).',
   'Re-author with a 90–350 Hz whoosh body and a soft air layer; tame 6–12 kHz. Optional second take to fight repetition.'),
 'combat/melee-swing-heavy.ogg': ('KEEP',
   'Body and tail to 0.4 s cover the +220 ms melee hit; balanced spectrum (44% 120–350 Hz + 32% presence).',
   'Retain as the hero wind-up.'),
 'combat/melee-impact-light.ogg': ('REMIX',
   '85.9% of energy in 120–350 Hz with only 1.8% at 3–6 kHz: a narrow box-thump that will not cut through a fight or small speakers.',
   'Add a 2–5 kHz slap + 6–10 kHz tick; keep the low-mid thump.'),
 'combat/melee-impact-heavy.ogg': ('REMIX',
   '72% of energy in 60–120 Hz, thin presence (2.1%): reads as rumble and loses definition on laptop/phone speakers.',
   'Add a 300 Hz–3 kHz body layer; trim the sub band.'),
 'combat/ranged-launch.ogg': ('REMIX',
   '57% of energy above 3 kHz (33% in 6–12 kHz): a hiss/air burst with no bow-string body; also quiet (RMS −26 dBFS).',
   'Add a 200–800 Hz string tension/release layer; lift RMS to ≈ −22 dBFS.'),
 'combat/arrow-impact.ogg': ('SPLIT',
   'Currently backs BOTH the generic arrow tick (hitArrow) and the Shadow Huntress poison hit (shPoisonHit): one voice for two identities.',
   'Keep for hitArrow; author combat/arrow-impact-poison.ogg for shPoisonHit (wet, toxic character).'),
 'combat/magic-launch.ogg': ('REMIX',
   '50% 120–350 Hz + 46% 350 Hz–1 kHz, a flat low-mid tone; no shimmer despite the “arcane shimmer” intent.',
   'Add a 2–8 kHz shimmer layer and a slight upward sweep.'),
 'combat/magic-impact.ogg': ('SPLIT',
   'Shared by the core bolt (hitMagic), AK Q (akStrikeHit) and EM Q (emFireHit): one generic hit for unrelated magics; 36% of its energy is below 60 Hz.',
   'Remix a neutral hit for hitMagic (sub < 15%); author combat/magic-impact-arcane.ogg (akStrikeHit) and combat/magic-impact-fire.ogg (emFireHit).'),
 'combat/shield-impact.ogg': ('UNUSED',
   'No shield/absorb mechanic exists in the game. The asset itself measures clean (43%/53% in 350 Hz–3 kHz, crest 21.6).',
   'Retain unmapped; reuse the day a shield mechanic ships.'),
 'combat/hero-hit.ogg': ('REMIX',
   '84% of energy below 60 Hz, centroid 96 Hz: essentially inaudible on phone/laptop speakers — the personal damage cue cannot be heard where it matters most.',
   'Cut sub to < 30%; add a 300 Hz–2 kHz impact tick and a short 80–150 Hz body.'),
 'combat/hero-death.ogg': ('KEEP',
   'Balanced dark dissolve, rich 120 Hz–1 kHz content; 1.05 s tail fits a hero death.',
   'Retain.'),
 'combat/hero-respawn.ogg': ('KEEP',
   'Rising swell with balanced bands, ~1 s; reads as a respawn tell.',
   'Retain.'),
 'heroes/arcane-knight/arcane-strike.ogg': ('REMIX',
   '76% of energy in 350 Hz–1 kHz, strongly tonal: a narrow hum without the airy sword sweep the Q represents.',
   'Add a 2–6 kHz sweep and 6–12 kHz tail; the hit splits out (see magic-impact).'),
 'heroes/arcane-knight/arcane-shield.ogg': ('REMIX',
   'Same protective-swell family as nature-barrier (0.986) and core-critical (0.984): different mechanics share one timbre.',
   'Differentiate: ringing crystalline overtones, tighter envelope, less low-mid mass.'),
 'heroes/arcane-knight/ground-slam.ogg': ('SPLIT',
   'Combined clip is front-loaded: strongest transient at 0.01 s, whole clip ~21 dB down by the game’s +250 ms release — the slam can never align with the resolved hit.',
   'Split: ground-slam-windup.ogg (akSlamWind) + ground-slam-impact.ogg (akSlamImpact fires on the real hit; drop the AK E LINKED suppression).'),
 'heroes/arcane-knight/meteor-prison.ogg': ('SPLIT',
   'Front-loaded (peaks at 0 s / 0.07 s); −24.8 dBFS at the +250 ms hit — buildup and explosion cannot match the ability resolution.',
   'Split: meteor-prison-windup.ogg (akMeteorBuild) + meteor-prison-impact.ogg (akMeteorImpact); remove the AK R LINKED entry.'),
 'heroes/shadow-huntress/shadow-dash.ogg': ('KEEP',
   '0.42 s phase whoosh, 54% presence + low spectral hints; fits a dash.',
   'Retain.'),
 'heroes/shadow-huntress/poison-arrow.ogg': ('KEEP',
   '74.6% 350 Hz–1 kHz launch body; distinct from the generic ranged launch.',
   'Retain as the launch; its hit gets its own file (see arrow-impact).'),
 'heroes/shadow-huntress/smoke-veil.ogg': ('REMIX',
   'Shares the protective-swell timbre (0.987 vs nature-barrier): a stealth tool that sounds like a heal.',
   'Re-author darker and airier: noise bloom 300 Hz–4 kHz, no tonal swell.'),
 'heroes/shadow-huntress/death-mark.ogg': ('SPLIT',
   'Front-loaded (peak 0.01 s), 44% sub energy; −34.5 dBFS at the +250 ms detonation slot.',
   'Split: death-mark-windup.ogg (shMark) + death-mark-burst.ogg (shMarkBurst); remove the SH R LINKED entry.'),
 'heroes/ember-mage/fire-bolt.ogg': ('REMIX',
   'Crackle present (flatness 0.069) but the bolt is hiss-forward: 40% above 3 kHz and almost no warmth below 350 Hz.',
   'Add a 300–900 Hz flame body; tame 6–12 kHz; the hit splits out (see magic-impact).'),
 'heroes/ember-mage/flame-wave.ogg': ('KEEP',
   '44.6% 120–350 Hz + 22% 3–6 kHz rush; reads as a broad flame sweep.',
   'Retain.'),
 'heroes/ember-mage/burning-zone-ignition.ogg': ('REMIX',
   '77% of energy below 120 Hz — a sub swell, not a fire ignition; crackle is ~5% above 3 kHz.',
   'Rebuild around 2–8 kHz flame crackle + a short 100–200 Hz whoomp; cut the sub.'),
 'heroes/ember-mage/inferno-storm.ogg': ('SPLIT',
   'Front-loaded (peak 0 s); 79% of energy below 120 Hz; −30 dBFS at the +250 ms hit — a rumble that can neither align nor cut.',
   'Split: inferno-storm-windup.ogg (emStormBuild) + inferno-storm-burst.ogg (emStormImpact); remove the EM R LINKED entry; add high fire layers.'),
 'heroes/nature-guardian/healing-seed.ogg': ('REMIX',
   '79.8% 350 Hz–1 kHz chime; 0.993 similarity with ui/hero-select and 0.989 with level-up — healing sounds like menu UI.',
   'Re-author organic: warm marimba-like body + soft leaf noise instead of a pure-tone chime.'),
 'heroes/nature-guardian/root-trap.ogg': ('KEEP',
   'Earth crack + tighten; 57% 120–350 Hz; fits the root trap.',
   'Retain.'),
 'heroes/nature-guardian/nature-barrier.ogg': ('REMIX',
   'Shares the protective-swell timbre with arcane-shield and smoke-veil (0.986–0.987).',
   'Differentiate: organic bloom — rustle + low wooden resonance, less glassy tone.'),
 'heroes/nature-guardian/forest-rebirth.ogg': ('KEEP',
   '1.65 s rising restoration with broad-ish bands; fits the ultimate.',
   'Retain.'),
 'heroes/storm-warrior/lightning-punch.ogg': ('REMIX',
   '66% of energy below 60 Hz: the punch is a sub thud; the electric crack is only ~4% above 3 kHz.',
   'Cut sub to < 30%; promote a 2–6 kHz crack and a 150–400 Hz body.'),
 'heroes/storm-warrior/static-field.ogg': ('REMIX',
   'Quietest hero file (RMS −26.8 dBFS; ≈ 9 dB under magic-impact after gains) and mid-thin: the W will vanish in fights.',
   'Lift RMS to ≈ −19 dBFS, add a low electric hum layer, re-balance recommendedVolume.'),
 'heroes/storm-warrior/thunder-charge.ogg': ('SPLIT',
   'Front-loaded (peak 0.015 s; −29.8 dBFS at the +250 ms hit); 80% of energy below 120 Hz.',
   'Split: thunder-charge-rush.ogg (swCharge) + thunder-charge-impact.ogg (swChargeHit); remove the SW E LINKED entry.'),
 'heroes/storm-warrior/storm-rage.ogg': ('KEEP',
   '1.05 s rising surge; 30% presence + 35% low-mid; acceptable.',
   'Retain.'),
 'structures/tower-shot.ogg': ('KEEP',
   '0.28 s launch thump with a 6.9% 3–6 kHz edge; reads as a tower firing.',
   'Retain.'),
 'structures/tower-impact.ogg': ('REMIX',
   '89.8% of energy below 120 Hz (50% below 60): barely audible on small speakers; hot RMS −17 dBFS.',
   'Add a 300 Hz–2 kHz crack; keep a reduced sub thump.'),
 'structures/tower-destroy.ogg': ('KEEP',
   '1.1 s collapse rumble; 79% low energy but appropriate for a structure; slightly mud-prone.',
   'Retain (optional: add 2–6 kHz debris ticks).'),
 'structures/core-hit.ogg': ('REMIX',
   '97.2% of energy in a single 350 Hz–1 kHz band, crest 14, RMS −15.1 (hottest file): a pure tone repeated on every core hit will fatigue and mask.',
   'Widen the spectrum (low boom + high ring), lower RMS ~3 dB; consider a second take (core-hit-2.ogg).'),
 'structures/core-critical.ogg': ('KEEP',
   '1 s unstable pulse, energy 120 Hz–3 kHz; distinct from the hit.',
   'Retain.'),
 'structures/core-destroy.ogg': ('KEEP',
   '1.65 s collapse with an energy tail; appropriate scale.',
   'Retain.'),
 'structures/boss-attack.ogg': ('REMIX',
   '78% of energy below 120 Hz and 0.987 fingerprint similarity with thunder-charge: the boss shares the low-rush family; the cue only rumbles.',
   'Add a 200 Hz–2 kHz roar body to differentiate and cut through.'),
 'structures/boss-death.ogg': ('KEEP',
   '1.5 s fall, balanced 120 Hz–1 kHz; fits.',
   'Retain.'),
 'ui/ui-click.ogg': ('KEEP',
   '0.087 s narrow low-mid pock (91% 120–350 Hz); muffled by design; no measurable defect.',
   'Retain (optional: a +2 kHz tick for crispness).'),
 'ui/ui-hover.ogg': ('KEEP',
   '0.107 s soft tick; fine.',
   'Retain.'),
 'ui/ui-confirm.ogg': ('UNUSED',
   'No distinct confirmation moment exists in the game logic.',
   'Retain unmapped and documented; do not force a moment for it.'),
 'ui/ui-error.ogg': ('KEEP',
   '0.24 s double low cue (98.7% 120–350 Hz); the dullness suits a rejection.',
   'Retain.'),
 'ui/pause.ogg': ('KEEP',
   '0.25 s descending cue; mirrored with resume by design.',
   'Retain.'),
 'ui/resume.ogg': ('KEEP',
   '0.32 s rising cue; mirrored with pause by design.',
   'Retain.'),
 'ui/hero-select.ogg': ('KEEP',
   '0.92 s shimmer; distinct enough in its own moment.',
   'Retain.'),
 'ui/match-start.ogg': ('KEEP',
   '1.55 s swell with a sub foundation; fits the match start.',
   'Retain.'),
 'ui/shop-open.ogg': ('KEEP',
   '0.34 s metallic open; fine.',
   'Retain.'),
 'ui/item-purchase.ogg': ('KEEP',
   'Coin sparkle; 0.985 with gold-reward but different moments and scale.',
   'Retain.'),
 'ui/gold-reward.ogg': ('KEEP',
   'Shares the coin timbre with item-purchase (0.985); acceptable as a family.',
   'Retain; optional character shift if it ever reads wrong in play.'),
 'ui/level-up.ogg': ('REMIX',
   '0.979/0.977 similarity with hero-select and ui-confirm: the celebration sounds like a generic confirm.',
   'Re-author with a growing arpeggio and a 1.2–1.5 s tail to own the level-up.'),
 'ui/victory-stinger.ogg': ('KEEP',
   '2.6 s triumphant cue with a broad spectrum; fits.',
   'Retain.'),
 'ui/defeat-stinger.ogg': ('KEEP',
   '2.7 s dark descending cue; fits.',
   'Retain.'),
 'ambience/wind-loop.ogg': ('REMIX',
   'Loop seam is only 29 dB below peak (a −30 dBFS step): a soft tick may repeat every 8 s; also 95% of energy below 120 Hz (thin on small speakers).',
   'Re-author with a crossfaded seam (< −50 dBFS step) and a faint 1–4 kHz air layer.'),
 'ambience/forest-loop.ogg': ('REPLACE',
   '0.0 dBFS peak with 2 clipped samples; 79% of energy above 1 kHz (hiss-heavy); stereo (side ≈ mid) — cannot drop into the mono positional emitter path as-is.',
   'Re-author as ambience/forest-emitter.ogg (mono, seam-safe, hiss tamed) → map def ambForest; original stays unmapped.'),
 'ambience/river-loop.ogg': ('REPLACE',
   'Very narrow: 94.2% of energy in 120–350 Hz; stereo; hot RMS −7.4 (fine at bed gain).',
   'Re-author as ambience/river-emitter.ogg (mono, 200 Hz–4 kHz texture) → map def ambRiver.'),
 'heroes/ember-mage/burning-zone-loop.ogg': ('UNUSED',
   'No persistent zone mechanic exists; RMS −6.0 dBFS / crest 5.0 = heavily limited. Seam is clean.',
   'Retain unmapped; normalize if a zone mechanic ever ships.'),
 'combat/footstep-grass-1.ogg': ('REPLACE',
   'Near-copy of takes 2/3 (0.99+ similarity) yet peaks at −1.0 dBFS vs −4.3/−5.2: random picks audibly jump in level.',
   'Replace the set with 4 genuinely different, level-matched steps (add combat/footstep-grass-4.ogg + stepGrass4 def; keep the random pick).'),
 'combat/footstep-grass-2.ogg': ('REPLACE',
   'Near-copy of takes 1/3 (0.992/0.997); take 1 is > 3 dB hotter.',
   'Same set replacement as grass-1.'),
 'combat/footstep-grass-3.ogg': ('REPLACE',
   'Near-copy of takes 1/2 (0.988/0.997); 46 ms of near-silence tail.',
   'Same set replacement as grass-1.'),
 'combat/move-command.ogg': ('KEEP',
   '0.107 s low blip, deliberately quiet (peak −3.4 dBFS); fine.',
   'Retain.'),
}

CATS = {1: 'Melee & ranged combat', 2: 'Damage & death', 3: 'Heroes & abilities', 4: 'Towers, core & boss',
        5: 'UI & rewards', 6: 'Music & ambience', 7: 'Footsteps & movement'}

def bandbar(b):
    segs = [('20-60', '#7a4bd0'), ('60-120', '#4b6bd0'), ('120-350', '#3fa9c9'), ('350-1000', '#43b581'),
            ('1000-3000', '#a8c93f'), ('3000-6000', '#e0b33f'), ('6000-12000', '#e07a3f'), ('12000-20000', '#d05050')]
    out = []
    for k, c in segs:
        v = b.get(k, 0) * 100
        if v < 0.25:
            continue
        out.append(f'<i style="width:{v:.1f}%;background:{c}" title="{k} Hz: {v:.1f}%"></i>')
    return ''.join(out)

rows = []
unreviewed = []
for f, a in M['files'].items():
    if f not in REVIEW:
        unreviewed.append(f)
        continue
    v, issue, action = REVIEW[f]
    b = a['bands'] or {}
    rows.append({
        'f': f, 'cat': a['cat'], 'group': a.get('group') or '', 'defs': a.get('defs') or [],
        'trig': a.get('trigger') or '', 'desc': a['manifest'].get('description') or '',
        'mid': a['manifest'].get('id') or '', 'vol': a['manifest'].get('volume'),
        'dur': a['duration'], 'ch': a['channels'], 'sr': a['sr'], 'peak': a['peak_db'], 'rms': a['rms_db'],
        'crest': a['crest_db'], 'clip': a['clipped_samples'], 'cent': a['centroid_hz'], 'flat': a['flatness'],
        'bands': b, 'bbar': bandbar(b), 'seam': a['loop_seam'], 'loop': bool(a['manifest'].get('loop')),
        'verdict': v, 'issue': issue, 'action': action,
    })
assert not unreviewed, f'missing review rows: {unreviewed}'

payload = json.dumps(rows, ensure_ascii=False)
catjson = json.dumps(CATS)

HTML = """<!doctype html>
<html lang="en"><meta charset="utf-8"><title>Realm Siege 3D — Sound Pack V2 audition</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
:root{--bg:#14161a;--card:#1d2026;--line:#2c313a;--tx:#dfe4ec;--dim:#8b94a3;--acc:#63b3ed}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--tx);font:14px/1.45 system-ui,Segoe UI,sans-serif}
header{padding:18px 22px;border-bottom:1px solid var(--line);position:sticky;top:0;background:var(--bg);z-index:5}
h1{margin:0 0 4px;font-size:18px}h1 small{color:var(--dim);font-weight:400}
.bar{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px}
button,select{background:var(--card);color:var(--tx);border:1px solid var(--line);border-radius:6px;padding:6px 10px;font:inherit;cursor:pointer}
button:hover{border-color:var(--acc)}
h2{padding:6px 22px;margin:14px 0 0;font-size:15px;color:var(--acc)}
h2 span{color:var(--dim);font-weight:400}
.legend{padding:4px 22px;color:var(--dim);font-size:12px}
.legend i{display:inline-block;width:10px;height:10px;border-radius:2px;margin:0 3px 0 10px;vertical-align:-1px}
.row{display:grid;grid-template-columns:340px 320px 1fr;gap:14px;padding:12px 22px;border-top:1px solid var(--line)}
.row.playing{background:#20242c}
.file{font-weight:600;word-break:break-all}.sub{color:var(--dim);font-size:12px;margin-top:2px;word-break:break-word}
audio{width:100%;height:32px;margin:6px 0 4px}
.chips{display:flex;flex-wrap:wrap;gap:5px;margin-top:6px}
.chip{font-size:11px;background:#242833;border:1px solid var(--line);border-radius:5px;padding:2px 6px;color:var(--dim)}
.chip b{color:var(--tx);font-weight:600}
.chip.bad{border-color:#a33;color:#e88}.chip.warn{border-color:#a83;color:#eb8}.chip.ok{border-color:#3a6;color:#8e8}
.bbar{display:flex;height:12px;border-radius:3px;overflow:hidden;background:#101216;margin-top:7px}
.bbar i{display:block;height:100%}
.badge{font-size:11px;font-weight:700;border-radius:5px;padding:3px 8px;letter-spacing:.4px}
.V-KEEP{background:#1e3a2a;color:#7fd6a2}.V-REMIX{background:#3a341e;color:#e8d17f}.V-SPLIT{background:#1e2d3a;color:#7fc4e8}.V-REPLACE{background:#3a241e;color:#e8a17f}.V-UNUSED{background:#2a2d33;color:#9aa3b2}
.issue{margin:6px 0 0}.action{margin:6px 0 0;color:#bfe3bf}
.verdictctl{display:flex;gap:6px;align-items:center;margin-top:8px}
textarea{width:100%;margin-top:6px;background:#101216;color:var(--tx);border:1px solid var(--line);border-radius:6px;padding:6px;font:inherit;min-height:30px}
.overridden{outline:1px dashed var(--acc)}
@media(max-width:1100px){.row{grid-template-columns:1fr}}
</style>
<header>
<h1>Realm Siege 3D — Sound Pack V2 audition <small>62 shipped files · measured analysis + verdicts</small></h1>
<div class="legend">Measurements: ffmpeg decode → numpy analysis (duration/peak/RMS/crest/clipping/silence/8-band spectral shares/centroid/onsets/loop seams/duplicates).
Verdicts below are recommendations from signal evidence — <b>no listening pass has been performed yet</b>; use the players and the export button to record your ear-check decisions.</div>
<div class="bar">
  <button id="playall">▶ Play all groups</button>
  <button id="stopall">■ Stop</button>
  <select id="filter"><option value="">All verdicts</option><option>KEEP</option><option>REMIX</option><option>REPLACE</option><option>SPLIT</option><option>UNUSED</option></select>
  <button id="export">⬇ Export decisions (.md)</button>
  <button id="reset">Reset overrides</button>
</div>
</header>
<div id="groups"></div>
<script>
const ROWS = __ROWS__, CATS = __CATS__;
const LS = k => 'rsvp2:' + k;
function override(r){ try { return JSON.parse(localStorage.getItem(LS(r.f)) || 'null') } catch(e){ return null } }
function currentVerdict(r){ const o = override(r); return (o && o.v) || r.verdict }
function el(tag, cls, html){ const e = document.createElement(tag); if(cls) e.className = cls; if(html!=null) e.innerHTML = html; return e }
function chip(label, val, cls){ return `<span class="chip ${cls||''}">${label} <b>${val}</b></span>` }
function fmtSeam(r){ if(r.seam==null) return ''; const dbr = 20*Math.log10(r.seam/ Math.pow(10, r.peak/20)); return chip('seam', dbr.toFixed(0)+' dB rel pk', dbr>-45?'warn':'ok') }

const groups = {}; for(const f in CATS) groups[f]=[];
for(const r of ROWS) groups[r.cat].push(r);
const root = document.getElementById('groups');
let queue = [], qTokens = 0, nowPlaying = null;

function render(){
  const filt = document.getElementById('filter').value;
  root.innerHTML = '';
  for(const c of Object.keys(CATS)){
    const rows = groups[c].filter(r => !filt || currentVerdict(r) === filt);
    if(!rows.length) continue;
    const h = el('h2', null, `${c}. ${CATS[c]} <span>— ${rows.length} file(s)</span> <button data-group="${c}" class="pg">▶ play group</button>`);
    root.appendChild(h);
    for(const r of rows) root.appendChild(renderRow(r, c));
  }
}
function renderRow(r){
  const row = el('div','row'); row.dataset.f = r.f;
  const left = el('div');
  left.appendChild(el('div','file', r.f));
  left.appendChild(el('div','sub', (r.defs.length? 'def: <b>'+r.defs.join(', ')+'</b>' : '<b>unmapped</b>')));
  left.appendChild(el('div','sub', 'trigger: ' + r.trig));
  left.appendChild(el('div','sub', 'manifest: ' + (r.mid||'–') + ' · rec. volume ' + (r.vol ?? '–')));
  const mid = el('div');
  const au = document.createElement('audio'); au.controls = true; au.preload='none';
  au.src = '../../public/audio/realm-siege/' + r.f;
  if(r.loop){ au.loop = true }
  mid.appendChild(au);
  mid.appendChild(el('div','chips', [
    chip('dur', r.dur+'s'), chip('ch', r.ch+'ch @'+r.sr),
    chip('peak', r.peak+' dB', r.peak>=-0.3||r.clip>0?'bad':''), chip('rms', r.rms+' dB'), chip('crest', r.crest+' dB', r.crest<12?'warn':''),
    chip('clip', r.clip, r.clip>0?'bad':''), chip('centroid', r.cent+' Hz'), chip('flatness', r.flat),
    fmtSeam(r)
  ].join('')));
  const bb = el('div','bbar'); bb.innerHTML = r.bbar; mid.appendChild(bb);
  mid.appendChild(el('div','sub','spectrum shares: ' + Object.entries(r.bands).map(([k,v])=>`${k}: ${(v*100).toFixed(1)}%`).join(' · ')));
  const right = el('div');
  const o = override(r); const v = currentVerdict(r);
  right.appendChild(el('div','verdictctl',
    `<span class="badge V-${v}" data-badge>${v}</span>
     <select data-vsel><option ${v==='KEEP'?'selected':''}>KEEP</option><option ${v==='REMIX'?'selected':''}>REMIX</option><option ${v==='REPLACE'?'selected':''}>REPLACE</option><option ${v==='SPLIT'?'selected':''}>SPLIT</option><option ${v==='UNUSED'?'selected':''}>UNUSED</option></select>
     ${o?'<button data-clear>↺ default</button>':''}`));
  right.appendChild(el('div','issue', '<b>Issue.</b> ' + r.issue));
  right.appendChild(el('div','action', '<b>Action.</b> ' + r.action));
  const ta = document.createElement('textarea'); ta.placeholder = 'ear-check note (saved locally)…'; ta.value = (o && o.n) || '';
  ta.oninput = () => { const cur = override(r) || {}; cur.n = ta.value; localStorage.setItem(LS(r.f), JSON.stringify(cur)); };
  right.appendChild(ta);
  right.querySelector('[data-vsel]').onchange = e => {
    const cur = override(r) || {}; cur.v = e.target.value; localStorage.setItem(LS(r.f), JSON.stringify(cur)); render();
  };
  const clr = right.querySelector('[data-clear]');
  if(clr) clr.onclick = () => { const cur = override(r) || {}; delete cur.v; localStorage.setItem(LS(r.f), JSON.stringify(cur)); render() };
  row.append(left, mid, right); return row;
}
function rowFor(f){ return ROWS.find(r=>r.f===f) }
function stopAll(){ qTokens++; document.querySelectorAll('audio').forEach(a=>{a.pause(); a.currentTime=0}); document.querySelectorAll('.row').forEach(x=>x.classList.remove('playing')) }
document.getElementById('stopall').onclick = stopAll;
document.getElementById('filter').onchange = render;
document.getElementById('reset').onclick = () => { if(confirm('Clear all verdict overrides and notes?')){ ROWS.forEach(r=>localStorage.removeItem(LS(r.f))); render() } };
document.getElementById('export').onclick = () => {
  const lines = ['# Sound Pack V2 — ear-check decisions', '', '> exported from the audition page (overrides + notes; default audit verdicts included)',''];
  for(const c of Object.keys(CATS)){
    lines.push('## ' + c + '. ' + CATS[c], '');
    for(const r of groups[c].filter(r=>true)){ const o = override(r); lines.push(`- \`${r.f}\` — **${currentVerdict(r)}**${o&&o.n? ' — note: '+o.n : ''}`) }
    lines.push('');
  }
  const blob = new Blob([lines.join('\\n')], {type:'text/markdown'});
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'sound_pack_v2_decisions.md'; a.click();
};
document.getElementById('playall').onclick = () => playList(ROWS.map(r=>r.f));
document.addEventListener('click', e => { const c = e.target.closest('[data-group]'); if(c) playList(groups[c.dataset.group].map(r=>r.f)) });
function playList(files){
  stopAll(); const tok = ++qTokens; let i = 0;
  const step = () => {
    if(tok !== qTokens || i >= files.length) return;
    const r = rowFor(files[i++]); const au = document.querySelector(`.row[data-f="${CSS.escape(r.f)}"] audio`);
    if(!au) return step();
    au.closest('.row').classList.add('playing'); au.currentTime = 0; au.play().catch(()=>{});
    if(r.loop){ setTimeout(step, 4000) } else { au.onended = () => { au.onended = null; setTimeout(step, 350) } }
  };
  step();
}
render();
</script></html>"""

html = HTML.replace('__ROWS__', payload).replace('__CATS__', catjson)
(HERE / 'index.html').write_text(html, encoding='utf-8')
print(f'wrote index.html — {len(rows)} reviewed rows,',
      {v: sum(1 for r in rows if r['verdict'] == v) for v in ['KEEP', 'REMIX', 'REPLACE', 'SPLIT', 'UNUSED']})
