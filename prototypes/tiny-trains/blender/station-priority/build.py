"""Station-specific Blender modelling. Evidence and estimates are recorded in stations.json."""
import bpy,json,math,sys
from pathlib import Path
from mathutils import Vector
HERE=Path(__file__).resolve().parent
sys.path.insert(0,str(HERE.parent/"building-batch"))
import core as c
SPECS=json.loads((HERE/"stations.json").read_text())
OUT=Path(sys.argv[sys.argv.index("--")+1]) if "--" in sys.argv else HERE/"output"
def tube(name,points,radius,mat,component,detail=False,sides=6):
    vertices=[];faces=[]
    for i,p in enumerate(points):
        tangent=Vector(points[min(i+1,len(points)-1)])-Vector(points[max(i-1,0)])
        tangent.normalize();ref=Vector((0,1,0))
        if abs(tangent.dot(ref))>.95:ref=Vector((1,0,0))
        u=tangent.cross(ref).normalized();v=tangent.cross(u).normalized()
        for j in range(sides):
            q=Vector(p)+radius*(math.cos(j*2*math.pi/sides)*u+math.sin(j*2*math.pi/sides)*v)
            vertices.append(tuple(q))
    for i in range(len(points)-1):
        for j in range(sides):faces.append((i*sides+j,i*sides+(j+1)%sides,(i+1)*sides+(j+1)%sides,(i+1)*sides+j))
    faces.extend([tuple(range(sides-1,-1,-1)),tuple((len(points)-1)*sides+j for j in range(sides))])
    o=c.mesh(name,vertices,faces,mat,component=component,detail=detail)
    for p in o.data.polygons:
        if len(p.vertices)==4:p.use_smooth=True
    return o
def skin(name,fun,nu,nv,mat,component,thickness=.10,detail=False):
    top=[fun(i/nu,j/nv) for i in range(nu+1) for j in range(nv+1)]
    n=len(top);verts=top+[(x,y,z-thickness) for x,y,z in top]
    faces=[]
    for i in range(nu):
        for j in range(nv):
            a=i*(nv+1)+j;b=a+1;d=(i+1)*(nv+1)+j;e=d+1
            faces.extend([(a,d,e,b),(a+n,b+n,e+n,d+n)])
    border=[i*(nv+1) for i in range(nu+1)]+[nu*(nv+1)+j for j in range(1,nv+1)]+[i*(nv+1)+nv for i in range(nu-1,-1,-1)]+[j for j in range(nv-1,0,-1)]
    for k,a in enumerate(border):
        b=border[(k+1)%len(border)];faces.append((a,b,b+n,a+n))
    return c.mesh(name,verts,faces,mat,component=component,detail=detail)
def text_label(body,loc,size,mat,rotation=(math.pi/2,0,0)):
    path=Path("/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc")
    if not path.exists():return
    data=bpy.data.curves.new(body,"FONT");data.body=body;data.size=size
    data.align_x="CENTER";data.align_y="CENTER";data.resolution_u=3;data.extrude=.015
    data.font=bpy.data.fonts.load(str(path))
    o=bpy.data.objects.new(body,data);c.ASSET.objects.link(o);o.location=loc;o.rotation_euler=rotation
    data.materials.append(c.M[mat])
    bpy.ops.object.select_all(action="DESELECT");o.select_set(True);bpy.context.view_layer.objects.active=o
    bpy.ops.object.convert(target="MESH");o=bpy.context.object
    o["component_id"]="signage";o["near_only"]=True;c.OBJECTS.append(o);o.select_set(False)
def track_guides(xs,length,z,gauge):
    # Studio-only aids: map exports never duplicate the app's railway alignment.
    for x in xs:
        for sign in (-1,1):
            c.box("Preview rail",(x+sign*gauge/2,0,z),(.06,length,.12),"metal",studio=True)
        for i in range(int(length/3)):
            y=-length/2+1.5+i*3
            c.box("Preview sleeper",(x,y,z-.18),(gauge+1,.25,.18),"metal",studio=True)
