#!/usr/bin/env node
/* 只查布局：把某个屏幕直接切到 active，量各块的位置与计算样式。
   用法: node tools/layout.js <screen-id> [宽度] [高度] */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const URL_BASE = process.env.FZ_URL || 'http://127.0.0.1:8765/index.html';
const SCREEN = process.argv[2] || 'screen-result';
const W = parseInt(process.argv[3] || '1440', 10);
const H = parseInt(process.argv[4] || '900', 10);
const PORT = parseInt(process.argv[5] || '9401', 10);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'fz-layout-'));
  const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
    '--no-first-run', '--disable-gpu', '--mute-audio', `--window-size=${W},${H}`, URL_BASE], { stdio: 'ignore' });
  try {
    let ver;
    for (let i = 0; i < 60; i++) { try { ver = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json(); break; } catch (e) { await sleep(250); } }
    if (!ver) throw new Error('Chrome 没起来');
    let page;
    for (let i = 0; i < 40; i++) {
      const ts = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
      page = ts.find((t) => t.type === 'page' && t.url.includes('index.html'));
      if (page) break; await sleep(250);
    }
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
    let id = 0; const pending = new Map();
    ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
    const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
    const ev = async (expression) => (await send('Runtime.evaluate', { expression, returnByValue: true })).result.result.value;
    await send('Page.enable'); await send('Runtime.enable');
    await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: W < 700 });
    await send('Page.navigate', { url: URL_BASE });
    await sleep(1500);
    const out = await ev(`(() => {
      document.querySelectorAll('.screen').forEach(s => s.classList.toggle('active', s.id === '${SCREEN}'));
      const ut = document.getElementById('unlock-toast'); if (ut) ut.classList.add('on');
      const cw = document.getElementById('card-wrap'); if (cw) cw.classList.add('stamped');
      const tr = document.getElementById('transcript');
      if (tr && !tr.children.length) tr.innerHTML = ['数学分析','实变函数','抽象代数'].map((n,i) =>
        '<div class="tr-row" style="--cc:' + ['#FFB020','#35D6F5','#FF3D8B'][i] + '"><span class="tr-role">' + (i?'同期':'主攻') +
        '</span><span class="tr-name">' + n + '<i>4 学分 · 投入 3 个时段 · 掌握 62%</i></span><span class="tr-score">66</span><span class="tr-grade">D</span></div>').join('');
      const box = (el) => { const r = el.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)]; };
      const col = document.querySelector('.result-col');
      const grid = document.querySelector('.result-grid');
      const cs = col ? getComputedStyle(col) : null;
      return {
        viewport: [document.documentElement.clientWidth, document.documentElement.scrollHeight],
        overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
        grid: grid ? { rect: box(grid), cols: getComputedStyle(grid).gridTemplateColumns } : null,
        col: cs ? { rect: box(col), display: cs.display, cols: cs.gridTemplateColumns, rows: cs.gridTemplateRows } : null,
        children: col ? [...col.children].map(c => ({ cls: c.className, rect: box(c), display: getComputedStyle(c).display })) : []
      };
    })()`);
    console.log(JSON.stringify(out, null, 2));
    const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
    fs.writeFileSync(`/tmp/fz-layout-${SCREEN}-${W}.png`, Buffer.from(shot.result.data, 'base64'));
    console.log('截图 /tmp/fz-layout-' + SCREEN + '-' + W + '.png');
    ws.close();
  } finally { chrome.kill(); await sleep(300); fs.rmSync(profile, { recursive: true, force: true }); }
}
main().catch((e) => { console.error(e.message); process.exit(1); });