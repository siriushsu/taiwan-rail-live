"""Format, export isolation, LOD and station-specific structural invariants."""
import bpy,json,math,struct,sys,hashlib
from pathlib import Path
from mathutils import Vector
from mathutils.bvhtree import BVHTree
root=Path(sys.argv[sys.argv.index("--")+1])
specs=json.loads((Path(__file__).parent/"stations.json").read_text())
reports=[]
for s in specs:
    folder=root/s["id"];meta=json.loads((folder/"model.json").read_text())
    bpy.ops.wm.open_mainfile(filepath=str(folder/(meta["id"]+".blend")))
    objects=list(bpy.data.collections["01 Editable building"].objects)
    assert len(objects)==meta["nativeObjectCount"] and all(o.type=="MESH" for o in objects)
    assert meta["anchor"] is None and meta["rotationDeg"] is None and meta["railElevationM"] is None
    assert not meta["productionReady"] and not meta["trackGuidesExported"]
    assert {o["lod_layer"] for o in objects}=={"near","far"}
    assert all(o.hide_render for o in objects if o["lod_layer"]=="far")
    features={"variant":s["assetVariant"],"currentStationIncluded":False}
    if s["builder"]=="tainan":
        source=json.loads((folder/"inherited-source-metadata.json").read_text())
        assert len(source["pendingChecks"])>=15
        assert meta["conversion"]["near"]["sourceTriangles"]==source["lods"]["near"]["triangleCount"]
        assert meta["conversion"]["near"]["sourceTriangles"]==meta["conversion"]["near"]["blenderTriangles"]
        features.update({"inheritedPendingChecks":len(source["pendingChecks"]),"originalNearTriangles":source["lods"]["near"]["triangleCount"]})
    else:
        assert any("clock" in o["component_id"].lower() for o in objects)
        assert any("roof" in o["component_id"].lower() for o in objects)
    levels={}
    for level in ("near","far"):
        lod=meta["lods"][level];raw=(folder/lod["file"]).read_bytes()
        assert len(raw)==lod["byteLength"]==lod["vertexCount"]*24
        assert hashlib.sha256(raw).hexdigest()==lod["sha256"]
        data=list(struct.iter_unpack("<6f",raw));vertices=[Vector(v[:3]) for v in data]
        assert all(all(math.isfinite(v) for v in row) for row in data)
        assert all(abs(sum(v*v for v in row[3:])-1)<.004 for row in data)
        cursor=0
        for g in lod["drawGroups"]:
            assert g["start"]==cursor and g["count"]%3==0
            assert not g["name"].startswith("studio")
            cursor+=g["count"]
        assert cursor==len(data) and len(lod["drawGroups"])<=8
        bounds=[[min(v[i] for v in vertices) for i in range(3)],[max(v[i] for v in vertices) for i in range(3)]]
        assert abs(bounds[0][2])<.001
        tree=BVHTree.FromPolygons(vertices,[(i,i+1,i+2) for i in range(0,len(vertices),3)],all_triangles=True)
        probes=([(0,3,100),(-19,0,100),(22,0,100)] if s["builder"]=="hsinchu" else
                [(-.3,0,100),(-.3,-7,100),(20,15,100)] if s["builder"]=="tainan" else
                [(0,2,100),(-19,0,100),(19,0,100)])
        for p in probes:
            hit,_,_,_=tree.ray_cast(Vector(p),Vector((0,0,-1)))
            assert hit is not None and hit.z>4.8,(meta["id"],level,p,hit)
        if s["builder"]=="tainan":
            # All seven high windows must still expose glazing after far planar simplification.
            for i in range(7):
                x=-.3+(i-3)*3.44
                hit,normal,index,dist=tree.ray_cast(Vector((x,-30,7.5)),Vector((0,1,0)))
                assert hit is not None
                group=next(g for g in lod["drawGroups"] if g["start"]<=index*3<g["start"]+g["count"])
                assert group["name"].split(".")[0]=="glass",(level,i,group["name"],tuple(hit))
        glb=(folder/lod["glb"]).read_bytes();assert hashlib.sha256(glb).hexdigest()==lod["glbSha256"]
        magic,version,size=struct.unpack_from("<4sII",glb);assert magic==b"glTF" and version==2 and size==len(glb)
        js_size,chunk=struct.unpack_from("<I4s",glb,12);assert chunk==b"JSON"
        scene=json.loads(glb[20:20+js_size]);assert not scene.get("textures") and not scene.get("cameras")
        assert all(m.get("alphaMode","OPAQUE")=="OPAQUE" for m in scene["materials"])
        bpy.ops.wm.read_factory_settings(use_empty=True);bpy.ops.import_scene.gltf(filepath=str(folder/lod["glb"]))
        bpy.context.view_layer.update()
        points=[o.matrix_world@v.co for o in bpy.context.scene.objects if o.type=="MESH" for v in o.data.vertices]
        imported=[[min(v[i] for v in points) for i in range(3)],[max(v[i] for v in points) for i in range(3)]]
        error=max(abs(imported[k][i]-bounds[k][i]) for k in range(2) for i in range(3))
        assert error<.005
        levels[level]={"triangles":lod["triangleCount"],"drawGroups":len(lod["drawGroups"]),"glbBytes":len(glb),"roundtripBoundsErrorM":error,"roofProbes":len(probes)}
    assert 0<levels["far"]["triangles"]<levels["near"]["triangles"]<60000
    assert levels["far"]["triangles"]<6000
    reports.append({"id":meta["id"],"name":meta["name"],"editableObjects":meta["nativeObjectCount"],
       "features":features,"levels":levels,"formatValidated":True,"photoCalibrated":False,"placementVerified":False})
(root/"validation.json").write_text(json.dumps(reports,ensure_ascii=False,indent=2)+"\n")
print("HERITAGE_VALIDATION_OK "+json.dumps(reports,ensure_ascii=False),flush=True)
