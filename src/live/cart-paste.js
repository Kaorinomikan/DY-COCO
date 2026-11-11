/**
 * 小黄车 · 粘贴链接加车（2026-10-24，计划 #1）
 * ============================================================
 * 【范围】用户 2026-10-24 定稿(链接) + 同日晚开工「款号加车」:
 *   · 两种输入:①商品链接(含 http 的整条链接)②款号(字母数字 3~30 位);
 *     两者都不像的一律不支持(整段文字/口令/短链不猜)。
 *   · 添加走**直接提交**(不模拟点击「添加商品」弹窗)。
 *   · 款号只按「完全相等」匹配、且命中超过 2 个不加只提示(用户拍板 A,防少一位误加)。
 *
 * 【接口】2026-10-24 真机接口取样(达人中控台 buyin,手动粘贴链接加车一次):
 *   ① GET  /pc/selection_tool/batch_link?urls=<链接>&request_from=203&scene=1
 *      → data.batch_shop_manage_promotions[]: promotion_id / product_id / item_type /
 *        title / filter_status / filter_status_msg(0+审核通过 = 可加)
 *   ② GET  /api/anchor/livepc/basic_list  → data.basic_list[]: 车内全部 promotion_id
 *      (用于「已在购物车」判断,一次拿全,不用扫 DOM)
 *   ③ POST /pc/live/bind
 *      body {promotions:[{promotion_id, bind_source:"0", product_id, item_type}],
 *            auction_campaign_id:""} → data.success_count / failure_list
 *   会话级 ewid(所有 buyin 接口都带)从页面资源时间线提取,取不到时报明确原因。
 *
 * 【行为】中控台「添加商品」左边「粘贴加车」→ 读剪贴板 → 解析链接(最多 10 条)
 *   → 逐条解析商品 → 车内已有的挑出来不重复加 → 其余的**一次 bind 批量提交**
 *   → 点一下平台「刷新列表」让列表显现 → 已在车的定位 + 闪烁 + 「这个商品已经在购物车了~」
 *   → 一条汇总消息(来源=粘贴加车,三段式)。
 *   · 满载(2026-11-05):小黄车满 200 个时不报「失败」—— 粘贴前先数车内商品数,满了
 *     直接提示「车满了,先删几个」且**不发**绑定请求;平台若仍以「上限/已满」类原因
 *     驳回(我们没数准的情况),同样换成这条口径,不退回笼统失败。
 *
 * 【只在中控台出现】2026-11-06 用户定:中控台切到橱窗商品管理页(/dashboard/
 *   shopwindow/goods-list)后,这个按钮必须消失。见文件末「开关 + 作用域」。
 *
 * 【请求通道】优先经 stock-net-probe 的 sendRequest(页面世界 XHR,自动带平台平台校验头),
 *   探针不在场时退回隔离世界 fetch。平台校验/网络失败都按平台原文报出来,不静默。
 */
