#!/usr/bin/env node
/* 平衡模拟器：加载 js/data.js + js/subjects.js，复刻 game.js 的三科抢时间流程跑批量对局。
   改数值前后各跑一次，用数据而不是手感判断。
   用法: node tools/sim.js [每格局数] [难度] [--override '{"neglectStep":1.0}']
   --override 的键写进 FZ.COURSE，大写开头的写进 FZ.BALANCE。 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..', '期末周求生');
const sandbox = {};
sandbox.window = sandbox;
vm.createContext(sandbox);
for (const f of ['data.js', 'subjects.js']) {
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'js', f), 'utf8'), sandbox);
}
const FZ = sandbox.FZ;
const B = FZ.BALANCE;
const C = FZ.COURSE;

const ovAt = process.argv.indexOf('--override');
if (ovAt > -1) {
  const ov = JSON.parse(process.argv[ovAt + 1]);
  for (const k of Object.keys(ov)) (/^[A-Z]/.test(k) ? B : C)[k] = ov[k];
  console.log('参数覆盖：', process.argv[ovAt + 1], '\n');
}
const N = parseInt(process.argv[2], 10) || 3000;
const DIFFS = process.argv[3] && !process.argv[3].startsWith('--') ? [process.argv[3]] : ['easy', 'normal', 'hard'];

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const rnd = (a, b) => a + Math.random() * (b - a);
const gate = (t, v) => { for (const [min, val] of t) if (v >= min) return val; return t[t.length - 1][1]; };

/* 选项策略：怎么在三个选项里挑一个。requires 不满足的直接排除，和 UI 一致。 */
const STRATS = {
  random: (cs) => pick(cs),
  grind: (cs) => cs.reduce((a, b) => (b.fx.k || 0) > (a.fx.k || 0) ? b : a),
  slack: (cs) => cs.reduce((a, b) => (b.fx.k || 0) < (a.fx.k || 0) ? b : a),
  social: (cs) => cs.reduce((a, b) => (b.fx.n || 0) > (a.fx.n || 0) ? b : a),
  smart: (cs, st) => {
    if (st.s < 35) return cs.reduce((a, b) => (b.fx.s || 0) > (a.fx.s || 0) ? b : a);
    if (st.m < 35) return cs.reduce((a, b) => (b.fx.m || 0) > (a.fx.m || 0) ? b : a);
    return cs.reduce((a, b) => (b.fx.k || 0) > (a.fx.k || 0) ? b : a);
  }
};

/* 分配策略：这个时段的学习收益给哪一门。ch.to 会覆盖它，和游戏里一样。 */
const ALLOCS = {
  main: () => 0,
  rotate: (cs, st, tick) => tick % 3,
  // 谁最危险给谁：学分 × 缺口，再叠上冷落带来的额外遗忘风险
  balance: (cs) => {
    let best = 0, bv = -Infinity;
    cs.forEach((c, i) => {
      const v = c.credit * (100 - c.k) + c.neglect * 14;
      if (v > bv) { bv = v; best = i; }
    });
    return best;
  }
};

function playable(ev, st) {
  return ev.choices.filter((c) => !c.requires || Object.keys(c.requires).every((k) => st[k] >= c.requires[k]));
}

