"""统一行为自测入口：从工程定位脚本，隔离依赖，不访问真实浏览器或网络。

★ 2026-11-02 提速改造（用户要求：降低自测误红概率、缩短每次迭代等待）
  ① `--changed`：只跑与本轮改动**相关**的自测（自动从脚本内容反查引用的源文件，
     零维护）。全量耗时以实际输出为准，相关子集取决于命中范围。
  ② 失败**归因**：失败时直接指出「疑似断言过时」还是「疑似真 bug」，
     并列出该自测引用的源文件在本轮是否被改动 —— 不用再逐个点开看。
  ③ 按历史耗时**降序**调度（缓存 .tmp/selftest-durations.json），
     长脚本先开跑，总时长贴近最慢那一个而不是排队累加。
  ④ 超时 60 → 180 秒：jsdom 大脚本在并发下偶发超过 60 秒会被误判为失败。
     超时仍然判失败（不放过卡死的异步任务），但不再因机器抖动而误红。
  ⑤ `--release-gate`：发布前必跑全量；按受测内容指纹复用同一份通过结果。
     指纹覆盖全部 Git 跟踪/未忽略文件与运行时版本，内容一变即失效。

★ 判据不变：任一脚本非零退出 → 本入口非零退出。`--changed` 只减少**跑哪些**，
  不改变**怎么判**。全量是发布前的必跑档。
"""
from pathlib import Path
import argparse
import concurrent.futures
import hashlib
import json
import os
import re
import subprocess
import sys
import time

ROOT = Path(__file__).resolve().parents[1]
NODE = os.environ.get('DYC_NODE', 'C:/Users/79412/.workbuddy/binaries/node/versions/22.22.2-6/node.exe')
NODE_MODULES = os.environ.get('NODE_PATH', 'C:/Users/79412/.workbuddy/binaries/node/workspace/node_modules')

DURATION_CACHE = ROOT / '.tmp' / 'selftest-durations.json'

# 命中这些路径 ⇒ 影响面覆盖全部自测，直接跑全量（不做子集裁剪）。
# 判据是「被大量自测共同依赖的底座」，不是「重要文件」——重要的单个功能文件
# 只影响它自己的用例。
GLOBAL_PATHS = (
    'manifest.json',
    'src/content/flags.js',        # 开关元数据：弹窗、中控台、各功能都读
    'src/content/dialog.js',       # 状态栏三段式：几乎所有功能都会写消息
    'src/content/overlay-guard.js',
    'src/content/toolbar.js',
    'src/popup/popup.js',
    'src/popup/popup.html',
    'src/background/service-worker.js',
    'src/shared/',
    'src/update/',
)

# 改动这些 ⇒ 全量（自测基础设施自身变了，映射可能失效）
GLOBAL_SCRIPTS = ('scripts/run-selftests.py', 'scripts/selfcheck-assertions.py')

# 脚本类改动 → 对应自测。只有少量条目，且长期稳定：
# 自测脚本里引用的不是 src，反查不到，必须显式登记（否则改了闸门却跑不到它的自测）。
SCRIPT_TARGETS = {
    'scripts/check-sensitive-words.py': '自测-敏感词邻近匹配.py',
    'scripts/sensitive-words-allowlist.txt': '自测-敏感词邻近匹配.py',
    'scripts/check-syntax.py': '自测-语法闸门.py',
    'scripts/wt-merge.sh': '自测-发布回收.py',
    'scripts/回收.sh': '自测-发布回收.py',
    'scripts/publish.sh': '自测-发布回收.py',
    'scripts/publish-github-api.py': '自测-发布回收.py',
    'scripts/make-dist.py': '自测-发布回收.py',
    'scripts/check-sw-build.py': '自测-更新生效.js',
}


def git(*args):
    """调 git；失败返回 None（与「真的没改动」区分开）。"""
    try:
        out = subprocess.run(['git'] + list(args), cwd=ROOT, capture_output=True,
                             text=True, encoding='utf-8', errors='replace', timeout=60)
        return out.stdout if out.returncode == 0 else None
    except Exception:
        return None


