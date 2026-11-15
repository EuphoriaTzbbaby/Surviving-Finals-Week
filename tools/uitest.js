#!/usr/bin/env node
/* 端到端 UI 自检：用本机 Chrome 的 CDP 跑完整对局，检查控制台报错、布局溢出、
   三科切换、考试换场、战绩卡与重开。不依赖任何 npm 包（Node 自带 WebSocket）。
   用法: node tools/uitest.js [--width 1440] [--height 900] [--shots 目录] */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const URL_BASE = process.env.FZ_URL || 'http://127.0.0.1:8765/index.html';
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > -1 ? process.argv[i + 1] : d; };
const WIDTH = parseInt(arg('--width', '1440'), 10);
const HEIGHT = parseInt(arg('--height', '900'), 10);
const SHOTS = arg('--shots', '');
const PORT = parseInt(arg('--port', '9333'), 10);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const problems = [];
const note = (m) => { problems.push(m); console.log('  ✗ ' + m); };

async function waitForHttp(url, tries = 60) {
  for (let i = 0; i < tries; i++) {
    try { const r = await fetch(url); if (r.ok) return await r.json(); } catch (e) {}
    await sleep(250);
  }
  throw new Error('Chrome 调试端口没起来: ' + url);
}

class CDP {
  constructor(ws) { this.ws = ws; this.id = 0; this.pending = new Map(); this.events = []; }
  static async connect(url) {
    const ws = new WebSocket(url);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
    const c = new CDP(ws);
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.method === 'Page.javascriptDialogOpening') {
        ws.send(JSON.stringify({ id: ++c.id, method: 'Page.handleJavaScriptDialog', params: { accept: true } }));
        return;
      }
      if (msg.id && c.pending.has(msg.id)) {
        const { res, rej } = c.pending.get(msg.id);
        c.pending.delete(msg.id);
        msg.error ? rej(new Error(JSON.stringify(msg.error))) : res(msg.result);
      } else if (msg.method) c.events.push(msg);
    };
    return c;
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((res, rej) => {
      this.pending.set(id, { res, rej });
      this.ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => { if (this.pending.has(id)) { this.pending.delete(id); rej(new Error('CDP 超时 ' + method)); } }, 30000);
    });
  }
  async eval(expression) {
    const r = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error('页面脚本异常: ' + JSON.stringify(r.exceptionDetails.exception));
    return r.result.value;
  }
  async wait(expression, label, timeout = 20000) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) {
      if (await this.eval(expression)) return true;
      await sleep(120);
    }
    const errs = this.consoleErrors();
    if (errs.length) errs.forEach((e) => console.log('  [页面报错] ' + e));
    throw new Error('等待超时: ' + label);
  }
  async shot(name) {
    if (!SHOTS) return;
    const r = await this.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(SHOTS, name + '.png'), Buffer.from(r.data, 'base64'));
  }
  consoleErrors() {
    return this.events.filter((e) =>
      (e.method === 'Runtime.exceptionThrown') ||
      (e.method === 'Log.entryAdded' && e.params.entry.level === 'error') ||
      (e.method === 'Runtime.consoleAPICalled' && e.params.type === 'error')
    ).map((e) => JSON.stringify(e.params).slice(0, 400));
  }
}

/* 布局体检：横向溢出 + 关键控件被遮挡 / 尺寸为 0 */
const LAYOUT_PROBE = `(() => {
  const de = document.documentElement;
  const out = { scrollW: de.scrollWidth, clientW: de.clientWidth, offenders: [], invisible: [] };
  if (de.scrollWidth > de.clientWidth + 1) {
    document.querySelectorAll('body *').forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.width && (r.right > de.clientWidth + 1 || r.left < -1)) {
        const id = el.id ? '#' + el.id : el.className && typeof el.className === 'string' ? '.' + el.className.split(' ')[0] : el.tagName;
        if (out.offenders.length < 8) out.offenders.push(id + ' right=' + Math.round(r.right));
      }
    });
  }
  const screen = document.querySelector('.screen.active');
  screen.querySelectorAll('button, .cr, .tr-row, .cs-btn, canvas').forEach((el) => {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) {
      const id = el.id ? '#' + el.id : '.' + String(el.className).split(' ')[0];
      if (!out.invisible.includes(id)) out.invisible.push(id);
    }
  });
  return out;
})()`;

