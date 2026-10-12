"""Shared editable meshes and map exports. Coordinates are metres, Z up."""
import bpy, bmesh, hashlib, json, math, struct
from pathlib import Path
from mathutils import Vector
OBJECTS=[]
M={}
def reset():
    global SC, ASSET, STUDIO, OBJECTS, M
    bpy.ops.wm.read_factory_settings(use_empty=True)
    SC=bpy.context.scene
    SC.unit_settings.system="METRIC"
    SC.unit_settings.scale_length=1
    bpy.context.preferences.filepaths.save_version=0
    ASSET=bpy.data.collections.new("01 Editable building")
    STUDIO=bpy.data.collections.new("90 Preview studio - excluded from export")
    SC.collection.children.link(ASSET)
    SC.collection.children.link(STUDIO)
    OBJECTS=[]
    M={}
def material(name,hex_color=None,linear=None,metal=.1,rough=.65):
    rgb=linear
    if rgb is None:
        v=[int(hex_color[i:i+2],16)/255 for i in (0,2,4)]
        rgb=[x/12.92 if x<=.04045 else ((x+.055)/1.055)**2.4 for x in v]
    m=bpy.data.materials.new(name)
    m.use_nodes=True
    m.diffuse_color=(*rgb,1)
    bs=m.node_tree.nodes.get("Principled BSDF")
    bs.inputs["Base Color"].default_value=(*rgb,1)
    bs.inputs["Metallic"].default_value=metal
    bs.inputs["Roughness"].default_value=rough
    M[name]=m
    return m
def mesh(name,vertices,faces,mat,component="body",detail=False,bevel=0,studio=False):
    data=bpy.data.meshes.new(name)
    data.from_pydata(vertices,[],faces)
    data.update()
    bm=bmesh.new();bm.from_mesh(data)
    bmesh.ops.recalc_face_normals(bm,faces=bm.faces)
    bm.to_mesh(data);bm.free()
    obj=bpy.data.objects.new(name,data)
    (STUDIO if studio else ASSET).objects.link(obj)
    data.materials.append(M[mat])
    obj["component_id"]=component
    obj["near_only"]=detail
    if bevel:
        if hasattr(data,"use_auto_smooth"):data.use_auto_smooth=True
        m=obj.modifiers.new("Small edge softening","BEVEL");m.width=bevel;m.segments=1
        obj.modifiers.new("Weighted face normals","WEIGHTED_NORMAL")
    if not studio:OBJECTS.append(obj)
    return obj
def box(name,loc,size,mat,**kw):
    x,y,z=loc;w,d,h=size
    v=[(x+a*w/2,y+b*d/2,z+c*h/2) for a,b,c in
       [(-1,-1,-1),(-1,-1,1),(-1,1,-1),(-1,1,1),(1,-1,-1),(1,-1,1),(1,1,-1),(1,1,1)]]
    return mesh(name,v,[(0,4,6,2),(1,3,7,5),(0,1,5,4),(2,6,7,3),(0,2,3,1),(4,5,7,6)],mat,**kw)
def beam(name,a,b,width,mat,**kw):
    delta=Vector(b)-Vector(a)
    o=box(name,(0,0,0),(width,width,delta.length),mat,**kw)
    o.location=(Vector(a)+Vector(b))/2
    o.rotation_euler=delta.to_track_quat("Z","Y").to_euler()
    return o
def ring(w,d,z,cut=.08,center=(0,0)):
    x,y=center;c=min(w,d)*cut
    return [(x+xx,y+yy,z) for xx,yy in
            [(-w/2+c,-d/2),(w/2-c,-d/2),(w/2,-d/2+c),(w/2,d/2-c),
             (w/2-c,d/2),(-w/2+c,d/2),(-w/2,d/2-c),(-w/2,-d/2+c)]]
