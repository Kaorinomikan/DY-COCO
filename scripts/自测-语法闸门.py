#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""快速语法闸门的离线回归；只在项目 .tmp 下创建临时 git 仓库。"""
from pathlib import Path
import os
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / 'scripts/check-syntax.py'


def find_git():
    base = Path.home() / '.workbuddy/binaries/PortableGit/versions'
    candidates = list(base.glob('*/cmd/git.exe'))
    return str(sorted(candidates)[-1]) if candidates else 'git'


GIT = find_git()


class SyntaxGateTests(unittest.TestCase):
    def setUp(self):
        self.tmp_parent = ROOT / '.tmp'
        self.tmp_parent.mkdir(exist_ok=True)
        self.repo = Path(tempfile.mkdtemp(prefix='syntax-gate-', dir=self.tmp_parent))
        self.git('init', '-b', 'main')
        self.git('config', 'user.email', 'selftest@example.invalid')
        self.git('config', 'user.name', 'selftest')
        self.write('src/valid.js', 'const answer = 42;\n')
        self.git('add', '.')
        self.git('commit', '-m', 'base')
        self.git('checkout', '-b', 'task/syntax-test')

    def git(self, *args):
        result = subprocess.run([GIT, *args], cwd=self.repo, capture_output=True)
        if result.returncode:
            raise RuntimeError(result.stderr.decode('utf-8', 'replace'))
        return result.stdout

    def write(self, name, content):
        path = self.repo / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding='utf-8', newline='\n')
        return path

    def run_gate(self):
        env = dict(os.environ, DYC_SYNTAX_ROOT=self.repo.as_posix(), DYC_GIT=GIT)
        return subprocess.run([sys.executable, str(SCRIPT), '--changed'], cwd=self.repo, env=env,
                              capture_output=True, text=True, encoding='utf-8', errors='replace')

    def test_clean_tree_is_fast_success(self):
        result = self.run_gate()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn('没有需要检查', result.stdout)

    def test_valid_uncommitted_and_committed_changes_form_union(self):
        self.write('src/valid.js', 'const answer = 43;\n')
        self.git('add', '.')
        self.git('commit', '-m', 'committed change')
        self.write('src/new.js', 'function ok() { return true; }\n')
        result = self.run_gate()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn('2 个 JavaScript', result.stdout)

    def test_syntax_error_is_nonzero(self):
        self.write('src/broken.js', 'function broken( {\n')
        result = self.run_gate()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('src/broken.js', result.stdout)

    def test_deleted_file_is_not_an_error(self):
        (self.repo / 'src/valid.js').unlink()
        result = self.run_gate()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn('没有需要检查', result.stdout)

    def test_renamed_valid_file_is_checked(self):
        self.git('mv', 'src/valid.js', 'src/renamed.js')
        result = self.run_gate()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn('1 个 JavaScript', result.stdout)


if __name__ == '__main__':
    suite = unittest.defaultTestLoader.loadTestsFromTestCase(SyntaxGateTests)
    result = unittest.TextTestRunner(verbosity=1).run(suite)
    print('语法闸门：%d/%d 通过。' % (result.testsRun - len(result.failures) - len(result.errors), result.testsRun))
    raise SystemExit(0 if result.wasSuccessful() else 1)
