#!/usr/bin/env python3
"""Iteration helper: score every master against the §5E deck and print the tuning numbers."""
import sys
from pathlib import Path

import numpy as np
from scipy.io import wavfile

sys.path.insert(0, str(Path(__file__).resolve().parent))
import measure as M  # noqa: E402

MASTERS = Path(__file__).resolve().parent.parent / 'masters'


def load(path: Path) -> np.ndarray:
    sr, x = wavfile.read(str(path))
    x = x.astype(np.float64)
    if x.dtype == np.int16 or x.max() > 2:
        x = x / 32768.0
    return x if x.ndim == 1 else x.T


def main() -> int:
    fails = 0
    for wav in sorted(MASTERS.rglob('*.wav')):
        rel = str(wav.relative_to(MASTERS)).replace('\\', '/').replace('.wav', '.ogg')
        x = load(wav)
        bad = M.check_file(rel, x)
        bands = M.band_shares(x)
        top = max(bands, key=bands.get)
        print(f"{rel:52s} rms {M.rms_db(x):6.2f} crest {M.crest_db(x):4.1f} "
              f"sub {(bands['20-60']+bands['60-120'])*100:4.1f}% >1k {sum(v for k,v in bands.items() if k[0].isdigit() and int(k.split('-')[0])>=1000)*100:4.1f}% top {top} {bands[top]*100:4.1f}%"
              + ('   FAIL: ' + '; '.join(bad) if bad else ''))
        fails += 1 if bad else 0
    print(f'\n{fails} master(s) failing')
    return 0


if __name__ == '__main__':
    sys.exit(main())
