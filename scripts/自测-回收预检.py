#!/usr/bin/env python3
"""回收预检自测（2026-11-07）。

覆盖三处改动：
  ① `scripts/check-revert.sh`：真回退（删了 main 没动过的内容）与
     「只是落后于 main」必须分得开 —— 后者是 2026-11-07 那次误判的根源；
  ② 看板的「会冲突」判据已换成 `merge-tree --write-tree` 的退出码，
     同文件不同区域不再被误报为冲突；
  ③ wt-merge 的真回退闸门（DYC_REVERT_OK）在源码里存在，防止被顺手改回去。

约束：全部在项目 `.tmp` 下的临时 git 仓库里跑，不访问远端、不碰桌面。
"""

import os
import shutil
import subprocess
import sys
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
GIT = shutil.which('git') or 'git'
BASH = shutil.which('bash') or 'bash'
CHECK_REVERT = ROOT / 'scripts' / 'check-revert.sh'


def run(cwd, *args):
    return subprocess.run([GIT] + list(args), cwd=str(cwd),
                          capture_output=True, text=True, encoding='utf-8', errors='replace')


def git(cwd, *args):
    res = run(cwd, *args)
    if res.returncode != 0:
        raise AssertionError('git %s 失败：%s' % (' '.join(args), res.stderr.strip()))
    return res.stdout


class Repo:
    """一个最小可用的临时仓库。"""

    def __init__(self):
        base = ROOT / '.tmp'
        base.mkdir(exist_ok=True)
        self.path = base / ('自测-回收预检-' + uuid.uuid4().hex[:8])
        self.path.mkdir()
        git(self.path, 'init', '-q', '-b', 'main')
        git(self.path, 'config', 'user.email', 'selftest@local')
        git(self.path, 'config', 'user.name', 'selftest')
        git(self.path, 'config', 'core.autocrlf', 'false')

    def write(self, name, lines):
        (self.path / name).write_text('\n'.join(lines) + '\n', encoding='utf-8')

    def remove(self, name):
        (self.path / name).unlink()

    def commit(self, message):
        git(self.path, 'add', '-A')
        git(self.path, 'commit', '-qm', message)

    def branch(self, name, start='main'):
        git(self.path, 'checkout', '-q', '-B', name, start)

    def checkout(self, name):
        git(self.path, 'checkout', '-q', name)

    def check_revert(self, branch='feat'):
        """跑真实的 check-revert.sh，返回 (退出码, 解析后的 {路径: 删除行数})。"""
        env = dict(os.environ)
        env['DYC_GIT'] = GIT
        res = subprocess.run([BASH, str(CHECK_REVERT), branch, 'main'],
                             cwd=str(self.path), capture_output=True, text=True,
                             encoding='utf-8', errors='replace', env=env)
        found = {}
        for line in res.stdout.splitlines():
            if '\t' not in line:
                continue
            num, path = line.split('\t', 1)
            found[path.strip()] = int(num)
        return res.returncode, found

    def cleanup(self):
        shutil.rmtree(self.path, ignore_errors=True)


CASES = []


def case(fn):
    CASES.append(fn)
    return fn


@case
def t1_只新增不算回退():
    repo = Repo()
    try:
        repo.write('a.txt', ['1', '2', '3'])
        repo.commit('main 初版')
        repo.branch('feat')
        repo.write('new.txt', ['新增'])
        repo.commit('分支新增一个文件')
        rc, found = repo.check_revert()
        assert rc == 0, '只新增不应报真回退，退出码=%s 明细=%s' % (rc, found)
        assert not found, '不应有真回退文件：%s' % found
    finally:
        repo.cleanup()


@case
def t2_删掉main没动过的内容_判为真回退():
    repo = Repo()
    try:
        repo.write('a.txt', ['1', '2', '3'])
        repo.write('b.txt', ['x', 'y', 'z'])
        repo.commit('main 初版')
        repo.branch('feat')
        repo.write('b.txt', ['x', 'z'])          # 删掉主干的 y，且 main 侧没动过 b.txt
        repo.commit('分支删了 b 的一行')
        rc, found = repo.check_revert()
        assert rc == 1, '真回退应返回 1，实际 %s' % rc
        assert 'b.txt' in found, '应报出 b.txt：%s' % found
        assert found['b.txt'] == 1, '删除行数应为 1，实际 %s' % found['b.txt']
    finally:
        repo.cleanup()


@case
def t3_落后于main_不算真回退():
    """这条是本次误判的核心：分支显示「删了几行」，但那只是没跟上 main。"""
    repo = Repo()
    try:
        repo.write('a.txt', ['1', '2', '3'])
        repo.commit('main 初版')
        repo.branch('feat')                       # feat 在此分叉
        repo.checkout('main')
        repo.write('a.txt', ['1', '2', '3', 'main 后加的一行'])
        repo.commit('main 前进')
        rc, found = repo.check_revert('feat')
        assert rc == 0, '落后不应报真回退，退出码=%s 明细=%s' % (rc, found)
        assert not found, '落后产生的删除被误判成回退：%s' % found
        # 反证：此时 diff 里确实看得到「删除」
        diff = git(repo.path, 'diff', '--numstat', 'main..feat')
        assert 'a.txt' in diff, '前置条件不成立：diff 里应能看到 a.txt 的差异'
    finally:
        repo.cleanup()


