#!/usr/bin/env python3
"""從 git 取出股道座標，存成 input/alignment.json（build.py 的輸入）。

為什麼獨立成一支：params.json 的 alignment.source 指向某個 commit 上的 rail-3d/physical/network.json
（feat/tainan-underground 分支），併進 main 之後只要改 params.json 的 commit 再跑一次這支，建模腳本不用動。
只讀 git（git show），不寫 git；way 清單全部來自 params.json 的 alignment 列。

用法：python3 extract_alignment.py
"""
import datetime
import json
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent


def way_ids(alignment):
    """params.alignment 列出的 way，依 referenceChain、eastChain、stationLoops 的順序、去重。"""
    ids = []
    ids += alignment['referenceChain']['ways']
    ids += alignment['eastChain']
    ids += [alignment['stationLoops']['west'], alignment['stationLoops']['east']]
    out = []
    for i in ids:
        if i not in out:
            out.append(i)
    return out


def main():
    params = json.loads((HERE / 'params.json').read_text(encoding='utf-8'))
    al = params['alignment']
    src = al['source']
    repo = subprocess.run(['git', '-C', str(HERE), 'rev-parse', '--show-toplevel'], check=True,
                          capture_output=True, text=True).stdout.strip()
    raw = subprocess.run(['git', '-C', repo, 'show', f"{src['commit']}:{src['path']}"], check=True,
                         capture_output=True).stdout
    net = json.loads(raw.decode('utf-8'))
    by_id = {str(w['id']): w for w in net['ways']}
    ways = []
    for i in way_ids(al):
        w = by_id.get(str(i))
        if w is None:
            sys.exit(f'network.json 沒有 way {i}')
        ways.append({'id': str(w['id']), 'tags': w['tags'], 'nodes': w['nodes'], 'coordinates': w['coordinates']})
    out = {
        'about': 'params.json 的 alignment 列出的股道，座標照 network.json 原樣（[經度, 緯度]）；build.py 的輸入。',
        'source': {
            'commit': src['commit'],
            'path': src['path'],
            'extractedAt': datetime.datetime.now().astimezone().isoformat(timespec='seconds'),
            'command': f"git show {src['commit']}:{src['path']}",
        },
        'ways': ways,
    }
    (HERE / 'input').mkdir(exist_ok=True)
    (HERE / 'input' / 'alignment.json').write_text(json.dumps(out, ensure_ascii=False, indent=1) + '\n', encoding='utf-8')
    print(f'WROTE input/alignment.json  ways={len(ways)}  nodes={sum(len(w["nodes"]) for w in ways)}')


if __name__ == '__main__':
    main()
