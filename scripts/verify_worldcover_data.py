"""獨立解碼成品，反查原始 ESA 分類；不只驗建置腳本自己產生的統計。"""
import argparse
import hashlib
import json
from pathlib import Path
import mapbox_vector_tile
import mercantile
import rasterio
from rasterio.warp import transform
from shapely.geometry import shape, Point

root = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser()
parser.add_argument('--cache', type=Path, required=True)
args = parser.parse_args()
directory = root / 'rail-3d/landcover/worldcover-2021'
manifest = json.loads((directory / 'manifest.json').read_text())
sources = []
for item in manifest['sources']:
    path = args.cache / (item['tile'] + '.tif')
    assert hashlib.sha256(path.read_bytes()).hexdigest() == item['sha256']
    sources.append(rasterio.open(path))
files = list(directory.rglob('*.pbf'))
assert len(files) == manifest['tiles'] == 918
assert sum(p.stat().st_size for p in files) == manifest['bytes']
checks = 0
classes = set()
for path in sorted((directory / '11').rglob('*.pbf')):
    x, y = int(path.parent.name), int(path.stem)
    bounds = mercantile.xy_bounds(x, y, 11)
    features = mapbox_vector_tile.decode(path.read_bytes())['landcover']['features']
    for feature in features[::max(1, len(features) // 12)]:
        polygon = shape(feature['geometry'])
        point = polygon.representative_point()
        # 回到建置時的 256 格網中心；避開被概化邊界切過的小多邊形。
        px, py = (int(point.x / 16) + .5) * 16, (int(point.y / 16) + .5) * 16
        if not polygon.contains(Point(px, py)):
            continue
        mx = bounds.left + px / 4096 * (bounds.right - bounds.left)
        my = bounds.bottom + py / 4096 * (bounds.top - bounds.bottom)
        lon, lat = transform('EPSG:3857', 'EPSG:4326', [mx], [my])
        source = next(s for s in sources if s.bounds.left <= lon[0] < s.bounds.right and s.bounds.bottom <= lat[0] < s.bounds.top)
        actual = int(next(source.sample([(lon[0], lat[0])]))[0])
        assert actual == feature['properties']['code'], (path, lon, lat, actual, feature['properties'])
        classes.add(actual)
        checks += 1
for source in sources:
    source.close()
assert checks > 1000 and {10, 30, 40, 50, 80}.issubset(classes), (checks, classes)
print(json.dumps({'tiles': len(files), 'sourceChecks': checks, 'classes': sorted(classes), 'bytes': manifest['bytes'], 'pass': True}, ensure_ascii=False))
