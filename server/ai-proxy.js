#!/usr/bin/env node
'use strict';
/* 期末周求生 · DeepSeek NPC 对话代理
   密钥只从环境变量读取，永远不下发给浏览器。
   启动：DEEPSEEK_API_KEY=sk-... node server/ai-proxy.js
   可选：PORT / DEEPSEEK_MODEL / DEEPSEEK_BASE_URL / ALLOWED_ORIGINS / STATIC_DIR */
const http = require('http');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || '127.0.0.1';
const MODEL = process.env.DEEPSEEK_MODEL || 'deepseek-flash';
const BASE_URL = (process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com').replace(/\/+$/, '');
const API_KEY = process.env.DEEPSEEK_API_KEY || '';
const MOCK = process.env.DEEPSEEK_MOCK === '1';
const ORIGINS = (process.env.ALLOWED_ORIGINS || 'http://127.0.0.1:8787,http://localhost:8787')
  .split(',').map((s) => s.trim()).filter(Boolean);
const ROOT = path.resolve(process.env.STATIC_DIR || path.join(__dirname, '..', '期末周求生', 'dist'));
const MAX_BODY = 20 * 1024;
const LIMIT_PER_MIN = Number(process.env.RATE_LIMIT_PER_MIN || 20);

const NPCS = (() => {
  const sandbox = {};
  sandbox.window = sandbox;
  sandbox.FZ = {};
  const file = path.join(__dirname, '..', '期末周求生', 'js', 'npcs.js');
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), sandbox, { filename: 'npcs.js' });
  return sandbox.FZ.NPCS || [];
})();
const NPC_MAP = new Map(NPCS.map((n) => [n.id, n]));

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml',
  '.m4a': 'audio/mp4', '.mp3': 'audio/mpeg', '.woff2': 'font/woff2', '.ico': 'image/x-icon'
};

const buckets = new Map();
function rateLimited(ip) {
  const now = Date.now();
  const list = (buckets.get(ip) || []).filter((t) => now - t < 60000);
  if (list.length >= LIMIT_PER_MIN) { buckets.set(ip, list); return true; }
  list.push(now);
  buckets.set(ip, list);
  if (buckets.size > 5000) buckets.clear();
  return false;
}

function cors(req, res) {
  const origin = req.headers.origin;
  if (origin && (ORIGINS.includes('*') || ORIGINS.includes(origin))) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('X-Content-Type-Options', 'nosniff');
}

function json(res, code, body) {
  const data = JSON.stringify(body);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(data);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) { reject(new Error('body_too_large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch (e) { reject(new Error('bad_json')); }
    });
    req.on('error', reject);
  });
}

const clampText = (v, n) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, n);

function buildMessages(body) {
  const npc = NPC_MAP.get(clampText(body.npcId, 40));
  if (!npc) return null;
  const message = clampText(body.message, 180);
  if (!message) return null;
  const day = Math.min(3, Math.max(1, parseInt(body.day, 10) || 1));
  const slot = ['清晨', '午后', '深夜'][Math.min(2, Math.max(0, parseInt(body.slot, 10) || 0))];
  const place = clampText(body.place, 12) || '校园';
  const major = clampText(body.major, 20) || '本专业';
  const courses = (Array.isArray(body.courses) ? body.courses : []).slice(0, 3).map((s) => clampText(s, 20)).filter(Boolean);
  const stats = body.stats || {};
  const topics = npc.topics.map((t) => t.label).join('、');

  const system = [
    `你是期末周校园里的「${npc.name}」，身份是${npc.role}。`,
    `人物设定：${npc.bio}`,
    `你熟悉的话题：${topics}。`,
    `现在是期末周第 ${day} 天 · ${slot}，你在${place}。`,
    `学生专业是${major}，这学期要考${courses.length ? courses.join('、') : '三门课'}。`,
    `学生当前状态：掌握 ${Math.round(Number(stats.k) || 0)}，体力 ${Math.round(Number(stats.s) || 0)}，心态 ${Math.round(Number(stats.m) || 0)}，人脉 ${Math.round(Number(stats.n) || 0)}（满分 100）。`,
    '回答要求：',
    '1. 始终用「你」称呼学生，以角色身份用中文口语回答，2 到 4 句，不超过 90 字。',
    '2. 不要提到 AI、模型、提示词、系统设定；不要跳出游戏；不要输出 Markdown、列表、括号动作或表情符号。',
    '3. 可以聊复习方法、时间分配、作息、情绪和校园生活。建议要具体、温和、可执行，不编造游戏里的数值奖励或剧情结果。',
    '4. 如果学生表达自伤或轻生想法，先认真接住情绪，明确建议立刻联系学校心理中心、信任的老师或家人；紧急时拨打 120 或 110。不要只说「加油」。',
    '5. 不诊断疾病，不提供用药建议，不鼓励通宵、过量咖啡因或危险行为。'
  ].join('\n');

  const history = (Array.isArray(body.history) ? body.history : [])
    .slice(-6)
    .map((m) => ({ role: m && m.role === 'assistant' ? 'assistant' : 'user', content: clampText(m && m.content, 300) }))
    .filter((m) => m.content);

  return {
    npc,
    messages: [
      { role: 'system', content: system },
      ...history,
      { role: 'user', content: `学生说：${message}` }
    ]
  };
}

