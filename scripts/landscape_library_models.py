"""兩座總館的樓板、採光井與露台，用館方資料及 OSM 外框建模。尺寸無測量值之處為示意。
桃園 https://lifetree.typl.gov.tw/
高雄 https://www.ksml.edu.tw/mainlibrary/content/index.aspx?Parser=1,23,165,156
"""
import math
import json
from shapely.affinity import scale, translate
from shapely.geometry import Point


def library_parts(poly, taoyuan):
    rect=poly.minimum_rotated_rectangle
    a,b,c,*_=rect.exterior.coords
    length=math.dist(a,b)
    u=((b[0]-a[0])/length,(b[1]-a[1])/length)
    v=(-u[1],u[0])
    cx,cy=poly.centroid.coords[0]
    def point(x,y):
        return Point(cx+x*u[0]+y*v[0],cy+x*u[1]+y*v[1])
    def skin(g,base,top,color):
        return (g,{'base':round(base,2),'top':round(top,2),'color':color,'bespoke':int(not taoyuan)})
    if taoyuan:
        # 順著原有量體退台，露出台階般的植栽平台與淺色屋簷。
        lightwell=point(0,0).buffer(7.5,quad_segs=16)
        for i in range(8):
            body=scale(poly,1-.030*i,1-.031*i,origin=(cx,cy))
            angle=i*math.pi/4
            body=translate(body,1.2*math.cos(angle),1.2*math.sin(angle))
            height=i*4.75
            rim=body.buffer(.7,join_style=2)
            yield skin(rim.difference(lightwell),height,height+.75,'#d9c5a4')
            glass=body.buffer(-1.6)
            yield skin(glass.difference(lightwell),height+.75,height+4.6,'#698c91')
            # 木紋玻璃的暖色直向分格。沿實際外框，不使用招牌貼圖。
            boundary=glass.exterior
            for j in range(0,int(boundary.length),5):
                p=boundary.interpolate(j)
                yield skin(p.buffer(.62,quad_segs=2),height+.75,height+4.55,'#b49371')
            terrace=rim.difference(body.buffer(-.55))
            yield skin(terrace,height+.76,height+1.14,'#728664')
        yield skin(body.difference(lightwell),37.75,38.4,'#a8ad8e')
        yield skin(lightwell.buffer(.9).difference(lightwell),38.35,39.7,'#c6bca5')
    else:
        # 高雄高精度地景已有逐館模型；這份量體給一般地景和手機。
        court=point(0,0).buffer(11,quad_segs=12)
        yield skin(scale(poly,.34,.32,origin='centroid'),0,8,'#8db7b1')
        for i in range(7):
            h=7.5+i*4.25
            shape=poly.difference(court) if i>=4 else poly
            yield skin(shape,h,h+.58,'#deded4')
            glass=shape.buffer(-.9)
            yield skin(glass,h+.58,h+4.24,'#66929a')
        yield skin(poly.difference(court),37.2,38,'#849a76')
        for x,y in [(-23,-23),(-23,23),(23,-23),(23,23)]:
            yield skin(point(x,y).buffer(3.3,quad_segs=4),37.5,40.5,'#d4d8d7')


CONTEXT_SOURCE = 'https://tiles.openfreemap.org/planet/20261115_080022_pt'


def clean_context_tiles(libraries, cache, output, reviewed=()):
    """從 z14 街廓裁出已建模館舍及廟宇的位置，同一圖磚的多個院落合併處理。"""
    import mapbox_vector_tile as mvt
    from mapbox_vector_tile.Mapbox.vector_tile_pb2 import tile
    from pyproj import Transformer
    from shapely import set_precision
    from shapely.geometry import shape
    from shapely.ops import transform
    import subprocess

    version = CONTEXT_SOURCE.rsplit('/',1)[1]
    length = 2 ** 14
    merc = Transformer.from_crs(3826, 3857, always_xy=True).transform
    half = math.pi * 6378137
    output.mkdir(parents=True, exist_ok=True)
    def pieces(g):
        if g.geom_type == 'Polygon':
            return [g] if g.area > 1 else []
        return [p for child in getattr(g,'geoms',()) for p in pieces(child)]
    from collections import defaultdict
    from shapely import union_all
    groups=defaultdict(list)
    span=half*2/length
    masks=[g for g,_ in libraries]
    for site in reviewed:
        from landscape_reviewed_temples import site_mask
        masks.append(site_mask(site)[1])
    for mask in masks:
        g=transform(merc,mask)
        west,south,east,north=g.buffer(15).bounds
        for x in range(int((west+half)/span),int((east+half)/span)+1):
            for y in range(int((half-north)/span),int((half-south)/span)+1):
                groups[x,y].append(g)
    for (x,y), shapes in sorted(groups.items()):
        g=union_all(shapes)
        cache_tile = cache/f'ofm-{version}-{x}-{y}.pbf'
        if not cache_tile.exists():
            url = f'{CONTEXT_SOURCE}/14/{x}/{y}.pbf'
            downloaded=subprocess.check_output(['curl','-fsSL','--retry','3','--max-time','45',url])
            tile.FromString(downloaded)
            cache_tile.write_bytes(downloaded)
        original = cache_tile.read_bytes()
        source = tile.FromString(original)
        layer = next((l for l in source.layers if l.name=='building'),None)
        if layer is None:
            (output/f'{x}-{y}.pbf').write_bytes(original)
            continue
        decoded = mvt.decode(original)['building']['features']
        span = half*2/length
        def tile_point(e,n):
            return ((e+half)/span-x)*layer.extent, ((n-half)/span+y+1)*layer.extent
        footprint = transform(tile_point,g).buffer(1.3)
        kept = []
        if len(layer.features) != len(decoded):
            raise ValueError("街廓解碼筆數不符")
        for raw, feature in zip(layer.features,decoded):
            geom = shape(feature['geometry'])
            if geom.geom_type not in ('Polygon','MultiPolygon') or not geom.envelope.intersects(footprint):
                kept.append(raw)
                continue
            valid = geom if geom.is_valid else geom.buffer(0)
            if valid.intersection(footprint).area < 2:
                kept.append(raw)
                continue
            # 單筆 OFM 要素可合併上千棟，不能按建物編號整批隱藏。
            remainder = pieces(set_precision(valid.difference(footprint),1))
            if remainder:
                from shapely.geometry import MultiPolygon
                packed = mvt.encode({'name':'b','features':[{'geometry':MultiPolygon(remainder)}]},
                                    default_options={'extents':layer.extent})
                raw.geometry[:] = tile.FromString(packed).layers[0].features[0].geometry
                kept.append(raw)
        del layer.features[:]
        layer.features.extend(kept)
        (output/f'{x}-{y}.pbf').write_bytes(source.SerializeToString())
    (output/'index.json').write_text(json.dumps([f'{x}/{y}' for x,y in sorted(groups)],separators=(',',':'))+'\n')
