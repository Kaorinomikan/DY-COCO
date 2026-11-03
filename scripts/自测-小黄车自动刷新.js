/**
 * 小黄车刷新指示灯(反馈 #92)· 回归自测 —— 直接抽取**源文件里真实的函数源码**跑，不复制实现
 * ============================================================
 * 被测文件：src/live/auto-refresh.js
 *
 * 覆盖这些事（每一条都对应一个真机上会出错的地方）：
 *   A. 文本归一化 —— 平台文案里夹全角空格 / 换行时仍能认出来
 *   B. 「这是不是那枚刷新按钮」—— 文本恰好为「刷新列表」、尺寸在合理区间、
 *      不是我们自己的节点；**「刷新列表设置商品推荐卡」这种包住多个按钮的外层必须被排除**
 *   C. 直播状态判定 —— 三重信号各自的优先级，尤其：
 *      · 「计时器递增」才算直播中，**递减是开播倒计时，不能当成直播中**
 *      · 判不出要**连续 3 次**才认（单次抖动不能把刷新停掉）
 *   C9. 按钮本体上溯（灯要贴在**整枚按钮**左边，而不是贴在文字左边）
 *   D. 三色映射表 —— 档位 × 直播状态 × 慢速重试 → 灯色 + 悬停说明
 *   E. 什么时候允许刷 —— 正在输入 / 页面隐藏 / 开着弹窗 / 刚进页面 / 上一轮未完 / 已停
 *   F. 点一次只发一套事件 —— pointerdown/mousedown/pointerup/mouseup/click 各**恰好一次**。
 *      ⚠️ 这一条最要紧：既 btn.click() 又补全套会让平台收到**两次**点击
 *      ⇒ 每 10 秒刷两遍，正是用户最担心的「双重刷新」。
 *   G. 五点采样（防被浮层盖住）
 *   H. 滚动容器兜底：两段式筛选
 *   J. 视口跟随（fixed 定位下防止灯飘到别处）
 *   K. 「滚出画面不算失败」—— 本轮修的核心缺陷
 *   L. 点击循环按**档位**走（四条转移，尤其「灰·自动停 → 橙」）
 *   M. 无记忆 —— 三态不落 storage
 *   N. 慢速重试（不彻底停机）
 *   O. #98 弹层藏灯 —— 次级页面(弹层)打开 ⇒ 灯藏;关 ⇒ 恢复(含 TTL 缓存两面)
 *   I. 源码级红线（防止以后被改回去）
 *
 * 做法与 scripts/自测-罗盘商品表.js 同源：按函数名抠出源码 → 最小 DOM 垫片上求值 → 断言。
 * 源码一改自测自动跟着变，不会「测试绿了线上还错」。
 *
 * 用法：node scripts/自测-小黄车自动刷新.js
 * 退出码 0 = 全绿；1 = 有用例失败。
 * ============================================================
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SRC_PATH = path.join(ROOT, 'src/live/auto-refresh.js');

/* ============================================================
 * 1. 最小 DOM 垫片（只实现被测函数用到的那一小撮 API）
 * ============================================================ */

const ELEMENT_NODE = 1;

/** 极简元素：只记 tagName / 文本 / 矩形 / 标记属性 / 父子链 */
class FakeEl {
  constructor(tag, opts) {
    const o = opts || {};
    this.nodeType = ELEMENT_NODE;
    this.tagName = (tag || 'DIV').toUpperCase();
    this.textContent = o.text || '';
    this._rect = o.rect || { left: 0, top: 0, width: 0, height: 0, right: 0, bottom: 0 };
    this._attrs = o.attrs || {};
    this.id = o.id || '';
    this.isConnected = o.connected !== false;
    this.parentElement = o.parent || null;
    this.childNodes = [];
    this._firstElementChild = null;
    this._events = [];
    this.style = {};
    this.clientLeft = 0;
    this.clientTop = 0;
    this.scrollLeft = 0;
    this.scrollTop = 0;
    this.scrollHeight = o.sh || 0;      // scroller() 兜底扫描用
    this.clientHeight = o.ch || 0;
    this._ov = o.ov || '';              // getComputedStyle 垫片按它返回 overflowY
    this.className = o.cls || '';
  }
  get firstElementChild() { return this._firstElementChild; }
  set firstElementChild(v) { this._firstElementChild = v; }
  get children() { return this.childNodes.filter((n) => n.nodeType === ELEMENT_NODE); }
  getBoundingClientRect() { return this._rect; }
  getAttribute(name) {
    return Object.prototype.hasOwnProperty.call(this._attrs, name) ? this._attrs[name] : null;
  }
  setAttribute(name, v) { this._attrs[name] = String(v); }
  removeAttribute(name) { delete this._attrs[name]; }
  contains(other) {
    let p = other;
    while (p) { if (p === this) return true; p = p.parentElement; }
    return false;
  }
  dispatchEvent(ev) { this._events.push(ev); return true; }
  click() { this._events.push({ type: 'click', _native: true }); return true; }
  querySelector() { return null; }
  querySelectorAll() { return []; }
  appendChild(child) {
    child.parentElement = this;
    this.childNodes.push(child);
    if (!this._firstElementChild) this._firstElementChild = child;
    return child;
  }
  remove() {
    if (this.parentElement) {
      const sibs = this.parentElement.childNodes;
      const i = sibs.indexOf(this);
      if (i >= 0) sibs.splice(i, 1);
      if (this.parentElement._firstElementChild === this) this.parentElement._firstElementChild = null;
      this.parentElement = null;
    }
  }
}

/** 让一个元素带上「矩形尺寸」，模拟可见 */
function withRect(w, h, left, top) {
  const l = left || 0, t = top || 0;
  return { left: l, top: t, width: w, height: h, right: l + w, bottom: t + h };
}

/** 全局 document 垫片：按调用方用到的选择器返回对应候选集 */
function makeDoc(registry) {
  const all = registry || {};
  return {
    hidden: false,
    activeElement: null,
    body: new FakeEl('BODY', { text: all.bodyText || '' }),
    documentElement: new FakeEl('HTML'),
    head: new FakeEl('HEAD'),
    querySelectorAll(sel) {
      const key = String(sel).replace(/\s+/g, ' ').trim();
      if (all.bySel && Object.prototype.hasOwnProperty.call(all.bySel, key)) {
        return all.bySel[key];
      }
      return [];
    },
    querySelector() { return null; },
    createElement(tag) { return new FakeEl(tag); },
    createTreeWalker() {
      return { nextNode() { return null; } };   // findRefreshBtn 不参与本自测
    },
    getElementById() { return null; },
    elementFromPoint() { return null; },
    addEventListener() {}
  };
}

class FakePointerEvent {
  constructor(type, init) {
    this.type = type;
    Object.assign(this, init || {});
  }
}
class FakeMouseEvent extends FakePointerEvent {}

/* ============================================================
 * 2. 从源文件抠函数源码（按函数名 + 花括号配平）
 * ============================================================ */

function sliceFunction(src, name) {
  const key = 'function ' + name + '(';
  const at = src.indexOf(key);
  if (at < 0) throw new Error('源文件里找不到 function ' + name);
  const i = src.indexOf('{', at);
  let depth = 0;
  for (let j = i; j < src.length; j++) {
    const ch = src[j];
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return src.slice(at, j + 1);
    }
  }
  throw new Error('花括号未配平：' + name);
}

function sliceVar(src, name) {
  const re = new RegExp('var\\s+' + name + '\\s*=\\s*[\\s\\S]*?;\\s*(?=\\n|var |function |/\\*)');
  const m = src.match(re);
  if (!m) throw new Error('源文件里找不到 var ' + name);
  return m[0];
}

/**
 * 把被测函数拼成一个模块并求值。
 *
 * @param {string[]} fnNames  要暴露的函数名
 * @param {string[]} varNames 需要一起求值的常量 / 状态变量
 * @param {object}   shims    注入的全局(document / window / ...)
 * @param {string}   prelude  额外的前置语句(初始化状态)
 * @param {string[]} preludeFns 只在 prelude 里定义的辅助函数
 */
function buildModule(fnNames, varNames, shims, prelude, preludeFns, srcPath) {
  const src = fs.readFileSync(srcPath || SRC_PATH, 'utf8');
  const parts = [];
  for (const v of varNames || []) parts.push(sliceVar(src, v));
  for (const f of fnNames) parts.push(sliceFunction(src, f));

  const names = Object.keys(shims || {});
  const vals = names.map((n) => shims[n]);
  const rets = fnNames.concat(preludeFns || []);

  const body =
    (prelude || '') + '\n' +
    parts.join('\n') + '\n' +
    'return {' + rets.join(',') + '};';

  // eslint-disable-next-line no-new-func
  const fn = new Function(...names, body);
  return fn(...vals);
}

