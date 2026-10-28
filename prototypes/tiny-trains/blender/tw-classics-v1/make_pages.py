"""從 catalog-source.json 與 models/<id>/<id>.model.json 產生：
- inventory.html：盤點清單（要做的、做完的、查過不做的），每款附來源與參考照片
- compare/<id>.html：渲染與 Commons 照片並排（照片直接連 Commons，不複製）
- compare/batch-tw.html：總覽格子
- models/<id>/renders/thumb.webp：360×240 縮圖（sips＋cwebp，跟 fleet-v1 同規格）
在 repo 根目錄跑：python3 prototypes/tiny-trains/blender/tw-classics-v1/make_pages.py
"""
import json,html,subprocess,tempfile
from pathlib import Path
OUT=Path(__file__).resolve().parent
src=[m for m in json.load(open(OUT/'catalog-source.json')) if m.get('group')]
for m in src:m.setdefault('label',m['name']);m.setdefault('detail','');m.setdefault('color','#888888')
excluded=json.load(open(OUT/'inventory-excluded.json')) if (OUT/'inventory-excluded.json').exists() else []
GROUPS=[('current','現役但還沒建模'),('classic','退役的經典老車')]
e=html.escape

CSS=""":root{--bg:#f7f6f2;--card:#fff;--ink:#1d1d1f;--muted:#6b6b70;--line:#e3e1da;--accent:#c4501b}
@media (prefers-color-scheme:dark){:root{--bg:#141416;--card:#1d1d20;--ink:#ececee;--muted:#9a9aa2;--line:#2e2e33;--accent:#f08a4b}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.6 -apple-system,"PingFang TC","Noto Sans TC",sans-serif}
main{max-width:1200px;margin:0 auto;padding:24px 16px 56px}
h1{font-size:22px;margin:0 0 4px}
h2{font-size:17px;margin:28px 0 8px}
a{color:var(--accent)}
.sub,.cap{color:var(--muted);font-size:13px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:12px;margin-top:12px}
.card{display:block;background:var(--card);border:1px solid var(--line);border-radius:10px;overflow:hidden;color:inherit;text-decoration:none}
.card:hover{border-color:var(--muted)}
.card img{display:block;width:100%;height:auto}
.meta{display:flex;align-items:center;gap:8px;padding:8px 10px 0}
.dot{width:12px;height:12px;border-radius:50%;flex:none;border:1px solid var(--line)}
.cap{padding:0 10px 6px}
.card .cap:last-child{padding-bottom:10px}
.pair{display:grid;grid-template-columns:1fr 1fr;gap:12px}
@media (max-width:720px){.pair{grid-template-columns:1fr}}
figure{margin:0;background:var(--card);border:1px solid var(--line);border-radius:10px;overflow:hidden}
figure img{display:block;width:100%;height:auto}
figcaption{padding:8px 10px;font-size:13px;color:var(--muted)}
ul{padding-left:20px}
.table{width:100%;border-collapse:collapse;background:var(--card);border:1px solid var(--line);border-radius:10px;overflow:hidden;font-size:14px}
.table th,.table td{padding:8px 10px;border-bottom:1px solid var(--line);text-align:left;vertical-align:top}
.table th{font-size:13px;color:var(--muted);font-weight:600}
.wrap{overflow-x:auto}
.tag{display:inline-block;font-size:12px;padding:1px 8px;border-radius:99px;border:1px solid var(--line);white-space:nowrap}
.done{color:#2f7d4f;border-color:#2f7d4f}
.todo{color:var(--muted)}
.thumb{width:150px;border-radius:6px;display:block}
"""
def page(title,body):
 return f'<!doctype html>\n<html lang="zh-Hant">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n<title>{e(title)}</title>\n<style>\n{CSS}</style>\n</head>\n<body>\n<main>\n{body}\n</main>\n</body>\n</html>\n'

def meta(id):
 p=OUT/'models'/id/f'{id}.model.json'
 return json.load(open(p)) if p.exists() else None

