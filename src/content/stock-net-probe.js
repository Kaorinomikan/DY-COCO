/**
 * 库存清零 · 网络监听（隔离世界桥，2026-10-21 新增）
 * ============================================================
 * 【职责】把 MAIN world 探针（stock-net-probe-main.js）装进页面、
 *   开/关监听窗口、收请求记录，并向调试面板的「复制诊断报告」提供附加段。
 *
 * 【为什么有这个中间层】
 *   记录的收发走 window.postMessage：MAIN world 发 data，
 *   这里收进内存缓冲。记录只留在内存、上限 120 条（超出丢最旧），
 *   不写 storage、不外传 —— 只有用户点「复制诊断报告」时才会进剪贴板。
 *
 * 【注入 MAIN world 的两条路】
 *   ① script 标签 + web_accessible_resources：老内核可用，但页面 CSP
 *      可能拦 chrome-extension:// 脚本；
 *   ② 请后台 chrome.scripting.executeScript({world:'MAIN'})：CSP 管不着，
 *      但需要内核 Chromium 95+。
 *   首次使用时装探针，收到 ready 后开窗。同一页面只装一次。
 *
 * 【对外接口】window.__DYC_STOCK_PROBE__
 *   arm(ttlMs)                     开监听窗口并清空旧记录
 *   reportSection()                给诊断报告的附加段文本（无记录也有状态行）
 *   records()                      记录副本（调试用）
 *   clear()                        清空记录
 */
