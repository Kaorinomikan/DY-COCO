/**
 * 浮层让位 · 共享判定层（2026-11-01，反馈 #126 / #127）
 * ============================================================
 * 用户原话（2026-10-31）：
 *   「福袋页面，两个窗口都浮在上面」/「这个页面也会浮出来按钮」
 *   「不只是这个框会不自动隐藏浮动框按钮，这些框框都不自动隐藏」
 *
 * 问题：中控台的浮动控件（上滑到顶 / 下滑到底 / 搜索圆钮 / 搜索胶囊 /
 *   刷新指示灯 / 循环讲解胶囊）z-index 高达 2147483000，压过平台遮罩。
 *   平台一开弹窗（#126 管理超级福袋活动、#127 发优惠券），控件仍浮在上面；
 *   下拉面板（「直播工具」那种小面板）同样被压 —— 用户明确要求「都让位」。
 *
 * 为什么不能各自写一份：改动前同一套判据在 auto-refresh.js 与
 *   auto-loop-lecture.js 里各有一份（选择器、面积门槛、缓存各写一遍），
 *   三处浮动控件完全没有。结果就是「有一处改了、另一处忘了」
 *   （2026-10-27 就发生过：胶囊漏认抽屉，圆钮藏了胶囊没藏）。
 *   本模块把这些判据收敛成**唯一真源**：别处只调用，不再自己扫页面。
 *
 * 判定口径（与旧版的两处差异，都是有意的）：
 *   ① **不再用「浮层面积 ≥ 视口 12%」当挡道门槛** —— 那是「有没有盖住我」的
 *      粗糙代理，代价是「直播工具」这类中等尺寸下拉面板一律不算挡道。
 *      现在直接量**交集**：浮层与控件重叠的面积 ≥ 控件面积的 35% 才让位。
 *      旧门槛想排除的「右上角智能推荐小卡片」（140×140）本来就不与控件相交，
 *      换成交集判定后依然不会误伤 —— 而且更准。
 *   ② **选择器补上「面板」这一档** —— 除了 auxo 的 modal / drawer，
 *      还认 role=menu / listbox 与类名含 dropdown / popover / popup 的浮层。
 *      平台用的是 CSS Modules 哈希类名，认词根比认全名耐改版。
 *
 * 边界（不要越推越远）：
 *   · 只判「谁压在谁上面」，**不改任何布局、不动点击行为**；
 *   · 只管**插件自己的浮动控件**，不动平台节点（不隐藏、不改样式）；
 *   · 让位形态固定为**整枚消失**（visibility:hidden），不做「缩小成圆点」——
 *     用户 2026-11-01 认可的处置就是「自动隐藏」；
 *   · 平台 tooltip（`.auxo-tooltip`，鼠标停在任何按钮上都会飘）**不算浮层**，
 *     否则正常浏览页面时控件会一直闪没。
 *
 * 开关：**无**（2026-11-02 起）。原 `overlayYield` 开关已撤下 ——
 *   用户原话「删掉这个菜单可选项，这个功能不做选择，已经写入各个浮动按钮的
 *   底层且默认执行了」。让位行为恒生效，模块内不再有可关的开关状态。
 * ============================================================
 */
