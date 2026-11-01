'use strict';

/**
 * 自测 · 微信小店「商品名完整显示」（2026-10-31）
 *
 * 功能本体在 src/content/wx-goods-title.js。它要同时满足四个容易互相
 * 矛盾的约束，本脚本逐条钉死：
 *
 *   ① **必须穿透 shadow** —— 微信小店是 micro-app 微前端，商品表格在
 *      <micro-app> 的 open shadowRoot 里（实测 5591 个元素中 5000 个在
 *      shadow 内）。顶层 document 只有壳和左侧菜单。
 *   ② **不能误伤同行的其他截断列** —— 一行里「规格」「时间」列也可能
 *      带 nowrap+ellipsis。所以实现按「语义类名优先、特征扫描兜底」，
 *      这里用反向断言锁死：同一行里 class 不匹配的截断元素**必须原样不动**。
 *   ③ **幂等** —— 平台重渲染会抹掉内联样式而留下 data 标记。只认标记会
 *      导致「永不补涂 → 永久省略号」。这里断言「标记在但样式被抹」时能
 *      被重新展开，且**不重复备份**（否则关开关还原不回平台原样）。
 *   ④ **开关能还原** —— 关掉后内联样式要清回平台原值，标记要摘掉。
 *
 * ⚠️ jsdom 没有布局引擎：clientWidth / scrollWidth / getComputedStyle 的
 *    CSS 计算都不可靠。这里对原型打补丁把尺寸按元素喂进去、并给「截断」
 *    元素写真实的内联样式 —— 测的是**判据逻辑**，不是浏览器排版。
 *    真机排版（行高变化、sticky 列对齐）仍需实机验证。
 *
 * 用法：node scripts/自测-微信小店商品全名.js（run-selftests.py 自动带上）
 */

const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');

let JSDOM;
try { ({ JSDOM } = require('jsdom')); }
catch (_) { ({ JSDOM } = require('C:/Users/79412/.workbuddy/binaries/node/workspace/node_modules/jsdom')); }

const ROOT = path.join(__dirname, '..');
const CODE = fs.readFileSync(path.join(ROOT, 'src/content/wx-goods-title.js'), 'utf8');

