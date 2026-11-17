#!/usr/bin/env node
/* 三维校园冒烟测试：WebGL 是否起来、世界是否渲染出画面、阶段是否切换、走到目标是否触发叙事。
   用法: node tools/worldtest.js [--width 1440] [--height 900] [--shots 目录] [--port 9444] */
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
const PORT = parseInt(arg('--port', '9444'), 10);
const QUAL = arg('--quality', '');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const problems = [];
const note = (m) => { problems.push(m); console.log('  ✗ ' + m); };

async function waitForHttp(url, tries = 80) {
  for (let i = 0; i < tries; i++) {
    try { const r = await fetch(url); if (r.ok) return await r.json(); } catch (e) {}
    await sleep(250);
  }
  throw new Error('Chrome 调试端口没起来');
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
      setTimeout(() => { if (this.pending.has(id)) { this.pending.delete(id); rej(new Error('CDP 超时 ' + method)); } }, 40000);
    });
  }
  async eval(expression) {
    const r = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error('页面脚本异常: ' + JSON.stringify(r.exceptionDetails.exception).slice(0, 600));
    return r.result.value;
  }
  async wait(expression, label, timeout = 30000) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) {
      if (await this.eval(expression)) return true;
      await sleep(120);
    }
    this.consoleErrors().forEach((e) => console.log('  [页面报错] ' + e));
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

/* 画面是否真的画出来了：取 WebGL 画布像素，统计亮度分布与色彩数 */
const FRAME_PROBE = `new Promise((done) => requestAnimationFrame(() => { try {
  const c = document.querySelector('#world canvas');
  if (!c) return done({ canvas: false });
  const off = document.createElement('canvas');
  off.width = 220; off.height = Math.max(1, Math.round(220 * c.height / c.width));
  const g = off.getContext('2d');
  g.drawImage(c, 0, 0, off.width, off.height);
  const d = g.getImageData(0, 0, off.width, off.height).data;
  let lit = 0, sum = 0, max = 0; const hues = new Set();
  for (let i = 0; i < d.length; i += 4) {
    const l = (d[i] + d[i+1] + d[i+2]) / 3;
    sum += l; if (l > max) max = l;
    if (l > 18) lit++;
    hues.add((d[i] >> 5) + ',' + (d[i+1] >> 5) + ',' + (d[i+2] >> 5));
  }
  const n = d.length / 4;
  done({ canvas: true, w: c.width, h: c.height, cssW: Math.round(c.getBoundingClientRect().width),
    lit: +(lit / n).toFixed(3), avg: +(sum / n).toFixed(1), max, hues: hues.size });
} catch (e) { done({ canvas: true, err: String(e) }); } }))`;

const WORLD_STATE = `(() => ({
  phase: document.body.dataset.wphase,
  worldOn: document.body.classList.contains('world-on'),
  ok: !!(window.FZ && FZ.World && FZ.World.isOk()),
  quality: window.FZ && FZ.World ? FZ.World.quality() : null,
  veil: document.getElementById('world-veil').classList.contains('on'),
  roaming: !!(window.FZ && FZ.World && FZ.World.isRoaming()),
  dist: document.getElementById('roam-dist').textContent,
  place: document.getElementById('roam-place').textContent,
  screen: document.querySelector('.screen.active').id,
  choices: document.querySelectorAll('#choices .choice').length,
  typed: document.getElementById('event-text').textContent.length,
  typing: !!document.querySelector('.typing')
}))()`;

