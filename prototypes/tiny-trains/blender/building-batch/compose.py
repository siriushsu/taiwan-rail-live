from PIL import Image,ImageDraw,ImageFont
from pathlib import Path
import base64,json
root=Path("output/building-batch")
fontpath="/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc"
font=ImageFont.truetype(fontpath,26);small=ImageFont.truetype(fontpath,20)
sheet=Image.new("RGB",(1980,1900),"#e2e4e0");draw=ImageDraw.Draw(sheet)
for row,folder in enumerate(sorted(root.glob("*-candidate01"))):
    meta=json.loads((folder/"model.json").read_text());y=70+row*910
    draw.text((22,y-45),meta["name"]+"｜外觀修訂候選，待實景校正",font=font,fill="#243735")
    for col,(file,label) in enumerate([("legacy-hero.png","既有模型"),("hero.png","重製模型"),("front.png","重製正面")]):
        im=Image.open(folder/file).convert("RGB")
        sheet.paste(im,(col*660,y))
        draw.text((col*660+20,y+12),label,font=font,fill="#243735")
draw.text((22,1880),"Blender 實際渲染｜同總高、燈光及色彩管理｜非照片量測校色",font=small,fill="#243735")
sheet.save(root/"comparison.png")
sheet.thumbnail((1386,1400));sheet.save(root/"comparison.jpg",quality=88)
print("PREVIEW_BASE64_BEGIN")
print(base64.b64encode((root/"comparison.jpg").read_bytes()).decode())
print("PREVIEW_BASE64_END")
print("VALIDATION_JSON_BEGIN")
print((root/"validation.json").read_text())
print("VALIDATION_JSON_END")