# 只有这些前缀的改动才可能影响自测。文档/图标/输出物改动不该拖慢迭代。
RELEVANT_PREFIXES = ('src/', 'scripts/', 'install/', 'manifest.json')


def changed_files():
    """工作区未提交改动 + 相对 main 的已提交改动，取并集。

    返回 None 表示 git 取不到（此时调用方必须退回全量，不能当成「没改动」）。

    ★ 环境变量 DYC_CHANGED_FILES（换行分隔）优先：
      合并前的主工作区里 HEAD 就是 main，`main...HEAD` 永远是空，
      拿不到「这个任务分支改了什么」。wt-merge.sh 会先把分支改动算好塞进来。
    """
    injected = os.environ.get('DYC_CHANGED_FILES')
    if injected is not None:
        return {n.strip().replace('\\', '/') for n in injected.splitlines()
                if n.strip() and n.strip().startswith(RELEVANT_PREFIXES)}

    names = set()
    ok = False
    for args in (('status', '--porcelain'), ('diff', '--name-only', 'main...HEAD')):
        out = git(*args)
        if out is not None:
            ok = True
        for line in (out or '').splitlines():
            name = line[3:] if args[0] == 'status' else line
            name = name.strip()
            if ' -> ' in name:              # 重命名 "old -> new" 取新名
                name = name.split(' -> ')[-1]
            if name:
                names.add(name.replace('\\', '/'))
    if not ok:
        return None
    return {n for n in names
            if not n.startswith('.tmp/') and n.startswith(RELEVANT_PREFIXES)}


def collects_selfchecks():
    return sorted(list((ROOT / 'scripts').glob('自测-*.js'))
                  + list((ROOT / 'scripts').glob('自测-*.py')))


# 只认**引号内**的路径：注释里顺手提到的 "src/xxx.js" 不算引用。
# 前缀允许 ../ 这类相对写法（实测 15 个自测用的是 path.join(__dirname, '../src/...')）。
# 宁可多算（多跑一个自测，只是慢一点），绝不漏算（漏算 = 假绿灯）。
REF_RE = re.compile(
    r"""['"`]([^'"`]*?src/[A-Za-z0-9_\-./]+\.(?:js|json|html|css))['"`]""")


def referenced_sources(script):
    """从自测脚本正文反查它引用了哪些源文件。

    ★ 为什么要自动反查而不是维护一张映射表：
      映射表没人更新，两天后就与实际脱节（本项目已有先例）。
      自测脚本里必然出现被测文件的路径（fs.readFileSync('src/live/xx.js')），
      反查是**零维护**且永远与现状一致。
    """
    try:
        text = script.read_text(encoding='utf-8', errors='replace')
    except Exception:
        return set()
    found = set()
    for m in REF_RE.finditer(text):
        p = m.group(1).lstrip('./')
        if p.startswith('src/'):
            found.add(p)
    return found


def build_index(scripts):
    return {s: referenced_sources(s) for s in scripts}


def select_changed(scripts, index, changes):
    """按改动集选相关自测；命中全局路径或无法判定时退回全量。"""
    if changes is None:
        return scripts, 'git 取不到改动（退回全量）'
    if not changes:
        return [], '本轮没有影响自测的改动（文档/图标等）'
    for c in sorted(changes):
        if c in GLOBAL_SCRIPTS:
            return scripts, '自测入口自身有改动'
        if c in GLOBAL_PATHS or any(c.startswith(p) for p in GLOBAL_PATHS if p.endswith('/')):
            return scripts, '共享底座有改动：' + c

    picked, unmatched = [], []
    for c in sorted(changes):
        # 改了某个自测本身 ⇒ 至少把它跑一遍（但**不是**全量：
        # 做新功能必然新增自测，若因此退回全量，--changed 就永远没有意义）
        if c.startswith('scripts/自测-'):
            hit = [s for s in scripts if s.name == Path(c).name]
        elif c in SCRIPT_TARGETS:
            hit = [s for s in scripts if s.name == SCRIPT_TARGETS[c]]
        else:
            hit = [s for s in scripts if c in index.get(s, ())]
        if not hit and not c.startswith('scripts/'):
            unmatched.append(c)
        for s in hit:
            if s not in picked:
                picked.append(s)

    # 改了一个没有任何自测引用的源文件（新功能、新模块）⇒ 无从裁剪，
    # 保守跑全量，绝不因为「没找到对应用例」就跳过全部检查。
    if unmatched and not picked:
        return scripts, '改动文件没有对应自测：' + ', '.join(unmatched[:3])
    order = {s: i for i, s in enumerate(scripts)}
    return sorted(picked, key=lambda s: order.get(s, 0)), None


