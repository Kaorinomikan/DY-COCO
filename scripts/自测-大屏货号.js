/**
 * 数据大屏「商品」页签 · 回归自测 —— 直接抽取**源文件里真实的函数源码**跑，不复制实现
 * ============================================================
 * 被测文件：src/live/live-screen.js
 * （电商罗盘 · 直播大屏 /screen/live/*，#product 页签里的商品表）
 *
 * 覆盖五件事：
 *   A. 取值不污染 —— 我们自己注入的「货号」按钮文案 + 右侧指标列，
 *      绝不能被当成平台货号（反馈 #96 的原样复现场景，见 docs/agents/用户要求.md 第 23 条）
 *   B. 名称元素识别 —— 三级判据（类名前缀 / 缩略图单元格 / 整行兜底）
 *      各自单独成立，且「平台提示语比商品名更长」时不能挑错
 *   C. 行识别 —— 必须剔掉 ecom 的测量行(高度 0)、表头行、列数过少的嵌套行、
 *      以及**没有缩略图**的非商品行
 *   D. 款号口径 —— 纯数字官方货号照读；名称末尾推算只认「≥4 位且含数字」
 *   E. 注入与点击 —— 按钮必须挂在**商品信息单元格里**（名称块下方）、
 *      重复调用不叠按钮、点一下复制款号、取不到时不复制任何内容
 *
 * 做法与 scripts/自测-货号取值.js 同源：按函数名抠出源码 → 最小 DOM 垫片上求值 →
 * 断言结果。源码一改自测自动跟着变，不会「测试绿了线上还错」。
 *
 * 用法：node scripts/自测-大屏货号.js
 * 退出码 0 = 全绿；1 = 有用例失败。
 * ============================================================
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SRC_PATH = path.join(ROOT, 'src/live/live-screen.js');

/* ============================================================
 * 1. 最小 DOM 垫片（只实现被测函数用到的那一小撮 API）
 * ============================================================ */

const ELEMENT_NODE = 1;
const TEXT_NODE = 3;

class FakeText {
  constructor(value) { this.nodeType = TEXT_NODE; this.nodeValue = value; }
}

/** 只支持三类选择器：标签名、.class、[attr]、[class*="x"] / [attr="v"]，可用逗号列表 */
function matchCompound(el, sel) {
  sel = sel.trim();
  if (!sel) return false;
  // 类选择器（被测代码里的 '.' + BTN_CLASS 就是这一类）
  const cls = sel.match(/^\.([\w-]+)$/);
  if (cls) return el._classList().indexOf(cls[1]) >= 0;
  // 属性选择器
  const attr = sel.match(/^\[([\w-]+)(?:([*^$]?=)"?([^"\]]*)"?)?\]$/);
  if (attr) {
    const name = attr[1];
    const op = attr[2];
    const want = attr[3];
    const v = el.getAttribute(name);
    if (v === null) return false;
    if (!op) return true;
    if (op === '*=') return v.indexOf(want) >= 0;
    if (op === '^=') return v.indexOf(want) === 0;
    if (op === '$=') return v.slice(-want.length) === want;
    return v === want;
  }
  // 标签名（大小写不敏感）
  return el.tagName === sel.toUpperCase();
}

class FakeEl {
  constructor(tag, attrs, kids) {
    this.nodeType = ELEMENT_NODE;
    this.tagName = String(tag).toUpperCase();
    this.attrs = Object.assign({}, attrs || {});
    this.childNodes = kids || [];
    this.parentElement = null;
    this.isConnected = true;
    this.style = makeStyle();
    this.__events = {};
    const self = this;
    this.classList = {
      add(c) {
        const list = self._classList();
        if (list.indexOf(c) < 0) list.push(c);
        self.attrs.class = list.join(' ');
      },
      remove(c) {
        const list = self._classList().filter((x) => x !== c);
        self.attrs.class = list.join(' ');
      },
      toggle(c, on) {
        const has = self._classList().indexOf(c) >= 0;
        const want = on === undefined ? !has : !!on;
        if (want) self.classList.add(c); else self.classList.remove(c);
        return want;
      },
      contains(c) { return self._classList().indexOf(c) >= 0; }
    };
    this._sizes = { clientWidth: 0, clientHeight: 0, scrollWidth: 0, scrollHeight: 0 };
    for (const c of this.childNodes) if (c instanceof FakeEl) c.parentElement = this;
  }
  _classList() {
    return String(this.attrs.class || '').split(/\s+/).filter(Boolean);
  }
  addEventListener(type, fn) {
    (this.__events[type] = this.__events[type] || []).push(fn);
  }
  /** 派发事件：只调本元素上注册的监听（够用于「兜底把点击转交给按钮」） */
  dispatchEvent(ev) {
    const list = this.__events[(ev && ev.type) || ''] || [];
    for (const fn of list) fn(ev);
    return true;
  }
  /** 测试里手动触发一次点击（不模拟冒泡之外的浏览器行为） */
  fire(type) {
    const list = this.__events[type] || [];
    let prevented = false;
    const ev = { preventDefault() { prevented = true; }, stopPropagation() {} };
    for (const fn of list) fn(ev);
    return prevented;
  }
  appendChild(child) {
    if (child.parentElement) child.parentElement.removeChild(child);
    this.childNodes.push(child);
    child.parentElement = this;
    child.isConnected = true;
    return child;
  }
  insertBefore(child, ref) {
    if (child.parentElement) child.parentElement.removeChild(child);
    const at = ref ? this.childNodes.indexOf(ref) : -1;
    if (at < 0) this.childNodes.push(child);
    else this.childNodes.splice(at, 0, child);
    child.parentElement = this;
    child.isConnected = true;
    return child;
  }
  removeChild(child) {
    const at = this.childNodes.indexOf(child);
    if (at >= 0) this.childNodes.splice(at, 1);
    child.parentElement = null;
    child.isConnected = false;   // 与真实 DOM 一致：摘掉就不再是「在页面上」
    return child;
  }
  remove() {
    if (this.parentElement) this.parentElement.removeChild(this);
  }
  /**
   * 模拟 DOM 的 compareDocumentPosition（源码用它判「在 X 之后」）。
   * 只实现真正用到的两种关系：
   *   · 4  (DOCUMENT_POSITION_FOLLOWING)：other 在我之后
   *   · 2  (DOCUMENT_POSITION_PRECEDING) ：other 在我之前
   * 判法 = 在「根」上做先序展开，比索引。
   */
  compareDocumentPosition(other) {
    if (other === this) return 0;
    let root = this;
    while (root.parentElement) root = root.parentElement;
    const order = [];
    (function walk(n) {
      order.push(n);
      for (const c of n.childNodes) if (c instanceof FakeEl) walk(c);
    })(root);
    const a = order.indexOf(this);
    const b = order.indexOf(other);
    if (a < 0 || b < 0) return 1;      // 不同树
    return b > a ? 4 : 2;
  }
  /** 剪贴板降级路径会调用（fallbackCopy 里的 ta.select()） */
  select() { this.__selected = true; }
  getClassNameForTest() { return String(this.attrs.class || ''); }
  getAttribute(name) {
    return Object.prototype.hasOwnProperty.call(this.attrs, name) ? this.attrs[name] : null;
  }
  setAttribute(name, v) { this.attrs[name] = String(v); }
  removeAttribute(name) { delete this.attrs[name]; }
  /** 真正的后代判定 —— 源码里 `hit.contains(el)` 用来放行「命中祖先」的情况。
   *  旧垫片恒 false，会让这条放行永远不生效，测不出真机行为。 */
  contains(node) {
    if (!node) return false;
    let cur = node;
    let guard = 0;
    while (cur && guard++ < 64) {
      if (cur === this) return true;
      cur = cur.parentElement;
    }
    return false;
  }
  get children() { return this.childNodes.filter((c) => c instanceof FakeEl); }
  /** 源码用它判「按钮后一个兄弟是不是图标」（插在图标左侧的落点） */
  get nextElementSibling() {
    const at = this.parentElement ? this.parentElement.childNodes.indexOf(this) : -1;
    if (at < 0) return null;
    for (let i = at + 1; i < this.parentElement.childNodes.length; i++) {
      const c = this.parentElement.childNodes[i];
      if (c instanceof FakeEl) return c;
    }
    return null;
  }
  /** 源码用它判「按钮前一个兄弟是不是图标」（落点纠偏的便宜判据） */
  get previousElementSibling() {
    const at = this.parentElement ? this.parentElement.childNodes.indexOf(this) : -1;
    if (at <= 0) return null;
    for (let i = at - 1; i >= 0; i--) {
      const c = this.parentElement.childNodes[i];
      if (c instanceof FakeEl) return c;
    }
    return null;
  }
  get firstChild() { return this.childNodes[0] || null; }
  get className() { return String(this.attrs.class || ''); }
  /** 必须提供 setter：源文件里用 `btn.className = BTN_CLASS` 打类名，
   *  只给 getter 的话赋值会在 sloppy mode 里静默失败，测试就永远查不到按钮。 */
  set className(v) { this.attrs.class = String(v == null ? '' : v); }
  /** 布局尺寸由用例显式设定（垫片不排版） */
  set size(o) { Object.assign(this._sizes, o); }
  /**
   * overflowsCell() 要用矩形比对 —— 垫片不排版，矩形直接由 _sizes 派生：
   * 左/上取 0，宽高取 clientWidth/clientHeight。用例只需给「元素比 td 宽」。
   */
  /**
   * 矩形。默认由 _sizes 派生（left/top 恒 0）；
   * 需要模拟「按钮被挤出视口」时，用 `global.__rectHook = (el) => ({...})` 接管 ——
   * 这样用例能给「刚被 createElement 出来的按钮」指定任意位置。
   */
  getBoundingClientRect() {
    if (global.__rectHook) {
      const r = global.__rectHook(this);
      if (r) return r;
    }
    const w = this._sizes.clientWidth || 0;
    const h = this._sizes.clientHeight || 0;
    return { left: 0, top: 0, width: w, height: h, right: w, bottom: h };
  }
  get clientWidth() { return this._sizes.clientWidth; }
  get clientHeight() { return this._sizes.clientHeight; }
  get scrollWidth() { return this._sizes.scrollWidth; }
  get scrollHeight() { return this._sizes.scrollHeight; }
  /** 模拟 textContent：无分隔符拼接（与浏览器一致，不做空白折叠）。
   *  ⚠️ 必须有 setter —— 源文件里 `btn.textContent = '货号'` 这类赋值在 sloppy mode
   *  下若只有 getter 会静默失败，测试就会看到「按钮没有文案」这种假失败。 */
  get textContent() {
    const buf = [];
    (function walk(n) {
      for (const c of n.childNodes) {
        if (c.nodeType === TEXT_NODE) buf.push(c.nodeValue);
        else walk(c);
      }
    })(this);
    return buf.join('');
  }
  set textContent(v) {
    this.childNodes.forEach((c) => { if (c instanceof FakeEl) c.parentElement = null; });
    this.childNodes = [new FakeText(String(v == null ? '' : v))];
  }
  /** 模拟 innerText：子树所有文本按渲染序拼起来（这正是污染的来源） */
  get innerText() {
    const buf = [];
    (function walk(n) {
      for (const c of n.childNodes) {
        if (c.nodeType === TEXT_NODE) buf.push(c.nodeValue);
        else walk(c);
      }
    })(this);
    return buf.join(' ').replace(/\s+/g, ' ').trim();
  }
  /** 后代匹配（不支持组合符，被测代码里的选择器都是单段或逗号列表） */
  _descendants() {
    const out = [];
    (function walk(n) {
      for (const c of n.childNodes) {
        if (c instanceof FakeEl) { out.push(c); walk(c); }
      }
    })(this);
    return out;
  }
  querySelectorAll(sel) {
    const list = String(sel).split(',').map((s) => s.trim()).filter(Boolean);
    return this._descendants().filter((el) => list.some((s) => matchCompound(el, s)));
  }
  querySelector(sel) {
    const all = this.querySelectorAll(sel);
    return all.length ? all[0] : null;
  }
  /**
   * 最近匹配祖先（含自身）—— 2026-10-31 判「完整名称气泡」要用。
   * 支持与 querySelectorAll 相同的单段 / 逗号列表语法。
   */
  closest(sel) {
    const list = String(sel).split(',').map((s) => s.trim()).filter(Boolean);
    let el = this;
    while (el) {
      if (list.some((s) => matchCompound(el, s))) return el;
      el = el.parentElement;
    }
    return null;
  }
}

