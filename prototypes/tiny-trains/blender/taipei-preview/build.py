"""臺北車站修訂樣站 02。修正色彩、照明與窗框接合；外觀實拍校正尚未完成。"""
import argparse
import bmesh
import bpy
import hashlib
import json
import math
import os
import struct
import sys
from pathlib import Path
from mathutils import Vector

HERE = Path(__file__).resolve().parent
ID = "taipei-main-exterior-v2-preview02"
parser = argparse.ArgumentParser()
parser.add_argument("--out", type=Path, default=HERE / "output")
parser.add_argument("--skip-render", action="store_true")
args = parser.parse_args(sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else [])
OUT = args.out.resolve()
OUT.mkdir(parents=True, exist_ok=True)
bpy.ops.wm.read_factory_settings(use_empty=True)
SC = bpy.context.scene
SC.unit_settings.system = "METRIC"
SC.unit_settings.scale_length = 1
bpy.context.preferences.filepaths.save_version = 0
SC["asset_id"] = ID
SC["accuracy"] = "外觀風格樣本，尺寸與採光罩細節待現況影像校正"
SC["axes"] = "+X right / -Y front / +Z up / meters"
ASSET = bpy.data.collections.new("01 臺北車站可編輯部件")
STUDIO = bpy.data.collections.new("90 預覽攝影棚（不匯出）")
SC.collection.children.link(ASSET)
SC.collection.children.link(STUDIO)
OBJECTS = []
COLORS = {
    "stone": "B9B1A1", "edge": "C5BEB0", "shadow": "8D877B",
    "roof": "8E3224", "roof_edge": "75251B", "rib": "9C3B29",
    "glass": "364241", "skylight": "596562", "frame": "878B82",
    "door": "253430", "gold": "B5A380", "studio": "D5D5D5",
}
# 修訂色票是美術調整，並非由照片量測；避免標成實拍校色。
M = {}
for key, hex_color in COLORS.items():
    srgb = [int(hex_color[i:i+2], 16)/255 for i in (0, 2, 4)]
    rgb = [v/12.92 if v <= .04045 else ((v+.055)/1.055)**2.4 for v in srgb]
    m = bpy.data.materials.new(key)
    m.use_nodes = True
    m.diffuse_color = (*rgb, 1)
    bs = m.node_tree.nodes.get("Principled BSDF")
    bs.inputs["Base Color"].default_value = (*rgb, 1)
    bs.inputs["Roughness"].default_value = .3 if key in ("glass", "skylight") else .6 if key in ("roof", "roof_edge", "rib") else .85
    bs.inputs["Metallic"].default_value = .12 if key == "gold" else 0
    M[key] = m

def mesh(name, vertices, faces, material, component="body", detail=False, bevel=0, studio=False):
    data = bpy.data.meshes.new(name)
    data.from_pydata(vertices, [], faces)
    data.update()
    bm = bmesh.new()
    bm.from_mesh(data)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(data)
    bm.free()
    obj = bpy.data.objects.new(name, data)
    (STUDIO if studio else ASSET).objects.link(obj)
    data.materials.append(M[material])
    obj["component_id"] = component
    obj["near_only"] = detail
    if bevel:
        if hasattr(data, "use_auto_smooth"):
            data.use_auto_smooth = True
        mod = obj.modifiers.new("柔化邊角", "BEVEL")
        mod.width = bevel
        mod.segments = 2
        obj.modifiers.new("保留平面法線", "WEIGHTED_NORMAL")
    if not studio:
        OBJECTS.append(obj)
    return obj

def box(name, loc, size, material, **kw):
    x, y, z = loc
    w, d, h = size
    vertices = [(x+a*w/2, y+b*d/2, z+c*h/2)
                for a,b,c in [(-1,-1,-1),(-1,-1,1),(-1,1,-1),(-1,1,1),
                              (1,-1,-1),(1,-1,1),(1,1,-1),(1,1,1)]]
    return mesh(name, vertices, [(0,4,6,2),(1,3,7,5),(0,1,5,4),
                                (2,6,7,3),(0,2,3,1),(4,5,7,6)], material, **kw)

def beam(name, a, b, width, material, **kw):
    delta = Vector(b) - Vector(a)
    obj = box(name, (0,0,0), (width,width,delta.length), material, **kw)
    obj.location = (Vector(a)+Vector(b))/2
    obj.rotation_euler = delta.to_track_quat("Z", "Y").to_euler()
    return obj

