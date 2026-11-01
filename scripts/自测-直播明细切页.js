/**
 * 直播明细「打开即切商品」· 回归自测 —— 直接抽取**源文件里真实的函数源码**跑，不复制实现
 * ============================================================
 * 被测文件：src/live/live-detail-tab.js
 * （罗盘直播明细 /shop/live-detail、/talent/live-statement）
 * 需求：打开页面自动切到「商品」标签，并下滑到「商品明细」区块。
 *
 * 覆盖六件事：
 *   A. 标签怎么找 —— `[role="tab"]` 优先；退化到 `[class*="tabs-tab"]` 时
 *      必须排除 `tabs-tab-more`（那是「更多」下拉，不是标签）
 *   B. 挑哪个标签 —— 文案精度优先于排版顺序：「商品列表」必须胜过「商品」；
 *      前缀兜底只认「商品」开头且 ≤6 字；「互动 / 人群 / 售后」一律不碰
 *   C. 选中态怎么判 —— aria-selected / 类名含 active / 外层 aria-selected 三条
 *   D. 卡片兜底 —— 文本**恰好**是「商品」+ 尺寸像标题 + 向上 4 层内有 card 类名；
 *      长句（「商品曝光-点击率(人数)」）绝不命中
 *   E. 点击怎么派发 —— click 必须冒泡（React 17+ 委托在 root 上）；
 *      有 PointerEvent 时补一个 pointerdown
 *   F. 作用页判定
 *   G. 用户手动点标签栏 ⇒ 停手（isTrusted 分流）
 *   H. 开关元数据（开关存在 / 默认开 / 分组 / 作用页 / manifest 接线）
 *   I. **下滑到「商品明细」**（2026-10-20 追加）—— 锚点文案判据、长句不误伤、
 *      标签栏内同名文字不算、滚动链只含真能滚的容器、逐层补偿算得准、
 *      已到位不乱滚、位移落到 window 的兜底、overflow:hidden 不算可滚
 *   J. **消息提示**（2026-10-20 追加，第 21 条三段式）—— 一次打开页面**只出一条**
 *      （四个出口共用一个闸门，穷举两两组合验证）、四条出口各自的类型与措辞、
 *      来源词与弹窗 label 逐字一致、用户接管时不许谎报「并下滑」
 *
 * 做法与 scripts/自测-罗盘商品表.js 同源：按函数名抠出源码 → 最小 DOM 垫片上求值 →
 * 断言结果。源码一改自测自动跟着变，不会「测试绿了线上还错」。
 *
 * 用法：node scripts/自测-直播明细切页.js
 * 退出码 0 = 全绿；1 = 有用例失败。
 * ============================================================
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SRC_PATH = path.join(ROOT, 'src/live/live-detail-tab.js');
const FLAGS_PATH = path.join(ROOT, 'src/content/flags.js');

/* ============================================================
 * 1. 最小 DOM 垫片（只实现被测函数用到的那一小撮 API）
 * ============================================================ */

const ELEMENT_NODE = 1;
const TEXT_NODE = 3;

class FakeText {
  constructor(value) { this.nodeType = TEXT_NODE; this.nodeValue = value; }
}

/** 只支持三类选择器：标签名、`*`、[attr]、[attr="v"]、[class*="x"]；可用逗号列表 */
function matchCompound(el, sel) {
  sel = String(sel).trim();
  if (!sel) return false;
  if (sel === '*') return true;          // 通配：pickFromMenu 用它取面板内所有元素
  const attr = sel.match(/^\[([\w-]+)(?:([*^$]?=)"?([^"\]]*)"?)?\]$/);
  if (attr) {
    const name = attr[1], op = attr[2], want = attr[3];
    const v = el.getAttribute(name);
    if (v === null) return false;
    if (!op) return true;
    if (op === '*=') return v.indexOf(want) >= 0;
    if (op === '^=') return v.indexOf(want) === 0;
    if (op === '$=') return v.slice(-want.length) === want;
    return v === want;
  }
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
    this.__events = [];
    this.__dispatched = [];
    this._scroll = { top: 0, height: 0, content: 0 };
    for (const c of this.childNodes) c.parentElement = this;
  }
  get children() { return this.childNodes.filter((c) => c instanceof FakeEl); }
  getAttribute(name) {
    return Object.prototype.hasOwnProperty.call(this.attrs, name) ? this.attrs[name] : null;
  }
  setAttribute(name, v) { this.attrs[name] = String(v); }
  appendChild(child) {
    if (child.parentElement) child.parentElement.removeChild(child);
    this.childNodes.push(child);
    child.parentElement = this;
    return child;
  }
  removeChild(child) {
    const at = this.childNodes.indexOf(child);
    if (at >= 0) this.childNodes.splice(at, 1);
    child.parentElement = null;
    return child;
  }
  contains(node) {
    let cur = node, guard = 0;
    while (cur && guard++ < 64) {
      if (cur === this) return true;
      cur = cur.parentElement;
    }
    return false;
  }
  _descendants() {
    const out = [];
    (function walk(n) {
      for (const c of n.childNodes) if (c instanceof FakeEl) { out.push(c); walk(c); }
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
    this.childNodes = [new FakeText(String(v == null ? '' : v))];
  }
  /** 布局由用例显式给（垫片不排版） */
  set rect(r) { this._rect = r; }
  getBoundingClientRect() {
    if (global.__rectHook) {
      const r = global.__rectHook(this);
      if (r) return r;
    }
    const r = this._rect || { left: 0, top: 0, width: 0, height: 0 };
    // 滚动补偿：元素会随「可滚祖先的 scrollTop」与「window 的滚动量」上移。
    // 不模拟这个位移，alignToSection 的三趟收敛永远算不出「到位」，
    // 用例会把正确的实现判成失败（见文件头「滚动垫片」说明）。
    let shift = global.WINDOW_SCROLL ? global.WINDOW_SCROLL.y : 0;
    let p = this.parentElement, guard = 0;
    while (p && guard++ < 40) {
      shift += p.scrollTop || 0;
      p = p.parentElement;
    }
    const top = (r.top || 0) - shift;
    return {
      left: r.left, top: top, width: r.width, height: r.height,
      right: (r.left || 0) + (r.width || 0),
      bottom: top + (r.height || 0)
    };
  }
  /* ---------- 滚动（alignToSection / scrollChainOf 要用） ---------- */
  /** 用例设置：{ top 当前滚动位置, height 可视高, content 内容高 } */
  set scroll(s) { Object.assign(this._scroll, s); }
  get scrollTop() { return this._scroll.top; }
  set scrollTop(v) {
    const max = Math.max(0, this._scroll.content - this._scroll.height);
    this._scroll.top = Math.max(0, Math.min(max, Number(v) || 0));
  }
  get scrollHeight() { return this._scroll.content; }
  get clientHeight() { return this._scroll.height; }
  addEventListener(type, fn) { this.__events.push({ type: type, fn: fn }); }
  dispatchEvent(ev) {
    this.__dispatched.push(ev);
    for (const h of this.__events) if (h.type === ev.type) h.fn(ev);
    return true;
  }
}

/* 事件构造器：源码用 `typeof PointerEvent === 'function'` 判「老内核上跳不跳指针事件」 */
global.PointerEvent = function PointerEvent(type, init) {
  this.type = type;
  Object.assign(this, init || {});
};
global.MouseEvent = function MouseEvent(type, init) {
  this.type = type;
  Object.assign(this, init || {});
};

/* document.querySelectorAll 的搜索根：用例往里放元素 */
const DOC_ROOTS = [];

/** TreeWalker 垫片（pickCard 用它扫文本节点 —— 一趟线性，不逐个读 textContent） */
function makeTreeWalker(root, what, filter) {
  const seq = [];
  (function walk(n) {
    for (const c of n.childNodes || []) {
      if (c.nodeType === TEXT_NODE) seq.push(c);
      else { seq.push(c); walk(c); }
    }
  })(root);
  let i = -1;
  return { nextNode: () => (++i < seq.length ? seq[i] : null), currentNode: root };
}

/* 文本节点也要能回溯父元素（pickCard 取 n.parentElement） */
FakeText.prototype.parentElement = null;
/* normText 读 textContent —— 文本节点上它与 nodeValue 同值 */
Object.defineProperty(FakeText.prototype, 'textContent', {
  get() { return this.nodeValue; }
});

global.NodeFilter = { SHOW_TEXT: 0x4, SHOW_ELEMENT: 0x1 };

global.document = {
  createTreeWalker: makeTreeWalker,
  querySelectorAll(sel) {
    const list = String(sel).split(',').map((s) => s.trim()).filter(Boolean);
    const all = [];
    for (const r of DOC_ROOTS) all.push(r, ...r._descendants());
    return all.filter((el) => list.some((s) => matchCompound(el, s)));
  },
  /** pickCard 从 document.body 起扫 —— 用例把根放进 DOC_ROOTS 后由这里暴露 */
  get body() { return DOC_ROOTS[0] || null; }
};

/**
 * document.addEventListener 垫片。
 * watchUserTouch 用它盯「用户自己点标签栏」—— 用例靠这里手动派发事件，
 * 并用 `isTrusted` 区分「用户点的」与「我们派的」。
 */
const DOC_LISTENERS = [];
global.document.addEventListener = function (type, fn, capture) {
  DOC_LISTENERS.push({ type: type, fn: fn, capture: capture });
};
/** 派发一次文档级事件；`trusted` 为 false 表示扩展自己造的 */
function fireDoc(type, target, trusted) {
  for (const h of DOC_LISTENERS) {
    if (h.type !== type) continue;
    h.fn({ type: type, target: target, isTrusted: trusted !== false });
  }
}

global.location = { href: 'https://compass.jinritemai.com/shop/live-detail?x=1' };

/**
 * window 垫片。
 * 源码 `fire()` 里事件初始化写的是 `view: window` —— 浏览器里恒存在，
 * Node 里不给就会在求值那一刻抛 ReferenceError，被 try/catch 吞掉后
 * 表现为「什么都没派发」，是一处很隐蔽的假失败。
 */
global.window = global;
global.console = console;

/* ============================================================
 * 1b. 滚动垫片（alignToSection / scrollChainOf 要用）
 *
 * 垫片不做真实排版，所以滚动位置由用例**显式**给：
 *   · 每个容器的 `_scroll` = { top, height(可视高), content(内容高) }
 *   · window 的 `pageYOffset` 由 `WINDOW_SCROLL.y` 记账
 *   · `_rect` 给的是「未滚动时」的位置；`getBoundingClientRect` 返回的位置
 *     会**扣掉**所有可滚祖先的 scrollTop 与 window 的滚动量 —— 这正是
 *     浏览器里滚动后元素上移的等价效果。
 *     ⚠️ 若垫片不模拟这个位移，alignToSection 的三趟收敛永远算不出「到位」，
 *        用例会把正确的实现判成失败。
 * ============================================================ */

/** window 的滚动账本 */
global.WINDOW_SCROLL = { y: 0, max: 3000 };
global.pageYOffset = 0;      // 会被 Object.defineProperty 接管

Object.defineProperty(global, 'pageYOffset', {
  configurable: true,
  get() { return global.WINDOW_SCROLL.y; }
});

global.scrollTo = function (x, y) {
  var w = global.WINDOW_SCROLL;
  w.y = Math.max(0, Math.min(w.max, Number(y) || 0));
};

/**
 * getComputedStyle 垫片：`canScrollY` 只读 overflowY / overflow。
 * 用例用 `el.overflowY = 'auto'` 声明某个容器**可以**滚；
 * 不设就是 'visible'（滚不动）—— 与浏览器默认一致。
 */
global.getComputedStyle = function (el) {
  return {
    overflowY: el.overflowY || 'visible',
    overflow: el.overflowY || 'visible'
  };
};

/* ============================================================
 * 2. 从源文件抠函数 / 变量源码
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

/** 对象字面量形式的 var（内含 `;` 会骗过 sliceVar）——按花括号配平取整块 */
function sliceBracedVar(src, name) {
  const key = 'var ' + name + ' = ';
  const at = src.indexOf(key);
  if (at < 0) throw new Error('源文件里找不到 var ' + name);
  const i = src.indexOf('{', at);
  let depth = 0;
  for (let j = i; j < src.length; j++) {
    const ch = src[j];
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return src.slice(at, j + 2);
    }
  }
  throw new Error('花括号未配平：' + name);
}