/**
 * 内联样式垫片。
 *
 * 2026-10-18 起源码一律用 `setProperty(prop, value, 'important')` 写入
 * （平台的截断规则本身带 !important，普通内联抢不过），所以垫片必须
 * **同时记录优先级** —— 否则 `getPropertyPriority` 永远返回 ''，
 * `setImp` 的「值没变就不写」判断会永远判成「要写」。
 */
function makeStyle() {
  const store = {};     // prop -> { v, p }
  const api = {
    getPropertyValue: (k) => (store[k] ? store[k].v : ''),
    getPropertyPriority: (k) => (store[k] ? store[k].p : ''),
    setProperty: (k, v, p) => { store[k] = { v: String(v), p: p || '' }; },
    removeProperty: (k) => { delete store[k]; }
  };
  // 驼峰别名（源码里偶尔仍会用 el.style.height 这种读法）
  for (const p of ['whiteSpace', 'wordBreak', 'overflowWrap', 'textOverflow',
                   'height', 'maxHeight', 'overflow', 'display']) {
    const kebab = p.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase());
    Object.defineProperty(api, p, {
      get: () => (store[kebab] ? store[kebab].v : ''),
      set: (v) => { store[kebab] = { v: String(v), p: '' }; },
      enumerable: true
    });
  }
  return api;
}

const NodeFilter = {
  FILTER_ACCEPT: 1, FILTER_REJECT: 2, FILTER_SKIP: 3,
  SHOW_ELEMENT: 0x1, SHOW_TEXT: 0x4
};

/** 简化版 TreeWalker：按文档序前序遍历 + acceptNode（REJECT 整棵跳过） */
function makeTreeWalker(root, what, filter) {
  const seq = [];
  (function walk(n) {
    for (const c of n.childNodes || []) {
      const type = c.nodeType === TEXT_NODE ? NodeFilter.SHOW_TEXT : NodeFilter.SHOW_ELEMENT;
      if (what & type) {
        const verdict = filter && filter.acceptNode ? filter.acceptNode(c) : NodeFilter.FILTER_ACCEPT;
        if (verdict === NodeFilter.FILTER_REJECT) continue;
        if (verdict === NodeFilter.FILTER_ACCEPT) seq.push(c);
      }
      if (c.nodeType === ELEMENT_NODE) walk(c);
    }
  })(root);
  let i = -1;
  return { nextNode: () => (++i < seq.length ? seq[i] : null) };
}

/** MutationObserver 垫片：气泡观察器只需要「能建、能断开、能手动喂记录」 */
global.__moList = [];
global.MutationObserver = function MutationObserver(cb) {
  this.cb = cb;
  this.connected = false;
  global.__moList.push(this);
};
global.MutationObserver.prototype.observe = function () { this.connected = true; };
global.MutationObserver.prototype.disconnect = function () { this.connected = false; };
/** 用例手动喂一条 childList 记录（模拟气泡被插进 DOM） */
global.MutationObserver.prototype.feed = function (nodes) {
  if (this.connected) this.cb([{ addedNodes: nodes }], this);
};

