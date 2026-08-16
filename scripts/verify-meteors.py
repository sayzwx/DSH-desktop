# -*- coding: utf-8 -*-
"""Meteor v3 checks: thin smooth streak, progressive drawing, arc positions."""
import sys
import importlib.util
import numpy as np
import cv2
from PIL import Image

spec = importlib.util.spec_from_file_location("render_bg", r"D:\DS_harness\scripts\render-bg.py")
rb = importlib.util.module_from_spec(spec)
spec.loader.exec_module(rb)
W, H = rb.W, rb.H

def streak_profile(frame, m, th):
    """measure width of the streak at its mid point (perpendicular profile)"""
    tau = (th - m['t0']) / (m['dur'] / rb.T)
    if not (0.05 < tau < 0.85):
        return None
    # position along arc at tau
    s = tau * 1.0
    path = m['path'][int(s * 79)]
    px, py = int(path[0] * W), int(path[1] * H)
    # direction
    A = np.array(m['A']); B = np.array(m['B'])
    d = (B - A) / np.linalg.norm(B - A)
    perp = np.array([-d[1], d[0]])
    # sample across perpendicular
    vals = []
    for k in range(-12, 13):
        qx = int(px + perp[0] * k * 2)
        qy = int(py + perp[1] * k * 2)
        if 0 <= qx < W and 0 <= qy < H:
            vals.append(frame[qy, qx].mean())
    vals = np.array(vals)
    mx = vals.max()
    half = (vals > mx * 0.5).sum()
    return mx, half

print("meteor visibility & thinness (mid-flight):")
for i, m in enumerate(rb.METEORS):
    th = m['t0'] + 0.45 * (m['dur'] / rb.T)
    f = rb.render_frame(th)
    r = streak_profile(f, m, th)
    print(f"  m{i} A={m['A']} B={m['B']} th={th:.3f} -> max={r[0]:.3f} half-width(px)={r[1] if r else 'skip'}")

# progressive drawing: trail length grows over time
print("\nprogressive trail length (m0):")
m = rb.METEORS[0]
for frac in [0.2, 0.5, 0.8]:
    th = m['t0'] + frac * (m['dur'] / rb.T)
    f = rb.render_frame(th)
    # count bright streak pixels along the arc strip
    path = m['path'] * np.array([W, H])
    cnt = 0
    for p in path[::2]:
        px, py = int(p[0]), int(p[1])
        if 0 <= px < W and 0 <= py < H and f[py, px].mean() > 0.55:
            cnt += 1
    print(f"  tau={frac}: bright arc pixels = {cnt}")

# loop seam still fine
f0 = rb.render_frame(0.0)
fl = rb.render_frame((rb.N - 1) / rb.N)
print(f"\nloop seam: {np.abs(f0 - fl).mean():.5f}  nans: {np.isnan(f0).sum() + np.isnan(fl).sum()}")

# save mid-flight crop for review
f = rb.render_frame(rb.METEORS[0]['t0'] + 0.5 * (rb.METEORS[0]['dur'] / rb.T))
crop = (f * 255).astype(np.uint8)[200:420, 400:760]
Image.fromarray(crop).save(r"D:\DS_harness\scripts\meteor-crop.jpg", quality=95)
print("saved meteor-crop.jpg")
