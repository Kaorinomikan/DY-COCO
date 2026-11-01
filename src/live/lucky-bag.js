/**
 * 超级福袋 · 活动状态监视与自动执行下一轮（中控台）
 * ============================================================
 * 【用户要什么（2026-11-01 逐项确认）】
 *   福袋活动已在「管理超级福袋活动」弹窗里提前创建好，本功能不填表单、
 *   不选奖励、不改份数 —— **唯一的写动作 = 点行内「开始活动」文字链**。
 *   · 循环规则：开始即开始下一轮，对同一个活动再点一次。
 *   · 停止判据：不看金额。用户原话「我所有已经创建的剩余的量，
 *     只要还能点，就是有」⇒ 还能点就继续，点不动了就停。轮数不设上限。
 *   · 失败处理：立即停并报警，不重试。
 *   · 两个独立开关：福袋活动状态监视（默认开，只读）、福袋自动执行下一轮（默认关）。
 *
 * 【真实页面结构（2026-11-01 用户截图确认）】
 *   弹窗「管理超级福袋活动」有 Tab（全部/待开始/进行中/已结束/异常）、
 *   搜索框（placeholder 含「奖励名称」）、表格四列（奖励信息 / 参与信息 /
 *   参与条件 / 活动状态）。「开始活动」是**文字链**，与「复制」上下相邻。
 *   ⇒ 误点「复制」会新建一个活动副本，所以匹配必须是**完全相等**，
 *     绝不能用 includes —— 这是本文件最重要的一条防误点约束。
 *
 * 【为什么是「扫描 + 迁移」而不是「点击状态机」】
 *   第一版把点击当主线，结果「只监视」模式下永远停在待命，不会播报开始。
 *   现改为：每拍扫描所有活动行 → 得出各自状态（待开始/进行中/已结束）→
 *   只在**状态迁移**时播报。监视与开始下一轮共用这一条扫描线：
 *     · 监视 = 只读迁移，检测到「进行中 → 已结束」就播报参与人数；
 *     · 开始下一轮 = 在扫描结果上多加一步「有待开始的行就点它」。
 *   好处：只读模式下真的能看见开始；两个开关的差异只剩「点不点」。
 *
 * 【为什么不用类名】
 *   中控台是 React + Garfish 微前端，class 带构建哈希，每次发版都变。
 *   只认文案、结构层级与语义属性（role / aria-* / disabled）。
 *   ⇒ 全文件不允许出现 [class*= 这类选择器（自测里有静态扫描）。
 *
 * 【安全取向（写死在设计里，不是补丁）】
 *   所有「判不出」一律走「不动 + 计时 + 超时停」，不存在「猜一下试试」。
 *   乱点的代价（重复开始、撞平台平台校验）远高于停机的代价（用户手动点一下）。
 *
 * 【消息纪律（AGENTS 第 21 条）】
 *   三段式「来源 ｜ 值 ｜ 结果数」，来源词 = 福袋。
 *   三个播报点：本轮开始（info 不入盒）/ 开始（success 原位刷新）/
 *   异常停止（alert，条上短、盒子里全）。
 *
 * 【红线】
 *   本任务分支内不改 version / 不 push / 不打 tag / 不碰 update-manifest.json。
 *
 * 【2026-11-01 晚 · 用户报「发了福袋，圆钮还是未开始」后的加固】
 *   现场证据只有诊断报告：`luckyBag.现场` = panel:false / rows:0。
 *   这一个读数有两种含义，旧版分不开（①抽屉关着 ②抽屉开着但认不出来），
 *   于是这次改的不是「再猜一套选择器」，而是**让下一次报告能自证**：
 *     · panelInfo() 交代「靠哪个锚点认出的抽屉」，认不出也把线索带出去；
 *     · probe() 逐行带上每格文字、链接可点性、行标签与尺寸；
 *     · pageClues() 摸一遍抽屉外的「福袋」字样（回答「关着抽屉能不能读」）。
 *   同时把三处**已知会漏**的判据放宽（都是读，不涉及写动作）：
 *     · 面板锚点：真机入口写的是「超级福袋-活动管理」，不只截图那一种写法；
 *     · 行来源：tr 与「开始活动」链接**同时**扫（旧版是二选一），
 *       再补「同级兄弟行」——否则 div 布局下「进行中 / 已结束」的行永远读不到，
 *       开始播报会整段哑掉；
 *     · 状态词与倒计时：补「待开始 / 已开始 / 距结束 03:12 / 剩余 3分12秒」。
 *   安全取向不变：放宽的只有**读**；点击仍然要求「文本完全等于开始活动」
 *   且该行只含一个「开始活动」（防点错活动、防误点「复制」）。
 * ============================================================
 */

