"""算「改動前」對照圖：重建未經任何車門修改的原始 emu3000（純快照幾何），用跟 build_doors.py
的 01-closed.png 完全相同的相機／燈光（render_common.py）算一張關門狀態的外觀圖，存成
output/emu3000-doors/renders/00-before-closed.png。

用途：round 2 修正時，被問到「01 圖門周圍那圈細黑線是快照本來就有、還是這輪布林新產生的縫」——
兩張圖用同一機位／同一燈光才能真的拿來比，不能各自調角度後憑印象比對。

用法：
  /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup -t 4 \
    --python scripts/blender/emu3000-doors-20260924/render_baseline.py
不接受參數、不寫資產、不動 NOTES.md 以外的檔案；只讀快照＋寫一張 PNG。
"""
import sys, time
from pathlib import Path

sys.dont_write_bytecode = True

W = Path('/Users/xuxiang/Code/捷運小動畫/.claude/worktrees/garage-scene-03')
SNAP = W / 'scripts/blender/emu3000-20260912'
OUT_ROOT = W / 'output/emu3000-doors'
NOTES_PATH = OUT_ROOT / 'NOTES.md'
RENDERS_DIR = OUT_ROOT / 'renders'
RENDERS_DIR.mkdir(parents=True, exist_ok=True)

sys.path.insert(0, str(SNAP))
import bpy
from mathutils import Vector
import blender_parts as p
import build_models as b
from model_specs import S

sys.path.insert(0, str(Path(__file__).resolve().parent))
from base_geometry import build_baseline
import render_common as rc


def note(text):
    ts = time.strftime('%H:%M:%S')
    with open(NOTES_PATH, 'a', encoding='utf-8') as f:
        f.write(f'- {ts} [render_baseline] {text}\n')


note('render_baseline.py 開始執行——建純快照幾何（不做任何車門修改），算改動前對照圖。')
spec, L, W_, H = build_baseline(p, b, S)
note('基準幾何重建完成（與 build_doors.py 使用同一份 base_geometry.build_baseline）。物件數=' + str(len(p.MODEL)))

# --- 找 L2 門扇（cx 較大、side=+1 的那一片），只為了取相機瞄準的目標點；沿用 build_doors.py 的
#     door id 規則（+Y=L、-X端=1、+X端=2），DOOR_CZ 數值必須與 build_doors.py 一致，否則兩張圖
#     機位對不上、比較沒有意義。
DOOR_CZ = 2.02
leaf_objs = [o for o in p.MODEL if o.get('side_door')]
assert len(leaf_objs) == 4, f'預期 4 片門扇，實得 {len(leaf_objs)}'


def bbox_center(o):
    coords = [o.matrix_world @ Vector(v) for v in o.bound_box]
    return sum(coords, Vector()) / len(coords)


candidates = [(bbox_center(o), o) for o in leaf_objs]
l2_center, l2_obj = max(((c, o) for c, o in candidates if c.y > 0), key=lambda t: t[0].x)
fcx, fside = round(l2_center.x, 6), 1
note(f'L2 門扇座標（純快照，未開洞）：cx={fcx} side={fside}')

SCENE = p.SCENE
SCENE.render.engine = 'CYCLES'
SCENE.cycles.samples = 48
SCENE.cycles.use_denoising = True
SCENE.view_settings.view_transform = 'AgX'
SCENE.render.image_settings.file_format = 'PNG'
SCENE.render.film_transparent = False

p.use('90')
p.box('展示台', (0, 0, -.060), (200, 200, .10), p.mat('攝影棚紙白', 'F0EBDF', 0, .8), .02, model=False)
rc.setup_sun(p)
camera, camdata = rc.make_camera(p, SCENE)

target = Vector((fcx, fside * 1.466, DOOR_CZ))
eye = rc.exterior_eye(target, fside)
rc.view(camera, camdata, SCENE, eye, target, 5.5, res=(1000, 800))
rc.render(SCENE, RENDERS_DIR / '00-before-closed.png')

note(f'00-before-closed.png 算繪完成，輸出於 {RENDERS_DIR}。')
print('GD_BASELINE_RENDER_OK', flush=True)
