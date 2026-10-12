"""Editable station candidates; original Tainan model is reused without modifying its snapshot."""
import bpy,bmesh,json,math,sys
from pathlib import Path
from mathutils import Vector
HERE=Path(__file__).resolve().parent
sys.path.insert(0,str(HERE.parent/"building-batch"))
import core as c
sys.path.insert(0,str(HERE.parent/"tainan-memory-v1"))
import geo as g
import station as tainan_source
from materials import MATS
SPECS=json.loads((HERE/"stations.json").read_text())
OUT=Path(sys.argv[sys.argv.index("--")+1]) if "--" in sys.argv else HERE/"output"

class PartsGeo(g.Geo):
    def __init__(self):
        super().__init__();self.parts={}
    def tri(self,p0,p1,p2,mat,n0=None,n1=None,n2=None):
        key=(mat,self.lod);before=len(self.buf.get(key,[]))
        super().tri(p0,p1,p2,mat,n0,n1,n2)
        if len(self.buf.get(key,[]))>before:
            self.parts.setdefault((self.comp,mat,self.lod),[]).extend(self.buf[key][-18:])

def box(G,name,x0,x1,y0,y1,z0,z1,mat="tile",lod="both"):
    with G.part(name),G.detail(lod):g.box(G,x0,x1,y0,y1,z0,z1,mat)
def hip(G,name,cx,cy,w,d,z0,wt,dt,z1,mat="roof"):
    low=[(cx-w/2,cy-d/2,z0),(cx+w/2,cy-d/2,z0),(cx+w/2,cy+d/2,z0),(cx-w/2,cy+d/2,z0)]
    high=[(cx-wt/2,cy-dt/2,z1),(cx+wt/2,cy-dt/2,z1),(cx+wt/2,cy+dt/2,z1),(cx-wt/2,cy+dt/2,z1)]
    with G.part(name):
        for i in range(4):G.quad(low[i],low[(i+1)%4],high[(i+1)%4],high[i],mat)
        G.quad(*high,mat)
        G.quad(*reversed(low),"dark")
def clock(G,name,x,y,z,r):
    f=g.front(y)
    with G.part(name):
        g.disc_f(G,f,x,z,r,.03,"white",24)
        g.ring_f(G,f,x,z,r,r+.12,0,.08,"ochre",24)
        with G.detail("near"):
            for i in range(12):
                a=i*math.pi/6
                g.rod(G,f.p(x+math.sin(a)*r*.77,z+math.cos(a)*r*.77,.09),f.p(x+math.sin(a)*r*.90,z+math.cos(a)*r*.90,.09),.023,"dark",4)
            for a,length in [(math.pi/3,.78),(-math.pi/3,.52)]:
                g.rod(G,f.p(x,z,.12),f.p(x+math.sin(a)*r*length,z+math.cos(a)*r*length,.12),.045,"dark",4)
def facade(G,name,y,x0,x1,z0,z1,holes,mat="tile",trim="cream"):
    f=g.front(y)
    with G.part(name):
        g.wall_f(G,f,x0,x1,z0,z1,holes,mat)
        for i,h in enumerate(holes):
            with G.part(name+" opening %02d"%i):
                g.fill_poly_f(G,f,h["poly"],-h["depth"]+.015,"glass")
                with G.detail("near"):
                    # Direct polygon offset from the hole center; visual moulding only.
                    cx=sum(p[0] for p in h["poly"])/len(h["poly"])
                    cz=(min(p[1] for p in h["poly"])+max(p[1] for p in h["poly"]))/2
                    outer=[(cx+(u-cx)*1.14,cz+(v-cz)*1.06) for u,v in h["poly"]]
                    g.band_f(G,f,outer,h["poly"],0,.10,trim,closed=True,skip="n")
def shell(G,name,x0,x1,y0,y1,h,holes,mat="tile"):
    facade(G,name+" front",y0,x0,x1,0,h,holes,mat)
    # Side and rear openings remain estimates, tagged in stations.json.
    with G.part(name+" side and rear"):
        g.wall_f(G,g.back(y1),-x1,-x0,0,h,[],mat)
        g.wall_f(G,g.left(x0),-y1,-y0,0,h,[],mat)
        g.wall_f(G,g.right(x1),y0,y1,0,h,[],mat)
    box(G,name+" roof slab",x0,x1,y0,y1,h-.15,h,"roof")
