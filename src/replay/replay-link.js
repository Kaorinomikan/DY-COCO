/**
 * 直播大屏专业版 · 跳转直播服务平台
 * ============================================================
 * 【为什么单独成一个文件，而不是塞进 replay-download.js】
 *   大屏页**不再提供下载**（用户 2026-10-18 决定：大屏只做跳转，下载回服务平台做）。
 *   下载链路那套东西（清单解析 / 转封装库 400KB / 分片抓取）在这一页一行都用不上。
 *   若共用同一个脚本，mux.min.js 会被白白解析一遍、网络嗅探器会白挂一个
 *   PerformanceObserver 盯着所有资源请求 —— 都是纯开销。
 *   ⇒ manifest 里拆成两条 content_scripts，各页只加载自己需要的文件。
 *
 * 【按钮放哪】
 *   浮在播放器画面的**右上角**（用户 2026-10-18 定：右上角、浮动），
 *   按钮跟随 video 矩形算坐标，滚出视口就藏起来、进全屏就搬进全屏层
 *   （实现在 replay-ui.js 的 mountLink / positionLink）。
 *   不插进页面流，是因为这一页播放器容器极可能是 flex / grid，
 *   插块级元素会把右侧面板和下方指标卡挤位。
 *
 * 【为什么要跳走】
 *   大屏是「看数」的，回放、评论、明细复盘都在直播服务平台那侧。
 *   这里只做一枚指路按钮，不承担下载（合规模糊地带越少越好）。
 */
(function () {
  'use strict';

  if (window.__DYC_REPLAY_LINK__) return;

  var UI = window.__DYC_REPLAY_UI__;
  if (!UI || typeof UI.mountLink !== 'function') return;   // 依赖缺失：静默退出

  var TARGET = 'https://liveservice.douyin.com/';
  var BUTTON_TEXT = '跳转直播服务平台';
  var BUTTON_TIP = '下载直播回放和看评论，复盘直播明细，点这里';

  var flags = {};
  var timer = null;      // 补挂 / 重新定位
  var alive = false;     // 当前是否已挂上

  /** 只认「直播大屏」这一页；同域的直播明细（/talent/live-statement）不归这里管 */
  function onThisPage() {
    return location.hostname === 'compass.jinritemai.com'
      && /^\/screen\/live\//.test(location.pathname);
  }

  function enabled() {
    return onThisPage() && flags.servicePlatformJump !== false;
  }

  function attach() {
    if (UI.mountLink({ href: TARGET, text: BUTTON_TEXT, tip: BUTTON_TIP })) alive = true;
  }

  function detach() {
    UI.unmountLink();
    alive = false;
  }

  function start() {
    if (!enabled()) return;
    attach();

    // 这一页也是 SPA：切场次、切页签都不重载文档，按钮外壳挂在 body 上不会掉，
    // 但播放器位置会变。UI.mountLink 内部每次调用都会重算一次位置，所以这里
    // 只需低频「确认还在、顺手对齐」，2 秒粒度对「人眼察觉不到挪动」足够。
    if (timer) clearInterval(timer);
    timer = setInterval(function () {
      if (!enabled()) { detach(); return; }
      if (!UI.linkAlive()) attach();
      else UI.mountLink({ href: TARGET, text: BUTTON_TEXT, tip: BUTTON_TIP });
    }, 2000);
  }

  function stop() {
    if (timer) { clearInterval(timer); timer = null; }
    detach();
  }

  var prev = null;      // 上一次的「生效与否」；null = 还没读到初始态

  dycReadFlags().then(function (f) {
    flags = f;
    var on = enabled();
    // 初始态在这里就记下来 —— 否则 prev 一直是 null，
    // 页面加载后**第一次**拨开关会被当成「首次读」，回声被吃掉。
    if (prev === null) prev = on;
    if (on) start();
  });

  dycWatchFlags(function (f) {
    flags = f;
    var now = enabled();
    if (prev === now) return;
    var first = prev === null;      // 首次读开关不出声：开页面就响一声是无意义噪音
    prev = now;

    // ⚠️ 顺序不能反（工程第 21 条：每个开关都要有带 source 的回声）：
    //   开 → 先 start() 把按钮与提示壳建出来，say 才有落点；
    //   关 → 先 say 再 stop()，因为 stop() 会把提示壳一起摘掉。
    if (now) {
      start();
      if (!first) UI.say('已开启', 'info', { source: '大屏跳转' });
    } else {
      if (!first) UI.say('已关闭', 'info', { source: '大屏跳转' });
      stop();
    }
  });

  window.__DYC_REPLAY_LINK__ = {
    start: start,
    stop: stop,
    isOn: function () { return alive; }
  };
})();
