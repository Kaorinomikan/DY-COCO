/**
 * 库存清零 · 网络监听（MAIN world 侧，2026-10-21 新增）
 * ============================================================
 * 【职责】只做一件事：在「监听窗口」内，把页面自己发出的本站接口请求
 *   （方法 / 地址 / 请求体 / 状态码 / 响应体）原样记录下来，交给隔离世界。
 *   不解析、不改参数、不重发 —— 纯记录，供「清空库存直提升级」的侦察期用。
 *
 * 【为什么必须在 MAIN world】
 *   页面自己发的 fetch / XHR 走的是页面世界的原型链，content script
 *   在 isolated world 里改 window.fetch 只改到自己那一份，是无效代码
 *   （工程先例见 replay-net.js 头注「为什么不 hook 页面的 fetch / XHR」）。
 *
 * 【怎么进来的】两条路，都到得了这里：
 *   ① script 标签 + web_accessible_resources（老内核可用，但页面 CSP
 *      可能拦 chrome-extension:// 脚本）；
 *   ② 后台 chrome.scripting.executeScript({world:'MAIN'})（需要内核
 *      Chromium 95+，CSP 管不着扩展注入）。
 *   本脚本自带防重入：装过第二次进来直接早退，但每次进来都会补发一条
 *   ready 回执，隔离世界靠它确认「监听已在场」并补发 arm 命令。
 *
 * 【监听窗口】隔离世界发来 arm 命令时开窗（默认 30 秒），窗口内发起的
 *   本站请求才记录。窗口判定在「请求发起那一刻」做死 —— 响应回来晚了
 *   也照样记录，不会因为窗口关闭而丢提交结果。
 *
 * 【对外消息】window.postMessage，source = 'DYC_STOCK_PROBE'：
 *   {type:'ready'}                    已在场（每次 eval 都发一条）
 *   {type:'record', data:{...}}       一条请求记录
 *   data = { kind, url, method, reqBody, status, respText, t }
 */
