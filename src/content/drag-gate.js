/**
 * 拖拽闸门 · 公共判定（2026-11-05 · 反馈 #130）
 * ============================================================
 * 【解决什么问题】
 *
 *   直播中控台「购物车」的列表由 react-beautiful-dnd（下称 rbd）接管：
 *   每个商品行带 `data-rbd-draggable-id`，行首把手带
 *   `data-rbd-drag-handle-draggable-id`。用户按住把手调整讲解顺序时，
 *   rbd 会在每一帧里插入/移动拖动克隆与占位节点 —— 这些都是 childList
 *   变动，会唤醒页面上**所有** observe(document.body, subtree) 的模块。
 *
 *   而我们的补涂里有多处强制同步布局（每行读 clientWidth / scrollWidth /
 *   getBoundingClientRect），还有「发现按钮不在就 insertBefore」的补注入。
 *   于是拖拽期间变成：每帧变动 → 每帧全量重扫 + 全行量测 → 掉帧；
 *   更糟的是重扫时的 insertBefore 改写了 Draggable 内部结构，rbd 判定
 *   结构与尺寸不一致即中止本次拖拽（用户表现为「一拖就弹回」）。
 *
 * 【本模块做什么】
 *
 *   只做一件事：给出「现在是不是正在拖拽」这个判据，并提供「等空闲再补
 *   一轮」的挂起点。各注入类模块在补涂入口问一句，拖拽期间直接让路，
 *   松手（外加 400ms 冷却，等 rbd 落点动画结束）后统一补扫一次。
 *
 * 【开销】
 *
 *   零常驻：不挂 MutationObserver、不轮询。只在 pointerdown 落到拖动把手 /
 *   可拖行上时临时挂一组 window 监听，pointerup 后立刻摘掉。
 *
 * 【判据为什么是 rbd 属性】
 *
 *   rbd 会把这两个属性写到 DOM 上（不是 class 哈希，改版不易变），且
 *   无论「整行可拖」还是「只有把手可拖」都会命中 —— 只认属性即可覆盖。
 *   万一平台换掉拖拽库导致属性消失：闸门不生效，行为回到本模块之前
 *   （不会比现在更差），不会误伤正常操作。
 *
 * 【对外接口】
 *
 *   window.__dycDragBusy()          → boolean，现在是否处于拖拽期（含冷却）
 *   window.__dycWhenDragIdle(fn)    → 空闲则立刻执行；拖拽中则登记，松手后执行
 *                                     （同一个 fn 只登记一次，防拖拽期堆叠）
 */
