'use strict';

/**
 * 自测 · 弹窗平台切换（2026-10-31 建）
 *
 * 用户这一轮的四条要求，逐条钉死：
 *   ① 插件名统一叫「可可助手」（manifest.name / 弹窗标题 / 更新页）
 *   ② 顶部胶囊双段「抖音 ｜ 微信」，按钮前面带平台图标
 *   ③ 进抖音页默认抖音、进微信页自动切微信（网址优先，认不出才用上次记住的）
 *   ④ 调试模式 + 版本号恒定在弹窗最底部，切平台不动
 *
 * 最容易出的三类错，本脚本专治：
 *   · **分组漏认领**：DYC_FLAG_GROUPS 加了新组却没写进任何平台的 groups ——
 *     弹窗里那个组永远不显示，而且不报错。这是本脚本第【一】节的主断言。
 *   · **微信侧新功能消失**：商品名完整显示 / 商品行快捷复制 若没落在 wx 组，
 *     切到微信就是白板。第【二】节按 key 逐条点名。
 *   · **切平台顺手重建**：applyPlatform 里一旦调 renderFlags()，开关会闪一下
 *     且滚动位置丢失。第【五】节直接禁止。
 *
 * 用法：node scripts/自测-弹窗平台切换.js（run-selftests.py 自动带上）
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

/* flags.js 是普通脚本（var + function），用 jsdom 的 window 当沙箱跑一遍，
   拿到的就是内容脚本/弹窗里真实的那份数据。 */
const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'https://store.weixin.qq.com/shop',
  runScripts: 'outside-only'
});
const win = dom.window;
win.eval(read('src/content/flags.js'));

const PLATS = win.DYC_PLATFORMS;
const GROUPS = win.DYC_FLAG_GROUPS;
const META = win.DYC_FLAGS_META;
const detect = win.dycDetectPlatform;
const groupsOf = win.dycPlatformGroups;

const html = read('src/popup/popup.html');
const js = read('src/popup/popup.js');
const mf = JSON.parse(read('manifest.json'));

/* 取某个函数体：从 `function name(` 起到后面第一个行首 `}` 止 */
function bodyOf(source, name) {
  const i = source.indexOf('function ' + name + '(');
  assert.ok(i > 0, '源码里没有 function ' + name + '()');
  const j = source.indexOf('\n}', i);
  assert.ok(j > i, name + ' 函数体没有闭合');
  return source.slice(i, j);
}

console.log('\n【一】平台表：每个分组都必须被某个平台认领');
check('DYC_PLATFORMS 存在且含 dy / wx', () => {
  assert.ok(Array.isArray(PLATS) && PLATS.length >= 2, 'DYC_PLATFORMS 应为数组且含两个平台');
  // ⚠️ 别用 deepEqual：PLATS 来自 jsdom 的另一个 realm，数组原型不同，
  //    deepEqual 会以「same structure but not reference-equal」判失败。
  const ids = Array.from(PLATS, (p) => p.id).join(',');
  assert.equal(ids, 'dy,wx', '平台顺序应为 dy,wx，实际 ' + ids);
});
check('每个分组都被认领（漏一个 = 那组永远不显示）', () => {
  const owned = PLATS.reduce((acc, p) => acc.concat(p.groups), []);
  for (const g of GROUPS) {
    assert.ok(owned.indexOf(g.id) !== -1, '分组「' + g.id + '」没有被任何平台认领');
  }
});
check('仅通用组跨平台共享，单个平台内不重复分组', () => {
  for (const p of PLATS) assert.equal(new Set(p.groups).size, p.groups.length, p.id);
  const owned = PLATS.reduce((acc, p) => acc.concat(p.groups), []);
  const dup = owned.filter((id, i) => owned.indexOf(id) !== i);
  assert.equal(dup.join(','), 'shared', '跨平台共享组：' + dup.join(','));
});
check('认领的都是真实存在的分组（防拼写错误）', () => {
  const ids = GROUPS.map((g) => g.id);
  for (const p of PLATS) {
    for (const g of p.groups) {
      assert.ok(ids.indexOf(g) !== -1, '平台 ' + p.id + ' 认领了不存在的分组「' + g + '」');
    }
  }
});
check('抖音和微信各自保留专属分组，均可访问通用组', () => {
  assert.equal(Array.from(groupsOf('dy')).sort().join(','), 'live,other,shared,shop');
  assert.equal(Array.from(groupsOf('wx')).join(','), 'wx,shared');
});
check('未知平台 id 返回空数组（调用方据此回落，不会画出半个弹窗）', () => {
  assert.equal(Array.from(groupsOf('nope')).length, 0);
  assert.equal(Array.from(groupsOf('')).length, 0);
});
check('每个平台都有 label 与 urlRe', () => {
  for (const p of PLATS) {
    assert.ok(p.label && p.label.length, p.id + ' 缺 label');
    assert.ok(p.urlRe instanceof win.RegExp || typeof p.urlRe.test === 'function', p.id + ' 缺 urlRe');
  }
});

