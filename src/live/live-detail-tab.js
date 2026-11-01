/**
 * 罗盘直播明细 · 打开页面自动切到「商品」标签,并下滑到「商品明细」
 * ============================================================
 * 【用户需求(2026-10-19)】
 *   「当进入直播明细页的时候,第一次刷新进去这个网页的时候,会直接切到商品页,
 *     因为我最经常看的就是商品售卖情况。」
 *   【2026-10-20 追加】「切过去的同时,要下滑到【商品明细】这一个地方」
 *   ⇒ 每次打开 / 刷新直播明细页:先切到「商品」视图,再下滑到「商品明细」区块。
 *     两个动作各只做一次;之后用户手动切到别处 / 自己滚动,一律不再拉回来。
 *
 * 【作用页】与 live-detail.js 同一页、同样两个入口:
 *     compass.jinritemai.com/shop/live-detail      (抖店侧)
 *     compass.jinritemai.com/talent/live-statement (达人侧)
 *
 * 【标签怎么认】平台用的是 antd / rc-tabs 系的标签栏 ——
 *   用户交来的两份《页面结构报告》里各有一枚「更多」按钮:
 *     抖店侧 `button#rc-tabs-0-more.aurora-tabs-nav-more`  [40,455]
 *     达人侧 `button#rc-tabs-0-more.ecom-tabs-nav-more`   [269,446]
 *   `rc-tabs-*` 就是它 —— 标签本体在 antd v4 是 `<div role="tab">`,
 *   在 v5 是 `<div class="…tabs-tab"><div role="tab">`。所以:
 *     ① 首选 `[role="tab"]` —— 语义属性,平台换哈希 / 换主题前缀都还在;
 *     ② 退 `[class*="tabs-tab"]`,并排除 `tabs-tab-more`(那是「更多」下拉,不是标签);
 *     ③ 两条都拿不到就**放弃**,不猜、不点别的东西
 *        —— 点错东西会把用户带偏,比不切更糟。
 *
 * 【文案怎么配】按优先级取第一个命中:
 *     '商品列表' → '商品' → 以「商品」开头且不超过 6 字(如「商品分析」)。
 *   两个入口的标签文案未必一致,所以不写死一个字符串。
 *
 * 【标签被折进「更多」下拉怎么办】rc-tabs 在标签超出宽度时会把多余的标签
 *   **折进「更多」下拉**(那些标签仍在 DOM 里,只是 display:none)。
 *   两份《页面结构报告》里都能看到 `button#rc-tabs-0-more`,抖店侧它的 x 坐标
 *   只有 40 —— 说明这一页的标签确实可能放不下。所以:
 *     ① 可见标签里找不到目标,但 DOM 里有被折叠的目标 ⇒ 先点「更多」展开;
 *     ② 下拉展开后,在菜单项里找文案命中的项再点(菜单项不是 role=tab);
 *     ③ 「更多」最多点 2 次 —— 开合来回点只会让用户看着晃。
 *   标签都放得下时这条路径完全不触发。
 *
 * 【卡片兜底(第二形态)】若标签栏里**没有**任何「商品」相关标签,
 *   则退一步找「核心数据分组」里那张「商品」卡片(用户截图里被红框圈住的那张:
 *   浅蓝底 + 右上角三角 = 选中态)。判据从严 —— 文本必须**恰好**是「商品」、
 *   尺寸像标题(20~400px 宽)、且向上 4 层内能找到带 `card` 的类名。
 *   注意「标签栏里有目标、只是还没量到尺寸」**不算**这一档 —— 那只是还没画完,
 *   等下一轮就好,绝不能因此去点卡片。
 *
 * 【为什么要反复重试】罗盘是微前端,标签栏由 React 异步渲染,首屏常常还没有标签。
 *   用一张逐级拉长的重试表(0.8s → 18s,共 8 次),命中即停。
 *   不挂 MutationObserver 全页监听 —— 那是常驻开销,而这个功能只关心前十几秒。
 *
 * 【切完之后再下滑到「商品明细」(2026-10-20 用户追加)】
 *   「切过去的同时,要下滑到【商品明细】这一个地方」
 *   —— 切到「商品」只是第一步,用户真正要看的是下面那块「商品明细」列表,
 *      所以切成功后还要把视图滚到那儿。三条设计取舍:
 *   ① **必须等切页渲染完再滚**:`isActive` 翻成 true 的那一刻,商品明细区
 *      往往还没挂载/还没拉到数据,此时量不到锚点。故滚动另起一张更靠后的
 *      重试表(0.6s → 5s,共 5 次),找到锚点才动手。
 *   ② **锚点按文案找,不认类名**:罗盘是微前端、类名带哈希,而「商品明细」
 *      这四个字是产品文案,跨版本稳定。判据:文本以「商品明细」开头且不超过
 *      10 字(容得下「商品明细(12)」这类计数后缀)、尺寸像标题、且**不在标签栏里**。
 *   ③ **用「逐层补偿」而不是 scrollIntoView**:本页既有整页滚动、也可能有
 *      内层滚动容器,scrollIntoView 只动一个且会被平台的 sticky 头盖住。
 *      做法是沿锚点的可滚祖先链逐层调 scrollTop 把锚点顶边对到视口
 *      `SECTION_TOP_GAP` 处,再补 window 的剩余位移,来回三趟收敛。
 *      **不做动画**:动画期间平台重渲染会改掉目标位置,中途想中断也难;
 *      打开页面时瞬间到位反而最不意外。
 *
 * 【滚动同样不抢方向盘】用户一滚(滚轮 / 触摸 / 方向键 / 翻页键,只认
 *   `event.isTrusted` 的真实事件)就立刻放弃剩余的滚动尝试,**不再拉回去**;
 *   已经滚到位了则什么都不做。
 *
 * 【只切一次 · 三条停手判据】
 *   ① **已经在目标上** ⇒ 立刻收工,不点。
 *   ② **点满 3 次** ⇒ 不再补点,等它渲染。切页是异步的,「没渲染完」和
 *      「没生效」在这一刻分不开,所以**不在这里下失败结论** ——
 *      结论交给收尾复核(见下)。
 *   ③ **用户自己动了标签栏** ⇒ 永久停手。`RETRY_AT` 最长铺到 18 秒,
 *      若标签栏 12 秒才出来而用户已切到「互动」在看别的数据,
 *      我们再把视图拽回「商品」就是抢方向盘。判据用 `event.isTrusted`
 *      (浏览器产生的事件为 true、我们 dispatchEvent 造的为 false),
 *      天然分流,不需要额外标志位。
 *   两次点击之间还有 2.5 秒冷却 —— 否则 0.8s 一档的重试会把
 *   「已生效但还没画完」误判成「没生效」,三次机会眨眼用完。
 *
 * 【失败怎么收尾】重试表跑完后**先复核一次**:若此时 `isActive` 已是 true,
 *   说明其实切成功了,正常收工;真的没切过去才在控制台留一条诊断
 *   (带当前标签栏现状,用户 F12 就能看到卡在哪一环)。
 *
 * 【开关】flags.js 的 `liveDetailAutoTab`(抖店组,默认开)。关掉即停手,
 *   已经切过去的视图**不回滚**(回滚会把用户正看的内容切走)。
 * ============================================================
 */

