#!/usr/bin/env python3
"""建立實體股道路網底稿；只保留來源節點，不平移中心線、不指定當班股道。"""
import argparse
import collections
import hashlib
import json
import math
from pathlib import Path

QUERY = '[out:json][timeout:45];way[railway~"^(rail|subway|light_rail|tram|monorail|narrow_gauge)$"](21.8,119.8,25.4,122.1);out body geom;'
RAILWAYS = {'rail', 'subway', 'light_rail', 'tram', 'monorail', 'narrow_gauge'}
TAGS = ['railway', 'name', 'name:zh', 'ref', 'operator', 'network', 'gauge', 'usage', 'service',
        'bridge', 'tunnel', 'layer', 'level', 'oneway', 'railway:preferred_direction',
        'railway:bidirectional', 'railway:track_ref', 'railway:traffic_mode', 'electrified', 'voltage']

def build(raw_bytes):
    raw = json.loads(raw_bytes)
    if raw.get('remark') or not raw.get('osm3s', {}).get('timestamp_osm_base'):
        raise ValueError('來源未完成或缺少資料時間')
    nodes, ways, ids = {}, [], set()
    services, railway_types = collections.Counter(), collections.Counter()
    for way in raw.get('elements', []):
        if way.get('type') != 'way' or way.get('tags', {}).get('railway') not in RAILWAYS:
            continue
        if way['id'] in ids:
            raise ValueError('同一 way 重複，必須先確認來源版本')
        ids.add(way['id'])
        ns, coords = way.get('nodes', []), way.get('geometry', [])
        if len(ns) < 2 or len(ns) != len(coords):
            raise ValueError(f"way {way['id']} 缺少真實 node ID 或座標")
        for node_id, point in zip(ns, coords):
            xy = [point.get('lon'), point.get('lat')]
            if not all(isinstance(v, (int, float)) and math.isfinite(v) for v in xy):
                raise ValueError('座標無效')
            if not (119 < xy[0] < 123 and 21 < xy[1] < 26):
                raise ValueError('台灣資料範圍外')
            if node_id in nodes and nodes[node_id] != xy:
                raise ValueError(f'同一 node {node_id} 出現不同座標')
            nodes[node_id] = xy
        tags = {k:way['tags'][k] for k in TAGS if k in way['tags']}
        ways.append({'id':way['id'], 'nodes':ns, 'tags':tags})
        services[tags.get('service', 'unspecified')] += 1
        railway_types[tags['railway']] += 1
    if not ways:
        raise ValueError('沒有軌道資料')
    # 交叉線只因相同 node ID 相連；不以經緯度接近合併節點。
    degree = collections.defaultdict(set)
    for way in ways:
        for a, b in zip(way['nodes'], way['nodes'][1:]):
            if a != b:
                degree[a].add(b)
                degree[b].add(a)
    summary = {'ways':len(ways), 'nodes':len(nodes),
               'sourceSegments':sum(len(w['nodes'])-1 for w in ways),
               'junctionNodes':sum(len(neighbors)>2 for neighbors in degree.values()),
               'service':dict(sorted(services.items())), 'railway':dict(sorted(railway_types.items())),
               'explicitOneway':sum(w['tags'].get('oneway') in ['yes', '1', '-1'] for w in ways),
               'preferredDirection':sum('railway:preferred_direction' in w['tags'] for w in ways),
               'trackReference':sum('railway:track_ref' in w['tags'] for w in ways)}
    return {'schema':1, 'source':{'name':'OpenStreetMap contributors', 'url':'https://www.openstreetmap.org/copyright',
            'license':'ODbL-1.0', 'at':raw['osm3s']['timestamp_osm_base'],
            'sha256':hashlib.sha256(raw_bytes).hexdigest(), 'query':QUERY},
            'scope':'physical-topology-candidate', 'railElevationM':None, 'dispatchAssignments':None,
            'summary':summary, 'nodes':{str(k):nodes[k] for k in sorted(nodes)}, 'ways':sorted(ways,key=lambda w:w['id'])}

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--summary', type=Path)
    args = parser.parse_args()
    graph = build(args.source.read_bytes())
    args.output.parent.mkdir(parents=True, exist_ok=True)
    temp = args.output.with_suffix('.tmp')
    temp.write_text(json.dumps(graph, ensure_ascii=False, separators=(',', ':'))+'\n')
    temp.replace(args.output)
    report = {k:v for k,v in graph.items() if k not in ['nodes', 'ways']}
    if args.summary:
        args.summary.parent.mkdir(parents=True, exist_ok=True)
        args.summary.write_text(json.dumps(report, ensure_ascii=False, indent=2)+'\n')
    print(json.dumps(report, ensure_ascii=False, indent=2))

if __name__ == '__main__':
    main()
