"""把 Geo 三角形湯載入 Blender 場景並算圖（對照照片用）。只在 Blender 內執行。"""
import math
import bpy
from mathutils import Vector
from materials import MATS, srgb_to_linear


def _material(key):
    h, rough, metal, opacity, _ = MATS[key]
    rgb = srgb_to_linear(h)
    m = bpy.data.materials.new(key)
    m.use_nodes = True
    p = m.node_tree.nodes['Principled BSDF']
    p.inputs['Base Color'].default_value = (*rgb, 1.0)
    p.inputs['Roughness'].default_value = rough
    p.inputs['Metallic'].default_value = metal
    p.inputs['Alpha'].default_value = opacity
    m.diffuse_color = (*rgb, 1.0)
    return m


def add_geo(G, lods, prefix='geo', only=None):
    """每種材質一個物件；只收 lods 內的 LOD 標籤。回傳物件清單。"""
    by = {}
    for (mat, lod), buf in G.buf.items():
        if lod in lods and (only is None or mat in only):
            by.setdefault(mat, []).extend(buf)
    objs = []
    for mat, buf in by.items():
        n = len(buf) // 6
        verts = [tuple(buf[i * 6:i * 6 + 3]) for i in range(n)]
        norms = [tuple(buf[i * 6 + 3:i * 6 + 6]) for i in range(n)]
        me = bpy.data.meshes.new(f'{prefix}-{mat}')
        me.from_pydata(verts, [], [(i, i + 1, i + 2) for i in range(0, n, 3)])
        me.update()
        me.polygons.foreach_set('use_smooth', [True] * len(me.polygons))
        me.normals_split_custom_set_from_vertices(norms)
        me.materials.append(_material(mat))
        o = bpy.data.objects.new(f'{prefix}-{mat}', me)
        bpy.context.scene.collection.objects.link(o)
        objs.append(o)
    return objs


def setup(width=1600, height=1067, samples=48):
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    sc.cycles.device = 'CPU'
    sc.cycles.samples = samples
    sc.cycles.use_denoising = True
    sc.cycles.max_bounces = 4
    sc.render.resolution_x, sc.render.resolution_y, sc.render.resolution_percentage = width, height, 100
    sc.view_settings.view_transform = 'Standard'
    sc.render.image_settings.file_format = 'PNG'
    w = bpy.data.worlds.new('sky')
    sc.world = w
    w.use_nodes = True
    bg = w.node_tree.nodes['Background']
    bg.inputs[0].default_value = (0.62, 0.74, 0.95, 1.0)
    bg.inputs[1].default_value = 1.05
    return sc


def add_ground(size=400.0, color=(0.36, 0.36, 0.34, 1.0)):
    me = bpy.data.meshes.new('ground')
    me.from_pydata([(-size, -size, -0.02), (size, -size, -0.02), (size, size, -0.02), (-size, size, -0.02)], [], [(0, 1, 2, 3)])
    o = bpy.data.objects.new('ground', me)
    bpy.context.scene.collection.objects.link(o)
    m = bpy.data.materials.new('ground')
    m.use_nodes = True
    p = m.node_tree.nodes['Principled BSDF']
    p.inputs['Base Color'].default_value = color
    p.inputs['Roughness'].default_value = 0.95
    me.materials.append(m)
    return o


def add_sun(direction_from, energy=3.6, angle_deg=3.0):
    """direction_from：太陽所在方位（由目標指向太陽的向量）。"""
    d = bpy.data.lights.new('sun', 'SUN')
    d.energy = energy
    d.angle = math.radians(angle_deg)
    o = bpy.data.objects.new('sun', d)
    bpy.context.scene.collection.objects.link(o)
    o.rotation_euler = (-Vector(direction_from)).to_track_quat('-Z', 'Y').to_euler()
    return o


def add_camera(loc, target, lens=35.0, ortho=None, clip_end=600.0):
    d = bpy.data.cameras.new('cam')
    o = bpy.data.objects.new('cam', d)
    bpy.context.scene.collection.objects.link(o)
    bpy.context.scene.camera = o
    o.location = loc
    o.rotation_euler = (Vector(target) - Vector(loc)).to_track_quat('-Z', 'Y').to_euler()
    d.clip_end = clip_end
    d.clip_start = 0.1
    if ortho:
        d.type = 'ORTHO'
        d.ortho_scale = ortho
    else:
        d.lens = lens
        d.sensor_width = 36.0
    return o


VIEWS = {
    # 與 refs/01 同框：正立面正投影（畫面寬 55 m、原點在中軸右 3.2 m、地面在畫面下緣約 6%）
    'front': dict(loc=(2.9, -90.0, 16.1), target=(2.9, 0.0, 16.1), ortho=55.0, size=(1600, 1067), sun=(-0.55, -0.75, 0.6)),
    # 與 refs/02 相近：站在左前方看斜角
    'oblique': dict(loc=(-27.0, -36.0, 3.4), target=(-1.0, -11.0, 6.0), lens=26.0, size=(1600, 1200), sun=(-0.4, -0.8, 0.55)),
    # 與 refs/03 相近：站在右前方（南側）仰看外罩
    'wrap': dict(loc=(22.0, -30.0, 2.0), target=(-2.0, -8.0, 8.5), lens=24.0, size=(1600, 1200), sun=(0.15, -0.9, 0.5)),
    # 頁面近景視角：站房局部座標的 (+X,-Y) 象限、仰角約 40°（頁面 rotationDeg -102、相機在西南方）
    'page': dict(loc=(51.0, -33.0, 56.0), target=(0.0, 6.0, 4.0), ortho=62.0, size=(1600, 1000), sun=(-0.6, -0.5, 0.9)),
    # 除錯用近景
    'porch': dict(loc=(-13.0, -25.0, 2.6), target=(-1.5, -12.0, 3.4), lens=32.0, size=(1600, 1000), sun=(-0.4, -0.8, 0.55)),
    'top': dict(loc=(4.0, -30.0, 14.0), target=(-0.3, -11.0, 10.0), lens=45.0, size=(1600, 1000), sun=(-0.3, -0.8, 0.6)),
    'right': dict(loc=(38.0, -24.0, 3.0), target=(8.0, -4.0, 4.5), lens=28.0, size=(1600, 1000), sun=(0.6, -0.6, 0.6)),
    'back': dict(loc=(20.0, 52.0, 9.0), target=(-2.0, 12.0, 4.5), lens=30.0, size=(1600, 1000), sun=(0.4, 0.8, 0.6)),
}


def render_view(name, path, samples=48):
    v = VIEWS[name]
    sc = setup(*v['size'], samples=samples)
    add_ground()
    add_sun(v['sun'])
    add_camera(v['loc'], v['target'], lens=v.get('lens', 35.0), ortho=v.get('ortho'))
    sc.render.filepath = path
    bpy.ops.render.render(write_still=True)
    return path
