/**
 * 小红书 · 循环讲解（2026-11-18 建）
 * ============================================================
 * 被测文件：src/live/xhs-auto-loop.js、src/content/flags.js（xhsLoop）、
 *           manifest.json（注入顺序）
 *
 * 覆盖：
 *   A. 落点 —— 搜索框上方左对齐；滚动跟随；被抹掉后补回
 *   B. 在讲判定 —— 只认「结束讲解」；卡内与下方讲解区两种形态都能定位到那张卡
 *   C. 15 秒硬闸 —— 14.9 秒仍不可弹、满 15 秒才放行；冷却中一个点击都不发
 *   D. 弹卡动作 —— 只点目标商品的「弹卡」，不点「结束讲解」；播报三段式
 *   E. 平台限频兜底 —— 命中「操作太频繁」后冷却重置
 *   F. 开关与清单 —— xhsLoop 归 xhsLive、作用页 xhsCtrl、manifest 顺序
 *   G. 设置 —— 秒/分钟滑条、随机间隔、无限模式、后台拍点与设置恢复
 *
 * 用法：node scripts/自测-小红书循环讲解.js  （退出码 0 = 全绿）
 * ============================================================
 */
'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert/strict');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const LOOP = read('src/live/xhs-auto-loop.js');
const LOCATE = read('src/live/xhs-locate.js');
const MANIFEST = JSON.parse(read('manifest.json'));
const FLAGS_CODE = read('src/content/flags.js');

const CTRL_URL = 'https://pgy.xiaohongshu.com/commerce/redlive/live_center_control';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let pass = 0;
async function check(name, fn) {
  try { await fn(); pass++; console.log('  ✓ ' + name); }
  catch (e) { console.log('  ✗ ' + name + '\n     ' + (e && e.message)); process.exitCode = 1; throw e; }
}

/* ---------- 版面 ---------- */

function rect(el, x, y, w, h) {
  el.getBoundingClientRect = () => ({
    left: x, top: y, right: x + w, bottom: y + h, width: w, height: h, x, y
  });
  return el;
}

/**
 * 页面模型（2026-11-18 真机结构报告 + 诊断轨迹实测形态）：
 *   - 工具栏一行：搜索框 + 序号定位控件（可能缺席）
 *   - 讲解中的卡片动作行：下架 / 置顶 / **弹卡** / 结束讲解
 *   - 未讲解的卡片动作行：下架 / 置顶 / 讲解
 *   - 下方讲解区：讲解中的商品名 + 「结束讲解」
 */
function pageHtml(o) {
  const cards = (o.cards || ['商品甲', '商品乙']).map((name, i) => {
    const isLec = i === 0 && !!o.lecturing && !o.listIdle;
    const btns = '<button class="goods-card__action-btn" data-role="off">下架</button>'
      + '<button class="goods-card__action-btn" data-role="top">置顶</button>'
      + (isLec
        /* 「弹卡」是平台自己的按钮名（真机 52×28）。stop 只在 'card' 形态下留在卡内，
         * 'detail' / 'detailCard' 形态的停讲证据在下方讲解区。 */
        ? '<button class="goods-card__action-btn" data-role="pop">' + (o.popText || '弹卡') + '</button>'
          + (o.lecturing === 'card'
            ? '<button class="goods-card__action-btn goods-card__action-btn--secondary" data-role="stop">结束讲解</button>'
            : '')
        : '<button class="goods-card__action-btn goods-card__action-btn--secondary" data-role="start">讲解</button>');
    return '<div class="goods-card" data-i="' + i + '">'
      + '<div class="goods-card__title-block">'
      + '<span class="d-text --color-static --color-text-title">' + name + '</span></div>'
      + '<div class="goods-card__action-row">' + btns + '</div></div>';
  }).join('');

  const isDetail = o.lecturing === 'detail' || o.lecturing === 'detailCard';
  const detailName = o.detailName || (o.cards || ['商品甲'])[0];
  const detail = isDetail
    ? '<div class="living-detail-container"><span>正在讲解</span>'
      + '<span>' + detailName + '</span>'
      /* detailCard：讲解区里的"讲解卡"复用 .goods-card 类（真机 2026-11-18 的坑）。
       * 这时 stop.closest('.goods-card') 会先命中它，而它只有「结束讲解」。 */
      + (o.lecturing === 'detailCard'
        ? '<div class="goods-card" id="detailcard"><div class="goods-card__action-row">'
          + '<button class="goods-card__action-btn" data-role="stop">结束讲解</button>'
          + '</div></div>'
        : '<button data-role="stop">结束讲解</button>')
      + '</div>'
    : '';

  return '<!doctype html><body><div class="control-container">'
    + (o.offAir ? '<header id="live-state"><span>未开播</span>' + (o.offAir === 'label' ? '' : '<button>立即开播</button>') + '</header>' : '')
    + '<div id="row">'
    + (o.noAnchor ? '' : '<div id="dyc-xhs-locate"></div>')
    + '<div class="d-input-wrapper" id="search-box"><input id="q" placeholder="请输入商品名称、序号或ID"></div>'
    + '</div>'
    + '<div class="goods-card-list">' + cards + '</div>'
    + detail
    + '</div></body>';
}

