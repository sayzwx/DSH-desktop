# -*- coding: utf-8 -*-
"""Detect thin bright line segments (painted meteor streaks) via connected components."""
import numpy as np
from PIL import Image
from scipy.ndimage import gaussian_filter, label

SRC = r"D:\DS_harness\1.jpg"
a = np.asarray(Image.open(SRC).convert("RGB"), dtype=np.float32) / 255.0
H, W = a.shape[:2]
lum = a @ np.array([0.2126, 0.7152, 0.0722], dtype=np.float32)

sky = lum[:int(H * 0.55)]
blur = gaussian_filter(sky, sigma=2.5)
hp = sky - blur
thr = hp.mean() + 3.2 * hp.std()
mask = (hp > thr) & (sky > 0.30)

lbl, n = label(mask)
print(f"components: {n}, thr={thr:.3f}")
comps = []
for i in range(1, n + 1):
    ys, xs = np.nonzero(lbl == i)
    if len(xs) < 30:
        continue
    # bounding box + PCA thinness
    w = xs.max() - xs.min(); h = ys.max() - ys.min()
    if w < 12 and h < 12:
        continue
    cov = np.cov(xs, ys)
    evals, evecs = np.linalg.eigh(cov)
    ratio = evals[1] / max(evals[0], 1e-9)
    if ratio < 2.5:
        continue
    v = evecs[:, 1]
    if abs(v[0]) < 0.3:
        continue  # near-vertical not a meteor
    # color of the streak
    cols = a[ys, xs]
    mean_col = cols.mean(axis=0)
    warm = mean_col[0] > mean_col[2]
    comps.append(dict(
        n=len(xs), ratio=ratio,
        cx=(xs.mean() / W), cy=(ys.mean() / H),
        dx=v[0], dy=v[1],
        x0=(xs.min() / W), x1=(xs.max() / W),
        y0=(ys.min() / H), y1=(ys.max() / H),
        color=mean_col.tolist(), warm=bool(warm),
    ))

comps.sort(key=lambda c: -c['n'])
print("\nthin bright segments (n, ratio, cx, cy, dir, bbox, rgb):")
for c in comps:
    print(f"n={c['n']:4d} thin={c['ratio']:5.1f} c=({c['cx']:.3f},{c['cy']:.3f}) dir=({c['dx']:+.2f},{c['dy']:+.2f}) "
          f"bbox=({c['x0']:.3f},{c['y0']:.3f})-({c['x1']:.3f},{c['y1']:.3f}) rgb=({c['color'][0]:.2f},{c['color'][1]:.2f},{c['color'][2]:.2f}) warm={c['warm']}")
