"""EMU3000 車庫資產：加開闔式側門（門洞、門內、壁袋、可動門扇）。
以 scripts/blender/emu3000-20260912/ 快照重建 emu3000 頭車後再改；快照本身不動。
同目錄 base_geometry.py（基準幾何，供 render_baseline.py 重建「改動前」對照用）、
render_common.py（算繪共用的太陽燈／俯角相機設定）為本檔 round 2 抽出的共用模組。
用法：
  FLEET_RENDER=0 /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup -t 4 \
    --python scripts/blender/emu3000-doors-20260924/build_doors.py -- <絕對輸出目錄=.../output/emu3000-doors/build>
輸出（到 <絕對輸出目錄>，即 output/emu3000-doors/build/）：
  emu3000-doors.raw.bin   float32 位置+法向量 stride 24、與現有資產同編碼，未壓縮
  emu3000-doors.meta.json vertexCount/triangleCount/bounds/sizeM/drawGroups/doors，供 install_assets.py 合併進正式資產
其餘固定輸出（output/emu3000-doors/ 底下，不受參數控制）：
  NOTES.md             施工筆記（邊做邊寫，見 note()）
  emu3000-doors.blend  可編修場景另存（不進 repo）
  renders/01~04*.png   FLEET_RENDER=1 時的四張驗收算繪圖（關門／半開／全開／門內斜角特寫）；
                        另需單獨跑 render_baseline.py 產生 renders/00-before-closed.png（改動前對照）
"""
import sys, math, json, struct, hashlib, time
from pathlib import Path

# --- rule 10：先關閉 bytecode 快取，才 import 快照目錄的模組 ---
sys.dont_write_bytecode = True

W = Path(__file__).resolve().parents[3]  # repo 根目錄（scripts/blender/<本目錄>/<本檔>）
SNAP = W / 'scripts/blender/emu3000-20260912'
OUT_ROOT = W / 'output/emu3000-doors'
NOTES_PATH = OUT_ROOT / 'NOTES.md'
RENDERS_DIR = OUT_ROOT / 'renders'
BLEND_PATH = OUT_ROOT / 'emu3000-doors.blend'

sys.path.insert(0, str(SNAP))
import bpy, bmesh
from mathutils import Vector, Matrix
import blender_parts as p
import build_models as b
from model_specs import S

sys.path.insert(0, str(Path(__file__).resolve().parent))
from base_geometry import build_baseline
import render_common as rc

ARGV = sys.argv[sys.argv.index('--') + 1:]
BUILD_OUT = Path(ARGV[0]) if ARGV else (OUT_ROOT / 'build')
BUILD_OUT.mkdir(parents=True, exist_ok=True)
RENDERS_DIR.mkdir(parents=True, exist_ok=True)


def note(text):
    ts = time.strftime('%H:%M:%S')
    with open(NOTES_PATH, 'a', encoding='utf-8') as f:
        f.write(f'\n### {ts}  {text}\n' if text.startswith('#') else f'- {ts} {text}\n')


note('build_doors.py 開始執行。')

# ============================================================
# 1. 重建基準幾何：b.passenger(spec) ＋ emu3000-20260912/refine.py 的日立前窗修訂
#    （round 2 抽到 base_geometry.py，讓 render_baseline.py 能重建逐位元相同的「改動前」幾何）
# ============================================================
spec, L, W_, H = build_baseline(p, b, S)
note('基準幾何重建完成（b.passenger + 日立前窗修訂，base_geometry.build_baseline）。物件數=' + str(len(p.MODEL)))

# ============================================================
# 2. 找出車殼與既有車門零件；量出實際門位（不用公式硬推，直接讀場景）
# ============================================================
shell_obj = next(o for o in p.MODEL if o.get('primary_body'))


def bbox_center_extent(o):
    coords = [o.matrix_world @ Vector(v) for v in o.bound_box]
    mn = Vector((min(c[i] for c in coords) for i in range(3)))
    mx = Vector((max(c[i] for c in coords) for i in range(3)))
    return (mn + mx) / 2, mn, mx


leaf_objs = [o for o in p.MODEL if o.get('side_door')]
assert len(leaf_objs) == 4, f'預期 4 片門扇，實得 {len(leaf_objs)}'

doors_info = []  # list of dict: cx, side, leaf_obj
for o in leaf_objs:
    c, mn, mx = bbox_center_extent(o)
    side = 1 if o.get('side') == 1 else -1
    doors_info.append({'cx': round(c.x, 6), 'side': side, 'leaf_obj': o})

doors_info.sort(key=lambda d: (d['cx'], d['side']))
note('量得門扇位置：' + json.dumps([{'cx': d['cx'], 'side': d['side']} for d in doors_info], ensure_ascii=False))

# --- id 規則：+Y=L、-Y=R；-X端=1、+X端=2 ---
xs_sorted = sorted(set(d['cx'] for d in doors_info))
assert len(xs_sorted) == 2, f'預期 2 個 X 位置，實得 {xs_sorted}'
END_OF = {xs_sorted[0]: 1, xs_sorted[1]: 2}
for d in doors_info:
    d['end'] = END_OF[d['cx']]
    d['id'] = ('L' if d['side'] == 1 else 'R') + str(d['end'])
    # 車廂中心 x≈0；−X 端(1) 的中心方向是 +X，+X 端(2) 的中心方向是 −X。
    d['sig'] = 1 if d['end'] == 1 else -1

note('door id 對照：' + json.dumps([{'id': d['id'], 'cx': d['cx'], 'side': d['side'], 'sig': d['sig']} for d in doors_info], ensure_ascii=False))

