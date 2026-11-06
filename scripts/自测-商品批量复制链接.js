/**
 * 自测 · 抖店商品管理「批量复制商品链接」（2026-11-06）
 * ============================================================
 * 被测文件：src/content/goods-batch-copy.js
 *
 * 覆盖这些事（每条都对应一个真机上会出错的地方）：
 *   A. 批量工具条定位 —— 该页真实结构是「导出查询商品/查看导出记录/批量下架/
 *      批量修改/查看优化记录」，**没有「更多操作」也没有「批量上架」**；
 *      用旧判据（三词同框）会永远匹配不到，按钮永远不出现。
 *   B. 按钮落在这一排最右端（用户 2026-11-06 定），且不会重复插入
 *   C. 未勾选 ⇒ 灰态不可点；勾选后 ⇒ 启用
 *   D. 链接格式：一行一条、`\n` 分隔、模板 + 商品 ID，顺序 = 页面从上到下
 *   E. 30 条上限：超过 30 个**直接拦下不开始**（用户 2026-11-07 改口径），
 *      正好 30 个要能正常跑（边界不能被误拦）
 *   F. 认不出 ID 的行跳过并计数，绝不拼半截链接
 *   G. 同一商品 ID 只出一条（重复链接会被平台判「重复添加」）
 *   H. ★ 勾选识别不能把「未勾选」误判成勾选 —— `checkbox-unchecked`
 *      这类类名里含 "checked" 子串，用 `[class*="checked"]` 会全判成已勾，
 *      结果是复制出一堆用户没选的商品。
 *   I. 复制成功后自动取消勾选（用户 2026-11-06 定）
 *   J. 关开关 ⇒ 按钮移除
 *   K. 源码红线：不发请求（无 fetch/XHR）、不点平台的「复制链接」
 *
 * 用法：node scripts/自测-商品批量复制链接.js
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

const ROOT = path.join(__dirname, '..');
const SRC_REL = 'src/content/goods-batch-copy.js';
const CODE = fs.readFileSync(path.join(ROOT, SRC_REL), 'utf8');

let pass = 0;
let fail = 0;
const failures = [];
function check(name, fn) {
  try { fn(); pass++; console.log('  ✓ ' + name); }
  catch (e) { fail++; failures.push(name + ' —— ' + e.message); console.log('  ✗ ' + name); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 等条件成立（禁用固定 sleep 卡时间 —— 并发下会假红） */
async function waitFor(pred, timeoutMs, step) {
  const limit = Date.now() + timeoutMs;
  while (Date.now() < limit) {
    if (pred()) return true;
    await sleep(step || 40);
  }
  return false;
}


/** 点按钮并等到出现终态消息（不是 running）—— 逐行点击是异步的，固定 sleep 会假红 */
async function clickAndWait(A, timeoutMs) {
  const before = A.statuses.length;
  A.btn().click();
  await waitFor(() => {
    if (A.statuses.length <= before) return false;
    const last = A.statuses[A.statuses.length - 1];
    return !!last && last.type !== 'running';
  }, timeoutMs || 12000, 60);
  await sleep(40);
}

const ID = (i) => '35524304130478111' + String(i).padStart(2, '0');

/**
 * 起一个最小页面。
 * @param {{rows?:number, checked?:number[], noId?:number[], dupId?:boolean,
 *          enabled?:boolean, semanticId?:boolean}} o
 */
