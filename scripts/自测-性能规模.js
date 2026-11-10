'use strict';

/* ================================================================
 * 规模敏感性行为闸(2026-11-10)
 * ----------------------------------------------------------------
 * 起因:用户问「为什么出现性能故障没有扫出来,是不是性能闸少了」。
 * 查下来三道防线全都不认这个维度:
 *   · perf-check 的 R5 只认 querySelectorAll('*'),不认多标签全量查询;
 *     R6 只认布局读取(getBoundingClientRect / offset* / client*),完全不认 textContent;
 *   · 自测-性能调度 数的是「每拍调几次」,而它的夹具 querySelectorAll 恒返回 [],
 *     全页扫描在那里成本恒为 0 —— 天生看不见「每次多贵」;
 *   · 真机整页 textContent 254 万字,这个规模本地夹具从来没造过。
 * ⇒ 于是「单次成本随页面规模增长」这类问题,没有任何一道闸能看见。
 *
 * 这条闸换一个维度问问题:
 *   **同一段热路径,页面从 ~50 个噪声节点涨到 ~5000 个,它读的文本量涨不涨?**
 * 涨了就是规模敏感,直接红。
 *
 * 判据只用「读了哪些节点」,不用耗时 —— jsdom 的毫秒数不可信,计数可信。
 * 噪声区(模拟直播间历史评论)的 textContent 读取次数必须恒为 0:
 * 热路径只该碰商品行 / 小黄车面板,碰一下整页评论就是错。
 *
 * 夹具刻意贴近真机:锚点、面板、11 行商品、行内按钮与「讲解中」标记都在,
 * 走的是**真实分支**,不是被 patch 掉的那几条。
 * ================================================================ */

var fs = require('fs');
var path = require('path');
var vm = require('vm');

var SRC_UNDER_TEST = 'src/live/auto-loop-lecture.js';
var root = path.resolve(__dirname, '..');

var failures = [];
function ok(name, cond, extra) {
  if (cond) {
    console.log('  ✓ ' + name);
  } else {
    console.log('  ✗ ' + name + (extra ? '  —— ' + extra : ''));
    failures.push(name);
  }
}

/* ---------------- 迷你 DOM(只实现本闸需要的部分) ---------------- */

var counts = { text: {}, qsa: 0, rect: 0 };

function resetCounts() { counts.text = {}; counts.qsa = 0; counts.rect = 0; }
function textOf(zone) { return counts.text[zone] || 0; }

function rawText(n) {
  var s = n._text || '';
  var kids = n.childNodes || [];
  for (var i = 0; i < kids.length; i++) {
    s += kids[i].nodeType === 3 ? (kids[i].nodeValue || '') : rawText(kids[i]);
  }
  return s;
}

/** 文本节点:nodeValue 不计数 —— 这正是「只读自身文本」与「拼整棵子树」的分界线 */
function T(value) { return { nodeType: 3, nodeValue: value, parentNode: null }; }

function MiniNode(tag, opts) {
  opts = opts || {};
  this.nodeType = 1;
  this.tagName = String(tag).toUpperCase();
  this._text = opts.text || '';
  this.zone = opts.zone || 'panel';
  this.childNodes = [];
  this.id = opts.id || '';
  this.isConnected = true;
  this.parentNode = null;
  this._rect = opts.rect || { left: 0, top: 0, right: 120, bottom: 24, width: 120, height: 24 };
  var classes = new Set();
  this.classList = {
    add: function () { for (var i = 0; i < arguments.length; i++) classes.add(arguments[i]); },
    remove: function () { for (var i = 0; i < arguments.length; i++) classes.delete(arguments[i]); },
    contains: function (c) { return classes.has(c); },
    toggle: function (c, yes) { if (yes) classes.add(c); else classes.delete(c); }
  };
}

