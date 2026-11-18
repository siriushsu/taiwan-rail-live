"""用台灣 Geofabrik .osm.pbf 產生地景的校園與大型場館。暫存環境需 osmium、shapely 2、pyproj、mapbox-vector-tile、pyshp。先從 data.gov.tw/dataset/174605 和 174606
將兩份 SHP ZIP 放入 cache，分別命名為 campuses-119.zip 和 campuses-121.zip。
廟宇資料使用以下公開端點；將原始回應依序存入同一 cache 的 temple-monuments.json、
temple-register.xml、religious-landscapes.json。
https://data.boch.gov.tw/opendata/v2/assetsCase/1.1.json
https://religion.moi.gov.tw/Report/temple.xml
https://taiwangods.moi.gov.tw/API/v2/Landscape?sortType=LOCATION&sortDesc=ASC
先執行 node scripts/fetch_landscape_temple_tiles.mjs 暫存目錄 地景母檔/cache/overture-2026-10-21.0 補外圍與離島建物。
用法：python scripts/build_landscape_places.py 台灣.osm.pbf --tiles 地景圖磚目錄 --cache 暫存目錄
"""
import argparse
from collections import Counter, defaultdict
import hashlib
import json
import math
from pathlib import Path
import re

import osmium
import shapely
from shapely.geometry import Point, LineString, Polygon, box
from shapely.ops import transform
from pyproj import Transformer
import mapbox_vector_tile

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'landscape-web' / 'places'
PROJECT = Transformer.from_crs(4326, 3826, always_xy=True).transform
MERCATOR = Transformer.from_crs(3826, 3857, always_xy=True).transform
LL = Transformer.from_crs(3826, 4326, always_xy=True).transform
FACTORY = osmium.geom.WKBFactory()
SITES = {'amenity': {'school': 'school', 'kindergarten': 'kindergarten', 'college': 'college', 'university': 'university', 'library':'library'},
         'shop': {'mall': 'mall', 'department_store': 'department'},
         'tourism': {'museum': 'museum', 'theme_park':'theme_park'}, 'leisure': {'stadium': 'stadium','playground':'playground','water_park':'theme_park'}}
SCHOOLS = {'school', 'kindergarten', 'college', 'university'}
MALLS = {'mall', 'department'}
SPORTS = {'basketball', 'tennis', 'volleyball', 'soccer', 'baseball', 'athletics', 'running'}
T = 1280
VECTOR_ZOOM = 12
WORLD = 20037508.342789244
SPAN = 2*WORLD/(2**VECTOR_ZOOM)
DUMP = {'ensure_ascii': False, 'separators': (',', ':')}


def series(items, path):
    with path.open('w') as f:
        for geom, props in items:
            f.write(json.dumps([geom.wkb_hex, props], **DUMP) + '\n')


def restore(path):
    with path.open() as f:
        for line in f:
            geom, props = json.loads(line)
            yield shapely.from_wkb(bytes.fromhex(geom)), props


def polygons(g):
    if g.geom_type == 'Polygon':
        yield g
    elif hasattr(g, 'geoms'):
        for p in g.geoms:
            yield from polygons(p)


def area(obj):
    try:
        g = shapely.from_wkb(bytes.fromhex(FACTORY.create_multipolygon(obj)))
    except (RuntimeError, ValueError):
        return None
    if g.is_empty:
        return None
    return transform(PROJECT, g if g.is_valid else g.buffer(0))


def osmref(obj):
    if obj.is_area():
        return ('w' if obj.from_way() else 'r') + str(obj.orig_id())
    return obj.type_str() + str(obj.id)


def facts(tags):
    props = {}
    for key, dest, limit in [('height', 'h', 550), ('building:levels','levels', 120), ('min_height','base', 500)]:
        value = tags.get(key, '').strip()
        if re.fullmatch(r'\d+(?:\.\d+)?(?:\s*m)?', value):
            n = float(value.rstrip('m '))
            if 0 < n <= limit:
                props[dest] = n
    for key, dest in [('building:colour','wall'), ('roof:colour','roof')]:
        color = tags.get(key, '')
        if re.fullmatch(r'#[a-fA-F0-9]{6}', color):
            props[dest] = color
        elif color.lower() in ('black','white','grey','gray','brown','red','green','blue'):
            props[dest]={'black':'#454544','white':'#e7e4dc','grey':'#898b87','gray':'#898b87','brown':'#896c55','red':'#9f6054','green':'#688375','blue':'#627f98'}[color.lower()]
    if tags.get('roof:shape')=='gabled': props['shape']='gabled'
    return props


