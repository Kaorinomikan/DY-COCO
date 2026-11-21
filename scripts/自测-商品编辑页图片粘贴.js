'use strict';

/**
 * 自测 · 商品编辑页「图片剪贴板粘贴」(2026-11-08 建)
 *
 * 被测:src/content/goods-image-paste.js
 *
 * 这条改动的坑不在算法,而在**认框**与**塞文件**两件事上:
 *   ① 认框靠「input[type=file] + 上传图片文案」两条语义路径,不认哈希类名;
 *      认错就会把按钮挂到整行/整列上,或者有图的框里也挤一个(用户要求「不挡位置」)。
 *   ② 塞文件必须走 input.files + change(React 受控组件的入口),
 *      并且**三级通道逐级验证**,不许一次把三条全打出去 —— 那会重复上传。
 *
 * jsdom 的现实约束(别改断言去迁就):
 *   · 所有 getBoundingClientRect 都是 0 ⇒ 页面自己的 isVisible 恒假,
 *     所以这里用桩替换 isVisible / findAllByText,只测我们自己的判定逻辑。
 *   · HTMLInputElement.files 在 jsdom 上只接受真 FileList ⇒ 覆写原型描述符,
 *     记录我们塞进去的东西,再看 change 有没有发出去。
 *
 * 用法：node scripts/自测-商品编辑页图片粘贴.js（run-selftests.py 自动带上）
 */

const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');

const SRC_UNDER_TEST = 'src/content/goods-image-paste.js';

let JSDOM;
try { ({ JSDOM } = require('jsdom')); }
catch (_) { ({ JSDOM } = require('C:/Users/79412/.workbuddy/binaries/node/workspace/node_modules/jsdom')); }

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

