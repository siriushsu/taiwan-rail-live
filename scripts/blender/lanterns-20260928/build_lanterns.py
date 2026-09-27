#!/usr/bin/env python3
"""建 lanterns：十分老街天燈零件庫（garage-parts-v1）。3 個零件（紙燈殼、竹框＋十字鐵絲＋接縫細骨、
燃料紙／火），供 Task「十分老街精緻化」把場景裡的天燈換成真正的 Blender 資產。

09-28 二版（主對話退回重做）：初版紙燈殼只有頂/底兩圈（線性直錐），看起來像「細長花瓶」，頂部
沒有熱氣撐起的鼓形，也看不到接縫/竹圈/鐵絲。這版改成多圈（7 圈）放樣（lathe）輪廓：底開口最窄
（竹框在這裡）→頸部略開→腰身在 55% 高度最鼓（真正天燈鼓起的地方）→往上收窄→頂端收成一個小圓頂
（不是尖點，像熱氣撐起的紙袋頂）。角向仍用 n=4（四面紙，真實天燈就是 4 片紙糊成，n=4＋flat shading
讓 4 條接縫自然形成可見的稜線，不必額外幾何），另外沿 4 條稜線各加一條細骨（見 SEAM_RIBS）加強
「看得到接縫」的觀感。底開口新增十字鐵絲（2 根 rod 交叉），燃料紙／火從鐵絲中心懸掛（沿用既有
lantern-flame 零件，只調整位置）。

09-28 三版（主對話第二次退回）：二版把「腰身在 55% 高度最鼓」做成蛋形（兩端窄、中段鼓），結果
topR(0.16) < bottomR(0.48)＝「上窄下寬」，違反交棒規格「上寬下窄」；「頂部微鼓」原意是頂面被熱氣
撐得微拱，不是整顆在腰身鼓起，是二版說明寫得不清楚才誤解。這版把最鼓處（改名「肩部」SHOULDER_R，
沿用同一個原文「外圍360cm」換算出的半徑，只是幾何位置從腰身搬到肩部——底座60cm本來就比外圍
換算出的114.6cm窄，數字沒有變，變的是「哪個高度最寬」）搬到 90% 高度：0→90% 單調變寬（肩部最寬）、
90%→100% 小幅收窄到頂端小圓面（頂面封閉、微拱，不是尖點）。橫截面從「純 n=4 正方形」改成「圓角
方形」：每圈 8 個頂點交錯——4 個面中央（全徑，四片紙微微鼓起）＋4 個接縫（内縮到 CORNER_IN 倍徑，
做出摺痕），不是圓也不是尖角方形。

真實尺寸來源（原文引用，逐字，見 output/lanterns/NOTES.md 的完整記錄）：
  「天燈最大尺寸，設定為底座直徑60公分、高度130公分、外圍360公分。」
  來源：中文維基百科「天燈」條目「法例」段落，https://zh.wikipedia.org/zh-tw/天燈
  （WebFetch 逐字擷取，2026-09-28）。
「外圍」判讀（自己重算，不採信擷取工具附帶的推論——它拿 360÷60≈5.96 說「接近 π」，但
π≈3.14159，5.96 完全不接近 π，那個推論本身算錯）：若「外圍」是底座（直徑60cm）的圓周，
應為 π×60≈188.5cm，跟原文「360公分」對不上，可見「外圍」不是量底座。天燈實際外形中段會鼓起
（腰身）比底座開口寬得多，「外圍」更合理的意思是腰身（最鼓處）的圓周＝360cm→腰身直徑
＝360/π≈114.6 cm。三個原文數字直接換算成「高度＝1」的形狀比例：
  底半徑/高度＝(60/2)/130＝0.23077，腰身半徑/高度＝(114.6/2)/130≈0.44074（腰身/底口半徑比
  ≈1.91——腰身遠比底口寬，這也解釋了主對話說「看起來像花瓶」：真正的天燈中段非常鼓，
  不是從底到頂線性放大）。
場景刻意「誇張一點」放大到乘客身高的 1.1～1.4 倍（主對話裁示，不是寫實比例；原文寫實比例其實
是 1.30/1.7≈0.76，正好是舊版誤打誤撞的高度比，但主對話這次要更誇張、更好認）：取 HEIGHT=2.10
（比例 2.10/1.70=1.235，落在 1.1～1.4 正中央），BASE_R／SHOULDER_R 直接用原文比例（0.23077／
0.44074）乘上 HEIGHT，頂端收口半徑另外訂一個小圓頂（不在原文範圍內，純造型選擇，明確標記
非實物數據，見 TOP_R）。

沿用 build_people.py 的自製匯出模式（calc_loop_triangles + corner_normals，非索引匯出，
24 bytes/vertex＝pos.xyz+normal.xyz），以及 blender_parts.py 的 box／mesh／rod 原語（box 一律
bevel=0：預設 .02 會多掛一個 BEVEL modifier，被匯出器的 evaluated_get() 吃進去，三角形數暴增，
見 build_people.py 對 acc-backpack 等的同樣處理）。

單位＝「模型公尺」，跟 garage-people-v1 的 rig.height=1.7（1.7 公尺高的人）同一個換算基準——
場景端用跟乘客相同的 scale=1.25/primary.size.y 畫天燈，天燈高度／乘客身高的比例因此直接由這裡的
真實公尺數決定，不必在場景端另外調校。

用法：/Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup -t 4 \
  --python scripts/blender/lanterns-20260928/build_lanterns.py
輸出：
  output/lanterns/build/lanterns.raw.bin + .meta.json + .blend（中繼，不進 repo）
  rail-3d/assets/garage-lanterns-v1/lanterns.json + lanterns.bin.gz（正式資產，一次寫出，
  沒有既有資料要合併）
"""
import bpy, sys, math, struct, json, hashlib, gzip
from pathlib import Path
from mathutils import Vector

