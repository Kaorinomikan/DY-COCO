/**
 * 中控台脚本包 · 注入清单（2026-11-05）
 * ============================================================
 * 唯一职责：给「补注入」提供一份与 manifest 逐项一致的清单。
 *
 * 为什么要在这里再存一份：manifest 的 content_scripts 是**导航期**注入，
 * SPA 从侧栏切进中控台时没人注入（详见 src/live/live-agent.js 文件头）。
 * 后台补注入只能吃脚本清单，而 chrome.scripting.executeScript 不接受
 * 「按 manifest 某一条取文件」这种写法，只能给数组 —— 于是有了本文件。
 *
 * ⚠️ 改这里必须同步改 manifest.json 里 matches 为 `…/live/control*` 的那一条，
 *    且**顺序完全一致**（这几十个脚本有先后依赖：flags → 基础设施 → 功能 → 入口）。
 *    自测 `scripts/自测-中控台补注入.js` 会逐项比对，漂移即红。
 *
 * 由 service-worker.js 通过 importScripts 引入（classic worker）。
 * ============================================================
 */
var DYC_LIVE_CONTROL_ASSETS = {
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
};
