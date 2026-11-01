/**
 * 数据大屏「商品」页签 —— 商品名完整展示 + 「货号」快速复制
 * ============================================================
 * 【作用页(用户 2026-10-30 定)】
 *   电商罗盘 · 直播大屏（专业版）  https://compass.jinritemai.com/screen/live/*
 *   页面路径形如 /screen/live/talent?live_room_id=…#product
 *   （#product 是页签 hash，抖店侧 /screen/live/shop 同样适用 —— 本文件只认结构不认 hash。）
 *   用户原话：「数据大屏这里也加入名称完整展示的功能和快速复制款号的功能，
 *   从之前做好的模式搬过来兼容就可以了」。
 *
 * 【两件事,与既有三页同一口径】
 *   ① 商品名**完整展示** —— 平台把名称截成一行(或两行)带省略号,这里解除截断,
 *      让名称在单元格内自然折行；不改列宽、不加横向滚动。
 *   ② 名称块下方一枚**「货号」按钮** —— 点一下把款号写进剪贴板,按钮原地闪
 *      「已复制」；取不到闪「无货号」,**绝不复制半截内容**。
 *
 * 【为什么单独一个文件,而不是复用 live-detail.js / compass-table.js】
 *   取号规则、取值防污染、按钮三态、展开手法全部照搬,但**文件独立**,三个理由:
 *     · 行结构不同 —— 直播明细是 3~4 列的窄表；罗盘商品表是 10~12 列宽表；
 *       大屏是 **8 列、首列 300px 放商品信息**（用户 2026-10-30 交来的结构报告可证：
 *       `tbody.ecom-table-tbody` → `tr.ecom-table-row.ecom-table-row-level-0`，
 *       首行是 `tr.ecom-table-measure-row` 高度 0，滚动体 `div.ecom-table-body`
 *       固定高 724 / 内容 4234，**非虚拟滚动**，51 行一次性渲染）。
 *       各页的结构判据写在一个文件里，任何一侧改版都会牵连另外两侧。
 *     · 按钮落点不同 —— 大屏用户选「名称块下方、右对齐」（甲案），
 *       与直播明细的落点一致；而罗盘商品表是「绝对定位徽标 + 名称底部预留空白」
 *       （那套为它 8 轮迭代出来的坐标规则，搬到结构不同的页面必算错）。
 *     · **要能单独关掉** —— 新页面第一次上，万一结构不符，关一个开关只停这一页，
 *       其余三页功能完全不受影响。
 *
 * 【名称元素怎么找 —— 三级判据,越往后越保守】
 *   ① **类名前缀**：罗盘整站同一套业务组件，直播明细实测 `p.productName-*`。
 *      这里依次认 productName- / goodsName- / itemName- / productTitle-，
 *      命中且带直接文本就用。
 *   ② **缩略图所在单元格**：商品行必有缩略图。先找含 <img> 的 <td>，
 *      在其中挑「带直接文本、像商品名、文本最长」的元素。
 *      这一档比「整行挑最长」可靠得多 —— 右侧全是数字列，类目 / 提示语
 *      可能比商品名更长（直播明细 #88/#85 的教训）。
 *   ③ **整行兜底**：前两档都空时，整行挑「最长且像商品名」的元素。
 *   ✅ 真机诊断日志会打印「哪一档命中的」，改版时看一行日志就知道该收紧哪一档。
 *
 * 【名称怎么「扩展」—— 三件事缺一不可(2026-10-18 罗盘商品表的真机教训)】
 *   ① 平台截断规则本身带 `!important`（CSS Modules）⇒ 内联必须也带 important，
 *      一律走 `setProperty(p, v, 'important')`；
 *   ② 钳制常常落在**祖先层**（外层 wrap 定高 + overflow:hidden）⇒ 名称元素
 *      连同最近 5 层祖先一起放开（祖先只放开 clamp / max-height / height /
 *      overflow / 收缩相关几条，**不动 width / display / position** —— 那是列宽，
 *      动就崩版）；
 *   ③ `-webkit-box-orient: initial` 对 line-clamp 无效 ⇒ 名称一律 `display:block`。
 *   展开后还有一道**防重叠**保险：盒子没跟着长高就把 overflow 收回 hidden ——
 *   **重叠比省略号更糟**（省略号只是信息不全，重叠会让人读错下面的 ID）。
 *
 * 【按钮落点（用户 2026-10-30 选「甲」：名称块下方、右对齐）】
 *   插进**商品信息单元格（<td>）末尾**，块级 + 固定宽 56px + `margin-left:auto`
 *   ⇒ 自然落在整个商品信息块的最下一行、贴右边缘。
 *   为什么不插在名称元素之后：名称的父容器常是 flex（缩略图 + 文本块），
 *   插进去会被当成 flex 子项横排到名字右边，把名字挤窄。
 *   为什么不绝对定位：不需要量坐标，也就没有「坐标算错 / 被裁切 / 随列宽漂移」
 *   这一整类问题（罗盘商品表为坐标迭代了 8 轮）。
 *
 * 【取号优先级 —— 三档,与中控台 / 直播明细 / 罗盘商品表一字不差】
 *   ① 官方货号：单元格里若有平台写出的「货号 xxx」，直接用；
 *      单元格里读不到「货号」二字才退整行。最可靠。
 *   ② 名称尾部推算：名称末尾「≥4 位且含数字」的字母数字串（NE1C0021W / 10157）。
 *      ⚠️ 这是**推算**，不是平台数据；名称末尾不是款号时取不到，不瞎猜。
 *   ③ 两档都空 → 按钮闪「无货号」，**绝不复制半截内容**。
 *
 * 【取值输入必须剔除「我们自己」—— AGENTS 第 23 条,硬规则】
 *   绝不直接 `row.innerText` 做「标签 + 值」正则：我们自己注入的按钮文案
 *   （「货号」/「已复制」/「无货号」）会被算成页面数据。反馈 #96 就是这么把
 *   右列「成交件数 340」复制成货号的 —— 而且只在 100~999 时出错，
 *   因为官方货号正则的量词恰好是 {3,30}。
 *   一律走 `textWithoutExt(root)`，判据是 `data-*` 结构标记而不是按钮文案。
 *
 * 【消息提示（AGENTS 第 21 条三段式）】
 *   来源词复用「货号复制」（同一功能语义，不另造词），`keepHistory:false`
 *   —— 复制是高频操作，全收进消息盒子会把历史刷满；按钮本身闪的「已复制」
 *   已是第一反馈，消息条只兜「视线不在按钮上」那一种。
 *
 * 【2026-10-30 真机反馈三项调整（两轮截图：名字折 3~4 行、按钮先小后空）】
 *   ① **名称区加宽**：首列 300px 里缩略图占约 70px，名称只剩约 200px ⇒
 *      把「缩略图 + 文字块」这一层由 flex 改块级、缩略图左浮动，文字环绕 ——
 *      第一行仍避让缩略图，**第二行起吃满整格**。
 *      第二轮再压：缩略图 60 → 48、间距 10 → 6、单元格左右内边距收到 8px，
 *      第一行可用宽度从约 200 回到约 246，两行合计约 530px（约 38 字）。
 *      详情与边界见「四之二」小节；不动列宽（列宽是平台 colgroup 定的）。
 *   ② **按钮尺寸**：56×20/12px（太小）→ 80×28/13px（留白太多）→ 定稿
 *      **64×26 / 13px**：「已复制」三字约 39px + 边框 + 左右各 11px，
 *      贴边不挤，也不再有 26px 的左右空档。大屏深底、远看，字号保持 13px。
 *
 * 【刷新与重绘】
 *   大屏表格是固定滚动体（`div.ecom-table-body` 高 724 / 内容 4234），行不重建、
 *   非虚拟滚动 ⇒ 全量处理即可，不需要逐屏补。但切页签、改筛选、换时间范围
 *   都会整块重建 tbody，所以仍用 MutationObserver 补涂：
 *   **当帧 rAF 补涂 + 300ms 尾扫**（省略号来不及画）+ 首屏三次兜底。
 *   只扫 `tbody tr`（51 行量级），不做全页通配查询。
 *
 * 【开关】flags.js 的 `liveScreenPolish`「直播大屏商品名优化」（抖店大类，默认开）。
 *   用户 2026-10-31 定名与范围：「这个开关叫做【直播大屏商品名优化】，
 *   功能就是三个：名称完整展示，快捷复制货号，去掉黑幕。归属于抖店的大类」。
 *   关掉即时生效：摘观察器 + 移除按钮 + 还原名称与祖先的内联样式 + 把气泡放回来。
 * ============================================================
 */

