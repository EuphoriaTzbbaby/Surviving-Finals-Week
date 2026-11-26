#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');

const GAME = path.resolve(__dirname, '..', '期末周求生');
const ROOTS = { baseline: path.join(GAME, 'dist'), current: GAME };
const SEED = 0x465a2026;
const FRAMES = 12;
const TIMEOUT = 180000;
const CASES = [
  { id: 'low-day', quality: 'low', slot: 0 },
  { id: 'low-night', quality: 'low', slot: 2 },
  { id: 'high-day', quality: 'high', slot: 0 },
  { id: 'high-night', quality: 'high', slot: 2 }
];
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
let interrupted = null, deadline = Infinity;

function within(root, file) {
  const rel = path.relative(root, file);
  return rel === '' || (!rel.startsWith('..' + path.sep) && rel !== '..' && !path.isAbsolute(rel));
}
function outputPath(value) {
  const resolved = path.resolve(value);
  let ancestor = resolved;
  while (!fs.existsSync(ancestor)) ancestor = path.dirname(ancestor);
  const actual = path.resolve(fs.realpathSync(ancestor), path.relative(ancestor, resolved));
  assert(!within(GAME, resolved) && !within(fs.realpathSync(GAME), actual), 'Outputs must be outside the source/dist tree');
  return resolved;
}
function options() {
  const opt = { port: 9560, width: 800, height: 600, out: '', shots: '' };
  for (let i = 2; i < process.argv.length; i++) {
    const flag = process.argv[i];
    assert(['--port', '--width', '--height', '--out', '--shots'].includes(flag), 'Unknown option: ' + flag);
    const value = process.argv[++i];
    assert(value && !value.startsWith('--'), 'Missing value: ' + flag);
    const key = flag.slice(2);
    if (key === 'out') {
      assert(path.isAbsolute(value) && path.extname(value).toLowerCase() === '.json', '--out requires an absolute JSON file path');
      opt.out = outputPath(value);
    } else if (key === 'shots') opt.shots = outputPath(value);
    else opt[key] = Number(value);
  }
  for (const key of ['port', 'width', 'height']) assert(Number.isInteger(opt[key]) && opt[key] > 0, key + ' must be a positive integer');
  assert(opt.port <= 65535, 'Invalid port');
  assert(opt.width <= 4096 && opt.height <= 4096, 'Viewport exceeds the bounded test limit (4096)');
  if (opt.out) assert(fs.statSync(path.dirname(opt.out)).isDirectory(), '--out parent directory must exist');
  return opt;
}

