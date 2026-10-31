"""EMU3000 車門算繪共用工具：單一帶陰影太陽燈＋固定俯角正交相機。
build_doors.py（FLEET_RENDER=1 段）與 render_baseline.py 共用，確保「改動前後」對照用同一套
相機／燈光參數，比較才有意義。不含任何幾何建造邏輯，只管算繪場景設置。

座標慣例沿用主腳本：+X 車前、+Y 左、+Z 上、輪底 z=0；side∈{-1,1} 對應車門所在那一側。
"""
import math
import bpy
from mathutils import Vector

PITCH_DEG = 13.0        # 外觀相機俯角（鐵則要求 10~15°，取中間值）
EXT_HORIZ = (1.0, 4.2)  # 外觀視角水平位移量值 (dx, dy)；dy 實際套用時乘上 side 決定左右

__all__ = ['PITCH_DEG', 'EXT_HORIZ', 'setup_sun', 'exterior_eye', 'make_camera', 'view', 'render']


def setup_sun(p, energy=3.2, angle_deg=4.0):
    """建一盞帶陰影的太陽燈（取代舊版三盞攝影棚平光燈）；world 背景給極低強度的冷灰當環境補光，
    避免陰影側死黑看不出細節，但主要明暗仍由這盞太陽燈決定，符合「單一帶陰影太陽燈」的要求。"""
    data = bpy.data.lights.new('驗收太陽燈', 'SUN')
    data.energy = energy
    data.angle = math.radians(angle_deg)  # 角直徑：越小陰影邊緣越銳利
    o = bpy.data.objects.new('驗收太陽燈', data)
    p.ACTIVE.objects.link(o)
    # 從相機左後上方斜射進門口，讓門洞內部與門扇／壁袋交界處有明確陰影，看得出深度。
    o.rotation_euler = (math.radians(58), 0, math.radians(-40))

    world = p.SCENE.world
    if world is None:
        world = bpy.data.worlds.new('驗收世界')
        p.SCENE.world = world
    world.use_nodes = True
    bg = world.node_tree.nodes.get('Background')
    if bg:
        bg.inputs['Color'].default_value = (.16, .17, .19, 1)
        bg.inputs['Strength'].default_value = .35
    return o


def exterior_eye(target, fside, pitch_deg=PITCH_DEG, horiz=EXT_HORIZ):
    """外觀視角相機位置：略高於 target 高度、往下俯角 pitch_deg 度看，水平方向 fside 決定左右。"""
    dx, dy_mag = horiz
    horiz_dist = math.hypot(dx, dy_mag)
    dz = horiz_dist * math.tan(math.radians(pitch_deg))
    return target + Vector((dx, fside * dy_mag, dz))


def make_camera(p, scene, name='門驗收相機'):
    camdata = bpy.data.cameras.new(name)
    camera = bpy.data.objects.new(name, camdata)
    p.ACTIVE.objects.link(camera)
    scene.camera = camera
    camdata.type = 'ORTHO'
    return camera, camdata


def view(camera, camdata, scene, loc, target, scale, res=(1000, 800)):
    camera.location = Vector(loc)
    camera.rotation_euler = (Vector(target) - camera.location).to_track_quat('-Z', 'Y').to_euler()
    camdata.ortho_scale = scale
    scene.render.resolution_x, scene.render.resolution_y = res
    scene.render.resolution_percentage = 100


def render(scene, path):
    scene.render.filepath = str(path)
    bpy.ops.render.render(write_still=True)
