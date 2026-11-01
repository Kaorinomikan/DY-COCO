#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
抖音可可助手（DY-COCO）· 自更新清单生成器

用途
    生成仓库根目录下的 update-manifest.json —— 自更新时扩展据以「取哪些文件、
    多大、sha256 是多少」的唯一清单。

为什么需要它（26.10.10.6 引入）
    自更新原先走 Gitee API：1 次 /git/trees 列目录 + N 次 /git/blobs 取内容。
    但未登录调 API 限 60 次/小时，超出就 403 `Rate Limit Exceeded`。
    商家在办公室共享出口 IP（NAT）下可能本来就没额度，重试几次也会打满，
    表现就是「点安装更新 → 更新失败，磁盘保持原样」。真机已经撞到过一次。

    实测（2026-10-10）：Gitee 的 raw 通道 `…/raw/<tag>/<路径>` **不限流**
    （连续 30 次请求全部 200，同期 API 端点全是 403）。但 raw 只能按已知路径
    取单个文件，没有列目录的能力 —— 所以需要这份清单来告诉扩展有哪些文件。

    于是新的下载路径变成：1 次读本清单 + N 次 raw 取文件，**全程不碰 API**。

设计要点（改这个脚本前请先读）
    1. 【硬性】清单只列「扩展本体」：manifest.json + icons/ + src/。
       这必须与 src/update/update.js 里的 EXT_TOP_DIRS 白名单一一对应。
       两边不同步的后果：漏列 → 更新的文件不全；多列 → 把开发文件写进商家目录。
    2. 【硬性】清单本身在白名单之外，更新时不会被写进扩展目录。
       所以它可以安全地放在仓库根（和 README.md、publish.sh 并列）。
    3. 【硬性】不写时间戳等易变字段 —— 清单是纯函数输出，同样的文件必然产生
       同样的内容。这样 git diff 干净，只有文件真变了才显示改动。
    4. --check 模式供 publish.sh 调用：校验仓库里的清单与磁盘现状一致，
       不一致就中止发布。防的是「改了代码却忘了刷新清单」——
       那会让所有商家拉到一版对不上号的哈希，更新直接失败。
    5. 清单用 sha256 而不是 git blob SHA-1：raw 通道拿到的就是原始字节，
       直接算 sha256 即可，不需要在 JS 里模拟 git 的对象封装格式。

用法
    python make-update-manifest.py                 # 生成/刷新 update-manifest.json
    python make-update-manifest.py --check         # 只校验不写（发布闸门）
    python make-update-manifest.py --root <仓库根>
