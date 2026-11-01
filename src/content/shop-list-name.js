/**
 * 抖店商品名称完整展示（反馈 #128，2026-11-01）
 * ============================================================
 * 【解决什么问题】
 *
 *   抖店后台商品列表（fxg.jinritemai.com/ffa/g/list）把商品名截断成
 *   一行加省略号，想看全名只能点进详情。用户原话：
 *   「希望抖店这边也支持全名展示，商品名空间留有很大的余地」。
 *   —— 这是**功能覆盖缺口**，不是现有功能出错：全名展示已铺 5 处
 *   （中控台小黄车 / 微信小店列表 / 罗盘直播明细 / 罗盘商品表 / 直播大屏），
 *   唯独抖店主站商品列表没有。
 *
 *   同一天下午用户再补一条口径：「商品管理的商品名字，尽量两行可以做到吗，
 *   右边还有很大空位」⇒ 不是「无限折行」，而是**最多两行**，并把右侧空位
 *   加给名字列。两条口径的落地见下方【口径】与【右侧空位】两节。
 *
 * 【为什么不用类名定位】
 *
 *   该页是 `ecom-g-table`（ant 系，`table-layout:fixed` + 右侧粘性操作列），
 *   类名是构建哈希（`index_wrapper__3UiS6` 这种），写死必随平台改版失效。
 *   所以本模块走**行为判据**，三层：
 *     ① 行：复用 anchor.js 的 `findProductRows()`（按「编辑」按钮回溯到商品行，
 *        该页已有骰子验证过的实现，不再重复造）；
 *     ② 名称：行内**真正被截断**、且文本**像商品名**的那个元素；
 *     ③ 语义优先：行内指向商品详情的链接（href 含 detail / product）先试一次，
 *        命中就直接用，特征扫描只当逃生口。
 *
 * 【只动名称元素自己 + 一处列宽】
 *
 *   按截断原因写**最少的一组**内联属性（读-写分离，不遍历全树）：
 *     · nowrap 型（单行省略号）→ white-space:normal + text-overflow:clip + overflow:visible
 *     · line-clamp 型（-webkit-box 钳行）→ display:block + -webkit-line-clamp:none
 *     · 定高型（祖先 fixed height）→ max-height:none + height:auto
 *   三档都补 word-break:normal + overflow-wrap:break-word（款号整体参与折行）。
 *
 *   折成两行以上时再补 line-height:1.55 与 padding-bottom:2px（与微信侧同口径）：
 *   平台默认行高约 1.43，两行会贴在一起；单行名字**不动**这两项。
 *
 * 【口径：两行优先、最多三行（2026-11-01 用户定，取代「无限折行」）】
 *
 *   用户原话：「商品管理的商品名字，尽量两行可以做到吗，右边还有很大空位」。
 *   解截断后量**自然行数**：
 *     · ≤ 2 行 ⇒ 完整显示，一个字不藏（这是「尽量」的正面，也是常态）；
 *     · 3 行 ⇒ 也完整显示 —— 2026-11-01 两次截图都卡在「两行差几个字」，
 *       硬钳两行换来的只是末尾多一个省略号，与功能名「完整展示」直接冲突；
 *     · > 3 行 ⇒ 钳 3 行 + 省略号（-webkit-line-clamp:3；老内核用 max-height 兜底）。
 *   为什么仍然设上限：完全放开会让超长名一路撑到五行，一屏能看的商品数量骤减 ——
 *   那是 2026-11-01 上午那版（无限折行）的问题。三行是「完整」与「密度」的交界。
 *
 * 【右侧空位 → 名字列加宽（同一轮用户要求）】
 *
 *   该表是 `table-layout:fixed`，列宽由平台按固定值下发。用户看到「右边还有很大空位」，
 *   所以本模块会把**表格比容器窄出来的那段空白**（gap = 容器宽 − 表格宽）
 *   一次性加给名字列，让两行装下更多字。
 *   三条硬约束：
 *     · gap < 24px 视为没有空位，**一个字都不动**（硬挤别的列会让表头与数据错位）；
 *     · 加宽后给右侧留 4px 余量，防横向溢出；
 *     · 三处写入点全写：`colgroup > col`（fixed 布局列宽的真源头）、表头 TH、
 *       **单元格本身** —— 2026-11-01 用户截图证明只写前两处不够：这张表的表头
 *       未必是 `<thead>`、也未必挂 colgroup，两处都拿不到时列宽一点没动，
 *       表现就是「两行还是被省略号截掉」。三处都记原值，关开关 / 窗口缩放逐个还原。
 *
 *   还要防第二层卡点：**格子内部**被平台写死了 `max-width` / 固定 `width`，
 *   列变宽了名字容器也不跟着变。所以加宽之后会走一遍 releaseWidthCaps()：
 *   只对 el 到格子之间「确实比格子窄」的块级层解除上限，其它一律不碰。
 *
 *   写完立刻量一次实际宽度：没变就记成 no-effect（写一条诊断），
 *   不再每轮白写 —— 谎报「已加宽」比不加宽更糟。
 *
 * 【幂等 = 标记 + 计算值双条件】
 *
 *   平台重渲染会整段重写 style 属性，我们的内联属性被抹掉，而陌生属性标记会留下。
 *   只看标记会「样式被抹 → 永不补涂 → 永久省略号」。所以每次扫描复核计算值：
 *   仍是 nowrap 或仍被钳行 ⇒ 视为没处理过，重写一遍；**重复写不重复备份**，
 *   否则备份里会存进我们自己写的值，关开关还原不回去。
 *   列宽同理：复核「名字格当前宽是否仍等于我们设的目标」，被洗掉就重算重写。
 *
 * 【触发时机与开销】
 *
 *   · 首屏 [1500, 4000, 8000] 三次补涂（兜住晚渲染与分批挂载）；
 *   · MutationObserver 挂 document.body：回调只排一次防抖任务（400ms），
 *     并配**最长等待** 1200ms（列表页 DOM 一直在动，纯防抖会被无限推后）；
 *   · 扫描先查缓存行是否还在文档里：在 ⇒ 只复核每行那一个名称元素；
 *     不在 ⇒ 才重新枚举行。避免每 1.2 秒跑一次全页「编辑」文本扫描。
 *   · 窗口 resize ⇒ 先把加宽全部还原，再按新空位重算（空位是随窗口变的）。
 *
 * 【已知边界（如实记录，不掩盖）】
 *
 *   1. 名称被**祖先容器** overflow 剪裁（自身样式没有截断特征）时找不到 ——
 *      表现为「开关开了没变化」，不会乱改布局。
 *   2. 三行仍装不下的超长名字显示省略号（三行是「完整」与列表密度的交界，
 *      要逐字核对请点进详情）。
 *   3. 表格本来就铺满容器（gap < 24px）时列宽不动，只能靠解除内部宽度上限争取空间；
 *      两者都没有余地时，超长名字在第三行仍会带省略号。
 *   4. 只覆盖 /ffa/g/list（含渠道品列表走同一个匹配串时的同构表格）；
 *      其它列表页即使有表格也不处理。
 *   5. 页面是 SPA：本脚本只在文档导航时注入一次，行枚举是每轮实时做的，
 *      所以翻页 / 切换筛选后会自动重新定位（有缓存行失效判据兜底）。
 * ============================================================
 */
