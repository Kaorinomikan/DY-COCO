/** 微信小店商品行库存清零：按原生扣减量清零，保留平台校验并回读全规格。 */
(function () {
  'use strict';
  if (location.hostname !== 'store.weixin.qq.com') return;
  var flags = null, generation = 0, busy = false, seq = 0, pending = {}, table = null;
  var observer = null, scheduled = false, lastHref = location.href, confirming = false;
  function note(detail, result) {
    if (window.__dycDiag) window.__dycDiag.note('库存清零', detail, result);
  }
  function failure(op, message, uncertain) {
    var error = new Error(op + '：' + message);
    error.uncertain = uncertain; error.op = op;
    note(error.message, '失败');
    return error;
  }
  var ATTR = 'data-dyc-wx-stock';
  function enabled() { return flags && flags.wxClearStock !== false && /^\/shop\/goods\/list\/?$/.test(location.pathname); }
  function textWithoutExt(root) {
    var copy = root.cloneNode(true);
    copy.querySelectorAll('[data-dyc-wx-stock],[data-dyc-wx-stock-wrap],[data-dyc-wx-btn],[data-dyc-wx-btnwrap]').forEach(function (el) { el.remove(); });
    return (copy.textContent || '').replace(/\s+/g, ' ').trim();
  }
  function nameOf(row) {
    var name = row.querySelector('.goods_title_1,[class*="goods_title"],[data-dyc-wxtitle]');
    if (name) return textWithoutExt(name);
    // .title 是商品信息容器；ID 之后属于元信息，不能拿整块当名称。
    var container = row.querySelector('.title');
    return container ? textWithoutExt(container).split(/ID[：:\s]+[0-9]{6,}/i)[0].trim() : '';
  }
  function idOf(row) {
    var ids = Array.from(row.children).map(function (cell) {
      var match = textWithoutExt(cell).match(/ID[：:\s]+([0-9]{6,})/i);
      return match ? match[1] : '';
    }).filter(Boolean);
    return ids.length === 1 ? ids[0] : '';
  }
  function request(op, body) {
    return new Promise(function (resolve, reject) {
      var rid = ++seq;
      var timer = setTimeout(function () { delete pending[rid]; reject(failure(op, '请求超时，结果未确认', true)); }, 14000);
      pending[rid] = function (r) {
        clearTimeout(timer);
        var data = r.data || {};
        var detail = 'HTTP ' + r.status + '，code=' + (data.code === undefined ? '缺失' : data.code);
        if (data.respStatusCode !== undefined) detail += '，respStatusCode=' + data.respStatusCode;
        // 只记录状态与短错误文案，不记录鉴权头或原始响应。
        var message = String(data.msg || data.message || data.errmsg || r.error || '').replace(/https?:\/\/[^\s]+/g, '[链接]').replace(/(token|cookie|authorization|signature|secret|biz[_-]?magic)\s*[:=]\s*[^\s,，;；]+/ig, '$1=[已隐藏]').slice(0, 160);
        if (message) detail += '，' + message;
        if (r.status !== 200 || !r.data || data.code !== 0) return reject(failure(op, detail, r.status === 0 || r.status >= 500 || r.status === 200 && typeof data.code !== 'number'));
        note(op + '：' + detail, '响应成功');
        resolve(data);
      };
      window.postMessage({ source: 'DYC_WX_STOCK_REQ', rid: rid, op: op, body: body }, location.origin);
    });
  }
  window.addEventListener('message', function (e) {
    var m = e.data;
    if (e.source !== window || !m || m.source !== 'DYC_WX_STOCK_RES' || !pending[m.rid]) return;
    var finish = pending[m.rid]; delete pending[m.rid]; finish(m.result || {});
  });
  function skusOf(data, id) {
    if (!Array.isArray(data.products) || data.products.length !== 1) throw new Error('商品库存数据不完整，已停止');
    var list = data.products[0].productSkus;
    if (!Array.isArray(list) || !list.length || list.length > 1000) throw new Error('规格列表不完整，已停止');
    var seen = new Set();
    return list.map(function (s) {
      var k = s.skuKey, info = s.productSkuInfo, stock = info && info.stockInfo;
      if (!k || !k.productKey || String(k.productKey.productId) !== id || !/^\d+$/.test(k.skuId) || seen.has(k.skuId) ||
          !stock || !Number.isSafeInteger(stock.stockNum) || stock.stockNum < 0 ||
          (stock.warehouseStocks && stock.warehouseStocks.length) || Number(k.productKey.stockType || 0) !== 0) throw new Error('库存类型或规格数据不支持，已停止');
      seen.add(k.skuId);
      return { id: k.skuId, stock: stock.stockNum };
    });
  }
  /**
   * 把本行库存列的可售数字就地改成 0（只改显示，不发请求、不重载页面）
   *
   * 2026-11-09 用户口径：清空失败、无需清零都**不许**刷新；成功也不许整页
   * 白屏重载（location.reload 会把筛选、分页、滚动位置一起冲掉）。平台自己
   * 的「刷新列表」也只是让表格数据变新，所以这里直接把这一格的可售库存写 0
   * —— 结果与列表重渲染一致，连局部闪一下都省掉。
   *
   * 只认「整段就是一个 1~7 位数字」的文本节点：库存格里还有「待付款库存 0」
   * 这类别的读数，按正则改整段文本会把它们一起写坏；遇到「12/20」这种非纯
   * 数字形态就放弃改动（宁可不改，也不写错数据）。
   *
   * @returns {boolean} 是否真的改到了一个数字（没改成时调用方不得声称已更新）
   */
  function syncRowStock(row) {
    try {
      var cell = stockCell(row);
      if (!cell) return false;
      var walker = document.createTreeWalker(cell, NodeFilter.SHOW_TEXT);
      var node;
      while ((node = walker.nextNode())) {
        if (!/^\s*\d{1,7}\s*$/.test(node.nodeValue || '')) continue;
        // 只改最靠前那个纯数字（可售库存），同格其它读数原样保留
        node.nodeValue = '0';
        return true;
      }
    } catch (e) { /* 显示层失败不影响清零结果 */ }
    return false;
  }
  async function clear(row, btn) {
    if (busy || !enabled()) return;
    busy = true; btn.disabled = true; btn.textContent = '清零中';
    var token = generation, href = location.href, id = idOf(row), wrote = false;
    var name = nameOf(row).slice(0, 40) || id;
    function guard() { if (!enabled() || generation !== token || location.href !== href || !row.isConnected || idOf(row) !== id) throw new Error('页面或开关已变化，已停止后续提交'); }
    try {
      if (window.__DYC_STOCK_PROBE__) window.__DYC_STOCK_PROBE__.arm(30000);
      note('开始清零 商品ID=' + id);
      if (!id || !Number.isSafeInteger(Number(id))) throw new Error('未识别到有效商品 ID，已停止');
      var first = skusOf(await request('getStockBySpu', { productIdList: [Number(id)] }), id);
      guard();
      if (first.every(function (s) { return s.stock === 0; })) {
        // 无需清零：不刷新，只把这一行的库存显示同步成接口的事实值（2026-11-09）
        var zeroSynced = syncRowStock(row);
        toast(name, 'info', {
          source: '库存清零', count: '无需清零', standalone: true,
          full: '真实库存已为 0，无需清零。' + (zeroSynced ? '该行库存显示已同步为 0。' : '')
        });
        return;
      }
      var check = await request('batchCheckProductByTypeV2', { productIdList: [id], type: 'stock' });
      guard();
      if (check.needDialog !== false || (check.dialogContent && check.dialogContent.length)) throw new Error('平台要求额外确认，请在原生库存入口处理');
      // 原生更新为 0 会换算成扣减当前库存，num=0 会被平台逐规格拒绝。
      var skuList = first.filter(function (s) { return s.stock > 0; }).map(function (s) { return { spuId: id, skuId: s.id, diffType: 2, num: s.stock }; });
      var validation = await request('checkProductEditValid', { skuList: skuList.map(function (s) { return Object.assign({ salePrice: 0 }, s); }), type: 'STOCK' });
      guard();
      if (validation.success !== true || !Array.isArray(validation.errs) || validation.errs.length || !Array.isArray(validation.moduleErrors) || validation.moduleErrors.length) throw new Error('平台库存校验未通过，已停止');
      wrote = true;
      var update = await request('batchUpdateStock', { skuList: skuList });
      var failed = !update.success || update.hasError !== 0 || !Array.isArray(update.list) || !update.list.length || update.list.some(function (r) {
        return r.code !== 0 || r.err || !Array.isArray(r.failSkuId) || r.failSkuId.length || !Array.isArray(r.failSkuItems) || r.failSkuItems.length;
      });
      var after = skusOf(await request('getStockBySpu', { productIdList: [Number(id)] }), id);
      var remaining = after.filter(function (s) { return s.stock !== 0; });
      var complete = after.length === first.length && first.every(function (s) { return after.some(function (a) { return a.id === s.id; }); });
      if (failed || !complete || remaining.length) {
        var failIds = [];
        (update.list || []).forEach(function (r) { failIds = failIds.concat(r.failSkuId || [], (r.failSkuItems || []).map(function (s) { return s.skuId || JSON.stringify(s); })); });
        throw new Error('清零未全部确认；未归零规格：' + (remaining.map(function (s) { return s.id; }).join('、') || '无') + '；接口失败规格：' + (failIds.join('、') || '无明细') + (complete ? '' : '；规格列表已变化'));
      }
      note('商品ID=' + id + '，全部 ' + after.length + ' 个规格回读为 0', '已清零');
      // 成功也不重载页面：只把该行库存显示就地写 0（2026-11-09 用户口径）
      var synced = syncRowStock(row);
      toast(name, 'success', {
        source: '库存清零', count: '已清零 ' + after.length + ' 个规格', standalone: true,
        full: '已回读确认全部规格库存为 0。' + (synced ? '该行库存显示已改为 0。' : '刷新列表后显示会同步为 0。')
      });
    } catch (e) {
      var result = !wrote ? '未完成' : e.op === 'batchUpdateStock' && e.uncertain === false ? '提交被拒绝' : e.op === 'getStockBySpu' ? '回读失败，需核对' : e.op === 'batchUpdateStock' ? '提交结果需核对' : '清零未全部确认';
      note('商品ID=' + id + '，' + e.message, result);
      toast(name || '当前商品', 'error', { source: '库存清零', count: result, standalone: true, full: e.message });
    } finally { busy = false; btn.disabled = false; btn.textContent = '清空库存'; }
  }
  function openConfirm(row, btn) {
    if (busy || confirming || !enabled()) return;
    var id = idOf(row), href = location.href, token = generation;
    var name = nameOf(row) || id;
    confirming = true;
    try {
      showConfirmDialog({
        title: '确认清空该商品库存？',
        fields: [{ label: '商品名', value: name || '未识别' }, { label: '商品ID', value: id || '未识别' }],
        warning: '此操作将把该商品所有规格的普通库存清零，执行后不可撤销。\n若该商品正在直播中，会导致直播间无法继续下单。',
        confirmText: '确定清零', cancelText: '取消', danger: true,
        onConfirm: function () {
          confirming = false;
          if (!enabled() || generation !== token || location.href !== href || !row.isConnected || idOf(row) !== id) {
            toast(name || '当前商品', 'info', { source: '库存清零', count: '页面已变化，未提交', standalone: true }); return;
          }
          clear(row, btn);
        },
        onCancel: function () { confirming = false; }
      });
    } catch (e) {
      confirming = false;
      note('确认框打开失败', '未提交');
      toast(name || '当前商品', 'error', { source: '库存清零', count: '确认框打开失败', full: e.message, standalone: true });
    }
  }
  function stockCell(row) {
    var owner = row.closest('table');
    if (!owner) return null;
    var headers = owner.querySelectorAll('thead tr:last-child th,thead tr:last-child td');
    var index = Array.from(headers).findIndex(function (h) { return textWithoutExt(h) === '库存'; });
    return index >= 0 ? row.children[index] : null;
  }
  function roots() {
    var list = [document];
    for (var i = 0; i < list.length && i < 12; i++) {
      list[i].querySelectorAll('micro-app').forEach(function (el) { if (el.shadowRoot && list.indexOf(el.shadowRoot) < 0) list.push(el.shadowRoot); });
    }
    return list;
  }
  function remove() {
    roots().forEach(function (r) { r.querySelectorAll('[' + ATTR + '],[data-dyc-wx-stock-wrap]').forEach(function (b) { b.remove(); }); });
    if (observer) observer.disconnect(); observer = null; table = null;
  }
  function scan() {
    scheduled = false;
    if (!enabled()) return;
    if (!table || !table.isConnected) {
      table = null;
      roots().some(function (root) { return Array.from(root.querySelectorAll('tbody')).some(function (tb) {
        if (!Array.from(tb.querySelectorAll('tr')).some(function (row) { return idOf(row) && row.getBoundingClientRect().width > 0; })) return false;
        table = tb; return true;
      }); });
      if (!table) return;
      if (observer) observer.disconnect();
      observer = new MutationObserver(schedule); observer.observe(table, { childList: true, subtree: true });
    }
    table.querySelectorAll('tr').forEach(function (row) {
      if (!idOf(row) || row.querySelector('[' + ATTR + ']')) return;
      var cell = stockCell(row);
      var content = cell && cell.querySelector('.weui-desktop-table_flex > div');
      var target = content || cell;
      if (!cell) return;
      var btn = document.createElement('button'); btn.type = 'button'; btn.textContent = '清空库存'; btn.setAttribute(ATTR, '1');
      btn.title = '将此商品全部规格库存更新为 0';
      btn.style.cssText = 'all:initial;box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;width:76px;height:24px;margin-top:6px;border:1px solid #d95454;border-radius:4px;color:#c83f3f;background:#fff;font:12px sans-serif;cursor:pointer;';
      var wrap = document.createElement('div'); wrap.setAttribute('data-dyc-wx-stock-wrap', '1');
      wrap.style.cssText = 'all:initial;display:flex;justify-content:flex-end;width:100%;box-sizing:border-box;';
      wrap.appendChild(btn);
      btn.addEventListener('click', function (e) { e.preventDefault(); e.stopPropagation(); openConfirm(row, btn); }, true);
      target.appendChild(wrap);
    });
  }
  function schedule() { if (!scheduled) { scheduled = true; requestAnimationFrame(scan); } }
  dycReadFlags().then(function (f) { flags = f; scan(); });
  dycWatchFlags(function (f) {
    var was = flags && flags.wxClearStock !== false; flags = f;
    if (was !== (f.wxClearStock !== false)) { generation++; remove(); scan(); }
  });
  setInterval(function () {
    if (lastHref !== location.href) { lastHref = location.href; generation++; remove(); }
    if (enabled() && (!table || !table.isConnected)) scan();
  }, 2000);
})();
