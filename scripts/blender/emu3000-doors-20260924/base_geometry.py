"""EMU3000 基準幾何。2026-11-06 起車殼與車側改由 head_v3.py 重建（舊版是 b.passenger(spec) 的方盒車頭加日立貼片，
見 git 歷史）；這支留著同一個入口，build_doors.py、render_baseline.py 不用改呼叫方式。
"""
import head_v3


def build_baseline(p, b, S):
    """回傳 (spec, L, W_, H)。呼叫前 caller 需自行 import bpy 並確保 p/b 模組已從快照目錄載入。"""
    spec = dict(S['emu3000'])
    spec['revision'] = '2026-11-06-face-r1'
    p.reset(spec)
    head_v3.build(p, b, spec)
    return spec, spec['L'], spec['W'], spec['H']
