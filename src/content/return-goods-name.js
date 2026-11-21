/**
 * 抖店「商品卡片」· 商品名完整显示 + 货号复制
 * ============================================================
 * 作用页（两页，判据一套通用、开关分页）：
 *   ① 「多地址退货」页 fxg.jinritemai.com/ffa/morder/logistics/*（计划 #139，2026-11-17）
 *   ② 「素材管理」页 fxg.jinritemai.com/ffa/creative/*（2026-11-17 用户要求
 *      「完整名称和复制货号把这两功能兼容到这里」）
 *
 * 两页的共同形态就是「商品卡片 = 缩略图 + 名称(被压成一行) + 一行商品 ID」，
 * 所以判据不做第二份，只有三处按页分派：开关键 / 按钮锚点 / 诊断来源名。
 * 素材页的差别在结构：名称与 ID 行**各套一层**（name-VOjSh9 / productIdWrapper），
 * 按钮必须挂到它们共同的那层、紧跟 ID 行 —— 详见 ensureButton 的注释。
 * ============================================================
 * 【解决什么问题】
 *
 *   抖店后台 物流工具 → 多地址退货 → 新建/编辑策略
 *   （fxg.jinritemai.com/ffa/morder/logistics/policy-edit）里，
 *   已选商品以卡片列表呈现，商品名被平台压成**一行 + 省略号**，
 *   核对「哪些商品挂在这条策略上」时看不全；要拿货号只能回商品列表去查。
 *   用户 2026-11-12 在待办里提的 #139：
 *   「『多退货地址』页支持完整商品名 + 货号复制」。
 *
 * 【页面结构从哪来（如实记）】
 *
 *   结构来自用户 2026-11-17 交来的《页面结构报告》（v26.11.12.3 采集）：
 *     · 13 个商品名元素形态一致：
 *       div.style_productList__bxRwa > div.style_productCard__zUgPp.style_small__bqhb4
 *       > div.style_info__bAbAE > div，盒子 546×22，截断来源 line-clamp:1；
 *     · 该页**没有**表格、没有 iframe，只有一个可滚动容器（左侧菜单）。
 *   报告只采结构、不采内容 —— 所以**卡片里到底有没有「货号」字段无法预知**，
 *   取号只能按「先官方字段、再名称末尾推算」两档走（见下）。
 *
 * 【为什么不写死类名】
 *
 *   `style_productCard__zUgPp` 这类是 CSS Modules 构建哈希，平台一改版就变。
 *   所以本模块的判据全是**可量的行为特征**：
 *     ① 文本像商品名（长度 8~160、不是 ID 行/地址/价格/提示语）；
 *     ② **同块里有缩略图**（img ≥ 24px，图在容器自己的直接子节点上）——
 *        这一条把商品卡与同一页上的地址下拉框区分开
 *        （地址那格也是 line-clamp:1、42 个字）。
 *        另有两条硬排除：祖先带 role=combobox/listbox/option、
 *        或类名含 aurora-select，一律不碰（下拉框里解截断会顶坏弹层布局）。
 *
 *   ⚠️ **「被截断」不是入集条件**（2026-11-17 真机截图后改）：
 *     抽屉里多数商品名两行正好装下、没有省略号。上一版把「真被截断」
 *     当成收集前提，这些卡连「货号」按钮都拿不到 —— 用户看到的就是
 *     「开关开了没变化」。现在截断只决定**要不要解**，不决定**要不要管**。
 *
 *   同块里出现多个候选（名称 / `ID:3854…` 行 / 提示语）时**每张卡只取最长的一条**，
 *   并靠 ID 行 / 提示语判据先排除；判据合起来的效果：**认不出卡片就不做**（诊断里留痕）。
 *   宁可「开关开了没变化」，也不在无关文字上乱插按钮、乱解截断。
 *
 * 【解截断的口径：沿用商品列表那套（三行上限）】
 *
 *   用户 2026-11-01 在两处定过口径：「尽量两行、右边空位也用上」，
 *   落地成「两行优先、最多三行、超过才钳三行加省略号」。本页卡片宽度固定
 *   （546px，无表格列宽可分配），所以只做前半段：解截断 → 量自然行数 →
 *   ≤3 行完整显示、>3 行钳回 3 行。写属性集合与 shop-list-name.js 同源，
 *   便于两处一起排查；**不做列宽加宽**（这页没有表格，没有「空位」可分配）。
 *
 * 【货号：两档，逐级兜底】
 *
 *   ① 官方字段：卡片范围内平台自己写了「货号 xxx」就用它（最可靠）；
 *   ② 名称末尾推算：交给 `src/content/item-code.js` 的 dycPickCodeFromName
 *      —— 判据的**唯一真源**，与中控台 / 罗盘三页同一份规则（3 位下限、
 *      斜杠复合款号、纯尺码排除都在那边维护，本文件不许再抄一份）。
 *   ③ 两档都拿不到 ⇒ 按钮闪「无货号」，**绝不复制半截内容**。
 *
 * 【按钮落点：文档流内插入，不写 left/top】
 *
 *   插在名称元素**之后**（同一父容器里）。绝对定位在中控台踩过三轮坑：
 *   平台 transform 祖先会劫走包含块，按钮反复错位。这里交给平台布局排，
 *   位置随卡片走，不会飘。
 *   父容器若是横向 flex，补一条 flex-wrap:wrap（与微信小店行内按钮同处理），
 *   否则按钮会把名称挤窄。写完记原值，关开关时还原。
 *
 * 【幂等】
 *
 *   平台重渲染会整段重写 style（我们的内联属性被抹掉），也会换掉节点。
 *   所以每轮复核两件事：样式是否又变回截断态（是 ⇒ 重写，重复写不重复备份）、
 *   按钮是否还在父容器里（不在 ⇒ 补插）。只看标记会在「样式被洗」时永久失效。
 *
 * 【开关】
 *
 *   两页各一个键（flags.js，默认开）：退货页 returnGoodsName / 素材页 materialGoodsName。
 *   分开是刻意的：两页场景不同（一个配置退货策略、一个挑素材绑商品），
 *   共用一个键会出现「关掉退货页，素材页跟着没了」的困惑。
 *   关掉即时生效：摘观察器 + 移除已注入按钮 + 还原全部内联属性，页面回原样。
 *
 * 【素材页抖动（2026-11-21 用户：「这个页面会抖动」）】
 *
 *   诊断轨迹里每 4 秒一条「本轮解开 9/10 个名称」—— 解开了、下一轮又要解开，
 *   每一轮都是一次布局变化。三条原因叠加，缺一条都还会抖：
 *     ① **规则注入晚于打属性**：scan 先 applyUnclip 再 ensureButton，而常驻 CSS
 *        原先只在 ensureButton 里注入 ⇒ 首轮属性打了却没有规则，白解一次；
 *        现在 applyUnclip 第一步就 ensureStyleFor(el)。
 *     ② **只解最内层**：素材页名称是 `div.name(209×16) > div(名称文本)`，
 *        外层高度被平台定死 ⇒ 文本就算解成两行也看不见，下一轮照样判截断。
 *        新增 FIT_ATTR：把「真的切了内容」的祖先层一并解锁（只动高度，不动 display）。
 *     ③ **上限挂错了层**：REDO_LIMIT 记在名称节点上，而平台会整段重建表格行，
 *        计数随之归零 ⇒ 上限形同虚设。补两道与节点无关的闸：打摆静默期
 *        （3 秒内重复解开 6 次即静默 30 秒）与 hover 让路（鼠标下的卡片不写）。
 *   兜底取向与商品列表页一致：宁可这一条显示不全，也不让整页一直抖。
 * ============================================================
 */
