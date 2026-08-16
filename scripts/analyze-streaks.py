# -*- coding: utf-8 -*-
"""Zoom into streak candidates + fine row profile."""
import numpy as np
from PIL import Image
from scipy.ndimage import gaussian_filter

SRC = r"D:\DS_harness\1.jpg"
a = np.asarray(Image.open(SRC).convert("RGB"), dtype=np.float32) / 255.0
H, W = a.shape[:2]
lum = a @ np.array([0.2126, 0.7152, 0.0722], dtype=np.float32)

print("--- fine row profile (every 2%) ---")
for i in range(0, 100, 2):
    y0 = int(H * i / 100); y1 = int(H * (i + 2) / 100)
    r = lum[y0:y1]
    warm = ((a[y0:y1, :, 0] > 0.4) & (a[y0:y1, :, 0] > a[y0:y1, :, 2] * 1.3)).mean()
    print(f"y={i/100:.2f} mean={r.mean():.3f} p90={np.percentile(r,90):.3f} warm={warm:.3f}")

cands = [
    ("c1", 0.582, 0.290), ("c2", 0.750, 0.490), ("c3", 0.493, 0.162),
    ("c4", 0.690, 0.357), ("c5", 0.282, 0.301), ("c6", 0.366, 0.441),
    ("c7", 0.387, 0.195), ("c8", 0.344, 0.094), ("c9", 0.797, 0.345),
]
print("\n--- zoomed ASCII around candidates (bright > local mean + 2.2sd shown) ---")
for name, cx, cy in cands:
    # window 0.16W x 0.30H
    w = int(W * 0.16); h = int(H * 0.30)
    x0 = int(np.clip(cx * W - w / 2, 0, W - w)); y0 = int(np.clip(cy * H - h / 2, 0, H - h))
    sub = lum[y0:y0 + h, x0:x0 + w]
    m, s = sub.mean(), sub.std()
    thr = m + 2.2 * s
    AW, AH = 72, 34
    ys = (np.arange(AH) + 0.5) * h / AH
    xs = (np.arange(AW) + 0.5) * w / AW
    block = sub[np.ix_(ys.astype(int), xs.astype(int))]
    chars = " .:=+*#@"
    # relative to window: show dim too
    lo = block.min(); hi = block.max()
    idx = np.clip((block - lo) / max(hi - lo, 1e-6) * (len(chars) - 1), 0, len(chars) - 1).astype(int)
    print(f"\n[{name}] center=({cx},{cy}) window x=[{x0/W:.2f},{ (x0+w)/W:.2f}] y=[{y0/H:.2f},{(y0+h)/H:.2f}] thr_pix={ (sub>thr).sum() }")
    for row in idx:
        print("".join(chars[i] for i in row))
