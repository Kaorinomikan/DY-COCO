'use strict';
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const vm = require('node:vm');
const main = readFileSync(resolve(__dirname, '../src/content/stock-net-probe-main.js'), 'utf8');

let listener;
const posted = [];
const opened = [];

class PageXHR {
  constructor() {
    this.withCredentials = false;
    this.readyState = 0;
    this.status = 0;
    this.responseText = '';
  }
  open(method, url) { this.method = method; this.url = url; opened.push(this); }
  setRequestHeader() {}
  send() {
    this.readyState = 4;
    this.status = 200;
    this.responseText = '{"success":true}';
    if (this.onreadystatechange) this.onreadystatechange();
  }
  addEventListener() {}
}

const window = {
  addEventListener: (_, fn) => { listener = fn; },
  postMessage: (packet) => { posted.push(packet); },
  fetch: async () => new Response('{}')
};
const location = new URL('https://pgy.xiaohongshu.com/commerce/redlive/live_center_control');
vm.runInNewContext(main, { window, location, URL, URLSearchParams, XMLHttpRequest: PageXHR });

function send(id, credentials) {
  listener({
    source: window,
    data: {
      source: 'DYC_STOCK_PROBE_CMD', type: 'send', id,
      url: 'https://ark.xiaohongshu.com/api/edith/live/commerce/v1/cps_goods/search?query=x',
      method: 'GET', body: null, credentials
    }
  });
  return posted.filter((p) => p.type === 'sendResult' && p.id === id).at(-1);
}

// pgy 页面请求 ark 接口属跨子域，不带凭证会被平台判「缺失登录凭证」(-13000)。
const withCred = send(1, true);
assert.equal(opened.length, 1);
assert.equal(opened[0].withCredentials, true);
assert.equal(withCred.status, 200);

// 不要求凭证时不擅自带上，避免其它平台的跨域请求被 CORS 拒绝。
send(2, false);
assert.equal(opened[1].withCredentials, false);

console.log('小红书直提凭证：跨域转发按需携带登录凭证通过');
