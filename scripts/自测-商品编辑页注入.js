'use strict';

/**
 * 自测 · 抖店「商品发布 / 编辑」页注入（2026-11-08 建）
 *
 * 事由（用户 2026-11-08 报障）：插件在抖店其它页面都正常，但**新建商品 / 编辑商品**
 * 那一页什么都不出现 —— 左下角既没有「DY-COCO」标记，也没有消息盒子。
 *
 * 根因是「只改了一半」的老毛病：`/ffa/g/create` 从来没被任何一条 content_scripts
 * 精确覆盖，只是被**全域轻量条目**（flags.js + hide-elements.js）顺手带上 ——
 * 那条按设计不带 anchor/dialog，所以连标记都不会建。
 * 于是「插件不生效」+「没有左下角标记」= 没注入（判据见 AGENTS.md「页面匹配」）。
 *
 * 本脚本不测业务行为（本轮只做页面兼容，功能另开工），只机械钉死五件事：
 *   ① manifest 里有且只有一条覆盖 `/ffa/g/create*` 的业务条目，且带齐基础设施
 *   ② 全域轻量条目必须 exclude 本路径（否则 flags/hide-elements 会被注入两次）
 *   ③ flags.js 的 goodsEdit 键存在、且**排在 shopAll 之前**（pageKind 先匹配先返回）
 *   ④ 真实 anchor.js 创建标记，diag.js 有对应页面中文名
 *   ⑤ 正则的匹配边界：认新建与编辑、不吃商品列表、不吃伪冒域名
 *
 * ⚠️ 本文件同时读 manifest.json 与 src/**。`run-selftests.py --changed` 只能反查
 * `src/...` 引用，因此**单改 manifest.json 不会命中本测**；那种情况由
 * `scripts/check-manifest-order.py`（wt-merge 的「manifest 顺序」闸）兜住。
 * 改本页注入时，flags.js / anchor.js / diag.js 至少会动一个，届时本测必然被选中。
 *
 * 用法：node scripts/自测-商品编辑页注入.js（run-selftests.py 自动带上）
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

const CREATE_MATCH = 'https://*.jinritemai.com/ffa/g/create*';
const mf = JSON.parse(read('manifest.json'));
const entries = mf.content_scripts || [];

function createEntry() {
  const hit = entries.filter((e) => (e.matches || []).includes(CREATE_MATCH) && !(e.exclude_matches || []).includes(CREATE_MATCH));
  assert.equal(hit.length, 1, '覆盖 ' + CREATE_MATCH + ' 的条目应恰有 1 条，实际 ' + hit.length);
  return hit[0];
}

function lightEntry() {
  // 全域轻量条目 = matches 只有全域通配、且 js 里没有功能脚本的那条
  const hit = entries.filter((e) => {
    const m = e.matches || [];
    return m.length === 1 && m[0] === 'https://*.jinritemai.com/*'
      && (e.js || []).includes('src/live/hide-elements.js');
  });
  assert.equal(hit.length, 1, '全域轻量条目应恰有 1 条，实际 ' + hit.length);
  return hit[0];
}

console.log('\n【一】注入条目：存在、内容、防双注入');

check('有且只有一条业务条目覆盖 /ffa/g/create*', () => {
  createEntry();
});

check('flags.js 在第 0 位', () => {
  assert.equal(createEntry().js[0], 'src/content/flags.js');
});

check('四个基础设施脚本都在场（标记 / 消息盒子 / 诊断 / 调试面板）', () => {
  const js = createEntry().js;
  for (const s of ['src/content/diag.js', 'src/content/anchor.js', 'src/content/dialog.js', 'src/content/debug-panel.js']) {
    assert.ok(js.includes(s), '缺少 ' + s);
  }
});

check('网络监听探针在场，且排在 debug-panel.js 之前', () => {
  // 调试面板里「开始接口取样 30 秒」是「在场才显示」的按钮：
  // 打开面板时读 window.__DYC_STOCK_PROBE__，读不到就整枚 display:none。
  // 本页先前没装探针 ⇒ 按钮凭空消失（用户 2026-11-08 报障）。
  const js = createEntry().js;
  const iProbe = js.indexOf('src/content/stock-net-probe.js');
  const iPanel = js.indexOf('src/content/debug-panel.js');
  assert.ok(iProbe >= 0, '缺少 src/content/stock-net-probe.js —— 接口取样按钮会整枚消失');
  assert.ok(iProbe < iPanel, '探针须早于 debug-panel.js（面板打开时读 window.__DYC_STOCK_PROBE__）');
});

check('MAIN 探针资源本域可达（script 标签通道不被 CSP 配额卡死）', () => {
  const res = (mf.web_accessible_resources || []).filter((r) => (r.resources || []).includes('src/content/stock-net-probe-main.js'));
  assert.ok(res.length > 0, 'web_accessible_resources 里没有 stock-net-probe-main.js');
  assert.ok(res.some((r) => (r.matches || []).includes('https://*.jinritemai.com/*')),
    'MAIN 探针资源未覆盖 https://*.jinritemai.com/*（只剩后台直注一条路）');
});

check('样式成对注入（标记与消息盒子靠 msgbox.css）', () => {
  const css = createEntry().css || [];
  assert.ok(css.includes('src/content/msgbox.css'), '缺少 msgbox.css —— 标记会没有样式');
  assert.ok(css.includes('src/content/style.css'));
});

check('没把商品列表页那整套重脚本顺手带进来', () => {
  // 这一页只需要基础设施 + 将来的两个小功能，不需要行扫描 / 清零 / 工具栏。
  const BIZ = ['main.js', 'toolbar.js', 'clear-stock.js', 'row-scan.js', 'inject-button.js',
    'stock-direct.js', 'channel-stock.js', 'channel-offline-delete.js', 'live-agent.js'];
  const bad = createEntry().js.filter((p) => BIZ.some((b) => p.endsWith('/' + b)));
  assert.equal(bad.length, 0, '混入了 ' + bad.join(', '));
});

check('全域轻量条目已 exclude 本路径（否则 flags/hide-elements 注入两次）', () => {
  const ex = lightEntry().exclude_matches || [];
  assert.ok(ex.includes(CREATE_MATCH), 'exclude_matches 里没有 ' + CREATE_MATCH);
});

check('全域轻量条目仍然全域（没有把通配改窄）', () => {
  assert.deepEqual(lightEntry().matches, ['https://*.jinritemai.com/*']);
});

console.log('\n【二】页面键：存在、顺序、匹配边界');

let P;
let win;
{
  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    url: 'https://fxg.jinritemai.com/ffa/g/create', runScripts: 'outside-only'
  });
  win = dom.window;
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
  P = win.DYC_PAGE_PATTERNS;
}

const REAL_EDIT = 'https://fxg.jinritemai.com/ffa/g/create?product_id=3852734691379642755&cid=1000008296&entrance=edit&btm_ppre=a2427.b76571.c902327.d871297&btm_pre=a2427.b08003.c938398.d63429&btm_show_id=7f049f1d-0bc6-4487-8e2f-5b6146ff95dc';
const REAL_NEW = 'https://fxg.jinritemai.com/ffa/g/create?entrance=new&cid=1000008296';

check('goodsEdit 键存在', () => {
  assert.ok(P.goodsEdit, 'DYC_PAGE_PATTERNS 里没有 goodsEdit');
  assert.ok(P.goodsEdit.test(REAL_EDIT), '编辑页真实地址没命中');
  assert.ok(P.goodsEdit.test(REAL_NEW), '新建商品地址没命中');
  assert.ok(P.goodsEdit.test('https://fxg.jinritemai.com/ffa/g/create'), '无 query 的裸路径没命中');
});

check('goodsEdit 排在 shopAll 之前（pageKind 先匹配先返回）', () => {
  const keys = Object.keys(P);
  const iEdit = keys.indexOf('goodsEdit');
  const iAll = keys.indexOf('shopAll');
  assert.ok(iEdit >= 0 && iAll >= 0, '键缺失');
  assert.ok(iEdit < iAll, 'goodsEdit 在第 ' + iEdit + ' 位，必须早于 shopAll（第 ' + iAll + ' 位）');
});

check('goodsEdit 不吃别的页面', () => {
  for (const u of [
    'https://fxg.jinritemai.com/ffa/g/list',
    'https://fxg.jinritemai.com/ffa/g/channel-goods-manage/list',
    'https://fxg.jinritemai.com/ffa/content-tool/live/control',
    'https://fxg.jinritemai.com/ffa/merchant/parent-campaign-detail',
    'https://buyin.jinritemai.com/dashboard/shopwindow/list'
  ]) {
    assert.ok(!P.goodsEdit.test(u), '误吃 ' + u);
  }
});

check('本页仍属抖店全域（隐藏页面元素等全域开关照旧生效）', () => {
  assert.ok(P.shopAll.test(REAL_EDIT), 'shopAll 不该排除商品编辑页');
});

check('伪冒域名不被误吃', () => {
  for (const u of [
    'https://fxg.jinritemai.com.evil.test/ffa/g/create',
    'https://notjinritemai.com/ffa/g/create'
  ]) {
    assert.ok(!P.goodsEdit.test(u), '误吃伪冒域名 ' + u);
  }
});

console.log('\n【三】标记与诊断登记的同步');

check('商品编辑页真实探针能创建左下角入口', () => {
  win.eval(read('src/content/anchor.js'));
  assert.ok(win.document.querySelector('#dyb-status-bar .dyb-badge'), '已注入的编辑页必须出现标记');
});

check('diag.js 的 KIND_CN 有本页中文名', () => {
  const src = read('src/content/diag.js');
  assert.ok(/goodsEdit\s*:\s*'[^']+'/.test(src), 'KIND_CN 缺 goodsEdit');
});

check('弹窗平台判定覆盖本页（抖音分组）', () => {
  // 2026-10-31 起 popup.js 不再自带页面正则，直接复用 flags.js 的 dycDetectPlatform，
  // 所以这里断言的是「平台判定本身」+「popup 确实在用这一份」。
  assert.ok(typeof win.dycDetectPlatform === 'function', 'flags.js 缺 dycDetectPlatform');
  assert.equal(win.dycDetectPlatform(REAL_EDIT), 'dy', '本页没被判成抖音');
  assert.ok(/dycDetectPlatform/.test(read('src/popup/popup.js')), 'popup.js 没复用平台判定');
});

check('新增开关按加入顺序排在 DYC_FLAGS_META 表尾（用户 2026-11-08 定：最新在底部）', () => {
  // 规矩:以后新加功能一律追加到 DYC_FLAGS_META 末尾,不往中间插。
  // 本断言钉住"当前最新的三个在表尾";将来再加新开关时,把本断言改成
  // "更晚的开关在表尾"即可 —— 中途插队会让弹窗里新功能出现在老功能中间。
  const keys = win.DYC_FLAGS_META
    .map((m) => m.key)
    .filter(Boolean);
  const tail = keys.slice(-3).join(',');
  // ★ 用字符串比较而不是 deepEqual:win 里的数组是 JSDOM realm 的,
  //   assert/strict 的 deepEqual 会因原型不同而永远失败。
  assert.equal(tail, 'goodsImagePaste,fabricSmartFill,wxClearStock',
    '表尾三位是 [' + keys.slice(-3).join('、') + '] —— 有人往中间插了新开关?');
});

console.log('\n────────────────────────────────────────');
console.log('  通过 ' + pass + ' / 失败 ' + fail);
if (fail) {
  console.log('\n失败明细：');
  failures.forEach((f) => console.log('  - ' + f));
  process.exit(1);
}
console.log('  全部通过。\n');
