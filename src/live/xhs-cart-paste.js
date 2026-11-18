/** 小红书中控台粘贴加车：只认商品 ID，按实际在架状态定位。 */
(function () {
  'use strict';
  if (window.__dycXhsCartPasteLoaded) return;
  window.__dycXhsCartPasteLoaded = true;

  var ID = 'dyc-xhs-cart-paste';
  var SOURCE = '粘贴加车';
  // 直提接口：页面在 pgy 域，但商品池/加车接口都打在 ark 域（真机取样 2026-11-18）。
  var API_HOST = 'https://ark.xiaohongshu.com';
  var API_SEARCH = '/api/edith/live/commerce/v1/cps_goods/search';
  var API_ADD = '/api/edith/live/commerce/live/center/goods/add';
  var DEFAULT_SOURCE = '4';   // 取样实测值
  var DEFAULT_SCENE = '6';    // 取样实测值
  var enabled = false, busy = false, generation = 0;
  var button = null, addAnchor = null, observer = null, mountTimer = null, feedbackTimer = null;
  var positionFrame = null;

  function clean(value) {
    return String(value || '').replace(/[\u200B-\u200F\u202A-\u202E\u2060-\u2064\uFEFF]/g, '').trim();
  }
  function textWithoutExt(root) {
    if (!root) return '';
    if (root.nodeType === 3) return root.nodeValue || '';
    if (root.nodeType !== 1 || root.hasAttribute('data-dyc-skip') ||
        Array.from(root.attributes).some(function (a) { return /^data-(?:dyc|dyb)-/.test(a.name); })) return '';
    return Array.from(root.childNodes).map(textWithoutExt).join('');
  }
  function txt(root) { return clean(textWithoutExt(root)); }
  function visible(el) { return !!el && el.isConnected && el.getClientRects().length > 0; }
  function onPage() {
    return !!(window.DYC_PAGE_PATTERNS && DYC_PAGE_PATTERNS.xhsCtrl.test(location.href));
  }
  function active() { return enabled && onPage(); }
  function guard(token) {
    if (!active() || generation !== token) throw new Error('操作已停止，未继续添加');
  }
  function parseTarget(value) {
    var s = clean(value);
    // 车内真实 ID 为 24 位十六进制；不从商品名称或链接中截取片段。
    return /^[a-f0-9]{24}$/i.test(s) ? s.toLowerCase() : '';
  }
  function nativeButton(root, label) {
    return Array.from(root.querySelectorAll('button, [role="button"]')).find(function (el) {
      return visible(el) && !el.hasAttribute('data-dyc-skip') && txt(el) === label;
    });
  }
  function report(value, count, ok, full) {
    if (typeof setStatus === 'function') setStatus(value, ok ? 'success' : 'warning', {
      source: SOURCE, count: count, full: full || '', keepHistory: true
    });
    if (typeof debugLog === 'function') debugLog('小红书粘贴加车：' + value + ' → ' + count + (full ? ' · ' + full : ''));
  }
  /* 文案和字号必须一起切回去：只改文字不回收字号，下一次的「正在处理」
   * 会沿用上次 20px 的 ✓/× 字号，在 84px 的按钮里溢出成大字（真机反馈）。 */
  function setLabel(text, big) {
    if (!button) return;
    button.textContent = text;
    button.style.fontSize = big ? '20px' : '12px';
    button.style.fontWeight = big ? '700' : '400';
  }
  function feedback(ok) {
    if (!button) return;
    // 12px 的 ✓ / × 在 84×30 的按钮里几乎看不见，成功与失败符号放大到 20px 加粗。
    setLabel(ok ? '✓' : '×', true);
    button.setAttribute('aria-label', ok ? '加车完成' : '加车未完成');
    clearTimeout(feedbackTimer);
    feedbackTimer = setTimeout(function () {
      if (!button) return;
      // 处理中只把字号收回来，不抢走「正在…」的文案
      if (busy) { setLabel(button.textContent, false); return; }
      setLabel('粘贴加车', false);
      button.setAttribute('aria-label', '粘贴加车');
    }, 2500);
  }

  // 与 cart-paste.js 同一后台剪贴板通道，包含直读兜底及三秒总超时。
  function readClipboard() {
    return new Promise(function (resolve, reject) {
      var done = false;
      var timer = setTimeout(function () { finish(false, '', '读取剪贴板超时'); }, 3000);
      function finish(ok, value, why) {
        if (done) return;
        done = true; clearTimeout(timer);
        if (ok) resolve(value); else reject(new Error(why || '读取剪贴板失败'));
      }
      function fallback(why) {
        if (!navigator.clipboard || !navigator.clipboard.readText) { finish(false, '', why); return; }
        navigator.clipboard.readText().then(function (s) { finish(true, s); }, function () { finish(false, '', why); });
      }
      try {
        chrome.runtime.sendMessage({ type: 'dyc:readClipboard' }, function (r) {
          var err = chrome.runtime.lastError;
          if (!err && r && r.ok) finish(true, r.text || '');
          else fallback((err && err.message) || (r && r.error) || '读取剪贴板失败');
        });
      } catch (e) { fallback(e.message); }
    });
  }

  function rowId(nodes) {
    var s = nodes.map(txt).join(' ');
    var m = s.match(/商品\s*ID\s*[:：]?\s*([a-f0-9]{24})(?![a-f0-9])/i);
    if (m) return m[1].toLowerCase();
    for (var node of nodes) {
      for (var el of [node].concat(Array.from(node.querySelectorAll('[data-goods-id], [data-item-id], a[href]')))) {
        var value = el.getAttribute('data-goods-id') || el.getAttribute('data-item-id') || '';
        if (/^[a-f0-9]{24}$/i.test(value)) return value.toLowerCase();
        var href = el.getAttribute('href') || '';
        if (/goods/i.test(href)) {
          m = href.match(/(?:[?&](?:id|goods_?id|item_?id)=|\/)([a-f0-9]{24})(?:[/?&#]|$)/i);
          if (m) return m[1].toLowerCase();
        }
      }
    }
    return '';
  }
  function cartState(id) {
    var cards = document.querySelectorAll('.goods-card-list .goods-card');
    var pending = false;
    for (var card of cards) {
      if (!visible(card) || rowId([card]) !== id) continue;
      var actions = card.querySelector('.goods-card__action-row');
      if (!actions) continue;
      if (nativeButton(actions, '下架')) return { listed: card, pending: false };
      if (nativeButton(actions, '上架') || nativeButton(actions, '重新上架')) pending = true;
    }
    return { listed: null, pending: pending };
  }

  function locateCard(card) {
    var locate = window.dycRevealXhsGoodsCard;
    if (typeof locate !== 'function') return Promise.resolve(false);
    return new Promise(function (done) { locate(card, done); });
  }
  function waitListed(id, timeout) {
    return new Promise(function (resolve) {
      var until = Date.now() + timeout;
      (function tick() {
        var state = cartState(id);
        if (state.listed) { resolve(state.listed); return; }
        if (Date.now() > until) { resolve(null); return; }
        setTimeout(tick, 400);
      })();
    });
  }
  function parseReply(res, what) {
    if (!res || res.status === 0) {
      throw new Error(what + '请求没发出去（' + ((res && res.text) || '网络失败') + '）');
    }
    try { return JSON.parse(res.text || ''); }
    catch (e) {
      throw new Error(what + '返回了非 JSON（HTTP ' + res.status + '），可能登录态已过期');
    }
  }
  function platformWhy(res, reply) {
    var msg = (reply && (reply.msg || reply.message)) || '';
    var code = reply && reply.code != null ? reply.code : '';
    return '｜HTTP ' + ((res && res.status) || 0) +
      (code === '' ? '' : '｜code ' + code) + (msg ? '｜' + msg : '');
  }

  /* ---- 商品池返回的状态 ----
   * search 的每条 item 带 state，说明这个商品能不能加。字段语义按命名与真机取样
   * 推断（2026-11-18），尚未逐个验证 —— 所以每次判定都把原始值写进 full，
   * 真机上若文案说错，看 full 就能定位是哪个字段读反了。 */
  function stateBrief(item) {
    var st = (item && item.state) || {};
    var sub = (item && item.goods_view_info && item.goods_view_info.subtitle) || {};
    var parts = ['choose', 'usable', 'stock_status', 'purchasable', 'buyable', 'add_cart']
      .map(function (key) { return key + '=' + (st[key] === undefined ? '?' : st[key]); });
    if (sub.in_the_review !== undefined) parts.push('in_the_review=' + sub.in_the_review);
    if (sub.review_status !== undefined) parts.push('review_status=' + sub.review_status);
    return 'state ' + parts.join(' ');
  }
  /* 只有两条硬判据可以拦下写操作：已在车内、商品不可用。
   * 库存/可购买/「审核中」这些软状态一律不拦 —— 平台自己允不允许加车才是准的，
   * 提前否决会出现「明明能加却被扩展挡住」（2026-11-18 真机就这么拦掉了一个品）。
   * 软状态留到 add 被拒时写进原因里解释，不阻止尝试。 */
  function blockReason(item) {
    var st = (item && item.state) || {};
    if (st.choose === true) return { inCart: true };
    if (st.usable === false) return { label: '添加失败 · 商品不可用' };
    return null;
  }
  function suspectReason(item) {
    var st = (item && item.state) || {};
    var sub = (item && item.goods_view_info && item.goods_view_info.subtitle) || {};
    if (sub.in_the_review === true) return '该商品有信息在审核';
    if (st.stock_status === false) return '该商品无库存';
    if (st.purchasable === false || st.buyable === false) return '该商品当前不可购买';
    return '';
  }

  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function searchUrl(id, params) {
    var query = new URLSearchParams();
    query.set('source', (params && params.source) || DEFAULT_SOURCE);
    query.set('scene_id', (params && params.scene_id) || DEFAULT_SCENE);
    if (params && params.plan_id) query.set('plan_id', params.plan_id);
    query.set('query', id);
    query.set('query_param', JSON.stringify({ page: 1, limit: 10 }));
    return API_HOST + API_SEARCH + '?' + query.toString();
  }
  function findItem(root, id) {
    var items = (root && root.data && root.data.items) || [];
    return items.find(function (item) {
      return item && item.goods_id &&
        String(item.goods_id.new_item_id || '').toLowerCase() === id;
    }) || null;
  }

  /* ---- 接口直提（不开抽屉）----
   * 走平台「保存」按钮实际调用的那个接口，参数照抄平台最近一次商品池请求：
   * 先 search 拿 new_sku_id / contract_id / type / 标题图，再 add 提交。
   * 成功判据以平台回执（success:true）为准 —— 平台自己的「保存」看的也是它；
   * 页面列表刷不刷新不改变事实，只影响能不能顺手定位到那张卡。 */
  async function addByApi(id, token) {
    var probe = window.__DYC_STOCK_PROBE__;
    if (!probe || typeof probe.sendRequest !== 'function') {
      var noChannel = new Error('页面转发通道未就绪，请刷新中控台后重试');
      noChannel.label = '添加失败 · 通道未就绪';
      throw noChannel;
    }
    setLabel('正在查询', false);
    var params = typeof probe.apiParams === 'function' ? await probe.apiParams() : null;
    guard(token);

    var searched = await probe.sendRequest(searchUrl(id, params), { credentials: true });
    guard(token);
    var root = parseReply(searched, '查询商品');
    if (searched.status === 401) {
      var auth = new Error('平台判为未登录（HTTP 401）' + platformWhy(searched, root));
      auth.label = '添加失败 · 登录态缺失';
      throw auth;
    }
    var hit = findItem(root, id);
    if (!hit) {
      var miss = new Error('商品池没搜到这个 ID' + platformWhy(searched, root) +
        (params && params.plan_id ? '' : '｜未取到直播场次参数，请先打开一次「添加商品」面板'));
      miss.label = '添加失败 · 商品池无此商品';
      throw miss;
    }

    var blocked = blockReason(hit);
    if (blocked && blocked.inCart) {
      // 接口说已被勾选，但当前列表里没有这张卡（通常在「已上架」页），只报已在车内。
      var known = cartState(id).listed;
      var found = known ? await locateCard(known) : false;
      guard(token);
      report(id, found ? '已在车内 · 已定位' : '已在车内', true,
        found ? '' : '本页列表没有这张卡，可能在「已上架」页或其他分页｜' + stateBrief(hit));
      return true;
    }
    if (blocked) {
      report(id, blocked.label, false, '未提交加车｜' + stateBrief(hit));
      return false;
    }

    setLabel('正在加车', false);
    var gid = hit.goods_id || {}, view = hit.goods_view_info || {};
    var body = {
      type: 'on_sale',
      goods_list: [{
        new_item_id: gid.new_item_id || id,
        new_sku_id: gid.new_sku_id || '',
        contract_id: gid.contract_id || '',
        goods_type: typeof hit.type === 'number' ? hit.type : 1,
        title: view.title || '',
        img: view.image || ''
      }]
    };
    var added = await probe.sendRequest(API_HOST + API_ADD, {
      method: 'POST', body: JSON.stringify(body), credentials: true
    });
    guard(token);
    var reply = parseReply(added, '加车');
    if (!reply || reply.success !== true) {
      var suspect = suspectReason(hit);
      var refused = new Error('平台未确认加车' + platformWhy(added, reply) + '｜' + stateBrief(hit) +
        (suspect ? '｜疑似：' + suspect : ''));
      refused.label = '添加失败 · 平台拒绝';
      throw refused;
    }

    // 平台已受理这次加车。下面只决定「说得多到位」，不再决定成败：
    // ① 小黄车列表里出现卡片 → 能直接定位；
    // ② 没刷新出来 → 再查一次商品池的 choose（已在车内）；
    // ③ 两个信号都没有 → 如实说待刷新，但绝不当成加车失败。
    var listed = await waitListed(id, 2500);
    guard(token);
    var confirmed = !!listed;
    if (!confirmed) {
      confirmed = await confirmInCart(id, token, params);
      guard(token);
    }
    if (!listed) listed = cartState(id).listed;
    var located = listed ? await locateCard(listed) : false;
    guard(token);
    report(id,
      located ? '已加车 · 已定位' : (confirmed ? '已加车 · 已确认' : '已加车 · 待刷新'),
      true,
      located || confirmed ? '' : '平台已回成功，页面列表没自动刷新；刷新或切一次分页即可看到');
    return true;
  }

  /* 页面列表不刷新时，用商品池的 choose 再确认一次「确实在车内」。
   * search 是单条查询，响应小、不会被 6 万字符截断。 */
  async function confirmInCart(id, token, params) {
    var probe = window.__DYC_STOCK_PROBE__;
    for (var i = 0; i < 3; i++) {
      await sleep(i === 0 ? 600 : 1500);
      guard(token);
      var res = await probe.sendRequest(searchUrl(id, params), { credentials: true });
      guard(token);
      var ok = false;
      try {
        var item = findItem(parseReply(res, '确认商品'), id);
        ok = !!(item && item.state && item.state.choose === true);
      } catch (e) { ok = false; }
      if (ok) return true;
    }
    return false;
  }

  async function run() {
    if (busy || !active()) return;
    busy = true;
    var token = ++generation, target = '', ok = false;
    if (button) { button.disabled = true; setLabel('正在处理', false); }
    try {
      target = parseTarget(await readClipboard());
      guard(token);
      if (!target) {
        report('剪贴板', '添加失败 · 请复制商品 ID', false);
        return;
      }
      var state = cartState(target);
      if (state.listed) {
        var located = await locateCard(state.listed);
        guard(token);
        report(target, located ? '已在车内 · 已定位' : '已在车内', true,
          located ? '' : '已在车内，但没能定位，可再点一次');
        ok = true;
        return;
      }
      if (state.pending) {
        report(target, '添加失败 · 商品待上架', false);
        return;
      }

      ok = await addByApi(target, token);
    } catch (e) {
      report(target || '剪贴板', e.label || '添加失败', false, e.message || String(e));
    } finally {
      busy = false;
      if (button) button.disabled = false;
      feedback(ok);
    }
  }
  function positionButton() {
    positionFrame = null;
    if (!button) return;
    var rect = visible(addAnchor) ? addAnchor.getBoundingClientRect() : null;
    var shown = rect && rect.top >= 36 && rect.bottom <= window.innerHeight && rect.right > 0 && rect.left < window.innerWidth;
    button.style.visibility = shown ? 'visible' : 'hidden';
    if (!shown) return;
    button.style.left = (rect.left + rect.width / 2) + 'px';
    button.style.top = (rect.top - 6) + 'px';
  }
  function schedulePosition() {
    if (positionFrame === null) positionFrame = window.requestAnimationFrame(positionButton);
  }
  function unmount() {
    if (!button) return;
    window.removeEventListener('scroll', schedulePosition, true);
    window.removeEventListener('resize', schedulePosition);
    if (positionFrame !== null) window.cancelAnimationFrame(positionFrame);
    positionFrame = null;
    button.remove();
    button = null;
    addAnchor = null;
  }
  function mount() {
    if (mountTimer !== null) clearTimeout(mountTimer);
    mountTimer = null;
    if (!active()) { unmount(); return; }
    if (!visible(addAnchor)) addAnchor = nativeButton(document, '添加商品');
    if (!addAnchor) { unmount(); return; }
    if (button && button.isConnected) { schedulePosition(); return; }
    button = document.createElement('button');
    button.id = ID; button.type = 'button'; button.textContent = busy ? '正在处理' : '粘贴加车';
    button.disabled = busy; button.setAttribute('data-dyc-skip', '');
    button.setAttribute('aria-label', '粘贴加车'); button.setAttribute('aria-live', 'polite');
    button.title = '读取单个商品 ID，已上架时定位';
    // 跟随官方按钮的视口坐标，避免挪动平台节点或扩大工具栏。
    button.style.cssText = 'all:initial;position:fixed;transform:translate(-50%,-100%);visibility:hidden;display:inline-flex;align-items:center;justify-content:center;box-sizing:border-box;width:84px;height:30px;border:1px solid #0075ff;border-radius:4px;background:#fff;color:#0075ff;font:12px/1 "Microsoft YaHei",sans-serif;cursor:pointer;';
    button.addEventListener('click', run);
    document.body.appendChild(button);
    window.addEventListener('scroll', schedulePosition, { capture: true, passive: true });
    window.addEventListener('resize', schedulePosition);
    positionButton();
  }
  function schedule() {
    if (!mountTimer) mountTimer = setTimeout(mount, 300);
  }
  function apply(flags) {
    enabled = flags.xhsCartPaste !== false;
    if (!active()) generation++;
    if (observer) observer.disconnect();
    if (active()) {
      if (!observer) observer = new MutationObserver(schedule);
      observer.observe(document.body, { childList: true, subtree: true });
    }
    mount();
  }
  if (typeof dycReadFlags !== 'function' || typeof dycWatchFlags !== 'function') return;
  dycReadFlags().then(apply, function () { report('功能设置', '读取失败', false); });
  dycWatchFlags(apply);
  window.addEventListener('dyc:pagechange', function () { if (!active()) generation++; mount(); });
})();
