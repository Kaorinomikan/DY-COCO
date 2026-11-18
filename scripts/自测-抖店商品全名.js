/**
 * 抖店商品列表 · 商品名完整展示（反馈 #128）· 回归自测
 * ============================================================
 * 被测文件：src/content/shop-list-name.js
 *
 * 覆盖这些事（每条都对应一个真机上会出错的地方）：
 *   A. 「像不像商品名」—— 行内字段（ID/货号/价格）、纯数字、操作文案都不能被当成名称
 *   B. 「被哪种方式截断」—— line-clamp / nowrap+真溢出 / 定高剪裁各自识别；
 *      nowrap 但**没有真溢出**必须判「没截断」（否则会把正常文本也去改一遍）
 *   C. 语义优先：指向商品详情的链接先试；链接不截断 ≠ 放弃，还要看它的包裹层
 *   D. 特征兜底：同一行里「名称在左、价格在右」，要选中左边那个
 *   E. 自家节点一律排除（我们注入的清空库存按钮、已标记过的节点）
 *   F. 按截断原因写**最少一组**内联属性；不写死宽高、不碰 td/tr
 *   G. 备份只做一次：重复写不覆盖备份，否则关开关还原不回平台原值
 *   H. 幂等：平台把 style 洗掉（计算值仍截断）⇒ 补涂一次；已不截断 ⇒ 不再动
 *   I. 行缓存：行还在就只复核那一个名称元素（不再全页枚举）；行被销毁才重采
 *   J. 关开关 ⇒ 还原平台原样并清标记
 *   K. 源码红线：只用 setProperty 写内联、有标记属性、不设 width 之外的多余布局属性
 *   L. ★ 两行优先、最多三行：自然 ≤3 行一个字不藏；>3 行才钳三行 + 省略号（max-height 兜底）
 *   M. ★ 右侧空位 → 名字列加宽：空位 ≥60px 才动、留 16px 余量、col 与 TH 同写、
 *      幂等（列宽被平台洗掉会自动重写）、关开关还原；空位不足时一个字都不动
 *
 * 做法与 scripts/自测-小黄车自动刷新.js 同源：按函数名抠出源码 → 最小 DOM 垫片上求值
 * → 断言。源码一改自测自动跟着变，不会出现「测试绿了线上还错」。
 *
 * 用法：node scripts/自测-抖店商品全名.js
 * 退出码 0 = 全绿；1 = 有用例失败。
 * ============================================================
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SRC_PATH = path.join(ROOT, 'src/content/shop-list-name.js');

/* ============================================================
 * 1. 最小 DOM 垫片
 * ============================================================ */

class FakeStyle {
  constructor(owner) { this._m = {}; this._p = {}; this._owner = owner || null; }
  setProperty(p, v, pri) {
    this._m[p] = String(v);
    this._p[p] = pri || '';
    /* 写 width 就当作布局真的跟着变 —— 真机也是这样，否则「写完再量」那步没法测 */
    if (p === 'width' && this._owner && this._owner._rect && /px$/.test(String(v))) {
      const w = parseFloat(v);
      if (isFinite(w) && w > 0) {
        this._owner._rect.width = w;
        this._owner._rect.right = this._owner._rect.left + w;
      }
    }
  }
  getPropertyValue(p) { return Object.prototype.hasOwnProperty.call(this._m, p) ? this._m[p] : ''; }
  getPropertyPriority(p) { return this._p[p] || ''; }
  removeProperty(p) {
    delete this._m[p];
    delete this._p[p];
    if (p === 'width' && this._owner && this._owner._rect && this._owner._baseW > 0) {
      this._owner._rect.width = this._owner._baseW;
      this._owner._rect.right = this._owner._rect.left + this._owner._baseW;
    }
  }
}

class FakeEl {
  constructor(opts) {
    const o = opts || {};
    this.nodeType = 1;
    this.tagName = (o.tag || 'div').toUpperCase();
    this.id = o.id || '';
    this.className = o.cls || '';
    this.textContent = o.text || '';
    this.style = new FakeStyle(this);
    this.children = o.children || [];
    this.parentElement = o.parent || null;
    this.isConnected = o.connected !== false;
    this._rect = o.rect || { left: 0, top: 0, width: 0, height: 0, right: 0, bottom: 0 };
    this._baseW = this._rect.width;   // removeProperty('width') 时回到这个宽度
    this._cs = Object.assign({
      display: 'block',
      whiteSpace: 'normal',
      textOverflow: 'clip',
      overflow: 'visible',
      webkitLineClamp: 'none',
      fontSize: '14px',
      lineHeight: '20px'
    }, o.cs || {});
    this._attrs = Object.assign({}, o.attrs || {});
    this._sel = o.sel || {};            // selector → 数组（给 querySelectorAll 垫片用）
    this.scrollWidth = o.sw != null ? o.sw : 100;
    this.clientWidth = o.cw != null ? o.cw : 100;
    this.scrollHeight = o.sh != null ? o.sh : 20;
    this.clientHeight = o.ch != null ? o.ch : 20;
    this._childrenForClamp = o.childCount;
  }
  getBoundingClientRect() { return this._rect; }
  querySelectorAll(sel) { return this._sel[sel] || []; }
  getAttribute(n) { return Object.prototype.hasOwnProperty.call(this._attrs, n) ? this._attrs[n] : null; }
  setAttribute(n, v) { this._attrs[n] = String(v); }
  removeAttribute(n) { delete this._attrs[n]; }
  hasAttribute(n) { return Object.prototype.hasOwnProperty.call(this._attrs, n); }
  contains(el) {
    if (el === this) return true;
    for (const c of this.children) if (c === el || (c.contains && c.contains(el))) return true;
    return false;
  }
  /** 只支持本模块用到的两个选择器（td / table），沿 parentElement 上溯 */
  closest(sel) {
    let n = this;
    while (n) {
      const tag = String(n.tagName || '').toLowerCase();
      if (sel === 'td' && tag === 'td') return n;
      if (sel === 'table' && tag === 'table') return n;
      n = n.parentElement;
    }
    return null;
  }
}

const doc = {
  contains(n) { return !!(n && n.isConnected !== false); }
};

const win = {
  getComputedStyle(el) { return (el && el._cs) || {}; }
};

