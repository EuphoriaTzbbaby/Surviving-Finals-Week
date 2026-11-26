#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const net = require('node:net');

const NODE = 'C:/Users/cdwswb/.workbuddy/binaries/node/versions/22.22.2-6/node.exe';
const URL_BASE = process.env.FZ_URL || 'http://127.0.0.1:8765/index.html';
const RUN_KEY = 'fz.run.v1';
const SCENES = ['library', 'classroom', 'canteen', 'print', 'campus', 'dorm', 'court', 'garden', 'cafe'];
const NEW_SCENE_NAMES = { court: '篮球场', garden: '静心花园', cafe: '咖啡角' };
const NEW_NPC_PLACES = {
  baller: ['court', 'court', 'court'], gardener: ['garden', 'garden', 'garden'],
  photographer: ['garden', 'court', 'garden'], barista: ['cafe', 'cafe', 'cafe']
};
const TYPED_WORDS = {
  roommate: '计划', senior: '方法', librarian: '座位', tutor: '考试',
  cook: '早餐', printer: '打印', guard: '路线', runner: '运动',
  baller: '练球', gardener: '植物', photographer: '光线', barista: '香气'
};
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const literal = JSON.stringify;
const normalize = (s) => String(s).replace(/\r\n/g, '\n').trim();
let interrupted = null;

function options() {
  const out = { port: 9555, width: 1100, height: 800, flat: false, shots: '' };
  for (let i = 2; i < process.argv.length; i++) {
    const flag = process.argv[i];
    if (flag === '--flat') { out.flat = true; continue; }
    assert(['--port', '--width', '--height', '--shots'].includes(flag), '未知参数: ' + flag);
    const value = process.argv[++i];
    assert(value && !value.startsWith('--'), flag + ' 缺少值');
    const key = flag.slice(2);
    out[key] = key === 'shots' ? path.resolve(value) : Number(value);
  }
  for (const key of ['port', 'width', 'height']) {
    assert(Number.isInteger(out[key]) && out[key] > 0, key + ' 必须是正整数');
  }
  assert(out.port <= 65535, '端口超出范围');
  return out;
}

class CDP {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.errors = [];
    ws.onmessage = ({ data }) => {
      const msg = JSON.parse(data);
      if (msg.id && this.pending.has(msg.id)) {
        const p = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        clearTimeout(p.timer);
        if (msg.error) p.reject(new Error(JSON.stringify(msg.error)));
        else p.resolve(msg.result);
      } else if (msg.method === 'Runtime.exceptionThrown' ||
        (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') ||
        (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error')) {
        this.errors.push(msg.method + ': ' + JSON.stringify(msg.params).slice(0, 1400));
      } else if (msg.method === 'Page.javascriptDialogOpening') {
        this.errors.push('意外的 JavaScript 对话框: ' + msg.params.message);
        this.send('Page.handleJavaScriptDialog', { accept: false }).catch(() => {});
      }
    };
    ws.onclose = () => this.rejectPending(new Error('CDP 连接已关闭'));
    ws.onerror = () => this.rejectPending(new Error('CDP WebSocket 错误'));
  }
  static async connect(url) {
    const ws = new WebSocket(url);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => { ws.close(); reject(new Error('CDP 连接超时')); }, 15000);
      ws.onopen = () => { clearTimeout(timer); resolve(); };
      ws.onerror = () => { clearTimeout(timer); reject(new Error('CDP 连接失败')); };
    });
    return new CDP(ws);
  }
  rejectPending(error) {
    for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(error); }
    this.pending.clear();
  }
  send(method, params = {}, timeout = 40000) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error('CDP 超时: ' + method));
      }, timeout);
      this.pending.set(id, { resolve, reject, timer });
      try { this.ws.send(JSON.stringify({ id, method, params })); }
      catch (error) { clearTimeout(timer); this.pending.delete(id); reject(error); }
    });
  }
  async eval(expression) {
    if (interrupted) throw interrupted;
    // 所有页面求值均带 userGesture，避免测试点击被 AAC/AudioContext autoplay 策略误拒。
    const result = await this.send('Runtime.evaluate', {
      expression, returnByValue: true, awaitPromise: true, userGesture: true
    });
    if (result.exceptionDetails) throw new Error('页面求值异常: ' + JSON.stringify(result.exceptionDetails));
    return result.result.value;
  }
  async wait(expression, label, timeout = 30000) {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      if (await this.eval(expression)) return;
      await pause(150);
    }
    throw new Error('等待超时: ' + label);
  }
  async point(selector, index = 0) {
    return this.eval(`(async () => {
      const el = document.querySelectorAll(${literal(selector)})[${index}];
      if (!el) throw new Error('找不到按钮: ' + ${literal(selector)});
      if (el.disabled) throw new Error('按钮 disabled: ' + ${literal(selector)});
      await Promise.all(el.getAnimations().filter(a => Number.isFinite(a.effect.getComputedTiming().endTime)).map(a => a.finished.catch(() => {})));
      el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
      const rect = el.getBoundingClientRect(), style = getComputedStyle(el);
      const x = rect.left + rect.width / 2, y = rect.top + rect.height / 2;
      if (!rect.width || !rect.height || style.visibility !== 'visible' || Number(style.opacity) === 0 ||
          x < 0 || x >= document.documentElement.clientWidth || y < 0 || y >= innerHeight ||
          !el.contains(document.elementFromPoint(x, y))) {
        throw new Error('按钮不可见、不能滚动到或被遮挡: ' + ${literal(selector)});
      }
      return { x, y };
    })()`);
  }
  async click(selector, index = 0) {
    const { x, y } = await this.point(selector, index);
    await this.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
    await this.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 });
    await this.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 });
  }
  async key(key, hold = 80) {
    const code = key === ' ' ? 'Space' : ['Escape', 'Enter'].includes(key) ? key : /\d/.test(key) ? 'Digit' + key : 'Key' + key.toUpperCase();
    const vk = key === ' ' ? 32 : key === 'Escape' ? 27 : key === 'Enter' ? 13 : key.toUpperCase().charCodeAt(0);
    const params = { key, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk };
    await this.send('Input.dispatchKeyEvent', { type: key === 'Enter' ? 'keyDown' : 'rawKeyDown', ...params,
      ...(key === 'Enter' ? { text: '\r' } : {}) });
    try { await pause(hold); }
    finally { await this.send('Input.dispatchKeyEvent', { type: 'keyUp', ...params }); }
  }
  async shot(directory, name) {
    if (!directory) return;
    const { data } = await this.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(directory, name + '.png'), Buffer.from(data, 'base64'));
  }
  close() {
    this.rejectPending(new Error('测试结束'));
    this.ws.close();
  }
}