function buildModule(fnNames, varNames, extra, post) {
  const src = fs.readFileSync(SRC_PATH, 'utf8');
  const parts = [];
  for (const v of varNames || []) parts.push(sliceVar(src, v));
  for (const f of fnNames) parts.push(sliceFunction(src, f));
  // 常量也一并导出：断言里要比对真实阈值，不能在测试里另抄一份数字
  // `post` 必须在 parts **之后**：var 声明会重置初值，写在前面等于白写
  const body = (extra || '') + '\n' + parts.join('\n') + '\n' + (post || '') +
    '\nreturn {' + fnNames.concat(varNames || []).join(',') + '};';
  return new Function(body)();
}

/* 作用页正则取自 flags.js 真实源码（不复制一份，避免两处漂移） */
const flagsSrc = fs.readFileSync(FLAGS_PATH, 'utf8');
const PAGE_PATTERNS_SRC = sliceBracedVar(flagsSrc, 'DYC_PAGE_PATTERNS');

const M = buildModule(
  ['normText', 'classOf', 'isActive', 'isVisible', 'findTabs', 'pickTab',
   'pickCard', 'hasCardClass', 'cardTitleOf', 'matchesCardText', 'looksLikeCard',
   'pickCardByContainer', 'pickCardByText', 'pickCardByRow', 'hasSimilarSiblings',
   'matchesWanted', 'hasWantedTab', 'findMoreBtn', 'findFoldedTarget', 'pickFromMenu',
   'insideTabBar', 'fire', 'onThisPage',
   'looksLikeHeading', 'canScrollY', 'scrollChainOf', 'alignToSection', 'findSectionAnchor'],
  ['WANT_EXACT', 'WANT_PREFIX', 'WANT_PREFIX_MAX', 'CARD_SCAN_MAX',
   'CARD_TEXT_MAX', 'CARD_ANCESTOR_MAX', 'CARD_W_MIN', 'CARD_W_MAX',
   'CARD_H_MIN', 'CARD_H_MAX', 'CARD_ROW_MIN_SIMILAR', 'CARD_ROW_SIZE_TOL',
   'SECTION_TEXT', 'SECTION_MAX_LEN', 'SECTION_TOP_GAP', 'SCROLL_TOLERANCE',
   'SECTION_SCAN_MAX'],
  PAGE_PATTERNS_SRC
);

/* ============================================================
 * 3. 断言
 * ============================================================ */

let pass = 0;
let fail = 0;
const failures = [];

function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else {
    fail++;
    failures.push(name + (extra ? '（' + extra + '）' : ''));
    console.log('  ✗ ' + name + (extra ? '  → ' + extra : ''));
  }
}
/**
 * 断言失败时的值描述。
 * ⚠️ 不能直接 JSON.stringify —— 假 DOM 有 parentElement 反向引用，
 *    一 stringify 就 "Converting circular structure to JSON" 把整个自测打崩。
 *    元素一律描述成「标签 + 类名 + 文本」。
 */
function desc(v) {
  if (v === null || v === undefined) return String(v);
  if (v instanceof FakeEl) {
    return '<' + v.tagName.toLowerCase() + ' class="' + v.getAttribute('class') + '">'
      + JSON.stringify(v.textContent.slice(0, 20));
  }
  try { return JSON.stringify(v); } catch (e) { return String(v); }
}
function eq(name, got, want) {
  ok(name, got === want, got === want ? '' : '实际 ' + desc(got) + '，期望 ' + desc(want));
}

/* ============================================================
 * 4. 用例
 * ============================================================ */

