window.FZ = window.FZ || {};

(function () {
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => Array.from(document.querySelectorAll(s));
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const rnd = (a, b) => a + Math.random() * (b - a);
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

  const RUN_KEY = 'fz.run.v1';
  const META_KEY = 'fz.meta.v1';

  let S = null;
  let meta = loadMeta();
  let typing = null;
  let busy = false;

  function loadMeta() {
    try {
      const raw = localStorage.getItem(META_KEY);
      if (raw) return Object.assign(defaultMeta(), JSON.parse(raw));
    } catch (e) {}
    return defaultMeta();
  }
  function defaultMeta() {
    return { runs: 0, best: 0, unlocked: [], major: '', subject: '', diff: 'normal', sound: true, passed: 0 };
  }
  function saveMeta() {
    try { localStorage.setItem(META_KEY, JSON.stringify(meta)); } catch (e) {}
  }
  function saveRun() {
    if (!S) return;
    try { localStorage.setItem(RUN_KEY, JSON.stringify(S)); } catch (e) {}
  }
  function clearRun() {
    try { localStorage.removeItem(RUN_KEY); } catch (e) {}
  }
  function loadRun() {
    try {
      const raw = localStorage.getItem(RUN_KEY);
      if (!raw) return null;
      const r = JSON.parse(raw);
      if (!r || !r.major || r.finished) return null;
      return r;
    } catch (e) { return null; }
  }

  function fill(text) {
    return String(text).replace(/\{科目\}/g, S ? S.subject : '这门课').replace(/\{专业\}/g, S ? S.major : '本专业');
  }

  /* ---------- 屏幕路由 ---------- */
  function show(id) {
    $$('.screen').forEach((el) => el.classList.toggle('active', el.id === id));
    window.scrollTo({ top: 0, behavior: 'instant' in window ? 'instant' : 'auto' });
  }

  /* ---------- 打字机 ---------- */
  function typeInto(el, text, speed, done) {
    if (typing) { clearInterval(typing.timer); typing = null; }
    el.textContent = '';
    el.classList.add('typing');
    let i = 0;
    const timer = setInterval(() => {
      i += 1;
      el.textContent = text.slice(0, i);
      if (i % 4 === 0) FZ.Audio.play('tick');
      if (i >= text.length) {
        clearInterval(timer); typing = null;
        el.classList.remove('typing');
        if (done) done();
      }
    }, speed);
    typing = { timer, el, text, done };
  }
  function skipType() {
    if (!typing) return false;
    clearInterval(typing.timer);
    typing.el.textContent = typing.text;
    typing.el.classList.remove('typing');
    const d = typing.done; typing = null;
    if (d) d();
    return true;
  }

  /* ---------- 特效 ---------- */
  function sparks(x, y, color, count) {
    const layer = $('#fx-layer');
    for (let i = 0; i < (count || 14); i++) {
      const p = document.createElement('i');
      p.className = 'spark';
      const a = rnd(0, Math.PI * 2), dist = rnd(28, 110);
      p.style.left = x + 'px'; p.style.top = y + 'px';
      p.style.background = color;
      p.style.setProperty('--dx', Math.cos(a) * dist + 'px');
      p.style.setProperty('--dy', Math.sin(a) * dist + 'px');
      p.style.animationDuration = rnd(0.45, 0.9) + 's';
      layer.appendChild(p);
      setTimeout(() => p.remove(), 1000);
    }
  }

  function floatNum(statKey, delta) {
    const gauge = document.querySelector(`.gauge[data-k="${statKey}"]`);
    if (!gauge) return;
    const r = gauge.getBoundingClientRect();
    const el = document.createElement('span');
    el.className = 'float-num ' + (delta >= 0 ? 'up' : 'down');
    el.textContent = (delta >= 0 ? '+' : '') + delta;
    el.style.left = (r.right - 26) + 'px';
    el.style.top = (r.top + r.height / 2 - 10) + 'px';
    $('#fx-layer').appendChild(el);
    setTimeout(() => el.remove(), 1200);
  }

  function shake(power) {
    const stage = $('#screen-game');
    stage.classList.remove('shake-s', 'shake-l');
    void stage.offsetWidth;
    stage.classList.add(power > 18 ? 'shake-l' : 'shake-s');
    setTimeout(() => stage.classList.remove('shake-s', 'shake-l'), 520);
  }

  function flash(color) {
    const f = $('#flash');
    f.style.background = `radial-gradient(ellipse at center, transparent 35%, ${color} 130%)`;
    f.classList.remove('on'); void f.offsetWidth; f.classList.add('on');
    setTimeout(() => f.classList.remove('on'), 620);
  }

  let toastTimer = null;
  function toast(msg, color) {
    const t = $('#toast');
    t.textContent = msg;
    t.style.borderColor = color || 'rgba(255,176,32,0.5)';
    t.classList.add('on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('on'), 2600);
  }

  /* ---------- 状态渲染 ---------- */
  function renderStats(deltas) {
    FZ.STATS.forEach((st) => {
      const g = document.querySelector(`.gauge[data-k="${st.key}"]`);
      if (!g) return;
      const v = Math.round(S.stats[st.key]);
      g.querySelector('.g-fill').style.width = v + '%';
      g.querySelector('.g-val').textContent = v;
      g.classList.toggle('low', v < 25);
      g.classList.toggle('empty', v <= 0);
      if (deltas && deltas[st.key]) {
        g.classList.remove('bump'); void g.offsetWidth; g.classList.add('bump');
        floatNum(st.key, deltas[st.key]);
      }
    });
    const f = S.focus;
    $('#focus-pips').innerHTML = Array.from({ length: 5 }, (_, i) =>
      `<i class="${i < Math.min(f, 5) ? 'on' : ''}"></i>`).join('');
    $('#focus-num').textContent = f > 0 ? `专注 ×${f}` : '专注中断';
    $('#focus-meter').classList.toggle('hot', f >= 3);

    const notes = [];
    const B = FZ.BALANCE;
    if (S.stats.s < B.lowStamina) notes.push({ t: '体力透支：知识获取减半', c: '#FFB020' });
    if (S.stats.m < B.lowMind) notes.push({ t: '心态濒临崩溃：容易走神', c: '#FF3D8B' });
    if (S.stats.s <= B.collapseAt) notes.push({ t: '身体即将强制罢工', c: '#FF4D4D' });
    if (S.stats.m <= B.burnoutAt) notes.push({ t: '心态即将强制崩盘', c: '#FF4D4D' });
    if (S.stats.n >= B.netGate[0][0]) notes.push({ t: '人脉广：考场情报加成已激活', c: '#35D6F5' });
    if (S.focus >= 3) notes.push({ t: `专注连击：知识额外 +${Math.round(Math.min(S.focus, B.focusCap) * B.focusBonus * B.kScale)}`, c: '#B6F03C' });
    $('#status-note').innerHTML = notes.map((n) =>
      `<span style="--nc:${n.c}">${n.t}</span>`).join('');
  }

  function renderTimeline() {
    const cells = [];
    for (let d = 1; d <= 3; d++) {
      for (let s = 0; s < 3; s++) {
        const idx = (d - 1) * 3 + s;
        const cur = (S.day - 1) * 3 + S.slot;
        const rec = S.history.find((h) => h.day === d && h.slot === s);
        let cls = 'tl-cell';
        if (idx < cur || rec) cls += ' done';
        if (idx === cur && !S.resultShown) cls += ' now';
        const tag = rec ? rec.tag : '';
        cells.push(`<div class="${cls}" title="第${d}天 ${FZ.SLOTS[s].full}">
          <span class="tl-d">${d}</span><span class="tl-s">${FZ.SLOTS[s].name}</span>
          ${tag ? `<span class="tl-tag t-${tag}">${tag}</span>` : ''}
        </div>`);
      }
    }
    $('#timeline').innerHTML = cells.join('');
    $('#run-progress').textContent = `第 ${Math.min(S.day, 3)} 天 / 3`;
  }

  const SCENES = {
    library: '<svg viewBox="0 0 64 64"><path d="M8 52V18l24-8 24 8v34" fill="none" stroke="currentColor" stroke-width="3" stroke-linejoin="round"/><path d="M32 10v42M14 24h12M14 32h12M38 24h12M38 32h12" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" opacity=".65"/><circle cx="32" cy="46" r="3.4" fill="currentColor"/></svg>',
    dorm: '<svg viewBox="0 0 64 64"><path d="M6 40h52v12H6zM10 40V26h20v14" fill="none" stroke="currentColor" stroke-width="3" stroke-linejoin="round"/><circle cx="20" cy="33" r="4" fill="currentColor" opacity=".7"/><path d="M40 40V22l14 6v12" fill="none" stroke="currentColor" stroke-width="3" stroke-linejoin="round"/><path d="M44 14l3-6 3 6" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" opacity=".6"/></svg>',
    classroom: '<svg viewBox="0 0 64 64"><rect x="8" y="10" width="48" height="30" rx="3" fill="none" stroke="currentColor" stroke-width="3"/><path d="M16 20h24M16 28h16" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" opacity=".65"/><path d="M20 52h24M26 40v12M38 40v12" stroke="currentColor" stroke-width="3" stroke-linecap="round"/></svg>',
    canteen: '<svg viewBox="0 0 64 64"><path d="M12 30h40a20 20 0 0 1-40 0z" fill="none" stroke="currentColor" stroke-width="3" stroke-linejoin="round"/><path d="M8 52h48" stroke="currentColor" stroke-width="3" stroke-linecap="round"/><path d="M24 20c0-5 4-5 4-10M34 20c0-5 4-5 4-10" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" opacity=".65"/></svg>',
    print: '<svg viewBox="0 0 64 64"><rect x="12" y="24" width="40" height="18" rx="3" fill="none" stroke="currentColor" stroke-width="3"/><path d="M20 24V10h24v14M20 42v12h24V42" fill="none" stroke="currentColor" stroke-width="3" stroke-linejoin="round"/><circle cx="44" cy="32" r="2.6" fill="currentColor"/><path d="M26 48h12" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" opacity=".6"/></svg>',
    campus: '<svg viewBox="0 0 64 64"><circle cx="32" cy="32" r="22" fill="none" stroke="currentColor" stroke-width="3"/><ellipse cx="32" cy="32" rx="12" ry="22" fill="none" stroke="currentColor" stroke-width="2.2" opacity=".55"/><path d="M10 32h44" stroke="currentColor" stroke-width="2.2" opacity=".55"/><circle cx="44" cy="20" r="4" fill="currentColor"/></svg>',
    online: '<svg viewBox="0 0 64 64"><rect x="8" y="12" width="48" height="32" rx="4" fill="none" stroke="currentColor" stroke-width="3"/><path d="M22 52h20M32 44v8" stroke="currentColor" stroke-width="3" stroke-linecap="round"/><path d="M18 24h20M18 32h12" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" opacity=".65"/><circle cx="45" cy="30" r="3.4" fill="currentColor"/></svg>'
  };

  function hintFor(fx) {
    const out = [];
    FZ.STATS.forEach((st) => {
      const v = fx[st.key];
      if (!v) return;
      const n = Math.abs(v);
      const arrows = (v > 0 ? '▲' : '▼').repeat(n >= 14 ? 3 : n >= 8 ? 2 : 1);
      out.push(`<span class="chip" style="--cc:${st.color}">${st.name}<b>${arrows}</b></span>`);
    });
    return out.join('');
  }

  function lockedReason(ch) {
    if (!ch.requires) return null;
    for (const k in ch.requires) {
      if (S.stats[k] < ch.requires[k]) {
        const st = FZ.STATS.find((x) => x.key === k);
        return `需要 ${st.name} ≥ ${ch.requires[k]}（当前 ${Math.round(S.stats[k])}）`;
      }
    }
    return null;
  }

  function renderEvent() {
    const ev = S.currentEvent;
    const slot = FZ.SLOTS[S.slot];
    $('#day-label').textContent = `第 ${S.day} 天`;
    $('#slot-label').textContent = slot.full;
    $('#clock').textContent = slot.time;
    $('#scene-art').innerHTML = SCENES[ev.scene] || SCENES.library;
    $('#scene-art').dataset.scene = ev.scene;
    $('#event-kicker').textContent = ev.forced ? '突发状况' : `${slot.full} · 事件 ${((S.day - 1) * 3 + S.slot) + 1} / 9`;
    $('#event-title').textContent = fill(ev.title);
    $('#choices').innerHTML = '';
    $('#result-box').classList.remove('on');
    $('#btn-next').classList.remove('on');

    typeInto($('#event-text'), fill(ev.text), 13, () => renderChoices(ev));
    renderStats(); renderTimeline();
  }

  function renderChoices(ev) {
    const box = $('#choices');
    box.innerHTML = '';
    ev.choices.forEach((ch, i) => {
      const lock = lockedReason(ch);
      const b = document.createElement('button');
      b.className = 'choice' + (lock ? ' locked' : '');
      b.style.setProperty('--i', i);
      b.disabled = !!lock;
      b.innerHTML = `
        <span class="c-tag t-${ch.tag}">${ch.tag}</span>
        <span class="c-body">
          <span class="c-label">${fill(ch.label)}</span>
          <span class="c-fx">${lock ? `<span class="lock-reason">${lock}</span>` : hintFor(ch.fx)}</span>
        </span>
        <span class="c-arrow">→</span>`;
      if (!lock) {
        b.addEventListener('mouseenter', () => FZ.Audio.play('hover'));
        b.addEventListener('click', (e) => choose(i, e));
      }
      box.appendChild(b);
    });
    requestAnimationFrame(() => box.classList.add('in'));
  }

  /* ---------- 事件选取 ---------- */
  function nextEvent() {
    if (S.day > 3) { startExam(); return; }
    let ev = null;
    const B = FZ.BALANCE;
    if (S.stats.s <= B.collapseAt) { ev = FZ.EVENTS.find((e) => e.id === 'f_collapse'); S.stats.s = 14; }
    else if (S.stats.m <= B.burnoutAt) { ev = FZ.EVENTS.find((e) => e.id === 'f_burnout'); S.stats.m = 14; }
    else if (S.stats.n >= B.socialTipAt && !S.tipUsed && S.day >= 2) {
      ev = FZ.EVENTS.find((e) => e.id === 'f_tip'); S.tipUsed = true;
    }
    if (!ev) {
      const slotKey = FZ.SLOTS[S.slot].key;
      let pool = FZ.EVENTS.filter((e) => e.slot === slotKey && !e.forced && !S.used.includes(e.id));
      if (!pool.length) {
        S.used = S.used.filter((id) => !FZ.EVENTS.find((e) => e.id === id && e.slot === slotKey));
        pool = FZ.EVENTS.filter((e) => e.slot === slotKey && !e.forced);
      }
      ev = pick(pool);
      S.used.push(ev.id);
    }
    S.currentEvent = { id: ev.id, forced: !!ev.forced, scene: ev.scene, title: ev.title, text: ev.text, choices: ev.choices };
    S.resultShown = false;
    S.phase = 'event';
    saveRun();
    show('screen-game');
    renderEvent();
  }

  /* ---------- 选择结算 ---------- */
  function choose(i, e) {
    if (busy || S.resultShown) return;
    if (skipType()) { renderChoices(S.currentEvent); return; }
    busy = true;
    const ch = S.currentEvent.choices[i];
    const B = FZ.BALANCE;
    const pre = Object.assign({}, S.stats);
    const deltas = {};
    let extraK = 0;

    if (ch.study) {
      S.focus += 1;
      S.focusMax = Math.max(S.focusMax, S.focus);
      extraK = Math.min(S.focus, B.focusCap) * B.focusBonus;
    } else {
      S.focus = 0;
    }

    FZ.STATS.forEach((st) => {
      let v = ch.fx[st.key] || 0;
      if (st.key === 'k' && v > 0) {
        v = (v + extraK) * B.kScale;
        if (pre.s < B.lowStamina) v *= 0.5;
        if (pre.m < B.lowMind && Math.random() < B.distractedChance) { v -= B.distractedLoss; S.distracted = true; }
      }
      if (v < 0 && st.key !== 'k') v *= FZ.DIFFICULTY[S.diff].penalty;
      const before = S.stats[st.key];
      S.stats[st.key] = clamp(before + v, 0, 100);
      deltas[st.key] = Math.round(S.stats[st.key] - before);
    });

    if (S.day === 3 && deltas.k > 0) S.day3Gain += deltas.k;
    S.decisions += 1;

    const btn = e && e.currentTarget;
    if (btn) {
      const r = btn.getBoundingClientRect();
      const main = FZ.STATS.reduce((a, b) => Math.abs(deltas[b.key] || 0) > Math.abs(deltas[a.key] || 0) ? b : a, FZ.STATS[0]);
      sparks(r.left + r.width / 2, r.top + r.height / 2, main.color, 18);
      btn.classList.add('picked');
    }
    $$('#choices .choice').forEach((b) => { b.disabled = true; b.classList.add('faded'); });
    if (btn) btn.classList.remove('faded');

    const worst = Math.min.apply(null, Object.values(deltas));
    const net = Object.values(deltas).reduce((a, b) => a + b, 0);
    if (worst <= -15) { shake(-worst); flash('rgba(255,77,77,0.42)'); FZ.Audio.play('loss'); }
    else if (net > 0) FZ.Audio.play('gain');
    else FZ.Audio.play('mixed');
    if (ch.study && S.focus >= 3) setTimeout(() => FZ.Audio.play('combo'), 180);
    if (pre.s >= FZ.BALANCE.lowStamina && S.stats.s < FZ.BALANCE.lowStamina) setTimeout(() => { FZ.Audio.play('warn'); toast('体力跌破 25，知识获取减半', '#FFB020'); }, 320);
    if (pre.m >= FZ.BALANCE.lowMind && S.stats.m < FZ.BALANCE.lowMind) setTimeout(() => { FZ.Audio.play('warn'); toast('心态跌破 25，开始容易走神', '#FF3D8B'); }, 320);
    if (S.distracted) { setTimeout(() => toast('走神了，这次记住的比预期少', '#FF3D8B'), 500); S.distracted = false; }

    S.history.push({
      day: S.day, slot: S.slot, eventId: S.currentEvent.id,
      label: ch.label, tag: ch.tag, deltas: deltas
    });
    S.resultShown = true;
    S.lastResult = fill(ch.result);
    saveRun();

    renderStats(deltas); renderTimeline();
    const rb = $('#result-box');
    rb.classList.add('on');
    rb.querySelector('.r-tag').textContent = ch.tag;
    rb.querySelector('.r-tag').className = 'r-tag t-' + ch.tag;
    typeInto($('#result-text'), S.lastResult, 11, () => {
      $('#btn-next').classList.add('on');
      busy = false;
    });
    $('#btn-next').classList.remove('on');
    setTimeout(() => { busy = false; }, 900);
  }

  function advance() {
    if (skipType()) { $('#btn-next').classList.add('on'); return; }
    FZ.Audio.play('page');
    S.slot += 1;
    if (S.slot > 2) {
      S.slot = 0;
      const finishedDay = S.day;
      S.day += 1;
      if (S.day > 3) { saveRun(); startExam(); return; }
      overnight(finishedDay);
      return;
    }
    nextEvent();
  }

  /* ---------- 过夜结算 ---------- */
  function overnight(day) {
    const D = FZ.DIFFICULTY[S.diff];
    const B = FZ.BALANCE;
    const before = Object.assign({}, S.stats);
    const lost = Math.round(S.stats.k * D.decay);
    S.stats.k = clamp(S.stats.k - lost, 0, 100);
    const tired = S.focus >= B.tiredFocus ? B.tiredFactor : 1;
    const rec = Math.round(D.recover * tired);
    S.stats.s = clamp(S.stats.s + rec, 0, 100);
    S.stats.m = clamp(S.stats.m + B.mindSleep, 0, 100);

    const lines = [
      { l: '知识遗忘', v: -lost, c: '#B6F03C', note: '睡一觉，昨天背的漏掉一部分' },
      { l: '体力恢复', v: Math.round(S.stats.s - before.s), c: '#FFB020', note: tired < 1 ? '连续高强度复习，恢复打折' : '睡眠是最便宜的补剂' },
      { l: '心态回稳', v: Math.round(S.stats.m - before.m), c: '#FF3D8B', note: '天亮了，事情好像没那么糟' }
    ];
    $('#dayend-title').textContent = `第 ${day} 天结束`;
    $('#dayend-sub').textContent = day === 1 ? '还有两天。你比自己想的撑得住。' : '明天就考了。今晚的选择权重最高。';
    $('#dayend-lines').innerHTML = lines.map((x, i) => `
      <div class="de-line" style="--i:${i}">
        <span class="de-l" style="--c:${x.c}">${x.l}</span>
        <span class="de-v" style="--c:${x.c}">${x.v >= 0 ? '+' : ''}${x.v}</span>
        <span class="de-n">${x.note}</span>
      </div>`).join('');
    $('#dayend-stats').innerHTML = FZ.STATS.map((st) => `
      <div class="de-stat"><span style="color:${st.color}">${st.name}</span>
      <b>${Math.round(S.stats[st.key])}</b></div>`).join('');
    $('#overlay-dayend').classList.add('on');
    FZ.Audio.play('dayend');
    S.phase = 'dayend';
    saveRun();
  }

  /* ---------- 考试 ---------- */
  function startExam() {
    S.phase = 'exam';
    S.examStep = 0;
    S.examMod = 0;
    saveRun();
    show('screen-exam');
    $('#exam-banner-sub').textContent = `${S.subject} · 闭卷 · 120 分钟`;
    $('#exam-banner').classList.add('on');
    FZ.Audio.play('exam');
    setTimeout(() => { $('#exam-banner').classList.remove('on'); renderExam(); }, 1500);
  }

  function renderExam() {
    const q = FZ.EXAM[S.examStep];
    $('#exam-step').textContent = `第 ${S.examStep + 1} / ${FZ.EXAM.length} 题`;
    $('#exam-clock').textContent = '剩余 ' + ['22:00', '14:00', '06:00'][S.examStep];
    $('#exam-title').textContent = q.title;
    $('#exam-choices').innerHTML = '';
    $('#exam-result').classList.remove('on');
    typeInto($('#exam-text'), fill(q.text), 12, () => {
      const box = $('#exam-choices');
      q.choices.forEach((ch, i) => {
        const b = document.createElement('button');
        b.className = 'choice exam-choice';
        b.style.setProperty('--i', i);
        b.innerHTML = `<span class="c-tag t-考">${i + 1}</span>
          <span class="c-body"><span class="c-label">${fill(ch.label)}</span></span>
          <span class="c-arrow">→</span>`;
        b.addEventListener('mouseenter', () => FZ.Audio.play('hover'));
        b.addEventListener('click', (e) => examChoose(i, e));
        box.appendChild(b);
      });
      requestAnimationFrame(() => box.classList.add('in'));
    });
  }

  function examChoose(i, e) {
    if (busy) return;
    if (skipType()) return;
    busy = true;
    const q = FZ.EXAM[S.examStep];
    const ch = q.choices[i];
    S.examMod += ch.fx.mod;
    S.stats.s = clamp(S.stats.s + ch.fx.s, 0, 100);
    S.stats.m = clamp(S.stats.m + ch.fx.m, 0, 100);
    S.decisions += 1;
    if (e && e.currentTarget) {
      const r = e.currentTarget.getBoundingClientRect();
      sparks(r.left + r.width / 2, r.top + r.height / 2, ch.fx.mod >= 6 ? '#B6F03C' : '#FFB020', 14);
      e.currentTarget.classList.add('picked');
    }
    $$('#exam-choices .choice').forEach((b) => { b.disabled = true; b.classList.add('faded'); });
    if (e && e.currentTarget) e.currentTarget.classList.remove('faded');
    FZ.Audio.play(ch.fx.mod >= 6 ? 'gain' : 'mixed');
    const rb = $('#exam-result');
    rb.classList.add('on');
    typeInto($('#exam-result-text'), fill(ch.result), 11, () => { busy = false; });
    setTimeout(() => { busy = false; }, 800);
    saveRun();
    setTimeout(() => {
      S.examStep += 1;
      if (S.examStep >= FZ.EXAM.length) finish();
      else renderExam();
    }, 2100);
  }

  /* ---------- 终局 ---------- */
  function gate(table, v) {
    for (const [min, val] of table) if (v >= min) return val;
    return table[table.length - 1][1];
  }

  function computeScore() {
    const D = FZ.DIFFICULTY[S.diff];
    const B = FZ.BALANCE;
    const st = S.stats;
    let sc = st.k * B.kCoef;
    sc += gate(B.staminaGate, st.s);
    sc += gate(B.mindGate, st.m);
    sc += gate(B.netGate, st.n);
    sc += Math.min(S.focusMax, B.focusCap) * 1.0;
    sc += S.examMod;
    sc += rnd(-D.swing, D.swing);
    return clamp(Math.round(sc), 0, 100);
  }

  function chooseEnding(score) {
    const st = S.stats;
    const E = (id) => FZ.ENDINGS.find((x) => x.id === id);
    if (score < 60) {
      if (st.k >= 70) return E('lost');
      if (st.m < 25) return E('broken');
      return E('retake');
    }
    if (score >= 90 && st.s >= 40) return E('harvest');
    if (st.k < 50) return E('luck');
    if (st.n >= 70) return E('network');
    if (st.s < 25) return E('grind');
    if (S.focusMax >= 5) return E('nail');
    if (st.m >= 75 && st.k < 62) return E('slack');
    if (st.k >= 45 && st.s >= 45 && st.m >= 45 && st.n >= 45) return E('steady');
    return E('skim');
  }

  function finish() {
    const score = computeScore();
    const ending = chooseEnding(score);
    const grade = FZ.GRADES.find((g) => score >= g.min);
    const passed = score >= 60;
    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const dateStr = `${now.getFullYear()}.${pad(now.getMonth() + 1)}.${pad(now.getDate())}`;

    S.finished = true;
    S.phase = 'end';
    S.final = { score, endingId: ending.id, gradeLetter: grade.letter, passed };
    clearRun();

    meta.runs += 1;
    if (passed) meta.passed += 1;
    meta.best = Math.max(meta.best, score);
    const isNew = !meta.unlocked.includes(ending.id);
    if (isNew) meta.unlocked.push(ending.id);
    meta.major = S.major; meta.subject = S.subject; meta.diff = S.diff;
    saveMeta();

    const line = fill(ending.line);
    FZ.Card.render($('#card-canvas'), {
      major: S.major, subject: S.subject, diffName: FZ.DIFFICULTY[S.diff].name,
      decisions: S.decisions, ending, score, grade, passed, stats: S.stats, line, dateStr
    });

    $('#ending-name').textContent = ending.title;
    $('#ending-name').style.color = ending.color;
    $('#result-headline').textContent = passed ? '你活过了期末周' : '期末周把你留下了';
    $('#result-headline').style.color = passed ? '#B6F03C' : '#FF4D4D';
    $('#result-score').textContent = score;
    $('#result-grade').textContent = `${grade.letter} · 绩点 ${grade.point}`;
    $('#result-line').textContent = line;
    $('#result-meta').textContent = `${S.major} · ${S.subject} · ${FZ.DIFFICULTY[S.diff].name}难度 · ${S.decisions} 次决策`;

    $('#unlock-toast').classList.toggle('on', isNew);
    $('#unlock-name').textContent = ending.title;

    show('screen-result');
    renderCollection();
    renderHistory();

    setTimeout(() => {
      FZ.Audio.play('stamp');
      $('#card-wrap').classList.add('stamped');
      setTimeout(() => FZ.Audio.play(passed ? 'win' : 'fail'), 320);
    }, 420);

    if (isNew) setTimeout(() => toast(`解锁新结局：${ending.title}`, ending.color), 1200);
  }

  /* ---------- 图鉴与战绩 ---------- */
  function renderCollection() {
    const html = FZ.ENDINGS.map((e) => {
      const got = meta.unlocked.includes(e.id);
      return `<div class="col-item ${got ? 'got' : ''}" style="--ec:${e.color}">
        <span class="col-seal">${got ? e.seal : '?'}</span>
        <span class="col-name">${got ? e.title : '未解锁'}</span>
        <span class="col-rar">${got ? e.rarity : '—'}</span>
      </div>`;
    }).join('');
    $$('.js-collection').forEach((el) => { el.innerHTML = html; });
    $$('.collection-count').forEach((el) => { el.textContent = `${meta.unlocked.length} / ${FZ.ENDINGS.length}`; });
  }

  function renderHistory() {
    $('#hist-runs').textContent = meta.runs;
    $('#hist-best').textContent = meta.best;
    $('#hist-pass').textContent = meta.runs ? Math.round(meta.passed / meta.runs * 100) + '%' : '—';
  }

  /* ---------- 开局 ---------- */
  function newRun(major, subject, diff) {
    S = {
      major, subject, diff,
      day: 1, slot: 0,
      stats: Object.assign({}, FZ.BALANCE.start),
      focus: 0, focusMax: 0, decisions: 0, day3Gain: 0,
      used: [], history: [], tipUsed: false,
      resultShown: false, finished: false, phase: 'event'
    };
    $('#diff-pill').textContent = FZ.DIFFICULTY[diff].name;
    nextEvent();
  }

  function resumeRun(r) {
    S = r;
    S.used = S.used || [];
    S.history = S.history || [];
    $('#diff-pill').textContent = FZ.DIFFICULTY[S.diff].name;
    if (S.phase === 'dayend') { show('screen-game'); renderStats(); renderTimeline(); overnight(S.day - 1); return; }
    if (S.phase === 'exam') { show('screen-exam'); renderExam(); return; }
    const ev = FZ.EVENTS.find((e) => e.id === (S.currentEvent && S.currentEvent.id));
    if (!ev) { nextEvent(); return; }
    S.currentEvent = { id: ev.id, forced: !!ev.forced, scene: ev.scene, title: ev.title, text: ev.text, choices: ev.choices };
    show('screen-game');
    $('#day-label').textContent = `第 ${S.day} 天`;
    $('#slot-label').textContent = FZ.SLOTS[S.slot].full;
    $('#clock').textContent = FZ.SLOTS[S.slot].time;
    $('#scene-art').innerHTML = SCENES[ev.scene] || SCENES.library;
    $('#event-kicker').textContent = ev.forced ? '突发状况' : `${FZ.SLOTS[S.slot].full} · 事件 ${((S.day - 1) * 3 + S.slot) + 1} / 9`;
    $('#event-title').textContent = fill(ev.title);
    $('#event-text').textContent = fill(ev.text);
    renderStats(); renderTimeline();
    if (S.resultShown) {
      $('#result-box').classList.add('on');
      $('#result-text').textContent = S.lastResult || '';
      $('#btn-next').classList.add('on');
    } else {
      renderChoices(S.currentEvent);
    }
  }

  /* ---------- 初始化 ---------- */
  function buildTitle() {
    const sel = $('#major-select');
    sel.innerHTML = FZ.MAJORS.map((m) => `<option value="${m.name}">${m.name}</option>`).join('')
      + '<option value="__custom">自定义专业…</option>';
    const dl = $('#subject-list');
    const applyMajor = (name) => {
      const m = FZ.MAJORS.find((x) => x.name === name);
      dl.innerHTML = (m ? m.subjects : []).map((s) => `<option value="${s}">`).join('');
      if (m && (!$('#subject-input').value || $('#subject-input').dataset.auto === '1')) {
        $('#subject-input').value = m.subjects[0];
        $('#subject-input').dataset.auto = '1';
      }
      $('#custom-major').classList.toggle('on', name === '__custom');
      if (name === '__custom') $('#custom-major-input').focus();
    };
    sel.addEventListener('change', () => { FZ.Audio.play('tap'); applyMajor(sel.value); });
    $('#subject-input').addEventListener('input', (e) => { e.target.dataset.auto = '0'; });
    $('#custom-major-input').addEventListener('input', () => {});

    const savedMajor = meta.major && FZ.MAJORS.some((m) => m.name === meta.major) ? meta.major : FZ.MAJORS[0].name;
    sel.value = savedMajor;
    applyMajor(savedMajor);
    if (meta.subject) { $('#subject-input').value = meta.subject; $('#subject-input').dataset.auto = '0'; }

    $$('.diff-btn').forEach((b) => {
      b.classList.toggle('on', b.dataset.d === (meta.diff || 'normal'));
      b.addEventListener('click', () => {
        FZ.Audio.play('tap');
        $$('.diff-btn').forEach((x) => x.classList.remove('on'));
        b.classList.add('on');
        $('#diff-desc').textContent = FZ.DIFFICULTY[b.dataset.d].desc;
      });
    });
    $('#diff-desc').textContent = FZ.DIFFICULTY[meta.diff || 'normal'].desc;

    const r = loadRun();
    $('#btn-resume').classList.toggle('on', !!r);
    if (r) $('#resume-info').textContent = `${r.major} · ${r.subject} · 第 ${Math.min(r.day, 3)} 天`;
  }

  function currentSetup() {
    const sel = $('#major-select');
    let major = sel.value === '__custom' ? ($('#custom-major-input').value.trim() || '自定义专业') : sel.value;
    let subject = $('#subject-input').value.trim();
    if (!subject) {
      const m = FZ.MAJORS.find((x) => x.name === sel.value);
      subject = m ? m.subjects[0] : '这门课';
      $('#subject-input').value = subject;
    }
    const diff = ($$('.diff-btn').find((b) => b.classList.contains('on')) || { dataset: { d: 'normal' } }).dataset.d;
    return { major, subject, diff };
  }

  function bind() {
    $('#btn-start').addEventListener('click', () => {
      FZ.Audio.unlock(); FZ.Audio.play('page');
      const s = currentSetup();
      meta.major = s.major; meta.subject = s.subject; meta.diff = s.diff; saveMeta();
      newRun(s.major, s.subject, s.diff);
    });
    $('#btn-resume').addEventListener('click', () => {
      FZ.Audio.unlock(); FZ.Audio.play('page');
      const r = loadRun();
      if (r) resumeRun(r); else newRun(currentSetup().major, currentSetup().subject, currentSetup().diff);
    });
    $('#btn-next').addEventListener('click', advance);
    $('#btn-dayend-next').addEventListener('click', () => {
      FZ.Audio.play('page');
      $('#overlay-dayend').classList.remove('on');
      nextEvent();
    });
    $('#event-text').addEventListener('click', skipType);
    $('#result-text').addEventListener('click', skipType);
    $('#exam-text').addEventListener('click', skipType);

    $('#btn-sound').addEventListener('click', () => {
      const on = !FZ.Audio.isEnabled();
      FZ.Audio.setEnabled(on);
      meta.sound = on; saveMeta();
      syncSound();
      if (on) FZ.Audio.play('tap');
    });

    $('#btn-restart').addEventListener('click', () => {
      if (S && !S.finished && S.decisions > 0) {
        if (!confirm('放弃当前这一局，回到开局界面？')) return;
      }
      clearRun(); S = null;
      FZ.Audio.play('page');
      $('#overlay-dayend').classList.remove('on');
      buildTitle(); show('screen-title');
    });

    $('#btn-again').addEventListener('click', () => {
      FZ.Audio.play('page');
      $('#card-wrap').classList.remove('stamped');
      buildTitle(); show('screen-title');
    });
    $('#btn-quick-again').addEventListener('click', () => {
      FZ.Audio.play('page');
      $('#card-wrap').classList.remove('stamped');
      newRun(S.major, S.subject, S.diff);
    });

    $('#btn-save-card').addEventListener('click', () => {
      FZ.Audio.play('tap');
      const pad = (n) => String(n).padStart(2, '0');
      const d = new Date();
      const name = `期末周求生_${S.final.score}分_${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}.png`;
      FZ.Card.download($('#card-canvas'), name);
      toast('战绩卡已保存，可以直接发出去', '#B6F03C');
    });

    $('#btn-share').addEventListener('click', async () => {
      FZ.Audio.play('tap');
      const canvas = $('#card-canvas');
      const text = `我在「期末周求生」里拿到了 ${S.final.score} 分，称号「${$('#ending-name').textContent}」。${S.subject}，三天，活下来了。#2026Qoder高校创造力大赛`;
      try {
        const blob = await new Promise((res) => canvas.toBlob(res, 'image/png'));
        const file = new File([blob], 'fz-card.png', { type: 'image/png' });
        if (navigator.canShare && navigator.canShare({ files: [file] })) {
          await navigator.share({ files: [file], title: '期末周求生', text });
          return;
        }
        if (navigator.share) { await navigator.share({ title: '期末周求生', text }); return; }
        await navigator.clipboard.writeText(text);
        toast('分享文案已复制，战绩卡请点「保存战绩卡」', '#35D6F5');
      } catch (err) {
        try { await navigator.clipboard.writeText(text); toast('分享文案已复制', '#35D6F5'); }
        catch (e2) { toast('请点「保存战绩卡」后手动分享', '#FFB020'); }
      }
    });

    $('#btn-copy-link').addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(location.href); toast('链接已复制', '#35D6F5'); }
      catch (e) { toast('复制失败，请手动复制地址栏', '#FFB020'); }
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'm' || e.key === 'M') { $('#btn-sound').click(); return; }
      if (e.key === 'Escape') { skipType(); return; }
      if ($('#screen-game').classList.contains('active')) {
        if (e.key === ' ' || e.key === 'Enter') {
          if (S && S.resultShown && $('#btn-next').classList.contains('on')) { e.preventDefault(); advance(); }
          else if (skipType()) { e.preventDefault(); }
          return;
        }
        const n = parseInt(e.key, 10);
        if (n >= 1 && n <= 3) {
          const btns = $$('#choices .choice:not(.locked)');
          const all = $$('#choices .choice');
          const target = all[n - 1];
          if (target && !target.disabled) target.click();
        }
      }
      if ($('#screen-exam').classList.contains('active')) {
        const n = parseInt(e.key, 10);
        if (n >= 1 && n <= 3) { const b = $$('#exam-choices .choice')[n - 1]; if (b && !b.disabled) b.click(); }
      }
    });

    document.addEventListener('pointerdown', function once() {
      FZ.Audio.unlock();
      document.removeEventListener('pointerdown', once);
    }, { once: true });
  }

  function syncSound() {
    const on = FZ.Audio.isEnabled();
    const b = $('#btn-sound');
    b.classList.toggle('off', !on);
    b.setAttribute('aria-pressed', String(on));
    b.querySelector('.snd-label').textContent = on ? '音效开' : '音效关';
    b.querySelector('.snd-on').style.display = on ? '' : 'none';
    b.querySelector('.snd-off').style.display = on ? 'none' : '';
  }

  function boot() {
    FZ.Audio.setEnabled(meta.sound !== false);
    syncSound();
    buildTitle();
    renderCollection();
    renderHistory();
    bind();
    show('screen-title');
    if (!FZ.Audio.supported()) {
      $('#btn-sound').classList.add('off');
      $('#btn-sound').querySelector('.snd-label').textContent = '不支持';
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