async function boot(o) {
  const opt = Object.assign({
    rows: 4,
    checked: [0, 1],
    noId: [],
    dupId: false,
    enabled: true,
    semanticId: false,
    hiddenCopy: false,
    twoRows: false,
    rowSelectedClass: false,
    noMark: false,
    barCount: null,
    splitBar: false,
    checkInSecondCell: false,
    measureRow: false,
    deadRows: []
  }, o || {});

  const dom = new JSDOM(`<!doctype html><html><body>
    <div class="toolbar">
      <button type="button">导出查询商品</button>
      <button type="button">查看导出记录</button>
      <button type="button">批量下架</button>
      <button type="button">批量修改</button>
      <button type="button">查看优化记录</button>
    </div>
    <div id="table-host"></div>
  </body></html>`, { url: 'https://fxg.jinritemai.com/ffa/g/list', runScripts: 'outside-only' });

  const win = dom.window;
  const doc = win.document;

  /* 布局垫片：jsdom 不做布局，getBoundingClientRect 恒为 0。
     而脚本 2026-11-07 起会用「可见性」筛掉隐藏的同名副本 ——
     没有这个垫片，真实可见的工具条也会被判成隐藏，用例全红。
     display:none 的元素仍返回 0，这样「隐藏副本」那个用例才是真的在测东西。 */
  win.Element.prototype.getBoundingClientRect = function () {
    /* 真实浏览器里，隐藏祖先的子孙同样没有布局盒 → 一路向上查 display:none */
    let n = this;
    while (n && n.style) {
      if (n.style.display === 'none') {
        return { width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0, x: 0, y: 0 };
      }
      n = n.parentElement;
    }
    return { width: 120, height: 30, top: 0, left: 0, right: 120, bottom: 30, x: 0, y: 0 };
  };

  /* 可选：还原「左右分区」布局（2026-11-07 用户截图）——
     左边「已选20条」，右边一排按钮。定位收敛到的是右边按钮组，
     里面**不含**「已选20条」，所以在 bar 内找数字永远找不到。 */
  if (opt.splitBar) {
    const oldBar = doc.querySelector('.toolbar');
    const wrap = doc.createElement('div');
    wrap.className = 'bar-wrap';
    const left = doc.createElement('div');
    left.className = 'bar-left';
    left.innerHTML = '<span>已选' + (opt.barCount || 0) + '条</span>';
    const right = doc.createElement('div');
    right.className = 'toolbar bar-right';
    right.innerHTML = oldBar.innerHTML;
    wrap.appendChild(left);
    wrap.appendChild(right);
    doc.body.replaceChild(wrap, oldBar);
  }

  /* 可选：还原真机的**两行工具条**结构（2026-11-07 用户截图）——
     上行筛选区也有「查看优化记录」，下行批量区才有「更多操作」。
     两行撞词时选错行，按钮就挂到筛选区去了。 */
  if (opt.twoRows) {
    const filter = doc.createElement('div');
    filter.className = 'filter-row';
    filter.innerHTML =
      '<button type="button">查询</button>' +
      '<button type="button">重置</button>' +
      '<button type="button">展开</button>' +
      '<button type="button">导出查询商品</button>' +
      '<button type="button">查看导出记录</button>' +
      '<button type="button">查看优化记录</button>';
    doc.body.insertBefore(filter, doc.querySelector('.toolbar'));

    const bar = doc.querySelector('.toolbar');
    bar.className = 'toolbar batch-row';
    bar.innerHTML =
      '<span>已选20条</span>' +
      '<button type="button">批量下架</button>' +
      '<button type="button">批量修改</button>' +
      '<button type="button">查看优化记录</button>' +
      '<button type="button">尺码表自动优化</button>' +
      '<button type="button">渠道品管理</button>' +
      '<button type="button">更多操作</button>';
  }

  /* 可选：在工具条**之前**塞一份隐藏的同名副本（下拉菜单/折叠面板的常见形态）。
     ⚠️ 必须**多层包装**（display:none 的外壳 + 自身没有 display 的内层按钮组）：
        平台的隐藏菜单就是这种结构，而「向上收敛」会先碰到那个内层按钮组 ——
        它自身没有 display:none，只看容器的可见性判断会误认为是可见的，
        于是把按钮挂进隐藏外壳里。单层构造测不出这个问题（2026-11-07 踩过）。 */
  if (opt.hiddenCopy) {
    const hid = doc.createElement('div');
    hid.id = 'hidden-copy';
    hid.style.display = 'none';
    hid.innerHTML =
      '<div class="group">' +
        '<button type="button">批量下架</button>' +
        '<button type="button">批量修改</button>' +
        '<button type="button">查看优化记录</button>' +
      '</div>';
    doc.body.insertBefore(hid, doc.body.firstChild);
  }

  const copied = [];      // 每次 execCommand('copy') 时 textarea 里的内容
  const statuses = [];    // setStatus 调用记录

  const rowsHtml = [];
  for (let i = 0; i < opt.rows; i++) {
    const isChecked = opt.checked.indexOf(i) >= 0;
    const id = opt.dupId && i === 1 ? ID(0) : ID(i);
    const idHtml = opt.noId.indexOf(i) >= 0
      ? '<span class="art">货号: A' + i + '</span>'
      : (opt.semanticId
          ? '<span class="lbl">ID</span><span class="val">' + id + '</span>'
          : '<span class="gid">ID: ' + id + '</span>');
    /* rowSelectedClass：模拟「选中态挂在 tr 上」的表格组件实现 */
    const trCls = 'ecom-g-table-row' +
      (isChecked && opt.rowSelectedClass ? ' ecom-g-table-row-selected' : '');
    /* noMark：行内既没有真 checkbox、也没有任何标记 ——
       模拟我们猜不到选中态的最坏情况（真机上用户报的就是这类） */
    const checkCell = opt.noMark
      ? '<td class="c-check"></td>'
      : '<td class="c-check"><input type="checkbox"' + (isChecked ? ' checked' : '') + '></td>';
    /* checkInSecondCell：勾选列不在第一列（第一列是图片列），且勾选态只写在
       自绘控件的类名上、input 不带 checked —— 第一路（从 tr 查首列）必瞎，
       只有「从勾选控件反查行」这一路能救。 */
    const cellsHtml = opt.checkInSecondCell
      ? ('<td class="c-img"></td>' +
         '<td class="c-check"><span class="ecom-g-checkbox ecom-g-checkbox-' +
         (isChecked ? 'checked' : 'unchecked') + '"></span></td>')
      : checkCell;
    rowsHtml.push(
      '<tr class="' + trCls + '">' +
        cellsHtml +
        '<td class="c-info">' +
          '<div class="name">测试商品 ' + i + '</div>' +
          '<div class="meta">' + idHtml + '</div>' +
        '</td>' +
        '<td class="c-op"><button type="button">复制链接</button></td>' +
      '</tr>'
    );
  }
  /* 虚拟滚动的测量行：高度 0、无内容、无勾选框。真机上它就在 tbody 里，
     不剔掉会让「已选 N 条 = 本页行数」这个全选兜底永远差一个。 */
  if (opt.measureRow) {
    rowsHtml.unshift(
      '<tr class="ecom-g-table-measure-row"><td style="padding:0;border:0;height:0">' +
      '<div style="height:0;overflow:hidden">&nbsp;</div></td></tr>'
    );
  }

  doc.getElementById('table-host').innerHTML =
    '<table class="ecom-g-table"><tbody>' + rowsHtml.join('') + '</tbody></table>';

  /* 「已选 N 条」—— 平台自己渲染的勾选条数，是判可用态最权威的信号 */
  if (opt.barCount !== null && opt.barCount !== undefined) {
    const bar = doc.querySelector('.toolbar');
    const span = doc.createElement('span');
    span.textContent = '已选' + opt.barCount + '条';
    bar.insertBefore(span, bar.firstChild);
  }

  /* 页面路径判定表（脚本依赖它限定作用页） */
  win.DYC_PAGE_PATTERNS = {
    list: /^https:\/\/fxg\.jinritemai\.com\/ffa\/g\/list/
  };

  /* 依赖桩：anchor.js 的行定位与「标签: 值」取值 */
  win.findProductRows = () => Array.from(doc.querySelectorAll('tbody tr'));
  win.extractValueAfterLabel = (row, label) => {
    if (!opt.semanticId) return null;      // 默认走「整行文本」那条路
    const v = row.querySelector('.val');
    return v ? v.textContent : null;
  };

  /* 消息栏桩 */
  win.setStatus = (message, type, opts) => {
    statuses.push({ message: message, type: type, count: (opts && opts.count) || '', full: (opts && opts.full) || '' });
  };

  /* 剪贴板桩：jsdom 没有 execCommand，用 textarea 的 value 当作写进去的内容 */
  doc.execCommand = () => {
    const ta = doc.querySelector('textarea');
    if (ta) copied.push(ta.value);
    return true;
  };

  /* 模拟"平台的复制链接按钮会把链接写进剪贴板"。
     故意加 &from=share 后缀：与「ID 直拼」的结果不同，
     这样断言能区分最终链接是**点出来的**还是**拼出来的**。 */
  let fakeClip = '';
  win.chrome = {
    runtime: {
      sendMessage: function (msg, cb) {
        if (msg && msg.type === 'dyc:readClipboard') {
          try { cb({ ok: true, text: fakeClip }); } catch (e) { /* 忽略 */ }
          return;
        }
        try { if (cb) cb({ ok: false }); } catch (e2) { /* 忽略 */ }
      }
    }
  };

  doc.querySelectorAll('tbody tr').forEach((tr, idx) => {
    const b = Array.from(tr.querySelectorAll('button'))
      .find((x) => x.textContent === '复制链接');
    if (!b) return;
    /* deadRows：指定行的「复制链接」点了没反应 —— 真机上「行滚出视口后
       平台不响应合成点击」就是这个表现。必须只废掉一部分行：
       整批全废会触发外层"全部用 ID 拼"的大兜底，反而测不到单行兜底。 */
    if (opt.deadRows.indexOf(idx) >= 0) return;
    b.addEventListener('click', () => {
      const m = /ID:\s*(\d{10,})/.exec(tr.textContent);
      fakeClip = m
        ? ('https://haohuo.jinritemai.com/views/product/item2?id=' + m[1] + '&from=share')
        : '';
    });
  });

  let watchCb = null;
  win.dycReadFlags = () => Promise.resolve({ shopBatchCopyLink: opt.enabled });
  win.dycWatchFlags = (cb) => { watchCb = cb; };

  /* 禁网硬约束：脚本一旦发请求就让它炸出来 */
  const netHit = [];
  win.fetch = () => { netHit.push('fetch'); return Promise.reject(new Error('no net')); };
  win.XMLHttpRequest = function () { netHit.push('xhr'); throw new Error('no net'); };

  let error = null;
  try { win.eval(CODE); } catch (e) { error = e; }
  await sleep(60);   // dycReadFlags 是 Promise，等一拍

  return {
    dom, win, doc, copied, statuses, netHit,
    error,
    btn: () => doc.querySelector('.dyc-gbc-btn'),
    bar: () => doc.querySelector('.toolbar'),
    rows: () => Array.from(doc.querySelectorAll('tbody tr')),
    getWatchCb: () => watchCb,
    clip: () => fakeClip,
    close: () => { try { win.close(); } catch (e) { /* 忽略 */ } }
  };
}

