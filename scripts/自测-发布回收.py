#!/usr/bin/env python3
"""零依赖流程自测：仅在项目 .tmp 内运行假 git、假同步，不访问远端或桌面。"""
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[1]
BASH = shutil.which('bash')
SHA = '1234567' + 'a' * 33
OTHER = '1234567' + 'b' * 33
TAG_OBJECT = 'c' * 40
TAG = 'v26.10.28.1'

FAKE_GIT = r'''#!/bin/bash
printf '%s\n' "$*" >> "$CASE_ROOT/git.log"
if [ "$1" = "-c" ]; then shift 2; fi
case "$1" in
  rev-parse)
    if [[ "$*" == *refs/tags/* ]] && [ "$SCENARIO" = "local-wrong" ]; then
      printf '%s\n' "$OTHER"
    else printf '%s\n' "$SHA"; fi ;;
  show-ref)
    if [[ "$*" == *refs/tags/* ]] && [[ "$SCENARIO" != local-* ]]; then exit 1; fi ;;
  tag)
    if [ "$2" = "-a" ]; then : > "$CASE_ROOT/tag-created"; fi ;;
  remote)
    if [ "$2" = "add" ]; then : > "$CASE_ROOT/remote-active"; fi
    if [ "$2" = "remove" ]; then
      if [ "$SCENARIO" = "cleanup-fail" ]; then exit 1; fi
      rm -f "$CASE_ROOT/remote-active"
    fi ;;
  push)
    if [[ "$SCENARIO" != local-* ]] && [ ! -f "$CASE_ROOT/tag-created" ]; then exit 91; fi
    if [ "$SCENARIO" = "main-push-fail" ] && [[ "$*" == *refs/heads/* ]]; then exit 1; fi
    if [ "$SCENARIO" = "tag-push-fail" ] && [[ "$*" == *refs/tags/* ]]; then exit 1; fi ;;
  ls-remote)
    if [ "$SCENARIO" = "remote-read-fail" ]; then exit 1; fi
    main="$SHA"; peeled="$SHA"
    [ "$SCENARIO" = "main-wrong" ] && main="$OTHER"
    [ "$SCENARIO" = "tag-wrong" ] && peeled="$OTHER"
    [ "$SCENARIO" = "short-sha" ] && main="${SHA:0:7}"
    printf '%s\trefs/heads/main\n' "$main"
    if [ "$SCENARIO" != "missing-tag" ]; then
      if [ "$SCENARIO" = "lightweight" ]; then
        printf '%s\trefs/tags/%s\n' "$SHA" "$TAG"
      else
        printf '%s\trefs/tags/%s\n' "$TAG_OBJECT" "$TAG"
        printf '%s\trefs/tags/%s^{}\n' "$peeled" "$TAG"
      fi
    fi ;;
  status|diff|log|merge-tree) ;;
  show) printf '  "version": "26.10.28.1"\n' ;;
  merge-base)
    if [ "$2" = "--is-ancestor" ] && [[ "$SCENARIO" != already-* ]]; then exit 1; fi ;;
  merge) : > "$CASE_ROOT/merged" ;;
  worktree)
    if [ "$2" = "remove" ] && [ "$SCENARIO" = "task-cleanup-fail" ]; then exit 1; fi ;;
  branch) ;;
  *) printf '未模拟的 git 调用：%s\n' "$*" >&2; exit 92 ;;
esac
exit 0
'''