def extract_sites(pbf, cache):
    sites, fields = [], []
    filters = [(key, v) for key, vals in SITES.items() for v in vals] + [('leisure', 'pitch'), ('leisure','track')]
    for obj in osmium.FileProcessor(pbf).with_areas().with_filter(osmium.filter.TagFilter(*filters)):
        t = obj.tags
        if not obj.is_area() and not obj.is_node() and not (obj.is_way() and t.get('leisure') == 'track' and not obj.is_closed()):
            continue
        kind = next((vals[t[key]] for key, vals in SITES.items() if t.get(key) in vals), None)
        if kind:
            if obj.is_way() or t.get('location') == 'underground' or (kind == 'playground' and t.get('indoor') == 'yes'):
                continue
            g = area(obj) if obj.is_area() else Point(*PROJECT(obj.location.lon, obj.location.lat))
            if g is None:
                continue
            name = t.get('name:zh-Hant') or t.get('name:zh') or t.get('name', '')
            # 避開只有「百貨」字樣的小型日用品店。
            if kind == 'department' and re.search('五金|生活百貨|家庭百貨|汽車百貨|十元|十圓|百貨行|百貨商行', name):
                continue
            sites.append((g, {'k': kind, 'name': name, 'id': osmref(obj)}))
        elif not obj.is_node() and not t.get('indoor') == 'yes' and not t.get('location') in ('roof', 'rooftop', 'indoor', 'underground') and t.get('layer', '0') == '0' and t.get('level','0') == '0':
            sport = t.get('sport', '')
            k = 'track' if t.get('leisure') == 'track' else sport if sport in SPORTS else 'pitch'
            if obj.is_area():
                g = area(obj)
                if g is None:
                    continue
                if k == 'track' and t.get('area') != 'yes' and all(not p.interiors for p in polygons(g)):
                    g = g.boundary
            else:
                try:
                    g = transform(PROJECT, shapely.from_wkb(bytes.fromhex(FACTORY.create_linestring(obj))))
                except RuntimeError:
                    continue
            # 跑道只有中心線時沿實際路徑鋪面，中間不填滿。
            if 'LineString' in g.geom_type:
                width = t.get('width', '')
                width = float(width) if re.fullmatch(r'\d+(?:\.\d+)?', width) else 3.5
                g = g.buffer(min(12,max(1,width))/2, quad_segs=3)
            fields.append((g, {'k': k, 'id': osmref(obj), 'surface': t.get('surface','')}))
    series(sites, cache / 'sites.jsonl')
    series(fields, cache / 'fields.jsonl')


def extract_buildings(pbf, sites, cache):
    areas = [(g,p) for g,p in sites if g.area]
    zones = shapely.STRtree([g for g,p in areas])
    points = [(g,p) for g,p in sites if not g.area and p['k'] in MALLS]
    point_tree = shapely.STRtree([g for g,p in points])
    # 只解碼地點周邊的建物。多邊形的中庭與分離環由 osmium 組裝。
    grid = set()
    for g,p in sites:
        a,b,c,d = transform(LL, g).bounds
        for i in range(math.floor(a*100)-1,math.floor(c*100)+2):
            for j in range(math.floor(b*100)-1,math.floor(d*100)+2):
                grid.add((i,j))
    def candidates():
        for obj in osmium.FileProcessor(pbf).with_areas().with_filter(osmium.filter.EntityFilter(osmium.osm.AREA)).with_filter(osmium.filter.KeyFilter('building')):
            t = obj.tags
            build = t.get('building', '')
            if build in {'transportation','subway_entrance','no','construction','ruins','roof','shed','garage','garages','service','greenhouse','toilets','carport','hut','parking','transformer_tower'} or t.get('location') == 'underground' or re.match(r'^-\d',t.get('layer','0')) or re.match(r'^-\d',t.get('level','0')):
                continue
            first = next(iter(obj.outer_rings()), None)
            if first is None or (math.floor(first[0].lon*100), math.floor(first[0].lat*100)) not in grid:
                continue
            g = area(obj)
            if g is None:
                continue
            for poly in polygons(g):
                if poly.area < 35:
                    continue
                # 點狀商場須確實落在大樓內；排除商場內登錄的小型專櫃。
                hits = [points[i][1] for i in point_tree.query(poly, predicate='contains') if poly.area >= 350]
                owners = [areas[i] for i in zones.query(poly.representative_point(), predicate='within')]
                owners.sort(key=lambda v: v[0].area)
                if not hits and not owners:
                    continue
                site = hits[0] if hits else next((p for region,p in owners if region.covers(poly) or region.intersection(poly).area >= poly.area*.85), None)
                if not site:
                    continue
                k = site['k']
                if k in SCHOOLS and build in {'hospital','church','temple','dormitory','apartments','residential','retail','commercial','industrial','sports_hall','stadium','train_station'}:
                    k = 'other'
                yield poly, dict(k=k, site=site['id'], id=osmref(obj), **facts(t))
    series(candidates(), cache/'buildings.jsonl')

