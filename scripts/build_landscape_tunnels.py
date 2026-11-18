"""將原圖磚的地表道路和 OSM 已標記的地下中心線比對，輸出以公尺表示的隱藏里程。
用法：python scripts/build_landscape_tunnels.py 台灣.osm.pbf --tiles 地景圖磚目錄 --overture Overture圖磚快取 [--night-work 夜景暫存]
"""
import argparse
from collections import Counter, defaultdict
import json
from math import floor, hypot
from pathlib import Path
import re

import osmium
from shapely import STRtree
from shapely.geometry import LineString, box
from landscape_tunnel_source import scan, RoadSources
from build_landscape_places import PROJECT, T, tile_range, region, write_json

OUT = Path(__file__).resolve().parents[1]/'landscape-web/places/tunnels'
MOTOR = {'motorway','trunk','primary','secondary','tertiary','residential','service','living_street','unclassified','road','track'}
WALK = {'steps','footway','pedestrian','cycleway','path','bridleway'}
MAJOR = {'motorway','trunk','primary','secondary','tertiary'}


def category(kind):
    return kind.removesuffix('_link')


def compatible(a,b):
    return a==b or (a in WALK and b in WALK) or (a in {'residential','unclassified','road','living_street'} and b in {'residential','unclassified','road','living_street'})


def overlaps(a,b,u,v,tolerance):
    dx,dy=b[0]-a[0],b[1]-a[1]
    length=hypot(dx,dy)
    vx,vy=v[0]-u[0],v[1]-u[1]
    other=hypot(vx,vy)
    if not length or not other: return
    dx,dy=dx/length,dy/length
    if abs(dx*vx+dy*vy)<.93*other: return
    along=(u[0]-a[0])*dx+(u[1]-a[1])*dy
    across=(u[1]-a[1])*dx-(u[0]-a[0])*dy
    delta=vy*dx-vx*dy
    low,high=0,1
    if abs(delta)<1e-8:
        if abs(across)>tolerance: return
    else:
        t0,t1=sorted(((-tolerance-across)/delta,(tolerance-across)/delta))
        low,high=max(0,t0),min(1,t1)
        if high<=low: return
    s0,s1=sorted(along+t*(dx*vx+dy*vy) for t in (low,high))
    s0,s1=max(0,s0),min(length,s1)
    if s1>s0: return s0,s1


def geometry_key(r):
    pts=r['pts']
    # 只對公分座標做整數雜湊，圖磚換版或順序改變時仍驗證整條幾何。
    h=2166136261
    for p in pts:
        for v in p[:2]:
            h=((h^(round(v*100)&0xffffffff))*16777619)&0xffffffff
    return r['cls']+':'+str(h)