function allowedParts(parts) {
  return parts.length > 0 && parts.every(p => p && !p.startsWith('.') && !/[\\:%\x00-\x1f\x7f]/.test(p)) &&
    ((parts.length === 1 && parts[0] === 'index.html') || (parts.length > 1 && ['css', 'js', 'assets'].includes(parts[0])));
}
async function serve() {
  const roots = Object.fromEntries(Object.entries(ROOTS).map(([name, root]) => {
    assert(fs.statSync(path.join(root, 'index.html')).isFile(), 'Missing ' + name + '/index.html; do not rebuild dist before this comparison');
    return [name, fs.realpathSync(root)];
  }));
  const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8', '.json': 'application/json', '.png': 'image/png',
    '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.webp': 'image/webp',
    '.m4a': 'audio/mp4', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav', '.woff2': 'font/woff2' };
  const server = http.createServer(async (req, res) => {
    if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405, { Allow: 'GET, HEAD' }); res.end(); return; }
    try {
      // Validate the raw path before URL normalization can erase traversal segments.
      const raw = req.url.split('?')[0];
      assert(raw.startsWith('/') && !raw.startsWith('//'));
      const parts = decodeURIComponent(raw).slice(1).split('/');
      const name = parts.shift();
      assert(Object.hasOwn(roots, name) && allowedParts(parts));
      const root = roots[name], file = await fs.promises.realpath(path.join(root, ...parts));
      assert(within(root, file) && allowedParts(path.relative(root, file).split(path.sep)));
      const stat = await fs.promises.stat(file);
      assert(stat.isFile());
      res.writeHead(200, { 'Content-Type': types[path.extname(file).toLowerCase()] || 'application/octet-stream',
        'Content-Length': stat.size, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'self' data: blob:; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'none'; form-action 'none'; object-src 'none'; base-uri 'none'" });
      if (req.method === 'HEAD') res.end();
      else fs.createReadStream(file).on('error', () => res.destroy()).pipe(res);
    } catch (_) { if (!res.headersSent) res.writeHead(404); res.end(); }
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return server;
}

// Lifecycle and port guard follow campustest.js; importing it would execute its tests.
class CDP {
  constructor(ws) {
    this.ws = ws; this.id = 0; this.pending = new Map(); this.errors = []; this.label = 'startup';
    ws.onmessage = ({ data }) => {
      const msg = JSON.parse(data);
      if (msg.id && this.pending.has(msg.id)) {
        const p = this.pending.get(msg.id);
        clearTimeout(p.timer); this.pending.delete(msg.id);
        if (msg.error) p.reject(new Error(JSON.stringify(msg.error))); else p.resolve(msg.result);
      } else if (msg.method === 'Runtime.exceptionThrown' ||
        (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') ||
        (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error')) {
        this.errors.push({ case: this.label, event: msg.method, detail: JSON.stringify(msg.params).slice(0, 1800) });
      } else if (msg.method === 'Page.javascriptDialogOpening') {
        this.errors.push({ case: this.label, event: msg.method, detail: msg.params.message });
        this.send('Page.handleJavaScriptDialog', { accept: false }).catch(() => {});
      } else if (msg.method === 'Fetch.requestPaused') {
        const { request, requestId } = msg.params;
        const url = new URL(request.url);
        const allowed = url.origin === this.origin && ['GET', 'HEAD'].includes(request.method);
        if (!allowed) this.errors.push({ case: this.label, event: 'blocked-network', detail: request.method + ' ' + request.url });
        this.send(allowed ? 'Fetch.continueRequest' : 'Fetch.failRequest', allowed ? { requestId } : { requestId, errorReason: 'BlockedByClient' })
          .catch(error => { if (!interrupted) this.errors.push({ case: this.label, event: 'network-interception', detail: error.message }); });
      }
    };
    ws.onclose = () => this.rejectPending(new Error('CDP closed'));
    ws.onerror = () => this.rejectPending(new Error('CDP WebSocket error'));
  }
  static async connect(url) {
    const ws = new WebSocket(url);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => { ws.close(); reject(new Error('CDP connection timeout')); }, 10000);
      ws.onopen = () => { clearTimeout(timer); resolve(); };
      ws.onerror = () => { clearTimeout(timer); reject(new Error('CDP connection failed')); };
    });
    return new CDP(ws);
  }
  rejectPending(error) {
    for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(error); }
    this.pending.clear();
  }
  send(method, params = {}, timeout = 15000) {
    const closing = method === 'Browser.close';
    if (!closing && interrupted) return Promise.reject(interrupted);
    if (!closing) timeout = Math.min(timeout, deadline - Date.now());
    if (timeout <= 0) return Promise.reject(new Error('Overall 180s deadline exceeded'));
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error('CDP timeout: ' + method)); }, timeout);
      this.pending.set(id, { resolve, reject, timer });
      try { this.ws.send(JSON.stringify({ id, method, params })); }
      catch (error) { clearTimeout(timer); this.pending.delete(id); reject(error); }
    });
  }
  async eval(expression, timeout = 15000) {
    const result = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true }, timeout);
    if (result.exceptionDetails) throw new Error('Page evaluation: ' + JSON.stringify(result.exceptionDetails));
    return result.result.value;
  }
  async wait(expression, label, timeout = 30000) {
    const end = Math.min(deadline, Date.now() + timeout);
    while (Date.now() < end) {
      if (await this.eval(expression, Math.min(5000, end - Date.now()))) return;
      await pause(100);
    }
    throw new Error('Timed out: ' + label);
  }
  async click(selector) {
    const point = await this.eval(`(async () => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el || el.disabled) throw new Error('Missing/disabled start button');
      el.scrollIntoView({ block: 'center', behavior: 'instant' });
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const r = el.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2;
      if (!r.width || !r.height || !el.contains(document.elementFromPoint(x, y))) throw new Error('Start button is obscured');
      return { x, y };
    })()`);
    await this.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...point });
    await this.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', buttons: 1, clickCount: 1 });
    await this.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', buttons: 0, clickCount: 1 });
  }
  close() { this.rejectPending(new Error('Test finished')); this.ws.close(); }
}