# 尺寸全部是造型參數；寬深沿用既有 OSM 矩形擬合，並非測繪值。
W, D = 157.4488, 127.4466
BW, BD = 145.0, 115.0
box("接地基座", (0,0,.35), (150,120,.7), "shadow", bevel=.15)
box("大廳與樓層完整量體", (0,0,15.2), (139,109,29.0), "glass", bevel=.18)
box("底層石材基腳", (0,0,1.15), (BW,BD,1.0), "stone", bevel=.1)
for z in (7.2,13.0,18.8,24.6,29.8):
    box("立面水平樓板帶", (0,0,z), (BW,BD,.7), "stone", bevel=.1)
box("簷下連續石材橫樑", (0,0,30.8), (BW+1.2,BD+1.2,2.0), "stone", bevel=.16)

# 正背立面與側立面均保留直立柱列。開間數仍待實拍逐格校正。
for axis, length, fixed, count in [("x",140,BD/2,19),("y",110,BW/2,15)]:
    for sign in (-1,1):
        for i in range(count):
            t = -length/2 + length*i/(count-1)
            loc = (t,sign*fixed,16) if axis == "x" else (sign*fixed,t,16)
            size = (2.0,2.1,28.8) if axis == "x" else (2.1,2.0,28.8)
            box("米色立面方柱", loc, size, "edge", bevel=.16)
        for i in range(count-1):
            t = -length/2 + length*(i+.5)/(count-1)
            # 與橫框、玻璃面接合；前版將豎框錯放到柱廊前緣。
            loc = (t,sign*54.65,17.9) if axis == "x" else (sign*69.65,t,17.9)
            size = (.22,.3,23) if axis == "x" else (.3,.22,23)
            box("窗格細豎框", loc, size, "frame", detail=True)
for sign in (-1,1):
    for z in (4.0,10.0,15.9,21.8,27.4):
        box("正背窗格橫框", (0,sign*54.65,z), (139,.25,.18), "frame", detail=True)
        box("兩側窗格橫框", (sign*69.65,0,z), (.25,109,.18), "frame", detail=True)

# 入口凹影與平直雨遮；未將候車月台或地下街虚構成地上設施。
for sign in (-1,1):
    for x in (-46.6,0,46.6):
        box("南北入口凹影", (x,sign*55.25,3.7), (11.8,.45,5.6), "door")
        box("南北入口門楣", (x,sign*57.6,6.8), (13.2,4.8,.8), "edge", bevel=.18)
        for offset in (-3,0,3):
            box("入口門框", (x+offset,sign*55.55,3.7), (.19,.25,5.5), "frame", detail=True)
    for y in (-36.7,0,36.7):
        # 東／西二門存在有臺鐵租用資訊佐證；門型與位置仍為近似。
        box("東西入口凹影", (sign*70.25,y,3.7), (.45,11.8,5.6), "door")
        box("東西入口門楣", (sign*72.5,y,6.8), (4.8,13.2,.8), "edge", bevel=.18)

# 外圍四坡屋頂與中央覆蓋分開。沒有由天空直通地面的露天洞。
IW, IDP = 78.0, 58.0
EAVE, RIM = 32.2, 43.0
def roof_point(side, u, t):
    a = W/2*(1-t) + IW/2*t
    b = D/2*(1-t) + IDP/2*t
    # 輕微簷口曲率，不把大型站體改成誇張廟宇翹角。
    z = EAVE + (RIM-EAVE)*t**1.28 + .5*abs(u)**8*(1-t)**4
    if side == 0: return (u*a,-b,z)
    if side == 1: return (a,u*b,z)
    if side == 2: return (-u*a,b,z)
    return (-a,-u*b,z)

for side in range(4):
    rows, cols = 7, 16
    vertices = [roof_point(side, -1+2*j/cols, i/rows)
                for i in range(rows+1) for j in range(cols+1)]
    faces = [(i*(cols+1)+j,i*(cols+1)+j+1,(i+1)*(cols+1)+j+1,(i+1)*(cols+1)+j)
             for i in range(rows) for j in range(cols)]
    roof = mesh("四坡紅色主屋面", vertices, faces, "roof", component="roof")
    solid = roof.modifiers.new("屋面厚度", "SOLIDIFY")
    solid.thickness = .4
    solid.offset = -1
    for j in range(24):
        a = roof_point(side,-1+2*j/24,0)
        b = roof_point(side,-1+2*(j+1)/24,0)
        beam("簷口深紅收邊", a,b,.44,"roof_edge",component="roof")
    # 薄帶瓦壟僅保留於近景，避免圓管細節增加手機負擔。
    for j in range(1,46):
        u = -1+2*j/46
        pts = []
        for i in range(rows+1):
            for du in (-.0017,.0017):
                x,y,z = roof_point(side,u+du,i/rows)
                pts.append((x,y,z+.035))
        mesh("屋面瓦壟",pts,[(2*i,2*i+1,2*i+3,2*i+2) for i in range(rows)],
             "rib",component="roof",detail=True)
    for i in range(rows):
        beam("四角斜脊",roof_point(side,-1,i/rows),roof_point(side,-1,(i+1)/rows),
             .65,"roof_edge",component="roof")

