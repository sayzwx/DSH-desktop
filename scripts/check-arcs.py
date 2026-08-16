# -*- coding: utf-8 -*-
"""Targeted check: painted arcs actually removed from 1-clean.png (thin-band highpass along each arc)."""
import numpy as np
import cv2
from PIL import Image
from scipy.ndimage import gaussian_filter

orig = np.asarray(Image.open(r"D:\DS_harness\1.jpg").convert("RGB"), dtype=np.float32) / 255.0
clean = np.asarray(Image.open(r"D:\DS_harness\scripts\1-clean.png").convert("RGB"), dtype=np.float32) / 255.0
H, W = orig.shape[:2]

ARCS = [
    (0.260, 0.344, 0.337, 0.246),
    (0.321, 0.263, 0.413, 0.162),
    (0.310, 0.447, 0.370, 0.365),
    (0.393, 0.464, 0.442, 0.394),
    (0.362, 0.522, 0.392, 0.465),
    (0.716, 0.535, 0.788, 0.491),
    (0.735, 0.507, 0.786, 0.567),
]

def highpass(img):
    l = img @ np.array([0.2126, 0.7152, 0.0722], dtype=np.float32)
    return l - gaussian_filter(l, sigma=1.2)

hpo, hpc = highpass(orig), highpass(clean)

for (x0, y0, x1, y1) in ARCS:
    p0 = np.array([x0 * W, y0 * H]); p1 = np.array([x1 * W, y1 * H])
    L = np.linalg.norm(p1 - p0)
    n = int(L)
    vals_o, vals_c = [], []
    for i in range(n):
        p = p0 + (p1 - p0) * (i / max(n - 1, 1))
        xi, yi = int(p[0]), int(p[1])
        for dy in range(-3, 4):
            for dx in range(-2, 3):
                if 0 <= yi + dy < H and 0 <= xi + dx < W:
                    vals_o.append(hpo[yi + dy, xi + dx])
                    vals_c.append(hpc[yi + dy, xi + dx])
    vo, vc = np.array(vals_o), np.array(vals_c)
    print(f"arc ({x0:.3f},{y0:.3f})->({x1:.3f},{y1:.3f}) len={L:.0f}px")
    print(f"   original max={vo.max():.3f} p99={np.percentile(vo,99):.3f} | cleaned max={vc.max():.3f} p99={np.percentile(vc,99):.3f}")
