#!/usr/bin/env python3
"""乘車導覽發布影片的配樂：150 BPM、D 大調，鼓點與音效對準剪接點。

全部用程式合成（鼓、貝斯、和弦、鐘聲、音效都是數學產生），沒有取樣、沒有外部音檔，所以沒有授權問題。
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


# ───────────── 鼓與打擊 ─────────────
def mk_kick():
    t = tt(0.5)
    f = 50 + 120 * np.exp(-t / 0.03) + 30 * np.exp(-t / 0.12)
    body = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / 0.22) * (1 - np.exp(-t / 0.0015))
    click = filt(noise(0.5) * np.exp(-t / 0.002), 'highpass', 1500) * 0.5
    return np.tanh(1.6 * (body + click)) * 0.9


def mk_clap():
    t = tt(0.6)
    e = np.zeros(len(t))
    for d in (0, 0.011, 0.023):
        m = t >= d
        e[m] += np.exp(-(t[m] - d) / 0.007) * 0.8
    m = t >= 0.033
    e[m] += np.exp(-(t[m] - 0.033) / 0.12)
    x = filt(noise(0.6) * e, 'bandpass', [900, 6000])
    body = np.sin(2 * np.pi * 185 * t) * np.exp(-t / 0.06) * 0.5
    snr = filt(noise(0.6), 'highpass', 2000) * np.exp(-t / 0.16) * 0.45
    return (x * 1.1 + body + snr) * 0.7


def mk_snare():
    t = tt(0.25)
    return (np.sin(2 * np.pi * 200 * t) * np.exp(-t / 0.05) * 0.6
            + filt(noise(0.25), 'highpass', 1800) * np.exp(-t / 0.07)) * 0.6


def mk_hat(open_=False):
    d = 0.35 if open_ else 0.08
    t = tt(d)
    x = filt(noise(d), 'highpass', 7000, 4)
    return x * np.exp(-t / (0.16 if open_ else 0.028))


def mk_crash():
    t = tt(2.2)
    out = []
    for _ in range(2):
        x = filt(noise(2.2), 'highpass', 3500, 2) * np.exp(-t / 0.9) * (1 - np.exp(-t / 0.003))
        x += filt(noise(2.2), 'bandpass', [5000, 9000]) * np.exp(-t / 0.35) * 0.6
        out.append(x)
    return np.vstack(out) * 0.55


def mk_impact():
    t = tt(2.4)
    f = 38 + 75 * np.exp(-t / 0.35)
    boom = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / 0.45) * (1 - np.exp(-t / 0.002))
    nz = filt(noise(2.4), 'lowpass', 900) * np.exp(-t / 0.22) * 0.7
    hi = filt(noise(2.4), 'highpass', 2500) * np.exp(-t / 0.05) * 0.35
    return np.tanh(1.4 * (boom + nz)) + hi


def mk_thud():
    """印章蓋下：低沉的咚＋木頭敲擊＋紙張啪。"""
    t = tt(0.6)
    f = 46 + 40 * np.exp(-t / 0.05)
    x = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / 0.16)
    x += filt(noise(0.6), 'bandpass', [700, 1600]) * np.exp(-t / 0.035) * 0.9
    x += filt(noise(0.6), 'highpass', 3000) * np.exp(-t / 0.018) * 0.5
    return np.tanh(1.5 * x)


def mk_clunk():
    """車鉤扣上：金屬撞擊的不和諧泛音。"""
    t = tt(1.2)
    x = np.zeros(len(t))
    for f, d, a in ((182, 0.55, 1.0), (437, 0.38, 0.7), (811, 0.26, 0.55), (1293, 0.18, 0.4), (2011, 0.1, 0.3), (3170, 0.06, 0.2)):
        x += np.sin(2 * np.pi * f * t + rng.random() * 6) * np.exp(-t / d) * a
    th = np.zeros(len(t))
    th[:len(THUD_)] = THUD_
    return x * 0.45 + th * 0.8


THUD_ = None


def mk_clack():
    t = tt(0.06)
    return filt(noise(0.06), 'bandpass', [1800, 4200]) * np.exp(-t / 0.010)


def mk_tick():
    t = tt(0.04)
    return filt(noise(0.04), 'highpass', 4000) * np.exp(-t / 0.004)


# ───────────── 音高樂器 ─────────────
def pluck(m, dur=0.4, bright=1.0):
    t = tt(dur)
    f = mtof(m)
    x = np.zeros(len(t))
    for k in range(1, 24):
        if f * k > SR * 0.45:
            break
        x += np.sin(2 * np.pi * f * k * t + rng.random() * 0.3) / k * np.exp(-t * (4 + k * 2.2 / bright))
    return x * (1 - np.exp(-t / 0.002)) * 0.5


def bell(m, dur=1.6, ratio=2.0, index=1.6):
    t = tt(dur)
    fc = mtof(m)
    mod = np.sin(2 * np.pi * fc * ratio * t) * index * np.exp(-t / 0.25)
    return np.sin(2 * np.pi * fc * t + mod) * np.exp(-t / 0.55) * (1 - np.exp(-t / 0.002))


def blip(m, dur=0.12):
    t = tt(dur)
    f = mtof(m) * (1 + 0.25 * (1 - np.exp(-t / 0.02)))
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / 0.04) * (1 - np.exp(-t / 0.001))


def supersaw(notes, dur, cutoff=4500, a=0.004, r=0.08, voices=5, detune=12):
    n = int(dur * SR)
    L, R = np.zeros(n), np.zeros(n)
    for m in notes:
        for v in range(voices):
            c = (v - (voices - 1) / 2) / ((voices - 1) / 2) * detune
            x = saw(mtof(m) * 2 ** (c / 1200), dur)
            p = (v / (voices - 1)) * 1.2 - 0.6
            L += x * np.cos((p + 1) * np.pi / 4)
            R += x * np.sin((p + 1) * np.pi / 4)
    e = env_ar(n, a, r) / (len(notes) * np.sqrt(voices))
    s = sos('lowpass', cutoff, 2)
    return np.vstack([signal.sosfilt(s, L * e), signal.sosfilt(s, R * e)])


def bass(m, dur, cutoff=700):
    n = int(dur * SR)
    t = np.arange(n) / SR
    x = saw(mtof(m), dur) * 0.75 + np.sin(2 * np.pi * mtof(m) * t) * 0.5
    return filt(x, 'lowpass', cutoff) * env_ar(n, 0.004, 0.03)


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


def riser(dur, f0=300, f1=9000, m0=45, m1=81):
    n = int(dur * SR)
    t = np.arange(n) / n
    fc = f0 * (f1 / f0) ** t
    nz = tvfilt(noise(dur), fc, 'bandpass', 1.8) * t ** 2.2
    tone = filt(saw(mtof(m0) * (mtof(m1) / mtof(m0)) ** t, dur), 'lowpass', 3000) * t ** 3 * 0.35
    x = nz + tone
    x[-int(0.012 * SR):] *= np.linspace(1, 0, int(0.012 * SR))
    return x


def reverse_crash(dur=0.8):
    c = mk_crash()[:, :int(dur * SR)][:, ::-1]
    return c * np.linspace(0, 1, c.shape[1]) ** 2


def roll(t0, t1, start_div=2, end_div=4, gain=0.45, crescendo=True):
    """小鼓滾奏：從 8 分音符加速到 16 分音符。"""
    t = t0
    sn = mk_snare()
    while t < t1 - 1e-6:
        p = (t - t0) / (t1 - t0)
        div = start_div if p < 0.5 else end_div
        add('drums', sn, t, gain * (0.35 + 0.65 * p if crescendo else 1), pan=0.1, verb=0.15)
        t += BEAT / div


KICK, CLAP, HAT, OHAT, CRASH, IMPACT, THUD = mk_kick(), mk_clap(), mk_hat(), mk_hat(True), mk_crash(), mk_impact(), mk_thud()
THUD_ = THUD
CLUNK, CLACK, TICK = mk_clunk(), mk_clack(), mk_tick()


def kick(t, g=1.0):
    add('drums', KICK, t, 0.8 * g)
    KICKS.append((t, g))


def crash(t, g=1.0):
    add('drums', CRASH, t, 0.32 * g, verb=0.25)


def impact(t, g=1.0):
    add('fx', IMPACT, t, 0.5 * g, verb=0.3)


def hit(t, g=1.0, chord=None):
    """剪接點的重拍：大鼓＋鈸＋低頻撞擊（＋和弦重音）。"""
    kick(t, g)
    crash(t, g)
    impact(t, 0.8 * g)
    if chord:
        add('music', supersaw(chord, 0.5, cutoff=6000, r=0.35), t, 0.55 * g, verb=0.2)


# ───────────── 和聲與編曲 ─────────────
D, A, Bm, G, Asus = [62, 66, 69, 74], [61, 64, 69, 73], [62, 66, 71, 74], [62, 67, 71, 74], [62, 64, 69, 74]
ROOT = {id(D): 38, id(A): 45, id(Bm): 47, id(G): 43, id(Asus): 45}
DADD9 = [62, 66, 69, 76]
CH = {-1: DADD9, 0: DADD9, 1: Asus, 2: D, 3: A, 4: Bm, 5: G, 6: A, 7: D, 8: A, 9: D, 10: A, 11: Bm, 12: G,
      13: D, 14: A, 15: Bm, 16: G, 17: Bm, 18: G, 19: D, 20: A, 21: A, 22: D, 23: A, 24: Bm, 25: G, 26: D,
      27: A, 28: G, 29: D, 30: Bm, 31: G, 32: A, 33: D, 34: DADD9, 35: DADD9}
# 每小節的編曲：drums＝鼓組型態、pad＝長音和弦的亮度、stab＝3-3-2 和弦重音、bass、arp＝分解和弦
# 39.2–40.8 是光復災後提醒：音樂退到只剩柔和長音，不放鼓與重音。
ARR = {
    -1: dict(pad=700), 0: dict(pad=900), 1: dict(pad=1300),
    2: dict(drums='slam', pad=2600, bass='sus'), 3: dict(drums='slam', pad=2600, bass='sus'),
    4: dict(drums='groove', pad=2200, bass='8th', arp=1), 5: dict(drums='groove', pad=2200, bass='8th', arp=1),
    6: dict(drums='groove', pad=2600, bass='8th', arp=1),
    7: dict(drums='light', pad=2000, bass='sus', arp=0), 8: dict(drums='light', pad=2400, bass='sus'),
    9: dict(drums='full', pad=3500, stab=1, bass='8th', arp=1), 10: dict(drums='full', pad=3500, stab=1, bass='8th', arp=1),
    11: dict(drums='full', pad=3500, stab=1, bass='8th', arp=1),
    **{k: dict(drums='full', pad=4000, stab=1, bass='8th', arp=1) for k in range(12, 17)},
    17: dict(drums='break', pad=1200, arp=0), 18: dict(drums='break', pad=1500),
    19: dict(drums='four', pad=1500, bass='8th', arp=1), 20: dict(drums='four', pad=2500, bass='8th', arp=1),
    21: dict(drums='four', pad=3800, bass='8th', arp=1),
    22: dict(drums='full', pad=4000, stab=1, bass='8th', arp=1), 23: dict(drums='full', pad=4000, stab=1, bass='8th', arp=1),
    24: dict(pad=900, soft=1),
    25: dict(drums='groove', pad=2400, bass='8th', arp=1),
    26: dict(drums='light', pad=2400, bass='sus'), 27: dict(drums='light', pad=2400, bass='sus'),
    28: dict(drums='groove', pad=2800, bass='8th', arp=1),
    29: dict(drums='groove', pad=2800, bass='8th', arp=1), 30: dict(drums='groove', pad=3000, bass='8th', arp=1),
    31: dict(drums='groove', pad=3400, bass='8th', arp=1),
    32: dict(drums='light', pad=2000),
    33: dict(pad=5000, bass='sus'), 34: dict(pad=2200), 35: dict(pad=1400),
}


def drums_bar(k, kind):
    b = bar(k)
    steps = lambda *s: [b + i * S16 for i in s]
    if kind == 'groove':
        for t in steps(0, 6, 10):
            kick(t)
        add('drums', CLAP, b + 8 * S16, 0.5, verb=0.25)
        for i in range(0, 16, 2):
            add('drums', HAT, b + i * S16, 0.22 if i % 4 else 0.3, pan=0.25)
        add('drums', OHAT, b + 14 * S16, 0.16, pan=-0.2)
    elif kind == 'full':
        for t in steps(0, 6, 10, 14) if k % 2 else steps(0, 6, 10):
            kick(t)
        add('drums', CLAP, b + 8 * S16, 0.6, verb=0.25)
        for i in range(16):
            add('drums', HAT, b + i * S16, (0.26 if i % 2 == 0 else 0.12) * (1.15 if i % 4 == 2 else 1), pan=0.25)
        add('drums', OHAT, b + 6 * S16, 0.15, pan=-0.2)
        add('drums', OHAT, b + 14 * S16, 0.18, pan=-0.2)
    elif kind == 'light':
        for t in steps(0, 8):
            kick(t, 0.8)
        for i in range(0, 16, 2):
            add('drums', HAT, b + i * S16, 0.14, pan=0.25)
    elif kind == 'four':
        for i in range(0, 16, 4):
            kick(b + i * S16, 0.9)
        for i in range(2, 16, 4):
            add('drums', OHAT, b + i * S16, 0.14, pan=-0.15)
        for i in range(0, 16, 2):
            add('drums', HAT, b + i * S16, 0.15, pan=0.25)
        if k >= 20:
            add('drums', CLAP, b + 4 * S16, 0.4, verb=0.2)
            add('drums', CLAP, b + 12 * S16, 0.4, verb=0.2)
    elif kind == 'break':
        for i in range(0, 16, 4):
            add('drums', HAT, b + i * S16, 0.12, pan=0.25)
    elif kind == 'slam':
        for i in range(0, 16, 2):
            add('drums', HAT, b + i * S16, 0.18, pan=0.25)


def arrange():
    for k in range(-1, 36):
        b, ch, a = bar(k), CH[k], ARR[k]
        dur = BAR + (0.0 if k < 35 else 0.6)
        t0 = max(b, 0.0)
        span = dur - (t0 - b)
        if a.get('pad'):
            att = 0.6 if k in (-1, 34, 35) else (0.35 if a.get('soft') else 0.02)
            pad = supersaw(ch, span + 0.25, cutoff=a['pad'], a=att, r=0.25, detune=14)
            add('music', pad, t0, 0.95 if not a.get('soft') else 0.6, verb=0.3)
        if a.get('stab'):
            for i, ln in ((0, 5), (6, 5), (12, 3)):
                add('music', supersaw([n + 12 for n in ch[:3]] + [ch[0] + 24], ln * S16, cutoff=6500, r=0.06), b + i * S16, 0.6, verb=0.15)
        r = ROOT[id(ch)] if id(ch) in ROOT else 38
        if a.get('bass') == '8th':
            for i in range(0, 16, 2):
                add('music', bass(r, S16 * 1.8, 650 if i % 4 else 900), b + i * S16, 0.4)
        elif a.get('bass') == 'sus':
            add('music', bass(r, BAR), b, 0.4)
        if a.get('arp'):
            tones = [ch[0] + 12, ch[1] + 12, ch[2] + 12, ch[3] + 12, ch[2] + 12, ch[1] + 12]
            for i in range(16):
                add('music', pluck(tones[i % len(tones)], 0.3, 0.8), b + i * S16, 0.24 * (1.2 if i % 4 == 0 else 1), pan=0.35 if i % 2 else -0.35, verb=0.2)
        if a.get('drums'):
            drums_bar(k, a['drums'])


def events():
    # 1. Logo（0–4.0）
    for i in range(8):
        add('fx', TICK, i * S16, 0.12 + 0.03 * i, pan=-0.6 + 0.15 * i)           # 鐵道線劃出
    add('fx', whoosh(1.3, 0.55, 200, 2200, 500, -0.9, 0.9), 0.0, 0.32)            # 小列車追過
    kick(0.8, 0.7)
    add('fx', bell(74, 2.0), 0.8, 0.22, verb=0.4)                                 # 琺瑯牌落定
    for i in range(4):
        add('fx', TICK, 1.0 + 0.035 * i, 0.22, pan=[-0.5, 0.5, -0.5, 0.5][i])       # 鉚釘
    add('fx', whoosh(0.9, 0.6, 400, 4000, 1500, -0.5, 0.5), 0.75, 0.16)           # 島形刷入
    for t, m in ((1.6, 50), (1.75, 57)):                                          # 「軌」「島」重擊
        kick(t, 0.85)
        add('music', supersaw([m + 12, m + 16, m + 19], 0.35, cutoff=5000, r=0.25), t, 0.35, verb=0.25)
    for i, m in enumerate([86, 88, 90, 93, 95, 98]):                              # RAIL ISLAND 閃光
        add('fx', pluck(m, 0.5, 1.4), 1.9 + i * 0.07, 0.10, pan=-0.5 + i * 0.2, verb=0.4)
    add('fx', whoosh(0.5, 0.7, 800, 5000, 2000, -0.3, 0.3), 2.0, 0.12)             # 箭頭伸出
    add('fx', reverse_crash(0.6), 2.2, 0.35)
    hit(2.8, 1.0)
    add('fx', THUD, 2.8, 0.7, verb=0.3)                                           # 印章蓋下
    add('drums', CLAP, 2.8, 0.5, verb=0.4)
    add('fx', riser(1.15), 2.8, 0.30)
    roll(3.2, 3.95, 2, 4, 0.40)
    add('fx', whoosh(0.75, 0.92, 200, 6000, 6000, 0, 0), 3.25, 0.40)               # 穿越島形放大

    # 2. 標語（4.0–7.2）
    hit(4.0, 1.1, chord=[74, 78, 81, 86])
    for t, m in ((4.8, 74), (5.2, 76), (5.6, 78)):                                # 逐字重擊
        kick(t, 0.95)
        add('music', supersaw([m, m + 4, m + 7], 0.3, cutoff=6000, r=0.2), t, 0.4, verb=0.2)
        add('drums', CLAP, t, 0.28, verb=0.2)
    add('fx', THUD, 6.0, 0.6, verb=0.3)                                           # 紅圈圈住「說故事」
    add('fx', bell(81, 1.4), 6.0, 0.16, verb=0.4)
    kick(6.0, 0.8)
    add('drums', CLAP, 6.4, 0.5, verb=0.25)
    add('fx', whoosh(0.55, 0.75, 250, 5000, 900, 0.9, -0.9), 6.85, 0.55)            # 甩鏡
    hit(7.2, 0.9)

    # 3. 掃 QR（7.2–12.0）
    t = tt(0.95)
    scan = np.sin(2 * np.pi * np.cumsum(900 * 2 ** (t / 0.95 * 1.4)) / SR) * (0.6 + 0.4 * np.sin(2 * np.pi * 18 * t)) * np.minimum(1, t / 0.1) * np.minimum(1, (0.95 - t) / 0.1)
    add('fx', scan, 7.7, 0.05, pan=-0.3)                                          # 金色掃描線
    hit(8.8, 0.9)
    add('fx', filt(noise(0.3), 'highpass', 3000) * np.exp(-tt(0.3) / 0.03), 8.78, 0.25)   # 閃白
    add('fx', bell(86, 1.8, 3.0, 1.2), 8.8, 0.18, verb=0.4)
    for t, m in ((9.4, 81), (9.6, 86), (9.8, 90)):                                # 三個勾勾
        add('fx', bell(m, 0.9), t, 0.17, pan=-0.2, verb=0.3)
    add('fx', whoosh(1.0, 0.8, 200, 1800, 800, 0, 0), 10.2, 0.18)                  # 推鏡
    add('fx', riser(0.8), 11.2, 0.28)
    roll(11.6, 12.0, 4, 4, 0.35)

    # 4. 只列會停的站（12.0–15.2）
    hit(12.0, 0.8)
    for i, m in enumerate([74, 76, 78, 81, 83, 86, 88, 90]):                      # 站名卡依序彈出
        add('fx', pluck(m, 0.4, 1.2), 12.16 + 0.08 * i, 0.16, pan=-0.6 + 0.17 * i, verb=0.2)
    add('fx', TICK, 13.95, 0.5)                                                   # 點下「十分」
    add('fx', bell(81, 1.2), 14.0, 0.22, verb=0.35)
    add('fx', blip(93), 14.0, 0.12)
    add('fx', riser(1.15), 14.0, 0.30)
    add('fx', whoosh(0.8, 0.9, 200, 5000, 5000, 0, 0), 14.4, 0.3)                  # 鑽進站卡
    roll(14.8, 15.15, 4, 4, 0.40)

    # 5. 十分登場（15.2–20.0）
    add('fx', reverse_crash(0.8), 14.4, 0.3)
    hit(15.2, 1.2, chord=[74, 78, 81, 86])
    add('fx', THUD, 15.2, 0.6)
    add('fx', whoosh(0.8, 0.5, 300, 2400, 600, -0.4, 0.4), 15.55, 0.14)            # 照片撐開
    for i in range(9):
        add('fx', TICK, 16.43 + 0.0715 * i, 0.10, pan=0.2)                         # 主題句打字
    for t, m in ((17.34, 86), (17.46, 88), (17.59, 90)):                          # 主題標籤
        add('fx', blip(m), t, 0.13, pan=0.3)
    add('fx', whoosh(0.8, 0.85, 3000, 400, 300, 0.3, -0.3), 18.0, 0.22)            # 拉遠成手機
    add('music', supersaw([86, 90, 93], 0.3, cutoff=6000, r=0.2), 18.8, 0.25, verb=0.2)

    # 6. 功能連發（20.0–28.0）：每鏡一小節，刷屏轉場對準強拍
    for i, c in enumerate([20.0, 21.6, 23.2, 24.8, 26.4]):
        if i:
            add('fx', whoosh(0.44, 0.5, 300, 4000, 700, -0.9, 0.9), c - 0.22, 0.38)
        hit(c, 1.0)
        add('fx', blip(74 + [0, 2, 4, 7, 9][i] + 12, 0.15), c, 0.16)            # 編號 01–05 音高逐鏡往上
    for i in range(3):
        add('fx', whoosh(0.4, 0.8, 600, 3500, 1500, 0.8, 0.0), 20.25 + 0.1 * i, 0.07)  # 亮點卡滑入
    for i, m in enumerate([81, 85, 88]):                                          # 路線編號蓋章
        add('fx', blip(m), 22.25 + 0.22 * i, 0.14)
    for i, m in enumerate([86, 90, 88, 93, 91]):                                  # 店家圖釘落下
        add('fx', pluck(m, 0.25, 1.5), 23.75 + 0.1 * i, 0.14, pan=-0.4 + 0.2 * i)
    add('fx', bell(86, 1.0), 24.05, 0.13, verb=0.3)
    add('fx', whoosh(0.5, 0.6, 200, 1500, 500, 0, 0), 24.95, 0.14)                 # 故事卡滑上
    for i in range(3):                                                            # 時刻板翻牌
        for j in range(7):
            add('fx', CLACK, 26.75 + 0.18 * i + j * 0.019, 0.22 * (1 - j / 9), pan=-0.4)

    # 7. 中英切換（28.0–31.2）
    add('fx', whoosh(0.44, 0.5, 300, 4000, 700, -0.9, 0.9), 27.78, 0.38)
    hit(28.0, 0.9)
    add('fx', blip(79, 0.15), 28.1, 0.14)                                          # 切換鍵彈出
    add('fx', TICK, 28.5, 0.5)                                                    # 點擊
    add('fx', CLACK, 28.8, 0.4)
    add('fx', bell(86, 1.4), 28.8, 0.2, verb=0.35)
    kick(28.8, 0.6)
    add('fx', whoosh(0.7, 0.5, 300, 2600, 400, -0.6, 0.6), 28.7, 0.24)             # 手機翻面
    add('fx', blip(88), 28.93, 0.1)
    add('fx', blip(90), 29.22, 0.1)
    add('fx', riser(0.8), 30.4, 0.26)
    roll(30.4, 31.15, 2, 4, 0.35)

    # 8. 全台路網（31.2–36.0）
    hit(31.2, 0.9)
    add('fx', whoosh(0.7, 0.85, 3000, 300, 200, 0, 0), 31.25, 0.2)                # 拉遠
    add('fx', riser(0.6, 400, 3000, 57, 69), 32.4, 0.12)                            # 示範路線亮起
    for t, m in ((33.2, 86), (34.0, 90), (34.8, 93)):                             # 三個站名牌
        add('fx', bell(m, 1.4), t, 0.2, pan={86: 0.4, 90: 0.5, 93: -0.5}[m], verb=0.35)
        add('fx', THUD, t, 0.25)
    for t in (32.8, 33.6, 34.4):
        add('fx', whoosh(0.5, 0.6, 400, 2500, 600, -0.5, 0.5), t, 0.12)             # 鏡頭飛越
    add('fx', riser(0.8), 35.2, 0.30)
    roll(35.2, 35.95, 2, 4, 0.40)

    # 9. 三站並列（36.0–42.4）
    add('fx', reverse_crash(0.8), 35.2, 0.3)
    hit(36.0, 1.1, chord=[74, 78, 81, 86])
    for i in range(3):
        add('fx', whoosh(0.5, 0.7, 200, 2200, 700, -0.5 + 0.5 * i, -0.5 + 0.5 * i), 36.0 + 0.13 * i, 0.13)
    add('fx', whoosh(0.6, 0.85, 300, 2600, 600, 0, -0.2), 38.6, 0.2)               # 推進光復
    # 39.2 光復：不放重音，只留柔和長音
    add('fx', whoosh(0.4, 0.75, 300, 3500, 700, -0.8, 0.8), 40.4, 0.3)              # 甩到通霄
    hit(40.8, 0.6)
    add('fx', bell(86, 1.0), 41.0, 0.12, verb=0.3)

    # 10. 誠實標示（42.4–47.2）
    add('fx', whoosh(0.44, 0.5, 300, 4000, 700, -0.9, 0.9), 42.18, 0.38)
    hit(42.4, 0.8)
    for t, p in ((43.2, -0.5), (44.0, 0.0), (44.8, 0.5)):                         # 三枚印章重擊
        add('fx', THUD, t, 0.95, pan=p, verb=0.3)
        kick(t, 0.9)
        impact(t, 0.45)
    add('fx', whoosh(0.5, 0.85, 300, 3000, 800, -0.9, 0.2), 45.2, 0.22)             # 示範班次帶滑入
    add('fx', THUD, 45.67, 0.3)
    roll(46.4, 47.15, 2, 4, 0.32)

    # 11. 合作模式（47.2–52.0）
    hit(47.2, 0.9)
    add('fx', whoosh(1.0, 0.9, 200, 2000, 800, -0.9, -0.2), 47.4, 0.22)             # 兩塊站名牌左右滑入
    add('fx', whoosh(1.0, 0.9, 200, 2000, 800, 0.9, 0.2), 47.4, 0.22)
    add('fx', CLUNK, 48.4, 0.8, verb=0.35)                                        # 車鉤扣上
    kick(48.4, 1.0)
    impact(48.4, 0.6)
    crash(48.4, 0.7)
    for i in range(7):                                                            # 列車通過：喀噠聲跟著列車由左到右
        t = 48.8 + i * BEAT
        p = -0.9 + 1.8 * (t - 48.66) / (51.2 - 48.66)
        v = 0.5 * np.exp(-((t - 49.9) / 1.0) ** 2) + 0.15
        for d in (0, 0.09):
            add('fx', CLACK, t + d, v, pan=float(np.clip(p, -0.9, 0.9)))
    add('fx', whoosh(2.6, 0.5, 150, 1200, 300, -0.9, 0.9), 48.66, 0.18)
    add('fx', riser(0.8), 51.2, 0.30)
    roll(51.6, 51.95, 4, 4, 0.36)

    # 12. Logo 收尾（52.0–58.0）
    hit(52.0, 0.8)
    for p in (-0.9, 0.9, -0.3, 0.3):
        add('fx', whoosh(0.6, 0.85, 300, 3000, 1000, p, 0), 52.0, 0.1)            # 路網收攏
    kick(52.85, 0.6)
    add('fx', bell(74, 1.5), 52.85, 0.16, verb=0.4)
    for i in range(4):
        add('fx', TICK, 52.86 + 0.038 * i, 0.18, pan=[-0.5, 0.5, -0.5, 0.5][i])
    add('fx', riser(0.75), 52.85, 0.25)
    for t, m in ((53.6, 50), (53.8, 57)):                                         # 「軌」「島」重擊
        kick(t, 1.0)
        add('music', supersaw([m + 12, m + 16, m + 19], 0.4, cutoff=6000, r=0.3), t, 0.4, verb=0.25)
    add('fx', reverse_crash(0.8), 52.8, 0.3)
    crash(53.6, 1.2)
    impact(53.6, 1.0)
    for i, m in enumerate([86, 88, 90, 93, 95, 98]):                              # RAIL ISLAND 閃光
        add('fx', pluck(m, 0.6, 1.4), 53.9 + i * 0.07, 0.10, pan=-0.5 + i * 0.2, verb=0.45)
    kick(54.8, 0.6)
    add('fx', bell(86, 2.4), 54.8, 0.2, verb=0.5)                                 # 「乘車導覽模式」帶
    add('fx', bell(81, 2.4), 54.8, 0.12, verb=0.5)


def sidechain():
    g = np.ones(N)
    for t, v in KICKS:
        i = int(t * SR)
        if i >= N:
            continue
        n = min(int(0.4 * SR), N - i)
        d = np.arange(n) / SR
        g[i:i + n] = np.minimum(g[i:i + n], 1 - 0.42 * v * np.exp(-d / 0.11) * np.minimum(1, d / 0.004 + 0.3))
    return g


def reverb(x):
    n = int(2.4 * SR)
    t = np.arange(n) / SR
    out = []
    for c in range(2):
        ir = rng.standard_normal(n) * np.exp(-6.9 * t / 2.0)
        ir = filt(ir, 'lowpass', 5500)
        ir[: int(0.018 * SR)] = 0
        ir /= np.sqrt(np.sum(ir ** 2))
        out.append(signal.fftconvolve(x[c], ir)[:N])
    return np.vstack(out)


def master():
    music = BUS['music'] * sidechain()
    music += signal.sosfilt(sos('bandpass', [1500, 6000]), music, axis=1) * 0.8   # 和弦與撥弦的明亮度
    mix = BUS['drums'] * 0.9 + music * 0.85 + BUS['fx'] * 0.8 + reverb(BUS['verb']) * 0.5
    mix = signal.sosfilt(sos('highpass', 32), mix, axis=1)
    # 片頭淡入一點點、片尾 56.4 秒起淡出
    t = np.arange(N) / SR
    mix *= np.minimum(1, t / 0.01) * np.clip((DUR - t) / 1.6, 0, 1) ** 1.5
    # 柔和壓縮＋軟限幅，峰值 −1 dBFS
    lvl = np.max(np.abs(mix), axis=0)
    env = signal.sosfilt(sos('lowpass', 8), lvl)
    thr = np.percentile(env, 92)
    gain = np.where(env > thr, (thr / np.maximum(env, 1e-9)) ** 0.4, 1.0)
    mix *= gain
    mix = np.tanh(mix / np.max(np.abs(mix)) * 1.2) / np.tanh(1.2)
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
