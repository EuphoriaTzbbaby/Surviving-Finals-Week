window.FZ = window.FZ || {};

FZ.Audio = (function () {
  let ctx = null, master = null, duckG = null, verbIn = null, white = null;
  let ambGain = null, enabled = true, ready = false, unlocked = false, resuming = false;
  let environmentGain = null, ambience = null, environmentTimer = null, environmentEvent = null;
  let environment = { scene: 'campus', slot: 0, active: false }, eventIndex = 0;

  const environments = {
    campus: { cutoff: 580, room: 0.12, pad: 0.022, interval: [6, 11], day: ['bird', 'wind'], night: ['insects', 'wind'] },
    dorm: { cutoff: 300, room: 0.045, pad: 0.025, interval: [12, 20], day: ['fan'], night: ['fan'] },
    online: { cutoff: 240, room: 0.035, pad: 0.018, interval: [14, 22], day: ['fan'], night: ['fan'] },
    library: { cutoff: 320, room: 0.035, pad: 0.02, interval: [14, 24], day: ['paper'], night: ['paper'] },
    classroom: { cutoff: 380, room: 0.045, pad: 0.024, interval: [12, 20], day: ['paper'], night: ['paper'] },
    canteen: { cutoff: 720, room: 0.075, pad: 0.018, interval: [7, 13], day: ['dishes'], night: ['dishes'] },
    print: { cutoff: 460, room: 0.06, pad: 0.016, interval: [8, 14], day: ['printer'], night: ['printer'] },
    court: { cutoff: 620, room: 0.09, pad: 0.018, interval: [5, 9], day: ['bounce', 'bird', 'wind'], night: ['bounce', 'insects'] },
    garden: { cutoff: 480, room: 0.1, pad: 0.022, interval: [6, 12], day: ['bird', 'wind'], night: ['insects', 'wind'] },
    cafe: { cutoff: 400, room: 0.055, pad: 0.028, interval: [8, 14], day: ['cup', 'coffee'], night: ['cup', 'coffee'] }
  };

  const hidden = () => typeof document !== 'undefined' && !!document.hidden;

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
    master.gain.value = enabled && !hidden() ? 0.85 : 0;
    master.connect(duckG);

    environmentGain = ctx.createGain();
    environmentGain.gain.value = 0;
    environmentGain.connect(master);

    const conv = ctx.createConvolver();
    conv.buffer = makeImpulse(1.7, 2.6);
    const wet = ctx.createGain();
    wet.gain.value = 0.5;
    verbIn = ctx.createGain();
    verbIn.connect(conv); conv.connect(wet); wet.connect(master);

    white = makeWhite(2);
    startAmbience();
    ready = true;
    ctx.addEventListener('statechange', () => syncEnvironment());
  }

  function route(node, o) {
    const p = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    if (p) { p.pan.value = o.pan == null ? rnd(-0.12, 0.12) : o.pan; node.connect(p); }
    const out = p || node;
    // 环境事件不送入共享混响，切换时整个事件都可淡出。
    if (o.bus) { out.connect(o.bus.gain); return; }
    out.connect(master);
    const s = ctx.createGain();
    s.gain.value = o.send == null ? 0.12 : o.send;
    out.connect(s); s.connect(verbIn);
  }

  function trackSource(source, o, end) {
    if (!o.bus) return;
    const bus = o.bus;
    bus.sources.set(source, end);
    source.onended = () => {
      source.disconnect();
      bus.sources.delete(source);
      if (!bus.sources.size) {
        bus.gain.disconnect();
        if (environmentEvent === bus) environmentEvent = null;
      }
    };
  }

  function env(param, t0, dur, vol, attack) {
    const a = attack == null ? 0.006 : attack;
    param.setValueAtTime(0.0001, t0);
    param.exponentialRampToValueAtTime(Math.max(vol, 0.0002), t0 + a);
    param.exponentialRampToValueAtTime(0.0001, t0 + dur);
  }

  /* 双振荡去谐层：厚度来自两个略微失谐的分音 */
  function osc(o) {
    if (!ctx || !enabled || hidden()) return;
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
        trackSource(lfo, o, t0 + o.dur + 0.05);
        lfo.start(t0); lfo.stop(t0 + o.dur + 0.05);
      }
      const half = ctx.createGain();
      half.gain.value = 0.5;
      v.connect(half); half.connect(dest);
      trackSource(v, o, t0 + o.dur + 0.06);
      v.start(t0); v.stop(t0 + o.dur + 0.06);
    });
    route(g, o);
  }

  /* FM 铃 / 马林巴：index 越大越玻璃质，越小越木质 */
  function bell(o) {
    if (!ctx || !enabled || hidden()) return;
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
    trackSource(car, o, t0 + o.dur + 0.06);
    trackSource(mod, o, t0 + o.dur + 0.06);
    car.start(t0); mod.start(t0);
    car.stop(t0 + o.dur + 0.06); mod.stop(t0 + o.dur + 0.06);
  }

  function pluck(o) {
    osc({ f: o.f, f2: o.f2, dur: o.dur, vol: o.vol, delay: o.delay, type: 'sawtooth',
      cutoff: o.cutoff || 2400, cutoff2: (o.cutoff || 2400) * 0.18, q: 3,
      spread: 9, attack: 0.004, pan: o.pan, send: o.send == null ? 0.16 : o.send, bus: o.bus });
  }

  function noise(o) {
    if (!ctx || !enabled || hidden()) return;
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
    trackSource(src, o, t0 + o.dur + 0.06);
    src.start(t0, rnd(0, 1.4)); src.stop(t0 + o.dur + 0.06);
  }

  function sub(o) {
    if (!ctx || !enabled || hidden()) return;
    const t0 = ctx.currentTime + (o.delay || 0);
    const v = ctx.createOscillator(), g = ctx.createGain();
    v.type = 'sine';
    v.frequency.setValueAtTime(o.f0, t0);
    v.frequency.exponentialRampToValueAtTime(o.f1, t0 + o.dur * 0.85);
    env(g.gain, t0, o.dur, o.vol, o.attack == null ? 0.008 : o.attack);
    v.connect(g); route(g, { send: o.send == null ? 0.06 : o.send, pan: 0, bus: o.bus });
    trackSource(v, o, t0 + o.dur + 0.06);
    v.start(t0); v.stop(t0 + o.dur + 0.06);
  }

  function arp(notes, step, fn) { notes.forEach((n, i) => fn(n, i * step, i)); }

  function startAmbience() {
    ambGain = ctx.createGain();
    ambGain.gain.value = 0;
    ambGain.connect(environmentGain);

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

    ambience = { filter: lp, room: roomG, pad: padG };
  }

  function environmentActive() {
    return !!(ready && enabled && !hidden() && environment.active && ctx.state === 'running');
  }

  function fade(param, value, seconds) {
    const t = ctx.currentTime;
    if (param.cancelAndHoldAtTime) param.cancelAndHoldAtTime(t);
    else {
      const current = param.value;
      param.cancelScheduledValues(t);
      param.setValueAtTime(current, t);
    }
    param.linearRampToValueAtTime(value, t + seconds);
  }

  function stopEnvironmentEvent() {
    if (!environmentEvent) return;
    const bus = environmentEvent;
    environmentEvent = null;
    fade(bus.gain.gain, 0, 0.24);
    bus.sources.forEach((end, source) => source.stop(Math.min(end, ctx.currentTime + 0.24)));
  }

  function clearEnvironmentTimer() {
    if (environmentTimer !== null) clearTimeout(environmentTimer);
    environmentTimer = null;
  }

  function scheduleEnvironment() {
    if (!environmentActive() || environmentTimer !== null) return;
    const interval = environments[environment.scene].interval;
    const timer = setTimeout(() => {
      if (environmentTimer !== timer) return;
      environmentTimer = null;
      if (!environmentActive()) return;
      playEnvironmentEvent();
      scheduleEnvironment();
    }, Math.max(4000, rnd(interval[0], interval[1]) * 1000));
    environmentTimer = timer;
  }

  function syncEnvironment(changed) {
    if (!ready) return;
    if (changed || !environmentActive()) {
      clearEnvironmentTimer();
      stopEnvironmentEvent();
    }
    const profile = environments[environment.scene], night = environment.slot === 2;
    fade(environmentGain.gain, environmentActive() ? 1 : 0, 0.6);
    fade(ambGain.gain, night ? 0.1 : 0.16, 1.2);
    fade(ambience.filter.frequency, profile.cutoff * (night ? 0.8 : 1), 1.2);
    fade(ambience.room.gain, profile.room, 1.2);
    fade(ambience.pad.gain, profile.pad, 1.2);
    scheduleEnvironment();
  }

  function setEnvironment(next) {
    if (!next || typeof next !== 'object') return;
    const scene = Object.prototype.hasOwnProperty.call(environments, next.scene) ? next.scene : environment.scene;
    const slot = next.slot === 0 || next.slot === 1 || next.slot === 2 ? next.slot : environment.slot;
    const active = typeof next.active === 'boolean' ? next.active : environment.active;
    if (scene === environment.scene && slot === environment.slot && active === environment.active) return;
    const changed = scene !== environment.scene || (slot === 2) !== (environment.slot === 2) || active !== environment.active;
    environment = { scene, slot, active };
    if (changed) { eventIndex = 0; syncEnvironment(true); }
  }

  function playEnvironmentEvent() {
    stopEnvironmentEvent();
    const bus = { gain: ctx.createGain(), sources: new Map() };
    bus.gain.gain.value = 0;
    bus.gain.connect(environmentGain);
    fade(bus.gain.gain, 1, 0.04);
    environmentEvent = bus;
    const night = environment.slot === 2, profile = environments[environment.scene];
    const kinds = night ? profile.night : profile.day;
    const kind = kinds[eventIndex++ % kinds.length];
    const v = (night ? 0.55 : 1) * vel(), pan = rnd(-0.45, 0.45);
    const sound = (fn, o) => fn(Object.assign({}, o, { vol: o.vol * v, pan, bus }));
    switch (kind) {
      case 'bird':
        sound(osc, { f: rnd(2200, 2800), f2: 3600, dur: 0.17, vol: 0.016, type: 'sine', spread: 2 });
        sound(osc, { f: 3100, f2: 2400, dur: 0.19, vol: 0.012, type: 'sine', spread: 2, delay: 0.2 });
        break;
      case 'insects':
        [0, 0.18, 0.36].forEach((delay) => sound(noise, { f: 4600, q: 12, dur: 0.1, vol: 0.013, attack: 0.025, delay }));
        break;
      case 'wind':
        sound(noise, { f: 520, f2: 280, q: 0.5, dur: 2.4, vol: 0.026, attack: 0.8, type: 'lowpass' });
        break;
      case 'bounce':
        sound(sub, { f0: 145, f1: 48, dur: 0.22, vol: 0.047 });
        sound(noise, { f: 1250, f2: 420, q: 0.8, dur: 0.08, vol: 0.022 });
        break;
      case 'paper':
        sound(noise, { f: 1900, f2: 850, q: 0.5, dur: 0.28, vol: 0.018, attack: 0.06 });
        break;
      case 'cup':
      case 'dishes':
        sound(bell, { f: kind === 'cup' ? 1450 : 1850, ratio: 2.7, index: 1.8, dur: 0.24, vol: 0.015 });
        sound(noise, { f: 3200, q: 1.2, dur: 0.04, vol: 0.01, delay: 0.025 });
        break;
      case 'coffee':
      case 'printer':
      case 'fan':
        sound(noise, { f: kind === 'printer' ? 680 : 260, f2: 180, type: 'lowpass', q: 0.6,
          dur: 2.2, vol: kind === 'fan' ? 0.009 : 0.021, attack: 0.5 });
        sound(osc, { f: kind === 'printer' ? 146 : 110, f2: 100, type: 'triangle', cutoff: 420,
          dur: 2, vol: kind === 'fan' ? 0.005 : 0.011, attack: 0.4, spread: 3 });
        break;
    }
  }

  function updateMaster() {
    if (!master) return;
    const t = ctx.currentTime;
    master.gain.cancelScheduledValues(t);
    if (!enabled || hidden()) master.gain.setValueAtTime(0, t);
    else master.gain.setTargetAtTime(0.85, t, 0.08);
  }

  function wake() {
    if (unlocked && enabled && !hidden()) {
      init();
      if (ctx && ctx.state === 'suspended' && !resuming) {
        resuming = true;
        try {
          Promise.resolve(ctx.resume()).then(() => {
            resuming = false;
            syncEnvironment();
          }, () => { resuming = false; syncEnvironment(); });
        } catch (_) { resuming = false; }
      }
    }
    updateMaster();
    syncEnvironment();
  }

  if (typeof document !== 'undefined' && document.addEventListener) {
    document.addEventListener('visibilitychange', () => {
      updateMaster();
      syncEnvironment(true);
      if (!hidden()) wake();
    });
  }

  const SFX = {
    /* 脚步：室内木地板闷响，室外湿地脆响 */
    step(o) {
      const ind = o && o.indoor, run = o && o.run, surface = o && o.surface;
      const v = (run ? 0.055 : 0.032) * vel();
      const floor = surface === 'court' ? [0.045, 1350, 430, 140, 65, 0.75]
        : surface === 'garden' ? [0.095, 2900, 950, 100, 45, 0.45]
        : surface === 'cafe' ? [0.05, 850, 280, 115, 55, 0.65] : null;
      if (floor) {
        noise({ dur: floor[0], f: floor[1] * hum(), f2: floor[2], q: 0.7,
          vol: v * floor[5], pan: rnd(-0.3, 0.3), send: surface === 'cafe' ? 0.18 : 0.1 });
        sub({ f0: floor[3] * hum(), f1: floor[4], dur: 0.06, vol: v * floor[5] });
        return;
      }
      noise({ dur: ind ? 0.055 : 0.04, f: (ind ? 620 : 2100) * hum(), f2: ind ? 220 : 700,
        q: ind ? 1.1 : 0.7, vol: v, pan: rnd(-0.3, 0.3), send: ind ? 0.22 : 0.34 });
      sub({ f0: (ind ? 120 : 165) * hum(), f1: ind ? 58 : 80, dur: 0.05, vol: v * 0.7 });
    },
    arrival() {
      const p = hum();
      arp([72, 79], 0.12, (n, delay) => bell({ f: N(n) * p, ratio: 1.5, index: 0.7,
        dur: 0.36, vol: 0.035, delay, send: 0.24 }));
    },
    chatOpen() {
      const p = hum();
      osc({ f: 440 * p, f2: 660 * p, dur: 0.12, type: 'sine', vol: 0.033, spread: 2, send: 0.14 });
      bell({ f: N(79) * p, ratio: 1.5, index: 0.5, dur: 0.2, vol: 0.024, delay: 0.08, send: 0.18 });
    },
    chatReply() {
      bell({ f: N(76) * hum(), ratio: 1.5, index: 0.6, dur: 0.16, vol: 0.03, send: 0.15 });
      noise({ f: 1700, f2: 800, q: 0.6, dur: 0.035, vol: 0.009, send: 0.08 });
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
      unlocked = true;
      wake();
    },
    play(name, opt) {
      if (!unlocked || !enabled || hidden()) return;
      if (!ready || (ctx && ctx.state === 'suspended')) wake();
      if (!ctx || ctx.state === 'closed') return;
      if (Object.prototype.hasOwnProperty.call(SFX, name)) SFX[name](opt);
    },
    setEnvironment,
    /* 语音播报时压低背景，说完自动恢复 */
    duck(amount, seconds) {
      if (!ctx || !duckG) return;
      const t = ctx.currentTime;
      duckG.gain.cancelScheduledValues(t);
      duckG.gain.setTargetAtTime(amount, t, 0.08);
      duckG.gain.setTargetAtTime(1, t + Math.max(seconds || 3, 0.4), 0.25);
    },
    setEnabled(on) {
      enabled = !!on;
      wake();
    },
    isEnabled() { return enabled; },
    supported() { return !!(window.AudioContext || window.webkitAudioContext); },
    debug() {
      return Object.freeze({ environment: Object.freeze(Object.assign({}, environment)),
        active: environmentActive(), ctxState: ctx ? ctx.state : 'uninitialized',
        timerScheduled: environmentTimer !== null, enabled, hidden: hidden(), unlocked });
    }
  };
})();
