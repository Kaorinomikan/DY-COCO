/** 微信小店库存请求桥：仅转发已取样的四个接口，鉴权头只留页面内存。 */
(function () {
  'use strict';
  if (location.hostname !== 'store.weixin.qq.com' || window.__DYC_WX_STOCK_MAIN__) return;
  window.__DYC_WX_STOCK_MAIN__ = true;
  var BASE = '/shop-faas/mmecnodeproductlist/cgi/goods/';
  var OPS = ['getStockBySpu', 'batchCheckProductByTypeV2', 'checkProductEditValid', 'batchUpdateStock'];
  var headers = {};
  var nativeFetch = window.fetch;
  var ownRequests = new WeakSet();
  function capture(url, h) {
    try {
      var u = new URL(url, location.href);
      if (u.origin !== location.origin || !/^\/shop-faas\/mm(?:ecnodeproductlist|channelstradeproductcore)\/cgi\/goods\//.test(u.pathname) || !h) return;
      var out = {};
      new Headers(h).forEach(function (v, k) {
        if (!/^(cookie|host|content-length|connection|referer|origin|user-agent|accept-encoding|content-type|sec-)/i.test(k)) out[k] = v;
      });
      if (Object.keys(out).length) headers = out;
    } catch (_) { /* 不干扰平台请求 */ }
  }
  window.fetch = function (input, init) {
    if (!init || !ownRequests.has(init)) capture(typeof input === 'string' ? input : input && input.url, init && init.headers || input && input.headers);
    return nativeFetch.apply(this, arguments);
  };
  var open = XMLHttpRequest.prototype.open;
  var setHeader = XMLHttpRequest.prototype.setRequestHeader;
  var send = XMLHttpRequest.prototype.send;
  var xhrData = new WeakMap();
  XMLHttpRequest.prototype.open = function (method, url) {
    xhrData.set(this, { url: url, headers: {} });
    return open.apply(this, arguments);
  };
  XMLHttpRequest.prototype.setRequestHeader = function (k, v) {
    var d = xhrData.get(this);
    if (d) d.headers[k] = v;
    return setHeader.apply(this, arguments);
  };
  XMLHttpRequest.prototype.send = function () {
    var d = xhrData.get(this);
    if (d) capture(d.url, d.headers);
    return send.apply(this, arguments);
  };
  function valid(op, body) {
    if (!body || typeof body !== 'object') return false;
    if (op === 'getStockBySpu' || op === 'batchCheckProductByTypeV2') {
      return Array.isArray(body.productIdList) && body.productIdList.length === 1 && /^\d{6,}$/.test(String(body.productIdList[0])) &&
        (op !== 'batchCheckProductByTypeV2' || body.type === 'stock');
    }
    return Array.isArray(body.skuList) && body.skuList.length > 0 && body.skuList.length <= 1000 &&
      (op !== 'checkProductEditValid' || body.type === 'STOCK') && body.skuList.every(function (s) {
        return /^\d{6,}$/.test(s.spuId) && /^\d+$/.test(s.skuId) && s.spuId === body.skuList[0].spuId &&
          s.diffType === 2 && Number.isSafeInteger(s.num) && s.num > 0 && (s.salePrice === undefined || s.salePrice === 0);
      });
  }
  window.addEventListener('message', async function (e) {
    var m = e.data;
    if (e.source !== window || !m || m.source !== 'DYC_WX_STOCK_REQ' || !/^\/shop\/goods\/list\/?$/.test(location.pathname)) return;
    if (OPS.indexOf(m.op) < 0 || !valid(m.op, m.body)) return;
    var result;
    var controller = new AbortController();
    var timer = setTimeout(function () { controller.abort(); }, 12000);
    try {
      var opts = { method: 'POST', credentials: 'include', signal: controller.signal,
        headers: Object.assign({}, headers, { 'Content-Type': 'application/json', Accept: 'application/json' }), body: JSON.stringify(m.body) };
      ownRequests.add(opts);
      var r = await window.fetch(BASE + m.op + '?token=&lang=zh_CN', opts);
      result = { status: r.status, data: null };
      try { result.data = await r.json(); }
      catch (_) { result.error = '平台返回非 JSON 响应'; }
    } catch (_) { result = { status: 0, error: '请求超时或网络异常，请核对库存后再操作' }; }
    finally { clearTimeout(timer); }
    window.postMessage({ source: 'DYC_WX_STOCK_RES', rid: m.rid, result: result }, location.origin);
  });
})();