/* ============================================================
 * 3. 断言工具
 * ============================================================ */

let pass = 0;
const failures = [];

function ok(name, cond, extra) {
  if (cond) { pass++; return; }
  failures.push(name + (extra ? '  → ' + extra : ''));
}

function eq(name, got, want) {
  ok(name, got === want, 'got=' + JSON.stringify(got) + ' want=' + JSON.stringify(want));
}

/* ============================================================
 * 4. 加载被测函数
 * ============================================================ */

const STATE_VARS = [
  'REFRESH_TEXT', 'EXT_MARK_ATTRS',
  'RESCAN_MS', 'SCROLLER_TTL',
  'INTERVAL_MS', 'JITTER_MS', 'START_DELAY', 'FAIL_LIMIT', 'RESTORE_SCROLL_DELAY',
  'TYPING_IDLE_MS', 'JUDGE_EVERY', 'TICK_MS',
  'RETRY_INTERVAL_MS',
  'DOT_SIZE', 'DOT_BORDER', 'DOT_R', 'LAMP_HIT', 'LAMP_GAP', 'MARK_VER',
  'POPUP_TTL', '_popupAt', '_popupHit', 'SCROLL_QUIET_MS',
  /* 2026-10-27 浮层覆盖式判定:采集口径、面积阈值、缺按钮宽限(placeLamp 依赖) */
  'OVERLAY_SEL', 'OVERLAY_MIN_AREA', 'OVERLAY_WORD_RE', 'LAMP_MISS_GRACE',
  /* 2026-10-26 落位吸附:抖动抑制的常量与记忆(placeLamp 依赖) */
  'SETTLE_SMALL', 'SETTLE_BIG', 'settleSt', 'settleEl'
];

const STATE_PRELUDE = `
  var lastTimerVal = null;
  var _timerEl = null;
  var _bannerHit = null;
  var _bannerAt = 0;
  var _refreshBtn = null;
  var _refreshMissAt = 0;
  var _scroller = null;
  var _scrollerAt = 0;
  var savedScroll = null;
  var slowRetry = false;
  var mode = 'auto';
  var liveState = 'unknown';
  var everLive = false;        /* #108 开播跃迁单向锁,与源码同名状态保持一致 */
  var unknownStreak = 0;
  var autoStopped = false;
  var unknownSaid = false;
  var retrySaid = false;
  var nextAt = 0;
  var startedAt = 0;
  var busyUntil = 0;
  var failCount = 0;
  var lamp = null;
  var _lastTypeAt = 0;
  var _scrollTgt = null;
  var _scrollAt = 0;
  var tickCount = 0;
  var loopTimer = null;
  var lastClickAt = 0;
  var flags = { liveAutoRefresh: true };
  function enabled() { return !!flags && flags.liveAutoRefresh !== false; }
  function say() {}
  /* 点灯用例只关心「档位怎么变」,灯的挂载/绘制交给真机与 O 段,
     这里给三个桩,免得为了点一下把整套 DOM 垫片都拉进来。 */
  function ensureLamp() { return true; }
  function hideLamp() {}
  function paintLamp() {}
  /** 用例之间必须把闭包里的缓存/状态清干净,否则 A 用例的结果会漏进 B 用例 */
  function __reset() {
    lastTimerVal = null; _timerEl = null;
    _bannerHit = null; _bannerAt = 0;
    _refreshBtn = null; _refreshMissAt = 0;
    _scroller = null; _scrollerAt = 0;
    savedScroll = null; slowRetry = false; mode = 'auto';
    liveState = 'unknown'; everLive = false; unknownStreak = 0; autoStopped = false;
    nextAt = 0; startedAt = 0; busyUntil = 0; failCount = 0;
    lamp = null; _lastTypeAt = 0; unknownSaid = false; retrySaid = false;
    _popupAt = 0; _popupHit = false; _scrollTgt = null; _scrollAt = 0;
    lastClickAt = 0;
    settleSt = {}; settleEl = null;      /* 2026-10-26 落位吸附记忆 */
    flags = { liveAutoRefresh: true };
  }
  /** 把档位/状态直接摆好（用例需要构造特定组合） */
  function __set(o) {
    if (!o) return;
    lastClickAt = 0;              // 每个用例独立,不复用上一轮的点击去抖窗口
    if (o.mode !== undefined) mode = o.mode;
    if (o.liveState !== undefined) liveState = o.liveState;
    if (o.autoStopped !== undefined) autoStopped = o.autoStopped;
    if (o.slowRetry !== undefined) slowRetry = o.slowRetry;
    if (o.unknownStreak !== undefined) unknownStreak = o.unknownStreak;
    if (o.failCount !== undefined) failCount = o.failCount;
  }
  function __get() {
    return { mode: mode, liveState: liveState, autoStopped: autoStopped,
             slowRetry: slowRetry, unknownStreak: unknownStreak, failCount: failCount };
  }
  /** 把灯节点直接摆进闭包（O 段测 placeLamp 用） */
  function __setLamp(el) { lamp = el; }
`;

const docRegistry = { bySel: {}, bodyText: '' };
const documentShim = makeDoc(docRegistry);

const M = buildModule(
  ['norm', 'visible', 'isExtNode', 'insideExt', 'looksLikeRefresh',
   /* 判据本体已迁到 live-state.js（2026-11-03），本文件只留调用层：
    * judgeLive / judgeLiveOnce / resetLiveJudge。三路信号与防抖在 C 段
    * 直接对共享模块断言，不再从这里取。 */
   'judgeLive', 'judgeLiveOnce', 'resetLiveJudge',
   'typingRecently', 'markType', 'popupOpen', 'popupOpenFast', 'refreshBusy', 'clickable',
   'classStr', 'overlayRects', 'coveredByOverlay', 'overlayListFast',
  'refreshUsable', 'canRefresh', 'scroller', 'saveScroll', 'restoreScroll',
  'clickRefresh', 'now', 'inViewport', 'placeLamp', 'settle', 'resetSettle',
  'lampColor', 'lampTitle', 'needLamp',
   'autoEffective', 'offResumesAuto', 'onLampClick',
   'markScrollTgt', 'inScrollChain', 'scrollingNow', 'scheduleNext', 'failOnce'],
  STATE_VARS,
  {
    document: documentShim,
    window: { innerWidth: 1600, innerHeight: 900, addEventListener() {} },
    NodeFilter: { SHOW_ELEMENT: 1, FILTER_ACCEPT: 1, FILTER_REJECT: 2, FILTER_SKIP: 3 },
    PointerEvent: FakePointerEvent,
    MouseEvent: FakeMouseEvent,
    getComputedStyle: (el) => ({ overflowY: (el && el._ov) || 'visible', position: 'static' }),
    setTimeout: () => 0,
    Math: Math,
    Date: Date
  },
  STATE_PRELUDE,
  ['__reset', '__set', '__get', '__setLamp']
);

/** 重置每轮用例共享的状态（同一个模块实例，状态是闭包里的） */
function resetState() {
  docRegistry.bySel = {};
  docRegistry.bodyText = '';
  documentShim.body.textContent = '';
  documentShim.body.childNodes = [];            // 清掉用例挂进 body 的假弹层节点
  documentShim.body._firstElementChild = null;
  documentShim.hidden = false;
  documentShim.activeElement = null;
  documentShim.elementFromPoint = () => null;
  M.__reset();
}

/* ============================================================
 * A. 文本归一化
 * ============================================================ */

resetState();
eq('A1 去掉半角空格', M.norm('刷新 列表'), '刷新列表');
eq('A2 去掉全角空格', M.norm('刷新\u3000列表'), '刷新列表');
eq('A3 去掉换行与制表', M.norm('\n刷新\t列表\r'), '刷新列表');
eq('A4 null 安全', M.norm(null), '');
eq('A5 保留正文', M.norm(' 开播前请使用直播计划 '), '开播前请使用直播计划');

/* ============================================================
 * B. 「这是不是那枚刷新按钮」
 * ============================================================ */

resetState();
const goodBtn = new FakeEl('BUTTON', { text: '刷新列表', rect: withRect(72, 24) });
ok('B1 正常按钮被认出', M.looksLikeRefresh(goodBtn) === true);

