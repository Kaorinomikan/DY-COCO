'use strict';

// 只在内存 DOM 夹具中计调用次数；不把这些数字当成实机耗时。
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const cp = require('child_process');
const assert = require('assert');
const root = path.resolve(__dirname, '..');
const baseline = process.argv.includes('--baseline');
function source(file) {
  return baseline
    ? cp.execFileSync(process.env.DYC_GIT || 'git', ['show', (process.env.DYC_PERF_BASE || 'HEAD') + ':' + file], { cwd: root, encoding: 'utf8' })
    : fs.readFileSync(path.join(root, file), 'utf8');
}

function fixture(file, exports) {
  let clock = 100000;
  let seq = 0;
  const timers = new Map();
  const counts = { rect: 0, scan: 0, check: 0, rowScan: 0, wake: 0, write: 0 };
  const doc = {
    body: { isConnected: true }, hidden: false, documentElement: { clientWidth: 1600, clientHeight: 900 },
    addEventListener() {}, removeEventListener() {}, querySelector() { return null; },
    querySelectorAll() { return []; }, getElementById() { return null; }
  };
  function el(text, rect) {
    const style = new Proxy({ left: '', top: '', display: '' }, { set(obj, key, val) { counts.write++; obj[key] = val; return true; } });
    const classes = new Set();
    return {
      nodeType: 1, textContent: text || '', isConnected: true, parentElement: doc.body,
      style, hidden: false, id: '', getAttribute() { return null; }, querySelectorAll() { return []; },
      getBoundingClientRect() { counts.rect++; return rect || { left: 800, top: 100, right: 880, bottom: 124, width: 80, height: 24 }; },
      classList: { add(...xs) { xs.forEach(x => classes.add(x)); }, remove(...xs) { xs.forEach(x => classes.delete(x)); }, contains(x) { return classes.has(x); }, toggle(x, yes) { if (yes) classes.add(x); else classes.delete(x); } }
    };
  }
  const ctx = {
    window: { innerWidth: 1600, innerHeight: 900, addEventListener() {} }, document: doc,
    location: { href: 'https://example.com/not-live' }, console, Promise, Math, JSON, isFinite, parseFloat,
    Date: class extends Date { static now() { return clock; } },
    setTimeout(fn, ms) { const id = ++seq; timers.set(id, { fn, at: clock + ms }); return id; },
    clearTimeout(id) { timers.delete(id); }, setInterval() { return ++seq; }, clearInterval() {},
    requestAnimationFrame() { return 0; }, cancelAnimationFrame() {},
    dycReadFlags() { return { then() {} }; }, dycWatchFlags() {},
    chrome: { storage: { local: { get() { return Promise.resolve({}); } }, onChanged: { addListener() {} } } },
    MutationObserver: class { constructor(fn) { this.fn = fn; ctx.observer = this; } observe() {} disconnect() {} },
    getComputedStyle() { return { pointerEvents: 'auto' }; }
  };
  ctx.window.document = doc;
  ctx.window.localStorage = { getItem() { return null; } };
  vm.createContext(ctx);
  let src = source(file);
  src = src.replace(/\}\)\(\);\s*$/, '\nwindow.__perf = {' + exports + '};\n})();');
  vm.runInContext(src, ctx, { filename: file });
  return {
    api: ctx.window.__perf, ctx, doc, el, counts,
    time(t) { clock = t; },
    advance(ms) {
      const end = clock + ms;
      while (true) {
        const next = [...timers].filter(([, x]) => x.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!next) break;
        clock = next[1].at; timers.delete(next[0]); counts.wake++; next[1].fn();
      }
      clock = end;
    },
    pending() { return timers.size; }
  };
}

