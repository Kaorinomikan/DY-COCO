/**
 * 小红书页面接入（2026-11-17）
 * ============================================================
 * 被测文件：src/content/flags.js（页面键 / 平台表 / 分组）、
 *           manifest.json（host_permissions 与 content_scripts）、
 *           src/background/service-worker.js（isHostPermittedUrl）、
 *           src/content/diag.js（页面类型中文名）
 *
 * 背景：用户 2026-11-17 给出两个后台地址，要求先接入调试助手 ——
 *   pgy.xiaohongshu.com/commerce/redlive/live_center_control（直播中控台）
 *   ark.xiaohongshu.com/app-item/list/shelf              （千帆商品列表）
 * 注入范围按子域放宽（SPA 走 pushState，卡死单条路径等于「从列表点进来就没脚本」），
 * 页面键只承担功能作用域与诊断分类。
 *
 * 为什么要有这条用例：这四处改动彼此独立、漏一处都不会报错，只会**静默失效** ——
 *   · manifest 加了 matches 却忘了 host_permissions ⇒ 结构探针注入不了；
 *   · 忘了 service-worker 的 isHostPermittedUrl ⇒ 弹窗挑不到该标签；
 *   · 页面键顺序写反 ⇒ 诊断报告里永远只报「小红书其他页」，排查时看不出用户在哪；
 *   · diag 没登记中文名 ⇒ 报告里直接显示英文键名。
 *
 * 覆盖：
 *   A. 平台识别 —— 两条地址都判为 xhs
 *   B. 注入覆盖 —— manifest 同时 match 两域、公共组件完整、host_permissions 到位
 *   C. 页面分类 —— 具体路径键先于域级键，逐条 URL 落到正确键
 *      （含两个中控台入口：pgy /commerce/redlive/live_center_control 与 ark /live_center_control）
 *   D. 后台支持域 —— isHostPermittedUrl 对两域为真，且不误放行其它域
 *   E. 诊断可读性 —— 五个键都有中文名
 *   F. 判据唯一性 —— 五个中控台功能都只认页面键，不许各自写死域名
 *
 * 用法：node scripts/自测-小红书页面接入.js  （退出码 0 = 全绿）
 * ============================================================
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert/strict');

const ROOT = path.join(__dirname, '..');
const FLAGS_PATH = path.join(ROOT, 'src/content/flags.js');
const MANIFEST_PATH = path.join(ROOT, 'manifest.json');
const SW_PATH = path.join(ROOT, 'src/background/service-worker.js');
const DIAG_PATH = path.join(ROOT, 'src/content/diag.js');

const flagsCode = fs.readFileSync(FLAGS_PATH, 'utf8');
const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
const swCode = fs.readFileSync(SW_PATH, 'utf8');
const diagCode = fs.readFileSync(DIAG_PATH, 'utf8');

let pass = 0;
function ok(name) { pass++; console.log('  ✓ ' + name); }

/** 按函数名从源码里抠出整段（含嵌套大括号） */
function sliceFn(code, name) {
  const start = code.indexOf('function ' + name + '(');
  assert.ok(start > 0, '源码里没找到 ' + name);
  let depth = 0, opened = false;
  for (let i = start; i < code.length; i++) {
    if (code[i] === '{') { depth++; opened = true; }
    else if (code[i] === '}') { depth--; if (opened && depth === 0) return code.slice(start, i + 1); }
  }
  throw new Error(name + ' 没有闭合');
}

/** 按变量名抠出 `var NAME = ...;`（括号配平，对象/数组/正则都能处理） */
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

/* ---------------- 垫片：只求值判定所需的纯数据与函数 ---------------- */
const ctx = vm.createContext({ URL: URL, location: { href: '' }, console: { log() {}, warn() {} } });
[
  sliceVar(flagsCode, 'DYC_PLAT_DY_URL_RE'),
  sliceVar(flagsCode, 'DYC_PAGE_PATTERNS'),
  sliceVar(flagsCode, 'DYC_PLATFORMS'),
  sliceVar(flagsCode, 'DYC_FLAG_GROUPS'),
  sliceFn(flagsCode, 'dycDetectPlatform'),
  sliceFn(flagsCode, 'dycPlatformGroups'),
  sliceFn(swCode, 'isHostPermittedUrl'),
  sliceVar(diagCode, 'KIND_CN')
].forEach((src) => vm.runInContext(src, ctx));

const CTRL_URL = 'https://pgy.xiaohongshu.com/commerce/redlive/live_center_control';
/* 店播一体号的中控台（2026-11-17 夜用户给的第二条中控台入口）：
 *   与 pgy 中控台是同一套 redlive 微前端，功能必须直接生效 —— 不另开页面键。 */
const ARK_CTRL_URL = 'https://ark.xiaohongshu.com/live_center_control';
const ARK_URL = 'https://ark.xiaohongshu.com/app-item/list/shelf';
const ARK_RETURN_URL = 'https://ark.xiaohongshu.com/app-order/logistics/multiaddress/edit/1198685';