def dongshan(s):
    p=s["estimatedParameters"];L=p["deckLength"];W=p["deckWidth"];z=p["deckTop"]
    c.box("Elevated viaduct deck",(0,0,z-p["deckThickness"]/2),(W,L,p["deckThickness"]),"structure",component="deck")
    # Three V-support sets at each pier row; left and right spread along the tracks.
    for i in range(p["pierRows"]):
        y=-L/2+12+i*(L-24)/(p["pierRows"]-1)
        row_start=len(c.OBJECTS)
        c.box("Shared footing",(0,y,.35),(7,5,.7),"structure",component="pier-footings")
        for sign in (-1,1):
            c.beam("Transverse V",(0,y,.7),(sign*15,y,z-1.6),1.2,"structure",component="v-piers")
        for x in (-14.5,14.5):
            c.box("Side footing",(x,y,.25),(3,4,.5),"structure",component="pier-footings")
            for sign in (-1,1):
                c.beam("Longitudinal V",(x,y,.6),(x,y+sign*5,z-1.6),.85,"structure",component="v-piers")
        for o in c.OBJECTS[row_start:]:o["near_only"]=bool(i%2)
    for x in p["platformCenters"]:
        c.box("Island platform",(x,0,11.6),(p["platformWidth"],p["platformLength"],1.0),"paving",component="platforms")
        for sign in (-1,1):
            c.box("Platform edge",(x+sign*(p["platformWidth"]/2-.2),0,12.11),(.26,p["platformLength"],.035),"label",component="platforms",detail=True)
    # Separate halls preserve passages across the underside instead of a solid box.
    for y in (-20,20):
        c.box("Separate brick hall",(0,y,3.5),(30,25,7),"brick",component="ground-halls",bevel=.12)
        for sign in (-1,1):
            c.box("Hall recessed glazing",(sign*15.04,y,3.3),(.10,17,4.4),"glass",component="ground-halls")
            for yy in (-7,-3.5,0,3.5,7):
                c.box("Hall window frame",(sign*15.12,y+yy,3.3),(.16,.13,4.5),"metal",component="ground-halls",detail=True)
    c.box("Entrance canopy",(17,0,6.4),(8,15,.55),"structure",component="entrance")
    for y in (-6.5,6.5):c.box("Entrance canopy post",(20,y,3.1),(.45,.45,6.2),"metal",component="entrance")
    text_label("冬山車站",(15.16,-20,5.9),1.5,"label",(math.pi/2,0,math.pi/2))
    for i in range(p["archPairs"]):
        y=-p["canopyLength"]/2+i*p["canopyLength"]/(p["archPairs"]-1)
        for sign in (-1,1):
            points=[]
            for j in range(15):
                a=math.pi*j/14
                points.append((p["archWidth"]/2*math.cos(a),y+sign*p["archSkew"]*math.cos(a),p["archBase"]+p["archRise"]*math.sin(a)))
            o=tube("Crossed arch %02d %s"%(i,sign),points,p["archTubeRadius"],"arch","crossed-arches",detail=bool(i%2 and i!=p["archPairs"]-1))
            o["arch_pair"]=i
    inner=p["canopyLength"]/2-p["roofEndInset"]
    def roof(u,v):
        a=.30+(math.pi-.60)*u
        return ((p["archWidth"]/2-.24)*math.cos(a),-inner+2*inner*v,p["archBase"]+(p["archRise"]-.25)*math.sin(a))
    skin("White membrane canopy",roof,10,24,"membrane","membrane",.08)
    for u in (.12,.32,.50,.68,.88):
        pts=[roof(u,j/24) for j in range(25)]
        tube("Longitudinal canopy seam",[(x,y,z+.10) for x,y,z in pts],.07,"arch","membrane-seams",detail=True,sides=4)
    for sign in (-1,1):
        c.box("Viaduct edge parapet",(sign*(W/2-.18),0,z+.45),(.35,L,.9),"structure",component="parapet")
    track_guides([-15.0,-3.4,3.4,15.0],L,11.05,1.067)
