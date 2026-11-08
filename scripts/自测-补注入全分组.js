/**
 * 补注入 · 全分组一致性（2026-11-08 探子分区制推广到全部路径型注入组）
 * ============================================================
 * 背景：分区制此前只覆盖中控台/橱窗（各有专门自测），本文件守**全局**：
 *   往 manifest 新增/修改任何路径型注入组而忘了同步注册表（或反过来），
 *   都必须在这里红，而不是在用户「SPA 切进新页面没功能」时才发现。
 *
 * 被测文件：src/shared/live-control-assets.js（DYC_INJECT_GROUPS 注册表）、
 *           src/live/live-agent.js（8 分区门铃）、
 *           src/background/service-worker.js（dyc:injectGroup 通用分发）、
 *           src/content/diag.js（spaZones 一览）、manifest.json、各 *-flag.js
 *
 * 覆盖：
 *   A. 注册表 ↔ manifest —— 每个分组按标记文件反查条目，js/css 逐项同序一致；
 *      条目里不允许出现注册表之外孤儿标记文件
 *   B. 判定口径 —— 六个新分区正则的正反样例；同文档跨组互不误判
 *   C. 门铃行为 —— fxg 主页切进商品列表按分组请求；跨组切换不被旧标记挡住
 *   D. 诊断注册表 —— __DYC_SPA_ZONES__ 与注册表键一一对应
 *   E. 后台/诊断接线 —— 通用分支按注册表分发、未知分组拒绝、diag 有 spaZones
 *
 * 用法：node scripts/自测-补注入全分组.js  （退出码 0 = 全绿）
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
const entries = manifest.content_scripts || [];

/* ---------------- A. 注册表 ↔ manifest 全量一致 ---------------- */
console.log('A. 注册表与 manifest 全量一致');
let registry;
{
  const ctx = vm.createContext({});
  vm.runInContext(read('src/shared/live-control-assets.js'), ctx);
  registry = ctx.DYC_INJECT_GROUPS;
  assert.ok(registry && typeof registry === 'object', '注册表 DYC_INJECT_GROUPS 缺失');
  const keys = Object.keys(registry);
  assert.equal(keys.length, 8, '注册表分组数应为 8，实际 ' + keys.length +
    '（新增路径型注入组时必须同步登记注册表 + 门铃分区 + 标记文件）');

  // 标记文件索引：文件名 → 它置的标记键
  const flagOfEntry = new Map();   // entryIndex → flag 文件路径
  const markerOfFile = new Map();  // flag 文件 → 标记键
  entries.forEach((cs, i) => {
    (cs.js || []).forEach((f) => {
      if (!/-flag\.js$/.test(f)) return;
      const code = read(f);
      const m = /window\.(__[A-Z_]+__)\s*=\s*true\s*;/.exec(code);
      assert.ok(m, f + ' 没有按约定置 window.__XXX__ = true');
      markerOfFile.set(f, m[1]);
      if (!flagOfEntry.has(i)) flagOfEntry.set(i, f);
    });
  });
  assert.ok(markerOfFile.size >= 8, 'manifest 里的标记文件应不少于 8 个，实际 ' + markerOfFile.size);

  keys.forEach((key) => {
    const g = registry[key];
    assert.ok(g.label && g.marker && Array.isArray(g.js) && g.js.length,
      '分组 ' + key + ' 结构不完整（label/marker/js）');

    const flagFile = [...markerOfFile.entries()].find(([, mk]) => mk === g.marker);
    assert.ok(flagFile, '分组 ' + key + ' 的标记（' + g.marker + '）在 manifest 任何 *-flag.js 里都找不到');
    const [file] = flagFile;

    const hit = entries.filter((cs) => (cs.js || []).includes(file));
    assert.equal(hit.length, 1, '标记 ' + file + ' 应恰出现在 1 个条目，实际 ' + hit.length);
    const entry = hit[0];

    assert.deepEqual(JSON.parse(JSON.stringify(g.js)), entry.js.slice(),
      '分组 ' + key + ' 的 js 与 manifest 条目不一致（必须逐项同序）');
    assert.deepEqual(JSON.parse(JSON.stringify(g.css)), (entry.css || []).slice(),
      '分组 ' + key + ' 的 css 与 manifest 条目不一致');
    assert.equal(entry.js[0], 'src/content/flags.js', '分组 ' + key + '：flags.js 必须第 0 位');
    assert.equal(entry.js[1], file, '分组 ' + key + '：标记必须紧跟开关层（第 1 位）');
  });
  ok('8 个分组的 js/css 全部与 manifest 逐项同序一致，标记都紧跟开关层');

  // 反向守卫：manifest 里每个 *-flag.js 都必须归属某个注册表分组
  // （防止「加了标记文件忘了进注册表」——那种组永远没人补注入）
  const markers = new Set(Object.values(registry).map((g) => g.marker));
  for (const [, mk] of markerOfFile) {
    assert.ok(markers.has(mk), 'manifest 里存在注册表之外的孤儿标记：' + mk);
  }
  ok('没有孤儿标记文件（每个标记都有归属分组）');
}

