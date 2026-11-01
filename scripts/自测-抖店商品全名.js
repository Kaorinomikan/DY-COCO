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
  'textOf', 'isOurNode', 'truncationReason', 'looksLikeName', 'findNameInRow',
  'backupOf', 'setProp', 'applyUnclip', 'naturalLines', 'capLines',
  'restoreOne', 'refreshName', 'restoreStyleProp', 'restoreOneTable',
  'restoreColumns', 'cellOf', 'noteFact', 'releaseOneWidth', 'releaseWidthCaps',
  'restoreCaps', 'widenNameColumn',
  'rowAlive', 'collectRows', 'scan'
];
const VAR_NAMES = [
  'MARK', 'SCAN_DEBOUNCE', 'SCAN_MAX_WAIT', 'BOOT_DELAYS', 'NODE_BUDGET',
  'NAME_MIN_LEN', 'NAME_MAX_LEN', 'NOT_NAME_RE', 'NUMERIC_RE', 'ACTION_RE',
  'MAX_LINES', 'WIDEN_MIN_GAP', 'WIDEN_KEEP',
  'on', 'observer', 'bootTimers', 'debounceTimer', 'queuedAt', 'rowCache',
  'appliedAt', 'widenedTables', 'cappedEls', 'resizeBound'
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
    'function __setRows(r) { rowCache = r; }'
  ].join('\n');
  /* ⚠️ prelude 必须排在变量声明**之后**：源码里 `var on = false;` 自带初始值，
   *    放在它前面会被这一句覆盖掉（第一版就写反了，两条行缓存用例全红）。 */
  const body = parts.join('\n') + '\n' + prelude + '\nreturn {' +
    FN_NAMES.concat(VAR_NAMES).concat(['__setRows']).join(',') + '};';
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

/* ---------- F. 按原因写最少一组属性 ---------- */
group('F. 按截断原因写属性（不写死宽高）');
{
  const m = buildModule();
  const el = new FakeEl({ text: '加厚保暖羊毛围巾女秋冬款', cs: { whiteSpace: 'nowrap' }, sw: 420, cw: 288, sh: 40, ch: 20 });
  const wrote = m.applyUnclip(el, 'nowrap');
  ok('F1 nowrap ⇒ 写 white-space:normal', el.style.getPropertyValue('white-space') === 'normal');
  ok('F2 去掉省略号', el.style.getPropertyValue('text-overflow') === 'clip');
  ok('F3 放开 overflow', el.style.getPropertyValue('overflow') === 'visible');
  ok('F4 补折行规则', el.style.getPropertyValue('word-break') === 'normal' && el.style.getPropertyValue('overflow-wrap') === 'break-word');
  ok('F5 打上标记', el.getAttribute('data-dyc-shopname') === '1');
  ok('F6 没有设 width / max-width（列宽归平台）',
    el.style.getPropertyValue('width') === '' && el.style.getPropertyValue('max-width') === '');
  ok('F7 真正写了 ⇒ 返回 true', wrote === true);

  // clamp 型另一组
  const el2 = new FakeEl({ text: '很长的商品名称', cs: { display: '-webkit-box', webkitLineClamp: '2' } });
  m.applyUnclip(el2, 'clamp');
  ok('F8 clamp ⇒ display:block + line-clamp:none',
    el2.style.getPropertyValue('display') === 'block' &&
    el2.style.getPropertyValue('-webkit-line-clamp') === 'none');

  // 不认识的 reason ⇒ 什么都不写
  const el3 = new FakeEl({ text: '很长的商品名称' });
  ok('F9 reason 为空 ⇒ 不写、返回 false', m.applyUnclip(el3, '') === false && el3.getAttribute('data-dyc-shopname') === null);
  line('F1~F9 属性写入', true);
}