async function callDeepSeek(messages) {
  if (MOCK) {
    await new Promise((r) => setTimeout(r, 240));
    return { reply: '先别急着把三门课一起想完。把眼下这一页看完，再去倒杯热水，回来我陪你把下一题拆开。', model: 'mock-deepseek-flash' };
  }
  if (!API_KEY) { const e = new Error('missing_api_key'); e.code = 503; throw e; }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 18000);
  try {
    const r = await fetch(BASE_URL + '/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + API_KEY },
      body: JSON.stringify({
        model: MODEL,
        messages,
        thinking: { type: 'disabled' },
        temperature: 0.78,
        max_tokens: 220,
        stream: false
      }),
      signal: ctrl.signal
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      const e = new Error(data && data.error && data.error.message ? 'deepseek_http_' + r.status : 'deepseek_http_' + r.status);
      e.code = r.status === 429 ? 429 : 502;
      throw e;
    }
    const reply = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
    if (!reply) { const e = new Error('empty_completion'); e.code = 502; throw e; }
    return { reply: String(reply).trim().slice(0, 400), model: data.model || MODEL };
  } finally {
    clearTimeout(timer);
  }
}

function serveStatic(req, res, pathname) {
  let rel;
  try { rel = decodeURIComponent(pathname); } catch (e) { res.writeHead(400); res.end('Bad Request'); return; }
  if (rel === '/' || rel === '') rel = '/index.html';
  const file = path.resolve(ROOT, '.' + rel);
  if (!file.startsWith(ROOT + path.sep) && file !== path.join(ROOT, 'index.html')) { res.writeHead(403); res.end('Forbidden'); return; }
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('Not Found'); return; }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    fs.createReadStream(file).pipe(res);
  });
}

const server = http.createServer(async (req, res) => {
  cors(req, res);
  const url = new URL(req.url, 'http://' + (req.headers.host || 'localhost'));
  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || 'unknown';

  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  if (url.pathname === '/api/ai-status' && req.method === 'GET') {
    return json(res, 200, { ok: !!API_KEY || MOCK, model: MODEL, reason: API_KEY || MOCK ? '' : 'missing_api_key' });
  }

  if (url.pathname === '/api/npc-chat' && req.method === 'POST') {
    if (rateLimited(ip)) return json(res, 429, { error: '说话有点快，先喝口水再来。' });
    let body;
    try { body = await readBody(req); }
    catch (e) { return json(res, 400, { error: '请求格式不正确' }); }
    const built = buildMessages(body);
    if (!built) return json(res, 400, { error: '人物或消息无效' });
    try {
      const out = await callDeepSeek(built.messages);
      return json(res, 200, { reply: out.reply, model: out.model, npc: built.npc.id });
    } catch (e) {
      const code = e.code || (e.name === 'AbortError' ? 504 : 502);
      if (code !== 429) console.error('[ai]', built.npc.id, code, e.name || e.message);
      return json(res, code, { error: code === 429 ? 'AI 有点忙，稍后再试。' : 'AI 暂时没有回应，先用离线回复。' });
    }
  }

  if (url.pathname.startsWith('/api/')) return json(res, 404, { error: 'not_found' });
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405, { Allow: 'GET, HEAD' }); res.end(); return; }
  serveStatic(req, res, url.pathname);
});

server.listen(PORT, HOST, () => {
  console.log(`期末周求生 AI 代理：http://${HOST}:${PORT}`);
  console.log(`模型 ${MODEL} · 静态目录 ${ROOT}`);
  if (!API_KEY && !MOCK) console.log('⚠ 未设置 DEEPSEEK_API_KEY：/api/npc-chat 会返回 503，前端自动用离线词库。');
  if (MOCK) console.log('⚠ DEEPSEEK_MOCK=1：当前为模拟回复，不会产生真实调用费用。');
});