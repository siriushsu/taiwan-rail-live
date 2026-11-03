#!/usr/bin/env python3
"""讀已安裝的 garage-camera-v1 與 garage-people-v1，畫相機一覽圖（給人看，不是驗收）：
  上排：攝影者（Blender 人＋舉相機的彎臂）三個視角＋旁邊站一個 1.7 m 的普通人當比例尺；
  下排：相機特寫（前 3/4、側面、後上方）。
輸出 output/camera/camera-sheet.png。
用法：/Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup -t 4 \
  --python scripts/blender/camera-20260928/render_camera_sheet.py
"""
import bpy, sys, json, gzip, math, array
from pathlib import Path
from mathutils import Matrix, Vector

sys.dont_write_bytecode = True
W = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(W / 'scripts/blender/emu3000-20260912'))
import blender_parts as p  # noqa: E402

OUT = W / 'output/camera'
OUT.mkdir(parents=True, exist_ok=True)


def load(dirname, fname):
    d = W / 'rail-3d/assets' / dirname
    meta = json.loads((d / (fname + '.json')).read_text(encoding='utf-8'))
    raw = gzip.decompress((d / (fname + '.bin.gz')).read_bytes())
    F = array.array('f')
    F.frombytes(raw)
    return meta, F, {q['name']: q for q in meta['parts']}


PM, PF, PP = load('garage-people-v1', 'people')
CM, CF, CP = load('garage-camera-v1', 'camera')

p.reset({'id': 'camera-sheet', 'body': 'FFFFFF', 'accent': '888888'})
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


LOOK = {'top': '5c8f9b', 'bottom': '384d5b', 'skin': 'e0b088', 'hair': '3a2c24'}


def material(q):
    t = q['tint']
    return linmat(q['color']) if t == 'fixed' else hexmat(LOOK[t] if t != 'hair' else LOOK['hair'])


def add(meta_parts, F, name, world, label):
    q = meta_parts[name]
    verts = [(F[v * 6], F[v * 6 + 1], F[v * 6 + 2]) for v in range(q['start'], q['start'] + q['count'])]
    faces = [(i, i + 1, i + 2) for i in range(0, q['count'], 3)]
    o = p.mesh(label, verts, faces, material(q), 0, True)
    o.matrix_world = world
    return o


n = [0]


def uid():
    n[0] += 1
    return n[0]


def person(x, y, heading, photographer):
    root = Matrix.Translation((x, y, 0)) @ Matrix.Rotation(heading, 4, 'Z')
    def piv(name, second=False):
        pv = PP[name]['pivot']
        return Matrix.Translation((pv[0], -pv[1] if second else pv[1], pv[2]))
    add(PP, PF, 'head', root @ piv('head'), f'h{uid()}')
    add(PP, PF, 'hair-short', root @ piv('hair-short'), f'hs{uid()}')
    add(PP, PF, 'torso-jacket', root @ piv('torso-jacket'), f't{uid()}')
    for c in (0, 1):
        add(PP, PF, 'leg', root @ piv('leg', c), f'l{uid()}')
        add(PP, PF, 'shoe', root @ piv('shoe', c), f's{uid()}')
        if not photographer:
            add(PP, PF, 'arm', root @ piv('arm', c), f'a{uid()}')
            add(PP, PF, 'hand', root @ piv('hand', c), f'ha{uid()}')
    if photographer:
        for name in CP:
            add(CP, CF, name, root, f'c{uid()}')


person(0, 0, 0, True)          # 攝影者，面向 +X
person(1.6, 0, 0, False)       # 1.7 m 比例尺（普通人）
person(4.0, 0, math.pi / 2 * 0, True)


def cam(loc, target, ortho, res, path):
    d = bpy.data.cameras.new('cam' + str(uid()))
    o = bpy.data.objects.new('camo' + str(uid()), d)
    bpy.context.collection.objects.link(o)
    S.camera = o
    d.type = 'ORTHO'
    d.ortho_scale = ortho
    o.location = Vector(loc)
    o.rotation_euler = (Vector(target) - Vector(loc)).to_track_quat('-Z', 'Y').to_euler()
    S.render.resolution_x, S.render.resolution_y = res
    S.render.filepath = str(path)
    bpy.ops.render.render(write_still=True)


# 三張小圖分別存，再由 PIL 拼成一張（Blender 端不拼，避免依賴）
views = [
    ('front34', (3.2, -4.0, 1.7), (0.15, 0, 1.0), 2.4),   # 前 3/4：看得到臉前的相機與雙臂
    ('side', (.16, -6, 1.15), (.16, 0, 1.0), 2.4),        # 側面：看手肘彎、相機在臉前
    ('closeup', (2.2, -1.4, 1.75), (.32, 0, 1.46), .55),   # 相機特寫
    ('scale', (0.8, -8, 1.0), (0.8, 0, 0.95), 2.3),       # 攝影者＋1.7 m 普通人並排
]
for name, loc, tgt, size in views:
    cam(loc, tgt, size, (900, 900), OUT / f'sheet-{name}.png')
try:
    from PIL import Image
    ims = [Image.open(OUT / f'sheet-{n_}.png') for n_, *_ in views]
    sheet = Image.new('RGB', (1800, 1800), 'white')
    for i, im in enumerate(ims):
        sheet.paste(im, ((i % 2) * 900, (i // 2) * 900))
    sheet.save(OUT / 'camera-sheet.png')
    print('GD_CAMERA_SHEET_OK', OUT / 'camera-sheet.png')
except ImportError:
    print('沒有 PIL，四張分圖在 output/camera/sheet-*.png')
