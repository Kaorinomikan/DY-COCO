/**
 * 中控台作用域（2026-11-05 用户报：浮动按钮跑到中控台外面还在）
 * ============================================================
 * 被测文件：src/content/flags.js（判定 + 订阅）、
 *           src/live/{auto-loop-lecture,lucky-bag,auto-refresh,cart-paste,search}.js（接入）
 *
 * 现象：中控台是 Garfish 微前端，pushState 换路由**不重载 document**。
 *   从 /live/control 切到橱窗商品管理（buyin…/shopwindow/goods-list）后，
 *   福袋圆钮、自动刷新灯、循环讲解圆钮、粘贴加车按钮都还在，
 *   循环讲解甚至把橱窗商品表格当成小黄车行在扫。
 *
 * 覆盖：
 *   A. 判定口径 —— 只认两个中控台入口；别的抖店/罗盘/微店页面一律 false
 *   B. 订阅行为 —— 首次立即回调；同一作用域不重复回调；翻转才回调；单订阅抛错不影响别人
 *   C. 模块接入 —— 五个中控台专属模块都必须注册作用域守卫（防以后新增模块漏接或被人改回去）
 *   D. 福袋的开关回声 —— 不在中控台时改开关，不许把圆钮又建回来
 *
 * 做法沿用 scripts/自测-小黄车自动刷新.js：按函数名抠源码 → 最小垫片上求值 → 断言。
 * 用法：node scripts/自测-中控台作用域.js  （退出码 0 = 全绿）
 * ============================================================
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert/strict');

const ROOT = path.join(__dirname, '..');
const FLAGS = path.join(ROOT, 'src/content/flags.js');
const flagsCode = fs.readFileSync(FLAGS, 'utf8');

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

/* ---------------- 垫片 ---------------- */
const intervals = [];
const win = { addEventListener() {}, __DYC_LIVE_SCOPE__: null };
const ctx = vm.createContext({
  window: win,
  location: { href: 'https://buyin.jinritemai.com/dashboard/live/control' },
  setInterval(fn) { intervals.push(fn); return intervals.length; },
  console: { log() {}, warn() {} }
});
vm.runInContext(sliceFn(flagsCode, 'dycIsLiveControl'), ctx);
vm.runInContext(sliceFn(flagsCode, 'dycWatchLiveScope'), ctx);

console.log('A. 判定口径');
{
  const yes = [
    'https://buyin.jinritemai.com/dashboard/live/control',
    'https://buyin.jinritemai.com/dashboard/live/control?foo=1',
    'https://buyin.jinritemai.com/dashboard/live/control/sub',
    'https://fxg.jinritemai.com/ffa/content-tool/live/control',
    'https://fxg.jinritemai.com/ffa/content-tool/live/control?room_id=9'
  ];
  yes.forEach((u) => assert.equal(ctx.dycIsLiveControl(u), true, '应当算中控台：' + u));
  ok('两个中控台入口（含 query / 子路径）都认');

  const no = [
    'https://buyin.jinritemai.com/dashboard/shopwindow/goods-list?pre_universal_page_params_id=x',
    'https://buyin.jinritemai.com/dashboard/live/data',
    'https://fxg.jinritemai.com/ffa/g/list',
    'https://compass.jinritemai.com/screen/live/123',
    'https://store.weixin.qq.com/shop/goods/list',
    'https://channels.weixin.qq.com/platform',
    'https://example.com/dashboard/live/control',
    ''
  ];
  no.forEach((u) => assert.equal(ctx.dycIsLiveControl(u), false, '不该算中控台：' + u));
  ok('橱窗商品页 / 罗盘大屏 / 微店 / 外站 / 空串 一律 false（本次现场那条 URL 在内）');

  /* 前缀口径刻意与 manifest 的 `…/live/control*` 一致：
   * 判定比 manifest 窄 ⇒ 明明注入了脚本却判定「不在中控台」，功能会静默消失。
   * 反过来放宽没有实际代价（平台上不存在 control 开头的其它路由）。 */
  assert.equal(ctx.dycIsLiveControl('https://buyin.jinritemai.com/dashboard/live/controlx'), true);
  ok('前缀口径与 manifest 的 control* 对齐（不把已注入的页面判成外部）');

  assert.equal(ctx.dycIsLiveControl(), true, '省略参数时应读 location.href');
  ctx.location.href = 'https://buyin.jinritemai.com/dashboard/shopwindow/goods-list';
  assert.equal(ctx.dycIsLiveControl(), false, '省略参数时应跟着 location 变');
  ok('省略参数读 location.href，且随路由实时变化');
  ctx.location.href = 'https://buyin.jinritemai.com/dashboard/live/control';
}

