'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.resolve(__dirname, '../期末周求生/js/audio.js'), 'utf8');
const scenes = ['campus', 'dorm', 'online', 'library', 'classroom', 'canteen', 'print', 'court', 'garden', 'cafe'];

function harness(options = {}) {
  const contexts = [], timers = new Map(), delays = [], listeners = new Map();
  let now = 0, nextId = 0, maxTimers = 0;

  class Param {
    constructor(owner) {
      this.owner = owner;
      this.value = 0;
      this.calls = [];
      if (options.noHold) this.cancelAndHoldAtTime = undefined;
    }
    record(method, ...args) {
      args.forEach((value) => assert.ok(Number.isFinite(value), `${method}: finite argument`));
      this.calls.push({ method, args });
      return this;
    }
    setValueAtTime(value, time) { this.value = value; return this.record('set', value, time); }
    exponentialRampToValueAtTime(value, time) { assert.ok(value > 0); return this.record('exponential', value, time); }
    linearRampToValueAtTime(value, time) { return this.record('linear', value, time); }
    setTargetAtTime(value, time, constant) { return this.record('target', value, time, constant); }
    cancelScheduledValues(time) { return this.record('cancel', time); }
    cancelAndHoldAtTime(time) { return this.record('hold', time); }
  }

  class Node {
    constructor(context, kind) {
      this.context = context;
      this.kind = kind;
      this.connections = [];
      this.stopAt = Infinity;
      this.ended = false;
      this.disconnects = 0;
      for (const key of ['gain', 'frequency', 'detune', 'pan', 'Q', 'playbackRate', 'threshold', 'knee', 'ratio', 'attack', 'release']) {
        this[key] = new Param(this);
      }
      context.nodes.push(this);
    }
    connect(node) { this.connections.push(node); return node; }
    disconnect() { this.disconnects++; this.connections = []; }
    start(time = 0) { this.startAt = time; this.context.sources.push(this); }
    stop(time = 0) { assert.ok(Number.isFinite(time)); this.stopAt = time; }
  }

  class AudioContext {
    constructor() {
      this.nodes = [];
      this.sources = [];
      this.currentTime = 0;
      this.sampleRate = 1000;
      this.state = options.state || 'running';
      this.events = new Map();
      this.resumeCalls = 0;
      this.destination = new Node(this, 'destination');
      contexts.push(this);
    }
    createGain() { return new Node(this, 'gain'); }
    createOscillator() { return new Node(this, 'oscillator'); }
    createBufferSource() { return new Node(this, 'bufferSource'); }
    createBiquadFilter() { return new Node(this, 'filter'); }
    createStereoPanner() { return options.noPanner ? null : new Node(this, 'panner'); }
    createDynamicsCompressor() { return new Node(this, 'compressor'); }
    createConvolver() { return new Node(this, 'convolver'); }
    createBuffer(channels, length) {
      const data = Array.from({ length: channels }, () => new Float32Array(length));
      return { getChannelData: (channel) => data[channel] };
    }
    addEventListener(name, callback) { this.events.set(name, callback); }
    setState(state) { this.state = state; this.events.get('statechange')?.(); }
    resume() {
      this.resumeCalls++;
      if (options.resume === 'deferred') {
        return new Promise((resolve) => { this.completeResume = () => { this.setState('running'); resolve(); }; });
      }
      if (options.resume === 'reject') return Promise.reject(new Error('Gesture required'));
      this.setState('running');
      return Promise.resolve();
    }
    advance(seconds) {
      if (this.state === 'running') this.currentTime += seconds;
      for (const node of this.sources) {
        if (!node.ended && node.stopAt <= this.currentTime) {
          node.ended = true;
          node.onended?.();
        }
      }
    }
  }

  const document = { hidden: false, addEventListener: (name, callback) => listeners.set(name, callback) };
  const math = Object.create(Math);
  math.random = () => 0.5;
  const sandbox = {
    window: { AudioContext: options.unsupported ? undefined : AudioContext },
    document, Math: math, console,
    setTimeout(callback, delay) {
      assert.ok(delay >= 4000, `Environment interval ${delay} is at least four seconds`);
      const id = ++nextId;
      timers.set(id, { callback, due: now + delay });
      delays.push(delay);
      maxTimers = Math.max(maxTimers, timers.size);
      return id;
    },
    clearTimeout: (id) => timers.delete(id)
  };
  if (options.noPanner) AudioContext.prototype.createStereoPanner = undefined;
  sandbox.window.FZ = {};
  sandbox.FZ = sandbox.window.FZ;
  vm.runInNewContext(source, sandbox, { filename: 'audio.js' });

  function advance(ms) {
    const end = now + ms;
    while (timers.size) {
      const [id, timer] = [...timers].sort((a, b) => a[1].due - b[1].due)[0];
      if (timer.due > end) break;
      contexts.forEach((context) => context.advance((timer.due - now) / 1000));
      now = timer.due;
      timers.delete(id);
      timer.callback();
    }
    contexts.forEach((context) => context.advance((end - now) / 1000));
    now = end;
  }

  return {
    audio: sandbox.FZ.Audio, contexts, timers, delays, advance,
    get context() { return contexts[0]; },
    get maxTimers() { return maxTimers; },
    hide(value) { document.hidden = value; listeners.get('visibilitychange')(); },
    fire() { assert.equal(timers.size, 1); advance([...timers.values()][0].due - now); }
  };
}