const READ_SAVE = `JSON.parse(localStorage.getItem(${literal(RUN_KEY)}))`;
const DIALOG_OPEN = `document.querySelector('#campus-dialog').open`;
const SNAPSHOT = `(() => ({
  save: ${READ_SAVE}, debug: FZ.World.debug(), open: ${DIALOG_OPEN},
  phase: document.body.dataset.wphase,
  topics: document.querySelectorAll('#npc-topics button').length,
  name: document.querySelector('#npc-name').textContent,
  transitions: window.__campusTest.phases.slice(),
  map: {
    label: document.querySelector('#minimap').getAttribute('aria-label'),
    expanded: document.querySelector('#btn-map').getAttribute('aria-expanded')
  },
  ui: {
    gauges: [...document.querySelectorAll('.gauge .g-val')].map(e => e.textContent),
    courses: document.querySelector('#course-switch').textContent,
    active: [...document.querySelectorAll('#course-switch button')].map(e => [e.className, e.getAttribute('aria-pressed')]),
    next: document.querySelector('#btn-next').classList.contains('on')
  }
}))()`;

function projection(save) {
  assert(save && typeof save === 'object', '没有正常游戏存档');
  for (const key of ['day', 'slot', 'tick', 'decisions', 'courses', 'stats', 'active', 'currentEvent', 'phase']) {
    assert(Object.hasOwn(save, key), '存档缺少字段: ' + key);
  }
  // 严格保留全部字段，不仅比较几项数值；唯一允许改变的是相识列表。
  const { npcMet, ...progress } = save;
  return progress;
}
function unchanged(before, after, label) {
  assert.deepStrictEqual(projection(after), projection(before), label + ': 聊天/导航改变了游戏进度');
}
function metList(save, ids, all = false) {
  assert(Array.isArray(save.npcMet), 'npcMet 必须是数组');
  assert.equal(new Set(save.npcMet).size, save.npcMet.length, 'npcMet 有重复人物');
  assert(save.npcMet.every(id => ids.includes(id)), 'npcMet 有未知人物');
  if (all) assert.deepStrictEqual([...save.npcMet].sort(), [...ids].sort(), `未相识全部 ${ids.length} 人`);
}
function distance(a, b) {
  assert(Array.isArray(a) && Array.isArray(b) && a.length === b.length, 'debug 坐标格式不正确');
  assert([...a, ...b].every(Number.isFinite), 'debug 坐标不是有限数字');
  return Math.hypot(...a.map((n, i) => n - b[i]));
}
function npcSelector(id) { return '#npc-roster button[data-npc="' + id + '"]'; }
function replyKey(reply) { return reply.npc + '/' + reply.topic + '/' + reply.slot; }
function navigationTarget(snapshot, data, scene, label) {
  assert.equal(snapshot.debug.guide.visible, true, label + ': 没有显示方向指引');
  assert.equal(snapshot.debug.guide.target, scene, label + ': guide.target 不是当前目的地');
  assert.equal(snapshot.map.expanded, 'true', label + ': 地图未展开，不能验证实时目标');
  assert(typeof snapshot.map.label === 'string' &&
    snapshot.map.label.endsWith('金色路线通往' + data.locations[scene]),
    label + ': 地图 aria-label 未指向当前目的地: ' + snapshot.map.label);
  if (snapshot.debug.path > 1) assert(snapshot.debug.guide.count > 0, label + ': 路线上没有地面箭头');
}

async function ready(cdp, opt) {
  // 不以 window.FZ 单独作为 ready 条件：boot 的 rAF 建图和 veil 退场均须完成。
  await cdp.wait(`document.readyState === 'complete' && !!window.FZ && !!FZ.World &&
    !!document.querySelector('#world-veil') && !document.querySelector('#world-veil').classList.contains('on') &&
    !document.querySelector('#world-veil').classList.contains('off')`, '脚本与加载遮罩退场', 60000);
  await cdp.eval(`(() => {
    for (const name of ['npcStatus', 'nearestNpc', 'goToNPC', 'setInteractionLocked', 'debug', 'beginSlot', 'setQuality', 'goTo', 'locName', 'standOf']) {
      if (typeof FZ.World[name] !== 'function') throw new Error('缺少约定 API: FZ.World.' + name);
    }
    if (!FZ.World.isOk()) throw new Error('WebGL 初始化失败，不能冒充 --flat 通过');
    FZ.World.setQuality('low');
    const select = document.querySelector('#quality-select');
    select.value = 'low'; select.dispatchEvent(new Event('change', { bubbles: true }));
    const debug = FZ.World.debug();
    for (const key of ['pos', 'yaw', 'cam', 'target', 'npcTarget', 'interactionLocked', 'guide', 'auto', 'path', 'arrived',
      'renderPixelRatio', 'grain', 'aberration', 'bloom', 'dayNight', 'sunVisible', 'moonVisible']) {
      if (!Object.hasOwn(debug, key)) throw new Error('debug 缺少约定字段: ' + key);
    }
    const dialog = document.querySelector('#campus-dialog');
    if (!(dialog instanceof HTMLDialogElement)) throw new Error('campus-dialog 不是原生 dialog');
    window.__campusTest = { keys: [], phases: [] };
    document.addEventListener('keydown', e => window.__campusTest.keys.push({ key: e.key, trusted: e.isTrusted }), true);
    new MutationObserver(records => {
      const changes = records.filter(r => r.attributeName === 'data-wphase');
      changes.forEach((r, i) => window.__campusTest.phases.push(
        i + 1 < changes.length ? changes[i + 1].oldValue : document.body.dataset.wphase));
    }).observe(document.body, { attributes: true, attributeOldValue: true, attributeFilter: ['data-wphase'] });
  })()`);
  if (await cdp.eval(`document.body.classList.contains('world-on')`) === opt.flat) await cdp.click('#btn-3d');
  assert.equal(await cdp.eval(`document.body.classList.contains('world-on')`), !opt.flat, '模式切换失败');
  assert.equal(await cdp.eval('FZ.World.quality()'), 'low', '交互测试必须使用 low');
}

async function layout(cdp) {
  const report = await cdp.eval(`(() => {
    const root = document.documentElement, dialog = document.querySelector('#campus-dialog');
    const bad = [];
    if (root.scrollWidth > root.clientWidth + 1) bad.push('document 横向溢出');
    if (dialog.open) {
      const rect = dialog.getBoundingClientRect();
      if (rect.left < -1 || rect.right > root.clientWidth + 1 || rect.top < -1 || rect.bottom > innerHeight + 1) bad.push('dialog 超出可用视口');
      if (dialog.scrollHeight > dialog.clientHeight + 1 && !['auto', 'scroll'].includes(getComputedStyle(dialog).overflowY)) {
        bad.push('dialog 内容超高但不能纵向滚动');
      }
      for (const el of [dialog, ...dialog.querySelectorAll('*')]) {
        const cs = getComputedStyle(el);
        // 无障碍用的视觉隐藏元素（1px + overflow:hidden + clip-path）一定 scrollWidth > clientWidth，不算溢出。
        const srOnly = el.clientWidth <= 1 && el.clientHeight <= 1 && cs.overflow === 'hidden';
        if (srOnly) continue;
        if (el.clientWidth && el.scrollWidth > el.clientWidth + 1) {
          bad.push((el.id || el.className || el.tagName) + ' 内部横向溢出 ' + el.clientWidth + '→' + el.scrollWidth);
        }
      }
      if (!dialog.matches(':modal')) bad.push('dialog 未使用 showModal');
    }
    return { bad, width: root.clientWidth, scrollWidth: root.scrollWidth };
  })()`);
  assert.deepStrictEqual(report.bad, [], '布局: ' + JSON.stringify(report));
}