/**
 * 造一枚标签：<div role="tab" class="…">文本</div>
 *
 * ⚠️ 必须给默认矩形：`pickTab` 会跳过「宽高为 0」的标签
 * （antd 的「更多」下拉里那些折叠标签仍在 DOM 里、只是 display:none）。
 * 不给矩形 ⇒ 所有标签都被判成不可见 ⇒ 用例全是假失败。
 * `o.hidden` 用来造「被折叠进更多下拉」的标签。
 */
function tab(text, o) {
  o = o || {};
  const attrs = {};
  if (o.role !== false) attrs.role = 'tab';
  if (o.cls) attrs.class = o.cls;
  if (o.sel !== undefined) attrs['aria-selected'] = o.sel ? 'true' : 'false';
  const el = new FakeEl('div', attrs, [new FakeText(text)]);
  el.rect = o.hidden
    ? { left: 0, top: 0, width: 0, height: 0 }
    : { left: 0, top: 0, width: 72, height: 36 };
  return el;
}

console.log('\n=== 直播明细自动切商品 · 回归自测 ===\n');

/* ---------- A. 标签怎么找 ---------- */

console.log('A. 标签定位');
{
  DOC_ROOTS.length = 0;
  const bar = new FakeEl('div', { class: 'aurora-tabs-nav-list' }, []);
  const t1 = tab('核心数据', { sel: true });
  const t2 = tab('商品', {});
  const t3 = tab('互动', {});
  bar.appendChild(t1); bar.appendChild(t2); bar.appendChild(t3);
  // 「更多」下拉：类名含 tabs-tab-more，必须被排除
  const more = new FakeEl('button', { class: 'aurora-tabs-nav-more tabs-tab-more', role: 'tab' }, []);
  bar.appendChild(more);
  DOC_ROOTS.push(bar);

  // 注意：这里 more 带 role="tab"，所以 role 路径会先命中 —— 用不带 role 的版本测 class 路径
  const byRole = M.findTabs();
  eq('A1 [role="tab"] 优先，找到 4 枚', byRole.length, 4);
  ok('A1b 返回的第一个是「核心数据」', M.normText(byRole[0]) === '核心数据');
}
{
  DOC_ROOTS.length = 0;
  // 没有 role 的旧版 antd：只能靠 class，且必须排除 tabs-tab-more
  const bar = new FakeEl('div', { class: 'ecom-tabs-nav-list' }, []);
  bar.appendChild(new FakeEl('div', { class: 'ecom-tabs-tab' }, [new FakeText('商品')]));
  bar.appendChild(new FakeEl('div', { class: 'ecom-tabs-tab' }, [new FakeText('互动')]));
  bar.appendChild(new FakeEl('button', { class: 'ecom-tabs-tab-more ecom-tabs-nav-more' }, []));
  DOC_ROOTS.push(bar);

  const byCls = M.findTabs();
  eq('A2 无 role 时退 class 判据，且排除 tabs-tab-more', byCls.length, 2);
  ok('A2b 排除掉的是「更多」下拉',
     byCls.every((e) => !/tabs-tab-more/.test(M.classOf(e))));
}
{
  DOC_ROOTS.length = 0;
  eq('A3 页面上没有标签栏 ⇒ 返回空数组（不猜）', M.findTabs().length, 0);
}

/* ---------- B. 挑哪个标签 ---------- */

console.log('\nB. 挑标签（文案精度优先于排版顺序）');
{
  const tabs = [tab('商品', {}), tab('商品列表', {})];
  eq('B1 「商品列表」胜过「商品」，即使「商品」排在前面',
     M.normText(M.pickTab(tabs)), '商品列表');
}
{
  const tabs = [tab('核心数据', { sel: true }), tab('商品', {})];
  eq('B2 只有「商品」时选中它', M.normText(M.pickTab(tabs)), '商品');
}
{
  const tabs = [tab('核心数据', {}), tab('商品分析', {})];
  eq('B3 前缀兜底：≤6 字的「商品分析」算命中', M.normText(M.pickTab(tabs)), '商品分析');
}
{
  const tabs = [tab('商品明细对比报表', {}), tab('互动', {})];
  eq('B4 超过 6 字的长句不算命中（防误点别的页签）', M.pickTab(tabs), null);
}
{
  const tabs = [tab('核心数据', {}), tab('互动', {}), tab('人群', {}), tab('售后', {})];
  eq('B5 没有「商品」相关标签 ⇒ 返回 null，绝不乱点', M.pickTab(tabs), null);
}
{
  // antd 折叠：可见的标签里没有「商品」，但它藏在「更多」下拉里（矩形 0×0）
  const folded = tab('商品', { hidden: true });
  const tabs = [tab('核心数据', {}), tab('互动', {}), folded];
  eq('B6 被折叠进「更多」下拉的标签（矩形 0×0）不算命中 —— 点了不会有反应',
     M.pickTab(tabs), null);
}
{
  // 可见的「商品」优先于折叠的「商品列表」
  const foldedBest = tab('商品列表', { hidden: true });
  const shown = tab('商品', {});
  eq('B7 可见的「商品」胜过折叠的「商品列表」',
     M.normText(M.pickTab([tab('核心数据', {}), shown, foldedBest])), '商品');
}

/* ---------- B2. 标签被折进「更多」下拉 ---------- */

console.log('\nB2. 标签被折进「更多」下拉');
{
  // 「商品」被折叠（矩形 0×0），可见标签里没有它
  const folded = tab('商品', { hidden: true });
  const bar = new FakeEl('div', { class: 'aurora-tabs-nav-list' }, []);
  bar.appendChild(tab('核心数据', {}));
  bar.appendChild(tab('互动', {}));
  bar.appendChild(folded);
  DOC_ROOTS.length = 0;
  DOC_ROOTS.push(bar);

  const tabs = [tab('核心数据', {}), tab('互动', {}), folded];
  ok('B8 标签栏里「存在」商品标签（虽被折叠）⇒ hasWantedTab 为真',
     M.hasWantedTab(tabs) === true);
  ok('B9   └ 但 pickTab 不选它（量不到尺寸，点了没反应）',
     M.pickTab(tabs) === null);
  ok('B10 找得到被折叠的目标标签（据此才去点「更多」）',
     M.findFoldedTarget() === folded);
}
{
  DOC_ROOTS.length = 0;
  eq('B11 标签栏里压根没有商品标签 ⇒ findFoldedTarget 为 null（不乱开下拉）',
     M.findFoldedTarget(), null);
}
{
  DOC_ROOTS.length = 0;
  const bar = new FakeEl('div', { class: 'aurora-tabs-nav' }, []);
  const more = new FakeEl('button', { class: 'aurora-tabs-nav-more', role: 'button' }, []);
  more.rect = { left: 1200, top: 450, width: 32, height: 32 };
  bar.appendChild(more);
  DOC_ROOTS.push(bar);
  ok('B12 按类名 tabs-nav-more 找到「更多」按钮', M.findMoreBtn() === more);
}
{
  DOC_ROOTS.length = 0;
  const bar = new FakeEl('div', { class: 'aurora-tabs-nav' }, []);
  const more = new FakeEl('button', { class: 'aurora-tabs-nav-more' }, []);
  more.rect = { left: 0, top: 0, width: 0, height: 0 };   // 没启用时量不到尺寸
  bar.appendChild(more);
  DOC_ROOTS.push(bar);
  eq('B13 「更多」不可见（没启用）⇒ 不点它', M.findMoreBtn(), null);
}
{
  DOC_ROOTS.length = 0;
  // 下拉面板已展开：菜单项不是 role=tab，靠 tabs-dropdown 类名找
  const panel = new FakeEl('div', { class: 'aurora-tabs-dropdown' }, []);
  const outer = new FakeEl('div', { class: 'aurora-tabs-dropdown-menu-item' }, []);
  const inner = new FakeEl('div', { class: 'aurora-tabs-dropdown-menu-item-btn' },
    [new FakeText('商品')]);
  outer.rect = { left: 1200, top: 490, width: 90, height: 32 };
  inner.rect = { left: 1204, top: 494, width: 82, height: 24 };
  outer.appendChild(inner);
  panel.appendChild(outer);
  DOC_ROOTS.push(panel);

  const got = M.pickFromMenu();
  ok('B14 下拉菜单里找得到「商品」', got === inner, got ? '拿到 ' + M.classOf(got) : '没拿到');
  ok('B15   └ 取最深那层（点内层最准）', got === inner);
}
{
  DOC_ROOTS.length = 0;
  const panel = new FakeEl('div', { class: 'aurora-tabs-dropdown' }, []);
  const item = new FakeEl('div', { class: 'aurora-tabs-dropdown-menu-item' },
    [new FakeText('商品曝光-点击率(人数)')]);
  item.rect = { left: 1200, top: 490, width: 160, height: 32 };
  panel.appendChild(item);
  DOC_ROOTS.push(panel);
  eq('B16 下拉里的长句不命中（与标签同一套文案口径）', M.pickFromMenu(), null);
}
{
  DOC_ROOTS.length = 0;
  const panel = new FakeEl('div', { class: 'aurora-tabs-dropdown' }, []);
  const item = new FakeEl('div', { class: 'aurora-tabs-dropdown-menu-item' },
    [new FakeText('商品')]);
  item.rect = { left: 0, top: 0, width: 0, height: 0 };   // 面板没开 ⇒ 量不到
  panel.appendChild(item);
  DOC_ROOTS.push(panel);
  eq('B17 面板没开（项量不到尺寸）⇒ 不命中，不乱点', M.pickFromMenu(), null);
}