def shilin(s):
    p=s["estimatedParameters"];L=p["deckLength"];W=p["deckWidth"];z=p["deckTop"]
    c.box("Elevated deck",(0,0,z-.7),(W,L,1.4),"structure",component="deck")
    for y in range(-72,73,18):
        for x in (-6,6):
            c.box("Concrete pier",(x,y,4.45),(1.7,2.2,8.9),"structure",component="piers",bevel=.08)
        c.box("Pier crosshead",(0,y,8.6),(21,3,.8),"structure",component="piers")
    c.box("Island platform",(0,0,10.1),(p["platformWidth"],p["platformLength"],1.2),"paving",component="island-platform")
    for y,exit_no in [(65,1),(-65,2)]:
        c.box("Exit %d concourse"%exit_no,(0,y,3.45),(19,24,6.9),"structure",component="exit-%d"%exit_no,bevel=.10)
        end=y+12*(1 if y>0 else -1)
        c.box("Exit %d glazing"%exit_no,(0,end,3.1),(14,.15,4.7),"glass",component="exit-%d"%exit_no)
        c.box("Exit %d lintel"%exit_no,(0,end,5.8),(19,.5,1.2),"red",component="exit-%d"%exit_no)
        for x in (-7,-3.5,0,3.5,7):
            c.box("Exit mullion",(x,end+.1,3.1),(.14,.28,4.7),"metal",component="exit-%d"%exit_no,detail=True)
    text_label("士林站",(0,-77.30,5.8),1.25,"label")
    for y in range(-63,64,9):
        raised=abs(y)<24
        h=p["roofEave"]+(p["raisedCenterHeight"] if raised else 0)
        for x in (-5.6,5.6):
            c.box("Platform roof column",(x,y,(10.7+h)/2),(.55,.6,h-10.7),"red",component="roof-columns")
            sign=1 if x>0 else -1
            c.beam("L bracket upright",(x,y,h-1.1),(x,y,h+.6),.33,"red",component="roof-brackets")
            c.beam("L bracket cantilever",(x,y,h+.5),(sign*11.7,y,h+.5),.36,"red",component="roof-brackets")
            c.beam("Bracket diagonal",(x,y,h-1),(sign*10.5,y,h+.4),.26,"red",component="roof-brackets",detail=True)
    # The central roof is raised; gable ends remain vertical, no hipped temple roof.
    segments=[(-75,-24,0),(-26,26,p["raisedCenterHeight"]),(24,75,0)]
    for n,(a,b,dz) in enumerate(segments):
        inner=p["skylightWidth"]/2;outer=p["roofWidth"]/2
        for sign in (-1,1):
            def roof(u,v):
                x=sign*(inner+(outer-inner)*u)
                zz=p["roofRidge"]+dz-(p["roofRidge"]-p["roofEave"])*u**.65+.38*u**8
                return (x,a+(b-a)*v,zz)
            skin("Xuan-shan roof section %d"%n,roof,8,8,"roof","roof",.16)
            tube("Eave edge",[roof(1,j/12) for j in range(13)],.17,"red","roof-edge",sides=4)
            for j in range(int((b-a)/2)+1):
                y=a+(b-a)*j/max(1,int((b-a)/2))
                points=[roof(k/8,(y-a)/(b-a)) for k in range(9)]
                tube("Tile-profile roof rib",[(x,yy,zz+.06) for x,yy,zz in points],.065,"roof","roof-ribs",detail=True,sides=4)
        # Closed ridge glazing covers the strip between the two roof slopes.
        c.box("Ridge skylight",(0,(a+b)/2,p["roofRidge"]+dz-.02),(p["skylightWidth"]+.12,b-a,.18),"glass",component="ridge-glazing")
        for y in (a,b):
            c.beam("Roof gable tie",(-12.4,y,p["roofEave"]+dz+.15),(12.4,y,p["roofEave"]+dz+.15),.35,"red",component="gable-truss")
            for sign in (-1,1):
                c.beam("Gable rafter",(sign*12,y,p["roofEave"]+dz+.3),(sign*1.1,y,p["roofRidge"]+dz-.20),.32,"red",component="gable-truss")
    for x in (-10.7,10.7):
        c.box("Outer parapet",(x,0,10.25),(.45,L,1.3),"structure",component="parapet")
    for sign in (-1,1):
        c.box("Platform safety-door base",(sign*3.9,0,11.05),(.16,140,.65),"metal",component="platform-doors",detail=True)
        for y in range(-66,67,3):
            c.box("Platform safety-door panel",(sign*3.9,y,11.75),(.10,2.7,.9),"glass",component="platform-doors",detail=True)
    track_guides([-5.8,5.8],L,9.65,1.435)
def formosa(s):
    p=s["estimatedParameters"];W=p["moduleWidth"];L=p["moduleLength"];H=p["moduleHeight"]
    for index,(center,rotation) in enumerate(zip(p["reviewCenters"],p["reviewRotationsDeg"])):
        begin=len(c.OBJECTS);component="entrance-"+chr(65+index)
        # The open central throat is reserved for the descent below ground.
        for sign in (-1,1):
            c.box("Entrance base curb",(sign*6.8,0,.22),(3.2,L,.44),"base",component=component)
        c.box("Landing at grade",(0,L/2-2,.12),(17,4,.24),"base",component=component)
        c.box("Stairwell opening representation",(0,-1,.035),(10.2,L-6,.07),"dark",component=component)
        def surface(side,u,v):
            y=(v-.5)*L
            half=W/2*(.35+.65*math.sin(math.pi*v)**.65)
            ridge=2.5+(H-2.5)*math.sin(math.pi*v*.85)
            edge=.55+1.5*math.sin(math.pi*v)
            x=side*half*u
            z=edge+(ridge-edge)*(1-u**1.45)
            # Curved prayer-hand leaves, not a flat triangular pavilion.
            return (x,y,z)
        for side in (-1,1):
            skin("Curved glass leaf",lambda u,v:surface(side,u,v),4,8,"glass" if side<0 else "glassAlt",component,.06)
            for u in ((0,1) if side<0 else (1,)):
                tube("Primary leaf edge",[surface(side,u,j/14) for j in range(15)],.18,"frame",component,sides=4)
            for j in range(1,12):
                pts=[surface(side,k/4,j/12) for k in range(5)]
                tube("Transverse glazing rib",[(x,y,z+.07) for x,y,z in pts],.09,"frame",component,detail=bool(j%2),sides=4)
            for k in range(1,8):
                pts=[surface(side,k/8,j/12) for j in range(13)]
                tube("Longitudinal glazing mullion",[(x,y,z+.07) for x,y,z in pts],.055,"frame",component,detail=True,sides=4)
        # Local components are individually movable in Blender, not baked global station placement.
        angle=math.radians(rotation);cs=math.cos(angle);sn=math.sin(angle)
        for o in c.OBJECTS[begin:]:
            o["entrance_module"]=chr(65+index)
            o["placement_verified"]=False
            o.location=(center[0]+cs*o.location.x-sn*o.location.y,center[1]+sn*o.location.x+cs*o.location.y,o.location.z)
            o.rotation_euler.z+=angle
    # No underground Dome of Light or hypothetical central pond is inserted.
