#!/usr/bin/env node
'use strict';
// Independent CDP verification. Product code, other tests and user profiles are untouched.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const net = require('node:net');
const { spawn } = require('node:child_process');
const ROOT = path.resolve(__dirname, '..');
const SHOTS = path.join(ROOT, 'screenshots/campus-20261120/expanded-world');
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9562;
const URL = 'http://127.0.0.1:8765/index.html';
const SAVE = `JSON.parse(localStorage.getItem('fz.run.v1'))`;
const J = JSON.stringify;
const waitInterval = ms => new Promise(resolve => setTimeout(resolve, ms));
const scenes = { court: [22, -21, 0], garden: [-22, -22, 0.35], cafe: [23, 20.5, Math.PI] };
let interrupted = false;

class CDP {
  constructor(ws) {
    this.ws = ws; this.id = 0; this.pending = new Map(); this.errors = []; this.warnings = [];
    ws.onmessage = ({ data }) => {
      const m = JSON.parse(data);
      if (m.id && this.pending.has(m.id)) {
        const p = this.pending.get(m.id); this.pending.delete(m.id); clearTimeout(p.timer);
        if (m.error) p.reject(new Error(JSON.stringify(m.error))); else p.resolve(m.result);
      } else if (m.method === 'Runtime.exceptionThrown' ||
        m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error' ||
        m.method === 'Log.entryAdded' && m.params.entry.level === 'error') {
        this.errors.push({ method: m.method, params: m.params });
      } else if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'warning' ||
        m.method === 'Log.entryAdded' && m.params.entry.level === 'warning') {
        this.warnings.push({ method: m.method, params: m.params });
      } else if (m.method === 'Page.javascriptDialogOpening') {
        this.errors.push({ unexpectedDialog: m.params.message });
        this.send('Page.handleJavaScriptDialog', { accept: false }).catch(() => {});
      }
    };
    ws.onclose = () => {
      for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(new Error('CDP closed')); }
      this.pending.clear();
    };
  }
  static async connect(url) {
    const ws = new WebSocket(url);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => { ws.close(); reject(new Error('WebSocket timeout')); }, 10000);
      ws.onopen = () => { clearTimeout(timer); resolve(); };
      ws.onerror = () => { clearTimeout(timer); reject(new Error('WebSocket error')); };
    });
    return new CDP(ws);
  }
  send(method, params = {}, timeout = 60000) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error('CDP timeout: ' + method)); }, timeout);
      this.pending.set(id, { resolve, reject, timer });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  async eval(expression) {
    if (interrupted) throw new Error('Interrupted');
    // Deliberately no userGesture: only trusted CDP input may unlock audio.
    const r = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails));
    return r.result.value;
  }
  async wait(expression, label, timeout = 45000) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      if (await this.eval(expression)) return;
      await waitInterval(150);
    }
    throw new Error('Wait timeout: ' + label + '; ' + JSON.stringify(await this.eval(`({audio:FZ.Audio.debug(),world:FZ.World.debug()})`)));
  }
  async click(selector) {
    const point = await this.eval(`(async () => {
      const el = document.querySelector(${J(selector)});
      if (!el || el.disabled) throw new Error('Missing/disabled button: ' + ${J(selector)});
      await Promise.all(el.getAnimations().filter(a => Number.isFinite(a.effect.getComputedTiming().endTime)).map(a => a.finished.catch(() => {})));
      el.scrollIntoView({block:'center',inline:'nearest',behavior:'instant'});
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
      const b=el.getBoundingClientRect(), x=b.x+b.width/2, y=b.y+b.height/2;
      if (!b.width || !b.height || !el.contains(document.elementFromPoint(x,y))) throw new Error('Occluded button: '+${J(selector)});
      return {x,y};
    })()`);
    await this.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...point });
    await this.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', buttons: 1, clickCount: 1 });
    await this.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', buttons: 0, clickCount: 1 });
  }
  async shot(name, fullPage = false) {
    const opts = { format: 'png', captureBeyondViewport: true };
    if (fullPage) {
      const { cssContentSize: size } = await this.send('Page.getLayoutMetrics');
      opts.clip = { x: 0, y: 0, width: size.width, height: size.height, scale: 1 };
    }
    const { data } = await this.send('Page.captureScreenshot', opts);
    const file = path.join(SHOTS, name + '.png');
    fs.writeFileSync(file, Buffer.from(data, 'base64')); console.log('SCREENSHOT ' + file);
    return file;
  }
}

