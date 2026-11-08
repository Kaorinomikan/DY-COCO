/**
 * 橱窗脚本 · 按需补注入（2026-11-08 用户报：巨量百应主页分页切进橱窗，按钮全不出现）
 * ============================================================
 * 被测文件：src/live/live-agent.js（全域探子·橱窗分区）、
 *           src/shared/live-control-assets.js（DYC_SHOPWINDOW_ASSETS 注入清单）、
 *           src/content/shopwindow-flag.js（在场标记）、
 *           src/background/service-worker.js（补注入执行）、manifest.json
 *
 * 背景：巨量百应后台是 SPA，从主页 /dashboard 的页签切进
 *   /dashboard/shopwindow/* 时 document 不重载，manifest 橱窗那条
 *   content_scripts 永远等不到导航。2026-11-08 前探子只认中控台，
 *   橱窗这条路完全没有补注入通道。
 *
 * 覆盖：
 *   A. 清单一致性 —— DYC_SHOPWINDOW_ASSETS 与 manifest 橱窗条目**逐项同序**一致；
 *      flags 必须第 0 位、在场标记必须紧跟其后
 *   B. 在场标记 —— 标记文件存在且只置一个标记；且**不许**被全域条目引入
 *      （全域置标记 = 所有页面都被当成「装过」，补注入永不发生）
 *   C. 判定口径 —— 探子橱窗分区正则与 manifest 橱窗 matches 同口径
 *   D. 探子行为 —— 百应主页切进橱窗才请求 / 标记在场彻底静音 / 失败退避重试 /
 *      看门狗放开 / 分区隔离（中控台的事归中控台分区）
 *   E. 后台接线 —— 橱窗消息分支、清单引用、标记探针都在
 *
 * 用法：node scripts/自测-橱窗补注入.js  （退出码 0 = 全绿）
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
const shopEntry = (manifest.content_scripts || []).find(
  (cs) => (cs.matches || []).some((m) => m.indexOf('/dashboard/shopwindow/') >= 0)
);
assert.ok(shopEntry, 'manifest 里找不到橱窗那条 content_scripts');

/* ---------------- A. 清单一致性 ---------------- */
console.log('A. 注入清单与 manifest 一致');
{
  const assetsCode = read('src/shared/live-control-assets.js');
  const ctx = vm.createContext({});
  vm.runInContext(assetsCode, ctx);
  const assets = ctx.DYC_SHOPWINDOW_ASSETS;
  assert.ok(assets && Array.isArray(assets.js) && assets.js.length, '清单没导出橱窗 js 数组');

  assert.deepEqual(JSON.parse(JSON.stringify(assets.js)), shopEntry.js.slice(),
    '清单 js 与 manifest 橱窗条目不一致（必须逐项同序）');
  assert.deepEqual(JSON.parse(JSON.stringify(assets.css)), (shopEntry.css || []).slice(),
    '清单 css 与 manifest 橱窗条目不一致');
  ok('js / css 逐项同序一致（' + assets.js.length + ' 个脚本 / ' + assets.css.length + ' 个样式）');

  assert.equal(shopEntry.js[0], 'src/content/flags.js', 'flags.js 必须在第 0 位');
  assert.equal(shopEntry.js[1], 'src/content/shopwindow-flag.js',
    '在场标记必须紧跟开关层、早于任何建 UI 的脚本（diag/anchor/dialog 有顶层 const，重复执行整段作废）');
  ok('顺序约定：开关层 → 在场标记 → 其余');
}

/* ---------------- B. 在场标记 ---------------- */
console.log('B. 在场标记文件');
{
  const flagCode = read('src/content/shopwindow-flag.js');
  assert.ok(/window\.__DYC_SHOPWINDOW_LOADED__\s*=\s*true\s*;/.test(flagCode),
    '标记文件必须置 window.__DYC_SHOPWINDOW_LOADED__ = true');
  ok('标记文件存在且置 __DYC_SHOPWINDOW_LOADED__');

  // 标记只允许出现在橱窗条目里。全域条目（*.jinritemai.com/* 等）一旦带上它，
  // 等于宣告「所有页面都装过橱窗脚本」，补注入永远不会发生。
  manifest.content_scripts.forEach((cs, i) => {
    const js = cs.js || [];
    if (js.indexOf('src/content/shopwindow-flag.js') >= 0) {
      assert.ok(
        (cs.matches || []).some((m) => m.indexOf('/dashboard/shopwindow/') >= 0),
        '标记文件出现在第 ' + i + ' 条非橱窗 content_scripts 里（全域置标记 = 补注入永不发生）'
      );
    }
  });
  ok('标记只挂在橱窗条目上，没有被全域条目污染');
}