sys.dont_write_bytecode = True
W = Path(__file__).resolve().parents[3]  # repo 根目錄（scripts/blender/<本目錄>/<本檔>）
sys.path.insert(0, str(W / 'scripts/blender/emu3000-20260912'))
import blender_parts as p  # noqa: E402

BUILD_DIR = W / 'output/lanterns/build'
BUILD_DIR.mkdir(parents=True, exist_ok=True)
ASSET_DIR = W / 'rail-3d/assets/garage-lanterns-v1'
NOTES_PATH = W / 'output/lanterns/NOTES.md'


def note(msg):
    line = f'- [build_lanterns v2] {msg}\n'
    with open(NOTES_PATH, 'a', encoding='utf-8') as f:
        f.write(line)
    print(line, end='')


p.reset({'id': 'lanterns', 'body': 'FFFFFF', 'accent': '888888'})
p.use('01')

# ============================================================
# 尺寸（模型公尺）：見檔頭引用（中文維基百科「天燈」條目原文逐字擷取，2026-09-28）。
# 原文三個數字：底座直徑60公分、高度130公分、外圍360公分——直接算比例，不取中點/範圍。三版把
# 「外圍」的幾何位置從腰身改判給肩部（見檔頭三版說明），比例數字本身不變。
# ============================================================
REAL_BASE_D_CM, REAL_HEIGHT_CM, REAL_SHOULDER_CIRC_CM = 60.0, 130.0, 360.0  # 原文逐字數字
REAL_BASE_R_RATIO = (REAL_BASE_D_CM / 2) / REAL_HEIGHT_CM                          # 0.23077
REAL_SHOULDER_R_RATIO = (REAL_SHOULDER_CIRC_CM / (2 * math.pi)) / REAL_HEIGHT_CM   # 0.44074

