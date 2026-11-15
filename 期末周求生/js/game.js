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
      if (!Array.isArray(r.courses) || r.courses.length !== 3) return null;
      return r;
    } catch (e) { return null; }
  }

  /* ---------- 三科档案 ---------- */
  function profileOf(ci) {
    const c = S && S.courses && S.courses[ci];
    return FZ.profile(c ? c.name : (S ? S.subject : ''), S ? S.major : '');
  }

  function fill(text, ci) {
    const p = profileOf(ci != null ? ci : (S ? S.active : 0));
    const nameOf = (i, fb) => (S && S.courses && S.courses[i] ? S.courses[i].name : fb);
    return String(text)
      .replace(/\{科目\}/g, S ? S.subject : '这门课')
      .replace(/\{专业\}/g, S ? S.major : '本专业')
      .replace(/\{副科1\}/g, nameOf(1, '另一门课'))
      .replace(/\{副科2\}/g, nameOf(2, '第三门课'))
      .replace(/\{速记\}/g, p.drill).replace(/\{核心\}/g, p.core)
      .replace(/\{必背\}/g, p.memo).replace(/\{作业\}/g, p.work)
      .replace(/\{难点\}/g, p.hard).replace(/\{刷题App\}/g, p.app)
      .replace(/\{背\}/g, p.verb);
  }

  function totalCredit() {
    return S.courses.reduce((a, c) => a + c.credit, 0);
  }

  function syncK() {
    S.stats.k = clamp(S.courses.reduce((a, c) => a + c.k * c.credit, 0) / totalCredit(), 0, 100);
  }

  function makeCourses(names) {
    return names.map((name, i) => {
      const p = FZ.profile(name, S.major);
      return {
        name: name, credit: p.credit, kind: p.kind,
        k: FZ.COURSE.startSpread[i], slots: 0, last: -1, neglect: 0, examMod: 0
      };
    });
  }

  /* 冷落惩罚：连续 neglectFrom 个时段没碰的课，每时段扣心态，并在过夜时额外遗忘。 */
  function neglectDrain() {
    const C = FZ.COURSE;
    let drain = 0;
    S.courses.forEach((c) => {
      if (c.neglect >= C.neglectFrom) {
        drain += Math.min(C.neglectCap, (c.neglect - C.neglectFrom + 1) * C.neglectStep);
      }
    });
    return drain * FZ.DIFFICULTY[S.diff].penalty;
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
    if (S.focus >= 3) notes.push({ t: `专注连击：掌握额外 +${Math.round(Math.min(S.focus, B.focusCap) * B.focusBonus * B.kScale)}`, c: '#B6F03C' });
    const cold = S.courses.filter((c) => c.neglect >= FZ.COURSE.neglectFrom);
    if (cold.length) notes.push({ t: `${cold.map((c) => c.name).join('、')} 已冷落，每时段扣心态`, c: '#FF4D4D' });
    $('#status-note').innerHTML = notes.map((n) =>
      `<span style="--nc:${n.c}">${n.t}</span>`).join('');
  }

  const COURSE_COLORS = ['#FFB020', '#35D6F5', '#FF3D8B'];

  function renderCourses() {
    const C = FZ.COURSE;
    $('#course-switch').innerHTML = S.courses.map((c, i) => {
      const on = i === S.active;
      return `<button type="button" class="cs-btn${on ? ' on' : ''}${c.neglect >= C.neglectFrom ? ' cold' : ''}"
        data-ci="${i}" style="--cc:${COURSE_COLORS[i]}" aria-pressed="${on}">
        <span class="cs-key">${'QWE'[i]}</span>
        <span class="cs-name">${c.name}</span>
        <span class="cs-k">${Math.round(c.k)}%</span>
      </button>`;
    }).join('');

    $('#course-list').innerHTML = S.courses.map((c, i) => {
      const cold = c.neglect >= C.neglectFrom;
      const warn = cold ? `已 ${c.neglect} 个时段没碰` : (c.slots ? `投入 ${c.slots} 个时段` : '还没投入时间');
      return `<div class="cr${i === S.active ? ' on' : ''}${cold ? ' cold' : ''}" style="--cc:${COURSE_COLORS[i]}">
        <div class="cr-top">
          <span class="cr-role">${i === 0 ? '主攻' : '同期'}</span>
          <span class="cr-name">${c.name}</span>
          <span class="cr-credit">${c.credit} 学分</span>
        </div>
        <div class="cr-track"><div class="cr-fill" style="width:${Math.round(c.k)}%"></div></div>
        <div class="cr-foot"><span class="cr-k">${Math.round(c.k)}%</span><span class="cr-warn">${warn}</span></div>
      </div>`;
    }).join('');

    const drain = neglectDrain();
    $('#course-pressure').innerHTML = drain > 0
      ? `<b>后台压力 −${drain.toFixed(1)} 心态 / 时段</b><i>没碰的课不会安静等着，它一直在占你的脑子。</i>`
      : `<b>三门都在计划里</b><i>保持住。冷落的课会从第 ${C.neglectFrom} 个时段开始扣心态。</i>`;
    $('#course-pressure').classList.toggle('hot', drain > 0);
  }

  function setActive(ci, silent) {
    if (!S || ci === S.active || ci < 0 || ci > 2) return;
    S.active = ci;
    if (!silent) {
      FZ.Audio.play('tap');
      toast(`这个时段攻《${S.courses[ci].name}》`, COURSE_COLORS[ci]);
    }
    renderCourses();
    // 打字动画结束时会自己渲染选项；提前渲染会被覆盖，玩家的第一次点击就落空了
    if (S.currentEvent && !S.resultShown && !typing) renderChoices(S.currentEvent);
    saveRun();
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
        cells.push(`<div class="${cls}" title="第${d}天 ${FZ.SLOTS[s].full}${rec && rec.to >= 0 ? ' · ' + S.courses[rec.to].name : ''}">
          <span class="tl-d">${d}</span><span class="tl-s">${FZ.SLOTS[s].name}</span>
          ${tag ? `<span class="tl-tag t-${tag}">${tag}</span>` : ''}
          ${rec && rec.to >= 0 ? `<i class="tl-dot" style="--cc:${COURSE_COLORS[rec.to]}"></i>` : ''}
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

  function hintFor(fx, ch) {
    const out = [];
    FZ.STATS.forEach((st) => {
      const v = fx[st.key];
      if (!v) return;
      const n = Math.abs(v);
      const arrows = (v > 0 ? '▲' : '▼').repeat(n >= 14 ? 3 : n >= 8 ? 2 : 1);
      out.push(`<span class="chip" style="--cc:${st.color}">${st.name}<b>${arrows}</b></span>`);
    });
    if (fx.k > 0 && S && S.courses) {
      const ti = ch && ch.to != null ? ch.to : S.active;
      out.push(`<span class="chip to-course" style="--cc:${COURSE_COLORS[ti]}">进《${S.courses[ti].name}》</span>`);
    }
    if (ch && ch.relief) out.push('<span class="chip to-course" style="--cc:#B6F03C">重排计划·降压</span>');
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
    renderStats(); renderTimeline(); renderCourses();
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
          <span class="c-fx">${lock ? `<span class="lock-reason">${lock}</span>` : hintFor(ch.fx, ch)}</span>
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
    if (S.stats.s <= B.collapseAt) { ev = FZ.EVENTS.find((e) => e.id === 'f_collapse'); S.stats.s = 14; setTimeout(() => FZ.Voice.say('collapse'), 500); }
    else if (S.stats.m <= B.burnoutAt) { ev = FZ.EVENTS.find((e) => e.id === 'f_burnout'); S.stats.m = 14; setTimeout(() => FZ.Voice.say('burnout'), 500); }
    else if (S.stats.n >= B.socialTipAt && !S.tipUsed && S.day >= 2) {
      ev = FZ.EVENTS.find((e) => e.id === 'f_tip'); S.tipUsed = true;
      setTimeout(() => FZ.Voice.say('tip'), 500);
    }
    if (!ev) {
      const slotKey = FZ.SLOTS[S.slot].key;
      const ok = (e) => e.slot === slotKey && !e.forced && (!e.major || e.major === S.major);
      let pool = FZ.EVENTS.filter((e) => ok(e) && !S.used.includes(e.id));
      if (!pool.length) {
        S.used = S.used.filter((id) => !FZ.EVENTS.find((e) => e.id === id && e.slot === slotKey));
        pool = FZ.EVENTS.filter(ok);
      }
      // 三科抢时间的事件优先：第 1 天至少撞一次，之后按冷落程度加压
      const pressure = pool.filter((e) => e.pressure);
      const cold = S.courses.filter((c) => c.neglect >= FZ.COURSE.neglectFrom).length;
      const wantPressure = pressure.length && (!S.pressureSeen || (S.day >= 2 && Math.random() < 0.35 + cold * 0.2));
      const mine = pool.filter((e) => e.major === S.major);
      const generic = pool.filter((e) => !e.major && !e.pressure);
      if (wantPressure) { ev = pick(pressure); S.pressureSeen = (S.pressureSeen || 0) + 1; }
      else if (mine.length && !S.majorSeen && S.day >= 2) ev = pick(mine);
      else if (mine.length && Math.random() < 0.25) ev = pick(mine);
      else ev = pick(generic.length ? generic : pool);
      if (ev.major) S.majorSeen = (S.majorSeen || 0) + 1;
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

    const target = ch.to != null ? ch.to : S.active;
    let routed = 0;

    FZ.STATS.forEach((st) => {
      let v = ch.fx[st.key] || 0;
      if (st.key === 'k' && v > 0) {
        v = (v + extraK) * B.kScale;
        if (pre.s < B.lowStamina) v *= 0.5;
        if (pre.m < B.lowMind && Math.random() < B.distractedChance) { v -= B.distractedLoss; S.distracted = true; }
        const c = S.courses[target];
        const was = c.k;
        c.k = clamp(c.k + v, 0, 100);
        routed = c.k - was;
        if (routed > 0) { c.slots += 1; c.last = S.tick; }
        syncK();
        deltas.k = Math.round(S.stats.k - pre.k);
        return;
      }
      if (st.key === 'k') {
        // 负向的知识损失分摊到三门，按学分加权
        S.courses.forEach((c) => { c.k = clamp(c.k + v * FZ.DIFFICULTY[S.diff].penalty, 0, 100); });
        syncK();
        deltas.k = Math.round(S.stats.k - pre.k);
        return;
      }
      if (v < 0) v *= FZ.DIFFICULTY[S.diff].penalty;
      const before = S.stats[st.key];
      S.stats[st.key] = clamp(before + v, 0, 100);
      deltas[st.key] = Math.round(S.stats[st.key] - before);
    });

    if (ch.relief) {
      S.courses.forEach((c) => { c.last = Math.max(c.last, S.tick - 1); });
      setTimeout(() => toast('计划重排：另外两门的后台压力降下来了', '#B6F03C'), 620);
    }
    S.courses.forEach((c) => { c.neglect = S.tick - c.last; });
    S.lastTarget = routed > 0 ? target : -1;

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
    const TIMBRE = { k: 'K', s: 'S', m: 'M', n: 'P' };
    const up = FZ.STATS.reduce((a, b) => (deltas[b.key] || 0) > (deltas[a.key] || 0) ? b : a, FZ.STATS[0]).key;
    const down = FZ.STATS.reduce((a, b) => (deltas[b.key] || 0) < (deltas[a.key] || 0) ? b : a, FZ.STATS[0]).key;
    if (worst <= -15) { shake(-worst); flash('rgba(255,77,77,0.42)'); FZ.Audio.play('loss' + TIMBRE[down]); }
    else if (net > 0) FZ.Audio.play('gain' + TIMBRE[up]);
    else FZ.Audio.play('mixed');
    if (ch.study && S.focus >= 3) setTimeout(() => FZ.Audio.play('combo', { level: S.focus }), 180);
    if (ch.study && S.focus === 3) setTimeout(() => FZ.Voice.say('focus'), 420);
    if (pre.s >= FZ.BALANCE.lowStamina && S.stats.s < FZ.BALANCE.lowStamina) setTimeout(() => { FZ.Audio.play('warnS'); FZ.Voice.say('warnS'); toast('体力跌破 25，知识获取减半', '#FFB020'); }, 320);
    if (pre.m >= FZ.BALANCE.lowMind && S.stats.m < FZ.BALANCE.lowMind) setTimeout(() => { FZ.Audio.play('warnM'); FZ.Voice.say('warnM'); toast('心态跌破 25，开始容易走神', '#FF3D8B'); }, 320);
    if (S.distracted) { setTimeout(() => toast('走神了，这次记住的比预期少', '#FF3D8B'), 500); S.distracted = false; }

    S.history.push({
      day: S.day, slot: S.slot, eventId: S.currentEvent.id,
      label: ch.label, tag: ch.tag, to: S.lastTarget, deltas: deltas
    });
    S.resultShown = true;
    S.lastResult = fill(ch.result);
    saveRun();

    renderStats(deltas); renderTimeline(); renderCourses();
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
    S.tick += 1;
    if (S.slot > 2) {
      S.slot = 0;
      const finishedDay = S.day;
      S.day += 1;
      if (S.day > 3) { saveRun(); startExam(); return; }
      overnight(finishedDay);
      return;
    }
    const drain = neglectDrain();
    if (drain > 0) {
      S.stats.m = clamp(S.stats.m - drain, 0, 100);
      const cold = S.courses.filter((c) => c.neglect >= FZ.COURSE.neglectFrom);
      toast(`《${cold[0].name}》在后台吃掉了 ${drain.toFixed(1)} 点心态`, '#FF4D4D');
      FZ.Audio.play('warnM');
    }
    nextEvent();
  }

  /* ---------- 过夜结算 ---------- */
  function overnight(day) {
    const D = FZ.DIFFICULTY[S.diff];
    const B = FZ.BALANCE;
    const C = FZ.COURSE;
    const before = Object.assign({}, S.stats);
    const decayRows = S.courses.map((c, i) => {
      const mult = Math.min(C.decayMultCap, 1 + c.neglect * C.decayPerNeglect);
      const lost = Math.round(c.k * D.decay * mult);
      c.k = clamp(c.k - lost, 0, 100);
      return { name: c.name, lost: lost, mult: mult, color: COURSE_COLORS[i] };
    });
    syncK();
    const drain = neglectDrain();
    if (drain > 0) S.stats.m = clamp(S.stats.m - drain, 0, 100);
    const tired = S.focus >= B.tiredFocus ? B.tiredFactor : 1;
    const rec = Math.round(D.recover * tired);
    S.stats.s = clamp(S.stats.s + rec, 0, 100);
    S.stats.m = clamp(S.stats.m + B.mindSleep, 0, 100);

    const lines = [
      { l: '三科遗忘', v: Math.round(S.stats.k - before.k), c: '#B6F03C', note: decayRows.map((r) => `${r.name} −${r.lost}${r.mult > 1.2 ? '（冷落加速）' : ''}`).join(' · ') },
      { l: '体力恢复', v: Math.round(S.stats.s - before.s), c: '#FFB020', note: tired < 1 ? '连续高强度复习，恢复打折' : '睡眠是最便宜的补剂' },
      { l: '心态回稳', v: Math.round(S.stats.m - before.m), c: '#FF3D8B', note: drain > 0 ? `天亮了，但没碰的课扣掉了 ${drain.toFixed(1)} 点` : '天亮了，事情好像没那么糟' }
    ];
    $('#dayend-title').textContent = `第 ${day} 天结束`;
    $('#dayend-sub').textContent = day === 1 ? '还有两天。三门都还在，你比自己想的撑得住。' : '明天就考了。今晚的选择权重最高。';
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
    setTimeout(() => FZ.Voice.say('night'), 700);
    S.phase = 'dayend';
    saveRun();
  }

  /* ---------- 考试：三场联考，题目取自各自的科目档案 ---------- */
  function buildExamPlan() {
    const plan = [];
    const push = (ci, qi, clock) => {
      const p = FZ.profile(S.courses[ci].name, S.major);
      const q = p.exam[Math.min(qi, p.exam.length - 1)];
      plan.push({ ci: ci, name: S.courses[ci].name, credit: S.courses[ci].credit, clock: clock, q: q });
    };
    push(0, 0, '22:00');
    push(0, 1, '09:00');
    push(1, 0, '18:00');
    push(2, 0, '15:00');
    return plan;
  }

  function startExam() {
    S.phase = 'exam';
    S.examStep = 0;
    S.examPlan = buildExamPlan();
    S.courses.forEach((c) => { c.examMod = 0; });
    saveRun();
    show('screen-exam');
    $('#exam-banner-sub').textContent = `${S.courses.map((c) => c.name).join(' · ')} · 闭卷`;
    $('#exam-banner').classList.add('on');
    FZ.Audio.play('exam');
    setTimeout(() => FZ.Voice.say('exam'), 600);
    setTimeout(() => { $('#exam-banner').classList.remove('on'); renderExam(); }, 1500);
  }

  function renderExam() {
    const step = S.examPlan[S.examStep];
    const q = step.q;
    const prev = S.examStep > 0 ? S.examPlan[S.examStep - 1] : null;
    const sessionNo = S.courses.findIndex((c) => c.name === step.name) + 1;
    $('#exam-course').textContent = step.name;
    $('#exam-course').style.setProperty('--cc', COURSE_COLORS[step.ci]);
    $('#exam-session').textContent = `第 ${sessionNo} / 3 场 · ${step.credit} 学分`;
    $('#exam-step').textContent = step.ci === 0
      ? `第 ${S.examStep + 1} / 2 题`
      : '这门只抽一道 · 定生死';
    $('#exam-clock').textContent = '剩余 ' + step.clock;
    $('#exam-title').textContent = q.title;
    $('#exam-choices').innerHTML = '';
    $('#exam-result').classList.remove('on');
    if (prev && prev.ci !== step.ci) {
      FZ.Audio.play('exam');
      flash('rgba(255,61,139,0.30)');
      toast(`换场：《${step.name}》，${step.credit} 学分`, COURSE_COLORS[step.ci]);
    }
    typeInto($('#exam-text'), fill(q.text, step.ci), 12, () => {
      const box = $('#exam-choices');
      q.choices.forEach((ch, i) => {
        const b = document.createElement('button');
        b.className = 'choice exam-choice';
        b.style.setProperty('--i', i);
        b.innerHTML = `<span class="c-tag t-考">${i + 1}</span>
          <span class="c-body"><span class="c-label">${fill(ch.label, step.ci)}</span></span>
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
    const step = S.examPlan[S.examStep];
    const ch = step.q.choices[i];
    S.courses[step.ci].examMod += ch.fx.mod;
    S.stats.s = clamp(S.stats.s + ch.fx.s * FZ.BALANCE.examFatigue, 0, 100);
    S.stats.m = clamp(S.stats.m + ch.fx.m * FZ.BALANCE.examFatigue, 0, 100);
    S.decisions += 1;
    if (e && e.currentTarget) {
      const r = e.currentTarget.getBoundingClientRect();
      sparks(r.left + r.width / 2, r.top + r.height / 2, ch.fx.mod >= 6 ? '#B6F03C' : '#FFB020', 14);
      e.currentTarget.classList.add('picked');
    }
    $$('#exam-choices .choice').forEach((b) => { b.disabled = true; b.classList.add('faded'); });
    if (e && e.currentTarget) e.currentTarget.classList.remove('faded');
    FZ.Audio.play(ch.fx.mod >= 6 ? 'gainK' : (ch.fx.mod >= 2 ? 'mixed' : 'lossM'));
    setTimeout(() => FZ.Voice.say(ch.fx.mod >= 6 ? 'examGood' : 'examBad'), 260);
    const rb = $('#exam-result');
    rb.classList.add('on');
    typeInto($('#exam-result-text'), fill(ch.result, step.ci), 11, () => { busy = false; });
    setTimeout(() => { busy = false; }, 800);
    saveRun();
    setTimeout(() => {
      S.examStep += 1;
      if (S.examStep >= S.examPlan.length) finish();
      else renderExam();
    }, 2100);
  }

  /* ---------- 终局 ---------- */
  function gate(table, v) {
    for (const [min, val] of table) if (v >= min) return val;
    return table[table.length - 1][1];
  }

  function courseRows() {
    const D = FZ.DIFFICULTY[S.diff];
    const B = FZ.BALANCE;
    const st = S.stats;
    const shared = gate(B.staminaGate, st.s) + gate(B.mindGate, st.m) + gate(B.netGate, st.n)
      + Math.min(S.focusMax, B.focusCap) * 1.0;
    return S.courses.map((c) => {
      const sc = clamp(Math.round(c.k * B.kCoef + shared + c.examMod + rnd(-D.swing, D.swing)), 0, 100);
      const g = FZ.GRADES.find((x) => sc >= x.min);
      return {
        name: c.name, credit: c.credit, mastery: Math.round(c.k), slots: c.slots,
        score: sc, grade: g, passed: sc >= 60
      };
    });
  }

  function chooseEnding(rows, score) {
    const st = S.stats;
    const E = (id) => FZ.ENDINGS.find((x) => x.id === id);
    const failed = rows.filter((r) => !r.passed);
    const lowest = Math.min.apply(null, rows.map((r) => r.score));
    if (failed.length === 3) return E('crash');
    if (score >= 88 && st.s >= 40) return E('harvest');
    if (!failed.length && lowest >= 65 && st.s >= 30) return E('juggle');
    if (rows[0].score >= 80 && failed.length) return E('sacrifice');
    if (score < 60) {
      if (st.k >= 70) return E('lost');
      if (st.m < 25) return E('broken');
      return E('retake');
    }
    if (st.k < 50) return E('luck');
    if (st.n >= 70) return E('network');
    if (st.s < 25) return E('grind');
    if (S.focusMax >= 5) return E('nail');
    if (st.m >= 75 && st.k < 62) return E('slack');
    if (st.k >= 45 && st.s >= 45 && st.m >= 45 && st.n >= 45) return E('steady');
    return E('skim');
  }

  function debrief(rows) {
    const used = S.courses.reduce((a, c) => a + c.slots, 0);
    const alloc = `九个时段：${S.courses.map((c) => `${c.name} ${c.slots}`).join(' · ')}，剩下 ${9 - used} 个给了睡觉、吃饭和朋友。`;
    const failed = rows.filter((r) => !r.passed);
    let take;
    if (!failed.length && S.stats.s >= 35) take = '你没把每一分钟都填满，三门反而都过了。这不是巧合。';
    else if (!failed.length) take = '三门都保住了，但体力见了底。下次少卷一个时段，结果不会更差。';
    else if (rows[0].passed) take = `主攻的《${rows[0].name}》保住了，代价写在${failed.map((r) => '《' + r.name + '》').join('')}那一行上。取舍不是失败，是期末周真实的算术。`;
    else take = '三门一起压过来的时候，没有人能全部接住。下次先保住学分最高的那门，其余的低空掠过就好。';
    return { alloc: alloc, take: take };
  }

  function renderTranscript(rows, gpa) {
    $('#transcript').innerHTML = rows.map((r, i) => `
      <div class="tr-row${r.passed ? '' : ' fail'}" style="--cc:${COURSE_COLORS[i]}">
        <span class="tr-role">${i === 0 ? '主攻' : '同期'}</span>
        <span class="tr-name">${r.name}<i>${r.credit} 学分 · 投入 ${r.slots} 个时段 · 掌握 ${r.mastery}%</i></span>
        <span class="tr-score">${r.score}</span>
        <span class="tr-grade">${r.grade.letter}</span>
      </div>`).join('');
    $('#result-gpa').innerHTML = `总绩点 <b>${gpa}</b> · ${rows.filter((r) => r.passed).length} / 3 门及格`;
  }

  function finish() {
    const rows = courseRows();
    const tc = rows.reduce((a, r) => a + r.credit, 0);
    const score = clamp(Math.round(rows.reduce((a, r) => a + r.score * r.credit, 0) / tc), 0, 100);
    const gpa = (rows.reduce((a, r) => a + parseFloat(r.grade.point) * r.credit, 0) / tc).toFixed(2);
    const ending = chooseEnding(rows, score);
    const g = FZ.GRADES.find((x) => score >= x.min);
    const grade = { letter: g.letter, point: gpa, word: g.word };
    const passed = score >= 60;
    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const dateStr = `${now.getFullYear()}.${pad(now.getMonth() + 1)}.${pad(now.getDate())}`;

    S.finished = true;
    S.phase = 'end';
    S.final = { score, endingId: ending.id, gradeLetter: grade.letter, passed, gpa, rows };
    clearRun();

    meta.runs += 1;
    if (passed) meta.passed += 1;
    meta.best = Math.max(meta.best, score);
    const isNew = !meta.unlocked.includes(ending.id);
    if (isNew) meta.unlocked.push(ending.id);
    meta.major = S.major; meta.subject = S.subject; meta.diff = S.diff;
    meta.sides = S.courses.slice(1).map((c) => c.name);
    saveMeta();

    const line = fill(ending.line, 0);
    const db = debrief(rows);
    FZ.Card.render($('#card-canvas'), {
      major: S.major, subject: S.subject, diffName: FZ.DIFFICULTY[S.diff].name,
      decisions: S.decisions, ending, score, grade, passed, stats: S.stats, line, dateStr,
      courses: rows, gpa: gpa
    });

    $('#ending-name').textContent = ending.title;
    $('#ending-name').style.color = ending.color;
    $('#result-headline').textContent = passed ? '你活过了期末周' : '期末周把你留下了';
    $('#result-headline').style.color = passed ? '#B6F03C' : '#FF4D4D';
    $('#result-score').textContent = score;
    $('#result-grade').textContent = `${grade.letter} · 加权均分`;
    $('#result-line').textContent = line;
    $('#result-meta').textContent = `${S.major} · 主攻 ${S.subject} · ${FZ.DIFFICULTY[S.diff].name}难度 · ${S.decisions} 次决策`;
    renderTranscript(rows, gpa);
    $('#debrief-alloc').textContent = db.alloc;
    $('#debrief-take').textContent = db.take;

    $('#unlock-toast').classList.toggle('on', isNew);
    $('#unlock-name').textContent = ending.title;

    show('screen-result');
    renderCollection();
    renderHistory();

    setTimeout(() => {
      FZ.Audio.play('stamp');
      $('#card-wrap').classList.add('stamped');
      setTimeout(() => { FZ.Audio.play(passed ? 'win' : 'fail'); FZ.Voice.say(passed ? 'win' : 'lose'); }, 320);
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
  function newRun(major, subject, diff, sides) {
    S = {
      major, subject, diff,
      day: 1, slot: 0, tick: 0, active: 0,
      stats: Object.assign({}, FZ.BALANCE.start),
      courses: [],
      focus: 0, focusMax: 0, decisions: 0, day3Gain: 0,
      used: [], history: [], tipUsed: false, majorSeen: 0, pressureSeen: 0,
      resultShown: false, finished: false, phase: 'event'
    };
    S.courses = makeCourses([subject].concat(sides));
    syncK();
    $('#diff-pill').textContent = FZ.DIFFICULTY[diff].name;
    FZ.Voice.say('start');
    nextEvent();
    const how = window.matchMedia('(max-width: 620px)').matches ? '点科目按钮' : '用 Q / W / E';
    setTimeout(() => toast(`同期还要考《${sides[0]}》和《${sides[1]}》，${how}切换这个时段攻哪门`, '#35D6F5'), 900);
  }

  function resumeRun(r) {
    S = r;
    S.used = S.used || [];
    S.history = S.history || [];
    S.active = S.active || 0;
    $('#diff-pill').textContent = FZ.DIFFICULTY[S.diff].name;
    if (S.phase === 'dayend') { show('screen-game'); renderStats(); renderTimeline(); renderCourses(); overnight(S.day - 1); return; }
    if (S.phase === 'exam') {
      if (!S.examPlan || !S.examPlan.length) S.examPlan = buildExamPlan();
      show('screen-exam'); renderExam(); return;
    }
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
    renderStats(); renderTimeline(); renderCourses();
    if (S.resultShown) {
      $('#result-box').classList.add('on');
      $('#result-text').textContent = S.lastResult || '';
      $('#btn-next').classList.add('on');
    } else {
      renderChoices(S.currentEvent);
    }
  }

  /* ---------- 初始化 ---------- */
  function syncChips() {
    const v = $('#subject-input').value;
    $$('#subject-chips .chip').forEach((c) => c.classList.toggle('on', c.dataset.s === v));
  }

  function majorName() {
    const sel = $('#major-select');
    return sel.value === '__custom' ? ($('#custom-major-input').value.trim() || '自定义专业') : sel.value;
  }

  function sidePool() {
    const m = FZ.MAJORS.find((x) => x.name === $('#major-select').value);
    const main = $('#subject-input').value.trim();
    if (m) return m.subjects.filter((s) => s !== main);
    const n = majorName();
    return [n + '导论', n + '专题研究'].filter((s) => s !== main);
  }

  function autoSides() {
    const pool = sidePool();
    const taken = [$('#subject-input').value.trim()];
    ['#side-1', '#side-2'].forEach((sel, i) => {
      const el = $(sel);
      if (el.dataset.auto === '0' && el.value.trim() && !taken.includes(el.value.trim())) {
        taken.push(el.value.trim());
        return;
      }
      const v = pool.find((s) => !taken.includes(s)) || pool[i] || '';
      el.value = v;
      el.dataset.auto = '1';
      taken.push(v);
    });
  }

  let titleBound = false;

  function buildTitle() {
    $('#fact-events').textContent = FZ.EVENTS.filter((e) => !e.forced).length;
    $('#fact-endings').textContent = FZ.ENDINGS.length;
    const bank = Object.keys(FZ.SUBJECTS).map((k) => FZ.SUBJECTS[k])
      .concat(Object.keys(FZ.MAJOR_FALLBACK).map((k) => FZ.MAJOR_FALLBACK[k]));
    $('#fact-exams').textContent = bank.reduce((a, p) => a + p.exam.length, FZ.GENERIC_EXAM.length);
    const sel = $('#major-select');
    sel.innerHTML = FZ.MAJORS.map((m) => `<option value="${m.name}">${m.name}</option>`).join('')
      + '<option value="__custom">自定义专业…</option>';
    const applyMajor = (name) => {
      const m = FZ.MAJORS.find((x) => x.name === name);
      const list = m ? m.subjects : [];
      $('#subject-list').innerHTML = list.map((s) => `<option value="${s}">`).join('');
      $('#side-list').innerHTML = list.map((s) => `<option value="${s}">`).join('');
      $('#subject-chips').innerHTML = list.map((s) => `<button type="button" class="chip" data-s="${s}">${s}</button>`).join('');
      if (m && (!$('#subject-input').value || $('#subject-input').dataset.auto === '1')) {
        $('#subject-input').value = m.subjects[0];
        $('#subject-input').dataset.auto = '1';
      }
      $('#custom-major').classList.toggle('on', name === '__custom');
      if (name === '__custom') $('#custom-major-input').focus();
      syncChips();
      autoSides();
    };

    if (!titleBound) {
      titleBound = true;
      sel.addEventListener('change', () => {
        FZ.Audio.play('tap');
        $('#subject-input').dataset.auto = '1';
        $('#side-1').dataset.auto = '1';
        $('#side-2').dataset.auto = '1';
        applyMajor(sel.value);
      });
      $('#subject-input').addEventListener('input', (e) => { e.target.dataset.auto = '0'; syncChips(); autoSides(); });
      $('#subject-chips').addEventListener('click', (e) => {
        const b = e.target.closest('.chip');
        if (!b) return;
        FZ.Audio.play('tap');
        $('#subject-input').value = b.dataset.s;
        $('#subject-input').dataset.auto = '1';
        syncChips(); autoSides();
      });
      ['#side-1', '#side-2'].forEach((s) => {
        $(s).addEventListener('input', (e) => { e.target.dataset.auto = '0'; });
        $(s).addEventListener('change', () => autoSides());
      });
      $('#custom-major-input').addEventListener('input', () => autoSides());
      $$('.diff-btn').forEach((b) => {
        b.addEventListener('click', () => {
          FZ.Audio.play('tap');
          $$('.diff-btn').forEach((x) => x.classList.remove('on'));
          b.classList.add('on');
          $('#diff-desc').textContent = FZ.DIFFICULTY[b.dataset.d].desc;
        });
      });
    }

    const savedMajor = meta.major && FZ.MAJORS.some((m) => m.name === meta.major) ? meta.major : FZ.MAJORS[0].name;
    sel.value = savedMajor;
    applyMajor(savedMajor);
    // 从存档回填的科目仍算"自动填充"：只有用户本局亲手输入过才锁定，
    // 否则换专业时会留着上一个专业的科目（临床医学配数据结构）。
    if (meta.subject) { $('#subject-input').value = meta.subject; $('#subject-input').dataset.auto = '1'; }
    if (meta.sides && meta.sides.length === 2) {
      $('#side-1').value = meta.sides[0]; $('#side-1').dataset.auto = '1';
      $('#side-2').value = meta.sides[1]; $('#side-2').dataset.auto = '1';
    }
    syncChips();
    autoSides();

    $$('.diff-btn').forEach((b) => b.classList.toggle('on', b.dataset.d === (meta.diff || 'normal')));
    $('#diff-desc').textContent = FZ.DIFFICULTY[meta.diff || 'normal'].desc;

    const r = loadRun();
    $('#btn-resume').classList.toggle('on', !!r);
    if (r) $('#resume-info').textContent = `${r.major} · ${r.subject} · 第 ${Math.min(r.day, 3)} 天`;
  }

  function currentSetup() {
    const major = majorName();
    let subject = $('#subject-input').value.trim();
    if (!subject) {
      const m = FZ.MAJORS.find((x) => x.name === $('#major-select').value);
      subject = m ? m.subjects[0] : major + '导论';
      $('#subject-input').value = subject;
    }
    autoSides();
    const pool = sidePool();
    const taken = [subject];
    const sides = ['#side-1', '#side-2'].map((s, i) => {
      let v = $(s).value.trim();
      if (!v || taken.includes(v)) v = pool.find((x) => !taken.includes(x)) || `${major}专题${i + 2}`;
      $(s).value = v;
      taken.push(v);
      return v;
    });
    const diff = ($$('.diff-btn').find((b) => b.classList.contains('on')) || { dataset: { d: 'normal' } }).dataset.d;
    return { major, subject, diff, sides };
  }

  function bind() {
    $('#btn-start').addEventListener('click', () => {
      FZ.Audio.unlock(); FZ.Audio.play('page');
      const s = currentSetup();
      meta.major = s.major; meta.subject = s.subject; meta.diff = s.diff; meta.sides = s.sides; saveMeta();
      newRun(s.major, s.subject, s.diff, s.sides);
    });
    $('#btn-resume').addEventListener('click', () => {
      FZ.Audio.unlock(); FZ.Audio.play('page');
      const r = loadRun();
      if (r) { resumeRun(r); return; }
      const s = currentSetup();
      newRun(s.major, s.subject, s.diff, s.sides);
    });
    $('#course-switch').addEventListener('click', (e) => {
      const b = e.target.closest('.cs-btn');
      if (b) setActive(parseInt(b.dataset.ci, 10));
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
      newRun(S.major, S.subject, S.diff, S.courses.slice(1).map((c) => c.name));
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
      const text = `我在「期末周求生」里三科加权 ${S.final.score} 分、总绩点 ${S.final.gpa}，称号「${$('#ending-name').textContent}」。${S.courses.map((c) => c.name).join(' / ')}，三天一起压过来，活下来了。#2026Qoder高校创造力大赛`;
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
      const tag = e.target && e.target.tagName;
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
      if (e.key === 'm' || e.key === 'M') { $('#btn-sound').click(); return; }
      if (e.key === 'Escape') { skipType(); return; }
      if ($('#screen-game').classList.contains('active')) {
        const ci = ['q', 'w', 'e'].indexOf(String(e.key).toLowerCase());
        if (ci > -1 && S && !S.resultShown) { e.preventDefault(); setActive(ci); return; }
        if (e.key === ' ' || e.key === 'Enter') {
          if (S && S.resultShown && $('#btn-next').classList.contains('on')) { e.preventDefault(); advance(); }
          else if (skipType()) { e.preventDefault(); }
          return;
        }
        const n = parseInt(e.key, 10);
        if (n >= 1 && n <= 3) {
          const target = $$('#choices .choice')[n - 1];
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
      FZ.Voice.unlock();
      document.removeEventListener('pointerdown', once);
    }, { once: true });
  }

  function syncSound() {
    const on = FZ.Audio.isEnabled();
    FZ.Voice.setEnabled(on);
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