def stepped_gable(G,name,x,y,z,w,h):
    # Closed frontal stepped profile, not a hollow picture plane.
    profile=[(-w/2,0),(w/2,0),(w/2,.25*h),(.32*w,.25*h),(.32*w,.55*h),(.15*w,.55*h),(.15*w,.78*h),(0,h),(-.15*w,.78*h),(-.15*w,.55*h),(-.32*w,.55*h),(-.32*w,.25*h),(-w/2,.25*h)]
    with G.part(name):
        g.extrude_f(G,g.front(y),[(x+u,z+v) for u,v in profile],-.30,.12,"cream")
def hsinchu(s):
    p=s["estimatedParameters"];G=PartsGeo()
    holes=[g.hole_arch(x,2.5,1.2,5.5,.35,8) for x in (-9,-5,5,9)]+[g.hole_arch(0,5,0,3.4,.4,12)]
    shell(G,"Historic main hall",-13,13,-8,8,8.2,holes)
    hip(G,"Steep lower roof",0,0,27.2,17.2,8.2,19,9,13)
    hip(G,"Upper roof",0,0,19,9,13,9,1.3,14.4)
    # Wings are asymmetric in the current building; dimensions are estimates.
    shell(G,"Left wing",-25,-13,-6.5,7,5.5,[g.hole_arch(x,2.0,1,3.6,.25,8) for x in (-22,-17)])
    hip(G,"Left wing roof",-19,.25,13.2,14.7,5.5,7,1.0,8)
    shell(G,"Right office wing",13,32,-6.5,8,5.4,[g.hole_rect(x,2.4,1.3,4,.25) for x in (17,22,27)])
    box(G,"Right wing cornice",12.7,32.3,-6.8,8.3,5.4,5.75,"cream")
    # One large portico arch, with square outer piers and bottle-profile inner columns.
    facade(G,"Entry portico",-11.5,-4.5,4.5,0,6.6,[g.hole_arch(0,5.1,0,3.9,.65,12)],trim="ochre")
    box(G,"Portico roof",-4.7,4.7,-11.7,-7.7,6.6,6.95,"cream")
    with G.part("Double entrance columns"):
        for sign in (-1,1):
            profile=[(0,0),(.42,0),(.42,.32),(.30,.43),(.43,1.0),(.32,2.5),(.26,3.7),(.44,3.85),(.44,4.05),(0,4.05)]
            g.revolve_f(G,g.world(),sign*2.93,-11.73,profile,"ochre",12)
    stepped_gable(G,"Entry stepped gable",0,-11.70,6.95,8.5,2.7)
    # Two bullseye dormers sit in the steep lower roof slope.
    for x in (-7,7):
        box(G,"Dormer body",x-1.5,x+1.5,-6.5,-3.4,9.3,11.3,"tile")
        stepped_gable(G,"Dormer gable",x,-6.55,10.5,3.3,1.9)
        with G.part("Bullseye dormer"):
            g.disc_f(G,g.front(-6.70),x,10.2,.60,.02,"glass",20)
            g.ring_f(G,g.front(-6.70),x,10.2,.60,.79,0,.13,"cream",20)
    box(G,"Clock tower", -1.9,1.9,-1.9,1.9,13,16.4,"tile")
    clock(G,"Clock face",0,-1.94,15.2,1.04)
    with G.part("Helmet clock cap"):
        g.revolve_f(G,g.world(),0,0,[(0,16.4),(2.5,16.4),(2.55,16.65),(2.15,16.9),(1.9,17.65),(1.1,18.3),(.42,18.8),(.12,19.6),(0,20)],"roof",16)
    for z in (1.0,7.6):
        box(G,"Facade stone band",-13,13,-8.17,-7.99,z,z+.22,"cream",lod="near")
    # Near roof seams retain the steep and shallow pitches without texture atlases.
    with G.part("Roof standing seams"),G.detail("near"):
        for x in range(-10,11,2):
            t=x/13.6
            a=(x,-8.62,8.28);b=(x*.7,-4.50,13.07)
            g.rod(G,a,b,.035,"frame",4)
    return G

