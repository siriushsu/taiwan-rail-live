"""依 Overture 原始 segment 的 connector 與相對里程解出洞內區段。跨 MVT 邊界先接回完整方向。"""
from collections import defaultdict, Counter
from functools import lru_cache
import json
from math import atan, degrees, hypot, pi, sinh
from pathlib import Path
import re

import mapbox_vector_tile
from shapely.geometry import box, LineString, Point
from shapely.ops import substring
from shapely import STRtree
from build_landscape_places import PROJECT


def project(tx,ty,extent,coords):
    result=[]
    for x,y in coords:
        lon=(tx+x/extent)/16384*360-180
        lat=degrees(atan(sinh(pi*(1-2*(ty+y/extent)/16384))))
        result.append(PROJECT(lon,lat))
    return result


def components(g):
    if g.geom_type=='LineString' and g.length>.01: yield g
    elif hasattr(g,'geoms'):
        for part in g.geoms: yield from components(part)


def scan(cache,osm,versions):
    roads={}; connectors={}; count=Counter()
    for f in sorted(cache.glob('transportation-14-*-*.mvt')):
        buf=f.read_bytes()
        if b'is_tunnel' not in buf: continue
        tx,ty=map(int,f.stem.split('-')[-2:])
        tile=mapbox_vector_tile.decode(buf,default_options={'y_coord_down':True})
        layer=tile.get('segment',{}); extent=layer.get('extent',4096)
        clip=box(0,0,extent,extent)
        for ft in layer.get('features',[]):
            prop=ft['properties']; key=prop['id']
            if prop.get('subtype')!='road' or 'is_tunnel' not in prop.get('road_flags',''):continue
            if key not in roads:
                flags=[v.get('between',[0,1]) for v in json.loads(prop['road_flags']) if 'is_tunnel' in v['values']]
                if not flags:continue
                src=[v for v in json.loads(prop.get('sources','[]')) if not v.get('property') and v.get('record_id','').startswith('w')]
                roads[key]=(prop['class'],flags,json.loads(prop.get('connectors','[]')),src,[])
            geo=ft['geometry'];raw=geo['coordinates']
            for pts in raw if geo['type']=='MultiLineString' else [raw]:
                original=LineString(pts)
                # 原始頂點順序就是里程。自交的立體迴轉匝道不可用全線 intersection 來打散。
                if clip.covers(original):
                    fragments=[original]
                else:
                    fragments=[]
                    for a,b in zip(pts,pts[1:]):
                        if a==b:continue
                        edge=LineString([a,b]); part=edge.intersection(clip)
                        if part.geom_type!='LineString' or part.length<.01:continue
                        vertices=list(part.coords)
                        if edge.project(Point(vertices[0]))>edge.project(Point(vertices[-1])):vertices.reverse()
                        if fragments and fragments[-1][-1]==vertices[0]:fragments[-1].extend(vertices[1:])
                        else:fragments.append(vertices)
                    fragments=[LineString(v) for v in fragments]
                for piece in fragments:
                    points=list(piece.coords)
                    roads[key][-1].append(project(tx,ty,extent,points))
        nodes=tile.get('connector',{})
        for ft in nodes.get('features',[]):
            p=ft['geometry']
            if p['type']=='Point':connectors[ft['properties']['id']]=project(tx,ty,nodes['extent'],[p['coordinates']])[0]
    segments=[];profiles={}
    for key,(kind,flags,refs,sources,parts) in roads.items():
        if not parts:continue
        chain=[parts.pop()]
        # 同 segment 可以重進同一張圖磚。只以有方向的真實端點接合，不能沿圖磚順序串接。
        while parts:
            options=[]
            for i,p in enumerate(parts):
                options.extend([(hypot(chain[-1][-1][0]-p[0][0],chain[-1][-1][1]-p[0][1]),i,False),
                                (hypot(chain[0][0][0]-p[-1][0],chain[0][0][1]-p[-1][1]),i,True)])
            gap,i,front=min(options)
            if gap>1.6:break
            p=parts.pop(i)
            if front:chain.insert(0,p)
            else:chain.append(p)
        line=LineString([v for part in chain for v in part])
        def anchored(at,end):
            return any(abs(ref['at']-at)<1e-8 and ref['connector_id'] in connectors and Point(connectors[ref['connector_id']]).distance(Point(end))<2.1 for ref in refs)
        complete=not parts and anchored(0,line.coords[0]) and anchored(1,line.coords[-1])
        # Overture 可把數條原始 way 併成同一個洞；依來源里程拆開後套用各自的更新版。
        flags=[(a,b) for low,high in flags for endpoints in [sorted({low,high,*[v for src in sources for v in src.get('between',[]) if low<v<high]})] for a,b in zip(endpoints,endpoints[1:])]
        if complete:profiles[key]=(line,flags.copy())
        for low,high in flags:
            newer=[]
            for src in sources:
                a,b=src.get('between',[0,1]);ref=re.fullmatch(r'w(\d+)@(\d+)',src['record_id'])
                if (abs(a-low)<1e-6 and abs(b-high)<1e-6 and ref and
                    versions.get(int(ref[1]),0)>int(ref[2])):
                    newer.append(osm[int(ref[1])])
            if newer:
                # 兩版路線在彎中可相距十多公尺，但洞口仍同一處。把兩端投影到實際顯示的
                # 原 segment，再沿原車道裁切，並以里程長度驗證沒有吸到回繞的另一股車道。
                located=[]
                for changed in newer:
                    ends=[Point(changed.coords[0]),Point(changed.coords[-1])]
                    if complete and all(line.distance(end)<3 for end in ends):
                        begin,finish=sorted(line.project(end) for end in ends)
                        if .72*changed.length<finish-begin<1.35*changed.length:
                            changed=substring(line,begin,finish)
                    located.append(changed)
                    segments.append((changed,kind,key))
                # 更新的已知來源只改同一條路，修正路線重整後仍掛著舊版的相對里程。
                if complete:profiles[key]=(line,[v for v in profiles[key][1] if v!=(low,high)]+[(g,'current') for g in located])
                count['updatedOsmRanges']+=1
                continue
            if complete:
                segment=substring(line,low,high,normalized=True)
                if segment.geom_type=='LineString': segments.append((segment,kind,key))
                count['flagRangesOnConnectedGeometry']+=1
            else:
                # 快取邊界沒有完整 segment 時只採用明確屬於洞內的來源 way，拒絕以片段全長套比例。
                for src in sources:
                    a,b=src.get('between',[0,1])
                    if a<low-1e-7 or b>high+1e-7:continue
                    ref=re.fullmatch(r'w(\d+)(?:@\d+)?',src['record_id'])
                    if ref and int(ref[1]) in osm:
                        segments.append((osm[int(ref[1])],kind,key));count['sourceWaysAtCacheEdges']+=1
    # OSM changeset 190523463：阿里山公路兩條新分段的內部節點序列逐點屬於舊版來源。
    # https://www.openstreetmap.org/changeset/190523463
    for wid,key in [(1568328086,'e9343bda-bfe1-470d-b5a9-8c8100aceaf9'),(1568328084,'8e3a4971-3514-42e3-9209-4624c02b6291')]:
        if wid in osm and key in roads:
            segments.append((osm[wid],roads[key][0],key))
            if key in profiles:profiles[key][1].append((osm[wid],'current'))
            count['verifiedLaterSplits']+=1
    # https://www.openstreetmap.org/changeset/190632900
    # 新竹這段的 v1、v2 共用全部節點，v2 補登地下層。原始 MVT 的來源明列 w935335959@1。
    if 935335959 in osm:
        segments.append((osm[935335959],'service','c3f4e483-71fa-41fe-ad24-012e0a2de680'))
        count['verifiedLaterRetag']=1
    return segments,dict(count),profiles


