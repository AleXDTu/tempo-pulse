#!/usr/bin/env python3
"""Tempo Pulse 应用图标生成器（纯标准库，无依赖）。

设计：macOS 风格圆角方块（深海军蓝渐变）+ 分段圆环（一天的时间块，
配色取自三种内置状态）+ 中心脉搏线（Pulse）。2x 超采样抗锯齿。

用法：python3 scripts/make_icon.py [输出路径，默认 app-icon.png]
"""

import math
import struct
import sys
import zlib

SIZE = 1024
SS = 2  # 超采样倍数
S = SIZE * SS

CX = CY = 512.0
# 圆角方块（macOS Big Sur 风格：1024 画布留 100 边距）
BOX = (100.0, 100.0, 924.0, 924.0)
BOX_R = 185.0

# 分段圆环：从 12 点钟顺时针，每段 (起始角, 跨度角, 颜色)
RING_R = 262.0
RING_W = 76.0
GAP = 5.0
ORANGE = (249, 115, 22)   # focus 认真工作
SKY = (56, 189, 248)      # slack 摸鱼
EMERALD = (52, 211, 153)  # rest 休息
SEGMENTS = [
    (0.0, 90.0, ORANGE),
    (95.0, 42.0, SKY),
    (142.0, 54.0, EMERALD),
    (201.0, 26.0, SKY),
    (232.0, 128.0, ORANGE),
]

# 中心脉搏线（EKG）
PULSE_W = 34.0
PULSE = [
    (342.0, 514.0), (442.0, 514.0), (474.0, 476.0), (512.0, 612.0),
    (550.0, 404.0), (578.0, 514.0), (682.0, 514.0),
]
WHITE = (248, 250, 252)


def clamp(v, a, b):
    return max(a, min(b, v))


def sd_rounded_rect(px, py):
    x0, y0, x1, y1 = BOX
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    hx, hy = (x1 - x0) / 2, (y1 - y0) / 2
    qx, qy = abs(px - cx) - (hx - BOX_R), abs(py - cy) - (hy - BOX_R)
    ox, oy = max(qx, 0.0), max(qy, 0.0)
    return math.hypot(ox, oy) + min(max(qx, qy), 0.0) - BOX_R


def angle_of(px, py):
    """0°=12点钟，顺时针递增"""
    return math.degrees(math.atan2(px - CX, -(py - CY))) % 360.0


def endpoint(a_deg):
    rad = math.radians(a_deg)
    return CX + RING_R * math.sin(rad), CY - RING_R * math.cos(rad)


def sd_arc(px, py, a0, a1):
    """圆弧段 SDF（带圆帽端点）"""
    ang = angle_of(px, py)
    span = (ang - a0) % 360.0
    total = (a1 - a0) % 360.0
    if span <= total:
        return abs(math.hypot(px - CX, py - CY) - RING_R) - RING_W / 2
    ex0, ey0 = endpoint(a0)
    ex1, ey1 = endpoint(a1)
    d0 = math.hypot(px - ex0, py - ey0)
    d1 = math.hypot(px - ex1, py - ey1)
    return min(d0, d1) - RING_W / 2


def sd_segment(px, py, ax, ay, bx, by):
    abx, aby = bx - ax, by - ay
    apx, apy = px - ax, py - ay
    t = clamp((apx * abx + apy * aby) / (abx * abx + aby * aby), 0.0, 1.0)
    return math.hypot(apx - t * abx, apy - t * aby)


def sample(px, py):
    """返回 (r, g, b, a)，各分量 0..1"""
    # 圆角方块蒙版 + 垂直渐变底
    d_box = sd_rounded_rect(px, py)
    if d_box > SS:
        return (0.0, 0.0, 0.0, 0.0)
    t = clamp((py - BOX[1]) / (BOX[3] - BOX[1]), 0.0, 1.0)
    top, bot = (11, 18, 32), (26, 42, 74)
    r = (top[0] + (bot[0] - top[0]) * t) / 255.0
    g = (top[1] + (bot[1] - top[1]) * t) / 255.0
    b = (top[2] + (bot[2] - top[2]) * t) / 255.0

    # 中心微光
    glow = clamp(1.0 - math.hypot(px - CX, py - CY) / 500.0, 0.0, 1.0) ** 2
    r += (56 / 255 - r) * glow * 0.16
    g += (189 / 255 - g) * glow * 0.16
    b += (248 / 255 - b) * glow * 0.16

    # 分段圆环
    for a0, span, color in SEGMENTS:
        d = sd_arc(px, py, a0 + GAP / 2, a0 + span - GAP / 2)
        if d < SS:
            cov = clamp(0.5 - d / (2 * SS), 0.0, 1.0)
            cr, cg, cb = color[0] / 255, color[1] / 255, color[2] / 255
            r += (cr - r) * cov
            g += (cg - g) * cov
            b += (cb - b) * cov

    # 脉搏线（盖在最上层）
    dmin = float("inf")
    for i in range(len(PULSE) - 1):
        ax, ay = PULSE[i]
        bx, by = PULSE[i + 1]
        dmin = min(dmin, sd_segment(px, py, ax, ay, bx, by))
    d = dmin - PULSE_W / 2
    if d < SS:
        cov = clamp(0.5 - d / (2 * SS), 0.0, 1.0)
        r += (WHITE[0] / 255 - r) * cov
        g += (WHITE[1] / 255 - g) * cov
        b += (WHITE[2] / 255 - b) * cov

    # 蒙版边缘 AA
    a = clamp(0.5 - d_box / (2 * SS), 0.0, 1.0)
    return (r, g, b, a)


def render():
    x0 = int(BOX[0] - 4) * SS
    y0 = int(BOX[1] - 4) * SS
    x1 = int(BOX[2] + 4) * SS
    y1 = int(BOX[3] + 4) * SS
    acc = {}
    for sy in range(y0, y1):
        py = (sy + 0.5) / SS
        for sx in range(x0, x1):
            px = (sx + 0.5) / SS
            r, g, b, a = sample(px, py)
            ox, oy = sx // SS, sy // SS
            cell = acc.get((ox, oy))
            if cell is None:
                acc[(ox, oy)] = [r, g, b, a, 1]
            else:
                cell[0] += r; cell[1] += g; cell[2] += b; cell[3] += a; cell[4] += 1
    rows = []
    for y in range(SIZE):
        row = bytearray()
        for x in range(SIZE):
            cell = acc.get((x, y))
            if cell is None:
                row += b"\x00\x00\x00\x00"
            else:
                n = cell[4]
                row += bytes((
                    int(clamp(cell[0] / n, 0, 1) * 255),
                    int(clamp(cell[1] / n, 0, 1) * 255),
                    int(clamp(cell[2] / n, 0, 1) * 255),
                    int(clamp(cell[3] / n, 0, 1) * 255),
                ))
        rows.append(bytes(row))
    return rows


def write_png(path, rows):
    def chunk(tag, data):
        c = struct.pack(">I", len(data)) + tag + data
        return c + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    ihdr = struct.pack(">IIBBBBB", SIZE, SIZE, 8, 6, 0, 0, 0)
    raw = b"".join(b"\x00" + r for r in rows)
    png = (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", ihdr)
        + chunk(b"IDAT", zlib.compress(raw, 9))
        + chunk(b"IEND", b"")
    )
    with open(path, "wb") as f:
        f.write(png)


if __name__ == "__main__":
    out = sys.argv[1] if len(sys.argv) > 1 else "app-icon.png"
    write_png(out, render())
    print(f"written {out} ({SIZE}x{SIZE})")
