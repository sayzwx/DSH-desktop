# -*- coding: utf-8 -*-
"""Inpaint the painted meteor arcs out of the base image (curated arc list)."""
import numpy as np
import cv2
from PIL import Image

SRC = r"D:\DS_harness\1.jpg"
OUT = r"D:\DS_harness\scripts\1-clean.png"
MASKVIZ = r"D:\DS_harness\scripts\1-mask-viz.png"

img = Image.open(SRC).convert("RGB")
a = np.asarray(img, dtype=np.float32) / 255.0
H, W = a.shape[:2]

# curated painted-meteor arcs (normalized line endpoints, grouped by arc family)
ARCS = [
    # A1 左上主弧（确认）
    (0.260, 0.344, 0.337, 0.246),
    # A2 顶部小弧（确认）
    (0.321, 0.263, 0.413, 0.162),
    # A3 左中星云区弧线（平行两条 + 一条较陡）
    (0.310, 0.447, 0.370, 0.365),
    (0.393, 0.464, 0.442, 0.394),
    (0.362, 0.522, 0.392, 0.465),
    # A4 右侧星云区交叉弧（两条）
    (0.716, 0.535, 0.788, 0.491),
    (0.735, 0.507, 0.786, 0.567),
]

mask = np.zeros((H, W), dtype=np.uint8)
for (x0, y0, x1, y1) in ARCS:
    p0 = (int(x0 * W), int(y0 * H))
    p1 = (int(x1 * W), int(y1 * H))
    cv2.line(mask, p0, p1, 255, 8)
    print(f"arc line ({x0:.3f},{y0:.3f})->({x1:.3f},{y1:.3f})")

dil = cv2.dilate(mask, np.ones((7, 7), np.uint8))
bgr = cv2.cvtColor((a * 255).astype(np.uint8), cv2.COLOR_RGB2BGR)
cleaned = cv2.inpaint(bgr, dil, 5.0, cv2.INPAINT_TELEA)
Image.fromarray(cv2.cvtColor(cleaned, cv2.COLOR_BGR2RGB)).save(OUT, quality=100)
print(f"saved {OUT}")

vis = bgr.copy()
vis[dil > 0] = (0, 0, 255)
Image.fromarray(cv2.cvtColor(vis, cv2.COLOR_BGR2RGB)).save(MASKVIZ, quality=95)
print(f"saved {MASKVIZ}")
