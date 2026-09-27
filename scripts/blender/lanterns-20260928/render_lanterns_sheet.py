#!/usr/bin/env python3
"""讀已安裝的 rail-3d/assets/garage-lanterns-v1/lanterns.json + .bin.gz 與既有的
garage-people-v1/people.json + .bin.gz，畫一張審查圖：
  <repo>/output/lanterns/lantern-sheet.png：4 盞天燈（紅/黃/粉三種紙色各轉一個角度＋一盞素色天燈
  旁邊站一位 1.7 公尺高的參考乘客當比例尺），相機略低於天燈中段、微微仰角，同時看得到頂封口的
  上寬輪廓與底部開口露出的竹框／火。

跟 render_people_sheets.py 同一個教訓：畫「匯出後」的 lanterns.json/.bin.gz 重建幾何，不是 build
階段 .blend 裡的原始物件。

用法：/Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup -t 4 \
  --python scripts/blender/lanterns-20260928/render_lanterns_sheet.py
"""
import bpy, sys, json, gzip, math, array
from pathlib import Path
from mathutils import Matrix, Vector

sys.dont_write_bytecode = True
W = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(W / 'scripts/blender/emu3000-20260912'))
import blender_parts as p  # noqa: E402

LANTERN_DIR = W / 'rail-3d/assets/garage-lanterns-v1'
PEOPLE_DIR = W / 'rail-3d/assets/garage-people-v1'
OUT_DIR = W / 'output/lanterns'
OUT_DIR.mkdir(parents=True, exist_ok=True)
DESKTOP_DIR = Path('/Users/xuxiang/Desktop/車庫B-檢查點/04-十分')
DESKTOP_DIR.mkdir(parents=True, exist_ok=True)


def load_kit(asset_dir, stem):
    meta = json.loads((asset_dir / f'{stem}.json').read_text(encoding='utf-8'))
    raw = gzip.decompress((asset_dir / f'{stem}.bin.gz').read_bytes())
    f = array.array('f'); f.frombytes(raw)
    parts = {q['name']: q for q in meta['parts']}
    return meta, f, parts


LMETA, LF, LPARTS = load_kit(LANTERN_DIR, 'lanterns')
PMETA, PF, PPARTS = load_kit(PEOPLE_DIR, 'people')


def part_vf(f, parts, name):
    q = parts[name]
    s, c = q['start'], q['count']
    verts = [(f[v*6], f[v*6+1], f[v*6+2]) for v in range(s, s + c)]
    faces = [(i, i+1, i+2) for i in range(0, c, 3)]
    return verts, faces


# ---- 場景（跟 render_people_sheets.py 同一套：WORKBENCH／FLAT／cavity，純看材質色不受光照染色）----
p.reset({'id': 'lanterns-sheet', 'body': 'FFFFFF', 'accent': '888888'})
p.use('01')
SCENE = bpy.context.scene
SCENE.render.engine = 'BLENDER_WORKBENCH'
SCENE.display.shading.light = 'FLAT'
SCENE.display.shading.color_type = 'MATERIAL'
SCENE.display.shading.show_cavity = True
SCENE.display.shading.show_shadows = False
SCENE.render.film_transparent = False

_uid = [0]


def uid():
    _uid[0] += 1
    return _uid[0]


def add_object(verts, faces, material, label, matrix_world):
    obj = p.mesh(label, verts, faces, material, 0, True)
    obj.matrix_world = matrix_world
    return obj


def Rz(t):
    return Matrix.Rotation(t, 4, 'Z')


def Txyz(x, y, z):
    return Matrix.Translation((x, y, z))


PAPER_COLORS = {'red': 'C9463D', 'yellow': 'ECC147', 'pink': 'D98FA8', 'cream': 'E9DEBE'}
_mats = {}


def mat_for(hexcolor, tag):
    if tag not in _mats:
        _mats[tag] = p.mat('lsheet_' + tag, hexcolor, 0, .55)
    return _mats[tag]


def add_lantern(x, heading_deg, paper_hex, tag):
    root = Txyz(x, 0, 0) @ Rz(math.radians(heading_deg))
    m_paper = mat_for(paper_hex, 'paper_' + tag)
    m_frame = mat_for('AE7645', 'frame')
    m_flame = mat_for('FFC96B', 'flame')
    for name, mat in (('lantern-paper', m_paper), ('lantern-frame', m_frame), ('lantern-flame', m_flame)):
        verts, faces = part_vf(LF, LPARTS, name)
        add_object(verts, faces, mat, f'lt{uid()}_{tag}_{name}', root)