def station_render(out,meta):
    lo=Vector(meta["bounds"]["min"]);hi=Vector(meta["bounds"]["max"]);target=(lo+hi)/2
    extent=max(hi-lo);sc=c.SC
    sc.render.resolution_x=1200;sc.render.resolution_y=760;sc.cycles.samples=24
    sc.camera.data.clip_end=extent*20
    corners=[Vector((x,y,z)) for x in (lo.x,hi.x) for y in (lo.y,hi.y) for z in (lo.z,hi.z)]
    views=[("hero",(1.2,-.85,.75)),("end",(0,-2,.30)),("roof",(.08,-.03,2))]
    for name,delta in views:
        camera=sc.camera;camera.location=target+extent*Vector(delta)
        camera.rotation_euler=(target-camera.location).to_track_quat("-Z","Y").to_euler()
        inverse=camera.rotation_euler.to_quaternion().inverted()
        p=[inverse@(q-target) for q in corners]
        width=max(q.x for q in p)-min(q.x for q in p);height=max(q.y for q in p)-min(q.y for q in p)
        camera.data.ortho_scale=1.0
        frame=camera.data.view_frame(scene=sc)
        fw=max(v.x for v in frame)-min(v.x for v in frame)
        fh=max(v.y for v in frame)-min(v.y for v in frame)
        camera.data.ortho_scale=max(height/fh,width/fw)*1.16
        sc.render.filepath=str(out/(name+".png"))
        if name=="hero":
            bpy.ops.wm.save_as_mainfile(filepath=str(out/(meta["id"]+".blend")))
        bpy.ops.render.render(write_still=True)
BUILDERS={"dongshan":dongshan,"shilin":shilin,"formosa":formosa}
report=[]
for s in SPECS:
    c.reset()
    for key,color in s["palette"].items():
        c.material(key,color,metal=.10 if key in ("glass","metal","frame") else .02,rough=.4 if key.startswith("glass") else .72)
    BUILDERS[s["legacySceneId"]](s)
    meta={"id":s["id"],"name":s["name"],"stationKeys":s["stationKeys"],"legacySceneId":s["legacySceneId"],
      "assetVariant":s["assetVariant"],"version":1,"status":"station-specific-candidate-awaiting-photo-calibration",
      "stationPositionLonLat":s["stationPositionLonLat"],"anchor":None,
      "realBuildingHeightM":None,"engineeringDimensionsM":None,"heightQuality":"estimated-modelling-parameter",
      "parameters":s["estimatedParameters"],"sources":s["sources"],"photoReferences":s["photoReferences"],
      "confirmedTextFeatures":s["confirmedFeatures"],"pending":s["pending"],
      "modelUse":"map-exterior-preview","orientationMode":"local-facade",
      "railElevationM":None,"trackGuidesExported":False,"paletteSrgb":s["palette"],
      "sharedEntrancePrototype":s.get("sharedEntrancePrototype",False),
      "layoutStatus":s.get("layoutStatus","unverified-station-layout"),
      "notes":["實際 Blender 分件模型；文字有來源的特徵與未量測尺寸分開記錄。",
               "未完成照片逐面校正；不標成正式地圖已完成。",
               "模型本地 Z 是相對地面高度；沒有更改正式軌道高程。"]}
    out=OUT/s["id"]
    result=c.export(out,meta)
    station_render(out,result)
    report.append({"id":s["id"],"name":s["name"],"objects":result["nativeObjectCount"],"lods":{k:v["triangleCount"] for k,v in result["lods"].items()}})
(OUT/"build-report.json").write_text(json.dumps(report,ensure_ascii=False,indent=2)+"\n")
print("STATION_BUILD_OK "+json.dumps(report,ensure_ascii=False),flush=True)
