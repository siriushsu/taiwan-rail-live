#!/usr/bin/env python3
"""建 emu3000-mid（車庫中間車）：不重新用布林挖門、不重建門廳——直接拿「已併入的頭車資產」
rail-3d/assets/garage-blender-v1/emu3000.bin.gz 解出來的最終三角形與法向量，取 x≤0 的後半段
（含門 1／R1・L1），對 x=0 鏡射出另一半（成為門 2／R2・L2），在 x=0 接起來；跨過 x=0 的三角形
沿平面裁切，保證接縫逐點重合、不留縫隙。頭車的頭燈、尾燈 drawGroup 整組拿掉；drawGroups
順序沿用頭車、空的群組刪掉。純 Python，不需要 Blender（沒有布林、沒有新曲面）。

輸出（純中繼格式，供 install_assets.py 讀取合併進正式資產，同 build_doors.py 的慣例）：
  output/emu3000-doors/build-mid/emu3000-mid.raw.bin   float32 位置+法向量 stride 24，未壓縮
  output/emu3000-doors/build-mid/emu3000-mid.meta.json vertexCount/triangleCount/bounds/sizeM/
                                                         drawGroups/doors/pantograph/sha256

用法：python3 scripts/blender/emu3000-doors-20260924/build_mid.py
"""
import sys, json, gzip, math, hashlib, array
from pathlib import Path

sys.dont_write_bytecode = True

W = Path(__file__).resolve().parents[3]  # repo 根目錄（scripts/blender/<本目錄>/<本檔>）
ASSET_DIR = W / 'rail-3d/assets/garage-blender-v1'
OUT_DIR = W / 'output/emu3000-doors/build-mid'
OUT_DIR.mkdir(parents=True, exist_ok=True)
NOTES_PATH = W / 'output/emu3000-doors/NOTES.md'

EXCLUDE_ROLES = {'headFront', 'tailFront'}  # 頭燈／尾燈角色整組拿掉（中間車沒有駕駛室）

# --- coordinator 補修 3：中央窗（window9，鏡射接縫正中央）補窗柱。量自目前中間車產物：
#     glass 內緣（離 x=0 最近那個角）在 x=-0.0017、frame 內緣在 x=-0.0026，y∈[-1.4645,1.4645]，
#     z∈[1.88,3.02]（留邊界）。只平移頂點（不布林、不重切）：x<0 那側整塊（glass+frame，寬度不變，
#     剛性平移）往外（更負）移 MULLION_SHIFT，鏡射後 x>0 側自動對稱往外移，內緣從 ±0.0017 移到
#     ±0.1067（MULLION_SHIFT=0.105=0.1067-0.0017），兩側合計缺口＝0.2134，跟其餘窗柱同寬。
#     x==0.0 的頂點（跨縫的 body 面）不受影響（過濾條件是 x<0 嚴格小於 0）。
WIN9_X_EDGE = 0.07
WIN9_Y = (-1.50, 1.50)
WIN9_Z = (1.80, 3.10)
MULLION_SHIFT = 0.105
# --- coordinator 補修 1／2：-X 端車頂單元（頭車尾端鏡射出來那座）整塊刪除，只留 +X 端；
#     roof 群組、x<0 且 z>3.55 的三角形只用來量出機組腳印；真正刪除的是腳印內 z>=3.385 的
#     全部群組三角形（見下方 _ac_footprint／_in_ac_unit）。
ROOF_GROUP_NAME = 'roof'
ROOF_AC_Z = 3.55


def note(msg):
    line = f'- [build_mid] {msg}\n'
    with open(NOTES_PATH, 'a', encoding='utf-8') as f:
        f.write(line)
    print(line, end='')


head = json.loads((ASSET_DIR / 'emu3000.json').read_text(encoding='utf-8'))
raw = gzip.decompress((ASSET_DIR / 'emu3000.bin.gz').read_bytes())
if hashlib.sha256(raw).hexdigest() != head['mesh']['sha256']:
    sys.exit('emu3000.bin.gz 雜湊與 emu3000.json 不符，頭車資產可能損毀')
f = array.array('f'); f.frombytes(raw)
VCOUNT = head['mesh']['vertexCount']
assert len(f) == VCOUNT * 6