# 大型商業設施也常只標在建物或零售用地上。館內餐廳、櫃位與地下入口不能當成整棟百貨。
MALL_NAME = re.compile(r'^(?:MITSUI (?:OUTLET|SHOPPING)|LaLaport|三井(?:購物|.*OUTLET)|遠東(?:百貨|SOGO|巨城)|新光三越|漢神(?:巨蛋|洲際|百貨)|中友百貨|麗寶\s*(?:OUTLET|摩天)|台北101購物中心|臺北101購物中心|南紡購物中心|美麗華百樂園|夢時代購物中心|宏匯廣場|大江(?:國際)?購物中心|統一時代百貨|微風(?:廣場|南山|信義|松高|南京)|義大世界購物廣場|(?:臺中|台中)?大遠百|遠百(?:信義|竹北)|環球購物中心|尚順購物中心|臺中港三井|台中港三井)', re.I)
TENANT = re.compile(r'入口|電扶梯|停車|餐廳|客服|服務台|專櫃|影城|接駁|施工中|\(廢\)|已歇業|美食街|捷運站|五金|小北百貨|寶雅|大創|鐘錶店|全聯|皮件|合作社|便利商店|生活百貨|文具店|安全帽|茶莊|輪胎|美髮|代購|福利站|全國電子|無印良品|7.eleven',re.I)
BIG_RETAIL = re.compile(r'百貨|購物|廣場|廣塲|商場|商業大樓|outlet|mall|plaza|citylink|sogo|lalaport|誠品|秀泰|新光三越|大遠百|遠百|夢時代|大葉高島屋|大魯閣|統領|大江|微風|漢神|美麗華|南紡|美麗新|裕隆城|尚順|三井|遠企|三創|光華數位|台鋁|台茂|老虎城|新天地|金典綠園道|新天堂樂園|禮客|大立|日曜天地|耐斯|京站|ATT 4 FUN|三號港|FOCUS|享平方|NOVA|東協廣場|西門新宿',re.I)


def extra_malls(pbf, sites):
    seen = {p['id'] for g,p in sites}
    for o in osmium.FileProcessor(pbf).with_areas().with_filter(osmium.filter.EntityFilter(osmium.osm.AREA)).with_filter(osmium.filter.KeyFilter('name', 'name:zh')):
        t = o.tags
        if not (t.get('building') in ('yes','retail','commercial','mall','department_store') or t.get('landuse') == 'retail'):
            continue
        n = t.get('name:zh-Hant') or t.get('name:zh') or t.get('name','')
        if not MALL_NAME.search(n) or TENANT.search(n) or osmref(o) in seen:
            continue
        g = area(o)
        if g is not None and g.area >= 500:
            sites.append((g, {'k': 'mall', 'name': n, 'id': osmref(o)}))


def normalize(n):
    return re.sub(r'[ ()（）\s]|國立|市立|縣立|私立|臺灣省','',n.replace('台','臺')).replace('國民小學','國小').replace('國民中學','國中').replace('高級中學','高中')


