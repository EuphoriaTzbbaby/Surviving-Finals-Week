const fs = require('fs');
const path = require('path');

function findBrowser() {
  if (process.env.CHROME_PATH) {
    if (fs.existsSync(process.env.CHROME_PATH)) return process.env.CHROME_PATH;
    throw new Error('CHROME_PATH 指向的浏览器不存在: ' + process.env.CHROME_PATH);
  }
  const candidates = process.platform === 'win32'
    ? [process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)'], process.env.LOCALAPPDATA]
      .filter(Boolean)
      .flatMap((root) => [
        path.join(root, 'Google', 'Chrome', 'Application', 'chrome.exe'),
        path.join(root, 'Microsoft', 'Edge', 'Application', 'msedge.exe')
      ])
    : process.platform === 'darwin'
      ? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge']
      : ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser'];
  const browser = candidates.find((candidate) => fs.existsSync(candidate));
  if (!browser) throw new Error('未找到 Chrome 或 Edge，请用 CHROME_PATH 指定浏览器可执行文件。');
  return browser;
}

module.exports = findBrowser;
