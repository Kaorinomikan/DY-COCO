/**
 * 调试面板(2026-10-16 从 clear-stock.js 迁出,独立成文件)
 *
 * 为什么独立成文件:
 *   原实现里 isDebugMode() / initDebugPanel() 定义在 clear-stock.js、
 *   mountDebugPanel() 定义在 main.js,而这两个文件**只注入商品列表页**。
 *   于是中控台开了调试模式只有橙色徽标、没有面板 —— 而中控台恰恰是功能最密集
 *   (搜索 / 序号定位 / 货号复制 / 上滑到顶 / 名称换行 / 隐藏元素)、最需要诊断的页面。
 *   独立成文件后两组都注入,面板自带挂载,不再依赖 main.js。
 *
 * 顺带修好一处既有失效:
 *   src/live/locate.js 的 debugLogProductIdentify() 里写着
 *     if (typeof isDebugMode === 'function' && !isDebugMode()) return;
 *   但中控台那组脚本里原本没有 isDebugMode ⇒ typeof 得 'undefined' ⇒ 条件短路 ⇒
 *   该门禁从来没拦住过任何东西。isDebugMode 随本文件进入中控台后,门禁才真正生效。
 *
 * 设计约束:
 *   ① **不自动弹出**(2026-10-18 用户定,取代 2026-10-13 的「面板常驻」)—— 调试模式
 *      开启时只在左下角把标记变橙,黑底日志框**不出现**;首次点左下角标记(消息盒子)
 *      才挂载。理由:调试态常开时那块黑框一直压着页面左下角,看不到也关不掉,
 *      日常操作碍眼。开关打开 ≠ 现在就要看日志。
 *   ② **懒挂载 + 独立常驻** —— 打开后不随消息盒子收起而消失,面板自带「收起」按钮;
 *      点页面空白只收消息盒子,面板不动(用户 2026-10-18 定)。
 *   ③ **不覆盖消息盒子** —— 消息盒子固定在左下角 340px 宽,面板一律排在它右侧
 *      (left:348px),两者并排不叠。
 *   ④ 固定 px + Shadow DOM 隔离 —— 注入式控件不随页面缩放变大小,也不被页面 CSS 污染
 *   ⑤ 日志双写 —— 面板上实时可见(人看) + 进 __dycDiag 轨迹缓冲(报告带走,AI 看)。
 *      面板未打开期间产生的日志先进内存缓冲(限 200 条),打开时一次性回填 ——
 *      否则「点开之前发生的事」全丢,而恰恰那些是最需要看的。
 *   ⑥ **可自由拖动,但位置不记忆**(2026-11-01 用户定) —— 整条标题栏是手柄,
 *      位置只存本页内存:各页面互相独立(拖动一个不会带动别的),刷新页面或
 *      在弹窗里关掉调试模式都回默认位置;只有「收起再打开」保留位置。
 *
 * 对外接口(挂到隔离世界的 window,供同组脚本调用):
 *   isDebugMode()          当前是否调试态
 *   debugLog(msg)          记一条调试日志(双写)
 *   dybDebugPanel.open()   挂载/展开面板(非调试态下无效)
 *   dybDebugPanel.close()  收起面板
 *   dybDebugPanel.isOpen() 面板是否已挂载
 */
