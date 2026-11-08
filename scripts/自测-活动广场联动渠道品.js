/**
 * 自测 · 活动广场「勾主商品联动渠道品」（jsdom）
 * ============================================================
 * 用户 2026-10-25 拍板的三条口径，这套自测逐条盯着：
 *
 *   ① 勾上主商品 → 同行渠道品跟着勾上，**只发一条**三段式消息；
 *   ② 取消主商品 → 同行渠道品**一并取消**，同样只发一条消息；
 *   ②b 取消主商品但渠道品本来就没勾 → 不点、不出声；
 *   ③ 表头「全选」→ 已勾主品的行一次性补齐；「取消全选」→ 一并取消，各一条消息；
 *   ③b 手动取消渠道品（主品仍勾着）→ 不动、不出声，不自动补回；
 *   ④ 渠道品已勾好 → 不重复点（不制造多余请求）；
 *   ⑤ 点的是渠道品自己 → 不动（不是主品）；
 *   ⑥ 该行没有渠道品（数量 0）→ 静默，不点、不报；
 *   ⑦ 侧栏「渠道品报名状态」这类同名文案不能把行认错；
 *   ⑧ 开关关掉 → 点了也不动；
 *   ⑨ 页面上没有「渠道品跟随主品报名」→ 什么都不做；
 *   ⑩ 虚拟滚动（一屏 6 行、共 12 行）→ 全选要把**整张表**都联动上，且滚回原位；
 *      2026-11-08 用户报「商品超过大概 6 个，下面商品都不会自动勾选渠道品」。
 *   ⑪ 起始滚动位置不在顶部 → 联动结束要回到用户原来的位置；
 *   ⑫ 一屏装得下全部行（不用滚）→ 行为不变（不滚、全部勾上）；
 *   ⑬ 虚拟滚动下取消全选 → 整张表的渠道品一并取消。
 *
 * 用法：
 *   NODE_PATH=C:/Users/79412/.workbuddy/binaries/node/workspace/node_modules \
 *     node scripts/自测-活动广场联动渠道品.js
 * 退出码 0 = 全绿；1 = 有用例失败。
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.resolve(__dirname, '..');
const CODE = fs.readFileSync(path.join(ROOT, 'src/content/campaign-channel-tick.js'), 'utf8');

let pass = 0;
const failures = [];

function ok(cond, name) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { failures.push(name); console.log('  ✗ ' + name); }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ------------------------------------------------------------
 * 页面骨架：一行 = 主品勾选框 + 商品名 + 「渠道品跟随主品报名 (N)」
 * 组件结构参照抖音电商这套 auxo/ecom 组件库的常规形态
 * （壳 span.auxo-checkbox 包一个原生 input），但**本功能不依赖 class**，
 * 这里写成这种形态只为贴近真机。
 * ------------------------------------------------------------ */
