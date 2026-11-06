/**
 * 橱窗 · 粘贴链接加橱窗(2026-11-06,用户新增需求)
 * ============================================================
 * 【范围】橱窗商品管理页(buyin.jinritemai.com/dashboard/shopwindow/goods-list)。
 *   点「粘贴加橱窗」→ 读剪贴板 → 取出里面的商品链接 → 逐条换 promotion_id
 *   → 分批提交绑定 → 点平台「刷新商品」→ 一条三段式结果消息。
 *
 * 【接口】2026-11-06 用户真机示范(手动粘贴一条链接加橱窗,抓到两条请求):
 *   ① GET /pc/selection_tool/batch_link?urls=<链接>&scene=3
 *      → data.batch_shop_manage_promotions[]: promotion_id / product_id /
 *        title / filter_status(0 + filter_status_msg「审核通过」= 可加)
 *   ② POST /api/shop/bind/?ewid=<会话级标识>
 *      body { pmts:[{promotion_id, bind_source:"0", link_url}], hide_status:2 }
 *      → code 0 / msg「成功添加1件商品至橱窗」/ data.success_count / failure_list
 *
 * 【为什么直提、不点平台的「添加商品」弹窗】示范里平台自己就是这两步完成的:
 *   解析链接 + 绑定一步到位。走接口不会把用户正在填的抽屉顶掉,也不依赖弹窗 DOM
 *   (该页的「添加商品」是抽屉 + 页签结构,点击链一改就废)。
 *
 * 【多条】用户 2026-11-06 定:「多条一起,最高 30 条」。解析并发 4 路;
 *   绑定按每批 10 条提交 —— 单批过大容易被平台按数量驳回,分批也才好报进度。
 *
 * 【已在橱窗】不预查列表(要翻页,慢且易错),交给平台返回的失败原因识别:
 *   原因为「已在橱窗」类的单独计数,不混进「失败」。
 */