# --- 只移除側門門框（被 3D 門框環取代——原本是貼死在實心殼面上的平面裝飾，殼面現在真的有洞，
#     平面裝飾無法再蓋住有深度的洞口）。門窗嵌框／門窗玻璃／門把凹槽維持快照原樣不動、不重建——
#     round 2 修正：round 1 把這三者壓縮進 |y|1.454~1.478 薄片，跟快照原本的位置（把手凸到
#     1.5155、玻璃在 1.494~1.506）不符，導致另加一個固定把手座複製件充當「車寬邊界撐開者」；
#     全開後那個固定複製件浮在門口中央，看起來像門沒開（D5 判準加嚴後真的抓到）。
#     改正做法：直接沿用快照建出來的這 3 個物件＋門扇本身，一起原封不動列入可動群組（見下方
#     find_door_part() 比對＋建門迴圈），不新建任何替代幾何，也不用固定複製件。
REMOVE_PREFIXES = ('側門門框',)
removed = 0
leaf_set = set(id(o) for o in leaf_objs)
for o in list(p.MODEL):
    if id(o) in leaf_set:
        continue
    if o.name.startswith(REMOVE_PREFIXES):
        p.MODEL.remove(o)
        bpy.data.objects.remove(o, do_unlink=True)
        removed += 1
note(f'移除舊側門門框（被 3D 門框環取代）共 {removed} 個；門窗嵌框／門窗玻璃／門把凹槽維持快照原樣不動，'
     f'稍後與門扇一起整組列入可動群組（round 2 修正，見 find_door_part）。')


def find_door_part(prefix, cx, side, taken):
    """在 p.MODEL 裡找快照原本建出的門零件（名稱前綴比對＋座落於這扇門附近），
    不重建、不搬動座標——只用來『認出』要收進可動群組的既有物件。
    taken：已配對過的物件 id 集合，避免把 A 門的把手誤配給隔壁 B 門。"""
    best, best_dist = None, None
    for o in p.MODEL:
        if id(o) in taken or not o.name.startswith(prefix):
            continue
        c, _, _ = bbox_center_extent(o)
        if (c.y > 0) != (side > 0):
            continue
        dist = abs(c.x - cx)
        if best is None or dist < best_dist:
            best, best_dist = o, dist
    if best is None:
        raise AssertionError(f'找不到 {prefix} 對應 cx={cx} side={side}（快照物件可能改名或被上一步誤刪）')
    taken.add(id(best))
    return best

# 車門踏板（外側踏板，非門內地板）維持原樣，不受影響。

# ============================================================
# 3. 車殼開洞（布林 EXACT），布林前後量非流形邊
# ============================================================


def nm_edge_count(mesh_obj):
    bm = bmesh.new()
    bm.from_mesh(mesh_obj.data)
    n = sum(1 for e in bm.edges if not e.is_manifold)
    bm.free()
    return n


nm_before = nm_edge_count(shell_obj)
note(f'車殼布林前非流形邊：{nm_before}（預期：車頭鼻端在銜接前臉貼件處開放的既有邊界，與車門位置無關——車門 x 落在 [-4.5,-3.9] 與 [3.1,3.8]，非流形邊 x 落在 [3.91,4.71]，兩者不重疊，不需先修）。')

HOLE_W = .635
HOLE_H = 2.21
DOOR_CZ = 2.02
LEAF_W = .625
LEAF_H = 2.2


def cut_door_hole(cx, side):
    # 車殼是單層薄殼、但整個物件是封閉的「管子」（車內是空氣，不是實心）——EXACT 布林挖洞時，
    # 洞緣的新面是補在「切刀本身的邊界」上，不是補在車殼那層薄皮的實際厚度上。切刀深度若貫穿到
    # 壁袋淨空帶（|y|<1.40）裡面，就會在車殼上多切出一條深入壁袋的「隧道」內壁，把 D9 的滑動路徑擋死
    # （build 過程中量到 t≈0.61 撞到車殼，才發現這個坑：原本 depth=1.0 對稱切，內緣切到 |y|=.943）。
    # 改成不對稱：內緣正好停在 1.40（壁袋淨空下限，絕不再往內），外緣留很多餘量、確保真的貫穿表層。
    inner_y = side * 1.40
    outer_y = side * 2.20
    y_center = (inner_y + outer_y) / 2
    depth = abs(outer_y - inner_y)
    bpy.ops.mesh.primitive_cube_add(size=1, location=(cx, y_center, DOOR_CZ))
    cutter = bpy.context.active_object
    # primitive_cube_add(size=1) 的本地半徑是 .5；scale=(全寬,全深,全高) 才會得到「全寬×全深×全高」的實際方塊
    # （若誤用半徑值當 scale，方塊只會有一半大小——已在 scratchpad 驗過這個坑，見下方 NOTES 記錄）
    cutter.scale = (HOLE_W, depth, HOLE_H)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    cutter.name = f'DOOR CUTTER {cx:.2f} side{side}'
    bpy.context.view_layer.objects.active = shell_obj
    mod = shell_obj.modifiers.new('door_cut', 'BOOLEAN')
    mod.operation = 'DIFFERENCE'
    mod.solver = 'EXACT'
    mod.object = cutter
    bpy.ops.object.modifier_apply(modifier=mod.name)
    bpy.data.objects.remove(cutter, do_unlink=True)


# --- 門內零件的裁切母模：先複製「挖洞前」的完整車殼，沿頂點法向量往內縮 12mm，做成一個無洞、
#     往內縮的完整曲面。之後每扇門的門廳地板／天花板／端牆／隔間牆都跟這個曲面做 EXACT INTERSECT，
#     確保這些零件在門洞以外的地方貼著車殼實際曲面往內縮至少 12mm（coordinator 定的下限是
#     ≥5mm；6mm 版本在 L2 車端端牆最頂角落 z≈3.10~3.12 還殘留一小塊沒裁乾淨的平板尖角——很可能
#     是圓肩主車殼只有 921 面，該角落三個曲率交會處單靠頂點法向量做偏移不夠精準——加大到 12mm
#     後那一小塊也乾淨了，D8 踏板高與 D9 壁袋淨空都仍在寬裕誤差內，改一個常數沒有其他副作用）。
#     round 2 這些零件用平板貼死在 |y|=1.425 常數面，在車殼上下圓弧、車端圓角處凸出實際曲面最多
#     7.8cm，平直處又跟車殼共面（z-fighting／閃爍黑線）。必須用「挖洞前」的完整曲面複製——裁切
#     母模若挖了洞，會把門內零件該伸到門框環邊界的部分也一併裁掉。
shell_clip_src = shell_obj.copy()
shell_clip_src.data = shell_obj.data.copy()
shell_obj.users_collection[0].objects.link(shell_clip_src)
shell_clip_src.name = 'GD_SHELL_CLIP_SRC_12mm_inset'
_bm = bmesh.new()
_bm.from_mesh(shell_clip_src.data)
_bm.verts.ensure_lookup_table()
_bm.normal_update()
for _v in _bm.verts:
    _v.co -= _v.normal * .012
