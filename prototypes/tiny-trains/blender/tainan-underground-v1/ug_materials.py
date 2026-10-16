"""地下結構的材質表（sRGB 十六進位＋粗糙度／金屬度／不透明度），寫法比照 tainan-memory-v1/materials.py。

顏色是為了「隔著半透明殼看地下」挑的：殼用偏冷的淡藍灰，B1 樓板用淡綠，才分得出兩層；
不透明構件（地板、月台、U 槽）用三種彼此拉開明度的灰與米色，從上方斜看時軌道面、月台頂、牆頂不會混成一片。
顏色與不透明度都是外觀選擇，不是實測。
"""

# key: (sRGB hex, roughness, metalness, opacity, doubleSided, 說明)
MATS = {
    'ug_floor':        ('4E5258', 0.92, 0.00, 1.00, False, '隧道與站體地板（軌道面高程，深灰）'),
    'ug_trough_floor': ('6A5F55', 0.92, 0.00, 1.00, False, '引道 U 槽地板（軌道面高程，灰褐）'),
    'ug_trough':       ('B8B3A8', 0.95, 0.00, 1.00, False, '引道 U 槽牆與洞口上方的牆（實心，淺水泥色）'),
    'ug_platform':     ('D2C28F', 0.85, 0.00, 1.00, False, '島式月台（實心，米黃）'),
    'ug_b1':           ('5FB59A', 0.80, 0.00, 0.34, False, '站體 B1 樓板（半透明，淡綠；上下兩面都畫）'),
    'ug_shell':        ('7FA6D6', 0.85, 0.00, 0.20, True, '隧道殼與站體殼（半透明，淡藍；只畫外側面）'),
}

# drawGroups 的順序＝繪製順序：不透明的先畫（寫深度），半透明的 B1、殼最後畫，殼在最外層所以最後。
ORDER = ['ug_floor', 'ug_trough_floor', 'ug_trough', 'ug_platform', 'ug_b1', 'ug_shell']


def srgb_to_linear(h):
    out = []
    for i in (0, 2, 4):
        v = int(h[i:i + 2], 16) / 255.0
        out.append(v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4)
    return out
