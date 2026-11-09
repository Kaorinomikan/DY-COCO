'use strict';

// 用真实后台函数模拟 MV3 禁止字符串代码生成，覆盖全部页面分组及跨组复用。
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert/strict');
const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const sw = read('src/background/service-worker.js');
const code = sw.slice(sw.indexOf('function dualCall('), sw.indexOf('/**\n * 把反馈面板注入到'));
const registry = vm.createContext({});
vm.runInContext(read('src/shared/live-control-assets.js'), registry);

function boot(legacy = false) {
  const page = vm.createContext({ window: {}, location: { href: 'https://buyin.jinritemai.com/dashboard' },
    dycIsSupportedPage: () => false, console: { error() {}, warn() {}, log() {} } });
  const files = [];
  let probes = 0;
  function execute(options, callback) {
    let result;
    if (options.func) {
      probes++;
      const fn = vm.runInContext('(' + options.func.toString() + ')', page);
      result = [{ result: fn(...(options.args || [])) }];
    } else if (options.code) {
      probes++;
      result = [vm.runInContext(options.code, page)];
    } else {
      const file = options.file || options.files[0];
      files.push(file);
      // 真实执行分组标记和含顶层 const/let 的共享脚本，捕获跨组重声明错误。
      // 其余业务脚本这里只验证调度，不替代页面真机验证。
      if (/-flag\.js$/.test(file) || /\/(anchor|row-scan)\.js$/.test(file)) {
        vm.runInContext(read(file), page);
      }
      result = legacy ? [undefined] : [{ result: undefined }];
    }
    callback(result);
    return legacy ? undefined : Promise.resolve(result);
  }
  const chrome = { runtime: {} };
  if (legacy) chrome.tabs = { executeScript: (_id, options, cb) => execute(options, cb) };
  else chrome.scripting = {
    executeScript: execute,
    insertCSS: (_options, cb) => { cb(); return Promise.resolve(); }
  };
  const context = vm.createContext({ chrome, setTimeout, clearTimeout }, {
    codeGeneration: { strings: false, wasm: false }
  });
  vm.runInContext(code, context);
  return { context, page, files, get probes() { return probes; } };
}

(async () => {
  for (const legacy of [false, true]) {
    const groups = Object.entries(registry.DYC_INJECT_GROUPS);
    for (let start = 0; start < groups.length; start++) {
    const state = boot(legacy);
    const ordered = groups.slice(start).concat(groups.slice(0, start));
    for (const [name, group] of ordered) {
      const before = state.files.length;
      const result = await state.context.injectAssetGroup({ tab: { id: 7 } }, group, group.marker, group.label);
      assert.equal(result.installed, true, name + ': must install under MV3 CSP: ' + result.error);
      assert.equal(result.failed.length, 0, name + ': no failed files');
      assert.ok(state.files.length > before, name + ': must inject on first entry');
      const count = state.files.length;
      const again = await state.context.injectAssetGroup({ tab: { id: 7 } }, group, group.marker, group.label);
      assert.equal(again.skipped, true, name + ': returning to an installed page must skip');
      assert.equal(state.files.length, count, name + ': no duplicate injection');
    }
    // 已加载过其它组以后再返回原组，仍然不应重复执行。
    const count = state.files.length;
    for (const [, group] of ordered) {
      const result = await state.context.injectAssetGroup({ tab: { id: 7 } }, group, group.marker, group.label);
      assert.equal(result.skipped, true);
    }
    assert.equal(state.files.length, count);
    for (const file of ['src/content/anchor.js', 'src/content/row-scan.js']) {
      assert.equal(state.files.filter(item => item === file).length, 1, file + ': reuse across groups');
    }
    assert.ok(state.probes > 0);
    }
    console.log('PASS: all 8 starting groups, cross-group reuse and return, ' + (legacy ? 'legacy callback API' : 'MV3 API with CSP'));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