(function () {
  'use strict';

  // 每次被注入都先报到场（防重入早退之前）—— 隔离世界用它确认注入通道活着
  try {
    window.postMessage({ source: 'DYC_STOCK_PROBE', type: 'ready' }, '*');
  } catch (e) { /* postMessage 理论上不会失败 */ }

  if (window.__DYC_STOCK_PROBE_MAIN__) return;   // 防重入
  window.__DYC_STOCK_PROBE_MAIN__ = true;

  var armedUntil = 0;        // 监听窗口截止时间戳
  var MAX_TEXT = 6000;       // 单条请求/响应体截断长度（字符）
  var xhs = /(?:^|\.)xiaohongshu\.com$/i.test(location.hostname);
  var xhsCtrl = /^https:\/\/(?:pgy\.xiaohongshu\.com\/commerce\/redlive\/|ark\.xiaohongshu\.com\/live_center_control(?:\/|[?#]|$))/;

  function armed() {
    return Date.now() < armedUntil && (!xhs || xhsCtrl.test(location.href));
  }

  /** 只认本站接口；静态资源与第三方域名一律不记 */
  var STATIC_RE = /\.(?:js|mjs|css|png|jpe?g|gif|webp|svg|ico|woff2?|ttf|otf|mp4|ts|m3u8)(?:[?#]|$)/i;

  function interested(url) {
    if (!url || typeof url !== 'string') return false;
    if (STATIC_RE.test(url)) return false;
    if (xhs) {
      try {
        var target = new URL(url, location.href);
        return target.protocol === 'https:' && /^(?:pgy|ark|edith)\.xiaohongshu\.com$/i.test(target.hostname);
      } catch (e) { return false; }
    }
    // 相对路径按本站算
    if (!/^https?:\/\//i.test(url)) return true;
    try {
      var u = new URL(url, location.href);
      return u.hostname === location.hostname ||
             /(?:^|\.)jinritemai\.com$/i.test(u.hostname);
    } catch (e) {
      return false;
    }
  }

  /** 请求体统一转文本；复杂类型给占位说明，不硬读 */
  function bodyText(b) {
    try {
      if (b == null) return '';
      if (typeof b === 'string') return b;
      if (typeof URLSearchParams !== 'undefined' && b instanceof URLSearchParams) {
        return b.toString();
      }
      if (typeof FormData !== 'undefined' && b instanceof FormData) {
        var parts = [];
        b.forEach(function (v, k) {
          parts.push(k + '=' + (typeof v === 'string' ? v : '[文件]'));
        });
        return parts.join('&');
      }
      if (typeof Blob !== 'undefined' && b instanceof Blob) return '[Blob ' + b.size + 'B]';
      if (typeof ArrayBuffer !== 'undefined' && b instanceof ArrayBuffer) {
        return '[ArrayBuffer ' + b.byteLength + 'B]';
      }
      return String(b);
    } catch (e) {
      return '[序列化失败:' + (e && e.message) + ']';
    }
  }

  /**
   * 把 JSON 里的超长字符串（base64 图片、二维码、证书等）换成占位再截断。
   *
   * 为什么必须做：微信商品接口的响应前三个字段就带 `qrcodeBase64`
   * （体积 40 万字符），直接被 MAX_TEXT 截掉 —— 报告里只剩一段 base64，
   * 真正的业务字段（shareKey 之类）一个都看不到，接口取样等于白抓
   * （用户 2026-10-31 导出的报告就是这样）。抖店响应里的图片字段同理。
   *
   * 只在**能解析成 JSON** 时做；解析失败按原文截断。
   */
  function slim(s) {
    s = String(s == null ? '' : s);
    if (s.length < 400) return s;
    var first = s.charAt(0);
    if (first !== '{' && first !== '[') return s;
    var json;
    try { json = JSON.parse(s); } catch (e) { return s; }
    var budget = 0;
    function walk(node, depth) {
      if (depth > 8 || budget > 4000) return node;
      if (!node || typeof node !== 'object') return node;
      budget++;
      if (Array.isArray(node)) {
        for (var i = 0; i < node.length; i++) node[i] = walk(node[i], depth + 1);
        return node;
      }
      var keys;
      try { keys = Object.keys(node); } catch (e2) { return node; }
      for (var k = 0; k < keys.length; k++) {
        var v;
        try { v = node[keys[k]]; } catch (e3) { continue; }
        if (typeof v === 'string') {
          if (v.length > 200) node[keys[k]] = '<' + v.length + ' 字符,已省略>';
        } else if (v && typeof v === 'object') {
          node[keys[k]] = walk(v, depth + 1);
        }
      }
      return node;
    }
    var out;
    try { out = JSON.stringify(walk(json, 0)); } catch (e4) { return s; }
    return out;
  }

  // 小红书请求和响应正文只保留字段结构。直提所需的业务枚举另按接口白名单取样。
  function shape(value, depth) {
    if (value === null) return null;
    if (typeof value !== 'object') return typeof value;
    if (depth >= 6) return Array.isArray(value) ? 'array' : 'object';
    if (Array.isArray(value)) return value.slice(0, 2).map(function (item) { return shape(item, depth + 1); });
    var result = Object.create(null);
    Object.keys(value).slice(0, 36).forEach(function (key) {
      if (/^[a-z_][a-z0-9_.-]{0,63}$/i.test(key) && !/^[a-f0-9]{16,}$/i.test(key)) {
        result[key] = shape(value[key], depth + 1);
      }
    });
    return result;
  }
  function xhsBodyShape(s, request) {
    if (!s) return '';
    try { return JSON.stringify(shape(JSON.parse(s), 0)); } catch (e) {
      if (request && /^[a-z_][a-z0-9_.-]*=/i.test(s)) {
        return JSON.stringify(shape(Object.fromEntries(new URLSearchParams(s)), 0));
      }
      return '[非 JSON 内容已省略]';
    }
  }
  function clip(s, request) {
    if (xhs) s = xhsBodyShape(s, request);
    s = slim(s);
    return s.length > MAX_TEXT
      ? s.slice(0, MAX_TEXT) + '…[已截断,共' + s.length + '字符]'
      : s;
  }

  var XHS_SEARCH = '/api/edith/live/commerce/v1/cps_goods/search';
  var XHS_POOL = '/api/edith/live/commerce/v1/cps_goods/list';
  var XHS_ADD = '/api/edith/live/commerce/live/center/goods/add';
  var XHS_CART = '/api/edith/live/commerce/v1/live_center/goods/list';

  function parseJson(text) {
    try { return JSON.parse(text); } catch (e) { return null; }
  }
  function businessEnum(value) {
    if (Number.isInteger(value) && Math.abs(value) <= 999999) return value;
    if (typeof value === 'string' && /^(?:[0-9]{1,6}|[a-z]{1,24}(?:_[a-z]{1,24}){0,3})$/i.test(value)) return value;
    return value == null || value === '' ? value : '[值已省略]';
  }
  function queryParamSample(value) {
    if (value == null || value === '') return value;
    var data = parseJson(value);
    if (!data || typeof data !== 'object') return '[非 JSON 参数值已省略]';
    return shape(data, 0);
  }
  function xhsBusiness(url, method, request, response) {
    // 中控台有两个域：pgy（达人/买手侧）与 ark（千帆商家侧）。直提接口 path 相同、
    // 只是 host 不同；只认 ark 会让 pgy 页面的 business 恒为空，参数永远采不到。
    if (!/(?:^|\.)xiaohongshu\.com$/i.test(url.hostname)) return null;
    var query = url.searchParams;
    if (method === 'GET' && url.pathname === XHS_SEARCH) {
      var result = parseJson(response);
      var items = result && result.data && result.data.items;
      var id = query.get('query') || '';
      var hit = Array.isArray(items) && /^[a-f0-9]{24}$/i.test(id) && items.find(function (item) {
        return item && item.goods_id && String(item.goods_id.new_item_id).toLowerCase() === id.toLowerCase();
      });
      return {
        source: businessEnum(query.get('source')),
        scene_id: businessEnum(query.get('scene_id')),
        // plan_id 是直播场次标识，直提必须原样回放；不采值就只能靠猜。
        plan_id: query.get('plan_id'),
        query_param: queryParamSample(query.get('query_param')),
        queryMatchesNewItemId: !!hit,
        matchedType: hit ? businessEnum(hit.type) : null
      };
    }
    if (method === 'POST' && url.pathname === XHS_ADD) {
      var payload = parseJson(request);
      var list = payload && payload.goods_list;
      var reply = parseJson(response);
      return {
        type: businessEnum(payload && payload.type),
        goodsCount: Array.isArray(list) ? list.length : null,
        goodsType: Array.isArray(list) && list[0] ? businessEnum(list[0].goods_type) : null,
        success: reply && typeof reply.success === 'boolean' ? reply.success : null,
        code: reply && Number.isInteger(reply.code) ? businessEnum(reply.code) : null
      };
    }
    if (method === 'GET' && url.pathname === XHS_CART) {
      return {
        type: businessEnum(query.get('type')), source: businessEnum(query.get('source')),
        page: businessEnum(query.get('page')), page_size: businessEnum(query.get('page_size'))
      };
    }
    return null;
  }

  /* ---- 直提参数照抄（2026-11-18）----
   * 商品池接口必须带 source / scene_id / plan_id，其中 plan_id 随直播场次变化，
   * 写死会加错场次。这里把**平台自己**发过的同类请求的公共参数记下来，
   * 直提时原样照抄：平台改参数我们自动跟随，也不需要在扩展里存业务 ID。
   * 只在内存里留最近一次，不进 storage、不进诊断报告以外的任何地方。 */
  var apiParams = null;
  var PARAMS_KEY = 'dycXhsApiParams';
  // 刷新页面后内存会丢，但同一场直播的 plan_id 不变 —— 存会话级（关标签即失），
  // 两小时后作废，避免跨场次把商品加到上一场。
  try {
    var savedParams = JSON.parse(sessionStorage.getItem(PARAMS_KEY) || 'null');
    if (savedParams && savedParams.plan_id && Date.now() - (savedParams.t || 0) < 7200000) {
      apiParams = {
        source: savedParams.source || '',
        scene_id: savedParams.scene_id || '',
        plan_id: savedParams.plan_id || ''
      };
    }
  } catch (e) { /* 读不到就走默认参数，直提侧自己兜底 */ }

  function rememberParams(url) {
    if (!xhs) return;
    try {
      var u = new URL(url, location.href);
      if (u.pathname !== XHS_SEARCH && u.pathname !== XHS_POOL) return;
      var p = {
        source: u.searchParams.get('source') || '',
        scene_id: u.searchParams.get('scene_id') || '',
        plan_id: u.searchParams.get('plan_id') || ''
      };
      if (!p.source && !p.scene_id && !p.plan_id) return;
      apiParams = p;
      try {
        sessionStorage.setItem(PARAMS_KEY, JSON.stringify({
          source: p.source, scene_id: p.scene_id, plan_id: p.plan_id, t: Date.now()
        }));
      } catch (e2) { /* 存不下就只留内存 */ }
    } catch (e) { /* 参数读不出来就不记，直提侧会退到默认值 */ }
  }

  function emit(rec, request, response) {
    if (xhs) {
      try {
        var u = new URL(rec.url, location.href);
        rec.business = xhsBusiness(u, rec.method, request, response);
        var query = shape(Object.fromEntries(u.searchParams), 0);
        rec.url = u.origin + u.pathname.split('/').map(function (part) {
          return /^[a-z_][a-z0-9_.-]{0,63}$/i.test(part) && !/^[a-f0-9]{16,}$/i.test(part) ? part : part ? ':value' : '';
        }).join('/');
        if (Object.keys(query).length) rec.url += ' 参数 ' + JSON.stringify(query);
        if (rec.status === 0) rec.respText = '[网络请求失败]';
      } catch (e) { return; }
    }
    rec.t = Date.now();
    try {
      window.postMessage({ source: 'DYC_STOCK_PROBE', type: 'record', data: rec }, '*');
    } catch (e) { /* 结构化克隆失败就丢这条,不影响页面 */ }
  }

  /* ---- arm 命令：隔离世界发来时开监听窗口 ---- */
  window.addEventListener('message', function (ev) {
    if (ev.source !== window) return;
    var m = ev.data;
    if (!m || m.source !== 'DYC_STOCK_PROBE_CMD') return;

    if (m.type === 'arm') {
      if (xhs && !xhsCtrl.test(location.href)) return;
      var ttl = Number(m.ttl);
      if (xhs) ttl = Math.min(30000, ttl);
      armedUntil = Date.now() + (isFinite(ttl) && ttl > 0 ? ttl : 30000);
      return;
    }

    /* ---- 直提参数查询：隔离世界问「平台最近一次商品池请求带了什么参数」 ---- */
    if (m.type === 'params') {
      try {
        window.postMessage({
          source: 'DYC_STOCK_PROBE', type: 'paramsResult', id: m.id, params: apiParams
        }, '*');
      } catch (e) { /* 回不去就让隔离世界超时兜底 */ }
      return;
    }

    /* ---- 转发请求(2026-10-24 渠道品直提):隔离世界发的请求缺平台请求库
     * 注入的安全头,会被平台判「当前环境存在风险」。在这里用**页面世界的
     * XHR** 发同一请求 —— 平台对 XMLHttpRequest.prototype 的全局注入
     * (签名/平台校验头)会自动作用到这个 XHR 上,与页面自己的请求同权。
     * 2026-11-18 小红书直提同走这条通道：与平台点「保存」发出的请求同权。 ---- */
    if (m.type === 'send') {
      doSend(m.id, m.url, m.method, m.body, m.credentials);
      return;
    }
  });

  /** 在页面侧转发一个 XHR,结果经 postMessage 送回隔离世界 */
  function doSend(id, url, method, body, credentials) {
    try {
      var xhr = new XMLHttpRequest();
      xhr.open(method || 'GET', url, true);
      // pgy 页面请求 ark 接口属跨子域：XHR 默认不带 cookie，服务端会判
      // 「缺失登录凭证」(-13000)。平台自己的请求是带凭证发的，这里必须跟齐。
      if (credentials) {
        try { xhr.withCredentials = true; } catch (e) { /* 老内核忽略 */ }
      }
      if (body != null && method !== 'GET') {
        try { xhr.setRequestHeader('Content-Type', 'application/json;charset=UTF-8'); } catch (e) {}
      }
      xhr.onreadystatechange = function () {
        if (xhr.readyState !== 4) return;
        var text = '';
        try { text = xhr.responseText; } catch (e) { text = '[读响应失败]'; }
        reply(id, xhr.status, text);
      };
      xhr.onerror = function () { reply(id, 0, '[网络失败]'); };
      if (method === 'GET' || body == null) xhr.send(null);
      else xhr.send(body);
    } catch (e) {
      reply(id, 0, '[转发异常:' + (e && e.message) + ']');
    }
  }

  function reply(id, status, text) {
    try {
      window.postMessage({
        source: 'DYC_STOCK_PROBE', type: 'sendResult', id: id,
        status: status, text: String(text == null ? '' : text).slice(0, 60000)
      }, '*');
    } catch (e) { /* 结构化克隆失败就丢 */ }
  }

  /* ---- fetch 包装 ----
   * 请求体可能三处：init.body / Request 对象本体 / 没有。
   * Request 对象的体要异步 clone().text()，故「体 + 响应」都就绪后再 emit 一条。
   */
  var _fetch = window.fetch;
  if (typeof _fetch === 'function') {
    window.fetch = function (input, init) {
      var url = '', method = 'GET', cap = false, bodyPromise = null;

      try {
        url = (typeof input === 'string') ? input : ((input && input.url) || '');
        method = String((init && init.method) || (input && input.method) || 'GET').toUpperCase();
        cap = armed() && interested(url);

        if (cap) {
          var rawBody = (init && init.body != null) ? init.body : null;
          var isRequest = input && typeof input === 'object' &&
                          typeof input.clone === 'function' && rawBody == null;

          if (rawBody != null) {
            bodyPromise = Promise.resolve(bodyText(rawBody));
          } else if (isRequest && method !== 'GET' && method !== 'HEAD') {
            try {
              bodyPromise = input.clone().text();
            } catch (e) {
              bodyPromise = Promise.resolve('[请求体不可克隆]');
            }
          } else {
            bodyPromise = Promise.resolve('');
          }
        }
      } catch (e) { /* 读参失败不影响原请求 */ }

      var p = _fetch.apply(this, arguments);
      // 不论是否在监听窗口内，都记一下商品池请求的公共参数，供直提照抄。
      try { rememberParams(url); } catch (e) { /* 记录失败不影响原请求 */ }

      if (cap) {
        p.then(function (res) {
          var status = 0;
          try { status = res.status; } catch (e) {}
          var textPromise;
          try {
            textPromise = res.clone().text();
          } catch (e) {
            textPromise = Promise.resolve('[响应不可克隆]');
          }
          Promise.all([bodyPromise || Promise.resolve(''), textPromise])
            .then(function (r) {
              emit({
                kind: 'fetch', url: String(url), method: method,
                reqBody: clip(r[0], true), status: status, respText: clip(r[1])
              }, r[0], r[1]);
            })
            .catch(function () {
              emit({
                kind: 'fetch', url: String(url), method: method,
                reqBody: '', status: status, respText: '[组装记录失败]'
              });
            });
        }, function (err) {
          emit({
            kind: 'fetch', url: String(url), method: method,
            reqBody: '', status: 0, respText: '[网络失败:' + (err && err.message) + ']'
          });
        });
      }

      return p;
    };
  }

  /* ---- XHR 包装 ----
   * open 记 method/url 到实例私有字段；send 时决定是否捕获，
   * load / error / timeout 任一到达都收尾一次（防重入）。
   * axios 等主流库都走 XHR，这是最可能抓到提交请求的通道。
   */
  var _xhrOpen = XMLHttpRequest.prototype.open;
  var _xhrSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function (method, url) {
    try {
      this.__dycProbe = {
        method: String(method || 'GET').toUpperCase(),
        url: String(url == null ? '' : url)
      };
      rememberParams(this.__dycProbe.url);
    } catch (e) { /* 不影响原 open */ }
    return _xhrOpen.apply(this, arguments);
  };

  XMLHttpRequest.prototype.send = function (body) {
    var xhr = this;
    var info = null;
    try { info = xhr.__dycProbe || null; } catch (e) {}

    var cap = false;
    try { cap = !!info && armed() && interested(info.url); } catch (e) {}

    if (cap) {
      var rawRequest = bodyText(body);
      var reqBody = clip(rawRequest, true);
      var finished = false;

      var finish = function () {
        if (finished) return;
        finished = true;

        var status = 0, resp = '';
        try { status = xhr.status; } catch (e) { status = 0; }
        try {
          var rt = xhr.responseType;
          if (!rt || rt === 'text') {
            resp = xhr.responseText;
          } else if (rt === 'json') {
            resp = JSON.stringify(xhr.response);
          } else {
            resp = '[' + rt + ' 响应,未采集]';
          }
        } catch (e) {
          resp = '[读响应失败:' + (e && e.message) + ']';
        }

        emit({
          kind: 'xhr', url: info.url, method: info.method,
          reqBody: reqBody, status: status, respText: clip(resp)
        }, rawRequest, resp);
      };

      xhr.addEventListener('load', finish);
      xhr.addEventListener('error', finish);
      xhr.addEventListener('timeout', finish);
    }

    return _xhrSend.apply(this, arguments);
  };
})();
