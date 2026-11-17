window.FZ = window.FZ || {};

FZ.Audio = (function () {
  let ctx = null, master = null, duckG = null, verbIn = null, white = null;
  let ambGain = null, enabled = true, ready = false;

  const rnd = (a, b) => a + Math.random() * (b - a);
  const hum = () => rnd(0.985, 1.015);
  const vel = () => rnd(0.86, 1.12);
  const N = (m) => 440 * Math.pow(2, (m - 69) / 12);

  function makeWhite(seconds) {
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  function makeImpulse(seconds, decay) {
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      let lp = 0;
      for (let i = 0; i < len; i++) {
        const t = i / len;
        lp += 0.34 * ((Math.random() * 2 - 1) - lp);
        d[i] = lp * Math.pow(1 - t, decay);
      }
      [0.011, 0.019, 0.031, 0.047].forEach((tm, k) => {
        const idx = Math.floor((tm + c * 0.004) * ctx.sampleRate);
        if (idx < len) d[idx] += (0.5 - k * 0.1) * (c ? -1 : 1);
      });
    }
    return buf;
  }

  function init() {
    if (ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) { enabled = false; return; }
    ctx = new AC();

    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -15; comp.knee.value = 14; comp.ratio.value = 3;
    comp.attack.value = 0.005; comp.release.value = 0.2;
    comp.connect(ctx.destination);

    duckG = ctx.createGain();
    duckG.gain.value = 1;
    duckG.connect(comp);

    master = ctx.createGain();
    master.gain.value = enabled ? 0.85 : 0;
    master.connect(duckG);

    const conv = ctx.createConvolver();
    conv.buffer = makeImpulse(1.7, 2.6);
    const wet = ctx.createGain();
    wet.gain.value = 0.5;
    verbIn = ctx.createGain();
    verbIn.connect(conv); conv.connect(wet); wet.connect(master);

    white = makeWhite(2);
    startAmbience();
    ready = true;
  }

  function route(node, o) {
    const p = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    if (p) { p.pan.value = o.pan == null ? rnd(-0.12, 0.12) : o.pan; node.connect(p); }
    const out = p || node;
    out.connect(master);
    const s = ctx.createGain();
    s.gain.value = o.send == null ? 0.12 : o.send;
    out.connect(s); s.connect(verbIn);
  }

  function env(param, t0, dur, vol, attack) {
    const a = attack == null ? 0.006 : attack;
    param.setValueAtTime(0.0001, t0);
    param.exponentialRampToValueAtTime(Math.max(vol, 0.0002), t0 + a);
    param.exponentialRampToValueAtTime(0.0001, t0 + dur);
  }

  /* 双振荡去谐层：厚度来自两个略微失谐的分音 */
  function osc(o) {
    if (!ctx || !enabled) return;
    const t0 = ctx.currentTime + (o.delay || 0);
    const g = ctx.createGain();
    env(g.gain, t0, o.dur, o.vol, o.attack);
    let dest = g;
    if (o.cutoff) {
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.setValueAtTime(o.cutoff, t0);
      if (o.cutoff2) lp.frequency.exponentialRampToValueAtTime(o.cutoff2, t0 + o.dur);
      lp.Q.value = o.q || 0.7;
      lp.connect(g); dest = lp;
    }
    const spread = o.spread == null ? 6 : o.spread;
    [-spread, spread].forEach((cents) => {
      const v = ctx.createOscillator();
      v.type = o.type || 'triangle';
      v.detune.value = cents;
      v.frequency.setValueAtTime(o.f, t0);
      if (o.f2) v.frequency.exponentialRampToValueAtTime(o.f2, t0 + o.dur);
      if (o.vibrato) {
        const lfo = ctx.createOscillator(), lg = ctx.createGain();
        lfo.frequency.value = o.vibrato; lg.gain.value = o.f * 0.006;
        lfo.connect(lg); lg.connect(v.frequency);
        lfo.start(t0); lfo.stop(t0 + o.dur + 0.05);
      }
      const half = ctx.createGain();
      half.gain.value = 0.5;
      v.connect(half); half.connect(dest);
      v.start(t0); v.stop(t0 + o.dur + 0.06);
    });
    route(g, o);
  }

  /* FM 铃 / 马林巴：index 越大越玻璃质，越小越木质 */
  function bell(o) {
    if (!ctx || !enabled) return;
    const t0 = ctx.currentTime + (o.delay || 0);
    const car = ctx.createOscillator(), mod = ctx.createOscillator();
    const mg = ctx.createGain(), g = ctx.createGain();
    car.type = 'sine'; mod.type = 'sine';
    car.frequency.value = o.f; mod.frequency.value = o.f * (o.ratio || 2);
    const idx = o.f * (o.index == null ? 2 : o.index);
    mg.gain.setValueAtTime(idx, t0);
    mg.gain.exponentialRampToValueAtTime(idx * 0.02, t0 + o.dur * 0.7);
    mod.connect(mg); mg.connect(car.frequency);
    env(g.gain, t0, o.dur, o.vol, o.attack);
    car.connect(g);
    route(g, o);
    car.start(t0); mod.start(t0);
    car.stop(t0 + o.dur + 0.06); mod.stop(t0 + o.dur + 0.06);
  }

  function pluck(o) {
    osc({ f: o.f, f2: o.f2, dur: o.dur, vol: o.vol, delay: o.delay, type: 'sawtooth',
      cutoff: o.cutoff || 2400, cutoff2: (o.cutoff || 2400) * 0.18, q: 3,
      spread: 9, attack: 0.004, pan: o.pan, send: o.send == null ? 0.16 : o.send });
  }

  function noise(o) {
    if (!ctx || !enabled) return;
    const t0 = ctx.currentTime + (o.delay || 0);
    const src = ctx.createBufferSource();
    src.buffer = white; src.loop = true;
    src.playbackRate.value = o.rate || rnd(0.9, 1.1);
    const f = ctx.createBiquadFilter();
    f.type = o.type || 'bandpass';
    f.frequency.setValueAtTime(o.f, t0);
    if (o.f2) f.frequency.exponentialRampToValueAtTime(o.f2, t0 + o.dur);
    f.Q.value = o.q == null ? 1 : o.q;
    const g = ctx.createGain();
    env(g.gain, t0, o.dur, o.vol, o.attack);
    src.connect(f); f.connect(g);
    route(g, o);
    src.start(t0, rnd(0, 1.4)); src.stop(t0 + o.dur + 0.06);
  }

  function sub(o) {
    if (!ctx || !enabled) return;
    const t0 = ctx.currentTime + (o.delay || 0);
    const v = ctx.createOscillator(), g = ctx.createGain();
    v.type = 'sine';
    v.frequency.setValueAtTime(o.f0, t0);
    v.frequency.exponentialRampToValueAtTime(o.f1, t0 + o.dur * 0.85);
    env(g.gain, t0, o.dur, o.vol, o.attack == null ? 0.008 : o.attack);
    v.connect(g); route(g, { send: o.send == null ? 0.06 : o.send, pan: 0 });
    v.start(t0); v.stop(t0 + o.dur + 0.06);
  }

  function arp(notes, step, fn) { notes.forEach((n, i) => fn(n, i * step, i)); }

  function startAmbience() {
    ambGain = ctx.createGain();
    ambGain.gain.value = 0;
    ambGain.connect(master);

    const src = ctx.createBufferSource();
    src.buffer = white; src.loop = true;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 430;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass'; hp.frequency.value = 95;
    const roomG = ctx.createGain(); roomG.gain.value = 0.16;
    src.connect(lp); lp.connect(hp); hp.connect(roomG); roomG.connect(ambGain);
    src.start();

    const sweep = ctx.createOscillator(), sweepG = ctx.createGain();
    sweep.frequency.value = 0.045; sweepG.gain.value = 150;
    sweep.connect(sweepG); sweepG.connect(lp.frequency); sweep.start();

    const padG = ctx.createGain(); padG.gain.value = 0.05;
    const padLp = ctx.createBiquadFilter();
    padLp.type = 'lowpass'; padLp.frequency.value = 620;
    padG.connect(padLp); padLp.connect(ambGain);
    [55, 82.5, 110, 164.8].forEach((f, i) => {
      const v = ctx.createOscillator();
      v.type = i > 1 ? 'sine' : 'triangle';
      v.frequency.value = f;
      v.detune.value = (i % 2 ? 5 : -5);
      const g = ctx.createGain();
      g.gain.value = i > 1 ? 0.32 : 0.6;
      const lfo = ctx.createOscillator(), lg = ctx.createGain();
      lfo.frequency.value = 0.031 + i * 0.017;
      lg.gain.value = i > 1 ? 0.22 : 0.3;
      lfo.connect(lg); lg.connect(g.gain);
      v.connect(g); g.connect(padG);
      v.start(); lfo.start();
    });

    ambGain.gain.setTargetAtTime(0.2, ctx.currentTime, 2.5);
  }

  const SFX = {
    /* 脚步：室内木地板闷响，室外湿地脆响 */
    step(o) {
      const ind = o && o.indoor, run = o && o.run;
      const v = (run ? 0.055 : 0.032) * vel();
      noise({ dur: ind ? 0.055 : 0.04, f: (ind ? 620 : 2100) * hum(), f2: ind ? 220 : 700,
        q: ind ? 1.1 : 0.7, vol: v, pan: rnd(-0.3, 0.3), send: ind ? 0.22 : 0.34 });
      sub({ f0: (ind ? 120 : 165) * hum(), f1: ind ? 58 : 80, dur: 0.05, vol: v * 0.7 });
    },
    tap() {
      const p = hum(), v = vel();
      noise({ dur: 0.035, f: 2300 * p, f2: 900, q: 1.3, vol: 0.09 * v, send: 0.1 });
      bell({ f: N(84) * p, ratio: 2, index: 1.6, dur: 0.09, vol: 0.05 * v, send: 0.2 });
      sub({ f0: 190 * p, f1: 95, dur: 0.06, vol: 0.05 * v });
    },
    hover() {
      osc({ f: N(96) * hum(), dur: 0.05, type: 'sine', vol: 0.02 * vel(), spread: 4, send: 0.3 });
      noise({ dur: 0.025, f: 5400, q: 0.6, vol: 0.01, send: 0.25 });
    },
    page() {
      const p = hum();
      noise({ dur: 0.13, f: 3400 * p, f2: 1500, q: 0.6, vol: 0.07, pan: -0.22, send: 0.24 });
      noise({ dur: 0.1, f: 2100 * p, f2: 900, q: 0.8, vol: 0.05, delay: 0.06, pan: 0.24, send: 0.26 });
      noise({ dur: 0.07, f: 4900, f2: 2600, q: 0.5, vol: 0.03, delay: 0.13, pan: 0.04, send: 0.2 });
      pluck({ f: N(60) * p, dur: 0.12, vol: 0.045, cutoff: 1300, delay: 0.02 });
    },

    /* 四种属性各有音色：知识玻璃铃、体力暖垫、心态马林巴、人脉气泡 */
    gainK() {
      const p = hum();
      arp([84, 88, 91], 0.06, (n, d) => bell({ f: N(n) * p, ratio: 3.5, index: 2.4, dur: 0.42, vol: 0.085, delay: d, send: 0.38 }));
      noise({ dur: 0.18, f: 6200, f2: 9000, q: 0.5, vol: 0.022, delay: 0.05, send: 0.4 });
    },
    gainS() {
      const p = hum();
      [60, 64, 67].forEach((n, i) => osc({ f: N(n) * p, dur: 0.75, type: 'triangle', vol: 0.06, attack: 0.14, delay: i * 0.03, cutoff: 1400, spread: 8, send: 0.3 }));
      sub({ f0: 92, f1: 58, dur: 0.3, vol: 0.1, attack: 0.03 });
      noise({ dur: 0.5, f: 700, f2: 320, type: 'lowpass', vol: 0.03, attack: 0.16, send: 0.25 });
    },
    gainM() {
      const p = hum();
      arp([76, 83], 0.085, (n, d) => bell({ f: N(n) * p, ratio: 2, index: 1.1, dur: 0.34, vol: 0.1, delay: d, send: 0.32 }));
      bell({ f: N(88) * p, ratio: 1.5, index: 0.6, dur: 0.6, vol: 0.035, delay: 0.14, send: 0.45 });
    },
    gainP() {
      const p = hum();
      osc({ f: 420 * p, f2: 940 * p, dur: 0.08, type: 'sine', vol: 0.11, spread: 2, send: 0.18 });
      arp([88, 93], 0.075, (n, d) => osc({ f: N(n) * p, dur: 0.2, type: 'sine', vol: 0.06, delay: 0.06 + d, vibrato: 6, send: 0.35 }));
      noise({ dur: 0.12, f: 7000, q: 0.4, vol: 0.018, delay: 0.1, send: 0.4 });
    },
    gain() {
      const p = hum();
      arp([72, 76, 79], 0.065, (n, d) => bell({ f: N(n) * p, ratio: 2.5, index: 1.6, dur: 0.4, vol: 0.085, delay: d, send: 0.34 }));
    },

    lossK() {
      const p = hum();
      arp([83, 79, 74, 71], 0.075, (n, d) => bell({ f: N(n) * p * 0.995, ratio: 3.2, index: 2.8, dur: 0.3, vol: 0.07, delay: d, send: 0.3 }));
      noise({ dur: 0.22, f: 5200, f2: 1800, q: 0.7, vol: 0.035, delay: 0.04, send: 0.3 });
    },
    lossS() {
      [0, 0.26].forEach((d, i) => sub({ f0: 72, f1: 38, dur: 0.24, vol: i ? 0.16 : 0.24, delay: d }));
      osc({ f: 118, f2: 72, dur: 0.7, type: 'sawtooth', vol: 0.06, cutoff: 620, cutoff2: 200, spread: 12, attack: 0.05, send: 0.2 });
      noise({ dur: 0.45, f: 480, f2: 200, type: 'lowpass', vol: 0.04, attack: 0.1, delay: 0.1 });
    },
    lossM() {
      const p = hum();
      [62, 63].forEach((n) => osc({ f: N(n) * p, dur: 0.62, type: 'sawtooth', vol: 0.05, cutoff: 1500, cutoff2: 320, spread: 16, attack: 0.03, send: 0.28 }));
      noise({ dur: 0.5, f: 1600, f2: 420, q: 0.5, vol: 0.04, attack: 0.08, send: 0.3 });
      sub({ f0: 110, f1: 55, dur: 0.35, vol: 0.09 });
    },
    lossP() {
      const p = hum();
      arp([57, 53], 0.11, (n, d) => pluck({ f: N(n) * p, dur: 0.28, vol: 0.075, cutoff: 700, delay: d, send: 0.2 }));
      sub({ f0: 130, f1: 70, dur: 0.16, vol: 0.08, delay: 0.02 });
    },
    loss() {
      const p = hum();
      osc({ f: 340 * p, f2: 155, dur: 0.5, type: 'sawtooth', vol: 0.075, cutoff: 1600, cutoff2: 260, spread: 14, send: 0.24 });
      sub({ f0: 150, f1: 48, dur: 0.34, vol: 0.16 });
      noise({ dur: 0.2, f: 1200, f2: 300, q: 0.6, vol: 0.05, send: 0.22 });
    },
    mixed() {
      const p = hum();
      bell({ f: N(70) * p, ratio: 2, index: 1.2, dur: 0.24, vol: 0.075, send: 0.24 });
      pluck({ f: N(77) * p, dur: 0.2, vol: 0.05, cutoff: 1800, delay: 0.07, send: 0.26 });
    },
    combo(o) {
      const lv = Math.min(Math.max((o && o.level) || 3, 3), 8);
      const base = 72 + (lv - 3) * 2, p = hum();
      arp([0, 4, 7, 12], 0.055, (iv, d) => bell({ f: N(base + iv) * p, ratio: 2 + lv * 0.12, index: 1.4 + lv * 0.1, dur: 0.3, vol: 0.07, delay: d, send: 0.36 }));
      osc({ f: N(base + 19) * p, dur: 0.5, type: 'sine', vol: 0.03, delay: 0.2, vibrato: 7, send: 0.5 });
      sub({ f0: 150, f1: 70, dur: 0.16, vol: 0.08 });
      noise({ dur: 0.3, f: 6800, f2: 11000, q: 0.4, vol: 0.02, delay: 0.16, send: 0.45 });
    },
    warn() {
      const p = hum();
      [0, 0.19, 0.38].forEach((d, i) => {
        const f = (i % 2 ? 196 : 233) * p;
        osc({ f: f, f2: f * 0.94, dur: 0.17, type: 'square', vol: 0.055, cutoff: 1100, spread: 10, delay: d, send: 0.2 });
        sub({ f0: 96, f1: 62, dur: 0.12, vol: 0.11, delay: d });
      });
      noise({ dur: 0.5, f: 2600, f2: 900, q: 0.8, vol: 0.03, attack: 0.05, send: 0.3 });
    },
    /* 两种告警各带一层身体感：体力是心跳，心态是失谐 */
    warnS() {
      SFX.warn();
      [0.05, 0.31].forEach((d, i) => sub({ f0: 70, f1: 36, dur: 0.26, vol: i ? 0.14 : 0.2, delay: d }));
      noise({ dur: 0.6, f: 420, f2: 180, type: 'lowpass', vol: 0.04, attack: 0.12, delay: 0.08 });
    },
    warnM() {
      SFX.warn();
      [62, 63].forEach((n) => osc({ f: N(n), dur: 0.7, type: 'sawtooth', vol: 0.04, cutoff: 1400, cutoff2: 380, spread: 18, attack: 0.06, delay: 0.04, send: 0.3 }));
    },
    dayend() {
      const p = hum();
      [57, 60, 64, 67].forEach((n, i) => osc({ f: N(n) * p, dur: 1.9, type: i > 1 ? 'sine' : 'triangle', vol: 0.05, attack: 0.5, delay: i * 0.09, cutoff: 1100, spread: 7, send: 0.45 }));
      noise({ dur: 1.3, f: 900, f2: 200, type: 'lowpass', vol: 0.045, attack: 0.4, pan: -0.3, send: 0.4 });
      bell({ f: N(88) * p, ratio: 1.5, index: 0.8, dur: 1.5, vol: 0.05, delay: 0.5, send: 0.6 });
      sub({ f0: 82, f1: 41, dur: 0.7, vol: 0.09, attack: 0.08 });
    },
    exam() {
      const p = hum();
      [38, 45].forEach((n) => osc({ f: N(n) * p, dur: 1.7, type: 'sawtooth', vol: 0.05, attack: 0.3, cutoff: 340, spread: 12, send: 0.3 }));
      [0.1, 0.42].forEach((d, i) => sub({ f0: 68, f1: 36, dur: 0.26, vol: i ? 0.14 : 0.22, delay: d }));
      noise({ dur: 0.35, f: 3200, f2: 1200, q: 0.6, vol: 0.06, delay: 0.02, send: 0.3 });
      osc({ f: N(93) * p, dur: 1.5, type: 'sine', vol: 0.022, attack: 0.6, vibrato: 4, send: 0.55 });
    },
    stamp() {
      const p = hum();
      sub({ f0: 128 * p, f1: 44, dur: 0.24, vol: 0.3 });
      noise({ dur: 0.09, f: 1900, f2: 220, q: 0.7, vol: 0.2, send: 0.22 });
      bell({ f: 220 * p, ratio: 1.4, index: 1.8, dur: 0.14, vol: 0.1, send: 0.3 });
      noise({ dur: 0.3, f: 500, f2: 160, type: 'lowpass', vol: 0.05, delay: 0.03, send: 0.35 });
    },
    win() {
      const p = hum();
      sub({ f0: 100, f1: 44, dur: 0.5, vol: 0.22 });
      arp([72, 76, 79, 84, 88], 0.1, (n, d) => bell({ f: N(n) * p, ratio: 2.5, index: 1.8, dur: 0.6, vol: 0.1, delay: d, send: 0.45 }));
      [60, 64, 67, 72].forEach((n, i) => osc({ f: N(n) * p, dur: 1.8, type: 'triangle', vol: 0.045, attack: 0.25, delay: 0.42 + i * 0.04, cutoff: 2200, spread: 8, send: 0.5 }));
      for (let i = 0; i < 6; i++) bell({ f: N(96 + Math.floor(rnd(0, 12))) * p, ratio: 3.5, index: 1.2, dur: 0.35, vol: 0.03, delay: 0.5 + i * 0.09, pan: rnd(-0.6, 0.6), send: 0.6 });
    },
    fail() {
      const p = hum();
      arp([72, 68, 65, 60], 0.17, (n, d) => bell({ f: N(n) * p, ratio: 1.5, index: 1.1, dur: 0.7, vol: 0.085, delay: d, send: 0.45 }));
      [48, 51, 55].forEach((n, i) => osc({ f: N(n) * p, dur: 2, type: 'sine', vol: 0.05, attack: 0.5, delay: 0.2 + i * 0.06, spread: 11, send: 0.5 }));
      noise({ dur: 1.1, f: 800, f2: 220, type: 'lowpass', vol: 0.035, attack: 0.35, send: 0.4 });
      sub({ f0: 90, f1: 40, dur: 0.8, vol: 0.12, attack: 0.1, delay: 0.1 });
    },
    tick() {
      const p = rnd(0.85, 1.15);
      noise({ dur: 0.013, f: 3200 * p, q: 2.2, vol: 0.022, send: 0.06 });
      bell({ f: 1900 * p, ratio: 1.4, index: 0.5, dur: 0.022, vol: 0.012, send: 0.05 });
    }
  };

  return {
    unlock() {
      init();
      if (ctx && ctx.state === 'suspended') ctx.resume();
    },
    play(name, opt) {
      if (!enabled) return;
      if (!ready) init();
      if (!ctx) return;
      if (ctx.state === 'suspended') ctx.resume();
      const fn = SFX[name];
      if (fn) fn(opt);
    },
    /* 语音播报时压低背景，说完自动恢复 */
    duck(amount, seconds) {
      if (!ctx || !duckG) return;
      const t = ctx.currentTime;
      duckG.gain.cancelScheduledValues(t);
      duckG.gain.setTargetAtTime(amount, t, 0.08);
      duckG.gain.setTargetAtTime(1, t + Math.max(seconds || 3, 0.4), 0.25);
    },
    setEnabled(on) {
      enabled = on;
      if (on) this.unlock();
      if (master && ctx) master.gain.setTargetAtTime(on ? 0.85 : 0, ctx.currentTime, 0.08);
    },
    isEnabled() { return enabled; },
    supported() { return !!(window.AudioContext || window.webkitAudioContext); }
  };
})();
