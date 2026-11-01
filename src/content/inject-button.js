/**
 * 按钮注入
 *
 * 插入位置：行内「总库存」列的单元格里（用户指定位置），数字下方。
 *
 * 定位方式（2026-10-14 改，修 #73「按钮歪的」）：按表头 cellIndex 找到本行
 * 对应的单元格，把按钮作为**文档流内的子节点**塞进去 —— 位置交给平台的
 * 表格布局决定，不算坐标、不加绝对定位。旧版靠「表头中心 + 硬编码 76px」
 * 算绝对坐标，列宽/缩放/字体一变就偏，已废弃。
 * 结构不是表格时退回「插在编辑之前」的兜底路径（同为文档流）。
 */

const BUTTON_CLASS = 'dyb-clear-btn';

/**
 * 为商品行注入清空库存按钮
 * @param {Element} row 商品行
 * @param {Element} editButton 该行的编辑按钮（备用锚点）
 * @returns {boolean} 是否注入成功
 */
function injectClearButton(row, editButton) {
  if (!row || row.querySelector('.' + BUTTON_CLASS)) return false;
  if (!row.isConnected) return false;

  const button = document.createElement('button');
  button.className = BUTTON_CLASS;
  button.type = 'button';
  button.textContent = '清空库存';
  button.title = '将该商品所有规格的普通库存清零';

  button.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    handleClearStockClick(row);
  });

  // 首选：定位到总库存列下方
  if (insertBelowStockColumn(row, button)) return true;

  // 兜底一：插在「编辑」之前
  if (insertBeforeEdit(row, editButton, button)) return true;

  // 兜底二：插在「下架」之前
  if (insertBeforeOffline(row, button)) return true;

  row.appendChild(button);
  return true;
}

/**
 * 清空库存按钮的即时结果反馈（2026-10-29）
 *
 * 用「勾 / 叉」把结果放到按钮自己身上，2.5 秒后恢复文字 —— 与「粘贴加车」
 * 同一套观感（用户原话「给清空库存的按钮也加入类似的图案指示设计」）。
 *
 * 口径（后面加调用点时不许放宽）：
 *   · 只有**接口确认清零成功**才给勾（直提返回 ok / 渠道品 success === true）。
 *   · 「已提交保存，请核对库存」只证明点了保存，没回读落库 ⇒ **不给勾**，
 *     按钮保持文字，结论照旧进消息盒子。抢报比不报更坏（AGENTS 第 25 条第 4 条）。
 *   · 库存本来就是 0 的提前拦截不是失败，不给叉。
 *   · 反馈期间按钮不接点击：清零会真改平台数据，连点两次就是两次提交。
 *
 * 按钮被页面重渲染销毁时，定时器里的节点已脱离文档 —— 恢复前先判 isConnected，
 * 不往幽灵节点上写文字。
 *
 * @param {Element} row 商品行（按钮带 .dyb-clear-btn，在它的总库存格里）
 * @param {'ok'|'fail'} result 结果档位
 */
function clearStockFeedback(row, result) {
  if (!row || !row.isConnected) return;

  let button = null;
  try { button = row.querySelector('.' + BUTTON_CLASS); } catch (e) { button = null; }
  if (!button) return;

  // 第一次反馈前记住按钮原文与悬停说明：普通商品与渠道品的 title 不同，
  // 恢复时不能写死成商品列表那一句。
  if (!button._dycClearText) {
    button._dycClearText = button.textContent;
    button._dycClearTitle = button.title;
  }
  if (button._dycClearTimer) clearTimeout(button._dycClearTimer);

  const ok = result === 'ok';
  const label = ok ? '库存已清零' : '清零失败';
  button.classList.toggle('dyc-clear-ok', ok);
  button.classList.toggle('dyc-clear-fail', !ok);
  button.setAttribute('aria-label', label);
  button.setAttribute('title', label);
  button.style.pointerEvents = 'none';
  button.innerHTML =
    '<svg class="dyc-clear-result" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">' +
    '<path d="' + (ok ? 'M5 12l5 5L19 7' : 'M6 6l12 12M18 6L6 18') + '" fill="none" ' +
    'stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  button._dycClearTimer = setTimeout(function () {
    button._dycClearTimer = null;
    if (!button.isConnected) return;
    button.classList.remove('dyc-clear-ok', 'dyc-clear-fail');
    button.removeAttribute('aria-label');
    button.style.pointerEvents = '';
    button.textContent = button._dycClearText || '清空库存';
    button.title = button._dycClearTitle || '';
  }, 2500);
}