(function dycLuckyBag() {
  'use strict';

  if (window.__DYC_LUCKY_BAG__) return;   // 重复注入只认第一份

  /* ==========================================================
   * 一、常量
   * ========================================================== */

  var SOURCE = '福袋';
  var FLAG_WATCH = 'luckyBagWatch';   // 只读监视（默认开）
  var FLAG_AUTO = 'luckyBagAuto';     // 自动执行下一轮（默认关）
  /* 总闸（2026-11-01 05:31 用户「菜单这里加个开关……只有开了开关，才能有机会
   * 看到子菜单」）：与「页面滚动按钮」的 scrollBtns 完全同一套语义。
   * 缺省当开（`!== false`）—— 老存档里没这个键也要算开。 */
  var FLAG_GATE = 'luckyBag';

  var TICK_MS = 2500;          // 常规拍：开始是分钟级，2.5 秒足够
  var VERIFY_MS = 3000;        // 点完多久内必须看到「进行中」
  var CLICK_LOCK_MS = 2000;    // 点完 2 秒内不重复点
  var CONFIRM_TICKS = 2;       // 「确实没可点了」要连续几拍
  var DRIFT_MS = 5000;         // 平台倒计时与本地预测差超过它就以平台为准
  var STUCK_MS = 90000;        // 预期开始时间过了多久还没结束 = 卡住
  var QUIET_LIMIT_MS = 90000;  // 一直找不到弹窗，多久放弃

  /* ── 悬浮窗刷新 ────────────────────────────────────────────
   * 2026-11-01 用户改口径：**不要插件自己开福袋弹窗** ——
   * 弹窗带遮罩，自动开合会打断直播操作，属于骚扰。
   * 现在只在用户已经开着的弹窗里工作：看不见表格就静默等待，
   * 不打开、不关闭、不播报、不停机。开合窗的代码已整段删除。
   */
  var BADGE_TICK_MS = 1000;    // 悬浮窗刷新（倒计时只要秒级）

  var START_TEXT = '开始活动';                  // 精确相等，不是包含
  /* 状态词（2026-11-01 晚补）：真机抽屉里状态列的写法比截图多，
   * 「待开始」既不含「奖励」也不含「参与」，早期版本会把整行漏掉；
   * 补进来的是**读**用的词，不参与点击，判错也只是少一条播报。 */
  var RE_RUNNING = /进行中|距结束|倒计时|剩余时间|距开奖|开奖中/;
  var RE_DRAWN = /已开奖|已结束|活动结束|已抢完|已完成/;
  /* 「待开始」这类还没跑的行：只用来确认「这一行确实是个活动」 */
  var RE_PENDING = /待开始|未开始|未到时间|预热中/;
  /* 行特征词：一行文字里至少得出现一个，才算活动行。
   * 比旧版多了「待开始 / 已开始 / 距结束」—— 真机里一个还没开始的活动
   * 行可能只有「奖励名 + 参与条件 + 待开始 + 开始活动」，
   * 旧词表靠「开始活动」勉强命中，一旦链接文案变了就整行消失。 */
  var RE_ROWISH = /奖品|中奖|福袋|红包|优惠券|开始活动|进行中|待开始|已开奖|已结束|距结束/;
  /* …………………………………………………………………………………………………………………………
   * 异常词（2026-11-01 用户选「遇异常即停」）
   *
   * 只放**确定的故障词**。因为一旦判错就会把整场开始下一轮停掉，
   * 比不停更麻烦。所以：
   *   · 「已抢完」「已开始」是**正常收尾**，绝不算异常（见 statusOf 里的互斥）；
   *   · ·模棱两可的词（「失败」单独出现）不放，不知道是指开始失败还是发奖失败。 */
  var RE_ERROR = /活动异常|异常状态|审核不通过|审核未通过|未通过审核|奖品不足|库存不足|发放失败|活动已下线|活动已失效|活动失效/;
  /* 绝对时间的痕迹：出现这些就别把行里的 04:32 当成倒计时，
   * 它很可能是「开始时间 12:30」这种时刻。 */
  var RE_ABSOLUTE = /开奖时间|开奖于|\d{1,2}月\d{1,2}日/;
  var RE_WINNERS = /(\d+)\s*人(?:已)?中奖|中奖(?:人数)?[:：]\s*(\d+)/;
  /* 面板锚点（2026-11-01 晚扩容）：真机入口按钮写的是「超级福袋-活动管理」，
   * 抽屉标题未必是截图里那句「管理超级福袋活动」。原来只认那一句，
   * 一旦平台改标题，panelPresent() 就永远 false —— 表现是「读不到、圆钮一直未开始」。
   * 现在认四种写法，任一命中即算在。 */
  var RE_PANEL = /管理超级福袋活动|超级福袋[·\-—\s]*活动管理|福袋活动管理|没有进行中的福袋活动/;
  /* 抽屉里那个搜索框的 placeholder —— 比标题稳（标题常是图片/图标），
   * 只要含「奖励名称 / 活动名称」就算。 */
  var RE_SEARCH_PH = /奖品名称|奖品名|活动名称/;
  /* 卡片上如果直接写着倒计时（mm:ss），用它当真实开始时间；
   * 读不到才退回面板里的固定时长。用户 2026-11-01 选的就是这条。 */
  var RE_MMSS = /(?:距(?:离)?开奖|开奖倒计时|剩余)?\s*(\d{1,2}):([0-5]\d)/;
  /* 带标签的倒计时（优先采信）：距结束 03:12 / 剩余 3分12秒 /
   * 无标签的裸 mm:ss 可能是「开始时间 12:30」，只当兜底 */
  var RE_MMSS_TAG = /(?:距结束|距开奖|距活动结束|剩余|倒计时|开奖倒计时)[^0-9]{0,6}(\d{1,2}):([0-5]\d)/;
  var RE_MSS = /(?:距结束|距开奖|剩余|倒计时)[^0-9]{0,6}(\d{1,3})\s*分\s*(\d{1,2})\s*秒/;


  /* ---------- 悬浮窗落点（2026-11-01 用户定，唯一位置，不再可切）----------
   * 要求原话：「你放在右下角的地方，要位于【上滑到顶按钮】的上方，
   * 不能遮挡上滑按钮的悬浮提示的位置」。
   *
   * 上滑到顶按钮（src/live/back-to-top.js）：right 20px / bottom 116.8px / 52.8×52.8
   *   → 按钮顶边 = 116.8 + 52.8 = 169.6px
   * 它的气泡 `.dyc-tip`：bottom: calc(100% + 10px)，即气泡底边 = 179.6px，
   *   12.5px 字号 + 上下 6px padding，行高 normal ≈ 1.2 → 气泡高约 27px
   *   → 气泡顶边 ≈ 206.6px（按行高 1.5 算也才 210.6px）
   *
   * 卡片底边取 220px：比气泡顶边还高 9~13px，怎么算都不会压住提示。
   * 卡片宽 56（比按钮宽 3.2），right 取 18.4 让两者**中心对齐**成一列
   * （按钮中心 x = W-20-26.4 = W-46.4；卡片要中心同一点 → right = 46.4-28 = 18.4）。
   */
  /* 兜底值 = 按「上滑到顶」按钮的 CSS 原值推出来的结果，不是估的：
   *   按钮 right:20 / 直径 52.8+1px 边框 = 54.8 → 中心距右 20+27.4
   *   圆钮要同心 ⇒ right = 20 - (60-54.8)/2 = 17.4
   *   按钮 bottom:116.8 + 高 54.8 = 顶边 171.6；气泡挂在 +10、高 27
   *   ⇒ 217.6 才不压气泡（= 116.8+54.8+10+27+9），兜底就用这个值
   * 运行时以按钮的**计算样式**为准，这里只在按钮还没出来时兜底。 */
  var BADGE_RIGHT = 17.4;
  var BADGE_BOTTOM = 217.6;
  /* 直径 60（2026-11-01：先 56 被嫌「文字太大、离边框太近」）。
   * 56 时 11px 三字占圆宽 59%、离圆边只剩 4px；改 60 + 10px 后
   * 占 50%，文字底边处弦长 47.2 → 每侧余 8.6px，比例才正常。 */
  var BADGE_SIZE = 60;
  var TIP_H = 27;           // 上滑按钮气泡的高度（12.5px 字 + 上下 6px padding）
  var TIP_GAP = 10;         // 气泡与按钮之间的 10px
  var BADGE_CLEAR = 9;      // 圆钮底边与气泡顶边之间再留的余量
  var FORCE_SHOW_MS = 8000; // 页面就绪判据迟迟不成立时，最多等这么久就露面

  /* ---------- 设置面板的定位约束（2026-11-01 用户：「不能越界不能遮挡
   * 不能跑到屏幕外」）-------------------------------------------------
   * 面板优先弹在圆钮**左侧**（右缘与圆钮右缘同线，底边与圆钮底边同高）；
   * 左边放不下 → 改到圆钮**上方**；上方也放不下 → 改到**下方**；
   * 无论走哪条路，最后都 clamp 进 [8, 视口-面板-8] 的方框里，
   * 所以永远不会出屏。面板自身限高 calc(100vh-16px) 并允许内部滚动，
   * 保证矮窗口里也有整块可见。
   */
  var PANEL_GAP = 8;        // 面板与圆钮之间的间隙
  var PANEL_MARGIN = 8;     // 面板与视口边缘的最小距离

  /* ---------- 确认节拍（2026-11-01 05:0x 用户定）----------------------
   * 滑块 = 「隔多久自己打开一次「超级福袋-活动管理」抽屉，确认有没有福袋在跑」，
   * 3~10 分钟、5 分钟推荐。抽屉读完立刻关，**一分钟最多开一次**。
   *
   * 为什么这条要单独记：它推翻了 11-01 上午「不要插件自己开弹窗」的定，
   * 用户这次的原话是「滑动他意味着，如果没有能自动获取到下轮开始时间的话，
   * 就会自动打开超级福袋自行确认」—— 所以只在**读不到**时开，且只开一瞬。
   */
  var CHECK_KEY = 'dycBagCheckMin';
  /* 「授权」闸已删（2026-11-01 05:42 用户「不需要手动点击一次福袋抽屉才开始
   * 运作福袋倒计时功能，只要开播期间，都按照设定时间去运作」）。
   * 沿革：05:31 加授权闸是防「自己开抽屉太骚扰」；05:42 用户改口 ——
   * 确认节拍就是功能的本体，不该再要一次手动授权。
   * 骚扰控制没有丢，改由三层承担：只在开播期间跑、到点只开一次读完就关、
   * 自动刷新与开始下一轮点按期间绝不开。 */
  var CHECK_MIN = 3;
  var CHECK_MAX = 10;
  var CHECK_DEF = 5;
  var CHECK_REC = 5;
  var CONFIRM_OPEN_WAIT = 1200;   // 点开抽屉后等它渲染
  var CONFIRM_READ_WAIT = 400;    // 面板出来后到读数之间再留一拍
  var CONFIRM_HARD_GAP = 60000;   // 硬上限：一分钟内绝不再开第二次

  /* 抽屉入口文案（真机按钮原文「超级福袋-活动管理」）。
   * 精确相等匹配，避免点到旁边「推荐使用超级福袋」那条运营提示。 */
  var BAG_ENTRY_TEXT = '超级福袋-活动管理';

  /* 开播判据（2026-11-01 05:0x）：
   * 用户要求「只有开播后才生效，未开播不生效，直播结束后停止」。
   * 取不到的写法就退到 unknown，**unknown 一律当在播** —— 宁可多读，
   * 不能因为判不出来把功能整体弄哑（那比不生效更糟）。 */
  var RE_LIVE_ON = /^(结束直播|结束本场直播)$/;
  var RE_LIVE_OFF = /^(开始直播|未开播|直播已结束|已结束直播|本场已结束)$/;

  var REASONS = {
    'no-activity': { short: '已无可用福袋', detail: '已无可用福袋：表格里找不到还能点的「开始活动」。共完成 %N 轮。' },
    'no-effect': { short: '点了没反应，已停止', detail: '第 %N 轮点击「开始活动」后 3 秒内状态没有变成「进行中」。已停止，未重试。' },
    /* closed / no-panel 自 2026-11-01 起不再触发（弹窗由用户自己开，关着就静默等）*/
    'closed': { short: '福袋弹窗已关闭', detail: '连续 2 拍找不到福袋弹窗（你关闭了它 / 平台跳页）。共完成 %N 轮。' },
    'no-panel': { short: '找不到福袋弹窗', detail: '持续 90 秒没找到「管理超级福袋活动」弹窗。共完成 %N 轮。' },
    /* 2026-11-01 重新设计：用户选「遇异常即停」，新增两个入口。
     * draw-timeout 已删 —— 它在删自动开窗时就触发不了了，留着是死代码。 */
    'row-error': { short: '福袋活动异常', detail: '第 %N 轮附近有活动处于异常状态（%T）。已停止，不再继续点击。' },
    'stuck': { short: '活动疑似卡住', detail: '第 %N 轮：预期开始时间已过 90 秒仍未结束，判定卡住。已停止。' },
    'user-takeover': { short: '你手动接管，已停止', detail: '检测到你亲手点了「结束活动」，自动开始下一轮已停止。共完成 %N 轮。' }
  };

  /* ==========================================================
   * 二、状态
   * ========================================================== */

  var phase = 'off';        // off | live | starting | awaiting | stopped
  var lastReason = '';
  var round = 0;

  var flags = { watch: false, auto: false };
  var prevWatch = null;     // 首次拨动的回声靠它（null = 还没读过）
  var prevAuto = false;
  var prevGate = null;      // 总闸上一态（null = 还没读过）

  var seen = {};            // 行键 → { kind, name }   上一拍的状态
  var clicked = {};         // 行键 → 时间戳，点过还没变「进行中」的
  var pendingClick = null;  // { key, at }  等待校验的那一次点击

  var tickTimer = 0;
  var lockUntil = 0;
  var quietSince = 0;
  var noneStreak = 0;

  /* 全自动相关 */
  /* 2026-11-01 重新设计：每行各自记自己的开始时刻。
   * 旧版只有一个全局 drawAt，只在点成功那一拍读一次、
   * 你手动开始的那种根本读不到，因此永远显示「待开始」。
   * 现在：哪行在跑就每拍读哪行；多行并行时取最早开始的那个。 */
  var rowDrawAt = {};       // 行键 → 平台给出的开始时刻（没给 = 无该键）
  var runningSince = {};    // 行键 → 进入「进行中」的时刻
  var errSaid = {};         // 行键 → 异常已播报过（去重，不刷屏）
  var liveRunning = false;  // 本拍有没有活动在跑（圆钮显示「进行中」）
  var drawAt = 0;           // 汇总值 = 所有进行中行里最早的开始时刻；0 = 不知道
  var badgeHost = null;     // 悬浮窗宿主
  var badgeTimer = 0;
  var badgeShadow = null;


  var panelHost = null;
  var panelShadow = null;
  var panelOpen = false;
  var pRefs = null;              // 面板里那几处文字/滑块的引用（只建一次）
  var sliderDrag = false;        // 正在拖滑块：这一拍不许把值刷回去
  var slide = { cur: CHECK_DEF, target: CHECK_DEF, raf: 0, drag: null, rect: null };
  var slideApi = null;           // 自测用的拖动入口（每次建面板时重建）
  var ring = [];

  /* 确认节拍（2026-11-01 05:0x）：滑块值 + 该开的时刻 + 是不是我们开的抽屉 */
  var checkMin = CHECK_DEF;
  var checkLoaded = false;
  var lastConfirmAt = 0;
  var nextConfirmAt = 0;
  var confirmBusy = false;
  var openedByUs = false;        // 只有我们自己开的抽屉才关，用户开着的绝不关
  var confirmStat = '';          // 最近一次确认的结果（诊断用）
  var liveState = 'unknown';     // live | idle | unknown（开播判据）

  /* ==========================================================
   * 三、DOM 工具
   * ========================================================== */

  function text(el) {
    return el && el.textContent != null ? String(el.textContent) : '';
  }

  function tight(s) {
    return String(s == null ? '' : s).replace(/[\s\u00a0\u3000]+/g, '');
  }

  /** 第 23 条：读页面数据必须剔除扩展自己注入的节点 */
  function isExtNode(el) {
    if (!el || el.nodeType !== 1) return true;
    var id = el.id ? String(el.id) : '';
    if (/^(dyc|dyb)[-_]/.test(id)) return true;
    var cls = el.className && typeof el.className === 'string' ? el.className : '';
    if (/(^|\s)(dyc|dyb)[-_]/.test(cls)) return true;
    return false;
  }

  function hasBox(el) {
    if (!el || !el.isConnected) return false;
    var r = el.getBoundingClientRect();
    return r.width >= 1 && r.height >= 1;
  }

  function isLeaf(el) {
    return el && el.children && el.children.length === 0;
  }

  /**
   * 可点判定（AGENTS 第 53 条：不含视口条件 —— 视口只影响「点不点」）
   * 节点在文档 + 真实尺寸 + 没被禁用 + 不是灰字
   */
  function clickable(el) {
    if (!el || !el.isConnected) return false;
    if (!hasBox(el)) return false;
    if (el.disabled) return false;
    if (el.getAttribute && el.getAttribute('aria-disabled') === 'true') return false;
    try {
      if (window.getComputedStyle(el).pointerEvents === 'none') return false;
    } catch (e) { /* 老内核取不到就跳过 */ }
    return !looksGrayed(el);
  }

  /**
   * 灰字判定：平台禁用态怎么表现没采集到，三重兜底。
   * 取不到就返回 false —— 宁可判「能点」，也不要把正常链接误判成禁用
   * （误判禁用会让功能静默不动，比多点一次更难排查）。
   */
  function looksGrayed(el) {
    try {
      var cs = window.getComputedStyle(el);
      if (cs.cursor === 'not-allowed') return true;
      var m = /rgba?\((\d+)\s*,\s*(\d+)\s*,\s*(\d+)/.exec(cs.color || '');
      if (m) {
        var r = +m[1], g = +m[2], b = +m[3];
        var spread = Math.max(Math.abs(r - g), Math.abs(g - b), Math.abs(r - b));
        // 三通道几乎相等且落在中灰区间 = 置灰
        if (spread <= 6 && r >= 150 && r <= 215) return true;
      }
    } catch (e) { /* 忽略 */ }
    return false;
  }

  /** 文本完全相等的叶子（不是包含）。只认 a/button/span 这类短文本节点 */
  function findExactLeaf(root, target, limit) {
    var out = [];
    if (!root || !root.querySelectorAll) return out;
    var all = root.querySelectorAll('a, button, span, div, p, em, i, label');
    for (var i = 0; i < all.length; i++) {
      if (out.length >= (limit || 20)) break;
      var el = all[i];
      if (!isLeaf(el)) continue;
      if (isExtNode(el)) continue;
      if (tight(text(el)) !== target) continue;
      if (!hasBox(el)) continue;
      out.push(hitTarget(el, target));
    }
    return out;
  }

  /**
   * 把命中的叶子换成**同文案的外层可点节点**。
   *
   * 为什么需要（2026-11-01 晚）：真机文字链常常是
   * `<a><span>开始活动</span></a>` 或 `<div><span>开始活动</span></div>`，
   * 框架把事件绑在外层。派发到内层 span 上一般也能冒泡到，但一旦平台
   * 在 span 上写了 `pointer-events:none`（置灰的常见做法），
   * 内层就「点不动」，而外层其实是好的 —— 会误判成「不可点」。
   * 只向上找最多 3 层、且要求整块文字**仍然完全相等**，所以不会跑到
   * 整个表格或列表上去。
   */
  function hitTarget(el, target) {
    var p = el;
    for (var i = 0; i < 3; i++) {
      /* 已经是按钮/链接就别再往上爬。
       * 2026-11-01 05:0x 实撞的坑：入口 <button>超级福袋-活动管理</button>
       * 外面套了一层同样文案的 <div>，一路爬到 div 之后，
       * 派发的 click 落在 div 上、**冒不到里面的 button**，
       * 于是「点了入口但抽屉没开」。 */
      if (isClickableTag(p)) break;
      var up = p.parentElement;
      if (!up || up === document.body) break;
      if (isExtNode(up)) break;
      if (tight(text(up)) !== target) break;
      if (!hasBox(up)) break;
      p = up;
    }
    return p;
  }

  /** 标签本身就是可点控件（按钮 / 链接 / role=button|link） */
  function isClickableTag(el) {
    if (!el || !el.tagName) return false;
    var tag = el.tagName;
    if (tag === 'BUTTON' || tag === 'A') return true;
    var r = el.getAttribute && el.getAttribute('role');
    return r === 'button' || r === 'link';
  }

  /** 某个容器里「文本完全等于 target」的叶子有几个（判「一行里只有一个」用） */
  function countExact(root, target) {
    var n = 0;
    if (!root || !root.querySelectorAll) return 0;
    var all = root.querySelectorAll('a, button, span, div, p, em, i, label');
    for (var i = 0; i < all.length; i++) {
      var el = all[i];
      if (!isLeaf(el) || isExtNode(el)) continue;
      if (tight(text(el)) !== target) continue;
      n++;
      if (n > 8) break;      // 只要判断「是不是唯一」，数到 2 就够
    }
    return n;
  }

  function findLeafByRe(root, re) {
    if (!root || !root.querySelectorAll) return null;
    var all = root.querySelectorAll('div, span, p, h1, h2, h3, h4, label, td, th');
    for (var i = 0; i < all.length; i++) {
      var el = all[i];
      if (!isLeaf(el)) continue;
      if (isExtNode(el)) continue;
      var t = text(el);
      if (t.length > 60) continue;
      if (!re.test(t)) continue;
      if (!hasBox(el)) continue;
      return el;
    }
    return null;
  }

  /** 从链接向上找行容器。拿不到就 null —— 调用方据此放弃点击（安全阀） */
  function rowOf(el) {
    var p = el;
    for (var i = 0; i < 16 && p && p !== document.body; i++) {
      if (p.tagName === 'TR') return p;
      if (p.getAttribute && p.getAttribute('role') === 'row') return p;
      p = p.parentElement;
    }
    return rowOfDiv(el);
  }

  /**
   * 表格是 div 模拟时的行容器。
   *
   * 与旧版的差别（2026-11-01 晚）：**必须确认「整块里只有一个『开始活动』」**。
   * 旧版只按字数挑祖先，一旦平台把表格做成 div 列表，
   * 它会一路走到整张列表上 —— 于是 8 个活动被当成 1 行，
   * 自动执行下一轮照这「一行」的第一条链接去点，点错活动。
   * 「复制」同样是每行一个，一并当第二道尺子。
   */
  function rowOfDiv(el) {
    var p = el;
    var fallback = null;
    for (var j = 0; j < 8 && p && p !== document.body; j++) {
      p = p.parentElement;
      if (!p) break;
      var t = tight(text(p));
      if (t.length > 900) break;
      if (/^奖品信息/.test(t) && /活动状态/.test(t)) break;
      if (countExact(p, START_TEXT) > 1) break;
      if (countExact(p, '复制') > 1) break;
      /* 第三道尺子（2026-11-01 晚补）：**状态词只许有一个**。
       * 前两道只管得住「待开始」的行 —— 一个列表里如果只有一行待开始，
       * 另外几行都是「进行中 / 已结束」，前两道都拦不住，会一路走到列表上，
       * 于是整张列表被当成一行（自测 ㊥③ 就是这么炸的）。 */
      if (countStatusLeaves(p) > 1) break;
      if (t.length >= 12) fallback = p;
    }
    return fallback;
  }

  /** 容器里有几个「短状态词」叶子（待开始 / 进行中 / 已结束…）—— 一行的标志 */
  function countStatusLeaves(root) {
    if (!root || !root.querySelectorAll) return 0;
    var all = root.querySelectorAll('div, span, p, em, i, b, strong');
    var n = 0;
    for (var i = 0; i < all.length; i++) {
      var el = all[i];
      if (!isLeaf(el) || isExtNode(el)) continue;
      var t = tight(text(el));
      if (!t || t.length > 14) continue;
      if (!(RE_RUNNING.test(t) || RE_DRAWN.test(t) || RE_PENDING.test(t))) continue;
      if (++n > 4) return n;
    }
    return n;
  }

  /** 奖项名：行文本首段（「10元店铺红包 ID」→「10元店铺红包」） */
  function prizeOf(row) {
    if (!row) return '';
    var t = text(row).replace(/[\s\u00a0\u3000]+/g, ' ').trim();
    var m = /^([^\s]{2,24}?)\s*(?:ID|id|奖励来源)/.exec(t);
    if (m) return m[1].trim();
    m = /^(.{2,18}?)(?:\s|$)/.exec(t);
    return m ? m[1].trim() : '';
  }

  /** 行键：优先奖励名（状态变化时它不变），兜底首 24 字 */
  function keyOf(row) {
    if (!row) return '';
    var p = prizeOf(row);
    if (p) return p;
    return tight(text(row)).slice(0, 24);
  }

  /* ==========================================================
   * 四、扫描与状态判定
   * ========================================================== */

  /**
   * 扫出所有活动行。
   *
   * 三条来源，**依次补齐而不是二选一**（2026-11-01 晚重写）：
   *   ① 语义表格行（tr / role=row）—— 真机抽屉里就是这套；
   *   ② 「开始活动」链接所在的行 —— 表格换成 div 列表时只剩这条能兜住待开始的行；
   *   ③ ② 那些行的**同级兄弟** —— 「进行中 / 已结束」的行里没有「开始活动」，
   *      ① 收不到时（div 布局）只能靠它与已知行同父同标签这一点认出来。
   *      不补 ③ 就永远看不见「进行中 → 已开始」，等于开始播报全哑。
   *
   * 旧版这里是 `if (!out.length)`：只要扫到一行 tr 就再不看链接——
   * 于是「表里一半行是 div、一半是 tr」这种混排会漏掉一半。
   */
  function scanRows() {
    var out = [];
    var seenSet = [];

    function push(el) {
      if (!el || el.nodeType !== 1) return;
      if (isExtNode(el)) return;
      if (seenSet.indexOf(el) >= 0) return;
      if (!hasBox(el)) return;
      var t = tight(text(el));
      if (t.length < 6 || t.length > 1200) return;
      // 表头：四列标题连在一起、且没有「开始活动/进行中」
      if (/^奖品信息中奖信息中奖条件活动状态/.test(t)) return;
      if (!RE_ROWISH.test(t)) return;
      seenSet.push(el);
      out.push(el);
    }

    var trs = document.querySelectorAll('tr, [role="row"]');
    for (var i = 0; i < trs.length; i++) push(trs[i]);

    /* 什么情况下才去全页找文字链：
     *   ① 一条 tr 都没扫到（表格被做成 div 列表 —— 真机另一种可能）；
     *   ② 扫到的行里一个「开始活动」都没有（说明链接不在这些行里）。
     * 不无条件扫的理由：全页找文字链要遍历上千个节点，
     * 真机 4193 个节点实测 8~15ms/次，每 2.5 秒一次纯属浪费 ——
     * 表格正常时走 ① 之外的路径完全够用。 */
    var hasLink = false;
    for (var q = 0; q < out.length && !hasLink; q++) {
      if (findExactLeaf(out[q], START_TEXT, 1).length) hasLink = true;
    }
    if (!out.length || !hasLink) {
      var links = findExactLeaf(document.body, START_TEXT, 12);
      var linkRows = [];
      for (var k = 0; k < links.length; k++) {
        var r = rowOf(links[k]);
        if (!r) continue;
        if (linkRows.indexOf(r) < 0) linkRows.push(r);
        push(r);
      }

      /* ③ 同级兄弟行：「进行中 / 已结束」的行里没有「开始活动」，
       * 与已知行同父同标签是唯一能认出它们的线索。不补这条，
       * 「进行中 → 已开始」永远看不到，开始播报整段哑掉。 */
      for (var m = 0; m < linkRows.length; m++) {
        var par = linkRows[m].parentElement;
        if (!par || par === document.body) continue;
        if (par.children.length > 60) continue;      // 列表容器兜底：太长就别扫了
        for (var n = 0; n < par.children.length; n++) {
          var sib = par.children[n];
          if (sib.tagName !== linkRows[m].tagName) continue;
          push(sib);
        }
      }
    }
    return out;
  }

  /**
   * 单行状态：pending / running / drawn / unknown
   * 顺序很重要 —— 先判「进行中」再判「已结束」，因为进行中的行里
   * 也可能出现「距结束」与「已开始 N 人」历史文案。
   */
  function statusOf(row) {
    var t = tight(text(row));
    var drawn = RE_DRAWN.test(t);
    /* 异常在最前判，但与 drawn 互斥：一行同时写「已结束」与「异常」时按正常收尾算——
     * 宁可漏判一次，也不能因为历史行残留的异常字样把整场停掉。 */
    if (!drawn && RE_ERROR.test(t)) return { kind: 'error' };
    var running = RE_RUNNING.test(t);

    if (running && !drawn) return { kind: 'running' };
    if (drawn) return { kind: 'drawn' };

    var links = findExactLeaf(row, START_TEXT, 3);
    for (var i = 0; i < links.length; i++) {
      if (clickable(links[i])) return { kind: 'pending', link: links[i] };
    }
    if (links.length) return { kind: 'pending', link: null };   // 有链接但点不动
    /* 只有「待开始」字样、链接此刻灰着：仍算待开始。
     * 掉进 unknown 就等于这行不存在 —— 自动执行下一轮永远看不到它。 */
    if (RE_PENDING.test(t)) return { kind: 'pending', link: null };
    return { kind: 'unknown' };
  }

  function winnersOf(row) {
    if (!row) return 0;
    var m = RE_WINNERS.exec(text(row));
    if (!m) return 0;
    var n = +(m[1] || m[2] || 0);
    return n > 0 ? n : 0;
  }

  /**
   * 抽屉/弹窗到底在不在 —— 并回一句「靠什么认出来的」。
   *
   * 旧版只回 true/false，于是诊断报告里「现场 panel=false」有两种完全不同的
   * 含义分不开：① 用户把抽屉关了（正常，功能就该什么都不做）；
   * ② 抽屉开着但锚点全不对（真 bug，得改选择器）。
   * 2026-11-01 晚用户报「发了福袋没反应」，就是被这个歧义卡住的 ——
   * 从此这里必须交代「靠哪个锚点认出来的」，认不出也把线索带出去。
   */
  /**
   * 「抽屉是不是开着」的轻量判据（只查输入框的 placeholder）。
   *
   * 为什么单独抽一个：这个值每一拍都要算，还得交给「小黄车自动刷新」决定
   * 这一轮要不要让路（见 bagYieldToRefresh）。完整的 panelInfo() 里还有一次
   * 全页文字扫描，每 2.5 秒跑一次不值当；而抽屉里的搜索框是**只在抽屉里**才有的，
   * 用它当判据既准又便宜。
   */
  function isDrawerOpenFast() {
    var ins = document.querySelectorAll('input[placeholder]');
    for (var i = 0; i < ins.length; i++) {
      var el = ins[i];
      if (isExtNode(el) || !hasBox(el)) continue;
      var ph = String(el.getAttribute('placeholder') || '');
      if (ph && RE_SEARCH_PH.test(ph)) return true;
    }
    return false;
  }

  /**
   * 告诉「小黄车自动刷新」：福袋抽屉正开着 / 正被我们读数，这一轮别刷。
   *
   * 用户 2026-11-01 05:22 原话：「打开抽屉的时候，自动刷新可以让步不刷新。不然会冲突。」
   * 冲突是双向的：刷新会（a）派一套合成 pointerdown/up/click —— 可能点穿到抽屉上；
   * （b）重排列表 —— 我们刚读到的行、刚算出的倒计时会跟着失效。
   * 所以两个信号都给出去，刷新侧任一命中就顺延 600ms（松手/关抽屉后自动补上）。
   */
  function markBagBusy(ms) {
    try {
      window.__dycBagBusyUntil = ms > 0 ? Date.now() + ms : 0;
      window.__dycBagPanelOpen = isDrawerOpenFast();
    } catch (e) { /* 挂不上变量不影响主流程 */ }
  }

  function panelInfo() {
    var out = { open: false, by: '', searchPh: '', startLinks: 0 };

    var ins = document.querySelectorAll('input[placeholder]');
    for (var i = 0; i < ins.length; i++) {
      var el = ins[i];
      if (isExtNode(el) || !hasBox(el)) continue;
      var ph = String(el.getAttribute('placeholder') || '');
      if (!ph || !RE_SEARCH_PH.test(ph)) continue;
      out.open = true;
      out.by = '搜索框';
      out.searchPh = ph;
      break;
    }

    if (!out.open) {
      var leaf = findLeafByRe(document.body, RE_PANEL);
      /* 入口按钮自己也写着「超级福袋-活动管理」—— 那是门，不是抽屉。
       * 认成「抽屉已开」的后果很重：确认节拍会以为你开着，从此一次都不开。 */
      if (leaf && isClickableTag(leaf)) leaf = null;
      if (leaf) {
        out.open = true;
        out.by = '标题「' + tight(text(leaf)).slice(0, 14) + '」';
      }
    }

    /* 「开始活动」只存在于活动行里 —— 它在页面上，就是抽屉开着的最硬证据。
     * 顺便把条数带出去当诊断读数（0 = 没有可点的活动）。 */
    out.startLinks = findExactLeaf(document.body, START_TEXT, 12).length;
    if (!out.open && out.startLinks) {
      out.open = true;
      out.by = '活动行链接';
    }
    return out;
  }

  /** 旧接口：只问在不在 */
  function panelPresent() {
    return panelInfo().open;
  }

  /* ==========================================================
   * 四·五、开播判据 + 确认节拍（2026-11-01 05:0x 新增）
   * ========================================================== */

  /**
   * 现在在不在播。
   *
   * 用户口径：「按钮只有在开播后才会生效。未开播不生效。直播结束后也会停止
   * 不再获取信息。」⇒ 必须有一条判据。
   *
   * 判据只用**文案**（不认类名）：
   *   · 有「结束直播」→ 正在播；这是中控台唯一只在直播中出现的主按钮。
   *   · 有「开始直播 / 未开播 / 直播已结束」→ 没在播（开播前、下播后）。
   *   · 两组都没有 → unknown。
   *
   * **unknown 一律按「在播」处理**：判不出来就少管一档，不能把功能整体弄哑
   * （那用户会以为坏了）。这条与「先保证不误伤」的取向一致 ——
   * 真实代价只是「没开播时多读几眼」，可接受。
   */
  function livePhase() {
    var on = false;
    var off = false;
    var all = document.querySelectorAll('button, a, span, div');
    for (var i = 0; i < all.length; i++) {
      var el = all[i];
      if (!isLeaf(el) || isExtNode(el)) continue;
      var t = tight(text(el));
      if (!t || t.length > 10) continue;
      if (RE_LIVE_ON.test(t)) { on = true; break; }
      if (RE_LIVE_OFF.test(t)) { off = true; }
    }
    if (on) return 'live';
    if (off) return 'idle';
    return 'unknown';
  }

  /** 未开播 / 已下播：圆钮不露脸、不读数（露脸逻辑由 applyBadgeReveal 统一管） */
  /**
   * 现在是否被平台浮层盖住（弹窗 / 抽屉 / 下拉面板）。
   *
   * 用户 2026-11-01 05:29：「福袋按钮不应该在各种抽屉框中浮在最上层」。
   * 判据不在本文件里重复实现 —— 直接问 `overlay-guard`（那是全工程唯一真源，
   * 上滑/下滑/搜索/指示灯/讲解胶囊都用它）。返回 false 的三种情况都必须
   * **不隐藏**：guard 不在场、浮层让位开关被关掉、自己量不到尺寸。
   *
   * 为什么不自已 bind() 给 guard、而要在这里问：
   *   本模块自己有一套 visibility 状态机（未开播、进页面骨架屏、开播后再露脸）。
   *   两套都写同一个 style.visibility 会互相「揭开」——比如浮层还开着、
   *   这边一拍「该露脸了」就把它又显示出来。所以 visibility 只由一个主人管，
   *   guard 只提供判据。
   */
  function coveredByOverlay() {
    try {
      var g = window.dycOverlayGuard;
      if (!g || typeof g.covers !== 'function') return false;
      if (typeof g.enabled === 'function' && !g.enabled()) return false;
      if (!badgeHost) return false;
      var r = badgeHost.getBoundingClientRect();
      if (!r || !(r.width > 0) || !(r.height > 0)) return false;
      /* 0.2 而不是默认 0.35：圆钮只有 60px，被抽屉压掉 1/5 就已经明显「浮在上面」了 */
      return !!g.covers(r, 0.2);
    } catch (e) { return false; }
  }

  var badgeCovered = false;      // 上一拍是否因浮层而藏了（用来判断要不要「掀开」）

  function applyLiveGate() {
    if (!badgeHost) return;
    if (liveState === 'idle') {
      badgeHost.style.visibility = 'hidden';
      badgeReadyShown = false;      // 再开播时要重新走一次「就绪才露脸」
      badgeCovered = false;
      drawAt = 0;
      liveRunning = false;
      return;
    }
    /* 浮层盖住了就藏起来，浮层关掉再露 —— 与「上滑到顶」等控件同一口径。
     * 另外把「福袋抽屉自己开着」也算作浮层：那种情况下圆钮同样压在抽屉上。 */
    if (coveredByOverlay() || isDrawerOpenFast()) {
      badgeHost.style.visibility = 'hidden';
      badgeCovered = true;
      return;
    }
    if (badgeCovered) {
      badgeCovered = false;
      badgeHost.style.visibility = 'visible';
      lastPosKey = '';              // 露回来时顺手校一次坐标
    }
    applyBadgeReveal();
  }

  /**
   * 到点就自己打开抽屉确认一次。
   *
   * 只在三种情况下开：
   *   ① 监视开着、且当前判据不是「已下播」；
   *   ② 抽屉没被你开着（你开着我就不动，免得跟你抢）；
   *   ③ 距上次确认 ≥ 滑块值（硬上限一分钟）；
   * 开完读一轮、**1.2 秒内关掉**，只有我们自己开的才关。
   */
  function maybeConfirm() {
    if (!flags.watch) return;
    if (liveState === 'idle') return;
    if (confirmBusy) return;
    /* 自动执行下一轮正在点「开始活动」/等校验结果的那几秒，绝不去开抽屉 ——
     * 打开抽屉会改变列表渲染，把校验拍搅乱（会误判成「点了没反应」）。 */
    if (phase === 'starting' || pendingClick) return;
    var now = Date.now();
    /* 两个「该开了」的理由，取更早的那个：
     *   ① 常规节拍 —— 距上次确认满滑块值（每 N 分钟确认一次）；
     *   ② 倒计时已走到 0 —— 开始就在刚才，这时候才最需要看一眼结果，
     *      不能傻等到下一个 N 分钟。
     * 两者都受「一小时内最多一次」的硬上限约束。 */
    var due = nextConfirmAt;
    if (drawAt && now >= drawAt + 3000) due = now;
    if (now < due) return;
    if (lastConfirmAt && now - lastConfirmAt < CONFIRM_HARD_GAP) return;
    if (panelInfo().open) {              // 你已经开着：直接用当前读数，不重开
      lastConfirmAt = now;
      nextConfirmAt = now + checkMin * 60000;
      return;
    }
    var entry = bagEntry();
    if (!entry) {                        // 找不到入口就退避一分钟，别每拍猛找
      confirmStat = '没找到「' + BAG_ENTRY_TEXT + '」入口';
      nextConfirmAt = now + CONFIRM_HARD_GAP;
      return;
    }
    confirmBusy = true;
    openedByUs = true;
    lastConfirmAt = now;
    /* 从现在起到读完关掉，自动刷新一律让路（时长 = 开抽屉 + 读数 + 关闭动画的余量） */
    try {
      window.__dycBagBusyUntil = now + CONFIRM_OPEN_WAIT + CONFIRM_READ_WAIT + 900;
      window.__dycBagPanelOpen = true;
    } catch (e0) {}
    nextConfirmAt = now + Math.max(CONFIRM_HARD_GAP, checkMin * 60000);
    /* 用 fireClickOnly 而不是 fireClick：后者会顺带找「确定」确认框，
     * 抽屉里若有「确定」按钮（创建活动表单），会被误点。 */
    try { fireClickOnly(entry); confirmStat = '已开抽屉'; }
    catch (e) { confirmStat = '点入口失败'; }

    setTimeout(function () {
      // 抽屉渲染有延迟，再等一拍读状态；读完立刻关（只关自己开的）
      /* 这里**直接跑一整拍 tick**，而不是只数行数：
       * 倒计时/在跑标记都由 tick 写进状态，只数行数的话读到的信息
       * 会在 1.2 秒后关抽屉时全部作废（下一拍既看不见表格、也没有新读数）。
       * confirmBusy 此时为 true，tick 里再进 maybeConfirm 会被自己挡掉。 */
      try {
        tick();
        var rows = scanRows();
        confirmStat = rows.length ? ('读到 ' + rows.length + ' 行' + (drawAt ? '，倒计时已更新' : ''))
          : '抽屉里没读到活动行';
      } catch (e2) { confirmStat = '读数失败'; }
      closeBagPanel();
      confirmBusy = false;
      markBagBusy(600);            // 关闭动画期间的余量，之后按真实状态走
      note('确认节拍｜' + confirmStat + '｜间隔 ' + checkMin + ' 分钟');
      paintBadge();
    }, CONFIRM_OPEN_WAIT + CONFIRM_READ_WAIT);
  }

  /** 抽屉入口按钮（文案完全相等，且可点） */
  function bagEntry() {
    var list = findExactLeaf(document.body, BAG_ENTRY_TEXT, 3);
    for (var i = 0; i < list.length; i++) {
      if (clickable(list[i])) return list[i];
    }
    return null;
  }

  /**
   * 关上我们自己开的抽屉。
   * 先发 Esc（平台抽屉的通用关闭键），200ms 后还在才去找关闭按钮。
   * 关不掉就留着 —— 不危险，只是挡视线，下一轮还会再试。
   */
  function closeBagPanel() {
    if (!openedByUs) return;
    openedByUs = false;
    try { dispatchEsc(); } catch (e) {}
    setTimeout(function () {
      if (!panelInfo().open) return;
      var closer = findCloseButton();
      if (closer) { try { fireClickOnly(closer); } catch (e) {} }
      setTimeout(function () {
        if (panelInfo().open) confirmStat += '（没关掉）';
      }, 300);
    }, 200);
  }

  function dispatchEsc() {
    var opt = { key: 'Escape', code: 'Escape', keyCode: 27, which: 27, bubbles: true, cancelable: true };
    var tgt = document.activeElement && document.activeElement !== document.body
      ? document.activeElement : document.body;
    ['keydown', 'keyup'].forEach(function (type) {
      try { tgt.dispatchEvent(new KeyboardEvent(type, opt)); } catch (e) {}
    });
  }

  /** 抽屉上的关闭按钮：只认文案 / aria-label，不认哈希类名 */
  function findCloseButton() {
    var all = document.querySelectorAll('button, [role="button"]');
    for (var i = 0; i < all.length; i++) {
      var el = all[i];
      if (isExtNode(el) || !hasBox(el)) continue;
      var t = tight(text(el)) || String(el.getAttribute('aria-label') || '');
      if (t === '关闭' || t === '取消' || t === 'Close') return el;
    }
    return null;
  }

  /** 读滑块值（存 chrome.storage.local，跟自动循环讲解同一套长久记忆） */
  function loadCheckMin() {
    try {
      if (!(window.chrome && chrome.storage && chrome.storage.local)) { checkLoaded = true; return; }
      chrome.storage.local.get(CHECK_KEY, function (r) {
        var v = r && r[CHECK_KEY];
        if (typeof v === 'number' && isFinite(v)) checkMin = clampCheck(v);
        checkLoaded = true;
        nextConfirmAt = Date.now() + checkMin * 60000;
        paintPanel();
      });
    } catch (e) { checkLoaded = true; }
  }

  function saveCheckMin(v) {
    checkMin = clampCheck(v);
    nextConfirmAt = Date.now() + checkMin * 60000;
    try {
      var obj = {};
      obj[CHECK_KEY] = checkMin;
      chrome.storage.local.set(obj);
    } catch (e) { /* 存不上就只在本页生效，不影响读数 */ }
  }

  function clampCheck(v) {
    v = Math.round(Number(v) || CHECK_DEF);
    return Math.min(CHECK_MAX, Math.max(CHECK_MIN, v));
  }

  /* ==========================================================
   * 五、主循环
   * ========================================================== */

  function tick() {
    if (phase === 'off' || phase === 'stopped') return;
    if (document.hidden) return;          // 后台标签页不动作，恢复可见会补拍

    /* ---- 开播判据 + 确认节拍（2026-11-01 05:0x）----
     * 未开播 / 已下播 ⇒ 什么都不做（用户：「未开播不生效」。下播后同样停）。
     * 在播 ⇒ 到点自己开一次抽屉确认；这一步在「有没有行」之前，
     * 因为看不见表格时正是最需要确认的时候。 */
    liveState = livePhase();
    /* 每拍把「抽屉现在开着没」公布给自动刷新（轻量判据，见 isDrawerOpenFast）。
     * 用户 05:22：「打开抽屉的时候，自动刷新可以让步不刷新。不然会冲突。」 */
    try { window.__dycBagPanelOpen = isDrawerOpenFast(); } catch (e0) {}
    applyLiveGate();
    if (liveState === 'idle') {
      quietSince = 0;
      noneStreak = 0;
      liveRunning = false;
      drawAt = 0;
      return;
    }
    maybeConfirm();

    var rows = scanRows();

    /* ---- 弹窗/表格都不在 ----
     * 用户 2026-11-01 明确：**不要自己开窗**（会打断直播操作，太骚扰）。
     * 所以这里只静默等待 —— 不打开、不播报、不停机、不打日志。
     * 弹窗由用户自己开；他不开的那段时间，本功能什么也不做。
     * 悬浮窗会显示「未开始」提示他去开，这是唯一的提示渠道。 */
    if (!rows.length) {
      quietSince = 0;
      noneStreak = 0;
      liveRunning = false;   // 看不见表格，不能再声称「进行中」
      return;
    }
    quietSince = 0;

    /* ---- 校验上一次点击 ---- */
    if (pendingClick) {
      var prow = findRowByKey(pendingClick.key);
      var pst = prow ? statusOf(prow) : { kind: 'unknown' };
      if (pst.kind === 'running') {
        pendingClick = null;
        round += 1;
        sayStart(false);
        // 开始时刻不在这里预设：交给下面「逐行扫描」的 running 分支每拍校准。
        // 读不到就是读不到，不编数字（2026-11-01 重新设计）。
        phase = 'live';              // 从 starting 复位（悬浮窗不再有「开启中」这种态）
        paintPanel();
        paintBadge();
        // 注意：这里**不关窗** —— 弹窗是用户自己开的，插件不动它。
      } else if (Date.now() - pendingClick.at > VERIFY_MS) {
        pendingClick = null;
        doStop('no-effect');
        return;
      }
    }

    /* ---- 逐行比对状态迁移 ---- */
    var pendingCand = null;
    var anyRunning = false;
    var anyPending = false;
    var anyRunningNow = false;
    var errRowKey = '';
    var errRowText = '';

    for (var i = 0; i < rows.length; i++) {
      var row = rows[i];
      var key = keyOf(row);
      if (!key) continue;
      var st = statusOf(row);
      var prev = seen[key] || { kind: 'unknown' };

      /* ① 异常行：只记下来，循环后统一处理。
       * 异常行不参与「可点候选」竞争，也不当成进行中。 */
      if (st.kind === 'error') {
        if (!errRowKey) { errRowKey = key; errRowText = prizeOf(row) || '未知活动'; }
        continue;
      }

      if (st.kind === 'running') {
        anyRunning = true;
        anyRunningNow = true;
        if (!runningSince[key]) runningSince[key] = Date.now();
        /* 每拍重新读平台倒计时（旧版只在点成功那一拍读一次，
         * 之后纯本地推算 —— 平台延长或重置就漂）。读不到 = 0，不编数字。 */
        var calc = computeDrawAt(row);
        if (calc && Math.abs((rowDrawAt[key] || 0) - calc) > DRIFT_MS) {
          rowDrawAt[key] = calc;
          paintBadge();
        }
      }
      if (st.kind === 'pending' || st.kind === 'running') anyPending = true;

      // ① 进行中 → 已结束：开始，播报参与人数
      if (prev.kind === 'running' && st.kind === 'drawn') {
        sayDraw(winnersOf(row), prizeOf(row));
        delete clicked[key];
        delete rowDrawAt[key];   // 这一轮的计时结束
        delete runningSince[key];
        paintBadge();
      }

      // ② 待开始 → 进行中：别人（或我们）刚点的，补一条开始回声
      if (prev.kind === 'pending' && st.kind === 'running') {
        // 我们点的已经在 pendingClick 校验里报过，这里只报别人点的
        if (!clicked[key]) sayStart(true, prizeOf(row));
        delete clicked[key];
      }

      seen[key] = { kind: st.kind };

      // ③ 待开始且可点：记为本拍候选
      if (st.kind === 'pending' && st.link && !clicked[key]) {
        if (!pendingCand) pendingCand = { row: row, key: key, link: st.link };
      }
    }

    // 清理已经消失的行（防止内存里攒一堆旧键）
    for (var k in seen) {
      if (!Object.prototype.hasOwnProperty.call(seen, k)) continue;
      if (!seen[k].alive) seen[k].alive = false;
    }
    for (var m = 0; m < rows.length; m++) {
      var kk = keyOf(rows[m]);
      if (kk && seen[kk]) seen[kk].alive = true;
    }
    for (var kk2 in seen) {
      if (seen[kk2] && seen[kk2].alive === false) delete seen[kk2];
    }

    /* ---- 汇总本轮预计开始时刻：多行并行时取最早的那个 ---- */
    liveRunning = anyRunningNow;
    var earliest = 0;
    for (var rk in rowDrawAt) {
      if (!Object.prototype.hasOwnProperty.call(rowDrawAt, rk)) continue;
      if (!rowDrawAt[rk]) continue;
      if (!earliest || rowDrawAt[rk] < earliest) earliest = rowDrawAt[rk];
    }
    if (earliest !== drawAt) {
      drawAt = earliest;
      paintBadge();
    }

    /* ---- 异常行（2026-11-01 用户定「遇异常即停」）----
     * 监视模式只播报（没有写动作可停）；自动执行下一轮模式立即停。 */
    if (errRowKey && flags.watch) {
      if (!errSaid[errRowKey]) {
        errSaid[errRowKey] = true;
        sayRowError(errRowText);
      }
      if (flags.auto) { doStop('row-error', errRowText); return; }
    }

    /* ---- 卡死：**只对平台给过倒计时的行**判 ----
     * 读不到时间的行绝不猜（用户定「读不到只显示进行中」）——
     * 拿面板填的 5 分钟去卡一个 10 分钟的活动，会把正常的场停掉。 */
    if (flags.auto && anyRunningNow) {
      var nowT = Date.now();
      for (var sk in runningSince) {
        if (!Object.prototype.hasOwnProperty.call(runningSince, sk)) continue;
        var expect = rowDrawAt[sk];
        if (!expect) continue;
        if (nowT > expect + STUCK_MS) { doStop('stuck'); return; }
      }
    }

    /* ---- 自动执行下一轮：点候选 ---- */
    if (flags.auto && pendingCand && !pendingClick) {
      if (Date.now() < lockUntil) return;
      if (!clickable(pendingCand.link)) return;
      clickStart(pendingCand);
      return;
    }

    /* ---- 无可点判定（只在自动执行下一轮模式下停机） ---- */
    if (flags.auto) {
      if (!anyPending && !anyRunning) {
        noneStreak += 1;
        if (noneStreak >= CONFIRM_TICKS) doStop('no-activity');
      } else {
        noneStreak = 0;
      }
    }
  }

  /* ==========================================================
   * 开合弹窗（全自动）
   * ----------------------------------------------------------
   * 为什么必须开合：「管理超级福袋活动」是带遮罩的整块 modal，
   * 开着的时候中控台其余部分点不了。全自动要跑几小时，
   * 一直开着等于这段时间用户没法用中控台。
   *
   * 开：点「直播工具」区里文案**精确等于**「超级福袋」的卡片。
   *     顶部那条「推荐使用超级福袋」是包含关系，不会命中（精确匹配）。
   * 关：先发 Esc（平台 modal 的通用关闭键），260ms 后还在才去找
   *     对话框内的关闭按钮。关不掉就留着 —— 不危险，只是挡视线。
   * ========================================================== */

  /* 开始时刻。**读不到就返回 0**，不编一个数出来。
   *
   * 2026-11-01 重新设计（用户：卡片没给时间就「只显示进行中」）：
   * 旧版读不到就拿面板固定值当倒计时，画面上看起来和真实剩余时间
   * 一模一样，但那个数字跟平台毫无关系——宁可不给，也不能给错的。
   *
   * 三级来源：① 带标签的倒计时（距结束 03:12 / 剩余 3分12秒，直接采信）
   * ② 裸 mm:ss —— **只有这一行确实在跑**（有「进行中/距结束」）才采信，
   * 否则抽屉里「开始时间 12:30」这类时刻会被读成 12 分 30 秒；
   * ③ 都没有 → 0（不编数字）。
   * 调用时机也改了：**每一拍都读**，不再只在点开始成功那一拍读一次。 */
  function computeDrawAt(row) {
    if (!row) return 0;
    var t = text(row);
    if (RE_ABSOLUTE.test(t)) return 0;

    var ms = 0;
    var m = RE_MMSS_TAG.exec(t);
    if (m) ms = mmssMs(m);
    if (!ms) {
      m = RE_MSS.exec(t);
      if (m) ms = parseInt(m[1], 10) * 60000 + parseInt(m[2], 10) * 1000;
    }
    if (!ms && RE_RUNNING.test(t)) {
      m = RE_MMSS.exec(t);
      if (m) ms = mmssMs(m);
    }
    if (ms < 60000 || ms > 30 * 60000) return 0;
    return Date.now() + ms;
  }

  function mmssMs(m) {
    return parseInt(m[1], 10) * 60000 + parseInt(m[2], 10) * 1000;
  }

  /** 毫秒 → mm:ss（超过 1 小时就显示 h:mm:ss，虽然福袋不会有） */
  function fmtMs(ms) {
    if (!ms || ms < 0) ms = 0;
    var s = Math.floor(ms / 1000);
    var h = Math.floor(s / 3600);
    var m = Math.floor((s % 3600) / 60);
    var ss = s % 60;
    function p(n) { return n < 10 ? '0' + n : String(n); }
    return h > 0 ? (h + ':' + p(m) + ':' + p(ss)) : (p(m) + ':' + p(ss));
  }

  function clickStart(cand) {
    lockUntil = Date.now() + CLICK_LOCK_MS;
    clicked[cand.key] = Date.now();
    pendingClick = { key: cand.key, at: Date.now() };
    phase = 'starting';

    note('点击开始活动', {
      key: cand.key,
      row: tight(text(cand.row)).slice(0, 120),
      link: tight(text(cand.link))
    });

    fireClick(cand.link);
    paintPanel();
  }

  function findRowByKey(key) {
    if (!key) return null;
    var rows = scanRows();
    for (var i = 0; i < rows.length; i++) {
      if (keyOf(rows[i]) === key) return rows[i];
    }
    return null;
  }

  /** 点击序列（与 campaign-channel-tick / auto-loop-lecture 同一套） */
  function fireClick(el) {
    var opts = { bubbles: true, cancelable: true, view: window };
    function fire(type, Ctor) {
      try {
        el.dispatchEvent(new Ctor(type, opts));
      } catch (e) {
        try {
          var ev = document.createEvent('MouseEvents');
          ev.initEvent(type, true, true);
          el.dispatchEvent(ev);
        } catch (e2) { /* 交给最后的原生 click */ }
      }
    }
    fire('pointerdown', window.PointerEvent || MouseEvent);
    fire('mousedown', MouseEvent);
    fire('pointerup', window.PointerEvent || MouseEvent);
    fire('mouseup', MouseEvent);
    fire('click', MouseEvent);
    // 二次确认框（平台可能要求再点一下「确定」），只点一次
    tryClickConfirmOnce();
  }

  var confirmClickedAt = 0;

  function tryClickConfirmOnce() {
    var now = Date.now();
    if (now - confirmClickedAt < 1500) return;
    setTimeout(function () {
      var dlg = null;
      var ds = document.querySelectorAll('[role="dialog"], [role="alertdialog"]');
      for (var i = 0; i < ds.length; i++) {
        if (hasBox(ds[i]) && !isExtNode(ds[i])) { dlg = ds[i]; break; }
      }
      if (!dlg) return;
      var texts = ['确定', '确认开始', '确认'];
      for (var k = 0; k < texts.length; k++) {
        var leaves = findExactLeaf(dlg, texts[k], 3);
        for (var j = 0; j < leaves.length; j++) {
          if (!clickable(leaves[j])) continue;
          confirmClickedAt = Date.now();
          note('点了确认框', { text: texts[k] });
          fireClickOnly(leaves[j]);
          return;
        }
      }
    }, 350);
  }

  /**
   * 只派发事件、不再递归找确认框。
   *
   * 2026-11-01 05:0x：补一道原生 `el.click()`。
   * 起因是打开抽屉那一步在自测里「事件派出去了、监听器却一次没响」，
   * 而同一元素由测试自己 `.click()` 就正常 —— 多一条标准路径更稳，
   * 真机上 click() 与手工派发等价，不会重复触发（只调其中一条）。
   */
  function fireClickOnly(el) {
    var opts = { bubbles: true, cancelable: true, view: window };
    if (typeof el.click === 'function') {
      try { el.click(); return; } catch (e) { /* 掉到手工派发 */ }
    }
    try { el.dispatchEvent(new MouseEvent('mousedown', opts)); } catch (e2) {}
    try { el.dispatchEvent(new MouseEvent('mouseup', opts)); } catch (e3) {}
    try { el.dispatchEvent(new MouseEvent('click', opts)); } catch (e4) {}
  }

  /* ==========================================================
   * 六、播报
   * ========================================================== */

  function canSay() {
    return typeof setStatus === 'function';
  }

  /** ① 本轮开始：info，不入盒（看过即弃） */
  function sayStart(manual, name) {
    if (!canSay()) return;
    setStatus(name || '超级福袋', 'info', {
      source: SOURCE,
      count: '第 ' + round + ' 轮 · ' + (manual ? '手动开始' : '已开始')
    });
    paintPanel();
  }

  /** ② 开始：success，入盒并原位刷新（连续几十轮盒子只占一条） */
  function sayDraw(winners, name) {
    if (!canSay()) return;
    setStatus(name || '超级福袋', 'success', {
      source: SOURCE,
      count: '第 ' + round + ' 轮 · ' + (winners ? winners + ' 人参与' : '已开始'),
      standalone: true,
      histKey: 'bagDraw',
      full: '第 ' + round + ' 轮已开始' + (winners ? '，' + winners + ' 人参与' : '') +
            (name ? '（' + name + '）' : '')
    });
    paintPanel();
  }

  /** ③ 异常停止：alert，条上短、盒子里全 */
  function sayStop(reason, extra) {
    if (!canSay()) return;
    var r = REASONS[reason] || REASONS.closed;
    setStatus(r.short, 'alert', {
      source: SOURCE,
      count: round ? '共 ' + round + ' 轮' : '未开始',
      full: r.detail.replace('%N', String(round)).replace('%T', extra || '异常状态')
    });
  }

  /** 某个活动异常（条上短、盒子里全）。异常行不再参与点击候选。 */
  function sayRowError(name) {
    if (!canSay()) return;
    setStatus(name || '福袋活动异常', 'alert', {
      source: SOURCE,
      count: '异常',
      standalone: true,
      histKey: 'bagError',
      full: '检测到福袋活动异常：' + (name || '未知活动') +
            (flags.auto ? '。自动执行下一轮已停止。' : '。未做任何点击。')
    });
    paintPanel();
  }

  /* ==========================================================
   * 七、启停
   * ========================================================== */

  function startLoop() {
    if (tickTimer) return;
    bindUserTakeover();
    tickTimer = setInterval(tick, TICK_MS);
    tick();
  }

  /* ==========================================================
   * 用户接管
   * ----------------------------------------------------------
   * 为什么必须认 isTrusted：
   *   我们自己派发的 click 也会进这个捕获（isTrusted=false）。
   *   不过滤的话，点「开始活动」会把自己判成「用户接管」当场停机。
   *   这个坑在 auto-loop-lecture 里踩过，这里直接沿用同一口径。
   *
   * 为什么点「结束活动」要停：
   *   结束活动后该行回到「待开始」，插件会立刻再点开始 ——
   *   等于把人的手动干预抹掉。用户要的是「我停它就停」。
   * ========================================================== */

  var trustBound = false;

  function bindUserTakeover() {
    if (trustBound) return;
    trustBound = true;
    document.addEventListener('click', onUserClick, true);
  }

  /**
   * 这次点击算不算「用户要停」。
   * 抽成纯函数是为了能单测 —— jsdom 里造不出 isTrusted=true 的事件
   * （isTrusted 是 own 且不可配置的属性，defineProperty 会直接抛错），
   * 所以判定逻辑必须能从事件监听里拿出来单独喂假事件。
   */
  function isUserStopClick(e) {
    if (!e || !e.isTrusted) return false;      // 只认真人
    if (!flags.auto) return false;
    // 点了「开始活动」之后 phase 是 starting —— 那几秒里用户仍然可以喊停，
    // 所以不能只认 live，否则「刚点完就手动结束」这一秒会漏判。
    if (phase === 'off' || phase === 'stopped') return false;
    var t = e.target;
    if (!t) return false;
    var s = tight(text(t));
    if (s !== '结束活动' && s !== '取消活动') {
      var p = t.parentElement;
      if (!p) return false;
      s = tight(text(p));
      if (s !== '结束活动' && s !== '取消活动') return false;
    }
    return true;
  }

  function onUserClick(e) {
    if (isUserStopClick(e)) doStop('user-takeover');
  }

  function stopLoop() {
    if (tickTimer) { clearInterval(tickTimer); tickTimer = 0; }
  }

  function doStop(reason, extra) {
    stopLoop();
    phase = 'stopped';
    lastReason = reason;
    pendingClick = null;
    drawAt = 0;
    liveRunning = false;
    rowDrawAt = {};
    runningSince = {};
    noneStreak = 0;
    quietSince = 0;
    sayStop(reason, extra);
    note('已停止', { reason: reason, round: round });
    paintPanel();
    paintBadge();
  }

  function applyFlags(f) {
    /* 「与」关系（与 scrollBtns 同一套）：总闸关 ⇒ 两个子项一律不生效；
     * 总闸再开 ⇒ 各子开关按自己存的值恢复，总闸不覆写它们。
     * 代价说清：总闸关着时拨子开关，画面不会变化 —— 那时连子菜单都打不开。 */
    var gate = !(f && f[FLAG_GATE] === false);
    var onWatch = gate && !!(f && f[FLAG_WATCH]);
    var onAuto = gate && !!(f && f[FLAG_AUTO]);
    var wasWatch = prevWatch;
    var gateChanged = (prevGate !== null && gate !== prevGate);

    flags.watch = onWatch;
    flags.auto = onAuto;
    prevAuto = onAuto;
    prevWatch = onWatch;
    prevGate = gate;

    /* 总闸自己的回声，只在这一处发（子开关不再各报一条，否则一次操作两条）。
     * 与 back-to-top.js 对 scrollBtns 的处理一致。 */
    if (gateChanged && typeof toast === 'function') {
      toast(gate ? '已开启' : '已关闭', 'info', { source: '福袋功能' });
    }

    if (!onWatch) {
      stopLoop();
      phase = 'off';
      pendingClick = null;
      drawAt = 0;
      destroyPanel();
      paintBadge();                 // 只隐藏不销毁，重新打开时不用重建
      if (wasWatch === true && !gateChanged) sayEcho(false);
      return;
    }

    startBadge();
    if (wasWatch !== true) nextConfirmAt = Date.now() + 3000;   // 刚拨开：3 秒后确认一次

    if (phase === 'off' || phase === 'stopped') {
      phase = 'live';
      lastReason = '';
      noneStreak = 0;
      /* 重新开启时清掉「异常已播报」记录 —— 否则上一轮停过之后，
       * 你再拨一次开关会静默停机（原因看得见，却没有任何播报）。 */
      errSaid = {};
      rowDrawAt = {};
      runningSince = {};
      quietSince = 0;
      startLoop();
    }
    /* 总闸刚切换过 ⇒ 这一声归总闸（来源词「福袋功能」），子开关别再重复报 */
    if (wasWatch === false && !gateChanged) sayEcho(true);
    paintPanel();
  }

  function sayEcho(on) {
    if (!canSay()) return;
    setStatus(on ? '福袋监视已开启' : '福袋监视已关闭', 'info', { source: SOURCE });
  }

  function boot() {
    if (!/live\/control/.test(location.href)) return;    // 只在中控台跑
    if (typeof dycReadFlags !== 'function' || typeof dycWatchFlags !== 'function') return;

    dycReadFlags().then(function (f) {
      // ★ 先记初始态，否则用户第一次拨开关时 prevWatch 为 null，回声会丢
      prevGate = !(f && f[FLAG_GATE] === false);
      prevWatch = prevGate && !!(f && f[FLAG_WATCH]);
      prevAuto = prevGate && !!(f && f[FLAG_AUTO]);
      flags.watch = prevWatch;
      flags.auto = prevAuto;
      if (flags.watch) {
        phase = 'live';
        startBadge();
        /* ★ 必须写在 startLoop() 之前：startLoop 会同步跑第一拍，
         *   那时 nextConfirmAt 还是 0，确认会立刻发生 —— 页面可能还没渲染出
         *   「超级福袋-活动管理」入口，于是白找一次、还得退避一分钟。 */
        nextConfirmAt = Date.now() + 3000;
        startLoop();
      }
      loadCheckMin();
      dycWatchFlags(applyFlags);
    });
  }

  /* ==========================================================
   * 八、本地参数
   * ========================================================== */

  /* ==========================================================
   * 九、诊断
   * ========================================================== */

  function note(msg, extra) {
    ring.push({ t: Date.now(), msg: msg, extra: extra || null });
    if (ring.length > 40) ring.shift();
  }

  /**
   * 一行的体检摘要（只给诊断报告用，不参与任何判断）。
   *
   * 为什么要把**每格文字**都带出去：
   *   线上出问题时我只能拿到这份报告，看不到页面。只报「行 0 个」时，
   *   无法区分「抽屉没开」「行不是 tr」「状态词不认识」。
   *   带上格子文字与是否找到链接，一眼就能定位是哪一类。
   * 单元格最多 6 个、每个 16 字 —— 控制报告体积，且都是平台界面文案，
   * 不含商品名（商品名在报告里另有口径：只记长度）。
   */
  function rowDigest(row) {
    var st = statusOf(row);
    var cells = [];
    var kids = row && row.children ? row.children : [];
    for (var i = 0; i < kids.length && cells.length < 6; i++) {
      var t = tight(text(kids[i]));
      if (!t) continue;
      cells.push(t.slice(0, 16));
    }
    var links = findExactLeaf(row, START_TEXT, 2);
    return {
      key: keyOf(row).slice(0, 18),
      kind: st.kind,
      winners: winnersOf(row),
      cells: cells.length,
      cellTxt: cells,
      link: links.length ? (clickable(links[0]) ? '可点' : '灰') : '无',
      /* 原始文案（保留空格）比 tight 版更能看出「是不是两个格子粘在一起」 */
      text: String(text(row) || '').replace(/\s+/g, ' ').trim().slice(0, 70),
      tag: row.tagName || '',
      rect: (function () {
        try {
          var r = row.getBoundingClientRect();
          return Math.round(r.width) + '×' + Math.round(r.height);
        } catch (e) { return '?'; }
      })()
    };
  }

  /**
   * 抽屉**之外**有没有福袋读数源。
   *
   * 用途只有一个：回答「不开抽屉能不能知道福袋在跑」。
   * 现在的功能必须抽屉开着才读得到，用户关掉抽屉圆钮就显示「未开始」——
   * 要改成「关着也能看」，就得先知道页面上还有没有别的读数点。
   * 这里只读文本、不点任何东西，节点预算与深度都有限。
   */
  function pageClues() {
    var out = [];
    var budget = 6000;
    var nodes;
    try {
      nodes = document.querySelectorAll('a, button, span, div, p, li, em, i');
    } catch (e) { return out; }
    for (var i = 0; i < nodes.length && budget > 0 && out.length < 8; i++) {
      budget--;
      var el = nodes[i];
      if (el.children && el.children.length) continue;   // 只看叶子，省开销
      if (isExtNode(el)) continue;
      var t = tight(text(el));
      if (!t || t.length > 30) continue;
      if (t.indexOf('福袋') < 0) continue;
      var m = RE_MMSS.exec(t);
      out.push({
        t: t,
        time: m ? (m[1] + ':' + m[2]) : '',
        kind: RE_RUNNING.test(t) ? 'running' : (RE_DRAWN.test(t) ? 'drawn' : '')
      });
    }
    return out;
  }

  /* ==========================================================
   * 十、面板（点开才出现，非常驻浮层）
   * ========================================================== */

  /* ==========================================================
   * 十、悬浮窗（福袋 + 倒计时）
   * ----------------------------------------------------------
   * 用户 2026-11-01 的口径（四轮收敛，以最后一次为准）：
   *   ① 图案**照抖店原生图 1:1 描**，不要自己重新设计造型；
   *   ② 颜色也用原生配色（推翻最初那句「不要彩色」）；
   *   ③ 倒计时放在福袋下方；
   *   ④ 落点**固定右下角、在上滑到顶按钮正上方**，不再提供位置切换
   *      （本次删掉右上/左下的选项）。
   *
   * 造型不是凭印象画的，是按原生图逐行量出来的：原图 64×64，
   * 实体包围盒 45×46（宽高比 0.978，几乎正方），归一化到 32×32 视图：
   *   · 束口带：y 0.2~8.5，**两端是朝左上/右上翘起的尖**（左边界随 y 变大
   *     而右移：y=2.8 时 x=5.0、y=7.0 时 x=7.8，说明两端是斜搭下来的），
   *     中间厚、下缘向下鼓（y=0 那一行只剩 x 12.8~18.5，顶部中央有个小丘）；
   *   · 袋身：两肩尖在 (5,8.2)/(26.3,8.2)，**中间 V 形凹口下沉到 y 12.4**
   *     （就是束口的效果），最宽 x 0.4~31 在 y≈19.4，底部圆收于 y 31.7；
   *   · 带子与袋身之间那道白缝中间最宽（y=9.7 整行中间全白）——
   *     这是原生图的关键特征，两个部件不能粘死。
   *
   * 为什么挂 body：中控台是 React，重渲染会清掉平台容器里的外来节点。
   * id 必须带 dyb- 前缀，否则 overlay-guard 会把自己的窗当浮层藏掉。
   * ========================================================== */

  /* 配色也是实测取色的：左侧 #FF513C~#F45D40（橙红），中间与右侧
   * #FC0158~#FF005D（玫红）。橙段很短 —— 45% 就已经是玫红了，
   * 所以渐变轴偏水平、不是均匀对角。 */
  var BAG_SVG =
    '<svg width="26" height="26" viewBox="0 0 32 32" aria-hidden="true">' +
      '<defs>' +
        '<linearGradient id="dybBagG" x1="0.1" y1="0" x2="0.95" y2="1">' +
          '<stop offset="0" stop-color="#FF5A33"/>' +
          '<stop offset="0.45" stop-color="#FC1E51"/>' +
          '<stop offset="1" stop-color="#FF005C"/>' +
        '</linearGradient>' +
      '</defs>' +
      '<g fill="url(#dybBagG)">' +
        /* 束口带：两端是朝**左上/右上翘起**的尖，中间厚、下缘向下鼓。
         * 关键在两端要"搭下来"（左端 (5,3.2) → 斜到 (8.5,7)），
         * 与袋身肩尖只隔 0.5 —— 白缝只在中间是月牙，两端几乎相接。 */
        '<path d="M5 3.2' +
          'C5.4 1.6 8.6 0.2 12.8 0.2' +
          'H18.5' +
          'C22.7 0.2 25.9 1.6 26.3 3.2' +
          'C25.4 5.8 21.6 8.5 15.65 8.5' +
          'C9.7 8.5 5.9 5.8 5 3.2Z"/>' +
        /* 袋身：肩尖 (5,8.2)/(26.3,8.2) → 中间 V 形凹口沉到 12.4 → 外缘鼓到
         * 最宽 x 0.4~31（y≈19.4）→ 圆底收于 31.7。 */
        '<path d="M5 8.2' +
          'C7.4 10.2 11.4 12.4 15.65 12.4' +
          'C19.9 12.4 23.9 10.2 26.3 8.2' +
          'C29 10.2 31 14.9 31 19.4' +
          'C31 25.8 26.4 31.7 15.65 31.7' +
          'C4.9 31.7 0.4 25.8 0.4 19.4' +
          'C0.4 14.9 2.4 10.2 5 8.2Z"/>' +
      '</g>' +
      /* 正中镂空菱形，实测中心 (15.65,21)、半宽 3.9、半高 3.7 */
      '<path fill="#ffffff" d="M15.6 17.3L19.4 21l-3.8 3.7L11.8 21z"/>' +
    '</svg>';

  function buildBadge() {
    if (badgeHost) return;
    var host = document.createElement('div');
    host.id = 'dyb-bag-badge';
    host.style.cssText = 'position:fixed;z-index:2147483000;visibility:hidden;' +
      'width:' + BADGE_SIZE + 'px;height:' + BADGE_SIZE + 'px;';
    if (!host.attachShadow) return;
    var sh = host.attachShadow({ mode: 'open' });
    badgeShadow = sh;

    var css = document.createElement('style');
    css.textContent = [
      ':host{all:initial}',
      /* 圆形按钮（2026-11-01 用户要求）：直径 56，福袋在上、倒计时在下 */
      /* 动效与「上滑到顶」「下滑到底」两枚按钮同一套（2026-11-01 用户
       * 「动效逻辑…做的跟上滑到底一样」）：
       *   常驻 opacity .55 → 指向 .1 → 背景转灰 → 上方黑底气泡。
       *   不再用「常亮白色实心」，三枚控件观感统一。 */
      '.b{width:100%;height:100%;border-radius:50%;background:#fff;border:1px solid #e3e0d9;',
      'box-sizing:border-box;box-shadow:0 2px 8px rgba(31,35,41,.06);display:flex;flex-direction:column;',
      'position:relative;opacity:.55;',
      /* 上下左右都严格居中（2026-11-01 用户「有点歪，上下左右居中」）：
       * 不再用 padding 推重心 —— 之前那 3px 让内容整体偏上了。 */
      'align-items:center;justify-content:center;gap:1px;padding:0;',
      'cursor:pointer;user-select:none;',
      'font-family:-apple-system,"Microsoft YaHei",sans-serif;',
      'transition:opacity .2s ease-out,background .18s,box-shadow .18s}',
      /* inline svg 默认按基线对齐，底部会多出 2~3px 的空隙 —— 变块级才真居中 */
      '.b svg{display:block}',
      '.b:hover{opacity:1;background:#f5f6f7;box-shadow:0 3px 12px rgba(31,35,41,.13)}',
      '.b.hide{display:none}',
      /* 悬停气泡：与滚动按钮 .dyc-tip 同款（黑底、上方 10px、居中） */
      '.tip{position:absolute;bottom:calc(100% + 10px);left:50%;transform:translateX(-50%);',
      'background:rgba(20,20,20,.92);color:#fff;font-size:12.5px;line-height:1.2;',
      'padding:6px 10px;border-radius:6px;white-space:nowrap;',
      'opacity:0;pointer-events:none;transition:opacity .15s ease}',
      /* 2026-11-01 用户「文字比例不协调,太大了,距离边框太近」:
       * 56 的圆里 11px 三字约占 59% 宽、离圆边只剩 4px。降到 10px 后
       * 「开弹窗」约 30px 宽，弦长余量涨到 6px，比例才正常。 */
      '.t{font-size:10px;font-weight:600;color:#1f2329;line-height:1;',
      'font-variant-numeric:tabular-nums;letter-spacing:0}',
      '.tip::after{content:"";position:absolute;top:100%;left:50%;margin-left:-4px;',
      'border:4px solid transparent;border-top-color:rgba(20,20,20,.92)}',
      '.b:hover .tip{opacity:1}',
      /* 指向时绕圈的细线环 —— 与「上滑到顶」的 .dyc-btt-ring 同一套：
       * 平时不显示，hover 出现；pathLength=100 归一化，12点→6点快、
       * 6点→12点由快到慢、回到 12 点停顿再进下一圈（2.6s 一轮）。
       * 环单独一层覆盖整圆：图标 SVG 只有 26px，塞不进 60px 的环。 */
      '.ring{position:absolute;left:0;top:0;width:100%;height:100%;',
      'pointer-events:none;opacity:0;transition:opacity .2s ease}',
      '.b:hover .ring{opacity:1}',
      '.b:hover .ring circle{animation:dybRing 2.6s linear infinite}',
      '@keyframes dybRing{',
      '0%{stroke-dashoffset:0;animation-timing-function:linear}',
      '36%{stroke-dashoffset:50;animation-timing-function:cubic-bezier(.35,.45,.25,1)}',
      '86%{stroke-dashoffset:100;animation-timing-function:linear}',
      '100%{stroke-dashoffset:100}',
      '}',
      '.b.dim .t{color:#8a9099}',
      '.b.urgent .t{color:#1f2329}'
    ].join('');
    sh.appendChild(css);

    var box = document.createElement('div');
    box.className = 'b';
    box.innerHTML = BAG_SVG + '<span class="t">--:--</span>' +
      '<span class="tip">超级福袋</span>' +
      /* 细线环：与「上滑到顶」同款（hover 出现、2.6s 变速绕一圈）。
       * viewBox 按 60 圆钮全尺寸画，r=25.5 ≈ 按钮半径的 0.85（贴边留 4.5px，
       * 与滚动按钮环离边 4px 的观感一致）；pathLength=100 供 keyframes 归一化。 */
      '<svg class="ring" viewBox="0 0 60 60" aria-hidden="true">' +
      '<circle cx="30" cy="30" r="25.5" pathLength="100" fill="none" ' +
      'stroke="rgba(51,51,51,.8)" stroke-width="1.5" stroke-linecap="round" ' +
      'stroke-dasharray="25 75" stroke-dashoffset="0" transform="rotate(-90 30 30)"/>' +
      '</svg>';
    /* 不要用 title：它会触发浏览器**原生 tooltip**，与我们自己那颗黑底气泡
     * 叠成上下两层「超级福袋」（2026-11-01 用户截图指出）。
     * 语义用 aria-label 保留，它不产生视觉提示。 */
    box.setAttribute('aria-label', '超级福袋');
    box.addEventListener('click', function () { togglePanel(); });
    sh.appendChild(box);

    host.style.visibility = 'hidden';   // 先藏着，由 applyBadgeReveal 放出来
    document.body.appendChild(host);
    badgeHost = host;
    badgeBuiltAt = Date.now();
    moveBadge();                                  // 先摆好坐标，等露脸
    window.addEventListener('resize', moveBadge); // 滚动条出现/消失时重新对齐
    paintBadge();
  }

  function destroyBadge() {
    badgeReadyShown = false;
    badgeBuiltAt = 0;
    lastPosKey = '';
    window.removeEventListener('resize', moveBadge);
    if (badgeTimer) { clearInterval(badgeTimer); badgeTimer = 0; }
    if (badgeHost && badgeHost.parentNode) badgeHost.parentNode.removeChild(badgeHost);
    badgeHost = null;
    badgeShadow = null;
  }

  function startBadge() {
    buildBadge();
    if (badgeTimer) return;
    badgeTimer = setInterval(paintBadge, BADGE_TICK_MS);
  }

  /* 圆钮文案只表达两件事（2026-11-01 用户「精简文案」）：
   *   ① 有倒计时就显示倒计时（发福袋即刷新）；
   *   ② 其余一律「未开始」。
   * 删掉：未启用（开关关时整卡 display:none，本就看不见）、
   *       已停止（原因点开面板看）、开启中（点击后 3 秒内，一闪而过）、
   *       待开始（倒计时走完就停在 00:00，等下一拍刷新）、
   *       待开始（与「未开始」同义，合并）。
   *
   * 唯一保留的第三态是「进行中」：平台确实在跑、但卡片不给秒数。
   * 这一种不能并进「未开始」—— 用户看到「未开始」会以为没发出去，
   * 可能手动再点一次，变成重复开始。 */
  function badgeText() {
    if (drawAt) {
      var r = drawAt - Date.now();
      return r > 0 ? fmtMs(r) : '00:00';   // 走完就停住，不切词，等下一拍刷新
    }
    if (liveRunning) return '进行中';
    return '未开始';
  }

  function paintBadge() {
    if (!badgeShadow) return;
    applyLiveGate();               // 未开播 / 已下播：不露脸（用户 2026-11-01 05:0x）
    var box = badgeShadow.querySelector('.b');
    if (!box) return;
    var t = badgeShadow.querySelector('.t');
    var txt = badgeText();
    if (t && t.textContent !== txt) t.textContent = txt;
    box.classList.toggle('dim', !flags.watch);
    box.classList.toggle('hide', !flags.watch);

    /* 面板开着时，倒计时跟着圆钮的秒针一起走（否则只有 2.5 秒一拍，数字一跳一跳） */
    if (panelOpen) paintPanel();

    // 剩 10 秒内把数字压深一档，其余时间保持灰 —— 不做颜色变化
    var urgent = false;
    if (drawAt) {
      var r = drawAt - Date.now();
      urgent = r > 0 && r <= 10000;
    }
    box.classList.toggle('urgent', urgent);

    /* 上滑按钮会在滚动停止后自己重排（贴最右又不压滚动条），
     * 不跟着走就会歪。这里借每秒的刷新顺带校一次位置，值没变不写。 */
    moveBadge();
  }

  /* 与「上滑到顶」按钮同轴。那颗按钮的 right 不是常量 —— back-to-top.js
   * 会按「贴最右但不压滚动条」动态算，实测在 17~24 之间浮动。
   * 写死 18.4 就会与它差 1~7px，看着就是「歪」。这里读它的实际矩形
   * 反推 right，让两圆中心严格同一条竖线；读不到才用常量兜底。 */
  /* 与「上滑到顶」按钮同源定位（2026-11-01 用户「位置错…做的跟滑到底一样，
   * 保持同一个 Y 轴」，第二次报同一问题后改法）：
   *
   * 旧版用 getBoundingClientRect() 反推 right —— 那是**屏幕坐标**，
   * 一旦 fixed 的包含块不是初始包含块（中控台常在 body/祖先上加
   * transform 做缩放适配），rect 与 innerWidth 的关系就被缩放过一次，
   * 据此写 right 会再乘一遍 → 越算越偏，且偏多少取决于缩放比例。
   *
   * 现在直接读按钮的**计算样式 right / bottom**（布局值，与按钮同一个
   * 包含块），圆钮只做「半径差」补偿 → 两圆中心必然落在同一条竖线上，
   * 不受包含块、缩放、滚动条影响。按钮还没渲染时退回常量兜底。 */
  function badgePos() {
    var out = { right: BADGE_RIGHT, bottom: BADGE_BOTTOM };
    try {
      var btn = document.querySelector('.dyc-back-top');
      if (!btn || !window.getComputedStyle) return out;
      var cs = window.getComputedStyle(btn);
      if (!cs) return out;
      var br = parseFloat(cs.right);
      var bb = parseFloat(cs.bottom);
      var bw = btn.offsetWidth || 0;
      var bh = btn.offsetHeight || 0;
      if (!isFinite(br) || !isFinite(bb) || !(bw > 0) || !(bh > 0)) return out;
      // 水平：同一个 right 基准 + 半径差 → 中心同轴
      out.right = br - (BADGE_SIZE - bw) / 2;
      // 垂直：让开按钮本体 + 它顶上那颗气泡（不遮挡是硬约束）
      out.bottom = bb + bh + TIP_GAP + TIP_H + BADGE_CLEAR;
    } catch (e) { /* 忽略 */ }
    return out;
  }

  var lastPosKey = '';
  var badgeReadyShown = false;   // 页面就绪后才露脸（与滚动按钮同一口径）
  var badgeBuiltAt = 0;

  /**
   * 「页面是不是真的进来了」—— 与「上滑到顶」按钮同一口径
   * （2026-10-18 定的：三枚浮动控件要么一起出、要么一起不出）。
   * 优先复用 locate.js 的 hasProductRows()，判不准再退到 DOM 加载完成。
   */
  function uiReady() {
    try {
      if (typeof hasProductRows === 'function') return !!hasProductRows();
    } catch (e) { /* 退回本地判定 */ }
    try { return document.readyState === 'complete'; } catch (e) { return true; }
  }

  /* 进页面的显隐（2026-11-01 用户「进页面的显隐等逻辑，做的跟上滑到底一样」）：
   * 骨架屏 / 白屏阶段**不露脸**，等列表真渲染出来才以半透明浮现 ——
   * 滚动按钮在 2026-10-18 正是因为「还没进网页就常驻显示」被报过 bug。
   * 只做单向：一旦露脸就不再闪回去（福袋用到一半消失比早出现更糟）。
   * 就绪判据长期不成立时最多等 FORCE_SHOW_MS 就强行露面，避免整个功能哑掉。 */
  function applyBadgeReveal() {
    if (!badgeHost || badgeReadyShown) return;
    if (!uiReady() && Date.now() - badgeBuiltAt < FORCE_SHOW_MS) {
      badgeHost.style.visibility = 'hidden';
      return;
    }
    badgeReadyShown = true;
    badgeHost.style.visibility = 'visible';
    lastPosKey = '';          // 露脸时无条件重算一次坐标
    moveBadge();
  }

  /* 只改坐标，不整体重写 cssText —— 旧版这里会把 visibility 一起刷成
   * visible，刚挂上就露脸，绕开「进页面先藏」的显隐状态机。 */
  function moveBadge() {
    if (!badgeHost) return;
    var p = badgePos();
    var key = p.right.toFixed(1) + '|' + p.bottom.toFixed(1);
    if (key === lastPosKey) return;
    lastPosKey = key;
    badgeHost.style.right = p.right.toFixed(1) + 'px';
    badgeHost.style.bottom = p.bottom.toFixed(1) + 'px';
    /* 圆钮跟着「上滑到顶」按钮挪了位置，开着的面板得跟着走 ——
     * 否则滚动一下，面板就停在旧位置、把圆钮露出来（用户报过的「浮在上面」）。 */
    if (panelOpen) placePanel();
  }

  function togglePanel() {
    if (panelOpen) { destroyPanel(); return; }
    buildPanel();
  }

  /**
   * 点面板外面 → 自动收起。
   *
   * 两个必须排除的「外面」：
   *   · 面板自己（含 shadow 内部）—— 否则每点一次滑块就把面板关了；
   *   · 福袋圆钮 —— 它是开关本身，这里关掉后紧接着的 click 又会打开，
   *     视觉上就是「点了没反应」。
   * shadow DOM 下 document 层拿到的 target 会被重定向到宿主，所以用
   * composedPath 优先、contains 兜底（老内核没有 composedPath）。
   */
  function onDocDown(e) {
    if (!panelOpen || !panelHost) return;
    var path = (e && typeof e.composedPath === 'function') ? e.composedPath() : null;
    if (path && path.length) {
      if (path.indexOf(panelHost) >= 0) return;
      if (badgeHost && path.indexOf(badgeHost) >= 0) return;
    } else {
      var t = e && e.target;
      if (t && (panelHost === t || panelHost.contains(t))) return;
      if (badgeHost && t && (badgeHost === t || badgeHost.contains(t))) return;
    }
    destroyPanel();
  }

  function destroyPanel() {
    window.removeEventListener('resize', placePanel);
    window.removeEventListener('orientationchange', placePanel);
    document.removeEventListener('pointerdown', onDocDown, true);
    if (panelHost) {
      try { if (window.dycOverlayGuard) window.dycOverlayGuard.unbind(panelHost); } catch (e) {}
      if (panelHost.parentNode) panelHost.parentNode.removeChild(panelHost);
    }
    panelHost = null;
    panelShadow = null;
    panelOpen = false;
    pRefs = null;             // 引用一并丢掉，下次打开重新建
    slideApi = null;
    sliderDrag = false;
  }

  function buildPanel() {
    destroyPanel();
    var host = document.createElement('div');
    host.id = 'dyb-bag-panel';
    /* 先隐形放在左上角量尺寸，placePanel() 算完位置再显形 ——
     * 这样不会先闪一下再跳位 */
    host.style.cssText = 'position:fixed;left:0;top:0;visibility:hidden;z-index:2147483001;';
    if (!host.attachShadow) return;
    var sh = host.attachShadow({ mode: 'open' });
    panelShadow = sh;

    var css = document.createElement('style');
    css.textContent = [
      ':host{all:initial}',
      '.p{width:250px;max-height:calc(100vh - 16px);overflow-y:auto;background:#fff;',
      'border:1px solid #e6e4de;border-radius:8px;',
      'box-shadow:0 4px 16px rgba(0,0,0,.10);font:11px/1.6 -apple-system,"Microsoft YaHei",sans-serif;',
      'color:#1f2329;padding:10px 12px 12px;box-sizing:border-box}',
      '.h{display:flex;align-items:center;justify-content:space-between;margin-bottom:6px}',
      '.t{font-size:12px;font-weight:600}',
      /* 关闭按钮也放大（用户「按钮和条状物也太小了」）：18px 字 + 24px 点击区 */
            /* 下轮开始：一左一右，数字用等宽数字防跳动 */
      '.rl{display:flex;align-items:baseline;gap:8px;margin:2px 0 14px}',
      '.rl .k{color:#646a73;font-size:11px}',
      '.rl .val{margin-left:auto;font-size:14px;font-weight:600;',
      'font-variant-numeric:tabular-nums;letter-spacing:.4px}',
      '.rl .u{font-size:10px;color:#9aa1ab;margin-left:-4px}',
      /* 确认间隔 + 问号说明 + 滑条 */
      '.slab{position:relative;display:flex;align-items:center;color:#646a73;font-size:11px}',
      '.slab b{margin-left:auto;color:#1f2329;font-weight:600;font-variant-numeric:tabular-nums}',
      /* 问号：点/悬停出提示。用「?」而不是 ⓘ —— 老内核缺 ⓘ 字形会变成方框。 */
      '.qh{position:relative;margin-left:4px;width:13px;height:13px;line-height:12px;text-align:center;',
      'border-radius:50%;border:1px solid #c9cdd4;background:#fff;color:#86909c;font-size:9px;',
      'cursor:help;padding:0;flex:0 0 auto}',
      '.qh:hover,.qh.on{border-color:#ff3a4a;color:#ff3a4a}',
      /* 提示气泡：白卡片里用深底，跟圆钮的气泡同一套观感 */
      '.qtip{position:absolute;left:0;right:0;top:100%;margin-top:6px;z-index:2;',
      'background:#1f2329;color:#fff;border-radius:6px;padding:6px 8px;font-size:10px;line-height:1.5;',
      'opacity:0;visibility:hidden;transform:translateY(-2px);transition:opacity .12s,transform .12s}',
      '.qtip.show{opacity:1;visibility:visible;transform:none}',
      /* ── 自绘滑条（2026-11-01 05:2x，05:3x 按用户二次意见调）──
       * 为什么不用 input[type=range]：原生 range 按 step=1 走，拖起来是
       * 一格一格跳（用户原话「不要有顿挫感」），而且没法给「推荐值」画刻度线。
       *
       * 05:26 用户：「滑动条的按钮又觉得做的太大了，刻度线你放在上面」
       *   ⇒ 圆钮 22 → 18px（拖动 20px）；刻度线从轨道下移到**轨道上方**。
       * 竖向排布（自下而上）：轨道 12~20（中心 16）→ 刻度 7~12 贴轨道上沿，
       * 推荐那根 5~12 更长 → 数字标签在轨道下方。圆钮 7~25，圆心 16，与轨道同轴。 */
      '.tk{position:relative;height:28px;margin:12px 0 0;cursor:pointer;touch-action:none;outline:none}',
      '.rail{position:absolute;left:0;right:0;top:12px;height:8px;border-radius:4px;background:#f0ede8;',
      'box-shadow:inset 0 1px 2px rgba(31,35,41,.07)}',
      '.fill{position:absolute;left:0;top:12px;height:8px;border-radius:4px;',
      'background:linear-gradient(90deg,#ff5a33,#ff005c);pointer-events:none}',
      /* 每 1 分钟一根细刻度；推荐值（5）那根加粗上色 —— 用户要的「刻度线」 */
      '.mk{position:absolute;top:7px;width:1px;height:5px;background:#d9d4cb;transform:translateX(-50%);',
      'pointer-events:none}',
      '.mk.rec{top:5px;width:2px;height:7px;background:#ff3a4a;opacity:.8}',
      '.thumb{position:absolute;top:16px;left:0;width:18px;height:18px;margin:-9px 0 0 -9px;border-radius:50%;',
      'background:#fff;border:2px solid #ff3a4a;box-shadow:0 1px 5px rgba(255,58,74,.32);pointer-events:none;',
      'transition:width .12s,height .12s,margin .12s,box-shadow .12s}',
      '.tk:hover .thumb,.tk.on .thumb{width:20px;height:20px;margin:-10px 0 0 -10px;',
      'box-shadow:0 2px 8px rgba(255,58,74,.42)}',
      '.labs{position:relative;height:13px;color:#9aa1ab;font-size:10px;margin-top:2px}',
      '.labs span{position:absolute;transform:translateX(-50%);white-space:nowrap}',
      '.labs span.f{transform:translateX(0)}',
      '.labs span.l{transform:translateX(-100%)}',
      '.labs span.rec{color:#ff3a4a;font-weight:600}'
    ].join('');
    sh.appendChild(css);

    var box = document.createElement('div');
    box.className = 'p';
    sh.appendChild(box);

    host.addEventListener('mousedown', function (e) { e.stopPropagation(); }, true);
    document.body.appendChild(host);
    panelHost = host;
    panelOpen = true;

    paintPanel();
    placePanel();
    // 字体/图标加载完高度可能变，下一帧再校一次
    setTimeout(placePanel, 0);
    window.addEventListener('resize', placePanel);
    window.addEventListener('orientationchange', placePanel);
    /* 点面板外面自动收起（2026-11-01 05:26 用户要求）：
     * 用 capture 抢在页面自己的处理之前判定，减少「点了外面但页面先响应」的错位。 */
    document.addEventListener('pointerdown', onDocDown, true);
    try { if (window.dycOverlayGuard) window.dycOverlayGuard.bind(host); } catch (e) {}
  }

  /**
   * 面板落点（纯函数）。
   *
   * 抽成纯函数只为一件事：**几何能被自测直接验**。
   * 这里出过一次真错（面板读常量 17.4、圆钮读实时值，两边错位 15px，
   * 面板压在圆钮上），而靠肉眼在 jsdom 里是看不出来的。
   * 现在自测给几组不同的圆钮坐标（right=6 / 17.4 / 36）直接算，
   * 断言「面板矩形与圆钮矩形永不相交且至少隔 8px」。
   *
   * @param {number} W 视口宽  @param {number} H 视口高
   * @param {{right:number,bottom:number}} bp 圆钮的实时坐标
   * @param {number} pw 面板宽   @param {number} ph 面板高
   */
  function panelRect(W, H, bp, pw, ph) {
    var bx = W - bp.right - BADGE_SIZE;      // 圆钮左缘
    var by = H - bp.bottom - BADGE_SIZE;     // 圆钮上缘

    var left = bx - PANEL_GAP - pw;          // ① 左侧，底边与圆钮底边同高
    var top = by + BADGE_SIZE - ph;
    if (left < PANEL_MARGIN) {               // ② 左边放不下 → 上方，右缘对齐
      left = W - bp.right - pw;
      top = by - PANEL_GAP - ph;
    }
    var rawLeft = left, rawTop = top;
    left = Math.max(PANEL_MARGIN, Math.min(left, W - pw - PANEL_MARGIN));
    top = Math.max(PANEL_MARGIN, Math.min(top, H - ph - PANEL_MARGIN));
    return { left: left, top: top, rawLeft: rawLeft, rawTop: rawTop, bx: bx, by: by };
  }

  /**
   * 终局防压（纯函数，2026-11-01 05:33 用户再次报「压到福袋按钮」后补）。
   *
   * panelRect() 的三条路各有成立前提：矮窗口里面板比「圆钮上方的空间」还高时，
   * 上方放不下 → 被视口钳到顶部 → 面板底边探进圆钮的地盘。
   * 三条路**没有任何一条**单独保证「绝不相交」，所以这里做终局复核：
   *   ① 整块挪到圆钮上方（保持原左右位置）；
   *   ② 左边挤一挤（可能被视口钳住，但竖直方向不再与圆钮同排也算不压）；
   *   ③ 贴视口左边 + 垂直躲到圆钮上方；圆钮上方也放不下 → 贴顶
   *      （窗口小到那种程度时物理上放不下，取遮挡最少的一种）。
   */
  function resolveOverlap(left, top, pw, ph, bx, by) {
    var bdL = bx - PANEL_GAP;                 // 面板右缘允许到达的最右位置
    var bdT = by - PANEL_GAP;
    var vOverlap = !(top + ph <= bdT || top >= by + BADGE_SIZE + PANEL_GAP);
    if (!(vOverlap && left + pw > bdL)) return { left: left, top: top };
    var upTop = bdT - ph;
    if (upTop >= PANEL_MARGIN) return { left: left, top: upTop };
    var leftPush = bdL - pw;
    if (leftPush >= PANEL_MARGIN) return { left: leftPush, top: top };
    return {
      left: PANEL_MARGIN,
      top: Math.max(PANEL_MARGIN, Math.min(top, bdT - ph))
    };
  }

  /* 面板定位：优先圆钮左侧（底边对齐），左边放不下改到上方（右缘对齐），
   * 最后无论如何 clamp 进视口 —— 用户要求「不能越界不能跑到屏幕外」。 */
  function placePanel() {
    if (!panelHost) return;
    var W = window.innerWidth || document.documentElement.clientWidth || 0;
    var H = window.innerHeight || document.documentElement.clientHeight || 0;
    if (!W || !H) return;

    var inner = panelShadow ? panelShadow.querySelector('.p') : null;
    if (inner) inner.style.maxHeight = '';        // 复位再量，否则量到的是上次的限高
    var pw = panelHost.offsetWidth || 250;
    var ph = panelHost.offsetHeight || 200;

    /* 圆钮坐标必须用 badgePos() 的**实时值**，不能再用写死的 BADGE_RIGHT。
     * 圆钮是跟着「上滑到顶」按钮算的（那颗按钮的 right 会在 17~36 之间变），
     * 面板若读常量，两边一不一致就往右偏、直接压在圆钮身上 ——
     * 用户 2026-11-01 的原话就是「福袋按钮不要浮在半框上面」。 */
    var bp = badgePos();
    var r = panelRect(W, H, bp, pw, ph);

    /* 上方也塞不进：把面板压到「圆钮顶边以上」的高度，内容内部滚动。
     * 否则矮窗口下面板会盖住圆钮 —— 用户要求不遮挡。 */
    if (r.rawTop < PANEL_MARGIN && inner) {
      var spaceUp = r.by - PANEL_GAP - PANEL_MARGIN;
      if (spaceUp > 100) {
        inner.style.maxHeight = Math.floor(spaceUp) + 'px';
        ph = panelHost.offsetHeight || ph;
        r = panelRect(W, H, bp, pw, ph);
      }
    }

    var left = r.left;
    var top = r.top;

    /* ---- 终局保证（2026-11-01 05:33 用户再次报「压到福袋按钮」）----
     * 抽成纯函数 resolveOverlap()，自测能直接给矮窗口场景验证。 */
    var fixed = resolveOverlap(left, top, pw, ph, r.bx, r.by);
    left = fixed.left;
    top = fixed.top;

    panelHost.style.left = Math.round(left) + 'px';
    panelHost.style.top = Math.round(top) + 'px';
    panelHost.style.visibility = 'visible';

    /* 面板自己记一份最终几何，给自测断言「绝不与圆钮相交」用 */
    panelHost.__dycGeom = { left: left, top: top, w: pw, h: ph, bx: r.bx, by: r.by };
  }

  /**
   * 面板内容（2026-11-01 05:0x 用户定）：
   *   **只留两样** —— 下轮开始时间 + 3~10 分钟的确认间隔滑块。
   *   状态 / 已发轮数 / 开始时长 / 弹窗 / 那段灰说明，全部删掉
   *   （用户原话：「删掉这个框内容和说明都删掉，不需要这些信息」）。
   *
   * 与旧版的另一个关键差异：**元素只建一次**，之后只改文字。
   * 旧版每秒重建 innerHTML，滑块拖到一半就被抹掉重画 ——
   * 用户要求「跟自动循环功能一样不受自动刷新干扰」正是这个。
   */
  function paintPanel() {
    if (!panelShadow) return;
    var box = panelShadow.querySelector('.p');
    if (!box) return;

    if (!pRefs) {
      box.innerHTML = '';
      var h = document.createElement('div'); h.className = 'h';
      var tt = document.createElement('span'); tt.className = 't'; tt.textContent = '超级福袋';
      /* 不再有 ✕ 关闭键（2026-11-01 05:33 用户「去掉X的关闭键」）：
       * 关闭 = 点面板外面，或再点一次福袋圆钮。少一个按钮，头部只剩标题。 */
      h.appendChild(tt);
      box.appendChild(h);

      var r1 = document.createElement('div'); r1.className = 'rl';
      var k1 = document.createElement('span'); k1.className = 'k'; k1.textContent = '下轮开始';
      var v1 = document.createElement('span'); v1.className = 'val'; v1.textContent = '未读到';
      var u1 = document.createElement('span'); u1.className = 'u'; u1.textContent = '后';
      r1.appendChild(k1); r1.appendChild(v1); r1.appendChild(u1);
      box.appendChild(r1);

      var r2 = document.createElement('div'); r2.className = 'slab';
      var k2 = document.createElement('span'); k2.textContent = '确认间隔';
      /* 问号提示（2026-11-01 05:26 用户：「确认间隔→确认间隔（问号：每隔设定的时间
       * 打开一次福袋抽屉获取倒计时。）」）。文案只回答「这个滑块在干什么」，
       * 不写实现细节，也不复述开关状态 —— 按第 25 条：一处只回答当前问题。 */
      var qh = document.createElement('button');
      qh.type = 'button';
      qh.className = 'qh';
      qh.textContent = '?';
      qh.setAttribute('aria-label', '说明：每隔设定的时间打开一次福袋抽屉获取倒计时。');
      var qtip = document.createElement('span');
      qtip.className = 'qtip';
      qtip.textContent = '每隔设定的时间打开一次福袋抽屉获取倒计时。';
      function tipOn() { qtip.classList.add('show'); qh.classList.add('on'); }
      function tipOff() { qtip.classList.remove('show'); qh.classList.remove('on'); }
      qh.addEventListener('pointerenter', tipOn);
      qh.addEventListener('pointerleave', tipOff);
      qh.addEventListener('focus', tipOn);
      qh.addEventListener('blur', tipOff);
      /* 触摸设备没有 hover：点一下切到显示，点外部由「自动收起」那一套带走 */
      qh.addEventListener('click', function (e) {
        e.stopPropagation();
        if (qtip.classList.contains('show')) tipOff(); else tipOn();
      });
      var v2 = document.createElement('b'); v2.textContent = checkMin + ' 分钟';
      r2.appendChild(k2); r2.appendChild(qh); r2.appendChild(qtip); r2.appendChild(v2);
      box.appendChild(r2);

      /* ── 自绘滑条 ── */
      var tk = document.createElement('div');
      tk.className = 'tk';
      tk.setAttribute('role', 'slider');
      tk.setAttribute('tabindex', '0');
      tk.setAttribute('aria-label', '确认间隔分钟');
      tk.setAttribute('aria-valuemin', String(CHECK_MIN));
      tk.setAttribute('aria-valuemax', String(CHECK_MAX));
      var rail = document.createElement('div'); rail.className = 'rail';
      var fill = document.createElement('div'); fill.className = 'fill';
      tk.appendChild(rail); tk.appendChild(fill);
      /* 每 1 分钟一根刻度；推荐值单独一类（`rec`），线更粗、颜色更亮 */
      var marks = document.createElement('div');
      var mh = '';
      for (var mv = CHECK_MIN; mv <= CHECK_MAX; mv++) {
        mh += '<div class="mk' + (mv === CHECK_REC ? ' rec' : '') + '" style="left:' + pctOf(mv) + '%"></div>';
      }
      marks.innerHTML = mh;                       // 一次写入，不逐个 appendChild
      tk.appendChild(marks);
      var thumb = document.createElement('div'); thumb.className = 'thumb';
      tk.appendChild(thumb);
      box.appendChild(tk);

      var labs = document.createElement('div'); labs.className = 'labs';
      function mkLab(v, cls, txt) {
        var s = document.createElement('span');
        s.className = cls;
        s.style.left = pctOf(v) + '%';
        s.textContent = txt;
        labs.appendChild(s);
      }
      mkLab(CHECK_MIN, 'f', String(CHECK_MIN));
      mkLab(CHECK_REC, 'rec', CHECK_REC + ' 推荐');
      mkLab(CHECK_MAX, 'l', String(CHECK_MAX));
      box.appendChild(labs);

      pRefs = { val: v1, unit: u1, min: v2, tk: tk, fill: fill, thumb: thumb };
      slide.cur = slide.target = checkMin;
      paintSlide();
      bindSlide(tk);
    }

    /* 以下每次只改文字（值没变就不碰 DOM） */
    var txt = '未读到';
    if (drawAt) {
      var left2 = drawAt - Date.now();
      txt = left2 > 0 ? fmtMs(left2) : '00:00';
    }
    if (pRefs.val.textContent !== txt) pRefs.val.textContent = txt;
    pRefs.unit.style.display = drawAt ? '' : 'none';

    if (!sliderDrag) {
      var mtxt = checkMin + ' 分钟';
      if (pRefs.min.textContent !== mtxt) pRefs.min.textContent = mtxt;
      /* 外部改了值（读存储 / 键盘 / 自测 setCheckMin）→ 滑钮跟着归位。
       * 只判断 target 就够了：target 是「应该停在哪」，cur 只是动画中间态。 */
      if (Math.abs(slide.target - checkMin) > 0.001) {
        slide.cur = slide.target = checkMin;
        paintSlide();
      }
    }
  }

  /* ==========================================================
   * 十一·五、滑条（阻尼 + 刻度 + 推荐值）
   * ========================================================== */

  /** 3 分钟 = 0%，10 分钟 = 100% */
  function pctOf(v) {
    var p = (v - CHECK_MIN) / (CHECK_MAX - CHECK_MIN) * 100;
    return Math.max(0, Math.min(100, p));
  }

  /** 把当前值画到轨道上（只写两个 style，不读布局） */
  function paintSlide() {
    if (!pRefs) return;
    var p = pctOf(slide.cur);
    pRefs.fill.style.width = p + '%';
    pRefs.thumb.style.left = p + '%';
    if (pRefs.tk) pRefs.tk.setAttribute('aria-valuenow', String(Math.round(slide.cur)));
    /* 拖动中数字跟着走（用户截图里「6 分钟」那一行就是实时值）——
     * 不写这句的话，拖动全程只有滑钮在动、数字停在旧值。 */
    if (sliderDrag && pRefs.min) {
      var t = Math.round(slide.cur) + ' 分钟';
      if (pRefs.min.textContent !== t) pRefs.min.textContent = t;
    }
  }

  /**
   * 阻尼收尾：每帧追目标值的 45%，约 150ms 到位（0.35 要 270ms，显得拖）。
   *
   * 用户 2026-11-01 05:2x 的原话是「有滑动的阻尼感，不要有顿挫感」——
   * 顿挫来自「按 step=1 一格一格跳」。所以拖动时 target 是**小数**
   * （指针在哪就是哪），画面跟着连续走；松手才吸到整数并存盘。
   * 与「自动循环讲解」的滑条同一套算法，那边已经跑了几个月。
   */
  function dampStep() {
    var d = slide.target - slide.cur;
    if (Math.abs(d) < 0.01) {
      slide.cur = slide.target;
      paintSlide();
      slide.raf = 0;
      return;
    }
    slide.cur += d * 0.45;
    paintSlide();
    slide.raf = requestAnimationFrame(dampStep);
  }

  function kickSlide() {
    if (!slide.raf) slide.raf = requestAnimationFrame(dampStep);
  }

  function dampTo(v) {
    slide.target = Math.max(CHECK_MIN, Math.min(CHECK_MAX, v));
    kickSlide();
  }

  /**
   * 拖动。
   *
   * ★ 三条 2026-10-30 踩出来的规矩（「自动循环讲解」那边写在 bindDrag 里），
   *   这里照抄，一条都不能省：
   *   ① pointermove 挂 **document**，不能只挂轨道 —— 面板被重排/刷新时
   *      指针一离开轨道就收不到 move，表现是「拖到一半断了」；
   *   ② pointerup 挂 window 且**只认 isTrusted 真手势** —— 平台自动刷新会派
   *      合成点击，其中 pointerup 冒泡上来会把拖动直接判成松手；
   *   ③ pointercancel 给 900ms 宽限（表格重排时浏览器会发它，不是松手）。
   */
  function bindSlide(tk) {
    var cancelAt = 0;

    function isReal(e) {
      if (!e) return true;
      if (typeof window.__dycTestTrusted === 'function') return window.__dycTestTrusted(e) !== false;
      return e.isTrusted !== false;
    }

    function markUserDrag(on) {
      window.__dycUserDragUntil = on ? Date.now() + 1500 : 0;
    }

    function valueAt(clientX) {
      var r = slide.rect;
      if (!r || !r.width) return slide.target;
      var x = Math.min(Math.max(clientX - r.left, 0), r.width);
      return CHECK_MIN + (x / r.width) * (CHECK_MAX - CHECK_MIN);
    }

    function onMove(e) {
      if (!slide.drag) return;
      if (typeof e.buttons === 'number' && e.buttons === 0 && isReal(e)) { onEnd(e); return; }
      cancelAt = 0;
      dampTo(valueAt(e.clientX));
      markUserDrag(true);
      e.stopPropagation();
    }

    function onCancel() {
      if (!slide.drag) return;
      cancelAt = Date.now();
      setTimeout(function () {
        if (slide.drag && cancelAt && Date.now() - cancelAt >= 850) onEnd();
      }, 900);
    }

    function attach() {
      document.addEventListener('pointermove', onMove, true);
      document.addEventListener('pointercancel', onCancel, true);
    }

    function detach() {
      document.removeEventListener('pointermove', onMove, true);
      document.removeEventListener('pointercancel', onCancel, true);
    }

    function onEnd(e) {
      if (!slide.drag) return;
      if (!isReal(e)) return;              // 合成事件不算松手
      slide.drag = null;
      canvasReset();
      detach();
      markUserDrag(false);
      sliderDrag = false;
      var v = clampCheck(slide.target);    // 松手才吸到整数
      dampTo(v);
      if (v !== checkMin) saveCheckMin(v);
      paintPanel();
    }

    function canvasReset() {
      if (pRefs && pRefs.tk) pRefs.tk.classList.remove('on');
    }

    function startDrag(clientX) {
      /* 轨道矩形只在这里读一次：拖动期间面板位置冻结，
       * 原来每个 move 都 getBoundingClientRect 等于每帧强制一次布局。 */
      slide.rect = tk.getBoundingClientRect();
      slide.drag = { at: Date.now() };
      sliderDrag = true;
      tk.classList.add('on');
      cancelAt = 0;
      attach();
      markUserDrag(true);
      dampTo(valueAt(clientX));
    }

    tk.addEventListener('pointerdown', function (e) {
      startDrag(e.clientX);
      try { tk.setPointerCapture(e.pointerId); } catch (e2) { /* 老内核可能没有 */ }
      e.preventDefault();
      e.stopPropagation();
    });

    window.addEventListener('pointerup', onEnd, true);

    /* 键盘也能调（无障碍 + 精细一格）：方向键 ±1 分钟 */
    tk.addEventListener('keydown', function (e) {
      var d = e.key === 'ArrowRight' || e.key === 'ArrowUp' ? 1
        : (e.key === 'ArrowLeft' || e.key === 'ArrowDown' ? -1 : 0);
      if (!d) return;
      e.preventDefault();
      var v = clampCheck(checkMin + d);
      slide.cur = slide.target = v;
      paintSlide();
      saveCheckMin(v);
      paintPanel();
    });

    /* 给自测用的直接落点（绕开 jsdom 的 pointer 事件模拟） */
    slideApi = {
      to: function (clientX) { startDrag(clientX); },
      move: function (clientX) { dampTo(valueAt(clientX)); },
      end: function () { onEnd({ isTrusted: true }); },
      live: function () { return slide.cur; },
      target: function () { return slide.target; },
      rect: function () { return slide.rect; }
    };
  }

  /* ==========================================================
   * 十二、注册工具栏按钮 + 启动
   * ========================================================== */

  if (typeof dycRegisterTool === 'function') {
    dycRegisterTool({
      id: 'luckyBag',
      flag: FLAG_AUTO,
      label: '超级福袋',
      render: function (ctx) {
        return ctx.makeButton('福袋', function () { togglePanel(); });
      }
    });
  }

  boot();

  /* ==========================================================
   * 十三、自测出口
   * ========================================================== */

  window.__DYC_LUCKY_BAG__ = {
    pure: {
      tight: tight,
      clickable: clickable,
      looksGrayed: looksGrayed,
      findExactLeaf: findExactLeaf,
      countExact: countExact,
      rowOf: rowOf,
      keyOf: keyOf,
      prizeOf: prizeOf,
      panelPresent: panelPresent,
      panelInfo: panelInfo,
      panelRect: panelRect,
      resolveOverlap: resolveOverlap,
      scanRows: scanRows,
      statusOf: statusOf,
      winnersOf: winnersOf,
      computeDrawAt: computeDrawAt,
      isUserStopClick: isUserStopClick,
      RE_RUNNING: RE_RUNNING,
      RE_DRAWN: RE_DRAWN
    },
    /* 面板开关与位置，给自测用（真实用户点圆钮走的是同一个 togglePanel） */
    togglePanel: function () { togglePanel(); },
    moveBadge: function () { moveBadge(); },
    badgePos: function () { return badgePos(); },
    revealBadge: function () { applyBadgeReveal(); },
    placePanel: function () { placePanel(); },
    panelBox: function () {
      if (!panelHost) return null;
      return {
        left: parseFloat(panelHost.style.left) || 0,
        top: parseFloat(panelHost.style.top) || 0,
        w: panelHost.offsetWidth || 250,
        h: panelHost.offsetHeight || 200,
        maxH: (function () {
          var inner = panelShadow && panelShadow.querySelector('.p');
          return inner ? (parseFloat(inner.style.maxHeight) || 0) : 0;
        })(),
        visible: panelHost.style.visibility !== 'hidden'
      };
    },
    snapshot: function () {
      return {
        phase: phase,
        round: round,
        reason: lastReason,
        flags: { watch: flags.watch, auto: flags.auto },
        timers: { tick: !!tickTimer, badge: !!badgeTimer },
        pending: pendingClick ? pendingClick.key : '',
        running: liveRunning,
        draws: (function () {
          var o = {};
          for (var k in rowDrawAt) {
            if (Object.prototype.hasOwnProperty.call(rowDrawAt, k)) o[k] = rowDrawAt[k];
          }
          return o;
        })(),
        drawIn: drawAt ? Math.max(0, drawAt - Date.now()) : 0,
        badge: badgeText(),
        live: liveState,
        check: {
          min: checkMin,
          last: lastConfirmAt,
          next: nextConfirmAt,
          busy: confirmBusy,
          stat: confirmStat,
          note: checkLoaded ? '' : '未从存储读到，按默认 ' + CHECK_DEF
        },
        ring: ring.slice(-12)
      };
    },
    probe: function () {
      var rows = scanRows();
      var info = panelInfo();
      return {
        panel: info.open,
        by: info.by || '(没认出抽屉)',
        searchPh: info.searchPh,
        startLinks: info.startLinks,
        live: liveState,
        checkMin: checkMin,
        rows: rows.length,
        detail: rows.slice(0, 10).map(rowDigest),
        clues: pageClues(),
        ring: ring.slice(-12)
      };
    },
    /* 面板里的滑条（给自测用；真实用户拖的就是这个元素） */
    panelSlider: function () {
      return pRefs ? pRefs.tk : null;
    },
    slideState: function () {
      return { cur: slide.cur, target: slide.target, live: !!slide.drag, check: checkMin };
    },
    slideTo: function (clientX) { if (slideApi) slideApi.to(clientX); },
    slideMove: function (clientX) { if (slideApi) slideApi.move(clientX); },
    slideEnd: function () { if (slideApi) slideApi.end(); },
    panelGeom: function () { return panelHost ? panelHost.__dycGeom || null : null; },
    setCheckMin: function (v) { saveCheckMin(v); paintPanel(); },
    checkMin: function () { return checkMin; },
    confirmNow: function () { nextConfirmAt = 0; maybeConfirm(); },
    liveState: function () { return liveState; },
    tick: tick,
    setTimingForTest: function (o) {
      o = o || {};
      if (typeof o.verify === 'number') VERIFY_MS = o.verify;
      if (typeof o.quiet === 'number') QUIET_LIMIT_MS = o.quiet;
      // 改锁时顺便清掉已经生效的那一把 —— 否则上一拍留下的 2 秒锁
      // 会把紧接着的用例挡在外面，看起来像「功能不点」
      if (typeof o.lock === 'number') { CLICK_LOCK_MS = o.lock; lockUntil = 0; }
      /* 把「预计开始时刻」整体往前挪，模拟时间流逝 —— 卡死判据要等真时间
       * 过去 90 秒才能验，测试里不可能真等，只能改数据。 */
      if (typeof o.backdate === 'number') {
        for (var bk in rowDrawAt) {
          if (Object.prototype.hasOwnProperty.call(rowDrawAt, bk)) rowDrawAt[bk] -= o.backdate;
        }
        if (drawAt) drawAt -= o.backdate;
      }
      if (typeof o.tick === 'number') {
        TICK_MS = o.tick;
        if (tickTimer) { clearInterval(tickTimer); tickTimer = setInterval(tick, TICK_MS); }
      }
    },
    isOn: function () { return phase !== 'off'; }
  };
})();
