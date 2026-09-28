#!/usr/bin/env python3
"""讀已安裝的 rail-3d/assets/garage-shifen-v1/shifen-veg.json + .bin.gz，用跟
shifen.js 的 createVegetation() 完全同一套變換公式（trunk：T(s.x,s.y,s.z)@Rz(yaw)@S(trunkR,trunkR,H*.62)；
canopy-lobe：T(s.x+jx*H*.22,s.y+jy*H*.22,s.z+H*heightFrac)@Rz(yaw+j*1.1)@S(rx,ry2,rz)；
bamboo culm/leaf 同檔案 393-402 行）組出 round／layered 兩種闊葉樹各一棵＋一叢竹子，各配 1.7 m
簡化人形比例尺，拍側面、低角度剪影、樹冠特寫三張。不是最終驗收（最終驗收讀瀏覽器裡真正的
InstancedMesh，見 scripts/verify_garage_shifen.mjs 的 Task 3 判準），這裡是把「還是不是二十面體
綠寶石」擋在接進場景之前的視覺複核，比照 alishan-trees-20260928/render_alishan_trees_sheet.py
的做法（該檔的 SUGI/HINOKI 常數換成這裡的 round/layered 常數，其餘結構沿用）。

用法：/Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup -t 4 \
  --python scripts/blender/shifen-20260928/render_shifen_veg_sheet.py
輸出：/Users/xuxiang/Desktop/車庫B-檢查點/04-十分/polish/veg-sheet-side.png
      /Users/xuxiang/Desktop/車庫B-檢查點/04-十分/polish/veg-sheet-low.png
      /Users/xuxiang/Desktop/車庫B-檢查點/04-十分/polish/veg-sheet-canopy-closeup.png
"""
import bpy, sys, json, gzip, math, array
from pathlib import Path
from mathutils import Matrix, Vector

sys.dont_write_bytecode = True
W = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(W / 'scripts/blender/emu3000-20260912'))
import blender_parts as p  # noqa: E402

ASSET_DIR = W / 'rail-3d/assets/garage-shifen-v1'
OUT_DIR = Path('/Users/xuxiang/Desktop/車庫B-檢查點/04-十分/polish')
OUT_DIR.mkdir(parents=True, exist_ok=True)

meta = json.loads((ASSET_DIR / 'shifen-veg.json').read_text(encoding='utf-8'))
raw = gzip.decompress((ASSET_DIR / 'shifen-veg.bin.gz').read_bytes())
F = array.array('f')
F.frombytes(raw)
PARTS = {q['name']: q for q in meta['parts']}


def part_verts(name):
    q = PARTS[name]
    s, c = q['start'], q['count']
    return [(F[v*6], F[v*6+1], F[v*6+2]) for v in range(s, s + c)]


def part_faces(name):
    c = PARTS[name]['count']
    return [(i, i+1, i+2) for i in range(0, c, 3)]


p.reset({'id': 'shifen-veg-sheet', 'body': 'FFFFFF', 'accent': '888888'})
p.use('01')
SCENE = bpy.context.scene
SCENE.render.engine = 'BLENDER_WORKBENCH'
SCENE.display.shading.light = 'STUDIO'
SCENE.display.shading.color_type = 'MATERIAL'
SCENE.display.shading.show_cavity = True
SCENE.display.shading.show_shadows = True

MATS = {}


def mat_hex(hexcolor, tag):
    hexcolor = hexcolor.lstrip('#')
    if hexcolor not in MATS:
        MATS[hexcolor] = p.mat('c_' + tag + '_' + hexcolor, hexcolor, 0, .65)
    return MATS[hexcolor]


_uid = [0]


def uid_next():
    _uid[0] += 1
    return _uid[0]


def add_part(name, mw, hexcolor, tag):
    verts, faces = part_verts(name), part_faces(name)
    obj = p.mesh(f'{tag}_{name}_{uid_next()}', verts, faces, mat_hex(hexcolor, tag), 0, True)
    obj.matrix_world = mw
    return obj


