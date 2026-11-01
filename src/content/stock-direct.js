/**
 * 清空库存 · 直提链路（2026-10-23 二期）
 * ============================================================
 * 【这是什么】点「清空库存」后不再展开编辑区、不模拟点击，
 *   直接向平台接口提交清零参数。参数结构来自 2026-10-23 真机接口取样
 *   （用户配合、商品列表页实测，商品为批次库存形态）：
 *
 *   ① POST /stock/manage/detail   body {"product_id":"…","source":"pc"}
 *      → data.sku_detail_list[]：sku_id / total_stock_num /
 *        batch_stock_list[]{arrive_time, stock_num} / warehouse_stock_list
 *   ② POST /stock/manage/edit     body
 *      {"stock_list":[{sku_id, batch_stock_list:[
 *          {arrive_time, inventory_type, stock_base_num:0, stock_incr_num:-当前库存}
 *       ], product_id}…], "scene":"商品管理页-编辑库存","appid":1}
 *      → {"code":0,"msg":"success"} 即成功
 *
 *   接口取样语义：全部清零 = 对每个批次「基准 0 + 增量 = 负的当前库存」；
 *   inventory_type 与 arrive_time 对应（0=现货，>0=预售）。
 *
 * 【铁律】
 *   - 任何一步失败（明细拉不到 / 特殊库存形态 / 提交被拒）→ 返回 ok:false，
 *     由 clear-stock.js **静默回退**到原点击链路（用户 2026-10-21 拍板口径），
 *     全程不弹中间态消息（一次动作只出一条消息的纪律）。
 *   - 只在用户点击按钮时单发一次请求；不批量、不重试、不后台自动跑。
 *   - 参数只在本机流转，不上传。
 *   - 区域库存（warehouse_stock_list 非空）/ 非普通 stock_type / forbid_edit
 *     等接口取样未覆盖的形态一律不直提，交给点击链路（平台自己的清零逻辑兜底）。
 */