(function () {
  'use strict';

  if (typeof window === 'undefined') return;
  if (window.dycOverlayGuard) return;   // 重复注入（同一页两份脚本）时只认第一份

  /* ---------- 可调参数 ---------- */

  /** 浮层矩形缓存：主循环 250ms 一拍，不能每拍都扫一遍选择器 */
  var CACHE_MS = 400;
  /** 共享心跳：所有已绑定的控件共用这一个定时器，不是每个控件一条 */
  var PUMP_MS = 250;
  /** 浮层与控件的重叠面积达控件面积的这个比例，才认定「真把我盖住了」 */
  var COVER_RATIO = 0.35;
  /** 浮层单边小于这个像素数的不算（角标 / 分隔条 / 小尖角） */
  var MIN_SIDE = 8;
  /** 浮层总面积下限：再小的是角标、气泡尾巴、1px 描边层（576 = 24 × 24） */
  var MIN_AREA = 576;

  /* ---------- 浮层候选选择器 ----------
   * 分两档，因为「认错了」的代价不对称：
   *   STRONG  —— 平台设计体系的类名 + ARIA 语义，命中即是浮层
   *              （position 只要求「浮起来」或 z-index 非 auto 二者之一）；
   *   WEAK    —— 只凭类名词根认（CSS Modules 的 `xxx_dropdown__hash` 靠这一档抓），
   *              必须**同时**满足 fixed/absolute 且 z-index ≥ 1。
   *              为什么从严：中控台若有个整页容器类名里带 modal / panel，
   *              弱判定会把它当成「浮层永远盖住所有控件」⇒ 控件永久消失。
   * 刻意**不含** tooltip：那是悬停常态，拿它当判据会让控件一直闪。
   */
  var PANEL_SEL_STRONG = [
    '.auxo-modal-root', '.auxo-modal-wrap', '.auxo-drawer',
    '.auxo-dropdown', '.auxo-popover', '.auxo-select-dropdown',
    '[role="dialog"]', '[role="menu"]', '[role="listbox"]'
  ];
  var PANEL_SEL_WEAK = [
    '[class*="dropdown"]', '[class*="popover"]', '[class*="popup"]',
    '[class*="modal"]', '[class*="drawer"]', '[class*="panel-"]',
    '[class*="-panel"]'
  ];

  /* ---------- 模块状态 ---------- */

  var boundEls = [];
  var rectCache = null;
  var rectAt = 0;
  var pumpTimer = null;
  /* 没有开关状态(2026-11-02 撤掉 overlayYield 开关后):让位恒生效,
   * 见 flags.js 同名注释。老存档里的 overlayYield 键从此无人读取。 */
  var seenToken = 0;

  /** 取元素类名（兼容 SVG 的 SVGAnimatedString） */
  function classStr(el) {
    if (!el) return '';
    var c = el.className;
    if (c && typeof c === 'object' && typeof c.baseVal === 'string') return c.baseVal;
    return String(c || '');
  }

  /** 是不是我们自己注入的节点（dyc- / dyb- 前缀）—— 自己的弹窗、消息盒子、圆钮都不算浮层 */
  function isOurNode(el) {
    if (!el) return true;
    var id = el.id ? String(el.id) : '';
    if (/^(dyc|dyb)[-_]/.test(id)) return true;
    return /(^|[\s])(dyc|dyb)[-_]/.test(classStr(el));
  }

  /**
   * 这个节点算不算「平台浮起来的层」。
   *
   * 两条硬性排除：
   *   · display:none / visibility:hidden / opacity≈0 —— 看不见的层不挡任何东西；
   *   · 既不是 fixed/absolute、z-index 又是 auto —— 页面正文里的普通块
   *     （表格单元格、静态容器）即使类名带 dropdown 也不该让控件让位。
   * 弱选择器（只凭类名词根）额外要求「fixed/absolute **且** z-index ≥ 1」，
   * 免得一个整页容器的类名里带 modal，把控件永久藏掉。
   */
  function isPanel(el, strict) {
    if (!el || el.nodeType !== 1) return false;
    if (isOurNode(el)) return false;
    var cs = null;
    try { cs = window.getComputedStyle ? window.getComputedStyle(el) : null; } catch (e) { return false; }
    if (!cs) return false;
    if (cs.display === 'none' || cs.visibility === 'hidden') return false;
    if (parseFloat(cs.opacity || '1') < 0.05) return false;
    var pos = cs.position;
    var z = parseInt(cs.zIndex, 10);
    var floating = (pos === 'fixed' || pos === 'absolute');
    if (strict) return floating && z >= 1;
    if (floating) return true;
    return z > 0;
  }

  /** 读一段矩形，并裁进视口 —— 控件是 fixed + 视口坐标，比较必须在同一坐标系里 */
  function clipRect(el) {
    var r;
    try { r = el.getBoundingClientRect(); } catch (e) { return null; }
    if (!r || !(r.width > 0) || !(r.height > 0)) return null;
    var vw = window.innerWidth || document.documentElement.clientWidth || 1600;
    var vh = window.innerHeight || document.documentElement.clientHeight || 900;
    var left = r.left > 0 ? r.left : 0;
    var top = r.top > 0 ? r.top : 0;
    var right = r.right < vw ? r.right : vw;
    var bottom = r.bottom < vh ? r.bottom : vh;
    if (right - left < MIN_SIDE || bottom - top < MIN_SIDE) return null;
    if ((right - left) * (bottom - top) < MIN_AREA) return null;
    return { left: left, top: top, right: right, bottom: bottom };
  }

  /** 真扫一遍：把当前所有「平台浮起来的层」量成矩形数组（不缓存） */
  function collectPanels() {
    var out = [];
    if (!document.querySelectorAll) return out;
    var token = ++seenToken;
    scan(PANEL_SEL_STRONG, false, token, out);
    scan(PANEL_SEL_WEAK, true, token, out);
    return out;
  }

  /** 扫一组选择器并把通过的窗口量成矩形 */
  function scan(sels, strict, token, out) {
    for (var i = 0; i < sels.length; i++) {
      var els;
      try { els = document.querySelectorAll(sels[i]); } catch (e) { continue; }
      for (var k = 0; k < els.length; k++) {
        var el = els[k];
        if (el.__dycOvSeen === token) continue;   // 同一节点被多个选择器命中时只算一次
        el.__dycOvSeen = token;
        if (!isPanel(el, strict)) continue;
        var r = clipRect(el);
        if (r) out.push(r);
      }
    }
  }

  /** 带缓存的浮层矩形（400ms 内复用；控件显隐共用这一份） */
  function panelRects() {
    var t = Date.now();
    if (rectCache && (t - rectAt) < CACHE_MS) return rectCache;
    rectAt = t;
    rectCache = collectPanels();
    return rectCache;
  }

  /** 立刻作废缓存（浮层刚开 / 刚关时别拿旧矩形判断） */
  function invalidate() {
    rectCache = null;
    rectAt = 0;
  }

  /**
   * 这块区域有没有被平台浮层**真的盖住**。
   *
   * @param {{left:number,top:number,right:number,bottom:number,width?:number,height?:number}} rect
   *        视口坐标下的矩形（getBoundingClientRect 的返回值可直接传）
   * @param {number} [ratio] 重叠比例门槛，缺省 COVER_RATIO(0.35)
   * @return {boolean} true = 该让位
   */
  function covers(rect, ratio) {
    if (!rect) return false;
    var w0 = rect.width != null ? rect.width : (rect.right - rect.left);
    var h0 = rect.height != null ? rect.height : (rect.bottom - rect.top);
    if (!(w0 > 0) || !(h0 > 0)) return false;
    var list = panelRects();
    if (!list.length) return false;
    var need = w0 * h0 * (typeof ratio === 'number' ? ratio : COVER_RATIO);
    for (var i = 0; i < list.length; i++) {
      var o = list[i];
      var w = (rect.right < o.right ? rect.right : o.right) - (rect.left > o.left ? rect.left : o.left);
      if (w <= 0) continue;
      var h = (rect.bottom < o.bottom ? rect.bottom : o.bottom) - (rect.top > o.top ? rect.top : o.top);
      if (h <= 0) continue;
      if (w * h >= need) return true;
    }
    return false;
  }

  /* ==========================================================
   * 自动显隐（给「只管自己显隐、没有弹层判据」的三处控件用）
   * ----------------------------------------------------------
   * 手段选 visibility 而不是 display：三处控件各自的 show / hide 都靠
   * `style.display` 做状态机（搜索圆钮还有淡入淡出定时器）。外层再插一只手
   * 改 display，等于两套状态机抢同一个属性，谁后写谁赢 —— 一定会打架。
   * visibility 是**叠加**的：模块照旧管 display，本模块只在这上面盖一层
   * 「现在别看」，浮层关掉再把这层揭掉，互不覆盖。
   * ========================================================== */

  /** 让一枚控件进入 / 退出让位态 */
  function applyOne(el) {
    if (!el) return;
    var cs = null;
    try { cs = window.getComputedStyle ? window.getComputedStyle(el) : null; } catch (e) { cs = null; }
    // 模块自己把它藏了（display:none）⇒ 不动它的 visibility，省得「揭开」时把
    // 模块刚设好的显隐状态搅乱；等它重新出现，下一拍自然会重判。
    if (cs && cs.display === 'none') return;
    var r;
    try { r = el.getBoundingClientRect(); } catch (e) { return; }
    var hide = covers(r);
    if (hide) {
      if (el.__dycGuardHidden) return;
      el.__dycGuardHidden = true;
      el.__dycGuardPrevVis = el.style.visibility;
      el.style.visibility = 'hidden';
      return;
    }
    if (!el.__dycGuardHidden) return;
    el.__dycGuardHidden = false;
    el.style.visibility = el.__dycGuardPrevVis || '';
    el.__dycGuardPrevVis = '';
  }

  /** 心跳一拍：把所有已绑定控件重判一次 */
  function tick() {
    if (!boundEls.length) { stopPump(); return; }
    if (typeof document !== 'undefined' && document.hidden) return;   // 后台标签页不烧 CPU
    for (var i = 0; i < boundEls.length; i++) applyOne(boundEls[i]);
  }

  function stopPump() {
    if (!pumpTimer) return;
    clearInterval(pumpTimer);
    pumpTimer = null;
  }

  function startPump() {
    if (pumpTimer) return;
    pumpTimer = setInterval(tick, PUMP_MS);
  }

  /** 把一枚浮动控件交给本模块托管（同一节点重复调用无副作用） */
  function bind(el) {
    if (!el || el.nodeType !== 1) return;
    for (var i = 0; i < boundEls.length; i++) if (boundEls[i] === el) return;
    boundEls.push(el);
    el.__dycGuardBound = true;
    startPump();
    applyOne(el);
  }

  /** 解除托管并立刻还原（模块自己把控件摘掉时调用，避免留下 hidden 残留） */
  function unbind(el) {
    for (var i = 0; i < boundEls.length; i++) {
      if (boundEls[i] !== el) continue;
      boundEls.splice(i, 1);
      break;
    }
    if (!el) return;
    if (el.__dycGuardHidden) {
      el.__dycGuardHidden = false;
      el.style.visibility = el.__dycGuardPrevVis || '';
      el.__dycGuardPrevVis = '';
    }
    el.__dycGuardBound = false;
    if (!boundEls.length) stopPump();
  }

  /** 排查用：当前认到的浮层矩形（写进控制台或诊断备注，不弹 UI） */
  function dump() {
    var list = collectPanels();
    var parts = [];
    for (var i = 0; i < list.length; i++) {
      var r = list[i];
      parts.push(Math.round(r.left) + ',' + Math.round(r.top) + ',' +
        Math.round(r.right) + ',' + Math.round(r.bottom));
    }
    return parts.length ? parts.join(' | ') : '(none)';
  }

  window.dycOverlayGuard = {
    covers: covers,
    bind: bind,
    unbind: unbind,
    invalidate: invalidate,
    rects: panelRects,
    dump: dump
  };
})();
