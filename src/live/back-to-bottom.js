/**
 * 中控台下滑到底 · 右下角浮动圆钮
 * ============================================================
 * 需求(用户 2026-10-13 提出):
 *   在「上滑到顶」按钮正下方，放一个设计逻辑完全相同的「下滑到底」按钮；
 *   点击后，页面与商品列表一起平滑滚到底部。
 *
 * 实现要点(继承 back-to-top 全部约定):
 *   1. 自含样式(脚本自己注入 <style>)，不碰共享 CSS 文件
 *   2. 开关:backToBottom(默认开)，dycReadFlags/dycWatchFlags 即时生效
 *   3. 显隐:与回到顶部**相反**——已滚到底部时隐藏，否则显示
 *      （判定口径与回顶一致：锚点 .container-e6f75f 底边落在「视口底上方 1H」线之上
 *       = 已滚过页底 = 隐藏；否则显示。兜底链与回顶兜底链一致）
 *   4. 点击:把所有可滚容器的 scrollTop 设为 max(滚动高度 - 可视高度)，
 *      同时 smooth 滚动；找不到锚点走导航头兜底 → 全部滚到底
 *   5. 位置:仍与返回顶部按钮**同一纵轴**、上下相邻（间隙 8px），
 *      水平定位逻辑与返回顶部完全一致。
 *      2026-10-13 用户报「指向下滑到底时,黑色提示挡住了上面的回顶按钮」——
 *      气泡从「按钮上方」改到「按钮**下方**」(箭头反向朝上指向按钮),
 *      同时把这一对按钮整体上移 32px 给气泡让出空间:
 *        下滑到底 bottom 24 → 56px,回顶 84.8 → 116.8px(= 56 + 52.8 + 8),
 *      两按钮间隙不变,纵向观感仍贴右下角。
 *   6. 2026-10-14 用户定(与 back-to-top 同口径):
 *      到底**只允许作用于「页面滚动链」** —— 所有包含页顶锚点、或包含
 *      商品列表容器(全页 scrollHeight 最大的可滚容器)的可滚容器,
 *      再加 window。链外的滚动容器(左边直播互动栏的评论列表、侧栏
 *      菜单等)一律不碰。旧版遍历「全部可滚容器」逐个滚到底,互动栏
 *      评论因此被一起带到底部。
 *   7. 2026-10-21 用户报「点击时按钮动效卡,还没开播」(与 back-to-top
 *      同步修,两案一起上,口径与那边完全一致):
 *      ① 「页面滚动链」缓存化 —— 点击原先每次全页扫描(万级节点+逐元素
 *         布局读),点击当帧被同步阻塞,按钮动效当场冻结,与开播无关;
 *         改为点击读缓存,失效自愈(容器脱链/锚点变更才重扫);
 *      ② 滚动进行期间环动画暂停(300ms 无 scroll 事件即恢复,3s 兜底),
 *         变速绕圈节奏与环外观零改动。
 * ============================================================
 */