def Sxyz(sx, sy, sz):
    m = Matrix.Identity(4)
    m[0][0], m[1][1], m[2][2] = sx, sy, sz
    return m


def Txyz(x, y, z):
    return Matrix.Translation((x, y, z))


def Rzyx(rx, ry, rz):
    # 對齊 THREE.Euler 預設 'XYZ' 內建順序（dummy.rotation.set(x,y,z) 未指定 order 時的預設）：
    # 先繞 X、再 Y、再 Z，最終矩陣＝Rz@Ry@Rx。
    return Matrix.Rotation(rz, 4, 'Z') @ Matrix.Rotation(ry, 4, 'Y') @ Matrix.Rotation(rx, 4, 'X')


TRUNK_HEX = '6b5a3e'
CANOPY_GREENS = ['4e7158', '668363', '8c9c70']  # shifen.js greens[]，跟老街闊葉樹同一組
BAMBOO_GREENS = ['5f8a4a', '7fa25e']            # shifen.js bambooGreens[]

# 跟 rail-3d/garage-scenes/shifen.js createVegetation() 366-380 行完全同一套公式；
# 這裡不重新推導比例，直接照抄常數與運算式，只是把 rand() 換成固定的代表性樣本值。
LOBES_PER = {'round': 5, 'layered': 4}


def build_tree(x0, y0, H, species, yaw, tint_idx, jit, tag):
    """跟 shifen.js 365-380 行逐行對應：trunkR=.05*H；trunk T@Rz@S(trunkR,trunkR,H*.62)；
    每片 canopy-lobe 用 jit[(j*2)%6]/jit[(j*2+1)%6] 當 jx/jy，isLayered 決定 rx/ry2/rz 與
    heightFrac 公式。"""
    trunk_r = .05 * H
    trunk_mw = Txyz(x0, y0, 0) @ Rzyx(0, 0, yaw) @ Sxyz(trunk_r, trunk_r, H * .62)
    add_part('tree-trunk', trunk_mw, TRUNK_HEX, tag + '_trunk')
    n = LOBES_PER[species]
    is_layered = species == 'layered'
    tint = CANOPY_GREENS[tint_idx]
    for j in range(n):
        jx, jy = jit[(j * 2) % 6], jit[(j * 2 + 1) % 6]
        rx = H * .34 if is_layered else H * .24
        ry2 = H * .30 if is_layered else H * .22
        rz = H * .13 if is_layered else H * .19
        height_frac = (.5 + j * .14) if is_layered else (.62 + j * .055)
        lobe_mw = (Txyz(x0 + jx * H * .22, y0 + jy * H * .22, H * height_frac)
                   @ Rzyx(0, 0, yaw + j * 1.1) @ Sxyz(rx, ry2, rz))
        add_part('canopy-lobe', lobe_mw, tint, tag + '_canopy')
    return H


def build_bamboo_clump(x0, y0, culms_per, leaves_per, tag):
    """跟 shifen.js 393-402 行逐行對應，rand() 換成固定代表值（每根稈的 H/r/ang/rr/lean 各自
    取一組跨中位數的樣本，讓叢看起來有自然差異但可重現）。"""
    samples_H = [2.6, 3.1, 2.8, 3.6, 2.7, 3.3, 2.9, 3.0, 3.5, 2.65, 3.2, 2.95]
    samples_r = [.028, .033, .030, .035, .027, .032, .029, .031, .034, .026, .033, .030]
    samples_rr = [.18, .30, .14, .38, .22, .34, .16, .28, .40, .20, .36, .24]
    samples_lean = [.02, -.04, .05, -.02, .03, -.05, .01, .04, -.03, .02, -.01, .05]
    for k in range(culms_per):
        H = samples_H[k % len(samples_H)]
        r = samples_r[k % len(samples_r)]
        ang = k / culms_per * math.pi * 2 + .15
        rr = samples_rr[k % len(samples_rr)]
        lean = samples_lean[k % len(samples_lean)]
        cx, cy = x0 + math.cos(ang) * rr, y0 + math.sin(ang) * rr
        tint = BAMBOO_GREENS[k % 2]
        culm_mw = Txyz(cx, cy, 0) @ Rzyx(lean, lean * .6, ang) @ Sxyz(r, r, H)
        add_part('bamboo-culm', culm_mw, tint, tag + '_culm')
        for m in range(leaves_per):
            t = .45 + .5 * (m / leaves_per) + .04
            length = .55 + .17
            yaw2 = (m * 1.7) % (math.pi * 2)
            pitch = .35 + .25
            leaf_mw = (Txyz(cx, cy, H * t) @ Rzyx(0, -pitch, ang + yaw2)
                       @ Sxyz(length, length, length))
            add_part('bamboo-leaf', leaf_mw, tint, tag + '_leaf')
    return culms_per * (1 + leaves_per)


