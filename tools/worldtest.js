#!/usr/bin/env node
/* 三维校园冒烟测试：WebGL 是否起来、世界是否渲染出画面、阶段是否切换、走到目标是否触发叙事。
   用法: node tools/worldtest.js [--width 1440] [--height 900] [--shots 目录] [--port 9444] [--navigation-only] */
const assert = require('node:assert/strict');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const CHROME = require('./browser')();
const URL_BASE = process.env.FZ_URL || 'http://127.0.0.1:8765/index.html';
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > -1 ? process.argv[i + 1] : d; };
const WIDTH = parseInt(arg('--width', '1440'), 10);
const HEIGHT = parseInt(arg('--height', '900'), 10);
const SHOTS = arg('--shots', '');
const PORT = parseInt(arg('--port', '9444'), 10);
const QUAL = arg('--quality', '');
const NAVIGATION_ONLY = process.argv.includes('--navigation-only');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const problems = [];
const note = (m) => { problems.push(m); console.log('  ✗ ' + m); };

function checkConsole(cdp) {
  const errs = cdp.consoleErrors();
  if (errs.length) errs.forEach((e) => note('控制台: ' + e));
  else console.log('  控制台 0 报错');
}

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
      const value = await this.eval(expression);
      if (value) return value; // 新断言可原子地保留满足条件的快照，避免移动中的二次采样竞态。
      await sleep(120);
    }
    this.consoleErrors().forEach((e) => console.log('  [页面报错] ' + e));
    throw new Error('等待超时: ' + label);
  }
  async click(selector) {
    const point = await this.wait(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el || el.disabled || !el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) return false;
      el.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' });
      const r = el.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2;
      return r.width && r.height && el.contains(document.elementFromPoint(x, y)) ? { x, y } : false;
    })()`, '可点击 ' + selector);
    await this.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...point });
    await this.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', buttons: 1, clickCount: 1 });
    await this.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', buttons: 0, clickCount: 1 });
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

// 同一次求值读取 debug 与实际 DOM；SVG 旋转后的包围盒不能直接当作 34px 尺寸。
const GUIDE_STATE = `(() => {
  const inspect = el => {
    if (!el) return null;
    const r = el.getBoundingClientRect(), style = getComputedStyle(el);
    return { visible: el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }),
      width: parseFloat(style.width), height: parseFloat(style.height), box: [r.width, r.height] };
  };
  const needle = document.getElementById('compass-needle'), label = document.getElementById('roam-direction');
  const shape = needle && needle.querySelector('path');
  const transform = needle && getComputedStyle(needle).transform;
  const matrix = new DOMMatrixReadOnly(!transform || transform === 'none' ? undefined : transform);
  const bounds = shape && shape.getBBox();
  return { debug: FZ.World.debug(), compass: inspect(document.querySelector('.rc-compass')),
    needle: inspect(needle), svg: !!needle && needle instanceof SVGSVGElement,
    painted: !!bounds && bounds.width > 0 && bounds.height > 0 && getComputedStyle(shape).fill !== 'none',
    rotation: Math.atan2(matrix.b, matrix.a), scale: [Math.hypot(matrix.a, matrix.b), Math.hypot(matrix.c, matrix.d)],
    label: inspect(label), text: label ? label.textContent.trim() : '',
    distanceText: document.getElementById('roam-dist').textContent.trim() };
})()`;
const angleDelta = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));
const pointDistance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

function checkGuide(s, label, stationary = false) {
  const d = s.debug, g = d.guide;
  assert.equal(d.phase, 'roam', label + ': 不是 roam');
  assert.equal(d.interactionLocked, false, label + ': 意外交互锁');
  assert(g && g.visible, label + ': 地面箭头不可见');
  assert(Number.isInteger(g.count) && g.count > 0 && g.count <= 32, label + ': 箭头实例数无效 ' + g.count);
  assert.equal(g.target, d.target, label + ': 箭头目的地不是剧情目标');
  assert(Number.isFinite(g.distance) && g.distance >= 0, label + ': 缺少路线剩余距离');
  assert.equal(s.distanceText, g.distance < 1.4 ? '即将到达' : Math.ceil(g.distance) + ' m',
    label + ': 距离文字没有使用同一帧的折线剩余距离');
  assert(Array.isArray(g.next) && g.next.length === 2 && g.next.every(Number.isFinite), label + ': 缺少有效路线航点');
  assert(Number.isFinite(d.cameraYaw) && Number.isFinite(g.bearing) && Math.abs(g.bearing) <= Math.PI, label + ': 角度无效');
  assert(s.svg && s.painted && s.needle && s.needle.visible, label + ': SVG 箭头没有显示/绘制');
  assert(s.compass && s.compass.visible && s.compass.box.every(n => Math.abs(n - 52) <= 1), label + ': 罗盘实际尺寸不是 52px');
  assert(Math.abs(s.needle.width - 34) <= 0.5 && Math.abs(s.needle.height - 34) <= 0.5, label + ': SVG 尺寸不是 34px');
  const rotatedSize = 34 * (Math.abs(Math.cos(s.rotation)) + Math.abs(Math.sin(s.rotation)));
  assert(s.scale.every(n => Math.abs(n - 1) < 0.001) && s.needle.box.every(n => Math.abs(n - rotatedSize) <= 1), label + ': SVG 实际包围盒/缩放不符');
  assert(Math.abs(angleDelta(s.rotation, g.bearing)) < 0.002, label + ': CSS 旋转与路线 bearing 不一致');
  const text = Math.abs(g.bearing) > 2.4 ? '向后转，沿路走' :
    g.bearing > 0.45 ? '向右转，沿路走' : g.bearing < -0.45 ? '向左转，沿路走' : '沿箭头向前走';
  assert(s.label && s.label.visible, label + ': 方向文字不可见');
  assert.equal(s.text, text, label + ': 方向文字错误');
  if (stationary) {
    assert.equal(d.auto, false, label + ': 手动测试意外启动自动导航');
    const distance = pointDistance(d.pos, g.next);
    assert(distance > 0.33, label + ': 航点没有跳过脚下位置');
    const targetYaw = Math.atan2(d.pos[0] - g.next[0], d.pos[1] - g.next[1]);
    // pos 只保留 .01m；角度误差随航点距离变化，不能用 rounded yaw 当相机朝向。
    assert(Math.abs(angleDelta(g.bearing, d.cameraYaw - targetYaw)) < 0.02 + 0.02 / distance,
      label + ': 相机相对航点的左右方向错误');
  }
}

async function hiddenGuide(cdp, label, stopped = false) {
  const d = await cdp.wait(`(() => {
    const d = FZ.World.debug(); return d.guide && d.guide.visible === false ? d : false;
  })()`, label);
  // stop() 可保留已上传实例，只须不可见；event/modal 则应清空可绘制数量。
  if (!stopped) assert.equal(d.guide.count, 0, label + ': 隐藏后仍有箭头实例');
}

// 只读取可见 DOM 与公开 debug；不替换游戏回调，也不依赖截图颜色的精确值。
const MAP_STATE = `(() => {
  const map = document.querySelector('aside#campus-map'), button = document.querySelector('button#btn-map');
  const content = document.getElementById('minimap-content'), canvas = document.querySelector('canvas#minimap');
  const visible = el => !!el && el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true });
  const d = FZ.World.debug();
  let paint = null;
  if (visible(canvas) && canvas.width && canvas.height) {
    const g = canvas.getContext('2d');
    if (g) {
      const pixels = g.getImageData(0, 0, canvas.width, canvas.height).data, colors = new Set();
      const stride = 4 * Math.max(1, Math.floor(pixels.length / 4 / 1600));
      let opaque = 0, samples = 0;
      for (let i = 0; i < pixels.length; i += stride) {
        samples++; if (pixels[i + 3] > 128) opaque++;
        colors.add((pixels[i] >> 4) + ',' + (pixels[i + 1] >> 4) + ',' + (pixels[i + 2] >> 4));
      }
      paint = { colors: colors.size, opaque: opaque / samples };
    }
  }
  return { structure: !!(map && button && content && canvas && map.contains(button) && map.contains(content) && content.contains(canvas)),
    visible: visible(map), buttonVisible: visible(button), contentVisible: visible(content), canvasVisible: visible(canvas),
    collapsed: !!map && map.classList.contains('is-collapsed'), expanded: button && button.getAttribute('aria-expanded'),
    controls: button && button.getAttribute('aria-controls'), label: canvas && canvas.getAttribute('aria-label'),
    location: FZ.World.locName(d.target), phase: d.phase, worldOn: document.body.classList.contains('world-on'),
    locked: d.interactionLocked, paint };
})()`;

async function checkMinimap(cdp, label, expanded = true) {
  const s = await cdp.wait(`(() => {
    const s = ${MAP_STATE};
    return s.structure && s.visible && s.buttonVisible && s.collapsed === ${!expanded} && s.expanded === '${expanded}' &&
      ${expanded ? "s.contentVisible && s.canvasVisible && s.paint && s.paint.opaque > 0.5 && s.paint.colors > 8 && s.label && s.label.includes(s.location)" : '!s.contentVisible && !s.canvasVisible'} ? s : false;
  })()`, label + ': 小地图' + (expanded ? '展开并绘制' : '折叠'), 45000);
  assert.equal(s.phase, 'roam', label + ': 地图不在 roam');
  assert(s.worldOn && !s.locked, label + ': 地图不在可交互的三维漫游中');
  assert.equal(s.controls, 'minimap-content', label + ': 折叠按钮的 aria-controls 错误');
  return s;
}

async function hiddenMap(cdp, label) {
  await cdp.wait(`(() => {
    const el = document.querySelector('aside#campus-map');
    return !!el && !el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true });
  })()`, label + ': 隐藏小地图');
}

const TOUCH_STATE = `(() => {
  const stick = document.getElementById('stick').getBoundingClientRect();
  const knob = document.getElementById('stick-knob').getBoundingClientRect();
  return { debug: FZ.World.debug(), knob: [knob.left + knob.width / 2 - stick.left - stick.width / 2,
    knob.top + knob.height / 2 - stick.top - stick.height / 2] };
})()`;

async function noTouchDrift(cdp, label, held = false) {
  // 多个实际渲染帧都必须静止；只看玩家 pos，不把停止后的相机 bob 收敛误判为漂移。
  const s = await cdp.eval(`new Promise(resolve => {
    const first = ${TOUCH_STATE}, start = performance.now();
    let frames = 0, drift = 0, badControl = false, knobOffset = 0, raf;
    const finish = timedOut => {
      clearTimeout(timer); cancelAnimationFrame(raf);
      resolve({ timedOut, frames, drift, badControl, knobOffset, first, last: ${TOUCH_STATE} });
    };
    const sample = () => {
      const s = ${TOUCH_STATE}, d = s.debug, controls = d.controls;
      drift = Math.max(drift, Math.hypot(d.pos[0] - first.debug.pos[0], d.pos[1] - first.debug.pos[1]));
      knobOffset = Math.max(knobOffset, Math.hypot(...s.knob));
      badControl ||= !controls || controls.stick !== ${held} || controls.look || Math.hypot(...controls.vector) > 0.0001 || d.auto || d.phase !== 'roam';
      return ++frames >= 8 && performance.now() - start >= 650;
    };
    const tick = () => { if (sample()) finish(false); else raf = requestAnimationFrame(tick); };
    const timer = setTimeout(() => finish(true), 25000);
    sample(); raf = requestAnimationFrame(tick);
  })`);
  assert(!s.timedOut, label + ': 未收到足够渲染帧');
  assert(!s.badControl, label + ': 摇杆/视角未释放或死区向量不为零');
  if (!held) assert(Math.hypot(...s.last.knob) <= 1, label + ': 摇杆旋钮在释放动画后未居中');
  assert(s.drift <= 0.02, label + ': 玩家持续漂移 ' + s.drift);
}

async function touchNavigation(cdp) {
  const touch = (type, touchPoints = []) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints });
  let active = false;
  try {
    for (const ending of ['touchEnd', 'touchCancel']) {
      await cdp.eval('FZ.World.place(11, 0, 0)');
      await cdp.wait(`(() => {
        const d = FZ.World.debug();
        return Math.hypot(d.pos[0] - 11, d.pos[1]) < 0.02 && Math.abs(Math.atan2(Math.sin(d.cameraYaw), Math.cos(d.cameraYaw))) < 0.005;
      })()`, '触屏测试回到安全导航环', 45000);
      const points = await cdp.wait(`(() => {
        const stick = document.getElementById('stick'), canvas = document.querySelector('#world canvas');
        if (!stick.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }) || !canvas) return false;
        const r = stick.getBoundingClientRect(), thumb = { id: 1, x: r.left + r.width / 2, y: r.top + r.height / 2 };
        const walk = { ...thumb, y: thumb.y - r.height * 0.3 };
        if (![thumb, walk].every(p => stick.contains(document.elementFromPoint(p.x, p.y)))) return false;
        for (const fy of [0.4, 0.5, 0.3, 0.6, 0.7, 0.2]) for (const fx of [0.6, 0.7, 0.55, 0.8]) {
          const x = Math.round(innerWidth * fx), y = Math.round(innerHeight * fy), dx = 42;
          if (x + dx >= innerWidth - 4) continue;
          if ([0, dx / 2, dx].every(offset => document.elementFromPoint(x + offset, y) === canvas)) {
            return { thumb, walk, near: { ...thumb, x: thumb.x + r.width * 0.025, y: thumb.y + r.height * 0.025 },
              look: { id: 2, x, y }, turned: { id: 2, x: x + dx, y } };
          }
        }
        return false;
      })()`, '摇杆与右侧画布的真实触摸命中点', 45000);
      active = true;
      await touch('touchStart', [points.thumb]);
      await touch('touchMove', [points.near]);
      await noTouchDrift(cdp, '径向死区 ' + ending, true);
      await touch('touchMove', [points.thumb]);
      // 第二根手指加入时仍把第一根留在事件里，随后每个 move 都保留两个稳定 touch id。
      await touch('touchStart', [points.thumb, points.look]);
      const before = await cdp.eval(TOUCH_STATE);
      assert(before.debug.controls.stick && before.debug.controls.look, '第二根手指抢走了摇杆');
      await touch('touchMove', [points.walk, points.look]);
      const walked = await cdp.wait(`(() => {
        const s = ${TOUCH_STATE};
        return Math.hypot(s.debug.pos[0] - ${before.debug.pos[0]}, s.debug.pos[1] - ${before.debug.pos[1]}) > 0.12 ? s : false;
      })()`, '双指持有时仅推动摇杆产生位移', 45000);
      assert(walked.debug.controls.stick && walked.debug.controls.look, '移动摇杆丢失了独立视角手指');
      assert(Math.hypot(...walked.debug.controls.vector) > 0.2, '推动摇杆没有有效输入向量');
      assert(Math.abs(angleDelta(walked.debug.cameraYaw, before.debug.cameraYaw)) < 0.02, '摇杆输入意外转动视角');
      await touch('touchMove', [points.walk, points.turned]);
      const turned = await cdp.wait(`(() => {
        const s = ${TOUCH_STATE}, d = s.debug;
        return Math.abs(Math.atan2(Math.sin(d.cameraYaw - ${walked.debug.cameraYaw}), Math.cos(d.cameraYaw - ${walked.debug.cameraYaw}))) > 0.05 &&
          Math.hypot(d.pos[0] - ${walked.debug.pos[0]}, d.pos[1] - ${walked.debug.pos[1]}) > 0.08 ? s : false;
      })()`, '第二根手指转视角且摇杆继续行走', 45000);
      assert(turned.debug.controls.stick && turned.debug.controls.look, '双指没有独立持有摇杆和视角');
      assert(pointDistance(turned.debug.controls.vector, walked.debug.controls.vector) < 0.001, '视角手指改变了摇杆向量');
      assert.equal(turned.debug.auto, false, '触屏行走意外变成自动导航');
      await touch(ending);
      active = false;
      await noTouchDrift(cdp, ending + ' 释放后');
    }
  } finally {
    if (active) await touch('touchCancel');
    await cdp.eval('FZ.World.place(11, 0, 0)');
  }
  console.log('  实际 CDP 双指：径向死区、独立行走/转向、结束/取消归中无漂移通过');
}

const HUD_STATE = `(() => {
  const boxes = {};
  let ready = true;
  for (const [name, selector] of Object.entries({ map: '#campus-map', stats: '.stats-panel', panel: '#roam-hud', go: '#btn-go', stick: '#stick', fold: '#btn-map' })) {
    const el = document.querySelector(selector);
    if (!el || !el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) return false;
    // 仅等这些控件及祖先的有限入场动画，不等待无限装饰动画。
    for (let node = el; node; node = node.parentElement) {
      if (node.getAnimations().some(a => a.playState === 'running' && a.effect && Number.isFinite(a.effect.getComputedTiming().endTime))) ready = false;
    }
    const r = el.getBoundingClientRect();
    const hits = [[0.5, 0.5], [0.2, 0.5], [0.8, 0.5]].map(([fx, fy]) =>
      el.contains(document.elementFromPoint(r.left + r.width * fx, r.top + r.height * fy)));
    boxes[name] = { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height, hits };
  }
  return ready ? { boxes, width: innerWidth, height: innerHeight,
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth, guide: ${GUIDE_STATE} } : false;
})()`;

async function compactNavigation(cdp) {
  try {
    await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 2 });
    for (const [width, height] of [[320, 740], [844, 390]]) {
      await cdp.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: true });
      await checkMinimap(cdp, '紧凑视口 ' + width + '×' + height);
      const s = await cdp.wait(`(() => {
        const s = ${HUD_STATE};
        return s && s.width === ${width} && s.height === ${height} && s.guide.needle && s.guide.needle.visible &&
          s.guide.compass && s.guide.compass.visible && s.guide.label && s.guide.label.visible && s.guide.painted ? s : false;
      })()`, '紧凑漫游控件完成布局 ' + width + '×' + height, 45000);
      const label = width + '×' + height;
      checkGuide(s.guide, label);
      assert(s.overflow <= 1, label + ': 横向溢出');
      for (const [name, r] of Object.entries(s.boxes)) {
        assert(r.width > 0 && r.height > 0 && r.left >= -1 && r.top >= -1 && r.right <= width + 1 && r.bottom <= height + 1,
          label + ': 控件超出视口 ' + name + ' ' + JSON.stringify(r));
        assert(r.hits.every(Boolean), label + ': 控件被遮挡/裁剪 ' + name + ' ' + JSON.stringify(r));
      }
      // go 在 panel 内、fold 在 map 内是正常包含关系；只检测各独立区域的交叠。
      const regions = ['map', 'stats', 'panel', 'go', 'stick'];
      for (let i = 0; i < regions.length; i++) for (let j = i + 1; j < regions.length; j++) {
        if (regions[i] === 'panel' && regions[j] === 'go') continue;
        const a = s.boxes[regions[i]], b = s.boxes[regions[j]];
        const overlapX = Math.min(a.right, b.right) - Math.max(a.left, b.left);
        const overlapY = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
        assert(overlapX <= 1 || overlapY <= 1, label + ': 漫游控件交叠 ' + regions[i] + '/' + regions[j]);
      }
      await cdp.click('#btn-map');
      await checkMinimap(cdp, label, false);
      await cdp.click('#btn-map');
      await checkMinimap(cdp, label + ' 重新展开');
      if (width === 320) await touchNavigation(cdp);
      console.log('  紧凑 HUD 尺寸/命中/无交叠:', label);
    }
  } finally {
    await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: WIDTH < 700, maxTouchPoints: 2 });
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: WIDTH, height: HEIGHT, deviceScaleFactor: 1, mobile: WIDTH < 700 });
    await checkMinimap(cdp, '恢复原视口');
  }
}

async function armArrival(cdp) {
  return cdp.eval(`(() => {
    const el = document.getElementById('nav-arrival');
    if (!el) throw new Error('缺少全局 nav-arrival');
    const d = FZ.World.debug();
    const capture = window.__worldtestArrival = { expected: '已到达 ' + FZ.World.locName(d.target) + ' · 开始本时段事件', firstEvent: null };
    const observer = new MutationObserver(() => {
      const state = FZ.World.debug();
      if (document.body.dataset.wphase !== 'event' || !state.arrived || capture.firstEvent) return;
      // 在进入 event 的同一轮 DOM 微任务取样；不能等叙事打完，更不能要求 3.2s 后还显示。
      capture.firstEvent = { text: el.textContent.trim(), on: el.classList.contains('on'), role: el.getAttribute('role'),
        global: !el.closest('.screen, #roam-hud, dialog'), target: state.target,
        visible: el.checkVisibility({ checkOpacity: false, checkVisibilityCSS: true }) };
      observer.disconnect();
    });
    observer.observe(document.body, { attributes: true, attributeFilter: ['data-wphase'] });
    observer.observe(el, { attributes: true, attributeFilter: ['class'], childList: true, characterData: true, subtree: true });
    return d;
  })()`);
}

async function manualGuide(cdp) {
  const initial = await cdp.wait(`(() => {
    const s = ${GUIDE_STATE}, d = s.debug;
    return d.phase === 'roam' && d.guide && d.guide.visible &&
      s.needle && s.needle.visible && s.compass && s.compass.visible && s.label && s.label.visible && s.painted &&
      Math.abs(Math.atan2(Math.sin(d.cameraYaw - d.yaw), Math.cos(d.cameraYaw - d.yaw))) < 0.005 ? s : false;
  })()`, '初始手动漫游箭头');
  checkGuide(initial, '初始手动漫游', true);
  const saved = await cdp.eval(`({ debug: FZ.World.debug(), run: localStorage.getItem('fz.run.v1'),
    state: ${WORLD_STATE}, scroll: [scrollX, scrollY], focus: document.activeElement.id })`);
  assert(saved.run, '方向测试前缺少正常游戏存档');
  assert.equal(saved.debug.npcTarget, null, '方向测试必须在剧情手动漫游中');
  try {
    await checkMinimap(cdp, '初始三维漫游');
    await cdp.click('#btn-map');
    await checkMinimap(cdp, '初始视口折叠', false);
    await cdp.click('#btn-map');
    await checkMinimap(cdp, '初始视口恢复地图');
    // 东侧 11m 导航环：无家具/中心花坛，远离所有事件站位与附近人物。
    await cdp.eval('FZ.World.place(11, 0, 0)');
    const route = await cdp.wait(`(() => {
      const d = FZ.World.debug();
      return d.guide && d.guide.visible && Math.hypot(d.pos[0] - 11, d.pos[1]) < 0.02 &&
        Math.abs(Math.atan2(Math.sin(d.cameraYaw), Math.cos(d.cameraYaw))) < 0.005 ? d : false;
    })()`, '相机抵达清空的导航环');
    // 从这里去教学楼先走门口，其余目标先沿导航环；不能直接指向建筑内站位。
    if (route.target === 'classroom') assert(pointDistance(route.guide.next, [13.5, 0]) < 0.02, '手动箭头未指向教学楼门口');
    else assert(Math.abs(Math.hypot(...route.guide.next) - 11) < 0.02, '手动箭头没有沿导航环航点');
    const targetYaw = Math.atan2(11 - route.guide.next[0], -route.guide.next[1]);
    for (const [name, bearing, text] of [
      ['front', 0, '沿箭头向前走'], ['right', Math.PI / 2, '向右转，沿路走'],
      ['left', -Math.PI / 2, '向左转，沿路走'], ['behind', Math.PI, '向后转，沿路走']
    ]) {
      const yaw = targetYaw + bearing;
      await cdp.eval(`FZ.World.place(11, 0, ${yaw})`);
      const s = await cdp.wait(`(() => {
        const s = ${GUIDE_STATE}, d = s.debug, g = d.guide;
        const delta = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));
        return g && Math.abs(delta(d.cameraYaw, ${yaw})) < 0.005 &&
          Math.abs(delta(g.bearing, ${bearing})) < 0.015 ? s : false;
      })()`, '罗盘与低帧率相机稳定 ' + name, 45000);
      checkGuide(s, name, true);
      assert.equal(s.text, text, name + ': 方位文字错误');
      assert(pointDistance(s.debug.pos, [11, 0]) < 0.02, name + ': 原地转向移动了玩家');
      assert(pointDistance(s.debug.guide.next, route.guide.next) < 0.02, name + ': 转向改变了路线航点');
      if (name === 'front') await cdp.shot('w02-arrows');
    }
    // 教学楼与东侧环点近乎共线，改用西侧环点，确保这里确实经过环路而非直达。
    const ringX = route.target === 'classroom' ? -11 : 11;
    await cdp.eval(`FZ.World.place(${ringX}, 0, 0)`);
    const ring = await cdp.wait(`(() => {
      const s = ${GUIDE_STATE}, d = s.debug;
      return d.guide && d.guide.visible && Math.hypot(d.pos[0] - ${ringX}, d.pos[1]) < 0.02 && Math.abs(Math.atan2(Math.sin(d.cameraYaw), Math.cos(d.cameraYaw))) < 0.005 ?
        { guide: s, stand: FZ.World.standOf(d.target) } : false;
    })()`, '环路剩余距离稳定', 45000);
    checkGuide(ring.guide, '环路折线距离', true);
    const rd = ring.guide.debug, euclidean = pointDistance(rd.pos, ring.stand);
    assert(Math.abs(Math.hypot(...rd.guide.next) - 11) < 0.02, '距离样本没有沿导航环');
    assert(rd.guide.distance > euclidean + 0.5, '剩余距离仍是直线距离，而非经导航环的折线距离');
    assert(rd.guide.distance + 0.05 >= pointDistance(rd.pos, rd.guide.next) + pointDistance(rd.guide.next, ring.stand),
      '剩余距离小于已知路线航段的下界');
    await cdp.eval('FZ.World.place(11, 0, 0)');
    await compactNavigation(cdp);
    assert.equal(await cdp.eval('FZ.World.nearestNpc()'), null, '模态测试位置不应触发相识存档');
    try {
      await cdp.click('#btn-campus');
      await cdp.wait(`document.getElementById('campus-dialog').open && FZ.World.debug().interactionLocked`, 'NPC 模态锁');
      await hiddenGuide(cdp, 'NPC 模态内隐藏箭头');
      await hiddenMap(cdp, '现有模态打开时');
    } finally {
      if (await cdp.eval(`document.getElementById('campus-dialog').open`)) await cdp.click('#btn-campus-close');
      await cdp.wait(`!document.getElementById('campus-dialog').open && !FZ.World.debug().interactionLocked`, 'NPC 模态解锁');
    }
    await checkMinimap(cdp, '关闭模态恢复漫游');
    const resumed = await cdp.wait(`(() => {
      const s = ${GUIDE_STATE};
      return s.debug.guide.visible && s.needle && s.needle.visible && s.compass && s.compass.visible &&
        s.label && s.label.visible && s.painted ? s : false;
    })()`, '关闭模态恢复箭头');
    checkGuide(resumed, '关闭模态', true);
  } finally {
    // 仅使用 public place 恢复姿态；不改存档、不重设事件、不替换任何 arrival 回调。
    await cdp.eval(`FZ.World.place(${saved.debug.pos[0]}, ${saved.debug.pos[1]}, ${saved.debug.cameraYaw})`);
    await cdp.wait(`(() => {
      const d = FZ.World.debug();
      return Math.hypot(d.cam[0] - ${saved.debug.pos[0]}, d.cam[2] - ${saved.debug.pos[1]}) < 0.08 &&
        Math.abs(Math.atan2(Math.sin(d.cameraYaw - ${saved.debug.cameraYaw}), Math.cos(d.cameraYaw - ${saved.debug.cameraYaw}))) < 0.005;
    })()`, '恢复方向测试前的位置与相机', 45000);
    await cdp.eval(`(() => {
      const focus = document.getElementById(${JSON.stringify(saved.focus)});
      if (focus) focus.focus({ preventScroll: true });
      window.scrollTo({ left: ${saved.scroll[0]}, top: ${saved.scroll[1]}, behavior: 'instant' });
    })()`);
    const restored = await cdp.eval(`({ debug: FZ.World.debug(), run: localStorage.getItem('fz.run.v1'), state: ${WORLD_STATE} })`);
    assert.equal(restored.run, saved.run, '方向/模态测试改变了原始游戏存档');
    for (const key of ['phase', 'target', 'auto', 'arrived', 'npcTarget', 'interactionLocked']) {
      assert.equal(restored.debug[key], saved.debug[key], '方向测试未保留世界状态 ' + key);
    }
    assert(pointDistance(restored.debug.pos, saved.debug.pos) <= 0.02, '方向测试未恢复玩家位置');
    for (const key of ['worldOn', 'screen', 'choices', 'typed', 'typing']) {
      assert.equal(restored.state[key], saved.state[key], '方向测试改变了叙事/UI ' + key);
    }
  }
  console.log('  手动地面箭头、SVG 尺寸、前/右/左/后方向、NPC 模态隐藏通过');
}

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
    await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: WIDTH < 700, maxTouchPoints: 2 });
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
      const viewportWidth = await cdp.eval('document.documentElement.clientWidth');
      if (Math.abs(fr.cssW - viewportWidth) > 4) note(`画布 CSS 宽度 ${fr.cssW} 与可用视口 ${viewportWidth} 不符`);
      if (fr.lit < 0.15) note(`画面几乎全黑 lit=${fr.lit}`);
      if (fr.hues < 40) note(`画面色彩过少 hues=${fr.hues}，可能没渲染场景`);
    }
    await hiddenGuide(cdp, '标题页隐藏箭头');
    await hiddenMap(cdp, '标题页');
    await cdp.shot('w01-title');
    // 在标题页测试真实 2D 开关，不在漫游中触发补播叙事而破坏后续手动/到达测试。
    await cdp.click('#btn-3d');
    await cdp.wait(`!document.body.classList.contains('world-on') && document.body.dataset.wphase === 'off'`, '标题切至平面');
    await hiddenMap(cdp, '平面模式');
    await cdp.click('#btn-3d');
    await cdp.wait(`document.body.classList.contains('world-on') && document.body.dataset.wphase === 'title'`, '标题恢复三维');
    await hiddenMap(cdp, '恢复三维标题');

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
    await manualGuide(cdp);

    const lookPoint = await cdp.eval(`(() => {
      const canvas = document.querySelector('#world canvas');
      for (const fy of [0.3, 0.4, 0.5]) for (const fx of [0.6, 0.5, 0.7]) {
        const x = Math.round(innerWidth * fx), y = Math.round(innerHeight * fy);
        if (document.elementFromPoint(x, y) === canvas) return { x, y };
      }
      return null;
    })()`);
    if (!lookPoint) note('校园画面被界面层遮挡，无法拖动视角');
    else {
      const yawBefore = await cdp.eval('FZ.World.debug().yaw');
      const { x, y } = lookPoint;
      if (WIDTH < 700) {
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + 60, y }] });
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      } else {
        await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
        await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x + 60, y, button: 'left', buttons: 1 });
        await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: x + 60, y, button: 'left', clickCount: 1 });
      }
      await sleep(1000);
      const yawAfter = await cdp.eval('FZ.World.debug().yaw');
      if (Math.abs(yawAfter - yawBefore) < 0.05) note('拖动校园画面后视角没有变化');
      console.log('  视角拖动:', WIDTH < 700 ? '触屏' : '鼠标', yawBefore, '→', yawAfter);
    }
    const goClickable = await cdp.eval(`(() => {
      const b = document.getElementById('btn-go'), r = b.getBoundingClientRect();
      return b.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2));
    })()`);
    if (!goClickable) note('直接前往按钮无法接收指针输入');

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
    const autoStart = await armArrival(cdp);
    await cdp.click('#btn-go');
    const travelling = await cdp.wait(`(() => {
      const s = ${GUIDE_STATE}, d = s.debug;
      // guide 每 0.1s 更新；避开距航点 0.35m 的过滤区及自动路线的换点瞬间。
      return d.auto && d.next && d.path > 0 && d.guide && Array.isArray(d.guide.next) &&
        Math.hypot(d.pos[0] - ${autoStart.pos[0]}, d.pos[1] - ${autoStart.pos[1]}) > 0.1 &&
        Math.hypot(d.pos[0] - d.next[0], d.pos[1] - d.next[1]) > 1 &&
        Math.hypot(d.guide.next[0] - d.next[0], d.guide.next[1] - d.next[1]) <= 0.02 ? s : false;
    })()`, '自动前往时实际移动且仍有路线');
    checkGuide(travelling, '自动前往');
    assert.equal(travelling.debug.target, autoStart.target, '自动前往改变了剧情目的地');
    assert(pointDistance(travelling.debug.guide.next, travelling.debug.next) <= 0.02,
      '地面箭头没有使用自动路线的下一航点');
    console.log('  自动路线箭头:', JSON.stringify(travelling.debug.guide));
    const arrival = await cdp.wait(`(() => {
      if (document.body.dataset.wphase !== 'event') return false;
      return { debug: FZ.World.debug(), capture: window.__worldtestArrival };
    })()`, '走到目标进入 event', 90000);
    const notice = arrival.capture && arrival.capture.firstEvent;
    assert(arrival.debug.arrived && notice, '没有捕获到剧情到达同一轮 DOM 更新');
    assert.equal(notice.target, autoStart.target, '到达提示不是原剧情地点');
    assert.equal(notice.text, arrival.capture.expected, '到达时没有立刻宣布地点及开始本时段事件');
    assert.equal(notice.role, 'status', '到达提示缺少 status 语义');
    assert(notice.global && notice.on, '到达提示未在全局状态区立即启用');
    await cdp.wait(`(() => {
      const el = document.getElementById('nav-arrival');
      return el.classList.contains('on') && el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true });
    })()`, '到达提示完成淡入并实际可见', 2000);
    await cdp.eval('delete window.__worldtestArrival');
    console.log('  即时到达提示:', notice.text);
    await hiddenGuide(cdp, '到达事件后隐藏箭头');
    await hiddenMap(cdp, '到达事件');
    if (NAVIGATION_ONLY) {
      checkConsole(cdp);
      return; // finally 仍清理 Chrome；退出码与完整模式共用末尾汇总。
    }
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
        await checkMinimap(cdp, '下一时段恢复漫游');
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
    await hiddenGuide(cdp, '考试阶段隐藏箭头');
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
    await hiddenGuide(cdp, '结算阶段隐藏箭头');
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
    await hiddenGuide(cdp, '平面模式隐藏箭头', true);
    await hiddenMap(cdp, '结算切至平面');
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
      const beforeStop = await cdp.wait(`(() => {
        const s = ${GUIDE_STATE};
        return s.debug.guide && s.debug.guide.visible && s.debug.guide.count > 0 &&
          s.needle && s.needle.visible && s.compass && s.compass.visible && s.label && s.label.visible && s.painted ? s : false;
      })()`, '切换平面前箭头及界面完成显示');
      checkGuide(beforeStop, '切换平面前');
      await checkMinimap(cdp, '再来一局恢复漫游');
      await cdp.click('#btn-3d');
      await cdp.wait(`!document.body.classList.contains('world-on') && document.body.dataset.wphase === 'off'`, '手动漫游切至平面');
      await hiddenGuide(cdp, 'World.stop 隐藏原有活动箭头', true);
      await hiddenMap(cdp, '漫游切至平面');
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
      const viewportWidth = await cdp.eval('document.documentElement.clientWidth');
      if (Math.abs(f.cssW - viewportWidth) > 4) note(`resize 后画布宽度 ${f.cssW} ≠ ${viewportWidth}`);
      if (ov > 1) note(`resize ${w} 横向溢出 ${ov}`);
    }

    // 重开
    await cdp.eval(`document.getElementById('btn-restart').click()`);
    await sleep(1200);
    console.log('  重开:', await cdp.eval(`document.querySelector('.screen.active').id + ' / ' + document.body.dataset.wphase`));
    await cdp.shot('w10-restart');
    await hiddenMap(cdp, '重开标题');

    checkConsole(cdp);
  } catch (error) {
    if (cdp) {
      try { console.log('  失败现场:', JSON.stringify(await cdp.eval(GUIDE_STATE))); } catch (_) {}
      try { await cdp.shot('w-failure'); } catch (_) {}
    }
    throw error;
  } finally {
    if (cdp) try { cdp.ws.close(); } catch (e) {}
    chrome.kill();
    await sleep(400);
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) {}
  }
}
main().then(() => {
  console.log(problems.length ? `\n${problems.length} 个问题` : NAVIGATION_ONLY ? '\n三维导航专项通过' : '\n三维全部通过');
  process.exit(problems.length ? 1 : 0);
}).catch((e) => { console.error(e); process.exit(2); });