groups = head['mesh']['drawGroups']


def group_of(v):
    for g in groups:
        if g['start'] <= v < g['start'] + g['count']:
            return g
    return None


def vtx(v):
    o = v * 6
    return list(f[o:o + 6])


# door1（R1／L1，x=-4.2）的每個 ranges 子區間都標成「屬於哪個門、第幾個子區間」，供裁切後原樣
# 沿用（door 三角形離 x=0 很遠，from 不會被裁切，標記逐三角形 1:1 原樣保留）。
door1_items = [d for d in head['doors']['items'] if d['id'] in ('R1', 'L1')]
tri_tag = {}  # 三角形起始頂點索引 v -> (door_id, range_index)
for d in door1_items:
    for ri, r in enumerate(d['ranges']):
        for v in range(r['start'], r['start'] + r['count'], 3):
            tri_tag[v] = (d['id'], ri)


def lerp_vertex(a, b):
    """a、b 為 6 float 頂點（位置+法向量）；回傳 a→b 這條邊與 x=0 平面的交點（位置線性內插、
    法向量線性內插後重新單位化）。位置的 x 強制設成正好 0.0，避免浮點殘差在鏡射後對不齊接縫。"""
    t = (0.0 - a[0]) / (b[0] - a[0])
    v = [a[i] + t * (b[i] - a[i]) for i in range(6)]
    v[0] = 0.0
    nx, ny, nz = v[3], v[4], v[5]
    l = math.sqrt(nx * nx + ny * ny + nz * nz)
    if l > 1e-12:
        v[3], v[4], v[5] = nx / l, ny / l, nz / l
    return v


def clip_tri_le0(verts):
    """把一個三角形（3 個 6-float 頂點）裁到 x<=0 半空間內；回傳 0、1 或 2 個三角形（保持繞向）。"""
    inside = [v[0] <= 0 for v in verts]
    n_in = sum(inside)
    if n_in == 3:
        return [verts]
    if n_in == 0:
        return []
    if n_in == 1:
        i0 = inside.index(True)
        order = [(i0 + k) % 3 for k in range(3)]
        a, b, c = (verts[order[0]], verts[order[1]], verts[order[2]])
        p1 = lerp_vertex(a, b)
        p2 = lerp_vertex(c, a)
        return [[a, p1, p2]]
    else:  # n_in == 2
        o = inside.index(False)
        order = [(o + k) % 3 for k in range(3)]
        c, a, b = (verts[order[0]], verts[order[1]], verts[order[2]])
        p1 = lerp_vertex(c, a)
        p2 = lerp_vertex(b, c)
        return [[a, b, p2], [a, p2, p1]]


def mirror_tri(tri):
    """對 x=0 鏡射：位置與法向量的 x 取負；交換後兩個頂點保持正反面
    （跟 verify_garage_stop_assets.mjs 的 mirrorX() 同一套慣例：輸出 [orig0, orig2, orig1]）。"""
    def flip(v):
        return [-v[0], v[1], v[2], -v[3], v[4], v[5]]
    return [flip(tri[0]), flip(tri[2]), flip(tri[1])]


# --- coordinator 補修 1（第二輪）：−X 端車頂單元的 AC 機組腳印（跨群組通用判準）。
#     先在 roof 群組用原判準（x<0 且 z>3.55）找出「機組本體」三角形，取其全部頂點的 XY bbox
#     外擴 1cm；之後對每個群組，三角形三個頂點都落在這個 XY 範圍內、且 z>=AC_ZMIN（機組含
#     外殼／底板／格柵斷柱，下探到 3.385）的，一律刪除，不限 roof 群組。車體 body 群組的大片
#     車頂面三角形跨距遠大於這個腳印，三頂點不會同時落在範圍內，天然不受影響（已用原始頭車
#     資料驗證：body 群組在此判準下命中 0 個三角形）。
AC_ZMIN = 3.385