def load_durations():
    try:
        return json.loads(DURATION_CACHE.read_text(encoding='utf-8'))
    except Exception:
        return {}


def save_durations(durations):
    try:
        DURATION_CACHE.parent.mkdir(parents=True, exist_ok=True)
        DURATION_CACHE.write_text(json.dumps(durations, ensure_ascii=False, indent=1),
                                  encoding='utf-8')
    except Exception:
        pass


def release_receipt(root=None):
    return Path(root or ROOT) / '.tmp' / 'selftest-release-ok.json'


def release_fingerprint(root=None):
    """发布全量的受测内容指纹；取不到 Git 文件清单时返回 None（必须实跑）。"""
    base = Path(root or ROOT)
    try:
        names = subprocess.run(
            ['git', 'ls-files', '-z', '--cached', '--others', '--exclude-standard'],
            cwd=base, capture_output=True, timeout=60)
        if names.returncode != 0:
            return None
        paths = sorted({p for p in names.stdout.decode('utf-8', 'replace').split('\0')
                        if p and not p.startswith('.tmp/')})
        if not paths:
            return None
        digest = hashlib.sha256()
        for name in paths:
            path = base / name
            if not path.is_file():
                continue
            digest.update(name.encode('utf-8', 'replace'))
            digest.update(b'\0')
            digest.update(path.read_bytes())
            digest.update(b'\0')
        try:
            node_version = subprocess.run([NODE, '--version'], capture_output=True, text=True,
                                          encoding='utf-8', errors='replace', timeout=10).stdout.strip()
        except Exception:
            node_version = 'unknown'
        digest.update(('python=' + sys.version + '\nnode=' + node_version).encode('utf-8'))
        return digest.hexdigest()
    except Exception:
        return None


def execute(script, timeout):
    """跑一个自测；返回含耗时与归因素材的结果。"""
    command = [sys.executable if script.suffix == '.py' else NODE, str(script)]
    env = dict(os.environ, NODE_PATH=NODE_MODULES)
    started = time.time()
    try:
        result = subprocess.run(command, cwd=ROOT, env=env, capture_output=True,
                                text=True, encoding='utf-8', errors='replace',
                                timeout=timeout)
        return {'script': script.name, 'exit': result.returncode,
                'output': result.stdout + result.stderr,
                'seconds': round(time.time() - started, 2)}
    except subprocess.TimeoutExpired as error:
        output = error.stdout or b''
        if isinstance(output, bytes):
            output = output.decode('utf-8', 'replace')
        return {'script': script.name, 'exit': 124, 'seconds': round(time.time() - started, 2),
                'output': output + f'\n自测超过执行上限（{timeout} 秒），已停止；'
                                   '必须检查未结束的异步任务。'}


# ---------- 失败归因 ----------
# 目标只有一个：让人在 10 秒内判断「这是断言过时，还是功能真坏了」。
# 判据取**脚本自身的写法**（源码文本断言 vs 跑真实逻辑），不猜输出措辞 ——
# 44 个自测各有各的失败文案，按输出文本归类必然错。

_PROFILE_CACHE = {}