function buses(context) {
  const duck = context.nodes.find((node) => node.kind === 'gain' && node.connections.some((out) => out.kind === 'compressor'));
  const master = context.nodes.find((node) => node.connections.includes(duck));
  const environment = context.nodes.find((node) => node.kind === 'gain' && node.connections.includes(master));
  return { master, duck, environment };
}

function reaches(node, destination, blocked, seen = new Set()) {
  if (node === blocked || seen.has(node)) return false;
  if (node === destination) return true;
  seen.add(node);
  return (node.connections || (node.owner ? [node.owner] : [])).some((out) => reaches(out, destination, blocked, seen));
}

function start(h, scene = 'campus', slot = 0) {
  h.audio.setEnvironment({ scene, slot, active: true });
  h.audio.unlock();
  assert.equal(h.timers.size, 1);
}

function last(param, method) { return param.calls.filter((call) => call.method === method).at(-1); }

test('environment, play, visibility and enable updates never create a context before unlock', () => {
  const h = harness();
  for (const scene of scenes) for (const slot of [0, 1, 2]) h.audio.setEnvironment({ scene, slot, active: true });
  h.audio.play('tap');
  h.audio.duck(0.2, 1);
  h.audio.setEnabled(false);
  h.audio.setEnabled(true);
  h.hide(true);
  h.hide(false);
  assert.equal(h.contexts.length, 0);
  assert.equal(h.timers.size, 0);
  assert.equal(h.audio.debug().ctxState, 'uninitialized');
  assert.equal(h.audio.debug().active, false);
  h.audio.unlock();
  assert.equal(h.contexts.length, 1);
  assert.equal(h.timers.size, 1);
});

test('unlock while hidden or disabled defers initialization until it is allowed', () => {
  const h = harness();
  h.audio.setEnvironment({ active: true });
  h.hide(true);
  h.audio.unlock();
  h.audio.setEnabled(false);
  h.hide(false);
  assert.equal(h.contexts.length, 0);
  h.audio.setEnabled(true);
  assert.equal(h.contexts.length, 1);
  assert.equal(h.timers.size, 1);
});

test('10 Hz style identical updates and day slots are idempotent', () => {
  const h = harness();
  start(h);
  const count = h.context.nodes.length, id = [...h.timers.keys()][0];
  const calls = buses(h.context).environment.gain.calls.length;
  for (let i = 0; i < 1000; i++) h.audio.setEnvironment({ scene: 'campus', slot: i % 2, active: true });
  assert.equal(h.context.nodes.length, count);
  assert.equal(buses(h.context).environment.gain.calls.length, calls);
  assert.equal([...h.timers.keys()][0], id);
  assert.equal(h.delays.length, 1);
  assert.equal(h.maxTimers, 1);
});

test('all ten scenes and three slots route every event exclusively through the environment bus', () => {
  for (const noPanner of [false, true]) {
    const h = harness({ noPanner });
    start(h);
    const { master, duck, environment } = buses(h.context);
    assert.ok(environment.connections.includes(master));
    assert.ok(master.connections.includes(duck));
    for (const scene of scenes) for (const slot of [0, 1, 2]) {
      h.audio.setEnvironment({ scene, slot, active: true });
      for (let i = 0; i < 3; i++) {
        const before = h.context.sources.length;
        h.fire();
        const sources = h.context.sources.slice(before);
        assert.ok(sources.length > 0, `${scene}/${slot} has an event`);
        for (const node of sources) {
          assert.ok(reaches(node, environment), `${scene}: source reaches environment bus`);
          assert.equal(reaches(node, master, environment), false, `${scene}: no dry or reverb bypass`);
          assert.ok(node.stopAt - node.startAt < 3, `${scene}: short finite event`);
        }
        h.advance(3000);
        assert.ok(sources.every((node) => node.ended && node.disconnects > 0));
      }
    }
    assert.equal(h.maxTimers, 1);
    assert.ok(h.delays.every((delay) => delay >= 4000));
  }
});

