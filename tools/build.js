#!/usr/bin/env node
/* 把源码拷进 dist/（纯静态站点，无编译步骤）。
   用法: node tools/build.js [--src 期末周求生] */
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const i = process.argv.indexOf('--src');
const src = path.resolve(root, i > -1 ? process.argv[i + 1] : '期末周求生');
const out = path.join(src, 'dist');

if (!fs.existsSync(path.join(src, 'index.html'))) throw new Error('找不到源码 index.html: ' + src);

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });

let files = 0, bytes = 0;
function copy(rel) {
  const from = path.join(src, rel), to = path.join(out, rel);
  const st = fs.statSync(from);
  if (st.isDirectory()) {
    fs.mkdirSync(to, { recursive: true });
    for (const name of fs.readdirSync(from).sort()) {
      if (name === 'dist' || name.startsWith('.')) continue;
      copy(path.join(rel, name));
    }
  } else {
    fs.copyFileSync(from, to);
    files++; bytes += st.size;
  }
}

copy('index.html');
for (const d of ['css', 'js', 'assets']) if (fs.existsSync(path.join(src, d))) copy(d);

// 产物必须自带三维引擎，否则线上会静默退回平面
const need = ['index.html', 'js/world.js', 'js/vendor/three.min.js', 'js/vendor/three-fx.js', 'js/subjects.js', 'js/npcs.js'];
const missing = need.filter((f) => !fs.existsSync(path.join(out, f)));
if (missing.length) throw new Error('产物缺文件: ' + missing.join(', '));

console.log(`✅ dist/ 重建完成：${files} 个文件 / ${(bytes / 1048576).toFixed(2)} MB`);
console.log('   ' + out);