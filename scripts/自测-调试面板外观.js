/** 调试面板：生产 DOM 构建、日志纯文本与旧内核样式隔离。 */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');
const source = fs.readFileSync(path.join(__dirname, '../src/content/debug-panel.js'), 'utf8');
const dom = new JSDOM('<!doctype html><body></body>');
const context = vm.createContext({ document: dom.window.document, console, Date });
function fn(name) {
  const match = source.match(new RegExp('  function ' + name + '\\([^]*?\\n  }\\n'));
  assert.ok(match, '找不到生产函数 ' + name);
  return match[0];
}
const css = source.match(/  var CSS = `([^]*?)`;/);
assert.ok(css);
vm.runInContext('var HOST_ID="dyb-debug-panel", shadow=null;' + css[0]
  + fn('scopedCss') + fn('buildHost') + fn('appendLogLine'), context);
const host = vm.runInContext('buildHost()', context);
dom.window.document.body.appendChild(host);
const root = host.shadowRoot;
assert.ok(root, '现代内核应隔离面板样式');
assert.equal(root.querySelector('.head .close').id, 'dyb-debug-close');
assert.deepEqual(Array.from(root.querySelectorAll('.btns button'), b => b.id), [
  'dyb-debug-report', 'dyb-debug-probe', 'dyb-debug-netarm', 'dyb-debug-clear'
]);
const log = root.querySelector('#dyb-debug-log');
context.log = log;
const message = '<img src=x onerror="alert(1)"> 商品\n第二行';
context.message = message;
vm.runInContext('appendLogLine(log, message)', context);
assert.equal(log.querySelector('.log-text').textContent, message, '日志内容完整保留');
assert.equal(log.querySelectorAll('img').length, 0, '日志中的 HTML 不能执行');
assert.ok(log.querySelector('.log-time').textContent, '时间独立显示');
assert.equal(log.children.length, 1);
assert.equal(log.scrollTop, log.scrollHeight, '追加后仍跟随最新日志');
// 模拟无 Shadow DOM 的旧内核，验证同一套按钮与所有规则仍有宿主前缀。
const create = dom.window.document.createElement.bind(dom.window.document);
dom.window.document.createElement = function (tag) {
  const node = create(tag);
  if (tag === 'div') node.attachShadow = () => { throw new Error('unsupported'); };
  return node;
};
const fallback = vm.runInContext('buildHost()', context);
assert.equal(fallback.querySelectorAll('.btns button').length, 4);
const style = fallback.querySelector('style').textContent;
for (const selector of style.matchAll(/(?:^|\n)([^\n{}]+)\{/g)) {
  assert.ok(selector[1].trim().startsWith('#dyb-debug-panel '), '规则没有隔离：' + selector[1]);
}
dom.window.close();
console.log('调试面板外观：DOM、日志纯文本与样式降级检查通过');