// Read-only observation of the real graph. Original source.start/connect calls still run.
const PROBE = `(() => {
  const p = window.__worldAudioProbe = {contexts:[], analysers:[], starts:[], plays:[], trusted:[], tag:null};
  const Native = window.AudioContext || window.webkitAudioContext;
  if (!Native) return;
  const Wrapped = new Proxy(Native, {construct(target,args) {
    const ctx = Reflect.construct(target,args); p.contexts.push(ctx);
    const compressor = ctx.createDynamicsCompressor;
    ctx.createDynamicsCompressor = function(...args) {
      const node = compressor.apply(this,args), analyser = this.createAnalyser();
      analyser.fftSize=2048; node.connect(analyser); p.analysers.push(analyser);
      return node;
    };
    for (const method of ['createOscillator','createBufferSource']) {
      const native = ctx[method];
      ctx[method] = function(...args) {
        const source = native.apply(this,args), start = source.start;
        source.start = function(...args) {
          const result = start.apply(this,args);
          p.starts.push({kind:method,tag:p.tag,time:ctx.currentTime,when:args[0]||0,wall:performance.now()});
          return result;
        };
        return source;
      };
    }
    return ctx;
  }});
  window.AudioContext=Wrapped;
  if (window.webkitAudioContext) window.webkitAudioContext=Wrapped;
  document.addEventListener('pointerdown',e=>p.trusted.push({type:e.type,trusted:e.isTrusted,id:e.target.closest('button')?.id||''}),true);
  p.measure = async function(settle=1700, duration=700) {
    await new Promise(r=>setTimeout(r,settle));
    const a=p.analysers[0]; if(!a) return {error:'No real analyser'};
    const buffer=new Float32Array(a.fftSize), end=performance.now()+duration;
    let squares=0, count=0, peak=0, frames=0;
    do {
      a.getFloatTimeDomainData(buffer);
      for(const value of buffer){squares+=value*value;count++;peak=Math.max(peak,Math.abs(value));}
      frames++; await new Promise(r=>setTimeout(r,35));
    } while(performance.now()<end);
    return {rms:Math.sqrt(squares/count),peak,frames,ctxState:a.context.state,ctxTime:a.context.currentTime,sampleRate:a.context.sampleRate};
  };
})()`;