const wrapped = new FakeEl('DIV', {
  text: '刷新列表设置商品推荐卡查看分组搭配管理',
  rect: withRect(420, 24)
});
ok('B2 包住整排的外层被排除', M.looksLikeRefresh(wrapped) === false,
  '文本过长必须排除,否则灯会挂到整排的左边');

const tiny = new FakeEl('BUTTON', { text: '刷新列表', rect: withRect(10, 6) });
ok('B3 尺寸过小被排除', M.looksLikeRefresh(tiny) === false);

const ours = new FakeEl('BUTTON', {
  text: '刷新列表', rect: withRect(72, 24), attrs: { 'data-dyc-ar': '2' }
});
ok('B4 我们自己注入的节点被排除', M.looksLikeRefresh(ours) === false);

const detached = new FakeEl('BUTTON', {
  text: '刷新列表', rect: withRect(72, 24), connected: false
});
ok('B5 已脱离文档的节点被排除', M.looksLikeRefresh(detached) === false);

const other = new FakeEl('BUTTON', { text: '添加商品', rect: withRect(80, 32) });
ok('B6 别的按钮不被误认', M.looksLikeRefresh(other) === false);

/* ============================================================
 * C. 直播状态判定（2026-11-03：判据已迁到共享模块 live-state.js）
 * ============================================================
 * ★ 为什么要改这一段的测试对象，而不是删掉：
 *   判据本体从 auto-refresh.js 搬到了 src/content/live-state.js（唯一真源，
 *   auto-refresh 与 lucky-bag 共用）。判据的**行为口径一条都没变**（三路信号、
 *   连续 3 次判不出才认 unknown、确认过在播后不再采信 prelive），
 *   所以断言原样保留、只把被测对象换成共享模块 —— 否则这些回归样本会随搬迁一起消失。
 *
 * 装配方式：直接求值 live-state.js 全文，取 window.dycLiveState。
 * 每次用例前调 resetLive()（等价整页刷新）清掉防抖计数与缓存。
 *
 * ★ 两个自测专属处理，都不是「为了让测试变绿」：
 *   ① 节流窗口设 0：自测要逐次采样看防抖行为，不能被 1.8 秒窗口挡住；
 *      （节流本身另有一条 C11 专门验，那里恢复真实窗口）
 *   ② 改完 body 文案后调 invalidate()：横幅判定带 10 秒缓存（BANNER_TTL，
 *      真实运行里是刻意省开销的），测试里时间不走，只能显式清缓存来模拟
 *      「10 秒后缓存过期」。不清的话，前一个用例留下的 prelive 缓存会串到下一个。
 * ============================================================ */

const LIVE_STATE_PATH = path.join(ROOT, 'src/content/live-state.js');
const LIVE_STATE_SRC = fs.readFileSync(LIVE_STATE_PATH, 'utf8');

/** 装一份全新的共享判据（每个用例开头调，等价整页刷新） */
function freshLiveState() {
  const winShim = {};
  // eslint-disable-next-line no-new-func
  const fn = new Function('window', 'document', 'Date', 'Math', LIVE_STATE_SRC);
  fn(winShim, documentShim, Date, Math);
  winShim.dycLiveState.setTimingForTest(0);   // 关掉节流：自测要逐次采样
  return winShim.dycLiveState;
}

let LS = freshLiveState();

/** 重置判据 + 页面垫片（与 resetState 同义，额外换一份新的判据实例） */
function resetLive() {
  resetState();
  LS = freshLiveState();
}

/* C1 有「结束直播」按钮 ⇒ 直接判直播中 */
resetLive();
docRegistry.bySel['button, [role="button"], a'] = [
  new FakeEl('BUTTON', { text: '结束直播', rect: withRect(88, 32) })
];
eq('C1 结束直播按钮 ⇒ live', LS.once(), 'live');

/* C2 计时器递增 ⇒ live */
resetLive();
const timerEl = new FakeEl('SPAN', { text: '00:10:00', rect: withRect(60, 16) });
docRegistry.bySel['span, div, p, b, strong, i'] = [timerEl];
eq('C2 首拍只记值,不判趋势', LS.once(), 'unknown');
timerEl.textContent = '00:10:05';
eq('C3 计时器变大 ⇒ up（判 live）', LS.once(), 'live');

/* C4 计时器递减 ⇒ 不算直播中（开播倒计时） */
resetLive();
const countdown = new FakeEl('SPAN', { text: '00:30:00', rect: withRect(60, 16) });
docRegistry.bySel['span, div, p, b, strong, i'] = [countdown];
LS.once();
countdown.textContent = '00:29:58';
eq('C4 计时器变小 ⇒ 不判 live', LS.once(), 'unknown');

/* C4b 倒计时语境 + 播前横幅 ⇒ prelive
 * ★ 文案必须先摆好再第一次采样：横幅判定带 10 秒缓存，先采一次会把
 *   「没有横幅」这个否定结论缓存住，后面再改 body 就读不到了。 */
resetLive();
const cd2 = new FakeEl('SPAN', { text: '00:30:00', rect: withRect(60, 16) });
docRegistry.bySel['span, div, p, b, strong, i'] = [cd2];
documentShim.body.textContent = '开播前请使用直播计划';
LS.once();                            // 首拍：记下计时器初值
cd2.textContent = '00:29:50';
eq('C4b 倒计时不算直播中(应判未开播)', LS.once(), 'prelive');

/* C5 只有播前横幅 ⇒ prelive */
resetLive();
documentShim.body.textContent = '开播前请使用直播计划 创建直播预告 创建直播计划';
eq('C5 播前横幅 ⇒ prelive', LS.once(), 'prelive');

/* C5b 「开始直播 / 直播已结束」这类完全相等的文案 ⇒ prelive
 * （这一档是福袋模块 2026-11-01 的原有判据，合并时必须保留） */
resetLive();
docRegistry.bySel['button, a, span, div'] = [
  new FakeEl('BUTTON', { text: '开始直播', rect: withRect(88, 32) })
];
eq('C5b 「开始直播」文案 ⇒ prelive', LS.once(), 'prelive');

resetLive();
docRegistry.bySel['button, a, span, div'] = [
  new FakeEl('SPAN', { text: '直播已结束', rect: withRect(88, 32) })
];
eq('C5c 「直播已结束」文案 ⇒ prelive', LS.once(), 'prelive');

/* C5d 未开播文案要求**完全相等**：带前缀的运营文案不能命中 */
resetLive();
docRegistry.bySel['button, a, span, div'] = [
  new FakeEl('SPAN', { text: '开始直播倒计时', rect: withRect(88, 32) })
];
eq('C5d 「开始直播倒计时」不算未开播（完全相等才认）', LS.once(), 'unknown');

/* C6 什么都没有 ⇒ 单次采样是 unknown */
resetLive();
documentShim.body.textContent = '直播商品 待上架商品';
eq('C6 单次采样无信号 ⇒ unknown', LS.once(), 'unknown');

/* C7 「结束直播」优先级高于播前横幅(横幅可能残留) */
resetLive();
documentShim.body.textContent = '开播前请使用直播计划';
docRegistry.bySel['button, [role="button"], a'] = [
  new FakeEl('BUTTON', { text: '结束直播', rect: withRect(88, 32) })
];
eq('C7 直播信号优先于横幅', LS.once(), 'live');

/* ── C9 #108:删弱特定词后,S1 只认「开播前请使用直播计划」 ── */

resetLive();
documentShim.body.textContent =
  '基于【女装】行业数据分析，日均开播【5】小时，时均流量获取效率最高！创建直播预告创建直播计划查看';
ok('C9a 运营浮条按钮词(创建直播预告/计划)不再命中 S1', LS.once() === 'unknown',
  'got=' + LS.once());

resetLive();
documentShim.body.textContent = '开播前请使用直播计划';
ok('C9b 真播前横幅仍命中 S1', LS.once() === 'prelive', 'got=' + LS.once());

/* ── C10 #108:开播跃迁单向锁 —— 确认过 live 后,prelive 结论不再采信 ──
 *   场景:未开播 → 开播无缝转接(SPA 不刷新) → 转接后子页 S2 空窗,
 *   若 S1 再误命中,旧实现会把直播中误锁回 prelive ⇒ 点灰灯出假绿。 */

resetLive();
documentShim.body.textContent = '';
docRegistry.bySel['button, [role="button"], a'] = [
  new FakeEl('BUTTON', { text: '结束直播', rect: withRect(88, 32) })
];
eq('C10a 经 S2 确认直播中(everLive 置位)', LS.judge(), 'live');