(function () {
  'use strict';

  if (window.__DYC_STOCK_DIRECT__) return;

  var SCENE = '商品管理页-编辑库存';

  function log(msg) {
    if (typeof debugLog === 'function') debugLog(msg);
  }

  /**
   * 拉取 SKU 明细（接口取样①）
   * @returns {Promise<{skus:Array, data:Object}|null>} 失败 / 结构不符返回 null
   */
  function fetchSkuDetail(productId) {
    return fetch('/stock/manage/detail', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json;charset=UTF-8' },
      body: JSON.stringify({ product_id: String(productId), source: 'pc' })
    }).then(function (resp) {
      return resp.text();
    }).then(function (text) {
      var json = null;
      try { json = JSON.parse(text); } catch (e) { return null; }
      if (!json || json.code !== 0 || !json.data) return null;
      var list = json.data.sku_detail_list;
      if (!Array.isArray(list) || !list.length) return null;
      return { skus: list, data: json.data };
    }).catch(function () { return null; });
  }

  /**
   * 由明细组装「全部清零」提交体（镜像接口取样②语义）
   * 特殊形态守卫：区域库存 / 非普通库存类型 / 禁改 → 返回 null（回退点击链路）
   */
  function buildClearBody(productId, skuList, detailData) {
    var data = detailData || {};

    // 接口取样未覆盖的形态一律不直提
    if (data.forbid_edit) return null;
    if (data.stock_level !== undefined && Number(data.stock_level) !== 0) return null;

    var stockList = [];
    for (var i = 0; i < skuList.length; i++) {
      var sku = skuList[i];

      if (sku.status !== undefined && Number(sku.status) !== 0) return null;
      if (sku.stock_type !== undefined && Number(sku.stock_type) !== 0) return null;
      if (sku.warehouse_stock_list && sku.warehouse_stock_list.length) return null;

      var batches = Array.isArray(sku.batch_stock_list) ? sku.batch_stock_list : [];
      var items = batches.length ? batches
        : [{ arrive_time: 0, stock_num: sku.total_stock_num || 0 }];   // 无批次结构的老商品按单一现货处理

      var batchOut = [];
      for (var j = 0; j < items.length; j++) {
        var arrive = Number(items[j].arrive_time || 0);
        var stock = Number(items[j].stock_num || 0);
        if (!Number.isFinite(arrive) || arrive < 0 || !Number.isFinite(stock) || stock < 0) return null;
        batchOut.push({
          arrive_time: arrive,
          inventory_type: arrive === 0 ? 0 : 1,
          stock_base_num: 0,
          stock_incr_num: -stock
        });
      }

      stockList.push({
        sku_id: String(sku.sku_id),
        batch_stock_list: batchOut,
        product_id: String(productId)
      });
    }

    return JSON.stringify({ stock_list: stockList, scene: SCENE, appid: 1 });
  }

  /** 提交（接口取样②）。成功 = HTTP 200 且 code === 0 */
  function postEdit(body) {
    return fetch('/stock/manage/edit', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json;charset=UTF-8' },
      body: body
    }).then(function (resp) {
      return resp.text().then(function (text) {
        var json = null;
        try { json = JSON.parse(text); } catch (e) { /* 保持 null */ }
        var ok = resp.status === 200 && !!json && json.code === 0;
        return {
          ok: ok,
          msg: json ? (json.msg || '') : ('HTTP ' + resp.status),
          subMsg: json ? (json.sub_msg || json.subCode || '') : ''
        };
      });
    }).catch(function (e) {
      return { ok: false, msg: (e && e.message) || 'network', subMsg: '' };
    });
  }

  /**
   * 明细里的库存总数（有批次就按批次求和，无批次结构的老商品取 total_stock_num）
   *
   * 抽出来给两处共用：直提前的「已全部为 0」判断，以及下面的只读探针。
   * 用的是 SKU 明细里的原始数值，不做显示层换算。
   */
  function stockTotalFromSkus(skuList) {
    var total = 0;
    var list = Array.isArray(skuList) ? skuList : [];
    for (var i = 0; i < list.length; i++) {
      var s = list[i] || {};
      var bs = Array.isArray(s.batch_stock_list) ? s.batch_stock_list : [];
      if (bs.length) {
        for (var j = 0; j < bs.length; j++) total += Number(bs[j].stock_num || 0);
      } else {
        total += Number(s.total_stock_num || 0);
      }
    }
    return total;
  }

  /**
   * 只读探针：问接口这个商品到底还有没有库存（2026-10-29 反馈 #124）
   *
   * 起因：商品列表行里的「总库存」是从页面文本里解析出来的，遇到区域库存、
   * 批次库存这类形态可能读成 0。原来一读到 0 就在点击入口直接拦掉，
   * 用户只会看到「库存已经没有了」，根本点不动清零 —— 反馈里说的
   * 「没法清空第一个的库存」属于这一类可能。
   * 现在把「有没有库存」交给接口回答：它说没有才拦，它说有就照常走。
   *
   * 只读，不提交任何修改。接口失败或结构不符返回 null，
   * 由调用方决定怎么讲 —— 不能拿行内那个 0 当结论。
   *
   * @param {string|number} productId
   * @returns {Promise<number|null>}
   */
  function probeStockTotal(productId) {
    var pid = String(productId || '');
    if (!/^\d{6,}$/.test(pid)) return Promise.resolve(null);
    return fetchSkuDetail(pid).then(function (detail) {
      if (!detail) return null;
      return stockTotalFromSkus(detail.skus);
    }).catch(function () { return null; });
  }

  /**
   * 直提主入口
   * @param {string|number} productId 商品 ID（行内 extractProductInfo 提取）
   * @returns {Promise<{ok:boolean, why?:string}>}
   *   ok:false 时调用方静默回退点击链路，不弹消息。
   */
  function tryDirectClearStock(productId) {
    var pid = String(productId || '');
    if (!/^\d{6,}$/.test(pid)) return Promise.resolve({ ok: false, why: 'no-product-id' });

    return fetchSkuDetail(pid).then(function (detail) {
      if (!detail) return { ok: false, why: 'sku-list-empty' };

      // 先验证字段与特殊库存形态，非法值不得被归零判断或 JSON 转 null 掩盖。
      var body = buildClearBody(pid, detail.skus, detail.data);
      if (!body) return { ok: false, why: 'unsupported-stock-shape' };
      // 已全部为 0:不提交也不展开编辑区,由调用方报「无需清零」
      var total = stockTotalFromSkus(detail.skus);
      if (total <= 0) {
        /* 2026-10-30：整批被误判成「本就为 0」时，这条是唯一能定案的现场信息 ——
         * 记下接口算出的合计、SKU 条数、首条 SKU 的字段名。库存 v2 / 批次结构
         * 换了字段名时，合计必然算成 0，而页面行内数字不会是 0，两边一对就知道。 */
        var first = (detail.skus && detail.skus[0]) || {};
        log('直提判为已是 0：接口合计 ' + total + '，SKU ' + (detail.skus || []).length +
          ' 条，字段 [' + Object.keys(first).slice(0, 10).join(',') + ']');
        return { ok: false, why: 'already-zero' };
      }

      return postEdit(body).then(function (r) {
        if (!r.ok) {
          log('直提被拒:' + r.msg + (r.subMsg ? ' / ' + r.subMsg : ''));
          return { ok: false, why: 'edit-rejected' };
        }
        return { ok: true };
      });
    });
  }

  /**
   * 成功后把行内「总库存」显示改为 0（纯显示层，立即反馈；
   * 列表真实数据以平台自身刷新为准 —— 翻页 / 刷新后自然一致）
   */
  function updateRowStockDisplay(row) {
    try {
      if (!row) return;
      var cell = (typeof findByClassPrefix === 'function')
        ? findByClassPrefix(row, 'style_totalInventory__') : null;
      if (!cell) return;

      var walker = document.createTreeWalker(cell, NodeFilter.SHOW_TEXT);
      var node;
      while ((node = walker.nextNode())) {
        var t = (node.textContent || '').trim();
        if (/^\d{1,7}$/.test(t)) {
          node.textContent = '0';
          return;
        }
      }
    } catch (e) { /* 显示层失败不影响清零结果 */ }
  }

  window.__DYC_STOCK_DIRECT__ = {
    tryDirectClearStock: tryDirectClearStock,
    probeStockTotal: probeStockTotal,
    updateRowStockDisplay: updateRowStockDisplay
  };
})();