Object.defineProperty(MiniNode.prototype, 'children', {
  get: function () {
    return this.childNodes.filter(function (n) { return n.nodeType === 1; });
  }
});
Object.defineProperty(MiniNode.prototype, 'parentElement', {
  get: function () { return this.parentNode && this.parentNode.nodeType === 1 ? this.parentNode : null; }
});
Object.defineProperty(MiniNode.prototype, 'firstChild', {
  get: function () { return this.childNodes[0] || null; }
});
Object.defineProperty(MiniNode.prototype, 'nextSibling', {
  get: function () {
    if (!this.parentNode) return null;
    var i = this.parentNode.childNodes.indexOf(this);
    return i >= 0 ? (this.parentNode.childNodes[i + 1] || null) : null;
  }
});
Object.defineProperty(MiniNode.prototype, 'textContent', {
  get: function () {
    /* ★ 计数就发生在这里:一次 textContent = 一次「把整棵子树拼成字符串」。
       这是本次故障唯一的成本度量 —— 真机 254 万字页面上它单次约 105ms。 */
    counts.text[this.zone] = (counts.text[this.zone] || 0) + 1;
    return rawText(this);
  },
  set: function (v) { this.childNodes = []; this._text = String(v); }
});

MiniNode.prototype.appendChild = function (c) { c.parentNode = this; this.childNodes.push(c); return c; };
MiniNode.prototype.contains = function (x) {
  for (var n = x; n; n = n.parentNode) if (n === this) return true;
  return false;
};
MiniNode.prototype.getBoundingClientRect = function () { counts.rect++; return this._rect; };
MiniNode.prototype.getAttribute = function () { return null; };
MiniNode.prototype.setAttribute = function () {};
MiniNode.prototype.removeAttribute = function () {};
MiniNode.prototype.querySelectorAll = function (sel) { counts.qsa++; return query(this, sel); };
MiniNode.prototype.querySelector = function (sel) { var r = query(this, sel); return r[0] || null; };

/** 只支持本闸用到的选择器:逗号分隔的标签名 */
function query(scope, sel) {
  var tags = String(sel).split(',').map(function (s) { return s.trim().toUpperCase(); });
  var out = [];
  (function walk(node) {
    var kids = node.childNodes || [];
    for (var i = 0; i < kids.length; i++) {
      var c = kids[i];
      if (c.nodeType !== 1) continue;
      if (tags.indexOf(c.tagName) >= 0) out.push(c);
      walk(c);
    }
  })(scope);
  return out;
}

/* ---------------- 夹具:贴近真机的中控台小黄车 ---------------- */

