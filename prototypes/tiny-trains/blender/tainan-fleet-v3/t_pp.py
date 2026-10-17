"""推拉式自強號 PP 客車（不銹鋼＋橘色窗帶）與莒光號客車（上半米黃、下半橘、中間一條白線）。

已查證：PP 客車 PPT1000 長 20,300（性質同 pitch，body≈pitch−700）、寬 2,885、高 4,043；上下台門滑塞式、設在前後兩端；
「5 大窗相鄰＋最前與最後各 1 半開窗」；車頂兩端各有頂製型空調；不銹鋼車身、窗附近橘色帶、窗下方及車體下緣紅色細線；
靠機車端面拆除風擋（本檔 ppcoach-end：機車端不畫折棚）。
莒光客車 FPK10400 系：長 20,000（當 pitch）、寬 2,885~2,980（取 2,900）、高 3,800；每側 2 門、5 大窗＋兩端半開窗；
空調機設在客室前後兩端（未緊貼車端）；塗裝照參考照片 t04（2013 新左營 FPK10425）與 t06（2019 彰化 E223 後接客車）：窗帶以上米黃、白線以下橘色；
查證筆記 5.4 的「橘色車身＋1 條白線」是維基次要來源對電氣化當年改塗的描述，兩張有日期的照片都不是全橘，主對話 2026-09-29 裁定照照片。
推斷／照片估計：窗與門精確位置、半開窗與小窗尺寸、冷氣機外形（照片為長方盒）、車下設備。
"""
from common import *

STEEL = C('#a8aaa2')
STEEL_D = C('#999b93')
SKIRT = C('#5a5d5c')
ORANGE = C('#e5641f')
REDLINE = C('#8e2b22')


def pp_spec():
    ZL, ZH = 1.70, 2.60
    return dict(
        id='ppcoach', W=2.885, body=19.6, pitch=20.3, zb=1.00,
        profile=lambda lod: Profile(hw=1.4425, zb=1.00, z_sh=3.45, z_c=3.85, inset=0.10, cham=0.10, z_belt=1.6,
                                    K=6 if lod == 0 else 3, pieces=2 if lod == 0 else 1),
        band=Band([(0.0, 1.06, SKIRT), (1.36, 1.44, REDLINE), (1.56, 2.80, ORANGE)], STEEL, g=0.35),
        roof_col=C('#8f918c'),
        kinds=lambda lod: {**win_kinds(ZL, ZH), **win_kinds(1.85, 2.48, prefix='sm'),
                           'door': [(1.06, 3.10, STEEL_D, 0.3)], 'dgap': [(1.04, 3.12, GAP, 0.2)],
                           'dwin': [(1.85, 2.75, GLASS, 0.9)], 'frost': [(1.85, 2.45, C('#8b979f'), 0.6)],
                           'winband': [(ZL - 0.035, ZH + 0.035, GLASS, 0.8)]},
        bellows=dict(w=2.0, z0=1.10, z1=3.25),
        bogie_x=7.0, wb=2.5,
    )


def ju_spec():
    ZL, ZH = 1.72, 2.55
    return dict(
        id='juguang', W=2.90, body=19.3, pitch=20.0, zb=1.00,
        profile=lambda lod: Profile(hw=1.45, zb=1.00, z_sh=3.32, z_c=3.65, inset=0.08, cham=0.10, z_belt=1.6,
                                    K=6 if lod == 0 else 3, pieces=2 if lod == 0 else 1),
        band=Band([(0.0, 1.06, SKIRT), (1.50, 1.60, C('#f1efe6')), (1.60, 9.0, C('#e7d9b9'))], C('#dc5a1e'), g=0.35),
        roof_col=C('#8d908c'),
        kinds=lambda lod: {**win_kinds(ZL, ZH), **win_kinds(1.85, 2.42, prefix='sm'),
                           'door': [(1.06, 3.05, C('#cf541b'), 0.3)], 'dgap': [(1.04, 3.07, GAP, 0.2)],
                           'dwin': [(1.85, 2.72, GLASS, 0.9)], 'frost': [(1.85, 2.42, C('#8b979f'), 0.6)],
                           'winband': [(ZL - 0.035, ZH + 0.035, GLASS, 0.8)]},
        bellows=dict(w=2.0, z0=1.10, z1=3.15),
        bogie_x=6.9, wb=2.5,
    )


def coach_end(e0, lod, kind_door=True):
    """一端（距該端的距離 e）：門、小窗、半開窗。回傳 (a,b,kind) 元素（e 座標）。"""
    el = []
    # 門（1.45 寬，含窄門窗）
    if lod == 0:
        el += [(e0 + 0.30, e0 + 0.335, 'dgap'), (e0 + 1.715, e0 + 1.75, 'dgap'), (e0 + 0.55, e0 + 0.95, ('dwin', 'door'))]
    el += [(e0 + 0.30, e0 + 1.75, 'door')]
    if lod == 0:
        el += [(e0 + 2.45, e0 + 3.05, 'frost'),
               (e0 + 3.60 - 0.035, e0 + 3.60, 'sm_f'), (e0 + 3.60, e0 + 4.30, 'sm_g'), (e0 + 4.30, e0 + 4.335, 'sm_f')]
    return el


def coach_elems(Lb, lod, first_big):
    hx = Lb / 2
    el = []
    for (a, b, k) in coach_end(0, lod):
        el.append((-hx + a, -hx + b, k))
        el.append((hx - b, hx - a, k))
    if lod == 0:
        for i in range(5):
            x0 = -hx + first_big + i * 2.1
            el += [(x0 - 0.035, x0, 'win_f'), (x0, x0 + 1.7, 'win_g'), (x0 + 1.7, x0 + 1.735, 'win_f')]
    else:
        el += [(-hx + first_big, -hx + first_big + 10.1, 'winband')]
    return el


def roof_pp(m, sp, lod):
    zc = 3.85
    acol, atop = C('#a3a6a1'), C('#b4b8b6')
    for xc in (-6.6, 6.6):
        roof_unit(m, xc, 0, zc - 0.03, 3.2, 1.45, 0.22, acol, top=atop, bevel=0.14, vent=(lod == 0))


def roof_ju(m, sp, lod):
    zc = 3.65
    acol, atop = C('#9ea19c'), C('#adb0ab')
    for xc in (-5.6, 5.6):
        roof_unit(m, xc, 0, zc - 0.03, 3.0, 1.35, 0.18, acol, top=atop, bevel=0.12, vent=(lod == 0))


BELLY = [(-3.6, 1.7, 0.46, 1.0, 1.10), (-1.2, 1.0, 0.50, 1.0, 1.0), (1.4, 2.0, 0.48, 1.0, 1.12), (3.7, 1.4, 0.50, 1.0, 1.05)]


def build_pp(lod, hi_bellows=True):
    sp = pp_spec()
    m = build_mid(sp, lod, coach_elems(19.6, lod, 4.75), roof_fn=roof_pp, belly_items=BELLY, hi_bellows=hi_bellows)
    return m, sp


def build_ju(lod):
    sp = ju_spec()
    m = build_mid(sp, lod, coach_elems(19.3, lod, 4.6), roof_fn=roof_ju, belly_items=BELLY)
    return m, sp


BUILDERS = {
    'ppcoach': lambda lod: build_pp(lod, True),
    'ppcoach-end': lambda lod: build_pp(lod, False),
    'juguang': build_ju,
}