/* ---------- C. 选中态判定 ---------- */
console.log('\nC. 选中态判定');
ok('C1 aria-selected="true"', M.isActive(tab('商品', { sel: true })) === true);
ok('C2 aria-selected="false"', M.isActive(tab('商品', { sel: false })) === false);
ok('C3 类名含 active（aurora-tabs-tab-active）',
   M.isActive(tab('商品', { cls: 'aurora-tabs-tab aurora-tabs-tab-active' })) === true);
ok('C4 类名 inactive 不算选中',
   M.isActive(tab('商品', { cls: 'aurora-tabs-tab inactive' })) === false);
{
  // role 在内层、aria-selected 挂在外层
  const outer = new FakeEl('div', { 'aria-selected': 'true' }, []);
  const inner = tab('商品', {});
  outer.appendChild(inner);
  ok('C5 aria-selected 在外层也认', M.isActive(inner) === true);
}

/* ---------- D. 卡片（这一页的真实形态） ---------- */

console.log('\nD. 卡片（「核心数据分组」里那张「商品」卡）');

/**
 * 造一张卡片：容器 + 标题 + 指标名 + 数值。
 * 形状照真机截图：`div.card-XXXX` 里有「商品」/「商品曝光-点击率(人数)」/「19.08%」。
 */
function cardEl(cls, title, w, h) {
  const card = new FakeEl('div', { class: cls }, []);
  const t = new FakeEl('div', {}, [new FakeText(title)]);
  t.rect = { left: 0, top: 0, width: 40, height: 18 };
  card.appendChild(t);
  const m = new FakeEl('div', {}, [new FakeText('商品曝光-点击率(人数)')]);
  m.rect = { left: 0, top: 20, width: 160, height: 18 };
  card.appendChild(m);
  const v = new FakeEl('div', {}, [new FakeText('19.08%')]);
  v.rect = { left: 0, top: 40, width: 60, height: 22 };
  card.appendChild(v);
  card.rect = { left: 0, top: 0, width: w || 268, height: h || 100 };
  return card;
}

{
  // 真机形态：一排等宽卡片，其中一张叫「商品」
  DOC_ROOTS.length = 0;
  const row = new FakeEl('div', { class: 'cardGroup-TvP0qi' }, []);
  const c1 = cardEl('card-Po1YAu', '流量/转化');
  const c2 = cardEl('card-Po1YAu', '商品');
  const c3 = cardEl('card-Po1YAu', '互动');
  row.appendChild(c1); row.appendChild(c2); row.appendChild(c3);
  row.rect = { left: 0, top: 0, width: 1136, height: 237 };
  DOC_ROOTS.push(row);

  ok('D1 按卡片容器找得到「商品」那张卡（返回卡片本身，点整张最稳）',
     M.pickCard() === c2,
     M.pickCard() ? '拿到 ' + M.classOf(M.pickCard()) + '/' + M.cardTitleOf(M.pickCard()) : '没找到');
  ok('D1b   └ 不是返回里面的标题文字', M.pickCard() !== c2.childNodes[0]);
  eq('D1c 行容器 cardGroup 不算卡片（点它不生效）',
     M.hasCardClass(row), false);
  eq('D1d 真卡片 card-Po1YAu 算卡片', M.hasCardClass(c2), true);
}
{
  // 同一张卡里「商品曝光-点击率(人数)」是长句，绝不能把它当标题
  DOC_ROOTS.length = 0;
  const card = cardEl('card-Po1YAu', '商品');
  DOC_ROOTS.push(card);
  eq('D2 卡片标题取的是「商品」，不是长句「商品曝光-点击率(人数)」',
     M.cardTitleOf(card), '商品');
  ok('D2b 长句不满足标题判据（超过 8 字）',
     M.matchesCardText('商品曝光-点击率(人数)') === false);
}
{
  // 一排卡片里没有「商品」⇒ 不命中，绝不乱点别的卡
  DOC_ROOTS.length = 0;
  const row = new FakeEl('div', { class: 'cardGroup-TvP0qi' }, []);
  row.appendChild(cardEl('card-Po1YAu', '流量/转化'));
  row.appendChild(cardEl('card-Po1YAu', '互动'));
  row.appendChild(cardEl('card-Po1YAu', '人群'));
  DOC_ROOTS.push(row);
  eq('D3 一排卡里没有「商品」⇒ 不命中（绝不乱点别的卡）', M.pickCard(), null);
}
{
  // 尺寸过大的容器不算卡片
  DOC_ROOTS.length = 0;
  const big = cardEl('card-Po1YAu', '商品', 900, 300);
  DOC_ROOTS.push(big);
  eq('D4 尺寸过大的容器不算卡片', M.pickCard(), null);
}
{
  // 隐藏的卡片不算
  DOC_ROOTS.length = 0;
  const card = cardEl('card-Po1YAu', '商品');
  card.rect = { left: 0, top: 0, width: 0, height: 0 };
  DOC_ROOTS.push(card);
  eq('D5 量不到尺寸的卡片（隐藏副本）不算', M.pickCard(), null);
}
{
  // ⚠️ 回归护栏：真机实测「标题到卡片容器隔了 6 层以上」，旧版只找 4 层 ⇒ 必失败
  DOC_ROOTS.length = 0;
  const card = new FakeEl('div', { class: 'card-NqQkmw' }, []);
  let deep = new FakeEl('div', {}, [new FakeText('商品')]);
  let cur = deep;
  for (let i = 0; i < 6; i++) {
    const up = new FakeEl('div', {}, []);
    up.appendChild(cur);
    cur = up;
  }
  deep = cur;
  card.appendChild(deep);
  card.rect = { left: 0, top: 0, width: 268, height: 100 };
  DOC_ROOTS.push(card);

  eq('D6 标题在卡片里嵌套 7 层 ⇒ 仍能找到（旧版 4 层够不着，这是真机失效的根因）',
     M.pickCardByText(), card);
}
{
  // C 档：完全不认类名，只靠「等宽等高的兄弟排成一排」
  DOC_ROOTS.length = 0;
  const row = new FakeEl('div', { class: 'unknown-row-Xy1' }, []);
  const mk = (title) => {
    const c = new FakeEl('div', { class: 'no-card-hint' }, [new FakeText(title)]);
    c.rect = { left: 0, top: 0, width: 268, height: 100 };
    return c;
  };
  const c1 = mk('流量/转化');
  const c2 = mk('商品');
  const c3 = mk('互动');
  row.appendChild(c1); row.appendChild(c2); row.appendChild(c3);
  DOC_ROOTS.push(row);

  eq('D7 不认类名也能靠「一排等宽卡」找到「商品」那张', M.pickCardByRow(), c2);
}
{
  // C 档反例：孤零零一个「商品」文字，旁边没有一样大的兄弟 ⇒ 不命中
  DOC_ROOTS.length = 0;
  const alone = new FakeEl('div', { class: 'someText-Xy1' }, [new FakeText('商品')]);
  alone.rect = { left: 0, top: 0, width: 268, height: 100 };
  DOC_ROOTS.push(alone);
  eq('D8 没有「等宽兄弟」的孤立文字 ⇒ C 档不命中（防误点正文）',
     M.pickCardByRow(), null);
}
{
  // 「尺寸相近」的容差：差 60% 就不算一排
  DOC_ROOTS.length = 0;
  const row = new FakeEl('div', {}, []);
  const target = new FakeEl('div', {}, [new FakeText('商品')]);
  target.rect = { left: 0, top: 0, width: 100, height: 100 };
  const big = new FakeEl('div', {}, []);
  big.rect = { left: 0, top: 0, width: 300, height: 100 };
  row.appendChild(target); row.appendChild(big);
  DOC_ROOTS.push(row);
  eq('D9 兄弟尺寸差 60% 不算「一排卡」', M.hasSimilarSiblings(target), false);
}
{
  // ⚠️ 回归护栏（真 bug）：B 档用 /card/i 找祖先时，会把 cardGroup 行容器
  //    也当成卡片 ⇒ 点上去不生效，表现和「没找到」一模一样。
  //    这里把行容器造成「尺寸也像卡片」，逼出类名判据那一层。
  DOC_ROOTS.length = 0;
  const row = new FakeEl('div', { class: 'cardGroup-TvP0qi' }, []);
  const title = new FakeEl('div', {}, [new FakeText('商品')]);
  row.appendChild(title);
  row.rect = { left: 0, top: 0, width: 268, height: 100 };
  DOC_ROOTS.push(row);

  eq('D10 B 档不接受 cardGroup 行容器（旧写法 /card/i 会中招）',
     M.pickCardByText(), null);
  eq('D10b   └ 整条链一起看也不接受', M.pickCard(), null);
}
{
  // ⚠️ 回归护栏（真机最可能的失效形态）：卡片标题前面若插了一个问号气泡
  //    / 图标文字，A 档「取第一个短文本」就会读成「?」而不是「商品」⇒ A 档必失效。
  //    这时必须由 B 档（按文本节点找）救回来。
  DOC_ROOTS.length = 0;
  const card = new FakeEl('div', { class: 'card-NqQkmw' }, []);
  const tip = new FakeEl('span', {}, [new FakeText('?')]);
  tip.rect = { left: 240, top: 4, width: 12, height: 12 };
  card.appendChild(tip);
  const t = new FakeEl('div', {}, [new FakeText('商品')]);
  t.rect = { left: 12, top: 6, width: 40, height: 18 };
  card.appendChild(t);
  const m = new FakeEl('div', {}, [new FakeText('商品曝光-点击率(人数)')]);
  m.rect = { left: 12, top: 28, width: 160, height: 18 };
  card.appendChild(m);
  card.rect = { left: 0, top: 0, width: 268, height: 100 };
  DOC_ROOTS.push(card);

  eq('D11 标题前多了个「?」气泡 ⇒ A 档确实读歪（读成「?」）',
     M.pickCardByContainer(), null);
  eq('D11b   └ 由 B 档按文本救回来（三档兜底的真实价值）',
     M.pickCard(), card);
}