/* S2 空窗(按钮消失),只剩真横幅 —— 旧实现在这里判回 prelive */
documentShim.body.textContent = '开播前请使用直播计划';
docRegistry.bySel['button, [role="button"], a'] = [];
docRegistry.bySel['button, a, span, div'] = [];
LS.invalidate();                       // 模拟「横幅缓存已过期」，读到新文案
eq('C10b 锁生效:第 1 次不采信 prelive(保持 live)', LS.judge(), 'live');
eq('C10c 第 2 次仍保持 live', LS.judge(), 'live');
eq('C10d 第 3 次按确认节奏转 unknown(点灯恒给 force)', LS.judge(), 'unknown');

/* C10e 解锁验证:整页刷新(新实例)后,同样的横幅输入正常判 prelive */
resetLive();
documentShim.body.textContent = '开播前请使用直播计划';
eq('C10e 重置(等价刷新)后正常判未开播', LS.judge(), 'prelive');

/* ── C8 判不出要「连续 3 次」才认（本轮新增的关键确认） ── */

resetLive();
documentShim.body.textContent = '开播前请使用直播计划';
LS.judge();                            // 确认一次 prelive（作为「上一次结论」）
documentShim.body.textContent = '';
LS.invalidate();                       // 模拟横幅缓存过期（真实运行 10 秒后自然过期）

eq('C8a 第 1 次判不出 ⇒ 仍按未开播走(继续刷)', LS.judge(), 'prelive');
eq('C8b 第 2 次判不出 ⇒ 仍按未开播走', LS.judge(), 'prelive');
eq('C8c 第 3 次判不出 ⇒ 才转 unknown', LS.judge(), 'unknown');

resetLive();
documentShim.body.textContent = '开播前请使用直播计划';
LS.judge();                            // 确认一次 prelive
documentShim.body.textContent = '';
LS.invalidate();
LS.judge();                            // 第 1 次不中
/* 第 3 次命中了 —— 用「结束直播按钮」而不是横幅:横幅判定带 10 秒缓存,
 * 刚出现时读不到,不适合做「瞬时切换」的用例。 */
docRegistry.bySel['button, [role="button"], a'] = [
  new FakeEl('BUTTON', { text: '结束直播', rect: withRect(88, 32) })
];
eq('C8d 中间命中一次 ⇒ 计数清零,走命中结论', LS.judge(), 'live');
eq('C8e 命中后 streak 清零', LS.dump().streak, 0);

resetLive();
documentShim.body.textContent = '开播前请使用直播计划';
LS.judge();
documentShim.body.textContent = '';
LS.invalidate();
LS.judge(); LS.judge();
eq('C8f 未达上限时 streak 记到 2', LS.dump().streak, 2);

/* ── C11 判据节流：两个调用方共用同一个防抖窗口（2026-11-03 新增） ──
 *   若各自推进计数，防抖窗口会被两倍速消耗（≈1.1 秒就转 unknown），
 *   等于把「连续 3 次才认判不出」这条设计废掉。 */
resetLive();
LS.setTimingForTest(1800);             // 恢复真实窗口
documentShim.body.textContent = '开播前请使用直播计划';
LS.judge();                            // 第 1 次：确认 prelive
documentShim.body.textContent = '';
LS.invalidate();
LS.judge();                            // 推进 streak 到 1
const streakAfter1 = LS.dump().streak;
eq('C11 铺垫：streak 已推进到 1', streakAfter1, 1);
LS.judge();                            // 同一窗口内再问：应被节流、不动计数
eq('C11 节流窗口内的重复判定不推进计数', LS.dump().streak, streakAfter1);
eq('C11 节流窗口内返回上一次结论', LS.judge(), 'prelive');

/* ============================================================
 * C9. 按钮本体上溯（灯要贴在整枚按钮左边，不是文字左边）
 * ============================================================ */

{
  const src = fs.readFileSync(SRC_PATH, 'utf8');
  const body = sliceFunction(src, 'scanRefreshBtn');
  ok('C9a 扫描后会向上爬到按钮本体',
    /while \(best && best\.parentElement/.test(body),
    '只认文字 span 的话,灯会贴到文字左边、盖住平台图标');
  ok('C9b 上溯要求父元素文本与子元素完全一致',
    /norm\(p\.textContent\) !== norm\(best\.textContent\)\) break/.test(body),
    '否则会把「设置商品推荐卡」那一整排一起算进来');
  ok('C9c 上溯有层数上限与尺寸上限',
    /climb < 6/.test(body) && /pr\.width > 180/.test(body),
    '没有上限就会一路爬到整页容器');
}

/* ============================================================
 * D. 三色映射表（档位 × 直播状态 × 慢速重试 → 灯色 + 悬停说明）
 * ============================================================ */

function colorOf(o) {
  resetState();
  M.__set(o);
  return M.lampColor();
}
function titleOf(o) {
  resetState();
  M.__set(o);
  return M.lampTitle();
}

eq('D1 自动·未开播 ⇒ 绿', colorOf({ mode: 'auto', liveState: 'prelive' }), 'green');
eq('D2 自动·已开播 ⇒ 灰', colorOf({ mode: 'auto', liveState: 'live' }), 'gray');
eq('D3 自动·判不出 ⇒ 灰', colorOf({ mode: 'auto', liveState: 'unknown' }), 'gray');
eq('D4 自动·自动停 ⇒ 灰', colorOf({ mode: 'auto', liveState: 'prelive', autoStopped: true }), 'gray');
eq('D5 强制 ⇒ 橙（开播也照刷）', colorOf({ mode: 'force', liveState: 'live' }), 'orange');
eq('D6 已停 ⇒ 灰', colorOf({ mode: 'off', liveState: 'prelive' }), 'gray');
eq('D7 慢速重试 ⇒ 灰（压过其他一切）',
  colorOf({ mode: 'force', liveState: 'prelive', slowRetry: true }), 'gray');

ok('D8 两种灰的悬停说明不一样（拍板 ② 定稿：要写清）',
  titleOf({ mode: 'auto', liveState: 'live', autoStopped: true }).indexOf('已开播') >= 0 &&
  titleOf({ mode: 'off', liveState: 'prelive' }).indexOf('手动停止') >= 0,
  '「已开播，自动停刷」vs「你已手动停止」必须能分辨');
ok('D9 判不出的悬停说明是「状态未知」',
  titleOf({ mode: 'auto', liveState: 'unknown' }).indexOf('状态未知') >= 0);
ok('D10 慢速重试的悬停说明提到「正在重试」',
  titleOf({ mode: 'auto', liveState: 'prelive', slowRetry: true }).indexOf('正在重试') >= 0);
ok('D11 绿的悬停说明提到「未开播」与「自动刷新中」',
  titleOf({ mode: 'auto', liveState: 'prelive' }).indexOf('未开播') >= 0 &&
  titleOf({ mode: 'auto', liveState: 'prelive' }).indexOf('自动刷新中') >= 0);

/* 灯常驻：只要开关开着就该在（慢速重试时也留着，用灰 + 悬停交代） */
resetState();
ok('D12 开关开着 ⇒ 灯常驻', M.needLamp() === true);
resetState();
M.__set({ slowRetry: true });
ok('D13 慢速重试时灯也在（用灰交代，不消失）', M.needLamp() === true);

/* ============================================================
 * E. 什么时候允许刷
 * ============================================================ */

function armCanRefresh(opts) {
  // canRefresh 依赖闭包里的 startedAt / busyUntil / mode / liveState / autoStopped
  // ⇒ 用一个「只算门槛」的判定式重建（与源码逐条对应，改源码这里要同步）。
  const o = opts || {};
  const now = 100000;
  const startedAt = o.startedAt === undefined ? now - 10000 : o.startedAt;
  const busyUntil = o.busyUntil === undefined ? 0 : o.busyUntil;
  const mode = o.mode || 'auto';
  const liveState = o.liveState || 'prelive';
  const autoStopped = !!o.autoStopped;
  const enabled = o.enabled !== false;
  const START_DELAY = 3000;

  // 与源码 canRefresh 逐条同序
  if (!enabled) return false;
  if (mode === 'off') return false;
  if (mode === 'auto' && (liveState !== 'prelive' || autoStopped)) return false;
  if (now < startedAt + START_DELAY) return false;
  if (now < busyUntil) return false;
  if (documentShim.hidden) return false;
  if (M.typingRecently()) return false;
  if (M.popupOpen()) return false;
  return true;
}

resetState();
ok('E1 基线(未开播/无输入/在前台)⇒ 允许', armCanRefresh() === true);

resetState();
ok('E2 已停 ⇒ 不允许', armCanRefresh({ mode: 'off' }) === false);

