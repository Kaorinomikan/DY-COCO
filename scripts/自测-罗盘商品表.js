/**
 * 罗盘商品表(反馈 #95)· 回归自测 —— 直接抽取**源文件里真实的函数源码**跑，不复制实现
 * ============================================================
 * 被测文件：src/live/compass-table.js
 * （罗盘「商品列表」/shop/commodity/product-list、
 *   罗盘「商品卡列表」/shop/merchandise-traffic）
 *
 * 覆盖四件事：
 *   A. 取值不污染 —— 我们自己注入的「货号」按钮文案 + 右列数字，
 *      绝不能被当成平台货号（反馈 #96 的原样复现场景，见 docs/agents/用户要求.md 第 23 条）
 *   B. 名称元素识别 —— 三级判据（类名前缀 / 缩略图单元格 / 整行兜底）
 *      各自单独成立，且「平台提示语比商品名更长」时不能挑错
 *   C. 行识别 —— 必须剔掉 aurora 的测量行(高度 0)、表头行、列数过少的嵌套行
 *   D. 款号口径 —— 纯数字官方货号照读；名称末尾推算只认「≥4 位且含数字」
 *
 * 做法与 scripts/自测-货号取值.js 同源：按函数名抠出源码 → 最小 DOM 垫片上求值 →
 * 断言结果。源码一改自测自动跟着变，不会「测试绿了线上还错」。
 *
 * 用法：node scripts/自测-罗盘商品表.js
 * 退出码 0 = 全绿；1 = 有用例失败。
 * ============================================================
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SRC_PATH = path.join(ROOT, 'src/live/compass-table.js');
/* 款号判据是共享的（src/content/item-code.js 单一真源），装配时一并注入 */
const SHARED = fs.readFileSync(path.join(ROOT, 'src/content/item-code.js'), 'utf8');
/* 判据断言直接打共享实现：它才是四个页面共用的那一份 */
const J = new Function(SHARED + '\nreturn { isCodeLike: dycIsCodeLike };')();

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
  querySelectorAll: () => [],
  getElementById: () => null,
  head: { appendChild() {} },
  body: { appendChild() {} },
  createElement: (tag) => new FakeEl(tag || 'div', {}, []),
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
// getComputedStyle：被测代码只读 display / overflow / whiteSpace
global.getComputedStyle = (el) => {
  const s = el._sizes;
  return {
    display: s.display || 'block',
    overflow: s.overflow || 'visible',
    overflowY: s.overflowY || 'visible',
    whiteSpace: s.whiteSpace || 'normal',
    webkitLineClamp: s.lineClamp || 'none',
    getPropertyValue: (k) => (k === '-webkit-line-clamp' ? (s.lineClamp || 'none') : '')
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
  PointerEvent: function PointerEvent() {}
};
/** 用例可接管：给元素返回任意矩形（模拟被挤出视口 / 被裁切） */
global.__rectHook = null;

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

const M = buildModule(
  ['isExtNode', 'textWithoutExt', 'infoCellOf', 'readOfficialCode',
   'guessFromName', 'readCode', 'hasDirectText', 'looksLikeName', 'pickNameIn',
   'imageCellOf', 'findNameEl', 'getRows'],
  ['EXT_MARKS', 'NAME_MAX_SCAN', 'NOT_NAME', 'ONLY_NUM', 'HINT_TEXT'],
  SHARED
);

/* ============================================================
 * 3. 构造测试行（照结构报告的形状）
 * ============================================================ */

const NAME_TEXT = '早春新款黑色菱格纹双头拉链领外套 NE1C1091W';

/** 我们注入的「货号」按钮 */
function ourBtn() {
  return new FakeEl('button', { 'data-dyc-ct-btn': '1' }, [new FakeText('货号')]);
}

/**
 * 造一行：序号 | 商品信息(缩略图+名称+按钮) | 成交件数 | 支付金额 | 点击人数 | 成交率 | 操作
 * @param {object} o {deal, nameClass, withImg, hint}
 */
function buildRow(o) {
  o = o || {};
  const nameAttrs = o.nameClass === false ? {} : { class: o.nameClass || 'productName-a1b2c3' };
  const name = new FakeEl(o.nameTag || 'p', nameAttrs, [new FakeText(o.nameText || NAME_TEXT)]);
  const infoKids = [];
  if (o.withImg !== false) infoKids.push(new FakeEl('img', {}, []));
  infoKids.push(name);
  if (o.hint) infoKids.push(new FakeEl('span', {}, [new FakeText(o.hint)]));
  // 默认带上我们注入的按钮 —— 取值用例要证明「它不会污染取值」；
  // 注入用例要传 ourButton:false，否则 querySelector('button') 会先命中这枚假按钮。
  if (o.ourButton !== false) infoKids.push(ourBtn());
  const infoCell = new FakeEl('td', {}, infoKids);

  const tr = new FakeEl('tr', { class: 'aurora-table-row' }, [
    new FakeEl('td', {}, [new FakeText('1')]),
    infoCell,
    new FakeEl('td', {}, [new FakeText(o.deal || '340')]),
    new FakeEl('td', {}, [new FakeText('¥131,395.55')]),
    new FakeEl('td', {}, [new FakeText('5,341')]),
    new FakeEl('td', {}, [new FakeText('5.2%')]),
    new FakeEl('td', {}, [new FakeEl('button', {}, [new FakeText('查看详情')])])
  ]);
  tr.size = { clientWidth: 1507, clientHeight: 88, scrollWidth: 1507, scrollHeight: 88 };
  return { tr, nameEl: name, infoCell };
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
    eq('右列为「' + deal + '」时不误取', r.code, 'NE1C1091W');
    eq('  └ 来源应为名称推算', r.from, 'guess');
  }
  // 污染源自证：innerText 确实会拼出「货号 340」
  const { tr, nameEl } = buildRow({ deal: '340' });
  const dirty = tr.innerText;
  const dirtyHit = (dirty.match(/货号\s*[:：]?\s*([A-Za-z0-9\-_]{3,30})/) || [])[1] || null;
  ok('innerText 会拼出「货号 340」（证明这层防护是必要的）', dirtyHit === '340', '命中 ' + dirtyHit);
  const clean = M.textWithoutExt(M.infoCellOf(nameEl));
  eq('textWithoutExt 读不到我们自己的按钮文案', clean, NAME_TEXT);

  // 平台真写了货号时必须照读（含纯数字货号）
  for (const official of ['10086', 'NE1C0021W', 'A12']) {
    const name = new FakeEl('p', { class: 'productName-x' }, [new FakeText(NAME_TEXT)]);
    const cell = new FakeEl('td', {}, [
      new FakeEl('img', {}, []),
      name,
      new FakeEl('span', {}, [new FakeText('货号')]),
      new FakeEl('span', {}, [new FakeText(official)]),
      ourBtn()
    ]);
    const tr = new FakeEl('tr', {}, [new FakeEl('td', {}, [new FakeText('1')]), cell,
      new FakeEl('td', {}, [new FakeText('340')])]);
    const r = M.readCode(tr, name);
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

  // ② 无类名，缩略图单元格兜底
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

  // 价格 / 纯数字 / 平台标签都不算名称
  for (const bad of ['¥199.00', '12,345', '到手价', '累计销量']) {
    ok('「' + bad + '」不算商品名', M.looksLikeName(bad) === false);
  }
  ok('正常商品名应算名称', M.looksLikeName(NAME_TEXT) === true);
}

/* ---------- C. 行识别 ---------- */
console.log('\n=========== C. 行识别（剔除测量行 / 表头 / 嵌套小表）===========');
{
  const good = buildRow({}).tr;
  const measure = new FakeEl('tr', { class: 'aurora-table-measure-row' },
    Array.from({ length: 11 }, () => new FakeEl('td', {}, [])));
  measure.size = { clientWidth: 3028, clientHeight: 0 };

  const theadRow = new FakeEl('tr', {}, Array.from({ length: 11 }, () => new FakeEl('td', {}, [])));
  theadRow.size = { clientWidth: 1507, clientHeight: 44 };
  const thead = new FakeEl('thead', {}, [theadRow]);

  const nested = new FakeEl('tr', {}, [new FakeEl('td', {}, []), new FakeEl('td', {}, [])]);
  nested.size = { clientWidth: 200, clientHeight: 40 };

  const tbody = new FakeEl('tbody', { class: 'aurora-table-tbody' }, [measure, good]);
  const table = new FakeEl('table', {}, [thead, tbody]);
  global.document.querySelectorAll = (sel) => (sel === 'table' ? [table] : []);

  tbody.parentElement = table; thead.parentElement = table;
  nested.parentElement = tbody;

  const rows = M.getRows();
  eq('只留下 1 行商品行', rows.length, 1);
  ok('留下的正是商品行', rows[0] === good);
  ok('测量行被剔除', rows.indexOf(measure) === -1);
  ok('表头行被剔除', rows.indexOf(theadRow) === -1);
  ok('列数过少的嵌套行被剔除', rows.indexOf(nested) === -1);
}

/* ---------- D. 款号口径 ---------- */
console.log('\n=========== D. 款号口径 ===========');
{
  eq('纯数字官方货号算合法款号', J.isCodeLike('10086'), true);
  eq('三个字符起步', J.isCodeLike('A12'), true);
  eq('两个字符不算', J.isCodeLike('A1'), false);
  eq('含空格不算', J.isCodeLike('A1 2'), false);

  const nameEl = new FakeEl('p', {}, [new FakeText('某款外套 NE1C1091W')]);
  eq('名称末尾款号可推算', M.guessFromName(nameEl), 'NE1C1091W');
  const pureText = new FakeEl('p', {}, [new FakeText('某款夏季外套')]);
  eq('名称末尾不是款号时不瞎猜', M.guessFromName(pureText), '');
  const short = new FakeEl('p', {}, [new FakeText('某款外套 A1')]);
  eq('末尾不足 3 位不猜', M.guessFromName(short), '');

  // 2026-11-12 与中控台对齐（反馈 #137）：3 位款号、复合款号、纯尺码
  const three = new FakeEl('p', {}, [new FakeText('黑色丝毛侧拉链半身裙（有内衬）S28')]);
  eq('3 位款号可推算（#137）', M.guessFromName(three), 'S28');
  const composite = new FakeEl('p', {}, [
    new FakeText('【KiKi】【金绒流年】燕麦/乌木色羊毛老钱风背心外套 M609Y0544/0686')
  ]);
  eq('复合款号取整串', M.guessFromName(composite), 'M609Y0544/0686');
  eq('复合款号算合法款号', J.isCodeLike('M609Y0544/0686'), true);
  const size2xl = new FakeEl('p', {}, [new FakeText('某连衣裙 2XL')]);
  eq('尺码 2XL 不当款号', M.guessFromName(size2xl), '');
  const sizePair = new FakeEl('p', {}, [new FakeText('某连衣裙 2XL/3XL')]);
  eq('尺码对 2XL/3XL 不当款号', M.guessFromName(sizePair), '');
  const sixXl25 = new FakeEl('p', {}, [new FakeText('杏色连帽抽绳拉链外套 6XL25')]);
  eq('6XL25 不被尺码规则误杀', M.guessFromName(sixXl25), '6XL25');

  // 名称元素里裹着平台的「复制 ID」小按钮（2026-10-14 商品列表页踩过的形状）
  const withIdBtn = new FakeEl('p', {}, [
    new FakeText('某款外套 NE1C1091W '),
    new FakeEl('span', {}, [new FakeText('ID')])
  ]);
  eq('末尾裹着「ID」时仍能取到款号', M.guessFromName(withIdBtn), 'NE1C1091W');
  const withIdBtn2 = new FakeEl('p', {}, [
    new FakeText('某款外套 NE1C1091W '),
    new FakeEl('span', {}, [new FakeText('ID')]),
    new FakeEl('span', {}, [new FakeText('复制')])
  ]);
  eq('末尾裹着「ID 复制」时仍能取到款号', M.guessFromName(withIdBtn2), 'NE1C1091W');
  // 反向：款号本身以 ID 结尾时不能被剥掉
  const codeEndsId = new FakeEl('p', {}, [new FakeText('某款外套 AB12ID')]);
  eq('款号自己以 ID 结尾时不误剥', M.guessFromName(codeEndsId), 'AB12ID');
}

/* ---------- E. 按钮注入与点击全链路 ---------- */
// 剪贴板那条路是 Promise（navigator.clipboard.writeText().then）⇒ E 段整体放进
// 一个 async 函数里跑，断言前先 flush 微任务；汇总也放进来，保证跑完才出结论。
(async function runE() {
console.log('\n=========== E. 按钮注入与点击（落点 / 复制 / 无货号）===========');
{
  // CSS 这段是数组拼接的样式串，没必要抠出来 —— 用桩顶掉 ensureStyle，
  // 其余函数仍是源文件里的真实实现。
  const M2 = buildModule(
    ['isExtNode', 'textWithoutExt', 'infoCellOf', 'readOfficialCode',
     'guessFromName', 'readCode', 'hasDirectText', 'looksLikeName', 'pickNameIn',
     'imageCellOf', 'findNameEl', 'flash', 'press', 'release', 'makeButton', 'injectIntoRow',
     // 2026-10-19 二改：落点版本标记（防补涂抖动）
     'markAt', 'atKind', 'btnStillHome',
     // 2026-10-19 三改：唯一落点「名称块右下角徽标」
     'badgeHostOf', 'ensureBadgeRoom', 'placeBadge', 'lastLineRect',
     'setPxStable', 'inlineNum', 'restoreAll',
     'isCut', 'stillExpanded', 'expandEl', 'restoreEl', 'copyText', 'say', 'fallbackCopy',
     // isCut 现在会调这三个（2026-10-18 加 overflowsCell 判「撑破单元格」）
     'isBoxDisplay', 'clampOf', 'overflowsCell',
     // 2026-10-18 落点改「ID 图标右侧同行」：这两个是新增的落点辅助
     'findCopyIdIcon', 'looksLikeIcon', 'insertAfterInline',
     'isTextLabel', 'hasIconChild', 'looksLikeIdText', 'findIdTextHost',
     'iconWrapperOf', 'logInjectOnce', 'btnFollowsIcon', 'smallAfterId', 'idDiag',
     // 2026-10-19 新增：可点性复核（按钮被挤出视口 / 被盖住时换落点）
     'spotUsable', 'isOurNode', 'tryPlaceInline',
     'insertBeforeInline', 'tryPlaceBeforeInline',
     // 2026-10-18 新增的调试日志辅助函数：injectIntoRow 里会调用它们
     // 2026-10-18 新增：日志（dbg/rowBrief/clip/whyNoButton/buttonBrief）
     // 与「带 !important 写样式」的一套（backupProps/restoreProps/setImp）
     'dbg', 'emitLog', 'flushLog', 'rowBrief', 'clip', 'whyNoButton', 'buttonBrief', 'nameBrief',
     'backupProps', 'restoreProps', 'setImp', 'chainDeclsFor', 'ensureNoOverlap'],
    ['EXT_MARKS', 'NAME_MAX_SCAN', 'NOT_NAME', 'ONLY_NUM', 'HINT_TEXT', 'BTN_CLASS',
     'MARK', 'MARK_ORIG', 'MARK_CHAIN', 'MARK_CHAINED',
     'NAME_DECLS', 'CHAIN_DECLS', 'ROW_DECLS', 'CHAIN_MAX', 'CHAIN_STOP',
     'MARK_ROW', 'WHERE_MARK', 'LOG_PREFIX', 'ATTR_AT', 'PLACE_VER',
     'MARK_HOST', 'MARK_HOST_ORIG', 'MARK_PAD', 'MARK_PAD_ED', 'MARK_NAME_WH',
     'BADGE_FALLBACK_W', 'BADGE_FALLBACK_H', 'BADGE_INSET', 'BADGE_DROP',
     'BADGE_PAD_BOTTOM', 'BADGE_TOL', 'PAD_VER',
     // dbg 的去重缓冲（源码里是模块级 var，抠函数时必须一起带上）
     'logPending', 'logTimer', 'LOG_MERGE_MS'],
    SHARED + '\nvar ensureStyle = function () {};'
  );

  // E1. 徽标落点：按钮挂进商品信息单元格、脱离文档流
  //
  // 【2026-10-19 三改：只剩一个落点】
  //   前三版靠「插到哪个兄弟节点前后」定位，位置由平台排版说了算 ⇒ 会走位。
  //   现在按钮 absolute，坐标只由「名称块右下角」算出来，父节点恒为商品信息单元格
  //   —— 一句话就能验完：父级是 TD、带 is-badge、标记是 v8:badge。
  {
    const { tr, nameEl } = buildRow({ ourButton: false });
    const cell = nameEl.parentElement;          // buildRow 里名称直接在 td 里
    const before = cell.childNodes.length;
    eq('注入返回 true', M2.injectIntoRow(tr), true);
    eq('商品信息单元格里多了一枚按钮', cell.childNodes.length, before + 1);
    const btn = tr.querySelector('button');
    ok('按钮文案为「货号」', btn && btn.textContent === '货号');
    ok('按钮带结构标记 data-dyc-ct-btn', btn && btn.getAttribute('data-dyc-ct-btn') === '1');
    ok('按钮挂进商品信息单元格（定位容器）', btn && btn.parentElement === cell,
       btn ? '实际父级 ' + btn.parentElement.tagName : '按钮没插进去');
    ok('带 is-badge（绝对定位，不参与平台布局）', btn && btn.classList.contains('is-badge'));
    ok('  └ 不带 is-inline（不再插进行内流）',
       btn && btn.classList.contains('is-inline') === false);
    eq('落点标记 = v8:badge', String(btn.getAttribute('data-dyc-ct-at')), 'v8:badge');
    ok('定位容器被设成 relative（徽标的包含块）',
       cell.style.getPropertyValue('position') === 'relative',
       cell.style.getPropertyValue('position'));
    eq('重复注入会被幂等挡住', M2.injectIntoRow(tr), false);
  }

  // E2. 按钮**不进名称容器、不进 ID 行** —— 不在任何一行里，所以不会把行撑高
  //
  // 【用户原话】「你放错元素框框了，导致为了这个按钮，新增了一行」——
  //   上一版挂到 <td> 末尾（块级）会撑高行。现在绝对定位，压根不占位。
  {
    const name = new FakeEl('p', { class: 'productName-x' }, [new FakeText(NAME_TEXT)]);
    const right = new FakeEl('div', {}, [name]);
    const cell = new FakeEl('td', {}, [new FakeEl('img', {}, []), right]);
    const tr = new FakeEl('tr', {}, [new FakeEl('td', {}, [new FakeText('1')]), cell,
      new FakeEl('td', {}, [new FakeText('340')]), new FakeEl('td', {}, []),
      new FakeEl('td', {}, []), new FakeEl('td', {}, [])]);
    tr.size = { clientWidth: 1507, clientHeight: 88 };
    eq('注入返回 true', M2.injectIntoRow(tr), true);
    const btn = tr.querySelector('button');
    ok('父节点是单元格，不是名称容器（不参与那一列的 flex 布局）',
       !!btn && btn.parentElement === cell,
       btn ? '实际父级 ' + btn.parentElement.tagName : '按钮没插进去');
    ok('名称容器里没有多出节点', right.children.length === 1, '实际 ' + right.children.length + ' 个');
    ok('名称容器里没有按钮', right.querySelectorAll('button').length === 0);
  }

  // E2b. 单元格里有「复制商品 ID」图标也不影响落点 —— 按钮不再跟着图标走
  //
  // 【为什么这条重要】上一版把落点锚在图标上，ID 数字一变长按钮就跟着右移，
  //   最后被挤出视口（真机 @1887 / 视口 1707）。现在图标在哪儿都跟按钮无关。
  {
    const name = new FakeEl('p', { class: 'productName-x' }, [new FakeText(NAME_TEXT)]);
    const idText = new FakeEl('span', {}, [new FakeText('ID 38471532854022570319')]);
    const icon = new FakeEl('span', { title: '复制商品ID' }, [new FakeEl('svg', {}, [])]);
    icon.size = { clientWidth: 14, clientHeight: 14 };
    const idLine = new FakeEl('div', {}, [idText, icon]);
    const right = new FakeEl('div', {}, [name, idLine]);
    const cell = new FakeEl('td', {}, [new FakeEl('img', {}, []), right]);
    const tr = new FakeEl('tr', {}, [new FakeEl('td', {}, [new FakeText('1')]), cell,
      new FakeEl('td', {}, [new FakeText('340')]), new FakeEl('td', {}, []),
      new FakeEl('td', {}, []), new FakeEl('td', {}, [])]);
    tr.size = { clientWidth: 1507, clientHeight: 88 };
    eq('注入返回 true', M2.injectIntoRow(tr), true);
    const btn = tr.querySelector('button');
    ok('按钮不插进 ID 行（图标旁的索引里没有它）',
       !!btn && idLine.children.indexOf(btn) === -1,
       btn ? '索引 ' + idLine.children.indexOf(btn) : '按钮没插进去');
    ok('ID 行元素数没变', idLine.children.length === 2, '实际 ' + idLine.children.length + ' 个');
    ok('  └ 落点标记仍是 v8:badge', String(btn.getAttribute('data-dyc-ct-at')) === 'v8:badge');
  }

console.log('\n=========== F. 名称展开必须压得住平台（!important + 祖先链）===========');
{
  // 真机证据：旧版日志写着「已折行」、按钮量出来 56×20，但截图上名称还是单行省略号、
  // 按钮一个都看不见。原因是 ① 内联声明没有 !important，抢不过平台带 !important 的
  // 截断规则；② 钳制在祖先层。这一组用例把这两条钉住。
  const { tr, nameEl } = buildRow({ ourButton: false });
  nameEl._sizes = { clientWidth: 120, clientHeight: 18, scrollWidth: 240, scrollHeight: 18,
                    whiteSpace: 'nowrap', lineClamp: '1', display: '-webkit-box' };
  const wrapEl = nameEl.parentElement;      // td 里再包一层？这里直接用 td 当祖先
  wrapEl._sizes = { display: 'block', overflow: 'hidden', overflowY: 'hidden' };

  M2.expandEl(nameEl);

  // ① 名称自己：必须带 important
  for (const [p, v] of [['display', 'block'], ['-webkit-line-clamp', 'unset'],
                        ['white-space', 'normal'], ['height', 'auto'], ['overflow', 'visible']]) {
    ok('名称 ' + p + ' = ' + v + ' (important)',
       nameEl.style.getPropertyValue(p) === v &&
       nameEl.style.getPropertyPriority(p) === 'important',
       nameEl.style.getPropertyValue(p) + '/' + (nameEl.style.getPropertyPriority(p) || '无'));
  }
  eq('名称 word-break 用 normal（款号不腰斩）', nameEl.style.getPropertyValue('word-break'), 'normal');
  eq('名称 overflow-wrap 放行断行', nameEl.style.getPropertyValue('overflow-wrap'), 'break-word');

  // ② 祖先链：钳制类三条也要被写！
  ok('祖先层 -webkit-line-clamp 被放开',
     wrapEl.style.getPropertyValue('-webkit-line-clamp') === 'unset',
     wrapEl.style.getPropertyValue('-webkit-line-clamp'));
  ok('祖先层 overflow 被放开', wrapEl.style.getPropertyValue('overflow') === 'visible',
     wrapEl.style.getPropertyValue('overflow'));
  ok('祖先层 max-height 被放开', wrapEl.style.getPropertyValue('max-height') === 'none',
     wrapEl.style.getPropertyValue('max-height'));
  ok('祖先层**不动** width（动了列宽会崩）',
     wrapEl.style.getPropertyValue('width') === '', wrapEl.style.getPropertyValue('width'));
  ok('祖先层**不动** display（动了布局会崩）',
     wrapEl.style.getPropertyValue('display') === '', wrapEl.style.getPropertyValue('display'));

  // ②b 横向约束（商品卡列表真机：名称不折行、直接顶进右列）
  ok('名称 min-width:0（flex 子项默认 min-width:auto ⇒ 永不换行）',
     nameEl.style.getPropertyValue('min-width') === '0',
     nameEl.style.getPropertyValue('min-width'));
  ok('名称 max-width:100%（不给上限就会一路往右长）',
     nameEl.style.getPropertyValue('max-width') === '100%',
     nameEl.style.getPropertyValue('max-width'));
  ok('祖先层也加 min-width:0', wrapEl.style.getPropertyValue('min-width') === '0',
     wrapEl.style.getPropertyValue('min-width'));
  ok('祖先层也加 max-width:100%', wrapEl.style.getPropertyValue('max-width') === '100%',
     wrapEl.style.getPropertyValue('max-width'));
  ok('**没有**去改 width（改列宽会崩版）', wrapEl.style.getPropertyValue('width') === '',
     wrapEl.style.getPropertyValue('width'));

  // ②c 撑破单元格的判据：自身 scrollWidth 干净（溢出=0），但比 <td> 还宽
  {
    const name = new FakeEl('p', { class: 'productName-w' }, [new FakeText(NAME_TEXT)]);
    const cell = new FakeEl('td', {}, [name]);
    const tr = new FakeEl('tr', {}, [new FakeEl('td', {}, [new FakeText('1')]), cell]);
    name.parentElement = cell; cell.parentElement = tr;
    // 元素 600 宽、单元格 300 宽 —— 自身不溢出，但撑破了单元格
    name._sizes = { clientWidth: 600, clientHeight: 16, scrollWidth: 600, scrollHeight: 16 };
    cell._sizes = { clientWidth: 300, clientHeight: 60, scrollWidth: 300, scrollHeight: 60 };
    ok('撑破单元格能被判出来', M2.overflowsCell(name) === true);
    ok('  └ isCut 也认这一种（否则永远不触发展开）', M2.isCut(name) === true);
    // 反过来：装得下就不该误判
    name._sizes = { clientWidth: 280, clientHeight: 16, scrollWidth: 280, scrollHeight: 16 };
    ok('装得下时不误判', M2.overflowsCell(name) === false);
  }

  // ③ 抗拉伸三件套（真机「高=16/32」的治本几条）
  ok('名称 align-self=flex-start（父容器 stretch 才不会把高度压回一行）',
     nameEl.style.getPropertyValue('align-self') === 'flex-start',
     nameEl.style.getPropertyValue('align-self'));
  ok('名称 flex-shrink=0（不被压扁）',
     nameEl.style.getPropertyValue('flex-shrink') === '0',
     nameEl.style.getPropertyValue('flex-shrink'));
  ok('祖先层也放开 height:auto（不放它，盒子一定不长高）',
     wrapEl.style.getPropertyValue('height') === 'auto',
     wrapEl.style.getPropertyValue('height'));

  // ④ 重叠保险：盒子没长开时必须把 overflow 收回 hidden（宁可省略号，不要压字）
  {
    const box = new FakeEl('p', { class: 'productName-y' }, [new FakeText(NAME_TEXT)]);
    const host = new FakeEl('div', {}, [box]);
    // 造「内容 32 / 盒子 16」且**锁高也撑不开**的形态：scrollHeight 永远是 32
    box._sizes = { clientWidth: 120, clientHeight: 16, scrollWidth: 120, scrollHeight: 32,
                   whiteSpace: 'normal', lineClamp: 'unset', display: 'block' };
    Object.defineProperty(box, 'scrollHeight', { get: () => 32 });
    Object.defineProperty(box, 'clientHeight', {
      get: () => (box.style.getPropertyValue('height') === '32px' ? 32 : 16)
    });
    M2.expandEl(box);
    // 第一招（锁内容高度）在垫片里能生效 ⇒ 走 'lock'，盒子真的长开了
    ok('撑高第一招把盒子锁到内容高度', box.style.getPropertyValue('height') === '32px',
       box.style.getPropertyValue('height'));
    ok('长开后不再收回 overflow', box.style.getPropertyValue('overflow') === 'visible',
       box.style.getPropertyValue('overflow'));
  }

  // ③ 关开关必须还原干净
  M2.restoreEl(nameEl);
  eq('还原后名称 white-space 清空', nameEl.style.getPropertyValue('white-space'), '');
  eq('还原后名称 line-clamp 清空', nameEl.style.getPropertyValue('-webkit-line-clamp'), '');
  eq('还原后祖先 overflow 清空', wrapEl.style.getPropertyValue('overflow'), '');
  eq('还原后名称标记被摘掉', nameEl.getAttribute('data-dyc-ct-expand'), null);
}

  // E2c. 真机第六轮：绝不能把「ID」这个**文字标签**当锚点
  //
  // 【用户截图】`ID [货号] 38471532854022570319 📋` —— 按钮插到了「ID」和数字中间。
  //   原因是上一版判据③「文本恰为 ID 的小元素」在罗盘这页命中的是**文字标签本身**。
  //   正确锚点是**数字后面那个复制图标**。
  {
    const name = new FakeEl('p', { class: 'productName-x' }, [new FakeText(NAME_TEXT)]);
    const idLabel = new FakeEl('span', {}, [new FakeText('ID')]);        // ⚠️ 文字标签，不是按钮
    idLabel.size = { clientWidth: 16, clientHeight: 16 };
    const idNum = new FakeEl('span', {}, [new FakeText('38471532854022570319')]);
    const icon = new FakeEl('span', { title: '复制' }, [new FakeEl('svg', {}, [])]);
    icon.size = { clientWidth: 14, clientHeight: 14 };
    const idLine = new FakeEl('div', {}, [idLabel, idNum, icon]);
    const right = new FakeEl('div', {}, [name, idLine]);
    const cell = new FakeEl('td', {}, [new FakeEl('img', {}, []), right]);
    const tr = new FakeEl('tr', {}, [new FakeEl('td', {}, [new FakeText('1')]), cell,
      new FakeEl('td', {}, [new FakeText('340')]), new FakeEl('td', {}, []),
      new FakeEl('td', {}, []), new FakeEl('td', {}, [])]);
    tr.size = { clientWidth: 1507, clientHeight: 88 };
    eq('注入返回 true', M2.injectIntoRow(tr), true);
    const btn = tr.querySelector('button');
    ok('按钮**没有**插进 ID 行（既不在「ID」标签后，也不在图标后）',
       !!btn && idLine.children.indexOf(btn) === -1,
       btn ? '实际位置索引 ' + idLine.children.indexOf(btn) : '按钮没插进去');
    ok('「ID」纯文字标签被判为非图标', M2.isTextLabel(idLabel) === true);
    ok('复制图标（含 svg）不被判为纯文字', M2.isTextLabel(icon) === false);
    ok('ID 数字文本能被识别出来', M2.looksLikeIdText('38471532854022570319') === true);
    ok('「ID」二字本身不算 ID 文本', M2.looksLikeIdText('ID') === false);
  }

  // E2d. 页面上已有「上一版留下的」按钮（无 v4 标记）⇒ 必须重放一次
  //
  // 第六轮真机：旧按钮插在「ID」和数字中间，修好判据后它不会自己挪，
  // 用户不刷新就看不到修复。所以「标记版本不对 ⇒ 重放一次」必须留着。
  {
    const name = new FakeEl('p', { class: 'productName-x' }, [new FakeText(NAME_TEXT)]);
    const idLabel = new FakeEl('span', {}, [new FakeText('ID')]);
    idLabel.size = { clientWidth: 16, clientHeight: 16 };
    const idNum = new FakeEl('span', {}, [new FakeText('38471532854022570319')]);
    const icon = new FakeEl('span', { title: '复制' }, [new FakeEl('svg', {}, [])]);
    icon.size = { clientWidth: 14, clientHeight: 14 };
    // 故意先把按钮塞在「ID」标签后面（模拟上一版留下的错位置）
    const oldBtn = new FakeEl('button', { 'data-dyc-ct-btn': '1', class: 'dyc-ct-btn is-inline' },
      [new FakeText('货号')]);
    oldBtn.size = { clientWidth: 56, clientHeight: 20 };
    const idLine = new FakeEl('div', {}, [idLabel, oldBtn, idNum, icon]);
    const right = new FakeEl('div', {}, [name, idLine]);
    const cell = new FakeEl('td', {}, [new FakeEl('img', {}, []), right]);
    const tr = new FakeEl('tr', {}, [new FakeEl('td', {}, [new FakeText('1')]), cell,
      new FakeEl('td', {}, [new FakeText('340')]), new FakeEl('td', {}, []),
      new FakeEl('td', {}, []), new FakeEl('td', {}, [])]);
    tr.size = { clientWidth: 1507, clientHeight: 88 };

    eq('旧按钮没有当前落点标记', M2.atKind(oldBtn), '');
    eq('注入返回 true（重放了一次）', M2.injectIntoRow(tr), true);
    ok('旧按钮已被摘掉', oldBtn.isConnected === false);
    const btn = tr.querySelector('button');
    ok('新按钮直接挂在单元格里', !!btn && btn.parentElement === cell,
       btn ? '父级 ' + btn.parentElement.tagName : '');
    ok('  └ 带 v8:badge 标记', String(btn.getAttribute('data-dyc-ct-at')) === 'v8:badge');
    ok('页面上仍只有一枚按钮', tr.querySelectorAll('button').length === 1,
       '实际 ' + tr.querySelectorAll('button').length + ' 枚');
  }

  // E2e. 图标是「空元素」（图标字体 / 背景图）时也必须能找到它
  //
  // 【真机现象 2026-10-19】按钮掉到了「名称右侧」那一行，而不是 ID 行 ——
  //   说明 findCopyIdIcon 没认出复制图标。最可能的原因：那个图标是
  //   `<i class="iconfont icon-copy"></i>`（内部为空，图标由 ::before 画），
  //   而旧版 isTextLabel 把**空元素**判成了「纯文字标签」直接跳过。
  {
    const name = new FakeEl('p', { class: 'productName-x' }, [new FakeText(NAME_TEXT)]);
    const idLabel = new FakeEl('span', {}, [new FakeText('ID')]);
    const idNum = new FakeEl('span', {}, [new FakeText('38471532854022570319')]);
    const fontIcon = new FakeEl('i', { class: 'iconfont icon-copy' }, []);   // ⚠️ 内部为空
    fontIcon.size = { clientWidth: 14, clientHeight: 14 };
    const idLine = new FakeEl('div', {}, [idLabel, idNum, fontIcon]);
    const right = new FakeEl('div', {}, [name, idLine]);
    const cell = new FakeEl('td', {}, [new FakeEl('img', {}, []), right]);
    const tr = new FakeEl('tr', {}, [new FakeEl('td', {}, [new FakeText('1')]), cell,
      new FakeEl('td', {}, [new FakeText('340')]), new FakeEl('td', {}, []),
      new FakeEl('td', {}, []), new FakeEl('td', {}, [])]);
    tr.size = { clientWidth: 1507, clientHeight: 88 };

    ok('空元素不再被判成「文字标签」', M2.isTextLabel(fontIcon) === false);
    ok('能认出这个图标字体元素', M2.findCopyIdIcon(cell, name) === fontIcon,
       String(M2.findCopyIdIcon(cell, name) && M2.findCopyIdIcon(cell, name).tagName));
    eq('注入返回 true', M2.injectIntoRow(tr), true);
    const btn = tr.querySelector('button');
    ok('按钮挂在单元格里（图标字体认不认得出都不影响落点）',
       !!btn && btn.parentElement === cell,
       btn ? '实际父级 ' + btn.parentElement.tagName : '按钮没插进去');
    ok('  └ 没有插进 ID 行', !!btn && idLine.children.indexOf(btn) === -1);
  }

  // E2f. 图标完全无法识别（连空兄弟都没有）⇒ 保持兜底落点，不来回抖
  {
    const name = new FakeEl('p', { class: 'productName-x' }, [new FakeText(NAME_TEXT)]);
    const right = new FakeEl('div', {}, [name]);
    const cell = new FakeEl('td', {}, [new FakeEl('img', {}, []), right]);
    const tr = new FakeEl('tr', {}, [new FakeEl('td', {}, [new FakeText('1')]), cell,
      new FakeEl('td', {}, [new FakeText('340')]), new FakeEl('td', {}, []),
      new FakeEl('td', {}, []), new FakeEl('td', {}, [])]);
    tr.size = { clientWidth: 1507, clientHeight: 88 };
    eq('第一次注入成功', M2.injectIntoRow(tr), true);
    const btn = tr.querySelector('button');
    ok('按钮挂在单元格里（落点唯一，没有兜底档）', !!btn && btn.parentElement === cell);
    eq('第二次注入被幂等挡住（不来回抖）', M2.injectIntoRow(tr), false);
    ok('仍然只有一枚按钮', tr.querySelectorAll('button').length === 1);
  }

  // E2g. 坐标永远被夹在容器内（2026-10-19 三改）
  //
  // 【真机证据】上一版日志 `按钮 56×20 @1887,418`，而视口只有 1707 宽 ——
  //   按钮被挤出右边界，用户点不到。现在坐标是算出来并且**夹紧**在容器内的，
  //   不可能跑到容器外面（也就不会跑出视口右边界）。
  {
    const name = new FakeEl('p', {}, [new FakeText(NAME_TEXT)]);
    const right = new FakeEl('div', {}, [name]);
    const cell = new FakeEl('td', {}, [new FakeEl('img', {}, []), right]);
    const tr = new FakeEl('tr', {}, [new FakeEl('td', {}, [new FakeText('1')]), cell,
      new FakeEl('td', {}, [new FakeText('340')]), new FakeEl('td', {}, []),
      new FakeEl('td', {}, []), new FakeEl('td', {}, [])]);
    tr.size = { clientWidth: 1507, clientHeight: 88 };
    // 名字块比单元格还靠右（模拟「名字被推到最右边」的异常布局）
    cell._sizes = { clientWidth: 200, clientHeight: 88 };
    name._sizes = { clientWidth: 400, clientHeight: 40 };
    global.__rectHook = (el) => {
      if (el === name) return { left: 100, top: 10, width: 400, height: 40, right: 500, bottom: 50 };
      if (el === cell) return { left: 100, top: 0, width: 200, height: 88, right: 300, bottom: 88 };
      return null;
    };
    try {
      eq('注入成功', M2.injectIntoRow(tr), true);
      const btn = tr.querySelector('button');
      const left = parseFloat(btn.style.getPropertyValue('left'));
      const top = parseFloat(btn.style.getPropertyValue('top'));
      ok('left 被夹在容器内（不会跑到容器右边）', left <= 200 - 56 - 4 + 0.5, 'left=' + left);
      ok('left 不为负', left >= 4 - 0.5, 'left=' + left);
      ok('top 被夹在容器内', top <= 88 - 24 + 0.5 && top >= 0, 'top=' + top);
      ok('  └ 带 is-badge', btn.classList.contains('is-badge'));
    } finally {
      global.__rectHook = null;
    }
  }

  // E2h. 平台蒙层盖住那块区域也照样放（绝对定位 + z-index:3）
  //
  // 【为什么不再「换落点」】上一版用 elementFromPoint 判遮挡，单点误报把
  //   四个落点全判死，一路退化到「单元格末尾」（用户截图那个位置）。
  //   现在按钮浮在最上层，遮挡是伪问题 —— 位置不因遮挡而改变。
  {
    const name = new FakeEl('p', { class: 'productName-x' }, [new FakeText(NAME_TEXT)]);
    const icon = new FakeEl('span', { title: '复制' }, [new FakeEl('svg', {}, [])]);
    icon.size = { clientWidth: 14, clientHeight: 14 };
    const idLine = new FakeEl('div', {}, [name, icon]);
    const cell = new FakeEl('td', {}, [new FakeEl('img', {}, []), idLine]);
    const tr = new FakeEl('tr', {}, [new FakeEl('td', {}, [new FakeText('1')]), cell,
      new FakeEl('td', {}, [new FakeText('340')]), new FakeEl('td', {}, []),
      new FakeEl('td', {}, []), new FakeEl('td', {}, [])]);
    tr.size = { clientWidth: 1507, clientHeight: 88 };
    const mask = new FakeEl('div', { class: 'platform-mask' }, []);
    global.document.elementFromPoint = () => mask;
    try {
      eq('注入仍然成功', M2.injectIntoRow(tr), true);
      const btn = tr.querySelector('button');
      ok('按钮仍然挂在单元格里（不因遮挡换落点）', !!btn && btn.parentElement === cell);
      ok('  └ 标记仍是 v8:badge', String(btn.getAttribute('data-dyc-ct-at')) === 'v8:badge');
    } finally {
      global.document.elementFromPoint = () => null;
    }
  }

  // E2i. pointerdown 也能触发复制（平台在捕获阶段吃掉 click 时的兜底）
  {
    const { tr, nameEl } = buildRow({ ourButton: false });
    M2.injectIntoRow(tr);
    const btn = tr.querySelector('button');
    global.lastCopied = null;
    global.toastCalls = [];
    // 只发 pointerdown（不发 click），模拟「click 被平台在捕获阶段吃掉」
    btn.fire('pointerdown');
    ok('pointerdown 也触发了复制', global.lastCopied === 'NE1C1091W', String(global.lastCopied));
    // 消息条在 clipboard 的 Promise 回调里 ⇒ 先冲一遍微任务
    await new Promise((r) => setTimeout(r, 0));
    ok('并弹了消息', global.toastCalls.length === 1,
       '实际 ' + global.toastCalls.length + ' 条');

    // 紧接着同一轮里再来一次 click（真机上两个事件都会来）⇒ 必须被去重，不能复制两遍
    global.toastCalls = [];
    btn.fire('click');
    await new Promise((r) => setTimeout(r, 0));
    eq('同一次点击的第二条事件被去重', global.toastCalls.length, 0);
  }

  // E2j. 点击反馈：成功 = 实心蓝底白字（.is-ok），失败 = 灰底（.is-err）
  //
  // 【用户 2026-10-19】「按钮点击没有小黄车那种反馈，比如已复制之类的，
  //   而且颜色相比淡很多不够明显」—— 旧实现只换文字、配色不动，等于没反馈。
  {
    const { tr, nameEl } = buildRow({ ourButton: false });
    M2.injectIntoRow(tr);
    const btn = tr.querySelector('button');
    ok('初始不带成功态', btn.classList.contains('is-ok') === false);
    ok('初始不带失败态', btn.classList.contains('is-err') === false);

    // 成功路径
    global.lastCopied = null;
    btn.fire('click');
    await new Promise((r) => setTimeout(r, 0));
    eq('文案变「已复制」', btn.textContent, '已复制');
    ok('带成功态 is-ok（实心蓝底白字）', btn.classList.contains('is-ok') === true);
    ok('  └ 不残留失败态', btn.classList.contains('is-err') === false);

    // 失败路径（取不到货号）
    const btn2 = M2.makeButton(tr, nameEl);
    M2.flash(btn2, '无货号', true);
    eq('失败文案', btn2.textContent, '无货号');
    ok('带失败态 is-err', btn2.classList.contains('is-err') === true);
    ok('  └ 不残留成功态', btn2.classList.contains('is-ok') === false);

    // 反馈期间补涂不能打断它（否则「已复制」会被新按钮覆盖回「货号」）
    ok('反馈期间打了标记', btn.__dycFlashing === true);
    eq('反馈期间补涂被挡住（不摘不重插）', M2.injectIntoRow(tr), false);
    eq('文案仍是「已复制」', btn.textContent, '已复制');
  }

  // E2k. 稳态补涂**不许抖**（2026-10-19 二改的核心）
  //
  // 【真机证据】诊断报告里稳态反复出现 `扫描完成：候选行 10 · 本轮插入 8`
  //   （稳态本该是 0）⇒ 每 300ms 有一批按钮被摘掉重插。
  //   旧判据是「按钮在不在 + 落点对不对（能不能找到图标 → 摘掉重插）」，
  //   而「找不到图标 / 图标被盖住」的行每轮都会判「落点不对」→ 摘 → 重插 → 又不行。
  //   ⇒ 现在按钮自己记 `v3:落点类型`，位置没跑就不再动。
  {
    const name = new FakeEl('p', { class: 'productName-x' }, [new FakeText(NAME_TEXT)]);
    const idNum = new FakeEl('span', {}, [new FakeText('ID 38471532854022570319')]);
    const icon = new FakeEl('span', { title: '复制' }, [new FakeEl('svg', {}, [])]);
    icon.size = { clientWidth: 14, clientHeight: 14 };
    const idLine = new FakeEl('div', {}, [idNum, icon]);
    const right = new FakeEl('div', {}, [name, idLine]);
    const cell = new FakeEl('td', {}, [new FakeEl('img', {}, []), right]);
    const tr = new FakeEl('tr', {}, [new FakeEl('td', {}, [new FakeText('1')]), cell,
      new FakeEl('td', {}, [new FakeText('340')]), new FakeEl('td', {}, []),
      new FakeEl('td', {}, []), new FakeEl('td', {}, [])]);
    tr.size = { clientWidth: 1507, clientHeight: 88 };

    eq('第一次注入成功', M2.injectIntoRow(tr), true);
    const btn1 = tr.querySelector('button');
    ok('按钮带落点版本标记（data-dyc-ct-at = v8:badge）',
       String(btn1.getAttribute('data-dyc-ct-at')) === 'v8:badge',
       String(btn1.getAttribute('data-dyc-ct-at')));

    // 连跑 5 轮补涂：一次都不许摘插，按钮必须是同一枚
    let churn = 0, sameBtn = true;
    for (let i = 0; i < 5; i++) {
      if (M2.injectIntoRow(tr)) churn++;
      if (tr.querySelector('button') !== btn1) sameBtn = false;
    }
    eq('稳态补涂 5 轮：一次都没有摘插（旧版这里是 5 次）', churn, 0);
    ok('  └ 按钮始终是同一枚（没有被重建）', sameBtn);
    ok('  └ 行里仍然只有一枚按钮', tr.querySelectorAll('button').length === 1);
  }

  // E2k2. 名字块宽度变了 ⇒ 只挪坐标、**不换按钮**（2026-10-19 三改）
  //
  // 折行变化 / 窗口缩放都会让名字块变宽变高，坐标必须跟着重算；
  // 但绝不能因此摘掉重插 —— 那又会把「已复制」反馈打断。
  {
    const name = new FakeEl('p', { class: 'productName-x' }, [new FakeText(NAME_TEXT)]);
    name._sizes = { clientWidth: 200, clientHeight: 40 };
    const right = new FakeEl('div', {}, [name]);
    const cell = new FakeEl('td', {}, [new FakeEl('img', {}, []), right]);
    cell._sizes = { clientWidth: 320, clientHeight: 88 };
    const tr = new FakeEl('tr', {}, [new FakeEl('td', {}, [new FakeText('1')]), cell,
      new FakeEl('td', {}, [new FakeText('340')]), new FakeEl('td', {}, []),
      new FakeEl('td', {}, []), new FakeEl('td', {}, [])]);
    tr.size = { clientWidth: 1507, clientHeight: 88 };

    eq('第一次注入成功', M2.injectIntoRow(tr), true);
    const btn1 = tr.querySelector('button');
    const l1 = parseFloat(btn1.style.getPropertyValue('left'));
    // 第五轮起不再「骑出」单元格：纵向已错开，横向不必再抢位
    ok('初始坐标按名字块宽度算出来（右边界 − 48 − 4）',
       l1 === 200 - 56 - 4, 'left=' + l1);

    name._sizes = { clientWidth: 300, clientHeight: 60 };   // 名字变宽
    eq('坐标变化不触发重放', M2.injectIntoRow(tr), false);
    ok('  └ 还是同一枚按钮（没有重建）', tr.querySelector('button') === btn1);
    const l2 = parseFloat(btn1.style.getPropertyValue('left'));
    ok('  └ 坐标跟着名字块重算', l2 === 300 - 56 - 4, 'left=' + l1 + ' → ' + l2);
  }

  // E2l. 按下瞬间就锁 + 立刻变深色（治「反应迟钝」与「反馈有时没有」）
  //
  // 【真机证据】日志里 `按钮被点击（pointerdown）` 之后**没有下文**，
  //   因为旧版 `__dycFlashing` 只在复制回调里才置位 —— 「按下 → 回调」这段
  //   几十~几百毫秒内，补涂完全可以把按钮摘掉重插，回调用的是**已经脱离文档**
  //   的那一枚，用户什么都看不到。
  {
    const { tr } = buildRow({ ourButton: false });
    M2.injectIntoRow(tr);
    const btn = tr.querySelector('button');
    global.lastCopied = null;
    btn.fire('pointerdown');            // 同步返回：此刻就该是「按下」态
    ok('按下即锁（补涂不许动它）', btn.__dycFlashing === true);
    ok('按下即变深色（is-press）', btn.classList.contains('is-press') === true);
    eq('按下瞬间补涂被挡住', M2.injectIntoRow(tr), false);
    ok('  └ 按钮仍在页面上', btn.isConnected === true);
    ok('  └ 没有残留成功/失败态',
       btn.classList.contains('is-ok') === false && btn.classList.contains('is-err') === false);

    await new Promise((r) => setTimeout(r, 0));      // 等 clipboard 的 Promise 落地
    eq('回调到了：文案「已复制」', btn.textContent, '已复制');
    ok('  └ 带 is-ok', btn.classList.contains('is-ok') === true);
    ok('  └ 按下态已撤掉', btn.classList.contains('is-press') === false);

    // 收尾（不真等 1.5 秒）：release 必须把三类状态一起清干净、并解锁
    M2.release(btn);
    eq('release 后文案回到「货号」', btn.textContent, '货号');
    ok('  └ 三类状态全部清掉',
       !btn.classList.contains('is-press') && !btn.classList.contains('is-ok') &&
       !btn.classList.contains('is-err'));
    ok('  └ 已解锁，补涂可以接管', btn.__dycFlashing === false);
  }

  // E2l2. 平台把按钮整个换掉时，反馈要写到**用户看得见的那一枚**上
  //
  // 【为什么要这一条】「有时有反馈、有时没有」还有一个成因：平台整块重建商品行
  //   时会连我们的按钮一起换掉，旧引用 `isConnected` 变 false。若回调仍写旧引用，
  //   「已复制」就写在一枚没人看得见的节点上，页面上那枚新按钮永远是「货号」。
  //   ⇒ 回调里发现旧引用掉了，按行重找一枚再写。
  {
    const { tr } = buildRow({ ourButton: false });
    M2.injectIntoRow(tr);
    const oldBtn = tr.querySelector('button');
    global.lastCopied = null;
    oldBtn.fire('click');                     // 按下（此时 oldBtn 被锁住）
    // 「平台重渲染」：把旧按钮整枚摘掉，再让补涂重建一枚
    oldBtn.remove();
    M2.injectIntoRow(tr);
    const newBtn = tr.querySelector('button');
    ok('平台重渲染后确实换了一枚新按钮', newBtn && newBtn !== oldBtn);
    ok('  └ 旧引用已脱离文档', oldBtn.isConnected === false);

    await new Promise((r) => setTimeout(r, 0));      // 等剪贴板回调
    eq('反馈写到了新按钮上', newBtn.textContent, '已复制');
    ok('  └ 新按钮带 is-ok', newBtn.classList.contains('is-ok') === true);
    eq('  └ 旧按钮保持原样（没人看得到它）', oldBtn.textContent, '货号');
  }

  // E2m. 上一版留下的旧按钮（没有落点标记）会被重放**一次**，之后稳定
  //
  // 第六轮真机：按钮插在「ID」和数字中间，修好判据后页面上那枚旧按钮不会自己挪，
  // 用户不刷新就看不到修复。所以「无标记 ⇒ 重放一次」这条必须留着；
  // 但只能是一次，否则又回到每 300ms 抖一次。
  {
    const { tr, nameEl } = buildRow({ ourButton: false });
    const stale = M2.makeButton(tr, nameEl);
    nameEl.parentElement.appendChild(stale);         // 上一版的位置（名称之后，无标记）
    ok('造出来的旧按钮确实没有落点标记', stale.getAttribute('data-dyc-ct-at') === null);
    eq('旧按钮会被重放一次', M2.injectIntoRow(tr), true);
    const btn = tr.querySelector('button');
    ok('  └ 新按钮带 v8:badge 标记',
       btn !== stale && String(btn.getAttribute('data-dyc-ct-at')) === 'v8:badge',
       String(btn.getAttribute('data-dyc-ct-at')));
    ok('  └ 旧按钮已被摘掉', stale.isConnected === false);
    eq('  └ 第二轮开始稳定', M2.injectIntoRow(tr), false);
  }

  // E2n. 可点性复核：遮挡判定改「五点采样」（2026-10-19 二改）
  //
  // 旧版只看中心点，于是真机出现过「四个落点全被判『被 DIV 盖住』」，
  // 一路退化到「名称后·末选兜底」。按钮只有 20px 高，中心点压在 1px 分隔线上
  // 就会整枚判废 —— 单点太脆。
  {
    const wrap = new FakeEl('div', {}, []);
    const el = new FakeEl('button', { class: 'dyc-ct-btn' }, []);
    el.size = { clientWidth: 56, clientHeight: 20 };   // 垫片矩形：left/top=0，56×20
    wrap.appendChild(el);
    try {
      // 只有最左边一个采样点被盖（1/5）
      global.document.elementFromPoint = (x) =>
        (x <= 22 ? new FakeEl('div', {}, []) : el);
      eq('只有边缘 1 个点被盖 ⇒ 放行', M2.spotUsable(el), '');
      global.document.elementFromPoint = () => new FakeEl('div', {}, []);
      ok('整块被蒙层盖住 ⇒ 拦下', /盖住/.test(M2.spotUsable(el)), M2.spotUsable(el));
      global.document.elementFromPoint = () => wrap;     // 命中的是**祖先**
      eq('命中祖先不算遮挡（老内核误报） ⇒ 放行', M2.spotUsable(el), '');
    } finally {
      global.document.elementFromPoint = () => null;
    }
  }

  // E2o. 名称块底部补出落位空白，按钮落在**文字正下方**（2026-10-19 五改）
  //
  // 【为什么整段换掉】前四轮都在横向上想办法（按钮 56→48、右侧预留 50→70、
  //   空缝 10→30），用户四次反馈压字。根因是横向零和：商品名占满整格宽度时，
  //   按钮只能「盖字」或「挤窄名字」。现在改成纵向错开 —— 名称块底部补 24px
  //   空白（按钮高 20 + 空档 4），按钮落到文字下方，与任何一行都不重叠。
  {
    const name = new FakeEl('p', { class: 'productName-x' }, [new FakeText(NAME_TEXT)]);
    name._sizes = { clientWidth: 200, clientHeight: 40 };
    // ⚠️ 故意把行顺序打乱：名字里夹 `<span>` 时 Range 的数组顺序不保证，
    //    实现必须按 top 找「视觉上最下面那一行」，不能取数组末尾。
    name._lines = [
      { left: 0, right: 198, top: 20, bottom: 40, width: 198, height: 20 },
      { left: 0, right: 200, top: 0, bottom: 20, width: 200, height: 20 }
    ];
    const right = new FakeEl('div', {}, [name]);
    const cell = new FakeEl('td', {}, [new FakeEl('img', {}, []), right]);
    cell._sizes = { clientWidth: 320, clientHeight: 88 };
    const tr = new FakeEl('tr', {}, [new FakeEl('td', {}, [new FakeText('1')]), cell,
      new FakeEl('td', {}, [new FakeText('340')]), new FakeEl('td', {}, []),
      new FakeEl('td', {}, []), new FakeEl('td', {}, [])]);
    tr.size = { clientWidth: 1507, clientHeight: 88 };

    eq('注入成功', M2.injectIntoRow(tr), true);
    eq('名称块底部补出落位空白（按钮高 24 + 空档 4 = 28）',
       name.style.getPropertyValue('padding-bottom'), '28px');
    ok('  └ padding 带 !important（抢得过平台规则）',
       name.style.getPropertyPriority('padding-bottom') === 'important');
    eq('  └ box-sizing 钉成 border-box（防 content-box 把盒子撑宽）',
       name.style.getPropertyValue('box-sizing'), 'border-box');
    ok('  └ 打上落位版本标记 6', name.getAttribute('data-dyc-ct-padded') === '6');
    const btn = tr.querySelector('button');
    ok('按钮顶边 = 文字底边 + 4（按 top 取最下面一行，不是数组末尾）',
       parseFloat(btn.style.getPropertyValue('top')) === 44,
       'top=' + btn.style.getPropertyValue('top'));
    ok('  └ 按钮右边界贴名字块右边界、内缩 4',
       parseFloat(btn.style.getPropertyValue('left')) === 200 - 56 - 4,
       'left=' + btn.style.getPropertyValue('left'));
  }

  // E2p. 名字只有一行也照样补空白 —— 不再「最后一行不满就不预留」（五改）
  //
  // 【为什么反过来】老版横向方案里「不满就不动」是对的：预留会挤窄名字，
  //   能省则省。纵向方案里按钮**总要有个位置**，这段空白是必需品而不是补丁，
  //   所以无条件补 —— 也顺手干掉了「折行一变就算出不同答案」的老毛病。
  {
    const name = new FakeEl('p', { class: 'productName-x' }, [new FakeText(NAME_TEXT)]);
    name._sizes = { clientWidth: 200, clientHeight: 20 };
    name._lines = [{ left: 0, right: 120, top: 0, bottom: 20, width: 120, height: 20 }];
    const right = new FakeEl('div', {}, [name]);
    const cell = new FakeEl('td', {}, [new FakeEl('img', {}, []), right]);
    cell._sizes = { clientWidth: 320, clientHeight: 88 };
    const tr = new FakeEl('tr', {}, [new FakeEl('td', {}, [new FakeText('1')]), cell,
      new FakeEl('td', {}, [new FakeText('340')]), new FakeEl('td', {}, []),
      new FakeEl('td', {}, []), new FakeEl('td', {}, [])]);
    tr.size = { clientWidth: 1507, clientHeight: 88 };

    eq('注入成功', M2.injectIntoRow(tr), true);
    eq('只有一行、右边还空一大截 ⇒ 空白照样补（按钮必须有地方落）',
       name.style.getPropertyValue('padding-bottom'), '28px');
    const btn = tr.querySelector('button');
    ok('  └ 按钮仍落在文字下方（20 + 4），而不是挤进那一行',
       parseFloat(btn.style.getPropertyValue('top')) === 24,
       'top=' + btn.style.getPropertyValue('top'));
  }

  // E2s. 版本迁移：旧版（v4）在名字上留的 padding-right 必须还回去（五改）
  //
  // 【为什么需要这条】第四轮给名字加过 `padding-right: 70px` 并打了 `= 1` 标记。
  //   用户不刷新页面时，旧标记还在、按钮已经按新版重建 ⇒ 名字会「右边窄一截 +
  //   底部又多出空白」，是最难看的中间态。见到旧标记必须先还原再按新版处理。
  {
    const name = new FakeEl('p', { class: 'productName-x' }, [new FakeText(NAME_TEXT)]);
    name._sizes = { clientWidth: 200, clientHeight: 40 };
    name._lines = [{ left: 0, right: 200, top: 0, bottom: 40, width: 200, height: 40 }];
    // 手工构造「上一版的遗留状态」：右侧预留 70px + 旧标记值 1
    name.style.setProperty('padding-right', '70px', 'important');
    name.style.setProperty('box-sizing', 'border-box', 'important');
    name.setAttribute('data-dyc-ct-padded', '1');
    name.setAttribute('data-dyc-ct-pad-orig', '{}');
    const right = new FakeEl('div', {}, [name]);
    const cell = new FakeEl('td', {}, [new FakeEl('img', {}, []), right]);
    cell._sizes = { clientWidth: 320, clientHeight: 88 };
    const tr = new FakeEl('tr', {}, [new FakeEl('td', {}, [new FakeText('1')]), cell,
      new FakeEl('td', {}, [new FakeText('340')]), new FakeEl('td', {}, []),
      new FakeEl('td', {}, []), new FakeEl('td', {}, [])]);
    tr.size = { clientWidth: 1507, clientHeight: 88 };

    eq('注入成功', M2.injectIntoRow(tr), true);
    eq('旧版的 padding-right 被还回去（名字恢复全宽）',
       name.style.getPropertyValue('padding-right'), '');
    eq('  └ 改成补底部空白', name.style.getPropertyValue('padding-bottom'), '28px');
    ok('  └ 标记升级到 6', name.getAttribute('data-dyc-ct-padded') === '6');
  }

  // E2t. 按钮放大后，上一版（v5）补的 24px 空白必须被重算成 28px（六改）
  //
  // 【为什么要这条】第六轮把按钮从 48×20 放大到 56×24，而补进名字底部的空白
  //   高度 = 按钮高 + 空档 = 28px。**如果只改尺寸、不换 PAD_VER**，
  //   页面上已有 `data-dyc-ct-padded = 5` 的元素会被 `ensureBadgeRoom` 早退跳过
  //   ⇒ 空白仍是 24px，而按钮已经 24px 高、又往下压 4px 空档 ⇒ 底部溢出 4px，
  //   重新压到下面的 ID 行上。
  //   ⇒ 这条用例钉住「幂等早退必须校验状态是否仍然正确」这条规则：
  //     标记版本不同 ⇒ 必须重跑，而不是「我处理过了就跳过」。
  {
    const name = new FakeEl('p', { class: 'productName-x' }, [new FakeText(NAME_TEXT)]);
    name._sizes = { clientWidth: 200, clientHeight: 48 };
    name._lines = [{ left: 0, right: 200, top: 0, bottom: 44, width: 200, height: 44 }];
    // 手工构造「上一版落点标记」：底部补了 24px、标记 = 5
    name.style.setProperty('padding-bottom', '24px', 'important');
    name.style.setProperty('box-sizing', 'border-box', 'important');
    name.setAttribute('data-dyc-ct-padded', '5');
    const right = new FakeEl('div', {}, [name]);
    const cell = new FakeEl('td', {}, [new FakeEl('img', {}, []), right]);
    cell._sizes = { clientWidth: 320, clientHeight: 88 };
    const tr = new FakeEl('tr', {}, [new FakeEl('td', {}, [new FakeText('1')]), cell,
      new FakeEl('td', {}, [new FakeText('340')]), new FakeEl('td', {}, []),
      new FakeEl('td', {}, []), new FakeEl('td', {}, [])]);
    tr.size = { clientWidth: 1507, clientHeight: 88 };

    eq('注入成功', M2.injectIntoRow(tr), true);
    eq('v5 的 24px 空白被重算成 28px（按钮长高了，空白必须跟着长）',
       name.style.getPropertyValue('padding-bottom'), '28px');
    ok('  └ 标记升级到 6', name.getAttribute('data-dyc-ct-padded') === '6');
    // 按钮顶边 = 文字底边 44 + 空档 4 = 48，与 24px 空白时的 44 不同
    const btn = tr.querySelector('button');
    eq('  └ 按钮落在放大后的空白里（文字底边 44 + 空档 4）',
       parseFloat(btn.style.getPropertyValue('top')), 48);
  }

  // E2p2. 真机复现：容器高度只够一行时，按钮**不许被夹到顶部**（六改更新）
  //
  // 【真机证据】2026-10-19 截图：按钮横跨商品名第一行与第二行，压住「外套」上半截。
  //   根因：上一版把 top 夹在 `容器高度 − 按钮高` 之内，而那个页面 nameEl 的父容器
  //   高度只够一行（21px）⇒ maxT≈0 ⇒ top 被硬拽到 0 ⇒ 按钮跑到第一行顶部。
  //   ⇒ 纵向只以「文字真实底边」为锚，**不拿容器高度当上限**。
  //
  // 【第五轮起锚点又变了】不再是「名字块底边」，而是「文字真实底边 + 空档 4」——
  //   因为名字块底边已经被 28px 的落位空白撑开了，拿它算会每补一次就离文字更远一次。
  //   本用例同时给出 Range 行矩形（真机常态），验证按**文字**算而不是按盒子算。
  {
    const name = new FakeEl('p', { class: 'productName-x' }, [new FakeText(NAME_TEXT)]);
    name._sizes = { clientWidth: 300, clientHeight: 40 };      // 名字两行
    name._lines = [
      { left: 0, right: 300, top: 0, bottom: 20, width: 300, height: 20 },
      { left: 0, right: 200, top: 20, bottom: 40, width: 200, height: 20 }
    ];
    const right = new FakeEl('div', {}, [name]);
    // ⚠️ 关键：容器高度只够一行 —— 复现真机那种「父容器比文字矮」
    const cell = new FakeEl('td', {}, [new FakeEl('img', {}, []), right]);
    cell._sizes = { clientWidth: 320, clientHeight: 21 };
    const tr = new FakeEl('tr', {}, [new FakeEl('td', {}, [new FakeText('1')]), cell,
      new FakeEl('td', {}, [new FakeText('340')]), new FakeEl('td', {}, []),
      new FakeEl('td', {}, []), new FakeEl('td', {}, [])]);
    tr.size = { clientWidth: 1507, clientHeight: 106 };

    eq('注入成功', M2.injectIntoRow(tr), true);
    const btn = tr.querySelector('button');
    const top = parseFloat(btn.style.getPropertyValue('top'));
    eq('纵向落在文字底边下方 4px（40 + 4），按文字算而不是按盒子算', top, 44);
    ok('  └ 容器只有 21px 高也不把按钮夹回顶部', top !== 0 && top > 21);
  }

  // E2p3. 量不到文字行矩形时的兜底：按「盒子底边 − 落位空白」反推，同样不许夹容器
  //
  // 【为什么要这条】`Range.getClientRects()` 在极个别内核/瞬间（元素 display:none
  //   刚恢复、或整行还没排版）可能返回空。此时 lastLineRect 返回 null，实现退回
  //   `nr.height − BADGE_PAD_BOTTOM` 估算文字底边。兜底也必须落在下方，
  //   不能因为估算失败就贴回顶部 —— 那正是第三轮压字的形态。
  {
    const name = new FakeEl('p', { class: 'productName-x' }, [new FakeText(NAME_TEXT)]);
    name._sizes = { clientWidth: 300, clientHeight: 40 };      // 无 _lines ⇒ Range 量不到
    const right = new FakeEl('div', {}, [name]);
    const cell = new FakeEl('td', {}, [new FakeEl('img', {}, []), right]);
    cell._sizes = { clientWidth: 320, clientHeight: 21 };
    const tr = new FakeEl('tr', {}, [new FakeEl('td', {}, [new FakeText('1')]), cell,
      new FakeEl('td', {}, [new FakeText('340')]), new FakeEl('td', {}, []),
      new FakeEl('td', {}, []), new FakeEl('td', {}, [])]);
    tr.size = { clientWidth: 1507, clientHeight: 106 };

    eq('注入成功', M2.injectIntoRow(tr), true);
    const btn = tr.querySelector('button');
    // 兜底公式：盒子高 40 − 落位空白 28 = 12（估算文字底边）；再 + 空档 4 = 16
    eq('量不到行矩形 ⇒ 按「盒子高 − 落位空白 + 4」兜底', 
       parseFloat(btn.style.getPropertyValue('top')), 40 - 28 + 4);
  }

  // E2q. 坐标没变 ⇒ **不写 style**（否则平台的 ResizeObserver 会被反复触发）
  //
  // 真机报过 `ResizeObserver loop completed with undelivered notifications`，
  // 就是「每 300ms 重写一次同样样式」造成的。setPxStable 的容差就是为这个。
  {
    const name = new FakeEl('p', { class: 'productName-x' }, [new FakeText(NAME_TEXT)]);
    name._sizes = { clientWidth: 200, clientHeight: 40 };
    const right = new FakeEl('div', {}, [name]);
    const cell = new FakeEl('td', {}, [new FakeEl('img', {}, []), right]);
    cell._sizes = { clientWidth: 320, clientHeight: 88 };
    const tr = new FakeEl('tr', {}, [new FakeEl('td', {}, [new FakeText('1')]), cell,
      new FakeEl('td', {}, [new FakeText('340')]), new FakeEl('td', {}, []),
      new FakeEl('td', {}, []), new FakeEl('td', {}, [])]);
    tr.size = { clientWidth: 1507, clientHeight: 88 };

    M2.injectIntoRow(tr);
    const btn = tr.querySelector('button');
    let writes = 0;
    const raw = btn.style.setProperty.bind(btn.style);
    btn.style.setProperty = (prop, val, prio) => {
      if (prop === 'left' || prop === 'top') writes++;
      raw(prop, val, prio);
    };
    for (let i = 0; i < 3; i++) M2.injectIntoRow(tr);
    eq('连跑 3 轮补涂：left/top 一次都没重写', writes, 0);
  }

  // E2r. 关开关 ⇒ 定位容器的 position 与名字底部补的空白都要还回去（五改）
  {
    const name = new FakeEl('p', { class: 'productName-x' }, [new FakeText(NAME_TEXT)]);
    name._sizes = { clientWidth: 200, clientHeight: 40 };
    name._lines = [{ left: 0, right: 198, top: 0, bottom: 20, width: 198, height: 20 }];
    const right = new FakeEl('div', {}, [name]);
    const cell = new FakeEl('td', {}, [new FakeEl('img', {}, []), right]);
    cell._sizes = { clientWidth: 320, clientHeight: 88 };
    const tr = new FakeEl('tr', {}, [new FakeEl('td', {}, [new FakeText('1')]), cell,
      new FakeEl('td', {}, [new FakeText('340')]), new FakeEl('td', {}, []),
      new FakeEl('td', {}, []), new FakeEl('td', {}, [])]);
    tr.size = { clientWidth: 1507, clientHeight: 88 };
    M2.injectIntoRow(tr);
    ok('注入后容器 position = relative', cell.style.getPropertyValue('position') === 'relative');
    ok('注入后名字底部补出了落位空白',
       name.style.getPropertyValue('padding-bottom') === '28px');
    ok('  └ 没有动名字的右侧（横向不再预留）',
       name.style.getPropertyValue('padding-right') === '');

    // restoreAll 靠 document.querySelectorAll 找带标记的元素 ⇒ 垫片按选择器给
    const rawQS = global.document.querySelectorAll;
    global.document.querySelectorAll = (sel) => {
      if (sel === '[data-dyc-ct-expand]') return [name];
      if (sel === '[data-dyc-ct-host]') return [cell];
      return [];
    };
    try {
      M2.restoreAll();
    } finally {
      global.document.querySelectorAll = rawQS;
    }
    eq('还原后名字的 padding-bottom 清空', name.style.getPropertyValue('padding-bottom'), '');
    eq('  └ box-sizing 也还原', name.style.getPropertyValue('box-sizing'), '');
    ok('还原后预留标记被摘掉', name.getAttribute('data-dyc-ct-padded') === null);
    eq('还原后容器 position 清空（平台重新接管）', cell.style.getPropertyValue('position'), '');
    ok('还原后容器标记被摘掉', cell.getAttribute('data-dyc-ct-host') === null);
  }

  // E3. 点一下 ⇒ 复制到款号 + 三段式消息（source 必须是「货号复制」）
  {
    global.toastCalls.length = 0;
    global.lastCopied = null;
    const { tr } = buildRow({ deal: '340', ourButton: false });
    M2.injectIntoRow(tr);
    const btn = tr.querySelector('button');
    const prevented = btn.fire('click');
    // copyText 走的是 Promise（navigator.clipboard.writeText().then）⇒ 断言必须等微任务
    await Promise.resolve();
    await Promise.resolve();
    ok('点击时 preventDefault（不触发平台跳转）', prevented === true);
    eq('剪贴板拿到的是款号', global.lastCopied, 'NE1C1091W');
    const last = global.toastCalls[global.toastCalls.length - 1];
    ok('弹了消息', !!last);
    eq('  └ 来源为「货号复制」', last && last.opts.source, '货号复制');
    eq('  └ 不进消息盒子', last && last.opts.keepHistory, false);
    ok('  └ 文案含款号', last && last.msg.indexOf('NE1C1091W') >= 0, last && last.msg);
  }

  // E6. 名称被 <a> 包着 ⇒ 按钮必须插到 <a> 之后，不能插进 <a> 里（否则点击顺带跳转）
  {
    const name = new FakeEl('p', { class: 'productName-x' }, [new FakeText(NAME_TEXT)]);
    const link = new FakeEl('a', { href: '/detail' }, [name]);
    const wrap = new FakeEl('div', {}, [link]);
    const cell = new FakeEl('td', {}, [new FakeEl('img', {}, []), wrap]);
    const tr = new FakeEl('tr', {}, [new FakeEl('td', {}, [new FakeText('1')]), cell,
      new FakeEl('td', {}, [new FakeText('340')]), new FakeEl('td', {}, []),
      new FakeEl('td', {}, []), new FakeEl('td', {}, [])]);
    tr.size = { clientWidth: 1507, clientHeight: 88 };
    M2.injectIntoRow(tr);
    const btn = tr.querySelector('button');
    ok('按钮没有被塞进 <a> 里（否则点击会顺带跳转）',
       !!btn && btn.parentElement !== link && btn.parentElement !== name,
       btn ? '实际父级 ' + btn.parentElement.tagName : '按钮没插进去');
    ok('  └ 挂在单元格里（绝对定位，不进 <a> 也不进 wrap）',
       !!btn && btn.parentElement === cell,
       btn ? '实际父级 ' + btn.parentElement.tagName : '');
    ok('  └ 带 is-badge', btn && btn.classList.contains('is-badge'));
  }

  // E5. 平台重渲染抹掉内联样式、但按钮还在 ⇒ 必须重新展开（不能因「已有按钮」早退）
  {
    const { tr, nameEl } = buildRow({ ourButton: false });
    // 造一个「真被截断」的名称：横向溢出 40px
    nameEl.size = { clientWidth: 100, clientHeight: 20, scrollWidth: 140, scrollHeight: 20 };
    M2.injectIntoRow(tr);
    eq('首次注入即展开：white-space 变 normal', nameEl.style.whiteSpace, 'normal');
    eq('首次注入即展开：带展开标记', nameEl.getAttribute('data-dyc-ct-expand'), '1');

    // 模拟平台重渲染：把内联样式整段清空（标记与按钮留着）
    for (const p of ['whiteSpace', 'wordBreak', 'overflowWrap', 'textOverflow',
                     'height', 'maxHeight', 'overflow', 'display']) {
      nameEl.style[p] = '';
    }
    nameEl.size = { display: 'block', whiteSpace: 'nowrap' };   // 计算值被压回 nowrap
    M2.injectIntoRow(tr);
    eq('样式被抹掉后会自动重新展开', nameEl.style.whiteSpace, 'normal');
    ok('不会插出第二枚按钮', tr.querySelectorAll('.dyc-ct-btn').length === 1,
       '实际 ' + tr.querySelectorAll('.dyc-ct-btn').length + ' 枚');
  }

  // E4. 取不到款号 ⇒ 不复制任何内容、弹「这一行没找到货号」
  {
    global.toastCalls.length = 0;
    global.lastCopied = null;
    const name = new FakeEl('p', { class: 'productName-x' }, [new FakeText('夏季纯棉短袖上衣')]);
    const cell = new FakeEl('td', {}, [new FakeEl('img', {}, []), name]);
    const tr = new FakeEl('tr', {}, [new FakeEl('td', {}, [new FakeText('1')]), cell,
      new FakeEl('td', {}, [new FakeText('340')]), new FakeEl('td', {}, []),
      new FakeEl('td', {}, []), new FakeEl('td', {}, [])]);
    tr.size = { clientWidth: 1507, clientHeight: 88 };
    M2.injectIntoRow(tr);
    const btn = tr.querySelector('button');
    btn.fire('click');
    eq('什么都没复制', global.lastCopied, null);
    const last = global.toastCalls[global.toastCalls.length - 1];
    eq('弹出「这一行没找到货号」', last && last.msg, '这一行没找到货号');
    eq('  └ 类型为 warning', last && last.type, 'warning');
  }
}

/* ---------- 汇总 ---------- */
console.log('\n' + '='.repeat(62));
console.log('通过 ' + pass + ' / ' + (pass + fail));
if (fail) {
  console.log('失败用例：');
  failures.forEach((f) => console.log('  · ' + f));
  process.exit(1);
}
console.log('全绿 ✓ —— 罗盘商品表两页的名称展开与取号口径符合直播明细页同款约定');
})();
