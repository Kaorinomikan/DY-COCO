#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Service Worker 构建标记闸门（2026-11-05 立）

为什么必须有这道闸门 —— 用户实测现象：
  更新装完后第一次用扩展，**设置存不进**（弹窗弹「设置未保存，已恢复原状态」）；
  重启浏览器才自动应用新更新；现在必须去扩展管理页手动点「重新加载」，
  四个浏览器就要按四次。

根因（两条叠加，都必须堵）：
  ① MV3 的 Service Worker 脚本包按**主脚本自身的字节**做缓存键。
     只要 src/background/service-worker.js 一个字节都不变，浏览器就继续复用
     上一次缓存的整个脚本包 —— 连 importScripts 进来的 flags.js / gitee.js 一起。
     结果就是「磁盘已是新版，后台仍跑旧代码」：
       · 弹窗读新 flags.js，认识新开关键；
       · 后台跑旧 flags.js，dycFlagMeta() 认不出该键 → 直接拒绝写入；
       · 用户看到「设置未保存」，重启浏览器（缓存被丢弃）才恢复。
  ② 旧闸门只盯 src/shared，而 service-worker.js 的第二处 importScripts 是
     ../content/flags.js —— 它改了、闸门不管、构建号不动，缓存包永远不重建。

判定规则：
  A. DYC_BUILD 必须存在且形如 '<版本号>+sw<N>'（能被解析）；
  B. 给出 --prev-tag 时，DYC_BUILD 的值必须与该标签里的值**不同**
     —— 即「每次发布，SW 主脚本必须变一个字节」；
  C. 给出 --prev-tag 时，若 importScripts 依赖（自动从源码解析，不写死目录）
     有改动而构建号没变，单独报错并列出改了哪些文件。

  规则 B 是硬要求，规则 C 是解释性兜底：B 过了 C 必然也过，但 C 能让报错
  直接说清「是哪个被引入的文件改了、导致后台必须重建」。

用法：
  python scripts/check-sw-build.py                          # 校验，不通过退出码 1
  python scripts/check-sw-build.py --prev-tag v26.11.04.1   # 发布时带上基线标签
  python scripts/check-sw-build.py --fix                    # 按 manifest 版本改写
  python scripts/check-sw-build.py --fix --prev-tag v26.11.04.1

  --fix 的写法：<manifest 里的 version>+sw<N+1>，N 取原值继续自增，
  让「版本段」与「发布版本」始终对得上，排障时一眼能看出后台是哪个版本。
