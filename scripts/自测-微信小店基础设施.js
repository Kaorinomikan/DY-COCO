'use strict';

/**
 * 自测 · 微信小店基础设施（2026-10-30 建，10-31 补域）
 *
 * 这一条改动最容易出的错不是「功能写错」，而是**只改了一半** ——
 * 新增一个注入域，历史上需要同时改三处：
 *     ① manifest.json 的 host_permissions
 *     ② manifest.json 的 content_scripts
 *     ③ 页面判定正则（flags.js 的 DYC_PAGE_PATTERNS / DYC_PLATFORMS；popup.js 自 10-31 起
 *        不再自带正则，直接复用 dycDetectPlatform）
 * 直播回放那两页就踩过：注入了，弹窗却坚持说「本页不在支持范围」，
 * 用户拿不到证据（见 popup.js 里那段注释）。
 *
 * ⚠️ 2026-10-31 的真实教训（比上面那条更贵）：第一版把「微信小店后台」写成了
 * `channels.weixin.qq.com/shop` —— 那是 2022–2023 年视频号小店的旧地址。
 * 微信小店早已独立成 `store.weixin.qq.com`（官方资料库与 2026 新规公告里的
 * 后台入口都是它）。结果用户打开真实后台，页面上连标记都没有，白验一轮。
 * ⇒ 本脚本从此**按「域」逐条断言两个站点**，任何一个缺失都会红。
 *
 * 所以本脚本不测业务行为（本期微信侧没有任何业务功能），只机械地钉死：
 *   · 两个域在三处是否都对齐（store = 微信小店后台，channels = 视频号助手）
 *   · 本期范围有没有被顺手扩大（把抖店业务脚本注进微信域）
 *   · 页面键的**声明顺序**（diag.js 按顺序先匹配先返回，域级键放前面会让
 *     具体页都报成「其他页」）
 *   · 域名后缀仿冒不会被误吃（store.weixin.qq.com.evil.test）
 *
 * 用法：node scripts/自测-微信小店基础设施.js（run-selftests.py 自动带上）
 */

const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');

let JSDOM;
try { ({ JSDOM } = require('jsdom')); }
catch (_) { ({ JSDOM } = require('C:/Users/79412/.workbuddy/binaries/node/workspace/node_modules/jsdom')); }

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

let pass = 0;
let fail = 0;
const failures = [];

function check(name, fn) {
  try { fn(); pass++; console.log('  ✓ ' + name); }
  catch (e) { fail++; failures.push(name + ' —— ' + e.message); console.log('  ✗ ' + name); }
}

// 两个站点：store = 微信小店后台（商家 / 达人 / 成长中心），channels = 视频号助手
const WXS = 'https://store.weixin.qq.com/';
const WXC = 'https://channels.weixin.qq.com/';
const WX_HOSTS = ['https://store.weixin.qq.com/*', 'https://channels.weixin.qq.com/*'];

const mf = JSON.parse(read('manifest.json'));

console.log('\n【一】三处对齐：manifest 权限 / 注入条目');
check('host_permissions 两个域都在', () => {
  const hp = mf.host_permissions || [];
  for (const h of WX_HOSTS) assert.ok(hp.includes(h), '缺 ' + h);
});
check('同一条 content_scripts 同时覆盖两个域（拆两条容易改一个忘另一个）', () => {
  // 2026-10-31 起微信域有**两条**注入条目：业务条目（ISOLATED, document_idle）
  // 与主世界桥（world:MAIN, document_start, 只含 wx-link-main.js）。
  // 要守的规则没变：**没有任何一条只写一个域**，且业务条目（带 flags.js）恰有一条。
  const partial = (mf.content_scripts || []).filter((e) => {
    const m = e.matches || [];
    const a = m.includes(WX_HOSTS[0]);
    const b = m.includes(WX_HOSTS[1]);
    return (a || b) && !(a && b);
  });
  assert.equal(partial.length, 0, '有 ' + partial.length + ' 条只覆盖了一个域');
  const hit = (mf.content_scripts || []).filter((e) => WX_HOSTS.every((h) => (e.matches || []).includes(h)));
  const biz = hit.filter((e) => (e.js || []).includes('src/content/flags.js') && !WX_HOSTS.every(h => (e.exclude_matches || []).includes(h)));
  assert.equal(biz.length, 1, '带开关层的业务条目应恰有 1 条，实际 ' + biz.length);
  const bridge = hit.filter((e) => (e.js || []).includes('src/content/wx-link-main.js'));
  assert.equal(bridge.length, 1, '主世界桥条目应恰有 1 条，实际 ' + bridge.length);
  assert.equal(bridge[0].world, 'MAIN', '桥条目必须 world=MAIN，否则读不到页面实例');
  assert.equal(bridge[0].run_at, 'document_start', '桥条目必须 document_start，否则抢不到列表接口');
});
check('flags.js 在第 0 位', () => {
  assert.equal(wxEntry().js[0], 'src/content/flags.js');
});
check('四个基础设施脚本都在场', () => {
  const wx = wxEntry();
  for (const s of ['src/content/diag.js', 'src/content/anchor.js', 'src/content/dialog.js', 'src/content/debug-panel.js']) {
    assert.ok(wx.js.includes(s), '缺少 ' + s);
  }
});
check('样式成对注入（标记与消息盒子的样式依赖）', () => {
  const wx = wxEntry();
  assert.ok(wx.css.includes('src/content/style.css'));
  assert.ok(wx.css.includes('src/content/msgbox.css'));
});

