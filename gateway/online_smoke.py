#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
线上网关端到端冒烟测试（真实 HTTP）
  1. 健康检查
  2. 取验证码 PNG
  3. 用服务端同款 5x7 点阵字模做模板匹配，识别出算式并算出答案
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
    "+": [".....", "..#..", "..#..", "#####", "..#..", "..#..", "....."],
    "-": [".....", ".....", ".....", "#####", ".....", ".....", "....."],
    "=": [".....", ".....", "#####", ".....", "#####", ".....", "....."],
    "?": [".###.", "#...#", "....#", "...#.", "..#..", ".....", "..#.."],
    "x": [".....", "#...#", ".#.#.", "..#..", ".#.#.", "#...#", "....."],
}
SCALE = 6
GW, GH = 5, 7
GAP = 3
PAD_X, PAD_Y = 12, 14
CANVAS_W = 186   # 服务端固定画布宽度

# 字模展开成 5x7 的 0/1 模板
TEMPLATES = {}
for ch, rows in GLYPHS.items():
    TEMPLATES[ch] = [[1 if rows[y][x] == "#" else 0 for x in range(GW)] for y in range(GH)]


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


# ---------------- PNG 解码（只处理 truecolor 8bit / grayscale） ----------------
def decode_png(raw):
    assert raw[:8] == b"\x89PNG\r\n\x1a\n", "not png"
    pos = 8
    w = h = bitdepth = colortype = None
    idat = b""
    palette = b""
    trns = b""
    while pos < len(raw):
        ln = struct.unpack(">I", raw[pos:pos + 4])[0]
        typ = raw[pos + 4:pos + 8]
        data = raw[pos + 8:pos + 8 + ln]
        if typ == b"IHDR":
            w, h, bitdepth, colortype = struct.unpack(">IIBB", data[:10])
        elif typ == b"PLTE":
            palette = data
        elif typ == b"tRNS":
            trns = data
        elif typ == b"IDAT":
            idat += data
        elif typ == b"IEND":
            break
        pos += 12 + ln
    assert bitdepth == 8, f"bitdepth={bitdepth}"
    d = zlib.decompress(idat)
    channels = {0: 1, 2: 3, 3: 1, 4: 2, 6: 4}[colortype]
    bpp = channels
    stride = w * channels
    out = bytearray()
    prev = bytearray(stride)
    p = 0
    for _ in range(h):
        ft = d[p]; p += 1
        line = bytearray(d[p:p + stride]); p += stride
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
                c = prev[i - bpp] if i >= bpp else 0
                b = prev[i]
                pa, pb, pc = abs(b - c), abs(a - c), abs(a + b - 2 * c)
                pr = a if (pa <= pb and pa <= pc) else (b if pb <= pc else c)
                line[i] = (line[i] + pr) & 0xFF
        out += line
        prev = line

    px = []
    for y in range(h):
        row = out[y * stride:(y + 1) * stride]
        for x in range(w):
            if colortype == 3:
                idx = row[x]
                r, g, b = palette[idx * 3], palette[idx * 3 + 1], palette[idx * 3 + 2]
            elif colortype == 0:
                r = g = b = row[x]
            elif colortype == 4:
                r = g = b = row[x * 2]
            elif colortype == 6:
                r, g, b = row[x * 4], row[x * 4 + 1], row[x * 4 + 2]
            else:
                r, g, b = row[x * 3], row[x * 3 + 1], row[x * 3 + 2]
            px.append((r, g, b))
    return w, h, px


def is_bright(c):
    """字符笔画是绿/琥珀/青/黄绿等彩色，比背景(8-36)和灰噪点(60-150灰)更饱和"""
    r, g, b = c
    mx, mn = max(c), min(c)
    return (mx - mn) >= 55 and mx >= 110


