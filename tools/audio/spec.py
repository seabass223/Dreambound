# Draws a WAV as a picture to read a sound by: its level over time on top (blue: peak, yellow: RMS, dBFS) and its
# spectrogram under it (25 Hz - 16 kHz on a log scale, 80 dB of range, 0 dB = a full-scale sine). The PNG lands next to
# the WAV. numpy and Pillow only.
#
#   python tools/audio/spec.py                         every WAV in tools/audio/out without an up-to-date PNG
#   python tools/audio/spec.py a.wav b.wav             these: paths as given, or relative to tools/audio or its out/
#                                                      (so "door_open.wav" finds out/door_open.wav); wildcards work
#   python tools/audio/spec.py a.wav --t0 0.2 --t1 0.6 zoom in on a stretch (s): written as a_0.2-0.6.png. Past the
#                                                      end of the file the stretch is silence, so one --t1 gives
#                                                      files of different lengths the same time axis
#   python tools/audio/spec.py a.wav --lin 2000        a linear frequency axis up to 2000 Hz (harmonics, hum, low end)
#   python tools/audio/spec.py a.wav --nfft 1024       shorter frames: sharper in time, coarser in pitch (default 4096)
#   python tools/audio/spec.py before.wav after.wav --stack pair.png     one picture, one above the other, on the same
#                                                      scales and the same time axis (the longest file's, or --t1's)
#   python tools/audio/spec.py a.wav --numbers         no picture: octave-band levels, crest factor, left/right
#                                                      correlation, and how steady its 2-8 kHz level is
# Also --suffix <s> (added to the PNG's name) and --out <dir>.
# The peak and rms in a picture's heading and in --numbers are render.mjs's: rms over the part that sounds (first to
# last sample within 60 dB of the peak), not over the silence round it.
import sys, os, glob, struct
import numpy as np
from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
W, HS, HE = 1100, 360, 120          # width; heights of the spectrogram and of the level envelope
LO, HI, TOP, RANGE = 25.0, 16000.0, -10.0, 80.0

def shown(path):  # a path as it is printed: from where this was run when it is under there, in full when it is not
    p = os.path.abspath(path)
    try:
        r = os.path.relpath(p)
    except ValueError:  # (another drive)
        r = p
    return (p if r.startswith('..') else r).replace(os.sep, '/')

def sounding(x):  # the part that sounds, as render.mjs measures it: first and last sample within 60 dB of the peak
    m = np.abs(x).max(axis=1)
    pk = m.max() if len(m) else 0.0
    if pk <= 0:
        return 0, len(x)
    i = np.nonzero(m > pk * 0.001)[0]
    return int(i[0]), int(i[-1]) + 1

def read_wav(path):
    b = open(path, 'rb').read()
    fmt, ch, rate = struct.unpack('<HHI', b[20:28])
    bits = struct.unpack('<H', b[34:36])[0]
    i = 12
    while b[i:i + 4] != b'data':
        i += 8 + struct.unpack('<I', b[i + 4:i + 8])[0]
    n = struct.unpack('<I', b[i + 4:i + 8])[0]
    raw = b[i + 8:i + 8 + n]
    if fmt == 3:
        x = np.frombuffer(raw, dtype='<f4').reshape(-1, ch).astype(np.float64)
    elif bits == 16:
        x = np.frombuffer(raw, dtype='<i2').reshape(-1, ch).astype(np.float64) / 32767.0
    else:
        raise SystemExit(f'{path}: only 16-bit PCM and 32-bit float WAVs')
    return (x if ch > 1 else np.repeat(x, 2, axis=1)), rate

def cmap(v):  # 0..1 -> black, indigo, purple, red, orange, pale yellow
    stops = np.array([[0, 0, 0], [20, 12, 60], [110, 25, 120], [215, 70, 60], [250, 170, 40], [255, 250, 200]], float)
    p = np.clip(v, 0, 1) * (len(stops) - 1)
    k = np.minimum(np.floor(p).astype(int), len(stops) - 2)
    u = (p - k)[..., None]
    return (stops[k] * (1 - u) + stops[k + 1] * u).astype(np.uint8)

