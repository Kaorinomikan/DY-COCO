/**
 * 小红书千帆 · 商品名完整显示（2026-11-17 夜建）
 * ============================================================
 * 被测文件：src/live/xhs-ark-name-wrap.js、
 *           src/content/flags.js（新开关 xhsShopNameWrap / 分组 xhsShop）、
 *           manifest.json（注入位置）
 *
 * 背景：用户 2026-11-17「小红书千帆商店，也做商品名称不折叠的功能」。
 *   千帆（ark）没有结构报告，脚本改成**运行时探测**不写死类名 ——
 *   所以这份自测的重点不是「类名对不对」，而是**会不会误伤**：
 *   误伤的代价是整页布局变形且用户看不懂，比漏做严重得多。
 *
 * 覆盖：
 *   A. 页面判定 —— 只认 ark /app-item/list/，中控台与 ark 其它页不生效
 *   B. 三段判据 —— 折叠且溢出 + 像名称 + 附近有商品图，缺一不标
 *   C. 生命周期 —— 幂等、React 重建补扫、祖先让位、开关关掉整片还原
 *   D. 接线 —— 开关元数据 / 分组被平台认领 / manifest 位置 / 不许同步取 Flags
 *
 * 做法：jsdom + 受控几何（clientHeight/scrollHeight 恒为 0，必须显式给值）
 *   + getComputedStyle 局部覆盖（jsdom 不实现 -webkit-line-clamp）。
 *   与 scripts/自测-小红书滚钮与名称.js 同风格：断言只约束最终行为。
 *
 * 用法：node scripts/自测-千帆商品名.js  （退出码 0 = 全绿）
 * ============================================================
 */
'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert/strict');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const SRC = read('src/live/xhs-ark-name-wrap.js');
const MANIFEST = JSON.parse(read('manifest.json'));

const ARK_URL = 'https://ark.xiaohongshu.com/app-item/list/shelf';
const RETURN_URL = 'https://ark.xiaohongshu.com/app-order/logistics/multiaddress/edit/1198685';
const NAME_ATTR = 'data-dyc-ark-name';
const HOST_ATTR = 'data-dyc-ark-name-host';
const STYLE_ID = 'dyc-xhs-ark-name-style';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let pass = 0;
function ok(name) { pass++; console.log('  ✓ ' + name); }
async function check(name, fn) {
  try { await fn(); ok(name); }
  catch (e) { console.log('  ✗ ' + name + '\n     ' + (e && e.message)); throw e; }
}

/** 受控几何（jsdom 里这些属性恒为 0） */
function geo(el, o) {
  ['clientHeight', 'scrollHeight', 'clientWidth', 'scrollWidth'].forEach((k) => {
    Object.defineProperty(el, k, { value: o[k] === undefined ? 0 : o[k], configurable: true });
  });
  return el;
}

/** 局部覆盖 getComputedStyle：只改指定元素的指定属性，其余走真实现 */
function stubStyle(win, table) {
  const real = win.getComputedStyle.bind(win);
  win.getComputedStyle = function (el) {
    const base = real(el);
    const over = table.get(el);
    if (!over) return base;
    return new Proxy(base, {
      get(t, p) {
        if (p === 'getPropertyValue') {
          return (n) => (n in over ? String(over[n]) : t.getPropertyValue(n));
        }
        if (p in over) return over[p];
        const v = t[p];
        return typeof v === 'function' ? v.bind(t) : v;
      }
    });
  };
}

function makeDom(html, url) {
  const dom = new JSDOM(html, {
    url: url || ARK_URL,
    pretendToBeVisual: true,
    runScripts: 'outside-only'
  });
  const win = dom.window;
  win.DYC_PAGE_PATTERNS = {
    xhsArkList: /^https:\/\/ark\.xiaohongshu\.com\/app-item\/list\//,
    xhsArkReturn: /^https:\/\/ark\.xiaohongshu\.com\/app-order\/logistics\/multiaddress\//,
    xhsCtrl: /^https:\/\/pgy\.xiaohongshu\.com\/commerce\/redlive\//
  };
  win.__watchers = [];
  win.__flags = {};
  win.__diag = [];
  win.__dycDiag = { note: (a, d, r) => win.__diag.push({ a, d, r }) };
  /* ★ mock 签名必须与真实一致：dycReadFlags() 返回 **Promise**（flags.js）。
   *   2026-11-17 已有一次事故：mock 成同步返回 ⇒ 13 条断言全绿、真机全黑。 */
  win.dycReadFlags = () => Promise.resolve(win.__flags);
  win.dycWatchFlags = (cb) => { win.__watchers.push(cb); };
  return { dom, win, doc: win.document };
}