/* ---------- G. 备份只做一次 ---------- */
group('G. 备份只做一次');
{
  const m = buildModule();
  const el = new FakeEl({ text: '加厚保暖羊毛围巾女秋冬款', cs: { whiteSpace: 'nowrap' }, sw: 420, cw: 288, sh: 40, ch: 20 });
  // 平台原本就有一条内联 white-space（非 important），备份要能记住它
  el.style.setProperty('white-space', 'nowrap', '');
  m.applyUnclip(el, 'nowrap');
  const bakFirst = JSON.parse(JSON.stringify(el.__dycShopNameOrig));
  ok('G1 备份记下平台原值', bakFirst['white-space'] && bakFirst['white-space'].v === 'nowrap', JSON.stringify(bakFirst['white-space']));

  // 第二次（补涂）不许覆盖备份 —— 否则会把我们自己写的 normal 当成「原值」
  m.applyUnclip(el, 'nowrap');
  const bakSecond = JSON.parse(JSON.stringify(el.__dycShopNameOrig));
  ok('G2 重复写不覆盖备份', bakSecond['white-space'].v === 'nowrap', JSON.stringify(bakSecond['white-space']));
  line('G1/G2 备份幂等', true);
}

/* ---------- H. 幂等：洗完再补 ---------- */
group('H. 平台洗掉 style 后自动补涂');
{
  const m = buildModule();
  const el = new FakeEl({ text: '加厚保暖羊毛围巾女秋冬款', cs: { whiteSpace: 'nowrap' }, sw: 420, cw: 288, sh: 40, ch: 20 });
  ok('H1 仍截断 ⇒ 补涂返回 true', m.refreshName(el) === true);
  ok('H2 补涂后会写样式', el.style.getPropertyValue('white-space') === 'normal');

  // 模拟平台重渲染：样式被洗掉，计算值回到 nowrap
  const wiped = new FakeEl({ text: '加厚保暖羊毛围巾女秋冬款', cs: { whiteSpace: 'nowrap' }, sw: 420, cw: 288, sh: 40, ch: 20 });
  wiped.__dycShopNameOrig = { 'white-space': { v: '', p: '' } };
  ok('H3 已标记但计算值仍截断 ⇒ 重写一遍', m.refreshName(wiped) === true && wiped.style.getPropertyValue('white-space') === 'normal');

  // 已经放开了 ⇒ 不再动
  const okEl = new FakeEl({ text: '短名', cs: { whiteSpace: 'normal' }, sw: 100, cw: 288 });
  ok('H4 已不截断 ⇒ false（不重复写入）', m.refreshName(okEl) === false);
  line('H1~H4 幂等补涂', true);
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
  ok('J1 展开后是 normal', el.style.getPropertyValue('white-space') === 'normal');

  m.restoreOne(el);
  ok('J2 还原成平台原值 nowrap', el.style.getPropertyValue('white-space') === 'nowrap', el.style.getPropertyValue('white-space'));
  ok('J3 标记已清', el.getAttribute('data-dyc-shopname') === null);
  ok('J4 备份已释放', !el.__dycShopNameOrig);
  line('J1~J4 还原', true);
}

