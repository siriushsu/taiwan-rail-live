"""用宗教用途、建物外框與文資局寺廟紀錄辨識廟宇；寺廟院地不當成整棟建物。"""
import re
import math
import json
from pathlib import Path
from collections import Counter
import osmium
import shapely
from shapely.geometry import Point,Polygon,box
from shapely.ops import transform
from shapely.affinity import rotate

RELIGION={'taoist','buddhist','confucian','chinese_folk','chinese_folk_religion','folk','chinese','shinto'}
SHRINE_NAME=re.compile(r'寺|宮|神廟|城隍廟|祖廟|孔廟|武廟|文廟|古廟|祠|代天府|行天宮|佛光山|中台禪寺|法鼓山|佛堂|精舍|[殿廟庵壇堂]$')
EXCLUDE=re.compile(r'停車|活動中心|香客|餐廳|宿舍|紀念品|旅館|廁所|盥洗|派出所|分校|旅客|廟埕|交誼廳|辦公|停用|已拆|倉庫')
MODERN=re.compile(r'紀念館|行政|教學|圖書館|學院|大樓|博物館|苦行林|靈骨|納骨|禪修中心|關懷|精舍')
HALLS=re.compile(r'主殿|正殿|大雄寶殿|三川殿|三川門|山門|拜殿|天王殿|觀音殿|凌霄寶殿|後殿|圓通寶殿')


def read_temples(pbf,cache):
    from build_landscape_places import PROJECT,area,osmref,facts,series,restore
    sites=[];shells=[]
    for obj in osmium.FileProcessor(pbf).with_areas().with_filter(osmium.filter.KeyFilter('amenity','building','religion','historic')):
        if not (obj.is_node() or obj.is_area()):continue
        t=obj.tags
        build=t.get('building','');worship=t.get('amenity')=='place_of_worship'
        religion=t.get('religion','')
        if not (build in ('temple','shrine','pagoda') or worship or religion in RELIGION):continue
        name=t.get('name:zh-Hant') or t.get('name:zh') or t.get('name','')
        if build in ('church','mosque','cathedral','synagogue','chapel') or re.search('教會|教堂|清真寺|禮拜堂|基督|天主|猶太會堂',name):continue
        if religion and religion not in RELIGION or EXCLUDE.search(name) or t.get('location')=='underground':continue
        if not (religion in RELIGION or build in ('temple','shrine','pagoda') or SHRINE_NAME.search(name)):continue
        geom=area(obj) if obj.is_area() else Point(*PROJECT(obj.location.lon,obj.location.lat))
        if geom is None:continue
        props={'id':osmref(obj),'name':name,'k':'temple','worship':worship,'build':build,'religion':religion,**facts(t)}
        if build and build not in ('no','roof') and geom.area and geom.area<35000:
            shells.append((geom,props))
        if name and (worship or SHRINE_NAME.search(name)):
            sites.append((geom,props))
    series(sites,cache/'temple-sites.jsonl');series(shells,cache/'temple-shells.jsonl')
    return sites,shells


if __name__=='__main__':
    import sys
    s,b=read_temples(Path(sys.argv[1]),Path(sys.argv[2]))
    print(len(s),len(b),flush=True)

# 仿清水混凝土與現代禪院保留平實牆體；日式神社、禪堂及藏傳佛寺不共用閩南燕尾脊。
SPECIAL_FLAT = {'w499643791','w256791528'}
KEY_SITES = {'w183474386','w272806528','w221190489','w557132353','w147303082','r3020110','r3020111','r5425991','w340643018','w198401479','w543208705'}


