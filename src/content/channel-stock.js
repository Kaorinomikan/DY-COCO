/**
 * 渠道品页 · 清空库存（2026-10-24 新增，用户拍板口径）
 * ============================================================
 * 【行为】渠道品列表页（/ffa/g/channel-goods-manage/list）给**独立库存**
 *   的渠道品行注「清空库存」按钮；点击 = 直提（不模拟点击），只清该渠道品
 *   自己的库存。行内带「与主品共享」的渠道品**不注按钮** —— 它们没有自己
 *   的库存可清（用户原话：只清理那种不是与主品共享库存的渠道品）。
 *
 * 【接口】与主品列表页同一套（stock-direct.js）：
 *   POST /stock/manage/detail → POST /stock/manage/edit，渠道品也是商品。
 *   该页没有可回退的点击链路（渠道品行没有库存编辑区），所以失败必须
 *   报清楚原因，不静默。若接口对渠道品 ID 被拒，调试面板的
 *   「开始接口取样 30 秒」按钮是保底侦察通道（用户手动清一次 → 复制报告）。
 *
 * 【注入几何】复用主页面 #73 的教训：**文档流内子节点，不算坐标**。
 *   按表头「库存」的 cellIndex 找到本行对应单元格，把按钮槽（块级 div）
 *   追加为该格最后一个子节点 —— 落在库存文字下方，零冲突、不挤压。
 *   找不到「库存」表头就不注入（宁可没有，不再来一次歪按钮）。
 */