_bm.to_mesh(shell_clip_src.data)
_bm.free()
shell_clip_src.data.update()
note('已複製挖洞前的車殼並沿頂點法向量往內縮 12mm（原 6mm，L2 端牆頂角落裁不乾淨故加大），做為門內零件的 INTERSECT 裁切母模。')

# 另複製一份「挖洞前」車殼、位置不動，留給挖洞後修法向量用（見下方——round 3 定案是 Data
# Transfer CUSTOM_NORMAL／POLYINTERP_NEAREST，變數沿用建立時的名字）。
shell_smooth_src = shell_obj.copy()
shell_smooth_src.data = shell_obj.data.copy()
shell_obj.users_collection[0].objects.link(shell_smooth_src)
shell_smooth_src.name = 'GD_SHELL_NORMAL_SRC_pristine'

for d in doors_info:
    cut_door_hole(d['cx'], d['side'])
note(f'車殼四個門洞布林切割完成（EXACT，寬{HOLE_W}×高{HOLE_H}，中心 z={DOOR_CZ}）。')

nm_after = nm_edge_count(shell_obj)
note(f'車殼布林後非流形邊：{nm_after}。')
if nm_after > nm_before:
    note('非流形邊增加（未預期；round 3 起不再自動 remove_doubles+recalc_normals 修復，見下方說明，先如實記錄）。')
else:
    note('非流形邊未增加（布林未在車門區域引入新的非流形邊）。')

# round 3 修正第一輪（刪除 round 2 的 bm.from_mesh()/remove_doubles/recalc_face_normals/
# bm.to_mesh() 整體重算）：改完仍用 D12 逐格比對，法向量差 >12° 的區域完全沒變、且刪除前後
# sha256 早先量過是一樣的——證明那段從來就不是主因。
# round 3 第二輪嘗試（Data Transfer，NEAREST_POLYNOR，來源＝挖洞前車殼複製）：診斷腳本 D12 的
# diffPx 數字有下降，但用 probe_raytrace.mjs 實際看差異圖才發現這個方向是錯的——車頭鼻端曲面
# 是密集小三角形組成的連續曲面，「逐角找最近＋最佳匹配面法向量」在這種地方會逐三角形跳著選源面，
# 把原本平滑的插值法向量抄成一片刻面（facet）扇形紋，比原本更明顯偏離 BASE（見 rt3_L2_perp.png
# 中欄，跟左欄 BASE 的平滑漸層對比一看就懂）。
#
# round 3 第三輪（無條件全設 use_smooth=True）：改完 D12 diffPx 反而大幅變差（R1 15415→93381、
# L2 78435→153632）——證明 BASE 的車殼本來就不是整片平滑著色，是平滑／平面面混雜（車頭鼻端一類
# 曲面平滑、某些角面／折線刻意平面著色），無條件全設 True 把 BASE 原本刻意平面的面也一起抹平了。
#
# round 3 第四輪（DATA_TRANSFER modifier，data_types_polys={'SMOOTH'}，poly_mapping='NEAREST'）：
# 跑出來的 sha256 跟第三輪「無條件全設 True」逐位元相同——懷疑 modifier 的 NEAREST 面中心比對
# 沒有像預期那樣逐面配對（或整批都配到同一個來源面），沒有繼續深究 modifier 內部行為，改成
# 直接在 Python 裡自己做面中心比對，好除錯、好控制容差、也不依賴 modifier 黑盒。
#
# round 3 第五輪（逐面比對面中心座標抄 use_smooth，來源＝挖洞前車殼複製，5mm 內才採信）：
# 跑出來 sha256 跟「完全不修」逐位元相同（matched=745／unmatched=176，但 745 個裡沒有一個
# 值真的被改動）——證明 EXACT 布林本身就有正確保留 use_smooth，這個旗標從頭到尾不是問題所在。
# 真正的因素是：布林把這一帶重新三角化過（跟 BASE 的三角形切法不同），即使兩邊 use_smooth
# 都是 True、幾何位置也几乎一樣，「平滑法向量＝鄰接面加權平均」這個算法本身會因為鄰接關係
# （哪些面共用哪個頂點）不同而算出不同方向的插值法向量——單純抄旗標救不了，要直接把最終法向量
# 值抄過去，繞開三角化差異本身。
#
# round 3 第六輪（Data Transfer，CUSTOM_NORMAL，POLYINTERP_NEAREST）：車頭鼻端／車頂圓肩一帶
# 明顯改善（R2 77756→13105、L2 78435→13649），但門 1 端（R1/L1，車殼 x=-4.8 端牆邊界，821 面
# 的粗網格車殼在那裡是塊接近垂直的端封面）完全沒有反應，diffPx 逐位元不變；換 POLYINTERP_LNORPROJ
# （投影比對）結果一樣不變；懷疑不是比對方式的問題，改用 scene 全物件 ray_cast 對照精確 3D 座標
# 反查才確認：命中點 x 精確落在 shell_obj 自己的邊界 x=-4.8（primary_body 唯一符合的物件，921 面
# 的粗網格），不是別的物件。車殼只有 921 面（大片 n-gon），EXACT 布林幾乎必然把整個網格重新
# 三角化成數量、切法都不同的細三角形；面級最近面比對在粗網格（來源）↔細網格（挖洞後）之間，
# 對高曲率角落這種來源沒幾個大面可插值的地方，插不出跟 BASE 一致的細緻梯度——換插值方式沒用，
# 因為問題不在「怎麼找對應面」，在「來源本身的面太粗，插不出來」。
#
# round 3 第七輪（頂點級、座標完全比對，讀 vertex.normal）：改完 D12 反而大幅變差（跟「無條件
# 全設平滑」同量級）——vertex.normal 是不分邊角的單一平均值，遇到來源頂點本身橫跨平滑／平面
# 混雜面（跟第三輪同一個病根：BASE 本來就不是整片平滑）就抹平掉刻意的平面轉折，比不修更糟。
#
# round 3 第八輪（頂點級座標比對＋角級取值，來源角法向量需彼此一致<1°才收表）：R1／L1 diffPx
# 與第六輪 POLYINTERP_NEAREST 逐像素相同（=完全沒配到、維持布林原生值，佐證 R1/L1 的殘留跟任何
# 抄法向量手法無關，見下方說明）；但 R2／L2 從 13105／13649 惡化到 81991／80863，比完全不修
# （77756／78435）還差。根因很可能是「座標四捨五入到 0.1mm」在鼻端摺線那一帶撞到來源網格裡
# 位置重合、但屬於摺線兩側、各自獨立平滑（因此各自都通過 <1° 檢查）的不同頂點——字典用座標當
# key 會讓後出現的那個覆蓋掉前一個，等於把摺線其中一側的法向量錯誤套用到另一側原本不該碰的
# 大片角落，比布林原生值更糟。第八輪捨棄。
#
# round 3 定案（沿用第六／七輪 DATA_TRANSFER，POLYINTERP_NEAREST）：實測是目前所有嘗試中
# R2／L2 效果最好（77756→13105、78435→13649，改善 82~83%）、且不會像第八輪那樣製造新的更大
# 誤差。R1／L1 對本方案與所有嘗試（NEAREST_POLYNOR／POLYINTERP_NEAREST／POLYINTERP_LNORPROJ／
# 烘焙 corner_normals／頂點座標比對，逐 pixel 完全相同）一律零反應，已用獨立射線重建
# （find_r1_hit.mjs）＋窮舉 bbox 比對確認：命中點落在圓肩主車殼（921 面粗網格）自己的車端邊界
# （x=-4.8），EXACT 布林在那裡重新三角化出的頂點跟來源（挖洞前）完全對不上（座標不重合、
# 面／角級最近鄰插值也救不回來源那條細緻漸層），屬於「來源網格太粗、插值結構性做不到」而非
# 修法本身的錯，故 round 3 定案為此，R1／L1 殘留寫進報告，不繼續嘗試第九輪。
#
# 訂正（round 4，coordinator 對正式資產實測）：上面「座標不重合、結構性做不到」不成立。x=-4.8 端牆
# 在 BASE 與本輸出的頂點集合完全相同（96/96），角落法向量也一樣；差別是這片多邊形被切成不同的
# 三角形（94 個只有 21 個相同）。它的角落法向量跟圓角一起平滑、往外傾 45～50°，整面明暗由切法
# 決定，所以任何抄法向量的做法都零反應。現在由 install_assets.py 併入時處理：端牆整塊換回 BASE 的
# 三角形（restore_base_triangulation），其餘逐角改回 BASE 的法向量（restore_base_normals），D12 全過。
# 這裡的 DATA_TRANSFER 保留（改善鼻端），不影響併入結果。
shell_normal_src = shell_smooth_src
bpy.context.view_layer.objects.active = shell_obj
_dt = shell_obj.modifiers.new('restore_normals', 'DATA_TRANSFER')
_dt.object = shell_normal_src
_dt.use_loop_data = True
_dt.data_types_loops = {'CUSTOM_NORMAL'}
_dt.loop_mapping = 'POLYINTERP_NEAREST'
bpy.ops.object.modifier_apply(modifier=_dt.name)
_normal_src_mesh = shell_normal_src.data
bpy.data.objects.remove(shell_normal_src, do_unlink=True)
bpy.data.meshes.remove(_normal_src_mesh)
note('已用 Data Transfer（CUSTOM_NORMAL，POLYINTERP_NEAREST，來源＝挖洞前車殼複製）把車殼法向量抄回——round 3 定案版，取代前七輪失敗的嘗試（整體重算法向量／NEAREST_POLYNOR 面級抄法向量刻面／POLYINTERP_LNORPROJ 較差／無條件全設平滑／DATA_TRANSFER modifier SMOOTH／逐面比對抄 use_smooth 無效／烘焙來源 corner_normals 無效／頂點座標比對+角級取值在鼻端摺線位置重合處覆蓋錯值，見上方八段註解）。R1／L1 殘留（15415／24008 diffPx，純法向量差異）是車端端牆（x=-4.8）切法不同、頂點與角落法向量都跟 BASE 相同，由 install_assets.py 併入時換回 BASE 的切法（見 README 第 8 點）。')

