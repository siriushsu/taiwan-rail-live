"""Blender 背景模式算圖：依 views.json 把三角形湯畫成 PNG。只在 Blender 內執行（只用 bpy＋numpy）。

用法（preview.py 呼叫）：
  Blender -b --python preview_blender.py -- views.json
views.json：[{name, out, size:[w,h], samples, mesh:'.npy 路徑 float32 [N,6]', groups:[{name,color,roughness,opacity,start,count}],
              camera:{target:[x,y,z], azimuth, elevation, distance, lens, ortho}, sun:[x,y,z], sky:[r,g,b], strength}]
groups 的 start/count 以頂點為單位；color 是線性 RGB；doubleSided 沒給就當雙面。
不是雙面的群組（doubleSided 為 false）照重播頁的 FrontSide 畫：背面完全透明、射線穿過去，所以圖上看得到的面就是重播頁畫得出來的面（少一面的封口會看到破洞）。
相機方位角 azimuth＝相機在目標的哪個羅盤方向（北＝0、東＝90）。
"""
import json
import math
import sys

import bpy
import numpy as np
from mathutils import Vector


def build_object(name, verts, rgb, rough, opacity, double=True):
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
    if not double:
        nt = m.node_tree
        geo, tr, mix = nt.nodes.new('ShaderNodeNewGeometry'), nt.nodes.new('ShaderNodeBsdfTransparent'), nt.nodes.new('ShaderNodeMixShader')
        nt.links.new(geo.outputs['Backfacing'], mix.inputs[0])
        nt.links.new(p.outputs['BSDF'], mix.inputs[1])
        nt.links.new(tr.outputs['BSDF'], mix.inputs[2])
        nt.links.new(mix.outputs['Shader'], nt.nodes['Material Output'].inputs['Surface'])
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

    arr = np.load(v['mesh'])
    pos = arr[:, :3].astype(np.float64)
    for g in v['groups']:
        if g['count'] == 0:
            continue
        build_object(g['name'], pos[g['start']:g['start'] + g['count']], g['color'], g['roughness'], g['opacity'], g.get('doubleSided', True))

    sun_dir = Vector(v.get('sun', [-0.4, -0.5, 0.8]))
    d = bpy.data.lights.new('sun', 'SUN')
    d.energy = v.get('sun_energy', 3.5)
    d.angle = math.radians(3.0)
    o = bpy.data.objects.new('sun', d)
    sc.collection.objects.link(o)
    o.rotation_euler = (-sun_dir).to_track_quat('-Z', 'Y').to_euler()

    c = v['camera']
    az, el = math.radians(c['azimuth']), math.radians(c['elevation'])
    tgt = Vector(c['target'])
    off = Vector((math.cos(el) * math.sin(az), math.cos(el) * math.cos(az), math.sin(el))) * c['distance']
    cd = bpy.data.cameras.new('cam')
    co = bpy.data.objects.new('cam', cd)
    sc.collection.objects.link(co)
    sc.camera = co
    co.location = tgt + off
    co.rotation_euler = (tgt - co.location).to_track_quat('-Z', 'Y').to_euler()
    cd.clip_start = c.get('clip_start', 0.5)
    cd.clip_end = c.get('clip_end', max(2000.0, c['distance'] * 4))
    if c.get('ortho'):
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