/**
 * 移除页面上所有已注入的「清空库存」按钮
 *
 * 弹窗里把开关拨到关闭时调用，让已打开的页面立刻回到干净状态。
 * 只删按钮本身，不动任何平台元素 —— 按钮全部带 BUTTON_CLASS，
 * 选择器精确到类名，不会误伤抖店自己的节点。
 */
function removeAllClearButtons() {
  const nodes = document.querySelectorAll('.' + BUTTON_CLASS);
  for (const node of nodes) node.remove();
}

/**
 * 把按钮放进「总库存」列（文档流内，2026-10-14 修 #73）
 *
 * 旧写法：用「表头中心 X − 行左边界 − 硬编码按钮宽 76 / 2」算出绝对定位坐标，
 * 再给行容器加 position:relative 把按钮摆上去。用户报「按钮歪的」——
 * 这类写法的通病：列宽一变、页面一缩放、按钮实际宽度与 76 不符，立刻就偏。
 * （search.js 里「全能搜索」按钮的跑位教训同源：绝对定位的按钮，包含块会被
 *   平台的 transform 祖先劫走，反复错位，那条教训的结论是**改用文档流兄弟节点**。）
 *
 * 新写法不再算任何坐标：用表头的 cellIndex 找到该列在本行里的单元格，
 * 把按钮作为**文档流内的子节点**塞进去，位置交给平台自己的表格布局决定。
 * 结构不是表格时返回 false，交给下方「插在编辑之前」的兜底路径（同样是文档流）。
 */
function insertBelowStockColumn(row, button) {
  const headers = findAllByText('总库存', { exact: true });
  if (headers.length === 0) return false;

  const headerCell = (headers[0].closest && headers[0].closest('th, td')) || headers[0];
  const idx = headerCell.cellIndex;
  if (typeof idx !== 'number' || idx < 0) return false;

  // 行元素可能是 <tr>，也可能是包着 <tr> 的容器 —— 两种都认
  let tr = null;
  try {
    tr = (row.matches && row.matches('tr')) ? row : (row.closest ? row.closest('tr') : null);
  } catch (e) { tr = null; }
  if (!tr || !tr.cells || !tr.cells[idx]) return false;

  // 同表校验：多表格页面上别把按钮串到别的表里
  const headerTable = headerCell.closest && headerCell.closest('table');
  const rowTable = tr.closest && tr.closest('table');
  if (headerTable && rowTable && headerTable !== rowTable) return false;

  const cell = tr.cells[idx];
  if (cell.querySelector('.' + BUTTON_CLASS)) return false;   // 本格已放过

  const box = document.createElement('div');
  box.className = 'dyb-clear-slot';
  box.appendChild(button);
  cell.appendChild(box);
  return true;
}

/**
 * 兜底：插在「编辑」之前
 */
function insertBeforeEdit(row, editButton, button) {
  if (!editButton) return false;

  const textNode = resolveTextNode(editButton, '编辑');
  if (!textNode) return false;

  const anchor = textNode.closest('a, span, div, button') || textNode;
  if (!anchor.parentNode) return false;

  anchor.parentNode.insertBefore(button, anchor);
  return true;
}

/**
 * 把按钮插到「下架」之前
 * 二次兜底：确保落在操作列内
 */
function insertBeforeOffline(row, button) {
  const nodes = findAllByText('下架', { exact: true, root: row });
  if (nodes.length === 0) return false;

  const textNode = resolveTextNode(nodes[0], '下架');
  if (!textNode) return false;

  const anchor = textNode.closest('a, span, div, button') || textNode;
  if (!anchor.parentNode) return false;

  anchor.parentNode.insertBefore(button, anchor);
  return true;
}

