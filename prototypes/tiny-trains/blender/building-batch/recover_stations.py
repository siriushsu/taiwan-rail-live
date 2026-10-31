"""Recover existing map meshes into editable grouped meshes. This does not refine their appearance."""
import bpy,json,sys,shutil
from pathlib import Path
HERE=Path(__file__).resolve().parent;sys.path.insert(0,str(HERE))
import core as c
ROOT=HERE.parents[3];OUT=Path(sys.argv[sys.argv.index("--")+1])
catalog=json.loads((ROOT/"rail-3d/assets/blender-buildings-v1/catalog.json").read_text())
report=[]
for entry in catalog:
    if entry["category"]!="station":continue
    src=ROOT/"rail-3d/assets/blender-buildings-v1"/entry["id"]
    dst=OUT/"existing-station-meshes"/entry["id"];dst.mkdir(parents=True,exist_ok=True)
    metadata=json.loads((src/"model.json").read_text())
    for level in ("near","far"):
        c.load_legacy(src,level)
        bpy.ops.object.select_all(action="DESELECT")
        for o in c.OBJECTS:o.select_set(True)
        bpy.context.view_layer.objects.active=c.OBJECTS[0]
        bpy.ops.export_scene.gltf(filepath=str(dst/(level+".glb")),export_format="GLB",use_selection=True,export_yup=True,export_extras=True)
        if level=="near":
            c.SC["source"]="Recovered from map mesh; original Blender object history unavailable"
            c.SC["accuracy"]="Existing model, appearance unchanged, not accepted"
            bpy.ops.wm.save_as_mainfile(filepath=str(dst/(entry["id"]+"-recovered.blend")))
        shutil.copy2(src/(level+".mesh.bin"),dst/(level+".mesh.bin"))
    shutil.copy2(src/"model.json",dst/"legacy-model.json")
    note={"id":entry["id"],"name":entry["name"],"status":"editable-mesh-recovery-only",
          "appearanceChanged":False,"originalParametricObjectsRecovered":False,
          "grouping":"component and material from original mesh metadata","productionReady":False}
    (dst/"recovery.json").write_text(json.dumps(note,ensure_ascii=False,indent=2)+"\n")
    report.append(note)
assert len(report)==13
(OUT/"recovered-stations.json").write_text(json.dumps(report,ensure_ascii=False,indent=2)+"\n")
print("RECOVERED_STATIONS "+str(len(report)),flush=True)