# 逐洞確認真的貫穿（沿 -side*Y 從外側射線，命中點應落在洞內或更深處，不是原車殼外表面 y≈±1.425）
for d in doors_info:
    origin = Vector((d['cx'], d['side'] * 3.0, DOOR_CZ))
    direction = Vector((0, -d['side'], 0))
    hit, loc, nrm, idx = shell_obj.ray_cast(origin, direction)
    note(f"門洞貫穿檢查 {d['id']}：hit={hit} y={loc.y if hit else None}（應遠小於 {d['side']*1.4:.3f}，即洞已打通）")

# 車殼是薄殼，門洞只挖在車殼這個物件上；但「連續腰線」（side_band() 畫的車身色帶，hitachi 車頭在
# passenger() 內建了 z=H-.91／z=1.30 兩條，見 build_models.py:163-164）是跨整節車身的獨立長條物件，
# 車殼挖洞不會連帶切開它——開門後它會變成一根浮空橫在門口的硬邊，還會擋住 D7 的射線。逐一補切同寬的缺口。
belt_objs = [o for o in p.MODEL if o.name.startswith('連續腰線')]
belt_cut_count = 0
for belt in belt_objs:
    # 注意：這批物件的座標是直接烘進頂點資料，物件本身的 transform 是單位矩陣，
    # matrix_world.translation 恆為 0——不能拿來判斷位置，要用 bound_box（世界座標）實測中心
    # （跟 scratchpad recon.py 判斷門扇/門框位置用的是同一招）。
    coords = [belt.matrix_world @ Vector(v) for v in belt.bound_box]
    by = sum(c.y for c in coords) / len(coords)
    belt_side = 1 if by > 0 else -1
    for d in doors_info:
        if d['side'] != belt_side:
            continue
        bpy.ops.mesh.primitive_cube_add(size=1, location=(d['cx'], by, DOOR_CZ))
        cutter = bpy.context.active_object
        belt_cut_w = .705  # 比照下方 RING_OUTER_W（門框環定義在後面，這裡先寫死同一個數字，兩處要一起改）
        cutter.scale = (belt_cut_w, 1.0, 4.0)  # 寬度比照門框環，高度隨意超量，反正只切腰線那薄薄一條
        bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
        cutter.name = f'BELT CUTTER {belt.name} {d["id"]}'
        bpy.context.view_layer.objects.active = belt
        mod = belt.modifiers.new('belt_cut', 'BOOLEAN')
        mod.operation = 'DIFFERENCE'
        mod.solver = 'EXACT'
        mod.object = cutter
        bpy.ops.object.modifier_apply(modifier=mod.name)
        bpy.data.objects.remove(cutter, do_unlink=True)
        belt_cut_count += 1
