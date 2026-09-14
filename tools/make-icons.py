#!/usr/bin/env python3
"""สร้างไอคอน PWA โดยไม่พึ่งไลบรารีภายนอก

เครื่องที่ใช้สร้างโปรเจกต์นี้ไม่มี Pillow หรือ ImageMagick ติดตั้งอยู่
สคริปต์นี้จึงวาดภาพลงบัฟเฟอร์เองแล้วเข้ารหัสเป็น PNG ด้วย zlib
ซึ่งเป็นไลบรารีมาตรฐานของ Python ทำให้สร้างไอคอนซ้ำได้ทุกเครื่อง

รูปคือคลื่นสัญญาณ RFID สามชั้นบนพื้นสีเขียวน้ำเงิน สื่อถึงการอ่านแท็กระยะไกล
"""

import math
import struct
import zlib
from pathlib import Path

BRAND = (15, 118, 110)    # --brand ในไฟล์ styles.css
INK = (255, 255, 255)
SUPERSAMPLE = 3           # วาดใหญ่แล้วย่อ เพื่อให้ขอบโค้งเรียบโดยไม่ต้องใช้ไลบรารี


def rounded_rect(x, y, w, h, r):
    """คืนฟังก์ชันทดสอบว่าจุดหนึ่งอยู่ในสี่เหลี่ยมมุมมนหรือไม่"""
    def inside(px, py):
        cx = min(max(px, x + r), x + w - r)
        cy = min(max(py, y + r), y + h - r)
        if x + r <= px <= x + w - r or y + r <= py <= y + h - r:
            return x <= px <= x + w and y <= py <= y + h
        return (px - cx) ** 2 + (py - cy) ** 2 <= r * r
    return inside


def render(size):
    s = size * SUPERSAMPLE
    px = bytearray(s * s * 3)

    bg = rounded_rect(0, 0, s, s, s * 0.22)
    # จุดศูนย์กลางคลื่นอยู่ล่างซ้าย ให้คลื่นแผ่ไปทางขวาบน
    ox, oy = s * 0.30, s * 0.72
    bands = [(0.16, 0.205), (0.30, 0.345), (0.44, 0.485)]
    dot_r = s * 0.075

    for py in range(s):
        for pxi in range(s):
            color = None
            if bg(pxi + 0.5, py + 0.5):
                color = BRAND
                dx, dy = pxi + 0.5 - ox, py + 0.5 - oy
                dist = math.hypot(dx, dy)

                if dist <= dot_r:
                    color = INK
                else:
                    # จำกัดคลื่นไว้ในช่วง 0–90 องศาทางขวาบน ให้เป็นรูปพัด
                    angle = math.atan2(-dy, dx)
                    if -0.08 <= angle <= math.pi / 2 + 0.08:
                        for inner, outer in bands:
                            if s * inner <= dist <= s * outer:
                                color = INK
                                break
            else:
                color = None

            if color:
                i = (py * s + pxi) * 3
                px[i], px[i + 1], px[i + 2] = color

    return downsample(px, s, size)


def downsample(px, src_size, dst_size):
    """เฉลี่ยสีจากภาพใหญ่ลงภาพเล็ก ทำให้ขอบดูเรียบ (anti-aliasing)"""
    out = bytearray(dst_size * dst_size * 3)
    n = SUPERSAMPLE * SUPERSAMPLE
    for y in range(dst_size):
        for x in range(dst_size):
            r = g = b = 0
            for sy in range(SUPERSAMPLE):
                row = (y * SUPERSAMPLE + sy) * src_size
                for sx in range(SUPERSAMPLE):
                    i = (row + x * SUPERSAMPLE + sx) * 3
                    r += px[i]; g += px[i + 1]; b += px[i + 2]
            o = (y * dst_size + x) * 3
            out[o], out[o + 1], out[o + 2] = r // n, g // n, b // n
    return out


def write_png(path, rgb, size):
    raw = b''.join(
        b'\x00' + bytes(rgb[y * size * 3:(y + 1) * size * 3])
        for y in range(size)
    )

    def chunk(tag, data):
        body = tag + data
        return struct.pack('>I', len(data)) + body + struct.pack('>I', zlib.crc32(body))

    png = (b'\x89PNG\r\n\x1a\n'
           + chunk(b'IHDR', struct.pack('>IIBBBBB', size, size, 8, 2, 0, 0, 0))
           + chunk(b'IDAT', zlib.compress(raw, 9))
           + chunk(b'IEND', b''))
    Path(path).write_bytes(png)
    print(f'{path} ({size}x{size}, {len(png)} bytes)')


if __name__ == '__main__':
    out = Path(__file__).resolve().parent.parent / 'web' / 'icons'
    out.mkdir(parents=True, exist_ok=True)
    for size in (192, 512):
        write_png(out / f'icon-{size}.png', render(size), size)
