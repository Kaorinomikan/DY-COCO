/** 消息盒子真实源码自测：扩展私有存储、旧键迁移与异步竞争。 */
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const CODE = fs.readFileSync(path.resolve(__dirname, '../src/content/dialog.js'), 'utf8');
const SW_CODE = fs.readFileSync(path.resolve(__dirname, '../src/background/service-worker.js'), 'utf8');
const MERGE_START = SW_CODE.indexOf('function mergeHistoryItems(');
const MERGE_END = SW_CODE.indexOf('function historyRequest(', MERGE_START);
assert.ok(MERGE_START >= 0 && MERGE_END > MERGE_START, '后台历史合并函数存在');
const mergeInBackground = require('node:vm').runInNewContext(SW_CODE.slice(MERGE_START, MERGE_END) + '\nmergeHistoryItems;');
const KEY = 'dycMsgHistory';
const windows = [];
let passed = 0;

function check(condition, message) {
  assert.ok(condition, message);
  passed++;
  console.log('通过：' + message);
}

function record(text, options = {}) {
  return { type: 'success', source: '渠道品', text, count: '', time: '12:00:00', ts: 1, ...options };
}

// 模拟消息传递与存储，合并直接执行后台真实源码，避免模拟算法掩盖双方差异。
function makeBackend(initial = []) {
  let stored = structuredClone(initial);
  return {
    calls: [],
    holdGet: false,
    holdMerge: false,
    failMerge: false,
    failClear: false,
    pendingGet: [],
    pendingMerge: [],
    get items() { return structuredClone(stored); },
    send(message, callback) {
      const request = structuredClone(message);
      this.calls.push(request);
      const run = () => {
        if (request.type === 'dyc:historyGet') {
          callback({ ok: true, items: structuredClone(stored) });
          return;
        }
        if (request.type === 'dyc:historyClear') {
          if (this.failClear) { callback({ ok: false }); return; }
          stored = [];
        } else if (request.type === 'dyc:historyMerge') {
          if (this.failMerge) { callback({ ok: false }); return; }
          stored = structuredClone(mergeInBackground(stored, request.items));
        } else {
          callback({ ok: false });
          return;
        }
        callback({ ok: true, items: structuredClone(stored) });
      };
      if (request.type === 'dyc:historyGet' && this.holdGet) this.pendingGet.push(run);
      else if (request.type === 'dyc:historyMerge' && this.holdMerge) this.pendingMerge.push(run);
      else queueMicrotask(run);
    }
  };
}

function makeWin(backend = makeBackend(), legacy, extra = {}) {
  const win = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
    runScripts: 'outside-only',
    pretendToBeVisual: true,
    url: 'https://fxg.jinritemai.com/ffa/g/channel-goods-manage/list'
  }).window;
  windows.push(win);
  if (legacy !== undefined) win.localStorage.setItem(KEY, JSON.stringify(legacy));
  win.localStorage.setItem('host-preference', 'keep');
  let hostWrites = 0;
  const originalSet = win.Storage.prototype.setItem;
  win.Storage.prototype.setItem = function (...args) {
    hostWrites++;
    return originalSet.apply(this, args);
  };
  if (!extra.noRuntime) win.chrome = { runtime: { sendMessage: backend.send.bind(backend), lastError: null } };
  win.eval(CODE + '\nwindow.__historyTest = { getQueue: () => dycHistoryQueue, getItems: () => JSON.stringify(dycHistory), setItems: (items) => { dycHistory = dycMergeHistory(items); } };');
  return { win, backend, get hostWrites() { return hostWrites; } };
}

async function flush(win) {
  // 保存会在 Promise 队列里继续追加；等队列引用稳定后再断言。
  for (;;) {
    const queue = win.__historyTest.getQueue();
    await queue;
    await Promise.resolve();
    if (queue === win.__historyTest.getQueue()) return;
  }
}

function history(win) { return JSON.parse(win.__historyTest.getItems()); }
function rows(win) { return [...win.document.querySelectorAll('.dyb-history-item')]; }