/* ---------- E. 点击派发 ---------- */

console.log('\nE. 点击派发');
{
  const el = tab('商品', {});
  const okFired = M.fire(el);
  const types = el.__dispatched.map((e) => e.type);
  ok('E1 派发成功', okFired === true);
  ok('E2 发了 pointerdown（平台捕获阶段吞 click 时的第二条路）',
     types.indexOf('pointerdown') >= 0, '实际 ' + types.join(','));
  ok('E3 发了 click', types.indexOf('click') >= 0, '实际 ' + types.join(','));
  const clickEv = el.__dispatched.find((e) => e.type === 'click');
  ok('E4 click 必须冒泡（React 17+ 合成事件委托在 root 上）',
     clickEv && clickEv.bubbles === true);
  ok('E5 click 可取消（给平台 preventDefault 留口）',
     clickEv && clickEv.cancelable === true);
}
{
  // 老内核（360 极速浏览器X）没有 PointerEvent ⇒ 只发 click，不能报错
  const saved = global.PointerEvent;
  delete global.PointerEvent;
  const el = tab('商品', {});
  let threw = false;
  try { M.fire(el); } catch (e) { threw = true; }
  const types = el.__dispatched.map((e) => e.type);
  ok('E6 无 PointerEvent 的老内核上不报错', threw === false);
  ok('E7   └ 仍发出 click', types.indexOf('click') >= 0);
  ok('E8   └ 不发 pointerdown', types.indexOf('pointerdown') < 0);
  global.PointerEvent = saved;
}

/* ---------- F. 作用页判定 ---------- */

console.log('\nF. 作用页判定');
{
  const cases = [
    ['https://compass.jinritemai.com/shop/live-detail?a=1', true, '抖店侧直播明细'],
    ['https://compass.jinritemai.com/talent/live-statement?b=2', true, '达人侧直播明细'],
    ['https://compass.jinritemai.com/screen/live/pro', false, '直播大屏不是本页'],
    ['https://compass.jinritemai.com/shop/commodity/product-list', false, '罗盘商品列表不是本页'],
    ['https://fxg.jinritemai.com/ffa/content-tool/live/control', false, '中控台不是本页']
  ];
  for (const [href, want, label] of cases) {
    global.location.href = href;
    eq('F ' + label + (want ? ' ⇒ 是' : ' ⇒ 不是'), M.onThisPage(), want);
  }
  global.location.href = 'https://compass.jinritemai.com/shop/live-detail?x=1';
}

/* ---------- G. 不跟用户抢方向盘 ---------- */

console.log('\nG. 用户手动操作 ⇒ 停手（isTrusted 分流）');
{
  ok('G1 点在标签本身 ⇒ 认得出是标签栏',
     M.insideTabBar(tab('商品', {})) === true);
  ok('G2 点在标签内部文字上 ⇒ 顺祖先链也认得出',
     M.insideTabBar(tab('商品', {}).childNodes[0]) === true);
  {
    const bar = new FakeEl('div', { class: 'aurora-tabs-nav-list' }, []);
    const inner = new FakeEl('span', {}, []);
    bar.appendChild(inner);
    ok('G3 点在标签栏容器内的子元素上 ⇒ 也算（tabs-nav 判据）',
       M.insideTabBar(inner) === true);
  }
  ok('G4 页面别处的元素 ⇒ 不算（点空白不误伤）',
     M.insideTabBar(new FakeEl('div', { class: 'card-Po1YAu' }, [])) === false);
}

/* ---------- H. 开关元数据 ---------- */

console.log('\nH. 开关元数据（flags.js）');
{
  ok('H1 有 liveDetailAutoTab 开关', /key:\s*'liveDetailAutoTab'/.test(flagsSrc));
  ok('H2 默认开（default: true）',
     /key:\s*'liveDetailAutoTab'[\s\S]{0,400}?default:\s*true/.test(flagsSrc));
  ok('H3 归在抖店组', /key:\s*'liveDetailAutoTab'[\s\S]{0,200}?group:\s*'shop'/.test(flagsSrc));
  ok('H4 作用页声明为 compassLive',
     /key:\s*'liveDetailAutoTab'[\s\S]{0,800}?pages:\s*\['compassLive'\]/.test(flagsSrc));
  ok('H4b 弹窗说明已含「商品明细」（附加的下滑动作要能被用户看见）',
     /desc:\s*'[^']*商品明细/.test(
       (flagsSrc.match(/key:\s*'liveDetailAutoTab'[\s\S]{0,800}?desc:\s*'[^']*'/) || [''])[0]
     ));
}
{
  const mf = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
  const entry = (mf.content_scripts || []).find(
    (cs) => (cs.matches || []).some((m) => m.indexOf('shop/live-detail') >= 0));
  ok('H5 manifest 直播明细条目存在', !!entry);
  ok('H6   └ 已挂上 live-detail-tab.js',
     !!entry && (entry.js || []).indexOf('src/live/live-detail-tab.js') >= 0);
  ok('H7   └ 挂在功能层、位于 flags.js 之后',
     !!entry && (entry.js || []).indexOf('src/live/live-detail-tab.js') > 0);
}

