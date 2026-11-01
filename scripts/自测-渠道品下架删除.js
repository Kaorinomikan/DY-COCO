/**
 * 自测 · 渠道品「下架并删除」（jsdom + 接口垫片）
 * ============================================================
 * 当前形态：**一次点击自动提交两步** —— 先下架，立即提交删除；删除被拒时短间隔重试。
 * 这套自测核对请求顺序、接口结果与 UI 状态，不把平台提示当成成功依据：
 *
 *   ① 注入：售卖中行显示「下架并删除」，已下架行显示「删除该渠道品」
 *   ② 批量按钮：「批量下架并删除」/（全已下架时）「批量删除」
 *   ③ 单条一次点击：2 个 POST（下架→删除），删除请求紧随下架提交，
 *      仅在接口确认成功后提示「已下架并删除」并移除行
 *   ④ 已下架的行：只发 1 个删除请求，不发下架
 *   ⑤ 批量两条：4 个 POST，汇总一条消息
 *   ⑥ 拿不到 __token：一个请求都不发
 *   ⑦ 关开关：按钮全摘
 *
 * 用法：
 *   NODE_PATH=C:/Users/79412/.workbuddy/binaries/node/workspace/node_modules \
 *     node scripts/自测-渠道品下架删除.js
 * 退出码 0 = 全绿；1 = 有用例失败。
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.resolve(__dirname, '..');
const CODE = fs.readFileSync(path.join(ROOT, 'src/content/channel-offline-delete.js'), 'utf8');
const TOKEN = 'c434770ba4f0a3664c83bd6713d5bbb4';
const BURST_MAX_MS = 1500;     // 连发：下架→删除应当很快，不该有长等待

let pass = 0;
const failures = [];

function ok(cond, name) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { failures.push(name); console.log('  ✗ ' + name); }
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

/* ============================================================
 * 场景
 * ============================================================ */

function buildHtml(rowsDef, opts) {
  const o = opts || {};
  const rowHtml = rowsDef.map((r, i) => `
    <tr class="ecom-g-table-row">
      <td><input type="checkbox" ${o.checked === false ? '' : 'checked'}></td>
      <td>
        <span>测试商品${i + 1}</span>
        <span>渠道ID:${r.id}</span>
        <span>主品ID:3842997238154527199</span>
      </td>
      <td class="st">${r.state}</td>
      <td>
        <div class="ops">
          <a href="#">查看</a>
          <a href="#">编辑</a>
          <a href="#">${r.state === '已下架' ? '上架' : '下架'}</a>
          <a href="#">复制</a>
          <a href="#">更多</a>
        </div>
      </td>
    </tr>`).join('');

  return `<!DOCTYPE html><html><head><style>
    .ops a { font-size: 12px; color: rgb(0, 87, 255); display: block; }
  </style></head><body>
    <div class="batchbar">
      <span>${o.batchText || ('已选' + rowsDef.length + '条')}</span>
      <button>批量上架</button>
      <button>批量下架</button>
      <button>批量修改</button>
      <button>更多操作</button>
    </div>
    <table>
      <thead><tr><th>渠道品信息</th><th>渠道类型</th><th>状态</th><th>操作</th></tr></thead>
      <tbody>${rowHtml}</tbody>
    </table>
  </body></html>`;
}

