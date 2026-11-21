/**
 * 自测 · 素材管理页「商品名完整显示 + 复制货号」（2026-11-17）
 * ============================================================
 * 被测文件：src/content/return-goods-name.js（与退货页同一个模块，按页分派）
 *
 * 为什么复用退货页那套：两页的共同形态就是「商品卡片 = 缩略图 + 名称(压成一行)
 * + 一行商品 ID」。判据全是可量的行为特征（不看构建哈希），所以一套判据管两页，
 * 只有三处分派：开关键 / 按钮锚点 / 诊断来源名。
 *
 * 素材页真实层级（用户 2026-11-17 交来的结构报告，v26.11.17.1）：
 *   div.productItem-kkMSKD
 *     ├ (缩略图)
 *     └ div.content-VDH1oG > div.detail-WvY4DW
 *          ├ div.name-VOjSh9 > div          184×16，文本高 48 ⇒ 平台按 3 行预留、只显 1 行
 *          └ div.productIdWrapper-qrfq0t > div.idStyle-ZOA1Ba > div   23 字（商品ID）
 *
 * 这条结构是本页与退货页唯一的实质差别：**名称与 ID 行各套一层，不是同一个
 * 父容器的兄弟**。按钮若只按名称父容器插，会挤进名称容器内部、把刚解开的三行
 * 名称又挤回一行 —— 所以锚点要往上找一层（detail），紧跟 ID 行。
 *
 * 覆盖：
 *   A. 名称解截断（line-clamp:1 → block），三行以内完整显示
 *   B. 按钮挂在 detail 层、紧跟 ID 行之后（不是挤进 name 容器）
 *   C. 每张卡只有一枚按钮（平台重渲染不重复插）
 *   D. 点击复制：货号走名称末尾推算，无货号时闪「无货号」且不复制半截内容
 *   E. 开关按页分派：素材页看 materialGoodsName，退货页看 returnGoodsName，互不牵连
 *   F. 清单：素材页有独立注入条目；全域轻量条目与兜底条目都把它排除（不重复注入）
 *   G. 源码红线：取样锚点必须能往上找一层（写死名称父容器就是本页的原始 bug）
 *
 * 用法：node scripts/自测-素材页商品名与货号.js
 * 退出码 0 = 全绿；1 = 有用例失败。
 * ============================================================
 */
'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');

let JSDOM;
try { ({ JSDOM } = require('jsdom')); }
catch (_) {
  ({ JSDOM } = require('C:/Users/79412/.workbuddy/binaries/node/workspace/node_modules/jsdom'));
}

const ROOT = path.resolve(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'src/content/return-goods-name.js'), 'utf8');
const CODE_SRC = fs.readFileSync(path.join(ROOT, 'src/content/item-code.js'), 'utf8');
const MANIFEST = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));

const MATERIAL_URL = 'https://fxg.jinritemai.com/ffa/creative/material-manage-menu?material_category=1';
const RETURN_URL = 'https://fxg.jinritemai.com/ffa/morder/logistics/policy-edit';

/* 名称取自真实商品名（自测-货号款号形态.js 里同一批样例）：
 * 第 0 条末尾 5 位款号、第 1 条末尾不是款号、第 2 条末尾 3 位款号。
 * ⚠️ 不能写成 NAME_OK + i —— 名称本身以数字结尾，拼上序号就不是原来那个款号了
 *    （第一版这么写，复制出来的是 6XL250，用例当场抓到）。 */
const NAMES = [
  'PM王囡囡 杏色连帽抽绳拉链外套 6XL25',
  '基础款纯棉圆领短袖T恤打底衫',
  'ARMS WELL 王囡囡 黑色丝毛侧拉链半身裙（有内衬）S28'
];
const NAME_OK = NAMES[0];
const NAME_NO_CODE = NAMES[1];