/* ---------- I. 下滑到「商品明细」 ---------- */

console.log('\nI. 下滑到「商品明细」');
{
  DOC_ROOTS.length = 0;
  global.WINDOW_SCROLL.y = 0;

  // 页面主体：一个可滚容器（内容 3000 / 可视 800），里面放若干标题
  const page = new FakeEl('div', { class: 'layout-body' }, []);
  page.scroll = { top: 0, height: 800, content: 3000 };
  page.overflowY = 'auto';

  function heading(text, top) {
    const el = new FakeEl('div', { class: 'block-title-Xy1' }, [new FakeText(text)]);
    el.rect = { left: 40, top: top, width: 120, height: 22 };
    return el;
  }
  const hCore = heading('核心数据', 100);
  const hKey = heading('关键指标', 500);
  const hSec = heading('商品明细', 1600);          // 目标：未滚动时在 1600
  const hLong = heading('商品明细里的退款件数分布说明', 1900);   // 长句，不该命中
  page.appendChild(hCore); page.appendChild(hKey);
  page.appendChild(hSec); page.appendChild(hLong);
  DOC_ROOTS.push(page);

  ok('I1 找得到「商品明细」标题', M.findSectionAnchor() === hSec,
     M.findSectionAnchor() ? '拿到别的：' + M.findSectionAnchor().textContent : '没找到');
  ok('I2   └ 长句「商品明细里的退款件数分布说明」不命中', M.findSectionAnchor() !== hLong);

  // 滚动链：只有 page 一个可滚容器
  const chain = M.scrollChainOf(hSec);
  eq('I3 滚动链只含真正能滚的那个容器', chain.length, 1);
  ok('I4   └ 就是 page', chain[0] === page);
}
{
  // 滚到位：目标 top 1600 ⇒ 要让它在视口顶下方 96px ⇒ 滚 1600-96 = 1504
  DOC_ROOTS.length = 0;
  global.WINDOW_SCROLL.y = 0;
  const page = new FakeEl('div', {}, []);
  page.scroll = { top: 0, height: 800, content: 3000 };
  page.overflowY = 'auto';
  const sec = new FakeEl('div', {}, [new FakeText('商品明细')]);
  sec.rect = { left: 40, top: 1600, width: 120, height: 22 };
  page.appendChild(sec);
  DOC_ROOTS.push(page);

  const okDone = M.alignToSection(sec);
  ok('I5 滚到目标位置后返回「已到位」', okDone === true);
  const topAfter = sec.getBoundingClientRect().top;
  ok('I6   └ 标题落在视口顶下方 ' + M.SECTION_TOP_GAP + 'px 附近（实测 '
     + topAfter.toFixed(1) + '）',
     Math.abs(topAfter - M.SECTION_TOP_GAP) <= 4);
  eq('I7   └ 可滚容器实际滚了 1504px', Math.round(page.scrollTop), 1504);
}
{
  // 目标已在视口内且位置正好 ⇒ 不该乱滚
  DOC_ROOTS.length = 0;
  global.WINDOW_SCROLL.y = 0;
  const page = new FakeEl('div', {}, []);
  page.scroll = { top: 1504, height: 800, content: 3000 };
  page.overflowY = 'auto';
  const sec = new FakeEl('div', {}, [new FakeText('商品明细')]);
  sec.rect = { left: 40, top: 1600, width: 120, height: 22 };
  page.appendChild(sec);
  DOC_ROOTS.push(page);

  const okDone = M.alignToSection(sec);
  ok('I8 已经到位 ⇒ 直接返回 true，不改动滚动位置', okDone === true);
  eq('I9   └ 滚动位置没变', Math.round(page.scrollTop), 1504);
}
{
  // 容器滚不动（内容不够高）⇒ 位移落到 window
  DOC_ROOTS.length = 0;
  global.WINDOW_SCROLL.y = 0;
  const wrap = new FakeEl('div', {}, []);
  wrap.scroll = { top: 0, height: 900, content: 900 };   // 不可滚
  wrap.overflowY = 'auto';
  const sec = new FakeEl('div', {}, [new FakeText('商品明细')]);
  sec.rect = { left: 40, top: 500, width: 120, height: 22 };
  wrap.appendChild(sec);
  DOC_ROOTS.push(wrap);

  eq('I10 内容不高于可视区 ⇒ 不算可滚容器', M.canScrollY(wrap), false);
  const okDone = M.alignToSection(sec);
  ok('I11 位移落到 window（返回已到位）', okDone === true);
  eq('I12   └ window 滚了 500-96=404', Math.round(global.WINDOW_SCROLL.y), 404);
}
{
  // overflow:hidden 的裁切容器滚不动，不能算进滚动链
  DOC_ROOTS.length = 0;
  const clip = new FakeEl('div', {}, []);
  clip.scroll = { top: 0, height: 400, content: 1200 };
  clip.overflowY = 'hidden';
  eq('I13 overflow:hidden 的容器不算可滚容器（赋 scrollTop 不生效）',
     M.canScrollY(clip), false);
}
{
  // 找不到锚点 ⇒ 不乱滚，返回 false
  DOC_ROOTS.length = 0;
  global.WINDOW_SCROLL.y = 0;
  const page = new FakeEl('div', {}, []);
  page.scroll = { top: 0, height: 800, content: 3000 };
  page.overflowY = 'auto';
  page.appendChild(new FakeEl('div', {}, [new FakeText('核心数据')]));
  DOC_ROOTS.push(page);

  eq('I14 页面上没有「商品明细」⇒ 锚点为 null，不滚', M.findSectionAnchor(), null);
}
{
  // 标签栏里的「商品明细」（比如某个页签叫这名）不该被当区块标题
  DOC_ROOTS.length = 0;
  global.WINDOW_SCROLL.y = 0;
  const bar = new FakeEl('div', { class: 'aurora-tabs-nav-list' }, []);
  const t = tab('商品明细', {});
  bar.appendChild(t);
  DOC_ROOTS.push(bar);
  eq('I15 标签栏里的同名文字不算区块标题（点的是页签，不是往下滚）',
     M.findSectionAnchor(), null);
}
{
  // ⚠️ 回归护栏：`tabs-tabpane`（内容容器）**不是**标签栏。
  //    整串 /tabs-tab/ 匹配会把它算进去 ⇒ 「商品明细」永远被认为在标签栏里
  //    ⇒ 永远滚不下去。这条用例专门盯这个坑。
  DOC_ROOTS.length = 0;
  global.WINDOW_SCROLL.y = 0;
  const pane = new FakeEl('div', { class: 'aurora-tabs-tabpane aurora-tabs-tabpane-active' }, []);
  pane.scroll = { top: 0, height: 800, content: 3000 };
  pane.overflowY = 'auto';
  const sec = new FakeEl('div', {}, [new FakeText('商品明细')]);
  sec.rect = { left: 40, top: 1600, width: 120, height: 22 };
  pane.appendChild(sec);
  DOC_ROOTS.push(pane);

  eq('I17 tabs-tabpane（内容容器）不算标签栏',
     M.insideTabBar(sec), false);
  ok('I18   └ 所以内容区里的「商品明细」标题找得到', M.findSectionAnchor() === sec);
}
{
  // 与上面成对：真正的标签栏仍要认出来
  DOC_ROOTS.length = 0;
  const bar = new FakeEl('div', { class: 'aurora-tabs-nav-list' }, []);
  const t = tab('商品明细', {});
  bar.appendChild(t);
  DOC_ROOTS.push(bar);
  eq('I19 真标签栏（tabs-nav-list）仍算标签栏', M.insideTabBar(t), true);
}
{
  // 折叠/隐藏的副本（量不到尺寸）不算标题
  DOC_ROOTS.length = 0;
  const hidden = new FakeEl('div', {}, [new FakeText('商品明细')]);
  hidden.rect = { left: 0, top: 0, width: 0, height: 0 };
  DOC_ROOTS.push(hidden);
  eq('I16 量不到尺寸的「商品明细」（隐藏副本）不算标题', M.findSectionAnchor(), null);
}

