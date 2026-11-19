/**
 * 小红书 · 商品序号定位（2026-11-17 建）
 * ============================================================
 * 被测文件：src/live/xhs-locate.js、src/content/flags.js（xhsLocate）、
 *           manifest.json（注入顺序）
 *
 * 覆盖：
 *   A. 落点与读数 —— 插在搜索框右侧（不是行尾）、三段齐全、总数 = 卡片数
 *   B. 序号口径 —— 只认序号框的值（不按位次）、读不到明说、不猜
 *   C. 滚动与高亮 —— 内层列表落到目标居中、fixed 覆盖层 3 秒后自清
 *   D. 心跳 —— 控件被平台重渲染抹掉后 1 秒内补回
 *   E. 开关与注入 —— xhsLocate 归 xhsLive、作用页 xhsCtrl、manifest 顺序
 *
 * 做法：jsdom + 受控几何（clientHeight / scrollHeight / getBoundingClientRect
 *   在 jsdom 里恒为 0，必须显式给值），与 scripts/自测-小红书滚钮与名称.js
 *   同风格：断言只约束最终行为，不绑实现细节。
 *
 * 用法：node scripts/自测-小红书序号定位.js  （退出码 0 = 全绿）
 * ============================================================
 */
'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert/strict');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const LOCATE = read('src/live/xhs-locate.js');
const MANIFEST = JSON.parse(read('manifest.json'));
const FLAGS_CODE = read('src/content/flags.js');
const DOC_RULES = read('docs/agents/用户要求.md');

const CTRL_URL = 'https://pgy.xiaohongshu.com/commerce/redlive/live_center_control';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let pass = 0;
const done = [];
function ok(name) { pass++; done.push(name); console.log('  ✓ ' + name); }
async function check(name, fn) {
  try { await fn(); ok(name); }
  catch (e) { console.log('  ✗ ' + name + '\n     ' + (e && e.message)); throw e; }
}

/** 给元素设受控几何（jsdom 里这些属性恒为 0） */
function geo(el, o) {
  ['clientHeight', 'scrollHeight', 'clientWidth', 'scrollWidth'].forEach((k) => {
    Object.defineProperty(el, k, { value: o[k] || 0, configurable: true });
  });
  if (o.scrollTop !== undefined) el.scrollTop = o.scrollTop;
  return el;
}

/** 给元素设坐标（visible() 要求宽高 > 0） */
function rect(el, x, y, w, h) {
  el.getBoundingClientRect = () => ({
    left: x, top: y, right: x + w, bottom: y + h, width: w, height: h, x, y
  });
  return el;
}

/** 卡片序列号：把序号框的值写进去（这是本功能唯一口径） */
function cardsHtml(serials, withInput) {
  return serials.map((s, i) => {
    const idx = withInput === false
      ? '<div class="goods-card__index"></div>'
      : '<div class="goods-card__index"><div class="goods-card__index-input">'
        + '<input value="' + s + '"></div></div>';
    return '<div class="goods-card" data-idx="' + i + '">'
      + '<div class="goods-card__info-row">' + idx
      + '<div class="goods-card__base"><div class="goods-card__title-block">'
      + '<span class="d-text --color-static --color-text-title">第 ' + s + ' 号商品</span>'
      + '</div></div></div></div>';
  }).join('');
}