def script_profile(script):
    """返回 (源码文本断言条数, 真实行为断言条数)。"""
    if script in _PROFILE_CACHE:
        return _PROFILE_CACHE[script]
    try:
        text = script.read_text(encoding='utf-8', errors='replace')
    except Exception:
        text = ''
    # 源码文本断言：直接对 readFileSync 的内容做正则/indexOf 匹配
    src_like = (text.count('.test(src') + text.count('.test(source')
                + text.count('.test(raw') + text.count('.includes(') // 2)
    # 真实行为断言：起 jsdom / 用 assert / 本项目 ok()/check() 断言
    entry = text.count('jsdom') + text.count('assert.') + text.count('await ')
    _PROFILE_CACHE[script] = (src_like, entry)
    return _PROFILE_CACHE[script]


def classify(result, script, script_sources, changed):
    """返回 (类别, 一句话结论, 建议动作列表)。"""
    if result['exit'] == 124:
        return '超时', '脚本没在时限内结束，通常是异步任务未收尾或机器负载过高。', [
            '先单独重跑它（run-selftests.py ' + result['script'] + '）确认是否稳定复现',
            '稳定复现 ⇒ 查未结束的定时器/轮询；偶发 ⇒ 本轮可忽略，属环境抖动',
        ]

    touched = sorted(p for p in script_sources if p in changed)
    src_like, behavior_like = script_profile(script) if script else (0, 0)

    if touched and src_like > behavior_like:
        return '断言可能过时（该用例以源码文本断言为主）', \
               '本轮改动了它引用的 ' + ', '.join(touched[:2]) + '，而它的断言大多在比对源码写法。', [
            '先确认改动是有意的（不是改坏了）',
            '再按新写法更新断言：正则里用 \\s* 代替字面空格，别绑死整句文案',
            '不要为了变绿删断言 —— 删掉的那条正是防回潮的那条',
        ]
    if touched:
        return '行为断言失败（可能是真 bug）', \
               '本轮改动了它引用的 ' + ', '.join(touched[:2]) + '，用例跑的是真实行为。', [
            '先看失败断言的期望值，对着源码走一遍该分支',
            '若是本次改动**有意**改变的行为，同步更新断言（并说明理由）',
        ]
    if src_like > behavior_like:
        return '断言可能过时（该用例以源码文本断言为主）', \
               '断言比对的是源码写法，本轮未直接改动它引用的文件。', [
            '检查共享文件/开关元数据的连带影响',
            '按新写法更新断言',
        ]
    return '待人工判断', '本轮改动与该用例无直接引用关系。', ['单独重跑该用例并读完整输出']


def main():
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('names', nargs='*', help='只运行指定脚本文件名；省略则按模式选')
    parser.add_argument('--changed', action='store_true',
                        help='只跑与本轮改动相关的自测（合并预检用；发布必须全量）')
    parser.add_argument('--release-gate', action='store_true',
                        help='发布前全量闸门；同一受测内容复用已通过结果')
    parser.add_argument('--list', action='store_true', help='只打印「改动 → 相关自测」的判定，不执行')
    parser.add_argument('--json', action='store_true', help='输出完整 JSON 供审查')
    parser.add_argument('--jobs', type=int, default=6, help='并发数（默认 6）')
    parser.add_argument('--timeout', type=int, default=180, help='单个自测超时秒数（默认 180）')
    parser.add_argument('--quiet', action='store_true', help='只打印失败项与汇总')
    args = parser.parse_args()

    all_scripts = collects_selfchecks()
    scripts = all_scripts
    if args.names:
        wanted = set(args.names)
        scripts = [s for s in all_scripts if s.name in wanted]
        missing = wanted - {s.name for s in all_scripts}
        if missing:
            parser.error('找不到指定自测：' + ', '.join(sorted(missing)))

    if args.release_gate and (args.changed or args.names):
        parser.error('--release-gate 只能跑全量，不能与 --changed 或指定脚本同时使用')

    changes = changed_files()
    reason = None
    if args.changed and not args.names:
        scripts, reason = select_changed(scripts, build_index(scripts), changes)

    fingerprint = None
    if args.release_gate:
        fingerprint = release_fingerprint()
        receipt = release_receipt()
        if fingerprint:
            try:
                saved = json.loads(receipt.read_text(encoding='utf-8'))
            except Exception:
                saved = {}
            if (saved.get('fingerprint') == fingerprint
                    and saved.get('scripts') == len(scripts)
                    and saved.get('status') == 'pass'):
                print('发布全量自测：同一受测内容已有通过凭据，直接复用。')
                print('  凭据：' + str(receipt))
                print(f'  受测脚本：{len(scripts)} 个；内容未变，无需重复执行。')
                return 0
        else:
            print('发布全量自测：无法计算受测内容指纹，本次实跑（不复用旧结果）。')

    if args.list:
        print('本轮改动：' + (', '.join(sorted(changes)) if changes else '（无）'))
        print('判定：' + (reason or '全量'))
        print('将运行 %d 个自测：' % len(scripts))
        for s in scripts:
            print('  - ' + s.name)
        return 0

    if not scripts:
        print('本轮没有相关自测需要跑。')
        return 0

    if reason:
        print(f'（按改动筛选：{reason} → {len(scripts)} 个自测）')

    # 按历史耗时降序调度：最长的先开跑，总时长贴近最慢那个
    durations = load_durations()
    ordered = sorted(scripts, key=lambda s: -durations.get(s.name, 0))
    timeout = max(60, args.timeout)

    with concurrent.futures.ThreadPoolExecutor(max_workers=max(1, args.jobs)) as pool:
        results = list(pool.map(lambda s: execute(s, timeout), ordered))

    for result in results:
        if result['exit'] == 0:
            durations[result['script']] = result['seconds']
    save_durations(durations)

    if args.json:
        print(json.dumps(results, ensure_ascii=False, indent=2))
        return 1 if any(r['exit'] for r in results) else 0

    failed = [r for r in results if r['exit']]
    if args.quiet:
        for result in failed:
            print('失败：' + result['script'] + f'（{result["seconds"]}s）')
            print(result['output'])
    else:
        for result in sorted(results, key=lambda r: r['script']):
            print(('通过' if result['exit'] == 0 else '失败') + '：' + result['script']
                  + f'（{result["seconds"]}s）')
            if result['exit']:
                print(result['output'])

    receipt = release_receipt()
    if args.release_gate and fingerprint:
        if failed:
            try:
                saved = json.loads(receipt.read_text(encoding='utf-8'))
                if saved.get('fingerprint') == fingerprint:
                    receipt.unlink()
            except Exception:
                pass
        else:
            receipt.parent.mkdir(parents=True, exist_ok=True)
            receipt.write_text(json.dumps({
                'status': 'pass',
                'fingerprint': fingerprint,
                'scripts': len(results),
                'finished_at': time.strftime('%Y-%m-%d %H:%M:%S'),
            }, ensure_ascii=False, indent=1), encoding='utf-8')
            print('发布全量自测通过凭据已写入：' + str(receipt))

    if failed:
        index = build_index(scripts)
        by_name = {s.name: s for s in scripts}
        print('\n' + '=' * 60)
        print('失败归因（省去逐个点开看的时间）')
        print('=' * 60)
        for result in failed:
            category, why, actions = classify(
                result, by_name[result['script']],
                index.get(by_name[result['script']], set()), changes)
            print(f'\n▸ {result["script"]}  →  {category}')
            print('  ' + why)
            for a in actions:
                print('  · ' + a)
        print('\n提示：归因是**基于改动关系**的初判，仍需看一眼失败断言本身。')
        print('      已有教训：把断言改成「匹配不到」= 静默失效，'
              '不要为了让自测变绿而放宽断言语义。')

    print(f'\n自测脚本：{len(results) - len(failed)}/{len(results)} 通过。'
          f'（最长 {max(r["seconds"] for r in results)}s）')
    return 1 if failed else 0


if __name__ == '__main__':
    raise SystemExit(main())