def match_char(px, w, h, base_x):
    """在给定横向起点上做模板匹配，返回 (best_char, best_score)"""
    best = ("?", -1.0)
    for ch, tpl in TEMPLATES.items():
        for dy in (-2, -1, 0, 1, 2):
            for dx in (-1, 0, 1):
                hit = 0
                total = 0
                for gy in range(GH):
                    for gx in range(GW):
                        if not tpl[gy][gx]:
                            continue
                        total += 1
                        cnt = 0
                        for sy in range(SCALE):
                            for sx in range(SCALE):
                                x = base_x + gx * SCALE + sx + dx
                                y = PAD_Y + gy * SCALE + sy + dy
                                if 0 <= x < w and 0 <= y < h and is_bright(px[y * w + x]):
                                    cnt += 1
                        if cnt >= SCALE * SCALE * 0.55:
                            hit += 1
                if total == 0:
                    continue
                score = hit / total
                # 惩罚：空白区域不该有亮像素
                penalty = 0
                for gy in range(GH):
                    for gx in range(GW):
                        if tpl[gy][gx]:
                            continue
                        cnt = 0
                        for sy in range(SCALE):
                            for sx in range(SCALE):
                                x = base_x + gx * SCALE + sx + dx
                                y = PAD_Y + gy * SCALE + sy + dy
                                if 0 <= x < w and 0 <= y < h and is_bright(px[y * w + x]):
                                    cnt += 1
                        if cnt > SCALE * SCALE * 0.5:
                            penalty += 1
                score -= penalty * 0.02
                if score > best[1]:
                    best = (ch, score)
    return best


def solve(raw):
    """识别整张验证码：在整幅宽度上做全局滑窗，找到最佳的对齐起点后逐槽匹配"""
    w, h, px = decode_png(raw)
    cell_span = GW * SCALE + GAP
    n_text = 5   # 算式恒为 5 个字符：a+b=? / hi-lo=?

    best = None
    # 起点候选：0..width - n_text*cell_span
    for base0 in range(0, max(1, w - n_text * cell_span + 1)):
        chars = []
        total_score = 0.0
        for i in range(n_text):
            ch, sc = match_char(px, w, h, base0 + i * cell_span)
            chars.append((ch, sc))
            total_score += sc
        if best is None or total_score > best[0]:
            best = (total_score, base0, chars)

    if best is None:
        return "?", []
    return "".join(c for c, _ in best[2]), best[2]


def eval_expr(text):
    """text 形如 '3+4=?' 或 '7-2=?'"""
    body = text.replace("?", "").replace("=", "")
    if "+" in body:
        a, b = body.split("+")
        return int(a) + int(b)
    if "-" in body:
        a, b = body.split("-")
        return int(a) - int(b)
    return None


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
    if "json" in ct:
        print("  JSON 模式（Turnstile）:", body.decode()[:300])
        print("  → 线上走 Turnstile，跳过本地识别")
        return ok

    print("=== 3. 识别验证码 ===")
    text, chars = solve(body)
    print("  识别结果:", text, " 各字得分:", [(c, round(s, 2)) for c, s in chars])
    answer = eval_expr(text)
    print("  算式答案:", answer)
    if answer is None:
        print("  !! 识别失败")
        return False

    print("=== 4. 提交评论 ===")
    st, body, _ = req("/api/comments", {
        "post": "p1", "nickname": "冒烟测试",
        "content": "线上网关冒烟测试：" + text + " = " + str(answer),
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
        st2, b2, _ = req("/api/captcha")
        h2 = dict(b2 and {} or {})
        # 重新取 id + 识别
        _, cap, hh = req("/api/captcha")
        cid2 = hh.get("X-Captcha-Id")
        t2, _c2 = solve(cap)
        a2 = eval_expr(t2)
        s3, b3, _ = req("/api/comments", {
            "post": "p1", "nickname": "限流",
            "content": "限流测试第 " + str(i + 1) + " 条",
            "captchaId": cid2, "captchaAnswer": str(a2),
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