global.NodeFilter = NodeFilter;
global.document = {
  createTreeWalker: makeTreeWalker,
  /**
   * Range 垫片（2026-10-19 三改新增）。
   *
   * 源码 `lastLineRight()` 用 Range 逐行取矩形，判断「最后一行文字会不会被
   * 按钮压住」。垫片里没有排版引擎，所以矩形的来源是：
   *   ① 测试显式设的 `el._lines`（最贴近真机：按行给）；
   *   ② 全局 `__rangeRects`（临时覆盖）。
   * 两者都没有 ⇒ 返回空数组 ⇒ lastLineRight 返回 0 ⇒ 调用方「不预判」。
   */
  createRange: () => ({
    _el: null,
    selectNodeContents(el) { this._el = el; },
    getClientRects() {
      if (global.__rangeRects) return global.__rangeRects;
      const el = this._el;
      return (el && el._lines) ? el._lines : [];
    }
  }),
  // 2026-10-31：气泡用例需要在「document 上查元素」，所以垫片维护一份
  // 创建过的元素清单（querySelectorAll 只在 isConnected 的里面筛）。
  querySelectorAll: (sel) => {
    const list = String(sel).split(',').map((x) => x.trim()).filter(Boolean);
    return global.__allEls.filter((el) => el.isConnected && list.some((x) => matchCompound(el, x)));
  },
  getElementById: () => null,
  head: { appendChild() {} },
  body: { appendChild() {} },
  // 捕获阶段监听：气泡兜底会挂 document 的 pointerdown（2026-10-31）
  __docEvents: {},
  addEventListener(type, fn) {
    (this.__docEvents[type] = this.__docEvents[type] || []).push({ fn: fn });
  },
  removeEventListener(type, fn) {
    const arr = this.__docEvents[type] || [];
    this.__docEvents[type] = arr.filter((x) => x.fn !== fn);
  },
  createElement: (tag) => {
    const el = new FakeEl(tag || 'div', {}, []);
    global.__allEls.push(el);
    return el;
  },
  // 2026-10-19：spotUsable 用它判「中心点有没有被别的元素盖住」。
  // 默认返回 null（没人盖住）；用例可临时覆盖成别的元素来模拟遮挡。
  elementFromPoint: () => null
};
// 消息条打桩：本自测只关心「是否弹出、弹什么」，不关心渲染
global.toastCalls = [];
global.toast = function (msg, type, opts) { global.toastCalls.push({ msg: msg, type: type, opts: opts || {} }); };
// 剪贴板打桩（copyText 走 navigator.clipboard.writeText）
global.lastCopied = null;
// navigator 在 Node 里只有 getter ⇒ 用 defineProperty 覆盖（不能用 global.navigator = ...）
Object.defineProperty(global, 'navigator', {
  configurable: true,
  value: {
    clipboard: {
      writeText: (t) => { global.lastCopied = t; return Promise.resolve(); }
    }
  }
});
// getComputedStyle：被测代码只读 display / overflow / whiteSpace / float
//
// ⚠️ 2026-10-30 加宽用例新增两点语义：
//   ① **内联样式优先** —— 真实浏览器里我们写的 `display:block` / `float:left`
//      会覆盖样式表；垫片若只读 _sizes，`widenStillOn()` 就永远判「没加宽」，
//      幂等失效会掩盖真问题。
//   ② `cssFloat` / `float` 两个读法都要给 —— 源文件按浏览器差异取了三种写法。
global.getComputedStyle = (el) => {
  const s = el._sizes;
  const inline = (k) => (el.style && el.style.getPropertyValue ? el.style.getPropertyValue(k) : '');
  const f = inline('float') || s.float || 'none';
  return {
    // position：2026-10-31 判「是不是浮层」要用（气泡只认 fixed / absolute）
    position: inline('position') || s.position || 'static',
    display: inline('display') || s.display || 'block',
    overflow: inline('overflow') || s.overflow || 'visible',
    overflowY: s.overflowY || inline('overflow') || 'visible',
    whiteSpace: inline('white-space') || s.whiteSpace || 'normal',
    webkitLineClamp: s.lineClamp || 'none',
    cssFloat: f,
    float: f,
    getPropertyValue: (k) => {
      if (k === '-webkit-line-clamp') return s.lineClamp || 'none';
      if (k === 'float') return f;
      return inline(k) || '';
    }
  };
};
/**
 * window 垫片。
 * 2026-10-19 新增：spotUsable 会读 innerWidth / innerHeight 判「按钮在不在视口里」，
 * 用例靠改写这两个值模拟「按钮被挤出视口」的场景。
 */
global.window = {
  innerWidth: 1707,
  innerHeight: 906,
  // 源码用它判断「支不支持 pointer 事件」：有 ⇒ 挂 pointerdown，没有 ⇒ 挂 mousedown。
  // 垫片里给出这个构造函数，用例才能用 fire('pointerdown') 验证兜底路径。
  PointerEvent: function PointerEvent() {},
  // 2026-10-31：气泡兜底在主线程派发一次 click（模拟「点击被气泡吃掉」的转交）
  MouseEvent: function MouseEvent(type, o) {
    this.type = type;
    Object.assign(this, o || {});
    this.defaultPrevented = false;
    this.preventDefault = function () { this.defaultPrevented = true; };
    this.stopPropagation = function () {};
  },
  requestAnimationFrame: (fn) => setTimeout(fn, 0)
};
/** 用例可接管：给元素返回任意矩形（模拟被挤出视口 / 被裁切） */
/** document.createElement 建过的所有元素（document.querySelectorAll 的数据源） */
global.__allEls = [];
/**
 * ⚠️ 有些用例会把 document.querySelectorAll 整个换掉（只返回自己那几行）。
 * 换掉之后**必须还能查别的选择器**，否则后面的用例（气泡）永远拿到空列表。
 * 这里存一份原实现：覆盖时按「只拦某几个选择器、其余转交」来写。
 */
global.__qsaDefault = global.document.querySelectorAll;
global.__rectHook = null;
// 源码里直接写 `new MouseEvent(...)`（不写 window.MouseEvent）⇒ 全局也得有
global.MouseEvent = global.window.MouseEvent;

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
  const re = new RegExp('var\\s+' + name + '\\s*=\\s*[^;]+;');
  const m = src.match(re);
  if (!m) throw new Error('源文件里找不到 var ' + name);
  return m[0];
}

function buildModule(fnNames, varNames, extra) {
  const src = fs.readFileSync(SRC_PATH, 'utf8');
  const parts = [];
  for (const v of varNames || []) parts.push(sliceVar(src, v));
  for (const f of fnNames) parts.push(sliceFunction(src, f));
  const body = (extra || '') + '\n' + parts.join('\n') +
    '\nreturn {' + fnNames.join(',') + '};';
  return new Function(body)();
}

/* ============================================================
 * 2. 装配被测模块（按函数名抠源码；只留纯逻辑，DOM 相关用桩）
 * ============================================================ */

/**
 * dbg 用桩顶掉：源文件里那一版走 debug-panel 的合并队列 + 定时器，
 * 与断言无关，但会在每次注入时被调用。桩掉不影响被测逻辑。
 */
const M = buildModule(
  ['isCodeLike', 'isExtNode', 'textWithoutExt', 'infoCellOf', 'readOfficialCode',
   'guessFromName', 'readCode', 'hasDirectText', 'looksLikeName', 'pickNameIn',
   'imageCellOf', 'findNameEl', 'getRows', 'rowBrief', 'hostFor',
   'chainDeclsFor', 'backupProps', 'restoreProps', 'setImp',
   'isBoxDisplay', 'clampOf', 'overflowsCell', 'isCut', 'stillExpanded',
   'ensureNoOverlap', 'expandEl', 'restoreEl',
   // 2026-10-30 加宽名称区
   'applyWiden', 'widenStillOn', 'restoreWiden', 'liberateWidth', 'widenBranches',
   'release', 'press', 'flash', 'makeButton', 'injectIntoRow',
   'clip', 'buttonBrief', 'fallbackCopy', 'copyText', 'say',
   // 2026-10-31 平台「完整名称气泡」：藏掉 + 事件不吃 + 点击转交
   'hideTips', 'isNameBubble', 'restoreTips', 'maybeBubble', 'onDocPointerDown',
   'enabled'],
  ['EXT_MARKS', 'NAME_MAX_SCAN', 'NOT_NAME', 'ONLY_NUM', 'HINT_TEXT', 'BTN_CLASS',
   'MARK', 'MARK_ORIG', 'MARK_CHAIN', 'MARK_CHAINED', 'MARK_ROW', 'TRIES', 'GIVEUP',
   'NAME_DECLS', 'CHAIN_DECLS', 'ROW_DECLS', 'CHAIN_STOP', 'CHAIN_MAX',
   // 2026-10-30 加宽名称区（缩略图左浮动）新增的常量
   'MARK_FLEX', 'MARK_FLEXED', 'MARK_IMG', 'MARK_IMGED', 'MARK_IMGN', 'MARK_IMGND',
   'MARK_TD', 'MARK_TDED', 'MARK_TXT', 'MARK_TXTED', 'MARK_W', 'MARK_WED',
   'FLEX_DECLS', 'IMG_DECLS', 'IMG_N_DECLS', 'TD_DECLS', 'TXT_DECLS', 'W_DECLS',
   'TIP_SEL', 'MARK_TIP', 'TIP_MAX_TEXT',
   'hitLevel', 'sampleCount'],
  'function dbg(){}'
);

