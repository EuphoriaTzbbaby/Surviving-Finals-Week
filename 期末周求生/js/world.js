/* 三维昼夜校园：单场景、第一人称、可交流人物。
   一个 rAF 循环、缓存几何与材质、静态阴影按昼夜刷新、pixelRatio 封顶。 */
window.FZ = window.FZ || {};

FZ.World = (function () {
  const T = window.THREE;

  const LOC = {
    dorm:      { name: '宿舍',     short: '宿舍', stand: [-21.4, -0.4], yaw: 0.764,       pitch: -0.07, door: [-13.5, -2],   rect: [-22, -2, 14, 16] },
    online:    { name: '宿舍书桌', short: '书桌', stand: [-21.4, -0.4], yaw: 0.764,       pitch: -0.09, door: [-13.5, -2],   rect: [-22, -2, 14, 16] },
    library:   { name: '图书馆',   short: '图书', stand: [0, -17.4],   yaw: 0,            pitch: -0.20, door: [0, -13.5],    rect: [0, -22, 24, 14] },
    classroom: { name: '教学楼',   short: '教学', stand: [20.9, -1.7], yaw: -Math.PI / 2, pitch: -0.06, door: [13.5, 0],     rect: [22, 0, 14, 20] },
    canteen:   { name: '食堂',     short: '食堂', stand: [0, 17.6],    yaw: Math.PI,      pitch: -0.03, door: [0, 14.5],     rect: [0, 22, 20, 12] },
    print:     { name: '打印店',   short: '打印', stand: [-11, 10.2],    yaw: Math.PI,      pitch: -0.04, door: [-11, 8.2],    rect: [-11, 12, 6, 5] },
    campus:    { name: '中庭',     short: '中庭', stand: [3.6, 10.0],   yaw: 0.152,        pitch: -0.04, door: [0, 9],        rect: null, outdoor: true },
    court:     { name: '篮球场',   short: '球场', stand: [22, -21],     yaw: 0,            pitch: -0.04, door: [15, -17],     rect: [23, -23, 14, 12], outdoor: true },
    garden:    { name: '静心花园', short: '花园', stand: [-22, -22],    yaw: 0.35,         pitch: -0.04, door: [-17, -14],    rect: [-23, -23, 12, 12], outdoor: true },
    cafe:      { name: '咖啡角',   short: '咖啡', stand: [23, 20.5],    yaw: Math.PI,      pitch: -0.04, door: [13, 0],       approach: [[13, 14], [23, 16.5]], rect: [23, 23, 10, 10] }
  };
  const RING = 11;
  const EYE = 1.62;

  const PAL = {
    amber: 0xffb020, warm: 0xffbe6a, acid: 0xb6f03c,
    magenta: 0xff3d8b, cyan: 0x35d6f5, moon: 0x9dc0ff,
    ink: 0x0a0d1c, danger: 0xff4d4d
  };

  /* 仍使用原来的三个 slot：清晨/午后为白天，第三段为夜晚。 */
  const SKY = [
    { top: 0x427fbc, mid: 0x91badd, bot: 0xefcfac, fog: 0xb2c8d8, fogD: 0.0025, moon: 1.35, hemi: 0.8, moonCol: 0xffe0b4, lamp: 0.3, room: 1.05, env: 0.38, lift: 0.0, exposure: 0.96, star: 0 },
    { top: 0x367fbf, mid: 0x99c6e5, bot: 0xd9e6ec, fog: 0xb8d5e5, fogD: 0.002, moon: 1.6, hemi: 0.95, moonCol: 0xfff1db, lamp: 0.2, room: 1.2, env: 0.42, lift: 0.0, exposure: 0.94, star: 0 },
    { top: 0x050a1c, mid: 0x13233f, bot: 0x26364f, fog: 0x15233a, fogD: 0.005, moon: 0.48, hemi: 0.3, moonCol: 0xa8caff, lamp: 1.0, room: 0.85, env: 0.18, lift: 0.002, exposure: 1.04, star: 1.0 }
  ];

  let renderer, scene, camera, composer, bloom, gradePass, pmremRT;
  let ok = false, running = false, raf = 0, paused = false;
  let phase = 'title', quality = 'high', mobile = false, fps = 60;
  let last = 0, elapsed = 0, hudTick = 0;
  let hemi, moon, roomLight, dormLamp, libLamp, examLampA, examLampB;
  let skyMat, stars, dust, steam, groundMat, plazaMat;
  let marker, markerBeam, markerLabel, markerRing, routeArrows;
  const routeTransform = new T.Object3D();
  const hud = {};
  let guideCache = null, mapBase = null, mapSize = '', arrivalTimer = 0;
  const batches = { meshes: 0, groups: 0 };
  let skyDome, moonSprite, moonDisc, sunDisc, clouds, moonPool, winMat, winPane, winShaft;
  const npcs = [], walkers = [], campusLights = [], sightObjects = [], occupancy = [];
  let campusCat, npcTarget = null, npcArriveCb = null, interactionLocked = false;
  let storyArrivalHeld = false, storyMarkerMap = null, npcHudTick = 0, conversation = null;
  const sightRay = new T.Raycaster(), sightOrigin = new T.Vector3(), sightDir = new T.Vector3();
  const colliders = [];
  const geoCache = new Map(), matCache = new Map(), texCache = new Map();
  const lampFlicker = [];
  const stdMats = [];
  const figures = [];
  const courseStacks = [];
  let posterTex = null, boardTex = null, screenTex = null;
  let copierBar = null, clockHand = null;
  let arriveCb = null, targetKey = 'library', autoPath = null, arrived = false, skyIdx = 2, jam = 0;
  let dayNo = 1, slotNo = 2, stats = { k: 18, s: 85, m: 70, n: 30 };
  let kick = new T.Vector3(), kickAmt = 0, bloomBump = 0, flashAmt = 0;
  let titleT = 0;

  const P = { x: 0, z: 16, yaw: Math.PI, pitch: -0.04, tYaw: Math.PI, tPitch: -0.04, bob: 0, moving: 0 };
  const cam = { pos: new T.Vector3(0, EYE, 16), yaw: Math.PI, pitch: -0.04 };
  const keys = Object.create(null);
  const stick = { on: false, x: 0, y: 0, id: -1 };
  const look = { on: false, id: -1, px: 0, py: 0 };

  /* ---------- 资源缓存 ---------- */
  function geo(key, make) {
    if (!geoCache.has(key)) geoCache.set(key, make());
    return geoCache.get(key);
  }
  function box(w, h, d) { return geo(`b${w},${h},${d}`, () => new T.BoxGeometry(w, h, d)); }
  function cyl(rt, rb, h, s) { return geo(`c${rt},${rb},${h},${s}`, () => new T.CylinderGeometry(rt, rb, h, s || 12)); }
  function mat(key, params, type) {
    if (!matCache.has(key)) {
      const M = type === 'basic' ? T.MeshBasicMaterial : type === 'phong' ? T.MeshPhongMaterial : T.MeshStandardMaterial;
      const m = new M(params);
      if (type !== 'basic') { m.envMapIntensity = 0.4; stdMats.push(m); }
      matCache.set(key, m);
    }
    return matCache.get(key);
  }
  function tex(key, w, h, draw, srgb) {
    if (texCache.has(key)) return texCache.get(key);
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    draw(c.getContext('2d'), w, h);
    const t = new T.CanvasTexture(c);
    t.encoding = srgb === false ? T.LinearEncoding : T.sRGBEncoding;
    t.anisotropy = 4;
    texCache.set(key, t);
    return t;
  }
  const FONT = '"PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif';

  function mesh(g, m, x, y, z, parent, ry) {
    const o = new T.Mesh(g, m);
    o.position.set(x, y, z);
    if (ry) o.rotation.y = ry;
    (parent || scene).add(o);
    return o;
  }
  function solid(x, z, hw, hd) { colliders.push({ x, z, hw, hd }); }
  function blocked(x, z) {
    const r = 0.36;
    for (let i = 0; i < colliders.length; i++) {
      const c = colliders[i];
      const dx = Math.abs(x - c.x) - c.hw, dz = Math.abs(z - c.z) - c.hd;
      if (dx < r && dz < r) {
        if (dx <= 0 || dz <= 0) return true;
        if (dx * dx + dz * dz < r * r) return true;
      }
    }
    return false;
  }

  /* ---------- 程序化贴图 ---------- */
  function noiseOn(g, w, h, n, a, col) {
    g.fillStyle = col;
    for (let i = 0; i < n; i++) {
      g.globalAlpha = Math.random() * a;
      g.fillRect(Math.random() * w, Math.random() * h, 1 + Math.random() * 2, 1 + Math.random() * 2);
    }
    g.globalAlpha = 1;
  }
  function texWood() {
    return tex('wood', 512, 512, (g, w, h) => {
      g.fillStyle = '#3a2c22'; g.fillRect(0, 0, w, h);
      for (let i = 0; i < 8; i++) {
        const y = i * 64;
        g.fillStyle = `rgb(${52 + Math.random() * 16},${38 + Math.random() * 12},${28 + Math.random() * 10})`;
        g.fillRect(0, y, w, 62);
        g.strokeStyle = 'rgba(0,0,0,0.55)'; g.lineWidth = 2;
        g.beginPath(); g.moveTo(0, y + 63); g.lineTo(w, y + 63); g.stroke();
        for (let k = 0; k < 26; k++) {
          g.strokeStyle = `rgba(255,220,180,${0.02 + Math.random() * 0.05})`;
          g.lineWidth = 1; g.beginPath();
          const yy = y + Math.random() * 60;
          g.moveTo(0, yy); g.bezierCurveTo(w * 0.3, yy + 4, w * 0.6, yy - 4, w, yy); g.stroke();
        }
      }
      noiseOn(g, w, h, 2600, 0.10, '#000');
    });
  }
  function texWall() {
    return tex('wall', 512, 512, (g, w, h) => {
      g.fillStyle = '#6b6f6a'; g.fillRect(0, 0, w, h);
      g.fillStyle = '#4d5450'; g.fillRect(0, h * 0.72, w, h * 0.28);
      g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(0, h * 0.71, w, 4);
      for (let i = 0; i < 40; i++) {
        g.fillStyle = `rgba(40,44,40,${0.05 + Math.random() * 0.12})`;
        g.beginPath(); g.ellipse(Math.random() * w, Math.random() * h, 20 + Math.random() * 70, 12 + Math.random() * 40, Math.random() * 3, 0, 7); g.fill();
      }
      noiseOn(g, w, h, 5200, 0.16, '#2b2f2c');
      noiseOn(g, w, h, 1800, 0.10, '#9aa09a');
    });
  }
  function texAsphalt() {
    return tex('asphalt', 512, 512, (g, w, h) => {
      g.fillStyle = '#15171f'; g.fillRect(0, 0, w, h);
      noiseOn(g, w, h, 14000, 0.30, '#2b2f3a');
      noiseOn(g, w, h, 5000, 0.22, '#05060a');
      for (let i = 0; i < 18; i++) {
        g.strokeStyle = `rgba(90,100,120,${0.05 + Math.random() * 0.08})`;
        g.lineWidth = 1 + Math.random() * 2; g.beginPath();
        g.moveTo(Math.random() * w, Math.random() * h);
        g.lineTo(Math.random() * w, Math.random() * h); g.stroke();
      }
    });
  }
  function texGlow() {
    return tex('glow', 128, 128, (g, w) => {
      const r = g.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
      r.addColorStop(0, 'rgba(255,255,255,1)');
      r.addColorStop(0.35, 'rgba(255,255,255,0.42)');
      r.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = r; g.fillRect(0, 0, w, w);
    }, false);
  }
  function texScreen() {
    return tex('screen', 512, 320, (g, w, h) => {
      g.fillStyle = '#06121c'; g.fillRect(0, 0, w, h);
      g.fillStyle = '#0d2233'; g.fillRect(0, 0, w, 26);
      g.fillStyle = '#35d6f5'; g.font = `600 14px ${FONT}`;
      g.fillText('notes_final.md — 未保存', 12, 18);
      const cols = ['#35d6f5', '#b6f03c', '#ffb020', '#8ea3c8'];
      for (let i = 0; i < 17; i++) {
        const y = 44 + i * 16;
        g.fillStyle = 'rgba(120,150,180,0.25)'; g.fillRect(12, y - 9, 18, 10);
        let x = 40;
        const segs = 2 + Math.floor(Math.random() * 4);
        for (let s = 0; s < segs; s++) {
          const len = 30 + Math.random() * 130;
          g.fillStyle = cols[(i + s) % cols.length];
          g.globalAlpha = 0.55 + Math.random() * 0.4;
          g.fillRect(x, y - 8, len, 8); x += len + 12;
          if (x > w - 60) break;
        }
        g.globalAlpha = 1;
      }
      g.fillStyle = '#b6f03c'; g.fillRect(40, 44 + 17 * 16 - 8, 9, 11);
    });
  }
  function texPoster(day) {
    const key = 'poster' + day;
    return tex(key, 384, 512, (g, w, h) => {
      g.fillStyle = '#f2ece0'; g.fillRect(0, 0, w, h);
      g.fillStyle = '#c8352f'; g.fillRect(0, 0, w, 92);
      g.fillStyle = '#fff'; g.font = `800 46px ${FONT}`; g.textAlign = 'center';
      g.fillText('期末倒计时', w / 2, 62);
      g.fillStyle = '#1a1a1a'; g.font = `900 210px ${FONT}`;
      g.fillText(String(Math.max(0, 4 - day)), w / 2, 300);
      g.font = `700 34px ${FONT}`; g.fillStyle = '#c8352f';
      g.fillText('天', w / 2, 350);
      g.strokeStyle = '#bbb'; g.lineWidth = 2;
      for (let i = 0; i < 6; i++) { g.beginPath(); g.moveTo(36, 386 + i * 20); g.lineTo(w - 36, 386 + i * 20); g.stroke(); }
      g.fillStyle = '#333'; g.font = `600 20px ${FONT}`; g.textAlign = 'left';
      g.fillText('□ 三门都过  □ 别通宵  □ 活着', 36, 400);
      noiseOn(g, w, h, 1400, 0.07, '#8a8070');
    });
  }
  function texBoard(lines) {
    return tex('board' + lines.join('|'), 1024, 512, (g, w, h) => {
      g.fillStyle = '#1d3229'; g.fillRect(0, 0, w, h);
      noiseOn(g, w, h, 5000, 0.10, '#2f4a3c');
      g.strokeStyle = 'rgba(255,255,255,0.10)'; g.lineWidth = 3;
      for (let i = 0; i < 12; i++) {
        g.beginPath(); g.moveTo(Math.random() * w, Math.random() * h);
        g.lineTo(Math.random() * w, Math.random() * h); g.stroke();
      }
      g.fillStyle = 'rgba(240,245,235,0.92)'; g.textAlign = 'left';
      g.font = `700 52px ${FONT}`;
      g.fillText(lines[0] || '期末考试', 48, 84);
      g.font = `500 34px ${FONT}`; g.fillStyle = 'rgba(230,240,225,0.78)';
      (lines.slice(1)).forEach((l, i) => g.fillText(l, 48, 156 + i * 56));
      g.strokeStyle = 'rgba(255,220,120,0.75)'; g.lineWidth = 4;
      g.beginPath(); g.moveTo(44, 100); g.lineTo(430, 100); g.stroke();
    });
  }
  function texMenu() {
    return tex('menu', 512, 256, (g, w, h) => {
      g.fillStyle = '#1a0d14'; g.fillRect(0, 0, w, h);
      g.fillStyle = '#ff3d8b'; g.font = `800 40px ${FONT}`; g.textAlign = 'center';
      g.fillText('夜宵窗口', w / 2, 54);
      g.font = `600 26px ${FONT}`; g.textAlign = 'left';
      const rows = [['阳春面', '6'], ['小馄饨', '8'], ['关东煮', '12'], ['热豆浆', '3']];
      rows.forEach((r, i) => {
        g.fillStyle = '#ffd9a0'; g.fillText(r[0], 48, 108 + i * 36);
        g.fillStyle = '#b6f03c'; g.textAlign = 'right'; g.fillText('¥' + r[1], w - 48, 108 + i * 36);
        g.textAlign = 'left';
      });
    });
  }
  function texPrice() {
    return tex('prtPrice', 256, 340, (g, w, h) => {
      g.fillStyle = '#f2ece0'; g.fillRect(0, 0, w, h);
      g.fillStyle = '#c8102e'; g.fillRect(0, 0, w, 52);
      g.fillStyle = '#fff'; g.font = `800 28px ${FONT}`; g.textAlign = 'center';
      g.fillText('价 目 表', w / 2, 37);
      g.textAlign = 'left'; g.font = `600 22px ${FONT}`;
      const rows = [['黑白打印', '0.2'], ['彩色打印', '1.0'], ['复印', '0.1'], ['胶装', '2.0'], ['扫描', '免费']];
      rows.forEach((r, i) => {
        g.fillStyle = '#2a2f38'; g.fillText(r[0], 22, 100 + i * 42);
        g.fillStyle = '#c8102e'; g.textAlign = 'right';
        g.fillText(r[1] === '免费' ? r[1] : '¥' + r[1], w - 22, 100 + i * 42);
        g.textAlign = 'left';
        g.strokeStyle = 'rgba(40,47,56,0.18)'; g.lineWidth = 1;
        g.beginPath(); g.moveTo(22, 110 + i * 42); g.lineTo(w - 22, 110 + i * 42); g.stroke();
      });
      g.fillStyle = '#1b6b3a'; g.font = `800 24px ${FONT}`; g.textAlign = 'center';
      g.fillText('期末周通宵营业', w / 2, h - 22);
    });
  }
  function texNeon() {
    return tex('neon', 512, 128, (g, w, h) => {
      g.fillStyle = '#0a0710'; g.fillRect(0, 0, w, h);
      g.textAlign = 'center'; g.font = `800 54px ${FONT}`;
      g.shadowColor = '#ff3d8b'; g.shadowBlur = 26;
      g.fillStyle = '#ff8fc0'; g.fillText('打印 · 复印 · 装订', w / 2, 78);
      g.shadowBlur = 0;
    });
  }
  function texPaper() {
    return tex('paper', 256, 256, (g, w, h) => {
      g.fillStyle = '#e8e4d8'; g.fillRect(0, 0, w, h);
      g.strokeStyle = 'rgba(60,70,90,0.5)'; g.lineWidth = 1.4;
      for (let i = 0; i < 14; i++) {
        const y = 26 + i * 16;
        g.beginPath(); g.moveTo(20, y);
        g.lineTo(20 + 60 + Math.random() * 160, y); g.stroke();
      }
      g.strokeStyle = 'rgba(200,60,60,0.7)'; g.lineWidth = 2.4;
      g.beginPath(); g.arc(190, 60, 26, 0, 7); g.stroke();
      noiseOn(g, w, h, 900, 0.06, '#a09880');
    });
  }
  function texSticky(col) {
    return tex('sticky' + col, 128, 128, (g, w, h) => {
      g.fillStyle = col; g.fillRect(0, 0, w, h);
      g.strokeStyle = 'rgba(40,30,10,0.65)'; g.lineWidth = 4;
      for (let i = 0; i < 4; i++) {
        g.beginPath(); g.moveTo(16, 30 + i * 22);
        g.lineTo(16 + 40 + Math.random() * 56, 30 + i * 22); g.stroke();
      }
    });
  }
  function texNightWindow() {
    return tex('nightWin', 512, 320, (g, w, h) => {
      const sky = g.createLinearGradient(0, 0, 0, h);
      sky.addColorStop(0, '#050a18'); sky.addColorStop(0.55, '#0d1730'); sky.addColorStop(1, '#1b2440');
      g.fillStyle = sky; g.fillRect(0, 0, w, h);
      for (let i = 0; i < 90; i++) {
        g.fillStyle = `rgba(200,220,255,${0.15 + Math.random() * 0.5})`;
        g.fillRect(Math.random() * w, Math.random() * h * 0.5, 1.4, 1.4);
      }
      g.fillStyle = 'rgba(226,236,255,0.9)';
      g.beginPath(); g.arc(392, 58, 17, 0, 7); g.fill();
      g.fillStyle = 'rgba(160,190,255,0.10)';
      g.beginPath(); g.arc(392, 58, 44, 0, 7); g.fill();
      const blocks = [[10, 150, 62], [78, 196, 48], [132, 122, 70], [206, 178, 54], [266, 140, 66], [338, 205, 44], [388, 165, 58], [452, 128, 60]];
      blocks.forEach(([x, top, bw]) => {
        g.fillStyle = '#080d1a'; g.fillRect(x, top, bw, h - top);
        for (let y = top + 10; y < h - 8; y += 17) {
          for (let xx = x + 7; xx < x + bw - 9; xx += 15) {
            if (Math.random() < 0.34) {
              const c = Math.random();
              g.fillStyle = c < 0.72 ? 'rgba(255,196,120,0.9)' : c < 0.9 ? 'rgba(130,200,255,0.75)' : 'rgba(182,240,60,0.6)';
              g.fillRect(xx, y, 8, 9);
            }
          }
        }
      });
      g.fillStyle = 'rgba(10,16,32,0.55)'; g.fillRect(0, h - 26, w, 26);
      for (let i = 0; i < 26; i++) {
        g.strokeStyle = `rgba(190,215,255,${0.05 + Math.random() * 0.1})`;
        g.lineWidth = 1; g.beginPath();
        const x = Math.random() * w, y = Math.random() * h;
        g.moveTo(x, y); g.lineTo(x - 5, y + 22); g.stroke();
      }
    });
  }

  function texDayWindow(morning) {
    return tex(morning ? 'dawnWin' : 'noonWin', 512, 320, (g, w, h) => {
      const sky = g.createLinearGradient(0, 0, 0, h);
      if (morning) {
        sky.addColorStop(0, '#4d6f9e'); sky.addColorStop(0.5, '#9db4c8'); sky.addColorStop(1, '#e8c9a4');
      } else {
        sky.addColorStop(0, '#5b86bd'); sky.addColorStop(0.55, '#9dc0dd'); sky.addColorStop(1, '#cfd9dc');
      }
      g.fillStyle = sky; g.fillRect(0, 0, w, h);
      for (let i = 0; i < 7; i++) {
        const cx = Math.random() * w, cy = 24 + Math.random() * 96, r = 22 + Math.random() * 30;
        g.fillStyle = morning ? 'rgba(255,226,196,0.5)' : 'rgba(255,255,255,0.62)';
        for (let k = 0; k < 5; k++) {
          g.beginPath(); g.arc(cx + (k - 2) * r * 0.55, cy + Math.sin(k) * 6, r * (0.6 + Math.random() * 0.4), 0, 7); g.fill();
        }
      }
      if (morning) {
        const sun = g.createRadialGradient(120, 196, 4, 120, 196, 120);
        sun.addColorStop(0, 'rgba(255,236,190,0.95)'); sun.addColorStop(1, 'rgba(255,200,140,0)');
        g.fillStyle = sun; g.fillRect(0, 60, 300, 260);
      }
      const blocks = [[10, 150, 62], [78, 196, 48], [132, 122, 70], [206, 178, 54], [266, 140, 66], [338, 205, 44], [388, 165, 58], [452, 128, 60]];
      blocks.forEach(([x, top, bw]) => {
        g.fillStyle = morning ? '#6d7484' : '#8b93a1'; g.fillRect(x, top, bw, h - top);
        g.fillStyle = morning ? 'rgba(255,214,164,0.35)' : 'rgba(226,238,248,0.4)';
        g.fillRect(x, top, bw * 0.34, h - top);
        for (let y = top + 10; y < h - 8; y += 17) {
          for (let xx = x + 7; xx < x + bw - 9; xx += 15) {
            g.fillStyle = morning ? 'rgba(60,66,80,0.55)' : 'rgba(74,92,112,0.5)';
            g.fillRect(xx, y, 8, 9);
          }
        }
      });
      for (let i = 0; i < 9; i++) {
        const x = 12 + i * 58 + Math.random() * 16, y = h - 26 - Math.random() * 12;
        g.fillStyle = morning ? '#3f5240' : '#4a6b45';
        g.beginPath(); g.arc(x, y, 20 + Math.random() * 12, 0, 7); g.fill();
        g.fillStyle = morning ? '#2f3d31' : '#3a5436'; g.fillRect(x - 2, y, 4, 30);
      }
      g.fillStyle = morning ? 'rgba(196,170,140,0.5)' : 'rgba(150,160,158,0.45)';
      g.fillRect(0, h - 22, w, 22);
    });
  }

  function texCity() {
    return tex('city', 256, 512, (g, w, h) => {
      g.fillStyle = '#070910'; g.fillRect(0, 0, w, h);
      for (let y = 8; y < h - 8; y += 22) {
        for (let x = 10; x < w - 10; x += 26) {
          if (Math.random() < 0.42) {
            const c = Math.random();
            g.fillStyle = c < 0.7 ? 'rgba(255,190,110,0.85)' : c < 0.9 ? 'rgba(120,200,255,0.7)' : 'rgba(182,240,60,0.6)';
            g.fillRect(x, y, 14, 11);
          }
        }
      }
    });
  }

  /* ---------- 天空与环境 ---------- */
  function buildSky() {
    skyMat = new T.ShaderMaterial({
      side: T.BackSide, depthWrite: false, fog: false,
      uniforms: {
        top: { value: new T.Color(SKY[2].top) }, mid: { value: new T.Color(SKY[2].mid) },
        bot: { value: new T.Color(SKY[2].bot) }, glow: { value: new T.Color(0x2a3a66) }
      },
      vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: [
        'uniform vec3 top,mid,bot,glow; varying vec3 vP;',
        'void main(){ float h = normalize(vP).y;',
        ' vec3 c = mix(bot, mid, smoothstep(-0.12,0.22,h));',
        ' c = mix(c, top, smoothstep(0.18,0.75,h));',
        ' float horizon = exp(-abs(h)*7.0);',
        ' c += glow * horizon * 0.55;',
        ' gl_FragColor = vec4(c,1.0); }'
      ].join('\n')
    });
    skyDome = new T.Mesh(geo('sky', () => new T.SphereGeometry(220, 32, 20)), skyMat);
    skyDome.frustumCulled = false;
    scene.add(skyDome);

    const n = mobile ? 500 : 1100;
    const pos = new Float32Array(n * 3), sz = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const th = Math.random() * Math.PI * 2, ph = Math.acos(Math.random() * 0.92 + 0.04);
      const r = 190;
      pos[i * 3] = r * Math.sin(ph) * Math.cos(th);
      pos[i * 3 + 1] = r * Math.cos(ph);
      pos[i * 3 + 2] = r * Math.sin(ph) * Math.sin(th);
      sz[i] = 0.6 + Math.random() * 1.9;
    }
    const sg = new T.BufferGeometry();
    sg.setAttribute('position', new T.BufferAttribute(pos, 3));
    sg.setAttribute('aSize', new T.BufferAttribute(sz, 1));
    stars = new T.Points(sg, new T.ShaderMaterial({
      transparent: true, depthWrite: false, fog: false, blending: T.AdditiveBlending,
      uniforms: { uOpacity: { value: 1 }, uTime: { value: 0 }, uMap: { value: texGlow() } },
      vertexShader: 'attribute float aSize; uniform float uTime; varying float vT; void main(){ vT = 0.55 + 0.45*sin(uTime*1.4 + position.x*0.4 + position.z*0.3); vec4 mv = modelViewMatrix*vec4(position,1.0); gl_PointSize = aSize*2.2; gl_Position = projectionMatrix*mv; }',
      fragmentShader: 'uniform float uOpacity; uniform sampler2D uMap; varying float vT; void main(){ vec4 t = texture2D(uMap, gl_PointCoord); gl_FragColor = vec4(vec3(0.85,0.9,1.0), t.a*uOpacity*vT); }'
    }));
    stars.frustumCulled = false;
    scene.add(stars);

    moonSprite = new T.Sprite(new T.SpriteMaterial({
      map: texGlow(), color: 0xdce8ff, transparent: true, depthWrite: false,
      blending: T.AdditiveBlending, fog: false, opacity: 0.9
    }));
    moonSprite.position.set(-90, 78, -140);
    moonSprite.scale.set(46, 46, 1);
    scene.add(moonSprite);
    moonDisc = mesh(geo('moonDisc', () => new T.CircleGeometry(7, 32)),
      mat('moonDisc', { color: 0xf2f6ff, fog: false }, 'basic'), -90, 78, -140);
    moonDisc.lookAt(0, 0, 0);
    sunDisc = mesh(geo('sunDisc', () => new T.CircleGeometry(5, 32)),
      mat('sunDisc', { color: 0xffe5af, fog: false }, 'basic'), 100, 72, -130);
    sunDisc.lookAt(0, 0, 0);
    clouds = new T.Group(); scene.add(clouds);
    const cloudGeo = geo('cloud', () => new T.SphereGeometry(1, 12, 8));
    const cloudMat = mat('cloud', { color: 0xe2eef5, fog: false, transparent: true, opacity: 0.72, depthWrite: false }, 'basic');
    [[-75, 64, -135], [90, 82, 105], [25, 58, -168]].forEach((p) => {
      for (let i = 0; i < 3; i++) {
        const c = mesh(cloudGeo, cloudMat, p[0] + i * 9, p[1] + (i % 2) * 2, p[2], clouds);
        c.scale.set(13, 3 + i % 2, 6);
      }
    });
  }

  function buildEnv() {
    const es = new T.Scene();
    const mk = (c, i, x, y, z, sx, sy, sz) => {
      const m = new T.Mesh(new T.BoxGeometry(sx, sy, sz), new T.MeshBasicMaterial({ color: c }));
      m.material.color.multiplyScalar(i);
      m.position.set(x, y, z); es.add(m);
    };
    mk(0x0a0f1e, 1, 0, 0, 0, 60, 40, 60);
    es.children[0].material.side = T.BackSide;
    mk(0xffb066, 2.6, -8, 4, -6, 8, 6, 0.4);
    mk(0x35d6f5, 1.4, 10, 6, 6, 6, 5, 0.4);
    mk(0x9dc0ff, 1.1, 0, 16, 0, 24, 0.4, 24);
    mk(0xff3d8b, 0.9, 6, 2, -12, 5, 3, 0.4);
    const pm = new T.PMREMGenerator(renderer);
    pm.compileEquirectangularShader();
    pmremRT = pm.fromScene(es, 0.03);
    scene.environment = pmremRT.texture;
    pm.dispose();
    es.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
  }

  /* ---------- 地面与中庭 ---------- */
  function buildGround() {
    const at = texAsphalt(); at.wrapS = at.wrapT = T.RepeatWrapping; at.repeat.set(26, 26);
    groundMat = mat('ground', { map: at, color: 0x8f96a8, roughness: 0.34, metalness: 0.55 });
    const g = mesh(geo('ground', () => new T.PlaneGeometry(240, 240)), groundMat, 0, 0, 0);
    g.rotation.x = -Math.PI / 2; g.receiveShadow = true;

    plazaMat = mat('plaza', { color: 0x3a3f4e, roughness: 0.42, metalness: 0.35 });
    const p = mesh(geo('plaza', () => new T.CircleGeometry(14.2, 64)), plazaMat, 0, 0.012, 0);
    p.rotation.x = -Math.PI / 2; p.receiveShadow = true;

    const ringMat = mat('ringline', { color: 0xffb020, transparent: true, opacity: 0.16 }, 'basic');
    const rl = mesh(geo('ringline', () => new T.RingGeometry(13.7, 13.95, 96)), ringMat, 0, 0.02, 0);
    rl.rotation.x = -Math.PI / 2;

    // 湿地的灯光倒影：加性光斑贴在地面上，比实时反射便宜得多
    const poolMat = mat('pool', { map: texGlow(), color: 0xffb877, transparent: true, opacity: 0.5, blending: T.AdditiveBlending, depthWrite: false }, 'basic');
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + 0.2;
      const q = mesh(geo('pool', () => new T.PlaneGeometry(9, 9)), poolMat, Math.sin(a) * 13, 0.03, Math.cos(a) * 13);
      q.rotation.x = -Math.PI / 2;
    }
    // 水洼
    const pud = mat('puddle', { color: 0x0d1424, roughness: 0.06, metalness: 0.9, transparent: true, opacity: 0.72 });
    for (let i = 0; i < 10; i++) {
      const a = Math.random() * 6.28, r = 4 + Math.random() * 9;
      const q = mesh(geo('puddle', () => new T.CircleGeometry(1, 18)), pud, Math.sin(a) * r, 0.022, Math.cos(a) * r);
      q.rotation.x = -Math.PI / 2;
      q.scale.set(0.7 + Math.random() * 1.6, 0.5 + Math.random() * 1.1, 1);
    }
  }

  function streetLamp(x, z) {
    const g = new T.Group(); g.position.set(x, 0, z); scene.add(g);
    const poleMat = mat('pole', { color: 0x22262f, roughness: 0.5, metalness: 0.8 });
    mesh(cyl(0.09, 0.13, 5.2, 10), poleMat, 0, 2.6, 0, g);
    mesh(box(0.9, 0.12, 0.34), poleMat, 0.35, 5.16, 0, g);
    const head = mesh(box(0.62, 0.14, 0.3), mat('lampHead', { color: 0xfff0d0, emissive: 0xffbe6a, emissiveIntensity: 2.6, roughness: 0.4 }), 0.66, 5.02, 0, g);
    lampFlicker.push({ m: head.material, base: 2.6, seed: Math.random() * 10, shared: true });
    const cone = mesh(geo('lampCone', () => new T.ConeGeometry(2.6, 5, 18, 1, true)),
      mat('lampCone', { color: 0xffc27a, transparent: true, opacity: 0.055, blending: T.AdditiveBlending, depthWrite: false, side: T.DoubleSide }, 'basic'),
      0.66, 2.5, 0, g);
    cone.renderOrder = 2;
    solid(x, z, 0.2, 0.2);
    return g;
  }

  function tree(x, z, s) {
    const g = new T.Group(); g.position.set(x, 0, z); g.scale.setScalar(s); scene.add(g);
    mesh(cyl(0.16, 0.26, 2.6, 8), mat('bark', { color: 0x2a2118, roughness: 0.95 }), 0, 1.3, 0, g);
    const leaf = mat('leaf', { color: 0x1c3a30, roughness: 0.9, flatShading: true });
    const ig = geo('leafBall', () => new T.IcosahedronGeometry(1, 0));
    [[0, 3.2, 0, 1.5], [0.8, 2.7, 0.4, 1.05], [-0.7, 2.9, -0.5, 1.15], [0.2, 3.9, -0.3, 0.95]].forEach((p) => {
      const m = mesh(ig, leaf, p[0], p[1], p[2], g);
      m.scale.setScalar(p[3]); m.rotation.set(Math.random(), Math.random(), Math.random());
      m.castShadow = true;
    });
    solid(x, z, 0.35 * s, 0.35 * s);
    return g;
  }

  function bench(x, z, ry) {
    const g = new T.Group(); g.position.set(x, 0, z); g.rotation.y = ry; scene.add(g);
    const wood = mat('benchWood', { color: 0x4a3524, roughness: 0.8 });
    const iron = mat('pole', { color: 0x22262f, roughness: 0.5, metalness: 0.8 });
    for (let i = 0; i < 3; i++) mesh(box(2.1, 0.07, 0.16), wood, 0, 0.46, -0.2 + i * 0.2, g);
    mesh(box(2.1, 0.42, 0.07), wood, 0, 0.72, -0.3, g);
    [-0.9, 0.9].forEach((sx) => { mesh(box(0.08, 0.46, 0.5), iron, sx, 0.23, 0, g); });
    solid(x, z, Math.abs(Math.cos(ry)) * 1.1 + 0.2, Math.abs(Math.sin(ry)) * 1.1 + 0.35);
  }

  function buildCourtyard() {
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + 0.2;
      streetLamp(Math.sin(a) * 13, Math.cos(a) * 13);
    }
    [[16, 12, 1.1], [-17, 9, 0.95], [15, -14, 1.2], [-16, -16, 1.05], [7, 17, 0.9], [-6, -17, 1.0], [19, 7, 1.0], [-19, -8, 0.9]].forEach((t) => tree(t[0], t[1], t[2]));
    bench(5.2, 7.0, -0.5); bench(-5.2, 7.0, 0.5); bench(8.5, -4, 1.4); bench(-8.5, -4, -1.4);

    // 中心花坛
    const rim = mesh(cyl(2.6, 2.7, 0.5, 32), mat('rim', { color: 0x4b4f5c, roughness: 0.8 }), 0, 0.25, 0);
    rim.receiveShadow = true;
    mesh(cyl(2.45, 2.45, 0.12, 32), mat('soil', { color: 0x1a1410, roughness: 1 }), 0, 0.52, 0);
    tree(0, 0, 1.35);
    solid(0, 0, 2.7, 2.7);

    // 公告栏
    const bg = new T.Group(); bg.position.set(9.5, 0, 9.5); bg.rotation.y = -2.35; scene.add(bg);
    const iron = mat('pole', { color: 0x22262f, roughness: 0.5, metalness: 0.8 });
    [-1.3, 1.3].forEach((sx) => mesh(cyl(0.07, 0.07, 2.4, 8), iron, sx, 1.2, 0, bg));
    mesh(box(3, 1.5, 0.1), mat('boardBack', { color: 0x14202c, roughness: 0.7 }), 0, 1.85, 0, bg);
    const pm = mat('posterSm', { map: texPaper(), roughness: 0.9 });
    for (let i = 0; i < 5; i++) {
      const q = mesh(geo('posterSm', () => new T.PlaneGeometry(0.5, 0.66)), pm, -1 + i * 0.5, 1.85 + (i % 2 ? 0.16 : -0.14), 0.06, bg);
      q.rotation.z = (Math.random() - 0.5) * 0.16;
    }
    mesh(box(3.2, 0.12, 0.34), iron, 0, 2.66, 0, bg);
    const bl = mesh(box(2.8, 0.06, 0.1), mat('boardLight', { color: 0xfff2dc, emissive: 0xffd9a0, emissiveIntensity: 2.2 }, 'basic'), 0, 2.58, 0.14, bg);
    lampFlicker.push({ m: bl.material, base: 2.2, seed: 3.1 });
    solid(9.5, 9.5, 1.2, 1.2);

    // 自行车棚
    const bike = mat('bike', { color: 0x2b3550, roughness: 0.4, metalness: 0.7 });
    const tyre = geo('tyre', () => new T.TorusGeometry(0.32, 0.045, 6, 16));
    for (let i = 0; i < 6; i++) {
      const g = new T.Group(); g.position.set(-9.5 + i * 0.75, 0, -13.2); g.rotation.y = 0.2; scene.add(g);
      [-0.42, 0.42].forEach((sx) => { const w = mesh(tyre, bike, sx, 0.32, 0, g); w.rotation.y = Math.PI / 2; });
      mesh(box(0.9, 0.05, 0.05), bike, 0, 0.62, 0, g);
      mesh(box(0.05, 0.4, 0.05), bike, 0.3, 0.78, 0, g);
      mesh(box(0.24, 0.05, 0.12), mat('saddle', { color: 0x14161c, roughness: 0.9 }), -0.28, 0.82, 0, g);
    }
    solid(-7.6, -13.2, 2.6, 0.6);

    // 远景城市
    const cityMat = mat('city', { map: texCity(), color: 0x30364a, roughness: 0.9, emissive: 0xffffff, emissiveMap: texCity(), emissiveIntensity: 0.85 });
    const cg = box(1, 1, 1);
    for (let i = 0; i < 46; i++) {
      const a = (i / 46) * Math.PI * 2 + Math.random() * 0.06;
      const r = 62 + Math.random() * 46;
      const w = 7 + Math.random() * 13, h = 9 + Math.random() * 34, d = 7 + Math.random() * 13;
      const m = mesh(cg, cityMat, Math.sin(a) * r, h / 2, Math.cos(a) * r);
      m.scale.set(w, h, d); m.rotation.y = a;
    }
    // 围墙
    const hedge = mat('hedge', { color: 0x162a22, roughness: 1, flatShading: true });
    for (let i = 0; i < 64; i++) {
      const a = (i / 64) * Math.PI * 2;
      const r = 40;
      const m = mesh(box(4.2, 1.5, 1.1), hedge, Math.sin(a) * r, 0.75, Math.cos(a) * r);
      m.rotation.y = a;
    }
  }

  /* ---------- 通用房间外壳 ---------- */
  function shell(cfg) {
    const { cx, cz, w, d, h, front, doorW, key } = cfg;
    const g = new T.Group(); g.position.set(cx, 0, cz); scene.add(g);
    const wt = texWall(); wt.wrapS = wt.wrapT = T.RepeatWrapping;
    const wallMat = mat('wall' + key, { map: wt, color: cfg.tint || 0x9aa0a0, roughness: 0.92 });
    const floorMat = cfg.floor === 'wood'
      ? mat('woodFloor', { map: texWood(), color: 0x8d7c66, roughness: 0.62, metalness: 0.05 })
      : mat('tileFloor' + key, { color: cfg.floorCol || 0x50555f, roughness: 0.35, metalness: 0.25 });
    const ft = floorMat.map;
    if (ft) { ft.wrapS = ft.wrapT = T.RepeatWrapping; ft.repeat.set(w / 4, d / 4); }

    const fl = mesh(geo('plane1', () => new T.PlaneGeometry(1, 1)), floorMat, 0, 0.03, 0, g);
    fl.scale.set(w, d, 1); fl.rotation.x = -Math.PI / 2; fl.receiveShadow = true;
    const ceil = mesh(geo('plane1'), mat('ceil' + key, { color: 0x2a2e36, roughness: 0.95 }), 0, h, 0, g);
    ceil.scale.set(w, d, 1); ceil.rotation.x = Math.PI / 2;

    const TH = 0.24;
    const wallSeg = (sx, sy, sz, px, py, pz) => {
      const m = mesh(box(1, 1, 1), wallMat, px, py, pz, g);
      m.scale.set(sx, sy, sz); m.castShadow = true; m.receiveShadow = true;
      solid(cx + px, cz + pz, sx / 2, sz / 2);
      return m;
    };
    const glassMat = mat('glass', {
      color: 0x9fd8ff, roughness: 0.06, metalness: 0.2, transparent: true, opacity: 0.16,
      emissive: 0x2a4a66, emissiveIntensity: 0.5, side: T.DoubleSide
    });
    const frameMat = mat('frame', { color: 0x1b1f28, roughness: 0.5, metalness: 0.7 });

    // front: 开门的那一面。其余三面实墙 + 高窗
    const sides = ['n', 's', 'w', 'e'];
    sides.forEach((s) => {
      const horiz = (s === 'n' || s === 's');
      const len = horiz ? w : d;
      const sgn = (s === 'n' || s === 'w') ? -1 : 1;
      const px = horiz ? 0 : sgn * (w / 2);
      const pz = horiz ? sgn * (d / 2) : 0;
      const sx = horiz ? len : TH, sz = horiz ? TH : len;
      if (s !== front) {
        if (cfg.solid) { wallSeg(sx, h, sz, px, h * 0.5, pz); return; }
        wallSeg(sx, h * 0.55, sz, px, h * 0.275, pz);
        wallSeg(sx, h * 0.18, sz, px, h * 0.91, pz);
        const gm = mesh(box(1, 1, 1), glassMat, px, h * 0.73, pz, g);
        gm.scale.set(horiz ? len * 0.86 : TH * 0.5, h * 0.36, horiz ? TH * 0.5 : len * 0.86);
        for (let i = -2; i <= 2; i++) {
          const fm = mesh(box(1, 1, 1), frameMat, horiz ? px + i * len / 5 : px, h * 0.73, horiz ? pz : pz + i * len / 5, g);
          fm.scale.set(horiz ? 0.09 : TH * 0.7, h * 0.36, horiz ? TH * 0.7 : 0.09);
        }
        return;
      }
      const seg = (len - doorW) / 2;
      [-1, 1].forEach((k) => {
        const off = k * (doorW / 2 + seg / 2);
        const ox = horiz ? off : px, oz = horiz ? pz : off;
        wallSeg(horiz ? seg : TH, h * 0.3, horiz ? TH : seg, ox, h * 0.15, oz);
        wallSeg(horiz ? seg : TH, h * 0.16, horiz ? TH : seg, ox, h * 0.92, oz);
        const gm = mesh(box(1, 1, 1), glassMat, ox, h * 0.62, oz, g);
        gm.scale.set(horiz ? seg * 0.94 : TH * 0.5, h * 0.62, horiz ? TH * 0.5 : seg * 0.94);
      });
      // 门楣与门框
      const lintel = mesh(box(1, 1, 1), wallMat, horiz ? 0 : px, h * 0.94, horiz ? pz : 0, g);
      lintel.scale.set(horiz ? doorW : TH, h * 0.12, horiz ? TH : doorW);
      [-1, 1].forEach((k) => {
        const fm = mesh(box(1, 1, 1), frameMat, horiz ? k * doorW / 2 : px, h * 0.44, horiz ? pz : k * doorW / 2, g);
        fm.scale.set(horiz ? 0.14 : TH * 1.2, h * 0.88, horiz ? TH * 1.2 : 0.14);
      });
      // 门口的暖光溢出
      const dir = cfg.spillDir || 1;
      const spill = mesh(geo('plane1'), mat('spill', { map: texGlow(), color: 0xffbe6a, transparent: true, opacity: 0.42, blending: T.AdditiveBlending, depthWrite: false }, 'basic'),
        horiz ? 0 : px + dir * 1.8, 0.04, horiz ? pz + dir * 1.8 : 0, g);
      spill.scale.set(8, 8, 1); spill.rotation.x = -Math.PI / 2;
    });

    // 屋顶
    const roof = mesh(box(1, 1, 1), mat('roof', { color: 0x1a1e28, roughness: 0.9 }), 0, h + 0.16, 0, g);
    roof.scale.set(w + 0.7, 0.32, d + 0.7); roof.castShadow = true;
    return g;
  }

  function texRug() {
    return tex('rug', 256, 200, (g, w, h) => {
      g.fillStyle = '#0f0d0b'; g.fillRect(0, 0, w, h);
      for (let y = 0; y < h; y += 3) { g.fillStyle = y % 6 ? '#12100d' : '#0b0908'; g.fillRect(0, y, w, 1); }
      for (let x = 0; x < w; x += 4) { g.fillStyle = 'rgba(255,244,224,0.03)'; g.fillRect(x, 0, 1, h); }
      g.strokeStyle = '#33261a'; g.lineWidth = 10; g.strokeRect(5, 5, w - 10, h - 10);
      g.strokeStyle = '#40301f'; g.lineWidth = 2; g.strokeRect(16, 16, w - 32, h - 32);
      g.strokeStyle = '#2a2015'; g.lineWidth = 3;
      g.beginPath(); g.moveTo(w / 2, 40); g.lineTo(w - 50, h / 2); g.lineTo(w / 2, h - 40); g.lineTo(50, h / 2); g.closePath(); g.stroke();
    });
  }

  function ceilingPanel(g, x, z, w, d, col, inten, key, y) {
    const m = mesh(box(1, 1, 1), mat('ceilPanel' + key, { color: col, emissive: col, emissiveIntensity: inten, roughness: 0.5 }), x, y || 3.3, z, g);
    m.scale.set(w, 0.07, d);
    lampFlicker.push({ m: m.material, base: inten, seed: Math.random() * 9, col0: m.material.color.clone(), ceilPanel: true });
    return m;
  }

  /* 台灯：灯头自发光 + 加性光锥 + 桌面光斑，只有一盏是真的点光源 */
  function deskLamp(parent, x, y, z, ry, col, scale) {
    const g = new T.Group(); g.position.set(x, y, z); g.rotation.y = ry; g.scale.setScalar(scale || 1); parent.add(g);
    const arm = mat('lampArm', { color: 0x2b3038, roughness: 0.4, metalness: 0.8 });
    mesh(cyl(0.14, 0.17, 0.04, 14), arm, 0, 0.02, 0, g);
    const a1 = mesh(cyl(0.028, 0.028, 0.52, 8), arm, 0, 0.28, 0, g); a1.rotation.z = 0.22;
    const a2 = mesh(cyl(0.026, 0.026, 0.44, 8), arm, 0.16, 0.6, 0, g); a2.rotation.z = -0.85;
    const shade = mesh(geo('shade', () => new T.ConeGeometry(0.17, 0.2, 16, 1, true)),
      mat('shade', { color: 0x3a4048, roughness: 0.5, metalness: 0.6, side: T.DoubleSide }), 0.34, 0.72, 0, g);
    shade.rotation.z = 0.62;
    const bulb = mesh(geo('bulb', () => new T.SphereGeometry(0.06, 10, 8)),
      mat('bulb' + col, { color: 0xfff4e0, emissive: col, emissiveIntensity: 4.5 }, 'basic'), 0.38, 0.66, 0, g);
    lampFlicker.push({ m: bulb.material, base: 4.5, seed: Math.random() * 9 });
    const cone = mesh(geo('deskCone', () => new T.ConeGeometry(0.55, 0.72, 16, 1, true)),
      mat('deskConeM', { color: col, transparent: true, opacity: 0.028, blending: T.AdditiveBlending, depthWrite: false, side: T.DoubleSide }, 'basic'),
      0.42, 0.3, 0, g);
    cone.renderOrder = 2;
    const pool = mesh(geo('plane1'), mat('deskPool' + col, { map: texGlow(), color: col, transparent: true, opacity: 0.55, blending: T.AdditiveBlending, depthWrite: false }, 'basic'),
      0.44, 0.012, 0, g);
    pool.scale.set(1.5, 1.2, 1); pool.rotation.x = -Math.PI / 2;
    return g;
  }

  function bookStack(parent, x, y, z, col, n, w, d) {
    const g = new T.Group(); g.position.set(x, y, z); parent.add(g);
    const books = [];
    for (let i = 0; i < n; i++) {
      const th = 0.045 + Math.random() * 0.035;
      const m = mesh(box(1, 1, 1), mat('book' + col + (i % 3), {
        color: new T.Color(col).multiplyScalar(0.32 + (i % 3) * 0.12), roughness: 0.82
      }), (Math.random() - 0.5) * 0.05, 0, (Math.random() - 0.5) * 0.05, g);
      m.scale.set(w * (0.9 + Math.random() * 0.16), th, d * (0.9 + Math.random() * 0.14));
      m.rotation.y = (Math.random() - 0.5) * 0.24;
      m.position.y = i * 0.062 + th / 2;
      m.castShadow = true;
      books.push(m);
    }
    return { group: g, books };
  }

  function figure(parent, x, z, ry, col) {
    const g = new T.Group(); g.position.set(x, 0, z); g.rotation.y = ry; parent.add(g);
    const skin = mat('skin', { color: 0x6b5344, roughness: 0.85 });
    const cloth = mat('cloth' + col, { color: col, roughness: 0.9 });
    const body = mesh(geo('body', () => new T.CapsuleGeometry ? new T.CapsuleGeometry(0.22, 0.42, 4, 10) : new T.CylinderGeometry(0.22, 0.26, 0.7, 10)), cloth, 0, 1.02, 0, g);
    body.rotation.x = 0.28;
    const head = mesh(geo('head', () => new T.SphereGeometry(0.15, 12, 10)), skin, 0, 1.36, 0.13, g);
    mesh(geo('hair', () => new T.SphereGeometry(0.158, 12, 10, 0, 6.3, 0, 1.5)), mat('hair', { color: 0x14100e, roughness: 1 }), 0, 1.38, 0.12, g);
    [-0.2, 0.2].forEach((sx) => {
      const a = mesh(cyl(0.06, 0.055, 0.46, 8), cloth, sx, 0.86, 0.24, g);
      a.rotation.x = 1.15;
    });
    figures.push({ g, head, body, seed: Math.random() * 9 });
    return g;
  }

  /* ---------- 宿舍 ---------- */
  function buildDorm() {
    const g = shell({ cx: -22, cz: -2, w: 14, d: 16, h: 3.4, front: 'e', doorW: 5, key: 'dorm', floor: 'wood', tint: 0x6a706e, spillDir: 1, solid: true });
    const wood = mat('deskWood', { color: 0x6b5136, roughness: 0.55, metalness: 0.06 });
    const metal = mat('pole', { color: 0x22262f, roughness: 0.5, metalness: 0.8 });

    // 长书桌靠西墙
    const desk = mesh(box(0.86, 0.06, 8.4), wood, -4.6, 0.75, -1, g);
    desk.castShadow = true; desk.receiveShadow = true;
    [-4.9, -4.3].forEach((sx) => [-4.8, 2.8].forEach((sz) => mesh(box(0.07, 0.75, 0.07), metal, sx, 0.375, sz, g)));
    solid(-26.6, -3, 0.55, 4.4);
    mesh(box(0.7, 0.34, 2.2), mat('drawer', { color: 0x4a3826, roughness: 0.7 }), -4.6, 0.55, 1.6, g);

    // 笔记本电脑
    const lap = new T.Group(); lap.position.set(-4.55, 0.78, -0.6); lap.rotation.y = Math.PI / 2; g.add(lap);
    mesh(box(0.62, 0.02, 0.42), mat('lapBody', { color: 0x2a2f38, roughness: 0.35, metalness: 0.8 }), 0, 0.01, 0, lap);
    mesh(box(0.56, 0.005, 0.24), mat('keys', { color: 0x14181f, roughness: 0.8 }), 0, 0.025, 0.05, lap);
    const lid = new T.Group(); lid.position.set(0, 0.02, -0.2); lid.rotation.x = -1.22; lap.add(lid);
    mesh(box(0.62, 0.4, 0.015), mat('lapBody'), 0, 0.2, 0, lid);
    screenTex = texScreen();
    const scr = mesh(geo('plane1'), mat('screenM', { map: screenTex, emissive: 0xffffff, emissiveMap: screenTex, emissiveIntensity: 1.5, color: 0x000000, roughness: 0.3 }), 0, 0.2, 0.011, lid);
    scr.scale.set(0.56, 0.34, 1);
    const scrGlow = mesh(geo('plane1'), mat('scrGlow', { map: texGlow(), color: 0x35d6f5, transparent: true, opacity: 0.3, blending: T.AdditiveBlending, depthWrite: false }, 'basic'), 0, 0.2, 0.06, lid);
    scrGlow.scale.set(1.5, 1.2, 1);

    // 台灯（唯一真实点光源之一）
    deskLamp(g, -4.7, 0.78, -3.4, 0.1, 0xffb066, 1.25);
    dormLamp = new T.PointLight(0xffa858, 2.6, 8, 2);
    dormLamp.position.set(-26.3, 1.42, -5.4);
    scene.add(dormLamp);

    // 三科书堆：掌握度决定高度，冷落的课会暗下去
    const cols = [PAL.amber, PAL.cyan, PAL.magenta];
    [-2.4, -1.8, -1.2].forEach((z, i) => {
      const st = bookStack(g, -4.62, 0.78, z, cols[i], 9, 0.34, 0.26);
      const tag = mesh(geo('plane1'), mat('tagM' + i, {
        map: texSticky(['#ffd34d', '#7fe4ff', '#ff9ac6'][i]), color: 0xffffff, roughness: 0.9,
        emissive: cols[i], emissiveIntensity: 0.12
      }), -4.16, 0.79, z, g);
      tag.scale.set(0.2, 0.2, 1); tag.rotation.x = -Math.PI / 2;
      courseStacks.push({ group: st.group, books: st.books, tag, col: cols[i], where: 'dorm' });
    });

    // 杯子、易拉罐、纸、手机
    mesh(cyl(0.075, 0.065, 0.16, 14), mat('mug', { color: 0xd8d2c4, roughness: 0.5 }), -4.4, 0.86, -2.5, g);
    mesh(geo('coffee', () => new T.CircleGeometry(0.065, 14)), mat('coffee', { color: 0x2a1608, roughness: 0.2 }), -4.4, 0.935, -2.5, g).rotation.x = -Math.PI / 2;
    const canMat = mat('can', { color: 0xb6f03c, roughness: 0.25, metalness: 0.85 });
    [[-4.35, -0.55], [-4.5, 2.6], [-4.3, 2.85]].forEach((p, i) => {
      const c = mesh(cyl(0.05, 0.05, 0.14, 12), i === 2 ? mat('can2', { color: 0xff3d8b, roughness: 0.25, metalness: 0.85 }) : canMat, p[0], 0.85, p[1], g);
      if (i === 2) { c.rotation.z = Math.PI / 2; c.position.y = 0.83; }
    });
    const paperMat = mat('paperM', { map: texPaper(), roughness: 0.92, side: T.DoubleSide });
    for (let i = 0; i < 9; i++) {
      const q = mesh(geo('plane1'), paperMat, -4.5 + (Math.random() - 0.5) * 0.5, 0.786 + i * 0.001, -2 + Math.random() * 5, g);
      q.scale.set(0.28, 0.38, 1); q.rotation.x = -Math.PI / 2; q.rotation.z = Math.random() * 6.28;
    }
    const phone = mesh(box(0.075, 0.012, 0.16), mat('phoneM', { color: 0x0a0d14, emissive: 0x35d6f5, emissiveIntensity: 1.1, roughness: 0.2 }), -4.3, 0.79, -1.9, g);
    phone.rotation.y = 0.4;
    lampFlicker.push({ m: phone.material, base: 1.1, seed: 5.5 });
    mesh(cyl(0.055, 0.05, 0.13, 12), mat('pencilCup', { color: 0x39424f, roughness: 0.6 }), -4.75, 0.845, 0.4, g);
    for (let i = 0; i < 6; i++) {
      const p = mesh(cyl(0.008, 0.008, 0.2, 6), mat('pencil' + i, { color: [0xffb020, 0x35d6f5, 0xb6f03c, 0xff3d8b, 0xd8d2c4, 0x8ea3c8][i], roughness: 0.7 }), -4.75 + (Math.random() - 0.5) * 0.05, 0.95, 0.4 + (Math.random() - 0.5) * 0.05, g);
      p.rotation.set((Math.random() - 0.5) * 0.3, 0, (Math.random() - 0.5) * 0.3);
    }

    // 椅子：木条靠背，一眼能认出是椅子而不是纸箱
    const chair = new T.Group(); chair.position.set(-3.75, 0, -0.2); chair.rotation.y = -1.15; g.add(chair);
    const chairWood = mat('chairWood', { color: 0x2a1c12, roughness: 0.8 });
    mesh(box(0.44, 0.045, 0.42), chairWood, 0, 0.45, 0, chair);
    [[-0.19, -0.18], [0.19, -0.18], [-0.19, 0.18], [0.19, 0.18]].forEach(([lx, lz]) => mesh(box(0.04, 0.45, 0.04), chairWood, lx, 0.225, lz, chair));
    [-0.19, 0.19].forEach((lx) => mesh(box(0.04, 0.52, 0.04), chairWood, lx, 0.71, -0.19, chair));
    for (let i = 0; i < 3; i++) mesh(box(0.42, 0.075, 0.03), chairWood, 0, 0.62 + i * 0.14, -0.19, chair);

    // 床
    const bed = new T.Group(); bed.position.set(1.4, 0, 5.2); g.add(bed);
    mesh(box(2.0, 0.34, 1.0), mat('bedFrame', { color: 0x3a3f4a, roughness: 0.6, metalness: 0.4 }), 0, 0.17, 0, bed);
    mesh(box(1.94, 0.18, 0.94), mat('mattress', { color: 0xd6d0c2, roughness: 0.95 }), 0, 0.43, 0, bed);
    const quilt = mesh(box(1.3, 0.16, 0.92), mat('quilt', { color: 0x2f4a6b, roughness: 0.98 }), 0.3, 0.55, 0, bed);
    quilt.rotation.z = 0.03;
    mesh(box(0.44, 0.13, 0.6), mat('pillow', { color: 0xe8e4d8, roughness: 1 }), -0.7, 0.58, 0, bed);
    solid(-20.6, 3.2, 1.1, 0.7);

    // 书架
    const shelf = new T.Group(); shelf.position.set(6.4, 0, -5.4); g.add(shelf);
    const shMat = mat('shelfM', { color: 0x4a3826, roughness: 0.75 });
    for (let i = 0; i < 4; i++) mesh(box(0.36, 0.05, 2.4), shMat, 0, 0.4 + i * 0.62, 0, shelf);
    [-1.2, 1.2].forEach((sz) => mesh(box(0.36, 2.4, 0.05), shMat, 0, 1.2, sz, shelf));
    const bk = box(1, 1, 1);
    for (let r = 0; r < 3; r++) {
      let z = -1.1;
      while (z < 1.05) {
        const th = 0.05 + Math.random() * 0.06, hh = 0.3 + Math.random() * 0.16;
        const c = [0x8a3b3b, 0x2f5a7a, 0x3f6b3a, 0x7a6a2f, 0x5a3a6b, 0x2a2f38][Math.floor(Math.random() * 6)];
        const m = mesh(bk, mat('shelfBook' + c, { color: c, roughness: 0.85 }), 0, 0.43 + r * 0.62 + hh / 2, z, shelf);
        m.scale.set(0.26, hh, th); z += th + 0.012;
      }
    }
    solid(-15.6, -7.4, 0.3, 1.3);

    // 北墙那扇窗：外面是冷蓝的夜，里面是暖黄的灯
    const WX = -5.0, WY = 1.98, WZ = -7.84;
    const pane = mesh(geo('plane1'), mat('nightPane', { map: texNightWindow(), color: 0xffffff }, 'basic'), WX, WY, WZ, g);
    pane.scale.set(2.9, 1.72, 1);
    winPane = pane.material;
    const wf = mat('winFrame', { color: 0x14181f, roughness: 0.5, metalness: 0.6 });
    mesh(box(3.16, 0.1, 0.14), wf, WX, WY + 0.9, WZ + 0.04, g);
    mesh(box(3.16, 0.1, 0.14), wf, WX, WY - 0.9, WZ + 0.04, g);
    [-1.53, 1.53].forEach((sx) => mesh(box(0.1, 1.9, 0.14), wf, WX + sx, WY, WZ + 0.04, g));
    mesh(box(0.07, 1.78, 0.1), wf, WX, WY, WZ + 0.05, g);
    mesh(box(3.3, 0.09, 0.34), mat('sill', { color: 0x5a5f66, roughness: 0.7 }), WX, WY - 0.98, WZ + 0.16, g);
    const curt = mat('curtain', { color: 0x3c4a63, roughness: 0.98, side: T.DoubleSide });
    [-1, 1].forEach((k) => {
      for (let i = 0; i < 4; i++) {
        const c = mesh(box(0.16, 2.1, 0.05), curt, WX + k * (1.62 + i * 0.13), WY + 0.06, WZ + 0.2 + (i % 2) * 0.05, g);
        c.rotation.y = k * 0.12;
      }
    });
    mesh(cyl(0.025, 0.025, 3.9, 8), wf, WX, WY + 1.12, WZ + 0.22, g).rotation.z = Math.PI / 2;
    const radiator = mat('radiator', { color: 0x6e747c, roughness: 0.6, metalness: 0.5 });
    for (let i = 0; i < 9; i++) mesh(box(0.09, 0.52, 0.12), radiator, WX - 0.9 + i * 0.22, 0.42, WZ + 0.14, g);
    // 窗台上的东西
    mesh(cyl(0.07, 0.06, 0.13, 12), mat('potM', { color: 0x8a5a3c, roughness: 0.9 }), WX - 1.1, WY - 0.87, WZ + 0.16, g);
    mesh(geo('plant', () => new T.IcosahedronGeometry(0.13, 0)), mat('plantM', { color: 0x3f6b3a, roughness: 1, flatShading: true }), WX - 1.1, WY - 0.72, WZ + 0.16, g);
    mesh(box(0.2, 0.26, 0.02), mat('photoM', { color: 0xd8d2c4, roughness: 0.9 }), WX + 1.0, WY - 0.8, WZ + 0.18, g).rotation.y = -0.3;

    const winGlow = mesh(geo('plane1'), mat('winGlow', { map: texGlow(), color: 0x9dc0ff, transparent: true, opacity: 0.34, blending: T.AdditiveBlending, depthWrite: false }, 'basic'), WX, WY, WZ + 0.3, g);
    winGlow.scale.set(5.2, 3.2, 1);
    const shaft = mesh(geo('plane1'), mat('shaft', { map: texGlow(), color: 0x9dc0ff, transparent: true, opacity: 0.1, blending: T.AdditiveBlending, depthWrite: false, side: T.DoubleSide }, 'basic'), WX - 0.4, 1.3, WZ + 2.2, g);
    shaft.scale.set(4.4, 4.0, 1); shaft.rotation.set(-0.62, 0.18, 0.1);
    const coldPool = mesh(geo('plane1'), mat('coldPool', { map: texGlow(), color: 0x7fa8ff, transparent: true, opacity: 0.3, blending: T.AdditiveBlending, depthWrite: false }, 'basic'), WX - 0.6, 0.05, WZ + 2.4, g);
    coldPool.scale.set(6.4, 4.6, 1); coldPool.rotation.x = -Math.PI / 2;
    moonPool = coldPool.material; winMat = winGlow.material; winShaft = shaft.material;

    // 倒计时海报 + 便利贴墙
    posterTex = texPoster(1);
    const poster = mesh(geo('plane1'), mat('posterM', { map: posterTex, roughness: 0.95 }), -6.86, 1.95, -5.9, g);
    poster.scale.set(0.86, 1.15, 1); poster.rotation.y = Math.PI / 2;
    for (let i = 0; i < 12; i++) {
      const c = ['#ffd34d', '#7fe4ff', '#ff9ac6', '#c8f56a'][i % 4];
      const q = mesh(geo('plane1'), mat('stickyW' + c, { map: texSticky(c), roughness: 0.95 }),
        -6.86, 1.3 + Math.random() * 1.5, -6.6 + Math.random() * 4.6, g);
      q.scale.set(0.22, 0.22, 1); q.rotation.y = Math.PI / 2; q.rotation.z = (Math.random() - 0.5) * 0.3;
    }

    // 地面杂物
    mesh(box(0.4, 0.46, 0.28), mat('bag', { color: 0x3a4666, roughness: 0.9 }), -2.6, 0.23, 0.9, g).rotation.y = 0.4;
    mesh(box(0.28, 0.12, 0.18), mat('bagPocket', { color: 0x4a5878, roughness: 0.9 }), -2.6, 0.28, 1.07, g).rotation.y = 0.4;
    const boxMat = mat('takeout', { color: 0xc9b79a, roughness: 0.9 });
    [[-2.8, -5.0], [-3.2, -4.2], [-3.0, 4.2]].forEach((p, i) => {
      const b = mesh(box(0.3, 0.16, 0.3), boxMat, p[0], 0.08 + (i === 1 ? 0.16 : 0), p[1], g);
      b.rotation.y = Math.random();
    });
    [[-2.2, -0.4, 0.35], [-1.9, -0.1, 0.12]].forEach(([x, z, ry]) => {
      const s = new T.Group(); s.position.set(x, 0, z); s.rotation.y = ry; g.add(s);
      mesh(box(0.26, 0.035, 0.11), mat('slipperSole', { color: 0x241a16, roughness: 0.95 }), 0, 0.02, 0, s);
      mesh(box(0.09, 0.05, 0.115), mat('slipperStrap', { color: 0x3a2a22, roughness: 0.95 }), 0.05, 0.055, 0, s);
    });

    ceilingPanel(g, 0, -1, 1.5, 0.22, 0xfff0d8, 0.55, 'dorm');
    lampFlicker[lampFlicker.length - 1].ceil = true;

    // 前景：纸箱、垃圾桶、地上一摞书，把空地板填成有人住的样子
    const basket = mesh(cyl(0.26, 0.22, 0.36, 14), mat('basketM', { color: 0x33454f, roughness: 0.9 }), 2.6, 0.18, 4.6, g);
    basket.rotation.y = 0.3;
    const clothCols = [0x6b7280, 0x8a6f7d, 0x4f6b5e];
    clothCols.forEach((c, i) => {
      const f = mesh(box(0.34 - i * 0.04, 0.07, 0.26 - i * 0.03), mat('cloth' + c, { color: c, roughness: 1 }),
        2.6 + (i - 1) * 0.03, 0.38 + i * 0.07, 4.6 + (i - 1) * 0.02, g);
      f.rotation.y = 0.3 + (i - 1) * 0.22;
    });
    const carton = mesh(box(0.62, 0.5, 0.5), mat('cartonM', { color: 0x5e462c, roughness: 0.98 }), -3.6, 0.25, -6.0, g);
    carton.rotation.y = -0.24;
    mesh(box(0.58, 0.02, 0.46), mat('cartonM'), -3.6, 0.51, -6.0, g).rotation.y = -0.24;
    mesh(cyl(0.2, 0.17, 0.42, 12), mat('binM', { color: 0x2b3038, roughness: 0.7 }), -2.9, 0.21, 1.6, g);
    for (let i = 0; i < 4; i++) {
      const q = mesh(geo('plane1'), mat('paperM', { map: texPaper(), roughness: 0.92, side: T.DoubleSide }), -2.9 + (Math.random() - 0.5) * 0.6, 0.02 + i * 0.004, 1.6 + (Math.random() - 0.5) * 0.6, g);
      q.scale.set(0.2, 0.26, 1); q.rotation.x = -Math.PI / 2; q.rotation.z = Math.random() * 6.28;
    }
    bookStack(g, -2.4, 0.05, -1.0, 0x8a3b3b, 6, 0.3, 0.24);
    // 地毯用无高光的 phong：standard 在掠射角会把台灯反射成一块灰板
    const rug = mesh(geo('plane1'), mat('rugM', { map: texRug(), color: 0xffffff, specular: 0x000000, shininess: 0 }, 'phong'), -2.9, 0.045, -1.5, g);
    rug.scale.set(2.2, 1.7, 1); rug.rotation.x = -Math.PI / 2; rug.rotation.z = 0.06;

    // 晾衣绳：宿舍天花板上永远挂着没干的衣服
    const line = mesh(cyl(0.012, 0.012, 4.6, 6), mat('clothLine', { color: 0x8a8f96, roughness: 0.9 }), -2.9, 2.62, -1.0, g);
    line.rotation.z = Math.PI / 2;
    [[-4.4, 0x4f6b5e, 0.5], [-3.2, 0x6b7280, 0.62], [-2.0, 0x8a6f7d, 0.44]].forEach(([x, c, w], i) => {
      const shirt = mesh(box(w, 0.54, 0.05), mat('hang' + c, { color: c, emissive: c, emissiveIntensity: 0.22, roughness: 1, side: T.DoubleSide }), x, 2.30, -1.0 + (i - 1) * 0.06, g);
      shirt.rotation.y = (i - 1) * 0.16; shirt.rotation.z = (i - 1) * 0.04;
      // 两只袖子：没有袖子的话晾着的只是一张纸
      [-1, 1].forEach((k) => {
        const sl = mesh(box(0.13, 0.22, 0.045), mat('hang' + c), x + k * (w / 2 + 0.04), 2.44, -1.0 + (i - 1) * 0.06, g);
        sl.rotation.y = (i - 1) * 0.16; sl.rotation.z = k * 0.55 + (i - 1) * 0.04;
      });
      mesh(box(0.03, 0.07, 0.03), mat('peg', { color: 0xc9a227, roughness: 0.8 }), x - w * 0.32, 2.6, -1.0 + (i - 1) * 0.06, g);
      mesh(box(0.03, 0.07, 0.03), mat('peg'), x + w * 0.32, 2.6, -1.0 + (i - 1) * 0.06, g);
    });
    return g;
  }

  /* ---------- 图书馆 ---------- */
  function buildLibrary() {
    const g = shell({ cx: 0, cz: -22, w: 24, d: 14, h: 3.6, front: 's', doorW: 6, key: 'lib', floor: 'tile', floorCol: 0x4a4f5a, tint: 0x9fa49c, spillDir: 1 });
    const wood = mat('libWood', { color: 0x6a4f34, roughness: 0.5 });
    const metal = mat('pole', { color: 0x22262f, roughness: 0.5, metalness: 0.8 });

    // 长桌两排
    [-3.2, 3.2].forEach((zz, ri) => {
      [-6.5, 0, 6.5].forEach((xx) => {
        const t = mesh(box(5.6, 0.07, 1.5), wood, xx, 0.76, zz, g);
        t.castShadow = true; t.receiveShadow = true;
        [-2.5, 2.5].forEach((sx) => [-0.6, 0.6].forEach((sz) => mesh(box(0.08, 0.76, 0.08), metal, xx + sx, 0.38, zz + sz, g)));
        solid(xx, -22 + zz, 2.9, 0.85);
        // 绿罩台灯
        [-1.8, 0, 1.8].forEach((lx) => {
          if (ri === 1 && xx === 0 && lx === 0) return;
          const lg = new T.Group(); lg.position.set(xx + lx, 0.8, zz); g.add(lg);
          mesh(cyl(0.1, 0.13, 0.03, 12), mat('brass', { color: 0x8a6a2f, roughness: 0.35, metalness: 0.9 }), 0, 0.015, 0, lg);
          mesh(cyl(0.018, 0.018, 0.3, 8), mat('brass'), 0, 0.16, 0, lg);
          const sh = mesh(geo('banker', () => new T.CylinderGeometry(0.13, 0.13, 0.34, 14, 1, true, 0, Math.PI)),
            mat('bankerM', { color: 0x1f5a3a, emissive: 0x2f7a4a, emissiveIntensity: 0.5, roughness: 0.4, side: T.DoubleSide }), 0, 0.32, 0, lg);
          sh.rotation.z = Math.PI / 2; sh.rotation.y = Math.PI / 2;
          const b = mesh(geo('bankerBulb', () => new T.SphereGeometry(0.05, 8, 6)),
            mat('bankerBulbM', { color: 0xfff2d8, emissive: 0xffcf8a, emissiveIntensity: 3.6 }, 'basic'), 0, 0.29, 0, lg);
          lampFlicker.push({ m: b.material, base: 3.6, seed: Math.random() * 9 });
          const pool = mesh(geo('plane1'), mat('libPool', { map: texGlow(), color: 0xffc27a, transparent: true, opacity: 0.45, blending: T.AdditiveBlending, depthWrite: false }, 'basic'), 0, 0.012, 0, lg);
          pool.scale.set(1.5, 1.1, 1); pool.rotation.x = -Math.PI / 2;
        });
        // 椅子与读者（玩家自己的座位留空）
        [-1.8, 0, 1.8].forEach((sx, i) => {
          [-1.05, 1.05].forEach((sz, j) => {
            const ch = mesh(box(0.42, 0.05, 0.42), mat('libChair', { color: 0x33383f, roughness: 0.8 }), xx + sx, 0.45, zz + sz, g);
            mesh(box(0.42, 0.44, 0.05), mat('libChair'), xx + sx, 0.68, zz + sz + (sz > 0 ? 0.2 : -0.2), g);
            const mine = ri === 1 && xx === 0 && sx === 0 && sz > 0;
            if (!mine && (i + j + ri) % 3 === 0) figure(g, xx + sx, zz + sz * 1.25, sz > 0 ? Math.PI : 0, [0x2f4a6b, 0x5a3a4a, 0x3a4a3a][(i + j) % 3]);
          });
        });
      });
    });

    // 玩家自己的位置：桌上三科书堆
    const cols = [PAL.amber, PAL.cyan, PAL.magenta];
    [-0.1, 0.42, 0.94].forEach((x, i) => {
      const st = bookStack(g, x, 0.8, 2.85, cols[i], 8, 0.3, 0.22);
      courseStacks.push({ group: st.group, books: st.books, tag: null, col: cols[i], where: 'lib' });
    });
    const nb = mesh(geo('plane1'), mat('paperM', { map: texPaper(), roughness: 0.92, side: T.DoubleSide }), -0.42, 0.805, 3.45, g);
    nb.scale.set(0.34, 0.46, 1); nb.rotation.x = -Math.PI / 2; nb.rotation.z = 0.1;
    deskLamp(g, -1.05, 0.8, 2.9, 0.4, 0xffb066, 1.0);

    // 书架墙
    const shMat = mat('libShelf', { color: 0x3d2f20, roughness: 0.8 });
    const bookGeo = box(1, 1, 1);
    const palette = [0x8a3b3b, 0x2f5a7a, 0x3f6b3a, 0x7a6a2f, 0x5a3a6b, 0x2a2f38, 0x7a4a2f, 0x4a6b6b];
    const dummy = new T.Object3D();
    const rows = 5, per = 150;
    const inst = new T.InstancedMesh(bookGeo, mat('libBooks', { color: 0xffffff, roughness: 0.85 }), rows * per);
    inst.instanceMatrix.setUsage(T.StaticDrawUsage);
    let n = 0;
    for (let r = 0; r < rows; r++) {
      let x = -11.4;
      for (let i = 0; i < per; i++) {
        const th = 0.055 + Math.random() * 0.07;
        if (x > 11.4) break;
        const hh = 0.34 + Math.random() * 0.18;
        dummy.position.set(x + th / 2, 0.5 + r * 0.62 + hh / 2, -6.6);
        dummy.scale.set(th, hh, 0.28);
        dummy.rotation.set(0, 0, Math.random() < 0.05 ? 0.14 : 0);
        dummy.updateMatrix();
        inst.setMatrixAt(n, dummy.matrix);
        inst.setColorAt(n, new T.Color(palette[Math.floor(Math.random() * palette.length)]));
        n++; x += th + 0.008;
      }
    }
    inst.count = n;
    inst.castShadow = false;
    g.add(inst);
    for (let r = 0; r <= rows; r++) mesh(box(23.4, 0.06, 0.4), shMat, 0, 0.46 + r * 0.62, -6.6, g);
    solid(0, -28.6, 11.8, 0.35);

    libLamp = new T.PointLight(0xffc27a, 2.0, 20, 2);
    libLamp.position.set(0, 2.1, -22);
    scene.add(libLamp);
    for (let i = -2; i <= 2; i++) ceilingPanel(g, i * 4.6, -1, 2.6, 0.3, 0xfff4e2, 0.9, 'lib');
    return g;
  }

  /* ---------- 教学楼 / 考场 ---------- */
  function buildClassroom() {
    const g = shell({ cx: 22, cz: 0, w: 14, d: 20, h: 3.6, front: 'w', doorW: 6, key: 'cls', floor: 'tile', floorCol: 0x565b64, tint: 0xa2a6a0, spillDir: -1 });
    const wood = mat('clsWood', { color: 0x8a7050, roughness: 0.55 });
    const metal = mat('pole', { color: 0x22262f, roughness: 0.5, metalness: 0.8 });
    const paperMat = mat('paperM', { map: texPaper(), roughness: 0.92, side: T.DoubleSide });

    for (let r = 0; r < 4; r++) {
      for (let c = 0; c < 4; c++) {
        const x = -3.4 + c * 2.3, z = -6.6 + r * 3.4;
        const t = mesh(box(1.5, 0.05, 0.7), wood, x, 0.74, z, g);
        t.castShadow = true; t.receiveShadow = true;
        [-0.65, 0.65].forEach((sx) => mesh(box(0.06, 0.74, 0.06), metal, x + sx, 0.37, z, g));
        mesh(box(0.44, 0.05, 0.44), mat('clsChair', { color: 0x2f3644, roughness: 0.8 }), x, 0.44, z + 0.75, g);
        mesh(box(0.44, 0.42, 0.05), mat('clsChair'), x, 0.66, z + 0.95, g);
        const q = mesh(geo('plane1'), paperMat, x - 0.1, 0.772, z, g);
        q.scale.set(0.3, 0.42, 1); q.rotation.x = -Math.PI / 2; q.rotation.z = (Math.random() - 0.5) * 0.2;
        solid(22 + x, z, 0.76, 0.36);
        if ((r + c) % 3 === 1) figure(g, x, z + 0.95, Math.PI, [0x2f4a6b, 0x4a3a5a, 0x3a4a3a][(r + c) % 3]);
      }
    }
    // 讲台与黑板
    mesh(box(0.9, 0.95, 2.0), mat('podium', { color: 0x4a3826, roughness: 0.7 }), 5.6, 0.475, 0, g);
    solid(27.6, 0, 0.55, 1.1);
    boardTex = texBoard(['期末考试 · 闭卷', '不得携带任何资料', '考试时间 120 分钟', '姓名 / 学号 写在左上角']);
    const board = mesh(geo('plane1'), mat('boardM', { map: boardTex, roughness: 0.95 }), 6.82, 1.95, 0, g);
    board.scale.set(7.6, 3.0, 1); board.rotation.y = -Math.PI / 2;
    mesh(box(0.12, 0.1, 8.0), mat('chalkTray', { color: 0x3a3f48, roughness: 0.7 }), 6.76, 0.42, 0, g);
    // 挂钟
    const ck = new T.Group(); ck.position.set(6.78, 3.0, -6.5); ck.rotation.y = -Math.PI / 2; g.add(ck);
    mesh(geo('clockFace', () => new T.CircleGeometry(0.3, 24)), mat('clockFace', { color: 0xe8e4d8, roughness: 0.6 }), 0, 0, 0, ck);
    mesh(geo('clockRim', () => new T.TorusGeometry(0.3, 0.03, 6, 24)), mat('pole', { color: 0x22262f, roughness: 0.5, metalness: 0.8 }), 0, 0, 0, ck);
    clockHand = mesh(box(0.02, 0.22, 0.01), mat('hand', { color: 0x1a1a1a }, 'basic'), 0, 0.1, 0.01, ck);

    examLampA = new T.PointLight(0xf2f6ff, 0, 22, 2); examLampA.position.set(20, 3.0, -4); scene.add(examLampA);
    examLampB = new T.PointLight(0xf2f6ff, 0, 22, 2); examLampB.position.set(24, 3.0, 5); scene.add(examLampB);
    for (let i = -2; i <= 2; i++) ceilingPanel(g, 0, i * 3.8, 8.0, 0.34, 0xf6f9ff, 0.7, 'cls');
    return g;
  }

  /* ---------- 食堂 ---------- */
  function buildCanteen() {
    const g = shell({ cx: 0, cz: 22, w: 20, d: 12, h: 3.4, front: 'n', doorW: 6, key: 'can', floor: 'tile', floorCol: 0x4e535c, tint: 0x9c9a92, spillDir: -1 });
    const steel = mat('steel', { color: 0x8a9099, roughness: 0.28, metalness: 0.9 });
    // 打饭台
    const counter = mesh(box(15, 1.05, 1.1), steel, 0, 0.525, 4.4, g);
    counter.castShadow = true; counter.receiveShadow = true;
    solid(0, 26.4, 7.6, 0.7);
    mesh(box(15, 0.08, 1.3), mat('counterTop', { color: 0xc8ccd2, roughness: 0.2, metalness: 0.7 }), 0, 1.09, 4.4, g);
    const heat = mat('heatLamp', { color: 0xffd9a0, emissive: 0xff9a3c, emissiveIntensity: 3.2 }, 'basic');
    for (let i = -3; i <= 3; i++) {
      const l = mesh(cyl(0.09, 0.13, 0.16, 12), heat, i * 2, 2.3, 4.4, g);
      lampFlicker.push({ m: l.material, base: 3.2, seed: Math.random() * 9, shared: true });
      mesh(cyl(0.015, 0.015, 0.9, 6), steel, i * 2, 2.8, 4.4, g);
      const pool = mesh(geo('plane1'), mat('canPool', { map: texGlow(), color: 0xff9a3c, transparent: true, opacity: 0.4, blending: T.AdditiveBlending, depthWrite: false }, 'basic'), i * 2, 1.14, 4.4, g);
      pool.scale.set(1.8, 1.4, 1); pool.rotation.x = -Math.PI / 2;
      mesh(box(0.9, 0.12, 0.6), mat('tray', { color: 0x6a7078, roughness: 0.4, metalness: 0.6 }), i * 2, 1.16, 4.4, g);
    }
    const menu = mesh(geo('plane1'), mat('menuM', { map: texMenu(), emissive: 0xffffff, emissiveMap: texMenu(), emissiveIntensity: 1.3, color: 0x111111, roughness: 0.6 }), 0, 2.55, 5.72, g);
    menu.scale.set(6, 3, 1); menu.rotation.y = Math.PI;

    // 圆桌
    const tbl = mat('canTable', { color: 0xd8d2c4, roughness: 0.45 });
    [[-6, -1.5], [-2, -2.6], [2, -1.5], [6, -2.6], [-4, 1.4], [4, 1.4]].forEach((p, i) => {
      mesh(cyl(0.85, 0.85, 0.06, 20), tbl, p[0], 0.75, p[1], g);
      mesh(cyl(0.08, 0.14, 0.75, 10), steel, p[0], 0.375, p[1], g);
      solid(p[0], 22 + p[1], 0.9, 0.9);
      for (let k = 0; k < 3; k++) {
        const a = k / 3 * 6.28 + i;
        mesh(cyl(0.22, 0.2, 0.45, 12), mat('stool', { color: [0xff3d8b, 0x35d6f5, 0xffb020][k], roughness: 0.7 }), p[0] + Math.sin(a) * 1.25, 0.225, p[1] + Math.cos(a) * 1.25, g);
      }
      if (i % 2 === 0) figure(g, p[0] + 0.9, p[1] + 0.9, -2.2, 0x3a4a5a);
    });

    // 自动贩卖机
    [-8.4, -7.0].forEach((x, i) => {
      const vm = new T.Group(); vm.position.set(x, 0, 3.2); g.add(vm);
      mesh(box(1.2, 2.0, 0.7), mat('vendBody', { color: 0x1a2030, roughness: 0.4, metalness: 0.5 }), 0, 1.0, 0, vm);
      const face = mesh(geo('plane1'), mat('vendFace' + i, {
        color: 0x0a1420, emissive: i ? 0xff3d8b : 0x35d6f5, emissiveIntensity: 1.6, roughness: 0.2
      }), 0, 1.2, -0.36, vm);
      face.scale.set(1.0, 1.4, 1); face.rotation.y = Math.PI;
      lampFlicker.push({ m: face.material, base: 1.6, seed: i * 3.3 });
      solid(x, 25.2, 0.7, 0.5);
    });

    // 蒸汽
    const n = mobile ? 40 : 90;
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 14;
      pos[i * 3 + 1] = 1.2 + Math.random() * 1.6;
      pos[i * 3 + 2] = 26.4 + (Math.random() - 0.5) * 0.8;
    }
    const sg = new T.BufferGeometry(); sg.setAttribute('position', new T.BufferAttribute(pos, 3));
    steam = new T.Points(sg, new T.PointsMaterial({
      map: texGlow(), color: 0xffd9a0, size: 0.5, transparent: true, opacity: 0.16,
      blending: T.AdditiveBlending, depthWrite: false, sizeAttenuation: true
    }));
    scene.add(steam);

    for (let i = -1; i <= 1; i++) ceilingPanel(g, i * 6, -1, 3.4, 0.3, 0xffe9c8, 0.8, 'can');
    const cl = new T.PointLight(0xffd6a5, 1.5, 18, 2); cl.position.set(0, 2.4, 24); scene.add(cl);
    campusLights.push({ light: cl, day: 0.65, night: 1.65 });
    const entryLight = new T.PointLight(0xffddb6, 1, 11, 2); entryLight.position.set(0, 2.7, 18); scene.add(entryLight);
    campusLights.push({ light: entryLight, day: 0.55, night: 1.35 });
    return g;
  }

  /* ---------- 打印店 ---------- */
  function buildPrint() {
    const g = shell({ cx: -11, cz: 12, w: 6, d: 5, h: 2.9, front: 'n', doorW: 3, key: 'prt', floor: 'tile', floorCol: 0x454a54, tint: 0x8e9096, spillDir: -1 });
    const steel = mat('steel', { color: 0x8a9099, roughness: 0.28, metalness: 0.9 });
    mesh(box(4.4, 0.95, 0.7), mat('prtCounter', { color: 0x3a3f48, roughness: 0.6 }), 0, 0.475, 1.6, g);
    mesh(box(4.5, 0.05, 0.78), mat('prtTop', { color: 0x565c66, roughness: 0.35, metalness: 0.3 }), 0, 0.975, 1.6, g);
    solid(-11, 13.6, 2.3, 0.45);

    // 复印机：盖板、操作屏、出纸口，扫描条来回走
    const cop = new T.Group(); cop.position.set(-1.2, 0.99, 1.6); g.add(cop);
    mesh(box(1.1, 0.72, 0.8), mat('copier', { color: 0xb9b4a8, roughness: 0.55 }), 0, 0.36, 0, cop);
    mesh(box(1.14, 0.07, 0.84), mat('copierLid', { color: 0x33383f, roughness: 0.4, metalness: 0.4 }), 0, 0.755, 0, cop);
    mesh(box(0.72, 0.03, 0.3), mat('copierTray', { color: 0x2a2f36, roughness: 0.6 }), 0, 0.2, -0.5, cop);
    for (let i = 0; i < 3; i++) mesh(box(0.28, 0.006, 0.2), mat('prtPaper', { color: 0xe8e4d8, roughness: 0.95 }), 0.02 * i, 0.222 + i * 0.007, -0.56 - i * 0.03, cop).rotation.y = (i - 1) * 0.08;
    const panel = mesh(box(0.36, 0.22, 0.05), mat('copierPanel', { color: 0x1b2028, roughness: 0.4 }), 0.34, 0.6, -0.42, cop);
    panel.rotation.x = -0.35;
    mesh(geo('plane1'), mat('copierScr', { color: 0x0a1418, emissive: 0x35d6f5, emissiveIntensity: 1.6, roughness: 0.3 }), 0.34, 0.615, -0.448, cop).scale.set(0.28, 0.13, 1);
    for (let i = 0; i < 4; i++) mesh(box(0.05, 0.05, 0.02), mat('copierKey', { color: 0x4a525c, roughness: 0.7 }), 0.22 + i * 0.08, 0.47, -0.41, cop);
    for (let i = 0; i < 5; i++) mesh(box(0.02, 0.3, 0.02), mat('copierVent', { color: 0x6a6f76, roughness: 0.8 }), -0.5, 0.4, -0.3 + i * 0.14, cop);
    copierBar = mesh(box(0.9, 0.03, 0.06), mat('copierBar', { color: 0xc8ffb0, emissive: 0xb6f03c, emissiveIntensity: 3.4 }, 'basic'), -1.2, 1.62, 1.18, g);

    const stack = bookStack(g, 0.9, 1.0, 1.6, 0xe8e4d8, 8, 0.3, 0.42);
    stack.books.forEach((b) => { b.material = mat('prtPaper', { color: 0xe8e4d8, roughness: 0.95 }); });
    mesh(cyl(0.07, 0.06, 0.15, 12), mat('prtCup', { color: 0x39424f, roughness: 0.6 }), 1.7, 1.07, 1.5, g);
    mesh(box(0.22, 0.02, 0.15), mat('phoneM', { color: 0x0a0d14, emissive: 0x35d6f5, emissiveIntensity: 0.9, roughness: 0.2 }), -0.2, 1.01, 1.4, g).rotation.y = 0.5;

    // 身后墙上的纸架与价目表
    const ream = mat('ream', { color: 0xd9d4c6, roughness: 0.95 });
    [1.15, 1.62].forEach((y) => {
      mesh(box(3.4, 0.04, 0.3), mat('prtShelf', { color: 0x4a3826, roughness: 0.8 }), 0.4, y, 2.3, g);
      for (let i = 0; i < 6; i++) mesh(box(0.42, 0.24, 0.26), i % 3 === 2 ? mat('reamBlue', { color: 0x6f86a8, roughness: 0.9 }) : ream, -1.0 + i * 0.5, y + 0.14, 2.3, g);
    });
    mesh(box(0.32, 0.03, 0.12), mat('priceBase', { color: 0x2a2f36, roughness: 0.5 }), 0.35, 1.01, 1.32, g);
    const price = mesh(geo('plane1'), mat('prtPrice', { map: texPrice(), roughness: 0.9 }), 0.35, 1.22, 1.32, g);
    price.scale.set(0.3, 0.4, 1); price.rotation.y = Math.PI;

    const sign = mesh(geo('plane1'), mat('neonM', { map: texNeon(), emissive: 0xffffff, emissiveMap: texNeon(), emissiveIntensity: 2.0, color: 0x0a0710, transparent: true, roughness: 0.4 }), 0, 2.42, 2.44, g);
    sign.scale.set(4.0, 0.86, 1); sign.rotation.y = Math.PI;
    lampFlicker.push({ m: sign.material, base: 2.0, seed: 7.7 });
    const nl = new T.PointLight(0xff86b5, 0.85, 9, 2); nl.position.set(-11, 2.4, 14.0); scene.add(nl);
    campusLights.push({ light: nl, day: 0.25, night: 0.9 });
    const workLight = new T.PointLight(0xffedd4, 1, 8, 2); workLight.position.set(-11, 2.5, 10.6); scene.add(workLight);
    campusLights.push({ light: workLight, day: 0.6, night: 1.2 });
    ceilingPanel(g, 0, 0, 2.4, 0.2, 0xfff0d8, 1.0, 'prt', 2.78);
    return g;
  }

  /* ---------- 站立人物：不复用伏案 figure，也不加入人物碰撞 ---------- */
  function buildCampusCorners() {
    const stone = mat('cornerStone', { color: 0x98a7a2, roughness: 0.95 });
    const wood = mat('cornerWood', { color: 0x976e49, roughness: 0.85 });
    const iron = mat('cornerIron', { color: 0x354953, roughness: 0.65 });
    const pathMat = mat('cornerPath', { color: 0x88918c, roughness: 0.95 });
    ['court', 'garden', 'cafe'].forEach((key) => {
      const L = LOC[key], points = [ringPt(...L.door), L.door, ...(L.approach || []), L.stand];
      for (let i = 1; i < points.length; i++) {
        const a = points[i - 1], b = points[i], dx = b[0] - a[0], dz = b[1] - a[1];
        const strip = mesh(box(1.65, 0.015, Math.hypot(dx, dz)), pathMat, (a[0] + b[0]) / 2, 0.022, (a[1] + b[1]) / 2);
        strip.rotation.y = Math.atan2(dx, dz); strip.receiveShadow = true;
      }
    });
    const sign = (key, subtitle, x, z, yaw) => {
      const g = new T.Group(); g.position.set(x, 0, z); g.rotation.y = yaw; scene.add(g);
      mesh(box(0.09, 2.3, 0.09), iron, -1.15, 1.15, 0, g);
      mesh(box(0.09, 2.3, 0.09), iron, 1.15, 1.15, 0, g);
      const map = tex('cornerSign' + key, 768, 256, (c, w, h) => {
        c.fillStyle = key === 'cafe' ? '#573e32' : '#244c47'; c.fillRect(0, 0, w, h);
        c.strokeStyle = '#d9bd7b'; c.lineWidth = 8; c.strokeRect(10, 10, w - 20, h - 20);
        c.fillStyle = '#fff4da'; c.textAlign = 'center'; c.font = `700 68px ${FONT}`; c.fillText(LOC[key].name, w / 2, 112);
        c.font = `500 32px ${FONT}`; c.fillText(subtitle, w / 2, 190);
      });
      const board = mesh(geo('plane1'), mat('cornerSign' + key, { map, side: T.DoubleSide, roughness: 0.9, emissive: 0xffffff, emissiveMap: map, emissiveIntensity: 0.16 }), 0, 1.95, 0, g);
      board.scale.set(2.8, 0.94, 1);
      solid(x, z, 1.4, 0.2);
    };

    const court = mesh(box(14, 0.035, 12), mat('courtRubber', { color: 0x4b8176, roughness: 1 }), 23, 0.025, -23);
    court.receiveShadow = true;
    const paint = mat('courtPaint', { color: 0xe9e2c7, roughness: 1 });
    [-28.3, -17.7, -23].forEach((z) => mesh(box(12.5, 0.015, 0.055), paint, 23, 0.052, z));
    [16.75, 29.25].forEach((x) => mesh(box(0.055, 0.015, 10.6), paint, x, 0.052, -23));
    const center = mesh(geo('courtCircle', () => new T.RingGeometry(1.48, 1.54, 32)), paint, 23, 0.062, -23);
    center.rotation.x = -Math.PI / 2;
    [-1, 1].forEach((side) => {
      const z = -23 + side * 5;
      mesh(cyl(0.085, 0.1, 3.65, 8), iron, 23, 1.825, z);
      mesh(box(1.8, 1.05, 0.1), paint, 23, 3.25, z - side * 0.25);
      const rim = mesh(geo('basketRim', () => new T.TorusGeometry(0.25, 0.025, 6, 16)), mat('basketOrange', { color: 0xf28a43, roughness: 0.7 }), 23, 2.95, z - side * 0.58);
      rim.rotation.x = Math.PI / 2;
      mesh(cyl(0.26, 0.17, 0.4, 10), mat('basketNet', { color: 0xe5e0cb, wireframe: true }), 23, 2.72, z - side * 0.58);
      solid(23, z, 0.18, 0.18);
    });
    mesh(geo('basketball', () => new T.SphereGeometry(0.22, 16, 10)), mat('basketball', { color: 0xc77b3e, roughness: 1 }), 27, 0.27, -24.5);
    bench(30.9, -22, Math.PI / 2); streetLamp(30.5, -17);
    sign('court', '活动一下，再回去复习', 28, -16, Math.PI / 6);

    const garden = mesh(box(12, 0.025, 12), mat('gardenGrass', { color: 0x647e50, roughness: 1 }), -23, 0.025, -23);
    garden.receiveShadow = true;
    mesh(box(4, 0.035, 10), pathMat, -22, 0.043, -22.5);
    [-27.5, -18.5].forEach((x) => {
      mesh(box(1.1, 0.45, 6), stone, x, 0.225, -24);
      mesh(box(0.95, 0.04, 5.85), mat('gardenSoil', { color: 0x51442e, roughness: 1 }), x, 0.47, -24);
      for (let i = 0; i < 10; i++) {
        const z = -26.6 + i * 0.57;
        mesh(cyl(0.014, 0.018, 0.3, 5), mat('gardenStem', { color: 0x3b6a40, roughness: 1 }), x, 0.62, z);
        const flower = mesh(geo('gardenFlower', () => new T.IcosahedronGeometry(0.15, 0)), mat('gardenFlower' + i % 2, { color: i % 2 ? 0xf1c46e : 0xc397cf, roughness: 1 }), x, 0.81, z);
        flower.scale.y = 0.5;
      }
      solid(x, -24, 0.55, 3);
    });
    bench(-24.2, -27, 0); bench(-25.5, -19, Math.PI);
    tree(-29.5, -19, 0.9); tree(-17.5, -28.7, 0.9); streetLamp(-29.3, -25.5);
    sign('garden', '听风，也给自己一点空白', -24, -16, 0);
    [-24.6, -20].forEach((x) => {
      mesh(box(0.1, 2.6, 0.1), wood, x, 1.3, -27.8);
      solid(x, -27.8, 0.1, 0.1);
    });
    for (let i = 0; i < 6; i++) mesh(box(4.9, 0.1, 0.12), wood, -22.3, 2.6, -28.3 + i * 0.25);

    const cafe = shell({ cx: 23, cz: 23, w: 10, d: 10, h: 3.7, front: 'n', doorW: 4.5, key: 'cafe', floor: 'wood', tint: 0xc6ad8b, spillDir: -1 });
    mesh(box(6.8, 1.05, 0.85), wood, 0, 0.525, 2.6, cafe);
    solid(23, 25.6, 3.4, 0.425);
    mesh(box(6.95, 0.08, 0.98), mat('cafeCounter', { color: 0xe9d8b8, roughness: 0.65 }), 0, 1.09, 2.6, cafe);
    mesh(box(0.95, 0.65, 0.55), iron, 1.8, 1.45, 2.6, cafe);
    mesh(box(0.8, 0.16, 0.03), mat('cafeMachine', { color: 0xd4ddce, roughness: 0.6 }), 1.8, 1.42, 2.31, cafe);
    const cups = mat('cafeCups', { color: 0xf7e5c0, roughness: 0.5 });
    for (let i = 0; i < 4; i++) mesh(cyl(0.09, 0.07, 0.18, 12), cups, -1.6 + i * 0.45, 1.22, 2.6, cafe);
    [-3.7, 3.7].forEach((x) => {
      mesh(cyl(0.6, 0.6, 0.08, 16), wood, x, 0.8, -0.5, cafe);
      mesh(cyl(0.09, 0.22, 0.77, 8), iron, x, 0.385, -0.5, cafe);
      mesh(cyl(0.22, 0.23, 0.47, 10), iron, x, 0.235, -1.6, cafe);
      mesh(cyl(0.09, 0.07, 0.18, 12), cups, x + 0.12, 0.93, -0.5, cafe);
      solid(23 + x, 22.5, 0.6, 0.6); solid(23 + x, 21.4, 0.23, 0.23);
    });
    ceilingPanel(cafe, -2, 0, 1.8, 0.65, 0xffd79c, 1.0, 'cafeA', 3.5);
    ceilingPanel(cafe, 2, 0, 1.8, 0.65, 0xffd79c, 1.0, 'cafeB', 3.5);
    sign('cafe', '复习间隙，聊点生活', 27.8, 16.1, -Math.PI / 12);
    bench(19, 16.8, 0); streetLamp(29.8, 17.2);
  }

  function standingPerson(data, seed) {
    const g = new T.Group(), body = new T.Group(), head = new T.Group();
    scene.add(g); g.userData.person = true; g.add(body); body.position.y = 0.86;
    body.add(head); head.position.y = 0.69;
    const skin = mat('npcSkin' + seed % 3, { color: [0xdca783, 0xb9805e, 0xeac3a2][seed % 3], roughness: 0.85 });
    const cloth = mat('npcCloth' + data.color, { color: data.color, roughness: 0.85 });
    const dark = mat('npcTrouser', { color: 0x29374d, roughness: 0.9 });
    const hair = mat('npcHair', { color: 0x251d1b, roughness: 1 });
    const white = mat('npcWhite', { color: 0xf1ede1, roughness: 0.9 });
    mesh(box(0.44, 0.58, 0.28), cloth, 0, 0.29, 0, body);
    mesh(cyl(0.075, 0.075, 0.12, 8), skin, 0, 0.61, 0, body);
    mesh(geo('npcHead', () => new T.SphereGeometry(0.17, 14, 10)), skin, 0, 0, 0, head);
    mesh(geo('npcHair', () => new T.SphereGeometry(0.177, 14, 10, 0, Math.PI * 2, 0, 1.65)), hair, 0, 0.035, -0.012, head);
    [-0.063, 0.063].forEach((x) => mesh(box(0.025, 0.031, 0.018), hair, x, 0.015, 0.151, head));
    mesh(box(0.055, 0.012, 0.015), mat('npcMouth', { color: 0x975951, roughness: 1 }), 0, -0.077, 0.154, head);
    mesh(box(0.035, 0.044, 0.04), skin, 0, -0.019, 0.16, head);
    const legs = [], arms = [];
    [-1, 1].forEach((side) => {
      const leg = new T.Group(); leg.position.set(side * 0.125, 0.82, 0); g.add(leg); legs.push(leg);
      mesh(box(0.16, 0.69, 0.19), dark, 0, -0.35, 0, leg);
      mesh(box(0.18, 0.12, 0.32), white, 0, -0.76, 0.055, leg);
      const arm = new T.Group(); arm.position.set(side * 0.285, 0.52, 0); body.add(arm); arms.push(arm);
      arm.rotation.z = side * 0.06;
      mesh(cyl(0.075, 0.06, 0.43, 8), cloth, 0, -0.19, 0, arm);
      mesh(geo('npcHand', () => new T.SphereGeometry(0.065, 8, 6)), skin, 0, -0.45, 0, arm);
    });
    if (data.outfit === 'cook') {
      mesh(box(0.38, 0.69, 0.035), white, 0, 0.11, 0.158, body);
      mesh(cyl(0.19, 0.17, 0.18, 12), white, 0, 0.21, 0, head);
      mesh(geo('chefTop', () => new T.SphereGeometry(0.22, 12, 8)), white, 0, 0.32, 0, head).scale.y = 0.65;
    } else if (data.outfit === 'guard') {
      mesh(cyl(0.185, 0.185, 0.1, 12), dark, 0, 0.17, 0, head);
      mesh(box(0.3, 0.025, 0.18), dark, 0, 0.13, 0.15, head);
      mesh(box(0.07, 0.08, 0.015), mat('npcBadge', { color: 0xeec767, metalness: 0.4, roughness: 0.4 }), -0.12, 0.38, 0.15, body);
    } else if (data.outfit === 'barista') {
      mesh(box(0.36, 0.61, 0.035), mat('npcApron', { color: 0x355c50, roughness: 1 }), 0, 0.14, 0.16, body);
      mesh(box(0.2, 0.11, 0.04), white, 0, 0.06, 0.18, body);
    } else if (data.outfit === 'gardener') {
      mesh(cyl(0.27, 0.27, 0.04, 12), mat('npcHat', { color: 0xe1c28b, roughness: 1 }), 0, 0.17, 0, head);
      mesh(cyl(0.17, 0.19, 0.16, 12), matCache.get('npcHat'), 0, 0.26, 0, head);
    } else if (data.outfit === 'photographer') {
      [-0.12, 0.12].forEach((x) => mesh(box(0.025, 0.34, 0.03), dark, x, 0.45, 0.17, body));
      mesh(box(0.29, 0.19, 0.1), dark, 0, 0.25, 0.2, body);
      mesh(cyl(0.065, 0.065, 0.08, 12), white, 0, 0.25, 0.29, body).rotation.x = Math.PI / 2;
    } else if (data.outfit === 'staff') {
      mesh(box(0.25, 0.32, 0.075), mat('npcBook', { color: 0x446c78, roughness: 0.8 }), -0.24, 0.04, 0.15, body);
      mesh(box(0.045, 0.29, 0.02), white, 0, 0.36, 0.155, body);
    } else {
      mesh(box(0.32, 0.41, 0.17), dark, 0, 0.28, -0.21, body);
      [-0.16, 0.16].forEach((x) => mesh(box(0.045, 0.47, 0.04), dark, x, 0.3, 0.15, body));
      if (data.outfit === 'runner') mesh(cyl(0.178, 0.178, 0.045, 14), white, 0, 0.09, 0, head);
    }
    // 动态人像不烘焙进静态阴影，防止换地点后留下旧人影。
    g.traverse((o) => { if (o.isMesh) o.receiveShadow = true; });
    return { g, body, head, legs, arms, seed };
  }

  function sceneKey(key) { return key === 'online' ? 'dorm' : key; }
  function areaAt(x, z) { return sceneKey(locAt(x, z) || 'campus'); }
  function floorAt(key) { return key === 'campus' ? 0.015 : key === 'garden' || key === 'court' ? 0.06 : 0.03; }
  function isIndoor(key) { return !!key && !LOC[key].outdoor; }
  function syncEnvironment() {
    const point = playerPoint();
    FZ.Audio.setEnvironment({ scene: areaAt(...point), slot: slotNo, active: running && (phase === 'roam' || phase === 'event') });
  }
  function segmentDistance(x, z, a, b) {
    const dx = b[0] - a[0], dz = b[1] - a[1];
    const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / (dx * dx + dz * dz || 1)));
    return Math.hypot(x - a[0] - t * dx, z - a[1] - t * dz);
  }
  function cacheCampusObstacles() {
    scene.updateMatrixWorld(true);
    scene.traverse((o) => {
      if (!o.isMesh || !o.material || o.material.transparent) return;
      for (let p = o; p; p = p.parent) { if (p.userData.person) return; }
      const b = new T.Box3().setFromObject(o);
      if (b.max.x < -38 || b.min.x > 38 || b.max.z < -38 || b.min.z > 38 || b.max.y < 0.15 || b.min.y > 2.5) return;
      if (b.max.x - b.min.x > 35 || b.max.z - b.min.z > 35) return;
      sightObjects.push(o);
      occupancy.push(b);
    });
  }
  function bodySpaceFree(x, z) {
    if (blocked(x, z)) return false;
    return !occupancy.some((b) => b.min.y < 1.85 && b.max.y > 0.12 &&
      x + 0.34 > b.min.x && x - 0.34 < b.max.x && z + 0.34 > b.min.z && z - 0.34 < b.max.z);
  }
  function clearSight(ax, az, bx, bz) {
    const d = Math.hypot(bx - ax, bz - az), steps = Math.max(1, Math.ceil(d / 0.16));
    for (let i = 1; i < steps; i++) {
      if (blocked(ax + (bx - ax) * i / steps, az + (bz - az) * i / steps)) return false;
    }
    sightOrigin.set(ax, EYE + floorAt(areaAt(ax, az)), az);
    sightDir.set(bx - ax, 1.48 + floorAt(areaAt(bx, bz)) - sightOrigin.y, bz - az);
    sightRay.set(sightOrigin, sightDir.normalize()); sightRay.near = 0.04; sightRay.far = Math.max(0.04, d - 0.12);
    return sightRay.intersectObjects(sightObjects, false).length === 0;
  }
  function npcSpot(key, used) {
    const L = LOC[key], entrance = L.approach ? L.approach[L.approach.length - 1] : L.door;
    // 留出站位光环、门到站位的通道和校园导航环；同地最多三人，间距至少 0.95m。
    for (const radius of [1.65, 2.15, 2.7]) {
      for (let i = 0; i < 48; i++) {
        const a = L.yaw + Math.PI + i * Math.PI * 2 / 48;
        const x = L.stand[0] + Math.sin(a) * radius, z = L.stand[1] + Math.cos(a) * radius;
        if (areaAt(x, z) !== key || !bodySpaceFree(x, z)) continue;
        if (Math.hypot(x - entrance[0], z - entrance[1]) < 1.25 || segmentDistance(x, z, entrance, L.stand) < 0.7) continue;
        if (key === 'campus' && Math.abs(Math.hypot(x, z) - RING) < 0.8) continue;
        if (used.some((p) => Math.hypot(x - p[0], z - p[1]) < 0.95)) continue;
        if (clearSight(L.stand[0], L.stand[1], x, z)) return [x, z];
      }
    }
    return null; // 不把失败候选强塞到门口；goToNPC 会拒绝无安全落位的人物。
  }
  function buildNPCs() {
    FZ.NPCS.forEach((data, i) => {
      const n = Object.assign(standingPerson(data, i), { data, scene: 'campus', placed: false });
      const map = tex('npcLabel' + data.id, 768, 224, (ctx, w) => {
        ctx.fillStyle = 'rgba(12,24,39,0.96)'; ctx.fillRect(8, 8, w - 16, 190);
        ctx.strokeStyle = data.color; ctx.lineWidth = 5; ctx.strokeRect(8, 8, w - 16, 190);
        ctx.fillStyle = '#ffffff'; ctx.textAlign = 'center'; ctx.font = `700 50px ${FONT}`;
        ctx.fillText(data.name + ' · ' + data.role, w / 2, 80, w - 45);
        ctx.font = `600 35px ${FONT}`; ctx.fillStyle = data.color; ctx.fillText('聊聊 · T 交谈', w / 2, 151);
        ctx.beginPath(); ctx.moveTo(w / 2 - 18, 198); ctx.lineTo(w / 2, 221); ctx.lineTo(w / 2 + 18, 198); ctx.fill();
      });
      n.label = new T.Sprite(new T.SpriteMaterial({ map, transparent: true, depthTest: true, depthWrite: false, fog: false }));
      n.label.scale.set(1.3, 0.38, 1); n.label.position.y = 2.25; n.label.visible = false; n.g.add(n.label);
      n.markerMap = labelTexture(data.name, data.role + ' · 前往交谈');
      npcs.push(n);
    });
    placeNPCs(slotNo);
  }
  function placeNPCs(slot) {
    const used = Object.create(null);
    npcs.forEach((n) => {
      const key = sceneKey(n.data.places[Math.max(0, Math.min(2, slot))]);
      n.scene = LOC[key] ? key : 'campus';
      const group = used[n.scene] || (used[n.scene] = []);
      const p = group.length < 3 ? npcSpot(n.scene, group) : null;
      n.placed = !!p; n.g.visible = !!p; n.label.visible = false;
      if (!p) return;
      n.label.position.y = 2.03 + group.length * 0.15;
      group.push(p); n.g.position.set(p[0], floorAt(n.scene), p[1]);
      const L = LOC[n.scene]; n.g.rotation.y = Math.atan2(L.stand[0] - p[0], L.stand[1] - p[1]);
    });
    scene.updateMatrixWorld(true);
  }
  function playerPoint() { return phase === 'event' ? LOC[targetKey].stand : [P.x, P.z]; }
  function npcStatus() {
    const p = playerPoint(), area = areaAt(p[0], p[1]);
    return npcs.map((n) => {
      const distance = Math.hypot(p[0] - n.g.position.x, p[1] - n.g.position.z);
      const visible = n.placed && area === n.scene && distance < 4.8 && clearSight(p[0], p[1], n.g.position.x, n.g.position.z);
      return { id: n.data.id, scene: n.scene, distance, visible, nearby: visible && distance <= 3.8 };
    });
  }
  function nearestNpc() {
    const near = npcStatus().filter((n) => n.nearby).sort((a, b) => a.distance - b.distance);
    return near.length ? near[0].id : null;
  }
  function updateNpcHud() {
    const active = phase === 'roam' || phase === 'event', status = active ? npcStatus() : [];
    const near = status.filter((n) => n.nearby).sort((a, b) => a.distance - b.distance)[0];
    const person = near && npcs.find((n) => n.data.id === near.id);
    const hint = hud['npc-nearby'], button = hud['btn-talk'];
    const text = person ? person.data.name + ' · ' + person.data.role + ' · T 交谈' : '附近没有人 · 打开校园人物寻找';
    if (hint && hint.textContent !== text) hint.textContent = text;
    if (button) button.disabled = !person || inputBlocked() || !!npcTarget;
    npcs.forEach((n, i) => { n.label.visible = active && !conversation && status[i].visible; });
  }

  /* 少量校园生活实物，全部远离导航环/门口，不增加碰撞。 */
  function buildCampusLife() {
    [[3, 4.5, 10], [-3, 4.5, -10]].forEach((p) => {
      const light = new T.PointLight(0xffdeb4, 0, 16, 2); light.position.set(p[0], p[1], p[2]); scene.add(light);
      campusLights.push({ light, day: 0, night: 1.5 });
    });
    const wood = mat('lifeWood', { color: 0x906448, roughness: 0.85 });
    const metal = mat('lifeMetal', { color: 0x46616b, roughness: 0.7 });
    const flowers = new T.InstancedMesh(geo('flower', () => new T.IcosahedronGeometry(0.09, 0)),
      mat('flower', { color: 0xf5b4aa, roughness: 0.9 }), 24);
    const dummy = new T.Object3D(); let count = 0;
    [[-5.2, 3.9], [5.2, 3.9]].forEach(([x, z]) => {
      mesh(box(1.6, 0.48, 0.55), wood, x, 0.24, z);
      mesh(box(1.45, 0.05, 0.43), mat('lifeSoil', { color: 0x3e3825, roughness: 1 }), x, 0.49, z);
      for (let i = 0; i < 12; i++) {
        const xx = x - 0.64 + (i % 6) * 0.25, zz = z + (i < 6 ? -0.13 : 0.13);
        mesh(cyl(0.012, 0.012, 0.25, 5), mat('lifeStem', { color: 0x4e8241, roughness: 1 }), xx, 0.6, zz);
        dummy.position.set(xx, 0.76 + i % 3 * 0.025, zz); dummy.updateMatrix(); flowers.setMatrixAt(count++, dummy.matrix);
      }
    });
    scene.add(flowers);
    [[6, -6], [-6, -6]].forEach(([x, z]) => {
      mesh(cyl(0.62, 0.62, 0.07, 16), wood, x, 0.8, z);
      mesh(cyl(0.08, 0.22, 0.77, 8), metal, x, 0.385, z);
      [-1, 1].forEach((s) => mesh(cyl(0.24, 0.2, 0.46, 10), metal, x + s * 0.96, 0.23, z));
      mesh(cyl(0.06, 0.045, 0.13, 10), mat('lifeCup', { color: 0xeee4cb, roughness: 0.8 }), x + 0.18, 0.9, z);
    });
    const sign = new T.Group(); sign.position.set(-3.8, 0, 5.6); scene.add(sign);
    mesh(cyl(0.055, 0.07, 2.2, 8), metal, 0, 1.1, 0, sign);
    const signMap = tex('campusDirections', 512, 256, (ctx, w, h) => {
      ctx.fillStyle = '#244a45'; ctx.fillRect(0, 0, w, h); ctx.fillStyle = '#fff7de'; ctx.textAlign = 'center'; ctx.font = `600 37px ${FONT}`;
      ['图书馆 ↑   食堂 ↓', '宿舍 ←   教学楼 →', '打印店 ↙   中庭休憩区'].forEach((s, i) => ctx.fillText(s, w / 2, 58 + i * 72));
    });
    const board = mesh(geo('plane1'), mat('lifeSign', { map: signMap, side: T.DoubleSide, roughness: 0.8 }), 0, 1.8, 0, sign);
    board.scale.set(1.65, 0.825, 1);
    campusCat = new T.Group(); campusCat.position.set(6.5, 0.015, 8.0); scene.add(campusCat);
    const fur = mat('catFur', { color: 0xc88e51, roughness: 1 });
    mesh(geo('catBody', () => new T.SphereGeometry(0.2, 12, 8)), fur, 0, 0.24, 0, campusCat).scale.set(0.85, 1, 1.6);
    mesh(geo('catHead', () => new T.SphereGeometry(0.145, 12, 8)), fur, 0, 0.44, 0.24, campusCat);
    [-1, 1].forEach((s) => {
      mesh(geo('catEar', () => new T.ConeGeometry(0.067, 0.14, 4)), fur, s * 0.09, 0.57, 0.23, campusCat);
      mesh(box(0.025, 0.035, 0.015), mat('catEye', { color: 0x20362b }, 'basic'), s * 0.06, 0.45, 0.372, campusCat);
      [-0.16, 0.14].forEach((z) => mesh(cyl(0.045, 0.05, 0.17, 6), fur, s * 0.12, 0.1, z, campusCat));
    });
    mesh(cyl(0.025, 0.04, 0.45, 8), fur, 0, 0.31, -0.39, campusCat).rotation.x = -0.65;
    // 四条独立短步道处于内环空地；夜里只保留一位散步同学。
    [[-4.8, -8, 1.3, 0], [4.8, -8, 1.3, 0], [-6, 0, 0, 2.3], [7.0, 0, 0, 2.5]].forEach((route, i) => {
      const w = standingPerson({ color: ['#88aabd', '#d3aa8d', '#9cad8a', '#b6a2bf'][i], outfit: 'student' }, i + 8);
      w.route = route; walkers.push(w);
    });
  }
  function animatePeople(dt) {
    npcs.forEach((n) => {
      n.body.position.y = 0.86 + Math.sin(elapsed * 1.8 + n.seed) * 0.008;
      n.head.rotation.y = Math.sin(elapsed * 0.55 + n.seed) * 0.13;
    });
    walkers.forEach((w, i) => {
      w.g.visible = skyIdx !== 2 || i === 0;
      if (!w.g.visible) return;
      const r = w.route, t = elapsed * 0.35 + i * 1.9, s = Math.sin(t);
      const x = r[0] + r[2] * s, z = r[1] + r[3] * s;
      if (!blocked(x, z)) w.g.position.set(x, 0.015, z);
      w.g.rotation.y = Math.atan2(r[2] * Math.cos(t), r[3] * Math.cos(t));
      w.legs.forEach((leg, k) => { leg.rotation.x = Math.sin(elapsed * 5 + k * Math.PI) * 0.24 * Math.abs(Math.cos(t)); });
      w.arms.forEach((arm, k) => { arm.rotation.x = -w.legs[k].rotation.x; });
      w.body.position.y = 0.86 + Math.sin(elapsed * 10) * 0.009;
    });
    if (campusCat) campusCat.rotation.y = -0.5 + Math.sin(elapsed * 0.2) * 0.08;
    if (clouds && clouds.visible) clouds.rotation.y += dt * 0.0007;
  }

  /* ---------- 目标标记 ---------- */
  function buildMarker() {
    marker = new T.Group(); scene.add(marker);
    markerRing = mesh(geo('mRing', () => new T.RingGeometry(0.75, 0.95, 40)),
      mat('mRingM', { color: PAL.amber, transparent: true, opacity: 0.85, side: T.DoubleSide, depthWrite: false }, 'basic'), 0, 0.06, 0, marker);
    markerRing.rotation.x = -Math.PI / 2;
    const r2 = mesh(geo('mRing2', () => new T.RingGeometry(1.15, 1.22, 40)),
      mat('mRing2M', { color: PAL.amber, transparent: true, opacity: 0.4, side: T.DoubleSide, depthWrite: false }, 'basic'), 0, 0.05, 0, marker);
    r2.rotation.x = -Math.PI / 2;
    markerBeam = mesh(geo('mBeam', () => new T.CylinderGeometry(0.42, 0.62, 7, 18, 1, true)),
      mat('mBeamM', { color: PAL.amber, transparent: true, opacity: 0.09, blending: T.AdditiveBlending, depthWrite: false, side: T.DoubleSide }, 'basic'), 0, 3.5, 0, marker);
    markerBeam.renderOrder = 3;
    markerLabel = new T.Sprite(new T.SpriteMaterial({ transparent: true, depthTest: false, depthWrite: false }));
    markerLabel.position.set(0, 2.5, 0);
    markerLabel.scale.set(3.2, 0.8, 1);
    markerLabel.renderOrder = 10;
    marker.add(markerLabel);
    marker.visible = false;
    const arrow = new T.Shape();
    arrow.moveTo(0, 0.48); arrow.lineTo(0.48, -0.2); arrow.lineTo(0.22, -0.2);
    arrow.lineTo(0, 0.1); arrow.lineTo(-0.22, -0.2); arrow.lineTo(-0.48, -0.2); arrow.closePath();
    const geometry = new T.ShapeGeometry(arrow);
    geometry.rotateX(-Math.PI / 2);
    routeArrows = new T.InstancedMesh(geometry, new T.MeshBasicMaterial({
      color: 0xffcc55, transparent: true, opacity: 0.9, side: T.DoubleSide, depthWrite: false
    }), 32);
    routeArrows.instanceMatrix.setUsage(T.DynamicDrawUsage);
    routeArrows.frustumCulled = false;
    routeArrows.count = 0; routeArrows.visible = false;
    scene.add(routeArrows);
  }
  function labelTexture(text, sub) {
    const c = document.createElement('canvas'); c.width = 512; c.height = 128;
    const g = c.getContext('2d');
    g.fillStyle = 'rgba(10,13,28,0.82)';
    g.beginPath(); g.roundRect ? g.roundRect(6, 22, 500, 84, 18) : g.rect(6, 22, 500, 84); g.fill();
    g.strokeStyle = '#ffb020'; g.lineWidth = 3; g.stroke();
    g.fillStyle = '#ffb020'; g.font = `800 42px ${FONT}`; g.textAlign = 'center';
    g.fillText(text, 256, 72);
    g.fillStyle = 'rgba(230,236,250,0.72)'; g.font = `500 22px ${FONT}`;
    g.fillText(sub, 256, 99);
    const t = new T.CanvasTexture(c); t.encoding = T.sRGBEncoding;
    return t;
  }

  /* ---------- 尘埃 ---------- */
  function batchStaticMeshes() {
    const moving = new Set([marker, clouds, sunDisc, moonDisc, moonSprite, campusCat, copierBar, clockHand,
      ...npcs.map((n) => n.g), ...walkers.map((n) => n.g), ...figures.map((n) => n.g),
      ...courseStacks.map((s) => s.group)]);
    const groups = new Map();
    scene.updateMatrixWorld(true);
    scene.traverse((o) => {
      if (!o.isMesh || o.isInstancedMesh || o.children.length || Array.isArray(o.material) || o.material.transparent) return;
      for (let p = o; p; p = p.parent) { if (moving.has(p) || !p.visible) return; }
      if (o.matrixWorld.determinant() <= 0) return;
      const pos = new T.Vector3().setFromMatrixPosition(o.matrixWorld);
      const key = [o.geometry.uuid, o.material.uuid, o.castShadow, o.receiveShadow, o.renderOrder,
        Math.floor(pos.x / 16), Math.floor(pos.z / 16)].join('|');
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(o);
    });
    groups.forEach((objects) => {
      if (objects.length < 4) return;
      const first = objects[0], bounds = new T.Box3();
      objects.forEach((o) => {
        if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
        bounds.union(o.geometry.boundingBox.clone().applyMatrix4(o.matrixWorld));
      });
      const geometry = first.geometry.clone();
      geometry.boundingSphere = bounds.getBoundingSphere(new T.Sphere());
      const batch = new T.InstancedMesh(geometry, first.material, objects.length);
      batch.castShadow = first.castShadow; batch.receiveShadow = first.receiveShadow;
      batch.renderOrder = first.renderOrder; batch.frustumCulled = true;
      objects.forEach((o, i) => {
        batch.setMatrixAt(i, o.matrixWorld);
        // 射线检测保留原物件的世界矩阵，渲染只使用合批后的实例。
        o.matrixAutoUpdate = false;
        o.removeFromParent();
      });
      batch.instanceMatrix.needsUpdate = true;
      batch.matrixAutoUpdate = false;
      scene.add(batch);
      batches.meshes += objects.length; batches.groups++;
    });
  }

  function buildDust() {
    const n = mobile ? 260 : 620;
    const pos = new Float32Array(n * 3), seed = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 62;
      pos[i * 3 + 1] = Math.random() * 6;
      pos[i * 3 + 2] = (Math.random() - 0.5) * 62;
      seed[i] = Math.random() * 6.28;
    }
    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.BufferAttribute(pos, 3));
    dust = new T.Points(g, new T.PointsMaterial({
      map: texGlow(), color: 0xffd9a0, size: 0.075, transparent: true, opacity: 0.5,
      blending: T.AdditiveBlending, depthWrite: false, sizeAttenuation: true
    }));
    dust.userData.seed = seed;
    dust.frustumCulled = false;
    scene.add(dust);
  }

  /* ---------- 后期 ---------- */
  const GRADE_SHADER = {
    uniforms: {
      tDiffuse: { value: null }, uTime: { value: 0 }, uVig: { value: 0.22 },
      uGrain: { value: 0.004 }, uSat: { value: 1.02 },
      uExposure: { value: 1.1 }, uLift: { value: 0.02 }, uFlash: { value: 0 }, uFlashCol: { value: new T.Color(0xffffff) }
    },
    vertexShader: 'varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
    fragmentShader: [
      'uniform sampler2D tDiffuse; uniform float uTime,uVig,uGrain,uSat,uExposure,uLift,uFlash;',
      'uniform vec3 uFlashCol; varying vec2 vUv;',
      'vec3 aces(vec3 x){ return clamp((x*(2.51*x+0.03))/(x*(2.43*x+0.59)+0.14),0.0,1.0); }',
      'void main(){',
      ' vec2 d = vUv-0.5; float r2 = dot(d,d);',
      ' vec3 c = texture2D(tDiffuse, vUv).rgb;',
      ' c *= uExposure;',
      ' c = max(c - uLift, 0.0);',
      ' c = aces(c);',
      ' float l = dot(c, vec3(0.2126,0.7152,0.0722));',
      ' c = mix(vec3(l), c, uSat);',
      ' c = mix(c, uFlashCol, uFlash);',
      ' float vig = smoothstep(1.05, 0.18, r2*1.7);',
      ' c *= mix(1.0, vig, uVig);',
      ' float gn = fract(sin(dot(vUv*vec2(1234.5,6789.1)+uTime, vec2(12.9898,78.233)))*43758.5453);',
      ' c += (gn-0.5)*uGrain;',
      ' gl_FragColor = vec4(pow(max(c,0.0), vec3(1.0/2.2)), 1.0);',
      '}'
    ].join('\n')
  };

  function buildComposer(w, h) {
    const rt = new T.WebGLRenderTarget(w, h, {
      type: T.HalfFloatType, minFilter: T.LinearFilter, magFilter: T.LinearFilter
    });
    rt.samples = renderer.capabilities.isWebGL2 ? (quality === 'high' ? 4 : quality === 'mid' ? 2 : 0) : 0;
    composer = new T.EffectComposer(renderer, rt);
    composer.addPass(new T.RenderPass(scene, camera));
    bloom = new T.UnrealBloomPass(new T.Vector2(w, h), 0.28, 0.3, 1.0);
    composer.addPass(bloom);
    gradePass = new T.ShaderPass(GRADE_SHADER);
    gradePass.renderToScreen = true;
    composer.addPass(gradePass);
  }

  /* ---------- 初始化 ---------- */
  function init(host) {
    if (!T || !T.WebGLRenderer) return false;
    try {
      const probe = document.createElement('canvas');
      if (!(probe.getContext('webgl2') || probe.getContext('webgl'))) return false;
    } catch (e) { return false; }

    mobile = window.matchMedia('(pointer: coarse)').matches || window.innerWidth < 820;
    const mem = navigator.deviceMemory || 4;
    quality = mobile ? (mem <= 3 ? 'low' : 'mid') : 'high';

    try {
      renderer = new T.WebGLRenderer({ antialias: true, powerPreference: 'high-performance', alpha: false, stencil: false });
    } catch (e) { return false; }
    renderer.setSize(host.clientWidth || window.innerWidth, host.clientHeight || window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, quality === 'high' ? 2 : quality === 'mid' ? 1.5 : 1));
    renderer.outputEncoding = T.LinearEncoding;
    renderer.toneMapping = T.NoToneMapping;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = T.PCFSoftShadowMap;
    renderer.shadowMap.autoUpdate = false;
    renderer.info.autoReset = false;
    host.appendChild(renderer.domElement);
    renderer.domElement.id = 'world-canvas';

    scene = new T.Scene();
    scene.fog = new T.FogExp2(SKY[2].fog, SKY[2].fogD);
    camera = new T.PerspectiveCamera(62, 1, 0.08, 400);
    camera.rotation.order = 'YXZ';

    hemi = new T.HemisphereLight(0x2a3a66, 0x0a0d16, 0.2); scene.add(hemi);
    moon = new T.DirectionalLight(0x8fb4ff, 0.34);
    moon.position.set(-34, 44, -26);
    moon.castShadow = true;
    moon.shadow.mapSize.set(quality === 'high' ? 2048 : 1024, quality === 'high' ? 2048 : 1024);
    moon.shadow.camera.left = -42; moon.shadow.camera.right = 42;
    moon.shadow.camera.top = 42; moon.shadow.camera.bottom = -42;
    moon.shadow.camera.near = 1; moon.shadow.camera.far = 130;
    moon.shadow.bias = -0.0016; moon.shadow.normalBias = 0.03;
    scene.add(moon); scene.add(moon.target);
    roomLight = new T.PointLight(0xffc98a, 0.0, 17, 2); scene.add(roomLight);

    buildSky();
    buildEnv();
    buildGround();
    buildCourtyard();
    buildDorm();
    buildLibrary();
    buildClassroom();
    buildCanteen();
    buildPrint();
    buildCampusCorners();
    buildCampusLife();
    cacheCampusObstacles();
    buildNPCs();
    buildMarker();
    buildDust();
    batchStaticMeshes();
    ['compass-needle', 'roam-direction', 'roam-dist', 'npc-nearby', 'btn-talk', 'campus-map',
      'btn-map', 'minimap', 'nav-arrival'].forEach((id) => { hud[id] = document.getElementById(id); });

    const w = host.clientWidth || window.innerWidth, h = host.clientHeight || window.innerHeight;
    camera.aspect = w / h; camera.updateProjectionMatrix();
    buildComposer(w, h);
    composer.setPixelRatio(renderer.getPixelRatio());
    composer.setSize(w, h);

    applySky(2);
    renderer.shadowMap.needsUpdate = true;
    bindInput(host);
    ok = true;
    setQuality(quality);
    setPhase('title');
    start();
    return true;
  }

  /* ---------- 天光 ---------- */
  let skyCur = null;
  function applySky(idx) {
    const s = SKY[idx];
    skyCur = s; skyIdx = idx;
    skyMat.uniforms.top.value.setHex(s.top);
    skyMat.uniforms.mid.value.setHex(s.mid);
    skyMat.uniforms.bot.value.setHex(s.bot);
    scene.fog.color.setHex(s.fog);
    scene.fog.density = s.fogD;
    const night = idx === 2;
    document.body.dataset.timeOfDay = night ? 'night' : 'day';
    const timeLabel = document.getElementById('world-time-label');
    if (timeLabel) timeLabel.textContent = ['清晨 · 白天', '午后 · 白天', '深夜 · 夜晚'][idx];
    moon.intensity = s.moon; moon.color.setHex(s.moonCol);
    moon.position.set(night ? -34 : idx === 0 ? 42 : -26, night ? 44 : idx === 0 ? 30 : 60, night ? -26 : -38);
    moon.shadow.needsUpdate = true;
    hemi.intensity = s.hemi;
    hemi.color.setHex(night ? 0x91b0dd : 0xd1e8ff); hemi.groundColor.setHex(night ? 0x263045 : 0x807b62);
    skyMat.uniforms.glow.value.setHex(night ? 0x203050 : 0x8ca4b1);
    stars.material.uniforms.uOpacity.value = s.star; stars.visible = night;
    moonSprite.visible = moonDisc.visible = night; sunDisc.visible = clouds.visible = !night;
    sunDisc.position.copy(moon.position).normalize().multiplyScalar(180); sunDisc.lookAt(0, 0, 0);
    campusLights.forEach((f) => { f.light.intensity = night ? f.night : f.day; });
    const city = matCache.get('city');
    if (city) { city.color.setHex(night ? 0x56627d : 0xa7bac9); city.emissiveIntensity = night ? 0.85 : 0.04; }
    const glass = matCache.get('glass');
    if (glass) { glass.emissive.setHex(night ? 0xffd39a : 0x88bbdd); glass.emissiveIntensity = night ? 0.9 : 0.15; glass.opacity = night ? 0.28 : 0.16; }
    ['pool', 'spill', 'lampCone'].forEach((key) => {
      const m = matCache.get(key); if (m) m.opacity = night ? (key === 'lampCone' ? 0.025 : 0.24) : (key === 'lampCone' ? 0 : 0.035);
    });
    gradePass.uniforms.uExposure.value = s.exposure;
    gradePass.uniforms.uLift.value = s.lift;
    stdMats.forEach((m) => { m.envMapIntensity = s.env; });
    applyClarity();
    lampFlicker.forEach((f) => { f.lampScale = f.ceil || f.ceilPanel ? (night ? 0.75 : 0.4) : s.lamp; });
    dormLamp.intensity = 3.4 * s.lamp;
    libLamp.intensity = 2.0 * s.lamp;
    if (moonPool) moonPool.opacity = idx === 2 ? 0.3 : idx === 0 ? 0.14 : 0.04;
    if (winMat) winMat.opacity = idx === 2 ? 0.24 : idx === 0 ? 0.16 : 0.06;
    if (winPane) {
      winPane.map = idx === 2 ? texNightWindow() : texDayWindow(idx === 0);
      winPane.needsUpdate = true;
    }
    const winCol = idx === 2 ? 0x9dc0ff : idx === 0 ? 0xffd2a0 : 0xdcecff;
    if (winMat) winMat.color.setHex(winCol);
    if (winShaft) { winShaft.color.setHex(winCol); winShaft.opacity = idx === 2 ? 0.1 : idx === 0 ? 0.16 : 0.07; }
    if (moonPool) moonPool.color.setHex(winCol);
    renderer.shadowMap.needsUpdate = true;
  }

  /* ---------- 交互锁与导航状态：剧情 targetKey 永不被 NPC 覆盖 ---------- */
  function inputBlocked() {
    return interactionLocked || !!document.querySelector('dialog[open]');
  }
  function clearControls() {
    for (const k in keys) delete keys[k];
    const cv = renderer && renderer.domElement, st = document.getElementById('stick');
    if (cv && look.id >= 0 && cv.hasPointerCapture(look.id)) cv.releasePointerCapture(look.id);
    if (st && stick.id >= 0 && st.hasPointerCapture(stick.id)) st.releasePointerCapture(stick.id);
    stick.on = look.on = false; stick.id = look.id = -1; stick.x = stick.y = 0;
    P.moving = 0; P.tYaw = P.yaw; P.tPitch = P.pitch;
    const knob = document.getElementById('stick-knob');
    if (knob) knob.style.transform = 'translate(0,0)';
  }
  function syncNavigationUI() {
    const n = npcTarget && npcs.find((p) => p.data.id === npcTarget);
    const L = LOC[n ? n.scene : targetKey];
    if (marker) {
      marker.position.set(L.stand[0], floorAt(sceneKey(n ? n.scene : targetKey)), L.stand[1]);
      markerLabel.material.map = n ? n.markerMap : storyMarkerMap;
      markerLabel.material.needsUpdate = true;
      marker.visible = phase === 'roam' && !interactionLocked;
    }
    const place = document.getElementById('roam-place');
    if (place) place.textContent = L.name;
    const b = document.getElementById('btn-go');
    if (b) b.classList.toggle('walking', !!autoPath);
    const status = document.getElementById('npc-travel-status');
    if (status) { status.hidden = !n; status.textContent = n ? '正在寻找 ' + n.data.name + ' · ' + L.name : ''; }
    updateRouteGuide();
  }
  function cancelNavigation() {
    autoPath = null; npcTarget = null; jam = 0;
    syncNavigationUI();
  }
  function focusNPC(id) {
    if (conversation && conversation.npc.data.id === id) return true;
    if (conversation) {
      conversation.npc.g.rotation.y = conversation.rotation;
      P.yaw = P.tYaw = conversation.yaw;
      P.pitch = P.tPitch = conversation.pitch;
      conversation = null;
    }
    if (!id) return false;
    const n = npcs.find((person) => person.data.id === id);
    if (!n || !npcStatus().some((person) => person.id === id && person.nearby)) return false;
    conversation = { npc: n, rotation: n.g.rotation.y, yaw: P.yaw, pitch: P.pitch };
    const point = playerPoint();
    n.g.rotation.y = Math.atan2(point[0] - n.g.position.x, point[1] - n.g.position.z);
    npcs.forEach((person) => { person.label.visible = false; });
    return true;
  }
  function setInteractionLocked(value) {
    interactionLocked = !!value;
    if (!interactionLocked) focusNPC(null);
    clearControls();
    if (interactionLocked) cancelNavigation();
    else syncNavigationUI();
    if (ok) updateNpcHud();
  }
  function goToNPC(id) {
    if (!ok || !['roam', 'event'].includes(phase) || inputBlocked()) return false;
    const n = npcs.find((p) => p.data.id === id && p.placed);
    if (!n) return false;
    if (phase === 'event') { const L = LOC[targetKey]; P.x = L.stand[0]; P.z = L.stand[1]; }
    clearControls();
    npcTarget = id; storyArrivalHeld = true; jam = 0;
    autoPath = buildPath(n.scene);
    setPhase('roam'); syncNavigationUI(); updateNpcHud();
    return true;
  }
  function arriveNpc() {
    const n = npcs.find((p) => p.data.id === npcTarget);
    if (!n) { cancelNavigation(); return; }
    const id = n.data.id, L = LOC[n.scene];
    P.x = L.stand[0]; P.z = L.stand[1];
    const dx = n.g.position.x - P.x, dz = n.g.position.z - P.z;
    P.yaw = P.tYaw = cam.yaw = Math.atan2(-dx, -dz);
    P.pitch = P.tPitch = cam.pitch = Math.atan2(1.5 - EYE, Math.hypot(dx, dz));
    cam.pos.set(P.x, EYE + floorAt(n.scene), P.z);
    camera.position.copy(cam.pos); camera.rotation.set(cam.pitch, cam.yaw, 0);
    storyArrivalHeld = true;
    // 清导航、锁输入但继续渲染。保留 arrived，返回剧情必须由 goTo 重新武装。
    setInteractionLocked(true);
    updateNpcHud();
    showArrival('已找到 ' + n.data.name + ' · ' + L.name);
    if (typeof npcArriveCb === 'function') {
      try { npcArriveCb(id); } catch (error) { setInteractionLocked(false); console.error('NPC arrival callback failed', error); }
    } else setInteractionLocked(false);
  }

  /* ---------- 输入 ---------- */
  function bindInput(host) {
    const cv = renderer.domElement;
    cv.style.touchAction = 'none';
    hud['btn-map'].addEventListener('click', () => {
      const collapsed = hud['campus-map'].classList.toggle('is-collapsed');
      hud['btn-map'].setAttribute('aria-expanded', String(!collapsed));
      if (!collapsed) updateRouteGuide();
    });

    cv.addEventListener('pointerdown', (e) => {
      if (inputBlocked() || look.on) return;
      look.on = true; look.id = e.pointerId; look.px = e.clientX; look.py = e.clientY;
      cv.setPointerCapture(e.pointerId);
    });
    cv.addEventListener('pointermove', (e) => {
      if (inputBlocked() || !look.on || e.pointerId !== look.id) return;
      const dx = e.clientX - look.px, dy = e.clientY - look.py;
      look.px = e.clientX; look.py = e.clientY;
      const sensitivity = e.pointerType === 'touch' ? 2.2 / Math.max(320, Math.min(innerWidth, innerHeight)) : 0.0068;
      const k = phase === 'roam' ? sensitivity : sensitivity * 0.65;
      P.tYaw -= dx * k;
      P.tPitch = Math.max(-1.15, Math.min(1.0, P.tPitch - dy * k * 0.85));
    });
    const endLook = (e) => { if (e.pointerId === look.id) { look.on = false; look.id = -1; } };
    cv.addEventListener('pointerup', endLook);
    cv.addEventListener('pointercancel', endLook);
    cv.addEventListener('lostpointercapture', endLook);

    const st = document.getElementById('stick');
    const knob = document.getElementById('stick-knob');
    if (st && knob) {
      const setStick = (e) => {
        if (inputBlocked() || phase !== 'roam') return;
        const r = st.getBoundingClientRect();
        let dx = (e.clientX - (r.left + r.width / 2)) / (r.width / 2);
        let dy = (e.clientY - (r.top + r.height / 2)) / (r.height / 2);
        const m = Math.hypot(dx, dy), strength = Math.max(0, Math.min(1, (m - 0.12) / 0.88));
        if (m > 0) { dx = dx / m * strength; dy = dy / m * strength; }
        stick.x = dx; stick.y = dy;
        const travel = (r.width - knob.offsetWidth) / 2;
        knob.style.transform = `translate(${dx * travel}px, ${dy * travel}px)`;
      };
      st.addEventListener('pointerdown', (e) => {
        if (inputBlocked() || phase !== 'roam' || stick.on) return;
        stick.on = true; stick.id = e.pointerId; st.setPointerCapture(e.pointerId);
        setStick(e); e.preventDefault();
      });
      st.addEventListener('pointermove', (e) => { if (stick.on && e.pointerId === stick.id) setStick(e); });
      const end = (e) => {
        if (e.pointerId !== stick.id) return;
        stick.on = false; stick.id = -1; stick.x = 0; stick.y = 0;
        knob.style.transform = 'translate(0,0)';
      };
      st.addEventListener('pointerup', end);
      st.addEventListener('pointercancel', end);
      st.addEventListener('lostpointercapture', end);
    }

    window.addEventListener('keydown', (e) => {
      const tag = e.target && e.target.tagName;
      if (inputBlocked() || tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || (e.target && e.target.isContentEditable)) return;
      keys[String(e.key).toLowerCase()] = true;
      if (phase === 'roam' && ['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' '].includes(String(e.key).toLowerCase())) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => { delete keys[String(e.key).toLowerCase()]; });
    window.addEventListener('blur', clearControls);
    document.addEventListener('visibilitychange', () => { paused = document.hidden; clearControls(); });
    window.addEventListener('resize', resize);
  }

  function resize() {
    if (!ok) return;
    const host = renderer.domElement.parentElement;
    const w = host.clientWidth || window.innerWidth, h = host.clientHeight || window.innerHeight;
    renderer.setSize(w, h);
    camera.aspect = w / h; camera.updateProjectionMatrix();
    composer.setPixelRatio(renderer.getPixelRatio());
    composer.setSize(w, h);
    // 横竖屏 / 拖窗口跨过断点时，摇杆与提示文案要跟着换
    const was = mobile;
    mobile = window.matchMedia('(pointer: coarse)').matches || window.innerWidth < 820;
    if (mobile !== was) {
      const st = document.getElementById('stick');
      if (st) st.classList.toggle('on', phase === 'roam' && mobile);
      const hint = document.getElementById('roam-hint');
      if (hint) hint.textContent = mobile ? '左下摇杆行走 · 右侧拖动看视角' : 'W A S D 行走 · 拖动鼠标看视角 · Shift 快走';
    }
  }

  /* ---------- 路径 ---------- */
  function inRect(x, z, r) {
    return r && Math.abs(x - r[0]) < r[2] / 2 && Math.abs(z - r[1]) < r[3] / 2;
  }
  function locAt(x, z) {
    for (const k in LOC) { if (LOC[k].rect && inRect(x, z, LOC[k].rect)) return k; }
    return null;
  }
  function ringPt(x, z) {
    const m = Math.hypot(x, z) || 1;
    return [x / m * RING, z / m * RING];
  }
  function buildPath(toKey) {
    toKey = sceneKey(toKey);
    const to = LOC[toKey] || LOC.library;
    const pts = [];
    const fromKey = sceneKey(locAt(P.x, P.z));
    let cx = P.x, cz = P.z;
    if (fromKey && fromKey !== toKey) {
      const from = LOC[fromKey], d = from.door;
      if (from.approach) pts.push(...from.approach.slice().reverse().map((p) => p.slice()));
      pts.push([d[0], d[1]]); cx = d[0]; cz = d[1];
    }
    if (fromKey !== toKey || Math.hypot(cx - to.stand[0], cz - to.stand[1]) > 6) {
      const a0 = Math.atan2(cx, cz);
      const a1 = Math.atan2(to.door[0], to.door[1]);
      let da = a1 - a0;
      while (da > Math.PI) da -= Math.PI * 2;
      while (da < -Math.PI) da += Math.PI * 2;
      const steps = Math.max(1, Math.ceil(Math.abs(da) / 0.22));
      for (let i = 0; i <= steps; i++) {
        const a = a0 + da * (i / steps);
        pts.push([Math.sin(a) * RING, Math.cos(a) * RING]);
      }
      pts.push([to.door[0], to.door[1]]);
      if (to.approach) pts.push(...to.approach.map((p) => p.slice()));
    }
    pts.push([to.stand[0], to.stand[1]]);
    return pts;
  }

  function updateMinimap(points, target) {
    const canvas = hud.minimap;
    if (!canvas || !canvas.clientWidth || hud['campus-map'].classList.contains('is-collapsed') || inputBlocked()) return;
    const w = canvas.clientWidth, h = canvas.clientHeight, ratio = Math.min(devicePixelRatio || 1, 2);
    const size = `${w},${h},${ratio}`;
    const xy = (x, z) => [(x + 36) * w / 72, (z + 32) * h / 64];
    if (size !== mapSize) {
      mapSize = size;
      canvas.width = Math.round(w * ratio); canvas.height = Math.round(h * ratio);
      mapBase = document.createElement('canvas'); mapBase.width = canvas.width; mapBase.height = canvas.height;
      const g = mapBase.getContext('2d'); g.scale(ratio, ratio);
      g.fillStyle = '#101e2b'; g.fillRect(0, 0, w, h);
      g.strokeStyle = '#45575d'; g.lineWidth = 7;
      g.beginPath(); g.ellipse(...xy(0, 0), 11 * w / 72, 11 * h / 64, 0, 0, Math.PI * 2); g.stroke();
      Object.entries(LOC).forEach(([key, L]) => {
        if (key === 'online') return;
        if (L.rect) {
          const [x, z, rw, rh] = L.rect, [left, top] = xy(x - rw / 2, z - rh / 2);
          g.fillStyle = L.outdoor ? '#314e42' : '#2a3c51'; g.strokeStyle = '#657d96'; g.lineWidth = 1;
          g.fillRect(left, top, rw * w / 72, rh * h / 64); g.strokeRect(left, top, rw * w / 72, rh * h / 64);
        }
        const p = L.rect ? xy(L.rect[0], L.rect[1]) : xy(0, 1);
        const label = w < 170 ? (L.short || L.name) : L.name;
        g.font = `600 ${w < 170 ? 9 : 11}px ${FONT}`;
        g.textAlign = 'center'; g.textBaseline = 'middle';
        g.lineWidth = 3; g.strokeStyle = 'rgba(9,17,27,0.82)'; g.strokeText(label, p[0], p[1]);
        g.fillStyle = '#e0e9f4'; g.fillText(label, p[0], p[1]);
      });
      g.fillStyle = '#9aaec1'; g.font = `600 10px ${FONT}`; g.fillText('北 ↑', w - 19, 10);
    }
    const g = canvas.getContext('2d'); g.setTransform(1, 0, 0, 1, 0, 0); g.drawImage(mapBase, 0, 0);
    g.setTransform(ratio, 0, 0, ratio, 0, 0);
    g.strokeStyle = '#ffca55'; g.lineWidth = 2; g.lineJoin = 'round';
    g.beginPath(); g.moveTo(...xy(P.x, P.z)); points.forEach((p) => g.lineTo(...xy(...p))); g.stroke();
    const goal = xy(...LOC[target].stand);
    g.fillStyle = '#ffca55'; g.strokeStyle = '#0d1726'; g.lineWidth = 1.5;
    g.beginPath(); g.arc(...goal, 4.5, 0, Math.PI * 2); g.fill(); g.stroke();
    g.save(); g.translate(...xy(P.x, P.z)); g.rotate(-cam.yaw);
    g.fillStyle = '#54dcff'; g.strokeStyle = '#0d1726'; g.lineWidth = 1.5;
    g.beginPath(); g.moveTo(0, -7); g.lineTo(5, 5); g.lineTo(0, 3); g.lineTo(-5, 5); g.closePath(); g.fill(); g.stroke(); g.restore();
    const description = `校园小地图，蓝色为你的位置和朝向，金色路线通往${LOC[target].name}`;
    if (canvas.getAttribute('aria-label') !== description) canvas.setAttribute('aria-label', description);
  }

  function showArrival(text) {
    FZ.Audio.play('arrival');
    syncEnvironment();
    clearTimeout(arrivalTimer);
    hud['nav-arrival'].textContent = text;
    hud['nav-arrival'].classList.add('on');
    arrivalTimer = setTimeout(() => hud['nav-arrival'].classList.remove('on'), 3200);
  }

  function updateRouteGuide() {
    if (!routeArrows) return;
    routeArrows.visible = phase === 'roam' && !inputBlocked();
    if (!routeArrows.visible) { routeArrows.count = 0; guideCache = null; return; }
    const n = npcTarget && npcs.find((person) => person.data.id === npcTarget);
    const target = n ? n.scene : targetKey;
    const routeKey = `${target}|${autoPath ? autoPath.length + ':' + autoPath[0] : 'manual'}`;
    if (!guideCache || guideCache.key !== routeKey || Math.hypot(P.x - guideCache.x, P.z - guideCache.z) > 0.05) {
      const points = (autoPath || buildPath(target)).filter((p) => Math.hypot(p[0] - P.x, p[1] - P.z) > 0.35);
      let from = [P.x, P.z], spacing = 1.1, count = 0;
      for (const to of points) {
        const dx = to[0] - from[0], dz = to[1] - from[1], length = Math.hypot(dx, dz);
        if (length < 0.001) continue;
        let at = spacing;
        for (; at < length && count < 32; at += 1.8) {
          const x = from[0] + dx * at / length, z = from[1] + dz * at / length;
          routeTransform.position.set(x, floorAt(areaAt(x, z)) + 0.075, z);
          routeTransform.rotation.set(0, Math.atan2(-dx, -dz), 0);
          routeTransform.updateMatrix();
          routeArrows.setMatrixAt(count++, routeTransform.matrix);
        }
        if (count === 32) break;
        spacing = at - length; from = to;
      }
      routeArrows.count = count; routeArrows.instanceMatrix.needsUpdate = true;
      guideCache = { key: routeKey, x: P.x, z: P.z, points };
    }
    const points = guideCache.points, next = points[0] || LOC[target].stand;
    const yaw = Math.atan2(P.x - next[0], P.z - next[1]);
    const bearing = Math.atan2(Math.sin(cam.yaw - yaw), Math.cos(cam.yaw - yaw));
    let from = [P.x, P.z], distance = 0;
    points.forEach((p) => { distance += Math.hypot(p[0] - from[0], p[1] - from[1]); from = p; });
    routeArrows.userData = { target, next: next.slice(), bearing, distance };
    hud['compass-needle'].style.transform = `rotate(${bearing}rad)`;
    const direction = Math.abs(bearing) > 2.4 ? '向后转，沿路走' :
      bearing > 0.45 ? '向右转，沿路走' : bearing < -0.45 ? '向左转，沿路走' : '沿箭头向前走';
    if (hud['roam-direction'].textContent !== direction) hud['roam-direction'].textContent = direction;
    const remaining = distance < 1.4 ? '即将到达' : Math.ceil(distance) + ' m';
    if (hud['roam-dist'].textContent !== remaining) hud['roam-dist'].textContent = remaining;
    updateMinimap(points, target);
  }

  function goTo() {
    if (!ok || !['roam', 'event'].includes(phase) || inputBlocked()) return;
    cancelNavigation(); clearControls();
    arrived = false; storyArrivalHeld = false;
    autoPath = buildPath(targetKey);
    setPhase('roam'); syncNavigationUI();
  }

  function arrive() {
    if (arrived || npcTarget || inputBlocked()) return;
    arrived = true;
    autoPath = null;
    const L = LOC[targetKey];
    P.tYaw = L.yaw; P.tPitch = L.pitch;
    setPhase('event');
    showArrival('已到达 ' + L.name + ' · 开始本时段事件');
    if (arriveCb) arriveCb();
  }

  /* ---------- 相位 ---------- */
  function setPhase(p) {
    if (!ok) return;
    focusNPC(null);
    phase = p;
    clearTimeout(arrivalTimer); hud['nav-arrival'].classList.remove('on');
    if (p !== 'roam') { interactionLocked = false; clearControls(); cancelNavigation(); }
    document.body.dataset.wphase = p;
    const roaming = p === 'roam';
    marker.visible = roaming && !interactionLocked;
    const el = document.getElementById('roam-hud');
    if (el) el.classList.toggle('on', roaming);
    const st = document.getElementById('stick');
    if (st) st.classList.toggle('on', roaming && mobile);
    const cv = renderer.domElement;
    cv.style.cursor = roaming ? 'grab' : 'default';

    if (p === 'title') { titleT = 0; }
    if (p === 'exam') {
      P.x = 18.6; P.z = -6.6; P.tYaw = -Math.PI / 2 - 0.25; P.tPitch = -0.14;
      examLampA.intensity = 3.4; examLampB.intensity = 3.0;
      scene.fog.density = 0.008;
      renderer.shadowMap.needsUpdate = true;
    } else {
      examLampA.intensity = 0; examLampB.intensity = 0;
      if (skyCur) scene.fog.density = skyCur.fogD;
    }
    if (p === 'result') { applySky(0); }
    if (p === 'dayend') { dormLamp.intensity = 0.7; }
    else if (skyCur) dormLamp.intensity = 2.6 * skyCur.lamp;
    syncEnvironment();
    updateRouteGuide();
  }

  function beginSlot(o) {
    if (!ok) return;
    interactionLocked = false; clearControls(); cancelNavigation();
    targetKey = LOC[o.scene] ? o.scene : 'library';
    arrived = false; storyArrivalHeld = false;
    dayNo = o.day; slotNo = o.slot;
    applySky(Math.min(2, o.slot));
    placeNPCs(o.slot);
    if (posterTex) {
      const nt = texPoster(o.day);
      const pm = matCache.get('posterM');
      pm.map = nt; pm.needsUpdate = true; posterTex = nt;
    }
    const L = LOC[targetKey];
    marker.position.set(L.stand[0], 0, L.stand[1]);
    if (storyMarkerMap) storyMarkerMap.dispose();
    storyMarkerMap = labelTexture(L.name, o.label || '这个时段的事件在这里');
    markerLabel.material.map = storyMarkerMap;
    markerLabel.material.needsUpdate = true;
    marker.visible = true;
    setPhase('roam');
    const place = document.getElementById('roam-place');
    if (place) place.textContent = L.name;
    const hint = document.getElementById('roam-hint');
    if (hint) hint.textContent = mobile ? '左下摇杆行走 · 右侧拖动看视角' : 'W A S D 行走 · 拖动鼠标看视角 · Shift 快走';
    const b = document.getElementById('btn-go');
    if (b) { b.classList.remove('walking'); b.querySelector('span').textContent = '直接前往'; }
  }

  function setCourses(arr, active) {
    if (!ok || !arr) return;
    const dorm = courseStacks.filter((x) => x.where === 'dorm');
    const lib = courseStacks.filter((x) => x.where === 'lib');
    courseStacks.forEach((s) => {
      const idx = (s.where === 'dorm' ? dorm : lib).indexOf(s);
      const c = arr[idx];
      if (!c) return;
      const shown = Math.max(1, Math.round((c.k / 100) * s.books.length));
      s.books.forEach((b, i) => { b.visible = i < shown; });
      const cold = c.neglect >= 4;
      if (s.tag) {
        s.tag.material.emissiveIntensity = cold ? 0.9 : (idx === active ? 0.5 : 0.12);
        s.tag.material.emissive.setHex(cold ? PAL.danger : s.col);
      }
      s.group.scale.y = 0.85 + (c.k / 100) * 0.5;
    });
  }

  function applyClarity() {
    const stress = Math.max(0, Math.min(1, (30 - stats.m) / 30));
    const tired = Math.max(0, Math.min(1, (30 - stats.s) / 30));
    gradePass.uniforms.uVig.value = 0.22 + stress * 0.07 + tired * 0.04;
    gradePass.uniforms.uGrain.value = quality === 'low' ? 0 : 0.004 + stress * 0.003;
    gradePass.uniforms.uSat.value = 1.02 - stress * 0.06;
    if (skyCur) scene.fog.density = skyCur.fogD;
  }
  function setStats(st) {
    if (!ok || !st) return;
    stats = st;
    applyClarity();
  }

  function pulse(kind, color) {
    if (!ok) return;
    const amt = kind === 'bad' ? 0.07 : kind === 'good' ? 0.04 : 0.025;
    kickAmt = Math.max(kickAmt, amt);
    kick.set((Math.random() - 0.5) * amt, (Math.random() - 0.5) * amt, 0);
    bloomBump = kind === 'bad' ? 0.04 : 0.02;
    if (kind === 'bad' || kind === 'good') {
      flashAmt = kind === 'bad' ? 0.06 : 0.035;
      gradePass.uniforms.uFlashCol.value.set(color || (kind === 'bad' ? 0xff4d4d : 0xb6f03c));
    }
  }

  function setQuality(q) {
    if (!ok) return;
    quality = ['high', 'mid', 'low'].includes(q) ? q : 'high';
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, quality === 'high' ? 2 : quality === 'mid' ? 1.5 : 1));
    bloom.strength = quality === 'high' ? 0.28 : 0.24; bloom.radius = 0.3; bloom.threshold = 1;
    bloom.enabled = quality !== 'low';
    const samples = renderer.capabilities.isWebGL2 ? (quality === 'high' ? 4 : quality === 'mid' ? 2 : 0) : 0;
    [composer.renderTarget1, composer.renderTarget2].forEach((rt) => {
      if (rt && rt.samples !== samples) { rt.samples = samples; rt.dispose(); }
    });
    applyClarity();
    dust.visible = quality !== 'low';
    renderer.shadowMap.enabled = quality !== 'low';
    renderer.shadowMap.needsUpdate = true;
    resize();
  }

  /* ---------- 每帧 ---------- */
  function movePlayer(dt, adt) {
    if (inputBlocked()) { clearControls(); if (autoPath || npcTarget) cancelNavigation(); return; }
    let fx = 0, fz = 0;
    if (keys['w'] || keys['arrowup']) fz += 1;
    if (keys['s'] || keys['arrowdown']) fz -= 1;
    if (keys['a'] || keys['arrowleft']) fx -= 1;
    if (keys['d'] || keys['arrowright']) fx += 1;
    if (stick.on) { fx += stick.x; fz -= stick.y; }
    const mag = Math.hypot(fx, fz);
    if (mag > 0.08) {
      if (autoPath || npcTarget) cancelNavigation();
      fx /= mag; fz /= mag;
      const run = keys['shift'] ? 1.85 : 1;
      const sp = 3.5 * run * Math.min(1, mag);
      const sy = Math.sin(P.yaw), cy = Math.cos(P.yaw);
      const dx = (-sy * fz + cy * fx) * sp * adt;
      const dz = (-cy * fz - sy * fx) * sp * adt;
      const steps = Math.max(1, Math.ceil(Math.hypot(dx, dz) / 0.2));
      for (let i = 0; i < steps; i++) stepMove(dx / steps, dz / steps);
      P.moving = Math.min(1, P.moving + adt * 6);
      P.bob += adt * sp * 2.1;
      P.step = (P.step || 0) + adt * sp * 2.1;
      if (P.step > Math.PI) {
        P.step -= Math.PI;
        if (FZ.Audio) FZ.Audio.play('step', { indoor: isIndoor(locAt(P.x, P.z)), surface: areaAt(P.x, P.z), run: run > 1 });
      }
    } else {
      P.moving = Math.max(0, P.moving - dt * 5);
    }

    // 自动寻路按真实时间推进：低帧率设备上「直接前往」也不会变成慢动作
    if (autoPath && autoPath.length) {
      let budget = 5.0 * adt;
      while (budget > 0.0001 && autoPath && autoPath.length) {
        const t = autoPath[0];
        const dx = t[0] - P.x, dz = t[1] - P.z;
        const d = Math.hypot(dx, dz);
        if (d < 0.22) {
          autoPath.shift();
          if (!autoPath.length) {
            autoPath = null;
            if (npcTarget) arriveNpc(); else arrive();
            return; // NPC 回调即便立即解锁，本 tick 也绝不触发剧情。
          }
          continue;
        }
        const step = Math.min(budget, d, 0.25);
        const px = P.x, pz = P.z;
        stepMove(dx / d * step, dz / d * step);
        budget -= step;
        // 被家具顶住时跳过这个航点，最后一段直接落到站位，保证「直接前往」永远不会卡死
        if (Math.hypot(P.x - px, P.z - pz) < step * 0.35) {
          jam += adt;
          if (jam > 0.9) {
            jam = 0; autoPath.shift();
            if (!autoPath.length) {
              const n = npcTarget && npcs.find((p) => p.data.id === npcTarget);
              const L = LOC[n ? n.scene : targetKey];
              P.x = L.stand[0]; P.z = L.stand[1];
              autoPath = null;
              if (npcTarget) arriveNpc(); else arrive();
              return;
            }
            continue;
          }
        } else jam = 0;
        const want = Math.atan2(-dx, -dz);
        P.tYaw = P.yaw + Math.atan2(Math.sin(want - P.yaw), Math.cos(want - P.yaw));
        P.tPitch = -0.03;
        P.moving = 1; P.bob += step * 2.0;
        P.step = (P.step || 0) + step * 2.0;
        if (P.step > Math.PI) {
          P.step -= Math.PI;
          if (FZ.Audio) FZ.Audio.play('step', { indoor: isIndoor(locAt(P.x, P.z)), surface: areaAt(P.x, P.z) });
        }
      }
    }

    const L = LOC[targetKey], distance = Math.hypot(P.x - L.stand[0], P.z - L.stand[1]);
    if (!npcTarget && storyArrivalHeld && distance > 1.35) storyArrivalHeld = false;
    if (!npcTarget && !storyArrivalHeld && !arrived && !inputBlocked() && phase === 'roam' && distance < 1.15) arrive();
  }

  function stepMove(dx, dz) {
    const nx = Math.max(-38, Math.min(38, P.x + dx));
    const nz = Math.max(-38, Math.min(38, P.z + dz));
    if (!blocked(nx, P.z)) P.x = nx;
    if (!blocked(P.x, nz)) P.z = nz;
  }

  const desiredCam = { pos: new T.Vector3(), yaw: 0, pitch: 0, k: 1 };
  function wantCam(dt) {
    const w = desiredCam;
    w.yaw = P.yaw; w.pitch = P.pitch; w.k = 1 - Math.exp(-dt * 4.2);
    if (conversation) {
      const n = conversation.npc, point = playerPoint();
      const dx = n.g.position.x - point[0], dz = n.g.position.z - point[1];
      const eye = EYE + floorAt(n.scene), height = renderer.domElement.clientHeight;
      const top = document.getElementById('campus-dialog').getBoundingClientRect().top;
      const faceY = Math.max(48, top * 0.43);
      w.pos.set(point[0], eye, point[1]);
      w.yaw = Math.atan2(-dx, -dz);
      w.pitch = Math.atan2(n.g.position.y + 1.55 - eye, Math.hypot(dx, dz)) -
        Math.atan((1 - 2 * faceY / height) * Math.tan(T.MathUtils.degToRad(camera.fov / 2)));
      return w;
    }
    if (inputBlocked()) { w.pos.copy(cam.pos); w.yaw = cam.yaw; w.pitch = cam.pitch; w.k = 1; return w; }
    if (phase === 'roam') {
      const bobY = Math.sin(P.bob) * 0.035 * P.moving;
      const bobX = Math.cos(P.bob * 0.5) * 0.022 * P.moving;
      w.pos.set(P.x + bobX, EYE + floorAt(areaAt(P.x, P.z)) + bobY, P.z);
      w.yaw = P.yaw; w.pitch = P.pitch; w.k = 1;
    } else if (phase === 'event' || phase === 'exam') {
      const L = phase === 'exam' ? { stand: [18.6, -6.6], yaw: -Math.PI / 2 - 0.22, pitch: -0.13 } : LOC[targetKey];
      const drift = Math.sin(elapsed * 0.32) * 0.035;
      const dy = Math.atan2(Math.sin(P.yaw - L.yaw), Math.cos(P.yaw - L.yaw));
      w.pos.set(L.stand[0], EYE - 0.06 + Math.sin(elapsed * 0.5) * 0.012, L.stand[1]);
      w.yaw = L.yaw + Math.max(-0.6, Math.min(0.6, dy)) * 0.7 + drift;
      w.pitch = L.pitch + Math.max(-0.35, Math.min(0.35, P.pitch - L.pitch)) * 0.7;
    } else if (phase === 'dayend') {
      w.pos.set(-23.6, 1.22, 1.2);
      w.yaw = -2.14 + Math.sin(elapsed * 0.2) * 0.05;
      w.pitch = -0.26;
    } else if (phase === 'result') {
      const a = elapsed * 0.055;
      w.pos.set(Math.sin(a) * 34, 20 + Math.sin(elapsed * 0.18) * 1.6, Math.cos(a) * 34);
      w.yaw = a + Math.PI; w.pitch = -0.42;
    } else {
      // 标题：从食堂门口缓缓推向宿舍窗内
      titleT += dt;
      const t = Math.min(1, titleT / 26);
      const e = t * t * (3 - 2 * t);
      const ax = 8 - e * 22, az = 13 - e * 11;
      w.pos.set(ax + Math.sin(elapsed * 0.22) * 0.6, 2.1 + e * 0.3 + Math.sin(elapsed * 0.3) * 0.08, az);
      const tx = -26, tz = -3;
      w.yaw = Math.atan2(-(tx - w.pos.x), -(tz - w.pos.z));
      w.pitch = -0.06 - e * 0.05;
    }
    return w;
  }

  function frame(now) {
    raf = requestAnimationFrame(frame);
    if (paused) { last = now; return; }
    const raw = (now - last) / 1000 || 0.016;
    const dt = Math.min(0.05, raw);
    last = now; elapsed += dt;
    fps += (1 / Math.max(0.001, raw) - fps) * 0.08;

    if (phase === 'roam') movePlayer(dt, Math.min(0.3, raw));

    // 视角阻尼
    const viewDt = Math.min(raw, 0.15);
    const lk = 1 - Math.exp(-viewDt * (phase === 'roam' ? 18 : 6));
    const locked = inputBlocked();
    if (!locked) {
      P.yaw += Math.atan2(Math.sin(P.tYaw - P.yaw), Math.cos(P.tYaw - P.yaw)) * lk;
      P.pitch += (P.tPitch - P.pitch) * lk;
    }

    const w = wantCam(viewDt);
    cam.pos.lerp(w.pos, w.k);
    cam.yaw += Math.atan2(Math.sin(w.yaw - cam.yaw), Math.cos(w.yaw - cam.yaw)) * (phase === 'roam' ? 1 : w.k);
    cam.pitch += (w.pitch - cam.pitch) * (phase === 'roam' ? 1 : w.k);

    kickAmt *= Math.exp(-dt * 7);
    camera.position.copy(cam.pos);
    if (!locked) {
      camera.position.x += kick.x * kickAmt;
      camera.position.y += kick.y * kickAmt;
    }
    camera.rotation.set(cam.pitch, cam.yaw, locked ? 0 : Math.sin(elapsed * 0.7) * 0.001);
    animatePeople(dt);

    // 灯光呼吸
    for (let i = 0; i < lampFlicker.length; i++) {
      const f = lampFlicker[i];
      const s = f.lampScale == null ? 1 : f.lampScale;
      f.m.emissiveIntensity = f.base * s * (0.94 + 0.06 * Math.sin(elapsed * (2.1 + f.seed) + f.seed * 3));
      // 熄灯时灯管本体也要暗下去，否则白色灯罩会在画面顶部留一条亮杠
      if (f.ceilPanel) f.m.color.copy(f.col0).multiplyScalar(0.14 + 0.86 * Math.min(1, s));
    }
    if (copierBar) copierBar.position.x = -1.2 + Math.sin(elapsed * 1.6) * 0.42;
    if (clockHand) clockHand.rotation.z = -elapsed * 0.12;
    if (marker.visible) {
      markerRing.rotation.z = elapsed * 0.6;
      const p = 0.5 + 0.5 * Math.sin(elapsed * 2.4);
      markerRing.material.opacity = 0.55 + p * 0.4;
      markerBeam.material.opacity = 0.06 + p * 0.06;
      markerLabel.position.y = 2.45 + Math.sin(elapsed * 1.6) * 0.07;
    }
    for (let i = 0; i < figures.length; i++) {
      const f = figures[i];
      f.body.rotation.x = 0.28 + Math.sin(elapsed * 0.9 + f.seed) * 0.022;
      f.head.position.y = 1.36 + Math.sin(elapsed * 0.9 + f.seed) * 0.008;
    }
    if (dust.visible) {
      const pa = dust.geometry.attributes.position, sd = dust.userData.seed;
      for (let i = 0; i < pa.count; i++) {
        let y = pa.array[i * 3 + 1] + dt * (0.06 + (i % 5) * 0.014);
        if (y > 6.2) y = 0.1;
        pa.array[i * 3 + 1] = y;
        pa.array[i * 3] += Math.sin(elapsed * 0.3 + sd[i]) * dt * 0.05;
      }
      pa.needsUpdate = true;
    }
    if (steam) {
      const pa = steam.geometry.attributes.position;
      for (let i = 0; i < pa.count; i++) {
        let y = pa.array[i * 3 + 1] + dt * 0.34;
        if (y > 3.1) y = 1.15;
        pa.array[i * 3 + 1] = y;
      }
      pa.needsUpdate = true;
    }
    stars.material.uniforms.uTime.value = elapsed;

    // 房间补光跟着玩家走
    const inside = locAt(cam.pos.x, cam.pos.z);
    roomLight.position.set(cam.pos.x, 2.4, cam.pos.z);
    const roomWant = isIndoor(inside) ? 0.8 * (skyCur ? skyCur.room : 1) : 0.0;
    roomLight.intensity += (roomWant - roomLight.intensity) * Math.min(1, dt * 3);

    bloomBump *= Math.exp(-dt * 3.4);
    bloom.strength = Math.min(0.32, (quality === 'high' ? 0.28 : 0.24) + bloomBump);
    flashAmt *= Math.exp(-dt * 4.5);
    gradePass.uniforms.uFlash.value = flashAmt;
    gradePass.uniforms.uTime.value = elapsed;

    npcHudTick += raw;
    if (npcHudTick >= 0.1) { npcHudTick %= 0.1; updateNpcHud(); syncEnvironment(); }
    hudTick += raw;
    if (phase === 'roam' && hudTick > 0.1) {
      hudTick %= 0.1;
      updateRouteGuide();
    }

    renderer.info.reset();
    composer.render();
  }

  function start() {
    if (running || !ok) return;
    running = true; last = performance.now();
    raf = requestAnimationFrame(frame);
  }
  function stop() {
    focusNPC(null);
    running = false; cancelAnimationFrame(raf); raf = 0;
    syncEnvironment();
    interactionLocked = false; clearControls(); cancelNavigation();
    npcs.forEach((n) => { n.label.visible = false; });
    routeArrows.visible = false;
    clearTimeout(arrivalTimer); hud['nav-arrival'].classList.remove('on');
  }

  return {
    init, start, stop, resize, setPhase, beginSlot, goTo, setCourses, setStats, pulse, setQuality,
    npcStatus, nearestNpc, setInteractionLocked, goToNPC, focusNPC,
    onNpcArrive(fn) { npcArriveCb = typeof fn === 'function' ? fn : null; },
    isOk() { return ok; },
    isRoaming() { return ok && phase === 'roam'; },
    isMobile() { return mobile; },
    quality() { return quality; },
    onArrive(fn) { arriveCb = fn; },
    locName(k) { return (LOC[k] || LOC.library).name; },
    standOf(k) { return (LOC[k] || LOC.library).stand.slice(); },
    place(x, z, yaw) { P.x = x; P.z = z; P.tYaw = P.yaw = yaw; cancelNavigation(); },
    debug() {
      return {
        pos: [+P.x.toFixed(2), +P.z.toFixed(2)], yaw: +P.yaw.toFixed(3),
        cam: [+camera.position.x.toFixed(2), +camera.position.y.toFixed(2), +camera.position.z.toFixed(2)],
        phase, sky: skyIdx, quality, target: targetKey, fps: Math.round(fps),
        guide: { visible: routeArrows.visible, count: routeArrows.count, ...routeArrows.userData },
        cameraYaw: cam.yaw, controls: { stick: stick.on, look: look.on, vector: [stick.x, stick.y] },
        npcTarget, interactionLocked, arrived, npcs: npcs.length,
        conversation: conversation ? { id: conversation.npc.data.id,
          face: new T.Vector3(0, 1.55, 0).applyMatrix4(conversation.npc.g.matrixWorld).project(camera).toArray() } : null,
        npcPositions: npcs.map((n) => ({ id: n.data.id, scene: n.scene, placed: n.placed, pos: [n.g.position.x, n.g.position.y, n.g.position.z] })),
        renderPixelRatio: renderer.getPixelRatio(), grain: gradePass.uniforms.uGrain.value, aberration: 0, staticBatching: { ...batches },
        bloom: { strength: bloom.strength, radius: bloom.radius, threshold: bloom.threshold, enabled: bloom.enabled },
        dayNight: skyIdx === 2 ? 'night' : 'day', sunVisible: sunDisc.visible, moonVisible: moonDisc.visible,
        ambientWalkers: walkers.filter((w) => w.g.visible).length,
        calls: renderer.info.render.calls, tris: renderer.info.render.triangles,
        auto: !!autoPath, path: autoPath ? autoPath.length : 0,
        next: autoPath && autoPath[0] ? [+autoPath[0][0].toFixed(2), +autoPath[0][1].toFixed(2)] : null
      };
    }
  };
})();