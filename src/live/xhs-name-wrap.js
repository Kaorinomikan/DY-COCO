/**
 * 小红书中控台 · 商品名完整显示（写不下自动换行）
 * ============================================================
 * 【第三版 · 2026-11-17 夜。前两版「几何判定 + 逐元素写内联」被换掉了。】
 *
 * 【为什么换方案】
 *   内联方案的失败模式在真机上反复出现：平台的商品列表是 React 管的，
 *   它的重渲染会把元素的内联样式**重置回平台自己的值**——
 *   我们涂一遍它抹一遍，最后一轮谁赢纯看渲染时机。
 *   于是同一个功能 18:10 的截图是展开的（base 138 / 名称 66），
 *   18:45、18:56 的报告又回到 116 / 44，用户看到的就是「时好时坏」、
 *   「还是会文字重叠」。
 *   几何判定、强写 !important、重试上限，都只是在这个竞态里加码，
 *   治不了本 —— 竞态的根源是「我们写在 React 管的属性上」。
 *
 * 【样式表方案（本版）】
 *   注入一条**全局样式表**（唯一 id、幂等），规则按类名命中：
 *     · 名称：span.--color-text-title（与描述的 --color-text-description 可区分）
 *     · 祖先让位：__title-block / __base
 *   React 重渲染不会碰我们这条样式表 ⇒ 平台涂它的、我们涂我们的，不再竞争。
 *   开关关掉就整条移除，不留残余。
 *
 * 【页面事实（2026-11-17 结构报告实测，选择器全部有据）】
 *   · 名称 = .goods-card__title-block > span.d-text.--color-static.--color-text-title
 *     （描述是 --color-text-description，两者类名可区分，不会误伤）
 *   · 截断来源 = line-clamp:2 + overflowY:hidden（部分卡片还有 44px 定高）
 *   · 真机报告里出现过「文本高 66 / 可见高 44」—— 平台用
 *     height + 行数钳制实现两行截断 ⇒ 解钳制必须连 height/max-height
 *     一起用 !important 写，否则文字折了三行、盒子还钉在 44px，
 *     直接盖住下面的商品 ID（第三轮的教训）。
 *
 * 【与抖店口径的差异】
 *   抖店 name-wrap 是几何判定（只处理「真的被截断」的行），因为抖店卡片
 *   结构复杂、不能无差别改。小红书卡片结构单一、名称类名唯一，
 *   样式表按类命中反而是更稳的做法 —— 两行以内的名称展开后视觉无变化。
 *
 * 【第四版 · 2026-11-17 夜 · 覆盖「添加商品」抽屉的表格列表】
 *   用户提的是同一件事的另一处：点「添加商品」右侧抽屉里那张表，名称列同样
 *   只显示一行。结构报告实测（同一份报告，选择器有据）：
 *     · 名称 = .goods-base-sample > .goods-title > div > span.d-text.--color-static
 *       （盒子 267×22，文本宽 350~484 ⇒ 被裁掉一半以上）
 *     · 截断来源是 **ellipsis + nowrap**（不是卡片那种 line-clamp+定高），
 *       所以关键在 white-space，card 那套 -webkit-line-clamp 在这里不是主因。
 *   【为什么不复用 card 的规则、也不写裸 .d-text】.--color-static / .d-text
 *   是全页通用的工具类，裸写会把整页文本都改成换行；作用域必须锁在
 *   .goods-base-sample（这张表里装商品基础信息的那个单元格）以内。
 *   【为什么还要放开行高】表格是 CSS Grid（.d-grid.d-table + .d-grid-item.d-td），
 *   行高若被平台钉死，名称折行后不会把行撑高、而是直接压到下一行上 ——
 *   上一版在卡片上吃过这个亏（文字盖住商品 ID）。因此把行轨道改成
 *   minmax(39px, auto)：**保留平台原行距作下限**，只有真的写不下才长高。
 *   2026-11-17 无头渲染实测（Chromium，按结构报告复刻的表格）：
 *     · 只写 auto → 整张表被压扁（195→132px），行间距被吃掉 ⇒ 必须留 39px 下限
 *     · minmax(39px, auto) → 短名行高仍是 39，长名行 39→44，无一处压字
 *   这是**故意**的取舍：宁可行高随名称变，也不能出现文字压字。
 * ============================================================
 */
