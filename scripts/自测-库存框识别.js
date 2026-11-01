'use strict';
// 库存框识别（2026-10-29 第三轮收紧）
// 上一版只按「往上 6 层祖先文本里有『库存』」判断 —— 表格页的祖先必然含表头
// 「总库存」，于是筛选栏里那些空框全被算成库存框，被一口气填成 0。
// 这里锁住新的三档：位置（筛选/搜索/工具栏/表头一律不算）、取值、旁证。
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const assert = require('node:assert/strict');

const code = fs.readFileSync(path.join(__dirname, '../src/content/clear-stock.js'), 'utf8');
const start = code.indexOf('function findStockInputs(');
assert.ok(start > 0, '源码里没找到 findStockInputs');
let depth = 0, opened = false, end = -1;
for (let i = start; i < code.length; i++) {
  if (code[i] === '{') { depth++; opened = true; }
  else if (code[i] === '}') { depth--; if (opened && depth === 0) { end = i + 1; break; } }
}
assert.ok(end > start, 'findStockInputs 没有闭合');

let pool = [];
const context = vm.createContext({
  document: { querySelectorAll: () => pool }
});
vm.runInContext(code.slice(start, end), context);

function box(text, cls) {
  return { textContent: text, className: cls || '', parentElement: null };
}

function input(opts) {
  const o = opts || {};
  return {
    tagName: 'INPUT',
    disabled: !!o.disabled,
    readOnly: !!o.readOnly,
    value: o.value === undefined ? '' : o.value,
    placeholder: o.ph || '',
    id: o.id || '',
    className: o.cls || '',
    parentElement: o.parent || null,
    getAttribute(k) { return (o.attrs && o.attrs[k] !== undefined) ? o.attrs[k] : null; },
    closest() { return o.offArea ? { hit: true } : null; }
  };
}

// ① 筛选栏里的空框：位置这一档就该挡掉（哪怕表格祖先里有「总库存」）
const filterBox = input({ offArea: true, parent: box('总库存 396 筛选 商品名 库存') });
// ② 空值、附近也没有库存字样 ⇒ 不认
const strayBox = input({ parent: box('商品名 价格 销量', 'row-a') });
// ③ 空值，但小容器里有「库存」⇒ 认
const emptyStock = input({ parent: box('库存', 'cell-b') });
// ④ 有数字的框、旁边没字样 ⇒ 认（库存框本来就带着当前值）
const numericStock = input({ value: '396', parent: box('规格 颜色', 'cell-c') });
// ⑤ 禁用 / 只读
const disabledBox = input({ disabled: true, value: '5' });
const readOnlyBox = input({ readOnly: true, value: '5' });
// ⑥ 搜索框
const searchBox = input({ ph: '请输入商品名称', value: '' });
// ⑦ 非数字值
const textBox = input({ value: 'abc' });
// ⑧ 大容器里有「库存」，但空值又离得很远（祖先文本超 80 字，不算旁证）
const farBox = input({ parent: box('库'.repeat(1) + '存'.repeat(1) + ' 商品'.repeat(80), 'big') });

pool = [filterBox, strayBox, emptyStock, numericStock, disabledBox, readOnlyBox, searchBox, textBox, farBox];
const got = context.findStockInputs();

assert.equal(got.includes(filterBox), false, '筛选栏里的框不算库存框');
assert.equal(got.includes(strayBox), false, '空值 + 附近没库存字样 ⇒ 不认');
assert.ok(got.includes(emptyStock), '空值但旁边写着「库存」⇒ 认');
assert.ok(got.includes(numericStock), '带数字的库存框要认');
assert.equal(got.includes(disabledBox), false, '禁用框不碰');
assert.equal(got.includes(readOnlyBox), false, '只读框不碰');
assert.equal(got.includes(searchBox), false, '搜索框不碰');
assert.equal(got.includes(textBox), false, '非数字值不碰（可能是名称类输入框）');
assert.equal(got.includes(farBox), false, '整张大容器里的「库存」不能当旁证');
assert.equal(got.length, 2, '只应认出那两个真库存框');

console.log('库存框识别自测：10/10 通过；筛选栏与远处文字不再冒充库存框。');
