'use strict';
// 统一闹钟（2026-11-01）
// 用户原话：「放在后台就没法自动循环了」「主要还是保证切页面、没有在前台的情况下，
// 自动循环讲解能够生效」。
// 判据：注册后按拍广播、注销即停、统计可查。
//
// ⚠️ 这里**故意不提供 chrome.tabs** —— 离屏文档里本来就没有它（Chrome 只开放
// chrome.runtime）。第一版按 tabId 逐个 tabs.sendMessage，实机静默失败、beat.n
// 一直是 0。测试环境必须同样没有 tabs，防止哪天又写回去。
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const assert = require('node:assert/strict');

const code = fs.readFileSync(path.join(__dirname, '../src/offscreen/ticker.js'), 'utf8');

const listeners = [];
const calls = [];
let lastError = null;

class FakeWorker {
  constructor(url) {
    this.url = url;
    this.onmessage = null;
    this.onerror = null;
    FakeWorker.last = this;
  }
  postMessage(d) { this.sent = d; }
  terminate() { this.dead = true; }
}

const context = vm.createContext({
  chrome: {
    runtime: {
      get lastError() { return lastError; },
      onMessage: { addListener: (fn) => listeners.push(fn) },
      sendMessage: (msg, cb) => {
        calls.push(msg);
        if (cb) cb();
      }
    }
    // 刻意不提供 chrome.tabs
  },
  Worker: FakeWorker,
  // 测试里不让兜底定时器真跑起来，否则脚本退不出去。
  setInterval: () => 0,
  clearInterval: () => {},
  Date, Number, Object, console
});

vm.runInContext(code, context);

assert.equal(listeners.length, 1, 'ticker.js 应注册一个消息监听');
const onMsg = listeners[0];

// ---- ① 注册即起拍：Worker 建好，一拍能广播出去 ----
let res = null;
onMsg({ type: 'dyc:beatReg', tabId: 61 }, {}, (r) => { res = r; });
assert.ok(res && res.ok, '注册应回 ok');
assert.ok(FakeWorker.last, 'Worker 应该被创建');
assert.equal(FakeWorker.last.sent, 'start', 'Worker 应收到 start');

FakeWorker.last.onmessage({ data: 1000 });
assert.equal(calls.length, 1, '注册后应广播一拍');
assert.equal(calls[0].type, 'dyc:beatTick', '消息类型不对（离屏只报 tick，由 SW 转发给标签）');
assert.equal(calls[0].at, 1000, '拍子要带时间戳（页面靠它做绝对时间比较）');

// ---- ② 注销即停 ----
onMsg({ type: 'dyc:beatOff', tabId: 61 }, {}, () => {});
FakeWorker.last.onmessage({ data: 2000 });
assert.equal(calls.length, 1, '注销之后不该再广播');

// ---- ③ 统计：没有注册标签时 n=0，且 Worker 应停掉（空闲不许空转耗电） ----
let stat = null;
onMsg({ type: 'dyc:beatStat' }, {}, (r) => { stat = r; });
assert.equal(stat.n, 0, '没有注册标签时 n 应为 0');
assert.equal(stat.worker, false, '没有注册标签时应停掉 Worker，空闲不许空转');

// ---- ④ 多个标签注册只广播一次（不是每个标签一条消息） ----
onMsg({ type: 'dyc:beatReg', tabId: 71 }, {}, () => {});
onMsg({ type: 'dyc:beatReg', tabId: 72 }, {}, () => {});
const before = calls.length;
FakeWorker.last.onmessage({ data: 3000 });
assert.equal(calls.length, before + 1, '多个标签也只广播一条，由页面各自判断');
assert.equal(calls[calls.length - 1].at, 3000, '最后一拍的时间戳要正确');