def taper(name,z0,z1,w0,d0,w1,d1,mat,center=(0,0),cut=.08,**kw):
    a=ring(w0,d0,z0,cut,center);b=ring(w1,d1,z1,cut,center)
    return mesh(name,a+b,[tuple(range(7,-1,-1)),tuple(range(8,16))]+
                [(i,(i+1)%8,(i+1)%8+8,i+8) for i in range(8)],mat,**kw)
def facade_grid(name,z0,z1,w0,d0,w1,d1,floors,cols,mat,center=(0,0),cut=.08):
    # One mesh per material; fine lines do not become hundreds of draw calls.
    for j in range(1,floors):
        t=j/floors;w=w0+(w1-w0)*t;d=d0+(d1-d0)*t;z=z0+(z1-z0)*t
        a=ring(w+.08,d+.08,z,cut,center)
        b=ring(w+.08,d+.08,z+.24,cut,center)
        mesh(name+" horizontal",a+b,[(i,(i+1)%8,(i+1)%8+8,i+8) for i in range(8)],
             mat,component="facade",detail=True)
    for side in range(4):
        # Only the long flat faces of the chamfered polygon.
        i=side*2;j=(i+1)%8
        aa=ring(w0+.1,d0+.1,z0,cut,center);bb=ring(w1+.1,d1+.1,z1,cut,center)
        for k in range(1,cols):
            f=k/cols
            a=Vector(aa[i]).lerp(Vector(aa[j]),f)
            b=Vector(bb[i]).lerp(Vector(bb[j]),f)
            if z0 == 0: a.z = .12  # Keep the tilted beam cross-section above ground.
            beam(name+" mullion",a,b,.20,mat,component="facade",detail=True)
def export_level(level):
    # 遠景移除小倒角，保留同一建築輪廓；原檔與近景仍保留修改器。
    changed_modifiers = []
    if level == "far":
        for obj in OBJECTS:
            for modifier in obj.modifiers:
                if modifier.type in {"BEVEL", "WEIGHTED_NORMAL"}:
                    changed_modifiers.append((modifier, modifier.show_viewport))
                    modifier.show_viewport = False
    bpy.context.view_layer.update()
    deps = bpy.context.evaluated_depsgraph_get()
    buckets = {}
    lo, hi = [math.inf]*3, [-math.inf]*3
    for obj in OBJECTS:
        if level == "far" and obj["near_only"]:
            continue
        ev = obj.evaluated_get(deps)
        data = ev.to_mesh()
        data.calc_loop_triangles()
        if hasattr(data,"calc_normals_split"):
            data.calc_normals_split()
        wm = obj.matrix_world
        nm = wm.to_3x3().inverted_safe().transposed()
        for tri in data.loop_triangles:
            if tri.area < 1e-8:
                continue
            material = data.materials[tri.material_index]
            key = ("main",material.name)  # Runtime batches by material; Blender retains editable components.
            bucket = buckets.setdefault(key,{"material":material,"v":[]})
            for li in tri.loops:
                p = wm @ data.vertices[data.loops[li].vertex_index].co
                normal = data.corner_normals[li].vector if hasattr(data,"corner_normals") else data.loops[li].normal
                n = (nm @ normal).normalized()
                if not all(math.isfinite(v) for v in (*p,*n)):
                    raise ValueError("網格存在非有限座標")
                bucket["v"].extend((*p,*n))
                for axis in range(3):
                    lo[axis],hi[axis] = min(lo[axis],p[axis]),max(hi[axis],p[axis])
        ev.to_mesh_clear()
    raw, groups, exports, count = bytearray(), [], [], 0
    collection = bpy.data.collections.new("暫存匯出網格")
    SC.collection.children.link(collection)
    for (component,name),item in buckets.items():
        v, m = item["v"],item["material"]
        n = len(v)//6
        raw.extend(struct.pack("<%sf"%len(v),*v))
        bs = m.node_tree.nodes.get("Principled BSDF")
        groups.append({"component":component,"name":name,"start":count,"count":n,
                       "color":list(bs.inputs["Base Color"].default_value)[:3],
                       "metalness":bs.inputs["Metallic"].default_value,
                       "roughness":bs.inputs["Roughness"].default_value})
        count += n
        data = bpy.data.meshes.new(component+" "+name)
        data.from_pydata([v[i:i+3] for i in range(0,len(v),6)],[],
                         [(i,i+1,i+2) for i in range(0,n,3)])
        data.materials.append(m)
        data.update()
        data.normals_split_custom_set_from_vertices([v[i+3:i+6] for i in range(0,len(v),6)])
        o = bpy.data.objects.new(component+" "+name,data)
        collection.objects.link(o)
        o["component_id"] = component
        exports.append(o)
    (OUT/(level+".mesh.bin")).write_bytes(raw)
    bpy.ops.object.select_all(action="DESELECT")
    for o in exports:
        o.select_set(True)
    bpy.context.view_layer.objects.active = exports[0]
    bpy.ops.export_scene.gltf(filepath=str(OUT/(level+".glb")),export_format="GLB",
                              use_selection=True,export_yup=True,export_normals=True,
                              export_texcoords=False,export_extras=True)
    for o in exports:
        bpy.data.objects.remove(o,do_unlink=True)
    bpy.data.collections.remove(collection)
    for modifier, visible in changed_modifiers:
        modifier.show_viewport = visible
    bpy.context.view_layer.update()
    return {"file":level+".mesh.bin","glb":level+".glb",
            "sha256":hashlib.sha256(raw).hexdigest(),
            "glbSha256":hashlib.sha256((OUT/(level+".glb")).read_bytes()).hexdigest(),
            "strideBytes":24,"vertexCount":count,"triangleCount":count//3,
            "byteLength":len(raw),"drawGroups":groups}, {"min":lo,"max":hi}

