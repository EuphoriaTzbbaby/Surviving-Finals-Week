window.FZ = window.FZ || {};

FZ.Audio = (function () {
  let ctx = null, master = null, ambGain = null, ambNodes = [], started = false;
  let enabled = true;

  function init() {
    if (ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) { enabled = false; return; }
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = enabled ? 0.9 : 0;
    master.connect(ctx.destination);
    startAmbience();
    started = true;
  }

  function noiseBuffer(seconds) {
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      const white = Math.random() * 2 - 1;
      last = (last + 0.02 * white) / 1.02;
      d[i] = last * 3.2;
    }
    return buf;
  }

  function startAmbience() {
    ambGain = ctx.createGain();
    ambGain.gain.value = 0.0;
    ambGain.connect(master);

    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer(4);
    src.loop = true;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 420;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 90;
    src.connect(lp); lp.connect(hp); hp.connect(ambGain);
    src.start();

    const pad = ctx.createOscillator();
    pad.type = 'sine';
    pad.frequency.value = 55;
    const padGain = ctx.createGain();
    padGain.gain.value = 0.05;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.07;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 0.03;
    lfo.connect(lfoGain); lfoGain.connect(padGain.gain);
    pad.connect(padGain); padGain.connect(ambGain);
    pad.start(); lfo.start();

    ambGain.gain.setTargetAtTime(0.16, ctx.currentTime, 2.5);
    ambNodes = [src, pad, lfo];
  }

  function tone(freq, dur, type, vol, delay, glideTo) {
    if (!ctx || !enabled) return;
    const t0 = ctx.currentTime + (delay || 0);
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type || 'triangle';
    osc.frequency.setValueAtTime(freq, t0);
    if (glideTo) osc.frequency.exponentialRampToValueAtTime(glideTo, t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol || 0.18, t0 + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g); g.connect(master);
    osc.start(t0); osc.stop(t0 + dur + 0.05);
  }

  function burst(dur, freq, vol, delay) {
    if (!ctx || !enabled) return;
    const t0 = ctx.currentTime + (delay || 0);
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer(dur + 0.1);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = freq;
    bp.Q.value = 0.8;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol || 0.12, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(bp); bp.connect(g); g.connect(master);
    src.start(t0); src.stop(t0 + dur + 0.1);
  }

  const SFX = {
    tap:     () => tone(660, 0.07, 'triangle', 0.10),
    hover:   () => tone(880, 0.035, 'sine', 0.035),
    page:    () => { burst(0.16, 2400, 0.09); burst(0.1, 1400, 0.05, 0.07); },
    gain:    () => { tone(523, 0.1, 'triangle', 0.13); tone(784, 0.16, 'triangle', 0.11, 0.07); },
    loss:    () => { tone(330, 0.22, 'sawtooth', 0.08, 0, 180); },
    mixed:   () => { tone(440, 0.09, 'triangle', 0.10); tone(587, 0.12, 'sine', 0.08, 0.06); },
    combo:   () => { tone(880, 0.08, 'square', 0.06); tone(1174, 0.1, 'square', 0.05, 0.06); tone(1568, 0.14, 'sine', 0.06, 0.12); },
    warn:    () => { tone(196, 0.3, 'sawtooth', 0.09); tone(185, 0.34, 'sawtooth', 0.07, 0.05); },
    dayend:  () => { [261, 329, 392, 523].forEach((f, i) => tone(f, 0.9, 'sine', 0.07, i * 0.1)); },
    exam:    () => { tone(110, 1.4, 'sawtooth', 0.07); tone(113, 1.4, 'sine', 0.05, 0.02); burst(0.4, 3000, 0.06); },
    stamp:   () => { burst(0.13, 180, 0.28); tone(90, 0.2, 'sine', 0.16); },
    win:     () => { [523, 659, 784, 1046, 1318].forEach((f, i) => tone(f, 0.5, 'triangle', 0.11, i * 0.11)); },
    fail:    () => { [392, 349, 294, 233].forEach((f, i) => tone(f, 0.6, 'sine', 0.11, i * 0.16)); },
    tick:    () => tone(1200, 0.02, 'square', 0.025)
  };

  return {
    unlock() {
      init();
      if (ctx && ctx.state === 'suspended') ctx.resume();
    },
    play(name) {
      if (!enabled) return;
      if (!started) init();
      if (!ctx) return;
      if (ctx.state === 'suspended') ctx.resume();
      const fn = SFX[name];
      if (fn) fn();
    },
    setEnabled(on) {
      enabled = on;
      if (on) { this.unlock(); }
      if (master && ctx) master.gain.setTargetAtTime(on ? 0.9 : 0, ctx.currentTime, 0.08);
    },
    isEnabled() { return enabled; },
    supported() { return !!(window.AudioContext || window.webkitAudioContext); }
  };
})();
