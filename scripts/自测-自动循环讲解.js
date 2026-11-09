/**
 * 自测 · 自动循环讲解(src/live/auto-loop-lecture.js)
 * ============================================================
 * 跑法:node scripts/自测-自动循环讲解.js
 *
 * 覆盖两类:
 *   A. 纯函数(滑条落点、吸附、文案、色带归属、倒计时格式)—— 直接调
 *      window.__DYC_AUTO_LOOP__.pure,不碰真实 DOM。
 *   B. 源码纪律(静态扫描)—— Shadow DOM 隔离、固定 px、20 秒拍点、
 *      禁止 document.write、三段式消息、开关已登记。
 *
 * 不覆盖:真实页面上的「讲解」按钮识别 —— 那必须在真机中控台验,
 * 由 probe() 打点(见脚本 __DYC_AUTO_LOOP__.probe)。
 */

'use strict';

const fs = require('fs');
const vm = require('vm');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'src/live/auto-loop-lecture.js');
const FLAGS = path.join(ROOT, 'src/content/flags.js');
const MANIFEST = path.join(ROOT, 'manifest.json');

let pass = 0, fail = 0;
const fails = [];

function ok(name, cond, extra) {
  if (cond) { pass++; }
  else { fail++; fails.push(name + (extra ? ' → ' + extra : '')); }
}
function eq(name, got, want) {
  ok(name, JSON.stringify(got) === JSON.stringify(want), 'got=' + JSON.stringify(got) + ' want=' + JSON.stringify(want));
}

/* ---------------- 装载模块(沙箱,不触真实 DOM) ---------------- */

const src = fs.readFileSync(path.resolve(SRC), 'utf8');

const noop = function () {};
const sandbox = {
  window: {},
  document: {
    hidden: false,
    addEventListener: noop,
    removeEventListener: noop,
    querySelector: function () { return null; },
    querySelectorAll: function () { return []; },
    getElementById: function () { return null; },
    createElement: function () { return { style: {}, appendChild: noop, setAttribute: noop }; },
    body: null
  },
  location: { href: 'https://example.com/not-live' },
  chrome: {
    storage: {
      local: { get: () => Promise.resolve({}) },
      onChanged: { addListener: noop }
    }
  },
  console: console,
  setTimeout: setTimeout, clearTimeout: clearTimeout,
  setInterval: setInterval, clearInterval: clearInterval,
  requestAnimationFrame: function () { return 0; },
  cancelAnimationFrame: noop,
  Promise: Promise, Date: Date, Math: Math, JSON: JSON,
  parseFloat: parseFloat, isFinite: isFinite
};
sandbox.window.document = sandbox.document;
sandbox.window.location = sandbox.location;
sandbox.window.addEventListener = noop;
sandbox.window.localStorage = { getItem: () => null, setItem: noop };
sandbox.globalThis = sandbox;

let api = null;
try {
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox, { filename: 'auto-loop-lecture.js' });
  api = sandbox.window.__DYC_AUTO_LOOP__;
} catch (e) {
  console.error('模块装载失败:' + e.message);
  process.exit(1);
}

ok('模块暴露 __DYC_AUTO_LOOP__', !!api);
ok('暴露 pure 集合', !!(api && api.pure));
const P = api.pure;

/* ---------------- A. 滑条位置 ---------------- */

eq('pctOf(1) = 0%', P.pctOf(1), 0);
eq('pctOf(15) = 100%', P.pctOf(15), 100);
ok('pctOf(8) = 50%', Math.abs(P.pctOf(8) - 50) < 1e-9, 'got=' + P.pctOf(8));
ok('pctOf(3) ≈ 14.29%', Math.abs(P.pctOf(3) - 14.2857) < 0.01, 'got=' + P.pctOf(3));
ok('pctOf(5) ≈ 28.57%', Math.abs(P.pctOf(5) - 28.5714) < 0.01, 'got=' + P.pctOf(5));
ok('pctOf(12) ≈ 78.57%', Math.abs(P.pctOf(12) - 78.5714) < 0.01, 'got=' + P.pctOf(12));

/* ---------------- A. 吸附规则 ---------------- */

eq('7.75 → 吸到 8(推荐磁吸)', P.snapMinute(7.75), 8);
eq('8.2 → 8', P.snapMinute(8.2), 8);
eq('2.9 → 吸到 3(推荐磁吸)', P.snapMinute(2.9), 3);
eq('3.3 → 3.5(离 3.5 更近)', P.snapMinute(3.3), 3.5);
eq('3.2 → 3(磁吸)', P.snapMinute(3.2), 3);
eq('6.2 → 6(30 秒对齐)', P.snapMinute(6.2), 6);
eq('6.5 → 6.5', P.snapMinute(6.5), 6.5);
eq('0.4 → 夹到下限 1', P.snapMinute(0.4), 1);
eq('20 → 夹到上限 15', P.snapMinute(20), 15);
eq('4.0 → 4(不误吸)', P.snapMinute(4), 4);
eq('11.0 → 11(不误吸)', P.snapMinute(11), 11);

let gridOK = true;
for (let i = 0; i <= 280; i++) {
  const raw = 1 + i * 0.05;
  const v = P.snapMinute(raw);
  if (Math.abs(v * 2 - Math.round(v * 2)) > 1e-9) { gridOK = false; break; }
  if (v < 1 || v > 15) { gridOK = false; break; }
}
ok('任意松手点都落在 30 秒格子上且不出界(281 个采样)', gridOK);

/* ---------------- A. 落位吸附(2026-10-26 用户报「原生刷新时轻微左右抖」) ---------------- */

ok('同一条水平带才算同行(圆钮不在锚点那一行时不拿它当基准)', (function () {
  const rowA = { top: 100, height: 24 };
  const near = { top: 101, height: 26 };
  const far = { top: 240, height: 24 };
  return P.sameRowBand(rowA, near) === true && P.sameRowBand(rowA, far) === false;
})());

ok('首次落位直接采纳实测值', (function () {
  P.resetSettle();
  return P.settle('t', 366) === 366;
})());

ok('1~2px 噪声不写 style —— 这就是「位置固定」', (function () {
  return P.settle('t', 367) === null && P.settle('t', 368) === null && P.settle('t', 365) === null;
})());

ok('≥10px 是真移动,立刻跟(切页 / 缩放不吃延迟)', P.settle('t', 380) === 380);

ok('中间档(3~9px)连续两拍同目标才跟',
  P.settle('t', 375) === null && P.settle('t', 375) === 375);

ok('中间档目标来回跳 ⇒ 一直不跟(刷新那一瞬的单拍值被滤掉)', (function () {
  P.resetSettle();
  P.settle('t', 100);
  return P.settle('t', 105) === null && P.settle('t', 106) === null && P.settle('t', 105) === null;
})());

/* ---------------- A. 名字清洗(2026-10-27 现场诊断的根因) ----------------
 * 诊断里记录的商品是「讲解中【高奢女装】…A0476ID货号未设提词设置卖点」——
 * 状态词与行内噪音混进名字 ⇒ 身份键随状态变化 ⇒ 取消后认不回那一行。 */

eq('cleanName 去掉「讲解中」前缀', P.cleanName('讲解中【高奢女装】彩色扣设计针织开衫'),
  '【高奢女装】彩色扣设计针织开衫');
eq('cleanName 去掉「正在讲解」前缀', P.cleanName('正在讲解【高奢女装】针织衫'), '【高奢女装】针织衫');

/* 2026-11-01 用户截图:消息盒子值段出现「预热中 【KiKi】…」——「预热中」是**预热阶段**的
 * 状态词,和「讲解中」互斥;它一旦留在名字里,既被当成商品名念出来,又让名字兜底键随阶段漂移。 */
eq('cleanName 去掉「预热中」前缀(预热阶段的商品名只留标题)',
  P.cleanName('预热中 【KiKi】 【简明】纯棉松弛感简约纯色薄款微透女款上衣 Y113'),
  '【KiKi】 【简明】纯棉松弛感简约纯色薄款微透女款上衣 Y113');
ok('同一商品「预热中 → 讲解中」换阶段后名字与身份键都不变',
  P.cleanName('预热中 【KiKi】 【简明】女款上衣 Y113') ===
  P.cleanName('讲解中 【KiKi】 【简明】女款上衣 Y113') &&
  P.keyOf(P.cleanName('预热中 【KiKi】 【简明】女款上衣 Y113')) ===
  P.keyOf(P.cleanName('讲解中 【KiKi】 【简明】女款上衣 Y113')));
ok('身份键里不残留「预热中」',
  P.keyOf(P.cleanName('预热中 【KiKi】 【简明】女款上衣 Y113')).indexOf('预热') < 0);
eq('cleanName 截掉 ID/货号/提词/卖点这些行内噪音',
  P.cleanName('讲解中【高奢女装】彩色扣针织开衫A0476ID货号未设提词设置卖点'),
  '【高奢女装】彩色扣针织开衫A0476');
ok('同一商品在「讲解中 / 已取消」两种状态下名字与身份键完全一致',
  P.cleanName('讲解中【高奢女装】彩色扣针织开衫A0476') ===
  P.cleanName('【高奢女装】彩色扣针织开衫A0476') &&
  P.keyOf(P.cleanName('讲解中【高奢女装】彩色扣针织开衫A0476')) ===
  P.keyOf(P.cleanName('【高奢女装】彩色扣针织开衫A0476')));
ok('状态词不再出现在身份键里(取消后仍能按「名字前 8 字」找回)',
  P.keyOf(P.cleanName('讲解中【高奢女装】彩色扣针织开衫A0476')).indexOf('讲解中') < 0);

/* ---------------- A. 商品 ID 作为唯一锚点(2026-10-27 用户定) ----------------
 * 「每个商品对应的 ID 都是独一无二的,商品 ID 不是货号」——
 * 名字会随「讲解中」标签变化,ID 不会;货号(A0476 这种)长度短、可能重复,不能当锚点。 */

ok('19 位纯数字认成 ID', P.looksLikeId('3541234567890123456') === '3541234567890123456');
eq('带数字的短串也认(兼容别的 ID 形态)', P.looksLikeId('goods-99887'), 'goods-99887');
ok('货号 A0476 不当 ID(长度不够)', P.looksLikeId('A0476') === '');
ok('价格 134.00 / 库存 0/5 / 序号 1 都不当 ID',
  P.looksLikeId('134.00') === '' && P.looksLikeId('0/5') === '' && P.looksLikeId('1') === '');
ok('中文提示语(复制商品ID)不当 ID', P.looksLikeId('复制商品ID') === '');