(function dycLiveScreenCopyCode() {
  'use strict';

  // 防重复注入(SPA 路由回切、脚本意外重跑时不叠按钮)
  if (window.__dycLiveScreenCopyCodeLoaded) return;
  window.__dycLiveScreenCopyCodeLoaded = true;

  var BTN_CLASS = 'dyc-ls-btn';
  var STYLE_ID = 'dyc-ls-style';

  // 名称元素:已展开 / 平台原内联值备份
  var MARK = 'data-dyc-ls-expand';
  var MARK_ORIG = 'data-dyc-ls-expand-orig';
  // 祖先链:备份 / 已处理
  var MARK_CHAIN = 'data-dyc-ls-chain-orig';
  var MARK_CHAINED = 'data-dyc-ls-chained';
  // 行(TR):只放高度的单独一套备份
  var MARK_ROW = 'data-dyc-ls-row-orig';

  var NAME_MAX_SCAN = 200;   // 单行最多扫这么多节点，防异常结构拖慢
  var CHAIN_MAX = 5;         // 祖先链最多往上走几层

  /* ---------- 依赖自检(flags.js / dialog.js 必须先加载) ---------- */
  if (typeof dycReadFlags !== 'function' || typeof dycWatchFlags !== 'function') {
    return;
  }

  var flags = null;
  var observer = null;
  var pending = false;
  var tailTimer = null;

  function enabled() {
    return !!flags && flags.liveScreenPolish !== false;
  }

  /* ==========================================================
   * 〇、调试日志
   *
   * 新页面第一次上，用户报「没生效」时，必须能一眼看出卡在哪一环：
   * 是 manifest 没注入？是没找到表格？是名称判据断了？还是样式被压住了？
   * 四件事四种修法，猜错就改错地方。
   * 只记**结构与长度**，不记经营数据（商品名截 20 字，价格/销量一律不记）。
   * ========================================================== */

  var LOG_PREFIX = '[大屏货号]';
  var logPending = null;
  var logTimer = null;
  var LOG_MERGE_MS = 800;

  function emitLog(msg, n) {
    try {
      if (typeof window.debugLog === 'function') {
        window.debugLog(LOG_PREFIX + ' ' + msg + (n > 1 ? '（×' + n + '）' : ''));
      }
    } catch (e) { /* 日志失败绝不能影响主流程 */ }
  }

  function flushLog() {
    if (logTimer !== null) { clearTimeout(logTimer); logTimer = null; }
    if (!logPending) return;
    emitLog(logPending.msg, logPending.n);
    logPending = null;
  }

  /** 写一条日志；连续相同的消息合并成「×N」（否则 51 行同一句会把有用信息挤没） */
  function dbg(msg) {
    if (logPending && logPending.msg === msg) {
      logPending.n++;
    } else {
      flushLog();
      logPending = { msg: msg, n: 1 };
    }
    if (logTimer === null) logTimer = setTimeout(flushLog, LOG_MERGE_MS);
  }

  /** 文本截断到 20 字（只用于日志，不进任何画面） */
  function clip(s) {
    s = String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
    return s.length > 20 ? s.slice(0, 20) + '…' : s;
  }

  /* ==========================================================
   * 一、样式
   *
   * 只有按钮本体进样式表；名称的「解截断」一律写**逐元素内联** ——
   * 要不要展开取决于「这一行到底截没截断」，CSS 做不到这个判断。
   * ========================================================== */

  var CSS = [
    '.' + BTN_CLASS + ' {',
    '  all: initial;',
    // 块级 flex：① 内容居中；② 作为块级盒子，`margin-left:auto` 能把它推到右侧。
    '  display: flex; align-items: center; justify-content: center;',
    // 宽高固定：文案在「货号 / 已复制 / 无货号」之间切换，长度不同 ——
    // 宽度一定，flash 只换文字与配色，相邻元素不会被推挤。
    //
    // 【尺寸变迁（两天两轮真机反馈）】
    //   · 第一版 56×20 / 12px：沿用中控台那枚 ⇒ 用户「太小了」；
    //   · 第二版 80×28 / 13px ⇒ 用户「留白太多了」——问题不在小，而在**框大字数少**：
    //     「货号」两个字 26px，塞进 80px 的框里，左右各空 26px，看着就是一个空盒子。
    //   · 现在 64×26 / 13px：「已复制」三个字约 39px + 2px 边框 + 左右各 11px 内边，
    //     刚好贴边不挤；比第一版仍大一圈（高 20→26），但不再有大片空档。
    '  width: 64px !important; height: 26px !important;',
    '  min-height: 0 !important; max-height: 26px !important; padding: 0 !important;',
    '  line-height: 1;',
    // 兜底落点：名称块下方、右对齐（用户 2026-10-30 选「甲」）。
    '  margin: 4px 0 0 auto !important;',
    // 【2026-10-31 真机：按钮落在列中间而不是右侧】
    //   真机截图里按钮水平居中 —— 说明它的父级是「纵向 flex + align-items:center」
    //   一类的容器，`margin-left:auto` 在这种父级下不一定把人推到右边。
    //   补一条 `align-self:flex-end`：纵向 flex 里它管水平轴，直接把按钮顶到右侧；
    //   非 flex 父级里这条无副作用（block 布局下 align-self 被忽略）。
    '  align-self: flex-end !important;',
    // 锁宽：插进平台的 flex 容器后 `all: initial` 会把 flex-shrink 重置成 1，
    // 空间不足时按钮被压扁（#88 真机实测宽 48px）。非 flex 容器里无副作用。
    '  flex: 0 0 auto;',
    '  border: 1px solid #0064d9; border-radius: 4px;',
    '  background: #fff; color: #0064d9;',
    "  font: 13px/1 -apple-system, 'Microsoft YaHei', sans-serif;",
    '  white-space: nowrap; cursor: pointer; box-sizing: border-box;',
    // 大屏底色可能是深色 / 表格底色偏灰 ⇒ 不透明度给满、底色用不透明浅蓝，
    // 比纯白底醒目，深浅背景下都看得清。关键视觉属性全部钉死，
    // 防平台更具体的选择器（如 `td button { opacity:.6 }`）盖掉我们。
    '  opacity: 1 !important;',
    '  background: #eaf3ff !important;',
    '  color: #0064d9 !important;',
    '  border-color: #0064d9 !important;',
    '  font-weight: 500 !important;',
    // 平台很多装饰层会设 `pointer-events:none`（让点击穿透到父级），
    // 按钮若落进那种容器就点不动；抬一层 + 恢复事件，两条都只作用于我们自己的按钮。
    '  pointer-events: auto !important;',
    '  position: relative; z-index: 1;',
    '  transition: background .15s, color .15s, border-color .15s;',
    '}',
    '.' + BTN_CLASS + ':hover { background: #0064d9 !important; color: #fff !important; }',
    // 按下即变（不等复制回调）—— clipboard 是异步的，按下到「已复制」之间
    // 有几十~几百毫秒空档，`:active` 提供第一层即时感；onTrigger 里还会同步
    // 补一个 `.is-press`（见 press()）：pointerdown 上我们调了 preventDefault，
    // 部分内核会把 `:active` 一起掐掉，那一层不能只靠伪类。
    '.' + BTN_CLASS + '.is-press { background: #0050b3 !important; color: #fff !important; border-color: #0050b3 !important; }',
    // 点击反馈只改**填充与字色**，边框宽度 / 圆角 / 宽高 / 字号一律不动 ——
    // 「已复制」不该看起来像换了一枚控件（罗盘商品表第二轮真机反馈的口径）。
    '.' + BTN_CLASS + '.is-ok { background: #0064d9 !important; color: #fff !important; border-color: #0064d9 !important; }',
    '.' + BTN_CLASS + '.is-err { background: #f2f3f5 !important; color: #86909c !important; border-color: #c9cdd4 !important; }',

    // ==========================================================
    // 【平台的「悬浮看全名」气泡 —— 2026-10-31 真机反馈要求删掉】
    //
    // 现象（用户原话）：「删掉这个浮动框，不然跟我的程序功能起到相悖的作用，
    //   想点按钮都点不动」。截图：鼠标经过商品名时，平台弹出一个深色圆角气泡，
    //   内容就是完整商品名，位置正好压在单元格右下角的「货号」按钮上。
    //
    // 两层矛盾：
    //   ① **重复**：名字已经由我们展开在单元格里了，再弹一层同样的全文是纯冗余；
    //   ② **挡点击**：气泡盖住按钮，鼠标一移过去就被它接住，按钮点不动。
    //
    // 两条一起上（各自独立生效，谁命中都能解决「点不动」）：
    //   · 隐藏气泡本体 —— 由 JS 精确判定后写内联 `display:none`
    //     （见「六、平台气泡」小节：必须在表格行之外、必须是定位浮层、
    //       必须不含可交互元素，才动手）；
    //   · 无论认没认出来，**这类浮层一律不接收鼠标事件** —— 即使哪天平台换了
    //     类名、换了个气泡，也不会再挡住按钮上的点击。
    // ⚠️ 绝不用 `[class*="tooltip"]` 这类通配去藏：触发源那一层有时也带同类名，
    //    通配会把商品名本身一起藏掉（比原问题更严重）。
    // ==========================================================
    '[role="tooltip"], .ecom-tooltip, .ecom-tooltip-inner, .ecom-tooltip-content,',
    '.ecom-tooltip-arrow, .ecom-bubble, .auxo-tooltip, .auxo-tooltip-inner',
    '  { pointer-events: none !important; }'
  ].join('\n');

  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    var st = document.createElement('style');
    st.id = STYLE_ID;
    st.textContent = CSS;
    (document.head || document.documentElement).appendChild(st);
  }

  function removeStyle() {
    var st = document.getElementById(STYLE_ID);
    if (st) { try { st.remove(); } catch (e) { /* 尽力而为 */ } }
  }

  /* ==========================================================
   * 二、取值:剔除扩展自己注入的节点(AGENTS 第 23 条)
   * ========================================================== */

  /**
   * 扩展注入节点的标记。**凡是这些子树里的文本,一律不算页面数据。**
   * 判据是**结构标记**(认 data-* 属性),不是按钮文案 ——
   * 以后按钮改名成「库存」「销量」都不会再污染取值。
   *
   * ⚠️ 用 getAttribute 逐个判,不用 Element.matches —— 老内核
   *    (360 极速浏览器 X)上 matches 的行为曾因内核版本而异。
   */
  var EXT_MARKS = ['data-dyc-ls-btn', 'data-dyc-ct-btn', 'data-dyc-ld-btn',
                   'data-dyc-code-btn', 'data-dyc-idbtn'];

  function isExtNode(el) {
    if (!el || !el.getAttribute) return false;
    for (var i = 0; i < EXT_MARKS.length; i++) {
      if (el.getAttribute(EXT_MARKS[i]) !== null) return true;
    }
    return false;
  }

  /**
   * 取元素的「纯页面文本」:遍历文本节点,整棵跳过扩展注入的子树。
   * 不用 innerText / textContent —— 两者都会把我们自己画的按钮文案算进去。
   */
  function textWithoutExt(root) {
    if (!root) return '';
    var parts = [];
    try {
      var walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
        acceptNode: function (n) {
          if (n.nodeType === 1) {
            return isExtNode(n) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_SKIP;
          }
          return NodeFilter.FILTER_ACCEPT;
        }
      });
      var n;
      while ((n = walker.nextNode())) parts.push(n.nodeValue || '');
    } catch (e) {
      return '';   // 读不到宁可走名称末尾推算，也不复制错东西
    }
    return parts.join(' ').replace(/\s+/g, ' ').trim();
  }

  /** 名称元素向上找最近的 <td>(商品信息单元格);找不到退回父元素 */
  function infoCellOf(nameEl) {
    var el = nameEl;
    var guard = 0;
    while (el && guard++ < 12) {
      if (el.tagName === 'TD') return el;
      el = el.parentElement;
    }
    return (nameEl && nameEl.parentElement) || nameEl;
  }

  /* ---------- 款号识别(三档) ---------- */

  /** 像款号吗:3~30 位的字母数字/连字符/下划线 */
  function isCodeLike(s) {
    return !!s && /^[A-Za-z0-9][A-Za-z0-9\-_]{2,29}$/.test(s);
  }

  /**
   * ① 官方货号:在**剔除扩展节点**后的文本里找「货号 xxx」。
   * ⚠️ 绝不可直接读 row.innerText —— 自家按钮文案会被当成平台字段(#96)。
   */
  function readOfficialCode(row, nameEl) {
    try {
      var cell = infoCellOf(nameEl || null);
      var t = textWithoutExt(cell);
      // 单元格里没有「货号」二字时，再退整行（两处都已剔除扩展节点）
      if (!/货号/.test(t)) t = textWithoutExt(row) || t;
      if (!t) return '';
      var m = t.match(/货号\s*[:：]?\s*([A-Za-z0-9\-_]{3,30})/);
      if (m && isCodeLike(m[1])) return m[1];
    } catch (e) { /* 尽力而为 */ }
    return '';
  }

  /**
   * ② 名称尾部推算:末尾「≥4 位且含数字」的字母数字串。
   *    必须含数字 —— 纯英文字尾多半不是款号。
   */
  function guessFromName(nameEl) {
    var t = (nameEl && (nameEl.textContent || '') || '').replace(/\s+/g, ' ').trim();
    if (!t) return '';
    var m = t.match(/([A-Za-z0-9][A-Za-z0-9\-_]*)\s*$/);
    if (!m) return '';
    var cand = m[1];
    if (cand.length < 4) return '';
    if (!/\d/.test(cand)) return '';
    return cand;
  }

  /** 取款号 → {code, from:'official'|'guess'|'none'} */
  function readCode(row, nameEl) {
    var official = readOfficialCode(row, nameEl);
    if (official) return { code: official, from: 'official' };
    var guessed = guessFromName(nameEl);
    if (guessed) return { code: guessed, from: 'guess' };
    return { code: '', from: 'none' };
  }

  /* ---------- 复制(含降级) ---------- */

  function fallbackCopy(text) {
    try {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.top = '-1000px';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      var ok = document.execCommand('copy');
      ta.remove();
      return ok;
    } catch (e) {
      return false;
    }
  }

  function copyText(text, done) {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(
          function () { done(true); },
          function () { done(fallbackCopy(text)); }
        );
        return;
      }
    } catch (e) { /* 落到兜底 */ }
    done(fallbackCopy(text));
  }

  /** 弹一条消息提示(第 21 条三段式:来源 ｜ 值 ｜ 结果数);不进消息盒子 */
  function say(message, type) {
    try {
      if (typeof toast === 'function') {
        toast(message, type, { keepHistory: false, source: '货号复制' });
      }
    } catch (e) { /* 消息条不在也不影响复制本身 */ }
  }

  /* ==========================================================
   * 三、名称元素识别(三级判据)
   * ========================================================== */

  /**
   * 「不像商品名」的黑名单。
   * 大屏比其它页多一批**指标词**（成交/点击/曝光…）—— 右侧列的**标签**若被
   * 当成候选，它可能比商品名还长。值本身是数字，已由 ONLY_NUM 挡掉；
   * 这里再挡一层带文字的指标名。
   */
  var NOT_NAME = /^(到手价|售出|已售|库存|货号|规格|设置卖点|未设提词|销量|商品ID|商品 ID|ID|累计|占比|曝光|点击|成交|退款|支付|客单|转化|观看|进入|离开|涨粉|互动|排名|金额|件数|人数|次数)/;
  var ONLY_NUM = /^[\d\s.,::%\-+()（）#¥￥]+$/;
  /** 平台提示语（不是商品名）：无库存行会多渲染一句，比商品名更长 */
  var HINT_TEXT = /无库存|不可购买|已下架|已售罄|暂不支持|无法购买|讲解中/;

  function hasDirectText(el) {
    if (!el || !el.childNodes) return false;
    var nodes = el.childNodes;
    for (var i = 0; i < nodes.length; i++) {
      if (nodes[i].nodeType === 3 && String(nodes[i].nodeValue || '').trim()) return true;
    }
    return false;
  }

  function looksLikeName(text) {
    var t = String(text || '').trim();
    if (t.length < 4 || t.length > 200) return false;
    if (ONLY_NUM.test(t)) return false;
    if (NOT_NAME.test(t)) return false;
    if (HINT_TEXT.test(t)) return false;
    return true;
  }

  /** 在给定范围内挑「带直接文本、像商品名、文本最长」的元素 */
  function pickNameIn(scope) {
    if (!scope) return null;
    var cands;
    try {
      cands = scope.querySelectorAll('span, div, p, a, em, b, i, strong');
    } catch (e) {
      return null;
    }
    var best = null;
    var bestLen = 0;
    var limit = Math.min(cands.length, NAME_MAX_SCAN);
    for (var i = 0; i < limit; i++) {
      var el = cands[i];
      if (isExtNode(el)) continue;
      if (!hasDirectText(el)) continue;
      var t = String(el.textContent || '').trim();
      if (!looksLikeName(t)) continue;
      if (t.length > bestLen) { best = el; bestLen = t.length; }
    }
    return best;
  }

  /** 行内含缩略图的 <td>(商品信息单元格);没有返回 null */
  function imageCellOf(row) {
    var tds = null;
    try { tds = row.querySelectorAll('td'); } catch (e) { return null; }
    for (var i = 0; i < tds.length; i++) {
      var hit = null;
      try { hit = tds[i].querySelector('img'); } catch (e2) { hit = null; }
      if (hit) return tds[i];
    }
    return null;
  }

  var hitLevel = '';   // 上一轮名称是第几档命中的（只用于日志）

  /**
   * 找一行的商品名元素。
   * @return {Element|null} 找不到返回 null（调用方跳过这一行，不乱插按钮）
   */
  function findNameEl(row) {
    if (!row) return null;

    // ① 类名前缀(罗盘同一套业务组件;直播明细实测为 p.productName-*)
    var prefixes = ['productName-', 'goodsName-', 'itemName-', 'productTitle-'];
    for (var p = 0; p < prefixes.length; p++) {
      var hit = null;
      try { hit = row.querySelector('[class*="' + prefixes[p] + '"]'); } catch (e) { hit = null; }
      if (!hit || isExtNode(hit)) continue;
      if (hasDirectText(hit) && String(hit.textContent || '').trim().length >= 4) {
        hitLevel = '类名';
        return hit;
      }
      // 前缀命中的是外层容器(没有直接文本)时，往下挑一个带文本的
      var inner = pickNameIn(hit);
      if (inner) { hitLevel = '类名内层'; return inner; }
    }

    // ② 缩略图所在单元格 —— 商品行必有缩略图，这一档最可靠
    var cell = imageCellOf(row);
    var byCell = pickNameIn(cell);
    if (byCell) { hitLevel = '缩略图单元格'; return byCell; }

    // ③ 整行兜底
    var byRow = pickNameIn(row);
    hitLevel = byRow ? '整行兜底' : '未找到';
    return byRow;
  }

  /* ==========================================================
   * 四、名称展开
   *
   * 三件事缺一不可：!important、祖先一起放开、display 改 block。
   * 详见文件头「名称怎么扩展」。
   * ========================================================== */

  /**
   * 名称元素自己放开：`属性: 值` 列表，统一带 !important。
   * 顺序有意义 —— display 必须在 clamp 之前松开，否则 clamp 那两条不认。
   */
  var NAME_DECLS = [
    ['display', 'block'],
    ['-webkit-box-orient', 'horizontal'],
    ['-webkit-line-clamp', 'unset'],
    ['white-space', 'normal'],
    ['word-break', 'normal'],
    ['overflow-wrap', 'break-word'],
    ['text-overflow', 'clip'],
    ['max-height', 'none'],
    ['height', 'auto'],
    ['overflow', 'visible'],
    // 名称是 flex 子项时，父容器高度不足会把两行**压回**一行高。
    ['flex-shrink', '0'],
    ['flex-grow', '0'],
    // 名称若是 flex 子项且父容器定高，浏览器会用 align-items:stretch 把它
    // 拉成父容器那么高 —— 这时写 height:auto 无效（拉伸值覆盖它）。
    // align-self:flex-start 让这一格按自己的内容高度排，是唯一能治本的一条。
    ['align-self', 'flex-start'],
    // flex 子项默认 `min-width:auto`（不会缩到内容宽度以下）⇒ 永不换行；
    // 宽度没上限 ⇒ 一路往右长压到下一列。两条一起才有折行。
    ['min-width', '0'],
    ['max-width', '100%']
  ];

  /**
   * 祖先链要放开的属性。
   * ⚠️ 必须同时放开 height：只放 overflow 不放 height 会「把第二行放出来画在
   *    盒子外」，压在下面的元素上 —— 重叠比省略号更糟。
   * 依然不动 width / display / position —— 那是列宽与定位，动了整张表会崩。
   */
  var CHAIN_DECLS = [
    ['-webkit-line-clamp', 'unset'],
    ['max-height', 'none'],
    ['height', 'auto'],
    ['min-height', '0'],
    ['overflow', 'visible'],
    ['flex-shrink', '0'],
    ['min-width', '0'],
    ['max-width', '100%']
  ];

  /** 表格行(TR)只放开高度，绝不动 overflow —— 改它会影响表格行裁切语义 */
  var ROW_DECLS = [
    ['height', 'auto'],
    ['max-height', 'none']
  ];

  /** 祖先链走到这些层就停：改 TABLE / TBODY / BODY 真会崩整表 */
  var CHAIN_STOP = { TABLE: 1, TBODY: 1, THEAD: 1, BODY: 1, HTML: 1 };

  function chainDeclsFor(el) {
    return (el && el.tagName === 'TR') ? ROW_DECLS : CHAIN_DECLS;
  }

  /**
   * 备份一个元素上「我们将会覆盖」的那几个属性。
   * 已经备份过就不再覆盖 —— 否则第二次写会把**我们自己写的 important 值**
   * 存成「原值」，关开关时还原不回平台原样（name-wrap.js 踩过）。
   */
  function backupProps(el, mark, decls) {
    if (el.getAttribute(mark) !== null) return;
    var orig = {};
    for (var i = 0; i < decls.length; i++) {
      var p = decls[i][0];
      var v = el.style.getPropertyValue(p);
      if (v) orig[p] = { v: v, p: el.style.getPropertyPriority(p) };
    }
    try { el.setAttribute(mark, JSON.stringify(orig)); } catch (e) { /* 失败就按清空还原 */ }
  }

  /** 按备份还原（值空就 removeProperty，让平台样式重新接管） */
  function restoreProps(el, mark, decls) {
    var orig = {};
    try { orig = JSON.parse(el.getAttribute(mark) || '{}') || {}; } catch (e) { orig = {}; }
    for (var i = 0; i < decls.length; i++) {
      var p = decls[i][0];
      var o = orig[p];
      if (o && o.v) el.style.setProperty(p, o.v, o.p || '');
      else el.style.removeProperty(p);
    }
    el.removeAttribute(mark);
  }

  /** 写一条 !important 声明；值已一致就不写（避免触发平台 ResizeObserver 连环回调） */
  function setImp(el, prop, val) {
    if (el.style.getPropertyValue(prop) === val &&
        el.style.getPropertyPriority(prop) === 'important') {
      return false;
    }
    el.style.setProperty(prop, val, 'important');
    return true;
  }

  /** 是不是「行数钳制」那种布局（只有这种 display 下 line-clamp 才真裁） */
  function isBoxDisplay(cs) {
    var d = String(cs.display || '');
    return d === '-webkit-box' || d === '-webkit-inline-box';
  }

  /** 读计算后的 line-clamp（新老写法都试） */
  function clampOf(cs) {
    return cs.webkitLineClamp || (cs.getPropertyValue && cs.getPropertyValue('-webkit-line-clamp'));
  }

  /**
   * 名称是不是**比它所在的单元格还宽**。
   * 有些页面的名称不是「被小盒子裁掉」，而是**盒子被内容撑得比单元格还宽** ——
   * 自身 scrollWidth 干净，溢出发生在它和父容器之间。
   */
  function overflowsCell(el) {
    try {
      var td = el;
      var guard = 0;
      while (td && guard++ < 12 && td.tagName !== 'TD') td = td.parentElement;
      if (!td || !td.getBoundingClientRect) return false;
      var cr = td.getBoundingClientRect();
      var er = el.getBoundingClientRect();
      if (cr.width <= 0) return false;
      if (er.right > cr.right + 1) return true;
      if (er.width > cr.width + 1) return true;
      return false;
    } catch (e) {
      return false;
    }
  }

  /**
   * 平台真把这段文字截断了吗。
   * 判据放宽：横向溢出、纵向溢出、或计算出的 line-clamp 不是 none，三者任一。
   * 只看滚动尺寸的话，line-clamp 单行截断在「宽度刚好够」时 scrollWidth
   * 未必超 clientWidth ⇒ 漏判 ⇒ 那一行永远不展开。
   */
  function isCut(el) {
    try {
      if (el.clientWidth === 0 && el.clientHeight === 0) return true;   // 不可见：先展开
      if (el.scrollWidth - el.clientWidth > 0) return true;
      if (el.scrollHeight - el.clientHeight > 4) return true;
      var cs = getComputedStyle(el);
      if (isBoxDisplay(cs)) {
        var clamp = clampOf(cs);
        if (clamp && String(clamp) !== 'none' && String(clamp) !== '0') return true;
      }
      if (cs.whiteSpace === 'nowrap' && (cs.overflow === 'hidden' || cs.overflowY === 'hidden')) return true;
      if (overflowsCell(el)) return true;
      return false;
    } catch (e) {
      return false;
    }
  }

  /**
   * 「已展开」的复核（幂等双条件）。
   * 不能只看标记：平台重渲染会重写 style，标记却留下来。
   * 所以核对**计算值** —— 只要还是 nowrap / 还带 clamp / 还在横向截断，
   * 就当没处理过，重写一遍。
   */
  function stillExpanded(el) {
    try {
      var cs = getComputedStyle(el);
      if (cs.whiteSpace !== 'normal') return false;
      if (isBoxDisplay(cs)) return false;
      if (el.scrollWidth - el.clientWidth > 0) return false;
      if (el.scrollHeight - el.clientHeight > 4) return false;
      if (overflowsCell(el)) return false;
      var h = el.style.getPropertyValue('height');
      if (h === 'auto') return true;
      if (/^\d+(\.\d+)?px$/.test(h)) return el.scrollHeight - el.clientHeight <= 4;
      return false;
    } catch (e) {
      return false;   // 复核失败就当没处理过，重写一遍最安全
    }
  }

  /**
   * 展开后的最后一道保险：确认盒子真的长开了。
   *   · 长高了 → 保持 overflow:visible（正常展开，下面的元素被自然推开）；
   *   · 没长高 → 把 overflow 收回 hidden（宁可显示省略号，也绝不让文字压到别人身上）。
   * 取舍写在明处：**重叠比省略号更糟**。
   */
  function ensureNoOverlap(el) {
    try {
      var need = el.scrollHeight;
      var have = el.clientHeight;
      if (need - have <= 4) return true;          // 已经长开了

      // 第 1 招：直接把盒子撑到内容高度 —— 不依赖「谁在压」，一定生效。
      // 代价：高度是算出来的像素值，换行数变化时要重算（补涂会重新走这里）。
      setImp(el, 'height', need + 'px');
      if (el.scrollHeight - el.clientHeight <= 4) return true;

      // 第 2 招（兜底）：确实撑不开 —— 收回 overflow，宁可省略号也不重叠。
      setImp(el, 'height', 'auto');
      setImp(el, 'overflow', 'hidden');
      return false;
    } catch (e) {
      return true;   // 测不了就不动，保持现状
    }
  }

  /* ==========================================================
   * 四之二、加宽名称区（缩略图左浮动 ⇒ 第二行起吃满整格）
   *
   * 【为什么需要（2026-10-30 用户真机截图）】
   *   首列 300px 里缩略图占掉约 70px，名称区只剩约 200px —— 一条 30 字的
   *   商品名要折 3~4 行。用户要求「商品名宽度再长一些，尽量两行就展示完」。
   *   ⚠️ 只把名称元素自己的 max-width 放宽**没用**：挡住它的不是它自己的
   *      宽度限制，而是「缩略图 + 文字块」这一层 flex 横排里缩略图占的那一栏。
   *
   * 【做法】照罗盘直播明细页的「方案乙」（2026-10-15 真机验证过的形态）：
   *   把「缩略图 + 文字块」这一层由 flex 改成**块级**、缩略图改**左浮动** ——
   *   文字就环绕它：**第一行仍避让缩略图，第二行起吃满整格**。
   *   名称可用总宽从约 200×2=400px 涨到 200+300=500px，30 字的名字基本两行收口。
   *   容器加 `overflow:hidden` 是为了包含浮动（否则高度会塌陷、按钮会往上蹿）。
   *
   * 【为什么不改列宽】列宽由平台的 colgroup / table-layout 决定，且表格总宽
   *   固定 1545（8 列分摊）—— 改一列等于让右侧七个指标列全部重排。
   *   为了名字多几十像素去动整张表，风险不对等。
   *
   * 【2026-10-31 真机截图返工：光靠「找 flex 容器」没命中】
   *   日志里每行「改动 50 处」正好 = 名称 13 条 + 祖先链 5×8 条，**一次 float 都没做**；
   *   截图也证明名字仍卡在约 150px、右侧一大片空白。两个原因：
   *     ① 上一版只认 `display:flex` 的容器 —— 大屏这一页的那一层根本不是 flex；
   *     ② 名字与缩略图之间**还夹着各自写了固定宽度的中间层**，不逐层解开，
   *        就算浮动成功，文字块也只有 150px 宽。
   *   ⇒ 现在两条腿一起走：
   *     · `liberateWidth()`：名字到单元格之间的每一层都放开
   *       width / max-width / min-width / flex-basis / overflow / float ——
   *       不依赖任何布局假设，谁写了固定宽就解谁；
   *     · `applyWiden()`：找「**同时含缩略图与名字的最低公共祖先**」（不挑 display），
   *       改块级 + 缩略图那支左浮动并缩到 48px。
   *   ⚠️ 若这个祖先是 `<td>` 本身，**不改它的 display**（那是表格列，动就崩），
   *      只做「缩略图浮动 + 宽度链」这两件。
   *
   * 【必须能还原】
   *   · 四类写入各自备份、各自标记：容器（display / overflow）、
   *     缩略图那格（float / 宽度 / margin-right）、缩略图 <img>（限宽）、
   *     中间层（width 链）、单元格（左右内边距）。关开关逐项还原。
   *   · flex 的 `gap` 在块级布局下失效 ⇒ 给缩略图补 6px 右边距；
   *     它原本就带 margin-right 的不覆盖（以平台自己的间距为准）。
   *   · ⚠️ 同一个属性只能由一处负责。文字块的 width / overflow 归宽度链，
   *     不要再由「文字块」那套写一遍 —— 否则备份里会存下我们自己写的值，
   *     还原时把这些值又写回去（2026-10-31 自测抓到的真 bug）。
   * ========================================================== */

  var MARK_FLEX = 'data-dyc-ls-flex-orig';    // 缩略图容器：原内联值备份
  var MARK_FLEXED = 'data-dyc-ls-flexed';     // 缩略图容器：已改块级
  var MARK_IMG = 'data-dyc-ls-img-orig';      // 缩略图那格：原内联值备份
  var MARK_IMGED = 'data-dyc-ls-imged';       // 缩略图那格：已左浮动
  var MARK_IMGN = 'data-dyc-ls-imgn-orig';    // 缩略图 <img> 本身：原内联值备份
  var MARK_IMGND = 'data-dyc-ls-imgn-done';   // 缩略图 <img> 本身：已限尺寸
  var MARK_TD = 'data-dyc-ls-td-orig';        // 商品信息单元格：原内边距备份
  var MARK_TDED = 'data-dyc-ls-tded';         // 商品信息单元格：已收紧内边距
  var MARK_TXT = 'data-dyc-ls-txt-orig';      // 文字块：原内联值备份
  var MARK_TXTED = 'data-dyc-ls-txted';       // 文字块：已放开宽度

  /** 容器层：改块级 + 包含浮动 */
  var FLEX_DECLS = [
    ['display', 'block'],
    ['overflow', 'hidden'],
    // flex 横向时的 gap 在块级下失效，这里不补在容器上，而是补在缩略图右边距
    ['align-items', 'initial']
  ];
  /**
   * 缩略图所在的那一格：左浮动 + 缩径。
   *
   * 【2026-10-30 二改：缩到 48px（原约 60）】
   *   首列 300px 是平台定的死值，缩略图每多占 1px，名字第一行就少 1px。
   *   缩 12px + 间距 10→6 省 4px ⇒ 名字第一行多出约 16px（一个多字）。
   *   这是「两行放得下」里唯一不改变视觉结构的一档：
   *   再缩就要牺牲辨识度，加宽列宽又要动右侧七个指标列，都不划算。
   */
  var IMG_DECLS = [
    ['float', 'left'],
    ['margin-right', '6px'],
    ['flex-shrink', '0'],
    ['width', '48px'],
    ['min-width', '0'],
    ['max-width', '48px']
  ];
  /** 缩略图 <img> 本身：跟着外框缩，别让它按固有尺寸溢出到文字上 */
  var IMG_N_DECLS = [
    ['max-width', '100%'],
    ['height', 'auto'],
    ['max-height', '48px']
  ];
  /**
   * 商品信息单元格的左右内边距：收紧到 8px。
   *
   * 【为什么连这里也要动（2026-10-30 二改，「名称尽量放两行」的最后一档）】
   *   首列 300px 是死值，缩略图与间距已经压到 48+6，剩下的只有单元格内边距。
   *   平台一般在 td 上留 12~16px，两侧合计 24~32px —— 收到 8px 能再让出
   *   8~16px 给名字（约一个字）。
   *   ⚠️ 只作用在**商品信息那一格**，不动表头（th）也不动其它列；关开关逐项还原。
   *   代价：名字比原来更贴单元格边缘，视觉略紧 —— 这是「两行」必须付的宽度。
   */
  var TD_DECLS = [
    ['padding-left', '8px'],
    ['padding-right', '8px']
  ];
  /**
   * 文字块：放开宽度。
   * ⚠️ 不能写 `overflow:hidden` —— 那会让它成为 BFC，与浮动元素**错开**，
   *    文字就不环绕了（live-detail.js 的注释里记过这条）。
   */
  var TXT_DECLS = [
    ['width', 'auto'],
    ['max-width', 'none'],
    ['min-width', '0'],
    ['overflow', 'visible'],
    ['float', 'none']
  ];

  var MARK_W = 'data-dyc-ls-w-orig';          // 中间层：原内联值备份
  var MARK_WED = 'data-dyc-ls-wed';           // 中间层：已解开宽度
  /**
   * 中间层（名字与容器之间的每一层）要解开的宽度限制。
   *
   * 【为什么必须有这一步（2026-10-31 真机截图 + 日志复盘）】
   *   日志里每行「改动 50 处」正好等于「名称 13 条 + 祖先链 5 层 × 8 条 —— 没有多的」，
   *   说明上一版的加宽**根本没命中**，名字宽度仍卡在约 150px（截图里每行只有
   *   10 个字，右侧一大片空白）。根因是上一版只给「flex 容器的直接子」写
   *   width:auto —— 而大屏这一页名字与缩略图之间**还有几层各自写了固定宽度的容器**，
   *   不逐层解开，名字永远只能用那么宽。
   *
   *   四条都不改 display / position，只把「宽度上限」解开：
   *   · 本来就是 auto / 100% 的层 ⇒ 等价无变化；
   *   · 写死 px 或 flex-basis 的层 ⇒ 真正放开，名字随之吃满整格。
   *   ⚠️ 不写到 <td> 上（CHAIN_STOP 之外单独排除）—— td 的宽度就是列宽，
   *      动它会让整张表的列宽重排。
   */
  var W_DECLS = [
    ['width', 'auto'],
    ['max-width', 'none'],
    ['min-width', '0'],
    ['flex-basis', 'auto'],
    ['box-sizing', 'border-box'],
    // 文字块必须在其中：它若带 overflow:hidden 就成了 BFC，会与左浮动的缩略图
    // **错开**、文字不环绕（这条原来写在 TXT_DECLS 里，现并入本链，避免两套机制
    // 对同一元素重复写入 —— 重复写会让备份记下我们自己写的值，还原时写回不干净）。
    ['overflow', 'visible'],
    ['float', 'none']
  ];

  /**
   * 把「名字 → 边界」之间的每一层宽度限制解开。
   * @param {Element} el 名称元素
   * @param {Element} stopAt 边界（通常是 <td>，不含）
   * @return {number} 实际改动条数
   */
  function liberateWidth(el, stopAt) {
    var changed = 0;
    var up = el.parentElement;
    var depth = 0;
    while (up && depth++ < 6 && up !== stopAt && up.tagName !== 'TD' &&
           !CHAIN_STOP[up.tagName]) {
      backupProps(up, MARK_W, W_DECLS);
      for (var i = 0; i < W_DECLS.length; i++) {
        if (setImp(up, W_DECLS[i][0], W_DECLS[i][1])) changed++;
      }
      up.setAttribute(MARK_WED, '1');
      up = up.parentElement;
    }
    return changed;
  }

  /**
   * 把缩略图缩到 48px 并左浮动、文字块放开宽度。
   * 抽出来是因为「容器是 td」时只做这两件，不改 display。
   */
  function widenBranches(box, imgBox, img, td) {
    var i;
    backupProps(imgBox, MARK_IMG, IMG_DECLS);
    for (i = 0; i < IMG_DECLS.length; i++) setImp(imgBox, IMG_DECLS[i][0], IMG_DECLS[i][1]);
    // 平台原本就写过 margin-right ⇒ 用平台的间距，别被我们的 6px 顶掉
    var origImg = {};
    try { origImg = JSON.parse(imgBox.getAttribute(MARK_IMG) || '{}') || {}; } catch (e4) { origImg = {}; }
    if (origImg['margin-right'] && origImg['margin-right'].v) {
      setImp(imgBox, 'margin-right', origImg['margin-right'].v);
    }
    imgBox.setAttribute(MARK_IMGED, '1');

    // 缩略图本体：跟着外框缩，否则按固有尺寸溢出、压到名字上
    if (img && img !== imgBox) {
      backupProps(img, MARK_IMGN, IMG_N_DECLS);
      for (i = 0; i < IMG_N_DECLS.length; i++) setImp(img, IMG_N_DECLS[i][0], IMG_N_DECLS[i][1]);
      img.setAttribute(MARK_IMGND, '1');
    }

    // ⚠️ 文字块的宽度 / overflow 一律由 liberateWidth 负责（见 W_DECLS 说明）：
    //    这里若再写一遍，备份里会存下我们自己写的值，还原时就把 auto 又写回去。

    // 单元格左右内边距收紧（见 TD_DECLS 的说明）
    if (td) {
      backupProps(td, MARK_TD, TD_DECLS);
      for (i = 0; i < TD_DECLS.length; i++) setImp(td, TD_DECLS[i][0], TD_DECLS[i][1]);
      td.setAttribute(MARK_TDED, '1');
    }
  }

  /** 加宽是否仍然有效（平台重渲染会重写 style，标记却会留下） */
  function widenStillOn(f, imgBox) {
    try {
      // 容器是 <td> 时我们不改它的 display（改了会毁掉表格列），只认浮动那条
      if (f.tagName !== 'TD' && getComputedStyle(f).display !== 'block') return false;
      var ics = getComputedStyle(imgBox);
      var fl = ics.cssFloat || ics['float'] ||
               (ics.getPropertyValue ? ics.getPropertyValue('float') : '');
      return fl === 'left';
    } catch (e) {
      return false;
    }
  }

  /**
   * 试着加宽名称区。
   *
   * 【2026-10-31 重写：不再要求容器是 flex】
   *   上一版只认 `display:flex` 的容器。真机日志证明它一次都没命中
   *   （每行「改动 50 处」= 只有名称 13 条 + 祖先链 40 条），名字宽度
   *   仍卡在约 150px。原因是「缩略图 + 文字块」这一层在大屏**不是 flex**
   *   （可能是 block + 内联排版，或中间还夹着定宽容器）。
   *   现在改成：**找「同时含缩略图与名字的最低公共祖先」**，不挑 display；
   *   再逐层解开名字到单元格之间的宽度限制。任何布局形式都能落到同一条路径。
   *
   * @return {string} 'won' = 本轮真的改了 / 'on' = 已经加宽过 / '' = 无可改
   */
  function applyWiden(el) {
    // 边界：最近的 <td>（商品信息单元格）
    var td = el;
    var g = 0;
    while (td && td.tagName !== 'TD' && g++ < 12) td = td.parentElement;
    if (!td) return '';

    // ① 先解开名字到单元格之间每一层的宽度限制 —— 这一步不依赖任何布局假设
    var changed = liberateWidth(el, td);

    // ② 找「同时含缩略图与名字的最低公共祖先」
    var box = null;
    var img = null;
    var node = el.parentElement;
    var depth = 0;
    while (node && depth++ < 6) {
      var hit = null;
      try { hit = node.querySelector('img'); } catch (e) { hit = null; }
      if (hit && !el.contains(hit)) { box = node; img = hit; break; }
      if (node === td) break;
      node = node.parentElement;
    }
    if (!box) {
      var tdImg = null;
      try { tdImg = td.querySelector('img'); } catch (e2) { tdImg = null; }
      if (tdImg) { box = td; img = tdImg; }
    }
    if (!box || !img) return changed ? 'won' : '';

    // 缩略图分支 / 文字块分支：都取 box 的直接子（img 外面常还包一层）
    var imgBox = img;
    var guard = 0;
    while (imgBox && imgBox.parentElement !== box && guard++ < 8) imgBox = imgBox.parentElement;
    var txt = el;
    guard = 0;
    while (txt && txt.parentElement !== box && guard++ < 8) txt = txt.parentElement;
    if (!imgBox || !txt || imgBox === txt) return changed ? 'won' : '';

    if (box.getAttribute(MARK_FLEXED) === '1' && widenStillOn(box, imgBox)) {
      return changed ? 'won' : 'on';
    }

    // 容器改块级 + 包含浮动；**容器是 td 时不改 display**（那是表格列，动就崩）
    if (box.tagName !== 'TD') {
      var i;
      backupProps(box, MARK_FLEX, FLEX_DECLS);
      for (i = 0; i < FLEX_DECLS.length; i++) setImp(box, FLEX_DECLS[i][0], FLEX_DECLS[i][1]);
      box.setAttribute(MARK_FLEXED, '1');
    }

    widenBranches(box, imgBox, img, td);
    return 'won';
  }

  /** 还原加宽（关开关时；沿祖先链找标记，不依赖任何缓存） */
  function restoreWiden(el) {
    // ① 先还原商品信息单元格的内边距 —— 它是祖先，不在下面的 children 循环里
    var td = el.parentElement;
    var g = 0;
    while (td && td.tagName !== 'TD' && g++ < 10) td = td.parentElement;
    if (td && td.getAttribute(MARK_TDED) === '1') {
      restoreProps(td, MARK_TD, TD_DECLS);
      td.removeAttribute(MARK_TDED);
    }

    var up = el.parentElement;
    var depth = 0;
    // 7 层 = liberateWidth 的 6 层 + 它上面那层容器（widen 的 box）
    while (up && depth++ < 7 && !CHAIN_STOP[up.tagName]) {
      // 宽度放开（liberateWidth 写的）
      if (up.getAttribute(MARK_WED) === '1') {
        restoreProps(up, MARK_W, W_DECLS);
        up.removeAttribute(MARK_WED);
      }
      if (up.getAttribute(MARK_FLEXED) === '1') {
        var kids = up.children || [];
        for (var i = 0; i < kids.length; i++) {
          var k = kids[i];
          if (k.getAttribute(MARK_IMGED) === '1') {
            // 先把里面那枚 <img> 的尺寸约束还原（是我们写的）
            var inner = null;
            try { inner = k.querySelector('img'); } catch (e5) { inner = null; }
            if (inner && inner.getAttribute(MARK_IMGND) === '1') {
              restoreProps(inner, MARK_IMGN, IMG_N_DECLS);
              inner.removeAttribute(MARK_IMGND);
            }
            restoreProps(k, MARK_IMG, IMG_DECLS);
            k.removeAttribute(MARK_IMGED);
          }

        }
        restoreProps(up, MARK_FLEX, FLEX_DECLS);
        up.removeAttribute(MARK_FLEXED);
      }
      up = up.parentElement;
    }
  }

  /**
   * 展开名称：名称元素 + 最近 CHAIN_MAX 层祖先一起松开钳制。
   * @return {number} 实际被改动（值有变化）的元素个数 —— 0 表示「本来就放开了」
   */
  function expandEl(el) {
    var changed = 0;

    // ① 名称元素自己
    backupProps(el, MARK_ORIG, NAME_DECLS);
    for (var i = 0; i < NAME_DECLS.length; i++) {
      if (setImp(el, NAME_DECLS[i][0], NAME_DECLS[i][1])) changed++;
    }
    el.setAttribute(MARK, '1');

    // ② 祖先链：容器层放「clamp / max-height / height / overflow」，
    //    行（TR）只放高度 —— 详见 CHAIN_DECLS / ROW_DECLS。
    var up = el.parentElement;
    var depth = 0;
    while (up && depth < CHAIN_MAX && !CHAIN_STOP[up.tagName]) {
      var decls = chainDeclsFor(up);
      // 备份键跟着 decls 走：TR 只备份那两条，否则还原时会把「本来没碰过的
      // overflow」也当成我们的写入去清。
      var mark = (up.tagName === 'TR') ? MARK_ROW : MARK_CHAIN;
      backupProps(up, mark, decls);
      for (var k = 0; k < decls.length; k++) {
        if (setImp(up, decls[k][0], decls[k][1])) changed++;
      }
      up.setAttribute(MARK_CHAINED, '1');
      up = up.parentElement;
      depth++;
    }

    // ③ 加宽名称区（必须在祖先链之后：祖先链会写 overflow:visible，
    //    而加宽要把这一层改回 hidden 去包含左浮动的缩略图）
    if (applyWiden(el) === 'won') changed++;

    // ④ 最后保险：确认盒子真的长开了（加宽会改变折行数，所以放在最后复核）
    ensureNoOverlap(el);
    return changed;
  }

  /** 还原名称元素与它被改过的祖先（关开关时逐个清） */
  function restoreEl(el) {
    // ⚠️ 顺序：先还原加宽，再还原祖先链。
    //    祖先链的备份里存的是「空」（原本没有内联 overflow），加宽那层的备份里
    //    存的是「visible」（祖先链刚写进去的值）。反过来还原的话，最后一步会把
    //    visible 写回去，页面就不是原样了。
    restoreWiden(el);
    restoreProps(el, MARK_ORIG, NAME_DECLS);
    el.removeAttribute(MARK);
    try { delete el.__dycLsH; } catch (e3) { /* 删不掉也无所谓 */ }

    var up = el.parentElement;
    var depth = 0;
    while (up && depth < CHAIN_MAX && !CHAIN_STOP[up.tagName]) {
      if (up.getAttribute(MARK_CHAINED) === '1') {
        var decls = chainDeclsFor(up);
        var mark = (up.tagName === 'TR') ? MARK_ROW : MARK_CHAIN;
        restoreProps(up, mark, decls);
        up.removeAttribute(MARK_CHAINED);
      }
      up = up.parentElement;
      depth++;
    }
  }

  /* ==========================================================
   * 五、按钮
   * ========================================================== */

  /** 按钮回到「货号」初始态（三种状态类一起清，并解锁，否则会成为僵尸按钮） */
  function release(btn) {
    try {
      clearTimeout(btn.__dycTimer);
      clearTimeout(btn.__dycSafe);
      btn.classList.remove('is-press');
      btn.classList.remove('is-ok');
      btn.classList.remove('is-err');
      btn.textContent = (btn.__dycOrigText == null) ? '货号' : btn.__dycOrigText;
      btn.__dycFlashing = false;
    } catch (e) { /* 按钮已被平台摘掉也无所谓 */ }
  }

  /**
   * 按下瞬间的**同步**反馈 + 把按钮「锁住」。
   * 锁定必须从按下这一刻开始：补涂每 300ms 跑一次，若这几十~几百毫秒里
   * 按钮被摘掉重插，复制回调写「已复制」就写在一枚脱离文档的按钮上 ——
   * 用户看到的就是「点了有时有反馈有时没有」。
   */
  function press(btn) {
    try {
      if (btn.__dycOrigText == null) btn.__dycOrigText = btn.textContent;
      clearTimeout(btn.__dycTimer);
      clearTimeout(btn.__dycSafe);
      btn.classList.remove('is-ok');
      btn.classList.remove('is-err');
      btn.classList.add('is-press');
      btn.__dycFlashing = true;
      // 兜底：clipboard 的 Promise 永远不 settle 时，2.5 秒后无条件回初始态
      btn.__dycSafe = setTimeout(function () { release(btn); }, 2500);
    } catch (e) { /* 忽略 */ }
  }

  /** 结果反馈：换文案 + 换填充色，1.5 秒后复原 */
  function flash(btn, text, isErr) {
    try {
      if (btn.__dycOrigText == null) btn.__dycOrigText = btn.textContent;
      clearTimeout(btn.__dycSafe);
      btn.classList.remove('is-press');
      btn.textContent = text;
      btn.classList.toggle('is-ok', !isErr);
      btn.classList.toggle('is-err', !!isErr);
      // 保持「正在进行反馈」标记：补涂时若把这枚按钮摘掉重插，用户就看不到
      // 「已复制」了（新按钮又变回「货号」）。injectIntoRow 会读它并跳过。
      btn.__dycFlashing = true;
      clearTimeout(btn.__dycTimer);
      btn.__dycTimer = setTimeout(function () { release(btn); }, 1500);
    } catch (e) { /* 忽略 */ }
  }

  function buttonBrief(btn) {
    try {
      var r = btn.getBoundingClientRect();
      return '按钮 ' + Math.round(r.width) + '×' + Math.round(r.height) +
             ' @' + Math.round(r.left) + ',' + Math.round(r.top) +
             ' · 文本「' + clip(btn.textContent) + '」';
    } catch (e) { return '按钮(测不到)'; }
  }

  function makeButton(row, nameEl) {
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = BTN_CLASS;
    btn.textContent = '货号';
    // 悬停提示 = 这枚按钮的「说明书」：三态文案在点击里改写。
    btn.title = '点击复制货号 · 优先用平台货号；平台没展示时，取商品名末尾的款号';
    btn.setAttribute('data-dyc-ls-btn', '1');

    /**
     * 点击入口（沿用罗盘商品表 2026-10-19 的加固）。
     *
     * 平台为了做行选中 / 拖拽，常在**捕获阶段**于 document 或表格容器上
     * `stopPropagation()`，挂在按钮上的 `click` 就永远收不到 ——
     * 表现正是「按钮看得见、按下去毫无反应」。
     * `pointerdown` 是更早的事件，平台很少拦；两条都挂上，谁先到算谁的
     * （用时间戳去重，避免一次点击复制两遍）。
     */
    var lastTrigger = 0;
    function onTrigger(e, via) {
      var now = Date.now();
      if (now - lastTrigger < 500) return;      // 同一次点击的第二条事件，丢掉
      lastTrigger = now;
      // 只在自己的按钮上停冒泡 —— 别让这次点击冒到行上触发平台跳转
      try { e.preventDefault(); } catch (e0) { /* 忽略 */ }
      try { e.stopPropagation(); } catch (e1) { /* 忽略 */ }

      // 先给反馈，再干活（同时把按钮锁住，补涂不许摘它）
      press(btn);

      // 行被重建过时缓存的 nameEl 可能已脱离文档 ⇒ 点击时按同一判据重算
      var nowName = findNameEl(row) || nameEl;
      var r = readCode(row, nowName);
      if (!r.code) {
        btn.title = '这一行没找到货号 —— 平台没展示货号，商品名末尾也不是款号'
                  + '（本按钮只认名称末尾的款号）';
        flash(btn, '无货号', true);
        say('这一行没找到货号', 'warning');
        dbg('取号失败（' + via + '）：名称「' + clip(nowName && nowName.textContent) + '」');
        return;
      }
      btn.title = '货号：' + r.code +
                  (r.from === 'guess' ? '（按商品名末尾推算，不是平台货号）' : '（平台货号）');
      copyText(r.code, function (ok) {
        // 回调要写的那一枚按钮可能已经不是当初按下的那一枚：平台整块重建商品行
        // 会把我们的按钮一起换掉（旧引用 isConnected 变 false）。此时改写到新按钮。
        var target = btn;
        try {
          if (!btn.isConnected) {
            var fresh = row.querySelector('.' + BTN_CLASS);
            if (fresh && fresh !== btn) target = fresh;
          }
        } catch (e5) { /* 找不到就照旧 */ }
        flash(target, ok ? '已复制' : '复制失败', !ok);
        say(ok ? ('已复制货号 ' + r.code) : '复制失败，请重试', ok ? 'success' : 'warning');
        dbg('复制回调：' + (ok ? '成功' : '失败') + ' · 耗时 ' + (Date.now() - now) + 'ms · ' +
            buttonBrief(target));
      });
    }

    try {
      if (window.PointerEvent) {
        btn.addEventListener('pointerdown', function (e) { onTrigger(e, 'pointerdown'); });
      } else {
        btn.addEventListener('mousedown', function (e) { onTrigger(e, 'mousedown'); });
      }
    } catch (e9) { /* 老内核没有 pointer 事件就只靠 click */ }
    btn.addEventListener('click', function (e) { onTrigger(e, 'click'); });
    return btn;
  }

  /* ==========================================================
   * 六、行定位
   *
   * 用户 2026-10-30 交来的结构报告（大屏 /screen/live/talent#product）：
   *   `tbody.ecom-table-tbody` 51 个子元素，行签名
   *   `tr.ecom-table-row.ecom-table-row-level-0`，首行是
   *   `tr.ecom-table-measure-row`（1545×0，高度 0）；
   *   首行 8 个 td（300/177/177/208/208/177/177/123），首列 300px 是商品信息。
   *   `div.ecom-table-body` 固定高 724 / 内容 4234 ⇒ 非虚拟滚动。
   *
   * 三道排除（与罗盘商品表同口径）：
   *   ① measure 测量行 —— 语义名，平台自己就叫这个；高度 0；
   *   ② 表头行（在 thead 里）；
   *   ③ 列数 < 4 的行（分页条 / 小计 / 嵌套小表）。
   * 另加一条正向判据：**行内必须含缩略图** —— 商品行的硬特征。
   * ========================================================== */

  function getRows() {
    var out = [];
    var trs;
    try {
      trs = document.querySelectorAll('tbody tr');
    } catch (e) {
      return out;
    }
    for (var i = 0; i < trs.length; i++) {
      var tr = trs[i];
      if (!tr.isConnected) continue;
      // ① 测量行
      if (/measure/i.test(String(tr.className || ''))) continue;
      // ② 表头
      if (tr.parentElement && tr.parentElement.tagName === 'THEAD') continue;
      // ③ 列数
      var kids = tr.children;
      var tdCount = 0;
      for (var k = 0; k < kids.length; k++) {
        if (kids[k].tagName === 'TD') tdCount++;
      }
      if (tdCount < 4) continue;
      // ④ 几何：占位行 / 测量行高度恒为 0
      if (tr.clientHeight === 0) continue;
      // ⑤ 商品行必有缩略图（挡掉页面上别的表格与小计条）
      var hasImg = false;
      try { hasImg = !!tr.querySelector('img'); } catch (e2) { hasImg = false; }
      if (!hasImg) continue;
      out.push(tr);
    }
    return out;
  }

  /** 诊断用：把一行的情况压成一句话 */
  function rowBrief(row) {
    var tdCount = 0;
    var kids = row.children || [];
    for (var i = 0; i < kids.length; i++) if (kids[i].tagName === 'TD') tdCount++;
    var hasImg = false;
    try { hasImg = !!row.querySelector('img'); } catch (e) { hasImg = false; }
    return '列=' + tdCount + ' 缩略图=' + (hasImg ? '有' : '无') + ' 高=' + row.clientHeight;
  }

  /* ==========================================================
   * 七、注入
   * ========================================================== */

  /**
   * 按钮落在哪：名称元素最近的 <td>（商品信息单元格）末尾。
   *
   * 为什么不插在名称元素之后：名称的父容器常是 flex（缩略图 + 文本块），
   * 插进去会被当成 flex 子项横排到名字右边，把名字挤窄。
   * 插到单元格末尾，配合块级 + `margin-left:auto`，自然落在整块信息的最下一行、
   * 贴右边缘（用户选的甲案），且不参与名字的宽度竞争。
   */
  function hostFor(nameEl) {
    var el = nameEl;
    var guard = 0;
    while (el && guard++ < 12) {
      if (el.tagName === 'TD') return el;
      el = el.parentElement;
    }
    return (nameEl && nameEl.parentElement) || null;
  }

  /** 同一行「写了样式却仍没展开」的重试次数上限（防死循环：每轮重写 → 触发观察器 → 再写） */
  var TRIES = 'data-dyc-ls-tries';
  /** 放弃标记：连续两轮写完仍判「没展开」，说明平台的规则压住了我们，停手并如实记录 */
  var GIVEUP = 'data-dyc-ls-giveup';

  /**
   * 处理一行。
   * @return {number} 1 = 已有按钮且名称已展开（稳态）/ 2 = 本轮新插入 / -1 = 没处理
   */
  function injectIntoRow(row) {
    if (!row || !row.isConnected) return -1;

    // 已有按钮：只要还在原位就不动（幂等）。
    // ⚠️ 反馈进行中的按钮（__dycFlashing）绝不摘 —— 摘了「已复制」就看不见了。
    var btn = null;
    try { btn = row.querySelector('.' + BTN_CLASS); } catch (e) { btn = null; }

    // 名称元素：优先复用上一轮记住的那一个（省掉每轮每行一次全行扫描），
    // 它脱离文档了才重新按判据找。
    var nameEl = null;
    if (btn && btn.__dycName && btn.__dycName.isConnected) {
      try { nameEl = row.contains(btn.__dycName) ? btn.__dycName : null; } catch (e0) { nameEl = null; }
    }
    if (!nameEl) nameEl = findNameEl(row);
    if (!nameEl) return -1;

    var fresh = 0;
    if (!btn) {
      var host = hostFor(nameEl);
      if (!host) return -1;
      btn = makeButton(row, nameEl);
      try {
        host.appendChild(btn);
        fresh = 1;
      } catch (e2) {
        return -1;
      }
    }
    btn.__dycName = nameEl;

    // 名称展开（幂等双条件：标记 + 计算值仍是展开态）
    if (nameEl.getAttribute(MARK) === '1' && stillExpanded(nameEl)) {
      return fresh ? 2 : 1;
    }
    // 已判定「写了也压不住」的行：不再重试，只保证按钮在位
    if (nameEl.getAttribute(GIVEUP) === '1') return fresh ? 2 : 1;

    // 只在「真的被截断」时才动 —— 没截断的行不写任何样式
    if (nameEl.getAttribute(MARK) !== '1' && !isCut(nameEl)) {
      return fresh ? 2 : 1;
    }

    var changed = expandEl(nameEl);

    // 写完复核：仍判「没展开」就计数，连续两轮放弃并记一条
    if (!stillExpanded(nameEl)) {
      var n = (parseInt(nameEl.getAttribute(TRIES) || '0', 10) || 0) + 1;
      try { nameEl.setAttribute(TRIES, String(n)); } catch (e3) { /* 忽略 */ }
      if (n >= 2) {
        try { nameEl.setAttribute(GIVEUP, '1'); } catch (e4) { /* 忽略 */ }
        dbg('展开被平台规则压住，已停手：' + clip(nameEl.textContent) + ' · ' + rowBrief(row));
      }
    } else {
      try { nameEl.removeAttribute(TRIES); } catch (e5) { /* 忽略 */ }
    }

    if (changed > 0 || fresh) {
      // 首轮 51 行都不同名，逐条记会把面板刷满 ⇒ 样例最多 3 条，其余靠汇总
      if (sampleCount < 3) {
        sampleCount++;
        dbg('展开名称（' + hitLevel + '）：' + clip(nameEl.textContent) +
            ' · ' + rowBrief(row) + ' · 改动 ' + changed + ' 处');
      }
    }
    return fresh ? 2 : 1;
  }

  var lastSig = '';
  var sampleCount = 0;

  function applyAll() {
    if (!enabled()) return 0;
    var rows;
    try {
      rows = getRows();
    } catch (e) {
      return 0;
    }
    if (!rows.length) return 0;

    sampleCount = 0;
    var inserted = 0;
    var noBtn = [];
    for (var i = 0; i < rows.length; i++) {
      var r = -1;
      try { r = injectIntoRow(rows[i]); } catch (e2) { r = -1; }
      if (r === 2) inserted++;
      if (r === -1) noBtn.push(rows[i]);
    }

    // 汇总：只在数字变化时记一条（观察器每 300ms 也会调到这里）
    var sig = rows.length + '|' + inserted;
    if (sig !== lastSig) {
      dbg('扫描完成：候选行 ' + rows.length + ' · 本轮新插入 ' + inserted);
      lastSig = sig;
    }
    // 可疑行：只有「像商品行却没拿到」才记 —— 分页条 / 小计行不算
    for (var j = 0; j < noBtn.length && j < 3; j++) {
      var b = rowBrief(noBtn[j]);
      if (/缩略图=有/.test(b)) dbg('可疑行没处理：' + b);
    }
    return inserted;
  }

  /** 关闭开关：全页清一遍（只在拨开关时跑，频率极低） */
  function restoreAll() {
    var marked = document.querySelectorAll('[' + MARK + ']');
    for (var i = 0; i < marked.length; i++) {
      try { restoreEl(marked[i]); } catch (e) { /* 尽力而为 */ }
    }
    removeButtons();
  }

  function removeButtons() {
    var btns = document.querySelectorAll('.' + BTN_CLASS);
    for (var i = 0; i < btns.length; i++) {
      try { btns[i].remove(); } catch (e) { /* 尽力而为 */ }
    }
  }

  /* ==========================================================
   * 八、平台气泡(悬浮看全名)
   *
   * 【来由】用户 2026-10-31 真机截图：「删掉这个浮动框，不然跟我的程序功能
   *   起到相悖的作用，想点按钮都点不动」。鼠标经过商品名时平台弹出的深色气泡，
   *   内容就是完整商品名 —— 名字已经被我们展开，这层纯属重复，还正好压在
   *   单元格右下角的「货号」按钮上。
   *
   * 【为什么不能只靠 CSS 藏】平台的触发源包裹层与气泡本体**常常共用同一套类名**
   *   （`ecom-tooltip` 既可能是气泡，也可能是包着商品名的那一层）。用类名一刀切
   *   有「把商品名整个藏掉」的风险，比原问题更糟。所以：
   *     · CSS 只做 `pointer-events:none`（叶子级安全：不影响显示，只保证不挡点击）；
   *     · 真正「删掉」由本小节按**结构判据**做，四条同时成立才动手：
   *         ① 不在表格行内（`closest('tr')` 为空）—— 行内的同名类就是触发源；
   *         ② 是定位浮层（computed position 为 fixed/absolute）；
   *         ③ 不含可交互元素（没有 button/input/a/select/textarea）——
   *            平台的「配置列表」「查看详情」这类弹层不能碰；
   *         ④ 文本非空且不超过 200 字（纯文字气泡才有这个特征）。
   * ========================================================== */

  /** 气泡候选：只在「出现新节点」时才去查，不做常驻轮询 */
  var TIP_SEL = '[role="tooltip"], .ecom-tooltip, .ecom-bubble, .auxo-tooltip';
  /** 我们藏掉的气泡（关开关时要还原） */
  var MARK_TIP = 'data-dyc-ls-tip';
  var TIP_MAX_TEXT = 200;

  /**
   * 把页面上的「完整名称气泡」藏掉。
   * @return {number} 本轮藏掉的个数（0 = 没有气泡）
   */
  function hideTips() {
    var list;
    try { list = document.querySelectorAll(TIP_SEL); } catch (e) { return 0; }
    var n = 0;
    for (var i = 0; i < list.length; i++) {
      var el = list[i];
      if (el.getAttribute(MARK_TIP) === '1') continue;
      if (!isNameBubble(el)) continue;
      el.setAttribute(MARK_TIP, '1');
      // 用内联 `!important` 而不是删节点：平台的 React 卸载时要能找到它，
      // 直接 remove 有概率让平台在收起气泡时报一次错。
      try { el.style.setProperty('display', 'none', 'important'); } catch (e2) { /* 尽力而为 */ }
      n++;
    }
    if (n) dbg('已隐藏平台名称气泡 ' + n + ' 个');
    return n;
  }

  /**
   * 判定「这是不是平台那个重复的完整名称气泡」。
   * 四条判据见小节开头 —— 任何一条不成立都返回 false（宁可不摘，不误伤）。
   */
  function isNameBubble(el) {
    if (!el || el.nodeType !== 1) return false;

    // ① 在表格行里 ⇒ 这是触发源包裹层（藏了商品名就没了）
    try { if (el.closest('tr')) return false; } catch (e) { return false; }

    // ② 必须是浮层形态
    var cs;
    try { cs = getComputedStyle(el); } catch (e2) { return false; }
    if (!cs || (cs.position !== 'fixed' && cs.position !== 'absolute')) return false;

    // ③ 含可交互元素的弹层一律不碰
    try {
      if (el.querySelector('button, input, select, textarea, a')) return false;
    } catch (e3) { return false; }

    // ④ 纯文字，且长度像一句话（完整名称也就几十个字）
    var txt = '';
    try { txt = (el.textContent || '').replace(/\s+/g, ' ').trim(); } catch (e4) { return false; }
    if (!txt || txt.length > TIP_MAX_TEXT) return false;

    return true;
  }

  /** 还原被我们藏掉的气泡（关开关时） */
  function restoreTips() {
    var list;
    try { list = document.querySelectorAll('[' + MARK_TIP + '="1"]'); } catch (e) { return 0; }
    for (var i = 0; i < list.length; i++) {
      try {
        list[i].style.removeProperty('display');
        list[i].removeAttribute(MARK_TIP);
      } catch (e2) { /* 尽力而为 */ }
    }
    return list.length;
  }

  /**
   * 新增节点里有没有可能是气泡？
   *
   * 气泡是**鼠标一悬停才插进 DOM** 的，靠 300ms 尾扫去藏会慢半拍 ——
   * 那半拍里用户已经点空了。所以单独挂一个 observer，只在「真的有疑似气泡
   * 的节点插进来」时才跑一次 hideTips（不常驻轮询，开销可忽略）。
   */
  function maybeBubble(nodes) {
    for (var i = 0; i < nodes.length; i++) {
      var nd = nodes[i];
      if (!nd || nd.nodeType !== 1) continue;
      var cls = '';
      try { cls = (nd.className && typeof nd.className === 'string') ? nd.className : ''; } catch (e) { cls = ''; }
      if (cls && /tooltip|bubble/i.test(cls)) return true;
      try {
        if (nd.getAttribute && nd.getAttribute('role') === 'tooltip') return true;
      } catch (e2) { /* 忽略 */ }
      try { if (nd.querySelector && nd.querySelector(TIP_SEL)) return true; } catch (e3) { /* 忽略 */ }
    }
    return false;
  }

  /**
   * 最后一道保险：不管气泡认没认出来，只要用户按下的那一点**落在某枚货号按钮
   * 的矩形里**，且被按的元素带着气泡特征，就当成一次按钮点击。
   *
   * 为什么需要它：气泡的类名、层级都是平台说了算。前两层（隐藏 / 不吃鼠标事件）
   * 已经覆盖了九成情况，但「按钮点不动」是用户已经在真机上撞了两次的问题，
   * 留一层不依赖任何类名的兜底，代价只是 pointerdown 时多一次判断。
   */
  function onDocPointerDown(e) {
    if (!enabled()) return;
    var t = e && e.target;
    if (!t || t.nodeType !== 1) return;
    try { if (t.closest('.' + BTN_CLASS)) return; } catch (e0) { return; }   // 正常点在按钮上
    // 只在「被按的是气泡」时才兜底 —— 别把页面其它点击截胡
    var onBubble = false;
    try { onBubble = !!t.closest(TIP_SEL); } catch (e1) { onBubble = false; }
    if (!onBubble) return;

    var x = e.clientX, y = e.clientY;
    var btns;
    try { btns = document.querySelectorAll('.' + BTN_CLASS); } catch (e2) { return; }
    for (var i = 0; i < btns.length; i++) {
      var b = btns[i], r = null;
      try { r = b.getBoundingClientRect(); } catch (e3) { continue; }
      if (!r || !r.width || !r.height) continue;
      if (x < r.left || x > r.right || y < r.top || y > r.bottom) continue;
      try { e.preventDefault(); e.stopPropagation(); } catch (e4) { /* 忽略 */ }
      try {
        b.dispatchEvent(new MouseEvent('click', {
          bubbles: true, cancelable: true, view: window, clientX: x, clientY: y
        }));
      } catch (e5) {
        try { b.click(); } catch (e6) { /* 尽力而为 */ }
      }
      dbg('气泡挡住了按钮，已把这次点击转交给按钮 @' + Math.round(x) + ',' + Math.round(y));
      return;
    }
  }

  var tipObserver = null;
  var tipBound = false;

  function startTips() {
    if (tipObserver) return;
    hideTips();
    tipObserver = new MutationObserver(function (recs) {
      for (var i = 0; i < recs.length; i++) {
        var added = recs[i] && recs[i].addedNodes;
        if (added && added.length && maybeBubble(added)) { hideTips(); return; }
      }
    });
    tipObserver.observe(document.body, { childList: true, subtree: true });
    if (!tipBound) {
      tipBound = true;
      // 捕获阶段：要抢在气泡自己的监听之前，否则平台可能先把事件吃掉
      document.addEventListener('pointerdown', onDocPointerDown, true);
    }
  }

  function stopTips() {
    if (tipObserver) { tipObserver.disconnect(); tipObserver = null; }
    if (tipBound) {
      tipBound = false;
      try { document.removeEventListener('pointerdown', onDocPointerDown, true); } catch (e) { /* 忽略 */ }
    }
    restoreTips();
  }

  /* ==========================================================
   * 九、触发时机
   *
   * 当帧 rAF 补涂 + 300ms 尾扫：
   *   · 当帧补涂 ⇒ 浏览器在同一帧内先跑完我们、再绘制，省略号来不及显示；
   *   · 尾扫 ⇒ 平台有时在插入节点之后的下一个任务里才把结构/样式补齐。
   * ========================================================== */

  function scheduleApply() {
    if (!enabled()) return;
    if (!pending) {
      pending = true;
      var raf = window.requestAnimationFrame || function (fn) { return setTimeout(fn, 16); };
      raf(function () { pending = false; applyAll(); });
    }
    if (tailTimer === null) {
      tailTimer = setTimeout(function () {
        tailTimer = null;
        applyAll();
      }, 300);
    }
  }

  function start() {
    if (!observer) {
      ensureStyle();
      applyAll();
      observer = new MutationObserver(scheduleApply);
      observer.observe(document.body, { childList: true, subtree: true });
      startTips();          // 平台的「完整名称气泡」：藏掉 + 不吃鼠标事件 + 点击转交
      dbg('已启动：' + location.pathname + location.hash);
    }
  }

  function stop() {
    if (observer) { observer.disconnect(); observer = null; }
    if (tailTimer !== null) { clearTimeout(tailTimer); tailTimer = null; }
    pending = false;
    stopTips();
    restoreAll();
    removeStyle();
  }

  /* ---------- 开关联动 ---------- */

  var prevOn = null;
  dycReadFlags().then(function (f) {
    flags = f;
    prevOn = enabled();
    if (enabled()) start();
  });

  dycWatchFlags(function (f) {
    flags = f;
    var now = enabled();
    if (prevOn !== null && now !== prevOn && typeof toast === 'function') {
      toast(now ? '已开启' : '已关闭', 'info', { source: '大屏货号' });
    }
    prevOn = now;
    if (now) start();
    else stop();
  });

  // 大屏是微前端，表格渲染得晚 —— 首屏补扫三次兜底
  [1500, 4000, 8000].forEach(function (ms) {
    setTimeout(function () { if (enabled()) applyAll(); }, ms);
  });
})();