async function rosterLayout(cdp, data) {
  const before = await cdp.eval(READ_SAVE);
  const roster = await cdp.eval(`Array.from(document.querySelectorAll('#npc-roster button[data-npc]'), b => b.dataset.npc)`);
  assert.deepStrictEqual(roster.slice().sort(), data.npcs.map(n => n.id).sort(), `roster 不是全部 ${data.npcs.length} 人`);
  await cdp.point('#btn-campus-close');
  const top = await cdp.eval(`document.querySelector('#campus-dialog').scrollTop`);
  // point 会实际 scrollIntoView 并命中测试；手机上新增的末行人物也必须能滚动到，不能只查 DOM 数量。
  for (const id of roster) await cdp.point(npcSelector(id));
  await cdp.point('#campus-met-summary');
  const bottom = await cdp.eval(`(() => {
    const dialog = document.querySelector('#campus-dialog');
    return { top: dialog.scrollTop, height: dialog.clientHeight, content: dialog.scrollHeight };
  })()`);
  if (bottom.content > bottom.height + 1) {
    assert(bottom.top > top + 1, `容纳 ${data.npcs.length} 人的 dialog 没有实际滚动到底部`);
  }
  await layout(cdp);
  await cdp.point('#btn-campus-close');
  assert.deepStrictEqual(await cdp.eval(READ_SAVE), before, '浏览完整 roster/滚动改变了存档');
}

async function openCampus(cdp, method = 'button') {
  if (method === 'button') await cdp.click('#btn-campus');
  else await cdp.key(method);
  await cdp.wait(DIALOG_OPEN, '打开校园人物');
  await layout(cdp);
}
async function closeCampus(cdp, escape = false) {
  if (escape) await cdp.key('Escape');
  else await cdp.click('#btn-campus-close');
  await cdp.wait(`!${DIALOG_OPEN} && FZ.World.debug().interactionLocked === false`, '关闭且释放世界交互锁');
}

async function lockedKeys(cdp, opt) {
  await cdp.eval(`(() => {
    window.__campusTest.keys = [];
    document.querySelector('#npc-roster button[aria-pressed="true"]').focus();
  })()`);
  const before = await cdp.eval(SNAPSHOT);
  if (!opt.flat) assert.equal(before.debug.interactionLocked, true, 'dialog 打开未锁定交互');
  for (const key of ['w', 'q', 'e', '1', '2', '3', ' ']) await cdp.key(key, key === 'w' ? 900 : 90);
  const after = await cdp.eval(SNAPSHOT);
  unchanged(before.save, after.save, '原游戏 W/Q/E/123/Space 键被模态窗口隔离');
  assert.deepStrictEqual(after.ui, before.ui, '模态窗口内按键改变了课程/统计/继续按钮');
  assert(distance(before.debug.pos, after.debug.pos) <= 0.02, '模态窗口中 W 键使玩家移动');
  assert.equal(after.debug.target, before.debug.target, '模态窗口中剧情 target 改变');
  assert.equal(after.debug.npcTarget, before.debug.npcTarget, '模态窗口中启动了 NPC 导航');
  assert.equal(after.phase, before.phase, '模态窗口中触发剧情到达/阶段切换');
  assert(after.open, '模态窗口被原游戏快捷键关闭');
  const keys = await cdp.eval('window.__campusTest.keys');
  for (const key of ['w', 'q', 'e', '1', '2', '3', ' ']) {
    assert(keys.some(e => e.key === key && e.trusted), '没有真实 trusted 按键: ' + key);
  }
  await closeCampus(cdp, true);
  await layout(cdp);
}

async function collectData(cdp) {
  const data = await cdp.eval(`({ npcs: FZ.NPCS, slots: FZ.SLOTS,
    locations: Object.fromEntries(${literal(SCENES)}.map(k => [k, FZ.World.locName(k)])) })`);
  // 入口使用固定验收数，后续遍历和诊断随实际 data 生成，不能用动态计数掩盖丢人/丢回复。
  assert(Array.isArray(data.npcs), 'FZ.NPCS 必须是数组');
  assert.equal(data.npcs.length, 12, 'FZ.NPCS 必须恰好 12 人');
  assert.equal(new Set(data.npcs.map(n => n.id)).size, data.npcs.length, 'NPC id 不唯一');
  assert.deepStrictEqual(data.npcs.map(n => n.id).sort(), Object.keys(TYPED_WORDS).sort(), '原有/新增人物 id 丢失或被替换');
  assert(Array.isArray(data.slots), 'FZ.SLOTS 必须是数组');
  assert.equal(data.slots.length, 3, 'FZ.SLOTS 必须有 3 时段');
  for (const [scene, name] of Object.entries(NEW_SCENE_NAMES)) {
    assert.equal(data.locations[scene], name, scene + ' 场景名称错误或回落到旧场景');
  }
  for (const [id, places] of Object.entries(NEW_NPC_PLACES)) {
    assert.deepStrictEqual(data.npcs.find(n => n.id === id).places, places, id + ' 三时段地点不符');
  }
  data.replies = [];
  for (const npc of data.npcs) {
    assert(typeof npc.id === 'string' && /^[\w-]+$/.test(npc.id), 'NPC id 格式错误');
    assert(typeof npc.name === 'string' && npc.name.trim(), npc.id + ' 缺少名字');
    assert(Array.isArray(npc.places) && npc.places.length === data.slots.length && npc.places.every(s => SCENES.includes(s)), npc.id + ' places 错误');
    assert(Array.isArray(npc.greeting) && npc.greeting.length === data.slots.length && npc.greeting.every(s => typeof s === 'string' && s.trim()), npc.id + ' greeting 错误');
    assert(Array.isArray(npc.topics) && npc.topics.length === 3, npc.id + ' topics 不是 3 个');
    assert.equal(new Set(npc.topics.map(t => t.id)).size, 3, npc.id + ' topic id 重复');
    for (const topic of npc.topics) {
      assert(typeof topic.label === 'string' && topic.label.trim(), 'topic label 为空');
      assert(Array.isArray(topic.replies) && topic.replies.length === data.slots.length,
        npc.id + '/' + topic.id + ` replies 不是 ${data.slots.length} 个`);
      topic.replies.forEach((raw, slot) => {
        assert(typeof raw === 'string' && raw.trim(), npc.id + '/' + topic.id + '/' + slot + ' 回复为空');
        data.replies.push({ npc: npc.id, topic: topic.id, slot, raw });
      });
    }
  }
  assert.equal(data.replies.length, 108, '必须恰好收集到 108 条 slot 回复');
  return data;
}
async function makeOracle(cdp, data, save) {
  const profile = await cdp.eval(`FZ.profile(${literal(save.courses[save.active].name)}, ${literal(save.major)})`);
  const replacements = { 科目: save.subject, 专业: save.major, 副科1: save.courses[1].name,
    副科2: save.courses[2].name, 速记: profile.drill, 核心: profile.core, 必背: profile.memo,
    作业: profile.work, 难点: profile.hard, 刷题App: profile.app, 背: profile.verb };
  const fill = (text) => normalize(text.replace(/\{([^{}]+)\}/g, (_, token) => {
    assert(typeof replacements[token] === 'string' && replacements[token].trim(), '未知/空占位替换: ' + token);
    return replacements[token];
  }));
  let substitutions = 0;
  for (const reply of data.replies) {
    reply.expected = fill(reply.raw);
    if (reply.raw !== reply.expected) substitutions++;
    assert(!/[{}]|undefined|\[object Object\]/.test(reply.expected), '回复仍有占位内容');
  }
  for (const npc of data.npcs) npc.greeting.forEach(fill);
  assert(substitutions > 0, '没有实际覆盖占位替换的回复');
  data.fill = fill;
  data.substitutions = substitutions;
}

