'use strict';
/* 猫爪光标 · 全平台兼容（2026-11-21）
 * ============================================================
 * 用户口径：「让猫爪功能兼容整个平台，无论抖店还是小红书或者其他平台」。
 *
 * 本次改的三件事（本用例逐条钉住）：
 *   1. 作用范围从「中控台 / 商品列表 / 小红书中控台」扩到**三平台全域**：
 *      *.jinritemai.com、*.xiaohongshu.com、store/channels.weixin.qq.com。
 *   2. 判据从「只认 cursor: grab」扩到 grab / grabbing / **move** +
 *      **draggable="true"**（原生拖拽与多数后台的写法）。
 *   3. 拖拽起点不再按平台分叉：任何平台的 grab/move/draggable 按下都能起拖；
 *      输入框那类「按下是选文本」的位置仍然排除。
 *
 * 分键（与「宁可键多、不共用」的既有口径一致）：
 *   抖店 cursorFix ｜ 小红书 xhsCursorFix ｜ 微信小店 wxCursorFix
 *
 * 用法：node scripts/自测-猫爪全平台.js（退出码 0 = 全绿）
 * ============================================================ */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const ROOT = path.resolve(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'src/content/cursor-fix.js'), 'utf8');
const FLAGS = fs.readFileSync(path.join(ROOT, 'src/content/flags.js'), 'utf8');
const MANIFEST = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));

/* 与 flags.js 的 DYC_PAGE_PATTERNS 同语义（三平台全域）：
 * 这里手写是为了让用例能在 jsdom 里独立跑；下面有静态断言保证
 * 「源码确实按这三个键分派」，防止两份判据漂移。 */