class FlowTests(unittest.TestCase):
    def setUp(self):
        self.tmp_parent = ROOT / '.tmp'
        self.tmp_parent.mkdir(exist_ok=True)
        # 保留本次沙箱供审查；自测不批量清理目录，避免触发累计删除保护。
        self.path = Path(tempfile.mkdtemp(prefix='flow-selftest-', dir=self.tmp_parent))
        self.scripts = self.path / 'scripts'
        self.scripts.mkdir()
        self.fake_git = self.write('fake-git', FAKE_GIT)
        self.write('.self-review-ok', '自审通过')
        self.write('.gitee-url.bak', 'offline-test.git')
        self.write('pending', '待推送内容')
        self.write('scripts/计点.sh', '#!/bin/bash\n[ "$SCENARIO" = "points-fail" ] && exit 1\nprintf "5\\n"\n')
        self.fake_py = self.write('fake-python', '#!/bin/bash\n[ "$SCENARIO" = "reset-fail" ] && exit 1\n: > "$CASE_ROOT/reset-called"\nprintf "已重置" > "$CASE_ROOT/pending"\n')
        self.write('scripts/reset-pending.py', '# 仅作存在性占位，不执行\n')
        self.write('scripts/sync-coco-test.sh', '''#!/bin/bash
: > "$CASE_ROOT/sync-called"
case "$SCENARIO" in sync-fail|already-sync-fail) exit 1 ;; esac
exit 0
''')
        self.env = dict(os.environ, CASE_ROOT=self.path.as_posix(), SHA=SHA,
                        OTHER=OTHER, TAG_OBJECT=TAG_OBJECT, TAG=TAG)

    def tearDown(self):
        pass  # 沙箱保留在项目 .tmp/，不在测试阶段执行目录删除。

    def write(self, name, content):
        path = self.path / name
        path.write_text(content, encoding='utf-8', newline='\n')
        path.chmod(0o755)
        return path

    def run_script(self, script, scenario, *args):
        self.env['SCENARIO'] = scenario
        result = subprocess.run([BASH, str(script), *args], cwd=self.path,
                                env=self.env, capture_output=True, encoding='utf-8', errors='replace')
        self.output = result.stdout + result.stderr
        return result.returncode

    def publish(self, scenario):
        source = (ROOT / 'publish.sh').read_text(encoding='utf-8')
        preflight = source.split('TAG_VER="v${LOCAL_VER}"', 1)[1].split('# 输出完整变更清单', 1)[0]
        tail = source[source.index('echo "----- 建立并校验本地发布标签 -----"'):]
        header = f'''#!/bin/bash
set -e
REPO='{self.path.as_posix()}'
GIT='{self.fake_git.as_posix()}'
PY='{self.fake_py.as_posix()}'
LOCAL_VER=26.10.28.1
TAG_VER="v${{LOCAL_VER}}"
REVIEW_FLAG="$REPO/.self-review-ok"
URL_FILE="$REPO/.gitee-url.bak"
BACKUP_BUNDLE=offline.bundle
REMOTE=gitee
'''
        return self.run_script(self.write('publish-case.sh', header + preflight + tail), scenario)

    def trace(self):
        path = self.path / 'git.log'
        return path.read_text(encoding='utf-8') if path.exists() else ''

    def assert_preserved(self):
        self.assertTrue((self.path / '.self-review-ok').exists(), self.output)
        self.assertEqual((self.path / 'pending').read_text(encoding='utf-8'), '待推送内容', self.output)
        self.assertFalse((self.path / 'reset-called').exists(), self.output)
        self.assertFalse((self.path / 'remote-active').exists(), self.output)

    def test_publish_failures_preserve_review_and_pending(self):
        for scenario in ('main-push-fail', 'tag-push-fail', 'main-wrong', 'tag-wrong',
                         'short-sha', 'remote-read-fail', 'missing-tag', 'sync-fail', 'local-wrong',
                         'points-fail', 'reset-fail'):
            with self.subTest(scenario=scenario):
                self.assertNotEqual(self.publish(scenario), 0, self.output)
                self.assert_preserved()
                self.assertNotIn('已推送完成', self.output)
                self.assertNotIn('tag -d', self.trace())

    def test_publish_pushes_only_main_and_target_tag_after_tag_creation(self):
        self.assertEqual(self.publish('success'), 0, self.output)
        pushes = [line for line in self.trace().splitlines() if ' push ' in line]
        self.assertEqual(pushes, [
            '-c push.followTags=false push gitee refs/heads/main:refs/heads/main',
            f'-c push.followTags=false push gitee refs/tags/{TAG}:refs/tags/{TAG}'
        ])
        self.assertIn(f'ls-remote gitee refs/heads/main refs/tags/{TAG} refs/tags/{TAG}^{{}}', self.trace())
        self.assertFalse((self.path / '.self-review-ok').exists())
        self.assertTrue((self.path / 'reset-called').exists())
        self.assertFalse((self.path / 'remote-active').exists())

    def test_publish_reuses_correct_existing_tag(self):
        self.assertEqual(self.publish('local-correct'), 0, self.output)
        self.assertNotIn('tag -a', self.trace())
        self.assertNotIn('tag -d', self.trace())

    def test_publish_accepts_lightweight_remote_tag(self):
        self.assertEqual(self.publish('lightweight'), 0, self.output)

    def test_wrong_local_tag_never_pushes(self):
        self.assertNotEqual(self.publish('local-wrong'), 0, self.output)
        self.assertNotIn(' push ', self.trace())
        self.assertNotIn('tag -a', self.trace())
        self.assert_preserved()

    def test_remote_cleanup_failure_keeps_review(self):
        self.assertNotEqual(self.publish('cleanup-fail'), 0, self.output)
        self.assertTrue((self.path / '.self-review-ok').exists())
        self.assertFalse((self.path / 'reset-called').exists())
        self.assertIn('无法断开发布远程', self.output)

    def prepare_merge(self):
        source = (ROOT / 'scripts/wt-merge.sh').read_text(encoding='utf-8')
        start = source.index('GIT="$(ls -d ')
        end = source.index('NODE_BIN=', start)
        source = source[:start] + f"GIT='{self.fake_git.as_posix()}'\n" + source[end:]
        source = source.replace('REPO="C:/Develop project/DY-COCO"', f"REPO='{self.path.as_posix()}'")
        source = source.replace('WT_ROOT="C:/Develop project/DY-COCO-wt"', f"WT_ROOT='{self.path.as_posix()}/tasks'")
        (self.path / 'tasks' / 'case').mkdir(parents=True)
        merge = self.write('scripts/wt-merge.sh', source)
        self.write('scripts/中文工具.sh', f'''REPO='{self.path.as_posix()}'
check_name() {{ return 0; }}
die() {{ printf '%s\\n' "$*"; exit 1; }}
zh() {{ cat; }}
''')
        outer = self.write('scripts/回收.sh', (ROOT / 'scripts/回收.sh').read_text(encoding='utf-8'))
        return merge, outer

    def test_merge_sync_failure_is_nonzero_and_keeps_task(self):
        merge, _ = self.prepare_merge()
        self.assertEqual(self.run_script(merge, 'sync-fail', 'case', '--go', '--cleanup'), 2, self.output)
        self.assertTrue((self.path / 'merged').exists())
        self.assertNotIn('worktree remove', self.trace())
        self.assertNotIn('branch -d', self.trace())

    def test_already_merged_sync_failure_is_nonzero(self):
        merge, _ = self.prepare_merge()
        self.assertEqual(self.run_script(merge, 'already-sync-fail', 'case', '--go', '--cleanup'), 2, self.output)
        self.assertNotIn('worktree remove', self.trace())

    def test_outer_reports_sync_failure_without_claiming_rollback(self):
        _, outer = self.prepare_merge()
        self.assertNotEqual(self.run_script(outer, 'sync-fail', 'case'), 0, self.output)
        self.assertIn('任务已合并进本地主干，但测试档同步失败', self.output)
        self.assertIn('本次未回滚合并', self.output)
        self.assertNotIn('仓库已回到合并前状态', self.output)
        self.assertNotIn('已同步一份到桌面', self.output)
        self.assertNotIn('副本已自动清理', self.output)

    def test_outer_reports_cleanup_failure_without_success_claim(self):
        _, outer = self.prepare_merge()
        self.assertNotEqual(self.run_script(outer, 'task-cleanup-fail', 'case'), 0, self.output)
        self.assertIn('任务副本或分支未清理完成', self.output)
        self.assertNotIn('副本已自动清理', self.output)

    def test_outer_success_follows_sync_and_cleanup(self):
        _, outer = self.prepare_merge()
        self.assertEqual(self.run_script(outer, 'success', 'case'), 0, self.output)
        self.assertTrue((self.path / 'sync-called').exists())
        self.assertIn('worktree remove', self.trace())
        self.assertIn('branch -d', self.trace())
        self.assertIn('副本已自动清理', self.output)

    def test_copy_gate_remains_enabled(self):
        source = (ROOT / 'publish.sh').read_text(encoding='utf-8')
        self.assertIn('COPY_ARGS=(--gate)', source)
        self.assertIn('check-product-copy.js" "${COPY_ARGS[@]}"', source)
        self.assertIn('exit 1', source.split('check-product-copy.js', 1)[1].split('fi', 1)[0])


if __name__ == '__main__':
    if not BASH:
        raise SystemExit('找不到 bash，无法运行流程行为自测')
    unittest.main(verbosity=2)
