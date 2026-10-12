"""Verify saved Blender files and both GLBs independently; not an architectural accuracy test."""
import bpy,json,math,struct,sys,hashlib
from pathlib import Path
from mathutils import Vector,Matrix
root=Path(sys.argv[sys.argv.index("--")+1])
reports=[]
for folder in sorted(root.glob("*-candidate01")):
    meta=json.loads((folder/"model.json").read_text())
    bpy.ops.wm.open_mainfile(filepath=str(folder/(meta["id"]+".blend")))
    objects=list(bpy.data.collections["01 Editable building"].objects)
    assert len(objects)==meta["nativeObjectCount"]
    assert all(o.type=="MESH" for o in objects)
    assert len({o.get("component_id") for o in objects})>=6
    levels={}
    for level in ("near","far"):
        lod=meta["lods"][level];assert len(lod["drawGroups"])<=8
        raw=(folder/lod["file"]).read_bytes()
        assert len(raw)==lod["vertexCount"]*24==lod["byteLength"]
        assert hashlib.sha256(raw).hexdigest()==lod["sha256"]
        verts=list(struct.iter_unpack("<6f",raw))
        assert all(all(math.isfinite(v) for v in row) for row in verts)
        assert all(abs(sum(v*v for v in row[3:])-1)<.003 for row in verts)
        cursor=0
        for group in lod["drawGroups"]:
            assert group["start"]==cursor and group["count"]%3==0
            cursor+=group["count"]
        assert cursor==len(verts)
        raw_bounds=[[min(v[i] for v in verts) for i in range(3)],[max(v[i] for v in verts) for i in range(3)]]
        bpy.ops.wm.read_factory_settings(use_empty=True)
        bpy.ops.import_scene.gltf(filepath=str(folder/lod["glb"]))
        bpy.context.view_layer.update()
        # Blender glTF importer already converts Y-up glTF back to Blender Z-up.
        points=[o.matrix_world@v.co for o in bpy.context.scene.objects if o.type=="MESH" for v in o.data.vertices]
        bounds=[[min(v[i] for v in points) for i in range(3)],[max(v[i] for v in points) for i in range(3)]]
        error=max(abs(bounds[k][i]-raw_bounds[k][i]) for k in range(2) for i in range(3))
        assert error<.005,(folder.name,level,error)
        assert abs(raw_bounds[0][2])<.001
        assert abs(raw_bounds[1][2]-meta["realBuildingHeightM"])<.002
        assert hashlib.sha256((folder/lod["glb"]).read_bytes()).hexdigest()==lod["glbSha256"]
        levels[level]={"triangles":lod["triangleCount"],"drawGroups":len(lod["drawGroups"]),"glbBytes":(folder/lod["glb"]).stat().st_size,"roundtripBoundsErrorM":error}
    reports.append({"id":meta["id"],"editableObjects":meta["nativeObjectCount"],"levels":levels,
      "formatValidated":True,"geometryVisuallyVerified":False,"placementVerified":False,"mobileFrameRateMeasured":False})
(root/"validation.json").write_text(json.dumps(reports,ensure_ascii=False,indent=2)+"\n")
manifest=json.loads((Path(__file__).parent/"station-manifest.json").read_text())
assert len(manifest["stationRows"])==423
assert len({r["stationKey"] for r in manifest["stationRows"]})==423
for r in manifest["stationRows"]:
    lon,lat=r["stationPositionLonLat"]
    assert 118<lon<123 and 21<lat<27
    assert not r["productionReady"]
assert len(manifest["legacySceneCrosswalk"]["scenes"])==27
print("BATCH_VALIDATION_OK "+json.dumps(reports,ensure_ascii=False),flush=True)
