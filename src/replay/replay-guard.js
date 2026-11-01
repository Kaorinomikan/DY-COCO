/**
 * 直播回放下载 · 防误点守护（guard）
 * ============================================================
 * 【用户原话】下载回放的时候，正在下载，不小心点到其他网页、或者同网页的
 * 其他分页，要弹出对话框防止误点，不然下载就白费了。
 *
 * 【三种「切走」，只有部分拦得住 —— 这是内核边界，不是偷懒】
 *   ① 关页 / 刷新 / 真跳转（含浏览器后退）→ 页面销毁，下载必死
 *      ⇒ beforeunload 弹系统确认框。⚠️ 文案是内核统一的（「离开此网站？」），
 *        自定义文字新版内核一律忽略 —— 改不了，但弹这一下足够让人停手。
 *   ② 切到同浏览器其他标签页 / 最小化 → 页面还在，下载大概率继续
 *      ⇒ 内核不给网页「切走之前拦截」的能力，谁都做不到；
 *        这里只做标签页标题进度提醒（防「忘了自己在下载」）。
 *   ③ 站内顶栏切换分页（SPA pushState）→ 页面不销毁，但用户实测切完回来
 *      「按钮点不开、不知道有没有在运行」（状态失联，主流程已另修）
 *      ⇒ 下载中在捕获阶段拦顶栏点击，confirm 确认后才放行；
 *        拦不住的路径（键盘快捷键 / 平台绕开事件）由主流程的路由对比
 *        报一句状态兜底。
 *
 * 【为什么用原生 confirm，不自制弹窗】
 *   「先问后切」必须在点击事件里同步给出结论（不确认就 stopPropagation），
 *   自制弹窗是异步的，等用户点「取消」时切换早就发生了。confirm 是唯一
 *   能同步阻塞的问询手段，全内核兼容。
 *
 * 【对外接口】window.__DYC_REPLAY_GUARD__
 *   begin()        下载开始：挂 beforeunload + 顶栏拦截 + 记原标题
 *   progress(pct)  进度（0~100；pct<0 = 未知）：写标签页标题
 *   end()          下载结束（成功 / 失败 / 取消）：全部还原
 */
(function () {
  'use strict';

  if (window.__DYC_REPLAY_GUARD__) return;

  var active = false;
  var origTitle = '';
  var lastPct = -2;         // -2 = 尚未写过；progress 的合法下限是 -1

  /* ---------- ① 关页 / 刷新 / 真跳转：beforeunload 确认框 ---------- */

  function onBeforeUnload(ev) {
    if (!active) return;
    // returnValue + preventDefault 双写，覆盖各内核的判定路径；
    // 用户点「离开」仍然会真走（内核不给更强的手段），但这一下能拦住误触。
    ev.preventDefault();
    ev.returnValue = '';
  }

  /* ---------- ③ 站内顶栏切换：捕获阶段 confirm ---------- */

  // 语义元素（nav/header）之外的兜底判据：视口顶部多少像素算「顶栏条带」。
  // 主播后台顶栏约 56~64px，取 96 稍宽松；误伤的代价只是多确认一次（取消即可），
  // 漏放的代价是下载白下 —— 宁可稍宽。
  var TOPBAR_H = 96;

  function isOurUi(t) {
    // Shadow DOM 里发生的点击，穿过边界后 target 被 retarget 成 host，
    // 文档层看到的就是这两个 host 元素之一；左下角消息盒子也放行。
    if (!t) return false;
    return t.id === 'dyc-replay-host'
      || t.id === 'dyc-replay-link-host'
      || t.id === 'dyb-status-bar';
  }

  function looksTopbar(t) {
    try {
      if (t && t.closest && t.closest('nav,header')) return true;
    } catch (e) { /* closest 不在场的极端内核，走条带判据 */ }
    return false;
  }

  function onCaptureClick(ev) {
    if (!active) return;
    var t = ev.target;
    if (isOurUi(t)) return;                    // 自己的按钮 / 进度卡 / 消息盒子，放行
    var y = ev.clientY;
    var inTop = looksTopbar(t) || (y >= 0 && y <= TOPBAR_H);
    if (!inTop) return;                        // 页面主体随便点，不打扰
    var go = true;
    try { go = window.confirm('回放下载中，切换分页可能中断下载。确定要切换吗？'); }
    catch (e) { go = true; }                   // confirm 被禁就放行，别把页面点死
    if (!go) {
      ev.preventDefault();
      ev.stopPropagation();                    // 捕获阶段截下，平台（React）的事件系统收不到
    }
  }

  /* ---------- ② 标签页标题：进度一直可见，防「忘了自己在下载」 ---------- */

  function writeTitle(pct) {
    try {
      document.title = pct >= 0 ? '⏬ ' + pct + '% 下载中' : '⏬ 下载中';
    } catch (e) { /* 个别内核标题只读：放弃提醒，不影响下载 */ }
  }

  window.__DYC_REPLAY_GUARD__ = {
    begin: function () {
      if (active) return;
      active = true;
      lastPct = -2;
      origTitle = '';
      try { origTitle = document.title || ''; } catch (e) {}
      writeTitle(-1);
      window.addEventListener('beforeunload', onBeforeUnload);
      document.addEventListener('click', onCaptureClick, true);
    },
    progress: function (pct) {
      if (!active) return;
      var p = Math.max(-1, Math.min(100, Math.round(Number(pct) || 0)));
      if (p === lastPct) return;               // 幂等：同一百分比不重写标题
      lastPct = p;
      writeTitle(p);
    },
    end: function () {
      if (!active) return;
      active = false;
      window.removeEventListener('beforeunload', onBeforeUnload);
      document.removeEventListener('click', onCaptureClick, true);
      try {
        // 平台可能在中途改过标题；只有当前还挂着我们的进度字样才还原，
        // 免得把平台刚写的标题覆盖回旧值。
        if (document.title && document.title.indexOf('下载中') >= 0) {
          document.title = origTitle || document.title;
        }
      } catch (e) {}
    }
  };
})();
