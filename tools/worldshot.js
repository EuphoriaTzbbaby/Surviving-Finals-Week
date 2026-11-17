#!/usr/bin/env node
/* 美术巡检：把每个地点在清晨 / 午后 / 深夜各截一张，用来判断光照与构图。
   用法: node tools/worldshot.js --out 目录 [--width 1440] [--height 900] [--quality high] */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const URL_BASE = process.env.FZ_URL || 'http://127.0.0.1:8765/index.html';
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > -1 ? process.argv[i + 1] : d; };
const OUT = arg('--out', '/tmp/fz-art');
const W = parseInt(arg('--width', '1440'), 10);
const H = parseInt(arg('--height', '900'), 10);
const Q = arg('--quality', 'high');
const PORT = parseInt(arg('--port', '9470'), 10);
const ONLY = arg('--only', '');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForHttp(url, tries = 80) {
  for (let i = 0; i < tries; i++) { try { const r = await fetch(url); if (r.ok) return await r.json(); } catch (e) {} await sleep(250); }
  throw new Error('调试端口没起来');
}
class CDP {
  constructor(ws) { this.ws = ws; this.id = 0; this.pending = new Map(); }
  static async connect(url) {
    const ws = new WebSocket(url);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
    const c = new CDP(ws);
    ws.onmessage = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && c.pending.has(m.id)) { const { res, rej } = c.pending.get(m.id); c.pending.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); }
    };
    return c;
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((res, rej) => {
      this.pending.set(id, { res, rej });
      this.ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => { if (this.pending.has(id)) { this.pending.delete(id); rej(new Error('CDP 超时 ' + method)); } }, 180000);
    });
  }
  async eval(e) {
    const r = await this.send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 400));
    return r.result.value;
  }
  async shot(name) {
    const r = await this.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(OUT, name + '.png'), Buffer.from(r.data, 'base64'));
  }
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'fz-art-'));
  const chrome = spawn(CHROME, [
    '--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
    '--no-first-run', '--no-default-browser-check', '--mute-audio',
    '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
    `--window-size=${W},${H}`, URL_BASE
  ], { stdio: 'ignore' });
  let cdp;
  try {
    await waitForHttp(`http://127.0.0.1:${PORT}/json/version`);
    let targets;
    for (let i = 0; i < 40; i++) { targets = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json(); if (targets.some((t) => t.type === 'page' && t.url.startsWith('http'))) break; await sleep(250); }
    cdp = await CDP.connect(targets.find((t) => t.type === 'page' && t.url.startsWith('http')).webSocketDebuggerUrl);
    await cdp.send('Runtime.enable');
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: W < 700 });
    await cdp.send('Page.navigate', { url: URL_BASE });
    for (let i = 0; i < 300; i++) { if (await cdp.eval(`!!(window.FZ && FZ.World && FZ.World.isOk()) && !document.getElementById('world-veil').classList.contains('on')`)) break; await sleep(200); }
    await cdp.eval(`(() => { const s = document.getElementById('quality-select'); s.value='${Q}'; s.dispatchEvent(new Event('change')); })()`);
    await sleep(2500);
    await cdp.shot('00-title');
    await cdp.eval(`(() => {
      const s = document.getElementById('major-select'); s.value='数学与应用数学'; s.dispatchEvent(new Event('change'));
      const m = document.getElementById('subject-select'); m.value='数学分析'; m.dispatchEvent(new Event('change'));
      document.getElementById('btn-start').click();
    })()`);
    await sleep(2500);
    await cdp.shot('01-spawn');
    const scenes = (ONLY ? ONLY.split(',') : ['dorm', 'library', 'classroom', 'canteen', 'print', 'campus', 'online']);
    const slots = [0, 1, 2];
    for (const sc of scenes) {
      for (const sl of slots) {
        const r = await cdp.eval(`(async () => {
          FZ.World.beginSlot({ scene: '${sc}', day: ${sl + 1}, slot: ${sl}, label: '美术巡检' });
          FZ.World.goTo();
          const t0 = performance.now();
          while (performance.now() - t0 < 60000) {
            await new Promise(r => setTimeout(r, 150));
            if (FZ.World.debug().phase === 'event') break;
          }
          await new Promise(r => setTimeout(r, 1400));
          const c = document.querySelector('#world canvas');
          const off = document.createElement('canvas'); off.width = 200; off.height = Math.round(200 * c.height / c.width);
          const g = off.getContext('2d');
          return await new Promise(res => requestAnimationFrame(() => {
            g.drawImage(c, 0, 0, off.width, off.height);
            const d = g.getImageData(0, 0, off.width, off.height).data;
            let sum = 0, hot = 0; for (let i = 0; i < d.length; i += 4) { const l = (d[i]+d[i+1]+d[i+2])/3; sum += l; if (l > 200) hot++; }
            res({ avg: +(sum / (d.length / 4)).toFixed(1), hot: +(hot / (d.length / 4)).toFixed(3) });
          }));
        })()`);
        const name = `${sc}-${['morning', 'noon', 'night'][sl]}`;
        await cdp.shot(name);
        console.log(`  ${name}  avg=${r.avg} hot=${r.hot}`);
      }
    }
  } finally {
    if (cdp) try { cdp.ws.close(); } catch (e) {}
    chrome.kill(); await sleep(300);
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) {}
  }
}
main().catch((e) => { console.error(e); process.exit(2); });