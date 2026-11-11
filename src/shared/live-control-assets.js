/**
 * 脚本包 · 注入清单注册表（2026-11-05 建；2026-11-08 两步泛化）
 * ============================================================
 * 唯一职责：给「补注入」提供与 manifest 逐项一致的清单。
 *
 * 为什么要在这里再存一份：manifest 的 content_scripts 是**导航期**注入，
 * SPA 从巨量百应主页/抖店侧栏切进子页时没人注入（详见 src/live/live-agent.js
 * 文件头）。后台补注入只能吃脚本清单，而 chrome.scripting.executeScript 不接受
 * 「按 manifest 某一条取文件」这种写法，只能给数组 —— 于是有了本文件。
 *
 * 2026-11-08 起从「中控台专用」泛化为**注册表**：所有 matches 为路径限定的
 * 注入组都登记进来（全域组如 store.weixin.qq.com/* 首次加载即全量注入、
 * SPA 切页脚本一直在场，不需要）。每个分组：
 *   label  —— 分区名（错误信息与诊断用）
 *   marker —— 在场标记（window 属性名），由各组的 *-flag.js 在第 1 位置真。
 *             各组必须用**不同的**标记：同文档从 A 组页面 SPA 切到 B 组页面时，
 *             A 的标记还在场，共用一个标记会让 B 被误判「已装」而永不补注。
 *   js/css —— 与 manifest 对应条目**逐项同序**一致，唯一差异是第 1 位多一个
 *             标记文件（原生注入也带它，两边完全一致）。
 *
 * ⚠️ 改任何一个分组必须同步改 manifest.json 里对应的那一条，且顺序完全一致
 *    （脚本有先后依赖：flags → 基础设施 → 功能 → 入口）。
 *    自测 `scripts/自测-补注入全分组.js` 会把**全部**分组与 manifest 逐项比对，
 *    漂移即红；中控台/橱窗另有各自的行为自测。
 *
 * 由 service-worker.js 通过 importScripts 引入（classic worker）。
 * ============================================================
 */
