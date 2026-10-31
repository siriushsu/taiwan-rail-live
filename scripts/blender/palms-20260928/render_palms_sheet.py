#!/usr/bin/env python3
"""南迴棕櫚審查圖：讀已安裝的正式資產 rail-3d/assets/garage-palms-v1/palms.{json,bin.gz}，
照執行期的接法把 5 款棕櫚（coco-straight／coco-curved-a／coco-curved-b／betel-a／betel-b）各接成一棵，
子零件顏色取自 rail-3d/garage-scenes/south-coast.js 的 PALM_COLORS（從原始碼讀，不在這裡另抄一份），
排成一排拍側面／斜上 35°／正上三張。每款左邊一根站姿乘客比例尺（0.754 單位＝1.70 m）。

這是給人看的視覺複核，不是驗收：驗收讀瀏覽器裡真正的 InstancedMesh
（scripts/verify_garage_south_coast_stop.mjs 的棕櫚判準）。
尺寸＝資產原生尺寸；場景裡每棵會再等比縮放到 south-coast.js 的 COCO_HEIGHT／BETEL_HEIGHT 範圍。

用法：/Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup -t 4 \
  --python scripts/blender/palms-20260928/render_palms_sheet.py [-- <輸出前綴>]
預設輸出 output/palms/palms-sheet-{side,oblique,top}.png（output/ 不進 repo）。
"""
import bpy, sys, math, json, gzip, re, struct
from pathlib import Path
from mathutils import Vector

W = Path(__file__).resolve().parents[3]
ASSET = W / 'rail-3d/assets/garage-palms-v1'
SCENE_JS = W / 'rail-3d/garage-scenes/south-coast.js'
argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
OUT = Path(argv[0]) if argv else W / 'output/palms/palms-sheet'
OUT.parent.mkdir(parents=True, exist_ok=True)
MODELS = ['coco-straight', 'coco-curved-a', 'coco-curved-b', 'betel-a', 'betel-b']
PERSON_H = .754  # south-coast.js 站姿乘客的高度（1.70 m × UNITS_PER_METER 0.4435）

# PALM_COLORS：從 south-coast.js 讀 `const PALM_COLORS={ coco:{trunk:'#..',...}, betel:{...}};`
js = SCENE_JS.read_text(encoding='utf-8')
blk = re.search(r'const PALM_COLORS=\{(.*?)\};', js, re.S)
if not blk:
    raise SystemExit('south-coast.js 找不到 PALM_COLORS')
colors = {fam: dict(re.findall(r"(\w+):'(#[0-9a-fA-F]{6})'", body)) for fam, body in re.findall(r'(\w+):\{([^}]*)\}', blk.group(1))}


def srgb_to_linear(h):
    # three.js 的 Color.set('#hex') 會把 sRGB 轉成線性值；Blender 的 FLOAT_COLOR 也吃線性值。
    out = []
    for i in (1, 3, 5):
        c = int(h[i:i + 2], 16) / 255
        out.append(c / 12.92 if c <= .04045 else ((c + .055) / 1.055) ** 2.4)
    return out


meta = json.loads((ASSET / 'palms.json').read_text(encoding='utf-8'))
raw = gzip.decompress((ASSET / 'palms.bin.gz').read_bytes())
data = struct.unpack(f'<{len(raw) // 4}f', raw)
if len(data) // 6 != meta['mesh']['vertexCount']:
    raise SystemExit('palms.bin.gz 頂點數跟 palms.json 對不上')

bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.context.scene
sc.render.engine = 'BLENDER_WORKBENCH'
sc.display.shading.light = 'STUDIO'
sc.display.shading.color_type = 'VERTEX'
sc.display.shading.show_shadows = True
sc.display.shading.shadow_intensity = .35
sc.view_settings.view_transform = 'Standard'
world = bpy.data.worlds.new('w'); world.color = (.86, .85, .82); sc.world = world


def add_mesh(name, verts, normals, rgb, x):
    me = bpy.data.meshes.new(name)
    me.from_pydata([(v[0] + x, v[1], v[2]) for v in verts], [], [(i, i + 1, i + 2) for i in range(0, len(verts), 3)])
    try:
        me.shade_smooth()
        me.normals_split_custom_set_from_vertices(normals)
    except Exception as e:  # 自訂法向量失敗只影響明暗，不影響形狀
        print('custom normals skipped:', e)
    a = me.color_attributes.new('Col', 'FLOAT_COLOR', 'POINT')
    a.data.foreach_set('color', [c for col in rgb for c in (*col, 1.0)])
    me.color_attributes.active_color_name = 'Col'
    ob = bpy.data.objects.new(name, me); sc.collection.objects.link(ob)


def person_box(name, bx):
    # 站姿乘客比例尺：0.16×0.10×PERSON_H 的深藍方柱
    me = bpy.data.meshes.new(name)
    v = [(bx - .08, -.05, 0), (bx + .08, -.05, 0), (bx + .08, .05, 0), (bx - .08, .05, 0),
         (bx - .08, -.05, PERSON_H), (bx + .08, -.05, PERSON_H), (bx + .08, .05, PERSON_H), (bx - .08, .05, PERSON_H)]
    me.from_pydata(v, [], [(0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)])
    a = me.color_attributes.new('Col', 'FLOAT_COLOR', 'POINT'); a.data.foreach_set('color', [.02, .03, .12, 1.0] * 8)
    me.color_attributes.active_color_name = 'Col'
    ob = bpy.data.objects.new(name, me); sc.collection.objects.link(ob)


SPACING, x = 3.4, 0.0
report = {}
for model in MODELS:
    fam = model.split('-')[0]
    subs = [p for p in meta['parts'] if p['name'].startswith(model + '/')]
    if not subs:
        raise SystemExit(f'資產沒有 {model}')
    verts, normals, rgb = [], [], []
    for p in subs:
        sub = p['name'][len(model) + 1:]
        if sub not in colors[fam]:
            raise SystemExit(f'PALM_COLORS 沒有 {fam}.{sub}')
        col = srgb_to_linear(colors[fam][sub])
        for k in range(p['start'], p['start'] + p['count']):
            verts.append(data[k * 6:k * 6 + 3]); normals.append(data[k * 6 + 3:k * 6 + 6]); rgb.append(col)
    add_mesh(model, verts, normals, rgb, x)
    person_box(model + '-person', x - 1.45)
    report[model] = {'x': x, 'tris': len(verts) // 3, 'height': round(max(v[2] for v in verts), 4)}
    x += SPACING
x0, x1 = -1.45 - .6, x - SPACING + 1.6
cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam')); sc.collection.objects.link(cam); sc.camera = cam
cam.data.type = 'ORTHO'; cam.data.ortho_scale = x1 - x0; cam.data.clip_end = 200
sc.render.resolution_x, sc.render.resolution_y = int(round((x1 - x0) * 100)), 500
cx = (x0 + x1) / 2
for tag, el, cz in (('side', 0, 2.05), ('oblique', 35, 1.55), ('top', 89.9, 0)):
    e = math.radians(el)
    d = Vector((0, -math.cos(e), math.sin(e)))
    cam.location = Vector((cx, 0, cz)) + d * 40
    cam.rotation_euler = (-d).to_track_quat('-Z', 'Y').to_euler()
    sc.render.filepath = f'{OUT}-{tag}.png'
    bpy.ops.render.render(write_still=True)
print('PALMS_SHEET_OK', json.dumps({'out': str(OUT), 'models': report}, ensure_ascii=False))