# HEIGHT 由「誇張到乘客身高 1.1~1.4 倍」反推（乘客 1.7m 取中點 1.235 倍 ≈2.10m，主對話裁示，
# 不是寫實比例）；BASE_R／SHOULDER_R＝原文比例 × HEIGHT（跟二版數值完全相同，只是三版把
# SHOULDER_R 放到輪廓的 90% 高度而不是 55%）；TOP_R（頂端小圓面）不在原文規格內，純造型選擇，
# 明確標記非實物數據。
HEIGHT = 2.10
BASE_R = HEIGHT * REAL_BASE_R_RATIO          # 底開口（竹框）半徑（原文比例）
SHOULDER_R = HEIGHT * REAL_SHOULDER_R_RATIO  # 肩部（最寬處）半徑（原文比例，三版搬到 90% 高度）
TOP_R = SHOULDER_R * 0.52  # 頂端小圓面半徑（造型選擇，非實物數據）——原本試過 0.22（視覺上更像尖點），
# 但 self_check_open_shell() 的「側面法向量遠離中軸」自檢會在肩部→頂端最後一段量到 dot 0.22~0.28
# （<0.3 門檻）失敗：90%→100% 只有 10% 高度可以收窄，TOP_R 太小＝這段平均斜率超過 dot=0.3 的數學
# 上限（Δr/Δz≤3.18，即使换成完全線性的收窄也一樣會失敗，不是曲線形狀的問題，是「這麼窄的高度沒辦法
# 收這麼多半徑」的幾何硬限制）。0.52 是量過 0.30/0.40/0.50/0.52/0.55 後選的：dot=0.3406，比 0.3
# 門檻留有安全餘裕，頂端半徑跟底口（0.4846）相近、仍明顯小於肩部（0.9255）。
RING_R, RING_TUBE = BASE_R, HEIGHT * 0.016   # 竹框主半徑（貼底開口）／管半徑
WIRE_R = HEIGHT * 0.008                       # 十字鐵絲半徑
FLAME_Z, FLAME_DIMS = HEIGHT * 0.06, (HEIGHT * .07, HEIGHT * .07, HEIGHT * .11)

# 放樣輪廓（z 高度分率, 半徑）：三版規格「上寬下窄」——底開口（竹框）→單調變寬→肩部在 90% 高度
# 最寬→小幅收窄到頂端小圓面（封閉、微拱，拱起高度僅佔總高 10%，遠低於「≤15%」上限）。二版把最寬處
# 放在 55% 高度、兩端都收窄，做成蛋形（頂 0.16 < 底 0.48，「上窄下寬」），被主對話退回；三版把最寬處
# 搬到 90% 高度，方向整個反過來。SHOULDER_FRAC 選 0.90 而非最低要求的 0.80，是為了讓主對話驗收腳本
# 的「w90>w50>w10」粗抽樣也穩穩成立（若肩部只放在 0.80~0.85，抽樣點 0.90 可能已經過峰值開始下降，
# 反而讓 w90<w50，見自己算過的手算數字）。sine/cosine 兩段在 SHOULDER_FRAC 接點斜率都是 0
# （sin'(π/2)=cos'(0)=0），保證肩部是圓滑的最寬點而非硬轉折；下面平滑度自檢直接量連續兩圈半徑比、
# 擋掉任何單步驟降過陡的手改（邏輯照舊沿用二版，只是量測起點自動跟著最寬圈走）。
SHOULDER_FRAC = 0.90  # 肩部（最寬處）在 90% 高度，≥ 交棒規格要求的 80%
_FRACS = [0.00, 0.15, 0.30, 0.45, 0.60, 0.75, 0.90, 0.94, 0.97, 1.00]  # 顯式含 0.90，圈數 10


def _profile_r(frac):
    if frac <= SHOULDER_FRAC:
        t = frac / SHOULDER_FRAC
        return BASE_R + (SHOULDER_R - BASE_R) * math.sin(t * math.pi / 2)
    s = (frac - SHOULDER_FRAC) / (1 - SHOULDER_FRAC)
    return TOP_R + (SHOULDER_R - TOP_R) * math.cos(s * math.pi / 2)


PROFILE = [(f, _profile_r(f)) for f in _FRACS]

