# -*- coding: utf-8 -*-
"""
Render the animated background — v2.

Changes vs v1 (user feedback):
  * 全天空都在动：流场扭曲覆盖整片天空（不再只集中在中右亮区）+ 缓慢垂直游移 + 星星闪烁
  * 云层不再"幻影"：底图云带被分解为「静态大气辉光」+「预乘云层」，
    只有云层本体漂移，底图不含任何静态云结构
  * 流星系统重做：底图中的静态流星弧线已预先 inpaint 抹除；
    流星只在划过时出现（贝塞尔弧线 + 沿轨迹运动模糊的柔和尾迹），旧的简易自绘流星已弃用
  * 城市灯火闪烁 / 光波扫过 / 地平线呼吸 / 双档 Bloom 保留并加强

Output: renderer/bg-animated.mp4 (H.264 NVENC 1080p60, 24s seamless loop) + preview jpg.
"""
import numpy as np
import cv2
import subprocess
import sys
import time
import os

import imageio_ffmpeg
from PIL import Image

SRC = r"D:\DS_harness\scripts\1-clean.png"     # base with static meteor arcs inpainted out
OUT_MP4 = r"D:\DS_harness\renderer\bg-animated.mp4"
OUT_PREVIEW = r"D:\DS_harness\renderer\bg-animated-preview.jpg"
W, H = 1920, 1080
T = 24.0
FPS = 60
N = int(T * FPS)
if os.environ.get('DSH_TEST_FRAMES'):
    N = int(os.environ['DSH_TEST_FRAMES'])
    OUT_MP4 = r"D:\DS_harness\scripts\test-out.mp4"
    OUT_PREVIEW = r"D:\DS_harness\scripts\test-preview.jpg"

print("loading source...", flush=True)
img = np.asarray(Image.open(SRC).convert("RGB"), dtype=np.float32) / 255.0
base = cv2.resize(img, (W, H), interpolation=cv2.INTER_LANCZOS4)
blur1 = cv2.GaussianBlur(base, (0, 0), 1.1)
base = np.clip(base + (base - blur1) * 0.35, 0, 1)

lum = base @ np.array([0.2126, 0.7152, 0.0722], dtype=np.float32)
yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
yn = yy / H
xn = xx / W

print("precomputing fields...", flush=True)
blur12 = cv2.GaussianBlur(lum, (0, 0), 12)
nebw = np.clip((blur12 - 0.15) / 0.20, 0, 1)

# ---- full-sky flow: whole sky moves, nebula areas a bit more ----
sky_ramp = np.clip(np.interp(yn, [0.0, 0.60, 0.70], [1.0, 0.85, 0.0]), 0, 1).astype(np.float32)
amp = (11.0 * sky_ramp * (0.45 + 0.55 * nebw)).astype(np.float32)

# ---- cloud decomposition: static glow + premultiplied drifting cloud layer ----
band_w = np.clip(np.interp(yn, [0.44, 0.50, 0.66, 0.74], [0.0, 1.0, 1.0, 0.0]), 0, 1).astype(np.float32)
glow32 = cv2.GaussianBlur(base, (0, 0), 32)
base_clean = base * (1 - band_w[..., None]) + glow32 * band_w[..., None]
ls = cv2.GaussianBlur(lum, (0, 0), 3)
lg = cv2.GaussianBlur(lum, (0, 0), 32)
d = ls - lg
side_feather = np.clip(np.minimum(xn, 1 - xn) / 0.030, 0, 1).astype(np.float32)
cloud_alpha = (np.clip((np.abs(d) - 0.016) / 0.05, 0, 1) * band_w * side_feather).astype(np.float32)
cloud_rgb = base * cloud_alpha[..., None]           # premultiplied

# ---- city lights ----
city_ramp = np.clip(np.interp(yn, [0.70, 0.74, 0.86, 0.90], [0.0, 1.0, 1.0, 0.0]), 0, 1).astype(np.float32)
R, G, B = base[..., 0], base[..., 1], base[..., 2]
warmw = np.clip((R - np.maximum(G, B) * 0.9 - 0.08) / 0.18, 0, 1)
lightw = (np.clip((lum - 0.20) / 0.28, 0, 1) * warmw).astype(np.float32)
hsh = (np.sin(xn * 12.9898 + yn * 78.233) * 43758.5453) % 1.0
hsh2 = (np.sin(xn * 39.234 + yn * 12.987) * 24634.6345) % 1.0
shimmer_pat = 0.5 + 0.5 * np.sin(2 * np.pi * (3.3 * xn + 1.7 * yn + 0.6 * hsh))