function build(noiseCount, withMarker, btn0Text) {
  resetCounts();

  var body = new MiniNode('body');
  var panel = new MiniNode('div', { id: 'panel' });

  /* 标题行:宽度接近整个小黄车面板、高度只有一行 —— 与真机锚点判据一致 */
  var head = new MiniNode('div', { rect: { left: 616, top: 80, right: 1635, bottom: 231, width: 1019, height: 151 } });
  var tab = new MiniNode('span', { text: '直播商品' });
  head.appendChild(tab);
  panel.appendChild(head);

  var rows = [];
  var marker = null;
  for (var i = 0; i < 11; i++) {
    var row = new MiniNode('div', {
      rect: { left: 616, top: 403 + i * 140, right: 1635, bottom: 535 + i * 140, width: 1019, height: 132 }
    });
    var name = new MiniNode('span');
    name.appendChild(T('【KiKi】重磅进口羊驼毛羊毛慵懒风撞色菱格纹针织毛衣Y89' + i));
    row.appendChild(name);

    var ops = new MiniNode('div');
    var btn = new MiniNode('button', {
      rect: { left: 1450, top: 460 + i * 140, right: 1510, bottom: 480 + i * 140, width: 60, height: 20 }
    });
    btn.appendChild(T(i === 0 && btn0Text ? btn0Text : (i === 0 ? '取消讲解' : '讲解')));
    ops.appendChild(btn);
    row.appendChild(ops);

    /* ★ 真机形态(诊断报告:marks 恒为 0、按钮是「取消讲解」):
       讲解中那一行**没有**「讲解中」标记,状态只由按钮文案表达。
       这一点决定了夹具能不能测出「全页兜底」—— 面板里没有标记时,
       旧实现才会退到整页去找,而真机每一拍都走这条。 */
    if (i === 0 && withMarker) {
      marker = new MiniNode('span', {
        rect: { left: 1380, top: 462, right: 1430, bottom: 478, width: 50, height: 16 }
      });
      marker.appendChild(T('讲解中'));
      row.appendChild(marker);
    }
    panel.appendChild(row);
    rows.push(row);
  }

  /* 噪声区:直播间历史评论。真机靠这个把整页文本堆到 254 万字。 */
  var chat = new MiniNode('div', { id: 'chat', zone: 'chat' });
  for (var k = 0; k < noiseCount; k++) {
    var msg = new MiniNode('div', { zone: 'chat' });
    var u = new MiniNode('span', { zone: 'chat' });
    u.appendChild(T('用户' + k));
    var c = new MiniNode('span', { zone: 'chat' });
    c.appendChild(T('这件毛衣真好看，主播快讲讲尺码，我身高一米六八体重一百一十斤。'.repeat(4)));
    msg.appendChild(u);
    msg.appendChild(c);
    chat.appendChild(msg);
  }

  body.appendChild(panel);
  body.appendChild(chat);

  var doc = {
    body: body,
    hidden: false,
    documentElement: { clientWidth: 1707, clientHeight: 929 },
    addEventListener: function () {},
    removeEventListener: function () {},
    querySelector: function (sel) { return body.querySelector(sel); },
    querySelectorAll: function (sel) { return body.querySelectorAll(sel); },
    getElementById: function (id) { return id === 'panel' ? panel : (id === 'chat' ? chat : null); },
    createElement: function (tag) { return new MiniNode(tag); }
  };

  var clock = 1794292198297;
  var ctx = {
    window: {
      innerWidth: 1707, innerHeight: 929, addEventListener: function () {},
      localStorage: { getItem: function () { return null; } }
    },
    document: doc,
    location: { href: 'https://buyin.jinritemai.com/dashboard/live/control' },
    console: console, Promise: Promise, Math: Math, JSON: JSON, isFinite: isFinite,
    parseFloat: parseFloat,
    setTimeout: function () { return 0; }, clearTimeout: function () {},
    setInterval: function () { return 0; }, clearInterval: function () {},
    requestAnimationFrame: function () { return 0; }, cancelAnimationFrame: function () {},
    dycReadFlags: function () { return { then: function () {} }; },
    dycWatchFlags: function () {},
    dycWatchLiveScope: function () {},
    MutationObserver: function () { this.observe = function () {}; this.disconnect = function () {}; },
    getComputedStyle: function () { return { pointerEvents: 'auto' }; },
    chrome: {
      storage: { local: { get: function () { return Promise.resolve({}); } }, onChanged: { addListener: function () {} } },
      runtime: { onMessage: { addListener: function () {} }, sendMessage: function () {} }
    }
  };
  ctx.window.document = doc;
  /* clickable() 里读的是 window.getComputedStyle(不是全局的那个) */
  ctx.window.getComputedStyle = ctx.getComputedStyle;
  ctx.window.setTimeout = ctx.setTimeout;
  ctx.window.clearTimeout = ctx.clearTimeout;
  ctx.window.MutationObserver = ctx.MutationObserver;
  ctx.Date = class extends Date { static now() { return clock; } };
  ctx.advance = function (ms) { clock += ms; };

  var src = fs.readFileSync(path.join(root, SRC_UNDER_TEST), 'utf8');
  /* 导出被考核的内部函数。形参名刻意避开 rows / paint,免得与源内声明打架。 */
  var inject = [
    'window.__pg = {',
    '  findAllLecturingMarks: findAllLecturingMarks,',
    '  findMarksIn: findMarksIn,',
    '  isLecturing: isLecturing,',
    '  mutationRelevant: mutationRelevant,',
    '  checkNow: checkNow,',
    '  _origLive: findLiveRow,',
    '  configure: function (panelNode, rowList) {',
    '    findCartPanel = function () { return panelNode; };',
    '    rows = function () { return rowList; };',
    '    findLiveRow = function () { return rowList[0]; };',
    '    findRowByKey = function () { return rowList[0]; };',
    '    findRowByName = function () { return rowList[0]; };',
    '    findAnyLecturingRow = function () { return null; };',
    "    rowKey = function () { return 'id:1'; };",
    "    rowName = function () { return '测试款'; };",
    '    paint = function () {};',
    '    state.on = true; state.phase = "run"; state.group = "sec";',
    "    state.key = 'id:1'; state.product = '测试款';",
    '    state.nextAt = Date.now() + 600000; state.busy = false;',
    '  },',
    '  resetMarks: function () { marksCache.t = 0; marksCache.fullT = 0; marksCache.list = []; },',
    '  dump: function () { return { on: state.on, phase: state.phase, key: state.key }; }',
    '};'
  ].join('\n');
  var patched = src.replace(/\}\)\(\);\s*$/, '\n' + inject + '\n})();');
  if (patched === src) throw new Error('无法注入导出:源码尾部形态变了');

  vm.createContext(ctx);
  vm.runInContext(patched, ctx, { filename: SRC_UNDER_TEST });

  var api = ctx.window.__pg;
  api.configure(panel, rows);
  return { api: api, ctx: ctx, doc: doc, body: body, panel: panel, chat: chat, rows: rows, marker: marker };
}