test('outdoor daytime birds change to quieter night insects', () => {
  const h = harness();
  start(h, 'garden');
  let before = h.context.sources.length;
  h.fire();
  const birds = h.context.sources.slice(before);
  assert.ok(birds.every((node) => node.kind === 'oscillator'));
  h.audio.setEnvironment({ slot: 2 });
  before = h.context.sources.length;
  h.fire();
  const insects = h.context.sources.slice(before);
  assert.equal(insects.length, 3);
  assert.ok(insects.every((node) => node.kind === 'bufferSource'));
  const insectGain = insects[0].connections[0].connections[0];
  assert.ok(insectGain.gain.calls.find((call) => call.method === 'exponential').args[0] < 0.01);
});

test('scene changes fade and retire old events without building nodes on state updates', () => {
  for (const noHold of [false, true]) {
    const h = harness({ noHold });
    start(h, 'print');
    const before = h.context.sources.length;
    h.fire();
    const oldSources = h.context.sources.slice(before), time = h.context.currentTime;
    const root = buses(h.context).environment;
    const eventBus = h.context.nodes.filter((node) => node.connections.includes(root)).at(-1);
    const count = h.context.nodes.length;
    for (let i = 0; i < 50; i++) h.audio.setEnvironment({ scene: scenes[i % scenes.length], slot: i % 3 });
    assert.equal(h.context.nodes.length, count);
    assert.equal(last(eventBus.gain, 'linear').args[0], 0);
    assert.ok(oldSources.every((node) => node.stopAt <= time + 0.24));
    assert.equal(h.timers.size, 1);
    h.advance(300);
    assert.ok(oldSources.every((node) => node.ended));
    assert.equal(eventBus.connections.length, 0);
    assert.equal(h.maxTimers, 1);
  }
});

test('muting, hiding and inactivity clear timers; restores have just one timer', () => {
  const h = harness();
  start(h, 'cafe');
  h.fire();
  const { master, environment } = buses(h.context);
  h.audio.setEnabled(false);
  assert.equal(master.gain.value, 0);
  assert.equal(h.timers.size, 0);
  h.audio.setEnvironment({ scene: 'court' });
  const count = h.context.nodes.length;
  h.audio.play('tap');
  h.advance(60000);
  assert.equal(h.context.nodes.length, count);
  h.audio.setEnabled(true);
  h.audio.setEnabled(true);
  h.audio.unlock();
  assert.equal(h.timers.size, 1);
  const stale = [...h.timers.values()][0].callback;
  h.hide(true);
  assert.equal(h.audio.isEnabled(), true);
  assert.equal(master.gain.value, 0);
  assert.equal(h.timers.size, 0);
  assert.equal(h.audio.debug().active, false);
  h.audio.setEnabled(true);
  assert.equal(master.gain.value, 0);
  const hiddenCount = h.context.nodes.length;
  h.audio.play('win');
  h.advance(60000);
  assert.equal(h.context.nodes.length, hiddenCount);
  h.hide(false);
  const restored = [...h.timers.keys()][0];
  stale();
  assert.equal([...h.timers.keys()][0], restored);
  assert.equal(h.timers.size, 1);
  h.hide(true);
  h.audio.setEnabled(false);
  h.hide(false);
  assert.equal(h.audio.isEnabled(), false);
  assert.equal(master.gain.value, 0);
  assert.equal(h.timers.size, 0);
  h.audio.setEnabled(true);
  h.fire();
  h.audio.setEnvironment({ active: false });
  assert.equal(h.timers.size, 0);
  assert.equal(last(environment.gain, 'linear').args[0], 0);
  const inactiveCount = h.context.nodes.length;
  h.advance(60000);
  assert.equal(h.context.nodes.length, inactiveCount);
  h.audio.setEnvironment({ active: true });
  h.audio.setEnvironment({ active: true });
  assert.equal(h.timers.size, 1);
  assert.equal(h.maxTimers, 1);
});

