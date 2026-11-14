#!/usr/bin/env node
/* 平衡模拟器：直接加载 js/data.js 的 FZ.BALANCE / EVENTS / EXAM / ENDINGS，
   复刻 game.js 的数值流程跑批量对局。改数值前后都跑一次，用数据而不是手感判断。
   用法: node tools/sim.js [局数] [难度] */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..', '期末周求生');
const sandbox = {};
sandbox.window = sandbox;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'js', 'data.js'), 'utf8'), sandbox);
const FZ = sandbox.FZ;

const B = FZ.BALANCE;
// --override '{"staminaGate":[[45,4],[25,0],[0,-18]]}' 可在不改 data.js 的前提下试参数
const ovAt = process.argv.indexOf('--override');
if (ovAt > -1) {
  Object.assign(B, JSON.parse(process.argv[ovAt + 1]));
  console.log('参数覆盖：', process.argv[ovAt + 1], '\n');
}
const N = parseInt(process.argv[2], 10) || 20000;
const DIFFS = process.argv[3] && !process.argv[3].startsWith('--') ? [process.argv[3]] : ['easy', 'normal', 'hard'];

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const rnd = (a, b) => a + Math.random() * (b - a);
const gate = (t, v) => { for (const [min, val] of t) if (v >= min) return val; return t[t.length - 1][1]; };

/* 策略：怎么在可选选项里挑一个。requires 不满足的选项直接排除，和 UI 一致。 */
const STRATS = {
  random: (cs) => pick(cs),
  grind: (cs) => cs.reduce((a, b) => (b.fx.k || 0) > (a.fx.k || 0) ? b : a),
  slack: (cs) => cs.reduce((a, b) => (b.fx.k || 0) < (a.fx.k || 0) ? b : a),
  social: (cs) => cs.reduce((a, b) => (b.fx.n || 0) > (a.fx.n || 0) ? b : a),
  // 贪心但不自杀：体力/心态低于阈值时优先回血，否则拿知识
  smart: (cs, st) => {
    if (st.s < 35) return cs.reduce((a, b) => (b.fx.s || 0) > (a.fx.s || 0) ? b : a);
    if (st.m < 35) return cs.reduce((a, b) => (b.fx.m || 0) > (a.fx.m || 0) ? b : a);
    return cs.reduce((a, b) => (b.fx.k || 0) > (a.fx.k || 0) ? b : a);
  }
};

function playable(ev, st) {
  return ev.choices.filter((c) => !c.requires || Object.keys(c.requires).every((k) => st[k] >= c.requires[k]));
}