async function statusCheck(cdp, data, slot) {
  const { statuses, nearest } = await cdp.eval('({ statuses: FZ.World.npcStatus(), nearest: FZ.World.nearestNpc() })');
  assert(Array.isArray(statuses) && statuses.length === data.npcs.length, `npcStatus 数量不是 ${data.npcs.length}`);
  assert.equal(new Set(statuses.map(s => s.id)).size, data.npcs.length, 'npcStatus id 重复');
  for (const npc of data.npcs) {
    const s = statuses.find(s => s.id === npc.id);
    assert(s, 'npcStatus 缺少 ' + npc.id);
    assert.equal(s.scene, npc.places[slot], npc.id + ' 未按 slot 更新位置');
    assert(Number.isFinite(s.distance) && s.distance >= 0, npc.id + ' distance 无效');
    assert.equal(typeof s.nearby, 'boolean', npc.id + ' nearby 无效');
  }
  const near = statuses.filter(s => s.nearby).sort((a, b) => a.distance - b.distance);
  if (near.length) {
    const selected = near.find(s => s.id === nearest);
    assert(selected && Math.abs(selected.distance - near[0].distance) < 0.001, 'nearestNpc 不是最近的附近人物');
  } else assert.equal(nearest, null, '没有附近人物但 nearestNpc 非 null');
  return statuses;
}

async function visit(cdp, opt, data, npc, slot, walkedScenes) {
  const before = await cdp.eval(SNAPSHOT);
  await openCampus(cdp);
  await cdp.click(npcSelector(npc.id));
  const selected = await cdp.eval(`({ name: document.querySelector('#npc-name').textContent,
    location: document.querySelector('#npc-location').textContent, topics: document.querySelectorAll('#npc-topics button').length })`);
  assert.equal(selected.name.trim(), npc.name, 'roster 没有选择正确人物');
  assert(selected.location.includes(data.locations[npc.places[slot]]) && selected.location.includes(data.slots[slot].full), 'NPC 地点/时段标签错误');
  const focused = await cdp.eval(`(() => { const a = document.activeElement;
    return { id: a.id || a.dataset.npc || a.tagName, visible: !!(a.getClientRects && a.getClientRects().length) }; })()`);
  assert(focused.visible, 'roster 选择后焦点落在隐藏元素: ' + focused.id);
  if (opt.flat) {
    // 平面模式允许先选人物再点「聊聊」，但绝不允许创建导航或消耗时段。
    if (selected.topics === 0) await cdp.click('#btn-npc-visit');
    await cdp.wait(`${DIALOG_OPEN} && document.querySelectorAll('#npc-topics button').length === ${npc.topics.length}`, '平面模式直接聊天');
    const after = await cdp.eval(SNAPSHOT);
    unchanged(before.save, after.save, 'flat 直接聊天');
    assert.equal(after.phase, before.phase, 'flat 聊天改变了世界阶段');
    assert.equal(after.debug.npcTarget, before.debug.npcTarget, 'flat 聊天启动导航');
    assert(distance(before.debug.pos, after.debug.pos) <= 0.02, 'flat 聊天移动了玩家');
    return before;
  }
  const statuses = await statusCheck(cdp, data, slot);
  if (statuses.find(s => s.id === npc.id).nearby) {
    assert.equal(selected.topics, npc.topics.length, `附近人物没有直接显示 ${npc.topics.length} 个话题`);
    return before;
  }
  assert.equal(selected.topics, 0, '远处人物不应已可聊天');
  await cdp.eval('window.__campusTest.phases = []');
  // 必须走真实 visit UI；禁止 place、直接 goToNPC 或替换 onArrive 回调。
  await cdp.click('#btn-npc-visit');
  // 等首帧刷新 guide/地图，避免读到上一次导航的缓存；仍由真实 UI 启动步行。
  await cdp.eval(`new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true))))`);
  const deadline = Date.now() + 70000;
  let sawClosed = false, sawTarget = false, moved = false, reopened = false;
  while (Date.now() < deadline) {
    const now = await cdp.eval(SNAPSHOT);
    unchanged(before.save, now.save, 'NPC 导航途中');
    assert.equal(now.debug.target, before.debug.target, 'NPC 导航覆盖了原剧情 target');
    assert(!now.transitions.includes('event'), 'NPC 导航途中触发了剧情 arrive/event');
    if (!now.open) {
      sawClosed = true;
      assert.equal(now.debug.interactionLocked, false, '关闭 dialog 后仍锁住导航');
      assert.equal(now.debug.npcTarget, npc.id, 'NPC 导航正在拜访错误人物');
      assert.equal(now.debug.auto, true, 'NPC 拜访未沿自动路线步行');
      navigationTarget(now, data, npc.places[slot], '拜访 ' + npc.id);
      sawTarget = true;
    }
    if (distance(before.debug.pos, now.debug.pos) > 0.05) moved = true;
    if (sawClosed && now.open) {
      assert.equal(now.name.trim(), npc.name, '到达后自动打开了错误人物');
      assert.equal(now.topics, npc.topics.length, `到达重新打开 dialog 后没有 ${npc.topics.length} 个话题`);
      assert.equal(now.debug.interactionLocked, true, '到达 dialog 没有锁定世界');
      assert.equal(now.debug.guide.visible, false, '到达聊天后地面箭头仍在显示');
      reopened = true;
      break;
    }
    await pause(200);
  }
  assert(reopened, '70s 内未自动抵达并重新打开 dialog: ' + npc.id);
  assert(sawTarget && moved, '拜访没有真实设置 npcTarget / 步行位移: ' + npc.id);
  const arrived = await statusCheck(cdp, data, slot);
  assert(arrived.find(s => s.id === npc.id).nearby, '自动弹窗但人物仍不在附近');
  walkedScenes.add(npc.places[slot]);
  return before;
}