m_paper = 'cream'   # 中性預覽色；執行期由 InstancedMesh.setColorAt 決定實際紙色，這裡只是方便在 .blend 裡看
m_frame = 'wood'
m_flame = 'lamp'
N_SIDES = 4       # 四片紙（真實天燈的糊法）＝4 條接縫
CORNER_SCALE = 0.86  # 接縫角內縮到面中央半徑的 86%，做出「圓角方形」（不是圓、也不是尖角方形）
N_RING_VERTS = N_SIDES * 2  # 每圈 8 個頂點：4 個面中央（全徑）交錯 4 個接縫（內縮），見 _ring_xy()


def _ring_xy(rad, n=N_SIDES, corner_scale=CORNER_SCALE):
    """一圈 2n 個 (x,y)：n 個面中央（角度 i*360/n，全徑，四片紙微微鼓起的中央）交錯 n 個接縫
    （角度中間、corner_scale 倍徑，內縮出摺痕）。跟舊版「n=4 全部同半徑」的差異只在接縫角內縮，
    面中央角度與舊版 seam_ribs 的角度定義（45°/135°/225°/315°）互換——三版把那組角度重新定義為
    「接縫」，面中央改在 0°/90°/180°/270°，數值上兩者互為 45° 相位差，不影響外觀朝向。"""
    pts = []
    for i in range(n):
        a_face = i * 2 * math.pi / n
        a_seam = a_face + math.pi / n
        pts.append((rad * math.cos(a_face), rad * math.sin(a_face)))
        pts.append((rad * corner_scale * math.cos(a_seam), rad * corner_scale * math.sin(a_seam)))
    return pts


def lantern_paper(name, profile, height, material, n=N_RING_VERTS):
    """多圈放樣的紙燈殼：profile 是 [(z 高度分率, 半徑), ...]（由下到上），底環開口（無蓋）、頂環
    封口（小圓面，微拱非尖點）。每圈 n=8 個頂點（見 _ring_xy：4 面中央全徑交錯 4 接縫內縮），做出
    「圓角方形」剖面——四片紙、看得到接縫，不是圓也不是尖角方形。側面 face 繞法沿用 cyl() 的慣例
    (i,i+1,i+1+n,i+n)；頂蓋不反向。這是開放曲面（底部無蓋），self_check 直接量每一圈「側面法向量
    遠離該圈中軸」＋「頂蓋法向量朝 +Z」，不用有號體積（那個算法假設封閉網格）。"""
    verts = []
    for frac, rad in profile:
        z = frac * height
        for x, y in _ring_xy(rad):
            verts.append((x, y, z))
    faces = []
    for r in range(len(profile) - 1):
        b0, b1 = r * n, (r + 1) * n
        faces += [(b0 + i, b0 + (i + 1) % n, b1 + (i + 1) % n, b1 + i) for i in range(n)]
    faces.append(tuple(range((len(profile) - 1) * n, len(profile) * n)))  # 頂蓋（最後一圈，小圓面）
    return p.mesh(name, verts, faces, material, 0, False)


def seam_ribs(name_prefix, profile, height, material, n=N_SIDES, corner_scale=CORNER_SCALE):
    """沿 4 條接縫稜線（跟 lantern_paper 的 _ring_xy 同一組「接縫」角度與內縮半徑，貼著內縮後的
    表面走，不是貼著面中央）各拉一條細骨，加強「看得到接縫」的觀感（flat shading＋內縮本身已經讓
    接縫可見，這組細骨是額外的實體強調，不是唯一依據）。用 line()＝多段 rod() 串接，半徑取高度的
    0.7%（夠細，不會被誤認成竹框主結構）。"""
    r = height * 0.007
    objs = []
    for i in range(n):
        a_seam = i * 2 * math.pi / n + math.pi / n
        pts = [(rad * corner_scale * math.cos(a_seam), rad * corner_scale * math.sin(a_seam), frac * height)
               for frac, rad in profile]
        p.line(f'{name_prefix}_{i}', pts, r, material)
    return objs


def cross_wire(name_prefix, radius, z, material, n=10):
    """底開口的十字鐵絲：2 根互相垂直的 rod，跨過整個開口直徑，交叉點在中心（燃料紙／火從這裡懸掛）。"""
    a = p.rod(f'{name_prefix}_a', (-radius, 0, z), (radius, 0, z), WIRE_R, material, n=n)
    b = p.rod(f'{name_prefix}_b', (0, -radius, z), (0, radius, z), WIRE_R, material, n=n)
    return [a, b]


