'use strict';

/**
 * 自测 · 微信小店「商品行快捷复制」（2026-10-31）
 *
 * 功能本体在 src/content/wx-goods-tools.js，两个按钮：
 *   ① 「货号」    —— 复制商品名末尾的款号
 *   ② 「复制链接」—— 点一下内部完成「打开分享面板 → 读链接 → 关面板 → 复制」
 *
 * 本脚本钉死六件事：
 *   ① 两个按钮插到「规格/编码 预览 分享」那一行末尾，12 行都插到
 *   ② 幂等：反复补涂不会插出第二组
 *   ③ 货号取值：末尾 NE1C1162W 能取到；末尾不是款号时**不乱复制**，只提示
 *   ④ 链接：面板里 input 的 value 能被读到并复制，面板能被关掉
 *   ⑤ 链接取不到时**不复制半截内容**，按钮提示「取不到」
 *   ⑥ 关开关：按钮全移除，给那一行加的 flex-wrap 也还原
 *
 * ⚠️ 分享面板的真实 DOM 结构未实机验证（开发时无法登录商家后台）。
 *    这里用一个「input 装链接 + role=dialog」的仿真面板，测的是
 *    **读取与收尾逻辑**，不是平台真实结构。实机若不匹配，功能会如实
 *    报「取不到」，不会复制错东西。
 *
 * 用法：node scripts/自测-微信小店行内复制.js（run-selftests.py 自动带上）
 */

const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');

let JSDOM;
try { ({ JSDOM } = require('jsdom')); }
catch (_) { ({ JSDOM } = require('C:/Users/79412/.workbuddy/binaries/node/workspace/node_modules/jsdom')); }

const ROOT = path.join(__dirname, '..');
const CODE = fs.readFileSync(path.join(ROOT, 'src/content/wx-goods-tools.js'), 'utf8');

