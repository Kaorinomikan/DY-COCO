'use strict';
// 逐个填 0（2026-10-29 #124 时效批次）：只动该动的框，宁可不做也不改错数据
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const assert = require('node:assert/strict');

const code = fs.readFileSync(path.join(__dirname, '../src/content/clear-stock.js'), 'utf8');
const start = code.indexOf('function fillStockInputsZero(');
assert.ok(start > 0, '源码里没找到 fillStockInputsZero');
let depth = 0, end = -1, opened = false;
for (let i = start; i < code.length; i++) {
  if (code[i] === '{') { depth++; opened = true; }
  else if (code[i] === '}') { depth--; if (opened && depth === 0) { end = i + 1; break; } }
}
assert.ok(end > start, 'fillStockInputsZero 没有闭合');

const logs = [];
const written = [];
const context = vm.createContext({
  debugLog: (m) => logs.push(m),
  setInputValue: (input, value) => { input.value = value; written.push(input); }
});
vm.runInContext(code.slice(start, end), context);

function makeInput(value, attrs) {
  return {
    value, isConnected: true,
    getAttribute(k) { return (attrs && attrs[k]) || null; }
  };
}

// ① 三个普通库存框都填 0
let list = [makeInput('5'), makeInput('12'), makeInput('3')];
assert.equal(context.fillStockInputsZero(list), 3, '三个框都该填 0');
assert.deepEqual(list.map((x) => x.value), ['0', '0', '0']);

// ② 已经是 0 的不重复写
written.length = 0;
list = [makeInput('0'), makeInput('8')];
assert.equal(context.fillStockInputsZero(list), 1, '已是 0 的不该重复写');
assert.equal(written.length, 1);

// ③ 自带「到货时间」标签的框不能动
written.length = 0;
list = [makeInput('5', { placeholder: '到货时间' }), makeInput('7', { 'aria-label': '库存数量' }), makeInput('2', { title: '生产日期' })];
assert.equal(context.fillStockInputsZero(list), 1, '时间和日期类框要跳过');
assert.equal(list[0].value, '5', '到货时间框不该被改');
assert.equal(list[1].value, '0', '库存框应被填 0');
assert.equal(list[2].value, '2', '生产日期框不该被改');

// ④ 超过 20 个框直接放弃（超出人能手核的范围）
written.length = 0;
list = Array.from({ length: 21 }, () => makeInput('4'));
assert.equal(context.fillStockInputsZero(list), 0, '超过 20 个应放弃');
assert.equal(written.length, 0, '放弃时一个都不许动');
assert.match(logs.join(' | '), /超过 20 个/);

// ⑤ 空数组 / 非数组：静默返回 0
assert.equal(context.fillStockInputsZero([]), 0);
assert.equal(context.fillStockInputsZero(null), 0);

// ⑥ 已脱离文档的框跳过
written.length = 0;
const gone = makeInput('9');
gone.isConnected = false;
assert.equal(context.fillStockInputsZero([gone, makeInput('6')]), 1, '脱离文档的框不该动');

console.log('逐个填零自测：9/9 通过；时间/日期框不碰，超 20 个放弃，已是 0 不重复写。');
