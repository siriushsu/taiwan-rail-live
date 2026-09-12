# 首發四款追加修訂

先讀 `docs/garage-fleet-refinement-20260912.md`。來源 fleet-v1 不覆寫。

```sh
FLEET_RENDER=0 /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup -t 4 --python scripts/blender/fleet-refinement-20260912/refine.py -- <原始-fleet-v1> <輸出目錄>
python3 scripts/import_garage_blender.py --source <輸出目錄> --models emu3000 dr1000 dl38 alicoach blue bluecoach
/Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup -t 4 --python scripts/import_blender_map.py -- --source <輸出目錄> --models emu3000 dr1000 dl38 alicoach blue bluecoach
node scripts/verify_garage_fleet_views.mjs
node scripts/verify_garage_train_lights.mjs
```

六面圖工具另產生六款 WebP，檢視後複製到 `rail-3d/assets/garage-blender-v1/`。匯入器不會自行將舊縮圖更新為新模型。