note(f'連續腰線（車身色帶，{len(belt_objs)} 個獨立長條物件）在門洞位置補切 {belt_cut_count} 個缺口，避免開門後色帶浮空擋在門口，也避免擋住 D7 射線。')

# ============================================================
# 4. 每扇門：重建門扇子零件（沿用快照原幾何，|y| 1.454~1.5155）＋ 門框環 ＋ 車廂內裝
# ============================================================
RING_OUTER_W = .705
RING_OUTER_H = 2.235
RING_Y = None  # 由下方每側決定

END_MARGIN = .275       # 「車端」那側可用深度
CENTER_MARGIN = 1.10     # 「車廂中心」那側到隔間牆的距離（需 > .9725 才不擋 D9 的壁袋滑動測距）
VEST_Y_OUT = 1.425       # 車殼內側（門洞）
VEST_Y_IN = .875         # 車廂中心側（門廳深度邊界）
FLOOR_Z = .921
CEIL_Z = 3.12
PARTITION_Y_SPLIT = 1.225  # 隔間牆通道口以上實牆、以下開口


def clip_to_shell(obj):
    """把 obj 裁到「車殼往內縮 12mm」的實體內（EXACT INTERSECT，母模＝上面的 shell_clip_src）——
    門內零件在門洞以外的地方不准凸出車殼曲面、也不准跟車殼共面。門洞範圍內因為母模沒有洞，
    零件伸到門框環邊界的部分不受影響。"""
    bpy.context.view_layer.objects.active = obj
    mod = obj.modifiers.new('clip_to_shell', 'BOOLEAN')
    mod.operation = 'INTERSECT'
    mod.solver = 'EXACT'
    mod.object = shell_clip_src
    bpy.ops.object.modifier_apply(modifier=mod.name)


def build_ring_frame(door_id, cx, side):
    """關門時蓋住縫的門框環：用四根長條組成畫框，取代舊的實心側門門框。"""
    p.use('02')
    y = side * 1.440
    depth = .012
    half_out_w, half_out_h = RING_OUTER_W / 2, RING_OUTER_H / 2
    half_in_w, half_in_h = HOLE_W / 2, HOLE_H / 2
    top_h = half_out_h - half_in_h
    side_w = half_out_w - half_in_w
    objs = []
    # 三角形預算：純結構用的細長條不用倒角（bevel=0），面中心位置不受影響、只省三角形
    objs.append(p.box(f'側門門框環 上 {door_id}', (cx, y, DOOR_CZ + half_in_h + top_h / 2),
                       (RING_OUTER_W, depth, top_h), 'frame', 0))
    objs.append(p.box(f'側門門框環 下 {door_id}', (cx, y, DOOR_CZ - half_in_h - top_h / 2),
                       (RING_OUTER_W, depth, top_h), 'frame', 0))
    objs.append(p.box(f'側門門框環 左 {door_id}', (cx - half_in_w - side_w / 2, y, DOOR_CZ),
                       (side_w, depth, HOLE_H), 'frame', 0))
    objs.append(p.box(f'側門門框環 右 {door_id}', (cx + half_in_w + side_w / 2, y, DOOR_CZ),
                       (side_w, depth, HOLE_H), 'frame', 0))
    # round 1 這裡原本還加了一個「固定把手座」複製件，理由是 D2 需要車寬 bounds 與 BASE 逐分量差
    # ≤1e-4，而原車寬邊界正是由門把凹槽（凸到 1.5155）撐出來的、round 1 把門把壓進可動薄片後車寬
    # 會內縮，所以另外複製一個不動的假把手撐住邊界。round 2 已改成門把凹槽直接原封不動整個列入
    # 可動群組（見 find_door_part）——關門（＝匯出的預設狀態）時門把本來就還在原位，bounds 自然
    # 不變，不需要這個複製件；複製件本身在全開時會浮在門口中央，是這輪要修的問題根源，已刪除。
    return objs