function runOnce(diffKey, stratName, allocName, major) {
  const D = FZ.DIFFICULTY[diffKey];
  const strat = STRATS[stratName];
  const alloc = ALLOCS[allocName];
  const m = FZ.MAJORS.find((x) => x.name === major);
  const names = [m.subjects[0], m.subjects[1], m.subjects[2]];
  const courses = names.map((name, i) => {
    const p = FZ.profile(name, major);
    return { name, credit: p.credit, k: C.startSpread[i], slots: 0, last: -1, neglect: 0, examMod: 0, profile: p };
  });
  const tc = courses.reduce((a, c) => a + c.credit, 0);
  const st = Object.assign({}, B.start);
  const syncK = () => { st.k = clamp(courses.reduce((a, c) => a + c.k * c.credit, 0) / tc, 0, 100); };
  const drain = () => {
    let d = 0;
    courses.forEach((c) => {
      if (c.neglect >= C.neglectFrom) d += Math.min(C.neglectCap, (c.neglect - C.neglectFrom + 1) * C.neglectStep);
    });
    return d * D.penalty;
  };
  syncK();

  let tick = 0, active = 0, focus = 0, focusMax = 0, tipUsed = false;
  let majorSeen = 0, pressureSeen = 0, forcedSeen = 0, switchCount = 0;
  const used = [];

  for (let day = 1; day <= 3; day++) {
    for (let slot = 0; slot < 3; slot++) {
      const slotKey = FZ.SLOTS[slot].key;
      let ev = null;
      if (st.s <= B.collapseAt) { ev = FZ.EVENTS.find((e) => e.id === 'f_collapse'); st.s = 14; }
      else if (st.m <= B.burnoutAt) { ev = FZ.EVENTS.find((e) => e.id === 'f_burnout'); st.m = 14; }
      else if (st.n >= B.socialTipAt && !tipUsed && day >= 2) { ev = FZ.EVENTS.find((e) => e.id === 'f_tip'); tipUsed = true; }
      if (ev) forcedSeen++;
      if (!ev) {
        const ok = (e) => e.slot === slotKey && !e.forced && (!e.major || e.major === major);
        let pool = FZ.EVENTS.filter((e) => ok(e) && !used.includes(e.id));
        if (!pool.length) {
          for (let i = used.length - 1; i >= 0; i--) {
            const u = FZ.EVENTS.find((e) => e.id === used[i]);
            if (u && u.slot === slotKey) used.splice(i, 1);
          }
          pool = FZ.EVENTS.filter(ok);
        }
        const pressure = pool.filter((e) => e.pressure);
        const cold = courses.filter((c) => c.neglect >= C.neglectFrom).length;
        const wantPressure = pressure.length && (!pressureSeen || (day >= 2 && Math.random() < 0.35 + cold * 0.2));
        const mine = pool.filter((e) => e.major === major);
        const generic = pool.filter((e) => !e.major && !e.pressure);
        if (wantPressure) { ev = pick(pressure); pressureSeen++; }
        else if (mine.length && !majorSeen && day >= 2) ev = pick(mine);
        else if (mine.length && Math.random() < 0.25) ev = pick(mine);
        else ev = pick(generic.length ? generic : pool);
        if (ev.major) majorSeen++;
        used.push(ev.id);
      }

      const next = alloc(courses, st, tick);
      if (next !== active) switchCount++;
      active = next;

      const cs = playable(ev, st);
      const ch = cs.length ? strat(cs, st) : ev.choices[0];
      const pre = Object.assign({}, st);
      let extraK = 0;
      if (ch.study) { focus += 1; focusMax = Math.max(focusMax, focus); extraK = Math.min(focus, B.focusCap) * B.focusBonus; }
      else focus = 0;

      const target = ch.to != null ? ch.to : active;
      for (const s of FZ.STATS) {
        let v = ch.fx[s.key] || 0;
        if (s.key === 'k' && v > 0) {
          v = (v + extraK) * B.kScale;
          if (pre.s < B.lowStamina) v *= 0.5;
          if (pre.m < B.lowMind && Math.random() < B.distractedChance) v -= B.distractedLoss;
          const c = courses[target];
          const was = c.k;
          c.k = clamp(c.k + v, 0, 100);
          if (c.k - was > 0) { c.slots += 1; c.last = tick; }
          syncK();
          continue;
        }
        if (s.key === 'k') {
          courses.forEach((c) => { c.k = clamp(c.k + v * D.penalty, 0, 100); });
          syncK();
          continue;
        }
        if (v < 0) v *= D.penalty;
        st[s.key] = clamp(st[s.key] + v, 0, 100);
      }
      if (ch.relief) courses.forEach((c) => { c.last = Math.max(c.last, tick - 1); });
      courses.forEach((c) => { c.neglect = tick - c.last; });

      tick += 1;
      if (slot < 2) {
        const d = drain();
        if (d > 0) st.m = clamp(st.m - d, 0, 100);
      }
    }
    if (day < 3) {
      courses.forEach((c) => {
        const mult = Math.min(C.decayMultCap, 1 + c.neglect * C.decayPerNeglect);
        c.k = clamp(c.k - Math.round(c.k * D.decay * mult), 0, 100);
      });
      syncK();
      const d = drain();
      if (d > 0) st.m = clamp(st.m - d, 0, 100);
      const tired = focus >= B.tiredFocus ? B.tiredFactor : 1;
      st.s = clamp(st.s + Math.round(D.recover * tired), 0, 100);
      st.m = clamp(st.m + B.mindSleep, 0, 100);
    }
  }

  /* 三场联考：主攻两道，两门副科各一道，题目取自各自的科目档案 */
  for (const [ci, qi] of [[0, 0], [0, 1], [1, 0], [2, 0]]) {
    const bank = courses[ci].profile.exam;
    const q = bank[Math.min(qi, bank.length - 1)];
    const cs = playable(q, st);
    const ch = cs.length ? strat(cs, st) : q.choices[0];
    courses[ci].examMod += ch.fx.mod;
    st.s = clamp(st.s + ch.fx.s * B.examFatigue, 0, 100);
    st.m = clamp(st.m + ch.fx.m * B.examFatigue, 0, 100);
  }

  const shared = gate(B.staminaGate, st.s) + gate(B.mindGate, st.m) + gate(B.netGate, st.n)
    + Math.min(focusMax, B.focusCap);
  const rows = courses.map((c) => {
    const sc = clamp(Math.round(c.k * B.kCoef + shared + c.examMod + rnd(-D.swing, D.swing)), 0, 100);
    return { score: sc, passed: sc >= 60, credit: c.credit, slots: c.slots, mastery: Math.round(c.k) };
  });
  const rtc = rows.reduce((a, r) => a + r.credit, 0);
  const score = clamp(Math.round(rows.reduce((a, r) => a + r.score * r.credit, 0) / rtc), 0, 100);

  const failed = rows.filter((r) => !r.passed);
  const lowest = Math.min.apply(null, rows.map((r) => r.score));
  let ending;
  if (failed.length === 3) ending = 'crash';
  else if (score >= 88 && st.s >= 40) ending = 'harvest';
  else if (!failed.length && lowest >= 65 && st.s >= 30) ending = 'juggle';
  else if (rows[0].score >= 80 && failed.length) ending = 'sacrifice';
  else if (score < 60) ending = st.k >= 70 ? 'lost' : (st.m < 25 ? 'broken' : 'retake');
  else if (st.k < 50) ending = 'luck';
  else if (st.n >= 70) ending = 'network';
  else if (st.s < 25) ending = 'grind';
  else if (focusMax >= 5) ending = 'nail';
  else if (st.m >= 75 && st.k < 62) ending = 'slack';
  else if (st.k >= 45 && st.s >= 45 && st.m >= 45 && st.n >= 45) ending = 'steady';
  else ending = 'skim';

  return { score, ending, rows, stats: st, majorSeen, pressureSeen, forcedSeen, switchCount };
}