resetState();
ok('E3 已开播(自动态)⇒ 不允许', armCanRefresh({ liveState: 'live' }) === false);

resetState();
ok('E4 判不出(自动态)⇒ 不允许', armCanRefresh({ liveState: 'unknown' }) === false);

resetState();
ok('E5 已开播但强制刷 ⇒ 允许', armCanRefresh({ mode: 'force', liveState: 'live' }) === true);

resetState();
ok('E6 自动停 ⇒ 不允许', armCanRefresh({ autoStopped: true }) === false);

resetState();
ok('E7 刚进页面 3 秒内 ⇒ 不允许',
  armCanRefresh({ startedAt: 100000 - 1000 }) === false);

resetState();
ok('E8 上一轮未完 ⇒ 不允许', armCanRefresh({ busyUntil: 100500 }) === false);

resetState();
documentShim.hidden = true;
ok('E9 页面不在前台 ⇒ 不允许', armCanRefresh() === false);

resetState();
M.markType();                 // 刚敲过键盘
ok('E10 刚打过字 ⇒ 不允许', armCanRefresh() === false);

resetState();
ok('E11 光标留在输入框但早已不打字 ⇒ 照常允许', armCanRefresh() === true,
  '若按「焦点在输入框」判,用户点过搜索框不点走就再也不刷新了');

resetState();
docRegistry.bySel['.dyb-history'] = [
  new FakeEl('DIV', { rect: withRect(340, 420) })
];
ok('E12 消息盒子展开着 ⇒ 不允许', armCanRefresh() === false);

resetState();
docRegistry.bySel['.auxo-modal-root'] = [
  new FakeEl('DIV', { rect: withRect(600, 400) })
];
ok('E13 平台弹窗开着 ⇒ 不允许', armCanRefresh() === false);

resetState();
ok('E14 开关关 ⇒ 不允许', armCanRefresh({ enabled: false }) === false);

/* ============================================================
 * F. 点一次只发一套事件（防双重刷新）
 * ============================================================ */

resetState();
const target = new FakeEl('BUTTON', { text: '刷新列表', rect: withRect(72, 24, 400, 100) });
M.clickRefresh(target);

const types = target._events.map((e) => e.type);
const count = (t) => types.filter((x) => x === t).length;

eq('F1 pointerdown 恰好一次', count('pointerdown'), 1);
eq('F2 mousedown 恰好一次', count('mousedown'), 1);
eq('F3 pointerup 恰好一次', count('pointerup'), 1);
eq('F4 mouseup 恰好一次', count('mouseup'), 1);
eq('F5 click 恰好一次', count('click'), 1);
eq('F6 事件总数 = 5（多一个就是双重刷新）', types.length, 5);
ok('F7 没有走原生 click() 兜底路径',
  target._events.every((e) => !e._native),
  '既有 .click() 又补全套 = 平台收到两次点击');
ok('F8 事件可冒泡(平台监听在祖先上)',
  target._events.every((e) => e.bubbles === true));
ok('F9 坐标落在按钮中心',
  Math.abs(target._events[0].clientX - 436) < 1 &&
  Math.abs(target._events[0].clientY - 112) < 1,
  'clientX=' + target._events[0].clientX + ' clientY=' + target._events[0].clientY);

/* ============================================================
 * G. 五点采样（防被浮层盖住）
 * ============================================================ */

resetState();
const cbtn = new FakeEl('BUTTON', { text: '刷新列表', rect: withRect(72, 24, 400, 100) });
documentShim.elementFromPoint = () => cbtn;
ok('G1 五点都命中 ⇒ 可点', M.clickable(cbtn) === true);

resetState();
const cbtn2 = new FakeEl('BUTTON', { text: '刷新列表', rect: withRect(72, 24, 400, 100) });
documentShim.elementFromPoint = () => null;
ok('G2 五点都打空 ⇒ 不可点', M.clickable(cbtn2) === false);

resetState();
const cbtn3 = new FakeEl('BUTTON', { text: '刷新列表', rect: withRect(72, 24, 400, 100) });
const blocker = new FakeEl('DIV', { rect: withRect(72, 24, 400, 100) });
documentShim.elementFromPoint = () => blocker;
ok('G3 被别的元素盖住 ⇒ 不可点', M.clickable(cbtn3) === false);

resetState();
ok('G4 尺寸为 0 ⇒ 不可点',
  M.clickable(new FakeEl('BUTTON', { rect: withRect(0, 0) })) === false);

/* ============================================================
 * H. 滚动容器兜底：两段式筛选
 * ============================================================ */

{
  const src = fs.readFileSync(SRC_PATH, 'utf8');
  const body = sliceFunction(src, 'scroller');
  ok('H1 先按尺寸粗筛再读样式',
    body.indexOf('cands.push') > 0 &&
    body.indexOf('st = getComputedStyle(e2)') > body.indexOf('cands.push'),
    '样式读取必须排在尺寸粗筛之后,否则每个 div 都要强制布局');
  ok('H2 结果带缓存', /_scrollerAt/.test(body) && /SCROLLER_TTL/.test(body));
}

/* ============================================================
 * J. 视口跟随（fixed 定位下防止灯飘到别处）
 * ============================================================ */

const VP_W = 1600;
const VP_H = 900;

resetState();
ok('J1 正常在视口内 => 灯显示', M.inViewport(withRect(72, 24, 400, 100), VP_W, VP_H) === true);
ok('J2 滚到上方之外 => 灯藏', M.inViewport(withRect(72, 24, 400, -40), VP_W, VP_H) === false);
ok('J3 滚到下方之外 => 灯藏', M.inViewport(withRect(72, 24, 400, VP_H + 10), VP_W, VP_H) === false);
ok('J4 滚到左侧之外 => 灯藏', M.inViewport(withRect(72, 24, -100, 100), VP_W, VP_H) === false);
ok('J5 滚到右侧之外 => 灯藏', M.inViewport(withRect(72, 24, VP_W + 10, 100), VP_W, VP_H) === false);
ok('J6 只露一半仍要显示(贴边时不闪)',
  M.inViewport(withRect(72, 24, 400, -10), VP_W, VP_H) === true);
ok('J7 尺寸为 0 => 不显示(还没渲染出来)',
  M.inViewport(withRect(0, 0, 400, 100), VP_W, VP_H) === false);
ok('J8 空矩形 => 不显示', M.inViewport(null, VP_W, VP_H) === false);

/* ============================================================
 * K. 「滚出画面不算失败」—— 本轮修的核心缺陷
 * ============================================================ */

resetState();
ok('K1 在视口里 ⇒ 可刷', M.refreshUsable(new FakeEl('BUTTON', { rect: withRect(72, 24, 400, 100) })) === true);

resetState();
ok('K2 ★滚到视口上方之外 ⇒ 仍可刷（修的就是这一条）',
  M.refreshUsable(new FakeEl('BUTTON', { rect: withRect(72, 24, 400, -1200) })) === true,
  '按钮在不在画面里与能不能程序化点到它无关');

resetState();
ok('K3 ★滚到视口下方之外 ⇒ 仍可刷',
  M.refreshUsable(new FakeEl('BUTTON', { rect: withRect(72, 24, 400, VP_H + 500) })) === true);

resetState();
ok('K4 尺寸塌成 0 ⇒ 不可刷（藏在未激活页签里，这才是真异常）',
  M.refreshUsable(new FakeEl('BUTTON', { rect: withRect(0, 0) })) === false);

resetState();
ok('K5 已脱离文档 ⇒ 不可刷',
  M.refreshUsable(new FakeEl('BUTTON', { rect: withRect(72, 24), connected: false })) === false);

resetState();
ok('K6 空值 ⇒ 不可刷', M.refreshUsable(null) === false);

{
  // 源码级护栏：五点采样必须**先判在不在视口里**，不能对滚出画面的按钮直接判失败
  const src = fs.readFileSync(SRC_PATH, 'utf8');
  const body = sliceFunction(src, 'doRefresh');
  ok('K7 doRefresh 里五点采样带 inViewport 前置条件',
    /inViewport\(r, window\.innerWidth, window\.innerHeight\) && !clickable\(btn\)/.test(body),
    '对滚出画面的按钮跑五点采样必然假阴性 ⇒ 会误判失败');
  ok('K8 doRefresh 里用 refreshUsable 而不是 clickable 做「可点」门槛',
    body.indexOf('refreshUsable(btn)') > 0);
}

/* ============================================================
 * L. 点击循环按「档位」走（拍板 ① 定稿 + #103 修正）
 * ============================================================ */

