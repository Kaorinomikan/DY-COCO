#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""改动 JavaScript 的快速语法闸门。

中间态每轮跑 ``python scripts/check-syntax.py --changed``；回收脚本复用同一入口。
只判断能否被 Node 解析，不替代行为自测或真机冒烟。
"""
from pathlib import Path
import argparse
import os
import subprocess
import sys

ROOT = Path(os.environ.get('DYC_SYNTAX_ROOT', Path(__file__).resolve().parents[1]))
NODE = os.environ.get('DYC_NODE', 'C:/Users/79412/.workbuddy/binaries/node/versions/22.22.2-6/node.exe')


def find_git():
    configured = os.environ.get('DYC_GIT')
    if configured:
        return configured
    base = Path.home() / '.workbuddy/binaries/PortableGit/versions'
    if base.is_dir():
        candidates = sorted(base.glob('*/cmd/git.exe'), key=lambda p: p.parts[-3])
        if candidates:
            return str(candidates[-1])
    return 'git'


GIT = find_git()


def git_lines(*args):
    result = subprocess.run([GIT, *args, '-z'], cwd=ROOT, capture_output=True)
    if result.returncode != 0:
        raise RuntimeError(result.stderr.decode('utf-8', 'replace').strip() or 'git 执行失败')
    return [p for p in result.stdout.decode('utf-8', 'replace').split('\0') if p]


def changed_js():
    names = set(git_lines('diff', '--name-only', '--diff-filter=d', 'main...HEAD'))
    status = git_lines('status', '--porcelain')
    for entry in status:
        # -z 下重命名显示为 "XY new"，旧路径在下一项；新路径会在下一循环被忽略也无妨，
        # 因为当前 entry 已包含新路径。普通条目同样从第 4 个字符开始。
        name = entry[3:] if len(entry) > 3 else ''
        if ' -> ' in name:
            name = name.split(' -> ', 1)[1]
        if name:
            names.add(name)
    return sorted(n for n in names if n.endswith('.js') and not n.startswith('.tmp/'))


def all_js():
    return sorted(n for n in git_lines('ls-files', '--', '*.js') if not n.startswith('.tmp/'))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--changed', action='store_true', help='只检查未提交及本分支相对 main 的改动')
    args = parser.parse_args()
    try:
        files = changed_js() if args.changed else all_js()
    except (OSError, RuntimeError) as error:
        print('[中止] 无法取得待检查文件：' + str(error))
        return 2
    existing = [n for n in files if (ROOT / n).is_file()]
    if not existing:
        print('语法检查：没有需要检查的 JavaScript 改动。' if args.changed else '语法检查：没有 JavaScript 文件。')
        return 0
    failed = []
    for name in existing:
        result = subprocess.run([NODE, '--check', str(ROOT / name)], cwd=ROOT,
                                capture_output=True, text=True, encoding='utf-8', errors='replace')
        if result.returncode != 0:
            failed.append(name)
            print('[失败] ' + name)
            output = (result.stdout + result.stderr).strip()
            if output:
                print(output)
    if failed:
        print('语法检查：%d/%d 个文件通过，失败文件必须先修复。' % (len(existing) - len(failed), len(existing)))
        return 1
    print('语法检查：%d 个 JavaScript 文件全部通过。' % len(existing))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
