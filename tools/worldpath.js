#!/usr/bin/env node
/* 寻路体检：从每个地点走到每个地点，确认「直接前往」不会卡在家具或路灯上。
   用法: node tools/worldpath.js [--port 9460] */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const CHROME = require('./browser')();
const URL_BASE = process.env.FZ_URL || 'http://127.0.0.1:8765/index.html';
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > -1 ? process.argv[i + 1] : d; };
const PORT = parseInt(arg('--port', '9460'), 10);
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
      setTimeout(() => { if (this.pending.has(id)) { this.pending.delete(id); rej(new Error('CDP 超时 ' + method)); } }, 120000);
    });
  }
  async eval(e) {
    const r = await this.send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 500));
    return r.result.value;
  }
}

async function main() {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'fz-path-'));
  const chrome = spawn(CHROME, [
    '--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
    '--no-first-run', '--no-default-browser-check', '--mute-audio',
    '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
    '--window-size=700,520', URL_BASE
  ], { stdio: 'ignore' });
  let cdp, bad = 0;
  try {
    await waitForHttp(`http://127.0.0.1:${PORT}/json/version`);
    let targets;
    for (let i = 0; i < 40; i++) { targets = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json(); if (targets.some((t) => t.type === 'page' && t.url.startsWith('http'))) break; await sleep(250); }
    cdp = await CDP.connect(targets.find((t) => t.type === 'page' && t.url.startsWith('http')).webSocketDebuggerUrl);
    await cdp.send('Runtime.enable');
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 700, height: 520, deviceScaleFactor: 1, mobile: false });
    await cdp.send('Page.navigate', { url: URL_BASE });
    for (let i = 0; i < 200; i++) { if (await cdp.eval(`!!(window.FZ && FZ.World && FZ.World.isOk())`)) break; await sleep(200); }
    await cdp.eval(`(() => { const s = document.getElementById('quality-select'); s.value='low'; s.dispatchEvent(new Event('change')); })()`);
    const keys = await cdp.eval(`['dorm','library','classroom','canteen','print','campus','online']`);
    const stands = await cdp.eval(`(() => {
      const o = {};
      ['dorm','library','classroom','canteen','print','campus','online'].forEach(k => { o[k] = FZ.World.standOf(k); });
      return o;
    })()`);
    console.log('站位:', JSON.stringify(stands));
    for (const from of keys) {
      for (const to of keys) {
        const r = await cdp.eval(`(async () => {
          const s = FZ.World.standOf('${from}');
          FZ.World.place(s[0], s[1], 0);
          FZ.World.beginSlot({ scene: '${to}', day: 1, slot: 0, label: 'x' });
          FZ.World.goTo();
          const t0 = performance.now();
          let lastPos = null, stuck = 0;
          while (performance.now() - t0 < 25000) {
            await new Promise(r => setTimeout(r, 120));
            const d = FZ.World.debug();
            if (d.phase === 'event') return { ok: true, ms: Math.round(performance.now() - t0), fps: d.fps };
            if (lastPos && Math.hypot(d.pos[0]-lastPos[0], d.pos[1]-lastPos[1]) < 0.02) stuck++; else stuck = 0;
            lastPos = d.pos;
            if (stuck > 25) return { ok: false, pos: d.pos, next: d.next, path: d.path, fps: d.fps };
          }
          const d = FZ.World.debug();
          return { ok: false, timeout: true, pos: d.pos, next: d.next, path: d.path, fps: d.fps };
        })()`);
        if (r.ok) console.log(`  ${from} → ${to}  ${r.ms}ms  fps${r.fps}`);
        else { bad++; console.log(`  ✗ ${from} → ${to}  卡住 ${JSON.stringify(r)}`); }
      }
    }
  } finally {
    if (cdp) try { cdp.ws.close(); } catch (e) {}
    chrome.kill(); await sleep(300);
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) {}
  }
  console.log(bad ? `\n⚠️ ${bad} 条路线走不通` : '\n✅ 49 条路线全部走通');
  process.exit(bad ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(2); });