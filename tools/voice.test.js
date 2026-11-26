const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../期末周求生/js/voice.js'), 'utf8');
function setup() {
  const attempts = [], spoken = [];
  class Audio {
    constructor() { this.duration = 1; this.pauses = 0; }
    addEventListener() {}
    load() {}
    pause() { this.pauses++; }
    play() { return new Promise((resolve, reject) => attempts.push({ audio: this, resolve, reject })); }
  }
  const context = {
    Audio, SpeechSynthesisUtterance: class { constructor(text) { this.text = text; } },
    speechSynthesis: {
      getVoices: () => [], addEventListener() {}, cancel() {},
      speak: (utterance) => spoken.push(utterance.text)
    },
    FZ: { VOICE_LINES: {
      first: { clips: 1, mood: 'calm', say: ['第一条'] },
      second: { clips: 1, mood: 'calm', say: ['第二条'] }
    } }
  };
  context.window = context;
  vm.runInNewContext(source, context);
  return { voice: context.FZ.Voice, attempts, spoken };
}

for (const action of ['stop', 'mute']) {
  test(`${action} does not restart cancelled speech`, async () => {
    const { voice, attempts, spoken } = setup();
    voice.say('first');
    if (action === 'stop') voice.stop(); else voice.setEnabled(false);
    attempts[0].reject(Object.assign(new Error('cancelled'), { name: 'AbortError' }));
    await Promise.resolve();
    assert.deepEqual(spoken, []);
    assert.equal(voice.mode(), 'clip');
  });
}

test('an old rejection cannot replace the current audio', async () => {
  const { voice, attempts, spoken } = setup();
  voice.say('first');
  voice.say('second');
  attempts[0].reject(new Error('late failure'));
  await Promise.resolve();
  voice.stop();
  assert.equal(attempts[1].audio.pauses, 1);
  assert.deepEqual(spoken, []);
  assert.equal(voice.mode(), 'clip');
});

test('reusing a clip does not revive its old rejection', async () => {
  const { voice, attempts, spoken } = setup();
  voice.say('first');
  voice.say('second');
  voice.say('first');
  assert.equal(attempts[0].audio, attempts[2].audio);
  attempts[0].reject(new Error('late failure'));
  await Promise.resolve();
  assert.deepEqual(spoken, []);
  assert.equal(voice.mode(), 'clip');
});

test('a current decoding failure still falls back to TTS', async () => {
  const { voice, attempts, spoken } = setup();
  voice.say('first');
  attempts[0].reject(Object.assign(new Error('unsupported'), { name: 'NotSupportedError' }));
  await Promise.resolve();
  assert.deepEqual(spoken, ['第一条']);
  assert.equal(voice.mode(), 'tts');
});