let pass = 0;
let fail = 0;
const failures = [];
function check(name, fn) {
  try { fn(); pass++; console.log('  ✓ ' + name); }
  catch (e) { fail++; failures.push(name + ' —— ' + e.message); console.log('  ✗ ' + name); }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 给某个 window 的 Element 原型补尺寸（jsdom 无布局引擎） */
function patchSizes(win, sizeOf) {
  if (!win || !win.Element) return;
  for (const [prop, key, dflt] of [
    ['clientWidth', 'cw', 100], ['scrollWidth', 'sw', 100],
    ['clientHeight', 'ch', 20], ['scrollHeight', 'sh', 20]
  ]) {
    Object.defineProperty(win.Element.prototype, prop, {
      configurable: true,
      get() {
        const s = sizeOf(this) || {};
        return s[key] === undefined ? dflt : s[key];
      }
    });
  }
}

/**
 * 造一个仿真页面并跑真实功能脚本。
 * @param {object} opt
 *   url        页面地址（决定是否商品列表页）
 *   withClass  商品名是否带语义类名 goods_title_1（false 测特征兜底）
 *   rows       行数
 */
async function boot(opt) {
  const o = Object.assign({ url: 'https://store.weixin.qq.com/shop/goods/list?page=1',
    withClass: true, rows: 12, shortNames: false }, opt);

  const dom = new JSDOM(`<!doctype html><html><body>
    <div id="shell"><div class="small_menu"><a class="menu-sub-item">菜单</a></div>
      <micro-app id="biz"></micro-app></div>
  </body></html>`, { url: o.url, runScripts: 'outside-only' });

  const win = dom.window;
  const doc = win.document;
  const sr = doc.getElementById('biz').attachShadow({ mode: 'open' });

  const nameCls = o.withClass ? 'goods_title_1' : 'title-text-x';
  const NAME_LONG = '超长商品名称甲乙丙丁戊己庚辛壬癸子丑寅卯辰巳午未申酉戌亥很长的款号ABCDE';

  sr.innerHTML = `<table class="goods-table"><tbody>${
    Array.from({ length: o.rows }, (_, i) => `
      <tr>
        <td class="c-check"><input type="checkbox"></td>
        <td class="c-name"><div class="item-basic-info">
          <div class="${nameCls}" style="white-space:nowrap;text-overflow:ellipsis;overflow:hidden">${NAME_LONG}${i}</div>
        </div></td>
        <td class="c-spec"><div class="spec-x" style="white-space:nowrap;text-overflow:ellipsis;overflow:hidden">规格：默认规格一大箱加赠品${i}</div></td>
      </tr>`).join('')
  }</tbody></table>`;

  const rows = Array.from(sr.querySelectorAll('tr'));
  const names = rows.map((tr) => tr.querySelector('.' + nameCls));
  const specs = rows.map((tr) => tr.querySelector('.spec-x'));

  // 尺寸：商品名 288 宽、文本 400（真机实测 288 / 321~447）；
  // 规格列同样溢出，用来验证「不会被误伤」。
  // 高度 40 = 两行（真机单行 20），这样「折行才加留白」的判据才跑得起来。
  const SIZE = new WeakMap();
  names.forEach((el) => SIZE.set(el, o.shortNames
    ? { cw: 288, sw: 250, ch: 20, sh: 20 }     // 短名字：不溢出、单行
    : { cw: 288, sw: 400, ch: 40, sh: 40 }));  // 长名字：溢出、折两行
  specs.forEach((el) => SIZE.set(el, { cw: 200, sw: 260, ch: 20, sh: 20 }));
  patchSizes(win, (el) => SIZE.get(el));

  const toasts = [];
  let watchCb = null;
  win.dycReadFlags = () => Promise.resolve({ wxGoodsFullTitle: o.enabled !== false });
  win.dycWatchFlags = (cb) => { watchCb = cb; };
  win.toast = (text, type, opts) => { toasts.push({ text, type, opts: opts || {} }); };

  let error = null;
  try { win.eval(CODE); } catch (e) { error = e; }

  await sleep(60);    // 等 dycReadFlags().then 里的首次 applyAll
  return { dom, win, doc, sr, rows, names, specs, toasts, error,
    getWatchCb: () => watchCb };
}

(async function main() {
  /* ========== 主场景：商品列表页 + 语义类名 ========== */
  console.log('\n【一】穿透 shadow 并展开商品名');
  const A = await boot({});
  const S0 = A.names[0];

  check('脚本无异常', () => {
    assert.equal(A.error, null, '抛错：' + (A.error && A.error.message));
  });

  check('shadow 内的商品名被解除 nowrap（核心）', () => {
    assert.equal(S0.style.whiteSpace, 'normal', 'white-space 没改成 normal');
    assert.equal(S0.style.textOverflow, 'clip', 'text-overflow 没改成 clip');
    assert.equal(S0.style.overflow, 'visible', 'overflow 没放开');
  });

  check('高度交给内容、不写死', () => {
    assert.equal(S0.style.height, 'auto', 'height 不是 auto');
    assert.equal(S0.style.maxHeight, 'none', 'max-height 不是 none');
  });

  check('款号不被腰斩：word-break normal + overflow-wrap break-word', () => {
    assert.equal(S0.style.wordBreak, 'normal', 'word-break 应为 normal');
    assert.equal(S0.style.overflowWrap, 'break-word', 'overflow-wrap 应为 break-word');
  });

  check('全部 12 行都处理了（不是只处理第一行）', () => {
    const done = A.names.filter((el) => el.style.whiteSpace === 'normal').length;
    assert.equal(done, 12, '只处理了 ' + done + ' 行');
  });

console.log('\n【一·二】折行后的留白（2026-10-31 用户反馈「不够美观」）');
check('折成两行时加行距（两行不贴在一起）', () => {
  assert.equal(S0.style.lineHeight, '1.55', 'line-height 没设：' + S0.style.lineHeight);
});
check('尝试 text-wrap: balance（让两行长度接近）', () => {
  const v = S0.style.getPropertyValue('text-wrap');
  assert.equal(v, 'balance', 'text-wrap 没设成 balance：' + v);
});
check('名字与下方「ID:」之间留缝', () => {
  assert.equal(S0.style.paddingBottom, '2px', 'padding-bottom 没设：' + S0.style.paddingBottom);
});
check('留白加在每一折行的行（12 行都折了，所以 12 行都有）', () => {
  const withLh = A.names.filter((el) => el.style.lineHeight === '1.55').length;
  assert.equal(withLh, 12, '只有 ' + withLh + ' 行加了行距');
});

console.log('\n【一·三】单行名字不加留白（保持平台原样）');
const E = await boot({ shortNames: true });
check('单行名字只展开、不加行距与间距', () => {
  const el = E.names[0];
  assert.equal(el.style.whiteSpace, 'normal', '展开本身应该生效');
  assert.equal(el.style.lineHeight, '', '单行不该加行距：' + el.style.lineHeight);
  assert.equal(el.style.paddingBottom, '', '单行不该加间距：' + el.style.paddingBottom);
  assert.equal(el.style.getPropertyValue('text-wrap'), '', '单行不该设 balance');
});
E.dom.window.close();

console.log('\n【二】不误伤同行的其他截断列（反向断言）');
check('同行的「规格」列没有被展开', () => {
  // 判据是「没被改成 normal」而不是「内联为空」—— 仿真页给规格列写的
  // 初始内联值本来就是 nowrap（模拟平台截断），为空反而不对。
  A.specs.forEach((el, i) => {
    assert.notEqual(el.style.whiteSpace, 'normal', '第 ' + i + ' 行规格被展开了');
    assert.notEqual(el.style.height, 'auto', '第 ' + i + ' 行规格高度被改了');
    assert.ok(!el.hasAttribute('data-dyc-wxtitle'), '第 ' + i + ' 行规格被打上了标记');
  });
});

  console.log('\n【三】幂等与备份');
  check('处理过带标记，且备份只写一次', () => {
    assert.equal(S0.getAttribute('data-dyc-wxtitle'), '2', '标记版本不是 2');
    const orig = JSON.parse(S0.getAttribute('data-dyc-wxtitle-orig') || '{}');
    // 平台原值的备份里不能有我们自己写的值
    assert.ok(!('whiteSpace' in orig) || orig.whiteSpace !== 'normal',
      '备份里存进了我们自己写的值');
    assert.equal(orig.whiteSpace, 'nowrap', '平台原值没被备份：' + JSON.stringify(orig));
  });

  // 幂等双条件是异步动作（要等补涂），单独跑，不用 check() 包装
  await (async () => {
    try {
      S0.style.whiteSpace = '';        // 模拟平台重写 style，抹掉内联
      S0.style.height = '';
      // 触发一次补涂：直接调开关回调以外的方式 —— 制造 DOM 变更
      A.sr.appendChild(A.doc.createElement('span'));
      await sleep(400);                 // rAF + 300ms 尾扫
      assert.equal(S0.style.whiteSpace, 'normal', '被抹掉的样式没有再补回来');
      const orig2 = JSON.parse(S0.getAttribute('data-dyc-wxtitle-orig') || '{}');
      assert.equal(orig2.whiteSpace, 'nowrap', '重写时备份被覆盖了');
      pass++; console.log('  ✓ 样式被平台抹掉后能重新展开（幂等双条件）');
    } catch (e) {
      fail++; failures.push('幂等双条件 —— ' + e.message);
      console.log('  ✗ 样式被平台抹掉后能重新展开（幂等双条件）');
    }
  })();

  console.log('\n【四】消息口径');
  // 2026-10-31 用户：「商品全名展开，不需要弹出消息提醒」——
  // 纯视觉效果，名字变全了一眼看得到，消息条只会白响一次。
  check('展开完成一条消息都不报', () => {
    assert.equal(A.toasts.length, 0,
      '报了 ' + A.toasts.length + ' 条：' + A.toasts.map((t) => t.text).join(' / '));
  });

  console.log('\n【五】开关关闭后还原');
  await (async () => {
    try {
      const cb = A.getWatchCb();
      assert.ok(cb, '没有订阅开关变化');
      cb({ wxGoodsFullTitle: false });
      await sleep(60);
      assert.equal(S0.style.whiteSpace, 'nowrap', '关闭后没还原成平台原值（仿真页初值是 nowrap）');
      assert.equal(S0.style.height, '', '关闭后 height 没还原');
      assert.equal(S0.style.lineHeight, '', '关闭后行距没还原');
      assert.equal(S0.style.paddingBottom, '', '关闭后间距没还原');
      assert.ok(!S0.hasAttribute('data-dyc-wxtitle'), '关闭后标记没摘掉');
      const off = A.toasts[A.toasts.length - 1];
      assert.equal(off.text, '已关闭', '关闭没有报消息');
      pass++; console.log('  ✓ 关闭后样式还原、标记摘除、报一条「已关闭」');
    } catch (e) {
      fail++; failures.push('开关还原 —— ' + e.message);
      console.log('  ✗ 关闭后样式还原、标记摘除、报一条「已关闭」');
    }
  })();

  await sleep(50);
  A.dom.window.close();

  /* ========== 场景二：类名被平台改掉 → 特征扫描兜底 ========== */
  console.log('\n【六】语义类名失效时退回特征扫描');
  const B = await boot({ withClass: false });
  check('没有 goods_title_1 也能找到商品名', () => {
    assert.equal(B.error, null, '抛错：' + (B.error && B.error.message));
    const done = B.names.filter((el) => el.style.whiteSpace === 'normal').length;
    assert.ok(done > 0, '兜底路径一个都没处理');
  });
  check('兜底时仍不碰规格列', () => {
    assert.ok(B.specs.every((el) => el.style.whiteSpace !== 'normal'),
      '兜底路径把规格列也展开了 —— 兜底只应取行内第一个截断文本');
  });
  B.dom.window.close();

  /* ========== 场景三：非商品列表页不处理 ========== */
  console.log('\n【七】非商品列表页不动');
  const C = await boot({ url: 'https://store.weixin.qq.com/shop/home' });
  check('店铺首页上的表格不被处理', () => {
    const done = C.names.filter((el) => el.style.whiteSpace === 'normal').length;
    assert.equal(done, 0, '非列表页处理了 ' + done + ' 个元素');
    assert.equal(C.toasts.length, 0, '非列表页不该报消息');
  });
  C.dom.window.close();

  /* ========== 场景四：开关默认关闭时不动作 ========== */
  console.log('\n【八】开关关闭态不动作');
  const D = await boot({ enabled: false });
  check('开关关闭时一个都不处理、也不报消息', () => {
    const done = D.names.filter((el) => el.style.whiteSpace === 'normal').length;
    assert.equal(done, 0, '关闭态处理了 ' + done + ' 个');
    assert.equal(D.toasts.length, 0, '关闭态不该报消息');
  });
  D.dom.window.close();

  /* ========== 汇总 ========== */
  console.log('\n' + '─'.repeat(46));
  if (fail === 0) {
    console.log('  全部通过：' + pass + ' 项');
  } else {
    console.log('  通过 ' + pass + ' 项，失败 ' + fail + ' 项');
    failures.forEach((f) => console.log('   · ' + f));
    process.exitCode = 1;
  }
})();