function pageHtml(serials, opts) {
  const o = opts || {};
  return '<!doctype html><body>'
    /* 抽屉与它同名搜索框刻意放在**最前面**：querySelectorAll 会先命中它，
     * 正是真机上「控件被挂进添加商品抽屉」的成因（2026-11-18 用户报）。 */
    + (o.withDrawer
      ? '<div class="d-drawer d-drawer-right detail-add-goods-drawer"><div class="add-table">'
        + '<div id="dph">请输入商品名称、序号或ID</div>'
        + '<input id="dq" placeholder="请输入商品名称、序号或ID">'
        + '</div></div>'
      : '')
    + '<div class="top-bar"><div class="top-bar-menu"></div></div>'
    + '<div id="row">'
    + '<div id="tabs">全部</div>'
    + '<div id="addcat">添加分类</div>'
    + '<div id="searchcol">'
    + '<div id="searchbox" class="d-input-wrapper"><span class="ico"></span>'
    + (o.noAnchor
      ? ''
      : o.ariaOnly
        ? '<input id="q" aria-label="请输入商品名称、序号或ID">'
        : o.textOnly
          ? '<div id="ph">请输入商品名称、序号或ID</div>'
          : '<input id="q" placeholder="' + (o.ph || '请输入商品名称、序号或ID') + '">')
    + '</div>'
    + '</div>'
    + '<div id="spacer" style="flex:1"></div>'
    + '<button id="batch" disabled>批量下架</button>'
    + '<button id="add">添加商品</button>'
    + '</div>'
    + '<div class="goods-list"><div class="goods-card-list">'
    + cardsHtml(serials || [1, 2, 3], o.withInput)
    + '</div></div>'
    + '</body>';
}