def window(x, rate, t0, t1):
    # The stretch t0..t1 (to the end of the file with no t1). Where it runs past the file it is silence, so files of
    # different lengths drawn to one t1 share a time axis.
    a = max(0, int(round((t0 or 0) * rate)))
    b = max(a + 1, int(round(t1 * rate)) if t1 is not None else len(x))
    y = x[a:b]
    if len(y) < b - a:
        y = np.concatenate([y, np.zeros((b - a - len(y), x.shape[1]))])
    return y, a / rate

def picture(path, t0=None, t1=None, lin=None, nfft=4096, label=''):
    full, rate = read_wav(path)
    x, off = window(full, rate, t0, t1)
    n = len(x)
    dur = n / rate
    end = len(full) / rate          # where the file itself ends (the picture may run on past it, as silence)
    # Spectrogram: W columns of Hann frames centred across the stretch, the two channels' power averaged.
    centres = np.linspace(0, n - 1, W).astype(int)
    idx = centres[:, None] + np.arange(nfft)[None, :]
    win = np.hanning(nfft)
    P = np.zeros((W, nfft // 2 + 1))
    for c in range(2):
        pad = np.concatenate([np.zeros(nfft // 2), x[:, c], np.zeros(nfft)])
        P += np.abs(np.fft.rfft(pad[idx] * win, axis=1)) ** 2 / 2
    S = 10 * np.log10(P / (nfft / 4) ** 2 + 1e-18)
    freqs = np.fft.rfftfreq(nfft, 1 / rate)
    rows = np.arange(HS) / (HS - 1)
    fy = lin * (1 - rows) if lin else LO * (HI / LO) ** (1 - rows)
    img = np.empty((HS, W))
    for j in range(W):
        img[:, j] = np.interp(fy, freqs, S[j])
    canvas = Image.new('RGB', (W + 60, HS + HE + 50), (16, 16, 18))
    canvas.paste(Image.fromarray(cmap((img - (TOP - RANGE)) / RANGE), 'RGB'), (50, HE + 30))
    d = ImageDraw.Draw(canvas)
    # Level envelope, -60..+6 dBFS: each column's peak (blue bars) and RMS (yellow dots).
    seg = max(1, n // W)
    y_of = lambda db: HE + 20 - (np.clip(db, -60, 6) + 60) / 66 * HE
    for j in range(W):
        a = x[j * seg:(j + 1) * seg]
        if len(a) == 0:
            break
        d.line([(50 + j, HE + 20), (50 + j, y_of(20 * np.log10(np.abs(a).max() + 1e-9)))], fill=(90, 140, 210))
        d.point((50 + j, y_of(10 * np.log10((a ** 2).mean() + 1e-18))), fill=(240, 200, 90))
    for db in (0, -12, -24, -36, -48):
        d.line([(50, y_of(db)), (50 + W, y_of(db))], fill=(60, 60, 60))
        d.text((8, y_of(db) - 6), f'{db}', fill=(170, 170, 170))
    if lin:
        step = 100 if lin <= 1200 else 250 if lin <= 2500 else 500 if lin <= 6000 else 2000
        marks = [(f, HE + 30 + (1 - f / lin) * (HS - 1)) for f in range(0, int(lin) + 1, step)]
    else:
        marks = [(f, HE + 30 + (1 - np.log(f / LO) / np.log(HI / LO)) * (HS - 1)) for f in (50, 100, 200, 500, 1000, 2000, 5000, 10000)]
    for f, yy in marks:
        d.line([(46, yy), (50, yy)], fill=(200, 200, 200))
        d.text((4, yy - 6), f'{f / 1000:g}k' if f >= 1000 else f'{f}', fill=(200, 200, 200))
    st = next((s for s in (0.005, 0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 20) if dur / s <= 14), 30)
    k = int(np.ceil(off / st - 1e-9))
    while k * st <= off + dur + 1e-9:
        xx = 50 + (k * st - off) / dur * W
        d.line([(xx, HE + 30 + HS), (xx, HE + 36 + HS)], fill=(200, 200, 200))
        d.text((xx - 8, HE + 38 + HS), f'{k * st:g}s', fill=(200, 200, 200))
        k += 1
    if off < end < off + dur - 1e-6:     # the file ends inside the picture: mark it (the rest is padding)
        xe = 50 + (end - off) / dur * W
        for yy in range(20, HE + 30 + HS, 6):
            d.line([(xe, yy), (xe, yy + 2)], fill=(130, 130, 130))
        d.text((xe + 4 if xe < W - 60 else xe - 92, 22), f'file ends {end:.2f}s', fill=(150, 150, 150))
    i0, i1 = sounding(x)
    peak = 20 * np.log10(np.abs(x).max() + 1e-12)
    rms = 10 * np.log10((x[i0:i1] ** 2).mean() + 1e-18)
    axis = f'0-{lin:g} Hz linear' if lin else '25 Hz-16 kHz log'
    d.text((50, 4), f'{os.path.basename(path)}{label}   {off:g}-{off + dur:.2f} s   peak {peak:.1f}  rms {rms:.1f} dBFS over the {(i1 - i0) / rate:.2f} s that sound   '
           f'(blue: peak, yellow: RMS; spectrogram {axis}, {TOP - RANGE:g}..{TOP:g} dB, nfft {nfft})', fill=(230, 230, 230))
    return canvas

def numbers(path, t0=None, t1=None):
    # Everything here is measured over the part that sounds (of the stretch asked for), so a one-shot's lead-in and
    # trailing silence don't dilute it and its rms is the one render.mjs's table gives.
    #   crest            peak over rms: about 10-13 dB for steady noise, 3 for a sine, 20 and more for a lone hit
    #   excess kurtosis  how spiky the samples are: 0 for steady noise, -1.5 for a sine, tens for sparse clicks
    #   L/R correlation  1: the same in both ears (mono); 0: unrelated (wide); below 0: out of phase
    #   octave bands     the level in each octave (they add up to the rms): where the energy sits
    #   2-8 kHz level    the band where hits and ticks are heard, in frames of 5, 20 and 100 ms. spread: how much its
    #                    level moves from frame to frame (the standard deviation, as dB over the mean); loudest and
    #                    quietest: the extreme frames, in dB against the mean frame
    full, rate = read_wav(path)
    x, off = window(full, rate, t0, t1)
    i0, i1 = sounding(x)
    x, off = x[i0:i1], off + i0 / rate
    L, R = x[:, 0], x[:, 1]
    rms = np.sqrt((x ** 2).mean()) + 1e-12
    pk = np.abs(x).max() + 1e-12
    kurt = ((L - L.mean()) ** 4).mean() / (L.var() ** 2 + 1e-30) - 3
    corr = np.corrcoef(L, R)[0, 1] if L.std() > 0 and R.std() > 0 else 1.0
    print(f'{shown(path)}  the part that sounds, {off:.2f}-{off + len(x) / rate:.2f} s: rms {20 * np.log10(rms):.1f}  peak {20 * np.log10(pk):.1f} dBFS  '
          f'crest (peak over rms) {20 * np.log10(pk / rms):.1f} dB  excess kurtosis {kurt:.2f} (0: steady noise; high: spiky)  L/R correlation {corr:.2f} (1: mono)')
    P = (np.abs(np.fft.rfft(L)) ** 2 + np.abs(np.fft.rfft(R)) ** 2) / 2
    f = np.fft.rfftfreq(len(L), 1 / rate)
    tot = (x ** 2).mean()
    bands = []
    for fc in (31.5, 63, 125, 250, 500, 1000, 2000, 4000, 8000, 16000):
        band = (f >= fc / 2 ** 0.5) & (f < fc * 2 ** 0.5)
        bands.append(f'{fc:g}: {10 * np.log10(P[band].sum() / P.sum() * tot + 1e-18):.0f}')
    print('   octave bands (dBFS): ' + '   '.join(bands))
    # How steady it is: the 2-8 kHz band's level frame by frame. Dense noise at 20 ms: about 0.5 dB of spread, no
    # frame more than 2 dB up; separate hits, ticks or a loop's seam show as several dB.
    X = np.fft.rfft(x.mean(axis=1))
    X[(f < 2000) | (f > 8000)] = 0
    b = np.fft.irfft(X, len(L))
    parts = []
    for ms in (5, 20, 100):
        h = int(rate * ms / 1000)
        nfr = len(b) // h
        if nfr < 4:
            continue
        e = np.sqrt((b[:nfr * h].reshape(nfr, h) ** 2).mean(axis=1)) + 1e-12
        parts.append(f'{ms} ms frames: spread {20 * np.log10(1 + e.std() / e.mean()):.2f} dB, loudest +{20 * np.log10(e.max() / e.mean()):.1f}, quietest {20 * np.log10(e.min() / e.mean()):.1f}')
    print('   2-8 kHz level, frame by frame, in dB against its mean: ' + '; '.join(parts))

def main():
    a = sys.argv[1:]
    kw, files, suffix, outdir, stack, nums = {}, [], '', None, None, False
    i = 0
    while i < len(a):
        if a[i] in ('--t0', '--t1', '--lin'): kw[a[i][2:]] = float(a[i + 1]); i += 2
        elif a[i] == '--nfft': kw['nfft'] = int(a[i + 1]); i += 2
        elif a[i] == '--suffix': suffix = a[i + 1]; i += 2
        elif a[i] == '--out': outdir = a[i + 1]; i += 2
        elif a[i] == '--stack': stack = a[i + 1]; i += 2
        elif a[i] == '--numbers': nums = True; i += 1
        elif a[i] in ('--help', '-h'): print(open(__file__, encoding='utf-8').read().split('import sys')[0]); return
        elif a[i].startswith('--'): raise SystemExit(f'unknown option {a[i]} (--help)')
        else:   # as given, or relative to this folder or its out/ (so out/x.wav and x.wav work from anywhere)
            hits = next((h for h in (sorted(glob.glob(os.path.join(d, a[i]))) for d in ('', HERE, os.path.join(HERE, 'out'))) if h), None)
            if not hits: raise SystemExit(f'no such WAV: {a[i]}')
            files += hits; i += 1
    if not files:
        out = os.path.join(HERE, 'out')
        files = [w for w in sorted(glob.glob(os.path.join(out, '*.wav')))
                 if not os.path.exists(w[:-4] + '.png') or os.path.getmtime(w[:-4] + '.png') < os.path.getmtime(w)]
        if not files:
            print(f'nothing to draw: every WAV in {out} has its PNG'); return
    files = [f.replace(os.sep, '/') for f in files]
    if nums:
        for p in files:
            numbers(p, kw.get('t0'), kw.get('t1'))
        return
    if not suffix:       # a zoomed picture gets its own name: a_0.2-0.6.png, a_lin2000.png
        zoom = ([f"{kw.get('t0', 0):g}-{kw['t1']:g}" if 't1' in kw else f"{kw['t0']:g}-"] if 't0' in kw or 't1' in kw else []) + ([f"lin{kw['lin']:g}"] if 'lin' in kw else [])
        suffix = ''.join('_' + z for z in zoom)
    if stack and 't1' not in kw:      # one time axis for the whole stack: the longest file's (the shorter are padded)
        kw['t1'] = max(len(x) / rate for x, rate in (read_wav(p) for p in files))
    pics = [(p, picture(p, **kw)) for p in files]
    if stack:
        sheet = Image.new('RGB', (pics[0][1].width, sum(c.height for _, c in pics)), (16, 16, 18))
        y = 0
        for _, c in pics:
            sheet.paste(c, (0, y)); y += c.height
        out = stack if os.path.isabs(stack) or os.path.dirname(stack) else os.path.join(outdir or os.path.dirname(files[0]), stack)
        sheet.save(out)
        print(shown(out))
        return
    for p, c in pics:
        out = os.path.join(outdir or os.path.dirname(p), os.path.basename(p)[:-4] + suffix + '.png')
        c.save(out)
        print(shown(out))

if __name__ == '__main__':
    main()