# ---- star twinkle ----
star_hp = lum - cv2.GaussianBlur(lum, (0, 0), 1.2)
sky_top = np.clip(np.interp(yn, [0.0, 0.58, 0.66], [1.0, 1.0, 0.0]), 0, 1).astype(np.float32)
star_mask = (np.clip((star_hp - 0.05) / 0.03, 0, 1) * sky_top).astype(np.float32)
tw_amp = (0.4 + 0.6 * hsh).astype(np.float32)

hp_ramp = np.clip(np.interp(yn, [0.54, 0.58, 0.66, 0.70], [0.0, 1.0, 1.0, 0.0]), 0, 1).astype(np.float32)

# ---- meteors: 沿原图弧线轨迹（与参考图同方向/同位置/同构型），高斯光斑绘制 ----
# A = 尾端（弧线起点）  B = 头端（亮端，头部滑向的方向）；curve = 控制点侧向偏移比例
METEORS = [
    dict(A=(0.337, 0.246), B=(0.260, 0.344), curve=0.030, t0=0.030, dur=1.70, col=(0.55, 0.85, 1.00)),
    dict(A=(0.413, 0.162), B=(0.321, 0.263), curve=0.030, t0=0.155, dur=1.70, col=(0.62, 0.80, 1.00)),
    dict(A=(0.370, 0.365), B=(0.310, 0.447), curve=0.030, t0=0.280, dur=1.70, col=(0.55, 0.85, 1.00)),
    dict(A=(0.442, 0.394), B=(0.393, 0.464), curve=0.030, t0=0.405, dur=1.55, col=(0.60, 0.78, 1.00)),
    dict(A=(0.392, 0.465), B=(0.362, 0.522), curve=0.030, t0=0.530, dur=1.55, col=(0.55, 0.85, 1.00)),
    dict(A=(0.788, 0.491), B=(0.716, 0.535), curve=0.020, t0=0.655, dur=1.70, col=(0.75, 0.85, 1.00)),
    dict(A=(0.680, 0.060), B=(0.520, 0.200), curve=0.050, t0=0.780, dur=1.70, col=(0.72, 0.62, 1.00)),
    dict(A=(0.240, 0.050), B=(0.090, 0.210), curve=0.050, t0=0.905, dur=1.70, col=(0.55, 0.85, 1.00)),
]

def _meteor_path(m):
    """dense polyline (normalized) covering the arc + a short exit extension."""
    A = np.array(m['A'], dtype=np.float64)
    B = np.array(m['B'], dtype=np.float64)
    chord = B - A
    L = np.linalg.norm(chord)
    perp = np.array([-chord[1], chord[0]]) / L
    ctrl = (A + B) / 2 + perp * m['curve'] * L
    n = 80
    s = np.linspace(0.0, 1.15, n)[:, None]
    t = np.minimum(s, 1.0)
    mt = 1 - t
    pts = mt * mt * A + 2 * mt * t * ctrl + t * t * B
    tb = 2 * (B - ctrl)
    tb /= np.linalg.norm(tb)
    ext = (s - 1.0) * 0.15 * L * tb
    return pts + np.where(s > 1.0, ext, 0.0)

for _m in METEORS:
    _m['path'] = _meteor_path(_m)