def ring_flat(name, center, R, r, material, n=10, m=4):
    """水平竹框（甜甜圈，孔洞軸沿 Z，躺平在 XY 平面）。座標式子＝torus_y() 的embedding 繞 X 軸轉 90°
    （正規旋轉，非鏡射，保定向）：torus_y 用 (rr cos a, r sin b, rr sin a) 當 (Δx,Δy,Δz)，
    繞 X 轉 90° 後 Δy'=-Δz(old)=-rr sin a、Δz'=Δy(old)=r sin b；面索引直接沿用 torus_y 的式子
    （同一個 (i,j) 拓樸，只換嵌入座標，繞法/朝外方向不變）。"""
    cx, cy, cz = center
    verts = []
    for i in range(n):
        a = 2 * math.pi * i / n
        for j in range(m):
            b = 2 * math.pi * j / m
            rr = R + r * math.cos(b)
            verts.append((cx + rr * math.cos(a), cy - rr * math.sin(a), cz + r * math.sin(b)))
    faces = [(i * m + j, ((i + 1) % n) * m + j, ((i + 1) % n) * m + (j + 1) % m, i * m + (j + 1) % m)
             for i in range(n) for j in range(m)]
    return p.mesh(name, verts, faces, material, 0, True)


def self_check_open_shell(obj_name, profile, n=N_RING_VERTS):
    """紙燈殼是開放曲面（無底蓋），逐圈驗「側面法向量遠離該圈中軸」，頂蓋法向量朝 +Z；門檻用 0.3
    而非 0，避免邊界情形勉強擦邊過關。多圈版本：面數應為 (圈數-1)*n + 1（頂蓋）。"""
    obj = bpy.data.objects[obj_name]
    mesh = obj.data
    mesh.calc_loop_triangles()
    polys = mesh.polygons
    rings = len(profile)
    expected = (rings - 1) * n + 1
    if len(polys) != expected:
        return False, f'面數={len(polys)}，預期 {expected}'
    bad = []
    for idx in range((rings - 1) * n):
        c, nrm = polys[idx].center, polys[idx].normal
        radial = Vector((c.x, c.y, 0))
        if radial.length < 1e-6 or nrm.dot(radial.normalized()) <= 0.3:
            bad.append(('side', idx, nrm.dot(radial.normalized()) if radial.length > 1e-6 else None))
    cap = polys[(rings - 1) * n]
    if cap.normal.z <= 0.3:
        bad.append(('cap', (rings - 1) * n, cap.normal.z))
    return (len(bad) == 0), bad


paper_obj = lantern_paper('lantern_paper', PROFILE, HEIGHT, m_paper)
ribs = seam_ribs('lantern_rib', PROFILE, HEIGHT, m_frame)
ring_obj = ring_flat('lantern_frame', (0, 0, 0), RING_R, RING_TUBE, m_frame, n=10, m=4)
wires = cross_wire('lantern_wire', BASE_R, 0.0, m_frame)
parts = {
    'lantern-paper': [paper_obj],
    'lantern-frame': [ring_obj] + wires + [bpy.data.objects[o.name] for o in ribs],
    'lantern-flame': [p.box('lantern_flame', (0, 0, FLAME_Z), FLAME_DIMS, m_flame, bevel=0)],
}
NAMES = ['lantern-paper', 'lantern-frame', 'lantern-flame']
for n in NAMES:
    if n not in parts:
        sys.exit(f'缺零件 {n}')
note('3 個零件物件建模完成：' + json.dumps({k: len(v) for k, v in parts.items()}, ensure_ascii=False))

ok, detail = self_check_open_shell('lantern_paper', PROFILE)
note(f'紙燈殼開放曲面自檢（逐圈側面遠離中軸／頂蓋朝 +Z）：{"通過" if ok else "失敗 " + json.dumps(detail)}')
if not ok:
    sys.exit(f'紙燈殼法向量自檢失敗：{detail}')

