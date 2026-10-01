#!/usr/bin/env python3
"""乘車導覽發布影片的配樂（輕快版）：150 BPM、D 大調，馬林巴、鐵琴、電鋼琴反拍與沙鈴，重音對準剪接點。

全部用程式合成（鼓、貝斯、和弦、鐵琴、音效都是數學產生），沒有取樣、沒有外部音檔，所以沒有授權問題。
刻意不用低頻撞擊與厚重合成器：剪接點用輕的鈸、拍手與鐵琴和弦標出來。
剪接點與 film.html 的 WARP 是同一份時間表：一拍 0.4 秒、一小節 1.6 秒，強拍在 0.8＋1.6k 秒。

用法：python3 prototypes/ride-guide/film/score.py [輸出.wav]
      預設輸出 prototypes/ride-guide/_video/score.wav（不進版控），需要 numpy、scipy。
"""
import sys
import wave
from pathlib import Path

import numpy as np
from scipy import signal

SR = 48000
DUR = 58.0
N = int(SR * DUR)
BEAT, BAR, D0 = 0.4, 1.6, 0.8
S16 = BEAT / 4
rng = np.random.default_rng(20261001)


def bar(k):
    return D0 + BAR * k


def mtof(m):
    return 440.0 * 2 ** ((m - 69) / 12)


def tt(dur):
    return np.arange(int(dur * SR)) / SR


def noise(dur):
    return rng.standard_normal(int(dur * SR))


def sos(kind, f, order=2):
    nyq = SR / 2 * 0.95
    f = np.clip(f, 20, nyq) if np.ndim(f) else min(max(f, 20), nyq)
    return signal.butter(order, f, kind, fs=SR, output='sos')


def filt(x, kind, f, order=2):
    return signal.sosfilt(sos(kind, f, order), x)