def _ac_footprint():
    roof_g = next(g for g in groups if g['name'] == ROOF_GROUP_NAME)
    xs, ys = [], []
    for v in range(roof_g['start'], roof_g['start'] + roof_g['count'], 3):
        for ctri in clip_tri_le0([vtx(v), vtx(v + 1), vtx(v + 2)]):
            cx = sum(p[0] for p in ctri) / 3
            cz = sum(p[2] for p in ctri) / 3
            if cx < 0 and cz > ROOF_AC_Z:
                for p in ctri:
                    xs.append(p[0]); ys.append(p[1])
    assert xs, 'AC 機組腳印偵測失敗（roof 群組找不到 x<0 且 z>3.55 的三角形）'
    return min(xs) - 0.01, max(xs) + 0.01, min(ys) - 0.01, max(ys) + 0.01


AC_X0, AC_X1, AC_Y0, AC_Y1 = _ac_footprint()
note(f'AC 機組腳印（roof 群組 x<0 且 z>{ROOF_AC_Z} 三角形之頂點 bbox，外擴 1cm）：'
     f'x∈[{AC_X0:.4f},{AC_X1:.4f}] y∈[{AC_Y0:.4f},{AC_Y1:.4f}]，z>={AC_ZMIN} 起跨全部群組刪除。')


def _in_ac_unit(tri):
    return all(AC_X0 <= p[0] <= AC_X1 and AC_Y0 <= p[1] <= AC_Y1 and p[2] >= AC_ZMIN for p in tri)


# --- coordinator 補修 2（第二輪）：中央窗（window9）內緣外移，讓「2 個頂點外移、第 3 個頂點
#     釘在 x=0 接縫」的三角形發生剪切翻面（frame 群組、窗柱頂/底端窗框回褶小三角形，共 8 個）。
#     修法：找出所有「恰好 2 頂點落在原位移區、第 3 頂點恰好在 x=0（clip 縫生成點）」的三角形，
#     把該第 3 頂點的座標併入位移區（純位置函式當 key，不分三角形/群組，天然不會裂縫）；新併入
#     的座標可能讓別的三角形也湊成「2 進 1 未進」，故收斂到不動點為止。只收「恰好在 x=0」的釘住
#     頂點──避免誤觸同一三角形另一角落在很遠處（例如相鄰窗柱）的頂點（已驗證：若不限 x==0，
#     會誤觸最遠達 0.70m 外的無關頂點）。
def _win9_in_zone_strict(v6):
    return -WIN9_X_EDGE <= v6[0] < 0 and WIN9_Y[0] <= v6[1] <= WIN9_Y[1] and WIN9_Z[0] <= v6[2] <= WIN9_Z[1]


def _key3(v6):
    return (round(v6[0], 6), round(v6[1], 6), round(v6[2], 6))


def _win9_extra_seam_positions():
    all_clipped = []
    for g in groups:
        for v in range(g['start'], g['start'] + g['count'], 3):
            for ctri in clip_tri_le0([vtx(v), vtx(v + 1), vtx(v + 2)]):
                all_clipped.append(ctri)
    extra = set()
    for _ in range(10):
        added = 0
        for ctri in all_clipped:
            flags = [_win9_in_zone_strict(p) or (_key3(p) in extra) for p in ctri]
            if sum(flags) == 2:
                pin = [ctri[i] for i in range(3) if not flags[i]][0]
                if abs(pin[0]) < 1e-6:
                    k = _key3(pin)
                    if k not in extra:
                        extra.add(k); added += 1
        if added == 0:
            break
    return extra


WIN9_EXTRA_SEAM = _win9_extra_seam_positions()
note(f'中央窗窗柱翻面修正：{len(WIN9_EXTRA_SEAM)} 個 x=0 接縫頂點併入位移區（避免剪切翻面），收斂後不再新增。')


def win9_in_zone(v6):
    return _win9_in_zone_strict(v6) or (_key3(v6) in WIN9_EXTRA_SEAM)


# --- 逐群組蒐集 x<=0 半邊（裁切後）與其鏡射半邊，同時記錄 door1／door2 的新 ranges ---
STRIDE = 6
final_groups = []          # [{'name':..., 'tris':[tri,...]}]
door_new_ranges = {}       # (door_id, range_index) -> {'group':name,'start':int,'count':int}  (door1，-X 端)
door2_new_ranges = {}      # 同上，door2（鏡射出來的 +X 端）
kept_triangles = 0