console.log('A. 平台识别');
assert.equal(ctx.dycDetectPlatform(CTRL_URL), 'xhs', '中控台应判为小红书');
assert.equal(ctx.dycDetectPlatform(ARK_URL), 'xhs', '千帆商品列表应判为小红书');
ok('两条地址都归到小红书（弹窗切平台、作用页提示同一真源）');

const xhsPlat = ctx.DYC_PLATFORMS.find((p) => p.id === 'xhs');
assert.ok(xhsPlat, '平台表里没有 xhs');
assert.equal(xhsPlat.status, '已支持', '小红书状态应已从「待接入」改为「已支持」');
assert.ok(Array.isArray(xhsPlat.groups) && xhsPlat.groups.length > 0, '小红书必须认领至少一个分组');
xhsPlat.groups.forEach((gid) => {
  assert.ok(ctx.DYC_FLAG_GROUPS.some((g) => g.id === gid), '分组表里没有 ' + gid);
});
assert.equal(ctx.dycPlatformGroups('xhs').length, xhsPlat.groups.length, '分组反查与平台表必须一致');
ok('平台状态「已支持」，且认领的分组都真实存在（无空认领）');

console.log('B. 注入覆盖');
const XHS_HOSTS = ['https://pgy.xiaohongshu.com/*', 'https://ark.xiaohongshu.com/*'];
XHS_HOSTS.forEach((h) => {
  assert.ok(manifest.host_permissions.includes(h), 'host_permissions 缺 ' + h);
});
ok('host_permissions 覆盖两个子域（否则结构探针注入不了）');

const bizEntries = (manifest.content_scripts || []).filter((cs) => cs.world !== 'MAIN');
const xhsEntry = bizEntries.find((cs) => XHS_HOSTS.every((h) => (cs.matches || []).includes(h)));
assert.ok(xhsEntry, '没有一条业务条目同时 match 两个小红书子域');
['flags.js', 'diag.js', 'dialog.js', 'debug-panel.js'].forEach((f) => {
  assert.ok((xhsEntry.js || []).some((p) => p.endsWith(f)), '业务条目缺公共组件 ' + f);
});
assert.ok((xhsEntry.js || []).some((p) => p.endsWith('anchor.js')), '业务条目缺左下角标记 anchor.js');
assert.ok((xhsEntry.css || []).some((p) => p.endsWith('msgbox.css')), '业务条目缺消息盒子样式');
ok('业务条目同时覆盖两域，且标记 / 诊断 / 消息 / 调试面板组件齐全');

// 兜底条目必须把这两个域写进 exclude，否则公共组件会被注入两遍
const fallback = bizEntries.find((cs) => (cs.js || []).length === 0 || JSON.stringify(cs.js) === JSON.stringify(['src/content/flags.js', 'src/content/diag.js', 'src/content/dialog.js', 'src/content/debug-panel.js']));
if (fallback && fallback.exclude_matches) {
  XHS_HOSTS.forEach((h) => {
    assert.ok(!(fallback.matches || []).includes(h) || fallback.exclude_matches.includes(h),
      '兜底条目重复覆盖 ' + h);
  });
  ok('公共组件兜底不重复注入（要么不含、要么已排除）');
}

console.log('C. 页面分类');
const keys = Object.keys(ctx.DYC_PAGE_PATTERNS);
function idx(k) { return keys.indexOf(k); }
assert.ok(idx('xhsCtrl') >= 0 && idx('xhsArkList') >= 0, '缺具体路径键');
assert.ok(idx('xhsCtrl') < idx('xhsPgy'), 'xhsCtrl 必须排在 xhsPgy 之前（先匹配先返回）');
assert.ok(idx('xhsArkList') < idx('xhsArk'), 'xhsArkList 必须排在 xhsArk 之前');
assert.ok(idx('xhsArkReturn') < idx('xhsArk'), 'xhsArkReturn 必须排在 xhsArk 之前');
assert.ok(idx('xhsPgy') < idx('xhsAll') && idx('xhsArk') < idx('xhsAll'), '域级键必须排在 xhsAll 之前');
ok('页面键声明顺序：具体路径 → 子域 → 整域兜底');

function pageKind(url) {
  for (const k of keys) {
    if (k === 'debugTarget') continue;
    const p = ctx.DYC_PAGE_PATTERNS[k];
    if (p && p.test && p.test(url)) return k;
  }
  return 'other';
}
assert.equal(pageKind(CTRL_URL), 'xhsCtrl', '中控台应落 xhsCtrl');
assert.equal(pageKind(CTRL_URL + '?from=menu'), 'xhsCtrl', '蒲公英中控台带 query 仍应落 xhsCtrl');
assert.equal(pageKind(CTRL_URL + '/'), 'xhsCtrl', '蒲公英中控台带尾斜杠仍应落 xhsCtrl');
assert.equal(pageKind(CTRL_URL + '_backup'), 'xhsPgy', '相近路径仍应落 xhsPgy');
assert.equal(pageKind('https://pgy.xiaohongshu.com/commerce/redlive/live_screen/operation?from=menu'),
  'xhsReplayPage', '运营版应落独立回放页键');
