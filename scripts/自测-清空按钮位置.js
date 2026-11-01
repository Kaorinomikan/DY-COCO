'use strict';
// 清空库存按钮的位置口径（2026-10-29 用户定）
// 用户原话：「清空按钮靠右对齐，放在库存数字的下面」。
// 位置全部交给 CSS：槽位是文档流里的普通块级 div，靠单元格的 text-align 对齐，
// 不算任何坐标 —— 列宽变了、页面缩放都不该让按钮跑位。
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

const css = fs.readFileSync(path.join(__dirname, '../src/content/style.css'), 'utf8');

function ruleOf(selector) {
  const i = css.indexOf(selector + ' {');
  assert.ok(i > 0, '样式里没找到 ' + selector + ' 规则');
  const j = css.indexOf('}', i);
  assert.ok(j > i, selector + ' 规则没有闭合');
  return css.slice(i + selector.length, j);
}

const slot = ruleOf('.dyb-clear-slot');
const btn = ruleOf('.dyb-clear-btn');

// ① 靠右对齐：与上面的库存数字（本列右对齐）落在同一条右边缘上
assert.ok(/text-align:\s*right/.test(slot), '槽位必须靠右对齐');
// ② 防回退：居中会让按钮偏到数字左下方，看着不像挂在它下面
assert.ok(!/text-align:\s*center/.test(slot), '槽位不许再改回居中');
// ③ 与数字留出缝，不压字
const mt = slot.match(/margin-top:\s*(\d+)px/);
assert.ok(mt && Number(mt[1]) > 0, '槽位要有上外边距，按钮不能贴着数字');
// ④ 走文档流：绝对定位会被平台的 transform 祖先劫走包含块（#73 的教训）
assert.ok(!/position:\s*absolute/.test(slot), '槽位不许用绝对定位');
assert.ok(!/[\s;{](left|right|top|bottom):\s*-?\d/.test(slot), '槽位不许写坐标');
// ⑤ 按钮定宽：反馈时文字换成勾/叉图标，宽度不锁会让同一列按钮左右跳
assert.ok(/width:\s*70px/.test(btn), '按钮宽度必须锁 70px');
// ⑥ 反馈态不能把对齐改掉（勾/叉期间仍要贴在数字右下方）
assert.ok(!/text-align/.test(ruleOf('.dyb-clear-btn.dyc-clear-ok')), '反馈态不许改对齐');

console.log('清空按钮位置自测：6/6 通过；槽位靠右对齐、走文档流、按钮定宽 70px。');