def draw_meteors(frame, th):
    for m in METEORS:
        dur = m['dur'] / T
        if not (m['t0'] < th < m['t0'] + dur):
            continue
        tau = float(np.clip((th - m['t0']) / dur, 0, 1))
        env = float(np.sin(np.pi * tau) ** 0.9)
        s_h = min(tau * 1.12, 1.12)
        ih = int(s_h * 79)
        it = int(max(0.0, s_h - 1.0) * 79)
        if ih - it < 3:
            continue
        path = m['path'][it:ih + 1] * np.array([W, H])
        pad = 70
        x0 = int(max(0, path[:, 0].min() - pad)); y0 = int(max(0, path[:, 1].min() - pad))
        x1 = int(min(W, path[:, 0].max() + pad)); y1 = int(min(H, path[:, 1].max() + pad))
        rw, rh = x1 - x0, y1 - y0
        if rw < 3 or rh < 3:
            continue
        loc = path - np.array([x0, y0])
        nseg = len(loc)
        col_t = np.array(m['col'])[::-1]
        col_h = np.array([1.0, 0.98, 0.92])[::-1]
        glow = np.zeros((rh, rw, 3), dtype=np.float32)
        core = np.zeros((rh, rw, 3), dtype=np.float32)
        for i in range(nseg):
            f = i / (nseg - 1)                       # 0 = 尾端, 1 = 头部
            a = env * (f ** 1.5)
            c = col_t + (col_h - col_t) * f
            p = loc[i]
            cv2.circle(glow, (int(p[0]), int(p[1])), max(1, int(round(3.4 - 1.6 * f))),
                       tuple(c * a * 0.60), -1, cv2.LINE_AA)
            cv2.circle(core, (int(p[0]), int(p[1])), max(1, int(round(1.5 - 0.8 * f))),
                       tuple(c * a), -1, cv2.LINE_AA)
        p = loc[-1]
        cv2.circle(glow, (int(p[0]), int(p[1])), 5, tuple(col_h * env * 0.35), -1, cv2.LINE_AA)
        cv2.circle(core, (int(p[0]), int(p[1])), 2, tuple(col_h * env * 0.9), -1, cv2.LINE_AA)
        glow = cv2.GaussianBlur(glow, (0, 0), 2.6)
        core = cv2.GaussianBlur(core, (0, 0), 0.9)
        region = frame[y0:y1, x0:x1]
        frame[y0:y1, x0:x1] = np.clip(region + glow + core, 0, 1)

def render_frame(th):
    ph = 2 * np.pi * th
    # 1) full-sky flow warp + gentle vertical pan
    fx = amp * (0.55 * np.sin(2 * np.pi * (1.9 * yn + th) + 0.20)
                + 0.45 * np.sin(2 * np.pi * (2.7 * xn + 0.7 * yn + 2 * th) + 0.80)
                + 0.30 * np.sin(2 * np.pi * (0.8 * xn + 1.1 * yn + th) + 1.40))
    fy = amp * 0.55 * (0.50 * np.sin(2 * np.pi * (1.3 * xn + th) + 2.10)
                       + 0.50 * np.sin(2 * np.pi * (2.3 * yn + 2 * th) + 0.50))
    fy = fy + 3.5 * sky_ramp * np.sin(2 * np.pi * (th + 0.25))
    out = cv2.remap(base_clean, (xx + fx).astype(np.float32), (yy + fy).astype(np.float32),
                    cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)
    # 2) star twinkle + global shimmer
    tw = 1 + 0.20 * star_mask * tw_amp * (0.5 + 0.5 * np.sin(2 * np.pi * (2 * th + hsh2 * 2 * np.pi)))
    sh = 1 + 0.012 * np.sin(2 * np.pi * (2 * th) + shimmer_pat * 2 * np.pi)
    out = out * ((tw * sh)[..., None] * sky_top[..., None] + (1 - sky_top[..., None]))
    # 3) drifting clouds (premultiplied layer over the cloud-free base -> no ghosting)
    xoff = (36 * np.sin(ph + 1.7 * yn * 2 * np.pi + 0.3)
            + 14 * np.sin(2 * ph + 0.9 * yn * 2 * np.pi + 1.9)).astype(np.float32)
    yoff = (4.0 * np.sin(2 * ph + 2.3 * yn * 2 * np.pi + 0.8)).astype(np.float32)
    a_m = cv2.remap(cloud_alpha, (xx - xoff).astype(np.float32), (yy - yoff).astype(np.float32),
                    cv2.INTER_LINEAR, borderMode=cv2.BORDER_WRAP)
    r_m = cv2.remap(cloud_rgb, (xx - xoff).astype(np.float32), (yy - yoff).astype(np.float32),
                    cv2.INTER_LINEAR, borderMode=cv2.BORDER_WRAP)
    out = out * (1 - a_m[..., None]) + r_m
    # 4) city lights
    tw_c = 0.5 + 0.5 * np.sin(2 * np.pi * (11 * th + hsh))
    wave = 0.5 + 0.5 * np.sin(2 * np.pi * (2 * th + 2.2 * xn))
    fac = 1 + 0.40 * lightw * tw_c + 0.07 * wave * city_ramp
    city = base * fac[..., None]
    mask = city_ramp[..., None]
    out = out * (1 - mask) + city * mask
    # 5) horizon breathing
    hp = 1 + 0.06 * (0.5 + 0.5 * np.sin(2 * np.pi * (2 * th + 0.4)))
    out = out * (1 + (hp - 1) * hp_ramp[..., None])
    # 6) meteors
    draw_meteors(out, th)
    # 7) bloom
    lum_c = out @ np.array([0.2126, 0.7152, 0.0722], dtype=np.float32)
    bright = np.clip((lum_c - 0.70) / 0.30, 0, 1)[..., None]
    b1 = cv2.GaussianBlur(out * bright, (0, 0), 14)
    b2 = cv2.GaussianBlur(out * bright, (0, 0), 4)
    return np.clip(out + 0.50 * b1 + 0.18 * b2, 0, 1)