@case
def t4_真回退与落后混在一起_只报真回退():
    repo = Repo()
    try:
        repo.write('a.txt', ['1', '2', '3'])
        repo.write('b.txt', ['x', 'y', 'z'])
        repo.commit('main 初版')
        repo.branch('feat')
        repo.checkout('main')
        repo.write('a.txt', ['1', '2', '3', 'main 后加的'])
        repo.commit('main 改了 a')
        repo.checkout('feat')
        repo.write('b.txt', ['x', 'z'])           # 真删；a.txt 保持旧版（落后）
        repo.commit('分支删 b 一行')
        rc, found = repo.check_revert('feat')
        assert rc == 1, '应报真回退，退出码=%s' % rc
        assert set(found) == {'b.txt'}, '只应报 b.txt，实际 %s' % found
    finally:
        repo.cleanup()


@case
def t5_同文件不同区域_可干净合并():
    """看板原来报「会冲突」的那种情形，实际 git 能静默合并。"""
    repo = Repo()
    try:
        repo.write('flags.txt', ['项目A', '项目B', '项目C', '项目D', '项目E',
                                 '项目F', '项目G', '项目H', '项目I', '项目J'])
        repo.commit('初版')
        repo.branch('feat')
        repo.write('flags.txt', ['项目A', '分支新增项', '项目B', '项目C', '项目D',
                                 '项目E', '项目F', '项目G', '项目H', '项目I', '项目J'])
        repo.commit('分支在数组开头插入')
        repo.checkout('main')
        repo.write('flags.txt', ['项目A', '项目B', '项目C', '项目D', '项目E',
                                 '项目F', '项目G', '项目H', '项目I', '项目J', '主干新增项'])
        repo.commit('主干在数组末尾插入')
        res = run(repo.path, 'merge-tree', '--write-tree', 'main', 'feat')
        assert res.returncode == 0, \
            '不同区域插入不应判为冲突：%s' % res.stdout.strip()[:200]
    finally:
        repo.cleanup()


@case
def t6_同区域改动_判为冲突():
    """判据的另一面：真冲突必须报出来，不能为了消假阳性把真信号也掐了。"""
    repo = Repo()
    try:
        repo.write('flags.txt', ['项目A', '项目B'])
        repo.commit('初版')
        repo.branch('feat')
        repo.write('flags.txt', ['项目A', '分支改的B'])
        repo.commit('分支改第二行')
        repo.checkout('main')
        repo.write('flags.txt', ['项目A', '主干改的B'])
        repo.commit('主干也改第二行')
        res = run(repo.path, 'merge-tree', '--write-tree', 'main', 'feat')
        assert res.returncode != 0, '同区域不同内容应当冲突，但判成了可合并'
    finally:
        repo.cleanup()


@case
def t9_改写不算回退():
    """删旧行、加新行是改代码的常态。只看「有删除」会把正常改写全拦下来。"""
    repo = Repo()
    try:
        repo.write('a.txt', ['l%d' % i for i in range(1, 11)])
        repo.commit('初版')
        repo.branch('feat')
        # 删掉中间 2 行、加进 5 行：净 +3，属改写
        repo.write('a.txt', ['l1', 'l2', 'l3'] + ['新%d' % i for i in range(1, 6)]
                   + ['l6', 'l7', 'l8', 'l9', 'l10'])
        repo.commit('改写：删 2 加 5')
        rc, found = repo.check_revert()
        assert rc == 0, '改写（净新增）不该被判成回退，实际 %s / %s' % (rc, found)
        assert not found, '改写被误报：%s' % found
    finally:
        repo.cleanup()


@case
def t7_看板不再用旧判据():
    src = (ROOT / 'scripts' / 'wt-list.sh').read_text(encoding='utf-8')
    # 只查「真正会执行的语句」—— 说明性注释里提到旧判据是允许的（也应当允许，
    # 否则没人知道为什么改）。
    for line in src.splitlines():
        code = line.strip()
        if not code or code.startswith('#'):
            continue
        assert 'changed in both' not in code, \
            '看板又用 changed in both 判冲突了（那会把「双方都改过同一文件」误报成冲突）：' + code
    assert 'merge-tree --write-tree' in src, '看板应改用 merge-tree --write-tree 的退出码'


@case
def t8_wt_merge挂了真回退闸门():
    src = (ROOT / 'scripts' / 'wt-merge.sh').read_text(encoding='utf-8')
    assert 'check-revert.sh' in src, 'wt-merge 应调用 check-revert.sh'
    assert 'DYC_REVERT_OK' in src, 'wt-merge 应要求真回退时显式声明 DYC_REVERT_OK'


def main():
    passed = 0
    failed = 0
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
    total = passed + failed
    print('\n回收预检自测：%d/%d 通过' % (passed, total))
    return 1 if failed else 0


if __name__ == '__main__':
    sys.exit(main())
