"""Offline review index: generated renders plus original reference-page links."""
import json,html
from pathlib import Path
ROOT=Path("output/building-batch")
HERE=Path(__file__).parent
manifest=json.loads((HERE/"station-manifest.json").read_text())
esc=lambda s:html.escape(str(s),quote=True)
cards=[]
for folder in sorted(ROOT.glob("*-candidate01")):
    m=json.loads((folder/"model.json").read_text())
    cards.append('<article><h2>'+esc(m["name"])+'</h2><p>外觀修訂候選，待實拍與放樣覆核</p><img src="'+esc(folder.name)+'/hero.png" alt="Blender 渲染"><p>'+
      ' · '.join('<a href="'+esc(folder.name)+'/'+esc(file)+'">'+label+'</a>' for file,label in [(m["id"]+".blend","Blender 原檔"),("near.glb","近景 GLB"),("far.glb","遠景 GLB"),("model.json","模型資料")])+'</p></article>')
rows=[]
for r in manifest["stationRows"]:
    urls=list(r["referenceUrls"])
    urls.extend(p["url"] for p in r.get("photos",[]) if "url" in p)
    hsr=r.get("references",{})
    if isinstance(hsr,dict):
        if hsr.get("primaryPhotoPage"):urls.append(hsr["primaryPhotoPage"])
    urls=list(dict.fromkeys(urls))
    refs=' '.join('<a href="'+esc(u)+'" target="_blank" rel="noopener">參考 '+str(i+1)+'</a>' for i,u in enumerate(urls[:5]) if u.startswith("https://"))
    refs+=' <a href="'+esc(r["referencePage"])+'" target="_blank" rel="noopener">完整資料</a>'
    existing=r.get("existingAssetIds",[])
    files=' '.join('<a href="existing-station-meshes/'+esc(i)+'/'+esc(i)+'-recovered.blend">'+esc(i)+' 原有網格</a>' for i in existing)
    state="既有外觀待重製" if existing else "待建模"
    rows.append('<tr><td>'+esc(r["stationKey"])+'</td><td>'+esc(r["name"])+'</td><td>'+state+'</td><td>'+refs+'</td><td>'+files+'</td></tr>')
page='''<!doctype html><html lang="zh-Hant"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>軌島站體與地標製作檢閱</title><style>
body{font:16px system-ui,sans-serif;margin:28px;color:#243735;background:#f2f4ed}h1{font-size:28px}a{color:#245c50}article{background:white;padding:18px;border-radius:12px}article img{width:100%;max-height:500px;object-fit:contain}.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:18px}table{width:100%;border-collapse:collapse;background:white}td,th{text-align:left;padding:12px;border-bottom:1px solid #dce3d8}td a{display:inline-block;margin:4px}input{font:inherit;padding:12px;width:min(500px,90%);margin:12px 0}.scroll{overflow:auto}
</style><h1>站體與地標製作檢閱</h1><p>兩棟地標重製候選・423 筆車站代碼・27 個原場景對照。全量外觀驗收尚未完成。</p><p>既有 13 組車站下載檔是可編修的網格恢復版，外觀未改。照片僅連回來源頁。</p><div class="cards">'''+''.join(cards)+'''</div><h2>完整車站名冊</h2><label for="q">以車站名或代碼篩選</label><br><input id="q" type="search" placeholder="例如：冬山、士林、TRA:7150"><p id="count" aria-live="polite">423 筆</p><div class="scroll"><table><thead><tr><th>代碼</th><th>車站</th><th>製作狀態</th><th>照片／資料</th><th>工作檔</th></tr></thead><tbody>'''+''.join(rows)+'''</tbody></table></div><p>美麗島地面出入口另列於 <a href="station-manifest.json">additionalVariants</a>；光之穹頂室內場景不能替代地面站體。</p>
<script>const q=document.querySelector('#q'),rows=[...document.querySelectorAll('tbody tr')];q.addEventListener('input',()=>{const s=q.value.trim().toLowerCase();let n=0;rows.forEach(r=>{r.hidden=!r.textContent.toLowerCase().includes(s);if(!r.hidden)n++});document.querySelector('#count').textContent=n+' 筆';});</script></html>'''
(ROOT/"review.html").write_text(page,encoding="utf-8")
print("REVIEW_INDEX_OK 423 station rows")