def export(out,meta):
    global OUT
    OUT=Path(out);OUT.mkdir(parents=True,exist_ok=True)
    bpy.context.view_layer.update()
    near,bounds=export_level("near")
    far,far_bounds=export_level("far")
    if not (0<far["triangleCount"]<near["triangleCount"]<60000):raise AssertionError("LOD budget")
    far_budget=meta.get("farTriangleBudget",6000)
    if not isinstance(far_budget,int) or not 1<=far_budget<=10000:raise AssertionError("invalid far budget")
    if far["triangleCount"]>far_budget:raise AssertionError(f"far budget: {far['triangleCount']} > {far_budget}")
    meta.update({"application":bpy.app.version_string,"bounds":bounds,
      "sizeM":[bounds["max"][i]-bounds["min"][i] for i in range(3)],
      "lods":{"near":near,"far":far},"nativeObjectCount":len(OBJECTS),
      "runtimeGrouping":"material","components":[{"id":x} for x in sorted({o["component_id"] for o in OBJECTS})],
      "railElevationM":None,
      "axes":{"up":"+Z","right":"+X","front":"-Y","units":"meters","groundAnchor":[0,0,0]},
      "gltfAxes":{"up":"+Y","toZUp":"rotateX(+PI/2)"},
      "geometryVisuallyVerified":False,"productionReady":False,"photoVisuallyVerified":False,
      "sourcePhotosIncluded":False,"colorCalibration":"artist-selected-not-photo-measured",
      "facadeBearingDeg":None,"rotationDeg":None,"absoluteGroundAltitudeM":None})
    if abs(bounds["min"][2])>.001:raise AssertionError("Ground contact")
    (OUT/"model.json").write_text(json.dumps(meta,ensure_ascii=False,indent=2)+"\n")
    (OUT/"objects.json").write_text(json.dumps([{"name":o.name,"component":o["component_id"],
       "nearOnly":bool(o["near_only"])} for o in OBJECTS],ensure_ascii=False,indent=2)+"\n")
    SC["asset_id"]=meta["id"]
    SC["accuracy"]="Revision candidate; photo and placement review pending"
    studio(bounds)
    bpy.ops.wm.save_as_mainfile(filepath=str(OUT/(meta["id"]+".blend")))
    return meta
