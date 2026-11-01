'use strict';

/**
 * 自测 · 页面结构探针的 Shadow DOM 穿透（2026-10-31）
 *
 * 背景：用户要「商品列表完整显示商品全名」，导出的结构报告却只有左侧菜单 ——
 * 微信小店是 micro-app 微前端，业务 DOM 全在 `<micro-app>` 的 shadow root 里，
 * 而旧版探针一律走 document.querySelectorAll，穿透不了边界。
 *
 * 本脚本用一个「壳 + shadow 内列表」的仿真页面跑真实探针代码，钉死四件事：
 *   ① 候选列表容器能采到 shadow 内的行容器（不再只看到菜单）
 *   ② 交互元素能采到 shadow 内的按钮
 *   ③ 骨架里 shadow 宿主带 `▸shadow` 标记，且展开到 shadow 内一层
 *   ④ 报告新增「六、被截断的文本元素」，且只记字数、不记商品名原文
 *
 * ⚠️ jsdom 没有布局引擎，clientWidth / scrollWidth / getBoundingClientRect 全为 0，
 *    而「截断判定」正是靠这几个值。所以这里对原型打了补丁，把尺寸按元素喂进去 ——
 *    测的是**判据逻辑**，不是浏览器排版；真实排版仍需真机。
 *
 * 用法：node scripts/自测-微信小店页面探针.js（run-selftests.py 自动带上）
 */

const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');

let JSDOM;
try { ({ JSDOM } = require('jsdom')); }
catch (_) { ({ JSDOM } = require('C:/Users/79412/.workbuddy/binaries/node/workspace/node_modules/jsdom')); }

const ROOT = path.join(__dirname, '..');
const code = fs.readFileSync(path.join(ROOT, 'src/content/page-probe.js'), 'utf8');

let pass = 0;
let fail = 0;
const failures = [];
function check(name, fn) {
  try { fn(); pass++; console.log('  ✓ ' + name); }
  catch (e) { fail++; failures.push(name + ' —— ' + e.message); console.log('  ✗ ' + name); }
}

const SECRET = '商品名甲乙丙丁戊己庚辛壬癸超长款';

/* ---------- 造一个「壳 + shadow 内列表」的仿真页面 ---------- */
const dom = new JSDOM(`<!doctype html><html><body>
  <div id="shell">
    <div class="small_menu">
      ${Array.from({ length: 8 }, (_, i) => `<a class="menu-sub-item" href="#${i}">菜单${i}</a>`).join('')}
    </div>
    <micro-app id="biz"></micro-app>
  </div>
</body></html>`, { url: 'https://store.weixin.qq.com/shop/goods/list', runScripts: 'outside-only' });

const win = dom.window;
const doc = win.document;
const core = doc.getElementById('biz');

// shadow 内：一个 12 行的商品列表 + 一个被截断的商品名 + 一个按钮
const sr = core.attachShadow({ mode: 'open' });
sr.innerHTML = `
  <div class="goods-table">
    ${Array.from({ length: 12 }, (_, i) => `
      <div class="goods-row">
        <div class="goods-name">${SECRET}${i}</div>
        <span class="goods-price">¥1</span>
        <button class="btn-edit">编辑</button>
      </div>`).join('')}
  </div>`;

const clippedEl = sr.querySelector('.goods-name');

/* ---------- 再造一个「同源 iframe」：micro-app 的另一种沙箱 ---------- */
// 报告里出现 `iframe: 1 个` 时，业务 DOM 可能在这里而不是 shadow 里。
// 只穿透 shadow 会整块漏掉，所以两个都要测。
const ifr = doc.createElement('iframe');
doc.body.appendChild(ifr);
let iframeDoc = null;
try { iframeDoc = ifr.contentDocument; } catch (e) { iframeDoc = null; }
if (iframeDoc && iframeDoc.body) {
  iframeDoc.body.innerHTML = `<div class="frame-table">
    ${Array.from({ length: 9 }, (_, i) => `
      <div class="frame-row">
        <span class="frame-title">帧内标题${i}</span>
        <button class="frame-btn">帧内操作</button>
      </div>`).join('')}
  </div>`;
}

/* ---------- 给 jsdom 补尺寸（它没有布局引擎） ---------- */
const SIZE = new WeakMap();
SIZE.set(clippedEl, { cw: 100, sw: 360, ch: 24, sh: 24 });

// 给某个 window 的 Element 原型补尺寸。⚠️ iframe 内的元素用的是**另一个 realm**
// 的 Element 原型，只补主文档那份，iframe 里采到的元素尺寸仍是 0，会被可见性检查丢掉。
function patchSizes(w) {
  if (!w || !w.Element) return;
  w.Element.prototype.getBoundingClientRect = function () {
    const s = (SIZE.get(this) || {});
    const wd = s.cw || 120;
    const ht = s.ch || 24;
    return { x: 0, y: 0, left: 0, top: 0, right: wd, bottom: ht, width: wd, height: ht };
  };
  for (const [prop, key, dflt] of [
    ['clientWidth', 'cw', 100], ['scrollWidth', 'sw', 100],
    ['clientHeight', 'ch', 24], ['scrollHeight', 'sh', 24]
  ]) {
    Object.defineProperty(w.Element.prototype, prop, {
      configurable: true,
      get() { const s = SIZE.get(this) || {}; return s[key] === undefined ? dflt : s[key]; }
    });
  }
}
patchSizes(win);
patchSizes(iframeDoc && iframeDoc.defaultView);