async function probe(cdp, label) {
  const r = await cdp.eval(LAYOUT_PROBE);
  if (r.scrollW > r.clientW + 1) note(`${label}: 横向溢出 scrollW=${r.scrollW} clientW=${r.clientW} → ${r.offenders.join(', ')}`);
  const hidden = r.invisible.filter((x) => !x.includes('btn-resume') && !x.includes('btn-next'));
  if (hidden.length) note(`${label}: 零尺寸元素 ${hidden.join(', ')}`);
  return r;
}

/* 像一个认真玩的人那样选：体力告急先回血，否则拿掌握最多的那个选项 */
const SMART_PICK = `(() => {
  const btns = [...document.querySelectorAll('#choices .choice')].filter(b => !b.disabled);
  const gauge = (name) => {
    const g = [...document.querySelectorAll('.gauge')].find(x => x.innerText.includes(name));
    return g ? parseFloat(g.querySelector('.g-val').textContent) : 100;
  };
  const arrows = (b, name) => {
    const chip = [...b.querySelectorAll('.c-fx .chip')].find(c => c.textContent.startsWith(name));
    if (!chip) return 0;
    const n = (chip.textContent.match(/▲/g) || []).length - (chip.textContent.match(/▼/g) || []).length;
    return n;
  };
  const key = gauge('体力') < 32 ? '体力' : gauge('心态') < 32 ? '心态' : '掌握';
  let best = btns[0], bv = -99;
  btns.forEach(b => { const v = arrows(b, key); if (v > bv) { bv = v; best = b; } });
  best.click();
})()`;

const STATE_DUMP = `(() => {
  const s = window.FZ && FZ.Game && FZ.Game.debug ? FZ.Game.debug() : null;
  return {
    screen: document.querySelector('.screen.active').id,
    choices: [...document.querySelectorAll('#choices .choice')].map(b => b.className + '|disabled=' + b.disabled),
    nextOn: document.getElementById('btn-next').classList.contains('on'),
    resultOn: document.getElementById('result-box').classList.contains('on'),
    typing: !!document.querySelector('.typing'),
    dayend: document.getElementById('overlay-dayend').classList.contains('on'),
    state: s
  };
})()`;

async function pickChoice(cdp) {
  await cdp.wait(`document.querySelectorAll('#choices .choice:not(.locked)').length > 0`, '选项渲染');
  await cdp.eval(SMART_PICK);
  try {
    await cdp.wait(`document.getElementById('btn-next').classList.contains('on')`, '结果与继续按钮', 8000);
  } catch (e) {
    console.log('  [卡住时的状态] ' + JSON.stringify(await cdp.eval(STATE_DUMP)));
    throw e;
  }
}