let pass = 0;
let fail = 0;
const failures = [];
function check(name, fn) {
  try { fn(); pass++; console.log('  ✓ ' + name); }
  catch (e) { fail++; failures.push(name + ' —— ' + e.message); console.log('  ✗ ' + name); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8AAAwAB/wF8mDP8AAAAAElFTkSuQmCC';

const HTML = `<!doctype html><html><body>
<div id="goodsEditScrollContainer">
  <div id="emptyTile">
    <div class="plus">+</div>
    <div class="tip">上传图片</div>
    <input type="file" accept="image/*" style="display:none">
  </div>
  <div id="certificateTile"><span>+</span><span>0/20</span><input type="file" accept=".JPG, .PNG, .jpeg" style="display:none"></div>
  <div id="reportTile"><span>＋</span><span>0/20</span><input type="file" accept="application/pdf, image/jpeg" style="display:none"></div>
  <div id="labelTile"><span>+</span><span>0/20</span><input type="file" style="display:none"></div>
  <div id="pdfTile"><span>上传图片</span><input type="file" accept=".pdf"></div>
  <div id="disabledTile"><span>上传图片</span><input type="file" accept="image/*" disabled></div>
  <div id="filledTile">
    <img src="https://example.test/a.png" alt="">
    <input type="file" accept="image/*" style="display:none">
  </div>
  <div id="videoTile">
    <input type="file" accept="video/mp4" style="display:none">
  </div>
</div>
<!-- 2026-11-08 真机踩到的两类误挂：拖拽控制器的预览克隆 + 表单外的浮层工具条 -->
<div id="DOUXIAOER_DRAG_CONTROLLER">
  <div id="dragClone"><div class="tip">上传图片</div><input type="file" accept="image/*" style="display:none"></div>
</div>
<div id="iconBar">
  <span class="ico"></span><span class="ico"></span>
  <input type="file" accept="image/*" style="display:none">
</div>
<div id="portalTile">
  <div class="tip">上传图片</div>
  <input type="file" accept="image/*" style="display:none">
</div>
</body></html>`;

(async function main() {
  const dom = new JSDOM(HTML, { url: 'https://fxg.jinritemai.com/ffa/g/create?entrance=edit', runScripts: 'outside-only' });
  const win = dom.window;
  const doc = win.document;

  /* ---- 桩:开关层 ---- */
  let flags = { goodsImagePaste: true };
  let watchCb = null;
  win.chrome = {
    runtime: {
      id: 'selftest',
      lastError: null,
      sendMessage(msg, cb) {
        if (msg && msg.type === 'dyc:readClipboardImage') {
          setTimeout(() => cb({ ok: true, dataUrl: PNG, mime: 'image/png', size: 68 }), 5);
          return;
        }
        if (typeof cb === 'function') setTimeout(() => cb({ ok: false }), 0);
      }
    }
  };
  win.dycReadFlags = () => Promise.resolve(flags);
  win.dycWatchFlags = (cb) => { watchCb = cb; };

  /* ---- 桩:页面工具 ---- */
  win.isVisible = () => true;
  win.findAllByText = (text) => {
    const out = [];
    const walk = (el) => {
      if (el.nodeType === 3) {
        if (el.nodeValue && el.nodeValue.trim() === text) out.push(el.parentElement);
        return;
      }
      if (el.nodeType !== 1) return;
      for (const c of el.childNodes) walk(c);
    };
    walk(doc.body);
    return out;
  };
  win.debugLog = () => {};

  const messages = [];
  win.setStatus = (value, kind, opts) => messages.push({ value, kind, opts });

  /* ---- 桩:DataTransfer + files 描述符 ---- */
  let dtMade = 0;
  win.DataTransfer = class FakeDataTransfer {
    constructor() {
      dtMade++;
      this._files = [];
      this.items = { add: (f) => { this._files.push(f); } };
      const self = this;
      Object.defineProperty(this, 'files', {
        get() { return { length: self._files.length, item: (i) => self._files[i], 0: self._files[0] }; }
      });
    }
  };
  Object.defineProperty(win.HTMLInputElement.prototype, 'files', {
    configurable: true,
    get() { return this.__dycFiles || { length: 0, item: () => null }; },
    set(v) { this.__dycFiles = v; }
  });

  win.DYC_PAGE_PATTERNS = { goodsEdit: /^https:\/\/fxg\.jinritemai\.com\/ffa\/g\/create/ };

  win.eval(read(SRC_UNDER_TEST));
  await sleep(30);   // 等 dycReadFlags().then 里的首扫

  console.log('\n【一】认框与挂载');
  const emptyTile = doc.getElementById('emptyTile');
  const filledTile = doc.getElementById('filledTile');
  const videoTile = doc.getElementById('videoTile');

  check('空白上传框挂上按钮', () => {
    assert.ok(emptyTile.querySelector('.dyc-imgpaste-btn'), '空白框没有按钮');
  });
  check('标准上传框和加号计数资质格同时挂载，兼容扩展名与混合类型', () => {
    for (const id of ['certificateTile', 'reportTile', 'labelTile']) {
      assert.equal(doc.querySelectorAll('#' + id + ' .dyc-imgpaste-btn').length, 1, id);
    }
    assert.equal(doc.querySelector('#pdfTile .dyc-imgpaste-btn'), null, '纯 PDF');
    assert.equal(doc.querySelector('#disabledTile .dyc-imgpaste-btn'), null, '禁用框');
  });
  check('按钮是框的直接子元素（absolute 定位的包含块）', () => {
    assert.equal(emptyTile.querySelector('.dyc-imgpaste-btn').parentElement, emptyTile);
  });
  check('已有图的框不挂按钮（不挡平台的编辑/删除）', () => {
    assert.equal(filledTile.querySelector('.dyc-imgpaste-btn'), null);
  });
  check('非图片类型的上传框不挂按钮', () => {
    assert.equal(videoTile.querySelector('.dyc-imgpaste-btn'), null);
  });
  check('拖拽控制器的预览克隆不挂按钮（会顶住平台浮层）', () => {
    assert.equal(doc.querySelector('#dragClone .dyc-imgpaste-btn'), null);
  });
  check('只有图标、没有「上传图片」文案的容器不挂按钮', () => {
    assert.equal(doc.querySelector('#iconBar .dyc-imgpaste-btn'), null);
  });
  check('表单容器外的浮层（挂在 body 上的克隆/工具条）不挂按钮', () => {
    assert.equal(doc.querySelector('#portalTile .dyc-imgpaste-btn'), null);
  });
  check('重复扫描不会挂第二个', () => {
    win.eval('void 0');                       // 占位:扫描由下一段滚动/变更触发
    const btn = emptyTile.querySelectorAll('.dyc-imgpaste-btn');
    assert.equal(btn.length, 1);
  });

  const dynamicTile = doc.createElement('div');
  dynamicTile.id = 'dynamicTile';
  dynamicTile.innerHTML = '<span>+</span><span>0/20</span><input type="file" accept=".webp">';
  doc.getElementById('goodsEditScrollContainer').appendChild(dynamicTile);
  await sleep(650);
  check('后展开的资质格自动挂载，重扫保留所有原有空白格且不重复', () => {
    for (const id of ['emptyTile', 'certificateTile', 'reportTile', 'labelTile', 'dynamicTile']) {
      assert.equal(doc.querySelectorAll('#' + id + ' .dyc-imgpaste-btn').length, 1, id);
    }
  });

  console.log('\n【二】点一下:读剪贴板 → 塞进 input → 平台出图');
  const fileInput = emptyTile.querySelector('input[type="file"]');
  let changed = 0;
  fileInput.addEventListener('change', () => {
    changed++;
    /* 平台收到 change 后会在框里长出缩略图 —— 这里模拟它的行为,
       我们的「三级通道」验证逻辑靠这个判定第一级成功。 */
    setTimeout(() => {
      const img = doc.createElement('img');
      img.setAttribute('src', 'blob:fake');
      emptyTile.appendChild(img);
    }, 5);
  });

  const btn = emptyTile.querySelector('.dyc-imgpaste-btn');
  btn.dispatchEvent(new win.MouseEvent('click', { bubbles: true, cancelable: true }));
  await sleep(400);

  check('input.files 收到一张图', () => {
    assert.ok(fileInput.__dycFiles, '没有塞 files');
    assert.equal(fileInput.__dycFiles.length, 1, 'files 长度不是 1');
  });
  check('派发了 change（React 受控组件的入口）', () => {
    assert.equal(changed, 1, 'change 派发次数:' + changed);
  });
  check('只走了第一条通道（没有重复上传）', () => {
    assert.equal(dtMade, 1, 'DataTransfer 造了 ' + dtMade + ' 次，说明多条通道都发出去了');
  });
  check('报了一条成功消息（三段式：来源/值/结果数）', () => {
    const ok = messages.filter((m) => m.kind === 'success');
    assert.equal(ok.length, 1, '成功消息 ' + ok.length + ' 条');
    assert.equal(ok[0].opts.source, '图片粘贴');
    assert.equal(ok[0].opts.count, '已入框');
  });

  /* 成功后会安排一次延迟重扫(600ms)把按钮摘掉 —— 等它跑完再断言 */
  await sleep(800);
  check('出图后按钮自动摘掉', () => {
    assert.equal(emptyTile.querySelector('.dyc-imgpaste-btn'), null, '出图后按钮还在');
  });

  const reportTile = doc.getElementById('reportTile');
  const reportInput = reportTile.querySelector('input');
  let reportChanges = 0;
  reportInput.addEventListener('change', () => {
    reportChanges++;
    setTimeout(() => {
      const img = doc.createElement('img');
      img.src = 'blob:report';
      reportTile.appendChild(img);
    }, 5);
  });
  reportTile.querySelector('.dyc-imgpaste-btn').dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  await sleep(400);
  check('资质格贴图只写入被点中的格子，且一次只提交一张', () => {
    assert.equal(reportInput.__dycFiles.length, 1);
    assert.equal(reportChanges, 1);
    assert.equal(doc.querySelector('#certificateTile input').__dycFiles, undefined);
    assert.equal(doc.querySelector('#labelTile input').__dycFiles, undefined);
  });

  console.log('\n【三】失败路径:剪贴板没图 / 通道全不通');
  {
    const dom2 = new JSDOM(HTML, { url: 'https://fxg.jinritemai.com/ffa/g/create', runScripts: 'outside-only' });
    const w2 = dom2.window;
    const d2 = dom2.window.document;
    w2.chrome = {
      runtime: {
        id: 'selftest2', lastError: null,
        sendMessage(msg, cb) {
          setTimeout(() => cb({ ok: false, error: '剪贴板里没有图片' }), 5);
        }
      }
    };
    w2.dycReadFlags = () => Promise.resolve({ goodsImagePaste: true });
    w2.dycWatchFlags = () => {};
    w2.isVisible = () => true;
    w2.findAllByText = () => [];
    w2.debugLog = () => {};
    w2.DataTransfer = win.DataTransfer;
    Object.defineProperty(w2.HTMLInputElement.prototype, 'files', {
      configurable: true,
      get() { return this.__dycFiles || { length: 0 }; },
      set(v) { this.__dycFiles = v; }
    });
    const msgs2 = [];
    w2.setStatus = (value, kind, opts) => msgs2.push({ value, kind, opts });
    w2.DYC_PAGE_PATTERNS = { goodsEdit: /^https:\/\/fxg\.jinritemai\.com\/ffa\/g\/create/ };

    w2.eval(read(SRC_UNDER_TEST));
    await sleep(30);

    const tile = d2.getElementById('emptyTile');
    const b2 = tile.querySelector('.dyc-imgpaste-btn');
    assert.ok(b2, '第二个环境没挂上按钮');
    b2.dispatchEvent(new w2.MouseEvent('click', { bubbles: true }));
    await sleep(650);

    check('剪贴板没图时给 alert，且不假报成功', () => {
      const al = msgs2.filter((m) => m.kind === 'alert');
      assert.equal(al.length, 1, 'alert 条数:' + al.length);
      assert.equal(al[0].opts.count, '未入框');
      assert.ok(msgs2.every((m) => m.kind !== 'success'), '失败却报了成功');
    });
  }

  console.log('\n【四】开关关闭 → 按钮全部摘掉');
  watchCb({ goodsImagePaste: false });
  await sleep(20);
  check('关掉开关后页面上没有按钮残留', () => {
    assert.equal(doc.querySelectorAll('.dyc-imgpaste-btn').length, 0);
  });
  check('关掉开关后清掉了标记属性', () => {
    assert.equal(doc.querySelectorAll('[data-dyc-imgpaste-tile]').length, 0);
  });

  console.log('\n【五】空态文案不是「上传图片」时,退回结构识别(真机 2026-11-08)');
  {
    /* 真机日志:候选 28 · 已挂 0 —— 页面上有上传框,但没有一个含「上传图片」四个字。
       这一档是那次事故的回归:全页都没有上传类文案时,必须靠结构把按钮挂上。 */
    const html2 = `<!doctype html><html><body>
      <div id="goodsEditScrollContainer">
        <div id="plainTile"><span>+</span><input type="file" accept="image/*" style="display:none"></div>
      </div>
    </body></html>`;
    const dom3 = new JSDOM(html2, { url: 'https://fxg.jinritemai.com/ffa/g/create', runScripts: 'outside-only' });
    const w3 = dom3.window;
    const d3 = dom3.window.document;
    w3.chrome = { runtime: { id: 'selftest3', lastError: null, sendMessage(m, cb) { setTimeout(() => cb({ ok: false }), 0); } } };
    w3.dycReadFlags = () => Promise.resolve({ goodsImagePaste: true });
    w3.dycWatchFlags = () => {};
    w3.isVisible = () => true;
    w3.findAllByText = () => [];
    w3.debugLog = () => {};
    w3.setStatus = () => {};
    w3.DYC_PAGE_PATTERNS = { goodsEdit: /^https:\/\/fxg\.jinritemai\.com\/ffa\/g\/create/ };
    w3.eval(read(SRC_UNDER_TEST));
    await sleep(60);

    check('没有「上传图片」文案也能挂上（结构识别）', () => {
      assert.ok(d3.querySelector('#plainTile .dyc-imgpaste-btn'), '结构识别没生效 —— 真机就是卡在这一档');
    });
  }

  console.log('\n【六】读图四通道:直读优先,离屏兜底(真机 04:27 离屏报 not focused)');
  {
    const html4 = `<!doctype html><html><body>
      <div id="tile4"><div class="tip">上传图片</div><input type="file" accept="image/*" style="display:none"></div>
    </body></html>`;
    const dom4 = new JSDOM(html4, { url: 'https://fxg.jinritemai.com/ffa/g/create', runScripts: 'outside-only' });
    const w4 = dom4.window;
    const d4 = dom4.window.document;
    let offscreenCalls = 0;
    w4.chrome = {
      runtime: {
        id: 'st4', lastError: null,
        sendMessage(msg, cb) {
          if (msg && msg.type === 'dyc:readClipboardImage') {
            offscreenCalls++;
            setTimeout(() => cb({ ok: true, dataUrl: PNG, mime: 'image/png', size: 68 }), 5);
            return;
          }
          if (typeof cb === 'function') setTimeout(() => cb({ ok: false }), 0);
        }
      }
    };
    w4.dycReadFlags = () => Promise.resolve({ goodsImagePaste: true });
    w4.dycWatchFlags = () => {};
    w4.isVisible = () => true;
    w4.findAllByText = () => [];
    w4.debugLog = () => {};
    w4.setStatus = () => {};
    w4.DYC_PAGE_PATTERNS = { goodsEdit: /^https:\/\/fxg\.jinritemai\.com\/ffa\/g\/create/ };
    w4.DataTransfer = class { constructor() { this._f = []; this.items = { add: (f) => this._f.push(f) }; } get files() { return { length: this._f.length, item: (i) => this._f[i], 0: this._f[0] }; } };
    Object.defineProperty(w4.HTMLInputElement.prototype, 'files', { configurable: true, set(v) { this.__f = v; }, get() { return this.__f || { length: 0, item: () => null }; } });

    /* 内容脚本直读:返回真图(jsdom 的 Blob + FileReader 能走通整条 dataURL 链) */
    const bytes = Buffer.from(PNG.split(',')[1], 'base64');
    const blob4 = new w4.Blob([new w4.Uint8Array(bytes)], { type: 'image/png' });
    Object.defineProperty(w4.navigator, 'clipboard', {
      configurable: true,
      value: {
        read: () => Promise.resolve([{ types: ['image/png'], getType: (t) => Promise.resolve(blob4) }])
      }
    });

    w4.eval(read(SRC_UNDER_TEST));
    await sleep(150);
    const tile4 = d4.getElementById('tile4');
    const btn4 = tile4.querySelector('.dyc-imgpaste-btn') || (await sleep(150), tile4.querySelector('.dyc-imgpaste-btn'));
    check('自建按钮挂上了', () => { assert.ok(btn4, '没挂上'); });
    btn4.dispatchEvent(new w4.MouseEvent('click', { bubbles: true }));
    await sleep(80);

    check('直读通道成功且不走离屏', () => {
      assert.equal(offscreenCalls, 0, '离屏被调了 ' + offscreenCalls + ' 次 —— 直读没被优先');
      assert.ok(tile4.querySelector('img') || (tile4.querySelector('input').__f || { length: 0 }).length === 1,
        '图没进框');
    });

    /* 换一个环境:直读报「Document is not focused」(真机 04:27 的报错),应兜到离屏 */
    const dom5 = new JSDOM(html4, { url: 'https://fxg.jinritemai.com/ffa/g/create', runScripts: 'outside-only' });
    const w5 = dom5.window;
    const d5 = dom5.window.document;
    let off5 = 0;
    w5.chrome = {
      runtime: {
        id: 'st5', lastError: null,
        sendMessage(msg, cb) {
          if (msg && msg.type === 'dyc:readClipboardImage') {
            off5++;
            setTimeout(() => cb({ ok: true, dataUrl: PNG, mime: 'image/png', size: 68 }), 5);
            return;
          }
          if (typeof cb === 'function') setTimeout(() => cb({ ok: false }), 0);
        }
      }
    };
    w5.dycReadFlags = () => Promise.resolve({ goodsImagePaste: true });
    w5.dycWatchFlags = () => {};
    w5.isVisible = () => true;
    w5.findAllByText = () => [];
    w5.debugLog = () => {};
    w5.setStatus = () => {};
    w5.DYC_PAGE_PATTERNS = { goodsEdit: /^https:\/\/fxg\.jinritemai\.com\/ffa\/g\/create/ };
    w5.DataTransfer = w4.DataTransfer;
    Object.defineProperty(w5.HTMLInputElement.prototype, 'files', { configurable: true, set(v) { this.__f = v; }, get() { return this.__f || { length: 0, item: () => null }; } });
    Object.defineProperty(w5.navigator, 'clipboard', {
      configurable: true,
      value: { read: () => Promise.reject(new w5.DOMException('Document is not focused.', 'NotAllowedError')) }
    });

    w5.eval(read(SRC_UNDER_TEST));
    await sleep(60);
    const tile5 = d5.getElementById('tile4');
    tile5.querySelector('.dyc-imgpaste-btn').dispatchEvent(new w5.MouseEvent('click', { bubbles: true }));
    await sleep(450);

    check('直读被「not focused」拒后兜到离屏并成功', () => {
      assert.equal(off5, 1, '离屏调用次数 ' + off5);
      assert.equal((tile5.querySelector('input').__f || { length: 0 }).length, 1, '图没进框');
    });
  }

  console.log('\n【七】平台受理后把框整块重渲染,也要判成功且不补打通道(真机 04:36 误报)');
  {
    /* 真机 04:36:塞完文件平台把上传框换成「上传中」节点(候选 31→30),
       旧节点永远长不出 img —— 旧判据 1.2 秒没等到就误报「三条通道全部失败」,
       但图其实传上去了。而且换框后如果继续打 paste/drop 会重复上传。 */
    const html7 = `<!doctype html><html><body>
      <div id="goodsEditScrollContainer">
        <div id="tile7"><div class="tip">上传图片</div><input type="file" accept="image/*" style="display:none"></div>
      </div>
    </body></html>`;
    const dom7 = new JSDOM(html7, { url: 'https://fxg.jinritemai.com/ffa/g/create', runScripts: 'outside-only' });
    const w7 = dom7.window;
    const d7 = dom7.window.document;
    let dt7 = 0;
    w7.chrome = { runtime: { id: 'st7', lastError: null, sendMessage(m, cb) {
      if (m && m.type === 'dyc:readClipboardImage') { setTimeout(() => cb({ ok: true, dataUrl: PNG, mime: 'image/png', size: 68 }), 5); return; }
      if (typeof cb === 'function') setTimeout(() => cb({ ok: false }), 0);
    } } };
    w7.dycReadFlags = () => Promise.resolve({ goodsImagePaste: true });
    w7.dycWatchFlags = () => {};
    w7.isVisible = () => true;
    w7.findAllByText = () => [];
    w7.debugLog = () => {};
    const msgs7 = [];
    w7.setStatus = (value, kind, opts) => msgs7.push({ value, kind, opts });
    w7.DYC_PAGE_PATTERNS = { goodsEdit: /^https:\/\/fxg\.jinritemai\.com\/ffa\/g\/create/ };
    w7.DataTransfer = class { constructor() { dt7++; this._f = []; this.items = { add: (f) => this._f.push(f) }; } get files() { return { length: this._f.length, item: (i) => this._f[i], 0: this._f[0] }; } };
    Object.defineProperty(w7.HTMLInputElement.prototype, 'files', { configurable: true, set(v) { this.__f = v; }, get() { return this.__f || { length: 0, item: () => null }; } });

    const tile7 = d7.getElementById('tile7');
    const form7 = d7.getElementById('goodsEditScrollContainer');
    tile7.querySelector('input').addEventListener('change', () => {
      /* 平台受理:整个上传框节点被换掉(旧节点从文档里摘除),先显示转圈 */
      const uploading = d7.createElement('div');
      uploading.className = 'uploading';
      uploading.textContent = '上传中…';
      tile7.replaceWith(uploading);
      /* 1.2 秒后(比旧判据的 1200ms 晚)上传完成,新节点里长出缩略图 */
      setTimeout(() => {
        const img = d7.createElement('img');
        img.setAttribute('src', 'blob:uploaded');
        uploading.appendChild(img);
      }, 1400);
    });

    w7.eval(read(SRC_UNDER_TEST));
    await sleep(150);
    const btn7 = d7.querySelector('#tile7 .dyc-imgpaste-btn');
    check('按钮挂上了', () => { assert.ok(btn7, '没挂上'); });
    btn7.dispatchEvent(new w7.MouseEvent('click', { bubbles: true }));
    await sleep(2600);

    check('框被重渲染仍判「已入框」,不误报失败', () => {
      const ok = msgs7.filter((m) => m.kind === 'success');
      assert.equal(ok.length, 1, '成功消息 ' + ok.length + ' 条');
      assert.equal(ok[0].opts.count, '已入框');
      assert.equal(msgs7.filter((m) => m.kind === 'alert').length, 0, '误报了失败');
    });
    check('input 通道受理后没有再打 paste/drop(防重复上传)', () => {
      assert.equal(dt7, 1, 'DataTransfer 造了 ' + dt7 + ' 次 —— 后面的通道也发出去了');
    });
  }

  console.log('\n【八】微信小店 micro-app / 同源 iframe 与 SPA 生命周期');
  {
    const wx = new JSDOM('<!doctype html><body><micro-app></micro-app></body>', {
      url: 'https://store.weixin.qq.com/shop/goods/list', runScripts: 'outside-only'
    });
    const w = wx.window;
    const d = w.document;
    const msgs = [];
    let watch;
    let imageAvailable = true;
    let delayRead = 5;
    let transfers = 0;
    w.eval(read('src/content/flags.js'));
    w.dycReadFlags = () => Promise.resolve({ goodsImagePaste: true });
    w.dycWatchFlags = (cb) => { watch = cb; };
    w.isVisible = () => true;
    w.debugLog = () => {};
    w.setStatus = (value, kind, opts) => msgs.push({ value, kind, opts });
    w.chrome = { runtime: { id: 'wx-test', lastError: null, sendMessage(m, cb) {
      setTimeout(() => cb(imageAvailable
        ? { ok: true, dataUrl: PNG, mime: 'image/png', size: 68 }
        : { ok: false, error: '没有图片' }), delayRead);
    } } };
    w.DataTransfer = class {
      constructor() { transfers++; this.files = []; this.items = { add: (f) => this.files.push(f) }; }
    };
    Object.defineProperty(w.HTMLInputElement.prototype, 'files', {
      configurable: true, set(v) { this.__files = v; }, get() { return this.__files || []; }
    });
    const host = d.querySelector('micro-app');
    w.eval(read(SRC_UNDER_TEST));
    await sleep(60);
    w.history.pushState({}, '', '/shop/goods/entry?productId=1');
    const root = host.attachShadow({ mode: 'open' });
    root.innerHTML = '<form><div id="wxTile"><input type="file" accept="image/*"></div>'
      + '<div id="filled"><img src="blob:old"><input type="file" accept="image/*"></div>'
      + '<div id="video"><input type="file" accept="video/*"></div>'
      + '<div id="disabled"><input type="file" accept="image/*" disabled></div></form>';
    await sleep(1550);
    check('列表 SPA 进入编辑页、宿主延后 attachShadow 后自动识别，既有图/视频/禁用框不注入', () => {
      assert.equal(root.querySelectorAll('.dyc-imgpaste-btn').length, 1);
      assert.ok(root.querySelector('#wxTile .dyc-imgpaste-btn'));
      assert.equal(d.querySelector('.dyc-imgpaste-btn'), null);
    });
    check('按钮样式进入对应 shadowRoot，且开关在两平台可见', () => {
      assert.ok(root.querySelector('style[data-dyc-imgpaste-style]').textContent.includes('all:initial'));
      const meta = w.DYC_FLAGS_META.find((m) => m.key === 'goodsImagePaste');
      assert.equal(w.DYC_FLAGS_META.filter((m) => m.key === meta.key).length, 1);
      /* 口径（2026-11-12 改）：断言的是「两个平台都看得见这一行」，不再要求
         它所在的**分组**被每个平台认领。用户把开关搬进抖音专属的「其他」组后，
         可见性改由单行 platforms 白名单承担（见 flags.js / popup.applyPlatform），
         仍盯着 group 会是「按实现写死」的过时断言。 */
      assert.ok(w.DYC_PLATFORMS.filter((p) => ['dy', 'wx'].includes(p.id)).every((p) => p.groups.includes(meta.group) ||
        (meta.platforms || []).includes(p.id)), '开关应在两个平台都可见');
      assert.equal(meta.pages.join(','), 'goodsEdit,wxGoodsEdit');
      const manifest = JSON.parse(read('manifest.json'));
      const entries = manifest.content_scripts.filter((entry) => (entry.js || []).includes(SRC_UNDER_TEST));
      assert.ok(entries.some((entry) => entry.matches.includes('https://store.weixin.qq.com/*')));
    });
    const tile = root.querySelector('#wxTile');
    let changes = 0;
    let nativeClicks = 0;
    tile.addEventListener('click', () => { nativeClicks++; });
    tile.querySelector('input').addEventListener('change', () => {
      changes++;
      assert.equal(tile.querySelector('input').files.length, 1);
      const replacement = d.createElement('div');
      replacement.textContent = '上传中';
      tile.replaceWith(replacement);
      setTimeout(() => { replacement.innerHTML = '<img src="blob:wx-uploaded">'; }, 1400);
    });
    tile.querySelector('button').click();
    await sleep(2400);
    check('shadow 内上传框重渲染后仍等到出图，只上传一张、不触发原生选文件', () => {
      assert.equal(changes, 1);
      assert.equal(transfers, 1);
      assert.equal(nativeClicks, 0);
      assert.equal(msgs.filter((m) => m.kind === 'success').length, 1);
      assert.equal(msgs.filter((m) => m.kind === 'alert').length, 0);
    });
    const dynamic = d.createElement('div');
    dynamic.innerHTML = '<input type="file" accept=".png,.jpg">';
    root.querySelector('form').appendChild(dynamic);
    const frame = d.createElement('iframe');
    root.appendChild(frame);
    // jsdom 不加载 shadow 中的 iframe，使用同源顶层 frame 验证跨文档遍历。
    d.body.appendChild(frame);
    frame.contentDocument.body.innerHTML = '<div id="frameTile"><input type="file" accept="image/*"></div>';
    await sleep(850);
    check('shadow 内动态新增框及同源 iframe 自动挂载，重复扫描不重复按钮', () => {
      assert.equal(dynamic.querySelectorAll('button').length, 1);
      assert.ok(frame.contentDocument.querySelector('#frameTile button'));
      assert.ok(frame.contentDocument.querySelector('style[data-dyc-imgpaste-style]'));
    });
    imageAvailable = false;
    dynamic.querySelector('button').click();
    await sleep(200);
    check('剪贴板无图只报一条未入框，保留原框且恢复按钮', () => {
      assert.equal(transfers, 1);
      assert.equal(msgs.filter((m) => m.kind === 'alert').length, 1);
      assert.equal(msgs.at(-1).opts.count, '未入框');
      assert.equal(dynamic.querySelector('button').disabled, false);
    });
    imageAvailable = true;
    delayRead = 120;
    dynamic.querySelector('button').click();
    watch({ goodsImagePaste: false });
    await sleep(250);
    check('读取途中关闭开关，shadow/iframe 按钮和样式移除，迟到图片不上传', () => {
      assert.equal(root.querySelector('button'), null);
      assert.equal(frame.contentDocument.querySelector('button'), null);
      assert.equal(root.querySelector('style[data-dyc-imgpaste-style]'), null);
      assert.equal(transfers, 1);
    });
    watch({ goodsImagePaste: true });
    await sleep(1050); // 等挂载引起的变更扫描结束，再验证纯路由切换。
    w.history.pushState({}, '', '/shop/goods/list');
    await sleep(1500);
    check('离开编辑路由清理跨根按钮', () => {
      assert.equal(root.querySelector('button'), null);
      assert.equal(frame.contentDocument.querySelector('button'), null);
    });
    w.history.pushState({}, '', '/shop/goods/entry?productId=2');
    await sleep(1500);
    check('SPA 返回编辑页自动恢复，离开后不残留重复按钮', () => {
      assert.equal(dynamic.querySelectorAll('button').length, 1);
      assert.equal(frame.contentDocument.querySelectorAll('button').length, 1);
    });
    w.close();
  }

  console.log('\n【八】表格内的常规图格让位给平台「粘贴图片 / 图库选择」菜单(2026-11-21)');
  {
    const html6 = `<!doctype html><html><body>
      <div id="goodsEditScrollContainer">
        <div class="ecom-g-table">
          <div id="tableTile"><div class="tip">上传图片</div><input type="file" accept="image/*" style="display:none"></div>
          <div id="tableMicro"><input type="file" accept="image/*" style="display:none"></div>
        </div>
        <div id="outsideTile"><div class="tip">上传图片</div><input type="file" accept="image/*" style="display:none"></div>
      </div>
    </body></html>`;
    const dom6 = new JSDOM(html6, { url: 'https://fxg.jinritemai.com/ffa/g/create', runScripts: 'outside-only' });
    const w6 = dom6.window;
    const d6 = w6.document;
    w6.chrome = { runtime: { id: 'selftest6', lastError: null, sendMessage(m, cb) { setTimeout(() => cb({ ok: false }), 0); } } };
    w6.dycReadFlags = () => Promise.resolve({ goodsImagePaste: true });
    w6.dycWatchFlags = () => {};
    w6.isVisible = () => true;
    w6.findAllByText = () => [];
    w6.debugLog = () => {};
    w6.setStatus = () => {};
    w6.DYC_PAGE_PATTERNS = { goodsEdit: /^https:\/\/fxg\.jinritemai\.com\/ffa\/g\/create/ };
    /* 尺寸桩:只给这三颗格子固定边长,其余沿用 jsdom 的 0。
       代码在尺寸未知时不判表格(渲染初期先挂、量到尺寸后重扫摘掉),
       所以验证这条规则必须让被测格子先「量到」尺寸。 */
    const RECTS = { tableTile: 80, tableMicro: 28, outsideTile: 118 };
    w6.Element.prototype.getBoundingClientRect = function () {
      const side = RECTS[this.id] || 0;
      return { width: side, height: side, top: 0, left: 0, right: side, bottom: side, x: 0, y: 0 };
    };
    w6.eval(read(SRC_UNDER_TEST));
    await sleep(120);

    check('表格内的常规图格不挂按钮（平台点开自带粘贴菜单）', () => {
      assert.equal(d6.querySelector('#tableTile .dyc-imgpaste-btn'), null);
    });
    check('表格内的微型入口照旧挂（规格图相机是直传入口）', () => {
      assert.ok(d6.querySelector('#tableMicro .dyc-imgpaste-btn'), 'micro 被一起拦掉了');
    });
    check('表格外的常规上传框不受影响', () => {
      assert.ok(d6.querySelector('#outsideTile .dyc-imgpaste-btn'), '表格外的框被误杀');
    });
    w6.close();
  }

  console.log('\n【九】尺码图「粘贴尺码图」按钮(2026-11-21)');
  {
    const html7 = `<!doctype html><html><body>
      <div id="goodsEditScrollContainer">
        <div id="sizeArea">
          <button id="parseBtn" type="button">解析尺码图</button>
          <div id="sizeTile"><div class="tip">上传图片</div><input type="file" accept="image/*" style="display:none"></div>
        </div>
      </div>
    </body></html>`;
    const dom7 = new JSDOM(html7, { url: 'https://fxg.jinritemai.com/ffa/g/create', runScripts: 'outside-only' });
    const w7 = dom7.window;
    const d7 = w7.document;
    const flags7 = { goodsImagePaste: true, sizeChartPaste: true };
    let watch7 = null;
    const msgs7 = [];
    w7.chrome = {
      runtime: {
        id: 'selftest7', lastError: null,
        sendMessage(m, cb) {
          if (m && m.type === 'dyc:readClipboardImage') {
            setTimeout(() => cb({ ok: true, dataUrl: PNG, mime: 'image/png', size: 68 }), 5);
            return;
          }
          if (typeof cb === 'function') setTimeout(() => cb({ ok: false }), 0);
        }
      }
    };
    w7.dycReadFlags = () => Promise.resolve(flags7);
    w7.dycWatchFlags = (cb) => { watch7 = cb; };
    w7.isVisible = () => true;
    w7.findAllByText = () => [];
    w7.debugLog = () => {};
    w7.setStatus = (value, kind, opts) => msgs7.push({ value, kind, opts });
    w7.DYC_PAGE_PATTERNS = { goodsEdit: /^https:\/\/fxg\.jinritemai\.com\/ffa\/g\/create/ };
    w7.DataTransfer = class {
      constructor() { this._f = []; this.items = { add: (f) => this._f.push(f) }; }
      get files() { return { length: this._f.length, item: (i) => this._f[i], 0: this._f[0] }; }
    };
    Object.defineProperty(w7.HTMLInputElement.prototype, 'files', {
      configurable: true, set(v) { this.__f = v; },
      get() { return this.__f || { length: 0, item: () => null }; }
    });
    w7.eval(read(SRC_UNDER_TEST));
    await sleep(250);

    const parseBtn = d7.getElementById('parseBtn');
    check('按钮插在「解析尺码图」右侧', () => {
      const next = parseBtn.nextElementSibling;
      assert.ok(next && next.classList.contains('dyc-imgpaste-size'), '右侧没有粘贴尺码图按钮');
    });

    /* 模拟平台出图:点完 150ms 追加一张 <img>,让 4 秒等待判据能看到「图片增长」 */
    setTimeout(() => {
      const im = d7.createElement('img');
      im.src = 'https://example.test/size.png';
      d7.getElementById('sizeTile').appendChild(im);
    }, 150);
    parseBtn.nextElementSibling.dispatchEvent(new w7.MouseEvent('click', { bubbles: true }));
    await sleep(600);

    check('点一下把剪贴板图片塞进尺码图格', () => {
      const input = d7.querySelector('#sizeTile input');
      assert.equal((input.__f || { length: 0 }).length, 1, '图片没进框');
    });
    check('报了一条「尺码图 · 已入框」', () => {
      const hit = msgs7.filter((m) => m.value === '尺码图' && m.kind === 'success');
      assert.equal(hit.length, 1, '没有尺码图成功消息');
    });

    watch7({ goodsImagePaste: true, sizeChartPaste: false });
    await sleep(200);
    check('关掉「粘贴尺码图」后按钮消失', () => {
      assert.equal(d7.querySelector('.dyc-imgpaste-size'), null);
    });
    w7.close();
  }

  console.log('\n【十】平台浮层:行里不挂按钮,浮层开着时格子按钮收起(2026-11-21~22)');
  {
    /* 真机结构(用户 2026-11-21 截图 + 2026-11-22 实测):
       悬停「添加图片」弹出二级浮层(ecargo-power-inner[role=tooltip]),
       行是 label[data-microp-model="micro"][data-microp-title="…"](48×34)包 file input。
       两件事分别钉住:
         ① 浮层的行(带 role 祖先 / 带 microp 属性 / 带文字的 label)一律不挂按钮;
         ② 浮层**开着**时,格子按钮收起、也不往格子里插节点 —— 平台此刻正在重排,
            我们再动格子就是 SKU 图闪烁的来源;浮层一关立即恢复。 */
    const html8 = `<!doctype html><html><body>
      <div id="goodsEditScrollContainer">
        <div class="ecom-g-table">
          <div class="overlay-no-role">
            <label id="pickerRowNoRole">图库选择<input type="file" accept="image/*" style="display:none"></label>
          </div>
          <div class="overlay-microp" data-microp-model="micro">
            <label id="pickerMicrop">图像选择<input type="file" accept="image/*" style="display:none"></label>
          </div>
          <div id="pickerDivRow" data-microp-title="图像选择">
            <div>图像选择</div><input type="file" accept="image/*" style="display:none">
          </div>
          <div id="specCamera"><input type="file" accept="image/*" style="display:none"></div>
          <div id="specCameraEdge"><input type="file" accept="image/*" style="display:none"></div>
        </div>
      </div>
    </body></html>`;
    const dom8 = new JSDOM(html8, { url: 'https://fxg.jinritemai.com/ffa/g/create', runScripts: 'outside-only' });
    const w8 = dom8.window;
    const d8 = w8.document;
    w8.chrome = { runtime: { id: 'selftest8', lastError: null, sendMessage(m, cb) { setTimeout(() => cb({ ok: false }), 0); } } };
    w8.dycReadFlags = () => Promise.resolve({ goodsImagePaste: true, sizeChartPaste: false });
    w8.dycWatchFlags = () => {};
    w8.isVisible = () => true;
    w8.findAllByText = () => [];
    w8.debugLog = () => {};
    w8.setStatus = () => {};
    w8.DYC_PAGE_PATTERNS = { goodsEdit: /^https:\/\/fxg\.jinritemai\.com\/ffa\/g\/create/ };
    const RECTS8 = { pickerRowNoRole: [48, 34], pickerMicrop: [48, 34], pickerDivRow: [48, 34], specCamera: [28, 28], pickerRow: [48, 34], specCameraEdge: [32, 32] };
    w8.Element.prototype.getBoundingClientRect = function () {
      const box = RECTS8[this.id];
      const w = box ? box[0] : 0;
      const h = box ? box[1] : 0;
      const l = this.id === 'specCameraEdge' ? 1000 : 0;   // 贴近视口右缘(1024),右侧放不下
      if (this.getAttribute && this.getAttribute('role') === 'tooltip') {
        /* 浮层闸只认「看得见」的浮层(jsdom 没布局,这里替浮层给个尺寸) */
        return { width: 200, height: 120, top: 0, left: 0, right: 200, bottom: 120, x: 0, y: 0 };
      }
      return { width: w, height: h, top: 0, left: l, right: l + w, bottom: h, x: l, y: 0 };
    };
    w8.eval(read(SRC_UNDER_TEST));
    await sleep(120);

    check('无 role 的浮层 label 行不挂（带文字兜底）', () => {
      assert.equal(d8.querySelector('#pickerRowNoRole .dyc-imgpaste-btn'), null, '按钮挂到了平台菜单项上');
    });
    check('只带 data-microp-model 的浮层行不挂', () => {
      assert.equal(d8.querySelector('#pickerMicrop .dyc-imgpaste-btn'), null, '按钮挂到了平台菜单项上');
    });
    check('浮层行是 div 且只带 data-microp-title 时也不挂', () => {
      assert.equal(d8.querySelector('#pickerDivRow .dyc-imgpaste-btn'), null, '按钮挂到了平台菜单项上');
    });
    const camBtn = d8.querySelector('#specCamera .dyc-imgpaste-btn');
    check('规格图相机（micro、无文字）照旧挂', () => {
      assert.ok(camBtn, 'micro 直传入口被误杀');
      assert.notEqual(camBtn && camBtn.style.display, 'none', '没有浮层时按钮不该被收起');
    });
    check('小框的胶囊外置到右侧（用户 2026-11-22 定稿）', () => {
      assert.ok(camBtn.classList.contains('is-micro'), '没走微型档');
      assert.ok(camBtn.classList.contains('is-micro-right'), '没有外置到右侧');
      assert.ok(!camBtn.classList.contains('is-micro-inside'), '放得下却凹进了框内');
    });
    check('右侧放不下时降级为凹进框内（不溢出裁切区）', () => {
      const edge = d8.querySelector('#specCameraEdge .dyc-imgpaste-btn');
      assert.ok(edge, '贴边相机没挂上');
      assert.ok(edge.classList.contains('is-micro-inside'), '放不下却没有降级');
    });

    /* --- 浮层开着:整层 role=tooltip,行不挂、格子按钮收起 --- */
    const popup = d8.createElement('div');
    popup.setAttribute('role', 'tooltip');
    popup.innerHTML = '<label id="pickerRow">图像选择<input type="file" accept="image/*" style="display:none"></label>';
    d8.body.appendChild(popup);
    await sleep(650);

    check('浮层开着时,浮层行不挂按钮', () => {
      assert.equal(d8.querySelector('#pickerRow .dyc-imgpaste-btn'), null, '按钮挂到了平台菜单项上');
    });
    check('浮层开着时,格子按钮收起（浮层本来就盖在它上面）', () => {
      assert.equal(camBtn.style.display, 'none', '浮层期按钮没有收起');
    });

    /* --- 浮层关掉:一帧内恢复 --- */
    popup.remove();
    await sleep(650);
    check('浮层关掉后格子按钮恢复', () => {
      assert.notEqual(camBtn.style.display, 'none', '浮层关了按钮没回来');
      assert.equal(d8.querySelector('#pickerRow'), null, '浮层 DOM 没清干净');
    });
    w8.close();
  }

  console.log('\n【十二】表格重渲染那一瞬量不到尺寸,也不挂表格内图格(2026-11-21 闪烁)');
  {
    /* 真机诊断报告:同一批 48 个候选,「已挂 11」与「已挂 19」每 430ms 交替 —— 格子没变,
       是它们在里面反复被挂上又摘掉。虚拟表格每次重渲染都会短暂量到 0×0,
       而 0×0 走的是「尺寸未知也按常规档放行」的兜底;量到了又被「表格内让位」判死。
       两种状态来回翻 = 闪烁。所以表格这道闸必须走在尺寸兜底前面。
       这个环境**故意不设尺寸桩**(全部沿用 jsdom 的 0×0),正是重渲染那一瞬的状态。 */
    const html9 = `<!doctype html><html><body>
      <div id="goodsEditScrollContainer">
        <div class="ecom-g-table">
          <div id="bareTableTile"><div class="tip">上传图片</div><input type="file" accept="image/*" style="display:none"></div>
        </div>
        <div id="bareTile"><div class="tip">上传图片</div><input type="file" accept="image/*" style="display:none"></div>
      </div>
    </body></html>`;
    const dom9 = new JSDOM(html9, { url: 'https://fxg.jinritemai.com/ffa/g/create', runScripts: 'outside-only' });
    const w9 = dom9.window;
    const d9 = w9.document;
    w9.chrome = { runtime: { id: 'selftest9', lastError: null, sendMessage(m, cb) { setTimeout(() => cb({ ok: false }), 0); } } };
    w9.dycReadFlags = () => Promise.resolve({ goodsImagePaste: true, sizeChartPaste: false });
    w9.dycWatchFlags = () => {};
    w9.isVisible = () => true;
    w9.findAllByText = () => [];
    w9.debugLog = () => {};
    w9.setStatus = () => {};
    w9.DYC_PAGE_PATTERNS = { goodsEdit: /^https:\/\/fxg\.jinritemai\.com\/ffa\/g\/create/ };
    w9.eval(read(SRC_UNDER_TEST));
    await sleep(120);

    check('表格内图格在尺寸未知时也不挂（否则会随重渲染闪挂）', () => {
      assert.equal(d9.querySelector('#bareTableTile .dyc-imgpaste-btn'), null, '0×0 时又挂上了');
    });
    check('表格外的框在尺寸未知时照旧挂（老行为不变）', () => {
      assert.ok(d9.querySelector('#bareTile .dyc-imgpaste-btn'), '尺寸未知的常规格被误杀');
    });
    w9.close();
  }

  console.log('\n【十三】判不合格不立刻摘,连续两轮才摘(滞回,治挂上-摘掉来回翻)');
  {
    const html10 = `<!doctype html><html><body>
      <div id="goodsEditScrollContainer">
        <div id="blinkTile"><div class="tip">上传图片</div><input type="file" accept="image/*" style="display:none"></div>
      </div>
    </body></html>`;
    const dom10 = new JSDOM(html10, { url: 'https://fxg.jinritemai.com/ffa/g/create', runScripts: 'outside-only' });
    const w10 = dom10.window;
    const d10 = w10.document;
    w10.chrome = { runtime: { id: 'selftest10', lastError: null, sendMessage(m, cb) { setTimeout(() => cb({ ok: false }), 0); } } };
    w10.dycReadFlags = () => Promise.resolve({ goodsImagePaste: true, sizeChartPaste: false });
    w10.dycWatchFlags = () => {};
    let blinkHidden = false;                       // 模拟平台重渲染那一瞬「格子不可见」
    const blinkTile = d10.getElementById('blinkTile');
    w10.isVisible = (el) => !(blinkHidden && el === blinkTile);
    w10.findAllByText = () => [];
    w10.debugLog = () => {};
    w10.setStatus = () => {};
    w10.DYC_PAGE_PATTERNS = { goodsEdit: /^https:\/\/fxg\.jinritemai\.com\/ffa\/g\/create/ };
    w10.Element.prototype.getBoundingClientRect = function () {
      const side = this.id === 'blinkTile' ? 118 : 0;
      return { width: side, height: side, top: 0, left: 0, right: side, bottom: side, x: 0, y: 0 };
    };
    w10.eval(read(SRC_UNDER_TEST));
    await sleep(120);
    assert.ok(blinkTile.querySelector('.dyc-imgpaste-btn'), '起步就没挂上,后面的断言没意义');

    /* 触发重扫:观察器盯 childList,插一个无关节点让 400ms 防抖跑起来 */
    const poke = () => d10.body.appendChild(d10.createElement('i'));
    blinkHidden = true;
    poke();
    await sleep(600);
    check('第一轮判不合格时按钮仍在（留一轮缓冲）', () => {
      assert.ok(blinkTile.querySelector('.dyc-imgpaste-btn'), '一轮就摘了,真机上就是闪');
    });
    poke();
    await sleep(600);
    /* 2026-11-22 改口径:已挂的格子不再按可见性/尺寸重判(97↔43 抖动的教训),
       只有语义级失效才摘 —— 框里失去图片 file input。 */
    check('连续多轮判不合格也不摘（不重判就是为此）', () => {
      assert.ok(blinkTile.querySelector('.dyc-imgpaste-btn'), '可见性抖动把按钮摘掉了');
    });
    blinkTile.querySelector('input').remove();            // 平台把格子改作他用
    poke();
    await sleep(600);
    poke();
    await sleep(600);
    check('框里失去图片 file input 才摘（滞回两轮）', () => {
      assert.equal(blinkTile.querySelector('.dyc-imgpaste-btn'), null, '真失效的格子没被摘掉');
    });
    w10.close();
  }


  console.log('\n【十一】真机结构的锚点:文案只在 data-kora-json 上(2026-11-21 截图+DevTools)');
  {
    /* 真机就是这一段:label 包着 file input,里面那颗 div 没有文本节点,
       文案写在 data-kora-json 属性上,图标靠 img[alt="AI解析图片"]。 */
    const html8 = `<!doctype html><html><body>
      <div id="goodsEditScrollContainer">
        <div id="sizeWrap" style="display:flex">
          <label id="sizeLabel"><input type="file" accept="image/*" style="display:none">
            <div id="aiBtn" data-kora-json="AI解析尺码图"><img alt="AI解析图片" src="data:image/gif;base64,R0lGODlhAQABAAAAACw="></div>
          </label>
        </div>
      </div>
    </body></html>`;
    const dom8 = new JSDOM(html8, { url: 'https://fxg.jinritemai.com/ffa/g/create', runScripts: 'outside-only' });
    const w8 = dom8.window;
    const d8 = w8.document;
    w8.chrome = {
      runtime: {
        id: 'selftest8', lastError: null,
        sendMessage(m, cb) {
          if (m && m.type === 'dyc:readClipboardImage') {
            setTimeout(() => cb({ ok: true, dataUrl: PNG, mime: 'image/png', size: 68 }), 5);
            return;
          }
          if (typeof cb === 'function') setTimeout(() => cb({ ok: false }), 0);
        }
      }
    };
    w8.dycReadFlags = () => Promise.resolve({ goodsImagePaste: true, sizeChartPaste: true });
    w8.dycWatchFlags = () => {};
    w8.isVisible = () => true;
    w8.findAllByText = () => [];
    w8.debugLog = () => {};
    w8.setStatus = () => {};
    w8.DYC_PAGE_PATTERNS = { goodsEdit: /^https:\/\/fxg\.jinritemai\.com\/ffa\/g\/create/ };
    w8.DataTransfer = class {
      constructor() { this._f = []; this.items = { add: (f) => this._f.push(f) }; }
      get files() { return { length: this._f.length, item: (i) => this._f[i], 0: this._f[0] }; }
    };
    Object.defineProperty(w8.HTMLInputElement.prototype, 'files', {
      configurable: true, set(v) { this.__f = v; },
      get() { return this.__f || { length: 0, item: () => null }; }
    });
    w8.eval(read(SRC_UNDER_TEST));
    await sleep(250);

    const label8 = d8.getElementById('sizeLabel');
    const ai8 = d8.getElementById('aiBtn');
    check('按 data-kora-json 找到锚点并紧贴在它右侧（label 内，不会被 flex-wrap 挤到下一行）', () => {
      const next = ai8.nextElementSibling;
      assert.ok(next && next.classList.contains('dyc-imgpaste-size'),
        '锚点右侧没有粘贴尺码图按钮');
    });
    check('按钮绝对定位在锚点右侧（不参与 label 内部块级流，不会被挤到下一行）', () => {
      const btn8 = d8.querySelector('.dyc-imgpaste-size');
      assert.equal(btn8.parentElement.id, 'sizeLabel');
      assert.equal(btn8.style.position, 'absolute', '不是绝对定位，会掉到下一行');
      assert.equal(btn8.style.left, '8px', '左侧偏移没按锚点右边界算');
    });

    setTimeout(() => {
      const im = d8.createElement('img');
      im.src = 'https://example.test/size.png';
      label8.appendChild(im);
    }, 150);
    ai8.nextElementSibling.dispatchEvent(new w8.MouseEvent('click', { bubbles: true }));
    await sleep(600);
    check('点一下把剪贴板图片塞进 label 内的 file input', () => {
      const input = d8.querySelector('#sizeLabel input');
      assert.equal((input.__f || { length: 0 }).length, 1, '图片没进框');
    });
    w8.close();
  }

  console.log('\n【十三】平台慢出图（2.6 秒）仍判成功，不报失败(2026-11-22 用户反馈)');
  {
    const html9 = `<!doctype html><html><body>
      <div id="goodsEditScrollContainer">
        <div id="slowTile"><div class="tip">上传图片</div><input type="file" accept="image/*" style="display:none"></div>
      </div>
    </body></html>`;
    const dom9 = new JSDOM(html9, { url: 'https://fxg.jinritemai.com/ffa/g/create', runScripts: 'outside-only' });
    const w9 = dom9.window;
    const d9 = w9.document;
    const msgs9 = [];
    w9.chrome = {
      runtime: {
        id: 'selftest9', lastError: null,
        sendMessage(m, cb) {
          if (m && m.type === 'dyc:readClipboardImage') {
            setTimeout(() => cb({ ok: true, dataUrl: PNG, mime: 'image/png', size: 68 }), 5);
            return;
          }
          if (typeof cb === 'function') setTimeout(() => cb({ ok: false }), 0);
        }
      }
    };
    w9.dycReadFlags = () => Promise.resolve({ goodsImagePaste: true, sizeChartPaste: false });
    w9.dycWatchFlags = () => {};
    w9.isVisible = () => true;
    w9.findAllByText = () => [];
    w9.debugLog = () => {};
    w9.setStatus = (value, kind, opts) => msgs9.push({ value, kind, opts });
    w9.DYC_PAGE_PATTERNS = { goodsEdit: /^https:\/\/fxg\.jinritemai\.com\/ffa\/g\/create/ };
    w9.DataTransfer = class {
      constructor() { this._f = []; this.items = { add: (f) => this._f.push(f) }; }
      get files() { return { length: this._f.length, item: (i) => this._f[i], 0: this._f[0] }; }
    };
    Object.defineProperty(w9.HTMLInputElement.prototype, 'files', {
      configurable: true, set(v) { this.__f = v; },
      get() { return this.__f || { length: 0, item: () => null }; }
    });
    w9.eval(read(SRC_UNDER_TEST));
    await sleep(250);

    const tile9 = d9.getElementById('slowTile');
    const btn9 = tile9.querySelector('.dyc-imgpaste-btn');
    /* 平台 2.6 秒后才把图渲染出来 —— 超过旧版单通道 1.2 秒的窗口,应仍算成功 */
    setTimeout(() => {
      const im = d9.createElement('img');
      im.src = 'https://example.test/late.png';
      tile9.appendChild(im);
    }, 2600);
    btn9.dispatchEvent(new w9.MouseEvent('click', { bubbles: true }));
    await sleep(3600);

    check('慢出图仍报成功，没有误报失败', () => {
      const ok = msgs9.filter((m) => m.value === '图片' && m.kind === 'success');
      const bad = msgs9.filter((m) => m.kind === 'alert');
      assert.equal(ok.length, 1, '没有成功消息');
      assert.equal(bad.length, 0, '误报了失败：' + JSON.stringify(bad[0] && bad[0].value));
    });
    w9.close();
  }

  console.log('\n【十四】平台清掉按钮但保住格子时,就地补回(2026-11-22 闪烁)');
  {
    /* 真机:诊断报告里「已挂 9」与「已挂 13」按重扫节奏交替 —— 差的 4 格始终补不回来,
       只偶尔随节点整体替换复活。两个成因一起钉住:
         ① `data-dyc-imgpaste-tile="1"` 被当成「已挂」凭据,按钮被平台清掉后属性还在,
            每轮 mount 都直接 return(所以补不回来);
         ② 补的时机只有 400ms 防抖的全量重扫,中间那段空白就是肉眼看到的闪。
       staleTile 预置属性但没按钮;guardTile 用来模拟「React 清空子节点后重填」。 */
    const html11 = `<!doctype html><html><body>
      <div id="goodsEditScrollContainer">
        <div id="guardTile"><div class="tip">上传图片</div><input type="file" accept="image/*" style="display:none"></div>
        <div id="staleTile" data-dyc-imgpaste-tile="1"><div class="tip">上传图片</div><input type="file" accept="image/*" style="display:none"></div>
      </div>
    </body></html>`;
    const dom11 = new JSDOM(html11, { url: 'https://fxg.jinritemai.com/ffa/g/create', runScripts: 'outside-only' });
    const w11 = dom11.window;
    const d11 = w11.document;
    w11.chrome = { runtime: { id: 'selftest11', lastError: null, sendMessage(m, cb) { setTimeout(() => cb({ ok: false }), 0); } } };
    w11.dycReadFlags = () => Promise.resolve({ goodsImagePaste: true, sizeChartPaste: false });
    w11.dycWatchFlags = () => {};
    w11.isVisible = () => true;
    w11.findAllByText = () => [];
    const logs11 = [];
    w11.debugLog = (m) => logs11.push(String(m));
    w11.setStatus = () => {};
    w11.DYC_PAGE_PATTERNS = { goodsEdit: /^https:\/\/fxg\.jinritemai\.com\/ffa\/g\/create/ };
    w11.Element.prototype.getBoundingClientRect = function () {
      const side = (this.id === 'guardTile' || this.id === 'staleTile') ? 118 : 0;
      return { width: side, height: side, top: 0, left: 0, right: side, bottom: side, x: 0, y: 0 };
    };
    w11.eval(read(SRC_UNDER_TEST));
    await sleep(120);

    check('属性还在、按钮没了时照样补挂（不再被旧标记挡住）', () => {
      assert.ok(d11.querySelector('#staleTile .dyc-imgpaste-btn'), '被旧标记短路了');
    });

    const gt = d11.getElementById('guardTile');
    const tip = gt.querySelector('.tip');
    const inp = gt.querySelector('input');
    assert.ok(gt.querySelector('.dyc-imgpaste-btn'), '起步没挂上,后面断言没意义');
    gt.textContent = '';                 // 模拟 React 清空子节点(节点本身留着)
    gt.appendChild(tip);
    gt.appendChild(inp);
    await sleep(30);                     // 远小于 400ms 全量重扫防抖
    check('平台清空子节点后立刻补回（不等 400ms 重扫）', () => {
      assert.ok(gt.querySelector('.dyc-imgpaste-btn'), '没有就地补回,真机就是闪');
    });
    check('就地补留了一条可判读的日志（下次报告能直接看平台清了几次）', () => {
      assert.ok(logs11.some((m) => m.indexOf('就地补') >= 0), '没有留痕');
    });
    w11.close();
  }


  console.log('\n【十五】已挂的格子不再按尺寸重判(2026-11-22 掉线留痕:97↔43 抖动)');
  {
    /* 真机:label.styles-module_button__v_0O2 在 97×97 与 43×43 之间抖,
       每轮重判就一轮挂一轮摘。钉住:尺寸变化不摘按钮;出图才摘。 */
    const html12 = `<!doctype html><html><body>
      <div id="goodsEditScrollContainer">
        <div id="flapTile"><div class="tip">上传图片</div><input type="file" accept="image/*" style="display:none"></div>
      </div>
    </body></html>`;
    const dom12 = new JSDOM(html12, { url: 'https://fxg.jinritemai.com/ffa/g/create', runScripts: 'outside-only' });
    const w12 = dom12.window;
    const d12 = w12.document;
    w12.chrome = { runtime: { id: 'selftest12', lastError: null, sendMessage(m, cb) { setTimeout(() => cb({ ok: false }), 0); } } };
    w12.dycReadFlags = () => Promise.resolve({ goodsImagePaste: true, sizeChartPaste: false });
    w12.dycWatchFlags = () => {};
    w12.isVisible = () => true;
    w12.findAllByText = () => [];
    w12.debugLog = () => {};
    w12.setStatus = () => {};
    w12.DYC_PAGE_PATTERNS = { goodsEdit: /^https:\/\/fxg\.jinritemai\.com\/ffa\/g\/create/ };
    let flapSide = 118;                                   // 模拟尺寸抖动:97 ↔ 43
    w12.Element.prototype.getBoundingClientRect = function () {
      const side = this.id === 'flapTile' ? flapSide : 0;
      return { width: side, height: side, top: 0, left: 0, right: side, bottom: side, x: 0, y: 0 };
    };
    w12.eval(read(SRC_UNDER_TEST));
    await sleep(120);
    const flapBtn = d12.querySelector('#flapTile .dyc-imgpaste-btn');
    assert.ok(flapBtn, '起步没挂上,后面断言没意义');

    flapSide = 43;                                        // 平台把格子量小了
    d12.body.appendChild(d12.createElement('i'));         // 戳一次重扫
    await sleep(600);
    d12.body.appendChild(d12.createElement('i'));         // 再戳一次(第二连续轮)
    await sleep(600);
    check('尺寸抖到 43×43 也不摘（已挂的不按尺寸重判）', () => {
      const now = d12.querySelector('#flapTile .dyc-imgpaste-btn');
      assert.ok(now, '按钮被尺寸抖动摘掉了');
      assert.equal(now, flapBtn, '按钮被重建了 —— 真机就是闪');
    });

    flapSide = 118;
    const img = d12.createElement('img');
    img.src = 'blob:flap';
    d12.getElementById('flapTile').appendChild(img);      // 平台出图
    await sleep(650);
    check('出图仍然立即摘（不受不重判影响）', () => {
      assert.equal(d12.querySelector('#flapTile .dyc-imgpaste-btn'), null, '出图后按钮还在');
    });
    w12.close();
  }

  console.log('\n【十六】虚拟表格回收行:新行一出现就挂,不等 400ms(2026-11-22)');
  {
    /* 用户实测「按钮消失、滚动一下又回来」:SKU 图格子住在虚拟表格里,
       滚动回收行时旧行连按钮一起销毁,新行原先要等 400ms 防抖才补挂。
       钉住:观察器回调里就地挂,30ms 内新行就有按钮。 */
    const html13 = `<!doctype html><html><body>
      <div id="goodsEditScrollContainer">
        <div id="recycleRow"><div id="recycleTile"><div class="tip">上传图片</div><input type="file" accept="image/*" style="display:none"></div></div>
      </div>
    </body></html>`;
    const dom13 = new JSDOM(html13, { url: 'https://fxg.jinritemai.com/ffa/g/create', runScripts: 'outside-only' });
    const w13 = dom13.window;
    const d13 = w13.document;
    w13.chrome = { runtime: { id: 'selftest13', lastError: null, sendMessage(m, cb) { setTimeout(() => cb({ ok: false }), 0); } } };
    w13.dycReadFlags = () => Promise.resolve({ goodsImagePaste: true, sizeChartPaste: false });
    w13.dycWatchFlags = () => {};
    w13.isVisible = () => true;
    w13.findAllByText = () => [];
    w13.debugLog = () => {};
    w13.setStatus = () => {};
    w13.DYC_PAGE_PATTERNS = { goodsEdit: /^https:\/\/fxg\.jinritemai\.com\/ffa\/g\/create/ };
    w13.Element.prototype.getBoundingClientRect = function () {
      const side = this.id === 'recycleTile' ? 97 : 0;
      return { width: side, height: side, top: 0, left: 0, right: side, bottom: side, x: 0, y: 0 };
    };
    w13.eval(read(SRC_UNDER_TEST));
    await sleep(120);
    assert.ok(d13.querySelector('#recycleTile .dyc-imgpaste-btn'), '起步没挂上,后面断言没意义');

    /* 模拟滚动回收:旧行连按钮一起销毁,平台给出一个全新的行 */
    const fresh = d13.createElement('div');
    fresh.id = 'recycleRow';
    fresh.innerHTML = '<div id="recycleTile2"><div class="tip">上传图片</div><input type="file" accept="image/*" style="display:none"></div>';
    d13.getElementById('recycleRow').replaceWith(fresh);
    await sleep(30);                       // 远小于 400ms 防抖
    check('新行 30ms 内就有按钮（就地挂,不等防抖）', () => {
      assert.ok(d13.querySelector('#recycleTile2 .dyc-imgpaste-btn'), '新行没有就地挂上,真机就是「消失」');
    });
    check('旧行销毁后按钮不残留（跟着行一起走）', () => {
      assert.equal(d13.querySelector('#recycleTile .dyc-imgpaste-btn'), null, '旧行的按钮还挂在文档里');
    });
    w13.close();
  }

  console.log('\n────────────────────────────────────────');
  console.log('  通过 ' + pass + ' / 失败 ' + fail);
  if (fail) {
    console.log('\n失败明细：');
    failures.forEach((f) => console.log('  - ' + f));
    process.exit(1);
  }
  console.log('  全部通过。\n');
})();