def thumb(id):
 hero=OUT/'models'/id/'renders'/'hero.png';dest=hero.with_name('thumb.webp')
 if not hero.exists():return None
 if not dest.exists() or dest.stat().st_mtime<hero.stat().st_mtime:
  with tempfile.TemporaryDirectory() as t:
   small=Path(t)/'thumb.png'
   subprocess.run(['sips','-z','240','360',str(hero),'--out',str(small)],check=True,capture_output=True)
   subprocess.run(['cwebp','-quiet','-q','82',str(small),'-o',str(dest)],check=True)
 return dest

def credit(ph):
 return f'照片：{e(ph["author"])}，{e(ph["licence"])}（<a href="{e(ph["url"])}">原檔</a>）'

def compare(m,md):
 id=m['id'];ph=m.get('photos',[]);front=next((x for x in ph if 'front' in x.get('role','')),ph[0] if ph else None)
 side=next((x for x in ph if 'side' in x.get('role','') and x is not front),ph[1] if len(ph)>1 else None)
 b=[f'<h1>{e(m["name"])}：渲染與照片對照</h1>',f'<p class="sub">左邊是 Blender 5.2.1 Q 版模型渲染，右邊是 Wikimedia Commons 照片（直接連 Commons 顯示，沒有複製進 repo）。{e(m.get("status",""))}</p>',
  f'<p class="sub"><a href="batch-tw.html">← 回總覽</a>　·　<a href="../inventory.html">盤點清單</a></p>']
 for title,img,photo in [('車頭','front.png',front),('斜側','hero.png',side)]:
  b.append(f'<h2>{title}</h2>\n<div class="pair">\n<figure><img src="../models/{id}/renders/{img}" alt="模型{title}渲染"><figcaption>模型{title}</figcaption></figure>')
  if photo:b.append(f'<figure><img src="{e(photo["thumb"])}" alt="{e(m["label"])}{title}照片" loading="lazy"><figcaption>{credit(photo)}。{e(photo.get("use",""))}</figcaption></figure>')
  b.append('</div>')
 b.append(f'<h2>側面</h2>\n<figure><img src="../models/{id}/renders/side.png" alt="模型側面渲染"><figcaption>模型側面{("："+e(m["sideNote"])) if m.get("sideNote") else ""}</figcaption></figure>')
 rest=[x for x in ph if x not in (front,side)]
 if rest:
  b.append('<h2>其他參考照片</h2>\n<div class="pair">')
  for x in rest:b.append(f'<figure><img src="{e(x["thumb"])}" alt="參考照片" loading="lazy"><figcaption>{credit(x)}。{e(x.get("use",""))}</figcaption></figure>')
  b.append('</div>')
 for title,key in [('對過的地方','checked'),('刻意簡化或沒做','simplified')]:
  if m.get(key):b.append(f'<h2>{title}</h2>\n<ul>\n'+'\n'.join(f'<li>{e(x)}</li>' for x in m[key])+'\n</ul>')
 b.append('<h2>資料來源</h2>\n<ul>\n'+'\n'.join(f'<li><a href="{e(s["url"])}">{e(s["title"])}</a>{("：" + e(s["supports"])) if s.get("supports") else ""}</li>' for s in m.get('sources',[]))+'\n</ul>')
 if md:b.append(f'<p class="cap">{md["mesh"]["triangleCount"]:,} 三角形 · {md["nativeObjectCount"]} 個可編修物件 · 包圍盒 {" × ".join(f"{v:.2f}" for v in md["sizeM"])} 展示公尺</p>')
 (OUT/'compare'/f'{id}.html').write_text(page(m['label']+'對照',''.join(x+'\n' for x in b)))

