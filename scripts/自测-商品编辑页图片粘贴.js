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

  console.log('\n────────────────────────────────────────');
  console.log('  通过 ' + pass + ' / 失败 ' + fail);
  if (fail) {
    console.log('\n失败明细：');
    failures.forEach((f) => console.log('  - ' + f));
    process.exit(1);
  }
  console.log('  全部通过。\n');
})();