console.log('\n【二】范围：不得注入抖店业务脚本');
// ⚠️ 这条拦的是「把抖店那套脚本搬进微信域」，**不拦微信专属脚本**。
// 2026-10-31 用户要求「商品列表完整显示商品全名」后，微信条目新增了
// wx-goods-title.js（微信专用，不依赖抖店的 locate/row-scan）——
// 那是用户明确要的新功能，不是范围被顺手扩大。判据本身没放宽。
// 2026-10-31 起 stock-net-probe.js 从 BIZ 移出：它是**通用**网络探针
// （只记本站请求，判据是 hostname === location.hostname），不是抖店业务逻辑。
// 微信域装它是因为用户要「调试模式里能接口取样」—— 面板上的「开始接口取样 30 秒」
// 就挂在这枚探针上。
check('无抖店业务脚本混入（微信专属脚本 / 通用探针不受此限）', () => {
  const BIZ = [
    'main.js', 'toolbar.js', 'clear-stock.js', 'channel-stock.js', 'channel-offline-delete.js',
    'inject-button.js', 'row-scan.js', 'cursor-fix.js', 'stock-direct.js',
    'campaign-channel-tick.js', 'hide-elements.js',
    'auto-loop-lecture.js', 'cart-paste.js', 'search.js', 'locate.js', 'auto-refresh.js',
    'copy-code.js', 'name-wrap.js', 'live-detail.js', 'replay-download.js'
  ];
  const wx = wxEntry();
  const bad = wx.js.filter((p) => BIZ.some((b) => p.endsWith('/' + b)));
  assert.equal(bad.length, 0, '混入了 ' + bad.join(', '));
});

console.log('\n【三】页面键：存在、顺序、匹配行为');
const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: WXS + 'shop', runScripts: 'outside-only'
});
const win = dom.window;
const store = {};
win.chrome = {
  runtime: { getManifest: () => mf, lastError: null, id: 'selftest', sendMessage() {}, onMessage: { addListener() {} } },
  storage: {
    local: {
      get(keys, cb) {
        const out = typeof keys === 'string' ? { [keys]: store[keys] } : Object.assign({}, store);
        if (typeof cb === 'function') cb(out);
        return Promise.resolve(out);
      },
      set(obj, cb) { Object.assign(store, obj); if (typeof cb === 'function') cb(); return Promise.resolve(); }
    },
    onChanged: { addListener() {} }
  }
};
win.eval(read('src/content/flags.js'));
const P = win.DYC_PAGE_PATTERNS;

check('三个键都在', () => {
  for (const k of ['wxShop', 'wxChannels', 'wxAll']) assert.ok(P[k], '缺 ' + k);
});
check('域级键 wxAll 排在两个具体键之后（diag 先匹配先返回）', () => {
  const keys = Object.keys(P);
  assert.ok(keys.indexOf('wxShop') < keys.indexOf('wxAll'), 'wxShop 应在 wxAll 前');
  assert.ok(keys.indexOf('wxChannels') < keys.indexOf('wxAll'), 'wxChannels 应在 wxAll 前');
});
check('wxShop：微信小店后台（含登录页、商品列表、达人后台）', () => {
  assert.ok(P.wxShop.test(WXS), '后台登录页必须匹配');
  assert.ok(P.wxShop.test(WXS + 'shop'), '必须匹配 /shop');
  assert.ok(P.wxShop.test(WXS + 'shop/product/list?x=1'), '必须匹配子路径与查询串');
  assert.ok(P.wxShop.test(WXS + 'talent/'), '达人后台同属小店域');
});
check('wxChannels：视频号助手（含旧视频号小店入口）', () => {
  assert.ok(P.wxChannels.test(WXC + 'index'));
  assert.ok(P.wxChannels.test(WXC + 'platform/live'));
  assert.ok(P.wxChannels.test(WXC + 'shop'), '旧地址仍在同域，不能被漏掉');
});
check('wxAll：两个域都覆盖', () => {
  assert.ok(P.wxAll.test(WXS + 'shop'));
  assert.ok(P.wxAll.test(WXC + 'index'));
});
check('微信键不吃抖店域', () => {
  for (const k of ['wxShop', 'wxChannels', 'wxAll']) {
    assert.ok(!P[k].test('https://fxg.jinritemai.com/ffa/g/list'), k + ' 误吃抖店');
  }
});
check('抖店键不吃微信域', () => {
  assert.ok(!P.list.test(WXS + 'shop'));
  assert.ok(!P.shopAll.test(WXS + 'shop'));
  assert.ok(!P.shopAll.test(WXC));
});
check('域名后缀仿冒不被误吃', () => {
  assert.ok(!P.wxAll.test('https://store.weixin.qq.com.evil.test/shop'));
  assert.ok(!P.wxAll.test('https://channels.weixin.qq.com.evil.test/shop'));
  assert.ok(!P.wxShop.test('https://store.weixin.qq.com@evil.test/'));
});

