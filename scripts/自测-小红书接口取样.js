'use strict';
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const vm = require('node:vm');
const main = readFileSync(resolve(__dirname, '../src/content/stock-net-probe-main.js'), 'utf8');
const clipboard = [];
const itemId = '0123456789abcdef01234567';
let listener;
let fetches = 0;
const location = new URL('https://pgy.xiaohongshu.com/commerce/redlive/live_center_control');
class MockXHR {
  open() { throw new Error('取样器不能转发请求'); }
  send() { throw new Error('取样器不能转发请求'); }
}
const window = {
  addEventListener: (_, fn) => { listener = fn; },
  postMessage: (packet) => clipboard.push(packet),
  fetch: async (url) => {
    fetches++;
    if (url.includes('/cps_goods/search')) {
      return new Response(JSON.stringify({ data: { items: [{
        goods_id: { new_item_id: itemId, contract_id: 'private-contract' }, type: 4
      }] }, success: true }));
    }
    return new Response(JSON.stringify({ data: { items: [{ id: 'private-id' }] }, success: true }));
  }
};
vm.runInNewContext(main, { window, location, URL, URLSearchParams, XMLHttpRequest: MockXHR });
function command(type) {
  listener({ source: window, data: { source: 'DYC_STOCK_PROBE_CMD', type } });
}
(async () => {
  const body = JSON.stringify({ productId: 'private-id', token: 'private-token' });
  const url = '/api/live/submit?roomId=private-room';
  await window.fetch(url, { method: 'POST', body });
  assert.equal(clipboard.filter((m) => m.type === 'record').length, 0);
  command('arm');
  command('send');
  await window.fetch(url, { method: 'POST', body });
  await window.fetch('https://example.org/unrelated');
  await new Promise((r) => setImmediate(r));
  const records = clipboard.filter((m) => m.type === 'record');
  assert.equal(fetches, 3);
  assert.equal(records.length, 1);
  const record = records[0].data;
  assert.equal(record.method, 'POST');
  assert.equal(record.status, 200);
  assert.match(record.url, /\/api\/live\/submit.*"roomId":"string"/);
  assert.deepEqual(JSON.parse(record.reqBody), { productId: 'string', token: 'string' });
  assert.deepEqual(JSON.parse(record.respText), { data: { items: [{ id: 'string' }] }, success: 'boolean' });
  assert.doesNotMatch(JSON.stringify(clipboard), /private-/);
  const base = 'https://ark.xiaohongshu.com/api/edith/live/commerce';
  await window.fetch(base + '/v1/cps_goods/search?' + new URLSearchParams({
    query: itemId, source: '2', scene_id: '13', plan_id: '2026111800000001',
    query_param: JSON.stringify({ page: 1, token: 'private-token' })
  }));
  await window.fetch(base + '/live/center/goods/add', { method: 'POST', body: JSON.stringify({
    type: 'live', goods_list: [{ new_item_id: itemId, goods_type: 4, contract_id: 'private-contract' }]
  }) });
  await new Promise((r) => setImmediate(r));
  const business = clipboard.filter((m) => m.type === 'record' && m.data.business)
    .map((m) => JSON.parse(JSON.stringify(m.data.business)));
  assert.deepEqual(business, [
    { source: '2', scene_id: '13', plan_id: '2026111800000001', query_param: { page: 'number', token: 'string' }, queryMatchesNewItemId: true, matchedType: 4 },
    { type: 'live', goodsCount: 1, goodsType: 4, success: true, code: null }
  ]);
  // pgy 中控台（达人/买手侧）：同一 path 换 host 也必须采到业务参数，
  // 否则直提参数在 pgy 页面上永远为空。
  const before = clipboard.length;
  await window.fetch('https://pgy.xiaohongshu.com/api/edith/live/commerce/live/center/goods/add', {
    method: 'POST', body: JSON.stringify({ type: 'live', goods_list: [{ new_item_id: itemId, goods_type: 4 }] })
  });
  await new Promise((r) => setImmediate(r));
  const pgyBusiness = clipboard.slice(before).filter((m) => m.type === 'record' && m.data.business)
    .map((m) => JSON.parse(JSON.stringify(m.data.business)));
  assert.deepEqual(pgyBusiness, [{ type: 'live', goodsCount: 1, goodsType: 4, success: true, code: null }]);
  assert.doesNotMatch(JSON.stringify(clipboard), /private-|0123456789abcdef01234567/);
  location.pathname = '/commerce/redlive/live_screen/operation';
  await window.fetch(url, { method: 'POST', body });
  await new Promise((r) => setImmediate(r));
  assert.equal(clipboard.slice(before).filter((m) => m.type === 'record').length, 1,
    '从中控台切到直播大屏后，已开启的取样窗口也不能继续记录');
  const screenStart = clipboard.length;
  command('arm');
  await window.fetch(base + '/live/center/goods/add', { method: 'POST', body });
  await new Promise((r) => setImmediate(r));
  const screenRecords = clipboard.slice(screenStart).filter((m) => m.type === 'record');
  assert.equal(screenRecords.length, 1, '直播大屏应能单独开启接口取样');
  assert.equal(screenRecords[0].data.business, undefined, '中控台专用业务参数不进入大屏报告');
  assert.deepEqual(JSON.parse(screenRecords[0].data.reqBody), { productId: 'string', token: 'string' });
  assert.doesNotMatch(JSON.stringify(screenRecords), /private-/);
  console.log('小红书接口取样：手动开窗、业务参数、脱敏与跨页面覆盖通过');
})().catch((e) => { console.error(e); process.exitCode = 1; });