/** 造一个矩形 */
function rectOf(l, t, w, h) {
  return { left: l, top: t, width: w, height: h, right: l + w, bottom: t + h };
}

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
  const re = new RegExp('var\\s+' + name + '\\s*=\\s*[\\s\\S]*?;\\s*(?=\\n|var |function |/\\*)');
  const m = src.match(re);
  if (!m) throw new Error('源文件里找不到 var ' + name);
  return m[0];
}

const FN_NAMES = [
  'textOf', 'isOurNode', 'isHandled', 'isRelated', 'truncationReason', 'looksLikeName', 'findNameInRow',
  'backupOf', 'setProp', 'applyUnclip', 'naturalLines', 'capLines',
  'restoreOne', 'clearNameAttrs', 'ensureStyle', 'refreshName', 'restoreStyleProp', 'restoreOneTable',
  'lockHeight', 'relock',
  'restoreColumns', 'cellOf', 'noteFact', 'releaseOneWidth', 'releaseWidthCaps',
  'restoreCaps', 'widenNameColumn', 'onHoverIn', 'onHoverOut', 'bindHover', 'unbindHover',
  'rowAlive', 'collectRows', 'scan'
];
const VAR_NAMES = [
  'MARK', 'SCAN_DEBOUNCE', 'SCAN_MAX_WAIT', 'BOOT_DELAYS', 'NODE_BUDGET',
  'NAME_MIN_LEN', 'NAME_MAX_LEN', 'NOT_NAME_RE', 'NUMERIC_RE', 'ACTION_RE',
  'MAX_LINES', 'WIDEN_MIN_GAP', 'WIDEN_KEEP',
  'OPEN_ATTR', 'CAP_ATTR', 'MULTI_ATTR', 'H_ATTR', 'STYLE_ID', 'CSS',
  'on', 'observer', 'bootTimers', 'debounceTimer', 'queuedAt', 'rowCache',
  'appliedAt', 'widenedTables', 'cappedEls', 'touchedNames', 'resizeBound',
  'lastCount', 'lastNoteAt',
  'hoverTarget', 'hoverTimer', 'hoverBound', 'HOVER_SETTLE'
];

/** findProductRows 是 anchor.js 的全局函数，由用例按需替换 */
let productRowsImpl = () => [];