(function () {
  'use strict';

  var STYLE_ID = 'dyc-xhs-namewrap-style';

  var CSS = [
    '/* 名称：解行数钳制，完整换行。',
    '   --color-text-title 只命中名称；描述是 --color-text-description，不会误伤。',
    '   全部 !important：平台的 line-clamp:2 + 定高 + overflow:hidden 都写在',
    '   类或内联上，普通声明压不过（第三轮真机教训：盒高被钉在 44px）。 */',
    '.goods-card__title-block > span.d-text.--color-text-title {',
    '  white-space: normal !important;',
    '  display: block !important;',
    '  height: auto !important;',
    '  max-height: none !important;',
    '  min-height: 0 !important;',
    '  overflow: visible !important;',
    '  -webkit-line-clamp: unset !important;',
    '  text-overflow: clip !important;',
    '  word-break: normal !important;',
    '  overflow-wrap: break-word !important;',
    '}',
    '/* 祖先让位：名称变高后，这两层若被钉高，名称会溢出画到下一行上。 */',
    '.goods-card__title-block {',
    '  height: auto !important;',
    '  max-height: none !important;',
    '  min-height: 0 !important;',
    '}',
    '.goods-card__base {',
    '  height: auto !important;',
    '  max-height: none !important;',
    '  min-height: 0 !important;',
    '}',

    '/* ===== B. 「添加商品」抽屉的表格列表（第四版） ===== */',
    '/* 名称：这里是 nowrap + 省略号，解 nowrap 才折行。',
    '   作用域锁 .goods-base-sample —— 不写裸 .d-text / .--color-static，',
    '   那两个类全页通用，裸写会把整页文本都改成换行。 */',
    '.goods-base-sample .goods-title .d-text {',
    '  white-space: normal !important;',
    '  word-break: normal !important;',
    '  overflow-wrap: break-word !important;',
    '  text-overflow: clip !important;',
    '  display: block !important;',
    '  overflow: visible !important;',
    '  height: auto !important;',
    '  max-height: none !important;',
    '  -webkit-line-clamp: unset !important;',
    '}',
    '/* 祖先让位：名称折两行后，这几层若被钉高就会裁掉文字或压到下一行。 */',
    '.goods-base-sample .goods-title,',
    '.goods-base-sample .goods-title > div,',
    '.goods-base.goods-base-sample {',
    '  height: auto !important;',
    '  max-height: none !important;',
    '  min-height: 0 !important;',
    '  overflow: visible !important;',
    '}',
    '/* 表格是 CSS Grid：行轨道若被钉成固定 px，折行不会撑高、只会压到下一行。',
    '   下限写 39px（结构报告实测的行高：表头格 48×39），**不是**把它钉死 ——',
    '   minmax(39px, auto) = 至少维持平台原行距、写不下才长高。',
    '   2026-11-17 无头实测：只写 auto 会把整张表压扁（195→132），',
    '   平台给的那点行间距被我们吃掉了，所以下限必须留。 */',
    '.d-grid.d-table:has(.goods-base-sample),',
    '.add-goods-table .d-grid.d-table {',
    '  grid-auto-rows: minmax(39px, auto) !important;',
    '}',
    '/* 装名称的那个单元格（只命中装了 .goods-base-sample 的格子）。',
    '   height 必须放开：平台钉高 + overflow:hidden 时，折好的第二行会被裁掉。',
    '   :has 在 Chrome 105+ 可用，本扩展只跑 Chromium 内核。 */',
    '.d-grid-item.d-td:has(.goods-base-sample),',
    '.d-grid-item.d-td:has(.goods-base-sample) .d-space {',
    '  height: auto !important;',
    '  max-height: none !important;',
    '  min-height: 0 !important;',
    '}'
  ].join('\n');

  function onCtrlPage() {
    try {
      var pat = window.DYC_PAGE_PATTERNS;
      return !!(pat && pat.xhsCtrl && pat.xhsCtrl.test(location.href));
    } catch (e) { return false; }
  }

  function inject() {
    if (document.getElementById(STYLE_ID)) return;
    var st = document.createElement('style');
    st.id = STYLE_ID;
    st.setAttribute('data-dyc-skip', '1');
    st.textContent = CSS;
    (document.head || document.documentElement).appendChild(st);
  }

  function remove() {
    var st = document.getElementById(STYLE_ID);
    if (st && st.parentNode) st.parentNode.removeChild(st);
  }

  var flags = {};
  var flagsReady = false;
  var started = false;

  function apply() {
    var shouldRun = flagsReady && onCtrlPage() && flags.xhsNameWrap !== false;
    if (shouldRun) inject();
    else remove();
  }

  function start() {
    if (started) return;
    started = true;
    /* dycReadFlags() 返回 Promise —— 必须 .then（2026-11-17 事故：同步取用导致全黑） */
    dycReadFlags().then(function (f) {
      flags = f || {};
      flagsReady = true;
      apply();
    }, function () { /* 读不到就保持不注入，等 onChanged 救场 */ });

    if (typeof dycWatchFlags === 'function') {
      dycWatchFlags(function (f) { flags = f || {}; flagsReady = true; apply(); });
    }
    /* SPA：换路由不重载 document，靠 pushState 钩子重判 */
    window.addEventListener('dyc:pagechange', apply);
  }

  (function waitForFlags() {
    var waited = 0;
    function tryStart() {
      if (typeof dycReadFlags === 'function') { start(); return; }
      waited += 50;
      if (waited < 5000) setTimeout(tryStart, 50);
      else start();
    }
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', tryStart, { once: true });
    } else {
      tryStart();
    }
  })();
})();
