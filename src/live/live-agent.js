/**
 * 中控台脚本 · 按需补注入（2026-11-05）
 * ============================================================
 * 【问题】先打开抖店 / 巨量百应的其它页，再从**侧栏**切进直播中控台，
 *   所有功能都不出现；必须刷新一次（URL 直接就是 /live/control）才正常。
 *
 * 【根因】content_scripts 只在**导航**时注入。中控台那一条的 matches 是
 *   `…/live/control*`，而侧栏切页是 Garfish 微前端的 pushState ——
 *   document 不重载，那一条 matches 根本没有机会命中，脚本从头到尾没装过。
 *   刷新时浏览器按新 URL 重新导航，才轮到它命中。
 *
 * 【做法】本文件是**全域**注入的极小探子（不进中控台功能目录，只当门铃）：
 *   发现「已经在中控台、但页面没有中控台脚本标记」时，请后台按
 *   `src/shared/live-control-assets.js` 里那份清单把整套脚本补进去。
 *   清单与 manifest 的中控台条目逐项一致，由自测 `自测-中控台补注入.js`
 *   守着，防止两处漂移。
 *
 * 【不做的事】
 *   · 不在别页做任何事（只读 location.href 与一个标记，每 500ms 一次字符串判定）
 *   · 不猜用户意图、不自动刷新页面（用户可能正在直播推流）
 *   · 不重复注入：标记已在场就彻底静音，后台注入前还会再探一次
 * ============================================================
 */
(function () {
  'use strict';

  if (window.__DYC_LIVE_AGENT__) return;
  window.__DYC_LIVE_AGENT__ = true;

  /* 判定口径必须与 src/content/flags.js 的 dycIsLiveControl() 一致
     （同一份正则，自测会对比两边的判定结果）。 */
  var RE = /^https:\/\/(?:fxg\.jinritemai\.com\/ffa\/content-tool\/live\/control|buyin\.jinritemai\.com\/dashboard\/live\/control)/;

  var ASK_COOL_MS = 3000;   // 两次请求之间的最小间隔：失败时别把后台打爆
  var lastHref = '';
  var wasIn = false;
  var asking = false;
  var lastAskAt = 0;

  function hrefNow() {
    try { return String(location.href || ''); } catch (e) { return ''; }
  }

  function inControl() { return RE.test(hrefNow()); }

  /** 中控台脚本是否已在场（标记由 src/live/live-control-flag.js 置） */
  function installed() { return !!window.__DYC_LIVE_CTRL_LOADED__; }

  function ask() {
    if (asking || installed()) return;
    var now = Date.now();
    if (now - lastAskAt < ASK_COOL_MS) return;
    lastAskAt = now;
    asking = true;
    try {
      chrome.runtime.sendMessage({ type: 'dyc:injectLiveControl' }, function (res) {
        asking = false;
        void chrome.runtime.lastError;
        /* 失败不弹消息（可能只是这一下切走了），但把原因留成全局变量，
           诊断报告里能直接看到「补注入为什么没成」。 */
        if (res && res.ok === false) window.__DYC_LIVE_INJECT_ERROR__ = res.error || '补注入失败';
        else if (res && res.ok) window.__DYC_LIVE_INJECT_ERROR__ = '';
      });
    } catch (e) {
      asking = false;
      window.__DYC_LIVE_INJECT_ERROR__ = (e && e.message) || '消息通道不可用';
    }
  }

  function tick(first) {
    var now = inControl();
    var href = hrefNow();
    var changed = (href !== lastHref);
    lastHref = href;

    if (!now) { wasIn = false; return; }
    /* 首拍只记录：原生那条 content_scripts 也在中控台页注入，同一批注入
       是同步跑完的，这里让一拍，避免和它抢着装。真正的兜底在下面 1.5 秒。 */
    if (first) { wasIn = true; return; }
    if (installed()) { wasIn = true; return; }
    if (!wasIn || changed) ask();
    wasIn = true;
  }

  tick(true);
  /* 首拍就在中控台却没有标记 ⇒ 原生注入没成（极老内核 / 条目被改），
     让 1.5 秒后补一次。正常路径此刻标记已在，不会发请求。 */
  setTimeout(function () { if (inControl() && !installed()) ask(); }, 1500);

  setInterval(function () { tick(false); }, 500);
  window.addEventListener('popstate', function () { tick(false); });
  window.addEventListener('hashchange', function () { tick(false); });
})();
