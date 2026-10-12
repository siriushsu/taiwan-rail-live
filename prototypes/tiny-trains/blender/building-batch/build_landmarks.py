"""Two distinct landmark revisions, with evidence separated from estimated design parameters."""
import bpy, json, math, sys
from pathlib import Path
HERE=Path(__file__).resolve().parent
sys.path.insert(0,str(HERE))
import core as c
ROOT=HERE.parents[3]
OUT=Path(sys.argv[sys.argv.index("--")+1]) if "--" in sys.argv else HERE/"output"
SPECS=json.loads((HERE/"landmarks.json").read_text())
def rim(name,z,w,d,h,mat,center=(0,0),cut=.08,detail=False,component="trim"):
    return c.taper(name,z,z+h+.06,w,d,w,d,mat,center=center,cut=cut,detail=detail,component=component)
def medallion(name,center,radius,mat,rotation=0):
    # Flat ring, preserved as editable mesh; an architectural motif, not a logo.
    verts=[];faces=[]
    for r in (radius,radius*.72):
        for i in range(24):
            a=2*math.pi*i/24
            verts.append((r*math.cos(a),0,r*math.sin(a)))
    for i in range(24):j=(i+1)%24;faces.append((i,j,j+24,i+24))
    o=c.mesh(name,verts,faces,mat,component="ornament",detail=True)
    o.location=center;o.rotation_euler.z=rotation
def taipei101(s):
    p=s["estimatedParameters"];x,y=p["towerCenter"];center=(x,y)
    mx,my=p["mallCenter"];mw,md,mh=p["mallSize"]
    c.box("Retail podium",(mx,my,mh/2),(mw,md,mh),"stone",component="retail",bevel=.22)
    for z in (5,10,15,20,25):
        for side in (-1,1):
            c.box("Retail glazing",(mx,my+side*(md/2+.08),z),(mw-6,.16,2.1),"glass",component="retail")
    for xx in range(-60,61,12):
        c.box("Retail vertical joint",(mx+xx,my-md/2-.2,mh/2),(.32,.25,mh-2),"frame",component="retail",detail=True)
    # Segmented solid skylight: exported without alpha sorting.
    for i in range(12):
        xx=mx-44+i*8
        c.box("Retail roof glazing",(xx,my+6,mh+.22),(7.6,26,.44),"glass",component="retail")
    c.taper("Tapered tower base",0,p["baseTop"],p["baseWidth"],p["baseWidth"],p["waistWidth"],p["waistWidth"],
            "glass",center=center,component="tower-base")
    c.facade_grid("Base",0,p["baseTop"],63,63,46,46,26,14,"frame",center=center)
    for z in (30,57,86,115):
        w=63+(46-63)*z/117
        rim("Base belt",z,w+.8,w+.8,1.4,"edge",center)
    for i in range(p["moduleCount"]):
        z=p["baseTop"]+i*p["moduleHeight"];top=z+p["moduleHeight"]
        o=c.taper("Bamboo module %02d"%(i+1),z,top,47,47,55,55,"glass",center=center,component="module-%02d"%(i+1))
        o["repeat_index"]=i+1
        # Opaque roof surface; the tier ledge is not reflective facade glass.
        o.data.materials.append(c.M["edge"])
        for face in o.data.polygons:
            if face.normal.z > .9: face.material_index = 1
        c.facade_grid("Module %02d"%(i+1),z,top,47,47,55,55,8,12,"frame",center=center)
        rim("Module overhanging rim",top-1,56.2,56.2,1,"edge",center)
        # Wide corner ribs describe the tier silhouette even in the far LOD.
        a=c.ring(47.2,47.2,z,center=center);b=c.ring(55.2,55.2,top,center=center)
        for j in range(8):c.beam("Module corner rib",a[j],b[j],.46,"edge",component="corner-ribs")
    start=p["baseTop"]+p["moduleCount"]*p["moduleHeight"]
    c.taper("Narrow upper crown",start,438,30,30,36,36,"glass",center=center,component="crown")
    c.facade_grid("Crown",start,438,30,30,36,36,10,8,"frame",center=center)
    rim("Crown rim",437,37,37,1.5,"edge",center)
    c.taper("Crown upper enclosure",438,448,26,26,23,23,"glass",center=center,component="crown")
    c.taper("Spire lower",448,470,8.5,8.5,6.2,6.2,"edge",center=center,component="spire")
    c.taper("Spire middle",470,490,6.2,6.2,3.2,3.2,"frame",center=center,component="spire")
    c.taper("Spire tip",490,508,3.2,3.2,.18,.18,"frame",center=center,component="spire")
    for z in (453,460,468,476,484):
        w=8.5-(z-448)*.13
        rim("Spire collars",z,w+.6,w+.6,.6,"edge",center,detail=True,component="spire")
    for sign in (-1,1):
        medallion("Round facade motif",(x,y+sign*25.5,109),7,"ornament")
        medallion("Round side motif",(x+sign*25.5,y,109),7,"ornament",math.pi/2)