/* ---------------- C. 判定口径 ---------------- */
console.log('C. 探子橱窗分区判定口径');
{
  const agentCode = read('src/live/live-agent.js');
  const reMatch = /var\s+RE_SHOPWINDOW\s*=\s*(\/[\s\S]*?\/);/.exec(agentCode);
  assert.ok(reMatch, '探子里找不到橱窗分区判定正则 RE_SHOPWINDOW');
  const re = vm.runInContext('(' + reMatch[1] + ')', vm.createContext({}));

  const yes = [
    'https://buyin.jinritemai.com/dashboard/shopwindow/goods-list',
    'https://buyin.jinritemai.com/dashboard/shopwindow/',
    'https://buyin.jinritemai.com/dashboard/shopwindow/goods-list?x=1'
  ];
  const no = [
    // 百应主页（用户实测的切页起点）
    'https://buyin.jinritemai.com/dashboard?pre_universal_page_params_id=&universal_page_params_id=d997e5b6-aadc-4505-b25a-20e86d98c514',
    'https://buyin.jinritemai.com/dashboard/live/control',
    'https://fxg.jinritemai.com/ffa/content-tool/live/control',
    'https://buyin.jinritemai.com/dashboard/shopwindowevil',
    'https://store.weixin.qq.com/shop/goods/list',
    'https://example.com/dashboard/shopwindow/goods-list'
  ];
  yes.forEach((u) => assert.ok(re.test(u), '橱窗分区该命中却没命中：' + u));
  no.forEach((u) => assert.ok(!re.test(u), '橱窗分区不该命中却命中了：' + u));
  ok('橱窗 URL 全命中、主页/中控台/别域全不命中');
}