def build(pbf,root,source,night_work=None):
    index=json.loads((root/'index.json').read_bytes())['tiles']
    records=[]; geoms=[]; relevant=set(); ends=Counter(); mouths=[]; osm={}; versions={}
    for w in osmium.FileProcessor(pbf).with_locations().with_filter(osmium.filter.EntityFilter(osmium.osm.WAY)).with_filter(osmium.filter.KeyFilter('tunnel')):
        t=w.tags; k=category(t.get('highway',''))
        if k not in MOTOR|WALK or t.get('tunnel') not in ('yes','building_passage') or t.get('bridge')=='yes': continue
        pts=[(n.ref,PROJECT(n.lon,n.lat)) for n in w.nodes if n.location.valid()]
        if len(pts)<2: continue
        geom=LineString([p for _,p in pts])
        osm[w.id]=geom
        versions[w.id]=w.version
        slots=[(i,j) for i,j in tile_range(geom.buffer(4).bounds) if f'E{i}_N{j}' in index]
        if not slots: continue
        for i,j in slots: relevant.add((i,j))
        for z,step in ((0,1),(-1,-1)):
            node,p=pts[z]; ends[node]+=1
            if k not in MAJOR or t.get('tunnel')!='yes' or not re.search('隧道',t.get('name','')+t.get('tunnel:name','')): continue
            q=pts[z+step][1]; length=hypot(q[0]-p[0],q[1]-p[1])
            if length<.1: continue
            lanes=t.get('lanes','')
            width=(int(lanes)*3.35+1.2) if lanes.isdigit() and 1<=int(lanes)<=5 else (8 if k in ('primary','secondary','tertiary') else 10.5)
            mouths.append((node,p,(q[0]-p[0])/length,(q[1]-p[1])/length,width,w.id))
    underground,source_stats,profiles=scan(source,osm,versions)
    if night_work:
        night_lines=defaultdict(list)
        for geom,_,key in underground:night_lines[key].append([[round(a,2),round(b,2)] for a,b in geom.coords])
        write_json(night_work/'night-lines.json',night_lines)
    verify=RoadSources(source,profiles)
    for line,k,key in underground:
        for i,j in tile_range(line.buffer(4).bounds):
            if f'E{i}_N{j}' in index: relevant.add((i,j))
        for a,b in zip(line.coords,list(line.coords)[1:]):
            if a!=b:
                geoms.append(LineString([a,b]));records.append((a,b,category(k),key))
    tree=STRtree(geoms); patches=defaultdict(dict); count=Counter()
    for i,j in sorted(relevant):
        tile=f'E{i}_N{j}'; e,n=i*T,j*T
        roads=json.loads((root/tile/'roads.json').read_bytes())['roads']
        cuts={}
        for r in roads:
            pts=r['pts']; k=category(r['cls'])
            if len(pts)<2 or k not in WALK|MOTOR: continue
            xy=[(e+p[0],n+p[1]) for p in pts]
            xs,ys=zip(*xy); tol=1.45 if k in WALK else 2.65
            nearby=tree.query(box(min(xs)-tol,min(ys)-tol,max(xs)+tol,max(ys)+tol))
            candidates=[records[z] for z in nearby if compatible(k,records[z][2])]
            if not candidates: continue
            spans=[]; distance=0
            line=LineString(xy)
            for a,b in zip(xy,xy[1:]):
                x0,x1=sorted((a[0],b[0])); y0,y1=sorted((a[1],b[1]))
                for u,v,_,key in candidates:
                    if max(u[0],v[0])<x0-tol or min(u[0],v[0])>x1+tol or max(u[1],v[1])<y0-tol or min(u[1],v[1])>y1+tol: continue
                    seg=overlaps(a,b,u,v,tol)
                    if seg: spans.append((distance+seg[0],distance+seg[1],key))
                distance+=hypot(b[0]-a[0],b[1]-a[1])
            joined=[]
            # 同方向平行／上下共線的道路，先用原圖磚對回 Overture 的 segment 身分。
            by_key=defaultdict(list)
            for a,b,key in spans: by_key[key].append((a,b))
            accepted=[]
            for key,items in by_key.items():
                runs=[]
                for a,b in sorted(items):
                    if runs and a<=runs[-1][1]+.85: runs[-1][1]=max(runs[-1][1],b)
                    else:runs.append([a,b])
                for a,b in runs:
                    if verify.belongs(line,(a+b)/2,r['cls'],{key}):accepted.append((a,b))
            for a,b in sorted(accepted):
                if joined and a<=joined[-1][1]+.85: joined[-1][1]=max(joined[-1][1],b)
                else: joined.append([a,b])
            hidden=[[round(a if a>.45 else 0,2),round(b if distance-b>.45 else distance,2)] for a,b in joined if b-a>=3 or b-a>=distance*.9]
            if hidden:
                cuts[geometry_key(r)]=hidden
                count['roadParts']+=len(hidden)
                count['meters']+=sum(b-a for a,b in hidden)
        if cuts:
            from landscape_tunnel_trees import restore_trees
            patch=patches[region(i,j)][tile]={'cuts':cuts}
            trees=restore_trees(root/tile,roads,cuts,geometry_key)
            if trees:patch['trees']=trees;count['restoredTrees']+=len(trees)
    for node,(x,y),dx,dy,width,wid in mouths:
        if ends[node]!=1: continue
        i,j=floor(x/T),floor(y/T); tile=f'E{i}_N{j}'
        if tile not in index: continue
        patch=patches[region(i,j)].setdefault(tile,{})
        known=wid in (29558599,29558611)
        patch.setdefault('portals',[]).append([round(x-i*T,2),round(y-j*T,2),round(dx,4),round(dy,4),9.04 if known else round(width,1)]+([6.22] if known else []))
        count['portals']+=1
    for key,data in patches.items(): write_json(OUT/(key+'.json'),data)
    write_json(OUT/'index.json',sorted(patches))
    count['tiles']=sum(len(v) for v in patches.values());count['meters']=round(count['meters'])
    with osmium.io.Reader(str(pbf)) as reader: stamp=reader.header().get('osmosis_replication_timestamp')
    write_json(OUT/'manifest.json',{'source':'https://download.geofabrik.de/asia/taiwan.html','license':'ODbL-1.0','time':stamp,'indexedTiles':len(index),'overture':source.name,'sourceGeometry':source_stats,**count})
    print(dict(count),flush=True)


if __name__=='__main__':
    cli=argparse.ArgumentParser(description=__doc__)
    cli.add_argument('pbf',type=Path);cli.add_argument('--tiles',type=Path,required=True)
    cli.add_argument('--overture',type=Path,required=True)
    cli.add_argument('--night-work',type=Path)
    args=cli.parse_args();build(args.pbf,args.tiles,args.overture,args.night_work)