/* ============================================================
 * 3. 构造测试行（照用户 2026-10-30 交来的结构报告的形状）
 *
 * 报告事实：tbody.ecom-table-tbody / tr.ecom-table-row.ecom-table-row-level-0 /
 * 首行 tr.ecom-table-measure-row（1545×0）/ 8 个 td（300/177/177/208/208/177/177/123）
 * ⇒ 首列 300px 放缩略图 + 名称，其余七列是指标。
 * ============================================================ */

const BTN_SEL = '.dyc-ls-btn';
const NAME_TEXT = '2026早秋新款女装针织开衫慵懒风外套 NE1C0021W';

/** 我们注入的「货号」按钮（模拟「已存在」的场景，用于取值污染用例） */
function ourBtn() {
  return new FakeEl('button', { 'data-dyc-ls-btn': '1' }, [new FakeText('货号')]);
}

/**
 * 造一行商品。
 * @param {object} o {deal, nameClass, withImg, hint, ourButton, official}
 */
function buildRow(o) {
  o = o || {};
  const nameAttrs = o.nameClass === false ? {} : { class: o.nameClass || 'productName-a1b2c3' };
  const name = new FakeEl(o.nameTag || 'p', nameAttrs, [new FakeText(o.nameText || NAME_TEXT)]);

  const infoKids = [];
  if (o.withImg !== false) infoKids.push(new FakeEl('img', {}, []));
  // 大屏首列还有一行「ID …」，平台自己写的
  infoKids.push(name);
  infoKids.push(new FakeEl('span', {}, [new FakeText('ID 3847192088')]));
  if (o.hint) infoKids.push(new FakeEl('span', {}, [new FakeText(o.hint)]));
  if (o.official) {
    infoKids.push(new FakeEl('span', {}, [new FakeText('货号')]));
    infoKids.push(new FakeEl('span', {}, [new FakeText(o.official)]));
  }
  // 默认带上我们注入的按钮 —— 取值用例要证明「它不会污染取值」；
  // 注入用例要传 ourButton:false，否则 querySelector 会先命中这枚假按钮。
  if (o.ourButton !== false) infoKids.push(ourBtn());
  const infoCell = new FakeEl('td', {}, infoKids);

  const tr = new FakeEl('tr', { class: 'ecom-table-row ecom-table-row-level-0' }, [
    infoCell,
    new FakeEl('td', {}, [new FakeText(o.gmv || '¥12,480.00')]),
    new FakeEl('td', {}, [new FakeText(o.deal || '340')]),
    new FakeEl('td', {}, [new FakeText('5,341')]),
    new FakeEl('td', {}, [new FakeText('5.2%')]),
    new FakeEl('td', {}, [new FakeText('96')]),
    new FakeEl('td', {}, [new FakeText('1,208')]),
    new FakeEl('td', {}, [new FakeEl('button', {}, [new FakeText('查看数据')])])
  ]);
  tr.size = { clientWidth: 1545, clientHeight: 71, scrollWidth: 1545, scrollHeight: 71 };
  infoCell.size = { clientWidth: 300, clientHeight: 71, scrollWidth: 300, scrollHeight: 71 };
  return { tr, nameEl: name, infoCell };
}

/**
 * 造一行「缩略图 + 文字块并排（flex）」的商品 —— 真机截图里的形态。
 *
 * 与 buildRow 的区别：图片与名称不再平铺在 td 里，而是被一层 flex 容器包着：
 *   td
 *    └ div.infoWrap (display:flex)          ← 加宽要改的就是这一层
 *        ├ div.imgBox  (含 img)             ← 要改成左浮动的那一格
 *        └ div.txtBlock                     ← 要放开宽度的文字块
 *            ├ p.productName-*              ← 名称
 *            └ span「讲解 0 次」
 * 「加宽」用例必须用这个形状 —— 平铺结构里根本没有可改的 flex 层。
 */
function buildFlexRow(o) {
  o = o || {};
  const name = new FakeEl('p', { class: 'productName-flex1' }, [new FakeText(o.nameText || NAME_TEXT)]);
  const imgBox = new FakeEl('div', { class: 'productImg-x' }, [new FakeEl('img', {}, [])]);
  const txtBlock = new FakeEl('div', { class: 'productInfo-x' }, [
    name,
    new FakeEl('span', {}, [new FakeText('讲解 0 次')])
  ]);
  const infoWrap = new FakeEl('div', { class: 'productInfoWrap-x' }, [imgBox, txtBlock]);
  infoWrap.size = { display: 'flex', clientWidth: 260, clientHeight: 68 };
  imgBox.size = { clientWidth: 60, clientHeight: 60 };
  txtBlock.size = { clientWidth: 190, clientHeight: 60 };

  const infoCell = new FakeEl('td', {}, [infoWrap]);
  infoCell.size = { clientWidth: 300, clientHeight: 71, scrollWidth: 300, scrollHeight: 71 };

  const tr = new FakeEl('tr', { class: 'ecom-table-row' }, [
    infoCell,
    new FakeEl('td', {}, [new FakeText('¥12,480.00')]),
    new FakeEl('td', {}, [new FakeText('340')]),
    new FakeEl('td', {}, [new FakeText('5,341')]),
    new FakeEl('td', {}, [new FakeText('5.2%')]),
    new FakeEl('td', {}, [new FakeText('96')]),
    new FakeEl('td', {}, [new FakeText('1,208')]),
    new FakeEl('td', {}, [new FakeEl('button', {}, [new FakeText('查看数据')])])
  ]);
  tr.size = { clientWidth: 1545, clientHeight: 71, scrollWidth: 1545, scrollHeight: 71 };
  return { tr, nameEl: name, infoCell, infoWrap, imgBox, txtBlock };
}

/**
 * 造一行「中间夹着定宽容器」的商品 —— 2026-10-31 真机截图对应的形态。
 *
 * 真机日志证明上一版加宽一次都没命中，名字宽度卡在约 150px：
 * 名字与缩略图之间还夹着 inner（自己写了 width:150px），
 * 只改「flex 容器的直接子」是落不到它身上的。liberateWidth 就是为这一层写的。
 */
function buildDeepRow(o) {
  o = o || {};
  const name = new FakeEl('p', { class: 'productName-deep1' }, [new FakeText(o.nameText || NAME_TEXT)]);
  const txt = new FakeEl('div', { class: 'txt-x' }, [name]);
  const inner = new FakeEl('div', { class: 'inner-x' }, [txt]);
  inner.size = { clientWidth: 150, clientHeight: 40 };
  const imgBox = new FakeEl('div', { class: 'imgBox-x' }, [new FakeEl('img', {}, [])]);
  const wrap = new FakeEl('div', { class: 'wrap-x' }, [imgBox, inner]);
  wrap.size = { clientWidth: 300, clientHeight: 68 };

  const infoCell = new FakeEl('td', {}, [wrap]);
  infoCell.size = { clientWidth: 300, clientHeight: 71 };
  const tr = new FakeEl('tr', { class: 'ecom-table-row' }, [
    infoCell,
    new FakeEl('td', {}, [new FakeText('¥12,480.00')]),
    new FakeEl('td', {}, [new FakeText('340')]),
    new FakeEl('td', {}, [new FakeText('5,341')]),
    new FakeEl('td', {}, [new FakeText('5.2%')]),
    new FakeEl('td', {}, [new FakeText('96')]),
    new FakeEl('td', {}, [new FakeText('1,208')]),
    new FakeEl('td', {}, [new FakeEl('button', {}, [new FakeText('查看数据')])])
  ]);
  tr.size = { clientWidth: 1545, clientHeight: 71 };
  return { tr, nameEl: name, infoCell, wrap, inner, txt, imgBox };
}