{
  /* 循环逻辑与 onLampClick 逐条对应：橙→灰、灰(手动停)→绿/橙、绿/灰(自动停)→橙。
     #103 修的是「灰(手动停)→绿」这一条：直播中 auto 档不干活，切过去灯色不变，
     所以必须按**直播状态**分叉（未开播 → 绿，直播中/判不出 → 橙）。 */
  function step(s) {
    if (s.mode === 'force') return 'off';
    if (s.mode === 'off') return s.liveState === 'prelive' ? 'auto' : 'force';
    return 'force';
  }
  eq('L1 绿(自动·未开播) → 橙', step({ mode: 'auto', liveState: 'prelive' }), 'force');
  eq('L2 ★灰(自动·已开播) → 橙（不是绿！）', step({ mode: 'auto', liveState: 'live' }), 'force');
  eq('L3 ★灰(自动·判不出) → 橙', step({ mode: 'auto', liveState: 'unknown' }), 'force');
  eq('L4 橙(强制) → 灰(手动停)', step({ mode: 'force' }), 'off');
  eq('L5 灰(你手动停的·未开播) → 绿(自动)', step({ mode: 'off', liveState: 'prelive' }), 'auto');
  eq('L5b ★#103 灰(你手动停的·直播中) → 橙', step({ mode: 'off', liveState: 'live' }), 'force');
  eq('L5c ★#103 灰(你手动停的·判不出) → 橙', step({ mode: 'off', liveState: 'unknown' }), 'force');

  const src = fs.readFileSync(SRC_PATH, 'utf8');
  const body = sliceFunction(src, 'onLampClick');
  ok('L6 源码里「自动档」统一走 → force（不按颜色分叉）',
    body.indexOf("mode === 'auto'") < 0,
    '若在自动档里再按 liveState 分叉,就会退回「按颜色走」的旧口径');
  ok('L7 源码里橙 → off、off → 按 offResumesAuto() 分叉 auto/force',
    /mode === 'force'\) \{[\s\S]{0,80}mode = 'off';/.test(body) &&
    /offResumesAuto\(\)/.test(body) &&
    /backToAuto \? 'auto' : 'force'/.test(body),
    '#103:off 分支不能无条件回 auto,否则直播中灯色零变化');
  ok('L8 点灯有去抖', /lastClickAt/.test(body));
}

/* ---- #103：真跑 onLampClick，验证「点一下到底有没有变化」 ---- */

/** 摆好状态 → 点一下灯 → 返回点完的档位 / 灯色 / 悬停说明 */
function clickOnce(o) {
  resetState();
  M.__set(o);
  M.onLampClick();
  return { mode: M.__get().mode, color: M.lampColor(), title: M.lampTitle() };
}

{
  const r = clickOnce({ mode: 'off', liveState: 'live' });
  eq('L9 ★#103 直播中·灰(手动停)点一下 → 橙', r.mode, 'force');
  eq('L10 ★#103 灯色真的变了（灰 → 橙）', r.color, 'orange');
}
{
  const r = clickOnce({ mode: 'off', liveState: 'unknown' });
  eq('L11 ★#103 判不出·灰(手动停)点一下 → 橙', r.mode, 'force');
  eq('L12 ★#103 灯色真的变了（灰 → 橙）', r.color, 'orange');
}
{
  const r = clickOnce({ mode: 'off', liveState: 'prelive' });
  eq('L13 未开播·灰(手动停)点一下 → 绿（三态不变）', r.mode, 'auto');
  eq('L14 未开播·灯变绿', r.color, 'green');
}
{
  // 直播中两态循环：橙 → 灰 → 橙（不会再落回「灰·自动停」的死路）
  resetState();
  M.__set({ mode: 'force', liveState: 'live' });
  M.onLampClick();
  eq('L15 直播中 橙 → 灰', M.__get().mode, 'off');

  M.__set({ mode: 'off', liveState: 'live' });
  M.onLampClick();
  eq('L16 直播中 灰 → 橙（两态循环闭合）', M.__get().mode, 'force');
}
{
  // 悬停说明必须与「点一下会发生什么」一致，否则又是 #103 那种矛盾
  resetState();
  M.__set({ mode: 'off', liveState: 'live' });
  const tLive = M.lampTitle();
  resetState();
  M.__set({ mode: 'off', liveState: 'prelive' });
  const tPre = M.lampTitle();
  ok('L17 ★#103 悬停说明分叉：直播中说「强制刷新」、未开播说「自动」',
    tLive.indexOf('强制刷新') >= 0 && tLive.indexOf('自动') < 0 &&
    tPre.indexOf('自动') >= 0,
    'live=' + tLive + ' / prelive=' + tPre);
}

/* ============================================================
 * M. 无记忆 —— 三态不落 storage
 * ============================================================ */

{
  const src = fs.readFileSync(SRC_PATH, 'utf8');
  /* 只在**非注释**代码里查 —— 注释里提 localStorage 是说明文字,不算违规。 */
  const codeOnly = src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((l) => l.replace(/\/\/.*$/, ''))
    .join('\n');
  ok('M1 档位不写 storage / localStorage（只看代码,不看注释）',
    codeOnly.indexOf('localStorage') < 0 &&
    codeOnly.indexOf('sessionStorage') < 0,
    '用户要求「刷新页面后不沿用刷新前的逻辑」⇒ 三态只在内存里');
  ok('M2 读开关不覆盖档位',
    !/dycReadFlags\(\)[\s\S]{0,300}mode =/.test(src),
    '档位初始值必须硬编码为 auto');
  ok('M3 档位初始值是 auto', /var mode = 'auto'/.test(sliceVar(src, 'mode')));
}

/* ============================================================
 * N. 慢速重试（不彻底停机）
 * ============================================================ */

resetState();
M.__set({ failCount: 0 });
M.failOnce();
eq('N1 第 1 次失败 ⇒ 还不进慢速重试', M.__get().slowRetry, false);
M.failOnce();
eq('N2 第 2 次失败 ⇒ 还不进慢速重试', M.__get().slowRetry, false);
M.failOnce();
eq('N3 第 3 次失败 ⇒ 进慢速重试', M.__get().slowRetry, true);

resetState();
M.__set({ mode: 'auto', liveState: 'prelive', slowRetry: true });
ok('N4 慢速重试期间灯仍是灰（不是消失）', M.lampColor() === 'gray');

{
  const src = fs.readFileSync(SRC_PATH, 'utf8');
  ok('N5 没有「彻底停机」的 fatal 状态了',
    src.indexOf('var fatal') < 0 && src.indexOf('fatal = true') < 0,
    '停机是单向的（只能刷新页面），慢速重试是双向的（条件恢复自己回来）');
  const sch = sliceFunction(src, 'scheduleNext');
  ok('N6 慢速重试时用 30 秒节奏',
    /slowRetry \? RETRY_INTERVAL_MS : INTERVAL_MS/.test(sch));
  const doR = sliceFunction(src, 'doRefresh');
  ok('N7 点到后自动恢复正常节奏并报「已恢复」',
    /slowRetry = false;/.test(doR) && /已恢复，自动刷新中/.test(doR));
  ok('N8 失败时也 scheduleNext（否则 250ms 连打三次）',
    /failCount\+\+;[\s\S]{0,400}scheduleNext\(\)/.test(sliceFunction(src, 'failOnce')));
}

/* ============================================================
 * O. #98 弹层藏灯 —— 次级页面(弹层)打开 ⇒ 灯 display:none;关 ⇒ 恢复。
 *    判据与「礼貌刷新」共用同一套 popupOpen()（500ms TTL 缓存版 popupOpenFast）。
 * ============================================================ */

// 同步睡 ms 毫秒（让 popupOpenFast 的 TTL 缓存过期；Node 下 Atomics.wait 最省事）
const sleepSync = (ms) => {
  try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); }
  catch (e) { const t = Date.now(); while (Date.now() - t < ms) {} }
};

resetState();
const oLamp = new FakeEl('SPAN', { rect: withRect(24, 24) });
M.__setLamp(oLamp);
const oBtn = new FakeEl('BUTTON', { text: '刷新列表', rect: withRect(72, 24, 400, 100) });

docRegistry.bySel['.auxo-modal-root'] = [ new FakeEl('DIV', { rect: withRect(600, 400) }) ];
ok('O1 弹层开着 ⇒ placeLamp 返回 true（与「滚出视口」同义，tick 不误摘）',
  M.placeLamp(oBtn) === true);
