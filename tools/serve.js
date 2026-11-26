#!/usr/bin/env node
const http = require('http');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..', '期末周求生');
const port = Number(process.env.PORT || 8765);
const types = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.json': 'application/json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml',
  '.m4a': 'audio/mp4', '.mp3': 'audio/mpeg', '.woff2': 'font/woff2'
};

const server = http.createServer((req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { Allow: 'GET, HEAD' });
    res.end();
    return;
  }
  let pathname;
  try { pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname); }
  catch { res.writeHead(400); res.end(); return; }
  if (pathname === '/') pathname = '/index.html';
  const parts = pathname.slice(1).split('/');
  const allowed = pathname === '/index.html' || ['css', 'js', 'assets', 'api'].includes(parts[0]);
  if (!allowed || parts.some((part) => !part || part.startsWith('.') || /[\\:\x00]/.test(part))) {
    res.writeHead(404); res.end(); return;
  }
  const file = path.join(root, ...parts);
  fs.stat(file, (err, stat) => {
    if (err || !stat.isFile()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, {
      'Content-Type': types[path.extname(file)] || (parts[0] === 'api' ? 'application/json; charset=utf-8' : 'application/octet-stream'),
      'Content-Length': stat.size,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff'
    });
    if (req.method === 'HEAD') { res.end(); return; }
    const stream = fs.createReadStream(file);
    stream.on('error', () => res.destroy());
    stream.pipe(res);
  });
});
server.on('error', (err) => { console.error(err.message); process.exitCode = 1; });
server.listen(port, '127.0.0.1', () => {
  console.log(`期末周求生: http://127.0.0.1:${server.address().port}/index.html`);
  console.log(`PID ${process.pid} · ${root}`);
});