def temple_surfaces(g,props,landmark):
    """沿實際輪廓長軸裁屋面，含洞的院落全程保留。每層的挑簷、收分與屋脊皆是實體。"""
    from build_landscape_places import polygons
    from shapely.affinity import scale
    rectangle=g.minimum_rotated_rectangle
    coords=list(rectangle.exterior.coords)
    a,b=max(zip(coords,coords[1:]),key=lambda pair:math.dist(*pair))
    angle=math.degrees(math.atan2(b[1]-a[1],b[0]-a[0]))
    center=g.centroid.coords[0];plan=rotate(g,-angle,origin=center)
    x0,y0,x1,y1=plan.bounds;span=y1-y0;length=x1-x0
    modern=props['id'] in SPECIAL_FLAT or MODERN.search(props['name']) or props.get('religion')=='shinto' or props.get('style')=='modern'
    h=props.get('h') or (props.get('levels') or 1)*(4.25 if modern else 4.6)
    if not props.get('h') and not props.get('levels') and not modern: h+=min(3.4,span*.10)
    if span<=1 or length<=1:return
    eave=round(h if modern else max(2.8,h*.85),2)
    wall=props.get('wall') or ('#bdc0b8' if modern else '#ab7860')
    roof=props.get('roof') or ('#a7aca5' if modern else '#555952' if props.get('style')=='japanese' else '#a66845')
    def part(poly,base,top,color):
        return (rotate(poly,angle,origin=center),{'base':round(base,2),'top':round(top,2),'color':color,'temple':props['id']})
    palms={'w471316484','w471316481','w526772902','w526772901','w526772903','w526772905','w526772904','w526772906'}
    sacred={'w1104439111','w1104439112','w1104439113','w1104439114'}
    if props['id'] in palms|sacred:
        roofs=7 if props['id'] in palms else 5
        tower_height=min(40,span*1.85);height=0
        yield part(plan,0,3.4,'#c5ad83')
        for level in range(roofs):
            f=1-level/(roofs+1);foot=scale(plan,.83*f,.83*f,origin='centroid')
            y=3.4+(tower_height-4)*level/roofs;step=(tower_height-4)/roofs
            yield part(foot,y,y+step*.72,'#c49368')
            for j in range(3):
                lip=scale(plan,f*(1-.13*j),f*(1-.13*j),origin='centroid')
                yield part(lip,y+step*(.72+.09*j),y+step*(.81+.09*j),'#7a7970')
        yield part(plan.centroid.buffer(.65),tower_height-.7,tower_height+3,'#ae9164')
        return
    if props['id']=='w287892695':
        # 中台禪寺沿用整座基座的實際輪廓，主軸上的塔樓、金頂與相輪合高 136m。
        # https://taiwangods.moi.gov.tw/html/Landscape/1_0011.aspx?i=51
        # https://ctworld.org.tw/chungtai/building/index3.htm
        stone='#c3ab91';pale='#d7c1a6';glass='#77888b';gold='#c6a04e'
        yield part(plan,0,15,stone)
        axis=plan.centroid
        for factor,base,top in [(0.88,15,22),(.71,22,30),(.55,30,40),(.39,40,52)]:
            deck=scale(plan,factor,factor,origin=axis)
            yield part(deck,base,top-1,pale);yield part(deck,top-1,top,stone)
        cx,cy=axis.coords[0]
        for side in (-1,1):
            foot=box(cx+side*length*.32-6,cy-6,cx+side*length*.32+6,cy+6)
            yield part(foot,19,31,pale)
            for i in range(5):
                cap=scale(foot,1.35-i*.14,1.35-i*.21,origin='centroid')
                yield part(cap,31+i*.6,31.6+i*.6,gold)
        for f,base,top,c in [(1,50,65,stone),(.86,65,83,pale),(.71,83,98,glass),(.57,98,105,pale)]:
            tower=box(cx-length*.105*f,cy-span*.125*f,cx+length*.105*f,cy+span*.125*f)
            yield part(tower,base,top,c)
            if c==glass:
                for side in (-1,1):
                    for end in (-1,1):
                        xx=cx+length*.1*f*side;yy=cy+span*.12*f*end
                        yield part(box(xx-.8,yy-.8,xx+.8,yy+.8),base,top,pale)
        for i,rad in enumerate([10,11.6,11.8,11.1,10.1,8.6,6.6,4.3,2.3]):
            yield part(axis.buffer(rad,quad_segs=12),105+i*1.75,106.75+i*1.75,gold)
        yield part(axis.buffer(.78),120.75,136,gold)
        for i in range(5):yield part(axis.buffer(2.6-i*.32),122+i*2.5,122.55+i*2.5,gold)
        return
    if props['id']=='w1134404747':
        yield part(plan,0,13,'#c6b896')
        for i in range(5):
            shape=scale(plan,.94-i*.116,.94-i*.116,origin='centroid')
            yield part(shape,13+i*3,16+i*3,'#c5b393')
        radius=span*.114
        for i in range(9):
            shell=plan.centroid.buffer(radius*math.sqrt(max(.03,1-(i/9)**2)),quad_segs=12)
            yield part(shell,28+i*1.65,29.65+i*1.65,'#c8b790')
        yield part(plan.centroid.buffer(.85),42.85,49,'#b2966e');return
    if props['id']=='w1134404756':
        yield part(plan,0,35,'#bcb293');yield part(plan,35,36,'#d8ccb0');return
    double=props['id'] in {'w1274037913','w1274037914','w1274037915','w1328736000'}
    # 北港三川與龍虎門、鹿港五門殿有史料可辨識的重簷。
    # https://www.matsu.org.tw/?act=menuinfo&ml_id=20240312010
    # https://taiwangods.moi.gov.tw/html/cultural/3_0011.aspx?i=10
    portico=double or (landmark and HALLS.search(props['name']) and not modern and not plan.interiors and length>7)
    if portico:
        inset=min(span*.15,1.5)
        inside=plan.buffer(-inset,join_style='mitre')
        yield part(plan,0,.4,'#aca394')
        if not inside.is_empty:yield part(inside,.4,eave,wall)
        for yy in (y0+inset*.6,y1-inset*.6):
            bays=max(2,round(length/3))
            for i in range(bays+1):
                xx=x0+inset+(length-2*inset)*i/bays
                pillar=Point(xx,yy).buffer(min(.32,inset*.29),quad_segs=4)
                if plan.covers(pillar):yield part(pillar,.4,eave,'#955445')
    else:yield part(plan,0,eave,wall)
    if double:
        for j in range(5):
            band=scale(plan,1-.036*j,1-.105*j,origin='centroid')
            yield part(band,eave+j*.30,eave+(j+1)*.30,roof)
        inner=scale(plan,.71,.54,origin='centroid')
        yield part(inner,eave+1.5,eave+2.35,wall)
        plan=scale(plan,.85,.72,origin='centroid');x0,y0,x1,y1=plan.bounds
        span=y1-y0;length=x1-x0;eave+=2.35
    if modern:
        yield part(plan,eave,eave+.35,roof)
        return
    rise=min(5.8,max(1.15,span*.24))
    # 截面分層逼近傳統瓦頂曲線。避免把大院地的天井封成整塊山牆。
    previous=eave;steps=7 if landmark else 4
    for j in range(steps):
        f=j/steps;inset=span*.48*f
        inset_x=span*.28*f
        slab=plan.intersection(box(x0+inset_x,y0+inset,x1-inset_x,y1-inset))
        top=eave+.22+rise*((j+1)/steps)**1.55
        if not slab.is_empty:
            for p in polygons(slab): yield part(p,previous,top,roof)
        previous=top
    ridge=plan.intersection(box(x0+min(3.5,span*.15),(y0+y1)/2-.20,x1-min(3.5,span*.15),(y0+y1)/2+.20))
    for p in polygons(ridge):yield part(p,previous,previous+.5,'#bca376')
    if landmark:
        # 簷下木構與瓦脊依同一殿體的寬和進深縮放；前廊不跨入隔壁的院地。
        if length>8 and span>5 and not modern:
            for sign in (-1,1):
                fascia=plan.intersection(box(x0,y0 if sign<0 else y1-.35,x1,y0+.35 if sign<0 else y1))
                for face in polygons(fascia):yield part(face,eave-.53,eave-.22,'#86503e')
        for side in [-1,1]:
            cx=x0+span*.20 if side<0 else x1-span*.20
            for step in range(3):
                xx=cx+side*step*.42
                wing=plan.intersection(box(xx-.35,(y0+y1)/2-.20,xx+.35,(y0+y1)/2+.20))
                for p in polygons(wing):yield part(p,previous+.30+step*.2,previous+.80+step*.38,'#bca376')


