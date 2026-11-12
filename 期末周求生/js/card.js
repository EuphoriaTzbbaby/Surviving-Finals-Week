window.FZ = window.FZ || {};

FZ.Card = (function () {
  const W = 1080, H = 1440;

  function rr(c, x, y, w, h, r) {
    c.beginPath();
    c.moveTo(x + r, y);
    c.lineTo(x + w - r, y);
    c.quadraticCurveTo(x + w, y, x + w, y + r);
    c.lineTo(x + w, y + h - r);
    c.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    c.lineTo(x + r, y + h);
    c.quadraticCurveTo(x, y + h, x, y + h - r);
    c.lineTo(x, y + r);
    c.quadraticCurveTo(x, y, x + r, y);
    c.closePath();
  }

  function wrap(c, text, x, y, maxW, lh) {
    let line = '', yy = y;
    for (const ch of text) {
      if (ch === '\n') { c.fillText(line, x, yy); line = ''; yy += lh; continue; }
      const test = line + ch;
      if (c.measureText(test).width > maxW && line) { c.fillText(line, x, yy); line = ch; yy += lh; }
      else line = test;
    }
    if (line) c.fillText(line, x, yy);
    return yy + lh;
  }

  function countLines(c, text, maxW) {
    let line = '', n = 1;
    for (const ch of text) {
      if (ch === '\n') { line = ''; n++; continue; }
      const test = line + ch;
      if (c.measureText(test).width > maxW && line) { line = ch; n++; }
      else line = test;
    }
    return n;
  }

  function radar(c, cx, cy, r, stats) {
    const keys = ['k', 's', 'm', 'n'];
    const cols = ['#B6F03C', '#FFB020', '#FF3D8B', '#35D6F5'];
    const names = ['知识', '体力', '心态', '人脉'];
    const pt = (i, ratio) => {
      const a = -Math.PI / 2 + i * Math.PI / 2;
      return [cx + Math.cos(a) * r * ratio, cy + Math.sin(a) * r * ratio];
    };

    for (let ring = 1; ring <= 4; ring++) {
      c.beginPath();
      for (let i = 0; i < 4; i++) {
        const p = pt(i, ring / 4);
        i ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1]);
      }
      c.closePath();
      c.strokeStyle = ring === 4 ? 'rgba(174,186,224,0.42)' : 'rgba(174,186,224,0.14)';
      c.lineWidth = ring === 4 ? 2 : 1.5;
      c.stroke();
    }
    for (let i = 0; i < 4; i++) {
      const p = pt(i, 1);
      c.beginPath(); c.moveTo(cx, cy); c.lineTo(p[0], p[1]);
      c.strokeStyle = 'rgba(174,186,224,0.16)'; c.lineWidth = 1.5; c.stroke();
    }

    c.beginPath();
    for (let i = 0; i < 4; i++) {
      const p = pt(i, Math.max(0.04, stats[keys[i]] / 100));
      i ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1]);
    }
    c.closePath();
    const g = c.createLinearGradient(cx - r, cy - r, cx + r, cy + r);
    g.addColorStop(0, 'rgba(182,240,60,0.42)');
    g.addColorStop(0.5, 'rgba(255,61,139,0.34)');
    g.addColorStop(1, 'rgba(53,214,245,0.42)');
    c.fillStyle = g; c.fill();
    c.strokeStyle = 'rgba(243,233,210,0.85)'; c.lineWidth = 3; c.stroke();

    for (let i = 0; i < 4; i++) {
      const p = pt(i, Math.max(0.04, stats[keys[i]] / 100));
      c.beginPath(); c.arc(p[0], p[1], 8, 0, Math.PI * 2);
      c.fillStyle = cols[i]; c.fill();
      c.strokeStyle = '#0B0E1A'; c.lineWidth = 3; c.stroke();
    }

    c.textAlign = 'center'; c.textBaseline = 'middle';
    const off = 36;
    for (let i = 0; i < 4; i++) {
      const p = pt(i, 1);
      const dx = p[0] - cx, dy = p[1] - cy;
      const len = Math.hypot(dx, dy) || 1;
      const lx = p[0] + dx / len * off, ly = p[1] + dy / len * off;
      c.font = '600 24px "PingFang SC","Microsoft YaHei",sans-serif';
      c.fillStyle = cols[i];
      c.fillText(names[i], lx, ly - 12);
      c.font = '700 28px ui-monospace,Menlo,monospace';
      c.fillStyle = '#F3E9D2';
      c.fillText(String(Math.round(stats[keys[i]])), lx, ly + 16);
    }
    c.textAlign = 'left'; c.textBaseline = 'alphabetic';
  }

  function render(canvas, d) {
    canvas.width = W; canvas.height = H;
    const c = canvas.getContext('2d');
    const sans = '"PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif';
    const mono = 'ui-monospace,"SF Mono",Menlo,monospace';

    const bg = c.createLinearGradient(0, 0, W, H);
    bg.addColorStop(0, '#0A0D1C');
    bg.addColorStop(0.45, '#141B33');
    bg.addColorStop(1, '#0D1224');
    c.fillStyle = bg; c.fillRect(0, 0, W, H);

    const lamp = c.createRadialGradient(W * 0.78, 120, 20, W * 0.78, 120, 760);
    lamp.addColorStop(0, 'rgba(255,176,32,0.30)');
    lamp.addColorStop(0.45, 'rgba(255,176,32,0.08)');
    lamp.addColorStop(1, 'rgba(255,176,32,0)');
    c.fillStyle = lamp; c.fillRect(0, 0, W, H);

    const vio = c.createRadialGradient(120, H - 200, 20, 120, H - 200, 700);
    vio.addColorStop(0, 'rgba(108,75,216,0.34)');
    vio.addColorStop(1, 'rgba(108,75,216,0)');
    c.fillStyle = vio; c.fillRect(0, 0, W, H);

    c.save();
    c.globalAlpha = 0.05;
    c.strokeStyle = '#AEB8E0'; c.lineWidth = 1;
    for (let y = 200; y < H - 120; y += 46) {
      c.beginPath(); c.moveTo(72, y); c.lineTo(W - 72, y); c.stroke();
    }
    c.restore();

    c.save();
    c.globalAlpha = 0.055;
    for (let i = 0; i < 2600; i++) {
      c.fillStyle = i % 2 ? '#FFFFFF' : '#000000';
      c.fillRect(Math.random() * W, Math.random() * H, 2, 2);
    }
    c.restore();

    c.strokeStyle = 'rgba(174,186,224,0.20)'; c.lineWidth = 2;
    rr(c, 40, 40, W - 80, H - 80, 32); c.stroke();

    c.font = `600 26px ${sans}`;
    c.fillStyle = '#8E97B8';
    c.fillText('期末周求生 · 战绩单', 84, 116);

    c.font = `500 24px ${mono}`;
    c.fillStyle = '#FFB020';
    c.textAlign = 'right';
    c.fillText(d.dateStr, W - 84, 116);
    c.textAlign = 'left';

    c.strokeStyle = 'rgba(255,176,32,0.35)'; c.lineWidth = 2;
    c.beginPath(); c.moveTo(84, 146); c.lineTo(W - 84, 146); c.stroke();

    c.font = `500 28px ${sans}`;
    c.fillStyle = '#AEB8E0';
    c.fillText(`${d.major} · ${d.subject}`, 84, 202);
    c.font = `500 24px ${sans}`;
    c.fillStyle = '#8E97B8';
    c.fillText(`难度 ${d.diffName} · 复习 3 天 · 决策 ${d.decisions} 次`, 84, 244);

    const titleSize = d.ending.title.length > 5 ? 92 : 108;
    c.font = `800 ${titleSize}px ${sans}`;
    c.fillStyle = '#F3E9D2';
    c.fillText(d.ending.title, 80, 372);

    c.save();
    c.globalAlpha = 0.5;
    c.fillStyle = d.ending.color;
    const tw = c.measureText(d.ending.title).width;
    c.fillRect(84, 392, Math.min(tw, W - 200), 12);
    c.restore();

    c.save();
    c.translate(W - 208, 300);
    c.rotate(-0.11);
    c.strokeStyle = '#D93A3A'; c.lineWidth = 7;
    rr(c, -78, -78, 156, 156, 14); c.stroke();
    c.globalAlpha = 0.14; c.fillStyle = '#D93A3A';
    rr(c, -78, -78, 156, 156, 14); c.fill();
    c.globalAlpha = 1;
    c.font = `800 104px ${sans}`;
    c.fillStyle = '#E24545';
    c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText(d.ending.seal, 0, 6);
    c.restore();
    c.textAlign = 'left'; c.textBaseline = 'alphabetic';

    c.font = `500 22px ${sans}`;
    c.fillStyle = d.ending.color;
    c.fillText(`稀有度 · ${d.ending.rarity}`, 84, 452);

    rr(c, 84, 492, W - 168, 170, 24);
    const sg = c.createLinearGradient(84, 492, W - 84, 662);
    sg.addColorStop(0, 'rgba(108,75,216,0.30)');
    sg.addColorStop(1, 'rgba(53,214,245,0.14)');
    c.fillStyle = sg; c.fill();
    c.strokeStyle = 'rgba(174,186,224,0.20)'; c.lineWidth = 2; c.stroke();

    c.font = `800 112px ${mono}`;
    c.fillStyle = d.passed ? '#B6F03C' : '#FF4D4D';
    c.fillText(String(d.score), 124, 616);
    const sw = c.measureText(String(d.score)).width;
    c.font = `500 28px ${sans}`;
    c.fillStyle = '#8E97B8';
    c.fillText('/ 100', 132 + sw, 616);

    c.textAlign = 'right';
    c.font = `800 66px ${mono}`;
    c.fillStyle = '#F3E9D2';
    c.fillText(d.grade.letter, W - 124, 578);
    c.font = `500 24px ${sans}`;
    c.fillStyle = '#FFB020';
    c.fillText(`绩点 ${d.grade.point} · ${d.grade.word}`, W - 124, 620);
    c.textAlign = 'left';

    radar(c, W / 2, 906, 146, d.stats);

    rr(c, 84, 1146, W - 168, 150, 22);
    c.fillStyle = 'rgba(243,233,210,0.06)'; c.fill();
    c.strokeStyle = 'rgba(255,176,32,0.24)'; c.lineWidth = 2; c.stroke();
    c.fillStyle = '#FFB020';
    c.fillRect(84, 1166, 6, 110);
    c.font = `500 32px ${sans}`;
    c.fillStyle = '#E8DFC8';
    const lines = countLines(c, d.line, W - 240);
    wrap(c, d.line, 118, 1232 - (lines - 1) * 23, W - 240, 46);

    c.strokeStyle = 'rgba(174,186,224,0.18)'; c.lineWidth = 2;
    c.beginPath(); c.moveTo(84, 1316); c.lineTo(W - 84, 1316); c.stroke();

    c.font = `600 24px ${sans}`;
    c.fillStyle = '#8E97B8';
    c.fillText('2026 Qoder 高校创造力大赛 · LifeHack', 84, 1362);
    c.textAlign = 'right';
    c.font = `500 22px ${mono}`;
    c.fillStyle = '#6C4BD8';
    c.fillText('用 Qoder 造', W - 84, 1362);
    c.textAlign = 'left';

    return canvas;
  }

  function download(canvas, filename) {
    canvas.toBlob(function (blob) {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = filename;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
    }, 'image/png');
  }

  return { render, download, W, H };
})();