function installProbe(seed) {
  let state = seed >>> 0, randomCalls = 0;
  Math.random = function () {
    randomCalls++;
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  // Both routes share an origin, so reset only this isolated profile's game storage.
  localStorage.clear(); sessionStorage.clear();
  localStorage.setItem('fz.meta.v1', JSON.stringify({ sound: false, world: true, quality: 'low' }));
  const contexts = new Map(), extensions = new WeakSet(), installed = [];
  const methods = ['drawElements', 'drawArrays', 'drawElementsInstanced', 'drawArraysInstanced'];
  function record(gl) {
    if (!contexts.has(gl)) contexts.set(gl, Object.fromEntries(methods.map(name => [name, 0])));
    return contexts.get(gl);
  }
  function wrap(owner, name, gl, counterName = name) {
    const desc = Object.getOwnPropertyDescriptor(owner, name);
    if (!desc || typeof desc.value !== 'function') return;
    const native = desc.value;
    Object.defineProperty(owner, name, { ...desc, value: function (...args) {
      record(gl || this)[counterName]++;
      return Reflect.apply(native, this, args);
    } });
    installed.push(name);
  }
  for (const type of ['WebGL2RenderingContext', 'WebGLRenderingContext']) {
    const proto = window[type] && window[type].prototype;
    if (!proto) continue;
    for (const name of methods) wrap(proto, name);
    const desc = Object.getOwnPropertyDescriptor(proto, 'getExtension');
    if (!desc) continue;
    Object.defineProperty(proto, 'getExtension', { ...desc, value: function (...args) {
      const ext = Reflect.apply(desc.value, this, args);
      if (ext && String(args[0]).toLowerCase() === 'angle_instanced_arrays' && !extensions.has(ext)) {
        extensions.add(ext);
        for (const name of ['drawElementsInstanced', 'drawArraysInstanced']) {
          const method = name + 'ANGLE', native = ext[method], gl = this;
          if (typeof native === 'function') {
            ext[method] = function (...values) { record(gl)[name]++; return Reflect.apply(native, this, values); };
            installed.push(method);
          }
        }
      }
      return ext;
    } });
  }
  function worldContext() {
    const canvas = document.querySelector('#world canvas');
    for (const gl of contexts.keys()) if (gl.canvas === canvas) return gl;
    throw new Error('No instrumented world WebGL draws');
  }
  window.__perfProbe = {
    counts() { const gl = worldContext(); return { ...contexts.get(gl) }; },
    info() {
      const gl = worldContext(), ext = gl.getExtension('WEBGL_debug_renderer_info');
      return { seed, randomCalls, installed, version: gl.getParameter(gl.VERSION),
        renderer: gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER),
        vendor: gl.getParameter(ext ? ext.UNMASKED_VENDOR_WEBGL : gl.VENDOR) };
    }
  };
}

function settleCamera(quality, slot) {
  return new Promise((resolve, reject) => {
    let raf = 0, stable = 0, frames = 0, previous = null;
    const timer = setTimeout(() => { cancelAnimationFrame(raf); reject(new Error('Camera did not settle in 12s')); }, 12000);
    function step() {
      try {
        const d = FZ.World.debug(); frames++;
        const valid = d.phase === 'roam' && d.target === 'campus' && d.quality === quality && d.sky === slot &&
          Math.hypot(d.pos[0], d.pos[1] - 10) < 0.02 && Math.abs(d.yaw) < 0.003 &&
          Math.hypot(d.cam[0], d.cam[2] - 10) < 0.03 && Math.abs(d.cameraYaw) < 0.003;
        const same = previous && Math.hypot(...d.cam.map((v, i) => v - previous.cam[i])) < 0.02;
        stable = valid && same ? stable + 1 : 0;
        previous = d;
        if (stable >= 4 && frames >= 6) { clearTimeout(timer); resolve(d); }
        else raf = requestAnimationFrame(step);
      } catch (error) { clearTimeout(timer); reject(error); }
    }
    raf = requestAnimationFrame(step);
  });
}