def add_temple_scenes(pbf,cache,detail,index,overlays,add):
    from build_landscape_places import PROJECT,polygons,local_rings,normalize,region,T,area,osmref,facts
    from xml.etree import ElementTree
    from landscape_reviewed_temples import load_sites, integrate, add_regional_context
    reviewed=load_sites()
    reviewed_by_id={site['id']:site for site in reviewed}
    original_heritage=[]
    sites,shells=read_temples(pbf,cache)
    counts=Counter(); heritage=[]; labels=[]
    for item in json.loads((cache/'temple-monuments.json').read_bytes()):
        if not any(v.get('name')=='寺廟' for v in item['assetsTypes']):continue
        x,y=item.get('longitude'),item.get('latitude')
        if x and y and 20<x<27 and 118<y<123:x,y=y,x
        if not x or not y or not (118<x<123 and 21<y<27):continue
        name=re.sub('^(?:國定古蹟|市定古蹟|縣定古蹟)[ －-]*','',item['caseName'])
        if re.search('清真寺|神社殘蹟|神社舊址|社殘蹟|節坊|陳宅',name):continue
        record={'name':name,'id':'boch-'+str(item['caseId']),'major':1}
        original_heritage.append((Point(*PROJECT(x,y)),record))
        site=reviewed_by_id.get(str(item['caseId']))
        heritage.append((Point(*PROJECT(*(site['center'] if site else (x,y)))),record))
    for item in json.loads((cache/'religious-landscapes.json').read_bytes()):
        name=item['title']
        if not SHRINE_NAME.search(name) or re.search('遶境|進香|搶孤|祭典|過火|放水燈|迎王|王船祭',name):continue
        heritage.append((Point(*PROJECT(float(item['WGS84X']),float(item['WGS84Y']))),{'name':name,'id':'religion-'+name,'major':1}))
    htree=shapely.STRtree([g for g,p in heritage])
    def prominent(g,p):
        if p['id'] in KEY_SITES or p.get('major'):return True
        return any(heritage[j][0].distance(g)<75 for j in htree.query(g.buffer(75)))
    def label(g,p):
        name=p['name'];q=g.representative_point()
        if not name or HALLS.fullmatch(name) or re.fullmatch(r'.{0,6}(?:正殿|後殿|媽祖殿|拜殿|廂廊|佛祖殿|龍邊|虎邊|神龕)',name):return
        labels.append((q,dict(k='temple',name=name,id=p['id'],majorT=int(prominent(g,p)))))
    for g,p in sites:label(g,p)
    for g,p in heritage:label(g,p)
    registered=[]
    for i,item in enumerate(ElementTree.parse(cache/'temple-register.xml').getroot()):
        try:x,y=float(item.findtext('WGS84X')),float(item.findtext('WGS84Y'))
        except (ValueError,TypeError):continue
        if 118<x<123 and 21<y<27:
            entry=Point(*PROJECT(x,y)),{'name':item.findtext('寺廟名稱'),'id':'moi-'+str(i)}
            registered.append(entry);label(*entry)
    # OSM 殿名與官方寺名可能在同一地點，名稱相同才合併。
    used={};accepted=[]
    label_cells={}
    for q,p in sorted(labels,key=lambda v:(v[1]['id'][5:] not in reviewed_by_id,-v[1]['majorT'],-len(v[1]['name']))):
        key=normalize(p['name'])
        if any(v.distance(q)<145 for v in used.get(key,[])):continue
        cell=(int(q.x//150),int(q.y//150))
        candidates=(record for i in range(cell[0]-1,cell[0]+2) for j in range(cell[1]-1,cell[1]+2) for record in label_cells.get((i,j),[]))
        if any(q.distance(old)<130 and min(len(key),len(n))>=3 and (key.endswith(n) or n.endswith(key)) for old,n in candidates):continue
        label_cells.setdefault(cell,[]).append((q,key));used.setdefault(key,[]).append(q);accepted.append((q,p))
        add('names',q,{'k':'temple','name':p['name'],'major':0,'priority':p['majorT']})
    counts['namedLocations']=len(accepted);counts['heritageTempleRecords']=sum(p['id'].startswith('boch-') for _,p in heritage)
    # 已拆圖的殿、門、廊及現代館舍優先於整片院地。一般住家內的祭祀點只給地名。
    grounds=[(g,p) for g,p in sites if g.area>100 and (not p['build'] or p['id'] in KEY_SITES)]
    zones=shapely.STRtree([g for g,p in grounds])
    parts={p['id']:(g,p) for g,p in shells if g.area>=9 and not EXCLUDE.search(p['name'])}
    region_polys=[(g,p) for g,p in grounds if prominent(g,p)]
    pg=shapely.STRtree([g for g,p in region_polys])
    from landscape_heritage_footprints import building_tiles,fill,matches
    grid=set()
    from build_landscape_places import LL
    for g,p in region_polys+heritage:
        a,b,c,d=transform(LL,g).bounds
        for i in range(math.floor(a*100)-1,math.floor(c*100)+2):
            for j in range(math.floor(b*100)-1,math.floor(d*100)+2):grid.add((i,j))
    religious_points=[(g,p) for g,p in sites if not g.area]
    point_tree=shapely.STRtree([g for g,p in religious_points])
    from landscape_heritage_footprints import GENERIC
    for obj in osmium.FileProcessor(pbf).with_areas().with_filter(osmium.filter.EntityFilter(osmium.osm.AREA)).with_filter(osmium.filter.KeyFilter('building','building:part')):
        t=obj.tags;first=next(iter(obj.outer_rings()),None)
        if first is None or (math.floor(first[0].lon*100),math.floor(first[0].lat*100)) not in grid:continue
        name=t.get('name:zh') or t.get('name','');ref=osmref(obj)
        if ref in parts or EXCLUDE.search(name) or t.get('location')=='underground' or t.get('layer','0').startswith('-'):continue
        g=area(obj)
        if g is None or g.area<12:continue
        ground_hits=pg.query(g.representative_point(),predicate='within')
        ids=htree.query(g.buffer(75))
        named=next((heritage[i][1] for i in ids if matches(name,heritage[i][1]['name'])),None)
        identified=None
        if not name and t.get('building','') in GENERIC:
            for i in ground_hits:
                zone,owner=region_polys[i]
                if zone.area<12000 and zone.intersection(g).area>.87*g.area:
                    identified=owner;break
            if identified is None:
                for j in ids:
                    anchor,rec=heritage[j]
                    if g.covers(anchor) and any(matches(rec['name'],religious_points[i][1]['name']) for i in point_tree.query(g,predicate='contains')):
                        identified=rec;break
        if not len(ground_hits) and not named and not identified:continue
        hall=bool(name and (HALLS.search(name) or re.search('殿|戲臺|戲台|廂廊|五門|牌樓|寶塔|正堂',name)))
        if not name and not identified:continue
        owner=identified or named or {}
        title=name or owner['name']
        style='traditional' if hall or owner else 'modern'
        if re.search('普濟寺|慶修院',owner.get('name','')):style='japanese'
        parts[ref]=(g,{'id':ref,'name':title,'style':style,'religion':'',**({'ownerId':owner['id']} if owner else {}),**facts(t)})
    directory=next(iter(detail.values())).parents[1]/'cache'/'overture-2026-10-21.0'
    if directory.is_dir() or (cache/'heritage-buildings').is_dir():
        counts['additionalHeritageFootprints']=fill([(g,p) for g,p in heritage if p['id'][5:] not in reviewed_by_id],sites,parts,building_tiles(directory,cache/'heritage-buildings'),registered)
    groups=integrate(reviewed,parts,detail,overlays)
    counts['reviewedContextFootprints']=add_regional_context(reviewed,detail,cache,add)
    counts['individuallyReviewedSites']=len(groups)
    counts['individuallyReviewedRoofParts']=sum(len(site['parts']) for site,_,_ in groups)
    objects=list(parts.values()); idx=shapely.STRtree([g for g,p in objects])
    temple_sites=set();by_tile={};modeled=[];bespoke={}
    for geom,p in objects:
        if p['id'] in ('w198401479','w1134404757'):continue
        if p.get('build') in ('residential','apartments','office','industrial','train_station'):continue
        keep_base=p['id'] in {'w1134404747','w1134404756','w287892695'}
        if not keep_base and geom.area>900 and sum(1 for j in idx.query(geom) if objects[j][1]['id']!=p['id'] and objects[j][0].area<geom.area*.65 and geom.covers(objects[j][0]))>=2:continue
        owners=[grounds[j] for j in zones.query(geom.representative_point(),predicate='within')]
        site=min(owners,key=lambda o:o[0].area)[1] if owners else p
        if site['id']=='w198401479':continue
        major=prominent(geom,p) or site['id'] in KEY_SITES
        for g in polygons(geom):
            if g.area<9:continue
            center=g.representative_point();x,y=int(center.x//T),int(center.y//T)
            near=(x,y) in detail
            for shape,prop in temple_surfaces(g,p,major):
                if shape.area>.03:add('temple',shape,{**prop,'near':int(near)})
            counts['buildingFootprints']+=1
            modeled.append(g)
            if near:
                if (x,y) not in bespoke:
                    file=detail[x,y]/'stations.json';zones_here=[]
                    for st in json.loads(file.read_bytes()) if file.exists() else []:
                        if st.get('set')=='landmarks':
                            zones_here.extend(Polygon([(a+x*T,b+y*T) for a,b in poly['ring']]).buffer(0) for poly in st.get('footprint',[]) if len(poly.get('ring',[]))>=3)
                    bespoke[x,y]=shapely.union_all(zones_here)
                if bespoke[x,y].intersection(g).area<g.area*.50:by_tile.setdefault((x,y),[]).append((g,p,major))
                counts['footprintsInOriginalTiles']+=1
            temple_sites.add(p.get('ownerId',site['id']))
    # 近景用獨立屋體表現原圖磚的殿、門和院落；只取代可證實屬於該廟的通用體塊。
    for (x,y),models in by_tile.items():
        native=json.loads((detail[x,y]/'buildings.json').read_bytes())
        tile=overlays[region(x,y)].setdefault(detail[x,y].name,{})
        geoms=[g for g,p,m in models];tree=shapely.STRtree(geoms)
        for row in native:
            if row.get('type') in ('canopy','bridge') or not row.get('rings'):continue
            rings=row['rings']
            shell=Polygon([(a+x*T,b+y*T) for a,b in rings[0]]).buffer(0)
            if not shell.area:continue
            ids=tree.query(shell);hits=[geoms[j].intersection(shell) for j in ids]
            if hits and shapely.union_all(hits).area>.67*shell.area:
                tile.setdefault('suppressed',[]).append(row['id'])
        for g,p,major in models:
            for shape,prop in temple_surfaces(g,p,major):
                if shape.area>.03:
                    tile.setdefault('templeSolids',[]).append([local_rings(shape,x,y),prop['base'],prop['top'],prop['color'],[round(g.representative_point().x-x*T,1),round(g.representative_point().y-y*T,1)]])
    for site,_,_ in groups:
        temple_sites.add('boch-'+site['id'])
        for part in site['parts']:
            g=part['geom'];modeled.append(g)
            center=g.centroid;x,y=int(center.x//T),int(center.y//T)
            counts['buildingFootprints']+=1
            counts['footprintsInOriginalTiles']+=int((x,y) in detail)
    counts['modeledSiteIds']=len(temple_sites)
    mapped=shapely.STRtree(modeled)
    counts['originalRegisterWithin50mOfModel']=sum(bool(len(mapped.query(g,predicate='dwithin',distance=50))) for g,p in original_heritage)
    counts['heritageWithin50mOfModel']=sum(bool(len(mapped.query(g,predicate='dwithin',distance=50))) for g,p in heritage if p['id'].startswith('boch-'))
    return counts