(function shopPaste() {
  'use strict';

  if (window.__dycShopPasteLoaded) return;
  window.__dycShopPasteLoaded = true;
  if (typeof dycReadFlags !== 'function' || typeof dycWatchFlags !== 'function') return;

  const BTN_TEXT = '粘贴加橱窗';
  const SOURCE = '粘贴加橱窗';

  /* 一次最多处理 30 条(用户 2026-11-06 定)+ 每批绑定 10 条 + 解析并发 4 路 */
  const MAX_LINKS = 30;
  const BIND_BATCH = 10;
  const RESOLVE_WORKERS = 4;

  /* 平台「已经在橱窗里」类原因的识别口径。
     ⚠️ 这是**平台原文**的词,不按我们自己的文案改写 —— 改错了匹配不到,
        就退化成「把已在橱窗的商品报成失败」;也不加 g 标志(test 会记 lastIndex)。 */
  const RE_ALREADY = /已在橱窗|也在?橱窗中|已经添加过|重复添加|请勿重复/;

  /* failure_list 每条里可能装原因的字段(平台字段名未定死,挨个试,取第一个非空) */
  const FAIL_REASON_FIELDS = ['fail_reason', 'reason', 'fail_msg', 'err_msg', 'msg'];

  let on = false;
  let busy = false;
  let btn = null;
  let nativeEl = null;   // 平台的「添加商品」,用来判断按钮是否被页面重渲染挤开
  let retryTimer = null;
  let feedbackTimer = null;

  function log(msg) {
    try {
      if (typeof debugLog === 'function') debugLog(msg);
    } catch (e) { /* 日志不影响主流程 */ }
  }

  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  function visible(el) {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }

  function buttonFeedback(text, kind) {
    if (feedbackTimer) clearTimeout(feedbackTimer);
    feedbackTimer = null;
    if (!btn) return;
    btn.textContent = text;
    btn.setAttribute('aria-label', text);
    if (!busy) {
      /* 三态:绿勾=加进去了,橙感叹=本来就在橱窗(无需动作),红叉=失败 */
      const color = kind === 'success' ? '#16803c' : (kind === 'warning' ? '#a8642a' : '#c03532');
      const d = kind === 'success' ? 'M5 12l4 4L19 6'
        : (kind === 'warning' ? 'M12 6.5v7.6M12 17.4v.3' : 'M6 6l12 12M18 6L6 18');
      btn.innerHTML = '<svg class="dyc-shopwinpaste-result" viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" style="color:' +
        color + '"><path d="' + d + '" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
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

  /* ==========================================================
   * 一、按钮注入(原生「添加商品」左边,文档流兄弟)
   * ========================================================== */

  /** 本脚本只在这一页干活;SPA 切走(中控台等)要自动摘掉按钮 */
  function inScope() {
    const p = window.DYC_PAGE_PATTERNS;
    return !!(p && p.shopWindow && p.shopWindow.test(location.href));
  }

  /**
   * 找平台自己的「添加商品」按钮。
   * ⚠️ 该页还有同名**页签**(添加商品抽屉里的 tab),文本一模一样并且也带
   *    「添加商品」四个字;认错就会把按钮挂到抽屉里的 tab 旁边。所以:
   *   ① 跳过 tab 容器内的节点;② 只认可见的;③ 优先真正的 <button>。
   */
  function findNativeAddButton() {
    if (typeof findAllByText !== 'function') return null;
    const nodes = findAllByText('添加商品', { exact: true });
    let fallback = null;
    for (const node of nodes) {
      const el = node.closest('button, a, [role="button"]') || node;
      if (el.closest('[role="tab"], [class*="tabs-tab"], [class*="tabpane"]')) continue;
      if (!visible(el)) continue;
      if (el.tagName === 'BUTTON') return el;
      if (!fallback) fallback = el;
    }
    return fallback;
  }

  function ensureButton() {
    if (!on) return;
    if (!inScope()) { removeButton(); return; }

    const native = findNativeAddButton();
    if (!native || !native.parentNode) {
      if (!retryTimer) {
        retryTimer = setTimeout(() => { retryTimer = null; ensureButton(); }, 1500);
      }
      return;
    }

    if (btn && btn.isConnected) {
      /* 已经挂着,但被页面重渲染挪了位 → 贴回「添加商品」左边(不动别人的按钮) */
      nativeEl = native;
      if (native.previousElementSibling !== btn) native.parentNode.insertBefore(btn, native);
      return;
    }

    btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'dyc-shopwinpaste-btn';
    btn.textContent = BTN_TEXT;
    btn.title = '粘贴商品链接，一步到位加进橱窗。\n可一次粘多条，最多 ' + MAX_LINKS + ' 条。';
    btn.addEventListener('click', onClick);
    native.parentNode.insertBefore(btn, native);
    nativeEl = native;
    log('粘贴加橱窗:按钮已挂到「添加商品」左边');
  }

  function removeButton() {
    if (btn && btn.parentNode) btn.parentNode.removeChild(btn);
    btn = null;
  }

  /* ==========================================================
   * 二、剪贴板 → 链接列表
   * ========================================================== */

  /**
   * 从剪贴板里取出**所有**商品链接(2026-11-06 用户定:多条一起加)。
   * 只认带数字商品 id 的链接(盟主站/百应站两个域名族);
   * 同一 id 重复出现只算一条;整段文字/口令一律不猜。
   * @returns {{list:Array<{id:string, link:string}>, total:number}} total = 去重后的总条数
   */
  function parseLinks(text) {
    const s = String(text || '');
    const re = /((?:https?:\/\/)?(?:[a-z0-9-]+\.)*jinritemai\.com\/[^\s"'<>，。、；]*?[?&](?:id|product_id)=(\d{10,})[^\s"'<>，。、；]*)/gi;
    const list = [];
    const seen = new Set();
    let m;
    while ((m = re.exec(s)) !== null) {
      const id = m[2];
      if (seen.has(id)) continue;
      seen.add(id);
      let link = m[1];
      if (!/^https?:\/\//i.test(link)) link = 'https://' + link;
      list.push({ id: id, link: link });
    }
    return { list: list, total: list.length };
  }

  /**
   * 读剪贴板:内容脚本直读 navigator.clipboard 受页面 clipboard-read 约束,
   * 实测会一直悬着;改走后台离屏文档代读(带扩展 clipboardRead 权限),
   * 失败再退回直读,全程 3 秒超时,绝不挂死。
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
          if (r && r.ok) { finish(true, r.text || ''); return; }
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
    return { status: resp.status, text: text, via: 'isolated' };
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
   * 四、解析 + 绑定(接口见文件头)
   * ========================================================== */

  /** 单条链接 → 商品(接口 ①) */
  async function resolveOne(ewid, item) {
    const url = '/pc/selection_tool/batch_link?ewid=' + encodeURIComponent(ewid) +
      '&urls=' + encodeURIComponent(item.link) + '&scene=3';
    const r = await pageFetch(url, { method: 'GET' });
    const j = safeJson(r.text);
    if (!j || j.code !== 0) {
      return { ok: false, id: item.id, why: (j && j.msg) || ('HTTP ' + r.status) };
    }
    const list = (j.data && j.data.batch_shop_manage_promotions) || [];
    const p = list[0];
    if (!p || !p.promotion_id) {
      return { ok: false, id: item.id, why: '链接没解析出商品(可能不是联盟商品)' };
    }
    if (p.filter_status !== 0) {
      return {
        ok: false, id: item.id, title: p.title || '',
        why: p.filter_status_msg || ('不可添加(' + p.filter_status + ')')
      };
    }
    return {
      ok: true, id: item.id, link: item.link,
      promotion_id: String(p.promotion_id),
      product_id: String(p.product_id || ''),
      title: p.title || ''
    };
  }

  /** 并发解析(限 4 路,30 条也不会一次把页面请求打满) */
  async function resolveAll(ewid, items) {
    const out = new Array(items.length);
    let next = 0;
    async function worker() {
      for (;;) {
        const i = next++;
        if (i >= items.length) return;
        try {
          out[i] = await resolveOne(ewid, items[i]);
        } catch (e) {
          out[i] = { ok: false, id: items[i].id, why: (e && e.message) || '解析异常' };
        }
      }
    }
    const workers = [];
    const n = Math.min(RESOLVE_WORKERS, items.length);
    for (let k = 0; k < n; k++) workers.push(worker());
    await Promise.all(workers);
    return out;
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

  /**
   * 提交一批(接口 ②)。每批最多 BIND_BATCH 条。
   * @returns {Promise<{ok:boolean, why:string, added:Array, failed:Array}>}
   */
  async function bindBatch(ewid, targets) {
    const body = {
      pmts: targets.map((t) => ({
        promotion_id: t.promotion_id,
        bind_source: '0',
        link_url: t.link
      })),
      hide_status: 2
    };
    const r = await pageFetch('/api/shop/bind/?ewid=' + encodeURIComponent(ewid), {
      method: 'POST',
      body: JSON.stringify(body)
    });
    const j = safeJson(r.text);
    const codeOk = !!(j && (j.code === 0 || (j.code === undefined && j.st === 0)));
    if (!codeOk) {
      const why = (j && j.msg) || ('HTTP ' + r.status);
      return { ok: false, why: why, added: [], failed: targets.map((t) => ({ ...t, why: why })) };
    }
    const d = j.data || {};
    const failList = Array.isArray(d.failure_list) ? d.failure_list : [];
    const okCount = Number(d.success_count || 0);
    const added = [];
    const failed = [];
    for (const t of targets) {
      const hit = failList.find((f) => String((f && f.promotion_id) || '') === t.promotion_id);
      if (hit) failed.push({ ...t, why: failReasonOf(hit) });
      else added.push(t);
    }
    /* failure_list 不逐条给原因时,平台只回条数 —— 超出条数的按「未确认」处理,
       不能把没确认的算成成功(否则用户以为加进去了,列表里却没有)。 */
    if (added.length > okCount) {
      const unconfirmed = added.splice(okCount);
      for (const t of unconfirmed) {
        failed.push({ ...t, why: (d.msg || j.msg || '平台未确认加入') });
      }
    }
    return { ok: true, why: '', added: added, failed: failed };
  }

  /* ==========================================================
   * 五、页面侧收尾:刷新 + 定位
   * ========================================================== */

  /** 点一下平台自己的「刷新商品」,让刚绑定的商品显现(有就点,没有就算了) */
  function clickRefreshGoods() {
    if (typeof findAllByText !== 'function') return;
    const nodes = findAllByText('刷新商品', { exact: false });
    if (!nodes.length) return;
    const target = nodes[0].closest('button, a, [role="button"]') || nodes[0];
    try { target.click(); } catch (e) { /* 忽略 */ }
  }

  /** 在商品表里按标题找刚加进去的那一行(只用于单条时的定位闪烁) */
  function findRowByTitle(title) {
    const key = String(title || '').replace(/\s+/g, '').slice(0, 20);
    if (key.length < 6) return null;
    const rows = document.querySelectorAll('tbody tr, [class*="table-row"]');
    for (const row of rows) {
      if (row.className && String(row.className).indexOf('measure-row') >= 0) continue;
      if (!visible(row)) continue;
      const t = (row.textContent || '').replace(/\s+/g, '');
      if (t.indexOf(key) >= 0) return row;
    }
    return null;
  }

  /* ==========================================================
   * 六、点击主流程
   * ========================================================== */

  async function onClick(e) {
    e.preventDefault();
    e.stopPropagation();
    if (busy) return;
    busy = true;
    let resultText = '失败 !';
    let resultKind = 'failure';
    buttonFeedback('读取中', '');

    try {
      let text = '';
      try {
        text = await readClipboard();
      } catch (err) {
        toast('读不到剪贴板:请允许读取,或先复制商品链接', 'warning',
          { source: SOURCE, keepHistory: false });
        log('粘贴加橱窗:剪贴板读取失败 ' + (err && err.message));
        return;
      }

      const parsed = parseLinks(text);
      const items = parsed.list.slice(0, MAX_LINKS);
      if (!items.length) {
        toast('没认出商品链接', 'warning',
          { source: SOURCE, count: '复制带 id 的商品链接', keepHistory: false });
        log('粘贴加橱窗:剪贴板里没有商品链接「' +
          String(text || '').replace(/\s+/g, ' ').slice(0, 80) + '」');
        return;
      }
      const overflow = parsed.total - items.length;
      log('粘贴加橱窗:剪贴板 ' + parsed.total + ' 条链接,本次处理 ' + items.length + ' 条' +
        (overflow > 0 ? '(超上限 ' + overflow + ' 条未处理)' : ''));

      const ewid = findEwid();
      if (!ewid) {
        failStatus('没拿到页面会话标识(ewid),请刷新页面后重试', { source: SOURCE });
        log('粘贴加橱窗:ewid 未找到');
        return;
      }

      buttonFeedback('加橱窗中', '');
      updateProgress(0, items.length, '正在加橱窗', { source: SOURCE });

      // ① 逐条解析
      const resolved = await resolveAll(ewid, items);
      const good = resolved.filter((r) => r.ok);
      const bad = resolved.filter((r) => !r.ok);
      log('粘贴加橱窗:解析完成,可加 ' + good.length + ',不可加 ' + bad.length);

      // ② 分批提交
      let added = [];
      let failed = bad.map((r) => ({ id: r.id, title: r.title || '', why: r.why }));
      let done = 0;
      for (let i = 0; i < good.length; i += BIND_BATCH) {
        const chunk = good.slice(i, i + BIND_BATCH);
        const b = await bindBatch(ewid, chunk);
        added = added.concat(b.added);
        failed = failed.concat(b.failed);
        done += chunk.length;
        updateProgress(done, items.length, '正在加橱窗', { source: SOURCE });
        if (!b.ok) log('粘贴加橱窗:第 ' + (i / BIND_BATCH + 1) + ' 批失败 ' + b.why);
      }
      log('粘贴加橱窗:绑定完成,成功 ' + added.length + ',其他 ' + failed.length);

      // ③ 已在橱窗 vs 真失败
      const already = [];
      const realFail = [];
      for (const f of failed) {
        (RE_ALREADY.test(String(f.why || '')) ? already : realFail).push(f);
      }

      // ④ 刷新 + 单条定位
      if (added.length) {
        clickRefreshGoods();
        await sleep(900);
        if (added.length === 1) {
          const el = findRowByTitle(added[0].title);
          if (el) {
            if (typeof scrollElementToViewportCenter === 'function') scrollElementToViewportCenter(el);
            if (typeof highlight === 'function') highlight(el);
          }
        }
      }

      // ⑤ 一条消息(三段式:来源 ｜ 值 ｜ 结果词;长原因进 full)
      const names = added.map((p) => p.title || ('商品 ' + p.product_id)).filter(Boolean);
      const failedText = realFail.map((f) => (f.title || ('链接 ' + f.id)) +
        (f.why ? ':' + f.why : '')).join(';');
      const alreadyText = already.map((f) => f.title || ('链接 ' + f.id)).join('、');
      const extra = [];
      if (already.length) extra.push('已在橱窗 ' + already.length + ' 个' + (alreadyText ? ':' + alreadyText : ''));
      if (realFail.length) extra.push('未加入 ' + realFail.length + ' 个:' + failedText);
      if (overflow > 0) extra.push('另有 ' + overflow + ' 条超过 ' + MAX_LINKS + ' 条上限,本次未处理');

      const firstTitle = (added[0] && added[0].title) || (failed[0] && failed[0].title) || '';
      const subject = (items.length === 1 && firstTitle) ? firstTitle : (items.length + ' 个商品');
      const full = extra.join('。');

      if (added.length && !realFail.length) {
        resultText = '已加橱窗';
        resultKind = 'success';
        const head = names.length > 1 ? '已加入:' + names.join('、') : '';
        const fullAll = [head, extra.join('。')].filter(Boolean).join('。');
        finishStatus(subject, {
          source: SOURCE,
          count: '已加入橱窗',
          full: fullAll || undefined
        });
      } else if (added.length) {
        resultText = '部分加入';
        resultKind = 'failure';
        setStatus(subject, 'warning', {
          source: SOURCE,
          count: '加入 ' + added.length + '、未加入 ' + realFail.length,
          full: (names.length ? '已加入:' + names.join('、') + '。' : '') + full,
          keepHistory: true
        });
      } else if (already.length && !realFail.length) {
        resultText = '已加过';
        resultKind = 'warning';
        setStatus(subject, 'warning', {
          source: SOURCE, count: '已在橱窗', full: full, keepHistory: true
        });
      } else {
        resultText = '失败 !';
        resultKind = 'failure';
        setStatus(subject, 'alert', {
          source: SOURCE, count: '未加入',
          full: full || '平台没有确认加入,请稍后重试',
          keepHistory: true
        });
      }
      log('粘贴加橱窗:完成 ' + subject + ' · 加入 ' + added.length + ' / 已在 ' + already.length +
        ' / 失败 ' + realFail.length);
    } catch (err) {
      failStatus('加橱窗异常:' + (err && err.message), { source: SOURCE });
      log('粘贴加橱窗:异常 ' + (err && err.message));
    } finally {
      busy = false;
      buttonFeedback(resultText, resultKind);
    }
  }

  /* ==========================================================
   * 七、开关与挂载
   * ========================================================== */

  function start() {
    if (on) return;
    on = true;
    ensureButton();
    if (!start.__keep) {
      start.__keep = setInterval(() => {
        if (!on) return;
        /* 只做极轻的引用比较:按钮被摘掉、或被页面重渲染挤离原位才重新挂。
           全页扫「添加商品」很贵(该页近 4000 个元素),不能每 2 秒跑一次。 */
        if (!btn || !btn.isConnected) ensureButton();
        else if (nativeEl && nativeEl !== btn.nextElementSibling) ensureButton();
      }, 2000);
    }
  }

  function stop() {
    on = false;
    removeButton();
  }

  dycReadFlags().then((flags) => {
    if (flags.shopPaste !== false) start();
  });
  dycWatchFlags((flags) => {
    const want = flags.shopPaste !== false;
    if (want) start(); else stop();
  });
})();
