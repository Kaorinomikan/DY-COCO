'use strict';

/**
 * 自测 · 抖店「多地址退货」页 商品名完整显示 + 货号复制（计划 #139，2026-11-17）
 *
 * 功能本体：src/content/return-goods-name.js
 * 取号判据：src/content/item-code.js（唯一真源，本自测直接 eval 真身，不抄判据）
 *
 * 钉死这些事（每条都对应真机上会出错的地方）：
 *   ① 只处理「真被截断 + 像商品名 + 同块有缩略图」的文本叶子：
 *      下拉框里的地址（line-clamp:1、42 字）一个字都不许动
 *   ② 解截断按截断原因写最少一组属性；自然 ≤3 行不钳、>3 行才钳三行
 *   ③ 名称之后插「货号」按钮；父容器是横向 flex 时补 flex-wrap（不挤窄名称）
 *   ④ 幂等：反复扫描不插第二枚按钮；平台换掉名称节点后补涂 + 补按钮
 *   ⑤ 取号三态：官方「货号」→ 名称末尾推算 → 无货号（不复制半截内容）
 *   ⑥ 我们自己的按钮文案不进取值（否则「货号」二字会刮到旁边的数字）
 *   ⑦ 关开关：按钮移除、内联样式逐条还原
 *   ⑧ 作用域：URL 不在 /ffa/morder/logistics/ 时不干活
 *   ⑨ 源码红线：不写 left/top 绝对定位、按钮宽固定 56px、不抄货号判据
 *   ⑩ 清单：新页有独立注入条目，且全域轻量条目已把它排除（不重复注入）
 *
 * ⚠️ 本页结构来自用户 2026-11-17 交来的《页面结构报告》（只采结构不采内容），
 *    卡片里到底有没有「货号」字段未知 ⇒ 官方档只能靠用例模拟。
 *    这里测的是**判据与收尾逻辑**，不是平台真实 DOM；真机不符时功能会如实
 *    报「无货号」，不会复制错内容。
 *
 * 用法：node scripts/自测-多退货地址.js
 * 退出码 0 = 全绿；1 = 有用例失败。
 */

const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');

let JSDOM;
try { ({ JSDOM } = require('jsdom')); }
catch (_) { ({ JSDOM } = require('C:/Users/79412/.workbuddy/binaries/node/workspace/node_modules/jsdom')); }

const ROOT = path.resolve(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'src/content/return-goods-name.js'), 'utf8');
const CODE_SRC = fs.readFileSync(path.join(ROOT, 'src/content/item-code.js'), 'utf8');
const MANIFEST = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));

