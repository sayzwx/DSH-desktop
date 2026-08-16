# -*- coding: utf-8 -*-
"""Verify loop seam on the ENCODED mp4: frame 0 vs last frame."""
import subprocess
import sys
import numpy as np
import imageio_ffmpeg
from PIL import Image

MP4 = r"D:\DS_harness\renderer\bg-animated.mp4"
exe = imageio_ffmpeg.get_ffmpeg_exe()

def grab_frames(expr, out):
    r = subprocess.run([exe, '-v', 'error', '-i', MP4, '-vf', f"select='{expr}'",
                        '-vsync', '0', '-f', 'image2', out], capture_output=True)
    return r.returncode, r.stderr.decode(errors='ignore')

rc, err = grab_frames("eq(n,0)+eq(n,1439)", r"D:\DS_harness\scripts\loop-f%d.png")
if rc != 0:
    print("extract failed:", err[-400:]); sys.exit(1)

a = np.asarray(Image.open(r"D:\DS_harness\scripts\loop-f1.png"), dtype=np.float32)
b = np.asarray(Image.open(r"D:\DS_harness\scripts\loop-f2.png"), dtype=np.float32)
d = np.abs(a - b)
print(f"encoded loop seam diff: mean={d.mean():.4f} max={d.max():.0f} (>0 px: {(d>8).mean()*100:.4f}%)")
print("SEAMLESS" if d.mean() < 1.5 else "CHECK")