let pass = 0;
let fail = 0;
const failures = [];
function check(name, fn) {
  try { fn(); pass++; console.log('  ✓ ' + name); }
  catch (e) { fail++; failures.push(name + ' —— ' + e.message); console.log('  ✗ ' + name); }
}
async function checkAsync(name, fn) {
  try { await fn(); pass++; console.log('  ✓ ' + name); }
  catch (e) { fail++; failures.push(name + ' —— ' + e.message); console.log('  ✗ ' + name); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(pred, timeoutMs, step) {
  const limit = Date.now() + timeoutMs;
  while (Date.now() < limit) {
    if (pred()) return true;
    await sleep(step || 40);
  }
  return false;
}

/** 覆盖只读尺寸（jsdom 不做布局，scrollHeight / clientWidth 恒为 0） */
function defSize(el, prop, value) {
  Object.defineProperty(el, prop, { configurable: true, get() { return value; } });
}

/** 给元素装上「计算样式 + 盒子尺寸」，模拟平台真实状态 */
function clip(el, o) {
  const opt = o || {};
  const lineH = opt.lineH || 16;
  el.__cs = {
    clamp: opt.clamp || 0,
    nowrap: !!opt.nowrap,
    overflow: opt.overflow || 'visible',
    overflowY: opt.overflowY || 'visible',
    display: opt.display || 'block',
    flexDirection: opt.flexDirection || 'row'
  };
  defSize(el, 'scrollHeight', opt.scrollH != null ? opt.scrollH : lineH);
  defSize(el, 'clientHeight', opt.clientH != null ? opt.clientH : lineH);
  defSize(el, 'scrollWidth', opt.scrollW != null ? opt.scrollW : 184);
  defSize(el, 'clientWidth', opt.clientW != null ? opt.clientW : 184);
  return el;
}

/**
 * 造一个素材页：每张卡按报告的真实层级搭。
 *
 * @param {object} o
 *   o.url        页面地址（默认素材页）
 *   o.cards      卡片数
 *   o.names      覆盖前几张的名称
 *   o.scrollHs   覆盖各卡名称的自然高度（px）
 *   o.flags      开关对象
 */
function boot(o) {
  const opt = Object.assign({
    url: MATERIAL_URL,
    cards: 3,
    names: null,
    scrollHs: null,
    flags: { materialGoodsName: true, returnGoodsName: true },
    withThumb: true,
    idLines: true,
    csMode: 'normal',      // 'normal' | 'legacy' | 'noClamp'（见 getComputedStyle 注释）
    nameOverflowY: 'visible',  // 真机素材页是 'hidden'
    nameOverflow: 'visible',   // 真机素材页 overflow 计算值是 'auto hidden'
    extraOutside: '',      // 塞进 productItem 之外的「像卡片」结构，测收窄
    scrollH0: null,        // 覆盖第 0 张名称的自然高度
    clipAncestor: false    // 素材页真机形态：名称外层 .name-VOjSh9 定高 16，内容被它裁
  }, o || {});

  const cards = [];
  for (let i = 0; i < opt.cards; i++) {
    const nm = (opt.names && opt.names[i]) || NAMES[i % NAMES.length];
    cards.push(`
      <div class="productItem-kkMSKD" data-card="${i}">
        ${opt.withThumb ? '<img class="thumb" width="60" height="60" src="x.png">' : ''}
        <div class="content-VDH1oG">
          <div class="detail-WvY4DW">
            <div class="name-VOjSh9"><div data-nm="${i}">${nm}</div></div>
            ${opt.idLines
              ? `<div class="productIdWrapper-qrfq0t"><div class="idStyle-ZOA1Ba"><div data-pid="${i}">商品ID:35524304130478110${i}8</div></div></div>`
              : ''}
          </div>
        </div>
      </div>`);
  }

  const dom = new JSDOM(`<!doctype html><html><body>
    ${opt.extraOutside || ''}
    <div class="styles_app">${cards.join('')}</div>
  </body></html>`, { url: opt.url, runScripts: 'outside-only' });

  const win = dom.window;
  const doc = win.document;

  /* 计算样式：把我们写进去的 -webkit-line-clamp 反映回来（真机也是这样），
     否则「写过一次仍是截断态」会被判成永远要重写，幂等测不出来。
     ★ csMode 模拟内核差异（2026-11-17 真机就是这么翻车的）：
       'normal'  —— 快捷属性 + getPropertyValue 都齐全；
       'legacy'  —— 只有 getPropertyValue 能读到 clamp（快捷属性 undefined）；
       'noClamp' —— 两条路都读不到 clamp，只能靠「真被裁」判据兜。 */
  win.getComputedStyle = function (el) {
    const c = (el && el.__cs) || {};
    let clamp = c.clamp || 0;
    if (el && el.style) {
      const w = el.style.getPropertyValue('-webkit-line-clamp');
      if (w === 'none') clamp = 0;
      else if (w && parseInt(w, 10) > 0) clamp = parseInt(w, 10);
    }
    const display = (el && el.style && el.style.getPropertyValue('display')) || c.display || 'block';
    const box = {
      whiteSpace: c.nowrap ? 'nowrap' : 'normal',
      textOverflow: c.nowrap ? 'ellipsis' : 'clip',
      overflow: c.overflow || 'visible',
      overflowX: 'auto',
      overflowY: c.overflowY || 'visible',
      display: display,
      flexDirection: c.flexDirection || 'row',
      fontSize: '12px',
      lineHeight: '16px',
      getPropertyValue(p) {
        if (p === '-webkit-line-clamp') {
          if (opt.csMode === 'noClamp') return '';
          return clamp ? String(clamp) : 'none';
        }
        if (p === 'overflow-y') return box.overflowY;
        return '';
      }
    };
    if (opt.csMode !== 'legacy' && opt.csMode !== 'noClamp') {
      box.webkitLineClamp = clamp ? String(clamp) : 'none';
      box['-webkit-line-clamp'] = clamp ? String(clamp) : 'none';
    }
    return box;
  };

  /* 素材页真机形态（2026-11-21 抖动）：名称外层容器自己也定高 16，内容被它裁。
   * 只解最内层时视觉没变化 ⇒ 下一轮又判截断 ⇒ 每轮一次布局变化 = 抖。 */
  if (opt.clipAncestor) {
    doc.querySelectorAll('.name-VOjSh9').forEach((el) => {
      clip(el, { clamp: 0, scrollH: 48, clientH: 16, overflowY: 'hidden' });
    });
  }
  /* 名称按报告实测：clamp 1、盒子 16px、文本自然高 48px（平台按 3 行预留） */
  doc.querySelectorAll('[data-nm]').forEach((el) => {
    const i = parseInt(el.getAttribute('data-nm'), 10);
    const h = (opt.scrollHs && opt.scrollHs[i]) || opt.scrollH0 || 48;
    clip(el, {
      clamp: 1, scrollH: h, lineH: 16,
      overflow: opt.nameOverflow, overflowY: opt.nameOverflowY
    });
  });
  /* ID 行本身也是 line-clamp:1，但它是字段行 —— 不许被碰 */  doc.querySelectorAll('[data-pid]').forEach((el) => clip(el, { clamp: 1, scrollH: 16, lineH: 16 }));
  /* 卡片之外那块同形结构（测「收窄」是否生效）也给同样的截断状态 */
  doc.querySelectorAll('[data-out-name]').forEach((el) => {
    clip(el, { clamp: 1, scrollH: 48, lineH: 16, overflow: opt.nameOverflow, overflowY: opt.nameOverflowY });
  });

  const copied = [];
  const toasts = [];
  const diagNotes = [];
  let watchCb = null;
  Object.defineProperty(win.navigator, 'clipboard', {
    configurable: true,
    value: {
      writeText(t) { copied.push(t); return Promise.resolve(); },
      readText() { return Promise.resolve(''); }
    }
  });
  win.dycReadFlags = () => Promise.resolve(opt.flags);
  win.dycWatchFlags = (cb) => { watchCb = cb; };
  win.toast = (text, type, opts2) => { toasts.push({ text, type, opts: opts2 || {} }); };
  win.__dycDiag = { note: (action, detail, result) => diagNotes.push({ action, detail, result }) };
  /* 平台「货号」字段在本页不存在 —— 与真机一致，只能走名称末尾推算 */
  win.extractValueAfterLabel = () => null;

  win.eval(CODE_SRC);        // 取号判据（真身）
  let error = null;
  try { win.eval(SRC); } catch (e) { error = e; }

  return { dom, win, doc, copied, toasts, diagNotes, error, getWatchCb: () => watchCb };
}

const btns = (doc) => Array.from(doc.querySelectorAll('[data-dyc-rg-btn]'));

(async function main() {
  console.log('自测 · 素材页商品名与货号（src/content/return-goods-name.js）\n');

  /* ========== 一、识别 + 解截断 ========== */
  console.log('【一】素材页商品卡：名称解截断 + 各插一枚货号按钮');
  const A = boot({ cards: 3 });
  const okA = await waitFor(() => btns(A.doc).length === 3, 2000);

  check('脚本无异常', () => {
    assert.equal(A.error, null, '抛错：' + (A.error && A.error.message));
  });
  check('3 张卡各有一枚货号按钮', () => {
    assert.ok(okA, '只出现 ' + btns(A.doc).length + ' 枚 —— 卡片没被识别出来');
  });
  check('按钮文案是「货号」', () => {
    assert.equal(btns(A.doc).every((b) => b.textContent === '货号'), true);
  });
  check('名称打上「解开」属性（样式由常驻 CSS 提供，不写内联）', () => {
    const nm = A.doc.querySelector('[data-nm="0"]');
    assert.ok(nm.hasAttribute('data-dyc-rgopen'), '没打解开属性 —— 名称还是一行');
    assert.ok(!nm.hasAttribute('data-dyc-rgcap'), '同时打了钳制属性，两者互斥');
    assert.equal(String(nm.style.getPropertyValue('display') || ''), '',
      '又写了内联 display —— 内联会被平台洗掉，正是抖动的来源');
  });
  check('ID 行本身不被当成名称、也不被解截断', () => {
    const pid = A.doc.querySelector('[data-pid="0"]');
    assert.equal(pid.hasAttribute('data-dyc-rgopen'), false,
      'ID 行被解截断了 —— 那是字段行，不是商品名');
  });

  /* ========== 二、落点：名称右下角 ========== */
  console.log('\n【二】按钮落点：贴名称右下角（不在 ID 行下面）');
  check('按钮挂在名称容器里（不是 detail 层）', () => {
    const btn = btns(A.doc)[0];
    assert.ok(/name-VOjSh9/.test(btn.parentElement.className),
      '按钮挂在 ' + btn.parentElement.className + ' —— 会落到 ID 行下面（用户说不好看）');
  });
  check('ID 行后面没有按钮', () => {
    const wrapper = A.doc.querySelector('.productIdWrapper-qrfq0t');
    assert.ok(!(wrapper.nextElementSibling && wrapper.nextElementSibling.hasAttribute
      && wrapper.nextElementSibling.hasAttribute('data-dyc-rg-btn')),
      '按钮仍在 ID 行下面');
  });
  check('按钮绝对定位到名称右下角', () => {
    const btn = btns(A.doc)[0];
    assert.ok(/--corner/.test(btn.className), '按钮没有 corner 样式类：' + btn.className);
    /* 2026-11-17 第二版：上一版用 margin-left:auto，真机里按钮跑到卡片左半边
     * （rect x=448）—— 名称容器不是普通 block，margin:auto 不生效。 */
    assert.ok(/--corner\s*\{[\s\S]{0,160}?position:\s*absolute/.test(SRC),
      '--corner 不是绝对定位 —— 容器是 -webkit-box 时不会靠右');
    assert.ok(/--corner\s*\{[\s\S]{0,160}?right:\s*0[\s\S]{0,40}?bottom:\s*0/.test(SRC),
      '没有贴右下角（right:0 / bottom:0）');
  });
  check('名称容器只加定位上下文，不加内边距', () => {
    const nmBox = A.doc.querySelector('.name-VOjSh9');
    /* 2026-11-21：定位上下文改「属性 + 常驻 CSS」—— 内联会被平台重渲染洗掉，
     * 洗一次写一次就是抖动循环（与 OPEN/FIT 同一口径）。 */
    assert.ok(nmBox.hasAttribute('data-dyc-rghost'),
      '名称容器没有定位上下文，绝对定位的按钮会跑到外层');
    assert.equal(String(nmBox.style.getPropertyValue('position') || ''), '',
      '又写回内联 position 了 —— 平台洗掉后会每轮重写');
    assert.equal(String(nmBox.style.getPropertyValue('padding-bottom') || ''), '',
      '给名称容器加了内边距 —— 平台定高的容器会被压，名称又少一行');
  });
  check('按钮在名称容器内（绝对定位不看兄弟顺序）', () => {
    const nmBox = A.doc.querySelector('.name-VOjSh9');
    const btn = btns(A.doc)[0];
    assert.equal(btn.parentElement, nmBox, '按钮不在名称容器里');
  });

  /* ========== 三、幂等 ========== */
  console.log('\n【三】平台重渲染后不重复插按钮');
  {
    const d = A.doc.createElement('div');
    d.textContent = '平台又渲染了一块';
    A.doc.body.appendChild(d);
    await sleep(900);
    check('一轮变化后仍是 3 枚（不重复插）', () => {
      assert.equal(btns(A.doc).length, 3, '变成了 ' + btns(A.doc).length + ' 枚');
    });
  }

  /* ========== 四、点击复制 ========== */
  console.log('\n【四】点击「货号」：按名称末尾推算，拿不到就明说');
  await checkAsync('有款号 ⇒ 复制到剪贴板', async () => {
    const btn = btns(A.doc)[0];
    btn.click();
    const got = await waitFor(() => A.copied.length > 0, 1500);
    assert.ok(got, '没写剪贴板');
    /* 不绑死取号算法本身（判据在 item-code.js，另有专测）——
       这里只守住「复制出来的确实是名称末尾那一截，且不是半截空值」。 */
    assert.ok(A.copied[0] && A.copied[0].length >= 3, '复制内容是空的或过短：' + A.copied[0]);
    assert.ok(NAME_OK.endsWith(A.copied[0]),
      '复制的不是名称末尾那一截：' + A.copied[0]);
  });
  await checkAsync('名称末尾不是款号 ⇒ 闪「无货号」且不复制任何内容', async () => {
    const before = A.copied.length;
    const btn = btns(A.doc)[1];      // i=1 用的是 NAME_NO_CODE
    btn.click();
    const flashed = await waitFor(() => btn.textContent === '无货号', 1500);
    assert.ok(flashed, '按钮没有提示「无货号」');
    assert.equal(A.copied.length, before, '拿到空值还写了剪贴板');
  });

  /* ========== 五、开关按页分派 ========== */
  console.log('\n【五】两页两个键，互不牵连');

  {
    const B = boot({ cards: 2, flags: { materialGoodsName: false, returnGoodsName: true } });
    await sleep(400);
    check('素材页 + 素材开关关 ⇒ 不插按钮', () => {
      assert.equal(btns(B.doc).length, 0, '开关关了还在插按钮');
    });
    check('素材页 + 素材开关关 ⇒ 名称没被打标记', () => {
      const nm = B.doc.querySelector('[data-nm="0"]');
      assert.equal(nm.hasAttribute('data-dyc-rgopen'), false, '关掉后仍打了「解开」属性');
      assert.equal(String(nm.style.getPropertyValue('display') || ''), '',
        '关掉后仍写了内联样式');
    });
  }

  {
    const C = boot({ cards: 2, flags: { materialGoodsName: true, returnGoodsName: false } });
    const ok = await waitFor(() => btns(C.doc).length === 2, 2000);
    check('素材页不受「退货地址商品名」开关影响', () => {
      assert.ok(ok, '退货页开关关了，素材页也跟着不动 —— 键没分开');
    });
  }

  {
    /* 退货页：DOM 用它的形态（名称与 ID 行同父），开关只认 returnGoodsName */
    const D = boot({
      url: RETURN_URL,
      cards: 2,
      flags: { materialGoodsName: true, returnGoodsName: false }
    });
    await sleep(500);
    check('退货页不受「素材页」开关影响', () => {
      assert.equal(btns(D.doc).length, 0, '素材页开关把退货页带起来了 —— 键没分开');
    });
  }

  {
    /* 分派没写反：同一套 DOM 换成退货页地址，按钮就该回到 ID 行之后 */
    const E = boot({
      url: RETURN_URL,
      cards: 2,
      flags: { materialGoodsName: true, returnGoodsName: true }
    });
    await waitFor(() => btns(E.doc).length === 2, 2000);
    check('退货页按钮仍挂在 ID 行之后（落点分派没写反）', () => {
      const btn = btns(E.doc)[0];
      assert.ok(/detail-WvY4DW/.test(btn.parentElement.className),
        '退货页的按钮改挂到 ' + btn.parentElement.className + ' 了');
      assert.ok(!/--corner/.test(btn.className), '退货页不该用右下角样式');
    });
  }

  /* ========== 六、清单 ========== */
  console.log('\n【六】注入清单');

  check('素材页有独立注入条目，带功能脚本与开关层', () => {
    const hit = MANIFEST.content_scripts.find((c) =>
      (c.matches || []).some((m) => m.indexOf('/ffa/creative/') > -1));
    assert.ok(hit, '没有找到素材页的注入条目');
    assert.ok(hit.js.indexOf('src/content/return-goods-name.js') > -1, '条目里没带功能脚本');
    assert.ok(hit.js.indexOf('src/content/flags.js') > -1, '条目里没带开关层');
    assert.ok(hit.js.indexOf('src/live/hide-elements.js') > -1,
      '条目里没带隐藏元素 —— 本页仍属抖店全域，隐藏浮条要跟着生效');
    assert.ok((hit.css || []).indexOf('src/content/msgbox.css') > -1, '缺公共消息样式');
  });

  check('全域轻量条目把它排除掉（否则 flags/hide-elements 注入两次）', () => {
    const light = MANIFEST.content_scripts.find((c) =>
      c.js && c.js.length === 2 && c.js[1] === 'src/live/hide-elements.js');
    assert.ok(light, '没找到全域轻量条目');
    assert.ok((light.exclude_matches || []).some((m) => m.indexOf('/ffa/creative/') > -1),
      '没写进 exclude_matches');
  });

  check('全域兜底条目也排除它（否则 diag/dialog/面板注入两次）', () => {
    const fallback = MANIFEST.content_scripts.find((c) =>
      c.js && c.js.indexOf('src/content/full-nope.js') === -1
      && (c.js || []).indexOf('src/content/debug-panel.js') > -1
      && (c.exclude_matches || []).length > 5
      && (c.matches || []).indexOf('https://*.jinritemai.com/*') > -1);
    assert.ok(fallback, '没找到全域兜底条目');
    assert.ok((fallback.exclude_matches || []).some((m) => m.indexOf('/ffa/creative/') > -1),
      '没写进 exclude_matches');
  });

  /* ========== 七、源码红线 ========== */
  console.log('\n【七】源码结构');

  check('作用页是两页（不是只有退货页）', () => {
    assert.ok(/returnPolicy:\s*\/\^https/.test(SRC), '找不到退货页判据');
    assert.ok(/material:\s*\/\^https/.test(SRC), '找不到素材页判据');
  });

  check('开关键按页映射，不是写死一个', () => {
    assert.ok(/PAGE_FLAG\s*=\s*\{[\s\S]{0,200}material/.test(SRC),
      '没有按页映射开关键 —— 素材页会被退货页的开关控制');
    assert.ok(/materialGoodsName/.test(SRC), '找不到素材页的键名');
  });

  check('按钮锚点允许往上找一层（本页名称与 ID 行各套一层）', () => {
    assert.ok(/host\.parentElement/.test(SRC), '锚点只在名称父容器里找 —— 本页会找不到 ID 行');
  });

  check('内容脚本带构建号（否则「改了没生效」永远分不清是没重载还是逻辑错）', () => {
    const flagsSrc = fs.readFileSync(path.join(ROOT, 'src/content/flags.js'), 'utf8');
    const m = /DYC_BUILD_TAG\s*=\s*'([^']+)'/.exec(flagsSrc);
    assert.ok(m, 'flags.js 没有 DYC_BUILD_TAG');
    /* 注意 `+` 在正则里是量词，匹配字面加号必须写 \+ ——
     * 第一版漏了转义，断言把正确的 "26.11.17.1+r3" 判成格式错。 */
    assert.ok(/^\d{2}\.\d{2}\.\d{2}\.\d+\+r\d+$/.test(m[1]),
      '构建号格式应为 26.x.y.z+rN，实际：' + m[1]);
    assert.ok(/window\.__DYC_BUILD__/.test(flagsSrc), '构建号没有挂到 window 上');
    const diagSrc = fs.readFileSync(path.join(ROOT, 'src/content/diag.js'), 'utf8');
    assert.ok(/env\.build/.test(diagSrc), '诊断报告没有输出构建号');
  });

  check('诊断报「本轮解开 N 个名称」（分出「判据没命中」与「写了被洗」）', () => {
    assert.ok(/本轮解开/.test(SRC), '没有解开计数');
  });

  /* ========== 九、节点被换掉后立即补 ========== */
  console.log('\n【九】平台换掉名称节点后立即补（不等防抖）');
  {
    const W9 = boot({ cards: 1 });
    await waitFor(() => btns(W9.doc).length === 1, 2000);
    const old = W9.doc.querySelector('[data-nm="0"]');
    const fresh = W9.doc.createElement('div');
    fresh.setAttribute('data-nm', '0');
    fresh.textContent = NAME_OK;
    clip(fresh, { clamp: 1, scrollH: 48, lineH: 16 });
    old.parentElement.replaceChild(fresh, old);
    /* 常规防抖是 400ms；这里只给 150ms —— 超时就等于又回到「等防抖」，
     * 用户看到的就是名称闪一下（真机 1.3 秒重渲染一次，闪一次） */
    const quick = await waitFor(() => fresh.hasAttribute('data-dyc-rgopen'), 150);
    check('新节点 150ms 内被打上「解开」标记', () => {
      assert.ok(quick, '没有就地补 —— 用户会看到名称闪一下');
    });
    check('新节点旁仍有货号按钮（没有空窗）', () => {
      assert.ok(fresh.parentElement.querySelector('[data-dyc-rg-btn]'), '按钮没补上');
    });
  }

  /* ========== 八、截断判据：真机就是在这几条上翻的车 ========== */
  console.log('\n【八】截断判据（2026-11-17 真机现场）');

  {
    /* 8-1 快捷属性读不到 clamp，只有 getPropertyValue 能读到 */
    const W1 = boot({
      cards: 2, csMode: 'legacy',
      nameOverflowY: 'hidden', nameOverflow: 'auto hidden'
    });
    await waitFor(() => btns(W1.doc).length === 2, 2000);
    check('快捷属性读不到 clamp 时仍能认出并解开（真机就是这种内核）', () => {
      const nm = W1.doc.querySelector('[data-nm="0"]');
      assert.ok(nm.hasAttribute('data-dyc-rgopen'),
        '没解开 —— 名称还是一行，用户看到的就是「文字显示不完全」');
    });
  }

  {
    /* 8-2 两条路都读不到 clamp：只能靠「真被裁」兜 */
    const W2 = boot({
      cards: 2, csMode: 'noClamp',
      nameOverflowY: 'hidden', nameOverflow: 'auto hidden'
    });
    await waitFor(() => btns(W2.doc).length === 2, 2000);
    check('overflow 计算值是 "auto hidden" 时靠「真被裁」认出并解开', () => {
      const nm = W2.doc.querySelector('[data-nm="0"]');
      assert.ok(nm.hasAttribute('data-dyc-rgopen'),
        '没解开 —— overflow-y:hidden 的写法漏判');
    });
  }

  {
    /* 8-3 真滚动容器不许拆 */
    const W3 = boot({
      cards: 2, csMode: 'noClamp',
      nameOverflowY: 'auto', nameOverflow: 'auto'
    });
    await waitFor(() => btns(W3.doc).length === 2, 2000);
    check('overflow-y:auto 的可滚动容器不拆', () => {
      const nm = W3.doc.querySelector('[data-nm="0"]');
      assert.equal(nm.hasAttribute('data-dyc-rgopen'), false,
        '给滚动容器打了「解开」标记');
    });
  }

  {
    /* 8-4 属性常驻 ⇒ 不再反复重写（真机上 u10 → u0 → u10 的死循环就断在这里）。
       平台重渲染能洗掉内联样式，但洗不掉「样式规则 + 元素属性」这一对 ——
       这里每轮都把 style 整段删掉再触发扫描，断言不再重写、属性仍在。 */
    const W4 = boot({
      cards: 1, csMode: 'legacy',
      nameOverflowY: 'hidden', nameOverflow: 'auto hidden'
    });
    const nm4 = W4.doc.querySelector('[data-nm="0"]');
    const opened = await waitFor(() => nm4.hasAttribute('data-dyc-rgopen'), 2500);
    check('第一轮就打上「解开」属性', () => {
      assert.ok(opened, '没打属性');
    });
    const w0 = nm4.__dycRgWrites || 0;
    for (let r = 0; r < 6; r++) {
      nm4.removeAttribute('style');        // 模拟平台整段洗掉内联
      const d = W4.doc.createElement('div');
      W4.doc.body.appendChild(d);
      await sleep(450);
    }
    check('属性在 ⇒ 不再重复处理（u10↔u0 的死循环断掉）', () => {
      assert.ok(nm4.hasAttribute('data-dyc-rgopen'), '属性被我们摘掉了');
      assert.equal(nm4.__dycRgWrites || 0, w0,
        '还在重复写（' + w0 + ' → ' + (nm4.__dycRgWrites || 0) + '）—— 就是抖动的根源');
      assert.equal(String(nm4.style.getPropertyValue('display') || ''), '',
        '又重新写了内联 display');
    });
    check('诊断里能看到解开计数（真机可据此核对）', () => {
      assert.ok(W4.diagNotes.some((x) => /本轮解开/.test(x.detail)), '诊断没写解开计数');
    });
  }

  {
    /* 8-5 收窄：productItem 之外的同形结构不碰 */
    const W5 = boot({
      cards: 2,
      extraOutside: '<div class="brandBox" data-out="1">'
        + '<img width="60" height="60" src="x.png">'
        + '<div><div data-out-name="1">某个带图的非卡片区块文字也不应该被当成商品名</div></div>'
        + '</div>'
    });
    await waitFor(() => btns(W5.doc).length === 2, 2000);
    check('卡片之外的同形结构不被处理（收窄生效）', () => {
      const out = W5.doc.querySelector('[data-out="1"]');
      assert.equal(out.querySelector('[data-dyc-rg-btn]'), null,
        '页面其他位置的带图文字也被插了按钮 —— 会认错、也会带动布局抖');
      assert.equal(String(W5.doc.querySelector('[data-out-name="1"]').style.getPropertyValue('display') || ''), '',
        '页面其他位置的文字被解截断了');
    });
  }

  console.log('\n【十】素材页抖动（2026-11-21 用户：「这个页面会抖动」）');

  {
    /* 10-1 名称外层定高：解开时必须连祖先一起解锁，否则「解了等于没解」，
       下一轮又判截断 —— 每 4 秒一次布局变化，用户看到的就是整块上下跳。 */
    const W6 = boot({
      cards: 2, csMode: 'legacy', clipAncestor: true,
      nameOverflowY: 'hidden', nameOverflow: 'auto hidden'
    });
    await waitFor(() => btns(W6.doc).length === 2, 2000);
    check('名称外层把内容裁掉时，祖先一并解锁（否则解开看不见）', () => {
      const holder = W6.doc.querySelector('[data-card="0"] .name-VOjSh9');
      assert.ok(holder.hasAttribute('data-dyc-rgfit'),
        '外层定高没解锁 —— 文本解成两行也被它裁掉，下一轮还会重解');
    });
    check('解锁祖先只动高度与裁切，不动 display（那层常是平台 flex 列）', () => {
      const holder = W6.doc.querySelector('[data-card="0"] .name-VOjSh9');
      assert.equal(String(holder.style.getPropertyValue('display') || ''), '',
        '给祖先写了 display —— 会打散平台排版');
      assert.equal(String(holder.style.getPropertyValue('height') || ''), '',
        '写了内联 height —— 平台一重渲染就洗掉，等于又开始循环');
    });
    check('祖先解锁后不重复处理（属性在 ⇒ 规则在）', () => {
      const nm = W6.doc.querySelector('[data-nm="0"]');
      const w0 = nm.__dycRgWrites || 0;
      assert.equal(w0, 1, '第一轮就该只写一次，实际 ' + w0);
    });
  }

  {
    /* 10-2 hover 让路：鼠标停在哪张卡，那张卡这轮不改（在眼皮底下改布局最显眼）。 */
    const W7 = boot({ cards: 2, csMode: 'legacy', clipAncestor: true,
      nameOverflowY: 'hidden', nameOverflow: 'auto hidden' });
    const card0 = W7.doc.querySelector('[data-card="0"]');
    const orig = card0.matches.bind(card0);
    card0.matches = (sel) => (sel === ':hover' ? true : orig(sel));
    const nm7 = W7.doc.querySelector('[data-nm="0"]');
    nm7.removeAttribute('data-dyc-rgopen');
    nm7.__dycRgWrites = 0;
    W7.doc.body.appendChild(W7.doc.createElement('div'));   // 触发一轮扫描
    await sleep(500);
    check('鼠标停在该卡片上时不在它下面改写布局', () => {
      assert.equal(nm7.hasAttribute('data-dyc-rgopen'), false,
        'hover 期间照旧解开 —— 用户会看到鼠标底下文字跳动');
    });
    card0.matches = orig;
    W7.doc.body.appendChild(W7.doc.createElement('div'));
    const back = await waitFor(() => nm7.hasAttribute('data-dyc-rgopen'), 2500);
    check('鼠标移开后补上（晚一帧也比在眼皮底下跳好）', () => {
      assert.ok(back, '鼠标移开后再也不解开了 —— 功能被 hover 保护误伤');
    });
  }

  {
    /* 10-3 打摆闸：节点被整段重建时，挂在节点上的重写上限会归零（素材页就是这个
       形态），所以必须有与节点无关的静默期。这里只钉源码结构 —— 行为上要跨多轮
       重建表格行，jsdom 里模拟出来的时序比真机脆弱，静态断言更可信。 */
    check('存在与节点无关的打摆静默闸（否则节点一换就会无限重写）', () => {
      assert.ok(/var CHURN_WINDOW\s*=/.test(SRC) && /var CHURN_HITS\s*=/.test(SRC)
        && /var CHURN_REST\s*=/.test(SRC), '缺少打摆闸常量');
      assert.ok(/function\s+noteChurn\s*\(/.test(SRC), '缺少 noteChurn');
      const at = SRC.indexOf('function scan(');
      const rest = SRC.indexOf('churn.restUntil', at);
      assert.ok(at > 0 && rest > at, 'scan 里没有读静默期，闸不生效');
    });
    check('打摆记录必须在写入之前（先判定再写，写完才记就永远不触发）', () => {
      const at = SRC.indexOf('function noteChurn(');
      assert.ok(at > 0, '没找到 noteChurn');
      const callAt = SRC.indexOf('noteChurn(it.el)', at);
      const writeAt = SRC.indexOf('applyUnclip(it.el, reason, it.card)', at);
      assert.ok(callAt > 0 && writeAt > callAt, 'noteChurn 必须排在 applyUnclip 之前');
    });
    check('解开前先注入常驻规则（首轮属性打了没规则 = 白解一次）', () => {
      const at = SRC.indexOf('function applyUnclip(');
      const styleAt = SRC.indexOf('ensureStyleFor(el)', at);
      const setAt = SRC.indexOf('setAttribute(OPEN_ATTR', at);
      assert.ok(styleAt > at && setAt > styleAt, 'applyUnclip 必须先 ensureStyleFor 再打属性');
    });
  }

  /* ========== 汇总 ========== */  process.stdout.write('\n────────────────────────────────────────\n');
  if (failures.length) {
    console.log('失败 ' + fail + ' 条，通过 ' + pass + ' 条：');
    failures.forEach((f) => console.log('  · ' + f));
    process.exit(1);
  }
  console.log('全部通过（' + pass + ' 条）');
  process.exit(0);
})().catch((e) => {
  console.error('自测自身异常：', e);
  process.exit(1);
});