(async function main() {
  /* ========== A / B：定位与落点 ========== */
  console.log('\n【一】批量工具条定位与按钮落点');
  const A = await boot({});
  check('脚本无异常', () => {
    assert.equal(A.error, null, '抛错：' + (A.error && A.error.message));
  });
  check('这页没有「更多操作/批量上架」，按钮仍然挂出来了', () => {
    const b = A.btn();
    assert.ok(b, '按钮没出现 —— 判据还依赖「更多操作」或「批量上架」');
    assert.equal(b.textContent, '批量复制链接', '按钮文案是「' + b.textContent + '」');
  });
  check('按钮落在这一排最右端（用户指定位置）', () => {
    const bar = A.bar();
    assert.equal(bar.lastElementChild, A.btn(), '按钮不在工具条末尾');
  });
  check('反复扫描不会插出第二个按钮', () => {
    assert.equal(A.doc.querySelectorAll('.dyc-gbc-btn').length, 1);
  });

  /* ========== A9：勾选列不在第一列（只能靠控件反查） ========== */
  console.log('\n【一·f】勾选列不在首列、勾选态只写在自绘控件类名上');
  const A9 = await boot({ rows: 3, checked: [1], checkInSecondCell: true });
  check('从勾选控件反查能认出那一行 ⇒ 按钮亮', () => {
    assert.equal(A9.btn().disabled, false, '按钮还是灰的 —— 反查这一路没生效');
  });
  await clickAndWait(A9);
  check('反查命中的正是勾选的那一行', () => {
    assert.equal(A9.copied.length, 1, '没复制出内容');
    const lines = A9.copied[0].split('\n');
    assert.equal(lines.length, 1, '实际 ' + lines.length + ' 条');
    assert.ok(lines[0].indexOf(ID(1)) > 0, '取错行：' + lines[0]);
  });
  A9.close();

  /* ========== A7/A8：左右分区布局 + 灰态不许死锁 ========== */
  console.log('\n【一·e】左右分区布局（已选在左、按钮在右）');
  const A7 = await boot({ rows: 3, checked: [], noMark: true, splitBar: true, barCount: 3 });
  check('「已选3条」在父级容器里也能读到 ⇒ 按钮亮', () => {
    assert.equal(A7.btn().disabled, false, '读不到父级里的「已选」—— 按钮还是灰的');
  });
  await clickAndWait(A7);
  check('全选兜底 + 父级「已选」⇒ 复制到 3 条', () => {
    const lines = A7.copied[0].split('\n');
    assert.equal(lines.length, 3, '实际 ' + lines.length + ' 条');
  });
  A7.close();

  const A8 = await boot({ rows: 3, checked: [], noMark: true, splitBar: true, barCount: 0 });
  check('一条都没勾 ⇒ 按钮灰、不可点（用户 2026-11-07）', () => {
    assert.equal(A8.btn().disabled, true, '没勾选却可点');
  });
  await clickAndWait(A8);
  check('★ 没勾选 ⇒ 一条都不许复制（用户 2026-11-07：这是 bug）', () => {
    assert.equal(A8.copied.length, 0, '没勾选却复制了东西');
  });
  check('灰态点下去什么都不发生（不复制也不弹消息）', () => {
    assert.equal(A8.statuses.length, 0, '灰态却发了消息');
  });
  A8.close();

  /* ========== A11：点击无效 ⇒ ID 兜底必须真的进结果 ==========
     2026-11-07 真机：第一次点击弹出「改用 ID 补全」6 次，条数一条没涨 ——
     补出来的链接被下面统一按 ID 判重时 continue 掉了。守这个。 */
  console.log('\n【一·h】点击无效时 ID 兜底');
  const A11 = await boot({ rows: 3, checked: [0, 1, 2], deadRows: [1, 2], barCount: 3 });
  await clickAndWait(A11, 25000);
  check('★ 点击无效 ⇒ 用 ID 补出来，不能一条都没有', () => {
    assert.equal(A11.copied.length, 1, '一条都没产出（兜底的链接被自己丢掉了）');
    const lines = A11.copied[0].split('\n');
    assert.equal(lines.length, 3, '应 3 条，实际 ' + lines.length);
  });
  check('补出来的链接指向正确的商品 ID', () => {
    const lines = A11.copied[0].split('\n');
    [0, 1, 2].forEach((i) => {
      assert.ok(lines.some((l) => l.indexOf(ID(i)) > 0),
        '缺少第 ' + i + ' 个商品：' + lines.join(','));
    });
  });
  A11.close();

  /* ========== A10：虚拟滚动测量行必须剔除 ========== */
  console.log('\n【一·g】虚拟滚动测量行（真机取样抓到的坑）');
  const A10 = await boot({ rows: 3, checked: [], noMark: true, barCount: 3, measureRow: true });
  await clickAndWait(A10);
  check('★ 复制 3 条，不是 2 条也不是 4 条', () => {
    assert.equal(A10.copied.length, 1, '没产出');
    const lines = A10.copied[0].split('\n');
    assert.equal(lines.length, 3, '实际 ' + lines.length + ' 条');
  });
  A10.close();

  /* ========== A4/A5/A6：勾选态识别（2026-11-07 用户报「勾了但点不动」） ========== */
  console.log('\n【一·d】勾选态识别');
  const A4 = await boot({ rows: 3, checked: [0, 2], rowSelectedClass: true, noMark: true });
  check('选中态挂在 tr 的类上 ⇒ 也能识别（按钮可点）', () => {
    assert.equal(A4.btn().disabled, false, '按钮还是灰的');
  });
  await clickAndWait(A4);
  check('按 tr 选中类收集到正确的那几行', () => {
    const lines = A4.copied[0].split('\n');
    assert.equal(lines.length, 2, '实际 ' + lines.length + ' 条');
    assert.ok(lines[0].indexOf(ID(0)) > 0 && lines[1].indexOf(ID(2)) > 0, '取错行');
  });
  A4.close();

  const A5 = await boot({ rows: 3, checked: [], noMark: true, barCount: 3 });
  check('完全猜不到选中态、但平台说已选 3 条 = 全部 3 行 ⇒ 按全选处理', () => {
    assert.equal(A5.btn().disabled, false, '按钮是灰的，用户点不动');
  });
  await clickAndWait(A5);
  check('全选兜底收集到 3 条，不是 0 条', () => {
    const lines = A5.copied[0].split('\n');
    assert.equal(lines.length, 3, '实际 ' + lines.length + ' 条');
  });
  A5.close();

  const A6 = await boot({ rows: 5, checked: [], noMark: true, barCount: 2 });
  check('平台说已选 2 条、本页却有 5 行 ⇒ 按钮可点（不能死锁）', () => {
    assert.equal(A6.btn().disabled, false, '按钮是灰的');
  });
  await clickAndWait(A6);
  check('★ 勾选数与行数对不上 ⇒ 不猜，一条都不复制', () => {
    assert.equal(A6.copied.length, 0, '对不上还把整页复制了');
  });
  check('如实说明「已勾选 X 条，与当前页 Y 行对不上」', () => {
    const s = A6.statuses[A6.statuses.length - 1];
    assert.ok(/对不上/.test(s.full || ''), '提示不清楚：' + s.full);
    assert.ok(/2/.test(s.full) && /5/.test(s.full), '没带上具体数字：' + s.full);
  });
  A6.close();

  /* ========== A3：两行工具条撞词（2026-11-07 用户截图，挂错行） ========== */
  console.log('\n【一·c】两行工具条：上行筛选区也有「查看优化记录」');
  const A3 = await boot({ checked: [0], twoRows: true });
  check('按钮挂在下行批量区，不是上行筛选区', () => {
    const b = A3.btn();
    assert.ok(b, '按钮没出现');
    assert.equal(b.closest('.filter-row'), null, '按钮被挂到了上行筛选区');
    assert.equal(b.parentElement, A3.doc.querySelector('.batch-row'), '按钮不在下行批量区');
  });
  check('按钮紧跟在「更多操作」右边（用户指定位置）', () => {
    const b = A3.btn();
    const more = Array.from(A3.doc.querySelectorAll('.batch-row button'))
      .find((x) => x.textContent === '更多操作');
    assert.ok(more, '构造里没有「更多操作」按钮');
    assert.equal(more.nextElementSibling, b, '按钮不在「更多操作」右边');
  });
  A3.close();

  /* ========== A2：隐藏副本（2026-11-07 用户报「按钮没看到」的根因） ========== */
  console.log('\n【一·b】页面里还有一份隐藏的同名工具条');
  const A2 = await boot({ checked: [0], hiddenCopy: true });
  check('隐藏副本存在，但按钮挂到了可见的那条工具条上', () => {
    const b = A2.btn();
    assert.ok(b, '按钮没出现 —— 很可能命中隐藏副本后挂丢了');
    const hidden = A2.doc.getElementById('hidden-copy');
    assert.equal(hidden.contains(b), false, '按钮被挂进了隐藏容器（用户看不见）');
    assert.equal(b.parentElement, A2.bar(), '按钮不在可见工具条里');
  });
  check('隐藏副本里没有被塞进第二个按钮', () => {
    const hidden = A2.doc.getElementById('hidden-copy');
    assert.equal(hidden.querySelectorAll('.dyc-gbc-btn').length, 0, '隐藏副本里多了一个按钮');
  });
  A2.close();

  /* ========== C：勾选门控 ========== */
  console.log('\n【二】勾选门控');
  check('已勾选 2 行 ⇒ 按钮可点', () => {
    assert.equal(A.btn().disabled, false, '有勾选却不可点');
  });
  const C = await boot({ checked: [] });
  check('一行都没勾 ⇒ 按钮灰、不可点', () => {
    assert.equal(C.btn().disabled, true, '没勾选却可点');
  });
  C.close();

  /* ========== D：链接格式与顺序 ========== */
  console.log('\n【三】链接格式、顺序与去重');
  await clickAndWait(A);
  check('剪贴板收到一条内容', () => {
    assert.equal(A.copied.length, 1, 'execCommand 被调用 ' + A.copied.length + ' 次');
  });
  check('一行一条、换行分隔、首尾不粘连', () => {
    const lines = A.copied[0].split('\n');
    assert.equal(lines.length, 2, '行数 ' + lines.length + '，应为 2');
    lines.forEach((l) => {
      assert.ok(/^https:\/\/haohuo\.jinritemai\.com\/views\/product\/item2\?id=\d{10,}(&\S*)?$/.test(l),
        '链接形态不对：' + l);
    });
  });
  check('★ 最终输出里没有任何重复的商品 ID（用户要求核对重复）', () => {
    const lines = A.copied[0].split('\n');
    const ids = lines.map((l) => (/[?&]id=(\d{10,})/.exec(l) || [])[1]).filter(Boolean);
    assert.equal(ids.length, lines.length, '有链接取不出商品 ID：' + A.copied[0]);
    assert.equal(new Set(ids).size, ids.length, '出现重复商品：' + ids.join(','));
  });
  check('顺序 = 页面从上到下（先第 0 行，再第 1 行）', () => {
    const lines = A.copied[0].split('\n');
    assert.ok(lines[0].indexOf(ID(0)) > 0, '第一行不是页面上第一个勾选商品');
    assert.ok(lines[1].indexOf(ID(1)) > 0, '第二行顺序不对');
  });
  check('成功消息是一段式结果，带「已复制」', () => {
    const s = A.statuses[A.statuses.length - 1];
    assert.equal(s.type, 'success', '消息类型 ' + s.type);
    assert.ok(/已复制/.test(s.count), '结果词是「' + s.count + '」');
  });
  check('没有发任何网络请求（不点平台按钮、不调接口）', () => {
    assert.equal(A.netHit.length, 0, '发生了请求：' + A.netHit.join(','));
  });

  const G = await boot({ rows: 3, checked: [0, 1, 2], dupId: true });
  await clickAndWait(G);
  check('同一商品 ID 只出一条（3 行里两行同 ID ⇒ 2 条）', () => {
    const lines = G.copied[0].split('\n');
    assert.equal(lines.length, 2, '去重后应 2 条，实际 ' + lines.length);
  });
  check('重复的那个商品只保留第一次出现', () => {
    const lines = G.copied[0].split('\n');
    assert.ok(lines[0].indexOf(ID(0)) > 0, '首条不是重复的那个商品');
    assert.equal(lines.filter((l) => l.indexOf(ID(0)) > 0).length, 1, '同一商品出现多次');
  });
  G.close();

  /* ========== E：30 条上限 ========== */
  console.log('\n【四】30 条上限：超过就拦下，不开始（用户 2026-11-07 改口径）');
  const many = Array.from({ length: 35 }, (_, i) => i);
  const E = await boot({ rows: 35, checked: many, barCount: 35 });
  await clickAndWait(E);
  check('★ 勾 35 条 ⇒ 一条都不复制（超过上限直接不干）', () => {
    assert.equal(E.copied.length, 0, '超过上限还复制了东西');
  });
  check('提示写明「已勾选 35 个，超过单次 30 个上限」', () => {
    const s = E.statuses[E.statuses.length - 1];
    assert.notEqual(s.type, 'success', '超过上限却报成功');
    assert.ok(/35/.test(s.full), '没写勾选数量：' + s.full);
    assert.ok(/30/.test(s.full), '没写上限：' + s.full);
    assert.ok(/超过/.test(s.full), '没说明超限：' + s.full);
  });

  /* 边界：正好 30 个要能正常跑（不能把 30 也拦了） */
  const E30 = await boot({ rows: 30, checked: many.slice(0, 30), barCount: 30 });
  await clickAndWait(E30);
  check('正好勾 30 个 ⇒ 正常复制，不被拦', () => {
    assert.equal(E30.copied.length, 1, '勾 30 个反而没复制（把边界拦错了）');
    const lines = E30.copied[0].split('\n');
    assert.equal(lines.length, 30, '实际 ' + lines.length + ' 条');
  });
  E.close();
  E30.close();

  /* ========== F：认不出 ID ========== */
  console.log('\n【五】认不出 ID 的行');
  const F = await boot({ rows: 3, checked: [0, 1, 2], noId: [1] });
  await clickAndWait(F);
  check('认不出 ID 的行被跳过，其余照复制', () => {
    const lines = F.copied[0].split('\n');
    assert.equal(lines.length, 2, '实际 ' + lines.length + ' 条');
  });
  check('★ 认不出 ID 的行不会变成空行或半截链接', () => {
    const lines = F.copied[0].split('\n');
    lines.forEach((l) => {
      assert.ok(/^https?:\/\/\S+$/.test(l), '出现了空行/半截链接：' + JSON.stringify(l));
    });
  });
  F.close();

  const F2 = await boot({ rows: 2, checked: [0, 1], noId: [0, 1] });
  await clickAndWait(F2);
  check('全都认不出 ⇒ 不写剪贴板、不谎报成功', () => {
    assert.equal(F2.copied.length, 0, '剪贴板被写入了空内容或半截内容');
    const s = F2.statuses[F2.statuses.length - 1];
    assert.notEqual(s.type, 'success', '全失败却报成功');
  });
  F2.close();

  /* ========== H：勾选识别不能误判 ========== */
  console.log('\n【六】勾选识别（unchecked 不能算勾上）');
  const H = await boot({ rows: 3, checked: [] });
  // 把首列改成平台自绘勾选：类名里含 unchecked 子串
  H.rows().forEach((tr) => {
    tr.cells[0].innerHTML = '<span class="ecom-g-checkbox ecom-g-checkbox-unchecked"></span>';
  });
  await clickAndWait(H);
  check('★ unchecked 不能当成已勾选 ⇒ 一条都不复制', () => {
    assert.equal(H.copied.length, 0, '把未勾选当成了已勾选，复制了东西');
  });
  check('未勾选时按钮是灰的', () => {
    assert.equal(H.btn().disabled, true, '没勾选却不灰');
  });
  const H2 = await boot({ rows: 3, checked: [1] });
  H2.rows().forEach((tr, i) => {
    tr.cells[0].innerHTML = '<span class="ecom-g-checkbox ' +
      (i === 1 ? 'ecom-g-checkbox-checked' : 'ecom-g-checkbox-unchecked') + '"></span>';
  });
  await clickAndWait(H2);
  check('自绘勾选 checked 只认那一行', () => {
    const lines = H2.copied[0].split('\n');
    assert.equal(lines.length, 1, '实际 ' + lines.length + ' 条');
    assert.ok(lines[0].indexOf(ID(1)) > 0, '认错了行');
  });
  H.close();
  H2.close();

  /* ========== I：复制后自动取消勾选 ========== */
  console.log('\n【七】复制成功后自动取消勾选（用户定）');
  const I = await boot({ rows: 3, checked: [0, 2] });
  await clickAndWait(I);
  const cleared = await waitFor(
    () => I.rows().every((tr) => !tr.querySelector('input[type="checkbox"]').checked),
    3000, 60
  );
  check('勾选被自动清空', () => {
    assert.ok(cleared, '仍有勾选未清空');
  });
  I.close();

  /* ========== J：关开关 ========== */
  console.log('\n【八】开关关闭');
  const J = await boot({});
  check('开启时有按钮', () => assert.ok(J.btn()));
  J.getWatchCb()({ shopBatchCopyLink: false });
  await sleep(50);
  check('关掉开关 ⇒ 按钮移除', () => {
    assert.equal(J.btn(), null, '按钮还在');
  });
  J.close();

  /* ========== K：源码红线 ========== */
  console.log('\n【九】源码红线');
  check('没有 fetch / XMLHttpRequest 调用', () => {
    assert.equal(/fetch\s*\(/.test(CODE), false, '源码里出现了 fetch');
    assert.equal(/new\s+XMLHttpRequest/.test(CODE), false, '源码里出现了 XHR');
  });
  check('没有去点平台的「复制链接」（不模拟手动）', () => {
    assert.equal(/复制链接['"]?\s*\)\s*\.click|querySelector\([^)]*复制链接/.test(CODE), false,
      '源码里出现了点击平台复制链接的痕迹');
  });
  check('上限常量是 30', () => {
    assert.ok(/MAX_LINKS\s*=\s*30/.test(CODE), '上限不是 30');
  });

  /* ========== 汇总 ========== */
  console.log('\n────────────────────────────');
  console.log('  通过 ' + pass + ' · 失败 ' + fail);
  if (fail) {
    console.log('\n失败明细：');
    failures.forEach((f) => console.log('  · ' + f));
  }
  process.exit(fail ? 1 : 0);
})();
