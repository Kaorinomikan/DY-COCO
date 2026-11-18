'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert/strict');
const { JSDOM } = require('jsdom');
const source = fs.readFileSync(path.join(__dirname, '../src/live/xhs-cart-paste.js'), 'utf8');
const id = '0123456789abcdef01234567';
const otherId = '0123456789abcdef01234568';
const buttonId = 'dyc-xhs-cart-paste';

async function fixture(text, test, api) {
  api = api || {};
  const dom = new JSDOM('<button id="native-add">添加商品</button><div class="goods-card-list"></div>', {
    url: 'https://pgy.xiaohongshu.com/commerce/redlive/live_center_control',
    runScripts: 'outside-only', pretendToBeVisual: true
  });
  const w = dom.window;
  const d = w.document;
  let opens = 0;
  let watcher;
  const messages = [], located = [], sent = [];
  let searchCount = 0;
  w.HTMLElement.prototype.getClientRects = function () { return this.isConnected && !this.hidden ? [{}] : []; };
  w.DYC_PAGE_PATTERNS = { xhsCtrl: /\/commerce\/redlive\// };
  w.dycReadFlags = () => Promise.resolve({});
  w.dycWatchFlags = (fn) => { watcher = fn; };
  w.chrome = { runtime: { sendMessage: (_, cb) => cb({ ok: true, text }) } };
  w.setStatus = (value, type, options) => messages.push({ value, type, ...options });
  w.dycRevealXhsGoodsCard = (card, done) => { located.push(card); done(true); };
  const native = d.getElementById('native-add');
  native.getBoundingClientRect = () => ({ left: 850, right: 938, top: 260, bottom: 292, width: 88 });
  native.addEventListener('click', () => { opens++; });

  function card(productId, action) {
    const el = d.createElement('div');
    el.className = 'goods-card';
    el.innerHTML = '<span>同名商品 ID：</span><span class="goods-card__subtitle-row">商品ID：' + productId +
      '</span><div class="goods-card__action-row">' + (action ? '<button>' + action + '</button>' : '') + '</div>';
    d.querySelector('.goods-card-list').append(el);
    return el;
  }

  const hit = Object.assign({
    goods_id: { new_item_id: id, new_sku_id: 'sku-1', contract_id: 'contract-1' },
    type: 1,
    goods_view_info: { title: '测试商品', image: 'https://img.example/1.jpg' },
    state: {
      choose: false, usable: true, stock_status: true,
      purchasable: true, buyable: true, add_cart: true
    }
  }, api.hit || {});
  if (!api.noProbe) {
    w.__DYC_STOCK_PROBE__ = {
      apiParams: () => Promise.resolve(api.params === undefined
        ? { source: '4', scene_id: '6', plan_id: 'plan-1' } : api.params),
      sendRequest: async (url, opts) => {
        sent.push({ url, opts });
        if (/cps_goods\/search/.test(url)) {
          if (api.searchDelay) await new Promise((r) => setTimeout(r, api.searchDelay));
          searchCount++;
          if (api.search !== undefined) {
            return {
              status: api.searchStatus || 200,
              text: typeof api.search === 'string' ? api.search : JSON.stringify(api.search)
            };
          }
          // 加车成功后平台会把商品池里这条的 choose 置为 true
          const chosen = api.chooseAfterAdd && searchCount > 1;
          const item = chosen
            ? Object.assign({}, hit, { state: Object.assign({}, hit.state, { choose: true }) })
            : hit;
          return {
            status: api.searchStatus || 200,
            text: JSON.stringify({ code: 0, success: true, msg: '', data: { items: [item] } })
          };
        }
        if (/live\/center\/goods\/add/.test(url)) {
          // 平台加车成功后会刷新小黄车；api.noCard 用来模拟「页面没刷新」。
          if (!api.noCard && (api.addReply === undefined || api.addReply.success)) card(id, '下架');
          return {
            status: 200,
            text: JSON.stringify(api.addReply || { code: 0, success: true, msg: '', data: {} })
          };
        }
        return { status: 200, text: '{}' };
      }
    };
  }

  try {
    w.eval(source);
    await Promise.resolve();
    await test({ w, d, card, located, sent, messages, opens: () => opens,
      flags: (enabled) => watcher({ xhsCartPaste: enabled }),
      run: async () => {
        d.getElementById(buttonId).click();
        await new Promise((r) => setTimeout(r, api.settle || 30));
      }
    });
  } finally { w.close(); }
}
async function check(name, fn) {
  await fn();
  console.log('✓ ' + name);
}
(async () => {
  await check('已在车内只定位，不发任何接口请求', () => fixture(id, async (s) => {
    const existed = s.card(id, '下架');
    await s.run();
    assert.deepEqual(s.located, [existed]);
    assert.equal(s.sent.length, 0);
    assert.equal(s.messages.at(-1).count, '已在车内 · 已定位');
  }));

  await check('待上架商品不直提，也不开抽屉', () => fixture(id, async (s) => {
    s.card(id, '上架');
    await s.run();
    assert.equal(s.messages.at(-1).count, '添加失败 · 商品待上架');
    assert.equal(s.sent.length, 0);
    assert.equal(s.opens(), 0);
    assert.equal(s.located.length, 0);
  }));

  await check('不在车内走 search + add 直提，参数照抄平台', () => fixture(id.toUpperCase(), async (s) => {
    await s.run();
    assert.equal(s.sent.length, 2);
    const search = new URL(s.sent[0].url);
    assert.equal(search.origin + search.pathname,
      'https://ark.xiaohongshu.com/api/edith/live/commerce/v1/cps_goods/search');
    assert.equal(search.searchParams.get('query'), id);
    assert.equal(search.searchParams.get('plan_id'), 'plan-1');
    assert.equal(search.searchParams.get('source'), '4');
    assert.equal(search.searchParams.get('scene_id'), '6');
    // 跨子域必须带登录凭证，否则平台回 401「缺失登录凭证」
    assert.equal(s.sent[0].opts.credentials, true);
    const add = s.sent[1];
    assert.ok(add.url.endsWith('/api/edith/live/commerce/live/center/goods/add'));
    assert.equal(add.opts.method, 'POST');
    assert.equal(add.opts.credentials, true);
    const body = JSON.parse(add.opts.body);
    assert.equal(body.type, 'on_sale');
    assert.deepEqual(body.goods_list, [{
      new_item_id: id, new_sku_id: 'sku-1', contract_id: 'contract-1',
      goods_type: 1, title: '测试商品', img: 'https://img.example/1.jpg'
    }]);
    assert.equal(s.messages.at(-1).count, '已加车 · 已定位');
    assert.equal(s.located.length, 1);
    assert.equal(s.opens(), 0);
  }));

  await check('取不到场次参数时用默认值照发，不静默跳过', () => fixture(id, async (s) => {
    await s.run();
    const search = new URL(s.sent[0].url);
    assert.equal(search.searchParams.get('plan_id'), null);
    assert.equal(search.searchParams.get('source'), '4');
    assert.equal(search.searchParams.get('scene_id'), '6');
  }, { params: null }));

  await check('平台判未登录时单独报登录态缺失，不混成搜不到', () => fixture(id, async (s) => {
    await s.run();
    assert.equal(s.messages.at(-1).count, '添加失败 · 登录态缺失');
    assert.match(s.messages.at(-1).full, /HTTP 401/);
    assert.equal(s.sent.length, 1);
  }, { searchStatus: 401, search: { code: -13000, success: false, msg: '缺失登录凭证, 请重新登录' } }));

  await check('商品池搜不到就报失败并带平台原因', () => fixture(id, async (s) => {
    await s.run();
    assert.equal(s.messages.at(-1).count, '添加失败 · 商品池无此商品');
    assert.match(s.messages.at(-1).full, /商品池没搜到这个 ID/);
    assert.equal(s.sent.length, 1);
    assert.equal(s.located.length, 0);
  }, { search: { code: 0, success: true, msg: '无结果', data: { items: [] } } }));

  await check('接口说已被勾选时只报已在车内，不再发加车请求', () => fixture(id, async (s) => {
    await s.run();
    assert.equal(s.sent.length, 1);
    assert.equal(s.messages.at(-1).count, '已在车内');
    assert.match(s.messages.at(-1).full, /choose=true/);
    assert.equal(s.located.length, 0);
  }, { hit: { state: { choose: true, usable: true } } }));

  await check('只有商品不可用能拦住，其余软状态放行让平台裁决', async () => {
    await fixture(id, async (s) => {
      await s.run();
      assert.equal(s.messages.at(-1).count, '添加失败 · 商品不可用');
      assert.equal(s.sent.length, 1);
    }, { hit: { state: { choose: false, usable: false } } });

    for (const state of [{ stock_status: false }, { purchasable: false }, { buyable: false }]) {
      await fixture(id, async (s) => {
        await s.run();
        assert.equal(s.messages.at(-1).count, '已加车 · 已定位');
        assert.equal(s.sent.length, 2, JSON.stringify(state) + ' 应放行');
      }, { hit: { state: Object.assign({ choose: false, usable: true }, state) } });
    }

    // 审核中不给拦：真机上平台允许加车，扩展提前否决会把能加的商品挡住。
    await fixture(id, async (s) => {
      await s.run();
      assert.equal(s.messages.at(-1).count, '已加车 · 已定位');
      assert.equal(s.sent.length, 2);
    }, { hit: { goods_view_info: { title: '测试商品', subtitle: { in_the_review: true } } } });
  });

  await check('平台拒绝时把审核中等软状态作为疑似原因写进 full', () => fixture(id, async (s) => {
    await s.run();
    assert.equal(s.messages.at(-1).count, '添加失败 · 平台拒绝');
    assert.match(s.messages.at(-1).full, /疑似：该商品有信息在审核/);
  }, {
    hit: { goods_view_info: { title: '测试商品', subtitle: { in_the_review: true } } },
    addReply: { code: 1001, success: false, msg: '商品不可添加' }
  }));

  await check('平台回成功但页面没刷新时，用商品池确认算成功', () => fixture(id, async (s) => {
    await s.run();
    assert.equal(s.messages.at(-1).count, '已加车 · 已确认');
    assert.equal(s.messages.at(-1).type, 'success');
    assert.equal(s.located.length, 0);
  }, { noCard: true, chooseAfterAdd: true, settle: 6000 }));

  await check('两个信号都没确认也只说待刷新，不把平台已受理的加车报成失败', () => fixture(id, async (s) => {
    await s.run();
    assert.equal(s.messages.at(-1).count, '已加车 · 待刷新');
    assert.equal(s.messages.at(-1).type, 'success');
    assert.match(s.messages.at(-1).full, /平台已回成功/);
  }, { noCard: true, settle: 9000 }));

  await check('平台拒绝加车时不谎报成功', () => fixture(id, async (s) => {
    await s.run();
    assert.equal(s.messages.at(-1).count, '添加失败 · 平台拒绝');
    assert.match(s.messages.at(-1).full, /平台未确认加车.*1001/);
    assert.match(s.messages.at(-1).full, /state choose=false/);
    assert.equal(s.located.length, 0);
  }, { addReply: { code: 1001, success: false, msg: '商品不可添加' } }));

  await check('转发通道缺失时明说原因，不假装失败', () => fixture(id, async (s) => {
    await s.run();
    assert.equal(s.messages.at(-1).count, '添加失败 · 通道未就绪');
    assert.match(s.messages.at(-1).full, /转发通道未就绪/);
  }, { noProbe: true }));

  await check('拒绝链接、款号、商品名和多个 ID', async () => {
    for (const value of ['https://example.org/' + id, 'S280', '商品 ' + id, id + '\n' + otherId]) {
      await fixture(value, async (s) => {
        s.card(id, '下架');
        await s.run();
        assert.equal(s.messages.at(-1).count, '添加失败 · 请复制商品 ID');
        assert.equal(s.sent.length, 0);
        assert.equal(s.opens(), 0);
      });
    }
  });

  await check('成功与失败符号放大到 20px', async () => {
    await fixture(id, async (s) => {
      await s.run();
      const button = s.d.getElementById(buttonId);
      assert.equal(button.textContent, '✓');
      assert.equal(button.style.fontSize, '20px');
      assert.equal(button.style.fontWeight, '700');
    });
    await fixture(id, async (s) => {
      await s.run();
      const button = s.d.getElementById(buttonId);
      assert.equal(button.textContent, '×');
      assert.equal(button.style.fontSize, '20px');
    }, { addReply: { code: 1001, success: false, msg: '商品不可添加' } });
  });

  await check('连续点击时处理中不再残留放大字号', () => fixture(id, async (s) => {
    const now = () => s.d.getElementById(buttonId);
    await s.run();
    // 首轮完成：符号放大
    assert.equal(now().textContent, '✓');
    assert.equal(now().style.fontSize, '20px');

    // 清掉列表里的卡，逼第二次走接口（否则会走「已在车内」的快速定位分支）
    s.d.querySelector('.goods-card-list').innerHTML = '';
    now().click();
    await new Promise((r) => setTimeout(r, 150));
    // 具体停在「正在处理 / 正在查询 / 正在加车」哪一阶段不影响，关键是字号必须是小的
    assert.match(now().textContent, /^正在/);
    assert.equal(now().style.fontSize, '12px');
    assert.equal(now().style.fontWeight, '400');
    await new Promise((r) => setTimeout(r, 900));
  }, { searchDelay: 400, settle: 1200 }));

  await check('按钮居中在官方按钮上方，并随开关及路由移除', () => fixture(id, async (s) => {
    const button = s.d.getElementById(buttonId);
    assert.equal(button.parentElement, s.d.body);
    assert.equal(button.style.left, '894px');
    assert.equal(button.style.top, '254px');
    s.flags(false);
    assert.equal(s.d.getElementById(buttonId), null);
    s.flags(true);
    assert.ok(s.d.getElementById(buttonId));
    s.w.history.pushState({}, '', '/other');
    s.w.dispatchEvent(new s.w.Event('dyc:pagechange'));
    assert.equal(s.d.getElementById(buttonId), null);
  }));
})().catch((e) => { console.error(e); process.exitCode = 1; });