function sampleFrames(frameCount, screenshots) {
  return new Promise((resolve, reject) => {
    const frames = [];
    let raf = 0, previous = null, warmup = 3;
    const timer = setTimeout(() => { cancelAnimationFrame(raf); reject(new Error('12-frame sample exceeded 25s')); }, 25000);
    function capture() {
      const canvas = document.querySelector('#world canvas'), output = document.createElement('canvas');
      output.width = 120; output.height = Math.max(1, Math.round(120 * canvas.height / canvas.width));
      const ctx = output.getContext('2d');
      ctx.drawImage(canvas, 0, 0, output.width, output.height);
      const data = ctx.getImageData(0, 0, output.width, output.height).data;
      let sum = 0, min = 255, max = 0, nonblack = 0, opaque = 0, hash = 2166136261;
      for (let i = 0; i < data.length; i += 4) {
        const value = (data[i] + data[i + 1] + data[i + 2]) / 3;
        sum += value; min = Math.min(min, value); max = Math.max(max, value);
        if (value > 2) nonblack++;
        if (data[i + 3] > 0) opaque++;
        hash = Math.imul(hash ^ data[i] ^ (data[i + 1] << 8) ^ (data[i + 2] << 16), 16777619);
      }
      const pixels = data.length / 4, rect = canvas.getBoundingClientRect();
      output.width = 32; output.height = Math.max(1, Math.round(32 * canvas.height / canvas.width));
      ctx.drawImage(canvas, 0, 0, output.width, output.height);
      const small = ctx.getImageData(0, 0, output.width, output.height).data, rgb = [];
      for (let i = 0; i < small.length; i += 4) rgb.push(small[i], small[i + 1], small[i + 2]);
      return { width: canvas.width, height: canvas.height, cssWidth: rect.width, cssHeight: rect.height,
        viewport: [innerWidth, innerHeight], min, max, mean: sum / pixels,
        nonblackFraction: nonblack / pixels, nontransparentFraction: opaque / pixels, hash: hash >>> 0,
        thumbnail: { width: output.width, height: output.height, rgb },
        png: screenshots ? canvas.toDataURL('image/png').split(',')[1] : null };
    }
    function step(timestamp) {
      try {
        const now = { timestamp, counts: window.__perfProbe.counts() };
        // This observer queues after World's rAF, so each delta includes every render pass.
        if (previous && warmup === 0) {
          const byMethod = Object.fromEntries(Object.keys(now.counts).map(name => [name, now.counts[name] - previous.counts[name]]));
          frames.push({ frameMs: timestamp - previous.timestamp, draws: Object.values(byMethod).reduce((a, b) => a + b, 0), byMethod });
        } else if (previous) warmup--;
        previous = now;
        if (frames.length === frameCount) {
          clearTimeout(timer);
          // Read the real drawing buffer before compositing clears it, outside measured intervals.
          resolve({ frames, debug: FZ.World.debug(), image: capture(), gl: window.__perfProbe.info() });
        } else raf = requestAnimationFrame(step);
      } catch (error) { clearTimeout(timer); reject(error); }
    }
    raf = requestAnimationFrame(step);
  });
}