async function assertPortFree() {
  await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', () => reject(new Error('Port 9562 occupied; refusing to connect to or close another Chrome')));
    server.listen({ port: PORT, host: '127.0.0.1', exclusive: true }, () => server.close(resolve));
  });
}
async function targetOf(state) {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    if (state.exited) throw state.error || new Error('Own Chrome exited before CDP became ready');
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/list`, { signal: AbortSignal.timeout(1200) });
      const target = (await r.json()).find(t => t.type === 'page' && t.url === 'about:blank');
      if (target) return target.webSocketDebuggerUrl;
    } catch (_) { /* Poll only the port just reserved for this process. */ }
    await waitInterval(150);
  }
  throw new Error('CDP startup timeout');
}
async function cleanup(chrome, state, cdp, profile) {
  if (cdp && !state.exited) {
    try { await cdp.send('Browser.close', {}, 4000); } catch (_) { /* Socket may close first. */ }
  }
  if (cdp) cdp.ws.close();
  if (chrome && !state.exited) await Promise.race([state.done, waitInterval(1500)]);
  if (chrome && chrome.pid && !state.exited) {
    await new Promise((resolve, reject) => {
      const kill = spawn('taskkill', ['/PID', String(chrome.pid), '/T', '/F'], { stdio: 'ignore' });
      kill.once('error', reject); kill.once('exit', resolve);
    });
    await Promise.race([state.done, waitInterval(5000)]);
  }
  assert(state.exited, 'Own Chrome process did not exit');
  fs.rmSync(profile, { recursive: true, force: true, maxRetries: 12, retryDelay: 250 });
  console.log('CLEANUP ' + JSON.stringify({ ownPid: chrome.pid, exited: state.exited, profileRemoved: !fs.existsSync(profile) }));
}
function progress(save) { const { npcMet, ...rest } = save; return rest; }

async function main() {
  await assertPortFree();
  console.log('PORT_GUARD 9562 free');
  fs.mkdirSync(SHOTS, { recursive: true });
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'fz-worldaudio-'));
  const state = { exited: false, error: null, done: null };
  const failures = [], measurements = [];
  let chrome, cdp;
  process.on('SIGINT', () => { interrupted = true; });
  process.on('SIGTERM', () => { interrupted = true; });
  async function check(label, work) {
    console.log('BEGIN ' + label);
    try { const result = await work(); console.log('PASS ' + label + ' ' + JSON.stringify(result ?? {})); return result; }
    catch (error) { failures.push({ label, error: error.stack }); console.log('FAIL ' + label + ' ' + error.stack); }
  }
  async function audio(label, expected, energy = true, settle = 1700) {
    const sample = await cdp.eval(`__worldAudioProbe.measure(${settle},700)`);
    const debug = await cdp.eval('FZ.Audio.debug()');
    const entry = { label, debug, sample }; measurements.push(entry); console.log('AUDIO ' + JSON.stringify(entry));
    for (const [key, value] of Object.entries(expected)) assert.deepStrictEqual(debug[key], value, label + ': ' + key);
    assert.equal(sample.ctxState, 'running');
    assert(sample.frames >= 2 && Number.isFinite(sample.rms));
    if (energy) assert(sample.rms > 1e-8 && sample.peak > 1e-7, label + ': no actual output energy');
    else assert(sample.rms < 1e-9, label + ': output not silent');
    return entry;
  }
  async function env(scene, slot) {
    await cdp.wait(`FZ.Audio.debug().environment.scene===${J(scene)} && FZ.Audio.debug().environment.slot===${slot}`, 'Environment ' + scene + '/' + slot);
    return audio(scene + '/' + slot, { environment: { scene, slot, active: true }, active: true, timerScheduled: true, enabled: true, hidden: false, unlocked: true, ctxState: 'running' });
  }
  try {
    chrome = spawn(CHROME, ['--headless=new', '--remote-debugging-address=127.0.0.1', `--remote-debugging-port=${PORT}`,
      `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--mute-audio',
      '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
      '--disable-features=Translate,MediaRouter', '--window-size=1280,1000', 'about:blank'], { stdio: 'ignore' });
    state.done = new Promise(resolve => {
      chrome.once('error', error => { state.error = error; state.exited = true; resolve(); });
      chrome.once('exit', () => { state.exited = true; resolve(); });
    });
    cdp = await CDP.connect(await targetOf(state));
    await cdp.send('Page.enable'); await cdp.send('Runtime.enable'); await cdp.send('Log.enable');
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: PROBE });
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 1000, deviceScaleFactor: 1, mobile: false });
    await cdp.send('Page.navigate', { url: URL });
    await cdp.wait(`document.readyState==='complete' && window.FZ?.World && !document.querySelector('#world-veil').classList.contains('on') && !document.querySelector('#world-veil').classList.contains('off')`, 'World boot', 90000);
    assert(await cdp.eval('FZ.World.isOk()'), 'Real WebGL unavailable');
    await cdp.eval(`(() => {
      FZ.World.setQuality('low');
      const p=__worldAudioProbe, play=FZ.Audio.play;
      FZ.Audio.play=function(name,...args){
        const before=p.starts.length, previous=p.tag; p.tag=name;
        try { return play.call(this,name,...args); }
        finally {p.plays.push({name,wall:performance.now(),sources:p.starts.length-before});p.tag=previous;}
      };
    })()`);
    await check('fresh-title-locked', async () => {
      const d = await cdp.eval('FZ.Audio.debug()');
      assert.equal(d.unlocked, false); assert.equal(d.ctxState, 'uninitialized'); assert.equal(d.active, false); assert.equal(d.timerScheduled, false);
      return d;
    });
    await check('trusted-sound-toggle-unlocks-title', async () => {
      await cdp.click('#btn-sound');
      await audio('title muted', { enabled: false, unlocked: true, active: false, timerScheduled: false }, false);
      await cdp.click('#btn-sound');
      await audio('title enabled', { enabled: true, unlocked: true, active: false, timerScheduled: false }, false, 2500);
      const trusted = await cdp.eval('__worldAudioProbe.trusted');
      assert(trusted.filter(e => e.id === 'btn-sound' && e.trusted).length >= 2);
      return trusted;
    });
    await cdp.click('#btn-start');
    await cdp.wait(`document.querySelector('#screen-game').classList.contains('active') && !!(${SAVE}) && FZ.Audio.debug().active`, 'Trusted start');
    const checkpoint = await cdp.eval(SAVE);
    console.log('START ' + JSON.stringify({ scene: checkpoint.currentEvent.scene, slot: checkpoint.slot, phase: checkpoint.phase }));
    await check('real-story-arrival-and-cafe-chat', async () => {
      await cdp.click('#btn-go');
      await cdp.wait(`FZ.World.debug().arrived && FZ.World.debug().phase==='event'`, 'Real story arrival', 150000);
      await cdp.click('#btn-campus');
      await cdp.click('#npc-roster button[data-npc="barista"]');
      await cdp.click('#btn-npc-visit');
      await cdp.wait(`document.querySelector('#campus-dialog').open && document.querySelector('#npc-name').textContent==='苏晚' && !document.querySelector('#npc-chat-form').hidden`, 'Actual cafe NPC arrival', 150000);
      await env('cafe', checkpoint.slot);
      await cdp.click('#npc-topics button[data-topic="barista_aroma"]');
      assert((await cdp.eval(`document.querySelector('#npc-reply').textContent`)).includes('豆子'));
      await cdp.shot('cafe-suwan-chat-desktop-fullpage', true);
      const calls = await cdp.eval(`__worldAudioProbe.plays.filter(p=>['arrival','chatOpen','chatReply'].includes(p.name))`);
      for (const name of ['arrival', 'chatOpen', 'chatReply']) assert(calls.some(p => p.name === name && p.sources > 0), name + ' did not start real sources via UI');
      assert.deepStrictEqual(progress(await cdp.eval(SAVE)), progress(checkpoint));
      return { calls, npcName: await cdp.eval(`document.querySelector('#npc-name').textContent`) };
    });
    await check('mobile-390x844-twelve-person-roster', async () => {
      if (!await cdp.eval(`document.querySelector('#campus-dialog').open`)) await cdp.click('#btn-campus');
      await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
      await cdp.eval(`document.querySelector('#campus-dialog').scrollTo({top:0,behavior:'instant'}); new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))`);
      const layout = await cdp.eval(`(() => {
        const roster=[...document.querySelectorAll('#npc-roster button')];
        return {width:innerWidth,height:innerHeight,pageWidth:document.documentElement.scrollWidth,
          roster:roster.map(e=>{const b=e.getBoundingClientRect();return {id:e.dataset.npc,name:e.innerText,x:b.x,y:b.y,w:b.width,h:b.height,visible:b.top>=0&&b.bottom<=innerHeight&&b.left>=0&&b.right<=innerWidth};})};
      })()`);
      await cdp.shot('npc-roster-mobile-390x844');
      assert.equal(layout.roster.length, 12); assert.equal(layout.width, 390); assert.equal(layout.height, 844);
      assert.equal(layout.pageWidth, 390); assert(layout.roster.every(r => r.visible), 'Not all twelve roster entries fit in mobile viewport');
      return layout;
    });
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 1000, deviceScaleFactor: 1, mobile: false });
    if (await cdp.eval(`document.querySelector('#campus-dialog').open`)) await cdp.click('#btn-campus-close');
    await check('flat-mode-restores-mainline-and-new-npc-environments', async () => {
      if (await cdp.eval(`document.body.classList.contains('world-on')`)) await cdp.click('#btn-3d');
      await env(checkpoint.currentEvent.scene, checkpoint.slot);
      const results = [];
      for (const [id, scene] of [['baller','court'],['gardener','garden'],['photographer','garden'],['barista','cafe']]) {
        await cdp.click('#btn-campus');
        await cdp.click('#npc-roster button[data-npc="' + id + '"]');
        await cdp.click('#btn-npc-visit');
        await env(scene, checkpoint.slot);
        await cdp.click('#npc-topics button');
        assert(!await cdp.eval(`document.querySelector('#npc-chat-form').hidden`));
        await cdp.click('#btn-campus-close');
        await env(checkpoint.currentEvent.scene, checkpoint.slot);
        assert.deepStrictEqual(progress(await cdp.eval(SAVE)), progress(checkpoint), 'Flat chat changed mainline progress');
        results.push({ id, scene, restored: checkpoint.currentEvent.scene });
      }
      // Changing the selected person away from the active flat chat must restore the event too.
      await cdp.click('#btn-campus'); await cdp.click('#npc-roster button[data-npc="barista"]'); await cdp.click('#btn-npc-visit');
      await env('cafe', checkpoint.slot);
      await cdp.click('#npc-roster button[data-npc="baller"]');
      await env(checkpoint.currentEvent.scene, checkpoint.slot);
      await cdp.click('#btn-campus-close');
      return results;
    });
    if (!await cdp.eval(`document.body.classList.contains('world-on')`)) await cdp.click('#btn-3d');
    for (const scene of Object.keys(scenes)) for (const slot of [0, 2]) {
      await check('world-fixture-audio-and-image-' + scene + '-' + slot, async () => {
        const [x, z, yaw] = scenes[scene];
        // Visual/API fixture only: no save editing, callback replacement, fabricated arrival or scene internals.
        await cdp.eval(`FZ.World.beginSlot({scene:${J(scene)},day:1,slot:${slot}}); FZ.World.place(${x},${z},${yaw}); FZ.World.setPhase('event')`);
        await env(scene, slot);
        const count = await cdp.eval(`__worldAudioProbe.starts.filter(s=>s.tag===null).length`);
        await cdp.wait(`__worldAudioProbe.starts.filter(s=>s.tag===null).length>${count}`, 'Real scheduled environmental sources ' + scene + '/' + slot, 20000);
        const timerSources = await cdp.eval(`__worldAudioProbe.starts.filter(s=>s.tag===null).slice(${count})`);
        assert(timerSources.length > 0);
        await cdp.wait(`(() => {const d=FZ.World.debug();return Math.hypot(d.cam[0] - (${x}),d.cam[2] - (${z}))<0.035;})()`, 'Visual camera settling', 90000);
        await cdp.eval(`FZ.World.setQuality('high')`);
        try {
          await cdp.eval(`new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))`);
          const image = await cdp.eval(`new Promise(resolve=>requestAnimationFrame(()=>{
            const canvas=document.querySelector('#world canvas'), small=document.createElement('canvas');
            small.width=128;small.height=100;const ctx=small.getContext('2d');ctx.drawImage(canvas,0,0,128,100);
            const pixels=ctx.getImageData(0,0,128,100).data;let sum=0,min=255,max=0;
            for(let i=0;i<pixels.length;i+=4){const value=(pixels[i]+pixels[i+1]+pixels[i+2])/3;sum+=value;min=Math.min(min,value);max=Math.max(max,value);}
            resolve({data:canvas.toDataURL('image/png').split(',')[1],width:canvas.width,height:canvas.height,avg:sum/(pixels.length/4),min,max,world:FZ.World.debug()});
          }))`);
          const file = path.join(SHOTS, scene + '-' + (slot === 2 ? 'night' : 'day') + '-world.png');
          fs.writeFileSync(file, Buffer.from(image.data, 'base64')); delete image.data;
          console.log('SCREENSHOT ' + file);
          assert(image.avg > 0.5 && image.max - image.min > 4, 'Black/empty world image');
          assert.equal(image.world.dayNight, slot === 2 ? 'night' : 'day');
          return { file, timerSources, image };
        } finally { await cdp.eval(`FZ.World.setQuality('low')`); }
      });
    }
    await check('continuous-scene-slot-switches', async () => {
      for (let i = 0; i < 18; i++) {
        const scene = Object.keys(scenes)[i % 3], [x, z, yaw] = scenes[scene], slot = Math.floor(i / 3) % 3;
        await cdp.eval(`FZ.World.beginSlot({scene:${J(scene)},day:1,slot:${slot}});FZ.World.place(${x},${z},${yaw});FZ.World.setPhase('event');new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))`);
        await cdp.wait(`FZ.Audio.debug().environment.scene===${J(scene)} && FZ.Audio.debug().environment.slot===${slot} && FZ.Audio.debug().active && FZ.Audio.debug().timerScheduled`, 'Rapid scene ' + i);
      }
      return { switches: 18, final: await cdp.eval('FZ.Audio.debug()') };
    });
    await check('trusted-mute-zero-output-and-unmute-recovery', async () => {
      await cdp.click('#btn-sound');
      await audio('world muted', { enabled: false, active: false, timerScheduled: false }, false);
      const before = await cdp.eval('__worldAudioProbe.starts.length');
      await audio('world muted stable', { enabled: false, active: false, timerScheduled: false }, false);
      assert.equal(await cdp.eval('__worldAudioProbe.starts.length'), before, 'Muted audio still starts sources');
      await cdp.click('#btn-sound');
      await audio('world re-enabled', { enabled: true, active: true, timerScheduled: true, unlocked: true }, true, 2600);
    });
    await check('exam-phase-disables-environment', async () => {
      await cdp.eval(`FZ.World.setPhase('exam')`);
      await audio('exam API phase', { active: false, timerScheduled: false, enabled: true }, false, 2400);
      await cdp.eval(`FZ.World.setPhase('event')`);
      await audio('event restored after exam', { active: true, timerScheduled: true, enabled: true });
    });
    await check('restart-title-disables-environment', async () => {
      await cdp.click('#btn-restart');
      await cdp.wait(`document.querySelector('#screen-title').classList.contains('active')`, 'Real restart title');
      await audio('real title return', { active: false, timerScheduled: false, enabled: true }, false, 3500);
    });
    await check('no-browser-runtime-errors', async () => {
      assert.deepStrictEqual(cdp.errors, []);
      return { errors: cdp.errors, warnings: cdp.warnings };
    });
    console.log('PROBE_SUMMARY ' + JSON.stringify(await cdp.eval(`({contexts:__worldAudioProbe.contexts.map(c=>({state:c.state,sampleRate:c.sampleRate,time:c.currentTime})),starts:__worldAudioProbe.starts.length,trusted:__worldAudioProbe.trusted.filter(e=>['btn-start','btn-sound'].includes(e.id)),uiSounds:__worldAudioProbe.plays.filter(p=>['arrival','chatOpen','chatReply'].includes(p.name))})`)));
  } catch (error) {
    failures.push({ label: 'fatal', error: error.stack }); console.log('FATAL ' + error.stack);
    if (cdp) { try { await cdp.shot('worldaudio-failure', true); } catch (_) {} }
  } finally {
    if (chrome) await cleanup(chrome, state, cdp, profile).catch(error => { failures.push({ label: 'cleanup', error: error.stack }); });
    else fs.rmSync(profile, { recursive: true, force: true });
  }
  console.log('RESULT ' + JSON.stringify({ measurements: measurements.length, failures, screenshots: SHOTS, limits: ['Audio graph measured before Chrome --mute-audio output suppression; no listening/quality claim.', 'Exam and six day/night scenes are public World API fixtures, not fabricated navigation.', 'No save injection; all game storage is isolated in the deleted temporary Chrome profile.', 'Mobile is Chrome viewport emulation, renderer is SwiftShader.'] }));
  if (failures.length) process.exitCode = 1;
}
main().catch(error => { console.error(error.stack); process.exitCode = 1; });
