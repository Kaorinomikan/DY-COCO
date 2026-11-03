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
const detailStart = CODE.indexOf('  function batchFailureDetails(');
const detailEnd = CODE.indexOf('  /** 批量按钮点击', detailStart);
const formatDetails = require('vm').runInNewContext(CODE.slice(detailStart, detailEnd) + '\nbatchFailureDetails;');
const grouped = formatDetails([{ title: '商品甲', reason: '删除失败' }, { title: '商品乙：特别款', reason: '删除失败' }, { title: '商品丙', reason: '下架失败' }]);
require('assert').strict.equal(grouped.split('删除失败').length - 1, 1);
for (const name of ['商品甲', '商品乙：特别款', '商品丙', '下架失败']) require('assert').strict.ok(grouped.includes(name));
require('assert').strict.equal(formatDetails([{ title: '', reason: '未知错误' }]), '未知错误');
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
        <span>${r.title || ('测试商品' + (i + 1))}</span>
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
  const waits = [];
  if (o.fastWaits) {
    const timer = window.setTimeout.bind(window);
    window.setTimeout = (fn, ms, ...args) => {
      waits.push(ms);
      return timer(fn, ms >= 200 && ms <= 8000 ? 5 : ms, ...args);
    };
  }

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
    logs: [], messages: [], dialogs: [], calls: [], window, dom, waits,
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

      if (o.onRequest) await o.onRequest(url, opts, state);
      if (url.indexOf('list_channel_product') >= 0) {
        if (o.listPage) return { status: 200, text: JSON.stringify({ code: 0, data: o.listPage(url) }) };
        const page = Number(new URL(url, window.location.origin).searchParams.get('page'));
        if (o.listFail && (page === 2 || (o.listFail === 'restart' && new URL(url, window.location.origin).searchParams.get('pageSize') === '10'))) {
          if (o.listFail === 'throw') throw new Error('详情请求超时');
          return { status: 200, text: JSON.stringify({ code: 1001, msg: '详情读取失败' }) };
        }
        if (o.rejectLargePage && page === 2 && new URL(url, window.location.origin).searchParams.get('pageSize') === '20') {
          return { status: 200, text: JSON.stringify({ code: 1001, msg: '页大小被拒' }) };
        }
        const data = o.listPages ? (o.listPages[page - 1] || (o.repeatLastPage ? o.listPages[o.listPages.length - 1] : [])) : rowsDef.map((r) => ({
          main_product_id: '3842997238154527199',
          channel_id: Number(r.id),
          channel_type: typeOf(r.id),
          name: '测试商品',
          status: (offlined.has(String(r.id)) || r.state === '已下架') ? 0 : 2,
          operations: []
        }));
        return { status: 200, text: JSON.stringify({ code: 0, data }) };
      }

      if (opts && opts.body && o.failItem) {
        const body = JSON.parse(opts.body);
        if (String(body.channel_id) === o.failItem.id && url.includes(o.failItem.api)) {
          if (o.failItem.throws) throw new Error('该条请求超时');
          return { status: 200, text: JSON.stringify({ code: 1002, msg: '该条操作被拒绝' }) };
        }
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
    ], { listPages: [
      [{ channel_id: '3387922539085091', channel_type: 4, status: 2 }],
      ...Array.from({ length: 4 }, (_, i) => [{ channel_id: String(3300000000000000 + i), channel_type: 4, status: 0 }]),
      [{ channel_id: '3387660924844069', channel_type: 4, status: 0 }]
    ] });
    await boot(st);
    st.window.document.querySelector('.dyc-cd-batch').click();
    await sleep(20);
    ok(st.dialogs[0] && /批量下架并删除这 \d+ 个渠道品/.test(st.dialogs[0].title),
      '弹「批量下架并删除这 N 个渠道品？」');

    await waitDone(st, 60000);
    ok(offlinePosts(st).length === 1, '只有 1 条需要下架（实际 ' + offlinePosts(st).length + '）');
    ok(deletePosts(st).length === 2, '两条都删了（实际 ' + deletePosts(st).length + '）');
    const done = st.messages.find((m) => m.kind === 'finish');
    ok(!!done && st.messages.filter((m) => m.kind === 'finish').length === 1, '全批只汇总一条结果');
    ok(done && done.op && JSON.stringify(done.op.count.match(/\d+/g)) === '["2"]'
      && JSON.stringify(done.m.match(/\d+/g)) === '["2"]', '对象总数与成功数均为 2');
  }

  console.log('\n=== 翻页查询：第六页的渠道品也能删除 ===');
  {
    const target = { main_product_id: '3842997238154527199', channel_id: '3387660924844069', channel_type: 4, status: 0 };
    const pages = Array.from({ length: 5 }, (_, page) => Array.from({ length: 20 }, (_, i) => ({
      channel_id: String(3300000000000000 + page * 20 + i), channel_type: 4, status: 0
    })));
    pages.push([target]);
    const st = setup([{ id: target.channel_id, state: '已下架' }], { listPages: pages });
    await boot(st);
    st.window.document.querySelector('.dyc-cd-btn').click();
    await waitDone(st, 3000);
    ok(st.calls.filter((c) => c.method === 'GET').length === 6, '继续查询第六页');
    ok(deletePosts(st).length === 1 && st.messages.some((m) => m.kind === 'finish'), '第六页目标走真实删除链路并报成功');
    ok(deletePosts(st).every((c) => String(JSON.parse(c.body).channel_id) === target.channel_id), '只删除勾选目标');
    st.window.close();
  }

  console.log('\n=== 接口缩小页大小、重复页与缺失目标 ===');
  for (const mode of ['small', 'fallback', 'repeat', 'missing']) {
    const target = { channel_id: '3387660924844069', channel_type: 4, status: 0 };
    const other = { channel_id: '3300000000000000', channel_type: 4, status: 0 };
    const st = setup([{ id: target.channel_id, state: '已下架' }], {
      listPages: /small|fallback/.test(mode) ? [[other], [target]] : [[other]],
      repeatLastPage: mode === 'repeat', rejectLargePage: mode === 'fallback'
    });
    await boot(st);
    st.window.document.querySelector('.dyc-cd-btn').click();
    await waitDone(st, 3000);
    ok(st.calls.filter((c) => c.method === 'GET').length === (mode === 'fallback' ? 4 : 2), mode + '：查到目标、空页或重复页即停止');
    if (mode === 'small' || mode === 'fallback') {
      ok(deletePosts(st).length === 1 && st.messages.some((m) => m.kind === 'finish'), '返回条数小于 pageSize 仍继续找到并删除');
    } else {
      const failure = st.messages.find((m) => m.kind === 'fail');
      ok(posts(st).length === 0 && !!failure, mode + '：未找到时不提交写操作');
      ok(failure && /未执行操作/.test(failure.op.full) && !/已被删除/.test(failure.op.full), mode + '：查询缺失不猜测已删除');
    }
    st.window.close();
  }

  console.log('\n=== 批量：中间一条失败仍处理后续并汇总 ===');
  for (const mode of ['offline', 'remove', 'throw', 'missing', 'listThrow', 'listReject', 'listRestartFail']) {
    const rows = [0, 1, 2].map((i) => ({ id: String(3387660924844060 + i), state: '售卖中' }));
    const isReadFailure = mode.startsWith('list');
    const opts = { fastWaits: true };
    if (isReadFailure || mode === 'missing') {
      opts.listPages = [[rows[0], rows[2]].map((r) => ({ channel_id: r.id, channel_type: 4, status: 2 }))];
      if (isReadFailure) opts.listFail = mode === 'listThrow' ? 'throw' : mode === 'listRestartFail' ? 'restart' : 'reject';
    } else {
      opts.failItem = { id: rows[1].id, api: mode === 'offline' ? 'update_channel_product_status' : 'remove_channel_product', throws: mode === 'throw' };
    }
    const st = setup(rows, opts);
    await boot(st);
    st.window.document.querySelector('.dyc-cd-batch').click();
    await waitDone(st, 3000);
    const deleted = deletePosts(st).map((c) => String(JSON.parse(c.body).channel_id));
    ok(deleted.includes(rows[0].id) && deleted.includes(rows[2].id), mode + '：前后两条都执行删除');
    const result = st.messages.find((m) => m.kind === 'fail');
    ok(result && JSON.stringify(result.op.count.match(/\d+/g)) === '["2","1"]'
      && JSON.stringify(result.m.match(/\d+/g)) === '["3"]', mode + '：完成全批后汇总成功与失败');
    ok(result && result.op.details === true && result.op.standalone === true, mode + '：独立摘要保留可展开详情');
    ok(result && /测试商品2/.test(result.op.full), mode + '：汇总包含失败商品');
    ok(st.window.document.querySelectorAll('tr.ecom-g-table-row').length === 1, mode + '：只保留失败行');
    ok(!st.logs.some((l) => /秒后自动刷新/.test(l)), mode + '：有失败时保留页面');
    st.window.close();
  }

  console.log('\n=== 100 条批量：短间隔、完整执行与紧凑预览 ===');
  {
    const rows = Array.from({ length: 100 }, (_, i) => ({
      id: String(3387660924844000 + i), state: '售卖中',
      title: '【高奢女装】设计感撞色针织衫开衫上衣C1939超长商品名称' + i
    }));
    const st = setup(rows, { fastWaits: true });
    await boot(st);
    st.window.document.querySelector('.dyc-cd-batch').click();
    await waitDone(st, 10000);
    const dialog = st.dialogs[0];
    ok(dialog && dialog.fields[0].value === '100 个渠道品', '数量明确为实际执行的 100 条');
    const previews = dialog ? dialog.fields.filter((f) => /^商品[123]$/.test(f.label)) : [];
    ok(previews.length === 3 && previews.every((f) => Array.from(f.value).length <= 18 && f.value.endsWith('…')), '仅三条短商品名预览，各自独立成行');
    ok(dialog && dialog.fields.some((f) => /另有 97 个/.test(f.value)) && dialog.fields.length === 5, '其余 97 条用数量概括，弹窗不随商品数增长');
    ok(st.waits.filter((ms) => ms === 200).length === 99, '100 条之间只安排 99 次 200ms 短间隔');
    ok(!st.waits.includes(8000), '不再每三条额外停八秒');
    ok(offlinePosts(st).length === 100 && deletePosts(st).length === 100, '100 条均执行下架与删除');
    const sequence = posts(st);
    ok(rows.every((r, i) => sequence[2*i] && sequence[2*i+1] &&
      sequence[2*i].url.includes('update_channel_product_status') && sequence[2*i+1].url.includes('remove_channel_product') &&
      String(JSON.parse(sequence[2*i].body).channel_id) === r.id && String(JSON.parse(sequence[2*i+1].body).channel_id) === r.id), '每条先下架再删除，按选择顺序逐条处理');
    ok(st.messages.some((m) => m.kind === 'finish' && JSON.stringify(m.op.count.match(/\d+/g)) === '["100"]' && JSON.stringify(m.m.match(/\d+/g)) === '["100"]'), '汇总选中数与成功数均为 100');
    st.window.close();
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


  console.log('\n=== ⑨ 执行中停止：下架返回、重试、批量与旧确认框 ===');
  async function until(predicate) {
    const deadline = Date.now() + 4000;
    while (!predicate() && Date.now() < deadline) await sleep(10);
    if (!predicate()) throw Error('等待测试状态超时');
  }
  {
    const st = setup([{ id: '3387922539085091', state: '售卖中' }], {
      onRequest: async (url, opts, state) => {
        if (url.includes('update_channel_product_status')) {
          state.window.__DYC_CHANNEL_DEL__.stop();
          state.window.__DYC_CHANNEL_DEL__.start();
        }
      }
    });
    await boot(st);
    st.window.document.querySelector('.dyc-cd-btn').click();
    await waitDone(st, 4000);
    ok(offlinePosts(st).length === 1 && deletePosts(st).length === 0, '下架回包时关闭再开启，旧任务不删除');
    ok(st.messages.some(m => m.op && m.op.count === '已停止后续操作'), '明确说明停止，已提交结果需核对');
    ok(!st.logs.some(l => /秒后自动刷新/.test(l)), '停止的任务不安排刷新');
    st.dom.window.close();
  }
  {
    const st = setup([{ id: '3387922539085091', state: '已下架' }], { fail: { removeOnce: true } });
    await boot(st);
    st.window.document.querySelector('.dyc-cd-btn').click();
    await until(() => st.logs.some(l => /秒后重试/.test(l)));
    st.window.__DYC_CHANNEL_DEL__.stop();
    await waitDone(st, 4000);
    ok(deletePosts(st).length === 1, '重试等待中关闭，不再提交删除');
    ok(!st.messages.some(m => m.kind === 'finish'), '停止不误报成功');
    st.dom.window.close();
  }
  {
    const st = setup([
      { id: '3387922539085091', state: '已下架' },
      { id: '3387660924844069', state: '已下架' }
    ], {
      // 批量已压到 200ms 间隔，不再有可等的时间窗；改为第一条写请求发出时关闭，
      // 验证后续条目不再提交、也不误报整批完成。
      onRequest: async (url, opts, state) => {
        if (url.includes('remove_channel_product') && !state.batchStopped) {
          state.batchStopped = true;
          state.window.__DYC_CHANNEL_DEL__.stop();
        }
      }
    });
    await boot(st);
    st.window.document.querySelector('.dyc-cd-batch').click();
    await waitDone(st, 6000);
    ok(deletePosts(st).length === 1, '批量处理中关闭，不再处理下一条');
    ok(!st.messages.some(m => m.kind === 'finish'), '批量停止不误报全部完成');
    st.dom.window.close();
  }
  {
    const st = setup([{ id: '3387922539085091', state: '已下架' }], { autoConfirm: false });
    await boot(st);
    st.window.document.querySelector('.dyc-cd-btn').click();
    st.window.__DYC_CHANNEL_DEL__.stop();
    st.window.__DYC_CHANNEL_DEL__.start();
    st.dialogs[0].onConfirm();
    await sleep(30);
    ok(st.calls.length === 0, '关闭前弹出的确认框，重开后不能提交');
    st.dom.window.close();
  }
  {
    const st = setup([{ id: '3387922539085091', state: '售卖中' }], {
      onRequest: async (url, opts, state) => {
        if (url.includes('update_channel_product_status')) state.window.history.pushState({}, '', '/ffa/g/list');
      }
    });
    await boot(st);
    st.window.document.querySelector('.dyc-cd-btn').click();
    await waitDone(st, 4000);
    ok(deletePosts(st).length === 0, 'SPA 切页后旧任务不再删除');
    st.dom.window.close();
  }
  {
    const st = setup([{ id: '3387922539085091', state: '已下架' }]);
    const timeouts = new Map();
    const realSetTimeout = st.window.setTimeout.bind(st.window);
    const realClearTimeout = st.window.clearTimeout.bind(st.window);
    st.window.setTimeout = (fn, delay) => { const id = realSetTimeout(fn, delay); timeouts.set(id, delay); return id; };
    st.window.clearTimeout = id => { timeouts.delete(id); realClearTimeout(id); };
    await boot(st);
    st.window.document.querySelector('.dyc-cd-btn').click();
    await waitDone(st, 4000);
    ok([...timeouts.values()].includes(1500), '成功后存在刷新定时器');
    st.window.__DYC_CHANNEL_DEL__.stop();
    ok(![...timeouts.values()].includes(1500), '关闭时取消已安排的刷新');
    st.dom.window.close();
  }
  console.log('\n=== ⑩ 查询第六页与重复页保护 ===');
  {
    const id = '3387922539085091';
    const st = setup([{ id, state: '已下架' }], {
      listPage: url => {
        const page = Number(new URL(url, 'https://example.test').searchParams.get('page'));
        return Array.from({ length: 20 }, (_, i) => ({ channel_id: page === 6 && i === 0 ? id : String(page * 100 + i), channel_type: 4, status: 0 }));
      }
    });
    await boot(st);
    st.window.document.querySelector('.dyc-cd-btn').click();
    await waitDone(st, 4000);
    ok(st.calls.filter(c => c.method === 'GET').length === 6, '继续查询到第六页');
    ok(deletePosts(st).length === 1 && st.messages.some(m => m.kind === 'finish'), '第六页目标可正常删除');
    st.dom.window.close();
  }
  {
    const st = setup([{ id: '3387922539085091', state: '已下架' }], {
      listPage: () => Array.from({ length: 20 }, (_, i) => ({ channel_id: String(i + 1), channel_type: 4, status: 0 }))
    });
    await boot(st);
    st.window.document.querySelector('.dyc-cd-btn').click();
    await waitDone(st, 4000);
    ok(st.calls.length === 2 && posts(st).length === 0, '重复返回同一页及时中止，不提交写请求');
    ok(st.messages.some(m => /查询未完成/.test(m.op && m.op.full || '')), '如实提示查询未完成');
    st.dom.window.close();
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
