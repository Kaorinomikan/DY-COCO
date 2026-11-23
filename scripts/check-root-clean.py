#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""上级目录洁净检查 —— 入口层只许放项目目录。

为什么有这道闸门（2026-11-22 用户定）
    用户的目录定位：`C:\\Develop project` 是**不同开发项目的入口**，
    「入口不放杂物」。此前 Codex / WorkBuddy 各自把配置、运行时、
    发布包、工作树、设计稿散在入口层，越用越多，入口层被当成工作区。

判据（只看一层，不递归）
    · 根目录下**不许有任何文件**；
    · 根目录下每个目录本身必须是一个项目（含 .git / manifest.json / package.json）；
    · 本工程自己的东西一律下沉到工程内，去向见 docs/agents/目录纪律.md。

容忍项
    Windows / macOS 自动生成的目录标记文件不阻断（见 OS_NOISE），
    否则这道闸门会因为用户都没见过的系统文件常年红灯 —— 红灯变噪音就没人看了。

用法
    python scripts/check-root-clean.py            # 检查，退出码 0=洁净 1=有杂物
    python scripts/check-root-clean.py --list      # 顺带列出允许的项目目录

退出码 0 / 1，可直接用于 publish.sh 闸门。
"""

import argparse
import os
import subprocess
import sys

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)

# 系统自动生成的目录标记文件，不算杂物
OS_NOISE = {"desktop.ini", "thumbs.db", ".ds_store"}

# 判定「这是一个项目」的标志
PROJECT_MARKS = (".git", "manifest.json", "package.json")


def git_exe():
    for base in sorted(
        os.path.expanduser("~/.workbuddy/binaries/PortableGit/versions"), reverse=True
    ):
        for rel in ("cmd/git.exe", "mingw64/bin/git.exe"):
            p = os.path.join(base, rel).replace("/", os.sep)
            if os.path.isfile(p):
                return p
    return "git"


def main_repo():
    """工作树里跑时也要指回主仓库 —— 否则父目录会是 .worktrees/。"""
    try:
        proc = subprocess.run(
            [git_exe(), "rev-parse", "--git-common-dir"],
            cwd=REPO, capture_output=True, text=True, encoding="utf-8", errors="replace",
        )
        common = (proc.stdout or "").strip()
        if common:
            if not os.path.isabs(common):
                common = os.path.abspath(os.path.join(REPO, common))
            return os.path.dirname(os.path.normpath(common))   # 去掉 /.git
    except Exception:
        pass
    return REPO


def is_project(path):
    return any(os.path.exists(os.path.join(path, m)) for m in PROJECT_MARKS)


def owned_by_project(name, projects):
    """这个目录是不是某个已识别项目的附属目录。

    入口层是多项目共用的，同一层下别家项目会把自己的预览副本、备份、导出
    放在旁边（真例：`wentool` 项目的 `wentool-预览副本`）。那不是本工程的
    杂物，本脚本无权要求别家搬迁 —— 用户 2026-11-23 明确「这是另外一个项目
    的，你不要管」。

    判据只认「已识别的项目名 + 分隔符」前缀，不做模糊匹配：`wentool-预览副本`
    归 `wentool`，而 `wentoolx` 或 `预览副本` 仍算杂物，避免用命名绕开检查。
    """
    for proj in projects:
        for sep in ("-", "_", "."):
            if name.startswith(proj + sep):
                return proj
    return ""


def scan(root):
    """返回 (杂物文件, 非项目目录, 项目目录)。"""
    files, non_projects, projects = [], [], []
    for name in sorted(os.listdir(root)):
        if name.lower() in OS_NOISE:
            continue
        p = os.path.join(root, name)
        if os.path.isdir(p):
            (projects if is_project(p) else non_projects).append(name)
        else:
            files.append(name)
    # 第二遍：剔掉别家项目的附属目录（判据要求先用全量项目名，故分两遍）
    non_projects = [n for n in non_projects if not owned_by_project(n, projects)]
    return files, non_projects, projects


def main():
    ap = argparse.ArgumentParser(description="检查上级目录是否只放项目入口")
    ap.add_argument("--list", action="store_true", help="列出被认可的项目目录")
    ap.add_argument("--root", default="", help="指定入口层目录（默认按 git 反推；自测用）")
    args = ap.parse_args()

    root = args.root or os.path.dirname(main_repo())
    if not os.path.isdir(root):
        print("上级目录不存在：%s" % root)
        return 1

    files, non_projects, projects = scan(root)

    if args.list:
        print("入口层：%s" % root)
        for n in projects:
            print("  [项目] %s" % n)
        for n in sorted(os.listdir(root)):
            if os.path.isdir(os.path.join(root, n)) and not is_project(os.path.join(root, n)):
                owner = owned_by_project(n, projects)
                if owner:
                    print("  [附属] %s → 归 %s（非本工程，不查）" % (n, owner))

    if not files and not non_projects:
        if not args.list:
            print("上级目录洁净：%s" % root)
            print("  项目：%s" % ("、".join(projects) if projects else "（无）"))
        return 0

    print("[中止] 上级目录出现杂物：%s" % root)
    for n in files:
        print("  [散落文件] %s" % n)
    for n in non_projects:
        print("  [非项目目录] %s" % n)
    print("")
    print("  入口层只许放项目目录。本工程的文件请下沉到工程内：")
    print("    配置/密钥 → DY-COCO/.dyc-config/      临时/存档 → DY-COCO/.tmp/")
    print("    发布包   → DY-COCO/dist/              工作树      → DY-COCO/.worktrees/")
    print("    设计稿   → DY-COCO/docs/design/       诊断脚本    → DY-COCO/scripts/live-diag/")
    print("  归属判不准时查 docs/agents/目录纪律.md，不要就地新建目录。")
    return 1


if __name__ == "__main__":
    sys.exit(main())