"""

import argparse
import glob
import io
import os
import re
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SW_REL = "src/background/service-worker.js"
MANIFEST_REL = "manifest.json"

BUILD_RE = re.compile(r"^var\s+DYC_BUILD\s*=\s*'([^']*)'\s*;", re.M)
BUILD_SHAPE = re.compile(r"^(\d{1,2}\.\d{1,2}\.\d{1,2}\.\d{1,3})\+sw(\d+)$")
IMPORT_RE = re.compile(r"importScripts\s*\(([^)]*)\)")
QUOTED = re.compile(r"'([^']+)'|\"([^\"]+)\"")


def read_text(rel):
    path = os.path.join(ROOT, rel)
    with io.open(path, "r", encoding="utf-8", newline="") as f:
        return f.read()


def write_text(rel, text):
    path = os.path.join(ROOT, rel)
    with io.open(path, "w", encoding="utf-8", newline="") as f:
        f.write(text)


def manifest_version():
    text = read_text(MANIFEST_REL)
    m = re.search(r'"version"\s*:\s*"([^"]+)"', text)
    if not m:
        return None
    return m.group(1)


def build_value():
    text = read_text(SW_REL)
    m = BUILD_RE.search(text)
    return m.group(1) if m else None


def import_deps():
    """解析 service-worker.js 里所有 importScripts 引入的文件（不写死目录）。

    为什么自动解析：旧闸门把 src/shared 写死在 publish.sh 里，第二处
    importScripts('../content/flags.js') 就这么漏掉了 —— 漏掉的后果正是
    本次用户报的「设置存不进去」。以后再加 importScripts，本脚本自动跟上。
    """
    text = read_text(SW_REL)
    base = os.path.dirname(SW_REL)
    deps = []
    for block in IMPORT_RE.findall(text):
        for single, double in QUOTED.findall(block):
            rel = (single or double).strip()
            if not rel or rel.startswith(("http://", "https://")):
                continue
            rel = rel.split("?")[0].split("#")[0]
            full = os.path.normpath(os.path.join(base, rel)).replace("\\", "/")
            if full not in deps:
                deps.append(full)
    return deps


def find_git():
    env = os.environ.get("DYC_GIT")
    if env and os.path.isfile(env):
        return env
    home = os.path.expanduser("~")
    pattern = os.path.join(home, ".workbuddy", "binaries", "PortableGit",
                           "versions", "*", "cmd", "git.exe")
    hits = sorted(glob.glob(pattern))
    if hits:
        return hits[-1]
    from shutil import which
    return which("git")


def git_show(git, spec):
    try:
        out = subprocess.run([git, "-C", ROOT, "show", spec],
                             stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                             check=False)
    except OSError:
        return None
    if out.returncode != 0:
        return None
    return out.stdout.decode("utf-8", "replace")


def changed_since(git, tag, paths):
    if not paths:
        return []
    try:
        out = subprocess.run([git, "-C", ROOT, "diff", "--name-only", tag, "HEAD", "--"] + paths,
                             stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                             check=False)
    except OSError:
        return []
    if out.returncode != 0:
        return []
    return [line for line in out.stdout.decode("utf-8", "replace").splitlines() if line.strip()]


def do_fix(new_value):
    text = read_text(SW_REL)
    m = BUILD_RE.search(text)
    if not m:
        return False, "在 %s 里找不到形如 var DYC_BUILD = '...'; 的一行" % SW_REL
    old = m.group(1)
    text = text[:m.start(1)] + new_value + text[m.end(1):]
    write_text(SW_REL, text)
    return True, "%s  %s → %s" % (SW_REL, old, new_value)


def main():
    parser = argparse.ArgumentParser(add_help=True, description="Service Worker 构建标记闸门")
    parser.add_argument("--prev-tag", default="", help="上一发布标签，如 v26.11.04.1")
    parser.add_argument("--fix", action="store_true", help="按 manifest 版本改写 DYC_BUILD")
    args = parser.parse_args()

    version = manifest_version()
    if not version:
        print("[中止] 读不到 manifest.json 的 version")
        return 1

    deps = import_deps()
    current = build_value()

    if args.fix:
        shape = BUILD_SHAPE.match(current or "")
        seq = int(shape.group(2)) + 1 if shape else 1
        new_value = "%s+sw%d" % (version, seq)
        ok, msg = do_fix(new_value)
        if not ok:
            print("[中止] " + msg)
            return 1
        print("[已写入] " + msg)
        print("        importScripts 依赖共 %d 个：%s" % (len(deps), "、".join(deps) or "（无）"))
        current = new_value

    print("")
    print("===== Service Worker 构建标记 =====")
    print("  manifest 版本 : %s" % version)
    print("  DYC_BUILD     : %s" % (current or "（读不到）"))
    print("  importScripts : %s" % ("、".join(deps) or "（无）"))

    if not current:
        print("")
        print("[中止] %s 里没有 DYC_BUILD 构建标记。" % SW_REL)
        print("       MV3 会按主脚本字节缓存整个脚本包，没有这行就无法保证每版重建。")
        print("       处理：python scripts/check-sw-build.py --fix")
        return 1

    shape = BUILD_SHAPE.match(current)
    if not shape:
        print("")
        print("[中止] DYC_BUILD 格式不对：'%s'" % current)
        print("       必须是 '<版本号>+sw<N>'，例 26.11.05.1+sw24")
        return 1

    if shape.group(1) != version:
        print("")
        print("[提示] 构建号的版本段（%s）与 manifest（%s）不一致。" % (shape.group(1), version))
        print("       不阻断，但建议发布前跑一次 --fix 对齐，方便排查后台跑的是哪一版。")

    if args.prev_tag:
        git = find_git()
        if not git:
            print("")
            print("[警告] 找不到 git，跳过「与上一标签对比」这一步。")
            return 0

        prev_text = git_show(git, "%s:%s" % (args.prev_tag, SW_REL))
        prev = None
        if prev_text:
            m = BUILD_RE.search(prev_text)
            prev = m.group(1) if m else None

        changed = changed_since(git, args.prev_tag, deps)

        print("")
        print("  上一标签 %s 的构建号：%s" % (args.prev_tag, prev or "（读不到）"))

        if prev is not None and prev == current:
            print("")
            print("[中止] 构建号与上一标签完全相同：'%s'" % current)
            print("")
            if changed:
                print("       这些被 importScripts 引入的文件本轮有改动：")
                for line in changed:
                    print("         " + line)
            else:
                print("       本轮 importScripts 依赖没有改动，但主脚本也没有变化。")
            print("")
            print("       后果：浏览器继续复用上次缓存的整个 SW 脚本包 —— 磁盘已是新版、")
            print("       后台仍跑旧代码。用户看到的是「设置存不进去」「必须手动刷新扩展」。")
            print("")
            print("       处理：python scripts/check-sw-build.py --fix 然后提交。")
            return 1

        if changed:
            print("      本轮有改动的引入文件（构建号已变，会触发重建）：")
            for line in changed:
                print("         " + line)
        else:
            print("      本轮引入文件无改动。")

    print("")
    print("[通过] 构建标记会触发 SW 脚本包重建。")
    return 0


if __name__ == "__main__":
    sys.exit(main())