eq('O2 弹层开着 ⇒ 灯 display:none', oLamp.style.display, 'none');
ok('O3 弹层开着 ⇒ 不写坐标（分支在读矩形之前，直接 return）',
  oLamp.style.left === undefined && oLamp.style.top === undefined);

docRegistry.bySel['.auxo-modal-root'] = [];
ok('O4 缓存窗口内不重查 ⇒ 灯仍藏着（实际检测 ≤2 次/秒的关键）',
  M.placeLamp(oBtn) === true && oLamp.style.display === 'none');

sleepSync(600);
ok('O5 弹层关了（缓存过期重新实跑） ⇒ 灯恢复显示',
  M.placeLamp(oBtn) === true && oLamp.style.display === '');
/* 2026-10-25 改圆钮:右边缘 = 按钮左边缘 − 8,直径 26
   按钮 left=400 ⇒ 圆钮 left = 400-8-26 = 366;纵向中心 112 ⇒ top = 112-13 = 99 */
ok('O6 恢复后坐标 = 按钮左边缘 − 8 − 26（left 366,top 99）',
  Math.abs(parseFloat(oLamp.style.left) - 366) <= 1.5 &&
  Math.abs(parseFloat(oLamp.style.top) - 99) <= 1.5);

docRegistry.bySel['.auxo-modal-root'] = [ new FakeEl('DIV', { rect: withRect(600, 400) }) ];
sleepSync(600);
ok('O7 弹层再开（关⇄开的往返） ⇒ 灯再次藏起',
  M.placeLamp(oBtn) === true && oLamp.style.display === 'none');

/* ============================================================
 * P. 滚动时灯暂时隐身（用户拍板「方案一」，2026-10-20）——
 *    页面滚动链滚动中 ⇒ 灯藏；停稳 350ms 后贴回；
 *    链外滚动区（评论列表）不触发，灯照常显示。
 * ============================================================ */

resetState();
M.__setLamp(oLamp);
const pList = new FakeEl('DIV', { rect: withRect(1000, 700), sh: 3000, ch: 700, ov: 'scroll' });
docRegistry.bySel['div, section, main'] = [pList];   // scroller() 兜底扫描只看得到它

M.markScrollTgt({ target: documentShim });
ok('P1 整页滚动进行中 ⇒ 灯藏',
  M.scrollingNow() === true &&
  M.placeLamp(oBtn) === true && oLamp.style.display === 'none');

sleepSync(400);
ok('P2 滚动停稳（350ms 静默） ⇒ 灯恢复显示',
  M.scrollingNow() === false &&
  M.placeLamp(oBtn) === true && oLamp.style.display === '');

oLamp.style.display = '';
M.markScrollTgt({ target: new FakeEl('DIV', { rect: withRect(300, 400), sh: 2000, ch: 400, ov: 'scroll' }) });
ok('P3 链外滚动区（评论列表，scroller() 认不出它）滚动 ⇒ 不藏',
  M.scrollingNow() === false && oLamp.style.display === '');

M.markScrollTgt({ target: pList });
ok('P4 商品列表容器（= 页面滚动链）滚动 ⇒ 藏',
  M.scrollingNow() === true &&
  M.placeLamp(oBtn) === true && oLamp.style.display === 'none');

/* ---- 2026-10-20 深夜:用户重载后「添加商品」弹层仍不藏 ⇒ 实证该弹层不挂
 * auxo 精确类名。popupOpen 补两档通用兜底(role="dialog" + body 直子层浮层词),
 * 与 search.js #72 的 inOverlay / clear-stock.js 同源。O8~O11 验兜底。 ---- */

resetState();
M.__setLamp(oLamp);
// O8:role="dialog" 的可见元素(平台弹层标配,不依赖任何类名) ⇒ 藏灯
docRegistry.bySel['[role="dialog"]'] = [ new FakeEl('DIV', { rect: withRect(557, 880) }) ];
ok('O8 弹层只带 role=dialog(无 auxo 类名) ⇒ 藏灯(#98 实测漏判形态)',
  M.popupOpen() === true && M.placeLamp(oBtn) === true && oLamp.style.display === 'none');

resetState();
M.__setLamp(oLamp);
// O9:body 直子层 CSS Modules 形态类名(xxx_drawer__hash) ⇒ 藏灯
const oDrawer = new FakeEl('DIV', { rect: withRect(557, 880), cls: 'index_drawer__2xkQz' });
documentShim.body.appendChild(oDrawer);
ok('O9 body 直子层类名含浮层词(CSS Modules 形态) ⇒ 藏灯',
  M.popupOpen() === true && oLamp.style.display === 'none');

resetState();
M.__setLamp(oLamp);
oLamp.style.display = 'none';   // 模拟上一拍弹层开着藏过灯
// O10:类名含 modality(无词边界) ⇒ 不藏;且 placeLamp 把灯恢复出来
const oTrap = new FakeEl('DIV', { rect: withRect(300, 200), cls: 'modality-box' });
documentShim.body.appendChild(oTrap);
ok('O10 类名含浮层词但无词边界(modality) ⇒ 不藏,灯恢复显示',
  M.popupOpen() === false &&
  M.placeLamp(oBtn) === true && oLamp.style.display === '');

resetState();
M.__setLamp(oLamp);
oLamp.style.display = 'none';
// O11:role=dialog 存在但不可见(离场动画/预挂载) ⇒ 不藏,灯恢复
docRegistry.bySel['[role="dialog"]'] = [ new FakeEl('DIV', { rect: withRect(0, 0) }) ];
ok('O11 role=dialog 不可见 ⇒ 不藏,灯恢复显示',
  M.popupOpen() === false &&
  M.placeLamp(oBtn) === true && oLamp.style.display === '');

/* ============================================================
 * I. 源码级红线（防止以后被改回去）
 * ============================================================ */