function setup(rowsDef, o) {
  o = o || {};
  const dom = new JSDOM(buildHtml(rowsDef, o), {
    runScripts: 'outside-only',
    pretendToBeVisual: true,
    url: 'https://fxg.jinritemai.com/ffa/g/channel-goods-manage/list'
  });
  const { window } = dom;

  window.performance.getEntriesByType = function () {
    const q = o.noToken ? '' : ('__token=' + TOKEN);
    return [{ name: 'https://fxg.jinritemai.com/product/tproduct/list_channel_product?page=1&' + q }];
  };

  window.Element.prototype.getBoundingClientRect = function () {
    return { width: 120, height: 24, left: 0, top: 0, right: 120, bottom: 24, x: 0, y: 0 };
  };

  const offlined = new Set();
  const typeOf = (id) => {
    const hit = rowsDef.find((r) => r.id === id);
    return hit && hit.type != null ? hit.type : 4;
  };

  const state = {
    logs: [], messages: [], dialogs: [], calls: [], window, dom,
    autoConfirm: o.autoConfirm !== false
  };

  window.debugLog = (m) => state.logs.push(String(m));
  window.dycReadFlags = () => Promise.resolve({ channelOfflineDelete: true });
  window.dycWatchFlags = () => {};
  window.toast = (m, t, op) => state.messages.push({ kind: 'toast', m, op });
  window.updateProgress = (c, t, m, op) => state.messages.push({ kind: 'progress', m, op });
  window.finishStatus = (m, op) => state.messages.push({ kind: 'finish', m, op });
  window.failStatus = (m, op) => state.messages.push({ kind: 'fail', m, op });
  window.showConfirmDialog = (opts2) => {
    state.dialogs.push(opts2);
    if (state.autoConfirm) setTimeout(() => { if (opts2.onConfirm) opts2.onConfirm(); }, 10);
  };

  window.__DYC_STOCK_PROBE__ = {
    sendRequest: async (url, opts) => {
      state.calls.push({
        url: String(url),
        method: (opts && opts.method) || 'GET',
        body: opts && opts.body,
        ts: Date.now()
      });

      if (url.indexOf('list_channel_product') >= 0) {
        const data = rowsDef.map((r) => ({
          main_product_id: '3842997238154527199',
          channel_id: Number(r.id),
          channel_type: typeOf(r.id),
          name: '测试商品',
          status: (offlined.has(String(r.id)) || r.state === '已下架') ? 0 : 2,
          operations: []
        }));
        return { status: 200, text: JSON.stringify({ code: 0, data }) };
      }

      if (url.indexOf('update_channel_product_status') >= 0) {
        if (o.fail && o.fail.offline) {
          return { status: 200, text: JSON.stringify({ code: 1001, msg: '下架被拒绝' }) };
        }
        try { offlined.add(String(JSON.parse(opts.body).channel_id)); } catch (e) { /* 忽略 */ }
        return { status: 200, text: JSON.stringify({ errno: 0, code: 0, data: true }) };
      }

      if (url.indexOf('remove_channel_product') >= 0) {
        if (o.fail && o.fail.remove) {
          return { status: 200, text: JSON.stringify({ code: 1002, msg: '该渠道品不支持删除' }) };
        }
        // removeOnce：第一次拒（下架状态还没落库），重试成功
        if (o.fail && o.fail.removeOnce && !state.removeTried) {
          state.removeTried = true;
          return { status: 200, text: JSON.stringify({ code: 1003, msg: '当前状态不可删除' }) };
        }
        return { status: 200, text: JSON.stringify({ errno: 0, code: 0, data: true }) };
      }

      return { status: 200, text: '{}' };
    }
  };

  window.eval(CODE);
  return state;
}

async function boot(st) {
  await sleep(30);
  st.window.__DYC_CHANNEL_DEL__.scan();
  await sleep(20);
}

function posts(st) { return st.calls.filter((c) => c.method === 'POST'); }
function offlinePosts(st) { return posts(st).filter((c) => c.url.indexOf('update_channel_product_status') >= 0); }
function deletePosts(st) { return posts(st).filter((c) => c.url.indexOf('remove_channel_product') >= 0); }

function waitDone(st, maxMs) {
  return (async () => {
    const until = Date.now() + (maxMs || 30000);
    while (Date.now() < until) {
      if (st.messages.some((m) => m.kind === 'finish' || m.kind === 'fail')) return;
      await sleep(80);
    }
  })();
}

/* ============================================================
 * 用例
 * ============================================================ */