const PATTERNS = {
  shopAll: /^https:\/\/(?:[a-z0-9-]+\.)*jinritemai\.com\/(?!ffa\/content-tool\/live\/control|dashboard\/live\/control)/,
  list: /^https:\/\/fxg\.jinritemai\.com\/ffa\/g\/list/,
  liveCtrl: /^https:\/\/(?:fxg\.jinritemai\.com\/ffa\/content-tool\/live\/control|buyin\.jinritemai\.com\/dashboard\/live\/control)/,
  xhsCtrl: /^https:\/\/pgy\.xiaohongshu\.com\/commerce\/redlive\/live_center_control(?:\/|[?#]|$)/,
  xhsAll: /^https:\/\/(?:pgy|ark)\.xiaohongshu\.com\//,
  wxAll: /^https:\/\/(?:store|channels)\.weixin\.qq\.com\//
};

const URL_SHOP_OTHER = 'https://fxg.jinritemai.com/ffa/creative/material-manage-menu';
const URL_SHOP_LIST = 'https://fxg.jinritemai.com/ffa/g/list';
const URL_XHS_ARK = 'https://ark.xiaohongshu.com/app-item/list/shelf';
const URL_WX = 'https://store.weixin.qq.com/shop/goods/list';

/* 反馈 #143 的真机 DOM —— 逐字摘自该条反馈的 page_structure（中控台小黄车）：
 *   行 = rbd 拖拽手柄（行本身就是手柄），行内每个子元素都会被 isDragHost 判成可拖；
 *   行首 SVG 是拖拽图标，紧邻的 indexWrapper 才是「序号格」。
 * 类名保留平台构建哈希（-d7a4a8），用来验证「按类名片段匹配」这条路走得通。 */
const CART_ROW = '<div class="goodsList-e18222" id="list">'
  + '<div class="goodsItem-d7a4a8 rpa_lc__live-goods__goods-item" id="row"'
  + ' draggable="true" data-rbd-draggable-id="g1" data-rbd-drag-handle-draggable-id="g1">'
  + '<svg class="iconDrag-d7a4a8" id="handle"></svg>'
  + '<div class="indexWrapper-d7a4a8" id="idx">'
  + '<span class="auxo-sp-input" id="num">1</span></div>'
  + '<div class="auxo-row upper-d7a4a8" id="upper">'
  + '<span id="title">商品名</span></div>'
  + '</div></div>';

async function boot(url, flags, body) {
  const dom = new JSDOM('<!doctype html><body>' + (body || '') + '</body>',
    { runScripts: 'outside-only', url });
  const w = dom.window;
  let trusted = true;
  for (const target of [w, w.document]) {
    const add = target.addEventListener.bind(target);
    const remove = target.removeEventListener.bind(target);
    const wrappers = new WeakMap();
    target.addEventListener = (type, fn, opts) => {
      if (!/^(pointer|blur|dragend)/.test(type)) return add(type, fn, opts);
      if (!wrappers.has(fn)) wrappers.set(fn, e => fn(new Proxy(e, {
        get: (ev, key) => (key === 'isTrusted' ? trusted : Reflect.get(ev, key, ev))
      })));
      add(type, wrappers.get(fn), opts);
    };
    target.removeEventListener = (type, fn, opts) => remove(type, wrappers.get(fn) || fn, opts);
  }
  w.setTimeout = () => 1;
  w.clearTimeout = () => {};
  w.setInterval = () => 1;
  w.requestIdleCallback = () => 1;
  w.Image = class { set src(v) { this.onload(); } };
  w.console.log = () => {};
  w.console.warn = () => {};
  w.DYC_PAGE_PATTERNS = PATTERNS;
  let watch = null;
  w.dycReadFlags = async () => flags;
  w.dycWatchFlags = fn => { watch = fn; };
  w.eval(SRC);
  await Promise.resolve();
  await Promise.resolve();
  function fire(target, type, opts = {}) {
    const e = new w.MouseEvent(type, { bubbles: true, button: 0, clientX: 10, clientY: 10, ...opts });
    Object.defineProperty(e, 'pointerId', { value: opts.pointerId || 1 });
    Object.defineProperty(e, 'pointerType', { value: opts.pointerType || 'mouse' });
    trusted = opts.trusted !== false;
    target.dispatchEvent(e);
    trusted = true;
  }
  const style = () => w.document.getElementById('dyc-cursor-fix-style');
  const cursor = el => w.getComputedStyle(el).cursor;
  const dragMark = () => w.document.documentElement.hasAttribute('data-dyc-cursor-dragging');
  /* 真机的按下序列是 pointerdown → mousedown；拖动态由 pointerdown 起算，
   * 位移超过 5px 才置标记（点一下不移动不算拖）。 */
  function startDrag(el) {
    fire(el, 'pointerdown');
    fire(w, 'pointermove', { clientX: 40, clientY: 40 });
  }
  return { w, dom, fire, style, cursor, dragMark, startDrag, getWatch: () => watch };
}

let pass = 0;
let fail = 0;
const failures = [];
async function test(name, fn) {
  try { await fn(); pass++; console.log('  ✓ ' + name); }
  catch (e) { fail++; failures.push(name + ' —— ' + e.message); console.log('  ✗ ' + name); }
}

(async () => {
  console.log('自测 · 猫爪光标全平台（src/content/cursor-fix.js）\n');

  console.log('【一】三平台分键');
  await test('抖店非中控台页（素材管理）也走 cursorFix', async () => {
    const f = await boot(URL_SHOP_OTHER, { cursorFix: true });
    assert.ok(f.style(), '抖店全域页应注入猫爪样式');
    const g = await boot(URL_SHOP_OTHER, { cursorFix: false });
    assert.equal(g.style(), null, '抖店键关掉就该收干净');
  });
  await test('抖店：cursorFix=false 时不注入（各平台键互不影响）', async () => {
    const f = await boot(URL_SHOP_OTHER, { cursorFix: false, xhsCursorFix: true, wxCursorFix: true });
    assert.equal(f.style(), null, '抖店键关掉就该收干净');
  });
  await test('小红书千帆商品页（ark）走 xhsCursorFix', async () => {
    const f = await boot(URL_XHS_ARK, { xhsCursorFix: true });
    assert.ok(f.style(), '千帆页应注入');
    const g = await boot(URL_XHS_ARK, { xhsCursorFix: false, cursorFix: true });
    assert.equal(g.style(), null, '关掉小红书键、抖店键开着，千帆页仍应关闭');
  });
  await test('微信小店走 wxCursorFix', async () => {
    const f = await boot(URL_WX, { wxCursorFix: true, cursorFix: false });
    assert.ok(f.style(), '微信键开着即注入');
    const g = await boot(URL_WX, { wxCursorFix: false, cursorFix: true });
    assert.equal(g.style(), null, '抖店键不该影响微信');
  });

  console.log('\n【二】判据：grab / move / draggable 都算可拖');
  await test('cursor:move 的元素被识别（后台大量用四向箭头表示可拖）', async () => {
    const f = await boot(URL_SHOP_OTHER, { cursorFix: true },
      '<div id="mv" style="cursor:move">可拖动块</div>');
    const mv = f.w.document.getElementById('mv');
    f.fire(mv, 'mouseover');
    f.fire(mv, 'mousedown');
    assert.ok(mv.hasAttribute('data-dyc-cursor-fix') || f.dragMark(),
      'move 光标应被当成可拖');
  });
  await test('draggable="true" 的元素即使 cursor:auto 也能识别', async () => {
    const f = await boot(URL_SHOP_OTHER, { cursorFix: true },
      '<div id="dr" draggable="true">拖我</div>');
    const dr = f.w.document.getElementById('dr');
    f.startDrag(dr);
    assert.ok(f.dragMark(), '原生 draggable 元素按下应起拖（全页猫爪）');
  });
  await test('draggable 容器里的按钮按下也起拖（「拖动按钮」就是这种写法）', async () => {
    const f = await boot(URL_SHOP_OTHER, { cursorFix: true },
      '<div draggable="true"><button id="hb">按住拖</button></div>');
    const hb = f.w.document.getElementById('hb');
    f.startDrag(hb);
    assert.ok(f.dragMark(), '手柄是按钮时不该被「排除按钮」的旧规则挡掉');
  });

  console.log('\n【三】误伤保护');
  await test('输入框里按下不起拖（那里是选文本，不是拖拽）', async () => {
    const f = await boot(URL_SHOP_OTHER, { cursorFix: true },
      '<div><input id="ipt" style="cursor:text"></div>');
    const ipt = f.w.document.getElementById('ipt');
    f.startDrag(ipt);
    assert.equal(f.dragMark(), false, '输入框不该进入全页拖动态');
  });
  await test('普通按钮（不可拖）按下不起拖', async () => {
    const f = await boot(URL_SHOP_OTHER, { cursorFix: true }, '<button id="b">普通按钮</button>');
    const b = f.w.document.getElementById('b');
    f.startDrag(b);
    assert.equal(f.dragMark(), false);
  });

  console.log('\n【四】注入范围（manifest）');
  await test('三平台全域由同一条目承载，且三平台域都在 matches 里', async () => {
    const group = MANIFEST.content_scripts.find(cs =>
      (cs.js || []).includes('src/content/cursor-fix.js'));
    assert.ok(group, '没有找到猫爪的注入条目');
    const m = group.matches.join(' ');
    ['jinritemai.com', 'xiaohongshu.com', 'store.weixin.qq.com', 'channels.weixin.qq.com']
      .forEach((host) => assert.ok(m.includes(host), 'matches 缺 ' + host));
    assert.deepEqual(group.js, ['src/content/flags.js', 'src/content/cursor-fix.js'],
      '条目应只带开关层 + 自启动的猫爪脚本（不夹带别的功能）');
  });
  await test('其它注入组不再重复带 cursor-fix.js（避免重复注入）', async () => {
    const dup = MANIFEST.content_scripts.filter(cs =>
      (cs.js || []).includes('src/content/cursor-fix.js'));
    assert.equal(dup.length, 1, 'cursor-fix.js 应只出现在一个条目里，实际 ' + dup.length);
  });

  console.log('\n【五】判据真源（防两份漂移）');
  await test('flagKey 按三平台分派，且判据取自 DYC_PAGE_PATTERNS', async () => {
    assert.match(SRC, /pagePat\('xhsAll'\)[\s\S]{0,80}xhsCursorFix/,
      '小红书全域应映射到 xhsCursorFix');
    assert.match(SRC, /pagePat\('wxAll'\)[\s\S]{0,80}wxCursorFix/,
      '微信全域应映射到 wxCursorFix');
    assert.ok(!/return null;/.test(SRC.split('function flagKey(')[1].split('}')[0]),
      'flagKey 不该再把某些平台判成「关」（旧的小红书非中控台分支）');
  });
  await test('开关三键都在 flags.js 里定义，且覆盖对应平台', async () => {
    [['cursorFix', 'shopAll'], ['xhsCursorFix', 'xhsAll'], ['wxCursorFix', 'wxAll']]
      .forEach(([key, page]) => {
        const at = FLAGS.indexOf("key: '" + key + "'");
        assert.ok(at > 0, key + ' 未定义');
        const seg = FLAGS.slice(at, at + 400);
        assert.match(seg, new RegExp(page), key + ' 的 pages 应覆盖 ' + page);
      });
  });

  console.log('\n【六】反向排除：小黄车序号位不吃猫爪（反馈 #143）');
  await test('悬停序号数字：序号格整格都不再显示猫爪（32px 猫爪会盖住数字）', async () => {
    const f = await boot(URL_SHOP_LIST, { cursorFix: true }, CART_ROW);
    const num = f.w.document.getElementById('num');
    const idx = f.w.document.getElementById('idx');
    f.fire(num, 'mouseover');
    f.fire(num, 'mousedown');
    assert.doesNotMatch(f.cursor(num), /url\(/, '序号数字上不该出现猫爪（用户原话「啥都看不到」）');
    assert.doesNotMatch(f.cursor(idx), /url\(/, '序号格整格都不该出现猫爪');
  });
  await test('同一行里商品名照旧显示猫爪（排除只针对序号，不是把整行关掉）', async () => {
    const f = await boot(URL_SHOP_LIST, { cursorFix: true }, CART_ROW);
    const title = f.w.document.getElementById('title');
    f.fire(title, 'mouseover');
    f.fire(title, 'mousedown');
    assert.match(f.cursor(title), /url\(/, '行内其它位置仍是抓手语义，改回隐形白手就是回退');
  });
  await test('拖动中序号位随整页显示「握紧爪」（排除只在静止悬停时生效）', async () => {
    const f = await boot(URL_SHOP_LIST, { cursorFix: true }, CART_ROW);
    const num = f.w.document.getElementById('num');
    const idx = f.w.document.getElementById('idx');
    f.fire(num, 'mouseover');
    f.startDrag(f.w.document.getElementById('handle'));
    assert.equal(f.dragMark(), true, '按下拖拽图标应进入拖动态');
    assert.match(f.cursor(num), /url\(/, '拖动期间整页统一握紧爪，别让序号数字成为例外');
    assert.match(f.cursor(idx), /url\(/, '序号格本身也要跟着变握紧爪（两条排除选择器都得让位）');
  });
  await test('平台自己给序号格写了 cursor:grab 时，排除依然赢（路径 A 会把那条规则照搬成猫爪）', async () => {
    const f = await boot(URL_SHOP_LIST, { cursorFix: true },
      '<style>.goodsItem-d7a4a8 .indexWrapper-d7a4a8 { cursor: grab !important; }</style>'
      + CART_ROW);
    const num = f.w.document.getElementById('num');
    const idx = f.w.document.getElementById('idx');
    assert.ok((f.style().textContent || '').indexOf('.goodsItem-d7a4a8 .indexWrapper-d7a4a8') > -1,
      '前提：路径 A 应把平台的 grab 规则照搬进来（否则本用例测不到真实风险）');
    f.fire(num, 'mouseover');
    f.fire(num, 'mousedown');
    assert.doesNotMatch(f.cursor(idx), /url\(/, '照搬回来的规则权重 (0,2,0)，排除要能压过它');
    assert.doesNotMatch(f.cursor(num), /url\(/, '序号数字同样不能被照搬规则带成猫爪');
  });
  await test('排除规则写法有守卫：清单化 + 类名片段 + 权重叠加 + 排在标记规则之后', async () => {
    assert.match(SRC, /var NO_PAW_SEL = \[[\s\S]{0,600}?class\*="indexWrapper"/,
      '排除项应集中在 NO_PAW_SEL 清单里，且按类名片段匹配（哈希会随平台发版变）');
    const f = await boot(URL_SHOP_LIST, { cursorFix: true }, CART_ROW);
    const css = f.style().textContent;
    const ex = '[class*="indexWrapper"][class*="indexWrapper"]';
    assert.ok(css.indexOf(ex) > -1,
      '排除规则要把属性选择器叠两遍，否则压不过平台自己的 .row .cell{cursor:grab}');
    assert.ok(css.indexOf(ex + ' *') > -1,
      '排除要覆盖整棵子树，否则序号数字那个 span 自带标记仍显示猫爪');
    assert.ok(css.indexOf('html:not([data-dyc-cursor-dragging]) body ' + ex) > -1,
      '排除规则要加「非拖动中」前缀，否则拖动态整页握紧爪的约定被破掉');
    assert.ok(css.indexOf('cursor: default !important') > css.indexOf('[data-dyc-cursor-fix]'),
      '排除规则必须排在标记规则之后（同权重靠顺序取胜）');
  });

  /* 反馈 #144 的真机结构：整行是 rbd 手柄，行内还有操作按钮区
   *   div.goodsAction-f0ba48 > button.auxo-btn（上移/置顶/删除…）。
   * 按钮多数自己写 cursor:pointer —— 上一版会把它们当「可拖」各打一份猫爪标。 */
  const CART_ROW_BTNS = '<div class="goodsList-e18222" id="list">'
    + '<div class="goodsItem-d7a4a8" id="row" draggable="true"'
    + ' data-rbd-draggable-id="g1" data-rbd-drag-handle-draggable-id="g1">'
    + '<svg class="iconDrag-d7a4a8" id="handle"></svg>'
    + '<div class="indexWrapper-d7a4a8" id="idx"><span id="num">1</span></div>'
    + '<div class="auxo-row upper-d7a4a8" id="upper"><span id="title">商品名</span></div>'
    + '<div class="goodsAction-f0ba48" id="acts">'
    + '<button class="auxo-btn" id="del" style="cursor:pointer">删除</button>'
    + '<button class="auxo-btn" id="top" style="cursor:pointer">置顶</button>'
    + '</div></div></div>';

  console.log('\n【七】整行商品区悬停即猫爪，行内控件才是箭头（反馈 #144 / #145）');

  await test('#144 行内按钮不再被猫爪接管，光标是普通箭头', async () => {
    const f = await boot(URL_SHOP_LIST, { cursorFix: true }, CART_ROW_BTNS);
    const del = f.w.document.getElementById('del');
    f.fire(del, 'mouseover');
    f.fire(del, 'mousedown');
    assert.equal(del.hasAttribute('data-dyc-cursor-fix'), false,
      '按钮不是拖动手柄，不该带猫爪标记（上一版 9 行打了 101 个）');
    assert.doesNotMatch(f.cursor(del), /url\(/, '按钮上不该出现猫爪');
    assert.equal(f.cursor(del), 'default', '用户要求按钮上是普通箭头，不是手型');
  });

  /* #145（用户 2026-11-26）：「让鼠标指向中控台购物车商品的时候也是猫爪图案，
   * 不然一拖动的时候，猫爪唐突出现，很突兀」。
   * 整行是 rbd 手柄、整块都能起拖 ⇒ 悬停就必须给猫爪，不能等按下才出现。 */
  await test('#145 悬停整行商品区即显示猫爪（不必等按下拖动）', async () => {
    const f = await boot(URL_SHOP_LIST, { cursorFix: true }, CART_ROW_BTNS);
    const row = f.w.document.getElementById('row');
    const title = f.w.document.getElementById('title');
    f.fire(title, 'mouseover');
    assert.equal(row.hasAttribute('data-dyc-cursor-fix'), true, '整行本体应带猫爪标记');
    assert.equal(row.hasAttribute('data-dyc-cursor-row'), true,
      '整行应带「整行容器」锚点（行内控件靠它压回箭头）');
    assert.match(f.cursor(row), /url\(/, '整行光标应是猫爪');
    assert.match(f.cursor(title), /url\(/, '商品名跟着整行显示猫爪，不能还是箭头');
  });

  await test('#145 悬停是猫爪、按下拖动仍是猫爪（同一族图，不跳变）', async () => {
    const f = await boot(URL_SHOP_LIST, { cursorFix: true }, CART_ROW_BTNS);
    const title = f.w.document.getElementById('title');
    f.fire(title, 'mouseover');
    const hover = f.cursor(title);
    assert.match(hover, /url\(/, '前提：悬停已是猫爪');
    f.startDrag(f.w.document.getElementById('handle'));
    assert.equal(f.dragMark(), true, '按下拖拽图标应进入拖动态');
    assert.match(f.cursor(title), /url\(/, '拖动中仍是猫爪 —— 用户抱怨的是「箭头→猫爪」跳变');
    assert.ok(f.cursor(title) !== hover, '两态用不同图（悬停张开 / 拖动收拢），但都是猫爪');
  });

  await test('#144 平台自己声明 grab 的拖拽图标仍然显示猫爪', async () => {
    const f = await boot(URL_SHOP_LIST, { cursorFix: true },
      CART_ROW_BTNS.replace('<svg class="iconDrag-d7a4a8" id="handle"></svg>',
        '<svg class="iconDrag-d7a4a8" id="handle" style="cursor:grab"></svg>'));
    const h = f.w.document.getElementById('handle');
    f.fire(h, 'mouseover');
    assert.ok(h.hasAttribute('data-dyc-cursor-fix'), '图标自己声明 grab，应保留猫爪');
    assert.match(f.cursor(h), /url\(/, '拖动手柄这个位置必须是猫爪');
  });

  await test('#145 按钮后挂载：整行补上锚点，行内控件照样是箭头', async () => {
    const f = await boot(URL_SHOP_LIST, { cursorFix: true }, CART_ROW);
    const row = f.w.document.getElementById('row');
    f.fire(row, 'mouseover');
    assert.equal(row.hasAttribute('data-dyc-cursor-row'), false,
      '前提：暂无按钮时它是纯手柄，不需要整行锚点');
    assert.match(f.cursor(row), /url\(/, '纯手柄本来就是猫爪');
    const btn = f.w.document.createElement('button');
    btn.id = 'late';
    btn.textContent = '删除';
    row.appendChild(btn);
    f.fire(row, 'mouseover');   // 手柄元素不进缓存，每次强制重判
    assert.equal(row.hasAttribute('data-dyc-cursor-row'), true,
      '行内出现按钮后应补上整行锚点（React 分步挂载是常态）');
    assert.equal(row.hasAttribute('data-dyc-cursor-fix'), true,
      '整行本体仍是猫爪，不因多出按钮就退回箭头（#145 改口）');
    assert.equal(f.cursor(btn), 'default', '新出现的按钮仍是普通箭头');
  });

  await test('#144 拖动期间按钮随整页握紧爪（既有约定不破）', async () => {
    const f = await boot(URL_SHOP_LIST, { cursorFix: true }, CART_ROW_BTNS);
    const del = f.w.document.getElementById('del');
    f.fire(del, 'mouseover');
    f.startDrag(f.w.document.getElementById('handle'));
    assert.equal(f.dragMark(), true, '按下拖拽图标应进入拖动态');
    assert.match(f.cursor(del), /url\(/, '拖动中整页统一握紧爪，按钮不例外');
  });

  await test('#144 守卫：打标判据不许再用「祖先可拖」判定', async () => {
    const seg = SRC.split('function isGrabEl(')[1].split('function classify(')[0];
    assert.ok(!/isDragHost\s*\(/.test(seg),
      'isGrabEl 里不许再出现 isDragHost —— 它用 closest 判祖先，正是 #144 的病根');
    assert.match(seg, /isHandleContainer/, '应先拦下整行/整卡式手柄');
    assert.match(seg, /isHandleSelf/, '结构判据只看元素自身');
  });

  await test('#145 守卫：整行容器不许再被压成箭头，正文只打锚点', async () => {
    const seg = SRC.split('function classify(')[1].split('function clearLegacyMarks(')[0];
    assert.match(seg, /hasAttribute\(ROW_ATTR\)[\s\S]{0,120}setAttribute\(MARK_ATTR/,
      'classify 的整行分支要同时打上整行锚点与猫爪标记（#144 只打箭头，已作废）');
    assert.ok(!/body \[data-dyc-cursor-row\]\[data-dyc-cursor-row\] \{ cursor: default/.test(SRC),
      '不许给整行容器写 cursor: default —— 那正是「悬停箭头、一按变猫爪」的成因');
  });

  await test('#144 守卫：行内控件规则带「非拖动中」前缀且叠两遍权重', async () => {
    const f = await boot(URL_SHOP_LIST, { cursorFix: true }, CART_ROW_BTNS);
    const css = f.style().textContent;
    const row = '[data-dyc-cursor-row][data-dyc-cursor-row]';
    assert.ok(css.indexOf('html:not([data-dyc-cursor-dragging]) body ' + row) > -1,
      '整行控件规则要有「非拖动中」前缀 + 属性叠两遍（压过平台照搬的 grab 规则）');
    assert.ok(css.indexOf(row + ' button') > -1,
      '行内按钮要压回普通箭头');
    assert.ok(css.indexOf('cursor: default !important') > css.indexOf('[data-dyc-cursor-fix]'),
      '箭头规则必须排在猫爪标记规则之后');
  });

  console.log('\n────────────────────────────────────────');
  if (failures.length) {
    console.log('失败 ' + fail + ' 条，通过 ' + pass + ' 条：');
    failures.forEach((x) => console.log('  · ' + x));
    process.exit(1);
  }
  console.log('全部通过（' + pass + ' 条）');
})();