def build_vestibule(door_id, cx, side, sig):
    p.use('02')
    # end_x 要從「門洞邊緣」量 END_MARGIN，不是從 cx 量：門洞半寬 HOLE_W/2=.3175，
    # 若直接 cx-sig*END_MARGIN(=.275) 會比門洞邊緣更靠近中心，端牆整個蓋進門洞／滑動起點裡，
    # 擋住 D9 的射線（射線起點就在門洞邊緣附近，t≈0 就撞到端牆）——這裡是 build 過程中用
    # verify_garage_stop_assets.mjs D9 抓出來的座標系用錯，不是刻意的簡化。
    end_x = cx - sig * (HOLE_W / 2 + END_MARGIN)
    mid_x = cx + sig * CENTER_MARGIN
    x0, x1 = (end_x, mid_x) if end_x < mid_x else (mid_x, end_x)
    span_x = x1 - x0
    ctr_x = (x0 + x1) / 2

    # 三角形預算：門廳結構件不用倒角（bevel=0）——BEVEL modifier segments=3 對小盒子代價很高，
    # 而倒角只削邊角、面中心位置不變，D 系射線都打面中心，拿掉不影響任何判準。
    # 地板：頂面 = FLOOR_Z，與門檻踏板頂齊平
    floor_t = .04
    floor_obj = p.box(f'門廳地板 {door_id}', (ctr_x, side * (VEST_Y_OUT + VEST_Y_IN) / 2, FLOOR_Z - floor_t / 2),
          (span_x, VEST_Y_OUT - VEST_Y_IN, floor_t), 'rubber', 0)

    # 天花板蓋（結構用車身料；發光頂燈另外放一塊 window 角色材質）
    ceil_t = .04
    ceil_obj = p.box(f'門廳天花板 {door_id}', (ctr_x, side * (VEST_Y_OUT + VEST_Y_IN) / 2, CEIL_Z + ceil_t / 2),
          (span_x, VEST_Y_OUT - VEST_Y_IN, ceil_t), 'body', 0)

    # 頂燈（window 發光角色）：命名比照既有客窗前綴，讓角色標記邏輯自動歸類到 railLight:window:glass
    # （y=1.15 遠在裁切邊界內側，不受下面的 INTERSECT 裁切影響，故不列入 clip_to_shell）
    lamp_w, lamp_d = .34, .30
    p.box(f'獨立深色玻璃 門內頂燈 {door_id}', (cx, side * 1.15, CEIL_Z - .02), (lamp_w, lamp_d, .016), 'glass', 0)

    # 靠車端那側：實牆
    end_obj = p.box(f'門廳端牆 {door_id}', (end_x, side * (VEST_Y_OUT + VEST_Y_IN) / 2, (FLOOR_Z + CEIL_Z) / 2),
          (.03, VEST_Y_OUT - VEST_Y_IN, CEIL_Z - FLOOR_Z), 'body', 0)

    # 靠車廂中心那側：隔間牆（只在 |y| PARTITION_Y_SPLIT~VEST_Y_OUT 是實牆，
    # |y| VEST_Y_IN~PARTITION_Y_SPLIT 讓開＝通道口，同時確保這個 X 已經在 D9 測距範圍之外，不擋壁袋滑動）
    part_obj = p.box(f'隔間牆 {door_id}', (mid_x, side * (PARTITION_Y_SPLIT + VEST_Y_OUT) / 2, (FLOOR_Z + CEIL_Z) / 2),
          (.06, VEST_Y_OUT - PARTITION_Y_SPLIT, CEIL_Z - FLOOR_Z), 'frame', 0)

    # round 3：以上 4 個零件（地板／天花板／端牆／隔間牆）外緣貼在 VEST_Y_OUT=1.425 常數面，
    # 在車殼上下圓弧、車端圓角處會凸出實際車殼曲面（最多 7.8cm）、或跟平直車殼共面（z-fighting／
    # 閃爍黑線）——D12 逐格比 BASE 抓到。裁到「車殼往內縮 12mm」實體內：門洞範圍內母模沒有洞、
    # 零件伸到門框環邊界的部分不受影響；門洞以外凸出的部分會被削掉，貼齊實際曲面內側 ≥12mm。
    for _o in (floor_obj, ceil_obj, end_obj, part_obj):
        clip_to_shell(_o)

    # 門廳深處背牆（|y|=VEST_Y_IN 這一面）：讓開門時往內看有東西可看，同時是 D7 全開射線的命中對象
    # （y=.875 遠在裁切邊界內側，不受 INTERSECT 裁切影響，故不列入 clip_to_shell）
    p.box(f'門廳背牆 {door_id}', (ctr_x, side * VEST_Y_IN, (FLOOR_Z + CEIL_Z) / 2),
          (span_x, .03, CEIL_Z - FLOOR_Z), 'body', 0)

    # 扶手：偏離門正中央，靠端牆那一側；Y 特意放在 1.10（門廳內側，離門較遠），
    # 不可放在 1.29~1.40 的壁袋帶——那是門扇全開後要滑過去的路徑，扶手擋在那裡會讓 D9 抓到
    # （build 過程中量到 t≈0.10 撞到這根扶手，才移過來）。
    rail_x = cx - sig * .18
    p.use('02')
    p.rod(f'門廳扶手 {door_id}', (rail_x, side * 1.10, .95), (rail_x, side * 1.10, 2.05), .020, 'metal')

    return {'end_x': end_x, 'mid_x': mid_x}


door_move_objs = {}  # door_id -> list of (obj, kind)
matched_ids = set()
for d in doors_info:
    door_id = d['id']
    cx, side, sig = d['cx'], d['side'], d['sig']
    note(f"建造 {door_id}（cx={cx}, side={side}, sig={sig}）：門框環、門內裝；"
         f"門扇／門窗嵌框／門窗玻璃／門把凹槽沿用快照原件（原位置、原形狀），整組列入可動群組。")
    build_ring_frame(door_id, cx, side)
    d['vest'] = build_vestibule(door_id, cx, side, sig)
    leaf_obj = d['leaf_obj']
    frame_obj = find_door_part('門窗嵌框', cx, side, matched_ids)
    glass_obj = find_door_part('門窗玻璃', cx, side, matched_ids)
    handle_obj = find_door_part('門把凹槽', cx, side, matched_ids)
    matched_ids.add(id(leaf_obj))
    movable = [leaf_obj, frame_obj, glass_obj, handle_obj]
    for o in movable:
        o['gd_door_id'] = door_id
    # 注意：故意不把這些物件搬動到 p.MODEL 尾端（round 2 一度這麼做過，立刻在 install_assets.py
    # 踢出 drawGroups[4] 'roof' vs 'metal' 順序不符——門扇材質是 'roof'，而這個材質鍵在整個模型裡
    # 幾乎只有門扇在用，搬動會連帶把 'roof' bucket 的「首次出現位置」搬到最後，破壞 D3／既有資產
    # 要求的 drawGroups 順序一致）。維持原始 p.MODEL 順序，讓 ranges 依實際散落位置產生多段
    # （D4 本來就允許同一扇門在同個 drawGroup 內有多段 range，不要求單一連續區塊）。
    door_move_objs[door_id] = movable
    d['movable'] = movable

_clip_mesh = shell_clip_src.data
bpy.data.objects.remove(shell_clip_src, do_unlink=True)
bpy.data.meshes.remove(_clip_mesh)
note('已移除裁切母模（GD_SHELL_CLIP_SRC_12mm_inset），不進最終 .blend／算繪場景。')

