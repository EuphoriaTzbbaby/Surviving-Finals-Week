// 开发期截图工具：把当前 DOM 光栅化成 PNG 并 POST 到本地接收服务。
// 不随游戏发布，index.html 不引用本文件。
// 用法：在页面控制台注入本文件，然后 __cap('文件名.png', { width: 1440, height: 900, desktop: true })
(function () {
  const SINK = 'http://127.0.0.1:8812/';

  function stripMobileBlocks(css) {
    let out = '', i = 0;
    while (i < css.length) {
      const at = css.indexOf('@media', i);
      if (at < 0) { out += css.slice(i); break; }
      out += css.slice(i, at);
      const open = css.indexOf('{', at);
      const header = css.slice(at, open);
      let depth = 1, j = open + 1;
      while (j < css.length && depth > 0) {
        if (css[j] === '{') depth++;
        else if (css[j] === '}') depth--;
        j++;
      }
      if (!/max-width/.test(header)) out += css.slice(at, j);
      i = j;
    }
    return out;
  }

  async function collectCSS(desktop) {
    let css = '';
    for (const sheet of document.styleSheets) {
      try {
        if (sheet.href) {
          const txt = await (await fetch(sheet.href)).text();
          css += txt + '\n';
        } else {
          for (const r of sheet.cssRules) css += r.cssText + '\n';
        }
      } catch (e) { /* 跨域样式表忽略 */ }
    }
    if (desktop) css = stripMobileBlocks(css);
    return css;
  }

  // 把 vw/vh 换算成固定 px：应用内浏览器视口只有 594px，
  // 不换算的话 clamp(...vw...) 会按窄屏取值，量到的桌面几何是假的。
  function fixViewportUnits(css, w, h) {
    return css
      .replace(/(-?\d*\.?\d+)(vw|vmin)\b/g, (_, n, u) => (parseFloat(n) * w / 100) + 'px')
      .replace(/(-?\d*\.?\d+)(vh|vmax)\b/g, (_, n) => (parseFloat(n) * h / 100) + 'px')
      .replace(/(-?\d*\.?\d+)(dvh|svh|lvh)\b/g, (_, n) => (parseFloat(n) * h / 100) + 'px')
      .replace(/(-?\d*\.?\d+)(dvw|svw|lvw)\b/g, (_, n) => (parseFloat(n) * w / 100) + 'px');
  }

  // 把真实页面切到桌面布局：禁用原样式表，注入剥掉 max-width 媒体查询的副本。
  // 这样才能在窄视口的应用内浏览器里量到真实桌面几何。
  window.__mode = async function (width, height) {
    const css = fixViewportUnits(await collectCSS(true), width, height);
    for (const sheet of document.styleSheets) {
      if (sheet.ownerNode && sheet.ownerNode.id === '__desktopStyle') continue;
      sheet.disabled = true;
    }
    let el = document.getElementById('__desktopStyle');
    if (!el) {
      el = document.createElement('style');
      el.id = '__desktopStyle';
      document.head.appendChild(el);
    }
    el.textContent = css + `
      html, body { width:${width}px !important; min-width:${width}px !important;
        max-width:${width}px !important; }
      body { min-height:${height}px !important; }
    `;
    document.documentElement.style.width = width + 'px';
    void document.documentElement.offsetHeight;
    return { width, scrollW: document.documentElement.scrollWidth, scrollH: document.documentElement.scrollHeight };
  };

  window.__restore = function () {
    const el = document.getElementById('__desktopStyle');
    if (el) el.remove();
    for (const sheet of document.styleSheets) sheet.disabled = false;
    document.documentElement.style.width = '';
  };

  // 找出所有横向溢出的元素
  window.__overflow = function () {
    const bad = [];
    document.querySelectorAll('*').forEach((n) => {
      if (n.scrollWidth > n.clientWidth + 1 && n.clientWidth > 0) {
        const cs = getComputedStyle(n);
        if (cs.overflowX === 'visible' || cs.overflowX === 'hidden') {
          bad.push({
            sel: n.tagName.toLowerCase() + (n.id ? '#' + n.id : '') + (n.className && typeof n.className === 'string' ? '.' + n.className.trim().split(/\s+/).join('.') : ''),
            scrollW: n.scrollWidth, clientW: n.clientWidth,
            text: (n.textContent || '').trim().slice(0, 30)
          });
        }
      }
    });
    return bad;
  };

  window.__cap = async function (name, opt) {
    const o = Object.assign({ width: 1440, height: 900, desktop: true, scale: 1 }, opt || {});
    const css = await collectCSS(o.desktop);

    const clone = document.documentElement.cloneNode(true);

    clone.querySelectorAll('script').forEach((n) => n.remove());
    clone.querySelectorAll('link[rel="stylesheet"]').forEach((n) => n.remove());

    // canvas 内容不会被序列化，换成等效 img
    const liveCanvases = document.querySelectorAll('canvas');
    const cloneCanvases = clone.querySelectorAll('canvas');
    liveCanvases.forEach((lc, i) => {
      const cc = cloneCanvases[i];
      if (!cc) return;
      const img = document.createElement('img');
      img.src = lc.toDataURL('image/png');
      img.setAttribute('style', (lc.getAttribute('style') || '') +
        `;width:${lc.clientWidth || lc.width}px;height:${lc.clientHeight || lc.height}px`);
      img.className = lc.className;
      img.id = lc.id;
      cc.replaceWith(img);
    });

    const style = document.createElement('style');
    // 用 0s 时长而不是 animation:none —— 后者会丢掉 forwards 填充态，
    // 让靠动画淡出隐藏的元素（如日终过场）在截图里复活。
    style.textContent = css + `
      html, body { width:${o.width}px !important; height:${o.height}px !important;
        min-height:${o.height}px !important; overflow:hidden !important; }
      *, *::before, *::after {
        animation-duration: 0s !important; animation-delay: 0s !important;
        transition-duration: 0s !important; transition-delay: 0s !important; }
    `;
    clone.querySelector('head').appendChild(style);

    clone.setAttribute('style', `width:${o.width}px;height:${o.height}px;overflow:hidden`);
    const body = clone.querySelector('body');
    body.setAttribute('style', (body.getAttribute('style') || '') +
      `;width:${o.width}px;height:${o.height}px;overflow:hidden`);

    const xhtml = new XMLSerializer().serializeToString(clone);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${o.width}" height="${o.height}">` +
      `<foreignObject width="100%" height="100%">${xhtml}</foreignObject></svg>`;

    const url = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
    const img = new Image();
    await new Promise((res, rej) => {
      img.onload = res;
      img.onerror = () => rej(new Error('svg load failed'));
      img.src = url;
    });

    const cv = document.createElement('canvas');
    cv.width = o.width * o.scale;
    cv.height = o.height * o.scale;
    const ctx = cv.getContext('2d');
    ctx.fillStyle = '#0B0E1A';
    ctx.fillRect(0, 0, cv.width, cv.height);
    ctx.drawImage(img, 0, 0, cv.width, cv.height);

    const blob = await new Promise((r) => cv.toBlob(r, 'image/png'));
    if (!blob) return { ok: false, err: 'toBlob null (canvas tainted)' };
    const res = await fetch(SINK + encodeURIComponent(name), { method: 'POST', body: blob });
    return { ok: true, info: await res.text(), svgLen: svg.length };
  };
})();