(function dycReturnGoodsName() {
  'use strict';

  if (window.__DYC_RETURN_GOODS_NAME__) return;   // 防重复注入（SPA 回切 / 脚本重跑）
  window.__DYC_RETURN_GOODS_NAME__ = true;

  if (typeof dycReadFlags !== 'function') return;  // 开关层没就位就静默退出

  /* ---------- 常量 ---------- */

  /* 作用页判据与 flags.js 的 returnPolicy / material 键同口径（模块级自检，防注入到别的页）。
   *
   * ★ 2026-11-17 扩到第二页（用户原话「完整名称和复制货号把这两功能兼容到这里」，
   *   指的是抖店「素材管理」页 /ffa/creative/material-manage-menu）。
   *   两页的共同形态是「商品卡片：缩略图 + 名称（被压成一行）+ 一行商品 ID」，
   *   所以判据一套通用，只有三处按页分派：
   *     ① 开关键：退货页 returnGoodsName / 素材页 materialGoodsName；
   *     ② 按钮锚点：素材页的名称与 ID 行是**兄弟容器**（name / productIdWrapper），
   *        按钮要挂在它们共同的那层（detail）里、紧跟 ID 行，见 anchorHostOf()；
   *     ③ 诊断里的来源名。
   */
  var PAGES = {
    returnPolicy: /^https:\/\/fxg\.jinritemai\.com\/ffa\/morder\/logistics\//,
    material: /^https:\/\/(?:[a-z0-9-]+\.)*jinritemai\.com\/ffa\/creative\//
  };
  var PAGE_FLAG = { returnPolicy: 'returnGoodsName', material: 'materialGoodsName' };
  var PAGE_LABEL = { returnPolicy: '退货地址商品名', material: '素材页商品名' };

  /** 当前命中哪一页；不在作用页返回 '' */
  function pageKey() {
    var href = '';
    try { href = String(location.href || ''); } catch (e) { return ''; }
    for (var k in PAGES) {
      if (PAGES[k] && PAGES[k].test(href)) return k;
    }
    return '';
  }

  /** 当前页对应的开关键（不在作用页时给退货页的，仅供默认值兜底） */
  function flagKeyNow() {
    return PAGE_FLAG[pageKey()] || PAGE_FLAG.returnPolicy;
  }

  var MARK = 'data-dyc-rgname';          // 名称元素上的「我处理过」标记
  /* 解开 / 钳制的**常驻规则标记**（2026-11-17 真机）
   *
   * 为什么不再写内联样式：内联会被平台重渲染洗掉，于是「我们解开 → 平台洗回 →
   * 我们解开」循环 —— 诊断轨迹里就是 `u10 → u0 → u10` 交替，用户看到的是
   * 名称高度在 1 行与 3 行之间反复跳、货号按钮跟着上下抖。
   * 改成属性标记后，实际样式由注入的 <style> 常驻提供（带 !important）：
   * 平台洗内联对我们毫无影响，只要属性还在就一直完整显示。
   * 属性若也被洗掉，下一轮重新打上即可（一次 setAttribute，不重排多个属性）。 */
  var OPEN_ATTR = 'data-dyc-rgopen';
  var CAP_ATTR = 'data-dyc-rgcap';
  /* 2026-11-21：**祖先层**的高度/裁切解锁标记。素材页把名称定死在 16px 高
   * （见下方 fitChain），只解名称本身等于没解 —— 内容照样被祖先裁掉，
   * 下一轮又判「截断」，于是每轮重写一次 = 用户说的抖动。 */
  var FIT_ATTR = 'data-dyc-rgfit';
  /* 按钮定位上下文 / 父容器换行：同样走属性 + 常驻规则。
   * 2026-11-21 一并改 —— 这两处原先写内联，平台每轮重渲染洗掉、我们每轮重写，
   * 也是「一直抖」的一部分（尤其 flex-wrap 会真改布局）。 */
  var HOST_ATTR = 'data-dyc-rghost';
  var WRAP_ATTR = 'data-dyc-rgwrap';

  var BTN_ATTR = 'data-dyc-rg-btn';      // 我们注入的按钮（读页面文本时整棵跳过）
  var BTN_CLASS = 'dyc-rg-btn';
  var STYLE_ID = 'dyc-rg-style';

  /* 名称最多显示几行：与 shop-list-name.js 同一口径（两行优先、三行兜底） */
  var MAX_LINES = 3;

  /* 同一个名称最多重写几次样式。超过就停手 —— 防止与平台重渲染打摆（会抖）。
   * 正常情况写完一轮后 truncReason 就返回空，永远用不到这个上限。 */
  var REDO_LIMIT = 3;

  /* ---------- 打摆闸（2026-11-21 素材页抖动）----------
   *
   * REDO_LIMIT 挂在**名称节点**上，而素材页的表格行会被平台整段重建：
   * 节点一换，计数归零 ⇒ 上限形同虚设，就变成「每 4 秒抖一次」。
   * 所以再补一道**与节点无关**的闸：短时间内反复出现「刚解开又需要解开」，
   * 判定页面正在打摆，静默一段时间（只保留按钮、不再改任何样式）。
   * 静默期结束后自动恢复 —— 平台若只是偶发重渲染，不会长期降级。 */
  var CHURN_WINDOW = 3000;    // 观察窗：3 秒内
  var CHURN_HITS = 6;         // 累计这么多次重复解开
  var CHURN_REST = 30000;     // 就静默这么久
  var churn = { last: 0, hits: 0, restUntil: 0 };
  /* 上一轮解开过的名称（元素引用）。同一元素下一轮又要解开 ⇒ 属性被洗了。 */
  var lastOpened = typeof WeakSet === 'function' ? new WeakSet() : null;

  /* 首屏三次补涂：表单页是 React 分批挂载，商品卡常晚于首帧 */
  var BOOT_DELAYS = [1200, 3000, 6000];
  var SCAN_DEBOUNCE = 400;
  var SCAN_MAX_WAIT = 1200;

  /* 单轮最多检查多少个文本叶子（防页面异常时炸主线程） */
  var LEAF_BUDGET = 2400;
  /* 名称文本长度上下限：太短不像商品名，太长是整块（含地址/提示语） */
  var TEXT_MIN = 8;
  var TEXT_MAX = 160;
  /* 缩略图最小边长：小于这个尺寸的多半是图标，不是商品图 */
  var THUMB_MIN = 24;

  /* 明显不是名称的字段名 / 纯数值 / 平台提示语 */
  var NOT_NAME_RE = /^(ID|商品\s*ID|货号|价格|售价|库存|总库存|销量|时间|类目|品牌)\s*[:：]/;
  var NUMERIC_RE = /^[\s¥￥$]?[\d,.]+\s*([%元件个笔包])?$/;
  var HINT_RE = /无库存|不可购买|已下架|已售罄|暂不支持|无法购买/;
  /* 「ID:38543063555255050622」这类字段行 —— 冒号可有可无，值是长数字/编码。
   * 抽屉卡片里名称正下方就是这一行，长度常常不短（23 字），
   * 只靠「冒号 + 数字」拦不住没有冒号的写法，所以单独一条判据。 */
  var ID_LINE_RE = /^(?:商品\s*)?ID\s*[:：]?\s*[A-Za-z0-9]{6,}$/i;
  /* 地址特征词：命中 ≥2 个不同类别即判「这是地址不是商品名」
   * （广东省深圳市南山区xx路12号 —— 单一「市」字不足以下结论，
   *  商品名里带「市」的极少但不为零，所以用「多类别共现」这条判据） */
  var ADDR_TOKENS = [/(?:省|自治区)/, /(?:市|自治州)/, /(?:区|县|旗)/, /(?:镇|乡|街道)/,
                     /(?:路|街|巷|大道)/, /(?:号|栋|幢|单元|室|楼层)/];

  /* ---------- 状态 ---------- */

  var on = false;
  var observer = null;
  var debounceTimer = null;
  var bootTimers = [];
  var queuedAt = 0;
  /* 缓存：[{ el: 名称元素, card: 商品卡（可能为 null） }] */
  var cache = [];
  /* 被我们改过样式的元素（关开关时逐个还原） */
  var touched = [];
  /* 被补过 flex-wrap 的父容器（与 touched 分开记，还原时各归各位） */
  var wrapHosts = [];
  var appliedAt = 0;
  /* 上一轮「名称数/按钮数」签名 —— 只有数字变化才写诊断，防每轮刷屏 */
  var lastStat = '';
  /* 上一次「一个都没认出来」的时刻 —— 退避用，防每 1.2 秒整页重扫 */
  var lastEmptyAt = 0;
  var EMPTY_BACKOFF = 1500;
  /* 有新增节点 ⇒ 下一轮必须重采（抽屉、翻页、筛选都走这条路才能进来） */
  var dirty = true;
  var lastCollectAt = 0;
  /* 重采节流：抽屉动画期 DOM 持续变化，不能每个防抖都全场扫 */
  var RECOLLECT_GAP = 900;

  function textOf(el) {
    if (!el) return '';
    return String(el.textContent || '').replace(/\s+/g, ' ').trim();
  }

  function inScope() {
    return !!pageKey();
  }

  /** 扩展自己注入的节点（注入的按钮、标记过的名称）—— 一律不算页面数据 */
  function isOurNode(el) {
    if (!el || el.nodeType !== 1) return false;
    var id = el.id ? String(el.id) : '';
    if (/^(dyc|dyb)[-_]/.test(id)) return true;
    var cls = el.className ? String(el.className) : '';
    if (/(^|\s)(dyc|dyb)[-_]/.test(cls)) return true;
    try {
      return el.hasAttribute(BTN_ATTR) || el.hasAttribute(MARK);
    } catch (e) { return false; }
  }

  /**
   * 取元素的「纯页面文本」：整棵跳过我们自己注入的子树。
   * 不这么做的话，按钮文案「货号」会被当成平台字段，取号时把旁边的值刮走
   * —— 中控台 2026-10-18 反馈 #96 就是这么错的。
   */
  function pageText(root) {
    if (!root) return '';
    var parts = [];
    try {
      var walker = document.createTreeWalker(root,
        NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
          acceptNode: function (n) {
            if (n.nodeType === 1) {
              return isOurNode(n) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_SKIP;
            }
            return NodeFilter.FILTER_ACCEPT;
          }
        });
      var n;
      while ((n = walker.nextNode())) parts.push(n.nodeValue || '');
    } catch (e) {
      return '';
    }
    return parts.join(' ').replace(/\s+/g, ' ').trim();
  }

  /**
   * 这个元素现在被哪一种方式截断。
   * @return {string} 'clamp' | 'nowrap' | 'height' | ''
   */
  function truncReason(el) {
    if (!el || !el.getBoundingClientRect) return '';
    /* 已经按 MAX_LINES 钳过的元素不必再判：它天生 scrollHeight > clientHeight
     * （第 N+1 行还藏在下面），再判一次就会每轮重写样式（见 capLines 的说明）。 */
    if (el.__dycRgCapped) return '';
    /* ★ 2026-11-17：已打「解开」标记 ⇒ 样式由常驻 CSS 规则提供，直接跳过。
     *   不加这条的话，平台每次洗掉内联后我们又判一次「被裁」→ 再解一遍，
     *   诊断里就是 u10 → u0 → u10 的死循环，用户看到名称高度来回跳。 */
    try {
      if (el.getAttribute && el.getAttribute(OPEN_ATTR)) return '';
    } catch (e0) { /* 读不到属性就按原判据走 */ }
    var cs = null;
    try { cs = window.getComputedStyle ? window.getComputedStyle(el) : null; } catch (e) { return ''; }
    if (!cs) return '';
    /* ① 行数钳制：本页商品名就是这种（line-clamp:1）
     *
     * ★ 2026-11-17 真机（素材管理页）：「文字显示不完全」的根因就在这一行。
     *   该内核上 `cs.webkitLineClamp` 与 `cs['-webkit-line-clamp']` **都取不到**
     *   （返回 undefined），只有 getPropertyValue 这条路能读到 "1"。
     *   旧写法于是永远判不出 clamp ⇒ truncReason 返回空 ⇒ applyUnclip 从没被调用
     *   ⇒ 名称一直是一行。诊断报告里那行「184×16 · 文本高 48/可见高 16 ·
     *   line-clamp:1」正是「平台在裁、我们没解」的现场。
     *   三条路依次走，谁先读到用谁（getPropertyValue 是标准写法，最可靠）。 */
    var lc = cs.webkitLineClamp || cs['-webkit-line-clamp'] || '';
    if (!lc && typeof cs.getPropertyValue === 'function') {
      try { lc = cs.getPropertyValue('-webkit-line-clamp') || ''; } catch (e) { lc = ''; }
    }
    var n = parseInt(lc, 10);
    if (lc && lc !== 'none' && !isNaN(n) && n > 0) return 'clamp';
    /* ② 单行省略号：必须真溢出才算，否则会把正常文本也改一遍 */
    var ws = cs.whiteSpace || '';
    var ell = cs.textOverflow || '';
    if ((ws === 'nowrap' || ell === 'ellipsis') && el.scrollWidth > el.clientWidth + 1) return 'nowrap';
    /* ③ 定高剪裁
     *
     * ★ 同时修的第二处：旧写法只认 `cs.overflow === 'hidden'`，而素材页平台写的是
     *   `overflow-y: hidden`（overflow-x 被 CSS 归一化成 auto）⇒ 计算值是
     *   'auto hidden'，永远不等于 'hidden' ⇒ 判不出来。
     *   改成**硬判据**：只要真的有内容被切（scrollHeight > clientHeight）就解 ——
     *   比猜平台用了哪种写法可靠，也不会误伤（没被切就不会进这条）。
     *   例外：真滚动容器（overflow-y: auto/scroll）不碰，那是能滚的，不该拆。 */
    var oy = cs.overflowY || '';
    if (oy === 'auto' || oy === 'scroll') return '';
    if (el.scrollHeight > el.clientHeight + 1) return 'height';
    return '';
  }

  /**
   * 这个元素能不能当「装名称的那个节点」。
   *
   * 只认纯文本叶子太窄了：抖店不少地方把品牌前缀 / 款号拆成 `<span>`
   * 单独配色（真机常见写法）。所以放开到「**最多 2 个行内子节点**」：
   *   · 子节点只能是 span / em / b / i / strong / a / font 这类行内标签；
   *   · 子节点自己不许再带元素（再深一层说明是布局容器，不是名称）；
   *   · 已经装了我们注入按钮的容器一律不算（否则 textContent 会混进「货号」二字）。
   * 块级子节点（div/p）直接否掉 —— 那正是「卡片信息区」这种布局容器的特征。
   */
  var INLINE_TAGS = { SPAN: 1, EM: 1, B: 1, I: 1, STRONG: 1, A: 1, FONT: 1, U: 1, S: 1 };
  function isTextHolder(el) {
    var kids = el.children;
    if (!kids || !kids.length) return true;
    if (kids.length > 2) return false;
    for (var i = 0; i < kids.length; i++) {
      var k = kids[i];
      if (!INLINE_TAGS[k.tagName]) return false;
      if (k.childElementCount) return false;
      if (isOurNode(k)) return false;
    }
    return true;
  }

  /** 这段文本像不像商品名（宁可漏，也不要错认成 ID 行 / 地址 / 价格 / 提示语） */
  function looksLikeName(text) {
    var s = String(text || '').replace(/\s+/g, ' ').trim();
    if (s.length < TEXT_MIN || s.length > TEXT_MAX) return false;
    if (NOT_NAME_RE.test(s)) return false;
    if (NUMERIC_RE.test(s)) return false;
    if (HINT_RE.test(s)) return false;
    if (ID_LINE_RE.test(s)) return false;           // 「ID:3854…」字段行
    if (/ID\s*[:：]\s*\d+/.test(s)) return false;   // 整行混进了商品 ID
    /* 数字占比过半 ⇒ 数字串 / 编码 / 金额，不是商品名 */
    var digits = (s.match(/\d/g) || []).length;
    if (digits / s.length > 0.6) return false;
    var hits = 0;
    for (var i = 0; i < ADDR_TOKENS.length; i++) {
      if (ADDR_TOKENS[i].test(s)) hits++;
    }
    if (hits >= 2) return false;                    // 地址，不是商品名
    return true;
  }

  /**
   * 是不是「下拉框里的文字」。
   *
   * 本页地址选择器里那格也是 line-clamp:1（42 个字），放开它会把平台弹层
   * 的布局顶坏。判据刻意只用语义与组件名前缀，不用构建哈希：
   *   · role = combobox / listbox / option（ARIA，平台换肤也不变）；
   *   · 类名含 aurora-select（组件库的稳定前缀，不是 CSS Modules 哈希）。
   */
  function inSelectContext(el) {
    var n = el;
    var depth = 0;
    while (n && n.nodeType === 1 && depth < 8) {
      var role = '';
      try { role = n.getAttribute ? (n.getAttribute('role') || '') : ''; } catch (e) { role = ''; }
      if (role === 'combobox' || role === 'listbox' || role === 'option') return true;
      var cls = n.className ? String(n.className) : '';
      if (/aurora-select|select-content|select-value|select-selection/i.test(cls)) return true;
      n = n.parentElement;
      depth++;
    }
    return false;
  }

  /** 这张图够不够大（解码前量不到尺寸时按属性尺寸兜一次） */
  function imgSizeOk(im) {
    if (!im) return false;
    var w = im.clientWidth || 0;
    var h = im.clientHeight || 0;
    if (w >= THUMB_MIN && h >= THUMB_MIN) return true;
    var aw = parseFloat(im.getAttribute('width') || '0') || 0;
    var ah = parseFloat(im.getAttribute('height') || '0') || 0;
    return aw >= THUMB_MIN && ah >= THUMB_MIN;
  }

  /**
   * 这个容器**自己这一层**是不是摆着一张商品图。
   *
   * 判据特意收在「直接子节点」这一层，而不是「子树里有图」：
   *   实测反例 —— 页面外层容器（表单区）的子树里当然有十几张卡图，
   *   一旦按子树判，卡片外面的一句截断说明文字就会被当成商品名、
   *   被插上货号按钮。收在直接子节点后，「谁是一张卡」就只能是最内层
   *   那个同时放着图片与文字的小盒子。
   *
   * 两种可接受的摆法：
   *   · <img> 直接是子节点；
   *   · 图片被一个**不含文字**的包裹层包着（缩略图容器），或该包裹层用背景图。
   */
  function isCardBox(node) {
    var kids = node && node.children;
    if (!kids || !kids.length) return false;
    for (var i = 0; i < kids.length; i++) {
      var k = kids[i];
      if (k.tagName === 'IMG') {
        if (!isOurNode(k) && imgSizeOk(k)) return true;
        continue;
      }
      if (!k.childElementCount) continue;
      /* 包裹层里有文字 ⇒ 那是内容块，不是纯图区 */
      if (String(k.textContent || '').trim()) continue;
      var im = null;
      try { im = k.querySelector('img'); } catch (e) { im = null; }
      if (im && !isOurNode(im) && imgSizeOk(im)) return true;
      var cs = null;
      try { cs = window.getComputedStyle ? window.getComputedStyle(k) : null; } catch (e2) { cs = null; }
      if (cs && cs.backgroundImage && cs.backgroundImage !== 'none') return true;
    }
    return false;
  }

  /**
   * 找到这个名称所属的「商品卡」。
   *
   * 判据：往上 ≤4 层里最近的一个**自己这一层就摆着商品图**的容器。
   * 判据收在这一层是有代价的 —— 平台若把图藏进「带文字的包裹层」，
   * 我们就认不出卡、这一页就不处理（诊断里留痕）。这个代价是刻意选的：
   * 反过来放松判据的后果是在无关文字上乱插按钮、乱解截断，
   * 那是用户一眼就能看见的坏改动，而「开关开了没变化」至少不破坏页面。
   *
   * @param {Element} el 名称候选
   * @return {Element|null} 找不到就返回 null，调用方**不处理**这个候选
   */
  function cardOf(el) {
    var n = el.parentElement;
    var depth = 0;
    while (n && n.nodeType === 1 && depth < 4) {
      if (isCardBox(n)) return n;
      n = n.parentElement;
      depth++;
    }
    return null;
  }

  /**
   * 全页收集「像商品名 + 在一张商品卡里」的文本叶子，**每张卡只取一个**。
   *
   * 两条口径（2026-11-17 真机截图后改）：
   *   ① **不以「被截断」为前提**。抽屉里多数商品名两行正好装下、没有省略号；
   *      上一版把截断当入集条件，这些卡连「货号」按钮都拿不到 ——
   *      用户看到的就是「开了没变化」。截断只决定**要不要解**，不决定**要不要管**。
   *   ② 同一张卡里出现多个候选（名称 / ID 行 / 提示语）时**取最长的那条**：
   *      商品名永远比 ID 行与提示语长；ID 行另有 isIdLine() 硬排除。
   *
   * 只认**没有元素子节点**的叶子：名称是纯文本节点，展开布局容器会把卡片撑乱。
   *
   * ★ 找不到卡片就**不做**（宁可漏，不错改）：页面若用某种没被识别的
   *   缩略图形态，结果只是「开关开了没变化」，并在诊断里留痕；
   *   而放宽判据的代价是在无关文字上乱插按钮、乱解截断，那是不可接受的。
   *
   * @return {Array<{el:Element, card:Element}>}
   */
  /**
   * 深度遍历：普通子树 + open shadowRoot + 同源 iframe 文档。
   *
   * ★ 为什么必须这么做（2026-11-17 真机诊断）：
   *   抽屉、微前端子应用常挂在 **shadowRoot 沙箱**或 **同源 about:blank iframe**
   *   里（拱卫这类框架的典型形态）。只走 document.querySelectorAll 时，
   *   抽屉里的卡片一个都取不到 —— 表现正是用户说的「抽屉外做出来了、抽屉内没做」。
   *   diag / page-probe 早就按这套深度遍历采结构，功能侧这次对齐。
   * ⚠️ 跨域 iframe 读不到（SecurityError），如实跳过，不假装成功。
   */
  var SHADOW_DEPTH = 6;

  function iframeDocOf(fr) {
    try {
      var d = fr.contentDocument || (fr.contentWindow && fr.contentWindow.document);
      return d && d.body ? d : null;
    } catch (e) { return null; }
  }

  /**
   * 优先只在「卡片容器」子树里找，而不是全页找。
   *
   * ★ 2026-11-17（素材页抖动）：这一页近 4000 个元素，原来每次 DOM 变化都全页
   *   重采一轮（RECOLLECT_GAP=900ms）。老内核上滚动就是一顿一顿的 —— 用户口中
   *   的「抖动」有一部分来自这里。
   *   素材页每张卡都带 `productItem` 前缀（CSS Modules 的构建哈希在尾部，
   *   前缀是组件语义名，平台改版通常只换哈希），收窄到这几十个节点后量级降一个
   *   数量级。认不出来（少于 3 个）就退回全页 —— 宁可慢，也不漏。
   *   只对素材页这么做：退货页的主表单区本来就不大，且没有这个命名约定。
   */
  function scopeRoots() {
    if (pageKey() !== 'material') return null;
    var hits = [];
    try {
      var list = document.querySelectorAll('[class*="productItem"]');
      for (var i = 0; i < list.length; i++) hits.push(list[i]);
    } catch (e) { return null; }
    /* 门槛取 2：列表只有一两条时也要收窄（真实页面常见筛选后只剩几条）；
     * 只有 1 个时可能是别处撞名的组件，退回全页更稳。 */
    return hits.length >= 2 ? hits : null;
  }

  function eachDeep(cb, roots) {
    var budget = LEAF_BUDGET * 4;
    var walk = function (node, depth) {
      if (!node || budget <= 0) return;
      var kids = node.children;
      if (!kids) return;
      for (var i = 0; i < kids.length; i++) {
        if (budget <= 0) return;
        budget--;
        var el = kids[i];
        if (!isOurNode(el)) cb(el);
        if (depth < SHADOW_DEPTH && el.shadowRoot) walk(el.shadowRoot, depth + 1);
        if (depth < SHADOW_DEPTH && el.tagName === 'IFRAME') {
          var idoc = iframeDocOf(el);
          if (idoc) walk(idoc.body, depth + 1);
        }
        walk(el, depth);
      }
    };
    /* 有收窄根就只走这些子树；否则退全页（原行为） */
    if (roots && roots.length) {
      for (var r = 0; r < roots.length && budget > 0; r++) walk(roots[r], 0);
    } else {
      walk(document.body, 0);
    }
  }

  function collect() {
    var picked = [];       // [{card, el, len}]
    var loose = 0;         // 像名称但不在卡里的叶子数（诊断用：说明判据卡在哪一层）
    function pick(el) {
      if (!isTextHolder(el)) return;               // 纯文本叶子，或「文字 + 行内 span」
      var t = textOf(el);
      if (!looksLikeName(t)) return;
      if (inSelectContext(el)) return;
      var card = cardOf(el);
      if (!card) { loose++; return; }
      var at = -1;
      for (var k = 0; k < picked.length; k++) {
        if (picked[k].card === card) { at = k; break; }
      }
      if (at < 0) picked.push({ card: card, el: el, len: t.length });
      else if (t.length > picked[at].len) {
        picked[at].el = el;
        picked[at].len = t.length;
      }
    }
    var roots = scopeRoots();
    eachDeep(pick, roots);
    /* 收窄后一个都没认出来（连「像名称但不在卡里」的候选都没有）⇒ 前缀可能变了，
     * 退回全页再找一轮。只在收窄场景发生，且当轮只多扫一次。 */
    if (roots && !picked.length && !loose) eachDeep(pick, null);
    if (!picked.length && loose) {
      noteFact('识别不到商品卡（候选 ' + loose + ' 个），本轮不处理', '0/' + loose);
    }
    var out = [];
    for (var j = 0; j < picked.length; j++) out.push({ el: picked[j].el, card: picked[j].card });
    return out;
  }

  /* ---------- 样式写入与还原 ---------- */

  function backupOf(el) {
    if (!el.__dycRgOrig) el.__dycRgOrig = {};
    return el.__dycRgOrig;
  }

  function setProp(el, prop, value) {
    var bak = backupOf(el);
    if (!Object.prototype.hasOwnProperty.call(bak, prop)) {
      bak[prop] = {
        v: el.style.getPropertyValue(prop) || '',
        p: el.style.getPropertyPriority(prop) || ''
      };
    }
    try {
      el.style.setProperty(prop, value, 'important');
    } catch (e) {
      try { el.style.setProperty(prop, value); } catch (e2) { /* 单条失败不影响其它 */ }
    }
    if (touched.indexOf(el) < 0) touched.push(el);
  }

  /** 还原一个元素上我们写过的内联属性 + 打过的标记属性 */
  function restoreOne(el) {
    if (!el) return;
    if (el.__dycRgOrig) {
      var bak = el.__dycRgOrig;
      for (var prop in bak) {
        if (!Object.prototype.hasOwnProperty.call(bak, prop)) continue;
        try {
          if (bak[prop].v) el.style.setProperty(prop, bak[prop].v, bak[prop].p || '');
          else el.style.removeProperty(prop);
        } catch (e) { /* 忽略单条失败 */ }
      }
      el.__dycRgOrig = null;
    }
    /* 2026-11-17：解截断改成属性方案后，名称元素上没有内联可还原，
     * 但属性必须摘掉 —— 否则关掉开关时 CSS 规则还在，页面回不到原样。 */
    try {
      el.removeAttribute(MARK);
      el.removeAttribute(OPEN_ATTR);
      el.removeAttribute(CAP_ATTR);
      el.removeAttribute(FIT_ATTR);
      el.removeAttribute(HOST_ATTR);
      el.removeAttribute(WRAP_ATTR);
    } catch (e2) { /* 忽略 */ }
    el.__dycRgCapped = false;
    el.__dycRgWrites = 0;
  }

  function restoreAll() {
    for (var i = 0; i < touched.length; i++) restoreOne(touched[i]);
    touched = [];
    /* 开关关掉再打开时重新计：静默期与「上轮解开过」名单不该跨开关残留，
     * 否则用户会看到「刚打开开关却一动不动」。 */
    churn = { last: 0, hits: 0, restUntil: 0 };
    lastOpened = typeof WeakSet === 'function' ? new WeakSet() : null;
    for (var k = 0; k < wrapHosts.length; k++) {
      var h = wrapHosts[k];
      /* 2026-11-21：flex-wrap 改属性后，还原只需摘属性（内联那条老路径一并兼容）。 */
      if (!h) continue;
      try { h.removeAttribute(WRAP_ATTR); } catch (e1) { /* 忽略 */ }
      if (h.__dycRgWrapPrev !== undefined) {
        try {
          if (h.__dycRgWrapPrev) h.style.setProperty('flex-wrap', h.__dycRgWrapPrev);
          else h.style.removeProperty('flex-wrap');
        } catch (e) { /* 忽略 */ }
        h.__dycRgWrapPrev = undefined;
      }
    }
    wrapHosts = [];
  }

  /* ---------- 解截断 ---------- */

  function naturalLines(el) {
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

  /** 超过 MAX_LINES 才钳（带省略号）；两行 / 三行装得下就一个字不藏。
   *  2026-11-17：改为**摘掉 OPEN_ATTR、打上 CAP_ATTR**，样式由常驻规则提供。 */
  function capLines(el) {
    var lines = naturalLines(el);
    if (!lines || lines <= MAX_LINES) return false;
    try {
      el.removeAttribute(OPEN_ATTR);
      el.setAttribute(CAP_ATTR, '1');
    } catch (e) { /* 忽略 */ }
    /* 钳过的元素天生 scrollHeight > clientHeight（第 N+1 行藏在下面），
     * 打内部标记避免每轮重判 —— 内存标记，平台换节点即失效。 */
    el.__dycRgCapped = true;
    return true;
  }

  /**
   * 展开一个被截断的名称：**只打属性**，具体样式见 CSS 里的 OPEN_ATTR 规则。
   * @return {boolean} true = 这次真的处理了
   */
  function applyUnclip(el, reason, card) {
    if (!el) return false;
    if (reason !== 'clamp' && reason !== 'nowrap' && reason !== 'height') return false;
    /* ★ 2026-11-21：先把常驻规则注入到**元素所在的那棵树**再打属性。
     *   scan 的顺序是「先解开、后 ensureButton」，而样式原先只在 ensureButton 里
     *   注入 ⇒ 首轮解开时规则还不存在（属性打了也不生效）⇒ 下一轮再解一次。
     *   素材页每 4 秒一轮，正好对上诊断里那条反复出现的「本轮解开 9/10 个名称」。 */
    ensureStyleFor(el);
    try {
      el.setAttribute(OPEN_ATTR, '1');
      el.removeAttribute(CAP_ATTR);
      el.setAttribute(MARK, '1');
    } catch (e) { return false; }
    /* 记进 touched：关开关时要靠它把属性摘掉（名称元素上没有内联可还原） */
    if (touched.indexOf(el) < 0) touched.push(el);
    if (!appliedAt) appliedAt = Date.now();
    /* 规则生效后再量自然行数：超过 MAX_LINES 的钳回三行（换成 CAP_ATTR） */
    capLines(el);
    /* 素材页：名称自身解开了，但外层容器高度被平台定死 ⇒ 内容照样看不见，
     * 下一轮又判「截断」。所以把真正切内容的祖先一起解锁（见 fitChain）。 */
    fitChain(el, card);
    if (lastOpened) lastOpened.add(el);
    return true;
  }

  /**
   * 解锁「把名称切掉的祖先层」（2026-11-21 用户报「素材页会抖动」）。
   *
   * 【真机结构】（用户交来的《页面结构报告》v26.11.21.1）
   *   div.detail-WvY4DW (209×52)
   *     ├ div.name-VOjSh9 (209×16)  ← 高度定死，内容解开后被这一层裁
   *     │   └ div (209×16 可见 / 32 文本高)  ← 我们打 OPEN 的是这一层
   *     ├ div.productIdWrapper (209×16)
   *     └ div.statusWrapper (209×20)
   *
   * 【为什么只解名称本身没用】
   *   名称文本解成两行（32px），外层仍是 16px ⇒ 可见部分没变 ⇒ 下一轮
   *   truncReason 照样判「被裁」⇒ 再写一次属性。每轮一次布局变化，
   *   用户看到的就是整块上下跳（诊断轨迹里 `本轮解开 9/10 个名称` 每 4 秒一条）。
   *
   * 【口径】
   *   · 只认**真的切了内容**的层（scrollHeight > clientHeight，且不是可滚动容器）；
   *   · 只解高度与裁切，**不动 display** —— 这层常是平台 flex 列，改 display 会散架；
   *   · 上溯到卡片为止、最多 3 层，避免一路把整页容器都改成 auto。
   *
   * @param {Element} el 名称元素
   * @param {Element|null} card 商品卡（边界，不含）
   * @return {number} 解锁了几层
   */
  function fitChain(el, card) {
    var n = (el && el.parentElement) || null;
    var depth = 0;
    var freed = 0;
    /* 只解「贴着名称高度」的那几层（素材页名容器 16px、名称文本 48px）。
     * 大容器（抽屉、滚动区）即使内容溢出也不动 —— 把它改成 height:auto 会
     * 直接改掉页面主布局，那不是「解开名称」，那是拆页面。 */
    var nameH = 0;
    try { nameH = el.scrollHeight || 0; } catch (e0) { nameH = 0; }
    while (n && n.nodeType === 1 && n !== card && depth < 3) {
      var cut = false;
      try {
        var ch = n.clientHeight || 0;
        if (ch > 0 && ch <= nameH + 8 && n.scrollHeight > ch + 1) {
          var cs = window.getComputedStyle ? window.getComputedStyle(n) : null;
          var oy = cs ? (cs.overflowY || '') : '';
          /* 可滚动容器（auto/scroll）不碰：那是能滚的，拆了反而坏 */
          cut = (oy !== 'auto' && oy !== 'scroll');
        }
      } catch (e) { cut = false; }
      if (cut) {
        try {
          if (!n.getAttribute(FIT_ATTR)) n.setAttribute(FIT_ATTR, '1');
        } catch (e2) { /* 打不上就交给下一轮 */ }
        if (touched.indexOf(n) < 0) touched.push(n);
        freed++;
      }
      n = n.parentElement;
      depth++;
    }
    return freed;
  }

  /* ---------- 打摆检测与 hover 让路（2026-11-21 素材页抖动） ---------- */

  /**
   * 同一个名称「上一轮刚解开、这一轮又要解开」= 属性没留住（平台洗属性 / 换节点）。
   * 短时间累计够多就判定页面在打摆，静默一段时间。判据与节点引用无关，
   * 所以平台整段重建表格行也躲不过这道闸。
   */
  function noteChurn(el) {
    var now = Date.now();
    if (!churn.last || now - churn.last > CHURN_WINDOW) churn.hits = 0;
    churn.last = now;
    if (lastOpened && lastOpened.has(el)) churn.hits++;
    if (churn.hits >= CHURN_HITS) {
      churn.restUntil = now + CHURN_REST;
      churn.hits = 0;
      noteFact('名称反复被平台压回，已暂停改写 '
        + Math.round(CHURN_REST / 1000) + ' 秒（继续写会让页面一直抖）', 'rest');
    }
  }

  /**
   * 鼠标是否停在这张卡上。
   * 商品管理页已定过这条口径（2026-11-18）：hover 期间平台的布局还在变，
   * 此刻写样式就是在用户眼皮底下跳。素材页卡片更高，更明显。
   */
  function hovered(card) {
    if (!card || typeof card.matches !== 'function') return false;
    try { return card.matches(':hover'); } catch (e) { return false; }
  }

  /* ---------- 货号 ---------- */

  /**
   * 两档取号：官方「货号」字段 → 名称末尾推算（判据在 item-code.js）。
   * @return {{code:string, from:string, tail:string}}
   */
  function readCode(item) {
    var nameEl = item && item.el;
    var scope = (item && item.card) || (nameEl && nameEl.parentElement) || null;
    var tail = textOf(nameEl).slice(-24);
    var near = pageText(scope);

    /* ① 官方字段：只有平台自己写了「货号」二字才走 */
    var official = '';
    if (near && /货号/.test(near)) {
      if (typeof extractValueAfterLabel === 'function') {
        try {
          var v = extractValueAfterLabel(scope, '货号');
          if (v) {
            v = String(v).replace(/^货号\s*[:：]?\s*/, '').trim();
            /* 必须能在纯页面文本里找到 —— 挡掉从自家节点旁边刮来的值 */
            if (typeof dycIsCodeLike === 'function' && dycIsCodeLike(v) && near.indexOf(v) > -1) official = v;
          }
        } catch (e) { /* 尽力而为 */ }
      }
      if (!official && typeof dycFindOfficialInText === 'function') {
        try { official = dycFindOfficialInText(near) || ''; } catch (e2) { official = ''; }
      }
    }
    if (official) return { code: official, from: 'official', tail: tail };

    /* ② 名称末尾推算 */
    var guessed = '';
    if (typeof dycPickCodeFromName === 'function') {
      try { guessed = dycPickCodeFromName(textOf(nameEl)) || ''; } catch (e3) { guessed = ''; }
    }
    return { code: guessed, from: guessed ? 'guess' : 'none', tail: tail };
  }

  /* ---------- 按钮 ---------- */

  /* 样式与中控台小黄车那枚「货号」按钮（src/live/copy-code.js）保持一致：
   * 56×20 固定宽、蓝描边白底、hover 蓝底白字、默认半透明；只把左侧间距
   * 从 6px 保留（跟在小黄车「复制 ID」右边时就是这个间距）。 */
  var CSS = [
    /* ---------- 名称完整显示（常驻规则 · 2026-11-17）----------
     *
     * 选择器不加 html/body 前缀：这段样式还要注入到 shadowRoot 里，
     * 而 shadow 树里没有 html/body，加前缀就永远匹配不到。
     * 靠 !important 压过平台的类规则（内联样式我们不写，所以没有优先级问题）。
     */
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
    /* 超过 MAX_LINES 的名称钳回三行（与商品列表同一口径） */
    '[' + CAP_ATTR + '] {',
    '  display: -webkit-box !important;',
    '  -webkit-box-orient: vertical !important;',
    '  -webkit-line-clamp: ' + MAX_LINES + ' !important;',
    '  overflow: hidden !important;',
    '  text-overflow: ellipsis !important;',
    '}',
    /* 祖先层只解「高度 / 裁切」，**不动 display**（2026-11-21 素材页抖动）——
     * 这一层多是平台的 flex 列（detail: 名称 / ID / 状态三行堆叠），
     * 改 display 会把平台排版打散。height:auto 只让容器跟着内容长，
     * 卡片随之变高（素材页 td 高 101、卡片仅 52，有空间容得下）。 */
    '[' + FIT_ATTR + '] {',
    '  height: auto !important;',
    '  max-height: none !important;',
    '  overflow: visible !important;',
    '}',
    /* 按钮的定位上下文（素材页名称容器）与父容器换行：属性化，不被平台洗掉 */
    '[' + HOST_ATTR + '] { position: relative !important; }',
    '[' + WRAP_ATTR + '] { flex-wrap: wrap !important; }',
    '.' + BTN_CLASS + ' {',
    '  all: initial;',
    '  display: inline-flex; align-items: center; justify-content: center;',
    '  width: 56px; height: 20px; padding: 0;',
    '  flex: 0 0 auto;',
    '  margin: 2px 0 0 6px;',
    '  border: 1px solid #0075ff; border-radius: 4px;',
    '  background: #fff; color: #0075ff;',
    "  font: 12px/1 -apple-system, 'Microsoft YaHei', sans-serif;",
    '  white-space: nowrap; vertical-align: middle; cursor: pointer;',
    '  box-sizing: border-box;',
    '  opacity: .55;',
    '  transition: opacity .15s, background .15s, color .15s;',
    '}',
    '.' + BTN_CLASS + ':hover { opacity: 1; background: #0075ff; color: #fff; }',
    '.' + BTN_CLASS + '.is-err { border-color: #86909c; color: #86909c; background: #fff; }',
    '.' + BTN_CLASS + '.is-err:hover { background: #86909c; color: #fff; }',
    /* 素材页：贴名称右下角（用户 2026-11-17 原话「放在名称右下角，
     * 尽量不要在 ID 行下面，不好看」）。
     *
     * ★ 2026-11-17 第二版改成**绝对定位**：上一版用「块级 + margin-left:auto」，
     *   真机诊断里按钮 rect 在 x=448（卡片左半边）—— 说明名称容器不是普通 block
     *   （极可能是 -webkit-box / flex），margin-left:auto 在里面不生效。
     *   绝对定位与 display 无关，靠 right/bottom 定位，任何容器都成立。
     *   定位上下文由 ensureCornerHost() 只给 position:relative（不加 padding，
     *   那会把平台定死的高度里的内容区压小）。 */
    '.' + BTN_CLASS + '--corner {',
    '  position: absolute; right: 0; bottom: 0; margin: 0;',
    '}'
  ].join('\n');

  /**
   * 把样式注入到**按钮所在的那棵树**。
   *
   * ★ 2026-11-17 真机事故：上一版定义了 ensureStyle() 却**没在任何地方调用**，
   *   诊断报告里按钮量出来是 44×28 / display:block（浏览器默认按钮外观）——
   *   功能能用但完全不像小黄车那枚。
   * ★ 同时按 root 注入：manifest 登记的 CSS 进不去 shadowRoot，同源 iframe 的
   *   document 也是独立的一棵树；只往顶层 head 插，抽屉里的按钮永远是裸的。
   */
  function ensureStyleFor(node) {
    var doc = (node && node.ownerDocument) || document;
    var root = null;
    try { root = (node && node.getRootNode) ? node.getRootNode() : null; } catch (e) { root = null; }
    if (!root || !root.appendChild) root = doc.head || doc.documentElement;
    if (root.nodeType === 9) root = root.head || root.documentElement;
    if (!root) return;
    if (root.__dycRgStyle && root.__dycRgStyle.parentNode) return;
    var st = doc.createElement('style');
    st.id = STYLE_ID;
    st.textContent = CSS;
    try {
      root.appendChild(st);
      root.__dycRgStyle = st;
    } catch (e2) { /* 插不进去就算了：按钮仍可点，只是没样式 */ }
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
    } catch (e) { return false; }
  }

  /** 复制类提示只弹 3 秒、不进消息盒子（与中控台货号按钮同一口径） */
  function say(message, type, opts) {
    try {
      if (typeof toast === 'function') {
        var o = {};
        for (var k in (opts || {})) if (Object.prototype.hasOwnProperty.call(opts, k)) o[k] = opts[k];
        o.keepHistory = false;
        o.source = o.source || '货号复制';
        toast(message, type, o);
      }
    } catch (e) { /* 消息条不在也不影响复制 */ }
  }

  function flash(btn, text, isErr) {
    if (btn.__dycOrigText == null) btn.__dycOrigText = btn.textContent;
    btn.textContent = text;
    if (isErr) btn.classList.add('is-err'); else btn.classList.remove('is-err');
    clearTimeout(btn.__dycTimer);
    btn.__dycTimer = setTimeout(function () {
      btn.textContent = btn.__dycOrigText;
      btn.classList.remove('is-err');
    }, 1500);
  }

  function noteFact(text, result) {
    try {
      if (window.__dycDiag && typeof window.__dycDiag.note === 'function') {
        window.__dycDiag.note(PAGE_LABEL[pageKey()] || PAGE_LABEL.returnPolicy, text, result);
      }
    } catch (e) { /* 诊断失败不许影响功能 */ }
  }

  function makeButton(item) {
    /* 抽屉可能在 shadowRoot / 同源 iframe 里，节点要用**那棵树**的 document 造 */
    var doc = (item && item.el && item.el.ownerDocument) || document;
    ensureStyleFor(item && item.el);
    var btn = doc.createElement('button');
    btn.type = 'button';
    btn.className = BTN_CLASS + (pageKey() === 'material' ? ' ' + BTN_CLASS + '--corner' : '');
    btn.textContent = '货号';
    btn.setAttribute(BTN_ATTR, '1');
    btn.title = '点击复制货号 · 优先用平台货号；平台没显示时取商品名末尾的款号';
    btn.addEventListener('click', function (e) {
      /* 只停自己这枚按钮的冒泡：卡片外层可能有「点开商品」的链路 */
      e.preventDefault();
      e.stopPropagation();
      /* 重渲染会把名称元素换掉，点击时按当前节点重算一次 */
      var nowEl = (btn.__dycItem && btn.__dycItem.el && btn.__dycItem.el.isConnected)
        ? btn.__dycItem.el : item.el;
      var now = { el: nowEl, card: cardOf(nowEl) || (btn.__dycItem && btn.__dycItem.card) };
      var r = readCode(now);
      noteFact('尾[' + r.tail + ']｜档=' + r.from, r.code || '无货号');
      if (!r.code) {
        btn.title = '这一行没找到货号 —— 平台没显示货号，商品名末尾也不是款号（只认名称末尾）';
        flash(btn, '无货号', true);
        say('这一行没找到货号', 'warning', {});
        return;
      }
      btn.title = '货号：' + r.code +
        (r.from === 'guess' ? '（按商品名末尾推算，不是平台货号）' : '（平台货号）');
      copyText(r.code, function (ok) {
        flash(btn, ok ? '已复制' : '复制失败', !ok);
        if (ok) say(r.code, 'success', { count: '已复制', standalone: true });
        else say('复制失败，请重试', 'warning', {});
      });
    });
    return btn;
  }

  /** 父容器是横向 flex 时补 flex-wrap，否则按钮会把名称挤窄 */
  function ensureWrap(host) {
    if (!host || host.nodeType !== 1) return;
    var cs = null;
    try { cs = window.getComputedStyle ? window.getComputedStyle(host) : null; } catch (e) { return; }
    if (!cs || cs.display !== 'flex') return;
    var dir = cs.flexDirection || 'row';
    if (dir !== 'row' && dir !== 'row-reverse') return;
    /* 属性化（2026-11-21）：原先写内联 flex-wrap，平台洗一次我们就写一次，
     * 而这条**会真改布局** —— 每次重写都是一次可见的重排。 */
    try {
      if (!host.getAttribute(WRAP_ATTR)) host.setAttribute(WRAP_ATTR, '1');
    } catch (e2) { return; }
    if (wrapHosts.indexOf(host) < 0) wrapHosts.push(host);
  }

  /** 给一个名称元素补按钮；已存在就不重复插 */
  /**
   * 同一张卡里「ID:3854…」那一行。
   * 小黄车的「货号」就是贴着平台「复制 ID」按钮摆的；这页没有复制按钮，
   * 对应的锚就是这行 ID —— 按钮排在它后面，位置与它同行同块，读者一眼能对上。
   * 文本一律走 pageText()（剔除自家按钮），否则插过一次之后这行就不再匹配。
   */
  function idLineIn(host, nameEl) {
    if (!host || !host.children) return null;
    var kids = host.children;
    for (var i = 0; i < kids.length; i++) {
      var k = kids[i];
      if (k === nameEl || isOurNode(k)) continue;
      if (k.tagName === 'IMG' || k.childElementCount > 3) continue;
      if (ID_LINE_RE.test(pageText(k))) return k;
    }
    return null;
  }

  /**
   * 给一张卡补按钮。**一张卡只允许一枚**。
   *
   * ★ 2026-11-17 真机事故（用户截图：某张卡出现两枚按钮，13 枚对 12 张卡）：
   *   上一版幂等只认「名称元素父容器」上的 `__dycRgBtn`。当同一张卡里
   *   有第二个「像名称」的候选（平台把名称拆成两段，或重渲染后换了那个节点），
   *   父容器就换了，于是又插一枚 —— 卡内两枚按钮，其中一枚位置还不对。
   *   ⇒ 判据升级为**按卡查重**：卡的整棵子树里已经有我们的按钮就复用，
   *     并把它挪到当前该在的位置（幂等 + 自愈，不做重复插入）。
   */
  /**
   * 素材页：让名称容器成为按钮的定位上下文。
   *
   * ★ 只写 `position:relative`，**绝不写 padding** —— 这一页名称容器的高度是
   *   平台定死的，多给 padding 会把内容区压小、刚解开的名称又会少一行
   *   （2026-11-17 第一版就这么回退的）。真实位置检查见诊断里按钮 rect 的 x：
   *   上一版用 margin-left:auto 时是 448（卡片左半边），说明容器不是普通 block。
   */
  function ensureCornerHost(host) {
    if (!host || host.nodeType !== 1) return;
    var cs = null;
    try { cs = window.getComputedStyle ? window.getComputedStyle(host) : null; } catch (e2) { cs = null; }
    var pos = cs ? String(cs.position || '') : '';
    if (pos === 'relative' || pos === 'absolute' || pos === 'fixed') return;
    /* 属性化（2026-11-21）：与 OPEN/FIT 同一理由 —— 内联会被平台重渲染洗掉，
     * 洗一次写一次就构成循环；属性在，规则就在。 */
    try {
      if (!host.getAttribute(HOST_ATTR)) host.setAttribute(HOST_ATTR, '1');
    } catch (e) { /* 打不上就算了：按钮仍在，只是位置可能差一点 */ }
    if (touched.indexOf(host) < 0) touched.push(host);
  }

  /**
   * 就地补一个「刚被平台渲染出来」的节点（不等下一轮扫描）。
   *
   * ★ 2026-11-17 真机：这一页的商品卡列表约 1.3 秒重渲染一次，每次把节点换成新的 ——
   *   新节点上没有我们的标记属性，按钮也被删掉。原来靠防抖（400ms，后来 60ms）
   *   去补，中间那段空窗就是用户看到的「闪」。
   *   这里在 MutationObserver 回调里**同步**补，肉眼几乎看不到空窗。
   *
   * 判据与 collect() 完全一致（同一套 looksLikeName / cardOf），
   * 所以补出来的结果和正常扫描没有区别；每张卡仍然只有一枚按钮（ensureButton 幂等）。
   */
  function patchFresh(el) {
    if (!el || el.nodeType !== 1) return false;
    if (isOurNode(el)) return false;
    if (!isTextHolder(el)) return false;
    var t = textOf(el);
    if (!looksLikeName(t)) return false;
    if (inSelectContext(el)) return false;
    var card = cardOf(el);
    if (!card) return false;
    var reason = truncReason(el);
    if (reason) applyUnclip(el, reason, card);
    ensureButton({ el: el, card: card });
    return true;
  }

  /** 对新增子树做就地补。@param {number} budget 本次还能检查多少个节点（共享预算） */
  function patchTree(node, budget) {
    var left = (typeof budget === 'number') ? budget : 200;
    if (!node || node.nodeType !== 1 || left <= 0) return left;
    try { patchFresh(node); } catch (e0) { /* 单个节点失败不影响其它 */ }
    left--;
    var kids = null;
    try { kids = node.querySelectorAll ? node.querySelectorAll('*') : null; } catch (e1) { kids = null; }
    if (!kids) return left;
    var cap = kids.length > left ? left : kids.length;
    for (var i = 0; i < cap && left > 0; i++) {
      try { patchFresh(kids[i]); } catch (e2) { /* 忽略 */ }
      left--;
    }
    return left;
  }

  function ensureButton(item) {
    var el = item.el;
    if (!el || el.nodeType !== 1) return false;
    var material = (pageKey() === 'material');

    /* 落点按页面分派：
     *  · 退货页：贴在卡内那行「ID:…」之后（用户 2026-11-12 定）；
     *  · 素材页：名称容器内部、绝对定位到右下角（见 ensureCornerHost）。
     * 两者 host 与锚点不同，所以先分流再走同一套幂等逻辑。 */
    var host = el.parentElement;
    if (!host || host.nodeType !== 1) return false;
    var anchorEl = null;

    if (material) ensureCornerHost(host);

    if (!material) {
      /* 锚点：优先卡内那行「ID:…」。
       *
       * ★ 2026-11-17：名称与 ID 行不是同一个父容器的兄弟，而是**各套一层**
       *   （name > div / productIdWrapper > idStyle > div），共同父层是 detail。
       *   只在名称容器里找 ID 行会找不到，按钮就挤进名称容器内部、
       *   把刚解开的三行名称又挤回一行。找不到时再往上一层找一次。
       *   退货页名称容器里本来就有 ID 行，这段是空操作。 */
      anchorEl = idLineIn(host, el);
      if (!anchorEl) {
        var up = host.parentElement;
        if (up && up.nodeType === 1) {
          var upLine = idLineIn(up, host);
          if (upLine) { host = up; anchorEl = upLine; }
        }
      }
      if (!anchorEl) anchorEl = el;
    }

    /* ① 卡内已有按钮 ⇒ 复用（可能挂在别的兄弟下面），落点不对就挪一次 */
    var exist = null;
    if (item.card && item.card.querySelector) {
      try { exist = item.card.querySelector('.' + BTN_CLASS); } catch (e) { exist = null; }
    }
    if (!exist && host.__dycRgBtn && host.__dycRgBtn.isConnected) exist = host.__dycRgBtn;
    if (exist && exist.isConnected) {
      /* 类名可能在 SPA 切页时留着上一页的样式，校正一次 */
      var hasCorner = String(exist.className || '').indexOf('--corner') >= 0;
      if (material && !hasCorner) exist.className = BTN_CLASS + ' ' + BTN_CLASS + '--corner';
      if (!material && hasCorner) exist.className = BTN_CLASS;

      exist.__dycItem = item;
      item.btn = exist;
      if (exist.parentElement !== host) {
        try {
          if (material) host.appendChild(exist);
          else host.insertBefore(exist, anchorEl.nextSibling);
        } catch (e2) { /* 挪不动就留在原地 */ }
      } else if (material) {
        /* 已在名称容器里就够 —— 绝对定位（right/bottom）不看兄弟顺序。
         * ★ 2026-11-21：删掉「必须挪成最后一个子节点」那条。平台每轮渲染
         *   都可能往后面塞节点，于是每轮搬一次按钮 = 每轮一次 DOM 变更 =
         *   每次都可能带动重排。为了「好排查」付抖动的代价，不值。 */
      } else if (exist.previousSibling !== anchorEl) {
        try { host.insertBefore(exist, anchorEl.nextSibling); } catch (e6) { /* 忽略 */ }
      }
      host.__dycRgBtn = exist;
      return true;
    }

    /* ② 卡内没有 ⇒ 插一枚 */
    var btn = makeButton(item);
    btn.__dycItem = item;
    try {
      if (material) host.appendChild(btn);
      else host.insertBefore(btn, anchorEl.nextSibling);
    } catch (e3) {
      try { host.appendChild(btn); } catch (e4) { return false; }
    }
    host.__dycRgBtn = btn;
    if (!material) ensureWrap(host);
    item.btn = btn;
    return true;
  }

  /* ---------- 主扫描 ---------- */

  function alive() {
    for (var i = 0; i < cache.length; i++) {
      var it = cache[i];
      if (!it || !it.el || !it.el.isConnected) return false;
    }
    return cache.length > 0;
  }

  function scan() {
    if (!on) return 0;
    if (!inScope()) { stopAll(); return 0; }
    /* SPA 从一页切到另一页时（两页的开关是两个键），按新页的键重算一次。
     * 交给 setOn 走正常起停，这里直接返回，避免一边收尾一边处理。 */
    if (lastFlags) {
      var want = wantNow();
      if (want !== on) {
        setOn(want);
        return 0;
      }
    }
    /* 什么时候重采候选：
     *   · 缓存里的节点被平台整段换掉了（alive 为假）；**或**
     *   · 有新增节点（dirty）—— 抽屉打开时新内容就是这么进来的。
     * ★ 2026-11-17 真机事故：上一版只要缓存还活着就只复核，不再重采 ——
     *   抽屉打开后新渲染的卡片永远进不来，诊断轨迹停在「7/7」不再变化。
     * 重采按 RECOLLECT_GAP 节流（抽屉动画期 DOM 一直在动，不能每个防抖都全页扫）。 */
    var now = Date.now();
    var needCollect = !alive() || (dirty && now - lastCollectAt >= RECOLLECT_GAP);
    if (needCollect) {
      /* 一个都没认出来时再退避一层：避免在「确实没有卡片」的页面上反复全场扫 */
      if (!cache.length && !dirty && lastEmptyAt && now - lastEmptyAt < EMPTY_BACKOFF) return 0;
      cache = collect();
      lastCollectAt = now;
      dirty = false;
      if (!cache.length) lastEmptyAt = now;
      else lastEmptyAt = 0;
    }

    var n = 0;
    var unclipped = 0;     // 本轮真的解开了几个名称（0 = 判据没命中；非 0 但页面没变 = 写了被洗）
    var stopped = 0;       // 本轮因重写上限跳过几个
    var rested = 0;        // 本轮因打摆静默期跳过几个
    var hoverSkip = 0;     // 本轮因鼠标正停在该卡片上跳过几个
    var resting = Date.now() < churn.restUntil;
    for (var i = 0; i < cache.length; i++) {
      var it = cache[i];
      if (!it.el.isConnected) continue;
      var reason = truncReason(it.el);
      if (reason) {
        /* ★ 2026-11-17：给「我们解开 → 平台压回」这种打摆加个上限。
         *   平台若把内联样式洗掉、节点又留着，就会一轮一轮地重新解开 ⇒ 每次
         *   都触发布局变化 ⇒ 用户看到的是整块画面抖。写满 REDO_LIMIT 次就停手
         *   并留痕：最坏结果是这一条显示不全（看得见、能反馈），
         *   而不是一直抖（看不见原因、也没法用）。
         * ★ 2026-11-21：节点会被整段重建，挂在节点上的计数随之归零（素材页
         *   就是这么每 4 秒抖一次的）。补两道与节点无关的闸：打摆静默期 + hover 让路。 */
        var writes = it.el.__dycRgWrites || 0;
        if (resting) {
          rested++;
        } else if (hovered(it.card)) {
          hoverSkip++;
        } else if (writes >= REDO_LIMIT) {
          stopped++;
          if (!it.warned) {
            it.warned = true;
            noteFact('同一名称被压回 ' + writes + ' 次，已停手（否则会一直抖）', 'skip');
          }
        } else {
          /* 先记打摆，再写 —— applyUnclip 会把元素记进「上轮解开过」名单。 */
          noteChurn(it.el);
          it.el.__dycRgWrites = writes + 1;
          applyUnclip(it.el, reason, it.card);
          unclipped++;
        }
      }
      if (ensureButton(it)) n++;
    }
    /* 数字变化才写诊断。**0 也会写一条** —— 「本页识别 0 个商品名」
     * 正是排查「开关开了没变化」时最需要的那句话：
     * 有这句 = 脚本进来了但判据没认出来；连这句都没有 = 脚本没注入。
     * 2026-11-17 又补了「本轮解开 N 个」：用户在界面上看不到变化时，
     * 这一个数字就能把「判据没命中（0）」和「写了但被平台洗回（非 0）」分开。 */
    var sig = cache.length + '/' + n + '/u' + unclipped
      + (stopped ? 's' + stopped : '') + (rested ? 'r' + rested : '')
      + (hoverSkip ? 'h' + hoverSkip : '');
    if (sig !== lastStat) {
      lastStat = sig;
      noteFact('本页识别 ' + cache.length + ' 个商品名 / 注入 ' + n + ' 个货号按钮'
        + ' / 本轮解开 ' + unclipped + ' 个名称'
        + (stopped ? ' / 停手 ' + stopped + ' 个' : '')
        + (rested ? ' / 静默期跳过 ' + rested + ' 个' : '')
        + (hoverSkip ? ' / 鼠标下跳过 ' + hoverSkip + ' 个' : ''), sig);
    }
    return n;
  }

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

  function stopAll() {
    if (observer) {
      try { observer.disconnect(); } catch (e) { /* 忽略 */ }
      observer = null;
    }
    if (debounceTimer) { clearTimeout(debounceTimer); debounceTimer = null; }
    queuedAt = 0;
    clearBootTimers();
    var btns = document.querySelectorAll('.' + BTN_CLASS);
    for (var i = 0; i < btns.length; i++) {
      try { btns[i].remove(); } catch (e) { /* 尽力而为 */ }
    }
    restoreAll();
    cache = [];
    appliedAt = 0;
  }

  function startAll() {
    scan();
    if (typeof MutationObserver === 'function' && document.body) {
      observer = new MutationObserver(function (muts) {
        /* 只认「新增了节点」，纯属性变化不值得重扫（平台动画/高亮会刷属性）。
         *
         * ★ 2026-11-17 关键改动：新节点**就地补**，不再等任何定时器。
         *   这一页的商品卡约 1.3 秒整段重渲染一次，新节点上没有标记属性、
         *   按钮也被删掉 —— 原来靠防抖去补，中间那段空窗就是用户看到的「闪」。
         *   就地补发生在同一个微任务里，肉眼看不到空窗。
         *   预算 600 个节点/次：整表重建时也不会把主线程占住。 */
        var budget = 600;
        var addedAny = false;
        for (var i = 0; i < muts.length; i++) {
          var added = muts[i].addedNodes;
          if (!added || !added.length) continue;
          dirty = true;
          addedAny = true;
          for (var j = 0; j < added.length && budget > 0; j++) {
            try { budget = patchTree(added[j], budget); } catch (e) { /* 忽略 */ }
          }
        }
        /* 常规复核兜底（幂等：不会重复插按钮，也不会重复打标记） */
        if (addedAny) scheduleScan();
      });
      try {
        observer.observe(document.body, { childList: true, subtree: true });
      } catch (e) { observer = null; }
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

  /* ---------- 开关联动 ---------- */

  var prevOn = null;
  var lastFlags = null;      // 最近一次开关对象：SPA 换到另一作用页时要按新页的键重算

  /** 按「当前页面」取该页的开关值（两页各有一个键，互不牵连） */
  function wantNow() {
    if (!lastFlags) return null;      // 还没读到，别拿猜的值去开关功能
    return !!(lastFlags[flagKeyNow()] !== false);
  }

  function wire() {
    try {
      dycReadFlags().then(function (flags) {
        lastFlags = flags;
        var want = wantNow();
        prevOn = want;
        setOn(want);
      });
    } catch (e) { setOn(true); }

    if (typeof dycWatchFlags === 'function') {
      try {
        dycWatchFlags(function (flags) {
          lastFlags = flags;
          var want = wantNow();
          if (prevOn !== null && want !== prevOn && typeof toast === 'function') {
            toast(want ? '已开启' : '已关闭', 'info',
              { source: PAGE_LABEL[pageKey()] || PAGE_LABEL.returnPolicy });
          }
          prevOn = want;
          setOn(want);
        });
      } catch (e2) { /* 订阅失败不影响首帧 */ }
    }
  }

  /* 供调试面板取证：当前处理了几个名称、注入了几个按钮 */
  window.__DYC_RETURN_GOODS_NAME_API__ = {
    scan: function () { return scan(); },
    state: function () {
      return { on: on, names: cache.length, appliedAt: appliedAt, scope: inScope() };
    }
  };

  wire();
})();
