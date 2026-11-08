"""从业务注入条目生成公共组件兜底；--fix 更新清单，默认只检查。"""
import argparse
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BASE_JS = ['src/content/flags.js', 'src/content/diag.js',
           'src/content/dialog.js', 'src/content/debug-panel.js']
BASE_CSS = ['src/content/style.css', 'src/content/msgbox.css']


def is_fallback(entry):
    return entry.get('js') == BASE_JS and 'exclude_matches' in entry


def fallback_entry(manifest):
    entries = [c for c in manifest.get('content_scripts', [])
               if c.get('world') != 'MAIN' and not is_fallback(c)]
    matches = sorted({p for c in entries for p in c.get('matches', [])})
    complete = [c for c in entries if set(BASE_JS).issubset(c.get('js', []))
                and 'src/content/msgbox.css' in c.get('css', [])]
    excluded = sorted({p for c in complete for p in c.get('matches', [])})
    return {'matches': matches, 'exclude_matches': excluded,
            'js': BASE_JS[:], 'css': BASE_CSS[:], 'run_at': 'document_idle'}


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
            if cs.get('exclude_matches') and not is_fallback(cs):
                problems.append('条目[%d] 独立公共组件组不可另设排除路径，需拆分完整覆盖组' % i)
    actual = [c for c in entries if is_fallback(c)]
    if actual != [fallback_entry(manifest)]:
        problems.append('全页公共组件兜底与业务页面不一致；运行 python scripts/page_infrastructure.py --fix')
    return problems


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--fix', action='store_true')
    args = ap.parse_args()
    target = ROOT / 'manifest.json'
    manifest = json.loads(target.read_text(encoding='utf-8'))
    if args.fix:
        fallback = fallback_entry(manifest)
        manifest['content_scripts'] = [c for c in manifest['content_scripts'] if not is_fallback(c)] + [fallback]
        target.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', encoding='utf-8', newline='\n')
    problems = check_infrastructure(manifest)
    for p in problems:
        print('[不通过] ' + p)
    if not problems:
        print('全页消息与调试覆盖：通过（新增支持页自动纳入公共组件兜底）')
    return int(bool(problems))


if __name__ == '__main__':
    raise SystemExit(main())