(function () {
  'use strict';

  if (window.__DYB_DEBUG_PANEL__) return;        // 防重复注入
  window.__DYB_DEBUG_PANEL__ = true;

  // ⚠️ 这个 id 是契约,不要改:
  //    · row-scan.js 靠 closest('#dyb-debug-panel') 跳过扩展自身节点
  //    · flags.js 的 DYC_DIAG_WIDGET_NAMES 靠它显示中文名
  //    · diag.js 的 collectWidgets 靠 [id^="dyb-"] 扫到它
  //    · 走 Shadow DOM 后,id 留在 host 上,上面三处照旧有效
  var HOST_ID = 'dyb-debug-panel';

  /* ==========================================================
   * 一、调试态判定
   * ========================================================== */

  // 先按 URL 判定(同步、立即可用),再异步用 storage 修正。
  //
  // 修正值必须**缓存**下来 —— 不能直接判断 get() 的返回值:
  // MV3 的 chrome.storage.local.get 在不传回调时返回 Promise,
  // 对 Promise 取 .dybDebug 永远是 undefined,等于这段逻辑从来没生效过
  // (历史实现就是这么写的,26.10.11.3 一并修正)。
  var dybDebugOn = /[?&]dyb_debug=1/.test(location.href);
  try {
    chrome.storage.local.get('dybDebug', function (r) {
      if (chrome.runtime.lastError) return;
      dybDebugOn = !!(r && r.dybDebug);

      // ⚠️ 这里**不再挂面板**(2026-10-18 用户改口径)。
      // 原实现在此补一次 boot() 把面板挂出来 —— 用户反馈「开着调试模式时那块
      // 黑框一直压在页面左下角」,要求「默认不弹,点消息盒子才弹」。
      // 现在面板由点击标记懒挂载(见 openPanel),此处无须动作。
    });
  } catch (e) {
    console.warn('[DYB] 读取调试开关失败,沿用 URL 判定');
  }

  /* ---------- 开关即时生效(2026-10-16;2026-10-18 改「不自动弹」) ----------
   * 弹窗拨开关**不再改写页面地址** —— 那会让整页重载,正在填的表单、
   * 滚动位置、页面状态全丢(用户明确不要这个副作用)。
   * 改为由本脚本订阅开关变化,就地生效:
   *   开 → **不弹面板**(用户 2026-10-18:等点消息盒子再弹)。标记由
   *        anchor.js 自己变橙;本脚本的点击委托是全局常驻的、按 isDebugMode()
   *        自门控,所以这里不需要额外动作。
   *   关 → 摘掉面板(已经打开的一并收掉)。
   *
   * 关闭时若地址里还留着 dyb_debug=1,顺手静默摘掉 —— 不导航、不刷新。
   * 不摘的话「地址带参数」本身就是调试态来源,面板摘了会被判定重新挂上,
   * 开关看起来就关不掉。
   */
  try {
    if (chrome.storage && chrome.storage.onChanged) {
      chrome.storage.onChanged.addListener(function (changes, area) {
        if (area !== 'local' || !changes || !changes.dybDebug) return;
        dybDebugOn = !!changes.dybDebug.newValue;

        /* 2026-10-18 用户定「检查一下其他按钮有没有漏设计弹提示」:
         * 调试模式原先**完全不出声** —— 拨开/关掉只看到橙色标记切换,
         * 左下角一条提示都没有,与其他 14 个开关不一致。
         * 提示放在**页面侧**(而不是弹窗里),因为它要对「在弹窗里拨」和
         * 「别的标签页拨」两种情形都生效;anchor.js 也在订阅同一个键,
         * 但那里只换标记、不发声,不会重复。
         *
         * ⚠️ 与主干合并时这里冲突过一次:主干同期改成「开的时候**不自动弹**面板,
         *    等用户点消息盒子再弹」。本处以**主干的时机**为准,只把提示加进去 ——
         *    所以下面是 `if (dybDebugOn) return;`,不是 `boot()`。
         */
        if (typeof toast === 'function') {
          toast(dybDebugOn ? '已开启' : '已关闭', 'info', { source: '调试模式' });
        }

        if (dybDebugOn) { scheduleMark(); return; }   // 开:补标记,但不弹面板

        clearUrlParam();
        if (!isDebugMode()) teardown();
      });
    }
  } catch (e) {
    console.warn('[DYB] 订阅调试开关失败,关闭时仍需手动刷新');
  }

  /** 静默摘掉地址里的 dyb_debug=1(不导航、不刷新页面) */
  function clearUrlParam() {
    if (!/[?&]dyb_debug=1/.test(location.href)) return;
    try {
      var u = new URL(location.href);
      u.searchParams.delete('dyb_debug');
      var out = u.toString();
      if (out.charAt(out.length - 1) === '?') out = out.slice(0, -1);
      history.replaceState(null, '', out);
    } catch (e) {
      console.warn('[DYB] 清理地址调试参数失败');
    }
  }

  /** 摘掉调试面板。幂等:没挂过就当无事发生。
   *  必须同时把 shadow 置空 —— 否则 $() 会在已脱离文档的 Shadow 树上
   *  找元素,后续 debugLog 写进一棵看不见的树里,面板重新打开时日志缺失。
   *
   *  keepPos(2026-11-01):true = 保留拖动位置(点「收起」,面板还会回来);
   *  省略 / false = **位置一并忘记**(调试模式被关掉),下次打开回默认位置。 */
  function teardown(keepPos) {
    if (drag) finishDrag();          // 拖动中被摘掉:先把 window 上的监听收干净
    var host = document.getElementById(HOST_ID);
    if (host && host.parentNode) host.parentNode.removeChild(host);
    shadow = null;
    hostEl = null;
    if (!keepPos) pos = null;
  }

  function isDebugMode() {
    // 两处任一为真即算调试模式(与改造前同口径):
    //   storage —— 弹窗开关,拨完由上面的订阅即时生效,不需要刷新
    //   URL     —— 用户手输参数进入,或点过弹窗的「加参数并刷新」
    return dybDebugOn || /[?&]dyb_debug=1/.test(location.href);
  }

  /* ==========================================================
   * 二、面板样式
   * ========================================================== */

  // 选择器一律单行写 —— 降级模式(见 buildHost)要靠正则给每条规则加 host 前缀。
  var CSS = `
.panel {
  all: initial;
  display: block;
  box-sizing: border-box;
  width: 100%;
  max-height: 420px;
  overflow-y: auto;
  background: #1f2329;
  color: #e5e6eb;
  font-family: Consolas, Monaco, monospace;
  font-size: 12px;
  line-height: 1.7;
  padding: 12px;
  border-radius: 8px;
  box-shadow: 0 4px 24px rgba(0,0,0,.4);
}
.panel * { box-sizing: border-box; }
.head {
  display: flex; align-items: center; justify-content: space-between;
  margin-bottom: 8px;
  cursor: move; user-select: none; -webkit-user-select: none; touch-action: none;
}
.title { font-weight: 500; color: #ff7d00; }
.close {
  flex: none; margin-left: 12px; padding: 2px 10px; font-size: 12px;
  cursor: pointer; background: #2b303a; color: #e5e6eb;
  border: 1px solid #4a505c; border-radius: 4px; font-family: inherit;
  line-height: 18px;
}
.close:hover { background: #363c47; }
.hint { color: #86909c; margin-bottom: 8px; }
.log {
  min-height: 60px; max-height: 240px; overflow-y: auto;
  padding: 8px; background: #171a1f; border-radius: 4px;
  border: 1px solid #2b303a; color: #00b42a; line-height: 1.6;
}
.log .dim { color: #86909c; }
.btns { margin-top: 10px; display: flex; flex-wrap: wrap; gap: 6px 0; }
.btns button {
  margin-right: 6px; padding: 6px 14px; font-size: 12px;
  cursor: pointer; background: #2b303a; color: #e5e6eb;
  border: 1px solid #4a505c; border-radius: 4px; font-family: inherit;
}
.btns button:disabled { opacity: .6; cursor: default; }
.msg {
  margin-top: 8px; font-size: 12px; line-height: 1.6;
  color: #86909c;
}
.msg.ok { color: #00b42a; }
.msg.err { color: #f53f3f; }
.msg[hidden] { display: none; }
.fallback {
  display: block; width: 100%; margin-top: 10px; min-height: 140px;
  background: #171a1f; color: #e5e6eb; border: 1px solid #2b303a;
  border-radius: 4px; padding: 8px; font-family: inherit; font-size: 12px;
  resize: vertical;
}
.fallback[hidden] { display: none; }
`;

  /** 降级用:给每条规则加 host 前缀,避免样式泄漏到页面 */
  function scopedCss() {
    return CSS.replace(/(^|\n)([^\n{}]+)\{/g, function (m, br, sel) {
      var s = sel.trim();
      if (!s) return m;
      return br + '#' + HOST_ID + ' ' + s + '{';
    });
  }

  /* ==========================================================
   * 三、构建面板
   * ========================================================== */

  var shadow = null;   // Shadow DOM 根;老内核降级时为 null
  var hostEl = null;   // 面板宿主节点;未挂载为 null

  /** 统一查找面板内元素 —— 两种模式下都能用 */
  function $(id) {
    var root = shadow || document.getElementById(HOST_ID);
    return root ? root.querySelector('#' + id) : null;
  }

  function buildHost() {
    var host = document.createElement('div');
    host.id = HOST_ID;

    // 位置(2026-10-18 用户定「不覆盖消息盒子」):
    //   消息盒子固定在左下角、宽 340px、底 34px。面板左缘让到 348px(340 + 8 间距),
    //   右对齐同一底边 —— 两者左右并排,谁也不压谁。原实现 left:0 会整块盖住盒子。
    // 宽度:基准 460px,再用 max-width 跟视口联动 —— 窗口被拉窄时自动收缩,
    //   不会有一截伸出屏幕外点不到(用 calc 而非在 JS 里量一次,
    //   是因为用户随时可能改窗口大小,量一次只会得到打开那一刻的值)。
    //
    // z-index 刻意比状态条(2147483647)低 1:
    //   消息条从标记背后往右滑出,长的会越到面板这片区域。让消息条压在上面,
    //   它会像 toast 一样飘过面板;若反过来(面板更高),消息条就被面板切掉半截,
    //   看着像渲染坏了。面板本身仍可点,只是让出路权。
    host.style.cssText = [
      'position:fixed', 'bottom:34px', 'left:348px',
      'width:460px', 'max-width:calc(100vw - 356px)',
      'z-index:2147483646'
    ].join(';');

    var root;
    var style = document.createElement('style');
    try {
      shadow = host.attachShadow({ mode: 'open' });
      style.textContent = CSS;
      root = shadow;
    } catch (e) {
      // 老内核不支持 Shadow DOM:降级为普通节点,样式加 host 前缀防泄漏。
      // 隔离性降级(仍可能被页面的 !important 规则压到),但面板至少可用。
      shadow = null;
      style.textContent = scopedCss();
      root = host;
      console.warn('[DYB] Shadow DOM 不可用,调试面板降级为普通节点');
    }
    root.appendChild(style);

    var panel = document.createElement('div');
    panel.className = 'panel';
    panel.innerHTML = ''
      + '<div class="head">'
      +   '<span class="title">调试模式已开启</span>'
      +   '<button type="button" class="close" id="dyb-debug-close">收起</button>'
      + '</div>'
      + '<div class="hint">日志实时显示；按住标题栏可拖动</div>'
      + '<div class="log" id="dyb-debug-log"></div>'
      + '<div class="btns">'
      // 导出页面结构(2026-10-18 用户要求):与弹窗里那枚同名按钮是同一个探针,
      // 区别只在于入口 —— 面板就长在页面上,操作时不用「先开弹窗、再点按钮」。
      +   '<button type="button" id="dyb-debug-probe">导出页面结构</button>'
      +   '<button type="button" id="dyb-debug-report">复制诊断报告</button>'
      +   '<button type="button" id="dyb-debug-netarm">开始接口取样 30 秒</button>'
      +   '<button type="button" id="dyb-debug-clear">清空日志</button>'
      + '</div>'
      + '<div class="msg" id="dyb-debug-msg" hidden></div>'
      + '<textarea class="fallback" id="dyb-debug-fallback" readonly hidden></textarea>';
    root.appendChild(panel);

    return host;
  }

  /* ==========================================================
   * 四、日志:双写
   * ========================================================== */

  /**
   * 面板未打开期间的日志缓冲(2026-10-18)。
   *
   * 面板改成「点标记才弹」之后,存在一个空档:开关刚拨开、用户还没点标记时,
   * 各模块已经在调 debugLog 了。如果只往 DOM 写,那批日志全部落空 ——
   * 而它们往往正是「为什么面板没出来 / 刚才那步为什么失败」的证据。
   * 故未挂载时先进内存队列(上限 LOG_BUF_MAX 条,超出丢最旧),
   * openPanel() 时一次性回填。
   */
  var LOG_BUF_MAX = 200;
  var logBuf = [];

  function appendLogLine(box, text) {
    // 用 textContent 追加而非 innerHTML += —— 页面上的商品标题可能含尖括号,
    // 拼进 innerHTML 会被解析成标签,日志内容随之错乱或整块消失。
    var line = document.createElement('div');
    line.textContent = '[' + new Date().toLocaleTimeString() + '] ' + text;
    box.appendChild(line);
    box.scrollTop = box.scrollHeight;
  }

  /**
   * 记一条调试日志。
   *
   * 双写的理由:面板上的日志是「给人看的实时流水」,刷新即清;
   * 诊断内核的轨迹缓冲是「给 AI 分析用的证据链」,会随报告带走。
   * 只写面板 ⇒ 报告里什么都没有;只写内核 ⇒ 用户看不见实时反馈。
   */
  function debugLog(msg) {
    // ① 面板上实时可见(未挂载时进缓冲,见 logBuf)
    var box = $('dyb-debug-log');
    if (box) {
      appendLogLine(box, msg);
    } else {
      logBuf.push(String(msg));
      if (logBuf.length > LOG_BUF_MAX) logBuf.shift();
    }

    // ② 进诊断内核的轨迹缓冲
    try {
      var d = window.__dycDiag;
      if (d && typeof d.note === 'function') d.note('调试日志', String(msg));
    } catch (e) { /* 记不上不影响主流程 */ }

    console.log('[DYB-DBG]', msg);
  }

  /** 把缓冲里的历史日志一次性倒进面板(打开面板时调用)。
   *  空态由 openPanel 紧接着写入的「调试面板已打开」一行承担,
   *  不再单独放「等待操作」占位 —— 两行叠在一起反而像重复提示。 */
  function flushLogBuf() {
    var box = $('dyb-debug-log');
    if (!box || !logBuf.length) return;
    logBuf.forEach(function (t) { appendLogLine(box, t); });
    logBuf = [];
  }

  /* ==========================================================
   * 五、剪贴板:三级兜底
   * ========================================================== */

  /** 最后一级:展开一个只读文本域,让用户自己全选复制 */
  function showFallback(text) {
    var fb = $('dyb-debug-fallback');
    if (!fb) return;
    fb.value = text;
    fb.hidden = false;
    try {
      fb.focus();
      fb.select();
    } catch (e) {}
    // 明确告诉用户「下一步做什么」—— 只展开一个框、不说话,
    // 用户会以为复制成功或干脆没反应（2026-10-19 的反馈就是这么来的）
    say('已全选：按 Ctrl+C 复制，或右键「复制」', 'err');
  }

  /** 第二级:execCommand —— 老内核上 clipboard API 不可用时的常规手段 */
  function legacyCopy(text) {
    var prev = null;
    try { prev = document.activeElement; } catch (e0) {}
    var ta = null;
    try {
      ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0';
      document.body.appendChild(ta);
      ta.select();
      ta.setSelectionRange(0, ta.value.length);
      var ok = document.execCommand('copy');
      return !!ok;
    } catch (e) {
      return false;
    } finally {
      try { if (ta && ta.parentNode) ta.parentNode.removeChild(ta); } catch (e2) {}
      // 复制完把焦点还给用户原来在的地方（否则面板按钮会失焦、再点要重新找）
      try { if (prev && prev.focus) prev.focus(); } catch (e3) {}
    }
  }

  /**
   * 复制文本,结果经回调返回。
   *
   * ⚠️ 顺序是 2026-10-19 改的，别改回去：
   *   **必须先同步走 execCommand，再试 clipboard API。**
   *   原来先调 `navigator.clipboard.writeText(...).then(...)`，失败才在 **Promise 回调**里
   *   调 execCommand —— 那时用户手势（transient activation）已经过期，
   *   浏览器会静默拒绝，`execCommand` 返回 false 甚至返回 true 但剪贴板是空的。
   *   用户看到的就是「点了复制，什么都没发生」。
   *   同步调用链里 execCommand 才是稳的；clipboard API 只作第二选择。
   */
  function copyText(text, cb) {
    if (legacyCopy(text)) { cb(true); return; }
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(
          function () { cb(true); },
          function () { cb(false); }
        );
        return;
      }
    } catch (e) { /* 落到失败分支 */ }
    cb(false);
  }

  /* ==========================================================
   * 六、按钮行为
   * ========================================================== */

  var BTN_REPORT_TEXT = '复制诊断报告';
  var BTN_PROBE_TEXT = '导出页面结构';

  /**
   * 组装完整报告文本 = 诊断内核报告 + 页面专属附加段(2026-10-21 新增)。
   * 附加段：库存清零·网络监听(stock-net-probe.js) / 微信商品链接取源
   * (wx-goods-tools.js, 2026-10-31 接入 —— 接口取样与主世界桥在不在场，只看
   *  「点了按钮之后有没有弹出面板」是查不出来的，必须让报告自己说话)。
   * 附加段拿不到/生成失败都不影响主报告 —— 报告的价值永远不押在附加段上。
   */
  function buildReport(d) {
    return Promise.resolve(d.report()).then(function (text) {
      var out = text;
      var extras = [window.__DYC_STOCK_PROBE__, window.__DYC_WX_LINK__];
      for (var i = 0; i < extras.length; i++) {
        try {
          var p = extras[i];
          if (p && typeof p.reportSection === 'function') {
            var sec = p.reportSection();
            if (sec) out += sec;
          }
        } catch (e) { /* 单个附加段失败静默,其余与主报告照常给 */ }
      }
      return out;
    });
  }

  /** 面板上的结果提示行(导出结构用;复制诊断报告仍走文本框兜底,不共用) */
  function say(text, kind) {
    var box = $('dyb-debug-msg');
    if (!box) return;
    box.textContent = text || '';
    box.className = 'msg' + (kind ? ' ' + kind : '');
    box.hidden = !text;
    clearTimeout(box._timer);
    // 成功提示 4 秒后自动隐去;失败提示常驻,用户要能看清原因
    if (text && kind === 'ok') {
      box._timer = setTimeout(function () { box.hidden = true; }, 4000);
    }
  }

  /**
   * 「导出页面结构」(2026-10-18 用户要求搬进面板)
   *
   * 与弹窗里那枚同名按钮是**同一支探针**(src/content/page-probe.js),
   * 区别只在入口:面板长在页面上,操作时不必「先点扩展图标、再点按钮」。
   *
   * 三条链路要点(改动前先看,别改坏):
   *   ① 内容脚本没有 chrome.scripting ⇒ 必须请后台代注入(dyc:probePage);
   *   ② 探针采完**到不了** chrome.runtime.onMessage(那是弹窗/后台收的),
   *      它直接回调本面板挂的 window.__dycProbeSink —— 同一个隔离世界,
   *      window 是同一个对象。sink 一次性,用完探针自己摘掉;
   *   ③ sink 必须在发消息**之前**挂好:探针跑得快时,晚挂就漏接。
   */
  function runProbe(btn) {
    if (btn.__busy) return;
    btn.__busy = true;
    btn.disabled = true;
    btn.textContent = '正在读取页面…';
    say('');

    var done = false;
    var timer = null;

    function finish(res) {
      if (done) return;
      done = true;
      clearTimeout(timer);
      btn.__busy = false;
      btn.disabled = false;
      btn.textContent = BTN_PROBE_TEXT;

      if (!res || !res.ok) {
        var why = (res && res.error) || '采集失败';
        say(why, 'err');
        debugLog('导出页面结构失败:' + why);
        return;
      }
      copyText(res.text, function (ok) {
        if (ok) {
          say('已复制到剪贴板,粘贴给助手即可', 'ok');
        } else {
          // 复制失败不算失败 —— 把报告展开,用户手选一样能带走
          // （提示语由 showFallback 统一给，这里不再重复一句）
          showFallback(res.text);
        }
      });
      debugLog('导出页面结构成功(' + (res.text || '').length + ' 字符)');
    }

    // ③ 先挂接收口,再发消息
    window.__dycProbeSink = finish;

    // ② 兜底:探针万一没回话,不能让按钮永远卡在「正在读取」
    timer = setTimeout(function () {
      window.__dycProbeSink = null;
      finish({ ok: false, error: '读取超时,请刷新页面后重试' });
    }, 12000);

    try {
      chrome.runtime.sendMessage({ type: 'dyc:probePage' }, function (r) {
        // 读掉 lastError,否则控制台会蹦一条「Receiving end does not exist」
        var err = chrome.runtime.lastError;
        if (err) {
          window.__dycProbeSink = null;
          finish({ ok: false, error: '扩展后台未响应,请刷新页面后重试' });
          return;
        }
        // 后台只是「已注入」的回执,真正的报告走 sink 那条路 —— 这里不 finish。
        // 但注入本身失败(权限/内核不支持)必须当场报,否则只能等 12 秒超时。
        if (r && r.ok === false) {
          window.__dycProbeSink = null;
          finish({ ok: false, error: r.error || '注入探针失败' });
        }
      });
    } catch (e) {
      window.__dycProbeSink = null;
      finish({ ok: false, error: '无法与扩展后台通信' });
    }
  }

  function bindButtons() {
    var btnReport = $('dyb-debug-report');
    var btnClear = $('dyb-debug-clear');
    var btnClose = $('dyb-debug-close');
    var btnProbe = $('dyb-debug-probe');
    var btnNetArm = $('dyb-debug-netarm');

    /* 「开始接口取样 30 秒」依赖库存探针（window.__DYC_STOCK_PROBE__），
     * 只有注入了 stock-net-probe 的条目才有（抖店商品列表 / 中控台 /
     * 2026-10-31 起的微信小店两个域）。
     * 按「在场才显示」处理：探针没装的页面点这按钮只会弹一句「监听模块不在场」，
     * 让用户以为自己弄坏了什么。
     * 用 style.display 而不是 hidden：面板 CSS 给按钮设了显示规则，
     * hidden 属性会被 display 规则覆盖掉。 */
    if (btnNetArm && !(window.__DYC_STOCK_PROBE__ && typeof window.__DYC_STOCK_PROBE__.arm === 'function')) {
      btnNetArm.style.display = 'none';
    }

    if (btnClose) {
      btnClose.addEventListener('click', function () {
        closePanel();
      });
    }

    // 「开始接口取样 30 秒」(2026-10-24 渠道品直提配套):手动开一个监听窗口,
    // 用于平台暂不支持的页面上现场侦察接口(如渠道品)。同一探针、只记本站请求。
    if (btnNetArm) {
      btnNetArm.addEventListener('click', function () {
        var probe = window.__DYC_STOCK_PROBE__;
        if (!probe || typeof probe.arm !== 'function') {
          say('监听模块不在场(本页脚本未含或未刷新)', 'err');
          return;
        }
        probe.arm(30000);
        say('监听已开窗 30 秒:现在手动做一次操作,完成后点「复制诊断报告」', 'ok');
      });
    }

    if (btnProbe) {
      btnProbe.addEventListener('click', function () {
        runProbe(this);
      });
    }

    if (btnReport) {
      btnReport.addEventListener('click', function () {
        var self = this;
        var d = window.__dycDiag;

        // 内核不在场是**可能发生的**(扩展刚更新、本页还没刷新),
        // 如实提示,不假装成功。
        if (!d || typeof d.report !== 'function') {
          showFallback(
            '诊断内核未就绪。\n\n'
            + '常见原因:扩展刚更新,本页还是旧代码。刷新页面后重试即可。'
          );
          return;
        }

        self.disabled = true;
        self.textContent = '生成中…';

        buildReport(d).then(function (text) {
          copyText(text, function (ok) {
            self.disabled = false;
            if (ok) {
              self.textContent = '已复制 ✓';
            } else {
              // 复制失败不算失败 —— 把报告展开,用户手选一样能带走
              self.textContent = '已展开 ↓';
              showFallback(text);
            }
            setTimeout(function () { self.textContent = BTN_REPORT_TEXT; }, 2000);
          });
        }, function () {
          self.disabled = false;
          self.textContent = BTN_REPORT_TEXT;
          showFallback('诊断报告生成失败。');
        });
      });
    }

    if (btnClear) {
      btnClear.addEventListener('click', function () {
        var box = $('dyb-debug-log');
        if (box) box.innerHTML = '<span class="dim">已清空</span>';
        logBuf = [];   // 缓冲一并清,否则重开面板又把旧日志倒回来
        say('');       // 结果提示行也一起清,免得留着一条过期的「已复制」

        // 必须同时清诊断内核的缓冲 —— 否则面板清了、报告里还带着旧轨迹,
        // 两边对不上,用户会以为是 bug。
        try {
          var d = window.__dycDiag;
          if (d && typeof d.clear === 'function') d.clear();
        } catch (e) {}

        var fb = $('dyb-debug-fallback');
        if (fb) { fb.hidden = true; fb.value = ''; }
      });
    }
  }

  /* ==========================================================
   * 七、拖动与位置(2026-11-01)
   *
   * 用户口径(2026-11-01 定):
   *   ① 面板可**自由拖动**,整条标题栏是手柄,「收起」按钮除外;
   *   ② 位置**只在本页内存里**记着 —— 各标签页、各平台页面互相独立,
   *      一个页面拖动**不会**带动别的页面;
   *   ③ **不落盘、无记忆**:刷新页面 → 脚本重新注入 → 回默认位置;
   *      在弹窗里关掉调试模式 → teardown 清空 → 再打开也回默认位置;
   *      只有「点收起再打开」保留位置(收起面板 ≠ 关调试模式)。
   *
   * 为什么不做跨页同步:方案评审时曾按「多页面同步」设计,用户当场改口
   * ——「每个页的位置都是临时单独记忆的,其中一个变化,其他不会跟着变」。
   * 于是不需要 storage.session、也不需要后台中转,位置就是一个模块变量:
   * 少一条跨页通道,就少一处会悄悄把位置落盘的地方。
   * ========================================================== */

  var MIN_VISIBLE = 120;   // 拖到边上时至少留这么多宽度,否则抓不回来、也拖不回来
  var HANDLE_H = 34;       // 标题栏高度(12px 内边距 + 22px 行高),必须整条留在视口内

  /**
   * 拖动位置的**页内临时记忆**。null = 从未拖过,用 CSS 里的默认位置
   * (贴消息盒子右侧)。只存内存 —— 刷新即丢,这正是用户要的「没有位置记忆」。
   */
  var pos = null;

  /**
   * 缩放比 = 布局像素 / 屏幕像素。
   *
   * 页面给容器挂 transform: scale() 做缩放适配时(直播大屏那种),
   * getBoundingClientRect() 给的是**屏幕**尺寸,offsetWidth 给的是**布局**尺寸,
   * 两者不等。鼠标位移是屏幕像素,必须除以缩放比才是布局位移,否则面板跟手
   * 比例不对、缩放越大偏得越多。拿不到合理值时按 1 处理 —— 宁可不校正,
   * 也不能除出个反向放大(曾用屏幕坐标直接反推 right 连错两次,见工备注)。
   */
  function scaleOf(offsetW, rectW) {
    if (!(offsetW > 0) || !(rectW > 0)) return 1;
    var s = offsetW / rectW;
    return (s > 0.2 && s < 5) ? s : 1;
  }

  /**
   * 把坐标夹进视口。left 允许把面板推到左边外面,但至少留 MIN_VISIBLE 宽
   * (拖过头就再也点不到);top 必须让整条标题栏可见,否则没法再拖回来。
   */
  function clampPos(left, top, w, vw, vh) {
    var maxLeft = Math.max(0, vw - MIN_VISIBLE);
    var minLeft = Math.min(0, MIN_VISIBLE - w);
    var maxTop = Math.max(0, vh - HANDLE_H);
    return {
      left: Math.min(maxLeft, Math.max(minLeft, left)),
      top: Math.min(maxTop, Math.max(0, top))
    };
  }

  /**
   * 把屏幕坐标换算成本面板的布局坐标。
   *
   * 起因:面板默认用 `left + bottom` 定位,拖动要改成 `left + top`。
   * 直接 `left = rect.left` 只在「没缩放、包含块就是视口」时成立 ——
   * 页面一旦挂 transform,rect 是缩放后的屏幕坐标,写进 left 就偏了。
   *
   * 做法:先把 rect 的两个分量当 left/top 写进去,再量一次得到 after;
   * 布局量→屏幕量是线性映射,一次校正即精确:
   *   布局坐标 = 屏幕坐标 + (原屏幕位置 - 写入后的屏幕位置) / s
   * 自校验:origin=0、s=0.8、真实布局 250、屏幕 200 → 写入 200 后屏幕 160,
   *   校正量 (200-160)/0.8 = 50 ⇒ 250,与真实值一致。
   */
  function layoutPos(before, after, s) {
    return {
      left: before.left + (before.left - after.left) / s,
      top: before.top + (before.top - after.top) / s
    };
  }

  /**
   * 拖动中的下一帧布局坐标(闭环)。
   *
   * 目标屏幕位置 = 起始屏幕位置 + 鼠标位移(都取屏幕像素,天然同尺度);
   * 当前屏幕位置 now 由 getBoundingClientRect() 现量。用「还差多少」而不是
   * 「累计加了多少」 —— 上一帧的舍入、clamp、缩放误差会被逐帧吃掉,
   * 不会越拖越错位。
   */
  function dragPos(cur, startScreen, now, move, s) {
    return {
      left: cur.left + ((startScreen.left + move.x) - now.left) / s,
      top: cur.top + ((startScreen.top + move.y) - now.top) / s
    };
  }

  /** 把布局坐标写到 host。bottom 必须置 auto ——
   *  同时留着 bottom 会和 top 抢,老内核上表现为「拖不动 / 自己弹回去」。 */
  function applyPos(host, p) {
    if (!host) return;
    host.style.left = p.left + 'px';
    host.style.top = p.top + 'px';
    host.style.bottom = 'auto';
  }

  /** 面板内元素根:Shadow DOM 优先,老内核降级时就是 host 本身 */
  function panelRoot() {
    return shadow || document.getElementById(HOST_ID);
  }

  /* ---------- 拖动状态机 ---------- */

  var drag = null;   // { host, s, cur, startScreen, startMouse, raf, pending }

  function bindDrag() {
    var root = panelRoot();
    var head = root ? root.querySelector('.head') : null;
    if (!head) return;
    head.addEventListener('mousedown', onHeadDown);
    head.addEventListener('touchstart', onHeadTouch, false);
  }

  function onHeadDown(ev) {
    if (ev.button !== 0) return;                                                // 只认左键
    if (ev.target && ev.target.closest && ev.target.closest('button')) return;  // 「收起」照点
    startDrag(ev.clientX, ev.clientY, ev);
  }

  function onHeadTouch(ev) {
    if (!ev.touches || ev.touches.length !== 1) return;
    if (ev.target && ev.target.closest && ev.target.closest('button')) return;
    startDrag(ev.touches[0].clientX, ev.touches[0].clientY, ev);
  }

  function startDrag(x, y, ev) {
    var host = hostEl || document.getElementById(HOST_ID);
    if (!host || drag) return;

    var before = host.getBoundingClientRect();
    var s = scaleOf(host.offsetWidth, before.width);

    // 记下切换前的行内样式:整段拖动若只是一次「点了一下标题栏」,要原样还回去。
    // 否则误点一下就会把默认的 left+bottom 定死成 left+top,面板不再贴消息盒子。
    var origin = {
      bottom: host.style.bottom,
      left: host.style.left,
      top: host.style.top,
      pos: pos
    };

    // 定位方式从 left+bottom 切到 left+top:先直写 rect 值,再按 layoutPos 校正一次,
    // 保证这一步本身不产生视觉跳动(否则一按下就闪一下)。
    host.style.bottom = 'auto';
    host.style.left = before.left + 'px';
    host.style.top = before.top + 'px';
    var cur = layoutPos(before, host.getBoundingClientRect(), s);
    applyPos(host, cur);

    drag = {
      host: host,
      s: s,
      cur: cur,
      startScreen: { left: before.left, top: before.top },
      startMouse: { x: x, y: y },
      origin: origin,
      moved: false,
      raf: 0,
      pending: null
    };

    // 阻止页面选中文字 / 触摸时页面跟着滚;这次按下也不该被平台当成它的拖拽起点
    try { ev.preventDefault(); } catch (e0) {}
    if (ev.stopPropagation) ev.stopPropagation();

    // 一律捕获阶段绑定 + 一律捕获阶段解绑,两边参数必须对得上
    window.addEventListener('mousemove', onDragMove, true);
    window.addEventListener('mouseup', onDragEnd, true);
    window.addEventListener('blur', onDragBlur, true);
    window.addEventListener('touchmove', onDragTouchMove, { capture: true, passive: false });
    window.addEventListener('touchend', onDragEnd, true);
    window.addEventListener('touchcancel', onDragBlur, true);
  }

  function onDragMove(ev) {
    if (!drag) return;
    // ⚠️ 只认真实事件。同页面其它模块(包括本扩展自己)会派发合成 mouseup / mousemove
    //    做自动化点击 —— 合成事件绝不能推动或结束拖动(曾把用户正在拖的滑条打断)。
    if (ev.isTrusted === false) return;
    queueMove(ev.clientX, ev.clientY);
  }

  function onDragTouchMove(ev) {
    if (!drag || !ev.touches || ev.touches.length !== 1) return;
    try { ev.preventDefault(); } catch (e0) {}
    queueMove(ev.touches[0].clientX, ev.touches[0].clientY);
  }

  /** 每帧最多算一次:每次都要读 getBoundingClientRect(强制布局),
   * 直接在 mousemove 里算会在老内核上明显掉帧 */
  function queueMove(x, y) {
    drag.pending = { x: x, y: y };
    if (drag.raf) return;
    drag.raf = requestAnimationFrame(applyMove);
  }

  function applyMove() {
    if (!drag) return;
    drag.raf = 0;
    var p = drag.pending;
    if (!p) return;
    var host = drag.host;
    var move = { x: p.x - drag.startMouse.x, y: p.y - drag.startMouse.y };
    // 2px 以内当手抖/误点:位置照算(跟手无感),但 finishDrag 会还原样式
    if (!drag.moved && (Math.abs(move.x) > 2 || Math.abs(move.y) > 2)) drag.moved = true;

    var next = dragPos(drag.cur, drag.startScreen, host.getBoundingClientRect(), move, drag.s);
    var c = clampPos(next.left, next.top, host.offsetWidth, window.innerWidth, window.innerHeight);
    applyPos(host, c);
    drag.cur = c;
  }

  function onDragEnd(ev) {
    if (!drag) return;
    if (ev && ev.isTrusted === false) return;   // 同上:合成 mouseup 不算松手
    finishDrag();
  }

  /** 失焦 / 触摸被系统收走:手已经离开,停在当前这点,不往回弹 */
  function onDragBlur() {
    if (!drag) return;
    finishDrag();
  }

  function finishDrag() {
    var d = drag;
    if (!d) return;
    drag = null;
    if (d.raf) { try { cancelAnimationFrame(d.raf); } catch (e0) {} }

    window.removeEventListener('mousemove', onDragMove, true);
    window.removeEventListener('mouseup', onDragEnd, true);
    window.removeEventListener('blur', onDragBlur, true);
    window.removeEventListener('touchmove', onDragTouchMove, true);
    window.removeEventListener('touchend', onDragEnd, true);
    window.removeEventListener('touchcancel', onDragBlur, true);

    // 只按下没拖动 —— 视为一次误点标题栏:样式与位置状态原样还回去,
    // 不留下「点一下就把默认位置定死」的副作用。
    if (!d.moved) {
      if (d.origin.pos) {
        applyPos(d.host, d.origin.pos);
      } else {
        d.host.style.bottom = d.origin.bottom;
        d.host.style.left = d.origin.left;
        d.host.style.top = d.origin.top;
      }
      return;
    }

    // 页内临时记忆:收起面板再打开还在原处(刷新才会丢,因为是内存)
    pos = { left: d.cur.left, top: d.cur.top };
    debugLog('面板已移到 ' + Math.round(pos.left) + ',' + Math.round(pos.top));
  }

  /* 窗口被拉小后位置可能整个跑到视口外 —— 只有拖过(pos 非空)才需要管。
     不写 pos 就不动它:默认位置由 CSS 的 bottom 自己贴底,不需要校正。 */
  try {
    window.addEventListener('resize', function () {
      if (!pos || !hostEl) return;
      var c = clampPos(pos.left, pos.top, hostEl.offsetWidth, window.innerWidth, window.innerHeight);
      if (c.left === pos.left && c.top === pos.top) return;
      pos = c;
      applyPos(hostEl, pos);
    });
  } catch (e) {
    console.warn('[DYB] 绑定窗口尺寸校正失败');
  }

  /* ==========================================================
   * 八、挂载(懒挂载,2026-10-18 改)
   *
   * 打开面板的唯一入口是**点左下角标记**。开关拨开不再自动挂:
   * 调试态常开时那块黑框一直压着页面左下角,日常操作碍眼
   * (用户 2026-10-18 原话:「默认不要弹出这个黑框框,等点击消息盒子再弹出」)。
   *
   * 但「打日志」与「看日志」解耦 —— 未挂载期间 debugLog 照常写进
   * 诊断内核与内存缓冲,打开面板时一次性回填,证据链不缺段。
   * ========================================================== */

  /* ---------- 兜底标记(2026-10-19) ----------
   * 「点标记」是打开面板的唯一入口,而标记原本只由 anchor.js 建 —— 可
   * anchor.js 只注入抖店与罗盘那几条条目,**直播回放两页(anchor.douyin.com /
   * liveservice.douyin.com)没有它**。结果那两页即便调试态为真,页面左下角
   * 什么也没有,面板永远打不开(用户 2026-10-19:「这个页面是不是抓不到
   * 调试模式,我开不了调试模式也没法给你反馈这个页面」)。
   *
   * 这里补一个兜底:调试态下若页面上没有标记,就自己建一条最小状态条 + 标记。
   *   · 只建标记,**不弹面板** —— 「默认不弹黑框」的口径不变
   *   · 幂等;0 / 800 / 2500ms 各试一次 —— SPA 首屏晚、容器也可能被重建
   *   · 页面已有 #dyb-status-bar(dialog.js 可能先建了)时只补标记 / 补类,
   *     不重复建容器 —— 重复建会出现两个标记
   */
  function ensureMark() {
    if (!isDebugMode()) return;
    if (!document.body) return;

    var bar = document.getElementById('dyb-status-bar');
    if (!bar) {
      bar = document.createElement('div');
      bar.id = 'dyb-status-bar';
      bar.className = 'dyb-status-bar--debug';
      var fresh = document.createElement('div');
      fresh.className = 'dyb-badge dyb-badge--debug';
      fresh.textContent = 'DY-COCO(调试模式)';
      bar.appendChild(fresh);
      document.body.appendChild(bar);
      return;
    }

    bar.classList.add('dyb-status-bar--debug');
    var badge = bar.querySelector('.dyb-badge');
    if (!badge) return;
    badge.classList.add('dyb-badge--debug');
    badge.classList.remove('dyb-badge--normal');
    // dialog.js 兜底建的标记文本是「DY-COCO」,换不换都不影响点击,
    // 但调试态下写清楚能少一次「我到底开没开」的疑问
    if (badge.textContent === 'DY-COCO') badge.textContent = 'DY-COCO(调试模式)';
  }

  function scheduleMark() {
    ensureMark();
    setTimeout(ensureMark, 800);
    setTimeout(ensureMark, 2500);
  }

  try {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', scheduleMark);
    } else {
      scheduleMark();
    }
  } catch (e) {
    console.warn('[DYB] 兜底标记创建失败,调试面板需手动打开', e);
  }

  /** 挂载面板并回填缓冲日志。非调试态 / 已挂载 / body 未就绪时静默返回。 */
  function openPanel() {
    if (!isDebugMode()) return false;
    // 内容脚本在 document_idle 时注入,此刻 body 已存在;
    // 但为防抖店改版时机变化,这里做个兜底。
    if (!document.body) return false;

    // 幂等:已挂载就什么都不做
    if (document.getElementById(HOST_ID)) return true;

    try {
      hostEl = buildHost();
    } catch (e) {
      // 构建中途抛异常时,shadow 可能已经指向一棵没挂进文档的树 ——
      // 不置空的话 debugLog 会一直往看不见的树里写,面板重开日志就断档了
      shadow = null;
      hostEl = null;
      console.warn('[DYB] 调试面板构建失败', e);
      return false;
    }

    document.body.appendChild(hostEl);

    // 本页临时记忆的位置(拖过才非空):收起后再打开还在原处。
    // 必须在 appendChild 之后写 —— 未挂进文档时 offsetWidth 为 0,
    // 窗口尺寸那套校正派不上用场。这里再夹一次,是因为「收起」期间
    // 用户可能把窗口拉小了,沿用旧坐标会整块跑到视口外。
    if (pos) {
      pos = clampPos(pos.left, pos.top, hostEl.offsetWidth || 460,
        window.innerWidth, window.innerHeight);
      applyPos(hostEl, pos);
    }

    // 面板内点击不外溢(2026-10-18):dialog.js 在 document 上挂「点盒子外面
    // 就收起消息盒子」的监听,而面板本身就在盒子外面 —— 用户点面板的
    // 「复制诊断报告」时消息盒子会顺手收掉,看着像误操作。
    // 冒泡阶段在 host 处截住即可:document 的监听晚于 host 触发。
    hostEl.addEventListener('click', function (ev) { ev.stopPropagation(); });

    bindButtons();
    bindDrag();
    flushLogBuf();
    debugLog('调试面板已打开');
    return true;
  }

  /** 收起面板(点面板自带的「收起」按钮)。调试态不变,后续日志重新进缓冲。
   *  teardown(true) = **保留拖动位置** —— 收起不等于关调试模式,再点标记回来
   *  应该还在原处;只有关调试模式才算「归位」(那条路径走 teardown() 无参)。 */
  function closePanel() {
    if (!document.getElementById(HOST_ID)) return;
    teardown(true);
    // 面板已看过的日志不必在下次打开时重复倒一遍;
    // 已进诊断内核的部分不受影响(报告照旧带着)。
    logBuf = [];
  }

  function panelOpen() {
    return !!document.getElementById(HOST_ID);
  }

  /* ---------- 标记点击:面板的唯一打开入口 ----------
   * 标记由 anchor.js 创建(状态条里的 .dyb-badge),可能比本脚本晚到
   * (脚本注入顺序:anchor.js 在前,但 body 挂载是异步的)。
   * 故用捕获阶段 + 全局委托:不挑绑定时机,也不与 dialog.js 的
   * 消息盒子展开/收起监听抢 —— 捕获阶段先跑,拿到点击后按需挂面板,
   * 消息盒子照旧按自己的逻辑开合。
   *
   * 语义按用户 2026-10-18 的选择收敛为「**打开**」而非「开关」:
   *   面板一旦出现就独立常驻,再点标记只开合消息盒子,面板不动;
   *   要收起只认面板自带的「收起」按钮。这样一边操作页面一边盯日志时,
   *   不会因为一次误点标记就把日志窗口关掉。
   */
  var lastBadgeClick = 0;

  function onDocClickCapture(e) {
    if (!isDebugMode()) return;
    var t = e.target;
    if (!t || !t.closest) return;
    var badge = t.closest('.dyb-badge');
    if (!badge) return;
    // 只认状态条里的标记,别把弹窗等处的同名 class 算进来
    var bar = badge.closest('#dyb-status-bar');
    if (!bar) return;

    // 双击保护:老内核上 click 偶尔双发,同一次点击会重复挂两次
    var now = Date.now();
    if (now - lastBadgeClick < 250) return;
    lastBadgeClick = now;

    if (!panelOpen()) openPanel();
  }

  try {
    // 捕获阶段(true):确保在 dialog.js 的冒泡监听之前拿到点击
    document.addEventListener('click', onDocClickCapture, true);
  } catch (e) {
    console.warn('[DYB] 绑定标记点击失败,调试面板需手动打开', e);
  }

  /* ==========================================================
   * 九、对外接口(挂到隔离世界的 window,同组脚本可见)
   * ========================================================== */

  // clear-stock.js 里有约 20 处裸调用 debugLog(...);
  // locate.js 里用 typeof isDebugMode === 'function' 做门禁。
  // 两者都在同组的隔离世界里,挂上即可,不必改它们的调用点。
  window.isDebugMode = isDebugMode;
  window.debugLog = debugLog;

  // 面板开关给同组脚本 / 控制台留口子(2026-10-18 起面板是懒挂载的,
  // 调试时需要不点标记也能打开)。
  window.dybDebugPanel = {
    open: openPanel,
    close: closePanel,
    isOpen: panelOpen
  };

  /* ==========================================================
   * 十、响应弹窗的「复制诊断报告」请求(2026-10-16)
   *
   * 弹窗里那枚「复制诊断报告」是**遥控入口** —— 它不自己采集:
   * 弹窗侧按需注入脚本采到的只是「此刻」的静态快照,拿不到页面里
   * 累积的操作轨迹。这里收到请求后由**页面侧**跑一遍 report(),
   * 轨迹一条不少 —— 等于页面左下角那枚按钮,只是多了个弹窗入口。
   *
   * 监听**无条件注册**:本页没开调试态时也收得到,好回一句人话,
   * 而不是让弹窗收到「接收端不存在」的英文报错。
   *
   * ⚠️ sendResponse 是异步的(要等 report() 读 storage),所以监听器
   *    必须 return true 保持通道,否则消息端口会被提前关掉。
   * ========================================================== */

  try {
    chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
      if (!msg || msg.type !== 'dyc:requestReport') return;

      var d = window.__dycDiag;
      if (!d || typeof d.report !== 'function') {
        sendResponse({ ok: false, error: '本页诊断内核未就绪，请刷新页面后重试' });
        return;
      }

      // 本页没进调试态 ⇒ 面板没挂、也没人调 debugLog,轨迹必然是空的。
      // 按用户 2026-10-16 定下的口径**不做降级**,让用户先去把开关拨开。
      if (!isDebugMode()) {
        sendResponse({ ok: false, error: '本页未处于调试态：请先在弹窗里打开调试模式，再点复制' });
        return;
      }

      try {
        buildReport(d).then(function (text) {
          sendResponse({ ok: true, text: text });
        }, function () {
          sendResponse({ ok: false, error: '诊断报告生成失败' });
        });
      } catch (e) {
        sendResponse({ ok: false, error: '诊断报告生成失败' });
      }

      return true;   // 异步回话:保持消息通道打开
    });
  } catch (e) {
    console.warn('[DYB] 注册诊断报告请求监听失败', e);
  }
})();