function makeDom(o) {
  o = o || {};
  const dom = new JSDOM(pageHtml(o), { url: CTRL_URL, pretendToBeVisual: true, runScripts: 'outside-only' });
  const win = dom.window;
  const doc = win.document;
  if (o.clock) win.Date.now = () => o.clock.now;
  Object.entries(o.session || {}).forEach(([k, v]) => win.sessionStorage.setItem(k, v));

  win.DYC_PAGE_PATTERNS = { xhsCtrl: /^https:\/\/pgy\.xiaohongshu\.com\/commerce\/redlive\// };
  win.__status = [];
  win.setStatus = (m, t, opt) => { win.__status.push({ m, t, o: opt || {} }); };
  win.__flags = Object.assign({ xhsLoop: true, xhsLocate: false }, o.flags || {});
  win.dycReadFlags = () => Promise.resolve(win.__flags);
  win.dycWatchFlags = (cb) => { win.__watch = cb; };

  /* storage mock：多数用例默认把「自动」关掉，免得每秒的拍子自己弹卡干扰单测；
   * 传 store:{} 表示"从来没存过设置"，用来验默认值。 */
  const store = o.store === undefined ? { dybXhsLoopAuto: false } : o.store;
  win.__store = store;
  win.__runtimeMessages = [];
  win.chrome = {
    runtime: {
      onMessage: { addListener(fn) { win.__beatListener = fn; } },
      sendMessage(msg, cb) { win.__runtimeMessages.push(msg); if (cb) cb({ok: true, mode: 'offscreen'}); }
    },
    storage: {
      local: {
        get(keys, cb) {
          const out = {};
          (Array.isArray(keys) ? keys : [keys]).forEach((k) => { if (k in store) out[k] = store[k]; });
          setTimeout(() => cb(out), 0);
        },
        set(obj) { Object.assign(store, obj); }
      }
    }
  };

  /* 点击计数：分开统计「讲解」与「结束讲解」—— 点错哪一个都会现形 */
  win.__clicks = { start: 0, stop: 0, pop: 0 };
  doc.querySelectorAll('[data-role]').forEach((b) => {
    b.addEventListener('click', () => {
      win.__clicks[b.getAttribute('data-role')] = (win.__clicks[b.getAttribute('data-role')] || 0) + 1;
      if (b.getAttribute('data-role') === 'pop' && !o.noFeedback) b.textContent = '弹卡（15秒）';
    });
  });

  /* 几何：工具栏 y=18/30 高；卡片 195 高；讲解区在页面下方 */
  doc.querySelectorAll('#live-state,#live-state *').forEach(el => rect(el, 10, 10, 150, 30));
  const row = doc.getElementById('row');
  if (row) rect(row, 0, 18, 1400, 30);
  const q = doc.getElementById('q');
  if (q) rect(q, 224, 100, 276, 30);
  if (o.textAnchor) {
    q.removeAttribute('placeholder');
    const label = doc.createElement('span');
    label.textContent = '请输入商品名称、序号或ID';
    q.parentElement.prepend(rect(label, 224, 109, 150, 15));
  }
  rect(doc.getElementById('search-box'), 200, 100, 300, 30);
  const anchor = doc.getElementById('dyc-xhs-locate');
  if (anchor) rect(anchor, 942, 18, 218, 30);

  doc.querySelectorAll('.goods-card-list .goods-card').forEach((c, i) => {
    rect(c, 0, 120 + i * 195, 1080, 195);
    c.querySelectorAll('[class*="goods-card__action-btn"]').forEach((b, j) => {
      rect(b, 1280 + j * 60, 150 + i * 195, 52, 28);
    });
  });
  /* 讲解区整体给几何；它内部的元素先统一铺一遍，再让 detailcard 覆盖（顺序要紧） */
  const detail = doc.querySelector('.living-detail-container');
  if (detail) {
    rect(detail, 0, 600, 600, 200);
    detail.querySelectorAll('*').forEach((n, i) => rect(n, 20 + i * 80, 620, 70, 24));
  }
  const detailCard = doc.getElementById('detailcard');
  if (detailCard) {
    rect(detailCard, 20, 660, 320, 140);
    detailCard.querySelectorAll('[class*="goods-card__action-btn"]').forEach((b, j) => {
      rect(b, 40 + j * 60, 700, 52, 28);
    });
  }

  /* 我们自己的控件没有显式几何 —— 给它一个，paint/visible 才判得动 */
  const baseRect = win.Element.prototype.getBoundingClientRect;
  win.Element.prototype.getBoundingClientRect = function () {
    if (this.id === 'dyc-xhs-loop') return { left: 1170, top: 18, right: 1300, bottom: 48, width: 130, height: 30, x: 1170, y: 18 };
    return baseRect.call(this);
  };

  return { dom, win, doc };
}

async function boot(o) {
  const env = makeDom(o);
  env.win.eval(LOCATE);
  env.win.eval(LOOP);
  await sleep(30);
  return env;
}

const api = (win) => win.__DYC_XHS_LOOP__;

/* ============================================================
 * A. 落点
 * ============================================================ */
async function testPlacement() {
  console.log('\nA. 落点');

  await check('A1 页面用文案模拟占位时，仍挂在搜索框外壳上方并左对齐', async () => {
    const { win, doc } = await boot({ textAnchor: true, noAnchor: true });
    try {
      const box = doc.getElementById('dyc-xhs-loop');
      assert.ok(box,'文本占位搜索框未挂出循环控件');
      const search = doc.getElementById('search-box').getBoundingClientRect();
      assert.equal(parseFloat(box.style.left),search.left);
      assert.ok(parseFloat(box.style.top) + box.offsetHeight < search.top);
      assert.equal(box.style.visibility,'visible');
    } finally { win.close(); }
  });

  await check('A2 没有序号定位时也跟随搜索框滚动', async () => {
    const { win, doc } = await boot({ noAnchor: true });
    try {
      const box = doc.getElementById('dyc-xhs-loop');
      const search = doc.getElementById('search-box');
      const oldTop = parseFloat(box.style.top);
      rect(search, 180, 120, 300, 30);
      search.dispatchEvent(new win.Event('scroll'));
      await sleep(60);
      assert.equal(parseFloat(box.style.left),180);
      assert.equal(parseFloat(box.style.top),oldTop + 20);
    } finally { win.close(); }
  });

  await check('A4 组合控件提供展开设置与启停，保留没有手动弹卡的要求', async () => {
    const { win, doc } = await boot({ lecturing: 'card' });
    const box = doc.getElementById('dyc-xhs-loop');
    assert.ok(box, '控件没挂上');
    assert.equal(doc.getElementById('dyc-xhs-loop-pop'), null, '手动【弹卡】按钮还在 —— 用户 2026-11-18 要求去掉');
    /* 面板里的档位/开关不算：只看控件的直接子按钮 */
    const direct = Array.from(box.children).filter((n) => n.tagName === 'BUTTON');
    assert.equal(direct.length, 2, '组合控件提供设置和启停');
    assert.ok(direct[1].classList.contains('power'));
    assert.equal(direct[0].id, 'dyc-xhs-loop-main');
    assert.match(direct[0].textContent, /循环讲解/);
    win.close();
  });

  await check('A3 被平台重渲染抹掉后，1 秒内补回原位', async () => {
    const { win, doc } = await boot({});
    const box = doc.getElementById('dyc-xhs-loop');
    box.parentNode.removeChild(box);
    await sleep(1200);
    const again = doc.getElementById('dyc-xhs-loop');
    assert.ok(again, '抹掉后没有补回');
    assert.equal(again.style.left, box.style.left, '补回的位置不对');
    win.close();
  });
}

/* ============================================================
 * B. 在讲判定
 * ============================================================ */
async function testLectureDetect() {
  console.log('\nB. 在讲判定');

  await check('B1 没有「结束讲解」⇒ 不在讲', async () => {
    const { win } = await boot({ lecturing: null });
    assert.equal(api(win).inLecture(), false);
    win.close();
  });

  await check('B2 下方讲解区的「结束讲解」⇒ 在讲，且按商品名找回那张卡', async () => {
    const { win } = await boot({ lecturing: 'detail', cards: ['商品甲', '商品乙'] });
    assert.equal(api(win).inLecture(), true);
    const card = api(win).currentCard();
    assert.ok(card, '没定位到在讲的那张卡');
    assert.equal(card.getAttribute('data-i'), '0', '应命中标题与讲解区一致的第一张卡');
    win.close();
  });

  await check('B3 卡内直接出现「结束讲解」⇒ 在讲，且就是那张卡', async () => {
    const { win } = await boot({ lecturing: 'card', cards: ['商品甲', '商品乙'] });
    assert.equal(api(win).inLecture(), true);
    const card = api(win).currentCard();
    assert.ok(card);
    assert.equal(card.getAttribute('data-i'), '0');
    win.close();
  });


  await check('B5 按钮文案分态：「弹卡」归 pop、「讲解」归 start、「结束讲解」归 stop', async () => {
    const { win } = await boot({ lecturing: null });
    const k = api(win).kindOfText;
    assert.equal(k('弹卡'), 'pop');
    assert.equal(k('弹出讲解卡'), 'pop', '变体必须归 pop，不能掉进 start');
    assert.equal(k('讲解'), 'start');
    assert.equal(k('结束讲解'), 'stop');
    assert.equal(k('YIHOUSE 进口羊驼毛羊毛衫'), '', '长文本是商品名，不是按钮态');
    win.close();
  });

  await check('B4 讲解区里的"讲解卡"也带 .goods-card ⇒ 仍认列表里那张（真机 2026-11-18）', async () => {
    const { win, doc } = await boot({ lecturing: 'detailCard', cards: ['春季新款连衣裙', '夏季短袖'] });
    assert.equal(api(win).inLecture(), true);
    const card = api(win).currentCard();
    assert.ok(card, '没定位到在讲的卡');
    assert.equal(card.id, '', '认到了讲解区那张卡 —— 它只有「结束讲解」，永远找不到「讲解」');
    assert.equal(card.getAttribute('data-i'), '0');
    win.close();
  });
}

/* ============================================================
 * C. 15 秒硬闸
 * ============================================================ */
async function testCooldown() {
  console.log('\nC. 15 秒硬闸');

  await check('C1 从未弹过 ⇒ 不冷却', async () => {
    const { win } = await boot({ lecturing: 'detail' });
    assert.equal(api(win).coolLeft(), 0);
    win.close();
  });

  await check('C2 弹一次后立刻再弹 ⇒ 判冷却，且一个点击都不发', async () => {
    const { win } = await boot({ lecturing: 'detail' });
    const a = api(win);
    assert.equal(a.popOnce('手动'), 'pending');
    assert.equal(win.__clicks.pop, 1, '第一次应点一次「弹卡」');
    assert.equal(a.popOnce('手动'), 'cooling');
    assert.equal(win.__clicks.pop, 1, '冷却中又发了点击 —— 这正是会报错的写法');
    win.close();
  });

  await check('C3 14.9 秒仍不可弹（硬下限是 15 秒，不是"差不多"）', async () => {
    const { win } = await boot({ lecturing: 'detail' });
    const a = api(win);
    a._setPopAt(Date.now() - 14900);
    assert.ok(a.coolLeft() > 0, '14.9 秒就放行了');
    assert.equal(a.popOnce('手动'), 'cooling');
    assert.equal(win.__clicks.pop, 0);
    win.close();
  });

  await check('C4 满 15 秒后放行，点击落在「弹卡」上而不是「结束讲解」', async () => {
    const { win } = await boot({ lecturing: 'card' });
    const a = api(win);
    a._setPopAt(Date.now() - (a.POP_MIN_MS + 100));
    assert.equal(a.coolLeft(), 0);
    assert.equal(a.popOnce('手动'), 'pending');
    assert.equal(win.__clicks.pop, 1, '必须点「弹卡」（真机 52×28 那枚）');
    assert.equal(win.__clicks.stop, 0, '点到了「结束讲解」—— 这会把用户的讲解结束掉');
    win.close();
  });

  await check('C5 播报是三段式：来源词 循环讲解', async () => {
    const { win } = await boot({ lecturing: 'detail' });
    api(win).popOnce('手动');
    await sleep(1500);
    const s = win.__status[win.__status.length - 1];
    assert.ok(s, '没播报');
    assert.equal(s.o.source, '循环讲解');
    assert.equal(s.t, 'success');
    assert.match(s.o.count, /第 1 次/);
    win.close();
  });

  await check('C6 讲解区也带 .goods-card 时，弹的是列表那张卡、绝不碰「结束讲解」', async () => {
    const { win } = await boot({ lecturing: 'detailCard', cards: ['春季新款连衣裙'] });
    assert.equal(api(win).popOnce('手动'), 'pending', '返回 no-btn = 又把讲解区那张卡当成目标了');
    assert.equal(win.__clicks.pop, 1);
    assert.equal(win.__clicks.stop, 0, '点到了讲解区的「结束讲解」');
    win.close();
  });


  await check('C7 平台冷却文案一律不点击，即使本地没有冷却记录', async () => {
    for (const text of ['弹卡中', '弹卡（12秒）', '弹卡(8s)']) {
      const { win } = await boot({ lecturing: 'card', popText: text });
      try { api(win).popOnce('自动'); assert.equal(win.__clicks.pop, 0, text); }
      finally { win.close(); }
    }
  });

  await check('C8 换品重新计时，保留平台冷却，不立即弹新品', async () => {
    const { win, doc } = await boot({ lecturing: 'card', store: { dybXhsLoopAuto: true } });
    try {
      const a = api(win);
      a._tick(); a._due(); a._tick();
      await sleep(1500);
      assert.equal(a._state().rounds, 1);
      const old = a._state().lastPopAt;
      doc.querySelector('.--color-text-title').textContent = '夏季新款真丝衬衫';
      a._tick();
      assert.equal(a._state().lastPopAt, old);
      assert.equal(a._state().rounds, 1);
      assert.ok(a._state().nextAt > Date.now() + 29000);
    } finally { win.close(); }
  });

}

/* ============================================================
 * D. 不在讲时不动作
 * ============================================================ */
async function testNoLecture() {
  console.log('\nD. 不在讲时不动作');

  await check('D1 没有商品在讲 ⇒ 返回 no-live，零点击', async () => {
    const { win } = await boot({ lecturing: null });
    assert.equal(api(win).popOnce('手动'), 'no-live');
    assert.equal(win.__clicks.pop, 0);
    assert.equal(win.__clicks.stop, 0);
    win.close();
  });

  await check('D2 在讲但列表里一枚「弹卡」都没有 ⇒ 不瞎点', async () => {
    /* 讲解区有「结束讲解」，可列表里所有卡都还是「讲解」形态
     * （平台还没把在讲那张卡渲染出来）。这时**不能**随手点一枚「讲解」——
     * 那等于替用户开讲别的商品。 */
    const { win } = await boot({
      lecturing: 'detail', listIdle: true,
      cards: ['完全不同的商品名'], detailName: '另一个品'
    });
    const r = api(win).popOnce('手动');
    assert.equal(r, 'no-btn', '没有弹卡按钮时不该下手，实际返回 ' + r);
    assert.equal(win.__clicks.pop, 0);
    assert.equal(win.__clicks.start, 0, '点到了别的卡的「讲解」—— 会替用户开讲另一个品');
    win.close();
  });

  await check('D3 认不出讲解商品时，绝不按全页弹卡按钮猜', async () => {
    const { win } = await boot({ lecturing: 'detail', cards: ['春季新款连衣裙'], detailName: '完全不同的另一个品' });
    try { assert.equal(api(win).popOnce('自动'), 'no-btn'); assert.equal(win.__clicks.pop, 0); }
    finally { win.close(); }
  });

}

/* ============================================================
 * E. 平台限频兜底
 * ============================================================ */
async function testRateLimit() {
  console.log('\nE. 平台限频兜底');

  await check('E1 出现「操作太频繁」⇒ 冷却从此刻重算', async () => {
    const { win, doc } = await boot({ lecturing: 'detail' });
    const a = api(win);
    a._setPopAt(Date.now() - 1000);        // 刚点过 1 秒 ⇒ 在扫 toast 的时间窗内
    assert.ok(a.coolLeft() > 0);

    const toast = doc.createElement('div');
    toast.className = 'd-new-toast';
    toast.textContent = '操作太频繁，请稍后再试';
    rect(toast, 700, 300, 240, 38);
    doc.body.appendChild(toast);

    await sleep(1200);            // 等一拍
    assert.ok(a.coolLeft() > 0, '平台已经报错了，冷却却没重置');
    win.close();
  });

  await check('E2 常驻「稍后发货」这类文案不再被当成限频（2026-11-18 只弹一次的元凶）', async () => {
    /* 旧正则里「稍后」单独就算命中，页面上一旦有常驻元素带这两个字，
     * 冷却每拍都被重置成"现在"，于是只弹了第一次就再也不动。 */
    const { win, doc } = await boot({ lecturing: 'detail', cards: ['春季新款连衣裙'] });
    const a = api(win);
    a._setPopAt(Date.now() - 9000);        // 已过 9 秒 ⇒ 未重置时只剩约 6.5 秒
    const box = doc.createElement('div');
    box.className = 'd-message';
    box.textContent = '稍后发货的商品请留意';
    rect(box, 700, 300, 240, 38);
    doc.body.appendChild(box);

    await sleep(1200);                     // 过一拍
    assert.ok(a.coolLeft() < 10000,
      '冷却被重置了（' + Math.round(a.coolLeft() / 1000) + ' 秒）—— 普通文案又被当成限频');
    win.close();
  });

  await check('E3 真正限频的 toast 仍要重置冷却（不能因为收紧就漏判）', async () => {
    const { win, doc } = await boot({ lecturing: 'detail', cards: ['春季新款连衣裙'] });
    const a = api(win);
    a._setPopAt(Date.now() - 1000);        // 刚点过 1 秒 ⇒ 在 12 秒窗口内
    const toast = doc.createElement('div');
    toast.className = 'd-new-toast';
    toast.textContent = '操作太频繁，请稍后再试';
    rect(toast, 700, 300, 240, 38);
    doc.body.appendChild(toast);

    await sleep(1200);
    assert.ok(a.coolLeft() > 14000, '真的限频却没过冷却，会继续撞平台');
    win.close();
  });

  await check('E4 过了 12 秒时间窗就不再扫 toast（常驻元素无从误伤）', async () => {
    const { win, doc } = await boot({ lecturing: 'detail', cards: ['春季新款连衣裙'] });
    const a = api(win);
    a._setPopAt(Date.now() - 30000);       // 30 秒前弹过，早已出窗
    const toast = doc.createElement('div');
    toast.className = 'd-new-toast';
    toast.textContent = '操作太频繁，请稍后再试';
    rect(toast, 700, 300, 240, 38);
    doc.body.appendChild(toast);

    await sleep(1200);
    assert.equal(a.coolLeft(), 0, '出窗后仍在扫 toast，冷却会被陈年提示反复重置');
    win.close();
  });
  await check('H1 两个中控台标签页：这边弹卡，那边不跟着进冷却', async () => {
    /* 2026-11-18 用户：「同一浏览器开两个或多个平台的中控台，不要串起来，各干各的」。
     * chrome.storage.local 是整扩展共享的，冷却存那里就会串；
     * 现在存 sessionStorage，按标签页隔离。
     * 这里用同一个 store 对象模拟"同一份全局 storage"，两个 jsdom 各自独立 sessionStorage。 */
    const shared = { dybXhsLoopAuto: false };
    const A = await boot({ lecturing: 'card', cards: ['春季新款连衣裙'], store: shared });
    const B = await boot({ lecturing: 'card', cards: ['夏季新款真丝衬衫'], store: shared });

    assert.equal(api(A.win).popOnce('自动'), 'pending');
    assert.ok(api(A.win).coolLeft() > 0, 'A 自己没有冷却？');
    assert.equal(api(B.win).coolLeft(), 0, '冷却串到另一个标签页了');
    A.win.close();
    B.win.close();
  });

  await check('H2 冷却绝不写进全局 storage（红线，防回潮）', async () => {
    const seg = LOOP.slice(LOOP.indexOf('function markPop'), LOOP.indexOf('function markPop') + 400);
    assert.equal(/storage\.local/.test(seg), false, 'markPop 又去写全局 storage 了 —— 多标签页会互相压冷却');
  });
}


/* ============================================================
 * F. 开关与清单
 * ============================================================ */
async function testListing() {
  console.log('\nF. 开关与清单');

  await check('F1 xhsLoop 归 xhsLive、默认开、作用页 xhsCtrl', () => {
    assert.match(FLAGS_CODE, /key:\s*'xhsLoop'/, 'flags.js 没有 xhsLoop');
    const seg = FLAGS_CODE.slice(FLAGS_CODE.indexOf("key: 'xhsLoop'") - 200, FLAGS_CODE.indexOf("key: 'xhsLoop'") + 500);
    assert.match(seg, /group:\s*'xhsLive'/);
    assert.match(seg, /pages:\s*\['xhsCtrl'\]/);
    assert.match(seg, /default:\s*true/);
  });

  await check('F2 manifest：脚本注在小红书那段、且排在 xhs-locate 之后', () => {
    const block = MANIFEST.content_scripts.find((c) => (c.matches || []).includes('https://pgy.xiaohongshu.com/*'));
    assert.ok(block, '找不到小红书那段 content_scripts');
    const js = block.js;
    const i = js.indexOf('src/live/xhs-auto-loop.js');
    const j = js.indexOf('src/live/xhs-locate.js');
    assert.ok(i >= 0, 'manifest 没注入 xhs-auto-loop.js');
    assert.ok(j >= 0 && i > j, '必须排在 xhs-locate 之后（后者提供落点基准）');
  });
}

/* ============================================================
 * G. 设置
 * ============================================================ */
async function testSettings() {
  console.log('\nG. 设置');

  await check('G1 四档生效并持久化', async () => {
    const { win } = await boot({ lecturing: null });
    api(win)._setTier(45);
    assert.equal(api(win)._state().tier, 45);
    assert.equal(win.__store.dybXhsLoopTier, 45);
    win.close();
  });

  await check('G2 非法档位（10 秒）被忽略，不会把下限降下去', async () => {
    const { win } = await boot({ lecturing: null });
    api(win)._setTier(10);
    assert.equal(api(win)._state().tier, 30, '10 秒被接受了 —— 下限就被绕开了');
    win.close();
  });

  await check('G3 没存过设置时默认自动开启（装完即可用）', async () => {
    const { win } = await boot({ lecturing: null, store: {} });
    assert.equal(api(win)._state().autoOn, true);
    win.close();
  });

  await check('G4 存过关闭就严格按关闭恢复', async () => {
    const { win } = await boot({ lecturing: null, store: { dybXhsLoopAuto: false } });
    assert.equal(api(win)._state().autoOn, false);
    win.close();
  });
}

/* ============================================================ */

async function testAdaptedLoop() {
  console.log('\nI. 小红书完整循环适配');
  const clockFor = () => ({now: Date.now()});
  const confirm = (a, clock) => { clock.now += 1500; a._checkPending(); };
  await check('I1 非讲解商品也有弹卡按钮，只能点击带结束讲解的目标', async () => {
    const { win, doc } = await boot({lecturing: 'card'});
    try {
      const other = doc.querySelectorAll('.goods-card')[1].querySelector('[data-role="start"]');
      other.textContent = '弹卡';
      api(win).popOnce('自动');
      assert.equal(win.__clicks.pop, 1); assert.equal(win.__clicks.start, 0); assert.equal(win.__clicks.stop, 0);
    } finally { win.close(); }
  });
  await check('I2 点击后只有同一商品进入平台冷却才计数，而且只计一次', async () => {
    const clock = clockFor(); const {win} = await boot({lecturing:'card',clock});
    try { const a=api(win); a.popOnce('自动'); assert.equal(a._state().rounds,0);
      confirm(a,clock); a._checkPending(); assert.equal(a._state().rounds,1); assert.equal(a._state().busy,false);
    } finally {win.close();}
  });
  await check('I3 观察期间平台拒绝，即使按钮变冷却也不计数', async () => {
    const clock=clockFor(); const {win,doc}=await boot({lecturing:'card',clock});
    try { const a=api(win); a.popOnce('自动'); const toast=doc.createElement('div');
      toast.className='d-new-toast'; toast.textContent='操作太频繁，请稍后再试'; rect(toast,0,0,200,30); doc.body.appendChild(toast);
      confirm(a,clock); assert.equal(a._state().rounds,0); assert.equal(a._state().busy,false);
      const at=a._state().lastPopAt; clock.now+=1000; a._tick(); assert.equal(a._state().lastPopAt,at,'同一条旧提示不能反复续冷却');
    } finally {win.close();}
  });
  await check('I4 秒档严格等待设定值加随机 0～3 秒，45 秒不会按15秒循环', async () => {
    const clock=clockFor(); const {win}=await boot({lecturing:'card',clock,store:{dybXhsLoopAuto:true,dybXhsLoopTier:45}});
    try { const a=api(win); win.Math.random=()=>0; a._tick();
      assert.equal(a._state().nextAt-clock.now,45000); clock.now+=44999; a._tick(); assert.equal(win.__clicks.pop,0);
      clock.now+=1; a._tick(); assert.equal(win.__clicks.pop,1);
      for (let j=0;j<4;j++) { win.Math.random=()=> (j+0.1)/4; assert.equal(a._intervalMs(),(45+j)*1000); }
    } finally {win.close();}
  });
  await check('I5 分钟档 1～15 分钟、半分钟步进，独立保存且无秒档随机偏移', async () => {
    const {win,doc}=await boot({lecturing:'card'});
    try { const a=api(win); a._setMode('min'); const input=doc.querySelector('.interval');
      input.value='2.5'; input.dispatchEvent(new win.Event('input',{bubbles:true}));
      assert.equal(a._intervalMs(),150000); assert.equal(a._state().minutes,2.5); assert.equal(win.__store.dybXhsLoopMinutes,2.5);
      assert.equal(input.min,'1'); assert.equal(input.max,'15'); assert.equal(input.step,'0.5');
    } finally {win.close();}
  });
  await check('I6 后台拍点驱动到期执行，重复拍点不重复点击，关闭注销', async () => {
    const clock=clockFor(); const {win}=await boot({lecturing:'card',clock,store:{dybXhsLoopAuto:true}});
    try { const a=api(win); assert.ok(win.__runtimeMessages.some(m=>m.type==='dyc:beatEnsure'));
      a._tick(); a._due(); clock.now+=300; win.__beatListener({type:'dyc:beat'}); win.__beatListener({type:'dyc:beat'});
      assert.equal(win.__clicks.pop,1); a._setAuto(false); assert.equal(a._state().busy,false);
      assert.equal(win.__runtimeMessages.at(-1).type,'dyc:beatOff'); confirm(a,clock); assert.equal(a._state().rounds,0);
    } finally {win.close();}
  });
  await check('I7 普通模式六次无反馈后停止，无限模式持续等候且都不虚增次数', async () => {
    for(const infinite of [false,true]) {
      const clock=clockFor(); const {win}=await boot({lecturing:'card',clock,noFeedback:true,store:{dybXhsLoopAuto:true,dybXhsLoopInfinite:infinite}});
      try {const a=api(win); for(let n=0;n<6;n++){ a._setPopAt(0); a.popOnce('自动'); confirm(a,clock); }
        assert.equal(a._state().rounds,0); assert.equal(a._state().autoOn,infinite); assert.equal(a._state().busy,false);
      } finally {win.close();}
    }
  });
  await check('I8 同名前缀不得猜卡，讲解区与两张同名卡匹配也不点击', async () => {
    const {win}=await boot({lecturing:'detail',cards:['同名春季新品上衣','同名春季新品上衣']});
    try { assert.equal(api(win).currentCard(),null); api(win).popOnce('自动'); assert.equal(win.__clicks.pop,0); }
    finally {win.close();}
  });
  await check('I9 刷新恢复本页关闭状态与半分钟设置，不被别的页默认值覆盖', async () => {
    const {win}=await boot({session:{dybXhsLoopAuto:'false',dybXhsLoopMode:'min',dybXhsLoopMinutes:'2.5',dybXhsLoopInfinite:'false'},store:{dybXhsLoopAuto:true}});
    try {const s=api(win)._state();assert.equal(s.autoOn,false);assert.equal(s.minutes,2.5);assert.equal(s.infinite,false);} finally {win.close();}
  });
  await check('I10 忽略旧拖动位置，切换档位同步更新选中状态', async () => {
    const {win,doc}=await boot({session:{dybXhsLoopPosition:'{"x":42,"y":42}'}});
    try {
      const box = doc.querySelector('#dyc-xhs-loop');
      const main = doc.querySelector('#dyc-xhs-loop-main');
      const sec = box.querySelector('[data-mode="sec"]');
      const min = box.querySelector('[data-mode="min"]');
      api(win)._setAuto(true);
      assert.equal(main.getAttribute('aria-expanded'),'false');
      assert.equal(box.style.left,'200px');
      assert.equal(box.style.position,'');
      main.click();
      assert.equal(sec.getAttribute('aria-pressed'),'true');
      min.click();
      assert.equal(min.getAttribute('aria-pressed'),'true');
      assert.equal(sec.getAttribute('aria-pressed'),'false');
      assert.notEqual(min.querySelector('.mode-state').textContent,sec.querySelector('.mode-state').textContent);
      sec.click();
      assert.equal(sec.getAttribute('aria-pressed'),'true');
      assert.equal(min.getAttribute('aria-pressed'),'false');
    } finally {win.close();}
  });
}

async function testOfflineAndPanel() {
  await check('J1 未开播按钮也能暂停；开播移除后重新计时并接回后台拍点', async () => {
    const clock={now:Date.now()}; const {win,doc}=await boot({offAir:true,lecturing:'card',clock,store:{dybXhsLoopAuto:true}});
    try {
      const a=api(win); assert.equal(a._state().offAir,true);
      assert.match(doc.querySelector('.clock').textContent,/未开播/);
      doc.querySelector('#live-state span').remove(); a._tick(); assert.equal(a._state().offAir,true,'立即开播按钮仍表示未开播');
      doc.querySelector('#live-state').remove(); a._tick();
      assert.equal(a._state().offAir,false); assert.ok(a._state().nextAt>=clock.now+30000); assert.equal(win.__clicks.pop,0);
      assert.ok(win.__runtimeMessages.some(m=>m.type==='dyc:beatEnsure'));
    } finally {win.close();}
  });
  await check('J2 观察窗内下播，取消待确认动作、不增加次数并注销拍点', async () => {
    const clock={now:Date.now()}; const {win,doc}=await boot({lecturing:'card',clock,store:{dybXhsLoopAuto:true}});
    try {
      const a=api(win); a.popOnce('自动');
      const state=doc.createElement('span'); state.textContent='未开播'; rect(state,0,0,100,30);doc.querySelector('.control-container').prepend(state);
      clock.now+=1500; a._checkPending();
      assert.equal(a._state().rounds,0);assert.equal(a._state().busy,false);assert.equal(a._state().nextAt,0);
      assert.equal(win.__runtimeMessages.at(-1).type,'dyc:beatOff');
    } finally {win.close();}
  });
  await check('J3 商品名、隐藏提示和扩展内的未开播文案不影响开播判断', async () => {
    const {win,doc}=await boot({lecturing:'card',cards:['未开播'],store:{dybXhsLoopAuto:true}});
    try { const hidden=doc.createElement('span');hidden.textContent='未开播';doc.querySelector('.control-container').prepend(hidden);
      api(win)._tick(); assert.equal(api(win)._state().offAir,false); assert.equal(api(win).popOnce('自动'),'pending');
    } finally {win.close();}
  });
  await check('J4 框内操作不收起，框外点击自动收起，Esc可收起', async () => {
    const {win,doc}=await boot({});
    try {
      const main=doc.querySelector('#dyc-xhs-loop-main'),panel=doc.querySelector('#dyc-xhs-loop-panel');
      main.click(); assert.equal(main.getAttribute('aria-expanded'),'true');
      panel.querySelector('[data-tier="45"]').click(); assert.equal(api(win)._state().tier,45); assert.ok(panel.classList.contains('open'));
      panel.querySelector('.infinite').click();assert.ok(panel.classList.contains('open'));
      doc.querySelector('#q').click(); assert.equal(main.getAttribute('aria-expanded'),'false'); assert.equal(panel.inert,true);
      main.click(); doc.dispatchEvent(new win.KeyboardEvent('keydown',{key:'Escape',bubbles:true})); assert.equal(main.getAttribute('aria-expanded'),'false');
    } finally {win.close();}
  });
  await check('J5 胶囊启停不自动展开，秒档保持15秒下限与随机间隔', async () => {
    const {win,doc}=await boot({});
    try {const main=doc.querySelector('#dyc-xhs-loop-main');doc.querySelector('.power').click();
      assert.equal(api(win)._state().autoOn,true); assert.equal(main.getAttribute('aria-expanded'),'false');
      const input=doc.querySelector('.sec-interval');assert.equal(input.min,'15');input.value='17';input.dispatchEvent(new win.Event('input',{bubbles:true}));
      assert.equal(api(win)._state().tier,17);assert.ok(api(win)._intervalMs()>=17000 && api(win)._intervalMs()<=20000);
    } finally {win.close();}
  });
}

(async function main() {
  console.log('小红书 · 循环讲解 自测');
  await check('回归：未开播时不点击、不倒计时、不注册后台拍点', async () => {
    const {win} = await boot({offAir:'label',lecturing:'card',store:{dybXhsLoopAuto:true}});
    try {
      const a=api(win); a._tick();
      assert.equal(a.popOnce('自动'),'off-air');
      assert.equal(win.__clicks.pop,0);
      assert.equal(a._state().nextAt,0);
      assert.equal(win.__runtimeMessages.some(m=>m.type==='dyc:beatEnsure'),false);
    } finally {win.close();}
  });
  await check('回归：平台没有反馈时成功次数不能增加', async () => {
    const { win } = await boot({ lecturing: 'card', noFeedback: true });
    try {
      api(win).popOnce('自动');
      assert.equal(win.__clicks.pop, 1);
      assert.equal(api(win)._state().rounds, 0, '只发了点击就计成功，没有等平台冷却反馈');
      await sleep(1600);
      assert.equal(api(win)._state().rounds, 0);
      assert.equal(win.__status.filter(s => s.t === 'success').length, 0);
    } finally { win.close(); }
  });
  await testPlacement();
  await testLectureDetect();
  await testCooldown();
  await testNoLecture();
  await testRateLimit();
  await testListing();
  await testSettings();
  await testAdaptedLoop();
  await testOfflineAndPanel();
  console.log('\n' + (pass) + ' 条通过' + (process.exitCode ? '（有失败）' : '，全绿'));
})();