async function main() {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'fz-uitest-'));
  if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
  const chrome = spawn(CHROME, [
    '--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
    '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--mute-audio',
    '--disable-features=Translate,MediaRouter', `--window-size=${WIDTH},${HEIGHT}`, URL_BASE
  ], { stdio: 'ignore' });

  let cdp;
  try {
    await waitForHttp(`http://127.0.0.1:${PORT}/json/version`);
    let targets;
    for (let i = 0; i < 40; i++) {
      targets = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
      if (targets.some((t) => t.type === 'page' && t.url.includes('index.html'))) break;
      await sleep(250);
    }
    const page = targets.find((t) => t.type === 'page' && t.url.includes('index.html'));
    cdp = await CDP.connect(page.webSocketDebuggerUrl);
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Log.enable');
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: WIDTH, height: HEIGHT, deviceScaleFactor: 1, mobile: WIDTH < 700 });
    await cdp.send('Page.navigate', { url: URL_BASE });
    await cdp.wait(`!!window.FZ && !!document.getElementById('fact-exams')`, '脚本加载');
    await sleep(600);

    console.log(`\n=== ${WIDTH}×${HEIGHT} ===`);
    const facts = await cdp.eval(`['fact-events','fact-exams','fact-endings'].map(i=>document.getElementById(i).textContent)`);
    console.log('  标题页计数 事件/真题/结局:', facts.join(' / '));
    await probe(cdp, '标题页');
    await cdp.shot('01-title');

    // 用户投诉的那门课：数学分析。副科自动带出实变函数 / 抽象代数
    await cdp.eval(`(() => {
      localStorage.clear();
      const s = document.getElementById('major-select');
      s.value = '数学与应用数学'; s.dispatchEvent(new Event('change'));
      const i = document.getElementById('subject-input');
      i.value = '数学分析'; i.dataset.auto = '0'; i.dispatchEvent(new Event('input'));
      document.querySelector('.diff-btn[data-d="normal"]').click();
    })()`);
    const setup = await cdp.eval(`[document.getElementById('subject-input').value, document.getElementById('side-1').value, document.getElementById('side-2').value]`);
    console.log('  三科:', setup.join(' + '));
    if (setup[0] !== '数学分析') note('主攻科目没设置成功');

    await cdp.eval(`document.getElementById('btn-start').click()`);
    await cdp.wait(`document.getElementById('screen-game').classList.contains('active')`, '进入对局');
    await sleep(1400);

    const courses = await cdp.eval(`[...document.querySelectorAll('#course-list .cr-name')].map(e=>e.textContent)`);
    console.log('  侧栏三科:', courses.join(' / '));
    if (courses.length !== 3) note('侧栏没有渲染三科');
    await probe(cdp, '对局页');
    await cdp.shot('02-game');

    // 措辞体检：数学分析的对局里不该出现别的学科的动作
    const BAD = ['背单词', '单词卡', '法条', '病例', '分镜', '电路图', '实验报告'];
    let sawPlaceholder = false;
    const scanText = async (where) => {
      const t = await cdp.eval(`document.querySelector('.screen.active').innerText`);
      BAD.forEach((w) => { if (t.includes(w)) note(`${where}: 出现错科目措辞「${w}」`); });
      if (/\{[^}]{1,8}\}/.test(t)) { sawPlaceholder = true; note(`${where}: 占位符没替换 ` + (t.match(/\{[^}]{1,8}\}/) || [])[0]); }
      return t;
    };
    await scanText('第 1 个事件');

    // Q/W/E 切换
    await cdp.eval(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'w', bubbles: true }))`);
    await sleep(200);
    let act = await cdp.eval(`[...document.querySelectorAll('#course-switch .cs-btn')].findIndex(b=>b.classList.contains('on'))`);
    console.log('  按 W 后选中第', act + 1, '门');
    if (act !== 1) note('W 键没有切到第二门');
    await cdp.eval(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'e', bubbles: true }))`);
    await sleep(200);
    act = await cdp.eval(`[...document.querySelectorAll('#course-switch .cs-btn')].findIndex(b=>b.classList.contains('on'))`);
    if (act !== 2) note('E 键没有切到第三门');
    await cdp.eval(`document.querySelectorAll('#course-switch .cs-btn')[0].click()`);
    await sleep(200);
    act = await cdp.eval(`[...document.querySelectorAll('#course-switch .cs-btn')].findIndex(b=>b.classList.contains('on'))`);
    if (act !== 0) note('点击切回主攻失败');
    await cdp.shot('03-switched');

    // 九个时段：轮转分配，尽量都过
    let pressureSeen = 0, forcedSeen = 0;
    for (let step = 0; step < 9; step++) {
      const overlay = await cdp.eval(`document.getElementById('overlay-dayend').classList.contains('on')`);
      if (overlay) {
        await cdp.shot('04-dayend');
        await probe(cdp, '过夜弹窗');
        await cdp.eval(`document.getElementById('btn-dayend-next').click()`);
        await sleep(700);
      }
      await cdp.wait(`document.getElementById('screen-game').classList.contains('active')`, '回到对局');
      // 把这一时段给掌握最低的那门，模拟会看侧栏的玩家
      await cdp.eval(`(() => {
        const bs = [...document.querySelectorAll('#course-switch .cs-btn')];
        let best = bs[0], bv = 999;
        bs.forEach(b => { const v = parseFloat(b.querySelector('.cs-k').textContent); if (v < bv) { bv = v; best = b; } });
        best.click();
      })()`);
      const kicker = await cdp.eval(`document.getElementById('event-kicker').textContent`);
      const title = await cdp.eval(`document.getElementById('event-title').textContent`);
      // 回归：打字动画期间切课不能提前渲染选项，否则动画结束会把按钮换掉、吃掉玩家第一次点击
      const early = await cdp.eval(`!!document.querySelector('.typing') && document.querySelectorAll('#choices .choice').length`);
      if (early) note(`时段 ${step + 1}: 打字中就渲染了 ${early} 个选项，切课后首次点击会落空`);
      if (/突发/.test(kicker)) forcedSeen++;
      if (/副科|同期|另一门|塑封|学分/.test(title)) pressureSeen++;
      await pickChoice(cdp);
      await scanText(`时段 ${step + 1}`);
      if (step === 4) { await probe(cdp, '对局中段'); await cdp.shot('05-midgame'); }
      await cdp.eval(`document.getElementById('btn-next').click()`);
      await sleep(150);
    }
    console.log('  强制事件', forcedSeen, '次');

    // 过夜 → 考试
    if (await cdp.eval(`document.getElementById('overlay-dayend').classList.contains('on')`)) {
      await cdp.eval(`document.getElementById('btn-dayend-next').click()`);
      await sleep(700);
    }
    await cdp.wait(`document.getElementById('screen-exam').classList.contains('active')`, '进入考试', 25000);
    await sleep(1800);

    const sessions = [];
    for (let q = 0; q < 4; q++) {
      await cdp.wait(`document.querySelectorAll('#exam-choices .choice').length > 0`, `第 ${q + 1} 题选项`);
      const info = await cdp.eval(`({
        course: document.getElementById('exam-course').textContent,
        session: document.getElementById('exam-session').textContent,
        title: document.getElementById('exam-title').textContent,
        text: document.getElementById('exam-text').textContent,
        labels: [...document.querySelectorAll('#exam-choices .c-label')].map(e=>e.textContent)
      })`);
      sessions.push(info);
      console.log(`  第${q + 1}题 [${info.course}] ${info.title}`);
      if (/\{[^}]{1,8}\}/.test(info.text + info.labels.join(''))) note(`第 ${q + 1} 题占位符没替换`);
      if (q === 0) { await probe(cdp, '考试页'); await cdp.shot('06-exam'); }
      if (q === 2) await cdp.shot('07-exam-side');
      await cdp.eval(`document.querySelectorAll('#exam-choices .choice')[0].click()`);
      await sleep(2600);
    }
    const distinct = new Set(sessions.map((s) => s.course));
    console.log('  联考覆盖科目:', [...distinct].join(' / '));
    if (distinct.size !== 3) note('联考没有覆盖三门');
    if (new Set(sessions.map((s) => s.title)).size !== 4) note('四道题有重复');

    await cdp.wait(`document.getElementById('screen-result').classList.contains('active')`, '进入结算', 25000);
    await sleep(1600);
    const result = await cdp.eval(`({
      ending: document.getElementById('ending-name').textContent,
      score: document.getElementById('result-score').textContent,
      gpa: document.getElementById('result-gpa').textContent,
      rows: [...document.querySelectorAll('.tr-row')].map(r=>r.innerText.replace(/\\n/g,' | ')),
      alloc: document.getElementById('debrief-alloc').textContent,
      take: document.getElementById('debrief-take').textContent,
      canvas: (() => { const c = document.getElementById('card-canvas'); return c.width + 'x' + c.height; })(),
      cardInk: (() => {
        const c = document.getElementById('card-canvas');
        const d = c.getContext('2d').getImageData(0,0,c.width,c.height).data;
        let n = 0; for (let i = 0; i < d.length; i += 4000) if (d[i] > 40) n++;
        return n;
      })()
    })`);
    console.log('  结局:', result.ending, result.score, '分 ·', result.gpa);
    result.rows.forEach((r) => console.log('   ', r));
    console.log('  复盘:', result.take);
    if (result.rows.length !== 3) note('成绩单不是三行');
    if (result.canvas !== '1080x1440') note('战绩卡尺寸不对: ' + result.canvas);
    if (result.cardInk < 100) note('战绩卡疑似空白');
    if (!result.alloc || !result.take) note('复盘文案为空');
    await probe(cdp, '结算页');
    await cdp.shot('08-result');
    if (SHOTS) {
      const png = await cdp.eval(`document.getElementById('card-canvas').toDataURL('image/png').split(',')[1]`);
      fs.writeFileSync(path.join(SHOTS, '09-card.png'), Buffer.from(png, 'base64'));
    }

    // 存档续玩：中途刷新应能接着打
    await cdp.eval(`document.getElementById('btn-quick-again').click()`);
    await cdp.wait(`document.getElementById('screen-game').classList.contains('active')`, '再来一局');
    await sleep(1300);
    await pickChoice(cdp);
    await cdp.eval(`document.getElementById('btn-next').click()`);
    await sleep(600);
    await cdp.send('Page.navigate', { url: URL_BASE });
    await cdp.wait(`!!window.FZ && document.getElementById('btn-resume')`, '重新加载');
    await sleep(700);
    const resumeShown = await cdp.eval(`getComputedStyle(document.getElementById('btn-resume')).display !== 'none'`);
    if (!resumeShown) note('刷新后没有出现「继续上一局」');
    else {
      await cdp.eval(`document.getElementById('btn-resume').click()`);
      await sleep(1200);
      const back = await cdp.eval(`document.querySelector('.screen.active').id`);
      const cs = await cdp.eval(`document.querySelectorAll('#course-list .cr').length`);
      console.log('  续玩回到:', back, '· 三科面板', cs, '行');
      if (cs !== 3) note('续玩后三科面板丢了');
      await probe(cdp, '续玩');
    }

    // 重开按钮
    await cdp.eval(`document.getElementById('btn-restart').click()`);
    await sleep(600);
    const dialogs = cdp.events.filter((e) => e.method === 'Page.javascriptDialogOpening');
    if (dialogs.length) await cdp.send('Page.handleJavaScriptDialog', { accept: true });
    await sleep(800);
    console.log('  重开后屏幕:', await cdp.eval(`document.querySelector('.screen.active').id`));

    const errs = cdp.consoleErrors();
    if (errs.length) errs.forEach((e) => note('控制台: ' + e));
    else console.log('  控制台 0 报错');
    if (!sawPlaceholder) console.log('  占位符全部替换');
  } finally {
    if (cdp) try { cdp.ws.close(); } catch (e) {}
    chrome.kill();
    await sleep(400);
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) {}
  }

  console.log(problems.length ? `\n⚠️ ${problems.length} 个问题` : '\n✅ 全部通过');
  process.exit(problems.length ? 1 : 0);
}

main().catch((e) => { console.error('\n测试中断:', e.message); process.exit(2); });