const pct = (a, p) => a.slice().sort((x, y) => x - y)[Math.floor((a.length - 1) * p)];
const majors = FZ.MAJORS.map((m) => m.name);
const genericCount = FZ.EVENTS.filter((e) => !e.forced && !e.major && !e.pressure).length;
const majorCount = FZ.EVENTS.filter((e) => e.major).length;
const pressureCount = FZ.EVENTS.filter((e) => e.pressure).length;
const qCount = Object.keys(FZ.SUBJECTS).reduce((a, k) => a + FZ.SUBJECTS[k].exam.length, 0)
  + Object.keys(FZ.MAJOR_FALLBACK).reduce((a, k) => a + FZ.MAJOR_FALLBACK[k].exam.length, 0)
  + FZ.GENERIC_EXAM.length;

console.log(`事件池：通用 ${genericCount} + 专业专属 ${majorCount} + 三科压力 ${pressureCount} + 强制 ${FZ.EVENTS.filter((e) => e.forced).length}`);
console.log(`分科真题 ${qCount} 道 · 科目档案 ${Object.keys(FZ.SUBJECTS).length} + 兜底 ${Object.keys(FZ.MAJOR_FALLBACK).length}`);
console.log(`每格 ${N} 局 · 策略 × 分配\n`);

const allEndings = new Set();
for (const dk of DIFFS) {
  console.log(`=== ${FZ.DIFFICULTY[dk].name} (${dk}) ===`);
  console.log('策略/分配        均分  中位  P10  P90  及格率  三门全过  主科过率  压力命中');
  for (const sn of Object.keys(STRATS)) {
    for (const an of Object.keys(ALLOCS)) {
      const rs = [];
      for (let i = 0; i < N; i++) rs.push(runOnce(dk, sn, an, majors[i % majors.length]));
      const sc = rs.map((r) => r.score);
      rs.forEach((r) => allEndings.add(r.ending));
      const mean = (sc.reduce((a, b) => a + b, 0) / sc.length).toFixed(1);
      const pass = (sc.filter((s) => s >= 60).length / sc.length * 100).toFixed(1);
      const all3 = (rs.filter((r) => r.rows.every((x) => x.passed)).length / rs.length * 100).toFixed(1);
      const main = (rs.filter((r) => r.rows[0].passed).length / rs.length * 100).toFixed(1);
      const pres = (rs.filter((r) => r.pressureSeen > 0).length / rs.length * 100).toFixed(1);
      const tag = `${sn}/${an}`;
      console.log(`${tag.padEnd(16)} ${mean.padStart(5)} ${String(pct(sc, 0.5)).padStart(5)} ${String(pct(sc, 0.1)).padStart(4)} ${String(pct(sc, 0.9)).padStart(4)} ${(pass + '%').padStart(7)} ${(all3 + '%').padStart(9)} ${(main + '%').padStart(9)} ${(pres + '%').padStart(9)}`);
    }
  }
  console.log('');
}

