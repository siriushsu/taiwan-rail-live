"""驗證實際匯出檔：格式、界限、法線、中央覆蓋與 GLB 往返。"""
import bpy
import hashlib
import json
import math
import struct
import sys
from pathlib import Path
from mathutils import Vector
from mathutils.bvhtree import BVHTree

out = Path(sys.argv[sys.argv.index("--")+1])
meta = json.loads((out/"model.json").read_text())
report = {"asset":meta["id"],"lods":{}}
for level,spec in meta["lods"].items():
    raw = (out/spec["file"]).read_bytes()
    assert len(raw) == spec["byteLength"] == spec["vertexCount"]*24
    assert spec["vertexCount"] == spec["triangleCount"]*3
    assert hashlib.sha256(raw).hexdigest() == spec["sha256"]
    points = []
    for x,y,z,nx,ny,nz in struct.iter_unpack("<6f",raw):
        assert all(math.isfinite(v) for v in (x,y,z,nx,ny,nz))
        assert abs(nx*nx+ny*ny+nz*nz-1) < .002
        points.append(Vector((x,y,z)))
    cursor = 0
    for group in spec["drawGroups"]:
        assert group["start"] == cursor and group["count"]%3 == 0
        cursor += group["count"]
    assert cursor == len(points)
    tree = BVHTree.FromPolygons(points,[(i,i+1,i+2) for i in range(0,len(points),3)],all_triangles=True)
    covered = 0
    for x in (-30,-15,0,15,30):
        for y in (-20,0,20):
            hit,normal,index,distance = tree.ray_cast(Vector((x,y,100)),Vector((0,0,-1)))
            assert hit is not None and hit.z > 40, ("中央採光區沒有屋面覆蓋",level,x,y,hit)
            covered += 1
    glb = (out/spec["glb"]).read_bytes()
    magic,version,length = struct.unpack_from("<4sII",glb)
    assert magic == b"glTF" and version == 2 and length == len(glb)
    assert hashlib.sha256(glb).hexdigest() == spec["glbSha256"]
    json_size,chunk = struct.unpack_from("<I4s",glb,12)
    assert chunk == b"JSON"
    gltf = json.loads(glb[20:20+json_size])
    assert not gltf.get("images") and not gltf.get("textures") and not gltf.get("cameras")
    assert all(m.get("alphaMode","OPAQUE") == "OPAQUE" for m in gltf["materials"])
    assert not any("攝影棚" in n.get("name","") or "預覽" in n.get("name","") for n in gltf["nodes"])
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=str(out/spec["glb"]))
    bpy.context.view_layer.update()
    imported = []
    triangles = 0
    for obj in bpy.context.scene.objects:
        if obj.type != "MESH":
            continue
        obj.data.calc_loop_triangles()
        triangles += len(obj.data.loop_triangles)
        imported.extend(obj.matrix_world @ vertex.co for vertex in obj.data.vertices)
    assert triangles == spec["triangleCount"], (level,triangles,spec["triangleCount"])
    raw_bounds = [[min(p[i] for p in points) for i in range(3)],
                  [max(p[i] for p in points) for i in range(3)]]
    roundtrip_bounds = [[min(p[i] for p in imported) for i in range(3)],
                        [max(p[i] for p in imported) for i in range(3)]]
    error = max(abs(a-b) for row_a,row_b in zip(raw_bounds,roundtrip_bounds) for a,b in zip(row_a,row_b))
    assert error < .005, ("GLB 軸向或比例錯誤",level,error)
    report["lods"][level] = {"triangles":triangles,"drawGroups":len(spec["drawGroups"]),
                              "coveredRoofProbeCount":covered,"boundsRoundtripErrorM":error,
                              "glbBytes":len(glb),"meshBytes":len(raw)}
blend = out/(meta["id"]+".blend")
assert blend.is_file() and blend.stat().st_size > 100000
bpy.ops.wm.open_mainfile(filepath=str(blend))
editable = bpy.data.collections["01 臺北車站可編輯部件"]
assert len(editable.objects) == meta["nativeObjectCount"]
assert any("中央採光罩完整覆蓋面" in obj.name for obj in editable.objects)
# 檢查豎窗框確實接到橫窗框；可攔截前版浮在柱廊前緣的格柵。
def world_bounds(obj):
    corners = [obj.matrix_world @ Vector(p) for p in obj.bound_box]
    return [[min(p[i] for p in corners) for i in range(3)],
            [max(p[i] for p in corners) for i in range(3)]]
def intersects(a,b):
    return all(a[0][i] <= b[1][i]+.001 and b[0][i] <= a[1][i]+.001 for i in range(3))
verticals = [o for o in editable.objects if o.name.startswith("窗格細豎框")]
horizontals = [world_bounds(o) for o in editable.objects if o.name.startswith(("正背窗格橫框","兩側窗格橫框"))]
assert verticals and horizontals
assert all(any(intersects(world_bounds(o),h) for h in horizontals) for o in verticals), "窗框沒有接合"
assert meta["lods"]["far"]["triangleCount"] < 6000
assert meta["photoVisuallyVerified"] is False
assert meta["geometryVisuallyVerified"] is False
assert meta["productionReady"] is False
report["windowFramesConnected"] = len(verticals)
report["visualAccuracyVerified"] = False
report["blendReopened"] = True
report["editableObjects"] = len(editable.objects)
report["pass"] = True
(out/"validation.json").write_text(json.dumps(report,ensure_ascii=False,indent=2)+"\n")
print("MODEL_VALIDATION_OK "+json.dumps(report,ensure_ascii=False),flush=True)