function summary(values) {
  const sorted = [...values].sort((a, b) => a - b), n = sorted.length;
  return { median: n % 2 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2,
    p95: sorted[Math.ceil(n * 0.95) - 1], min: sorted[0], max: sorted[n - 1] };
}
function checkSample(sample, test, opt) {
  assert.equal(sample.frames.length, FRAMES);
  for (const frame of sample.frames) {
    assert(Number.isFinite(frame.frameMs) && frame.frameMs > 0, 'Invalid rAF frame time');
    assert(Number.isInteger(frame.draws) && frame.draws > 0, 'No native GL draws in a sampled frame');
    assert(Object.values(frame.byMethod).every(n => Number.isInteger(n) && n >= 0), 'Invalid draw counter');
  }
  const d = sample.debug, im = sample.image;
  assert.equal(d.quality, test.quality); assert.equal(d.phase, 'roam'); assert.equal(d.target, 'campus');
  assert.equal(d.dayNight, test.slot === 2 ? 'night' : 'day');
  assert.equal(d.sunVisible, test.slot !== 2); assert.equal(d.moonVisible, test.slot === 2);
  assert.deepStrictEqual(d.pos, [0, 10]); assert(Math.abs(d.yaw) < 0.003 && Math.abs(d.cameraYaw) < 0.003, 'Wrong camera yaw');
  assert(d.cam.every(Number.isFinite) && Math.hypot(d.cam[0], d.cam[2] - 10) < 0.03, 'Camera moved');
  assert.equal(d.auto, false); assert.equal(d.npcTarget, null);
  assert.deepStrictEqual(im.viewport, [opt.width, opt.height]);
  assert(im.width > 0 && im.height > 0 && im.cssWidth > 0 && im.cssHeight > 0, 'Empty canvas');
  assert(im.max - im.min > 4 && im.mean > 0.5 && im.nonblackFraction > 0.01 && im.nontransparentFraction > 0.99,
    'Actual world canvas is blank/black/transparent');
}
async function runVersion(cdp, version, opt, report) {
  cdp.label = version + '/boot';
  await cdp.send('Page.navigate', { url: 'about:blank' });
  await cdp.send('Page.navigate', { url: cdp.origin + '/' + version + '/index.html' });
  await cdp.wait(`document.readyState === 'complete' && !!window.FZ && !!FZ.World &&
    !!document.querySelector('#world-veil') && !document.querySelector('#world-veil').classList.contains('on') &&
    !document.querySelector('#world-veil').classList.contains('off')`, 'world boot', 35000);
  await cdp.eval(`(() => {
    if (!FZ.World.isOk() || !document.body.classList.contains('world-on')) throw new Error('Real WebGL world did not initialize');
    FZ.World.setQuality('low');
    const major = document.querySelector('#major-select'); major.value = '数学与应用数学';
    major.dispatchEvent(new Event('change', { bubbles: true }));
    const subject = document.querySelector('#subject-select'); subject.value = '数学分析';
    subject.dispatchEvent(new Event('change', { bubbles: true }));
    if (!major.value || !subject.value) throw new Error('Missing real setup options');
  })()`);
  const data = report.versions[version] = { root: ROOTS[version], url: cdp.origin + '/' + version + '/index.html',
    glAtBoot: await cdp.eval('window.__perfProbe.info()'), cases: [] };
  await cdp.click('#btn-start');
  await cdp.wait(`document.querySelector('#screen-game').classList.contains('active') && !!localStorage.getItem('fz.run.v1')`, 'real game start');
  data.game = await cdp.eval(`(() => {
    const save = JSON.parse(localStorage.getItem('fz.run.v1'));
    if (!save.currentEvent || !FZ.EVENTS.some(e => e.id === save.currentEvent.id) || save.decisions !== 0 || save.slot !== 0)
      throw new Error('Invalid real new game');
    window.scrollTo(0, 0);
    return { major: save.major, subject: save.subject, day: save.day, slot: save.slot, event: save.currentEvent.id };
  })()`);
  for (const test of CASES) {
    if (interrupted) throw interrupted;
    cdp.label = version + '/' + test.id;
    const result = { ...test, scene: 'campus', day: 1, position: [0, 10], yaw: 0, passed: false };
    data.cases.push(result);
    try {
      await cdp.eval(`FZ.World.setQuality('low'); FZ.World.beginSlot({ scene: 'campus', day: 1, slot: ${test.slot} }); FZ.World.place(0, 10, 0);`);
      await cdp.eval(`(${settleCamera})('low', ${test.slot})`, 14000);
      await cdp.eval(`FZ.World.setQuality(${JSON.stringify(test.quality)})`);
      await cdp.eval(`(${settleCamera})(${JSON.stringify(test.quality)}, ${test.slot})`, 14000);
      const sample = await cdp.eval(`(${sampleFrames})(${FRAMES}, ${Boolean(opt.shots)})`, 28000);
      const png = sample.image.png; delete sample.image.png;
      Object.assign(result, sample, { draws: summary(sample.frames.map(f => f.draws)), frameMs: summary(sample.frames.map(f => f.frameMs)) });
      if (opt.shots) {
        result.screenshot = path.join(opt.shots, version + '-' + test.id + '.png');
        fs.writeFileSync(result.screenshot, Buffer.from(png, 'base64'));
      }
      checkSample(sample, test, opt);
      assert(!cdp.errors.some(e => e.case === cdp.label), 'Console/runtime/network error in this case');
      result.passed = true;
    } catch (error) {
      result.error = error.stack || String(error);
      report.errors.push(cdp.label + ': ' + result.error);
      if (interrupted) throw interrupted;
    }
  }
}

