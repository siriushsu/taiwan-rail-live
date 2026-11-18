"""比對既有 3D 建物與地標的實際腳印，只補原圖磚缺少的獨立場館建物。"""
import json
from functools import lru_cache
from collections import Counter

import shapely
from shapely.geometry import Polygon

T = 1280
KINDS = {'school','kindergarten','university','college','mall','department','library','theme_park','stadium','museum'}


def fill_missing(buildings,detail,index,overlays):
    from build_landscape_places import tile_range,local_rings
    def polygon(rings,x,y):
        coords=[[(a+x*T,b+y*T) for a,b in ring] for ring in rings if len(ring)>=3]
        if not coords: return None
        p=Polygon(coords[0],coords[1:])
        return p if p.is_valid else p.buffer(0)
    protected=[]
    for (x,y),path in detail.items():
        if not index[path.name].get('stations'): continue
        for model in json.loads((path/'stations.json').read_bytes()):
            for part in model.get('footprint',[]):
                p=polygon([part.get('ring',[])],x,y)
                if p is not None and not p.is_empty: protected.append(p)
    mask=shapely.STRtree(protected)
    @lru_cache(maxsize=12)
    def native(x,y):
        features=json.loads((detail[x,y]/'buildings.json').read_bytes())
        shapes=[polygon(b.get('rings',[]),x,y) for b in features]
        return shapes,shapely.STRtree(shapes)
    counts=Counter()
    for g,p in sorted(buildings,key=lambda item:(item[0].centroid.x//T,item[0].centroid.y//T)):
        k=p['k']
        if k not in KINDS:continue
        c=g.representative_point();x,y=int(c.x//T),int(c.y//T)
        if (x,y) not in detail:continue
        if any(protected[j].intersection(g).area>.06*g.area for j in mask.query(g)):continue
        blocked=False
        for i,j in tile_range(g.bounds):
            if (i,j) not in detail:continue
            shapes,tree=native(i,j)
            if any(shapes[q].intersection(g).area>.05*min(shapes[q].area,g.area) for q in tree.query(g)):
                blocked=True; break
        if blocked:continue
        school=k in {'school','kindergarten','university','college'}
        mall=k in {'mall','department'}
        levels=p.get('levels'); height=p.get('h') or (levels or (3 if school or mall else 2))*(4.1 if mall else 3.5)
        color=p.get('wall') or ('#cec7af' if school else '#b5c0b9' if k=='library' else '#bfb8a8')
        model={'id':'place-'+p['id'],'type':'school' if school else 'hall','mark':'school' if school else 'mall' if mall else k,
               'rings':local_rings(g,x,y),'h':round(height,1),'floors':levels or max(1,round(height/3.65)),
               'wall':color,'color':color,'roof':'gable' if p.get('shape')=='gabled' else 'flat',
               'style':'town','illustrative':not (levels or p.get('h'))}
        if p.get('roof'):model['sceneRoof']=p['roof']
        tile=overlays[f'{x//8}_{y//8}'].setdefault(detail[x,y].name,{})
        others=tile.setdefault('additional',[])
        if any(b['rings']==model['rings'] for b in others): continue
        others.append(model);counts[k]+=1
    return counts
