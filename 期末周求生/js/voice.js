window.FZ = window.FZ || {};

/* 剧情语音：优先播放本机预制的甜妹音色片段（assets/voice，见 tools/voice_gen.py），
   片段不可用时退回浏览器 TTS，并按同一套情绪参数调音，保证任何环境都有声音。 */
FZ.Voice = (function () {
  const synth = window.speechSynthesis || null;
  const LINES = FZ.VOICE_LINES || {};
  const BASE = 'assets/voice/';
  let enabled = true, clipMode = true, unlocked = false;
  let lastKey = '', lastAt = 0, cur = null;
  const pool = {}, lastIdx = {};

  /* 片段已按情绪烘焙语速与音调，这里只留音量与 TTS 兜底参数 */
  const MOOD = {
    calm:     { vol: 0.88, rate: 1.00, pitch: 1.30 },
    uplift:   { vol: 0.98, rate: 1.08, pitch: 1.42 },
    panic:    { vol: 1.00, rate: 1.16, pitch: 1.50 },
    surprise: { vol: 1.00, rate: 1.10, pitch: 1.55 },
    tense:    { vol: 0.86, rate: 0.96, pitch: 1.22 },
    warm:     { vol: 0.90, rate: 0.98, pitch: 1.28 }
  };
  const SWEET = ['婷婷', 'Tingting', 'Sandy', 'Meijia', '美佳', '语舒', 'Flo', 'Shelley', 'Sinji', '善怡'];
  let zhVoice = null;

  function pickVoice() {
    if (!synth) return;
    const vs = synth.getVoices().filter((v) => /^zh/i.test(v.lang));
    const cn = vs.filter((v) => /zh[-_]CN/i.test(v.lang));
    const list = cn.length ? cn : vs;
    for (const name of SWEET) {
      const hit = list.find((v) => v.name.indexOf(name) >= 0);
      if (hit) { zhVoice = hit; return; }
    }
    zhVoice = list[0] || null;
  }
  if (synth) { pickVoice(); synth.addEventListener('voiceschanged', pickVoice); }

  function bankOf(key) { return LINES[key] && LINES[key].clips ? LINES[key] : null; }

  function clipsOf(key) {
    if (pool[key]) return pool[key];
    const bank = LINES[key];
    const n = (bank && bank.clips) || 0;
    const arr = [];
    for (let i = 1; i <= n; i++) {
      const a = new Audio(BASE + key + '-' + i + '.m4a');
      a.preload = 'auto';
      a.addEventListener('error', () => { clipMode = false; });
      arr.push(a);
    }
    pool[key] = arr;
    return arr;
  }

  function variant(key, bank) {
    const n = bank.clips || bank.say.length;
    if (n <= 1) return 0;
    let i = Math.floor(Math.random() * n);
    if (i === lastIdx[key]) i = (i + 1) % n;
    lastIdx[key] = i;
    return i;
  }

  function duckFor(seconds) {
    if (FZ.Audio && FZ.Audio.duck) FZ.Audio.duck(0.42, seconds);
  }

  function speakTTS(key, bank, i) {
    if (!synth) return;
    const mood = MOOD[bank.mood] || MOOD.calm;
    const text = bank.say[i % bank.say.length];
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'zh-CN';
    if (zhVoice) u.voice = zhVoice;
    u.rate = mood.rate * (0.98 + Math.random() * 0.05);
    u.pitch = Math.min(mood.pitch + (Math.random() - 0.5) * 0.1, 2);
    u.volume = mood.vol;
    synth.cancel();
    synth.speak(u);
    duckFor(text.length * 0.22);
  }

  function say(key) {
    if (!enabled) return;
    const bank = LINES[key];
    if (!bank || !bank.say || !bank.say.length) return;
    const now = Date.now();
    if (key === lastKey && now - lastAt < 6000) return;
    lastKey = key; lastAt = now;
    stop();
    const i = variant(key, bank);
    const mood = MOOD[bank.mood] || MOOD.calm;
    const arr = clipMode && bank.clips ? clipsOf(key) : [];
    const a = arr[i];
    if (!a) { clipMode = !bank.clips ? clipMode : false; speakTTS(key, bank, i); return; }
    a.volume = mood.vol;
    a.playbackRate = 0.99 + Math.random() * 0.03;
    try { a.currentTime = 0; } catch (e) { /* 尚未加载元数据 */ }
    cur = a;
    const p = a.play();
    duckFor(a.duration && isFinite(a.duration) ? a.duration : bank.say[i].length * 0.22);
    if (p && p.catch) p.catch(() => { clipMode = false; cur = null; speakTTS(key, bank, i); });
  }

  function stop() {
    if (cur) { try { cur.pause(); cur.currentTime = 0; } catch (e) { /* 忽略 */ } cur = null; }
    if (synth) synth.cancel();
  }

  return {
    say,
    stop,
    /* 首次用户手势后调用：预载开局最可能用到的两组，其余按需加载 */
    unlock() {
      if (unlocked) return;
      unlocked = true;
      ['start', 'focus'].forEach((k) => { if (bankOf(k)) clipsOf(k).forEach((a) => a.load()); });
    },
    setEnabled(on) { enabled = !!on; if (!on) stop(); else this.unlock(); },
    isEnabled() { return enabled; },
    mode() { return clipMode ? 'clip' : 'tts'; },
    supported() { return clipMode || !!synth; }
  };
})();