function makeDom(html, flags) {
  const dom = new JSDOM(html, { url: CTRL_URL, pretendToBeVisual: true, runScripts: 'outside-only' });
  const win = dom.window;
  const doc = win.document;

  win.DYC_PAGE_PATTERNS = { xhsCtrl: /^https:\/\/pgy\.xiaohongshu\.com\/commerce\/redlive\// };
  win.__watchers = [];
  win.__flags = Object.assign({ xhsLocate: true }, flags || {});
  win.__status = [];
  win.setStatus = (m, t, o) => { win.__status.push({ m, t, o: o || {} }); };
  /* mock 必须与真实签名一致：dycReadFlags() 返回 Promise（flags.js） */
  win.dycReadFlags = () => Promise.resolve(win.__flags);
  win.dycWatchFlags = (cb) => { win.__watchers.push(cb); };

  // 版面：输入框 300×32，搜索框外壳 310×36，整行 36 高。
  // #searchcol 是行里的一格、内部竖排 —— 真机上控件就是掉进这层后「换行」的。
  const q = doc.getElementById('q');
  if (q) rect(q, 200, 20, 300, 32);
  const ph = doc.getElementById('ph');
  if (ph) rect(ph, 210, 22, 280, 28);
  /* 抽屉几何：真机里抽屉从右侧滑出、占满视口高度 */
  const dq = doc.getElementById('dq');
  if (dq) rect(dq, 1300, 56, 180, 32);
  const dph = doc.getElementById('dph');
  if (dph) rect(dph, 1300, 58, 170, 28);
  const drawer = doc.querySelector('.d-drawer');
  if (drawer) rect(drawer, 1226, 0, 481, 929);
  rect(doc.getElementById('searchbox'), 196, 18, 310, 36);
  rect(doc.getElementById('searchcol'), 196, 18, 310, 36);
  rect(doc.getElementById('row'), 0, 18, 1100, 36);
  rect(doc.getElementById('add'), 1000, 18, 90, 32);

  /* 版面模型：我们自己的控件插在行里 ⇒ 与搜索框部分重叠，但中心线偏高；
   * 插进 #searchcol 内部 ⇒ 被竖排挤到下一行（top 80）。
   * 这正是真机 00:10 的现象，用它来验证「量了再定」。 */
  win.Element.prototype.getBoundingClientRect = function () {
    if (this.id === 'dyc-xhs-locate') {
      const col = this.parentElement;
      const inRow = !!(col && col.id === 'row');
      const top = (inRow ? 11 : 80) + (parseFloat(this.style.top) || 0);
      return { left: 516, top, right: 738, bottom: top + 32, width: 222, height: 32, x: 516, y: top };
    }
    return { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0 };
  };

  const list = doc.querySelector('.goods-card-list');
  const cards = Array.from(doc.querySelectorAll('.goods-card'));
  if (list) {
    geo(list, { clientHeight: 711, scrollHeight: cards.length * 195, scrollWidth: 1112, clientWidth: 1112, scrollTop: 0 });
    rect(list, 0, 100, 1112, 711);
    cards.forEach((c, i) => rect(c, 0, 100 + i * 195, 1080, 195));
  }
  return { dom, win, doc };
}

function lastStatus(win) { return win.__status[win.__status.length - 1]; }

/* ============================================================
 * A. 落点与读数
 * ============================================================ */
async function testPlacement() {
  console.log('\nA. 落点与读数');

  await check('A1 控件插在搜索框右侧（紧邻外壳，不是行尾、不挤「添加商品」）', async () => {
    const { win, doc } = makeDom(pageHtml([1, 2, 3]));
    win.eval(LOCATE);
    await sleep(40);

    const box = doc.getElementById('dyc-xhs-locate');
    assert.ok(box, '控件没挂上');
    /* 真机 00:10：控件掉进了搜索框那层竖向容器，跑到下一行。
     * 现在必须跨过那层，挂在**行**上、紧贴搜索框那一格。 */
    assert.equal(box.parentElement.id, 'row', '控件必须挂在行上，不能挂在搜索框的竖向容器里');
    assert.equal(box.previousElementSibling && box.previousElementSibling.id, 'searchcol',
      '必须紧贴搜索框那一格右侧');
    assert.equal(box.nextElementSibling && box.nextElementSibling.id, 'spacer',
      '应在搜索框与右侧按钮之间，而不是被推到行尾');
    const search = doc.getElementById('searchbox').getBoundingClientRect();
    const locate = box.getBoundingClientRect();
    assert.equal(locate.top + locate.height / 2, search.top + search.height / 2, '控件和原生搜索框的中心线应重合');
    win.close();
  });

  await check('A2 三段齐全：输入框 + 定位按钮 + 共 N 个（N = 卡片数）', async () => {
    const { win, doc } = makeDom(pageHtml([1, 2, 3, 4, 5]));
    win.eval(LOCATE);
    await sleep(40);

    const box = doc.getElementById('dyc-xhs-locate');
    assert.ok(box.querySelector('input'), '缺输入框');
    const btn = box.querySelector('#dyc-xhs-locate-go');
    assert.ok(btn, '缺定位按钮');
    assert.equal(btn.textContent, '定位');
    assert.equal(box.querySelector('.dyc-xhs-locate-count').textContent, '共 5 个商品',
      '读数口径照抖店 nav.js「共 N 个商品」，且直接数卡片（不用推算）');
    win.close();
  });

  await check('A3 锚点用「包含」匹配：平台改文案（加「、序号或ID」）也挂得上', async () => {
    const { win, doc } = makeDom(pageHtml([1], { ph: '请输入商品名称、序号或ID' }));
    win.eval(LOCATE);
    await sleep(40);
    assert.ok(doc.getElementById('dyc-xhs-locate'), '文案带标点时锚点失效了');
    win.close();
  });

  await check('A4 开关关 → 控件移出页面；再开 → 补回', async () => {
    const { win, doc } = makeDom(pageHtml([1, 2]));
    win.eval(LOCATE);
    await sleep(40);
    assert.ok(doc.getElementById('dyc-xhs-locate'), '开时应挂上');

    win.__flags = { xhsLocate: false };
    win.__watchers.forEach((cb) => cb(win.__flags));
    await sleep(40);
    assert.equal(doc.getElementById('dyc-xhs-locate'), null, '关掉应移除控件，不能只隐藏');

    win.__flags = { xhsLocate: true };
    win.__watchers.forEach((cb) => cb(win.__flags));
    await sleep(40);
    assert.ok(doc.getElementById('dyc-xhs-locate'), '再开应补回');
    win.close();
  });
  await check('A4.5 被平台挪进竖向容器（掉到下一行）后，两拍内自己归位', async () => {
    const { win, doc } = makeDom(pageHtml([1, 2]));
    win.eval(LOCATE);
    await sleep(40);
    const box = doc.getElementById('dyc-xhs-locate');
    assert.equal(box.parentElement.id, 'row');

    doc.getElementById('searchcol').appendChild(box);   // 模拟平台重渲染把它挪走
    assert.equal(box.parentElement.id, 'searchcol');

    await sleep(2400);                                   // 两拍判定 + 重放
    assert.equal(box.parentElement.id, 'row', '错位两拍内要自己回到行上');
    win.close();
  });

  await check('A5 没有 placeholder、只有 aria-label 也能挂上（第二路）', async () => {
    /* 2026-11-18 00:04 用户「没看见定位功能」的直接教训：
     * 原先只认 placeholder 属性，赌错一种写法整条功能就消失。 */
    const { win, doc } = makeDom(pageHtml([1], { ariaOnly: true }));
    win.eval(LOCATE);
    await sleep(40);
    const box = doc.getElementById('dyc-xhs-locate');
    assert.ok(box, 'aria-label 这条路没命中');
    assert.equal(box.parentElement.id, 'row', '仍要挂到行上');
    assert.equal(box.previousElementSibling.id, 'searchcol', '仍要贴搜索框右侧');
    win.close();
  });

  await check('A6 占位是 div 画出来的（input 不带 placeholder）也能挂上（第三路）', async () => {
    const { win, doc } = makeDom(pageHtml([1], { textOnly: true }));
    win.eval(LOCATE);
    await sleep(40);
    assert.ok(doc.getElementById('dyc-xhs-locate'), '占位文案这条路没命中');
    win.close();
  });

  await check('A7 三路全落空：6 秒内报一次人话 + 写诊断，不许静默消失', async () => {
    const { win, doc } = makeDom(pageHtml([1], { noAnchor: true }));
    win.__diag = [];
    win.__dycDiag = { note: (a, d, r) => win.__diag.push({ a, d, r }) };
    win.eval(LOCATE);
    await sleep(6600);            // 心跳 1 秒 × 6 拍

    assert.equal(doc.getElementById('dyc-xhs-locate'), null, '找不到锚点时不该硬塞到别处');
    const st = lastStatus(win);
    assert.ok(st, '插不上却一条消息都没有 —— 用户只会以为功能没做');
    assert.equal(st.t, 'warning');
    assert.ok(/没找到商品列表工具栏/.test(st.m), '实际：' + st.m);
    assert.ok(win.__diag.some((x) => x.a === '序号定位' && /插不上/.test(x.d)),
      '诊断轨迹里要留下候选，供下一份报告定位');
    win.close();
  });

  await check('A8 抽屉里的同名搜索框不算锚点：控件只挂工具栏，不进抽屉', async () => {
    /* 2026-11-18 用户报「序号定位功能不要在抽屉出现」：
     * 「添加商品」抽屉里也有一枚「请输入商品名称」的搜索框，第三路会命中它，
     * 控件被插进抽屉列表并竖排拉伸（真机量到 212×873）。 */
    const { win, doc } = makeDom(pageHtml([1, 2, 3], { withDrawer: true }));
    win.eval(LOCATE);
    await sleep(40);

    const box = doc.getElementById('dyc-xhs-locate');
    assert.ok(box, '控件没挂上');
    assert.equal(box.closest('.d-drawer'), null, '控件不许出现在抽屉里');
    assert.equal(box.parentElement.id, 'row', '应挂在商品列表工具栏那一行');
    win.close();
  });

  await check('A9 控件被平台搬进抽屉后，一拍内拆掉重挂回工具栏', async () => {
    const { win, doc } = makeDom(pageHtml([1, 2], { withDrawer: true }));
    win.eval(LOCATE);
    await sleep(40);
    const box = doc.getElementById('dyc-xhs-locate');
    assert.ok(box, '初始没挂上');

    doc.querySelector('.add-table').appendChild(box);   // 模拟抽屉重渲染把它卷走
    assert.ok(box.closest('.d-drawer'), '前提：此刻控件确实在抽屉里');

    await sleep(1300);                                   // 一拍心跳
    const now = doc.getElementById('dyc-xhs-locate');
    assert.ok(now, '控件被拆后必须重挂回来');
    assert.equal(now.closest('.d-drawer'), null, '不许留在抽屉里');
    assert.equal(now.parentElement.id, 'row', '要回到工具栏那一行');
    win.close();
  });

}

/* ============================================================
 * B. 序号口径（只认序号框的值）
 * ============================================================ */
async function testSerial() {
  console.log('\nB. 序号口径');

  await check('B1 按序号框的值匹配，不按列表位次', async () => {
    /* 序号框的值 = [7,8,9,10,...]，位次 = 1,2,3,4,... —— 两者刻意错开。
     * 输入 10 必须命中第 4 张（值 10），而不是第 10 张（不存在）。 */
    const serials = [7, 8, 9, 10, 11, 12, 13, 14, 15, 16];
    const { win, doc } = makeDom(pageHtml(serials));
    win.eval(LOCATE);
    await sleep(40);

    const input = doc.getElementById('dyc-xhs-locate-input');
    input.value = '10';
    doc.getElementById('dyc-xhs-locate-go').click();
    await sleep(700);

    const st = lastStatus(win);
    assert.ok(st, '没有出消息');
    assert.equal(st.t, 'success', '应成功，实际：' + st.t + ' / ' + st.m);
    assert.equal(st.m, '第 10 号商品', '命中的应是序号框值为 10 的那张卡');
    assert.equal(st.o.count, '10/10', '右端应是「序号/总数」');
    win.close();
  });

  await check('B2 值里没有这个序号：报超范围，且一格都不滚', async () => {
    const { win, doc } = makeDom(pageHtml([7, 8, 9, 10, 11]));
    win.eval(LOCATE);
    await sleep(40);

    const list = doc.querySelector('.goods-card-list');
    doc.getElementById('dyc-xhs-locate-input').value = '1';
    doc.getElementById('dyc-xhs-locate-go').click();
    await sleep(400);

    const st = lastStatus(win);
    assert.equal(st.t, 'warning');
    assert.ok(/超出范围/.test(st.m), '应报超范围，实际：' + st.m);
    assert.ok(/共 5 个/.test(st.m), '超范围文案要带总数');
    assert.equal(list.scrollTop, 0, '没命中就不该滚动');
    win.close();
  });

  await check('B3 序号框读不到 → 明说「没读到卡片序号」，不按位次猜', async () => {
    const { win, doc } = makeDom(pageHtml([1, 2, 3], { withInput: false }));
    win.eval(LOCATE);
    await sleep(40);

    const list = doc.querySelector('.goods-card-list');
    doc.getElementById('dyc-xhs-locate-input').value = '2';
    doc.getElementById('dyc-xhs-locate-go').click();
    await sleep(400);

    const st = lastStatus(win);
    assert.equal(st.t, 'error');
    assert.ok(/没读到卡片序号/.test(st.m), '应报读不到序号，实际：' + st.m);
    assert.ok(st.o.full && /不猜/.test(st.o.full), '长文案要讲清「读不到就不猜」');
    assert.equal(list.scrollTop, 0, '读不到序号时不许按位次滚');
    win.close();
  });

  await check('B4 非数字输入：提示先输入序号，不滚', async () => {
    const { win, doc } = makeDom(pageHtml([1, 2]));
    win.eval(LOCATE);
    await sleep(40);

    doc.getElementById('dyc-xhs-locate-input').value = 'abc';
    doc.getElementById('dyc-xhs-locate-go').click();
    await sleep(350);

    const st = lastStatus(win);
    assert.equal(st.t, 'warning');
    assert.equal(st.m, '请先输入商品序号');
    assert.equal(doc.querySelector('.goods-card-list').scrollTop, 0);
    win.close();
  });

  await check('B5 成功消息三段式：来源已登记、值=商品名、结果数=序号/总数', async () => {
    const { win, doc } = makeDom(pageHtml([3, 4, 5]));
    win.eval(LOCATE);
    await sleep(40);

    doc.getElementById('dyc-xhs-locate-input').value = '4';
    doc.getElementById('dyc-xhs-locate-go').click();
    await sleep(700);

    const st = lastStatus(win);
    assert.equal(st.o.source, '序号定位', '来源词必须是已登记的「序号定位」');
    assert.ok(DOC_RULES.indexOf('序号定位') > -1, '来源词要出现在用户要求第 21 条的词表里');
    assert.equal(st.o.count, '4/3');
    assert.equal(st.o.standalone, true, '带 count 的结果必须 standalone，防原地合并丢条');
    assert.equal(st.m, '第 4 号商品');
    win.close();
  });
}

/* ============================================================
 * C. 滚动与高亮
 * ============================================================ */
async function testReveal() {
  console.log('\nC. 滚动与高亮');

  await check('C1 内层商品列表把目标卡滚到可视区中间', async () => {
    const serials = [7, 8, 9, 10, 11, 12, 13, 14, 15, 16];
    const { win, doc } = makeDom(pageHtml(serials));
    win.eval(LOCATE);
    await sleep(40);

    const list = doc.querySelector('.goods-card-list');
    doc.getElementById('dyc-xhs-locate-input').value = '10';   // 第 4 张卡，top=585
    doc.getElementById('dyc-xhs-locate-go').click();
    await sleep(800);

    /* 期望：585 - (711 - 195)/2 = 327 */
    assert.ok(Math.abs(list.scrollTop - 327) <= 8,
      '落点应在 327 附近，实际 ' + list.scrollTop);
    win.close();
  });

  await check('C2 高亮 = body 上的 fixed 覆盖层，不往卡片里插节点，3 秒后自清', async () => {
    const { win, doc } = makeDom(pageHtml([1, 2, 3]));
    win.eval(LOCATE);
    await sleep(40);

    doc.getElementById('dyc-xhs-locate-input').value = '2';
    doc.getElementById('dyc-xhs-locate-go').click();
    await sleep(700);

    const glow = doc.getElementById('dyc-xhs-locate-glow');
    assert.ok(glow, '没点亮高亮');
    assert.equal(glow.parentNode, doc.body, '覆盖层必须挂在 body（不碰 React 管的卡片）');
    assert.equal(doc.querySelectorAll('.goods-card .dyc-xhs-locate-glow').length, 0,
      '不许往商品卡里插节点');
    const css = doc.getElementById('dyc-xhs-locate-style');
    assert.ok(css, '缺样式表');
    assert.ok(/#dyc-xhs-locate-glow \{[^}]*position: fixed/.test(css.textContent),
      '覆盖层必须 fixed：卡片是 React 管的，改 position 会被重置');

    /* 高亮在滚动落点校验之后才起（≈480ms），所以这里要等 3 秒 + 落点延迟 */
    await sleep(3100);
    assert.equal(doc.getElementById('dyc-xhs-locate-glow'), null, '高亮应自动移除，不留残影');
    win.close();
  });
}

/* ============================================================
 * D. 心跳补插
 * ============================================================ */
async function testHeartbeat() {
  console.log('\nD. 心跳补插');

  await check('D1 平台重渲染抹掉控件后，1 秒内心跳补回', async () => {
    const { win, doc } = makeDom(pageHtml([1, 2]));
    win.eval(LOCATE);
    await sleep(40);
    const box = doc.getElementById('dyc-xhs-locate');
    assert.ok(box, '初始没挂上');

    box.parentNode.removeChild(box);        // 模拟 React 重渲染
    await sleep(1300);
    assert.ok(doc.getElementById('dyc-xhs-locate'), '心跳没把控件补回来');
    win.close();
  });
}

/* ============================================================
 * E. 开关与注入
 * ============================================================ */
async function testWiring() {
  console.log('\nE. 开关与注入');

  const vm = require('vm');
  const at = FLAGS_CODE.indexOf('var DYC_FLAGS_META =');
  assert.ok(at >= 0, '源码里没找到 var DYC_FLAGS_META');
  let depth = 0, opened = false, end = -1;
  for (let i = at; i < FLAGS_CODE.length; i++) {
    const c = FLAGS_CODE[i];
    if (c === '{' || c === '[') { depth++; opened = true; }
    else if (c === '}' || c === ']') { depth--; if (opened && depth === 0) { end = FLAGS_CODE.indexOf(';', i); break; } }
  }
  assert.ok(end > at, 'DYC_FLAGS_META 没有闭合');
  const ctx = vm.createContext({ console: { log() {} } });
  vm.runInContext(FLAGS_CODE.slice(at, end + 1), ctx);

  await check('E1 xhsLocate 归 xhsLive、作用页只认 xhsCtrl、默认开', () => {
    const meta = ctx.DYC_FLAGS_META.find((m) => m.key === 'xhsLocate');
    assert.ok(meta, '缺开关 xhsLocate');
    assert.equal(meta.group, 'xhsLive', '应归小红书中控台组');
    assert.deepEqual(Array.from(meta.pages), ['xhsCtrl'], '作用页只能是中控台');
    assert.equal(meta.default, true, '默认应开启');
    assert.ok(/序号/.test(meta.label), 'label 要能看出是序号定位：' + meta.label);
  });

  await check('E2 manifest：脚本在小红书条目里，排在 debug-panel 之前、flags 之后', () => {
    const entry = MANIFEST.content_scripts.find(
      (cs) => (cs.matches || []).some((m) => m.indexOf('pgy.xiaohongshu.com') > -1));
    assert.ok(entry, '找不到小红书注入条目');
    const js = entry.js;
    const iSelf = js.indexOf('src/live/xhs-locate.js');
    assert.ok(iSelf > -1, '脚本没进注入清单');
    assert.equal(js.indexOf('src/content/flags.js'), 0, 'flags.js 必须第 0 位');
    assert.ok(iSelf > js.indexOf('src/content/dialog.js'), '必须排在 dialog.js 之后（要用 setStatus）');
    assert.ok(iSelf < js.indexOf('src/content/debug-panel.js'), '功能脚本必须排在 debug-panel 之前');
  });

  await check('E3 源码不得同步取用 dycReadFlags（它返回 Promise）', () => {
    const strip = (code) => code
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
    const bare = strip(LOCATE);
    assert.ok(!/flags\s*=\s*dycReadFlags\(\)/.test(bare), '仍在同步取用，会拿到 Promise');
    assert.ok(/dycReadFlags\(\)\s*\.then/.test(bare), '没有走 .then');
  });

  await check('E4 往页面读数据只用 data-* 判据（AGENTS 第 23 条）', () => {
    /* 本功能不往卡里插节点，但仍按纪律留口：读序号文本要跳扩展节点 */
    assert.ok(/ownText\(/.test(LOCATE), '读页面文本必须经 ownText（整棵跳过扩展节点）');
    assert.ok(/data-dyc-skip/.test(LOCATE), '扩展节点要打 data-dyc-skip 标记');
  });
}

/* ============================================================
 * 跑
 * ============================================================ */
(async function main() {
  console.log('小红书 · 商品序号定位 自测');
  await testPlacement();
  await testSerial();
  await testReveal();
  await testHeartbeat();
  await testWiring();

  console.log('\n通过 ' + pass + ' 条');
  process.exit(0);
})().catch((e) => {
  console.error('\n失败：' + (e && e.stack || e));
  process.exit(1);
});