/* ---------------- 测量 ---------------- */

function measure(noiseCount, withMarker) {
  var f = build(noiseCount, withMarker);
  var api = f.api;

  /* ① 标记扫描:一拍里查一次「页面上有哪些讲解中」 */
  api.resetMarks();
  resetCounts();
  api.findAllLecturingMarks();
  var scan = { panel: textOf('panel'), chat: textOf('chat'), qsa: counts.qsa, rect: counts.rect };

  /* ② 行判定:这一行是不是在讲 */
  resetCounts();
  api.isLecturing(f.rows[0]);
  var lecture = { panel: textOf('panel'), chat: textOf('chat'), rect: counts.rect };

  /* ③ DOM 变更判据:平台重渲染一大块(噪声区)时必须轻 */
  resetCounts();
  api.mutationRelevant({ type: 'childList', target: f.chat, addedNodes: [f.rows[0]], removedNodes: [] });
  api.mutationRelevant({ type: 'characterData', target: T('讲解中'), oldValue: '讲解' });
  var mutation = { panel: textOf('panel'), chat: textOf('chat') };

  /* ④ 连续 40 拍扫标记(秒档 ≈ 20 秒)—— 这是「每 250ms 扫一次」的放大镜。
     直接打 findAllLecturingMarks:它是被怀疑的对象,不该借 checkNow 的短路来放过它。 */
  resetCounts();
  for (var i = 0; i < 40; i++) {
    api.resetMarks();          // 强制缓存过期,等价于每拍都真的重扫
    api.findAllLecturingMarks();
    f.ctx.advance(500);
  }
  var loop = { panel: textOf('panel'), chat: textOf('chat'), qsa: counts.qsa };

  /* ⑤ 完整链路 40 拍(checkNow):稳态下走的是「按钮态直接命中」的早退分支,
     也必须一趟都不碰噪声区。 */
  resetCounts();
  for (var j = 0; j < 40; j++) {
    api.resetMarks();
    api.checkNow();
    f.ctx.advance(500);
  }
  var chain = { panel: textOf('panel'), chat: textOf('chat') };

  return {
    noise: noiseCount, nodes: 11 * 4 + noiseCount * 3,
    scan: scan, lecture: lecture, mutation: mutation, loop: loop, chain: chain
  };
}

/* ---------------- 主流程 ---------------- */

console.log('性能规模闸:同一热路径,噪声区从 50 条涨到 2000 条(节点数 ×30)');

/* ★ 主场景刻意用「真机形态」:讲解中那一行没有「讲解中」标记(诊断报告 marks=0、
   按钮为「取消讲解」)。旧实现正是靠这条路径每拍退到整页去找标记 ——
   如果夹具里放一枚标记,面板内就能找到,全页兜底永远不触发,闸会假绿。 */
var small = measure(50, false);
var large = measure(2000, false);
/* 副场景:标记确实存在(平台某些版本会有),用来覆盖 findMarksIn 命中的分支 */
var marked = measure(2000, true);

console.log('  小页面:' + small.nodes + ' 节点 · 大页面:' + large.nodes + ' 节点');