const loop = fixture('src/live/auto-loop-lecture.js', `
  ensureObserver, checkNow, place, onUserCancelClick, fireClick, snapshot,
  configure: function (f) {
    state.on = true; state.phase = 'wait';
    findCartPanel = function () { return f.doc.body; };
    findLiveRow = function () { f.counts.rowScan++; return null; };
    findRowByKey = function () { return null; };
    findRowByName = function () { return null; };
    paint = function () {};
  },
  positioning: function (header, lamp, cap, panel) {
    host = {}; refs = { cap: cap, panel: panel }; cartHeader = header; anchorRow = header;
    anchorMode = 'title'; lampSlotDX = 34; scrollHideUntil = 0;
    observerTarget = document.body; modalCovers = function () { return false; };
    document.querySelector = function () { return lamp; };
  },
  busy: function (yes) { state.busy = yes; },
  running: function () { state.on = true; state.phase = 'run'; state.group = 'min'; state.key = 'id:12345678'; state.product = '测试商品'; state.nextAt = Date.now() + 60000; },
  hide: function () { state.on = false; },
  due: function () {
    state.on = true; state.phase = 'run'; state.group = 'min'; state.key = 'id:12345678'; state.product = '测试商品';
    state.nextAt = Date.now() - 1; state.retryAt = 0;
  },
  cycles: function (fn) { doCycle = fn; },
  forceRow: function (row) { findLiveRow = function () { return row; }; },
  sameRow: function (row) { findRowByKey = function () { return row; }; },
  abortMark: function () { return abortSeq; }
`);
loop.api.configure(loop);
loop.api.ensureObserver();
const unrelated = loop.el('库存 10');
for (let i = 0; i < 40; i++) {
  loop.ctx.observer.fn([{ type: 'characterData', target: { nodeType: 3, textContent: '库存 ' + i, parentElement: unrelated }, oldValue: '库存 ' + (i - 1) }]);
  loop.advance(500);
  if ((i + 1) % 4 === 0) { loop.counts.check++; loop.api.checkNow(); }
}
const unrelatedCounts = { periodic: loop.counts.check, wake: loop.counts.wake, rowScan: loop.counts.rowScan };
if (!baseline) assert.equal(unrelatedCounts.rowScan, 10, '无关文本只保留周期检查');
loop.counts.rowScan = 0;
const lecture = loop.el('取消讲解');
loop.ctx.observer.fn([{ type: 'characterData', target: { nodeType: 3, textContent: '讲解', parentElement: lecture }, oldValue: '取消讲解' }]);
loop.advance(100);
loop.api.checkNow();
loop.advance(300);
const mergedScans = loop.counts.rowScan;
if (!baseline) assert.equal(mergedScans, 1, '周期检查吸收已排队的 DOM 检查');

const extension = loop.el('取消讲解'); extension.id = 'dyc-test-host';
loop.counts.rowScan = 0;
loop.ctx.observer.fn([{ type: 'childList', target: extension, addedNodes: [loop.el('讲解中')], removedNodes: [] }]);
loop.advance(400);
const extensionScans = loop.counts.rowScan;
if (!baseline) assert.equal(extensionScans, 0, '扩展子树不唤醒');

loop.counts.rowScan = 0;
loop.ctx.observer.fn([{ type: 'characterData', target: { nodeType: 3, textContent: '', parentElement: unrelated }, oldValue: '讲解中' }]);
loop.advance(300);
assert.equal(loop.counts.rowScan, 1, '讲解标记清空仍即时唤醒');
loop.ctx.observer.fn([{ type: 'childList', target: loop.doc.body, addedNodes: [loop.el('')], removedNodes: [] }]);
loop.advance(300);
assert.equal(loop.counts.rowScan, 2, '尚未填字的平台新节点也保留唤醒');
loop.api.hide();
loop.ctx.observer.fn([{ type: 'characterData', target: { nodeType: 3, textContent: '讲解中' }, oldValue: '' }]);
if (!baseline) assert.equal(loop.pending(), 0, '停用时不排唤醒');
loop.advance(300);
loop.api.configure(loop);