# 肩部鼓起自檢（三版取代「腰身鼓起自檢」——直接從剛建的物件按圈切頂點量半徑，不是抄 SHOULDER_R/
# BASE_R 常數，跟主對話驗收腳本的量法各自獨立）：肩部（最寬處）必須在 ≥80% 高度、且從底口到肩部
# 單調變寬、肩部明顯寬於底口與頂端——這才是「上寬下窄」的紙袋，不是二版的蛋形（最寬處在 55% 高度、
# 兩端都收窄）。ring_radii 逐圈取最大半徑（每圈 N_RING_VERTS 個頂點都量，面中央跟接縫內縮都涵蓋在
# 內，max() 自然只取到面中央那組全徑），跟建模時的 PROFILE 圈序一一對應。
paper_verts = [v.co for v in bpy.data.objects['lantern_paper'].data.vertices]
r_of = lambda v: math.hypot(v.x, v.y)
ring_radii = [max(r_of(paper_verts[r * N_RING_VERTS + i]) for i in range(N_RING_VERTS)) for r in range(len(PROFILE))]
ring_fracs = [f for f, _ in PROFILE]
shoulder_idx = ring_radii.index(max(ring_radii))
shoulder_frac_actual = ring_fracs[shoulder_idx]
bottom_r, shoulder_r, top_r = ring_radii[0], ring_radii[shoulder_idx], ring_radii[-1]
rise_ok = all(ring_radii[i] <= ring_radii[i + 1] + 1e-9 for i in range(shoulder_idx))
bulge_ratio = shoulder_r / bottom_r
note(f'肩部鼓起自檢：最寬處在第 {shoulder_idx} 圈（高度 {shoulder_frac_actual:.2f}，要求 ≥0.80），'
     f'肩部/底口={bulge_ratio:.3f}（要求 ≥1.5，原文比例約 1.91），底口={bottom_r:.4f} '
     f'肩部={shoulder_r:.4f} 頂端={top_r:.4f}（頂端應小於肩部：{top_r < shoulder_r}），'
     f'底口→肩部單調變寬：{rise_ok}')
if shoulder_frac_actual < 0.80:
    sys.exit(f'最寬處在高度 {shoulder_frac_actual:.2f}，不足 0.80，不是「上寬」')
if bulge_ratio < 1.5:
    sys.exit(f'肩部/底口 {bulge_ratio:.3f} 不足 1.5，不夠鼓')
if not (top_r < shoulder_r):
    sys.exit('頂端沒有比肩部窄，不是紙袋收口的鼓形')
if not rise_ok:
    sys.exit('底口到肩部不是單調變寬，中段有內縮')

# 平滑度自檢（圓 2 退回後新增，三版沿用同一套邏輯，量測起點自動跟著 shoulder_idx 走）：只驗端點
# 比例測不出「中段驟縮」——圓 1 版本用手動點位數字自檢全過，渲染出來卻像花瓶頸，主對話看
# lantern-sheet.png 才發現。這裡量肩部以後每一對相鄰圈的半徑比值，門檻 0.35（頂端收口到 tie-off
# 那一小步預期最陡，仍需 ≥0.35；圓 1 的 0.29 會在這裡被擋）。
step_ratios = [ring_radii[i + 1] / ring_radii[i] for i in range(shoulder_idx, len(ring_radii) - 1)]
worst_step = min(step_ratios) if step_ratios else 1.0
note(f'輪廓平滑度自檢：肩部在第 {shoulder_idx} 圈，往上每圈半徑比值={[round(x,3) for x in step_ratios]}，'
     f'最陡單步={worst_step:.3f}（要求 ≥0.35，避免花瓶頸式驟縮）')
if worst_step < 0.35:
    sys.exit(f'輪廓中段有驟縮（最陡單步比值 {worst_step:.3f} < 0.35），會渲染成花瓶／甕，不是圓潤紙袋')

