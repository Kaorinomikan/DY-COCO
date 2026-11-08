/**
 * 抖店/百应/罗盘子页 · 按需补注入探子（2026-11-05 建，2026-11-08 三次演进）
 * ============================================================
 * 【问题】先打开抖店 / 巨量百应的其它页（如百应主页 /dashboard），再从
 *   侧栏或页签切进**直播中控台**、**商品橱窗**等受支持子页，所有功能都
 *   不出现；必须刷新一次（URL 直接落在子页上）才正常。
 *
 * 【根因一】content_scripts 只在**导航**时注入。路径限定的 matches（如
 *   `…/live/control*`、`…/dashboard/shopwindow/*`）在 SPA 的 pushState
 *   切页下 document 不重载，根本没有机会命中，脚本从头到尾没装过。
 *   刷新时浏览器按新 URL 重新导航，才轮到它命中。
 *
 * 【根因二（2026-11-08 用户复报）】补注入本身**失败一次就永久静音**：
 *   旧逻辑只在「URL 刚变」或「刚切进来」的那一拍请求一次，请求失败后
 *   wasIn 已被置真、changed 也已归假 ⇒ 之后每一拍都跳过。
 *   实测后台失败并不罕见：`chrome.scripting.executeScript` 在部分国产内核上
 *   只给 Promise、不给回调，旧封装只等回调 ⇒ 每次都是「探针超时」。
 *
 * 【根因三（2026-11-08 用户再报：百应主页分页切橱窗不生效）】
 *   探子此前只认中控台；橱窗没有补注入通道 ⇒ 引入分区制。
 *
 * 【根因四（2026-11-08 用户要求：任何页面切进任何受支持页都要生效）】
 *   分区制推广到**全部路径型注入组**：商品列表、商品编辑、活动广场、
 *   罗盘三组。全域组（如微信小店 store.weixin.qq.com/*）首次加载即全量
 *   注入、SPA 切页脚本一直在场，不需要门铃 —— 这是本探子只覆盖抖店/
 *   百应/罗盘三域的原因。
 *
 * 【做法】本文件是**全域**注入的极小探子（不进任何功能目录，只当门铃）：
 *   只要「此刻在某分区页面」且「页面没有该分区的脚本标记」，就按退避节奏
 *   **反复**请后台补注入，直到标记出现（或用户切走）。退避 3s→6s→12s→30s
 *   封顶，后台每次都会先探标记，标记在场即跳过，所以不会重复注入。
 *   各分区的判定正则、标记、退避状态完全独立 —— 同一文档从 A 组页面切到
 *   B 组页面时 A 的标记还在场，共键会误判「已装」，这是各组独立标记的原因。
 *
 * 【诊断】window.__DYC_SPA_ZONES__ 登记全部分区（名称/标记/诊断字段），
 *   diag.js 的报告据此逐分区输出「在不在/装没装/试几次/报什么错」。
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

  /* ---- 各分区判定正则（口径 = manifest 对应条目的 matches）----
     中控台分区判定必须与 src/content/flags.js 的 dycIsLiveControl() 一致
     （同一份正则，自测会对比两边的判定结果）。 */
  var RE_LIVE = /^https:\/\/(?:fxg\.jinritemai\.com\/ffa\/content-tool\/live\/control|buyin\.jinritemai\.com\/dashboard\/live\/control)/;
  var RE_SHOPWINDOW = /^https:\/\/buyin\.jinritemai\.com\/dashboard\/shopwindow\//;
  var RE_GOODS_LIST = /^https:\/\/fxg\.jinritemai\.com\/ffa\/g\/(?:channel-goods-manage\/)?list/;
  var RE_GOODS_CREATE = /^https:\/\/(?:[a-z0-9-]+\.)*jinritemai\.com\/ffa\/g\/create/;
  var RE_MERCHANT = /^https:\/\/fxg\.jinritemai\.com\/ffa\/merchant\//;
  var RE_COMPASS_LIVE = /^https:\/\/compass\.jinritemai\.com\/(?:shop\/live-detail|talent\/live-statement)/;
  var RE_COMPASS_SCREEN = /^https:\/\/compass\.jinritemai\.com\/screen\/live\//;
  var RE_COMPASS_PRODUCT = /^https:\/\/compass\.jinritemai\.com\/shop\/(?:commodity\/product-list|merchandise-traffic)/;

  var BASE_MS = 3000;       // 退避起点：也是「连续失败时不把后台打爆」的下限
  var MAX_MS = 30000;       // 退避封顶
  var ASK_TIMEOUT_MS = 12000;  // 回执看门狗：后台被回收/崩溃时别把 asking 卡死

  function hrefNow() {
    try { return String(location.href || ''); } catch (e) { return ''; }
  }

  /**
   * 造一个分区探子。
   *
   * @param {string} cfg.label 分区名（诊断日志用）
   * @param {string} cfg.group 补注入注册表键（与 live-control-assets.js 对应）
   * @param {RegExp} cfg.re 该分区页面的判定正则
   * @param {string} cfg.markerKey 在场标记（window 上的属性名）
   * @param {string} cfg.triesKey 尝试次数的诊断字段
   * @param {string} cfg.errKey 失败原因的诊断字段
   */
  function makeZone(cfg) {
    var lastHref = '';
    var asking = false;
    var tries = 0;
    var nextAt = 0;           // 下一次允许请求的时刻；0 = 立即可发
    var askTimer = 0;

    function inZone() { return cfg.re.test(hrefNow()); }

    /** 该分区脚本是否已在场（标记由各组 *-flag.js 置） */
    function installed() { return !!window[cfg.markerKey]; }

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
      window[cfg.triesKey] = tries;

      /* 看门狗：sendMessage 的回执在后台被回收、消息通道断开时可能永不回来。
         不设它，asking 会永久为真，后面每一拍都被挡住 —— 又是一个「静音」出口。 */
      if (askTimer) clearTimeout(askTimer);
      askTimer = setTimeout(function () {
        askTimer = 0;
        if (!asking) return;
        asking = false;
        window[cfg.errKey] = '后台未回执';
        nextAt = Date.now() + backoffMs();
      }, ASK_TIMEOUT_MS);

      try {
        chrome.runtime.sendMessage({
          type: 'dyc:injectGroup',
          group: cfg.group
        }, function (res) {
          asking = false;
          if (askTimer) { clearTimeout(askTimer); askTimer = 0; }
          var err = (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.lastError)
            ? (chrome.runtime.lastError.message || '消息通道不可用')
            : '';

          /* 后台回执「注入完成」不等于真的装上了：单文件失败、内核拦注入都可能
             让脚本半途而废。唯一可信的判据是页面里的标记。 */
          if (installed()) {
            window[cfg.errKey] = '';
            nextAt = 0;
            return;
          }

          if (res && res.ok === false) err = res.error || '补注入失败';
          else if (res && res.failed && res.failed.length) err = '部分脚本未注入：' + res.failed.join('、');
          else if (!err) err = '注入完成但页面没有标记';

          /* 失败不弹消息（用户可能正在推流），只留证据给诊断报告，
             并按退避继续尝试 —— 这正是本轮修复的核心：不再一次失败就静音。 */
          window[cfg.errKey] = err;
          nextAt = Date.now() + backoffMs();
        });
      } catch (e) {
        asking = false;
        if (askTimer) { clearTimeout(askTimer); askTimer = 0; }
        window[cfg.errKey] = (e && e.message) || '消息通道不可用';
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

      if (!inZone()) return;
      /* 首拍只记录：原生那条 content_scripts 也在分区页注入，同一批注入
         是同步跑完的，这里让一拍，避免和它抢着装。真正的兜底在下面 1.5 秒。 */
      if (first) return;
      if (installed()) return;
      ask();
    }

    /** 1.5 秒兜底：首拍就已在分区页却没标记 ⇒ 原生注入没成，补一次 */
    function fallback() {
      if (inZone() && !installed()) ask();
    }

    return {
      group: cfg.group,
      label: cfg.label,
      marker: cfg.markerKey,
      triesKey: cfg.triesKey,
      errKey: cfg.errKey,
      re: cfg.re,
      tick: tick,
      fallback: fallback
    };
  }

  var zones = [
    makeZone({
      label: '中控台',
      group: 'liveControl',
      re: RE_LIVE,
      markerKey: '__DYC_LIVE_CTRL_LOADED__',
      triesKey: '__DYC_LIVE_INJECT_TRIES__',
      errKey: '__DYC_LIVE_INJECT_ERROR__'
    }),
    makeZone({
      label: '橱窗',
      group: 'shopwindow',
      re: RE_SHOPWINDOW,
      markerKey: '__DYC_SHOPWINDOW_LOADED__',
      triesKey: '__DYC_SHOPWINDOW_INJECT_TRIES__',
      errKey: '__DYC_SHOPWINDOW_INJECT_ERROR__'
    }),
    makeZone({
      label: '商品列表',
      group: 'goodsList',
      re: RE_GOODS_LIST,
      markerKey: '__DYC_GOODS_LIST_LOADED__',
      triesKey: '__DYC_GOODS_LIST_INJECT_TRIES__',
      errKey: '__DYC_GOODS_LIST_INJECT_ERROR__'
    }),
    makeZone({
      label: '商品编辑',
      group: 'goodsCreate',
      re: RE_GOODS_CREATE,
      markerKey: '__DYC_GOODS_CREATE_LOADED__',
      triesKey: '__DYC_GOODS_CREATE_INJECT_TRIES__',
      errKey: '__DYC_GOODS_CREATE_INJECT_ERROR__'
    }),
    makeZone({
      label: '活动广场',
      group: 'merchant',
      re: RE_MERCHANT,
      markerKey: '__DYC_MERCHANT_LOADED__',
      triesKey: '__DYC_MERCHANT_INJECT_TRIES__',
      errKey: '__DYC_MERCHANT_INJECT_ERROR__'
    }),
    makeZone({
      label: '罗盘直播详情',
      group: 'compassLive',
      re: RE_COMPASS_LIVE,
      markerKey: '__DYC_COMPASS_LIVE_LOADED__',
      triesKey: '__DYC_COMPASS_LIVE_INJECT_TRIES__',
      errKey: '__DYC_COMPASS_LIVE_INJECT_ERROR__'
    }),
    makeZone({
      label: '罗盘直播大屏',
      group: 'compassScreen',
      re: RE_COMPASS_SCREEN,
      markerKey: '__DYC_COMPASS_SCREEN_LOADED__',
      triesKey: '__DYC_COMPASS_SCREEN_INJECT_TRIES__',
      errKey: '__DYC_COMPASS_SCREEN_INJECT_ERROR__'
    }),
    makeZone({
      label: '罗盘商品表',
      group: 'compassProduct',
      re: RE_COMPASS_PRODUCT,
      markerKey: '__DYC_COMPASS_PRODUCT_LOADED__',
      triesKey: '__DYC_COMPASS_PRODUCT_INJECT_TRIES__',
      errKey: '__DYC_COMPASS_PRODUCT_INJECT_ERROR__'
    })
  ];

  /* 诊断注册表：diag.js 据此逐分区输出补注入状态（探子没跑起来时它读不到）。 */
  window.__DYC_SPA_ZONES__ = zones.map(function (z) {
    return {
      group: z.group,
      label: z.label,
      marker: z.marker,
      triesKey: z.triesKey,
      errKey: z.errKey,
      re: z.re
    };
  });

  zones.forEach(function (z) { z.tick(true); });
  /* 首拍就在某分区却没标记 ⇒ 原生注入没成（极老内核 / 条目被改），
     让 1.5 秒后补一次。正常路径此刻标记已在，不会发请求。 */
  setTimeout(function () { zones.forEach(function (z) { z.fallback(); }); }, 1500);

  setInterval(function () { zones.forEach(function (z) { z.tick(false); }); }, 500);
  window.addEventListener('popstate', function () { zones.forEach(function (z) { z.tick(false); }); });
  window.addEventListener('hashchange', function () { zones.forEach(function (z) { z.tick(false); }); });
})();