console.log('\n【二】微信侧两个新功能：必须落在 wx 组里');
// 用户原话「留意我刚刚做的新功能的按钮的适配」—— 指的就是这两项。
// 它们若不在 wx 组，切到微信就是一片空白，功能还在但用户找不到开关。
[['wxGoodsFullTitle', '商品名完整显示'], ['wxRowCopy', '商品行快捷复制']].forEach(([key, label]) => {
  check(label + '（' + key + '）在微信分组、且被微信平台认领', () => {
    const meta = META.filter((m) => m.key === key)[0];
    assert.ok(meta, 'DYC_FLAGS_META 里没有 ' + key);
    assert.equal(meta.group, 'wx', key + ' 的 group 应为 wx，实际 ' + meta.group);
    assert.ok(groupsOf('wx').indexOf(meta.group) !== -1, key + ' 所在分组没被微信平台认领');
    assert.equal(meta.label, label, key + ' 的名称应为「' + label + '」');
    assert.equal(meta.default, true, key + ' 应默认开启');
    assert.ok((meta.pages || []).indexOf('wxGoodsList') !== -1, key + ' 的作用页应含 wxGoodsList');
  });
});
check('微信平台下确实有可显示的开关（不是空组）', () => {
  const wxKeys = META.filter((m) => groupsOf('wx').indexOf(m.group) !== -1);
  assert.ok(wxKeys.length >= 2, '微信平台应至少 2 个开关，实际 ' + wxKeys.length);
});

console.log('\n【三】网址判定：两个微信域都要认，仿冒后缀不能认');
check('store.weixin.qq.com（微信小店后台）→ wx', () => {
  ['https://store.weixin.qq.com/', 'https://store.weixin.qq.com/shop',
   'https://store.weixin.qq.com/shop/goods/list', 'https://store.weixin.qq.com/talent'
  ].forEach((u) => assert.equal(detect(u), 'wx', u));
});
check('channels.weixin.qq.com（视频号助手）→ wx', () => {
  ['https://channels.weixin.qq.com/', 'https://channels.weixin.qq.com/platform',
   'https://channels.weixin.qq.com/shop'
  ].forEach((u) => assert.equal(detect(u), 'wx', u));
});
check('抖店 / 罗盘 / 中控台 → dy', () => {
  ['https://compass.jinritemai.com/shop/commodity/product-list',
   'https://fxg.jinritemai.com/ffa/mshop/homepage/index',
   'https://buyin.jinritemai.com/dashboard',
   'https://anchor.douyin.com/anchor/replay',
   'https://liveservice.douyin.com/live'
  ].forEach((u) => assert.equal(detect(u), 'dy', u));
});
check('仿冒后缀不被误吃（store.weixin.qq.com.evil.test）', () => {
  ['https://store.weixin.qq.com.evil.test/shop',
   'https://evil.test/store.weixin.qq.com/shop',
   'https://notjinritemai.com/shop'
  ].forEach((u) => assert.notEqual(detect(u), 'wx', u + ' 不该判成微信'));
});
check('认不出的网址返回空串（由弹窗回落到上次记住的平台）', () => {
  ['', 'chrome://extensions/', 'https://www.baidu.com/', null, undefined]
    .forEach((u) => assert.equal(detect(u), '', String(u) + ' 应返回空串'));
});

