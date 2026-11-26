window.FZ = window.FZ || {};

/* DeepSeek NPC 对话：只调用同源 /api/npc-chat 代理，密钥永远不进入前端。
   也可通过 ?ai=https://你的代理域名 或 window.FZ_AI_BASE 指向独立代理。 */
(function () {
  const BASE_KEY = 'fz.ai.base';
  let probe = null;

  try {
    const q = new URLSearchParams(location.search).get('ai');
    if (q === 'off') localStorage.setItem(BASE_KEY, 'off');
    else if (/^https?:\/\//i.test(q)) localStorage.setItem(BASE_KEY, q.replace(/\/+$/, ''));
  } catch (e) {}

  function base() {
    let v;
    try { v = localStorage.getItem(BASE_KEY); } catch (e) {}
    if (v == null) v = window.FZ_AI_BASE || '';
    if (v === 'off') return null;
    if (!v && location.protocol === 'file:') return null;
    return String(v).replace(/\/+$/, '');
  }

  function api(path) {
    const b = base();
    if (b === null) return '';
    // 同源用相对路径，项目部署在 /repo/ 子路径下也能命中；静态站自带 api/ai-status 占位文件，避免 404 刷控制台。
    return (b ? b + '/api/' : 'api/') + path;
  }

  function status(force) {
    if (!probe || force) {
      probe = (async () => {
        const url = api('ai-status');
        if (!url) return { ok: false, reason: 'disabled' };
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 1800);
        try {
          const r = await fetch(url, { signal: ctrl.signal, cache: 'no-store' });
          if (!r.ok) return { ok: false, reason: 'http_' + r.status };
          const j = await r.json();
          return { ok: !!j.ok, model: j.model || '', reason: j.reason || '' };
        } catch (e) {
          return { ok: false, reason: 'unreachable' };
        } finally {
          clearTimeout(timer);
        }
      })();
    }
    return probe;
  }

  async function chat(payload) {
    const url = api('npc-chat');
    if (!url) throw new Error('AI 未配置');
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 18000);
    try {
      const r = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: ctrl.signal
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.reply) throw new Error(j.error || ('HTTP ' + r.status));
      return { text: String(j.reply).trim(), model: j.model || '' };
    } finally {
      clearTimeout(timer);
    }
  }

  FZ.AI = { status, chat, base, refresh: () => status(true) };
})();