/**
 * 定位包含指定文案的最小元素节点
 *
 * findAllByText 返回的是文本节点的父元素，可能是很大的容器。
 * 这里向下找到直接承载文字的那个节点，保证插入位置精确。
 */
function resolveTextNode(sourceNode, label) {
  let node = sourceNode;

  if (normalize(node.textContent) === label) return node;

  const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const textNode = walker.currentNode;
    if (normalize(textNode.textContent) !== label) continue;

    const parent = textNode.parentElement;
    if (parent && parent.children.length === 0) return parent;
  }

  return null;
}

/**
 * 处理按钮点击
 */
function handleClearStockClick(row) {
  const info = extractProductInfo(row);

  // 缺少商品标识时不允许继续，避免误操作
  if (!info.productId && !info.productCode && !info.title) {
    clearStockFeedback(row, 'fail');
    toast('没认出这个商品，已取消操作', 'error', { source: '库存清零' });
    return;
  }

  // 行内显示 0 时不直接拦（2026-10-29 反馈 #124）：
  // 那个数字是从页面文本里解析出来的，区域库存 / 批次库存等形态可能读成 0。
  // 原来据此就 return，用户只会看到「库存已经没有了」，根本点不动清零。
  // 现在先问接口 —— 接口说没有才拦。
  if (info.totalStock === 0) {
    verifyZeroStockThenOpen(row, info);
    return;
  }

  openClearConfirm(row, info);
}

/**
 * 弹出清零确认框
 *
 * 风险必须在执行处明示（AGENTS 第 25 条）：不可撤销、直播中会让直播间下不了单。
 * 2026-10-30 用户定稿：砍掉「区域库存不受影响」那行（用户原话只留两句），
 * 末句改成「会导致直播间无法继续下单」。
 */
function openClearConfirm(row, info, extra) {
  const fields = [{ label: '商品名', value: info.title || '未识别' }];
  // 页面与接口对不上时把话说明白（2026-10-30 用户反馈「总库存已经是 0 还弹框」）：
  // 弹框本身是必要的 —— 说明有页面看不见的库存可清；但不说清就像在瞎问。
  if (extra && extra.note) fields.push({ label: '说明', value: extra.note });

  showConfirmDialog({
    title: '确认清空该商品库存？',
    fields: fields,
    warning:
      '此操作将把该商品所有规格的普通库存清零，执行后不可撤销。\n' +
      '若该商品正在直播中，会导致直播间无法继续下单。',
    confirmText: '确定清零',
    cancelText: '取消',
    danger: true,
    onConfirm: () => {
      startClearStock(row, info);
    }
  });
}

/**
 * 行内库存读成 0 时，先向接口确认真实库存（#124）
 *
 * 三种结果分开讲，不合并不猜：
 *   接口说有   → 行内那个 0 是解析偏差，照常弹确认框清下去
 *   接口说没有 → 报「库存已经没有了」，不展开编辑区
 *   接口查不到 → 明说没读到，不让用户误以为「本来就没了」
 */
function verifyZeroStockThenOpen(row, info) {
  const direct = window.__DYC_STOCK_DIRECT__;
  const probe = direct && direct.probeStockTotal;

  if (typeof probe !== 'function' || !info.productId) {
    toast('库存已经没有了', 'info', { source: '库存清零' });
    return;
  }

  probe(info.productId).then(function (real) {
    if (real > 0) {
      if (typeof debugLog === 'function') {
        debugLog('行内库存读成 0，接口实际 ' + real + '，继续清零');
      }
      openClearConfirm(row, info, {
        note: '页面这里显示 0，接口查到还有 ' + real + '（区域 / 批次等不显示在列表里的库存），要清的就是这部分'
      });
      return;
    }
    if (real === 0) {
      toast('库存已经没有了', 'info', { source: '库存清零' });
      return;
    }
    toast('没能读到库存明细，请刷新页面后重试', 'warning', { source: '库存清零' });
  });
}