(function () {
  function fakeEl(t, attrs) {
    return {
      textContent: t || '',
      getAttribute: function (a) { return (attrs && attrs[a]) || null; },
      querySelector: function () { return null; }
    };
  }
  var child = fakeEl('', { 'data-row-key': '3541234567890123456' });
  var row = {
    textContent: '',
    getAttribute: function () { return null; },
    querySelector: function () { return null; },
    querySelectorAll: function (sel) { return sel === 'a[href]' ? [] : [child]; }
  };
  ok('行内 data-row-key 上的 19 位 ID 能被挖出来', P.pickIdFromRow(row) === '3541234567890123456');

  var textRow = {
    textContent: '',
    getAttribute: function () { return null; },
    querySelector: function () { return null; },
    querySelectorAll: function (sel) {
      return sel === 'a[href]' ? [] : [fakeEl('3541987654321098765', {})];
    }
  };
  ok('ID 直接显示成数字文本时也能认(不依赖属性)', P.pickIdFromRow(textRow) === '3541987654321098765');

  var noIdRow = {
    textContent: '【高奢女装】彩色扣设计针织开衫V领长袖毛衣A0476',
    getAttribute: function () { return null; },
    querySelector: function () { return null; },
    querySelectorAll: function (sel) { return sel === 'a[href]' ? [] : [fakeEl('A0476', {})]; }
  };
  ok('只有货号时坚决不用它当 ID(留给名字兜底)', P.pickIdFromRow(noIdRow) === '');

  /* 2026-10-27 现场 HTML 实证:商品 ID 在 `data-rbd-draggable-id`(react-beautiful-dnd 的
     draggableId),固定属性表全落空 —— 必须按「属性名里带 id」泛化扫。 */
  function attrRow(attrs) {
    var child = {
      textContent: '', getAttribute: function () { return null; },
      querySelector: function () { return null; },
      attributes: attrs
    };
    return {
      textContent: '', getAttribute: function () { return null; },
      querySelector: function () { return null; },
      querySelectorAll: function (sel) { return sel === 'a[href]' ? [] : [child]; }
    };
  }
  ok('data-rbd-draggable-id 里的 19 位商品 ID 能被认出来(真机形态)',
    P.pickIdFromRow(attrRow([
      { name: 'data-rbd-draggable-context-id', value: '0' },
      { name: 'data-rbd-draggable-id', value: '3849526557068624049' }
    ])) === '3849526557068624049');
  ok('只有 data-rbd-draggable-context-id="0" 时不会被误认成 ID',
    P.pickIdFromRow(attrRow([{ name: 'data-rbd-draggable-context-id', value: '0' }])) === '');
})();

ok('身份键优先吃 ID:computeRowKey 里排在名字兜底之前',
  (function () {
    const i = src.indexOf('function computeRowKey');
    const seg = src.slice(i, i + 1400);
    const a = seg.indexOf('pickIdFromRow(row)');
    const b = seg.indexOf("'nm:'");
    return a > 0 && b > 0 && a < b;
  })());
ok('诊断出口带 ID 体检(rowKeys / idSample),下次复制诊断就能看到 ID 有没有抓到',
  /rowKeys: rows\(\)/.test(src) && /idSample:/.test(src) && /picked: pickIdFromRow\(r\)/.test(src));

/* ---------------- A. 原生搜索定位(2026-10-27 用户方案) ----------------
 * 用户原话:「既然是用ID来定位这个商品的,那时间到了就用原生搜索去搜索这个ID,
 *   原生搜索是支持这个方法且秒跳转的,定位到商品之后直接循环,
 *   然后再把屏幕回到最开始来的位置」。 */

eq('id: 键 → 商品 ID(拿去搜)', P.idOfKey('id:3849526557068624049'), '3849526557068624049');
ok('名字键不去搜索(没有唯一 ID 就不该动搜索框)', P.idOfKey('nm:高奢女装彩色扣') === '');
ok('空键 / 货号都不给搜索值', P.idOfKey('') === '' && P.idOfKey('id:A0476') === '');
ok('搜索框判据与 search.js 同源(placeholder 含「商品名称」)', /PH_SEARCH = '商品名称'/.test(src));
ok('排除「添加商品」抽屉里的同名输入框(且不被小黄车自身的浮层类名误伤)',
  /function inOverlayEl\(el, stopAt\)/.test(src) && /HARD_OVERLAY_RE/.test(src) &&
  !/modal\|dialog\|drawer\|overlay\|popup/.test(src.slice(src.indexOf('HARD_OVERLAY_RE ='), src.indexOf('HARD_OVERLAY_RE =') + 160)));
ok('兜底候选排除页头 / 导航里的全局搜索框(写 ID 回车可能跳页)',
  /function inHeadArea/.test(src) && /!fallback && !inHeadArea\(el\)/.test(src));