for g in groups:
    role = g.get('lightingRole')
    if role in EXCLUDE_ROLES:
        note(f'群組 {g["name"]!r}（lightingRole={role!r}）整組拿掉（頭燈／尾燈，中間車沒有駕駛室）。')
        continue
    left_tris = []                      # 裁切後的 x<=0 三角形（可能因裁切而比原三角形數更多/更少）
    left_tag_span = {}                  # (door_id,ri) -> [first_left_idx, last_left_idx]（左半內的三角形序位）
    for v in range(g['start'], g['start'] + g['count'], 3):
        tri = [vtx(v), vtx(v + 1), vtx(v + 2)]
        clipped = clip_tri_le0(tri)
        if not clipped:
            continue
        tag = tri_tag.get(v)
        if tag is not None:
            # door 三角形離 x=0 很遠，一定是 n_in==3（未裁切、原樣 1 個三角形），不會分裂。
            assert len(clipped) == 1, f'門扇三角形不應被 x=0 裁切：v={v} tag={tag}'
            lo, hi = left_tag_span.get(tag, (len(left_tris), len(left_tris)))
            left_tag_span[tag] = (min(lo, len(left_tris)), len(left_tris) + 1)
        left_tris.extend(clipped)
    if not left_tris:
        note(f'群組 {g["name"]!r} 在 x<=0 半邊沒有任何幾何（裁切後為空），刪除此群組。')
        continue

    # --- 補修 3：中央窗內緣頂點外移補窗柱（位置判準，跟哪個群組無關，body 群組在這個 bbox 內
    #     全部頂點剛好都在 x==0.0（跨縫面），x<0 的嚴格條件天然不會碰到它們） ---
    # --- coordinator 補修（第三輪）：window9 中央窗柱裂縫。上面 WIN9_EXTRA_SEAM 的收斂只處理
    #     「三角形內恰有 2 頂點該移、第 3 頂點釘死在 x=0」的剪切翻面；但另有一種三角形恰好只有
    #     1 個頂點落在位移區、另一頂點原本就在同一 y 層的 x=0 接縫上（例如窗框回褶的大斜面
    #     三角形，一角在窗柱corner、另一角遠在窗頂/窗底跟其餘窗框共用 x=0 這條縫）。這種三角形
    #     移動前，該頂點與同層接縫頂點的邊整段貼在 x=0 縫上（跟鏡射出的右半共用），移動後只剩
    #     單點相連，縫上留一塊沒有任何幾何覆蓋的三角形缺口（不是翻面——是真的洞，射線會穿到
    #     更內層，顯示成背面）。修法：找出每一組「(恰1個)該移頂點, 同層 x=0 接縫頂點」，額外
    #     補一片縫合三角形［接縫點, 該移頂點的原位置, 該移頂點的新位置］，環繞方向照原三角形的
    #     環繞推導（跟共邊的主三角形沿同一條邊反向走，兩者法向量自然一致）；鏡射後 x>0 側自動
    #     對稱補上，不用另外處理。
    #     只補「外層」（該移頂點自身法向量朝外，即 y 與 ny 同號）：全窗共查到 8 組這種缺口，
    #     4 組在外層（y=±1.452）、4 組在內層（y=±1.434，窗框回褶面）。可視性只由外層決定──
    #     外層補好之後，射線永遠不會再打到內層，內層本身有沒有洞已經無關；已實測驗證內層那 4 組
    #     若照樣補，會在 R 側疊出一片與既有前向面共面、朝向卻相反的多餘三角形，把原本正確的
    #     front-facing 命中換成 back-facing（R,cx=0 從 back=0 劣化成 back=2800）。故用
    #     sv[1]*sv[4]>0（頂點自身法向量方向與其 y 位移同號＝朝外）篩掉內層 4 組。
    win9_patches = []
    seen_patch_keys = set()
    for tri in left_tris:
        elig = [win9_in_zone(v6) for v6 in tri]
        if sum(elig) != 1:
            continue
        si = elig.index(True)
        sv = tri[si]
        if sv[1] * sv[4] <= 0:
            continue  # 內層（朝內）——外層補好即不可見，補了反而有害，見上方註解
        for j in range(3):
            if j == si:
                continue
            ov = tri[j]
            if abs(ov[0]) < 1e-6 and abs(ov[1] - sv[1]) < 1e-6:
                pk = (_key3(sv), _key3(ov))
                if pk in seen_patch_keys:
                    continue
                seen_patch_keys.add(pk)
                sv_new = list(sv); sv_new[0] -= MULLION_SHIFT
                sv_old = list(sv)
                seam = list(ov)
                if (si + 1) % 3 == j:
                    win9_patches.append([seam, sv_new, sv_old])
                else:
                    win9_patches.append([sv_old, sv_new, seam])

    win9_shifted = 0
    for tri in left_tris:
        for vtx6 in tri:
            if win9_in_zone(vtx6):
                vtx6[0] -= MULLION_SHIFT
                win9_shifted += 1
    if win9_shifted:
        note(f'群組 {g["name"]!r}：中央窗（window9）內緣 {win9_shifted} 個角往外移 {MULLION_SHIFT}m（鏡射後兩側對稱補窗柱）。')
    if win9_patches:
        left_tris.extend(win9_patches)
        note(f'群組 {g["name"]!r}：window9 中央窗柱裂縫補 {len(win9_patches)} 片縫合三角形（第三輪修正，鏡射後兩側對稱）。')

    # --- 鏡射用「補窗柱後、刪車頂單元前」的 left_tris，right_tris 本身不受刪除影響
    #     （天然保留 +X 端那座車頂單元）；door2 的 tag 位置（在 right_tris 內的序位）此刻先記下來，
    #     實際 start 要等 left_tris_final 長度確定後才能算（right_tris 接在 left_tris_final 後面）。---
    right_tris = [mirror_tri(t) for t in left_tris]
    start_left = kept_triangles
    door2_tag_span = dict(left_tag_span)  # right_tris 內的序位跟 left_tag_span 一一對應（鏡射不改順序）

    # --- 補修 1（第二輪擴大範圍）：-X 端車頂單元整塊刪除，只留 +X 端（right_tris 是上面用
    #     未過濾 left_tris 鏡射出來的，天然保留 +X 端那座）。判準＝AC 機組腳印（跨全部群組），
    #     不再限定 roof 群組、不再用三角形重心，改成三個頂點都落在腳印內。 ---
    delete_idx = {i for i, tri in enumerate(left_tris) if _in_ac_unit(tri)}

    if delete_idx:
        touched = [tag for tag, (lo, hi) in left_tag_span.items() if delete_idx & set(range(lo, hi))]
        assert not touched, f'刪除車頂單元誤觸門標記：{touched}'
        remap = {}
        newi = 0
        for i in range(len(left_tris)):
            if i in delete_idx:
                continue
            remap[i] = newi
            newi += 1
        left_tris_final = [t for i, t in enumerate(left_tris) if i not in delete_idx]
        for tag, (lo, hi) in left_tag_span.items():
            new_lo = remap[lo]
            door_new_ranges[tag] = {'group': g['name'], 'start': (start_left + new_lo) * 3, 'count': (hi - lo) * 3}
        note(f'群組 {g["name"]!r}：刪除 -X 端車頂單元 {len(delete_idx)} 個三角形（保留鏡射出來的 +X 端那座）。')
    else:
        left_tris_final = left_tris
        for tag, (lo, hi) in left_tag_span.items():
            door_new_ranges[tag] = {'group': g['name'], 'start': (start_left + lo) * 3, 'count': (hi - lo) * 3}

    for tag, (lo, hi) in door2_tag_span.items():
        door2_new_ranges[tag] = {'group': g['name'], 'start': (start_left + len(left_tris_final) + lo) * 3, 'count': (hi - lo) * 3}

    n_left, n_right = len(left_tris_final), len(right_tris)
    final_groups.append({'name': g['name'], 'tris': left_tris_final + right_tris})
    kept_triangles += n_left + n_right
    note(f'群組 {g["name"]!r}：x<=0 裁切後 {n_left} 個三角形（刪除 {len(delete_idx)} 個）＋鏡射 {n_right} 個＝{n_left + n_right}（原頭車此群組 {g["count"]//3} 個）。')