(function () {
  'use strict';

  if (window.__DYC_CHANNEL_STOCK__) return;

  var loggedEmptyOnce = false;    // 空扫描只记一次,避免报告被刷屏
  var loggedSampleOnce = false;   // 表头/行文本采样只记一次(识别口径修正用)
  var lastStatsKey = '';          // 统计状态去重:状态不变不重复记

  /** 表头文案紧缩匹配（去空白） */
  function tight(s) {
    return (s || '').replace(/\s+/g, '');
  }

  /**
   * 找「库存」表头单元格
   * 真机采样(2026-10-24):渠道品页库存列头是复合文案
   * 「剩余渠道品库存渠道品分配库存」—— 含「库存」与「渠道」、不含「总」即认;
   * 短文案「库存」仍保留兼容。
   */
  function findChannelStockHeaderCell() {
    const ths = document.querySelectorAll('th');
    let fallback = null;
    for (const th of ths) {
      const t = tight(th.textContent);
      if (t === '库存') return th;
      if (!fallback && t.length <= 20 && t.indexOf('总') < 0 && /库存/.test(t) &&
          (/渠道/.test(t) || /剩余/.test(t) || t.length <= 6)) {
        fallback = th;
      }
    }
    return fallback;
  }

  /**
   * 提取渠道品双 ID(真机采样 2026-10-24:行内是「渠道ID:」与「主品ID:」两个标签)
   * 渠道品清零接口(接口取样 /product/tproduct/partial_update_channel_product)
   * 同时需要主品 ID 与渠道品 ID——两者缺一不可,缺即视为不可判定。
   */
  function extractChannelMeta(row) {
    const text = (row.textContent || '');
    const ch = text.match(/渠道\s*ID\s*[:：]?\s*(\d{10,})/i);
    const main = text.match(/主品\s*ID\s*[:：]?\s*(\d{10,})/i);
    if (ch && main) return { channelId: ch[1], mainProductId: main[1] };
    return null;
  }

  /** 旧口径兼容:只取渠道品 ID(点击前快速判存) */
  function extractChannelProductId(row) {
    const meta = extractChannelMeta(row);
    return meta ? meta.channelId : null;
  }

  /**
   * 从页面资源请求里提取会话级 __token(接口取样确认:渠道品接口的 GET/POST 都带,
   * 值数小时内稳定;页面自己的列表请求 URL 里就有)。取不到时返回空串,
   * 提交仍会尝试——失败会走明确的失败文案。
   */
  function findPageToken() {
    try {
      const entries = performance.getEntriesByType('resource') || [];
      for (let i = entries.length - 1; i >= 0; i--) {
        const m = /__token=([0-9a-f]{16,})/i.exec(entries[i].name || '');
        if (m) return m[1];
      }
    } catch (e) { /* 时间线不可用就空手而归 */ }
    return '';
  }

  /** 渠道品是否与主品共享库存（共享行不注按钮） */
  function isSharedChannelRow(row) {
    return (row.textContent || '').indexOf('与主品共享') >= 0;
  }

  /** 提取渠道品标题(真机采样:行首到「渠道ID」之前就是商品名),保留完整名称 */
  function extractChannelTitle(row) {
    const text = (row.textContent || '').replace(/\s+/g, ' ').trim();
    const idx = text.search(/渠道\s*ID/i);
    let name = idx > 0 ? text.slice(0, idx).trim() : '';
    if (!name) name = '该渠道品';
    return name;
  }

  /** 扫描并注入当前页所有符合条件的渠道品行（row-scan 调度入口） */
  function injectChannelClearButtons() {
    const rows = document.querySelectorAll(
      'tr[class*="ecom-g-table-row"]'
    );

    const headerCell = findChannelStockHeaderCell();
    let count = 0, shared = 0, noId = 0, noCell = 0, done = 0;
    let sampleRowText = '';

    for (const row of rows) {
      if (row.querySelector('.dyb-clear-btn')) { done++; continue; }
      if (isSharedChannelRow(row)) { shared++; continue; }

      // 采样:第一 条非共享行的原文(修 ID 识别口径用)
      if (!sampleRowText) sampleRowText = (row.textContent || '').replace(/\s+/g, ' ').trim();

      const pid = extractChannelProductId(row);
      if (!pid) { noId++; continue; }   // 渠道品ID+主品ID 双证齐全才注

      if (!headerCell) { noId++; continue; }   // 无表头 = 全页都注不了,统一计数
      const idx = headerCell.cellIndex;
      if (typeof idx !== 'number' || idx < 0) { noCell++; continue; }

      let tr = null;
      try {
        tr = (row.matches && row.matches('tr')) ? row : (row.closest ? row.closest('tr') : null);
      } catch (e) { tr = null; }
      if (!tr || !tr.cells || !tr.cells[idx]) { noCell++; continue; }

      const rowTable = tr.closest && tr.closest('table');
      const headerTable = headerCell.closest && headerCell.closest('table');
      if (headerTable && rowTable && headerTable !== rowTable) { noCell++; continue; }

      const cell = tr.cells[idx];
      if (cell.querySelector('.dyb-clear-btn')) { done++; continue; }

      const button = document.createElement('button');
      button.className = 'dyb-clear-btn';
      button.type = 'button';
      button.textContent = '清空库存';
      button.title = '清空渠道品库存，清零后库存归还主品';
      button.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        handleChannelClearClick(row, pid);
      });

      const box = document.createElement('div');
      box.className = 'dyb-clear-slot';
      box.appendChild(button);
      cell.appendChild(box);
      count++;
    }

    // 诊断统计:只在状态变化时记一条(否则每 3 秒刷一条,报告被刷屏)。
    if (typeof debugLog === 'function') {
      const statsKey = rows.length + '|' + count + '|' + shared + '|' + noId +
                       '|' + noCell + '|' + (headerCell ? 1 : 0);
      if (rows.length > 0 && statsKey !== lastStatsKey) {
        lastStatsKey = statsKey;
        debugLog('渠道品扫描:' + rows.length + ' 行,注入 ' + count +
          ',已有 ' + done + ',共享跳过 ' + shared +
          ',无渠道品ID ' + noId + ',找不到库存格 ' + noCell +
          (headerCell ? '' : ' 【没找到「库存」表头】'));

        // 识别口径没吃准时,把真实表头与非共享行原文采样带回报告(只采一次)
        if (!loggedSampleOnce && count === 0) {
          loggedSampleOnce = true;
          const headCells = [];
          document.querySelectorAll('thead th, thead td').forEach(function (c) {
            const t = tight(c.textContent);
            if (t) headCells.push(t);
          });
          debugLog('渠道品表头采样:' + (headCells.length
            ? headCells.slice(0, 14).join(' | ')
            : '本页没有 thead(表头可能是别的结构)'));
          if (sampleRowText) {
            debugLog('渠道品非共享行采样:' + sampleRowText.slice(0, 200));
          }
        }
      } else if (rows.length === 0 && !loggedEmptyOnce) {
        loggedEmptyOnce = true;
        debugLog('渠道品扫描:本页暂时没有渠道品表格行(可能尚未渲染完),继续等监听触发');
      }
    }

    return count;
  }

  /** 点击：确认弹窗 → 直提 */
  function handleChannelClearClick(row, pid) {
    const meta = extractChannelMeta(row);
    if (!meta) {
      clearStockFeedback(row, 'fail');
      toast('没认出渠道品与主品 ID，已取消操作', 'error', { source: '库存清零' });
      return;
    }
    showConfirmDialog({
      title: '确认清空渠道品库存？',
      fields: [
        { label: '渠道品ID', value: meta.channelId },
        { label: '主品ID', value: meta.mainProductId }
      ],
      warning:
        '只清空该渠道品自己的库存；清零后库存归还主品。\n' +
        '执行后不可撤销。与主品共享库存的渠道品不显示此按钮。',
      confirmText: '确定清零',
      cancelText: '取消',
      danger: true,
      onConfirm: () => runChannelDirectClear(row, meta)
    });
  }

  /** 渠道品接口的公共查询参数（接口取样：appid=1 + 会话级 __token + _bid=ffa_goods） */
  function channelApiParams() {
    const p = new URLSearchParams({ appid: '1', _bid: 'ffa_goods' });
    const token = findPageToken();
    if (token) p.set('__token', token);
    return p;
  }

  /**
   * 发同源请求:优先请页面侧转发(MAIN world XHR,自动带平台请求库注入的
   * 安全头——隔离世界的请求会被平台判「当前环境存在风险」);探针不在场时
   * 退回隔离 fetch(可能被平台拦,失败文案会带出平台原文)。
   * @returns {Promise<{status:number, text:string, via:string}>}
   */
  async function pageFetch(url, opts) {
    const probe = window.__DYC_STOCK_PROBE__;
    if (probe && typeof probe.sendRequest === 'function') {
      const r = await probe.sendRequest(url, opts);
      if (r && r.status > 0) {
        return { status: r.status, text: r.text || '', via: 'main' };
      }
      // status 0 = 探针缺席或超时,走兜底
    }
    const resp = await fetch(url, {
      method: opts.method || 'GET',
      credentials: 'include',
      headers: opts.body ? { 'Content-Type': 'application/json;charset=UTF-8' } : undefined,
      body: opts.body || undefined
    });
    const text = await resp.text();
    return { status: resp.status, text: text, via: 'isolated' };
  }

  /** JSON 安全解析（非 JSON 响应返回 null） */
  function safeJson(text) {
    try {
      return JSON.parse(text);
    } catch (e) {
      return null;
    }
  }

  /**
   * 直提执行（接口取样 2026-10-24：渠道品是独立接口体系，与主品完全不同）
   *   ① GET  /product/tproduct/preview_channel_product
   *      ?main_product_id=&channel_id=&channel_type=3&copy_op=false
   *      → data.sku_channel[]（每个 SKU 当前 stock_num）+ share_main_stock
   *   ② POST /product/tproduct/partial_update_channel_product
   *      body {product_id(主), channel_id(渠道), channel_type, share_main_stock:false,
   *            incremental_stock_mode:false, sku_channel:[{sku_id, stock_num:0}],
   *            appid, __token, _bid, _lid}
   *      → code 0 且 data.success === true 即成功
   *   语义：清零 = 每个 SKU 直接给目标库存 0；清零后库存归还主品（平台确认文案）。
   *   本页无点击链路可回退，失败必须报清楚。
   */
  async function runChannelDirectClear(row, meta) {
    const title = extractChannelTitle(row);
    try {
      // ① 渠道品详情（preview）：拿每个 SKU 当前库存 + 复核共享标记
      const q = channelApiParams();
      q.set('main_product_id', meta.mainProductId);
      q.set('channel_id', meta.channelId);
      q.set('channel_type', '3');
      q.set('copy_op', 'false');
      const previewUrl = '/product/tproduct/preview_channel_product?' + q.toString();

      const d = await pageFetch(previewUrl, { method: 'GET' });
      const dJson = safeJson(d.text);
      if (!dJson || dJson.code !== 0 || !dJson.data) {
        const msg = dJson ? (dJson.msg || 'HTTP ' + d.status) : 'HTTP ' + d.status;
        /* 三段式(2026-10-27 用户口径):值=商品名(谁),结果进右端弱位,
         * 完整原因走 full 存进消息盒子 —— 条上一行宽,长句必然被截成「…」。 */
        clearStockFeedback(row, 'fail');
        failStatus(title, {
          source: '库存清零', count: '没拉到渠道品详情',
          full: title + ' 清零失败：没拉到渠道品详情（' + msg + '）'
        });
        if (typeof debugLog === 'function') {
          debugLog('渠道品直提:preview 失败 ' + msg + '(via ' + d.via +
            ',token=' + (findPageToken() ? '有' : '无') + ')');
        }
        return;
      }

      const data = dJson.data;
      if (data.share_main_stock === true) {
        // 双保险：行内口径漏判的共享渠道品，接口侧再拦一道
        clearStockFeedback(row, 'fail');
        failStatus(title, {
          source: '库存清零', count: '与主品共享库存',
          full: title + ' 与主品共享库存，请到商品管理列表清主品库存'
        });
        return;
      }

      const skus = Array.isArray(data.sku_channel) ? data.sku_channel : [];
      if (!skus.length) {
        clearStockFeedback(row, 'fail');
        failStatus(title, {
          source: '库存清零', count: '没有可操作的 SKU',
          full: title + ' 清零失败：渠道品没有可操作的 SKU'
        });
        return;
      }

      const total = skus.reduce((sum, s) => {
        const inner = s.sku_channel || {};
        return sum + Number(inner.stock_num != null ? inner.stock_num : s.stock_num || 0);
      }, 0);
      if (total <= 0) {
        toast(title, 'info', { source: '库存清零', count: '库存已是 0，无需清零' });
        return;
      }

      // ② 清零提交（partial_update）：每个 SKU 直接给目标库存 0
      const body = {
        product_id: meta.mainProductId,
        channel_id: Number(meta.channelId),
        channel_type: 3,
        share_main_stock: false,
        incremental_stock_mode: false,
        sku_channel: skus.map((s) => ({ sku_id: Number(s.sku_id), stock_num: 0 })),
        appid: 1,
        __token: findPageToken(),
        _bid: 'ffa_goods',
        _lid: String(Date.now()).slice(-12)
      };

      const editUrl = '/product/tproduct/partial_update_channel_product?' +
        channelApiParams().toString();
      const e = await pageFetch(editUrl, {
        method: 'POST',
        body: JSON.stringify(body)
      });
      const eJson = safeJson(e.text);
      const ok = !!(eJson && eJson.code === 0 && eJson.data && eJson.data.success === true);

      if (ok) {
        updateChannelStockDisplay(row);
        finishStatus(title, { source: '库存清零', count: '库存已清零' });
        // 接口 success === true 才算清零成功 ⇒ 按钮给勾（2026-10-29）
        clearStockFeedback(row, 'ok');
        return;
      }

      const msg = eJson ? (eJson.msg || eJson.sub_msg || 'HTTP ' + e.status)
                        : 'HTTP ' + e.status;
      clearStockFeedback(row, 'fail');
      failStatus(title, {
        source: '库存清零', count: '清零失败',
        full: title + ' 清零失败：' + msg
      });
      if (typeof debugLog === 'function') debugLog('渠道品直提被拒:' + msg + '(via ' + e.via + ')');
    } catch (e) {
      clearStockFeedback(row, 'fail');
      failStatus(title, {
        source: '库存清零', count: '清零失败 · 网络异常',
        full: title + ' 清零失败：网络异常（' + (e && e.message) + '）'
      });
      if (typeof debugLog === 'function') debugLog('渠道品直提异常:' + (e && e.message));
    }
  }

  /** 成功后把行内库存格里的数字显示改为 0（纯显示层，列表刷新后自然一致） */
  function updateChannelStockDisplay(row) {
    try {
      if (!row) return;
      const headerCell = findChannelStockHeaderCell();
      if (!headerCell) return;
      const idx = headerCell.cellIndex;
      if (typeof idx !== 'number' || idx < 0) return;

      let tr = null;
      try {
        tr = (row.matches && row.matches('tr')) ? row : (row.closest ? row.closest('tr') : null);
      } catch (e) { tr = null; }
      if (!tr || !tr.cells || !tr.cells[idx]) return;

      const walker = document.createTreeWalker(tr.cells[idx], NodeFilter.SHOW_TEXT);
      let node;
      while ((node = walker.nextNode())) {
        if (/\d{1,7}/.test(node.textContent || '')) {
          node.textContent = (node.textContent || '').replace(/\d{1,7}/, '0');
          return;
        }
      }
    } catch (e) { /* 显示层失败不影响清零结果 */ }
  }

  window.__DYC_CHANNEL_STOCK__ = {
    injectChannelClearButtons: injectChannelClearButtons,
    extractChannelProductId: extractChannelProductId
  };
})();
