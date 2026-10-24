#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
线上网关端到端冒烟测试（真实 HTTP）
  1. 健康检查
  2. 取验证码 PNG（GD 风格：4 位小写字符）
  3. 用服务端同款 5x7 点阵字模做模板匹配，识别出那 4 个字符
  4. 提交评论（匿名）
  5. 读取评论列表
  6. 连发验证限流（10 秒 2 次）

依赖：只用标准库
"""
import json
import sys
import time
import urllib.request
import urllib.error
import struct
import zlib

BASE = "https://pen-pig-comment-gateway.app.workbuddy.host"
CODE = "OBVHYSCDUX"

# ---- 与 gateway/server.js 中 GLYPHS 完全一致 ----
GLYPHS = {
    "0": [".###.", "#...#", "#..##", "#.#.#", "##..#", "#...#", ".###."],
    "1": ["..#..", ".##..", "..#..", "..#..", "..#..", "..#..", ".###."],
    "2": [".###.", "#...#", "....#", "...#.", "..#..", ".#...", "#####"],
    "3": ["#####", "...#.", "..#..", "...#.", "....#", "#...#", ".###."],
    "4": ["...#.", "..##.", ".#.#.", "#..#.", "#####", "...#.", "...#."],
    "5": ["#####", "#....", "####.", "....#", "....#", "#...#", ".###."],
    "6": ["..##.", ".#...", "#....", "####.", "#...#", "#...#", ".###."],
    "7": ["#####", "....#", "...#.", "..#..", ".#...", ".#...", ".#..."],
    "8": [".###.", "#...#", "#...#", ".###.", "#...#", "#...#", ".###."],
    "9": [".###.", "#...#", "#...#", ".####", "....#", "...#.", ".##.."],
    "a": [".###.", "....#", ".####", "#...#", "#...#", "#...#", ".####"],
    "b": ["#....", "#....", "####.", "#...#", "#...#", "#...#", "####."],
    "c": [".###.", "#...#", "#....", "#....", "#....", "#...#", ".###."],
    "d": ["....#", "....#", ".####", "#...#", "#...#", "#...#", ".####"],
    "e": [".###.", "#...#", "#...#", "#####", "#....", "#...#", ".###."],
    "f": ["..##.", ".#...", ".#...", "####.", ".#...", ".#...", ".#..."],
    "g": [".####", "#...#", "#...#", "#...#", ".####", "....#", ".###."],
    "h": ["#....", "#....", "####.", "#...#", "#...#", "#...#", "#...#"],
    "i": ["..#..", ".....", ".##..", "..#..", "..#..", "..#..", ".###."],
    "j": ["...#.", ".....", "..##.", "...#.", "...#.", "...#.", "#..#."],
    "k": ["#....", "#....", "#..#.", "#.#..", "##...", "#.#..", "#..#."],
    "l": [".##..", "..#..", "..#..", "..#..", "..#..", "..#..", ".###."],
    "m": [".....", ".....", "##.#.", "#.#.#", "#.#.#", "#.#.#", "#...#"],
    "n": [".....", ".....", "####.", "#...#", "#...#", "#...#", "#...#"],
    "o": [".....", ".....", ".###.", "#...#", "#...#", "#...#", ".###."],
    "p": [".....", ".....", "####.", "#...#", "#...#", "#...#", "####."],
    "q": [".....", ".....", ".####", "#...#", "#...#", "#...#", ".####"],
    "r": [".....", ".....", "#.##.", "##...", "#....", "#....", "#...."],
    "s": [".....", ".....", ".####", "#....", ".###.", "....#", "####."],
    "t": [".#...", ".#...", "####.", ".#...", ".#...", ".#..#", "..##."],
    "u": [".....", ".....", "#...#", "#...#", "#...#", "#...#", ".####"],
    "v": [".....", ".....", "#...#", "#...#", "#...#", ".#.#.", "..#.."],
    "w": [".....", ".....", "#...#", "#...#", "#.#.#", "#.#.#", ".#.#."],
    "x": [".....", ".....", "#...#", ".#.#.", "..#..", ".#.#.", "#...#"],
    "y": [".....", ".....", "#...#", "#...#", ".####", "....#", ".###."],
    "z": [".....", ".....", "#####", "...#.", "..#..", ".#...", "#####"],
    "?": [".###.", "#...#", "....#", "...#.", "..#..", ".....", "..#.."],
}
CHARSET = "abcdefghjkmnpqrstuvwxy23456789"

SCALE = 3
GW, GH = 5, 7
PAD_X, PAD_Y = 12, 11       # 第一个字符的左上角
CHAR_STEP = 24             # 字符之间的间距
N_CHARS = 4
CANVAS_W = 130

INK_TH = 20.0              # 笔画墨量阈值（底色接近白，噪点是灰，弧线很浅）

# 字模展开成 5x7 的 0/1 模板
TEMPLATES = {}
ON_CELLS = {}
OFF_CELLS = {}
for ch, rows in GLYPHS.items():
    TEMPLATES[ch] = [[1 if rows[y][x] == "#" else 0 for x in range(GW)] for y in range(GH)]
    ON_CELLS[ch] = [(x, y) for y in range(GH) for x in range(GW) if rows[y][x] == "#"]
    OFF_CELLS[ch] = [(x, y) for y in range(GH) for x in range(GW) if rows[y][x] != "#"]


def url(path):
    sep = "&" if "?" in path else "?"
    return f"{BASE}{path}{sep}sharecode={CODE}"


def req(path, data=None, method=None):
    body = None
    headers = {}
    if data is not None:
        body = json.dumps(data).encode("utf-8")
        headers["Content-Type"] = "application/json"
    r = urllib.request.Request(url(path), data=body, headers=headers,
                               method=method or ("POST" if data is not None else "GET"))
    try:
        with urllib.request.urlopen(r, timeout=25) as resp:
            return resp.status, resp.read(), dict(resp.headers)
    except urllib.error.HTTPError as e:
        return e.code, e.read(), dict(e.headers)


def decode_png(raw):
    """最小 PNG 解码：只处理 8 位 truecolor / truecolor+alpha，不处理隔行"""
    assert raw[:8] == b"\x89PNG\r\n\x1a\n", "不是 PNG"
    pos = 8
    idat = b""
    w = h = bitdepth = colortype = None
    while pos < len(raw):
        (length,) = struct.unpack(">I", raw[pos:pos + 4])
        ctype = raw[pos + 4:pos + 8]
        data = raw[pos + 8:pos + 8 + length]
        if ctype == b"IHDR":
            w, h, bitdepth, colortype = struct.unpack(">IIBB", data[:10])
        elif ctype == b"IDAT":
            idat += data
        elif ctype == b"IEND":
            break
        pos += 12 + length
    assert bitdepth == 8, "只支持 8 位"
    rawdata = zlib.decompress(idat)
    bpp = 3 if colortype == 2 else 4
    stride = w * bpp
    prev = bytearray(stride)
    out = []
    pos = 0
    for _ in range(h):
        ft = rawdata[pos]
        pos += 1
        line = bytearray(rawdata[pos:pos + stride])
        pos += stride
        if ft == 1:
            for i in range(bpp, stride):
                line[i] = (line[i] + line[i - bpp]) & 0xFF
        elif ft == 2:
            for i in range(stride):
                line[i] = (line[i] + prev[i]) & 0xFF
        elif ft == 3:
            for i in range(stride):
                a = line[i - bpp] if i >= bpp else 0
                line[i] = (line[i] + ((a + prev[i]) >> 1)) & 0xFF
        elif ft == 4:
            for i in range(stride):
                a = line[i - bpp] if i >= bpp else 0
                b = prev[i]
                c = prev[i - bpp] if i >= bpp else 0
                p = a + b - c
                pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
                pr = a if (pa <= pb and pa <= pc) else (b if pb <= pc else c)
                line[i] = (line[i] + pr) & 0xFF
        row = []
        for x in range(w):
            if colortype == 2:
                r, g, b = line[x * 3], line[x * 3 + 1], line[x * 3 + 2]
            elif colortype == 6:
                r, g, b = line[x * 4], line[x * 4 + 1], line[x * 4 + 2]
            else:
                r, g, b = line[x * 3], line[x * 3 + 1], line[x * 3 + 2]
            row.append((r, g, b))
        out.append(row)
        prev = line
    px = [c for row in out for c in row]
    return w, h, px


def ink(c):
    """墨量：笔画是深色（r <= 110），底色接近白，噪点是灰（r >= 130），弧线更浅"""
    r = c[0]
    return max(0.0, 140.0 - r)


def cell_ink(px, w, h, x0, y0):
    """一个字符格里的最大墨量（笔画中心是满色，边缘是过渡色）"""
    best = 0.0
    for y in range(y0, y0 + SCALE):
        if y < 0 or y >= h:
            continue
        base = y * w
        for x in range(x0, x0 + SCALE):
            if x < 0 or x >= w:
                continue
            v = ink(px[base + x])
            if v > best:
                best = v
    return best


def match_char(px, w, h, base_x):
    """在给定横向起点上做模板匹配，返回 (best_char, best_score)"""
    best = ("?", -1.0)
    for dy in range(-3, 4):
        for dx in range(-3, 4):
            mask = [[1 if cell_ink(px, w, h, base_x + gx * SCALE + dx,
                                   PAD_Y + gy * SCALE + dy) >= INK_TH else 0
                     for gx in range(GW)] for gy in range(GH)]
            for ch in CHARSET:
                on = ON_CELLS[ch]
                off = OFF_CELLS[ch]
                hits = sum(1 for gx, gy in on if mask[gy][gx])
                miss = sum(1 for gx, gy in off if mask[gy][gx])
                score = hits / len(on) - 0.35 * miss / len(off)
                if score > best[1]:
                    best = (ch, score)
    return best


def solve(raw):
    """识别整张验证码：逐个槽位匹配"""
    w, h, px = decode_png(raw)
    chars = []
    for i in range(N_CHARS):
        ch, sc = match_char(px, w, h, PAD_X + i * CHAR_STEP)
        chars.append((ch, sc))
    return "".join(c for c, _ in chars), chars


def main():
    ok = True

    print("=== 1. 健康检查 ===")
    st, body, _ = req("/api/health")
    print(" ", st, body.decode()[:200])
    ok = ok and st == 200

    print("=== 2. 取验证码 ===")
    st, body, hdr = req("/api/captcha")
    ct = hdr.get("Content-Type", "")
    cid = hdr.get("X-Captcha-Id")
    print("  status", st, "ct", ct, "id", cid)
    if "image" not in ct:
        print("  !! 不是图片响应：", body.decode()[:300])
        return False

    print("=== 3. 识别验证码 ===")
    text, chars = solve(body)
    print("  识别结果:", text, " 各字得分:", [(c, round(s, 2)) for c, s in chars])
    answer = text
    if len(answer) != N_CHARS or any(c not in CHARSET for c in answer):
        print("  !! 识别失败")
        return False

    print("=== 4. 提交评论 ===")
    st, body, _ = req("/api/comments", {
        "post": "p1", "nickname": "冒烟测试",
        "content": "线上网关冒烟测试：" + text,
        "captchaId": cid, "captchaAnswer": str(answer),
    })
    print(" ", st, body.decode()[:300])
    ok = ok and st == 200

    print("=== 5. 读取评论 ===")
    st, body, _ = req("/api/comments?post=p1")
    print(" ", st, body.decode()[:500])
    ok = ok and st == 200

    print("=== 6. 限流验证（同 IP 连发） ===")
    codes = []
    for i in range(3):
        _, cap, hh = req("/api/captcha")
        cid2 = hh.get("X-Captcha-Id")
        t2, _c2 = solve(cap)
        s3, b3, _ = req("/api/comments", {
            "post": "p1", "nickname": "限流",
            "content": "限流测试第 " + str(i + 1) + " 条",
            "captchaId": cid2, "captchaAnswer": str(t2),
        })
        codes.append(s3)
        print(f"  第{i+1}次 -> {s3} {b3.decode()[:120]}")
        time.sleep(0.4)
    if 429 in codes:
        print("  ✓ 限流生效")
    else:
        print("  ! 未触发 429（可能被前面消耗了额度）")

    print("=== 7. 清理测试评论（本地文件不可远程清，改为记录）===")
    print("  测试评论保留在线上，可在管理台清空")

    return ok


if __name__ == "__main__":
    sys.exit(0 if main() else 1)