(function dycShopListName() {
  'use strict';

  if (window.__DYC_SHOP_LIST_NAME__) return;   // 防重复注入（SPA 回切 / 脚本意外重跑）
  window.__DYC_SHOP_LIST_NAME__ = true;

  if (typeof dycReadFlags !== 'function') return;   // 开关层没就位就静默退出，不猜页面结构

  /* ---------- 常量 ---------- */

  /* 标记：告诉我们「这个节点已经处理过」，同时方便调试面板取证 */
  var MARK = 'data-dyc-shopname';
  /* 扫描防抖与最长等待 */
  var SCAN_DEBOUNCE = 400;
  var SCAN_MAX_WAIT = 1200;
  /* 首屏三次补涂（毫秒） */
  var BOOT_DELAYS = [1500, 4000, 8000];
  /* 特征扫描的节点预算：单个商品行最多看这么多候选（防炸） */
  var NODE_BUDGET = 220;
  /* 名称文本长度上下限：太短不像商品名，太长是整行（含 ID / 货号）不是名称 */
  var NAME_MIN_LEN = 4;
  var NAME_MAX_LEN = 120;

  /* 名称最多显示几行。
   * 沿革：2026-11-01 用户先定「尽量两行」⇒ 设 2；同一天两次反馈「没展示全」
   * （第二次截图只差末尾款号 `Y0303`，说明两行就是差几个字符装不下）。
   * 现改为 **3**，语义仍是「尽量两行」：
   *   自然 1 行 → 1 行；自然 2 行 → 2 行；**只有两行装不下时才用第三行**；
   *   三行仍装不下才钳三行加省略号（避免超长名一路撑到五行）。
   * 也就是说「两行」依然是常态，第三行只是兜底，不会平白把列表拉长。 */
  var MAX_LINES = 3;
  /* 右侧空位少于这个像素数就不动列宽 —— 几十像素以内的「空」不值得冒错位风险。
   * 2026-11-01 调低到 24：用户实测「右边还有很大空位」但两行仍被省略，
   * 门槛设 60 时容易把这点空位判成「没有」，宁可多用一个 24px 的窗口。 */
  var WIDEN_MIN_GAP = 24;
  /* 加宽后给表格右侧留的余量，防横向溢出（留出滚动条 / 边框的位置）。
   * 2026-11-01 从 8 收到 4：两行就差几个字，多留这 4px 就可能换来一行字。 */
  var WIDEN_KEEP = 4;

  /* 明显不是名称的行内字段 —— 平台字段名与操作文案 */
  var NOT_NAME_RE = /^(ID|商品\s*ID|货号|价格|售价|库存|总库存|销量|时间|上架时间|类目|品牌)\s*[:：]/;
  /* 纯数字 / 纯金额 / 纯百分比 */
  var NUMERIC_RE = /^[\s¥￥$]?[\d,.]+\s*([%元件个笔])?$/;
  /* 操作类文案（行内按钮，不是商品名） */
  var ACTION_RE = /^(编辑|下架|上架|更多|复制|查看|删除|推广|分享|设置|预览)/;

  /* ---------- 状态 ---------- */

  var on = false;
  var observer = null;
  var bootTimers = [];
  var debounceTimer = null;
  /* 已经加宽过列宽的表格（关开关 / 窗口缩放时逐个还原） */
  var widenedTables = [];
  /* 解除过宽度上限的内部容器（关开关时逐个还原） */
  var cappedEls = [];
  /* 窗口缩放监听是否已挂（缩放后空位变了，列宽要全部撤销重算） */
  var resizeBound = false;
  var queuedAt = 0;
  /* 行缓存：避免每轮都跑一次全页「编辑」文本扫描 */
  var rowCache = [];
  /* 首次成功展开过没有 —— 只用来给调试留痕，不弹消息 */
  var appliedAt = 0;

  /** 取文本并压掉多余空白 */
  function textOf(el) {
    if (!el) return '';
    var t = el.textContent || '';
    return String(t).replace(/\s+/g, ' ').trim();
  }

  /** 是不是我们自己注入的节点（注入的清空库存按钮、状态条等） */
  function isOurNode(el) {
    if (!el) return true;
    var id = el.id ? String(el.id) : '';
    if (/^(dyc|dyb)[-_]/.test(id)) return true;
    var cls = el.className ? String(el.className) : '';
    if (/(^|\s)(dyc|dyb)[-_]/.test(cls)) return true;
    try {
      if (el.hasAttribute && (el.hasAttribute('data-dyc-clear') || el.hasAttribute(MARK))) return true;
    } catch (e) { /* 忽略 */ }
    return false;
  }

  /**
   * 这个元素现在被**哪一种**方式截断。
   *
   * @return {string} 'clamp' | 'nowrap' | 'height' | ''（空串 = 没截断）
   */
  function truncationReason(el) {
    if (!el || !el.getBoundingClientRect) return '';
    var cs = null;
    try { cs = window.getComputedStyle ? window.getComputedStyle(el) : null; } catch (e) { return ''; }
    if (!cs) return '';
    /* ① 行数钳制：平台最常见的写法是 -webkit-box + -webkit-line-clamp:N */
    var lc = cs.webkitLineClamp || cs['-webkit-line-clamp'] || '';
    var n = parseInt(lc, 10);
    if (lc && lc !== 'none' && !isNaN(n) && n > 0) return 'clamp';
    /* ② 单行省略号：不换行 + 内容比盒子宽（必须真宽出来才算，否则是误判） */
    var ws = cs.whiteSpace || '';
    var ell = cs.textOverflow || '';
    if (ws === 'nowrap' || ell === 'ellipsis') {
      if (el.scrollWidth > el.clientWidth + 1) return 'nowrap';
    }
    /* ③ 定高剪裁：纵向装不下 */
    if (cs.overflow === 'hidden' && el.scrollHeight > el.clientHeight + 1) return 'height';
    return '';
  }

  /** 这段文本像不像商品名（宁可漏，也不要错认成价格 / 字段 / 按钮） */
  function looksLikeName(text) {
    var s = String(text || '').replace(/\s+/g, ' ').trim();
    if (s.length < NAME_MIN_LEN || s.length > NAME_MAX_LEN) return false;
    if (NOT_NAME_RE.test(s)) return false;
    if (NUMERIC_RE.test(s)) return false;
    if (ACTION_RE.test(s) && s.length <= 6) return false;
    if (/^(ID|货号)\s*[:：]/.test(s)) return false;
    if (/ID\s*[:：]\s*\d+/.test(s)) return false;   // 整行文本混进了 ID
    return true;
  }

  /**
   * 行内找**该被展开的那一个**元素。
   *
   * 顺序：语义（详情链接）→ 特征（真被截断 + 像名称，取最左的那个）。
   * 取最左而不是取最长：商品信息永远在第一列，价格 / 库存可能也有长文本，
   * 但它们在右边。左边界作为主判据，比「挑最长」稳得多。
   */
  function findNameInRow(row) {
    if (!row || !row.querySelectorAll) return null;

    /* ① 语义优先：指向商品详情的链接，名字通常就挂在它上面 */
    var links = null;
    try { links = row.querySelectorAll('a[href]'); } catch (e) { links = null; }
    if (links) {
      for (var i = 0; i < links.length; i++) {
        var a = links[i];
        if (isOurNode(a)) continue;
        var href = '';
        try { href = a.getAttribute('href') || ''; } catch (e2) { href = ''; }
        if (!/detail|product|\/ffa\/g\/|item/i.test(href)) continue;
        if (!looksLikeName(textOf(a))) continue;
        /* 截断可能落在 <a> 自己，也可能落在它的包裹层 */
        if (truncationReason(a)) return a;
        var pa = a.parentElement;
        if (pa && !isOurNode(pa) && truncationReason(pa)) return pa;
      }
    }

    /* ② 特征兜底：真被截断 + 像名称，取最左的一个。
     *
     * 分两遍，**读-写分离**：
     *   第一遍只读文本（textContent 不触发布局），把「像名称」的候选收进小数组；
     *   第二遍才对这份小数组量样式与矩形。
     * 为什么不一趟做完：一行两三百个节点，逐个 getComputedStyle + 矩形会让
     * 每次重渲染都强制重排一遍（性能检查 R6 踩的就是这个坑）。
     * 候选上限 12 —— 一行里的名称候选不可能更多，多了说明判据已经走歪。
     */
    var nodes = null;
    try { nodes = row.querySelectorAll('span, a, div, p, h3, h4, strong, em'); } catch (e) { nodes = null; }
    if (!nodes) return null;

    var cands = [];
    var limit = nodes.length < NODE_BUDGET ? nodes.length : NODE_BUDGET;
    for (var k = 0; k < limit; k++) {
      var el = nodes[k];
      if (isOurNode(el)) continue;
      /* 只认「装文本的叶子」：子元素超过 3 个的多半是布局容器，展开它会把整格撑乱 */
      if (el.children && el.children.length > 3) continue;
      if (!looksLikeName(textOf(el))) continue;
      cands.push(el);
      if (cands.length >= 12) break;
    }

    var best = null;
    var bestLeft = Infinity;
    for (var j = 0; j < cands.length; j++) {
      var cand = cands[j];
      if (!truncationReason(cand)) continue;
      var r = null;
      try { r = cand.getBoundingClientRect(); } catch (e3) { r = null; }
      var left = r ? r.left : Infinity;
      /* 更靠左的赢；同一列里更靠上（文档序靠前）的赢 */
      if (left < bestLeft - 1) { best = cand; bestLeft = left; }
    }
    return best;
  }

  /**
   * 备份这个元素上的内联属性（只在第一次写之前做）。
   * 用普通属性挂载而不是 Map：老内核（360 极速 X）没有 WeakMap 也能跑，
   * 而且行节点被销毁时它随节点一起回收，没有泄漏。
   */
  function backupOf(el) {
    if (el.__dycShopNameOrig) return el.__dycShopNameOrig;
    el.__dycShopNameOrig = {};
    return el.__dycShopNameOrig;
  }

  /** 写一条内联属性并记下原值（重复写不覆盖备份） */
  function setProp(el, prop, value) {
    var bak = backupOf(el);
    if (!Object.prototype.hasOwnProperty.call(bak, prop)) {
      bak[prop] = { v: el.style.getPropertyValue(prop) || '', p: el.style.getPropertyPriority(prop) || '' };
    }
    try {
      el.style.setProperty(prop, value, 'important');
    } catch (e) {
      /* 老内核个别属性不支持 setProperty 的第三参：退回普通赋值 */
      try { el.style.setProperty(prop, value); } catch (e2) { /* 放弃这一条，不影响其它 */ }
    }
  }

  /**
   * 按截断原因展开一个名称元素。
   *
   * @param {Element} el
   * @param {string} reason truncationReason() 的结果
   * @return {boolean} true = 这次真的写了样式（不是幂等空转）
   */
  function applyUnclip(el, reason) {
    if (!el) return false;
    var wrote = false;

    if (reason === 'clamp') {
      setProp(el, 'display', 'block');
      setProp(el, '-webkit-line-clamp', 'none');
      setProp(el, '-webkit-box-orient', 'horizontal');
      setProp(el, 'overflow', 'visible');
      wrote = true;
    } else if (reason === 'nowrap') {
      setProp(el, 'white-space', 'normal');
      setProp(el, 'text-overflow', 'clip');
      setProp(el, 'overflow', 'visible');
      wrote = true;
    } else if (reason === 'height') {
      setProp(el, 'max-height', 'none');
      setProp(el, 'height', 'auto');
      setProp(el, 'overflow', 'visible');
      wrote = true;
    }
    if (!wrote) return false;

    /* 折行质量：款号整体参与折行，长串放不下才允许内部折断 */
    setProp(el, 'word-break', 'normal');
    setProp(el, 'overflow-wrap', 'break-word');

    /* 折成两行以上才补留白（单行名字保持平台原样） */
    try {
      var cs = window.getComputedStyle ? window.getComputedStyle(el) : null;
      var fs = cs ? parseFloat(cs.fontSize) || 14 : 14;
      var lh = cs ? parseFloat(cs.lineHeight) : NaN;
      if (!isFinite(lh) || lh <= 0) lh = fs * 1.43;
      if (el.scrollHeight > lh * 1.6) {
        setProp(el, 'line-height', '1.55');
        setProp(el, 'padding-bottom', '2px');
      }
    } catch (e) { /* 量不到就按单行处理，不因为量尺寸失败而整条放弃 */ }

    try { el.setAttribute(MARK, '1'); } catch (e4) { /* 忽略 */ }
    if (!appliedAt) appliedAt = Date.now();

    /* 「尽量两行」（2026-11-01 用户定）：解截断后量自然行数，超过两行就钳回两行。
     * 顺序必须是「先解截断、再量、再钳」—— 不先解开就量不到真实自然行数。 */
    capLines(el);
    return true;
  }

  /**
   * 解截断之后这个名称**自然要占几行**。
   * 量不到（节点没渲染 / 老内核兼容）返回 0，调用方按「不知道」处理：不钳。
   */
  function naturalLines(el) {
    if (!el) return 0;
    var lh = 0;
    try {
      var cs = window.getComputedStyle ? window.getComputedStyle(el) : null;
      lh = cs ? parseFloat(cs.lineHeight) : NaN;
      if (!isFinite(lh) || lh <= 0) lh = (cs ? parseFloat(cs.fontSize) : 14) * 1.43;
    } catch (e) { lh = 0; }
    if (!(lh > 0)) lh = 20;
    var h = el.scrollHeight || 0;
    if (!(h > 0)) return 0;
    return Math.round(h / lh);
  }

  /**
   * 超过 MAX_LINES 行才钳（带省略号）。
   *
   * 用户原话：「商品管理的商品名字，尽量两行可以做到吗」——
   * 「尽量」二字落到代码里不是死磕两行，而是**两行优先**：
   *   1 行 / 2 行装得下 ⇒ 完整显示，一个字不藏；
   *   两行差几个字符装不下 ⇒ 放宽到第 3 行（2026-11-01 两次截图都卡在最后几个字）；
   *   3 行还装不下 ⇒ 钳 3 行加省略号，别让超长名一路撑到五行把列表拉散。
   *
   * 两道并列手段（老内核只认其中之一也能挡住）：
   *   · `-webkit-line-clamp:N` —— 现代内核的标准做法，带省略号；
   *   · `max-height = N × 行高` —— 不认 -webkit-box 的内核靠它保底（无省略号但不会撑高）。
   */
  function capLines(el) {
    var lines = naturalLines(el);
    if (!lines || lines <= MAX_LINES) return false;
    setProp(el, 'display', '-webkit-box');
    setProp(el, '-webkit-box-orient', 'vertical');
    setProp(el, '-webkit-line-clamp', String(MAX_LINES));
    setProp(el, 'overflow', 'hidden');
    setProp(el, 'text-overflow', 'ellipsis');
    try {
      var cs = window.getComputedStyle ? window.getComputedStyle(el) : null;
      var lh = cs ? parseFloat(cs.lineHeight) : NaN;
      if (!isFinite(lh) || lh <= 0) lh = (cs ? parseFloat(cs.fontSize) : 14) * 1.43;
      if (lh > 0) setProp(el, 'max-height', (Math.ceil(lh * MAX_LINES) + 1) + 'px');
    } catch (e) { /* 量不到行高就只靠 line-clamp */ }
    return true;
  }

  /** 还原一个元素上我们写过的全部内联属性（关开关 / 行被回收时） */
  function restoreOne(el) {
    if (!el || !el.__dycShopNameOrig) return;
    var bak = el.__dycShopNameOrig;
    for (var prop in bak) {
      if (!Object.prototype.hasOwnProperty.call(bak, prop)) continue;
      try {
        if (bak[prop].v) el.style.setProperty(prop, bak[prop].v, bak[prop].p || '');
        else el.style.removeProperty(prop);
      } catch (e) { /* 忽略单条失败 */ }
    }
    el.__dycShopNameOrig = null;
    try { el.removeAttribute(MARK); } catch (e2) { /* 忽略 */ }
  }

  /**
   * 复核 + 补涂一个名称元素。
   * 标记在、但计算值仍是截断态 ⇒ 平台把 style 洗掉了，重写一遍（重写不重复备份）。
   */
  function refreshName(el) {
    if (!el || !el.isConnected) return false;
    var reason = truncationReason(el);
    if (!reason) {
      /* 已经不截断了：可能是我们写的，也可能是平台自己放开了。都不动。 */
      return false;
    }
    return applyUnclip(el, reason);
  }

  /** 行还在不在文档里（平台换页 / 换筛选会把整行销毁） */
  function rowAlive(row) {
    if (!row) return false;
    if (typeof document.contains === 'function') return document.contains(row);
    return !!(row.isConnected);
  }

  /* ==========================================================
   * 右侧空位 → 名字列加宽（2026-11-01 用户定）
   * ----------------------------------------------------------
   * 用户原话：「右边还有很大空位」。该页是 ecom-g-table（table-layout:fixed），
   * 列宽由平台按固定值下发，名字那一格很窄，两行装不下多少字。
   *
   * 判据全部可量，不做任何猜测：
   *   gap = 表格容器的可视宽 − 表格实宽。
   *   · gap ≥ WIDEN_MIN_GAP（60px）才有「空位可分配」，此时把 gap 减掉 16px
   *     余量后**一次性加给名字列**；
   *   · gap 不够就**一个字都不动** —— 硬挤别的列会让表头与数据错位，
   *     代价远大于收益（这是「量不到或不安全就退回只钳两行」的落地）。
   *
   * 写法上 `colgroup > col` 优先（fixed 布局下列宽由它决定），表头 TH 一并写：
   * 有的表没有 colgroup，靠首行单元格定宽。两处都记原值，关开关逐个还原。
   * ========================================================== */

  /** 还原一条内联属性到备份值 */
  function restoreStyleProp(el, prop, prev) {
    if (!el || !el.style) return;
    try {
      if (!prev || !prev.v) el.style.removeProperty(prop);
      else el.style.setProperty(prop, prev.v, prev.pri || '');
    } catch (e) { /* 忽略单条失败 */ }
  }

  /** 还原一张表上我们改过的列宽 */
  function restoreOneTable(table) {
    if (!table) return;
    var o = table.__dycWideOrig;
    if (o) {
      restoreStyleProp(o.colEl, 'width', o.colPrev);
      restoreStyleProp(o.thEl, 'width', o.thPrev);
      restoreStyleProp(o.cellEl, 'width', o.cellPrev);
    }
    table.__dycWideOrig = null;
    table.__dycWideState = '';
    table.__dycWideTarget = 0;
  }

  /** 还原所有加宽过的表格（关开关 / 窗口缩放时调用） */
  function restoreColumns() {
    for (var i = 0; i < widenedTables.length; i++) restoreOneTable(widenedTables[i]);
    widenedTables = [];
  }

  /** 还原「解除宽度上限」动过的容器（关开关时调用，与列宽分开记） */
  function restoreCaps() {
    for (var i = 0; i < cappedEls.length; i++) restoreOne(cappedEls[i]);
    cappedEls = [];
  }

  /**
   * 名字所在的「格子」。
   *
   * 优先 `<td>`；抖店这张表是 ant 系，多数情况有 td，但不排除某些皮肤用
   * `<div role="gridcell">` 或 `display:table-cell` 的 div 模拟表格 ——
   * 那样 `closest('td')` 返回 null，上一版就直接放弃了（列宽一点没动）。
   * 这里补两条退路，拿到的元素只用于「量宽度 / 解除宽度上限」，不改它的结构。
   */
  function cellOf(el) {
    if (!el) return null;
    try { var td = el.closest ? el.closest('td') : null; if (td) return td; } catch (e) { /* 继续找 */ }
    try {
      var node = el;
      var depth = 0;
      while (node && node !== document.body && depth < 8) {
        var role = node.getAttribute ? node.getAttribute('role') : '';
        if (role === 'gridcell' || role === 'cell') return node;
        var cs = window.getComputedStyle ? window.getComputedStyle(node) : null;
        if (cs && cs.display === 'table-cell') return node;
        node = node.parentElement;
        depth++;
      }
    } catch (e2) { /* 找不到就返回 null */ }
    return null;
  }

  /** 把量到的事实写进诊断轨迹（`复制诊断报告` 能带出去；只在首次与异常时写，别刷屏） */
  function noteFact(text) {
    try {
      if (window.__dycDiag && typeof window.__dycDiag.note === 'function') {
        window.__dycDiag.note('商品名排版', text);
      }
    } catch (e) { /* 诊断不可用不影响功能 */ }
  }

  /**
   * 解除「名字这一列内部」的宽度上限。
   *
   * 为什么需要这一步：两行仍被省略号截断（用户 2026-11-01 截图：差一个款号），
   * 而列宽若已经加过，说明**卡住的是格子内部** —— 平台常给名字容器写死
   * `max-width` / 固定 `width`，列变宽了它也不跟着变。
   * 只处理 el 到 cell 之间不带 inline 的层（最多 6 层），且只在
   * 「确实比格子窄」时才改，避免无谓地动布局。
   */
  function releaseWidthCaps(el, cell) {
    if (!el || !cell) return 0;
    var cellW = 0;
    try { cellW = cell.getBoundingClientRect().width; } catch (e) { cellW = 0; }
    if (!(cellW > 0)) return 0;
    var touched = 0;
    var node = el;
    var depth = 0;
    while (node && node !== cell && depth < 6) {
      if (releaseOneWidth(node, cellW)) touched++;
      node = node.parentElement;
      depth++;
    }
    return touched;
  }

  function releaseOneWidth(node, cellW) {
    if (!node || node.nodeType !== 1) return false;
    var cs = null;
    try { cs = window.getComputedStyle ? window.getComputedStyle(node) : null; } catch (e) { return false; }
    if (!cs) return false;
    var disp = cs.display || '';
    if (disp === 'inline' || disp === 'contents') return false;
    var touched = false;

    var mw = parseFloat(cs.maxWidth);
    if (isFinite(mw) && mw > 0 && mw < cellW - 8) {
      setProp(node, 'max-width', 'none');
      touched = true;
    }
    var w = parseFloat(cs.width);
    /* 明显窄于格子的固定宽度容器 → 交还 auto，跟着加宽后的格子走 */
    if (isFinite(w) && w > 0 && w < cellW - 24) {
      setProp(node, 'width', 'auto');
      touched = true;
    }
    if (touched && cappedEls.indexOf(node) < 0) cappedEls.push(node);
    return touched;
  }

  /**
   * 名字列加宽。
   *
   * @return {string} 'done' 已加宽 / 'no-effect' 写了但列宽没变 /
   *                  'no-gap' 没空位 / 'no-cell' 找不到格子 / 'no-table' 找不到表
   */
  function widenNameColumn(el) {
    if (!el) return 'no-cell';
    var td = cellOf(el);
    if (!td) return 'no-cell';
    var table = null;
    try { table = td.closest ? td.closest('table') : null; } catch (e) { table = null; }
    if (!table) return 'no-table';

    /* 已经试过且确认写不进去 —— 别每轮白写一遍 */
    if (table.__dycWideState === 'no-effect') return 'no-effect';

    /* 已经加宽过：复核一次列宽有没有被平台重渲染洗回去 */
    if (table.__dycWideState === 'done') {
      var target = table.__dycWideTarget || 0;
      var now = 0;
      try { now = Math.round(td.getBoundingClientRect().width); } catch (e3) { now = 0; }
      if (target && Math.abs(now - target) <= 2) return 'done';
      table.__dycWideState = '';   // 被洗掉了，落回重来
    }
    if (table.__dycWideState === 'no-gap') {
      /* 上一轮判过没空位。但平台重排后空位可能变了，隔一段时间重判一次 */
      if (Date.now() - (table.__dycGapAt || 0) < 8000) return 'no-gap';
    }

    var box = table.parentElement;
    if (!box) return 'no-table';
    var boxW = 0;
    var tableW = 0;
    try {
      boxW = box.getBoundingClientRect().width;
      tableW = table.getBoundingClientRect().width;
    } catch (e4) { return 'no-table'; }
    if (!(boxW > 0) || !(tableW > 0)) return 'no-table';

    var gap = boxW - tableW;
    if (!(gap >= WIDEN_MIN_GAP)) {
      table.__dycWideState = 'no-gap';
      table.__dycGapAt = Date.now();
      return 'no-gap';
    }

    var idx = typeof td.cellIndex === 'number' ? td.cellIndex : -1;
    var add = Math.floor(gap - WIDEN_KEEP);
    if (!(add > 0)) {
      table.__dycWideState = 'no-gap';
      table.__dycGapAt = Date.now();
      return 'no-gap';
    }

    var cellW = 0;
    try { cellW = Math.round(td.getBoundingClientRect().width); } catch (e5) { cellW = 0; }
    if (!(cellW > 0)) return 'no-cell';
    var newW = cellW + add;

    var orig = { colEl: null, colPrev: null, thEl: null, thPrev: null, cellEl: null, cellPrev: null };

    /* ① colgroup > col：fixed 布局下列宽的真源头 */
    var col = null;
    if (idx >= 0) {
      try {
        var cols = table.querySelectorAll('colgroup > col');
        if (cols && cols.length > idx) col = cols[idx];
      } catch (e6) { col = null; }
    }
    if (col && col.style) {
      orig.colEl = col;
      orig.colPrev = { v: col.style.getPropertyValue('width'), pri: col.style.getPropertyPriority('width') };
      try { col.style.setProperty('width', newW + 'px'); } catch (e7) { /* 忽略 */ }
    }

    /* ② 表头首行：有的表没有 colgroup，靠首行单元格定宽 */
    var th = null;
    if (idx >= 0) {
      try {
        th = (table.tHead && table.tHead.rows && table.tHead.rows[0]) ? table.tHead.rows[0].cells[idx] : null;
      } catch (e8) { th = null; }
    }
    if (th && th.style) {
      orig.thEl = th;
      orig.thPrev = { v: th.style.getPropertyValue('width'), pri: th.style.getPropertyPriority('width') };
      try { th.style.setProperty('width', newW + 'px'); } catch (e9) { /* 忽略 */ }
    }

    /* ③ 单元格本身（2026-11-01 补）：上一版只写 col / 表头，而这张表的表头
     * 未必是 <thead>、也未必挂 colgroup —— 那时两处都拿不到，列宽一点没动，
     * 用户看到的就是「两行还是被省略号截掉」。单元格宽度是最保底的一处写入点：
     * fixed 布局下列宽由首行单元格决定，写它总有一线机会；被 col 接管时也无害。 */
    if (td.style) {
      orig.cellEl = td;
      orig.cellPrev = { v: td.style.getPropertyValue('width'), pri: td.style.getPropertyPriority('width') };
      try { td.style.setProperty('width', newW + 'px'); } catch (e10) { /* 忽略 */ }
    }

    table.__dycWideState = 'done';
    table.__dycWideTarget = newW;
    table.__dycWideOrig = orig;
    widenedTables.push(table);

    /* 写完立刻量一次：宽度没变说明这页的列宽写不进去（被内联 !important / 平台
     * 强制重排接管），记成 no-effect 并写一条诊断，别每轮白试一遍。 */
    var after = 0;
    try { after = Math.round(td.getBoundingClientRect().width); } catch (e11) { after = 0; }
    if (after && Math.abs(after - newW) > 6) {
      table.__dycWideState = 'no-effect';
      noteFact('列宽写不进去（格 ' + cellW + '→实测 ' + after + '，目标 ' + newW + '，空位 ' + Math.round(gap) + '）');
      return 'no-effect';
    }
    noteFact('列宽 ' + cellW + '→' + newW + '（空位 ' + Math.round(gap) + '）');
    return 'done';
  }

  /* 重新枚举商品行（只在缓存失效时跑，避免每轮全页扫「编辑」文本） */
  function collectRows() {
    var out = [];
    if (typeof findProductRows !== 'function') return out;
    var list = null;
    try { list = findProductRows(); } catch (e) { list = null; }
    if (!list || !list.length) return out;
    for (var i = 0; i < list.length; i++) {
      if (list[i] && list[i].row) out.push(list[i].row);
    }
    return out;
  }

  /** 一轮扫描：先看缓存行，坏了再整体重采 */
  function scan() {
    if (!on) return 0;
    var alive = true;
    for (var i = 0; i < rowCache.length; i++) {
      if (!rowAlive(rowCache[i])) { alive = false; break; }
    }
    if (!rowCache.length || !alive) rowCache = collectRows();

    var count = 0;
    for (var k = 0; k < rowCache.length; k++) {
      var row = rowCache[k];
      if (!rowAlive(row)) continue;
      var el = row.__dycNameEl;
      /* 缓存的名称元素被重渲染换掉了 ⇒ 重新找一次 */
      if (!el || !el.isConnected || (row.contains && !row.contains(el))) {
        el = findNameInRow(row);
        row.__dycNameEl = el || null;
      }
      if (!el) continue;
      /* ① 先给名字列腾地方（找出名称元素才知道是哪一格）；
       * ② 再解除格子内部的宽度上限（列变宽了，容器写死宽也不会跟着变）；
       * ③ 最后解截断 + 按新宽度量行数。顺序反了会拿窄宽度算行数，白钳一遍。 */
      widenNameColumn(el);
      var cell = cellOf(el);
      if (cell) releaseWidthCaps(el, cell);
      if (refreshName(el)) count++;
    }
    /* 排版类改动一律静默生效（用户 2026-11-01：「这个功能不需要弹提示」）。
     * 列宽到底改没改，证据在 __dycDiag 的「商品名排版」轨迹里，不在消息里。 */
    return count;
  }

  /** 排一次防抖扫描（配最长等待，别被持续变更无限推后） */
  function scheduleScan() {
    if (!on) return;
    var now = Date.now();
    if (!queuedAt) queuedAt = now;
    if (now - queuedAt >= SCAN_MAX_WAIT) {
      if (debounceTimer) { clearTimeout(debounceTimer); debounceTimer = null; }
      queuedAt = 0;
      scan();
      return;
    }
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(function () {
      debounceTimer = null;
      queuedAt = 0;
      scan();
    }, SCAN_DEBOUNCE);
  }

  /* ---------- 起停 ---------- */

  function clearBootTimers() {
    for (var i = 0; i < bootTimers.length; i++) clearTimeout(bootTimers[i]);
    bootTimers = [];
  }

  /** 窗口缩放：空位重算 —— 先把加过的列宽全部还原，再重扫一次 */
  function onResize() {
    if (!on) return;
    restoreColumns();
    scheduleScan();
  }

  function stopAll() {
    if (observer) {
      try { observer.disconnect(); } catch (e) { /* 忽略 */ }
      observer = null;
    }
    if (debounceTimer) { clearTimeout(debounceTimer); debounceTimer = null; }
    queuedAt = 0;
    clearBootTimers();
    if (resizeBound) {
      try { window.removeEventListener('resize', onResize); } catch (e) { /* 忽略 */ }
      resizeBound = false;
    }
    /* 关开关 = 恢复平台原样（用户随时能退回「截断 + 原列宽」形态） */
    restoreColumns();
    restoreCaps();
    for (var i = 0; i < rowCache.length; i++) {
      var row = rowCache[i];
      if (!row) continue;
      restoreOne(row.__dycNameEl);
      row.__dycNameEl = null;
    }
    rowCache = [];
  }

  function startAll() {
    scan();
    if (!resizeBound) {
      try { window.addEventListener('resize', onResize); resizeBound = true; } catch (e) { resizeBound = false; }
    }
    if (typeof MutationObserver === 'function' && document.body) {
      observer = new MutationObserver(function () { scheduleScan(); });
      try {
        observer.observe(document.body, { childList: true, subtree: true });
      } catch (e) {
        observer = null;
      }
    }
    clearBootTimers();
    for (var i = 0; i < BOOT_DELAYS.length; i++) {
      bootTimers.push(setTimeout(function () { if (on) scan(); }, BOOT_DELAYS[i]));
    }
  }

  function setOn(next) {
    var want = next !== false;
    if (want === on) return;
    on = want;
    if (!on) { stopAll(); return; }
    startAll();
  }

  /* ---------- 开关 ---------- */

  var prevOn = null;
  function wire() {
    try {
      dycReadFlags().then(function (flags) {
        var want = !!(flags && flags.shopListNameWrap !== false);
        prevOn = want;
        setOn(want);
      });
    } catch (e) { /* 读不到就按默认开走 */ setOn(true); }

    if (typeof dycWatchFlags === 'function') {
      try {
        dycWatchFlags(function (flags) {
          var want = !!(flags && flags.shopListNameWrap !== false);
          if (prevOn !== null && want !== prevOn && typeof toast === 'function') {
            toast(want ? '已开启' : '已关闭', 'info', { source: '商品全名' });
          }
          prevOn = want;
          setOn(want);
        });
      } catch (e2) { /* 订阅失败不影响首帧 */ }
    }
  }

  /* 供调试面板取证：当前处理了几个名称、最后一次写入时间 */
  window.__DYC_SHOP_LIST_NAME_API__ = {
    scan: function () { return scan(); },
    state: function () {
      return { on: on, rows: rowCache.length, appliedAt: appliedAt };
    }
  };

  wire();
})();