console.log('B. 订阅行为');
{
  const calls = [];
  ctx.dycWatchLiveScope((v) => calls.push(v));
  assert.deepEqual(calls, [true], '首次必须立即回调一次');
  ok('首次立即回调当前作用域');

  assert.equal(intervals.length, 1, '只应挂一个轮询（多模块共用同一份状态）');
  intervals[0]();
  assert.deepEqual(calls, [true], '同一作用域重复评估不许重复回调');
  ok('同一作用域重复评估不重复回调（否则每 500ms 就重建一次 UI）');

  ctx.location.href = 'https://buyin.jinritemai.com/dashboard/shopwindow/goods-list';
  intervals[0]();
  intervals[0]();
  assert.deepEqual(calls, [true, false], '离开中控台只回调一次');
  ok('离开中控台只回调一次');

  ctx.location.href = 'https://buyin.jinritemai.com/dashboard/live/control';
  intervals[0]();
  assert.deepEqual(calls, [true, false, true], '回到中控台要回调');
  ok('回到中控台回调一次');

  const other = [];
  ctx.dycWatchLiveScope(() => { throw new Error('故意炸'); });   // 自己首拍就炸
  ctx.dycWatchLiveScope((v) => other.push(v));
  assert.deepEqual(other, [true], '新订阅只收到自己的首拍（不许把旧订阅再通知一遍）');
  ok('后注册的订阅只收到自己的首拍，不惊动前面的人');

  ctx.location.href = 'https://buyin.jinritemai.com/dashboard/shopwindow/goods-list';
  intervals[0]();
  assert.deepEqual(other, [true, false], '前面那个订阅抛错后，后面的订阅仍要收到通知');
  ok('一个订阅抛错不影响其它订阅收到通知');
}

console.log('C. 模块接入（防漏接 / 防改回去）');
{
  const mods = [
    'src/live/auto-loop-lecture.js',
    'src/live/lucky-bag.js',
    'src/live/auto-refresh.js',
    'src/live/search.js'
  ];
  mods.forEach((rel) => {
    const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    assert.ok(/dycWatchLiveScope\s*\(/.test(src), rel + ' 没有注册中控台作用域守卫');
  });
  ok('四个跟中控台走的模块都注册了守卫（循环讲解 / 福袋 / 自动刷新 / 全能搜索）');

  /* 粘贴加车是**例外**：用户 2026-11-05 明确「这个页面（橱窗商品管理）
   * 允许粘贴加车」。它跟着 pushState 留在页面上是预期行为，不是残留 ——
   * 以后有人「顺手统一收掉」时，这条会红。 */
  const cart = fs.readFileSync(path.join(ROOT, 'src/live/cart-paste.js'), 'utf8');
  assert.ok(!/dycWatchLiveScope\s*\(/.test(cart),
    '粘贴加车不许接中控台作用域守卫：用户明确该按钮在橱窗商品页要能用');
  assert.ok(/flags\.cartPaste\s*!==\s*false/.test(cart), '粘贴加车的开关逻辑不见了');
  ok('粘贴加车不受作用域约束（用户指定例外），开关照常生效');

  const bag = fs.readFileSync(path.join(ROOT, 'src/live/lucky-bag.js'), 'utf8');
  assert.ok(/scopeSuspended/.test(bag), '福袋缺少离开作用域的挂起标记');
  const applyAt = bag.indexOf('function applyFlags(');
  const guardAt = bag.indexOf('if (scopeSuspended)', applyAt);
  const badgeAt = bag.indexOf('startBadge();', applyAt);
  assert.ok(applyAt > 0 && guardAt > applyAt, 'applyFlags 里没有作用域短路');
  assert.ok(badgeAt > guardAt, '作用域短路必须排在 startBadge 之前，否则开关回声会把圆钮建回来');
  ok('福袋：不在中控台时开关回声不会重建圆钮');
}

console.log('\n全绿：' + pass + ' 组');
