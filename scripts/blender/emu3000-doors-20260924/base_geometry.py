"""EMU3000 基準幾何重建：b.passenger(spec) ＋ emu3000-20260912/refine.py 的日立前窗修訂。
從 build_doors.py 抽出（round 2 新增），讓 render_baseline.py（算「改動前」快照對照圖用）能重建
逐位元相同的基準幾何，不必複製貼上、避免兩份程式碼日後漂移出不同結果。
逐字複製 emu3000-20260912/refine.py 的內容，不 import 它——它是唯讀參考，且它的 out 參數與
匯出流程與本輪不同。
"""


def build_baseline(p, b, S):
    """回傳 (spec, L, W_, H)。呼叫前 caller 需自行 import bpy 並確保 p/b 模組已從快照目錄載入。"""
    spec = dict(S['emu3000'])
    spec['revision'] = '2026-09-24-doors-r1'
    p.reset(spec)
    b.passenger(spec)

    L, W_, H = spec['L'], spec['W'], spec['H']

    import bpy  # noqa: 延遲 import——bpy 只存在於 Blender 行程內，呼叫時機才需要

    def _apply_hitachi_nose_patch():
        prefixes = ('EMU3000 連續黑面罩', '流線前窗', 'EMU3000 額頭', 'EMU3000 頭燈',
                    'EMU3000 車鉤蓋', '獨立雨刷臂', '雨刷膠條')
        for o in list(p.MODEL):
            if o.name.startswith(prefixes):
                p.MODEL.remove(o)
                bpy.data.objects.remove(o, do_unlink=True)

        profile = [(.83, L / 2 - .12), (1.2, L / 2), (1.8, L / 2 - .13), (2.70, L / 2 - .48), (H, L / 2 - .86)]

        def f(y, z):
            return b.interp(profile, z) - .08 * (abs(y) / (W_ / 2)) ** 4

        def patch(name, prof, material, offset):
            p.use('03')
            rows = 28
            cols = 20
            verts = []
            for d in [-.006, .006]:
                for i in range(rows + 1):
                    z = prof[0][0] + (prof[-1][0] - prof[0][0]) * i / rows
                    half = b.interp(prof, z)
                    for j in range(cols + 1):
                        y = half * (2 * j / cols - 1)
                        verts.append((f(y, z) + offset + d, y, z))
            n = (rows + 1) * (cols + 1)
            faces = []
            for i in range(rows):
                for j in range(cols):
                    a = i * (cols + 1) + j
                    c = a + cols + 1
                    faces.extend([(a, a + 1, c + 1, c), (n + a, n + c, n + c + 1, n + a + 1)])
            edge = (list(range(cols + 1)) + [i * (cols + 1) + cols for i in range(1, rows + 1)] +
                    list(range(rows * (cols + 1) + cols - 1, rows * (cols + 1) - 1, -1)) +
                    [i * (cols + 1) for i in range(rows - 1, 0, -1)])
            faces.extend((a, n + a, n + c, c) for a, c in zip(edge, edge[1:] + edge[:1]))
            return p.mesh(name, verts, faces, material, 0, True)

        patch('EMU3000 向下收尖曲面黑面罩',
              [(1.53, .12), (1.56, .37), (1.64, .66), (1.82, .88), (2.12, 1.03), (2.65, 1.25), (3.08, 1.31),
               (3.23, 1.21), (3.31, .93), (3.34, .30)], 'frame', .032)
        patch('EMU3000 上寬下窄前窗膠邊', [(2.12, .60), (2.17, .70), (2.88, 1.04), (2.94, 1.02)], 'chassis', .054)
        patch('EMU3000 梯形駕駛前窗', [(2.18, .59), (2.22, .65), (2.85, .96), (2.88, .94)], 'glass', .077)

        b.front_panel('EMU3000 額頭燈座', f, 0, 3.12, .63, .29, 'chassis', .04, .064)
        for y in [-.16, .16]:
            p.lamp('EMU3000 額頭圓燈', f, y, 3.12, .074)
        for side in [-1, 1]:
            b.front_panel('EMU3000 腰燈膠框', f, side * .79, 1.98, .34, .43, 'chassis', .08, .060)
            b.front_panel('EMU3000 腰燈暗色罩', f, side * .79, 1.98, .29, .38, 'glass', .065, .085)
            p.lamp('EMU3000 腰部白燈', lambda y, z: f(y, z) + .025, side * .79, 2.065, .065)
            p.lamp('EMU3000 腰部紅標誌燈', lambda y, z: f(y, z) + .025, side * .79, 1.905, .044, True)

        b.front_ribbon('EMU3000 U形車鉤蓋縫', f,
                        [(-.84, 1.79), (-.84, 1.48), (-.81, 1.12), (-.68, .94), (-.40, .89), (0, .88), (.40, .89),
                         (.68, .94), (.81, 1.12), (.84, 1.48), (.84, 1.79)], .008, 'metal')

        def pt(y, z):
            return (f(y, z) + .13, y, z)

        p.use('03')
        for dy in [-.026, .026]:
            p.line('EMU3000 中央雨刷連桿', [pt(dy, 2.16), pt(.57 + dy, 2.32), pt(.70 + dy, 2.64)], .010, 'chassis')
        p.line('EMU3000 單組雨刷膠條', [pt(.62, 2.27), pt(.80, 2.77)], .017, 'frame')

    _apply_hitachi_nose_patch()
    return spec, L, W_, H
