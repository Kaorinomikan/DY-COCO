/**
 * 商品行扫描
 *
 * 抖店商品列表是 SPA，存在三个需要处理的特性：
 * 1. 路由切换 —— 页面不刷新，列表整体替换
 * 2. 虚拟滚动 —— 只有可视区域的行在 DOM 里
 * 3. 分页 / 筛选 —— 列表内容整体替换
 *
 * 因此用 MutationObserver 持续监听，动态补齐按钮。
 */

// 记录已注入的行，避免重复插入按钮。
// 用 Set 而非 WeakSet：需要能主动清空（路由切换时重置）。
let injectedRows = new Set();

// 观察器实例
let observer = null;

// 轮询句柄
let routeTimer = null;

// 路由变化回调集合
const routeListeners = new Set();

/**
 * 启动监听
 */
function startRowWatcher() {
  injectAllRows();

  if (observer) observer.disconnect();

  observer = new MutationObserver((mutations) => {
    // 判断是否为外部变动，避免自己插入按钮引发的自激循环
    let external = false;

    for (const m of mutations) {
      if (m.type !== 'childList') continue;

      for (const node of m.addedNodes) {
        if (node.nodeType !== 1) continue;
        if (isOwnNode(node)) continue;
        external = true;
      }
    }

    if (external) scheduleInject();
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true
  });

  watchRouteChange();
}

/**
 * 判断节点是否由本扩展产生
 */
function isOwnNode(node) {
  if (node.id === 'dyb-dialog-root' || node.id === 'dyb-status-bar') return true;
  if (node.id === 'dyb-debug-panel' || node.id === 'dyb-debug-log') return true;
  if (node.classList && node.classList.contains('dyb-status')) return true;
  if (node.classList && node.classList.contains('dyb-badge')) return true;
  if (node.classList && node.classList.contains('dyb-clear-btn')) return true;
  if (node.classList && node.classList.contains('dyb-panel')) return true;
  if (node.classList && node.classList.contains('dyb-mask')) return true;
  if (node.closest && node.closest('.dyb-clear-btn')) return true;
  if (node.closest && node.closest('#dyb-dialog-root')) return true;
  if (node.closest && node.closest('#dyb-status-bar')) return true;
  if (node.closest && node.closest('#dyb-debug-panel')) return true;
  return false;
}

/**
 * 合并短时间内的多次触发
 */
let injectTimer = null;
function scheduleInject() {
  if (injectTimer) clearTimeout(injectTimer);
  injectTimer = setTimeout(() => {
    injectTimer = null;
    injectAllRows();
  }, 300);
}

/**
 * 本内容脚本当前落在哪类页面
 *
 * 脚本只随 /ffa/g/list 加载，但抖店是 SPA：切页不重载、脚本还活着。
 * 「清空库存」按钮的定位几何按页面而定 —— 商品管理列表认「总库存」列，
 * 渠道品列表认「库存」列且只注独立库存的渠道品（共享库存的行不注），
 * 其他页面一律不注（渠道品页实测：注了必歪，且从未可用）。
 * ⇒ 路由切换时按页面类型摘旧注新（2026-10-23 用户报渠道品歪按钮后立此闸门）。
 */
function pageType() {
  const p = location.pathname;
  if (p === '/ffa/g/list') return 'list';
  if (p === '/ffa/g/channel-goods-manage/list') return 'channel';
  return 'other';
}

function onListPage() {
  return pageType() === 'list';
}

function onChannelPage() {
  return pageType() === 'channel';
}

/**
 * 扫描并注入所有商品行
 * @returns {number} 本次新注入的数量
 */
function injectAllRows() {
  let count = 0;

  if (onListPage()) {
    const products = findProductRows();
    for (const item of products) {
      if (!item.row || !item.editButton) continue;
      if (injectedRows.has(item.row)) continue;

      if (injectClearButton(item.row, item.editButton)) {
        injectedRows.add(item.row);
        count++;
      }
    }
  }

  // 渠道品模块走命名空间导出(channel-stock.js 是 IIFE),裸函数名不存在——
  // 曾因用裸名 + typeof 守卫把「没接上」静默吞掉,扫描十次全部空过(46e9354 插桩定位)。
  if (onChannelPage() && window.__DYC_CHANNEL_STOCK__ &&
      typeof window.__DYC_CHANNEL_STOCK__.injectChannelClearButtons === 'function') {
    count += window.__DYC_CHANNEL_STOCK__.injectChannelClearButtons();
  }

  return count;
}

/**
 * 重置注入记录
 * 路由切换后旧行节点已被销毁，必须清空记录让新行能重新注入
 */
function resetInjection() {
  injectedRows = new Set();
}

/**
 * 监听 SPA 路由变化
 * 抖店切换页面时不触发 popstate，用 URL 轮询兜底
 */
function watchRouteChange() {
  let lastUrl = location.href;
  let lastPageType = pageType();

  if (routeTimer) clearInterval(routeTimer);

  routeTimer = setInterval(() => {
    if (location.href === lastUrl) return;

    lastUrl = location.href;
    resetInjection();

    // 页面类型切换（列表 ⇄ 渠道品 ⇄ 其他）：旧按钮全部摘掉，注入记录重置。
    // 同页筛选/翻页（类型不变）不动按钮 —— 已注入的行由 DOM 幂等检查兜住。
    const t = pageType();
    if (t !== lastPageType) {
      lastPageType = t;
      try {
        if (typeof removeAllClearButtons === 'function') removeAllClearButtons();
      } catch (e) { /* 摘除失败不影响导航 */ }
    }
    if (t !== 'other') scheduleInject();

    for (const fn of routeListeners) {
      try {
        fn(location.href);
      } catch (e) {
        console.warn('[DYB] 路由回调出错', e);
      }
    }
  }, 1000);
}

/**
 * 注册路由变化回调
 */
function onRouteChange(fn) {
  routeListeners.add(fn);
}

/**
 * 停止监听（弹窗里把「商品库存清零」开关拨到关闭时调用）
 *
 * 必须真停：只把按钮删掉而留着 MutationObserver，
 * 下一批商品行渲染出来时又会把按钮补回去，开关等于没关。
 *
 * 三个句柄都要清：观察器、路由轮询、以及已排队待执行的注入。
 */
function stopRowWatcher() {
  if (observer) {
    observer.disconnect();
    observer = null;
  }
  if (routeTimer) {
    clearInterval(routeTimer);
    routeTimer = null;
  }
  if (injectTimer) {
    clearTimeout(injectTimer);
    injectTimer = null;
  }
}