# ============================================================
# 自製匯出（沿用 build_people.py 的模式：calc_loop_triangles + corner_normals，world space；
# 每個零件的頂點都直接寫在自己的局部座標，物件本身沒有額外的 object-level 平移/旋轉，
# world matrix＝identity，匯出值＝局部值）
# ============================================================
deps = bpy.context.evaluated_depsgraph_get()
raw = bytearray()
count = 0
part_ranges = {}
total_tris = 0

for name in NAMES:
    start_vertex = count
    for obj in parts[name]:
        ev = obj.evaluated_get(deps)
        d_mesh = ev.to_mesh()
        d_mesh.calc_loop_triangles()
        wm = obj.matrix_world
        nm_mat = wm.to_3x3().inverted_safe().transposed()
        for tri in d_mesh.loop_triangles:
            for li in tri.loops:
                pos = wm @ d_mesh.vertices[d_mesh.loops[li].vertex_index].co
                normal = (nm_mat @ d_mesh.corner_normals[li].vector).normalized()
                if not all(math.isfinite(v) for v in (*pos, *normal)):
                    raise ValueError('非有限網格 ' + obj.name)
                raw.extend(struct.pack('<6f', *pos, *normal))
                count += 1
            total_tris += 1
        ev.to_mesh_clear()
    part_ranges[name] = {'start': start_vertex, 'count': count - start_vertex}
    note(f'部件 {name!r}：start={start_vertex} count={count - start_vertex}（{(count - start_vertex)//3} 個三角形）')

# 三角形預算自檢：一盞天燈永遠是這 3 個零件的固定組合（不像人可換裝），直接加總跟上限比。上限從 150
# 提高到 500——多圈放樣＋4 條細骨＋十字鐵絲比初版（10 三角形的紙殼）複雜很多，但相對全場景 21 萬
# 三角形仍是小數目（單盞天燈的網格只存一份，InstancedMesh 共用，6→12 盞不會讓三角形數翻倍）。
worst = total_tris
note(f'三角形數自檢：{worst}（單盞天燈固定組合，上限 500）')
if worst > 500:
    sys.exit(f'單盞天燈三角形數 {worst} 超過 500')

raw_bytes = bytes(raw)
sha256 = hashlib.sha256(raw_bytes).hexdigest()
vertex_count = count

f = struct.unpack(f'<{len(raw_bytes)//4}f', raw_bytes)


def sub3(a, b):
    return (a[0] - b[0], a[1] - b[1], a[2] - b[2])


def cross3(a, b):
    return (a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0])


def dot3(a, b):
    return a[0]*b[0]+a[1]*b[1]+a[2]*b[2]


def pos_of(v):
    return (f[v*6], f[v*6+1], f[v*6+2])


def nrm_of(v):
    return (f[v*6+3], f[v*6+4], f[v*6+5])


# 全域無退化三角形（面積 >1e-10）——跟 build_people.py 的 P5 同一套算法。
degen = 0
first_bad = []
for v in range(0, vertex_count, 3):
    A, B, C = pos_of(v), pos_of(v+1), pos_of(v+2)
    area = math.hypot(*cross3(sub3(B, A), sub3(C, A))) / 2
    if not (area > 1e-10):
        degen += 1
        if len(first_bad) < 5:
            first_bad.append(v)
note(f'退化三角形自檢：{degen}（應為 0）')
if degen:
    sys.exit(f'{degen} 個退化三角形：{first_bad}')

