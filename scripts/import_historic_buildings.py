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
(out/'README.md').write_text('# 歷史建物平面校正版\n\n來源：historic-v2 工坊。OSM 輪廓 © OpenStreetMap contributors，ODbL 1.0。\n\n依逐棟轮廓定位，立面與高度仍為外觀建模估計。北門驛使用官方景點座標及面積，非測量外框。花蓮水塔使用 OSM 節點、塔身尺寸估計。勝興、車埕、斗南、橋頭以官方場域資料及衛星目視比對定位，外框與分段界線仍為估計。嘉義包含官方園區圖及衛星定位的主工場，以及 OSM 動力室輪廓。\n'.replace('轮','輪').replace('组','組'))
print('匯入',len(catalog))
