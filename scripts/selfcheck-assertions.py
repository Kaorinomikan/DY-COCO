#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""自测断言 · 脆弱写法体检（只提示，不判定功能对错）

★ 为什么要有这个（2026-11-02）
  本工程 44 个自测、2283 条断言，其中 420 条是「源码文本断言」
  （对 readFileSync 的内容做正则匹配），124 条还绑死了中文文案。
  后果很具体：
    · 改一句用户可见文案 → 断言红；
    · 重构时多一个空格、换个声明方式 → 断言红；
    · 于是「做完新功能 → 自测红 → 排查 → 改断言 → 重跑」变成常态。

  断言本身不能删（它们是防回潮的最后一道），但**写法**可以更稳。
  这个脚本只做一件事：把「容易被无关改动弄红的写法」指出来，
  并给出等价但稳定的写法。它不判断功能是否正确，也**不阻断**任何流程。

  用法：
    python scripts/selfcheck-assertions.py --changed   # 只看本轮改过的自测文件
    python scripts/selfcheck-assertions.py scripts/自测-x.js
    ... --strict                                      # 有发现就退 1（CI 用，日常不必）

  ⛔ 纪律：看到提示**不是**让你删断言或放宽语义，
     而是把「绑死具体文案/空格/位置」换成「绑死结构或行为」。
"""
import argparse
import os
import re
import subprocess
import sys

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CJK = re.compile(r"[\u4e00-\u9fa5]")

# 规则表：(代号, 判据, 说明, 建议写法)
RULES = [
    ("文案绑死",
     lambda line: ".test(" in line and CJK.search(line) and re.search(r"= *'[^']*[\u4e00-\u9fa5]", line),
     "断言里写死了自己写的提示文案，改文案就红",
     "改成断言结构（如 /var SOURCE = '[^']+';/）或用 DOM 取到的文本比对"),
    ("空格绑死",
     lambda line: ".test(" in line and " = " in line and "\\s" not in line,
     "正则里用字面空格匹配源码，多一个空格/换缩进就红",
     "把 ' = ' 写成 '\\s*=\\s*'，只约束语法结构不管排版"),
    ("行号绑死",
     lambda line: re.search(r"第\s*\d+\s*行|lines\[\d+\]|split\('\\n'\)\[\d+\]", line) is not None,
     "断言依赖行号，插入一行注释就红",
     "改成按内容定位（先 indexOf 锚点，再取窗口）"),
    ("定长切片",
     lambda line: (".test(" in line or "ok(" in line or "check(" in line)
     and re.search(r"\.slice\([^,]+,\s*[a-zA-Z_$][\w$]*\s*\+\s*\d{2,}", line) is not None,
     "用固定长度窗口取源码，正文一变就截断",
     "窗口放宽到 700+ 或改成按锚点切"),
]


def changed_selfchecks():
    try:
        out = subprocess.run(["git", "diff", "--name-only", "main...HEAD"],
                             cwd=REPO, capture_output=True, text=True,
                             encoding="utf-8", errors="replace", timeout=60).stdout
        dirty = subprocess.run(["git", "status", "--porcelain"], cwd=REPO,
                               capture_output=True, text=True,
                               encoding="utf-8", errors="replace", timeout=60).stdout
    except Exception:
        return []
    names = [l.strip() for l in out.splitlines() if l.strip()]
    names += [l[3:].strip() for l in dirty.splitlines() if l.strip()]
    picked = []
    for n in names:
        base = os.path.basename(n)
        if n.startswith("scripts/") and base.startswith("自测-") and base not in picked:
            picked.append(base)
    return [os.path.join(REPO, "scripts", n) for n in picked]


def scan(path):
    findings = []
    try:
        with open(path, "r", encoding="utf-8", errors="replace") as f:
            for no, line in enumerate(f, 1):
                stripped = line.strip()
                # 只体检**断言行**：注释里举例不算
                if stripped.startswith("//") or stripped.startswith("#") or stripped.startswith("*"):
                    continue
                for code, test, why, how in RULES:
                    if test(line):
                        findings.append((no, code, why, how, stripped[:120]))
    except OSError:
        pass
    return findings


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("files", nargs="*", help="要体检的自测脚本（省略则配合 --changed）")
    ap.add_argument("--changed", action="store_true", help="只体检本轮改动过的自测文件")
    ap.add_argument("--strict", action="store_true", help="有发现就退 1（默认只提示）")
    args = ap.parse_args()

    files = args.files or (changed_selfchecks() if args.changed else [])
    if not files:
        print("没有需要体检的自测文件（本轮没改自测）。")
        return 0

    total = 0
    for f in files:
        findings = scan(f)
        if not findings:
            print("  ✓ %s 无脆弱写法" % os.path.basename(f))
            continue
        total += len(findings)
        print("\n  %s：%d 处容易被无关改动弄红的写法" % (os.path.basename(f), len(findings)))
        for no, code, why, how, text in findings:
            print("    L%-5d [%s] %s" % (no, code, why))
            print("           %s" % text)
            print("           建议：%s" % how)

    if total:
        print("\n合计 %d 处。⛔ 不是让你删断言 —— 是把绑死文案/空格/位置换成绑死结构。" % total)
    return 1 if (args.strict and total) else 0


if __name__ == "__main__":
    sys.exit(main())
