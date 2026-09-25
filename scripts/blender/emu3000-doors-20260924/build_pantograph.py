#!/usr/bin/env python3
"""建 emu3000-pantograph：單臂集電弓零件庫（garage-parts-v1）。base／lower／upper／head 四個部件，
各自以自己的轉軸為原點匯出（都直接在 Blender world space 的原點附近建模，每個部件互相獨立、疊在一起
沒關係——匯出時各自分段，位置就是各自的局部座標，不做任何組裝變換）。

依 Task 5 判準（M6）：
  rig = {lower:1.10, upper:.81, headRise:.052}（方案 A，字面值，不是量出來的）
  base：底座＋礙子，局部原點＝下臂轉軸（mount）；從 z=0 往下延伸 BASE_H 到車頂（見下方 BASE_H）
  lower：沿局部 +x 從 0 伸到 1.10（下臂，肘朝 +x）
  upper：沿局部 +x 從 0 伸到 .81（上臂）
  head：局部最高點＝headRise=.052（滑板／集電頭，扁平沿 y 展開）
  三角形總數（四個部件合計）≤1500

沿用 build_doors.py 的自製匯出模式（calc_loop_triangles + corner_normals，同一顆 Blender 驗證過可用）。

用法：/Applications/Blender.app/Contents/MacOS/Blender -b --python build_pantograph.py
輸出：output/emu3000-doors/build-pantograph/emu3000-pantograph.raw.bin + .meta.json
"""
import bpy, sys, math, struct, json, hashlib
from pathlib import Path
from mathutils import Vector

sys.dont_write_bytecode = True
W = Path(__file__).resolve().parents[3]  # repo 根目錄（scripts/blender/<本目錄>/<本檔>）
sys.path.insert(0, str(W / 'scripts/blender/emu3000-20260912'))
import blender_parts as p  # noqa: E402

OUT_DIR = W / 'output/emu3000-doors/build-pantograph'
OUT_DIR.mkdir(parents=True, exist_ok=True)
NOTES_PATH = W / 'output/emu3000-doors/NOTES.md'


def note(msg):
    line = f'- [build_pantograph] {msg}\n'
    with open(NOTES_PATH, 'a', encoding='utf-8') as f:
        f.write(line)
    print(line, end='')


RIG = {'lower': 1.10, 'upper': .81, 'headRise': .052}
# 底座總高（局部 z 從 mount=0 往下到車頂）。必須跟 build_mid.py 的 BASE_H 一致
# ——那邊拿它去算 mount.z = roof_z + BASE_H，這邊拿它去反推底座各層局部座標。
BASE_H = 0.28

p.reset({'id': 'emu3000-pantograph', 'body': '34424A', 'accent': '97A7AC'})
p.use('05')

m_frame = p.mat('panto_frame', '2B333A', .55, .35, .1)       # 底座金屬框架（暗鐵灰）
m_insul = p.mat('panto_insulator', 'E9DEBE', .05, .32, .05)  # 礙子（米白陶瓷）
m_arm = p.mat('panto_arm', '8B969B', .62, .30, .12)           # 下臂／上臂（鋁合金灰）
m_head = p.mat('panto_head', '20262B', .30, .55, .0)          # 集電頭／碳滑板（近黑）

parts = {}  # name -> list[bpy.types.Object]

# --- base：底座框＋兩支礙子，局部原點＝下臂轉軸（mount，z=0）。base 從 z=0 往下延伸到車頂
#     （局部 z 範圍約 [-BASE_H, 小正值]），跟 mount.z = roof_z + BASE_H 對應：coordinator 補修 2
#     ——「mount＝下臂轉軸，所以 base 零件要從轉軸往下延伸到車頂」。由下而上：底板（貼車頂，
#     底面＝局部 z=-BASE_H）→ 兩支礙子 → 樞紐座頂板（局部 z 略大於 0，小正值）。
#     全部不倒角（bevel=0）：finish() 的倒角是固定 3 段的 BEVEL modifier，小零件疊起來很快超支，
#     示意等級不需要導角。
objs = []
_plate_t = .05   # 底板厚度
_top_t = .02     # 樞紐座頂板厚度
_insul_len = BASE_H - _plate_t - _top_t  # 礙子夾在底板與頂板之間
objs.append(p.box('panto_base_frame', (0, 0, -BASE_H + _plate_t / 2), (.34, .50, _plate_t), m_frame, bevel=0))
for sx in (-1, 1):
    objs.append(p.cyl(f'panto_base_insulator_{sx}', (sx * .11, 0, -BASE_H + _plate_t + _insul_len / 2), .045, _insul_len, m_insul, axis='Z', n=8, bevel=0))
objs.append(p.box('panto_base_top', (0, 0, _top_t / 2), (.30, .40, _top_t), m_frame, bevel=0))
parts['base'] = objs

# --- lower：下臂，局部 +x 從 0 伸到 rig.lower=1.10（肘朝 +x），肩關節一顆小圓柱 ---
objs = []
objs.append(p.rod('panto_lower_arm', (0, 0, 0), (RIG['lower'], 0, 0), .032, m_arm, n=8))
objs.append(p.cyl('panto_lower_shoulder', (0, 0, 0), .045, .05, m_frame, axis='X', n=8, bevel=0))
parts['lower'] = objs

