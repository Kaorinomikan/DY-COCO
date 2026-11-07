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
  const SHOP = 'https://buyin.jinritemai.com/dashboard/shopwindow/goods-list?x=1';
  const CTRL = 'https://buyin.jinritemai.com/dashboard/live/control';

  /**
   * 装一次探子。时钟可控（探子只用 Date.now），这样「退避到底等多久」
   * 能断言，而不是靠真实等 30 秒。
   * @param {string} startHref 起始地址
   * @param {{reply?:function(number):Object, silent?:boolean}} opts
   */
  function boot(startHref, opts) {
    const o = opts || {};
    const clock = { now: 1700000000000 };
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
            asks.push({ type: msg && msg.type, at: clock.now });
            if (o.silent) return undefined;          // 模拟「后台永不回执」
            const r = typeof o.reply === 'function' ? o.reply(asks.length) : { ok: true, installed: false };
            if (cb) cb(r);
            return undefined;
          }
        }
      },
      setInterval(fn) { intervals.push(fn); return intervals.length; },
      setTimeout(fn) { timeouts.push(fn); return timeouts.length; },
      clearTimeout() {},
      Date: { now: () => clock.now },
      console: { log() {}, warn() {} }
    });
    vm.runInContext(read('src/live/live-agent.js'), ctx);
    return {
      asks, intervals, timeouts, win, ctx, clock,
      tick() { intervals.forEach((fn) => fn()); },
      advance(ms) { clock.now += ms; }
    };
  }

  // ① 别页：不请求
  {
    const s = boot(SHOP);
    s.tick();
    assert.deepEqual(s.asks, [], '不在中控台时不许请求补注入');
    assert.equal(s.timeouts.length, 1, '应挂一个 1.5 秒兜底');
    s.timeouts.forEach((fn) => fn());
    assert.deepEqual(s.asks, [], '不在中控台时兜底也不许请求');
    ok('别页完全静默（轮询与兜底都不发消息）');
  }

  // ② 切进中控台：请求一次，退避期内不重复
  {
    const s = boot(SHOP);
    s.ctx.location.href = CTRL;
    s.tick();
    assert.deepEqual(s.asks.map((a) => a.type), ['dyc:injectLiveControl'], '切进中控台应当请后台补一次');
    s.advance(1000);
    s.tick();
    assert.equal(s.asks.length, 1, '退避期内不许重复请求（会把后台打爆）');
    s.advance(2500);
    s.tick();
    assert.equal(s.asks.length, 2, '退避 3 秒后仍没装上也必须再试');
    ok('切进中控台只请求一次，退避期满才重发');
  }

  // ③ 已经有标记：彻底静音（SPA 来回切换的常态）
  {
    const s = boot(CTRL);
    s.win.__DYC_LIVE_CTRL_LOADED__ = true;
    s.ctx.location.href = SHOP;
    s.tick();
    s.ctx.location.href = CTRL;
    s.tick();
    s.timeouts.forEach((fn) => fn());
    s.advance(60000);
    s.tick();
    assert.deepEqual(s.asks, [], '脚本已在场时不许再请求（重复注入会让顶层 const 的文件整段作废）');
    ok('标记在场 → 来回切换也不请求');
  }

  // ④ 首拍就在中控台、但没标记：不在首拍抢着注入，交给 1.5 秒兜底
  {
    const s = boot(CTRL);
    assert.deepEqual(s.asks, [], '首拍不许和原生注入抢');
    s.timeouts.forEach((fn) => fn());
    assert.deepEqual(s.asks.map((a) => a.type), ['dyc:injectLiveControl'], '1.5 秒后仍无标记就要补一次兜底');
    ok('首拍不抢注入，1.5 秒兜底补一次');
  }

  // ⑤ ★ 本轮修复的核心：失败一次不许永久静音
  //    旧实现失败后 wasIn 已置真、changed 已归假 ⇒ 之后每一拍都跳过，
  //    页面就停在「一个按钮都没有」，只能刷新 —— 正是用户复报的现象。
  {
    const s = boot(SHOP, { reply: () => ({ ok: false, error: '探针失败：调用超时' }) });
    s.ctx.location.href = CTRL;
    s.tick();
    assert.equal(s.asks.length, 1, '切进来应先请求一次');
    assert.ok(/探针失败/.test(s.win.__DYC_LIVE_INJECT_ERROR__ || ''), '失败原因必须留在页面上供诊断查看');

    s.advance(3100); s.tick();
    assert.equal(s.asks.length, 2, '失败后必须继续重试（旧实现就停在这里，用户只能刷新）');
    s.advance(6100); s.tick();
    assert.equal(s.asks.length, 3, '第二次退避 6 秒后还要再试');
    assert.equal(s.win.__DYC_LIVE_INJECT_TRIES__, 3, '尝试次数要能被诊断读到');
    ok('失败后按退避持续重试（3s→6s），不再一次失败就静音');
  }

  // ⑥ 退避封顶：连续失败不能把间隔无限拉长，也不能无限密集
  {
    const s = boot(SHOP, { reply: () => ({ ok: false, error: '不动' }) });
    s.ctx.location.href = CTRL;
    s.tick();
    let guard = 0;
    while (s.asks.length < 6 && guard++ < 300) {
      s.advance(1000);    // 1 秒粒度：间隔按「最早到期的整秒」量出来
      s.tick();
    }
    const gaps = s.asks.slice(1).map((a, i) => a.at - s.asks[i].at);
    assert.deepEqual(gaps, [3000, 6000, 12000, 24000, 30000],
      '退避必须是 3s→6s→12s→24s→30s 封顶，实际：' + gaps.join(','));
    ok('退避阶梯 3s→6s→12s→24s→30s 封顶');
  }

  // ⑦ 后台回执「好了」但页面没有标记：不算成功，必须继续试
  //    （回执来自后台，标记才是页面里的事实；只看回执会出现「报告成功、按钮没有」）
  {
    let n = 0;
    const s = boot(SHOP, {
      reply: () => {
        n++;
        if (n === 2) s.win.__DYC_LIVE_CTRL_LOADED__ = true;   // 第二次真的装上了
        return { ok: true, installed: n === 2 };
      }
    });
    s.ctx.location.href = CTRL;
    s.tick();
    s.advance(3100); s.tick();
    assert.equal(s.asks.length, 2, '第一次回执 ok 但没标记 ⇒ 仍要重试');
    s.advance(31000); s.tick();
    assert.equal(s.asks.length, 2, '标记出现后必须彻底静音');
    assert.equal(s.win.__DYC_LIVE_INJECT_ERROR__, '', '成功后清掉上一次的失败原因');
    ok('以页面标记为准：回执成功但没标记仍重试，标记出现即静音');
  }

  // ⑧ 后台永不回执：看门狗必须放开 asking，否则又是一个静音出口
  {
    const s = boot(SHOP, { silent: true });
    s.ctx.location.href = CTRL;
    s.tick();
    assert.equal(s.asks.length, 1, '应先发一次');
    assert.ok(s.timeouts.length >= 2, '除了 1.5s 兜底，还必须挂一个回执看门狗');
    s.timeouts.forEach((fn) => fn());          // 触发看门狗
    s.advance(31000); s.tick();
    assert.equal(s.asks.length, 2, '看门狗放开后必须还能再发');
    ok('后台不回执时看门狗放开重试，不会卡死在 asking');
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
  ok('消息分支 / 清单 / 探标记 / 样式都在');

  // ★ 双形态：只等回调会在本机内核上必超时（回调永不触发）⇒ 补注入永远不发生
  assert.ok(/function dualCall/.test(sw), '缺少「回调 + Promise」双形态封装');
  assert.ok(/typeof ret\.then === 'function'/.test(sw), 'dualCall 必须接住 Promise 形态');
  assert.ok(/tabs\.executeScript/.test(sw), '老内核（MV2 风格）要留 tabs.executeScript 回路');
  ok('后台调用同时接回调与 Promise（只认回调 = 本机必超时）');

  // ★ 逐文件注入：整批调用时任一文件抛错，后面的文件（含 toolbar.js）全不执行
  assert.ok(/function injectOneLiveFile/.test(sw), '缺少单文件注入函数');
  const body = sw.slice(sw.indexOf('async function injectLiveControl'), sw.indexOf('function openFeedbackPanel'));
  assert.ok(/injectOneLiveFile\(tabId, file\)/.test(body), '逐个文件注入没接进主流程');
  assert.equal(sw.indexOf('files: assets.js'), -1, '不许再一次整批注入（一处失败会连坐后面全部）');
  assert.ok(/failed\.push\(file\)/.test(body), '失败文件必须记账，否则「少哪几个」永远查不到');
  ok('逐文件注入，失败文件可枚举');

  const probeAt = body.indexOf('probeLiveControlLoaded');
  const cssAt = body.indexOf('insertCSS');
  const loopAt = body.indexOf('injectOneLiveFile(tabId, file)');
  const recheckAt = body.lastIndexOf('probeLiveControlLoaded');
  assert.ok(probeAt >= 0 && cssAt > probeAt, '插入样式必须排在探标记之后');
  assert.ok(loopAt > cssAt, '注入脚本必须排在插入样式之后（先有样式再建 DOM，避免闪一下没样式）');
  assert.ok(recheckAt > loopAt, '注入完必须回探标记，把「真装没装上」回报给页面侧');
  assert.ok(body.indexOf('installed: installed') >= 0, '回执里要带 installed 供页面侧判重试');
  ok('顺序：探标记 → 插样式 → 逐个注入 → 回探标记');

  const agentEntry = (manifest.content_scripts || []).find(
    (cs) => (cs.js || []).indexOf('src/live/live-agent.js') >= 0
  );
  assert.ok(agentEntry, 'manifest 里没有探子条目');
  assert.ok((agentEntry.matches || []).indexOf('https://*.jinritemai.com/*') >= 0, '探子必须全域铺');
  assert.ok(!agentEntry.exclude_matches, '探子不能排除中控台页：要能记录「本来就在中控台」的起始态');
  ok('探子全域铺、且不排除中控台页');
}

console.log('\n全绿：' + pass + ' 组');