def add_label(text, loc, size=.11):
    d = bpy.data.curves.new('lbl_' + text + str(uid()), 'FONT')
    d.body = text; d.size = size; d.align_x = 'CENTER'; d.align_y = 'TOP'; d.extrude = 0
    o = bpy.data.objects.new('lbl_obj_' + text + str(uid()), d)
    bpy.context.collection.objects.link(o)
    o.location = loc
    o.rotation_euler = (math.radians(90), 0, 0)
    if 'lbl_black' not in bpy.data.materials:
        m = bpy.data.materials.new('lbl_black'); m.diffuse_color = (0, 0, 0, 1); m.use_nodes = True
        m.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (0, 0, 0, 1)
    d.materials.append(bpy.data.materials['lbl_black'])
    return o


# ---- 4 欄：紅 0°／黃 45°／粉 90°／素色＋參考乘客 ----
COL = 1.5
add_lantern((0-1.5)*COL, 0, PAPER_COLORS['red'], 'red')
add_label('紅・0°', ((0-1.5)*COL, -.9, -.05))
add_lantern((1-1.5)*COL, 45, PAPER_COLORS['yellow'], 'yellow')
add_label('黃・45°', ((1-1.5)*COL, -.9, -.05))
add_lantern((2-1.5)*COL, 90, PAPER_COLORS['pink'], 'pink')
add_label('粉・90°', ((2-1.5)*COL, -.9, -.05))

REF_X = (3-1.5)*COL
add_lantern(REF_X - .55, 20, PAPER_COLORS['cream'], 'ref')

# 參考乘客：1.7 公尺站姿（無擺姿勢，四肢自然下垂＝零件本身的姿態），跟天燈同一個 Blender 場景、
# 同一個 1 模型單位＝1 公尺換算，比例尺可以直接用眼睛比對高度。
person_root = Txyz(REF_X + .55, 0, 0)
m_skin = p.mat('lsheet_skin', 'E0B088', 0, .55)
m_top = p.mat('lsheet_top', '6F8FA8', 0, .55)


def place_person(name, second=False):
    q = PPARTS[name]
    piv = q['pivot']
    piv2 = (piv[0], -piv[1] if second else piv[1], piv[2])
    mat = m_skin if name in ('head', 'hand') else m_top
    verts, faces = part_vf(PF, PPARTS, name)
    add_object(verts, faces, mat, f'ref_person_{uid()}_{name}{"_2" if second else ""}', person_root @ Txyz(*piv2))


place_person('head')
place_person('torso-shirt')
for nm in ('arm', 'hand', 'leg', 'shoe'):
    place_person(nm, False)
    place_person(nm, True)
add_label('乘客 1.7m', (REF_X + .55, -.9, -.05))
# 09-28 三版：「天燈約 1.3m」是誤導——畫面裡的天燈其實是 HEIGHT=2.10m（build_lanterns.py 檔頭），
# 跟乘客 1.7m 的比例是 1.235，比原文寫實比例 1.30/1.70≈0.765 誇張了約 1.235/0.765≈1.6 倍（主對話
# 裁示的「誇張一點」正是這個倍數），不是畫面上真的擺了一顆 1.3m 的天燈。改成講清楚是誇張畫面比例。
add_label('天燈（誇張約1.6倍）', (REF_X - .55, -.9, -.05))

# ---- 相機：架高、俯視底口，同時看得到頂封口與底部開口的竹框／十字鐵絲／火（圓 2 retake：原本
# cam_z=.32/target_z=.58 幾乎平視、只仰 4.8°，底口竹圈幾乎貼著視線方向變成一條扁線，看不出竹圈與
# 燃料紙；現在架到 .62／瞄準 .12，俯角約 9°，足以讓底口的圓框、十字鐵絲攤開一點）----
LANTERN_H = LMETA['rig']['height']
cam_z = LANTERN_H * .62
target_z = LANTERN_H * .12
camdata = bpy.data.cameras.new('cam')
camera = bpy.data.objects.new('camobj', camdata)
bpy.context.collection.objects.link(camera)
SCENE.camera = camera
camdata.type = 'ORTHO'
camera.location = Vector((0, -6.5, cam_z))
camera.rotation_euler = (Vector((0, 0, target_z)) - Vector((0, -6.5, cam_z))).to_track_quat('-Z', 'Y').to_euler()
camdata.ortho_scale = 6.6
W_PX, H_PX = 1760, 1100
SCENE.render.resolution_x, SCENE.render.resolution_y = W_PX, H_PX
SCENE.render.resolution_percentage = 100
SCENE.render.filepath = str(OUT_DIR / 'lantern-sheet.png')
bpy.ops.render.render(write_still=True)
bpy.ops.wm.save_as_mainfile(filepath=str(OUT_DIR / 'lantern-sheet.blend'))

import shutil  # noqa: E402
shutil.copyfile(OUT_DIR / 'lantern-sheet.png', DESKTOP_DIR / 'lantern-sheet.png')
print('GD_LANTERN_SHEET_OK', str(DESKTOP_DIR / 'lantern-sheet.png'), W_PX, H_PX)