(function () {
  'use strict';

  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  if (typeof window.__dycDragBusy === 'function') return;   // 幂等：只装一次

  var HANDLE_SEL = '[data-rbd-drag-handle-draggable-id]';
  var ROW_SEL = '[data-rbd-draggable-id]';
  /* 落在我们自己的控件上时不进拖拽态：货号按钮就在商品行内，点它不该让
   * 全站补涂停 400ms（点完还要立刻能刷新）。 */
  var OWN_SEL = '.dyc-code-btn,#dyc-toolbar,#dyc-omni-shell,#dyc-search-fab,' +
                '#dyc-search-pill,.dyb-status,#dyb-bag-badge,#dyb-bag-panel';

  var COOLDOWN = 400;    // 松手后的冷却：等 rbd 落点动画与随后的重渲染结束
  var DRAG_MOVE = 5;     // 整行可拖时的位移阈值（px）：超过才算拖，点击不算
  var MAX_HOLD = 60000;  // 兜底：60 秒还没收到 pointerup 就强制复位（防丢事件卡死）

  var active = false;
  var releasedAt = 0;
  var holdTimer = null;
  var flushTimer = null;
  var idleJobs = [];
  var downPoint = null;
  var watching = false;

  function busy() {
    if (active) return true;
    return releasedAt > 0 && (Date.now() - releasedAt) < COOLDOWN;
  }

  function activate() {
    if (active) return;
    active = true;
    releasedAt = 0;
    if (holdTimer) clearTimeout(holdTimer);
    holdTimer = setTimeout(function () {
      holdTimer = null;
      release();            // 丢事件兜底：宁可多补扫一次，不能永远卡在「拖拽中」
    }, MAX_HOLD);
  }

  function release() {
    if (!active) return;
    active = false;
    releasedAt = Date.now();
    downPoint = null;
    if (holdTimer) { clearTimeout(holdTimer); holdTimer = null; }
    armFlush();
  }

  function armFlush() {
    if (flushTimer || active) return;
    var wait = Math.max(0, COOLDOWN - (Date.now() - releasedAt)) + 16;
    flushTimer = setTimeout(function () {
      flushTimer = null;
      if (busy()) { armFlush(); return; }     // 冷却期里又被按下：继续等
      var jobs = idleJobs;
      idleJobs = [];
      for (var i = 0; i < jobs.length; i++) {
        try { jobs[i](); } catch (e) { /* 单个模块失败不影响其余 */ }
      }
    }, wait);
  }

  function whenIdle(fn) {
    if (typeof fn !== 'function') return;
    if (!busy()) {
      try { fn(); } catch (e) { /* 调用方的异常不该冒泡到这里 */ }
      return;
    }
    if (idleJobs.indexOf(fn) === -1) idleJobs.push(fn);   // 去重：拖拽期每帧都会问
    armFlush();
  }

  function onPointerMove(e) {
    if (active || !downPoint) return;
    var dx = (e.clientX || 0) - downPoint.x;
    var dy = (e.clientY || 0) - downPoint.y;
    if (dx * dx + dy * dy >= DRAG_MOVE * DRAG_MOVE) activate();
  }

  function onPointerUp() {
    release();
    unwatch();
  }

  function onPointerDown(e) {
    if (!e || e.isTrusted === false) return;      // 程序化事件（含我们自己的模拟点击）不算
    var t = e.target;
    if (!t || typeof t.closest !== 'function') return;
    try { if (OWN_SEL && t.closest(OWN_SEL)) return; } catch (e0) { /* 选择器不支持就继续 */ }

    watch();                                     // 先挂监听，保证能收到 up

    var onHandle = false;
    try { onHandle = !!t.closest(HANDLE_SEL); } catch (e1) { onHandle = false; }
    if (onHandle) { activate(); return; }        // 抓住把手：不用等位移，这就是要拖

    var onRow = false;
    try { onRow = !!t.closest(ROW_SEL); } catch (e2) { onRow = false; }
    if (onRow) {
      downPoint = { x: e.clientX || 0, y: e.clientY || 0 };   // 整行可拖：移动超阈值才算
    }
  }

  function watch() {
    if (watching) return;
    watching = true;
    try {
      window.addEventListener('pointermove', onPointerMove, { capture: true, passive: true });
      window.addEventListener('pointerup', onPointerUp, true);
      window.addEventListener('pointercancel', onPointerUp, true);
      window.addEventListener('dragend', onPointerUp, true);
      window.addEventListener('blur', onPointerUp, true);
    } catch (e) { watching = false; }
  }

  function unwatch() {
    if (!watching) return;
    watching = false;
    try {
      window.removeEventListener('pointermove', onPointerMove, true);
      window.removeEventListener('pointerup', onPointerUp, true);
      window.removeEventListener('pointercancel', onPointerUp, true);
      window.removeEventListener('dragend', onPointerUp, true);
      window.removeEventListener('blur', onPointerUp, true);
    } catch (e) { /* 摘不掉最多多挂一次，不影响正确性 */ }
  }

  try {
    document.addEventListener('pointerdown', onPointerDown, true);
  } catch (e) { /* 极老内核没有 pointer 事件：闸门不生效，行为与改动前一致 */ }

  window.__dycDragBusy = busy;
  window.__dycWhenDragIdle = whenIdle;
})();