"""

import argparse
import hashlib
import json
import os
import sys

# 允许在 cmd 里正常打印中文
try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT_ROOT = os.path.dirname(HERE)

# 输出文件名。改这里必须同步改 src/shared/gitee.js 的 MANIFEST_FILE。
OUT_NAME = "update-manifest.json"

# 纳入清单的路径 —— 与 src/update/update.js 的 EXT_TOP_DIRS 保持一致。
# 改动这里必须同步改那边，否则自更新取到的文件集合就错了。
ROOT_FILES = ["manifest.json"]
DIRS = ["icons", "src"]

# 这些是编辑器/系统垃圾，不该进清单
IGNORE_NAMES = {".DS_Store", "Thumbs.db", "desktop.ini", "__pycache__", ".git"}


def fail(msg):
    print("[中止] " + msg)
    sys.exit(1)


# 二进制文件不参与行尾归一化（换行字节在二进制里是数据，不是行尾）
BINARY_EXTS = {".png", ".jpg", ".jpeg", ".gif", ".ico", ".bmp", ".webp",
               ".zip", ".crx", ".pem", ".woff", ".woff2", ".ttf", ".otf"}


def file_bytes(path):
    """读文件字节，并把**文本文件**的行尾归一化成 LF（模拟 git 的存储行为）。

    为什么必须做这一步（别删，这是真实踩过的坑）：
      git 仓库里的文本文件一律以 LF 存储 —— 本工程在 `.gitattributes` 里用
      `manifest.json text eol=lf` / `src/** text eol=lf` / `icons/** -text`
      锁死了这一点。扩展自更新时从 raw 通道拿到的就是
      这份 LF 内容。但**工作区**在 Windows（core.autocrlf=true）上可能是 CRLF：
      2026-10-10 实测本仓库就有 4 个 `src/content/*.js` 处于 `i/lf w/crlf` 状态。

      若直接对工作区字节算哈希，清单就会与仓库内容不符 ——
      后果是所有商家点「安装更新」全部校验失败，而报错是
      「内容校验失败：xxx」，看起来像文件损坏，极难定位。
    """
    with open(path, "rb") as f:
        data = f.read()
    if os.path.splitext(path)[1].lower() in BINARY_EXTS:
        return data
    if b"\x00" in data[:8192]:      # 含 NUL 字节，按二进制处理
        return data
    return data.replace(b"\r\n", b"\n").replace(b"\r", b"\n")


def read_version(root):
    p = os.path.join(root, "manifest.json")
    if not os.path.isfile(p):
        fail("找不到 manifest.json：%s" % p)
    try:
        with open(p, "r", encoding="utf-8") as f:
            m = json.load(f)
    except Exception as e:
        fail("manifest.json 解析失败：%s" % e)
    v = m.get("version")
    if not v:
        fail("manifest.json 里没有 version 字段")
    return str(v)


def collect(root):
    """收集扩展本体的文件，返回 [(绝对路径, 仓库内相对路径)]，按路径排序。"""
    items = []

    for name in ROOT_FILES:
        p = os.path.join(root, name)
        if not os.path.isfile(p):
            fail("缺少必需文件：%s" % name)
        items.append((p, name))

    for d in DIRS:
        base = os.path.join(root, d)
        if not os.path.isdir(base):
            fail("缺少必需目录：%s/" % d)
        for dirpath, dirnames, filenames in os.walk(base):
            dirnames[:] = [x for x in dirnames if x not in IGNORE_NAMES]
            for fn in filenames:
                if fn in IGNORE_NAMES:
                    continue
                ap = os.path.join(dirpath, fn)
                rel = os.path.relpath(ap, root).replace(os.sep, "/")
                items.append((ap, rel))

    items.sort(key=lambda x: x[1])
    return items


def build(root):
    """产出清单字典（不含时间戳，保证同样的文件 → 同样内容）。"""
    version = read_version(root)
    items = collect(root)
    files = []
    for ap, rel in items:
        data = file_bytes(ap)          # 文本文件已按 LF 归一化，对齐仓库内容
        files.append({
            "path": rel,
            "size": len(data),
            "sha256": hashlib.sha256(data).hexdigest(),
        })
    if not files:
        fail("清单为空 —— 白名单一个文件都没匹配到，检查 ROOT_FILES / DIRS 配置")
    return {
        "version": version,
        "algorithm": "sha256",
        "files": files,
    }


def diff_manifests(saved, current):
    """比对清单，返回人类可读的差异列表（空列表 = 完全一致）。"""
    problems = []

    if str(saved.get("version") or "") != str(current.get("version") or ""):
        problems.append("版本号不符：清单里是 %s，manifest.json 是 %s"
                        % (saved.get("version"), current.get("version")))

    if saved.get("algorithm") != current.get("algorithm"):
        problems.append("algorithm 字段不符：清单里是 %s，应为 %s"
                        % (saved.get("algorithm"), current.get("algorithm")))

    s_map = {}
    for e in (saved.get("files") or []):
        if isinstance(e, dict) and e.get("path"):
            s_map[e["path"]] = e
    c_map = {e["path"]: e for e in current["files"]}

    for p in sorted(set(c_map) - set(s_map)):
        problems.append("清单缺少该文件：%s" % p)
    for p in sorted(set(s_map) - set(c_map)):
        problems.append("清单多出该文件（磁盘上已不存在）：%s" % p)
    for p in sorted(set(s_map) & set(c_map)):
        s, c = s_map[p], c_map[p]
        if s.get("sha256") != c.get("sha256"):
            problems.append("内容已变，哈希不符：%s" % p)
        elif s.get("size") != c.get("size"):
            problems.append("大小不符：%s（清单 %s，磁盘 %s）"
                            % (p, s.get("size"), c.get("size")))

    return problems


def do_check(root):
    path = os.path.join(root, OUT_NAME)
    if not os.path.isfile(path):
        fail("缺少 %s —— 请先运行：python scripts/make-update-manifest.py" % OUT_NAME)

    try:
        with open(path, "r", encoding="utf-8") as f:
            saved = json.load(f)
    except Exception as e:
        fail("%s 解析失败：%s" % (OUT_NAME, e))

    current = build(root)
    problems = diff_manifests(saved, current)

    if problems:
        print("[中止] %s 与当前代码不一致，发布出去会让所有商家更新失败。" % OUT_NAME)
        print("")
        for p in problems:
            print("        - " + p)
        print("")
        print("       处理：刷新清单后重新提交")
        print("             python scripts/make-update-manifest.py")
        sys.exit(1)

    print("[OK] %s 与当前代码一致（%d 个文件，版本 %s）"
          % (OUT_NAME, len(current["files"]), current["version"]))
    return 0


def do_write(root):
    data = build(root)
    path = os.path.join(root, OUT_NAME)

    old = None
    if os.path.isfile(path):
        try:
            with open(path, "r", encoding="utf-8") as f:
                old = json.load(f)
        except Exception:
            old = None

    text = json.dumps(data, ensure_ascii=False, indent=2) + "\n"
    # 换行统一 LF，避免 Windows 上 git 报「CRLF will be replaced」干扰 diff
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        f.write(text)

    total = sum(e["size"] for e in data["files"])
    print("更新清单已生成")
    print("  输出    ：%s" % path)
    print("  版本    ：%s" % data["version"])
    print("  文件数  ：%d" % len(data["files"]))
    print("  总大小  ：%.1f KB" % (total / 1024.0))
    print("")

    if old is not None and not diff_manifests(old, data):
        print("  内容与上一版完全一致（文件没变，只有时间戳之外的东西动了才该有差异）")
    else:
        print("  文件清单：")
        for e in data["files"]:
            print("    %-44s %8.1f KB  %s"
                  % (e["path"], e["size"] / 1024.0, e["sha256"][:12]))

    print("")
    print("  提醒：这个文件必须提交进仓库 —— 自更新时扩展从")
    print("        raw/<tag>/%s 读取它。没提交就发版 = 商家更新失败。" % OUT_NAME)
    print("")
    
    # ---------- 同步到 COCO TEST（桌面唯一测试档）----------
    # 生成新清单 = 扩展本体已更新，确保桌面测试档同步。
    # 2026-10-13 整改：原来这里是 `except: pass` —— 同步失败**完全静默**，
    #   于是「源码改了、测试档还是旧的」可以一直没人发现。现在失败必须报出来。
    repo_root = os.path.dirname(path)
    sync_script = os.path.join(repo_root, "scripts", "sync-coco-test.sh")
    if os.path.isfile(sync_script):
        import subprocess
        try:
            proc = subprocess.run(
                ["bash", sync_script],
                capture_output=True, text=True, timeout=120
            )
            out = (proc.stdout or "").strip()
            if out:
                print(out)
            if proc.returncode != 0:
                print("  [!] ⛔ 同步到桌面 COCO TEST 失败（退出码 %d）" % proc.returncode)
                err = (proc.stderr or "").strip()
                if err:
                    print("      %s" % err)
                print("      汇报给用户之前必须手动重跑：bash scripts/sync-coco-test.sh")
        except Exception as exc:
            print("  [!] ⛔ 调用同步脚本异常：%r" % (exc,))
            print("      请手动执行：bash scripts/sync-coco-test.sh")
    
    return 0


def main():
    ap = argparse.ArgumentParser(description="生成 / 校验自更新清单")
    ap.add_argument("--root", default=DEFAULT_ROOT, help="仓库根目录")
    ap.add_argument("--check", action="store_true",
                    help="只校验清单是否与磁盘一致，不写文件（发布闸门用）")
    args = ap.parse_args()

    root = os.path.abspath(args.root)
    if not os.path.isdir(root):
        fail("仓库根目录不存在：%s" % root)

    return do_check(root) if args.check else do_write(root)


if __name__ == "__main__":
    sys.exit(main())