var DYC_INJECT_GROUPS = {

  /* ---- 直播中控台（抖店 / 巨量百应两个入口）---- */
  liveControl: {
    label: '中控台',
    marker: '__DYC_LIVE_CTRL_LOADED__',
    js: [
      'src/content/flags.js',
      'src/live/live-control-flag.js',   // 在场标记：必须紧跟开关层、早于任何建 UI 的脚本
      'src/content/drag-gate.js',        // 拖拽闸门（#130）：拖拽期让路的公共判据
      'src/content/diag.js',
      'src/content/cursor-fix.js',
      'src/content/anchor.js',
      'src/content/dialog.js',
      'src/content/row-scan.js',
      'src/live/tool-slots.js',
      'src/live/locate.js',
      'src/content/overlay-guard.js',
      'src/content/live-state.js',
      'src/live/nav.js',
      'src/live/back-to-top.js',
      'src/live/back-to-bottom.js',
      'src/live/search.js',
      'src/live/hide-elements.js',
      'src/live/name-wrap.js',
      'src/content/item-code.js',
      'src/live/copy-code.js',
      'src/live/auto-refresh.js',
      'src/content/stock-net-probe.js',
      'src/live/cart-paste.js',
      'src/content/debug-panel.js',
      'src/live/auto-loop-lecture.js',
      'src/live/lucky-bag.js',
      'src/live/toolbar.js'
    ],
    css: [
      'src/content/style.css',
      'src/live/nav.css',
      'src/content/msgbox.css'
    ]
  },

  /* ---- 巨量百应商品橱窗 ---- */
  shopwindow: {
    label: '橱窗',
    marker: '__DYC_SHOPWINDOW_LOADED__',
    js: [
      'src/content/flags.js',
      'src/content/shopwindow-flag.js',
      'src/content/diag.js',
      'src/content/anchor.js',
      'src/content/dialog.js',
      'src/content/stock-net-probe.js',
      'src/content/debug-panel.js',
      'src/content/shop-paste.js',
      'src/live/hide-elements.js'
    ],
    css: [
      'src/content/style.css',
      'src/content/msgbox.css'
    ]
  },

  /* ---- 抖店商品列表页（含渠道商品管理）---- */
  goodsList: {
    label: '商品列表',
    marker: '__DYC_GOODS_LIST_LOADED__',
    js: [
      'src/content/flags.js',
      'src/content/goods-list-flag.js',
      'src/content/diag.js',
      'src/content/cursor-fix.js',
      'src/content/anchor.js',
      'src/content/dialog.js',
      'src/content/row-scan.js',
      'src/content/inject-button.js',
      'src/content/clear-stock.js',
      'src/content/stock-net-probe.js',
      'src/content/stock-direct.js',
      'src/content/channel-stock.js',
      'src/live/hide-elements.js',
      'src/content/debug-panel.js',
      'src/content/channel-offline-delete.js',
      'src/content/shop-list-name.js',
      'src/content/goods-batch-copy.js',
      'src/content/main.js'
    ],
    css: [
      'src/content/style.css',
      'src/content/msgbox.css'
    ]
  },

  /* ---- 抖店商品新建 / 编辑页 ----
   * 已知边界：本组的 MAIN world 桥(fabric-smart-fill-main.js)是 document_start
   * 注入的，SPA 补注入只能补 isolated world —— 直填通道退回逐项流程可用，
   * 完整直填要刷新一次。 */
  goodsCreate: {
    label: '商品编辑',
    marker: '__DYC_GOODS_CREATE_LOADED__',
    js: [
      'src/content/flags.js',
      'src/content/goods-create-flag.js',
      'src/content/diag.js',
      'src/content/anchor.js',
      'src/content/dialog.js',
      'src/content/goods-image-paste.js',
      'src/content/fabric-smart-fill.js',
      'src/live/hide-elements.js',
      'src/content/stock-net-probe.js',
      'src/content/debug-panel.js'
    ],
    css: [
      'src/content/style.css',
      'src/content/msgbox.css'
    ]
  },

  /* ---- 抖店活动广场 ---- */
  merchant: {
    label: '活动广场',
    marker: '__DYC_MERCHANT_LOADED__',
    js: [
      'src/content/flags.js',
      'src/content/merchant-flag.js',
      'src/content/diag.js',
      'src/content/anchor.js',
      'src/content/dialog.js',
      'src/content/debug-panel.js',
      'src/content/campaign-channel-tick.js',
      'src/live/hide-elements.js'
    ],
    css: [
      'src/content/style.css',
      'src/content/msgbox.css'
    ]
  },

  /* ---- 罗盘直播详情 / 达人对账 ---- */
  compassLive: {
    label: '罗盘直播详情',
    marker: '__DYC_COMPASS_LIVE_LOADED__',
    js: [
      'src/content/flags.js',
      'src/content/compass-live-flag.js',
      'src/content/diag.js',
      'src/content/anchor.js',
      'src/content/dialog.js',
      'src/content/debug-panel.js',
      'src/content/item-code.js',
      'src/live/live-detail.js',
      'src/live/live-detail-tab.js',
      'src/live/live-detail-jump.js',
      'src/live/hide-elements.js'
    ],
    css: [
      'src/content/style.css',
      'src/content/msgbox.css'
    ]
  },

  /* ---- 罗盘直播大屏 ---- */
  compassScreen: {
    label: '罗盘直播大屏',
    marker: '__DYC_COMPASS_SCREEN_LOADED__',
    js: [
      'src/content/flags.js',
      'src/content/compass-screen-flag.js',
      'src/content/diag.js',
      'src/content/dialog.js',
      'src/content/debug-panel.js',
      'src/live/hide-elements.js',
      'src/replay/replay-ui.js',
      'src/content/item-code.js',
      'src/live/live-screen.js',
      'src/replay/replay-link.js'
    ],
    css: [
      'src/content/style.css',
      'src/content/msgbox.css'
    ]
  },

  /* ---- 罗盘商品表 / 商品流量 ---- */
  compassProduct: {
    label: '罗盘商品表',
    marker: '__DYC_COMPASS_PRODUCT_LOADED__',
    js: [
      'src/content/flags.js',
      'src/content/compass-product-flag.js',
      'src/content/diag.js',
      'src/content/anchor.js',
      'src/content/dialog.js',
      'src/content/debug-panel.js',
      'src/content/item-code.js',
      'src/live/compass-table.js',
      'src/live/hide-elements.js'
    ],
    css: [
      'src/content/style.css',
      'src/content/msgbox.css'
    ]
  }
};

/* 旧变量名保留为别名：SW 消息分支、既有自测与诊断口径都还在引用。 */
var DYC_LIVE_CONTROL_ASSETS = DYC_INJECT_GROUPS.liveControl;
var DYC_SHOPWINDOW_ASSETS = DYC_INJECT_GROUPS.shopwindow;
