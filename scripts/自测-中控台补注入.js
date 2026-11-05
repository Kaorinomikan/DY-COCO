/**
 * 中控台脚本 · 按需补注入（2026-11-05 用户报：侧栏切进中控台，功能全不出现）
 * ============================================================
 * 被测文件：src/live/live-agent.js（全域探子）、
 *           src/shared/live-control-assets.js（注入清单）、
 *           src/background/service-worker.js（补注入执行）、manifest.json
 *
 * 覆盖：
 *   A. 清单一致性 —— assets 的 js/css 必须与 manifest 中控台条目**逐项同序**一致，
 *      否则补注入会少脚本/顺序错（有顶层依赖），且 flags 必须第 0 位、
 *      在场标记必须紧跟其后
 *   B. 判定口径 —— 探子的正则与 flags.dycIsLiveControl() 对同一批 URL 结论一致
 *      （口径分叉会让「已经在中控台却没补注入」或反过来）
 *   C. 探子行为 —— 别页静默 / 切进来只请求一次 / 有标记彻底静音 /
 *      首拍就在中控台时不与原生注入抢（交给 1.5 秒兜底）
 *   D. 后台接线 —— 消息分支存在，且先探标记再注入，样式与脚本都要补
 *
 * 用法：node scripts/自测-中控台补注入.js  （退出码 0 = 全绿）
 * ============================================================
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert/strict');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

let pass = 0;
function ok(name) { pass++; console.log('  ✓ ' + name); }

const manifest = JSON.parse(read('manifest.json'));
const controlEntry = (manifest.content_scripts || []).find(
  (cs) => (cs.matches || []).some((m) => m.indexOf('/live/control') >= 0)
);
assert.ok(controlEntry, 'manifest 里找不到中控台那条 content_scripts');

/* ---------------- A. 清单一致性 ---------------- */
console.log('A. 注入清单与 manifest 一致');
{
  const assetsCode = read('src/shared/live-control-assets.js');
  const ctx = vm.createContext({});
  vm.runInContext(assetsCode, ctx);
  const assets = ctx.DYC_LIVE_CONTROL_ASSETS;
  assert.ok(assets && Array.isArray(assets.js) && assets.js.length, '清单没导出 js 数组');

  assert.deepEqual(JSON.parse(JSON.stringify(assets.js)), controlEntry.js.slice(),
    '清单 js 与 manifest 中控台条目不一致（必须逐项同序）');
  assert.deepEqual(JSON.parse(JSON.stringify(assets.css)), (controlEntry.css || []).slice(),
    '清单 css 与 manifest 中控台条目不一致');
  ok('js / css 逐项同序一致（' + assets.js.length + ' 个脚本 / ' + assets.css.length + ' 个样式）');

  assert.equal(controlEntry.js[0], 'src/content/flags.js', 'flags.js 必须在第 0 位');
  assert.equal(controlEntry.js[1], 'src/live/live-control-flag.js',
    '在场标记必须紧跟开关层、早于任何建 UI 的脚本');
  assert.ok(assets.js.indexOf('src/live/live-control-flag.js') >= 0, '标记文件漏进清单 = 补注入后仍被当成没装');
  ok('顺序约定：开关层 → 在场标记 → 其余');
}

/* ---------------- B. 判定口径一致 ---------------- */
console.log('B. 探子与 flags 的判定口径一致');
{
  const flagsCode = read('src/content/flags.js');
  const start = flagsCode.indexOf('function dycIsLiveControl(');
  assert.ok(start > 0, 'flags.js 里没有 dycIsLiveControl');
  let depth = 0, opened = false, end = -1;
  for (let i = start; i < flagsCode.length; i++) {
    if (flagsCode[i] === '{') { depth++; opened = true; }
    else if (flagsCode[i] === '}') { depth--; if (opened && depth === 0) { end = i + 1; break; } }
  }
  const flagsCtx = vm.createContext({ location: { href: '' } });
  vm.runInContext(flagsCode.slice(start, end), flagsCtx);

  const agentCode = read('src/live/live-agent.js');
  const reMatch = /var\s+RE\s*=\s*(\/[\s\S]*?\/);/.exec(agentCode);
  assert.ok(reMatch, '探子里找不到判定正则');
  const agentRe = vm.runInContext('(' + reMatch[1] + ')', vm.createContext({}));

  const urls = [
    'https://buyin.jinritemai.com/dashboard/live/control',
    'https://buyin.jinritemai.com/dashboard/live/control?room=1',
    'https://fxg.jinritemai.com/ffa/content-tool/live/control',
    'https://buyin.jinritemai.com/dashboard/shopwindow/goods-list?x=1',
    'https://buyin.jinritemai.com/dashboard/live/data',
    'https://compass.jinritemai.com/screen/live/1',
    'https://store.weixin.qq.com/shop/goods/list',
    'https://example.com/dashboard/live/control'
  ];
  urls.forEach((u) => {
    assert.equal(agentRe.test(u), flagsCtx.dycIsLiveControl(u),
      '两边判定不一致：' + u);
  });
  ok('两个入口与外部页面两边结论完全一致（口径分叉会导致「在中控台却不补注入」）');
}

