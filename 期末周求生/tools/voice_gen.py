#!/usr/bin/env python3
"""生成剧情语音素材（甜妹音色）。

素材全部本机合成，无第三方音频：系统 TTS 出底噪干声 -> 抬音调与共振峰 -> 加气息噪声
-> EQ / 软压缩 / 短房间反射 -> AAC。台词在 voice_lines.json，改词后重跑本脚本即可。

用法：python3 tools/voice_gen.py [--only key1,key2]
依赖：macOS say / afconvert、python3 + numpy。
"""
import json
import os
import subprocess
import sys
import wave

import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_DIR = os.path.join(ROOT, 'assets', 'voice')
TMP_DIR = '/tmp/fz-voice-build'
SR = 44100
VOICE = 'Tingting'


def synth(text, rate, path):
    subprocess.run(['say', '-v', VOICE, '-r', str(rate), '-o', path,
                    '--data-format=LEI16@%d' % SR, text], check=True)
    with wave.open(path) as w:
        return np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(np.float32) / 32768.0


def shape(x, gain):
    pad = int(0.25 * SR)
    xp = np.concatenate([np.zeros(pad, np.float32), x, np.zeros(pad, np.float32)])
    spec = np.fft.rfft(xp)
    f = np.fft.rfftfreq(len(xp), 1.0 / SR)
    spec *= gain(f)
    return np.fft.irfft(spec, n=len(xp))[pad:pad + len(x)].astype(np.float32)


def smooth(x, ms):
    n = max(int(SR * ms / 1000.0), 1)
    c = np.cumsum(np.concatenate([[0.0], x]))
    out = (c[n:] - c[:-n]) / n
    return np.concatenate([np.full(n - 1, out[0]), out]).astype(np.float32)


def lift(x, factor):
    """整体抬升音调与共振峰，叠加极缓慢的音高漂移，去掉合成腔的平直感。"""
    n = int(len(x) / factor)
    t = np.arange(n) / SR
    rate = factor * (1 + 0.0035 * np.sin(2 * np.pi * 4.7 * t)
                     + 0.0022 * np.sin(2 * np.pi * 0.23 * t))
    pos = np.concatenate([[0.0], np.cumsum(rate)[:-1]])
    pos = np.minimum(pos, len(x) - 2)
    return np.interp(pos, np.arange(len(x)), x).astype(np.float32)


def fft_conv(x, h):
    n = 1 << int(np.ceil(np.log2(len(x) + len(h))))
    return np.fft.irfft(np.fft.rfft(x, n) * np.fft.rfft(h, n), n)[:len(x)].astype(np.float32)


def process(x, cfg):
    peak = float(np.max(np.abs(x))) or 1.0
    idx = np.flatnonzero(np.abs(x) > peak * 0.012)
    if len(idx):
        x = x[max(idx[0] - int(0.04 * SR), 0):min(idx[-1] + int(0.08 * SR), len(x))]

    x = lift(x, cfg['lift'])

    # 气息层：跟随包络的高频噪声，抵消纯合成的干净感
    env = smooth(np.abs(x), 18)
    env = env / (float(np.max(env)) or 1.0)
    breath = shape(np.random.default_rng(7).standard_normal(len(x)).astype(np.float32),
                   lambda f: (f ** 2 / (f ** 2 + 1800.0 ** 2)) / (1 + (f / 7500.0) ** 6))
    breath *= env ** 0.8
    br = float(np.sqrt((breath ** 2).mean())) or 1.0
    xr = float(np.sqrt((x ** 2).mean())) or 1.0
    x = x + breath * (xr / br * cfg['breath'])

    air = 10 ** (cfg['air'] / 20.0) - 1
    x = shape(x, lambda f: (1 / (1 + (100.0 / np.maximum(f, 1.0)) ** 4))
              * (1 - 0.28 * np.exp(-0.5 * (np.log2(np.maximum(f, 1.0) / 2700.0) / 0.55) ** 2))
              * (1 + air * f ** 2 / (f ** 2 + 4500.0 ** 2))
              / (1 + (f / 11500.0) ** 6))

    # 软压缩：句内音量拉平，句间保持自然起伏
    e = smooth(np.abs(x), 30)
    ref = float(np.percentile(e[e > 0.005], 70)) if np.any(e > 0.005) else 1.0
    g = np.clip((ref / np.maximum(e, 1e-4)) ** 0.3, 0.7, 2.0)
    x = x * smooth(g, 20)

    # 小房间：早期反射 + 极短扩散尾，去掉贴耳的干声
    tail = np.random.default_rng(11).standard_normal(int(0.16 * SR)).astype(np.float32)
    tail *= np.exp(-np.arange(len(tail)) / (0.035 * SR))
    tail /= float(np.max(np.abs(tail)))
    wet = fft_conv(x, tail) * 0.07
    for ms, amp in ((9, 0.15), (14, -0.11), (23, 0.08), (35, -0.05)):
        d = int(ms * SR / 1000.0)
        wet[d:] += x[:-d] * amp
    x = x + wet

    x = x / (float(np.max(np.abs(x))) or 1.0) * 0.89
    fi, fo = int(0.008 * SR), int(0.03 * SR)
    x[:fi] *= np.linspace(0, 1, fi)
    x[-fo:] *= np.linspace(1, 0, fo)
    return np.concatenate([x, np.zeros(int(0.1 * SR), np.float32)])