/** 造一行「缩略图与名字直接挂在 <td> 下」的商品（没有中间容器） */
function buildTdRow(o) {
  o = o || {};
  const name = new FakeEl('p', { class: 'productName-td1' }, [new FakeText(o.nameText || NAME_TEXT)]);
  const img = new FakeEl('img', {}, []);
  const infoCell = new FakeEl('td', {}, [img, name]);
  infoCell.size = { clientWidth: 300, clientHeight: 71 };
  const tr = new FakeEl('tr', { class: 'ecom-table-row' }, [
    infoCell,
    new FakeEl('td', {}, [new FakeText('340')]),
    new FakeEl('td', {}, [new FakeText('5,341')]),
    new FakeEl('td', {}, [new FakeText('96')]),
    new FakeEl('td', {}, [new FakeText('1,208')])
  ]);
  tr.size = { clientWidth: 1545, clientHeight: 71 };
  return { tr, nameEl: name, infoCell, img };
}

/* ============================================================
 * 4. 断言
 * ============================================================ */

let pass = 0, fail = 0;
const failures = [];

function ok(label, cond, detail) {
  if (cond) { pass++; console.log('  ✓ ' + label + (detail ? '  → ' + detail : '')); }
  else { fail++; failures.push(label + (detail ? '  → ' + detail : '')); console.log('  ✗ ' + label + (detail ? '  → ' + detail : '')); }
}

function eq(label, got, want) {
  ok(label, got === want, '得到 ' + desc(got) + '，期望 ' + desc(want));
}

/** 断言信息用的安全描述（断言值可能是 DOM 垫片对象，JSON.stringify 会撞循环引用） */
function desc(v) {
  if (v instanceof FakeEl) return '<' + v.tagName + ' ' + (v.textContent || '') + '>';
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean' || v === null) {
    return JSON.stringify(v);
  }
  return String(v);
}

/* ---------- A. 取值不污染 ---------- */
console.log('\n=========== A. 取值不污染（反馈 #96 场景）===========');
{
  // 成交件数 100~999 是 #96 的事故窗口：官方货号正则 {3,30} 正好命中
  for (const deal of ['100', '340', '999', '1,234', '5,341', '5.2%', '¥131,395.55', '-']) {
    const { tr, nameEl } = buildRow({ deal });
    const r = M.readCode(tr, nameEl);
    eq('指标列为「' + deal + '」时不误取', r.code, 'NE1C0021W');
    eq('  └ 来源应为名称推算', r.from, 'guess');
  }

  // 污染源自证：innerText 确实会拼出「货号 340」
  const { tr, nameEl } = buildRow({ deal: '340' });
  const dirty = tr.innerText;
  // ⚠️ 大屏这一页的首列里，自家按钮与右侧指标列之间隔着「ID …」那一行，
  //    所以 innerText 未必像 #96 那样正好拼成「货号 340」；但**自家文案确实
  //    进了 innerText** —— 只要它进了，正则就有机会撞上，防护就必须在。
  ok('innerText 会把自家按钮文案算进页面数据（证明这层防护是必要的）',
     dirty.indexOf('货号') >= 0, 'innerText 片段：' + dirty.slice(0, 60));
  const clean = M.textWithoutExt(M.infoCellOf(nameEl));
  ok('textWithoutExt 读不到我们自己按钮的文案', clean.indexOf('货号') < 0, '读到的文本：' + clean);

  // 平台真写了货号时必须照读（含纯数字货号，用户 2026-10-18 明确要保留）
  for (const official of ['10086', 'NE9X8888', 'A12']) {
    const row = buildRow({ official });
    const r = M.readCode(row.tr, row.nameEl);
    eq('平台货号「' + official + '」照读', r.code, official);
    eq('  └ 来源应为官方', r.from, 'official');
  }
}

/* ---------- B. 名称元素识别 ---------- */
console.log('\n=========== B. 名称元素识别（三级判据）===========');
{
  // ① 类名前缀
  const a = buildRow({ nameClass: 'productName-zz9' });
  eq('① 类名 productName- 命中', M.findNameEl(a.tr), a.nameEl);

  // ② 无类名 ⇒ 缩略图单元格兜底
  const b = buildRow({ nameClass: false });
  eq('② 无类名时靠缩略图单元格', M.findNameEl(b.tr) && M.findNameEl(b.tr).textContent, NAME_TEXT);

  // ③ 连缩略图都没有时，整行兜底仍要能找到
  const c = buildRow({ nameClass: false, withImg: false });
  eq('③ 无类名无缩略图时整行兜底', M.findNameEl(c.tr) && M.findNameEl(c.tr).textContent, NAME_TEXT);

  // 提示语比商品名更长时，不能挑中提示语（#88/#85 的教训）
  const hintLong = '商品无库存，用户不可购买，请先补充库存后再操作';
  const d = buildRow({ nameClass: false, hint: hintLong });
  const picked = M.findNameEl(d.tr);
  eq('提示语更长时不挑提示语', picked && picked.textContent, NAME_TEXT);

  // 价格 / 纯数字 / 平台标签 / 指标词都不算名称
  for (const bad of ['¥199.00', '12,345', '到手价', '累计销量', '成交金额', '曝光-点击转化率']) {
    ok('「' + bad + '」不算商品名', M.looksLikeName(bad) === false);
  }
  ok('正常商品名应算名称', M.looksLikeName(NAME_TEXT) === true);
}

/* ---------- C. 行识别 ---------- */
console.log('\n=========== C. 行识别（剔除测量行 / 表头 / 嵌套小表 / 无缩略图行）===========');
{
  const good = buildRow({}).tr;

  // ecom 的测量行：语义名 measure + 高度 0 + 8 个空 td
  const measure = new FakeEl('tr', { class: 'ecom-table-measure-row' },
    Array.from({ length: 8 }, () => new FakeEl('td', {}, [])));
  measure.size = { clientWidth: 1545, clientHeight: 0 };

  // 表头行（在 thead 里）
  const theadRow = new FakeEl('tr', {}, Array.from({ length: 8 }, () => new FakeEl('td', {}, [])));
  theadRow.size = { clientWidth: 1545, clientHeight: 44 };
  const thead = new FakeEl('thead', {}, [theadRow]);

  // 列数过少的嵌套行（小计 / 分页条）
  const nested = new FakeEl('tr', {}, [new FakeEl('td', {}, []), new FakeEl('td', {}, [])]);
  nested.size = { clientWidth: 200, clientHeight: 40 };

  // 8 列但**没有缩略图**的统计行 —— 不是商品行，不该有按钮
  const noImgRow = new FakeEl('tr', {}, Array.from({ length: 8 }, () => new FakeEl('td', {}, [
    new FakeText('1,234')
  ])));
  noImgRow.size = { clientWidth: 1545, clientHeight: 32 };

  const tbody = new FakeEl('tbody', { class: 'ecom-table-tbody' }, [measure, good, noImgRow]);
  const table = new FakeEl('table', {}, [thead, tbody]);
  tbody.parentElement = table; thead.parentElement = table;
  nested.parentElement = tbody;
  const qsaRows = global.document.querySelectorAll;   // 保留默认实现（气泡用例还要用）
  global.document.querySelectorAll = (sel) => (sel === 'tbody tr'
    ? [measure, good, noImgRow, theadRow, nested]
    : qsaRows(sel));

  const rows = M.getRows();
  eq('只留下 1 行商品行', rows.length, 1);
  ok('留下的正是商品行', rows[0] === good);
  ok('测量行被剔除', rows.indexOf(measure) === -1);
  ok('表头行被剔除', rows.indexOf(theadRow) === -1);
  ok('列数过少的嵌套行被剔除', rows.indexOf(nested) === -1);
  ok('无缩略图的统计行被剔除', rows.indexOf(noImgRow) === -1);
}

