# Realm Siege 3D — Sound Pack v2 · Provenance & License Record

**Summary: every file in this pack is original work created for this project. No third-party
audio of any kind is included — no recordings, no Foley, no sample libraries, no generated audio
from external services, and nothing ripped, extracted or resampled from any game (Dota 2 or
otherwise).** There are therefore no external creators, source URLs or license terms to record —
this document records how the files were made so the claim is verifiable, not just asserted.

---

## 1. Authorship and method

All 80 shipped files fall into two provenances:

| Provenance | Files | How it was made |
|---|---|---|
| **V2-authored** | 47 | Procedurally synthesized by `tools/design.py` — layered oscillators (sine/FM), filtered noise, particle grains, envelopes, time-varying band shaping, convolution-style synthetic tails, gentle tanh saturation, all written for this pack. Deterministic: every recipe has fixed seeds, so re-running the script reproduces the masters. |
| **V1, kept bit-exact** | 28 | The original pack (`doc/realm_siege_3d_sound_pack_v1/`), itself procedurally synthesized for this project by its own design scripts. Not re-encoded, not modified. |
| **V1, unused** | 5 | Same as above; documented in `README.md` §8 and `PACK_UNUSED`. |

No recipe reads, resamples, embeds or transforms any external audio file. The only inputs to
synthesis are code, mathematical noise (numpy's deterministic PCG64 generators, explicitly
seeded) and fixed parameters.

## 2. Chain of custody (reproducible)

1. **Recipe:** `tools/design.py` (Python 3.12.8, numpy 2.4.6, scipy 1.17.1) renders each file's
   float32 master and writes it to `masters/`. Role levels, peak ceiling and loops are applied
   inside the script (see README §5–6).
2. **Encode:** `tools/encode.py` → `ffmpeg 9.0.1` (`libvorbis`, `-q:a 7` VBR) → the OGGs under
   `public/audio/realm-siege/`. No loudness processing; the mix gain ships in `pack.ts`.
3. **Record:** `tools/manifest.py` writes `manifest.json` — per file: voice, path, gain, role,
   duration, decoded peak/RMS/crest and **SHA-256 of the shipped bytes**. The hashes in that
   file are the byte-level identity record for this pack revision.
4. **Verify:** `tools/validate.py` re-decodes the shipped files and re-applies the audit's
   measurable acceptance deck; a stale manifest or a mismatched file fails the run.

The V2 file set is *precisely* `manifest.json → files[] where v2 == true`; everything else on
disk is V1 (kept or unused) and is listed in the same manifest.

## 3. Third-party components (tooling only, not content)

| Component | Role | License (as used, unmodified tooling) |
|---|---|---|
| ffmpeg + libvorbis | Ogg Vorbis encoding | LGPL/GPL (binary from the standard gyan.dev full build) |
| numpy / scipy | DSP math for synthesis | BSD-3-Clause |
| Python | runtime for the tools | PSF License |

These tools processed the audio; they contribute no samples or content. The synthesized audio
contains no data derived from any of them beyond generic numeric output.

## 4. License of the audio content

The audio files are original project assets and are covered by the repository's own license
terms, like the rest of `public/` and `src/`. No attribution is required beyond the repository's
own terms because there are no upstream rights to satisfy.

If this pack is ever redistributed as a standalone asset pack, that redistribution should carry
this file with it, so the "no third-party sources" claim can be audited.

## 5. Honest scope statement

These assets are **designed synthetic sound effects**, not recordings. They were engineered
against measurable targets (levels, crest, band balance, seam continuity — README §5) to fix the
specific, measured failures of V1. They do not claim, and should not be described as, recorded
Foley or AAA sound-design-library quality. Where a requirement could not be met as specified
(stone footsteps — no such surface exists in the simulation; or the relaxed wind-up band rule),
the README documents the exception instead of hiding it.