async function main() {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'fz-world-'));
  if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
  const chrome = spawn(CHROME, [
    '--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
    '--no-first-run', '--no-default-browser-check', '--mute-audio',
    '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
    '--disable-features=Translate,MediaRouter', `--window-size=${WIDTH},${HEIGHT}`, URL_BASE
  ], { stdio: 'ignore' });

  let cdp;
  try {
    await waitForHttp(`http://127.0.0.1:${PORT}/json/version`);
    const isTarget = (t) => t.type === 'page' && !t.url.startsWith('devtools://') && !t.url.startsWith('chrome://');
    let targets;
    for (let i = 0; i < 40; i++) {
      targets = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
      if (targets.some(isTarget)) break;
      await sleep(250);
    }
    cdp = await CDP.connect(targets.find(isTarget).webSocketDebuggerUrl);
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Log.enable');
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: WIDTH, height: HEIGHT, deviceScaleFactor: 1, mobile: WIDTH < 700 });
    await cdp.send('Page.navigate', { url: URL_BASE });
    await cdp.wait(`!!window.FZ && !!window.THREE && !!FZ.World`, '脚本加载');
    console.log(`\n=== 三维 ${WIDTH}×${HEIGHT} ===`);

    await cdp.wait(`!document.getElementById('world-veil').classList.contains('on')`, '加载遮罩消失', 45000);
    if (QUAL) {
      await cdp.eval(`(() => { const s = document.getElementById('quality-select'); s.value = '${QUAL}'; s.dispatchEvent(new Event('change')); })()`);
    }
    await sleep(2500);
    let st = await cdp.eval(WORLD_STATE);
    console.log('  初始状态:', JSON.stringify(st));
    if (!st.ok) note('FZ.World.isOk() 为 false，三维没起来');
    if (!st.worldOn) note('body.world-on 没加上');
    if (st.phase !== 'title') note('标题页世界阶段不是 title，实际 ' + st.phase);
    let fr = await cdp.eval(FRAME_PROBE);
    console.log('  标题画面:', JSON.stringify(fr));
    if (!fr.canvas) note('没有 WebGL 画布');
    else {
      if (fr.cssW < WIDTH - 4) note(`画布 CSS 宽度只有 ${fr.cssW}`);
      if (fr.lit < 0.15) note(`画面几乎全黑 lit=${fr.lit}`);
      if (fr.hues < 40) note(`画面色彩过少 hues=${fr.hues}，可能没渲染场景`);
    }
    await cdp.shot('w01-title');

    // 帧是否在推进
    const moved = await cdp.eval(`(async () => {
      const a = FZ.World.debug();
      await new Promise(r => setTimeout(r, 900));
      const b = FZ.World.debug();
      return { a: a.cam, b: b.cam, calls: b.calls, tris: b.tris };
    })()`);
    console.log('  相机推轨:', JSON.stringify(moved));
    if (JSON.stringify(moved.a) === JSON.stringify(moved.b)) note('标题页相机没有推轨，rAF 可能没跑');
    if (!moved.calls) note('renderer 没有 draw call');

    // 开局
    await cdp.eval(`(() => {
      localStorage.clear();
      const s = document.getElementById('major-select');
      s.value = '数学与应用数学'; s.dispatchEvent(new Event('change'));
      const m = document.getElementById('subject-select');
      m.value = '数学分析'; m.dispatchEvent(new Event('change'));
      document.getElementById('btn-start').click();
    })()`);
    await cdp.wait(`document.getElementById('screen-game').classList.contains('active')`, '进入对局');
    await sleep(1200);
    st = await cdp.eval(WORLD_STATE);
    console.log('  开局状态:', JSON.stringify(st));
    if (st.phase !== 'roam') note('开局没进入 roam，实际 ' + st.phase);
    if (st.choices > 0) note('roam 阶段就渲染了选项');
    if (st.typed > 0) note('roam 阶段就开始打字，走路时间会吃掉叙事');
    fr = await cdp.eval(FRAME_PROBE);
    console.log('  自由行动画面:', JSON.stringify(fr));
    if (fr.lit < 0.1) note('roam 画面全黑');
    await cdp.shot('w02-roam');

    // 手动 WASD 走两步，位置必须变
    const walk = await cdp.eval(`(async () => {
      const p0 = FZ.World.debug().pos;
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'w', bubbles: true }));
      await new Promise(r => setTimeout(r, 2500));
      document.dispatchEvent(new KeyboardEvent('keyup', { key: 'w', bubbles: true }));
      const p1 = FZ.World.debug().pos;
      return { p0, p1, d: Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) };
    })()`);
    console.log('  WASD 位移:', walk.d.toFixed(2), 'm', JSON.stringify(walk.p1));
    if (walk.d < 0.2) note('W 键没有让玩家移动');

    // 直接前往 → 到达 → 叙事
    await cdp.eval(`document.getElementById('btn-go').click()`);
    await cdp.wait(`document.body.dataset.wphase === 'event'`, '走到目标进入 event', 90000);
    await cdp.wait(`document.querySelectorAll('#choices .choice:not(.locked)').length > 0`, '到达后选项渲染', 25000);
    st = await cdp.eval(WORLD_STATE);
    console.log('  到达状态:', JSON.stringify(st));
    fr = await cdp.eval(FRAME_PROBE);
    console.log('  事件画面:', JSON.stringify(fr));
    if (fr.lit < 0.08) note('event 画面全黑');
    await cdp.shot('w03-event');

    // 完整跑九个时段
    for (let step = 0; step < 9; step++) {
      if (await cdp.eval(`document.getElementById('overlay-dayend').classList.contains('on')`)) {
        await cdp.shot('w04-dayend');
        await cdp.eval(`document.getElementById('btn-dayend-next').click()`);
        await sleep(800);
      }
      await cdp.wait(`document.getElementById('screen-game').classList.contains('active')`, '回到对局');
      if (await cdp.eval(`document.body.dataset.wphase === 'roam'`)) {
        const where = await cdp.eval(`document.getElementById('roam-place').textContent`);
        const dbg = await cdp.eval(`FZ.World.debug()`);
        console.log(`  时段 ${step + 1} 走去 ${where}`, JSON.stringify(dbg));
        if (step === 3) await cdp.shot('w05-roam-day2');
        await cdp.eval(`document.getElementById('btn-go').click()`);
        await cdp.wait(`document.body.dataset.wphase === 'event'`, `时段 ${step + 1} 到达`, 90000);
      }
      await cdp.wait(`document.querySelectorAll('#choices .choice:not(.locked)').length > 0`, `时段 ${step + 1} 选项`, 25000);
      await cdp.eval(`(() => {
        const bs = [...document.querySelectorAll('#choices .choice')].filter(b => !b.disabled);
        const g = (n) => { const x = [...document.querySelectorAll('.gauge')].find(y => y.innerText.includes(n)); return x ? parseFloat(x.querySelector('.g-val').textContent) : 100; };
        const key = g('体力') < 32 ? '体力' : g('心态') < 32 ? '心态' : '掌握';
        const ar = (b) => { const c = [...b.querySelectorAll('.c-fx .chip')].find(z => z.textContent.startsWith(key)); if (!c) return 0; return (c.textContent.match(/▲/g)||[]).length - (c.textContent.match(/▼/g)||[]).length; };
        let best = bs[0], bv = -99; bs.forEach(b => { const v = ar(b); if (v > bv) { bv = v; best = b; } }); best.click();
      })()`);
      await cdp.wait(`document.getElementById('btn-next').classList.contains('on')`, `时段 ${step + 1} 结果`, 12000);
      if (step === 5) await cdp.shot('w06-event-mid');
      await cdp.eval(`document.getElementById('btn-next').click()`);
      await sleep(200);
    }
    if (await cdp.eval(`document.getElementById('overlay-dayend').classList.contains('on')`)) {
      await cdp.eval(`document.getElementById('btn-dayend-next').click()`);
      await sleep(800);
    }
    await cdp.wait(`document.getElementById('screen-exam').classList.contains('active')`, '进入考试', 30000);
    await sleep(2200);
    console.log('  考试阶段:', await cdp.eval(`document.body.dataset.wphase`));
    fr = await cdp.eval(FRAME_PROBE);
    console.log('  考场画面:', JSON.stringify(fr));
    if (fr.avg < 25) note(`考场不够亮 avg=${fr.avg}`);
    await cdp.shot('w07-exam');
    for (let q = 0; q < 4; q++) {
      await cdp.wait(`document.querySelectorAll('#exam-choices .choice').length > 0`, `第 ${q + 1} 题`);
      await cdp.eval(`document.querySelectorAll('#exam-choices .choice')[0].click()`);
      await sleep(2600);
    }
    await cdp.wait(`document.getElementById('screen-result').classList.contains('active')`, '结算', 30000);
    await sleep(2200);
    console.log('  结算阶段:', await cdp.eval(`document.body.dataset.wphase`));
    await cdp.shot('w08-result');
    const card = await cdp.eval(`(() => { const c = document.getElementById('card-canvas'); return c.width + 'x' + c.height; })()`);
    if (card !== '1080x1440') note('战绩卡尺寸 ' + card);

    // 画质切换
    for (const q of ['low', 'mid', 'high']) {
      await cdp.eval(`(() => { const s = document.getElementById('quality-select'); s.value = '${q}'; s.dispatchEvent(new Event('change')); })()`);
      await sleep(900);
      const f = await cdp.eval(FRAME_PROBE);
      console.log(`  画质 ${q}:`, JSON.stringify(f));
      if (!f.canvas || f.lit < 0.05) note(`画质 ${q} 画面异常`);
    }

    // 三维开关来回切
    await cdp.eval(`document.getElementById('btn-3d').click()`);
    await sleep(700);
    st = await cdp.eval(WORLD_STATE);
    console.log('  关三维:', JSON.stringify(st));
    if (st.worldOn || st.phase !== 'off') note('关三维后状态不对');
    await cdp.shot('w09-flat');
    await cdp.eval(`document.getElementById('btn-3d').click()`);
    await sleep(1500);
    st = await cdp.eval(WORLD_STATE);
    console.log('  开三维:', JSON.stringify(st));
    if (!st.worldOn || st.phase === 'off') note('重新开三维失败');
    fr = await cdp.eval(FRAME_PROBE);
    if (fr.lit < 0.05) note('重开三维后画面黑');

    // 中途关三维不能卡住叙事
    await cdp.eval(`document.getElementById('btn-quick-again').click()`);
    await cdp.wait(`document.getElementById('screen-game').classList.contains('active')`, '再来一局');
    await sleep(1000);
    if (await cdp.eval(`document.body.dataset.wphase === 'roam'`)) {
      await cdp.eval(`document.getElementById('btn-3d').click()`);
      await cdp.wait(`document.querySelectorAll('#choices .choice:not(.locked)').length > 0`, '关三维后补播叙事', 20000);
      console.log('  roam 中关三维 → 叙事已补播');
      await cdp.eval(`document.getElementById('btn-3d').click()`);
      await sleep(1200);
    } else note('再来一局没回到 roam');

    // 尺寸变化
    for (const [w, h] of [[1024, 768], [WIDTH, HEIGHT]]) {
      await cdp.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: w < 700 });
      await sleep(900);
      const f = await cdp.eval(FRAME_PROBE);
      const ov = await cdp.eval(`document.documentElement.scrollWidth - document.documentElement.clientWidth`);
      console.log(`  resize ${w}×${h}:`, JSON.stringify(f), '溢出', ov);
      if (Math.abs(f.cssW - w) > 4) note(`resize 后画布宽度 ${f.cssW} ≠ ${w}`);
      if (ov > 1) note(`resize ${w} 横向溢出 ${ov}`);
    }

    // 重开
    await cdp.eval(`document.getElementById('btn-restart').click()`);
    await sleep(1200);
    console.log('  重开:', await cdp.eval(`document.querySelector('.screen.active').id + ' / ' + document.body.dataset.wphase`));
    await cdp.shot('w10-restart');

    const errs = cdp.consoleErrors();
    if (errs.length) errs.forEach((e) => note('控制台: ' + e));
    else console.log('  控制台 0 报错');
  } finally {
    if (cdp) try { cdp.ws.close(); } catch (e) {}
    chrome.kill();
    await sleep(400);
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) {}
  }
  console.log(problems.length ? `\n⚠️ ${problems.length} 个问题` : '\n✅ 三维全部通过');
  process.exit(problems.length ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(2); });