def shinkong(s):
    p=s["estimatedParameters"];w,d,h=p["podiumSize"];center=tuple(p["towerCenter"])
    c.taper("Department store podium",0,h,w,d,w,d,"rose",component="retail",cut=.04)
    for z in [4.4+i*4.25 for i in range(12)]:
        rim("Department store glazed band",z,w+.10,d+.10,1.5,"glass",cut=.04,component="retail")
        rim("Department store stone edge",z-0.35,w+.2,d+.2,.45,"trim",cut=.04,component="retail")
    # Ground floor lobby and canopies remain separate editable components.
    for x in (-12,0,12):
        c.box("North entry glass",(x,-42.12,2.2),(8,.20,4.4),"shadow",component="entrance")
        c.box("Entry canopy",(x,-43.2,4.8),(9,3.0,.5),"trim",component="entrance",bevel=.15)
    tw,td=p["towerSize"]
    c.taper("Office curtain wall",h,p["officeTop"],tw,td,tw,td,"glass",center=center,cut=.10,component="office")
    for i in range(33):
        z=h+i*(p["officeTop"]-h)/33
        rim("Office rose spandrel",z,tw+.18,td+.18,1.30,"rose",center,cut=.10,
            detail=(i%2==1),component="office-facade")
    a=c.ring(tw+.30,td+.30,h,.10,center);b=c.ring(tw+.30,td+.30,p["officeTop"],.10,center)
    for i in range(8):c.beam("Continuous corner pier",a[i],b[i],.68,"trim",component="office-facade")
    for side in range(4):
        i=2*side;j=i+1
        for k in range(1,9):
            aa=tuple(a[i][n]+(a[j][n]-a[i][n])*k/9 for n in range(3))
            bb=tuple(b[i][n]+(b[j][n]-b[i][n])*k/9 for n in range(3))
            c.beam("Office vertical rose mullion",aa,bb,.36,"rose",component="office-facade",detail=True)
    for z in (59,65,190,195):rim("Transition belt",z,tw+.8,td+.8,1.2,"trim",center,cut=.10)
    c.taper("Upper mechanical enclosure",196,205,35,51,35,51,"rose",center=center,component="crown")
    for z in range(197,205,2):rim("Mechanical louvre",z,35.2,51.2,.65,"shadow",center,detail=True,component="crown")
    c.taper("Stepped crown base",205,211,31,46,29,43,"trim",center=center,component="crown")
    c.taper("Pyramidal roof",211,p["crownRoofTop"],29,43,2.3,3.5,"rose",center=center,cut=.025,component="pyramid")
    a=c.ring(29.1,43.1,211,.025,center);b=c.ring(2.4,3.6,p["crownRoofTop"],.025,center)
    for i in range(8):c.beam("Pyramid raised seam",a[i],b[i],.20,"trim",component="pyramid",detail=True)
    c.taper("Roof finial",238.15,244.15,1.1,1.1,.16,.16,"metal",center=center,component="spire")
BUILDERS={"taipei101-landmark-v1":taipei101,"shinkong-landmark-v1":shinkong}
report=[]
for old_id,s in SPECS.items():
    c.reset()
    for key,col in s["palette"].items():c.material(key,col,metal=.15 if key=="glass" else .06,rough=.32 if key=="glass" else .65)
    BUILDERS[old_id](s)
    old=json.loads((ROOT/"rail-3d/assets/blender-buildings-v1"/old_id/"model.json").read_text())
    meta={"id":s["revisionId"],"name":s["name"],"legacyAssetId":old_id,"version":2,
      "status":"geometry-revision-candidate-awaiting-photo-review","realBuildingHeightM":s["heightM"],
      "heightQuality":"Official total height; component proportions remain estimated.",
      "anchor":old["anchor"],"anchorStatus":"inherited-unverified","engineeringDimensionsM":None,
      "paletteSrgb":s["palette"],"parameters":s["estimatedParameters"],"sources":s["evidence"],
      "modelUse":"map-exterior-preview","orientationMode":"local-facade",
      "notes":["可編輯分件重製；未完成實景逐面校正。","分件尺寸、玻璃色與基座配置仍為建模估值，總高採官方資料。",
               "未替換正式地圖資產；錨點與真北方向待核對。"]}
    out=OUT/s["revisionId"]
    result=c.export(out,meta)
    assert abs(result["sizeM"][2]-s["heightM"])<.002
    if old_id.startswith("taipei101"):
        assert len([o for o in c.OBJECTS if o.get("repeat_index")])==8
    c.render(out,result["bounds"])
    report.append({"id":s["revisionId"],"objects":result["nativeObjectCount"],"lods":{k:v["triangleCount"] for k,v in result["lods"].items()}})
    # Same camera framing, lighting and colour management for the old reference model.
    oldmeta=c.load_legacy(ROOT/"rail-3d/assets/blender-buildings-v1"/old_id)
    c.studio(oldmeta["bounds"])
    c.render(out,oldmeta["bounds"],"legacy-")
(OUT/"build-report.json").write_text(json.dumps(report,ensure_ascii=False,indent=2)+"\n")
print("LANDMARK_BUILD_OK "+json.dumps(report,ensure_ascii=False),flush=True)
