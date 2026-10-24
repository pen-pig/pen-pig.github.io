#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
评论数据备份 / 恢复工具
------------------------------------------------------------
为什么需要它：
  网关重新部署时，线上沙箱的 data/ 目录会被本地文件覆盖，
  也就是「重新部署 = 清空线上评论」。这个脚本在部署前把线上数据拉回本地，
  部署时就会一起带上，评论就不会丢。

用法：
  python3 gateway/backup.py pull    # 从线上拉取全部评论，存到本地 data/comments.json
  python3 gateway/backup.py push    # 把本地 data/comments.json 推回线上（覆盖）
  python3 gateway/backup.py show    # 只看线上/本地各有几条

注意：push 会覆盖线上全部评论，请谨慎。
"""
import json
import os
import sys
import urllib.request
import urllib.error

BASE = "https://pen-pig-comment-gateway.app.workbuddy.host"
CODE = "OBVHYSCDUX"
LOCAL = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", "comments.json")


def get(path):
    sep = "&" if "?" in path else "?"
    url = f"{BASE}{path}{sep}sharecode={CODE}"
    with urllib.request.urlopen(url, timeout=30) as resp:
        return json.loads(resp.read().decode("utf-8"))


def pull():
    data = get("/api/comments/export")
    comments = data.get("comments", [])
    os.makedirs(os.path.dirname(LOCAL), exist_ok=True)
    with open(LOCAL, "w", encoding="utf-8") as f:
        json.dump(comments, f, ensure_ascii=False, indent=2)
    print(f"已拉取 {len(comments)} 条评论 -> {LOCAL}")
    return comments


def push():
    with open(LOCAL, "r", encoding="utf-8") as f:
        local = json.load(f)
    print(f"本地有 {len(local)} 条评论。")
    print("提示：当前线上没有批量写入接口，push 需逐条 POST（会消耗限流额度）。")
    print("更推荐的做法：pull 之后重新部署网关 —— 部署会把本地文件一起带上去。")
    return local


def show():
    try:
        online = get("/api/comments/export")
        print("线上：", online.get("count"), "条")
    except Exception as e:
        print("线上读取失败：", e)
    try:
        with open(LOCAL, "r", encoding="utf-8") as f:
            print("本地：", len(json.load(f)), "条")
    except Exception as e:
        print("本地读取失败：", e)


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "show"
    if cmd == "pull":
        pull()
    elif cmd == "push":
        push()
    elif cmd == "show":
        show()
    else:
        print(__doc__)