function makePage(opts) {
  const withSidebar = opts.withSidebar;
  const row3NoChannel = opts.row3NoChannel !== false;

  const rows = [
    { id: 'p1', name: '【小予予专属】时尚菱形格圆领衬衫长袖上衣C2114', chId: 'c1', count: 1 },
    { id: 'p2', name: '【小予予专属】高腰阔腿牛仔裤', chId: 'c2', count: 2 }
  ];

  let html = '<div id="app"><div class="table">' +
    '<div class="header-row" id="head">' +
      '<span class="auxo-checkbox" id="allwrap"><input type="checkbox" id="all"></span>' +
      '<span class="th">商品信息</span>' +
      '<span class="th">报名价</span>' +
    '</div><div class="list">';

  rows.forEach(function (r) {
    html += '<div class="row" id="row-' + r.id + '">' +
      '<div class="cell-prod">' +
        '<span class="auxo-checkbox" id="wrap-' + r.id + '"><input type="checkbox" id="' + r.id + '"></span>' +
        '<div class="prod-name">' + r.name + '</div>' +
        '<div class="sub">' +
          '<label class="auxo-checkbox" id="wrap-' + r.chId + '">' +
            '<input type="checkbox" id="' + r.chId + '">' +
            '<span class="ch-text">渠道品跟随主品报名 (' + r.count + ')</span>' +
          '</label>' +
        '</div>' +
      '</div>' +
      '<div class="cell-price">1999 元</div>' +
      '</div>';
  });

  if (row3NoChannel) {
    html += '<div class="row" id="row-p3">' +
      '<div class="cell-prod">' +
        '<span class="auxo-checkbox" id="wrap-p3"><input type="checkbox" id="p3"></span>' +
        '<div class="prod-name">【小予予专属】无渠道品的商品</div>' +
      '</div><div class="cell-price">599 元</div></div>';
  }

  html += '</div></div>';

  if (withSidebar) {
    html += '<div class="side"><div class="filter">' +
      '<label class="auxo-checkbox" id="wrap-side">' +
        '<input type="checkbox" id="sideCh">' +
        '<span>渠道品报名状态</span>' +
      '</label></div></div>';
  }

  html += '</div>';

  return new JSDOM('<!doctype html><html><body>' + html + '</body></html>', {
    runScripts: 'dangerously',
    url: 'https://fxg.jinritemai.com/ffa/merchant/parent-campaign-detail?id=7390938114841329970'
  });
}

/** 装页面 + 装模块 + 装消息捕获 */
async function boot(opts) {
  opts = opts || {};
  const dom = makePage(opts);
  const win = dom.window;
  const doc = win.document;

  const messages = [];
  win.toast = function (text, type, o) {
    messages.push({ text: text, type: type || 'info', source: (o && o.source) || '', count: (o && o.count) || '' });
  };
  win.setStatus = function (text, type, o) {
    messages.push({ text: text, type: type || 'info', source: (o && o.source) || '', count: (o && o.count) || '' });
  };

  let watchCb = null;
  win.dycReadFlags = function () {
    return Promise.resolve({ campaignChannelTick: opts.flag !== false });
  };
  win.dycWatchFlags = function (cb) { watchCb = cb; };

  // 代点计数：任何渠道品勾选框上的点击都记下来
  const clicks = {};
  ['c1', 'c2', 'sideCh'].forEach(function (id) {
    const el = doc.getElementById(id);
    if (!el) return;
    clicks[id] = 0;
    el.addEventListener('click', function () { clicks[id]++; });
  });
  ['p1', 'p2', 'p3', 'all'].forEach(function (id) {
    const el = doc.getElementById(id);
    if (!el) return;
    clicks[id] = 0;
    el.addEventListener('click', function () { clicks[id]++; });
  });

  // 平台行为：点「全选」后各行主品框被勾上 / 取消
  const all = doc.getElementById('all');
  all.addEventListener('click', function () {
    const on = all.checked;
    ['p1', 'p2', 'p3'].forEach(function (id) {
      const el = doc.getElementById(id);
      if (el) el.checked = on;
    });
  });

  win.eval(CODE);
  await sleep(30);        // 等 dycReadFlags 的 Promise 落地
  return { dom: dom, win: win, doc: doc, messages: messages, clicks: clicks, api: win.__DYC_CAMPAIGN_TICK__, watch: function () { return watchCb; } };
}

function click(env, id) {
  const el = env.doc.getElementById(id);
  const ev = new env.win.MouseEvent('click', { bubbles: true, cancelable: true });
  el.dispatchEvent(ev);
}

/* ------------------------------------------------------------
 * 虚拟滚动假页面（2026-11-08 用户报「超过 6 个就失效」的现场还原）
 * 真机：这张商品表是虚拟滚动 —— DOM 里只有视口那一屏（约 6 行），
 * 滚出去的行被销毁重建；而且**每点一次勾选，平台会把整屏重渲染一遍**
 * （这正是「一口气点完，后面的点击落空」的来源，必须一起还原）。
 * 布局（clientHeight / scrollHeight）在 jsdom 里没有，用 defineProperty 补。
 * ------------------------------------------------------------ */