/* ---------------- D. 探子行为 ---------------- */
console.log('D. 探子行为');
{
  const HOME = 'https://buyin.jinritemai.com/dashboard?universal_page_params_id=x';  // 用户实测的切页起点
  const SHOP = 'https://buyin.jinritemai.com/dashboard/shopwindow/goods-list?x=1';
  const CTRL = 'https://buyin.jinritemai.com/dashboard/live/control';

  /**
   * 装一次探子。时钟可控（探子只用 Date.now），「退避到底等多久」
   * 能断言，而不是靠真实等 30 秒。
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
            asks.push({ type: msg && msg.type, group: msg && msg.group, at: clock.now });
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

  // ① 别页（含百应主页）：不请求，且不许误发中控台的补注入
  {
    const s = boot(HOME);
    s.tick();
    assert.deepEqual(s.asks, [], '不在橱窗时不许请求补注入');
    assert.equal(s.timeouts.length, 1, '应挂一个 1.5 秒兜底');
    s.timeouts.forEach((fn) => fn());
    assert.deepEqual(s.asks, [], '不在橱窗时兜底也不许请求');
    ok('百应主页完全静默（轮询与兜底都不发消息）');
  }

  // ② 主页切进橱窗（用户实测场景）：请求一次，退避期内不重复
  {
    const s = boot(HOME);
    s.ctx.location.href = SHOP;
    s.tick();
    assert.deepEqual(s.asks.map((a) => a.type), ['dyc:injectGroup'], '切进橱窗应当请后台补一次');
    assert.equal(s.asks[0].group, 'shopwindow', '分组键必须指到橱窗');
    s.advance(1000);
    s.tick();
    assert.equal(s.asks.length, 1, '退避期内不许重复请求（会把后台打爆）');
    s.advance(2500);
    s.tick();
    assert.equal(s.asks.length, 2, '退避 3 秒后仍没装上也必须再试');
    ok('主页切进橱窗只请求一次，退避期满才重发');
  }

  // ③ 标记在场：彻底静音（SPA 来回切换的常态）
  {
    const s = boot(SHOP);
    s.win.__DYC_SHOPWINDOW_LOADED__ = true;
    s.ctx.location.href = HOME;
    s.tick();
    s.ctx.location.href = SHOP;
    s.tick();
    s.timeouts.forEach((fn) => fn());
    s.advance(60000);
    s.tick();
    assert.deepEqual(s.asks, [], '脚本已在场时不许再请求（重复注入会让顶层 const 的文件整段作废）');
    ok('标记在场 → 来回切换也不请求');
  }

  // ④ 首拍就在橱窗、但没标记：不在首拍抢着注入，交给 1.5 秒兜底
  {
    const s = boot(SHOP);
    assert.deepEqual(s.asks, [], '首拍不许和原生注入抢');
    s.timeouts.forEach((fn) => fn());
    assert.deepEqual(s.asks.map((a) => a.type), ['dyc:injectGroup'], '1.5 秒后仍无标记就要补一次兜底');
    assert.equal(s.asks[0].group, 'shopwindow', '分组键必须指到橱窗');
    ok('首拍不抢注入，1.5 秒兜底补一次');
  }

  // ⑤ 失败不许永久静音（与中控台同一教训：失败后停拍 = 用户只能刷新）
  {
    const s = boot(HOME, { reply: () => ({ ok: false, error: '探针失败：调用超时' }) });
    s.ctx.location.href = SHOP;
    s.tick();
    assert.equal(s.asks.length, 1, '切进来应先请求一次');
    assert.ok(/探针失败/.test(s.win.__DYC_SHOPWINDOW_INJECT_ERROR__ || ''),
      '失败原因必须留在页面上供诊断查看');

    s.advance(3100); s.tick();
    assert.equal(s.asks.length, 2, '失败后必须继续重试');
    assert.equal(s.win.__DYC_SHOPWINDOW_INJECT_TRIES__, 2, '尝试次数要能被诊断读到');
    ok('失败后按退避持续重试，不再一次失败就静音');
  }

  // ⑥ 分区隔离：从已装好的中控台切到橱窗，只请橱窗的补注入
  {
    const s = boot(CTRL);
    s.win.__DYC_LIVE_CTRL_LOADED__ = true;   // 中控台脚本已装
    s.ctx.location.href = SHOP;
    s.tick();
    assert.deepEqual(s.asks.map((a) => a.type), ['dyc:injectGroup'],
      '切到橱窗只该请橱窗的补注入');
    assert.equal(s.asks[0].group, 'shopwindow', '分组键必须指到橱窗');
    s.advance(60000);
    s.tick();
    assert.ok(s.asks.length >= 1 && s.asks.every((a) => a.type === 'dyc:injectGroup' && a.group === 'shopwindow'),
      '重试期里也只许橱窗分组；中控台分区不许被橱窗页触发（重复注入会让顶层 const 文件整段作废）');
    ok('分区隔离：橱窗请求不夹带中控台，中控台标记在场不受影响');
  }

  // ⑦ 后台永不回执：看门狗必须放开 asking
  {
    const s = boot(HOME, { silent: true });
    s.ctx.location.href = SHOP;
    s.tick();
    assert.equal(s.asks.length, 1, '应先发一次');
    assert.ok(s.timeouts.length >= 2, '除了 1.5s 兜底，还必须挂一个回执看门狗');
    s.timeouts.forEach((fn) => fn());          // 触发看门狗
    s.advance(31000); s.tick();
    assert.equal(s.asks.length, 2, '看门狗放开后必须还能再发');
    ok('后台不回执时看门狗放开重试，不会卡死在 asking');
  }
}

/* ---------------- E. 后台接线 ---------------- */
console.log('E. 后台接线');
{
  const sw = read('src/background/service-worker.js');
  assert.ok(/dyc:injectShopwindow/.test(sw), 'SW 没有处理橱窗补注入消息');
  assert.ok(/DYC_SHOPWINDOW_ASSETS/.test(sw), 'SW 没有引用橱窗注入清单');
  assert.ok(/__DYC_SHOPWINDOW_LOADED__/.test(sw), '橱窗补注入必须探橱窗标记');
  assert.ok(/function injectAssetGroup/.test(sw), 'SW 没有分组注入实现');
  // 2026-11-08 起探子统一走 dyc:injectGroup 分发；旧两个消息类型保留作兼容
  assert.ok(/dyc:injectGroup/.test(sw), 'SW 没有通用分组分支');
  assert.ok(/DYC_INJECT_GROUPS\[msg\.group\]/.test(sw), '通用分支必须按注册表键分发');
  // 橱窗分支必须走与中控台同一个注入器（探标记 → 插样式 → 逐个注入 → 回探），
  // 不许各写一份 —— 两份实现迟早漂移。
  const branch = sw.slice(sw.indexOf("msg.type === 'dyc:injectShopwindow'"),
    sw.indexOf("msg.type === 'dyc:injectShopwindow'") + 400);
  assert.ok(/injectAssetGroup\(sender, DYC_SHOPWINDOW_ASSETS, '__DYC_SHOPWINDOW_LOADED__', '橱窗'\)/.test(branch),
    '橱窗分支必须复用 injectAssetGroup，并传橱窗清单与标记');
  ok('消息分支 / 清单 / 探标记 / 复用注入器都在');
}

console.log('\n全绿：' + pass + ' 组');