(function dycBackToBottom() {
  'use strict';

  if (window.__dycBackBottomLoaded) return;
  window.__dycBackBottomLoaded = true;

  var SHOW_AFTER = 300;
  var BTN_SIZE = 52.8;
  var SCROLL_EVENT_OPTS = { capture: true, passive: true };

  /* 2026-10-13:固定right位置,与back-to-top保持在同一纵轴 */
  var RIGHT_GAP = 20;

  /* ---------- 样式(自含,类名加 dyc- 前缀防撞) ---------- */
  function injectStyle() {
    if (document.getElementById('dyc-back-bottom-style')) return;
    var st = document.createElement('style');
    st.id = 'dyc-back-bottom-style';
    st.textContent = [
      /* 2026-10-13 用户定:全程半透明0.55显示;与上滑到顶按钮保持在同一纵轴。
         2026-10-13 用户报气泡挡住回顶按钮 → 气泡改到按钮下方,本按钮
         整体上移 32px(bottom 24→56px),给下方气泡留出显示高度 */
      '.dyc-back-bottom {',
      '  position: fixed; right: 20px; bottom: 56px;',
      '  width: 52.8px; height: 52.8px; border-radius: 50%;',
      '  background: #ffffff; border: 1px solid rgba(0,0,0,.15);',
      '  box-shadow: 0 2px 8px rgba(0,0,0,.18);',
      '  display: flex; align-items: center; justify-content: center;',
      '  cursor: pointer; z-index: 2147483000;',
      '  opacity: .55; visibility: visible; transform: none;',
      '  transition: opacity .2s ease-out, transform .2s ease-out, visibility .2s;',
      '  padding: 0; outline: none;',
      '}',
      /* 全程半透明0.55,鼠标指向取消透明 */
      '.dyc-back-bottom:hover { opacity: 1; background: #f5f6f7; }',
      '.dyc-back-bottom:active { background: #ecedee; }',
      '.dyc-back-bottom svg { display: block; }',
      /* 细线环:平时不显示,指向按钮时出现并绕圈 */
      '.dyc-back-bottom .dyc-btt-ring { opacity: 0; transition: opacity .2s ease; }',
      '.dyc-back-bottom:hover .dyc-btt-ring {',
      '  opacity: 1;',
      '  animation: dyc-btt-ring 2.6s linear infinite;',
      '}',
      /* 变速绕圈:pathLength=100 归一化。
         0→36% 前半圈(12点→6点,经9点)快,线性;
         36%→86% 后半圈(6点→12点,经3点)由快到慢;
         86%→100% 停在12点,然后进入下一圈 */
      '@keyframes dyc-btt-ring {',
      '  0%   { stroke-dashoffset: 0;   animation-timing-function: linear; }',
      '  36%  { stroke-dashoffset: 50;  animation-timing-function: cubic-bezier(.35,.45,.25,1); }',
      '  86%  { stroke-dashoffset: 100; animation-timing-function: linear; }',
      '  100% { stroke-dashoffset: 100; }',
      '}',
      /* 悬停气泡(配色/字号/内边距与搜索按钮 .dyc-tip 同款):
         黑底小箭头气泡,文案「下滑到底」。
         2026-10-13 用户定:气泡挂在**按钮下方**(箭头朝上指向按钮)——
         本按钮处在这一对按钮的最下沿,气泡朝上会盖住上面的「上滑到顶」,
         朝下则只占页面空白区,不遮任何控件 */
      '.dyc-back-bottom .dyc-tip {',
      '  position: absolute; top: calc(100% + 10px); left: 50%;',
      '  transform: translateX(-50%);',
      '  background: rgba(20,20,20,.92); color: #ffffff;',
      '  font-size: 12.5px; padding: 6px 10px; border-radius: 6px;',
      '  white-space: nowrap; opacity: 0; pointer-events: none;',
      '  transition: opacity .15s ease;',
      '}',
      /* 小三角:贴在气泡**顶边**(朝上指向按钮) */
      '.dyc-back-bottom .dyc-tip::after {',
      '  content: ""; position: absolute; bottom: 100%; left: 50%; margin-left: -4px;',
      '  border: 4px solid transparent; border-bottom-color: rgba(20,20,20,.92);',
      '}',
      '.dyc-back-bottom:hover .dyc-tip { opacity: 1; }',
      /* 滚动期间暂停环动画(2026-10-21,方案二,与 back-to-top 同款):
         smooth 滚动是主线程行为,环的 stroke 动画也是主线程重绘,
         两者叠加时环动画掉帧 —— 发起滚动后挂 .dyc-rolling 把环冻住,
         滚动停止即摘除;写在 animation 简写规则之后,层叠胜出。
         变速绕圈节奏与环外观零改动,只是滚动那几秒先冻住 */
      '.dyc-back-bottom.dyc-rolling .dyc-btt-ring { animation-play-state: paused; }'
    ].join('\n');
    (document.head || document.documentElement).appendChild(st);
  }

  /* 按钮 SVG = 细线环 + 纯 SVG 下箭头(与回顶箭头方向相反) */
  var BUTTON_SVG =
    '<svg width="48" height="48" viewBox="0 0 44 44" aria-hidden="true">' +
    '<circle class="dyc-btt-ring" cx="22" cy="22" r="20.5" pathLength="100" ' +
    'fill="none" stroke="rgba(51,51,51,.8)" stroke-width="1.5" ' +
    'stroke-linecap="round" stroke-dasharray="25 75" stroke-dashoffset="0" ' +
    'transform="rotate(-90 22 22)"/>' +
    // 向下箭头(与回顶的向上箭头相反)
    '<g transform="translate(12 12)">' +
    '<path d="M10 8V19M10 19l-5.5-5.5M10 19l5.5-5.5" stroke="#333" ' +
    'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" ' +
    'fill="none"/></g>' +
    '</svg>';

  /* ---------- 滚动容器收集(与回顶同套实现) ---------- */
  function collectScrollables() {
    var out = [];
    var all = document.querySelectorAll('*');
    for (var i = 0; i < all.length; i++) {
      var el = all[i];
      if (el.closest && el.closest('.dyc-back-bottom')) continue;
      if (el.scrollHeight > el.clientHeight + 1) out.push(el);
    }
    return out;
  }

  /* ---------- 页面滚动链(2026-10-14 用户定,与回顶完全同口径) ----------
   * 到底只允许作用于「页面滚动链」,链外的滚动容器一律不碰 ——
   * 左边直播互动栏的评论列表、侧栏菜单等都自成一体的滚动区,
   * 用户明确要求「无论上滑到顶还是下滑到底,都禁止影响它们的滚动状态」。
   *
   * 两个结构参照物(不用 class,平台改版换哈希也照样成立):
   *   ① 页顶锚点 .container-e6f75f
   *   ② 全页 scrollHeight 最大的可滚容器(实测恒为商品列表容器,
   *      内容高约 31752px;互动栏评论列表、侧栏菜单都远矮于它)
   * 页面链 = 所有**包含任一参照物**的可滚容器。中控台的外层页面容器
   * 与内层商品容器必在链上;左边直播互动栏的评论列表两者都不含,
   * 自然被排除。 */

  /* 页顶锚点(与回顶同一枚) */
  var TOP_ANCHOR_SELECTOR = '.container-e6f75f';

  function findTopAnchor() {
    return document.querySelector(TOP_ANCHOR_SELECTOR);
  }

  /** 页面链参照物:页顶锚点 + 全页最高的可滚容器(去重) */
  function chainRefs(all) {
    var refs = [];
    var anchor = findTopAnchor();
    if (anchor) refs.push(anchor);
    var best = null, bestH = 0;
    for (var i = 0; i < all.length; i++) {
      var el = all[i];
      if (el === document.documentElement || el === document.body) continue;
      if (el.scrollHeight > bestH) { bestH = el.scrollHeight; best = el; }
    }
    if (best && refs.indexOf(best) < 0) refs.push(best);
    return refs;
  }

  /** 页面滚动链:所有包含任一参照物的可滚容器(不含 html/body,页面级交 window) */
  function collectPageChain() {
    var all = collectScrollables();
    var refs = chainRefs(all);
    if (!refs.length) return [];
    var out = [];
    for (var i = 0; i < all.length; i++) {
      var el = all[i];
      if (el === document.documentElement || el === document.body) continue;
      for (var r = 0; r < refs.length; r++) {
        var has = false;
        try { has = el === refs[r] || el.contains(refs[r]); } catch (e) { has = false; }
        if (has) { out.push(el); break; }
      }
    }
    return out;
  }

  /* ---------- 页面滚动链缓存(2026-10-21 修「点击时按钮动效卡」) ----------
   * 与 back-to-top.js 同一套口径(判据逐条一致,两边自含不共享):
   * 点击原先每次调 collectPageChain() —— 全页通配扫描 + 逐元素布局读
   * (万级节点),恰在用户盯着按钮动效的点击当帧同步执行,这一帧被
   * 阻塞几百毫秒,按钮动效当场冻结。链内容稳定(恒 1~3 个) → 缓存;
   * 点击时校验,失效才现场重扫一次:
   *   ① 任一容器脱离文档 / 不再可滚 → 失效
   *   ② 页顶锚点与收集时不一致(同一元素引用才算) → 失效
   *   ③ 锚点存在但已不被链上任何容器包含 → 失效
   * 本文件无 resize 校准时机,其余变化全靠点击时校验兜住。 */

  var chainCache = null;

  function chainValid(cache) {
    if (!cache || !cache.list || !cache.list.length) return false;
    for (var i = 0; i < cache.list.length; i++) {
      var el = cache.list[i];
      if (!el || !el.isConnected) return false;
      if (el.scrollHeight <= el.clientHeight + 1) return false;
    }
    var anchor = findTopAnchor();
    if (anchor !== (cache.anchorEl || null)) return false;
    if (anchor) {
      for (var j = 0; j < cache.list.length; j++) {
        var c = cache.list[j];
        if (c === anchor) return true;
        try { if (c.contains(anchor)) return true; } catch (e) { /* 试下一个 */ }
      }
      return false;
    }
    return true;
  }

  /** 点击路径入口:读缓存,失效才全页重扫(正常情况零扫描、零布局读) */
  function getChain() {
    if (chainValid(chainCache)) return chainCache.list;
    var anchor = findTopAnchor();
    chainCache = { list: collectPageChain(), anchorEl: anchor || null };
    return chainCache.list;
  }

  /* 滚动期间暂停环动画(2026-10-21,方案二,与 back-to-top 同款):
   * 发起滚动前挂 .dyc-rolling;「300ms 无 scroll 事件」判定滚动停止后
   * 摘除,3s 兜底强制恢复。监听用 document 捕获(scroll 不冒泡但进
   * 捕获阶段),passive;每个监听只服务一次点击,结束自摘。 */
  function pauseRingDuringScroll(btn) {
    btn.classList.add('dyc-rolling');
    var last = Date.now();
    var stopTimer = null;
    function done() {
      clearTimeout(fallback);
      if (stopTimer) clearTimeout(stopTimer);
      document.removeEventListener('scroll', onScroll, SCROLL_EVENT_OPTS);
      btn.classList.remove('dyc-rolling');
    }
    function onScroll() {
      last = Date.now();
      if (stopTimer) clearTimeout(stopTimer);
      stopTimer = setTimeout(function () {
        if (Date.now() - last >= 280) done();
      }, 300);
    }
    var fallback = setTimeout(done, 3000);
    document.addEventListener('scroll', onScroll, SCROLL_EVENT_OPTS);
  }

  /* ---------- 按钮行为 ---------- */
  function createButton() {
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'dyc-back-bottom';
    btn.setAttribute('aria-label', '下滑到底');
    btn.innerHTML = BUTTON_SVG +
      '<span class="dyc-tip">下滑到底</span>';

    btn.addEventListener('click', function () {
      /* 2026-10-21:collectPageChain() 换 getChain() —— 读缓存+失效自愈,
       * 点击当帧不再全页扫描(见「页面滚动链缓存」段)。
       * 2026-10-14 用户定:只作用于「页面滚动链」(见 collectPageChain)。
       * 链外的滚动容器 —— 左边直播互动栏的评论列表、侧栏菜单等 ——
       * 一律不碰:它们的滚动状态与「页面到底」无关,不得被改变。 */
      var chain = getChain();

      /* 2026-10-18 用户定「检查一下其他按钮有没有漏设计弹提示」:
       * 与「上滑到顶」同一口径 —— 正常滚动有视觉反馈不必报,
       * 只在**点了看起来没反应**（本来就已经到底）时说一声。
       */
      var sc = document.scrollingElement || document.documentElement;
      var winMax = Math.max(document.body.scrollHeight, sc.scrollHeight) - window.innerHeight;
      var alreadyBottom = window.scrollY >= winMax - 2;
      if (alreadyBottom) {
        for (var c = 0; c < chain.length; c++) {
          var m = chain[c].scrollHeight - chain[c].clientHeight;
          if (m > 2 && chain[c].scrollTop < m - 2) { alreadyBottom = false; break; }
        }
      }
      if (alreadyBottom && typeof toast === 'function') {
        toast('已经在底部', 'info', { source: '下滑到底' });
        return;
      }

      /* 程序化滚动豁免(2026-10-21 修「全能搜索时指示灯一直闪」,圆钮同类):
       * smooth 动画的事件流约半秒,窗口给 800ms。 */
      /* 方案二(2026-10-21):滚动进行期间冻结环动画,别让主线程动画挤帧 */
      pauseRingDuringScroll(btn);
      window.__dycScriptScrollAt = Date.now();
      window.__dycScriptScrollFor = 800;
      for (var i = 0; i < chain.length; i++) {
        var el = chain[i];
        var max = el.scrollHeight - el.clientHeight;
        if (max < 0) max = 0;
        try {
          el.scrollTo({ top: max, left: 0, behavior: 'smooth' });
        } catch (e) {
          el.scrollTop = max;
        }
      }
      try {
        window.scrollTo({
          top: Math.max(document.body.scrollHeight, document.documentElement.scrollHeight),
          left: 0, behavior: 'smooth'
        });
      } catch (e) {
        window.scrollTo(0, Math.max(document.body.scrollHeight, document.documentElement.scrollHeight));
      }
    });

    return btn;
  }

  /* ---------- 主流程 ---------- */

  /**
   * 中控台是否已经「进到页面里」（商品列表真的渲染出行了）。
   *
   * ★ 2026-10-18 修用户报的「还没进网页就常驻显示了」——
   *   与 back-to-top.js / search.js 同一口径，三个浮动控件要么一起出、要么一起不出。
   *   判据落在「读到商品行」，不用「容器/锚点存在」：骨架屏阶段空壳往往已经在 DOM 里。
   */
  function pageReady() {
    /* 直接复用 locate.js 的 hasProductRows()（2026-10-18）——
     * 三个浮动控件问的是同一个问题，判据必须同源，否则会出现
     * 「按钮出来了、搜索却说不就绪」这种自相矛盾的状态。
     * 那边已经按「零布局读 → 一次读 → 真识别」三级台阶做过成本优化。 */
    if (typeof hasProductRows === 'function') {
      try { return hasProductRows(); } catch (e) { /* 退回本地判定 */ }
    }
    try {
      if (typeof getScrollContainer !== 'function') return false;
      if (!getScrollContainer()) return false;
      const items = (typeof getProductItems === 'function') ? (getProductItems() || []) : [];
      return !!(items && items.length);
    } catch (e) { return false; }
  }

  function start() {
    injectStyle();

    var btn = createButton();
    /* ★ 2026-10-18：先藏起来，等列表就绪再露面（原来挂上即常驻，骨架屏阶段就已可见） */
    btn.style.display = 'none';
    (document.body || document.documentElement).appendChild(btn);
    /* 浮层让位(2026-11-01，反馈 #126/#127):平台弹窗 / 抽屉 / 下拉面板盖住这枚钮时
     * 自动隐藏，浮层关掉自动恢复。判据与心跳都在 src/content/overlay-guard.js，
     * 这里只做节点登记;它用 visibility 叠加，与下面的 display 状态机互不覆盖。 */
    if (window.dycOverlayGuard && typeof window.dycOverlayGuard.bind === 'function') {
      window.dycOverlayGuard.bind(btn);
    }

    var listening = false;

    function bind() {
      if (listening) return;
      listening = true;
    }

    function unbind() {
      if (!listening) return;
      listening = false;
    }

    /* 三态（与 back-to-top.js 完全一致，便于两处对照维护）：
     *   开关关 → 摘掉 / 开关开但没就绪 → 挂着 display:none / 就绪 → 正常显示 */
    var wantOn = false;
    var scrollSyncBound = false;
    var readyTimer = null;
    var readyTries = 0;
    var READY_MAX_TRIES = 200;   // × 250ms ≈ 50 秒

    function paint() {
      if (!wantOn) { unbind(); btn.remove(); return; }
      if (!pageReady()) { btn.style.display = 'none'; waitReady(); return; }
      btn.style.display = '';
      if (!btn.isConnected) {
        (document.body || document.documentElement).appendChild(btn);
      }
      bind();
    }

    /** 等列表就绪：就绪那一刻重判一次，然后停（上限 50 秒，之后靠用户滚动重判） */
    function waitReady() {
      if (readyTimer) return;
      readyTries = 0;
      (function tick() {
        readyTimer = null;
        if (!wantOn) return;
        if (pageReady()) { readyTries = 0; paint(); return; }
        if (++readyTries >= READY_MAX_TRIES) { readyTries = 0; return; }
        readyTimer = setTimeout(tick, 250);
      })();
    }

    function stopReady() {
      if (readyTimer) { clearTimeout(readyTimer); readyTimer = null; }
      readyTries = 0;
    }

    function apply(flagOn) {
      wantOn = !!flagOn;
      if (!wantOn) {
        stopReady();
        if (typeof btn.__dycUnbindScrollSync === 'function') btn.__dycUnbindScrollSync();
      }
      paint();
    }

    if (typeof dycReadFlags === 'function') {
      // ★ 2026-10-18:受两层开关约束 —— scrollBtns(总闸) && backToBottom(子开关),
      //   与 back-to-top.js 同一口径(见那边的注释)。
      var prevBackToBottom = null;
      dycReadFlags().then(function (flags) {
        prevBackToBottom = !!flags.backToBottom;
        apply(flags.scrollBtns !== false && prevBackToBottom);
      });
      if (typeof dycWatchFlags === 'function') {
        dycWatchFlags(function (flags) {
          var on = !!flags.backToBottom;
          if (prevBackToBottom !== null && on !== prevBackToBottom && typeof toast === 'function') {
            toast(on ? '已开启' : '已关闭', 'info', { source: '下滑到底' });
          }
          prevBackToBottom = on;
          apply(flags.scrollBtns !== false && on);
        });
      }
    }
    /* flags 不可用时按「默认开」走三态（否则按钮永不出现，比原来更糟） */
    else {
      apply(true);
    }

    /* 滚动时顺手重判：就绪轮询到上限放弃后，这一条能把状态补回来。
     * 监听存进变量以便摘除 —— 「停用必须真停」。 */
    function onScrollSync() {
      if (!wantOn) return;
      var want = pageReady();
      var shown = btn.style.display !== 'none';
      if (want && !shown) paint();
      else if (!want && shown) btn.style.display = 'none';
    }
    if (!scrollSyncBound) {
      scrollSyncBound = true;
      window.addEventListener('scroll', onScrollSync, SCROLL_EVENT_OPTS);
    }
    function unbindScrollSync() {
      if (!scrollSyncBound) return;
      scrollSyncBound = false;
      window.removeEventListener('scroll', onScrollSync, SCROLL_EVENT_OPTS);
    }
    if (btn.__dycUnbindScrollSync) btn.__dycUnbindScrollSync();
    btn.__dycUnbindScrollSync = unbindScrollSync;
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
})();
