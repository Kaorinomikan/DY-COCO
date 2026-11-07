/**
 * 中控台脚本 · 按需补注入（2026-11-05，重试 2026-11-08）
 * ============================================================
 * 【问题】先打开抖店 / 巨量百应的其它页，再从**侧栏**切进直播中控台，
 *   所有功能都不出现；必须刷新一次（URL 直接就是 /live/control）才正常。
 *
 * 【根因一】content_scripts 只在**导航**时注入。中控台那一条的 matches 是
 *   `…/live/control*`，而侧栏切页是 Garfish 微前端的 pushState ——
 *   document 不重载，那一条 matches 根本没有机会命中，脚本从头到尾没装过。
 *   刷新时浏览器按新 URL 重新导航，才轮到它命中。
 *
 * 【根因二（2026-11-08 用户复报）】补注入本身**失败一次就永久静音**：
 *   旧逻辑只在「URL 刚变」或「刚从中控台外进来」的那一拍请求一次，
 *   请求失败后 wasIn 已被置真、changed 也已归假 ⇒ 之后每一拍都跳过，
 *   于是页面停在「一个按钮都没有」的状态，只有刷新才恢复。
 *   实测后台失败并不罕见：`chrome.scripting.executeScript` 在部分国产内核上
 *   只给 Promise、不给回调，旧封装只等回调 ⇒ 每次都是「探针超时」。
 *
 * 【做法】本文件是**全域**注入的极小探子（不进中控台功能目录，只当门铃）：
 *   只要「此刻在中控台」且「页面没有中控台脚本标记」，就按退避节奏**反复**
 *   请后台补注入，直到标记出现（或用户切走）。退避 3s→6s→12s→30s 封顶，
 *   后台每次都会先探标记，标记在场即跳过，所以不会重复注入。
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

  var BASE_MS = 3000;       // 退避起点：也是「连续失败时不把后台打爆」的下限
  var MAX_MS = 30000;       // 退避封顶
  var ASK_TIMEOUT_MS = 12000;  // 回执看门狗：后台被回收/崩溃时别把 asking 卡死
  var lastHref = '';
  var asking = false;
  var tries = 0;
  var nextAt = 0;           // 下一次允许请求的时刻；0 = 立即可发
  var askTimer = 0;

  function hrefNow() {
    try { return String(location.href || ''); } catch (e) { return ''; }
  }

  function inControl() { return RE.test(hrefNow()); }

  /** 中控台脚本是否已在场（标记由 src/live/live-control-flag.js 置） */
  function installed() { return !!window.__DYC_LIVE_CTRL_LOADED__; }

  /** 退避时长：3s → 6s → 12s → 24s → 30s 封顶（tries 从 1 起） */
  function backoffMs() {
    var ms = BASE_MS * Math.pow(2, Math.max(tries - 1, 0));
    return Math.min(ms, MAX_MS);
  }

  function ask() {
    if (asking || installed()) return;
    if (Date.now() < nextAt) return;

    asking = true;
    tries += 1;
    window.__DYC_LIVE_INJECT_TRIES__ = tries;

    /* 看门狗：sendMessage 的回执在后台被回收、消息通道断开时可能永不回来。
       不设它，asking 会永久为真，后面每一拍都被挡住 —— 又是一个「静音」出口。 */
    if (askTimer) clearTimeout(askTimer);
    askTimer = setTimeout(function () {
      askTimer = 0;
      if (!asking) return;
      asking = false;
      window.__DYC_LIVE_INJECT_ERROR__ = '后台未回执';
      nextAt = Date.now() + backoffMs();
    }, ASK_TIMEOUT_MS);

    try {
      chrome.runtime.sendMessage({ type: 'dyc:injectLiveControl' }, function (res) {
        asking = false;
        if (askTimer) { clearTimeout(askTimer); askTimer = 0; }
        var err = (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.lastError)
          ? (chrome.runtime.lastError.message || '消息通道不可用')
          : '';

        /* 后台回执「注入完成」不等于真的装上了：单文件失败、内核拦注入都可能
           让脚本半途而废。唯一可信的判据是页面里的标记。 */
        if (installed()) {
          window.__DYC_LIVE_INJECT_ERROR__ = '';
          nextAt = 0;
          return;
        }

        if (res && res.ok === false) err = res.error || '补注入失败';
        else if (res && res.failed && res.failed.length) err = '部分脚本未注入：' + res.failed.join('、');
        else if (!err) err = '注入完成但页面没有标记';

        /* 失败不弹消息（用户可能正在推流），只留证据给诊断报告，
           并按退避继续尝试 —— 这正是本轮修复的核心：不再一次失败就静音。 */
        window.__DYC_LIVE_INJECT_ERROR__ = err;
        nextAt = Date.now() + backoffMs();
      });
    } catch (e) {
      asking = false;
      if (askTimer) { clearTimeout(askTimer); askTimer = 0; }
      window.__DYC_LIVE_INJECT_ERROR__ = (e && e.message) || '消息通道不可用';
      nextAt = Date.now() + backoffMs();
    }
  }

  function tick(first) {
    var href = hrefNow();
    if (href !== lastHref) {
      /* 换页就重置退避：新页面是新的机会，不该继承上一页的等待时间 */
      lastHref = href;
      tries = 0;
      nextAt = 0;
    }

    if (!inControl()) return;
    /* 首拍只记录：原生那条 content_scripts 也在中控台页注入，同一批注入
       是同步跑完的，这里让一拍，避免和它抢着装。真正的兜底在下面 1.5 秒。 */
    if (first) return;
    if (installed()) return;
    ask();
  }

  tick(true);
  /* 首拍就在中控台却没有标记 ⇒ 原生注入没成（极老内核 / 条目被改），
     让 1.5 秒后补一次。正常路径此刻标记已在，不会发请求。 */
  setTimeout(function () { if (inControl() && !installed()) ask(); }, 1500);

  setInterval(function () { tick(false); }, 500);
  window.addEventListener('popstate', function () { tick(false); });
  window.addEventListener('hashchange', function () { tick(false); });
})();