/* ---------- J. 消息提示（第 21 条三段式：来源 ｜ 值 ｜ 结果数） ---------- */

console.log('\nJ. 消息提示');

/**
 * 提示这一档单独建模块实例：`scrollDoneSaid` / `tabMissSaid` 是模块级状态，
 * 复用 M 会和 I 段的用例互相污染。每次要「干净的首次」就新建一个。
 *
 * @param {boolean} confirmed 是否模拟「读到标签选中态」的标签档。
 *   导出对象是**值快照**，改 `S.tabConfirmed` 不会影响闭包内部，
 *   所以只能在构建时注入（走 buildModule 的 post 钩子）。
 */
function buildSayModule(confirmed) {
  return buildModule(
    ['say', 'takeSpeech', 'sayScrollDone', 'sayScrollMiss', 'sayTabOnly', 'sayTabMiss'],
    ['SRC', 'MSG_DONE', 'MSG_DONE_FULL', 'MSG_MISS', 'MSG_TAB_MISS',
     'MSG_CARD_MISS', 'MSG_TAB', 'MSG_CARD_ONLY', 'SECTION_TEXT',
     'scrollDoneSaid', 'tabConfirmed'],
    // dbg 在真实模块里是「写调试面板」，这里只需要它可调用、不报错 ——
    // 断言的是「有没有 toast」，不是日志
    'function dbg(){}',
    confirmed ? 'tabConfirmed = true;' : ''
  );
}

/** 截获 toast 调用 —— 断言真实发出的参数，而不是文本里有没有那几个字 */
let said = [];
global.toast = function (msg, type, opts) {
  said.push({ msg, type, opts: opts || {} });
};
const SRC_SRC = fs.readFileSync(SRC_PATH, 'utf8');

{
  // 来源词必须与弹窗 label 逐字一致（否则用户在弹窗里找不到提示说的那个东西）
  const label = (flagsSrc.match(/label:\s*'([^']*自动切商品页[^']*)'/) || [])[1];
  ok('J1 来源词与弹窗 label 逐字一致', label === '自动切商品页' && buildSayModule().SRC === label,
     'label=' + label + '，SRC=' + buildSayModule().SRC);
}
{
  // 成功 —— **整条链路只报这一条**（2026-10-20 用户二次定稿：
  // 「切换并成功下滑，要有消息提示」。上一轮砍过头了，中间态报喜仍然砍掉）
  said = [];
  const S = buildSayModule();
  S.sayScrollDone();
  eq('J2 切页+下滑成功 ⇒ 恰好一条提示', said.length, 1);
  eq('J3   └ 类型 success（成功也要进盒子，事后能回看）', said[0] && said[0].type, 'success');
  eq('J4   └ 条上用短版（横排不换行）', said[0] && said[0].msg, '已切到「商品」并下滑');
  eq('J5   └ 盒子里用全版（把落点说清）', said[0] && said[0].opts.full,
     '已切到「商品」并下滑到「商品明细」');
  eq('J6   └ 来源 = 自动切商品页', said[0] && said[0].opts.source, '自动切商品页');
}
{
  // 滚动表十几轮里可能连续几轮都判「到位」⇒ 不能连出好几条
  said = [];
  const S = buildSayModule();
  S.sayScrollDone();
  S.sayScrollDone();
  S.sayScrollDone();
  eq('J7 重复判「到位」也只报一条', said.length, 1);

  // 到位之后再说「没找到」就是自己打自己脸
  S.sayScrollMiss();
  eq('J8 成功后不再改口报失败', said.length, 1);
}
{
  // 卡片档成功**照样**说「已切到」—— 与下面 J16 的不对称是刻意的：
  // 「没找到」时卡片档读不到选中态，只能含糊；而「找到锚点并滚到位」时，
  // 「商品明细」只存在于商品屏 ⇒ 切页已生效是实证，不必靠选中态推断。
  said = [];
  const S = buildSayModule();   // tabConfirmed = false，模拟卡片档
  S.sayScrollDone();
  ok('J9 卡片档成功也说「已切到」（有锚点即实证）',
     said[0] && said[0].msg.indexOf('已切到「商品」') === 0, said[0] && said[0].msg);
}
{
  // 用户自己接管滚动 ⇒ **要说一声**（2026-10-20:正常使用也只能一条，不能默不作声），
  // 但只能报前半个事实：他接管了滚动，我确实没替他下滑
  said = [];
  const S = buildSayModule(true);
  S.sayTabOnly();
  eq('J10 用户接管滚动 ⇒ 一条提示（不能默不作声）', said.length, 1);
  eq('J11   └ 类型 info（条上可见、不进盒子，避免每刷一次积一条）', said[0].type, 'info');
  eq('J12   └ 文案「已切到「商品」」', said[0].msg, '已切到「商品」');
  ok('J13   └ 不谎报「并下滑」（确实没替他滑）', said[0].msg.indexOf('下滑') < 0, said[0].msg);

  // 让路之后再跑其余出口 —— 全被闸掉（这就是「只弹一条」的落点）
  S.sayScrollMiss();
  S.sayTabMiss();
  S.sayScrollDone();
  eq('J14 让路后其余三个出口全被闸掉', said.length, 1);
}
{
  // 失败情形一：切过去了，但没找到「商品明细」
  said = [];
  const S = buildSayModule(true);    // 标签档：读到选中态 = 事实，可以用「已切到」
  S.sayScrollMiss();
  eq('J15 没找到「商品明细」⇒ 报一条', said.length, 1);
  eq('J16   └ 类型 alert（异常要进盒子）', said[0].type, 'alert');
  eq('J17   └ 来源 = 自动切商品页', said[0].opts.source, '自动切商品页');
  ok('J18   └ 文案说清「切到了、但没滚」', said[0].msg.indexOf('已切到「商品」') === 0
     && said[0].msg.indexOf('没找到「商品明细」') > 0, said[0].msg);

  S.sayScrollMiss();
  S.sayScrollDone();
  eq('J19 重复调用 / 之后又到位 ⇒ 仍只一条', said.length, 1);
}
{
  // 卡片档（tabConfirmed=false）在「没找到」时绝不能断言「已切到」
  // —— 那是把猜测当事实报（用户 2026-10-20：不许谎报）
  said = [];
  const S = buildSayModule();
  S.sayScrollMiss();
  ok('J20 卡片档失败措辞为「已点…卡片」', said[0].msg.indexOf('已点「商品」卡片') === 0, said[0].msg);
  ok('J21   └ 不说「已切到」', said[0].msg.indexOf('已切到') < 0, said[0].msg);
}
{
  // 失败情形二：连「商品」都没找到（功能没兑现承诺）
  said = [];
  const S = buildSayModule();
  S.sayTabMiss();
  eq('J22 找不到「商品」时报 alert', said[0].type, 'alert');
  eq('J23   └ 来源同样带 source', said[0].opts.source, '自动切商品页');
  ok('J24   └ 文案说明「未切换」', said[0].msg.indexOf('未切换') > 0, said[0].msg);

  S.sayTabMiss();
  eq('J25 连试多次也只报一次', said.length, 1);
}
{
  // 源码红线：四个出口各自该不该发声、用什么类型
  const doneFn = sliceFunction(SRC_SRC, 'sayScrollDone');
  const onlyFn = sliceFunction(SRC_SRC, 'sayTabOnly');
  const missFn = sliceFunction(SRC_SRC, 'sayScrollMiss');
  const tabMissFn = sliceFunction(SRC_SRC, 'sayTabMiss');
  ok('J26 成功分支发声', doneFn.indexOf('say(MSG_DONE') > 0);
  ok('J27 成功分支用 success（进盒子，事后能回看结果）', /'success'/.test(doneFn));
  ok('J28 让路分支发声且用 info（进盒子就成了噪音）',
     onlyFn.indexOf('say(') > 0 && /'info'/.test(onlyFn));
  ok('J29 两个失败分支都出声（alert）',
     missFn.indexOf("'alert'") > 0 && tabMissFn.indexOf("'alert'") > 0);
  ok('J30 开关回声也走同一个来源词（没有裸字面量）',
     SRC_SRC.indexOf("source: '自动切商品页'") < 0
     && /toast\(now \? '已开启' : '已关闭', 'info', \{ source: SRC \}\)/.test(SRC_SRC));
  ok('J31 两个失败分支互斥（切成功后不会再走到「未切换」）',
     /if \(done \|\| userTook \|\| !enabled\(\) \|\| !onThisPage\(\)\) return;/.test(SRC_SRC));
}
{
  // 「只弹一条」必须由**单一闸门**保证，不能靠几个独立布尔量恰好互斥
  // （本项目就先吃过两套去重并行 —— scrollDoneSaid + tabMissSaid）
  ok('J32 四个出口共用同一个闸门',
     SRC_SRC.indexOf('var tabMissSaid') < 0 && /function takeSpeech\(\)/.test(SRC_SRC));
  const calls = ['sayScrollDone', 'sayScrollMiss', 'sayTabOnly', 'sayTabMiss'];
  for (const fn of calls) {
    ok('J33 每个出口都先过闸门：' + fn,
       sliceFunction(SRC_SRC, fn).indexOf('takeSpeech()') > 0);
  }

  // 穷举：任意两个出口先后触发，总数恒为 1
  let bad = [];
  for (const a of calls) {
    for (const b of calls) {
      said = [];
      const S = buildSayModule(true);
      S[a]();
      S[b]();
      if (said.length !== 1) bad.push(a + '+' + b + '=' + said.length);
    }
  }
  eq('J34 穷举 16 种两出口组合 ⇒ 每种都只弹一条', bad.join(' '), '');
}
{
  // 报喜的位置：必须在「滚动到位」那一刻，不能挪到点击瞬间 ——
  // 挪过去就成了「点了就报成功」，点了没生效也报，比不报更糟
  const at = SRC_SRC.indexOf('④ 标签栏里压根没有');
  const cardBlock = at > 0 ? SRC_SRC.slice(at) : '';
  ok('J35 卡片点击分支里不报喜（点了 ≠ 成功了）',
     cardBlock.indexOf('sayScrollDone') < 0);
  ok('J36 报喜挂在滚动链路上（finishScroll / scheduleScroll 里）',
     /sayScrollDone\(\);/.test(sliceFunction(SRC_SRC, 'finishScroll'))
     || /sayScrollDone\(\);/.test(sliceFunction(SRC_SRC, 'scheduleScroll')));
}