const header = loop.el('标题', { left: 0, top: 100, right: 1000, bottom: 130, width: 1000, height: 30 });
const lamp = loop.el('', { left: 800, top: 100, right: 826, bottom: 126, width: 26, height: 26 });
const cap = loop.el(''), panel = loop.el('');
loop.api.positioning(header, lamp, cap, panel);
loop.counts.rect = 0;
for (let i = 0; i < 40; i++) { loop.api.place(); loop.advance(250); }
const loopRects = loop.counts.rect;
if (!baseline) assert.equal(loopRects, 80, '胶囊每拍只量锚点与圆钮各一次');
loop.api.busy(true); loop.counts.rect = 0; const writes = loop.counts.write;
loop.api.place(); assert.equal(loop.counts.rect, 0, '定位中不读矩形'); assert.equal(loop.counts.write, writes, '定位中不写坐标');
loop.api.busy(false);
loop.api.running(); const beforeCancel = loop.api.abortMark();
loop.api.onUserCancelClick({ isTrusted: true, target: lecture });
assert.equal(loop.api.snapshot().phase, 'off', '真人取消立即停止循环，需手动重开');
assert.equal(loop.api.snapshot().on, false, '取消后观察器不能自行重新启用');
assert(loop.api.abortMark() > beforeCancel, '真人取消中断异步链');
let cycles = 0;
loop.api.cycles(() => cycles++); loop.api.due(); loop.doc.hidden = true;
loop.api.checkNow(); assert.equal(cycles, 1, '后台到期仍按绝对时刻进入续讲');
loop.api.hide(); loop.api.checkNow(); assert.equal(cycles, 1, '停用后不再续讲');
loop.api.running(); loop.api.sameRow(loop.el('讲解'));
loop.api.checkNow(); assert.equal(loop.api.snapshot().phase, 'run', '一拍无标记不误停');
loop.api.checkNow(); assert.equal(loop.api.snapshot().phase, 'wait', '同款两拍无标记确认取消');
const dispatched = [];
const clickEl = { dispatchEvent(e) { dispatched.push(e.type); }, click() { dispatched.push('native-click'); } };
loop.ctx.MouseEvent = class { constructor(type) { this.type = type; } };
loop.ctx.PointerEvent = class { constructor(type) { this.type = type; } };
loop.api.fireClick(clickEl);
assert.deepEqual(dispatched, ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'], '正常内核恰好一套事件');
dispatched.length = 0;
loop.ctx.PointerEvent = undefined;
loop.api.fireClick(clickEl);
if (!baseline) assert.deepEqual(dispatched, ['mousedown', 'mouseup', 'click'], '缺 PointerEvent 独立降级且仅点一次');
dispatched.length = 0; loop.ctx.MouseEvent = undefined;
loop.api.fireClick(clickEl);
assert.deepEqual(dispatched, ['native-click'], '两类事件不可用时原生 click 仅一次');

const refresh = fixture('src/live/auto-refresh.js', `
  tick, findRefreshBtn, ensureLamp, canRefresh, onLampClick, judgeLive, timerTrend,
  restoreJudge: function (fn) { judgeLive = fn; tickCount = 0; },
  configure: function (f, btn, light) {
    flags = { liveAutoRefresh: true }; lamp = light; _refreshBtn = btn;
    _refreshMissAt = 0; mode = 'off'; liveState = 'prelive'; startedAt = 0; nextAt = Date.now() + 100000;
    judgeLive = function () {}; ensureStyle = function () {}; paintLamp = function () {};
    scrollingNow = function () { return false; }; coveredByOverlay = function () { return false; };
    refreshBusy = function () { return false; }; resetSettle = function () {};
    settle = function () { return null; }; settleEl = light;
    scanRefreshBtn = function () { f.counts.scan++; return f.replacement || btn; };
  },
  deadline: function () { nextAt = Date.now() - 1; mode = 'auto'; },
  live: function () { liveState = 'live'; autoStopped = true; },
  prelive: function () { liveState = 'prelive'; autoStopped = false; },
  signals: function (f) { hasLiveButton = function () { return f.live; }; timerTrend = function () { return f.trend; }; hasPreLiveBanner = function () { return f.banner; }; },
  state: function () { return { mode: mode, liveState: liveState, nextAt: nextAt }; },
  polite: function (f) { typingRecently = function () { return f.typing; }; popupOpen = function () { return f.popup; }; },
  refreshes: function (fn) { doRefresh = fn; },
  trendInput: function (el) { _timerEl = el; lastTimerVal = null; }
`);
const btn = refresh.el('刷新列表');
const light = refresh.el(''); light.parentElement = refresh.doc.body; light.style.left = '766px';
light.getAttribute = () => '3';
const realJudge = refresh.api.judgeLive;
refresh.api.configure(refresh, btn, light);
refresh.counts.rect = 0;
for (let i = 0; i < 40; i++) { refresh.api.tick(); refresh.advance(250); }
const refreshRects = refresh.counts.rect;
if (!baseline) assert.equal(refreshRects, 40, '刷新每拍只量原生按钮一次');
const freshBtn = refresh.el('刷新列表'); refresh.replacement = freshBtn; btn.isConnected = false;
assert.strictEqual(refresh.api.findRefreshBtn(), freshBtn, '断开旧按钮立即重扫新按钮');
assert.equal(refresh.counts.scan, 1, '节点替换只重扫一次');
const polite = { typing: false, popup: false };
refresh.api.polite(polite); refresh.api.deadline();
let refreshes = 0;
refresh.api.refreshes(() => { refreshes++; });
refresh.api.live(); refresh.api.tick(); assert.equal(refreshes, 0, '已开播自动停刷');
refresh.api.prelive(); polite.typing = true; refresh.api.tick(); assert.equal(refreshes, 0, '用户输入优先');
polite.typing = false; polite.popup = true; refresh.api.tick(); assert.equal(refreshes, 0, '打开浮层不刷');
polite.popup = false; refresh.doc.hidden = true; refresh.api.tick(); assert.equal(refreshes, 0, '后台不刷新');
refresh.doc.hidden = false; refresh.api.tick(); assert.equal(refreshes, 1, '前台条件恢复到期刷新');
refresh.api.signals({ live: true, trend: null, banner: true });
refresh.api.restoreJudge(realJudge); refresh.api.prelive(); refresh.api.deadline();
refresh.api.tick();
assert.equal(refresh.api.state().liveState, 'live', '到期拍先确认开播再决定刷新');
assert.equal(refreshes, 1, '开播确认与到期重合不会多刷新一次');
refresh.api.onLampClick(); assert.equal(refresh.api.state().mode, 'force', '直播中用户一步接管强制档');
refresh.advance(601); refresh.api.onLampClick(); assert.equal(refresh.api.state().mode, 'off', '强制档用户立即停刷');

console.log(JSON.stringify({ mode: baseline ? '整改前 HEAD' : '整改后工作树', fixture: '40 拍，每拍 250ms；无关文本 40 次，每次 500ms；仅内存调用数', unrelated: unrelatedCounts, mergedScans, extensionScans, loopRects, refreshRects, behavior: '定位冻结、真人取消、后台续讲到期、节点替换、开播停刷、输入/浮层/后台让路通过' }, null, 2));