/* 核心纪律:噪声区(直播间评论)一次都不该被读 */
ok('标记扫描不读噪声区文本(小页面)', small.scan.chat === 0, '读了 ' + small.scan.chat + ' 次');
ok('标记扫描不读噪声区文本(大页面)', large.scan.chat === 0,
  '读了 ' + large.scan.chat + ' 次 —— 说明又退回全页扫描了');
ok('标记存在时也不读噪声区文本', marked.scan.chat === 0, '读了 ' + marked.scan.chat + ' 次');
ok('行判定不读噪声区文本(大页面)', large.lecture.chat === 0, '读了 ' + large.lecture.chat + ' 次');
ok('DOM 变更判据不读噪声区文本(大页面)', large.mutation.chat === 0, '读了 ' + large.mutation.chat + ' 次');

/* 规模无关性:小页面与大页面的读数必须一致(噪声放大 30 倍也不该多读一个字) */
ok('扫描量不随页面规模增长:面板内读取次数一致',
  small.scan.panel === large.scan.panel,
  '小 ' + small.scan.panel + ' 次 vs 大 ' + large.scan.panel + ' 次');
ok('扫描量不随页面规模增长:节点查询次数一致',
  small.scan.qsa === large.scan.qsa,
  '小 ' + small.scan.qsa + ' 次 vs 大 ' + large.scan.qsa + ' 次');
ok('行判定不随页面规模增长', small.lecture.panel === large.lecture.panel,
  '小 ' + small.lecture.panel + ' vs 大 ' + large.lecture.panel);

/* 连续 40 拍扫标记:真机卡顿就出在这里 —— 每拍都全页扫一次,一秒四次 */
ok('连续 40 拍扫标记不读噪声区(大页面)', large.loop.chat === 0,
  '40 拍读了 ' + large.loop.chat + ' 次,折合每拍 ' + Math.round(large.loop.chat / 40) + ' 次');
ok('连续 40 拍扫标记的量仍与页面规模无关',
  small.loop.chat === large.loop.chat,
  '小 ' + small.loop.chat + ' vs 大 ' + large.loop.chat);
ok('完整链路 40 拍(checkNow)也不读噪声区', large.chain.chat === 0,
  '40 拍读了 ' + large.chain.chat + ' 次');

/* ---------------- findLiveRow 判定语义(2026-11-10 合并两趟遍历后必须仍然认得出) ----------------
 * 这一版为了省掉「整行 txt(row)」的子树拼接,把「讲解中」判定换成行内标记扫描。
 * 三种情形都要还能认出,否则循环会在某些平台版本上「看不见正在讲的行」。 */
var viaBtn = build(50, false, '取消讲解');
ok('有「取消讲解」按钮 ⇒ 认得出正在讲的行', viaBtn.api._origLive() === viaBtn.rows[0]);

var viaMark = build(50, true, '讲解');
ok('只有「讲解中」标记、按钮仍是「讲解」⇒ 也认得出', viaMark.api._origLive() === viaMark.rows[0]);

var noLive = build(50, false, '讲解');
ok('既没有取消态按钮、也没有讲解中标记 ⇒ 返回 null', noLive.api._origLive() === null);

/* ---------------- 闸自检:旧写法必须被这条闸检出 ---------------- */
/* 没有这一步就是「假绿」——闸本身失效时,所有断言都会安静通过。
   这里手动跑一遍旧实现(全页 querySelectorAll + 逐元素 textContent),
   要求计数器必须响。它响了,上面那些 0 才有意义。 */
var f = build(2000, true);
resetCounts();
var legacyCands = f.doc.querySelectorAll('span, div, i, em, b');
for (var i = 0; i < legacyCands.length; i++) { void legacyCands[i].textContent; }
var legacyChat = textOf('chat');
ok('闸自检:旧写法(全页逐元素取文本)会被本闸检出',
  legacyChat > 0,
  '旧写法读噪声区 ' + legacyChat + ' 次 —— 若为 0,说明计数器失效,上面的绿是假绿');

/* ---------------- 汇总 ---------------- */
console.log('');
if (failures.length) {
  console.log('失败 ' + failures.length + ' 条:');
  failures.forEach(function (n) { console.log('  ✗ ' + n); });
  process.exit(1);
}
console.log('全绿。判据:噪声区文本读取必须为 0,且读数不随节点数增长。');
