# -*- coding: utf-8 -*-
"""v2 checks: no static arcs, cloud decomposition, motion coverage, loop seam."""
import sys
import importlib.util
import numpy as np
import cv2
from PIL import Image

spec = importlib.util.spec_from_file_location("render_bg", r"D:\DS_harness\scripts\render-bg.py")
rb = importlib.util.module_from_spec(spec)
spec.loader.exec_module(rb)
W, H = rb.W, rb.H

print("== 1) static arcs removed from base ==")
for name, r0, r1 in [("A1", (0.24, 0.23), (0.36, 0.37)), ("A2", (0.30, 0.15), (0.43, 0.28))]:
    x0, y0 = int(r0[0] * W), int(r0[1] * H)
    x1, y1 = int(r1[0] * W), int(r1[1] * H)
    hp = rb.lum - cv2.GaussianBlur(rb.lum, (0, 0), 1.2)
    print(f"  {name}: highpass max in region = {hp[y0:y1, x0:x1].max():.3f} (sky stars ~0.05-0.10)")

print("== 2) cloud decomposition ==")
band = rb.base_clean[int(0.52 * H):int(0.64 * H)]
glow = rb.glow32[int(0.52 * H):int(0.64 * H)]
print(f"  base_clean band vs static glow: mean diff = {np.abs(band - glow).mean():.5f} (should be ~0)")
print(f"  cloud_alpha max = {rb.cloud_alpha.max():.3f}, mean in band = {rb.cloud_alpha[int(0.52*H):int(0.64*H)].mean():.4f}")

print("== 3) motion coverage (whole sky alive) ==")
f0 = rb.render_frame(0.0)
f_half = rb.render_frame(0.5)
d = np.abs(f0 - f_half).mean(axis=2)
zones = {
    "top-left sky (0.05-0.35,0.05-0.40)": d[30:440, 100:680],
    "top-right sky (0.60-0.95,0.05-0.40)": d[30:440, 1160:1830],
    "center sky (0.35-0.60,0.35-0.55)": d[380:600, 670:1160],
    "cloud band": d[int(0.50 * H):int(0.68 * H)],
    "city": d[int(0.74 * H):],
}
for k, v in zones.items():
    print(f"  {k}: mean diff = {v.mean():.5f}")

print("== 4) meteors ==")
for th in [0.02, 0.095, 0.34, 0.60, 0.845]:
    m = rb.render_frame(th)
    print(f"  th={th:.3f}: max={m.max():.3f}")
f_mid = rb.render_frame(0.095)
print(f"  meteor region max at th=0.095: {f_mid[40:440, 600:1400].max():.3f}")

print("== 5) loop seam & sanity ==")
flast = rb.render_frame((rb.N - 1) / rb.N)
print(f"  f0 vs f_last: {np.abs(f0 - flast).mean():.5f}")
print(f"  f0 vs f1: {np.abs(f0 - rb.render_frame(1/rb.N)).mean():.5f}")
print(f"  nans: {np.isnan(f0).sum() + np.isnan(flast).sum()}")
print(f"  luma f0={ (f0 @ np.array([0.2126,0.7152,0.0722])).mean():.4f}  clean_base={ (rb.base_clean @ np.array([0.2126,0.7152,0.0722])).mean():.4f}")

Image.fromarray((f0 * 255).astype(np.uint8)).save(r"D:\DS_harness\scripts\chk-v2-f0.jpg", quality=95)
Image.fromarray((f_half * 255).astype(np.uint8)).save(r"D:\DS_harness\scripts\chk-v2-fhalf.jpg", quality=95)
print("saved chk-v2-f0.jpg / chk-v2-fhalf.jpg")
