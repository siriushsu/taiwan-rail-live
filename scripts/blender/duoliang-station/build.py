"""Blender 無視窗重建多良舊站。XY 是相對站房中心的東、北公尺，Z 以本站地圖的軌面剖面為準。"""
from pathlib import Path
from collections import defaultdict
import array
import hashlib
import json
import math
import bpy
from mathutils import Vector

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
OUT = ROOT/'landscape-web/models/duoliang'
OUT.mkdir(parents=True,exist_ok=True)
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.unit_settings.system = 'METRIC'
scene['參考'] = '臺東觀光旅遊網景點 429、中央社 2024/7/1 修繕後照片；OSM 427804286、992081593、992081594'
scene['尺寸'] = '站房與兩座舊月台位置依 OSM。立面、欄杆、階梯、長椅尺寸依公開照片估製。'
scene['原點 WGS84'] = [120.9588954,22.5074983]
# OSM 站房與兩座舊月台的外框，北端在站房旁，南端沿南迴線往瀧溪。
station = [(0.7,8.9),(5.8,6.9),(-0.7,-9.0),(-5.8,-6.9)]
west = [(-4.6,-14.2),(-36.9,-86.7),(-32.3,-89.1),(-.3,-15.6)]
east = [(8.1,-20.8),(-25.1,-93.0),(-23.1,-94.1),(11.4,-22.2)]
mat_colors={'粉刷牆':'dacbaa','洗石子':'afa894','欄杆紅':'b83c2b','紅漆暗部':'963824','屋簷黃':'d7ab55','窗玻璃':'47696c','深鐵件':'454b47','鋼藍':'628ca0','步道':'b5a58d','白緣':'e2d8bc','木坐板':'855d3f','站牌白':'ede9dc','站牌綠':'34845b','站名字':'192a25','伸縮縫':'8b8379','護坡石':'897f6b','護坡接縫':'746f63','道床':'746d60','坡面':'687952','石坡':'848477','坡地草':'77845c','肩部':'939177','碎石淺':'9c9688','碎石深':'635f55'}
materials={}
for name,hexcolor in mat_colors.items():
    mat=bpy.data.materials.new(name)
    rgb=[int(hexcolor[i:i+2],16)/255 for i in (0,2,4)]
    mat.diffuse_color=(*[((c+.055)/1.055)**2.4 if c>.04045 else c/12.92 for c in rgb],1)
    materials[name]=mat
components=defaultdict(lambda: [[],[]])

def surface(name,mat,vertices,faces):
    points,polys=components[name,mat]
    start=len(points)
    points.extend(vertices)
    polys.extend([start+i for i in face] for face in faces)

def prism(name,mat,ring,bottom,top):
    # 南北方向的地圖軌面有連續縱坡；兩座月台沿用其斜率，站房保持水平。
    ring=list(ring)
    if sum(a[0]*b[1]-b[0]*a[1] for a,b in zip(ring,ring[1:]+ring[:1]))<0: ring.reverse()
    n=len(ring)
    pts=[(e,north,z(e,north) if callable(z) else z) for z in (bottom,top) for e,north in ring]
    sides=[(i,(i+1)%n,(i+1)%n+n,i+n) for i in range(n)]
    surface(name,mat,pts,[tuple(reversed(range(n))),tuple(range(n,2*n)),*sides])

def xy(x,y):
    return (.926*x+.377*y,-.377*x+.926*y)
def box(name,mat,x,y,z,w,l,h):
    prism(name,mat,[xy(x+dx*w/2,y+dy*l/2) for dx,dy in [(-1,-1),(1,-1),(1,1),(-1,1)]],z,z+h)