# 中央採光罩採實心、不透明近似玻璃材質，兼容舊地圖載入器。
# 分格與高程是可調參數，尚未宣稱符合現況工程尺寸。
box("中央採光罩完整覆蓋面", (0,0,41.4), (IW+1,IDP+1,.55),
    "skylight", component="skylight", bevel=.08)
for y in (-IDP/2,IDP/2):
    box("中央紅色頂框長邊", (0,y,42.25), (IW+1.2,1.2,1.9),
        "roof_edge",component="roof",bevel=.12)
for x in (-IW/2,IW/2):
    box("中央紅色頂框短邊", (x,0,42.25), (1.2,IDP,1.9),
        "roof_edge",component="roof",bevel=.12)
for i in range(1,13):
    box("採光罩直向分格", (-IW/2+IW*i/13,0,41.78), (.3,IDP,.22),
        "frame",component="skylight",detail=True)
for i in range(1,10):
    box("採光罩橫向分格", (0,-IDP/2+IDP*i/10,41.79), (IW,.3,.22),
        "frame",component="skylight",detail=True)

# 標示採向量字形，匯出前轉為網格；不依賴外部字型貼圖。
font_candidates = [
    Path("/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc"),
    Path("/System/Library/Fonts/PingFang.ttc"),
]
font_path = next((p for p in font_candidates if p.exists()), None)
if font_path:
    font = bpy.data.fonts.load(str(font_path))
    curve = bpy.data.curves.new("臺北車站站名字形", "FONT")
    curve.body = "臺北車站"
    curve.font = font
    curve.align_x = "CENTER"
    curve.align_y = "CENTER"
    curve.size = 3.1
    curve.space_character = 1.35
    curve.extrude = .035
    obj = bpy.data.objects.new("臺北車站站名",curve)
    ASSET.objects.link(obj)
    obj.location = (0,-BD/2-1.0,28.3)
    obj.rotation_euler = (math.pi/2,0,0)
    obj.data.materials.append(M["gold"])
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.convert(target="MESH")
    obj = bpy.context.object
    obj["component_id"] = "body"
    obj["near_only"] = True
    OBJECTS.append(obj)
    obj.select_set(False)

bpy.context.view_layer.update()
inventory = [{"name":o.name,"component":o["component_id"],"nearOnly":bool(o["near_only"])}
             for o in OBJECTS]

