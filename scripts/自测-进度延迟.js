'use strict';
// 过程提示的延迟闸门（2026-10-29 用户定）
// 用户原话：「清空库存的过程的提示 2/3 一闪而过，感觉出现重复提示了，
// 如果结果那么快出就不要展示过程了」。
// 判据：快路径一条过程消息都不出现；慢路径只出现一条、后续只改同一句；
// 收尾时能告诉调用方「屏幕上有没有过程消息要收」。
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const assert = require('node:assert/strict');

const code = fs.readFileSync(path.join(__dirname, '../src/content/clear-stock.js'), 'utf8');
const dialog = fs.readFileSync(path.join(__dirname, '../src/content/dialog.js'), 'utf8');

function sliceFn(name) {
  const start = code.indexOf('function ' + name + '(');
  assert.ok(start > 0, '源码里没找到 ' + name);
  let depth = 0, opened = false;
  for (let i = start; i < code.length; i++) {
    if (code[i] === '{') { depth++; opened = true; }
    else if (code[i] === '}') { depth--; if (opened && depth === 0) return code.slice(start, i + 1); }
  }
  throw new Error(name + ' 没有闭合');
}

const timers = [];
const shown = [];

const context = vm.createContext({
  setStatus: (text, type, opts) => shown.push({ text, type, opts }),
  setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; },
  clearTimeout: (id) => { if (id > 0) timers[id - 1] = null; }
});
vm.runInContext(sliceFn('createProgressGate'), context);

// ---- ① 快路径：结果先到，一条过程消息都不该出现 ----
let gate = context.createProgressGate('测试');
gate.say('正在保存…');
assert.equal(shown.length, 0, '计时器没到不能先出消息');
assert.equal(gate.stop(), false, '没显示过 ⇒ 不用让结果去收');
timers.forEach((t) => { if (t) t.fn(); });
assert.equal(shown.length, 0, '收尾后计时器再到点也不许补一条');

// ---- ② 慢路径：到点才亮，后续只改同一句 ----
timers.length = 0; shown.length = 0;
gate = context.createProgressGate('测试');
gate.say('正在清零…');
assert.equal(timers.length, 1, '一次 say 只挂一个计时器');
timers[0].fn();
assert.equal(shown.length, 1, '超过阈值要出过程消息');
assert.equal(shown[0].text, '正在清零…');
assert.equal(shown[0].type, 'running');
gate.say('正在保存…');
assert.equal(shown.length, 2, '已显示后再 say 走同一句（setStatus 就地合并）');
assert.equal(shown[1].text, '正在保存…');
assert.equal(gate.stop(), true, '显示过 ⇒ 结果消息要把这条收掉');
gate.say('不该再出现');
assert.equal(shown.length, 2, 'stop 之后再 say 无效');

// ---- ③ 连续 say 还没到点时，亮出来的是最新文案 ----
timers.length = 0; shown.length = 0;
gate = context.createProgressGate('测试');
gate.say('第一句');
gate.say('第二句');
assert.equal(timers.length, 1, '没到点之前不该重复挂计时器');
timers[0].fn();
assert.equal(shown.length, 1);
assert.equal(shown[0].text, '第二句', '亮出来的是最后一句');

// ---- ④ 结果消息按来源收过程消息（dialog.js）----
assert.match(dialog, /if \(opts\.dropRunning\)/, 'dialog.js 应支持 dropRunning');
assert.match(dialog, /e\._type !== 'running'/, '只收 running 类型');
assert.match(dialog, /source && e\._source !== source/, '传了来源就只收同来源，别误伤别的功能');

console.log('进度延迟自测：13/13 通过；快路径不出过程消息，慢路径只一条，收尾能收干净。');