(function cartPaste() {
  'use strict';

  if (window.__dycCartPasteLoaded) return;
  window.__dycCartPasteLoaded = true;
  if (typeof dycReadFlags !== 'function' || typeof dycWatchFlags !== 'function') return;

  const BTN_TEXT = '粘贴加车';
  const SOURCE = '粘贴加车';

  /* 小黄车商品数上限(用户 2026-11-05 反馈:车到 200 个以后再加,只剩一句「失败」,
     看不出是车满了)。主动预判用这个数;平台侧另有文案识别(RE_CART_FULL),
     两处任一生效即可 —— 预判避免白发一次请求,识别兜住「我们没数准」的情况。 */
  const CART_LIMIT = 200;

  /* 平台「车满」类失败文案的识别口径。
     ⚠️ 这是**平台原文**的词,不按我们自己的文案改写 —— 改错了匹配不到,就退化成静默失效;
     也不加 g 标志(带 g 的 test 会记 lastIndex,同一句第二次判成 false)。 */
  const RE_CART_FULL = /上限|已满|装满|满了|超出.{0,6}(数量|限制|个|件)|超过.{0,6}(数量|限制|个|件)|最多.{0,6}(个|件|款)/;

  /* failure_list 每条里可能装原因的字段(平台字段名未定死,挨个试,取第一个非空) */
  const FAIL_REASON_FIELDS = ['fail_reason', 'reason', 'fail_msg', 'err_msg', 'msg'];

  let on = false;
  let busy = false;
  let btn = null;
  let retryTimer = null;
  let feedbackTimer = null;

  function buttonFeedback(text, kind) {
    if (feedbackTimer) clearTimeout(feedbackTimer);
    feedbackTimer = null;
    if (!btn) return;
    btn.textContent = text;
    btn.setAttribute('aria-label', text);
    if (!busy) {
      const success = kind === 'success';
      btn.innerHTML = '<svg class="dyc-cartpaste-result" viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" style="color:' +
        (success ? '#16803c' : '#c03532') + '"><path d="' +
        (success ? 'M5 12l4 4L19 6' : 'M6 6l12 12M18 6L6 18') +
        '" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    }
    btn.disabled = busy;

    btn.setAttribute('aria-live', 'polite');
    if (!busy) {
      feedbackTimer = setTimeout(() => {
        feedbackTimer = null;
        if (btn) { btn.textContent = BTN_TEXT; btn.setAttribute('aria-label', BTN_TEXT); }
      }, 2500);
    }
  }

  function log(msg) {
    if (typeof debugLog === 'function') debugLog(msg);
  }

  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  function visible(el) {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }

  /* ==========================================================
   * 一、按钮注入(原生「添加商品」左边,文档流兄弟)
   * ========================================================== */

  function findNativeAddButton() {
    if (typeof findAllByText !== 'function') return null;
    const nodes = findAllByText('添加商品', { exact: true });
    if (!nodes.length) return null;
    const node = nodes[0];
    return node.closest('button, a, [role="button"]') || node;
  }

  function ensureButton() {
    if (!on) return;
    /* 作用域兜底（2026-11-06）：非中控台一律不挂按钮。
       订阅那一路已经负责「切走即收」，这里是第二道 —— 心跳、平台重渲染、
       任何路径都不会把按钮再带到别的页面（用户报：橱窗商品管理页上还留着它）。 */
    if (typeof dycIsLiveControl === 'function' && !dycIsLiveControl()) {
      removeButton();
      return;
    }
    if (btn && btn.isConnected) return;

    const native = findNativeAddButton();
    if (!native || !native.parentNode) {
      if (!retryTimer) {
        retryTimer = setTimeout(() => { retryTimer = null; ensureButton(); }, 1500);
      }
      return;
    }
    if (native.previousElementSibling &&
        native.previousElementSibling.classList &&
        native.previousElementSibling.classList.contains('dyc-cartpaste-btn')) {
      btn = native.previousElementSibling;
      return;
    }

    btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'dyc-cartpaste-btn';
    btn.textContent = BTN_TEXT;
    btn.title = '用剪贴板商品链接、款号或标题尾款号加车，已有商品尝试定位';
    btn.addEventListener('click', onClick);
    native.parentNode.insertBefore(btn, native);
    log('粘贴加车:按钮已挂到「添加商品」左边');
  }

  function removeButton() {
    if (btn && btn.parentNode) btn.parentNode.removeChild(btn);
    btn = null;
  }

  /* ==========================================================
   * 二、剪贴板解析(只认链接,保留原始链接给接口用)
   * ========================================================== */

  /**
   * 从剪贴板里取**最新的一条**商品链接(用户 2026-10-24 定:
   * 「只接收最新的粘贴板的那个链接,不需要整个粘贴板都粘贴进去」)。
   * 剪贴板里常混着别的东西(整段报告、多个旧链接),只认最后一个命中的链接;
   * 其余内容一律不进流程。
   * @returns {Array<{id:string, link:string}>} 最多 1 条
   */
  function parseLinks(text) {
    const parts = String(text || '').split(/[\s\u3000]+/).filter(Boolean);
    let last = null;
    for (const p of parts) {
      const m = /(haohuo\.jinritemai\.com[^\s"'<>]*[?&]id=(\d{10,}))/i.exec(p) ||
                /(jinritemai\.com[^\s"'<>]*[?&](?:product_id|id)=(\d{10,}))/i.exec(p);
      if (m) last = { id: m[2], link: m[1] };   // 只留最后一个(最近粘的那条)
    }
    return last ? [last] : [];
  }

  /**
   * 款号识别(2026-10-24 起支持「整串商品名」,用户会直接粘商品名):
   *   ① 整个剪贴板就是款号 → 原样用;
   *   ② 否则按店铺命名惯例取**尾部款号**(标题统一以款号结尾,前面是非字母数字);
   *   ③ 都不像 → ''(后续报「无法识别」)。
   *
   * 判据不在本文件 —— 见 `src/content/item-code.js`（唯一真源，2026-11-12 收敛）。
   * 原先这里自带一份 `[A-Za-z0-9\-_]{2,29}`，后果与 #137 同族：
   *   粘贴复合款号 `M609Y0544/0686` 时，`/` 不在字符集里 ⇒ 尾部正则只抓到 `0686`，
   *   长度 4、含数字、全部校验通过 ⇒ **静默拿半截去搜商品**，比报「没认出」更坏。
   *
   * @returns {string} 款号(原样)或 ''
   */
  function parseCode(text) {
    const t = String(text || '').trim();
    if (!t) return '';
    // ① 整串就是款号（含斜杠复合款号）；纯尺码（2XL）不算
    if (!/\s/.test(t) && dycIsCodeLike(t) && !dycIsSizeOnly(t)) return t;
    // ② 尾部款号
    return dycPickCodeFromName(t);
  }

  /**
   * 读剪贴板(2026-10-24):
   * 内容脚本直读 navigator.clipboard 受页面 clipboard-read 权限约束,
   * 实测会一直悬着(点了没反应、零日志)。改走后台离屏文档代读(带扩展
   * clipboardRead 权限),失败再退回直读兜底;全程 3 秒超时,绝不挂死。
   */
  function readClipboard() {
    return new Promise(function (resolve, reject) {
      var done = false;
      var timer = setTimeout(function () {
        if (done) return;
        done = true;
        reject(new Error('读取超时'));
      }, 3000);

      function finish(ok, text, why) {
        if (done) return;
        done = true;
        clearTimeout(timer);
        if (ok) resolve(text);
        else reject(new Error(why || '读取失败'));
      }

      function directFallback(whyFirst) {
        if (navigator.clipboard && typeof navigator.clipboard.readText === 'function') {
          navigator.clipboard.readText().then(function (t) {
            finish(true, t);
          }, function (e) {
            finish(false, '', (e && e.message) || whyFirst);
          });
          return;
        }
        finish(false, '', whyFirst);
      }

      try {
        chrome.runtime.sendMessage({ type: 'dyc:readClipboard' }, function (r) {
          var err = chrome.runtime.lastError;
          if (err) { directFallback(err.message); return; }
          if (r && r.ok) {
            finish(true, r.text || '');
            return;
          }
          directFallback((r && r.error) || '后台读取失败');
        });
      } catch (e) {
        directFallback(e && e.message);
      }
    });
  }

  /* ==========================================================
   * 三、请求通道(优先页面侧转发,过平台校验)
   * ========================================================== */

  async function pageFetch(url, opts) {
    const probe = window.__DYC_STOCK_PROBE__;
    if (probe && typeof probe.sendRequest === 'function') {
      const r = await probe.sendRequest(url, opts || {});
      if (r && r.status > 0) return { status: r.status, text: r.text || '', via: 'main' };
    }
    const resp = await fetch(url, {
      method: (opts && opts.method) || 'GET',
      credentials: 'include',
      headers: opts && opts.body ? { 'Content-Type': 'application/json;charset=UTF-8' } : undefined,
      body: (opts && opts.body) || undefined
    });
    const text = await resp.text();
    return { status: resp.status, text, via: 'isolated' };
  }

  function safeJson(text) {
    try { return JSON.parse(text); } catch (e) { return null; }
  }

  /** 会话级 ewid:页面自己的所有 buyin 接口都带,从资源时间线取最近的 */
  function findEwid() {
    try {
      const entries = performance.getEntriesByType('resource') || [];
      for (let i = entries.length - 1; i >= 0; i--) {
        const m = /[?&]ewid=([0-9a-f]{16,})/i.exec(entries[i].name || '');
        if (m) return m[1];
      }
    } catch (e) { /* 时间线不可用 */ }
    return '';
  }

  /* ==========================================================
   * 四、直接提交(直提,接口见文件头)
   * ========================================================== */

  /** 车内已有的 promotion_id 集合(接口 ②) */
  /**
   * 车内已有集合 + 顺序(接口 ②)。
   * order = basic_list 的原始顺序 = 小黄车里的排列顺序(用于「第几号」与按序定位)。
   * @returns {Promise<{set:Set<string>, order:Array<string>}>}
   */
  async function fetchCartIdSet(ewid) {
    const r = await pageFetch('/api/anchor/livepc/basic_list?ewid=' + encodeURIComponent(ewid) +
      '&source_type=force', { method: 'GET' });
    const j = safeJson(r.text);
    const list = j && j.data && j.data.basic_list;
    /* 真机诊断用(2026-11-05):满载预判依赖这里的条数,若平台在这个接口上分页
       (只回一部分),预判就会漏判 —— 把顶层键打出来,真机一眼能看出有没有
       total / 分页字段可以改用。 */
    if (j && j.data && typeof j.data === 'object') {
      log('粘贴加车:basic_list ' + (Array.isArray(list) ? list.length : 0) + ' 条,data 键 ' +
        Object.keys(j.data).join(','));
    }
    const set = new Set();
    const order = [];
    if (Array.isArray(list)) {
      for (const it of list) {
        if (!it) continue;
        const pid = it.promotion_id ? String(it.promotion_id) : '';
        if (pid) {
          set.add(pid);
          order.push(pid);
        }
        if (it.product_id) set.add(String(it.product_id));
      }
    }
    return { set: set, order: order };
  }

  /** 链接 → 商品信息(接口 ①) */
  async function resolveLink(ewid, link) {
    const url = '/pc/selection_tool/batch_link?ewid=' + encodeURIComponent(ewid) +
      '&urls=' + encodeURIComponent(link) + '&request_from=203&scene=1';
    const r = await pageFetch(url, { method: 'GET' });
    const j = safeJson(r.text);
    if (!j || j.code !== 0) {
      return { ok: false, why: (j && j.msg) || ('HTTP ' + r.status) };
    }
    const list = (j.data && j.data.batch_shop_manage_promotions) || [];
    const p = list[0];
    if (!p || !p.promotion_id) return { ok: false, why: '链接没解析出商品(可能不是联盟商品)' };
    if (p.filter_status !== 0) {
      return { ok: false, why: p.filter_status_msg || ('不可添加(' + p.filter_status + ')') };
    }
    return {
      ok: true,
      promotion_id: String(p.promotion_id),
      product_id: String(p.product_id || p.promotion_id),
      item_type: p.item_type || 6,
      title: p.title || ''
    };
  }

  /**
   * 款号 → 商品(2026-10-24 新增):查「我的店铺」商品池按款号**完全相等**匹配。
   *
   * 接口取样实证(pool_type:3 = 我的店铺):POST /pc/selection_tool/promotion/list
   *   body {title, page_size, page, pool_type:'3', filter_type:1, filter_bound, ...}
   *   → data[] 每一项带 promotion_id / product_id / title / filter_status。
   * 池列表**不返回 art_no 字段**,但店铺商品标题统一以款号结尾(接口取样逐条核对过),
   * 故按「标题里出现与款号完全相等的代码片段」匹配(前后必须是非字母数字),杜绝
   * 「少一位撞上几十个」的模糊命中。
   *
   * filterBound:true = 平台「添加商品」的默认口径(**已在车里的商品会被排除**);
   * 用户 2026-10-24 指出这个特性 ⇒ 查不到时要放宽成 false 再查一次,才能区分
   * 「真没有这个款号」与「款号就在车里所以被排除」。
   *
   * @returns {Promise<{scanned:number, matches:Array}>} matches 已过滤 filter_status!==0
   */
  async function searchMyShop(ewid, code, filterBound) {
    const body = {
      title: code,
      page_size: 50,
      page: 1,
      pool_type: '3',
      filter_type: 1,
      filter_bound: !!filterBound,
      request_from: 0,
      select_type: ''
    };
    const r = await pageFetch('/pc/selection_tool/promotion/list?ewid=' + encodeURIComponent(ewid), {
      method: 'POST',
      body: JSON.stringify(body)
    });
    const j = safeJson(r.text);
    const items = j && Array.isArray(j.data) ? j.data : [];
    const up = String(code).toUpperCase();
    const safe = up.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp('(^|[^A-Z0-9])' + safe + '(?=$|[^A-Z0-9])');
    const matches = [];
    for (const it of items) {
      if (!it || it.filter_status !== 0) continue;
      const title = String(it.title || '');
      if (!re.test(title.toUpperCase())) continue;
      matches.push({
        promotion_id: String(it.promotion_id),
        product_id: String(it.product_id || it.promotion_id),
        item_type: it.item_type || 6,
        title: title
      });
    }
    return { scanned: items.length, matches };
  }

  /** failure_list 单条里取失败原因(取不到返回 '',不编造) */
  function failReasonOf(item) {
    if (!item) return '';
    for (const k of FAIL_REASON_FIELDS) {
      const v = item[k];
      if (v && typeof v === 'string') return v;
    }
    return '';
  }

  /** 这段平台文案是不是在说「车满/装不下」 */
  function isCartFullText(text) {
    return !!text && RE_CART_FULL.test(String(text));
  }

  /**
   * 批量加车(接口 ③)。返回成功加入的产品。
   * @returns {Promise<{ok:boolean, why:string, added:Array, failedCount:number,
   *                    full:boolean, failedItems:Array<{id:string,title:string,why:string}>}>}
   *   full = 平台把这次驳回(或部分驳回)的原因指向「车满」;
   *          可能是 code!==0 的 msg,也可能是 success_count 之外逐条 failure_list 的原因。
   *   调用方据此换成满载提示,而不是笼统的「失败」(用户 2026-11-05)。
   */
  async function bindPromotions(ewid, promos) {
    const body = {
      promotions: promos.map((p) => ({
        promotion_id: p.promotion_id,
        bind_source: '0',
        product_id: p.product_id,
        item_type: p.item_type || 6
      })),
      auction_campaign_id: ''
    };
    const r = await pageFetch('/pc/live/bind?ewid=' + encodeURIComponent(ewid), {
      method: 'POST',
      body: JSON.stringify(body)
    });
    const j = safeJson(r.text);
    if (!j || j.code !== 0) {
      const why = (j && j.msg) || ('HTTP ' + r.status);
      return { ok: false, why, added: [], failedCount: promos.length, full: isCartFullText(why), failedItems: [] };
    }
    const d = j.data || {};
    const failList = Array.isArray(d.failure_list) ? d.failure_list : [];
    const okCount = Number(d.success_count || 0);
    const added = [];
    const failedItems = [];
    let full = false;
    for (const p of promos) {
      const hit = failList.find((f) => String((f && f.promotion_id) || '') === p.promotion_id);
      if (hit) {
        const why = failReasonOf(hit);
        if (isCartFullText(why)) full = true;
        failedItems.push({ id: p.product_id, title: p.title, why: why });
      }
      if (!hit && okCount > 0) added.push(p);
    }
    /* failure_list 为空但整单没加进时,原因可能只落在 data.msg / 顶层 msg 上 */
    if (!added.length && !failedItems.length) {
      if (isCartFullText(d.msg) || isCartFullText(j.msg)) full = true;
    }
    return { ok: true, added, failedCount: Number(d.failure_count || 0) || failedItems.length, full, failedItems };
  }

  /**
   * 满载提示的三段式文案(2026-11-05 用户定:条上短句「车满了,先删几个」)。
   * 条上只留一句(状态条宽度有限);「满的是 200 个」和「删几个、再粘一次」
   * 这两件用户真正需要的事都进 opts.full,盒子点开能看全。
   * 标点跟随本模块既有消息(半角),避免同屏两条消息一个全角一个半角。
   * @param {number} addedCount 本次已经加进去的数量(0 = 一个都没加进)
   * @param {Array} blocked 被挡在车外的商品(用于在全文里点名)
   * @returns {{message:string, count:string, full:string}}
   */
  function cartFullCopy(addedCount, blocked) {
    const list = Array.isArray(blocked) ? blocked : [];
    const names = list.map((p) => p.title || ('商品 ' + p.product_id)).join('、');
    const message = addedCount > 0 ? ('车满了,只加了 ' + addedCount + ' 个') : '车满了,先删几个';
    const count = addedCount > 0 ? '其余未加入' : '未加入';
    let full = '购物车已满 ' + CART_LIMIT + ' 个(平台小黄车放不下更多了),没有空位再加。' +
      '请先在小黄车里删掉几个不需要的商品,再重新粘贴加车。';
    if (names) full += '没能加入的:' + names + '。';
    return { message, count, full };
  }

  /** 点一下平台自己的「刷新列表」,让刚绑定的商品显现(有就点,没有就算了) */
  function clickRefreshList() {
    if (typeof findAllByText !== 'function') return;
    const nodes = findAllByText('刷新列表', { exact: false });
    if (!nodes.length) return;
    const target = nodes[0].closest('button, a, [role="button"]') || nodes[0];
    try { target.click(); } catch (e) { /* 忽略 */ }
  }

  /** 在购物车 DOM 里按商品名找已有项(定位用) */
  function findCartItemByName(name) {
    if (!name) return null;
    const key = name.replace(/\s+/g, '');
    if (key.length < 4) return null;
    const nodes = Array.from(document.querySelectorAll('[class*="card"], [class*="item"], [class*="product"], [class*="goods"]'));
    for (const el of nodes) {
      if (!visible(el)) continue;
      const t = (el.textContent || '').replace(/\s+/g, '');
      if (t.length > 200) continue;
      if (t.indexOf(key) >= 0) return el;
    }
    return null;
  }

  /* ==========================================================
   * 五、点击主流程
   * ========================================================== */

  async function onClick(e) {
    e.preventDefault();
    e.stopPropagation();
    if (busy) return;
    busy = true;
    let resultText = '加车失败 !';
    let resultKind = 'failure';
    buttonFeedback('读取中', '');

    try {
      let text = '';
      try {
        text = await readClipboard();
      } catch (err) {
        toast('读不到剪贴板:请允许读取,或先复制商品链接', 'warning',
          { source: SOURCE, keepHistory: false });
        log('粘贴加车:剪贴板读取失败 ' + (err && err.message));
        return;
      }
      log('粘贴加车:剪贴板内容「' + String(text || '').replace(/\s+/g, ' ').slice(0, 120) + '」');

      // 剪贴板分类(2026-10-24 起支持款号):含商品链接 → 链接路径;
      // 否则整个剪贴板像款号 → 「我的店铺」池按款号完全相等匹配。
      const links = parseLinks(text);
      const code = links.length ? '' : parseCode(text);
      if (!links.length && !code) {
        /* 条上一行宽,长句必然被截成「…」(2026-10-27 口径):短句上条,
         * 细则进右端弱位 —— 用户照着这句就知道该怎么改剪贴板内容。 */
        toast('没认出链接或款号', 'warning',
          { source: SOURCE, count: '贴整串商品名也行', keepHistory: false });
        log('粘贴加车:剪贴板内容既非链接亦非款号/商品名(见上一行)');
        return;
      }

      const ewid = findEwid();
      if (!ewid) {
        failStatus('没拿到页面会话标识(ewid),请刷新页面后重试', { source: SOURCE });
        log('粘贴加车:ewid 未找到');
        return;
      }
      log('粘贴加车:ewid 已取得,按' + (links.length ? '链接' : '款号 ' + code) + '处理');

      // 运行中状态(不带 X/N 计数:一次只处理一个目标,计数会让用户误以为有两件事)
      buttonFeedback('加车中', '');
      updateProgress(1, 0, '正在加车', { source: SOURCE });

      // ① 车内已有集合 + 顺序(一次拿全;顺序用于「第几号」与虚拟列表按序定位)
      let cartIds = new Set();
      let cartOrder = [];
      try {
        const cart = await fetchCartIdSet(ewid);
        cartIds = cart.set;
        cartOrder = cart.order;
        log('粘贴加车:车内列表读取完成,共 ' + cartIds.size + ' 个 id');
      } catch (err) {
        log('粘贴加车:车内列表读取失败,按「都不在车内」继续 ' + (err && err.message));
      }

      /* 车内商品数 = basic_list 的顺序长度(order 只收 promotion_id,不含重复计入的
         product_id,所以不能用 cartIds.size)。取不到列表时是 0 —— 这时不预判,
         交给下面的平台文案识别兜底,不会误判成车满。 */
      const cartCount = cartOrder.length;
      log('粘贴加车:车内商品 ' + cartCount + ' 个(上限 ' + CART_LIMIT + ')');

      // ② 目标商品解析(链接或款号,统一成一个 targets 列表)
      let targets = [];
      if (links.length) {
        const r = await resolveLink(ewid, links[0].link);
        if (!r.ok) {
          setStatus('链接 ' + links[0].id, 'alert', { source: SOURCE, count: '无法识别', keepHistory: true });
          log('粘贴加车:链接解析失败 ' + links[0].id + ' → ' + r.why);
          return;
        }
        targets = [r];
        log('粘贴加车:链接解析成功 ' + r.promotion_id + ' ' + (r.title || ''));
      } else {
        // 款号:先用平台默认口径(filter_bound:true,已排除车内商品)查;
        // 查不到再放宽(filter_bound:false)查一次 —— 用户 2026-10-24 指出:
        // 「添加商品」会自动排除本身就在车里的商品,所以查不到大概率是它就在车里。
        let s = await searchMyShop(ewid, code, true);
        log('粘贴加车:款号 ' + code + ' 默认口径搜到 ' + s.scanned + ' 条,完全相等 ' + s.matches.length + ' 个');
        if (!s.matches.length) {
          s = await searchMyShop(ewid, code, false);
          log('粘贴加车:款号 ' + code + ' 放宽口径搜到 ' + s.scanned + ' 条,完全相等 ' + s.matches.length + ' 个');
        }
        if (!s.matches.length) {
          // 最终兜底:直接看车里有没有这个款号(车里的商品被添加弹窗排除,池里查不到)
          const el = findCartItemByName(code);
          if (el) {
            if (typeof scrollElementToViewportCenter === 'function') scrollElementToViewportCenter(el);
            if (typeof highlight === 'function') highlight(el);
            resultText = '已在车内';
            resultKind = 'success';
            setStatus('款号 ' + code, 'warning', { source: SOURCE, count: '已在车内', keepHistory: true });
            log('粘贴加车:款号 ' + code + ' 池里没有但车列表里有 → 已在车内');
            return;
          }
          setStatus('款号 ' + code, 'alert', { source: SOURCE, count: '无法识别', keepHistory: true });
          log('粘贴加车:款号 ' + code + ' 两轮口径与车列表都没命中');
          return;
        }
        targets = s.matches;
        log('粘贴加车:款号命中 ' + s.matches.map((m) => m.title).join(' / '));
      }

      // 本次操作的主体(消息里「来源之外」的标识用)
      const subject = links.length ? ('链接 ' + links[0].id) : ('款号 ' + code);

      // 车内判重 + 待加集合
      const toBind = [];
      const inCart = [];
      const failed = [];
      for (const t of targets) {
        if (cartIds.has(t.promotion_id) || cartIds.has(t.product_id)) {
          const idx = cartOrder.indexOf(t.promotion_id) + 1;   // 1 基序号;0 = 未知
          inCart.push({ id: t.product_id, title: t.title, idx: idx });
          log('粘贴加车:已在车内 ' + t.product_id + ' 第' + (idx || '?') + '号 ' + (t.title || ''));
        } else {
          toBind.push(t);
          log('粘贴加车:待加入 ' + t.promotion_id + ' ' + (t.title || ''));
        }
      }

      // 待加数量闸门(用户拍板 A:防「少一位撞上几十个」误加;「已在车内」的不占名额)
      if (toBind.length > 2) {
        setStatus(subject, 'alert',
          {
            source: SOURCE, count: '待加入 ' + toBind.length + ' 个,未加入', keepHistory: true,
            // 盒子存全文(2026-10-27):条上只留一句,原因留给事后回看
            full: subject + ' 待加入的匹配有 ' + toBind.length + ' 个 —— 超过 2 个不加入,' +
                  '防款号少一位撞上几十个。请核对款号,或直接贴完整商品链接。'
          });
        log('粘贴加车:' + subject + ' 待加入过多,已放弃');
        return;
      }

      /* 满载预判(2026-11-05 用户反馈:车到 200 个后粘贴只剩一句「失败」,看不出是车满):
         数到车内已满就直接给满载提示,**不发这一次注定被驳回的绑定请求**。
         位置说明:必须排在判重之后 —— 车满但商品本来就在车里,上面已按「已在车内」
         报过,不能误报成满载;也必须排在待加数量闸门之后 —— 一次撞上几十个是款号
         问题,先按那条报更准确。 */
      if (toBind.length && cartCount >= CART_LIMIT) {
        const copy = cartFullCopy(0, toBind);
        // dropRunning:满载是快速返回,别让「正在加车」的过程条和结果条同时挂在屏幕上
        setStatus(copy.message, 'alert',
          { source: SOURCE, count: copy.count, full: copy.full, keepHistory: true, dropRunning: true });
        resultText = '车已满';
        resultKind = 'failure';
        log('粘贴加车:车内已满 ' + cartCount + '/' + CART_LIMIT + ',不提交绑定 · ' + subject);
        return;
      }

      // ③ 一次批量绑定
      let added = [];
      let fullBlocked = false;    // 平台驳回原因指向「车满」→ 提示换成满载口径
      let blocked = [];           // 没加进去的(满载提示里点名用)
      if (toBind.length) {
        const b = await bindPromotions(ewid, toBind);
        if (!b.ok) {
          fullBlocked = !!b.full;
          blocked = toBind.slice();
          for (const p of toBind) failed.push({ id: p.product_id, why: b.why, title: p.title });
          log('粘贴加车:绑定请求失败 ' + b.why + (fullBlocked ? ' → 判为车满' : ''));
        } else {
          added = b.added;
          const addedIds = new Set(added.map((p) => p.product_id));
          const reasonOf = (pid) => {
            const it = (b.failedItems || []).find((f) => f.id === pid);
            return (it && it.why) || '平台未确认加入';
          };
          for (const p of toBind) {
            if (!addedIds.has(p.product_id)) {
              blocked.push(p);
              failed.push({ id: p.product_id, why: reasonOf(p.product_id), title: p.title });
            }
          }
          // 平台没全确认、且原因指向车满 → 同样换成满载口径(车位不够,只加进了 N 个)
          if (blocked.length && b.full) fullBlocked = true;
          log('粘贴加车:绑定完成,成功 ' + added.length + ',失败 ' + (b.failedCount || 0) +
            (fullBlocked ? ' → 判为车满' : ''));
        }
      }

      // ④ 刷新列表 → 定位 + 闪烁
      //    added:按标题找;inCart:多个时逐个定位(先按标题扫 DOM,扫不到按「第N号」序号定位)
      if (added.length || inCart.length) {
        clickRefreshList();
        await sleep(900);
      }
      let locatedCount = 0;
      if (added.length) {
        const el = findCartItemByName(added[0].title || '');
        if (el) {
          if (typeof scrollElementToViewportCenter === 'function') scrollElementToViewportCenter(el);
          if (typeof highlight === 'function') highlight(el);
          locatedCount++;
        }
      }
      for (let i = 0; i < inCart.length; i++) {
        const it = inCart[i];
        const el = it.title ? findCartItemByName(it.title) : null;
        if (el) {
          if (typeof scrollElementToViewportCenter === 'function') scrollElementToViewportCenter(el);
          if (typeof highlight === 'function') highlight(el);
          locatedCount++;
        } else if (it.idx > 0 && typeof locateProduct === 'function') {
          locateProduct(it.idx, function () {});
          locatedCount++;
        }
        if (i < inCart.length - 1) await sleep(1200);
      }
      if (typeof debugLog === 'function') {
        debugLog('粘贴加车:定位完成 ' + locatedCount + ' 个' +
          (inCart.length ? '(已在车内 ' + inCart.map((p) => '第' + (p.idx || '?') + '号').join('、') + ')' : ''));
      }

      // ⑤ 一条消息(用户 2026-10-24 定稿口径):
      //    商品名放「值」段(强),结果词放右端弱化位(不写数字);
      //    已在车内用橙色(warning)并收进消息盒子,弱化位补「第 N 号」。
      // 满载口径优先(2026-11-05):车满时只说「失败」等于没说,换成「车满了,先删几个」
      // + 盒子全文;只加进一部分时说清只加了几个,不混进普通「部分加入」。
      if (fullBlocked) {
        const copy = cartFullCopy(added.length, blocked.length ? blocked : toBind);
        // dropRunning:满载是快速返回,别让「正在加车」的过程条和结果条同时挂在屏幕上
        setStatus(copy.message, 'alert',
          { source: SOURCE, count: copy.count, full: copy.full, keepHistory: true, dropRunning: true });
        resultText = added.length ? '部分加入' : '车已满';
        resultKind = 'failure';
        log('粘贴加车:车满 · 已加入 ' + added.length + ' 个,挡回 ' + blocked.length + ' 个');
      } else if (added.length) {
        const name = added.map((p) => p.title || ('商品 ' + p.product_id)).join('、');
        const tail = inCart.length ? ('已加入小黄车 · 另 ' + inCart.length + ' 个已在车内') : '已加入小黄车';
        resultText = failed.length ? '部分加入' : '已加车 ✓';
        resultKind = failed.length ? 'failure' : 'success';
        finishStatus(name, { source: SOURCE, count: tail });
        log('粘贴加车:完成 ' + name);
      } else if (inCart.length) {
        const name = inCart.map((p) => p.title || ('商品 ' + p.id)).join('、');
        const idxNums = inCart.map((p) => p.idx).filter((n) => n > 0);
        const tail = idxNums.length ? ('已在车内 · 第' + idxNums.join('、') + '号') : '已在车内';
        resultText = failed.length ? '部分失败 !' : '已在车内';
        resultKind = failed.length ? 'failure' : 'success';
        setStatus(name, 'warning', { source: SOURCE, count: tail, keepHistory: true });
        log('粘贴加车:已在车 ' + name + ' ' + tail);
      } else {
        const f = failed[0] || {};
        if (f.title) {
          failStatus(f.title, { source: SOURCE, count: '失败' });
          log('粘贴加车:失败 ' + f.title + ' ' + (f.why || ''));
        } else {
          setStatus('链接 ' + (f.id || ''), 'alert',
            { source: SOURCE, count: '无法识别', keepHistory: true });
          log('粘贴加车:无法识别 ' + (f.id || '') + ' ' + (f.why || ''));
        }
      }
    } catch (err) {
      failStatus('加车异常:' + (err && err.message), { source: SOURCE });
      log('粘贴加车:异常 ' + (err && err.message));
    } finally {
      busy = false;
      buttonFeedback(resultText, resultKind);
    }
  }

  /* ==========================================================
   * 六、开关与挂载
   * ========================================================== */

  function start() {
    /* 作用域兜底（2026-11-06）：不在中控台，start 也不许「保持在场」。
       只判 ensureButton 不够 —— 按钮已经在场时 start() 会被下面的幂等
       guard 直接返回，谁都不会去摘它（自测用例④抓到的就是这个缺口）。 */
    if (typeof dycIsLiveControl === 'function' && !dycIsLiveControl()) { stop(); return; }
    if (on) return;
    on = true;
    ensureButton();
    if (!start.__keep) {
      start.__keep = setInterval(() => {
        if (!on) return;
        if (!btn || !btn.isConnected) ensureButton();
      }, 2000);
    }
  }

  function stop() {
    on = false;
    removeButton();
  }

  /* 开关 + 作用域。
   *
   * ★ 2026-11-06 用户改口径（覆盖 2026-11-05 的「橱窗商品管理页允许粘贴加车」）：
   *   「是要去掉这个按钮，在这个分页面」—— 粘贴加车**只在中控台出现**。
   *   中控台是 Garfish 微前端，pushState 切到橱窗商品管理页不重载 document，
   *   所以必须主动收，不能指望页面重载把它带走。
   *
   *   两道保险，缺一不可：
   *     ① 作用域订阅 —— 路由翻转即 stop()（真移除按钮并让心跳空转）；
   *     ② ensureButton 顶部的作用域判定 —— 任何路径都不在别页挂按钮。
   *   跟着收的模块因此变成：循环讲解 / 自动刷新 / 福袋 / 全能搜索 / 粘贴加车。
   */
  dycReadFlags().then((flags) => {
    if (flags.cartPaste !== false) start();
  });
  dycWatchFlags((flags) => {
    const want = flags.cartPaste !== false;
    if (want) start(); else stop();
  });
  if (typeof dycWatchLiveScope === 'function') {
    dycWatchLiveScope((inScope) => {
      if (!inScope) { stop(); return; }
      /* 回到中控台：开关关着就不许复活（否则等于绕过了用户的开关） */
      dycReadFlags().then((flags) => {
        if (flags.cartPaste !== false) start();
      });
    });
  }
})();