test('pending resume and context state changes cannot revive hidden or inactive ambience', async () => {
  const h = harness({ state: 'suspended', resume: 'deferred' });
  h.audio.setEnvironment({ active: true });
  h.audio.unlock();
  h.audio.unlock();
  assert.equal(h.context.resumeCalls, 1);
  assert.equal(h.timers.size, 0);
  h.hide(true);
  h.context.completeResume();
  await Promise.resolve();
  assert.equal(buses(h.context).master.gain.value, 0);
  assert.equal(h.timers.size, 0);
  h.hide(false);
  assert.equal(h.timers.size, 1);
  h.context.setState('interrupted');
  assert.equal(h.timers.size, 0);
  h.audio.setEnvironment({ active: false });
  h.context.setState('running');
  assert.equal(h.timers.size, 0);
  h.audio.setEnvironment({ active: true });
  assert.equal(h.timers.size, 1);
  h.context.setState('closed');
  assert.equal(h.timers.size, 0);
  const rejected = harness({ state: 'suspended', resume: 'reject' });
  rejected.audio.setEnvironment({ active: true });
  rejected.audio.unlock();
  await Promise.resolve();
  assert.equal(rejected.timers.size, 0);
});

test('legacy APIs and SFX, new NPC cues and duck automation remain available', () => {
  const h = harness();
  for (const name of ['unlock', 'play', 'duck', 'setEnabled', 'isEnabled', 'supported', 'setEnvironment', 'debug']) {
    assert.equal(typeof h.audio[name], 'function');
  }
  assert.equal(h.audio.supported(), true);
  h.audio.unlock();
  const { master, environment, duck } = buses(h.context);
  const names = ['step', 'tap', 'hover', 'page', 'gainK', 'gainS', 'gainM', 'gainP', 'gain',
    'lossK', 'lossS', 'lossM', 'lossP', 'loss', 'mixed', 'combo', 'warn', 'warnS', 'warnM',
    'dayend', 'exam', 'stamp', 'win', 'fail', 'tick', 'arrival', 'chatOpen', 'chatReply'];
  for (const name of names) {
    const before = h.context.sources.length;
    h.audio.play(name);
    const sources = h.context.sources.slice(before);
    assert.ok(sources.length > 0, name);
    assert.ok(sources.some((node) => reaches(node, master)));
    assert.ok(sources.every((node) => !reaches(node, environment)), `${name} is not gated by active environment`);
  }
  assert.equal(h.timers.size, 0);
  const count = h.context.sources.length;
  h.audio.play('notAnAction');
  h.audio.play('__proto__');
  assert.equal(h.context.sources.length, count);
  h.audio.duck(0.25, 2);
  assert.deepEqual(duck.gain.calls.slice(-3), [
    { method: 'cancel', args: [0] },
    { method: 'target', args: [0.25, 0, 0.08] },
    { method: 'target', args: [1, 2, 0.25] }
  ]);
});

test('step keeps indoor/run options and adds distinct court, garden and cafe surfaces', () => {
  const h = harness();
  h.audio.unlock();
  const frequency = (options) => {
    const before = h.context.sources.length;
    h.audio.play('step', options);
    const noise = h.context.sources.slice(before).find((node) => node.kind === 'bufferSource');
    return last(noise.connections[0].frequency, 'set').args[0];
  };
  assert.equal(frequency({ indoor: true }), 620);
  assert.equal(frequency({ indoor: false }), 2100);
  assert.equal(frequency({ indoor: true, surface: 'unknown' }), 620);
  const variants = ['court', 'garden', 'cafe'].map((surface) => frequency({ surface, indoor: true, run: true }));
  assert.deepEqual(variants, [1350, 2900, 850]);
});

test('debug snapshots are immutable and invalid environment updates are safe', () => {
  const h = harness();
  h.audio.setEnvironment({ scene: 'library', slot: 2, active: true });
  for (const value of [undefined, null, 1, 'court', {}, { scene: '__proto__', slot: -1, active: 'false' }]) {
    h.audio.setEnvironment(value);
  }
  const snapshot = h.audio.debug();
  assert.equal(snapshot.environment.scene, 'library');
  assert.equal(snapshot.environment.slot, 2);
  assert.equal(snapshot.environment.active, true);
  assert.ok(Object.isFrozen(snapshot));
  assert.ok(Object.isFrozen(snapshot.environment));
  assert.throws(() => { snapshot.environment.scene = 'court'; }, TypeError);
  assert.throws(() => { snapshot.timerScheduled = true; }, TypeError);
  assert.ok(!Object.values(snapshot).some((value) => value && value.connect));
  assert.equal(h.contexts.length, 0);
});

test('unsupported WebAudio fails quietly without scheduling', () => {
  const h = harness({ unsupported: true });
  h.audio.setEnvironment({ active: true });
  h.audio.unlock();
  h.audio.play('arrival');
  h.audio.setEnabled(true);
  h.hide(true);
  h.hide(false);
  assert.equal(h.audio.supported(), false);
  assert.equal(h.audio.isEnabled(), false);
  assert.equal(h.contexts.length, 0);
  assert.equal(h.timers.size, 0);
});