(OUT/'compare').mkdir(exist_ok=True)
cards={g:[] for g,_ in GROUPS};rows=[]
for m in src:
 md=meta(m['id']);t=thumb(m['id'])
 if md:
  compare(m,md)
  cards[m['group']].append(f'<a class="card" href="{m["id"]}.html">\n<img src="../models/{m["id"]}/renders/hero.png" alt="{e(m["label"])} 斜側渲染" loading="lazy">\n<div class="meta"><span class="dot" style="background:{e(m["color"])}"></span><b>{e(m["label"])}</b></div>\n<div class="cap">{e(m["detail"])}</div>\n<div class="cap">{md["mesh"]["triangleCount"]:,} 三角形 · 對照頁 →</div>\n</a>')
 refs='<br>'.join(f'<a href="{e(x["url"])}">{e(x["file"].replace("File:",""))}</a>（{e(x["author"])}，{e(x["licence"])}）' for x in m.get('photos',[]))
 srcs='<br>'.join(f'<a href="{e(s["url"])}">{e(s["title"])}</a>' for s in m.get('sources',[]))
 state=f'<span class="tag done">已建模</span><br><a href="compare/{m["id"]}.html">對照頁</a>' if md else '<span class="tag todo">還沒做</span>'
 img=f'<img class="thumb" src="models/{m["id"]}/renders/thumb.webp" alt="" loading="lazy">' if t else ''
 rows.append((m['group'],f'<tr><td>{img}</td><td><b>{e(m["name"])}</b><br><span class="cap">{e(m.get("years",""))}</span></td><td>{e(m.get("status",""))}</td><td>{srcs}</td><td>{refs}</td><td>{state}</td></tr>'))

done=sum(1 for m in src if meta(m['id']))
body=[f'<h1>台灣缺車與經典老車：精修模型總覽</h1>',f'<p class="sub">照世界車銀座線 1000 系定下的精細度、用台灣車隊 fleet-v1 同一套 Blender 5.2.1 管線做的。每張是斜側 Cycles 渲染，點進去是跟 Commons 照片並排的對照頁。Q 版比照台灣車隊：車長壓縮、斷面接近實車；不放營運商標，車號是可移除的示意字牌。目前 {done}／{len(src)} 款。<a href="../inventory.html">盤點清單</a></p>']
for g,title in GROUPS:
 if cards[g]:body+=[f'<h2>{title}</h2>','<div class="grid">']+cards[g]+['</div>']
(OUT/'compare'/'batch-tw.html').write_text(page('台灣缺車與經典老車','\n'.join(body)))

inv=[f'<h1>台灣缺車與經典老車：盤點清單</h1>',f'<p class="sub">對照台灣車隊 fleet-v1 已有的 62 款，列出台灣鐵道還沒建模的現役車與已退役的經典車。狀態以 2026-10 查到的來源為準；照片只在本機比對外觀，不進交付包、不當貼圖。已建模 {done}／{len(src)} 款，<a href="compare/batch-tw.html">模型總覽</a>。</p>']
for g,title in GROUPS:
 r=[x for gg,x in rows if gg==g]
 if r:inv+=[f'<h2>{title}</h2>','<div class="wrap"><table class="table"><thead><tr><th>縮圖</th><th>車款</th><th>狀態</th><th>資料來源</th><th>參考照片</th><th>建模</th></tr></thead><tbody>']+r+['</tbody></table></div>']
if excluded:
 inv+=['<h2>查過但這次不做</h2>','<div class="wrap"><table class="table"><thead><tr><th>車款</th><th>理由</th><th>來源</th></tr></thead><tbody>']
 link=lambda u:'<a href="'+e(u)+'">'+e(u)+'</a>'
 inv+=[f'<tr><td>{e(x["name"])}</td><td>{e(x["reason"])}</td><td>{"<br>".join(link(u) for u in x.get("sources",[]))}</td></tr>' for x in excluded]
 inv+=['</tbody></table></div>']
(OUT/'inventory.html').write_text(page('台灣缺車盤點清單','\n'.join(inv)))
print('pages',done,'of',len(src))