def beam(name,mat,a,b,r,sides=8):
    a,b=Vector(a),Vector(b);axis=(b-a).normalized()
    up=Vector((0,0,1)) if abs(axis.z)<.8 else Vector((1,0,0))
    u=axis.cross(up).normalized()*r;v=axis.cross(u)
    verts=[p+u*math.cos(i*2*math.pi/sides)+v*math.sin(i*2*math.pi/sides) for p in (a,b) for i in range(sides)]
    faces=[tuple(reversed(range(sides))),tuple(range(sides,sides*2))]
    faces.extend((i,(i+1)%sides,(i+1)%sides+sides,i+sides) for i in range(sides))
    surface(name,mat,verts,faces)

def railing(name,a,b,top,mat='欄杆紅',spacing=1.5,spindles=False):
    a,b=Vector(a),Vector(b)
    n=math.ceil((b-a).length/spacing)
    z=Vector((0,0,1))
    for h in ([.13,.98] if spindles else [.36,.69,1.03]):
        beam(name,mat,a+z*h*top,b+z*h*top,.046 if h>.9 else .026)
    for i in range(n+1):
        p=a.lerp(b,i/n)
        beam(name,mat,p,p+z*top,.046)
    if spindles:
        for i in range(n):
            for j in range(1,6):
                p=a.lerp(b,(i+j/6)/n)
                beam(name,mat,p+z*.13,p+z*.98*top,.019,5)

def point(p,z):return (*p,z)
def deckheight(x,y):return .85+.026*y
for name,ring in [('山側舊月台',west),('海側舊月台',east)]:
    prism(name,'洗石子',ring,lambda x,y:deckheight(x,y)-2.25,deckheight)
    # 沿邊緣的淡色收面、板片伸縮縫與外側紅欄。
    for i,j,interior in [(0,1,3),(3,2,0)]:
        a,b,c=map(Vector,(ring[i],ring[j],ring[interior]))
        inset=(c-a).normalized()*.22
        prism(name+'收邊','白緣',[a,b,b+inset,a+inset],deckheight,lambda x,y:deckheight(x,y)+.025)
    for i in range(1,25):
        a=Vector(ring[0]).lerp(Vector(ring[1]),i/25);b=Vector(ring[3]).lerp(Vector(ring[2]),i/25)
        beam(name+'板縫','伸縮縫',point(a,deckheight(*a)+.026),point(b,deckheight(*b)+.026),.012,4)
    i,j=(0,1) if name.startswith('山') else (3,2)
    railing(name+'外欄',point(ring[i],deckheight(*ring[i])),point(ring[j],deckheight(*ring[j])),1.05)
# 舊月台所在的高架站坪。地形網格在陡坡上會把狹長站坪平均掉，
# 於實際兩座月台外框之間補上路基與擋土壁，底緣埋入坡地。
apron=[(-6.6,-13.5),(-39.0,-86.5),(-22.75,-94.1),(11.4,-22.2),(18.8,-3.9),(23.2,9.8),(5.2,14.5),(-4.5,6.4)]
bed=lambda x,y:deckheight(x,y)-1.40
# 使用地景 DTM 取樣，每格沿邊約八米，外側六米處落回原山坡。站坪的坡面不延伸至台九線。
profile=json.loads((HERE/'ground-profile.json').read_text())
rail_datum=37.306
last_lower=None
for side,samples in enumerate(profile):
    strip=[]
    for x,y,ground,ex,ny,outer_ground in samples:
        z=bed(x,y)
        upper=(x,y,z-1.6)
        toe=(ex,ny,min(z-1.7,outer_ground-rail_datum-.45))
        mid=((x+ex)/2,(y+ny)/2,(upper[2]+toe[2])/2+.3)
        strip.append(((x,y,z),upper,mid,toe))
    for k,(a,b) in enumerate(zip(strip,strip[1:])):
        for j,mat in enumerate(['護坡石','石坡','坡面']):
            shade='坡地草' if j==2 and (k+side)%3==0 else mat
            surface('沿坡路基',shade,[a[j],a[j+1],b[j+1],b[j]],[(0,1,2),(0,2,3)])
        beam('混凝土分縫','護坡接縫',a[0],a[1],.026,4)
    if last_lower:
        surface('路基轉角','坡面',[strip[0][1],last_lower,strip[0][3]],[(0,1,2)])
    else:first=strip[0]
    last_lower=strip[-1][3]