def f0_median(x):
    F, H = int(0.045 * SR), int(0.015 * SR)
    vals = []
    for i in range(0, len(x) - F, H):
        fr = x[i:i + F]
        if float(np.sqrt((fr ** 2).mean())) < 0.03:
            continue
        fr = fr - fr.mean()
        ac = np.correlate(fr, fr, 'full')[F - 1:]
        lo, hi = int(SR / 450), int(SR / 70)
        k = lo + int(np.argmax(ac[lo:hi]))
        if ac[k] > 0.3 * ac[0]:
            vals.append(SR / k)
    return round(float(np.median(vals)), 1) if vals else 0.0


def main():
    only = None
    if '--only' in sys.argv:
        only = set(sys.argv[sys.argv.index('--only') + 1].split(','))
    data = json.load(open(os.path.join(ROOT, 'tools', 'voice_lines.json'), encoding='utf-8'))
    os.makedirs(OUT_DIR, exist_ok=True)
    os.makedirs(TMP_DIR, exist_ok=True)

    manifest, total, rows = {}, 0, []
    for key, bank in data['lines'].items():
        cfg = data[bank['mood']]
        clips = 0
        for i, text in enumerate(bank['say']):
            name = '%s-%d' % (key, i + 1)
            out = os.path.join(OUT_DIR, name + '.m4a')
            if only and key not in only:
                if os.path.exists(out):
                    clips += 1
                    total += os.path.getsize(out)
                continue
            raw = synth(text, cfg['rate'], os.path.join(TMP_DIR, name + '.wav'))
            x = process(raw, cfg)
            wav = os.path.join(TMP_DIR, name + '-out.wav')
            with wave.open(wav, 'wb') as w:
                w.setnchannels(1)
                w.setsampwidth(2)
                w.setframerate(SR)
                w.writeframes((x * 32767).astype(np.int16).tobytes())
            subprocess.run(['afconvert', '-f', 'm4af', '-d', 'aac', '-b', '40000', wav, out], check=True)
            size = os.path.getsize(out)
            total += size
            clips += 1
            rows.append((name, bank['mood'], round(len(x) / SR, 2), f0_median(x),
                         round(float(np.max(np.abs(x))), 3), round(size / 1024.0, 1)))
        manifest[key] = {'mood': bank['mood'], 'clips': clips, 'say': bank['say']}

    js = os.path.join(ROOT, 'js', 'voice-lines.js')
    with open(js, 'w', encoding='utf-8') as f:
        f.write('/* 由 tools/voice_gen.py 生成，勿手改：台词与音频片段数一一对应。 */\n')
        f.write('window.FZ = window.FZ || {};\n')
        f.write('FZ.VOICE_LINES = ' + json.dumps(manifest, ensure_ascii=False, indent=2) + ';\n')

    print('%-14s %-9s %6s %7s %6s %8s' % ('clip', 'mood', 'sec', 'f0Hz', 'peak', 'KB'))
    for r in rows:
        print('%-14s %-9s %6.2f %7.1f %6.3f %8.1f' % r)
    print('clips=%d  total=%.1f KB  manifest=%s' % (
        sum(m['clips'] for m in manifest.values()), total / 1024.0, os.path.relpath(js, ROOT)))


if __name__ == '__main__':
    main()