console.log('=== 结局覆盖（全部策略合计）===');
for (const e of FZ.ENDINGS) {
  console.log(`${allEndings.has(e.id) ? '✓' : '✗ 不可达'} ${e.title} (${e.id})`);
}
const missing = FZ.ENDINGS.filter((e) => !allEndings.has(e.id));
console.log(missing.length ? `\n⚠️ ${missing.length} 个结局在模拟中未出现` : '\n全部结局可达');

if (process.argv.includes('--diag')) {
  console.log('\n=== 终局剖面（normal · smart · 各分配 2000 局）===');
  console.log('分配      体力  心态  人脉  掌握 | 各科终值 k / 投入段数 / 分数 | 冷落峰值');
  for (const an of Object.keys(ALLOCS)) {
    const rs = [];
    for (let i = 0; i < 2000; i++) rs.push(runOnce('normal', 'smart', an, majors[i % majors.length]));
    const avg = (f) => (rs.reduce((a, r) => a + f(r), 0) / rs.length).toFixed(1);
    const cs = [0, 1, 2].map((i) => `${avg((r) => r.rows[i].mastery)} / ${avg((r) => r.rows[i].slots)} / ${avg((r) => r.rows[i].score)}`);
    console.log(`${an.padEnd(9)} ${avg((r) => r.stats.s).padStart(5)} ${avg((r) => r.stats.m).padStart(5)} ${avg((r) => r.stats.n).padStart(5)} ${avg((r) => r.stats.k).padStart(5)} | ${cs.join(' | ')}`);
  }
}