function buildCard(doc, opts) {
  const o = opts || {};
  const card = doc.createElement('div');
  card.className = 'card-wrapper';
  card.innerHTML = '<a class="pic"><img src="x.jpg"></a>'
    + '<div class="info">'
    + '<div class="name">' + (o.text || '2026秋冬新款加厚羊毛混纺大衣女中长款过膝显瘦外套') + '</div>'
    + '</div>';
  doc.body.appendChild(card);
  return card;
}

/** 把名称元素做成「被 clamp 两行截断」的样子 */
function clampName(win, nameEl, table) {
  geo(nameEl, { clientHeight: 44, scrollHeight: 132, clientWidth: 260, scrollWidth: 260 });
  table.set(nameEl, {
    overflow: 'hidden',
    overflowY: 'hidden',
    textOverflow: 'clip',
    maxHeight: '44px',
    height: '44px',
    '-webkit-line-clamp': '2'
  });
}

/** 按 2026-11-17 23:18 结构报告造一行真实形态：表格固定左列 + product-main 名称 */
function buildArkRow(doc, opts) {
  const o = opts || {};
  const mainCls = o.mainCls || 'product-main';
  const tr = doc.createElement('tr');
  tr.innerHTML = '<td class="d-table__cell--fixed-left">'
    + '<div class="d-table__cell">'
    + '<div class="d-space d-space-horizontal d-space-small">'
    + '<div class="product-pic"><img src="x.jpg"></div>'
    + '<div class="' + mainCls + '">'
    + '<span class="d-text d-text-block">2026秋冬新款加厚羊毛混纺大衣女中长款过膝显瘦外套</span>'
    + '</div></div></div></td>';
  const table = doc.createElement('table');
  const tbody = doc.createElement('tbody');
  tbody.appendChild(tr);
  table.appendChild(tbody);
  doc.body.appendChild(table);
  return tr;
}

/** 真机实测的截断形态：268 可见宽 / 492 文本宽、22 高、ellipsis + nowrap */
function foldArkName(win, tr, table) {
  const name = tr.querySelector('span.d-text.d-text-block');
  geo(name, { clientHeight: 22, scrollHeight: 22, clientWidth: 268, scrollWidth: 492 });
  table.set(name, {
    overflow: 'hidden',
    overflowY: 'hidden',
    textOverflow: 'ellipsis',
    maxHeight: 'none',
    height: '22px',
    '-webkit-line-clamp': '1'
  });
  return name;
}

/** 按 2026-11-17 23:25 结构报告造一张退货页 SKU 卡（200 宽名称、ellipsis + nowrap） */
function buildReturnCard(doc, opts) {
  const o = opts || {};
  const main = doc.createElement('div');
  main.className = 'sku-card-container padding-3-t-b';
  main.innerHTML =
    '<div class="d-space d-space-horizontal d-space-align-center">'
    + '<img class="sku-img" src="x.jpg">'
    + '<div>'
    + '<div class="' + (o.rowCls || 'd-space d-space-horizontal d-space-default') + '">'
    + '<span class="d-text --color-text-paragraph --size-text-paragraph">'
    + '2026秋冬新款加厚羊毛混纺大衣女中长款过膝显瘦外套</span>'
    + '</div>'
    + '<div class="sku-id">商品ID：6a2f3c8d9e1b2a3c</div>'
    + '</div></div>';
  doc.body.appendChild(main);
  return main;
}

/** 真机形态：200 可见宽 / 419 文本宽、22 高、ellipsis + nowrap */
function foldReturnName(win, card, table) {
  const name = card.querySelector('span.d-text[class~="--color-text-paragraph"]');
  geo(name, { clientHeight: 22, scrollHeight: 22, clientWidth: 200, scrollWidth: 419 });
  table.set(name, {
    overflow: 'hidden',
    overflowY: 'hidden',
    textOverflow: 'ellipsis',
    maxHeight: 'none',
    height: '22px',
    '-webkit-line-clamp': '1'
  });
  return name;
}

/** 真机形态：ID 行 200×20、文本宽 202 —— 只差省略号那几个像素 */
function foldReturnId(win, card, table) {
  const el = card.querySelector('.sku-id');
  geo(el, { clientHeight: 20, scrollHeight: 20, clientWidth: 200, scrollWidth: 202 });
  table.set(el, {
    overflow: 'hidden',
    overflowY: 'hidden',
    textOverflow: 'ellipsis',
    maxHeight: 'none',
    height: '20px',
    '-webkit-line-clamp': '1'
  });
  return el;
}