note('四扇門的門框環、門內裝皆已建立完成；可動群組沿用快照原件，未重建幾何。')

# ============================================================
# 5. 角色標記（複製自 fleet-refinement-20260912/refine.py 的 export() 內邏輯，只取標記段落，
#    不引用該檔——它會一次跑六款車，改用同一套規則重現於本檔，讓 railLight:* 分組與現行資產一致）
# ============================================================
bpy.context.view_layer.update()
mats = {}
roles = {}
head_tail_points = {}
for o in p.MODEL:
    if not getattr(o.data, 'materials', None):
        continue
    name = o.name
    coords = [o.matrix_world @ Vector(v) for v in o.bound_box]
    center = sum(coords, Vector()) / len(coords)
    role = None
    if '透鏡' in name and '直紋' not in name:
        original = o.data.materials[0].name
        color = 'tail' if ('紅' in name or original in ['red', '深紅標誌燈玻璃']) else 'head'
        role = color + ('Front' if center.x > 0 else 'Rear')
    elif spec['family'] in ['express', 'railcar', 'coach', 'forestcoach']:
        if name.startswith(('獨立深色玻璃', '門窗玻璃', '側門窄長玻璃', '上半固定窗', '下半開窗暗部', '車端霧面小窗')) and '框' not in name:
            role = 'window'
    if not role:
        continue
    for i, orig in enumerate(list(o.data.materials)):
        key = (orig.name, role)
        if key not in mats:
            mat = orig.copy()
            mat.name = 'railLight:' + role + ':' + orig.name
            node = mat.node_tree.nodes['Principled BSDF']
            c = list(node.inputs['Base Color'].default_value)
            c[0] = min(.999, c[0] + .001 * (1 + ['window', 'headFront', 'headRear', 'tailFront', 'tailRear'].index(role)))
            node.inputs['Base Color'].default_value = c
            mat.diffuse_color = c
            mats[key] = mat
            roles[mat.name] = role
        o.data.materials[i] = mats[key]
    if role.startswith('head'):
        head_tail_points.setdefault(role, []).append(list(center))

note(f'角色標記完成：{sorted(roles.items())}')

# ============================================================
# 6. 自製匯出（沿用 blender_parts.export_model 的三角形蒐集邏輯，額外追蹤每扇門在各 drawGroup 內的連續區段）
# ============================================================
deps = bpy.context.evaluated_depsgraph_get()
buckets = {}  # material.name -> {'material':mat_obj,'values':[...]}
door_ranges = {}  # door_id -> group_name -> [[start,count], ...]
bounds = [Vector((math.inf,) * 3), Vector((-math.inf,) * 3)]
total_tris = 0

for obj in p.MODEL:
    if obj.type not in ('MESH', 'FONT', 'CURVE'):
        continue
    door_id = obj.get('gd_door_id')
    ev = obj.evaluated_get(deps)
    d_mesh = ev.to_mesh()
    d_mesh.calc_loop_triangles()
    wm = obj.matrix_world
    nm_mat = wm.to_3x3().inverted_safe().transposed()
    for tri in d_mesh.loop_triangles:
        material = d_mesh.materials[tri.material_index] if d_mesh.materials else None
        key = material.name if material else 'MISSING_MATERIAL'
        if key not in buckets:
            buckets[key] = {'material': material, 'values': []}
        bucket = buckets[key]
        start_vertex = len(bucket['values']) // 6
        for li in tri.loops:
            pos = wm @ d_mesh.vertices[d_mesh.loops[li].vertex_index].co
            normal = (nm_mat @ d_mesh.corner_normals[li].vector).normalized()
            if not all(math.isfinite(v) for v in (*pos, *normal)):
                raise ValueError('非有限網格 ' + obj.name)
            bucket['values'].extend((*pos, *normal))
            for j in range(3):
                bounds[0][j] = min(bounds[0][j], pos[j])
                bounds[1][j] = max(bounds[1][j], pos[j])
        total_tris += 1
        if door_id:
            spans = door_ranges.setdefault(door_id, {}).setdefault(key, [])
            if spans and spans[-1][0] + spans[-1][1] == start_vertex:
                spans[-1][1] += 3
            else:
                spans.append([start_vertex, 3])
    ev.to_mesh_clear()

note(f'自製匯出蒐集完成：材質分組數={len(buckets)}，三角形總數={total_tris}。')

# --- 組出最終 raw buffer（依 buckets 插入順序＝各材質首次出現順序）並記錄每組 start/count ---
raw = bytearray()
count = 0
draw_groups = []
group_offset = {}
for name, item in buckets.items():
    vals = item['values']
    n = len(vals) // 6
    if not n:
        continue
    material = item['material']
    node = material.node_tree.nodes['Principled BSDF']
    raw.extend(struct.pack('<%sf' % len(vals), *vals))
    entry = {
        'name': name, 'start': count, 'count': n,
        'color': list(node.inputs['Base Color'].default_value)[:3],
        'metalness': node.inputs['Metallic'].default_value,
        'roughness': node.inputs['Roughness'].default_value,
        'clearcoat': node.inputs['Coat Weight'].default_value,
    }
    if name in roles:
        entry['lightingRole'] = roles[name]
    draw_groups.append(entry)
    group_offset[name] = count
    count += n

vertex_count = count
triangle_count = count // 3
sha256 = hashlib.sha256(bytes(raw)).hexdigest()

# --- 每扇門的 ranges：door_ranges 記的 start 是「該材質 bucket 內部」的相對索引；換算成整體絕對頂點索引 ---
doors_meta_items = []
for d in doors_info:
    door_id = d['id']
    per_group = door_ranges.get(door_id, {})
    ranges = []
    for gname, spans in per_group.items():
        base = group_offset[gname]
        for start, cnt in spans:
            ranges.append({'group': gname, 'start': base + start, 'count': cnt})
    ranges.sort(key=lambda r: r['start'])
    side = d['side']
    doors_meta_items.append({
        'id': door_id,
        'side': side,
        'center': [d['cx'], side * 1.466, DOOR_CZ],
        'width': LEAF_W,
        'height': LEAF_H,
        'inward': [0, -side * .14, 0],
        'slide': [d['sig'], 0, 0],
        'travel': .66,
        'ranges': ranges,
    })