function makeVirtualPage(opts) {
  const total = opts.total || 12;
  const perScreen = Math.min(opts.perScreen || 6, total);
  const rowH = 60;
  const startAt = opts.startAt || 0;

  const state = { main: [], ch: [] };
  for (let i = 0; i < total; i++) { state.main.push(false); state.ch.push(false); }

  const dom = new JSDOM('<!doctype html><html><body><div id="app"><div class="table">' +
    '<div class="header-row" id="head">' +
      '<span class="auxo-checkbox" id="allwrap"><input type="checkbox" id="all"></span>' +
      '<span class="th">商品信息</span><span class="th">报名价</span>' +
    '</div><div class="scroll-outer" id="outer"><div class="list" id="list"></div></div>' +
    '</div></div></body></html>', {
    runScripts: 'dangerously',
    url: 'https://fxg.jinritemai.com/ffa/merchant/parent-campaign-detail?id=7390938114841329970'
  });
  const win = dom.window;
  const doc = win.document;
  const list = doc.getElementById('list');
  const outer = doc.getElementById('outer');

  /* 外层页面自己也高于可见区（真机常见：后台是「外层整页 + 内层列表」两层都能滚） */
  if (opts.outerScroll) {
    let ost = 0;
    Object.defineProperty(outer, 'scrollTop', {
      get: function () { return ost; },
      set: function (v) { ost = Math.max(0, Math.min(900, Number(v) || 0)); },
      configurable: true
    });
    Object.defineProperty(outer, 'clientHeight', { get: function () { return 600; }, configurable: true });
    Object.defineProperty(outer, 'scrollHeight', { get: function () { return 1500; }, configurable: true });
  }

  const viewH = perScreen * rowH;
  const contentH = total * rowH;
  const maxScroll = Math.max(0, contentH - viewH);
  let st = Math.min(startAt, maxScroll);

  /* 平台重渲染：只重建列表内部（表头那枚「全选」不动 —— 真机也是粘在表头上的） */
  function render() {
    const start = maxScroll > 0
      ? Math.min(Math.max(0, Math.floor(st / rowH)), Math.max(0, total - perScreen))
      : 0;
    const end = Math.min(total, start + perScreen);
    let html = '';
    for (let i = start; i < end; i++) {
      html += '<div class="row" id="row-p' + i + '">' +
        '<div class="cell-prod">' +
          '<span class="auxo-checkbox" id="wrap-p' + i + '">' +
            '<input type="checkbox" id="p' + i + '"' + (state.main[i] ? ' checked' : '') + '>' +
          '</span>' +
          '<div class="prod-name">商品 ' + i + ' 名称</div>' +
          '<label class="auxo-checkbox" id="wrap-c' + i + '">' +
            '<input type="checkbox" id="c' + i + '"' + (state.ch[i] ? ' checked' : '') + '>' +
            '<span class="ch-text">渠道品跟随主品报名 (1)</span>' +
          '</label>' +
        '</div>' +
        '<div class="cell-price">1999 元</div>' +
        '</div>';
    }
    list.innerHTML = html;
    for (let i = start; i < end; i++) {
      const p = doc.getElementById('p' + i);
      const c = doc.getElementById('c' + i);
      if (p) p.addEventListener('click', function () { state.main[i] = p.checked; render(); });
      if (c) c.addEventListener('click', function () { state.ch[i] = c.checked; render(); });
    }
  }

  Object.defineProperty(list, 'scrollTop', {
    get: function () { return st; },
    set: function (v) { st = Math.max(0, Math.min(maxScroll, Number(v) || 0)); render(); },
    configurable: true
  });
  Object.defineProperty(list, 'clientHeight', {
    get: function () { return viewH; }, configurable: true
  });
  Object.defineProperty(list, 'scrollHeight', {
    get: function () { return contentH; }, configurable: true
  });

  render();

  /* 平台行为：点「全选」= 数据层把每一行都勾上/取消，再按可见窗口重渲染 */
  const all = doc.getElementById('all');
  all.addEventListener('click', function () {
    const on = all.checked;
    for (let i = 0; i < total; i++) state.main[i] = on;
    render();
  });

  return { dom: dom, win: win, doc: doc, list: list, state: state };
}

