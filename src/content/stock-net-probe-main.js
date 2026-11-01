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

  function armed() {
    return Date.now() < armedUntil;
  }

  /** 只认本站接口；静态资源与第三方域名一律不记 */
  var STATIC_RE = /\.(?:js|mjs|css|png|jpe?g|gif|webp|svg|ico|woff2?|ttf|otf|mp4|ts|m3u8)(?:[?#]|$)/i;

  function interested(url) {
    if (!url || typeof url !== 'string') return false;
    if (STATIC_RE.test(url)) return false;
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

  function clip(s) {
    s = slim(s);
    return s.length > MAX_TEXT
      ? s.slice(0, MAX_TEXT) + '…[已截断,共' + s.length + '字符]'
      : s;
  }

  function emit(rec) {
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
      var ttl = Number(m.ttl);
      armedUntil = Date.now() + (isFinite(ttl) && ttl > 0 ? ttl : 30000);
      return;
    }

    /* ---- 转发请求(2026-10-24 渠道品直提):隔离世界发的请求缺平台请求库
     * 注入的安全头,会被平台判「当前环境存在风险」。在这里用**页面世界的
     * XHR** 发同一请求 —— 平台对 XMLHttpRequest.prototype 的全局注入
     * (签名/平台校验头)会自动作用到这个 XHR 上,与页面自己的请求同权。 ---- */
    if (m.type === 'send') {
      doSend(m.id, m.url, m.method, m.body);
      return;
    }
  });

  /** 在页面侧转发一个 XHR,结果经 postMessage 送回隔离世界 */
  function doSend(id, url, method, body) {
    try {
      var xhr = new XMLHttpRequest();
      xhr.open(method || 'GET', url, true);
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
                reqBody: clip(r[0]), status: status, respText: clip(r[1])
              });
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
      var reqBody = clip(bodyText(body));
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
        });
      };

      xhr.addEventListener('load', finish);
      xhr.addEventListener('error', finish);
      xhr.addEventListener('timeout', finish);
    }

    return _xhrSend.apply(this, arguments);
  };
})();
