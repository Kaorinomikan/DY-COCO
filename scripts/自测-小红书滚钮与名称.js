/**
 * 小红书 · 滚动按钮与商品名完整显示（2026-11-17 建）
 * ============================================================
 * 被测文件：src/live/xhs-scroll.js、src/live/xhs-name-wrap.js、
 *           src/content/flags.js（四个新开关）、manifest.json（注入顺序）
 *
 * 背景：用户 2026-11-17 定「小红书专用行」（不复用抖店同名开关），
 *   第一批做两项，拖拽猫爪明确不做（小红书没有拖拽功能）。
 *
 * 覆盖：
 *   A. 滚动按钮 —— 可滚容器收集、顶/底判定、显隐、点击归零、总闸门控
 *   B. 名称完整 —— 真截断判定、属性写法、祖先条件升级、还原、幂等重涂
 *   B1.5 「添加商品」抽屉表格列表 —— 作用域、解 nowrap、行高放开、防误伤全页
 *   C. 开关与注入 —— 四个 key 归 xhsLive 组、作用页 xhsCtrl、脚本在 manifest 里
 *
 * 做法：jsdom + 受控几何（clientHeight/scrollHeight 都是 0，必须显式给值），
 *   getComputedStyle 用 Proxy 局部覆盖（jsdom 不实现 -webkit-line-clamp）。
 *   与 scripts/自测-中控台作用域.js 同风格：断言只约束最终行为。
 *
 * 用法：node scripts/自测-小红书滚钮与名称.js  （退出码 0 = 全绿）
 * ============================================================
 */
'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert/strict');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const SCROLL = read('src/live/xhs-scroll.js');
const COPY = read('src/live/xhs-copy-code.js');
const ITEM = read('src/content/item-code.js');
const NAME = read('src/live/xhs-name-wrap.js');
const MANIFEST = JSON.parse(read('manifest.json'));

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

