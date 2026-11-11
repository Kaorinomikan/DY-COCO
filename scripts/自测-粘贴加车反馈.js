const fs = require('fs'), vm = require('vm'), assert = require('assert');

/* 只替换入口调用，把内部函数暴露给用例；不改被测文件本身。
   ★ 满载兜底必须打到真实的 bindPromotions + isCartFullText（用 bindRaw 喂平台原始 JSON），
   不能整体 mock 掉 bindPromotions —— 那样「识别平台文案」这段逻辑等于没测（假绿）。 */
let source = fs.readFileSync('src/live/cart-paste.js', 'utf8');
source = source.replace('  dycReadFlags().then', [
  '  window.test = {',
  '  state: { bindCalls: 0 },',
  '  onClick,',
  '  attach(b) { btn = b; },',
  '  mock(cfg) {',
  '    window.test.state.bindCalls = 0;',
  '    if (!window.test._bind) window.test._bind = bindPromotions;',
  '    if (!window.test._pageFetch) window.test._pageFetch = pageFetch;',
  '    readClipboard = cfg.read;',
  "    findEwid = () => 'test';",
  '    fetchCartIdSet = async () => cfg.cart || ({ set: new Set(), order: [] });',
  '    searchMyShop = async () => ({ matches: cfg.matches || [{ promotion_id: "1", product_id: "1", title: "ABC123" }] });',
  '    bindPromotions = window.test._bind;',
  '    pageFetch = window.test._pageFetch;',
  '    if (cfg.bindRaw) {',
  '      const resp = cfg.bindRaw;',
  '      pageFetch = async () => {',
  '        window.test.state.bindCalls++;',
  '        return { status: 200, text: JSON.stringify(resp) };',
  '      };',
  '    } else if (cfg.bind) {',
  '      bindPromotions = async (_, p) => {',
  '        window.test.state.bindCalls++;',
  '        return cfg.bind(p);',
  '      };',
  '    } else {',
  '      bindPromotions = async (_, p) => {',
  '        window.test.state.bindCalls++;',
  '        return { ok: true, added: p, failedItems: [], full: false };',
  '      };',
  '    }',
  '    clickRefreshList = () => {};',
  '    sleep = async () => {};',
  '  }',
  '};',
  '  dycReadFlags().then'
].join('\n'));