/* ============================================================
 * A. 页面判定
 * ============================================================ */
async function testPageScope() {
  console.log('\nA. 页面判定');

  await check('千帆商品列表：注入样式表，且解钳制规则齐全（含 !important 高度）', async () => {
    const { win, doc } = makeDom('<!doctype html><body></body>');
    const card = buildCard(doc);
    const table = new Map();
    clampName(win, card.querySelector('.name'), table);
    stubStyle(win, table);

    win.__flags = { xhsShopNameWrap: true };
    win.eval(SRC);
    await sleep(40);

    const st = doc.getElementById(STYLE_ID);
    assert.ok(st, '样式表没注入');
    const css = st.textContent;
    assert.ok(/-webkit-line-clamp:\s*unset !important/.test(css), '缺解钳制');
    assert.ok(/height:\s*auto !important/.test(css), '缺 height:auto');
    assert.ok(/max-height:\s*none !important/.test(css), '缺 max-height 解除');
    assert.ok(/text-overflow:\s*clip !important/.test(css), '缺省略号解除');
    assert.ok(/white-space:\s*normal !important/.test(css), '缺换行放开');
    win.close();
  });

  await check('样式表里有结构报告实测的类名直通规则（首选路径，不依赖标记）', async () => {
    /* 2026-11-17 23:18 结构报告：名称 = div.product-main > span.d-text.d-text-block，
     * 268 定宽、ellipsis + nowrap。这条规则在就是「React 怎么重渲染都改不掉」，
     * 只在 JS 里探测 = 把常态压在兜底路径上，性能与稳定性都更差。 */
    const { win, doc } = makeDom('<!doctype html><body></body>');
    win.__flags = { xhsShopNameWrap: true };
    win.eval(SRC);
    await sleep(40);
    const css = doc.getElementById(STYLE_ID).textContent;
    assert.ok(css.indexOf('div.product-main > span.d-text.d-text-block') > -1,
      '缺类名直通规则 —— 实测路径没写进样式表，等于只剩兜底');
    assert.ok(/div\.product-main\s*\{[\s\S]*?height:\s*auto !important/.test(css),
      'product-main 是 268×22 定高盒，不放高名称折行后仍被裁');
    win.close();
  });

  await check('中控台（pgy）页面：不注入、不标记', async () => {
    const { win, doc } = makeDom('<!doctype html><body></body>',
      'https://pgy.xiaohongshu.com/commerce/redlive/live_center_control');
    const card = buildCard(doc);
    const table = new Map();
    clampName(win, card.querySelector('.name'), table);
    stubStyle(win, table);

    win.__flags = { xhsShopNameWrap: true };
    win.eval(SRC);
    await sleep(40);
    assert.equal(doc.getElementById(STYLE_ID), null, '中控台不该有千帆的样式表');
    assert.equal(doc.querySelector('[' + NAME_ATTR + ']'), null, '中控台不该被标记');
    win.close();
  });

  await check('ark 其它页（/shop/detail）：同样不生效', async () => {
    const { win, doc } = makeDom('<!doctype html><body></body>',
      'https://ark.xiaohongshu.com/shop/detail');
    const card = buildCard(doc);
    const table = new Map();
    clampName(win, card.querySelector('.name'), table);
    stubStyle(win, table);

    win.__flags = { xhsShopNameWrap: true };
    win.eval(SRC);
    await sleep(40);
    assert.equal(doc.getElementById(STYLE_ID), null, '非商品列表页不该注入');
    win.close();
  });

  await check('退货策略页：注入样式表，含退货页名称规则与卡片让位', async () => {
    /* 2026-11-17 夜：用户「多地址退货页也要兼容名称不折叠」。
     * 这一页是另一个子应用，名称类名完全不同（见 23:25 结构报告）。 */
    const { win, doc } = makeDom('<!doctype html><body></body>', RETURN_URL);
    win.__flags = { xhsShopNameWrap: true };
    win.eval(SRC);
    await sleep(40);
    const st = doc.getElementById(STYLE_ID);
    assert.ok(st, '退货页没注入样式表');
    const css = st.textContent;
    assert.ok(css.indexOf('class~="--color-text-paragraph"') > -1, '缺退货页名称规则');
    assert.ok(/\.sku-card-container,\s*\n\.sku-card-container \.d-space-horizontal\s*\{[\s\S]*?height:\s*auto !important/.test(css),
      '退货页卡片与名称行要让高，否则折行后被裁');
    win.close();
  });
}

/* ============================================================
 * B. 三段判据（误伤是这里要挡住的）
 * ============================================================ */
async function testCriteria() {
  console.log('\nB. 三段判据');

  await check('折叠且溢出 + 附近有商品图 ⇒ 打标记', async () => {
    const { win, doc } = makeDom('<!doctype html><body></body>');
    const card = buildCard(doc);
    const name = card.querySelector('.name');
    const table = new Map();
    clampName(win, name, table);
    stubStyle(win, table);

    win.__flags = { xhsShopNameWrap: true };
    win.eval(SRC);
    await sleep(40);
    assert.equal(name.getAttribute(NAME_ATTR), '1', '该展开的名称没被标记');
    win.close();
  });

  await check('设了 overflow:hidden 但内容没溢出 ⇒ 不标记（不是折叠，不该动）', async () => {
    const { win, doc } = makeDom('<!doctype html><body></body>');
    const card = buildCard(doc);
    const name = card.querySelector('.name');
    const table = new Map();
    geo(name, { clientHeight: 44, scrollHeight: 44, clientWidth: 260, scrollWidth: 260 });
    table.set(name, {
      overflow: 'hidden', overflowY: 'hidden', textOverflow: 'ellipsis',
      maxHeight: '44px', height: '44px', '-webkit-line-clamp': '2'
    });
    stubStyle(win, table);

    win.__flags = { xhsShopNameWrap: true };
    win.eval(SRC);
    await sleep(40);
    assert.equal(name.getAttribute(NAME_ATTR), null, '没溢出就不是折叠，不该改它');
    win.close();
  });

  await check('附近没有商品图的长文本（侧栏/公告）⇒ 不标记', async () => {
    const { win, doc } = makeDom('<!doctype html><body>'
      + '<div class="notice"><span class="txt">平台公告：双十一活动规则与发货时效说明请注意查收</span></div>'
      + '</body>');
    const el = doc.querySelector('.txt');
    const table = new Map();
    geo(el, { clientHeight: 20, scrollHeight: 60, clientWidth: 200, scrollWidth: 200 });
    table.set(el, {
      overflow: 'hidden', overflowY: 'hidden', textOverflow: 'ellipsis',
      maxHeight: '20px', height: '20px', '-webkit-line-clamp': '1'
    });
    stubStyle(win, table);

    win.__flags = { xhsShopNameWrap: true };
    win.eval(SRC);
    await sleep(40);
    assert.equal(el.getAttribute(NAME_ATTR), null, '没有商品图的文本不该被当成商品名');
    win.close();
  });

  await check('价格 / 日期 / 纯数字即使被截断也不标记', async () => {
    const { win, doc } = makeDom('<!doctype html><body></body>');
    const card = buildCard(doc);
    const table = new Map();
    const strip = card.querySelector('.info');
    ['¥ 199.00 - 299.00', '2026-11-17 18:30:00', '123456789012'].forEach((t) => {
      const d = doc.createElement('div');
      d.className = 'meta';
      d.textContent = t;
      strip.appendChild(d);
      geo(d, { clientHeight: 20, scrollHeight: 40, clientWidth: 100, scrollWidth: 160 });
      table.set(d, {
        overflow: 'hidden', overflowY: 'hidden', textOverflow: 'ellipsis',
        maxHeight: '20px', height: '20px', '-webkit-line-clamp': '1'
      });
    });
    clampName(win, card.querySelector('.name'), table);
    stubStyle(win, table);

    win.__flags = { xhsShopNameWrap: true };
    win.eval(SRC);
    await sleep(40);
    const metas = doc.querySelectorAll('.meta');
    for (let i = 0; i < metas.length; i++) {
      assert.equal(metas[i].getAttribute(NAME_ATTR), null, '元信息不该被展开：' + metas[i].textContent);
    }
    assert.equal(card.querySelector('.name').getAttribute(NAME_ATTR), '1', '同卡的名称仍要展开');
    win.close();
  });

  await check('表头（thead）里被截断的文字不标记', async () => {
    const { win, doc } = makeDom('<!doctype html><body>'
      + '<table><thead><tr><th><span class="th-txt">商品名称与规格说明列标题</span></th></tr></thead>'
      + '<tbody><tr><td><img src="x.jpg"><div class="name">2026秋冬新款加厚羊毛混纺大衣女中款</div></td></tr></tbody>'
      + '</table></body>');
    const th = doc.querySelector('.th-txt');
    const name = doc.querySelector('.name');
    const table = new Map();
    [[th, 20], [name, 44]].forEach(([el, h]) => {
      geo(el, { clientHeight: h, scrollHeight: h + 40, clientWidth: 120, scrollWidth: 120 });
      table.set(el, {
        overflow: 'hidden', overflowY: 'hidden', textOverflow: 'clip',
        maxHeight: h + 'px', height: h + 'px', '-webkit-line-clamp': '2'
      });
    });
    stubStyle(win, table);

    win.__flags = { xhsShopNameWrap: true };
    win.eval(SRC);
    await sleep(40);
    assert.equal(th.getAttribute(NAME_ATTR), null, '表头不是商品名');
    assert.equal(name.getAttribute(NAME_ATTR), '1', '表格里的商品名要被展开（真实列表页形态）');
    win.close();
  });

  await check('单行省略号（text-overflow:ellipsis + 横向溢出）也能识别', async () => {
    const { win, doc } = makeDom('<!doctype html><body></body>');
    const card = buildCard(doc);
    const name = card.querySelector('.name');
    const table = new Map();
    geo(name, { clientHeight: 20, scrollHeight: 20, clientWidth: 120, scrollWidth: 320 });
    table.set(name, {
      overflow: 'hidden', overflowY: 'visible', textOverflow: 'ellipsis',
      maxHeight: 'none', height: '20px', '-webkit-line-clamp': '1'
    });
    stubStyle(win, table);

    win.__flags = { xhsShopNameWrap: true };
    win.eval(SRC);
    await sleep(40);
    assert.equal(name.getAttribute(NAME_ATTR), '1', '单行省略也是折叠，必须展开');
    win.close();
  });

  await check('表格单元格（td）自身即使被截断也不标记，只标记里面的名称元素', async () => {
    /* 展开规则含 display:block !important —— 打到 td 上就是把单元格变块级，
     * 整张表的列结构当场错乱。千帆列表很可能就是表格，这条必须钉住。 */
    const { win, doc } = makeDom('<!doctype html><body>'
      + '<table><tbody><tr>'
      + '<td class="cell"><img src="x.jpg">'
      + '<span class="name">2026秋冬新款加厚羊毛混纺大衣女中长款过膝显瘦</span></td>'
      + '</tr></tbody></table></body>');
    const td = doc.querySelector('.cell');
    const name = doc.querySelector('.name');
    const table = new Map();
    [[td, 44], [name, 44]].forEach(([el, h]) => {
      geo(el, { clientHeight: h, scrollHeight: h + 40, clientWidth: 200, scrollWidth: 200 });
      table.set(el, {
        overflow: 'hidden', overflowY: 'hidden', textOverflow: 'clip',
        maxHeight: h + 'px', height: h + 'px', '-webkit-line-clamp': '2'
      });
    });
    stubStyle(win, table);

    win.__flags = { xhsShopNameWrap: true };
    win.eval(SRC);
    await sleep(40);
    assert.equal(td.getAttribute(NAME_ATTR), null, 'td 绝不能被打标记（会把表格拆了）');
    assert.equal(name.getAttribute(NAME_ATTR), '1', '单元格里的名称该展开');
    win.close();
  });

  await check('真实结构（表格固定左列）：类名规则已管住，探测不再重复打标记', async () => {
    /* 造出「确实溢出」的形态，才能区分「因为类名覆盖而跳过」与
     * 「因为没溢出而跳过」—— 两者都表现为没标记，但只有前者是对的。 */
    const { win, doc } = makeDom('<!doctype html><body></body>');
    const tr = buildArkRow(doc);
    const table = new Map();
    const name = foldArkName(win, tr, table);
    stubStyle(win, table);

    win.__flags = { xhsShopNameWrap: true };
    win.eval(SRC);
    await sleep(40);
    assert.equal(name.getAttribute(NAME_ATTR), null,
      '已被类名直通规则覆盖，不该再打标记（否则诊断虚高、关开关多跑一遍清理）');
    win.close();
  });

  await check('平台把类名改掉（product-main → product-info）：探测兜底照样标记', async () => {
    const { win, doc } = makeDom('<!doctype html><body></body>');
    const tr = buildArkRow(doc, { mainCls: 'product-info' });
    const table = new Map();
    const name = foldArkName(win, tr, table);
    stubStyle(win, table);

    win.__flags = { xhsShopNameWrap: true };
    win.eval(SRC);
    await sleep(40);
    assert.equal(name.getAttribute(NAME_ATTR), '1',
      '类名直通落空时必须由探测接住 —— 否则平台一改类名就全黑');
    win.close();
  });

  await check('退货页商品 ID 行：用 break-all 展开，不能被名称那套 word-break:normal 套上', async () => {
    /* 商品 ID 是一长串无空格的字母数字：word-break:normal 根本断不开，
     * 放开省略号后仍是一整条被列宽截断的长串 —— 等于没做。 */
    const { win, doc } = makeDom('<!doctype html><body></body>', RETURN_URL);
    win.__flags = { xhsShopNameWrap: true };
    win.eval(SRC);
    await sleep(40);
    const css = doc.getElementById(STYLE_ID).textContent;
    const m = css.match(/\.sku-card-container\s+\.sku-id\s*\{([\s\S]*?)\}/);
    assert.ok(m, '缺商品 ID 行的展开规则');
    assert.ok(/word-break:\s*break-all !important/.test(m[1]), 'ID 必须 break-all，否则长串断不开');
    assert.ok(/overflow-wrap:\s*anywhere/.test(m[1]), '缺 anywhere 兜底');
    assert.ok(!/word-break:\s*normal/.test(m[1]), '被名称那套 normal 混进来了，ID 会顶出行外');
    assert.ok(/text-overflow:\s*clip/.test(m[1]), '缺省略号解除');
    win.close();
  });

  await check('退货页商品 ID 行已被类名规则覆盖 ⇒ 探测不再重复打标记', async () => {
    const { win, doc } = makeDom('<!doctype html><body></body>', RETURN_URL);
    const card = buildReturnCard(doc);
    const table = new Map();
    foldReturnName(win, card, table);
    const idEl = foldReturnId(win, card, table);
    stubStyle(win, table);

    win.__flags = { xhsShopNameWrap: true };
    win.eval(SRC);
    await sleep(40);
    assert.equal(idEl.getAttribute(NAME_ATTR), null,
      'ID 行已被类名规则管住；再打标记会套上 word-break:normal 把长串顶出去');
    win.close();
  });

  await check('退货页真实结构：类名规则已管住，探测不重复打标记', async () => {
    const { win, doc } = makeDom('<!doctype html><body></body>', RETURN_URL);
    const card = buildReturnCard(doc);
    const table = new Map();
    const name = foldReturnName(win, card, table);
    stubStyle(win, table);

    win.__flags = { xhsShopNameWrap: true };
    win.eval(SRC);
    await sleep(40);
    assert.equal(name.getAttribute(NAME_ATTR), null,
      '退货页名称已被类名规则覆盖，不该再打标记');
    win.close();
  });

  await check('退货页名称行类名被改：探测兜底照样标记', async () => {
    const { win, doc } = makeDom('<!doctype html><body></body>', RETURN_URL);
    const card = buildReturnCard(doc, { rowCls: 'd-space d-space-horizontal' });
    const table = new Map();
    const name = foldReturnName(win, card, table);
    stubStyle(win, table);

    win.__flags = { xhsShopNameWrap: true };
    win.eval(SRC);
    await sleep(40);
    assert.equal(name.getAttribute(NAME_ATTR), '1',
      '退货页类名直通落空时必须由探测接住，否则平台一改类名这页就全黑');
    win.close();
  });

  await check('已被折叠的祖先打让位标记，祖先的让位规则也在样式表里', async () => {
    const { win, doc } = makeDom('<!doctype html><body></body>');
    const card = buildCard(doc);
    const info = card.querySelector('.info');
    const name = card.querySelector('.name');
    const table = new Map();
    clampName(win, name, table);
    // 祖先：高度钉死 + overflow 裁剪 —— 正是「文字被压在盒子里」的形态
    table.set(info, {
      overflow: 'hidden', overflowY: 'hidden', textOverflow: 'clip',
      maxHeight: '60px', height: '60px'
    });
    stubStyle(win, table);

    win.__flags = { xhsShopNameWrap: true };
    win.eval(SRC);
    await sleep(40);
    assert.equal(info.getAttribute(HOST_ATTR), '1', '钳制祖先要让位，否则文字压到下一行');
    const css = doc.getElementById(STYLE_ID).textContent;
    assert.ok(new RegExp('\\[' + HOST_ATTR + '="1"\\]').test(css), '样样式表缺让位规则');
    win.close();
  });
}

/* ============================================================
 * C. 生命周期
 * ============================================================ */
async function testLifecycle() {
  console.log('\nC. 生命周期');

  await check('重复扫描幂等：已标记的不重复处理', async () => {
    const { win, doc } = makeDom('<!doctype html><body></body>');
    const card = buildCard(doc);
    const name = card.querySelector('.name');
    const table = new Map();
    clampName(win, name, table);
    stubStyle(win, table);

    win.__flags = { xhsShopNameWrap: true };
    win.eval(SRC);
    await sleep(40);
    assert.equal(name.getAttribute(NAME_ATTR), '1');

    // 触发一轮补扫：插一个无关节点
    card.appendChild(doc.createElement('span'));
    await sleep(500);
    assert.equal(doc.querySelectorAll('[' + NAME_ATTR + '="1"]').length, 1, '不该重复标记同名元素');
    win.close();
  });

  await check('平台重渲染（新节点）⇒ 补扫重新标记', async () => {
    const { win, doc } = makeDom('<!doctype html><body></body>');
    const card = buildCard(doc);
    const table = new Map();
    clampName(win, card.querySelector('.name'), table);
    stubStyle(win, table);

    win.__flags = { xhsShopNameWrap: true };
    win.eval(SRC);
    await sleep(40);

    // React 重建：整块 innerHTML 换掉，旧节点连标记一起消失
    const fresh = doc.createElement('div');
    fresh.className = 'name';
    fresh.textContent = '2026秋冬新款加厚羊毛混纺大衣女中长款过膝显瘦外套';
    card.querySelector('.info').innerHTML = '';
    card.querySelector('.info').appendChild(fresh);
    clampName(win, fresh, table);
    await sleep(500);

    assert.equal(fresh.getAttribute(NAME_ATTR), '1', '重建后必须补标，否则用户看到「又折回去了」');
    win.close();
  });

  await check('开关关掉：标记、让位标记、样式表整片还原', async () => {
    const { win, doc } = makeDom('<!doctype html><body></body>');
    const card = buildCard(doc);
    const info = card.querySelector('.info');
    const name = card.querySelector('.name');
    const table = new Map();
    clampName(win, name, table);
    table.set(info, { overflow: 'hidden', overflowY: 'hidden', textOverflow: 'clip', maxHeight: '60px', height: '60px' });
    stubStyle(win, table);

    win.__flags = { xhsShopNameWrap: true };
    win.eval(SRC);
    await sleep(40);
    assert.ok(doc.getElementById(STYLE_ID), '先确认已注入');

    win.__flags = { xhsShopNameWrap: false };
    win.__watchers.forEach((cb) => cb(win.__flags));
    await sleep(60);
    assert.equal(doc.getElementById(STYLE_ID), null, '样式表必须移除');
    assert.equal(doc.querySelector('[' + NAME_ATTR + ']'), null, '标记必须清干净');
    assert.equal(doc.querySelector('[' + HOST_ATTR + ']'), null, '让位标记也要清');
    win.close();
  });

  await check('再打开：重新标记（关掉不是一次性报废）', async () => {
    const { win, doc } = makeDom('<!doctype html><body></body>');
    const card = buildCard(doc);
    const name = card.querySelector('.name');
    const table = new Map();
    clampName(win, name, table);
    stubStyle(win, table);

    win.__flags = { xhsShopNameWrap: true };
    win.eval(SRC);
    await sleep(40);

    win.__flags = { xhsShopNameWrap: false };
    win.__watchers.forEach((cb) => cb(win.__flags));
    await sleep(60);
    assert.equal(name.getAttribute(NAME_ATTR), null);

    win.__flags = { xhsShopNameWrap: true };
    win.__watchers.forEach((cb) => cb(win.__flags));
    await sleep(60);
    assert.equal(name.getAttribute(NAME_ATTR), '1', '重新打开必须回到展开态');
    win.close();
  });

  await check('诊断有记录（便于下一轮按真实类名收敛）', async () => {
    const { win, doc } = makeDom('<!doctype html><body></body>');
    const card = buildCard(doc);
    const table = new Map();
    clampName(win, card.querySelector('.name'), table);
    stubStyle(win, table);

    win.__flags = { xhsShopNameWrap: true };
    win.eval(SRC);
    await sleep(40);
    const hit = win.__diag.filter((d) => d.a === '千帆名称展开');
    assert.ok(hit.length >= 1, '诊断里必须有「千帆名称展开」这条');
    assert.ok(/累计 1 个/.test(hit[hit.length - 1].d), '诊断要报累计标记数');
    win.close();
  });
}

/* ============================================================
 * D. 接线
 * ============================================================ */
function testWiring() {
  console.log('\nD. 接线');

  const flagsCode = read('src/content/flags.js');
  const vm = require('vm');
  /* 整段跑「纯数据区」：DYC_PLATFORMS 引用 DYC_PLAT_DY_URL_RE，DYC_PLATFORMS
   * 本身又含正则 —— 逐变量切片（找配对括号）会被正则里的量词括号带偏，
   * 干脆从 DYC_PAGE_PATTERNS 开始跑到 DYC_FLAGS_META 的 `];` 收尾，
   * 这一段全是数据定义、无副作用。 */
  const dataStart = flagsCode.indexOf('var DYC_PAGE_PATTERNS');
  assert.ok(dataStart > -1, '源码里没找到 var DYC_PAGE_PATTERNS');
  const storeKey = flagsCode.indexOf('var DYC_FLAGS_STORE_KEY');
  const dataEnd = flagsCode.lastIndexOf('];', storeKey) + 2;
  const ctx = vm.createContext({ console: { log() {} } });
  vm.runInContext(flagsCode.slice(dataStart, dataEnd), ctx);

  check('开关 xhsShopNameWrap：归 xhsShop 组、覆盖列表页与退货页、默认开', () => {
    const meta = ctx.DYC_FLAGS_META.find((m) => m.key === 'xhsShopNameWrap');
    assert.ok(meta, '缺开关 xhsShopNameWrap');
    assert.equal(meta.group, 'xhsShop', '应归小红书千帆组');
    // 2026-11-17 夜：用户「多地址退货页也要兼容名称不折叠」⇒ 一个开关跨两页
    // （同一个功能、用户视角同一个开关；另开键会让「关了列表页、退货页还展开」说不清）
    assert.deepEqual(Array.from(meta.pages), ['xhsArkList', 'xhsArkReturn'],
      '作用页应是商品列表 + 退货策略页');
    assert.equal(meta.default, true, '默认应开启');
  });

  check('分组表有 xhsShop，且被小红书平台认领', () => {
    assert.ok(ctx.DYC_FLAG_GROUPS.some((g) => g.id === 'xhsShop'), '缺 xhsShop 分组');
    const xhs = ctx.DYC_PLATFORMS.find((p) => p.id === 'xhs');
    assert.ok(xhs.groups.indexOf('xhsShop') > -1, '小红书平台没认领 xhsShop —— 那组在弹窗里永不出现');
  });

  check('分组表每一组都被某个平台认领（防新增组变成死卡）', () => {
    const claimed = new Set();
    ctx.DYC_PLATFORMS.forEach((p) => (p.groups || []).forEach((g) => claimed.add(g)));
    ctx.DYC_FLAG_GROUPS.forEach((g) => {
      assert.ok(claimed.has(g.id), '分组 ' + g.id + ' 没被任何平台认领');
    });
  });

  check('源码不得同步取用 dycReadFlags（它返回 Promise）', () => {
    const bare = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
    assert.ok(!/flags\s*=\s*dycReadFlags\(\)/.test(bare), '仍在同步取用，会拿到 Promise');
    assert.ok(/dycReadFlags\(\)\s*\.then/.test(bare), '没有走 .then');
  });

  check('manifest：脚本在 ark 注入条目里，排在 debug-panel 之前、flags 之后', () => {
    const entry = MANIFEST.content_scripts.find(
      (cs) => (cs.matches || []).indexOf('https://ark.xiaohongshu.com/*') > -1
        && (cs.js || []).indexOf('src/live/xhs-name-wrap.js') > -1);
    assert.ok(entry, '找不到 ark 的业务注入条目');
    const js = entry.js;
    const iNew = js.indexOf('src/live/xhs-ark-name-wrap.js');
    const iPanel = js.indexOf('src/content/debug-panel.js');
    assert.ok(iNew > -1, '新脚本没进注入清单 —— 开关开着也不会生效');
    assert.ok(iNew < iPanel, '功能脚本必须排在 debug-panel 之前');
    assert.equal(js[0], 'src/content/flags.js', 'flags.js 必须第 0 位');
  });
}

(async () => {
  await testPageScope();
  await testCriteria();
  await testLifecycle();
  testWiring();
  await new Promise((r) => setTimeout(r, 0));
  console.log('\n千帆商品名自测：' + pass + ' 条全部通过。');
})().catch((e) => {
  console.error('\n失败：' + (e && e.stack || e));
  process.exit(1);
});
