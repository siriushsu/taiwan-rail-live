from PIL import Image,ImageDraw,ImageFont
from pathlib import Path
import base64,html,json,shutil
root=Path("output/station-heritage");here=Path(__file__).parent
specs=json.loads((here/"stations.json").read_text())
font=ImageFont.truetype("/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",30)
small=ImageFont.truetype("/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",22)
sheet=Image.new("RGB",(1800,1900),"#e5e7df");draw=ImageDraw.Draw(sheet)
cards=[]
for i,s in enumerate(specs):
    folder=root/s["id"];y=i*620
    draw.text((25,y+15),s["name"]+"｜建模候選・尺寸與實拍校正待核",font=font,fill="#2d413a")
    hero=Image.open(folder/"hero.png").convert("RGB");hero.thumbnail((1180,550));sheet.paste(hero,(10,y+65))
    end=Image.open(folder/"end.png").convert("RGB");end.thumbnail((590,270));sheet.paste(end,(1200,y+60))
    roof=Image.open(folder/"roof.png").convert("RGB");roof.thumbnail((590,270));sheet.paste(roof,(1200,y+335))
    draw.text((1220,y+62),"正面",font=small,fill="#2d413a");draw.text((1220,y+338),"屋頂",font=small,fill="#2d413a")
    esc=html.escape
    refs=" ".join('<a href="'+esc(x)+'" target="_blank" rel="noopener">照片來源 '+str(n+1)+'</a>' for n,x in enumerate(s["photoReferences"]))
    files=" · ".join('<a href="'+s["id"]+'/'+f+'">'+label+'</a>' for f,label in [(s["id"]+".blend","Blender 原檔"),("near.glb","近景 GLB"),("far.glb","遠景 GLB"),("model.json","建模資料")])
    cards.append('<article><h2>'+esc(s["name"])+'</h2><img src="'+s["id"]+'/hero.png"><p>'+files+'</p><p>'+refs+'</p><p>實拍、尺寸與地圖放樣尚待核對。</p></article>')
draw.text((25,1870),"Blender 實際渲染；臺南沿用既有細模。古蹟站房與現役地下／高架站分開，不計為全站完成。",font=small,fill="#2d413a")
sheet.save(root/"contact-sheet.png");sheet.thumbnail((1440,1600));sheet.save(root/"contact-sheet.jpg",quality=90)
review='<!doctype html><html lang="zh-Hant"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>特色古蹟站體製作批次</title><style>body{font:16px system-ui;background:#eef1e8;color:#293e35;padding:24px}article{background:white;padding:20px;margin:20px 0;border-radius:12px}img{width:100%;max-width:1200px}a{color:#285c4c;display:inline-block;margin:4px}</style><h1>新竹・臺南舊站・臺中舊驛站</h1><p>新竹與臺中舊驛站是外觀候選；臺南是既有細模轉製。實拍與地圖放樣待核，現役地下／高架站另列。</p>'+''.join(cards)+'</html>'
(root/"review.html").write_text(review)
shutil.copy2(here/"stations.json",root/"stations.json");shutil.copy2(here/"README.md",root/"README.md")
print("HERITAGE_PREVIEW_BASE64_BEGIN");print(base64.b64encode((root/"contact-sheet.jpg").read_bytes()).decode());print("HERITAGE_PREVIEW_BASE64_END")
print("HERITAGE_VALIDATION_JSON_BEGIN");print((root/"validation.json").read_text());print("HERITAGE_VALIDATION_JSON_END")