def studio(bounds):
    material("studio","DADDD8",metal=0,rough=.9)
    lo=Vector(bounds["min"]);hi=Vector(bounds["max"]);target=(lo+hi)/2
    h=max(hi-lo)
    box("Studio ground",(target.x,target.y,lo.z-.3),(h*8,h*8,.5),"studio",studio=True)
    SC.world=bpy.data.worlds.new("Neutral daylight");SC.world.use_nodes=True
    SC.world.node_tree.nodes["Background"].inputs[0].default_value=(.55,.55,.55,1)
    SC.world.node_tree.nodes["Background"].inputs[1].default_value=.75
    SC.render.engine="CYCLES";SC.cycles.device="CPU";SC.cycles.samples=20
    SC.cycles.max_bounces=4;SC.cycles.use_denoising=False
    SC.render.resolution_x=660;SC.render.resolution_y=860;SC.render.resolution_percentage=100
    SC.render.image_settings.file_format="PNG"
    SC.view_settings.view_transform="Standard";SC.view_settings.look="None"
    light=bpy.data.lights.new("Daylight","SUN");light.energy=1.8;light.angle=math.radians(15)
    sun=bpy.data.objects.new("Daylight",light);STUDIO.objects.link(sun)
    sun.rotation_euler=(math.radians(28),math.radians(-24),math.radians(-35))
    camdata=bpy.data.cameras.new("Orthographic comparison");camdata.type="ORTHO"
    camdata.clip_end=h*20
    cam=bpy.data.objects.new("Orthographic comparison",camdata);STUDIO.objects.link(cam);SC.camera=cam
    cam.location=target+Vector((h*1.2,-h*1.8,h*.65))
    cam.rotation_euler=(target-cam.location).to_track_quat("-Z","Y").to_euler()
    camdata.ortho_scale=h*1.15
    for screen in bpy.data.screens:
        for area in screen.areas:
            if area.type=="VIEW_3D":
                reg=area.spaces.active.region_3d;reg.view_distance=h*1.6
                reg.view_location=target;reg.view_rotation=cam.rotation_euler.to_quaternion()
def render(out,bounds,prefix=""):
    lo=Vector(bounds["min"]);hi=Vector(bounds["max"]);target=(lo+hi)/2;h=max(hi-lo)
    for name,delta in [("hero",(1.2,-1.8,.65)),("front",(0,-2,0))]:
        cam=SC.camera;cam.location=target+Vector(delta)*h
        cam.rotation_euler=(target-cam.location).to_track_quat("-Z","Y").to_euler()
        SC.render.filepath=str(Path(out)/(prefix+name+".png"))
        bpy.ops.render.render(write_still=True)
def load_legacy(path,level="near"):
    reset();path=Path(path);meta=json.loads((path/"model.json").read_text())
    lod=meta["lods"][level];raw=(path/lod["file"]).read_bytes()
    assert hashlib.sha256(raw).hexdigest()==lod["sha256"]
    v=list(struct.iter_unpack("<6f",raw))
    for n,g in enumerate(lod["drawGroups"]):
        key=str(n)+" "+g["name"]
        material(key,linear=g["color"][:3],metal=g.get("metalness",.1),rough=g.get("roughness",.6))
        verts=v[g["start"]:g["start"]+g["count"]]
        obj=mesh(g.get("component","main")+" "+key,[p[:3] for p in verts],
             [(i,i+1,i+2) for i in range(0,len(verts),3)],key,component=g.get("component","main"))
        obj.data.normals_split_custom_set_from_vertices([p[3:] for p in verts])
    bpy.context.view_layer.update()
    return meta
