/**
 * 罗盘「商品列表」「商品卡列表」—— 商品名完整显示 + 「货号」复制按钮
 * ============================================================
 * 【作用页(2026-10-18 反馈 #95,用户定)】
 *   电商罗盘「商品列表」    https://compass.jinritemai.com/shop/commodity/product-list
 *   电商罗盘「商品卡列表」  https://compass.jinritemai.com/shop/merchandise-traffic
 *   （后者即用户口中的「商品销量榜」—— 页面标题为「商品卡列表-抖音电商罗盘」）
 *   用户原话：「商品卡、商品销量榜列表，都是需要加入商品名称扩展和快捷复制按钮」，
 *   并明确「这两个网页都要兼容这个功能，就是跟直播明细页的逻辑是一样的」。
 *
 * 【与 live-detail.js 的关系：同一套逻辑，不做同一个文件】
 *   两件事完全照搬罗盘直播明细页（`src/live/live-detail.js`）的口径：
 *     ① 商品名完整显示(平台截断的一律放开);
 *     ② 名称附近一枚「货号」按钮,点一下复制款号、成功后原地显示「已复制」;
 *     ③ 取号三档(官方货号 → 名称末尾推算 → 取不到不复制)与之一字不差;
 *     ④ 取值一律剔除扩展自己注入的节点(AGENTS 第 23 条)。
 *   但**不复用那个文件**,三个理由:
 *     · 两页 DOM 不同 —— 直播明细是「货号 + 商品信息 + 若干指标」的窄表,
 *       这两页是 aurora 组件库的 10~12 列宽指标表(见用户交来的结构报告:
 *       `tbody.aurora-table-tbody` + 高度 0 的 `aurora-table-measure-row`);
 *       硬塞进一个文件,任何一侧改版都会牵连另一侧;
 *     · live-detail.js 的 CSS 有一段把 `[class*="productInfoWrap-"]` 由 flex 改块级
 *       —— 那是为**直播明细的窄列**量身做的 float 布局 hack,铺到这两页属于
 *       「在没实测过的页面上改平台布局」,风险不对等,不能顺手带过去;
 *     · **要能单独关掉**。这两页尚未真机验证(用户交来的报告只采到骨架前 3 层),
 *       万一某一页结构不符,关一个开关只停这一页组,直播明细的功能不受影响。
 *
 * 【名称元素怎么找 —— 三级判据，越往后越保守】
 *   ① **类名前缀**:罗盘整站同一套业务组件,直播明细页实测是 `p.productName-*`。
 *      这里依次认 productName- / goodsName- / itemName- / productTitle- 四类前缀,
 *      命中且带直接文本就用 —— 最省事最准。
 *   ② **缩略图所在单元格**:商品行必有缩略图。先找出含 <img> 的 <td>,
 *      在其中挑「带直接文本、像商品名、文本最长」的元素。
 *      这一档比「整行挑最长」可靠得多 —— 指标表右侧全是数字列,
 *      而类目 / 店铺名 / 提示语可能比商品名更长(直播明细 #88/#85 的教训)。
 *   ③ **整行兜底**:前两档都空时,整行挑「最长且像商品名」的元素。
 *   ✅ 2026-10-18 真机诊断确认：**① 类名前缀那条路是通的**（日志里 10 行全部
 *      按 ① 命中了 `productName-*`），②③ 保留作平台改版时的兜底。
 *
 * 【哪些文本「不像商品名」】
 *   价格(¥/￥ 开头)、纯数字、平台标签(到手价 / 售出 / 库存 / 货号 / 规格 /
 *   销量 / 商品ID / 累计…),再加一条**提示语黑名单**:
 *   无库存 / 已下架 / 已售罄 / 不可购买 / 讲解中。
 *   后者是直播明细 #88/#85 的父级教训 —— 无库存行会多渲染一句提示,
 *   它比商品名更长,按「文本最长」就会挑中提示语 ⇒ 名称末尾推不出款号。
 *
 * 【名称怎么「扩展」—— 2026-10-18 真机返工后的最终做法】
 *   第一版只改名称元素自己的内联样式、且**不带 !important**，真机结果：
 *   日志写着「已折行」、按钮量出来 56×20，但截图上名称还是单行省略号、
 *   按钮一个都看不见。三条原因，缺一条都不生效：
 *     ① 平台截断规则本身带 `!important`（CSS Modules），普通内联抢不过 ⇒ 一律
 *        `setProperty(prop, val, 'important')`；
 *     ② 钳制常常落在**祖先层**（外层 wrap 的 overflow:hidden + 定高）⇒ 名称元素
 *        连同**最近 3 层祖先**一起放开（祖先只放开 clamp / max-height / overflow
 *        三条，**不动 width / display / position** —— 那是表格列宽，动就崩版）；
 *     ③ `-webkit-box-orient: initial` 对 line-clamp 无效 ⇒ 名称一律 `display:block`。
 *   实测结论（写进日志的 nameBrief）能直接看出有没有真生效。
 *
 * 【按钮落点 —— 2026-10-18 起只有一个：商品信息单元格末尾】
 *   第一版按「平台有复制 ID 按钮就并排插它右边、否则插名称之后」两种落点。
 *   真机证明这两处都在「做单行截断的那层容器」里：按钮插进去就被整块裁掉，
 *   而 `getBoundingClientRect` 量到的是**裁切前**的几何 —— 探针报告「10 枚、
 *   56×20、坐标正常」，用户屏幕上什么都看不见。
 *   ⇒ 现在一律 `td.appendChild(btn)`：单元格随内容长高，不在被裁的那一层里；
 *     再用 `margin-left:auto` 右对齐。并排落点与 `is-inline` 样式一并删除。
 *   ⚠️ 只在自己的按钮上 preventDefault + stopPropagation，不拦平台的链路：
 *      点商品名看详情、点行跳转一律照旧。
 *
 * 【取号优先级 —— 三档,与直播明细 / 中控台完全同一套】
 *   ① 官方货号:商品信息单元格里若有平台写出的「货号 xxx」,直接用;
 *      单元格里读不到「货号」二字才退整行。最可靠。
 *   ② 名称尾部推算:名称末尾「≥4 位且含数字」的字母数字串(NE1C0021W / 10157)。
 *      ⚠️ 这是**推算**,不是平台数据;名称末尾不是款号时取不到,不瞎猜。
 *   ③ 两档都空 → 按钮闪「无货号」,**绝不复制半截内容**。
 *
 * 【取值输入必须剔除「我们自己」—— AGENTS 第 23 条,硬规则】
 *   绝不直接 `row.innerText` 做「标签 + 值」正则:我们自己注入的按钮文案
 *   (「货号」/「已复制」/「无货号」)会被算成页面数据。反馈 #96 就是这么把
 *   右列「成交件数 340」复制成货号的 —— 而且只在 100~999 时出错,
 *   因为官方货号正则的量词恰好是 {3,30}。
 *   一律走 `textWithoutExt(root)`,判据是 `data-*` 结构标记而不是按钮文案。
 *
 * 【消息提示(AGENTS 第 21 条三段式)】
 *   来源词复用「货号复制」(同一功能语义,不另造词),`keepHistory:false`
 *   —— 复制是高频操作,全收进消息盒子会把历史刷满;按钮本身闪「已复制」
 *   已是第一反馈,消息条只兜「视线不在按钮上」那一种。
 *
 * 【虚拟滚动 / 平台重绘】
 *   用户交来的结构报告显示这两页的 tbody 目前是**一次性渲染**(10~11 行、
 *   无绝对定位/transform 线索),但切 tab、改筛选、翻页都会整块重建 tbody ⇒
 *   MutationObserver(当帧 rAF 补涂 + 300ms 尾扫)+ 首屏 3 次兜底扫描。
 *   只扫 `tbody tr`(几十行量级),不做全页通配查询。
 *
 * 【开关】flags.js 的 `compassTableCopyCode`(抖店组,默认开)。
 *   关掉即时生效:摘观察器 + 移除按钮 + 还原名称元素的内联样式(页面回原样)。
 * ============================================================
 */

