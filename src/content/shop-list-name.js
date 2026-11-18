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
 *   按截断原因给名称元素打**一个状态属性**（样式见下方【常驻 CSS】），不碰结构：
 *     · nowrap 型（单行省略号）/ line-clamp 型（钳行）/ 定高型 ⇒ 一律 OPEN 属性，
 *       规则里已包含 white-space:normal、去 line-clamp、overflow:visible、解 max-height；
 *     · 折成两行以上再补 MULTI 属性（行距与下内边距），单行名字保持平台原样；
 *     · 超过三行换 CAP 属性（钳三行 + 省略号）。
 *
 * 【为什么不写内联样式（2026-11-18 治抖，口径同素材页 / 多地址退货页）】
 *
 *   真机现象：抖店商品管理页鼠标指向商品时，名称在 1 行与多行之间来回跳，
 *   行高跟着变，整行内容上下抖。
 *   根因：解截断原本写的是内联样式，而平台重渲染会整段重写 style 属性，
 *   我们的值被抹掉 ⇒ 计算值回到截断态 ⇒ 下一轮扫描又写回去。
 *   每一轮都是「解开 → 变高 → 被洗回 → 再解开」，用户看到的就是抖动。
 *   → 改成「元素属性 + 常驻 CSS 规则（!important）」：平台洗得掉内联，
 *     洗不掉属性；属性在规则就在，显示稳定，循环自然断开。
 *
 *   配套两条硬约束：
 *     · truncationReason 见到状态属性**直接判「不再截断」**（断环口，不能省）；
 *     · 关开关 / 窗口缩放要逐个摘属性，否则规则一直匹配，页面回不到原样。
 *
 * 【鼠标悬停的那一块一律不写（2026-11-18 第二版，治「指上去就抖」）】
 *
 *   真机证据（用户两张截图对比）：鼠标进入商品行时，平台会把商品信息切成**宽布局** ——
 *   名称列变宽、右侧这时才出现价格与编辑图标，末尾货号被挤到下一行。也就是说
 *   **hover 期间布局还在变**。而我们每轮扫描都会做两件"按当前宽度算"的事：
 *     · widenNameColumn —— 列宽目标按 gap 现算，hover 一变宽就判「没加过」重新加宽；
 *     · releaseWidthCaps —— 只在「容器比格子窄」时写，宽度一变就满足条件。
 *   两边互相踢：我们加宽 → 表格重排 → hover 布局再变 → 我们再算再加宽 …… 就是抖动。
 *   所以：**hover 落在哪一行/哪张卡，那一块不写；鼠标在页面上时列宽整体不写**；
 *   鼠标离开 300ms 后再补（避开平台收拢布局的那一下）。解截断是幂等的，照常跑。
 *
 *   ⚠️ 代价：hover 期间若平台换掉了节点，新节点上没有属性，会短暂显示成平台的截断态，
 *   鼠标移开 300ms 后补上。这是刻意取舍 —— 宁可晚一帧，也不在鼠标底下改布局。
 *
 * 【块高锁（2026-11-18 第三版，治「指上去就折成三行」）】
 *
 *   用户原话：「只要鼠标指到那一方，哪一行就会折成三行导致跳动」。
 *   原因不是谁洗样式，而是**「完整显示」和「悬停变窄」的根本冲突**：
 *   平台在 hover 时把名称区压窄（给价格与编辑图标让位），我们解开后的名称就多折一行，
 *   块变高，整行随之下移。只要行数跟着宽度变，就必然抖。
 *   → 解开时按**当时量到的行数**把块高锁死（h="2" / h="3"，值即行数）：
 *     之后宽度再怎么变，盒子就这个高，多出来的行裁在盒子里，行高恒定。
 *   hover 期间若节点被换新导致锁丢失，relock() 按缓存行数直接补锁 —— 只写属性、
 *   不做任何测量，所以补锁本身不会引发新的布局计算。
 *   代价：悬停如果让名称变窄到装不下，最后一行会被裁掉（此刻本来就看不全）；
 *   鼠标移开后重新扫描才按新宽度重算。
 *
 * 【幂等 = 属性 + 计算值双判据】
 *
 *   属性在 ⇒ 规则已接管，不再重复读写（这就是上面那条断环口）。
 *   属性被抹（平台换了新节点）⇒ 计算值回到截断态，重新打一次；重复打不重复备份。
 *   列宽仍需复核「名字格当前宽是否仍等于我们设的目标」，被洗掉就重算重写。
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
  /* 解截断的两个状态属性 + 常驻 CSS（2026-11-18 治抖，口径同素材页/退货页）：
   *   OPEN_ATTR  = 完整显示（display:block / 去 line-clamp / overflow:visible ...）
   *   CAP_ATTR   = 超过三行的钳回三行
   *   MULTI_ATTR = 折成两行以上才补行距与下内边距（单行保持平台原样）
   * 样式由本模块注入的 <style> 提供，带 !important。平台重渲染只洗内联 style，
   * 洗不掉属性 —— 这是「解开 → 被洗回 → 再解开」死循环的断点。 */
  var OPEN_ATTR = 'data-dyc-nameopen';
  var CAP_ATTR = 'data-dyc-namecap';
  var MULTI_ATTR = 'data-dyc-namemulti';
  /* 块高锁：值是行数（"2" / "3"）。见 lockHeight() —— 这是治「悬停变窄就折行跳」的那把锁。 */
  var H_ATTR = 'data-dyc-nameh';
  var STYLE_ID = 'dyc-shopname-style';
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
  /* 打过名称状态属性的元素（关开关 / 窗口缩放时按它摘属性；节点换新即失效，不泄漏） */
  var touchedNames = [];
  /* 窗口缩放监听是否已挂（缩放后空位变了，列宽要全部撤销重算） */
  var resizeBound = false;
  var queuedAt = 0;
  /* 行缓存：避免每轮都跑一次全页「编辑」文本扫描 */
  var rowCache = [];
  /* 首次成功展开过没有 —— 只用来给调试留痕，不弹消息 */
  var appliedAt = 0;
  /* 上一轮解开数 / 上次记诊断的时间：用来在诊断报告里暴露「解开数来回跳」（抖动证据） */
  var lastCount = -1;
  var lastNoteAt = 0;
  /* 鼠标当前悬停的目标元素（2026-11-18 治抖第二版）。
   *
   * 真机证据（用户两张截图）：鼠标进入商品行时，平台会把整块商品信息切成**宽布局** ——
   * 名称列变宽、右侧这时才出现价格与编辑图标，折行位置也跟着变（末尾货号被挤到下一行）。
   * 布局在 hover 期间还在变，我们就写列宽 / 解截断 / 量行数，两边互相踢：
   *   我们加宽 → 平台收拢 → 我们复核「目标宽对不上」→ 再加宽 …… 鼠标指哪儿抖哪儿。
   * 所以：hover 落在哪一行（或哪张商品卡），那一块一律不写；鼠标离开 300ms 后再补。
   * 属性方案照旧 —— 鼠标没落在的行，命中属性就不再重复写。 */
  var hoverTarget = null;
  var hoverTimer = null;
  var hoverBound = false;
  /* 离开后等这么久再补：平台收拢布局有一下过渡，太早补会自己制造第二次跳动 */
  var HOVER_SETTLE = 300;

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

  /** 这个名称元素是否已由我们的常驻规则接管（属性在 ⇒ 规则在，平台洗不掉） */
  function isHandled(el) {
    if (!el || !el.getAttribute) return false;
    try {
      return !!(el.getAttribute(OPEN_ATTR) || el.getAttribute(CAP_ATTR));
    } catch (e) { return false; }
  }

  /**
   * 这个元素现在被**哪一种**方式截断。
   *
   * @return {string} 'clamp' | 'nowrap' | 'height' | ''（空串 = 没截断）
   */
  function truncationReason(el, raw) {
    if (!el || !el.getBoundingClientRect) return '';
    /* ★ 断环口（2026-11-18）：属性在 ⇒ 常驻规则已接管，不再判它「被截断」。
     * 不这么写就会每轮看到 CAP 态里的 line-clamp:3 或 OPEN 后量到的溢出，
     * 于是「解开 → 钳回 → 再解开」无限循环 —— 用户看到的就是名称行高来回跳。
     * raw=true 时按计算值原样判，给 findNameInRow 复选候选用。 */
    if (!raw && isHandled(el)) return '';
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
        /* 截断可能落在 <a> 自己，也可能落在它的包裹层。
         * 已由常驻规则接管的（属性在）也算命中 —— 行被重渲染后要能认回同一个。 */
        if (truncationReason(a) || isHandled(a)) return a;
        var pa = a.parentElement;
        if (pa && !isOurNode(pa) && (truncationReason(pa) || isHandled(pa))) return pa;
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
      /* raw=true：按计算值原样判，不受「属性在就不算截断」影响 */
      if (!truncationReason(cand, true) && !isHandled(cand)) continue;
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
    if (reason !== 'clamp' && reason !== 'nowrap' && reason !== 'height') return false;

    /* 只打属性、不写内联 —— 具体样式由常驻 CSS 提供。
     * 平台重渲染会整段重写 style 属性（我们的内联被抹掉），但不动属性，
     * 所以「属性在 ⇒ 规则在 ⇒ 显示就是解开的」，不会再回到截断态。 */
    try {
      el.setAttribute(OPEN_ATTR, '1');
      el.removeAttribute(CAP_ATTR);
      el.setAttribute(MARK, '1');
    } catch (e) { return false; }

    if (touchedNames.indexOf(el) < 0) touchedNames.push(el);
    if (!appliedAt) appliedAt = Date.now();

    /* 折成两行以上才补行距与下内边距（规则生效后才量得到真实行数） */
    var lines = naturalLines(el);
    try {
      if (lines >= 2) el.setAttribute(MULTI_ATTR, '1');
      else el.removeAttribute(MULTI_ATTR);
    } catch (e2) { /* 忽略 */ }

    /* ★ 锁块高（2026-11-18 第三版，治「指上去折成三行」）：
     * 平台在 hover 时会把名称区压窄给价格/编辑图标让位，解开后的名称就多折一行、
     * 块变高、整行跳动。把块高按**当前行数**锁死之后，宽度再怎么变，块高都不变，
     * 行高自然不动（多出来的行被裁在盒子里，鼠标移开重算时再放开）。
     * 记到元素上也记到行上：hover 期间节点被平台换新时，按缓存行数直接补锁，不重新量。 */
    lockHeight(el, lines);

    /* 「两行优先、最多三行」：超过三行就换成 CAP 属性（钳三行 + 省略号） */
    capLines(el);
    return true;
  }

  /**
   * 按行数锁死块高（2 行 / 3 行）。
   * 行数未知（0）或多个行数时不动 —— 不知道就别锁，免得把内容裁错。
   */
  function lockHeight(el, lines) {
    if (!el || !el.setAttribute) return;
    try {
      if (lines === 2) el.setAttribute(H_ATTR, '2');
      else if (lines === 3) el.setAttribute(H_ATTR, '3');
      else el.removeAttribute(H_ATTR);
    } catch (e) { /* 忽略 */ }
    if (lines === 2 || lines === 3) el.__dycNameLines = lines;
  }

  /**
   * hover 期间唯一允许的写操作：把丢失的块高锁按**缓存行数**补回去。
   *
   * 平台在 hover 时若换掉节点，属性会跟着节点一起没了 —— 那一刻盒子会变回"随宽度折行"，
   * 又开始跳。这里不做任何测量（不量宽、不量行数），只把缓存的行数写回属性，
   * 所以补锁本身不会引发布局重算，也就不会自己制造抖动。
   */
  function relock(row) {
    if (!row) return;
    var el = row.__dycNameEl;
    if (!el || !el.isConnected || (row.contains && !row.contains(el))) return;
    var n = el.__dycNameLines || 0;
    if (n !== 2 && n !== 3) return;
    try {
      if (el.getAttribute && el.getAttribute(H_ATTR) === String(n)) return;   /* 锁还在 */
      el.setAttribute(OPEN_ATTR, '1');
      el.setAttribute(MULTI_ATTR, '1');
      el.setAttribute(H_ATTR, String(n));
    } catch (e) { /* 忽略 */ }
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
   * 具体钳法在常驻 CSS 的 CAP 规则里（line-clamp:N + max-height 兜底），
   * 这里只负责「要不要钳」以及切属性（2026-11-18 起不再写内联）。
   */
  function capLines(el) {
    if (!el) return false;
    var lines = naturalLines(el);
    /* 量不到行数（节点还没渲染 / 老内核量不出）⇒ 不知道就不钳，别乱改 */
    if (!lines || lines <= MAX_LINES) return false;
    /* 换成 CAP 属性：摘掉 OPEN 与块高锁，规则来自常驻 CSS（带 !important 压过平台类样式） */
    try {
      el.removeAttribute(OPEN_ATTR);
      el.removeAttribute(H_ATTR);
      el.setAttribute(CAP_ATTR, '1');
    } catch (e) { return false; }
    return true;
  }

  /** 关开关 / 行回收：摘状态属性 + 还原我们写过的内联（列宽等） */
  function restoreOne(el) {
    if (!el) return;
    /* 先摘状态属性：常驻规则靠它们匹配，属性一去就回到平台原样。
     * ⚠️ 不能早退于「没有内联备份」—— 属性方案下名称元素上通常没有内联可还原
     * （解截断不再写内联），老实现第一行判空就 return，关开关后名称仍是展开态。 */
    clearNameAttrs(el);

    var bak = el.__dycShopNameOrig;
    if (!bak) return;
    for (var prop in bak) {
      if (!Object.prototype.hasOwnProperty.call(bak, prop)) continue;
      try {
        if (bak[prop].v) el.style.setProperty(prop, bak[prop].v, bak[prop].p || '');
        else el.style.removeProperty(prop);
      } catch (e) { /* 忽略单条失败 */ }
    }
    el.__dycShopNameOrig = null;
  }

  /** 摘掉一个名称元素上的全部状态属性（关开关 / 宽度重判时用） */
  function clearNameAttrs(el) {
    if (!el) return;
    try {
      el.removeAttribute(OPEN_ATTR);
      el.removeAttribute(CAP_ATTR);
      el.removeAttribute(MULTI_ATTR);
      el.removeAttribute(H_ATTR);
      el.removeAttribute(MARK);
    } catch (e) { /* 忽略 */ }
  }

  /* ---------- 常驻 CSS（2026-11-18 治抖核心）----------
   *
   * 为什么放弃内联：平台重渲染会整段重写 style 属性（我们有极值重要级也照样被抹），
   * 抹掉后计算值回到截断态，下一轮扫描又写回去 —— 每一轮都是「解开 → 变高 →
   * 被洗回 → 再解开」，名称高度在 1 行与多行之间反复跳，鼠标悬停时最明显。
   * 属性不会被平台重写，规则一旦匹配就一直生效，循环就此断开。
   * 选择器不加 html/body 前缀（本页名称都在主文档里，但保持与其它页一致的习惯）。 */
  var CSS = [
    '[' + OPEN_ATTR + '] {',
    '  display: block !important;',
    '  -webkit-line-clamp: none !important;',
    '  -webkit-box-orient: horizontal !important;',
    '  overflow: visible !important;',
    '  max-height: none !important;',
    '  height: auto !important;',
    '  text-overflow: clip !important;',
    '  white-space: normal !important;',
    '  word-break: normal !important;',
    '  overflow-wrap: break-word !important;',
    '}',
    /* 折成两行以上才补行距与下内边距（单行名字保持平台原样） */
    '[' + MULTI_ATTR + '] { line-height: 1.55 !important; padding-bottom: 2px !important; }',
    /* ---------- 块高锁（2026-11-18 第三版）----------
     * 平台在 hover 时把名称区压窄，解开后的名称会多折一行、块变高、整行跳动。
     * 这里按「当时量到的行数」把块高固定住：宽度再怎么变，盒子就这个高，
     * 多出来的行裁在盒子里，行高恒定。
     * 用 em（跟着字号走），1.55em/行 与 MULTI 的行距一致；box-sizing 用 border-box，
     * 这样下内边距不会把盒子顶出去。 */
    '[' + H_ATTR + '] { box-sizing: border-box !important; overflow: hidden !important; padding-bottom: 0 !important; }',
    '[' + H_ATTR + '="2"] { height: 3.1em !important; max-height: 3.1em !important; }',
    '[' + H_ATTR + '="3"] { height: 4.65em !important; max-height: 4.65em !important; }',
    '[' + CAP_ATTR + '] {',
    '  display: -webkit-box !important;',
    '  -webkit-box-orient: vertical !important;',
    '  -webkit-line-clamp: ' + MAX_LINES + ' !important;',
    '  overflow: hidden !important;',
    '  text-overflow: ellipsis !important;',
    /* 老内核兜底：不认 -webkit-box 时靠限高，别让超长名一路把列表撑长
     * （1.6em/行 × 3 行，与 line-height:1.55 留出余量） */
    '  max-height: ' + (MAX_LINES * 1.6) + 'em !important;',
    '}'
  ].join('\n');

  /** 注入常驻样式（本页名称元素都在主文档，不涉及 shadow 树） */
  function ensureStyle() {
    try {
      var head = document.head || document.documentElement;
      if (!head) return;
      if (document.getElementById && document.getElementById(STYLE_ID)) return;
      var st = document.createElement('style');
      st.id = STYLE_ID;
      st.textContent = CSS;
      head.appendChild(st);
    } catch (e) { /* 插不进去也不能退回内联（那正是抖动源），仅失去“稳定”这一层保障 */ }
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
      /* ★ 鼠标正指着这一行 ⇒ 整行不重量、不重写（名称、列宽、解宽度上限全跳过）。
       * 平台此时正在压窄名称区，我们一量一写就跟着折行跳。
       * 唯一例外：节点被换新导致块高锁丢了 ⇒ 按缓存行数补锁（不测量，不会引起新布局）。 */
      if (hoverTarget && isRelated(hoverTarget, row)) {
        relock(row);
        continue;
      }
      var el = row.__dycNameEl;
      /* 缓存的名称元素被重渲染换掉了 ⇒ 重新找一次 */
      if (!el || !el.isConnected || (row.contains && !row.contains(el))) {
        el = findNameInRow(row);
        row.__dycNameEl = el || null;
      }
      if (!el) continue;
      /* 商品卡的名称未必在 tr 里（平台新版结构），再按名称元素判一次悬停 */
      if (hoverTarget && isRelated(hoverTarget, el)) continue;
      /* ① 先给名字列腾地方（找出名称元素才知道是哪一格）；
       * ② 再解除格子内部的宽度上限（列变宽了，容器写死宽也不会跟着变）；
       * ③ 最后解截断 + 按新宽度量行数。顺序反了会拿窄宽度算行数，白钳一遍。
       *
       * ★ ①② 在「鼠标落在页面上」时整体停手：列宽是**表级**的，一行 hover 就会
       *   改变整张表的宽度，我们按新宽度重算再加宽 → 表格重排 → hover 布局再变，
       *   正是那两个截图里「悬停瞬间宽度跳一下」的来源。③ 是幂等的（属性在就不再写），
       *   可以照常跑。 */
      var cell = cellOf(el);
      if (!hoverTarget) {
        widenNameColumn(el);
        if (cell) releaseWidthCaps(el, cell);
      }
      if (refreshName(el)) count++;
    }
    /* 排版类改动一律静默生效（用户 2026-11-01：「这个功能不需要弹提示」）。
     * 列宽到底改没改，证据在 __dycDiag 的「商品名排版」轨迹里，不在消息里。 */
    /* 治抖取证：解开数来回变 = 有东西在反复抹掉成果（含 0 也要记，
     * 否则「N↔0 交替」在报告里看不出来）。每 3 秒最多一条。 */
    if (count !== lastCount) {
      lastCount = count;
      var now = Date.now();
      if (now - lastNoteAt > 3000) {
        lastNoteAt = now;
        noteFact('本轮解开 ' + count + ' 个名称');
      }
    }
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

  /* ---------- 鼠标悬停（治抖第二版，2026-11-18）----------
   *
   * 平台在鼠标进出商品行时会切换商品信息的布局（名称列变宽、价格与编辑图标这时才出现）。
   * 这段时间任何人写布局都会和它互相踢，所以这一块先不写，鼠标走了再补。
   * 用 pointerover / pointerout（capture 阶段）而不是 mousemove：进出才需要处理，
   * 移动不要触发任何计算。
   * ========================================================== */

  /** 两个节点是否在一条链上（自身 / 祖先 / 后代都算） */
  function isRelated(a, b) {
    if (!a || !b) return false;
    if (a === b) return true;
    try { if (a.contains && a.contains(b)) return true; } catch (e) { /* 忽略 */ }
    try { if (b.contains && b.contains(a)) return true; } catch (e2) { /* 忽略 */ }
    return false;
  }

  function onHoverIn(e) {
    var t = e && e.target;
    if (!t || t.nodeType !== 1) return;
    if (isOurNode(t)) return;          /* 自家控件（状态条 / 调试面板）不算悬停商品 */
    hoverTarget = t;
    if (hoverTimer) { clearTimeout(hoverTimer); hoverTimer = null; }
  }

  function onHoverOut(e) {
    var t = e && e.target;
    if (!t) return;
    var to = e.relatedTarget;
    /* 还在同一块里移动（进子元素 / 从子元素出来）⇒ 不算离开 */
    if (to && hoverTarget && isRelated(to, hoverTarget)) return;
    hoverTarget = null;
    if (hoverTimer) clearTimeout(hoverTimer);
    hoverTimer = setTimeout(function () {
      hoverTimer = null;
      scheduleScan();   /* 鼠标走了再补——晚 300ms，避开平台收拢布局的那一下 */
    }, HOVER_SETTLE);
  }

  function bindHover() {
    if (hoverBound) return;
    try {
      document.addEventListener('pointerover', onHoverIn, true);
      document.addEventListener('pointerout', onHoverOut, true);
      hoverBound = true;
    } catch (e) { hoverBound = false; }
  }

  function unbindHover() {
    if (hoverBound) {
      try {
        document.removeEventListener('pointerover', onHoverIn, true);
        document.removeEventListener('pointerout', onHoverOut, true);
      } catch (e) { /* 忽略 */ }
      hoverBound = false;
    }
    hoverTarget = null;
    if (hoverTimer) { clearTimeout(hoverTimer); hoverTimer = null; }
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
    /* 宽度变了行数也会变：把名称上的状态属性摘掉，让下一轮按新宽度重判一次。
     * （CAP 态下变宽本来就会少占行，但「4 行降到 3 行」这类边界值得重判一次） */
    for (var i = 0; i < touchedNames.length; i++) clearNameAttrs(touchedNames[i]);
    touchedNames = [];
    scheduleScan();
  }

  function stopAll() {
    unbindHover();   /* 关开关就彻底撒手：不再跟踪鼠标、不再延时补涂 */
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
    /* 名称元素可能已不在缓存里（行被换掉 / 名称换选过），按 touchedNames 再兜一遍 */
    for (var t = 0; t < touchedNames.length; t++) clearNameAttrs(touchedNames[t]);
    touchedNames = [];
    rowCache = [];
    lastCount = -1;
  }

  function startAll() {
    ensureStyle();   /* 常驻规则先就位，否则打上属性也不会有样式 */
    bindHover();     /* 先知道鼠标在哪，首轮扫描才不会写到手底下的那一行 */
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
