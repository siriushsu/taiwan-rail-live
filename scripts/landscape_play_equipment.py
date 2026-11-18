"""讀取有設備種類與位置的遊具。OSM 線狀溜滑梯沿圖上起終點朝向；點資料使用示意朝向。"""
from collections import Counter
import json
import math
import osmium
from pyproj import Transformer
from shapely.geometry import Polygon, LineString, Point

PROJECT = Transformer.from_crs(4326,3826,always_xy=True).transform
MODELS = {'slide','swing','basketswing','seesaw','climbingframe','horizontal_bar','balancebeam','sandpit','playhouse','roundabout'}
T = 1280


def add_equipment(pbf, detail, overlays):
    counts = Counter()
    placed = {}
    for obj in osmium.FileProcessor(pbf).with_locations().with_filter(osmium.filter.KeyFilter('playground','attraction')):
        tags = obj.tags
        kind = tags.get('playground','').split(';')[0]
        if tags.get('attraction') == 'carousel':
            kind = 'carousel'
        elif kind not in MODELS:
            continue
        if tags.get('indoor') in ('yes','room') or tags.get('location') in ('underground','indoor','roof') or tags.get('level','0')!='0':
            continue
        angle = 0
        if obj.is_node():
            x,y = PROJECT(obj.location.lon,obj.location.lat)
        elif obj.is_way():
            coords = [PROJECT(n.lon,n.lat) for n in obj.nodes if n.location.valid()]
            if len(set(coords)) < 2: continue
            if len(coords)>3 and coords[0] == coords[-1]:
                footprint = Polygon(coords)
                q = footprint.representative_point()
                axis = list(footprint.minimum_rotated_rectangle.exterior.coords)
                a,b = max(zip(axis,axis[1:]),key=lambda pair:math.dist(*pair))
            else:
                footprint = LineString(coords)
                q = footprint.interpolate(.5,normalized=True)
                a,b = coords[0],coords[-1]
            x,y=q.x,q.y
            angle=round(math.degrees(math.atan2(b[1]-a[1],b[0]-a[0])))
        else: continue
        i,j = math.floor(x/T),math.floor(y/T)
        if (i,j) not in detail: continue
        nearby=placed.setdefault((i,j,kind),[])
        if any(math.hypot(x-px,y-py)<1.5 for px,py in nearby): continue
        nearby.append((x,y))
        tile=overlays[f'{i//8}_{j//8}'].setdefault(f'E{i}_N{j}',{})
        tile.setdefault('equipment',[]).append([kind,round(x-i*T,2),round(y-j*T,2),angle])
        counts['equipment_'+kind] += 1
    return counts