/* ---------- K. 响应速度（2026-10-20 用户「检测下滑比较久」） ---------- */

/**
 * 这一节全部是**源码红线**：钉的是「延迟由哪几步堆出来」这个结构，
 * 不针对具体毫秒数调参（那种会到处乱红）。
 *
 * 旧实现的延迟是这么叠起来的：
 *   800ms 首轮 → 1600ms 冷却中跳过 → 2800ms 点第 2 次卡片 → 4500ms 才 scheduleScroll
 *   → 5100ms 滚动第 1 次 → 若锚点还没挂载,再等 600 → 1200 → 2200 …
 * 用户感知就是「切是切了,但半天不下滑」。三处一起改才把这条链路压到 1 秒内。
 */
console.log('\nK. 响应速度');

{
  // 卡片分支：必须「点完就 scheduleScroll」,而不是等点满 2 次
  const at = SRC_SRC.indexOf('④ 标签栏里压根没有');
  const cardBlock = at > 0 ? SRC_SRC.slice(at) : '';
  const fireAt = cardBlock.indexOf('var ok2 = fire(card);');
  const schedAfterFire = fireAt > 0 ? cardBlock.indexOf('scheduleScroll();', fireAt) : -1;
  ok('K1 卡片点完立刻开始找「商品明细」（不再等点满 2 次）',
     fireAt > 0 && schedAfterFire > fireAt,
     'fire@' + fireAt + ' schedule@' + schedAfterFire);
  ok('K2 锚点已出现 ⇒ 不再补点卡片',
     /cardClicks >= 1 && findSectionAnchor\(\)/.test(cardBlock));
}

{
  const first = Number((SRC_SRC.match(/var SCROLL_AT = \[(\d+)/) || [])[1]);
  ok('K3 滚动表首档 ≤ 150ms（原 600ms 起步太慢）', first > 0 && first <= 150,
     'SCROLL_AT[0]=' + first);
}

{
  const fn = sliceFunction(SRC_SRC, 'scheduleScroll');
  ok('K4 开表就先试一次（第 0 轮，不等第一个闹钟）', /if \(attemptScroll\(\)\) return;/.test(fn));
  ok('K5 铺表时挂上 DOM 唤醒（锚点一出现就滚，不等下一档）', /startDomWatch\(\);/.test(fn));
}

{
  const fin = sliceFunction(SRC_SRC, 'finishScroll');
  ok('K6 到位收尾断开观察器（不留空转的 observer）', /stopDomWatch\(\);/.test(fin));
  ok('K7 到位收尾也清闹钟', /clearScrollTimers\(\);/.test(fin));
}

{
  // 冷却拆成两份且都比原来短
  const tabCd = Number((SRC_SRC.match(/var TAB_CLICK_COOLDOWN_MS = (\d+)/) || [])[1]);
  const cardCd = Number((SRC_SRC.match(/var CARD_CLICK_COOLDOWN_MS = (\d+)/) || [])[1]);
  ok('K8 点击冷却拆成「标签 / 卡片」两份', tabCd > 0 && cardCd > 0 && cardCd < tabCd,
     'tab=' + tabCd + ' card=' + cardCd);
  ok('K9 卡片冷却 ≤ 1000ms（卡片是本地视图切换，反应快）', cardCd > 0 && cardCd <= 1000,
     'card=' + cardCd);
  ok('K10 标签冷却 ≤ 1600ms（原 2500ms）', tabCd > 0 && tabCd <= 1600, 'tab=' + tabCd);
}

{
  const retryFirst = Number((SRC_SRC.match(/var RETRY_AT = \[(\d+)/) || [])[1]);
  ok('K11 切页首轮 ≤ 600ms（原 800ms，卡片通常 1 秒内就渲染好了）',
     retryFirst > 0 && retryFirst <= 600, 'RETRY_AT[0]=' + retryFirst);
}

{
  // 观察器必须带节流：React 渲染一屏会连开几百个 mutation，
  // 每个都扫全文档的话那几百毫秒里 CPU 白烧
  const fn = sliceFunction(SRC_SRC, 'wakeScroll');
  ok('K12 DOM 唤醒带节流（不是每次变化都全量扫）',
     /WAKE_THROTTLE_MS/.test(fn) && /wakeTimer/.test(fn));
  ok('K13 唤醒回调只读新增节点自己的文本（大多数渲染零开销）',
     /records\[i\]\.addedNodes/.test(sliceFunction(SRC_SRC, 'startDomWatch')));
}

/* ---------- 汇总 ---------- */
console.log('\n' + '='.repeat(62));
console.log('通过 ' + pass + ' / ' + (pass + fail));
if (fail) {
  console.log('失败用例：');
  failures.forEach((f) => console.log('  · ' + f));
  process.exit(1);
}
console.log('全绿 ✓ —— 直播明细「打开即切商品 + 下滑到商品明细」的判据、兜底与点击/滚动派发符合约定');