(function dycLiveDetailTab() {
  'use strict';

  // 防重复注入(SPA 路由回切、脚本意外重跑时不重复开定时器)
  if (window.__dycLiveDetailTabLoaded) return;
  window.__dycLiveDetailTabLoaded = true;

  var LOG_PREFIX = '[直播明细切页]';

  /* ---------- 依赖自检(flags.js 必须先加载) ---------- */
  if (typeof dycReadFlags !== 'function' || typeof dycWatchFlags !== 'function') {
    return;
  }

  /* ---------- 常量 ---------- */

  /** 目标文案:完全匹配按这个顺序找 */
  var WANT_EXACT = ['商品列表', '商品'];
  /** 前缀兜底:以「商品」开头且不超过这么多字(如「商品分析」) */
  var WANT_PREFIX = '商品';
  var WANT_PREFIX_MAX = 6;

  /**
   * 重试表(ms,相对页面加载)。
   * 罗盘首屏渲染慢,给足 18 秒;命中即停,不做全页监听。
   *
   * 2026-10-20 前段加密(800/1600/2800/4500 → 500/1000/1700/2600):
   * 卡片通常在 1 秒内就渲染出来了,原本要等到 2.8 秒才发现「哦,可以点了」,
   * 用户体感就是「打开页面后愣一下才动」。总时长不变,仍铺到 18 秒兜慢页面。
   */
  var RETRY_AT = [500, 1000, 1700, 2600, 3800, 5500, 8500, 13000, 18000];

  /** 最多点几次 —— 点了不生效就再补一次,三次都不行说明判据不对,停手 */
  var MAX_CLICKS = 3;

  /** 最多点几次「更多」—— 展开下拉是幂等的,开合来回点只会让用户看着晃 */
  var MAX_MORE_CLICKS = 2;

  /**
   * 商品卡片最多点几次。
   * 卡片这一档**验证不了结果**(选中态是伪元素画的浅蓝底 + 三角,读不到判据),
   * 所以只点两次就收工:第一次可能打在「节点在、监听还没挂上」的窗口里,
   * 第二次兜住它。再多只会让下方数据区反复闪。
   */
  var MAX_CARD_CLICKS = 2;

  /**
   * 两次点击之间的冷却(ms)—— **标签与卡片分开算**。
   *
   * 为什么必须有:切标签是**异步**的 —— 点下去之后 React 要重新渲染、
   * 甚至要拉一次接口,`isActive` 才会翻成 true。而重试表前几档只隔 0.5~0.7 秒,
   * 不等冷却就会把「已经生效、只是还没渲染完」误判成「没生效」,
   * 三次机会眨眼用完,反而把真正需要补点的情况挡在外面。
   *
   * 标签 1.5 秒:原值 2.5 秒是照「最慢情况」定的,代价是「没生效时第二次补点
   * 要等到 2.8 秒那一档」。补点同一个标签本来就是幂等的,提前一点没有副作用。
   *
   * 卡片 0.9 秒:卡片是本地视图切换(不换路由),反应比标签快得多;
   * 而且卡片档点完就立刻开始找「商品明细」,补点的意义只剩「第一次打在
   * 还没挂监听的节点上」,不需要等那么久。
   */
  var TAB_CLICK_COOLDOWN_MS = 1500;
  var CARD_CLICK_COOLDOWN_MS = 900;

  /**
   * 卡片兜底最多量几个候选(正常恒为个位数;封顶防极端页面)
   */
  var CARD_SCAN_MAX = 30;

  /** 卡片标题文案最多几个字(容「商品」「商品(12)」「商品列表」) */
  var CARD_TEXT_MAX = 8;

  /**
   * B 档(按文本节点找卡片)最多向上找几层带 `card` 的祖先。
   * 2026-10-20 由 4 提到 8:真机上标题到卡片容器隔了 6 层以上,
   * 4 层判据一次都没命中。层数上限只是为了别一路找到 body,
   * 真正的闸门是下面「卡片尺寸」那一档。
   */
  var CARD_ANCESTOR_MAX = 8;

  /**
   * 一张卡片合理的尺寸区间(px)—— 用来排除整屏行容器与零星文字。
   *
   * 上限刻意给得很宽(640×300):这道闸门要挡的是「一整屏的内容容器」,
   * 不是精确区分卡片。窗口一宽、卡片一多,真卡片就可能到 500px 以上,
   * 上限卡太紧的后果是 **A/B/C 三档一起失效**(表现为「明明看得见就是找不到」),
   * 比偶尔点到一个偏大的容器严重得多。
   */
  var CARD_W_MIN = 100;
  var CARD_W_MAX = 640;
  var CARD_H_MIN = 40;
  var CARD_H_MAX = 300;

  /**
   * 「卡片行」判据(不认类名的那一档):同一个父元素下,**尺寸相近的兄弟**
   * 至少要有这么多个(不含自己),才认为这是一排卡片。
   * 2 个就够 —— 卡片行通常有 4~9 张,但只要「旁边还有两张一样大的」,
   * 这个结构特征就已经成立,又不会把正文段落误当成卡片。
   */
  var CARD_ROW_MIN_SIMILAR = 2;

  /** 「尺寸相近」的容差:宽高各自相差不超过这个比例 */
  var CARD_ROW_SIZE_TOL = 0.3;
  /* ---------- 切完之后「下滑到商品明细」的参数 ---------- */

  /** 锚点文案:以它开头即可(容得下「商品明细(12)」这类计数后缀) */
  var SECTION_TEXT = '商品明细';
  var SECTION_MAX_LEN = 10;      // 超过这么多字就不是标题,是正文里的句子

  /**
   * 「商品明细」标题最终要落在视口顶下方多少 px。
   * 留 96px ≈ 平台顶部那条筛选/操作栏的高度 —— 贴 0 会被 sticky 头盖住,
   * 用户还得手动往回滚一点才看得见标题。
   */
  var SECTION_TOP_GAP = 96;

  /**
   * 滚动重试表(ms,相对「切页动作发起」那一刻)。
   *
   * 前密后疏:0 轮(立即试一次)不在表里,由 `scheduleScroll` 直接跑。
   * 表里从 120ms 起、前 1 秒有 4 次 ——「商品明细」有时在切页瞬间就已经挂载好
   * (只是刚才被折叠),这几档负责第一时间抓住;
   * 尾部拖到 7.8 秒,兜住「接口很慢、列表后到」的情况。命中即停,不会白跑。
   *
   * 2026-10-20 由 [600,1200,2200,3500,5000,7000,9000] 改为现在这版:
   * 旧表起步就 600ms,而且间隔越拉越大 —— 锚点若在 2.4 秒出现,
   * 得白等到 3.5 秒那一档才滚,用户体感就是「半天不下滑」。
   */
  var SCROLL_AT = [120, 300, 550, 850, 1250, 1750, 2400, 3200, 4300, 5800, 7800];

  /**
   * DOM 唤醒的最小间隔(ms)。
   * 「商品明细」是接口回来后才挂载的,出现时刻不可预测 —— 光靠上面那张表,
   * 最坏要白等一个间隔(尾部 2 秒级)。这里盯住 DOM 新增节点,
   * 锚点一出现就立刻扫一次,把「等到下一个闹钟」这段抹掉。
   * 200ms 足以覆盖 React 的批量渲染节奏,又不会把 CPU 打满。
   */
  var WAKE_THROTTLE_MS = 200;

  /** 判「已经滚到位」的容差(px) —— 比人眼能分辨的位移小一档 */
  var SCROLL_TOLERANCE = 4;

  /** 找「商品明细」时最多扫多少个文本节点(防极端页面把 TreeWalker 走穿) */
  var SECTION_SCAN_MAX = 8000;

  /* ---------- 出声(AGENTS.md 第 21 条:三段式 · 来源 ｜ 值 ｜ 结果数) ---------- */

  /**
   * 消息来源词 —— **必须与弹窗里那一行的 label 一致**,改名时一起改。
   * 开关回声与结果提示共用这一个词,不许各写一份字面量(迟早对不上)。
   */
  var SRC = '自动切商品页';

  /**
   * 结果文案:条上给短版,盒子里给全版(2026-10-19 用户定:
   * 「报错的提示词太长了」—— 条上只放一两句,盒子要能看全)。
   * 条上短到 9 个字,横排不换行;盒子里那句才把落点说清。
   */
  /**
   * 成功文案 —— **全程只有这一条**(2026-10-20 用户二次定稿)。
   *
   * 先把它删过一轮:用户当时说「不需要什么都报,能合并成一次提示或者能少就少」,
   * 于是「切到商品」和「并下滑」各报一条(还剩一条「用户让路」也报)= 每刷新
   * 一次就积两三条进盒子。删过头了 —— 随后用户明确要求
   * 「切换并成功下滑,要有消息提示」。
   *
   * 现在回到**一条**:整条链路(切页 + 下滑)真的做完才说这一句,
   * 前面不再有「已切到商品」这种中间态报喜。要说就是「全都成了」,
   * 要么就等失败的那两句。中间态不报,是「能少就少」的具体落法。
   *
   * 措辞对两种档位**都成立**:`sayScrollDone` 只在真的找到「商品明细」
   * 锚点并滚到位时才调 —— 而「商品明细」只存在于商品屏,所以锚点存在 +
   * 到位本身就是「切页已生效」的实证,不必依赖标签档读到的选中态
   * (卡片档也一样,见 tabConfirmed 的注释;那里是「没找到」时的保守措辞)。
   */
  var MSG_DONE = '已切到「商品」并下滑';
  var MSG_DONE_FULL = '已切到「商品」并下滑到「商品明细」';

  /**
   * 失败文案 —— 只在没做成时说话。
   * 说了才知道是哪儿没成,不说就只能盯着页面猜。
   */
  var MSG_MISS = '已切到「商品」，没找到「商品明细」';
  var MSG_TAB_MISS = '没找到「商品」，本次未切换';

  /**
   * 卡片档专用的那句 —— 措辞刻意不说「已切到」。
   *
   * 标签档能读到选中态(`isActive`),「切到了」是**读出来的事实**;
   * 卡片档的选中态是伪元素画的浅蓝底 + 三角,读不到判据(见 MAX_CARD_CLICKS),
   * 所以只能说「已点」。这个区别在「页面底部压根没有商品明细区块」时最要紧:
   * 是没切过去,还是切过去了但文案变了?标签档能断言前者,卡片档不能。
   * 用户 2026-10-20 明确要求「不许谎报」,宁可措辞含糊也不要把猜测说成事实。
   */
  var MSG_CARD_MISS = '已点「商品」卡片，没找到「商品明细」';

  /**
   * 用户自己抢先滚动 ⇒ 我们让路,没替他下滑。
   *
   * 措辞只能是「已切到「商品」」这一个半句 —— 带上「并下滑」就是假话。
   * 卡片档同理退成「已点」(读不到选中态)。
   */
  var MSG_TAB = '已切到「商品」';
  var MSG_CARD_ONLY = '已点「商品」卡片';

  var flags = null;
  var timers = [];
  var step = 0;          // 当前是第几次尝试(仅用于日志)
  var clicks = 0;        // 已经点过几次
  var moreClicks = 0;    // 已经点过几次「更多」(展开下拉)
  var cardClicks = 0;    // 已经点过几次商品卡片(兜底档)
  var lastClickAt = 0;   // 上一次点击的时间戳(冷却用)
  var done = false;      // 已切成功(或本来就在目标上)
  var userTook = false;  // 用户自己动过标签栏 ⇒ 本功能彻底停手
  var touchBound = false;// 「盯用户手动操作」的监听只挂一次
  var scrollTook = false;// 用户自己滚过页面 ⇒ 放弃剩余的滚动尝试
  var scrollBound = false;// 「盯用户滚动」的监听只挂一次
  var scrollAt = 0;      // 已经滚过几次(仅用于日志)
  var scrollTimers = [];
  /**
   * **一次性闸门** —— 这个功能一次打开页面只出一条消息
   * (2026-10-20 用户定:「正常使用和异常使用,这个功能只弹出一条消息」)。
   *
   * 它同时是「已经定下结论」的标记,两个用途天然同源:结论只在
   * 「事情真的定下来」那一刻产生(到位 / 让路 / 失败),而那正是要说话的时刻。
   * 所以四个出口(成功 / 让路 / 没找到区块 / 没找到商品)共用这一个变量,
   * 「最多一条」由结构保证 —— 不靠几个独立布尔量恰好互斥。
   *
   * ⚠️ 别退回「每个出口一个开关」:那样两套去重并行时,
   *    理论上完全可能各报一条(本项目就曾同时有 scrollDoneSaid 与 tabMissSaid)。
   */
  var scrollDoneSaid = false;
  var scrollScheduled = false;   // 滚动重试表只铺一次
  /**
   * 切页**是否已被证实**(读到标签选中态)。
   * 只影响措辞,不影响任何动作 —— 卡片档为 false,所以它的提示一律说「已点」
   * 而不说「已切到」(见 MSG_CARD_MISS 的注释)。
   */
  var tabConfirmed = false;
  var domWatcher = null;      // DOM 唤醒的观察器(切页后挂、到位即断)
  var wakeTimer = null;       // 节流:已经排了一次唤醒就不再排第二个
  var lastTryAt = 0;          // 上一次滚动尝试的时刻(节流基准)
  var lastHref = '';
  var urlTimer = null;
  var giveupTimer = null;

  // 「盯用户手动操作」的两个监听**立刻挂上**,不等开关读完 ——
  // 读开关是一次异步 storage 调用,那几毫秒里用户完全可能已经点了标签栏、
  // 或已经自己滚起来了。漏掉那一次,后面就会把他的视图拽走 / 把他滚回去。
  // 监听本身零开销,先挂无妨。
  // ⚠️ 调用点必须在上面那批 `var` **之后**:函数里读写的 `touchBound` 是 var,
  //    提前调用会被随后的 `= false` 覆盖回初始值(AGENTS 第 24 条)。
  watchUserTouch();
  watchUserScroll();


  /* ---------- 日志 ---------- */

  /** 调试日志(进调试面板;调试面板不在时静默) */
  function dbg(msg) {
    try {
      if (typeof window.debugLog === 'function') {
        window.debugLog(LOG_PREFIX + ' ' + msg);
      }
    } catch (e) { /* 日志失败绝不能影响主流程 */ }
  }

  /**
   * 放弃时往控制台留一条诊断。
   * 只在「试完 8 次都没成功」时打 —— 平时不污染控制台,
   * 但真出问题时用户 F12 就能看到卡在哪一环。
   */
  function warn(msg) {
    try {
      if (window.console && console.warn) {
        console.warn(LOG_PREFIX + ' ' + msg +
          '(把这条连同「页面结构报告」一起发给助手即可定位)');
      }
    } catch (e) { /* 尽力而为 */ }
  }

  /* ---------- 出声 ---------- */

  /** 统一出口(消息条不在也绝不影响功能) */
  function say(msg, type, opts) {
    try {
      if (typeof toast === 'function') toast(msg, type, opts || {});
    } catch (e) { /* 消息条不在不影响功能本身 */ }
  }

  /**
   * 四个出口共用的**一次性闸门**(见 scrollDoneSaid 的注释)。
   * 返回 true = 这一条轮到你说了,并且已经把闸门关上。
   */
  function takeSpeech() {
    if (scrollDoneSaid) return false;
    scrollDoneSaid = true;
    return true;
  }

  /**
   * 整条链路走完:切到「商品」**并且**把「商品明细」滚进视口。
   *
   * 这是功能真正兑现承诺的那一条(见 MSG_DONE 的注释)。用 success ⇒ 进消息盒子,
   * 用户回头点开左下角标记能看到它到底做过什么、落点在哪。
   *
   * 位置很关键:只在「滚动到位」那一刻调,绝不在点击瞬间调 ——
   * 点了但没生效也报成功,比不报更糟。
   */
  function sayScrollDone() {
    if (!takeSpeech()) return;
    say(MSG_DONE, 'success', { source: SRC, full: MSG_DONE_FULL });
  }

  /**
   * 切页成功了、却没找到「商品明细」这个区块 —— **这是没做成,要说**。
   *
   * 用 alert ⇒ 进盒子:用户看到「页面往下没动」时,盒子里有话说,
   * 不必去猜是不是没生效。同时把「页面上像标题的短文本」留在控制台,
   * 这样万一平台改了文案,下一轮反馈能把真实文案带回来。
   */
  function sayScrollMiss() {
    if (!takeSpeech()) return;
    say(tabConfirmed ? MSG_MISS : MSG_CARD_MISS, 'alert', { source: SRC });
  }

  /**
   * 切过去了(或至少点了「商品」),但**不再下滑** —— 用户自己已经在滚了。
   *
   * 要说,但只能报前半个事实:他接管了滚动,我确实没替他下滑,
   * 带上「并下滑」就是假话。
   *
   * 用 info:条上看得见、**不进消息盒子**。这一档几乎等同于「用户随手滚了一下」,
   * 每刷新一次就往盒子里积一条属于噪音;而成功那一条进了盒子,
   * 事后要回看结果时也够用。
   */
  function sayTabOnly() {
    if (!takeSpeech()) return;
    say(tabConfirmed ? MSG_TAB : MSG_CARD_ONLY, 'info', { source: SRC });
  }

  /**
   * 重试表跑完,连「商品」都没找到 —— **这是没做成,要说**。
   * 用 alert:进盒子,事后回看也知道「这次为什么没动」。
   */
  function sayTabMiss() {
    if (!takeSpeech()) return;
    say(MSG_TAB_MISS, 'alert', { source: SRC });
  }

  /* ---------- 基础判据 ---------- */

  function enabled() {
    return !!flags && flags.liveDetailAutoTab !== false;
  }

  /** 当前是否在直播明细页(两个入口) */
  function onThisPage() {
    try {
      return typeof DYC_PAGE_PATTERNS !== 'undefined'
        && DYC_PAGE_PATTERNS.compassLive
        && DYC_PAGE_PATTERNS.compassLive.test(location.href);
    } catch (e) {
      return false;
    }
  }

  /** 归一化文本:去所有空白(平台会在标签里塞换行 / 缩进) */
  function normText(el) {
    try {
      return String((el && el.textContent) || '').replace(/\s+/g, '');
    } catch (e) {
      return '';
    }
  }

  /** 取 class(用 getAttribute —— SVG 的 className 是对象,老内核上会出岔子) */
  function classOf(el) {
    try {
      return String((el && el.getAttribute && el.getAttribute('class')) || '');
    } catch (e) {
      return '';
    }
  }

  /* ---------- ① 标签栏 ---------- */

  /**
   * 找出所有标签元素。
   * 先走语义属性 `[role="tab"]`(最稳);一条都没有才退 class 判据。
   * **两条路径不混用** —— 混起来会把 `.tabs-tab` 外层与 `.tabs-tab-btn` 内层
   * 同时收进来,同一个标签算两次。
   */
  function findTabs() {
    var out = [];
    var i;
    try {
      var byRole = document.querySelectorAll('[role="tab"]');
      for (i = 0; i < byRole.length; i++) out.push(byRole[i]);
    } catch (e) { /* 选择器不支持就当没找到 */ }
    if (out.length) return out;

    try {
      var byCls = document.querySelectorAll('[class*="tabs-tab"]');
      for (i = 0; i < byCls.length; i++) {
        // 「更多」下拉不是标签,排除(报告里那枚 rc-tabs-0-more)
        if (/tabs-tab-more|tabs-nav-more/.test(classOf(byCls[i]))) continue;
        out.push(byCls[i]);
      }
    } catch (e) { /* 尽力而为 */ }
    return out;
  }

  /** 这个标签当前是不是选中态 */
  function isActive(el) {
    if (!el) return false;
    try {
      if (el.getAttribute('aria-selected') === 'true') return true;
      // antd v4 的选中态是类名 `…tabs-tab-active`
      if (/(^|[\s-])active([\s-]|$)/i.test(classOf(el))) return true;
      // 有的实现把 aria-selected 放在外层、role 在内层 —— 往上找一层
      var p = el.parentElement;
      if (p && p.getAttribute && p.getAttribute('aria-selected') === 'true') return true;
    } catch (e) { /* 尽力而为 */ }
    return false;
  }

  /**
   * 这个元素现在真的看得见吗。
   *
   * 为什么必须有这一档:antd / rc-tabs 在标签超出宽度时会把多余的标签
   * **折进「更多」下拉**里 —— 那些标签**仍留在 DOM 里**,只是 `display:none`。
   * 两份《页面结构报告》里都出现了 `rc-tabs-0-more` 按钮,说明这一页的标签
   * 确实多到会折叠。若不判可见性,`findTabs` 会把折叠的「商品」当成目标,
   * 对着一个 `display:none` 的元素派发点击 —— 点了没反应,还占掉 3 次机会。
   *
   * 判据只用**矩形**(宽高都为 0 即视为不可见):它同时覆盖 `display:none`
   * (矩形全 0)与 `visibility:hidden`;而 `opacity:0` 的元素矩形非 0,
   * 那种情况下点击其实到得了,不算不可见 —— 与真实可点性一致。
   */
  function isVisible(el) {
    if (!el) return false;
    try {
      var r = el.getBoundingClientRect();
      return !!r && r.width > 0 && r.height > 0;
    } catch (e) {
      return true;      // 量不出来就别拦,宁可点了没反应也不要漏掉
    }
  }

  /** 按优先级从标签里挑目标。
   *
   * **外层是文案精度、内层才是标签顺序** —— 先找「商品列表」、再找「商品」,
   * 同一种文案在标签栏里出现多次时取最靠左的那个。
   * 反过来写(外层标签顺序)会出现「『商品』排在『商品列表』前面就选了『商品』」,
   * 两个标签并存时选哪个全凭排版,不可控。
   * 被折叠进「更多」下拉的标签(不可见)一律跳过 —— 点了不会有反应。
   */
  function pickTab(tabs) {
    var i, k, t, el;
    for (k = 0; k < WANT_EXACT.length; k++) {
      for (i = 0; i < tabs.length; i++) {
        el = tabs[i];
        if (!isVisible(el)) continue;
        if (normText(el) === WANT_EXACT[k]) return el;
      }
    }
    for (i = 0; i < tabs.length; i++) {
      el = tabs[i];
      if (!isVisible(el)) continue;
      t = normText(el);
      if (t.indexOf(WANT_PREFIX) === 0 && t.length <= WANT_PREFIX_MAX) return el;
    }
    return null;
  }

  /** 标签栏现状,压成一句话进日志(每项截 12 字) */
  function tabsBrief(tabs) {
    var parts = [];
    for (var i = 0; i < tabs.length && i < 12; i++) {
      var t = normText(tabs[i]) || '(无文本)';
      if (t.length > 12) t = t.slice(0, 12) + '…';
      parts.push(t + (isActive(tabs[i]) ? '*' : ''));
    }
    return parts.join(' / ') + (tabs.length > 12 ? ' …共' + tabs.length + '个' : '');
  }

  /**
   * 标签栏里**存在**目标标签吗(不要求可见)。
   *
   * 用途 = 给「卡片兜底」加一道闸门:标签栏渲染过程中,标签可能短暂量到
   * 0×0(`isVisible` 为假)⇒ `pickTab` 返回 null。若此时直接退到卡片兜底,
   * 就会去点「核心数据分组」里那张卡片 —— 而标签其实马上就画好了。
   * 所以只有在「标签栏里根本没有商品相关标签」时才允许走卡片那一档。
   */
  function hasWantedTab(tabs) {
    for (var i = 0; i < tabs.length; i++) {
      if (matchesWanted(normText(tabs[i]))) return true;
    }
    return false;
  }

  /** 文案是否命中目标(与 pickTab 同一套口径) */
  function matchesWanted(t) {
    var k;
    for (k = 0; k < WANT_EXACT.length; k++) if (t === WANT_EXACT[k]) return true;
    return t.indexOf(WANT_PREFIX) === 0 && t.length <= WANT_PREFIX_MAX;
  }

  /* ---------- ①-b 标签被折进「更多」下拉时 ---------- */

  /**
   * 找「更多」下拉按钮。
   *
   * 为什么需要这一档:antd / rc-tabs 在标签放不下时会把多余的标签
   * **折进「更多」下拉**里 —— 那些标签仍留在 DOM 里,只是 `display:none`。
   * 两份《页面结构报告》里都出现了 `button#rc-tabs-0-more`(类名 `*-tabs-nav-more`),
   * 说明这一页的标签确实可能超出宽度。若不处理,「商品」就在下拉里等着被点。
   *
   * ⚠️ 两条安全闸门,确保「不需要时绝不点它」:
   *   ① 调用方只在 `findFoldedTarget()` 真的找到一个**被折叠的目标标签**时
   *      才会走到这里 —— 标签都放得下时这条路径完全不触发;
   *   ② 这里再用 `isVisible` 过一道。注意它的能力边界:rc-tabs 的「更多」
   *      在不溢出时用的是 `visibility:hidden`(矩形非 0、`isVisible` 判不出),
   *      所以真正兜底的是闸门 ① —— ②只是顺手挡掉 `display:none` 那一类。
   */
  function findMoreBtn() {
    var i, list;
    try {
      list = document.querySelectorAll('[class*="tabs-nav-more"]');
      for (i = 0; i < list.length; i++) {
        if (isVisible(list[i])) return list[i];
      }
    } catch (e) { /* 尽力而为 */ }
    return null;
  }

  /**
   * DOM 里有没有**被折叠的**目标标签(存在、但量不到尺寸)。
   * 只有它存在时才值得去开「更多」—— 否则贸然展开一个下拉菜单,
   * 既没东西可点、又给用户留下一块挡着的浮层。
   */
  function findFoldedTarget() {
    var tabs = findTabs();
    for (var i = 0; i < tabs.length; i++) {
      if (isVisible(tabs[i])) continue;
      if (matchesWanted(normText(tabs[i]))) return tabs[i];
    }
    return null;
  }

  /**
   * 在下拉面板里找目标项。
   *
   * 下拉里的项**不是** `[role="tab"]` —— rc-tabs 渲染的是
   * `…tabs-dropdown-menu-item` 这类 div,面板没开时它们是 `display:none`。
   * 所以这里单独一条判据,且只认**可见项**(面板已展开)。
   *
   * ⚠️ 搜索范围先收进**带 `tabs-dropdown` 的容器**再找项,不做全页找
   *    `[class*="dropdown-menu-item"]` —— 页面上别的组件(下拉筛选、级联选择)
   *    也用 `dropdown-menu-item`,全页找会点到不相干的东西。
   *    没有 `tabs-dropdown` 容器就直接放弃这一档(宁可这一轮不切,也不乱点)。
   *
   * 命中多个时取**最深**的那个:同一个菜单项常常是「外层容器 + 内层文字块」
   * 两层文本相同,点内层最准(外层可能带 padding,点到空白区不生效)。
   */
  function pickFromMenu() {
    var panels, i, j, all, best = null, bestDepth = -1;
    try {
      panels = document.querySelectorAll('[class*="tabs-dropdown"]');
    } catch (e) {
      return null;
    }
    for (i = 0; i < panels.length; i++) {
      // ⚠️ 不判「面板容器本身可见」—— 容器可能是个零尺寸的定位壳,
      //    面板开着它照样量不到尺寸。**开没开由菜单项自己的可见性决定**:
      //    收起来时项是 display:none,下面的 isVisible 自然会把它们全滤掉。
      try { all = panels[i].querySelectorAll('*'); } catch (e) { continue; }
      for (j = 0; j < all.length; j++) {
        var el = all[j];
        if (!isVisible(el)) continue;
        if (!matchesWanted(normText(el))) continue;
        var d = 0, p = el;
        while (p && d < 40) { d++; p = p.parentElement; }
        if (d > bestDepth) { bestDepth = d; best = el; }
      }
    }
    return best;
  }

  /* ---------- ② 卡片(这一页的**真实**形态) ---------- */

  /**
   * 「核心数据分组」里那张「商品」卡片(用户截图里被红框圈住的那张:
   * 浅蓝底 + 右上角三角 = 选中态,里面是「商品」/「商品曝光-点击率(人数)」/「19.08%」)。
   *
   * 【为什么这条是**主**路径,不是兜底 —— 2026-10-20 真机证伪】
   *   抖店侧直播明细页的标签栏只有两个标签:**「直播诊断」「核心数据」**
   *   (诊断报告实测:`标签栏 2 个标签里没有「商品」→ 直播诊断 / 核心数据*`)。
   *   「商品」根本不是标签,而是「核心数据」这一屏里的一张**指标卡片**。
   *   旧版把卡片当兜底、判据又极严(文本节点**恰为**「商品」+ 向上 **4 层**
   *   必须有 `card` 类名),真机上一次都没命中 —— 诊断轨迹里
   *   「也没找到商品卡片」连刷 6 次。
   *
   * 【现行判法:三档,逐级放宽,但每一档都要求「点它有意义」】
   *   A. **按卡片容器找**(主):遍历 `[class*="card"]`,class 片段以 `card` 开头
   *      且不是 `cardGroup` / `cardWrap` 这类**行容器**;尺寸落在
   *      CARD_W_MIN~MAX / CARD_H_MIN~MAX;它内部的**第一个短标题**以「商品」开头。
   *      返回**卡片容器本身** —— 点整张卡比点里面的文字稳得多。
   *   B. **按文本节点找**(次):文本恰为「商品」,向上 **最多 8 层**
   *      (旧版 4 层够不着)找带 `card` 的祖先。
   *   C. **按结构找**(末):完全不认类名 —— 文本恰为「商品」的元素,
   *      向上找一层,如果**它的父元素下有 ≥2 个尺寸相近的兄弟**,就认定它是卡片。
   *      依据是截图事实:这些卡片是等宽等高地排成一排的;正文段落没有这种特征。
   *
   * 三档都失败就返回 null,**绝不乱点** —— 点错一张指标卡会把用户的图表换掉,
   * 比不切更糟。
   */
  function pickCard() {
    return pickCardByContainer() || pickCardByText() || pickCardByRow();
  }

  /** 这个 class 列表里有没有「真卡片」的类名(排除 cardGroup / cardWrap 这类行容器) */
  function hasCardClass(el) {
    var toks = classOf(el).split(/\s+/);
    for (var i = 0; i < toks.length; i++) {
      var t = toks[i].toLowerCase();
      if (!t || !/^card[-\d]/.test(t)) continue;    // card-xxxx / card2 —— 不看 cardGroup
      return true;
    }
    return false;
  }

  /** 卡片内部的第一个短标题(长度 ≤ CARD_TEXT_MAX、且不是纯数字) */
  function cardTitleOf(el) {
    var n, hit = 0;
    try {
      var walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null);
      n = walker.currentNode;
      while (n && hit++ < 200) {
        if (n.nodeType === 3) {
          var t = normText(n);
          if (t && t.length <= CARD_TEXT_MAX && !/^[\d\s.,%+\-]+$/.test(t)) return t;
        }
        n = walker.nextNode();
      }
    } catch (e) { /* 尽力而为 */ }
    return '';
  }

  /** 卡片标题是否就是要找的那张(以「商品」开头、不超过 CARD_TEXT_MAX 字) */
  function matchesCardText(t) {
    return !!t && t.indexOf(WANT_PREFIX) === 0 && t.length <= CARD_TEXT_MAX;
  }

  /** 尺寸像不像一张卡片 */
  function looksLikeCard(el) {
    var r;
    try { r = el.getBoundingClientRect(); } catch (e) { return false; }
    if (!r) return false;
    return r.width >= CARD_W_MIN && r.width <= CARD_W_MAX
        && r.height >= CARD_H_MIN && r.height <= CARD_H_MAX;
  }

  /** A 档:按卡片容器找 */
  function pickCardByContainer() {
    var list, i;
    try {
      list = document.querySelectorAll('[class*="card"]');
    } catch (e) {
      return null;
    }
    for (i = 0; i < list.length; i++) {
      var el = list[i];
      if (!hasCardClass(el)) continue;       // 行容器 cardGroup / cardWrap 在这里被挡掉
      if (!isVisible(el)) continue;
      if (!looksLikeCard(el)) continue;
      if (!matchesCardText(cardTitleOf(el))) continue;
      return el;
    }
    return null;
  }

  /** B 档:按文本节点找(旧路径,祖先层数 4 → 8) */
  function pickCardByText() {
    // ⚠️ `nodes` 必须初始化为空数组 —— 写成 `var nodes;` 后
    //    `while (nodes.length < ...)` 会直接抛 TypeError,
    //    被下面的 try/catch 吞掉、表现为「一例都不命中」,极难定位。
    var nodes = [], i;
    try {
      if (typeof document.createTreeWalker !== 'function' || !document.body) return null;
      var walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null);
      var n = walker.currentNode;
      while (n && nodes.length < CARD_SCAN_MAX) {
        if (n.nodeType === 3 && n.parentElement && matchesCardText(normText(n))) {
          nodes.push(n.parentElement);
        }
        n = walker.nextNode();
      }
    } catch (e) {
      return null;
    }

    for (i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      var p = el, hit = null;
      for (var k = 0; k < CARD_ANCESTOR_MAX && p; k++) {
        // ① 必须用 hasCardClass,不能写成 /card/i —— 后者会把 cardGroup 行容器
        //    也算成卡片,点上去不生效(真机表现和「没找到」一模一样,极难区分)。
        // ② 必须过 looksLikeCard,否则整屏大的容器也会被当成卡片返回。
        if (hasCardClass(p) && isVisible(p) && looksLikeCard(p)) { hit = p; break; }
        p = p.parentElement;
      }
      if (hit) return hit;
    }
    return null;
  }

  /**
   * C 档:完全不认类名,只靠「等宽等高的兄弟排成一排」这个结构特征。
   *
   * 为什么需要这一档:class 哈希每次发版都可能变,而「一排卡片」的**几何特征**
   * 是稳定不变的。判据 = 从标题元素往上爬,第一个「父元素下有 ≥2 个尺寸相近
   * 兄弟」的层级就是卡片行,那一层元素就是卡片。
   *
   * 上限 4 层:再往上就是整屏容器了,那时候兄弟关系已经没有意义。
   */
  function pickCardByRow() {
    var nodes, i;
    try {
      if (typeof document.createTreeWalker !== 'function' || !document.body) return null;
      var walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null);
      var n = walker.currentNode;
      nodes = [];
      while (n && nodes.length < CARD_SCAN_MAX) {
        if (n.nodeType === 3 && n.parentElement && matchesCardText(normText(n))) {
          nodes.push(n.parentElement);
        }
        n = walker.nextNode();
      }
    } catch (e) {
      return null;
    }

    for (i = 0; i < nodes.length; i++) {
      var el = nodes[i], guard = 0;
      while (el && guard++ < 4) {
        if (isVisible(el) && looksLikeCard(el) && hasSimilarSiblings(el)) return el;
        el = el.parentElement;
      }
    }
    return null;
  }

  /** 同一个父元素下有没有 ≥ CARD_ROW_MIN_SIMILAR 个「尺寸相近」的兄弟 */
  function hasSimilarSiblings(el) {
    var row = el.parentElement;
    if (!row) return false;
    var mine;
    try { mine = el.getBoundingClientRect(); } catch (e) { return false; }
    if (!mine || mine.width <= 0) return false;

    var kids = row.children || [];
    var n = 0;
    for (var i = 0; i < kids.length; i++) {
      var k = kids[i];
      if (k === el) continue;
      var r;
      try { r = k.getBoundingClientRect(); } catch (e) { continue; }
      if (!r || r.width <= 0) continue;
      var dw = Math.abs(r.width - mine.width) / mine.width;
      var dh = mine.height > 0 ? Math.abs(r.height - mine.height) / mine.height : 1;
      if (dw <= CARD_ROW_SIZE_TOL && dh <= CARD_ROW_SIZE_TOL) n++;
      if (n >= CARD_ROW_MIN_SIMILAR) return true;
    }
    return false;
  }

  /**
   * 把页面上每张可见卡片的**实际标题**列出来 —— 只给失败诊断用。
   *
   * 为什么要这个:卡片的标题是「卡片里第一个短文本」。真机若在标题前插了
   * 一个问号气泡 / 图标文字,`cardTitleOf` 就会读成「?」而不是「商品」,
   * 表现为「明明看着有这张卡,它就是找不到」。有了这行清单,
   * 下一次反馈一眼就能看出是「没卡片」还是「标题读歪了」。
   */
  function cardBrief() {
    var list, i, parts = [], seen = 0;
    try { list = document.querySelectorAll('[class*="card"]'); } catch (e) { return '(取不到)'; }
    for (i = 0; i < list.length && seen < 8; i++) {
      if (!hasCardClass(list[i]) || !isVisible(list[i])) continue;
      var t = cardTitleOf(list[i]) || '(空)';
      if (t.length > 8) t = t.slice(0, 8) + '…';
      parts.push(t);
      seen++;
    }
    return parts.length ? parts.join(' / ') : '(无)';
  }

  /** 页面上一共有多少张「真卡片」—— 只给失败诊断用(说明是没找到还是根本没有) */
  function cardCount() {
    var list, i, n = 0;
    try { list = document.querySelectorAll('[class*="card"]'); } catch (e) { return 0; }
    for (i = 0; i < list.length; i++) if (hasCardClass(list[i]) && isVisible(list[i])) n++;
    return n;
  }

  /* ---------- 派发一次真实点击 ---------- */

  /**
   * 对平台元素派发点击。
   *
   * 两个要点:
   *   ① **必须 bubbles:true** —— React 17+ 的合成事件委托在 root 容器上,
   *      事件不冒泡就到不了它的监听器。
   *   ② 先补一个 `pointerdown`:平台在**捕获阶段** stopPropagation 吞掉 click
   *      的写法在抖店侧出现过(见工程笔记),pointerdown 是另一条路径。
   *      老内核(360 极速浏览器X)没有 PointerEvent,取不到就跳过。
   */
  function fire(el) {
    try {
      if (typeof PointerEvent === 'function') {
        el.dispatchEvent(new PointerEvent('pointerdown', {
          bubbles: true, cancelable: true, view: window
        }));
      }
    } catch (e) { /* 老内核:跳过指针事件 */ }

    try {
      el.dispatchEvent(new MouseEvent('click', {
        bubbles: true, cancelable: true, view: window
      }));
      return true;
    } catch (e) {
      try { el.click(); return true; } catch (e2) { return false; }
    }
  }

  /* ---------- 用户手动操作 ⇒ 立刻停手 ---------- */

  /**
   * 盯住「用户自己点标签栏」这件事 —— 一旦发生,本功能永久停手。
   *
   * 为什么必须有:`RETRY_AT` 最长铺到 18 秒。假如标签栏 12 秒才渲染出来,
   * 而用户那会儿已经自己切到「互动」在看别的数据了,我们再把视图拽回「商品」
   * 就是**抢方向盘** —— 自动功能最忌讳这个。
   *
   * 判据用 `event.isTrusted`:**浏览器自己产生的事件为 true,
   * 我们 `dispatchEvent` 造的为 false** —— 这条天然把「我们点的」和
   * 「用户点的」分开,不需要额外的标志位。老内核上若 isTrusted 恒为 undefined,
   * 则视为「用户点的」:宁可少切一次,也不要跟用户抢。
   *
   * 只听标签栏范围内的点击(标签本身或其祖先链上有 role=tab / tabs-tab 类名),
   * 页面上别的地方点一下不会误伤本功能。
   */
  function watchUserTouch() {
    if (touchBound) return;      // 只挂一次(开关反复拨动不叠加监听)
    touchBound = true;
    function onTouch(e) {
      if (done || userTook) return;
      var t = e && e.target;
      if (!t) return;
      // isTrusted === false 才是我们自己派的;undefined / true 一律当用户操作
      if (e.isTrusted === false) return;
      if (!insideTabBar(t)) return;
      userTook = true;
      done = true;
      clearTimers();
      clearScrollTimers();
      dbg('检测到用户自己点了标签栏,本功能停手(不跟用户抢)');
    }
    try {
      document.addEventListener('pointerdown', onTouch, true);
      document.addEventListener('click', onTouch, true);
    } catch (e) { /* 老内核挂不上就算了,不影响主流程 */ }
  }

  /**
   * 盯住「用户自己滚动」—— 一旦发生,放弃剩余的滚动尝试,不再拉回去。
   *
   * 与 watchUserTouch 同一套思路,但监听的是**输入动作**而不是 scroll 事件:
   *   · scroll 事件分不清是谁滚的 —— 我们自己调的 scrollTop 同样会触发它,
   *     用它当判据等于「一滚就自我否决」;
   *   · 滚轮 / 触摸 / 方向键 / 翻页键这些**输入事件**只有真人操作才会产生,
   *     再叠加 `isTrusted` 过一道,判据就干净了。
   * 触摸屏上还要盯 touchmove,而且**不能用 passive:false + preventDefault**
   * 去拦 —— 我们只是旁观,不干预用户的滚动。
   */
  function watchUserScroll() {
    if (scrollBound) return;
    scrollBound = true;
    function give() {
      if (scrollTook) return;
      scrollTook = true;
      clearScrollTimers();
      dbg('检测到用户自己滚动,放弃剩余的滚动尝试(不跟用户抢)');
    }
    function onWheel(e) {
      if (e.isTrusted === false) return;     // 自己派发的不算
      give();
    }
    /**
     * 键盘只认**会滚动页面**的那几个键。
     * 不加这层过滤的话,用户随手敲个字母(比如在别处输入)也会被当成滚动,
     * 白白放弃剩下的机会。
     */
    var SCROLL_KEYS = {
      ArrowUp: 1, ArrowDown: 1, PageUp: 1, PageDown: 1,
      Home: 1, End: 1, Space: 1, ' ': 1
    };
    function onKey(e) {
      if (e.isTrusted === false) return;
      if (!SCROLL_KEYS[e.key]) return;
      give();
    }
    try {
      window.addEventListener('wheel', onWheel, { passive: true, capture: true });
      window.addEventListener('touchmove', onWheel, { passive: true, capture: true });
      document.addEventListener('keydown', onKey, true);
    } catch (e) { /* 老内核:尽力而为 */ }
  }

  /**
   * 这个节点是不是**标签栏本身**的一部分(标签、导航条、或它们的子元素)。
   *
   * ⚠️ 必须按 class **片段**逐个判,不能对整串做 `/tabs-tab/` 匹配 ——
   *    antd / rc-tabs 的**内容容器**类名是 `…tabs-tabpane`(`tabs-tab` + `pane`),
   *    整串匹配会把「商品」这一整个内容区都判成标签栏 ⇒ `findSectionAnchor`
   *    永远认为「商品明细」标题在标签栏里 ⇒ 永远滚不下去。
   *    所以先排除 `tabpane / tab-pane / tabs-content` 这类内容容器。
   *
   * 两个调用方都要求这条判据「紧」:
   *   · 用户点标签栏 ⇒ 停手 —— 点在内容区里不算,不该因此放弃切页;
   *   · 找「商品明细」标题 ⇒ 排除标签栏 —— 页签里可能有同名页签,
   *     点它可不是「往下滚」。
   */
  function insideTabBar(node) {
    var p = node, guard = 0;
    while (p && guard++ < 6) {
      try {
        if (p.getAttribute && p.getAttribute('role') === 'tab') return true;
      } catch (e) { /* 继续往上找 */ }
      var cls = classOf(p);
      if (cls) {
        var toks = cls.split(/\s+/);
        for (var i = 0; i < toks.length; i++) {
          var tk = toks[i];
          if (!tk) continue;
          // 内容容器不是标签栏 —— 先排除,否则 `tabs-tabpane` 会被下一条命中
          if (/tabpane|tab-pane|tabs-content/i.test(tk)) continue;
          if (/tabs-nav|tabs-tab/i.test(tk)) return true;
        }
      }
      p = p.parentElement;
    }
    return false;
  }

  /* ---------- ③ 下滑到「商品明细」 ---------- */

  /**
   * 找「商品明细」这个区块标题。
   *
   * 判据(从严,宁可这一轮不滚也不滚错地方):
   *   · 文本以「商品明细」开头、总长 ≤ SECTION_MAX_LEN
   *     —— 容得下「商品明细(12)」这种计数后缀,又不吃「商品明细里的退款…」这类正文;
   *   · 有尺寸、像标题(宽 ≥ 40、高 12~120)—— 排除被折叠/隐藏的副本;
   *   · **不在标签栏里** —— 页面别处(比如段落控件)也可能出现「商品明细」四个字,
   *     那是可点的分类项而不是区块标题。
   *
   * 走 TreeWalker 只扫文本节点:一趟线性,且判据本来就落在文本上。
   */
  function findSectionAnchor() {
    if (typeof document.createTreeWalker !== 'function' || !document.body) return null;
    var walker, n, hit = 0;
    try {
      walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null);
      n = walker.currentNode;
    } catch (e) {
      return null;
    }
    while (n && hit++ < SECTION_SCAN_MAX) {
      if (n.nodeType === 3) {
        var t = normText(n);
        if (t.indexOf(SECTION_TEXT) === 0 && t.length <= SECTION_MAX_LEN && n.parentElement) {
          var el = n.parentElement;
          if (!insideTabBar(el) && looksLikeHeading(el)) return el;
        }
      }
      n = walker.nextNode();
    }
    return null;
  }

  /** 尺寸像不像一个小标题(排除整块容器、也排除零星字符) */
  function looksLikeHeading(el) {
    var r;
    try { r = el.getBoundingClientRect(); } catch (e) { return false; }
    return !!r && r.width >= 40 && r.height >= 12 && r.height <= 120;
  }

  /**
   * 这个元素自己能不能纵向滚动。
   * 判据:内容高于可视区 + 溢出策略是 auto/scroll/overlay。
   * `overflow: hidden` 的容器**滚不动**(赋 scrollTop 不生效),必须排除 ——
   * 平台常拿它做圆角裁切,把它算进来会让补偿量算在空处。
   */
  function canScrollY(el) {
    if (!el || el.scrollHeight <= el.clientHeight + 1) return false;
    var cs;
    try { cs = getComputedStyle(el); } catch (e) { return false; }
    var oy = (cs.overflowY || cs.overflow || '');
    return /auto|scroll|overlay/.test(oy);
  }

  /**
   * 锚点的「页面滚动链」= 从锚点往上,所有**自己会滚且包着锚点**的容器。
   * 只沿祖先链走,所以链外的滚动区(侧栏菜单、直播互动栏的评论列表)
   * 一定不在此列 —— 与工程里「上滑到顶 / 下滑到底」的口径一致。
   */
  function scrollChainOf(el) {
    var out = [], p = el.parentElement, guard = 0;
    while (p && guard++ < 40) {
      var tag = p.tagName;
      if (tag !== 'BODY' && tag !== 'HTML' && canScrollY(p)) out.push(p);
      p = p.parentElement;
    }
    return out;
  }

  /**
   * 把锚点顶边对到「视口顶下方 SECTION_TOP_GAP」处。
   *
   * 为什么用「逐层补偿」而不是 `scrollIntoView`:
   *   scrollIntoView 只保证「露出来」,不保证落在哪;而且它会同时动多个容器,
   *   平台那条 sticky 顶栏就会把标题盖住。这里从最内层可滚容器开始按需滚,
   *   不够的位移交给上一层,最后一层交给 window —— 每一层之间是**读一次、
   *   写一次**,不与样式写入交错。
   *
   * @return {boolean} 是否已经到位(容差 SCROLL_TOLERANCE)
   */
  function alignToSection(anchor) {
    var pass, i;
    // 三趟收敛:第一趟可能因为容器懒加载/高度变化而只走了一半,复量再补。
    for (pass = 0; pass < 3; pass++) {
      var r = anchor.getBoundingClientRect();
      var delta = r.top - SECTION_TOP_GAP;
      if (Math.abs(delta) <= SCROLL_TOLERANCE) return true;

      var remain = delta;
      var chain = scrollChainOf(anchor);
      for (i = 0; i < chain.length && Math.abs(remain) > 1; i++) {
        var el = chain[i];
        var before = el.scrollTop;
        var max = el.scrollHeight - el.clientHeight;
        var want = Math.min(max, Math.max(0, before + remain));
        window.__dycScriptScrollAt = Date.now();   // 程序化滚动豁免(auto-refresh 藏灯判定)
        el.scrollTop = want;
        remain -= (want - before);      // 这一层实际吃掉的位移
      }
      if (Math.abs(remain) > 1) {
        var y = window.pageYOffset || 0;
        window.__dycScriptScrollAt = Date.now();
        window.scrollTo(0, Math.max(0, y + remain));
      }
    }
    var after = anchor.getBoundingClientRect();
    return Math.abs(after.top - SECTION_TOP_GAP) <= SCROLL_TOLERANCE * 3;
  }

  /** 找到锚点就滚;返回 true = 已经到位 */
  function tryScrollToSection() {
    var anchor = findSectionAnchor();
    if (!anchor) {
      dbg('滚动第' + scrollAt + '次:还没找到「商品明细」');
      return false;
    }
    var ok = alignToSection(anchor);
    dbg('滚动第' + scrollAt + '次:' + (ok ? '已到「商品明细」' : '尚未到位,等下一轮'));
    return ok;
  }

  /**
   * 现在还允许自动滚动吗。
   * 抽成独立谓词,是为了让「用户接管」「开关关闭」「离开了本页」
   * 这三个否决条件集中在一处 —— 三处分派点(逐次尝试 / 收尾诊断)
   * 各写一遍的话,迟早有一处漏掉某个条件。
   */
  function scrollAllowed() {
    return !scrollTook && enabled() && onThisPage();
  }

  function clearScrollTimers() {
    for (var i = 0; i < scrollTimers.length; i++) {
      try { clearTimeout(scrollTimers[i]); } catch (e) { /* 尽力而为 */ }
    }
    scrollTimers = [];
    // 观察器也一起断:凡是「不让滚了」的路径(用户接管 / 开关关闭 / 换页)
    // 都从这里出去,漏一处就会留下一个空转的 observer
    stopDomWatch();
  }

  /**
   * 做一次滚动尝试,并在成功那一刻收尾。
   * 抽成统一入口,是因为现在有**两个触发源**:重试表的闹钟、DOM 变化唤醒。
   * 两处各写一遍「试 + 判成功 + 收尾」,迟早有一处忘了断观察器 / 忘了报消息。
   *
   * @return {boolean} 是否已到位
   */
  function attemptScroll() {
    if (!scrollAllowed()) { stopDomWatch(); return false; }
    lastTryAt = Date.now();
    scrollAt++;
    var ok = false;
    try {
      ok = tryScrollToSection();
    } catch (e) {
      dbg('滚动第' + scrollAt + '次出错:' + (e && e.message));
      return false;
    }
    if (ok) finishScroll();
    return ok;
  }

  /** 到位收尾:停掉所有闹钟与观察器,报一声成功 */
  function finishScroll() {
    clearScrollTimers();
    stopDomWatch();
    sayScrollDone();
  }

  /**
   * DOM 唤醒:有新增节点、且新内容里带「商品」时,立刻叫醒一次扫描。
   *
   * 为什么要节流:React 渲染一屏会连开几百个微任务的 mutation,
   * 每个回调都去扫全文档的话,那几百毫秒里 CPU 就白烧了。
   * 200ms 一次足够跟上渲染节奏,又不会让用户感受到卡顿。
   */
  function wakeScroll() {
    if (!scrollAllowed() || scrollDoneSaid) return;
    var gap = Date.now() - lastTryAt;
    if (gap >= WAKE_THROTTLE_MS) { attemptScroll(); return; }
    if (wakeTimer) return;                 // 已经排了一个,别排第二个
    wakeTimer = setTimeout(function () {
      wakeTimer = null;
      attemptScroll();
    }, WAKE_THROTTLE_MS - gap);
  }

  /**
   * 盯住 DOM 新增节点。
   * 成本控制:回调里**只读新增节点自己的文本**,不含「商品」就直接放过 ——
   * 绝大多数渲染(数字跳动、行内更新)都过不了这一关,等于零开销。
   * 只有真的把商品区块挂上来时才触发全量扫描。
   */
  function startDomWatch() {
    if (domWatcher || typeof MutationObserver !== 'function' || !document.body) return;
    try {
      domWatcher = new MutationObserver(function (records) {
        if (!scrollAllowed()) { stopDomWatch(); return; }
        for (var i = 0; i < records.length; i++) {
          var added = records[i].addedNodes;
          if (!added) continue;
          for (var j = 0; j < added.length; j++) {
            var n = added[j];
            var t = '';
            if (n.nodeType === 3) t = n.nodeValue || '';
            else if (n.nodeType === 1) t = n.textContent || '';
            else continue;
            if (t && t.indexOf(WANT_PREFIX) >= 0) { wakeScroll(); return; }
          }
        }
      });
      domWatcher.observe(document.body, { childList: true, subtree: true });
    } catch (e) {
      domWatcher = null;   // 老内核挂不上就退回纯闹钟,不影响功能
    }
  }

  function stopDomWatch() {
    if (domWatcher) {
      try { domWatcher.disconnect(); } catch (e) { /* 尽力而为 */ }
      domWatcher = null;
    }
    if (wakeTimer) { clearTimeout(wakeTimer); wakeTimer = null; }
  }

  /**
   * 铺一张「滚动重试表」。
   * 只在**切页动作发起之后**调用一次(`scrollScheduled` 兜住重复触发)——
   * done 分支有三处(isActive / 卡片 / 收尾复核),都调它会铺三张表。
   */
  function scheduleScroll() {
    if (scrollScheduled) return;
    scrollScheduled = true;

    // 用户已经自己滚过 ⇒ 一个闹钟都不该再挂(不跟他抢方向盘)。
    // 但「已经点了/切到商品」这件事仍要如实报一声 —— 否则用户分不清
    // 「它没干活」和「它干了我没看见」。
    if (scrollTook) {
      sayTabOnly();
      return;
    }
    clearScrollTimers();

    // 第 0 轮:立刻试。切页动作刚发起时,下方区块有时已经挂载好
    // (只是刚才被折叠),等第一个闹钟纯属白等 —— 而用户这时正盯着屏幕。
    if (attemptScroll()) return;

    for (var i = 0; i < SCROLL_AT.length; i++) {
      (function (delay) {
        scrollTimers.push(setTimeout(function () { attemptScroll(); }, delay));
      })(SCROLL_AT[i]);
    }

    // 闹钟之间靠 DOM 唤醒补位:锚点一出现就滚,不等下一档
    startDomWatch();

    // 全部试完仍没找到锚点 → 留一条控制台诊断,把「页面上像标题的短文本」列出来。
    // 只在失败时打,平时不污染控制台;用户 F12 一发,就知道真实文案叫什么。
    scrollTimers.push(setTimeout(function () {
      if (attemptScroll()) return;
      if (!scrollAllowed()) return;
      warn('没能滚到「' + SECTION_TEXT + '」。页面上像标题的短文本有:'
           + headingSamples().join(' / '));
      sayScrollMiss();
    }, SCROLL_AT[SCROLL_AT.length - 1] + 1200));
  }

  /**
   * 采集「页面上像标题的短文本」,最多 12 条、每条截 12 字 —— 只给失败诊断用。
   * 这是把「判据写错了」和「页面还没渲染」分开的关键线索:
   * 若清单里根本没有「商品明细」四个字,说明这块的文案不是这么写的。
   */
  function headingSamples() {
    var out = [], n, hit = 0;
    try {
      var walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null);
      n = walker.currentNode;
      while (n && hit++ < SECTION_SCAN_MAX && out.length < 12) {
        if (n.nodeType === 3) {
          var t = normText(n);
          if (t && t.length <= SECTION_MAX_LEN && n.parentElement &&
              !insideTabBar(n.parentElement) && looksLikeHeading(n.parentElement)) {
            if (out.indexOf(t) < 0) out.push(t);
          }
        }
        n = walker.nextNode();
      }
    } catch (e) { /* 尽力而为 */ }
    return out.length ? out : ['(没找到任何像标题的短文本)'];
  }

  /* ---------- 主流程 ---------- */

  function tryOnce() {
    if (done || userTook || !enabled() || !onThisPage()) return;

    var tabs = findTabs();
    if (!tabs.length) {
      // 标签栏还没渲染出来(微前端首屏) —— 等下一次重试
      dbg('第' + step + '次:标签栏还没出现');
      return;
    }

    var target = pickTab(tabs);
    if (target) {
      var label = normText(target);
      if (isActive(target)) {
        done = true;
        tabConfirmed = true;       // 读到选中态 ⇒ 这是**事实**,不是猜测
        dbg('第' + step + '次:已经在「' + label + '」上,无需切换');
        scheduleScroll();          // 切页已就位 ⇒ 接着下滑到「商品明细」
        return;
      }
      if (clicks >= MAX_CLICKS) {
        // 点够次数就停手，但**不判失败** —— 切页是异步的，
        // 此刻可能只是还没渲染完。留给后续重试去发现「其实已经切过去了」，
        // 真正的失败结论由收尾复核（giveupTimer）下。
        dbg('第' + step + '次:已点满 ' + MAX_CLICKS + ' 次,不再补点,等它渲染');
        return;
      }
      // 冷却:上一次点击可能还在渲染中,过早补点会把「还没画完」误判成「没生效」
      if (coolingDown()) return;
      var ok = fire(target);
      clicks++;
      lastClickAt = Date.now();
      dbg('第' + step + '次:切「' + label + '」→ ' + (ok ? '已派发点击(第' + clicks + '次)' : '派发失败'));
      return;
    }

    /* ---- 可见标签里没有目标:先看是不是被折进了「更多」下拉 ---- */

    // ① 下拉已展开(可能是我们上一轮点开的,也可能是用户自己开的)
    //    ⇒ 直接点菜单里的目标项
    var menuItem = pickFromMenu();
    if (menuItem) {
      if (coolingDown()) return;
      var okM = fire(menuItem);
      clicks++;
      lastClickAt = Date.now();
      dbg('第' + step + '次:点「更多」下拉里的目标项「' + normText(menuItem) + '」→ '
          + (okM ? '已派发点击(第' + clicks + '次)' : '派发失败'));
      return;
    }

    // ② 有目标标签但被折叠着 ⇒ 点「更多」把它展开,下一轮再点它
    if (findFoldedTarget()) {
      var more = findMoreBtn();
      if (more && moreClicks < MAX_MORE_CLICKS) {
        if (coolingDown()) return;
        fire(more);
        moreClicks++;
        lastClickAt = Date.now();
        dbg('第' + step + '次:目标标签被折进「更多」,先展开下拉(第' + moreClicks + '次)');
        return;
      }
      // 折叠着、又点不开「更多」—— 不硬来,等下一轮(可能只是还没渲染完)
      dbg('第' + step + '次:目标标签被折叠,但找不到可点的「更多」按钮,再等等');
      return;
    }

    // ③ 标签栏里**存在**目标标签、只是这一刻量不到尺寸 ⇒ 等它画完,
    //    绝不在这时退到卡片兜底(那会点错东西)
    if (hasWantedTab(tabs)) {
      dbg('第' + step + '次:标签栏里有「商品」但还没量到尺寸,等它渲染');
      return;
    }

    // ④ 标签栏里压根没有「商品」相关标签 → 走卡片(这一页的**真实形态**)
    //    ⚠️ 抖店侧这一页只有「直播诊断 / 核心数据」两个标签,「商品」是
    //    「核心数据」屏里的一张卡片 —— 所以这一条不是兜底,而是主路径。
    var card = pickCard();
    if (!card) {
      dbg('第' + step + '次:标签栏 ' + tabs.length + ' 个标签里没有「商品」;'
          + '页面上可见卡片 ' + cardCount() + ' 张,标题依次为「' + cardBrief() + '」,'
          + '没有一张以「' + WANT_PREFIX + '」开头 → ' + tabsBrief(tabs));
      return;
    }
    // 卡片这一档**验证不了选中态**:浅蓝底 + 右上角三角是伪元素画的,读不到判据。
    // 但「切没切过去」还有另一个证据 —— **「商品明细」区块只存在于商品屏**,
    // 它一出现就等于切页生效了。所以第二次补点改成「只在没看到锚点时」才做,
    // 已经切过去了就不再点(反复点同一张卡只会让下方数据区闪)。
    if (cardClicks >= 1 && findSectionAnchor()) {
      done = true;
      dbg('第' + step + '次:「商品明细」已出现 ⇒ 切页生效,不再补点卡片');
      scheduleScroll();
      return;
    }
    if (cardClicks >= MAX_CARD_CLICKS) {
      done = true;
      dbg('第' + step + '次:商品卡片已点 ' + cardClicks + ' 次,收工');
      scheduleScroll();            // 卡片档也算「切过去了」,照常下滑
      return;
    }
    if (coolingDown(CARD_CLICK_COOLDOWN_MS)) return;
    var ok2 = fire(card);
    cardClicks++;
    lastClickAt = Date.now();
    // ⚠️ 点完**立刻**开始找「商品明细」,不再等「点满 2 次」。
    //    旧逻辑要等第二次点击(cardClicks>=2)才 scheduleScroll,而两次点击之间
    //    隔着 2.5 秒冷却、外面还压着 2.8/4.5 秒两档重试 —— 实际最早 4.5 秒才开始滚,
    //    用户体感就是「切过去了,但半天不下滑」。滚动表本身是幂等的,
    //    点下去就可以并行找,找不到就等下一轮,没有副作用。
    scheduleScroll();
    dbg('第' + step + '次:标签栏无「商品」,改点商品卡片 → '
        + (ok2 ? '已派发点击(第' + cardClicks + '次)' : '派发失败'));
  }

  /** 上一次点击是否还在冷却期(在的话本轮回调直接跳过) */
  function coolingDown(ms) {
    if (Date.now() - lastClickAt < (ms || TAB_CLICK_COOLDOWN_MS)) {
      dbg('第' + step + '次:上一次点击还没到冷却时间,再等等');
      return true;
    }
    return false;
  }

  function clearTimers() {
    for (var i = 0; i < timers.length; i++) {
      try { clearTimeout(timers[i]); } catch (e) { /* 尽力而为 */ }
    }
    timers = [];
    if (giveupTimer) { clearTimeout(giveupTimer); giveupTimer = null; }
    clearScrollTimers();     // 切页一停,滚动也没必要继续 —— 两者是同一件事的两半
  }

  function schedule() {
    clearTimers();
    step = 0;
    clicks = 0;
    moreClicks = 0;
    cardClicks = 0;
    lastClickAt = 0;
    // 换页后允许重新滚一次(但 scrollTook 与 userTook 一样**不重置** ——
    // 用户刚自己滚过 / 点过标签栏,说明他正在操作,不该被新页面接管)
    scrollScheduled = false;
    scrollAt = 0;
    tabConfirmed = false;   // 换页了,上一次的「已确认」不适用于这一次
    lastTryAt = 0;

    for (var i = 0; i < RETRY_AT.length; i++) {
      (function (idx, delay) {
        timers.push(setTimeout(function () {
          if (done || userTook || !enabled()) return;
          step = idx + 1;
          try { tryOnce(); } catch (e) { dbg('第' + step + '次尝试出错:' + (e && e.message)); }
        }, delay));
      })(i, RETRY_AT[i]);
    }

    // 重试表跑完还没成功 → 先复核一次「其实已经切过去了」,再决定要不要报警
    giveupTimer = setTimeout(function () {
      if (done || userTook || !enabled() || !onThisPage()) return;
      var tabs = findTabs();
      var t = pickTab(tabs);
      if (t && isActive(t)) {
        done = true;
        tabConfirmed = true;
        dbg('收尾复核:已在「' + normText(t) + '」上,正常结束');
        scheduleScroll();
        return;
      }
      warn('试了 ' + RETRY_AT.length + ' 次仍未切到「商品」,已放弃本次。'
           + '当前页面标签:'
           + (tabs.length ? tabsBrief(tabs) : '(页面上找不到标签栏)'));
      sayTabMiss();
    }, RETRY_AT[RETRY_AT.length - 1] + 1500);
  }

  /**
   * URL 变化监听(1.5s 粒度)。
   * 罗盘是微前端,同一标签页里可能从别的页切进来 —— 那时 content_scripts
   * 不会重新注入,靠这条兜住「重新进入直播明细页」的场景。
   * 整页刷新 / 新开标签则本来就由 manifest 注入,不需要它。
   */
  function watchUrl() {
    lastHref = location.href;
    if (urlTimer) clearInterval(urlTimer);
    urlTimer = setInterval(function () {
      if (location.href === lastHref) return;
      lastHref = location.href;
      if (!enabled() || !onThisPage()) return;
      // ⚠️ 换页后**不重置 userTook** —— 用户刚在标签栏上点过,
      //    说明他正在自己操作,不该被新页面重新接管。
      //    只有整页刷新 / 重新打开才会重来(那时脚本是全新一份)。
      if (userTook) return;
      done = false;
      dbg('URL 变化,重新尝试切页');
      schedule();
    }, 1500);
  }

  /* ---------- 开关联动 ---------- */

  var prev = null;

  dycReadFlags().then(function (f) {
    flags = f;
    prev = enabled();
    if (prev) { schedule(); watchUrl(); }
  });

  dycWatchFlags(function (f) {
    flags = f;
    var now = enabled();
    if (prev !== null && now !== prev) {
      // 开关回声(第 21 条三段式:来源 ｜ 值);来源词与弹窗 label 对得上
      try {
        if (typeof toast === 'function') {
          toast(now ? '已开启' : '已关闭', 'info', { source: SRC });
        }
      } catch (e) { /* 消息条不在不影响功能 */ }
    }
    prev = now;

    if (now) {
      // 用户手动接管过就不自动接管回来 —— 只有重新打开页面才恢复
      if (!userTook) { done = false; schedule(); }
      watchUrl();
    } else {
      // 关掉只停手 —— **不回滚**已经切过去的视图(那会把用户正看的切走)
      clearTimers();
    }
  });
})();
