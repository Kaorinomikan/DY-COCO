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
if [ "$1" = "-C" ]; then shift 2; fi
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
  status|log|merge-tree) ;;
  diff)
    if [[ "$*" == *--name-only* ]] && [ "$SCENARIO" = "src-change" ]; then
      printf 'src/live/demo.js\n'
    fi ;;
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
        self.fake_py = self.write('fake-python', r'''#!/bin/bash
case "$*" in
  *reset-pending.py*)
    # 只有真正的 reset-pending 调用才产生 reset-called 标记。
    # （publish.sh 推送末端新增了 GitHub 同步这一 Python 调用，
    #   不能让它误报「待推送清单已重置」。）
    [ "$SCENARIO" = "reset-fail" ] && exit 1
    : > "$CASE_ROOT/reset-called"
    printf "已重置" > "$CASE_ROOT/pending" ;;
  *publish-github-api.py*)
    # 双平台一键推送：记录「GitHub 同步被调用」，github-fail 场景模拟失败。
    : > "$CASE_ROOT/github-called"
    [ "$SCENARIO" = "github-fail" ] && exit 1 ;;
esac
exit 0
''')
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

    def test_publish_success_also_syncs_github(self):
        # 双平台一键推送（用户 2026-11-08 定）：Gitee 校验通过后必须自动调
        # publish-github-api.py，成功输出必须声明双平台一致。
        self.assertEqual(self.publish('success'), 0, self.output)
        self.assertTrue((self.path / 'github-called').exists(), self.output)
        self.assertIn('GitHub 备用源已同步', self.output)
        self.assertIn('双平台一致', self.output)
        # git trace 仍只有 Gitee 的两条 push —— GitHub 走 API，不产生 git push。
        pushes = [line for line in self.trace().splitlines() if ' push ' in line]
        self.assertEqual(len(pushes), 2, self.trace())

    def test_github_sync_failure_does_not_fail_publish(self):
        # GitHub 是备用源：Gitee 主源已上线后同步失败不判发布失败 ——
        # 照常清自审标记、重置待推送清单，但必须大声报警并给出补推命令。
        self.assertEqual(self.publish('github-fail'), 0, self.output)
        self.assertTrue((self.path / 'github-called').exists(), self.output)
        self.assertIn('[警告] GitHub 备用源同步失败', self.output)
        self.assertIn('补推', self.output)
        self.assertFalse((self.path / '.self-review-ok').exists())
        self.assertTrue((self.path / 'reset-called').exists())

    def test_github_sync_can_be_skipped_explicitly(self):
        # GITHUB_SYNC=0 显式跳过：不得调用 API 脚本，且必须打印显著提示，
        # 防止「以为推了双平台其实只推了一边」。
        self.env['GITHUB_SYNC'] = '0'
        self.assertEqual(self.publish('success'), 0, self.output)
        self.assertFalse((self.path / 'github-called').exists(), self.output)
        self.assertIn('[跳过] GITHUB_SYNC=0', self.output)
        self.assertFalse((self.path / '.self-review-ok').exists())
        self.assertTrue((self.path / 'reset-called').exists())

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
        (self.path / 'tasks' / 'case' / 'scripts').mkdir(parents=True)
        self.write('tasks/case/scripts/check-syntax.py', '# 语法闸门占位，由 fake-python 执行\n')
        self.write('tasks/case/scripts/perf-check.py', '# 性能闸占位，由 fake-python 执行\n')
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

    def test_runtime_change_merges_without_smoke_ack(self):
        # 2026-11-08 口径:真机冒烟不拦合并(改为推送前置)。
        # 旧断言要求 exit 1 + 「缺少当次真机冒烟确认」——口径变更后过时,
        # 改为:照样合并,但在输出里明示「真机验证待测试档、验过才许推」。
        merge, _ = self.prepare_merge()
        self.env.pop('DYC_SMOKE_OK', None)
        self.assertEqual(self.run_script(merge, 'src-change', 'case', '--go'), 0, self.output)
        self.assertIn('未带真机冒烟声明', self.output)
        self.assertIn('验过才允许推送', self.output)
        self.assertIn('merge --no-ff', self.trace())

    def test_runtime_change_merges_with_smoke_ack(self):
        merge, _ = self.prepare_merge()
        self.env['DYC_SMOKE_OK'] = '1'
        self.assertEqual(self.run_script(merge, 'src-change', 'case', '--go'), 0, self.output)
        self.assertIn('已声明本次完成真机冒烟', self.output)
        self.assertIn('merge --no-ff', self.trace())

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
        # 2026-11-05:发布脚本新增 0/6「更新说明预整理」，全文会出现两处
        # check-product-copy.js。原断言取**第一处**再按 'fi' 切片，切到的是预整理
        # 那段（它本就 `|| true` 不中止），于是永远找不到 exit 1 —— 过时的是切法，
        # 不是闸门。改为取**最后一处**（真正带 --gate 的那次）后的调用块。
        tail = source[source.rfind('check-product-copy.js'):]
        self.assertIn('exit 1', tail[:600])

    def test_publish_always_runs_full_release_gate(self):
        source = (ROOT / 'publish.sh').read_text(encoding='utf-8')
        full = source.index('run-selftests.py --release-gate')
        perf = source.index('perf-check.py --gate')
        sensitive = source.index('check-sensitive-words.py --fix')
        self.assertLess(perf, full)
        self.assertLess(full, sensitive)
        self.assertIn('发布全量自测未通过', source[full:full + 500])

    def test_publish_checks_manifest_order(self):
        source = (ROOT / 'publish.sh').read_text(encoding='utf-8')
        self.assertIn('check-manifest-order.py', source)
        self.assertIn('manifest 脚本顺序未通过', source)

    def test_github_reuses_main_preflight_instead_of_private_gate(self):
        source = (ROOT / 'scripts/publish-github-api.py').read_text(encoding='utf-8')
        self.assertIn('"publish.sh"', source)
        self.assertIn('"--dry-run"', source)
        self.assertIn('run_main_preflight()', source)
        self.assertNotIn('def batch_gate', source)
        self.assertNotIn('check-sensitive-words.py", "--fix"', source)


def _run_case(name):
    """跑单个用例；每个用例自带独立沙箱（mkdtemp），因此可以并行。"""
    case = FlowTests(name)
    result = unittest.TestResult()
    case.run(result)
    return name, result


if __name__ == '__main__':
    if not BASH:
        raise SystemExit('找不到 bash，无法运行流程行为自测')
    # ★ 2026-11-02 并行化：12 个用例各自建沙箱、互不共享文件，
    #   串行要 38 秒（Windows 上每次 bash 启动约 1.5 秒），
    #   并行后约 8 秒 —— 这是全量自测里最大的一块。
    import concurrent.futures
    names = sorted(n for n in dir(FlowTests) if n.startswith('test_'))
    with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
        outcomes = list(pool.map(_run_case, names))
    failed = 0
    for name, res in outcomes:
        print(('通过' if res.wasSuccessful() else '失败') + '：' + name)
        if not res.wasSuccessful():
            failed += 1
            for _, tb in list(res.failures) + list(res.errors):
                print(tb)
    print('发布回收流程自测：%d/%d 通过。' % (len(names) - failed, len(names)))
    raise SystemExit(1 if failed else 0)
