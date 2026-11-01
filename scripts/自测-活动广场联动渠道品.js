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
 *   ⑨ 页面上没有「渠道品跟随主品报名」→ 什么都不做。
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

  console.log('');
  console.log('通过 ' + pass + ' 项' + (failures.length ? '，失败 ' + failures.length + ' 项' : '，全部通过'));
  if (failures.length) {
    failures.forEach(function (f) { console.log('   ✗ ' + f); });
    process.exit(1);
  }
})();