let pass = 0;
let fail = 0;
const failures = [];
function check(name, fn) {
  try { fn(); pass++; console.log('  ✓ ' + name); }
  catch (e) { fail++; failures.push(name + ' —— ' + e.message); console.log('  ✗ ' + name); }
}
/* 点击 → 剪贴板是 Promise 链，必须等它收尾；check 同步跑会读到空数组 */
async function checkAsync(name, fn) {
  try { await fn(); pass++; console.log('  ✓ ' + name); }
  catch (e) { fail++; failures.push(name + ' —— ' + e.message); console.log('  ✗ ' + name); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/* 等目标状态成立（禁固定 sleep 卡时间：并发跑全量时定时器会被推迟） */
async function waitFor(pred, timeoutMs, step) {
  const limit = Date.now() + timeoutMs;
  while (Date.now() < limit) {
    if (pred()) return true;
    await sleep(step || 60);
  }
  return false;
}

const PAGE_OK = 'https://fxg.jinritemai.com/ffa/morder/logistics/policy-edit?btm_ppre=a1';
const CODE = 'S28';
const NAME_OK = '2026秋冬新款加厚保暖羊毛围巾女韩版百搭长款披肩围脖 ' + CODE;
const NAME_NO_CODE = '纯中文商品名没有款号也没有英文字母';
const ADDR = '广东省深圳市南山区科技园南路12号3栋501室仓库收货点';

/* ============================================================
 * 1. DOM 垫片：jsdom 没有布局，尺寸与计算样式靠 per-element 注入
 * ============================================================ */

function defSize(el, prop, value) {
  Object.defineProperty(el, prop, { configurable: true, get() { return value; } });
}

/** 给元素装上「计算样式 + 盒子尺寸」，模拟平台真实状态 */
function clip(el, o) {
  const opt = o || {};
  const lineH = opt.lineH || 22;
  el.__cs = {
    clamp: opt.clamp || 0,
    nowrap: !!opt.nowrap,
    overflow: opt.overflow || 'visible',
    display: opt.display || 'block',
    flexDirection: opt.flexDirection || 'row'
  };
  defSize(el, 'scrollHeight', opt.scrollH != null ? opt.scrollH : lineH);
  defSize(el, 'clientHeight', opt.clientH != null ? opt.clientH : lineH);
  defSize(el, 'scrollWidth', opt.scrollW != null ? opt.scrollW : 520);
  defSize(el, 'clientWidth', opt.clientW != null ? opt.clientW : (opt.nowrap ? 300 : 520));
  return el;
}

function boot(o) {
  const opt = Object.assign({
    url: PAGE_OK,
    cards: 13,
    names: null,          // 覆盖前几张卡的商品名
    officialCodes: null,  // 覆盖前几张卡的「货号」字段；'' = 不写
    withThumb: true,      // false = 卡片不带缩略图（测兜底）
    scrollHs: null,       // 覆盖各卡名称的 scrollHeight（模拟解截断后的自然行数）
    idLines: true,        // 名称下一行放「ID:3854…」（与真机截图一致）
    unclipAll: false,     // true = 名称都不截断（两行正好装下，模拟抽屉实况）
    splitName: false,     // true = 名称里把品牌前缀拆成 <span>（平台常见的配色写法）
    shadowHost: false,    // true = 整个抽屉塞进 shadowRoot（微前端沙箱的形态）
    enabled: true
  }, o || {});

  const cards = [];
  for (let i = 0; i < opt.cards; i++) {
    const nm = (opt.names && opt.names[i]) || (i === 1 ? NAME_NO_CODE : NAME_OK + i);
    const official = (opt.officialCodes && opt.officialCodes[i]) || '';
    cards.push(`
      <div class="card" data-card="${i}">
        ${opt.withThumb ? '<img class="thumb" width="60" height="60" src="x.png">' : ''}
        <div class="info">
          <div class="nm" data-nm="${i}">${opt.splitName ? '<span class="bd">PM</span> ' : ''}${nm}</div>
          ${opt.idLines ? `<div class="pid" data-pid="${i}">ID:38543063555255050${i}22</div>` : ''}
          ${official ? `<div class="code"><span class="lb">货号</span><span class="vv">${official}</span></div>` : ''}
        </div>
      </div>`);
  }

  const inner = `
      <div class="aurora-select" data-sel="1">
        <div class="sel-value" role="combobox">
          <div class="addr" data-addr="1">${ADDR}</div>
        </div>
      </div>
      <div class="plain" data-plain="1">这是一段被截断的说明文字但不是商品名也不是卡片里的东西</div>
      <div class="productList">${cards.join('')}</div>`;

  /* 抽屉形态两种都测：普通 DOM（默认）与 shadowRoot 沙箱（微前端常见） */
  const html = `<!doctype html><html><body>
    ${opt.shadowHost ? '<div id="host"></div>' : '<div class="form">' + inner + '</div>'}
  </body></html>`;

  const dom = new JSDOM(html, { url: opt.url, runScripts: 'outside-only' });
  const win = dom.window;
  const doc = win.document;
  let sr = null;
  if (opt.shadowHost) {
    sr = doc.getElementById('host').attachShadow({ mode: 'open' });
    sr.innerHTML = `<div class="form">${inner}</div>`;
  }

  /* 计算样式：把我们写进去的 -webkit-line-clamp 反映回来（真机也是这样），
   * 否则「写过一次还是截断态」会被判成永远需要重写，幂等测不出来。 */
  win.getComputedStyle = function (el) {
    const c = (el && el.__cs) || {};
    let clamp = c.clamp || 0;
    if (el && el.style) {
      const w = el.style.getPropertyValue('-webkit-line-clamp');
      if (w === 'none') clamp = 0;
      else if (w && parseInt(w, 10) > 0) clamp = parseInt(w, 10);
    }
    const display = (el && el.style && el.style.getPropertyValue('display')) || c.display || 'block';
    return {
      webkitLineClamp: clamp ? String(clamp) : 'none',
      '-webkit-line-clamp': clamp ? String(clamp) : 'none',
      whiteSpace: c.nowrap ? 'nowrap' : 'normal',
      textOverflow: c.nowrap ? 'ellipsis' : 'clip',
      overflow: c.overflow || 'visible',
      display: display,
      flexDirection: c.flexDirection || 'row',
      fontSize: '14px',
      lineHeight: '22px'
    };
  };

  /* 页面状态：13 个商品名 line-clamp:1（盒子 546×22，与结构报告一致） */
  const scopeRoots = sr ? [doc, sr] : [doc];
  scopeRoots.forEach((root) => root.querySelectorAll('[data-nm]').forEach((el) => {
    const i = parseInt(el.getAttribute('data-nm'), 10);
    const h = (opt.scrollHs && opt.scrollHs[i]) || 22;
    if (opt.unclipAll) clip(el, { clamp: 0, scrollH: h, lineH: 22, overflow: 'hidden' });
    else clip(el, { clamp: 1, scrollH: h, lineH: 22 });
  }));
  /* 地址那格也是 line-clamp:1（42 字）—— 不许被我们碰 */
  scopeRoots.forEach((root) => {
    const addr = root.querySelector('[data-addr]');
    if (addr) clip(addr, { clamp: 1, scrollH: 22, lineH: 22 });
    const plain = root.querySelector('[data-plain]');
    if (plain) clip(plain, { clamp: 1, scrollH: 22, lineH: 22 });
  });

  const copied = [];
  Object.defineProperty(win.navigator, 'clipboard', {
    configurable: true,
    value: { writeText(t) { copied.push(t); return Promise.resolve(); }, readText() { return Promise.resolve(''); } }
  });

  const toasts = [];
  const diagNotes = [];
  let watchCb = null;
  win.dycReadFlags = () => Promise.resolve({ returnGoodsName: opt.enabled });
  win.dycWatchFlags = (cb) => { watchCb = cb; };
  win.toast = (text, type, opts) => { toasts.push({ text, type, opts: opts || {} }); };
  win.__dycDiag = { note: (action, detail, result) => diagNotes.push({ action, detail, result }) };

  /* anchor.js 不整file加载（它依赖页面上很多东西），只给「标签 → 下一个兄弟」
   * 这一条与真身同语义的最小实现；官方档的判定仍由 item-code.js 真身把守。 */
  win.extractValueAfterLabel = function (root, label) {
    const spans = root.querySelectorAll('.lb');
    for (const s of spans) {
      if (String(s.textContent || '').trim() !== label) continue;
      const next = s.nextElementSibling;
      if (next) return String(next.textContent || '').trim();
    }
    return null;
  };

  win.eval(CODE_SRC);      // 取号判据（真身）
  let error = null;
  try { win.eval(SRC); } catch (e) { error = e; }

  return { dom, win, doc, sr, copied, toasts, diagNotes, error, getWatchCb: () => watchCb };
}

function btnIn(doc, i) {
  return doc.querySelector(`[data-card="${i}"] [data-dyc-rg-btn]`);
}
function allBtns(docOrSr) {
  return Array.from(docOrSr.querySelectorAll('[data-dyc-rg-btn]'));
}
function rootOf(scene) {
  return scene.sr || scene.doc;
}

(async function main() {
  /* ========== 一、基本注入 ========== */
  console.log('\n【一】13 张商品卡：名称解截断 + 各插一枚货号按钮');
  const A = boot({});
  await sleep(60);

  check('脚本无异常', () => {
    assert.equal(A.error, null, '抛错：' + (A.error && A.error.message));
  });
  check('13 张卡各有一枚货号按钮', () => {
    assert.equal(allBtns(A.doc).length, 13, '只有 ' + allBtns(A.doc).length + ' 枚');
  });
  check('按钮文案是「货号」', () => {
    assert.equal(allBtns(A.doc).every((b) => b.textContent === '货号'), true, '文案不对');
  });
  check('名称元素被写成块级并解掉 line-clamp', () => {
    const nm = A.doc.querySelector('[data-nm="0"]');
    assert.equal(nm.style.getPropertyValue('display'), 'block', 'display 没改成 block：' + nm.style.display);
    assert.equal(nm.style.getPropertyValue('-webkit-line-clamp'), 'none', '没解掉 line-clamp');
  });
  check('按钮插在「ID:3854…」那一行之后（与小黄车贴着 ID 摆同一思路）', () => {
    const nm = A.doc.querySelector('[data-nm="0"]');
    const pid = A.doc.querySelector('[data-pid="0"]');
    const btn = btnIn(A.doc, 0);
    assert.equal(btn.parentElement, nm.parentElement, '按钮没插进名称的父容器');
    assert.equal(pid.nextElementSibling, btn, '按钮没紧跟在 ID 行之后');
  });

  /* ========== 一·二、名称没被截断也要给按钮（抽屉实况） ========== */
  console.log('\n【一·二】抽屉里多数名称两行正好装下、没有省略号：仍要插按钮、但不动样式');
  const A2 = boot({ cards: 3, unclipAll: true });
  await sleep(60);
  check('名称未截断 ⇒ 3 枚按钮照样出现', () => {
    assert.equal(allBtns(A2.doc).length, 3, '只有 ' + allBtns(A2.doc).length + ' 枚');
  });
  check('名称未截断 ⇒ 不改它的任何样式（不白写 display / line-clamp）', () => {
    const nm = A2.doc.querySelector('[data-nm="0"]');
    assert.equal(String(nm.style.display || ''), '', '未截断却写了 display：' + nm.style.display);
    assert.equal(String(nm.style.getPropertyValue('-webkit-line-clamp') || ''), '', '未截断却写了 line-clamp');
  });

  /* ========== 一·三、ID 行不能被当成商品名 ========== */
  console.log('\n【一·三】名称下一行的「ID:3854…」不是商品名（它比短名字还长）');
  const A3 = boot({ cards: 2, names: ['纯棉短袖T恤女夏', '纯棉短袖T恤女夏'] });
  await sleep(60);
  check('短名字不会被更长的 ID 行顶掉：按钮仍挂在名称所在卡内', () => {
    const nm = A3.doc.querySelector('[data-nm="0"]');
    const pid = A3.doc.querySelector('[data-pid="0"]');
    assert.equal(pid.nextElementSibling.hasAttribute('data-dyc-rg-btn'), true, '按钮没挂在 ID 行之后');
    assert.equal(nm.parentElement.querySelectorAll('[data-dyc-rg-btn]').length, 1, '这张卡出现多枚按钮');
  });
  check('每张卡只有一枚按钮（ID 行没被当成第二个名称）', () => {
    assert.equal(allBtns(A3.doc).length, 2, '按钮数 ' + allBtns(A3.doc).length + ' ≠ 卡片数 2');
  });

  /* ========== 一·四、名称里带行内 span 也要认出 ========== */
  console.log('\n【一·四】名称把品牌前缀拆成 <span> 时，整块仍要算一个名称');
  const A4 = boot({ cards: 2, splitName: true });
  await sleep(60);
  check('带行内 span 的名称 ⇒ 每卡一枚按钮', () => {
    assert.equal(allBtns(A4.doc).length, 2, '只有 ' + allBtns(A4.doc).length + ' 枚');
  });
  check('带行内 span 的名称也能解截断（写在外层那个块上）', () => {
    const nm = A4.doc.querySelector('[data-nm="0"]');
    assert.equal(nm.style.getPropertyValue('display'), 'block', '外层没解截断：' + nm.style.display);
  });
  await checkAsync('带行内 span 的名称仍能取出末尾款号', async () => {
    btnIn(A4.doc, 0).click();
    await sleep(20);
    assert.deepEqual(A4.copied, [CODE + '0'], '剪贴板：' + JSON.stringify(A4.copied));
  });

  /* ========== 一·五、按钮样式必须真的注入（真机事故 44×28 / display:block） ========== */
  console.log('\n【一·五】按钮样式注入：56×20 蓝描边，跟小黄车那枚同款');
  check('页面里确实插入了按钮样式表', () => {
    const st = A.doc.getElementById('dyc-rg-style');
    assert.ok(st, '没有 style#dyc-rg-style —— 按钮会退回浏览器默认外观（44×28 / block）');
    const css = String(st.textContent || '');
    assert.ok(css.indexOf('width: 56px') > -1, '样式里没有 56px 固定宽');
    assert.ok(css.indexOf('display: inline-flex') > -1, '样式里没有 inline-flex');
    assert.ok(css.indexOf('#0075ff') > -1, '样式里没有小黄车那套主色');
  });

  /* ========== 一·六、抽屉在 shadowRoot 里也要生效 ========== */
  console.log('\n【一·六】抽屉挂在 shadowRoot（微前端沙箱）里：照样认出、样式也进得去');
  const A5 = boot({ cards: 3, shadowHost: true });
  await sleep(80);
  check('shadowRoot 里的 3 张卡各有一枚按钮', () => {
    assert.equal(allBtns(rootOf(A5)).length, 3, '只有 ' + allBtns(rootOf(A5)).length + ' 枚');
  });
  check('按钮文档节点来自 shadow 那棵树（ownerDocument 一致）', () => {
    const btn = rootOf(A5).querySelector('[data-dyc-rg-btn]');
    assert.equal(btn.ownerDocument, A5.doc, 'ownerDocument 不是同一个 document');
    assert.equal(btn.getRootNode(), A5.sr, '按钮没落在 shadowRoot 里');
  });
  check('样式被注入进那个 shadowRoot（manifest 的 CSS 进不去）', () => {
    assert.ok(A5.sr.querySelector('#dyc-rg-style'), 'shadowRoot 里没有样式表 → 按钮会是裸的');
  });
  check('shadow 里的名称照样被解截断', () => {
    const nm = A5.sr.querySelector('[data-nm="0"]');
    assert.equal(nm.style.getPropertyValue('display'), 'block', '没解截断：' + nm.style.display);
  });

  /* ========== 一·七、抽屉后开：新渲染的卡片要能进来 ========== */
  console.log('\n【一·七】先无卡、后开抽屉：新增的卡片必须在下一轮被重新收集');
  const A6 = boot({ cards: 0 });
  await sleep(80);
  check('初始没有商品卡 ⇒ 0 枚按钮', () => {
    assert.equal(allBtns(A6.doc).length, 0, '初始就有 ' + allBtns(A6.doc).length + ' 枚');
  });
  await checkAsync('动态插入的商品卡被识别（抽屉打开的真实路径）', async () => {
    const host = A6.doc.querySelector('.productList');
    const box = A6.doc.createElement('div');
    box.innerHTML = '<div class="card" data-card="d"><img width="60" height="60" src="x.png">'
      + '<div class="info"><div class="nm" data-nm="d">' + NAME_OK + 'd</div>'
      + '<div class="pid" data-pid="d">ID:38543063555255050122</div></div></div>';
    const card = box.firstElementChild;
    host.appendChild(card);
    clip(card.querySelector('[data-nm="d"]'), { clamp: 1, scrollH: 22, lineH: 22 });
    const ok = await waitFor(() => A6.doc.querySelectorAll('[data-dyc-rg-btn]').length >= 1, 8000);
    assert.ok(ok, '8 秒内没识别到新卡片（缓存不失效 = 抽屉永远进不来）');
    const nm = card.querySelector('[data-nm="d"]');
    assert.equal(nm.style.getPropertyValue('display'), 'block', '新卡片没解截断');
  });

  /* ========== 一·八、一张卡只许一枚按钮（真机：13 枚对 12 张卡） ========== */
  console.log('\n【一·八】名称节点换了父容器（平台重渲染）也只保留一枚按钮');
  const A7 = boot({ cards: 1 });
  await sleep(60);
  check('初始 1 张卡 ⇒ 1 枚按钮', () => {
    assert.equal(allBtns(A7.doc).length, 1, '有 ' + allBtns(A7.doc).length + ' 枚');
  });
  check('名称被包进新容器后重扫：仍是 1 枚（复用并挪位，不新增）', () => {
    const nm = A7.doc.querySelector('[data-nm="0"]');
    const info = nm.parentElement;
    const wrap = A7.doc.createElement('div');
    wrap.className = 'nmwrap';
    info.insertBefore(wrap, info.firstChild);
    wrap.appendChild(nm);                 // 换父容器
    A7.win.__DYC_RETURN_GOODS_NAME_API__.scan();
    A7.win.__DYC_RETURN_GOODS_NAME_API__.scan();
    assert.equal(allBtns(A7.doc).length, 1, '变成 ' + allBtns(A7.doc).length + ' 枚');
    const card = A7.doc.querySelector('[data-card="0"]');
    assert.equal(card.querySelectorAll('[data-dyc-rg-btn]').length, 1, '卡内出现多枚');
  });
  check('同一张卡里出现第二个「像名称」的叶子也不会多插', () => {
    const card = A7.doc.querySelector('[data-card="0"]');
    const info = card.querySelector('.info');
    const fake = A7.doc.createElement('div');
    fake.textContent = '这是一段更长的、像商品名的说明文字但其实是卡片里的另一段内容';
    clip(fake, { clamp: 1, scrollH: 22, lineH: 22 });
    info.appendChild(fake);
    A7.win.__DYC_RETURN_GOODS_NAME_API__.scan();
    A7.win.__DYC_RETURN_GOODS_NAME_API__.scan();
    assert.equal(card.querySelectorAll('[data-dyc-rg-btn]').length, 1, '卡内出现多枚');
  });

  /* ========== 二、不许误伤 ========== */
  console.log('\n【二】同页其它被截断的文字：下拉框地址与普通说明一律不碰');
  check('下拉框里的地址没有被动样式、也没有按钮', () => {
    const addr = A.doc.querySelector('[data-addr]');
    assert.equal(addr.style.getPropertyValue('display'), '', '地址被改成 ' + addr.style.display);
    const sib = addr.nextElementSibling;
    assert.equal(!!(sib && sib.hasAttribute('data-dyc-rg-btn')), false, '地址旁被插了按钮');
  });
  check('卡片外的截断说明文字不处理', () => {
    const plain = A.doc.querySelector('[data-plain]');
    assert.equal(plain.style.getPropertyValue('display'), '', '说明文字被改了：' + plain.style.display);
    const sib = plain.nextElementSibling;
    assert.equal(!!(sib && sib.hasAttribute('data-dyc-rg-btn')), false, '说明文字旁被插了按钮');
  });

  /* ========== 三、行数口径 ========== */
  console.log('\n【三】两行装得下就完整显示，超过三行才钳三行');
  const B2 = boot({ cards: 1, scrollHs: [44] });
  await sleep(60);
  check('自然两行（44px / 行高 22）⇒ 解截断后不再钳、不写 max-height', () => {
    const nm = B2.doc.querySelector('[data-nm="0"]');
    assert.equal(nm.style.getPropertyValue('-webkit-line-clamp'), 'none', '两行被钳了：' + nm.style.getPropertyValue('-webkit-line-clamp'));
    assert.equal(nm.style.getPropertyValue('max-height'), '', '不该写 max-height：' + nm.style.getPropertyValue('max-height'));
    assert.equal(nm.style.getPropertyValue('line-height'), '1.55', '折行后该补行高');
  });
  const B5 = boot({ cards: 1, scrollHs: [110] });
  await sleep(60);
  check('自然五行（110px / 行高 22）⇒ 钳三行 + max-height 兜底', () => {
    const nm = B5.doc.querySelector('[data-nm="0"]');
    assert.equal(nm.style.getPropertyValue('-webkit-line-clamp'), '3', '没钳到三行：' + nm.style.getPropertyValue('-webkit-line-clamp'));
    assert.equal(nm.style.getPropertyValue('max-height'), '67px', 'max-height 兜底不对：' + nm.style.getPropertyValue('max-height'));
  });

  /* ========== 四、幂等 + 重渲染补涂 ========== */
  console.log('\n【四】反复扫描不插第二枚；平台换掉名称节点后补上');
  check('再扫一轮，按钮仍是 13 枚', () => {
    const before = allBtns(A.doc).length;
    A.win.__DYC_RETURN_GOODS_NAME_API__.scan();
    assert.equal(allBtns(A.doc).length, before, '按钮变成 ' + allBtns(A.doc).length + ' 枚');
  });
  check('平台重建名称节点 ⇒ 新节点被解截断并补上按钮', () => {
    const old = A.doc.querySelector('[data-nm="2"]');
    const fresh = A.doc.createElement('div');
    fresh.setAttribute('data-nm', '2');
    fresh.className = 'nm';
    fresh.textContent = NAME_OK + '2';
    clip(fresh, { clamp: 1, scrollH: 22, lineH: 22 });
    old.parentElement.replaceChild(fresh, old);
    const n = A.win.__DYC_RETURN_GOODS_NAME_API__.scan();
    assert.ok(n >= 1, '这一轮一个都没注入');
    assert.equal(fresh.style.getPropertyValue('display'), 'block', '新节点没解截断');
    assert.ok(fresh.parentElement.querySelector('[data-dyc-rg-btn]'), '新节点旁没有按钮');
  });

  /* ========== 五、取号 ========== */
  console.log('\n【五】取号：官方字段 → 名称末尾 → 无货号');
  await checkAsync('名称末尾 S280 ⇒ 复制 S280（推算档）', async () => {
    /* 第 0 张卡名称以 NAME_OK + '0' 结尾 */
    btnIn(A.doc, 0).click();
    await sleep(20);
    assert.deepEqual(A.copied, [CODE + '0'], '剪贴板内容：' + JSON.stringify(A.copied));
  });
  check('成功消息＝三段式（来源｜值｜结果）', () => {
    const t = A.toasts[A.toasts.length - 1];
    assert.equal(t.text, CODE + '0', '中段应是货号本身：' + t.text);
    assert.equal(t.type, 'success', '应是 success：' + t.type);
    assert.equal(t.opts.source, '货号复制', '来源词不对：' + t.opts.source);
    assert.equal(t.opts.count, '已复制', '结果词应在 count：' + t.opts.count);
    assert.equal(t.opts.keepHistory, false, '复制提示不该进消息盒子');
  });
  await checkAsync('名称里没有款号 ⇒ 只提示、不复制半截内容', async () => {
    const before = A.copied.length;
    btnIn(A.doc, 1).click();
    await sleep(20);
    assert.equal(A.copied.length, before, '不该写剪贴板');
    const t = A.toasts[A.toasts.length - 1];
    assert.equal(t.type, 'warning', '应是 warning：' + t.type);
    assert.match(t.text, /没找到货号/, '提示文案不对：' + t.text);
    assert.equal(btnIn(A.doc, 1).textContent, '无货号', '按钮该闪「无货号」：' + btnIn(A.doc, 1).textContent);
  });

  const C = boot({ cards: 3, officialCodes: ['', 'NE1C0813', ''] });
  await sleep(60);
  await checkAsync('平台写了「货号 NE1C0813」⇒ 用官方值，不按名称推算', async () => {
    btnIn(C.doc, 1).click();
    await sleep(20);
    assert.deepEqual(C.copied, ['NE1C0813'], '剪贴板内容：' + JSON.stringify(C.copied));
  });
  await checkAsync('自家按钮的「货号」二字不会被当成平台字段（否则会刮到旁边的值）', async () => {
    /* 第 0 张卡没有官方字段，名称末尾是 S280；若自家按钮文案进了取值，
     * 会从按钮旁边的文本里刮出别的东西 */
    btnIn(C.doc, 0).click();
    await sleep(20);
    assert.deepEqual(C.copied.slice(-1), [CODE + '0'], '取到了 ' + JSON.stringify(C.copied.slice(-1)));
  });

  /* ========== 六、认不出卡片就不做 ========== */
  console.log('\n【六】页面没有可识别的缩略图 ⇒ 一个都不处理（宁可漏，不错改）');
  const D = boot({ cards: 4, withThumb: false });
  await sleep(60);
  check('无缩略图 ⇒ 0 枚按钮、商品名一个字不动', () => {
    assert.equal(allBtns(D.doc).length, 0, '被注入了 ' + allBtns(D.doc).length + ' 枚');
    const nm = D.doc.querySelector('[data-nm="0"]');
    /* 用 style.display 读，不写 getPropertyValue('display') + 空串：
     * 断言体检把「空串期望值」当成排版依赖，读属性更直白也等价 */
    assert.equal(String(nm.style.display || ''), '', '商品名被改动了');
  });
  check('诊断里留痕（按动作名断言，不绑自己写的正文文案）', () => {
    /* 断言结构：只有一条动作轨迹就叫「退货地址商品名」，且本轮名称数为 0
     * —— 绑动作名而不是绑句子，改措辞不会误红 */
    const st = D.win.__DYC_RETURN_GOODS_NAME_API__.state();
    assert.equal(st.names, 0, '名称数应为 0：' + st.names);
    const acts = D.diagNotes.map((n) => n.action);
    assert.ok(acts.indexOf('退货地址商品名') > -1, '没有留痕：' + JSON.stringify(acts));
  });

  console.log('\n【六·二】列表容器不能被当成一张卡（卡片外的截断文字不许被拉进来）');
  check('13 张卡的共同祖先没被当成卡：按钮数等于卡片数，说明文字不处理', () => {
    /* 上面的 A 场景里 .form 同时含 13 张卡与一段截断说明，
     * 若判据爬到列表层，说明文字会被插上按钮（数量变成 14） */
    assert.equal(allBtns(A.doc).length, 13, '按钮数量 ' + allBtns(A.doc).length + ' ≠ 卡片数 13');
    const plain = A.doc.querySelector('[data-plain]');
    const sib = plain.nextElementSibling;
    assert.equal(!!(sib && sib.hasAttribute('data-dyc-rg-btn')), false, '说明文字旁被插了按钮');
  });

  /* ========== 七、关开关 ========== */
  console.log('\n【七】关开关：按钮移除、样式逐条还原');
  check('关掉后按钮清零', () => {
    D.getWatchCb()({ returnGoodsName: false });
    assert.equal(allBtns(D.doc).length, 0, '还剩 ' + allBtns(D.doc).length + ' 枚');
  });
  check('关掉后名称的 display 与 line-clamp 回到平台原值', () => {
    const nm = D.doc.querySelector('[data-nm="0"]');
    assert.equal(nm.style.getPropertyValue('display'), '', 'display 没还原：' + nm.style.display);
    assert.equal(nm.style.getPropertyValue('-webkit-line-clamp'), '', 'line-clamp 没还原');
    assert.equal(nm.hasAttribute('data-dyc-rgname'), false, '标记没摘');
  });

  /* ========== 八、作用域 ========== */
  console.log('\n【八】不在本页就不干活');
  const E = boot({ url: 'https://fxg.jinritemai.com/ffa/g/list?page=1', cards: 3 });
  await sleep(60);
  check('商品列表页（非多地址退货）⇒ 0 枚按钮、名称不动', () => {
    assert.equal(allBtns(E.doc).length, 0, '被注入了 ' + allBtns(E.doc).length + ' 枚');
    const nm = E.doc.querySelector('[data-nm="0"]');
    assert.equal(nm.style.getPropertyValue('display'), '', '名称被改动了');
  });

  /* ========== 九、源码红线 ========== */
  console.log('\n【九】源码红线');
  check('不用绝对定位写落点（left/top 会被 transform 祖先劫走）', () => {
    assert.equal(/setProperty\(\s*['"](left|top)['"]/.test(SRC), false, '出现了 left/top 定位');
    assert.equal(/position:\s*(absolute|fixed)/.test(SRC), false, '出现了绝对/固定定位');
  });
  check('按钮宽固定 56px（点完换文案不变宽）', () => {
    assert.match(SRC, /width:\s*56px/, '没写死 56px');
  });
  check('货号判据不抄回本地（必须复用 item-code.js）', () => {
    assert.equal(/function\s+dycIsCodeLike/.test(SRC), false, '自己定义了 dycIsCodeLike');
    assert.equal(/function\s+dycPickCodeFromName/.test(SRC), false, '自己定义了 dycPickCodeFromName');
    assert.match(SRC, /dycPickCodeFromName/, '没有引用共享判据');
  });
  check('按钮带 data-dyc-rg-btn 标记（取值时整棵跳过）', () => {
    assert.match(SRC, /BTN_ATTR\s*=\s*'data-dyc-rg-btn'/, '标记名变了');
  });

  /* ========== 十、清单 ========== */
  console.log('\n【十】清单：新页独立注入 + 全域条目已排除');
  check('有独立注入条目，且带上功能脚本', () => {
    const hit = MANIFEST.content_scripts.find((c) =>
      (c.matches || []).some((m) => m.indexOf('/ffa/morder/logistics/') > -1));
    assert.ok(hit, '没有找到本页的注入条目');
    assert.ok(hit.js.indexOf('src/content/return-goods-name.js') > -1, '条目里没带功能脚本');
    assert.ok(hit.js.indexOf('src/content/flags.js') > -1, '条目里没带开关层');
    assert.ok((hit.css || []).indexOf('src/content/msgbox.css') > -1, '缺公共消息样式');
  });
  check('全域轻量条目把它排除掉（否则 flags/hide-elements 注入两次）', () => {
    const light = MANIFEST.content_scripts.find((c) =>
      c.js && c.js.length === 2 && c.js[1] === 'src/live/hide-elements.js');
    assert.ok(light, '没找到全域轻量条目');
    assert.ok((light.exclude_matches || []).some((m) => m.indexOf('/ffa/morder/logistics/') > -1),
      '没写进 exclude_matches');
  });
  check('开关 append 在 DYC_FLAGS_META 表尾（最新排最下面）', () => {
    const flags = fs.readFileSync(path.join(ROOT, 'src/content/flags.js'), 'utf8');
    const start = flags.indexOf('var DYC_FLAGS_META = [');
    const end = flags.indexOf('\n];', start);
    assert.ok(start > 0 && end > start, '定位不到开关元数据表');
    const table = flags.slice(start, end);
    const lastKey = table.lastIndexOf('key: ');
    assert.equal(table.slice(lastKey, lastKey + 22), "key: 'returnGoodsName'",
      '本开关不是表尾那一条：' + table.slice(lastKey, lastKey + 24));
  });

  /* ============ 汇总 ============ */
  process.stdout.write('\n────────────────────────────────────────\n');
  if (failures.length) {
    process.stdout.write('失败 ' + fail + ' 条，通过 ' + pass + ' 条：\n');
    for (const f of failures) process.stdout.write('  ✗ ' + f + '\n');
    process.exit(1);
  }
  process.stdout.write('全部通过：' + pass + ' 条断言\n');
})();