/** 装虚拟滚动页 + 装模块 + 捕获消息 */
async function bootVirtual(opts) {
  const page = makeVirtualPage(opts);
  const win = page.win;
  const messages = [];
  win.toast = function (text, type, o) {
    messages.push({ text: text, type: type || 'info', source: (o && o.source) || '', count: (o && o.count) || '' });
  };
  win.setStatus = function (text, type, o) {
    /* running 只是过程状态，不算一条消息（与真机 setStatus 同口径） */
    if (type === 'running') return;
    messages.push({ text: text, type: type || 'info', source: (o && o.source) || '', count: (o && o.count) || '' });
  };
  win.dycReadFlags = function () { return Promise.resolve({ campaignChannelTick: opts.flag !== false }); };
  win.dycWatchFlags = function () {};
  win.eval(CODE);
  await sleep(30);
  return {
    dom: page.dom, win: win, doc: page.doc, list: page.list, state: page.state,
    messages: messages, api: win.__DYC_CAMPAIGN_TICK__
  };
}

/** 轮询等待（不许用固定 sleep 卡时间：并发机器上必翻车） */
async function waitFor(fn, timeout) {
  const deadline = Date.now() + (timeout || 15000);
  while (Date.now() < deadline) {
    if (fn()) return true;
    await sleep(40);
  }
  return false;
}

