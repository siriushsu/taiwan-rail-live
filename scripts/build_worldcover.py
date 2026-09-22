"""將 ESA WorldCover 2021 裁切為台灣地景向量圖磚（成品僅保留台灣範圍）。

python -m venv /tmp/ri-worldcover-env
/tmp/ri-worldcover-env/bin/pip install rasterio==1.4.3 shapely==2.0.7 mapbox-vector-tile==2.2.0 mercantile==1.2.1
python scripts/build_worldcover.py --cache /tmp/ri-worldcover-source
原始 GeoTIFF 留在 cache，僅輸出經台灣海岸線遮罩、依 zoom 簡化的分類圖磚。
"""
import argparse
import hashlib
import json
from pathlib import Path
import urllib.request

import mercantile
import mapbox_vector_tile
import numpy as np
import rasterio
from rasterio.features import geometry_mask, shapes
from rasterio.transform import from_bounds
from rasterio.warp import reproject, transform_geom, Resampling
from shapely.geometry import shape, box

ROOT = Path(__file__).resolve().parents[1]
SOURCE = 'https://esa-worldcover.s3.eu-central-1.amazonaws.com/v200/2021/map/'
CLASSES = {10: 'wood', 20: 'scrub', 30: 'grass', 40: 'farmland',
           50: 'built', 60: 'bare', 70: 'snow', 80: 'water',
           90: 'wetland', 95: 'mangrove', 100: 'moss'}


def build():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--cache', type=Path, required=True)
    args = parser.parse_args()
    args.cache.mkdir(parents=True, exist_ok=True)
    output = ROOT / 'rail-3d/landcover/worldcover-2021'
    output.mkdir(parents=True, exist_ok=True)
    coast = json.loads((ROOT / 'data/taiwan_land.json').read_text())
    land = shape(coast['geometry'])
    projected = transform_geom('EPSG:4326', 'EPSG:3857', coast['geometry'])
    sources, provenance = [], []
    for tile in ['N21E117', 'N21E120', 'N24E117', 'N24E120']:
        name = f'ESA_WorldCover_10m_2021_v200_{tile}_Map.tif'
        path = args.cache / f'{tile}.tif'
        if not path.exists():
            temporary = path.with_suffix('.download')
            urllib.request.urlretrieve(SOURCE + name, temporary)
            temporary.rename(path)
        sources.append(rasterio.open(path))
        provenance.append({'tile': tile, 'url': SOURCE + name,
                           'sha256': hashlib.sha256(path.read_bytes()).hexdigest()})
    total, nonempty, size, largest = 0, 0, 0, 0
    class_pixels = {v: 0 for v in CLASSES.values()}
    # 每個向量磚以 256x256 分類格點概化；近景有效間距約 70m，不冒充原始 10m 精度。
    for z in range(6, 12):
        count = 0
        for tile in mercantile.tiles(*land.bounds, z):
            features = []
            bounds = mercantile.bounds(tile)
            if land.intersects(box(*bounds)):
                b = mercantile.xy_bounds(tile)
                transform = from_bounds(*b, 256, 256)
                values = np.zeros((256, 256), dtype='uint8')
                for source in sources:
                    if not box(*source.bounds).intersects(box(*bounds)):
                        continue
                    reproject(rasterio.band(source, 1), values,
                              src_transform=source.transform, src_crs=source.crs,
                              dst_transform=transform, dst_crs='EPSG:3857',
                              src_nodata=0, dst_nodata=0, init_dest_nodata=False,
                              resampling=Resampling.nearest)
                mask = geometry_mask([projected], out_shape=values.shape,
                                     transform=transform, invert=True)
                values[~mask] = 0
                for geometry, value in shapes(values, mask=values > 0, transform=transform):
                    value = int(value)
                    if value not in CLASSES:
                        raise ValueError(f'未知 WorldCover 類別 {value}')
                    polygon = shape(geometry).simplify(abs(transform.a) * .35, preserve_topology=True)
                    features.append({'geometry': polygon, 'properties': {'class': CLASSES[value], 'code': value}})
                if z == 11:
                    for value, label in CLASSES.items():
                        class_pixels[label] += int(np.count_nonzero(values == value))
            data = mapbox_vector_tile.encode({'name': 'landcover', 'features': features},
                                            default_options={'quantize_bounds': tuple(mercantile.xy_bounds(tile)), 'extents': 4096})
            target = output / str(z) / str(tile.x) / f'{tile.y}.pbf'
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(data)
            total += 1
            nonempty += bool(features)
            size += len(data)
            largest = max(largest, len(data))
            count += 1
        print(f'z{z}: {count} 圖磚，累積 {size:,} bytes', flush=True)
    for source in sources:
        source.close()
    manifest = {'dataset': 'ESA WorldCover 2021 v200', 'year': 2021,
                'sourceResolutionM': 10, 'displayResolutionMApprox': 70,
                'license': 'CC-BY-4.0', 'licenseUrl': 'https://creativecommons.org/licenses/by/4.0/',
                'citation': 'https://doi.org/10.5281/zenodo.7254221',
                'attribution': '© ESA WorldCover project 2021 / Contains modified Copernicus Sentinel data (2021) processed by ESA WorldCover consortium',
                'processing': '台灣海岸線遮罩；各 zoom 最近鄰分類取樣；拓樸保留簡化；不提供單株樹木位置或高度',
                'coastline': coast['properties'], 'bounds': list(land.bounds),
                'minzoom': 6, 'maxzoom': 11, 'tiles': total, 'nonemptyTiles': nonempty,
                'bytes': size, 'largestTileBytes': largest, 'classPixelsAtMaxzoom': class_pixels,
                'sources': provenance}
    (output / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps(manifest, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    build()
