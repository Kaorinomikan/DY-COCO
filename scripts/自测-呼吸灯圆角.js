/**
 * 【定位】呼吸灯圆角跟随自检(2026-10-20 · 用户反馈「小直角很突兀」)
 * ============================================================
 * 需求:呼吸灯框改圆角,弧度跟小黄车商品框一样。
 * 实现:glowRadiusOf(行卡) 运行时读平台卡片实际 borderRadius 跟随,
 *       读不到兜底 8px —— 不硬编码猜数。
 *
 * 跑法:node scripts/自测-呼吸灯圆角.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const LOCATE = fs.readFileSync(path.join(ROOT, 'src/live/locate.js'), 'utf8');

let pass = 0;
const fails = [];
function ok(name, cond, extra) {
  if (cond) { pass++; return; }
  fails.push(name + (extra ? '  → ' + extra : ''));
}

function sliceFn(src, header) {
  const i = src.indexOf(header);
  if (i < 0) throw new Error('找不到:' + header);
  let j = i, depth = 0;
  while (j < src.length) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}') { depth--; if (depth === 0) break; }
    j++;
  }
  return src.slice(i, j + 1);
}

/* ============ 静态:highlight 确实把圆角写上 overlay ============ */

const HIGHLIGHT = sliceFn(LOCATE, 'function highlight(');
ok('highlight 给 overlay 写 borderRadius(覆盖 class 的 4px 兜底)',
  HIGHLIGHT.indexOf('glow.style.borderRadius = glowRadiusOf(el)') !== -1);
ok('兜底值 8px(不再是 4px 小直角)', /return '8px'/.test(LOCATE));

/* ============ 行为:glowRadiusOf 四条路径 ============ */

const ctx = { console: console };
vm.createContext(ctx);
vm.runInContext(sliceFn(LOCATE, 'function glowRadiusOf(')
  + '\nthis.__g = glowRadiusOf;', ctx);
const g = ctx.__g;

const fakeEl = { tag: 'row' };
function withComputed(impl, fn) {
  const orig = global.getComputedStyle;
  global.getComputedStyle = impl;
  try { fn(); } finally { global.getComputedStyle = orig; }
}

// 注:glowRadiusOf 在 vm 沙箱里,沙箱的 getComputedStyle 需单独注入
vm.runInContext('this.__setCS = function (f) { getComputedStyle = f; };', ctx);

withComputed(function () { return { borderRadius: '12px' }; }, function () {
  vm.runInContext('this.__setCS(function () { return { borderRadius: "12px" }; });', ctx);
  ok('平台卡 12px → 呼吸灯跟随 12px', ctx.__g(fakeEl) === '12px',
    '实际:' + ctx.__g(fakeEl));
});

withComputed(function () { return { borderRadius: '0px' }; }, function () {
  vm.runInContext('this.__setCS(function () { return { borderRadius: "0px" }; });', ctx);
  ok('平台卡无圆角(0px) → 兜底 8px', ctx.__g(fakeEl) === '8px');
});

withComputed(function () { return { borderRadius: '' }; }, function () {
  vm.runInContext('this.__setCS(function () { return { borderRadius: "" }; });', ctx);
  ok('读出空串 → 兜底 8px', ctx.__g(fakeEl) === '8px');
});

withComputed(function () { throw new Error('内核异常'); }, function () {
  vm.runInContext('this.__setCS(function () { throw new Error("x"); });', ctx);
  ok('getComputedStyle 抛错 → 兜底 8px(不炸呼吸灯)', ctx.__g(fakeEl) === '8px');
});

withComputed(function () { return { borderRadius: '12px 12px 4px 4px' }; }, function () {
  vm.runInContext('this.__setCS(function () { return { borderRadius: "12px 12px 4px 4px" }; });', ctx);
  ok('多值圆角原样跟随(不裁剪)', ctx.__g(fakeEl) === '12px 12px 4px 4px');
});

/* ============ 汇总 ============ */

console.log('');
console.log('════════ 呼吸灯圆角跟随自检 ════════');
console.log('  通过 ' + pass + ' / ' + (pass + fails.length));
if (fails.length) {
  console.log('  ✗ 失败 ' + fails.length + ' 条:');
  fails.forEach(function (f) { console.log('    - ' + f); });
  process.exit(1);
} else {
  console.log('  ✓ 全部通过');
}