def add_person_proxy(x0, y0):
    """1.7 m 高的簡化人形比例尺（非真正 kit 拼裝，純視覺比例參考，跟 alishan-trees-20260928 同做法）。"""
    h = 1.7
    skin, top, bottom = mat_hex('e0b088', 'skin'), mat_hex('6f8fa8', 'top'), mat_hex('3d4450', 'bottom')
    p.box('person_legs_' + str(uid_next()), (x0, y0, h * .27), (h * .16, h * .16, h * .54), bottom, bevel=0)
    p.box('person_torso_' + str(uid_next()), (x0, y0, h * .27 + h * .27 + h * .19), (h * .30, h * .18, h * .38), top, bevel=0)
    head_verts, head_faces = _ico(radius=h * .09)
    head = p.mesh('person_head_' + str(uid_next()), head_verts, head_faces, skin, 0, True)
    head.location = (x0, y0, h * .27 + h * .27 + h * .38 + h * .09)
    return h


def _ico(radius):
    import bmesh as _bm
    bm = _bm.new()
    _bm.ops.create_icosphere(bm, subdivisions=1, radius=radius)
    bm.verts.ensure_lookup_table()
    idx = {v: i for i, v in enumerate(bm.verts)}
    verts = [(v.co.x, v.co.y, v.co.z) for v in bm.verts]
    faces = [tuple(idx[v] for v in f.verts) for f in bm.faces]
    bm.free()
    return verts, faces


# 兩種樹種各一棵（中位數尺寸：H 取 plantTree() 產生範圍 1.2~2.9 的中段），jit 取一組跨正負值
# 的固定樣本（shifen.js 的 jit 是 rand()-.5，範圍 -.5~.5）＋一叢竹子（culmsPerClump=6、
# leavesPerCulm=5，跟 createVegetation() 的預設 cfg 一致）。
ROUND_JIT = [.32, -.18, -.25, .40, .10, -.35]
LAYERED_JIT = [-.30, .22, .35, -.12, -.15, -.38]

heights = {}
heights['round'] = build_tree(-6, 0, 2.0, 'round', .4, 0, ROUND_JIT, 'round')
add_person_proxy(-6 + 1.6, 0)
heights['layered'] = build_tree(0, 0, 1.7, 'layered', 1.1, 2, LAYERED_JIT, 'layered')
add_person_proxy(0 + 1.9, 0)
bamboo_instances = build_bamboo_clump(7, 0, 6, 5, 'bamboo')
add_person_proxy(7 + 1.3, 0)
heights['bamboo_clump_instances'] = bamboo_instances

note_dir = W / 'output/shifen-veg'
note_dir.mkdir(parents=True, exist_ok=True)
with open(note_dir / 'NOTES.md', 'a', encoding='utf-8') as fh:
    fh.write(f'- [render_shifen_veg_sheet] round(H=2.0)／layered(H=1.7) 各一棵＋竹叢(6稈×5葉=30實例)：{json.dumps(heights, ensure_ascii=False)}（人形比例尺 1.7 m）\n')


