'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
let JSDOM;
try { ({ JSDOM } = require('jsdom')); }
catch (_) { ({ JSDOM } = require('C:/Users/79412/.workbuddy/binaries/node/workspace/node_modules/jsdom')); }
const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB';

(async () => {
  const dom = new JSDOM('<body><micro-app></micro-app></body>', {
    url: 'https://store.weixin.qq.com/shop/goods/entry?productId=test', runScripts: 'outside-only'
  });
  const w = dom.window;
  try {
    const root = w.document.querySelector('micro-app').attachShadow({ mode: 'open' });
    // 真机结构：宽整行 wrp → 隐藏 input + draggable_content → 空白 picture_add_content。
    root.innerHTML = '<form>' + ['first', 'second', 'disabled', 'video', 'ambiguous'].map((id) =>
      '<div class="weui-desktop-new-upload__wrp" id="' + id + '">'
      + '<input type="file" accept="' + (id === 'video' ? 'video/*' : '.bmp,.png,.jpeg,.jpg') + '"'
      + (id === 'disabled' ? ' disabled' : '') + ' style="display:none">'
      + (id === 'ambiguous' ? '<input type="file" accept="image/*">' : '')
      + '<div class="dragable_content"><div class="ignore-elements">'
      + '<div class="content content_add undraggable margin_bottom">'
      + '<div class="picture_add_content"><div class="icon_add"></div></div>'
      + '</div></div></div></div>').join('') + '</form>';
    w.HTMLElement.prototype.getBoundingClientRect = function () {
      const square = this.classList.contains('picture_add_content') || this.classList.contains('content_add');
      const width = this.tagName === 'INPUT' ? 0 : square ? 112 : 1176;
      const height = this.tagName === 'INPUT' ? 0 : square ? 112 : 122;
      return { width, height, top: 0, left: 0, right: width, bottom: height };
    };
    w.eval(read('src/content/flags.js'));
    w.dycReadFlags = () => Promise.resolve({ goodsImagePaste: true });
    let watch;
    w.dycWatchFlags = (cb) => { watch = cb; };
    w.debugLog = () => {};
    const msgs = [];
    w.setStatus = (value, kind, opts) => msgs.push({ value, kind, opts });
    w.chrome = { runtime: { id: 'wx-sibling', sendMessage(m, cb) { cb({ ok: true, dataUrl: PNG, mime: 'image/png' }); } } };
    w.DataTransfer = class {
      constructor() { this.files = []; this.items = { add: (file) => this.files.push(file) }; }
    };
    Object.defineProperty(w.HTMLInputElement.prototype, 'files', {
      configurable: true, get() { return this.__files || []; }, set(v) { this.__files = v; }
    });
    const first = root.querySelector('#first');
    const second = root.querySelector('#second');
    let changes = 0;
    let nativeClicks = 0;
    first.addEventListener('click', () => nativeClicks++);
    first.querySelector('input').addEventListener('change', () => {
      changes++;
      const img = w.document.createElement('img');
      img.src = 'blob:uploaded';
      first.querySelector('.picture_add_content').appendChild(img);
    });
    w.eval(read('src/content/goods-image-paste.js'));
    await sleep(30);
    const btn = first.querySelector('.picture_add_content button');
    assert.ok(btn, '真实兄弟结构的空白方块没有粘贴按钮（候选有、已挂 0）');
    assert.ok(second.querySelector('.picture_add_content button'));
    assert.equal(first.querySelector(':scope > button'), null, '不能挂到 1176px 整行上');
    for (const id of ['disabled', 'video', 'ambiguous']) {
      assert.equal(root.querySelector('#' + id + ' button'), null, id + ' 不得误挂或猜测 input');
    }
    btn.click();
    await sleep(200);
    assert.equal(changes, 1);
    assert.equal(nativeClicks, 0);
    assert.equal(first.querySelector('input').files.length, 1);
    assert.equal(second.querySelector('input').files.length, 0, '不得把图片塞到另一个上传组');
    assert.equal(msgs.filter((m) => m.kind === 'success').length, 1);
    await sleep(700);
    assert.equal(first.querySelector('button'), null, '出图后移除按钮');
    assert.ok(second.querySelector('button'), '其他空白框继续保留');
    watch({ goodsImagePaste: false });
    assert.equal(root.querySelector('button'), null);
    console.log('通过：微信真实兄弟结构认框、输入关联、单次上传、隔离、防误挂与开关清理。');
  } finally { w.close(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
