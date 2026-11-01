/**
 * 直播回放下载 · 网络采集层（document_start 注入）
 * ============================================================
 * 【职责】只做一件事：把页面上出现过的「回放媒体地址」记下来。
 *   不解析、不下载、不写盘 —— 纯记录，供后面两步（解析 / 下载）取用。
 *
 * 【为什么必须是 document_start】
 *   回放页的播放器一打开就会请求 m3u8 清单。若脚本等到 document_idle 才跑，
 *   清单请求早已发生；虽然 `performance.getEntriesByType('resource')` 带
 *   `buffered: true` 能补捞一部分，但资源计时缓冲默认只留 250 条，
 *   这类 SPA 页面很快就把它填满、早先的条目被挤掉 ⇒ 抓不到。
 *   所以本文件单独成一条 content_scripts，run_at 用 document_start。
 *
 * 【为什么不 hook 页面的 fetch / XHR】
 *   content script 跑在 **isolated world**，改 `window.fetch` 只改到自己这一份，
 *   页面的请求根本不经过它 —— 那种 hook 是无效代码，只会给人「已经抓到了」的错觉。
 *   要真 hook 得往 MAIN world 注入脚本，代价与风险都大；而 Resource Timing
 *   是**文档级**的，isolated world 读到的就是同一份时间线，够用。
 *   ⇒ 因此全程只用 performance 时间线，不动页面任何东西。
 *
 * 【认哪些地址】
 *   主认：.m3u8（HLS）/ .mpd（DASH）/ .mp4（直链点播）
 *   次认：URL 里带 playlist / hls 字样（平台有时把清单藏在 API 路径里）
 *   顺手：把「看起来像媒体但没认出来」的也留一份（kind='?')，仅供诊断页排查，
 *        不会被自动选中 —— 免得把统计接口当视频去下。
 *
 * 【对外接口】window.__DYC_REPLAY_NET__
 *   list()                全部候选，按记录时间倒序
 *   media()               仅已认出类型的候选（hls / dash / mp4）
 *   watch(cb)             新候选出现时回调（返回取消函数）
 *   fetchText(url)        取文本（清单）
 *   fetchBuf(url, opts)   取二进制（分片；opts.range 支持字节范围）
 *   headSize(url)         取体积（HEAD，可能失败，失败返回 0）
 *   streamTo(url, onChunk) 流式取直链 MP4，边读边交给 onChunk
 *
 * ⚠️ 所有请求都带 `credentials: 'include'`：回放清单与分片依赖登录态与
 *    Referer，缺一个就是 403。**绝不要**改成 omit。
 */