(function dycCompassTable() {
  'use strict';

  // 防重复注入(SPA 路由回切、脚本意外重跑时不叠按钮)
  if (window.__dycCompassTableLoaded) return;
  window.__dycCompassTableLoaded = true;

  var BTN_CLASS = 'dyc-ct-btn';
  var STYLE_ID = 'dyc-ct-style';
  var MARK = 'data-dyc-ct-expand';            // 名称元素:已展开
  var MARK_ORIG = 'data-dyc-ct-expand-orig';  // 名称元素:平台原内联值备份
  // 祖先链的备份 / 标记（2026-10-18：钳制往往在祖先层，单独一套，互不干扰）
  var MARK_CHAIN = 'data-dyc-ct-chain-orig';  // 祖先：原始内联值备份
  var MARK_CHAINED = 'data-dyc-ct-chained';   // 祖先：已处理标记
  var MARK_ROW = 'data-dyc-ct-row-orig';      // 行（TR）：原始内联值备份
  var WHERE_MARK = 'data-dyc-ct-where';       // 行：上一次的落点类型（日志降噪用）
  // 按钮：本枚按钮是**按哪套落点逻辑**放在哪个位置的（2026-10-19 防抖动）。
  //
  // 【为什么必须记在按钮自己身上】
  //   「补涂」每 300ms 跑一次。旧版幂等判据是「按钮在不在 + 落点对不对」，
  //   而「落点对不对」只能靠 `btnFollowsIcon()` 反问一次 —— 一旦这一行**有**复制图标、
  //   但我们上一轮因故（图标被盖住 / 被挤出视口）把按钮放到了别处，判据就会认为
  //   「落点不对 ⇒ 摘掉重插」，下一轮又失败、又摘又插…**每 300ms 抖一次**。
  //   真机报告里的 `扫描完成：候选行 10 · 本轮插入 8`（稳态本该是 0）就是它。
  //   抖动期间按钮被反复重建，「已复制」写完就被新按钮顶掉 —— 用户说的
  //   「点了之后有时会有显示有时没有显示已复制」正是这个。
  //   ⇒ 改成：放好之后在按钮上记下「哪一版逻辑 + 哪种落点」，
  //     下一轮只要**还在原位、还能点到**就一律不动。版本号一变才重放一次。
  var ATTR_AT = 'data-dyc-ct-at';             // 按钮：落点版本 + 类型
  // v8（2026-10-19 第八轮）：用户拍板「尽量同一条纵轴」⇒ 横向回归**名字块右
  //   边界**（= 格子右边界，整页恒定）。v7 的「内容右边界」在长名字行与它重合，
  //   但短名字行按钮会左移 —— 用户宁可短行按钮悬在空白处也要整页齐一条线。
  var PLACE_VER = 'v8';                       // 落点逻辑版本（改了落点规则就 +1）
  // ── 徽标落点（2026-10-19 三改：唯一落点，彻底治「走位」）──
  //
  // 【为什么要换整套落点】
  //   前三版都是「把按钮插进平台的 DOM 流里找位置」：ID 图标右侧 → 图标左侧 →
  //   名称右侧 → 单元格内名称前 → 单元格末尾。五个降级档，每行结构不同就落到
  //   不同档 ⇒ 用户看到的是一页里按钮东一个西一个，还会因为 ID 数字变长、
  //   图标位置变化而**越用越偏**。用户 2026-10-19 贴的截图就是最坏那档：
  //   按钮掉到「全店TOP3」标签下面、左对齐，跟商品名毫无关系。
  //
  //   ⇒ 现在只保留**一个**落点：按钮脱离文档流（position:absolute），
  //     坐标只由「商品名块的右下角」算出来。既不被 flex 挤压，也不参与行高，
  //     更不会因为 ID 那串数字变长而漂移。所有行、所有页面同一套规则。
  var MARK_HOST = 'data-dyc-ct-host';         // 定位容器（商品信息 <td>）：已设 relative
  var MARK_HOST_ORIG = 'data-dyc-ct-host-orig'; // 定位容器：原 position 备份
  var MARK_PAD = 'data-dyc-ct-pad-orig';      // 名称元素：原 padding / box-sizing 备份
  var MARK_PAD_ED = 'data-dyc-ct-padded';     // 名称元素：已补过落位空白（值为版本号）
  var MARK_NAME_WH = 'data-dyc-ct-name-wh';   // 名称元素：上次量文字底边时的宽×高
  // 落位方案的版本号。改变落位思路时**必须**换一个值：
  //   名称元素上已经打过的旧标记，靠它才能识别出「这是上一版的遗留」并还原干净。
  //
  // 【为什么按钮尺寸变了也要 +1（5 → 6）】补进名字底部的空白高度 = 按钮高 + 空档，
  //   它会随按钮一起长（24 → 28）。只改尺寸、不动 PAD_VER 的话，页面上已有
  //   `data-dyc-ct-padded = 5` 的元素会被 `ensureBadgeRoom` 早退跳过 ⇒ 空白仍是
  //   24px，而按钮已经 24px 高、又往下压了 4px 空档 ⇒ 底部溢出 4px 压到 ID 行。
  //   **「幂等早退」必须校验状态是否仍然正确，不能只校验「我处理过了」。**
  var PAD_VER = '6';
  // 【按钮尺寸：56×24，字号 13px】
  //
  // 【尺寸变迁】
  //   · 第一~四轮（横向让位）为了少挤商品名，一路把按钮收到 48×20、字 12px ——
  //     那时按钮与名字抢同一条水平线，**按钮每宽 1px 就是名字少 1px**。
  //   · 第五轮改成纵向错开（名称块底部补空白，按钮落在文字正下方）后，
  //     这笔账一笔勾销：按钮不再占文字的任何宽度 ⇒ 尺寸可以纯按「好不好看」定。
  //   · 第六轮用户反馈「按钮大一些些」⇒ 48×20 → **56×24**、字号 12 → 13px。
  //     只放大一档：再大就会盖住下面的 ID 行（行距有限），也会让每行多出的
  //     空白过高（`BADGE_PAD_BOTTOM` 随按钮高一起长）。
  //   「已复制」三个 13px 字约 39px，56px 宽扣掉 2px 边框仍留 7px/侧内边距。
  //
  // 【第五轮：横向让位彻底失败，改成纵向错开】
  //   前四轮全在横向上使劲（按钮 56→48、右侧预留 50→70、空缝 10→30），
  //   用户四次反馈「压字 / 还是不行」。根因是**横向是零和的**：商品名占满
  //   整格宽度，按钮与文字只能抢同一条水平线，怎么调都是「盖字」或「挤窄名字」
  //   二选一，10px 与 30px 只是把同一个取舍换个刻度。
  //   ⇒ 改成纵向错开：给名称块底部补出一行空白，按钮落到文字**正下方**。
  //   商品名恢复全宽、不再提前折行；按钮不再与任何文字同排 —— 冲突从根上消失。
  var BADGE_FALLBACK_W = 56;                  // 按钮宽（CSS 里的固定值，量不到时用）
  var BADGE_FALLBACK_H = 24;                  // 按钮高
  var BADGE_INSET = 4;                        // 按钮右边界相对「最后一行文字右端」的内缩
  // 按钮顶边与「文字真实底边」之间留出的空档。
  //
  // 【为什么是 4 而不是 0】按钮有 1px 边框 + 2px 圆角，贴到 0 时名字最后一行
  //   若带下划线、或结尾是英文 descender（g/y/p 的尾巴），视觉上会擦到边框。
  var BADGE_DROP = 4;
  // 名称块底部补出的空白高度 = 按钮高 + 空档 = 28px。
  //   这段 padding 同时干两件事：① 给按钮腾出落位；② 把下面的 ID 行推下去，
  //   保证按钮既不盖名字也不盖 ID —— 用户要的是「名字右下角」，不是「盖住 ID」。
  //
  //   ⚠️ 必须用 `padding-bottom` 而不是 `margin-bottom`：margin 在块级父容器里
  //     可能塌陷（collapse），塌陷后父容器不增高、ID 行也不会被推开，按钮就白留了。
  //   ⚠️ 它会随按钮高自动变化（按钮 20 → 24 时就跟着 24 → 28）——
  //     写死数字会让放大后的按钮顶穿空白、重新压到 ID 行上。
  var BADGE_PAD_BOTTOM = BADGE_FALLBACK_H + BADGE_DROP;   // = 28
  var BADGE_TOL = 1.5;                        // 「位置没变」的容差（px），防每轮微调
  var NAME_MAX_SCAN = 400;                    // 单行最多扫这么多节点,防异常结构拖慢

  /* ---------- 依赖自检(flags.js 必须先加载) ---------- */
  if (typeof dycReadFlags !== 'function' || typeof dycWatchFlags !== 'function') {
    return;
  }

  var flags = null;
  var observer = null;
  var pending = false;
  var tailTimer = null;
  var resizeBound = false;   // resize 监听只绑一次

  function enabled() {
    return !!flags && flags.compassTableCopyCode !== false;
  }

  /* ==========================================================
   * 〇、调试日志(2026-10-18 用户反馈「没有生效」后补)
   *
   * 【为什么必须补这一层】
   *   用户报「没有生效」时，我在本地只能靠猜：
   *   是 manifest 没注入？是页面结构不符？是名称没找到？还是根本没渲染出来？
   *   四件事各有各的修法，猜错就会改错地方。
   *
   *   而「调试模式」这个功能本来就是为了回答这种问题 —— 但最该诊断的
   *   这个功能自己是**哑巴**：它既不写日志、也不在调试面板里留任何痕迹，
   *   用户在罗盘页开调试模式也只看到一块空面板。
   *
   *   ⇒ 现在把下面这些关键节点都写进 debugLog（走 debug-panel.js 的
   *     window.debugLog；它不在时静默跳，绝不因为日志报错影响主流程）：
   *       · 页面开始扫描：URL、命中表格数、候选行数
   *       · 每行：找到的名称元素文本（截断 20 字）+ 是否截断 + 按钮落点
   *       · 找不到名称元素的行：列数 / 有无缩略图（直接指向判据哪一环断了）
   *       · 注入汇总：本轮插了 / 跳过了多少行
   *   一条能看出「卡在哪一环」的日志，比再猜五轮都省事。
   *
   * ⚠️ 日志只记**结构与长度**，不记经营数据：
   *    商品名截 20 字（这是用户自己的商品名，且截断后不足以还原全名），
   *    价格 / 库存 / 销量一律不记。
   * ========================================================== */

  var LOG_PREFIX = '[罗盘商品表]';

  /**
   * 写一条调试日志，**同一条连续重复时合并成「×N」**。
   *
   * 为什么要有这个：第一次真机报告里 20 条轨迹有 16 条一模一样
   * （「跳过一行：没找到商品名元素（列=7 缩略图=无 高=36）」），
   * 把真正有用的那几条（启动 / 注入 / 汇总）全挤出了可视区。
   * 去重规则：连续相同的消息先攒着，等出现不同消息或 800ms 静默再一次性发出。
   */
  var logPending = null;      // { msg: string, n: number }
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

  function dbg(msg) {
    if (logPending && logPending.msg === msg) {
      logPending.n++;
    } else {
      flushLog();
      logPending = { msg: msg, n: 1 };
    }
    if (logTimer === null) logTimer = setTimeout(flushLog, LOG_MERGE_MS);
  }

  /** 诊断用：把一行的情况压成一句话（列数 / 有无缩略图 / 名额） */
  function rowBrief(row) {
    var tdCount = 0;
    var kids = row.children || [];
    for (var i = 0; i < kids.length; i++) if (kids[i].tagName === 'TD') tdCount++;
    var hasImg = false;
    try { hasImg = !!row.querySelector('img'); } catch (e) { hasImg = false; }
    return '列=' + tdCount + ' 缩略图=' + (hasImg ? '有' : '无') +
           ' 高=' + row.clientHeight;
  }

  /**
   * 这一行为什么**全程没拿到按钮** —— 只在「真的没有按钮」时才调用，
   * 且顺手把原因归类，让日志自己说明该改哪一档判据。
   *
   * 真机报告（2026-10-18）里 16 行全是「列=7 缩略图=无 高=36」：
   * 那是**分页条 / 小计行**之类的非商品行，本来就不该有按钮 ——
   * 说明以前的日志把「不该处理的行」和「该处理却没找到名称」混成一条，
   * 看着像功能坏了。现在分开说，且只记「有缩略图/列多」的可疑行。
   */
  function whyNoButton(row) {
    var brief = rowBrief(row);
    var hasBtn = false;
    try { hasBtn = !!row.querySelector('.' + BTN_CLASS); } catch (e) { hasBtn = false; }
    if (hasBtn) return '';
    var hasImgRow = false;
    try { hasImgRow = !!row.querySelector('img'); } catch (e) { hasImgRow = false; }
    // 非商品行不刷日志 —— 判据是「有没有缩略图」。
    // 2026-10-18 真机噪音：`可疑行没找到商品名（列=8 缩略图=无 高=36）（×18）`
    // 刷了 18 条 —— 那是**没有缩略图的行**（小计条 / 嵌套表头），本来就不该有按钮。
    // 商品行的硬特征就是「有缩略图」，所以只认这一条，不再看列数。
    if (!hasImgRow) return '';
    var nameEl = findNameEl(row);
    if (!nameEl) return '可疑行没找到商品名（' + brief + '）';
    return '可疑行有名称但没插按钮（' + brief + '）';
  }

  /** 名称文本截断到 20 字（只用于日志，不进任何画面） */
  function clip(s) {
    s = String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
    return s.length > 20 ? s.slice(0, 20) + '…' : s;
  }

  /* ==========================================================
   * 一、样式(JS 注入;固定 px + 与平台隔离,不随页面缩放变大小)
   *
   * 只有按钮本体进样式表;名称的「解截断」一律写**逐元素内联** ——
   * 因为要不要展开取决于「这一行到底截没截断」,而 CSS 做不到这个判断。
   * ========================================================== */

  var CSS = [
    '.' + BTN_CLASS + ' {',
    '  all: initial;',
    // 块级 flex:① 让 `margin-left:auto` 能把它推到右侧;② 内容居中。
    '  display: flex; align-items: center; justify-content: center;',
    // 宽度固定 56px:点击后文案在「货号 / 已复制 / 无货号」间切换,长度不同。
    // 宽度一定,flash 只换文字与配色 ⇒ 相邻元素不会被推挤(中控台那枚同口径)。
    // ⚠️ 2026-10-19 真机：宽高必须带 !important 钉死。
    //   平台对单元格内的 button 常有 `min-height` / `padding` 规则，
    //   按钮一旦被撑高 10px，`top = 名字块底 − 按钮高` 就会把它顶到上一行去，
    //   表现是「按钮骑在两行文字之间、压住上半截」。
    // ⚠️ 这三个数（宽 / 高 / 字号）必须与 JS 常量 BADGE_FALLBACK_W / _H 同步改：
    //   常量参与坐标计算，样式参与实际渲染，两者不一致会算错落位。
    '  width: 56px !important; height: 24px !important;',
    '  min-height: 0 !important; max-height: 24px !important; padding: 0 !important;',
    // 跟 ID 行同一行时不能再带上边距（否则会把那一行顶高）
    '  line-height: 1;',
    // 兜底落点:名称下方一行、右对齐。
    '  margin: 2px 0 0 auto !important;',
    // 锁宽:插进平台 flex 容器后 `all: initial` 会把 flex-shrink 重置成 1,
    // 空间不足时按钮被压扁(#88 真机实测宽 48px)。非 flex 容器里无副作用。
    '  flex: 0 0 auto;',
    '  border: 1px solid #0064d9; border-radius: 4px;',
    '  background: #fff; color: #0064d9;',
    "  font: 13px/1 -apple-system, 'Microsoft YaHei', sans-serif;",
    '  white-space: nowrap; cursor: pointer; box-sizing: border-box;',
    // ⚠️ 2026-10-19「按钮点不了」的两条保险：
    //   ① `pointer-events: auto` —— 平台很多装饰层/图标外层会设
    //      `pointer-events:none`（让点击穿透到父级），按钮插进那种容器里就点不动；
    //   ② `z-index: 1` —— 同层里若有平台的绝对定位覆盖层，抬一层确保按钮在上。
    //   两条都带 !important，且只作用于我们自己的按钮，不影响页面其它元素。
    '  pointer-events: auto !important;',
    '  z-index: 1;',
    // ⚠️ 2026-10-19 用户反馈「颜色相比淡很多不够明显」：
    //   原来这里是 `opacity: .55`（与中控台那枚同口径），但罗盘这两页的
    //   商品信息单元格底色偏灰、ID 行本身也是浅灰小字 ⇒ .55 的蓝字几乎看不见。
    //   ⇒ ① 不透明度给满（1）；② 底色用**不透明浅蓝**（比纯白底醒目）；③ 字重加半档；
    //     ④ 蓝色用更深的 #0064d9（原来 #0075ff 在白底上偏浅）。
    //   这几条都带 !important：`all: initial` 的优先级与普通声明相同，
    //   平台若有更具体的选择器（如 `td button { opacity:.6 }`）会盖掉我们 ——
    //   那正是「比小黄车淡」的另一种可能成因，索性把关键视觉属性全部钉死。
    '  opacity: 1 !important;',
    '  background: #eaf3ff !important;',
    '  color: #0064d9 !important;',
    '  border-color: #0064d9 !important;',
    '  font-weight: 500 !important;',
    '  transition: background .15s, color .15s, border-color .15s, box-shadow .15s;',
    '}',
    // 跟 ID 图标同一行的形态（2026-10-18 用户要求：按钮放「复制商品 ID」右侧）。
    // ⚠️ 必须 `inline-flex` —— 用 `flex` 会独占一行，那正是用户报的
    //   「为了这个按钮，新增了一行」。
    // 插在锚点**左侧**时，间隔放到右边（否则会贴住左边的文字）
    '.' + BTN_CLASS + '.is-inline.is-before {',
    '  margin: 0 6px 0 0 !important;',
    '}',
    '.' + BTN_CLASS + '.is-inline {',
    '  display: inline-flex;',
    '  margin: 0 0 0 6px !important;',
    // 与 ID 文字垂直居中：`middle` 在老内核上偶尔偏下，-1px 微调对齐
    // ⚠️ 不再用 `top:-1px` 做微调：那会让按钮顶部超出祖先的 overflow 裁剪区，
    //    既少 1px 可点区域，也可能在个别内核上把按钮判成「被裁」。
    //    垂直对齐交给 `vertical-align: middle` 就够。
    '  vertical-align: middle;',
    '  position: relative;',
    '}',
    // ── 徽标落点（2026-10-19 三改：唯一落点）──
    //   绝对定位 ⇒ **不参与任何布局**：
    //     · 不会被平台的 flex 容器挤扁 / 挤出视口；
    //     · 不会把行撑高（用户第六轮报的「为了这个按钮新增一行」）；
    //     · 不会跟着「ID 3847…」那串数字的长度左右漂移；
    //     · 平台重排时它自己不动，只有 placeBadge() 显式算出的坐标能挪它。
    //   坐标由 placeBadge() 写成 inline left/top（相对商品信息单元格）。
    '.' + BTN_CLASS + '.is-badge {',
    '  position: absolute !important;',
    '  display: flex;',
    '  margin: 0 !important;',
    // 名字块可能 overflow:visible 且带背景，按钮要浮在文字之上
    '  z-index: 3;',
    '}',
    '.' + BTN_CLASS + ':hover { background: #0064d9 !important; color: #fff !important; border-color: #0064d9 !important; }',
    // 按下即变（不等复制回调）—— clipboard 是异步的，按下到「已复制」之间有
    // 几十~几百毫秒空档。`:active` 提供第一层即时感，`onTrigger` 里还会同步补
    // 一个 `.is-press`（见 press()）：`pointerdown` 上我们调了 preventDefault，
    // 部分内核会把 `:active` 一起掐掉 —— 那一层不能只靠伪类。
    '.' + BTN_CLASS + ':active { background: #0050b3 !important; color: #fff !important; border-color: #0050b3 !important; }',
    // ── 点击反馈（2026-10-19 二改，用户第二次真机反馈后重做）──
    //
    // 【一改踩的坑】把小黄车那套「实心蓝底 + 2px 外光晕」照搬过来，用户实测：
    //   「显示后跟我的按钮初始状态差别很突兀，边框不一样且颜色深浅也不一样」。
    //   根因是 `box-shadow: 0 0 0 2px` —— 视觉上等于**把 1px 边框加粗成 3px**，
    //   看上去像换了一枚控件；底色再从浅蓝突变实心蓝，落差自然大。
    //
    // 【二改的口径】只改**填充与字色**，其余一律不动：
    //   · 边框宽度 / 圆角 / 宽高 / 内边距 / 字号，与初始态**逐项相同**；
    //   · 成功填成品牌蓝（与 hover 同色 —— 用户手一放上去就见过，不陌生）；
    //   · 光晕改成 `inset`（画在边框内侧），不占布局、不加粗外框；
    //   · 失败填成灰蓝，同样只换填充。
    //   ⇒ 视觉上是「同一枚按钮被按实了」，而不是「换了一枚按钮」。
    //
    // ⚠️ 仍然**不用** `transform: scale()`：它会改变 `getBoundingClientRect`，
    //    而 `spotUsable()` 正是靠 rect 判「落点能不能点到」；放大 6% 可能让贴着
    //    右边界的按钮被判成越界，于是补涂当场把它摘掉，反馈自己把自己打断。
    '.' + BTN_CLASS + '.is-press {',
    '  background: #0050b3 !important;',
    '  color: #fff !important;',
    '  border-color: #0050b3 !important;',
    '}',
    '.' + BTN_CLASS + '.is-ok {',
    '  background: #0064d9 !important;',
    '  color: #fff !important;',
    '  border-color: #0064d9 !important;',
    '  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, .32) !important;',
    '}',
    '.' + BTN_CLASS + '.is-err {',
    '  background: #6b7c93 !important;',
    '  color: #fff !important;',
    '  border-color: #6b7c93 !important;',
    '}',
    '.' + BTN_CLASS + '.is-err:hover { background: #5a6a80 !important; color: #fff !important; border-color: #5a6a80 !important; }'
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
   * 二、款号识别(三档,与 live-detail.js / copy-code.js 同一口径)
   * ========================================================== */

  /** 像款号吗:3~30 位的字母数字/连字符/下划线 */
  function isCodeLike(s) {
    return !!s && /^[A-Za-z0-9][A-Za-z0-9\-_]{2,29}$/.test(s);
  }

  /* ---------- 取值输入:剔除扩展自己注入的节点(AGENTS 第 23 条) ---------- */

  /**
   * 扩展注入的节点标记。**凡是这些子树里的文本,一律不算页面数据。**
   *
   * 为什么必须有这一层(2026-10-18 反馈 #96 真机事故):
   *   我们自己的按钮文案就是「货号」二字,它被插在商品名之后;读整行文本时,
   *   按钮文案与右邻那一列的数字被空白折叠拼成「货号 340」⇒ 官方货号正则
   *   `货号\s*[:：]?\s*([A-Za-z0-9\-_]{3,30})` 命中,把成交量当货号复制走了。
   *   ⇒ 判据必须是**结构标记**(认 data-* 属性),不能依赖按钮文案叫什么:
   *     以后按钮改名成「库存」「销量」都不会再污染取值。
   *
   * ⚠️ 用 getAttribute 逐个判,不用 Element.matches —— 老内核(360 极速浏览器X)上
   *    matches 的行为曾因内核版本而异;属性判断没有任何兼容面。
   */
  var EXT_MARKS = ['data-dyc-ct-btn', 'data-dyc-ld-btn', 'data-dyc-code-btn', 'data-dyc-idbtn'];

  /** 这个元素是不是扩展自己注入的节点 */
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
   *
   * @param {Element|null} root
   * @return {string} 空白折叠后的文本;root 为空时返回 ''
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
      return '';   // 读不到宁可走名称末尾推算,也不复制错东西
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

  /**
   * ① 官方货号:在**剔除扩展节点**后的文本里找「货号 xxx」。
   *
   * 范围两道:先商品信息单元格(只有名称/缩略图/我们的按钮),
   * 读不到「货号」二字才退整行。两道都必须已剔除扩展节点。
   *
   * ⚠️ 绝不可直接读 row.innerText(#96 的成因)。
   *    纯数字货号(如 10086)**照读**,isCodeLike 口径不动(用户 2026-10-18 明确)。
   *
   * @param {Element} row 整行(只作兜底范围)
   * @param {Element} [nameEl] 商品名元素;给了就优先在它所属的单元格里读
   */
  function readOfficialCode(row, nameEl) {
    try {
      var cell = infoCellOf(nameEl || null);
      var t = textWithoutExt(cell);
      if (!/货号/.test(t)) {
        var rt = textWithoutExt(row);
        if (rt) t = rt;
      }
      if (!t) return '';
      var m = t.match(/货号\s*[:：]?\s*([A-Za-z0-9\-_]{3,30})/);
      if (m && isCodeLike(m[1])) return m[1];
    } catch (e) { /* 尽力而为 */ }
    return '';
  }

  /**
   * ② 名称尾部推算:末尾「≥4 位且含数字」的字母数字串。
   *    必须含数字 —— 纯英文字尾(英文词 / 拼音)多半不是款号。
   *
   * ⚠️ 先剥掉末尾的「ID」/「复制」字样 —— 平台的「复制 ID」小按钮常被
   *    包在名称元素里(26.10.14.4 在商品列表页踩过:商品名行尾带 ID 文案,
   *    名称段与匹配范围不同源)。不剥的话末尾 token 恒为「ID」⇒ 永远取不到款号。
   */
  function guessFromName(nameEl) {
    if (!nameEl) return '';
    // 用 textWithoutExt 而不是 textContent：我们的按钮有可能被插进名称元素内部
    // （名称容器里本来就有平台「复制 ID」按钮时，落点 ① 会插在它右边），
    // 那样 textContent 末尾会多出「货号」二字 ⇒ 末尾 token 不是款号（AGENTS 第 23 条）。
    var t = textWithoutExt(nameEl) || (nameEl.textContent || '');
    t = t.replace(/\s+/g, ' ').trim();
    if (!t) return '';
    // 反复剥:可能连着出现「… NE1C1091W ID 复制」（textContent 无分隔符时是
    // 「NE1C1091WID复制」）。两轮:先剥尾部「复制」，再剥尾部独立的「ID」。
    //   · 「复制」不限前边界 —— 它不可能是款号的一部分(款号只有字母数字-_);
    //   · 「ID」必须**独立的尾部词元**(前面是空白或开头),否则款号本身以 ID
    //     结尾(如 "AB12ID")会被误剥成 "AB12"。
    var guard = 0;
    while (guard++ < 6) {
      var before = t;
      t = t.replace(/复制\s*$/, '').trim();
      t = t.replace(/(?:^|\s)ID\s*$/i, '').trim();
      if (t === before) break;
    }
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

  /* ==========================================================
   * 三、名称元素识别(三级判据,见文件头)
   * ========================================================== */

  var NOT_NAME = /^(到手价|售出|已售|库存|货号|规格|设置卖点|未设提词|销量|商品ID|商品 ID|ID|累计|占比|曝光|点击|成交|退款|支付|客单)/;
  var ONLY_NUM = /^[\d\s.,::%\-+()（）#¥￥]+$/;
  /**
   * 平台提示语(不是商品名)—— 直播明细 #88/#85 的父级教训:
   *   无库存 / 已下架 / 讲解中的行会多渲染一句提示,它比商品名更长,
   *   按「文本最长」就会挑中提示语 ⇒ 名称末尾推不出款号、按钮闪「无货号」。
   */
  var HINT_TEXT = /无库存|不可购买|已下架|已售罄|暂不支持|无法购买|讲解中/;

  /** 元素是否带「直接文本」节点(纯容器不算,避免命中整行) */
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

  /**
   * 找一行的商品名元素。
   *
   * @param {Element} row
   * @return {Element|null} 找不到返回 null(调用方跳过这一行,不乱插按钮)
   */
  function findNameEl(row) {
    if (!row) return null;

    // ① 类名前缀(罗盘同一套业务组件;直播明细页实测为 p.productName-*)
    var prefixes = ['productName-', 'goodsName-', 'itemName-', 'productTitle-'];
    for (var p = 0; p < prefixes.length; p++) {
      var hit = null;
      try { hit = row.querySelector('[class*="' + prefixes[p] + '"]'); } catch (e) { hit = null; }
      if (!hit || isExtNode(hit)) continue;
      if (hasDirectText(hit) && String(hit.textContent || '').trim().length >= 4) return hit;
      // 前缀命中的是外层容器(没有直接文本)时,往下挑一个带文本的
      var inner = pickNameIn(hit);
      if (inner) return inner;
    }

    // ② 缩略图所在单元格 —— 商品行必有缩略图,这一档最可靠
    var cell = imageCellOf(row);
    var byCell = pickNameIn(cell);
    if (byCell) return byCell;

    // ③ 整行兜底
    return pickNameIn(row);
  }

  /* ==========================================================
   * 四、名称展开（2026-10-18 按真机诊断日志重做）
   *
   * 【上一版为什么「写了样式但一点没变」—— 诊断日志给的证据】
   *   真机报告里每行都是「注入一行（名称下）… 已折行」，但用户截图里名称
   *   仍然是「PM王囡囡 黑/白色菱格纹双头…」**单行 + 省略号**，按钮也看不见。
   *   说明：样式**写进去了，但被平台压住了**。三条原因，缺一条都不生效：
   *
   *     ① **没有 !important** —— 平台的截断规则（`-webkit-line-clamp` +
   *        `overflow:hidden` + 定高）本身就是带 !important 的 CSS Modules 规则，
   *        内联普通声明抢不过它。上一版全走的 `el.style.xxx = yyy`（无优先级）。
   *     ② **只改了名称元素自己** —— 钳制往往落在**祖先层**（外层 wrap 设了
   *        固定 height / overflow:hidden），文字换行了也会被那一层裁掉。
   *     ③ **`-webkit-box-orient: initial` 无效** —— line-clamp 只在
   *        `display:-webkit-box` 下生效；上一版只在「本来是 -webkit-box」时
   *        才改 display，其余情况下 clamp 依旧压着。**一律 display:block。**
   *
   *   ⇒ 这一版：名称元素 + **最近 3 层祖先**（不含 TD/TR/TABLE/BODY）一起放开，
   *     全部用 `setProperty(p, v, 'important')` 写入，逐元素独立备份、关开关逐个还原。
   *     祖先层只放开「钳制类」属性（clamp / max-height / overflow），
   *     **不动 width、不动 display、不动 position** —— 那是表格列宽，动了就崩版。
   *
   * 【为什么每次写之前要比对当前值】
   *   诊断里 `扫描完成：插入 0 跳过 10` 连着刷、且页面报
   *   `ResizeObserver loop completed with undelivered notifications` ——
   *   那是「重复写同样样式 → 平台 ResizeObserver 反复回调」的典型。
   *   现在值相同就跳过不写，一次展开只产生一次重排。
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
    // 名称是 flex 子项时，父容器高度不足会把两行**压回**一行高（真机
    // 日志里的「高=16/32」正是这个形态：内容 32px、盒子 16px）。
    // 只针对名称这一格放开收缩，不影响任何其它元素。
    ['flex-shrink', '0'],
    ['flex-grow', '0'],
    // ⚠️ 关键一条：名称若是 flex 子项、父容器高度固定，浏览器会用
    // **align-items:stretch（默认）把它的高度拉成父容器那么高** ——
    // 这时写 height:auto 是无效的（拉伸值覆盖它），于是 clientHeight 恒为 16、
    // 内容 32 却画在外面 ⇒ 正是用户截图里的「第二行压在 ID 行上」。
    // align-self:flex-start 让这一格按自己的内容高度排，是唯一能治本的一条。
    ['align-self', 'flex-start'],
    // ⚠️ 2026-10-18 第四次真机（商品卡列表）：名称**根本不折行、直接顶进右列**。
    //    日志里 `溢出=0`（scrollWidth === clientWidth）说明它不是「被裁」，
    //    而是**宽度本身就没受约束** —— 元素被内容撑得比单元格还宽。
    //    两条 CSS 是这件事的经典成因，缺一条都不折：
    //      · flex 子项默认 `min-width:auto` ⇒ 不会缩到内容宽度以下 ⇒ 永不换行；
    //      · 宽度没有上限 ⇒ 一路往右长，压到下一列。
    //    ⇒ `min-width:0` 允许收缩、`max-width:100%` 封顶到父层宽，两条一起才有折行。
    ['min-width', '0'],
    ['max-width', '100%']
  ];

  /**
   * 祖先链要放开的属性。
   *
   * ⚠️ 2026-10-18 第二次真机返工：**必须同时放开 height**。
   *   上一版只放 `overflow: visible` 不放 height，结果恰好制造了新 bug ——
   *   祖先那层 height 固定（= 一行高 16px），文字折成两行后被 overflow:visible
   *   放出来**画在盒子外面**，压在下面的「ID …」那一行上 ⇒ 用户看到的就是
   *   「名称第二行和 ID 行重叠」（截图实锤：名样式 高=16/32，scrollHeight 32 = 两行）。
   *   ⇒ 只放开 overflow 而不放开 height 是**错误的组合**：
   *     要么 height:auto + overflow:visible（盒子跟着长高，下面的元素被推开），
   *     要么什么都别动（保持裁切，至少不重叠）。
   *
   * **依然不动 width / display / position** —— 那是表格列宽与定位，动了整张表会崩。
   */
  var CHAIN_DECLS = [
    ['-webkit-line-clamp', 'unset'],
    ['max-height', 'none'],
    ['height', 'auto'],
    ['min-height', '0'],
    ['overflow', 'visible'],
    // 中间那层容器若也是 flex 子项，被压缩同样会让内容溢出到下一行上 ——
    // 只加「别压缩」这一条，不改对齐方式（对齐改了会把标点头像挤歪）。
    ['flex-shrink', '0'],
    // 横向同理：`min-width:0` 允许收缩、`max-width:100%` 逐层封顶，
    // 最终受 <td> 的列宽约束 —— 只有这样文字才会真的换行。
    // ⚠️ 这两条**不改 width**，只是「允许变窄 + 不许超过父层」，
    //    对列宽与缩略图位置没有影响。
    ['min-width', '0'],
    ['max-width', '100%']
  ];

  /**
   * 表格行（TR）只放开高度，**绝不动 overflow**。
   * 行高由 `<tr>` 决定，td 写 height:auto 也不一定让行长高；
   * 而给 tr 写 overflow:visible 会改变表格的行裁切语义，风险不对等 —— 所以拆成两套。
   */
  var ROW_DECLS = [
    ['height', 'auto'],
    ['max-height', 'none']
  ];

  /** 祖先链最多走到第几层（名称 → …容器… → 单元格 → 行） */
  var CHAIN_MAX = 5;

  /**
   * 祖先链走到哪一层就停：TR / TABLE / BODY 一律不碰（改它们是真会崩整表）。
   *
   * ⚠️ 2026-10-18 真机修正：**TD / TH 要放开**（原来也停在这里）。
   *   截图里的截断是「单元格内的那层 div」裁的，但也不能排除有的行列直接把
   *   `overflow:hidden` 写在 `<td>` 上 —— 那样按钮挂进单元格照样被裁。
   *   我们只给 TD 写 `overflow:visible` / `max-height:none` / `line-clamp:none`
   *   这三条（**不动 height、不动 width**），对表格列宽没有影响。
   */
  var CHAIN_STOP = { TABLE: 1, TBODY: 1, THEAD: 1, BODY: 1, HTML: 1 };

  /** TR 用 ROW_DECLS（只放高度），其余祖先用 CHAIN_DECLS */
  function chainDeclsFor(el) {
    return (el && el.tagName === 'TR') ? ROW_DECLS : CHAIN_DECLS;
  }

  /**
   * 备份一个元素上「我们将会覆盖」的那几个属性。
   *
   * 备份值 = { 属性名: {v: 原值, p: 原优先级} }。
   * 已经备份过就不再覆盖 —— 否则第二次写会把**我们自己写进去的 important 值**
   * 存成「原值」，关开关时还原不回平台原样（这个坑 name-wrap.js 踩过）。
   */
  function backupProps(el, mark, decls) {
    if (el.getAttribute(mark) !== null) return;
    var orig = {};
    for (var i = 0; i < decls.length; i++) {
      var p = decls[i][0];
      var v = el.style.getPropertyValue(p);
      if (v) orig[p] = { v: v, p: el.style.getPropertyPriority(p) };
    }
    try { el.setAttribute(mark, JSON.stringify(orig)); } catch (e) { /* 备份失败就按清空还原 */ }
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

  /** 写一条 !important 声明；值已经一致就不写（避免触发平台 ResizeObserver 连环回调） */
  function setImp(el, prop, val) {
    if (el.style.getPropertyValue(prop) === val &&
        el.style.getPropertyPriority(prop) === 'important') {
      return false;
    }
    el.style.setProperty(prop, val, 'important');
    return true;
  }

  /**
   * 平台真把这段文字截断了吗
   *
   * 判据放宽了一点（2026-10-18 真机）：只要**算出来被裁**就算 —— 横向溢出、
   * 纵向溢出、或者计算出的 `-webkit-line-clamp` 不是 none，三者任一。
   * 以前只看滚动尺寸，而 line-clamp 的单行截断在「宽度刚好够」时
   * scrollWidth 未必超 clientWidth ⇒ 漏判 ⇒ 那一行永远不展开。
   */
  function isCut(el) {
    try {
      if (el.clientWidth === 0 && el.clientHeight === 0) return true;   // 不可见：先展开，显示时就是好的
      if (el.scrollWidth - el.clientWidth > 0) return true;
      if (el.scrollHeight - el.clientHeight > 4) return true;
      var cs = getComputedStyle(el);
      // ⚠️ clamp 只有配上 `display:-webkit-box` 才真正生效；display:block 时
      //    即便计算值仍是 1 也不裁（真机报告里出现过 `clamp=1` 但文字已正常折行）。
      //    不区分这一点会把「已经好了」的行反复判成没展开。
      if (isBoxDisplay(cs)) {
        var clamp = clampOf(cs);
        if (clamp && String(clamp) !== 'none' && String(clamp) !== '0') return true;
      }
      // 单行省略号组合：nowrap + overflow:hidden
      if (cs.whiteSpace === 'nowrap' && (cs.overflow === 'hidden' || cs.overflowY === 'hidden')) return true;
      // 撑破单元格（商品卡列表那页就是这一种：自身 scrollWidth 干净，
      // 但整块比 <td> 还宽，文字一路压进右列）
      if (overflowsCell(el)) return true;
      return false;
    } catch (e) {
      return false;
    }
  }

  /**
   * 名称是不是**比它所在的单元格还宽**（2026-10-18 商品卡列表真机新增）
   *
   * 【为什么光看 scrollWidth 判不出来】
   *   商品卡列表那页的日志是 `溢出=0`（scrollWidth === clientWidth）、
   *   `clamp=none`、`高=16/16` —— 按老的 isCut 判据「完全没截断」，于是
   *   **一次展开都没做**；但截图里名称明明一路顶进了右列。
   *   原因：它不是「内容被小盒子裁掉」，而是**盒子本身被内容撑得比单元格还宽** ——
   *   自身没有溢出（所以 scrollWidth 看着很干净），溢出发生在**它和父容器之间**。
   *   ⇒ 判据必须再加一条：**右边界越过单元格右边界**（或比单元格还宽）。
   *
   * @return {boolean} true = 名称撑破了单元格，需要约束宽度
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
      // 右边界越界（1px 容差：亚像素取整会让「刚好贴合」误判）
      if (er.right > cr.right + 1) return true;
      // 本身比单元格还宽（有些情况下元素被居中/偏移，右边界不一定越界）
      if (er.width > cr.width + 1) return true;
      return false;
    } catch (e) {
      return false;
    }
  }

  /** 是不是「行数钳制」那种布局（只有这种 display 下 line-clamp 才真裁） */
  function isBoxDisplay(cs) {
    var d = String(cs.display || '');
    return d === '-webkit-box' || d === '-webkit-inline-box';
  }

  /** 读计算后的 line-clamp（新老写法都试） */
  function clampOf(cs) {
    return cs.webkitLineClamp || cs.getPropertyValue('-webkit-line-clamp');
  }

  /**
   * 「已展开」的复核（幂等双条件）
   *
   * 不能只看我们的标记：平台重渲染会重写 style，标记却留下来。
   * 所以核对**计算值** —— 只要还是 nowrap / 还带 clamp / 还在横向截断，
   * 就当没处理过，重写一遍。
   */
  function stillExpanded(el) {
    try {
      var cs = getComputedStyle(el);
      if (cs.whiteSpace !== 'normal') return false;
      if (isBoxDisplay(cs)) return false;          // 还压着 -webkit-box ⇒ 没展开
      if (el.scrollWidth - el.clientWidth > 0) return false;
      // 竖着还装不下（内容比盒子高）⇒ 说明盒子没长开，需要再走一遍
      if (el.scrollHeight - el.clientHeight > 4) return false;
      // 横向还撑着单元格 ⇒ 宽度约束没生效，需要再走一遍
      // （商品卡列表那页就卡在这：样式都写进去了，但宽度没被约束住）
      if (overflowsCell(el)) return false;
      // 高度有两种「已展开」的合法形态：
      //   · auto   —— 盒子被平台自然撑开（多数情况）；
      //   · 具体像素 —— ensureNoOverlap 发现 auto 撑不开时，显式锁成内容高度。
      // 只认 auto 会让「锁高度」的行每一轮都被判成「没展开」，白跑一遍。
      var h = el.style.getPropertyValue('height');
      if (h === 'auto') return true;
      if (/^\d+(\.\d+)?px$/.test(h)) return el.scrollHeight - el.clientHeight <= 4;
      return false;
    } catch (e) {
      return false;   // 复核失败就当没处理过，重写一遍最安全
    }
  }

  /**
   * 展开后的最后一道保险（2026-10-18 用户截图「名称第二行压在 ID 行上」）
   *
   * 【为什么需要它】
   *   折行这件事已经成功了（截图里名称确实两行），但**盒子没跟着长高**：
   *   平台那一层的 height 被人为写死成一行高，我们又给了 `overflow: visible`
   *   ⇒ 第二行被「放出来」画在盒子外面，正好压住下面的「ID …」行。
   *   实测数据能佐证：nameBrief 报「高=16/32」—— 内容 32px、盒子 16px。
   *
   * 祖先链现在也会放开 height（CHAIN_DECLS / ROW_DECLS），正常应该长高。
   * 但平台写法各页不一，**不能假设一定长高**，所以这里复核一次：
   *   · 长高了 → 保持 overflow: visible（正常展开，下面的元素被自然推开）；
   *   · 没长高 → 把 overflow 收回 hidden（宁可显示省略号，也绝不让文字压到别人身上）。
   *   这条保险的取舍写了在明处：**重叠比省略号更糟**（省略号只是信息不全，
   *   重叠会让用户读错 ID）。
   *
   * @return {boolean} true = 真的长开了
   */
  function ensureNoOverlap(el) {
    try {
      var need = el.scrollHeight;
      var have = el.clientHeight;
      if (need - have <= 4) return true;          // 已经长开了

      // ── 第 1 招：把盒子高度**显式锁成内容高度** ──
      //   `height:auto` 在这里居然没让它长高（真机 nameBrief 报 高=16/32：
      //   内容 32px、盒子 16px），说明还有别的东西在压 —— 与其猜是哪一条，
      //   不如直接把盒子撑到内容高度：这一招不依赖「谁在压」，一定生效。
      //   代价：高度是算出来的像素值，缩放 / 换行数变化时要重算 ——
      //   下面挂了 resize 与观察器补涂，会在下一轮重新走这里。
      setImp(el, 'height', need + 'px');
      lastGrow = 'lock';

      var need2 = el.scrollHeight;
      var have2 = el.clientHeight;
      if (need2 - have2 <= 4) return true;

      // ── 第 2 招（兜底）：确实撑不开 —— 收回 overflow ──
      //   宁可显示省略号，也绝不让文字画到盒子外压住下一行。
      //   取舍写在这里：**重叠比省略号更糟**（省略号只是信息不全，
      //   重叠会让用户把下一行的 ID 读成商品名的一部分）。
      setImp(el, 'height', 'auto');
      setImp(el, 'overflow', 'hidden');
      lastGrow = 'clip';
      return false;
    } catch (e) {
      return true;   // 测不了就不动，保持现状
    }
  }

  /** 上一轮「撑高」走了哪条路：'lock' 锁内容高度 / 'clip' 收回裁切 / '' 未遇到 */
  var lastGrow = '';

  /**
   * 展开名称：名称元素 + 最近 CHAIN_MAX 层祖先一起松开钳制。
   *
   * @param {Element} el 名称元素
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
    //    行（TR）只放高度 —— 详见 CHAIN_DECLS / ROW_DECLS 的注释。
    var up = el.parentElement;
    var depth = 0;
    while (up && depth < CHAIN_MAX && !CHAIN_STOP[up.tagName]) {
      var decls = chainDeclsFor(up);
      // ⚠️ 备份键要跟着 decls 走：TR 只备份那两条，否则还原时会把
      //    「本来就没碰过的 overflow」也当成我们的写入去清。
      var mark = (up.tagName === 'TR') ? MARK_ROW : MARK_CHAIN;
      backupProps(up, mark, decls);
      for (var k = 0; k < decls.length; k++) {
        if (setImp(up, decls[k][0], decls[k][1])) changed++;
      }
      up.setAttribute(MARK_CHAINED, '1');
      up = up.parentElement;
      depth++;
    }

    // ③ 最后保险：确认盒子真的长开了（见 ensureNoOverlap 的说明）
    ensureNoOverlap(el);
    return changed;
  }

  /** 还原名称元素与它被改过的祖先（关开关时逐个清） */
  function restoreEl(el) {
    restoreProps(el, MARK_ORIG, NAME_DECLS);
    // 2026-10-19 三改：为徽标预留的右侧空间也要还回去，否则关掉开关后
    // 商品名会一直窄一截（按钮没了，空白还在）。
    restoreProps(el, MARK_PAD, [['padding-right'], ['padding-bottom'], ['box-sizing']]);
    el.removeAttribute(MARK_PAD_ED);
    el.removeAttribute(MARK_NAME_WH);
    // 文字底边的偏移缓存也要清 —— 否则开关再打开时会拿旧值算坐标。
    try { delete el.__dycTBOff; delete el.__dycTBKey; } catch (e3) { /* 删不掉也无所谓 */ }
    el.removeAttribute(MARK);

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
   * 五、复制(含降级)
   * ========================================================== */

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

  /**
   * 弹一条消息提示(AGENTS 第 21 条三段式:来源 ｜ 值 ｜ 结果数)
   *   · 复制是高频操作 ⇒ 只弹几秒、**不进消息盒子**(keepHistory:false);
   *   · 来源词复用「货号复制」(同一功能语义,不另造新词)。
   */
  function say(message, type) {
    try {
      if (typeof toast === 'function') {
        toast(message, type, { keepHistory: false, source: '货号复制' });
      }
    } catch (e) { /* 消息条不在也不影响复制本身 */ }
  }

  /* ---------- 按钮 ---------- */

  /**
   * 按钮回到「货号」的初始态。
   *
   * 三件事必须一起做，否则会留下「锁住了再也不放」的僵尸按钮：
   *   ① 清掉三种状态类（按下 / 成功 / 失败）；
   *   ② 文案还原；
   *   ③ **解锁**（`__dycFlashing=false`）—— 补涂靠它判断「能不能动这枚按钮」。
   */
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
   * 按下瞬间的**同步**反馈（2026-10-19 二改新增，治「反应迟钝」）。
   *
   * 【为什么要单独一步】
   *   点击 → `readCode()` → `navigator.clipboard.writeText()` 是异步的，
   *   回调可能 100~400ms 后才到；这段时间里按钮要是毫无变化，手感就是「点了没反应」。
   *   `:active` 本来能顶一阵，但 `onTrigger` 里对 `pointerdown` 调了
   *   `preventDefault()`（为了拦掉平台的拖拽选中），部分内核会顺势把 `:active`
   *   一起掐掉 —— 所以必须自己加类，不能只靠伪类。
   *
   * 【顺带把按钮「锁」住】`__dycFlashing = true` 从**按下这一刻**就置位，
   *   而不是等复制回调。旧版只在 `flash()` 里置位，于是「按下 → 回调到达」这
   *   几十~几百毫秒里，补涂完全可以把这枚按钮摘掉重插 —— 回调再写「已复制」
   *   就写在一枚**已经脱离文档**的按钮上，用户什么都看不到。
   *   真机报告里 `按钮被点击（pointerdown）` 之后没有下文，就是这一条。
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
      // 兜底：万一 clipboard 的 Promise 永远不 settle（权限弹窗挂着 / 内核把
      // 回调吞了），2.5 秒后无条件回到初始态 —— 否则按钮会一直锁在深蓝「按下」态。
      btn.__dycSafe = setTimeout(function () { release(btn); }, 2500);
    } catch (e) { /* 忽略 */ }
  }

  /**
   * 按钮上的结果反馈：换文案 + 换填充色，1.5 秒后复原。
   *
   * 【2026-10-19 用户第一次反馈】「点击没有小黄车那种反馈，比如已复制之类的，
   *   而且颜色相比淡很多不够明显」⇒ 成功加 `.is-ok`、失败加 `.is-err`。
   * 【同日第二次反馈】「显示后跟我的按钮初始状态差别很突兀，边框不一样且颜色
   *   深浅也不一样」⇒ 视觉规格在 CSS 注释里重做（只换填充、不加外框、不动几何）。
   *
   * @param {Element} btn 目标按钮
   * @param {string} text 临时文案（「已复制」/「无货号」/「复制失败」）
   * @param {boolean} isErr 是否失败态
   */
  function flash(btn, text, isErr) {
    try {
      if (btn.__dycOrigText == null) btn.__dycOrigText = btn.textContent;
      clearTimeout(btn.__dycSafe);
      btn.classList.remove('is-press');
      btn.textContent = text;
      btn.classList.toggle('is-ok', !isErr);
      btn.classList.toggle('is-err', !!isErr);
      // ⚠️ 保持「正在进行反馈」标记：补涂时若把这枚按钮摘掉重插，用户就看不到
      //   「已复制」了（新按钮又变回「货号」）。injectIntoRow 会读它并跳过。
      btn.__dycFlashing = true;
      clearTimeout(btn.__dycTimer);
      btn.__dycTimer = setTimeout(function () { release(btn); }, 1500);
    } catch (e) { /* 忽略 */ }
  }

  function makeButton(row, nameEl) {
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = BTN_CLASS;
    btn.textContent = '货号';
    // 悬停提示 = 这枚按钮的「说明书」:三态文案在 click 里改写。
    btn.title = '点击复制货号 · 优先用平台货号;平台没展示时,取商品名末尾的款号';
    btn.setAttribute('data-dyc-ct-btn', '1');

    /**
     * 点击入口（2026-10-19「按钮点不了」加固）。
     *
     * 【为什么同时挂 pointerdown 与 click】
     *   平台为了做行选中 / 拖拽，常在**捕获阶段**于 document 或表格容器上
     *   `stopPropagation()`，我们挂在按钮上的 `click` 就永远收不到 ——
     *   表现正是「按钮看得见、按下去毫无反应、日志里一条记录都没有」。
     *   `pointerdown` 是更早的事件，平台很少拦；两条都挂上，谁先到算谁的
     *   （用时间戳去重，避免一次点击复制两遍）。
     */
    var lastTrigger = 0;
    function onTrigger(e, via) {
      var now = Date.now();
      if (now - lastTrigger < 500) return;      // 同一次点击的第二条事件，丢掉
      lastTrigger = now;
      // 只在自己的按钮上停冒泡 —— 别让这次点击冒到行上触发平台跳转
      try { e.preventDefault(); } catch (e0) { /* 忽略 */ }
      try { e.stopPropagation(); } catch (e1) { /* 忽略 */ }
      // ── 先给反馈，再干活（2026-10-19 二改，治「反应迟钝」）──
      //   这一句必须排在 readCode / clipboard 之前：它同时做两件事 ——
      //   ① 立刻变深色（用户按下就有反应，不用等异步复制）；
      //   ② 置 `__dycFlashing` 把这枚按钮**锁住**，补涂不许摘它。
      //   旧版只在复制回调里才置标记，于是「按下 → 回调」这段时间里按钮可能已被
      //   补涂摘掉重插，回调写「已复制」时写在一枚脱离文档的按钮上 ⇒ 用户什么都看不到，
      //   正是反馈里那句「点了之后有时会有显示有时没有显示已复制」。
      press(btn);
      // 2026-10-19：留一条点击日志 —— 用户报「按钮点不了」时，
      // 报告里有没有这一行、以及是哪个事件触发的，能直接区分
      // 「点击没传到按钮」与「传到了但取号失败」。
      dbg('按钮被点击（' + via + '）：名称「' + clip(nameEl.textContent) + '」· ' + buttonBrief(btn));

      // 行被重建过时缓存的 nameEl 可能已脱离文档 ⇒ 点击时按同一判据重算
      var nowName = findNameEl(row) || nameEl;
      var r = readCode(row, nowName);
      if (!r.code) {
        btn.title = '这一行没找到货号 —— 平台没展示货号,商品名末尾也不是款号'
                  + '(本按钮只认名称末尾的款号)';
        flash(btn, '无货号', true);
        say('这一行没找到货号', 'warning');
        dbg('取号结果：无（「' + clip(nowName.textContent) + '」）');
        return;
      }
      btn.title = '货号:' + r.code +
                  (r.from === 'guess' ? '(按商品名末尾推算,不是平台货号)' : '(平台货号)');
      copyText(r.code, function (ok) {
        // 【2026-10-19 二改】回调要写的那一枚按钮，可能已经不是当初按下的那一枚：
        //   平台整块重建商品行时会连我们的按钮一起换掉（旧引用 `isConnected` 变 false）。
        //   此时再把「已复制」写上去，用户看到的就是一枚**从未变过**的新按钮 ——
        //   这正是「点了之后有时会有显示有时没有显示已复制」的另一半成因。
        //   ⇒ 发现旧引用掉了，就按行重找一枚再写反馈（找不到才退回旧引用）。
        var target = btn;
        try {
          if (!btn.isConnected) {
            var fresh = row.querySelector('.' + BTN_CLASS);
            if (fresh && fresh !== btn) target = fresh;
          }
        } catch (e5) { /* 找不到就照旧 */ }
        flash(target, ok ? '已复制' : '复制失败', !ok);
        say(ok ? ('已复制货号 ' + r.code) : '复制失败,请重试', ok ? 'success' : 'warning');
        // 回调落地之后补一条：下次真机再报「没看到已复制」，这两条日志
        // （点击 / 回调）在不在、相隔多久，就能直接分出是「回调没来」
        // 还是「按钮已经被换了」。
        dbg('复制回调：' + (ok ? '成功' : '失败') + ' · 耗时 ' + (Date.now() - now) +
            'ms · 按钮' + (target === btn ? '就是按下那枚' : '**被平台换过，已改写到新按钮**') +
            ' · ' + buttonBrief(target));
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
   * aurora 表格必备的三道排除(用户 2026-10-18 交来的结构报告可证):
   *   ① `tr.aurora-table-measure-row` —— 高度 0 的测量行,tbody 的第一个孩子就是它;
   *   ② 表头行(在 thead 里);
   *   ③ 列数过少的行 / 高度过矮的行(嵌套小表、统计条)。
   * 判据以结构与几何为主,不认平台 class 哈希;只有 measure 是语义名才用。
   * ========================================================== */

  function getRows() {
    var out = [];
    var tables;
    try {
      tables = document.querySelectorAll('table');
    } catch (e) {
      return out;
    }
    for (var i = 0; i < tables.length; i++) {
      var trs = tables[i].querySelectorAll('tbody tr');
      if (!trs.length) trs = tables[i].querySelectorAll('tr');
      for (var j = 0; j < trs.length; j++) {
        var tr = trs[j];
        if (!tr.isConnected) continue;
        // ① 测量行
        if (/measure/i.test(String(tr.className || ''))) continue;
        // ② 表头
        if (tr.parentElement && tr.parentElement.tagName === 'THEAD') continue;
        // ③ 列数:这两页的商品行是 10~12 列;列数少的必是嵌套小表
        var kids = tr.children;
        var tdCount = 0;
        for (var k = 0; k < kids.length; k++) {
          if (kids[k].tagName === 'TD') tdCount++;
        }
        if (tdCount < 4) continue;
        // ④ 几何兜底:测量行/占位行高度恒为 0
        if (tr.clientHeight === 0) continue;
        out.push(tr);
      }
    }
    return out;
  }

  /* ==========================================================
   * 七、注入与补涂
   * ========================================================== */

  /* ==========================================================
   * 平台「复制商品 ID」小图标（落点锚）
   *
   * 【为什么改成找「图标」而不是找「文本为 ID 的按钮」】
   *   2026-10-18 用户截图：我上一版把按钮挂到 `<td>` 末尾，结果**为了这个按钮
   *   多出一整行**（截图里「货号」独占一行，把行高撑高了）。
   *   用户原话：「试一下放置这个复制商品ID的右边，你放错元素框框了，
   *   导致为了这个按钮，新增了一行」。
   *   ⇒ 落点必须回到「跟 ID 那串数字同一行的复制图标右侧」，而且**必须是行内元素**
   *     （`.is-inline`，用 inline-flex），否则又会独占一行。
   *
   * 【怎么在罗盘里认出这个图标】
   *   商品列表 / 商品卡列表的商品信息单元格里，「ID 3847…」后面跟一个复制图标
   *   （截图里那个小方块）。它不一定是 <button>，可能就是个 <span>/<svg>，
   *   文本为空 —— 所以判据要放宽到「**小尺寸 + 有 svg 或有复制语义标签**」。
   *
   * 三级判据（从严到宽，命中即用）：
   *   ① title / aria-label 明确写了「复制」且尺寸像图标；
   *   ② 自身或内部有 <svg>/<use>，且尺寸像图标（≤ 32px）、且在 ID 文本之后；
   *   ③ 退化：文本恰为「ID」的小按钮（老口径，直播明细页那种）。
   *
   * ⚠️ 只在「名称所在的商品信息单元格」范围内找 —— 整行找会命中右侧「操作」列
   *    的复制类按钮，把按钮插到别的列去。
   * ========================================================== */

  /** 尺寸像小图标吗（宽高都在 8~32 之间） */
  function looksLikeIcon(el) {
    try {
      var w = el.clientWidth;
      var h = el.clientHeight;
      if (w < 8 || h < 8) return false;
      if (w > 32 || h > 32) return false;
      return true;
    } catch (e) {
      return false;
    }
  }

  /**
   * 把「图标本体」提到它的**可点外层**。
   *
   * 图标常常长成 `<span class="xxx"><svg><use/></svg></span>` —— 直接命中
   * `<svg>` / `<use>` 时若把按钮插在它后面，按钮会跑进 `<svg>` 内部（渲染不出来）。
   * 这里沿父链往上走，只要父节点仍然是「小尺寸且不是单元格/名称容器」，就往上提一层。
   *
   * @param {Element} el 命中的图标节点
   * @param {Element} cell 商品信息单元格（不许提到它或更上层）
   * @return {Element} 可点的图标外层
   */
  function iconWrapperOf(el, cell) {
    var cur = el;
    var guard = 0;
    while (cur && cur.parentElement && guard++ < 4) {
      var p = cur.parentElement;
      if (p === cell || p.tagName === 'TD' || p.tagName === 'TR') break;
      if (!looksLikeIcon(p)) break;
      cur = p;
    }
    return cur;
  }

  /**
   * 这个元素**自己带可见文字**吗（带 ⇒ 是文字标签，不能当图标锚点）。
   *
   * ⚠️ 2026-10-18 第七轮修正 —— 旧实现是「没有元素子节点就算文字标签」，
   *   那会把**空元素**也判成文字标签：`<i class="iconfont icon-copy"></i>`
   *   这类**图标字体**元素内部什么都没有（图标由 `::before` 伪元素画出来），
   *   旧判据把它当成「文字标签」直接跳过 ⇒ **复制图标永远找不到**
   *   ⇒ 按钮掉到「名称右侧」那一行去（用户 2026-10-19 截图正是这个现象）。
   *   正确判据是「**自己有没有直接文本节点**」：空元素不是文字标签。
   */
  function isTextLabel(el) {
    var kids = el.childNodes || [];
    for (var i = 0; i < kids.length; i++) {
      if (kids[i].nodeType === 3 && String(kids[i].nodeValue || '').trim()) return true;
    }
    return false;
  }

  /** 自身或内部有 svg / use / img（图标的基本特征） */
  function hasIconChild(el) {
    try {
      if (el.tagName === 'SVG' || el.tagName === 'USE' || el.tagName === 'IMG') return true;
      return !!el.querySelector('svg, use, img');
    } catch (e) {
      return false;
    }
  }

  /** 这段文本像「ID + 数字」吗（罗盘的 ID 行就是它） */
  function looksLikeIdText(t) {
    if (!t) return false;
    return /\bID\s*[:：]?\s*\d{6,}/i.test(t) || /^\d{12,}$/.test(String(t).trim());
  }

  /**
   * 找「ID + 数字」那段文本所在的元素（图标的定位基准）。
   *
   * 【为什么必须拿它当基准 —— 2026-10-18 真机第六轮】
   *   用户截图：按钮插到了「ID」和数字**中间**（`ID [货号] 3847…`）。
   *   原因是我上一版的判据③「文本恰为 ID 的小元素」在罗盘这页命中了
   *   **「ID」这个文字标签本身** —— 它不是按钮，只是标签。
   *   ⇒ ① 删掉这条判据；② 改以「ID 数字文本」为基准，
   *      复制图标一定在**数字之后**，不可能是标签本身。
   */
  function findIdTextHost(scope) {
    if (!scope) return null;
    var cands;
    try {
      cands = scope.querySelectorAll('span, div, p, em, b, i, label, td');
    } catch (e) {
      return null;
    }
    var limit = Math.min(cands.length, 160);
    var best = null;
    for (var i = 0; i < limit; i++) {
      var el = cands[i];
      if (isExtNode(el)) continue;
      if (!isTextLabel(el)) continue;            // 只认纯文字节点
      var t = String(el.textContent || '').trim();
      if (!looksLikeIdText(t)) continue;
      // 取**最内层**的那个（越内层越贴数字）
      best = el;
    }
    return best;
  }

  /**
   * 在 scope 内找平台的「复制商品 ID」图标。
   *
   * 【2026-10-18 第六轮返工后的判据（比上一版严得多）】
   *   只认两种，且都必须**不是纯文字标签**：
   *     ① title / aria-label / data-tip 写了「复制」；
   *     ② 自身或内部有 svg / use / img（图标的基本特征）。
   *   ~~③ 文本恰为「ID」的小元素~~ —— **已删除**：在罗盘这页那是文字标签，
   *      不是按钮，正是它导致按钮插到「ID」和数字中间。
   *   位置：优先取「ID 数字文本之后」的第一个（用 compareDocumentPosition 判）；
   *         没有 ID 文本时退到「名称之后」。
   *
   * @param {Element|null} scope 商品信息单元格
   * @param {Element|null} nameEl 名称元素
   * @return {Element|null}
   */
  function findCopyIdIcon(scope, nameEl) {
    if (!scope) return null;
    var cands;
    try {
      cands = scope.querySelectorAll('button, a, span, i, b, em, div, svg, img');
    } catch (e) {
      return null;
    }

    var idHost = findIdTextHost(scope);
    var limit = Math.min(cands.length, 160);
    var afterNameFallback = null;

    for (var i = 0; i < limit; i++) {
      var el = cands[i];
      if (isExtNode(el)) continue;
      if (!looksLikeIcon(el)) continue;
      if (isTextLabel(el)) continue;              // ⚠️ 纯文字标签一律不当锚点

      var label = (el.getAttribute('title') || '') + ' ' +
                  (el.getAttribute('aria-label') || '') + ' ' +
                  (el.getAttribute('data-tip') || '');
      var byLabel = /复制/.test(label);
      var byIcon = hasIconChild(el);
      // ③ 图标字体（`<i class="iconfont icon-copy">`，内部为空、图标由 ::before 画）
      //    —— 2026-10-18 第七轮补：这一类前面两条都沾不上，但确实是复制图标。
      var byFontIcon = /icon|copy|svg/i.test(String(el.className || '')) && !isTextLabel(el);
      if (!byLabel && !byIcon && !byFontIcon) continue;   // 三条都不沾 ⇒ 不是图标

      var afterId = false;
      try {
        if (idHost && idHost.compareDocumentPosition) {
          afterId = !!(idHost.compareDocumentPosition(el) & 4);   // 4 = FOLLOWING
        }
      } catch (e2) { afterId = false; }
      if (afterId) return iconWrapperOf(el, scope);   // 首选：紧跟在 ID 数字之后

      var afterName = false;
      try {
        if (nameEl && nameEl.compareDocumentPosition) {
          afterName = !!(nameEl.compareDocumentPosition(el) & 4);
        }
      } catch (e3) { afterName = false; }
      if (afterName && !afterNameFallback) afterNameFallback = el;
    }

    // ── 末招：整格里找「排在 ID 文本之后、小尺寸、自己不写字」的第一个元素 ──
    //   图标可能是背景图 / 图标字体 / canvas，上面三条判据一条都沾不上；
    //   而「ID 后面第一个小空元素」实际只可能是那个复制图标（见 smallAfterId 注释）。
    var sibling = smallAfterId(scope, idHost);
    if (sibling) return iconWrapperOf(sibling, scope);

    return afterNameFallback ? iconWrapperOf(afterNameFallback, scope) : null;
  }

  /**
   * 末招兜底：在单元格里找**排在 ID 文本之后**的第一个「小尺寸 + 自己不写字」的元素。
   *
   * 【为什么不能只看「同层兄弟」】ID 那两个片段（`ID` 与那串数字）在平台上
   *   可能被拆成两个元素（`<span>ID</span><span>3847…</span>`），此时
   *   `findIdTextHost` 命中的是它们的**共同父层**，同层兄弟已经跑到 ID 行外面去了。
   *   所以这里按**文档顺序**在整格内扫，只取「在 ID 文本之后」的那些。
   *
   * 这是兜底招：图标若是背景图 / 图标字体 / canvas，前面三条判据一条都沾不上，
   * 但「ID 后面第一个小空元素」实际只可能是那个复制图标。判据保守（小尺寸 + 无文字），
   * 且**优先**返回带图标特征（svg / img / 图标类名）的那个。
   *
   * @param {Element|null} scope 商品信息单元格
   * @param {Element|null} idHost 「ID + 数字」文本所在元素
   * @return {Element|null}
   */
  function smallAfterId(scope, idHost) {
    if (!scope || !idHost) return null;
    var cands;
    try {
      cands = scope.querySelectorAll('span, i, b, em, div, img, svg, use');
    } catch (e) {
      return null;
    }
    var limit = Math.min(cands.length, 160);
    var loose = null;
    for (var i = 0; i < limit; i++) {
      var el = cands[i];
      if (isExtNode(el)) continue;
      if (el === idHost) continue;
      if (!looksLikeIcon(el)) continue;          // 尺寸像图标
      if (isTextLabel(el)) continue;             // 自己不写字
      var after = false;
      try { after = !!(idHost.compareDocumentPosition(el) & 4); } catch (e2) { after = false; }
      if (!after) continue;                      // 只要排在 ID 文本之后的
      if (hasIconChild(el)) return el;           // 有图标特征 ⇒ 最可信，直接给
      if (/icon|copy|svg/i.test(String(el.className || ''))) return el;   // 图标字体类名
      if (!loose) loose = el;                    // 纯空小元素 ⇒ 先记着
    }
    return loose;
  }

  /**
   * 没找到图标时的**诊断串**（只用于日志）。
   *
   * 2026-10-19 真机：按钮掉到了「名称右侧」而不是 ID 行，但日志只写了
   * 「无 ID 图标」四个字 —— 完全看不出是「ID 文本没认出来」还是
   * 「图标候选被哪一条判据挡掉了」。下次再出这种事，报告里就能直接看出断在哪。
   */
  function idDiag(scope) {
    try {
      var idHost = findIdTextHost(scope);
      if (!idHost) return '（诊断：ID 数字文本都没找到）';
      var p = idHost.parentElement;
      var n = p ? (p.children || []).length : 0;
      var sib = smallAfterId(scope, idHost);
      return '（诊断：ID 文本在 ' + idHost.tagName + '，同层元素 ' + n +
             '，ID 后的小元素 ' + (sib ? sib.tagName + '.' + String(sib.className || '').slice(0, 24) : '无') + '）';
    } catch (e) {
      return '（诊断：读取失败）';
    }
  }

  /**
   * 这个元素是不是**我们自己注入的控件**（消息盒子 / 状态条 / 调试面板 / 按钮…）。
   *
   * 只用于「被谁盖住」的判定：我们自己的浮层本来就会盖住表格，不该因此判按钮不可用。
   */
  function isOurNode(el) {
    try {
      var cur = el;
      var guard = 0;
      while (cur && guard++ < 6) {
        var id = String(cur.id || '');
        var cls = String(cur.className || '');
        if (id.indexOf('dyb-') === 0 || id.indexOf('dyc-') === 0) return true;
        if (cls.indexOf('dyb-') === 0 || cls.indexOf('dyc-') === 0) return true;
        if (cur.getAttribute && (cur.getAttribute('data-dyc-ct-btn') !== null ||
            cur.getAttribute('data-dyc-idbtn') !== null)) return true;
        cur = cur.parentElement;
      }
      return false;
    } catch (e) {
      return false;
    }
  }

  /**
   * 这个位置**能不能真的点到** —— 2026-10-19 真机「按钮点不了」的修法。
   *
   * 【真机证据】商品列表页日志：`按钮 56×20 @1887,418 · 被祖先裁掉(裁切层=DIV 右侧)`，
   *   而视口只有 1707 宽 —— **按钮整个落在视口右边界之外**，用户根本点不到。
   *   原因：那一页的 ID 行把复制图标推到了单元格最右，我们的按钮跟在图标后面
   *   就被挤出可视区（同时被滚动容器裁掉）。
   *
   * ⇒ 插入前先问三句，任一条不过就换下一个落点：
   *   ① 元素在不在**视口横向范围内**（纵向不管 —— 行本来可能在折叠区外）；
   *   ② 有没有被**祖先横向裁掉**（只看 overflow 不是 visible 的层）；
   *   ③ 中心点有没有被**别的元素盖住**（我们自己的浮层不算）。
   *
   * @return {string} '' = 可以用；否则返回不能用的原因（写进日志）
   */
  function spotUsable(el, opts) {
    var skipCover = !!(opts && opts.skipCover);
    try {
      if (!el || !el.getBoundingClientRect) return '';
      var r = el.getBoundingClientRect();
      // 还没排版（尺寸 0）⇒ 不下结论，照常放（否则首屏会全部误判）
      if (r.width <= 0 || r.height <= 0) return '';

      var vw = (typeof window !== 'undefined' && window.innerWidth) || 0;
      if (vw && (r.left < -1 || r.right > vw + 1)) {
        return '横向在视口外(@' + Math.round(r.left) + '~' + Math.round(r.right) +
               ' 视口宽 ' + vw + ')';
      }

      // 被祖先横向裁掉（纵向不判：滚动容器下方的内容本来就在外面）
      var clipR = Infinity, clipBy = '';
      var up = el.parentElement, guard = 0;
      while (up && guard++ < 10) {
        var cs = getComputedStyle(up);
        if (cs.overflow !== 'visible' || cs.overflowY !== 'visible') {
          var cr = up.getBoundingClientRect();
          if (cr.right < clipR) { clipR = cr.right; clipBy = up.tagName; }
        }
        up = up.parentElement;
      }
      if (clipR !== Infinity && r.right > clipR + 1) {
        return '被' + (clipBy || '祖先') + '裁掉(右)';
      }

      // 中心点是否被别的元素盖住（我们自己的浮层不算）
      //   ⚠️ 这一条只在**首次试放**时查：浮层是临时的，若每轮补涂都按它重排，
      //      会出现「按钮位置来回跳」的抖动。横向越界 / 横向裁切是稳定的布局问题，
      //      所以那两条永远查。
      if (skipCover) return '';
      var cx = r.left + r.width / 2;
      var cy = r.top + r.height / 2;
      var vh = (typeof window !== 'undefined' && window.innerHeight) || 0;
      if (typeof document.elementFromPoint === 'function' &&
          cx >= 0 && (!vw || cx <= vw) && cy >= 0 && (!vh || cy <= vh)) {
        // 【2026-10-19 二改：单个中心点 → 五点采样】
        //   真机报告里出现过「四个落点全被判『被 DIV 盖住』」⇒ 一路退化到
        //   「名称后·末选兜底」。单点判定太脆：按钮只有 24px 高，中心点压在
        //   平台的 1px 分隔线 / 行 hover 蒙层边缘上，就会整枚判成不可用。
        //   ⇒ 采 5 个点（中心 + 左右 + 上下，都内缩在按钮内部），
        //     **多数被盖**才认定为真遮挡；边缘擦到一两个点直接放行。
        //   真被蒙层整块盖住时 5 个点会全中，照样拦得住。
        var hw = Math.max(1, Math.min(6, r.width / 2 - 2));
        var hh = Math.max(1, Math.min(4, r.height / 2 - 2));
        var pts = [[cx, cy], [cx - hw, cy], [cx + hw, cy], [cx, cy - hh], [cx, cy + hh]];
        var miss = 0, coverName = '';
        for (var pi = 0; pi < pts.length; pi++) {
          var px = pts[pi][0], py = pts[pi][1];
          if (px < 0 || py < 0 || (vw && px > vw) || (vh && py > vh)) continue;
          var hit = document.elementFromPoint(px, py);
          // `hit.contains(el)` 也要放行：命中**祖先**不是遮挡（祖先把按钮包在里面，
          // 不可能同时压在按钮上面），老内核在某些层叠场景下会返回祖先。
          if (hit && hit !== el && !el.contains(hit) && !(hit.contains && hit.contains(el)) &&
              !isOurNode(hit)) {
            miss++;
            if (!coverName) coverName = hit.tagName;
          }
        }
        if (miss >= 3) return '被' + coverName + '盖住(' + miss + '/5)';
      }
      return '';
    } catch (e) {
      return '';
    }
  }

  /**
   * 按钮是不是**紧跟在图标之后**（最便宜的一条判据）。
   *
   * 正确落点长这样：`… [复制图标] [货号]`。
   * 只要前一个兄弟是「图标本体 / 包着图标的可点外层 / 标了复制的元素」，就算对。
   */
  function btnFollowsIcon(btn) {
    try {
      // ① 插在图标**右侧**（首选落点）
      var prev = btn.previousElementSibling;
      if (prev && !isExtNode(prev)) {
        if (hasIconChild(prev)) return true;
        var label = (prev.getAttribute('title') || '') + ' ' +
                    (prev.getAttribute('aria-label') || '');
        if (/复制/.test(label)) return true;
      }
      // ② 插在图标**左侧**（2026-10-19 新增的落点：右侧放不下时用）
      var next = btn.nextElementSibling;
      if (next && !isExtNode(next)) {
        if (hasIconChild(next)) return true;
        var label2 = (next.getAttribute('title') || '') + ' ' +
                     (next.getAttribute('aria-label') || '');
        if (/复制/.test(label2)) return true;
      }
      return false;
    } catch (e) {
      return false;
    }
  }

  /**
   * 在按钮上记下「按哪一版逻辑、放在了哪种落点」。
   *
   * 见 `ATTR_AT` 的注释：补涂每 300ms 一轮，**必须有办法判断「这枚按钮还是我上一轮
   * 放好的那一枚吗」**。只看「按钮在不在」会漏掉「落点被改过」；只看「落点对不对」
   * 又会因为「这一行本来就没有图标可用」而每轮都判错、每轮都摘掉重插。
   * 记一个版本号 + 类型，两句都能答：版本对得上、位置没跑 ⇒ 别动。
   */
  function markAt(btn, kind) {
    try { btn.setAttribute(ATTR_AT, PLACE_VER + ':' + kind); } catch (e) { /* 记不住不影响主流程 */ }
  }

  /** 读按钮上记的落点类型；没有（旧版留下的按钮）返回 '' */
  function atKind(btn) {
    try {
      var v = String(btn.getAttribute(ATTR_AT) || '');
      return v.indexOf(PLACE_VER + ':') === 0 ? v.slice(PLACE_VER.length + 1) : '';
    } catch (e) { return ''; }
  }

  /**
   * 这枚按钮**是不是还在我们放它的那个位置、而且还能点到**。
   *
   * 三种情况一律判「不在原位」，交给调用方摘掉重放：
   *   ① 已被平台摘出文档；
   *   ② 没有落点标记（上一版逻辑留下的按钮 —— 用户不刷新也要能看到修复）；
   *   ③ 落点标记写着「ID 图标旁」，但它已经不在图标旁边了（平台重渲染挪过）。
   *
   * ⚠️ 这里只用 `spotUsable(..., {skipCover:true})`：瞬时遮挡（悬浮层、行 hover 蒙层）
   *    不该让一枚位置正确的按钮每分钟被摘掉重插四次 —— 真机抖动就是这么来的。
   *    横向越界 / 被祖先裁切这两条是**布局性**问题，稳定，照查不误。
   */
  function btnStillHome(btn, kind, nameEl) {
    try {
      if (!btn || !btn.isConnected || !kind) return false;
      if (kind === 'icon-r' || kind === 'icon-l') {
        return btnFollowsIcon(btn) && !spotUsable(btn, { skipCover: true });
      }
      if (kind === 'name-r') {
        var prev = btn.previousElementSibling;
        // 名称被 <a> 包着时，按钮的前兄弟是那个 <a>，不是名称本身
        var okPrev = !!prev && (prev === nameEl || (prev.contains && prev.contains(nameEl)));
        return okPrev && !spotUsable(btn, { skipCover: true });
      }
      if (kind === 'badge') {
        // 徽标：只要还挂在容器里、没被挤出视口/裁掉，就算在原位。
        // 坐标本身由 placeBadge() 每轮校准 —— **不把「坐标变了」当失效**，
        // 否则名字一折行就会被判成「不在原位」而摘掉重插，又回到抖动。
        return !!btn.parentElement && !spotUsable(btn, { skipCover: true });
      }
      if (kind === 'cell-before') {
        var next = btn.nextElementSibling;
        var okNext = !!next && (next === nameEl || (next.contains && next.contains(nameEl)));
        return okNext && !spotUsable(btn, { skipCover: true });
      }
      // cell-end / name-after：只要有爹、没被挤出视口就算在原位
      return !!btn.parentElement && !spotUsable(btn, { skipCover: true });
    } catch (e) {
      return false;
    }
  }


  /* ==========================================================
   * 唯一落点：名称块右下角的浮层徽标（2026-10-19 三改）
   *
   * 【为什么要换掉整条落点链】
   *   前三版都是把按钮**插进平台的 DOM 流**里，靠「插在哪个兄弟节点前后」决定位置。
   *   于是位置由平台的 flex / 表格布局说了算：
   *     · ID 那串数字变长 ⇒ 图标右移 ⇒ 按钮跟着右移，最后被挤出视口；
   *     · 单元格变窄 / 视口变小 ⇒ 同一行里塞不下 ⇒ 降级到别的档；
   *     · 图标被平台蒙层盖住 ⇒ 「可点性复核」把最佳档否掉 ⇒ 又降一档。
   *   为了保证「总能插进去」，还写了五级降级（ID图标右 / 图标左 / 名称右 /
   *   单元格前 / 单元格尾）。**每行落到不同档，整页看下来就是东一个西一个。**
   *   用户 2026-10-19 贴的截图正是最坏那一档：按钮掉在「全店TOP3」蓝色标签
   *   下面、左对齐，离开商品名十万八千里。
   *
   *   ⇒ 现在只剩**一个**落点：按钮 `position:absolute` 脱离文档流，
   *     坐标只由「商品名块的右下角」算出来。
   *     · 不进 flex ⇒ 不会被挤扁、不会被挤出视口；
   *     · 不占行高 ⇒ 不会「为了这个按钮新增一行」；
   *     · 不认图标位置 ⇒ ID 数字怎么变都跟它无关；
   *     · 所有行、所有页面同一套规则 ⇒ 视觉上整齐，不再走位。
   * ========================================================== */

  /** 读一条 inline 数值（读不到返回 NaN） */
  function inlineNum(el, prop) {
    var v = parseFloat(el.style.getPropertyValue(prop));
    return isNaN(v) ? NaN : v;
  }

  /**
   * 写一条 inline px —— 与现值差在容差内就**不写**。
   *
   * 补涂每 300ms 一轮，若每轮都重写 left/top，平台的 ResizeObserver 会被反复
   * 触发（真机报过 `ResizeObserver loop completed with undelivered notifications`）。
   * 容差 1.5px：亚像素抖动忽略，真实位移照样跟着走。
   *
   * @return {boolean} 是否真的改了
   */
  function setPxStable(el, prop, v) {
    var cur = inlineNum(el, prop);
    if (!isNaN(cur) && Math.abs(cur - v) <= BADGE_TOL) return false;
    el.style.setProperty(prop, Math.round(v * 100) / 100 + 'px');
    return true;
  }

  /**
   * 名字**最后一行**的矩形（视口坐标）。只服务**纵向**锚点（文字底边）。
   *
   * 【为什么要量这个】
   *   按钮要落在名字正下方的空白行，锚点必须是「文字真正写到哪儿」，
   *   而不是名字块的盒子底边 —— 盒子底边包含了我们补进去的 28px padding，
   *   拿它当锚点等于每补一次就离文字更远一次。
   *   Range 逐段量每行矩形，取 top 最大的那个就是视觉上最下面一行，
   *   它的 `bottom` 是文字的底边。
   *
   * ⚠️ 不能取「数组最后一个」：名字里若夹着 `<span>`（款号、活动标），
   *   Range 会把一行拆成多个矩形，数组末尾那个不一定是视觉上最下面一行。
   *   （同一行的多段矩形 bottom 相同，纵向取哪段都一样。）
   *
   * ⚠️ `Range.getClientRects()` 在 Chromium 1+ 就有，360 极速 / 夸克都支持；
   *    拿不到就返回 null，调用方按「量不到 ⇒ 用盒子高度兜底」处理。
   */
  function lastLineRect(el) {
    try {
      if (typeof document.createRange !== 'function') return null;
      var rg = document.createRange();
      rg.selectNodeContents(el);
      var rects = rg.getClientRects ? rg.getClientRects() : null;
      if (!rects || !rects.length) return null;
      var best = null;
      for (var i = 0; i < rects.length; i++) {
        var r = rects[i];
        if (!r || r.width <= 1) continue;          // 换行处会产生宽 0 的空矩形
        if (!best || r.top > best.top) best = r;
      }
      return best;
    } catch (e) {
      return null;
    }
  }

  /**
   * 徽标的定位容器：商品信息单元格 `<td>`（非表格结构时退回名称的父元素）。
   *
   * 【为什么用 `<td>` 而不是名称元素自己】
   *   · `<td>` 的几何由表格布局决定，最稳定，不随内容伸缩；
   *   · 名称元素内部可能还有平台插的角标（「新品」「预售」），把 `relative`
   *     加在名称上会改变那些角标的定位基准；加在 `<td>` 上影响面最小；
   *   · 原本已经是 relative/absolute 的容器**不动它**，只给 static 的补一个。
   */
  function badgeHostOf(nameEl) {
    if (!nameEl || !nameEl.parentElement) return null;
    var host = infoCellOf(nameEl) || nameEl.parentElement;
    if (!host || host.nodeType !== 1) return null;
    try {
      var pos = getComputedStyle(host).position;
      if (!pos || pos === 'static') {
        backupProps(host, MARK_HOST_ORIG, [['position']]);
        setImp(host, 'position', 'relative');
        host.setAttribute(MARK_HOST, '1');
      }
    } catch (e) { /* 拿不到计算值就照用 —— 大不了坐标差一点，不影响存在 */ }
    return host;
  }

  /**
   * 给名称块底部补出一行落位空白，让按钮能落在文字**正下方**。
   *
   * 【为什么整段重写（2026-10-19 第五轮）】
   *   老版本是「只在最后一行会撞按钮时才给右侧 `padding-right` 预留」——
   *   这个思路本身是零和的：商品名占满整格宽度，预留多少就从文字里扣多少。
   *   先后试过预留 50 / 70px、空缝 10 / 30px，用户四次反馈压字 ⇒ 横向根本没有解。
   *   现在改成纵向：一律补 `padding-bottom`，按钮落到文字下方，与文字不同排。
   *
   * 【为什么不再需要「先量后决定」】
   *   横向方案要判「会不会撞」才决定动不动名字；纵向方案里按钮**总要有个位置**，
   *   这段空白是必需品而不是补丁 ⇒ 无条件补。副作用是代码不再因为折行变化
   *   每小时算出不同答案（老版本 `MARK_NAME_WH` 那套缓存整个可以退休了）。
   *
   * 【为什么是 padding 而不是 margin】margin 在块级父容器里可能塌陷：
   *   塌陷后父容器不增高、下面的 ID 行也不会被推开，按钮就白留了空白。
   *
   * @return {boolean} 本次是否真的写了样式（幂等，重复调用返回 false）
   */
  function ensureBadgeRoom(nameEl) {
    try {
      if (nameEl.getAttribute(MARK_PAD_ED) === PAD_VER) return false;   // 已经是新版
      // 旧版（v4 的 padding-right 预留）遗留：先把右侧预留还回去，再按新版处理。
      //   否则名字会「右边窄一截 + 底部又多了空白」，是最难看的中间态。
      var oldMark = nameEl.getAttribute(MARK_PAD_ED);
      if (oldMark !== null && oldMark !== PAD_VER) {
        restoreProps(nameEl, MARK_PAD, [['padding-right'], ['padding-bottom'], ['box-sizing']]);
        nameEl.removeAttribute(MARK_PAD);
        nameEl.removeAttribute(MARK_NAME_WH);
      }
      var nr = nameEl.getBoundingClientRect();
      if (!nr || nr.width <= 0) return false;        // 还没排版 / 行被折叠
      backupProps(nameEl, MARK_PAD, [['padding-right'], ['padding-bottom'], ['box-sizing']]);
      setImp(nameEl, 'box-sizing', 'border-box');    // content-box 下加 padding 会把盒子撑宽
      setImp(nameEl, 'padding-bottom', BADGE_PAD_BOTTOM + 'px');
      nameEl.setAttribute(MARK_PAD_ED, PAD_VER);
      return true;
    } catch (e) {
      return false;
    }
  }

  /**
   * 把按钮摆到「商品名右下方的空白行」。
   *
   * 坐标换算：绝对定位的原点是 host 的 **padding box**，而 getBoundingClientRect
   * 给的是 **border box** ⇒ 用 `clientLeft / clientTop` 修正边框宽度。
   *
   * 位置公式（唯一一套，没有降级）：
   *   left = 名字块右边界（= 格子右边界，整页同一条纵轴）− 按钮宽 − 内缩
   *   top  = 文字真实底边 + 空档
   * 再夹紧在容器内（滚动 / 缩放 / 行被折叠时也不能跑出去）。
   *
   * @return {boolean} 坐标是否真的变了
   */
  function placeBadge(nameEl, btn, host) {
    try {
      var hr = host.getBoundingClientRect();
      var nr = nameEl.getBoundingClientRect();
      if (!hr || !nr) return false;
      if (hr.width <= 0 || hr.height <= 0) return false;   // 行被折叠 / 还没排版

      // 按钮尺寸固定（CSS 里写死 px），第一次读到就缓存 —— 补涂每 300ms 一轮，
      // 每轮都读 offsetWidth 会强制同步排版，10 行 × 4 次/秒 并不划算。
      var ow = btn.offsetWidth, oh = btn.offsetHeight;
      var bw = btn.__dycBW || ow || BADGE_FALLBACK_W;
      var bh = btn.__dycBH || oh || BADGE_FALLBACK_H;
      if (ow) { btn.__dycBW = bw; btn.__dycBH = bh; }

      var baseL = hr.left + (host.clientLeft || 0);
      var baseT = hr.top + (host.clientTop || 0);

      // 纵向锚「文字底边」的偏移缓存（key = 名字块 宽×高，折行 / 列宽变化必改
      // 其一）。缓存的是相对名字块的偏移 —— Range 给的是视口坐标，滚动后绝对值
      // 全变，缓存绝对值会让按钮在滚动后跳到完全错误的位置。
      // ⚠️ key 里带 PLACE_VER：落点规则换版时旧缓存自动作废（v6 踩过：旧缓存
      //    缺新偏移，宽高恰好没变时永远进不了重算分支，按钮一直走旧兜底）。
      var whKey = PLACE_VER + ':' + Math.round(nr.width) + 'x' + Math.round(nr.height);
      if (nameEl.__dycTBKey !== whKey) {
        var last = lastLineRect(nameEl);
        if (last) nameEl.__dycTBOff = last.bottom - nr.top;   // 文字底边（相对块顶）
        nameEl.__dycTBKey = whKey;
      }

      // 横向：按钮右边界贴**名字块右边界**（= 格子右边界）、内缩 BADGE_INSET。
      //   【为什么绕了一圈又回到块右边界（v5 → v6 → v7 → v8）】
      //     · 块是 block、占满整格 ⇒ 块右边界 = 格子右边界，**整页恒定**；
      //     · v6 锚「最后一行右端」、v7 锚「内容右边界」，都跟着名字长短走：
      //       收尾行 / 短名字一变，按钮 x 就变 —— v7 真机截图「全部都歪了」、
      //       v8 用户拍板「尽量同一条纵轴」⇒ 横向锚点必须选整页恒定的几何量，
      //       格子右边界是唯一候选（长名字行的文字本来就顶到这里，两种锚点
      //       在绝大多数行完全重合；短的行按钮悬在名字右边的空白处）。
      //     · 「掉到图片下方」的旧观感出自横向方案时代（按钮与文字抢同一排）；
      //       现在纵向已错开（按钮在名字下方空白行），贴格子右边界不会再被
      //       看成「图片的按钮」。
      var left = nr.right - baseL - bw - BADGE_INSET;

      // 纵向：落在**文字真实底边**下方 BADGE_DROP 处。
      //   ⚠️ 不能拿 `nr.bottom` 当锚点：加了 padding-bottom 之后 nr.bottom 已经
      //      包含了那 BADGE_PAD_BOTTOM(28px) 空白，用它算等于把按钮又往下推 28px，
      //      看起来就不像「名字的按钮」了。
      var off = nameEl.__dycTBOff;
      // 量不到（Range 不可用 / 元素里没有文本节点）⇒ 退回「盒子高 − 补进去的空白」。
      if (typeof off !== 'number' || !(off > 0)) off = nr.height - BADGE_PAD_BOTTOM;
      if (!(off > 0)) off = nr.height;
      var top = nr.top + off - baseT + BADGE_DROP;

      var maxL = (host.clientWidth || 0) - bw - BADGE_INSET;
      if (maxL < BADGE_INSET) maxL = BADGE_INSET;
      if (left < BADGE_INSET) left = BADGE_INSET;
      if (left > maxL) left = maxL;
      // ⚠️ 纵向**不做「夹到容器高度」**（2026-10-19 真机）。
      //   老版本有 `if (top > maxT) top = maxT`，而 maxT = 容器高度 − 按钮高。
      //   真机那个页面 nameEl 的父容器高度只够一行（21px），于是 maxT≈0，
      //   top 被硬拽到 0 ⇒ 按钮跑到**第一行顶部**，横跨第一行与第二行 ——
      //   用户截图里「货号」压住「外套」的上半截，正是这一条造成的。
      //   纵向以「文字底边」为锚，天然落在容器内；只需保证不出现负值。
      if (top < 0) top = 0;

      var c1 = setPxStable(btn, 'left', left);
      var c2 = setPxStable(btn, 'top', top);
      return c1 || c2;
    } catch (e) {
      return false;
    }
  }

  /**
   * 把按钮插到某个锚点元素的**右侧、同一行**（inline-flex）。
   *
   * ⚠️ 锚点若被 `<a>` 包着，必须把按钮插到**`<a>` 之后**（插在 `<a>` 内部
   *    会让点击顺带触发链接跳转；而拿内部节点的 nextSibling 去父级 insertBefore
   *    又会因为参照节点不在该父级下抛 NotFoundError —— 两种都要避开）。
   *
   * @return {boolean} 是否插入成功
   */
  function insertAfterInline(anchorEl, btn) {
    if (!anchorEl || !anchorEl.parentElement) return false;
    var parent = anchorEl.parentElement;
    var ref = anchorEl.nextSibling;
    if (parent.tagName === 'A' && parent.parentElement) {
      ref = parent.nextSibling;
      parent = parent.parentElement;
    }
    btn.classList.add('is-inline');
    try {
      parent.insertBefore(btn, ref);
      return true;
    } catch (e) {
      btn.classList.remove('is-inline');
      return false;
    }
  }

  /**
   * 把按钮插到锚点元素的**左侧、同一行**（inline-flex）。
   *
   * 用途：锚点右侧已经没有空间时（真机商品列表页 —— 复制图标贴着单元格最右，
   * 按钮跟在它后面直接掉出视口），插到**它左边**仍是最贴近用户要求的位置
   * （同一行、紧邻复制图标），比掉到名称那一行好得多。
   */
  function insertBeforeInline(anchorEl, btn) {
    if (!anchorEl || !anchorEl.parentElement) return false;
    var parent = anchorEl.parentElement;
    var anchorForInsert = anchorEl;
    // 锚点被 <a> 包着 ⇒ 插到 <a> 之前（别插进链接里）
    if (parent.tagName === 'A' && parent.parentElement) {
      anchorForInsert = parent;
      parent = parent.parentElement;
    }
    btn.classList.add('is-inline');
    btn.classList.add('is-before');
    try {
      parent.insertBefore(btn, anchorForInsert);
      return true;
    } catch (e) {
      btn.classList.remove('is-inline');
      btn.classList.remove('is-before');
      return false;
    }
  }

  /**
   * 「插到锚点左侧 → 复核可点性 → 不行就撤回」。
   *
   * @param {string} kind 落点类型（'icon-l' 等），成功时记到按钮上，供下一轮补涂判「还在原位吗」
   * @return {string} '' = 成功；否则返回原因
   */
  function tryPlaceBeforeInline(anchorEl, btn, row, where, nameEl, kind) {
    if (!insertBeforeInline(anchorEl, btn)) return '插不进去';
    var why = spotUsable(btn);
    if (!why) {
      markAt(btn, kind || 'icon-l');
      logInjectOnce(row, where, nameEl, btn);
      return '';
    }
    try { btn.remove(); } catch (e) { /* 忽略 */ }
    return why;
  }

  /**
   * 「插进去 → 复核能不能点到 → 点不到就撤回」。
   *
   * 【为什么必须撤回】真机 2026-10-19：商品列表页的 ID 行把复制图标推到单元格最右，
   *   按钮跟在图标后面直接被挤出视口（日志 `@1887` 而视口宽 1707），用户点不到。
   *   只在「插完立刻量一次」才能发现；发现了就摘掉，交给下一个落点。
   *
   * @param {string} kind 落点类型（'icon-r' / 'name-r'），成功时记到按钮上
   * @return {string} '' = 成功且可点；否则返回失败原因（会写进日志）
   */
  function tryPlaceInline(anchorEl, btn, row, where, nameEl, kind) {
    if (!insertAfterInline(anchorEl, btn)) return '插不进去';
    var why = spotUsable(btn);
    if (!why) {
      markAt(btn, kind || 'icon-r');
      logInjectOnce(row, where, nameEl, btn);
      return '';
    }
    // 撤回：摘掉这枚按钮，让调用方试下一个落点
    try { btn.remove(); } catch (e) { /* 摘不掉也无所谓，下面会重建 */ }
    return why;
  }

  function injectIntoRow(row) {
    if (!row || !row.isConnected) return false;

    var nameEl = findNameEl(row);
    // 用 parentElement 而不是 parentNode：名称恒为元素，parentElement 只会是元素，
    // 免得在极端结构下（父节点是文本/文档片段）插到不该插的地方。
    if (!nameEl || !nameEl.parentElement) {
      // 不在这里打日志 —— 交给 applyAll 统一判定「这行该不该有按钮」。
      // 第一版在这里逐行打，真机 20 条轨迹里 16 条是同一句「跳过一行」，
      // 把启动 / 注入 / 汇总全挤出了可视区，反而看不出问题。
      return false;
    }

    // 名称先展开(只有真被截断才动样式)。
    // ⚠️ 这一步必须排在「幂等早退」**之前** —— 平台重渲染会重写元素的 style
    //    （把我们的内联属性整段清掉），但按钮与标记都还在。若先按「已有按钮」
    //    早退，那一行就永远保持省略号（name-wrap.js 2026-10-15 踩过的同款锁死）。
    if (nameEl.getAttribute(MARK) === '1') {
      if (!stillExpanded(nameEl)) expandEl(nameEl);
    } else if (isCut(nameEl)) {
      expandEl(nameEl);
    }

    // ── 幂等（2026-10-19 三改：徽标落点 —— 只校准坐标，永不摘插）──
    //
    // 【为什么这一次的判据能一劳永逸】
    //   落点换成绝对定位徽标之后，按钮位置**只由 placeBadge() 算出的 left/top 决定**，
    //   跟平台怎么排 DOM 完全无关。于是补涂不必再问「落点对不对」这种会随内容
    //   变化的模糊问题，只问一句**确定的**：
    //     「这一枚是不是我自己放在这个单元格里的那一枚？」（父节点 === 定位容器）
    //   是 ⇒ 什么都不动，最多把 left/top 按当前名字块重算一次（折行变了才需要挪）。
    //   否 ⇒ 摘掉重放一次（旧版按钮 / 被平台挪走 / 父节点变了）。
    //
    // 【旧版按钮为什么要重放】第六轮真机：按钮插在「ID」和数字中间，修好判据后
    //   页面上那枚旧按钮不会自己挪，用户不刷新就看不到修复。所以「标记版本不对
    //   ⇒ 摘掉重放一次」必须留着；但只能一次，绝不能每轮。
    var existed = row.querySelector('.' + BTN_CLASS);
    var cell0 = infoCellOf(nameEl);
    var host = badgeHostOf(nameEl);
    if (!host) return false;        // 连能定位的容器都没有 —— 这行结构异常，不硬插

    if (existed && atKind(existed) === 'badge' && existed.parentElement === host) {
      // 名字可能刚折行 / 窗口刚缩放 ⇒ 坐标跟着重算；按钮本身**永不摘掉重插**。
      ensureBadgeRoom(nameEl);
      placeBadge(nameEl, existed, host);
      return false;                 // 本轮没有「插入」
    }
    if (existed) {
      dbg('落点重放：' + (atKind(existed) ? ('原落点 ' + atKind(existed) + ' 已失效')
                                          : '旧版按钮（无落点标记）'));
      try { existed.remove(); } catch (e0) { /* 摘不掉也无所谓，下面会新建一枚 */ }
    }

    ensureStyle();
    // ⚠️ 补空白必须先于建按钮：它会改名字块的高度，进而改变「文字底边」的测量结果。
    //   反过来的话，第一轮算出来的 top 会差一整个 padding（按钮掉到空白行下面去）。
    ensureBadgeRoom(nameEl);
    var btn = makeButton(row, nameEl);
    btn.classList.add('is-badge');
    try {
      host.appendChild(btn);
    } catch (e1) {
      return false;
    }
    placeBadge(nameEl, btn, host);
    markAt(btn, 'badge');
    logInjectOnce(row, '名称下方空白行·浮层徽标' + idDiag(cell0), nameEl, btn);
    return true;
  }

  /**
   * 只在**落点类型发生变化**时记一条注入日志（2026-10-18 降噪）。
   *
   * 【为什么要这一步】真机报告里 10 行 × 多轮补涂 = 几十条「注入一行…」，
   * 把「落点从『名称右侧』变成『ID 图标右侧』」这种**真正有用**的变化淹掉了。
   * 落点类型存在行元素上，与上次相同就不再记。
   */
  function logInjectOnce(row, where, nameEl, btn) {
    try {
      if (row.getAttribute(WHERE_MARK) === where) return;
      row.setAttribute(WHERE_MARK, where);
    } catch (e) { /* 记不住就照常记日志，不影响主流程 */ }
    dbg('注入一行（' + where + '）：名称「' + clip(nameEl.textContent) + '」· ' +
        nameBrief(nameEl) + ' · ' + buttonBrief(btn));
  }

  /**
   * 按钮的真实可见性（日志用，2026-10-18 加了这一层）
   *
   * 【为什么光看 getBoundingClientRect 不够】
   *   第一次真机报告里，控件探针数到 10 枚 `.dyc-ct-btn`、尺寸 56×20、
   *   坐标也在视口内 —— 按这些数据看「一切正常」，但用户截图里**一个都看不见**。
   *   原因是 rect 是**裁切前**的几何：祖先带 overflow:hidden + 定高时，
   *   元素照样有自己的 rect，只是画不出来。
   *   ⇒ 这里沿祖先链求「裁切区」的交集，再和按钮矩形比一次，
   *     直接给出「可见 / 被裁 / 尺寸为 0」三种结论，下次报告一眼就能定位。
   */
  function buttonBrief(btn) {
    try {
      var r = btn.getBoundingClientRect();
      var base = '按钮 ' + Math.round(r.width) + '×' + Math.round(r.height) +
                 ' @' + Math.round(r.left) + ',' + Math.round(r.top);
      if (r.width <= 0 || r.height <= 0) return base + ' · 尺寸为 0';

      // 沿祖先链求裁切矩形（只认 overflow 不是 visible 的那几层）
      var clipL = -Infinity, clipT = -Infinity, clipR = Infinity, clipB = Infinity;
      var clipBy = '';
      var el = btn.parentElement;
      var guard = 0;
      while (el && guard++ < 8) {
        var cs = getComputedStyle(el);
        if (cs.overflow !== 'visible' || cs.overflowY !== 'visible') {
          var cr = el.getBoundingClientRect();
          if (cr.right < clipR) { clipR = cr.right; clipBy = el.tagName; }
          if (cr.bottom < clipB) { clipB = cr.bottom; clipBy = el.tagName; }
          if (cr.left > clipL) clipL = cr.left;
          if (cr.top > clipT) clipT = cr.top;
        }
        el = el.parentElement;
      }
      var outRight = r.right > clipR + 0.5;
      var outBottom = r.bottom > clipB + 0.5;
      if (outRight || outBottom) {
        return base + ' · 被祖先裁掉(裁切层=' + (clipBy || '?') +
               (outRight ? ' 右侧' : '') + (outBottom ? ' 下侧' : '') + ')';
      }

      // 累计不透明度：用户报「颜色比小黄车淡很多」时，先要排除
      // 「祖先层有 opacity < 1」这一种 —— 那种情况我们自己的 opacity:1 也救不回来
      // （祖先的 opacity 会把整棵子树一起淡化）。写进日志，下次一眼可判。
      var accOp = 1, opBy = '';
      var opEl = btn.parentElement, opGuard = 0;
      while (opEl && opGuard++ < 8) {
        var opCs = getComputedStyle(opEl);
        var o = parseFloat(opCs.opacity);
        if (!isNaN(o) && o < 1) { accOp *= o; if (!opBy) opBy = opEl.tagName; }
        opEl = opEl.parentElement;
      }
      if (accOp < 0.95) {
        base += ' · 祖先把透明度压到 ' + Math.round(accOp * 100) + '%(首层=' + (opBy || '?') + ')';
      }

      // 视口横向越界（2026-10-19 真机：@1887 而视口 1707 ⇒ 用户根本看不到也点不到）
      var vw0 = (typeof window !== 'undefined' && window.innerWidth) || 0;
      if (vw0 && (r.left < -1 || r.right > vw0 + 1)) {
        return base + ' · 横向在视口外(视口宽 ' + vw0 + ')';
      }

      // 中心点被盖住（区分「我们自己浮层」与「平台元素」—— 前者关掉面板就能点）
      try {
        var cx0 = r.left + r.width / 2;
        var cy0 = r.top + r.height / 2;
        if (typeof document.elementFromPoint === 'function' && cx0 > 0 && cy0 > 0) {
          var hit0 = document.elementFromPoint(cx0, cy0);
          if (hit0 && hit0 !== btn && !btn.contains(hit0)) {
            if (isOurNode(hit0)) {
              return base + ' · 被我们自己的浮层盖住（关掉该浮层即可点到）';
            }
            return base + ' · 被' + hit0.tagName + '盖住';
          }
        }
      } catch (e3) { /* 量不了就不报 */ }

      return base + ' · 可见';
    } catch (e) {
      return '按钮几何读不到';
    }
  }

  /**
   * 名称展开后的实测状态（日志用）
   *
   * 「已折行」这种自述式日志没有诊断价值 —— 第一次真机就是被它骗了：
   * 日志写着已折行，屏幕上还是省略号。这里改成报**计算值**：
   * white-space / display / line-clamp / 高 / 溢出量，一看就知道样式有没有真生效。
   */
  function nameBrief(el) {
    try {
      var cs = getComputedStyle(el);
      var clamp = cs.webkitLineClamp || cs.getPropertyValue('-webkit-line-clamp');
      // 顺带沿祖先链找出「谁没长开」—— 只报不治（改祖先高度风险太大），
      // 真机再出问题时报告里直接指到那一层。
      var stuck = '';
      try {
        var anc = el.parentElement;
        var guard = 0;
        while (anc && guard++ < CHAIN_MAX && !CHAIN_STOP[anc.tagName]) {
          if (anc.scrollHeight - anc.clientHeight > 4) {
            stuck = ' 未长开=' + anc.tagName + '(' + anc.clientHeight + '/' + anc.scrollHeight + ')';
            break;
          }
          anc = anc.parentElement;
        }
      } catch (e2) { /* 诊断失败不影响 */ }

      return '名样式[ws=' + cs.whiteSpace + ' disp=' + cs.display +
             ' clamp=' + (clamp || 'none') +
             ' 高=' + Math.round(el.clientHeight) + '/' + Math.round(el.scrollHeight) +
             ' 溢出=' + (el.scrollWidth - el.clientWidth) +
             (lastGrow ? ' 撑高=' + lastGrow : '') + stuck + ']';
    } catch (e) {
      return '名样式读不到';
    }
  }

  function applyAll() {
    if (!enabled()) return 0;
    var rows = getRows();
    var n = 0;
    var noBtn = [];          // 本轮「没拿到按钮」的行，末尾统一判定要不要记日志
    for (var i = 0; i < rows.length; i++) {
      var done = false;
      try { done = injectIntoRow(rows[i]); } catch (e) { done = false; }
      if (done) n++; else noBtn.push(rows[i]);
    }

    // 汇总：只在数字变化时记一条（观察器每 300ms 也会调到这里）
    var sig = rows.length + '|' + n;
    if (sig !== lastSig) {
      dbg('扫描完成：候选行 ' + rows.length + ' · 本轮插入 ' + n +
          ' · 已有按钮 ' + (rows.length - n - noBtn.filter(hasOurBtn).length));
      lastSig = sig;
    }

    // 可疑行：只有「像商品行却没拿到按钮」才记 —— 分页条 / 小计行不算
    for (var j = 0; j < noBtn.length; j++) {
      try {
        var why = whyNoButton(noBtn[j]);
        if (why) dbg(why);
      } catch (e2) { /* 诊断失败不影响主流程 */ }
    }
    return n;
  }

  /** 这一行是否已经有我们的按钮（汇总里要区分「已有」与「没拿到」） */
  function hasOurBtn(row) {
    try { return !!row.querySelector('.' + BTN_CLASS); } catch (e) { return false; }
  }

  /** 上一轮扫描的计数（只用于「日志去重」，不参与任何判断） */
  var lastSig = '';

  /**
   * 补涂调度:当帧 rAF + 300ms 尾扫(与 name-wrap.js 同一套)
   *
   * 改筛选 / 翻页时平台整块重建 tbody,当帧补涂能赶在第一次绘制前把按钮
   * 与折行放上(避免「先看到省略号、半秒后才展开」的闪动);平台有时在插入
   * 节点的下一个任务里才把结构补齐,尾扫兜这一种。
   */
  function scheduleApply() {
    if (!pending) {
      pending = true;
      var raf = window.requestAnimationFrame || function (fn) { return setTimeout(fn, 16); };
      raf(function () { pending = false; if (enabled()) applyAll(); });
    }
    if (tailTimer === null) {
      tailTimer = setTimeout(function () {
        tailTimer = null;
        if (enabled()) applyAll();
      }, 300);
    }
  }

  function removeAll() {
    var btns;
    try { btns = document.querySelectorAll('.' + BTN_CLASS); } catch (e) { return; }
    for (var i = 0; i < btns.length; i++) {
      try { btns[i].remove(); } catch (e2) { /* 尽力而为 */ }
    }
  }

  /** 关闭开关:全页还原名称元素(只在拨开关时跑,频率极低) */
  function restoreAll() {
    var marked;
    try { marked = document.querySelectorAll('[' + MARK + ']'); } catch (e) { return; }
    for (var i = 0; i < marked.length; i++) {
      try { restoreEl(marked[i]); } catch (e2) { /* 尽力而为 */ }
    }
    // 2026-10-19 三改：定位容器（商品信息单元格）的 position 也还回去。
    // 注意：行被平台重建过、单元格已不在页面上时这里查不到 —— 那种情况本来
    // 也不需要还原（DOM 已经被平台换掉了）。
    var hosts;
    try { hosts = document.querySelectorAll('[' + MARK_HOST + ']'); } catch (e3) { hosts = []; }
    for (var j = 0; j < hosts.length; j++) {
      try {
        restoreProps(hosts[j], MARK_HOST_ORIG, [['position']]);
        hosts[j].removeAttribute(MARK_HOST);
      } catch (e4) { /* 尽力而为 */ }
    }
  }

  function start() {
    ensureStyle();
    if (!observer) {
      observer = new MutationObserver(scheduleApply);
      observer.observe(document.body, { childList: true, subtree: true });
    }
    // 「锁内容高度」的那一招要跟着视口宽度重算（列宽变了，几行会变）——
    // 没有这个监听，拉宽窗口后名字可能又压在 ID 行上。
    if (!resizeBound) {
      resizeBound = true;
      try {
        window.addEventListener('resize', function () {
          // 先清掉旧的像素高度，让 isCut 重新量一次
          var marked;
          try { marked = document.querySelectorAll('[' + MARK + ']'); } catch (e) { marked = []; }
          for (var i = 0; i < marked.length; i++) {
            if (/^\d+(\.\d+)?px$/.test(marked[i].style.getPropertyValue('height'))) {
              setImp(marked[i], 'height', 'auto');
            }
          }
          if (enabled()) applyAll();
        });
      } catch (e) { /* 绑不上就算了，主流程不受影响 */ }
    }
    // 启动即留一条：能一眼看出「脚本注入了没有、开关是开的还是关的」
    var tables = 0;
    try { tables = document.querySelectorAll('table').length; } catch (e) { tables = -1; }
    dbg('启动：' + location.pathname + ' · 表格数 ' + tables +
        ' · 候选行 ' + getRows().length + ' · 开关 ' + (enabled() ? '开' : '关'));
    applyAll();
  }

  function stop() {
    if (observer) { observer.disconnect(); observer = null; }
    if (tailTimer !== null) { clearTimeout(tailTimer); tailTimer = null; }
    pending = false;
    removeAll();
    restoreAll();
    removeStyle();   // 页面恢复平台原样
  }

  /* ==========================================================
   * 八、开关联动
   * ========================================================== */

  dycReadFlags().then(function (f) {
    flags = f;
    if (enabled()) start();
    else dbg('开关是关着的（罗盘商品表复制款号），未启动');
  });

  // 开关切换回声(与其它开关一致:拆成 source + 已开启/已关闭)
  var prevOn = null;
  dycWatchFlags(function (f) {
    flags = f;
    var now = enabled();
    if (prevOn !== null && now !== prevOn && typeof toast === 'function') {
      toast(now ? '已开启' : '已关闭', 'info', { source: '货号复制' });
    }
    prevOn = now;
    if (now) start();
    else stop();
  });

  // 罗盘是微前端 + 表格异步渲染 —— 首屏补扫三次兜底
  [1500, 4000, 8000].forEach(function (ms) {
    setTimeout(function () { if (enabled()) applyAll(); }, ms);
  });

  // 载入即留痕（放在最后）：这一条能区分「脚本没注入」与「注入了但没匹配到行」——
  // 用户报「没有生效」时，先看调试面板里有没有这一行，就知道该查 manifest 还是查判据。
  dbg('脚本已载入 · ' + location.pathname);
})();