# --- 組回 flat float32 陣列＋drawGroups（start/count 用頂點單位，count 為 3 的倍數） ---
out = array.array('f')
draw_groups_out = []
running = 0
for eg in final_groups:
    src = groups_by_name = next(gg for gg in groups if gg['name'] == eg['name'])
    n_verts = len(eg['tris']) * 3
    for tri in eg['tris']:
        for vert in tri:
            out.extend(vert)
    draw_groups_out.append({
        'name': src['name'], 'start': running, 'count': n_verts,
        'color': src['color'], 'metalness': src['metalness'], 'roughness': src['roughness'], 'clearcoat': src['clearcoat'],
        **({'lightingRole': src['lightingRole']} if 'lightingRole' in src else {}),
    })
    running += n_verts

triangle_count = running // 3
vertex_count = running
raw_bytes = out.tobytes()
sha256 = hashlib.sha256(raw_bytes).hexdigest()

# --- bounds / sizeM ---
xs = out[0::6]; ys = out[1::6]; zs = out[2::6]
bounds_min = [min(xs), min(ys), min(zs)]
bounds_max = [max(xs), max(ys), max(zs)]
size_m = [bounds_max[i] - bounds_min[i] for i in range(3)]
note(f'鏡射接縫完成：vertexCount={vertex_count} triangleCount={triangle_count} bounds={bounds_min}~{bounds_max} sizeM={size_m}')

