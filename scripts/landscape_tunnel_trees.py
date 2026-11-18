"""只在實際植被影像和鄰樹一致的洞身上方補回原道路遮罩抹去的樹點。"""
from collections import defaultdict
from math import floor,ceil
from random import Random
from struct import iter_unpack
from pathlib import Path
import json
from PIL import Image
from shapely.geometry import LineString,Point
from shapely.ops import substring
from shapely import STRtree


def restore_trees(path,roads,cuts,key_of):
    if not cuts:return []
    old=list(iter_unpack('<HHBBBBBB',(path/'trees.bin').read_bytes()))
    if len(old)<5:return []
    old_xy=[Point(v[0]/50,v[1]/50) for v in old]
    neighbors=STRtree(old_xy)
    ground=[]; buried=[]
    for road in roads:
        pts=road['pts']
        if len(pts)<2:continue
        line=LineString([p[:2] for p in pts]); w=road['w']/2
        spans=cuts.get(key_of(road),[]);cursor=0
        for a,b in spans:
            if a>cursor:ground.append(substring(line,cursor,a).buffer(w+2))
            # 洞口和短下穿維持開放，圖磚邊界以外的候選另由鄰磚負責。
            if b-a>30:buried.append(substring(line,a+12,b-12).buffer(w+.65,cap_style=2))
            cursor=b
        if cursor<line.length:ground.append(substring(line,cursor,line.length).buffer(w+2))
    if not buried:return []
    for station in json.loads((path/'rails.json').read_bytes()).get('tracks',[]):
        pts=station.get('pts',[]) if isinstance(station,dict) else []
        if len(pts)>=2:ground.append(LineString([p[:2] for p in pts]).buffer(5))
    avoid=STRtree(ground)
    with Image.open(path/'mask.png') as im:mask=im.convert('RGB')
    with Image.open(path/'sat.jpg') as im:sat=im.convert('RGB')
    result=[];visited=set()
    for poly in buried:
        a,b,c,d=poly.bounds
        for i in range(max(0,floor(a/7)),min(183,ceil(c/7))):
            for j in range(max(0,floor(b/7)),min(183,ceil(d/7))):
                if (i,j) in visited:continue
                rng=Random(path.name+':'+str(i)+','+str(j))
                x,y=(i+.1+.8*rng.random())*7,(j+.1+.8*rng.random())*7
                q=Point(x,y)
                if x>=1280 or y>=1280 or not poly.covers(q):continue
                visited.add((i,j))
                if len(avoid.query(q,predicate='intersects')):continue
                adj=neighbors.query(q,predicate='dwithin',distance=22)
                if len(adj)<3 or len(neighbors.query(q,predicate='dwithin',distance=4)):continue
                u,v=min(mask.width-1,int(x*mask.width/1280)),min(mask.height-1,int((1280-y)*mask.height/1280))
                foot,pond,coast=mask.getpixel((u,v))
                if foot>18 or pond>45 or coast>118:continue
                r,g,b=sat.getpixel((min(sat.width-1,int((x+10)/10)),min(sat.height-1,int((1290-y)/10))))
                green=(g-max(r,b))/(r+g+b+1)
                if green<.085 or rng.random()>min(.8,(green-.08)/.1,len(adj)*.035):continue
                template=old[adj[rng.randrange(len(adj))]]
                result.append([round(x*50),round(y*50),*template[2:5],r,g,b])
    return result
