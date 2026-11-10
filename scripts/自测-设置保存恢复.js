'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const read = p => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
const flags = read('src/content/flags.js');
const sw = read('src/background/service-worker.js');
const loop = read('src/live/auto-loop-lecture.js');
// 复用已有的函数提取器，只运行其定义，不运行原自测。
const testSource = read('scripts/自测-后台状态.js');
const extractor = testSource.slice(testSource.indexOf('function extractFunction('), testSource.indexOf('function extractBetween('));
const util = vm.createContext({});
vm.runInContext(extractor, util);
const extract = util.extractFunction;
function env() {
  const data = { dybFeatures: { clearStock: false } };
  let fail = '';
  const chrome = { runtime: { lastError: null }, storage: { onChanged: { addListener() {} }, local: {
    get(key, cb) {
      if (!cb) return undefined;
      queueMicrotask(() => { chrome.runtime.lastError = fail ? { message: fail } : null; fail = ''; cb({ [key]: data[key] }); chrome.runtime.lastError = null; });
    },
    set(patch, cb) {
      queueMicrotask(() => {
        chrome.runtime.lastError = fail ? { message: fail } : null;
        if (!fail) Object.assign(data, patch);
        fail = '';
        if (cb) cb();
        chrome.runtime.lastError = null;
      });
    }
  } } };
  const notices = [];
  const ctx = vm.createContext({ chrome, console, setTimeout, clearTimeout, notices,
    noteDiag() {}, setStatus(...args) { notices.push(args); }, SOURCE: '循环讲解', BOX_FAIL: 'save',
    withKey: (key, value) => ({ [key]: value }) });
  vm.runInContext(flags + '\nvar flagWriteQueue = Promise.resolve();\n' + extract(sw, 'writeFeatureFlag') +
    '\nvar settingsWrite = Promise.resolve();\n' + extract(loop, 'writeSetting'), ctx);
  return { ctx, data, chrome, notices, failNext(message) { fail = message; } };
}
(async () => {
  let failed = 0;
  async function test(name, fn) { try { await fn(); console.log('通过：' + name); } catch (e) { failed++; console.error('失败：' + name + '：' + e.message); } }
  await test('仅回调内核的全部开关可以连续保存且保留其他设置', async () => {
    const { ctx, data } = env();
    await Promise.all([ctx.writeFeatureFlag('cursorFix', false), ctx.writeFeatureFlag('autoLoopLecture', true)]);
    assert.equal(data.dybFeatures.cursorFix, false);
    assert.equal(data.dybFeatures.autoLoopLecture, true);
    assert.equal(data.dybFeatures.clearStock, false);
  });
  await test('真实读取错误拒绝写入，旧设置保留，后续操作恢复', async () => {
    const { ctx, data, failNext } = env();
    failNext('storage unavailable');
    await assert.rejects(ctx.writeFeatureFlag('cursorFix', false), /storage unavailable/);
    assert.deepEqual(data.dybFeatures, { clearStock: false });
    await ctx.writeFeatureFlag('cursorFix', false);
    assert.equal(data.dybFeatures.cursorFix, false);
  });
  await test('循环讲解写入失败必须有提示，下一次保存可恢复', async () => {
    const { ctx, data, failNext, notices } = env();
    failNext('QUOTA_BYTES quota exceeded');
    await ctx.writeSetting('enabled', true);
    assert.equal(notices.length, 1, '不能把回调中的写入失败当成保存成功');
    assert.equal(data.enabled, undefined);
    await ctx.writeSetting('enabled', false);
    assert.equal(data.enabled, false);
  });
  await test('后台短暂未就绪时重试一次并保存成功', async () => {
    const { ctx, chrome } = env(); let calls = 0;
    chrome.runtime.sendMessage = (msg, cb) => {
      calls++;
      chrome.runtime.lastError = calls === 1 ? { message: 'Could not establish connection. Receiving end does not exist.' } : null;
      cb(calls === 1 ? undefined : { ok: true }); chrome.runtime.lastError = null;
    };
    await ctx.dycWriteFlag('cursorFix', false);
    assert.equal(calls, 2);
  });
  await test('后台明确拒绝时不重试也不伪报保存成功', async () => {
    const { ctx, chrome } = env(); let calls = 0;
    chrome.runtime.sendMessage = (msg, cb) => { calls++; cb({ ok: false, error: 'disk full' }); };
    await assert.rejects(ctx.dycWriteFlag('cursorFix', false), /disk full/);
    assert.equal(calls, 1);
  });
  await test('持续通信故障最多重试一次，仍向调用方报告失败', async () => {
    const { ctx, chrome } = env(); let calls = 0;
    chrome.runtime.sendMessage = (msg, cb) => {
      calls++; chrome.runtime.lastError = { message: 'The message port closed before a response was received.' };
      cb(); chrome.runtime.lastError = null;
    };
    await assert.rejects(ctx.dycWriteFlag('cursorFix', false), /port closed/);
    assert.equal(calls, 2);
  });
  await test('旧页面上下文失效明确提示刷新网页，不反复重试', async () => {
    const { ctx, chrome } = env(); let calls = 0;
    chrome.runtime.sendMessage = () => { calls++; throw new Error('Extension context invalidated.'); };
    let error;
    try { await ctx.dycWriteFlag('cursorFix', false); } catch (e) { error = e; }
    assert.match(ctx.dycSettingError(error), /刷新当前网页/);
    assert.equal(calls, 1);
  });
  await test('循环讲解启停及调试、隐藏和搜索设置均等待回调并暴露失败', async () => {
    const { ctx, failNext, data } = env();
    await ctx.writeSetting('enabled', true);
    assert.equal(data.enabled, true);
    await ctx.writeSetting('enabled', false);
    assert.equal(data.enabled, false);
    await ctx.writeFeatureFlag('debug', true, 'debug');
    assert.equal(data.dybDebug, true);
    for (const [name, arg] of [['dycWriteHideList', []], ['dycWriteShadeMode', 'opaque'], ['dycWriteOmniMode', 'always']]) {
      failNext('write failed');
      await assert.rejects(ctx[name](arg), /write failed/);
      await ctx[name](arg);
    }
  });
  if (failed) process.exitCode = 1;
})();