async function chat(cdp, data, npc, slot, seen) {
  const start = await cdp.eval(READ_SAVE);
  assert.equal(await cdp.eval(`document.querySelector('#npc-reply').textContent.trim()`), data.fill(npc.greeting[slot]), '问候/占位替换错误: ' + npc.id);
  const outputs = [];
  for (let i = 0; i < npc.topics.length; i++) {
    const before = await cdp.eval(READ_SAVE);
    await cdp.click('#npc-topics button', i);
    const output = await cdp.eval(`({ reply: document.querySelector('#npc-reply').textContent,
      question: document.querySelector('#npc-question').textContent,
      label: document.querySelectorAll('#npc-topics button')[${i}].textContent, save: ${READ_SAVE} })`);
    const topic = npc.topics[i];
    assert.equal(normalize(output.label), topic.label, 'topic 按钮文案错误');
    assert(output.question.includes(topic.label), 'npc-question 没有显示选中话题');
    const expected = data.replies.find(r => r.npc === npc.id && r.topic === topic.id && r.slot === slot);
    assert.equal(normalize(output.reply), expected.expected, '回复或占位替换错误: ' + npc.id + '/' + topic.id + '/' + slot);
    assert(!/[{}]|undefined|\[object Object\]/.test(output.reply), 'UI 回复残留占位符');
    outputs.push(normalize(output.reply));
    seen.add(replyKey(expected));
    unchanged(before, output.save, '单次 topic');
  }
  assert.equal(new Set(outputs).size, npc.topics.length, npc.id + ` 的 ${npc.topics.length} 个话题输出不各异`);
  await typedChat(cdp, data, npc, slot);
  const end = await cdp.eval(READ_SAVE);
  unchanged(start, end, '完整聊天');
  metList(end, data.npcs.map(n => n.id));
  assert(end.npcMet.includes(npc.id), '聊天未登记 npcMet: ' + npc.id);
  // 窄屏中输入框/发送按钮在长 roster 下方，滚动后仍须能命中，并能再回到关闭按钮。
  await cdp.point('#npc-chat-input');
  await cdp.point('#npc-chat-form button');
  await layout(cdp);
  await cdp.point('#btn-campus-close');
}

async function typedChat(cdp, data, npc, slot) {
  assert.equal(await cdp.eval(`document.querySelector('#npc-chat-form').hidden`), false, '附近人物没有文字聊天框');
  const start = await cdp.eval(SNAPSHOT);
  async function send(text, enter = true) {
    await cdp.click('#npc-chat-input');
    await cdp.eval(`document.querySelector('#npc-chat-input').value = ''`);
    await cdp.send('Input.insertText', { text });
    if (enter) await cdp.key('Enter');
    else await cdp.click('#npc-chat-form button');
    return cdp.eval(`({ question: document.querySelector('#npc-question').textContent,
      reply: document.querySelector('#npc-reply').textContent,
      value: document.querySelector('#npc-chat-input').value,
      focused: document.activeElement.id,
      injected: document.querySelector('#npc-question').children.length })`);
  }
  assert(typeof TYPED_WORDS[npc.id] === 'string', '缺少独立的文字聊天测试关键词: ' + npc.id);
  let output = await send(TYPED_WORDS[npc.id], slot !== 1);
  assert.equal(output.question, '你说：' + TYPED_WORDS[npc.id], '没有显示输入的文字');
  assert.equal(output.reply, data.fill(npc.topics[0].replies[slot]), '文字未命中人物当前时段话题: ' + npc.id);
  assert.equal(output.value, '', '发送后未清空输入框');
  assert.equal(output.focused, 'npc-chat-input', '发送后输入焦点丢失');
  if (npc.id === 'roommate' && slot === 0) {
    output = await send('我复习不下去了');
    assert.equal(output.reply, data.fill(npc.topics.find(t => t.id === 'support').replies[slot]), '较长关键词未优先匹配');
    output = await send('你好！');
    assert.equal(output.reply, data.fill(npc.greeting[slot]), '文字问候没有正确回复');
    output = await send('谢谢你');
    assert(output.reply.startsWith('不客气。'), '感谢没有回复');
    output = await send('xyz987654');
    assert(output.reply.includes('换个关键词'), '陌生消息没有说明离线范围');
    const unsafe = '<img src=x onerror=alert(1)>';
    output = await send(unsafe, false);
    assert.equal(output.question, '你说：' + unsafe, 'HTML 字符没有按原文呈现');
    assert.equal(output.injected, 0, '聊天输入被作为 HTML 插入');
    const prior = output;
    output = await send('   ');
    assert.equal(output.question, prior.question, '空白输入覆盖了对话');
    assert.equal(output.reply, prior.reply, '空白输入触发回复');
    output = await send('');
    assert.equal(output.reply, prior.reply, '空输入触发回复');
    output = await send('x'.repeat(200));
    assert.equal(output.question, '你说：' + 'x'.repeat(160), '文字长度上限没有生效');
    await layout(cdp);
    assert((await cdp.eval('window.__campusTest.keys')).some(k => k.key === 'Enter' && k.trusted), '回车发送未使用真实按键');
  }
  const after = await cdp.eval(SNAPSHOT);
  unchanged(start.save, after.save, '文字聊天与回车发送');
  assert.deepStrictEqual(after.ui, start.ui, '文字输入触发了游戏快捷键');
  assert.equal(after.phase, start.phase, '发送文字触发剧情阶段变化');
  assert(distance(after.debug.pos, start.debug.pos) <= 0.02, '输入文字移动了角色');
}

function itinerary(data, slot) {
  const route = [];
  // 首轮先离开出生宿舍，再逐一拜访全部场景（包括新增三处）；不能以附近直聊冒充导航覆盖。
  for (const scene of SCENES) {
    const npc = data.npcs.find(n => n.places[slot] === scene && !route.includes(n));
    if (npc) route.push(npc);
  }
  return route.concat(data.npcs.filter(n => !route.includes(n)));
}
async function chatEveryone(cdp, opt, data, slot, seen, walkedScenes) {
  const before = await cdp.eval(READ_SAVE);
  for (const npc of itinerary(data, slot)) {
    const prior = await visit(cdp, opt, data, npc, slot, walkedScenes);
    await chat(cdp, data, npc, slot, seen);
    if (npc.id === 'roommate' && slot === 0) await cdp.shot(opt.shots, opt.flat ? 'campus-chat-mobile' : 'campus-chat-desktop');
    await closeCampus(cdp);
    unchanged(prior.save, await cdp.eval(READ_SAVE), '拜访、聊天、关闭');
  }
  const after = await cdp.eval(READ_SAVE);
  unchanged(before, after, `整轮 ${data.npcs.length} 人交谈`);
  metList(after, data.npcs.map(n => n.id), true);
  const expected = data.replies.filter(r => r.slot === slot).map(replyKey).sort();
  assert.deepStrictEqual([...seen].filter(key => key.endsWith('/' + slot)).sort(), expected,
    `slot ${slot} 未核对全部 ${data.npcs.length} 人 / ${expected.length} 回复`);
  console.log(`  slot ${slot}: ${data.npcs.length} 人 / ${expected.length} 回复通过，进度未改变`);
}

async function reloadResume(cdp, opt, expected) {
  // 导航会清掉旧页面上下文；随后必须再等完整加载遮罩，不读旧页面的 FZ。
  await cdp.send('Page.navigate', { url: 'about:blank' });
  await cdp.send('Page.navigate', { url: URL_BASE });
  await ready(cdp, opt);
  await cdp.wait(`document.querySelector('#btn-resume').classList.contains('on')`, '刷新后的续玩入口');
  await cdp.click('#btn-resume');
  await cdp.wait(`document.querySelector('#screen-game').classList.contains('active') &&
    document.querySelectorAll('#choices .choice:not(.locked)').length > 0`, '正常 resume 当前事件');
  const restored = await cdp.eval(READ_SAVE);
  unchanged(expected, restored, 'reload/resume');
  assert.deepStrictEqual(restored.npcMet, expected.npcMet, '刷新丢失/重排 npcMet');
  await layout(cdp);
}

