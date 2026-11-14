window.FZ = window.FZ || {};

/* 剧情语音：浏览器自带 TTS，零外部依赖。情绪决定语速/音调，节点决定台词。 */
FZ.Voice = (function () {
  const synth = window.speechSynthesis || null;
  let enabled = true, zhVoice = null, lastKey = '', lastAt = 0;

  const MOOD = {
    calm:     { rate: 0.98, pitch: 1.00, volume: 0.9 },
    uplift:   { rate: 1.06, pitch: 1.12, volume: 1.0 },
    panic:    { rate: 1.18, pitch: 1.24, volume: 1.0 },
    surprise: { rate: 1.12, pitch: 1.30, volume: 1.0 },
    tense:    { rate: 0.92, pitch: 0.86, volume: 0.95 },
    warm:     { rate: 0.95, pitch: 1.05, volume: 0.9 }
  };

  const LINES = {
    start:    { mood: 'calm', say: ['期末周，三天。别慌，一门一门来。', '铃响了。这三天，你说了算。'] },
    focus:    { mood: 'uplift', say: ['进入状态了！保持这个节奏。', '连击成立，脑子越转越快。', '就是这种感觉，别停。'] },
    warnS:    { mood: 'panic', say: ['体力见底了！再硬撑，学进去的也要减半。', '警告，身体在报警。去睡，现在。'] },
    warnM:    { mood: 'panic', say: ['心态快到极限了！先停下来喘口气。', '注意，你开始走神了。别逼自己。'] },
    collapse: { mood: 'panic', say: ['身体先罢工了。你被按回了床上。', '撑不住了，直接睡了过去。'] },
    burnout:  { mood: 'panic', say: ['心态先崩了。书一个字都看不进去。', '情绪决堤。今晚什么都别学了。'] },
    tip:      { mood: 'surprise', say: ['等等，有人给你递了份重点！', '人脉兑现的时刻：学长把笔记拍你桌上了。'] },
    night:    { mood: 'tense', say: ['天黑了。睡一觉，明天还在。', '又一天结束。遗忘拿走一部分，睡眠还你一部分。'] },
    exam:     { mood: 'tense', say: ['进考场。闭卷，一百二十分钟。', '试卷发下来了。深呼吸，先看会做的。'] },
    examGood: { mood: 'uplift', say: ['这题稳了。', '漂亮，下一题。'] },
    examBad:  { mood: 'surprise', say: ['啧，这题超纲了。', '别卡住，先跳过去。'] },
    win:      { mood: 'uplift', say: ['你活过了期末周！这张战绩单，是你的。', '及格线踩在脚下。三天，值了。'] },
    lose:     { mood: 'warm', say: ['没关系。重修预约成功，下学期再来。', '期末周把你留下了，但没把你打倒。'] }
  };

  function pickVoice() {
    if (!synth) return;
    const vs = synth.getVoices();
    zhVoice = vs.find((v) => /zh[-_]CN/i.test(v.lang)) || vs.find((v) => /^zh/i.test(v.lang)) || null;
  }
  if (synth) {
    pickVoice();
    synth.addEventListener('voiceschanged', pickVoice);
  }

  function say(key) {
    if (!enabled || !synth || !LINES[key]) return;
    const now = Date.now();
    if (key === lastKey && now - lastAt < 6000) return;
    lastKey = key; lastAt = now;
    const bank = LINES[key];
    const mood = MOOD[bank.mood];
    const u = new SpeechSynthesisUtterance(bank.say[Math.floor(Math.random() * bank.say.length)]);
    u.lang = 'zh-CN';
    if (zhVoice) u.voice = zhVoice;
    u.rate = mood.rate; u.pitch = mood.pitch; u.volume = mood.volume;
    synth.cancel();
    synth.speak(u);
  }

  return {
    say,
    stop() { if (synth) synth.cancel(); },
    setEnabled(on) { enabled = !!on; if (!on) this.stop(); },
    isEnabled() { return enabled; },
    supported() { return !!synth; }
  };
})();