surface('路基轉角','坡面',[first[1],last_lower,first[3]],[(0,1,2)])
prism('站坪肩部','肩部',apron,lambda x,y:bed(x,y)-.20,bed)
# 碎石道床貼合現有南迴線，列車與鋼軌仍由行車圖層繪製。
track=[(-26.7,-93.1),(-9.3,-54.4),(17.2,5.4),(19.9,12.8)]
import random
rng=random.Random(427804286)
for pa,pb in zip(track,track[1:]):
    a,b=Vector(pa),Vector(pb);v=(b-a).normalized();n=Vector((v.y,-v.x))
    prism('碎石路床','道床',[a-n*1.85,b-n*1.85,b+n*1.85,a+n*1.85],bed,lambda x,y:bed(x,y)+.14)
    for k in range(round((b-a).length*10)):
        q=a.lerp(b,rng.random())+n*rng.uniform(-1.82,1.82);r=rng.uniform(.055,.14);z=bed(*q)+.15
        verts=[(*q,z+.03),(q.x-r,q.y-.6*r,z),(q.x+.75*r,q.y-r,z),(q.x+.3*r,q.y+r,z)]
        surface('道砟',rng.choice(['碎石淺','碎石深']),verts,[(0,1,2),(0,2,3),(0,3,1)])
landing=[(-9.6,-15.8),(-5.0,-18.1),(1.4,-14.7),(-1.0,-7.6),(-6.0,-5.8)]
prism('階梯與月台接續步道','步道',landing,lambda x,y:bed(x,y)-.05,deckheight)
prism('站房基座','洗石子',station,-13,-.1)
prism('舊站房','粉刷牆',station,-.1,4.55)
box('簷帶','屋簷黃',0,0,4,5.55,17.45,.48)
box('屋頂觀景臺','洗石子',0,0,4.45,6.2,18.0,.35)
box('屋頂鋪面','步道',0,0,4.8,6.08,17.88,.08)
for x in (-2.98,2.98):
    railing('觀景臺紅漆欄杆',point(xy(x,-8.81),4.88),point(xy(x,8.81),4.88),1.1,spindles=True)
railing('觀景臺北端',point(xy(-2.98,8.81),4.88),point(xy(2.98,8.81),4.88),1.1,spindles=True)
railing('觀景臺南端',point(xy(-.95,-8.81),4.88),point(xy(2.98,-8.81),4.88),1.1,spindles=True)
for y in (-6.6,-1.5,3.3,6.7):
    box('窗框','屋簷黃',2.73,y,1.15,.16,2.45,1.46)
    box('海側窗玻璃','窗玻璃',2.83,y,1.22,.09,2.26,1.30)
    for dy in [-.73,0,.73]:box('窗櫺','白緣',2.90,y+dy,1.22,.06,.055,1.3)
for y in [-8.3,-3.8,1.0,8.3]:box('立面柱','紅漆暗部',2.74,y,-.3,.22,.22,4.4)
box('舊站門','深鐵件',2.78,-4.6,.2,.11,1.45,2.35)
for i in range(23):
    top=.86+(i+1)*(4.88-.86)/23
    box('南端洗石子階梯','洗石子',-1.98,-15.9+i*.315,-.7,1.85,.32,top+.7)
for x in (-2.94,-1.03):
    a,b=point(xy(x,-15.99),1.02),point(xy(x,-9.0),4.88)
    railing('樓梯藍扶手',a,b,1.0,mat='鋼藍')
for y in (-4.6,1.5):
    for yy in (-.72,.72):
        box('長椅腳','深鐵件',-1.75,y+yy,4.88,.42,.10,.4)
    for x in (-1.95,-1.77,-1.59):box('木長椅','木坐板',x,y,5.28,.15,1.9,.07)
    box('木椅背','木坐板',-2.02,y,5.45,.09,1.9,.32)