async function repeatAndShortcuts(cdp, opt, data, seen) {
  const before = await cdp.eval(READ_SAVE);
  await openCampus(cdp, 'c');
  await closeCampus(cdp, true);
  if (!opt.flat) {
    const nearest = await cdp.eval('FZ.World.nearestNpc()');
    assert(nearest, '拜访后没有附近人物，不能测试 T/附近按钮');
    for (const entry of ['button', 't']) {
      if (entry === 'button') {
        await cdp.wait(`!document.querySelector('#btn-talk').disabled`, '附近交谈按钮可用');
        await cdp.click('#btn-talk');
      } else await cdp.key('t');
      await cdp.wait(DIALOG_OPEN, '附近交谈入口');
      const npc = data.npcs.find(n => n.id === nearest);
      assert.equal(await cdp.eval(`document.querySelector('#npc-name').textContent.trim()`), npc.name, '附近入口没有选择 nearestNpc');
      await chat(cdp, data, npc, before.slot, seen);
      await closeCampus(cdp, entry === 't');
    }
  } else {
    // 平面模式没有 nearby 导航入口；重复通过图鉴直接与同一人物聊天。
    const npc = data.npcs[0];
    await visit(cdp, opt, data, npc, before.slot, new Set());
    await chat(cdp, data, npc, before.slot, seen);
    await closeCampus(cdp, true);
  }
  const after = await cdp.eval(READ_SAVE);
  assert.deepStrictEqual(after, before, '重复会话新增重复相识或改变其他存档字段');
}

async function returnToStory(cdp, opt, data, seen, walkedScenes) {
  const original = await cdp.eval(READ_SAVE);
  // resume 位于可作选择的 event 阶段，再测一次 123/QWE，避免只在 roam 检查而漏掉剧情快捷键。
  await openCampus(cdp);
  await lockedKeys(cdp, opt);
  const storyUI = `({ title: document.querySelector('#event-title').textContent,
    text: document.querySelector('#event-text').textContent,
    choices: [...document.querySelectorAll('#choices .choice')].map(el => ({ text: el.textContent, disabled: el.disabled })) })`;
  const originalUI = await cdp.eval(storyUI);
  if (!opt.flat) {
    const status = await statusCheck(cdp, data, original.slot);
    const storyTarget = await cdp.eval('FZ.World.debug().target');
    const far = data.npcs.find(n => Object.hasOwn(NEW_NPC_PLACES, n.id) &&
      n.places[original.slot] !== storyTarget && !status.find(s => s.id === n.id).nearby);
    assert(far, '没有不同于主线地点的新增人物可验证真实回程');
    await visit(cdp, opt, data, far, original.slot, walkedScenes);
    await chat(cdp, data, far, original.slot, seen);
    await closeCampus(cdp);
    const departure = await cdp.eval(SNAPSHOT);
    const stand = await cdp.eval(`FZ.World.standOf(${literal(original.currentEvent.scene)})`);
    assert.equal(departure.debug.target, storyTarget, '回程前已丢失剧情目标');
    assert(distance(departure.debug.pos, stand) > 1.35, '仍在主线地点，不能冒充真实回程');
    await cdp.eval('window.__campusTest.phases = []');
    // 从新增场景点实际「自动前往」按钮走回去；不改存档、不 place、不直接触发 arrive。
    await cdp.click('#btn-go');
    await cdp.eval(`new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true))))`);
    const deadline = Date.now() + 90000;
    let sawRoam = false, moved = false, returned = null;
    while (Date.now() < deadline) {
      const now = await cdp.eval(SNAPSHOT);
      unchanged(original, now.save, '返回主线途中');
      assert.deepStrictEqual(now.save.currentEvent, original.currentEvent, '回程途中原事件被替换');
      assert.equal(now.debug.target, storyTarget, '回程切换了主线目的地');
      assert.equal(now.debug.npcTarget, null, '回主线时仍在拜访 NPC');
      assert.equal(now.open, false, '回主线时意外打开了人物对话');
      if (distance(departure.debug.pos, now.debug.pos) > 0.05) moved = true;
      if (now.phase === 'event') { returned = now; break; }
      assert.equal(now.phase, 'roam', '回程进入了非行走阶段');
      assert.equal(now.debug.auto, true, '回程没有沿自动路线步行');
      navigationTarget(now, data, storyTarget, '返回主线');
      sawRoam = true;
      await pause(200);
    }
    assert(returned, '90s 内未步行回到原主线事件');
    assert(sawRoam && moved, '未观测到从新增场景返回主线的真实步行');
    assert.equal(returned.debug.arrived, true, '回到 event 但未真正到达主线');
    assert(distance(returned.debug.pos, stand) <= 1.2, '返回 event 时玩家不在原主线地点');
  }
  await cdp.wait(`document.querySelectorAll('#choices .choice:not(.locked):not(:disabled)').length > 0 &&
    !document.querySelector('#event-text').classList.contains('typing')`, '原剧情选项可用', 30000);
  const restored = await cdp.eval(READ_SAVE);
  unchanged(original, restored, '返回剧情但尚未作选择');
  assert.deepStrictEqual(restored.currentEvent, original.currentEvent, '回主线后原事件/选项数据改变');
  assert.deepStrictEqual(await cdp.eval(storyUI), originalUI, '回主线后显示的原事件/选项改变');
  await cdp.click('#choices .choice:not(.locked):not(:disabled)');
  await cdp.wait(`(${READ_SAVE}).resultShown === true && document.querySelector('#btn-next').classList.contains('on')`, '正常选项结算', 20000);
  const chosen = await cdp.eval(READ_SAVE);
  assert.equal(chosen.decisions, original.decisions + 1, '正常选项没有增加 decisions');
  assert.equal(chosen.tick, original.tick, '选择时提前消耗时段');
  assert.equal(chosen.currentEvent.id, original.currentEvent.id, '选择了错误的剧情');
  assert.notDeepStrictEqual({ stats: chosen.stats, courses: chosen.courses }, { stats: original.stats, courses: original.courses }, '选项未产生正常游戏效果');
  assert.deepStrictEqual(chosen.npcMet, original.npcMet, '剧情选择损坏 npcMet');
  await cdp.click('#btn-next');
  await cdp.wait(`(${READ_SAVE}).tick === ${original.tick + 1} && (${READ_SAVE}).slot === ${original.slot + 1}`, '正常继续到下一时段');
  const advanced = await cdp.eval(READ_SAVE);
  assert.equal(advanced.decisions, original.decisions + 1, '继续导致重复结算');
  assert.equal(advanced.day, original.day, '继续跳过了当天时段');
  assert.deepStrictEqual(advanced.npcMet, original.npcMet, '继续丢失 npcMet');
  console.log('  刷新相识、快捷键隔离、回原剧情选择并继续通过');
}

