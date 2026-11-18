"""以文資座標、寺廟名稱及院界核對實際屋頂。未能確認用途的鄰房保留原貌。"""
from functools import lru_cache
import re

import mapbox_vector_tile
import shapely
from pyproj import Transformer
from shapely.geometry import shape
from shapely.ops import transform

OTHER_USE=re.compile(r'宿舍|住宅|商店|大廈|醫院|教堂|餐廳|幼兒園|停車|廁所|圖書館|管理室|商場|辦公')
GENERIC={None,'','yes','building','temple','religious','place_of_worship','civic','public','shrine','pagoda'}


def building_tiles(directory, extra=None):
    half=20037508.342789244
    width=2*half/16384
    to_xy=Transformer.from_crs(3857,3826,always_xy=True).transform
    to_m=Transformer.from_crs(3826,3857,always_xy=True).transform

    @lru_cache(maxsize=24)
    def load(x,y):
        filename=directory/f'buildings-14-{x}-{y}.mvt'
        if not filename.exists() and extra:filename=extra/filename.name
        if not filename.exists():return []
        data=filename.read_bytes()
        if not data:return []
        layer=mapbox_vector_tile.decode(data).get('building',{})
        ext=layer.get('extent',4096);left=x*width-half;bottom=half-(y+1)*width
        def project(px,py):
            import numpy as np
            return to_xy(left+np.asarray(px)*width/ext,bottom+np.asarray(py)*width/ext)
        rows=[]
        for feat in layer.get('features',[]):
            p=feat['properties']
            if p.get('is_underground') or not p.get('id'):continue
            local=shape(feat['geometry'])
            # 向量圖磚邊界切過完整殿體時，交由相鄰圖磚補齊。
            if local.geom_type not in ('Polygon','MultiPolygon'):continue
            g=transform(project,local).buffer(0)
            if g.area>12:rows.append((g,p))
        return rows

    def at(g):
        a,b,c,d=transform(to_m,g).bounds
        result={}
        for x in range(int((a+half)//width),int((c+half)//width)+1):
            for y in range(int((half-d)//width),int((half-b)//width)+1):
                for obj,p in load(x,y):
                    if obj.intersects(g):
                        key=p['id']
                        result[key]=(obj.union(result[key][0]) if key in result else obj,p)
        return result.values()
    return at


def matches(a,b):
    from build_landscape_places import normalize
    a=normalize(a or '').replace('市','').replace('巖','岩');b=normalize(b or '').replace('市','').replace('巖','岩')
    return min(len(a),len(b))>=3 and (a in b or b in a or a[-3:]==b[-3:])


def fill(heritage,sites,parts,footprints,registered):
    source=shapely.STRtree([g for g,p in sites])
    reg=shapely.STRtree([q for q,p in registered])
    existing=list(parts.values());idx=shapely.STRtree([g for g,p in existing])
    count=0
    for q,h in heritage:
        nearby=[sites[i] for i in source.query(q.buffer(260)) if sites[i][0].distance(q)<260 and matches(h['name'],sites[i][1]['name'])]
        grounds=[g for g,p in nearby if g.area>100]
        osm_points=[g for g,p in nearby if not g.area]
        registry_points=[]
        for i in reg.query(q.buffer(120)):
            r,p=registered[i]
            if matches(h['name'],p['name']):registry_points.append(r)
        search=shapely.union_all([q.buffer(90),*grounds,*osm_points,*registry_points]).envelope.buffer(8)
        for g,p in footprints(search):
            if not 15<g.area<17000:continue
            name=p.get('@name') or p.get('name') or ''
            if not isinstance(name,str) or OTHER_USE.search(name):continue
            inside=any(a.covers(g.representative_point()) and g.intersection(a).area>.85*g.area for a in grounds)
            roof=g.buffer(2)
            osm_hit=any(roof.covers(a) for a in osm_points)
            registry_hit=any(roof.covers(a) for a in registry_points)
            point_match=(roof.covers(q) and (osm_hit or registry_hit)) or (osm_hit and registry_hit)
            religious=p.get('subtype')=='religious' and (osm_hit or registry_hit or g.distance(q)<10)
            # 古蹟定位點有時在廟埕；登記座標和 OSM 共同指向同一實測屋頂也能確認。
            same=matches(h['name'],name)
            if not (inside or point_match or same or religious):continue
            if p.get('subtype') not in GENERIC and not same:continue
            if name and not (same or re.search('殿|堂|廟|祖師|金爐|山門|牌樓|廂|戲臺|戲台',name)):continue
            # 整片門廊/院地的新輪廓不可蓋住已個別建模的殿宇。
            hits=idx.query(g);overlap=[g.intersection(existing[j][0]) for j in hits]
            if overlap and shapely.union_all(overlap).area>min(.24*g.area,15):continue
            key=p['id']
            if key in parts:continue
            data={'id':key,'name':name or h['name'],'religion':'','build':'temple','ownerId':h['id'],'major':1}
            if 'height' in p and isinstance(p['height'],(int,float)) and 1.5<p['height']<100:data['h']=p['height']
            if re.search('普濟寺|慶修院',h['name']):data['style']='japanese'
            parts[key]=(g,data);count+=1
    return count