/* ---------- K. 源码红线 ---------- */
group('K. 源码红线');
{
  const src = fs.readFileSync(SRC_PATH, 'utf8');
  ok('K1 只用 setProperty 写内联（老内核也不怕驼峰写错）', /style\.setProperty\(prop, value/.test(src));
  ok('K2 有「重复写不覆盖备份」的实现', /hasOwnProperty\.call\(bak, prop\)/.test(src));
  ok('K3 列宽只经 setProperty 写（col / 表头 TH / 单元格三处），不写 .style.width =',
    !/\.style\.width\s*=/.test(src) && !/td\.style\.width/.test(src) &&
    /style\.setProperty\('width'/.test(src));
  ok('K4 有开关键 shopListNameWrap 的读取与订阅', /shopListNameWrap/.test(src) && /dycWatchFlags/.test(src));
  ok('K5 观察器挂在 body 且只排一次防抖', /observer\.observe\(document\.body/.test(src) && /scheduleScan\(\)/.test(src));
  ok('K6 防抖配最长等待（列表页 DOM 一直在动）', /SCAN_MAX_WAIT/.test(src) && /now - queuedAt >= SCAN_MAX_WAIT/.test(src));

  /* 2026-11-01 用户：「这个功能不需要弹提示」——
   * 排版类改动一律静默生效，只保留用户主动切开关时那句「已开启 / 已关闭」。
   * 这两条是防回潮的闸门：以后谁再往生效路径里塞 toast，自测立刻红。 */
  const scanBody = (src.match(/function scan\(\)\s*\{[\s\S]*?\n  \}/) || [''])[0];
  ok('K7 生效路径（scan）体内不出现 toast', scanBody.length > 0 && !/toast\(/.test(scanBody));
  ok('K8 全文只剩一处 toast —— 开关切换的回执', (src.match(/toast\(/g) || []).length === 1);
  line('K1~K8 源码红线（含「不弹提示」）', true);
}

/* ---------- L. 两行优先、最多三行 ---------- */
group('L. 两行优先、最多三行');
{
  const m = buildModule();

  // 自然 2 行 ⇒ 一个字不藏
  const two = new FakeEl({ text: '加厚保暖羊毛围巾女秋冬款', cs: { whiteSpace: 'nowrap', lineHeight: '20px' }, sw: 420, cw: 288, sh: 40, ch: 20 });
  ok('L1 自然行数 = 2', m.naturalLines(two) === 2, '得到 ' + m.naturalLines(two));
  m.applyUnclip(two, 'nowrap');
  ok('L2 两行装得下 ⇒ 不钳（不写 line-clamp）',
    two.style.getPropertyValue('-webkit-line-clamp') === '', JSON.stringify(two.style.getPropertyValue('-webkit-line-clamp')));

  // 自然 3 行 ⇒ 也完整显示（2026-11-01 两次截图都卡在「两行差几个字」）
  const three = new FakeEl({ text: '加厚保暖羊毛围巾女秋冬款', cs: { whiteSpace: 'nowrap', lineHeight: '20px' }, sw: 420, cw: 288, sh: 60, ch: 20 });
  ok('L3 自然行数 = 3', m.naturalLines(three) === 3, '得到 ' + m.naturalLines(three));
  m.applyUnclip(three, 'nowrap');
  ok('L4 ★ 三行装得下 ⇒ 不钳（这一条就是「有些还是不完整」的修复点）',
    three.style.getPropertyValue('-webkit-line-clamp') === '', JSON.stringify(three.style.getPropertyValue('-webkit-line-clamp')));

  // 自然 4 行 ⇒ 钳到三行
  const four = new FakeEl({ text: '加厚保暖羊毛围巾女秋冬款', cs: { whiteSpace: 'nowrap', lineHeight: '20px' }, sw: 420, cw: 288, sh: 80, ch: 20 });
  ok('L5 自然行数 = 4', m.naturalLines(four) === 4, '得到 ' + m.naturalLines(four));
  m.applyUnclip(four, 'nowrap');
  ok('L6 超三行 ⇒ 钳制：display:-webkit-box', four.style.getPropertyValue('display') === '-webkit-box', four.style.getPropertyValue('display'));
  ok('L7 写入 -webkit-line-clamp:3', four.style.getPropertyValue('-webkit-line-clamp') === '3', four.style.getPropertyValue('-webkit-line-clamp'));
  ok('L8 带省略号', four.style.getPropertyValue('text-overflow') === 'ellipsis');
  ok('L9 老内核兜底 max-height 有限值', parseFloat(four.style.getPropertyValue('max-height')) > 0, four.style.getPropertyValue('max-height'));
  ok('L10 超三行时 capLines 返回 true', m.capLines(four) === true);

  // 单行不钳
  const one = new FakeEl({ text: '短名', cs: { whiteSpace: 'normal', lineHeight: '20px' }, sh: 20, ch: 20 });
  ok('L11 单行 ⇒ 不钳', m.capLines(one) === false);
  line('L1~L11 两行优先三行兜底', true);
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