(async function main() {
  console.log('===== 活动广场 · 勾主商品联动渠道品 =====');

  /* ---- ① 勾主商品 → 渠道品跟着勾上，一条消息 ---- */
  let env = await boot({ withSidebar: true });
  ok(env.api && env.api.isEnabled(), '① 开关默认开启，模块已挂上监听');
  click(env, 'p1');
  await sleep(320);
  ok(env.doc.getElementById('c1').checked === true, '① 勾主商品后，同行渠道品被勾上');
  ok(env.clicks.c1 === 1, '① 渠道品只被点了一次（没有重复代点）');
  ok(env.messages.length === 1, '① 只发一条消息');
  ok(env.messages[0] && env.messages[0].text === '已联动勾选渠道品', '① 消息值 = 已联动勾选渠道品');
  ok(env.messages[0] && env.messages[0].source === '活动广场', '① 消息带来源词「活动广场」（三段式）');
  ok(env.messages[0] && env.messages[0].count === '1 个', '① 消息结果数 = 1 个');

  /* ---- ④ 渠道品已经勾好 → 不重复点 ---- */
  env = await boot({});
  env.doc.getElementById('c1').checked = true;
  click(env, 'p1');
  await sleep(320);
  ok(env.clicks.c1 === 0, '④ 渠道品已勾好时不再点它');
  ok(env.messages.length === 0, '④ 没有动作就不出声');

  /* ---- ② 取消主商品 → 渠道品一并取消 ---- */
  env = await boot({});
  env.doc.getElementById('p1').checked = true;
  env.doc.getElementById('c1').checked = true;
  click(env, 'p1');                    // 取消主品
  await sleep(320);
  ok(env.doc.getElementById('c1').checked === false, '② 取消主商品后渠道品被一并取消');
  ok(env.clicks.c1 === 1, '② 渠道品只被点了一次');
  ok(env.messages.length === 1, '② 只发一条消息');
  ok(env.messages[0] && env.messages[0].text === '已联动取消渠道品', '② 消息值 = 已联动取消渠道品');
  ok(env.messages[0] && env.messages[0].count === '1 个', '② 消息结果数 = 1 个');

  /* ---- ②b 取消主商品但渠道品本来没勾 → 静默 ---- */
  env = await boot({});
  env.doc.getElementById('p1').checked = true;
  click(env, 'p1');                    // 取消主品（渠道品本来未勾）
  await sleep(320);
  ok(env.clicks.c1 === 0, '②b 渠道品本来未勾时不去点它');
  ok(env.messages.length === 0, '②b 状态已一致，不出声');

  /* ---- ⑤ 点的是渠道品自己 ---- */
  env = await boot({});
  click(env, 'c1');
  await sleep(320);
  ok(env.clicks.c1 === 1, '⑤ 点渠道品自己只算用户那一次点击');
  ok(env.messages.length === 0, '⑤ 点渠道品自己不出声');

  /* ---- ③ 表头全选 → 一次性补齐 ---- */
  env = await boot({});
  click(env, 'all');
  await sleep(700);
  ok(env.doc.getElementById('c1').checked === true && env.doc.getElementById('c2').checked === true,
    '③ 全选后两行的渠道品都被勾上');
  ok(env.messages.length === 1, '③ 全选只发一条消息（不逐行刷屏）');
  ok(env.messages[0] && env.messages[0].count === '2 个', '③ 消息结果数 = 2 个');

  /* ---- ③b 取消全选 → 各行渠道品一并取消 ---- */
  env = await boot({});
  click(env, 'all');                   // 全选 → 各行渠道品被补勾
  await sleep(700);
  click(env, 'all');                   // 再点一次 = 取消全选
  await sleep(700);
  ok(env.doc.getElementById('c1').checked === false && env.doc.getElementById('c2').checked === false,
    '③b 取消全选后两行渠道品都被取消');
  ok(env.messages.length === 2, '③b 勾选与取消各一条消息（共两条）');
  ok(env.messages[1] && env.messages[1].text === '已联动取消渠道品', '③b 第二条是「已联动取消渠道品」');
  ok(env.messages[1] && env.messages[1].count === '2 个', '③b 取消结果数 = 2 个');

  /* ---- ③b' 手动取消渠道品（主品仍勾着）→ 不动、不自动补回 ---- */
  env = await boot({});
  env.doc.getElementById('p1').checked = true;
  env.doc.getElementById('c1').checked = true;
  click(env, 'c1');                    // 用户手动取消渠道品
  await sleep(320);
  ok(env.doc.getElementById('c1').checked === false, '③b\' 手动取消后保持取消（不自动补回）');
  ok(env.messages.length === 0, '③b\' 用户自己动渠道品时不出声');

  /* ---- ⑥ 该行没有渠道品（数量 0）→ 静默 ---- */
  env = await boot({});
  click(env, 'p3');
  await sleep(320);
  ok(env.messages.length === 0, '⑥ 无渠道品的行：不报错、不出声');
  ok(env.clicks.c1 === 0 && env.clicks.c2 === 0, '⑥ 无渠道品的行：不误点别人家的渠道品');

  /* ---- ⑦ 侧栏同名文案不干扰 ---- */
  env = await boot({ withSidebar: true });
  click(env, 'p1');
  await sleep(320);
  ok(env.doc.getElementById('c1').checked === true, '⑦ 侧栏「渠道品报名状态」存在时仍认对行');
  ok(env.clicks.sideCh === 0, '⑦ 侧栏那枚勾选框没被误点');

  /* ---- ⑧ 开关关掉 ---- */
  env = await boot({ flag: false });
  ok(env.api.isEnabled() === false, '⑧ 开关关掉时监听未挂');
  click(env, 'p1');
  await sleep(320);
  ok(env.clicks.c1 === 0 && env.messages.length === 0, '⑧ 关掉后点了也不动、不出声');

  /* ---- ⑨ 页面上根本没有「渠道品跟随主品报名」 ---- */
  const dom = new JSDOM('<!doctype html><html><body><div class="row">' +
    '<input type="checkbox" id="lonely"><span>普通页面</span></div></body></html>',
    { runScripts: 'dangerously', url: 'https://fxg.jinritemai.com/ffa/merchant/parent-campaign-detail' });
  const w = dom.window;
  const msgs = [];
  w.toast = function (t) { msgs.push(t); };
  w.setStatus = function (t) { msgs.push(t); };
  w.dycReadFlags = function () { return Promise.resolve({ campaignChannelTick: true }); };
  w.dycWatchFlags = function () {};
  w.eval(CODE);
  await sleep(30);
  dom.window.document.getElementById('lonely').dispatchEvent(
    new w.MouseEvent('click', { bubbles: true })
  );
  await sleep(320);
  ok(msgs.length === 0, '⑨ 没有渠道品文案的页面：完全静默');

  /* ---- ⑩ 虚拟滚动：一屏 6 行、共 12 行 ---- */
  env = await bootVirtual({ total: 12, perScreen: 6 });
  click(env, 'all');
  ok(await waitFor(() => env.messages.length >= 1, 15000), '⑩ 联动走完并报了结果（没有卡死）');
  ok(env.state.ch.every(Boolean), '⑩ 12 行（虚拟滚动、一屏 6 行）全选后渠道品全部勾上');
  ok(env.state.main.every(Boolean), '⑩ 主商品的勾选态没有被改坏');
  ok(env.messages.length === 1, '⑩ 只发一条汇总消息（不逐屏刷屏）');
  ok(env.messages[0] && env.messages[0].text === '已联动勾选渠道品', '⑩ 消息值 = 已联动勾选渠道品');
  ok(env.messages[0] && env.messages[0].count === '12 个', '⑩ 消息结果数 = 12 个');
  ok(env.list.scrollTop === 0, '⑩ 联动结束把滚动位置还原到原位');

  /* ---- ⑬ 虚拟滚动下取消全选（同一次会话里接着点） ---- */
  click(env, 'all');
  ok(await waitFor(() => env.messages.length >= 2, 15000), '⑬ 取消全选也走完了');
  ok(env.state.ch.every((v) => v === false), '⑬ 取消全选后整张表的渠道品一并取消');
  ok(env.messages[1] && env.messages[1].text === '已联动取消渠道品', '⑬ 第二条消息 = 已联动取消渠道品');
  ok(env.messages[1] && env.messages[1].count === '12 个', '⑬ 取消结果数 = 12 个');
  ok(env.messages.length === 2, '⑬ 勾选与取消各一条（共两条）');

  /* ---- ⑪ 起始滚动位置不在顶部 → 结束要回到原处 ---- */
  env = await bootVirtual({ total: 12, perScreen: 6, startAt: 120 });
  click(env, 'all');
  await waitFor(() => env.messages.length >= 1, 15000);
  ok(env.state.ch.every(Boolean), '⑪ 从列表中间起步时也能把整张表勾全');
  ok(env.list.scrollTop === 120, '⑪ 结束后滚动位置回到用户原来的 120');

  /* ---- ⑫ 一屏装得下全部行（不用滚）→ 行为不变 ---- */
  env = await bootVirtual({ total: 12, perScreen: 12 });
  click(env, 'all');
  await waitFor(() => env.messages.length >= 1, 15000);
  ok(env.state.ch.every(Boolean), '⑫ 一屏装得下 12 行时照样全部勾上（不滚）');
  ok(env.list.scrollTop === 0, '⑫ 不用滚的页面滚动位置不受影响');

  /* ---- ⑭ 外层页面比列表高 + 行数多：步长必须按列表算，不许跨过没渲染的行 ---- */
  env = await bootVirtual({ total: 18, perScreen: 6, outerScroll: true });
  click(env, 'all');
  await waitFor(() => env.messages.length >= 1, 25000);
  ok(env.state.ch.every(Boolean), '⑭ 18 行 + 外层 900px 也能滚时，一行都不漏');
  ok(env.messages[0] && env.messages[0].count === '18 个', '⑭ 消息结果数 = 18 个');

  console.log('');
  console.log('通过 ' + pass + ' 项' + (failures.length ? '，失败 ' + failures.length + ' 项' : '，全部通过'));
  if (failures.length) {
    failures.forEach(function (f) { console.log('   ✗ ' + f); });
    process.exit(1);
  }
})();