(function () {
  'use strict';

  if (window.__DYC_REPLAY_NET__) return;

  var HLS_RE = /\.m3u8(?:[?#]|$)/i;
  var DASH_RE = /\.mpd(?:[?#]|$)/i;
  var MP4_RE = /\.mp4(?:[?#]|$)/i;
  var LOOSE_RE = /(?:playlist|\/hls\/|_hls|hls_)/i;

  var MAX_ITEMS = 400;          // 上限只为防内存无限涨，远超实际需要
  var items = [];
  var seen = Object.create(null);
  var subs = [];

  /** 判断 URL 属于哪一类；认不出返回 '' */
  function classify(url) {
    if (HLS_RE.test(url)) return 'hls';
    if (DASH_RE.test(url)) return 'dash';
    if (MP4_RE.test(url)) return 'mp4';
    if (LOOSE_RE.test(url)) return 'hls';   // 待解析时再确认，先按最可能处理
    return '';
  }

  function note(url, kind) {
    if (!url) return;
    var u = String(url);
    if (!/^https?:/i.test(u)) return;
    if (seen[u]) { seen[u].t = Date.now(); return; }

    var k = kind || classify(u);
    if (!k) return;

    var it = { url: u, kind: k, t: Date.now() };
    seen[u] = it;
    items.push(it);
    if (items.length > MAX_ITEMS) {
      var old = items.shift();
      delete seen[old.url];
    }
    for (var i = 0; i < subs.length; i++) {
      try { subs[i](it); } catch (e) { /* 订阅方自己兜 */ }
    }
  }

  /** 从一条 Resource Timing 记录里认地址 */
  function fromEntry(e) {
    if (!e || !e.name) return;
    note(e.name);
  }

  /* ---------- 一、补捞本脚本执行之前已经发生的请求 ---------- */

  try {
    var past = performance.getEntriesByType
      ? performance.getEntriesByType('resource')
      : [];
    for (var p = 0; p < past.length; p++) fromEntry(past[p]);
  } catch (e) { /* 尽力而为 */ }

  /* ---------- 二、持续观察之后的所有请求 ---------- */

  var po = null;
  try {
    if (typeof PerformanceObserver === 'function') {
      po = new PerformanceObserver(function (list) {
        var es = list.getEntries ? list.getEntries() : [];
        for (var i = 0; i < es.length; i++) fromEntry(es[i]);
      });
      po.observe({ type: 'resource', buffered: true });
    }
  } catch (e) {
    // 老内核可能不认 buffered / type 写法，退回 entryTypes 再试一次
    try {
      po = new PerformanceObserver(function (list) {
        var es = list.getEntries ? list.getEntries() : [];
        for (var i = 0; i < es.length; i++) fromEntry(es[i]);
      });
      po.observe({ entryTypes: ['resource'] });
    } catch (e2) { po = null; }
  }

  /* ---------- 三、请求能力 ---------- */

  /**
   * 统一的请求入口。
   *
   * ⚠️ 凭据策略必须两段式，这是踩过的坑（不是保险起见）：
   *   `credentials: 'include'` 要求 CDN 回 `Access-Control-Allow-Credentials: true`
   *   且 `Allow-Origin` 不能是 `*`。抖音的媒体 CDN 有的回 `*`、有的回具体来源，
   *   一旦配的是 `*`，带凭据的请求会被浏览器直接判 CORS 失败 —— 而同样的地址
   *   不带凭据就能通。所以先试 include（能带登录态最好），失败了再用 omit 重试一次。
   *   绝不能反过来：omit 拿到的可能是「无权限的占位清单」。
   */
  function request(url, init) {
    init = init || {};
    var base = { cache: 'no-store' };
    if (init.headers) base.headers = init.headers;
    if (init.signal) base.signal = init.signal;
    if (init.method) base.method = init.method;

    function go(cred) {
      var o = Object.assign({}, base, { credentials: cred });
      return fetch(url, o);
    }

    return go('include').catch(function (err) {
      // AbortError 不是凭据问题，原样抛出，别浪费一次重试
      if (err && err.name === 'AbortError') throw err;
      return go('omit').catch(function () {
        // 两次都失败：给一句能指导用户的话，而不是裸 TypeError: Failed to fetch
        throw new Error('取不到媒体数据（' + url.slice(0, 80) + '…）：可能是跨域被拦或地址已过期。'
          + '请刷新页面后重试；若一直失败，请把这条提示发给我。');
      });
    });
  }

  /**
   * 取文本（清单）。
   * @returns {Promise<string>}
   */
  function fetchText(url) {
    return request(url).then(function (r) {
      if (!r.ok) throw new Error('清单请求失败 HTTP ' + r.status);
      return r.text();
    });
  }

  /**
   * 取二进制。
   * @param {string} url
   * @param {{range?:string, signal?:AbortSignal}} [opts]
   * @returns {Promise<Uint8Array>}
   */
  function fetchBuf(url, opts) {
    opts = opts || {};
    var init = {};
    if (opts.range) init.headers = { Range: opts.range };
    if (opts.signal) init.signal = opts.signal;
    return request(url, init).then(function (r) {
      // 206 是字节范围请求的正常响应，不能当失败
      if (!r.ok && r.status !== 206) {
        // 把状态码挂到错误上：上层靠它区分「限流（429/503/509）」与「鉴权/地址过期（403）」,
        // 前者该降并发、后者该直接报错，只看 message 字符串太脆。
        var e = new Error('HTTP ' + r.status);
        e.status = r.status;
        throw e;
      }
      return r.arrayBuffer();
    }).then(function (buf) {
      return new Uint8Array(buf);
    });
  }

  /**
   * 用 HEAD 探体积。有些 CDN 不放行 HEAD，失败就返回 0 —— 调用方按 0 处理。
   * @returns {Promise<number>}
   */
  function headSize(url) {
    return request(url, { method: 'HEAD' })
      .then(function (r) {
        if (!r.ok) return 0;
        var n = parseInt(r.headers.get('content-length') || '0', 10);
        return isFinite(n) ? n : 0;
      })
      .catch(function () { return 0; });
  }

  /**
   * 直链 MP4 的流式读取：边读边把字节交给 onChunk，内存里不攒整个文件。
   * @returns {Promise<number>} 总字节数
   */
  function streamTo(url, onChunk, signal) {
    return request(url, { signal: signal }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      var total = parseInt(r.headers.get('content-length') || '0', 10) || 0;
      if (!r.body || typeof r.body.getReader !== 'function') {
        // 拿不到流就退回整块（大文件会吃内存，但不至于直接失败）
        return r.arrayBuffer().then(function (b) {
          return onChunk(new Uint8Array(b), b.byteLength, total).then(function () { return b.byteLength; });
        });
      }
      var reader = r.body.getReader();
      var got = 0;
      function pump() {
        return reader.read().then(function (res) {
          if (res.done) return got;
          var ch = res.value;
          got += ch.byteLength;
          return onChunk(ch, got, total).then(pump);
        });
      }
      return pump();
    });
  }

  window.__DYC_REPLAY_NET__ = {
    list: function () { return items.slice().reverse(); },
    media: function () {
      return items.filter(function (x) { return x.kind; }).slice().reverse();
    },
    watch: function (cb) {
      subs.push(cb);
      return function () {
        var i = subs.indexOf(cb);
        if (i >= 0) subs.splice(i, 1);
      };
    },
    fetchText: fetchText,
    fetchBuf: fetchBuf,
    headSize: headSize,
    streamTo: streamTo
  };
})();
