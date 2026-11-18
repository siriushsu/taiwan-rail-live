"""核對過的屋面與街屋相交時，保留街廓中其餘的建物。"""
import json
from collections import defaultdict
from shapely.ops import split
from shapely.geometry import LineString

import shapely
from shapely.geometry import Polygon


def load_sites():
    from build_landscape_places import OUT, PROJECT
    sites = json.loads((OUT/'heritage.json').read_bytes())['sites']
    for site in sites:
        for part in site['parts']:
            part['geom'] = Polygon([PROJECT(*ll) for ll in part['ring']])
    return sites


def site_mask(site):
    roofs=shapely.union_all([p['geom'] for p in site['parts']])
    joined=roofs.buffer(2.5,join_style='mitre').buffer(-2,join_style='mitre')
    from build_landscape_places import polygons
    mask=shapely.union_all([Polygon(p.exterior) for p in polygons(joined)])
    # 這些院落的正殿、前殿及兩側護龍均已在正射影像中核對。
    compounds={'艋舺清水巖','新埔褒忠亭','大稻埕慈聖宮','彰化孔子廟','鹿港文武廟','聖王廟','中港慈裕宮','五股西雲寺','旗山天后宮','官澳龍鳳宮','慈德宮','社頭清水岩'}
    if site['name'] in compounds:
        mask=mask.union(shapely.concave_hull(roofs,ratio=.65))
    return roofs,mask


def street_fragments(poly):
    # 地景房屋生成器取外圈加牆。先沿天井分開，不讓只有外圈的樓體把洞再蓋滿。
    from build_landscape_places import polygons
    if not poly.interiors:
        yield poly
        return
    cy=Polygon(poly.interiors[0]).representative_point().y
    a,_,b,_=poly.bounds
    for piece in polygons(split(poly,LineString([(a-1,cy),(b+1,cy)]))):
        yield from street_fragments(piece)


def integrate(sites, parts, detail, overlays):
    from build_landscape_places import T, local_rings, polygons, region, tile_range
    groups = []
    tile_masks = defaultdict(list)
    for site in sites:
        roofs,mask = site_mask(site)
        groups.append((site, roofs, mask))
        for x,y in tile_range(mask.buffer(100).bounds):
            if (x,y) in detail:
                tile_masks[x,y].append(mask)
        for part in site['parts']:
            g = part['geom']; center = g.centroid
            x,y = int(center.x//T), int(center.y//T)
            if (x,y) not in detail:
                continue
            tile = overlays[region(x,y)].setdefault(detail[x,y].name,{})
            tile.setdefault('heritageHalls',[]).append({
                **{k:part[k] for k in ('name','style','height','wall','roof')},
                **{k:part[k] for k in ('ridgeMotif','ridgeColor') if k in part},
                'ridge':part.get('ridge',0), 'id':site['id'], 'ring':local_rings(g,x,y)[0],
            })
    tree = shapely.STRtree([mask for _,_,mask in groups])
    for key,(g,p) in list(parts.items()):
        for i in tree.query(g):
            site,roofs,mask = groups[i]
            overlap = g.intersection(roofs).area
            if mask.intersection(g).area > .60*g.area or overlap > .42*g.area or (overlap > .34*roofs.area and mask.distance(g.centroid) < 6):
                del parts[key]
                break

    for (x,y),masks in tile_masks.items():
        mask = shapely.union_all(masks)
        tile = overlays[region(x,y)].setdefault(detail[x,y].name,{})
        skipped = set(tile.get('suppressed',[]))
        native = json.loads((detail[x,y]/'buildings.json').read_bytes())
        additions = tile.pop('additional',[])
        remaining = []
        def trim(rows,original):
            for row in rows:
                rings = row.get('rings')
                if not rings or len(rings[0])<3 or row.get('type')=='bridge' or row['id'] in skipped:
                    if not original: remaining.append(row)
                    continue
                coords = [[(a+x*T,b+y*T) for a,b in ring] for ring in rings if len(ring)>=3]
                g = Polygon(coords[0],coords[1:]).buffer(0)
                hit = g.intersection(mask).area
                if hit < max(2.5,.012*g.area):
                    if not original: remaining.append(row)
                    continue
                if original: skipped.add(row['id'])
                if hit > .73*g.area or (row.get('type')=='temple' and hit>.14*g.area): continue
                for i,rest in enumerate(fragment for piece in polygons(g.difference(mask)) for fragment in street_fragments(piece)):
                    if rest.area>=5:
                        remaining.append({**row,'id':f"{row['id']}-h{i}",'rings':local_rings(rest,x,y)})
        trim(native,True)
        trim(additions,False)
        if skipped:tile['suppressed']=sorted(skipped)
        if remaining:tile['additional']=remaining
    return groups


def add_regional_context(sites, detail, cache, add):
    """沒有近景圖磚的廟口，補足既有街廓圖中尚未描出的鄰房。"""
    import math
    from functools import lru_cache
    import mapbox_vector_tile as mvt
    import numpy as np
    from pyproj import Transformer
    from shapely.geometry import shape
    from shapely.ops import transform
    from build_landscape_places import OUT, T, polygons
    from landscape_heritage_footprints import building_tiles
    size=40075016.68557849/16384
    half=size*8192
    merc=Transformer.from_crs(3826,3857,always_xy=True).transform
    local=Transformer.from_crs(3857,3826,always_xy=True).transform
    source=next(iter(detail.values())).parents[1]/'cache'/'overture-2026-10-21.0'
    buildings=building_tiles(source,cache/'heritage-buildings')
    @lru_cache(maxsize=8)
    def streets(x,y):
        path=OUT/'library-context'/f'{x}-{y}.pbf'
        if not path.is_file():return None
        layer=mvt.decode(path.read_bytes()).get('building',{})
        scale=size/layer.get('extent',4096)
        def to_local(a,b):
            return local(x*size-half+np.asarray(a)*scale,half-(1+y)*size+np.asarray(b)*scale)
        return shapely.STRtree([transform(to_local,shape(f['geometry'])).buffer(0) for f in layer.get('features',[])])
    seen=set();count=0
    for site in sites:
        roofs,mask=site_mask(site)
        c=roofs.centroid
        if (int(c.x//T),int(c.y//T)) in detail:continue
        precinct=roofs.buffer(95)
        for shell,p in buildings(precinct):
            ident=p['id']
            if ident in seen:continue
            c=shell.centroid
            if (int(c.x//T),int(c.y//T)) in detail:continue
            e,n=merc(c.x,c.y)
            street=streets(int((e+half)//size),int((half-n)//size))
            if street is None:continue
            overlap=street.query(shell,predicate='intersects')
            h=p.get('height') or (p.get('num_floors') or 2)*3.2
            if not isinstance(h,(int,float)) or not math.isfinite(h) or not 1<h<300:h=6.4
            # OFM 要素常含多個獨立樓棟；只扣這棟實際重合的面積。
            cut=shapely.union_all([mask,*[street.geometries[j].intersection(shell) for j in overlap]])
            remaining=shell.difference(cut)
            if remaining.area<.23*shell.area:continue
            seen.add(ident)
            for g in polygons(remaining):
                if g.area>8:
                    add('buildings',g,{'k':'context','near':0,'h':round(h,1),'wall':'#bdb4a3'})
                    count+=1
    return count