def official_sites(sites, cache):
    import shapefile
    from shapely.geometry import shape
    result = []
    for zone in (119,121):
        with shapefile.Reader(str(cache/f'campuses-{zone}.zip')) as r:
            for row in r.iterShapeRecords():
                n = re.sub(r'(?<=[學校園])\d+$','',row.record['BLOCKNAME'].strip())
                g = shape(row.shape.__geo_interface__)
                if zone == 119:
                    g = transform(Transformer.from_crs(3825,3826,always_xy=True).transform,g)
                if not g.is_valid:
                    g = g.buffer(0)
                k = 'kindergarten' if re.search('幼兒園|幼稚園',n) else 'university' if re.search('大學|學院|專科學校',n) and not re.search('附屬|附設|附属|附小|附中',n) else 'school'
                result.append((g, {'k': k, 'name': n, 'id': f'campus-{zone}-{row.record["OBJECTID"]}'}))
    national = shapely.STRtree([g for g,p in result])
    for g,p in sites:
        if p['k'] in SCHOOLS:
            key = normalize(p['name'])
            duplicates = []
            named_match = False
            for i in national.query(g.buffer(35)):
                q, rec = result[i]
                other = normalize(rec['name'])
                same = bool(key and other and (key in other or other in key))
                named_match |= same
                if same or (p['k'] != 'kindergarten' and rec['k'] != 'kindergarten' and g.area and q.intersection(g).area > .75*min(q.area,g.area)):
                    duplicates.append(q)
            if duplicates:
                # 官方資料可能只收主校區；OSM 有畫到的分校地繼續保留。
                if g.area and g.difference(shapely.union_all(duplicates)).area > .45*g.area:
                    result.append((g,p))
                elif key and not named_match:
                    result.append((g.representative_point(),p))
                continue
        elif p['k'] in MALLS:
            p['name'] = re.sub(r'^name\s*=\s*','',p['name'])
            if TENANT.search(p['name']) or not (BIG_RETAIL.search(p['name']) or g.area >= 1800):
                continue
        result.append((g,p))
    return result


def tile_range(bounds, size=T):
    a,b,c,d = bounds
    for x in range(math.floor(a/size),math.floor(c/size)+1):
        for y in range(math.floor(b/size),math.floor(d/size)+1):
            yield x,y


def court_lines(poly, k):
    # 多球場合併面、帶洞或不規則場地不猜分場。可辨識的單場沿長邊畫中線、邊線及場內標線。
    if k not in ('basketball','tennis','volleyball','soccer') or poly.interiors:
        return []
    rect = poly.minimum_rotated_rectangle
    if poly.area < rect.area*.92:
        return []
    pts = list(rect.exterior.coords)
    edges = [LineString(pts[i:i+2]).length for i in (0,1)]
    if min(edges) < 1:
        return []
    i = int(edges[1] > edges[0])
    length, width = max(edges),min(edges)
    lo,hi,wlo,whi = {'basketball':(23,34,12,20),'tennis':(21,37,9,20),'volleyball':(16,23,8,13),'soccer':(70,126,42,86)}[k]
    if not (lo <= length <= hi and wlo <= width <= whi):
        return []
    u = [(pts[i+1][j]-pts[i][j])/length for j in (0,1)]
    v = [-u[1],u[0]]
    c = rect.centroid
    def ll(x,y):
        return (c.x+u[0]*x+v[0]*y,c.y+u[1]*x+v[1]*y)
    l = min(length-1,{'basketball':28,'tennis':23.77,'volleyball':18,'soccer':105}[k])/2
    w = min(width-1,{'basketball':15,'tennis':10.97,'volleyball':9,'soccer':68}[k])/2
    segs = [[(-l,-w),(l,-w),(l,w),(-l,w),(-l,-w)],[(0,-w),(0,w)]]
    if k in ('basketball','soccer'):
        radius = 1.8 if k == 'basketball' else 9.15
        segs.append([(radius*math.cos(t*math.pi/16),radius*math.sin(t*math.pi/16)) for t in range(33)])
        reach,half = (5.8,2.45) if k == 'basketball' else (16.5,20.16)
        for s in (-1,1):
            segs.append([(s*l,-half),(s*(l-reach),-half),(s*(l-reach),half),(s*l,half)])
    elif k == 'tennis':
        for s in (-1,1):
            segs.extend([[(-l,s*w*.75),(l,s*w*.75)],[(s*6.4,-w*.75),(s*6.4,w*.75)]])
        segs.append([(-6.4,0),(6.4,0)])
    else:
        segs.extend([[(-3,-w),(-3,w)],[(3,-w),(3,w)]])
    return [LineString([ll(x,y) for x,y in seg]) for seg in segs]


def write_json(path,data):
    path.parent.mkdir(parents=True,exist_ok=True)
    path.write_text(json.dumps(data,**DUMP)+'\n')


def local_rings(poly,x,y):
    return [[[round(a-x*T,1),round(b-y*T,1)] for a,b in list(r.coords)[:-1]] for r in [poly.exterior,*poly.interiors]]