function makeDom(html) {
  const dom = new JSDOM(html, { url: CTRL_URL, pretendToBeVisual: true, runScripts: 'outside-only' });
  const win = dom.window;
  /* jsdom 的 getClientRects 返回空数组，会被名称模块当成「不可见」跳过 */
  win.Element.prototype.getClientRects = function () { return [{ width: 10, height: 10 }]; };
  win.DYC_PAGE_PATTERNS = { xhsCtrl: /^https:\/\/pgy\.xiaohongshu\.com\/commerce\/redlive\// };
  win.__watchers = [];
  win.__flags = {};
  win.__copied = '';
  win.navigator.clipboard = { writeText: (t) => { win.__copied = t; return Promise.resolve(); } };
  /* ★ mock 必须与真实签名一致：dycReadFlags() 返回 **Promise**（flags.js:1297）。
   *   2026-11-17 事故：第一版把这里 mock 成同步返回，源码里同步取用就永远
   *   拿到真值之外的 Promise，实机两个功能全黑，而 13 条断言全绿。
   *   自测的 mock 比真机宽松 = 假绿，这条坑工程里记过一次（素材页 getComputedStyle）。 */
  win.dycReadFlags = () => Promise.resolve(win.__flags);
  win.dycWatchFlags = (cb) => { win.__watchers.push(cb); };
  return { dom, win, doc: win.document };
}

/* ============================================================
 * A. 滚动按钮
 * ============================================================ */
async function testScroll() {
  console.log('\nA. 滚动按钮');

  await check('页面不可滚时两枚均不出现在视口（host 隐藏）', async () => {
    const { win, doc } = makeDom('<!doctype html><body><div class="empty"></div></body>');
    win.__flags = { xhsScrollBtns: true, xhsBackToTop: true, xhsBackToBottom: true };
    win.eval(SCROLL);
    await sleep(30);
    const host = doc.getElementById('dyb-xhs-scroll');
    assert.ok(host, '宿主节点没建出来');
    assert.equal(host.style.display, 'none', '没有可滚容器时不该显示按钮');
    win.close();
  });

  await check('可滚容器在顶：只出「下滑到底」，点它滚到 max', async () => {
    const { win, doc } = makeDom('<!doctype html><body><div id="box"></div></body>');
    const box = doc.getElementById('box');
    box.style.overflowY = 'auto';
    geo(box, { clientHeight: 849, scrollHeight: 984, clientWidth: 1440, scrollWidth: 1440, scrollTop: 0 });
    win.__flags = { xhsScrollBtns: true, xhsBackToTop: true, xhsBackToBottom: true };
    win.eval(SCROLL);
    await sleep(30);

    const host = doc.getElementById('dyb-xhs-scroll');
    const up = host.querySelector('[data-role="up"]');
    const down = host.querySelector('[data-role="down"]');
    /* 2026-11-17 第四轮用户定：两枚同时常显，不再按顶/底隐显 */
    assert.equal(up.style.display, 'flex', '在顶部也要显示上滑钮');
    assert.equal(down.style.display, 'flex', '在顶部要显示下滑钮');

    down.click();
    await sleep(420);            // 自驱动画 300ms + 余量
    assert.equal(box.scrollTop, 135, '应滚到 984-849=135');
    assert.equal(down.style.display, 'flex', '到底后仍要显示下滑钮');
    assert.equal(up.style.display, 'flex', '到底后仍要显示上滑钮');
    win.close();
  });

  await check('总闸关：宿主节点被移除（不是仅隐藏）', async () => {
    const { win, doc } = makeDom('<!doctype html><body><div id="box"></div></body>');
    const box = doc.getElementById('box');
    box.style.overflowY = 'auto';
    geo(box, { clientHeight: 400, scrollHeight: 2000, clientWidth: 800, scrollWidth: 800, scrollTop: 200 });
    win.__flags = { xhsScrollBtns: true, xhsBackToTop: true, xhsBackToBottom: true };
    win.eval(SCROLL);
    await sleep(30);
    assert.ok(doc.getElementById('dyb-xhs-scroll'), '总闸开时应挂上');

    win.__flags = { xhsScrollBtns: false, xhsBackToTop: true, xhsBackToBottom: true };
    win.__watchers.forEach((cb) => cb(win.__flags));
    await sleep(30);
    assert.equal(doc.getElementById('dyb-xhs-scroll'), null, '总闸关应移除宿主，避免残留空壳');
    win.close();
  });

  await check('子开关各自独立：关掉上滑不影响下滑', async () => {
    const { win, doc } = makeDom('<!doctype html><body><div id="box"></div></body>');
    const box = doc.getElementById('box');
    box.style.overflowY = 'auto';
    geo(box, { clientHeight: 400, scrollHeight: 2000, clientWidth: 800, scrollWidth: 800, scrollTop: 200 });
    win.__flags = { xhsScrollBtns: true, xhsBackToTop: false, xhsBackToBottom: true };
    win.eval(SCROLL);
    await sleep(30);
    const host = doc.getElementById('dyb-xhs-scroll');
    assert.equal(host.querySelector('[data-role="up"]').style.display, 'none');
    assert.equal(host.querySelector('[data-role="down"]').style.display, 'flex');
    win.close();
  });

  await check('两枚按钮尺寸一致且样式全内联（不依赖 <style> / shadow）', async () => {
    /* 2026-11-17 真机：样式寄存在 shadow 的 <style> 里，一旦那条不生效，
     * 按钮就退回浏览器默认排布 —— 用户看到的就是「大小不一样、糊在一起」。
     * 现在 position/尺寸/flex 全部内联，这条盯着「不许再依赖样式表」。 */
    const { win, doc } = makeDom('<!doctype html><body><div id="box"></div></body>');
    const box = doc.getElementById('box');
    box.style.overflowY = 'auto';
    geo(box, { clientHeight: 849, scrollHeight: 984, clientWidth: 1440, scrollWidth: 1440, scrollTop: 0 });
    win.__flags = { xhsScrollBtns: true, xhsBackToTop: true, xhsBackToBottom: true };
    win.eval(SCROLL);
    await sleep(30);

    const host = doc.getElementById('dyb-xhs-scroll');
    assert.ok(host, '宿主没建出来');
    assert.equal(host.style.position, 'fixed', '必须固定定位（由内联保证）');
    assert.equal(host.style.display, 'flex');
    assert.equal(host.style.flexDirection, 'column', '两枚必须纵排，不许挤成一行');
    assert.ok(!host.shadowRoot, '不该再用 shadow：普通 DOM 才能被开发者工具直接选中');
    assert.equal(host.style.right, '72px', '默认位置距浏览器右边界留出余量');

    const up = host.querySelector('[data-role="up"]');
    const down = host.querySelector('[data-role="down"]');
    assert.equal(up.style.width, '52.8px', '直径对齐抖店 52.8');
    assert.equal(down.style.width, '52.8px');
    assert.equal(parseFloat(up.style.opacity), 0.55, '常态半透明对齐抖店');
    assert.ok(/0 2px 8px/.test(up.style.boxShadow), '要有抖店同款阴影');
    assert.equal(up.style.height, down.style.height, '两枚尺寸必须一模一样');
    assert.equal(up.style.flex, '0 0 52.8px', '要防 flex 压缩，否则两枚会被挤成不同高度');
    win.close();
  });

  await check('嵌套滚动容器一起滚（第一版只滚外层，内层商品列表没动）', async () => {
    /* 2026-11-17 真机：外层 .control-container 只多 135px，内层 .goods-card-list
     * 内容 28382 —— 第一版把内层当「嵌套」丢掉，点下去画面几乎不动。
     * 现在必须两层都归位。 */
    const { win, doc } = makeDom('<!doctype html><body><div id="outer"><div id="inner"></div></div></body>');
    const outer = doc.getElementById('outer');
    const inner = doc.getElementById('inner');
    outer.style.overflowY = 'auto';
    inner.style.overflowY = 'auto';
    geo(outer, { clientHeight: 849, scrollHeight: 984, clientWidth: 1440, scrollWidth: 1440, scrollTop: 0 });
    geo(inner, { clientHeight: 711, scrollHeight: 28382, clientWidth: 1112, scrollWidth: 1112, scrollTop: 0 });
    win.__flags = { xhsScrollBtns: true, xhsBackToTop: true, xhsBackToBottom: true };
    win.eval(SCROLL);
    await sleep(30);

    doc.getElementById('dyb-xhs-scroll').querySelector('[data-role="down"]').click();
    await sleep(420);
    assert.equal(outer.scrollTop, 135, '外层应到底');
    assert.equal(inner.scrollTop, 27671, '内层商品列表也必须到底 —— 这才是用户要看的那一层');
    win.close();
  });

  await check('点击时重扫：商品列表后到（首扫只有外壳）也能滚到底', async () => {
    /* 2026-11-17 真机根因：中控台先出页面外壳（.control-container，只能滚 135px），
     * 19 张商品卡后到并被 React 换节点。旧实现只信首次 bind 的快照
     * ⇒ 点下去要么只把外壳滚 135px（画面几乎不动），要么目标已脱连直接静默返回 ——
     * 用户看到的就是「上下滑动按钮失效」。 */
    const { win, doc } = makeDom('<!doctype html><body><div id="outer"></div></body>');
    const outer = doc.getElementById('outer');
    outer.style.overflowY = 'auto';
    geo(outer, { clientHeight: 849, scrollHeight: 984, clientWidth: 1440, scrollWidth: 1440, scrollTop: 0 });
    win.__flags = { xhsScrollBtns: true, xhsBackToTop: true, xhsBackToBottom: true };
    win.eval(SCROLL);
    await sleep(30);

    /* 列表后到：插入时 scrollers 已非空，MutationObserver 不会重扫 */
    const inner = doc.createElement('div');
    inner.className = 'goods-card-list';
    inner.style.overflowY = 'scroll';
    outer.appendChild(inner);
    geo(inner, { clientHeight: 672, scrollHeight: 3653, clientWidth: 1112, scrollWidth: 1112, scrollTop: 0 });

    doc.getElementById('dyb-xhs-scroll').querySelector('[data-role="down"]').click();
    await sleep(500);
    assert.equal(inner.scrollTop, 2981, '点击必须重扫并把商品列表滚到底（3653-672=2981）');
    win.close();
  });

  await check('落点被平台改回：重试仍不动要报三段式消息（不许静默失效）', async () => {
    const { win, doc } = makeDom('<!doctype html><body><div id="box"></div></body>');
    const box = doc.getElementById('box');
    box.style.overflowY = 'auto';
    geo(box, { clientHeight: 400, scrollHeight: 2000, clientWidth: 800, scrollWidth: 800, scrollTop: 0 });
    /* 模拟中控台把 scrollTop 立刻写回 0（写入无效） */
    Object.defineProperty(box, 'scrollTop', { get() { return 0; }, set() {}, configurable: true });
    const said = [];
    win.setStatus = (m, t, o) => said.push({ m, t, o });
    win.__flags = { xhsScrollBtns: true, xhsBackToTop: true, xhsBackToBottom: true };
    win.eval(SCROLL);
    await sleep(30);

    doc.getElementById('dyb-xhs-scroll').querySelector('[data-role="down"]').click();
    await sleep(900);
    assert.equal(said.length, 1, '滚不动时必须留一条消息，且只一条');
    assert.equal(said[0].t, 'warning');
    assert.equal(said[0].o.source, '滚动按钮');
    assert.equal(said[0].o.count, '未滚到底');
    win.close();
  });

  await check('不在中控台页：不挂按钮', async () => {
    const { win, doc } = makeDom('<!doctype html><body><div id="box"></div></body>');
    const box = doc.getElementById('box');
    box.style.overflowY = 'auto';
    geo(box, { clientHeight: 400, scrollHeight: 2000, clientWidth: 800, scrollWidth: 800, scrollTop: 200 });
    win.__flags = { xhsScrollBtns: true, xhsBackToTop: true, xhsBackToBottom: true };
    win.DYC_PAGE_PATTERNS = { xhsCtrl: /^https:\/\/ark\.xiaohongshu\.com\/never\// };
    win.eval(SCROLL);
    await sleep(30);
    assert.equal(doc.getElementById('dyb-xhs-scroll'), null, '千帆页不该出现中控台滚动钮');
    win.close();
  });
}

/* ============================================================
 * B. 商品名完整显示（第三版：样式表方案）
 * ============================================================ */
function buildCard(doc) {
  const card = doc.createElement('div');
  card.className = 'goods-card goods-card--dual-identity';
  card.innerHTML = '<div class="goods-card__info-row"><div class="goods-card__base">'
    + '<div class="goods-card__title-block">'
    + '<span class="d-text --color-static --color-text-title">很长很长的商品名称用来测换行</span>'
    + '<span class="d-text --color-static --color-text-description">这是一段描述文字</span>'
    + '</div></div></div>';
  doc.body.appendChild(card);
  return card;
}

async function testName() {
  console.log('\nB. 商品名完整显示（样式表方案）');

  await check('开：注入样式表，且解钳制规则齐全（含 !important 高度）', async () => {
    const { win, doc } = makeDom('<!doctype html><body></body>');
    win.__flags = { xhsNameWrap: true };
    win.eval(NAME);
    await sleep(50);
    const st = doc.getElementById('dyc-xhs-namewrap-style');
    assert.ok(st, '样式表没注入');
    /* 第三轮真机教训：盒高被平台 !important 钉在 44px，文字溢出盖住商品 ID
     * ⇒ 高度三件套必须都在，且都带 !important */
    assert.ok(/-webkit-line-clamp:\s*unset !important/.test(st.textContent), '缺解钳制');
    assert.ok(/height:\s*auto !important/.test(st.textContent), '缺 height:auto !important');
    assert.ok(/max-height:\s*none !important/.test(st.textContent), '缺 max-height 解除');
    assert.ok(/min-height:\s*0 !important/.test(st.textContent), '缺 min-height 归零');
    win.close();
  });

  await check('选择器只打名称（--color-text-title），描述不受影响', async () => {
    const { win, doc } = makeDom('<!doctype html><body></body>');
    win.__flags = { xhsNameWrap: true };
    win.eval(NAME);
    await sleep(50);
    const st = doc.getElementById('dyc-xhs-namewrap-style').textContent;
    assert.ok(st.includes('.goods-card__title-block > span.d-text.--color-text-title'),
      '名称选择器必须限定在 title-block 内的 title 类');
    /* 注释里会提到描述的类名（说明为什么不误伤），断言只看规则本体 */
    const bare = st.replace(/\/\*[\s\S]*?\*\//g, '');   // 此处 st 已是样式表文本
    assert.ok(!bare.includes('--color-text-description'), '不许把描述也展开');
    win.close();
  });

  await check('关：样式表整条移除，不留残余', async () => {
    const { win, doc } = makeDom('<!doctype html><body></body>');
    win.__flags = { xhsNameWrap: true };
    win.eval(NAME);
    await sleep(30);
    assert.ok(doc.getElementById('dyc-xhs-namewrap-style'), '先确认已注入');

    win.__flags = { xhsNameWrap: false };
    win.__watchers.forEach((cb) => cb(win.__flags));
    await sleep(30);
    assert.equal(doc.getElementById('dyc-xhs-namewrap-style'), null, '关掉必须整条移除');
    win.close();
  });

  await check('平台重渲染不影响：样式表按类命中，不与 React 竞争', async () => {
    const { win, doc } = makeDom('<!doctype html><body></body>');
    const card = buildCard(doc);
    win.__flags = { xhsNameWrap: true };
    win.eval(NAME);
    await sleep(30);
    /* 模拟 React 重渲染：把卡片连内联样式整个重建一遍 */
    card.querySelector('span').style.cssText = '';
    card.outerHTML = card.outerHTML;
    await sleep(30);
    assert.ok(doc.getElementById('dyc-xhs-namewrap-style'), '样式表仍在 —— 这就是不再竞争的原因');
    win.close();
  });
}

/* ============================================================
 * B1.5 「添加商品」抽屉的表格列表（第四版，2026-11-17 夜）
 * ============================================================
 * 结构与类名全部取自 2026-11-17 结构报告：
 *   .add-goods-table > .d-table-wrapper > .d-grid.d-table > .d-grid-item.d-td
 *   单元格内 .d-space.d-space-horizontal > .goods-base.goods-base-sample
 *            > .goods-title > div > span.d-text.--color-static
 * 夹具按这份结构搭 —— 选择器写错一个类名，这条就会红（比只看 CSS 文本硬）
 * ============================================================ */
function buildAddTableRow(doc, name) {
  const table = doc.createElement('div');
  table.className = 'add-goods-table';
  table.innerHTML = '<div class="d-table-wrapper"><div class="d-grid d-table">'
    + '<div class="d-grid-item d-th --color-bg-fill-opaque"><div class="d-grid d-checkbox">'
    + '<span class="d-checkbox-simulator"></span></div></div>'
    + '<div class="d-grid-item d-td"><div class="d-space d-space-horizontal">'
    + '<div class="goods-base goods-base-sample">'
    + '<div class="goods-title"><div><span class="d-text --color-static">'
    + (name || '很长很长的商品名称一直写到被平台裁成省略号为止')
    + '</span></div></div></div></div></div>'
    + '</div></div>';
  doc.body.appendChild(table);
  return table;
}

async function testAddTable() {
  console.log('\nB1.5 「添加商品」表格列表');

  await check('选择器与真机结构对得上（类名错一个就红）', async () => {
    const { win, doc } = makeDom('<!doctype html><body></body>');
    buildAddTableRow(doc);
    win.__flags = { xhsNameWrap: true };
    win.eval(NAME);
    await sleep(50);
    /* 表里那条名称，必须真能被这条作用域命中 */
    assert.ok(doc.querySelector('.goods-base-sample .goods-title .d-text'),
      '名称选择器命不中真机结构');
    assert.ok(doc.querySelector('.d-grid-item.d-td .goods-base-sample'),
      '单元格选择器命不中真机结构');
    win.close();
  });

  await check('解 nowrap + 去省略号（这一处截断来源是 ellipsis/nowrap，不是 line-clamp）', async () => {
    const { win, doc } = makeDom('<!doctype html><body></body>');
    win.__flags = { xhsNameWrap: true };
    win.eval(NAME);
    await sleep(50);
    const css = doc.getElementById('dyc-xhs-namewrap-style').textContent;
    const block = css.slice(css.indexOf('.goods-base-sample .goods-title .d-text'),
      css.indexOf('.goods-base-sample .goods-title,'));
    assert.ok(block.length > 0, '找不到名称规则块');
    assert.ok(/white-space:\s*normal !important/.test(block), '缺解 nowrap —— 文字不会折行');
    assert.ok(/text-overflow:\s*clip !important/.test(block), '缺去省略号');
    assert.ok(/overflow:\s*visible !important/.test(block), '缺放开溢出裁剪');
    win.close();
  });

  await check('行高与单元格一起放开（否则折行不撑高，直接压到下一行）', async () => {
    const { win, doc } = makeDom('<!doctype html><body></body>');
    win.__flags = { xhsNameWrap: true };
    win.eval(NAME);
    await sleep(50);
    const css = doc.getElementById('dyc-xhs-namewrap-style').textContent;
    /* 必须是 minmax(39px, auto) 而不是赤裸的 auto：
     * 2026-11-17 无头实测，只写 auto 会把整张表压扁（195→132px），
     * 平台给的行间距被我们吃掉 —— 下限就是平台原行高。 */
    assert.ok(/grid-auto-rows:\s*minmax\(39px,\s*auto\) !important/.test(css),
      '行轨道必须保留平台原行高作下限；只写 auto 会把整张表压扁');
    assert.ok(/\.d-grid-item\.d-td:has\(\.goods-base-sample\)/.test(css),
      '缺单元格放开规则（只命中装名称的那一格）');
    win.close();
  });

  await check('不许出现无作用域的通用类规则（.d-text / .--color-static 全页通用）', async () => {
    const { win, doc } = makeDom('<!doctype html><body></body>');
    win.__flags = { xhsNameWrap: true };
    win.eval(NAME);
    await sleep(50);
    const css = doc.getElementById('dyc-xhs-namewrap-style').textContent;
    /* 先剥注释（注释里本来就会提到通用类名），再逐条看选择器 */
    const bare = css.replace(/\/\*[\s\S]*?\*\//g, '');
    const selectors = bare.split('}')
      .map((chunk) => chunk.split('{')[0].trim())
      .filter(Boolean)
      .flatMap((sel) => sel.split(',').map((s) => s.trim()))
      .filter(Boolean);
    const loose = selectors.filter((sel) => sel.indexOf('.d-text') > -1
      || sel.indexOf('--color-static') > -1)
      .filter((sel) => !/\.goods-base-sample|\.goods-card__title-block/.test(sel));
    assert.deepEqual(loose, [],
      '这些选择器没有作用域，会把整页文本都改成换行：' + loose.join(' | '));
    win.close();
  });

  await check('两套规则共存：加了表格规则，卡片规则没被挤掉', async () => {
    const { win, doc } = makeDom('<!doctype html><body></body>');
    win.__flags = { xhsNameWrap: true };
    win.eval(NAME);
    await sleep(50);
    const css = doc.getElementById('dyc-xhs-namewrap-style').textContent;
    assert.ok(css.includes('.goods-card__title-block > span.d-text.--color-text-title'),
      '卡片名称规则丢了');
    assert.ok(css.includes('.goods-base-sample .goods-title .d-text'),
      '表格名称规则没写进去');
    win.close();
  });

  await check('同一个开关：关掉两套规则一起消失', async () => {
    const { win, doc } = makeDom('<!doctype html><body></body>');
    buildAddTableRow(doc);
    win.__flags = { xhsNameWrap: true };
    win.eval(NAME);
    await sleep(30);
    assert.ok(doc.getElementById('dyc-xhs-namewrap-style'), '先确认已注入');
    win.__flags = { xhsNameWrap: false };
    win.__watchers.forEach((cb) => cb(win.__flags));
    await sleep(30);
    assert.equal(doc.getElementById('dyc-xhs-namewrap-style'), null,
      '关掉开关后表格里的名称必须回到平台原样');
    win.close();
  });
}

/* ============================================================
 * B2. 复制货号（UI 照搬巨量百应中控台 copy-code）
 * ============================================================ */
function buildCardWithId(doc, id) {
  const card = doc.createElement('div');
  card.className = 'goods-card';
  card.innerHTML = '<div class="goods-card__info-row">'
    + '<div class="goods-card__title-block">'
    + '<span class="d-text --color-text-title">商品名称甲乙丙 ' + id + '</span>'
    + '<div class="goods-card__subtitle-row"><a class="d-text d-link">' + id + '</a></div>'
    + '</div></div>'
    + '<div class="goods-card__action-row"><button class="goods-card__action-btn">下架</button></div>';
  doc.body.appendChild(card);
  return card;
}

/**
 * 按 manifest 的顺序加载：item-code.js（判据唯一真源）先，功能脚本后。
 * 顺序本身有断言（见 C 组）—— 这里模拟真实加载，避免自测比真机宽松。
 */
function loadCopy(win) {
  win.eval(ITEM);
  win.eval(COPY);
}

async function testCopyCode() {
  console.log('\nB2. 复制货号');

  await check('按钮落在商品名称块右下角：自建行靠右，不占底部操作区', async () => {
    const { win, doc } = makeDom('<!doctype html><body></body>');
    buildCardWithId(doc, '748392');
    win.__flags = { xhsCopyCode: true };
    loadCopy(win);
    await sleep(500);            // MO 防抖 300ms
    const block = doc.querySelector('.goods-card__title-block');
    const btn = block.querySelector('.dyc-xhs-copycode');
    assert.ok(btn, '按钮没进名称块（用户 21:5x 定稿的落点）');
    assert.equal(btn.textContent, '货号');
    assert.ok(btn.parentElement.classList.contains('dyc-xhs-code-row'),
      '应包在靠右的自建行里，否则不会贴到右侧');
    assert.equal(doc.querySelector('.goods-card__action-row .dyc-xhs-copycode'), null,
      '不该再留在卡片底部操作区');
    win.close();
  });

  await check('名称块最后一行是 flex 时直接搭车，不新增行（卡片不变高）', async () => {
    const { win, doc } = makeDom('<!doctype html><body></body>');
    const card = buildCardWithId(doc, '748392');
    const lastRow = card.querySelector('.goods-card__subtitle-row');
    lastRow.style.display = 'flex';          // 模拟「添加推荐语」那种行内动作行
    win.__flags = { xhsCopyCode: true };
    loadCopy(win);
    await sleep(500);
    const btn = lastRow.querySelector('.dyc-xhs-copycode');
    assert.ok(btn, '按钮应塞进最后一行');
    assert.ok(btn.classList.contains('is-inline'), '需要 is-inline 才能被 margin-left:auto 推到右端');
    assert.equal(doc.querySelector('.dyc-xhs-code-row'), null, '不该多出一行把卡片撑高');
    win.close();
  });

  await check('卡上没有名称块时退回底部操作区（按钮不消失）', async () => {
    const { win, doc } = makeDom('<!doctype html><body></body>');
    const card = doc.createElement('div');
    card.className = 'goods-card';
    card.innerHTML = '<div class="goods-card__action-row">'
      + '<button class="goods-card__action-btn">下架</button></div>';
    doc.body.appendChild(card);
    win.__flags = { xhsCopyCode: true };
    loadCopy(win);
    await sleep(500);
    const row = doc.querySelector('.goods-card__action-row');
    assert.ok(row.querySelector('.dyc-xhs-copycode'), '兜底也必须把按钮挂上');
    assert.equal(row.querySelector('.dyc-xhs-copycode').nextElementSibling.className,
      'goods-card__action-btn', '兜底时排在平台按钮左侧');
    win.close();
  });

  await check('点击复制：来源是 subtitle-row 的商品 ID', async () => {
    const { win, doc } = makeDom('<!doctype html><body></body>');
    buildCardWithId(doc, '748392');
    win.__flags = { xhsCopyCode: true };
    loadCopy(win);
    await sleep(500);
    const btn = doc.querySelector('.dyc-xhs-copycode');
    btn.click();
    await sleep(20);
    assert.equal(win.__copied, '748392', '复制的内容必须就是商品 ID');
    assert.equal(btn.textContent, '已复制', '按钮应原地反馈（与百应同文案）');
    win.close();
  });

  await check('链接不像 ID 时按名称尾部兜底（共享判据）', async () => {
    const { win, doc } = makeDom('<!doctype html><body></body>');
    const card = buildCardWithId(doc, '查看详情');
    const name = card.querySelector('.--color-text-title');
    name.textContent = '商品名称甲乙丙 748392';   // 名称尾部带货号
    win.__flags = { xhsCopyCode: true };
    loadCopy(win);
    await sleep(500);
    doc.querySelector('.dyc-xhs-copycode').click();
    await sleep(20);
    assert.equal(win.__copied, '748392', '应从名称尾部推算出货号');
    win.close();
  });

  await check('两条都取不到：不猜，按钮报「无货号」', async () => {
    const { win, doc } = makeDom('<!doctype html><body></body>');
    const card = buildCardWithId(doc, '查看详情');
    const name = card.querySelector('.--color-text-title');
    name.textContent = '纯中文没有货号';
    win.__flags = { xhsCopyCode: true };
    loadCopy(win);
    await sleep(500);
    win.__copied = '';
    doc.querySelector('.dyc-xhs-copycode').click();
    await sleep(20);
    assert.equal(win.__copied, '', '绝不复制错的东西');
    assert.equal(doc.querySelector('.dyc-xhs-copycode').textContent, '无货号',
      '按钮文案与百应一致');
    win.close();
  });
}

/* ============================================================
 * B3. 按钮外观与交互（2026-11-17 用户定：照搬巨量百应 UI）
 * ============================================================ */
async function testCopyCodeUI() {
  console.log('\nB3. 按钮 UI（照搬百应）');

  await check('样式表：两枚按钮统一高 22，蓝边蓝字、悬停反色、失败灰化、隔离', async () => {
    const { win, doc } = makeDom('<!doctype html><body></body>');
    buildCardWithId(doc, '748392');
    win.__flags = { xhsCopyCode: true };
    loadCopy(win);
    await sleep(500);
    const st = doc.getElementById('dyc-xhs-copycode-style');
    assert.ok(st, '样式表没注入');
    const css = st.textContent;
    assert.ok(/all:\s*initial/.test(css), '必须与平台样式隔离（铁律：注入控件不随页面缩放）');
    assert.ok(/width:\s*48px; height: 22px/.test(css), '货号 48×22（原 56×28 太大，用户要求缩）');
    assert.ok(/width:\s*32px; height: 22px/.test(css), 'ID 32×22（与货号同高 22，用户要求统一）');
    assert.ok(/flex:\s*0 0 auto/.test(css), 'all:initial 会把 flex-shrink 重置，必须锁宽');
    assert.ok(/#0075ff/.test(css), '蓝边蓝字取百应主色');
    assert.ok(/opacity:\s*\.?0?\.55/.test(css), '常态 55% 透明');
    assert.ok(/:hover[^}]*background:\s*#0075ff/.test(css), '悬停整块反色');
    assert.ok(/is-err[^}]*#86909c/.test(css), '失败态灰化');
    win.close();
  });

  await check('悬停说明三态：初始讲规则 / 取到标来源 / 取不到讲原因', async () => {
    const { win, doc } = makeDom('<!doctype html><body></body>');
    const card = buildCardWithId(doc, '748392');
    win.__flags = { xhsCopyCode: true };
    loadCopy(win);
    await sleep(500);
    const btn = doc.querySelector('.dyc-xhs-copycode');
    assert.ok(/优先取卡片上的商品 ID/.test(btn.title), '初始态要讲清取号规则');
    assert.ok(/商品名末尾/.test(btn.title), '初始态要点明兜底来源');

    btn.click();
    await sleep(20);
    assert.ok(/748392/.test(btn.title) && /卡片商品 ID/.test(btn.title),
      '取到时要标明来源是商品 ID');

    // 推算档：来源必须标成「推算」，不能让用户以为是平台货号
    const name = card.querySelector('.--color-text-title');
    name.textContent = '商品名称甲乙丙 748392';
    card.querySelector('.goods-card__subtitle-row a').textContent = '查看详情';
    btn.click();
    await sleep(20);
    assert.ok(/推算/.test(btn.title), '推算档必须标注「推算」');

    const { win: w2, doc: d2 } = makeDom('<!doctype html><body></body>');
    const c2 = buildCardWithId(d2, '查看详情');
    c2.querySelector('.--color-text-title').textContent = '纯中文没有货号';
    w2.__flags = { xhsCopyCode: true };
    loadCopy(w2);
    await sleep(500);
    const b2 = d2.querySelector('.dyc-xhs-copycode');
    b2.click();
    await sleep(20);
    assert.ok(/没找到货号/.test(b2.title) && /只认名称末尾/.test(b2.title),
      '取不到时要说清原因与限制');
    win.close();
    w2.close();
  });

  await check('点击后弹三段式消息（来源「货号复制」｜货号｜已复制）', async () => {
    const { win, doc } = makeDom('<!doctype html><body></body>');
    const calls = [];
    win.toast = (message, type, opts) => { calls.push({ message, type, opts: opts || {} }); };
    buildCardWithId(doc, '748392');
    win.__flags = { xhsCopyCode: true };
    loadCopy(win);
    await sleep(500);
    doc.querySelector('.dyc-xhs-copycode').click();
    await sleep(20);
    assert.equal(calls.length, 1, '一次点击只出一条消息');
    assert.equal(calls[0].opts.source, '货号复制', '来源词必须是已登记的「货号复制」');
    assert.equal(calls[0].opts.count, '已复制', '结果词进右端弱位');
    assert.equal(calls[0].opts.keepHistory, false, '高频复制不进历史盒子');
    assert.equal(calls[0].message, '748392', '值段只写货号本身');
    win.close();
  });

  await check('字号/字重/字体族跟随平台「下架」按钮（两枚按钮同一口径）', async () => {
    const { win, doc } = makeDom('<!doctype html><body></body>');
    const card = buildCardWithId(doc, '748392');
    const peer = card.querySelector('.goods-card__action-btn');
    peer.style.fontSize = '14px';
    peer.style.fontWeight = '500';
    win.__flags = { xhsCopyCode: true, xhsCopyId: true };
    loadCopy(win);
    await sleep(500);
    const btn = doc.querySelector('.dyc-xhs-copycode');
    assert.equal(btn.style.fontSize, '14px', '字号必须跟平台按钮一致，不能自己写 12px');
    assert.equal(btn.style.fontWeight, '500', '字重也要跟平台按钮一致');
    const idBtn = card.querySelector('.dyc-xhs-copyid');
    assert.ok(idBtn, 'ID 按钮也要在');
    assert.equal(idBtn.style.fontSize, '14px', 'ID 与货号同一套字体（并排才不割裂）');
    win.close();
  });

  await check('读不到平台按钮字体时退回样式表兜底，且不报错', async () => {
    const { win, doc } = makeDom('<!doctype html><body></body>');
    const card = doc.createElement('div');
    card.className = 'goods-card';
    card.innerHTML = '<div class="goods-card__title-block">'
      + '<span class="d-text --color-text-title">商品名称甲乙丙 748392</span>'
      + '<div class="goods-card__subtitle-row"><a class="d-text d-link">748392</a></div>'
      + '</div>';
    doc.body.appendChild(card);
    win.__flags = { xhsCopyCode: true, xhsCopyId: false };
    loadCopy(win);
    await sleep(500);
    const btn = doc.querySelector('.dyc-xhs-copycode');
    assert.ok(btn, '没有平台按钮时也要挂上');
    assert.equal(btn.style.fontSize, '', '不该凭空写一个字号，交给样式表兜底');
    win.close();
  });

  await check('关掉货号开关：只摘货号与自建行，ID 按钮和样式表留着', async () => {
    const { win, doc } = makeDom('<!doctype html><body></body>');
    buildCardWithId(doc, '748392');
    win.__flags = { xhsCopyCode: true, xhsCopyId: true };
    loadCopy(win);
    await sleep(500);
    assert.ok(doc.querySelector('.dyc-xhs-copycode'), '先确认已注入');

    win.__flags = { xhsCopyCode: false, xhsCopyId: true };
    win.__watchers.forEach((cb) => cb(win.__flags));
    await sleep(30);
    assert.equal(doc.querySelector('.dyc-xhs-copycode'), null, '货号按钮要摘');
    assert.equal(doc.querySelector('.dyc-xhs-code-row'), null, '自建行也要摘，否则卡片被一条空行撑高');
    assert.ok(doc.querySelector('.dyc-xhs-copyid'), 'ID 按钮是另一个开关，不许跟着消失');
    assert.ok(doc.getElementById('dyc-xhs-copycode-style'), '样式表还要给 ID 按钮用');
    win.close();
  });

  await check('两个开关都关：按钮与样式表一起摘干净', async () => {
    const { win, doc } = makeDom('<!doctype html><body></body>');
    buildCardWithId(doc, '748392');
    win.__flags = { xhsCopyCode: true, xhsCopyId: true };
    loadCopy(win);
    await sleep(500);

    win.__flags = { xhsCopyCode: false, xhsCopyId: false };
    win.__watchers.forEach((cb) => cb(win.__flags));
    await sleep(30);
    assert.equal(doc.querySelector('.dyc-xhs-copycode'), null, '货号按钮要摘');
    assert.equal(doc.querySelector('.dyc-xhs-copyid'), null, 'ID 按钮要摘');
    assert.equal(doc.getElementById('dyc-xhs-copycode-style'), null, '样式表也要移除');
    win.close();
  });
}

/* ============================================================
 * B4. 商品 ID 小按钮（2026-11-17 用户定：名字就叫「ID」）
 * ============================================================ */
function buildCardWithIdRow(doc, id, opts) {
  const o = opts || {};
  const card = doc.createElement('div');
  card.className = 'goods-card';
  /* 按真机结构建卡（2026-11-17 结构报告 + 截图）：
   *   名称 span / 描述 span（= 商品ID 那一行）/ tags / subtitle-row（= 推荐语行） */
  const idLine = o.noIdRow
    ? '<span class="d-text --color-static --color-text-description">夏季新款女装外套</span>'
    : '<span class="d-text --color-static --color-text-description">商品ID：' + id + '</span>';
  const sub = o.href
    ? '<div class="goods-card__subtitle-row"><a class="d-text d-link" href="'
      + o.href + '">查看更多</a></div>'
    : '<div class="goods-card__subtitle-row"><span>· · · · · ·</span></div>';
  card.innerHTML = '<div class="goods-card__info-row">'
    + '<div class="goods-card__title-block">'
    + '<span class="d-text --color-static --color-text-title">商品名称甲乙丙 W607Y0145</span>'
    + idLine
    + '<div class="goods-card__tags"><div class="goods-card__tag">定向计划</div></div>'
    + sub
    + '</div></div>'
    + '<div class="goods-card__action-row"><button class="goods-card__action-btn">下架</button></div>';
  doc.body.appendChild(card);
  return card;
}

const ID24 = '6afc3b7d6f1f060015026a38';

async function testCopyId() {
  console.log('\nB4. 商品 ID 小按钮');

  await check('ID 按钮紧挨在「货号」按钮左边，两枚成组', async () => {
    const { win, doc } = makeDom('<!doctype html><body></body>');
    buildCardWithIdRow(doc, ID24);
    win.__flags = { xhsCopyCode: true, xhsCopyId: true };
    loadCopy(win);
    await sleep(500);
    const card = doc.querySelector('.goods-card');
    const idBtn = card.querySelector('.dyc-xhs-copyid');
    const codeBtn = card.querySelector('.dyc-xhs-copycode');
    assert.ok(idBtn && codeBtn, '两枚按钮都要在');
    assert.equal(idBtn.textContent, 'ID', '名字就叫「ID」');
    assert.equal(idBtn.nextElementSibling, codeBtn, '必须是货号按钮的前一个兄弟（左侧紧邻）');
    assert.ok(idBtn.classList.contains('is-before'), '用「排在货号左边」的间距类');
    assert.equal(card.querySelector('.--color-text-description .dyc-xhs-copyid'), null,
      '既然改成跟随货号，就不要再挂进 ID 行内部');
    const css = doc.getElementById('dyc-xhs-copycode-style').textContent;
    assert.ok(/width:\s*32px; height: 22px/.test(css), 'ID 与货号统一高 22（原 28×16 太小）');
    /* 真机实测过这条：货号自带 margin-left:auto，ID 插到它前面后 auto 仍只推货号，
     * 两枚之间留下 68px 空隙（报告：ID x=731、货号 x=831）。auto 必须挪到 ID 身上。 */
    assert.ok(/\.dyc-xhs-copyid\.is-before\s*\{[^}]*margin:\s*0 4px 0 auto/.test(css),
      'auto 要由 ID 承担，整组才会一起贴右');
    assert.ok(/\.dyc-xhs-copyid\.is-before\s*\+\s*\.dyc-xhs-copycode\s*\{[^}]*margin-left:\s*0/.test(css),
      '紧跟的货号必须去掉 auto，否则两枚又被拉开');
    win.close();
  });

  await check('货号开关关掉（锚没了）：ID 退回 ID 行内部，不丢按钮', async () => {
    const { win, doc } = makeDom('<!doctype html><body></body>');
    buildCardWithIdRow(doc, ID24);
    win.__flags = { xhsCopyCode: false, xhsCopyId: true };
    loadCopy(win);
    await sleep(500);
    const idLine = doc.querySelector('.--color-text-description');
    assert.ok(idLine.querySelector('.dyc-xhs-copyid'), 'ID 按钮要退到 ID 行内部');
    assert.equal(doc.querySelector('.dyc-xhs-copycode'), null, '货号按钮应已关闭');
    win.__copied = '';
    idLine.querySelector('.dyc-xhs-copyid').click();
    await sleep(20);
    assert.equal(win.__copied, ID24, '退到 ID 行后仍要能复制');
    win.close();
  });

  await check('纯文本「商品ID：xxx」能取到，自身文案不污染取值', async () => {
    const { win, doc } = makeDom('<!doctype html><body></body>');
    buildCardWithIdRow(doc, ID24);
    win.__flags = { xhsCopyCode: true, xhsCopyId: true };
    loadCopy(win);
    await sleep(500);
    const btn = doc.querySelector('.dyc-xhs-copyid');
    btn.click();
    await sleep(20);
    assert.equal(win.__copied, ID24, '要剥掉「商品ID：」前缀');
    assert.equal(btn.textContent, '✓', '小按钮用勾反馈（塞不下三个字）');

    win.__copied = '';
    btn.click();
    await sleep(20);
    assert.equal(win.__copied, ID24, '自家按钮文案不能污染取值');
    win.close();
  });

  await check('ID 文本里混了零宽字符也能取到（防复制字段）', async () => {
    const { win, doc } = makeDom('<!doctype html><body></body>');
    // 每 4 位插一个 U+200B —— 眼睛看没有区别，正则不加处理就匹配不上
    const spiked = '6afc\u200b3b7d\u200b6f1f\u200b0600\u200b1502\u200b6a38';
    buildCardWithIdRow(doc, spiked);
    win.__flags = { xhsCopyCode: true, xhsCopyId: true };
    loadCopy(win);
    await sleep(500);
    doc.querySelector('.dyc-xhs-copyid').click();
    await sleep(20);
    assert.equal(win.__copied, ID24, '剥掉不可见字符后必须能取到');
    win.close();
  });

  await check('ID 显示成掩码时，从商品链接里取（链接必须带 goods 语义）', async () => {
    const { win, doc } = makeDom('<!doctype html><body></body>');
    buildCardWithIdRow(doc, '························',
      { href: '/ark/goods/detail?id=' + ID24 });
    win.__flags = { xhsCopyCode: true, xhsCopyId: true };
    loadCopy(win);
    await sleep(500);
    doc.querySelector('.dyc-xhs-copyid').click();
    await sleep(20);
    assert.equal(win.__copied, ID24, '掩码时退链接取 ID');
    win.close();
  });

  await check('图片链接的 hex 不能被当成商品 ID（只认 goods 链接）', async () => {
    const { win, doc } = makeDom('<!doctype html><body></body>');
    const card = buildCardWithIdRow(doc, '························',
      { href: 'https://sns-webpic.xhscdn.com/6afc3b8dbd30880015714031/image.jpg' });
    win.__flags = { xhsCopyCode: true, xhsCopyId: true };
    loadCopy(win);
    await sleep(500);
    win.__copied = '';
    doc.querySelector('.dyc-xhs-copyid').click();
    await sleep(20);
    assert.equal(win.__copied, '', '图片 ID 不是商品 ID，宁可取不到也不复制错的');
    assert.ok(card.querySelector('.dyc-xhs-copyid'), '按钮仍要在卡片里');
    win.close();
  });

  await check('加了「测试推荐语」：推荐语行被重建，两枚按钮补回且仍在各自位置', async () => {
    const { win, doc } = makeDom('<!doctype html><body></body>');
    const card = buildCardWithIdRow(doc, ID24);
    win.__flags = { xhsCopyCode: true, xhsCopyId: true };
    loadCopy(win);
    await sleep(500);
    // 平台把下面那行换成推荐语入口（真机截图：`· · · ✎` ↔ 「添加推荐语」）
    // innerHTML 会连带删掉我们插在这一行里的两枚按钮 —— 正是 React 重渲染的真实场景
    card.querySelector('.goods-card__subtitle-row').innerHTML = '<span>添加推荐语</span>';
    await sleep(400);            // 等一轮防抖补扫

    const idBtn = card.querySelector('.dyc-xhs-copyid');
    const codeBtn = card.querySelector('.dyc-xhs-copycode');
    assert.ok(idBtn && codeBtn, '平台重建后必须补回两枚按钮');
    assert.equal(idBtn.nextElementSibling, codeBtn, '补回后 ID 仍要在货号左边');
    win.__copied = '';
    idBtn.click();
    await sleep(20);
    assert.equal(win.__copied, ID24, 'ID 行还在，就必须照常复制到 ID');
    win.close();
  });

  await check('没有 ID 行时：按钮跟着货号走，且不复制「添加推荐语」', async () => {
    const { win, doc } = makeDom('<!doctype html><body></body>');
    const card = buildCardWithIdRow(doc, ID24, { noIdRow: true });
    card.querySelector('.goods-card__subtitle-row').innerHTML = '<span>添加推荐语</span>';
    win.__flags = { xhsCopyCode: true, xhsCopyId: true };
    loadCopy(win);
    await sleep(500);
    const btn = card.querySelector('.dyc-xhs-copyid');
    assert.ok(btn, '没有 ID 行时按钮也不许消失');
    win.__copied = '';
    btn.click();
    await sleep(20);
    assert.equal(win.__copied, '', '「添加推荐语」不是 ID，绝不能复制出去');
    assert.equal(btn.textContent, '!', '取不到要给出明确失败态');
    win.close();
  });

  await check('两枚被平台拆到两处：下一轮补扫自动归位到货号左边', async () => {
    const { win, doc } = makeDom('<!doctype html><body></body>');
    const card = buildCardWithIdRow(doc, ID24);
    win.__flags = { xhsCopyCode: true, xhsCopyId: true };
    loadCopy(win);
    await sleep(500);

    const idBtn = card.querySelector('.dyc-xhs-copyid');
    const codeBtn = card.querySelector('.dyc-xhs-copycode');
    assert.equal(idBtn.nextElementSibling, codeBtn, '先确认初始是在一起的');

    /* 模拟真机现象：货号被平台重渲染挂到了新容器，ID 却留在原处
     * （幂等判断只查「有没有」，不查「在不在一起」时，两枚就永久分家了） */
    card.querySelector('.--color-text-description').appendChild(idBtn);
    assert.notEqual(idBtn.nextElementSibling, codeBtn, '此刻已经拆开');

    await sleep(500);          // MO 防抖 300ms + 一轮补扫
    const id2 = card.querySelector('.dyc-xhs-copyid');
    const code2 = card.querySelector('.dyc-xhs-copycode');
    assert.equal(id2.nextElementSibling, code2,
      '补扫必须把 ID 挪回货号左边（用户 22:5x 报的就是这条）');
    win.close();
  });

  await check('消息来源词用登记过的「商品ID复制」', async () => {
    const { win, doc } = makeDom('<!doctype html><body></body>');
    const calls = [];
    win.toast = (message, type, opts) => { calls.push({ message, type, opts: opts || {} }); };
    buildCardWithIdRow(doc, ID24);
    win.__flags = { xhsCopyCode: true, xhsCopyId: true };
    loadCopy(win);
    await sleep(500);
    doc.querySelector('.dyc-xhs-copyid').click();
    await sleep(20);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].opts.source, '商品ID复制', '来源词必须在用户要求第 21 条的词表里');
    assert.equal(calls[0].message, ID24, '值段只写 ID');
    assert.equal(calls[0].opts.count, '已复制');
    assert.equal(calls[0].opts.keepHistory, false);
    win.close();
  });
}

/* ============================================================
 * C. 开关与注入
 * ============================================================ */
function testWiring() {
  console.log('\nC. 开关与注入');

  const flagsCode = read('src/content/flags.js');
  const vm = require('vm');
  function sliceVar(code, name) {
    const at = code.indexOf('var ' + name + ' =');
    assert.ok(at >= 0, '源码里没找到 var ' + name);
    let depth = 0, opened = false;
    for (let i = at; i < code.length; i++) {
      const c = code[i];
      if (c === '{' || c === '[') { depth++; opened = true; }
      else if (c === '}' || c === ']') { depth--; if (opened && depth === 0) {
        const semi = code.indexOf(';', i);
        return code.slice(at, semi + 1);
      } }
    }
    throw new Error(name + ' 没有闭合');
  }
  const ctx = vm.createContext({ console: { log() {} } });
  [sliceVar(flagsCode, 'DYC_FLAGS_META'), sliceVar(flagsCode, 'DYC_FLAG_GROUPS')]
    .forEach((s) => vm.runInContext(s, ctx));

  check('四个新开关都归 xhsLive 组、作用页只认 xhsCtrl', () => {
    const keys = ['xhsScrollBtns', 'xhsBackToTop', 'xhsBackToBottom', 'xhsNameWrap', 'xhsCopyCode', 'xhsCopyId'];
    keys.forEach((k) => {
      const meta = ctx.DYC_FLAGS_META.find((m) => m.key === k);
      assert.ok(meta, '缺开关 ' + k);
      assert.equal(meta.group, 'xhsLive', k + ' 应归小红书中控台组');
      /* vm 里造出来的数组与主上下文不是同一 realm，deepStrictEqual 会因原型不同
       * 判不等 —— 先 Array.from 搬回来再比。 */
      assert.deepEqual(Array.from(meta.pages), ['xhsCtrl'], k + ' 的作用页只能是中控台');
      assert.equal(meta.default, true, k + ' 默认应开启');
    });
    const host = ctx.DYC_FLAGS_META.find((m) => m.key === 'xhsScrollBtns');
    assert.equal(host.foldHost, 'xhsScroll', '总闸折叠组必须与抖店的 scroll 分开');
    ['xhsBackToTop', 'xhsBackToBottom'].forEach((k) => {
      assert.equal(ctx.DYC_FLAGS_META.find((m) => m.key === k).foldGroup, 'xhsScroll');
    });
  });

  check('分组表有 xhsLive，且被小红书平台认领', () => {
    assert.ok(ctx.DYC_FLAG_GROUPS.some((g) => g.id === 'xhsLive'), '缺 xhsLive 分组');
  });

  check('源码不得同步取用 dycReadFlags（它返回 Promise）', () => {
    /* 先剥注释再判 —— 注释里写着「第一版是 flags = dycReadFlags()」这条教训，
     * 不剥就会把说明文字当成违规代码，守卫自己先红。 */
    const stripComments = (code) => code
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
    [SCROLL, NAME, COPY].forEach((code, idx) => {
      const who = ['xhs-scroll.js', 'xhs-name-wrap.js', 'xhs-copy-code.js'][idx];
      const bare = stripComments(code);
      assert.ok(!/flags\s*=\s*dycReadFlags\(\)/.test(bare), who + ' 仍在同步取用，会拿到 Promise');
      assert.ok(/dycReadFlags\(\)\s*\.then/.test(bare), who + ' 没有走 .then');
    });
  });

  check('manifest：两个脚本都在小红书条目里，且排在 debug-panel 之前', () => {
    const entry = MANIFEST.content_scripts.find(
      (cs) => (cs.matches || []).some((m) => m.indexOf('pgy.xiaohongshu.com') > -1));
    assert.ok(entry, '找不到小红书注入条目');
    const js = entry.js;
    const iName = js.indexOf('src/live/xhs-name-wrap.js');
    const iScroll = js.indexOf('src/live/xhs-scroll.js');
    const iPanel = js.indexOf('src/content/debug-panel.js');
    const iCopy = js.indexOf('src/live/xhs-copy-code.js');
    assert.ok(iName > -1 && iScroll > -1 && iCopy > -1, '三个脚本没进注入清单');
    assert.ok(iName < iPanel && iScroll < iPanel && iCopy < iPanel, '功能脚本必须排在 debug-panel 之前');
    assert.ok(js.indexOf('src/content/flags.js') === 0, 'flags.js 必须第 0 位');
  });

  check('manifest：item-code.js 必须先于复制货号（判据唯一真源）', () => {
    const entry = MANIFEST.content_scripts.find(
      (cs) => (cs.matches || []).some((m) => m.indexOf('pgy.xiaohongshu.com') > -1));
    const js = entry.js;
    const iItem = js.indexOf('src/content/item-code.js');
    const iCopy = js.indexOf('src/live/xhs-copy-code.js');
    assert.ok(iItem > -1, '小红书条目缺 item-code.js —— 按钮会全部取不到号');
    assert.ok(iItem < iCopy, 'item-code.js 必须在 xhs-copy-code.js 之前加载');
  });
}

(async () => {
  await testScroll();
  await testName();
  await testAddTable();
  await testCopyCode();
  await testCopyCodeUI();
  await testCopyId();
  testWiring();
  /* check() 是 async：即使 fn 是同步的，await 也会让出微任务，
   * 于是 C 组的 ✓ 会排到汇总之后打印，计数还停在 C 组之前的值。
   * 这里等一帧再把微任务清空，保证汇总数字与输出的 ✓ 条数一致。 */
  await new Promise((r) => setTimeout(r, 0));
  console.log('\n小红书滚钮与名称自测：' + pass + ' 条全部通过。');
})().catch((e) => {
  console.error('\n失败：' + (e && e.stack || e));
  process.exit(1);
});