assert.equal(pageKind('https://pgy.xiaohongshu.com/commerce/redlive/live_screen/operation_preview'),
  'xhsPgy', '相近路径不应启用运营版回放');
/* 两个中控台入口都必须落 xhsCtrl：这是「直接兼容」的唯一开关点，
 *   落错键 ⇒ 五个中控台功能全部静默不生效（开关开着、页面没变化）。 */
assert.equal(pageKind(ARK_CTRL_URL), 'xhsCtrl', 'ark 店播中控台应落 xhsCtrl');
assert.equal(pageKind(ARK_CTRL_URL + '?from=menu'), 'xhsCtrl', 'ark 中控台带 query 仍应落 xhsCtrl');
assert.equal(pageKind(ARK_CTRL_URL + '/'), 'xhsCtrl', 'ark 中控台带尾斜杠仍应落 xhsCtrl');
assert.equal(pageKind('https://ark.xiaohongshu.com/live_center_control_backup'), 'xhsArk',
  '前缀相近的其它路径不许被中控台吃掉（作用域别写宽）');
assert.equal(pageKind('https://pgy.xiaohongshu.com/commerce/other/page'), 'xhsPgy', 'pgy 其它页应落 xhsPgy');
assert.equal(pageKind(ARK_URL), 'xhsArkList', '千帆商品列表应落 xhsArkList');
assert.equal(pageKind(ARK_RETURN_URL), 'xhsArkReturn', '千帆退货策略页应落 xhsArkReturn');
assert.equal(pageKind('https://ark.xiaohongshu.com/app-order/logistics/list'), 'xhsArk',
  '退货策略以外的订单页仍落 xhsArk（别把作用域写宽）');
assert.equal(pageKind('https://ark.xiaohongshu.com/shop/detail'), 'xhsArk', 'ark 其它页应落 xhsArk');
assert.equal(pageKind('https://www.xiaohongshu.com/explore'), 'xhsAll', '其它子域应落 xhsAll');
ok('两个中控台及其相近路径、直播大屏和其他小红书页面均正确分类');

console.log('D. 后台支持域');
XHS_HOSTS.map((h) => h.replace('/*', '/x')).forEach((u) => {
  assert.equal(ctx.isHostPermittedUrl(u), true, 'isHostPermittedUrl 应放行 ' + u);
});
['https://fxg.jinritemai.com/ffa/g/list', 'https://store.weixin.qq.com/shop'].forEach((u) => {
  assert.equal(ctx.isHostPermittedUrl(u), true, '既有站点不受影响：' + u);
});
['https://evil-xiaohongshu.com/x', 'https://xiaohongshu.com.evil.com/x'].forEach((u) => {
  assert.equal(ctx.isHostPermittedUrl(u), false, '仿冒域名不许放行：' + u);
});
ok('两域放行、抖店/微信不受影响、仿冒域名不放行');

console.log('E. 诊断可读性');
['xhsCtrl', 'xhsArkList', 'xhsArkReturn', 'xhsReplayPage', 'xhsPgy', 'xhsArk', 'xhsAll'].forEach((k) => {
  assert.ok(ctx.KIND_CN[k], 'diag.js 的中文名表缺 ' + k);
});
ok('小红书页面键都有中文名（报告里不会露英文键名）');

console.log('F. 判据唯一性');
/* 五个中控台功能都读同一个页面键（pat.xhsCtrl）：加中控台入口只改 flags.js 一处。
 *   谁在功能里另写域名判定，两处就会漂移 —— 一边生效一边不生效，而且不报错。 */
['src/live/xhs-name-wrap.js', 'src/live/xhs-copy-code.js', 'src/live/xhs-scroll.js',
 'src/live/xhs-locate.js', 'src/content/cursor-fix.js'].forEach((rel) => {
  const code = fs.readFileSync(path.join(ROOT, rel), 'utf8');
  /* 2026-11-21：猫爪扩到小红书全域后，判据改走 pagePat()（内部仍是
   * DYC_PAGE_PATTERNS），源码里不再出现 `pat.xhsCtrl` 字面量 —— 两种写法都算合格，
   * 关键是不能写死域名。 */
  assert.ok(/pat\.xhsCtrl|pagePat\('xhsCtrl'\)/.test(code),
    rel + ' 没走 DYC_PAGE_PATTERNS.xhsCtrl 判定');
  assert.ok(!/pgy\.xiaohongshu|ark\.xiaohongshu/.test(code),
    rel + ' 里写死了域名 —— 新增中控台入口会漏掉它，判定只能认页面键');
});
ok('五个中控台功能共用同一判据，无域名硬编码（加入口只改一处）');

console.log('\n小红书页面接入自测：' + pass + '/6 组全部通过。');
