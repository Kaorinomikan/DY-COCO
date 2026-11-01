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
 *   每次 arm 两条都发，探针侧幂等（防重入）+ 每次注入都补发 ready，
 *   哪条路先到都一样。ready 后 200ms 再补发 arm 命令 —— 探针首次 eval
 *   是在挂命令监听器「之前」报的到，命令直接跟着 ready 发会跑在监听器前面。
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

  var MAX_RECORDS = 120;
  var records = [];
  var ready = false;          // MAIN world 探针是否已回话
  var armedEver = false;      // 本页是否开过监听窗（区分「没开窗」与「开窗失败」）
  var pendingTtl = 0;         // 待补发的监听窗口时长
  var ensureTimer = null;
  var sendSeq = 0;            // 转发请求序号
  var pendingSends = {};      // id → resolve
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

  function sendArm() {
    try {
      window.postMessage({
        source: 'DYC_STOCK_PROBE_CMD', type: 'arm', ttl: pendingTtl
      }, '*');
    } catch (e) { /* 理论不失败 */ }
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
      // 补发 arm：探针首次 eval 先报到、后挂监听器，稍等一拍再发命令
      if (pendingTtl > 0) setTimeout(sendArm, 200);
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
  });

  /**
   * 等 MAIN 侧探针就绪(未装则现场装,script 标签 + 后台直注双通道)。
   * 事件驱动:ready 消息到达即唤醒等待者,零轮询。
   * @returns {Promise<boolean>} 超时(默认 3 秒)返回 false
   */
  function ensureReady(timeoutMs) {
    if (ready) return Promise.resolve(true);
    injectViaScriptTag();
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
            body: opts.body != null ? String(opts.body) : null
          }, '*');
        } catch (e) {
          if (pendingSends[id]) { delete pendingSends[id]; resolve({ status: 0, text: '' }); }
        }
      });
    });
  }

  /**
   * 开监听窗口
   * @param {number} ttlMs 窗口时长（毫秒），默认 30 秒
   */
  function arm(ttlMs) {
    records = [];
    ready = false;
    armedEver = true;
    pendingTtl = ttlMs > 0 ? ttlMs : 30000;

    injectViaScriptTag();
    injectViaBackground();

    // 2.5 秒还没 ready 就留日志证据 —— 报告附加段会如实标注「未注入」
    clearTimeout(ensureTimer);
    ensureTimer = setTimeout(function () {
      if (!ready) say('网络监听未注入成功(两条通道都没回话),本轮抓不到请求');
    }, 2500);
  }

  /** 诊断报告附加段：无记录也要给状态行，让分析侧分得清「没抓到」和「没在抓」 */
  function reportSection() {
    var lines = [];
    lines.push('');
    lines.push('## 库存清零·网络监听');

    if (!ready && records.length === 0) {
      if (!armedEver) {
        lines.push('- 状态:监听已就绪但本页还没开过窗（点面板「开始接口取样 30 秒」,或在商品管理列表页执行一次清零后开窗）');
      } else {
        lines.push('- 状态:监听未注入成功(页面 CSP 拦截或内核不支持),本轮没有抓到任何请求');
      }
      return lines.join('\n');
    }

    lines.push('- 状态:已注入,记录 ' + records.length + ' 条(只记本站接口,静态资源不计)');
    if (records.length === 0) {
      lines.push('- 本轮窗口内没有本站请求经过(确认操作是否发生在点击「清空库存」后的 30 秒内)');
      return lines.join('\n');
    }

    for (var i = 0; i < records.length; i++) {
      var r = records[i];
      lines.push('');
      lines.push('### 请求#' + (i + 1) + ' ' + (r.method || '?') + ' ' +
                 (r.url || '?') + '  [' + (r.status != null ? r.status : '?') + ']');
      if (r.reqBody) lines.push('- 请求体: ' + r.reqBody);
      if (r.respText) lines.push('- 响应体: ' + r.respText);
    }
    return lines.join('\n');
  }

  window.__DYC_STOCK_PROBE__ = {
    arm: arm,
    reportSection: reportSection,
    sendRequest: sendRequest,
    records: function () { return records.slice(); },
    clear: function () { records = []; }
  };

  // 模块加载即装 MAIN 侧探针(与开窗解耦):渠道品直提的「转发请求」依赖它就绪,
  // 页面一打开就装好,点击时零等待。被动记录仍只在 arm 开窗后发生。
  injectViaScriptTag();
  injectViaBackground();
})();
