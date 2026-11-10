'use strict';

/**
 * 自测 · 粘贴入口扩展(2026-11-10 建)
 *
 * 被测:src/content/goods-image-paste.js
 *
 * 用户 2026-11-10 提的两处新入口,各自钉死一件事:
 *   A 规格图那个 24~32px 的相机图标 —— 常规档(56 起)挂不上,要新增「微型档」;
 *     按钮挂在图标**下方**,不压图标;已出图就不挂。
 *   B 商详图片工具栏「从主图填入」左边的行级按钮 —— 贴进去的图必须落在
 *     **商详区块自己那个 input** 里,绝不能串到主图的 input(那会贴错位置)。
 *
 * jsdom 的现实约束(别改断言去迁就):
 *   · getBoundingClientRect 全是 0 ⇒ 本脚本给每个关键元素桩上真实尺寸,
 *     否则「微型 / 常规」根本无从区分;
 *   · isVisible / findAllByText 用桩替换,只测我们自己的判定逻辑。
 *
 * 用法：node scripts/自测-粘贴入口扩展.js（run-selftests.py 自动带上）
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
const waitFor = async (test, timeout = 3000) => {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    if (test()) return;
    await sleep(25);
  }
  throw new Error('等待目标状态超时');
};
async function checkSeq(name, fn) {
  try { await fn(); pass++; console.log('  ✓ ' + name); }
  catch (e) { fail++; failures.push(name + ' —— ' + e.message); console.log('  ✗ ' + name); }
}

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8AAAwAB/wF8mDP8AAAAAElFTkSuQmCC';

const HTML = `<!doctype html><html><body>
<div id="goodsEditScrollContainer">
  <!-- 规格区:颜色分类行里的相机图标(真机 24~32px) -->
  <div id="specRow">
    <span class="lbl">颜色分类</span>
    <div id="camTile"><span class="ico">▣</span><input type="file" accept="image/*" style="display:none"></div>
    <span class="lbl2">请选择或输入颜色分类</span>
  </div>
  <!-- 第二个规格值,同样结构 -->
  <div id="specRow2">
    <div id="camTile2"><span class="ico">▣</span><input type="file" accept="image/*" style="display:none"></div>
  </div>
  <!-- 商详图片区:8 张全是已出图的格子,没有空白格 -->
  <div id="detailBlock">
    <div class="hd" id="detailHd">商详图片（8/50）</div>
    <div id="detailBar">
      <button id="btnFromMain">从主图填入</button>
      <button id="btnUpload">上传图片</button>
      <button id="btnAdv">高级编辑</button>
    </div>
    <div id="thumbList">
      <div class="t"><img src="https://example.test/1.png" alt=""></div>
      <div class="t"><img src="https://example.test/2.png" alt=""></div>
    </div>
    <input id="detailInput" type="file" accept="image/*" multiple style="display:none">
  </div>
  <!-- 干扰项:主图区也有 input,工具栏按钮绝不能往这里塞 -->
  <div id="mainBlock">
    <div class="hd">主图</div>
    <div id="mainTile"><span>+</span><span>上传图片</span><input id="mainInput" type="file" accept="image/*" style="display:none"></div>
  </div>
</div>
</body></html>`;

function stubBox(el, w, h) {
  el.getBoundingClientRect = () => ({
    width: w, height: h, top: 0, left: 0, right: w, bottom: h, x: 0, y: 0
  });
}

(async function main() {
  const dom = new JSDOM(HTML, {
    url: 'https://fxg.jinritemai.com/ffa/g/create?entrance=edit',
    runScripts: 'outside-only'
  });
  const win = dom.window;
  const doc = win.document;

  /* ---- 桩:开关层 ---- */
  const flags = { goodsImagePaste: true };
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
        if (el.nodeValue && el.nodeValue.indexOf(text) >= 0) out.push(el.parentElement);
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

  /* ---- 桩:DataTransfer + files ---- */
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

  /* ---- 真实尺寸(jsdom 全是 0,不桩就分不出微型与常规) ---- */
  const camTile = doc.getElementById('camTile');
  const camTile2 = doc.getElementById('camTile2');
  const specRow = doc.getElementById('specRow');
  const detailBlock = doc.getElementById('detailBlock');
  const mainTile = doc.getElementById('mainTile');
  stubBox(camTile, 32, 32);
  stubBox(camTile2, 32, 32);
  stubBox(specRow, 887, 96);
  stubBox(detailBlock, 1083, 320);
  stubBox(mainTile, 118, 118);

  win.eval(read(SRC_UNDER_TEST));
  await sleep(60);   // 等首扫 + 延迟重扫

  const camInput = camTile.querySelector('input[type="file"]');

  console.log('\n【一】A 项 · 规格图微型入口');
  check('32px 相机图标挂上了按钮(常规档 56 的下限不再把它判死)', () => {
    assert.ok(camTile.querySelector('.dyc-imgpaste-btn'), '图标里没有按钮');
  });
  check('按钮是微型档(带 is-micro,挂在图标下方而不是盖在图标上)', () => {
    const btn = camTile.querySelector('.dyc-imgpaste-btn');
    assert.ok(btn.classList.contains('is-micro'), '不是 is-micro:' + btn.className);
  });
  check('规格行本身没有再挂一个(只留最内层)', () => {
    const own = specRow.querySelector('.dyc-imgpaste-btn');
    assert.ok(!own || camTile.contains(own), '行容器上多挂了一个按钮');
  });
  check('第二个规格值也各自挂了一个', () => {
    assert.equal(camTile2.querySelectorAll('.dyc-imgpaste-btn').length, 1);
  });
  check('微型档的按钮文字与框内按钮一致(同属一个功能)', () => {
    assert.equal(camTile.querySelector('.dyc-imgpaste-btn').textContent, '粘贴图片');
  });

  console.log('\n【一之二】点一下:贴进图标背后的 input');
  let camChanged = 0;
  camInput.addEventListener('change', () => {
    camChanged++;
    setTimeout(() => {
      const img = doc.createElement('img');
      img.src = 'blob:cam';
      camTile.appendChild(img);
    }, 5);
  });
  camTile.querySelector('.dyc-imgpaste-btn')
    .dispatchEvent(new win.MouseEvent('click', { bubbles: true, cancelable: true }));
  await sleep(500);
  check('图塞进了图标自己的 input', () => {
    assert.ok(camInput.__dycFiles, '没有塞 files');
    assert.equal(camInput.__dycFiles.length, 1);
  });
  check('派发了 change', () => {
    assert.equal(camChanged, 1, 'change 次数:' + camChanged);
  });
  check('另一个规格值的 input 没被碰', () => {
    assert.equal(camTile2.querySelector('input').__dycFiles, undefined);
  });

  await sleep(800);
  check('出图后微型按钮自动摘掉', () => {
    assert.equal(camTile.querySelector('.dyc-imgpaste-btn'), null, '出图后按钮还在');
  });

  console.log('\n【二】B 项 · 商详图片工具栏按钮');
  const anchor = doc.getElementById('btnFromMain');
  const bar = doc.getElementById('detailBar');
  check('按钮插进来了', () => {
    assert.ok(bar.querySelector('.dyc-imgpaste-toolbar'), '工具栏没有按钮');
  });
  check('位置在「从主图填入」左边', () => {
    const btn = bar.querySelector('.dyc-imgpaste-toolbar');
    assert.equal(btn.nextElementSibling, anchor, '不是紧挨在锚点左边');
  });
  check('按钮文字是「粘贴图片」', () => {
    assert.equal(bar.querySelector('.dyc-imgpaste-toolbar').textContent, '粘贴图片');
  });
  await sleep(700);
  check('重扫后仍然只有一个', () => {
    assert.equal(bar.querySelectorAll('.dyc-imgpaste-toolbar').length, 1);
  });

  const detailInput = doc.getElementById('detailInput');
  const mainInput = doc.getElementById('mainInput');
  let detailChanged = 0;
  detailInput.addEventListener('change', () => {
    detailChanged++;
    setTimeout(() => {
      const img = doc.createElement('img');
      img.src = 'blob:detail-new';
      doc.getElementById('thumbList').appendChild(img);
    }, 5);
  });

  messages.length = 0;
  bar.querySelector('.dyc-imgpaste-toolbar')
    .dispatchEvent(new win.MouseEvent('click', { bubbles: true, cancelable: true }));
  await sleep(900);
  check('图落进商详区块自己的 input', () => {
    assert.ok(detailInput.__dycFiles, '商详 input 没收到文件');
    assert.equal(detailInput.__dycFiles.length, 1);
    assert.equal(detailChanged, 1);
  });
  check('主图的 input 完全没被碰(不跨区块)', () => {
    assert.equal(mainInput.__dycFiles, undefined, '贴到主图去了');
  });
  check('报了一条成功消息(来源/值/结果数三段式)', () => {
    const ok = messages.filter((m) => m.kind === 'success');
    assert.equal(ok.length, 1, '成功消息 ' + ok.length + ' 条');
    assert.equal(ok[0].opts.source, '图片粘贴');
    assert.equal(ok[0].opts.count, '已入框');
  });

  console.log('\n【二之二】张数已满时不动作');
  doc.getElementById('detailHd').textContent = '商详图片（50/50）';
  detailInput.__dycFiles = undefined;
  detailChanged = 0;
  messages.length = 0;
  bar.querySelector('.dyc-imgpaste-toolbar')
    .dispatchEvent(new win.MouseEvent('click', { bubbles: true, cancelable: true }));
  await sleep(500);
  check('满 50 张:不塞文件、不派 change', () => {
    assert.equal(detailInput.__dycFiles, undefined, '满了还往里塞');
    assert.equal(detailChanged, 0);
  });
  check('满 50 张:如实报一条「已满」', () => {
    const msg = messages.filter((m) => m.kind === 'alert' && /已满/.test(m.value));
    assert.equal(msg.length, 1, '没有报已满');
  });
  doc.getElementById('detailHd').textContent = '商详图片（8/50）';

  console.log('\n【三】开关关闭:两处新入口一起消失');
  watchCb({ goodsImagePaste: false });
  await sleep(120);
  check('微型按钮移除', () => {
    assert.equal(doc.querySelectorAll('.dyc-imgpaste-btn').length, 0);
  });
  check('商详工具栏按钮移除', () => {
    assert.equal(doc.querySelectorAll('.dyc-imgpaste-toolbar').length, 0);
  });
  check('按钮留在 tile 上的标记属性也清掉了', () => {
    assert.equal(camTile2.getAttribute('data-dyc-imgpaste-tile'), null);
    assert.equal(camTile2.getAttribute('data-dyc-imgpaste-mode'), null);
  });

  watchCb({ goodsImagePaste: true });
  await sleep(200);
  check('重新打开后两处入口都回来', () => {
    assert.equal(doc.querySelectorAll('.dyc-imgpaste-toolbar').length, 1);
    assert.ok(camTile2.querySelector('.dyc-imgpaste-btn'), '微型按钮没回来');
  });

  console.log('\n────────────────────────────────────────');
  console.log('  通过 ' + pass + ' / 失败 ' + fail);
  if (fail) {
    failures.forEach((f) => console.log('  ✗ ' + f));
    process.exitCode = 1;
  } else {
    console.log('  全部通过。');
  }
})();