(async () => {
  const status = [];
  const timers = new Map();
  let timerId = 0;
  const c = {
    window: {},
    dycReadFlags: () => new Promise(() => {}),
    dycWatchFlags: () => {},
    setTimeout: (f) => { timers.set(++timerId, f); return timerId; },
    clearTimeout: (i) => { timers.delete(i); },
    document: { querySelectorAll: () => [] },
    toast() {},
    setStatus(m, t, o) { status.push({ m: m, t: t, o: o || {} }); },
    failStatus(m, o) { status.push({ m: m, t: 'error', o: o || {} }); },
    finishStatus(m, o) { status.push({ m: m, t: 'success', o: o || {} }); },
    updateProgress() {},
    debugLog() {}
  };
  /* 款号判据是共享的（src/content/item-code.js 单一真源）——
     必须在被测脚本之前注入同一个上下文，否则 parseCode 里调 dyc* 会 ReferenceError。 */
  vm.runInNewContext(fs.readFileSync('src/content/item-code.js', 'utf8'), c);
  vm.runInNewContext(source, c);

  /* 造一个装满 n 个的购物车；firstId 放在第 1 位，用来验「已在车内」优先于「车满」 */
  const cartOf = (n, firstId) => {
    const order = [];
    for (let i = 0; i < n; i++) order.push(i === 0 && firstId ? firstId : ('p' + i));
    return { set: new Set(order), order: order };
  };
  const two = [
    { promotion_id: '1', product_id: '1', title: 'ABC123' },
    { promotion_id: '2', product_id: '2', title: 'ABC123-B' }
  ];

  const scenes = [
    { name: '正常加车', cfg: { read: async () => 'ABC123' },
      btn: '已加车 ✓', kind: 'success', binds: 1 },
    /* 平台拒绝但不是车满 —— 必须仍按普通失败，不能被误认成满载 */
    { name: '平台拒绝(非车满)', cfg: { read: async () => 'ABC123',
        bindRaw: { code: 1, msg: '网络异常,请稍后重试' } },
      btn: '加车失败 !', kind: 'failure', binds: 1 },
    { name: '款号查不到', cfg: { read: async () => 'ABC123', matches: [] },
      btn: '加车失败 !', kind: 'failure', binds: 0 },
    { name: '剪贴板为空', cfg: { read: async () => '' },
      btn: '加车失败 !', kind: 'failure', binds: 0 },
    { name: '剪贴板被拒', cfg: { read: async () => { throw new Error('denied'); } },
      btn: '加车失败 !', kind: 'failure', binds: 0 },
    /* 满载预判：数到 200 个就提示，绝不再发一次注定被驳回的绑定请求 */
    { name: '满载预判', cfg: { read: async () => 'ABC123', cart: cartOf(200) },
      btn: '车已满', kind: 'failure', binds: 0, say: '车满', count: '未加入' },
    /* 车满但商品本来就在车里 → 仍报「已在车内」，不能误报成车满 */
    { name: '满载但已在车内', cfg: { read: async () => 'ABC123', cart: cartOf(200, '1') },
      btn: '已在车内', kind: 'success', binds: 0, countHas: '已在车内' },
    /* 没数准（列表接口挂了）时靠平台原文兜底：走真实 bindPromotions 的识别 */
    { name: '平台报上限兜底', cfg: { read: async () => 'ABC123',
        bindRaw: { code: 1, msg: '购物车商品已达上限,无法添加' } },
      btn: '车已满', kind: 'failure', binds: 1, say: '车满', count: '未加入' },
    /* 逐条失败原因里藏着上限：成功返回 + failure_list，也要认出来 */
    { name: '逐条原因报上限', cfg: { read: async () => 'ABC123', matches: two,
        bindRaw: { code: 0, data: {
          success_count: 1, failure_count: 1,
          failure_list: [{ promotion_id: '2', fail_reason: '商品数量已达上限' }]
        } } },
      btn: '部分加入', kind: 'failure', binds: 1, say: '只加了 1 个', count: '其余未加入' }
  ];

  for (const sc of scenes) {
    status.length = 0;
    const b = { style: {}, setAttribute() {}, textContent: '', innerHTML: '' };
    c.window.test.attach(b);
    c.window.test.mock(sc.cfg);

    const p = c.window.test.onClick({ preventDefault() {}, stopPropagation() {} });
    assert.equal(b.textContent, '读取中', sc.name + ': 按下后应显示读取中');
    assert.equal(b.disabled, true, sc.name + ': 处理中应禁用按钮');
    await p;

    assert.equal(b.textContent, sc.btn, sc.name + ': 按钮文案应为 ' + sc.btn);
    assert.equal(b.disabled, false, sc.name + ': 结束后按钮应恢复可用');
    assert.ok(b.innerHTML.includes('<svg'), sc.name + ': 结果应带图标');
    assert.ok(b.innerHTML.includes(sc.kind === 'success' ? '#16803c' : '#c03532'),
      sc.name + ': 图标颜色应区分成功/失败');
    assert.equal(c.window.test.state.bindCalls, sc.binds,
      sc.name + ': 绑定请求次数应为 ' + sc.binds);

    const last = status[status.length - 1];
    if (sc.say) {
      assert.ok(last && last.m.includes(sc.say), sc.name + ': 提示应说明原因(含「' + sc.say + '」)');
      assert.equal(last.t, 'alert', sc.name + ': 满载提示应按异常警示收录');
      assert.ok(last.o.full && last.o.full.includes('200'), sc.name + ': 盒子全文应写明 200 个上限');
      assert.equal(last.o.dropRunning, true, sc.name + ': 满载应顺手收掉「正在加车」过程条');
    }
    if (sc.count) assert.equal(last.o.count, sc.count, sc.name + ': 右段结果词应为 ' + sc.count);
    if (sc.countHas) assert.ok(last.o.count.includes(sc.countHas),
      sc.name + ': 右段结果词应含「' + sc.countHas + '」');

    for (const f of timers.values()) f();
    timers.clear();
    assert.equal(b.textContent, '粘贴加车', sc.name + ': 2.5 秒后按钮应复原');
  }

  console.log('PASS: ' + scenes.length + ' 个场景 —— 正常加车 / 平台拒绝(非车满不误判) /' +
    ' 款号查不到 / 空剪贴板 / 剪贴板被拒 / 满载预判(不发请求) /' +
    ' 满载但已在车内(不误报) / 平台 msg 报上限兜底 / 逐条失败原因报上限');
})().catch((e) => { console.error(e); process.exit(1); });