def write_json(name, data):
    (OUT/name).write_text(json.dumps(data,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")

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
            key = (obj["component_id"],material.name)
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

near,bounds = export_level("near")
far,_ = export_level("far")
assert 0 < far["triangleCount"] < near["triangleCount"] < 60000
assert far["triangleCount"] < 6000
assert abs(bounds["min"][2]) < .001
meta = {
    "id":ID,"stationId":"TRA-1000","name":"臺北車站","version":2,
    "status":"revised-preview-awaiting-photo-calibration","application":bpy.app.version_string,
    "revision":2,"paletteSrgb":COLORS,"colorCalibration":"artist-adjusted-not-photo-measured",
    "geometryVisuallyVerified":False,"productionReady":False,
    "anchor":[121.51711425,25.0477174],"rotationDeg":None,
    "facadeBearingDeg":None,"realBuildingHeightM":None,"railElevationM":None,
    "absoluteGroundAltitudeM":None,"engineeringDimensionsM":None,
    "axes":{"up":"+Z","right":"+X","front":"-Y","units":"meters","groundAnchor":[0,0,0]},
    "gltfAxes":{"up":"+Y","toZUp":"rotateX(+PI/2)"},
    "orientationMode":"local-facade",
    "bounds":bounds,"sizeM":[bounds["max"][i]-bounds["min"][i] for i in range(3)],
    "lods":{"near":near,"far":far},"nativeObjectCount":len(OBJECTS),
    "centralSkylight":{"covered":True,"profileVerified":False},
    "sourcePhotosIncluded":False,"photoVisuallyVerified":False,
    "operatorLogoIncluded":False,"modelUse":"map-exterior-preview",
    "components":[{"id":"body"},{"id":"roof"},{"id":"skylight"}],
    "notes":["修訂 02：修正粉白配色、採中性日光、讓豎窗框接回玻璃面，補東西二門。",
             "照片像素仍無法檢視，未完成實拍校色與逐面造型校正；開間、樓層線、字形與採光罩仍為估值。",
             "尺寸為造型參數，寬深參考既有 OSM 擬合值；不可作工程尺寸。",
             "遠景移除瓦壟、細框、字形、採光罩細格與小倒角，保留中央覆蓋面。",
             "攝影棚不納入 GLB 與 mesh.bin；尚未替換正式地圖資產。"],
}
write_json("model.json",meta)
write_json("objects.json",inventory)
# 待朝向校正後才可轉成正式 placement；不把 null 偷換成舊朝向。
write_json("placement-preview.json",{
    "id":ID,"stationId":"TRA-1000","anchor":meta["anchor"],
    "rotationDeg":None,"placementStatus":"pending-facade-verification",
    "productionReady":False,"suggestedZoom":{"nearMin":16,"farMin":14,"farMax":16}
})

# 成品以模型實際渲染，非生成式概念圖。
SC.world = bpy.data.worlds.new("中性日光校閱")
SC.world.use_nodes = True
SC.world.node_tree.nodes["Background"].inputs[0].default_value = (.45,.45,.45,1)
SC.world.node_tree.nodes["Background"].inputs[1].default_value = .6
SC.render.engine = "CYCLES"
SC.cycles.device = "CPU"
SC.cycles.samples = 32
SC.cycles.max_bounces = 4
SC.cycles.diffuse_bounces = 2
SC.cycles.glossy_bounces = 2
SC.cycles.use_adaptive_sampling = True
SC.cycles.adaptive_threshold = .04
SC.cycles.use_denoising = False
SC.render.resolution_x = 1024
SC.render.resolution_y = 800
SC.render.resolution_percentage = 100
# 中性色彩檢視；不將曝光、濾鏡或攝影棚暖色寫進地圖材質。
SC.view_settings.view_transform = "Standard"
SC.view_settings.look = "None"
SC.view_settings.exposure = 0
SC.view_settings.gamma = 1
SC.render.image_settings.file_format = "PNG"
box("僅預覽用中性地面",(0,0,-.3),(2000,2000,.5),"studio",studio=True)
target = Vector((0,0,18))
data = bpy.data.lights.new("中性日光","SUN")
sun = bpy.data.objects.new("中性日光",data)
STUDIO.objects.link(sun)
sun.location = (-150,-170,260)
data.energy = 2
data.angle = math.radians(10)
data.color = (1,1,1)
sun.rotation_euler = (target-sun.location).to_track_quat("-Z","Y").to_euler()
camera_data = bpy.data.cameras.new("正交樣站相機")
camera = bpy.data.objects.new("正交樣站相機",camera_data)
STUDIO.objects.link(camera)
SC.camera = camera
camera_data.type = "ORTHO"
camera_data.ortho_scale = 216
camera_data.clip_end = 3000
views = [
    ("hero",(190,-240,205),216),
    ("front",(0,-280,95),185),
    ("roof",(0,-1,340),184),
]
for name,loc,scale in views:
    camera.location = loc
    camera.rotation_euler = (target-camera.location).to_track_quat("-Z","Y").to_euler()
    camera_data.ortho_scale = scale
    SC.render.filepath = str(OUT/(name+".png"))
    if name == "hero":
        for screen in bpy.data.screens:
            for area in screen.areas:
                if area.type == "VIEW_3D":
                    region = area.spaces.active.region_3d
                    region.view_distance = 240
                    region.view_location = target
                    region.view_rotation = camera.rotation_euler.to_quaternion()
        bpy.ops.object.select_all(action="DESELECT")
        OBJECTS[0].select_set(True)
        bpy.context.view_layer.objects.active = OBJECTS[0]
        bpy.ops.wm.save_as_mainfile(filepath=str(OUT/(ID+".blend")))
    if not args.skip_render:
        bpy.ops.render.render(write_still=True)
print("MODEL_BUILD_OK "+json.dumps({"id":ID,"triangles":{"near":near["triangleCount"],"far":far["triangleCount"]},
                                    "sizeM":meta["sizeM"],"objects":len(OBJECTS)},ensure_ascii=False),flush=True)
