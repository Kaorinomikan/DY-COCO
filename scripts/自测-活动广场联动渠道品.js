/** 活动广场独立渠道品按钮：触发边界、虚拟列表、最新状态回读、去重计数及生命周期回归。 */
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

  let html = '<div id="app"><div id="tools"><button>Excel报名</button><button id="batch">批量修改工具(0)</button></div><div class="table">' +
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

  const dom = new JSDOM('<!doctype html><html><body><div id="app"><div id="tools"><button>Excel报名</button><button id="batch">批量修改工具(0)</button></div><div class="table">' +
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
      if (c) c.addEventListener('click', function () { if (!opts.rejectPersist) state.ch[i] = c.checked; render(); });
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

function button(env) {
  const host = env.doc.querySelector('[data-dyc-campaign-tick]');
  return host && host.shadowRoot.querySelector('button');
}
async function run(env) {
  const before = env.messages.length;
  button(env).click();
  ok(await waitFor(() => env.messages.length > before), '操作完成并给出结果');
  return env.messages[env.messages.length - 1];
}
(async function main() {
  let env = await boot({ withSidebar: true });
  ok(button(env) && button(env).textContent.includes('渠道品'), '工具栏挂载独立按钮');
  ok(env.doc.getElementById('batch').nextElementSibling.shadowRoot, '按钮紧随批量修改工具');
  click(env, 'all');
  await sleep(350);
  ok(env.clicks.c1 === 0 && env.clicks.c2 === 0 && env.messages.length === 0, '全选不触发渠道品');
  click(env, 'all'); click(env, 'p1');
  await sleep(350);
  ok(env.clicks.c1 === 0, '单选主品不触发渠道品');
  let msg = await run(env);
  ok(env.doc.getElementById('c1').checked && !env.doc.getElementById('c2').checked, '仅补勾选中的主商品');
  ok(env.clicks.sideCh === 0, '不误点侧栏同名控件');
  ok(msg.source === '活动广场' && parseInt(msg.count.replace(/[^0-9]/g,'')) === 1, '三段式结果按实际补勾行数计数，不按渠道品数量累计');
  env.doc.getElementById('p1').checked = false;
  env.doc.getElementById('p2').checked = true;
  env.doc.getElementById('c2').disabled = true;
  env.messages.length = 0;
  msg = await run(env);
  ok(env.doc.getElementById('c1').checked, '未选商品已勾渠道品不被取消');
  ok(env.clicks.c2 === 0 && msg.type === 'alert', '禁用渠道品跳过并提示');
  env.dom.window.close();

  env = await boot({});
  env.doc.getElementById('c1').checked = true;
  click(env, 'all');
  msg = await run(env);
  ok(env.clicks.c1 === 0 && env.clicks.c2 === 1, '已勾好的框不重复点，重叠控件不重复统计');
  ok(msg.count.includes('1'), '只计本次新增一项');
  click(env,'all');
  await sleep(300);
  ok(env.doc.getElementById('c1').checked && env.doc.getElementById('c2').checked, '取消全选也不自动取消渠道品');
  env.messages.length=0;
  msg=await run(env);
  ok(msg.count.includes('0'), '未选商品时明确反馈补勾0项');
  env.doc.querySelector('[data-dyc-campaign-tick]').remove();
  ok(await waitFor(() => !!button(env)), '平台重渲染移除按钮后自动补回');
  env.watch()({ campaignChannelTick:false });
  ok(!button(env) && !env.api.isEnabled(), '关闭开关立即移除按钮');
  env.watch()({ campaignChannelTick:true });
  ok(!!button(env), '重新开启立即挂载按钮');
  env.dom.window.close();

  env=await boot({ flag:false });
  ok(!button(env), '初始关闭开关不注入按钮');
  env.dom.window.close();

  for (const options of [
    {total:12,perScreen:6},
    {total:12,perScreen:6,startAt:120},
    {total:12,perScreen:12},
    {total:18,perScreen:6,outerScroll:true}
  ]) {
    env=await bootVirtual(options);
    click(env,'all');
    await sleep(300);
    ok(env.state.ch.every(v => !v), '虚拟列表全选不自动勾渠道品');
    const origin=env.list.scrollTop;
    button(env).click(); button(env).click();
    ok(button(env).disabled, '运行中禁用按钮，连点不重复执行');
    ok(await waitFor(() => env.messages.length>0,25000), '虚拟列表扫描完成');
    ok(env.state.ch.every(Boolean), '跨屏及平台重建后全部补勾成功');
    ok(env.messages.length===1 && env.messages[0].count === '补勾 '+options.total+' 项', '重叠屏与重建节点不重复计数');
    ok(env.list.scrollTop===origin && env.state.main.every(Boolean), '恢复原滚动位置，保留主品勾选状态');
    env.dom.window.close();
  }

  env=await bootVirtual({total:12,perScreen:6,startAt:120});
  env.state.main[0]=env.state.main[7]=env.state.main[11]=true;
  env.state.ch[4]=true;
  env.list.scrollTop=120;
  msg=await run(env);
  ok(msg.count==='补勾 3 项' && [0,4,7,11].every(i=>env.state.ch[i]), '跨屏仅补勾手选的三件，保留未选商品已有渠道品');
  ok(env.state.ch.filter(Boolean).length===4, '其余未选商品不受影响');
  env.dom.window.close();

  env=await bootVirtual({total:2,perScreen:2,rejectPersist:true});
  click(env,'all');
  msg=await run(env);
  ok(env.state.ch.every(v => !v) && msg.type==='alert' && msg.count==='补勾 0 项', '回归：旧节点已勾、新节点未保存时不虚报成功');
  ok(!button(env).disabled, '失败后恢复按钮');
  env.dom.window.close();

  env=await bootVirtual({total:12,perScreen:6,startAt:120});
  click(env,'all');
  button(env).click();
  env.api.stop();
  await sleep(500);
  ok(env.state.ch.every(v => !v) && env.list.scrollTop===120, '执行中关闭开关停止后续动作且还原滚动位置');
  env.dom.window.close();
  console.log('通过 '+pass+' 项，失败 '+failures.length+' 项');
  if(failures.length) process.exit(1);
})();