class RoadSources:
    def __init__(self,cache,profiles):
        self.cache=cache;self.profiles=profiles
    @lru_cache(maxsize=24)
    def tile(self,x,y):
        f=self.cache/f'transportation-14-{x}-{y}.mvt'
        geoms=[]; props=[]
        if f.is_file() and f.stat().st_size:
            layer=mapbox_vector_tile.decode(f.read_bytes(),default_options={'y_coord_down':True}).get('segment',{})
            for ft in layer.get('features',[]):
                p=ft['properties'];geo=ft['geometry'];raw=geo['coordinates']
                if p.get('subtype')!='road':continue
                for pts in raw if geo['type']=='MultiLineString' else [raw]:
                    if len(pts)>=2:
                        geoms.append(LineString(project(x,y,layer['extent'],pts)))
                        props.append((p['id'],p['class']))
        return geoms,props,STRtree(geoms)
    def belongs(self,line,distance,kind,ids):
        from math import asinh,tan,radians
        from build_landscape_places import LL
        mid=line.interpolate(distance)
        lon,lat=LL(mid.x,mid.y)
        x=int((lon+180)/360*16384);y=int((1-asinh(tan(radians(lat)))/pi)*8192)
        geom,props,tree=self.tile(x,y)
        controls=[line.interpolate(max(0,min(line.length,distance+t))) for t in (-15,0,15)]
        fits={}
        for j in tree.query(mid.buffer(2.5)):
            key,cls=props[j]
            if cls!=kind:continue
            score=sum(geom[j].distance(p) for p in controls)/len(controls)
            fits[key]=min(score,fits.get(key,float('inf')))
        tunnel=min((v for k,v in fits.items() if k in ids),default=float('inf'))
        other=min((v for k,v in fits.items() if k not in ids),default=float('inf'))
        if tunnel>=1.2:return False
        if tunnel+.12>=other:
            # 上下兩層共用 XY 的匝道，利用同一筆圖磚內整條道路的雙向幾何識別。
            # 只在整段都對回原來源且另一條明顯分離時採用，避免在分塊處猜測。
            matches={}
            for j in tree.query(mid.buffer(2.5)):
                key,cls=props[j]
                if cls!=kind:continue
                candidate=geom[j]
                if abs(line.length-candidate.length)>max(2,line.length*.035):continue
                gap=line.hausdorff_distance(candidate)
                matches[key]=min(matches.get(key,float('inf')),gap)
            yes=min((gap for key,gap in matches.items() if key in ids),default=float('inf'))
            no=min((gap for key,gap in matches.items() if key not in ids),default=float('inf'))
            if yes>.60 or yes+.80>=no:return False
        for key in ids:
            if key not in self.profiles:return True
            source,flags=self.profiles[key]
            at=source.project(mid)
            for a,b in flags:
                if b=='current':
                    if a.distance(mid)<3.5:return True
                elif a*source.length-1 <= at <= b*source.length+1:return True
        return False