(async () => {
  {
    const ctx = makeWin();
    const { win, backend } = ctx;
    win.setStatus('处理完成', 'success', { source: '下架删除', count: '1/1' });
    win.setStatus('正在处理', 'running', { source: '下架删除' });
    win.setStatus('已开启', 'info', { source: '下架删除' });
    await flush(win);
    check(backend.calls[0].type === 'dyc:historyGet', '第一个后台请求必须读取私有历史');
    check(backend.items.length === 1 && backend.items[0].text === '处理完成', '只将结果消息写入后台存储');
    check(backend.items[0].source === '下架删除' && backend.items[0].count === '1/1', '来源、值、结果数分别保存');
    check(ctx.hostWrites === 0 && win.localStorage.getItem(KEY) === null, '不向宿主 localStorage 写历史');
    check(backend.calls.every((call) => !Object.hasOwn(call, 'scope')), '不向后台传入可被构造的 scope');
    const fresh = makeWin(backend).win;
    await flush(fresh);
    fresh.openHistory();
    const row = rows(fresh)[0];
    check(rows(fresh).length === 1 && row.textContent.includes('处理完成'), '新页面实例仍能读回私有历史');
    check(row.querySelector('.h-source').textContent === '下架删除' && row.querySelector('.h-count').textContent === '1/1'
      && row.querySelectorAll('.h-sep').length === 2, '真实盒子保持三段式渲染');
  }

  {
    const legacy = record('旧版消息');
    const ctx = makeWin(makeBackend([legacy, record('后台消息', { ts: 2 })]), [legacy]);
    await flush(ctx.win);
    check(ctx.backend.items.length === 2 && history(ctx.win).length === 2, '旧键与后台普通完全重复条目只保留一条');
    check(ctx.win.localStorage.getItem(KEY) === null, '旧键仅在迁移合并成功后删除');
    check(ctx.win.localStorage.getItem('host-preference') === 'keep' && ctx.hostWrites === 0, '迁移不改写宿主其他键');
  }

  {
    const backend = makeBackend([record('后台旧状态', { key: 'autoLoop:cycle' })]);
    backend.holdGet = true;
    const { win } = makeWin(backend, [record('待迁移消息', { ts: 2 })]);
    await Promise.resolve();
    win.setStatus('加载期间新商品', 'success', { source: '自动循环讲解', count: '第 2 轮', histKey: 'autoLoop:cycle' });
    backend.pendingGet.shift()();
    await flush(win);
    check(history(win).length === 2 && backend.items.length === 2, '异步加载期间的新消息与旧键都不丢失');
    check(history(win).find((item) => item.key === 'autoLoop:cycle').text === '加载期间新商品', '加载旧 histKey 不覆盖本页最新状态');
  }

  {
    const backend = makeBackend();
    backend.failMerge = true;
    const { win } = makeWin(backend, [record('保存失败保留旧键')]);
    await flush(win);
    win.setStatus('离线消息', 'error', { source: '渠道品' });
    await flush(win);
    check(!!win.localStorage.getItem(KEY) && history(win).length === 2, '迁移或保存失败保留旧键与内存消息');
    backend.failMerge = false;
    await win.dycSaveHistory();
    check(backend.items.length === 2 && win.localStorage.getItem(KEY) === null, '后续成功保存补回失败消息并完成迁移');
    const offline = makeWin(undefined, [record('无后台旧消息')], { noRuntime: true });
    offline.win.setStatus('无后台新消息', 'success');
    await flush(offline.win);
    check(history(offline.win).length === 2 && !!offline.win.localStorage.getItem(KEY) && offline.hostWrites === 0,
      '无后台时内存可用且旧键不删不写');
  }

  {
    const backend = makeBackend(Array.from({ length: 120 }, (_, index) => record('第' + (index + 1) + '条', { ts: index + 1 })));
    const { win } = makeWin(backend);
    await flush(win);
    win.openHistory();
    check(history(win).length === 100 && rows(win).length === 100 && rows(win)[0].textContent.includes('第120条'), '加载上限 100 条并按最新优先展示');
    for (let index = 121; index <= 125; index++) win.setStatus('第' + index + '条', 'success', { standalone: true });
    await flush(win);
    check(backend.items.length === 100 && history(win).length === 100 && !history(win).some((item) => item.text === '第21条'), '新增消息后内存与后台均只保留最新 100 条');
  }

  {
    const { win, backend } = makeWin();
    await flush(win);
    for (let index = 1; index <= 40; index++) win.setStatus('测试商品', 'success', {
      source: '自动循环讲解', count: '第 ' + index + ' 轮', histKey: 'autoLoop:cycle'
    });
    await flush(win);
    check(backend.items.length === 1 && backend.items[0].count === '第 40 轮', '连续 40 轮固定 histKey 仅占一条且更新到最终状态');
    win.setStatus('另一商品', 'success', { source: '渠道品', standalone: true });
    win.setStatus('新商品', 'success', { source: '自动循环讲解', count: '第 41 轮', histKey: 'autoLoop:cycle' });
    await flush(win);
    check(backend.items.length === 2 && backend.items.at(-1).text === '新商品', 'histKey 更新后移到最新位置');
    const ordinary = record('普通相同文案', { ts: Date.now() + 1 });
    win.__historyTest.setItems([ordinary, ordinary, { ...ordinary, count: '2', ts: ordinary.ts + 60000 }, { ...ordinary, ts: ordinary.ts + 120000 }]);
    check(history(win).length === 3, '普通五字段完全去重后保留相隔60秒的不同消息');
  }

  {
    const backend = makeBackend([record('延迟加载的旧消息')]);
    backend.holdGet = true;
    const { win } = makeWin(backend, [record('旧键消息')]);
    await Promise.resolve();
    const cleared = win.dycClearHistory();
    check(history(win).length === 0, '清空立即清除内存与渲染');
    backend.pendingGet.shift()();
    check(await cleared, '清空后台成功');
    await flush(win);
    check(history(win).length === 0 && backend.items.length === 0 && win.localStorage.getItem(KEY) === null, '清空与未完成加载竞争时旧历史不复活');
    backend.holdGet = false;
    const fresh = makeWin(backend).win;
    await flush(fresh);
    check(history(fresh).length === 0, '清空后重新加载仍为空');
  }

  {
    const backend = makeBackend();
    const { win } = makeWin(backend);
    await flush(win);
    backend.holdMerge = true;
    win.setStatus('清空前保存中', 'success');
    await Promise.resolve();
    const cleared = win.dycClearHistory();
    win.setStatus('清空后新消息', 'success', { standalone: true });
    backend.holdMerge = false;
    backend.pendingMerge.shift()();
    await cleared;
    await flush(win);
    check(backend.items.length === 1 && backend.items[0].text === '清空后新消息' && history(win).length === 1,
      '清空与未完成保存竞争时只保留清空后的新消息');
    backend.failClear = true;
    check(await win.dycClearHistory() === false && history(win).length === 0, '清空失败不会回灌后台旧历史');
    win.setStatus('清空失败后的新消息', 'success', { standalone: true });
    await flush(win);
    check(history(win).length === 1 && history(win)[0].text === '清空失败后的新消息', '清空待重试时新消息仍正常显示');
    backend.failClear = false;
    await win.dycSaveHistory();
    check(backend.items.length === 1 && backend.items[0].text === '清空失败后的新消息', '恢复后先重试清空再保存新消息');
  }

  {
    const { win } = makeWin(undefined, [{ text: null }, null, '坏条目', record('有效记录')]);
    await flush(win);
    check(history(win).length === 1 && history(win)[0].text === '有效记录', '旧键脏数据只迁移有效消息');
  }
  {
    const { win, backend } = makeWin();
    await flush(win);
    let now = 100000;
    win.Date.now = () => now;
    win.pushHistory('error', { source: '渠道品', text: '相邻重复', count: '1' });
    await flush(win);
    now += 1000;
    win.pushHistory('error', { source: '渠道品', text: '相邻重复', count: '2' });
    await flush(win);
    check(history(win).length === 1 && history(win)[0].count === '2' && history(win)[0].ts === now,
      '相邻同类型来源文案60秒内只更新时间和结果数');
    check(backend.items.length === 1 && backend.items[0].count === '2', '后台保存及回执不会复活60秒去重前的旧版本');
    win.Element.prototype.replaceChildren = undefined;
    win.renderHistory();
    check(rows(win).length === 1, '无replaceChildren的旧内核仍能批量渲染');
    win.document.querySelector('.dyb-history-clear').click();
    await flush(win);
    check(history(win).length === 0 && backend.items.length === 0, '消息盒子清空按钮已接入私有存储清空');
  }
  {
    const { win } = makeWin(makeBackend([
      record('数值结果数', { count: 12, ts: '123' }),
      record('不支持类型', { type: 'other' })
    ]));
    await flush(win);
    check(history(win).length === 1 && history(win)[0].count === '12' && history(win)[0].ts === 123,
      '前后端统一类型过滤与数值结果数时间戳正规化');
  }
  console.log('\n全部通过：' + passed + ' 项');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => {
  for (const win of windows) win.close();
});
