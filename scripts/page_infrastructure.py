"""从业务注入条目生成公共组件兜底；--fix 更新清单，默认只检查。"""
import argparse
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
NET_PROBE = 'src/content/stock-net-probe.js'
NET_PROBE_MAIN = 'src/content/stock-net-probe-main.js'
DEBUG_PANEL = 'src/content/debug-panel.js'
BASE_JS = ['src/content/flags.js', 'src/content/diag.js',
           'src/content/dialog.js', NET_PROBE, DEBUG_PANEL]
BASE_CSS = ['src/content/style.css', 'src/content/msgbox.css']


def is_fallback(entry):
    return 'exclude_matches' in entry and [p for p in entry.get('js', []) if p != NET_PROBE] == [
        p for p in BASE_JS if p != NET_PROBE]


def fallback_entry(manifest):
    entries = [c for c in manifest.get('content_scripts', [])
               if c.get('world') != 'MAIN' and not is_fallback(c)]
    matches = sorted({p for c in entries for p in c.get('matches', [])})
    complete = [c for c in entries if set(BASE_JS).issubset(c.get('js', []))
                and 'src/content/msgbox.css' in c.get('css', [])]
    excluded = sorted({p for c in complete for p in c.get('matches', [])})
    return {'matches': matches, 'exclude_matches': excluded,
            'js': BASE_JS[:], 'css': BASE_CSS[:], 'run_at': 'document_idle'}


def probe_resource(fallback):
    origins = {'/'.join(p.split('/', 3)[:3]) + '/*' for p in fallback['matches']}
    return {'resources': [NET_PROBE_MAIN], 'matches': sorted(origins)}


def fix_infrastructure(manifest):
    entries = [c for c in manifest['content_scripts'] if not is_fallback(c)]
    for entry in entries:
        js = entry.get('js', [])
        if entry.get('world') != 'MAIN' and DEBUG_PANEL in js:
            panel = js.index(DEBUG_PANEL)
            if NET_PROBE not in js[:panel]:
                if NET_PROBE in js:
                    js.remove(NET_PROBE)
                js.insert(panel, NET_PROBE)
    manifest['content_scripts'] = entries
    fallback = fallback_entry(manifest)
    entries.append(fallback)

    resources = []
    for entry in manifest.get('web_accessible_resources', []):
        files = [p for p in entry['resources'] if p != NET_PROBE_MAIN]
        if files:
            resources.append(dict(entry, resources=files))
    manifest['web_accessible_resources'] = resources + [probe_resource(fallback)]


def check_infrastructure(manifest):
    entries = manifest.get('content_scripts', [])
    problems = []
    for i, cs in enumerate(entries):
        if cs.get('world') == 'MAIN':
            continue
        js = cs.get('js', [])
        if any(p in js for p in BASE_JS[1:]):
            missing = set(BASE_JS) - set(js)
            if 'src/content/msgbox.css' not in cs.get('css', []):
                missing.add('src/content/msgbox.css')
            if missing:
                problems.append('条目[%d] 公共消息/调试组件不完整：%s' % (i, ', '.join(sorted(missing))))
            if DEBUG_PANEL in js and js.count(NET_PROBE) == 1 and js.index(NET_PROBE) > js.index(DEBUG_PANEL):
                problems.append('条目[%d] 接口取样探针须在调试面板之前加载' % i)
            if js.count(NET_PROBE) > 1:
                problems.append('条目[%d] 重复加载接口取样探针' % i)
            if cs.get('exclude_matches') and not is_fallback(cs):
                problems.append('条目[%d] 独立公共组件组不可另设排除路径，需拆分完整覆盖组' % i)
    actual = [c for c in entries if is_fallback(c)]
    fallback = fallback_entry(manifest)
    if actual != [fallback]:
        problems.append('全页公共组件兜底与业务页面不一致；运行 python scripts/page_infrastructure.py --fix')
    resources = [r for r in manifest.get('web_accessible_resources', []) if NET_PROBE_MAIN in r['resources']]
    if resources != [probe_resource(fallback)]:
        problems.append('接口取样探针资源与业务站点不一致；运行 python scripts/page_infrastructure.py --fix')
    return problems


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--fix', action='store_true')
    args = ap.parse_args()
    target = ROOT / 'manifest.json'
    manifest = json.loads(target.read_text(encoding='utf-8'))
    if args.fix:
        fix_infrastructure(manifest)
        target.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', encoding='utf-8', newline='\n')
    problems = check_infrastructure(manifest)
    for p in problems:
        print('[不通过] ' + p)
    if not problems:
        print('全页消息与调试覆盖：通过（新增支持页自动纳入公共组件兜底）')
    return int(bool(problems))


if __name__ == '__main__':
    raise SystemExit(main())