# --- upper：上臂，局部 +x 從 0 伸到 rig.upper=.81 ---
objs = []
objs.append(p.rod('panto_upper_arm', (0, 0, 0), (RIG['upper'], 0, 0), .026, m_arm, n=8))
objs.append(p.cyl('panto_upper_elbow', (0, 0, 0), .040, .05, m_frame, axis='X', n=8, bevel=0))
parts['upper'] = objs

# --- head：集電頭／碳滑板，局部原點＝上臂頂端的樞紐，最高點＝headRise=.052 ---
hr = RIG['headRise']
objs = []
objs.append(p.box('panto_head_strip', (0, .0, hr - .026 / 2), (.14, 1.55, .026), m_head, bevel=0))
objs.append(p.box('panto_head_yoke', (0, 0, hr / 2), (.22, .40, hr), m_frame, bevel=0))
for sy in (-1, 1):
    objs.append(p.rod('panto_head_horn', (0, sy * .775, hr - .013), (.09, sy * .95, .004), .012, m_head, n=6))
parts['head'] = objs

note(f'四個部件建模完成：{{k: [o.name for o in v] for k, v in parts.items()}}={ {k: [o.name for o in v] for k, v in parts.items()} }')

# ============================================================
# 自製匯出（沿用 build_doors.py 的模式：calc_loop_triangles + corner_normals，world space）
# ============================================================
deps = bpy.context.evaluated_depsgraph_get()
raw = bytearray()
count = 0
part_ranges = {}
total_tris = 0

for part_name in ('base', 'lower', 'upper', 'head'):
    start_vertex = count
    for obj in parts[part_name]:
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
    part_ranges[part_name] = {'start': start_vertex, 'count': count - start_vertex}
    note(f'部件 {part_name!r}：start={start_vertex} count={count - start_vertex}（{(count - start_vertex)//3} 個三角形）')

if total_tris > 1500:
    sys.exit(f'集電弓三角形總數 {total_tris} 超過 1500 預算')

raw_bytes = bytes(raw)
sha256 = hashlib.sha256(raw_bytes).hexdigest()
vertex_count = count
triangle_count = total_tris

# --- extents 自檢（跟 M6 同一套算法，先在這裡自己驗一次，避免匯出後才發現） ---
f = struct.unpack(f'<{len(raw_bytes)//4}f', raw_bytes)
def extent(rng):
    x0 = x1 = z1 = None
    for v in range(rng['start'], rng['start'] + rng['count']):
        x = f[v * 6]; z = f[v * 6 + 2]
        x0 = x if x0 is None else min(x0, x)
        x1 = x if x1 is None else max(x1, x)
        z1 = z if z1 is None else max(z1, z)
    return {'x0': x0, 'x1': x1, 'z1': z1}
ext = {k: extent(v) for k, v in part_ranges.items()}
note('extents 自檢：' + json.dumps(ext, ensure_ascii=False))
assert abs(ext['lower']['x0']) <= .05 and abs(ext['lower']['x1'] - RIG['lower']) <= .05, f'lower extent 不合 M6：{ext["lower"]}'
assert abs(ext['upper']['x0']) <= .05 and abs(ext['upper']['x1'] - RIG['upper']) <= .05, f'upper extent 不合 M6：{ext["upper"]}'
assert abs(ext['head']['z1'] - RIG['headRise']) <= .01, f'head extent 不合 M6：{ext["head"]}'
note('M6 extents 自檢全部通過。')

meta = {
    'schema': 'garage-parts-v1', 'id': 'emu3000-pantograph', 'units': 'model',
    'vertexCount': vertex_count, 'triangleCount': triangle_count, 'sha256': sha256,
    'rig': RIG,
    'parts': [
        {'name': 'base', 'start': part_ranges['base']['start'], 'count': part_ranges['base']['count'], 'color': [.169, .2, .227], 'metalness': .55, 'roughness': .35},
        {'name': 'lower', 'start': part_ranges['lower']['start'], 'count': part_ranges['lower']['count'], 'color': [.545, .588, .608], 'metalness': .62, 'roughness': .30},
        {'name': 'upper', 'start': part_ranges['upper']['start'], 'count': part_ranges['upper']['count'], 'color': [.545, .588, .608], 'metalness': .62, 'roughness': .30},
        {'name': 'head', 'start': part_ranges['head']['start'], 'count': part_ranges['head']['count'], 'color': [.125, .149, .169], 'metalness': .30, 'roughness': .55},
    ],
}
(OUT_DIR / 'emu3000-pantograph.raw.bin').write_bytes(raw_bytes)
(OUT_DIR / 'emu3000-pantograph.meta.json').write_text(json.dumps(meta, ensure_ascii=False) + '\n', encoding='utf-8')
bpy.ops.wm.save_as_mainfile(filepath=str(OUT_DIR / 'emu3000-pantograph.blend'))
print('GD_PANTOGRAPH_BUILD_OK', json.dumps({'vertexCount': vertex_count, 'triangleCount': triangle_count, 'sha256': sha256, 'ext': ext}, ensure_ascii=False))