# --- doors metadata：door1（R1/L1，x=-4.2，原樣沿用）＋door2（R2/L2，x=+4.2，鏡射出來、id 與
#     slide/inward 的 x 分量隨鏡射取負，其餘照抄） ---
new_items = []
for d in door1_items:
    ranges = [door_new_ranges[(d['id'], ri)] for ri in range(len(d['ranges']))]
    new_items.append({**d, 'ranges': ranges})
    # 門 2（鏡射）：id 的「端」從 1 換成 2、side 不變（鏡射只翻 x，不翻 y）、center/slide/inward 的 x 取負
    id2 = d['id'][0] + '2'
    center2 = [-d['center'][0], d['center'][1], d['center'][2]]
    slide2 = [-d['slide'][0], d['slide'][1], d['slide'][2]]
    inward2 = [-d['inward'][0], d['inward'][1], d['inward'][2]]
    ranges2 = [door2_new_ranges[(d['id'], ri)] for ri in range(len(d['ranges']))]
    new_items.append({**d, 'id': id2, 'center': center2, 'slide': slide2, 'inward': inward2, 'ranges': ranges2})

doors_meta = {'schema': head['doors']['schema'], 'type': head['doors']['type'], 'threshold': head['doors']['threshold'], 'items': new_items}
note('doors metadata 建好：' + json.dumps([[it['id'], it['side'], it['center'][0]] for it in new_items], ensure_ascii=False))

# --- 補修 2：集電弓底座裝在 -X 端轉向架正上方的平車頂 ---
#     mount.x：頭車來源資料（x<=0 側，未受鏡射／刪除影響）裡 -X 端轉向架兩軸中心的平均。
#     用 metal／chassis 群組三角形重心找兩顆輪（x∈[-4.0,-3.15] 與 x∈[-2.9,-2.0]，z∈[.02,.55]，|y|>.9）。
BOGIE_WHEEL_RANGES = [(-4.0, -3.15), (-2.9, -2.0)]
def wheel_center(xlo, xhi):
    xs = []
    for gname in ('metal', 'chassis'):
        gg = next((x for x in groups if x['name'] == gname), None)
        if gg is None:
            continue
        for v in range(gg['start'], gg['start'] + gg['count']):
            x, y, z = f[v * 6], f[v * 6 + 1], f[v * 6 + 2]
            if xlo <= x <= xhi and 0.02 <= z <= 0.55 and abs(y) > 0.9:
                xs.append(x)
    return (min(xs) + max(xs)) / 2 if xs else None

wheel_centers = [wheel_center(lo, hi) for lo, hi in BOGIE_WHEEL_RANGES]
assert all(w is not None for w in wheel_centers), f'轉向架輪心量測失敗：{wheel_centers}'
mount_x = sum(wheel_centers) / len(wheel_centers)
note(f'轉向架輪心：{wheel_centers} → mount_x={mount_x:.4f}（M5 要求 x∈[-3.5,-2.0]）。')

