/**
 * 内容脚本入口
 *
 * 依赖注入顺序（见 manifest.json）：
 *   flags.js          功能开关读取层
 *   anchor.js         语义定位工具
 *   dialog.js         弹窗组件
 *   row-scan.js       行监听与注入调度
 *   inject-button.js  按钮注入与点击处理
 *   clear-stock.js    清零执行 + 调试面板
 *
 * 本文件负责两件事：
 *   1. 挂载调试面板（受 dybDebug 控制，默认关）
 *   2. 启动「商品库存清零」功能（受 dybFeatures.clearStock 控制，默认开），
 *      并让弹窗里的开关**即时生效** —— 关掉立刻移除页面上所有按钮，
 *      打开立刻重新扫描注入，全程不需要刷新页面。
 */

(function main() {
  'use strict';

  // 防止重复注入
  if (window.__DYB_INITIALIZED__) {
    console.warn('[DYB] 已初始化，跳过');
    return;
  }
  window.__DYB_INITIALIZED__ = true;

  // 确认在正确的页面（2026-10-24 起含渠道品列表页：
  // 用户会直接打开/刷新渠道品页,内容脚本必须在那里也活着）
  function isTargetPage() {
    return /^https:\/\/fxg\.jinritemai\.com\/ffa\/g\/(list|channel-goods-manage\/list)/.test(location.href);
  }

  if (!isTargetPage()) {
    if (typeof debugLog === 'function') {
      debugLog('主控:非目标页跳过(' + location.pathname + ')');
    }
    console.log('[DYB] 当前页面不匹配，跳过');
    return;
  }

  console.log('[DYB] 内容脚本已启动');
  if (typeof debugLog === 'function') {
    debugLog('主控启动:页面类型=' + (typeof pageType === 'function' ? pageType() : '未知'));
  }

  /* ==========================================================
   * 调试面板 —— 已迁出(2026-10-16)
   *
   * 面板现由 src/content/debug-panel.js 自带挂载,不再依赖本文件。
   * 原因:本文件只注入「商品列表页」一组,中控台因此一直没有面板;
   * 迁出后 debug-panel.js 同时注入两组,中控台也有了。
   * ========================================================== */

  /* ==========================================================
   * 商品库存清零（功能开关：dybFeatures.clearStock）
   * ========================================================== */

  let clearStockOn = false;   // 当前是否启用
  let bootAttempts = 0;       // 启动扫描次数
  let bootTimer = null;       // 延迟启动句柄

  /**
   * 启动扫描。
   *
   * 抖店采用 Garfish 微前端架构（子应用异步加载），
   * DOM 就绪不等于商品列表已渲染，需要轮询重试。
   */
  function tryBoot() {
    if (!clearStockOn) return;

    bootAttempts++;

    const count = injectAllRows();
    console.log('[DYB] 第' + bootAttempts + '次扫描，注入', count, '个按钮');
    if (typeof debugLog === 'function') {
      debugLog('主控扫描#' + bootAttempts + ':注入 ' + count);
    }

    // 列表已渲染则启动监听
    if (count > 0 || bootAttempts >= 10) {
      if (typeof debugLog === 'function') {
        debugLog(count > 0 ? '主控:页面就绪,启动监听' : '主控:重试耗尽,启动监听兜底');
      }
      if (count > 0) {
        console.log('[DYB] 列表已就绪，启动监听');
      } else {
        console.warn('[DYB] 10次扫描仍未找到商品行，启动监听兜底（等待后续渲染）');
      }
      // 2026-10-24:重试耗尽也启动监听 —— 注入本身带形态守卫,监听常驻
      // 才能接住「表渲染得比 15 秒轮询更晚」的场景(渠道品页直开实测需要)。
      startRowWatcher();
      return;
    }

    // 未找到则 1.5 秒后重试
    bootTimer = setTimeout(tryBoot, 1500);
  }

  function scheduleBoot() {
    clearTimeout(bootTimer);
    bootTimer = setTimeout(tryBoot, 1200);
  }

  /** 开启功能：重新扫描并注入 */
  function enableClearStock() {
    if (clearStockOn) return;
    clearStockOn = true;
    bootAttempts = 0;
    console.log('[DYB] 清空库存：已开启');

    if (document.readyState === 'complete') {
      scheduleBoot();
    } else {
      window.addEventListener('load', scheduleBoot, { once: true });
    }
  }

  /** 关闭功能：移除已注入的按钮并停掉监听 */
  function disableClearStock() {
    if (!clearStockOn) return;
    clearStockOn = false;
    clearTimeout(bootTimer);
    console.log('[DYB] 清空库存：已关闭，移除已注入的按钮');

    // 顺序不能颠倒：先停监听再删按钮。
    // 反过来的话，删按钮这个动作本身会触发 MutationObserver，
    // 又会排一次注入，白忙一场。
    stopRowWatcher();
    resetInjection();
    removeAllClearButtons();
  }

  // 路由切回商品列表页 / 渠道品页时重新扫描（只注册一次，避免反复开关导致回调堆积）
  onRouteChange((url) => {
    if (clearStockOn && isTargetPage()) {
      setTimeout(tryBoot, 800);
    }
  });

  // 首次读取开关状态
  dycReadFlags().then((flags) => {
    if (typeof debugLog === 'function') {
      debugLog('主控:开关读取 clearStock=' + !!flags.clearStock);
    }
    if (flags.clearStock) {
      enableClearStock();
    } else {
      console.log('[DYB] 清空库存：开关为关闭，跳过注入');
    }
  });

  // 开关变化即时生效，不需要刷新页面
  // 状态条统一反馈(2026-10-11):开关切换在左下角报一声,首次对齐不报
  let prevClearStock = null;
  dycWatchFlags((flags) => {
    const on = !!flags.clearStock;
    if (prevClearStock !== null && on !== prevClearStock && typeof toast === 'function') {
      toast(on ? '已开启' : '已关闭', 'info', { source: '库存清零' });
    }
    prevClearStock = on;
    if (on) {
      enableClearStock();
    } else {
      disableClearStock();
    }
  });
})();