/* ---------------- B. 六个新分区的判定口径 ---------------- */
console.log('B. 新分区判定正则');
{
  const agentCode = read('src/live/live-agent.js');
  function reOf(name) {
    const m = new RegExp('var\\s+' + name + '\\s*=\\s*(\\/[\\s\\S]*?\\/);').exec(agentCode);
    assert.ok(m, '探子里找不到 ' + name);
    return vm.runInContext('(' + m[1] + ')', vm.createContext({}));
  }
  const cases = [
    ['RE_GOODS_LIST', {
      yes: ['https://fxg.jinritemai.com/ffa/g/list',
        'https://fxg.jinritemai.com/ffa/g/list?a=1',
        'https://fxg.jinritemai.com/ffa/g/channel-goods-manage/list'],
      no: ['https://fxg.jinritemai.com/ffa/g/create',
        'https://fxg.jinritemai.com/ffa/main',
        'https://buyin.jinritemai.com/dashboard/live/control']
    }],
    ['RE_GOODS_CREATE', {
      yes: ['https://fxg.jinritemai.com/ffa/g/create',
        'https://fxg.jinritemai.com/ffa/g/create?product_id=1&entrance=edit'],
      no: ['https://fxg.jinritemai.com/ffa/g/list',
        'https://store.weixin.qq.com/ffa/g/create']
    }],
    ['RE_MERCHANT', {
      yes: ['https://fxg.jinritemai.com/ffa/merchant/parent-campaign-detail'],
      no: ['https://fxg.jinritemai.com/ffa/merchantEvil',
        'https://fxg.jinritemai.com/ffa/g/list']
    }],
    ['RE_COMPASS_LIVE', {
      yes: ['https://compass.jinritemai.com/shop/live-detail?x=1',
        'https://compass.jinritemai.com/talent/live-statement'],
      no: ['https://compass.jinritemai.com/screen/live/1',
        'https://compass.jinritemai.com/shop/commodity/product-list']
    }],
    ['RE_COMPASS_SCREEN', {
      yes: ['https://compass.jinritemai.com/screen/live/1'],
      no: ['https://compass.jinritemai.com/shop/live-detail?x=1']
    }],
    ['RE_COMPASS_PRODUCT', {
      yes: ['https://compass.jinritemai.com/shop/commodity/product-list',
        'https://compass.jinritemai.com/shop/merchandise-traffic?x=1'],
      no: ['https://compass.jinritemai.com/screen/live/1',
        'https://compass.jinritemai.com/shop/live-detail']
    }]
  ];
  cases.forEach(([name, { yes, no }]) => {
    const re = reOf(name);
    yes.forEach((u) => assert.ok(re.test(u), name + ' 该命中却没命中：' + u));
    no.forEach((u) => assert.ok(!re.test(u), name + ' 不该命中却命中了：' + u));
  });
  ok('六个新分区正则正反样例全对（口径 = manifest matches）');
}

