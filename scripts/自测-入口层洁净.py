#!/usr/bin/env python3
"""入口层洁净检查自测（2026-11-23）。

背景：发布闸门 `scripts/check-root-clean.py` 在 2026-11-23 的推送里被别家项目
的预览副本拦下 —— 入口层 `C:\\Develop project` 下的 `wentool-预览副本` 不属于
本工程，用户明确「这是另外一个项目的，你不要管」。

覆盖：
  ① 别家项目的附属目录（`<项目名>-后缀`）不再算本工程杂物；
  ② 分不清归属的目录仍然要报（新规则不能把闸门放宽成摆设）；
  ③ 名字前缀相似但不是附属（`projx` vs `proj`）仍要报；
  ④ 散落文件仍然要报；
  ⑤ 没有项目标记时，附属目录无处归属，仍要报。

约束：全部在工程 `.tmp` 下的临时目录里跑，每个用例结束即清理。
"""

import shutil
import subprocess
import sys
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / 'scripts' / 'check-root-clean.py'

CASES = []


def case(fn):
    CASES.append(fn)
    return fn


def make_root(spec):
    """在 .tmp 下造一个入口层。spec: [(名字, 是否项目)]。"""
    base = ROOT / '.tmp'
    base.mkdir(exist_ok=True)
    p = base / ('自测-入口层洁净-' + uuid.uuid4().hex[:8])
    p.mkdir()
    for name, is_proj in spec:
        d = p / name
        d.mkdir(parents=True, exist_ok=True)
        if is_proj:
            (d / 'package.json').write_text('{}\n', encoding='utf-8')
        else:
            (d / 'index.html').write_text('<i></i>\n', encoding='utf-8')
    return p


def check(root):
    res = subprocess.run(
        [sys.executable, str(SCRIPT), '--root', str(root), '--list'],
        capture_output=True, text=True, encoding='utf-8', errors='replace',
    )
    return res.returncode, (res.stdout or '') + (res.stderr or '')


@case
def t1_别家项目的附属目录不算杂物():
    root = make_root([('proj', True), ('proj-预览副本', False)])
    try:
        rc, out = check(root)
        assert rc == 0, '应判洁净，实际退出码 %d：%s' % (rc, out)
        assert '[非项目目录] proj-预览副本' not in out, '附属目录不应出现在杂物清单里'
        assert '[附属] proj-预览副本' in out, '--list 应列出附属归属，便于排障'
    finally:
        shutil.rmtree(root, ignore_errors=True)


@case
def t2_分不清归属的目录仍要报():
    root = make_root([('proj', True), ('别的项目', False)])
    try:
        rc, out = check(root)
        assert rc == 1, '应中止，实际退出码 %d' % rc
        assert '[非项目目录] 别的项目' in out, '杂物目录必须点名'
    finally:
        shutil.rmtree(root, ignore_errors=True)


@case
def t3_前缀相似但不是附属仍要报():
    root = make_root([('proj', True), ('projx', False)])
    try:
        rc, out = check(root)
        assert rc == 1, 'projx 不是 proj 的附属，应中止；实际退出码 %d' % rc
        assert '[非项目目录] projx' in out, 'projx 必须在杂物清单里'
    finally:
        shutil.rmtree(root, ignore_errors=True)


@case
def t4_散落文件仍要报():
    root = make_root([('proj', True)])
    try:
        (root / 'note.txt').write_text('x\n', encoding='utf-8')
        rc, out = check(root)
        assert rc == 1, '散落文件应中止，实际退出码 %d' % rc
        assert 'note.txt' in out, '散落文件要点名'
    finally:
        shutil.rmtree(root, ignore_errors=True)


@case
def t5_没有项目标记时附属目录无处归属():
    root = make_root([('proj-预览副本', False)])
    try:
        rc, out = check(root)
        assert rc == 1, '没有项目时无处归属，应中止；实际退出码 %d' % rc
        assert 'proj-预览副本' in out, '该目录必须出现在杂物清单里'
    finally:
        shutil.rmtree(root, ignore_errors=True)


def main():
    passed = failed = 0
    for fn in CASES:
        name = fn.__name__[3:].replace('_', ' · ')
        try:
            fn()
            passed += 1
            print('通过：' + name)
        except AssertionError as err:
            failed += 1
            print('失败：' + name + '：' + str(err))
        except Exception as err:  # noqa: BLE001
            failed += 1
            print('失败：' + name + '：' + type(err).__name__ + ': ' + str(err))
    print('\n入口层洁净自测：%d/%d 通过' % (passed, passed + failed))
    return 1 if failed else 0


if __name__ == '__main__':
    sys.exit(main())