(function () {
  'use strict';

  if (window.__DYC_STOCK_PROBE__) return;

  var xhs = /(?:^|\.)xiaohongshu\.com$/i.test(location.hostname);
  var MAX_RECORDS = 120;
  var records = [];
  var ready = false;          // MAIN world 探针是否已回话
  var armedEver = false;      // 本页是否开过监听窗（区分「没开窗」与「开窗失败」）
  var sendSeq = 0;            // 转发请求序号
  var pendingSends = {};      // id → resolve
  var paramsSeq = 0;          // 参数查询序号
  var pendingParams = {};     // id → resolve
  var readyWaiters = [];      // ensureReady 的等待者(ready 消息到达时逐个唤醒)

  function say(msg) {
    if (typeof debugLog === 'function') debugLog(msg);
  }

  /** 路①：script 标签注入（资源已在 manifest web_accessible_resources 里） */
  function injectViaScriptTag() {
    try {
      var s = document.createElement('script');
      s.src = chrome.runtime.getURL('src/content/stock-net-probe-main.js');
      s.onload = function () { if (s.parentNode) s.parentNode.removeChild(s); };
      s.onerror = function () {
        if (s.parentNode) s.parentNode.removeChild(s);
        say('网络监听 script 标签加载失败(多半是页面 CSP 拦截),走后台直注兜底');
      };
      (document.head || document.documentElement).appendChild(s);
    } catch (e) {
      if (e && /Extension context invalidated/i.test(e.message || '')) {
        // 扩展在页面开着时更新过,本页脚本还是旧实例的,chrome.* 全部失联
        say('扩展刚更新过,本页脚本已失效 —— 请刷新页面后再试接口取样');
      } else {
        say('网络监听 script 标签注入异常:' + (e && e.message));
      }
    }
  }

  /** 路②：请后台 chrome.scripting 直注 MAIN world */
  function injectViaBackground() {
    try {
      chrome.runtime.sendMessage({ type: 'dyc:stockProbeMain' }, function (r) {
        void chrome.runtime.lastError;   // 静默读掉,失败还有路①
        if (r && r.ok === false) {
          say('后台 MAIN 直注未成功:' + (r.error || '?') + '(不影响 script 标签通道)');
        }
      });
    } catch (e) {
      if (e && /Extension context invalidated/i.test(e.message || '')) {
        say('扩展刚更新过,本页脚本已失效 —— 请刷新页面后再试接口取样');
      }
      /* 其余情况静默:还有路① */
    }
  }

  window.addEventListener('message', function (ev) {
    if (ev.source !== window) return;
    var m = ev.data;
    if (!m || m.source !== 'DYC_STOCK_PROBE') return;

    if (m.type === 'ready') {
      ready = true;
      // 唤醒等就绪的调用方(事件驱动,不轮询)
      while (readyWaiters.length) {
        try { readyWaiters.shift()(); } catch (e) { /* 等待者自兜 */ }
      }
      return;
    }

    if (m.type === 'record' && m.data) {
      records.push(m.data);
      if (records.length > MAX_RECORDS) records.shift();
      return;
    }

    if (m.type === 'sendResult' && m.id != null) {
      var resolve = pendingSends[m.id];
      if (resolve) {
        delete pendingSends[m.id];
        resolve({ status: m.status || 0, text: m.text || '' });
      }
    }

    if (m.type === 'paramsResult' && m.id != null) {
      var settle = pendingParams[m.id];
      if (settle) {
        delete pendingParams[m.id];
        settle(m.params || null);
      }
    }
  });

  /**
   * 等 MAIN 侧探针就绪(未装则现场装,script 标签 + 后台直注双通道)。
   * 事件驱动:ready 消息到达即唤醒等待者,零轮询。
   * @returns {Promise<boolean>} 超时(默认 3 秒)返回 false
   */
  function ensureReady(timeoutMs) {
    if (ready) return Promise.resolve(true);
    // 小红书页面的 CSP 会拦 chrome-extension:// 脚本，script 标签每次都失败并
    // 在诊断报告里留一条红色报错；后台直注（chrome.scripting）不受 CSP 管，只走它。
    if (!xhs) injectViaScriptTag();
    injectViaBackground();
    return new Promise(function (resolve) {
      var done = false;
      var waiter = function () {
        if (done) return;
        done = true;
        resolve(true);
      };
      readyWaiters.push(waiter);
      setTimeout(function () {
        if (done) return;
        done = true;
        var i = readyWaiters.indexOf(waiter);
        if (i >= 0) readyWaiters.splice(i, 1);
        resolve(false);
      }, timeoutMs || 3000);
    });
  }

  /**
   * 请页面侧转发一个同源请求(2026-10-24 渠道品直提配套)。
   *
   * 为什么不直接 fetch:隔离世界发的请求缺平台请求库全局注入的安全头,
   * 会被平台判「当前环境存在风险」。页面世界的 XHR 自动带上那些头。
   * 探针未就绪时现场等装(最多 3 秒);仍不就绪 resolve {status:0},
   * 调用方自行走隔离 fetch 兜底。
   *
   * @returns {Promise<{status:number, text:string}>}
   */
  function sendRequest(url, opts) {
    opts = opts || {};
    return ensureReady(3000).then(function (ok) {
      if (!ok) return { status: 0, text: '' };

      return new Promise(function (resolve) {
        var id = ++sendSeq;
        pendingSends[id] = resolve;
        setTimeout(function () {
          if (pendingSends[id]) {
            delete pendingSends[id];
            resolve({ status: 0, text: '[转发超时]' });
          }
        }, 8000);

        try {
          window.postMessage({
            source: 'DYC_STOCK_PROBE_CMD', type: 'send', id: id,
            url: String(url), method: opts.method || 'GET',
            body: opts.body != null ? String(opts.body) : null,
            // 跨子域请求要带登录凭证，否则平台回 401「缺失登录凭证」
            credentials: !!opts.credentials
          }, '*');
        } catch (e) {
          if (pendingSends[id]) { delete pendingSends[id]; resolve({ status: 0, text: '' }); }
        }
      });
    });
  }

  /**
   * 取平台最近一次商品池请求的公共参数（source / scene_id / plan_id）。
   *
   * 为什么照抄而不是写死：plan_id 随直播场次变化，写死会加错场次；
   * 抄平台自己的请求，平台改参数我们自动跟随。没开过商品池就返回 null，
   * 调用方自行用默认值兜底，不许把 null 当成功。
   *
   * @returns {Promise<null|{source:string, scene_id:string, plan_id:string}>}
   */
  function apiParams() {
    return ensureReady(2000).then(function (ok) {
      if (!ok) return null;
      return new Promise(function (resolve) {
        var id = ++paramsSeq;
        pendingParams[id] = resolve;
        setTimeout(function () {
          if (pendingParams[id]) { delete pendingParams[id]; resolve(null); }
        }, 1500);
        try {
          window.postMessage({ source: 'DYC_STOCK_PROBE_CMD', type: 'params', id: id }, '*');
        } catch (e) {
          if (pendingParams[id]) { delete pendingParams[id]; resolve(null); }
        }
      });
    });
  }

  /**
   * 开监听窗口
   * @param {number} ttlMs 窗口时长（毫秒），默认 30 秒
   */
  function arm(ttlMs) {
    armedEver = true;
    records = [];
    return ensureReady(2500).then(function (ok) {
      if (!ok) {
        say('网络监听未注入成功，本轮抓不到请求');
        return false;
      }
      window.postMessage({
        source: 'DYC_STOCK_PROBE_CMD', type: 'arm', ttl: ttlMs
      }, '*');
      return true;
    });
  }

  /** 诊断报告附加段：无记录也要给状态行，让分析侧分得清「没抓到」和「没在抓」 */
  function reportSection() {
    if (!armedEver) return '';
    var lines = [];
    lines.push('');
    lines.push(xhs ? '## 小红书·接口取样（已脱敏）' : '## 接口取样');

    if (!ready && records.length === 0) {
      lines.push('- 监听尚未就绪，本轮没有采到请求。');
      return lines.join('\n');
    }

    lines.push('- 状态:已注入,记录 ' + records.length + ' 条(只记本站接口,静态资源不计)');
    if (records.length === 0) {
      lines.push('- 未采到请求，请在开始接口取样后 30 秒内完成要记录的操作。');
      return lines.join('\n');
    }

    for (var i = 0; i < records.length; i++) {
      var r = records[i];
      lines.push('');
      lines.push('### 请求#' + (i + 1) + ' ' + (r.method || '?') + ' ' +
                 (r.url || '?') + '  [' + (r.status != null ? r.status : '?') + ']');
      if (xhs && r.business) lines.push('- 业务参数: ' + JSON.stringify(r.business));
      if (r.reqBody) lines.push('- 请求体: ' + r.reqBody);
      if (r.respText) lines.push('- 响应体: ' + r.respText);
    }
    return lines.join('\n');
  }

  window.__DYC_STOCK_PROBE__ = {
    arm: arm,
    reportSection: reportSection,
    sendRequest: sendRequest,
    apiParams: apiParams,
    records: function () { return records.slice(); },
    clear: function () { records = []; }
  };

})();
