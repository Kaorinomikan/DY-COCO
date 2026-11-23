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

  console.log('\n────────────────────────────────────────');
  if (failures.length) {
    console.log('失败 ' + fail + ' 条，通过 ' + pass + ' 条：');
    failures.forEach((x) => console.log('  · ' + x));
    process.exit(1);
  }
  console.log('全部通过（' + pass + ' 条）');
})();
