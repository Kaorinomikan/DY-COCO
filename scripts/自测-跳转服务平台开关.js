'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'src/content/flags.js'), 'utf8');
let stored = {}, listeners = [];
const context = vm.createContext({
  window: {},
  chrome: {
    runtime: { sendMessage(message, cb) {
      stored = { ...stored, [message.key]: message.value };
      listeners.forEach((fn) => fn({dybFeatures: {newValue: stored}}, 'local'));
      cb({ok: true});
    } },
    storage: {
      local: { get(key, cb) { cb({dybFeatures: stored}); } },
      onChanged: { addListener(fn) { listeners.push(fn); } }
    }
  }
});
vm.runInContext(source, context);
(async () => {
  const meta = context.DYC_FLAGS_META.filter((m) => m.key === 'servicePlatformJump');
  assert.equal(meta.length, 1);
  assert.deepEqual(Array.from(meta[0].pages).sort(), ['compassLive', 'liveScreenPage']);
  assert(!context.DYC_FLAGS_META.some((m) => ['liveScreenJump', 'liveDetailJump'].includes(m.key)));
  for (const [previous, expected] of [
    [{}, true],
    [{liveScreenJump: true, liveDetailJump: true}, true],
    [{liveScreenJump: false}, false],
    [{liveDetailJump: false}, false],
    [{liveScreenJump: false, liveDetailJump: false}, false],
    [{servicePlatformJump: true, liveScreenJump: false, liveDetailJump: false}, true],
    [{servicePlatformJump: false, liveScreenJump: true, liveDetailJump: true}, false]
  ]) {
    stored = {...previous};
    assert.equal((await context.dycReadFlags()).servicePlatformJump, expected);
    assert.equal((await context.dycReadAllFlags()).servicePlatformJump, expected);
  }
  stored = {liveScreenJump: false, liveDetailJump: false, clearStock: false};
  let changed;
  context.dycWatchFlags((next) => { changed = next; });
  const gates = ['src/replay/replay-link.js', 'src/live/live-detail-jump.js'].map((file) => {
    const code = fs.readFileSync(path.join(root, file), 'utf8');
    const enabled = code.match(/function enabled\(\)\s*\{[^}]+\}/)[0];
    return (flags) => vm.runInNewContext('(' + enabled + ')()', {flags, onThisPage: () => true});
  });
  for (const next of [true, false, true]) {
    await context.dycWriteFlag('servicePlatformJump', next);
    const read = await context.dycReadFlags();
    assert.equal(changed.servicePlatformJump, next);
    assert.equal((await context.dycReadAllFlags()).servicePlatformJump, next);
    gates.forEach((gate) => assert.equal(gate(read), next));
    assert.equal(read.clearStock, false);
  }
  console.log('统一跳转开关：旧设置兼容、菜单唯一性、两页覆盖、读写及即时订阅通过。');
})().catch((error) => { console.error(error); process.exitCode = 1; });