const FRAME_PROBE = `new Promise(resolve => requestAnimationFrame(() => {
  const canvas = document.querySelector('#world canvas');
  if (!canvas) return resolve({ error: '缺少世界 canvas' });
  try {
    const out = document.createElement('canvas');
    out.width = 120; out.height = Math.max(1, Math.round(120 * canvas.height / canvas.width));
    const ctx = out.getContext('2d'); ctx.drawImage(canvas, 0, 0, out.width, out.height);
    const pixels = ctx.getImageData(0, 0, out.width, out.height).data;
    let sum = 0, min = 255, max = 0, hash = 2166136261;
    for (let i = 0; i < pixels.length; i += 4) {
      const light = (pixels[i] + pixels[i + 1] + pixels[i + 2]) / 3;
      sum += light; min = Math.min(min, light); max = Math.max(max, light);
      hash = Math.imul(hash ^ pixels[i] ^ (pixels[i + 1] << 8) ^ (pixels[i + 2] << 16), 16777619);
    }
    resolve({ width: canvas.width, height: canvas.height, cssWidth: canvas.getBoundingClientRect().width,
      viewport: document.documentElement.clientWidth, min, max, avg: sum / (pixels.length / 4), hash: hash >>> 0 });
  } catch (error) { resolve({ error: String(error) }); }
}))`;

async function daylight(cdp, opt, data, slot) {
  const labels = await cdp.eval(`({ time: document.querySelector('#world-time-label').textContent,
    slot: document.querySelector('#slot-label').textContent, clock: document.querySelector('#clock').textContent })`);
  assert(labels.time.includes(data.slots[slot].full), '世界时间标签没有更新 slot');
  assert(labels.time.includes(slot === 2 ? '夜晚' : '白天'), '世界白天/夜晚标签错误');
  assert.equal(labels.slot.trim(), data.slots[slot].full, '游戏时段标签错误');
  assert.equal(labels.clock.trim(), data.slots[slot].time, '游戏时钟错误');
  if (opt.flat) { await cdp.shot(opt.shots, 'campus-flat-slot-' + slot); return null; }
  await statusCheck(cdp, data, slot);
  // 先在低画质等待相机到位，避免软件渲染器用高画质执行整段镜头过渡。
  await cdp.wait(`(() => {
    const d = FZ.World.debug();
    return Math.hypot(d.cam[0] - d.pos[0], d.cam[2] - d.pos[1]) < 0.03;
  })()`, '相机抵达当前事件', 90000);
  await cdp.eval(`FZ.World.setQuality('high')`);
  try {
    await cdp.wait(`FZ.World.quality() === 'high' && FZ.World.debug().renderPixelRatio >= 1`, 'high 图像参数');
    await cdp.eval(`new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true))))`);
    const debug = await cdp.eval('FZ.World.debug()');
    assert(Number.isFinite(debug.renderPixelRatio) && debug.renderPixelRatio >= 1, 'renderPixelRatio 低于 1');
    assert(Number.isFinite(debug.grain) && debug.grain >= 0 && debug.grain <= 0.01, 'grain 超过 0.01');
    if (typeof debug.aberration === 'number') assert(Number.isFinite(debug.aberration) && debug.aberration >= 0 && debug.aberration <= 0.15, 'aberration 超过 0.15');
    assert.equal(debug.dayNight, slot === 2 ? 'night' : 'day', 'dayNight 不符合 0/1 白天、2 夜晚');
    assert.equal(debug.sunVisible, slot !== 2, '太阳可见性错误');
    assert.equal(debug.moonVisible, slot === 2, '月亮可见性错误');
    // bloom debug 可为数值或参数对象；不臆造产品未约定的强度阈值。
    assert(debug.bloom !== null && ['number', 'object'].includes(typeof debug.bloom), 'bloom debug 缺失/格式错误');
    const bloomNumbers = typeof debug.bloom === 'number' ? [debug.bloom] : Object.values(debug.bloom).filter(v => typeof v === 'number');
    assert(bloomNumbers.length && bloomNumbers.every(v => Number.isFinite(v) && v >= 0), 'bloom 参数无效');
    const frame = await cdp.eval(FRAME_PROBE);
    assert(!frame.error && frame.width > 0 && frame.height > 0, '世界画面读取失败: ' + JSON.stringify(frame));
    assert(Math.abs(frame.cssWidth - frame.viewport) <= 4, 'canvas 与 clientWidth 不匹配');
    assert(frame.max - frame.min > 4 && frame.avg > 0.5, '世界画布空白/近乎全黑');
    await layout(cdp);
    await cdp.shot(opt.shots, 'campus-' + ['morning', 'afternoon', 'night'][slot]);
    console.log('  slot ' + slot + ' 图像: ' + JSON.stringify({ dayNight: debug.dayNight,
      ratio: debug.renderPixelRatio, grain: debug.grain, aberration: debug.aberration, bloom: debug.bloom, avg: +frame.avg.toFixed(2) }));
    return { debug, frame };
  } finally { await cdp.eval(`FZ.World.setQuality('low')`); }
}

async function assertPortFree(port) {
  await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', () => reject(new Error('调试端口已占用，拒绝连接/关闭他人的 Chrome: ' + port)));
    server.listen(port, '127.0.0.1', () => server.close(resolve));
  });
}
async function chromeTarget(port, processState) {
  const end = Date.now() + 30000;
  while (Date.now() < end) {
    if (interrupted) throw interrupted;
    if (processState.error) throw processState.error;
    if (processState.exited) throw new Error('Chrome 启动后提前退出');
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(1500) });
      if (response.ok) {
        const target = (await response.json()).find(t => t.type === 'page' && t.url === 'about:blank');
        if (target) return target.webSocketDebuggerUrl;
      }
    } catch (error) { if (processState.error) throw processState.error; }
    await pause(200);
  }
  throw new Error('Chrome CDP 端口未就绪');
}
async function destroyChrome(chrome, state, cdp, profile) {
  let problem = null;
  if (cdp && !state.exited) {
    try { await cdp.send('Browser.close', {}, 4000); } catch (_) { /* Browser.close 可能先关 socket。 */ }
  }
  if (cdp) cdp.close();
  if (chrome && !state.exited) await Promise.race([state.done, pause(1500)]);
  if (chrome && chrome.pid && !state.exited) {
    if (process.platform === 'win32') {
      // 只按自己创建的 PID 结束树，绝不按 chrome.exe 名称终止其他会话。
      await new Promise((resolve, reject) => {
        const kill = spawn('taskkill', ['/PID', String(chrome.pid), '/T', '/F'], { stdio: 'ignore' });
        const timer = setTimeout(() => { kill.kill(); reject(new Error('taskkill 超时')); }, 10000);
        kill.once('error', e => { clearTimeout(timer); reject(e); });
        kill.once('exit', () => { clearTimeout(timer); resolve(); });
      }).catch(e => { problem = e; });
    } else chrome.kill('SIGKILL');
    await Promise.race([state.done, pause(5000)]);
    if (!state.exited) problem = new Error('本测试 Chrome 未成功退出，PID=' + chrome.pid);
  }
  try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 12, retryDelay: 250 }); }
  catch (error) { problem = new Error('临时 profile 清理失败: ' + profile + ': ' + error.message); }
  if (problem) throw problem;
}