doors_payload = {
    'schema': 'garage-doors-v1',
    'type': 'slide-pocket',
    'threshold': FLOOR_Z,
    'items': doors_meta_items,
}

meta = {
    'vertexCount': vertex_count,
    'triangleCount': triangle_count,
    'sha256': sha256,
    'bounds': {'min': list(bounds[0]), 'max': list(bounds[1])},
    'sizeM': list(bounds[1] - bounds[0]),
    'drawGroups': draw_groups,
    'doors': doors_payload,
}

(BUILD_OUT / 'emu3000-doors.raw.bin').write_bytes(bytes(raw))
(BUILD_OUT / 'emu3000-doors.meta.json').write_text(json.dumps(meta, ensure_ascii=False, indent=2) + '\n')
note(f'raw+meta 寫出到 {BUILD_OUT}：vertexCount={vertex_count} triangleCount={triangle_count} sha256={sha256[:16]}...')
note('doors metadata：' + json.dumps(doors_payload, ensure_ascii=False)[:1500])

# ============================================================
# 7. 另存 .blend（不進 repo）
# ============================================================
bpy.ops.object.select_all(action='DESELECT')
if p.MODEL:
    p.MODEL[0].select_set(True)
    bpy.context.view_layer.objects.active = p.MODEL[0]
bpy.ops.wm.save_as_mainfile(filepath=str(BLEND_PATH))
note(f'.blend 另存：{BLEND_PATH}')

# ============================================================
# 8. 算繪（關門／半開／全開／門內斜角特寫）——直接移動門扇物件，不改已匯出的資產。
#    round 2：燈光改單一帶陰影太陽燈（render_common.setup_sun），相機改略俯角（render_common.
#    exterior_eye），門內特寫改斜角看進去（不再是正面對著關著的門那種視角）。
#    「改動前」快照對照圖（00-before）由同目錄的 render_baseline.py 用同一套相機／燈光另外算，
#    不在本檔——本檔這時車殼已經開洞，沒有回復原狀的機制。
# ============================================================
import os
if os.environ.get('FLEET_RENDER', '0') == '1':
    SCENE = p.SCENE
    SCENE.render.engine = 'CYCLES'
    SCENE.cycles.samples = int(os.environ.get('FLEET_SAMPLES', '48'))
    SCENE.cycles.use_denoising = True
    SCENE.view_settings.view_transform = 'AgX'
    SCENE.render.image_settings.file_format = 'PNG'
    SCENE.render.film_transparent = False

    p.use('90')
    floor = p.box('展示台', (0, 0, -.060), (200, 200, .10), p.mat('攝影棚紙白', 'F0EBDF', 0, .8), .02, model=False)
    rc.setup_sun(p)
    camera, camdata = rc.make_camera(p, SCENE)

    def view(loc, target, scale, res=(1000, 800)):
        rc.view(camera, camdata, SCENE, loc, target, scale, res)

    def render(filename):
        rc.render(SCENE, RENDERS_DIR / filename)

    # 挑一扇門做特寫（L2：+Y 側、靠近鼻端那一組，門廳空間較充裕）
    focus = next(dd for dd in doors_info if dd['id'] == 'L2')
    fcx, fside, fsig = focus['cx'], focus['side'], focus['sig']
    focus_objs = focus['movable']
    orig_loc = [o.location.copy() for o in focus_objs]

    def set_open_fraction(frac):
        off = Vector((fsig * .66 * frac, -fside * .14 * frac, 0))
        for o, base in zip(focus_objs, orig_loc):
            o.location = base + off
        bpy.context.view_layer.update()

    # 外觀視角：略高於門中心、往下俯角 rc.PITCH_DEG 度（10~15° 範圍），讓門口看得出深度；
    # 與 render_baseline.py 算「00-before」用的是同一個 rc.exterior_eye() 公式與參數，兩張才能
    # 真的拿來對照，不是各自調的角度。
    target = Vector((fcx, fside * 1.466, DOOR_CZ))
    eye = rc.exterior_eye(target, fside)

    set_open_fraction(0.0)
    view(eye, target, 5.5)
    render('01-closed.png')

    set_open_fraction(0.5)
    view(eye, target, 5.5)
    render('02-half-open.png')

    set_open_fraction(1.0)
    view(eye, target, 5.5)
    render('03-full-open.png')

    # 門內特寫：相機在全開門口「外面」，從車端（把手／扶手那一側）斜角往車廂中心（隔間通道口
    # 那一側）看進去——不是正對著門口的正面圖，才看得出深度；同時要在畫面裡同時收進地板、
    # 頂燈、扶手、隔間通道口，取景中心用門廳實際幾何中心（build_vestibule 回傳的 end_x/mid_x），
    # 不是門的中心 cx（門的中心離門廳幾何中心有偏移，取景在 cx 會把扶手或通道口擠出畫面外）。
    set_open_fraction(1.0)
    vest = focus['vest']
    end_x, mid_x = vest['end_x'], vest['mid_x']
    ctr_x = (end_x + mid_x) / 2
    eye_x_dir = 1 if end_x > ctr_x else -1  # 從「車端」那一側斜看過去
    interior_target = Vector((ctr_x, fside * 1.05, FLOOR_Z + .32))
    interior_eye = Vector((ctr_x + eye_x_dir * 1.15, fside * 2.7, DOOR_CZ + .95))
    view(interior_eye, interior_target, 2.8, res=(1100, 950))
    render('04-interior-closeup.png')

    set_open_fraction(0.0)  # 算繪完畢，物件位置歸零（不影響已寫出的資產，僅供場景保持一致）
    note(f'算繪完成（01~04，太陽燈＋俯角相機），輸出於 {RENDERS_DIR}；00-before 由 render_baseline.py 另外產生。')
else:
    note('FLEET_RENDER != 1，略過算繪（僅產出資產與 .blend）。')

note('build_doors.py 執行完畢。')
print('GD_DOORS_BUILD_OK', json.dumps({'vertexCount': vertex_count, 'triangleCount': triangle_count, 'sha256': sha256}, ensure_ascii=False), flush=True)