function compare(report) {
  const baseline = report.versions.baseline, current = report.versions.current;
  if (!baseline || !current) return;
  if (baseline.game && current.game && JSON.stringify(baseline.game) !== JSON.stringify(current.game)) {
    report.notes.push('Seeded new-game selections differ; inspect random-consumption changes.');
  }
  for (const test of CASES) {
    const a = baseline.cases.find(c => c.id === test.id), b = current.cases.find(c => c.id === test.id);
    if (!a || !b || !a.draws || !b.draws) continue;
    const comparison = { id: test.id, baselineDrawsMedian: a.draws.median, currentDrawsMedian: b.draws.median,
      drawsReduced: b.draws.median < a.draws.median, drawReductionPercent: 100 * (1 - b.draws.median / a.draws.median),
      baselineFrameMs: a.frameMs, currentFrameMs: b.frameMs,
      frameMedianRatioCurrentToBaseline: b.frameMs.median / a.frameMs.median,
      cameraDistance: Math.hypot(...a.debug.cam.map((v, i) => v - b.debug.cam[i])),
      meanPixelDelta: b.image.mean - a.image.mean, screenshots: [a.screenshot || null, b.screenshot || null] };
    const ar = a.image.thumbnail.rgb, br = b.image.thumbnail.rgb;
    if (ar.length === br.length) comparison.thumbnailMeanAbsoluteDelta = ar.reduce((sum, v, i) => sum + Math.abs(v - br[i]), 0) / ar.length;
    report.comparisons.push(comparison);
    try {
      assert.equal(a.debug.renderPixelRatio, b.debug.renderPixelRatio, 'Unequal render pixel ratio');
      assert.deepStrictEqual([a.image.width, a.image.height], [b.image.width, b.image.height], 'Unequal drawing buffer dimensions');
      assert.deepStrictEqual(a.debug.pos, b.debug.pos, 'Unequal player positions');
      assert(comparison.cameraDistance <= 0.05 && Math.abs(a.debug.cameraYaw - b.debug.cameraYaw) <= 0.003, 'Unequal settled cameras');
    } catch (error) { report.errors.push(test.id + ': ' + error.message); }
  }
}