def frame_ortho(loc, target, scale, res):
    camdata = bpy.data.cameras.new('cam_' + str(uid_next()))
    camera = bpy.data.objects.new('camobj_' + str(uid_next()), camdata)
    bpy.context.collection.objects.link(camera)
    SCENE.camera = camera
    camdata.type = 'ORTHO'
    camera.location = Vector(loc)
    camera.rotation_euler = (Vector(target) - Vector(loc)).to_track_quat('-Z', 'Y').to_euler()
    camdata.ortho_scale = scale
    SCENE.render.resolution_x, SCENE.render.resolution_y = res
    SCENE.render.resolution_percentage = 100
    return camera


# 三個樣本橫跨 x=-6(round)到 x=8.3(bamboo 的人形比例尺)，寬度約 14.3——第一版 ortho_scale 取 11
# 太窄（只裝得下 aspect=2 時的 11 個世界單位寬），把 bamboo 整叢連同它的比例尺都裁到畫面外、round
# 樹的比例尺也貼著邊緣，畫出來只看得到一棵樹＋兩根柱子。改成涵蓋全部三個樣本＋兩側各留約 3 個
# 單位邊界的寬度（20），中心對齊三個樣本 x 範圍的中點，不是隨手取的 0.5。
mid_x = 1.15   # (-6 + 8.3) / 2
mid_z = 1.3
WIDE_SCALE = 20
# 側面（沿 -Y 看向 +Y）：round／layered 兩棵樹＋一叢竹子＋三個人形比例尺一字排開，最容易讀出
# 「像不像多面體綠寶石」，也是唯一同時看得到全部三種樣本的畫面。
frame_ortho((mid_x, -22, mid_z), (mid_x, 0, mid_z), WIDE_SCALE, (2400, 1200))
SCENE.render.filepath = str(OUT_DIR / 'veg-sheet-side.png')
bpy.ops.render.render(write_still=True)
print('GD_SHIFEN_VEG_SHEET_SIDE_OK', str(OUT_DIR / 'veg-sheet-side.png'))

# 低角度（貼地水平看過去）：專看剪影——評審原話關切的是「一放大就很醒目」的多面體稜角；同樣要
# 涵蓋全部三個樣本，不能只框到中間那一棵。
frame_ortho((mid_x, -13, 0.35), (mid_x, 0, mid_z), WIDE_SCALE, (2400, 1000))
SCENE.render.filepath = str(OUT_DIR / 'veg-sheet-low.png')
bpy.ops.render.render(write_still=True)
print('GD_SHIFEN_VEG_SHEET_LOW_OK', str(OUT_DIR / 'veg-sheet-low.png'))

# 樹冠特寫（round 樹種——round／layered 共用同一顆 canopy-lobe 零件，差別只在縮放與疊放參數，
# 所以這張特寫同時代表兩個樹種「還是不是正二十面體」的答案）。
frame_ortho((-6, -3.4, 1.6), (-6, 0, 1.6), 2.6, (1400, 1100))
SCENE.render.filepath = str(OUT_DIR / 'veg-sheet-canopy-closeup.png')
bpy.ops.render.render(write_still=True)
print('GD_SHIFEN_VEG_SHEET_CANOPY_OK', str(OUT_DIR / 'veg-sheet-canopy-closeup.png'))

# 竹叢特寫（bamboo-culm 的六邊形斷面＋週期性竹節、bamboo-leaf 的披針形垂葉——這兩個零件完全
# 不跟闊葉樹共用幾何，前兩張寬鏡因為構圖錯誤整叢被裁到畫面外，這裡單獨補一張近看）。
frame_ortho((7, -5.5, 1.8), (7, 0, 1.8), 5.5, (1400, 1300))
SCENE.render.filepath = str(OUT_DIR / 'veg-sheet-bamboo-closeup.png')
bpy.ops.render.render(write_still=True)
print('GD_SHIFEN_VEG_SHEET_BAMBOO_OK', str(OUT_DIR / 'veg-sheet-bamboo-closeup.png'))

bpy.ops.wm.save_as_mainfile(filepath=str((note_dir / 'veg-sheet.blend')))
