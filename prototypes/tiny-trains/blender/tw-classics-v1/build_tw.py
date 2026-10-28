"""Blender 5.2.1 -b --factory-startup -t 6 --python build_tw.py -- emu300 ...
不給 ID 時建置全部。FLEET_RENDER=0 只匯出資產；FLEET_SAMPLES 調 Cycles 品質。
輸出到本目錄 models/<id>/，格式與台灣車隊 fleet-v1 相同（export_model 沿用同一份）。
"""
import sys,os,json,time,bpy
from pathlib import Path
OUT=Path(__file__).resolve().parent;sys.path.insert(0,str(OUT))
from tw_specs import S
import blender_parts as p
from tw_models import BUILDERS
args=sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else list(S)
refs={m['id']:m for m in json.load(open(OUT/'catalog-source.json'))};results=[]
for id in args:
 s=dict(S[id]);start=time.monotonic()
 print('FLEET_MODEL_BEGIN '+id,flush=True)
 p.reset(s);BUILDERS[id](s)
 m=p.export_model(s,OUT/'models'/id,refs[id])
 # 短而高的車（小蒸機）側面相機只照車長取景會切掉煙囪頂：放大正交尺寸讓整個車高入鏡。
 sx,_,sz=m['sizeM'];need=sz*1.12*1400/650
 if os.environ.get('FLEET_RENDER','1')=='1' and need>sx*1.10:
  sc=bpy.context.scene;sc.camera.data.ortho_scale=need;sc.render.filepath=str(OUT/'models'/id/'renders'/'side.png');bpy.ops.render.render(write_still=True)
 results.append({'id':id,'seconds':round(time.monotonic()-start,2),'triangles':m['mesh']['triangleCount']})
 (OUT/'latest-build-progress.json').write_text(json.dumps(results,ensure_ascii=False,indent=2)+'\n')
print('FLEET_BUILD_DONE '+str(len(results)),flush=True)