/* ---------------- C. 探子行为 ---------------- */
console.log('C. 探子行为');
{
  /** 装一次探子，返回可手动推进的钩子 */
  function boot(startHref) {
    const asks = [];
    const intervals = [];
    const timeouts = [];
    const win = { addEventListener() {} };
    const ctx = vm.createContext({
      window: win,
      location: { href: startHref },
      chrome: {
        runtime: {
          sendMessage(msg, cb) {
            asks.push(msg && msg.type);
            if (cb) cb({ ok: true });
            return undefined;
          }
        }
      },
      setInterval(fn) { intervals.push(fn); return intervals.length; },
      setTimeout(fn) { timeouts.push(fn); return timeouts.length; },
      console: { log() {}, warn() {} }
    });
    vm.runInContext(read('src/live/live-agent.js'), ctx);
    return { asks, intervals, timeouts, win, ctx };
  }

  const SHOP = 'https://buyin.jinritemai.com/dashboard/shopwindow/goods-list?x=1';
  const CTRL = 'https://buyin.jinritemai.com/dashboard/live/control';

  // ① 别页：不请求
  {
    const s = boot(SHOP);
    s.intervals.forEach((fn) => fn());
    assert.deepEqual(s.asks, [], '不在中控台时不许请求补注入');
    assert.equal(s.timeouts.length, 1, '应挂一个 1.5 秒兜底');
    s.timeouts.forEach((fn) => fn());
    assert.deepEqual(s.asks, [], '不在中控台时兜底也不许请求');
    ok('别页完全静默（轮询与兜底都不发消息）');
  }

  // ② 切进中控台：请求一次，冷却期内不重复
  {
    const s = boot(SHOP);
    s.ctx.location.href = CTRL;
    s.intervals[0]();
    assert.deepEqual(s.asks, ['dyc:injectLiveControl'], '切进中控台应当请后台补一次');
    s.intervals[0]();
    s.intervals[0]();
    assert.equal(s.asks.length, 1, '3 秒冷却期内不许重复请求（会把后台打爆）');
    ok('切进中控台只请求一次，冷却期内不重发');
  }

  // ③ 已经有标记：彻底静音（SPA 来回切换的常态）
  {
    const s = boot(CTRL);
    s.win.__DYC_LIVE_CTRL_LOADED__ = true;
    s.ctx.location.href = SHOP;
    s.intervals[0]();
    s.ctx.location.href = CTRL;
    s.intervals[0]();
    s.timeouts.forEach((fn) => fn());
    assert.deepEqual(s.asks, [], '脚本已在场时不许再请求（重复注入会让顶层 const 的文件整段作废）');
    ok('标记在场 → 来回切换也不请求');
  }

  // ④ 首拍就在中控台、但没标记：不在首拍抢着注入，交给 1.5 秒兜底
  {
    const s = boot(CTRL);
    assert.deepEqual(s.asks, [], '首拍不许和原生注入抢');
    s.timeouts.forEach((fn) => fn());
    assert.deepEqual(s.asks, ['dyc:injectLiveControl'], '1.5 秒后仍无标记就要补一次兜底');
    ok('首拍不抢注入，1.5 秒兜底补一次');
  }
}

/* ---------------- D. 后台接线 ---------------- */
console.log('D. 后台接线');
{
  const sw = read('src/background/service-worker.js');
  assert.ok(/dyc:injectLiveControl/.test(sw), 'SW 没有处理补注入消息');
  assert.ok(/importScripts\([^)]*live-control-assets\.js/.test(sw), 'SW 没有引入注入清单');
  assert.ok(/function injectLiveControl/.test(sw), 'SW 没有注入实现');
  assert.ok(/__DYC_LIVE_CTRL_LOADED__/.test(sw), '注入前必须探标记，否则会重复注入');
  assert.ok(/insertCSS/.test(sw), '样式没补，浮动控件会「有节点没样子」');
  assert.ok(/executeScript/.test(sw), '脚本没补');

  const probeAt = sw.indexOf('__DYC_LIVE_CTRL_LOADED__');
  const cssAt = sw.indexOf('insertCSS');
  const jsAt = sw.indexOf('files: assets.js');
  assert.ok(probeAt > 0 && cssAt > probeAt, '插入样式必须排在探标记之后');
  assert.ok(jsAt > cssAt, '注入脚本必须排在插入样式之后（先有样式再建 DOM，避免闪一下没样式）');
  ok('顺序：探标记 → 插样式 → 注脚本');

  const agentEntry = (manifest.content_scripts || []).find(
    (cs) => (cs.js || []).indexOf('src/live/live-agent.js') >= 0
  );
  assert.ok(agentEntry, 'manifest 里没有探子条目');
  assert.ok((agentEntry.matches || []).indexOf('https://*.jinritemai.com/*') >= 0, '探子必须全域铺');
  assert.ok(!agentEntry.exclude_matches, '探子不能排除中控台页：要能记录「本来就在中控台」的起始态');
  ok('探子全域铺、且不排除中控台页');
}

console.log('\n全绿：' + pass + ' 组');
