const fs = require('fs'), vm = require('vm'), assert = require('assert'), path = require('path');

const SRC_UNDER_TEST = 'src/content/shop-paste.js';

/* 只替换入口调用，把内部函数暴露给用例；不改被测文件本身。
   ★ 必须走真实的 parseLinks / resolveOne / bindBatch，只 mock「网络出口」——
   把这两个函数整体 mock 掉，等于「解析与绑定逻辑没测」（假绿）。 */
let source = fs.readFileSync(path.resolve(__dirname, '..', SRC_UNDER_TEST), 'utf8');
source = source.replace('  dycReadFlags().then', [
  '  window.test = {',
  '  state: { bindCalls: 0, batches: [], resolveCalls: 0 },',
  '  onClick,',
  '  attach(b) { btn = b; },',
  '  mock(cfg) {',
  '    window.test.state.bindCalls = 0;',
  '    window.test.state.batches = [];',
  '    window.test.state.resolveCalls = 0;',
  '    readClipboard = cfg.read;',
  '    findEwid = cfg.ewid === undefined ? () => "test-ewid" : () => cfg.ewid;',
  '    clickRefreshGoods = () => {};',
  '    findRowByTitle = () => null;',
  '    sleep = async () => {};',
  '    pageFetch = async (url, opts) => {',
  '      if (url.indexOf("/pc/selection_tool/batch_link") >= 0) {',
  '        window.test.state.resolveCalls++;',
  '        const m = /[?&]urls=([^&]+)/.exec(url);',
  '        const decoded = m ? decodeURIComponent(m[1]) : "";',
  '        const idm = /[?&]id=(\\d{10,})/.exec(decoded);',
  '        const id = idm ? idm[1] : "";',
  '        const r = (cfg.resolve || ((pid) => ({ code: 0, data: { batch_shop_manage_promotions: [',
  '          { promotion_id: "pm" + pid, product_id: pid, title: "商品" + pid, filter_status: 0 }',
  '        ] } })))(id);',
  '        return { status: 200, text: JSON.stringify(r) };',
  '      }',
  '      if (url.indexOf("/api/shop/bind/") >= 0) {',
  '        window.test.state.bindCalls++;',
  '        const body = JSON.parse(opts.body);',
  '        window.test.state.batches.push(body.pmts.length);',
  '        const r = await (cfg.bind || ((pmts) => ({ code: 0,',
  '          msg: "成功添加" + pmts.length + "件商品至橱窗",',
  '          data: { success_count: pmts.length, failure_count: 0, failure_list: [] } })))(body.pmts, body);',
  '        return { status: 200, text: JSON.stringify(r) };',
  '      }',
  '      throw new Error("未预期的请求 " + url);',
  '    };',
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
    location: { href: 'https://buyin.jinritemai.com/dashboard/shopwindow/goods-list' },
    dycReadFlags: () => new Promise(() => {}),
    dycWatchFlags: () => {},
    setTimeout: (f) => { timers.set(++timerId, f); return timerId; },
    clearTimeout: (i) => { timers.delete(i); },
    document: { querySelectorAll: () => [] },
    toast(m, t, o) { status.push({ m, t, o: o || {}, toast: true }); },
    setStatus(m, t, o) { status.push({ m, t, o: o || {} }); },
    failStatus(m, o) { status.push({ m, t: 'error', o: o || {} }); },
    finishStatus(m, o) { status.push({ m, t: 'success', o: o || {} }); },
    updateProgress(cur, total, m, o) { status.push({ m, t: 'running', o: o || {} }); },
    debugLog() {},
    console
  };
  vm.runInNewContext(source, c);

  const ID = (n) => '38525186180' + String(60000 + n);           // 15 位数字 id
  const LINK = (n) => 'https://haohuo.jinritemai.com/ecommerce/trade/detail/index.html?id=' + ID(n) + '&origin_type=604';
  const join = (arr) => arr.join(' ');

  const scenes = [
    {
      name: '单条成功',
      cfg: { read: async () => '看看这个 ' + LINK(1) + ' 挺好' },
      btn: '已加橱窗', color: '#16803c', binds: 1, batches: [1],
      type: 'success', count: '已加入橱窗', subject: '商品' + ID(1)
    },
    {
      name: '三条一起成功',
      cfg: { read: async () => join([LINK(1), LINK(2), LINK(3)]) },
      btn: '已加橱窗', color: '#16803c', binds: 1, batches: [3],
      type: 'success', count: '已加入橱窗', subject: '3 个商品'
    },
    {
      name: '超过 30 条只处理 30 条',
      cfg: { read: async () => join(Array.from({ length: 35 }, (_, i) => LINK(i + 1))) },
      btn: '已加橱窗', color: '#16803c', binds: 3, batches: [10, 10, 10],
      type: 'success', count: '已加入橱窗', subject: '30 个商品', fullHas: '另有 5 条超过 30 条上限'
    },
    {
      name: '剪贴板里没有链接',
      cfg: { read: async () => '3$Kq2tGx1$ 复制此条口令打开抖音' },
      btn: '失败 !', color: '#c03532', binds: 0, batches: [],
      toastHas: '没认出商品链接'
    },
    {
      name: '剪贴板读不到',
      cfg: { read: async () => { throw new Error('denied'); } },
      btn: '失败 !', color: '#c03532', binds: 0, batches: [],
      toastHas: '读不到剪贴板'
    },
    {
      name: '链接审核未通过',
      cfg: {
        read: async () => LINK(1),
        resolve: () => ({ code: 0, data: { batch_shop_manage_promotions: [
          { promotion_id: '9', product_id: ID(1), title: '商品' + ID(1), filter_status: 2, filter_status_msg: '审核未通过' }
        ] } })
      },
      btn: '失败 !', color: '#c03532', binds: 0, batches: [],
      type: 'alert', count: '未加入', fullHas: '审核未通过'
    },
    {
      name: '已在橱窗不重复加',
      cfg: {
        read: async () => LINK(1),
        bind: (pmts) => ({ code: 0, msg: '', data: { success_count: 0, failure_count: 1,
          failure_list: [{ promotion_id: pmts[0].promotion_id, fail_reason: '商品已在橱窗中' }] } })
      },
      btn: '已加过', color: '#a8642a', binds: 1, batches: [1],
      type: 'warning', count: '已在橱窗'
    },
    {
      name: '部分成功',
      cfg: {
        read: async () => join([LINK(1), LINK(2)]),
        bind: (pmts) => ({ code: 0, msg: '', data: { success_count: 1, failure_count: 1,
          failure_list: [{ promotion_id: pmts[1].promotion_id, fail_reason: '商品不可添加' }] } })
      },
      btn: '部分加入', color: '#c03532', binds: 1, batches: [2],
      type: 'warning', count: '加入 1、未加入 1', fullHas: '商品不可添加'
    },
    {
      name: '绑定接口报错',
      cfg: { read: async () => LINK(1), bind: () => ({ code: 1, msg: '系统繁忙,请稍后重试' }) },
      btn: '失败 !', color: '#c03532', binds: 1, batches: [1],
      type: 'alert', count: '未加入', fullHas: '系统繁忙'
    },
    {
      name: '拿不到 ewid',
      cfg: { read: async () => LINK(1), ewid: '' },
      btn: '失败 !', color: '#c03532', binds: 0, batches: [],
      type: 'error', count: undefined
    }
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

    assert.equal(b.textContent, sc.btn, sc.name + ': 按钮结果应为 ' + sc.btn);
    assert.equal(b.disabled, false, sc.name + ': 结束后按钮应恢复可用');
    assert.ok(b.innerHTML.includes('<svg'), sc.name + ': 结果应带图标');
    assert.ok(b.innerHTML.includes(sc.color), sc.name + ': 图标颜色应为 ' + sc.color);
    assert.equal(c.window.test.state.bindCalls, sc.binds,
      sc.name + ': 绑定请求批次数应为 ' + sc.binds);
    assert.deepEqual(c.window.test.state.batches, sc.batches,
      sc.name + ': 每批条数应为 ' + JSON.stringify(sc.batches));

    if (sc.toastHas) {
      const t = status[status.length - 1];
      assert.ok(t && t.toast, sc.name + ': 应以 toast 提示');
      assert.ok(t.m.includes(sc.toastHas), sc.name + ': 提示应含「' + sc.toastHas + '」');
    }
    if (sc.type) {
      const last = status[status.length - 1];
      assert.ok(last && !last.toast, sc.name + ': 应有结果消息');
      assert.equal(last.t, sc.type, sc.name + ': 消息类型应为 ' + sc.type);
      if (sc.count !== undefined) {
        assert.equal(last.o.count, sc.count, sc.name + ': 右段结果词应为 ' + sc.count);
      }
      assert.equal(last.o.source, '粘贴加橱窗', sc.name + ': 消息必须带来源');
      if (sc.subject) assert.equal(last.m, sc.subject, sc.name + ': 值段应为 ' + sc.subject);
      if (sc.fullHas) {
        assert.ok(last.o.full && last.o.full.includes(sc.fullHas),
          sc.name + ': 盒子全文应含「' + sc.fullHas + '」');
      }
    }

    for (const f of timers.values()) f();
    timers.clear();
    assert.equal(b.textContent, '粘贴加橱窗', sc.name + ': 2.5 秒后按钮应复原');
  }

  /* 连点闸:同一次处理还在进行中,第二次点击必须直接返回,不能重复提交 */
  {
    status.length = 0;
    const b = { style: {}, setAttribute() {}, textContent: '', innerHTML: '' };
    let release = null;
    c.window.test.attach(b);
    c.window.test.mock({
      read: async () => LINK(7),
      bind: (pmts) => new Promise((r) => {
        release = () => r({ code: 0, msg: '', data: { success_count: pmts.length, failure_count: 0, failure_list: [] } });
      })
    });
    const p1 = c.window.test.onClick({ preventDefault() {}, stopPropagation() {} });
    const p2 = c.window.test.onClick({ preventDefault() {}, stopPropagation() {} });
    await new Promise((r) => setImmediate(r));
    await p2;
    assert.equal(c.window.test.state.bindCalls, 1, '连点:处理中再点不应再提交');
    assert.ok(release, '连点:应当有一次绑定请求在飞');
    release();
    await p1;
    assert.equal(c.window.test.state.bindCalls, 1, '连点:整轮结束仍只提交一次');
    assert.equal(b.textContent, '已加橱窗', '连点:结果仍按一次成功报');
    for (const f of timers.values()) f();
    timers.clear();
  }

  console.log('PASS: ' + (scenes.length + 1) + ' 个场景 —— 单条 / 多条 / 超 30 条截断 / 无链接 /' +
    ' 剪贴板被拒 / 审核未过 / 已在橱窗 / 部分成功 / 接口报错 / 无 ewid / 连点只提交一次');
})().catch((e) => { console.error(e); process.exit(1); });
