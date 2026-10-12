"""從已驗證的原檔渲染，模型匯出失敗與渲染失敗各自可追蹤。"""
import bpy
import json
import sys
from pathlib import Path
from mathutils import Vector

out = Path(sys.argv[sys.argv.index("--")+1]).resolve()
meta = json.loads((out/"model.json").read_text())
bpy.ops.wm.open_mainfile(filepath=str(out/(meta["id"]+".blend")))
scene = bpy.context.scene
camera = scene.camera
target = Vector((0,0,18))
for name,location,scale in [
    ("hero",(190,-240,205),216),
    ("front",(0,-280,95),185),
    ("roof",(0,-1,340),184),
]:
    camera.location = location
    camera.rotation_euler = (target-camera.location).to_track_quat("-Z","Y").to_euler()
    camera.data.ortho_scale = scale
    scene.render.filepath = str(out/(name+".png"))
    bpy.ops.render.render(write_still=True)
    print("RENDER_OK "+name,flush=True)
