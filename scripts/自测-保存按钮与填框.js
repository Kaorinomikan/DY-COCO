'use strict';
// 保存按钮识别与填框副作用（2026-10-29 现货预售混合商品复现）
//   · 填框的 focus 不许把页面滚走
//   · 保存按钮要认得出 <a>/<span> 老式按钮，危险词与禁用态一律排除
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const assert = require('node:assert/strict');

const code = fs.readFileSync(path.join(__dirname, '../src/content/clear-stock.js'), 'utf8');

function sliceFn(name) {
  const start = code.indexOf('function ' + name + '(');
  assert.ok(start > 0, '源码里没找到 ' + name);
  let depth = 0, opened = false;
  for (let i = start; i < code.length; i++) {
    if (code[i] === '{') { depth++; opened = true; }
    else if (code[i] === '}') { depth--; if (opened && depth === 0) return code.slice(start, i + 1); }
  }
  throw new Error(name + ' 没有闭合');
}

const logs = [];
const events = [];
let focusArg;
const proto = {};
Object.defineProperty(proto, 'value', {
  set(v) { this._val = v; }, get() { return this._val; }, configurable: true
});

class FakeEvent {
  constructor(type, opts) { this.type = type; this.bubbles = !!(opts && opts.bubbles); }
}

const context = vm.createContext({
  window: { HTMLInputElement: { prototype: proto } },
  Event: FakeEvent,
  debugLog: (m) => logs.push(m),
  console: { log() {}, warn() {} },
  document: {},
  normalize: (s) => (s || '').replace(/\s+/g, ' ').trim()
});

// ---- ① 填框：focus 带 preventScroll，事件照发 ----
vm.runInContext(sliceFn('setInputValue'), context);
const input = Object.create(proto);
input.focus = (opts) => { focusArg = opts; };
input.dispatchEvent = (ev) => events.push(ev.type);
input.blur = () => { events.push('blur'); };
input.value = '5';
context.setInputValue(input, '0');
// 注意：跨 vm 上下文的对象原型不同，deepEqual 会误报，只比字段值
assert.equal(focusArg && focusArg.preventScroll, true, 'focus 必须阻止滚动');
assert.equal(input._val, '0', '值应经原生 setter 写入');
assert.ok(events.includes('input') && events.includes('change'), 'input/change 都要发');

// ---- ② 保存按钮：老式 <a> 按钮、长文案、禁用与危险词 ----
function makeBtn(text, opts) {
  const o = opts || {};
  return {
    textContent: text,
    className: o.cls || '',
    disabled: o.disabled,
    attrs: o.attrs || {},
    clicked: false,
    getAttribute(k) { return this.attrs[k] || null; },
    getBoundingClientRect: () => ({ left: o.left || 0, top: o.top || 0 }),
    closest: () => (o.footer ? { className: 'footer-x' } : null),
    scrollIntoView() {},
    click() { this.clicked = true; }
  };
}

const root = { querySelectorAll: () => [] };
let pool = [];
root.querySelectorAll = () => pool;

vm.runInContext(sliceFn('clickLikeUser'), context);
vm.runInContext(sliceFn('findActionButtonsByText'), context);
vm.runInContext(sliceFn('clickSaveButton'), context);

// 老式 <a class="btn"> 的「保存」
const saveA = makeBtn('保存', { cls: 'optimus_btn' });
pool = [makeBtn('编辑记录', {}), saveA];
assert.equal(context.clickSaveButton(root), true, '应认出 <a> 里的保存');
assert.equal(saveA.clicked, true);

// 长文案「保存并继续编辑」也要认（旧上限 10 字会漏掉）
const longBtn = makeBtn('保存并继续编辑');
pool = [longBtn];
assert.equal(context.clickSaveButton(root), true, '长文案保存按钮也要认');

// 禁用态（含 aria-disabled 的 <a>）不可点
const dis = makeBtn('保存', { attrs: { 'aria-disabled': 'true' } });
pool = [dis];
assert.equal(context.clickSaveButton(root), false, 'aria-disabled 视为禁用');
assert.equal(dis.clicked, false, '禁用按钮不许点');

// 危险词：即便带「确认」也不许在清零流程里点
const danger = makeBtn('确认删除');
pool = [danger];
assert.equal(context.clickSaveButton(root), false, '确认删除不能当成保存');

// 只有危险按钮时返回 false 且把文案写进诊断
assert.match(logs.join(' | '), /按钮1:/);

// 选择器要覆盖任何标签上的 btn 类（optimus_fems-btn 这类按钮不一定是 <button>）
assert.ok(/\[class\*="btn"\]/.test(code), '选择器应覆盖任何标签上的 btn 类');
assert.ok(/\[role="button"\]/.test(code), '选择器应覆盖 role=button');
// 还要有「按文字找」的兜底：既不是 button 也不带 btn 类的面板按钮
assert.ok(/function findActionButtonsByText/.test(code), '缺少按文字找按钮的兜底');

// 清单要分块写：单条轨迹上限 140 字，整串塞一条会被截掉尾巴
assert.ok(/line\.length \+ d\.length \+ 3/.test(code), '按钮清单应分块输出');
assert.ok(!/按钮清单:/.test(code), '旧的整串清单写法应已移除');

console.log('保存按钮与填框自测：11/11 通过；focus 不滚动，老式按钮能认，危险词与禁用态不点。');