function runOnce(diffKey, stratName, major) {
  const D = FZ.DIFFICULTY[diffKey];
  const strat = STRATS[stratName];
  const st = Object.assign({}, B.start);
  let focus = 0, focusMax = 0, examMod = 0, tipUsed = false;
  const used = [];
  let majorSeen = 0, forcedSeen = 0;

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
        // 与 game.js 一致：第 2 天起若还没遇到本专业事件，优先抽一个
        const mine = pool.filter((e) => e.major === major);
        if (mine.length && !majorSeen && day >= 2) ev = pick(mine);
        else if (mine.length && Math.random() < 0.25) ev = pick(mine);
        else ev = pick(pool.filter((e) => !e.major).length ? pool.filter((e) => !e.major) : pool);
        if (ev.major) majorSeen++;
        used.push(ev.id);
      }

      const cs = playable(ev, st);
      const ch = cs.length ? strat(cs, st) : ev.choices[0];
      const pre = Object.assign({}, st);
      let extraK = 0;
      if (ch.study) { focus += 1; focusMax = Math.max(focusMax, focus); extraK = Math.min(focus, B.focusCap) * B.focusBonus; }
      else focus = 0;

      for (const s of FZ.STATS) {
        let v = ch.fx[s.key] || 0;
        if (s.key === 'k' && v > 0) {
          v = (v + extraK) * B.kScale;
          if (pre.s < B.lowStamina) v *= 0.5;
          if (pre.m < B.lowMind && Math.random() < B.distractedChance) v -= B.distractedLoss;
        }
        if (v < 0 && s.key !== 'k') v *= D.penalty;
        st[s.key] = clamp(st[s.key] + v, 0, 100);
      }
    }
    if (day < 3) {
      st.k = clamp(st.k - Math.round(st.k * D.decay), 0, 100);
      const tired = focus >= B.tiredFocus ? B.tiredFactor : 1;
      st.s = clamp(st.s + Math.round(D.recover * tired), 0, 100);
      st.m = clamp(st.m + B.mindSleep, 0, 100);
    }
  }

  for (const q of FZ.EXAM) {
    const cs = playable(q, st);
    const ch = cs.length ? strat(cs, st) : q.choices[0];
    examMod += ch.fx.mod;
    st.s = clamp(st.s + ch.fx.s, 0, 100);
    st.m = clamp(st.m + ch.fx.m, 0, 100);
  }

  let sc = st.k * B.kCoef + gate(B.staminaGate, st.s) + gate(B.mindGate, st.m) + gate(B.netGate, st.n);
  sc += Math.min(focusMax, B.focusCap) + examMod + rnd(-D.swing, D.swing);
  const score = clamp(Math.round(sc), 0, 100);

  let ending;
  if (score < 60) ending = st.k >= 70 ? 'lost' : (st.m < 25 ? 'broken' : 'retake');
  else if (score >= 90 && st.s >= 40) ending = 'harvest';
  else if (st.k < 50) ending = 'luck';
  else if (st.n >= 70) ending = 'network';
  else if (st.s < 25) ending = 'grind';
  else if (focusMax >= 5) ending = 'nail';
  else if (st.m >= 75 && st.k < 62) ending = 'slack';
  else if (st.k >= 45 && st.s >= 45 && st.m >= 45 && st.n >= 45) ending = 'steady';
  else ending = 'skim';

  return { score, ending, stats: st, majorSeen, forcedSeen };
}

const pct = (a, p) => a.slice().sort((x, y) => x - y)[Math.floor((a.length - 1) * p)];
const majors = FZ.MAJORS.map((m) => m.name);
const genericCount = FZ.EVENTS.filter((e) => !e.forced && !e.major).length;
const majorCount = FZ.EVENTS.filter((e) => e.major).length;

console.log(`事件池：通用 ${genericCount} + 专业专属 ${majorCount} + 强制 ${FZ.EVENTS.filter((e) => e.forced).length}`);
console.log(`每档 ${N} 局\n`);

const allEndings = new Set();
for (const dk of DIFFS) {
  console.log(`=== ${FZ.DIFFICULTY[dk].name} (${dk}) ===`);
  console.log('策略      均分  中位  P10  P90  及格率  满分数  专属命中');
  for (const sn of Object.keys(STRATS)) {
    const rs = [];
    for (let i = 0; i < N; i++) rs.push(runOnce(dk, sn, majors[i % majors.length]));
    const sc = rs.map((r) => r.score);
    rs.forEach((r) => allEndings.add(r.ending));
    const mean = (sc.reduce((a, b) => a + b, 0) / sc.length).toFixed(1);
    const pass = (sc.filter((s) => s >= 60).length / sc.length * 100).toFixed(1);
    const hundreds = sc.filter((s) => s === 100).length;
    const hit = (rs.filter((r) => r.majorSeen > 0).length / rs.length * 100).toFixed(1);
    console.log(`${sn.padEnd(9)} ${mean.padStart(5)} ${String(pct(sc, 0.5)).padStart(5)} ${String(pct(sc, 0.1)).padStart(4)} ${String(pct(sc, 0.9)).padStart(4)} ${(pass + '%').padStart(7)} ${String(hundreds).padStart(7)} ${(hit + '%').padStart(9)}`);
  }
  console.log('');
}

console.log('=== 结局覆盖（全部策略合计）===');
for (const e of FZ.ENDINGS) {
  console.log(`${allEndings.has(e.id) ? '✓' : '✗ 不可达'} ${e.title} (${e.id})`);
}
const missing = FZ.ENDINGS.filter((e) => !allEndings.has(e.id));
console.log(missing.length ? `\n⚠️ ${missing.length} 个结局在模拟中未出现` : '\n全部结局可达');