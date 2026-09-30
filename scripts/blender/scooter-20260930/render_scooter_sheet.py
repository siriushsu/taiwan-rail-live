#!/usr/bin/env python3
"""讀已安裝的 garage-scooter-v1（與 garage-people-v1），畫機車對照表（給人看，不是驗收）：
  上排：正側面、正上方、斜前 3/4（側面旁邊站一個 1.7 m 普通人當比例尺，帽子戴在他頭上）；
  下排：正前、正後（旁邊站 1.7 m 普通人）、安全帽特寫。
輸出：<輸出資料夾>/scooter-sheet.png（預設 output/scooter）。用 Blender Workbench 平光算圖（只是對照造型，不是最終畫面）。
用法：/Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup -t 4 \
  --python scripts/blender/scooter-20260930/render_scooter_sheet.py -- <輸出資料夾>
"""
import bpy, sys, json, gzip, math, array
from pathlib import Path
from mathutils import Matrix, Vector

sys.dont_write_bytecode = True
W = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(W / 'scripts/blender/emu3000-20260912'))
import blender_parts as p  # noqa: E402

OUT = Path(sys.argv[sys.argv.index('--') + 1]) if '--' in sys.argv else W / 'output/scooter'
OUT.mkdir(parents=True, exist_ok=True)


def load(dirname, fname):
    d = W / 'rail-3d/assets' / dirname
    meta = json.loads((d / (fname + '.json')).read_text(encoding='utf-8'))
    F = array.array('f')
    F.frombytes(gzip.decompress((d / (fname + '.bin.gz')).read_bytes()))
    return meta, F, {q['name']: q for q in meta['parts']}


SM, SF, SP = load('garage-scooter-v1', 'scooter')
PM, PF, PP = load('garage-people-v1', 'people')
rig = SM['rig']
p.reset({'id': 'scooter-sheet', 'body': 'FFFFFF', 'accent': '888888'})
p.use('01')
S = bpy.context.scene
S.render.engine = 'BLENDER_WORKBENCH'
S.display.shading.light = 'FLAT'
S.display.shading.color_type = 'MATERIAL'
S.display.shading.show_cavity = True
S.display.shading.show_shadows = False
S.render.film_transparent = False
S.world.node_tree.nodes['Background'].inputs['Color'].default_value = (.86, .89, .88, 1)
MATS = {}


def hexmat(h):
    if h not in MATS:
        MATS[h] = p.mat('c_' + h, h, 0, .6)
    return MATS[h]


def linmat(rgb):
    key = tuple(rgb)
    if key not in MATS:
        m = bpy.data.materials.new('fix_' + '_'.join(map(str, key)))
        m.diffuse_color = (*rgb, 1)
        m.use_nodes = True
        m.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (*rgb, 1)
        MATS[key] = m
    return MATS[key]


LOOK = {'body': 'C9463D', 'helmet': 'E7E3D8', 'top': '5C8F9B', 'bottom': '384D5B', 'skin': 'E0B088', 'hair': '3A2C24'}
n = [0]


def add(meta_parts, F, name, world, hide_group):
    q = meta_parts[name]
    verts = [(F[v * 6], F[v * 6 + 1], F[v * 6 + 2]) for v in range(q['start'], q['start'] + q['count'])]
    n[0] += 1
    m = linmat(q['color']) if q['tint'] == 'fixed' else hexmat(LOOK[q['tint']])
    o = p.mesh(f'{name}_{n[0]}', verts, [(i, i + 1, i + 2) for i in range(0, q['count'], 3)], m, 0, True)
    o.matrix_world = world
    hide_group.append(o)
    return o


G = {'always': [], 'A': [], 'B': []}
fs = rig['wheels']['frontRadius'] / rig['wheels']['rearRadius']
for name, q in SP.items():
    if name == 'helmet':
        continue
    if name.startswith('wheel-'):
        add(SP, SF, name, Matrix.Translation(rig['wheels']['rear']), G['always'])
        add(SP, SF, name, Matrix.Translation(rig['wheels']['front']) @ Matrix.Scale(fs, 4), G['always'])
    else:
        add(SP, SF, name, Matrix.Identity(4), G['always'])


def person(x, y, group):
    root = Matrix.Translation((x, y, 0))
    piv = lambda nm, second=False: Matrix.Translation((PP[nm]['pivot'][0], -PP[nm]['pivot'][1] if second else PP[nm]['pivot'][1], PP[nm]['pivot'][2]))
    add(PP, PF, 'head', root @ piv('head'), group)
    add(PP, PF, 'hair-short', root @ piv('hair-short'), group)
    add(PP, PF, 'torso-jacket', root @ piv('torso-jacket'), group)
    for c in (0, 1):
        for nm in ('leg', 'shoe', 'arm', 'hand'):
            add(PP, PF, nm, root @ piv(nm, c), group)
    add(SP, SF, 'helmet', root @ Matrix.Translation(SP['helmet']['pivot']), group)   # 安全帽：跟頭同轉軸


person(1.9, 0, G['A'])
person(0, 1.35, G['B'])


def shoot(name, loc, target, ortho, show, persp_fov=None, res=(640, 640)):
    for grp, objs in G.items():
        for o in objs:
            o.hide_render = not (grp == 'always' or grp in show)
    d = bpy.data.cameras.new('cam' + name)
    o = bpy.data.objects.new('cam' + name, d)
    bpy.context.collection.objects.link(o)
    S.camera = o
    if persp_fov:
        d.type, d.angle = 'PERSP', math.radians(persp_fov)
    else:
        d.type, d.ortho_scale = 'ORTHO', ortho
    o.location = Vector(loc)
    o.rotation_euler = (Vector(target) - Vector(loc)).to_track_quat('-Z', 'Y').to_euler()
    S.render.resolution_x, S.render.resolution_y = res
    S.render.filepath = str(OUT / f'sheet-{name}.png')
    bpy.ops.render.render(write_still=True)


views = [('side', (.7, -9, 1.0), (.7, 0, 1.0), 3.9, ['A'], None), ('top', (.7, 0, 9), (.7, 0, 0), 3.9, ['A'], None),
         ('front34', (4.6, -4.2, 2.3), (.1, 0, .6), None, [], 26), ('front', (9, 0, 1.0), (0, .55, 1.0), 2.6, ['B'], None),
         ('rear', (-9, 0, 1.0), (0, .55, 1.0), 2.6, ['B'], None), ('helmet', (1.6, -1.4, 1.75), (1.9, 0, 1.55), .75, ['A'], None)]
for name, loc, tgt, ortho, show, fov in views:
    shoot(name, loc, tgt, ortho, show, fov)
try:   # Blender 內建 Python 沒有 PIL 時，六張分圖留在輸出資料夾，用系統 python3 拼（見 README）
    from PIL import Image
    ims = [Image.open(OUT / f'sheet-{v[0]}.png') for v in views]
    sheet = Image.new('RGB', (1920, 1280), 'white')
    for i, im in enumerate(ims):
        sheet.paste(im, ((i % 3) * 640, (i // 3) * 640))
    sheet.save(OUT / 'scooter-sheet.png')
    print('GD_SCOOTER_SHEET_OK', OUT / 'scooter-sheet.png')
except ImportError:
    print('GD_SCOOTER_SHEET_TILES_ONLY 沒有 PIL，六張分圖在', OUT)