for x in (-.88,.88):box('站牌支架','深鐵件',x,6.65,4.88,.07,.08,1.95)
box('站名板','站牌白',0,6.65,5.85,2.2,.08,.93)
box('站牌綠線','站牌綠',0,6.598,6.05,2.2,.023,.095)
# 筆畫由線段建模，不需在瀏覽器載字型。
strokes={'多': [[(.40,.94),(.20,.75)],[(.33,.86),(.75,.86),(.57,.64),(.19,.48)],[(.36,.76),(.53,.67)],[(.59,.58),(.32,.36)],[(.48,.48),(.87,.48),(.69,.24),(.39,.08),(.13,.02)],[(.47,.40),(.65,.29)]],
         '良': [[(.44,.96),(.56,.85)],[(.23,.82),(.81,.82),(.81,.48),(.23,.48)],[(.26,.65),(.77,.65)],[(.24,.80),(.24,.10),(.47,.21)],[(.46,.48),(.60,.29),(.85,.08)],[(.81,.44),(.64,.31)]]}
for k,x0 in [('多',-.64),('良',.08)]:
    for s in strokes[k]:
        for a,b in zip(s,s[1:]):
            beam('站牌多良','站名字',point(xy(x0+a[0]*.57,6.585),6.18+a[1]*.48),point(xy(x0+b[0]*.57,6.585),6.18+b[1]*.48),.021,6)
# 保留元件名稱和分件，.blend 可直接修改欄杆、站房與月台。
for (name,mat),(verts,faces) in components.items():
    mesh=bpy.data.meshes.new(name);mesh.from_pydata(verts,[],faces);mesh.update()
    obj=bpy.data.objects.new(name,mesh);scene.collection.objects.link(obj);obj.data.materials.append(materials[mat])
for area in bpy.context.screen.areas:
    if area.type=='VIEW_3D':
        rv=area.spaces.active.region_3d;rv.view_distance=87;rv.view_location=(-8,-35,0)
        rv.view_rotation=(Vector((0,0,0))-Vector((58,-50,38))).to_track_quat('-Z','Y')
bpy.context.preferences.filepaths.save_version=0
bpy.ops.wm.save_as_mainfile(filepath=str(HERE/'多良車站.blend'),compress=True)
# 網頁沿用站房的交錯位置／法線格式，以材質合併 draw call。
vertices=array.array('f');groups=[]
for mat in materials.values():
    start=len(vertices)//6
    for obj in sorted(scene.objects,key=lambda o:o.name):
        if obj.data.materials[0]!=mat:continue
        mesh=obj.data;mesh.calc_loop_triangles()
        for tri in mesh.loop_triangles:
            for i in tri.vertices:vertices.extend([*mesh.vertices[i].co,*tri.normal])
    groups.append({'component':mat.name,'start':start,'count':len(vertices)//6-start,'color':list(mat.diffuse_color[:3]),'metalness':.10,'roughness':.8})
binary=vertices.tobytes();(OUT/'station.mesh.bin').write_bytes(binary)
meta={'id':'duoliang','name':'多良車站','anchor':scene['原點 WGS84'][:],'rotationDeg':0,'sources':['https://tour.taitung.gov.tw/zh-tw/attraction/details/429','https://japan.focustaiwan.tw/photos/202407015002',*[f'https://www.openstreetmap.org/way/{n}' for n in (427804286,992081593,992081594,146741887)]],'lods':{'near':{'file':'station.mesh.bin','vertexCount':len(vertices)//6,'sha256':hashlib.sha256(binary).hexdigest(),'drawGroups':groups}}}
(OUT/'model.json').write_text(json.dumps(meta,ensure_ascii=False,indent=2)+'\n')
print('多良車站',len(vertices)//18,'三角形',len(binary),'bytes')
