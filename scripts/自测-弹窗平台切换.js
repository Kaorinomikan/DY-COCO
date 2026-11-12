'use strict';

/**
 * 自测 · 弹窗平台切换（2026-10-31 建）
 *
 * 用户这一轮的四条要求，逐条钉死：
 *   ① 插件名统一叫「可可助手」（manifest.name / 弹窗标题 / 更新页）
 *   ② 顶部下拉菜单切换平台，按钮前面带平台图标
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
  assert.equal(ids, 'dy,wx,xhs,ks,tb', '平台顺序应保留原入口并追加新平台，实际 ' + ids);
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
    assert.ok(typeof meta.label === 'string' && meta.label.trim(), key + ' 应有可显示的名称');
    assert.equal(meta.default, true, key + ' 应默认开启');
    assert.ok((meta.pages || []).indexOf('wxGoodsList') !== -1, key + ' 的作用页应含 wxGoodsList');
  });
});
/* 可见性的**唯一口径**（2026-11-12 起分两级）：分组归属 ∪ 单行 platforms。
   凡是「某平台看得见某开关」的断言都走这里，别各写一套 ——
   两套口径一旦分家，就会出现「测试说看得见、弹窗里却没有」。 */
const visibleKeys = (pid) => META.filter((m) => !m.hidden && !m.inFooter &&
  (groupsOf(pid).indexOf(m.group) !== -1 || (m.platforms || []).indexOf(pid) !== -1)
).map((m) => m.key);

check('微信平台下确实有可显示的开关（不是空组）', () => {
  const wxKeys = visibleKeys('wx');
  assert.ok(wxKeys.length >= 2, '微信平台应至少 2 个开关，实际 ' + wxKeys.length);
});

console.log('\n【二·五】「其他」组里的跨平台开关（用户 2026-11-12 定）');
check('粘贴图片排在「其他」组（用户要求从「通用」搬过来）', () => {
  const meta = META.filter((m) => m.key === 'goodsImagePaste')[0];
  assert.ok(meta, 'DYC_FLAGS_META 里没有 goodsImagePaste');
  assert.equal(meta.group, 'other', 'group 应为 other，实际 ' + meta.group);
});
check('「其他」组只归抖音 ⇒ 这一行必须自带 platforms，否则微信段整行消失', () => {
  const meta = META.filter((m) => m.key === 'goodsImagePaste')[0];
  assert.ok(groupsOf('dy').indexOf('other') !== -1, '前提变了：「其他」组不再归抖音');
  assert.equal(groupsOf('wx').indexOf('other'), -1, '前提变了：「其他」组若也归微信，这行白名单就多余了');
  assert.equal(Array.from(meta.platforms || []).sort().join(','), 'dy,wx',
    '粘贴图片应在两个平台都可见，实际 ' + (meta.platforms || []).join(','));
  assert.ok(visibleKeys('dy').indexOf('goodsImagePaste') !== -1, '抖音段看不到它');
  assert.ok(visibleKeys('wx').indexOf('goodsImagePaste') !== -1, '微信段看不到它');
});
check('白名单是逐行的：不给「其他」组的抖音专属功能带进微信', () => {
  const wxKeys = visibleKeys('wx');
  ['hideElements', 'replayDownload', 'servicePlatformJump'].forEach((key) => {
    assert.equal(wxKeys.indexOf(key), -1, key + ' 不该出现在微信段');
  });
});
check('弹窗按行判显隐、零可露行的组框自动收起（不然「通用」剩个空壳）', () => {
  const body = bodyOf(js, 'applyPlatform');
  assert.ok(/data-flag-row/.test(body), 'applyPlatform 没按行判显隐');
  assert.ok(/meta\.platforms/.test(body), 'applyPlatform 没读单行 platforms 白名单');
  assert.ok(/box\.hidden\s*=\s*shownRows\s*===\s*0/.test(body), '零可露行的组框不会被收起');
});
check('行与面板都挂了 key 把手，切平台才能逐行对位', () => {
  assert.ok(/dataset\.flagRow\s*=\s*meta\.key/.test(js), '行上缺 data-flag-row');
  assert.ok(/dataset\.flagPanel\s*=\s*meta\.key/.test(js), '面板上缺 data-flag-panel');
});