#     mount.z：該 x 處車頂殼高度（刪除 AC 機組後的平車頂，用點在三角形內的重心座標內插，
#     只採 z<=ROOF_AC_Z 的三角形——AC 機組本體已被上面的迴圈刪除，這裡先用同一判準排除它，
#     避免量到即將被刪掉的機組本體高度）＋底座高度 BASE_H（跟 build_pantograph.py 的 BASE_H
#     必須一致，底座局部 z 範圍是 [-BASE_H, 小正值]）。
BASE_H = 0.28
def _sign(p1, p2, p3):
    return (p1[0] - p3[0]) * (p2[1] - p3[1]) - (p2[0] - p3[0]) * (p1[1] - p3[1])
def _pt_in_tri(px, py, a, b, c):
    d1, d2, d3 = _sign((px, py), a, b), _sign((px, py), b, c), _sign((px, py), c, a)
    return not ((d1 < 0 or d2 < 0 or d3 < 0) and (d1 > 0 or d2 > 0 or d3 > 0))
def roof_z_at(px, py):
    hits = []
    for gg in groups:
        if gg['name'] not in ('roof', 'body'):
            continue
        for v in range(gg['start'], gg['start'] + gg['count'], 3):
            a = (f[v * 6], f[v * 6 + 1], f[v * 6 + 2])
            b = (f[(v + 1) * 6], f[(v + 1) * 6 + 1], f[(v + 1) * 6 + 2])
            c = (f[(v + 2) * 6], f[(v + 2) * 6 + 1], f[(v + 2) * 6 + 2])
            if max(a[2], b[2], c[2]) > ROOF_AC_Z or max(a[2], b[2], c[2]) < 3.0:
                continue  # 只留車頂殼那層（z 3.0~3.55），排除底盤／地板等其他也用 body/roof 材質的低處幾何
            if _pt_in_tri(px, py, a, b, c):
                x1, y1, z1 = a; x2, y2, z2 = b; x3, y3, z3 = c
                det = (y2 - y3) * (x1 - x3) + (x3 - x2) * (y1 - y3)
                if abs(det) < 1e-9:
                    continue
                l1 = ((y2 - y3) * (px - x3) + (x3 - x2) * (py - y3)) / det
                l2 = ((y3 - y1) * (px - x3) + (x1 - x3) * (py - y3)) / det
                l3 = 1 - l1 - l2
                hits.append(l1 * z1 + l2 * z2 + l3 * z3)
    return max(hits) if hits else None  # 取最高面（外側頂面），殼有厚度時避免量到內裡

probe_pts = [(mount_x, 0.0), (mount_x - .17, -.25), (mount_x + .17, -.25), (mount_x - .17, .25), (mount_x + .17, .25)]
probe_z = [(pt, roof_z_at(*pt)) for pt in probe_pts]
note('底座腳印＋中心射線探測（None＝該點無 roof/body 殼面覆蓋，需要收斂 footprint 或換位置）：' + json.dumps(probe_z))
roof_z_center = roof_z_at(mount_x, 0.0)
assert roof_z_center is not None, f'mount_x={mount_x:.4f} 中心射線沒打到車頂殼'
mount_z = round(roof_z_center + BASE_H, 4)
mount = [round(mount_x, 4), 0.0, mount_z]
note(f'集電弓底座 mount={mount}（roof_z_center={roof_z_center:.4f} + BASE_H={BASE_H} = {mount_z}，M5 要求 z∈[3.3,3.7]）。')

# --- 最終 meta.json（中繼格式；install_assets.py 讀這個組成正式 emu3000-mid.json） ---
meta = {
    'vertexCount': vertex_count, 'triangleCount': triangle_count, 'sha256': sha256,
    'bounds': {'min': bounds_min, 'max': bounds_max}, 'sizeM': size_m,
    'drawGroups': draw_groups_out, 'doors': doors_meta,
    'pantograph': {'parts': 'emu3000-pantograph', 'mount': mount},
}
(OUT_DIR / 'emu3000-mid.raw.bin').write_bytes(raw_bytes)
(OUT_DIR / 'emu3000-mid.meta.json').write_text(json.dumps(meta, ensure_ascii=False) + '\n', encoding='utf-8')
print('GD_MID_BUILD_OK', json.dumps({'vertexCount': vertex_count, 'triangleCount': triangle_count, 'sha256': sha256, 'sizeM': size_m, 'mount': mount}, ensure_ascii=False))