def tvfilt(x, fc, kind='lowpass', q=1.4, block=256):
    """隨時間變化的濾波器：fc 是每個取樣點的截止頻率（逐塊更新係數）。"""
    y = np.zeros_like(x)
    zi = None
    for i in range(0, len(x), block):
        f = float(fc[min(i + block // 2, len(fc) - 1)])
        s = sos('bandpass', [f / q, f * q]) if kind == 'bandpass' else sos(kind, f)
        if zi is None or zi.shape[0] != s.shape[0]:
            zi = np.zeros((s.shape[0], 2))
        y[i:i + block], zi = signal.sosfilt(s, x[i:i + block], zi=zi)
    return y


def saw(freq, dur):
    """polyBLEP 鋸齒波（不刺耳的鋸齒），freq 可以是常數或逐點陣列。"""
    n = int(dur * SR)
    f = np.full(n, freq, dtype=float) if np.ndim(freq) == 0 else np.asarray(freq, dtype=float)[:n]
    dt = f / SR
    ph = (rng.random() + np.cumsum(dt)) % 1.0
    y = 2 * ph - 1
    m = ph < dt
    x = ph[m] / dt[m]
    y[m] -= x + x - x * x - 1
    m = ph > 1 - dt
    x = (ph[m] - 1) / dt[m]
    y[m] -= x * x + x + x + 1
    return y


def env_ar(n, a, r, hold=0.0):
    t = np.arange(n) / SR
    e = np.minimum(1, t / max(a, 1e-4))
    rel = t > (n / SR - r)
    e[rel] *= np.clip((n / SR - t[rel]) / max(r, 1e-4), 0, 1)
    return e


# ───────────── 匯流排 ─────────────
BUS = {k: np.zeros((2, N)) for k in ('drums', 'music', 'fx', 'verb')}
KICKS = []


def add(bus, x, t0, gain=1.0, pan=0.0, verb=0.0):
    i = int(round(t0 * SR))
    if i >= N:
        return
    x = np.asarray(x, dtype=float)
    if x.ndim == 1:
        a = (pan + 1) * np.pi / 4
        x = np.vstack([x * np.cos(a), x * np.sin(a)]) * np.sqrt(2)
    j0 = max(0, -i)
    i0 = max(0, i)
    n = min(x.shape[1] - j0, N - i0)
    if n <= 0:
        return
    BUS[bus][:, i0:i0 + n] += x[:, j0:j0 + n] * gain
    if verb:
        BUS['verb'][:, i0:i0 + n] += x[:, j0:j0 + n] * gain * verb


# ───────────── 打擊（輕巧的流行樂鼓組，沒有低頻撞擊） ─────────────
def mk_kick():
    t = tt(0.3)
    f = 56 + 95 * np.exp(-t / 0.022)
    body = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / 0.16) * (1 - np.exp(-t / 0.0015))
    click = filt(noise(0.3) * np.exp(-t / 0.0015), 'highpass', 2500) * 0.35
    return np.tanh(1.2 * (body + click)) * 0.85


def mk_clap():
    t = tt(0.35)
    e = np.zeros(len(t))
    for d in (0, 0.009, 0.019):
        m = t >= d
        e[m] += np.exp(-(t[m] - d) / 0.006) * 0.8
    m = t >= 0.027
    e[m] += np.exp(-(t[m] - 0.027) / 0.07)
    return filt(noise(0.35) * e, 'bandpass', [1100, 7000]) * 0.9


def mk_snap():
    t = tt(0.12)
    x = filt(noise(0.12), 'bandpass', [1800, 5500]) * np.exp(-t / 0.018)
    x += np.sin(2 * np.pi * 2300 * t) * np.exp(-t / 0.008) * 0.3
    return x


def mk_shaker():
    t = tt(0.1)
    return filt(noise(0.1), 'bandpass', [5000, 12000]) * np.minimum(1, t / 0.006) * np.exp(-t / 0.03)


def mk_tamb():
    t = tt(0.25)
    x = filt(noise(0.25), 'highpass', 6500) * np.exp(-t / 0.07)
    for f in (5230, 7120, 8870):
        x += np.sin(2 * np.pi * f * t + rng.random() * 6) * np.exp(-t / 0.06) * 0.12
    return x * 0.8


def mk_crash():
    t = tt(1.6)
    out = []
    for _ in range(2):
        x = filt(noise(1.6), 'highpass', 5000, 2) * np.exp(-t / 0.55) * (1 - np.exp(-t / 0.003))
        out.append(x)
    return np.vstack(out) * 0.5


def mk_clack():
    t = tt(0.06)
    return filt(noise(0.06), 'bandpass', [1800, 4200]) * np.exp(-t / 0.010)


def mk_tick():
    t = tt(0.04)
    return filt(noise(0.04), 'highpass', 4000) * np.exp(-t / 0.004)


def woodblock(m=79):
    """木魚／木塊：印章、蓋章用，清脆不沉重。"""
    t = tt(0.18)
    f = mtof(m)
    x = np.sin(2 * np.pi * f * t) * np.exp(-t / 0.035) + np.sin(2 * np.pi * f * 2.7 * t) * np.exp(-t / 0.012) * 0.4
    x += filt(noise(0.18), 'bandpass', [f * 0.8, f * 2.5]) * np.exp(-t / 0.01) * 0.5
    return x * 0.8


# ───────────── 音高樂器：馬林巴、鐵琴、電鋼琴 ─────────────
def marimba(m, dur=0.5):
    t = tt(dur)
    f = mtof(m)
    x = np.zeros(len(t))
    for r, a, d in ((1, 1.0, 0.42), (3.93, 0.32, 0.08), (9.2, 0.1, 0.025)):
        if f * r < SR * 0.45:
            x += np.sin(2 * np.pi * f * r * t) * a * np.exp(-t / d)
    x += filt(noise(dur), 'bandpass', [1500, 4500]) * np.exp(-t / 0.003) * 0.15
    return x * (1 - np.exp(-t / 0.001)) * 0.6


def glock(m, dur=1.4):
    t = tt(dur)
    f = mtof(m)
    x = np.zeros(len(t))
    for r, a, d in ((1, 1.0, 0.9), (2.76, 0.45, 0.35), (5.4, 0.22, 0.15), (8.93, 0.1, 0.07)):
        if f * r < SR * 0.45:
            x += np.sin(2 * np.pi * f * r * t) * a * np.exp(-t / d)
    return x * (1 - np.exp(-t / 0.001)) * 0.45


def ep(notes, dur=0.14, vel=1.0):
    """FM 電鋼琴，短促的反拍和弦（輕快的關鍵）。"""
    n = int((dur + 0.25) * SR)
    t = np.arange(n) / SR
    x = np.zeros(n)
    for m in notes:
        f = mtof(m)
        idx = 1.5 * np.exp(-t / 0.18) + 0.25
        x += np.sin(2 * np.pi * f * t + idx * np.sin(2 * np.pi * f * t)) * np.exp(-t / 0.9)
        x += np.sin(2 * np.pi * f * 14 * t) * np.exp(-t / 0.012) * 0.05
    rel = np.clip((dur + 0.25 - t) / 0.25, 0, 1) if dur < 0.6 else 1
    env = np.where(t < dur, 1.0, np.exp(-(t - dur) / 0.05))
    return x * env * rel * (1 - np.exp(-t / 0.002)) / len(notes) * vel


def pad(notes, dur, cutoff=1600, a=0.25, r=0.4):
    n = int(dur * SR)
    L, R = np.zeros(n), np.zeros(n)
    for m in notes:
        for v, c in enumerate((-9, 0, 9)):
            x = saw(mtof(m) * 2 ** (c / 1200), dur)
            p = (-0.5, 0, 0.5)[v]
            L += x * np.cos((p + 1) * np.pi / 4)
            R += x * np.sin((p + 1) * np.pi / 4)
    e = env_ar(n, a, r) / (len(notes) * np.sqrt(3))
    s = sos('lowpass', cutoff, 2)
    return np.vstack([signal.sosfilt(s, L * e), signal.sosfilt(s, R * e)])


def bass(m, dur, cutoff=1100):
    n = int(dur * SR)
    t = np.arange(n) / SR
    x = np.sin(2 * np.pi * mtof(m) * t) * 0.8 + filt(saw(mtof(m), dur), 'lowpass', cutoff) * 0.45
    return x * np.minimum(1, t / 0.003) * np.exp(-t / 0.35) * env_ar(n, 0.002, 0.025)


# ───────────── 音效 ─────────────
def whoosh(dur, peak=0.7, f0=300, f1=3200, f2=600, pan0=-0.8, pan1=0.8):
    n = int(dur * SR)
    t = np.arange(n) / dur / SR
    fc = np.where(t < peak, f0 * (f1 / f0) ** (t / peak), f1 * (f2 / f1) ** ((t - peak) / (1 - peak)))
    x = tvfilt(noise(dur), fc, 'bandpass', 1.6)
    amp = np.where(t < peak, (t / peak) ** 2.2, np.exp(-(t - peak) / (1 - peak) * 4))
    x *= amp
    pan = pan0 + (pan1 - pan0) * t
    a = (pan + 1) * np.pi / 4
    return np.vstack([x * np.cos(a), x * np.sin(a)]) * np.sqrt(2)


def lift(t0, t1, gain=1.0, base=74):
    """上行的馬林巴滾奏＋輕柔噪音，接下一個段落（取代沉重的升壓音效）。"""
    scale = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24, 26, 28]
    n = int(round((t1 - t0) / (S16 / 2)))
    for i in range(n):
        p = i / max(n - 1, 1)
        add('music', marimba(base + scale[i % len(scale)] + 12 * (i // len(scale)), 0.25), t0 + i * S16 / 2, 0.14 * gain * (0.5 + 0.5 * p), pan=-0.4 + 0.8 * p, verb=0.15)
    d = t1 - t0
    nz = tvfilt(noise(d), 2500 * 4 ** (np.arange(int(d * SR)) / (d * SR)), 'bandpass', 1.8) * (np.arange(int(d * SR)) / (d * SR)) ** 2
    add('fx', nz, t0, 0.10 * gain)


def reverse_crash(dur=0.6):
    c = mk_crash()[:, :int(dur * SR)][:, ::-1]
    return c * np.linspace(0, 1, c.shape[1]) ** 2


KICK, CLAP, SNAP, SHAKER, TAMB, CRASH = mk_kick(), mk_clap(), mk_snap(), mk_shaker(), mk_tamb(), mk_crash()
CLACK, TICK = mk_clack(), mk_tick()


def kick(t, g=1.0):
    add('drums', KICK, t, 0.62 * g)
    KICKS.append((t, g))


def crash(t, g=1.0):
    add('drums', CRASH, t, 0.16 * g, verb=0.2)


# ───────────── 和聲與編曲 ─────────────
D, A, Bm, G, Asus = [62, 66, 69, 74], [61, 64, 69, 73], [62, 66, 71, 74], [62, 67, 71, 74], [62, 64, 69, 74]
DADD9 = [62, 66, 69, 76]
ROOT = {id(D): 38, id(A): 45, id(Bm): 47, id(G): 43, id(Asus): 45, id(DADD9): 38}
TRIAD = {id(D): [62, 66, 69], id(A): [61, 64, 69], id(Bm): [62, 66, 71], id(G): [62, 67, 71], id(Asus): [62, 64, 69], id(DADD9): [62, 66, 69]}
CH = {-1: DADD9, 0: DADD9, 1: Asus, 2: D, 3: A, 4: Bm, 5: G, 6: A, 7: D, 8: A, 9: D, 10: A, 11: Bm, 12: G,
      13: D, 14: A, 15: Bm, 16: G, 17: Bm, 18: G, 19: D, 20: A, 21: A, 22: D, 23: A, 24: Bm, 25: G, 26: D,
      27: A, 28: G, 29: D, 30: Bm, 31: G, 32: A, 33: D, 34: DADD9, 35: DADD9}
# 每小節的編曲。groove：none／light（大鼓 1、3 拍＋沙鈴）／pop（再加 2、4 拍拍手）／full（再加鈴鼓）
# comp＝電鋼琴反拍、bass＝跳躍的八度貝斯、hook＝馬林巴主旋律、arp＝鐵琴分解和弦
# 39.2–40.8 是光復災後提醒：只留柔和長音，不放鼓與旋律。
ARR = {
    -1: dict(pad=1200), 0: dict(pad=1400, arp=1), 1: dict(pad=1600, arp=1),
    2: dict(groove='pop', comp=1, bass='bounce', pad=1600), 3: dict(groove='pop', comp=1, bass='bounce', pad=1600),
    4: dict(groove='pop', comp=1, bass='bounce', arp=1), 5: dict(groove='pop', comp=1, bass='bounce', arp=1),
    6: dict(groove='pop', comp=1, bass='bounce', arp=1),
    7: dict(groove='light', comp=1, bass='root'), 8: dict(groove='light', comp=1, bass='root'),
    9: dict(groove='full', comp=1, bass='bounce', hook=1, pad=2000), 10: dict(groove='full', comp=1, bass='bounce', hook=1, pad=2000),
    11: dict(groove='full', comp=1, bass='bounce', hook=1, pad=2000),
    **{k: dict(groove='full', comp=1, bass='bounce', hook=1) for k in range(12, 17)},
    17: dict(groove='shaker', pad=1300, arp=1), 18: dict(groove='shaker', pad=1500, arp=1),
    19: dict(groove='light', comp=1, bass='root', arp=1), 20: dict(groove='pop', comp=1, bass='bounce', arp=1),
    21: dict(groove='pop', comp=1, bass='bounce', arp=1),
    22: dict(groove='full', comp=1, bass='bounce', hook=1, pad=2000), 23: dict(groove='full', comp=1, bass='bounce', hook=1, pad=2000),
    24: dict(pad=1000, soft=1),
    25: dict(groove='pop', comp=1, bass='bounce', arp=1),
    26: dict(groove='light', comp=1, bass='root'), 27: dict(groove='light', comp=1, bass='root'),
    28: dict(groove='pop', comp=1, bass='bounce', arp=1),
    29: dict(groove='pop', comp=1, bass='bounce'), 30: dict(groove='pop', comp=1, bass='bounce'),
    31: dict(groove='pop', comp=1, bass='bounce', arp=1),
    32: dict(groove='light', comp=1, pad=1600),
    33: dict(groove='full', comp=1, bass='bounce', hook=1, pad=2200), 34: dict(pad=1600, arp=1), 35: dict(pad=1200),
}
HOOK_A = [(0, 2), (3, 1), (6, 2), (8, 3), (10, 2), (13, 1)]
HOOK_B = [(0, 3), (2, 2), (4, 1), (6, 2), (10, 0), (12, 1), (14, 2)]


def groove_bar(k, kind):
    b = bar(k)
    if kind in ('light', 'pop', 'full'):
        for i in (0, 8):
            kick(b + i * S16, 0.9 if kind != 'light' else 0.75)
        if kind == 'full' and k % 2:
            kick(b + 14 * S16, 0.5)
        for i in range(16):
            add('drums', SHAKER, b + i * S16 + (0.012 if i % 2 else 0), (0.22 if i % 2 else 0.13) * (0.8 if kind == 'light' else 1), pan=0.35)
    if kind in ('pop', 'full'):
        for i in (4, 12):
            add('drums', CLAP, b + i * S16, 0.42, pan=-0.05, verb=0.2)
            add('drums', SNAP, b + i * S16, 0.25, pan=0.2)
    if kind == 'full':
        for i in range(2, 16, 4):
            add('drums', TAMB, b + i * S16, 0.18, pan=-0.35)
    if kind == 'shaker':
        for i in range(0, 16, 2):
            add('drums', SHAKER, b + i * S16, 0.14, pan=0.35)


def arrange():
    for k in range(-1, 36):
        b, ch, a = bar(k), CH[k], ARR[k]
        tri = TRIAD[id(ch)]
        t0 = max(b, 0.0)
        span = BAR - (t0 - b) + (0.6 if k == 35 else 0.0)
        if a.get('pad'):
            att = 0.6 if k in (-1, 34, 35) else 0.3
            add('music', pad(ch, span + 0.3, cutoff=a['pad'], a=att, r=0.35), t0, 0.32 if not a.get('soft') else 0.42, verb=0.35)
        if a.get('comp'):
            for i in (2, 6, 10, 14):
                add('music', ep(ch, 0.12, 1.15 if i in (6, 14) else 0.95), b + i * S16, 0.5, pan=-0.15, verb=0.12)
        r = ROOT[id(ch)]
        if a.get('bass') == 'bounce':
            for i in range(0, 16, 2):
                m = r + (12 if i % 4 == 2 else 0)
                add('music', bass(m, 0.13), b + i * S16, 0.42 if i % 4 == 0 else 0.3)
        elif a.get('bass') == 'root':
            for i in (0, 8):
                add('music', bass(r, 0.5), b + i * S16, 0.42)
        if a.get('hook'):
            pat = HOOK_A if k % 2 == 0 else HOOK_B
            tones = [tri[0] + 12, tri[1] + 12, tri[2] + 12, tri[0] + 24]
            for i, j in pat:
                add('music', marimba(tones[j], 0.45), b + i * S16, 0.36, pan=0.15, verb=0.18)
        if a.get('arp'):
            tones = [tri[0] + 24, tri[1] + 24, tri[2] + 24, tri[1] + 24]
            for i in range(0, 16, 2):
                add('music', glock(tones[(i // 2) % 4], 0.6), b + i * S16, 0.075, pan=-0.3 if i % 4 else 0.3, verb=0.3)
        if a.get('groove'):
            groove_bar(k, a['groove'])


def accent(t, g=1.0, chord=None, crash_=True):
    """剪接點：輕的鈸＋大鼓＋電鋼琴與鐵琴和弦（取代低頻撞擊）。"""
    kick(t, 0.9 * g)
    if crash_:
        crash(t, g)
    add('drums', SNAP, t, 0.3 * g, pan=0.15)
    if chord:
        add('music', ep(chord, 0.3, 1.2), t, 0.55 * g, verb=0.2)
        for i, m in enumerate(chord[-3:]):
            add('fx', glock(m + 12, 1.0), t + i * 0.035, 0.11 * g, pan=-0.3 + 0.3 * i, verb=0.35)


def events():
    # 1. Logo（0–4.0）：叮叮噹噹的開場
    for i in range(8):
        add('fx', TICK, i * S16, 0.10 + 0.02 * i, pan=-0.6 + 0.15 * i)           # 鐵道線劃出
    add('fx', whoosh(1.3, 0.55, 300, 2600, 700, -0.9, 0.9), 0.0, 0.16)            # 小列車追過
    add('fx', glock(86, 1.6), 0.8, 0.2, verb=0.4)                                  # 琺瑯牌落定
    add('fx', marimba(74, 0.6), 0.8, 0.3)
    for i in range(4):
        add('fx', TICK, 1.0 + 0.035 * i, 0.16, pan=[-0.5, 0.5, -0.5, 0.5][i])       # 鉚釘
    for t, m in ((1.6, 74), (1.75, 81)):                                           # 「軌」「島」落下
        add('fx', marimba(m, 0.6), t, 0.45, verb=0.2)
        add('fx', woodblock(84), t, 0.25)
    for i, m in enumerate([86, 88, 90, 93, 95, 98]):                               # RAIL ISLAND 閃光
        add('fx', glock(m, 0.8), 1.9 + i * 0.07, 0.09, pan=-0.5 + i * 0.2, verb=0.4)
    add('fx', reverse_crash(0.5), 2.3, 0.18)
    add('fx', woodblock(77), 2.8, 0.55, verb=0.2)                                  # 印章蓋下：清脆的「咚」
    add('drums', CLAP, 2.8, 0.45, verb=0.3)
    add('fx', glock(90, 1.2), 2.8, 0.16, verb=0.35)
    crash(2.8, 0.7)
    lift(3.2, 4.0, 1.0, 69)
    add('fx', whoosh(0.7, 0.92, 400, 6000, 6000, 0, 0), 3.3, 0.16)                  # 穿越島形

    # 2. 標語（4.0–7.2）
    accent(4.0, 1.0, chord=[66, 69, 74, 78])
    for t, m in ((4.8, 78), (5.2, 81), (5.6, 86)):                                 # 逐字跳出：馬林巴往上
        add('music', marimba(m, 0.5), t, 0.42, verb=0.15)
        add('drums', SNAP, t, 0.28, pan=0.2)
    add('fx', glock(90, 1.2), 6.0, 0.16, verb=0.35)                                # 紅圈圈住「說故事」
    add('fx', woodblock(81), 6.0, 0.3)
    add('fx', whoosh(0.5, 0.75, 400, 5000, 1200, 0.9, -0.9), 6.9, 0.2)              # 甩鏡
    accent(7.2, 0.8)

    # 3. 掃 QR（7.2–12.0）
    t = tt(0.95)
    scan = np.sin(2 * np.pi * np.cumsum(1100 * 2 ** (t / 0.95)) / SR) * (0.6 + 0.4 * np.sin(2 * np.pi * 18 * t)) * np.minimum(1, t / 0.1) * np.minimum(1, (0.95 - t) / 0.1)
    add('fx', scan, 7.7, 0.035, pan=-0.3)                                          # 掃描線
    accent(8.8, 0.8)
    add('fx', filt(noise(0.25), 'highpass', 4000) * np.exp(-tt(0.25) / 0.025), 8.78, 0.18)   # 閃白
    add('fx', glock(93, 1.2), 8.8, 0.15, verb=0.4)
    add('fx', glock(86, 0.9), 9.9, 0.13, verb=0.3)                                 # 提示卡跳出
    lift(11.2, 12.0, 0.9, 74)

    # 4. 只列會停的站（12.0–15.2）
    accent(12.0, 0.7)
    for i, m in enumerate([74, 76, 78, 81, 83, 86, 88, 90]):                        # 逐站亮起
        add('fx', marimba(m, 0.4), 13.05 + 0.085 * i, 0.22, pan=-0.6 + 0.17 * i, verb=0.15)
    add('fx', TICK, 13.95, 0.4)                                                    # 點下「十分」
    add('fx', glock(86, 1.0), 14.0, 0.18, verb=0.35)
    add('fx', marimba(81, 0.4), 14.0, 0.3)
    add('fx', whoosh(0.7, 0.9, 400, 5000, 5000, 0, 0), 14.45, 0.14)                 # 鑽進站卡
    lift(14.4, 15.2, 1.0, 74)

    # 5. 十分登場（15.2–20.0）
    add('fx', reverse_crash(0.5), 14.7, 0.16)
    accent(15.2, 1.1, chord=[66, 69, 74, 78])
    add('fx', woodblock(74), 15.2, 0.3)
    add('fx', whoosh(0.8, 0.5, 400, 2400, 700, -0.4, 0.4), 15.55, 0.1)              # 照片撐開
    for i, m in enumerate([86, 88, 90]):                                           # 主題句展開
        add('fx', glock(m, 0.8), 16.4 + 0.18 * i, 0.09, pan=0.3, verb=0.3)
    add('fx', whoosh(0.8, 0.85, 3000, 500, 400, 0.3, -0.3), 18.0, 0.12)             # 拉遠成手機
    add('fx', marimba(86, 0.4), 18.8, 0.25)

    # 6. 功能連發（20.0–28.0）：每鏡一小節，放大鏡飛出時一聲鐵琴
    for i, c in enumerate([20.0, 21.6, 23.2, 24.8, 26.4]):
        if i:
            add('fx', whoosh(0.44, 0.5, 500, 4500, 900, -0.9, 0.9), c - 0.22, 0.18)
        accent(c, 0.85)
        add('fx', glock(81 + [0, 2, 4, 7, 9][i], 0.9), c + 0.3, 0.13, pan=-0.3, verb=0.3)
        add('fx', whoosh(0.45, 0.8, 900, 4500, 2000, 0.6, -0.6), c + 0.2, 0.07)       # 放大鏡飛出
    for i in range(3):                                                             # 時刻板翻牌
        for j in range(5):
            add('fx', CLACK, 26.75 + 0.18 * i + j * 0.019, 0.12 * (1 - j / 7), pan=-0.4)

    # 7. 中英切換（28.0–31.2）
    add('fx', whoosh(0.44, 0.5, 500, 4500, 900, -0.9, 0.9), 27.78, 0.18)
    accent(28.0, 0.7)
    add('fx', marimba(79, 0.3), 28.1, 0.28)                                        # 切換鍵彈出
    add('fx', TICK, 28.5, 0.4)                                                     # 點擊
    add('fx', woodblock(86), 28.8, 0.35)
    add('fx', glock(93, 1.2), 28.8, 0.18, verb=0.35)
    add('fx', whoosh(0.7, 0.5, 400, 2600, 600, -0.6, 0.6), 28.7, 0.12)              # 手機翻面
    add('fx', marimba(86, 0.3), 28.93, 0.18)
    add('fx', marimba(90, 0.3), 29.22, 0.18)
    lift(30.4, 31.2, 0.9, 74)

    # 8. 全台路網（31.2–36.0）
    accent(31.2, 0.8)
    add('fx', whoosh(0.7, 0.85, 3000, 400, 300, 0, 0), 31.25, 0.1)                 # 拉遠
    for t, m in ((33.2, 86), (34.0, 90), (34.8, 93)):                              # 三個站名牌：鐵琴往上
        add('fx', glock(m, 1.2), t, 0.2, pan={86: 0.4, 90: 0.5, 93: -0.5}[m], verb=0.35)
        add('fx', marimba(m - 12, 0.4), t, 0.28)
    for t in (32.8, 33.6, 34.4):
        add('fx', whoosh(0.5, 0.6, 500, 2500, 700, -0.5, 0.5), t, 0.06)
    lift(35.2, 36.0, 1.0, 74)

    # 9. 三站並列（36.0–42.4）
    add('fx', reverse_crash(0.5), 35.5, 0.16)
    accent(36.0, 1.0, chord=[66, 69, 74, 78])
    for i in range(3):
        add('fx', marimba(81 + [0, 5, 9][i], 0.4), 36.0 + 0.13 * i, 0.2, pan=-0.5 + 0.5 * i)
    add('fx', whoosh(0.6, 0.85, 400, 2600, 700, 0, -0.2), 38.6, 0.1)               # 推進光復
    # 39.2 光復：不放重音，只留柔和長音
    add('fx', whoosh(0.4, 0.75, 400, 3500, 900, -0.8, 0.8), 40.4, 0.14)             # 甩到通霄
    accent(40.8, 0.6)
    add('fx', glock(86, 1.0), 41.0, 0.12, verb=0.3)

    # 10. 誠實標示（42.4–47.2）：三枚印章是三聲清脆的木塊
    add('fx', whoosh(0.44, 0.5, 500, 4500, 900, -0.9, 0.9), 42.18, 0.18)
    accent(42.4, 0.7)
    for t, p, m in ((43.2, -0.5, 74), (44.0, 0.0, 79), (44.8, 0.5, 83)):
        add('fx', woodblock(m + 7), t, 0.55, pan=p, verb=0.2)
        add('drums', CLAP, t, 0.35, pan=p, verb=0.2)
        add('fx', marimba(m + 12, 0.4), t + 0.2, 0.2, pan=p)                       # 例子截圖浮上
    add('fx', whoosh(0.5, 0.85, 400, 3000, 900, -0.9, 0.2), 45.2, 0.12)             # 示範班次帶滑入
    add('fx', marimba(86, 0.3), 45.67, 0.2)
    lift(46.4, 47.2, 0.8, 74)

    # 11. 合作模式（47.2–52.0）
    accent(47.2, 0.8)
    add('fx', whoosh(1.0, 0.9, 300, 2200, 900, -0.9, -0.2), 47.4, 0.11)             # 兩塊站名牌滑入
    add('fx', whoosh(1.0, 0.9, 300, 2200, 900, 0.9, 0.2), 47.4, 0.11)
    add('fx', woodblock(72), 48.4, 0.45)                                           # 車鉤扣上：喀一聲
    add('fx', glock(86, 1.0), 48.4, 0.16, verb=0.35)
    add('fx', glock(93, 1.0), 48.44, 0.1, verb=0.35)
    crash(48.4, 0.6)
    for i in range(7):                                                             # 列車通過：喀噠聲由左到右
        t = 48.8 + i * BEAT
        p = -0.9 + 1.8 * (t - 48.66) / (51.2 - 48.66)
        v = 0.3 * np.exp(-((t - 49.9) / 1.0) ** 2) + 0.08
        for d in (0, 0.09):
            add('fx', CLACK, t + d, v, pan=float(np.clip(p, -0.9, 0.9)))
    lift(51.2, 52.0, 1.0, 74)

    # 12. Logo 收尾（52.0–58.0）
    accent(52.0, 0.7)
    for p in (-0.9, 0.9):
        add('fx', whoosh(0.6, 0.85, 400, 3000, 1200, p, 0), 52.0, 0.06)            # 路網收攏
    add('fx', glock(86, 1.2), 52.85, 0.15, verb=0.4)                               # 牌子落定
    for i in range(4):
        add('fx', TICK, 52.86 + 0.038 * i, 0.14, pan=[-0.5, 0.5, -0.5, 0.5][i])
    add('fx', reverse_crash(0.6), 53.0, 0.16)
    for t, m in ((53.6, 74), (53.8, 81)):                                          # 「軌」「島」落下
        add('fx', marimba(m, 0.6), t, 0.42, verb=0.2)
        add('fx', woodblock(84), t, 0.2)
    accent(53.6, 1.0, chord=[66, 69, 74, 78])
    for i, m in enumerate([86, 88, 90, 93, 95, 98]):                               # RAIL ISLAND 閃光
        add('fx', glock(m, 1.0), 53.9 + i * 0.07, 0.09, pan=-0.5 + i * 0.2, verb=0.45)
    add('fx', glock(86, 2.4), 54.8, 0.2, verb=0.5)                                 # 「乘車導覽模式」帶
    add('fx', glock(81, 2.4), 54.8, 0.12, verb=0.5)
    add('fx', marimba(74, 0.8), 54.8, 0.3, verb=0.3)


def sidechain():
    g = np.ones(N)
    for t, v in KICKS:
        i = int(t * SR)
        if i >= N:
            continue
        n = min(int(0.3 * SR), N - i)
        d = np.arange(n) / SR
        g[i:i + n] = np.minimum(g[i:i + n], 1 - 0.22 * v * np.exp(-d / 0.08) * np.minimum(1, d / 0.004 + 0.3))
    return g


def reverb(x):
    n = int(2.0 * SR)
    t = np.arange(n) / SR
    out = []
    for c in range(2):
        ir = rng.standard_normal(n) * np.exp(-6.9 * t / 1.6)
        ir = filt(ir, 'lowpass', 7000)
        ir[: int(0.015 * SR)] = 0
        ir /= np.sqrt(np.sum(ir ** 2))
        out.append(signal.fftconvolve(x[c], ir)[:N])
    return np.vstack(out)


def master():
    music = BUS['music'] * sidechain()
    mix = BUS['drums'] * 0.85 + music * 0.95 + BUS['fx'] * 0.85 + reverb(BUS['verb']) * 0.45
    mix = signal.sosfilt(sos('highpass', 35), mix, axis=1)
    t = np.arange(N) / SR
    mix *= np.minimum(1, t / 0.01) * np.clip((DUR - t) / 1.6, 0, 1) ** 1.5
    # 輕壓縮＋很淡的軟限幅，峰值 −1 dBFS
    lvl = np.max(np.abs(mix), axis=0)
    env = signal.sosfilt(sos('lowpass', 8), lvl)
    thr = np.percentile(env, 94)
    mix *= np.where(env > thr, (thr / np.maximum(env, 1e-9)) ** 0.3, 1.0)
    mix = np.tanh(mix / np.max(np.abs(mix)) * 1.05) / np.tanh(1.05)
    return mix * 10 ** (-1 / 20)


def main():
    out = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).resolve().parent.parent / '_video' / 'score.wav'
    out.parent.mkdir(parents=True, exist_ok=True)
    arrange()
    events()
    mix = master()
    pcm = (np.clip(mix.T, -1, 1) * 32767).astype('<i2')
    with wave.open(str(out), 'wb') as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(pcm.tobytes())
    print('寫出', out, f'{DUR:.1f} 秒')


if __name__ == '__main__':
    main()