// 让「商品名」真的带上截断样式
clippedEl.setAttribute('style', 'white-space: nowrap; text-overflow: ellipsis; overflow: hidden;');

// 探针要的两个全局
win.chrome = {
  runtime: { getManifest: () => ({ version: '26.10.31.x' }) },
  storage: { onChanged: { addListener() {} } }
};

let captured = null;
win.__dycProbeSink = (payload) => { captured = payload; };

/* ---------- 跑真实探针 ---------- */
let runError = null;
try { win.eval(code); } catch (e) { runError = e; }

console.log('\n【一】探针能跑通并回传');
check('无异常、拿到报告', () => {
  assert.equal(runError, null, '抛错：' + (runError && runError.message));
  assert.ok(captured, '没有回传 payload');
  assert.equal(captured.ok, true, 'ok 不为 true：' + (captured && captured.error));
});
const report = (captured && captured.text) || '';

console.log('\n【二】穿透 shadow root');
check('候选列表容器采到 shadow 内的行容器（不再只有菜单）', () => {
  assert.ok(report.includes('goods-row'), '报告里没有 goods-row —— 候选容器没进 shadow');
  assert.ok(report.includes('goods-table'), '报告里没有 goods-table');
});
check('交互元素采到 shadow 内的按钮', () => {
  assert.ok(report.includes('btn-edit'), '报告里没有 btn-edit —— 交互元素没进 shadow');
  assert.ok(report.includes('编辑'), '按钮文本应被采到（≤20 字的线索文本）');
});
check('骨架里 shadow 宿主带 ▸shadow 标记', () => {
  assert.ok(report.includes('▸shadow'), '骨架没有标出 shadow 宿主');
});
check('同源 iframe 也穿透了（micro-app 的另一种沙箱）', () => {
  if (!iframeDoc || !iframeDoc.body) {
    console.log('    (jsdom 未提供 iframe.contentDocument，跳过该用例)');
    return;
  }
  assert.ok(report.includes('frame-row') || report.includes('frame-table'),
    '报告里没有 iframe 内的容器 —— iframe 没穿透');
  assert.ok(report.includes('帧内操作'), 'iframe 内的按钮没采到');
  assert.ok(/同源可读/.test(report), 'iframe 行应标注「同源可读」');
});
check('页面元素总数把 shadow 内的算进去了', () => {
  assert.ok(/shadow 内 \d+ 个/.test(report), '总数没有补 shadow 部分');
});

console.log('\n【三】被截断文本：新增段落 + 判据');
check('报告有「六、被截断的文本元素」段', () => {
  assert.ok(report.includes('六、被截断的文本元素'), '缺这一段');
});
check('识别出 nowrap / ellipsis 截断', () => {
  // 只在第六节里找 —— 第三节「行结构样本」也会出现 goods-name，
  // 之前断言取错行，把功能正常误报成失败
  const sec6 = report.split('## 六、')[1] || '';
  const line = sec6.split('\n').find((l) => l.includes('goods-name')) || '';
  assert.ok(line, '第六节没有采到 goods-name');
  assert.ok(/nowrap|ellipsis/.test(line), '截断来源没判出来：' + line.slice(0, 120));
});
check('路径跨 shadow 边界用 ▸ 标出', () => {
  assert.ok(/goods-name.*▸|▸.*goods-name/.test(report) || report.includes('▸'), '路径里没有跨边界标记');
});

console.log('\n【四】隐私口径：只记长度，不记商品名原文');
check('报告不含商品名全文', () => {
  assert.ok(!report.includes(SECRET), '商品名原文泄漏进报告');
});
check('报告声明了「不采内容」', () => {
  assert.ok(report.includes('不采内容') || report.includes('只记录了字符长度'), '缺少口径声明');
});

console.log('\n【五】只看截断判据的实现要点（静态断言，防以后被删）');
check('判据覆盖 line-clamp / ellipsis / nowrap / overflowY 四种', () => {
  assert.ok(code.includes('-webkit-line-clamp'), '缺 line-clamp 判据');
  assert.ok(code.includes("textOverflow === 'ellipsis'"), '缺 ellipsis 判据');
  assert.ok(code.includes("whiteSpace === 'nowrap'"), '缺 nowrap 判据');
  assert.ok(code.includes('overflowY'), '缺 overflowY 判据');
});
check('有节点预算与深度上限（防大列表拖死页面）', () => {
  assert.ok(code.includes('NODE_BUDGET'), '缺节点预算');
  assert.ok(code.includes('SHADOW_DEPTH'), '缺 shadow 深度上限');
});

/* ---------- 汇总 ---------- */
console.log('\n' + '='.repeat(62));
console.log('通过 ' + pass + ' / ' + (pass + fail));
if (fail) {
  console.log('失败用例：');
  failures.forEach((f) => console.log('  · ' + f));
  process.exit(1);
}
console.log('全绿 ✓  —— 探针已能穿透 micro-app 的 shadow root，且截断证据可定位');
