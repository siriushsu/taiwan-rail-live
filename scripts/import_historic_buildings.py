"""匯入校正工坊的地圖資產；草擬位置不進正式建物集合。"""
import json,shutil,sys
from pathlib import Path
source=Path(sys.argv[1]);root=Path(__file__).resolve().parents[1];out=root/'rail-3d/assets/historic-buildings-v2';out.mkdir(parents=True,exist_ok=True)
plans=json.loads((source/'placements-source.json').read_text());catalog=[];placements={}
for id,p in plans.items():
 if not p.get('mapEligible'):continue
 src=source/'models'/id;dest=out/id;dest.mkdir(exist_ok=True)
 m=json.loads((src/'model.json').read_text());placement=json.loads((source/'placements'/(id+'.json')).read_text())
 if not placement['footprint']['features']:continue
 for file in ['model.json','near.mesh.bin','far.mesh.bin']:
  shutil.copyfile(src/file,dest/file)
 catalog.append({'id':id,'name':m['name'],'category':'historic','metadata':id+'/model.json'});placements[id]=placement
(out/'catalog.json').write_text(json.dumps(catalog,ensure_ascii=False,separators=(',',':'))+'\n');(out/'placement.json').write_text(json.dumps({'version':2,'entries':placements},ensure_ascii=False,separators=(',',':'))+'\n')
(out/'README.md').write_text('# 歷史建物外觀模型\n\n25 組主體於 2026/9/9 上線；2026/9/12 補 11 組的外觀與附屬構件，合計 61 個獨立定位部件。完整比對、來源、估計範圍與驗證見 prototypes/tiny-trains/blender/historic-v2/COMPLETION-2026-09-12.md。\n\n來源：historic-v2 工坊。OSM 輪廓 © OpenStreetMap contributors，ODbL 1.0；其餘依官方場域資料、照片及衛星目視估計。高度、部分外框與正面朝向未經完整測繪。隆田地磅室採現存低矮遺構；泰安平面模式的月台相對高度 4.5m 為視覺估計，開啟地形則逐部件貼地。\n')
print('匯入',len(catalog))