function buildModule(opts) {
  const src = fs.readFileSync(SRC_PATH, 'utf8');
  const parts = [];
  for (const v of VAR_NAMES) parts.push(sliceVar(src, v));
  for (const f of FN_NAMES) parts.push(sliceFunction(src, f));
  const prelude = [
    'on = ' + (opts && opts.on === false ? 'false' : 'true') + ';',
    'function __setRows(r) { rowCache = r; }',
    'function __setHover(x) { hoverTarget = x; }'
  ].join('\n');
  /* ⚠️ prelude 必须排在变量声明**之后**：源码里 `var on = false;` 自带初始值，
   *    放在它前面会被这一句覆盖掉（第一版就写反了，两条行缓存用例全红）。 */
  const body = parts.join('\n') + '\n' + prelude + '\nreturn {' +
    FN_NAMES.concat(VAR_NAMES).concat(['__setRows', '__setHover']).join(',') + '};';
  // eslint-disable-next-line no-new-func
  const fn = new Function('window', 'document', 'findProductRows', body);
  const m = fn(win, doc, () => productRowsImpl());
  if (opts && opts.rows) m.__setRows(opts.rows);
  return m;
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

function group(title) {
  process.stdout.write('\n[' + title + ']\n');
}

function line(title, done) {
  process.stdout.write('  ' + (done ? '✓' : '✗') + ' ' + title + '\n');
}

/* ============================================================
 * 4. 用例
 * ============================================================ */

/* ---------- A. 像不像商品名 ---------- */
group('A. 「像不像商品名」');
{
  const m = buildModule();
  ok('A1 正常商品名 ⇒ true', m.looksLikeName('2026新款加厚保暖羊毛围巾女') === true);
  ok('A2 「ID：123456」⇒ false', m.looksLikeName('ID：123456') === false);
  ok('A3 「货号: NE1C1142W」⇒ false', m.looksLikeName('货号: NE1C1142W') === false);
  ok('A4「¥136.00」⇒ false', m.looksLikeName('¥136.00') === false);
  ok('A5「136」⇒ false', m.looksLikeName('136') === false);
  ok('A6「编辑」⇒ false', m.looksLikeName('编辑') === false);
  ok('A7 整行文本混进 ID ⇒ false', m.looksLikeName('加厚围巾 ID: 3612345678 货号: NE1C1142W') === false);
  ok('A8 太短（3 字）⇒ false', m.looksLikeName('围巾') === false);
  line('A1~A8 名称判别', true);
}

/* ---------- B. 截断原因 ---------- */
group('B. 「被哪种方式截断」');
{
  const m = buildModule();
  const clampEl = new FakeEl({ text: '很长的商品名称', cs: { display: '-webkit-box', webkitLineClamp: '2' } });
  ok('B1 -webkit-line-clamp:2 ⇒ clamp', m.truncationReason(clampEl) === 'clamp');

  const nowrapEl = new FakeEl({ text: '很长的商品名称', cs: { whiteSpace: 'nowrap' }, sw: 320, cw: 288 });
  ok('B2 nowrap + 真溢出 ⇒ nowrap', m.truncationReason(nowrapEl) === 'nowrap');

  const nowrapNoOverflow = new FakeEl({ text: '短名', cs: { whiteSpace: 'nowrap' }, sw: 100, cw: 100 });
  ok('B3 nowrap 但没溢出 ⇒ 不算截断', m.truncationReason(nowrapNoOverflow) === '');

  const tallEl = new FakeEl({ text: '两行装不下', cs: { overflow: 'hidden' }, sh: 60, ch: 20 });
  ok('B4 overflow:hidden + 纵向溢出 ⇒ height', m.truncationReason(tallEl) === 'height');

  const plain = new FakeEl({ text: '正常文本' });
  ok('B5 完全正常 ⇒ 空串', m.truncationReason(plain) === '');
  line('B1~B5 截断识别', true);
}

/* ---------- C. 语义优先 ---------- */
group('C. 语义优先：详情链接');
{
  const m = buildModule();
  const link = new FakeEl({ tag: 'a', text: '加厚保暖羊毛围巾女', attrs: { href: '/ffa/g/detail?id=1' }, cs: { whiteSpace: 'nowrap' }, sw: 400, cw: 288 });
  const row = new FakeEl({ sel: { 'a[href]': [link] } });
  ok('C1 详情链接自身截断 ⇒ 选它', m.findNameInRow(row) === link);

  // 链接本身不截断，但包裹层钳行
  const link2 = new FakeEl({ tag: 'a', text: '加厚保暖羊毛围巾女', attrs: { href: '/ffa/g/detail?id=2' } });
  const wrap = new FakeEl({ text: '加厚保暖羊毛围巾女', cs: { display: '-webkit-box', webkitLineClamp: '1' } });
  const row2 = new FakeEl({ sel: { 'a[href]': [link2] } });
  link2.parentElement = wrap;
  ok('C2 链接不截断但包裹层钳行 ⇒ 选包裹层', m.findNameInRow(row2) === wrap);

  // 无关链接不参与
  const help = new FakeEl({ tag: 'a', text: '帮助中心文档', attrs: { href: '/help/doc' }, cs: { whiteSpace: 'nowrap' }, sw: 300, cw: 100 });
  const row3 = new FakeEl({ sel: { 'a[href]': [help] } });
  ok('C3 href 不是商品详情 ⇒ 不被语义档选中', m.findNameInRow(row3) === null);
  line('C1~C3 语义优先', true);
}

/* ---------- D. 特征兜底：最左优先 ---------- */
group('D. 特征兜底取最左');
{
  const m = buildModule();
  const name = new FakeEl({
    text: '加厚保暖羊毛围巾女秋冬款',
    cs: { whiteSpace: 'nowrap' }, sw: 420, cw: 288,
    rect: { left: 120, top: 100, width: 288, height: 20, right: 408, bottom: 120 }
  });
  const price = new FakeEl({
    text: '到手价 ¥136.00 起',
    cs: { whiteSpace: 'nowrap' }, sw: 200, cw: 120,
    rect: { left: 900, top: 100, width: 120, height: 20, right: 1020, bottom: 120 }
  });
  const row = new FakeEl({ sel: { 'span, a, div, p, h3, h4, strong, em': [name, price] } });
  ok('D1 名称在左、价格在右 ⇒ 选名称', m.findNameInRow(row) === name);

  // 太短 / 字段类文本即使在左边也不选
  const idText = new FakeEl({
    text: 'ID：3612345678', cs: { whiteSpace: 'nowrap' }, sw: 200, cw: 100,
    rect: { left: 120, top: 130, width: 100, height: 20, right: 220, bottom: 150 }
  });
  const row2 = new FakeEl({ sel: { 'span, a, div, p, h3, h4, strong, em': [idText, name] } });
  ok('D2 左边的 ID 行不算名称 ⇒ 仍然选名称', m.findNameInRow(row2) === name);
  line('D1/D2 兜底扫描', true);
}

/* ---------- E. 自家节点排除 ---------- */
group('E. 自家节点一律排除');
{
  const m = buildModule();
  ok('E1 .dyc- 类名 ⇒ 排除', m.isOurNode(new FakeEl({ cls: 'dyc-clear-btn' })) === true);
  ok('E2 #dyb- ⇒ 排除', m.isOurNode(new FakeEl({ id: 'dyb-badge' })) === true);
  ok('E3 带 data-dyc-clear ⇒ 排除', m.isOurNode(new FakeEl({ attrs: { 'data-dyc-clear': '1' } })) === true);
  ok('E4 已标记过的名称节点 ⇒ 排除', m.isOurNode(new FakeEl({ attrs: { 'data-dyc-shopname': '1' } })) === true);
  ok('E5 普通节点 ⇒ 不排除', m.isOurNode(new FakeEl({ cls: 'goods-name' })) === false);
  line('E1~E5 自家节点排除', true);
}

/* ---------- F. 名称解截断 = 只打属性（2026-11-18 治抖口径） ---------- */
group('F. 名称解截断只打属性，不写内联');
{
  const m = buildModule();
  const el = new FakeEl({ text: '加厚保暖羊毛围巾女秋冬款', cs: { whiteSpace: 'nowrap' }, sw: 420, cw: 288, sh: 40, ch: 20 });
  const wrote = m.applyUnclip(el, 'nowrap');
  ok('F1 nowrap ⇒ 打 OPEN 属性', el.getAttribute('data-dyc-nameopen') === '1');
  ok('F2 ★ 一条内联都没写（抖动源就在这里）',
    el.style.getPropertyValue('white-space') === '' &&
    el.style.getPropertyValue('display') === '' &&
    el.style.getPropertyValue('overflow') === '',
    JSON.stringify([el.style.getPropertyValue('white-space'), el.style.getPropertyValue('display')]));
  ok('F3 折成两行 ⇒ 打 MULTI（行距与下内边距由规则给）', el.getAttribute('data-dyc-namemulti') === '1');
  ok('F4 打上标记', el.getAttribute('data-dyc-shopname') === '1');
  ok('F5 真正处理了 ⇒ 返回 true', wrote === true);
  ok('F6 不设 width / max-width（列宽归平台）',
    el.style.getPropertyValue('width') === '' && el.style.getPropertyValue('max-width') === '');
  ok('F7 记进 touchedNames（关开关按它摘属性）', m.touchedNames.indexOf(el) >= 0);

  // clamp 型：不再分三档写不同内联，统一 OPEN 属性
  const el2 = new FakeEl({ text: '很长的商品名称', cs: { display: '-webkit-box', webkitLineClamp: '2' }, sh: 20, ch: 20 });
  m.applyUnclip(el2, 'clamp');
  ok('F8 clamp ⇒ 同样是 OPEN 属性（不走内联）',
    el2.getAttribute('data-dyc-nameopen') === '1' && el2.style.getPropertyValue('display') === '');

  // 定高型
  const el4 = new FakeEl({ text: '很长的商品名称', cs: { overflow: 'hidden' }, sh: 20, ch: 20 });
  m.applyUnclip(el4, 'height');
  ok('F9 height ⇒ OPEN 属性', el4.getAttribute('data-dyc-nameopen') === '1');

  // 不认识的 reason ⇒ 什么都不做
  const el3 = new FakeEl({ text: '很长的商品名称' });
  ok('F10 reason 为空 ⇒ 不写、返回 false',
    m.applyUnclip(el3, '') === false && el3.getAttribute('data-dyc-nameopen') === null);
  line('F1~F10 属性方案', true);
}

/* ---------- G. 平台原有内联我们不碰 ---------- */
group('G. 打属性不产生内联备份');
{
  const m = buildModule();
  const el = new FakeEl({ text: '加厚保暖羊毛围巾女秋冬款', cs: { whiteSpace: 'nowrap' }, sw: 420, cw: 288, sh: 40, ch: 20 });
  // 平台原本就有一条内联，我们不写内联所以它应当原样不动
  el.style.setProperty('white-space', 'nowrap', '');
  m.applyUnclip(el, 'nowrap');
  ok('G1 平台原有内联原样保留', el.style.getPropertyValue('white-space') === 'nowrap');
  ok('G2 没有内联备份（解截断不再写内联，不需要备份）', !el.__dycShopNameOrig);

  m.applyUnclip(el, 'nowrap');
  ok('G3 重复处理不重复记账', el.getAttribute('data-dyc-nameopen') === '1' && m.touchedNames.length === 1);
  line('G1~G3 无内联、无重复记账', true);
}

/* ---------- H. 幂等：属性在就不再处理（断环口） ---------- */
group('H. 属性在就不重复处理（治抖的关键一拍）');
{
  const m = buildModule();
  const el = new FakeEl({ text: '加厚保暖羊毛围巾女秋冬款', cs: { whiteSpace: 'nowrap' }, sw: 420, cw: 288, sh: 40, ch: 20 });
  ok('H1 仍截断 ⇒ 处理返回 true', m.refreshName(el) === true);
  ok('H2 处理后带 OPEN 属性', el.getAttribute('data-dyc-nameopen') === '1');

  /* ★ 这两条是抖动的根：平台把内联洗回截断态 ⇒ 我们每轮又解开 ⇒ 行高来回跳。
   *   属性方案下「属性在 ⇒ 不再判被截断 ⇒ 不再重写」，循环就断了。 */
  ok('H3 ★ 属性在 ⇒ truncationReason 返回空（平台洗不回来）', m.truncationReason(el) === '');
  ok('H4 ★ 再复核一轮 ⇒ false（不重写）', m.refreshName(el) === false);

  // 平台换掉节点：属性没了，计算值仍截断 ⇒ 重新处理（这不叫抖动，是赶上新节点）
  const fresh = new FakeEl({ text: '加厚保暖羊毛围巾女秋冬款', cs: { whiteSpace: 'nowrap' }, sw: 420, cw: 288, sh: 40, ch: 20 });
  ok('H5 新节点（无属性）⇒ 重新处理', m.refreshName(fresh) === true && fresh.getAttribute('data-dyc-nameopen') === '1');

  // 本来就没截断 ⇒ 不动
  const okEl = new FakeEl({ text: '短名', cs: { whiteSpace: 'normal' }, sw: 100, cw: 288 });
  ok('H6 本来不截断 ⇒ false', m.refreshName(okEl) === false);

  // raw=true 给 findNameInRow 复选候选：按计算值判，不被属性短路
  const rawEl = new FakeEl({ text: '很长的商品名称', cs: { display: '-webkit-box', webkitLineClamp: '2' }, attrs: { 'data-dyc-nameopen': '1' } });
  ok('H7 raw=true ⇒ 按计算值判（不被属性短路）', m.truncationReason(rawEl, true) === 'clamp');
  line('H1~H7 断环', true);
}

/* ---------- I. 行缓存 ---------- */
group('I. 行缓存：只复核缓存的那一个元素');
{
  let calls = 0;
  productRowsImpl = () => { calls++; return []; };

  const nameEl = new FakeEl({ text: '加厚保暖羊毛围巾女秋冬款', cs: { whiteSpace: 'nowrap' }, sw: 420, cw: 288, sh: 40, ch: 20 });
  const row = new FakeEl({ text: '加厚保暖羊毛围巾女 ID：3612345678', children: [nameEl] });
  row.__dycNameEl = nameEl;
  nameEl.parentElement = row;
  nameEl.isConnected = true;

  const m = buildModule({ rows: [row] });
  const n1 = m.scan();
  ok('I1 缓存行还在 ⇒ 直接复核，不重新枚举', n1 === 1 && calls === 0, 'scan=' + n1 + ' 枚举次数=' + calls);

  // 行被销毁（翻页）⇒ 允许重采
  row.isConnected = false;
  const m2 = buildModule({ rows: [row] });
  calls = 0;
  m2.scan();
  ok('I2 缓存行已不在文档 ⇒ 重新枚举一次', calls === 1, '枚举次数=' + calls);
  line('I1/I2 行缓存', true);
}

/* ---------- J. 关开关还原 ---------- */
group('J. 关开关还原平台原样');
{
  const m = buildModule();
  const el = new FakeEl({ text: '加厚保暖羊毛围巾女秋冬款', cs: { whiteSpace: 'nowrap' }, sw: 420, cw: 288, sh: 40, ch: 20 });
  el.style.setProperty('white-space', 'nowrap', '');
  m.applyUnclip(el, 'nowrap');
  ok('J1 展开后带属性', el.getAttribute('data-dyc-nameopen') === '1');

  m.restoreOne(el);
  ok('J2 三个状态属性全摘（规则不再匹配 ⇒ 回到平台原样）',
    el.getAttribute('data-dyc-nameopen') === null &&
    el.getAttribute('data-dyc-namecap') === null &&
    el.getAttribute('data-dyc-namemulti') === null);
  ok('J3 标记已清', el.getAttribute('data-dyc-shopname') === null);
  ok('J4 平台原有内联没被改', el.style.getPropertyValue('white-space') === 'nowrap', el.style.getPropertyValue('white-space'));

  // 只有内联的场景（解除宽度上限的容器）仍要能还原
  const box = new FakeEl({});
  box.style.setProperty('max-width', '240px', '');
  m.setProp(box, 'max-width', 'none');
  ok('J5 宽度容器：写了内联', box.style.getPropertyValue('max-width') === 'none');
  m.restoreOne(box);
  ok('J6 宽度容器：还原成平台原值', box.style.getPropertyValue('max-width') === '240px', box.style.getPropertyValue('max-width'));
  line('J1~J6 还原', true);
}

/* ---------- K. 源码红线 ---------- */
group('K. 源码红线');
{
  const src = fs.readFileSync(SRC_PATH, 'utf8');

  /* ★ 2026-11-18 治抖红线：名称解截断不许再写内联。
   *   平台重渲染会整段重写 style 属性，内联被抹 ⇒ 每轮重写 ⇒ 行高来回跳。 */
  const unclipBody = (src.match(/function applyUnclip\(el, reason\)\s*\{[\s\S]*?\n  \}/) || [''])[0];
  ok('K1 ★ applyUnclip 体内一次 setProperty 都没有（只打属性）',
    unclipBody.length > 0 && !/setProperty/.test(unclipBody));
  ok('K2 ★ 有断环口：见状态属性直接判「不截断」',
    /if \(!raw && isHandled\(el\)\) return '';/.test(src));
  ok('K3 有常驻 CSS 注入，且启动时先注入再扫描',
    /var CSS = \[/.test(src) && /function ensureStyle\(\)/.test(src) && /ensureStyle\(\);/.test(src));
  ok('K4 关开关 / 缩放会摘状态属性（否则规则一直匹配，回不到原样）',
    /function clearNameAttrs\(el\)/.test(src) && /clearNameAttrs\(touchedNames\[i\]\)/.test(src));

  ok('K5 备份机制仍在（列宽 / 解宽度上限还要靠它还原）', /hasOwnProperty\.call\(bak, prop\)/.test(src));
  ok('K6 列宽只经 setProperty 写（col / 表头 TH / 单元格三处），不写 .style.width =',
    !/\.style\.width\s*=/.test(src) && !/td\.style\.width/.test(src) &&
    /style\.setProperty\('width'/.test(src));
  ok('K7 有开关键 shopListNameWrap 的读取与订阅', /shopListNameWrap/.test(src) && /dycWatchFlags/.test(src));
  ok('K8 观察器挂在 body 且只排一次防抖', /observer\.observe\(document\.body/.test(src) && /scheduleScan\(\)/.test(src));
  ok('K9 防抖配最长等待（列表页 DOM 一直在动）', /SCAN_MAX_WAIT/.test(src) && /now - queuedAt >= SCAN_MAX_WAIT/.test(src));

  /* 2026-11-01 用户：「这个功能不需要弹提示」——
   * 排版类改动一律静默生效，只保留用户主动切开关时那句「已开启 / 已关闭」。
   * 这两条是防回潮的闸门：以后谁再往生效路径里塞 toast，自测立刻红。 */
  const scanBody = (src.match(/function scan\(\)\s*\{[\s\S]*?\n  \}/) || [''])[0];
  ok('K10 生效路径（scan）体内不出现 toast', scanBody.length > 0 && !/toast\(/.test(scanBody));
  ok('K11 全文只剩一处 toast —— 开关切换的回执', (src.match(/toast\(/g) || []).length === 1);

  /* ★ 2026-11-18 第二版防回潮：scan 里必须先判 hover 再动列宽。
   *   一旦有人把 widenNameColumn 挪到 hover 判断之前，抖动会原样回来。 */
  ok('K12 ★ scan 里列宽写入被 hover 守卫包住', /if \(!hoverTarget\) \{[\s\S]{0,200}widenNameColumn/.test(scanBody));
  ok('K13 ★ scan 里先跳掉悬停中的那一行', /isRelated\(hoverTarget, row\)\) \{[\s\S]{0,120}continue;/.test(scanBody));
  ok('K13b ★ 悬停行只补块高锁、不做测量', /function relock\(row\)/.test(src) && /relock\(row\);/.test(scanBody));
  ok('K14 悬停进出事件有绑定也有解绑', /addEventListener\('pointerover'/.test(src) && /removeEventListener\('pointerover'/.test(src));
  line('K1~K14 源码红线（属性方案 + 悬停不写 + 不弹提示）', true);
}

/* ---------- L. 两行优先、最多三行 ---------- */
group('L. 两行优先、最多三行');
{
  const m = buildModule();
  const cssTxt = String(m.CSS);

  // 自然 2 行 ⇒ 一个字不藏
  const two = new FakeEl({ text: '加厚保暖羊毛围巾女秋冬款', cs: { whiteSpace: 'nowrap', lineHeight: '20px' }, sw: 420, cw: 288, sh: 40, ch: 20 });
  ok('L1 自然行数 = 2', m.naturalLines(two) === 2, '得到 ' + m.naturalLines(two));
  m.applyUnclip(two, 'nowrap');
  ok('L2 两行装得下 ⇒ 不钳（无 CAP 属性）', two.getAttribute('data-dyc-namecap') === null);
  ok('L3 两行 ⇒ 补 MULTI（行距不贴在一起）', two.getAttribute('data-dyc-namemulti') === '1');

  // 自然 3 行 ⇒ 也完整显示（2026-11-01 两次截图都卡在「两行差几个字」）
  const three = new FakeEl({ text: '加厚保暖羊毛围巾女秋冬款', cs: { whiteSpace: 'nowrap', lineHeight: '20px' }, sw: 420, cw: 288, sh: 60, ch: 20 });
  ok('L4 自然行数 = 3', m.naturalLines(three) === 3, '得到 ' + m.naturalLines(three));
  m.applyUnclip(three, 'nowrap');
  ok('L5 ★ 三行装得下 ⇒ 不钳（「有些还是不完整」的修复点）', three.getAttribute('data-dyc-namecap') === null);

  // 自然 4 行 ⇒ 钳到三行
  const four = new FakeEl({ text: '加厚保暖羊毛围巾女秋冬款', cs: { whiteSpace: 'nowrap', lineHeight: '20px' }, sw: 420, cw: 288, sh: 80, ch: 20 });
  ok('L6 自然行数 = 4', m.naturalLines(four) === 4, '得到 ' + m.naturalLines(four));
  m.applyUnclip(four, 'nowrap');
  ok('L7 超三行 ⇒ 打 CAP 属性', four.getAttribute('data-dyc-namecap') === '1');
  ok('L8 同时摘掉 OPEN（两条规则不能同时命中）', four.getAttribute('data-dyc-nameopen') === null);
  ok('L9 CAP 规则钳 MAX_LINES 行',
    new RegExp('-webkit-line-clamp: ' + m.MAX_LINES + ' !important').test(cssTxt));
  ok('L10 CAP 规则带省略号', /text-overflow: ellipsis !important/.test(cssTxt));
  ok('L11 老内核兜底 max-height（em，不认 line-clamp 也不撑高）', /max-height: [\d.]+em !important/.test(cssTxt));
  ok('L12 超三行时 capLines 返回 true', m.capLines(four) === true);

  // 单行不钳
  const one = new FakeEl({ text: '短名', cs: { whiteSpace: 'normal', lineHeight: '20px' }, sh: 20, ch: 20 });
  ok('L13 单行 ⇒ 不钳', m.capLines(one) === false);
  line('L1~L13 两行优先三行兜底', true);
}

/* ---------- Q. 常驻 CSS（平台洗不掉的那一层） ---------- */
group('Q. 常驻 CSS 与抖动断环');
{
  const m = buildModule();
  const css = String(m.CSS);
  ok('Q1 OPEN 规则存在且带 !important', /\[data-dyc-nameopen\] \{[\s\S]*display: block !important/.test(css));
  ok('Q2 OPEN 规则去钳行 + 放开 overflow', /-webkit-line-clamp: none !important/.test(css) && /overflow: visible !important/.test(css));
  ok('Q3 OPEN 规则恢复换行与折词', /white-space: normal !important/.test(css) && /overflow-wrap: break-word !important/.test(css));
  ok('Q4 MULTI 只在多行时补行距（单行不动）', /\[data-dyc-namemulti\] \{ line-height: 1\.55 !important/.test(css));
  ok('Q5 样式表 id 固定', m.STYLE_ID === 'dyc-shopname-style');

  /* 抖动回归闸：这两条一旦被改回去（属性不再短路 / 又重新写内联），下面就会红 */
  const el = new FakeEl({ text: '加厚保暖羊毛围巾女秋冬款', cs: { whiteSpace: 'nowrap' }, sw: 420, cw: 288, sh: 40, ch: 20 });
  m.applyUnclip(el, 'nowrap');
  ok('Q6 ★ 解开后每轮复核都是 false（不产生写入 → 不会抖）',
    m.refreshName(el) === false && m.refreshName(el) === false);

  // 垫片里没有 head，ensureStyle 必须安静跳过而不是抛错
  ok('Q7 ensureStyle 在缺 head 的环境里不抛错', (() => { try { m.ensureStyle(); return true; } catch (e) { return false; } })());
  line('Q1~Q7 常驻规则与断环', true);
}

/* ---------- M. 右侧空位 → 名字列加宽 ---------- */
group('M. 右侧空位 → 名字列加宽');
{
  /** 摆一张表：容器比表格宽 gap 像素，名字列宽 cellW */
  function scene(gap, cellW) {
    const nameEl = new FakeEl({ text: '加厚保暖羊毛围巾女秋冬款' });
    const td = new FakeEl({ tag: 'td', rect: rectOf(100, 100, cellW, 60) });
    td.cellIndex = 1;
    const col0 = new FakeEl({ tag: 'col' });
    const col1 = new FakeEl({ tag: 'col' });
    const th0 = new FakeEl({ tag: 'th' });
    const th1 = new FakeEl({ tag: 'th' });
    const table = new FakeEl({ tag: 'table', rect: rectOf(0, 80, 1000, 400) });
    table.tHead = { rows: [{ cells: [th0, th1] }] };
    table._sel = { 'colgroup > col': [col0, col1] };
    const box = new FakeEl({ rect: rectOf(0, 80, 1000 + gap, 400) });
    table.parentElement = box;
    td.parentElement = table;
    td.children = [nameEl];
    nameEl.parentElement = td;
    return { nameEl, td, table, col1, th1 };
  }

  const m = buildModule();

  // M1 空位 200px ⇒ 加宽 196px（WIDEN_KEEP=4）
  const s1 = scene(200, 288);
  const r1 = m.widenNameColumn(s1.nameEl);
  ok('M1 有空位 ⇒ 加宽', r1 === 'done', '得到 ' + r1);
  ok('M2 col 宽度 = 288 + 196', s1.col1.style.getPropertyValue('width') === '484px', s1.col1.style.getPropertyValue('width'));
  ok('M3 表头 TH 同步写', s1.th1.style.getPropertyValue('width') === '484px', s1.th1.style.getPropertyValue('width'));
  ok('M4 ★ 单元格本身也写（上一版只写 col/TH，两处拿不到时列宽一点没动）',
    s1.td.style.getPropertyValue('width') === '484px', s1.td.style.getPropertyValue('width'));
  ok('M5 不动名字元素自己的样式', s1.nameEl.style.getPropertyValue('width') === '');

  // M6 空位不足 24px ⇒ 一个字都不动
  const s2 = scene(10, 288);
  const r2 = m.widenNameColumn(s2.nameEl);
  ok('M6 空位不足 ⇒ no-gap', r2 === 'no-gap', '得到 ' + r2);
  ok('M7 没写任何列宽', s2.col1.style.getPropertyValue('width') === '' && s2.td.style.getPropertyValue('width') === '');

  // M8 连 td 都找不到（不是表格结构）⇒ no-cell
  const orphan = new FakeEl({ text: '加厚保暖羊毛围巾女秋冬款' });
  ok('M8 找不到格子 ⇒ no-cell', m.widenNameColumn(orphan) === 'no-cell');

  // M9 已加宽后再调一次：目标宽一致 ⇒ 幂等返回 done
  ok('M9 幂等：已加宽 ⇒ done 且不重复写', m.widenNameColumn(s1.nameEl) === 'done');

  // M10 平台重渲染把列宽洗回去 ⇒ 自动重写
  s1.col1.style.removeProperty('width');
  s1.th1.style.removeProperty('width');
  s1.td.style.removeProperty('width');
  ok('M10 列宽被洗掉 ⇒ 重新加宽', m.widenNameColumn(s1.nameEl) === 'done' && s1.col1.style.getPropertyValue('width') === '484px',
    s1.col1.style.getPropertyValue('width'));

  // M11 关开关还原
  m.restoreColumns();
  ok('M11 还原列宽（col / th / td 全清）',
    s1.col1.style.getPropertyValue('width') === '' && s1.th1.style.getPropertyValue('width') === '' &&
    s1.td.style.getPropertyValue('width') === '');
  line('M1~M11 列宽加宽与还原', true);
}

/* ---------- N. 格子识别退路 ---------- */
group('N. 格子识别：td 之外的两条退路');
{
  const m = buildModule();
  const own = new FakeEl({ tag: 'td' });
  const elInTd = new FakeEl({});
  elInTd.parentElement = own;
  ok('N1 在 td 里 ⇒ 认 td', m.cellOf(elInTd) === own);

  // 没有 td：靠 role=gridcell
  const cell = new FakeEl({ attrs: { role: 'gridcell' } });
  const el2 = new FakeEl({});
  el2.parentElement = cell;
  ok('N2 没有 td，靠 role=gridcell 认格子', m.cellOf(el2) === cell);

  // 没有 td 也没有 role：靠 display:table-cell
  const tc = new FakeEl({ cs: { display: 'table-cell' } });
  const el3 = new FakeEl({});
  el3.parentElement = tc;
  ok('N3 靠 display:table-cell 认格子', m.cellOf(el3) === tc);

  ok('N4 都没有 ⇒ null（不乱认）', m.cellOf(new FakeEl({})) === null);
  line('N1~N4 格子识别', true);
}

/* ---------- O. 解除格子内部的宽度上限 ---------- */
group('O. 解除格子内部的宽度上限（两行仍被省略的根因之一）');
{
  const m = buildModule();
  const cell = new FakeEl({ tag: 'td', rect: rectOf(0, 0, 400, 60) });
  const wrap = new FakeEl({ cs: { display: 'block', maxWidth: '240px', width: '240px' } });
  const nameEl = new FakeEl({ cs: { display: 'block', maxWidth: 'none', width: '240px' } });
  nameEl.parentElement = wrap;
  wrap.parentElement = cell;

  const touched = m.releaseWidthCaps(nameEl, cell);
  ok('O1 动了两层（包裹层与名称元素本身）', touched === 2, '得到 ' + touched);
  ok('O2 包裹层 max-width 解除', wrap.style.getPropertyValue('max-width') === 'none');
  ok('O3 包裹层固定宽交还 auto', wrap.style.getPropertyValue('width') === 'auto');
  ok('O4 名称元素也解除固定宽', nameEl.style.getPropertyValue('width') === 'auto');
  ok('O5 记进待还原表', m.cappedEls.length === 2, '得到 ' + m.cappedEls.length);

  m.restoreCaps();
  ok('O6 关开关还原（内联的 max-width / width 都清掉，回到类样式）',
    wrap.style.getPropertyValue('max-width') === '' && wrap.style.getPropertyValue('width') === '',
    JSON.stringify([wrap.style.getPropertyValue('max-width'), wrap.style.getPropertyValue('width')]));

  // O7 已经铺满格子的容器不动
  const cell2 = new FakeEl({ tag: 'td', rect: rectOf(0, 0, 400, 60) });
  const wide = new FakeEl({ cs: { display: 'block', maxWidth: 'none', width: '398px' } });
  wide.parentElement = cell2;
  ok('O7 本来就铺满 ⇒ 一处都不动', m.releaseWidthCaps(wide, cell2) === 0);
  line('O1~O7 解除宽度上限', true);
}

/* ---------- P. 写了但列宽没变 ---------- */
group('P. 列宽写不进去时不空转');
{
  const m = buildModule();
  const nameEl = new FakeEl({ text: '加厚保暖羊毛围巾女秋冬款' });
  const td = new FakeEl({ tag: 'td', rect: rectOf(100, 100, 288, 60) });
  td.cellIndex = 1;
  /* 关键：这个 td 不会因为写 width 而变宽（模拟被平台强制重排接管） */
  td.style.setProperty = function (p, v, pri) { this._m[p] = String(v); this._p[p] = pri || ''; };
  const table = new FakeEl({ tag: 'table', rect: rectOf(0, 80, 1000, 400) });
  table._sel = {};
  table.parentElement = new FakeEl({ rect: rectOf(0, 80, 1200, 400) });
  td.parentElement = table;
  td.children = [nameEl];
  nameEl.parentElement = td;

  const r = m.widenNameColumn(nameEl);
  ok('P1 写完宽度没变 ⇒ no-effect（不谎报 done）', r === 'no-effect', '得到 ' + r);
  ok('P2 记成 no-effect 后不再重复写', m.widenNameColumn(nameEl) === 'no-effect');
  line('P1/P2 写不进去的兜底', true);
}

/* ---------- R. 鼠标悬停的那一块一个字都不写（治抖第二版） ---------- */
group('R. 悬停中的行/卡片一律不写');
{
  const m = buildModule({ on: true });

  const el = new FakeEl({ text: '加厚保暖羊毛围巾女秋冬款', cs: { whiteSpace: 'nowrap' }, sw: 420, cw: 288, sh: 40, ch: 20 });
  const row = new FakeEl({ children: [el] });
  el.parentElement = row;
  row.__dycNameEl = el;

  m.__setRows([row]);
  m.__setHover(row);
  ok('R1 鼠标停在这一行 ⇒ 扫描不动它', m.scan() === 0);
  ok('R2 一个状态属性都没打（平台切换布局期间不写）',
    el.getAttribute('data-dyc-nameopen') === null && el.getAttribute('data-dyc-namecap') === null);
  ok('R3 也没有内联写入', el.style.getPropertyValue('white-space') === '');

  m.__setHover(null);
  ok('R4 鼠标离开 ⇒ 正常处理（补上）', m.scan() === 1 && el.getAttribute('data-dyc-nameopen') === '1');

  /* 平台新版商品卡：名称的父链可能不是 tr，悬停在"包着名称的卡片"上一样要跳过 */
  const m2 = buildModule({ on: true });
  const el2 = new FakeEl({ text: '加厚保暖羊毛围巾女秋冬款', cs: { whiteSpace: 'nowrap' }, sw: 420, cw: 288, sh: 40, ch: 20 });
  const row2 = new FakeEl({ children: [el2] });
  el2.parentElement = row2;
  row2.__dycNameEl = el2;
  const card = new FakeEl({ text: '商品卡' });
  card.children = [el2];
  el2.parentElement = card;

  m2.__setRows([row2]);
  m2.__setHover(card);
  ok('R5 悬停在包着名称的卡片上（卡片不在 tr 内）⇒ 也不写', m2.scan() === 0);

  m2.__setHover(null);
  ok('R6 离开后照常处理', m2.scan() === 1);

  ok('R7 isRelated 认自身 / 祖先 / 后代，不相关的返回 false',
    m2.isRelated(card, el2) === true && m2.isRelated(el2, card) === true &&
    m2.isRelated(el2, el2) === true && m2.isRelated(el2, row) === false);

  // 自家控件上的悬停不算（点调试面板不该让整页停摆）
  const m3 = buildModule({ on: true });
  m3.onHoverIn({ target: new FakeEl({ id: 'dyb-debug-panel' }) });
  ok('R8 自家控件上的悬停不算悬停商品', m3.hoverTarget === null);

  /* 列宽是表级的：鼠标在页面上任何地方，都不许趁 hover 重排去改列宽 */
  const m4 = buildModule({ on: true });
  const nameEl = new FakeEl({ text: '加厚保暖羊毛围巾女秋冬款', cs: { whiteSpace: 'nowrap' }, sw: 420, cw: 288, sh: 40, ch: 20 });
  const td = new FakeEl({ tag: 'td', rect: rectOf(100, 100, 288, 60) });
  td.cellIndex = 1;
  const th0 = new FakeEl({ tag: 'th' });
  const th1 = new FakeEl({ tag: 'th' });
  const table = new FakeEl({ tag: 'table', rect: rectOf(0, 80, 1000, 400) });
  table.tHead = { rows: [{ cells: [th0, th1] }] };
  table._sel = { 'colgroup > col': [new FakeEl({ tag: 'col' }), new FakeEl({ tag: 'col' })] };
  const box = new FakeEl({ rect: rectOf(0, 80, 1200, 400) });   // 空位 200px，够加宽
  table.parentElement = box;
  const row4 = new FakeEl({ children: [td] });
  td.parentElement = row4;
  td.children = [nameEl];
  nameEl.parentElement = td;
  row4.parentElement = table;
  row4.__dycNameEl = nameEl;

  m4.__setRows([row4]);
  m4.__setHover(new FakeEl({ text: '页面别处' }));
  m4.scan();
  ok('R9 鼠标在页面别处 ⇒ 列宽一个字都不动（表级重排同理）', table.__dycWideState !== 'done');

  m4.__setHover(null);
  m4.scan();
  ok('R10 鼠标离开后才加宽', table.__dycWideState === 'done');
  line('R1~R10 悬停不写', true);
}

/* ---------- S. 块高锁：宽度变了行高不变（治「指上去折成三行」） ---------- */
group('S. 块高锁');
{
  const m = buildModule();
  const css = String(m.CSS);

  // 自然 2 行 ⇒ 锁 2 行高
  const two = new FakeEl({ text: '加厚保暖羊毛围巾女秋冬款', cs: { whiteSpace: 'nowrap', lineHeight: '20px' }, sw: 420, cw: 288, sh: 40, ch: 20 });
  m.applyUnclip(two, 'nowrap');
  ok('S1 两行 ⇒ 打 h="2"', two.getAttribute('data-dyc-nameh') === '2');

  // 自然 3 行 ⇒ 锁 3 行高
  const three = new FakeEl({ text: '加厚保暖羊毛围巾女秋冬款', cs: { whiteSpace: 'nowrap', lineHeight: '20px' }, sw: 420, cw: 288, sh: 60, ch: 20 });
  m.applyUnclip(three, 'nowrap');
  ok('S2 三行 ⇒ 打 h="3"', three.getAttribute('data-dyc-nameh') === '3');

  // 超过三行 ⇒ 交给 CAP，摘掉块高锁（两套高度规则不许打架）
  const four = new FakeEl({ text: '加厚保暖羊毛围巾女秋冬款', cs: { whiteSpace: 'nowrap', lineHeight: '20px' }, sw: 420, cw: 288, sh: 80, ch: 20 });
  m.applyUnclip(four, 'nowrap');
  ok('S3 超三行 ⇒ 走 CAP、不留块高锁',
    four.getAttribute('data-dyc-namecap') === '1' && four.getAttribute('data-dyc-nameh') === null);

  ok('S4 CSS 里 h2 / h3 有固定高度（宽度再怎么变盒子都不动）',
    /\[data-dyc-nameh="2"\] \{ height: 3\.1em !important/.test(css) &&
    /\[data-dyc-nameh="3"\] \{ height: 4\.65em !important/.test(css));
  ok('S5 块高锁用 border-box + overflow:hidden（裁在盒子里，不顶出行高）',
    /\[data-dyc-nameh\] \{ box-sizing: border-box !important; overflow: hidden !important/.test(css));

  /* ★ 悬停期间节点被平台换新：锁必须能按缓存行数补回来，且不许重新测量 */
  const m2 = buildModule({ on: true });
  const el = new FakeEl({ text: '加厚保暖羊毛围巾女秋冬款', cs: { whiteSpace: 'nowrap' }, sw: 420, cw: 288, sh: 40, ch: 20 });
  const row = new FakeEl({ children: [el] });
  el.parentElement = row;
  row.__dycNameEl = el;
  el.__dycNameLines = 2;                 // 之前解算好的行数
  m2.__setRows([row]);
  m2.__setHover(row);                    // 鼠标正指着这一行
  m2.scan();
  ok('S6 ★ 悬停中锁丢了 ⇒ 按缓存行数补回（不重量）',
    el.getAttribute('data-dyc-nameh') === '2' && el.getAttribute('data-dyc-nameopen') === '1');
  ok('S7 补锁不碰宽度 / 不改内联', el.style.getPropertyValue('width') === '' && el.style.getPropertyValue('height') === '');

  // 关开关把锁也摘掉
  m2.restoreOne(el);
  ok('S8 关开关摘块高锁（页面回到平台原样）', el.getAttribute('data-dyc-nameh') === null);
  line('S1~S8 块高锁', true);
}

/* ============================================================
 * 5. 汇总
 * ============================================================ */

process.stdout.write('\n────────────────────────────────────────\n');
if (failures.length) {
  process.stdout.write('失败 ' + failures.length + ' 条，通过 ' + pass + ' 条：\n');
  for (const f of failures) process.stdout.write('  ✗ ' + f + '\n');
  process.exit(1);
}
process.stdout.write('全部通过：' + pass + ' 条断言\n');
