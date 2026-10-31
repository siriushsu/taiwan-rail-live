#!/usr/bin/env python3
"""改前／改後對照頁：每款三個角度（斜側、正面、側面）並排，渲染圖轉 WebP 內嵌（單一 HTML 檔，可直接傳給別人看）；
參考照片只連 Commons 縮圖、不複製。
python3 compare_page.py --before <fleet-v1 目錄> --out <輸出 .html> --title <標題> c301 ..."""
import argparse,base64,html,json,subprocess,tempfile
from pathlib import Path
OUT=Path(__file__).resolve().parent
ap=argparse.ArgumentParser();ap.add_argument('--before',type=Path,required=True);ap.add_argument('--out',type=Path,required=True)
ap.add_argument('--title',default='台灣車隊精修對照');ap.add_argument('ids',nargs='+');a=ap.parse_args()
src={m['id']:m for m in json.loads((OUT/'catalog-source.json').read_text())}
VIEWS=[('hero.png','斜側',900,600),('front.png','正面',560,560),('side.png','側面',980,455)]
tmp=Path(tempfile.mkdtemp())
def img(png,w,h):
 dst=tmp/(str(abs(hash(str(png))))+'.webp')
 subprocess.run(['cwebp','-quiet','-q','80','-m','6','-resize',str(w),str(h),str(png),'-o',str(dst)],check=True)
 return 'data:image/webp;base64,'+base64.b64encode(dst.read_bytes()).decode()
def tris(p):return json.loads(p.read_text())['mesh']['triangleCount']
def thumb(url,width=480):
 name=url.split('/File:',1)[1];return f'https://commons.wikimedia.org/wiki/Special:FilePath/{name}?width={width}'
rows=[];cards=[]
for id in a.ids:
 m=src[id];old=a.before/'models'/id;new=OUT/'models'/id
 t0,t1=tris(old/f'{id}.model.json'),tris(new/f'{id}.model.json')
 rows.append(f'<tr><td><a href="#{id}">{html.escape(m["name"])}</a></td><td>{t0:,}</td><td>{t1:,}</td><td>{html.escape(m["detail"])}</td></tr>')
 views=''.join(f'<div class="view"><h3>{label}</h3><div class="pair"><figure><img loading="lazy" src="{img(old/"renders"/f,w,h)}" alt="{id} 改前{label}"><figcaption>改前（fleet-v1）</figcaption></figure>'
  f'<figure><img loading="lazy" src="{img(new/"renders"/f,w,h)}" alt="{id} 改後{label}"><figcaption>改後（tw-v2）</figcaption></figure></div></div>' for f,label,w,h in VIEWS)
 feats=''.join(f'<li>{html.escape(x)}</li>' for x in m['features'])
 photos=''.join(f'<figure class="photo"><a href="{html.escape(p["url"])}"><img loading="lazy" src="{html.escape(thumb(p["url"]))}" alt="{html.escape(p["file"])}"></a>'
  f'<figcaption>{html.escape(p["use"])}<br><span>{html.escape(p["author"])}・{html.escape(p["licence"])}</span></figcaption></figure>' for p in m['photos'])
 cards.append(f'<section id="{id}"><h2>{html.escape(m["name"])}<small>{t0:,} → {t1:,} 三角形</small></h2><ul class="feats">{feats}</ul>{views}'
  f'<h3>參考照片（Wikimedia Commons，點圖看原頁與授權）</h3><div class="photos">{photos}</div></section>')
page=f'''<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>{html.escape(a.title)}</title><style>
:root{{--bg:#f4f3ef;--card:#fff;--ink:#1d2a33;--muted:#5d6a72;--line:#d9dcd8;--accent:#2479c9}}
@media (prefers-color-scheme:dark){{:root{{--bg:#15191c;--card:#1e2428;--ink:#e6e9ea;--muted:#9aa5ab;--line:#333c42;--accent:#6fb0f0}}}}
*{{box-sizing:border-box}}body{{margin:0;background:var(--bg);color:var(--ink);font:15px/1.6 -apple-system,"PingFang TC","Noto Sans TC",sans-serif}}
main{{max-width:1200px;margin:0 auto;padding:24px 16px 64px}}h1{{font-size:24px;margin:0 0 4px}}.lead{{color:var(--muted);margin:0 0 20px}}
table{{border-collapse:collapse;width:100%;background:var(--card);border:1px solid var(--line);border-radius:8px;overflow:hidden;margin-bottom:28px}}
th,td{{text-align:left;padding:8px 10px;border-bottom:1px solid var(--line);font-variant-numeric:tabular-nums}}th{{font-weight:600;color:var(--muted);font-size:13px}}
a{{color:var(--accent)}}section{{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:18px 18px 8px;margin:0 0 28px}}
h2{{font-size:20px;margin:0 0 6px;display:flex;gap:12px;align-items:baseline;flex-wrap:wrap}}h2 small{{font-size:13px;color:var(--muted);font-weight:400}}
h3{{font-size:14px;color:var(--muted);margin:16px 0 6px;font-weight:600}}.feats{{margin:4px 0 8px;padding-left:20px}}
.pair{{display:grid;grid-template-columns:1fr 1fr;gap:10px}}figure{{margin:0}}img{{width:100%;height:auto;display:block;border-radius:6px;background:#ddd}}
figcaption{{font-size:12px;color:var(--muted);padding:4px 2px}}.photos{{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:10px;margin-bottom:10px}}
.photo figcaption span{{opacity:.8}}@media (max-width:640px){{.pair{{grid-template-columns:1fr}}}}
</style></head><body><main><h1>{html.escape(a.title)}</h1>
<p class="lead">每款三個角度：左邊是目前上線的 fleet-v1，右邊是這次精修的 tw-v2（同一個攝影棚、同一組鏡頭）。渲染圖內嵌在本檔；參考照片直接連 Commons，不複製、不當貼圖。</p>
<table><thead><tr><th>車型</th><th>改前三角形</th><th>改後三角形</th><th>這次的重點</th></tr></thead><tbody>{"".join(rows)}</tbody></table>
{"".join(cards)}</main></body></html>'''
a.out.parent.mkdir(parents=True,exist_ok=True);a.out.write_text(page)
print(a.out,round(len(page)/1e6,2),'MB')