async function assertPortFree(port) {
  await new Promise((resolve, reject) => {
    const guard = net.createServer();
    guard.once('error', () => reject(new Error('Debug port is occupied; refusing to attach to another browser: ' + port)));
    guard.listen(port, '127.0.0.1', () => guard.close(resolve));
  });
}
async function chromeTarget(port, state) {
  const end = Math.min(deadline, Date.now() + 25000);
  while (Date.now() < end) {
    if (interrupted) throw interrupted;
    if (state.error) throw state.error;
    if (state.exited) throw new Error('Owned Chrome exited before CDP became ready');
    try {
      // Verify the token printed by our child; DevToolsActivePort is not guaranteed for fixed ports.
      if (state.endpoint) {
        const owned = new URL(state.endpoint);
        assert(owned.hostname === '127.0.0.1' && Number(owned.port) === port, 'Chrome endpoint ownership mismatch');
        const response = await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(1200) });
        const version = await response.json();
        if (version.webSocketDebuggerUrl !== state.endpoint) throw new Error('Chrome endpoint ownership mismatch');
        const list = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(1200) });
        const target = (await list.json()).find(t => t.type === 'page' && t.url === 'about:blank');
        if (target) {
          const url = new URL(target.webSocketDebuggerUrl);
          assert(url.hostname === owned.hostname && url.port === owned.port, 'Chrome endpoint ownership mismatch');
          return target.webSocketDebuggerUrl;
        }
      }
    } catch (error) {
      if (error.message === 'Chrome endpoint ownership mismatch') throw error;
      if (state.error) throw state.error;
    }
    await pause(100);
  }
  throw new Error('Owned Chrome CDP did not become ready');
}
async function destroyChrome(chrome, state, cdp, profile) {
  let problem = null;
  if (cdp && !state.exited) {
    try { await cdp.send('Browser.close', {}, 4000); } catch (_) { /* Closing may close the socket before replying. */ }
  }
  if (cdp) cdp.close();
  if (chrome && !state.exited) await Promise.race([state.done, pause(1500)]);
  if (chrome && chrome.pid && !state.exited) {
    if (process.platform === 'win32') {
      await new Promise((resolve, reject) => {
        const kill = spawn('taskkill', ['/PID', String(chrome.pid), '/T', '/F'], { stdio: 'ignore' });
        const timer = setTimeout(() => { kill.kill(); reject(new Error('Owned-PID taskkill timeout')); }, 10000);
        kill.once('error', error => { clearTimeout(timer); reject(error); });
        kill.once('exit', () => { clearTimeout(timer); resolve(); });
      }).catch(error => { problem = error; });
    } else chrome.kill('SIGKILL');
    await Promise.race([state.done, pause(4000)]);
    if (!state.exited) problem = new Error('Owned Chrome did not exit: PID ' + chrome.pid);
  }
  if (profile && (!chrome || state.exited)) {
    try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 8, retryDelay: 200 }); }
    catch (error) { problem = new Error('Temporary profile cleanup failed: ' + profile + ': ' + error.message); }
  }
  if (problem) throw problem;
}