async function main() {
  const opt = options();
  const CHROME = require('./browser')();
  await assertPortFree(opt.port);
  const state = { exited: false, error: null, done: null };
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'fz-campus-'));
  let chrome, cdp, data;
  const problems = [], seen = new Set(), walkedScenes = new Set();
  const onSignal = signal => { interrupted = new Error('测试被 ' + signal + ' 中断'); };
  const onInt = () => onSignal('SIGINT'), onTerm = () => onSignal('SIGTERM');
  process.on('SIGINT', onInt); process.on('SIGTERM', onTerm);
  try {
    if (opt.shots) fs.mkdirSync(opt.shots, { recursive: true });
    // 只启动一个 software-rendered Chrome，先 about:blank，避免重复加载两套 WebGL 世界。
    chrome = spawn(CHROME, [
      '--headless=new', '--remote-debugging-address=127.0.0.1', `--remote-debugging-port=${opt.port}`,
      `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--mute-audio',
      '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
      '--disable-features=Translate,MediaRouter', `--window-size=${opt.width},${opt.height}`, 'about:blank'
    ], { stdio: 'ignore' });
    state.done = new Promise(resolve => {
      chrome.once('error', error => { state.error = error; state.exited = true; resolve(); });
      chrome.once('exit', () => { state.exited = true; resolve(); });
    });
    cdp = await CDP.connect(await chromeTarget(opt.port, state));
    await cdp.send('Page.enable'); await cdp.send('Runtime.enable'); await cdp.send('Log.enable');
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: opt.width, height: opt.height, deviceScaleFactor: 1, mobile: opt.width < 700 });
    await cdp.send('Page.navigate', { url: URL_BASE });
    await ready(cdp, opt);
    data = await collectData(cdp);
    console.log(`校园回归 ${opt.flat ? 'flat' : '3D'} ${opt.width}x${opt.height}: 已收集 ${data.npcs.length} 人 / ${data.replies.length} slot 回复`);
    await layout(cdp);
    await cdp.eval(`(() => {
      const major = document.querySelector('#major-select'); major.value = '数学与应用数学';
      major.dispatchEvent(new Event('change', { bubbles: true }));
      const subject = document.querySelector('#subject-select'); subject.value = '数学分析';
      subject.dispatchEvent(new Event('change', { bubbles: true }));
      if (!major.value || !subject.value) throw new Error('测试专业/科目选项缺失');
    })()`);
    await cdp.click('#btn-start');
    await cdp.wait(`document.querySelector('#screen-game').classList.contains('active') && !!(${READ_SAVE})`, 'veil 退场后正常开局');
    const initial = await cdp.eval(READ_SAVE);
    assert.equal(initial.slot, 0, '开局不是清晨');
    assert.equal(initial.decisions, 0, '新游戏已有决策');
    assert.equal(initial.phase, 'event', '正常存档不是 event');
    assert(initial.currentEvent && initial.currentEvent.choices.length, '正常游戏未生成合法当前事件');
    assert(await cdp.eval(`FZ.EVENTS.some(e => e.id === (${READ_SAVE}).currentEvent.id)`), '存档 event 不在真实事件数据中');
    await makeOracle(cdp, data, initial);
    await openCampus(cdp);
    await rosterLayout(cdp, data);
    await lockedKeys(cdp, opt);
    await chatEveryone(cdp, opt, data, 0, seen, walkedScenes);
    if (!opt.flat) assert.deepStrictEqual([...walkedScenes].sort(), [...SCENES].sort(), `未通过真实 UI 步行拜访全部 ${SCENES.length} 类场景`);
    await repeatAndShortcuts(cdp, opt, data, seen);
    const checkpoint = await cdp.eval(READ_SAVE);
    unchanged(initial, checkpoint, '整套初始校园交互');
    await reloadResume(cdp, opt, checkpoint);
    metList(await cdp.eval(READ_SAVE), data.npcs.map(n => n.id), true);
    await returnToStory(cdp, opt, data, seen, walkedScenes);

    const images = [];
    for (const slot of data.slots.keys()) {
      // 仅为三时段回复/同机位昼夜对比设置时间；保留合法 currentEvent、课程、数值、决策、npcMet。
      // fixture/reload 不计作导航覆盖；每轮仍须真实点击 visit、走路、到达后核对全部人物回复。
      // 不直调 beginSlot 伪造游戏状态：真正由 reload/resume 驱动世界和 UI。
      const fixture = structuredClone(checkpoint);
      fixture.slot = slot;
      fixture.tick = (fixture.day - 1) * data.slots.length + slot;
      await cdp.eval(`localStorage.setItem(${literal(RUN_KEY)}, ${literal(JSON.stringify(fixture))})`);
      await reloadResume(cdp, opt, fixture);
      images[slot] = await daylight(cdp, opt, data, slot);
      if (slot > 0) await chatEveryone(cdp, opt, data, slot, seen, walkedScenes);
      unchanged(fixture, await cdp.eval(READ_SAVE), '昼夜时段聊天');
    }
    if (!opt.flat) {
      for (const image of images.slice(1)) {
        assert.equal(image.debug.target, images[0].debug.target, '昼夜截图不是同一场景');
        assert(distance(image.debug.pos, images[0].debug.pos) <= 0.02, '昼夜截图玩家位置不同');
        assert(Math.abs(image.debug.yaw - images[0].debug.yaw) <= 0.003, '昼夜截图朝向不同');
        assert(distance(image.debug.cam, images[0].debug.cam) <= 0.15, '昼夜截图相机位置不一致');
      }
      assert.notEqual(images[0].frame.hash, images[2].frame.hash, '清晨和夜晚世界画面完全相同');
    }
    assert.equal(seen.size, data.replies.length, `UI 没有验证全部 ${data.replies.length} 条 slot 回复`);
    assert.deepStrictEqual([...seen].sort(), data.replies.map(replyKey).sort(), '实际 UI 覆盖的人物/话题/时段不完整');
    console.log(`  占位回复 ${data.substitutions} 条；${data.replies.length} 条实际 UI 回复全部核对`);
  } catch (error) {
    problems.push(error.stack || String(error));
    if (cdp) {
      try { console.error('  失败现场: ' + JSON.stringify(await cdp.eval(SNAPSHOT))); } catch (_) {}
      try { await cdp.shot(opt.shots, 'campus-failure'); } catch (_) {}
    }
  } finally {
    if (cdp) problems.push(...cdp.errors.map(error => '页面错误: ' + error));
    try { await destroyChrome(chrome, state, cdp, profile); } catch (error) { problems.push(error.stack || String(error)); }
    process.removeListener('SIGINT', onInt); process.removeListener('SIGTERM', onTerm);
  }
  for (const problem of problems) console.error(problem);
  console.log(problems.length ? `FAIL: ${problems.length} 个错误，已验证 ${seen.size}/${data ? data.replies.length : '数据未通过入口校验'} 回复` :
    `PASS: ${data.npcs.length} 人、${data.replies.length} 回复、存档/锁定/布局/昼夜通过；${opt.flat ? 'flat 无导航' : `${SCENES.length} 场景真实导航/地图目标/原事件回程`}；控制台 0 错误`);
  console.log('命令: "' + NODE + '" "' + path.resolve(__filename) + '" --port ' + opt.port +
    ' --width ' + opt.width + ' --height ' + opt.height + (opt.flat ? ' --flat' : '') +
    (opt.shots ? ' --shots "' + opt.shots + '"' : '') + '  (FZ_URL=' + URL_BASE + ')');
  if (problems.length) process.exitCode = 1;
}

main().catch(error => { console.error(error.stack || String(error)); process.exitCode = 1; });