check('平台初始化与切换保留子面板折叠态，只有点名字才展开', () => {
  const page = new JSDOM('<div id="flags-root"><section data-gid="other"><div data-flag-row="hideElements"><span class="name"></span><input type="checkbox"></div><div data-flag-panel="hideElements" hidden></div></section></div>', { runScripts: 'outside-only' });
  const w = page.window;
  w.DYC_PLATFORMS = PLATS;
  w.dycPlatformGroups = groupsOf;
  w.chrome = { storage: { local: { set() {} } } };
  w.platformInfo = (id) => PLATS.find((p) => p.id === id);
  w.updatePlatformUI = () => {};
  w.eval('const FLAG_META_BY_KEY = { hideElements: {} }; let currentPlatform; let platInitDone; const PLAT_STORE_KEY = "test";\n' +
    bodyOf(js, 'attachSubPanelToggle') + '\n}\n' + bodyOf(js, 'applyPlatform') + '\n}');
  const row = w.document.querySelector('[data-flag-row]');
  const el = w.document.querySelector('[data-flag-panel]');
  const input = row.querySelector('input');
  const name = row.querySelector('.name');
  const panel = { el };
  w.attachSubPanelToggle({ row, input, name }, panel);
  input.checked = true;
  panel.setGate(true);
  w.applyPlatform('dy');
  assert.equal(el.hidden, true, '打开助手时面板必须收起');
  assert.equal(row.classList.contains('open'), false);
  name.click();
  assert.equal(el.hidden, false, '点名字才展开');
  w.applyPlatform('wx');
  assert.ok(el.hidden || el.style.display === 'none', '微信不显示抖音专属面板');
  w.applyPlatform('dy');
  assert.equal(el.hidden, false, '切回平台保留手动展开态');
  assert.notEqual(el.style.display, 'none');
  name.click();
  w.applyPlatform('wx');
  w.applyPlatform('dy');
  assert.equal(el.hidden, true, '切回平台保留手动收起态');
  input.checked = false;
  input.dispatchEvent(new w.Event('change'));
  input.checked = true;
  input.dispatchEvent(new w.Event('change'));
  w.applyPlatform('dy');
  assert.equal(el.hidden, true, '重新开启开关也不能自动展开');
  page.window.close();
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

console.log('\n【四】弹窗结构：平台菜单 + 固定底栏 + 名字');
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
check('平台菜单入口使用按钮，图标在名称前且关联选择面板', () => {
  const page = new JSDOM(html);
  const trigger = page.window.document.getElementById('platform-trigger');
  assert.equal(trigger.tagName, 'BUTTON');
  assert.equal(trigger.getAttribute('aria-expanded'), 'false');
  assert.equal(trigger.getAttribute('aria-controls'), 'platform-panel');
  assert(trigger.querySelector('.platform-logo img'));
  assert(trigger.querySelector('#platform-current-name'));
  assert(page.window.document.getElementById('platform-grid'));
  page.window.close();
});
check('副标题简短可见，适合多平台菜单', () => {
  const text = new JSDOM(html).window.document.querySelector('.tagline').textContent.trim();
  assert.ok(text.length > 0 && text.length <= 21);
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
  assert.ok(typeof host.label === 'string' && host.label.trim(), '福袋一级行应有可显示的名称');
  assert.equal(host.default, true, '默认开（老用户在用的功能不能被默认关掉）');
  assert.ok(!host.foldHost && !host.foldGroup, '折叠子菜单已撤，不应再挂 foldHost / foldGroup');
  assert.ok(/停/.test(host.desc + host.note), 'desc 要讲总闸范围（关了全停）：' + host.desc);
  assert.ok(/悬浮窗/.test(host.desc + host.note) && /默认关/.test(host.desc + host.note), 'note 要交代「自动发福袋在悬浮窗里」：' + host.note);
});
check('两个福袋子开关已从 META 删除', () => {
  assert.equal(META.find((m) => m.key === 'luckyBagWatch'), undefined,
    '「福袋活动状态监视」应删（监视跟随总闸）');
  assert.equal(META.find((m) => m.key === 'luckyBagAuto'), undefined,
    '「福袋自动开始下一轮」应删（开关挪进悬浮面板，存本地键 dycBagAuto）');
  assert.equal(META.filter((m) => m.foldHost === 'bag').length, 0, 'bag 折叠组不应残留');
});

check('回放入口用新标签页打开复盘页，点击不改变开关', () => {
  win.hasSubPanel = () => false;
  win.attachHelpBadge = () => {};
  const buildRow = win.eval('(' + bodyOf(js, 'buildToggleRow') + '\n})');
  const meta = META.find((m) => m.key === 'replayDownload');
  const { row, input } = buildRow(meta);
  const link = row.querySelector('a');
  assert.ok(link, '回放行应有网页入口');
  assert.equal(link.href, 'https://anchor.douyin.com/anchor/review');
  assert.equal(link.target, '_blank');
  assert.ok(link.relList.contains('noopener'));
  assert.ok(link.getAttribute('aria-label'));
  assert.ok(link.querySelector('svg'), '入口使用外链图标');
  link.addEventListener('click', (e) => e.preventDefault());
  for (const enabled of [true, false]) {
    input.checked = enabled;
    link.click();
    assert.equal(input.checked, enabled);
    assert.equal(link.hasAttribute('disabled'), false);
  }
  const ordinary = buildRow(META.find((m) => m.key === 'servicePlatformJump'));
  assert.equal(ordinary.row.querySelector('a'), null, '不在其他开关旁重复添加入口');
});

console.log('');
if (fail) {
  console.log('弹窗平台切换自测：' + pass + '/' + (pass + fail) + ' 通过，' + fail + ' 条失败');
  failures.forEach((f) => console.log('  · ' + f));
  process.exit(1);
}
console.log('弹窗平台切换自测：' + pass + '/' + pass + ' 全部通过；'
  + '平台表无漏认领、微信侧两个新功能在 wx 组、两域判定对齐、底栏只切显隐不重建。');