console.log('\n【四】弹窗结构：胶囊双段 + 固定底栏 + 名字');
check('标题是「可可助手」，且不再带平台前缀', () => {
  assert.ok(/<h1>可可助手<\/h1>/.test(html), '弹窗标题应为 <h1>可可助手</h1>');
  // 只看 body 之后的可见结构：CSS 注释里为了说明历史会提到旧名（「换回 6 字的
  // 抖音可可助手也放得下」），那不是用户看得见的文案，不该判违规。
  const visible = html.slice(html.indexOf('<body')).replace(/<!--[\s\S]*?-->/g, '');
  assert.ok(!/抖音可可助手/.test(visible), '弹窗可见部分不该再出现「抖音可可助手」');
});
check('manifest 名字与浏览器里显示的一致（name + default_title）', () => {
  assert.equal(mf.name, '可可助手');
  assert.equal(mf.action.default_title, '可可助手');
});
check('胶囊：两枚按钮、图标在前、抖音在微信前', () => {
  const seg = html.slice(html.indexOf('id="plat-seg"'), html.indexOf('class="tagline"'));
  const dy = seg.indexOf('data-plat="dy"');
  const wx = seg.indexOf('data-plat="wx"');
  assert.ok(dy > 0 && wx > 0, '两枚平台按钮都要在');
  assert.ok(dy < wx, '抖音应排在微信之前');
  // 每枚按钮里 svg 必须出现在文字之前 —— 用户原话「按钮前面带平台的图标」
  for (const id of ['dy', 'wx']) {
    const start = seg.indexOf('data-plat="' + id + '"');
    const end = seg.indexOf('</button>', start);
    const chunk = seg.slice(start, end);
    const svgAt = chunk.indexOf('<svg');
    const textAt = chunk.search(/<\/svg>\s*(抖音|微信)/);
    assert.ok(svgAt > 0, id + ' 按钮缺图标');
    assert.ok(textAt > svgAt, id + ' 按钮的图标要在文字前面');
  }
});
check('胶囊用 <button>（键盘可达），且带 aria-pressed', () => {
  assert.ok(/class="plat-item"[^>]*data-plat="dy"/.test(html), 'plat-item 结构');
  const seg = html.slice(html.indexOf('id="plat-seg"'), html.indexOf('class="tagline"'));
  assert.equal((seg.match(/<button type="button"/g) || []).length, 2, '应是两枚 button');
  assert.equal((seg.match(/aria-pressed=/g) || []).length, 2, '两枚都要有 aria-pressed');
});
check('副标题文案与用户指定一字不差', () => {
  assert.ok(/适配抖音、微信的中控台和店铺的便携化升级。/.test(html));
});
check('固定底栏容器在主体之后、页面内容流的末尾', () => {
  const body = html.indexOf('id="flags-root"');
  const foot = html.indexOf('id="pop-foot"');
  const mask = html.indexOf('id="confirm-mask"');
  assert.ok(foot > body, '底栏要排在主体之后');
  assert.ok(foot > 0 && foot < mask, '底栏要在遮罩之前');
});
check('初始先藏主体（防止先画全部分组再刷成单平台，肉眼闪一下）', () => {
  assert.ok(/<body class="plat-pending">/.test(html), 'body 初始应带 plat-pending');
  assert.ok(/body\.plat-pending #flags-root/.test(html), '要有 plat-pending 的隐藏规则');
});

console.log('\n【五】弹窗逻辑：显隐切换，不重建');
check('调试模式标了 inFooter，且不再依赖 pinLast', () => {
  const dbg = META.filter((m) => m.key === 'debug')[0];
  assert.ok(dbg, '没有 debug 元数据');
  assert.equal(dbg.inFooter, true, 'debug 应带 inFooter:true');
  assert.ok(!dbg.pinLast, 'debug 不该再写 pinLast（它现在不在主体区排队了）');
});
check('底栏渲染：调试行 + 更新区，且不往里塞分组框', () => {
  const body = bodyOf(js, 'buildFooter');
  assert.ok(/getElementById\('pop-foot'\)/.test(body), 'buildFooter 应写到 #pop-foot');
  assert.ok(/inFooter/.test(body), '应按 inFooter 取调试模式');
  assert.ok(/buildUpdateBox\(\)/.test(body), '要带上更新区（版本号）');
  assert.ok(!/boxByGroup|group-/.test(body), '底栏里不该出现分组框');
});
check('主体渲染时跳过 inFooter 的行（否则调试模式会出现两次）', () => {
  const body = bodyOf(js, 'renderFlags');
  assert.ok(/if \(meta\.inFooter\) return;/.test(body), 'renderFlags 必须先跳过 inFooter');
});
check('applyPlatform 只切显隐，不重建 DOM', () => {
  const body = bodyOf(js, 'applyPlatform');
  assert.ok(/dycPlatformGroups/.test(body), '应按平台表取分组');
  assert.ok(/box\.hidden\s*=/.test(body), '应只改 hidden');
  assert.ok(!/renderFlags\(/.test(body), 'applyPlatform 里不许重建（会闪、会丢滚动位置）');
  assert.ok(!/dycWriteFlag|chrome\.storage\.local\.set/.test(body), '切平台不许写开关值');
});
check('切换按钮：点已选中那段不重复处理', () => {
  const body = bodyOf(js, 'bindPlatformSwitch');
  assert.ok(/next === currentPlatform/.test(body), '要有「点当前段什么都不做」的判据');
  assert.ok(/rememberPlatform/.test(body), '手动切换要记住');
});
check('自动判定：网址优先，认不出才用上次记住的', () => {
  const body = bodyOf(js, 'initPlatform');
  assert.ok(/chrome\.tabs\.query/.test(body), '要问当前标签页');
  assert.ok(/dycDetectPlatform/.test(body), '要用唯一的平台判据');
  assert.ok(/fallbackPlatform/.test(body), '认不出时要回落');
  assert.ok(/setTimeout/.test(body), '要有超时兜底（否则主体一直 plat-pending = 看着空）');
});
check('「本页是否受支持」与平台判定同一真源', () => {
  assert.ok(/function onSupportedPage\(url\) \{[\s\S]*?dycDetectPlatform/.test(js),
    'onSupportedPage 应直接复用 dycDetectPlatform');
});

console.log('\n【六】名字统一：别处不许再叫「抖音可可助手」');
check('更新页标题', () => {
  const u = read('src/update/update.html');
  assert.ok(/<title>可可助手 · 更新<\/title>/.test(u), '更新页 title 应统一');
  assert.ok(/<h1>可可助手 · 更新<\/h1>/.test(u), '更新页 h1 应统一');
});
check('版本回退标题与目录校验提示', () => {
  const u = read('src/update/update.js');
  assert.ok(!/'抖音可可助手 · 版本回退'/.test(u), '回退页标题不该再带抖音');
  assert.ok(/不是「可可助手」/.test(u), '目录校验提示应统一');
  // 校验用的是 indexOf('可可助手') —— 改名前的老目录名也包含这三个字，
  // 所以老用户升级时不会被误判成「选错目录」。
  assert.ok(/indexOf\('可可助手'\)/.test(u), '目录校验应保持含「可可助手」的宽松判据');
});

console.log('\n【福袋功能增强】单一开关（2026-11-01 深夜：子菜单撤下，自动发福袋挪进悬浮面板）');
check('「福袋功能增强」是普通一级行，不再有任何折叠关系', () => {
  const host = META.find((m) => m.key === 'luckyBag');
  assert.ok(host, '应有 luckyBag 开关');
  assert.equal(host.label, '福袋功能增强', '一级行文案应为「福袋功能增强」');
  assert.equal(host.default, true, '默认开（老用户在用的功能不能被默认关掉）');
  assert.ok(!host.foldHost && !host.foldGroup, '折叠子菜单已撤，不应再挂 foldHost / foldGroup');
  assert.ok(/停/.test(host.desc), 'desc 要讲总闸范围（关了全停）：' + host.desc);
  assert.ok(/悬浮窗|默认关/.test(host.note), 'note 要交代「自动发福袋在悬浮窗里」：' + host.note);
});
check('两个福袋子开关已从 META 删除', () => {
  assert.equal(META.find((m) => m.key === 'luckyBagWatch'), undefined,
    '「福袋活动状态监视」应删（监视跟随总闸）');
  assert.equal(META.find((m) => m.key === 'luckyBagAuto'), undefined,
    '「福袋自动开始下一轮」应删（开关挪进悬浮面板，存本地键 dycBagAuto）');
  assert.equal(META.filter((m) => m.foldHost === 'bag').length, 0, 'bag 折叠组不应残留');
});

console.log('');
if (fail) {
  console.log('弹窗平台切换自测：' + pass + '/' + (pass + fail) + ' 通过，' + fail + ' 条失败');
  failures.forEach((f) => console.log('  · ' + f));
  process.exit(1);
}
console.log('弹窗平台切换自测：' + pass + '/' + pass + ' 全部通过；'
  + '平台表无漏认领、微信侧两个新功能在 wx 组、两域判定对齐、底栏只切显隐不重建。');