async function main() {
  const opt = options(), executable = require('./browser')();
  assert(typeof WebSocket === 'function', 'Use Node.js 22+ (built-in WebSocket); no npm dependencies');
  await assertPortFree(opt.port);
  const report = { schemaVersion: 1, startedAt: new Date().toISOString(), seed: SEED,
    viewport: { width: opt.width, height: opt.height, deviceScaleFactor: 1, mobile: opt.width < 700 },
    framesPerCase: FRAMES, timeoutMs: TIMEOUT, backend: 'ANGLE SwiftShader (software): relative results only',
    methodology: 'Native world-context GL calls across complete rAF intervals; includes all render/postprocessing passes. Frame times are rAF cadence, not GPU timer queries. Steady-state samples exclude boot, transitions and initial shadow refresh.',
    notes: ['Run before rebuilding dist. No draw/FPS speedup assertion; batching effectiveness is reported for review.',
      'Seed, viewport, scene/day/slot, transforms and quality match; clocks/animated objects are not frozen. Pixel differences and screenshots are visual diagnostics, not exact equality tests.',
      'Only 12 frames per case: p95 is the nearest-rank maximum, not a long-run benchmark.'],
    versions: {}, comparisons: [], consoleErrors: [], errors: [] };
  const state = { exited: false, error: null, done: null };
  let server, chrome, cdp, profile;
  const stop = reason => { interrupted = new Error(reason); if (cdp) cdp.rejectPending(interrupted); };
  const onInt = () => stop('Interrupted by SIGINT'), onTerm = () => stop('Interrupted by SIGTERM');
  process.on('SIGINT', onInt); process.on('SIGTERM', onTerm);
  deadline = Date.now() + TIMEOUT;
  const watchdog = setTimeout(() => stop('Overall 180s deadline exceeded'), TIMEOUT);
  try {
    server = await serve();
    if (opt.shots) fs.mkdirSync(opt.shots, { recursive: true });
    profile = fs.mkdtempSync(path.join(os.tmpdir(), 'fz-perf-'));
    chrome = spawn(executable, ['--headless=new', '--remote-debugging-address=127.0.0.1', `--remote-debugging-port=${opt.port}`,
      `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--mute-audio',
      '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-background-networking',
      '--disable-component-update', '--disable-sync', '--disable-features=Translate,MediaRouter',
      `--window-size=${opt.width},${opt.height}`, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
    state.done = new Promise(resolve => {
      chrome.once('error', error => { state.error = error; state.exited = true; resolve(); });
      chrome.once('exit', () => { state.exited = true; resolve(); });
    });
    let stderr = '';
    chrome.stderr.setEncoding('utf8');
    chrome.stderr.on('data', chunk => {
      stderr = (stderr + chunk).slice(-8192);
      const match = stderr.match(/DevTools listening on (ws:\/\/[^\s]+)[\r\n]/);
      if (match) state.endpoint = match[1];
    });
    cdp = await CDP.connect(await chromeTarget(opt.port, state));
    cdp.origin = `http://127.0.0.1:${server.address().port}`;
    await cdp.send('Page.enable'); await cdp.send('Runtime.enable'); await cdp.send('Log.enable');
    await cdp.send('Network.enable'); await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
    await cdp.send('Network.setBypassServiceWorker', { bypass: true });
    await cdp.send('Fetch.enable', { patterns: [{ urlPattern: 'http://*', requestStage: 'Request' }, { urlPattern: 'https://*', requestStage: 'Request' }] });
    await cdp.send('Emulation.setDeviceMetricsOverride', report.viewport);
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
      source: `if (location.origin === ${JSON.stringify(cdp.origin)}) (${installProbe})(${SEED});`
    });
    for (const version of ['baseline', 'current']) {
      try { await runVersion(cdp, version, opt, report); }
      catch (error) { report.errors.push(version + ': ' + (error.stack || String(error))); if (interrupted) break; }
    }
    compare(report);
  } catch (error) { report.errors.push(error.stack || String(error)); }
  finally {
    clearTimeout(watchdog);
    if (cdp) report.consoleErrors = cdp.errors.slice();
    try { await destroyChrome(chrome, state, cdp, profile); } catch (error) { report.errors.push(error.message); }
    if (server) await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
    process.removeListener('SIGINT', onInt); process.removeListener('SIGTERM', onTerm);
  }
  const tested = Object.values(report.versions).flatMap(v => v.cases);
  report.passed = tested.length === 8 && tested.every(t => t.passed) && report.comparisons.length === 4 && !report.errors.length && !report.consoleErrors.length;
  report.finishedAt = new Date().toISOString();
  console.log('SwiftShader — relative only; draw counts are native GL totals, not renderer.debug.calls.');
  for (const c of report.comparisons) {
    console.log(`${c.id}: draws ${c.baselineDrawsMedian} -> ${c.currentDrawsMedian} (${c.drawReductionPercent.toFixed(1)}% reduction); ` +
      `frame ms median/p95 ${c.baselineFrameMs.median.toFixed(1)}/${c.baselineFrameMs.p95.toFixed(1)} -> ` +
      `${c.currentFrameMs.median.toFixed(1)}/${c.currentFrameMs.p95.toFixed(1)}; pixel delta ${c.meanPixelDelta.toFixed(2)}`);
  }
  console.log(`${report.passed ? 'PASS' : 'FAIL'}: ${tested.filter(t => t.passed).length}/8 cases; ${report.consoleErrors.length} console/runtime/network errors. No speedup assertion.`);
  for (const error of report.errors) console.error(error);
  for (const error of report.consoleErrors) console.error(JSON.stringify(error));
  if (opt.out) { fs.writeFileSync(opt.out, JSON.stringify(report, null, 2) + '\n'); console.log('JSON: ' + opt.out); }
  if (opt.shots) console.log('Canvas screenshots: ' + opt.shots);
  if (!report.passed) process.exitCode = 1;
}

main().catch(error => { console.error(error.stack || String(error)); process.exitCode = 1; });