/* ---------- D. 款号口径 ---------- */
console.log('\n=========== D. 款号口径 ===========');
{
  eq('纯数字官方货号算合法款号', M.isCodeLike('10086'), true);
  eq('三个字符起步', M.isCodeLike('A12'), true);
  eq('两个字符不算', M.isCodeLike('A1'), false);
  eq('含空格不算', M.isCodeLike('A1 2'), false);

  const nameEl = new FakeEl('p', {}, [new FakeText('某款外套 NE1C0021W')]);
  eq('名称末尾款号可推算', M.guessFromName(nameEl), 'NE1C0021W');
  const pureText = new FakeEl('p', {}, [new FakeText('某款夏季外套')]);
  eq('名称末尾不是款号时不瞎猜', M.guessFromName(pureText), '');
  const short = new FakeEl('p', {}, [new FakeText('某款外套 A1')]);
  eq('末尾不足 4 位不猜', M.guessFromName(short), '');
  const noDigit = new FakeEl('p', {}, [new FakeText('某款外套 ABCD')]);
  eq('末尾无数字不猜', M.guessFromName(noDigit), '');
}

/* ---------- E. 注入 / 展开 / 点击 ---------- */
// 剪贴板那条路是 Promise（navigator.clipboard.writeText().then）⇒ E 段整体放进
// 一个 async 函数里跑，断言前先 flush 微任务；汇总也放进来，保证跑完才出结论。
(async function runE() {
  console.log('\n=========== E. 注入与点击（落点 / 展开 / 复制 / 无货号）===========');

  // E1. 落点：按钮必须挂在**商品信息单元格**里（名称块下方）
  {
    const { tr, infoCell, nameEl } = buildRow({ ourButton: false });
    // 名称真的被截断：横向溢出
    nameEl.size = { clientWidth: 220, clientHeight: 20, scrollWidth: 320, scrollHeight: 20 };
    const r = M.injectIntoRow(tr);
    eq('注入返回「本轮新插入」', r, 2);
    const btn = tr.querySelector(BTN_SEL);
    ok('按钮已插入', !!btn);
    ok('  └ 父级是商品信息单元格（名称块下方，甲案落点）',
       !!btn && btn.parentElement === infoCell,
       btn ? '实际父级 ' + btn.parentElement.tagName : '');
    ok('  └ 不是插在名称元素之后（避免被 flex 挤成同一行）',
       !!btn && btn.previousElementSibling !== nameEl,
       btn && btn.previousElementSibling ? '前一个兄弟是 ' + btn.previousElementSibling.tagName : '');
    ok('  └ 带 data-dyc-ls-btn 标记（取值时按它剔除）',
       !!btn && btn.getAttribute('data-dyc-ls-btn') === '1');
  }

  // E2. 名称真的折开：白名单属性写入 + 标记
  {
    const { tr, nameEl } = buildRow({ ourButton: false });
    nameEl.size = { clientWidth: 220, clientHeight: 20, scrollWidth: 320, scrollHeight: 20 };
    M.injectIntoRow(tr);
    eq('white-space 放开为 normal', nameEl.style.getPropertyValue('white-space'), 'normal');
    eq('display 改为 block（逃离 line-clamp）', nameEl.style.getPropertyValue('display'), 'block');
    eq('款号整体不拆：word-break 用 normal', nameEl.style.getPropertyValue('word-break'), 'normal');
    eq('配合 overflow-wrap: break-word', nameEl.style.getPropertyValue('overflow-wrap'), 'break-word');
    eq('写入带 !important（平台规则本身带 important）',
       nameEl.style.getPropertyPriority('white-space'), 'important');
    eq('打上展开标记', nameEl.getAttribute('data-dyc-ls-expand'), '1');
    // 祖先层也要跟着放开（钳制常在外层）
    eq('单元格祖先的 overflow 也放开',
       nameEl.parentElement.style.getPropertyValue('overflow') === 'visible' ||
       nameEl.parentElement.getAttribute('data-dyc-ls-chained') === '1', true);
  }

  // E3. 没被截断的行不写任何样式（不该为了「统一」而动别人的布局）
  {
    const { tr, nameEl } = buildRow({ ourButton: false });
    nameEl.size = { clientWidth: 220, clientHeight: 20, scrollWidth: 220, scrollHeight: 20,
                    display: 'block', whiteSpace: 'normal' };
    M.injectIntoRow(tr);
    eq('未截断时 white-space 保持不动', nameEl.style.getPropertyValue('white-space'), '');
    ok('未截断时也不打展开标记', nameEl.getAttribute('data-dyc-ls-expand') === null);
    ok('但按钮照样有（用户要的是随时能复制）', !!tr.querySelector(BTN_SEL));
  }

  // E4. 重复调用不叠按钮（补涂每 300ms 会反复进来）
  {
    const { tr, nameEl } = buildRow({ ourButton: false });
    nameEl.size = { clientWidth: 220, clientHeight: 20, scrollWidth: 320, scrollHeight: 20 };
    M.injectIntoRow(tr);
    M.injectIntoRow(tr);
    M.injectIntoRow(tr);
    eq('三轮补涂后仍只有 1 枚按钮', tr.querySelectorAll(BTN_SEL).length, 1);
  }

  // E5. 平台重渲染抹掉内联样式、但按钮还在 ⇒ 必须重新展开（不能因「已有按钮」早退）
  {
    const { tr, nameEl } = buildRow({ ourButton: false });
    nameEl.size = { clientWidth: 220, clientHeight: 20, scrollWidth: 320, scrollHeight: 20 };
    M.injectIntoRow(tr);
    eq('首次注入即展开', nameEl.style.getPropertyValue('white-space'), 'normal');

    // 模拟平台重渲染：把内联样式整段清空（标记与按钮留着）
    for (const p of ['white-space', 'word-break', 'overflow-wrap', 'text-overflow',
                     'height', 'max-height', 'overflow', 'display']) {
      nameEl.style.removeProperty(p);
    }
    nameEl.size = { display: 'block', whiteSpace: 'nowrap' };   // 计算值被压回 nowrap
    M.injectIntoRow(tr);
    eq('样式被抹掉后会自动重新展开', nameEl.style.getPropertyValue('white-space'), 'normal');
    eq('不会插出第二枚按钮', tr.querySelectorAll(BTN_SEL).length, 1);
  }

  // E6. 点击 ⇒ 复制款号 + 按钮闪「已复制」
  {
    global.toastCalls.length = 0;
    global.lastCopied = null;
    const { tr, nameEl } = buildRow({ ourButton: false });
    nameEl.size = { clientWidth: 220, clientHeight: 20, scrollWidth: 320, scrollHeight: 20 };
    M.injectIntoRow(tr);
    const btn = tr.querySelector(BTN_SEL);
    btn.fire('click');
    await new Promise((r) => setImmediate(r));
    eq('复制到的是名称末尾款号', global.lastCopied, 'NE1C0021W');
    eq('按钮显示「已复制」', btn.textContent, '已复制');
    const last = global.toastCalls[global.toastCalls.length - 1];
    eq('弹出「已复制货号 NE1C0021W」', last && last.msg, '已复制货号 NE1C0021W');
    eq('  └ 类型 success', last && last.type, 'success');
    eq('  └ 来源词复用「货号复制」', last && last.opts.source, '货号复制');
    eq('  └ 不进消息盒子', last && last.opts.keepHistory, false);
  }

  // E7. 取不到款号 ⇒ 不复制任何内容、弹「这一行没找到货号」
  {
    global.toastCalls.length = 0;
    global.lastCopied = null;
    const { tr, nameEl } = buildRow({ ourButton: false, nameText: '夏季纯棉短袖上衣' });
    nameEl.size = { clientWidth: 220, clientHeight: 20, scrollWidth: 320, scrollHeight: 20 };
    M.injectIntoRow(tr);
    const btn = tr.querySelector(BTN_SEL);
    btn.fire('click');
    await new Promise((r) => setImmediate(r));
    eq('什么都没复制', global.lastCopied, null);
    const last = global.toastCalls[global.toastCalls.length - 1];
    eq('弹出「这一行没找到货号」', last && last.msg, '这一行没找到货号');
    eq('  └ 类型 warning', last && last.type, 'warning');
    eq('按钮显示「无货号」', btn.textContent, '无货号');
  }

  // E8. 关开关 ⇒ 还原：名称内联样式与标记都要清掉
  {
    const { tr, nameEl } = buildRow({ ourButton: false });
    nameEl.size = { clientWidth: 220, clientHeight: 20, scrollWidth: 320, scrollHeight: 20 };
    M.injectIntoRow(tr);
    eq('展开已生效', nameEl.style.getPropertyValue('white-space'), 'normal');
    M.restoreEl(nameEl);
    eq('还原后 white-space 清空', nameEl.style.getPropertyValue('white-space'), '');
    ok('还原后标记已摘掉', nameEl.getAttribute('data-dyc-ls-expand') === null);
    ok('还原后祖先标记也摘掉', nameEl.parentElement.getAttribute('data-dyc-ls-chained') === null);
  }

  /* ---------- F. 名称区加宽（2026-10-30 真机反馈） ---------- */
  console.log('\n=========== F. 名称区加宽（缩略图左浮动 ⇒ 第二行起吃满整格）===========');
  {
    // F1. flex 结构：容器改块级 + 缩略图左浮动 + 文字块放开宽度
    const r = buildFlexRow();
    r.nameEl.size = { clientWidth: 190, clientHeight: 40, scrollWidth: 300, scrollHeight: 40 };
    M.injectIntoRow(r.tr);
    eq('容器由 flex 改块级', r.infoWrap.style.getPropertyValue('display'), 'block');
    eq('  └ 带 overflow:hidden 包含浮动',
       r.infoWrap.style.getPropertyValue('overflow'), 'hidden');
    eq('缩略图那格左浮动', r.imgBox.style.getPropertyValue('float'), 'left');
    eq('缩略图缩到 48px（给名字第一行腾宽度）',
       r.imgBox.style.getPropertyValue('width'), '48px');
    eq('  └ 内部 <img> 限宽 100%，不按固有尺寸溢出',
       r.imgBox.children[0].style.getPropertyValue('max-width'), '100%');
    eq('与名字的间距压到 6px', r.imgBox.style.getPropertyValue('margin-right'), '6px');
    eq('单元格左右内边距收到 8px（这是「两行」的最后一档宽度）',
       r.infoCell.style.getPropertyValue('padding-left'), '8px');
    eq('  └ 右侧同样收紧', r.infoCell.style.getPropertyValue('padding-right'), '8px');
    eq('文字块宽度放开（max-width:none）',
       r.txtBlock.style.getPropertyValue('max-width'), 'none');
    eq('文字块不能成 BFC（否则文字不环绕）',
       r.txtBlock.style.getPropertyValue('overflow'), 'visible');
    eq('三处都打上加宽标记', r.infoWrap.getAttribute('data-dyc-ls-flexed'), '1');

    // F2. 平台重渲染抹掉样式 ⇒ 下一轮必须补回（幂等双条件的另一半）
    for (const k of ['display', 'overflow']) r.infoWrap.style.removeProperty(k);
    for (const k of ['float', 'margin-right']) r.imgBox.style.removeProperty(k);
    r.infoWrap.size = { display: 'flex' };            // 计算值回到 flex
    M.injectIntoRow(r.tr);
    eq('被抹掉后自动补回块级', r.infoWrap.style.getPropertyValue('display'), 'block');
    eq('  └ 缩略图也补回左浮动', r.imgBox.style.getPropertyValue('float'), 'left');

    // F3. 还原：三处内联样式与标记都要清掉（关开关后页面回原样）
    M.restoreEl(r.nameEl);
    eq('还原后容器 display 清空', r.infoWrap.style.getPropertyValue('display'), '');
    eq('还原后容器 overflow 清空', r.infoWrap.style.getPropertyValue('overflow'), '');
    eq('还原后缩略图 float 清空', r.imgBox.style.getPropertyValue('float'), '');
    eq('还原后文字块 max-width 清空', r.txtBlock.style.getPropertyValue('max-width'), '');
    eq('还原后单元格内边距清空（表头与内容重新对齐）',
       r.infoCell.style.getPropertyValue('padding-left'), '');
    eq('还原后缩略图宽度清空', r.imgBox.style.getPropertyValue('width'), '');
    eq('还原后内部 <img> 的限宽也清空',
       r.imgBox.children[0].style.getPropertyValue('max-width'), '');
    ok('还原后三处标记都摘掉',
       r.infoWrap.getAttribute('data-dyc-ls-flexed') === null &&
       r.imgBox.getAttribute('data-dyc-ls-imged') === null &&
       r.txtBlock.getAttribute('data-dyc-ls-txted') === null);

    // F4. 平铺结构（没有 flex 层）不该被硬改 —— 拿不到可改的层就原样不动
    const flat = buildRow({ ourButton: false });
    flat.nameEl.size = { clientWidth: 220, clientHeight: 20, scrollWidth: 320, scrollHeight: 20 };
    M.injectIntoRow(flat.tr);
    ok('平铺结构不会凭空造出浮动/块级改动',
       flat.infoCell.style.getPropertyValue('display') === '' &&
       flat.infoCell.getAttribute('data-dyc-ls-flexed') === null);
  }

  // F6. 中间夹着定宽容器：必须把那一层的 width 解开（真机卡的就是这一层）
  {
    const r = buildDeepRow();
    r.nameEl.size = { clientWidth: 150, clientHeight: 60, scrollWidth: 200, scrollHeight: 60 };
    M.injectIntoRow(r.tr);
    eq('中间定宽容器的 width 被解开', r.inner.style.getPropertyValue('width'), 'auto');
    eq('  └ max-width 也放开', r.inner.style.getPropertyValue('max-width'), 'none');
    eq('  └ flex-basis 一起放开（flex 子项场景）',
       r.inner.style.getPropertyValue('flex-basis'), 'auto');
    eq('文字块 width 也解开', r.txt.style.getPropertyValue('width'), 'auto');
    ok('  └ 定宽容器被标记（关开关要还原它）',
       r.inner.getAttribute('data-dyc-ls-wed') === '1');
    // 还原后必须清空
    M.restoreEl(r.nameEl);
    eq('还原后中间层 width 清空', r.inner.style.getPropertyValue('width'), '');
    ok('还原后中间层标记摘掉', r.inner.getAttribute('data-dyc-ls-wed') === null);
  }

  // F7. 缩略图与名字直接挂在 <td> 下：不能改 td 的 display（那是表格列）
  {
    const r = buildTdRow();
    r.nameEl.size = { clientWidth: 200, clientHeight: 20, scrollWidth: 300, scrollHeight: 20 };
    M.injectIntoRow(r.tr);
    eq('<td> 的 display 必须原样不动', r.infoCell.style.getPropertyValue('display'), '');
    ok('  └ 也不给 <td> 打「已改块级」标记',
       r.infoCell.getAttribute('data-dyc-ls-flexed') === null);
    eq('缩略图仍然照常左浮动', r.img.style.getPropertyValue('float'), 'left');
    eq('  └ 缩略图缩到 48px', r.img.style.getPropertyValue('width'), '48px');
  }

  // F5. 按钮尺寸（2026-10-30「按钮太小」的调整必须落在样式表里）
  {
    const src = require('fs').readFileSync(SRC_PATH, 'utf8');
    ok('按钮宽 64px（留白收紧，不再是大框两个字）', src.indexOf('width: 64px !important') >= 0);
    ok('按钮高 26px', src.indexOf('height: 26px !important') >= 0);
    ok('字号 13px', /font:\s*13px\/1/.test(src));
  }

  // ============================================================
  // G. 平台「完整名称气泡」（2026-10-31 真机：气泡盖住按钮，按钮点不动）
  // ============================================================
  {
    /** 造一个「候选气泡」——必须是 document.createElement 出来的，
     *  因为 hideTips 走 document.querySelectorAll，数据源是垫片维护的元素清单。 */
    function makeTip(text, position, kids) {
      const el = document.createElement('div');
      el.attrs.class = 'ecom-tooltip ecom-tooltip-placement-bottom';
      if (position) el._sizes.position = position;
      const body = kids || [new FakeText(text === undefined ? 'PM “18针岛精机” 纯色Polo领针织T恤 NC1C0268' : text)];
      for (const k of body) el.appendChild(k);
      return el;
    }

    // ---------- G1. 四条判据（任何一条不成立都不许藏） ----------
    const inRowTip = makeTip('PM 甲 NC1C0268', 'absolute');
    new FakeEl('tr', {}, [new FakeEl('td', {}, [inRowTip])]);   // 挂进一行
    ok('① 行内同名类不藏（那层是触发源包裹，藏了商品名会整个消失）',
       M.isNameBubble(inRowTip) === false);

    const staticTip = makeTip('PM 乙 NC2C0031');    // position 默认 static
    ok('② 非定位元素不藏（普通容器不是浮层）', M.isNameBubble(staticTip) === false);

    const btnTip = makeTip(null, 'fixed', [
      new FakeText('确认删除这一行吗'),
      new FakeEl('button', {}, [new FakeText('确定')])
    ]);
    ok('③ 含可交互元素的弹层不藏（配置列表 / 查看详情那类）',
       M.isNameBubble(btnTip) === false);

    const longTip = makeTip('长'.repeat(201), 'fixed');
    ok('④ 文本超过 200 字不藏（不像一句商品名）', M.isNameBubble(longTip) === false);

    const emptyTip = makeTip('', 'fixed');
    ok('⑤ 空文本不藏', M.isNameBubble(emptyTip) === false);

    const goodTip = makeTip('PM 丙 NC3C0044', 'absolute');
    ok('⑥ 定位浮层 + 纯文字 + 不在行内 ⇒ 认定是名称气泡',
       M.isNameBubble(goodTip) === true);
    global.__allEls.splice(global.__allEls.indexOf(goodTip), 1);   // 计数用例只数它自己造的两个

    // ---------- G2. hideTips / restoreTips ----------
    const tipA = makeTip('PM 丁 NC4C0077', 'absolute');
    const tipB = makeTip('PM 戊 NC5C0090', 'fixed');
    const hid = M.hideTips();
    eq('hideTips 把两个气泡都藏了', hid, 2);
    eq('藏法是内联 display:none', tipA.style.getPropertyValue('display'), 'none');
    eq('  └ 带 !important（压过平台的样式表）',
       tipA.style.getPropertyPriority('display'), 'important');
    ok('  └ 打了标记（关开关要能还原）', tipA.getAttribute('data-dyc-ls-tip') === '1');
    eq('行内那个（触发源）没被误藏', inRowTip.style.getPropertyValue('display'), '');
    eq('带按钮的弹层没被误藏', btnTip.style.getPropertyValue('display'), '');
    eq('再调一次不重复计数（幂等）', M.hideTips(), 0);

    M.restoreTips();
    eq('还原后 display 清空', tipA.style.getPropertyValue('display'), '');
    eq('  └ 优先级也一起清掉', tipA.style.getPropertyPriority('display'), '');
    ok('还原后标记摘掉', tipA.getAttribute('data-dyc-ls-tip') === null);

    // ---------- G3. 样式表：不吃鼠标事件（不依赖类名也能保证点得动） ----------
    const srcG = require('fs').readFileSync(SRC_PATH, 'utf8');
    const cssStart = srcG.indexOf('var CSS = [');
    const cssEnd = srcG.indexOf("].join('\\n');", cssStart);
    const cssSrc = cssStart >= 0 && cssEnd > cssStart ? srcG.slice(cssStart, cssEnd) : '';
    ok('样式表里点名了 tooltip 系列', cssSrc.indexOf('[role="tooltip"], .ecom-tooltip') >= 0);
    ok('  └ 给它们关了鼠标事件（气泡再出现也不挡点击）',
       cssSrc.indexOf('pointer-events: none !important') >= 0);
    // 只看「真正会生效的规则行」——以引号开头的字符串；注释里提到通配不算违规
    const cssRules = cssSrc.split('\n')
      .filter((ln) => /^\s*'/.test(ln)).join('\n');
    ok('没有用 [class*=] 通配去藏浮层（会把触发源里的商品名一起藏掉）',
       cssRules.indexOf('class*=') < 0);

    // ---------- G4. maybeBubble：只在「新节点像气泡」时才去查 ----------
    ok('普通单元格不算气泡节点', M.maybeBubble([new FakeEl('td', {}, [])]) === false);
    ok('类名带 tooltip 的新节点 ⇒ 值得查一次',
       M.maybeBubble([new FakeEl('div', { class: 'ecom-tooltip top' }, [])]) === true);
    ok('role=tooltip 的新节点 ⇒ 值得查一次',
       M.maybeBubble([new FakeEl('div', { role: 'tooltip' }, [])]) === true);
    const portal = new FakeEl('div', { class: 'portal-root' }, []);
    portal.appendChild(new FakeEl('div', { class: 'ecom-tooltip' }, []));
    ok('包着气泡的容器也算（气泡常挂在 portal 里）', M.maybeBubble([portal]) === true);
    ok('纯文本节点不触发', M.maybeBubble([new FakeText('abc')]) === false);

    // ---------- G5. 兜底：气泡压住按钮时，点击照样生效 ----------
    // 先清空文档元素清单，避免前面用例留下的按钮矩形干扰命中判断
    global.__allEls.length = 0;
    global.flags = { liveScreenPolish: true };   // enabled() 读的是这个开关

    const r5 = buildRow();
    M.injectIntoRow(r5.tr);
    const btn5 = r5.tr.querySelector(BTN_SEL);
    btn5._sizes.clientWidth = 64;
    btn5._sizes.clientHeight = 26;           // 矩形 = (0,0) 到 (64,26)
    let clicked = 0;
    btn5.addEventListener('click', () => { clicked++; });

    const bubble5 = makeTip('PM 己 NC6C0112', 'absolute');
    const mkEvent = (target, x, y) => ({
      target: target, clientX: x, clientY: y,
      _prevented: false,
      preventDefault() { this._prevented = true; },
      stopPropagation() {}
    });

    const ev1 = mkEvent(bubble5, 10, 10);
    M.onDocPointerDown(ev1);
    eq('气泡盖住按钮 ⇒ 这次点击转交给按钮', clicked, 1);
    ok('  └ 同时拦掉平台原本要处理的那一次', ev1._prevented === true);

    M.onDocPointerDown(mkEvent(bubble5, 500, 500));
    eq('气泡上但不在按钮范围内 ⇒ 不截胡', clicked, 1);

    M.onDocPointerDown(mkEvent(btn5, 10, 10));
    eq('直接点在按钮上 ⇒ 兜底不重复触发', clicked, 1);

    const plain5 = new FakeEl('div', {}, []);
    M.onDocPointerDown(mkEvent(plain5, 10, 10));
    eq('点在跟气泡无关的地方 ⇒ 完全不管', clicked, 1);

    global.flags = { liveScreenPolish: false };
    M.onDocPointerDown(mkEvent(bubble5, 10, 10));
    eq('开关关掉后兜底也不动作', clicked, 1);
    global.flags = { liveScreenPolish: true };

    // ---------- G6. 开关口径：不单设，跟「商品名称不折叠」走 ----------
    ok('enabled() 读的是 liveScreenPolish（直播大屏商品名优化）',
       /function enabled\(\)[\s\S]{0,400}flags\.liveScreenPolish/.test(srcG));
    ok('  └ 已经不再引用旧键 liveScreenCopyCode',
       srcG.indexOf('liveScreenCopyCode') < 0);
    // 开关的三项功能必须在同一条说明里说清（用户 2026-10-31 定范围）
    const flagsSrcG = require('fs').readFileSync(
      require('path').join(ROOT, 'src/content/flags.js'), 'utf8');
    ok('开关标签是「直播大屏商品名优化」', flagsSrcG.indexOf("直播大屏商品名优化") >= 0);
    ok('  └ 归属抖店大类', /key: 'liveScreenPolish',\s*\n\s*group: 'shop'/.test(flagsSrcG));
    ok('  └ 说明里点出三项：完整展示 / 复制货号 / 去掉黑幕',
       /desc: '商品名完整展示、可快捷复制货号，并去掉悬浮黑幕。'/.test(flagsSrcG));
  }

  /* ---------- 汇总 ---------- */
  console.log('\n' + '='.repeat(62));
  console.log('通过 ' + pass + ' / ' + (pass + fail));
  if (fail) {
    console.log('失败用例：');
    failures.forEach((f) => console.log('  · ' + f));
    process.exit(1);
  }
  console.log('全绿 ✓ —— 大屏商品表的名称展开与取号口径符合既有三页同款约定');
  process.exit(0);
})();