(async function main() {
  console.log('\n=== ① 注入：文案随状态变 ===');
  {
    const st = setup([
      { id: '3387922539085091', state: '售卖中' },
      { id: '3387660924844069', state: '已下架' }
    ]);
    await boot(st);
    const doc = st.window.document;
    const rows = doc.querySelectorAll('tr.ecom-g-table-row');

    const onlineBtn = rows[0].querySelector('.dyc-cd-btn');
    const offlineBtn = rows[1].querySelector('.dyc-cd-btn');
    ok(onlineBtn && onlineBtn.textContent === '下架并删除', '售卖中的行显示「下架并删除」');
    ok(offlineBtn && offlineBtn.textContent === '删除该渠道品', '已下架的行显示「删除该渠道品」');
    ok(onlineBtn && onlineBtn.parentElement.className === 'ops', '落在操作列容器内');
    ok(onlineBtn && onlineBtn.parentElement.lastElementChild === onlineBtn, '排在「更多」之后');
    ok(onlineBtn && onlineBtn.style.getPropertyValue('margin-top') === '8px', '与上一项留 8px 间隔');
    ok(onlineBtn && /255,\s*77,\s*79|#ff4d4f/i.test(onlineBtn.style.getPropertyValue('color')), '危险红');
    ok(onlineBtn && onlineBtn.style.getPropertyValue('font-size') === '12px', '字号取「查看」项');
  }

  console.log('\n=== ② 批量按钮文案随勾选状态变 ===');
  {
    const st = setup([
      { id: '3387922539085091', state: '售卖中' },
      { id: '3387660924844069', state: '已下架' }
    ]);
    await boot(st);
    const doc = st.window.document;
    let batch = doc.querySelector('.dyc-cd-batch');
    ok(batch && batch.textContent === '批量下架并删除', '有售卖中时叫「批量下架并删除」');
    ok(batch && batch.parentElement.lastElementChild === batch, '排在「更多操作」右侧');
    ok(batch && /255,\s*77,\s*79/.test(batch.style.getPropertyValue('background')), '实心红底');
    ok(batch && batch.style.getPropertyValue('margin-left') === '12px', '右侧留 12px');
    ok(!!doc.getElementById('dyc-cd-style'), 'hover 样式表已注入');

    const boxes = doc.querySelectorAll('tr.ecom-g-table-row input[type=checkbox]');
    boxes[0].checked = false;
    st.window.__DYC_CHANNEL_DEL__.scan();
    batch = doc.querySelector('.dyc-cd-batch');
    ok(batch && batch.textContent === '批量删除', '全已下架时叫「批量删除」');

    doc.querySelector('.batchbar span').textContent = '已选0条';
    boxes[1].checked = false;
    st.window.__DYC_CHANNEL_DEL__.scan();
    const b0 = doc.querySelector('.dyc-cd-batch');
    ok(!!b0, '已选 0 条时按钮仍在（常开）');
    ok(b0 && b0.disabled === true, '未勾选时禁用不可点');
    ok(b0 && /242,\s*243,\s*245/.test(String(b0.style.background)), '未勾选时灰底');
    boxes[1].checked = true;
    doc.querySelector('.batchbar span').textContent = '已选1条';
    st.window.__DYC_CHANNEL_DEL__.scan();
    ok(doc.querySelector('.dyc-cd-batch').disabled === false, '勾选后恢复可点');
  }

  console.log('\n=== ③ 单条：一次点击提交下架 + 删除（删除被拒时重试）===');
  {
    const st = setup([{ id: '3387922539085091', state: '售卖中' }]);
    await boot(st);
    st.window.document.querySelector('.dyc-cd-btn').click();
    await sleep(20);

    ok(st.dialogs.length === 1, '弹确认框');
    ok(st.dialogs[0] && st.dialogs[0].title === '下架并删除这个渠道品？',
      '标题是「下架并删除这个渠道品？」');
    ok(st.dialogs[0] && /自动刷新/.test(st.dialogs[0].warning), '弹窗说明完成后会自动刷新');

    await waitDone(st, 40000);
    const offs = offlinePosts(st);
    const dels = deletePosts(st);
    ok(offs.length === 1, '发了 1 个下架请求');
    ok(dels.length === 1, '也发了 1 个删除请求（不用点第二次）');

    if (offs.length && dels.length) {
      const gap = dels[0].ts - offs[0].ts;
      ok(gap <= BURST_MAX_MS, '两个参数连发（间隔 ' + gap + ' ms ≤ ' + BURST_MAX_MS + '）');
    } else {
      ok(false, '两段请求都发生了');
    }

    const done = st.messages.find((m) => m.kind === 'finish');
    // 段位(2026-10-27 口径):值=商品名、结果进右端弱位,断言按「值 + 结果数」合起来看
    const doneTxt = done ? (String(done.m || '') + ' ｜ ' + String((done.op && done.op.count) || '')) : '';
    ok(!!done && /已下架并删除/.test(doneTxt), '消息：' + doneTxt);
    ok(!!done && done.m === '测试商品1', '值段就是商品名（不是「商品名 + 结果」糊一句）');
    ok(!st.window.document.querySelector('tr.ecom-g-table-row'), '行已摘掉');
    ok(st.logs.some((l) => /秒后自动刷新/.test(l)), '成功后安排了一次自动刷新');
    ok(!/刷新/.test(doneTxt), '结果消息里不提刷新（用户要求不写出来）');
    ok(st.messages.filter((m) => m.kind === 'toast').length === 0,
      '整个流程没有多余 toast（一次操作 = 一条进度 + 一条结果）');
  }

  console.log('\n=== ④ 已下架的行：跳过下架，只发删除 ===');
  {
    const st = setup([{ id: '3387660924844069', state: '已下架' }]);
    await boot(st);
    st.window.document.querySelector('.dyc-cd-btn').click();
    await sleep(20);
    ok(st.dialogs[0] && /删除这个渠道品/.test(st.dialogs[0].title), '直接弹「删除这个渠道品？」');

    await waitDone(st, 25000);
    ok(deletePosts(st).length === 1, '发了 1 个删除');
    ok(offlinePosts(st).length === 0, '没有发下架');
    ok(st.messages.some((m) => m.kind === 'finish'), '报成功');
  }

  console.log('\n=== ⑤ 删除首次被拒（状态没落库）→ 短间隔重试成功 ===');
  {
    const st = setup([{ id: '3387922539085091', state: '售卖中' }], { fail: { removeOnce: true } });
    await boot(st);
    st.window.document.querySelector('.dyc-cd-btn').click();
    await waitDone(st, 30000);

    ok(deletePosts(st).length === 2, '删除了 2 次（首次拒 + 重试，实际 ' + deletePosts(st).length + '）');
    ok(st.messages.some((m) => m.kind === 'finish'), '重试后报成功');
    ok(st.logs.some((l) => /秒后重试/.test(l)), '日志写明重试');
  }

  console.log('\n=== ⑥ 批量两条：各自走完两段 ===');
  {
    const st = setup([
      { id: '3387922539085091', state: '售卖中' },
      { id: '3387660924844069', state: '已下架' }
    ]);
    await boot(st);
    st.window.document.querySelector('.dyc-cd-batch').click();
    await sleep(20);
    ok(st.dialogs[0] && /批量下架并删除这 \d+ 个渠道品/.test(st.dialogs[0].title),
      '弹「批量下架并删除这 N 个渠道品？」');

    await waitDone(st, 60000);
    ok(offlinePosts(st).length === 1, '只有 1 条需要下架（实际 ' + offlinePosts(st).length + '）');
    ok(deletePosts(st).length === 2, '两条都删了（实际 ' + deletePosts(st).length + '）');
    const done = st.messages.find((m) => m.kind === 'finish');
    ok(!!done && /2 个渠道品/.test(done.m), '汇总一条消息：' + (done ? done.m : ''));
    ok(done && done.op && done.op.count === '2/2', '结果数 2/2');
  }

  console.log('\n=== ⑦ 拿不到 __token：一个请求都不发 ===');
  {
    const st = setup([{ id: '3387922539085091', state: '售卖中' }], { noToken: true });
    await boot(st);
    st.window.document.querySelector('.dyc-cd-btn').click();
    await waitDone(st, 15000);

    ok(posts(st).length === 0, '没有发出任何写请求');
    const bad = st.messages.find((m) => m.kind === 'fail');
    ok(bad && /令牌/.test(String(bad.op && bad.op.full || '')), '原因写明没拿到令牌');
  }

  console.log('\n=== ⑧ 开关关闭：按钮全摘 ===');
  {
    const st = setup([{ id: '3387922539085091', state: '售卖中' }]);
    await boot(st);
    ok(!!st.window.document.querySelector('.dyc-cd-btn'), '开启时有按钮');
    st.window.__DYC_CHANNEL_DEL__.stop();
    ok(!st.window.document.querySelector('.dyc-cd-btn'), '行内按钮已移除');
    ok(!st.window.document.querySelector('.dyc-cd-batch'), '批量按钮已移除');
  }

  console.log('\n────────────────────────────');
  if (failures.length) {
    console.log('失败 ' + failures.length + ' 项：');
    failures.forEach((f) => console.log('  - ' + f));
    process.exit(1);
  }
  console.log('全部通过：' + pass + ' 项');
  process.exit(0);
})();
