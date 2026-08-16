# -*- coding: utf-8 -*-
"""Analyze 1.jpg structure: bands, colors, bright features, meteor streaks."""
import numpy as np
from PIL import Image

SRC = r"D:\DS_harness\1.jpg"
img = Image.open(SRC).convert("RGB")
W, H = img.size
print(f"size: {W}x{H}")
a = np.asarray(img, dtype=np.float32) / 255.0
lum = a @ np.array([0.2126, 0.7152, 0.0722], dtype=np.float32)

# ---- per-row band stats (32 bands) ----
print("\n--- row bands (y_frac, mean RGB, mean lum) ---")
NB = 32
for i in range(NB):
    y0 = int(H * i / NB); y1 = int(H * (i + 1) / NB)
    band = a[y0:y1]
    print(f"{i/NB:.2f}-{(i+1)/NB:.2f}  R={band[...,0].mean():.3f} G={band[...,1].mean():.3f} B={band[...,2].mean():.3f} L={lum[y0:y1].mean():.3f}")

# ---- ASCII preview of luminance (96 cols) ----
print("\n--- ascii luminance map (96 x 44) ---")
AW, AH = 96, 44
ys = (np.arange(AH) + 0.5) * H / AH
xs = (np.arange(AW) + 0.5) * W / AW
block = lum[np.ix_(ys.astype(int), xs.astype(int))]
chars = " .:-=+*#%@"
for row in block:
    idx = np.clip((row - row.min()) / max(row.max() - row.min(), 1e-6) * (len(chars) - 1), 0, len(chars) - 1).astype(int)
    print("".join(chars[i] for i in idx))

# ---- color map (hue families) ----
print("\n--- color family distribution per band ---")
def fam(r, g, b):
    if max(r, g, b) - min(r, g, b) < 0.08: return 'gray'
    if r > g and r > b: return 'warm(r)'
    if b > r and b >= g: return 'blue(b)'
    if g >= b and g > r: return 'cyan(g)'
    return 'other'
for i in range(8):
    y0 = int(H * i / 8); y1 = int(H * (i + 1) / 8)
    band = a[y0:y1].reshape(-1, 3)
    fams = [fam(*p) for p in band[::7]]
    from collections import Counter
    c = Counter(fams)
    total = sum(c.values())
    print(f"band {i/8:.2f}: " + " ".join(f"{k}:{v*100//total}%" for k, v in c.most_common()))

# ---- bright pixel rows in bottom half (city lights) ----
print("\n--- bright pixel density per row (bottom 45%) ---")
for i in range(40, 64):
    y0 = int(H * i / 64); y1 = int(H * (i + 1) / 64)
    r = a[y0:y1].reshape(-1, 3)
    warm = ((r[:, 0] > 0.45) & (r[:, 1] > 0.25) & (r[:, 0] > r[:, 2] * 1.4)).mean()
    bright = (lum[y0:y1] > 0.55).mean()
    print(f"y={i/64:.2f} warm={warm:.3f} bright={bright:.3f}")

# ---- bright line segments in sky (meteor candidates) ----
print("\n--- bright diagonal line detection (sky top 55%) ---")
sky = a[:int(H * 0.55)].copy()
sky_lum = lum[:int(H * 0.55)]
# highpass: bright minus blurred
from scipy.ndimage import gaussian_filter
blur = gaussian_filter(sky_lum, sigma=3)
hp = sky_lum - blur
thr = hp.mean() + 3.5 * hp.std()
mask = (hp > thr) & (sky_lum > 0.25)
print(f"highpass thr={thr:.3f}, candidate pixels={mask.sum()}")
ys, xs = np.nonzero(mask)
if len(xs) > 3:
    # cluster by proximity
    pts = list(zip(xs, ys))
    clusters = []
    for p in pts:
        placed = False
        for cl in clusters:
            if abs(p[0] - cl['cx']) < W * 0.06 and abs(p[1] - cl['cy']) < H * 0.08:
                cl['pts'].append(p); cl['cx'] = np.mean([q[0] for q in cl['pts']]); cl['cy'] = np.mean([q[1] for q in cl['pts']]); placed = True; break
        if not placed:
            clusters.append({'pts': [p], 'cx': p[0], 'cy': p[1]})
    for cl in sorted(clusters, key=lambda c: -len(c['pts']))[:12]:
        if len(cl['pts']) < 4: break
        pxs = np.array([q[0] for q in cl['pts']]); pys = np.array([q[1] for q in cl['pts']])
        # fit line direction via PCA
        mx, my = pxs.mean(), pys.mean()
        cov = np.cov(pxs, pys)
        evals, evecs = np.linalg.eigh(cov)
        v = evecs[:, 1]
        print(f"streak: n={len(cl['pts'])} center=({mx/W:.3f},{my/H:.3f}) dir=({v[0]:.2f},{v[1]:.2f}) len={ (pxs.max()-pxs.min()):.0f}x{(pys.max()-pys.min()):.0f}px")
