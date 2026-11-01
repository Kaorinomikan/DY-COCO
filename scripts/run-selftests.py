"""统一行为自测入口：从工程定位脚本，隔离依赖，不访问真实浏览器或网络。"""
from pathlib import Path
import argparse
import concurrent.futures
import json
import os
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
NODE = os.environ.get('DYC_NODE', 'C:/Users/79412/.workbuddy/binaries/node/versions/22.22.2-6/node.exe')
NODE_MODULES = os.environ.get('NODE_PATH', 'C:/Users/79412/.workbuddy/binaries/node/workspace/node_modules')


def execute(script):
    command = [sys.executable if script.suffix == '.py' else NODE, str(script)]
    env = dict(os.environ, NODE_PATH=NODE_MODULES)
    try:
        result = subprocess.run(command, cwd=ROOT, env=env, capture_output=True,
                                text=True, encoding='utf-8', errors='replace', timeout=300 if script.suffix == '.py' else 60)
        return {'script': script.name, 'exit': result.returncode,
                'output': result.stdout + result.stderr}
    except subprocess.TimeoutExpired as error:
        output = error.stdout or b''
        if isinstance(output, bytes):
            output = output.decode('utf-8', 'replace')
        return {'script': script.name, 'exit': 124, 'output': output + '\n自测超过执行上限，已停止；必须检查未结束的异步任务。'}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('names', nargs='*', help='只运行指定脚本文件名；省略则运行全部自测')
    parser.add_argument('--json', action='store_true', help='输出完整 JSON 供审查')
    args = parser.parse_args()
    scripts = sorted(list((ROOT / 'scripts').glob('自测-*.js')) + list((ROOT / 'scripts').glob('自测-*.py')))
    if args.names:
        wanted = set(args.names)
        scripts = [script for script in scripts if script.name in wanted]
        if wanted != {script.name for script in scripts}:
            parser.error('找不到指定自测：' + ', '.join(wanted - {script.name for script in scripts}))
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        results = list(pool.map(execute, scripts))
    if args.json:
        print(json.dumps(results, ensure_ascii=False, indent=2))
    else:
        for result in results:
            print(('通过' if result['exit'] == 0 else '失败') + '：' + result['script'])
            if result['exit']:
                print(result['output'])
        print(f'自测脚本：{sum(r["exit"] == 0 for r in results)}/{len(results)} 通过。')
    return 1 if any(result['exit'] for result in results) else 0


if __name__ == '__main__':
    raise SystemExit(main())