def taichung(s):
    G=PartsGeo();p=s["estimatedParameters"]
    holes=[g.hole_arch(x,3.0,.7,5.5,.35,10) for x in (-5,0,5)]
    shell(G,"Red brick central hall",-10,10,-8,8,8.5,holes)
    hip(G,"Main copper roof",0,0,21,17,8.5,10,6.5,13.7)
    hip(G,"Main upper roof",0,0,10,6.5,13.7,5,.8,15)
    for sign in (-1,1):
        a,b=(10,28) if sign>0 else (-28,-10)
        shell(G,"Wing "+str(sign),a,b,-6,7,5.7,[g.hole_arch(x,2.1,.7,3.5,.3,8) for x in [a+4,a+9,a+14]])
        hip(G,"Wing roof "+str(sign),(a+b)/2,.5,19,14,5.7,11,1,9)
        # White masonry bands are separate surfaces offset in depth to avoid z-fighting.
        for z in (1.0,3.0,5.25):
            box(G,"Wing light band",a,b,-6.15,-5.99,z,z+.20,"cream")
    # Central clock dormer and pediment: the silhouette remains a calibration candidate.
    box(G,"Central clock dormer",-2.4,2.4,-6.35,-2.4,10.1,13.5,"tile")
    with G.part("Clock gable"):
        poly=[(-2.8,10.2),(2.8,10.2),(2.8,12.5),(1.8,13.4),(0,14.0),(-1.8,13.4),(-2.8,12.5)]
        g.extrude_f(G,g.front(-6.4),poly,-.25,.10,"cream")
    clock(G,"Central clock",0,-6.55,12.2,1.05)
    for z in (1.1,3.2,7.7):
        box(G,"Main light band",-10,10,-8.18,-7.99,z,z+.24,"cream")
    # A low frontal canopy is independent of the rear historic platform canopy.
    box(G,"Front entrance canopy",-10.5,10.5,-10.5,-7.8,3.35,3.65,"roof")
    for x in (-9,-6,-3,3,6,9):
        with G.part("Canopy cast-iron posts"):
            g.rod(G,(x,-10.05,.08),(x,-10.05,3.35),.11,"frame",8)
        box(G,"Canopy post footing",x-.2,x+.2,-10.25,-9.85,0,.25,"ochre")
    for x in (-9.5,9.5):
        box(G,"Central corner pilaster",x-.3,x+.3,-8.29,-7.98,1.1,7.7,"cream")
    # Estimated seam spacing, intentionally near-only.
    with G.part("Copper roof seams"),G.detail("near"):
        for x in range(-8,9,2):
            g.rod(G,(x,-8.52,8.55),(x*.48,-3.27,13.74),.035,"frame",4)
    return G

def import_parts(G):
    conversion={}
    for level in ("near","far"):
        groups={}
        for (part,mat,lod),buf in G.parts.items():
            if lod in ("both",level):groups.setdefault((part,mat),[]).extend(buf)
        before=after=0
        for (part,mat),buf in groups.items():
            count=len(buf)//6;before+=count//3
            vertices=[buf[i:i+3] for i in range(0,len(buf),6)]
            normals=[buf[i+3:i+6] for i in range(0,len(buf),6)]
            data=bpy.data.meshes.new(level+" "+part+" "+mat)
            data.from_pydata(vertices,[],[(i,i+1,i+2) for i in range(0,count,3)]);data.update()
            if level=="far":
                bm=bmesh.new();bm.from_mesh(data)
                bmesh.ops.remove_doubles(bm,verts=list(bm.verts),dist=1e-6)
                bmesh.ops.dissolve_limit(bm,angle_limit=.00001,use_dissolve_boundaries=False,verts=list(bm.verts),edges=list(bm.edges),delimit={"NORMAL"})
                bmesh.ops.triangulate(bm,faces=list(bm.faces))
                bm.to_mesh(data);bm.free();data.update()
            else:
                data.polygons.foreach_set("use_smooth",[True]*len(data.polygons))
                data.normals_split_custom_set_from_vertices(normals)
            data.materials.append(c.M[mat]);data.calc_loop_triangles();after+=len(data.loop_triangles)
            obj=bpy.data.objects.new(level+" "+part+" "+mat,data);c.ASSET.objects.link(obj)
            obj["component_id"]=part;obj["near_only"]=False;obj["lod_layer"]=level
            obj.hide_render=(level=="far");obj.hide_set(level=="far")
            c.OBJECTS.append(obj)
        conversion[level]={"sourceTriangles":before,"blenderTriangles":after,"method":"preserve-original-triangles-and-normals" if level=="near" else "weld-1-micrometre-and-dissolve-coplanar-only"}
    return conversion