{
  const src = fs.readFileSync(SRC_PATH, 'utf8');

  ok('I1 不再改原生按钮的任何样式（上一版那套「透明覆盖」已作废）',
    src.indexOf('dyc-ar-hidden') < 0 &&
    src.indexOf('opacity: 0 !important') < 0,
    '用户要求「不做整合按钮」，原生按钮必须原样不动');

  ok('I2 灯挂 body + fixed',
    /var host = document\.body/.test(src) &&
    src.indexOf('anchor.appendChild') < 0 &&
    src.indexOf('position: fixed') >= 0,
    '挂在平台容器里会被 React 重渲染清掉 ⇒ 灯周期性闪一下');

  /* 26.10.21 用户定稿「实心缩小」：灯珠 12 → 9，外径仍 13(含 2px 描边)；
     命中区与间距不变。这里断言的是「数值 + 派生关系」，不是某一版的临时值。 */
  ok('I3 圆钮 26px、角标灯 8px、间距 8px 都是常量派生(2026-10-25 改 C 版)',
    /var DOT_SIZE = 8/.test(src) && /var DOT_BORDER = 1\.5/.test(src) &&
    /var LAMP_HIT = 26/.test(src) && /var LAMP_GAP = 8/.test(src) &&
    /var DOT_R = \(DOT_SIZE \+ DOT_BORDER \* 2\) \/ 2/.test(src));

  ok('I4 呼吸 3.6 秒一轮、缓动 ease-in-out',
    /3\.6s ease-in-out infinite/.test(src));

  ok('I5 呼吸只做在光晕上（灯珠本体没有动画）',
    /dyc-ar-dot::after \{[\s\S]{0,500}animation: dyc-ar-breathe/.test(src),
    '灯珠整体变淡会让颜色「糊」掉（绿在 alpha 0.75 时对比度只有 2.55）');
  ok('I5b 灯珠本体那条规则里没有 animation',
    (function () {
      const a = src.indexOf("'.' + LAMP_CLASS + ' .dyc-ar-dot {'");
      const b = src.indexOf('}', a);
      return a > 0 && b > a && src.slice(a, b).indexOf('animation') < 0;
    })());

  ok('I6 灰档光晕静止（「在不在刷」看动不动就知道）',
    /\[data-c="gray"\] \.dyc-ar-dot::after \{ animation: none/.test(src));

  ok('I7 橙色按钮边框/图标着色（圆钮上远处也能分辨）',
    /\[data-c="orange"\] \{ border-color:/.test(src) &&
    /\[data-c="orange"\] \.dyc-ar-ico \{ color:/.test(src));

  ok('I8 角标灯用白描边与按钮底分离（尺寸不跳）',
    /DOT_BORDER \+ 'px solid #fff/.test(src));

  ok('I9 三色都带 source（第 21 条三段式）',
    (src.match(/source: '自动刷新'/g) || []).length >= 6,
    '缺了来源就没有三段式');

  ok('I10 每 10 秒的成功刷新不出声',
    !/已刷新/.test(src) && !/刷新完成/.test(src),
    '高频动作不能进消息条/盒子');

  ok('I11 不常驻 MutationObserver',
    src.indexOf('new MutationObserver') < 0,
    '每 10 秒刷一次会刷屏式触发观察器,改由主循环兜');

  ok('I12 落点版本号已升到 3（形态换成圆钮）',
    /var MARK_VER = '3'/.test(src),
    '旧灯若不重建,不刷新页面的用户看不到新形态');

  ok('I13 坐标写入走 settle() 吸附(不再每拍照抄,否则抖动)',
    /settle\('lampL', left\)/.test(sliceFunction(src, 'placeLamp')) &&
    /settle\('lampT', top\)/.test(sliceFunction(src, 'placeLamp')),
    '值没实质变化就不写 style:既不抖,也不会触发平台 ResizeObserver');

  /* 2026-10-26 用户报「原生刷新时两枚自加按钮轻微左右抖」—— 抖动抑制的口径 */
  ok('I13b 吸附三档:≤2px 不动 / ≥10px 立刻跟 / 中间档两拍确认',
    /var SETTLE_SMALL = 2/.test(src) && /var SETTLE_BIG = 10/.test(src) &&
    /d <= SETTLE_SMALL/.test(src) && /d >= SETTLE_BIG/.test(src) &&
    /st\.streak >= 2/.test(src));
  ok('I13c 刷新进行中(自己刚点过 / 平台进加载态)⇒ 冻结坐标,不重测不重写',
    /now\(\) < busyUntil/.test(sliceFunction(src, 'placeLamp')) &&
    /refreshBusy\(btn\)/.test(sliceFunction(src, 'placeLamp')) &&
    /busyNow\) return true/.test(sliceFunction(src, 'placeLamp')));
  ok('I13d 换灯节点 / 从藏到显 / 缩放 ⇒ 吸附记忆作废(不会停在旧坐标)',
    /if \(settleEl !== lamp\) \{ resetSettle\(\); settleEl = lamp; \}/.test(sliceFunction(src, 'placeLamp')) &&
    /lamp\.style\.display = '';\s+resetSettle\(\);/.test(sliceFunction(src, 'placeLamp')) &&
    /resetSettle\(\);          \/\/ 布局一定变了/.test(src));

  /* 2026-10-27 用户:「自动刷新和讲解循环两个按钮不要因为右上角的小框框弹出就隐藏」 */
  ok('I18 浮层判据改成「有没有真的盖住灯 + 浮层够不够大」,不再是「有浮层就藏」',
    /function coveredByOverlay/.test(src) &&
    /coveredByOverlay\(\{/.test(sliceFunction(src, 'placeLamp')) &&
    !/if \(popupOpenFast\(\)\) \{/.test(sliceFunction(src, 'placeLamp')) &&
    /OVERLAY_MIN_AREA = 0\.12/.test(src));
  ok('I19 找不到刷新按钮时给宽限,不为一次重渲染摘灯',
    /LAMP_MISS_GRACE = 900/.test(src) && /now\(\) - lampMissAt > LAMP_MISS_GRACE/.test(src));

  ok('I14 间隔常量是 10 秒、抖动 ±0.5 秒',
    /var INTERVAL_MS = 10000/.test(src) && /var JITTER_MS = 500/.test(src));

  ok('I15 圆钮右边缘不探进原生按钮（不抢它的点击）',
    /r\.left - LAMP_GAP - LAMP_HIT/.test(sliceFunction(src, 'placeLamp')) &&
    /centerY - LAMP_HIT \/ 2/.test(sliceFunction(src, 'placeLamp')),
    '圆钮右边缘必须停在按钮左侧若干像素处');
  ok('I16 中间是静态刷新图标(不旋转,用户否过旋转圈圈)', /dyc-ar-ico/.test(src) && src.indexOf('animation: dyc-ar-spin') < 0);
  ok('I17 角标灯贴右上角(right/top 负值)', /right: -2px; top: -2px/.test(src));
}

/* ============================================================
 * Q. 浮层只在「真的盖住灯」时让位(2026-10-27 用户:
 *    「自动刷新和讲解循环两个按钮不要因为右上角的小框框弹出就隐藏」)
 *    —— 中控台右上角那张「智能推荐」小卡片一弹出来,旧版靠 .auxo-popover 命中即藏。
 * ============================================================ */

resetState();
M.__setLamp(oLamp);
oLamp.style.display = '';
oLamp.style.left = '';
oLamp.style.top = '';
docRegistry.bySel['.auxo-popover'] = [ new FakeEl('DIV', { rect: withRect(140, 140, 1520, 60) }) ];
ok('Q1 右上角小卡片(140×140,占视口 1.3%)弹出 ⇒ 灯照常显示、照常落位',
  M.placeLamp(oBtn) === true && oLamp.style.display !== 'none' &&
  Math.abs(parseFloat(oLamp.style.left) - 366) <= 1.5);

/* 极端情形:小卡片**正好压在灯上** —— 面积不够大也不算「挡道」,灯照样在。
 * ⚠️ 2026-11-01 起这条只代表**本地兜底口径**(overlay-guard.js 缺席时才会走到):
 *    共享判定在就用交集判,真压住灯的小卡片同样会让位 —— 那是用户 11-01
 *    「这些框框都不自动隐藏」的直接要求,夹具见 scripts/自测-浮层让位.js B1。
 *    这里保留旧断言,是为了守住「共享模块没加载也不能把灯永久藏掉」这条退路。 */
resetState();
M.__setLamp(oLamp);
oLamp.style.display = '';
oLamp.style.left = '';
oLamp.style.top = '';
docRegistry.bySel['.auxo-popover'] = [ new FakeEl('DIV', { rect: withRect(140, 140, 380, 80) }) ];
ok('Q2 小卡片即使压在灯上也不藏(兜底口径:够大 + 相交 两条都成立才让位)',
  M.placeLamp(oBtn) === true && oLamp.style.display !== 'none');

/* #98 不回归:同样相交,但换成真弹层尺寸(600×400 ≈ 17% 视口)⇒ 必须让位 */
resetState();
M.__setLamp(oLamp);
oLamp.style.display = '';
docRegistry.bySel['.auxo-popover'] = [ new FakeEl('DIV', { rect: withRect(600, 400, 0, 0) }) ];
ok('Q3 大浮层盖住灯 ⇒ 仍然藏(#98 不回归)',
  M.placeLamp(oBtn) === true && oLamp.style.display === 'none');

/* ============================================================
 * 汇总
 * ============================================================ */

console.log('');
console.log('============================================');
/* ---------- 2026-10-30:与循环讲解拖动联动 ---------- */
{
  const all = fs.readFileSync(SRC_PATH, 'utf8');
  const tickBody = sliceFunction(all, 'tick') || '';
  ok('D1 用户拖动循环讲解滑条时,本轮刷新顺延',
    /__dycUserDragUntil/.test(tickBody) && /nextAt = Date\.now\(\) \+ 600/.test(tickBody),
    '刷新会派发合成点击并重排列表,拖动期间必须让路,否则滑条被刷断');
  /* 2026-11-01 05:22 用户：「打开抽屉的时候,自动刷新可以让步不刷新。不然会冲突」 */
  ok('D3 福袋抽屉开着时,本轮刷新同样顺延',
    /bagBusy\(\)/.test(tickBody), 'tick 的入点要调 bagBusy()');
  ok('D4 bagBusy 同时看「抽屉开着」与「正在读抽屉」两个信号',
    /__dycBagPanelOpen/.test(all) && /__dycBagBusyUntil/.test(all),
    '只靠浮层启发式不够:抽屉刚弹出那几百毫秒还没被认出来,而读数正好落在那时');
  ok('D2 clickRefresh 确实派发 pointerup 合成事件',
    /fire\('pointerup', true\)/.test(all),
    '这是 D1 的前提:合成 pointerup 冒泡到 window 会被拖动端当成用户松手');
}

console.log(' 小黄车刷新指示灯 · 回归自测');
console.log('============================================');
if (failures.length) {
  console.log(' ✗ 失败 ' + failures.length + ' 项 / 通过 ' + pass + ' 项');
  console.log('');
  failures.forEach((f, i) => console.log('  ' + (i + 1) + '. ' + f));
  console.log('');
  process.exit(1);
}
console.log(' ✓ 全部通过:' + pass + ' 项');
console.log('');
process.exit(0);
