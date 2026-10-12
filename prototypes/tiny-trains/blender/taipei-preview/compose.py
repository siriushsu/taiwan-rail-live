"""組合模型實際渲染與前版比較，不包含參考照片。"""
import base64
import shutil
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

out = Path("output/taipei-station")
src = Path("prototypes/tiny-trains/blender/taipei-preview")
font_path = "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc"
font = ImageFont.truetype(font_path, 23)
small = ImageFont.truetype(font_path, 16)
sheet = Image.new("RGB", (1200,730), "#eeeeee")
draw = ImageDraw.Draw(sheet)
draw.text((28,18), "臺北車站 · Blender 修訂樣本 02", font=font, fill="#303c40")
draw.text((28,56), "磚紅屋頂／灰米牆面／中性日光｜仍待實拍校正", font=small, fill="#586168")
hero = Image.open(out/"hero.png").convert("RGB")
sheet.paste(hero.resize((760,594)), (0,116))
for i,(name,label) in enumerate([("front","正面"),("roof","屋頂與完整採光罩")]):
    sheet.paste(Image.open(out/(name+".png")).convert("RGB").resize((400,312)), (780,90+i*320))
    draw.text((798,94+i*320), label, font=small, fill="#303c40")
sheet.save(out/"preview02.jpg", quality=90)
sheet.resize((1000,608)).save(out/"review.jpg", quality=85)
old = Image.open(src/"preview01.jpg").convert("RGB")
# 前版 preview.jpg 是 1000 × 608 的三視角預覽，抽取同角度主視圖。
assert old.size == (1000,608), old.size
old_hero = old.crop((0,97,634,592))
comparison = Image.new("RGB", (1280,650), "#eeeeee")
draw = ImageDraw.Draw(comparison)
draw.text((26,15), "臺北車站｜模型實際渲染前後比較", font=font, fill="#303c40")
draw.text((26,51), "配色、照明與窗框修訂；建築細節與現況色彩尚未完成實拍校正", font=small, fill="#586168")
comparison.paste(old_hero.resize((640,500)), (0,120))
comparison.paste(hero.resize((640,500)), (640,120))
draw.text((26,90), "前版 01", font=font, fill="#303c40")
draw.text((666,90), "修訂 02", font=font, fill="#303c40")
comparison.save(out/"comparison.jpg", quality=90)
for name in ("build.py","verify.py","render.py","compose.py","README.md","reference-input.json","footprint.geojson","sources.md","evidence-audit.json","preview01.jpg"):
    shutil.copy2(src/name,out/name)
for label,name in [("PREVIEW","review.jpg"),("COMPARISON","comparison.jpg")]:
    print(label+"_BASE64_BEGIN")
    print(base64.b64encode((out/name).read_bytes()).decode("ascii"))
    print(label+"_BASE64_END")