original_export=c.export_level
def selected_export(level):
    all_objects=c.OBJECTS
    c.OBJECTS=[o for o in all_objects if o["lod_layer"]==level]
    for o in c.OBJECTS:o.hide_set(False)
    try:return original_export(level)
    finally:
        for o in c.OBJECTS:o.hide_set(level=="far")
        c.OBJECTS=all_objects
c.export_level=selected_export

def render(out,meta):
    lo=Vector(meta["bounds"]["min"]);hi=Vector(meta["bounds"]["max"]);target=(lo+hi)/2;extent=max(hi-lo);sc=c.SC
    sc.render.resolution_x=1200;sc.render.resolution_y=760;sc.cycles.samples=24
    corners=[Vector((x,y,z)) for x in (lo.x,hi.x) for y in (lo.y,hi.y) for z in (lo.z,hi.z)]
    for name,delta in [("hero",(1.0,-1.8,.90)),("end",(0,-2,.07)),("roof",(.07,-.03,2))]:
        cam=sc.camera;cam.location=target+extent*Vector(delta)
        cam.rotation_euler=(target-cam.location).to_track_quat("-Z","Y").to_euler()
        inv=cam.rotation_euler.to_quaternion().inverted();ps=[inv@(v-target) for v in corners]
        cam.data.ortho_scale=1;frame=cam.data.view_frame(scene=sc)
        cam.data.ortho_scale=max((max(v.x for v in ps)-min(v.x for v in ps))/(max(v.x for v in frame)-min(v.x for v in frame)),(max(v.y for v in ps)-min(v.y for v in ps))/(max(v.y for v in frame)-min(v.y for v in frame)))*1.14
        sc.render.filepath=str(out/(name+".png"))
        if name=="hero":bpy.ops.wm.save_as_mainfile(filepath=str(out/(meta["id"]+".blend")))
        bpy.ops.render.render(write_still=True)

reports=[]
for s in SPECS:
    c.reset()
    for key,color in s["palette"].items():
        old=MATS[key];c.material(key,color,rough=old[1],metal=old[2])
    inherited=None
    if s["builder"]=="tainan":
        tainan_source.Geo=PartsGeo;G=tainan_source.build()
        inherited=json.loads((HERE.parents[3]/"memories/tainan-2026-09-12/station/model.json").read_text())
        assert G.count(("both","near"))==inherited["lods"]["near"]["triangleCount"]
        assert G.count(("both","far"))==inherited["lods"]["far"]["triangleCount"]
    else:G={"hsinchu":hsinchu,"taichung":taichung}[s["builder"]](s)
    conversion=import_parts(G)
    meta={"id":s["id"],"name":s["name"],"stationKeys":s["stationKeys"],"legacySceneId":s["legacySceneId"],
      "assetVariant":s["assetVariant"],"builder":s["builder"],"version":1,"status":"heritage-candidate-awaiting-review",
      "stationPositionLonLat":s["stationPositionLonLat"],"anchor":None,"realBuildingHeightM":None,
      "engineeringDimensionsM":None,"heightQuality":"estimated-or-inherited","parameters":s["estimatedParameters"],
      "sources":s["sources"],"photoReferences":s["photoReferences"],"confirmedTextFeatures":s["confirmedFeatures"],
      "pending":s["pending"],"modelUse":"map-exterior-preview","orientationMode":"local-facade",
      "railElevationM":None,"trackGuidesExported":False,"paletteSrgb":s["palette"],"conversion":conversion,
      "sourceGeometryPreserved":s.get("sourceGeometryPreserved",False),
      "snapshotModified":False,"currentUndergroundOrElevatedStationIncluded":False,
      "notes":["可編輯建模候選，尚未完成本次照片校正及地圖放樣。","時鐘指針固定示意，未模擬即時時間。"]}
    out=OUT/s["id"];result=c.export(out,meta)
    if inherited:(out/"inherited-source-metadata.json").write_text(json.dumps(inherited,ensure_ascii=False,indent=2)+"\n")
    render(out,result)
    reports.append({"id":s["id"],"objects":result["nativeObjectCount"],"conversion":conversion,"lods":{k:v["triangleCount"] for k,v in result["lods"].items()}})
(OUT/"build-report.json").write_text(json.dumps(reports,ensure_ascii=False,indent=2)+"\n")
print("HERITAGE_BUILD_OK "+json.dumps(reports,ensure_ascii=False),flush=True)