/* ---------------- C. 门铃行为（新分区） ---------------- */
console.log('C. 门铃行为');
{
  const FXG_HOME = 'https://fxg.jinritemai.com/ffa/main';
  const LIST = 'https://fxg.jinritemai.com/ffa/g/list?from=menu';
  const CREATE = 'https://fxg.jinritemai.com/ffa/g/create?entrance=new';

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
            if (o.silent) return undefined;
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

  // ① 别页（fxg 主页）：8 个分区全部静默
  {
    const s = boot(FXG_HOME);
    s.tick();
    s.timeouts.forEach((fn) => fn());
    assert.deepEqual(s.asks, [], 'fxg 主页不许发任何补注入请求');
    ok('fxg 主页完全静默（8 分区互不误触发）');
  }

  // ② 主页切进商品列表：按分组请求一次；失败后退避重试
  {
    const s = boot(FXG_HOME);
    s.ctx.location.href = LIST;
    s.tick();
    assert.deepEqual(s.asks, [{ type: 'dyc:injectGroup', group: 'goodsList', at: s.asks[0].at }],
      '切进商品列表应当按 goodsList 分组请一次');
    s.advance(3100); s.tick();
    assert.equal(s.asks.length, 2, '失败后必须按退避继续重试');
    ok('fxg 主页切商品列表按分组请求，失败退避重试');
  }

  // ③ 跨组切换：商品列表标记在场，切到编辑页必须按 goodsCreate 补注入
  //    （各组独立标记是分区制的硬前提，共键会让 B 组被旧标记挡死）
  {
    const s = boot(LIST);
    s.win.__DYC_GOODS_LIST_LOADED__ = true;    // 列表组已装
    s.ctx.location.href = CREATE;
    s.tick();
    assert.deepEqual(s.asks, [{ type: 'dyc:injectGroup', group: 'goodsCreate', at: s.asks[0].at }],
      '跨组切换必须按新分组请求，且不被旧分组的标记挡住');
    ok('跨组切换不被旧标记挡住（列表 → 编辑按 goodsCreate 补）');
  }

  // ④ 同组标记在场：来回切也不请求
  {
    const s = boot(FXG_HOME);
    s.win.__DYC_GOODS_LIST_LOADED__ = true;
    s.ctx.location.href = LIST;
    s.tick();
    s.ctx.location.href = FXG_HOME;
    s.tick();
    s.ctx.location.href = LIST;
    s.tick();
    s.timeouts.forEach((fn) => fn());
    s.advance(60000);
    s.tick();
    assert.deepEqual(s.asks, [], '标记在场时不许再请求');
    ok('同组来回切换彻底静音');
  }
}

/* ---------------- D. 诊断注册表 ---------------- */
console.log('D. __DYC_SPA_ZONES__ 与注册表对应');
{
  const clock = { now: 1700000000000 };
  const win = { addEventListener() {} };
  const ctx = vm.createContext({
    window: win,
    location: { href: 'https://fxg.jinritemai.com/ffa/main' },
    chrome: { runtime: { sendMessage(msg, cb) { if (cb) cb({ ok: true, installed: false }); } } },
    setInterval() { return 1; },
    setTimeout() { return 1; },
    clearTimeout() {},
    Date: { now: () => clock.now },
    console: { log() {}, warn() {} }
  });
  vm.runInContext(read('src/live/live-agent.js'), ctx);
  const zones = win.__DYC_SPA_ZONES__;
  assert.ok(Array.isArray(zones) && zones.length === 8, '诊断注册表应为 8 个分区');
  /* zones 是 vm 隔离域里的数组,必须用宿主 Array.from 拷出来 ——
     跨域数组带着隔离域的 Array.prototype,deepStrictEqual 连原型一起比会误红 */
  const zKeys = Array.from(zones, (z) => z.group).sort();
  const rKeys = Object.keys(registry).sort();
  assert.deepEqual(zKeys, rKeys, '门铃分区与注入注册表的键必须一一对应：' + zKeys.join(','));
  zones.forEach((z) => {
    const g = registry[z.group];
    assert.equal(z.marker, g.marker, z.group + ' 的标记与注册表不一致');
    assert.ok(z.triesKey && z.errKey && z.re && typeof z.re.test === 'function',
      z.group + ' 诊断字段不全');
  });
  ok('门铃 8 分区与注册表键/标记一一对应');
}

/* ---------------- E. 后台与诊断接线 ---------------- */
console.log('E. 后台与诊断接线');
{
  const sw = read('src/background/service-worker.js');
  assert.ok(/dyc:injectGroup/.test(sw), 'SW 没有通用分组分支');
  assert.ok(/DYC_INJECT_GROUPS\[msg\.group\]/.test(sw), '通用分支必须按注册表键分发');
  assert.ok(/未知补注入分组/.test(sw), '未知分组必须被拒绝（防探子与注册表漂移时误注入）');
  assert.ok(/importScripts\([^)]*live-control-assets\.js/.test(sw), 'SW 没有引入注入清单');
  ok('SW 通用分组分支 / 注册表分发 / 未知分组拒绝都在');

  const diag = read('src/content/diag.js');
  assert.ok(/collectSpaZones/.test(diag), 'diag 没有收集分区一览');
  assert.ok(/spaZones: collectSpaZones\(\)/.test(diag), '诊断快照没有带 spaZones 字段');
  assert.ok(/__DYC_SPA_ZONES__/.test(diag), 'diag 没有读探子的诊断注册表');
  ok('诊断快照带 spaZones 一览（逐分区 在/装/试/错）');
}

console.log('\n全绿：' + pass + ' 组');
