#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""从一张方形 AI 生成图产出应用图标（DSH.ico 多尺寸 + DSH.png 256）。

用法:
    python scripts/make-app-icon.py <源图> [--repo <仓库根>] [--dry-run]

它会做两件事：

1. **去掉右下角的水印**（豆包等生成器会盖"XX AI 生成"）。
   做法：把待修区域按**图标中心**水平镜像一份，当"干净背景的估计"——
   圆角矩形左右对称，左下角就是右下角的镜像；再用 |原图 − 镜像| 的差分定出水印掩膜
   （比只看颜色阈值稳：半透明边缘、压在亮边/白底上的笔画都能覆盖），
   逐行亮度校正 + 按到掩膜边缘的距离羽化后合成。补丁边界跟着字形走，不留矩形接缝。
2. **生成多尺寸 ICO**：16/24/32/40/48/64/96/128/256，小尺寸额外锐化一次
   （1536 → 16 直接 LANCZOS 会糊掉轮廓）。

为什么不用涂抹/扩散：水印压在"深蓝底 + 圆角亮边 + 圆角外白底"三种结构的交界处，
模糊会把亮边糊掉；镜像能同时还原结构与颜色。
"""
import argparse
import os
import sys

import numpy as np
from PIL import Image, ImageFilter

SIZES = [16, 24, 32, 40, 48, 64, 96, 128, 256]


def morph(mask, mode, times=1):
    """3x3 腐蚀/膨胀（不依赖 scipy：取 9 个平移版本的并/交）。"""
    for _ in range(times):
        out = np.ones_like(mask) if mode == 'erode' else np.zeros_like(mask)
        for sy in (-1, 0, 1):
            for sx in (-1, 0, 1):
                sh = np.roll(np.roll(mask, sy, axis=0), sx, axis=1)
                out = (out & sh) if mode == 'erode' else (out | sh)
        mask = out
    return mask


def remove_watermark(src_path):
    """返回去掉右下角水印的 PIL 图（RGB）。找不到水印时原样返回并在 stderr 提示。"""
    im = Image.open(src_path).convert('RGB')
    a = np.asarray(im).astype(np.float64)
    H, W = a.shape[:2]
    cx = (W - 1) / 2.0

    # 只看右下角：水印出现在这里（各生成器都在右下角）
    X0, X1 = int(W * 0.50), W
    Y0, Y1 = int(H * 0.78), int(H * 0.995)
    win = a[Y0:Y1, X0:X1, :]
    h = Y1 - Y0
    xs_idx = np.arange(X0, X1)
    xm_idx = np.clip(np.round(2 * cx - xs_idx).astype(int), 0, W - 1)
    mir = a[Y0:Y1][:, xm_idx, :].copy()

    spread = win.max(axis=2) - win.min(axis=2)
    bright = win.mean(axis=2)
    grayish = (spread < 34) & (bright > 70) & (bright < 246)   # 灰字兜底

    # 逐行亮度校正：背景梯度左右不完全一致，用该行非灰字像素对齐
    for i in range(h):
        row_ok = ~grayish[i]
        if row_ok.sum() < 20:
            continue
        off = np.clip((win[i][row_ok] - mir[i][row_ok]).mean(axis=0), -25, 25)
        mir[i] = np.clip(mir[i] + off, 0, 255)

    diff = np.abs(win - mir).sum(axis=2)
    mask = morph(morph((diff > 34) | grayish, 'dilate', 1), 'dilate', 1)
    if mask.sum() < 20:
        print('[warn] 右下角没有检测到水印，原样输出', file=sys.stderr)
        return im

    ys, xs = np.where(mask)
    print(f'[info] 水印掩膜 {mask.sum()} 像素，范围 x {X0+xs.min()}→{X0+xs.max()} '
          f'y {Y0+ys.min()}→{Y0+ys.max()}', file=sys.stderr)

    core = morph(mask, 'erode', 1)
    dist = np.where(core, 0.0, 99.0)      # 🔴 核心区必须为 0，否则 alpha 算成 0 = 没填
    cur = core.copy()
    for step in range(1, 15):
        nxt = morph(cur, 'dilate', 1) & ~cur
        dist[nxt] = step
        cur = cur | nxt
    alpha = np.where(cur, np.clip(1.0 - (dist - 1) / 14.0, 0, 1), 0.0)[:, :, None]

    out = a.copy()
    out[Y0:Y1, X0:X1, :] = win * (1 - alpha) + mir * alpha
    return Image.fromarray(np.clip(out, 0, 255).astype(np.uint8))


def build_icons(img, repo, dry_run=False):
    base = img.resize((256, 256), Image.LANCZOS)
    base = base.filter(ImageFilter.UnsharpMask(radius=1.6, percent=55, threshold=2))
    frames = []
    for s in SIZES:
        f = img.resize((s, s), Image.LANCZOS)
        if s <= 48:
            f = f.filter(ImageFilter.UnsharpMask(radius=0.8, percent=90, threshold=1))
        frames.append(f)
    if dry_run:
        for s, f in zip(SIZES, frames):
            f.save(os.path.join(repo, 'dist', f'icon-{s}.png'))
        print(f'[dry-run] 已输出各尺寸 PNG 到 dist/（{SIZES}）', file=sys.stderr)
        return
    base.save(os.path.join(repo, 'DSH.png'))
    frames[-1].save(os.path.join(repo, 'DSH.ico'), format='ICO',
                    sizes=[(s, s) for s in SIZES], append_images=frames[:-1])
    print(f'[ok] 已写 {repo}\\DSH.png (256) 与 {repo}\\DSH.ico（{SIZES}）', file=sys.stderr)


def main():
    ap = argparse.ArgumentParser(description='从方形 AI 生成图产出 DSH 应用图标')
    ap.add_argument('source', help='源图路径（方形，含水印也可）')
    ap.add_argument('--repo', default=os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                    help='仓库根目录（默认脚本上一级）')
    ap.add_argument('--dry-run', action='store_true', help='只输出各尺寸 PNG，不覆盖仓库图标')
    args = ap.parse_args()

    if not os.path.isfile(args.source):
        print(f'找不到源图: {args.source}', file=sys.stderr)
        return 2
    img = remove_watermark(args.source)
    build_icons(img, args.repo, args.dry_run)
    return 0


if __name__ == '__main__':
    sys.exit(main())