ok('写值走原生 setter + input 事件(React 受控框才认账)',
  /getOwnPropertyDescriptor\(window\.HTMLInputElement\.prototype, 'value'\)/.test(src) &&
  /new window\.Event\('input'/.test(src));
ok('原生搜索用真实 Enter 派发(keydown / keypress / keyup 三个都发)',
  /KeyboardEvent\('keydown'/.test(src) && /KeyboardEvent\('keypress'/.test(src) && /KeyboardEvent\('keyup'/.test(src));
ok('回车不生效时点放大镜兜底(不靠坐标猜)', /function clickSearchIcon/.test(src) && /search/i.test(src));
ok('认平台高亮的命中行(类名 hash 会变 ⇒ 子串匹配)', /goods-item_hl/.test(src));
ok('搜索优先、滚屏只兜底(顺序不能倒)', (function () {
  const i = src.indexOf('async function doCycle');
  const seg = src.slice(i, src.indexOf('function stopByNoLecture'));
  const a = seg.indexOf('await locateBySearch(');
  const b = seg.indexOf('await revealRow(');
  return a > 0 && b > a;
})(), 'doCycle 里应先 locateBySearch 再 revealRow');
ok('还原信息在动搜索框**之前**登记(被中止也不会漏还原)', (function () {
  const i = src.indexOf('async function locateBySearch');
  const seg = src.slice(i, i + 900);
  const a = seg.indexOf('pendingSearch = {');
  const b = seg.indexOf('setInputValue(input, id)');
  return a > 0 && b > a;
})(), 'pendingSearch 必须在写搜索框之前赋值');
ok('finally 里先还搜索、再还滚动(搜索一清空列表就重排)', (function () {
  /* 2026-10-31:还原逻辑抽成 restoreSearchNow(),顺序断言改到该函数体内;
   * 再确认两档的 finally 都只走这一个出口(不再各写一份)。 */
  const i = src.indexOf('async function restoreSearchNow');
  if (i < 0) return false;
  const seg = src.slice(i, i + 1400);
  const a = seg.indexOf('setInputValue(srch.input, srch.prevQuery)');
  const b = seg.indexOf('srch.container.scrollTop');
  if (!(a > 0 && b > a)) return false;
  const f1 = src.indexOf('} finally {', src.indexOf('async function doCycle'));
  const f2 = src.indexOf('} finally {', src.indexOf('async function doFastCycle'));
  return /await restoreSearchNow\(\)/.test(src.slice(f1, f1 + 700)) &&
    /await restoreSearchNow\(\)/.test(src.slice(f2, f2 + 700));
})());
ok('收尾把用户原来的搜索词写回去', /setInputValue\(srch\.input, srch\.prevQuery\)/.test(src));

/* ---------------- A. 动作期间不抖 + 时间槽文案(2026-10-27) ----------------
 * 用户原话:「全局轮询的时候,这个按钮不要一直跳动,同时在找这个商品的时候,
 *   对应的时间占位符可以改一下文案」。 */

ok('找款/续讲/拖滑条期间 place() 位置冻结(busy 与 drag 都判在 findAnchor 之前)', (function () {
  const i = src.indexOf('function place() {');
  const seg = src.slice(i, i + 1100);
  const a = seg.indexOf('if (state.busy || drag)');
  const b = seg.indexOf('findAnchor(');
  return a > 0 && b > a;
})());
ok('拖动滑条的 move 挂在 document 上,指针离开轨道也不会断', (function () {
  const i = src.indexOf('function bindDrag() {');
  const seg = src.slice(i);
  const j = seg.indexOf('\n  }');            // bindDrag 函数体到第一个收尾缩进
  const body = j > 0 ? seg.slice(0, j) : seg.slice(0, 2600);
  return /document\.addEventListener\('pointermove', onMove, true\)/.test(body) &&
    !/(^|[^\w$.])t\.addEventListener\('pointermove'/.test(body);
})());
ok('拖动中滚动不藏胶囊、外部点击不关面板', (function () {
  const a = src.indexOf('function noteScroll()');
  const b = src.indexOf('function onDocClick(');
  return /if \(drag\) return;/.test(src.slice(a, a + 600)) &&
    /if \(drag\) return;/.test(src.slice(b, b + 600));
})());
ok('自己滚屏触发的 scroll 事件不再把胶囊藏起来', (function () {
  const i = src.indexOf('function noteScroll()');
  const seg = src.slice(i, i + 500);
  return /if \(state\.busy && !userBusy\(\)\) return;/.test(seg);
})(), 'noteScroll 里应有 busy 闸门');
ok('找商品期间时间槽显示「定位中」', /slot\.textContent = state\.busyLabel \|\| '定位中'/.test(src) &&
  /state\.busyLabel = '搜索中'/.test(src));
ok('busy 文案排在 phase 分支之前(否则永远轮不到)', (function () {
  /* 2026-11-05:原来按「paint 起 1200 字符」切,加了无限模式的分支后窗口不够,
   * 断言变成 indexOf=-1 互比 —— 过时的是切片,不是代码。改成按函数边界截取。
   * 2026-11-05 二次:兜底 2000 字符又被「胶囊 ∞ 常驻」那段挤出窗口,改成找
   * 下一个同级函数开头(不再依赖字符数),以后往 paint 里加代码不会假红。 */
  const i = src.indexOf('function paint()');
  let j = src.indexOf('\n  function ', i + 10);
  if (j < 0) j = i + 4000;
  const seg = src.slice(i, j);
  return seg.indexOf("state.busyLabel || '定位中'") < seg.indexOf("key = 'run:'");
})());
ok('动作开始/收尾都重画一次(文案进得去也出得来)',
  (src.match(/state\.busy = true;\s*\n\s*paint\(\);/) || []).length >= 1 &&
  /state\.busy = false;\s*\n\s*paint\(\);/.test(src));

/* ---------------- A. 失败重试的节奏与终点(2026-10-27) ----------------
 * 用户原话:「我很介意重复执行轮询然后大半时间被这个滚动的状态给占用」。
 * 实测漏洞:失败后 nextAt 仍在过去,两处调用点只看 nextAt ⇒ 每 2 秒就再开一轮,
 * 退避的 30s / 60s 形同虚设。以下四条把它钉住。 */

ok('「看不见行 + 到点」那条路也要过退避闸门(否则每 2 秒重来一轮)', (function () {
  const i = src.indexOf('if (state.nextAt && now >= state.nextAt && !state.busy');
  const seg = src.slice(i, i + 200);
  return /now >= \(state\.retryAt \|\| 0\)/.test(seg);
})(), '缺 retryAt 闸门 ⇒ 退避失效');
ok('「行在、到点」那条路同样过退避闸门', /if \(now < \(state\.retryAt \|\| 0\)\) return;/.test(src));
ok('失败重试有终点(FAIL_MAX 存在且在 failCycle 里生效)',
  /var FAIL_MAX = 6;/.test(src) && /state\.fails >= FAIL_MAX/.test(src));
ok('到终点就停表并明说一句(不留无限 60 秒慢速重试)',
  /if \(state\.fails >= FAIL_MAX\)[\s\S]{0,400}setOn\(false, true\);/.test(src));
ok('退避常量真的被用上(30s / 60s 不再是摆设)',
  /state\.retryAt = Date\.now\(\) \+ \(state\.fails >= FAIL_LIMIT \? SLOW_MS : RETRY_MS\);/.test(src));
ok('停表时把失败计数与退避时刻一起清(新的一轮不继承旧退避)',
  (function () {
    const i = src.indexOf('function resetToWait()');
    const seg = src.slice(i, i + 700);
    return /state\.fails = 0;/.test(seg) && /state\.retryAt = 0;/.test(seg);
  })());
/* 用**代码里的真实常量**算一遍时间表,别凭感觉说「会很快停」:
 * 最坏单次动作 ≈ 搜索 2.6s + 滚屏 8s + 收尾 0.7s ≈ 11.3s。 */
ok('按代码常量推演:5 分钟内最多 6 次尝试,真正在动作的时间 ≤ 70 秒', (function () {
  const num = function (re) { const m = src.match(re); return m ? Number(m[1]) : NaN; };
  const RETRY = num(/var RETRY_MS = (\d+);/);
  const SLOW = num(/var SLOW_MS = (\d+);/);
  const LIMIT = num(/var FAIL_LIMIT = (\d+);/);
  const MAX = num(/var FAIL_MAX = (\d+);/);
  if (![RETRY, SLOW, LIMIT, MAX].every(Number.isFinite)) return false;
  let span = 0, fails = 0, n = 0;
  while (n < 50) {
    n += 1; fails += 1;
    if (fails >= MAX) break;
    span += (fails >= LIMIT ? SLOW : RETRY);
  }
  return n === MAX && span <= 300000 && n * 11.3 <= 70;
})(), '尝试次数/跨度超出预期');

/* ---------------- A. 滚屏频率(2026-10-27 用户:「滚屏太多了,降低滚屏频率」) ----------------
 * 滚屏是兜底不是主路径。两条限制:单趟预算 5 秒、同一商品整场只许一趟。 */

ok('单段滚屏预算 8 秒(2026-10-31 提速:5→8 秒,一段约走 19 档)',
  /var SCAN_MS = 8000;/.test(src) && /Date\.now\(\) \+ SCAN_MS/.test(src));
/* 2026-10-27 二次(用户:「200 个品,8 秒或者 5 秒不够滚到底部啊」):
 * 从「整场只滚一趟」改成「分段续扫」——单段有预算,但记住断点,几段覆盖 200 个品。
 * 2026-10-31(用户问「滚屏到底要多久」):段间 6 秒 → 1.5 秒 —— 200 品光段间就白等 54 秒,
 *   这才是「一次找品 98 秒」的主因;「反复滚」已由 scanDone 拦住,不必再靠长间隔压频。 */
ok('分段续扫:单段预算 + 段间隔都存在(段间 1.5 秒)',
  /var SCAN_MS = 8000;/.test(src) && /var SCAN_GAP_MS = 1500;/.test(src));
ok('断点记在 state.scanPos,下一段从那里接着走(不重复不回头)',
  /state\.scanPos >= 0/.test(src) && /state\.scanPos = Math\.min\(maxScroll, pos\)/.test(src));
ok('绕回顶部算扫完一圈,之后不再滚(交给搜索/重试)',
  /wrapped = true;/.test(src) && /wrapped && pos >= start\) \{ state\.scanDone = true/.test(src) &&
  /if \(state\.scanDone\) \{/.test(src));
ok('这一段没扫完 ⇒ 不计失败,隔 1.5 秒接着扫', /if \(revealed === 'partial'\) \{/.test(src) &&
  /state\.retryAt = Date\.now\(\) \+ SCAN_GAP_MS/.test(src));
ok('续扫途中不再重复搜索(省每段 2.6 秒)', /var resuming = state\.scanPos >= 0;/.test(src) &&
  /if \(!resuming\) \{/.test(src));
/* 2026-10-31(D1/D2):旧的 `if (bySearch && n <= 1) return false` 是错的 ——
 * 那一刻搜索词还没还原,rows() 量到的是被我们写的 ID 筛过的短列表,
 * 「搜不到」于是被读成「列表里没这件商品」,搜一次就停表、滚屏永远轮不到。
 * 现在改成:搜索失败 → 先 restoreSearchNow 还原 → 再判断要不要滚。 */
ok('搜索失败先还原筛选词再判断(不再拿「被筛过的短列表」证明「滚也白滚」)',
  !/if \(bySearch && n <= 1\)/.test(src) &&
  /function allowScroll\(\) \{/.test(src) &&
  /await restoreSearchNow\(\);\n\s*if \(attempt < SEARCH_RETRY_MAX\)/.test(src));

/* ---------------- 分钟档找品顺位(2026-10-31 用户定 Q1=B / Q4=重试 1 次隔 5 秒) ---------------- */
ok('搜索失败后重试 1 次、隔 5 秒(常量 + 循环边界自证)',
  /var SEARCH_RETRY_MS = 5000;/.test(src) && /var SEARCH_RETRY_MAX = 1;/.test(src) &&
  /for \(var attempt = 0; attempt <= SEARCH_RETRY_MAX; attempt\+\+\)/.test(src));
ok('每次搜索失败都先还原筛选词(否则重试会把我们写的 ID 当成用户的词)',
  (function () {
    const i = src.indexOf('for (var attempt = 0;');
    const j = src.indexOf('if (!row) {', i);      // 重试循环到底为止
    if (i < 0 || j <= i) return false;
    const seg = src.slice(i, j);
    const a = seg.indexOf('await restoreSearchNow();');
    const b = seg.indexOf('if (attempt < SEARCH_RETRY_MAX)');
    return a > 0 && b > a;
  })());
ok('重试等待可打断:分片 sleep,每片比一次中止令牌',
  /async function waitSearchRetry\(ms, mark\)/.test(src) &&
  /await sleep\(200\);[\s\S]{0,140}if \(aborted\(mark\)\) return 'abort';/.test(src));
ok('等待期间「讲解中」自己回来了 ⇒ 不再重试搜索,直接接着讲',
  /async function waitSearchRetry[\s\S]{0,500}if \(findLiveRow\(\)\) return 'returned';/.test(src) &&
  /if \(waited === 'returned'\) \{/.test(src));
ok('分钟档成功后清滚屏额度(否则跑几轮就永久不再滚)',
  (function () {
    const i = src.indexOf('function resetScanQuota');
    if (i < 0) return false;
    const f = src.slice(i, i + 500);
    /* 2026-11-06:分钟档收尾抽成 finishSlowCycle(弹卡与老流程共用一份),断言跟着搬家 */
    const iFin = src.indexOf('function finishSlowCycle');
    const iCall = iFin < 0 ? -1 : src.indexOf('resetScanQuota();', iFin);
    const called = iCall > 0 && iCall < src.indexOf('async function doCycle', iFin);
    return /state\.scanDone = false;/.test(f) && /state\.scanSeg = 0;/.test(f) &&
      /state\.scanNeed = 0;/.test(f) && called;
  })());

/* ---------------- 秒档搜索兜底(2026-10-31 用户追加:「重试失败多次的最终兜底」) ---------------- */
ok('秒档搜索只在「再失败就熔断」那一轮兜底,不是每 3 轮一次',
  /isRescue = \(state\.skips \+ 1\) >= SKIP_LIMIT && !!idOfKey\(state\.key\)/.test(src) &&
  /var budget = isRescue \? SLOW_BUDGET_MS : FAST_BUDGET_MS;/.test(src));
ok('秒档兜底轮预算放大到 6000ms(搜索 2.9 秒装得下),常规轮 4500ms(给按钮翻转留够时间)',
  /var SLOW_BUDGET_MS = 6000;/.test(src) && /var FAST_BUDGET_MS = 4500;/.test(src));
ok('秒档等按钮翻转超预算时退出循环,不直接跳过整轮(2026-11-01 修「能跑一两轮就停」)',
  /if \(Date\.now\(\) > flipUntil\) \{ break; \}/.test(src) &&
  /afterCancel && !isLecturing\(afterCancel\)/.test(src));
ok('后台等待走拍子驱动,且放行排在 busy 判断之前(2026-11-01 修「切回去才动」)',
  /function nap\(ms\)/.test(src) &&
  /function drainNaps\(\)/.test(src) &&
  /drainNaps\(\);\s*if \(!state\.on \|\| state\.busy\) return false;/.test(src));
ok('停表时放行挂起的后台等待,避免 async 链悬空、busy 卡死',
  /flushNaps\(\);/.test(src) && /abortCycle\(\);[^\n]*\n[^\n]*flushNaps\(\);/.test(src));
ok('后台等待不用 setTimeout 硬等(页面 hidden 时走 nap)',
  /function pageHidden\(\) \{[\s\S]{0,600}?visibilityState === 'hidden'/.test(src) &&
  /if \(!pageHidden\(\)\) return sleep\(ms\);/.test(src));
/* nap8(2026-11-01):切窗口/最小化时 visibilityState 仍是 visible,旧判据把这种
   "看不见但在前台"的状态当前台,于是走等翻转那条永远等不到的路。 */
ok('「看不见」不只认 visibilityState:rAF 停摆(切标签/最小化)也算后台',
  /var RAF_STALE_MS = 2000;/.test(src) &&
  /lastRafAt && Date\.now\(\) - lastRafAt > RAF_STALE_MS/.test(src) &&
  /requestAnimationFrame\(function \(\) \{[\s\S]{0,120}lastRafAt = Date\.now\(\);/.test(src));
/* 2026-11-01 第二版:只改秒档三处不够,fastHop / fastSearch / waitSearchRetry
   里还有十几处 sleep,后台每处被压到 60 秒,一轮照样几分钟。必须堵在 sleep 这层。 */
ok('sleep 本身在后台改走拍子(所有等待点一次性变后台安全)',
  /function sleep\(ms\) \{\s*if \(state && state\.on [\s\S]{0,120}return nap\(ms\);/.test(src));
ok('报告能区分「拍子放行」与「兜底放行」,并带代码标记(防止拿旧代码的报告当结论)',
  /var napByBeat = 0;/.test(src) && /var napByTimer = 0;/.test(src) &&
  /tag: LOOP_TAG/.test(src) && /var LOOP_TAG = 'nap\d+';/.test(src));
/* 2026-11-01 nap7 记账制:取消后欠一次补讲,补上才销账 ——
   旧时间窗口一旦被「进场看见在讲」清零,续讲丢了就只会跳过、永远不补
   (实机 02:48:49 两跳即熔断,商品空着没人讲)。 */
  /* 当前现场优先：只有我方取消留下的续讲任务能补讲；旧品未讲解则等待新品。 */
ok('旧品未讲解且无我方续讲任务 ⇒ 待命，不能凭记忆重新开讲',
  /if \(!lecturing && !state\.owedResume && !state\.cancelPending\)/.test(src) &&
  /stopByNoLecture\('找回的商品已未讲解', '等待新的讲解'\)/.test(src));
/* 用户 2026-11-01 04:17 明确:「禁止点击预热功能和取消预热功能的按钮,这个跟你程序无关」。
   所以只保留"不把预热按钮当讲解按钮"的排除规则,**绝不点它**。 */
/* nap14(2026-11-01 用户截图 + 指令):「商品刚开价,此时取消讲解卡会收回,是否确认取消?」
   用户要的是**点【取消】**(放弃这次取消、保住讲解卡),不是点确定;点完本轮直接结束,
   别等按钮翻转(它不会翻)、别报「取消讲解未确认」、循环照常继续。 */
/* 用户 2026-11-01:「这个帮忙取消弹窗的按钮,需要弹一下提示,但不用收纳进消息盒子」
   ⇒ 只写胶囊状态行(setStatusLine),不走 boxNote;文案 18 字,合 desc≤24 规范。 */
ok('点掉确认弹窗时弹一句胶囊提示,但不进消息盒子历史',
  (src.match(/setStatusLine\('刚开价 · 已点「取消」保住讲解卡', 'warn'\);/g) || []).length === 2 &&
  /刚开价不让取消 ⇒ 已点【取消】保住讲解卡,本轮跳过/.test(src) &&
  !/刚开价不让取消[\s\S]{0,200}?boxNote\(/.test(src));
ok('刚开价弹「确认取消讲解？」⇒ 点【取消】保住讲解卡,本轮跳过不停表',
  /function dismissCancelConfirm\(\) \{/.test(src) &&
  /t\.indexOf\('确认取消讲解'\) < 0/.test(src) &&
  /if \(txt\(b\) !== '取消'\) continue;/.test(src) &&
  (src.match(/dismissCancelConfirm\(\)/g) || []).length >= 3 &&
  /刚开价不让取消 ⇒ 已点【取消】保住讲解卡,/.test(src) &&
  /刚开价不让取消 ⇒ 已点【取消】保住讲解,/.test(src));
ok('预热/取消预热按钮一律不点(只在识别讲解按钮时排除它们)',
  /t === '预热' \|\| t === '取消预热'/.test(src) &&
  !/findUnpreheatBtn/.test(src));
ok('点取消即记账、补讲/续讲确认成功才销账( owedResume 记账制 )',
  /state\.owedResume = Date\.now\(\);/.test(src) &&
  (src.match(/state\.owedResume = 0;/g) || []).length >= 3);
ok('停表只留「商品不在列表」这一条(那才是真的没得讲)',
  /stopByNoLecture\('商品已不在列表/.test(src) &&
  /function btnLabelOf\(row\)/.test(src));
ok('状态确认类失败单独计数(SOFT_LIMIT),不烧「找不到商品」的额度',
  /var SOFT_LIMIT = 6;/.test(src) && /function softSkipFast\(why\)/.test(src) &&
  /if \(state\.softFails >= SOFT_LIMIT\) \{ stopFast\(/.test(src) &&
  /state\.softFails = 0;/.test(src));
ok('补点讲解最多点三次(平台会吞掉刚取消完的那一次点击)',
  /async function clickLectureAndVerify\(mark, firstBtn\)/.test(src) &&
  /clicks < 4/.test(src));
ok('一轮成功统一走 finishFastCycle 记账(前台弹卡/重讲 + 盲模式各条路都走同一套收尾)',
  /function finishFastCycle\(row, name, how\)/.test(src) &&
  (src.match(/finishFastCycle\(/g) || []).length >= 6 &&
  /* 秒档函数体内不许再手写轮次自增 —— 那样会绕过消息与计时重置 */
  !/state\.round \+= 1;/.test(src.slice(src.indexOf('async function doFastCycle'),
    src.indexOf('function checkNow'))));
/* nap8(2026-11-01 用户:「一切换页面就再也不循环了」):
   旧盲模式用 cancelPending + TTL 复看,而隐藏标签的 DOM 冻结在「取消讲解」⇒
   lecturing 恒真 ⇒ 永远点取消、永远不补讲 ⇒ 商品空着,看着像"停了"。
   现在改阶段账本:发过取消就下一轮无条件补讲,不问 DOM。 */
ok('盲模式一轮只做一个动作:先取消、再补讲(靠账本推进,不看 DOM)',
  /var blind = pageHidden\(\);/.test(src) &&
  /if \(state\.cancelPending\) \{[\s\S]{0,900}?var rb2 = findLectureBtn\(row\);/.test(src) &&
  /state\.cancelPending = Date\.now\(\);\s*\n\s*state\.owedResume = Date\.now\(\);/.test(src));
/* nap10(实机 03:35:06):界面没翻时点一下是白费 —— DOM 冻着,按钮还写「取消讲解」,
   点下去等于再取消一次,把一次真循环拖成 3 轮 48 秒。改成只在按钮真变回「讲解」时点。 */
ok('盲模式补讲只在界面真的翻回「讲解」时才点,没翻就 3 秒后再看',
  /if \(rb2 && rl2 === 'start'\) \{/.test(src) &&
  /盲模式:等界面翻\(按钮「/.test(src) &&
  /var BLIND_TICK_MS = 3000;/.test(src));
ok('界面 6 秒没翻就主动点一次「刷新列表」催平台更新(20 秒限频)',
  /function findListRefreshBtn\(\) \{/.test(src) &&
  /state\.blindWaits === 2 && Date\.now\(\) - \(state\.blindRefreshAt \|\| 0\) > 20000/.test(src) &&
  /t\.indexOf\('刷新列表'\) !== 0/.test(src));
ok('界面多次没翻仍有兜底强制点一次,绝不死等',
  /var BLIND_WAIT_MAX = 5;/.test(src) &&
  /if \(state\.blindWaits < BLIND_WAIT_MAX\)/.test(src) &&
  /盲模式:界面 ' \+ state\.blindWaits \+ ' 次没翻 ⇒ 强制补讲一次/.test(src));
/* nap10:检查绑在 15 秒间隔上,常常刚好卡在「还没翻」那一侧 → 白等一整轮。
   改成每秒拍子探一次按钮文案,界面一翻就补讲(实测一次循环 48 秒 → 只受 DOM 延迟限制)。 */
ok('盲模式有「提前补讲探测」:界面一翻就补,不必等满间隔',
  /var PEEK_MIN_MS = 3000;/.test(src) && /var PEEK_MS = 1000;/.test(src) &&
  /if \(peekBtn && kindOf\(peekBtn\) === 'start'\) \{/.test(src) &&
  /state\.nextAt = now;/.test(src));
/* nap10 第二处 → nap11 修正:曾经让间隔"从点取消起算",结果补讲刚点完就抢跑下一轮,
   读到的是补讲前的界面(不在讲)⇒ 又点一次讲解,白推后一个间隔(实机 03:45:54)。
   现在两个阶段各按各的节奏:取消后 3 秒密探,补讲后老实等满间隔。 */
ok('取消后走 3 秒密探、补讲后等满间隔(两个阶段不再互相抢跑)',
  /state\.cancelPending = Date\.now\(\);[\s\S]{0,900}?state\.nextAt = Date\.now\(\) \+ BLIND_TICK_MS;/.test(src) &&
  !/function seatBlindNextAt/.test(src));
ok('补讲后有「等界面反映」观察期,期内读到不在讲也不乱点',
  /var BLIND_SETTLE_MS = 30000;/.test(src) &&
  /state\.blindSettled && Date\.now\(\) - state\.blindSettled < BLIND_SETTLE_MS/.test(src));
ok('盲模式补讲不再"等界面翻":REFLECT/CANCEL_TTL 那套复看机制整体删除',
  !/var REFLECT_MS = /.test(src) && !/var CANCEL_TTL_MS = /.test(src) &&
  !/state\.startedAt \+ REFLECT_MS/.test(src));
ok('盲模式补讲本轮不确认成败,留给下一轮读到「在讲」时销账',
  /if \(state\.cancelPending\) \{[\s\S]{0,1800}?state\.cancelPending = 0;\s*\n\s*state\.blindWaits = 0;\s*\n\s*state\.blindSettled = Date\.now\(\);/.test(src));
/* nap8 实机回归抓到的真 bug:盲模式下"界面说在讲"可能只是 DOM 冻结,账上那笔取消还在。
   若此时销账,下一轮界面翻成「不在讲」就成了"不欠账却不在讲" ⇒ 误停表。 */
ok('销账必须等"界面在讲 + 没有待反映的取消"两个条件同时成立(nap8 误停表的根因)',
  /if \(lecturing && !state\.cancelPending\) state\.owedResume = 0;/.test(src) &&
  !/if \(lecturing\) state\.owedResume = 0;/.test(src));
/* nap9(2026-11-01 实机 03:27:18):后台那次停表的现场是「按钮「讲解」· 欠账无」——
   界面已经翻成讲解、补讲机会就在眼前,却因为账上没钱而停表。
   而用户手动取消只可能发生在前台(isTrusted 监听即时停表),后台看到「不在讲」
   只可能是平台自停/我方取消后果/DOM 假阴性,三种都该补讲。 ⇒ 后台删掉停表这条路。 */
ok('盲模式里不允许出现任何停表出口(停表是切后台最坏的结果)',
  (function () {
    const i = src.indexOf('if (blind) {');
    const j = src.indexOf('if (!lecturing) {', i);
    if (i < 0 || j <= i) return false;
    const seg = src.slice(i, j);
    return !/stopByNoLecture\(/.test(seg) && !/stopFast\(/.test(seg);
  })());
ok('盲模式「不在讲」直接补讲,不再拿欠账当拦路条件',
  /不在讲。两种情况要分开:[\s\S]{0,2000}?noteDiag\('盲模式补讲:看不见讲解/.test(src));
ok('后台找不到商品行也不熔断(隐藏标签回收行 ≠ 商品没了)',
  /if \(pageHidden\(\)\) \{\s*\n\s*noteDiag\('盲模式:这一轮看不到商品行,跳过\(不停表\)'\);/.test(src));
ok('owedResume 只在「读到正在讲解且无待反映取消」与「补讲/续讲确认成功」时销账,finishFastCycle 不销',
  /if \(lecturing && !state\.cancelPending\) state\.owedResume = 0;/.test(src) &&
  !/state\.status = null;\s*[\r\n]+\s*state\.owedResume = 0;/m.test(src));

ok('熔断门槛 3 轮:第 2 次跳过触发搜索兜底,第 3 次才熔断(重渲染抖动留足余量)',
  /var SKIP_LIMIT = 3;/.test(src) && /SKIP_LIMIT\) \{ stopFast\(/.test(src));
ok('欠账有过期时间,防无限补讲(2 分钟没补上就作废)',
  /var OWED_TTL_MS = 120000;/.test(src) &&
  /Date\.now\(\) - state\.owedResume > OWED_TTL_MS/.test(src));
ok('秒档兜底也走统一还原出口(finally → restoreSearchNow)',
  (function () {
    const f2 = src.indexOf('} finally {', src.indexOf('async function doFastCycle'));
    return f2 > 0 && /await restoreSearchNow\(\)/.test(src.slice(f2, f2 + 800));
  })());

/* ---------------- 定位记忆(2026-10-27 用户:「下次循环讲解是不是有记忆,瞬间飞过去」) ---------------- */
ok('有「记忆探针」:直接飞到上次找到的位置看一眼,不是每次都从头扫',
  /async function probeAnchor\(mark\)/.test(src) &&
  /var target = Math\.max\(0, Math\.min\(maxScroll, a\.offset - 120\)\);/.test(src) &&
  /c\.scrollTop = target;/.test(src));
ok('记忆排在搜索**前面**(先飞 → 再搜 → 最后分段扫)',
  (function () {
    const a = src.indexOf('var probed = await probeAnchor(mark);');
    const b = src.indexOf('var bySearch = await locateBySearch(');
    return a > 0 && b > a;
  })());
ok('分段扫途中不再探针(记忆已证明不准,别每段白飞 0.8 秒)',
  /if \(\(!row \|\| !findLectureBtn\(row\)\) && state\.scanPos < 0\) \{/.test(src));
ok('探针只动滚动:不碰 scanPos / scanPrev / scanSeg(落空不占分段扫额度、不留错断点)',
  (function () {
    const i = src.indexOf('async function probeAnchor(mark)');
    const j = src.indexOf('async function revealRow(name)');
    if (i < 0 || j < i) return false;
    const seg = src.slice(i, j);
    return !/state\.scanPos\s*=/.test(seg) && !/state\.scanPrev\s*=/.test(seg) &&
           !/state\.scanSeg\s*=/.test(seg);
  })());
ok('探针不算"找到":有行还得有讲解按钮才算命中(用户已取消时别误判)',
  /if \(row && findLectureBtn\(row\)\) \{\s*state\.anchorHits/.test(src));
ok('记忆越界(列表变短 / 商品被删)⇒ 作废,不从底部白扫',
  /if \(a\.offset > maxScroll \+ 200\) \{/.test(src) && /anchor-stale/.test(src));
ok('滚屏命中那一刻校准记忆(下次第一档就准)', /state\.rowAnchor = recordRowAnchor\(hit\);/.test(src));
ok('换品时清掉旧商品的定位记忆(否则第一档会飞到上一个商品那儿)',
  (function () {
    const i = src.indexOf('function commitProduct');
    const seg = src.slice(i, i + 1600);
    return /state\.rowAnchor = null;/.test(seg) && /state\.anchorHits = 0;/.test(seg);
  })());
ok('探针落空:命中计数归零 + 记诊断(下次重新靠搜索校准)',
  /state\.anchorHits = 0;[^\n]*\n\s*diagOnce\('anchor-miss'/.test(src));
ok('用户手势优先:探针遇到用户滚动/点击直接让路', /if \(userBusy\(\)\) return 'busy';/.test(src));
ok('probe 出口带定位记忆(anchorOffset / anchorHits),能看出记忆靠不靠得住',
  /anchorOffset:/.test(src) && /anchorHits: state\.anchorHits/.test(src));
ok('段数按"实际可滚距离"推算:50 品一段就够、200 品约 4 段(小黄车上限 200)',
  /state\.scanNeed = Math\.max\(1, Math\.min\(SCAN_MAX_SEG, Math\.ceil\(needPos \/ segSteps\)\)\)/.test(src) &&
  /Math\.ceil\(maxScroll \/ step\) \+ 1/.test(src) && /state\.scanSeg = \(state\.scanSeg \|\| 0\) \+ 1;/.test(src));
ok('硬顶 SCAN_MAX_SEG=10 兜底(防 maxScroll 变导致永远绕不回起点)',
  /var SCAN_MAX_SEG = 10;/.test(src) && /Math\.min\(SCAN_MAX_SEG, \(state\.scanNeed \|\| SCAN_MAX_SEG\)\)/.test(src));
/* 2026-10-31:常量换成新口径后重推 —— 视口按 600px(小黄车面板实测量级)、行高 140px、
 * 200 个品 ≈ 58 档,每段 8 秒 ÷ (350+120)ms ≈ 17 档 ⇒ 4 段,总跨度 36.5 秒。 */
ok('按 200 品上限推演:整表 ≈58 档,每段 ≈17 档 ⇒ 4 段、总跨度 ≈36 秒(调参前是 98 秒)',
  (function () {
    const ROW = 140, VH = 600, ITEMS = 200;
    const m = src.match(/var SCAN_MS = (\d+);/);
    const o = src.match(/var SCAN_OBS_MS = (\d+);/);
    const g = src.match(/var SCAN_GAP_MS = (\d+);/);
    if (!m || !o || !g) return false;
    const maxScroll = ITEMS * ROW - VH;
    const step = Math.floor(VH * 0.8);
    const posts = Math.ceil(maxScroll / step);
    const perSeg = Math.floor(Number(m[1]) / (Number(o[1]) + 120));
    const segs = Math.ceil(posts / perSeg);
    const total = segs * Number(m[1]) / 1000 + (segs - 1) * Number(g[1]) / 1000;
    return posts >= 56 && posts <= 60 && perSeg >= 15 && perSeg <= 19 &&
      segs === 4 && total <= 40;
  })());
ok('新商品 / 停表都走 endScan():断点清零 + 视口还回去',
  (function () {
    const a = src.slice(src.indexOf('function commitProduct'), src.indexOf('function commitProduct') + 1400);
    const b = src.slice(src.indexOf('function resetToWait()'), src.indexOf('function resetToWait()') + 900);
    const f = src.slice(src.indexOf('function endScan()'), src.indexOf('function endScan()') + 700);
    return /endScan\(\);/.test(a) && /endScan\(\);/.test(b) &&
           /state\.scanC\.scrollTop = state\.scanPrev/.test(f) &&
           /state\.scanPos = -1;/.test(f) && /state\.scanDone = false;/.test(f);
  })());
ok('分段扫描期间不还原滚动(让列表持续往下走),收尾一次性还原',
  /if \(state\.scanPrev < 0\) \{ state\.scanPrev = prev; state\.scanC = c; \}/.test(src) &&
  /c\.scrollTop = scanRestore/.test(src));
ok('按代码常量推演:单段 ≤ 8 秒、200 品整趟 ≤ 40 秒(4 段)',
  (function () {
    const m = src.match(/var SCAN_MS = (\d+);/);
    const g = src.match(/var SCAN_GAP_MS = (\d+);/);
    if (!m || !g) return false;
    const perSeg = Number(m[1]), gap = Number(g[1]);
    const segs = 4;
    const total = segs * perSeg / 1000 + (segs - 1) * gap / 1000;
    return perSeg <= 8000 && total <= 40000;
  })(), '单段应 ≤8 秒,4 段总跨度应 ≤40 秒');

/* ---------------- A. 文案 ---------------- */

eq('fmtMinute(5)', P.fmtMinute(5), '5 分钟');
eq('fmtMinute(6.5)', P.fmtMinute(6.5), '6 分 30 秒');
eq('fmtMinute(1)', P.fmtMinute(1), '1 分钟');
eq('fmtMinute(14.5)', P.fmtMinute(14.5), '14 分 30 秒');

ok('adviceOf(1) 提到秒杀/憋单', /秒杀|憋单/.test(P.adviceOf(1)), P.adviceOf(1));
ok('adviceOf(3) 提到秒杀、引流款', /秒杀、引流款/.test(P.adviceOf(3)), P.adviceOf(3));
ok('adviceOf(5) 提到引流、承接款', /引流、承接款/.test(P.adviceOf(5)), P.adviceOf(5));
ok('adviceOf(8) 提到利润款', /利润款/.test(P.adviceOf(8)), P.adviceOf(8));
ok('adviceOf(12) 提到高客单', /高客单/.test(P.adviceOf(12)), P.adviceOf(12));
ok('adviceOf(15) 提到长演示', /长演示/.test(P.adviceOf(15)), P.adviceOf(15));
eq('adviceOf(6) 取最近档(5)', P.adviceOf(6), P.adviceOf(5));
eq('adviceOf(10) 取最近档(8)', P.adviceOf(10), P.adviceOf(8));

/* ---------------- A. 色带归属 ---------------- */

eq('zoneOf(2).text = 秒杀 · 引流', P.zoneOf(2).text, '秒杀 · 引流');
eq('zoneOf(5).text = 承接 · 利润(交界归后段)', P.zoneOf(5).text, '承接 · 利润');
eq('zoneOf(11).text = 承接 · 利润', P.zoneOf(11).text, '承接 · 利润');
eq('zoneOf(12).text = 高客单', P.zoneOf(12).text, '高客单');
eq('zoneOf(15).text = 高客单', P.zoneOf(15).text, '高客单');
eq('zoneOf(2).cls = r', P.zoneOf(2).cls, 'r');

/* ---------------- A. 倒计时格式 ---------------- */

eq('fmtLeft(65000) = 01:05', P.fmtLeft(65000), '01:05');
eq('fmtLeft(300000) = 05:00', P.fmtLeft(300000), '05:00');
eq('fmtLeft(-5) = 00:00(不出现负数)', P.fmtLeft(-5), '00:00');
eq('fmtLeft(9000) = 00:09', P.fmtLeft(9000), '00:09');

/* ---------------- A. 状态快照 ---------------- */

const snap = api.snapshot();
eq('初始 phase = off', snap.phase, 'off');
eq('初始 minutes = 5(默认值)', snap.minutes, 5);
eq('初始 fails = 0', snap.fails, 0);
ok('非中控台页面不自动挂载', !sandbox.document.body, 'body 应仍为 null');

/* ---------------- B. 源码纪律 ---------------- */

ok('用 Shadow DOM 隔离样式', /attachShadow\(\s*\{\s*mode:\s*'open'\s*\}/.test(src));
ok('没有 document.write', src.indexOf('document.write') < 0);
ok('2 秒一拍(后台降频也不漏、又能快速反应)', /var TICK_MS = 2000;/.test(src));
ok('取消→续讲间隔 0.7 秒', /var GAP_MS = 700;/.test(src));
ok('动作加锁(防重入)', /if \(state\.busy\) return;/.test(src));
ok('不缓存行节点(每拍重找)', /function findLiveRow\(\)/.test(src) && src.indexOf('var cachedRow') < 0);
ok('续讲只点两下(取消讲解 / 再讲解),不重复发点击', (function () {
  const i = src.indexOf('async function doCycle');
  const seg = src.slice(i, src.indexOf('function stopByNoLecture'));
  return (seg.match(/fireClick\(/g) || []).length === 2;
})(), 'doCycle 里应恰好 2 次 fireClick');
ok('来源词 = 自动循环讲解', /var SOURCE = '自动循环讲解';/.test(src));
ok('三段式:来源走 source、结果数走 count(不把商品名塞进消息)',
  /function boxNote\(key, type, value, count\)[\s\S]{0,320}source: SOURCE, count: count \|\| ''/.test(src));
ok('消息里不再拼商品全名(避免长消息)', src.indexOf("SOURCE + '｜' + (name") < 0);
ok('失败消息:值=商品名(谁没接上)、结果数=连续 N 次没接上·已放慢重试(且只在第 FAIL_LIMIT 次说一次)',
  /failStatus\(productName\(\), \{[\s\S]{0,200}count: '连续 ' \+ FAIL_LIMIT \+ ' 次没接上 · 已放慢重试'/.test(src) &&
  /if \(state\.fails === FAIL_LIMIT\)/.test(src));
ok('成功消息:值=商品短名(强)、结果数=第 N 轮(弱)—— 2026-10-27 用户定「中间要是被执行的名字」',
  /function shortName/.test(src) &&
  /boxNote\(BOX_CYCLE, 'success', shortName\(name\),/.test(src) &&
  /'第 ' \+ state\.round \+ ' 轮' \+ tag \+ \(recovered \? ' · 已恢复' : ''\)/.test(src));
ok('「谁在被执行」统一走 productName()(reset 前先取,别拿空值发消息)',
  /function productName\(\) \{\s*return shortName\(state\.product\);/.test(src));
ok('有真机探查出口 probe', /probe: function \(\)/.test(src));
ok('禁用视口条件判活(不含 elementFromPoint)', src.indexOf('elementFromPoint') < 0);
ok('睡眠唤醒不补点', /不补点|过期太久/.test(src) || src.indexOf('minutes * 60000 + 120000') > 0);

/* 2026-10-25 追加:长久记忆 + 面板不被别的功能关掉 */
ok('时长存 chrome.storage.local(关浏览器也不丢)', /chrome\.storage\.local\.set\(withKey\(MINUTES_KEY/.test(src));
ok('读时长走 chrome.storage 且带 localStorage 迁移', /chrome\.storage\.local\.get\(MINUTES_KEY\)/.test(src) && /window\.localStorage\.getItem\(MINUTES_KEY\)/.test(src));
ok('外部点击只认真人手势(isTrusted)', /e\.isTrusted === false/.test(src));
ok('程序化 click 的 detail=0 也挡掉', /e\.detail === 0/.test(src));
ok('自己发的点击有 800ms 打点兜底', /lastSelfClickAt < 800/.test(src));
ok('锚点短暂消失不关面板(只藏胶囊 + 5 秒宽限)', /anchorMissingAt > 5000/.test(src));
ok('面板关闭只由「真人点空白」与「开关关掉」触发', (src.match(/closePanel\(\)/g) || []).length >= 2);
ok('真人按下即收(pointerdown 捕获,不用等 click)', /addEventListener\('pointerdown', onDocClick, true\)/.test(src));
ok('点自身影子树不误收(composedPath 判据)', /composedPath\(\)\.indexOf\(host\)/.test(src));

/* 2026-10-25 追加:D 版固定按钮(宽 138)+ 悬停浮层
 * 2026-11-05:宽度不再是 200 —— 胶囊为容纳常驻 ∞ 按钮加宽到 224。
 * 这里改成守**真正的契约**:CSS 里的固定宽必须与 place() 用的 CW_FULL 相等,
 * 一旦有人只改一边,落点就会按错的宽度算(压到平台刷新按钮上)。 */
ok('胶囊宽度写死，且与定位常量 CW_FULL 相等(不随文案变)', (function () {
  const m = /\.cap\{[^']*width:(\d+)px;height:(\d+)px/.exec(src);
  const c = /var CW_FULL = (\d+), CW_MINI = (\d+);/.exec(src);
  return !!m && !!c && m[1] === c[1];
})(), 'CSS 宽与 CW_FULL 必须一致');
ok('中间文字恒定四字「循环讲解」', /<span class="txt">循环讲解<\/span>/.test(src));
ok('时间槽定宽 + 等宽数字', /\.slot\{width:\d+px;text-align:right;font-variant-numeric:tabular-nums/.test(src));
ok('不计时时槽位直接显示状态词(未开启 / 待讲解 / 重试中)', /'未开启'/.test(src) && /'待讲解'/.test(src) && /'重试中'/.test(src));
ok('四态各自的槽位配色齐备', /\.cap\.wait \.slot\{color:#c25e00\}/.test(src) && /\.cap\.err \.slot\{color:#c62222\}/.test(src) && /\.cap\.off \.slot\{color:#a9aeb5/.test(src));
ok('重绘时 off 类必须一起清(否则关过再开还是灰)', /remove\('on', 'wait', 'err', 'off'\)/.test(src));
ok('四态 class 都会在对应分支加上', /classList\.add\('off'\)/.test(src) && /classList\.add\('on'\)/.test(src) && /classList\.add\('wait'\)/.test(src) && /classList\.add\('err'\)/.test(src));
ok('按钮内有图标填实(用户反馈「很空」)', /class="ico"/.test(src) && /width:13px;height:13px/.test(src));
ok('悬停浮层已删除(与展开面板内容重复)', !/\.tip\{position:fixed/.test(src) && src.indexOf('function paintTip') < 0);
ok('提示区的加粗字跟当前色带上色(红/绿/橙)', /data-zone=\"r\"/.test(src) && /data-zone=\"g\"/.test(src) && /data-zone=\"o\"/.test(src));
ok('滑条变化时同步写 data-zone，秒模式不用分钟色带', /var zone = isSec \? \(cur === 15 \? 'r' : ''\) : zoneOf\(cur\)\.cls/.test(src) &&
  /refs\.readout\.setAttribute\('data-zone', zone \|\| ''\)/.test(src));

/* 2026-10-25 用户报「滚到下面看不到讲解中的品就显示待讲解」 */
ok('找不到讲解行时不立刻退回「待讲解」,且不再拿时间当死线(#114)',
  /missingSince/.test(src) && !/var grace =/.test(src) && /LOST_GIVEUP_MS/.test(src) && /var gone = now - state\.missingSince/.test(src));
ok('滚屏改为单向扫 + 绕回顶部(不再每次都在同一小段来回蹭)',
  /pos \+= step;/.test(src) && /if \(pos > maxScroll\)/.test(src) && /pos = 0;/.test(src));
ok('单档用轮询找行、观察窗 350ms(虚拟列表 300~600ms 才挂载,350 命中即回;700 太保守)',
  /async function tryAt/.test(src) && /var SCAN_OBS_MS = 350;/.test(src) &&
  /k < Math\.round\(SCAN_OBS_MS \/ 100\)/.test(src));
/* 2026-11-06:认法从"一串写死的按钮文案"升级为"按态分类",断言跟着约束**行为**:
   文本、title、aria-label 三条都要认;title/aria 也走同一套态判定(不许退回写死词表)。 */
ok('按钮识别放宽(文本/标题/aria 都认,且统一按态判定)',
  /getAttribute\('title'\) \|\| el\.getAttribute\('aria-label'\)/.test(src) &&
  /var okLabel = !!kindOfText\(label\)/.test(src) &&
  /var okText = !!kind \|\|/.test(src));
ok('有行但没按钮也先滚动找回一次', /!findLectureBtn\(row\)/.test(src));
ok('滚动容器三级兜底(行集合→面板内扫描→锚点)', /从小黄车面板容器\*\*内部\*\*/ .test(src) || /findCartPanel\(\)/.test(src) && /scrollHeight - el\.clientHeight < 100/.test(src));
ok('滚完仍找不到 ⇒ 记失败重试,不直接停',
  /failCycle\(searched \? '搜不到这件商品,滚屏也没找到' : '找不到那一行商品'\)/.test(src));
ok('失败重试期间不被「待讲解」覆盖(error 态也享宽限)', /\(state\.phase === 'run' \|\| state\.phase === 'error'\)/.test(src));
ok('锚点丢了也能从任意行反查滚动容器', /function scrollHostOfAny/.test(src));
ok('手动取消讲解要立即停(行在但没有讲解中 ⇒ 连续 2 拍转 wait)',
  /var sameRow = findRowByKey\(\) \|\| \(state\.product \? findRowByName/.test(src) && /state\.cancelSeen >= 2/.test(src));
ok('「没有讲解中」分三种判:行在(取消)/ 键在(等)/ 键也没了(不在列表,直接停)',
  /state\.cancelSeen = 0;/.test(src) &&
  /state\.keyGone = \(state\.keyGone \|\| 0\) \+ 1/.test(src) &&
  /stopByNoLecture\('商品已不在列表\(下架 \/ 移出 \/ 换了 tab\)', '商品已不在列表'\)/.test(src));
ok('「不在列表」只对 id: 键启用(名字键仍留给兜底)', /state\.key\.indexOf\('id:'\) === 0/.test(src));
ok('判「不在列表」还要列表总高真变短(滚走只会卸载行,总高不变)',
  /function listHeight/.test(src) && /\(state\.listH - hNow\) >= 100/.test(src) &&
  /state\.listH = listHeight\(\) \|\| state\.listH/.test(src));
ok('识别有多档兜底:行集合 ← 讲解按钮反推 / 讲解中标记反推', /从页面上真实存在的「讲解/.test(src) && /findAllLecturingMarks/.test(src));
ok('名称比对用归一化键(去空白标点、前 12 字)', /function keyOf/.test(src) && /keyOf\(rowName/.test(src));
ok('判成 wait 时写一条识别诊断(便于事后定位)', /function diagOnce/.test(src) && /识别诊断/.test(src));
ok('行被虚拟滚动回收后按记录的偏移把它滚回来', /function revealRow/.test(src) && /recordRowAnchor/.test(src));
ok('滚回来找行后必须还原滚动位置', /prevScroll/.test(src) && /moved\.container\.scrollTop = moved\.prevScroll/.test(src));
ok('程序化滚动打点 __dycScriptScrollAt(项目约定)', /window\.__dycScriptScrollAt = Date\.now\(\)/.test(src));
ok('行看不见但已到点 ⇒ 立刻尝试找回来续讲(不傻等宽限,但退避期内不重复开火)',
  /now >= state\.nextAt && !state\.busy &&\s*\n?\s*now >= \(state\.retryAt \|\| 0\)\) \{\s*\n\s*doCycle\(false\)/.test(src));
ok('落点候选②:tab 条右侧 +12(不漂、不压 tab)', /tabsRightEdge\(row\)/.test(src) && /tabsRight \+ 12/.test(src));
ok('落点仍夹住刷新列表与行右端', /findRefreshInRow/.test(src) && /r\.right - 8 - CW_FULL/.test(src));
ok('面板贴按钮展开（左对齐；右侧放不下改右对齐）', /var pl = left;/.test(src) && /alignRight/.test(src));
ok('面板从按钮那一角长出/收回（transform-origin + 过渡）', /transform-origin:var\(--ox/.test(src) && /transition:opacity \.12s ease/.test(src));

/* 2026-10-27 用户定(推翻 10-25 的「不进盒子」):
 * 「循环讲解的相关消息也应该记录在消息盒子里,成功和失败都要进去,
 *   但是条数不能太多了,能少就少」。
 * ⇒ 成功、结束、失败**全都进盒子**,但一律走 histKey 原地刷新 —— 全场最多 2 条。 */
ok('每一轮成功都提示一条(状态栏),成功只发这一条', /reportCycle\(name0, wasFailing, how\)/.test(src) &&
  !/toast\('已恢复'/.test(src));
ok('成功进消息盒子(不再是 exclude)', /boxNote\(BOX_CYCLE, 'success'/.test(src));
ok('盒子里用 histKey 原地刷新,不按轮次流水增长',
  /keepHistory: true, histKey: key/.test(src) &&
  /var BOX_CYCLE = 'autoLoop:cycle';/.test(src) &&
  /var BOX_FAIL = 'autoLoop:fail';/.test(src));
ok('结束/中断也写同一条 cycle 记录(盒子不会停在「还在跑」的假象)',
  /boxNote\(BOX_CYCLE, 'info', who, value/.test(src) ||
  /boxNote\(BOX_CYCLE, 'info', who, tail/.test(src) ||
  /boxNote\(BOX_CYCLE, 'info', shortName\(name0\),/.test(src));
ok('失败记录只有一格(3 次与 6 次共用 BOX_FAIL)',
  /histKey: BOX_FAIL/.test(src) && /boxNote\(BOX_FAIL, 'alert'/.test(src));
ok('停表文案带总轮次(事后能看出这场续了几轮)', /function stopValue\(\)/.test(src) &&
  /'已停止' \+ \(state\.round \? ' · 共 ' \+ state\.round \+ ' 轮' : ''\)/.test(src));
ok('只有连续失败才进盒子(单次失败只变红)', /state\.fails >= FAIL_LIMIT/.test(src));

/* 2026-10-25 向自动刷新看齐 */
ok('纵向只跟「让位基准」的中心,且基准必须先过同一行判定(不爬到别的区块上) #119/#120',
  /var top = Math\.round\(basis\.cy - 11\)/.test(src) && /sameRowBand\(r, abR\)/.test(src));
ok('横向让位基准只认一个(圆钮 → 行内刷新列表 → 锚点行右端),不再 min 三者 #119/#120',
  /function findAutoRefreshBtn/.test(src) && /basis = \{ left: abR\.left/.test(src) &&
  /basis = \{ left: rfR\.left/.test(src) && !/blockLeft = Math\.min/.test(src) &&
  /blockLeft - 8 - CW_FULL/.test(src));
ok('滚动时隐藏按钮（不跟着拖影）', /scrollHideUntil/.test(src) && /addEventListener\('scroll', noteScroll, true\)/.test(src));
ok('平台弹层打开时隐藏（不浮在弹窗上）', /function modalOpen\(\)/.test(src) && /modalCheckedAt/.test(src));

/* 2026-10-25 用户报「失效 / 改时长不生效」后的修复 */
ok('改时长后从现在按完整间隔重计', /state\.startedAt = Date\.now\(\);\s*state\.nextAt = state\.startedAt \+ intervalMs\(\);/.test(src));
ok('改时长不立即补发过期动作', /restartInterval\(\);/.test(src) && /function restartInterval/.test(src));
ok('「讲解中」标记兜底识别(行容器抓不到时)', /function findLecturingMark/.test(src));
ok('浮层口径与圆钮对齐:6 个 auxo 类名 + role=dialog + body 直子层浮层词(抽屉也算)',
  /\.auxo-modal-root', '\.auxo-modal-wrap', '\.auxo-drawer'/.test(src) &&
  /querySelectorAll\('\[role="dialog"\]'\)/.test(src) && /OVERLAY_WORD_RE/.test(src));
ok('点击胶囊左侧只开收面板，末端按钮单独启停',
  /refs\.capMain\.addEventListener\('click'[\s\S]{0,220}togglePanel\(\)/.test(src) && /refs\.power\.addEventListener\('click'/.test(src));
ok('面板没有默认开启脚注，启动按保存的启停状态恢复',
  !/refs\.dsw/.test(src) && !/class="foot"/.test(src) && /state\.on = r\[ENABLED_KEY\] !== false/.test(src));
ok('长按胶囊复制诊断也删了(用户要求),不留隐藏手势',
  !/holdFired/.test(src) && !/function copyDiagnosis/.test(src) && !/按住胶囊/.test(src));

/* 2026-10-25 用户报「反应很迟钝」后的提速 */
ok('DOM 唤醒:列表变动 300ms 内就复查', /new MutationObserver/.test(src) && /}, 300\);/.test(src));
ok('观察器按容器挂载并在停用时摘除', /observerTarget/.test(src) && /observer\.disconnect\(\)/.test(src));
ok('续讲后状态翻转轮询 200ms 一次', /Math\.ceil\(VERIFY_MS \/ 200\)/.test(src));
ok('取消后按商品名找回那一行(不再依赖「讲解中」标记)', /function findRowByName/.test(src) && /findRowByName\(key\)/.test(src));
ok('续讲等待改成等条件(每 150ms 看按钮是否变回「讲解」)', /await sleep\(150\)/.test(src) && /kindOf\(b2\) === 'start'/.test(src));
ok('滑块文案按数值变化才写 DOM(不每拍 innerHTML)', /lastSliderTxt/.test(src));
ok('先落值再建 UI(面板首帧不闪默认 5 分钟)', (function () {
  const i = src.indexOf('function start()');
  const seg = src.slice(i, i + 600);
  const a = seg.indexOf('slider.cur = sliderValue();');
  const b = seg.indexOf('buildUI();');
  return i > 0 && a >= 0 && b >= 0 && a < b;
})());


/* ---------------- C. 2026-10-26 修复批(第一批) ---------------- */

/* D1 身份判据与终止条件 */
ok('身份改用稳定键(商品 id / 名称前 8 字),不再拿「最长文本」当身份 #113',
  /function rowKey\(row\)/.test(src) && /data-product-id/.test(src) && /'nm:' \+ nm\.slice\(0, 8\)/.test(src));
ok('按稳定键找回那一行 #117', /function findRowByKey\(\)/.test(src) && /if \(rowKey\(list\[i\]\) === state\.key\)/.test(src));
ok('换品要连续两拍同键才认(去抖) #113/#117', /ID_CONFIRM_TICKS = 2/.test(src) && /pendingTicks < ID_CONFIRM_TICKS/.test(src));
ok('同一商品改了显示名只改名、不动计时', /state\.product = name;\s*\/\/ 同一商品/.test(src));
ok('首次识别与确认换品走同一条 commitProduct', /function commitProduct/.test(src) && /commitProduct\(key, name, now\)/.test(src));
ok('重置只有一个出口 resetToWait(字段一起清干净)', /function resetToWait/.test(src) && /state\.key = '';/.test(src));

/* D2 找款与手势互抢 */
ok('容器自校准:赋值后回读,滚动无效 ⇒ 换候选 #115', /Math\.abs\(c\.scrollTop - target\) > 2/.test(src) && /'bad-container'/.test(src));
ok('用户在动 ⇒ 找款让路,且**不计失败** #117', /userBusy\(\)\) \{ state\.retryAt = Date\.now\(\) \+ 1200; return; \}/.test(src) && /'deferred'/.test(src));
ok('手势闸门监听 pointerdown/wheel/touchstart/keydown', /'pointerdown', 'wheel', 'touchstart', 'keydown'/.test(src) && /noteUserGesture/.test(src));
ok('还原滚动位置前停 350ms(让用户看见它真在找) #115;被中止时不等',
  /if \(moved && !aborted\(mark\)\) await sleep\(350\)/.test(src));

/* ---------------- E. 2026-10-27 手动取消 / 强制停止 / 别乱找 ---------------- */
ok('用户手动点「取消讲解」⇒ 捕获阶段接住(只认 isTrusted,放过自己的合成点击)',
  /function onUserCancelClick/.test(src) && /!e\.isTrusted\) return;/.test(src) &&
  /addEventListener\('click', onUserCancelClick, true\)/.test(src));

/* ---------------- G. 2026-11-07 #133(无限模式自行停止) ---------------- */
/* 实机四次停表全出自 onUserCancelClick,最后一次真人点的是导航搜索框 ⇒
 * 命中元素得先判「在不在商品行里」,停表前还要复核讲解标记真的没了。 */
ok('#133 取消讲解落在讲解卡/浮层(不在任何商品行内)⇒ 只关卡片,循环继续(不停表)',
  /var inRow = false;/.test(src) &&
  /if \(list\[j\] === hit \|\| list\[j\]\.contains\(hit\)\) \{ inRow = true; break; \}/.test(src) &&
  /if \(list\.length && !inRow\) \{/.test(src) &&
  /不在商品行内\(讲解卡\/浮层\) ⇒ 只关卡片,循环继续/.test(src));

ok('#133 行内「取消讲解」点下去后要复核 800ms,标记还在则判误触、继续循环',
  /CANCEL_CONFIRM_MS = 800/.test(src) &&
  /取消讲解复核｜该行仍显示讲解中 ⇒ 判为误触,继续循环/.test(src) &&
  /still = isLecturing\(rowNow\)/.test(src));

ok('#133 停表(setOn false)只在复核回调里发生,点击当场不再直接停',
  (function () {
    const i = src.indexOf('function onUserCancelClick');
    if (i < 0) return false;
    const iTimer = src.indexOf('setTimeout(function () {', i);
    const iSet = src.indexOf('setOn(false, true);', i);
    const iBack = src.indexOf('function txt', i);
    return iTimer > i && iSet > iTimer && (iBack < 0 || iSet < iBack);
  })());

ok('#133 连点两次以最后一次为准(复核令牌),且诊断带命中元素与距上次合成点击毫秒数',
  /var tok = \+\+cancelProbeSeq;/.test(src) &&
  /if \(tok !== cancelProbeSeq\) return;/.test(src) &&
  /距上次合成点击/.test(src));

ok('关胶囊 / 关总闸 ⇒ 中止正在跑的那条链(能强制停止)',
  /function abortCycle/.test(src) && /abortSeq \+= 1/.test(src) &&
  (function () {
    const i = src.indexOf('function setOn(');
    return src.slice(i, i + 500).indexOf('abortCycle();') > 0;
  })() && (function () {
    const i = src.indexOf('function stop()');
    return src.slice(i, i + 400).indexOf('abortCycle();') > 0;
  })());
ok('找款与两次点击的每个 await 之后都能被打断',
  /if \(aborted\(mark\)\) return 'abort'/.test(src) &&
  /if \(aborted\(mark\)\) \{ noteDiag\('续讲被中止\(点击前\)'\); return; \}/.test(src) &&
  /if \(aborted\(mark\)\) \{ noteDiag\('续讲被中止\(续讲点击前\)'\); return; \}/.test(src));
/* 2026-10-31(D1 修复):下面这条判据被推翻并替换 ——
 * 旧写法「进门时 DOM 里看不见讲解中 ⇒ 直接停表」在虚拟滚动下是错的:
 * 用户往下翻两屏,那一行就不在 DOM 里了,讲解却还在进行,于是整个功能被关掉。
 * 现在停表只认硬证据:列表总高变短 ≥100px(商品被下架 / 移出 / 换了 tab)。 */
ok('「看不见那一行」不再等于「用户已取消」:只认列表变短又变矮这条硬证据',
  /function stopByNoLecture/.test(src) &&
  !/if \(!liveAtEntry\) \{\s*\n\s*stopByNoLecture\(/.test(src) &&
  /if \(hNow && nNow && nNow < nAtEntry && \(hAtEntry - hNow\) >= 100\) gone = true;/.test(src) &&
  /if \(gone\) \{/.test(src) &&
  /stopByNoLecture\('列表总高变短 ⇒ 商品已不在列表', '商品已不在列表'\)/.test(src));
ok('停表 / 失败原因分得清:总高变短⇒不在列表;搜过⇒搜不到;没搜⇒没找到',
  /searched \? '搜不到这件商品,滚屏也没找到' : '找不到那一行商品'/.test(src) &&
  /searched = true;/.test(src));
ok('列表可滚 0px ⇒ 不空转 8 秒滚屏(搜不到时最典型)',
  /if \(maxScroll < 8\) \{[\s\S]{0,300}scroll-flat/.test(src) &&
  /if \(maxScroll < 8\) \{\s*\n\s*var alt = scrollHostOfAny\(\);/.test(src));
ok('滚回来的行不是「讲解中」⇒ 停,绝不替用户重新开讲',
  /function isLecturing\(row\)/.test(src) &&
  /if \(!isLecturing\(row\)\) \{/.test(src));

/* D3 落点遮挡 */
/* 2026-10-26 抖动抑制(用户报「原生一刷新两枚按钮就左右抖 / 不在同一水平线」) */
ok('落位吸附三档:≤2px 不动 / ≥10px 立刻跟 / 中间档两拍确认',
  /var SETTLE_SMALL = 2/.test(src) && /var SETTLE_BIG = 10/.test(src) &&
  /d <= SETTLE_SMALL/.test(src) && /d >= SETTLE_BIG/.test(src) && /str\.streak >= 2|st\.streak >= 2/.test(src));
ok('胶囊坐标写入走 settle()(不再每拍照抄)',
  /settle\('capL', left\)/.test(src) && /settle\('capT', top\)/.test(src));
ok('胶囊从藏到显 / 缩放 ⇒ 清吸附记忆(不会停在旧坐标)',
  /if \(cap\.hidden\) \{ cap\.hidden = false; resetSettle\(\); \}/.test(src) &&
  /resetSettle\(\); place\(\)/.test(src));
ok('两条横向判据用同一套吸附(胶囊与灯不互相拽)',
  /function sameRowBand/.test(src) && /findAutoRefreshBtn/.test(src));

/* 2026-10-27 用户:「自动刷新和讲解循环两个按钮不要因为右上角的小框框弹出就隐藏」 */
/* ⚠️ 2026-11-01 起,下面这两条 12% 面积门槛只在**兜底路径**上生效 —— 主路径已交给
 *    src/content/overlay-guard.js(交集 ≥ 控件 35%,下拉面板也算挡道,见反馈 #126/#127)。 */
ok('弹层不再「存在即隐藏」:滚动那一支只剩滚动判据',
  !/scrollHideUntil \|\| modalOpen\(\)/.test(src) && /if \(Date\.now\(\) < scrollHideUntil\) \{/.test(src));
ok('改成「大弹层真的盖住胶囊才让位」',
  /function modalCovers\(rect\)/.test(src) && /if \(modalCovers\(\{ left: left, top: top, right: left \+ cw, bottom: top \+ 22 \}\)\) \{/.test(src));
ok('小卡片不算挡道:面积门槛 = 视口 12%',
  /var BIG_OVERLAY_RATIO = 0\.12/.test(src) && /rc\.width \* rc\.height < minArea\) return;/.test(src));
ok('「添加商品」这种抽屉也能被认成挡道(不再只认 modal-root)',
  /'\.auxo-drawer'/.test(src) && /function modalCovers/.test(src));
ok('锚点短暂消失给 900ms 宽限(不为一次重渲染闪没)',
  /anchorMissingAt > 900\) cap\.hidden = true/.test(src));

/* 2026-10-27 用户:「其中一个按钮隐藏了,另外的按钮不需要自动回补位置」 */
ok('圆钮不在时胶囊按同一格预留,不往右补空位',
  /var LAMP_SLOT_DX = 34/.test(src) &&
  /rfR\.left - \(lampSlotDX \|\| LAMP_SLOT_DX\)/.test(src));
ok('圆钮偏移真量到过就用实测值(不写死),缩放时重量',
  /lampSlotDX = dx0/.test(src) && /lampSlotDX = 0; place\(\)/.test(src));
ok('落点横向不越出行边界(夹进 [行左+8, 行右-8])', /var minLeft = Math\.round\(r\.left \+ 8\)/.test(src) && /maxLeftFull = Math\.round\(r\.right - 8 - CW_FULL\)/.test(src));
ok('行太窄时退化成灯加启停位，仍可直接停止', /CW_MINI = 70/.test(src) && /\.cap\.mini\{width:70px/.test(src) && /mini = true;/.test(src));

/* D6 图标语义 + 诊断导出 */
ok('胶囊图标已换成麦克风(#116),不再用循环箭头', /rx="2"/.test(src) && src.indexOf('M2.6 6.2A5.6') < 0);
ok('现场数据仍可取(诊断已并进调试模式,由 diag.js 采集)',
  /probe: function \(\)/.test(src) && /snapshot: snapshot/.test(src) && /recent: diagRing\.slice\(-12\)/.test(src));
ok('诊断流水有上限(不无限增长)', /diagRing\.length > 40/.test(src) && /diagRing\.shift\(\)/.test(src));
ok('probe 增补 key / lostStreak / mini / recent', /lostStreak: state\.lostStreak/.test(src) && /recent: diagRing\.slice\(-12\)/.test(src));

/* ---------------- B. 开关与注入登记 ---------------- */

const flagsSrc = fs.readFileSync(FLAGS, 'utf8');
ok('flags.js 已登记 autoLoopLecture', /key: 'autoLoopLecture'/.test(flagsSrc));
ok('flags.js 里 autoLoopDefaultOn 已整条删除(开关不存在了)', !/key: 'autoLoopDefaultOn'/.test(flagsSrc));
ok('两条开关都在中控台作用页', (flagsSrc.match(/pages: \['liveCtrl'\]/g) || []).length > 0);

const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
let injected = false, beforeEntry = false;
manifest.content_scripts.forEach(function (cs) {
  const isLive = (cs.matches || []).some(function (m) { return m.indexOf('live/control') >= 0; });
  if (!isLive) return;
  const js = cs.js || [];
  if (js.indexOf('src/live/auto-loop-lecture.js') >= 0) {
    injected = true;
    const iSelf = js.indexOf('src/live/auto-loop-lecture.js');
    const iEntry = js.indexOf('src/live/toolbar.js');
    beforeEntry = iEntry < 0 || iSelf < iEntry;
  }
});
ok('manifest 已注入到中控台', injected);
ok('注入位置在入口脚本之前', beforeEntry);

/* ---------------- B. 弹卡优先(2026-11-06 用户定的最优先路径) ----------------
 * 平台把「讲解中」那一行的按钮换成了「弹出讲解卡」:点它不断开讲解、只重新弹卡。
 * 循环讲解必须优先用它,失败才回退「取消→重讲」。这里锁三件事:
 *   ① 按钮态分类认得全新文案(含平台改字后的变体);
 *   ② 老代码里"拿任意讲解按钮当取消/开始"的等值判断必须全部消失;
 *   ③ 弹卡调用点必须在取消路径之前 —— 顺序反了就退化成老行为。
 * ---------------------------------------------------------------------- */

(function () {
  /* ① 按钮态:表驱动 */
  const cases = [
    ['讲解', 'start'], ['开始讲解', 'start'],
    ['取消讲解', 'stop'], ['结束讲解', 'stop'], ['停止讲解', 'stop'],
    ['弹出讲解卡', 'pop'], ['弹起讲解卡', 'pop'], ['重新弹出讲解卡', 'pop'],
    ['弹出讲解卡片', 'pop'], ['弹 出 讲 解 卡', 'pop'],
    ['讲解中', 'mark'], ['正在讲解', 'mark'], ['讲解中…', 'mark'],
    ['', ''], ['预热', ''], ['取消预热', ''],
    /* 长文本是标题/说明,不是按钮 —— 商品名里带「讲解卡」三个字不能被当成按钮 */
    ['讲解卡片收纳盒加厚款家用', '']
  ];
  cases.forEach(function (c) {
    eq('按钮态「' + c[0] + '」= ' + (c[1] || '认不出'), P.kindOfText(c[0]), c[1]);
  });
  ok('新文案「弹出讲解卡」绝不能被认成开始讲解',
    P.kindOfText('弹出讲解卡') !== 'start');
  ok('新文案也不能被认成取消讲解(它不取消)',
    P.kindOfText('弹出讲解卡') !== 'stop');

  /* ② 旧的等值判断必须清干净 —— 留着任何一处,新文案就会在那里等一个永不发生的翻转 */
  ok('源码里不再有 txt(x) === \'讲解\' 的等值判断',
    !/txt\([^)]*\)\s*===\s*'讲解'/.test(src));
  ok('源码里不再有 txt(x) !== \'讲解\' 的等值判断',
    !/txt\([^)]*\)\s*!==\s*'讲解'/.test(src));
  ok('isLecturing 不再用 mk.contains(row) 认标记(会把别处的残留标记算到本行)',
    !/mk\.contains\(row\)/.test(src));

  /* ③ 弹卡优先的调用点必须在取消之前 */
  ok('存在 tryPopCard(弹卡优先的唯一入口)', /async function tryPopCard\(/.test(src));
  ok('弹卡按钮同时支持"行内"与"页面浮层"两种形态(用户说左侧滑出)',
    /function findPopBtnPage\(/.test(src) && /findPopBtn\(row\)\s*\|\|\s*findPopBtnPage\(\)/.test(src));
  ok('急停 / 状态未定时不动手:弹卡前必须先确认在讲解',
    /if \(!row \|\| !isLecturing\(row\)\) return 'none';/.test(src));

  const iSecPop = src.indexOf('var popped = await tryPopCard(row, mark);');
  const iSecCancel = src.indexOf('fireClick(cancel);');
  ok('秒档:弹卡在「点取消」之前', iSecPop > 0 && iSecCancel > 0 && iSecPop < iSecCancel,
    'pop=' + iSecPop + ' cancel=' + iSecCancel);

  const iMinPop = src.indexOf('var popped = await tryPopCard(row, mark);', iSecPop + 1);
  const iMinCancel = src.indexOf('// 第一次点击:取消讲解');
  ok('分钟档:弹卡在「第一次点击:取消讲解」之前', iMinPop > 0 && iMinCancel > 0 && iMinPop < iMinCancel,
    'pop=' + iMinPop + ' cancel=' + iMinCancel);

  ok('盲模式(后台)也走弹卡 —— 它不需要等界面翻回来',
    /盲模式:点「' \+ txt\(pb\) \+ '」弹卡/.test(src));
  ok('兜底路径按态取「取消讲解」,不再拿任意按钮顶上',
    /findStopBtn\(row\) \|\| findLectureBtn\(row\)/.test(src));
  ok('补讲按态取「开始讲解」', /kindOf\(b\) !== 'start'/.test(src) && /kindOf\(rb2\)/.test(src));
  ok('守夜探针按态判定,不拿原文比较',
    /var label\s*=\s*kindOf\(btn\);/.test(src) && /label === 'stop' \|\| label === 'pop'/.test(src));

  /* ④ 一轮的结果要能区分弹卡与重讲(用户在胶囊里看这个数) */
  ok('轮次消息带「弹卡」标签', /how === 'pop' \? ' · 弹卡'/.test(src));
  ok('finishFastCycle 接受"这一轮怎么完成的"', /function finishFastCycle\(row, name, how\)/.test(src));
  ok('分钟档收尾抽成一份(弹卡不会漏掉失败清零/滚屏额度重置)',
    /function finishSlowCycle\(row, name0, how\)/.test(src));

  /* ⑤ 诊断要能一眼看出新通道在不在工作 */
  ok('诊断快照带弹卡账本(pop.tries / ok / none)',
    /pop: \{ tries: state\.popTries \|\| 0, ok: state\.popOk \|\| 0, none: state\.popNone \|\| 0 \}/.test(src));
  ok('probe 带按钮态与弹卡按钮原文', /btnKind:/.test(src) && /popBtn:/.test(src));
})();

/* ---------------- 汇总 ---------------- */

function report() {
  console.log('\n自动循环讲解自测:' + pass + '/' + (pass + fail) + ' 通过');
  if (fail) {
    console.log('\n未通过:');
    fails.forEach(function (f) { console.log('  ✗ ' + f); });
    process.exit(1);
  }
  console.log('全绿。真机仍需用 __DYC_AUTO_LOOP__.probe() 核一次「讲解」按钮识别。');
}

/* ---------------- A. 原生搜索通道的降级(异步,放最后) ----------------
 * 搜索框不在(用户收起小黄车 / 平台改版)、没有商品 ID(名字兜底键)时,
 * 这条通道必须**安静交回滚屏兜底**,绝不抛错、绝不卡住续讲。 */
(async function () {
  try {
    var r1 = await api._locateBySearch('3849526557068624049', 0);
    ok('没有搜索框时安静返回 null(交给滚屏兜底,不抛错)', r1 === null, 'got=' + JSON.stringify(r1));
    var r2 = await api._locateBySearch('', 0);
    ok('没有商品 ID 时根本不碰搜索框', r2 === null);
  } catch (e) {
    ok('原生搜索通道异常安全', false, e && e.message);
  }
  report();
})();