console.log('\n【四】调试开关的作用页含微信域');
check('debug.pages 含 wxAll', () => {
  const meta = (win.DYC_FLAGS_META || []).find((m) => m.key === 'debug');
  assert.ok(meta, '找不到 debug 开关');
  assert.ok((meta.pages || []).includes('wxAll'), '不含 wxAll 时弹窗在微信页会显示「暂无相关页面」');
});

console.log('\n【五】各模块的域判定与文案');
check('微信页真实探针能创建左下角入口', () => {
  win.eval(read('src/content/anchor.js'));
  assert.ok(win.document.querySelector('#dyb-status-bar .dyb-badge'), '微信后台必须有入口');
});
check('diag.js 三个页面中文名齐备', () => {
  const s = read('src/content/diag.js');
  for (const [k, cn] of [['wxShop', '微信小店后台'], ['wxChannels', '视频号助手'], ['wxAll', '微信小店其他页']]) {
    assert.ok(s.includes(k + ": '" + cn + "'"), '缺 ' + k + ' 的中文名');
  }
});
check('消息历史共享的支持判据覆盖微信两个域', () => {
  for (const url of [WXS + 'shop', WXC + 'index']) assert.ok(win.dycIsSupportedPage(url), url);
  assert.ok(!win.dycIsSupportedPage('https://store.weixin.qq.com.evil.test/shop'));
});
check('service-worker：host 权限判定含两个域', () => {
  const s = read('src/background/service-worker.js');
  assert.ok(s.includes('(?:store|channels)\\.weixin\\.qq\\.com'), '不含则从弹窗注入面板会被拦');
});
check('popup：本页支持范围含两个域（并能挡仿冒域）', () => {
  // 2026-10-31：popup 不再自己维护一份 DYC_SUPPORTED_PAGE_RE，改成复用
  // flags.js 的 dycDetectPlatform —— 「本页受支持」与「弹窗该切到哪个平台」
  // 现在是同一个判据，两份正则不会再各自漂移。断言内容一句没减：
  const src = read('src/popup/popup.js');
  assert.ok(/function onSupportedPage\(url\) \{[\s\S]*?dycDetectPlatform/.test(src),
    'onSupportedPage 应复用 dycDetectPlatform（不许再自建正则）');
  assert.equal(win.dycDetectPlatform(WXS + 'shop'), 'wx', '微信小店后台应被认作作用页');
  assert.equal(win.dycDetectPlatform(WXS), 'wx', '小店登录页也算');
  assert.equal(win.dycDetectPlatform(WXC + 'index'), 'wx', '视频号助手应被认作作用页');
  assert.equal(win.dycDetectPlatform('https://fxg.jinritemai.com/ffa/g/list'), 'dy', '抖店不能因此失效');
  assert.equal(win.dycDetectPlatform('https://store.weixin.qq.com.evil.test/shop'), '', '仿冒域不该被认作作用页');
});
check('popup：两条「不在支持范围」提示已含微信小店', () => {
  const src = read('src/popup/popup.js');
  assert.equal(src.split('本页不在扩展支持范围').length - 1, 2, '预期两处提示');
  assert.equal(src.split('直播回放页 / 微信小店').length - 1, 2, '两处都要写微信小店');
});

console.log('\n【六】调试面板：接口取样按钮按「探针在场」显示');
check('无探针时隐藏（判据是探针在场，不是写死域名）', () => {
  const s = read('src/content/debug-panel.js');
  assert.ok(/btnNetArm\.style\.display = 'none'/.test(s), '缺隐藏逻辑，点到最后会弹「监听模块不在场」');
  assert.ok(/__DYC_STOCK_PROBE__/.test(s), '判据应基于探针是否在场');
});
check('微信条目注入了网络探针（用户 2026-10-31：接口取样工具没出现在调试模式里）', () => {
  const wx = wxEntry();
  assert.ok(wx.js.includes('src/content/stock-net-probe.js'), '微信条目没有 stock-net-probe.js，面板上的「开始接口取样」永远不会出现');
  const iProbe = wx.js.indexOf('src/content/stock-net-probe.js');
  const iPanel = wx.js.indexOf('src/content/debug-panel.js');
  assert.ok(iProbe >= 0 && iPanel > iProbe, '探针必须排在 debug-panel 之前（面板挂载时要能读到它）');
});

function wxEntry() {
  const hit = (mf.content_scripts || []).filter((e) => WX_HOSTS.every((h) => (e.matches || []).includes(h)));
  return hit[0] || { js: [], css: [], matches: [] };
}

/* ---------- 汇总 ---------- */
console.log('\n' + '='.repeat(62));
console.log('通过 ' + pass + ' / ' + (pass + fail));
if (fail) {
  console.log('失败用例：');
  failures.forEach((f) => console.log('  · ' + f));
  process.exit(1);
}
console.log('全绿 ✓  —— 微信两个站点与三处域判定已对齐，且没有顺手扩大范围');
