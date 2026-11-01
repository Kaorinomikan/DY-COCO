'use strict';
// 浮动搜索圆钮的名字（2026-10-29 反馈 #125）
// 只验圆钮两处：aria-label 与悬停气泡都用「全能搜索」；
// 常量本身也从源码取值，避免自测里自己写死一句话把源码写错盖过去。
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const assert = require('node:assert/strict');

const code = fs.readFileSync(path.join(__dirname, '../src/live/search.js'), 'utf8');

const labelMatch = /const FAB_LABEL = '([^']*)';/.exec(code);
assert.ok(labelMatch, '源码里没找到 FAB_LABEL 常量');
const FAB_LABEL = labelMatch[1];
assert.equal(FAB_LABEL, '全能搜索', '圆钮名字必须是「全能搜索」');

const start = code.indexOf('function buildFab(');
assert.ok(start > 0, '源码里没找到 buildFab，结构变了');
// 按大括号配平截取函数体（buildFab 后面紧跟的不是分节注释，不能按标记切）
let depth = 0, end = -1, opened = false;
for (let i = start; i < code.length; i++) {
  if (code[i] === '{') { depth++; opened = true; }
  else if (code[i] === '}') {
    depth--;
    if (opened && depth === 0) { end = i + 1; break; }
  }
}
assert.ok(end > start, 'buildFab 的函数体没有闭合，源码结构异常');
const buildFabSource = code.slice(start, end);

function makeEl(tag) {
  return {
    tagName: tag, attrs: {}, innerHTML: '', id: '',
    listeners: {},
    setAttribute(k, v) { this.attrs[k] = v; },
    addEventListener(type, fn) { (this.listeners[type] = this.listeners[type] || []).push(fn); }
  };
}

const appended = [];
const context = vm.createContext({
  document: {
    createElement: makeEl,
    body: { appendChild(el) { appended.push(el); } }
  },
  ensureUiStyle() {},
  FAB_LABEL,
  fabEl: null,
  uiState: 'hidden',
  expandPill() {},
  onWinResize: null,
  window: { addEventListener() {}, removeEventListener() {} },
  location: {},
  console
});
vm.runInContext(buildFabSource, context);
context.buildFab();

const fab = appended[0];
assert.ok(fab, 'buildFab 应把按钮挂到 body');
assert.equal(fab.attrs['aria-label'], '全能搜索', '圆钮无障碍名字应为「全能搜索」');
assert.match(fab.innerHTML, />全能搜索<\/span>/, '悬停气泡应显示「全能搜索」');

// 正文里不该再出现「圆钮沿用能力描述」这种残留写法
assert.equal(/aria-label', PH_OURS/.test(code), false, '圆钮 aria-label 不应再挂 PH_OURS');
assert.equal(/dyc-tip">' \+ PH_OURS/.test(code), false, '圆钮气泡不应再挂 PH_OURS');

// 输入框语境的提示语保持能力描述（用户只要求改圆钮，别的入口不动）
assert.equal(/input\.placeholder = PH_OURS/.test(code), true, '胶囊 placeholder 应保持 PH_OURS');

console.log('搜索圆钮文案自测：6/6 通过；圆钮两处都用「全能搜索」，输入框提示语未被牵连。');