# 朝外自檢（跟 build_people.py 的 P6 同一套算法）：紙燈殼／細骨（line()＝多段 rod()）是開放曲面，
# signed volume 對它們沒有清楚意義；細骨跟紙燈殼一樣是薄管狀開放曲面，一併排除，只對真正封閉的
# 零件（竹框圓環、十字鐵絲圓管、火）做這個檢查。紙燈殼已經在建模階段用 self_check_open_shell() 驗過；
# 細骨是裝飾性細管，不驗朝外（跟紙燈殼同類、rod() 產生的圓管本身就是封閉的但很細，驗了也無意義）。
CLOSED_PARTS_OBJS = [ring_obj] + wires + [parts['lantern-flame'][0]]
bad_parts = {}
for obj in CLOSED_PARTS_OBJS:
    name = obj.name
    # 用物件名稱在 raw 資料裡的對應範圍：這裡改成直接對這幾個物件各自重新遍歷其 evaluated mesh，
    # 不依賴 part_ranges（part_ranges 是依零件分類，同一個零件類別可能混了開放與封閉物件）。
    ev = obj.evaluated_get(deps)
    d_mesh = ev.to_mesh()
    d_mesh.calc_loop_triangles()
    wm = obj.matrix_world
    nm_mat = wm.to_3x3().inverted_safe().transposed()
    verts_local = []
    for tri in d_mesh.loop_triangles:
        for li in tri.loops:
            pos = wm @ d_mesh.vertices[d_mesh.loops[li].vertex_index].co
            normal = (nm_mat @ d_mesh.corner_normals[li].vector).normalized()
            verts_local.append((tuple(pos), tuple(normal)))
    ev.to_mesh_clear()
    c = len(verts_local)
    cen = [sum(v[0][k] for v in verts_local) / c for k in range(3)]
    bad6 = 0
    vol = 0.0
    for v in range(0, c, 3):
        A, B, C = verts_local[v][0], verts_local[v+1][0], verts_local[v+2][0]
        fn = cross3(sub3(B, A), sub3(C, A))
        vn = tuple(verts_local[v][1][k] + verts_local[v+1][1][k] + verts_local[v+2][1][k] for k in range(3))
        if not (dot3(fn, vn) > 0):
            bad6 += 1
        vol += dot3(sub3(A, cen), cross3(sub3(B, cen), sub3(C, cen))) / 6
    if bad6 or not (vol > 0):
        bad_parts[name] = {'反向三角形': bad6, '有號體積': f'{vol:.3e}'}
note('封閉零件朝外自檢：' + (json.dumps(bad_parts, ensure_ascii=False) if bad_parts else '全部通過'))
if bad_parts:
    sys.exit(f'朝外自檢失敗：{bad_parts}')

part_list = [{'name': n, 'start': part_ranges[n]['start'], 'count': part_ranges[n]['count']} for n in NAMES]

rig = {'height': HEIGHT, 'bottomRadius': BASE_R, 'shoulderRadius': SHOULDER_R, 'topRadius': TOP_R}
meta = {
    'schema': 'garage-parts-v1', 'id': 'lanterns', 'kind': 'lanterns', 'units': 'model',
    'vertexCount': vertex_count, 'triangleCount': total_tris, 'sha256': sha256,
    'rig': rig,
    'parts': part_list,
}
(BUILD_DIR / 'lanterns.raw.bin').write_bytes(raw_bytes)
(BUILD_DIR / 'lanterns.meta.json').write_text(json.dumps(meta, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
bpy.ops.wm.save_as_mainfile(filepath=str(BUILD_DIR / 'lanterns.blend'))

# ---- 直接安裝為正式資產：沒有既有 lanterns.json 要合併，一次寫出 ----
ASSET_DIR.mkdir(parents=True, exist_ok=True)
asset = {
    'schema': 'garage-parts-v1', 'id': 'lanterns', 'kind': 'lanterns', 'units': 'model',
    'mesh': {'file': 'lanterns.bin.gz', 'sha256': sha256, 'encoding': 'float32-le', 'strideBytes': 24,
             'vertexCount': vertex_count, 'triangleCount': total_tris, 'compression': 'gzip'},
    'rig': rig,
    'parts': part_list,
}
(ASSET_DIR / 'lanterns.bin.gz').write_bytes(gzip.compress(raw_bytes, compresslevel=9, mtime=0))
(ASSET_DIR / 'lanterns.json').write_text(json.dumps(asset, ensure_ascii=False, separators=(',', ':')) + '\n', encoding='utf-8')

print('GD_LANTERNS_BUILD_OK', json.dumps({
    'vertexCount': vertex_count, 'triangleCount': total_tris, 'sha256': sha256, 'worst': worst,
    'bulge_ratio': round(bulge_ratio, 3), 'rig': rig, 'parts': {n: part_ranges[n]['count'] // 3 for n in NAMES},
}, ensure_ascii=False))