def encode(proc):
    t0 = time.time()
    sheet = np.zeros((270 * 2, 480 * 3, 3), dtype=np.uint8)
    for f in range(N):
        th = f / N
        frame = render_frame(th)
        if f == 0:
            Image.fromarray((frame * 255).astype(np.uint8)).save(OUT_PREVIEW, quality=93)
        proc.stdin.write((frame * 255).astype(np.uint8).tobytes())
        slot = int(f * 6 // N)
        if slot < 6 and f == int(slot * N / 6):
            small = cv2.resize(frame, (480, 270), interpolation=cv2.INTER_AREA)
            sheet[slot // 3 * 270:(slot // 3 + 1) * 270, slot % 3 * 480:(slot % 3 + 1) * 480] = (small * 255).astype(np.uint8)
        if (f + 1) % 240 == 0:
            el = time.time() - t0
            print(f"  frame {f + 1}/{N}  ({el:.0f}s, {el / (f + 1) * 1000:.0f}ms/frame, eta {(el / (f + 1)) * (N - f - 1) / 60:.1f}min)", flush=True)
    Image.fromarray(sheet).save(r"D:\DS_harness\scripts\preview-sheet.jpg", quality=92)
    proc.stdin.close()
    rc = proc.wait()
    print(f"ffmpeg exit code: {rc}", flush=True)

def build_cmd(encoder):
    exe = imageio_ffmpeg.get_ffmpeg_exe()
    base_cmd = [exe, '-y', '-hide_banner', '-loglevel', 'error',
                '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', f'{W}x{H}', '-r', str(FPS), '-i', '-',
                '-an', '-c:v']
    if encoder == 'nvenc':
        return base_cmd + ['h264_nvenc', '-preset', 'p7', '-tune', 'hq', '-rc', 'vbr',
                           '-cq', '18', '-b:v', '0', '-maxrate', '30M', '-bufsize', '60M',
                           '-rc-lookahead', '32', '-spatial_aq', '1', '-temporal_aq', '1',
                           '-profile:v', 'high', '-level', '4.2', '-pix_fmt', 'yuv420p',
                           '-movflags', '+faststart', OUT_MP4]
    return base_cmd + ['libx264', '-preset', 'medium', '-crf', '16', '-profile:v', 'high',
                       '-level', '4.2', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', OUT_MP4]

if __name__ == '__main__':
    enc = sys.argv[1] if len(sys.argv) > 1 else 'nvenc'
    print(f"encoder: {enc}; frames: {N} @ {W}x{H} {FPS}fps, loop {T}s", flush=True)
    proc = subprocess.Popen(build_cmd(enc), stdin=subprocess.PIPE,
                            stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
    try:
        encode(proc)
    except BrokenPipeError:
        proc.kill()
        err = proc.stderr.read().decode(errors='ignore')
        print(f"ENCODER FAILED ({enc}):\n{err[-1500:]}", flush=True)
        sys.exit(2)
    if proc.returncode != 0:
        err = proc.stderr.read().decode(errors='ignore')
        print(f"ENCODER FAILED ({enc}):\n{err[-1500:]}", flush=True)
        sys.exit(3)
    print(f"done -> {OUT_MP4}  ({os.path.getsize(OUT_MP4) / 1e6:.1f} MB)", flush=True)