let pass = 0;
let fail = 0;
const failures = [];
function check(name, fn) {
  try { fn(); pass++; console.log('  ✓ ' + name); }
  catch (e) { fail++; failures.push(name + ' —— ' + e.message); console.log('  ✗ ' + name); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* 等条件成立，最多等 timeoutMs。
 * ★ 为什么不用固定 sleep（2026-11-02 修偶发失败）：
 *   原来「取不到链接」那条用例靠 `sleep(4300)` 等「桥询问 1500ms + 面板 24 轮
 *   (2.4s)」，余量只有 400ms。并发跑全量时定时器被推迟，实测 5 轮里红 2 轮，
 *   而代码本身是对的 —— 这就是「自测总是红」里最难查的那一类：偶发、且与被测
 *   功能无关。改成等**目标状态**之后，机器慢只会让它多等几秒，不会判错。
 *   注意：这里的 timeoutMs 只是防呆上限，不是断言对象；
 *   用例断言的始终是「最终状态对不对」，不是「几秒内完成」。 */
async function waitFor(pred, timeoutMs, step) {
  const limit = Date.now() + timeoutMs;
  while (Date.now() < limit) {
    if (pred()) return true;
    await sleep(step || 50);
  }
  return false;
}

const LINK = 'https://store.weixin.qq.com/shop/a/XHEnL4JZ4AAkjyf';
const CODE_OK = 'NE1C1162W';
// 长名字末尾带款号 → 能取号；短名字末尾是中文 → 取不到号
const NAME_WITH_CODE = 'PM王囡囡 芥末黄/浅灰咖色半拉链插肩针织长袖上衣 ' + CODE_OK;
const NAME_NO_CODE = '纯中文商品名没有款号';

async function boot(opt) {
  const o = Object.assign({
    url: 'https://store.weixin.qq.com/shop/goods/list?page=1',
    rows: 12,
    panelLink: LINK,      // 分享面板里放的链接；'' = 面板打开但没有链接
    skuCodes: ['NE1C1142W-35-38', 'NE1C1142W-35-40', 'NE1C1142W-35-42'],  // 「规格/编码」弹层里的 SKU 编码
    enabled: true,
    withData: false,      // true = 给每行挂 Vue 实例（测 L1 真一键）
    rowNames: null,       // 覆盖某几行的商品名
    dataSku: null,        // 覆盖组件数据里的 SKU 编码列表
    bridge: false,        // true = 把 wx-link-main.js eval 进同一 window（模拟 MAIN world 桥）
    bridgeEarly: false,   // true = 桥在 tools **之前**注入（模拟 manifest 的 document_start 直注）
    apiShareUrl: ''       // 非空 = 给 window.fetch 打桩，模拟「主动查微信商品接口」这条
  }, opt);

  let errorBridge = null;    // 桥脚本自身的异常（独立记，便于区分是哪边炸的）

  const dom = new JSDOM(`<!doctype html><html><body>
    <div id="shell"><micro-app id="biz"></micro-app></div>
  </body></html>`, { url: o.url, runScripts: 'outside-only' });

  const win = dom.window;
  const doc = win.document;
  const sr = doc.getElementById('biz').attachShadow({ mode: 'open' });

  const rowsHtml = Array.from({ length: o.rows }, (_, i) => {
    const nm = (o.rowNames && o.rowNames[i]) || (i === 1 ? NAME_NO_CODE : NAME_WITH_CODE + i);
    return `
    <tr>
      <td class="c-check"><input type="checkbox"></td>
      <td class="c-name">
        <div class="item-basic-info">
          <div class="goods_title_1">${nm}</div>
        </div>
        <div class="item-info goods_meta" style="display:flex">
          <span class="gid">ID: 1000181661479${i}</span>
          <span class="spec">规格/编码</span>
          <span class="preview">预览</span>
          <span class="share" role="button">分享</span>
        </div>
      </td>
      <td class="c-price">¥389</td>
    </tr>`;
  }).join('');

  sr.innerHTML = `<table class="goods-table"><tbody>${rowsHtml}</tbody></table>`;

  // 模拟平台分享面板：点「分享」后插入一个 role=dialog 的浮层，
  // 里面用 input 装链接（这是「复制链接」最常见的实现）。
  function openPanel() {
    const box = doc.createElement('div');
    box.className = 'share-popover';
    box.setAttribute('role', 'dialog');
    const title = doc.createElement('div');
    title.textContent = '商品链接';
    box.appendChild(title);
    if (o.panelLink) {
      const inp = doc.createElement('input');
      inp.value = o.panelLink;
      box.appendChild(inp);
    }
    doc.body.appendChild(box);
    return box;
  }
  sr.querySelectorAll('.share').forEach((el) => {
    el.addEventListener('click', () => { openPanel(); });
  });

  // 模拟「规格/编码」弹层：点它插入一个浮层，标题「商家SKU编码」，
  // 每条 SKU 两行（规格描述 + 括号包着的编码）—— 与真机截图一致。
  const opens = { sku: 0 };
  function openSkuPanel() {
    opens.sku++;
    const box = doc.createElement('div');
    box.className = 'sku-popover';
    box.setAttribute('role', 'dialog');
    const title = doc.createElement('div');
    title.className = 'sku-panel-title';
    title.textContent = '商家SKU编码';
    box.appendChild(title);
    o.skuCodes.forEach((code) => {
      const desc = doc.createElement('div');
      desc.textContent = '蓝色；38(M码 90斤-115斤)';
      const cd = doc.createElement('div');
      cd.textContent = '(' + code + ')';
      box.appendChild(desc);
      box.appendChild(cd);
    });
    doc.body.appendChild(box);
    return box;
  }
  sr.querySelectorAll('.spec').forEach((el) => {
    el.addEventListener('click', () => { openSkuPanel(); });
  });

  // L1 场景：给每行挂一个 Vue 实例，列表里**故意把别的商品排在前面** ——
  // 如果实现按「第一个匹配的链接」取，就会拿到 OTHER000，测试会红。
  if (o.withData) {
    sr.querySelectorAll('tr').forEach((tr, i) => {
      tr.__vue__ = {
        goodsList: [
          {
            goodsId: 999999,
            shareUrl: 'https://store.weixin.qq.com/shop/a/OTHER000',
            sku_list: [{ sku_code: 'OTHER-1-1' }]
          },
          {
            goodsId: '1000181661479' + i,
            shareUrl: LINK,
            // 数据里的 SKU 编码与商品名末尾**故意不同**：验证「以 SKU 为准」
            sku_list: (o.dataSku || ['LX9' + i + '-1-2', 'LX9' + i + '-1-3'])
              .map((c) => ({ sku_code: c }))
          }
        ]
      };
    });
  }
  // 桥场景：把商品数据挂在**表格元素**上（不在 tr 内），并且先 eval 桥脚本。
  // 这样 tools 里那条同 world 的同步路径（从 tr 往上爬）爬不到，
  // 只有主世界桥能命中 —— 才是真的在测桥，不是被同步路径顺手带过。
  if (o.bridge) {
    const tbl = sr.querySelector('table');
    tbl.__vue__ = {
      $data: {
        list: [
          { goodsId: '999999', shareUrl: 'https://store.weixin.qq.com/shop/a/OTHER000' },
          { goodsId: '10001816614790', shareUrl: LINK }
        ]
      }
    };
  }

  // 派发 Escape 关面板（功能用的是这套收尾）
  doc.addEventListener('keydown', (ev) => {
    if (ev.key !== 'Escape') return;
    doc.querySelectorAll('.share-popover').forEach((n) => n.remove());
    doc.querySelectorAll('.sku-popover').forEach((n) => n.remove());
  });

  // 剪贴板：记录每次写入
  const copied = [];
  Object.defineProperty(win.navigator, 'clipboard', {
    configurable: true,
    value: {
      writeText(t) { copied.push(t); return Promise.resolve(); },
      readText() { return Promise.resolve(''); }
    }
  });

  const toasts = [];
  let watchCb = null;
  win.dycReadFlags = () => Promise.resolve({ wxRowCopy: o.enabled });
  win.dycWatchFlags = (cb) => { watchCb = cb; };
  win.toast = (text, type, opts) => { toasts.push({ text, type, opts: opts || {} }); };

  if (o.bridge && o.bridgeEarly) {
    const BRIDGE_E = fs.readFileSync(path.join(ROOT, 'src/content/wx-link-main.js'), 'utf8');
    try { win.eval(BRIDGE_E); } catch (e) { errorBridge = e; }
    await sleep(30);
  }

  // 「主动查接口」的桩：桥会 hook window.fetch，所以桩必须在桥 eval 之前放好。
  if (o.apiShareUrl) {
    // 桥现在先读 text 再自己 JSON.parse（便于把非 JSON 的错误页也记进诊断），
    // 所以桩必须同时给 text 与 status，只给 json 会走进异常分支。
    win.fetch = function () {
      var body = JSON.stringify({ code: 0, shareUrl: o.apiShareUrl, shareKey: 'Lv8Ucss6SLSgQ7e' });
      return Promise.resolve({
        status: 200,
        text: function () { return Promise.resolve(body); },
        json: function () { return Promise.resolve(JSON.parse(body)); }
      });
    };
  }

  let error = null;
  try { win.eval(CODE); } catch (e) { error = e; }
  await sleep(80);

  // 桥**晚于** tools 注入 —— 与真机顺序一致（tools 在 document_idle 跑，
  // 桥由它自己去注入）。反过来先 eval 桥，ready 消息会早于 tools 的监听器，
  // 于是 tools 永远认为「桥没起来」，测出来的就不是真链路。
  if (o.bridge && !o.bridgeEarly) {
    const BRIDGE = fs.readFileSync(path.join(ROOT, 'src/content/wx-link-main.js'), 'utf8');
    try { win.eval(BRIDGE); } catch (e) { errorBridge = e; }
    await sleep(150);         // 等 ready 的 postMessage 走完
  }

  return { dom, win, doc, sr, copied, toasts, error, errorBridge, opens, getWatchCb: () => watchCb };
}

function btns(sr) {
  return Array.from(sr.querySelectorAll('[data-dyc-wx-btn]'));
}
function rowOf(sr, i) {
  return sr.querySelectorAll('tr')[i];
}

(async function main() {
  /* ========== 主场景 ========== */
  console.log('\n【一】两个按钮插到元信息行末尾');
  const A = await boot({});

  check('脚本无异常', () => {
    assert.equal(A.error, null, '抛错：' + (A.error && A.error.message));
  });
  check('12 行 × 2 个按钮都插上了', () => {
    assert.equal(btns(A.sr).length, 24, '只有 ' + btns(A.sr).length + ' 个按钮');
  });
  check('按钮文案是「货号」与「复制链接」', () => {
    const labels = btns(A.sr).map((b) => b.textContent);
    assert.equal(labels.filter((t) => t === '货号').length, 12, '「货号」按钮数量不对');
    assert.equal(labels.filter((t) => t === '复制链接').length, 12, '「复制链接」按钮数量不对');
  });
  check('按钮挂在「规格/编码 预览 分享」那一行里', () => {
    const meta = rowOf(A.sr, 0).querySelector('.item-info');
    assert.ok(meta.querySelector('[data-dyc-wx-btn]'), '没挂到元信息行');
  });
  check('那一行补了 flex-wrap（放不下时换行，不溢出压价格列）', () => {
    const meta = rowOf(A.sr, 0).querySelector('.item-info');
    assert.equal(meta.style.flexWrap, 'wrap', 'flex-wrap 没设：' + meta.style.flexWrap);
  });

  console.log('\n【二】幂等');
  await (async () => {
    try {
      A.sr.appendChild(A.doc.createElement('i'));   // 制造一次 DOM 变更触发补涂
      await sleep(400);
      assert.equal(btns(A.sr).length, 24, '补涂后变成 ' + btns(A.sr).length + ' 个按钮');
      pass++; console.log('  ✓ 反复补涂不会插出第二组');
    } catch (e) {
      fail++; failures.push('幂等 —— ' + e.message);
      console.log('  ✗ 反复补涂不会插出第二组');
    }
  })();

  console.log('\n【三】复制货号（名字末尾有 → 零点击）');
  await (async () => {
    try {
      const btn = rowOf(A.sr, 0).querySelector('[data-dyc-wx-btn]');
      btn.click();
      await sleep(60);
      assert.equal(A.copied.length, 1, '剪贴板写入 ' + A.copied.length + ' 次');
      assert.equal(A.copied[0], CODE_OK + '0', '复制内容不对：' + A.copied[0]);
      assert.equal(A.opens.sku, 0, '名字里已经有货号，不该打开规格编码弹层');
      assert.equal(btn.textContent, '已复制', '按钮没有变「已复制」：' + btn.textContent);
      const t = A.toasts[A.toasts.length - 1];
      assert.equal(t.opts.source, '货号复制', 'source 不对：' + t.opts.source);
      // 三段式 + 绿点（2026-10-31 用户定）：与抖店/中控台「货号复制」同一套口径
      assert.equal(t.type, 'success', '成功消息应是 success（绿点）：' + t.type);
      pass++; console.log('  ✓ 名字末尾就有货号：直接复制，没开任何弹层');
    } catch (e) {
      fail++; failures.push('复制货号 —— ' + e.message);
      console.log('  ✗ 名字末尾就有货号：直接复制，没开任何弹层');
    }
  })();

  console.log('\n【四】名字里没写货号 → 读「规格/编码」弹层，只取第一段');
  await (async () => {
    try {
      const before = A.copied.length;
      const btn = rowOf(A.sr, 1).querySelector('[data-dyc-wx-btn]');   // 第 1 行是纯中文名
      btn.click();
      // 等剪贴板真的出现新内容（原先是固定等 1200ms）
      await waitFor(() => A.copied.length > before, 12000);
      await sleep(80);           // 让关弹层与提示收尾
      assert.equal(A.copied.length, before + 1, '没有复制');
      assert.equal(A.copied[A.copied.length - 1], 'NE1C1142W',
        '没切成第一段：' + A.copied[A.copied.length - 1]);
      assert.equal(A.opens.sku, 1, '没有打开规格编码弹层');
      assert.equal(A.doc.querySelectorAll('.sku-popover').length, 0, '弹层没关掉');
      const t = A.toasts[A.toasts.length - 1];
      // 2026-10-31 三段式：中段＝对象（货号本身），结果「已复制」进右端弱位
      assert.equal(t.text, 'NE1C1142W', '中段应只写货号本身：' + t.text);
      assert.equal(t.opts.count, '已复制', '右端尾声应是「已复制」：' + t.opts.count);
      assert.ok(t.text.indexOf('已复制') < 0, '「已复制」是结果，不该混进中段：' + t.text);
      assert.equal(t.type, 'success', '成功消息应是 success（绿点）：' + t.type);
      assert.equal(t.opts.source, '货号复制', '来源词不对：' + t.opts.source);
      pass++; console.log('  ✓ 弹层里的 NE1C1142W-35-38 只复制 NE1C1142W，弹层自动关掉');
    } catch (e) {
      fail++; failures.push('弹层取号 —— ' + e.message);
      console.log('  ✗ 弹层里的 NE1C1142W-35-38 只复制 NE1C1142W，弹层自动关掉');
    }
  })();

  console.log('\n【四·二】同一商品再点一次走缓存，不再开弹层');
  await (async () => {
    try {
      const btn = rowOf(A.sr, 1).querySelector('[data-dyc-wx-btn]');
      const n = A.opens.sku;
      btn.click();
      await sleep(200);
      assert.equal(A.opens.sku, n, '又开了一次弹层（缓存没生效）');
      assert.equal(A.copied[A.copied.length - 1], 'NE1C1142W', '缓存值不对');
      pass++; console.log('  ✓ 第二次点击直接用缓存，弹层不再闪');
    } catch (e) {
      fail++; failures.push('货号缓存 —— ' + e.message);
      console.log('  ✗ 第二次点击直接用缓存，弹层不再闪');
    }
  })();

  console.log('\n【五】一键复制商品链接');
  await (async () => {
    try {
      const before = A.copied.length;
      const btn = rowOf(A.sr, 0).querySelectorAll('[data-dyc-wx-btn]')[1];
      btn.click();
      // 等按钮真的变「已复制」（原先是固定等 1800ms：桥询问 1500 + 首轮轮询 100）
      await waitFor(() => btn.textContent === '已复制', 12000);
      await sleep(80);           // 让复制与关面板的收尾走完
      assert.equal(A.copied.length, before + 1, '剪贴板没有新增');
      assert.equal(A.copied[A.copied.length - 1], LINK, '复制内容不对：' + A.copied[A.copied.length - 1]);
      assert.equal(A.doc.querySelectorAll('.share-popover').length, 0, '分享面板没关掉');
      assert.equal(btn.textContent, '已复制', '按钮没有变「已复制」：' + btn.textContent);
      pass++; console.log('  ✓ 点一下自动开面板、读链接、关面板、写剪贴板');
    } catch (e) {
      fail++; failures.push('复制链接 —— ' + e.message);
      console.log('  ✗ 点一下自动开面板、读链接、关面板、写剪贴板');
    }
  })();

  console.log('\n【五·二】真一键：从页面数据直接读（不点面板）');
  const F = await boot({ withData: true });
  await (async () => {
    try {
      const btn = rowOf(F.sr, 0).querySelectorAll('[data-dyc-wx-btn]')[1];
      btn.click();
      await sleep(120);          // L1 是同步路径，不用等轮询
      assert.equal(F.copied.length, 1, '剪贴板写入 ' + F.copied.length + ' 次');
      // 仿真数据里**别的商品排在前**：按「第一个匹配」取会拿到 OTHER000
      assert.equal(F.copied[0], LINK, '取到的不是本商品的链接：' + F.copied[0]);
      assert.equal(F.doc.querySelectorAll('.share-popover').length, 0, '不该打开分享面板');
      assert.equal(btn.textContent, '已复制', '按钮没有变「已复制」：' + btn.textContent);
      pass++; console.log('  ✓ 从组件数据按商品 ID 取链接：零点击、面板没开、没取错商品');
    } catch (e) {
      fail++; failures.push('真一键（L1） —— ' + e.message);
      console.log('  ✗ 从组件数据按商品 ID 取链接：零点击、面板没开、没取错商品');
    }
  })();

  console.log('\n【五·三】货号也走页面数据：与名字不一致时以 SKU 为准');
  await (async () => {
    try {
      // 数据里的 SKU 是 LX90-1-2，名字末尾写的是 NE1C1162W0 —— 必须取 LX90
      const codeBtn = rowOf(F.sr, 0).querySelector('[data-dyc-wx-btn]');
      codeBtn.click();
      await sleep(150);
      assert.equal(F.copied[F.copied.length - 1], 'LX90',
        '没以页面数据里的 SKU 为准：' + F.copied[F.copied.length - 1]);
      assert.equal(F.opens.sku, 0, '数据里已有 SKU 编码，不该开弹层');
      pass++; console.log('  ✓ 零点击取到 LX90（SKU 编码第一段），弹层没开');
    } catch (e) {
      fail++; failures.push('L1 取货号 —— ' + e.message);
      console.log('  ✗ 零点击取到 LX90（SKU 编码第一段），弹层没开');
    }
  })();
  F.dom.window.close();

  console.log('\n【五·四】名字末尾本身带分隔号时，也要切成第一段');
  const G = await boot({ rows: 3, rowNames: ['测试商品 NE1C1142W-35-38'] });
  await (async () => {
    try {
      rowOf(G.sr, 0).querySelector('[data-dyc-wx-btn]').click();
      await sleep(80);
      assert.equal(G.copied[0], 'NE1C1142W', '没按分隔号切：' + G.copied[0]);
      assert.equal(G.opens.sku, 0, '名字里已能取到，不该开弹层');
      pass++; console.log('  ✓ 名字写的是 NE1C1142W-35-38，复制的是 NE1C1142W');
    } catch (e) {
      fail++; failures.push('名字带分隔号 —— ' + e.message);
      console.log('  ✗ 名字写的是 NE1C1142W-35-38，复制的是 NE1C1142W');
    }
  })();
  G.dom.window.close();

  console.log('\n【五·五】几个 SKU 的第一段不一致时，取出现最多的那个');
  const H = await boot({
    rows: 3,
    rowNames: [NAME_NO_CODE],
    skuCodes: ['AB11-1-1', 'AB11-1-2', 'CD22-2-2']
  });
  await (async () => {
    try {
      rowOf(H.sr, 0).querySelector('[data-dyc-wx-btn]').click();
      // 等剪贴板出现内容（原先是固定等 1000ms）
      await waitFor(() => H.copied.length > 0, 12000);
      assert.equal(H.copied[0], 'AB11', '没取出现最多的：' + H.copied[0]);
      pass++; console.log('  ✓ 三个 SKU 里 AB11 出现两次 → 取 AB11，不取 CD22');
    } catch (e) {
      fail++; failures.push('多 SKU 不一致 —— ' + e.message);
      console.log('  ✗ 三个 SKU 里 AB11 出现两次 → 取 AB11，不取 CD22');
    }
  })();
  H.dom.window.close();

  console.log('\n【五·六】数据里多个 SKU 不一致时，优先与名字一致的那个');
  const I = await boot({
    rows: 3,
    withData: true,
    rowNames: ['测试商品 CD22'],
    dataSku: ['AB11-1-1', 'AB11-1-2', 'CD22-2-2']
  });
  await (async () => {
    try {
      rowOf(I.sr, 0).querySelector('[data-dyc-wx-btn]').click();
      await sleep(120);
      assert.equal(I.copied[0], 'CD22', '没优先取与名字一致的那个：' + I.copied[0]);
      assert.equal(I.opens.sku, 0, '数据里已有 SKU 编码，不该开弹层');
      pass++; console.log('  ✓ AB11 出现两次，仍按商品名取 CD22');
    } catch (e) {
      fail++; failures.push('优先名字 —— ' + e.message);
      console.log('  ✗ AB11 出现两次，仍按商品名取 CD22');
    }
  })();
  I.dom.window.close();

  console.log('\n【五·七】纯数字货号（6 位以上）也要能取到');
  const J = await boot({ rows: 3, rowNames: [NAME_NO_CODE], skuCodes: ['12345678-1-1'] });
  await (async () => {
    try {
      rowOf(J.sr, 0).querySelector('[data-dyc-wx-btn]').click();
      // 等剪贴板出现内容（原先是固定等 1000ms）
      await waitFor(() => J.copied.length > 0, 12000);
      assert.equal(J.copied[0], '12345678', '纯数字编码没取到：' + J.copied[0]);
      pass++; console.log('  ✓ 12345678-1-1 → 12345678');
    } catch (e) {
      fail++; failures.push('纯数字货号 —— ' + e.message);
      console.log('  ✗ 12345678-1-1 → 12345678');
    }
  })();
  J.dom.window.close();

  console.log('\n【五·八】主世界桥：按商品 ID 从页面数据取链接（不点面板）');
  const BR = await boot({ bridge: true });
  await (async () => {
    try {
      assert.equal(BR.errorBridge, null, '桥脚本抛错：' + (BR.errorBridge && BR.errorBridge.message));
      const btn = rowOf(BR.sr, 0).querySelectorAll('[data-dyc-wx-btn]')[1];
      btn.click();
      await sleep(400);
      assert.equal(BR.copied.length, 1, '剪贴板写入 ' + BR.copied.length + ' 次');
      // 数据里**别的商品排在前**：按「第一个匹配」取会拿到 OTHER000
      assert.equal(BR.copied[0], LINK, '取到的不是本商品的链接：' + BR.copied[0]);
      assert.equal(BR.doc.querySelectorAll('.share-popover').length, 0, '不该打开分享面板');
      const t = BR.toasts[BR.toasts.length - 1];
      // 三段式：`商品链接 ｜ NE1C1162W0 ｜ 已复制`
      assert.equal(t.text, 'NE1C1162W0', '条上中段应只写货号：' + t.text);
      assert.equal(t.opts.count, '已复制', '右端尾声应是「已复制」：' + t.opts.count);
      assert.ok(t.text.indexOf('已复制') < 0, '「已复制」不该混进中段：' + t.text);
      assert.equal(t.type, 'success', '成功消息应是 success（绿点）：' + t.type);
      assert.equal(t.opts.source, '商品链接', '来源词不对：' + t.opts.source);
      // 盒子里中段换成商品全名 —— 同样是「对象」，只是叫法更全
      assert.equal(t.opts.full, NAME_WITH_CODE + '0',
        '盒子中段应是商品全名：' + t.opts.full);
      assert.ok(t.opts.full.indexOf('已复制') < 0,
        '盒子中段也不该带「已复制」：' + t.opts.full);
      assert.ok(t.opts.full.indexOf('商品链接') < 0,
        '盒子中段不该重复来源词：' + t.opts.full);
      assert.ok(t.opts.full.indexOf('ID ') < 0, '盒子不该再挂商品 ID：' + t.opts.full);
      pass++; console.log('  ✓ 桥精确取链接：零点击、面板没开、没取错商品');
    } catch (e) {
      fail++; failures.push('主世界桥 —— ' + e.message);
      console.log('  ✗ 桥精确取链接：零点击、面板没开、没取错商品');
    }
  })();
  BR.dom.window.close();

  console.log('\n【五·九】桥早于本脚本注入（document_start 直注）时仍能应答');
  const BE = await boot({ bridge: true, bridgeEarly: true });
  await (async () => {
    try {
      assert.equal(BE.errorBridge, null, '桥脚本抛错：' + (BE.errorBridge && BE.errorBridge.message));
      // 桥发 ready 时本脚本还没开始监听 ⇒ 收不到 ready。靠「直接问」才拿得到结果。
      // 这正是真机形态：manifest 用 world:MAIN + document_start 直注桥。
      const btn = rowOf(BE.sr, 0).querySelectorAll('[data-dyc-wx-btn]')[1];
      btn.click();
      await sleep(400);
      assert.equal(BE.copied.length, 1, '剪贴板写入 ' + BE.copied.length + ' 次');
      assert.equal(BE.copied[0], LINK, '取到的不是本商品的链接：' + BE.copied[0]);
      assert.equal(BE.doc.querySelectorAll('.share-popover').length, 0, '不该打开分享面板');
      pass++; console.log('  ✓ 没收到 ready 也能取到链接（不等 ready，直接问）');
    } catch (e) {
      fail++; failures.push('早注入桥 —— ' + e.message);
      console.log('  ✗ 没收到 ready 也能取到链接（不等 ready，直接问）');
    }
  })();
  BE.dom.window.close();

  console.log('\n【五·十】诊断附加段把桥的状态写出来');
  const RP = await boot({});
  check('__DYC_WX_LINK__.reportSection() 有内容且写明桥状态', () => {
    const api = RP.win.__DYC_WX_LINK__;
    assert.ok(api && typeof api.reportSection === 'function', '没有暴露 reportSection');
    const t = api.reportSection();
    assert.ok(/微信商品链接取源/.test(t), '缺少标题：' + t);
    assert.ok(/主世界桥/.test(t), '缺少桥状态：' + t);
    assert.ok(/取链接累计/.test(t), '缺少累计：' + t);
  });
  RP.dom.window.close();

  console.log('\n【五·十一】主动请求微信接口取链接（不点面板、页面也没发过这个请求）');
  const API = await boot({ bridge: true, apiShareUrl: LINK });
  await (async () => {
    try {
      const btn = rowOf(API.sr, 0).querySelectorAll('[data-dyc-wx-btn]')[1];
      btn.click();
      await sleep(600);
      assert.equal(API.copied.length, 1, '剪贴板写入 ' + API.copied.length + ' 次');
      assert.equal(API.copied[0], LINK, '取到的不是本商品的链接：' + API.copied[0]);
      assert.equal(API.doc.querySelectorAll('.share-popover').length, 0, '不该打开分享面板');
      pass++; console.log('  ✓ 按商品 ID 主动查接口拿 shareUrl：零点击、面板没开');
    } catch (e) {
      fail++; failures.push('主动查接口 —— ' + e.message);
      console.log('  ✗ 按商品 ID 主动查接口拿 shareUrl：零点击、面板没开');
    }
  })();
  API.dom.window.close();

  console.log('\n【五·十二】条上用货号指认商品：先点过货号就沿用缓存那个');
  // MIN_ROWS=3：列表少于 3 行会被当成「不是商品表」，所以这里给 3 行、只用第 0 行
  const NM = await boot({ rows: 3, rowNames: [NAME_NO_CODE], bridge: true });
  await (async () => {
    try {
      const btns = rowOf(NM.sr, 0).querySelectorAll('[data-dyc-wx-btn]');
      btns[0].click();                       // 名字里没货号 → 走弹层，取到 NE1C1142W 并缓存
      await sleep(1200);
      assert.equal(NM.copied[NM.copied.length - 1], 'NE1C1142W', '货号没取到');
      btns[1].click();                       // 再取链接
      await sleep(400);
      const t = NM.toasts[NM.toasts.length - 1];
      assert.equal(t.text, 'NE1C1142W',
        '条上中段应沿用已缓存的货号：' + t.text);
      assert.equal(t.opts.count, '已复制', '右端尾声应是「已复制」：' + t.opts.count);
      pass++; console.log('  ✓ 货号已缓存 → 段面「商品链接 ｜ NE1C1142W ｜ 已复制」');
    } catch (e) {
      fail++; failures.push('条上复用缓存货号 —— ' + e.message);
      console.log('  ✗ 货号已缓存 → 段面「商品链接 ｜ NE1C1142W ｜ 已复制」');
    }
  })();
  NM.dom.window.close();

  console.log('\n【五·十三】取不到货号 → 回到最初的「已复制商品链接」，不猜商品名');
  const NF = await boot({ rows: 3, rowNames: [NAME_NO_CODE], bridge: true });
  await (async () => {
    try {
      rowOf(NF.sr, 0).querySelectorAll('[data-dyc-wx-btn]')[1].click();
      await sleep(400);
      assert.equal(NF.copied[0], LINK, '链接没取到：' + NF.copied[0]);
      const t = NF.toasts[NF.toasts.length - 1];
      // 用户 2026-10-31：取不到货号就按最初的样子只说结果，不再拿商品名凑
      assert.equal(t.text, '已复制商品链接', '无货号时应只说结果：' + t.text);
      pass++; console.log('  ✓ 无货号 → 「已复制商品链接」，不猜商品名');
    } catch (e) {
      fail++; failures.push('无货号时的链接消息 —— ' + e.message);
      console.log('  ✗ 无货号 → 「已复制商品链接」，不猜商品名');
    }
  })();
  NF.dom.window.close();

  console.log('\n【六】面板里没有链接时不复制半截内容');
  const B = await boot({ panelLink: '' });
  await (async () => {
    try {
      const before = B.copied.length;
      const btn = rowOf(B.sr, 0).querySelectorAll('[data-dyc-wx-btn]')[1];
      btn.click();
      // 等按钮落到「取不到」（原先是固定等 4300ms：桥询问 1500 + 面板 24 轮 2400，
      // 余量仅 400ms —— 并发时实测 5 轮红 2 轮）。上限 15s 只是防呆，不参与断言。
      await waitFor(() => btn.textContent === '取不到', 15000, 100);
      await sleep(120);          // 让最后一条提示落到状态条
      assert.equal(B.copied.length, before, '取不到时不该复制任何东西');
      assert.equal(btn.textContent, '取不到', '按钮应显示「取不到」：' + btn.textContent);
      const t = B.toasts[B.toasts.length - 1];
      assert.equal(t.type, 'warning', '应该是 warning 级提示');
      assert.ok(/分享/.test(t.text), '提示应指路「点分享手动复制」：' + t.text);
      pass++; console.log('  ✓ 取不到链接时只提示，不复制、不假装成功');
    } catch (e) {
      fail++; failures.push('链接取不到 —— ' + e.message);
      console.log('  ✗ 取不到链接时只提示，不复制、不假装成功');
    }
  })();
  B.dom.window.close();

  console.log('\n【六·二】名字没有、弹层也读不到 → 只提示，不复制半截');
  const E = await boot({ rows: 4, rowNames: ['纯中文商品名没有款号'], skuCodes: [] });
  await (async () => {
    try {
      const btn = rowOf(E.sr, 0).querySelector('[data-dyc-wx-btn]');
      btn.click();
      // 等按钮落到「无货号」（原先是固定等 2900ms：弹层 25 轮 2500，余量 400ms）
      await waitFor(() => btn.textContent === '无货号', 15000, 100);
      await sleep(120);          // 让最后一条提示落到状态条
      assert.equal(E.copied.length, 0, '取不到时不该复制任何东西');
      assert.equal(btn.textContent, '无货号', '按钮应显示「无货号」：' + btn.textContent);
      const t = E.toasts[E.toasts.length - 1];
      assert.equal(t.type, 'warning', '应该是 warning 级提示');
      assert.equal(t.text, '这一行没找到货号', '取不到时的提示文案不对：' + t.text);
      pass++; console.log('  ✓ 两条路都取不到时只提示，剪贴板不动');
    } catch (e) {
      fail++; failures.push('无货号 —— ' + e.message);
      console.log('  ✗ 两条路都取不到时只提示，剪贴板不动');
    }
  })();
  E.dom.window.close();

  console.log('\n【七】关开关后按钮移除、flex-wrap 还原');
  await (async () => {
    try {
      const cb = A.getWatchCb();
      assert.ok(cb, '没有订阅开关变化');
      cb({ wxRowCopy: false });
      await sleep(80);
      assert.equal(btns(A.sr).length, 0, '还有 ' + btns(A.sr).length + ' 个按钮没移除');
      const meta = rowOf(A.sr, 0).querySelector('.item-info');
      assert.equal(meta.style.flexWrap, '', 'flex-wrap 没还原：' + meta.style.flexWrap);
      const off = A.toasts[A.toasts.length - 1];
      assert.equal(off.text, '已关闭', '关闭没有报消息');
      pass++; console.log('  ✓ 按钮全移除、flex-wrap 还原、报一条「已关闭」');
    } catch (e) {
      fail++; failures.push('关开关还原 —— ' + e.message);
      console.log('  ✗ 按钮全移除、flex-wrap 还原、报一条「已关闭」');
    }
  })();
  A.dom.window.close();

  /* ========== 非商品列表页 ========== */
  console.log('\n【八】非商品列表页不插按钮');
  const C = await boot({ url: 'https://store.weixin.qq.com/shop/home' });
  check('店铺首页的表格不动', () => {
    assert.equal(btns(C.sr).length, 0, '插了 ' + btns(C.sr).length + ' 个按钮');
  });
  C.dom.window.close();

  /* ========== 开关关闭态 ========== */
  console.log('\n【九】开关关闭时不动作');
  const D = await boot({ enabled: false });
  check('关闭态一个按钮都不插、也不报消息', () => {
    assert.equal(btns(D.sr).length, 0, '插了 ' + btns(D.sr).length + ' 个');
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