def region(x,y):
    return f'{x//8}_{y//8}'


def build(pbf, tile_root, cache):
    cache.mkdir(parents=True,exist_ok=True)
    extract_sites(pbf,cache)
    raw = list(restore(cache/'sites.jsonl'))
    extra_malls(pbf,raw)
    sites = official_sites(raw,cache)
    extract_buildings(pbf,sites,cache)
    buildings = list(restore(cache/'buildings.jsonl'))
    fields = list(restore(cache/'fields.jsonl'))
    zones = [(g,p) for g,p in sites if g.area]
    zone_index = shapely.STRtree([g for g,p in zones])
    b_index = shapely.STRtree([g for g,p in buildings])
    known = {p['id']:p for g,p in sites}
    original = json.loads((tile_root/'index.json').read_bytes())['tiles']
    detail = {tuple(map(int,re.fullmatch(r'E(-?\d+)_N(-?\d+)',key).groups())):tile_root/key for key in original}
    point_libs = [(g,p) for g,p in sites if not g.area and p['k']=='library']
    lib_tree = shapely.STRtree([g for g,p in point_libs])
    site_coverage = Counter()
    for g,p in sites:
        if any((x,y) in detail and g.intersects(box(x*T,y*T,(x+1)*T,(y+1)*T)) for x,y in tile_range(g.bounds)):
            site_coverage[p['k']] += 1
    overlays = defaultdict(dict)
    vtiles = defaultdict(lambda:defaultdict(list))
    counts = Counter()
    def add(layer,g,p):
        g = transform(MERCATOR,g)
        h,span = WORLD,SPAN
        a,b,c,d = g.bounds
        for x in range(math.floor((a+h)/span),math.floor((c+h)/span)+1):
            for y in range(math.floor((h-d)/span),math.floor((h-b)/span)+1):
                west,north = -h+x*span,h-y*span
                clipped = g.intersection(box(west,north-span,west+span,north))
                parts = list(polygons(clipped)) if 'Polygon' in g.geom_type else [clipped]
                for part in parts:
                    if not part.is_empty and part.geom_type in ('Point','Polygon','LineString','MultiLineString'):
                        vtiles[x,y][layer].append({'geometry':part,'properties':p})
    # 同一地址的館名、同一校區分成多筆圖斑，各自只放一個文字錨點。
    named = defaultdict(list)
    for g,p in sorted(sites,key=lambda v:-v[0].area):
        if g.area:
            add('grounds',g,{'k':p['k']})
        n = p['name']
        if not n:
            continue
        label = g.representative_point()
        name = normalize(n)
        if any(t.distance(label)<190 for t in named[name]):
            continue
        named[name].append(label)
        add('names',label,{'k':p['k'],'name':n,'major':int(p['id'] in ('w239754110','w1396499206'))})
        counts['name_'+p['k']] += 1
    from landscape_library_models import library_parts, clean_context_tiles, CONTEXT_SOURCE
    libraries = [(g,p) for g,p in sites if p['id'] in ('w239754110','w1396499206') and g.area]
    from landscape_reviewed_temples import load_sites
    clean_context_tiles(libraries,cache,OUT/'library-context',load_sites())
    for g,p in libraries:
        for poly in polygons(g):
            for part,props in library_parts(poly,p['id']=='w1396499206'):
                add('architecture',part,props)
    for g,p in buildings:
        if any(g.intersection(lib).area > .7*min(g.area,lib.area) for lib,_ in libraries if g.intersects(lib)):
            continue
        center = g.representative_point()
        near = (math.floor(center.x/T), math.floor(center.y/T)) in detail
        k = p['k']
        h = p.get('h',p.get('levels',0)*3.5) or (13 if k in MALLS else 9 if k in SCHOOLS else 8)
        add('buildings',g,{'k':k,'h':round(h,1),'near':int(near), **({'wall':p['wall']} if 'wall' in p else {})})
    for xy,path in sorted(detail.items()):
        x,y = xy
        b = box(x*T,y*T,(x+1)*T,(y+1)*T)
        if not len(zone_index.query(b)) and not len(b_index.query(b)) and not len(lib_tree.query(b)):
            continue
        edits = {}
        for src in json.loads((path/'buildings.json').read_bytes()):
            if src['type'] not in ('townhouse','apartment','hall','school') or src.get('mark') not in (None,'','school','kindergarten'):
                continue
            rings = src.get('rings')
            if not rings or len(rings[0])<3:
                continue
            bounds = [(a+x*T,b+y*T) for a,b in rings[0]]
            xs,ys = zip(*bounds)
            envelope = box(min(xs),min(ys),max(xs),max(ys))
            library_hits = lib_tree.query(envelope)
            if not len(zone_index.query(envelope)) and not len(b_index.query(envelope)) and not len(library_hits): continue
            shell = Polygon(bounds,[[(a+x*T,b+y*T) for a,b in r] for r in rings[1:] if len(r)>=3])
            if not shell.is_valid: shell=shell.buffer(0)
            if shell.is_empty or shell.area<45: continue
            hits = b_index.query(shell.representative_point(),predicate='within')
            fact = next((buildings[j][1] for j in hits if buildings[j][0].intersection(shell).area >= .8*max(shell.area,buildings[j][0].area)),None)
            if fact and fact['k']=='other': continue
            site = known.get(fact['site']) if fact else None
            if not site:
                owners = sorted(zone_index.query(shell.representative_point(),predicate='within'),key=lambda j:zones[j][0].area)
                site = next((zones[j][1] for j in owners if zones[j][0].covers(shell) or zones[j][0].intersection(shell).area>=.92*shell.area),None)
            # 分館設在校舍、機關、住宅或商場時，只保留已知的館名。獨立公共分館才替換推估樓型。
            if site is None:
                site = next((point_libs[j][1] for j in library_hits if shell.covers(point_libs[j][0]) and
                    src.get('illustrative') and 70 < shell.area < 4000 and
                    re.search(r'圖書館.*(?:分館|圖書館)$|(?:市立|鄉立|鎮立|縣立|區立).{0,12}圖書館$',point_libs[j][1]['name']) and
                    not re.search(r'大學|醫院|校區|活動中心|區公所|學院',point_libs[j][1]['name'])),None)
            if not site or site['k'] not in SCHOOLS|MALLS|{'library'}: continue
            # 已經單獨調色的校舍留原貌。站房、醫院等複合設施裡的商場只標館名。
            k = 'school' if site['k'] in SCHOOLS else 'mall' if site['k'] in MALLS else 'library'
            if k == 'mall' and (shell.area < 450 or re.search('車站|醫院|三總|研究院',site['name'])): continue
            edit = {'k':k}
            if fact: edit.update({key:fact[key] for key in ('wall','roof','h','levels') if key in fact})
            if src['type']=='school' and len(edit)==1: continue
            edits[src['id']] = edit
            counts[k+'Facades'] += 1
        if edits:
            overlays[region(x,y)].setdefault(path.name,{})['buildings']=edits
            counts['facades']+=len(edits)
    for g,p in sites:
        if p['k']=='playground' and g.area:
            fields.append((g,dict(p, surface='')))
    for g,p in fields:
        hits = zone_index.query(g.representative_point(),predicate='within')
        if p['k']!='playground' and not any(zones[j][1]['k'] in SCHOOLS|{'stadium','theme_park'} for j in hits): continue
        counts['playAreas' if p['k']=='playground' else 'fields']+=1
        for poly in polygons(g):
            nccu = p['id']=='r4655429' and p['k']=='track' and len(poly.interiors)==1
            if nccu:
                infield = Polygon(poly.interiors[0])
                lines = []
                for lane in range(9):
                    stripe = infield.buffer(lane*1.22).boundary.intersection(poly) if lane else LineString(poly.interiors[0])
                    lines.extend([stripe] if stripe.geom_type=='LineString' else [v for v in getattr(stripe,'geoms',[]) if v.geom_type=='LineString'])
            else:
                lines = court_lines(poly,p['k'])
            counts['markedCourts']+=bool(lines)
            # 完整場地先算線，再依圖磚裁切，跨圖磚不會多畫一套中線。
            surface=p.get('surface','')
            color=surface if p['k']!='track' and surface in ('grass','clay','sand','asphalt') else p['k']
            features=[(poly,'track-blue' if nccu else color)]
            features.extend((line.buffer(.075 if nccu else .12,cap_style=2,join_style=2),'line') for line in lines)
            for geom,kind in features:
                for x,y in tile_range(geom.bounds):
                    patch = geom.intersection(box(x*T,y*T,(x+1)*T,(y+1)*T))
                    for part in polygons(patch):
                        if part.area<.02: continue
                        near = (x,y) in detail
                        if near:
                            tile = overlays[region(x,y)].setdefault(f'E{x}_N{y}',{})
                            tile.setdefault('surfaces',[]).append([kind,local_rings(part,x,y)])
                        # 米級向量圖磚用線幾何畫細線，避免窄面量化後消失。
                        if kind!='line':
                            add('fields',part,{'k':kind,'near':int(near)})
            for line in lines:
                for x,y in tile_range(line.bounds):
                    part=line.intersection(box(x*T,y*T,(x+1)*T,(y+1)*T))
                    if part.geom_type in ('LineString','MultiLineString') and not part.is_empty:
                        add('lines',part,{'near':int((x,y) in detail)})
    # 跑道西側這筆舊棚架的 16 平方公尺全部壓在跑道上；場外司令台、體育館與校舍保留。
    nccu_tile = overlays[region(240,2159)]['E240_N2159']
    nccu_tile['suppressed']=['988144e8-2d27-43aa-b1d4-ce55fd0d40d4']
    from landscape_facility_footprints import fill_missing
    missing = fill_missing(buildings,detail,original,overlays)
    from landscape_play_equipment import add_equipment
    counts.update(add_equipment(pbf,detail,overlays))
    from landscape_temples import add_temple_scenes
    temples = add_temple_scenes(pbf,cache,detail,original,overlays,add)
    for key,patch in sorted(overlays.items()):
        write_json(OUT/'detail'/f'{key}.json',patch)
    write_json(OUT/'detail'/'index.json',sorted(overlays))
    h,span = WORLD,SPAN
    # 空海域與無場館區由圖磚索引指向同一份空圖磚，避免發佈數千份重複空檔。
    coverage=defaultdict(list)
    for x,y in sorted(vtiles):
        coverage[x].append(y)
    write_json(OUT/'vector'/str(VECTOR_ZOOM)/'index.json',dict(coverage))
    for (x,y),layers in sorted(vtiles.items()):
        west,north=-h+x*span,h-y*span
        packed = mapbox_vector_tile.encode([{'name':k,'features':v} for k,v in layers.items()] or [{'name':'names','features':[]}],default_options={'quantize_bounds':(west,north-span,west+span,north),'extents':32768})
        dest=OUT/'vector'/str(VECTOR_ZOOM)/str(x)/f'{y}.pbf'
        dest.parent.mkdir(parents=True,exist_ok=True)
        dest.write_bytes(packed)
    with osmium.io.Reader(str(pbf)) as r:
        stamp=r.header().get('osmosis_replication_timestamp')
    write_json(OUT/'manifest.json',{'osm':{'time':stamp,'source':'https://download.geofabrik.de/asia/taiwan.html','license':'ODbL-1.0'},'campuses':{'sources':['https://data.gov.tw/dataset/174606','https://data.gov.tw/dataset/174605'],'license':'OGDL-Taiwan-1.0','files':{z:hashlib.sha256((cache/f'campuses-{z}.zip').read_bytes()).hexdigest() for z in (119,121)}},'temples':{'counts':dict(temples),'officialSources':['https://data.gov.tw/dataset/6246','https://data.gov.tw/dataset/8203','https://data.gov.tw/dataset/32191'],'officialLicense':'OGDL-Taiwan-1.0','buildingSources':['https://www.openstreetmap.org/copyright','https://overturemaps.org','https://doi.org/10.5281/zenodo.8174931']},'additionalFootprints':dict(missing),'originalTileCount':len(detail),'sitesInOriginalTiles':dict(site_coverage),'trackRefs':{'r4655429':'https://www.nccu.edu.tw/p/405-1000-6340,c87.php?Lang=zh-tw'},'siteFeatures':len(sites),'officialCampusPolygons':sum(p['id'].startswith('campus-') for _,p in sites),'footprints':len(buildings),'libraryContextSource':CONTEXT_SOURCE,'architectureRefs':['https://lifetree.typl.gov.tw/','https://www.ksml.edu.tw/mainlibrary/content/index.aspx?Parser=1,23,165,156'],'counts':dict(counts)})
    print(dict(counts),flush=True)


if __name__=='__main__':
    cli=argparse.ArgumentParser(description=__doc__)
    cli.add_argument('pbf',type=Path)
    cli.add_argument('--tiles',type=Path,required=True)
    cli.add_argument('--cache',type=Path,required=True)
    args=cli.parse_args()
    build(args.pbf,args.tiles,args.cache)
