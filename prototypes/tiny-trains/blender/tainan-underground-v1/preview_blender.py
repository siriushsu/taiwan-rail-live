"""Blender 背景模式算圖：依 views.json 把三角形湯畫成 PNG。只在 Blender 內執行（只用 bpy＋numpy）。

用法（preview.py 呼叫）：
  Blender -b --python preview_blender.py -- views.json
views.json：[{name, out, size:[w,h], samples, mesh:'.npy 路徑 float32 [N,6]', groups:[{name,color,roughness,opacity,doubleSided,start,count}],
              camera:{target:[x,y,z], azimuth, elevation, distance, lens, ortho}, sun:[x,y,z], sky:[r,g,b], strength}]
groups 的 start/count 以頂點為單位；color 是線性 RGB；doubleSided 沒給就當雙面。
不是雙面的群組（doubleSided 為 false）照重播頁的 FrontSide 畫：每個視角各自先把背向相機的三角形從場景裡拿掉，再交給 Cycles
（Cycles 本身沒有背面剔除；拿掉的三角形不會留在場景裡，也就不會擋光、擋射線或進降噪）。
判定用繞序法線 n＝(v1−v0)×(v2−v0)，和 three.js 的 FrontSide 同一個依據（繞序在畫面上是逆時針＝朝向相機）：
  透視相機：dot(n, 三角形中心 − 相機位置) ≥ 0 就剔掉；
  正交相機：dot(n, 相機前方) ≥ 0 就剔掉。
所以圖上看得到的面就是重播頁畫得出來的面（少一面的封口會看到破洞）。每個群組剔除前後的三角形數印在 log 的 CULL 行。
相機方位角 azimuth＝相機在目標的哪個羅盤方向（北＝0、東＝90）。
"""
import json
import math
import sys

import bpy
import numpy as np
from mathutils import Vector


def camera_pose(c):
    """相機設定 → (目標, 相機位置, 相機前方單位向量)。"""
    az, el = math.radians(c['azimuth']), math.radians(c['elevation'])
    tgt = Vector(c['target'])
    off = Vector((math.cos(el) * math.sin(az), math.cos(el) * math.cos(az), math.sin(el))) * c['distance']
    loc = tgt + off
    return tgt, loc, (tgt - loc).normalized()


def facing_camera(tri, loc, fwd, ortho):
    """tri：[T,3,3] 三角形頂點。回傳 bool[T]：朝向相機（FrontSide 會畫）的為 True。
    繞序法線不必正規化，只看正負：透視 dot(n, 中心 − 相機位置) < 0、正交 dot(n, 前方) < 0 才保留。"""
    n = np.cross(tri[:, 1] - tri[:, 0], tri[:, 2] - tri[:, 0])
    if ortho:
        s = n @ np.array(fwd, dtype=np.float64)
    else:
        s = np.einsum('ij,ij->i', n, tri.mean(axis=1) - np.array(loc, dtype=np.float64))
    return s < 0


def build_object(name, verts, rgb, rough, opacity):
    n = len(verts)
    me = bpy.data.meshes.new(name)
    me.from_pydata([tuple(map(float, v)) for v in verts], [], [(i, i + 1, i + 2) for i in range(0, n, 3)])
    me.update()
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    p = m.node_tree.nodes['Principled BSDF']
    p.inputs['Base Color'].default_value = (rgb[0], rgb[1], rgb[2], 1.0)
    p.inputs['Roughness'].default_value = rough
    p.inputs['Alpha'].default_value = opacity
    m.diffuse_color = (rgb[0], rgb[1], rgb[2], 1.0)
    me.materials.append(m)
    o = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(o)
    return o


def render(v):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    sc.cycles.device = 'CPU'
    sc.cycles.samples = v.get('samples', 48)
    sc.cycles.use_denoising = True
    sc.cycles.max_bounces = 6
    sc.cycles.transparent_max_bounces = 16
    sc.render.resolution_x, sc.render.resolution_y, sc.render.resolution_percentage = v['size'][0], v['size'][1], 100
    sc.view_settings.view_transform = 'Standard'
    sc.render.image_settings.file_format = 'PNG'
    w = bpy.data.worlds.new('sky')
    sc.world = w
    w.use_nodes = True
    bg = w.node_tree.nodes['Background']
    sky = v.get('sky', [0.80, 0.84, 0.90])
    bg.inputs[0].default_value = (sky[0], sky[1], sky[2], 1.0)
    bg.inputs[1].default_value = v.get('strength', 1.0)

    c = v['camera']
    tgt, loc, fwd = camera_pose(c)
    ortho = bool(c.get('ortho'))
    arr = np.load(v['mesh'])
    pos = arr[:, :3].astype(np.float64)
    for g in v['groups']:
        if g['count'] == 0:
            continue
        tri = pos[g['start']:g['start'] + g['count']].reshape(-1, 3, 3)
        if not g.get('doubleSided', True):
            keep = facing_camera(tri, loc, fwd, ortho)
            print('CULL', v['name'], g['name'], f'保留 {int(keep.sum())}/{len(tri)}', flush=True)
            tri = tri[keep]
            if len(tri) == 0:
                continue
        build_object(g['name'], tri.reshape(-1, 3), g['color'], g['roughness'], g['opacity'])

    sun_dir = Vector(v.get('sun', [-0.4, -0.5, 0.8]))
    d = bpy.data.lights.new('sun', 'SUN')
    d.energy = v.get('sun_energy', 3.5)
    d.angle = math.radians(3.0)
    o = bpy.data.objects.new('sun', d)
    sc.collection.objects.link(o)
    o.rotation_euler = (-sun_dir).to_track_quat('-Z', 'Y').to_euler()

    cd = bpy.data.cameras.new('cam')
    co = bpy.data.objects.new('cam', cd)
    sc.collection.objects.link(co)
    sc.camera = co
    co.location = loc
    co.rotation_euler = (tgt - co.location).to_track_quat('-Z', 'Y').to_euler()
    cd.clip_start = c.get('clip_start', 0.5)
    cd.clip_end = c.get('clip_end', max(2000.0, c['distance'] * 4))
    if ortho:
        cd.type = 'ORTHO'
        cd.ortho_scale = c['ortho']
    else:
        cd.lens = c.get('lens', 35.0)
        cd.sensor_width = 36.0
    sc.render.filepath = v['out']
    bpy.ops.render.render(write_still=True)
    print('RENDERED', v['name'], v['out'], flush=True)


def main():
    views = json.load(open(sys.argv[sys.argv.index('--') + 1], encoding='utf-8'))
    for v in views:
        render(v)


main()
