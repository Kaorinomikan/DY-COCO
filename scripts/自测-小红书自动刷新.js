'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const source = fs.readFileSync(path.join(__dirname, '../src/live/xhs-auto-refresh.js'), 'utf8');
const id = 'dyc-xhs-auto-refresh';

(async () => {
  const dom = new JSDOM(`
    <main class="control-container">
      <button id="start">立即开播</button>
      <section class="goods-manage-container"><div class="goods-list">
        <div class="goods-list-tab"><div class="refresh-tips">
          最近更新：2026年11月19日 22:02<span class="refresh-tips-icon"><svg></svg></span>
        </div></div>
        <input type="search"><button id="dyc-xhs-cart-paste">粘贴加车</button>
        <button>立即开播</button>
      </div></section>
    </main>
    <div class="refresh-tips"><span class="refresh-tips-icon"></span></div>
  `, {
    url: 'https://pgy.xiaohongshu.com/commerce/redlive/live_center_control',
    runScripts: 'outside-only',
    pretendToBeVisual: true
  });
  const { window: w } = dom;
  const d = w.document;
  let now = 0, ticks, watcher, hidden = false, clicks = 0, otherClicks = 0;
  w.Date.now = () => now;
  w.setInterval = (fn) => { ticks = fn; return 1; };
  w.clearInterval = () => { ticks = null; };
  w.DYC_PAGE_PATTERNS = { xhsCtrl: /\/live_center_control$/ };
  w.dycReadFlags = () => Promise.resolve({});
  w.dycWatchFlags = (fn) => { watcher = fn; };
  w.HTMLElement.prototype.getClientRects = function () {
    return this.isConnected && !this.closest('[hidden]') ? [{}] : [];
  };
  Object.defineProperty(d, 'hidden', { get: () => hidden });
  const row = () => d.querySelector('.goods-list-tab .refresh-tips');
  const control = () => d.getElementById(id);
  const original = row().querySelector('.refresh-tips-icon');
  const panel = d.querySelector('.goods-manage-container');
  function showLoading() {
    const mask = d.createElement('div');
    mask.className = 'd-v-loading';
    panel.appendChild(mask);
    return mask;
  }
  original.addEventListener('click', () => clicks++);
  d.querySelector('body > .refresh-tips').addEventListener('click', () => otherClicks++);
  function advance(ms) { now += ms; ticks?.(); }

  try {
    w.eval(source);
    await Promise.resolve();
    const button = control();
    assert.equal(row().firstChild, button, '自动刷新在「最近更新」文本前');
    assert.equal(button.dataset.state, 'auto');
    assert.equal(w.getComputedStyle(button).position, 'relative');
    const style = button.style.cssText;
    w.dispatchEvent(new w.Event('scroll'));
    advance(9999);
    assert.equal(button.style.cssText, style, '滚动无需坐标跟位');
    assert.equal(clicks, 0);
    let autoMask;
    original.addEventListener('click', () => w.queueMicrotask(() => {
      autoMask = showLoading();
    }), { once: true });
    advance(1);
    assert.equal(clicks, 1, '确认未开播每 10 秒只点一次');
    await Promise.resolve();
    assert.equal(w.getComputedStyle(autoMask).display, 'none', '自动刷新时遮罩不挡商品操作');
    autoMask.remove();
    const nativeMask = showLoading();
    assert.notEqual(w.getComputedStyle(nativeMask).display, 'none', '其他商品加载仍显示遮罩');
    nativeMask.remove();

    const start = d.getElementById('start');
    start.textContent = '结束直播';
    advance(10000);
    assert.equal(clicks, 1, '播中或状态未知时自动档暂停');
    assert.equal(button.dataset.state, 'off');
    button.click();
    assert.equal(button.dataset.state, 'force');
    advance(10000);
    assert.equal(clicks, 2, '强制档仍触发原生刷新');

    const drawer = d.createElement('div');
    drawer.className = 'd-drawer';
    d.body.appendChild(drawer);
    advance(10000);
    assert.equal(clicks, 2, '抽屉打开时让位');
    drawer.remove();
    hidden = true;
    advance(10000);
    assert.equal(clicks, 2, '后台标签页暂停');
    hidden = false;
    d.querySelector('input').dispatchEvent(new w.Event('input', { bubbles: true }));
    advance(7999);
    assert.equal(clicks, 2, '正在输入时让位');
    const paste = d.getElementById('dyc-xhs-cart-paste');
    paste.disabled = true;
    advance(1);
    assert.equal(clicks, 2, '粘贴加车处理中让位');
    paste.disabled = false;
    advance(1);
    assert.equal(clicks, 3, '让位条件解除后只补一次');

    button.click();
    advance(10000);
    assert.equal(clicks, 3, '手动暂停保持生效');
    start.textContent = '立即开播';
    button.click();
    assert.equal(button.dataset.state, 'auto');

    row().parentElement.innerHTML = '<div class="refresh-tips">最近更新：<span class="refresh-tips-icon"></span></div>';
    row().querySelector('.refresh-tips-icon').addEventListener('click', () => clicks++);
    advance(10000);
    assert.equal(row().firstChild, button, '商品栏重建后补回同一个圆钮');
    assert.equal(clicks, 4);
    assert.equal(otherClicks, 0, '只触发商品栏的原生刷新');
    watcher({ xhsAutoRefresh: false });
    assert.equal(control(), null);
    assert.equal(ticks, null);
    watcher({ xhsAutoRefresh: true });
    assert.ok(control());
    w.history.pushState({}, '', '/other');
    w.dispatchEvent(new w.Event('dyc:pagechange'));
    assert.equal(control(), null);
    assert.equal(ticks, null);
    console.log('小红书自动刷新自测通过：行内挂载、三档及节拍、操作让位、重建、开关与路由。');
  } finally {
    w.close();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
