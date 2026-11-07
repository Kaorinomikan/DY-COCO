/**
 * 自动循环讲解 · 中控台
 * ============================================================
 * 【用户要什么(2026-10-25 定稿,方案评审稿 v9)】
 *   小黄车右上角一枚 20px 的浮动小胶囊,显示「自动循环讲解中 04:32」;
 *   点开是调整面板:三段色带(秒杀·引流 / 承接·利润 / 高客单)+ 刻度
 *   + 带阻尼的滑条 + 常驻两行提示。
 *   分钟模式 1–15 分钟(步进 30 秒)，秒模式 5–60 秒(步进 1 秒)，互斥切换。
 *   秒模式仅直接定位当前讲解商品，取消后再续讲；不搜索、不滚屏、不失败重试。
 *   胶囊左侧只展开菜单，末端常驻开启/停止；设置与启停状态跨刷新/重启保留。
 *
 * 【胶囊挂哪儿(2026-10-25 用户改口径)】
 *   挂在商品列表 tab 文案(「待上架商品」这类)右侧 12px 的空白处 —— 用户截图指的那块。
 *   原先的「直播商品(N) 行右端」与平台的「设置 / 添加」挤在一起,不再使用。
 *   tab 文案随切页会变,所以按一组文本认;一个都找不到才退回标题行右端。
 *
 * 【控件为什么挂在 body 上】
 *   中控台是 React 页面,它每次重渲染都会清掉插进它容器里的外来节点。
 *   本功能每 N 分钟点一次「讲解」,必然触发那轮重渲染 ⇒ 控件若挂在平台容器里
 *   会周期性闪一下(AGENTS 第 50 条,小黄车自动刷新那次踩过)。
 *   ⇒ 宿主 fixed + Shadow DOM,坐标每拍按标题行实测矩形重贴,零布局占位
 *     —— 小黄车的行数 / 行距 / 滚动位置一个像素都不动。
 *
 * 【三件事必须分开(AGENTS 第 53 条)】
 *   ① 能不能点 = 节点在文档 + 有真实尺寸 + 没禁用。**不含视口条件**。
 *   ② 看不看得见 = 只决定胶囊显隐,绝不用来决定「功能要不要停」。
 *   ③ 行节点会被虚拟滚动回收 ⇒ **不缓存节点引用**,每拍按商品名重找。
 *
 * 【消息纪律(AGENTS 第 21 条)】
 *   一个自动动作只出一条消息,三段式「来源｜值｜结果数」,来源词 = 自动循环讲解。
 *   点「取消讲解」不单独报;只报最终结果。失败单独报并进盒子。
 *
 * 【红线】
 *   本任务分支内不改 version / 不 push / 不打 tag / 不碰 update-manifest.json。
 * ============================================================
 */

(function dycAutoLoopLecture() {
  'use strict';

  /* ==========================================================
   * 一、常量与状态
   * ========================================================== */

  var SOURCE = '自动循环讲解';          // 三段式来源词,与弹窗 label 一致
  var FLAG = 'autoLoopLecture';         // 总闸
  // 缺省沿用原版开启；有记录后严格按上一次启停状态恢复，不恢复旧商品或过期计时。
  var MINUTES_KEY = 'dybAutoLoopMinutes';    // 分钟数存独立键(不是 boolean)
  var MODE_KEY = 'dybAutoLoopMode';            // 旧键,只用于迁移
  var SECONDS_KEY = 'dybAutoLoopSeconds';
  var GROUP_KEY = 'dybAutoLoopGroup';          // 'sec' | 'min'  当前启用的那一组
  /* 2026-10-31:秒档慢轮搜索已取消(Q3=A),SLOW_KEY 不再读取;
   * 旧版本存下的 dybAutoLoopSlowSearch 键留在 storage 里,不影响任何行为。 */

  /* 2026-10-30 用户定:秒档做成**固定四档**,下限 15 秒。
   * 四档不是一个连续量程的两端,而是四个场景名 —— 用户点之前就该知道差别在哪。
   * 2026-11-01 用户定:四档统一按「(档位 − 3) 秒 + 0~3 秒随机」跑(见 intervalMs);
   *   按钮仍标标称值,各档按钮内小字注明实际范围(如 15 档 = 12~15 秒,见 buildSecButtons)。 */
  var SEC_TIERS = [15, 30, 45, 60];
  var SEC_REC = 30;
  var SEC_DEF = 30;
  /* 秒档预算与熔断(2026-10-31 用户定 Q2=A,评审稿《两档找品分工》):
   *   · 常规轮 3000ms(直取 + 微跳 + 点击与校验),**不搜索、不滚屏**;
   *   · 连续跳过 2 次就熔断 —— 秒档的定位是「认输快」;
   *   · 但**最后一轮给一次平台搜索兜底**(预算放大到 6000ms):搜到就接着讲,
   *     搜不到才真的认输。用户 2026-10-31 追加:「秒档加入平台搜索作为重试失败
   *     多次的最终兜底」。注意兜底**只在「再失败就熔断」那一轮**发生 ——
   *     旧写法是「每 3 轮一次」,15 秒档每 45 秒就把列表筛成一行再还原,太闹。
   *   最晚多久停 = 一个完整间隔 + 第 2 轮预算(≤6.4 秒):
   *     15 秒档约 21 秒、30 秒档约 36 秒、45 秒档约 51 秒、60 秒档约 66 秒。
   *     (不是「2 个间隔」—— 第 2 轮失败是当场熔断,不会再等一个间隔。)
   *   5 分钟一次都没成功仍无条件停(防「每轮给用户让路、失败计数永远不涨」)。 */
  var FAST_BUDGET_MS = 4500;
  var SLOW_BUDGET_MS = 6000;    // 兜底轮(允许一次平台搜索)才用
  /* nap7(2026-11-01):跳过只剩「找不到行」一种来源,3 次给足重渲染抖动的余量;
   * 前两跳里第 2 跳就会触发平台搜索兜底(见 isRescue 判定)。 */
  var SKIP_LIMIT = 3;
  /* 欠账有效期:点了取消后这么久还没补上讲解,欠账作废(防无限补讲)。
   * 2 分钟 ≈ 盲模式 DOM 落后 16 秒的好几倍,也覆盖前台翻转+验证的最坏情况。 */
  var OWED_TTL_MS = 120000;
  /* 2026-11-01:状态确认类失败单独计数,不烧「找不到商品」的额度。
   * 实机 02:03:02「未确认重新讲解」→ 02:03:18「商品已停止讲解」→ 熔断停表,
   * 而那时商品正空着没人讲 —— 两次抖动就杀掉整条循环,代价太大。 */
  var SOFT_LIMIT = 6;
  var HARD_STOP_MS = 300000;
  var ENABLED_KEY = 'dybAutoLoopEnabled';

  /* ★★ 无限模式(2026-11-05 用户定,方案评审稿 v1)
   * ----------------------------------------------------------
   * 用户原话:「做一个无限循环的模式,旨在不会因为短期讲解没有接上就停止……
   *   但为了防止 15 秒状态下每隔 15 秒就操作一下导致页面一直被占用」。
   * 核心不是「多试几次」,而是把**循环寿命**从**单次动作成败**里拆出来:
   *   动作失败 ⇒ 不熔断,转入「守夜(VIGIL)」,只读探针、不再点也不再滚。
   * 动作分三级,节流只对第三级生效:
   *   L0 只读探针(读行内按钮文案)          —— 5ms,页面无感,不限次数
   *   L1 轻写(点一次讲解 / 取消讲解)        —— 一次点击,受设定间隔约束
   *   L2 重定位(平台搜索 / 滚屏 / 刷新列表) —— 真抢页面,5 分钟滑窗 ≤1 次
   * 为什么用**滑窗**而不是「距上次计时」:后者在抖动(接了又断)时每恢复一次
   *   就能把计时器刷回 0,等于把配额变成间隔,页面照样被占满。
   * 唯一会真停:连续 30 分钟页面上连一个「讲解」按钮都找不到(离开直播页/列表空)。 */
  var INFINITE_KEY = 'dybAutoLoopInfinite';
  var VIGIL_PROBE_FAST_MS = 5000;    // 进守夜首 15 秒的加密节奏
  var VIGIL_PROBE_MID_MS = 15000;    // 15~60 秒
  var VIGIL_PROBE_MS = 30000;        // 稳态:一拍只读几毫秒,平均 15 秒抓到
  var VIGIL_WARM_MS = 60000;         // 加密确认阶段时长
  var VIGIL_JITTER_MS = 60000;       // 距上次退出守夜不足这么久 ⇒ 阶梯不从 5 秒重起
  var VIGIL_FIRST_RELOC_MS = 60000;  // 进守夜满 60 秒才给第一次重定位
  var RELOC_WINDOW_MS = 300000;      // 重定位滑窗:最近 5 分钟
  var RELOC_MAX = 1;                 // 滑窗内最多几次
  var RESUME_COOLDOWN_MS = 30000;    // 补讲没确认 ⇒ 30 秒内不再点
  var RESUME_FAIL_MAX = 3;           // 连续补讲失败到此就不再主动点,只留探针
  var VIGIL_DEAD_MS = 1800000;       // 30 分钟一个讲解按钮都找不到 ⇒ 真停

  var MIN_MIN = 1;                      // 滑条下限(应急档,秒杀/憋单用)
  var MAX_MIN = 15;                     // 滑条上限
  var DEF_MIN = 5;                      // 默认值
  var RECS = [3, 8];                    // 两个推荐值:秒杀·引流 / 承接·利润
  var ZONES = [
    { from: 1,  to: 5,  cls: 'r', text: '秒杀 · 引流' },
    { from: 5,  to: 12, cls: 'g', text: '承接 · 利润' },
    { from: 12, to: 15, cls: 'o', text: '高客单' }
  ];
  // 按用户定稿只保留选品建议，不承诺平台效果。
  var ADVICE = [
    { v: 1,  html: '适合 <b>秒杀、憋单</b>' },
    { v: 3,  html: '推荐 <b>秒杀、引流款</b>' },
    { v: 5,  html: '推荐 <b>引流、承接款</b>' },
    { v: 8,  html: '推荐 <b>利润款</b>' },
    { v: 12, html: '推荐 <b>高客单、长演示品</b>' },
    { v: 15, html: '适合 <b>长演示商品</b>' }
  ];

  /* 2026-10-25 用户报「反应很迟钝」:原来 20 秒一拍 —— 点了讲解最多等 20 秒才被看见,
   * 到点续讲也要再等一拍。现在改 2 秒一拍(每拍只读几行文本,开销可忽略),
   * 另加 DOM 唤醒(见 ensureObserver),状态一变基本 1 秒内就动。 */
  var TICK_MS = 2000;
  var GAP_MS = 700;         // 取消 → 续讲 的间隔(够平台收尾,又不让人等)
  /* 点完等状态翻转的观察窗。2026-11-01 从 3000 提到 5000:实机出现过
   * 「点击已发出、按钮 3 秒内没翻」→ 判失败 → 下一轮把商品认成「已停止讲解」。
   * 后台每拍 1 秒,3000 只剩 3 次观察,本来就偏紧。 */
  var VERIFY_MS = 5000;
  /* 取消后等按钮翻回「讲解」的上限。2026-11-01 从共享预算(4500)里独立出来:
   * 平台取消后常把按钮短暂置灰/重渲染,4 秒在后台只等于 4 拍,根本不够,
   * 实机 02:14:01 / 02:14:22 就是连着两次「取消讲解未确认」把循环停掉的。 */
  var FLIP_WAIT_MS = 7000;
  /* ★ 2026-11-06 弹卡优先:点完「弹出讲解卡」后的观察窗。
   *   与 FLIP_WAIT_MS 不同,这里**不等按钮翻转** —— 平台这个按钮点完文案不变
   *   (它只是重新弹卡)。只用来确认一件事:讲解没被这次点击弄断。
   *   1.4 秒 = 平台重渲染一拍的量级,再长只是白占间隔。 */
  var POP_VERIFY_MS = 1400;
  /* ★ nap10(2026-11-01 实机 03:34~03:37 数据):后台「提前补讲探测」节奏。
   *   问题:补讲要等「隐藏标签的 DOM 翻回讲解」,实测要 16~32 秒;而检查绑在 15 秒
   *   间隔上,常常刚好卡在"还没翻"那一侧 —— 于是白点一下空操作、再等一轮,
   *   一次真正的循环被拖成 3 轮 48 秒(设定 15 秒)。
   *   改法:点完取消 3 秒起,每拍(1 秒)读一次行内按钮文案(几毫秒),一翻就补讲,
   *   不必等满间隔。最坏情况(一直探不到)与旧行为完全一致,纯增益。 */
  var PEEK_MIN_MS = 3000;    // 点完取消后至少等这么久再探(平台还没处理完时探没意义)
  var PEEK_MS = 1000;        // 两次探测的最小间隔
  /* 补讲轮"界面没翻"最多探几次,之后强制点一次(空操作也不亏,绝不死等)。
   * nap11 起每次间隔 BLIND_TICK_MS(3 秒):5 次 ≈ 15 秒。 */
  var BLIND_WAIT_MAX = 5;
  /* nap11:盲模式**密探节奏**。取消之后每 3 秒看一眼界面翻没翻 ——
   *   实测平台翻盘时间在 5~31 秒之间浮动,固定的 15 秒间隔经常刚好错过窗口。
   *   密探只是读 DOM(几毫秒),不点任何东西。 */
  var BLIND_TICK_MS = 3000;
  /* 补讲之后"界面还没反映已在讲"的观察期。实测这段时间也要 16~31 秒,
   * 期内读到「不在讲」只当 DOM 没翻,**不点任何按钮**(点了是多余的重复补讲,
   * 还会把下一轮的计时重置 —— 实机 03:45:54 / 03:46:10 就是这么被推后的)。 */
  var BLIND_SETTLE_MS = 30000;
  /* nap8(2026-11-01):盲模式不再有"每秒回看界面翻没翻"的节奏常量。
   *   REFLECT_MS / CANCEL_TTL_MS 这套机制已被证明会死锁 —— 隐藏标签的 DOM 冻结在
   *   「取消讲解」时,按 TTL 复看永远看不到翻转,过期后又点一次取消,永远不补讲。
   *   现在盲模式走**阶段账本**(发过取消 ⇒ 下一轮无条件补讲),零等待、零复看。
   *   RETRY_MS / SLOW_MS 仍是分钟档的失败退避。 */
  var RETRY_MS = 30000;     // 单次失败后的重试间隔
  var SLOW_MS = 60000;      // 连续失败 3 次后的慢速重试
  var FAIL_LIMIT = 3;       // 到这个次数才发一条失败消息,并放慢到 SLOW_MS
  /* ★ 2026-10-27(用户:「我很介意重复执行轮询然后大半时间被这个滚动的状态给占用」):
   *   失败重试必须有**终点**。到这里就停表 + 明说一句,不再无限 60 秒一轮 ——
   *   6 次 ≈ 30s + 30s + 60s + 60s + 60s 的退避,真正在动作的时间 ≤ 1 分钟,
   *   而不是「一整晚都在滚」。 */
  var FAIL_MAX = 6;
  var POS_MS = 250;         // 胶囊跟位(只读一个矩形,开销可忽略)
  /* 2026-10-26(#114 / #115 / #113 修复)'新增的四个判据 */
  var LOST_STREAK_LIMIT = 20;   // 连续 20 拍(≈40 秒)都找不回来,才允许配合失败次数判终止
  var LOST_GIVEUP_MS = 900000;  // 兜底:15 分钟都找不回来才彻底认输(滚开几分钟不算)
  /* ★ 2026-10-27 分段续扫 + 2026-10-31 提速(评审稿《两档找品分工》第五节)
   * ----------------------------------------------------------
   * 分钟档的滚屏是**主路径之一**(B 方案:记忆 → 搜索 → 重试搜索 → 滚屏),
   * 所以它必须够快;但「反复滚」的老毛病已经由 scanDone(扫完一圈不再滚)拦住,
   * 不需要再靠长段间隔去压频。三个常量一起调:
   *   ① 单段 5→8 秒:一段走约 19 档,200 品从 10 段降到 4 段;
   *   ② 段间隔 6→1.5 秒:200 品光段与段之间就白等 54 秒,这是 98 秒的主因;
   *   ③ 观察窗 700→350ms:平台懒挂载实测 300~600ms,350 命中即回,每档从 760ms 降到 410ms。
   * 结果:200 品 ≈ 28 秒、100 品 ≈ 13 秒、50 品 ≈ 6 秒(调参前分别是 98 / 45 / 23 秒)。
   * ⚠ 观察窗不能再往下压到 250ms —— 那会开始漏行,而虚拟列表跳大步本身就必然漏,
   *   一档一档走是唯一不漏的办法(详见评审稿「为什么 200 个品做不到几秒」)。 */
  var SCAN_MS = 8000;        // 单段预算(2026-10-31:5→8 秒)
  var SCAN_GAP_MS = 1500;    // 段间隔(2026-10-31:6→1.5 秒,顺延这么久再接着扫,不记失败)
  var SCAN_OBS_MS = 350;     // 每档观察窗(2026-10-31:700→350ms,命中即回)
  /* 分钟档搜索失败后的重试(2026-10-31 用户定:重试 1 次、隔 5 秒)。
   * 为什么要重试:平台索引与列表渲染都有延迟,一次没搜到就判死会白滚一趟;
   * 为什么只重试一次:5 秒 + 2×2.9 秒已经花掉 11 秒,再多就不如直接滚。 */
  var SEARCH_RETRY_MS = 5000;
  var SEARCH_RETRY_MAX = 1;
  /* 段数上限(2026-10-27 用户给的口径:**小黄车上限 200 个品**)。
   * 按 200 品 ≈ 200×140px ≈ 28,000px 可滚、每档 0.8 屏(视口 600 时 ~480px)算 ⇒ 约 58 档;
   * 一段 8 秒能走约 19 档 ⇒ **200 品约 4 段**走完整张表(50 品 14 档,一段就够,见 scanNeed)。
   * 这个常量只是硬顶(防 maxScroll 变化导致永远绕不回起点);
   * 真正的段数按**实际可滚距离**推算(state.scanNeed)。 */
  var SCAN_MAX_SEG = 10;
  var ID_CONFIRM_TICKS = 2;     // 换品要连续两拍同键才认(去抖,防重渲染误判)
  var USER_BUSY_MS = 1500;      // 用户手势后让路时长(找款期间不抢滚动)

  var state = {
    on: false,              // 用户当面开关(胶囊上的那枚)
    minutes: DEF_MIN,
    group: 'sec',           // 'sec' | 'min' —— 当前启用的那一组(两个框互斥)
    seconds: SEC_DEF,
    skips: 0,               // 秒档连续跳过次数(到 SKIP_LIMIT 熔断)
    failSince: 0,           // 秒档第一次失败的时刻(5 分钟绝对兜底用)
    status: null,           // 面板第三行的异常说明 {text,kind};正常态为 null
    busyLabel: '',          // 动作期间胶囊槽里的词:定位中 / 搜索中
    stopped: false,
    phase: 'off',           // off | wait | run | error
    product: '',            // 当前讲解中的商品名(只用于显示与按名找回)
    key: '',                // ★ 2026-10-26:身份判据改用**稳定键**(商品 id / 名称前 8 字)
    pendingKey: '',         // 疑似换品的新键(去抖中)
    pendingName: '',
    pendingTicks: 0,
    lostStreak: 0,          // 连续几拍看不到那一行(只用于兜底判终止)
    startedAt: 0,           // 本轮讲解开始时刻
    nextAt: 0,              // 下一次续讲时刻
    round: 0,               // 续讲轮次(仅用于消息)
    /* 2026-11-01:round 会在换品时归零(commitProduct),所以它不能用来算"平均每轮多久"。
       另记一份只增不减的 cycles 与本次开启时刻,报告里直接给出「均 X 秒/轮」——
       判断后台到底跑没跑起来,不用再拿时间戳手算。 */
    cycles: 0,              // 本次开启以来完成的动作次数(不随换品归零)
    /* ★ 2026-11-06 弹卡优先的账本(诊断用,判断"新通道到底在不在工作"):
     *   popTries 点了几次 / popOk 几次被确认仍在讲 / popNone 几次没有可用按钮。
     *   popNone 持续增长 = 平台又改了文案或按钮换了位置,这时功能会自动退回老流程。 */
    popTries: 0,
    popOk: 0,
    popNone: 0,
    runSince: 0,            // 本次开启时刻
    /* ★ nap7 记账制(2026-11-01):我方**欠一次补讲**的时刻,0 = 不欠。
     *   点「取消讲解」时记账,补讲确认成功才销账。用它区分两种「商品不在讲解」:
     *   · 欠着账 ⇒ 是我们取消后续讲丢了,**必须补点**(商品不能空着没人讲)
     *   · 不欠账 ⇒ 不是我们取消的(用户手动 / 平台停) ⇒ 停表,绝不替用户重开
     *   为什么不再用旧的 selfCancelAt 时间窗口:那个窗口一旦被「进场看见在讲」
     *   清零(旧 2971 行),下一轮续讲实际丢了就只会跳过、永远不补 —— 两跳即熔断,
     *   正是 02:48 实机的死法。「用户手动取消」已由 onUserCancelClick(isTrusted)
     *   即时停表,这里不需要再猜时间窗口。 */
    owedResume: 0,
    softFails: 0,           // 状态确认类失败计数(不烧 skips 额度)
    /* nap8(2026-11-01)盲模式**阶段账本**:我方已经发出「取消讲解」的时刻,0 = 没有。
     *   置位后下一轮**无条件走补讲**,不再拿 DOM 判断"现在该取消还是该补讲" ——
     *   隐藏标签的 DOM 会冻结在「取消讲解」,拿它当判据就会永远认为还在讲、
     *   永远点取消,商品被取消后空着,表现为「切页面就再也不循环」。
     *   补讲落实与否交给下一轮读到「在讲」时销账,本轮不确认。 */
    cancelPending: 0,
    /* nap10:盲模式补讲轮「界面还没翻」已经探了几次(到 BLIND_WAIT_MAX 强制点一次) */
    blindWaits: 0,
    /* nap11:补讲的时刻 —— 之后 BLIND_SETTLE_MS 内读到「不在讲」只当界面没翻,不乱点 */
    blindSettled: 0,
    /* nap12:上一次主动点「刷新列表」的时刻(20 秒限频,别连刷) */
    blindRefreshAt: 0,
    fails: 0,
    retryAt: 0,
    busy: false,            // 动作互斥锁
    lastShotAt: 0,          // 上次动作时刻(睡眠唤醒对表用)
    cancelSeen: 0,          // 连续几拍看到「行在、但讲解中没了」⇒ 用户手动取消了
    keyGone: 0,             // 连续几拍「按 ID 找不到 + 列表总高变短」⇒ 商品真不在这一栏
    listH: 0,               // 商品列表的总高(判「下架」与「滚走没渲染」用)
    listHAt: 0,             // 上次量总高的时刻(限频 5 秒)
    missingSince: 0,        // 从哪一刻起看不到「讲解中」行(虚拟滚动回收时的宽限)
    scanPos: -1,            // 滚屏断点:下一段从哪个 scrollTop 接着扫(-1 = 还没开始扫)
    scanDone: false,        // 本商品是否已扫完一整圈(扫完就不再滚,只搜索)
    scanPrev: -1,           // 整段扫描开始前用户所在的 scrollTop(收尾要还原到这里)
    scanC: null,            // 整段扫描用的滚动容器(还原时要用同一个)
    scanSeg: 0,             // 已经扫了几段
    scanNeed: 0,            // 按可滚距离推算"整表要几段"(2026-10-27:50 品≈2 段 / 200 品≈8 段)
    /* ★ 跨轮定位记忆(2026-10-27 用户问「是不是有记忆功能,下次瞬间飞过去」):
     *   {container, offset} —— offset 是该行顶端在列表里的**绝对像素位置**(与 scrollTop 无关)。
     *   写入:① 第一次看见这一行时;② 每次续讲成功后按实际行重记;③ 滚屏命中的那一刻校准。
     *   读取:`revealRow()` 的**第一档起点**就是 offset-120 ⇒ 记忆准的话一档就到位(~60~300ms)。
     *   作废:换品(commitProduct)、停表(resetToWait)、搜索还原后列表重排(偏移不再成立)。
     *   ⚠ 只在内存里,不落盘:列表顺序在直播中随时会变,像素偏移跨场次必然失效 ——
     *     真要跨场次定位只能靠商品 ID 搜索,那是另一种机制。 */
    rowAnchor: null,
    anchorHits: 0,          // 记忆连续命中几次(落空即归零;诊断用,也说明"记忆靠不靠得住")
    /* ★ 无限模式(2026-11-05):开关 + 守夜账本。全部只在内存里,不落盘 ——
     *   开关值单独存 INFINITE_KEY;守夜进度、配额一律不记忆,
     *   刷新后从「按设定间隔重新起算」开始,避免恢复一个过期倒计时。 */
    infinite: false,        // 无限模式开关(缺省开,见 setup 的读盘口径)
    vigilAt: 0,             // 进守夜的时刻
    vigilLeft: 0,           // 上次退出守夜的时刻(抖动抑制用:60 秒内二次进入不重新加密)
    vigilWhy: '',           // 为什么进守夜(文案与诊断)
    probeAt: 0,             // 下一次只读探针的时刻
    probeCount: 0,          // 本次守夜探了几拍(诊断用)
    relocAt: 0,             // 下一次允许重定位的时刻(滑窗之外的兜底下限)
    relocLog: [],           // 最近几次重定位的时刻(滑窗判定,只留窗口内的)
    resumeAt: 0,            // 下一次允许补讲的时刻(冷却)
    resumeFails: 0,         // 连续补讲失败次数
    lastBtnSeen: 0,         // 最后一次看见任何「讲解 / 取消讲解」按钮的时刻(30 分钟兜底)
    /* ★ 2026-11-08 待命跟随(passive):1 = 用户刚取消讲解,循环在「等下一个品」。
     *   与普通守夜的区别只有一条:**绝不主动点「讲解」** ——
     *   普通守夜看到按钮翻回「讲解」会当拍补讲(接上同一个品),
     *   而待命是"这个品我不看了",补讲等于把用户刚关掉的讲解又点开。
     *   等页面出现**任意**正在讲解的商品(主播自己开的/平台连的)才接管。 */
    passive: 0,
    vigilPaintAt: 0         // 守夜文案上次刷新时刻(秒级刷新,不另开定时器)
  };

  var host = null;          // Shadow DOM 宿主(fixed)
  var shadow = null;
  var refs = {};            // 影子树里的节点引用
  var tickTimer = 0;
  var posTimer = 0;
  var cartHeader = null;    // 平台「直播商品(N)」那一行(锚点)
  var cartPanel = null;     // 小黄车面板容器(用于算左侧空间)
  var panelOpen = false;
  var drag = null;          // 滑条拖动状态
  var swipeClickUntil = 0;
  var setupSeq = 0;
  var setupPending = false;
  var masterEnabled = false;

  /* ==========================================================
   * 打断令牌(2026-10-27)
   * ----------------------------------------------------------
   * 用户原话:「3 次全局滚动搜索,浪费了我超多时间,而且我还不能强制停止」。
   * 一次续讲是一条 async 长链(定位 → 取消 → 等 1.2s → 续讲 → 校验),
   * 中途关胶囊 / 关总闸 / 用户手动取消讲解,旧版只是把定时器停了 ——
   * 已经在跑的这条链会一路跑完(包括继续滚屏与点击)。
   * ⇒ 每次进链记一个号,链上每个 await 之后比一次;号变了立刻退出并还原滚动。
   * ========================================================== */
  var abortSeq = 0;
  function abortCycle() { abortSeq += 1; }
  function aborted(mark) { return mark !== abortSeq; }

  /* ==========================================================
   * 二、纯函数(自测直接调这些,不碰 DOM)
   * ========================================================== */

  /** 分钟 → 百分比(滑条位置) */
  function pctOf(min) {
    return (min - MIN_MIN) / (MAX_MIN - MIN_MIN) * 100;
  }

  /* 2026-11-01 用户定:秒档四档统一「实际间隔 = (档位 − 3) 秒 + 0~3 秒随机」。
   *   面板按钮与读数仍显示标称值 —— 档位是「场景名」,不是精确秒数;
   *   真实范围由每档按钮内的小字注明(如 15 档 = 12~15 秒)。
   *   随机的核心收益:打散与自动刷新(10 秒 ±0.5 秒)的整数锁步碰撞
   *   (30/45/60 与 10 有公倍数,固定间隔会周期性撞车白烧一轮),
   *   顺带去机械节律、错开平台 DOM 翻回窗口的相位。 */
  var SEC_JITTER_MS = 3000;   // 每档随机浮动上限(含,即 0~3000ms)
  function intervalMs() {
    if (state.group !== 'sec') return state.minutes * 60000;
    return (state.seconds - 3) * 1000 + Math.floor(Math.random() * (SEC_JITTER_MS + 1));
  }
  function sliderMin() { return MIN_MIN; }
  function sliderMax() { return MAX_MIN; }
  function sliderValue() { return state.minutes; }
  function sliderPct(v) { return (v - MIN_MIN) / (MAX_MIN - MIN_MIN) * 100; }
  /* 滑条左右内缩(2026-11-02,与「超级福袋」那个滑条同一个修法):
   * 轨道撑满整宽,但滑钮与刻度的定位域要两端各让出**一个滑钮半径**,
   * 否则拉到 1 分钟/15 分钟时滑钮有半个身子伸到轨道外(用户截图指出
   * 福袋那边「最左最右轻微出界」,这里是同一套几何)。取 10px 覆盖按下
   * 时 20px 的尺寸;填充条仍从轨道最左端算起,宽度用 calc 算到滑钮圆心。 */
  var TRACK_INSET = 10;
  /** 秒档只能是四档之一;给什么值都吸到最近的一档 */
  function snapSec(v) {
    var best = SEC_TIERS[0], bd = 1e9;
    for (var i = 0; i < SEC_TIERS.length; i++) {
      var d = Math.abs(SEC_TIERS[i] - v);
      if (d < bd) { bd = d; best = SEC_TIERS[i]; }
    }
    return best;
  }

  /** 松手吸附:对齐 30 秒,落在推荐值 ±20 秒内直接吸过去 */
  function snapMinute(raw) {
    var v = Math.round(raw * 2) / 2;
    for (var i = 0; i < RECS.length; i++) {
      if (Math.abs(v - RECS[i]) < 0.35) { v = RECS[i]; break; }
    }
    return Math.min(Math.max(v, MIN_MIN), MAX_MIN);
  }

  /** 分钟 → 「5 分钟」/「6 分 30 秒」 */
  function fmtMinute(v) {
    var mm = Math.floor(v);
    var ss = Math.round((v - mm) * 60);
    if (ss === 60) { mm += 1; ss = 0; }
    return ss === 0 ? (mm + ' 分钟') : (mm + ' 分 ' + ss + ' 秒');
  }

  /** 名称比对键:去空白与标点、只留前 12 个有效字符 —— 平台重渲染后文字里常混进杂字符 */
  function keyOf(name) {
    return String(name || '').replace(/[\s\u00a0·•|/\\,，。.、:：;；\-—_()（）\[\]【】]/g, '').slice(0, 12);
  }

  /** 商品显示名：去店铺前缀，保留完整名称与尾款号，避免不同商品在消息里重名。 */
  function shortName(name) {
    var n = String(name || '').replace(/^【[^】]*】/, '').trim();
    if (!n) return '当前商品';
    return n;
  }

  /** 距最近档位的建议文案 */
  function adviceOf(v) {
    var best = ADVICE[0], bd = 1e9;
    for (var i = 0; i < ADVICE.length; i++) {
      var d = Math.abs(ADVICE[i].v - v);
      if (d < bd) { bd = d; best = ADVICE[i]; }
    }
    return best.html;
  }

  /** 落点属于哪一段色带 —— 交界值归**后**一段(5 分算「承接·利润」的开头) */
  function zoneOf(v) {
    for (var i = 0; i < ZONES.length - 1; i++) {
      if (v < ZONES[i].to) return ZONES[i];
    }
    return ZONES[ZONES.length - 1];
  }

  /** 倒计时文案 mm:ss */
  function fmtLeft(ms) {
    var s = Math.max(0, Math.round(ms / 1000));
    var m = Math.floor(s / 60);
    s = s % 60;
    return (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
  }

  /* ==========================================================
   * 三、DOM 小工具
   * ========================================================== */

  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  /** 元素的可读文本(压缩空白) */
  function txt(el) {
    if (!el) return '';
    return (el.textContent || '').replace(/\s+/g, ' ').trim();
  }

  /** 能不能程序化点到它 —— **不含视口条件**(AGENTS 第 53 条) */
  function clickable(el) {
    if (!el || !el.isConnected) return false;
    var r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return false;
    if (el.disabled) return false;
    if (el.getAttribute && el.getAttribute('aria-disabled') === 'true') return false;
    var st = window.getComputedStyle(el);
    if (st && st.pointerEvents === 'none') return false;
    return true;
  }

  /** 一次性发全套指针事件,但只发一次 click —— 平台有的在捕获阶段吞 click */
  function fireClick(el) {
    lastSelfClickAt = Date.now();
    function fire(type, pointer) {
      try {
        var ev = pointer ? new PointerEvent(type, { bubbles: true }) : new MouseEvent(type, { bubbles: true });
        el.dispatchEvent(ev);
        return true;
      } catch (e) { return false; }
    }
    // 老内核缺 PointerEvent 时仍保留鼠标按下/抬起；click 只在派发失败时补一次。
    fire('pointerdown', true);
    fire('mousedown', false);
    fire('pointerup', true);
    fire('mouseup', false);
    if (!fire('click', false)) {
      try { el.click(); } catch (e2) { /* 两条都失败就只能认了 */ }
    }
  }

  /* 页面真的被切到后台了吗?
   * 用 visibilityState === 'hidden',而不是 document.hidden ——
   * jsdom(自测沙箱)里 hidden 恒为 true、visibilityState 是 'prerender',
   * 用 hidden 会让所有自测都误走后台分支:路径错,而且每处等待要等兜底定时器(7 秒)。 */
  /* ★ nap8(2026-11-01):"看不见"的判据从 hasFocus 改成 **rAF 心跳**。
   *   为什么不用 hasFocus:jsdom 与部分老内核里它无条件返回 false,会整片误判成后台;
   *   而且切窗口(未最小化)时浏览器照常渲染、DOM 照常更新,那时根本不需要盲模式。
   *   rAF 是否在跑 = 渲染是否真的在推进,这才是"能否读到最新 DOM"的直接信号:
   *     · 切标签页 / 最小化 / 系统休眠 ⇒ rAF 停摆 ⇒ 盲
   *     · 切到别的窗口但页面仍被渲染 ⇒ rAF 照跑 ⇒ 前台(读得到新 DOM,不必盲)
   *   阈值 2 秒:正常情况下 rAF 每 16ms 一跑,2 秒停摆只可能是真被节流了。 */
  var RAF_STALE_MS = 2000;
  var lastRafAt = 0;
  (function rafTick() {
    if (typeof requestAnimationFrame !== 'function') return;   // jsdom / 极老内核:回退到可见性判据
    try {
      requestAnimationFrame(function () {
        lastRafAt = Date.now();
        rafTick();
      });
    } catch (e) { /* 忽略 */ }
  })();

  function pageHidden() {
    if (typeof document === 'undefined') return false;
    if (document.visibilityState === 'hidden') return true;
    if (lastRafAt && Date.now() - lastRafAt > RAF_STALE_MS) return true;
    return false;
  }

  /* 后台一律改走拍子驱动(见下面 nap),前台仍用 setTimeout 保精度。
     2026-11-01:上一版只把秒档的三处等待改成了 nap,而 fastHop / fastSearch /
     waitSearchRetry 里还有十几处 sleep —— 后台每处都被压到 60 秒,
     一轮照样要跑几分钟。堵在 sleep 这一层,模块内所有等待一次性变后台安全。 */
  function sleep(ms) {
    if (state && state.on && pageHidden()) return nap(ms);
    return new Promise(function (res) { setTimeout(res, ms); });
  }

  /* ==========================================================
   * 后台安全的等待(2026-11-01)
   * ----------------------------------------------------------
   * 用户反馈:「我没切回去,他就一直等我切回去;我一切回去他就自动继续讲解」。
   *
   * 根因:sleep() 用的是 setTimeout。Chrome 对「隐藏超过 5 分钟且不出声」的标签页,
   * **setTimeout 也会被压到最小 1 分钟一次**(不只是 setInterval)。秒档一轮要等三段:
   * 取消后 0.7s、等按钮翻转最多 20×150ms、点完校验最多 3s。后台时每段都变 60 秒
   * ⇒ 一轮要跑好几分钟,表现就是"卡住了,切回去才动"。
   * 闹钟只解决了"什么时候该动","怎么等"这一层还是坏的。
   *
   * 解法:后台改用**拍子驱动**的等待 —— 统一闹钟每秒来一拍,drainNaps 拿 Date.now()
   * 比较即可,完全不依赖 setTimeout。精度从毫秒降到 1 秒,但比停摆划算。
   * 前台仍走原来的 sleep,精度不变(前台不会被节流,没必要降级)。
   * ========================================================== */
  var napWaiters = [];
  /* 诊断用:分别记「拍子放行」和「兜底定时器放行」各多少次。
     后台动作到底走的是哪条路,看这两个数就够了 —— 前面几轮反复猜,
     就是因为这类事实没有摆到报告上。 */
  var napByBeat = 0;
  var napByTimer = 0;

  function nap(ms) {
    if (!pageHidden()) return sleep(ms);
    var wait = Math.max(0, ms | 0);
    return new Promise(function (resolve) {
      var w = { until: Date.now() + wait, res: resolve, timer: 0 };
      /* 兜底:万一拍子断了(闹钟异常),不能让 async 链永远挂着、busy 卡死。
         这个 setTimeout 自己也可能被节流,但至少能兜住"完全没有拍子"的情况。 */
      w.timer = setTimeout(function () {
        var i = napWaiters.indexOf(w);
        if (i >= 0) napWaiters.splice(i, 1);
        napByTimer += 1;
        resolve();
      }, wait * 3 + 5000);
      napWaiters.push(w);
    });
  }

  /** 每来一拍就放行到期的等待者。由统一闹钟的消息回调驱动。 */
  function drainNaps() {
    if (!napWaiters.length) return;
    var now = Date.now();
    var keep = [];
    for (var i = 0; i < napWaiters.length; i++) {
      var w = napWaiters[i];
      if (now >= w.until) {
        if (w.timer) { clearTimeout(w.timer); w.timer = 0; }
        napByBeat += 1;
        w.res();
      } else {
        keep.push(w);
      }
    }
    napWaiters = keep;
  }

  /** 停表时把还挂着的等待全部放行,避免 async 链悬着、busy 不复位。 */
  function flushNaps() {
    var list = napWaiters;
    napWaiters = [];
    for (var i = 0; i < list.length; i++) {
      if (list[i].timer) { clearTimeout(list[i].timer); list[i].timer = 0; }
      list[i].res();
    }
  }
  /* 2026-10-26(#117 后半):用户在动鼠标/滚轮时,找款脚本必须让路。
   * 原来两边抢同一个 scrollTop —— 用户一滚,找款必然失败,还白记一次失败。
   * 现在只记一个到期时刻:闸门期内不抢滚动、不计失败、顺延重试。 */
  var userBusyUntil = 0;
  function noteUserGesture() { userBusyUntil = Date.now() + USER_BUSY_MS; }
  function userBusy() { return Date.now() < userBusyUntil; }

  /* ==========================================================
   * 用户手动「取消讲解」的即时识别(2026-10-27)
   * ----------------------------------------------------------
   * 用户原话:「我点取消讲解,但是你的按钮没反应过来我已经取消讲解了,时间一到用了 3 次
   *   全屏滚动搜索找一个本应该在【讲解】的款」。
   * 旧版只有一条路:checkNow 每 2 秒轮询「行还在、讲解中没了」,要连续两拍才认(最长 4 秒),
   * 而且行一旦被虚拟滚动回收就完全看不见。
   * 现在直接在**捕获阶段**接真人点击:按钮写着 取消/结束/停止讲解 ⇒ 立刻停表 + 中止在跑的链。
   * ★ 只认 e.isTrusted —— 我们自己的 fireClick 是合成事件,必须放过,
   *   否则每轮「取消→续讲」都会被自己判成「用户取消」。
   *
   * ★ 2026-11-07(#133「无限循环模式会自动停止」):
   *   实机 timeline 四次停表(10:54:44 / 11:03:51 / 11:26:09 / 11:33:42)全部出自这里,
   *   另外四个出口一条日志都没有。最后一次尤其不对:11:33:41.6 用户点的是**导航搜索框**
   *   (#dyb-nav-input),1.15 秒后就判成了「用户手动取消讲解」—— 点搜索框不可能是取消讲解。
   *   能把两者连起来的只有一条链:平台的讲解卡/浮层盖在列表上方,真人点那一下时
   *   捕获阶段读到的「取消讲解」在浮层里,不在商品行里。
   *   ⇒ 对 DOM 是真点击,对循环却不等于「停掉整条循环」。
   *   所以把命中拆两档 + 加复核(详见函数内注释)。
   * ========================================================== */
  var CANCEL_CONFIRM_MS = 800;    // 行内取消点下去后,等标记真消失才停表
  var cancelProbeSeq = 0;         // 复核令牌:连点两次时只认最后一次
  function onUserCancelClick(e) {
    if (!e || !e.isTrusted) return;
    if (!state.on) return;
    /* ★ 2026-11-05:守夜(vigil)也必须认这一下。
     *   否则会出现最糟的一幕:用户在守夜里滚回那一行、亲手点了「取消讲解」,
     *   我们因为 phase 不是 run/error 而忽略,紧接着探针读到按钮变「讲解」,
     *   当成"真断了"当场补讲 —— 等于把用户刚关掉的讲解又强行打开。
     *   守夜不是"暂停",是循环还在跑,所以真人意图必须优先。 */
    if (state.phase !== 'run' && state.phase !== 'error' && state.phase !== 'vigil') return;
    var el = e.target;
    if (!el) return;
    var s = '';
    for (var i = 0; i < 3 && el; i++) {          // 按钮里常套一层 span,往上找两下就够
      s = txt(el);
      if (s === '取消讲解' || s === '结束讲解' || s === '停止讲解') break;
      el = el.parentElement;
    }
    if (s !== '取消讲解' && s !== '结束讲解' && s !== '停止讲解') return;

    /* 命中元素的落点归属:它到底在商品行里,还是在讲解卡 / 浮层里?
     * 判据只用结构,不用坐标 —— 缩放、transform 都会让坐标算错。 */
    var hit = el;
    var hitInfo = '<' + String(hit.tagName || '').toLowerCase() + '>「' + s + '」'
      + ' 距上次合成点击 ' + Math.round(Date.now() - lastSelfClickAt) + 'ms';
    var list = [];
    try { list = rows(); } catch (e1) { list = []; }
    var inRow = false;
    for (var j = 0; j < list.length; j++) {
      if (list[j] === hit || list[j].contains(hit)) { inRow = true; break; }
    }
    if (!inRow) {
      /* 行集合抓不全时(虚拟滚动间隙)再用平台行容器的属性复核一次。 */
      var up = hit;
      for (var k = 0; k < 12 && up && up !== document.body; k++) {
        if (up.getAttribute && up.getAttribute('data-rbd-draggable-id')) { inRow = true; break; }
        up = up.parentElement;
      }
    }
    if (list.length && !inRow) {
      /* 浮层里的取消讲解 = 用户关掉了一张卡,不是要停整条循环。
       * 不停表:下一轮自己会按原节奏弹卡/续讲(无限模式尤其不能因为这一下就死)。 */
      noteDiag('取消讲解命中｜' + hitInfo + '｜不在商品行内(讲解卡/浮层) ⇒ 只关卡片,循环继续');
      return;
    }

    /* 行内点击:先掐断在跑的链(别再补点一下),800ms 后复核这一行是不是真的不讲了。
     * 平台把按钮在「弹出讲解卡 / 讲解 / 取消讲解」之间同位翻转,
     * 真人在那一刻顺手点到,标记根本不会消失 —— 那种情况继续循环。 */
    abortCycle();
    var tok = ++cancelProbeSeq;
    noteDiag('取消讲解命中｜' + hitInfo + '｜' + (inRow ? '在商品行内' : '行结构量不到')
      + ' ⇒ ' + CANCEL_CONFIRM_MS + 'ms 后复核讲解标记');
    setTimeout(function () {
      if (tok !== cancelProbeSeq) return;        // 期间又点了一次,以后者为准
      if (!state.on) return;
      var rowNow = null;
      try { rowNow = findRowByKey(); } catch (e2) { rowNow = null; }
      var still = false;
      if (rowNow) { try { still = isLecturing(rowNow); } catch (e3) { still = false; } }
      if (still) {
        noteDiag('取消讲解复核｜该行仍显示讲解中 ⇒ 判为误触,继续循环');
        return;
      }
      var who = productName();                   // 「谁在被执行」先取,reset 之后 state 就空了
      var value = stopValue();                   // 「已停止 · 共 N 轮」也先取(setOn 之后 state 就清了)
      /* ★ 2026-11-08 用户口径:「点了取消讲解不应该停,而是保持等待下一个讲解的品开始讲解才继续跟进」。
       *   旧版这里 setOn(false, true) 硬停 —— 一次顺手取消、一次误判,整场循环就没了,
       *   用户以为是「不知为何自己停了」,还得手动重开开关。
       *   现在交给待命态接手:不点、不搜、不补讲这个品,等页面上出现新的讲解就跟上。
       *   ⚠ 唯一的真停在 30 分钟兜底(距上一次循环介入超过 30 分钟,用户 2026-11-08 认可)。 */
      diagOnce('user-cancel', '用户手动取消讲解(复核后确认) ⇒ 进待命,等下一个讲解的商品');
      if (enterVigil('手动取消', true)) return;   // 消息由 enterVigil 统一发一条,这里不再重复
      setOn(false, true);
      /* 2026-10-27:这条也写进盒子的 cycle 那条(而不是新加一行)——
       * 否则盒子会一直停在「已续讲 · 第 N 轮」,让事后回看的人以为还在跑。
       * 段位同口径:值=商品名,状态进右端。 */
      boxNote(BOX_CYCLE, 'info', who, value + ' · 手动取消');
    }, CANCEL_CONFIRM_MS);
  }


  /* ==========================================================
   * 四、认出小黄车与「讲解中」
   *
   * 平台 DOM 用哈希类名,不可靠;这里一律按**文本 + 结构**认:
   *   · 锚点行:商品列表 tab 文案(待上架商品 / 直播商品 / 已下架 …),高度 < 50;
   *     兜底才用旧口径「直播商品(N)」标题行
   *   · 商品行:locate.js 的 getAllProductRows()(等距行 ∪ 结构锚补捞)
   *   · 讲解中:行内出现「讲解中」,或行内按钮写着「取消讲解 / 结束讲解」
   *   · 讲解按钮:「讲解」二字单独成按钮,不在标题行、不在别的行
   * ========================================================== */

  /* 2026-10-25 改落点(用户指定):胶囊挂在商品列表 tab 行的右侧空白
   * ——截图里「待上架商品」右边那块。之前的「直播商品(N) 行右端」离设置/添加太挤,
   * 而 tab 行右侧天然空着,视线也在同一行。tab 文案随用户切页会变,所以按**一组文本**
   * 认,并保留旧口径(直播商品(N) 标题行)当兜底。 */
  var TAB_TEXTS = ['待上架商品', '直播商品', '已下架', '已售罄', '全部商品'];
  var anchorMissAt = 0;
  var anchorMode = 'title';        // title = 标题行内固定偏移;tab = 退到 tab 文案右侧;header = 旧口径
  var anchorRow = null;            // 标题行容器(tab 与刷新按钮所在的那一行)
  var anchorTab = null;            // tab 文案节点(用来算「别压到它」)
  /* 按钮左边缘 = 标题行左边缘 + 这个偏移。
   * 用户 2026-10-25 要求「不要浮动,要固定位置」:贴着 tab 文案走的话,
   * tab 文案一换(直播商品 / 待上架商品 / 已下架)按钮就左右漂。
   * 改成绑定**行**的固定偏移后,文案怎么换它都不动。 */
  var TITLE_OFFSET = 344;         // = 面板宽度,方便记忆;需要微调只改这一个数
  var anchorMissingAt = 0;         // 锚点短暂消失的起点(面板不因此关闭)

  // 一拍内复用同一节点的矩形；数组仅活到本次 place 返回。
  function rectOnce(el, readings) {
    if (!readings) return el.getBoundingClientRect();
    for (var i = 0; i < readings.length; i++) {
      if (readings[i].el === el) return readings[i].rect;
    }
    var rect = el.getBoundingClientRect();
    readings.push({ el: el, rect: rect });
    return rect;
  }

  function findAnchor(readings) {
    if (cartHeader && cartHeader.isConnected && rectOnce(cartHeader, readings).height > 8) {
      return cartHeader;
    }
    cartHeader = null;
    // 找不到时退避 3 秒再扫 —— place() 每 250ms 一次,不能每次都全页找
    if (anchorMissAt && Date.now() - anchorMissAt < 3000) return null;

    // 先按**文本**粗筛(纯字符串,不触发布局),再对极少数候选读矩形
    var cands = $$('div, span, a, li, button').filter(function (el) {
      var t = txt(el);
      return t.length <= 10 && TAB_TEXTS.indexOf(t) >= 0;
    });
    for (var i = 0; i < cands.length; i++) {
      var el = cands[i];
      var r = el.getBoundingClientRect();
      if (r.width < 20 || r.width > 220) continue;
      if (r.height < 12 || r.height > 50) continue;
      var row = findTitleRow(el);
      if (row) {
        anchorMode = 'title';
        anchorRow = row;
        anchorTab = el;
        cartHeader = row;
        return row;
      }
      anchorMode = 'tab';          // 找不到行就退回贴文案(至少不会消失)
      anchorTab = el;
      cartHeader = el;
      return el;
    }

    var legacy = findCartHeaderLegacy();   // 旧口径兜底
    if (legacy) { anchorMode = 'header'; cartHeader = legacy; return legacy; }
    anchorMissAt = Date.now();
    return null;
  }

  /**
   * 从 tab 文案往上找到「标题行」—— 这一行同时装着 tab 与右侧的刷新按钮,
   * 宽度接近整个小黄车面板、高度只有一行(≤80px)。
   * 它的**左边缘**是稳定基准:tab 文案怎么变,那个点都不动。
   */
  function findTitleRow(tabEl) {
    var el = tabEl;
    for (var i = 0; i < 6 && el && el !== document.body; i++) {
      var r = el.getBoundingClientRect();
      if (r.width >= 320 && r.height >= 20 && r.height <= 80) return el;
      el = el.parentElement;
      if (!el) return null;
    }
    return null;
  }

  /** 这一排 tab 的最右边缘(切 tab 不变;找不到就退回当前 tab) */
  function tabsRightEdge(row) {
    var base = row || document;
    var cands = $$('div, span, a, li, button', base).filter(function (el) {
      var t = txt(el);
      return t.length <= 10 && TAB_TEXTS.indexOf(t) >= 0;
    });
    var max = 0;
    for (var i = 0; i < cands.length; i++) {
      var r = cands[i].getBoundingClientRect();
      if (r.width < 20 || r.width > 220) continue;
      if (r.height < 12 || r.height > 50) continue;
      if (r.right > max) max = r.right;
    }
    if (!max && anchorTab && anchorTab.isConnected) max = anchorTab.getBoundingClientRect().right;
    return max || 0;
  }

  /** 标题行里的原生「刷新列表」按钮(找到就把我们的按钮排在它左边) */
  function findRefreshInRow(row, readings) {
    if (!row) return null;
    var cands = $$('button, span, div, a', row);
    for (var i = 0; i < cands.length; i++) {
      var el = cands[i];
      if (txt(el).indexOf('刷新列表') !== 0) continue;
      var r = rectOnce(el, readings);
      if (r.width < 30 || r.width > 160 || r.height < 12 || r.height > 50) continue;
      return el;
    }
    return null;
  }

  /** 旧口径:文本形如「直播商品(N)」的标题行 */
  function findCartHeaderLegacy() {
    var probe = findHeaderByRows();      // 先走「按行反推」:比全页扫文本更稳
    if (probe) return probe;
    var cands = $$('div, span, header, section').filter(function (el) {
      var t = txt(el);
      return t.length <= 24 && t.indexOf('直播商品') === 0;
    });
    for (var i = 0; i < cands.length; i++) {
      var el = cands[i];
      var r = el.getBoundingClientRect();
      if (r.height < 12 || r.height > 70) continue;
      if (r.width < 180) continue;
      if (!/^直播商品\s*[((]?\s*\d*\s*[))]?/.test(txt(el))) continue;
      return el;
    }
    return null;
  }

  /** 兜底:从第一行商品往上爬,找到含行的小黄车容器,再取它的第一个子块当标题行 */
  function findHeaderByRows() {
    var list = rows();
    if (!list || !list.length) return null;
    var el = list[0];
    for (var i = 0; i < 8 && el && el !== document.body; i++) {
      el = el.parentElement;
      if (!el) return null;
      var r = el.getBoundingClientRect();
      if (r.width < 260 || r.height < 160) continue;
      var first = el.firstElementChild;
      if (!first) return null;
      var fr = first.getBoundingClientRect();
      if (fr.height > 8 && fr.height < 70) return first;
      return null;
    }
    return null;
  }

  function rows() {
    try {
      if (typeof getAllProductRows === 'function') {
        var r = getAllProductRows();
        if (r && r.length) return r;
      }
    } catch (e) { /* 落到下面 */ }
    /* 兜底一:从页面上真实存在的「讲解 / 取消讲解」小按钮往上翻行 ——
     * 比按文本扫 div 准得多(2026-10-25 用户报「同 tab 也识别不到」后改)。 */
    var out = [];
    $$('button, span, div, a').forEach(function (el) {
      var t = txt(el);
      /* 2026-11-06:三种按钮态都算"行里有讲解控件" —— 新文案「弹出讲解卡」
       * 如果不认,商品行在兜底扫描里就整类消失,循环会"找不到行"。 */
      var k = kindOfText(t);
      if (k !== 'start' && k !== 'stop' && k !== 'pop') return;
      var rc = el.getBoundingClientRect();
      if (rc.width < 18 || rc.width > 160 || rc.height < 12 || rc.height > 60) return;
      var up = el;
      for (var k = 0; k < 10 && up && up !== document.body; k++) {
        up = up.parentElement;
        if (!up) break;
        var ur = up.getBoundingClientRect();
        if (ur.height >= 40 && ur.height <= 260 && ur.width >= 200) {
          if (out.indexOf(up) < 0) out.push(up);
          break;
        }
      }
    });
    if (out.length) return out;
    /* 兜底二:含「讲解」字样、行高合理的 div */
    $$('div').forEach(function (el) {
      var t = txt(el);
      if (t.length > 6 && t.indexOf('讲解') >= 0) {
        var rc = el.getBoundingClientRect();
        if (rc.height > 30 && rc.height < 220) out.push(el);
      }
    });
    return out;
  }

  /* 行内按钮的**四种态**(2026-11-06:从「一串精确文案」升级为「态分类」)
   * ----------------------------------------------------------
   * 为什么必须分态:平台这天把「讲解中」那一行的按钮换成了「弹出讲解卡」——
   * 点它**不取消讲解**,只把讲解卡重新弹起。旧代码只认 讲解/取消讲解 这几个词,
   * 于是:① 宽松档(length≤6 且含「讲解」)照样点得中它,看着像在跑;
   * ② 但每处「按钮原文等于『讲解』」的等值判断都等不到翻转,7 秒后报「取消未确认」,
   *    连报 6 次进守夜、同款不再轮转(反馈 #131)。分态之后,"拿错态当这件事"在代码里就不再可能。
   *   start —— 可以开始讲解(商品不在讲解中)
   *   stop  —— 正在讲解,点它会取消讲解
   *   pop   —— 正在讲解,点它只重新弹卡,讲解不断(平台新按钮)
   *   mark  —— 状态标记,不是按钮(讲解中 / 正在讲解)
   */
  var START_TEXTS = ['讲解', '开始讲解'];
  var STOP_TEXTS = ['取消讲解', '结束讲解', '停止讲解'];
  var MARK_TEXTS = ['讲解中', '讲解中…', '讲解中...', '正在讲解'];
  /* 「弹出讲解卡 / 弹起讲解卡 / 重新弹出讲解卡 / 弹出讲解卡片」全归 pop。
   * 必须锚定开头:否则商品名叫「讲解卡片收纳盒」也会被当成按钮。
   * 用正则而不是穷举:平台改一个字就得重发版,穷举必漏。 */
  var POP_RE = /^(?:重新)?(?:弹出|弹起)[\s\S]{0,2}讲解|^讲解卡(?:片)?$/;

  /** 按钮文案 → 态。纯函数,自测直接表驱动断言(不碰 DOM)。 */
  function kindOfText(t) {
    var s = String(t == null ? '' : t).replace(/\s+/g, '');
    if (!s || s.length > 12) return '';        // 长文本是标题/说明,不是按钮
    if (MARK_TEXTS.indexOf(s) >= 0) return 'mark';
    if (POP_RE.test(s)) return 'pop';
    if (STOP_TEXTS.indexOf(s) >= 0) return 'stop';
    if (START_TEXTS.indexOf(s) >= 0) return 'start';
    return '';
  }

  /** 元素 → 态(空串 = 认不出) */
  function kindOf(el) { return el ? kindOfText(txt(el)) : ''; }

  function findLectureBtn(row) {
    var cands = $$('button, [role="button"], span, div, a, i', row);
    var hit = null, hitKind = '';
    cands.forEach(function (el) {
      var t = txt(el);
      var label = (el.getAttribute && (el.getAttribute('title') || el.getAttribute('aria-label'))) || '';
      var kind = kindOfText(t);
      /* 宽松档只给"认不出态"的旧文案兜底;pop 已被显式归类,不再混进来当开始/取消。 */
      var okText = !!kind || (t.length <= 6 && t.indexOf('讲解') >= 0);
      /* title / aria-label 上的文案同样按态认(不能退回一串写死的词 ——
       * 2026-11-06 拆分态时这里漏改,就是一处"语法通过、运行时崩"的活口)。 */
      var okLabel = !!kindOfText(label) || label.indexOf('讲解') >= 0;
      if (!okText && !okLabel) return;
      if (kind === 'mark') return;             // 状态标记不是按钮
      var r = el.getBoundingClientRect();
      if (r.width < 18 || r.height < 12 || r.width > 200 || r.height > 60) return;
      if (!clickable(el)) return;
      /* stop 信息量最大(既证明在讲、又能取消),同层命中时优先返回它;
       * 其余情况仍取最内层那一枚(外层容器文本相同但尺寸更大,已被尺寸闸挡掉)。 */
      var inner = !hit || el.contains(hit) === false;
      if (!hit || (kind === 'stop' && hitKind !== 'stop') || inner) { hit = el; hitKind = kind; }
    });
    return hit;
  }

  /** 行内找指定态的按钮。2026-11-06 起所有流程都**按态取按钮**,
   *  不再拿"随便哪一枚讲解按钮"充当取消/讲解 —— 那正是 #131 的错法。 */
  function findBtnByKind(row, kinds) {
    if (!row) return null;
    var cands = $$('button, [role="button"], span, div, a, i', row);
    var hit = null;
    for (var i = 0; i < cands.length; i++) {
      var el = cands[i];
      var kind = kindOfText(txt(el));
      if (!kind || kinds.indexOf(kind) < 0) continue;
      var r = el.getBoundingClientRect();
      if (r.width < 18 || r.height < 12 || r.width > 200 || r.height > 60) continue;
      if (!clickable(el)) continue;
      if (!hit || el.contains(hit) === false) hit = el;   // 取最内层
    }
    return hit;
  }
  function findPopBtn(row) { return findBtnByKind(row, ['pop']); }
  function findStopBtn(row) { return findBtnByKind(row, ['stop']); }
  function findStartBtn(row) { return findBtnByKind(row, ['start']); }

  /* 平台这枚「弹出讲解卡」有两种形态:行内按钮,以及商品行左侧滑出的独立浮层按钮
   * (用户原话「左边滑出的」)。行内找不到就全页找一次 ——
   * 判据是文案态 + 尺寸 + 可点,取面积最小的那个(最内层),不会命中整块面板。 */
  function findPopBtnPage() {
    var cands = $$('button, [role="button"], a, span, div');
    var best = null, bestArea = Infinity;
    for (var i = 0; i < cands.length; i++) {
      var el = cands[i];
      try { if (insideOwnUI(el)) continue; } catch (e) { /* 忽略 */ }
      var t = txt(el);
      if (!t || t.length > 8) continue;
      if (kindOfText(t) !== 'pop') continue;
      var r = el.getBoundingClientRect();
      if (r.width < 24 || r.height < 16 || r.width > 240 || r.height > 64) continue;
      if (!clickable(el)) continue;
      var area = r.width * r.height;
      if (area < bestArea) { best = el; bestArea = area; }
    }
    return best;
  }

  /** 当前讲解中的行 */
  function findLiveRow() {
    var list = rows();
    for (var i = 0; i < list.length; i++) {
      var row = list[i];
      var t = txt(row);
      if (t.indexOf('讲解中') >= 0) return row;
      var b = findLectureBtn(row);
      /* 2026-11-06:stop(取消讲解)与 pop(弹出讲解卡)都说明"这一行正在讲"。 */
      var k = b ? kindOf(b) : '';
      if (k === 'stop' || k === 'pop') return row;
    }
    /* 兜底(2026-10-25 用户报「一直在同一个 tab 也识别不到」后加强):
     * 行集合(rows)本身可能抓不全 —— 那就反过来:先找页面上所有「讲解中」标记,
     * 再沿祖先链找**装着讲解按钮**的那一层,那一层才是真正的商品行。 */
    var marks = findAllLecturingMarks();
    for (var m = 0; m < marks.length; m++) {
      var el = marks[m];
      for (var k = 0; k < 12 && el && el !== document.body; k++) {
        if (findLectureBtn(el)) return el;       // 最准:祖先里有「讲解/取消讲解」按钮
        el = el.parentElement;
      }
      // 没按钮时退回「文本足够长、但还不至于是一整片列表」的那一层
      el = marks[m];
      for (var k2 = 0; k2 < 12 && el && el !== document.body; k2++) {
        var len = txt(el).length;
        if (len > 12 && len < 400) return el;
        el = el.parentElement;
      }
    }
    return null;
  }

  /**
   * 这一行**此刻**是不是正在讲解(2026-10-27)。
   * 只认两种证据:行内「讲解中」标记,或行内按钮写着 取消/结束/停止讲解。
   * 用来挡一件事:靠滚动找回的行如果只是「普通商品行」(用户早已取消),
   * 我们绝不能替他把讲解又点开 —— 那既违背意图,也白费一轮滚屏。
   */
  function isLecturing(row) {
    if (!row) return false;
    var b = findLectureBtn(row);
    if (b) {
      var k = kindOf(b);
      if (k === 'stop' || k === 'pop') return true;
    }
    var marks = findAllLecturingMarks();
    for (var i = 0; i < marks.length; i++) {
      var mk = marks[i];
      /* ★ 2026-11-06 收紧:只在**本行内**认标记。
       *   旧的「标记包含此行」写法会把包住整页的容器当成"这一行有标记",
       *   DOM 里别处残留一枚「讲解中」就能把这行判成在讲 —— 反馈 #131 的
       *   「商品明明没换、按钮也不是取消讲解,却一直判在讲」就是它放过去的。 */
      if (row === mk || row.contains(mk)) return true;
    }
    return false;
  }

  /** ★ nap14(2026-11-01 用户截图 + 明确指令):
   *   平台在「商品刚开价」时点取消讲解,会弹:
   *     「确认取消讲解？ 当前商品刚开价,此时取消讲解卡会收回,是否确认取消？」
   *   **用户要的是点【取消】**(放弃这次取消,保住讲解卡),不是点确定。
   *   为什么:刚开价 = 正在卖,把讲解卡收回是坏事;这一轮当作「不取消」过去,
   *   循环照常继续,不要卡 7 秒、不要报「取消讲解未确认」。
   *   ⚠ 只认文案含「确认取消讲解」的弹窗容器,只在容器内找「取消」,
   *     不会误点页面别处的取消按钮。用户自己点取消时 onUserCancelClick 已先停表。
   *   返回 true = 点掉了(本轮应直接结束,别再等按钮翻转)。 */
  var lastConfirmAt = 0;
  function dismissCancelConfirm() {
    var now = Date.now();
    if (now - lastConfirmAt < 300) return false;   // 限频:全页找容器很贵
    lastConfirmAt = now;
    var boxes = [];
    try {
      boxes = $$('[role="dialog"], [role="alertdialog"], .auxo-modal, .auxo-modal-content, .auxo-modal-wrap');
    } catch (e) { boxes = []; }
    for (var i = 0; i < boxes.length; i++) {
      var el = boxes[i];
      var t = '';
      try { t = txt(el); } catch (e) { continue; }
      if (t.indexOf('确认取消讲解') < 0) continue;
      if (t.length > 240) continue;                // 排除把整页包进去的容器
      var btns = $$('button, [role="button"]', el);
      for (var j = 0; j < btns.length; j++) {
        var b = btns[j];
        if (txt(b) !== '取消') continue;           // ★ 点【取消】= 放弃这次取消
        if (!clickable(b)) continue;
        fireClick(b);
        return true;
      }
    }
    return false;
  }

  /** 行内「讲解」按钮的文案(诊断用):没有按钮返回 '无' */
  function btnLabelOf(row) {
    try {
      var b = findLectureBtn(row);
      return b ? txt(b) : '无';
    } catch (e) { return '查不了'; }
  }

  /** 原生「刷新列表」按钮(nap12:用来**催**平台把真实状态刷回来)。
   *  严格按文案前缀匹配 + 长度上限,不会误点同排的「设置」「商品推荐卡」等邻居。
   *  隐藏标签里 rect 可能是旧快照甚至全 0,所以不把尺寸当硬闸 ——
   *  只排除明显的整行/整页容器(那会点到外面去)。 */
  function findListRefreshBtn() {
    var scope = document;
    try { scope = findAnchor() || document; } catch (e) { scope = document; }
    var cands = $$('button, span, div, a', scope);
    for (var i = 0; i < cands.length; i++) {
      var el = cands[i];
      var t = txt(el);
      if (t.indexOf('刷新列表') !== 0) continue;
      if (t.length > 8) continue;                  // 「刷新中…」这类过程态不接
      if (el.disabled) continue;
      var r = el.getBoundingClientRect();
      if (r.width > 200 || r.height > 60) continue;
      return el;
    }
    return null;
  }

  /** 页面上**所有**「讲解中」小标记(不止第一枚) */
  function findAllLecturingMarks() {
    var out = [];
    var cands = $$('span, div, i, em, b');
    for (var i = 0; i < cands.length; i++) {
      var el = cands[i];
      var t = txt(el);
      if (t !== '讲解中' && t !== '正在讲解' && t !== '讲解中…') continue;
      var r = el.getBoundingClientRect();
      if (r.width < 8 || r.width > 160 || r.height < 8 || r.height > 40) continue;
      out.push(el);
      if (out.length >= 8) break;
    }
    return out;
  }

  /** 商品列表的滚动容器(虚拟滚动就发生在它身上) */
  function scrollHostOf(el) {
    for (var n = el.parentElement; n && n !== document.body; n = n.parentElement) {
      var st = window.getComputedStyle(n);
      if (!/(auto|scroll|overlay)/.test(st.overflowY || '')) continue;
      if (n.scrollHeight > n.clientHeight + 20) return n;
    }
    return null;
  }

  /** 记住这一行在滚动容器里的偏移 —— 行被回收后靠它把行滚回来 */
  function recordRowAnchor(row) {
    var c = scrollHostOf(row);
    if (!c) return null;
    var rr = row.getBoundingClientRect();
    var cr = c.getBoundingClientRect();
    return { container: c, offset: Math.round(rr.top - cr.top + c.scrollTop) };
  }

  /**
   * 「记忆探针」:直接飞到上次找到它的位置看一眼(2026-10-27 用户提出)。
   * ----------------------------------------------------------
   * 用户原话:「如果通过滚屏找到了该品,那下次进行循环讲解你是不是有了记忆功能,
   *          可以瞬间知道那个品在哪里,瞬间飞过去找到那个品」。
   * 记忆其实早就在(`state.rowAnchor.offset`),但原先只当**滚屏的起点**,
   * 也就是排在第三顺位 —— 前面还挡着原生搜索(≤2.6 秒、会临时把列表筛成 1 行)。
   * 既然同一件商品在直播中的位置基本不变,记忆该先用:
   *   · 只动滚动、不动筛选 ⇒ 对用户干扰最小(列表不会突然只剩一行);
   *   · 一档到位的常见耗时 0.1~0.8 秒,比搜索还快;
   *   · 落空就当没发生过 —— **不碰 scanPos / scanPrev**,不占分段扫的额度、不留错断点,
   *     交给上层照原路走(搜索 → 分段扫)。
   * 返回:'abort' / 'busy' / {row, container, prevScroll}(命中) / null(没记忆或没命中)。
   */
  async function probeAnchor(mark) {
    var a = state.rowAnchor;
    if (!a || !a.container || !a.container.isConnected) return null;
    if (typeof a.offset !== 'number') return null;
    var c = a.container;
    var maxScroll = Math.max(0, c.scrollHeight - c.clientHeight);
    if (maxScroll < 8) return null;                  // 一屏就装下了 ⇒ 不需要"飞"
    if (a.offset > maxScroll + 200) {                // 记忆越界(列表变短/商品被删)⇒ 作废
      diagOnce('anchor-stale', '记忆越界(' + a.offset + 'px > 可滚 ' + maxScroll + 'px)⇒ 不用它');
      return null;
    }
    if (userBusy()) return 'busy';
    var prev = c.scrollTop;
    var target = Math.max(0, Math.min(maxScroll, a.offset - 120));
    c.scrollTop = target;
    window.__dycScriptScrollAt = Date.now();         // 程序化滚动打点(项目约定,auto-refresh 也读它)
    await sleep(60);
    if (aborted(mark)) {
      c.scrollTop = prev;
      window.__dycScriptScrollAt = Date.now();
      return 'abort';
    }
    for (var k = 0; k < Math.round(SCAN_OBS_MS / 100); k++) {   // 观察窗内命中即回
      await sleep(100);
      if (aborted(mark)) {
        c.scrollTop = prev;
        window.__dycScriptScrollAt = Date.now();
        return 'abort';
      }
      var row = findRowByName(state.product);
      /* 有行但**没有讲解按钮** ⇒ 不算命中(用户可能已经取消了,别把它当成找到) */
      if (row && findLectureBtn(row)) {
        state.anchorHits = (state.anchorHits || 0) + 1;
        return { row: row, container: c, prevScroll: prev };
      }
    }
    c.scrollTop = prev;
    window.__dycScriptScrollAt = Date.now();
    state.anchorHits = 0;                            // 记忆过期 ⇒ 计数归零,下次重新靠搜索校准
    diagOnce('anchor-miss', '记忆位置没看到目标 ⇒ 退回搜索/分段扫');
    return null;
  }

  /**
   * 把目标行滚回可见区并重新拿到它(虚拟滚动回收后的兜底)。
   * 只在对点续讲那一刻用,用完把滚动位置还原。
   *
   * ★ 2026-10-26 重写(#115「滚动是表面功夫,根本没生效」+#117「动鼠标就失败」):
   *   ① 单档轮询 280ms → 700ms(命中即回)。平台虚拟列表懒挂载常在 300~600ms,
   *      旧口径每档都判「没找到」,24 档全过仍然返回 null,用户看到的就是「滚了但没找着」。
   *   ② 容器自校准:赋值 scrollTop 后回读,差 >2px 说明这不是能滚的那个容器
   *      (虚拟列表可能在外层),立刻换候选,不再空转 24 档。
   *   ③ 用户手势让路:闸门期内不抢滚动,最多等 2 秒;仍被占用就交回上层顺延,
   *      **不计失败**(抢同一个 scrollTop 只会两败俱伤)。
   */
  async function revealRow(name) {
    var mark = abortSeq;                // ★ 进链记号:号变了 = 用户喊停,立刻收手
    var a = state.rowAnchor;
    var c = (a && a.container && a.container.isConnected) ? a.container : scrollHostOfAny();
    if (!c) return null;
    var prev = c.scrollTop;
    var deadline = Date.now() + SCAN_MS;   // 找款预算(2026-10-27 用户「滚屏太多了」:8 秒 → 5 秒)
    var step = Math.max(200, Math.floor((c.clientHeight || 600) * 0.8));
    var maxScroll = Math.max(0, c.scrollHeight - c.clientHeight);

    /* ★ 2026-10-27(用户问「商品 ID 没搜到商品,这个按钮会做什么决策」):
     *   **可滚距离为 0 ⇒ 滚屏这条路根本不存在**,别再空转。
     *   最典型的场景就是原生搜索把列表筛成 0 条(搜不到这件商品):旧写法照样
     *   走满 8 秒(每档 60ms + 最长 900ms 观察,8 秒只能走 8 档,一个行都不会出现),
     *   用户看到的是「明明没结果,还在那儿磨」。
     *   先给一次「换容器」的机会(记录的容器可能是旧的/被筛短的),换不到就直接交回。 */
    if (maxScroll < 8) {
      var alt = scrollHostOfAny();
      if (alt && alt !== c) {
        var altMax = Math.max(0, alt.scrollHeight - alt.clientHeight);
        if (altMax >= 8) { c = alt; prev = c.scrollTop; maxScroll = altMax; }
      }
    }
    if (maxScroll < 8) {
      diagOnce('scroll-flat', '列表可滚 0px(搜不到这件商品 / 只有一屏)⇒ 不做滚屏');
      return null;
    }

    async function tryAt(pos) {
      if (aborted(mark)) return 'abort';
      if (Date.now() > deadline) return null;
      for (var g = 0; g < 10 && userBusy(); g++) await sleep(200);
      if (aborted(mark)) return 'abort';
      if (userBusy()) return 'busy';                 // 用户还在动 ⇒ 让路
      var target = Math.max(0, Math.min(maxScroll, pos));
      c.scrollTop = target;
      window.__dycScriptScrollAt = Date.now();       // 程序化滚动打点(项目约定,auto-refresh 也读它)
      await sleep(60);
      if (aborted(mark)) return 'abort';
      if (Math.abs(c.scrollTop - target) > 2) return 'bad';   // 容器不认这个 scrollTop
      for (var k = 0; k < Math.round(SCAN_OBS_MS / 100); k++) {   // 观察窗上限,命中即回
        await sleep(100);
        if (aborted(mark)) return 'abort';
        var row = findRowByName(name);
        if (row) return row;
      }
      return null;
    }

    /* ★ 2026-10-27(用户:「但兜底滚屏,200 个品,8 秒或者 5 秒不够滚到底部啊」):
     *   一次 5 秒本来就扫不完长列表 —— 200 个品 ≈ 20 屏,5 秒只走 5~6 屏;
     *   而旧口径"由近及远、上下交替"等于每次都在同一小段里来回蹭,**永远到不了底**。
     *   ⇒ 改成**分段续扫(断点续扫)**:
     *     · 只朝**一个方向**走(向下),到列表末端就绕回顶部接着走 —— 一圈覆盖全表;
     *     · 每段最多 SCAN_MS(5 秒,用户定的降频),结束时把「停在哪」记进 state.scanPos,
     *       下一段从那里接着走,不重复、不回头;
     *     · 一圈走完仍没找到 ⇒ 记 scanDone,之后的重试不再滚屏(只搜索)。
     *   效果:单次还是只滚 5 秒,但 3~4 段就能覆盖 200 个品。
     *   另外:分段期间**不还原滚动位置**(让列表持续往下走,像人在翻),
     *   整段扫描收尾(找到 / 扫完 / 被中止)时才一次性还原到最初的位置。 */
    /* ★ 2026-10-27 记忆自检:偏移**超出当前可滚范围** ⇒ 这条记忆已经作废
     *   (商品被删 / 列表变短 / 排序大改)。以前只靠下面 `Math.min` 夹取,
     *   等于「从列表最底部开始白扫」;现在直接丢掉,从当前位置重新开始,并记一条诊断 ——
     *   下次看诊断就能分清「记忆过时」和「本来就没记过」。 */
    if (a && typeof a.offset === 'number' && a.offset > maxScroll + 200) {
      diagOnce('anchor-stale', '定位记忆越界(' + a.offset + 'px > 可滚 ' + maxScroll + 'px)⇒ 作废重记');
      state.rowAnchor = null;
      a = null;
    }

    var scanRestore = (state.scanPrev >= 0) ? state.scanPrev : prev;
    if (state.scanPrev < 0) { state.scanPrev = prev; state.scanC = c; }

    state.scanSeg = (state.scanSeg || 0) + 1;
    /* 按**实际可滚距离**推算"这趟要几段"(2026-10-27,用户给了 200 品上限):
     *   每段能走的档位数 ≈ SCAN_MS / (观察窗 + 就位开销) ⇒ 5 秒约 6 档;
     *   整表需要的档位数 = maxScroll / step。
     * 50 个品 ⇒ 2 段;200 个品 ⇒ 8 段。第一次进 revealRow 时算一次就够。 */
    if (!state.scanNeed) {
      var segSteps = Math.max(1, Math.floor(SCAN_MS / (SCAN_OBS_MS + 120)));
      var needPos = Math.ceil(maxScroll / step) + 1;
      state.scanNeed = Math.max(1, Math.min(SCAN_MAX_SEG, Math.ceil(needPos / segSteps)));
    }
    var start = (state.scanPos >= 0)
      ? Math.min(state.scanPos, maxScroll)
      : ((a && typeof a.offset === 'number')
        ? Math.max(0, Math.min(maxScroll, a.offset - 120)) : Math.min(prev, maxScroll));
    var pos = start;
    var wrapped = false;          // 本段内是否已经绕回过顶部
    var steps = 0;

    while (Date.now() < deadline) {
      if (aborted(mark)) {
        c.scrollTop = scanRestore; window.__dycScriptScrollAt = Date.now();
        state.scanPrev = -1;
        return 'abort';
      }
      steps += 1;
      var hit = await tryAt(pos);
      if (hit === 'abort') {
        c.scrollTop = scanRestore;
        window.__dycScriptScrollAt = Date.now();
        state.scanPrev = -1;
        return 'abort';
      }
      if (hit === 'bad') {
        c.scrollTop = scanRestore;
        window.__dycScriptScrollAt = Date.now();
        state.scanPrev = -1;
        return 'bad-container';
      }
      if (hit === 'busy') {                    // 用户抢滚动 ⇒ 让路,位置留给下一段
        state.scanPos = pos;
        return 'deferred';
      }
      if (hit) {                               // 命中
        state.scanPos = -1;
        state.scanPrev = -1;
        /* ★ 2026-10-27:命中即**校准记忆** —— 用真正找到的那一行重记偏移。
         *   记忆有可能是旧的(用户拖过排序 / 新上架插到前面 / 某件商品下架),
         *   滚一次就对上了;下次到点第一档直接飞这个新位置,不会再偏。
         *   offset 是绝对像素(与 scrollTop 无关),所以下面还原滚动不影响它。 */
        state.rowAnchor = recordRowAnchor(hit);
        return { row: hit, container: c, prevScroll: scanRestore };
      }
      /* 下一档:一直往下;到列表末端就绕回顶部继续,绕满一圈即算扫完 */
      pos += step;
      if (pos > maxScroll) {
        if (wrapped) { state.scanDone = true; break; }
        pos = 0;
        wrapped = true;
      }
      if (wrapped && pos >= start) { state.scanDone = true; break; }
    }

    if (state.scanDone) {
      c.scrollTop = scanRestore;
      window.__dycScriptScrollAt = Date.now();
      state.scanPos = -1;
      state.scanPrev = -1;
      diagOnce('reveal-miss', '滚屏已扫完一圈仍未找到｜本段 ' + steps + ' 档 / 可滚 ' +
        maxScroll + 'px / 视口 ' + (c.clientHeight || 0) + 'px / 行 ' +
        (function () { try { return rows().length; } catch (e) { return -1; } })() + ' 个');
      return 'exhausted';
    }

    /* 这一段时间用完还没扫完 ⇒ 存断点,下一段接着走(不算失败、不报消息) */
    state.scanPos = Math.min(maxScroll, pos);
    if (typeof debugLog === 'function') {
      debugLog('滚屏未扫完:本段 ' + steps + ' 档,停在 ' +
        Math.round(state.scanPos) + '/' + maxScroll + 'px,稍后接着扫');
    }
    return 'partial';
  }

  /**
   * 找一个「商品列表的滚动容器」。三级兜底(2026-10-25 诊断显示 rows() 可能返回 0):
   *   ① 从任意商品行往上找(最准,但依赖行集合能抓到);
   *   ② 从小黄车面板容器**内部**找 scrollHeight 最大的那个可滚元素(不依赖行集合);
   *   ③ 从锚点(标题行)往上找。
   */
  function scrollHostOfAny() {
    var list = rows();
    for (var i = 0; i < list.length && i < 3; i++) {
      var c = scrollHostOf(list[i]);
      if (c) return c;
    }
    var pane = findCartPanel();
    if (pane) {
      var best = null, bestH = 0;
      var kids = pane.querySelectorAll('div, ul, section');
      for (var k = 0; k < kids.length && k < 400; k++) {
        var el = kids[k];
        var st = window.getComputedStyle(el);
        if (!/(auto|scroll|overlay)/.test(st.overflowY || '')) continue;
        if (el.clientHeight < 200) continue;
        if (el.scrollHeight - el.clientHeight < 100) continue;
        var h = el.scrollHeight;
        if (h > bestH) { bestH = h; best = el; }
      }
      if (best) return best;
    }
    var head = findAnchor();
    return head ? scrollHostOf(head) : null;
  }

  /** 商品列表滚动容器的总高(判「下架」与「滚走被卸载」用);取不到返回 0 */
  function listHeight() {
    try {
      var c = scrollHostOfAny();
      return c ? (c.scrollHeight || 0) : 0;
    } catch (e) { return 0; }
  }

  /** 页面上那个「讲解中」小标记(宽 < 140、高 < 34 的元素,文本恰为「讲解中」) */
  function findLecturingMark() {
    var cands = $$('span, div, i, em, b');
    for (var i = 0; i < cands.length; i++) {
      var el = cands[i];
      var t = txt(el);
      if (t !== '讲解中') continue;
      var r = el.getBoundingClientRect();
      if (r.width < 8 || r.width > 140 || r.height < 8 || r.height > 34) continue;
      return el;
    }
    return null;
  }

  /**
   * 按商品名找行。
   * ★ 必须有这一条:点完「取消讲解」之后,那一行就**不再有「讲解中」标记**了,
   *   再用 findLiveRow() 去拿「讲解」按钮必然拿不到(2026-10-25 自查发现)。
   *   所以第一次点击前先记住商品名,1.2 秒后按名字把行找回来。
   */
  function findRowByName(name) {
    /* 2026-10-26:先按**稳定键**找 —— 平台改过显示名也能认回同一行 */
    var byKey = findRowByKey();
    if (byKey) return byKey;
    if (!name) return null;
    var want = keyOf(name);
    if (!want) return null;
    var list = rows();
    for (var i = 0; i < list.length; i++) {
      if (keyOf(rowName(list[i])) === want) return list[i];
    }
    for (var j = 0; j < list.length; j++) {         // 退一步:键的包含关系
      var k = keyOf(rowName(list[j]));
      if (k && (k.indexOf(want) >= 0 || want.indexOf(k) >= 0)) return list[j];
    }
    return null;
  }

  /**
   * 行 → **稳定身份键**(2026-10-26 新增)。
   * 为什么不能再用名称当身份:#113「调动非讲解款就把计时清零」、#117「换个位置就重置」
   * 都源于 rowName 取的是「行内最长的 4~60 字短文本」——平台重渲染、排序、悬停都会让
   * 那串字抖一下,旧口径据此判成「换了商品」而把计时清掉。
   * 取值优先级:① 行内详情链接 href 里的商品 id;② data-* 上的 id;③ 名称前 8 个有效字符。
   */
  var keyCache = { at: 0, map: null };   // 500ms 窗口内同一节点只算一次(每拍要算几十行)
  function rowKey(row) {
    if (!row) return '';
    var now = Date.now();
    if (!keyCache.map || now - keyCache.at > 500) {
      keyCache.at = now;
      try { keyCache.map = new WeakMap(); } catch (e) { keyCache.map = null; }
    }
    if (keyCache.map && keyCache.map.has(row)) return keyCache.map.get(row);
    var k = computeRowKey(row);
    if (keyCache.map) keyCache.map.set(row, k);
    return k;
  }

  function computeRowKey(row) {
    if (!row) return '';
    try {
      var links = $$('a[href]', row);
      for (var i = 0; i < links.length; i++) {
        var m = /(?:product|item|goods|promotion)[_\/-]?(?:id)?[=\/](\d{5,})/i.exec(
          String(links[i].getAttribute('href') || ''));
        if (m) return 'id:' + m[1];
      }
      var attrs = ['data-product-id', 'data-item-id', 'data-goods-id', 'data-id'];
      for (var k = 0; k < attrs.length; k++) {
        var self = row.getAttribute && row.getAttribute(attrs[k]);
        if (self) return 'id:' + self;
        var hit = row.querySelector ? row.querySelector('[' + attrs[k] + ']') : null;
        if (hit) return 'id:' + hit.getAttribute(attrs[k]);
      }
      /* ★ 2026-10-27 用户定:「用商品 ID 作为识别锚点吧,每个商品对应的 ID 都是独一无二的,
       *   商品 ID 不是货号」。上面两条(链接 href / 明确的 data-* )在这台机器上都没命中
       *   (否则键不会是「nm:讲解中…」),所以补一条**广谱 ID 采集**。
       *   只认「像 ID 的值」:纯数字 10~20 位,或 6~32 位的字母数字串 ——
       *   货号(如 A0476)长度不够、含中文/空格的提示语也进不来。 */
      var picked = pickIdFromRow(row);
      if (picked) return 'id:' + picked;
    } catch (e) { /* 取不到就走名称档 */ }
    var nm = keyOf(rowName(row));
    return nm ? ('nm:' + nm.slice(0, 8)) : '';
  }

  /** 值像不像一个商品 ID(纯数字 10~20 位 / 6~32 位字母数字串) */
  function looksLikeId(v) {
    var s = String(v == null ? '' : v).trim();
    if (!s || s.length > 32) return '';
    if (/^\d{10,20}$/.test(s)) return s;                            // 抖店商品 ID 通常 19 位
    if (/^[A-Za-z0-9_-]{6,32}$/.test(s) && /\d/.test(s)) return s;   // 兜底:带数字的短串
    return '';
  }

  /**
   * 行内挖商品 ID(2026-10-27)。
   * 为什么值得多扫一遍:ID 是唯一且**不随状态变化**的锚点 —— 用户点了「取消讲解」之后,
   * 我们仍能靠它把那一行认回来(名字/键都会随「讲解中」标签变化,这就是今天两个 bug 的根)。
   * 采集顺序:① 行内元素的 data-* / title / aria-label / value;② 行内直接显示的纯数字文本。
   * 只扫前 160 个元素 —— 商品行很浅,这个量级足够,且 ID 一般在标题/复制按钮那一带。
   */
  function pickIdFromRow(row) {
    if (!row) return '';
    var els = [];
    try { els = [row].concat($$(('*'), row).slice(0, 160)); } catch (e) { els = [row]; }
    var attrs = ['data-id', 'data-item-id', 'data-product-id', 'data-goods-id',
                 'data-key', 'data-row-key', 'data-clipboard-text', 'value',
                 'title', 'aria-label'];
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      if (!el || !el.getAttribute) continue;
      for (var k = 0; k < attrs.length; k++) {
        var v = looksLikeId(el.getAttribute(attrs[k]));
        if (v) return v;
      }
    }
    /* ★ 2026-10-27 现场实证:待上架商品行把商品 ID 藏在
     *   `data-rbd-draggable-id="3849526557068624049"`(react-beautiful-dnd 的 draggableId,
     *   值就是商品 ID)—— 既不在 href、也不在名字里,所以上面那张固定属性表全落空。
     *   ⇒ 再按「属性名里带 id」泛化扫一遍:data-rbd-draggable-id / data-xxx-id / data-id…
     *   只认 looksLikeId 通过的値,`data-rbd-draggable-context-id="0"` 这类会被拒。 */
    for (var i2 = 0; i2 < els.length; i2++) {
      var el2 = els[i2];
      var list = el2 && el2.attributes;
      if (!list || !list.length) continue;
      for (var a = 0; a < list.length; a++) {
        var name = String(list[a].name || '');
        if (!/(^|[-_])id([-_]|$)/i.test(name) && !/id$/i.test(name)) continue;
        var v2 = looksLikeId(list[a].value);
        if (v2) return v2;
      }
    }
    for (var j = 0; j < els.length; j++) {
      var t = txt(els[j]);
      if (/^\d{10,20}$/.test(t)) return t;           // ID 直接显示在行里
    }
    return '';
  }

  /** 按稳定键找回那一行(行被回收 / 重渲染后都靠它) */
  function findRowByKey() {
    if (!state.key) return null;
    var list = rows();
    for (var i = 0; i < list.length; i++) {
      if (rowKey(list[i]) === state.key) return list[i];
    }
    return null;
  }

  /**
   * 这一次还允不允许走「滚屏」(2026-10-27 首版,2026-10-31 改造)。
   * ----------------------------------------------------------
   * 2026-10-31 删掉了原来那道「搜索生效但列表只剩 N 行 ⇒ 不滚」的闸门 ——
   * 它是错的:那一刻搜索词还没还原,`rows()` 量到的是**被我们写的商品 ID 筛过的列表**,
   * 搜不到就是 0 行,于是「搜不到」被读成「列表里没有这件商品」,直接判死。
   * 结果是搜索越不管用、停得越快(分钟档在有商品 ID 时 3.4 秒就停表,滚屏一次没跑)。
   * 现在搜索失败**一律先还原筛选词再判断**(见 restoreSearchNow),量到的就是用户原本的列表;
   * 「列表真的只有一屏」这种情况由 revealRow 自己的 maxScroll<8 兜住,不需要在这里再拦。
   *
   * 仍然保留两道闸门(都是「已经证明滚也没用」的硬证据):
   *   ① 已经扫完一整圈仍没找到 ⇒ 再滚是重复劳动;
   *   ② 段数已到按可滚距离推算的上限 ⇒ 整张表都走过了。
   */
  function allowScroll() {
    if (state.scanDone) {
      diagOnce('scroll-quota', '已扫完一圈仍未找到 ⇒ 不再滚屏,交给搜索/重试');
      return false;
    }
    var segLimit = Math.min(SCAN_MAX_SEG, (state.scanNeed || SCAN_MAX_SEG));
    if ((state.scanSeg || 0) > segLimit) {
      diagOnce('scroll-seg-max', '已连扫 ' + state.scanSeg + ' 段(上限 ' + segLimit +
        ')仍没找到 ⇒ 停手:按可滚距离算,已经走完整张表');
      return false;
    }
    return true;
  }

  /**
   * 结束一次分段扫描:先**把用户原来的位置还回去**,再把断点/圈数/容器一起清干净。
   * 为什么要单独一个出口(2026-10-27):分段续扫**期间故意不还原位置**
   * (让列表持续往下走,像人在翻),所以中途被喊停(用户取消 / 关胶囊 / 判定停表)时
   * 必须由这里负责还原 —— 否则用户的列表会停在扫描停下的地方,看着莫名其妙。
   * 幂等:没在扫(scanPrev < 0)时只清字段,不动滚动。
   */
  function endScan() {
    if (state.scanPrev >= 0 && state.scanC && state.scanC.isConnected) {
      try {
        state.scanC.scrollTop = state.scanPrev;
        window.__dycScriptScrollAt = Date.now();
      } catch (e) { /* 忽略 */ }
    }
    state.scanPrev = -1;
    state.scanC = null;
    state.scanPos = -1;
    state.scanDone = false;
    state.scanSeg = 0;
    state.scanNeed = 0;
  }

  /* ==========================================================
   * 原生搜索定位(2026-10-27 用户方案)
   * ----------------------------------------------------------
   * 用户原话:「既然是用ID来定位这个商品的,那时间到了就用原生搜索去搜索这个ID,
   *   原生搜索是支持这个方法且秒跳转的,定位到商品之后直接循环,
   *   然后再把屏幕回到最开始来的位置」。
   *
   * 为什么它比滚屏靠谱:
   *   ① 平台搜索 = **列表过滤 + 平台自己把命中行滚进视野并加高亮类**,
   *      我们不必算滚动距离,也不受「虚拟列表还没挂载那一行」影响 ——
   *      而后者正是 01:32「已连续 20 拍看不见那一行…行 13 个」那个死循环的成因;
   *   ② 滚屏是「0.8 屏一档 × 24 档 × 每档最多 900ms」,8 秒预算里根本扫不完;
   *      搜索是秒级返回。
   *
   * 红线:**绝不改用户的筛选条件** —— 不管搜到没搜到,搜索框都要还原成原来的词,
   *      滚动位置也还原(restore 由 doCycle 的 finally 统一执行)。
   * ========================================================== */

  var PH_SEARCH = '商品名称';   // 与 search.js 同一条判据;平台微调文案也不易失效
  /* 只认「硬浮层」三个词 —— 小黄车自己常挂 popover / dropdown 这类类名,
   * 用宽口径会把**正主搜索框**一起判成浮层里的输入框,整条通道当场失效。 */
  var HARD_OVERLAY_RE = /(^|[-_ ])(modal|dialog|drawer)([-_ ]|$)/i;

  /**
   * 这个节点是不是在浮层里(「添加商品」抽屉里的同名输入框不能拿来当搜索框)。
   * stopAt:爬到这一层就算「不在浮层里」—— 传入小黄车容器,避免它自身的
   * 浮层类名把正主搜索框误伤掉。
   */
  function inOverlayEl(el, stopAt) {
    try {
      for (var n = el; n && n !== document.body; n = n.parentElement) {
        if (stopAt && n === stopAt) return false;
        if (n.getAttribute && n.getAttribute('role') === 'dialog') return true;
        var cls = (n.className && typeof n.className === 'string') ? n.className : '';
        if (cls && HARD_OVERLAY_RE.test(cls)) return true;
      }
    } catch (e) { /* 尽力而为 */ }
    return false;
  }

  /**
   * 是不是「页头 / 导航」里的输入框。
   * 为什么单独拦这一种:万一把顶部那个全局搜索框当成商品搜索框,往里写一个 19 位 ID
   * 再回车,平台可能直接**跳页** —— 那比兜底失败坏得多。
   * 只用于小黄车之外的**兜底候选**,小黄车里的正主不受影响。
   */
  function inHeadArea(el) {
    try {
      for (var n = el; n && n !== document.body; n = n.parentElement) {
        if (/^(header|nav)$/i.test(n.tagName || '')) return true;
        var cls = (n.className && typeof n.className === 'string') ? n.className : '';
        if (cls && /(^|[-_ ])(header|navbar|nav|topbar|global-?search)([-_ ]|$)/i.test(cls)) return true;
      }
    } catch (e) { /* 尽力而为 */ }
    return false;
  }

  /** 小黄车里那个「请输入商品名称或ID」的搜索框;没有就返回 null */
  function findSearchInput() {
    var list = [];
    try { list = $$('input'); } catch (e) { return null; }
    var pane = findCartPanel();
    var fallback = null;
    for (var i = 0; i < list.length; i++) {
      var el = list[i];
      var ph = (el.getAttribute && el.getAttribute('placeholder')) || '';
      if (ph.indexOf(PH_SEARCH) < 0) continue;
      var inPane = !!(pane && pane.contains(el));
      if (inOverlayEl(el, inPane ? pane : null)) continue;   // 「添加商品」抽屉里的同名框
      var r = el.getBoundingClientRect();
      if (r.width < 40 || r.height < 10) continue;           // 还没渲染出来的不算
      if (inPane) return el;                                 // 小黄车里的那一个最可信
      /* 小黄车之外只当兜底,且必须排除页头 / 导航里的全局搜索框 ——
       * 往里写 ID 回车可能直接跳页,风险远大于「这次没搜到」。 */
      if (!fallback && !inHeadArea(el)) fallback = el;
    }
    return fallback;
  }

  /** 写值进 React 受控输入框:必须走原生 setter + input 事件,否则平台不认 */
  function setInputValue(el, v) {
    try {
      var d = window.HTMLInputElement &&
        Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value');
      if (d && d.set) d.set.call(el, v); else el.value = v;
      el.dispatchEvent(new window.Event('input', { bubbles: true }));
    } catch (e) {
      try { el.value = v; } catch (e2) { /* 尽力而为 */ }
    }
  }

  /** 向平台搜索框派发一个真实 Enter(平台自己的监听收到就走原生搜索) */
  function fireEnter(el) {
    var opts = { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true };
    try {
      el.dispatchEvent(new window.KeyboardEvent('keydown', opts));
      el.dispatchEvent(new window.KeyboardEvent('keypress', opts));
      el.dispatchEvent(new window.KeyboardEvent('keyup', opts));
    } catch (e) { /* 老内核没有 KeyboardEvent 构造器 ⇒ 交给放大镜兜底 */ }
  }

  /**
   * 回车不生效时点搜索框右侧那枚放大镜。
   * 沿祖先链最多找 3 层,只认「类名/无障碍标签里带搜索语义」的小图标 ——
   * 不按坐标猜(平台改版时坐标猜法会点到别的东西)。
   */
  function clickSearchIcon(el) {
    try {
      var box = el.parentElement;
      for (var d = 0; box && d < 3; d++) {
        var kids = box.querySelectorAll('span, i, button, a, div, svg');
        for (var i = 0; i < kids.length; i++) {
          var s = kids[i];
          if (s === el || el.contains(s) || s.contains(el)) continue;
          var r = s.getBoundingClientRect();
          if (r.width < 10 || r.width > 60 || r.height < 10 || r.height > 60) continue;
          var label = (s.getAttribute && (s.getAttribute('aria-label') || s.getAttribute('title'))) || '';
          var cls = (s.className && typeof s.className === 'string') ? s.className : '';
          if (/search/i.test(cls) || /搜索/.test(label) || /搜索/.test(cls)) {
            fireClick(s);
            return true;
          }
        }
        box = box.parentElement;
      }
    } catch (e) { /* 忽略 */ }
    return false;
  }

  /**
   * 平台原生搜索的「命中行」。平台给搜索结果里当前那一行加高亮类
   * (真机实测 `... goods-item_hl ...`,hash 会变 ⇒ 一律前缀/子串匹配,
   * 与 search.js 的 NAV_ROW_HL_SEL 同一口径)。
   */
  function findSearchHitRow() {
    try {
      var el = $('[class*="goods-item_hl"]');
      if (!el) return null;
      var row = el;
      for (var d = 0; row && d < 4; d++) {
        if (row !== document.body && findLectureBtn(row)) return row;
        row = row.parentElement;
      }
    } catch (e) { /* 忽略 */ }
    return null;
  }

  /** 身份键 → 商品 ID(id:3849… ⇒ 3849…);不是 ID 键就返回空 */
  function idOfKey(key) {
    var s = String(key || '');
    if (s.indexOf('id:') !== 0) return '';
    var v = s.slice(3);
    return looksLikeId(v) ? v : '';
  }

  /** 当前行集合的指纹(判「平台有没有真的换了结果」) */
  function rowKeysOf() {
    try {
      return rows().map(function (r) { return rowKey(r); }).join('|');
    } catch (e) { return ''; }
  }

  /**
   * 用平台原生搜索把目标商品定位出来。
   * 返回:'abort' = 用户喊停;null = 这条通道不可用(没搜索框 / 没有 ID);
   *       { row } = 走完了 —— row 为空说明搜也没搜到(交给滚屏兜底)。
   *
   * ★ 还原信息**不靠返回值传递**:一旦动过搜索框,现场立刻登记进 pendingSearch,
   *   由 doCycle 的 finally 无条件执行 —— 中途被用户喊停(返回 'abort')也不会漏还原,
   *   否则搜索框里就留着我们写进去的 ID,用户的列表被永久筛成一行。
   */
  var pendingSearch = null;

  async function locateBySearch(id, mark) {
    if (!id) return null;
    var input = findSearchInput();
    if (!input) { noteDiag('原生搜索不可用(没找到搜索框)⇒ 退回滚屏查找'); return null; }
    var c = scrollHostOfAny();
    pendingSearch = {
      input: input,
      prevQuery: String(input.value || ''),
      container: (c && c.isConnected) ? c : null,
      prevScroll: c ? c.scrollTop : 0
    };
    var before = rowKeysOf();
    var startAt = Date.now();
    setInputValue(input, id);
    fireEnter(input);

    var row = null, anyRow = null, triedIcon = false;
    var deadline = startAt + 2600;                 // 平台是秒跳,2.6 秒是宽裕预算
    while (Date.now() < deadline) {
      await sleep(120);
      if (aborted(mark)) return 'abort';
      var cand = findRowByKey() || findSearchHitRow();
      if (cand) {
        anyRow = cand;
        if (findLectureBtn(cand)) { row = cand; break; }   // 已经能点了才算真到位
      }
      /* 700ms 后列表还是原样 ⇒ 平台不认合成 Enter,改点放大镜再等 */
      if (!triedIcon && Date.now() - startAt > 700 && rowKeysOf() === before) {
        triedIcon = true;
        clickSearchIcon(input);
      }
    }
    if (!row) row = anyRow;                        // 找到了行但没有讲解按钮 ⇒ 交给上层如实报错
    if (!row) {
      diagOnce('search-miss', '原生搜索没定位到目标(尾号 ' + String(id).slice(-6) + ')⇒ 退回滚屏查找');
      return { row: null };
    }
    noteDiag('原生搜索定位到目标行(尾号 ' + String(id).slice(-6) + ')');
    return { row: row };
  }

  /**
   * 立刻把用户原来的筛选词与滚动位置还回去(2026-10-31 从 doCycle 的 finally 抽出)。
   * ----------------------------------------------------------
   * 为什么必须能单独调用:搜索失败后要**先还原、再量列表、再决定重试还是滚屏**。
   * 不还原就量,量到的是被我们写进去的 ID 筛过的短列表 —— 拿它来判「列表里没有这件商品、
   * 滚也白滚」,正是 2026-10-30 那次「分钟档 3.4 秒就停表」的直接成因。
   * 幂等:没有待还原现场(pendingSearch 为空)时立刻返回 false,可重复调用;
   * 无论成功、失败、被中止,出口都该走一次 —— 绝不把我们的筛选词留在用户框里。
   */
  async function restoreSearchNow() {
    var srch = pendingSearch;
    pendingSearch = null;
    if (!srch || !srch.input || !srch.input.isConnected) return false;
    var changed = false;
    if (String(srch.input.value || '') !== srch.prevQuery) {
      setInputValue(srch.input, srch.prevQuery);
      fireEnter(srch.input);
      await sleep(300);                     // 等平台把完整列表拿回来
      state.rowAnchor = null;               // 列表重排 ⇒ 旧偏移与总高都不作数
      state.listH = 0;
      changed = true;
    }
    if (srch.container && srch.container.isConnected) {
      try {
        srch.container.scrollTop = srch.prevScroll;
        window.__dycScriptScrollAt = Date.now();
      } catch (e) { /* 忽略 */ }
    }
    return changed;
  }

  /**
   * 搜索失败后的等待(2026-10-31 用户定:隔 5 秒重试一次)。
   * ----------------------------------------------------------
   * 两条硬约束,缺一不可:
   *   ① **可打断** —— 分片等,每 200ms 比一次中止令牌。用户点停止、手动取消讲解,
   *      必须立刻响应;一个死 sleep(5000) 会让「点了停还要等 5 秒」,比慢更难受。
   *   ② **可提前结束** —— 等待期间「讲解中」回来了(平台自己跳了 / 用户手动点回去了),
   *      就没必要再搜一次,直接交给上层继续动作。
   * 返回:'abort'(被喊停) / 'returned'(讲解中已回来) / 'timeout'(等满,该重试了)。
   */
  async function waitSearchRetry(ms, mark) {
    var until = Date.now() + ms;
    var lastProbe = 0;
    while (Date.now() < until) {
      await sleep(200);                    // 200ms 一片:点停止最多 200ms 就有反应
      if (aborted(mark)) return 'abort';
      /* findLiveRow() 要扫一遍 DOM,不必每片都做 —— 600ms 一次足够,
       * 5 秒里只查 8 次,既不会漏掉"讲解中回来了"也不会白烧 CPU。 */
      if (Date.now() - lastProbe >= 600) {
        lastProbe = Date.now();
        if (findLiveRow()) return 'returned';
      }
    }
    return 'timeout';
  }

  /**
   * 清「这一次找品」的滚屏额度(2026-10-31)。
   * ----------------------------------------------------------
   * 为什么必须清:scanSeg(已扫几段)/ scanDone(是否扫完一圈)/ scanNeed(该扫几段)
   * 原来只在**换品**与**停表**时清,成功续讲后一律留着。后果是跑过几轮之后
   * scanSeg 累到 SCAN_MAX_SEG、或 scanDone 一直是 true ⇒ **永久不再滚屏**,直到停表重开。
   * 额度是「这一轮找品」的额度,不是「这场直播」的累计。
   * ⚠ 只清额度,不动 scanPos / scanPrev —— 那两个是「半路停下的位置」,归 endScan 管。
   */
  function resetScanQuota() {
    state.scanDone = false;
    state.scanSeg = 0;
    state.scanNeed = 0;
  }

  /**
   * 去掉「状态词 / 行内噪音」,得到**不随状态变化**的商品名(2026-10-27)。
   * ----------------------------------------------------------
   * 用户 10-27 的现场诊断(00:36:51)记录商品是:
   *   「讲解中【高奢女装】彩色扣设计针织开衫V领长袖毛衣A0476ID货号未设提词设置卖点」
   * —— 这是 `txt(row).slice(0,40)` 兜底出来的**整行文案**,里面混进了「讲解中」状态词
   * 和「ID / 货号 / 未设提词 / 设置卖点」这些别的控件的字。
   * 后果是连锁的:
   *   ① `rowKey` 的兜底档是「名字前 8 字」⇒ 键里带着「讲解中」,用户一取消讲解,键就变了,
   *      `findRowByKey()` 再也认不出那一行 ⇒ 「行还在但讲解中没了」这条手动取消判据永远不触发;
   *   ② `findRowByName()` 拿这串字去比对,取消后也对不上 ⇒ 用户说「就算我的商品放在第一名,他也不知道」;
   *   ③ 提示里显示一长串乱码似的名字。
   * ⇒ 名字必须**只留商品标题**:剥掉前缀状态词、截掉尾部的 ID/货号/提词/卖点噪音。
   */
  function cleanName(s) {
    var t = String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
    /* ★ 2026-11-01(用户截图:消息盒子值段出现「预热中 【KiKi】…」):
       行首状态词不止「讲解」一族 —— 商品在预热阶段行内挂的是「预热中」,
       它和「讲解中」是**互斥的两个阶段**,同一个商品换阶段后这串字就变。
       名字里带着它 ⇒ ① 消息里把状态词当商品名念给用户看;
       ② 身份键(名字兜底档)随阶段漂移,换阶段后按名找回必然落空。 */
    var head = /^(?:正在讲解|讲解中|讲解|正在预热|预热中|预热)\s*/;
    for (var i = 0; i < 3; i++) {                       // 前缀状态词(可能叠着)
      var t2 = t.replace(head, '');
      if (t2 === t) break;
      t = t2;
    }
    t = t.replace(/(?:ID)?货号[\s\S]*$/, '');            // 货号之后都是行内别的控件
    t = t.replace(/(?:未设提词|未设置卖点|设置卖点)[\s\S]*$/, '');
    return t.replace(/\s+$/, '');
  }

  /** 行 → 商品名(取最像标题的短文本,挡掉库存/价格这类) */
  function rowName(row) {
    if (!row) return '';
    var best = '', bestScore = -1;
    $$('div, span, a, p', row).forEach(function (el) {
      var t = cleanName(txt(el));
      if (t.length < 4 || t.length > 60) return;
      if (/^[¥￥\d.,\s]+$/.test(t)) return;
      /* 2026-11-06:按钮态文案(讲解/取消讲解/弹出讲解卡…)一律不当商品名 */
      if (kindOfText(t)) return;
      if (t === '预热' || t === '取消预热' || t === '预热中' || t === '正在预热') return;
      if (t.indexOf('库存') >= 0 || t.indexOf('月销') >= 0 || t.indexOf('券') >= 0) return;
      /* 带【店铺前缀】的那一段最像商品标题 —— 优先它,其次取最长 */
      var score = t.length + (t.indexOf('【') >= 0 ? 100 : 0);
      if (score > bestScore) { bestScore = score; best = t; }
    });
    return best || cleanName(txt(row));
  }

  /* ==========================================================
   * 五、胶囊 + 面板(Shadow DOM,固定 px,零占位)
   * ========================================================== */

  var CSS = [
    ':host{all:initial}',
    '*{box-sizing:border-box;font-family:-apple-system,BlinkMacSystemFont,"Microsoft YaHei",sans-serif}',
    /* D 版固定按钮:宽 138px **写死**。灯 + 「循环讲解」(恒定四字) + 40px 时间槽。
       宽度不随状态变的三条:① width 写死;② 中间文字恒定;③ 时间槽定宽 + 等宽数字,
       没有倒计时时用 visibility:hidden 占位(不塌缩)。 */
    '.cap{position:fixed;display:flex;align-items:center;width:224px;height:26px;',
    '  padding:0;box-sizing:border-box;',
    '  border-radius:999px;background:#fff;border:1px solid #e5e6eb;color:#4e5969;',
    '  font-size:11px;line-height:1;white-space:nowrap;cursor:pointer;',
    '  box-shadow:0 1px 2px rgba(31,35,41,.06);user-select:none;transition:background .15s,border-color .15s}',
    '.cap[hidden]{display:none}',
    '.cap-main{display:flex;align-items:center;gap:5px;width:179px;height:24px;padding:0 9px;border:0;border-radius:999px 0 0 999px;background:transparent;color:inherit;font-size:11px;cursor:pointer}',
    '.power{width:43px;height:24px;padding:0;border:0;border-left:1px solid #e5e6eb;background:transparent;color:inherit;font-size:11px;cursor:pointer;flex:none}',
    '.cap.on .power{border-left-color:#b7ebc6}',
    '.cap.on{border-color:#b7ebc6;background:#f4fdf6;color:#0a8f28}',
    '.cap.wait{border-color:#ffd9b3;background:#fffaf3;color:#c25e00}',
    '.cap.err{border-color:#ffc9c9;background:#fff2f2;color:#c62222}',
    '.dot{width:7px;height:7px;border-radius:50%;background:#c9cdd4;flex:none}',
    '.cap.on .dot{background:#00b42a}',
    '.cap.wait .dot{background:#ffb400}',
    '.cap.err .dot{background:#f53f3f}',
    '.ico{width:13px;height:13px;display:block;flex:none;color:currentColor;opacity:.9}',
    '.txt{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis}',
    /* 槽位:计时中放时间(等宽数字),不计时就把状态词放这里 —— 不放空占位符。
       宽度写死 46px,三种状态词(未开启/待讲解/重试中)与 04:32 都能装下,宽度不变。 */
    '.slot{width:44px;text-align:right;font-variant-numeric:tabular-nums;font-weight:600;',
    '  font-size:10.5px;flex:none;letter-spacing:0}',
    '.cap.on .slot{color:#0a8f28}',
    '.cap.wait .slot{color:#c25e00}',
    '.cap.err .slot{color:#c62222}',
    '.cap.off{border-color:#e5e6eb;background:#fff;color:#86909c}',
    '.cap.off .slot{color:#a9aeb5;font-weight:500}',
    /* 2026-10-26(#119 / #120):落点空间不够、或会压到别的浮层时,退化成「只留灯」的
       26px 小圆点 —— 最坏情况也只盖住一小点,点一下仍能展开完整面板。 */
    '.cap.mini{width:70px;height:22px;padding:0;gap:0}',
    '.cap.mini .cap-main{width:25px;padding:0;justify-content:center}',
    '.cap.mini .ico,.cap.mini .txt,.cap.mini .slot{display:none}',
    /* 2026-11-05:mini(26px 小圆点)状态下连 ∞ 也放不下,一并收起。 */ 
    '.cap.mini .inf-mark{display:none}',

    /* 面板:从按钮那儿「长出来」再「收回去」。
       用 opacity + visibility + 4px 位移(display 不能过渡),120ms、无弹跳。
       增长原点由 JS 按落点设(--ox/--oy),所以永远是从按钮那一角展开。 */
    '.panel{position:fixed;width:344px;background:#fff;border:1px solid #e5e6eb;border-radius:10px;',
    '  box-shadow:0 10px 28px rgba(31,35,41,.14);padding:14px 18px 0;overflow:hidden;',
    '  opacity:0;visibility:hidden;transform:translateY(-4px) scale(.985);',
    '  transform-origin:var(--ox,0) var(--oy,0);pointer-events:none;',
    '  transition:opacity .12s ease,transform .12s ease,visibility .12s}',
    '.panel.open{opacity:1;visibility:visible;transform:none;pointer-events:auto}',
    '.ph{display:flex;align-items:center;justify-content:space-between}',
    '.ph b{font-size:12.5px;font-weight:600;color:#1f2329}',
    /* 面板右上角那枚 —— **唯一可操作**的无限模式开关(2026-11-05 四次改)。
     * 用户原话:「具体要操作的话还是要点开这个框框,在右上角这里,把这右上角的
     *   莫比乌斯按钮做得更大一些,更显眼一些」。
     * 旧版是 18px 高、10px 字,缩在标题行右端看不清。改成 26px 高、12.5px 字、
     * 加粗、∞ 字形单独放大到 15px;关=白底灰框,开=品牌蓝实心,一眼分得清。 */
    '.inf{height:26px;padding:0 12px;border-radius:999px;border:1px solid #c9cdd4;background:#fff;',
    '  color:#4e5969;font-size:12.5px;line-height:1;cursor:pointer;font-family:inherit;font-weight:600;',
    '  display:inline-flex;align-items:center;gap:5px;flex:none}',
    '.inf:hover{border-color:#165dff;color:#165dff;background:#f5f8ff}',
    '.inf .ig{font-size:15px;line-height:1;font-weight:500}',
    '.inf[aria-pressed="true"]{border-color:#165dff;background:#165dff;color:#fff}',
    '.inf[aria-pressed="true"]:hover{border-color:#165dff;background:#0e42d2;color:#fff}',
    /* 收起态胶囊上的 ∞:**只是状态灯,不是按钮**(2026-11-05 四次改)。
     * 用户原话:「它只展示实操效果,不包含点击起作用或者关闭的功能……不要做出按钮的
     *   边框,不要做出按钮的效果。如果启用了它就是亮的,没启用莫比乌斯环就是灰色的」。
     * ⇒ 无边框、无底色、无 hover、pointer-events:none;开启=品牌蓝,关闭=灰。
     *
     * 2026-11-05 五次改(用户「文字和图案不在同一条水平线」):
     *   原来用字符 U+221E,字形在 em 框里偏下的量随字体而变,而「循环讲解」是汉字
     *   (几乎填满 em 框),两者用 align-items:center 对齐的是**行盒中心**不是字形中心,
     *   于是必然错位,且换个字体错位量又变。
     *   ⇒ 改成矢量描边图形:viewBox 上下对称,盒中心 == 图形视觉中心,
     *     与文字盒中心靠 flex 对齐即可,不再依赖任何字体度量。
     *   尺寸 28x14(stroke 2),比原 20px 字符的视觉高度更大。 */
    '.inf-mark{width:28px;height:14px;color:#a9aeb5;flex:none;display:block;',
    '  pointer-events:none;user-select:none;margin-left:1px}',
    '.inf-mark.on{color:#165dff}',
    /* 2026-10-30:秒档与分钟档各装进一个**可选的大框**,点框内任意位置就是选它。
       未启用的整框压到 45% 并把填充转灰 —— 分主次靠视觉权重,不靠隐藏,也不禁点。 */
    '.grp{border:1px solid #e8e9ec;border-radius:8px;background:#fafbfc;padding:9px 12px 10px;margin-top:9px;cursor:pointer}',
    '.grp[aria-pressed="true"]{border-color:#165dff;background:#fff;cursor:default}',
    '.grp[aria-pressed="false"]{opacity:.45}',
    '.grp[aria-pressed="false"]:hover{opacity:.72}',
    '.gh{display:flex;align-items:center;gap:6px;margin:0 0 8px}',
    '.rd{width:12px;height:12px;border-radius:50%;border:1.5px solid #c9cdd4;background:#fff;box-sizing:border-box;flex:none}',
    '.grp[aria-pressed="true"] .rd{border-color:#165dff;background:#165dff;box-shadow:inset 0 0 0 2.5px #fff}',
    '.gt{font-size:12px;color:#86909c}',
    '.grp[aria-pressed="true"] .gt{color:#1f2329;font-weight:600}',
    '.seg{display:grid;grid-template-columns:repeat(4,1fr);gap:6px}',
    '.sg{position:relative;border:1px solid #e8e9ec;border-radius:5px;padding:6px 0 5px;text-align:center;background:#fff;cursor:pointer}',
    '.sg b{display:block;font-size:15px;font-weight:600;line-height:1.15;color:#1f2329}',
    '.sg .u{display:block;margin-top:2px;font-size:9.5px;line-height:1.3;color:#86909c}',
    '.sg[aria-pressed="true"]{background:#165dff;border-color:#165dff}',
    '.sg[aria-pressed="true"] b{color:#fff}',
    '.sg[aria-pressed="true"] .u{color:rgba(255,255,255,.85)}',
    '.sg .pin{position:absolute;right:5px;top:4px;width:5px;height:5px;border-radius:50%;background:#00b42a}',
    '.sg[aria-pressed="true"] .pin{background:#8ff0a4}',
    '.grp[aria-pressed="false"] .fill{background:#dfe2e6;box-shadow:none}',
    '.grp[aria-pressed="false"] .thumb{border-color:#c9cdd4;box-shadow:none}',
    '.grp[aria-pressed="false"] .thumb::after{background:#c9cdd4}',
    '[hidden]{display:none!important}',

    '.zones{display:flex;height:18px;border-radius:4px;overflow:hidden;margin:0 0 4px}',
    '.zones span{display:flex;align-items:center;justify-content:center;font-size:9px;white-space:nowrap;overflow:hidden}',
    '.zones .r{width:28.5714%;background:#fff2f2;color:#c62222;border:1px solid #ffc9c9;border-right:none}',
    '.zones .g{width:50%;background:#f2fdf5;color:#0a8f28;border-top:1px solid #b7ebc6;border-bottom:1px solid #b7ebc6}',
    '.zones .o{width:21.4286%;background:#fff8f0;color:#c25e00;border:1px solid #ffd9b3;border-left:none}',

    '.ticks{position:relative;height:17px;margin:0 10px}',
    '.ticks button{position:absolute;transform:translateX(-50%);font-size:10px;color:#86909c;white-space:nowrap;cursor:pointer;border:0;background:transparent;padding:0}',
    '.ticks button.rec{color:#0a8f28;font-weight:600}',
    '.ticks button.first{transform:translateX(0)}',
    '.ticks button.last{transform:translateX(-100%)}',

    /* 滑条(2026-11-01 美化,同时修「滑钮看着透明」):
     *   ① 删掉 will-change:transform —— 定位走 left,它本是死代码;
     *      老内核上 will-change+圆角+边框会触发合成层 bug,把白底丢成透明。
     *   ② 轨道 4→6px 加内凹阴影,填充改蓝色渐变 + 顶部高光;
     *   ③ 滑钮加实心芯点(::after),任何内核下都不可能是「空心」观感;
     *   ④ 按下时光环扩大,拖动手感有反馈。 */
    '.track{position:relative;height:24px;cursor:pointer;touch-action:none}',
    '.rail{position:absolute;left:0;right:0;top:9px;height:6px;border-radius:3px;background:#e9ebf0;box-shadow:inset 0 1px 2px rgba(31,35,41,.08)}',
    /* 滑钮/刻度的定位域(见 TRACK_INSET 注释):两端各内缩一个半径,
     * p=0 / p=100 时滑钮外沿正好与轨道端点相切。 */
    '.in{position:absolute;left:10px;right:10px;top:0;bottom:0}',
    '.fill{position:absolute;left:0;top:9px;height:6px;border-radius:3px;background:linear-gradient(90deg,#6aa1ff,#165dff);box-shadow:inset 0 1px 0 rgba(255,255,255,.35)}',
    '.tick{position:absolute;top:4px;width:1px;height:16px;background:#d3d7de;transform:translateX(-50%)}',
    '.tick.rec{width:2px;height:18px;top:3px;background:#00b42a}',
    '.thumb{position:absolute;top:3px;width:18px;height:18px;margin-left:-9px;border-radius:50%;',
    '  background:#fff;border:2.5px solid #165dff;box-shadow:0 2px 6px rgba(22,93,255,.35),0 0 0 3px rgba(22,93,255,.1)}',
    '.thumb::after{content:"";position:absolute;left:50%;top:50%;width:6px;height:6px;margin:-3px 0 0 -3px;border-radius:50%;background:#165dff}',
    '.track:active .thumb{box-shadow:0 2px 8px rgba(22,93,255,.45),0 0 0 5px rgba(22,93,255,.14)}',

    '.readout{margin:10px -18px 0;padding:10px 18px 12px;border-top:1px solid #f2f3f5;background:#fbfcfe}',
    '.r1{font-size:12.5px;color:#4e5969;line-height:1.5}',
    /* 提示里的加粗字跟着**当前所在色带**上色(用户 2026-10-25 定):
       落在哪一段,数字与关键字就用那一段的颜色,和上面色带一眼对得上。 */
    '.r1 b{font-size:14px;font-weight:600;font-variant-numeric:tabular-nums;color:#165dff}',
    '.readout[data-zone="r"] .r1 b,.readout[data-zone="r"] .r2 b{color:#c62222}',
    '.readout[data-zone="g"] .r1 b,.readout[data-zone="g"] .r2 b{color:#0a8f28}',
    '.readout[data-zone="o"] .r1 b,.readout[data-zone="o"] .r2 b{color:#c25e00}',
    '.r2{font-size:11px;color:#86909c;line-height:1.55;margin-top:2px}',
    '.r2 b{color:#0a8f28;font-weight:600}',
    '.bdg{display:inline-block;font-size:10px;line-height:15px;padding:0 5px;border-radius:3px;',
    '  background:#f2fdf5;color:#0a8f28;border:1px solid #b7ebc6;margin-left:6px;vertical-align:1px;font-weight:500}',
    '.r3{font-size:10.5px;color:#86909c;line-height:1.5;margin-top:5px;padding-top:5px;border-top:1px dashed #eef0f3}',
    '.r3.warn{color:#c25e00}',
    '.r3.stop{color:#c62222}'
  ].join('\n');

  function buildUI() {
    if (host && host.isConnected) return;
    host = document.createElement('div');
    host.id = 'dyc-auto-loop-host';
    host.style.cssText = 'all:initial;position:fixed;left:0;top:0;width:0;height:0;z-index:2147482000';
    shadow = host.attachShadow({ mode: 'open' });

    var st = document.createElement('style');
    st.textContent = CSS;
    shadow.appendChild(st);

    var cap = document.createElement('div');
    cap.className = 'cap';
    cap.hidden = true;
    cap.innerHTML = '<button type="button" class="cap-main" aria-label="展开循环讲解设置" aria-expanded="false"><span class="dot"></span>' +
      '<svg class="ico" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"' +
      ' stroke-linecap="round" stroke-linejoin="round">' +
      '<rect x="6" y="1.7" width="4" height="7.2" rx="2"/>' +
      '<path d="M3.7 7.3a4.3 4.3 0 0 0 8.6 0"/><path d="M8 11.6v2.2"/>' +
      '<path d="M6.4 13.8h3.2"/></svg>' +
      '<span class="txt">循环讲解</span>' +
      '<svg class="inf-mark" viewBox="0 0 28 14" fill="none" stroke="currentColor"' +
      ' stroke-width="2" stroke-linecap="round" aria-hidden="true">' +
      '<path d="M7 1.6C4 1.6 1.6 4 1.6 7S4 12.4 7 12.4' +
      'c3 0 4.7-2.4 7-5.4 2.3-3 4-5.4 7-5.4 3 0 5.4 2.4 5.4 5.4S24 12.4 21 12.4' +
      'c-3 0-4.7-2.4-7-5.4-2.3-3-4-5.4-7-5.4Z"/></svg>' +
      '<span class="slot">未开启</span></button>' +
      '<button type="button" class="power">开启</button>';
    shadow.appendChild(cap);

    var panel = document.createElement('div');
    panel.className = 'panel';
    panel.innerHTML = [
      '<div class="ph"><b>自动循环讲解</b>' +
      '<button type="button" class="inf" aria-pressed="false" title="无限循环:接不上只守候,不停表">' +
      '<span class="ig" aria-hidden="true">&#8734;</span> 无限</button></div>',
      '<div class="grp" data-g="sec" aria-pressed="true">',
      '<div class="gh"><span class="rd"></span><span class="gt">秒档</span></div>',
      '<div class="seg"></div></div>',
      '<div class="grp" data-g="min" aria-pressed="false">',
      '<div class="gh"><span class="rd"></span><span class="gt">分钟档</span></div>',
      '<div class="zones"><span class="r">秒杀 · 引流</span><span class="g">承接 · 利润</span><span class="o">高客单</span></div>',
      '<div class="ticks"></div>',
      '<div class="track" role="slider" tabindex="0" aria-label="分钟间隔">',
      '<div class="rail"></div><div class="fill"></div><div class="in"><div class="thumb"></div></div></div></div>',
      '<div class="readout"><div class="r1"></div><div class="r2"></div><div class="r3" hidden></div></div>'
    ].join('');
    shadow.appendChild(panel);

    refs.cap = cap;
    refs.capSlot = cap.querySelector('.slot');
    refs.capInf = cap.querySelector('.inf-mark');
    refs.panel = panel;
    refs.capMain = cap.querySelector('.cap-main');
    refs.power = cap.querySelector('.power');
    refs.grpSec = panel.querySelector('.grp[data-g="sec"]');
    refs.grpMin = panel.querySelector('.grp[data-g="min"]');
    refs.secSeg = refs.grpSec.querySelector('.seg');
    refs.ticks = refs.grpMin.querySelector('.ticks');
    refs.track = refs.grpMin.querySelector('.track');
    refs.fill = refs.track.querySelector('.fill');
    refs.thumb = refs.track.querySelector('.thumb');
    refs.readout = panel.querySelector('.readout');
    refs.r1 = panel.querySelector('.r1');
    refs.r2 = panel.querySelector('.r2');
    refs.r3 = panel.querySelector('.r3');
    refs.inf = panel.querySelector('.inf');

    buildSecButtons();
    buildTicks();
    buildTrackMarks();
    paintGroups();

    refs.capMain.addEventListener('click', function (e) {
      e.stopPropagation();
      togglePanel();
    });
    panel.addEventListener('click', function (e) { e.stopPropagation(); });
    refs.power.addEventListener('click', function (e) {
      e.stopPropagation();
      setOn(!state.on, true);
    });
    /* 无限模式开关:只改「失败后停不停」,不动总闸与间隔。 */
    if (refs.inf) {
      refs.inf.addEventListener('click', function (e) {
        e.stopPropagation();
        setInfinite(!state.infinite, true);
      });
    }
    /* 收起态胶囊上的 ∞ 是**状态灯,故意不绑定任何点击**(2026-11-05 四次改)。
     * 用户原话:「它只展示实操效果,不包含点击起作用或者关闭的功能……具体要操作
     *   的话还是要点开这个框框,在右上角这里」。CSS 上再加 pointer-events:none,
     * 双保险:哪怕以后有人给它绑事件,点了也不会生效。 */


    /* 点框内任意位置 = 选这一组。落在档位按钮上的由按钮自己处理（它还要改值），
       所以这里往上找一层看是不是 .sg，是就交给子控件。 */
    refs.grpSec.addEventListener('click', function (e) {
      if (hasUp(e.target, 'sg', refs.grpSec)) return;
      setGroup('sec');
    });
    refs.grpMin.addEventListener('click', function (e) {
      if (hasUp(e.target, 'track', refs.grpMin)) return;
      setGroup('min');
    });

    /* 与自动刷新对齐的两条全局监听(2026-10-25 定,本次重排面板时不能丢):
     *   ① scroll 捕获:页面在滚就先藏胶囊,浮动层追不上滚动;
     *   ② pointerdown / click 捕获:真人一按下就把面板收起来,不等 click 走完。 */
    document.addEventListener('scroll', noteScroll, true);
    document.addEventListener('pointerdown', onDocClick, true);
    document.addEventListener('click', onDocClick, true);

    refreshTrack();
    bindDrag();

    (document.body || document.documentElement).appendChild(host);
    paint();
    place();
  }

  /** 从 el 往上找 className 含 cls 的祖先（到 stop 为止）—— 老内核没有 closest，自己走 */
  function hasUp(el, cls, stop) {
    var n = el;
    while (n && n !== stop) {
      if (n.className && typeof n.className === 'string' &&
          (' ' + n.className + ' ').indexOf(' ' + cls + ' ') >= 0) return n;
      n = n.parentNode;
    }
    return null;
  }

  /** 秒档四个固定档位：15 / 30 / 45 / 60，30 秒带推荐点。
   *  每档按钮内小字各自标注实际间隔范围(2026-11-01 用户定,取代原档位下方共用公式注):
   *  下限 = 档位 − 3,与 intervalMs 的偏移保持一致(15 档 = 12~15 秒,依此类推)。 */
  function buildSecButtons() {
    refs.secSeg.innerHTML = SEC_TIERS.map(function (v) {
      return '<button type="button" class="sg" data-sec="' + v + '" aria-pressed="false">' +
        (v === SEC_REC ? '<span class="pin"></span>' : '') +
        '<b>' + v + '</b><span class="u">' + (v - 3) + '~' + v + '秒</span></button>';
    }).join('');
    Array.prototype.forEach.call(refs.secSeg.children, function (el) {
      el.addEventListener('click', function (e) {
        e.stopPropagation();
        setGroup('sec');
        saveSeconds(parseFloat(el.getAttribute('data-sec')));
      });
    });
  }

  function buildTicks() {
    var list = [
      { v: 1, text: '1', cls: 'first' },
      { v: 3, text: '3', cls: 'rec' },
      { v: 5, text: '5', cls: '' },
      { v: 8, text: '8', cls: 'rec' },
      { v: 12, text: '12', cls: '' },
      { v: 15, text: '15', cls: 'last' }
    ];
    refs.ticks.innerHTML = list.map(function (t) {
      var left = t.cls === 'first' ? 0 : (t.cls === 'last' ? 100 : sliderPct(t.v));
      return '<button type="button" class="' + t.cls + '" data-v="' + t.v + '" style="left:' + left + '%">' + t.text + '</button>';
    }).join('');
    Array.prototype.forEach.call(refs.ticks.children, function (el) {
      el.addEventListener('click', function (e) {
        e.stopPropagation();
        var v = parseFloat(el.getAttribute('data-v'));
        setGroup('min');
        dampTo(v);
        saveMinutes(v);
      });
    });
  }

  /** 轨道推荐竖线:拼好 HTML 一次写入(perf-check R7:循环内不逐个 appendChild) */
  function buildTrackMarks() {
    var html = '';
    for (var v = MIN_MIN; v <= MAX_MIN; v++) {
      html += '<div class="tick' + (RECS.indexOf(v) >= 0 ? ' rec' : '') + '" style="left:' + sliderPct(v) + '%"></div>';
    }
    var marks = document.createElement('div');
    marks.className = 'marks';
    marks.innerHTML = html;
    /* 刻度跟着滑钮进内缩域:两者同一个坐标系,「3 分钟」那根推荐线
     * 才正好落在滑钮中心的正上方。 */
    var host = refs.track.querySelector('.in') || refs.track;
    var old = host.querySelector('.marks');
    if (old) old.remove();
    host.appendChild(marks);
  }

  /* ---------- 滑条:阻尼 + 吸附（只服务分钟档） ---------- */

  var slider = { cur: DEF_MIN, target: DEF_MIN, raf: 0 };
  var lastSliderTxt = '';

  /** 两个框与秒档按钮的选中态。谁亮着就是谁生效，不隐藏、不禁点。 */
  function paintGroups() {
    if (!refs.grpSec) return;
    refs.grpSec.setAttribute('aria-pressed', String(state.group === 'sec'));
    refs.grpMin.setAttribute('aria-pressed', String(state.group === 'min'));
    Array.prototype.forEach.call(refs.secSeg.children, function (el) {
      var on = state.group === 'sec' && parseFloat(el.getAttribute('data-sec')) === state.seconds;
      el.setAttribute('aria-pressed', String(on));
    });
    if (refs.track) {
      refs.track.setAttribute('aria-valuemin', MIN_MIN);
      refs.track.setAttribute('aria-valuemax', MAX_MIN);
    }
  }

  /** 切组:只换生效的那一组,不重开表。正在跑时按新间隔重设下一拍。 */
  function setGroup(g) {
    if ((g !== 'sec' && g !== 'min') || g === state.group) return;
    state.group = g;
    writeSetting(GROUP_KEY, g);
    abortCycle();
    slider.cur = slider.target = state.minutes;
    lastSliderTxt = '';
    paintGroups();
    paintReadout();
    restartInterval();
  }

  function refreshTrack() {
    var p = sliderPct(slider.cur);
    /* 填充条:起点固定在轨道最左端,终点落在滑钮圆心 —— 滑钮圆心在 .in
     * 里是 (100% - 2R) * p,换算回轨道坐标系再加一个 R。 */
    if (refs.fill) {
      refs.fill.style.width = 'calc(' + TRACK_INSET + 'px + (100% - '
        + (TRACK_INSET * 2) + 'px) * ' + (p / 100) + ')';
    }
    if (refs.thumb) refs.thumb.style.left = p + '%';
  }

  /** 读数区三段:主句(数值按落点染色) / 提示句(条件染色) / 状态行(只在异常出现) */
  /** 分钟档的「当前值」:拖动或阻尼动画中跟着滑钮走,静止时以存盘值为权威。
   *  2026-10-30 修:原来只读 state.minutes,而它只在松手时才更新 —— 拖动全程文案不动。 */
  function liveMinutes() {
    return (drag || slider.raf) ? Math.round(slider.cur * 2) / 2 : state.minutes;
  }

  function paintReadout() {
    if (!refs.r1) return;
    var isSec = state.group === 'sec';
    var cur = isSec ? state.seconds : liveMinutes();
    var shown = isSec ? ((cur - 3) + '~' + cur + ' 秒') : fmtMinute(cur);
    var rec = isSec ? (cur === SEC_REC) : (RECS.indexOf(cur) >= 0);
    var key = state.group + ':' + cur + ':' + state.seconds + ':' + state.minutes;
    if (key !== lastSliderTxt) {
      lastSliderTxt = key;
      refs.r1.innerHTML = '每隔 <b>' + shown + '</b> ' + (isSec ? '弹窗' : '循环') + '一次' +
        (rec ? '<span class="bdg">推荐</span>' : '');
      refs.r2.innerHTML = isSec ? '' : adviceOf(cur);
    }
    /* 秒档不写场景说明(用户 2026-10-30 定):读数区只留主句,实际范围与各档按钮内小字一致
     * (2026-11-01 用户定,取代原档位下方共用的公式注)。 */
    refs.r2.hidden = isSec;
    refreshTrack();
    paintStatusLine();
    /* 秒档只有 15 秒一档用红(与分钟档色带「秒杀·引流」同义);其余档回到默认蓝。 */
    var zone = isSec ? (cur === 15 ? 'r' : '') : zoneOf(cur).cls;
    refs.readout.setAttribute('data-zone', zone || '');
    if (refs.track) {
      var mv = isSec ? state.minutes : cur;
      refs.track.setAttribute('aria-valuenow', mv);
      refs.track.setAttribute('aria-valuetext', fmtMinute(mv));
    }
  }

  /** 第三行:只有异常(跳过 / 让路 / 已停止)才出现,正常态不占高度 */
  function paintStatusLine() {
    if (!refs.r3) return;
    /* 守夜期常驻这一行:胶囊槽只有 3 个字,守了多久、探了几次得有个地方看见。
     * 由 vigilTick 每秒刷一次(它本来就 2 秒一拍),不额外加定时器。 */
    if (state.on && state.phase === 'vigil') {
      refs.r3.hidden = false;
      refs.r3.className = 'r3 warn';
      /* 进守夜的原因只在头 60 秒显示:它是"为什么进来的",不是常驻状态,
       * 一直挂着会把真正有用的"守了多久 / 探了几次"挤没了。 */
      var why = (Date.now() - state.vigilAt < 60000 && state.vigilWhy)
        ? ' · ' + state.vigilWhy : '';
      /* 待命:不写「补讲」—— 待命期压根不会去点,写了反而让人以为它随时会动手。 */
      if (state.passive) {
        refs.r3.textContent = '待命中 ' + fmtLeft(Date.now() - state.vigilAt) +
          ' · 探 ' + state.probeCount + ' 次 · 等下一个讲解' + why;
        return;
      }
      refs.r3.textContent = '无限 · 守候中 ' + fmtLeft(Date.now() - state.vigilAt) +
        ' · 探 ' + state.probeCount + ' 次' + why +
        (state.resumeFails ? ' · 补讲 ' + state.resumeFails + ' 次未成' : '');
      return;
    }
    var t = state.status || '';
    refs.r3.hidden = !t;
    refs.r3.textContent = t.text || '';
    refs.r3.className = 'r3' + (t.kind ? ' ' + t.kind : '');
  }

  function setStatusLine(text, kind) {
    state.status = text ? { text: text, kind: kind || '' } : null;
    paintStatusLine();
  }

  function sliderStep() {
    var d = slider.target - slider.cur;
    if (Math.abs(d) < 0.02) {
      slider.cur = slider.target;
      paintReadout();
      slider.raf = 0;
      return;
    }
    slider.cur += d * 0.35;      // 每帧追 35%,约 120ms 到位
    paintReadout();
    slider.raf = requestAnimationFrame(sliderStep);
  }

  function kickSlider() {
    if (!slider.raf) slider.raf = requestAnimationFrame(sliderStep);
  }

  function dampTo(v) {
    slider.target = Math.min(Math.max(v, sliderMin()), sliderMax());
    kickSlider();
  }

  /** 滑条像素 → 分钟值。rect 可外部传入:拖动期间面板位置冻结,轨道矩形不变,不必每帧重读布局。 */
  function valueAt(clientX, rect) {
    var r = rect || refs.track.getBoundingClientRect();
    /* 滑钮的行程不是轨道全宽:两端各内缩 TRACK_INSET,指针与滑钮中心才严格
     * 对齐(否则压到轨道极左/极右时值已到头、滑钮还差 10px 没跟上)。 */
    var usable = Math.max(1, r.width - TRACK_INSET * 2);
    var x = Math.min(Math.max(clientX - r.left - TRACK_INSET, 0), usable);
    return sliderMin() + (x / usable) * (sliderMax() - sliderMin());
  }

  /** 只承认真人手势:自动刷新每 10 秒派发的合成点击 isTrusted=false,不能当成用户松手。
   *  测试环境(jsdom)里 isTrusted 恒为 false 且不可改写,故留一个显式放行钩子。 */
  function isRealGesture(e) {
    if (!e) return true;
    if (typeof window.__dycTestTrusted === 'function') return window.__dycTestTrusted(e) !== false;
    return e.isTrusted !== false;
  }

  function bindDrag() {
    var t = refs.track;
    var cancelAt = 0;

    /* ★ 2026-10-30 用户报「原生刷新列表会卡断滑动,拖到一半要重新点才能继续」。
     *   三个真凶:
     *   ① move 只绑在轨道上 —— 刷新把轨道重排、指针一离开就收不到 move;
     *   ② 自动刷新每 10 秒派发一套**合成点击**(pointerdown→pointerup→click),
     *      其中 pointerup 冒泡到 window,被我们的结束监听当成「用户松手」⇒ 拖动直接终止;
     *   ③ 刷新时的重排/滚动接管会让浏览器派发 pointercancel,同样被当成松手。
     *   对策:move/cancel 挂 document;end 只认 isTrusted 的真手势;cancel 给 900ms 宽限;
     *   并向外公布「有人在拖」,让自动刷新本轮让路(见 auto-refresh.js 的 tick)。 */

    /** 拖动期间置位:自动刷新看到它就顺延一轮(1500ms 自然过期,松手清零) */
    function markDrag(on) { window.__dycUserDragUntil = on ? Date.now() + 1500 : 0; }

    function onMove(e) {
      if (!drag) return;
      /* 松手事件可能丢(切窗口 / 被平台吞掉)⇒ 用 buttons 兜底收尾;
       * 合成事件(isTrusted=false)不参与判定,免得刷新把自己的 move 算成松手。 */
      if (typeof e.buttons === 'number' && e.buttons === 0 && isRealGesture(e)) { end(e); return; }
      cancelAt = 0;                            // 还有 move ⇒ 手势是活的,pointercancel 作废
      drag.raw = valueAt(e.clientX, drag.rect);
      drag.at = Date.now();
      dampTo(drag.raw);
      markDrag(true);
      e.stopPropagation();
    }
    function onCancel(e) {
      if (!drag) return;
      /* 触摸拖动遇到列表重排 / 滚动接管时浏览器会派发 pointercancel。
       * 它不是用户松手 —— 直接结束就是「拖到一半断了」。给 900ms 宽限:
       * 期间还有 move 就继续拖,彻底没动静才收。 */
      cancelAt = Date.now();
      setTimeout(function () {
        if (drag && cancelAt && Date.now() - cancelAt >= 850) end();
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
    function end(e) {
      if (!drag) return;
      /* 只承认真人手势:合成 pointerup 冒泡到 window 时会被这里拦下。 */
      if (!isRealGesture(e)) return;
      drag = null;
      cancelAt = 0;
      markDrag(false);
      detach();
      var v = snapMinute(slider.target);
      dampTo(v);
      saveInterval(v);
      e2Report(v);
    }
    var e2Report = function (v) {
      // 时长变更只更新一行状态(不弹提示):调时长是静默动作
      if (typeof debugLog === 'function') debugLog('循环间隔改为 ' + fmtMinute(v));
    };
    t.addEventListener('pointerdown', function (e) {
      setGroup('min');                       // 拖滑条 = 启用分钟档(2026-10-30 定)
      /* 轨道矩形在这里读一次:拖动期间面板被 place() 冻结,位置不会再变 ——
       * 原来每个 pointermove 都 getBoundingClientRect(),等于每帧强制一次布局计算。 */
      var rect0 = refs.track.getBoundingClientRect();
      drag = { raw: valueAt(e.clientX, rect0), at: Date.now(), rect: rect0 };
      cancelAt = 0;
      markDrag(true);
      attach();                              // 先接管再取值:刷新抖一下也不丢手势
      try { t.setPointerCapture(e.pointerId); } catch (e2) { /* 老内核可能没有 */ }
      dampTo(drag.raw);
      e.preventDefault();
      e.stopPropagation();
    });
    window.addEventListener('pointerup', end, true);
    bindDrag._end = end;
    t.addEventListener('keydown', function (e) {
      var step = 0.5;
      var v = sliderValue();
      if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') v -= step;
      else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') v += step;
      else if (e.key === 'Home') v = sliderMin();
      else if (e.key === 'End') v = sliderMax();
      else return;
      setGroup('min');
      e.preventDefault();
      v = Math.max(sliderMin(), Math.min(sliderMax(), v));
      dampTo(v); saveInterval(v);
    });
  }

  /* ---------- 位置:每拍按标题行实测矩形重贴 ---------- */

  /* 与自动刷新的两条显隐口径对齐(2026-10-25 用户要求「向自动刷新学习」):
   *   ① 页面在滚 ⇒ 先藏:浮动层追不上滚动,边跟边拖会像被拖拽的贴纸;
   *   ② 平台弹层打开 ⇒ 藏:z-index 很高,不藏就会浮在弹窗内容上。 */
  var scrollHideUntil = 0;

  function noteScroll() {
    /* ★ 2026-10-27:找款/续讲期间我们自己会滚屏、会跳搜索 —— 那些 scroll 事件
     *   不是用户在滚,不能拿它把胶囊藏起来(藏了再显就是「一直闪」)。
     *   用户在动(pointerdown / wheel / 触摸)时照旧让路。 */
    if (state.busy && !userBusy()) return;
    if (drag) return;                        // 拖动滑条中:刷新诱发的滚动不该把胶囊藏掉
    scrollHideUntil = Date.now() + 220;
    if (refs.cap) refs.cap.hidden = true;
  }

  var modalCheckedAt = 0, modalRects = null;

  /* 面积门槛:低于视口 12% 的浮层不算「挡道」。
   * 2026-10-27 用户原话:「自动刷新和讲解循环两个按钮不要因为右上角的小框框弹出就隐藏」——
   * 中控台右上角那张「智能推荐」小卡片只有 140×140 左右(≈1.3% 视口),
   * 旧写法「弹层存在 ⇒ 藏」让它一弹出来两枚按钮就消失,而它根本没盖住我们。 */
  var BIG_OVERLAY_RATIO = 0.12;

  /**
   * 带 500ms 缓存的**大浮层矩形**采集(place() 250ms 一拍,不能每拍扫选择器)。
   * 2026-10-27 起连矩形一起采 —— 判据从「有弹层」变成「弹层真的盖住胶囊」。
   *
   * ★ 当天又改一次(用户报「点添加商品,胶囊还浮在最上面,而刷新圆钮已经正确隐藏了」):
   *   只认 `.auxo-modal-root` 太窄 —— 「添加商品」是**抽屉**,不挂这个类名(#98 在圆钮那边踩过同一个坑),
   *   于是圆钮藏了、胶囊没藏。现在采的口径与 auto-refresh 对齐:
   *     ① 6 个 auxo 浮层/弹层类名(modal / modal-wrap / drawer / dropdown / popover / select-dropdown);
   *     ② [role="dialog"] —— ARIA 弹层语义,不依赖类名;
   *     ③ body 直子层里类名含 modal/dialog/drawer/overlay/popup(含 CSS Modules 的 xxx_modal__hash)。
   *   仍然只收**够大**(面积 ≥ 视口 12%)的 —— 右上角「智能推荐」那种小卡片继续不算挡道。
   */
  var OVERLAY_SEL = [
    '.auxo-modal-root', '.auxo-modal-wrap', '.auxo-drawer',
    '.auxo-dropdown', '.auxo-popover', '.auxo-select-dropdown'
  ];
  var OVERLAY_WORD_RE = /(^|[-_ ])(modal|dialog|drawer|overlay|popup)([-_ ]|$)/i;

  function modalRectsNow() {
    var t = Date.now();
    if (modalCheckedAt && t - modalCheckedAt < 500) return modalRects || [];
    modalCheckedAt = t;
    var out = [];
    var vw = window.innerWidth || document.documentElement.clientWidth || 1600;
    var vh = window.innerHeight || document.documentElement.clientHeight || 900;
    var minArea = vw * vh * BIG_OVERLAY_RATIO;
    function push(el) {
      var rc;
      try { rc = el.getBoundingClientRect(); } catch (e) { return; }
      if (!rc || rc.width < 16 || rc.height < 16) return;
      if (rc.width * rc.height < minArea) return;      // 小卡片 / 下拉菜单不算挡道
      out.push(rc);
    }
    for (var i = 0; i < OVERLAY_SEL.length; i++) {
      var els = document.querySelectorAll(OVERLAY_SEL[i]);
      for (var k = 0; k < els.length; k++) push(els[k]);
    }
    var dlgs = document.querySelectorAll('[role="dialog"]');
    for (var d = 0; d < dlgs.length; d++) push(dlgs[d]);
    var top = document.body ? document.body.children : [];
    for (var b = 0; b < top.length; b++) {
      var c = top[b];
      var cls = (c && c.className) ? String(c.className) : '';
      if (OVERLAY_WORD_RE.test(cls)) push(c);
    }
    modalRects = out;
    return out;
  }

  /** 兼容旧口径:页面上有没有够大的居中弹层(现在没人拿它单独当隐藏判据) */
  function modalOpen() {
    return modalRectsNow().length > 0;
  }

  /** 这块区域有没有被大弹层**真的盖住** */
  function modalCovers(rect) {
    if (!rect) return false;
    /* 2026-11-01(#126 / #127):与 auto-refresh 同一条口径 —— 判据统一到
     * src/content/overlay-guard.js(交集 ≥ 控件 35%,下拉面板也算挡道)。
     * 共享模块缺席时退回本地旧判据(面积 ≥ 视口 12%),保证胶囊照样会避让。 */
    var g = window.dycOverlayGuard;
    if (g && typeof g.covers === 'function') {
      return g.covers(rect);
    }
    var list = modalRectsNow();
    for (var i = 0; i < list.length; i++) {
      var o = list[i];
      if (rect.left < o.right && rect.right > o.left &&
          rect.top < o.bottom && rect.bottom > o.top) return true;
    }
    return false;
  }

  /* ==========================================================
   * 落位吸附(2026-10-26)
   * ----------------------------------------------------------
   * 用户原话:「这两个自添加的按钮,会因为原生的刷新在刷新,然后会轻微左右抖动,
   *   希望位置固定且不抖动」「两个按钮应该在同一个水平线上,不要因为其他按钮影响而抖动」。
   * 根因不是算错,而是**每拍照抄测量值**:平台刷新期间按钮群会重排、图标会换加载态,
   * getBoundingClientRect 每拍能差 1~3px;250ms 一拍抄下来,就是肉眼可见的左右抖。
   * 规则:
   *   |Δ| ≤ 2px  ⇒ 当噪声,**不写 style**(位置就此固定)
   *   |Δ| ≥ 10px ⇒ 真移动(切页 / 换行 / 缩放),立刻跟
   *   中间档     ⇒ 连续两拍指同一个目标才跟(滤掉刷新那一瞬的单拍值)
   * 复位时机:从藏到显、窗口缩放 —— 别让旧坐标把新位置挡两拍。
   * auto-refresh.js 里那盏灯用的是同一套规则(各自持有状态,互不依赖)。
   * ========================================================== */
  var SETTLE_SMALL = 2;      // ≤2px:当噪声,不动
  var SETTLE_BIG = 10;       // ≥10px:真移动,立刻跟
  var settleSt = {};         // { key: {cur, want, streak} }

  /* 圆钮位预留(2026-10-27 用户:「其中一个按钮隐藏了,另外的按钮不需要自动回补位置,
   *   这样子也算视觉跳动」)。
   * 胶囊的横向基准是「自动刷新圆钮的左边缘」,圆钮一旦不在(关掉 / 被浮层压住藏起来 /
   * 滚动时暂时隐身),旧写法就退到「刷新列表左边缘」—— 胶囊当场右移 34px 补空位,这就是
   * 用户看到的又一次跳动。现在改成**按同一格预留**:没有圆钮也留出它那一格。
   * 34 = 8(间距)+ 26(圆钮直径),与 auto-refresh.js 的 LAMP_GAP / LAMP_HIT 对齐;
   * 真量到过就记进 lampSlotDX(更可信,也不怕以后改尺寸)。 */
  var LAMP_SLOT_DX = 34;
  var lampSlotDX = 0;

  function resetSettle(key) {
    if (key) delete settleSt[key];
    else settleSt = {};
  }

  /** 返回要写入的新坐标;null = 保持原值(这就是「位置固定」的实现) */
  function settle(key, want) {
    want = Math.round(want);
    var st = settleSt[key];
    if (!st) st = settleSt[key] = { cur: null, want: null, streak: 0 };
    if (st.cur === null || !isFinite(st.cur)) {
      st.cur = want; st.want = want; st.streak = 0; return want;
    }
    var d = Math.abs(want - st.cur);
    if (d <= SETTLE_SMALL) { st.want = want; st.streak = 0; return null; }
    if (d >= SETTLE_BIG) { st.cur = want; st.want = want; st.streak = 0; return want; }
    if (st.want === want) st.streak++; else { st.want = want; st.streak = 1; }
    if (st.streak >= 2) { st.cur = want; st.streak = 0; return want; }
    return null;
  }

  /**
   * 两个矩形是否在同一条水平带上 —— 只用于判断「能不能互相当位置基准」。
   * 圆钮(刷新灯)与锚点不在同一行时(比如 tab 在上一行),就不该拿它定纵向,
   * 否则胶囊会被拉到别的行上去。
   */
  function sameRowBand(r1, r2) {
    if (!r1 || !r2) return false;
    var c1 = r1.top + r1.height / 2, c2 = r2.top + r2.height / 2;
    var tol = Math.max(12, Math.min(r1.height, r2.height) / 2);
    return Math.abs(c1 - c2) <= tol;
  }

  /** 自动刷新那枚 26px 圆钮(挂 body 上,不在行内 ⇒ 只能按类名取) */
  function findAutoRefreshBtn(readings) {
    try {
      var el = document.querySelector('.dyc-ar-lamp');
      if (!el) return null;
      var r = rectOnce(el, readings);
      if (r.width < 16 || r.height < 16) return null;
      return el;
    } catch (e) { return null; }
  }

  /**
   * 落点(2026-10-26 重写 · #119 / #120「浮窗有遮挡」)
   * ----------------------------------------------------------
   * 旧口径只有一个假设:行内有原生【刷新列表】,于是固定往它左边排、并预留 26px 给
   * 自动刷新圆钮。这个假设一旦不成立(行里没有刷新按钮 / 圆钮没开 / 面板更窄),
   * 落点就会跑出行外 —— 截图里它压在实时数据卡片的右缘上,就是这么来的。
   *
   * 新口径三条硬约束:
   *   ① **纵向**只允许落在「让位基准」那一行的高度带内(见下面 basis),绝不爬到别的区块上;
   *   ② **横向**只允许落在 [行左 +8, 行右 -8] 之内,按顺序试三个候选:
   *      ①让位基准左侧(基准再退 8px)
   *      ②tab 文案右侧 +12  ③行右端内侧;
   *   ③ 行内放不下完整胶囊(width 156)→ 退化成 26px 小圆点(只留灯),
   *      最坏情况也只盖住一小点,点一下仍能展开完整面板。
   *
   * 2026-10-26 追加(用户报「原生一刷新,两枚自加按钮就轻微左右抖」):
   *   ④ **让位基准只认一个**,顺序 = 自动刷新圆钮 → 行内原生刷新列表 → 锚点行右端,
   *      并且必须先过「同一行」这道闸(sameRowBand)。旧写法 min(三者) 会把测量噪声
   *      串成一条链:圆钮抖 1px,胶囊跟着抖,刷新一瞬间整排都在动。
   *   ⑤ 纵向跟着**基准的中心**走,不再用锚点行中心 —— 这样胶囊与圆钮恒在同一水平线上。
   *   ⑥ 算出来的坐标先过 settle() 吸附:2px 以内不动、10px 以上立刻跟、中间档两拍确认。
   */
  function place() {
    if (!host) return;
    /* ★ 2026-10-27 用户报「全局轮询的时候,这个按钮不要一直跳动」。
     *   找款 / 续讲那几秒里,滚屏、跳搜索、跳回来**全是我们自己干的** ——
     *   锚点因此大幅位移,place() 若照常跟随,胶囊就在屏幕上到处飞。
     *   ⇒ 整个动作期间**位置冻结**:不算新坐标、不写 style、也不因滚动隐身。
     *   (动作收尾时 doCycle 会 resetSettle + place 一次性贴回真实位置) */
    /* ★ 2026-10-30 用户报「原生刷新列表会卡断滑动」:拖动滑条期间同样冻结位置。
     *   刷新会把锚点重排/短暂抹掉,这时重贴一次面板,手指还按着、滑钮却跳走了。 */
    if (state.busy || drag) {
      /* 手势事件彻底丢了(切窗口 / 被平台吞掉 up)也不能永久冻结:超 20 秒自动收尾 */
      if (drag && Date.now() - (drag.at || 0) > 20000 && bindDrag._end) { bindDrag._end(); return; }
      if (!drag && refs.cap && refs.cap.hidden) { refs.cap.hidden = false; resetSettle(); }
      return;
    }
    /* 2026-10-27:弹层不再「存在即隐藏」,改成算完坐标后判「有没有真的盖住胶囊」
     * (见下面 modalCovers 那一段)。滚动隐藏不变 —— 那是跟不跟手的问题。 */
    if (Date.now() < scrollHideUntil) {
      if (refs.cap) refs.cap.hidden = true;
      return;
    }
    var readings = [];
    var a = findAnchor(readings);
    var cap = refs.cap;
    var panel = refs.panel;
    if (!a) {
      // ★ 锚点会被平台重渲染换掉(自动刷新列表、React 重排都会),那一瞬找不到属正常。
      //   2026-10-27:以前**立刻藏**,右上角小卡片一弹就闪一下没了;
      //   现在给 900ms 宽限 —— 只是重排就原地待着,真走了(切页 / 收起小黄车)才收。
      //   面板仍按原口径:超过 5 秒仍找不到才关。
      if (!anchorMissingAt) anchorMissingAt = Date.now();
      if (Date.now() - anchorMissingAt > 900) cap.hidden = true;
      if (panelOpen && Date.now() - anchorMissingAt > 5000) closePanel();
      return;
    }
    anchorMissingAt = 0;
    var r = rectOnce(a, readings);
    var vh = window.innerHeight || document.documentElement.clientHeight;
    // 锚点整块滚出视口 ⇒ 收起来(只影响显隐,不影响计时)
    if (r.bottom < 0 || r.top > vh) {
      cap.hidden = true;
      closePanel();            // 视觉与 panelOpen 一起收,避免「点一下没反应、点两下才开」
      return;
    }
    /* 从藏到显 ⇒ 清掉吸附记忆,下一行立刻贴到当前实测位(否则会先停在旧坐标两拍) */
    if (cap.hidden) { cap.hidden = false; resetSettle(); }

    var CW_FULL = 224, CW_MINI = 70;
    var row = anchorRow || a;

    // —— 让位基准:**只认一个**,优先我们自己的圆钮(它被 auto-refresh 冻结 + 吸附) ——
    var basis = null;
    var ab = findAutoRefreshBtn(readings);
    if (ab) {
      var abR = rectOnce(ab, readings);
      if (sameRowBand(r, abR)) {
        basis = { left: abR.left, cy: abR.top + abR.height / 2 };
        /* 顺手把「圆钮相对刷新列表左边缘的偏移」量下来存着(只量一次):
         * 圆钮不在时要按同一格预留,不能靠写死的 34 去猜。 */
        if (!lampSlotDX) {
          var rf0 = findRefreshInRow(row, readings);
          if (rf0) {
            var r0 = rectOnce(rf0, readings);
            var dx0 = Math.round(r0.left - abR.left);
            if (sameRowBand(r, r0) && dx0 > 8 && dx0 < 80) lampSlotDX = dx0;
          }
        }
      }
    }
    if (!basis) {
      var rf = findRefreshInRow(row, readings);
      if (rf) {
        var rfR = rectOnce(rf, readings);
        if (sameRowBand(r, rfR)) {
          /* ★ 圆钮不在(关掉 / 被浮层压住 / 滚动时隐身)⇒ **照旧让出它那一格**,
           *   不往右挪去补空位。用户 2026-10-27:「另外的按钮不需要自动回补位置,
           *   这样子也算视觉跳动」。 */
          basis = { left: rfR.left - (lampSlotDX || LAMP_SLOT_DX), cy: rfR.top + rfR.height / 2 };
        }
      }
    }
    if (!basis) basis = { left: r.right - 4, cy: r.top + r.height / 2 };
    var blockLeft = Math.round(basis.left);

    var minLeft = Math.round(r.left + 8);
    var maxLeftFull = Math.round(r.right - 8 - CW_FULL);
    var mini = false;
    var left = null;

    if (anchorMode === 'tab') {
      /* 只认到 tab 文案这一档:锚点本身就是个窄节点(r.width 常 < 80),
       * 按「行边界」夹会把完整胶囊硬挤成小圆点 —— 那不是用户要的。
       * 这一档仍按老口径贴文案右侧 12px,只有视口真装不下才退 mini。 */
      left = Math.round(r.right + 12);
      mini = (left + CW_FULL > (window.innerWidth || document.documentElement.clientWidth) - 4);
    } else {
      var want = Math.round(blockLeft - 8 - CW_FULL);       // ① 让位基准左侧
      if (want >= minLeft && want <= maxLeftFull) {
        left = want;
      } else {
        var tabsRight = anchorMode === 'title' ? tabsRightEdge(row) : 0;
        var cand2 = tabsRight ? Math.round(tabsRight + 12) : null;   // ② tab 条右侧
        if (cand2 !== null && cand2 >= minLeft && cand2 + CW_FULL <= Math.round(r.right - 8)) {
          left = cand2;
        } else if (maxLeftFull >= minLeft) {
          left = maxLeftFull;                                        // ③ 行右端内侧
        } else {
          mini = true;                                               // 行太窄 ⇒ 小圆点
          left = Math.round(r.right - 8 - CW_MINI);
        }
      }
    }
    var cw = mini ? CW_MINI : CW_FULL;
    /* 纵向:与**让位基准的中心**对齐 —— 胶囊与自动刷新圆钮因此恒在同一条水平线上。
     * (2026-10-26 用户原话:「这两个按钮应该在同一个水平线上」) */
    var top = Math.round(basis.cy - 11);

    var vw = window.innerWidth || document.documentElement.clientWidth;
    left = Math.min(Math.max(4, left), Math.max(4, vw - cw - 4));
    top = Math.min(Math.max(0, top), Math.max(0, vh - 24));

    if (cap.classList.contains('mini') !== mini) cap.classList.toggle('mini', mini);
    /* 大弹层真的压住胶囊才让位(#98 的本意);右上角那种小卡片压不着,不藏。
     * 判据用「这一拍算出来的位置」而不是旧位置 —— 否则弹层一开一关会有一拍错位。 */
    if (modalCovers({ left: left, top: top, right: left + cw, bottom: top + 22 })) {
      cap.hidden = true;
      /* 面板也一起收:被大浮层压住时还浮着,视觉上就是「压在弹窗上面」(2026-10-27) */
      if (panelOpen) closePanel();
      return;
    }
    /* 落位吸附:≤2px 视为噪声不写、≥10px 立刻跟、中间档两拍确认(见 settle 头部注释) */
    var sl = settle('capL', left), stp = settle('capT', top);
    if (sl !== null) cap.style.left = sl + 'px';
    if (stp !== null) cap.style.top = stp + 'px';
    /* 面板要跟着**按钮实际所在的位置**走,不能跟着「这一拍算出来的位置」走 ——
     * 吸附生效时两者差 1~2px,不校正的话面板会跟按钮错开一条缝。 */
    left = parseFloat(cap.style.left);
    top = parseFloat(cap.style.top);
    if (!isFinite(left)) left = 0;
    if (!isFinite(top)) top = 0;
    if (!observerTarget || !observerTarget.isConnected) ensureObserver();

    if (!panelOpen) { panel.classList.remove('open'); return; }
    panel.classList.add('open');
    /* 面板贴着按钮展开:默认按钮正下方 6px、左边缘对齐;
     * 右边放不下就右对齐;下面放不下就翻到按钮上方。 */
    var pw = 344, ph = panel.offsetHeight || 200;
    var pl = left;
    var alignRight = false;
    if (pl + pw > vw - 8) { pl = left + cw - pw; alignRight = true; }
    pl = Math.min(Math.max(8, pl), Math.max(8, vw - pw - 8));
    var pt = top + 22 + 6;
    var above = false;
    if (pt + ph > vh - 8) { pt = Math.max(8, top - ph - 6); above = true; }
    panel.style.left = Math.round(pl) + 'px';
    panel.style.top = Math.round(pt) + 'px';
    panel.style.setProperty('--ox', alignRight ? '100%' : '0');
    panel.style.setProperty('--oy', above ? '100%' : '0');
  }

  /** 小黄车面板容器:锚点的最近一个「宽度明显更大」的祖先 */
  function findCartPanel() {
    var head = findAnchor();
    if (!head) return null;
    var el = head, best = null;
    for (var i = 0; i < 6 && el && el !== document.body; i++) {
      el = el.parentElement;
      if (!el) break;
      var r = el.getBoundingClientRect();
      if (r.width >= 260 && r.height >= 160) { best = el; break; }
    }
    return best || head.parentElement || head;
  }

  /**
   * 点框外收起。
   * 判据只有一条:**这是不是真人手势**。
   *   · 真人鼠标/触屏点空白 ⇒ 收起(用户要的行为)
   *   · 别的功能 / 我们自己的 programmatic click ⇒ 不收
   *     (isTrusted=false、detail=0;2026-10-25 修的就是「自动刷新把小黄车刷一下,
   *      调整框跟着没了」—— 那一下是自动刷新发的 click,不是用户点的)
   *   · 按下事件在影子树里(点胶囊/面板本体) ⇒ 不收,交给胶囊自己的开关逻辑
   */
  function onDocClick(e) {
    if (!panelOpen) return;
    if (drag) return;                        // 拖动中不关面板(刷新会诱发额外 click)
    if (host && e.composedPath && e.composedPath().indexOf(host) >= 0) return;
    if (e.isTrusted === false) return;
    if (typeof e.detail === 'number' && e.detail === 0) return;
    if (Date.now() - lastSelfClickAt < 800) return;
    closePanel();
  }

  var lastSelfClickAt = 0;

  function togglePanel() { panelOpen ? closePanel() : openPanel(); }

  function openPanel() {
    panelOpen = true;
    if (refs.capMain) refs.capMain.setAttribute('aria-expanded', 'true');
    buildUI();
    place();
  }

  function closePanel() {
    panelOpen = false;
    if (refs.capMain) refs.capMain.setAttribute('aria-expanded', 'false');
    if (refs.panel) refs.panel.classList.remove('open');
  }

  /* ---------- 画面刷新 ---------- */

  var lastCap = '';
  /* nap10:上一次「盲模式提前补讲探测」的时刻(限频,别每一拍都读 DOM) */
  var lastPeekAt = 0;

  function paint() {
    if (!refs.cap) return;
    var cap = refs.cap;
    var slot = refs.capSlot;
    /* 无限模式开关的选中态跟着 state 走 —— 每次 paint 都刷,避免 reload 后
     * 胶囊(用户看得到的那个)与面板里的按钮不同步。 */
    if (refs.inf) {
      refs.inf.setAttribute('aria-pressed', state.infinite ? 'true' : 'false');
      refs.inf.title = state.infinite
        ? '无限循环已开:接不上只守候,不停表'
        : '无限循环:接不上只守候,不停表';
    }
    /* 2026-11-05 四次改:∞ 只做状态显示 —— 开=蓝、关=灰,不可点。
     * (上一版曾让它 hidden=!infinite,用户以为功能没做;再上一版做成可点按钮,
     *  用户说「不要做出按钮的效果」—— 现在的口径是:亮=开着,灰=关着。) */
    if (refs.capInf) {
      refs.capInf.classList.toggle('on', !!state.infinite);
    }
    /* ★ 必须把 off 一起清掉:off 的样式写在 on/wait/err 之后,
     *   残留一个 off 会把已开启时的绿/黄盖回灰色 —— 这正解释了
     *   「只见过绿色以外的颜色都没见过/关掉再开还是灰」这类现象。 */
    cap.classList.remove('on', 'wait', 'err', 'off');
    if (refs.power) {
      refs.power.textContent = state.on ? '停止' : '开启';
      refs.power.title = state.on ? '停止后仅手动开启才恢复' : '按当前模式和间隔开启循环';
      refs.power.setAttribute('aria-label', state.on ? '停止循环讲解' : '开启循环讲解');
    }

    var key;
    if (!state.on) {
      cap.classList.add('off');
      key = 'off';
      slot.textContent = state.stopped ? '已停止' : '未开启';
    } else if (state.busy) {
      /* ★ 2026-10-27 用户:「在找这个商品的时候,对应的时间占位符可以改一下文案」。
       *   动作期间倒计时是停的(不会累加),继续显示 mm:ss 会让人以为还在计时。
       * ★ 2026-10-30:细分成两个三字词 —— 常规轮「定位中」,慢轮调平台搜索时「搜索中」。
       *   两个词都是 3 字(≈33px),塞得进 46px 槽宽,胶囊宽度一个字都不变。 */
      cap.classList.add('on');
      key = 'busy:' + (state.busyLabel || '定位中');
      slot.textContent = state.busyLabel || '定位中';
    } else if (state.phase === 'vigil') {
      /* 守夜:循环还活着,但页面上什么都不做。胶囊用 wait(黄)而不是 err(红)——
       * 红是"出错了",黄是"还在等",语义不同。槽里固定 3 个字,宽度与「待讲解」一致。
       * 待命(手动取消后)另用「待命中」:它不会补讲,用户得知道这一档不会自己动手。 */
      cap.classList.add('wait');
      key = state.passive ? 'passive' : 'vigil';
      slot.textContent = state.passive ? '待命中' : '守候中';
    } else if (state.phase === 'run') {
      cap.classList.add('on');
      var left = fmtLeft(state.nextAt - Date.now());
      key = 'run:' + Math.floor((state.nextAt - Date.now()) / 1000);
      slot.textContent = left;
    } else if (state.phase === 'error') {
      cap.classList.add('err');
      key = 'err';
      slot.textContent = '重试中';
    } else {
      cap.classList.add('wait');
      key = 'wait';
      slot.textContent = '待讲解';
    }
    if (key !== lastCap) {
      lastCap = key;
    }
    paintReadout();
  }

  /* ==========================================================
   * 六、循环本体
   * ========================================================== */

  /**
   * 读时长。存 chrome.storage.local —— **长久记忆**:关浏览器、重启、清站点数据都不丢,
   * 也不受 fxg / buyin 两个域名的 localStorage 各自一套的影响。
   * 旧版本写在 localStorage 里,这里保留一次性迁移(localStorage 没有值就不管)。
   */
  function readMinutes() {
    return chrome.storage.local.get(MINUTES_KEY).then(function (r) {
      var v = r ? parseFloat(r[MINUTES_KEY]) : NaN;
      if (isFinite(v) && v >= MIN_MIN && v <= MAX_MIN) return normMin(v);
      // 迁移:老值在 localStorage
      try {
        var raw = window.localStorage.getItem(MINUTES_KEY);
        var v2 = raw ? parseFloat(raw) : NaN;
        if (isFinite(v2) && v2 >= MIN_MIN && v2 <= MAX_MIN) {
          chrome.storage.local.set(withKey(MINUTES_KEY, normMin(v2)));
          return normMin(v2);
        }
      } catch (e) { /* 忽略 */ }
      return DEF_MIN;
    }).catch(function () { return DEF_MIN; });
  }

  function normMin(v) { return Math.round(v * 2) / 2; }

  function withKey(k, v) {
    var o = {};
    o[k] = v;
    return o;
  }

  var settingsWrite = Promise.resolve();
  function writeSetting(key, value) {
    // 串行提交，防止连续启停时迟到的「开启」覆盖最后一次「停止」。
    settingsWrite = settingsWrite.then(function () {
      return chrome.storage.local.set(withKey(key, value));
    }).catch(function (e) {
      noteDiag('设置保存失败:' + (e && e.message));
      if (typeof setStatus === 'function') {
        setStatus('设置未保存', 'alert', { source: SOURCE, count: '重开后可能恢复旧设置', histKey: BOX_FAIL });
      }
    });
    return settingsWrite;
  }

  function readSettings(mark) {
    return Promise.all([readMinutes(),
      chrome.storage.local.get([GROUP_KEY, MODE_KEY, SECONDS_KEY, ENABLED_KEY, INFINITE_KEY])])
      .then(function (result) {
        if (mark !== setupSeq) return;
        var r = result[1] || {};
        state.minutes = result[0];
        /* 组:新键优先;老用户没有新键时按旧 mode 迁移(second→sec, minute→min)。 */
        if (r[GROUP_KEY] === 'sec' || r[GROUP_KEY] === 'min') {
          state.group = r[GROUP_KEY];
        } else {
          state.group = r[MODE_KEY] === 'second' ? 'sec' : 'min';
        }
        /* 秒档只认四档:旧值 5–14 秒按"向上取到 15"处理,不静默改小。 */
        var seconds = Number(r[SECONDS_KEY]);
        state.seconds = isFinite(seconds) ? snapSec(Math.max(15, seconds)) : SEC_DEF;
        state.on = r[ENABLED_KEY] !== false;
        state.stopped = !state.on;
        /* ★ 2026-11-08 口径变更(取代 2026-11-05「默认关闭」):
         *   用户原话:「经常我没有关掉循环讲解的按钮,但是不知为何它就停止要我手动触发开启,
         *   我不希望这样子,而是让它待命直到发现下一个讲解的品」。
         *   ⇒ 「接不上就停」这一侧不能当默认:一停就得人肉重开,夜间无人值守等于停摆。
         *   缺省开 = 待命;只有**显式关过**(存了布尔 false)才是关,记忆功能照旧。
         *   旧版本没这个键时是 undefined ⇒ 落回开。 */
        state.infinite = !(r[INFINITE_KEY] === false || r[INFINITE_KEY] === 0);
        /* 从存盘恢复「开」时也要记下起跑时刻,否则报告里「节奏」会算成 0 秒/轮
         * (实机 02:39:36 就是这个现象:完成 4 次、已跑 0 秒)。 */
        if (state.on) { state.runSince = Date.now(); state.cycles = 0; }
      }).catch(function () {
        if (mark !== setupSeq) return;
        // 读取失败时不猜测上次启停状态；留在停止态，用户可手动开启。
        state.on = false;
        state.stopped = true;
      });
  }

  /** 滑条只服务分钟档 —— 秒档是四个固定按钮,不走这里 */
  function saveInterval(v) { saveMinutes(v); }

  /** 秒档选档:吸到最近一档、存盘、重设下一拍(不重开表) */
  function saveSeconds(v) {
    var s2 = snapSec(v);
    state.seconds = s2;
    writeSetting(SECONDS_KEY, s2);
    lastSliderTxt = '';
    paintGroups();
    paintReadout();
    restartInterval();
    if (typeof debugLog === 'function') debugLog('秒档改为 ' + s2 + ' 秒');
  }

  function restartInterval() {
    // 改间隔后从现在重计，避免把滑动过程或已逾期时间补成一串点击。
    if (state.on && state.phase === 'run') {
      state.startedAt = Date.now();
      state.nextAt = state.startedAt + intervalMs();
    }
    paint();
  }

  function saveMinutes(v) {
    state.minutes = v;
    slider.target = v;
    writeSetting(MINUTES_KEY, v);
    try { window.localStorage.setItem(MINUTES_KEY, String(v)); } catch (e) { /* 双写,兼容旧版回退 */ }

    restartInterval();
  }

  /**
   * 无限模式开关(2026-11-05)。
   * 只改「接不上之后停不停」——不动总闸、不动间隔、不动档位。
   * 关掉时如果正处在守夜,按老规则立刻停表;不能留一个「已经关了却还在守」的幽灵状态。
   */
  function setInfinite(on, userAction) {
    state.infinite = !!on;
    if (userAction) {
      writeSetting(INFINITE_KEY, state.infinite);
      try { window.localStorage.setItem(INFINITE_KEY, state.infinite ? '1' : '0'); } catch (e) { /* 忽略 */ }
    }
    if (userAction && typeof debugLog === 'function') {
      debugLog('无限模式:' + (state.infinite ? '开' : '关'));
    }
    if (!state.infinite && state.phase === 'vigil') {
      stopVigil('已关闭无限模式');
      return;
    }
    paint();
  }

  function setOn(on, userAction) {
    abortCycle();
    state.on = !!on;
    state.stopped = !state.on;
    resetToWait();
    if (userAction) writeSetting(ENABLED_KEY, state.on);
    if (!state.on) {
      state.phase = 'off';
      state.startedAt = 0;
      state.nextAt = 0;
      state.product = '';
      // abortCycle 在入口执行；停止保留已展开菜单，只清执行状态。
    } else {
      state.phase = 'wait';
      state.fails = 0;
      state.retryAt = 0;
      state.runSince = Date.now();
      state.cycles = 0;
      state.owedResume = 0;
      state.cancelPending = 0;     // nap8:重开不该继承上次的"已发取消"阶段
      state.blindWaits = 0;
      state.blindSettled = 0;
      state.blindRefreshAt = 0;
      state.softFails = 0;
    }
    /* 守夜账本一起清:重开是新的开始,不继承上一轮的探针节奏与配额。
     * 注意 relocLog 也清 —— 用户主动关掉再开,等于重置一次,这是他的明确动作。 */
    state.vigilAt = 0;
    state.vigilLeft = 0;
    state.passive = 0;
    state.vigilWhy = '';
    state.probeAt = 0;
    state.probeCount = 0;
    state.relocAt = 0;
    state.relocLog = [];
    state.resumeAt = 0;
    state.resumeFails = 0;
    state.lastBtnSeen = 0;
    paint();
    if (userAction && typeof debugLog === 'function') {
      debugLog('自动循环讲解:' + (state.on ? '开' : '关'));
    }
    if (!state.on) return;
    checkNow();
  }

  var diagAt = {};
  /* 2026-10-26(#112):动作流水留一个内存环 —— 用户点「复制诊断」就能把证据带走。
   * 40 条、带时刻与阶段,足够看出「卡在哪个出口」,又不占消息盒子。 */
  var diagRing = [];
  function noteDiag(msg) {
    var d = new Date();
    var hh = ('0' + d.getHours()).slice(-2);
    var mm = ('0' + d.getMinutes()).slice(-2);
    var ss = ('0' + d.getSeconds()).slice(-2);
    diagRing.push(hh + ':' + mm + ':' + ss + ' [' + state.phase + '/' + (state.key || '-') + '] ' + msg);
    if (diagRing.length > 40) diagRing.shift();
  }

  /** 把「状态 + 现场快照 + 动作流水」复制到剪贴板 —— 用户粘回来就能定位 #112 */

  function fallbackCopy(text, done) {
    try {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.style.cssText = 'position:fixed;left:-9999px;top:0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      done();
    } catch (e) {
      if (typeof debugLog === 'function') debugLog('诊断复制失败:' + (e && e.message));
    }
  }

  /** 识别结果诊断:只在状态变化时写一条,方便事后从诊断报告里看出「为什么判成了这样」 */
  function diagOnce(key, why) {
    var now = Date.now();
    if (diagAt[key] && now - diagAt[key] < 60000) return;
    diagAt[key] = now;
    if (typeof debugLog !== 'function') return;
    var list = [];
    try { list = rows(); } catch (e) { list = []; }
    var marks = 0;
    try { marks = findAllLecturingMarks().length; } catch (e) { marks = 0; }
    debugLog('识别诊断｜' + why + '｜行 ' + list.length + ' 个 / 讲解中标记 ' + marks +
      ' 个 / 键「' + (state.key || '无') + '」/ 记录商品「' + (state.product || '无') + '」');
  }

  /* ==========================================================
   * 秒档:预算内直取 → 慢轮搜一次 → 跳过 → 熔断
   * ----------------------------------------------------------
   * 2026-10-30 定稿(用户口令):
   *   ① 找品期间**完全不计时** —— nextAt 只在「校验通过、确认在讲解」之后才设,
   *      所以周期 = 动作耗时 + 间隔,间隔是完整的静默期,不会被动作吃掉一秒;
   *   ② 秒档不滚屏:L2 平台搜索只在慢轮开一次,L3 分段扫永不进入;
   *   ③ 连续跳过 4 次熔断;5 分钟一次都没成功则无条件停。
   * ========================================================== */

  /** 一拍:只做「观察 + 到点判断」,动作在 doFastCycle 里加锁进行 */
  function checkFastNow() {
    var now = Date.now();
    var live = findLiveRow();

    if (!state.key) {
      if (live) commitProduct(rowKey(live), rowName(live), now);
      return;
    }
    // 用户手动换品沿用两拍确认，重渲染的一次抖动不重置计时。
    if (live && rowKey(live) !== state.key) {
      var key = rowKey(live);
      if (state.pendingKey !== key) { state.pendingKey = key; state.pendingTicks = 0; }
      state.pendingTicks += 1;
      if (state.pendingTicks >= ID_CONFIRM_TICKS) commitProduct(key, rowName(live), now);
      return;
    }
    state.pendingKey = '';
    state.pendingTicks = 0;

    /* 绝对兜底:从第一次失败起算 5 分钟仍没成功过一次 ⇒ 停。
     * 防的是「每轮都在给用户让路、失败计数永远不涨」这条路径。 */
    if (state.failSince && now - state.failSince > HARD_STOP_MS) {
      stopFast('连续 5 分钟没能续讲');
      return;
    }
    // 睡眠/锁屏醒来:过期太久不补点,直接重新计时
    if (state.lastShotAt && now - state.lastShotAt > intervalMs() + 120000) {
      state.startedAt = now;
      state.nextAt = now + intervalMs();
      state.lastShotAt = now;
      paint();
      return;
    }
    /* ★ nap10:盲模式「提前补讲探测」。
     *   我们发过取消、界面可能已经翻回来 ⇒ 不等满间隔,现在就补上。
     *   只读 DOM、只提前 nextAt,不在这里点任何东西(点击一律走 doFastCycle),
     *   所以探不到时的行为与旧版逐字一致 —— 纯增益,不会更差。 */
    if (state.cancelPending && !state.busy &&
        now - state.cancelPending >= PEEK_MIN_MS && now - lastPeekAt >= PEEK_MS) {
      lastPeekAt = now;
      var peekRow = null, peekBtn = null;
      try { peekRow = findRowByKey(); } catch (e) { peekRow = null; }
      if (peekRow) {
        try { peekBtn = findLectureBtn(peekRow); } catch (e) { peekBtn = null; }
      }
      if (peekBtn && kindOf(peekBtn) === 'start') {
        noteDiag('盲模式:界面已翻 ⇒ 提前补讲(取消后 ' +
          Math.round((now - state.cancelPending) / 1000) + ' 秒)');
        state.nextAt = now;       // 让本拍立刻执行补讲
      }
    }
    if (now >= state.nextAt) doFastCycle();
  }

  function stopFast(why) {
    /* 无限模式:秒档的任何「到顶」都转守夜(2026-11-05)。 */
    if (state.infinite && enterVigil(why)) return;
    var who = productName();
    noteDiag('秒档停止:' + why);
    boxNote(BOX_FAIL, 'alert', who, why + ' · 已停止');
    setOn(false, true);
    /* setOn 会 resetToWait 清状态,所以第三行必须在它之后写。 */
    setStatusLine('已停止 · ' + why, 'stop');
    paint();
  }

  /** 一轮没成:先「跳过」,连续 SKIP_LIMIT 次才熔断 —— 一次重渲染抖动不该杀掉整条循环 */
  function skipFast(why) {
    state.skips = (state.skips || 0) + 1;
    if (!state.failSince) state.failSince = Date.now();
    noteDiag('秒档跳过 ' + state.skips + '/' + SKIP_LIMIT + '：' + why);
    if (state.skips >= SKIP_LIMIT) { stopFast('连续 ' + SKIP_LIMIT + ' 轮没找到'); return; }
    var now = Date.now();
    state.startedAt = now;
    state.nextAt = now + intervalMs();
    if (state.skips >= 2) setStatusLine('已跳过 ' + state.skips + ' 轮 · ' + why, 'warn');
    paint();
  }

  /** 我方还欠着一次补讲吗(nap7 记账制)?
   *  欠账 = 点过取消且还没确认补讲成功,且没过 OWED_TTL_MS。
   *  「用户手动取消」由 onUserCancelClick(isTrusted)即时停表,不经过这里。 */
  function owesResume() {
    if (!state.owedResume) return false;
    if (Date.now() - state.owedResume > OWED_TTL_MS) { state.owedResume = 0; return false; }
    return true;
  }

  /** 状态确认类失败:不烧「找不到商品」的额度,单独计到 SOFT_LIMIT。
   *  (2026-11-01 实机:两次抖动就把循环停掉,而商品正空着没人讲。) */
  function softSkipFast(why) {
    state.softFails = (state.softFails || 0) + 1;
    if (!state.failSince) state.failSince = Date.now();
    noteDiag('秒档重试 ' + state.softFails + '/' + SOFT_LIMIT + '：' + why);
    if (state.softFails >= SOFT_LIMIT) { stopFast('连续 ' + SOFT_LIMIT + ' 次没确认到讲解'); return; }
    var now = Date.now();
    state.startedAt = now;
    state.nextAt = now + intervalMs();
    setStatusLine('重试中 · ' + why, 'warn');
    paint();
  }

  /** 一轮成功后的记账。抽出来是因为「补点讲解」那条路也要走同一套收尾。
   *  注意:这里**不清 owedResume** —— 盲模式没有确认手段,清了它,
   *  下一轮就没法靠欠账补点了。销账时机统一放在「补讲确认成功」那一处
   *  与「进场看见正在讲解」那一行。 */
  /** 盲模式一轮的收尾已并回 finishFastCycle(2026-11-01 nap11):
   *  旧 seatBlindNextAt 在"间隔已过"时把 nextAt 设成 now+200ms,结果补讲刚点完
   *  就立刻跑下一轮,读到的是补讲前的界面(「不在讲」)⇒ 又点一次讲解,
   *  白白把下一轮推后一个间隔(实机 03:45:54 / 03:46:10 两行就是它)。
   *  现在:取消后走 BLIND_TICK_MS 密探、补讲后老实等满间隔,两个阶段各按各的节奏。 */

  function finishFastCycle(row, name, how) {
    state.round += 1;
    state.cycles += 1;
    state.skips = 0;
    state.softFails = 0;
    state.failSince = 0;
    state.status = null;
    state.startedAt = Date.now();
    state.nextAt = state.startedAt + intervalMs();
    state.lastShotAt = state.startedAt;
    state.rowAnchor = recordRowAnchor(findRowByKey() || row);
    paint();
    reportCycle(name, false, how);
  }

  /** ★ 2026-11-06 弹卡优先 —— 循环讲解的**最高优先级路径**
   * ----------------------------------------------------------
   * 用户定:「商品【讲解中】时会左边滑出『弹起讲解卡』按钮,按它可以在不断开讲解的
   *   情况下继续弹出讲解卡。所以循环开始时在讲解状态下直接点这个按钮就行,
   *   这就完成了多次弹起讲解卡;弹起失败再走老操作兜底。」
   *
   * 硬条件只有一条:商品**此刻确实在讲解**。不在讲就没有卡可弹,直接交回老流程。
   * 返回:
   *   'ok'      —— 点了弹卡,观察窗过后仍在讲 ⇒ 调用方记一轮
   *   'none'    —— 没有弹卡按钮 / 不可点 / 误触到取消确认 ⇒ 交回老流程(取消→重讲)
   *   'dropped' —— 点完讲解掉了(那枚按钮其实是取消) ⇒ 调用方立刻补讲
   *   'abort'   —— 用户喊停
   */
  async function tryPopCard(row, mark) {
    if (!row || !isLecturing(row)) return 'none';
    var btn = findPopBtn(row);
    var where = '行内';
    if (!btn || !clickable(btn)) {
      btn = findPopBtnPage();
      where = btn ? '页面浮层' : '';
    }
    if (!btn || !clickable(btn)) {
      state.popNone = (state.popNone || 0) + 1;
      return 'none';
    }
    noteDiag('弹卡优先:点「' + txt(btn) + '」(' + where + ')');
    fireClick(btn);
    state.popTries = (state.popTries || 0) + 1;
    var until = Date.now() + POP_VERIFY_MS;
    while (Date.now() < until) {
      await nap(250);
      if (aborted(mark)) return 'abort';
      /* 误点成"取消讲解"会弹确认框 —— 点【取消】保住讲解卡,本轮按"没弹成"处理。
       * 平台文案会同时维护两套按钮时,这是唯一安全的退路。 */
      if (dismissCancelConfirm()) {
        noteDiag('弹卡优先:那枚按钮其实是取消 ⇒ 已点「取消」保住讲解,改走老流程');
        state.popNone = (state.popNone || 0) + 1;
        return 'none';
      }
      var now = findRowByKey() || row;
      if (!now || !isLecturing(now)) return 'dropped';
    }
    var after = findRowByKey() || row;
    if (!after || !isLecturing(after)) return 'dropped';
    return 'ok';
  }

  /** 点「讲解」并把状态盯到翻转。返回 true = 已确认在讲解。
   *  平台偶尔会吞掉一次点击(刚取消完最容易),所以最多点四次;
   *  「还没翻回讲解」和「暂时置灰」都只是再等等,不算失败 ——
   *  只有等到总时限还没翻转才算失败,而且只记「重试」,不记「找不到商品」。 */
  async function clickLectureAndVerify(mark, firstBtn) {
    var btn = firstBtn || null;
    var deadline = Date.now() + FLIP_WAIT_MS + VERIFY_MS;
    var clicks = 0;
    while (Date.now() < deadline && clicks < 4) {
      if (aborted(mark)) return false;
      if (!btn) {
        var row = findRowByKey();
        if (!row) return false;
        if (isLecturing(row)) return true;
        var b = findLectureBtn(row);
        /* 2026-11-06:必须按态取"开始讲解",不能拿 pop 按钮顶上 ——
         * 点它只会再弹一次卡,永远等不到"在讲"的翻转。 */
        if (!b || kindOf(b) !== 'start' || !clickable(b)) { await nap(250); continue; }
        btn = b;
      }
      fireClick(btn);
      btn = null;
      clicks += 1;
      var until = Date.now() + VERIFY_MS;
      while (Date.now() < until) {
        await nap(200);
        if (aborted(mark)) return false;
        var v = findRowByKey();
        if (v && isLecturing(v)) return true;
      }
    }
    return false;
  }

  /** L1:按定位记忆单跳 ≤350ms 看一眼。比滚动便宜得多,也不会连续滚屏。 */
  async function fastHop(mark) {
    var a = state.rowAnchor;
    if (!a || !a.container || !a.container.isConnected) return null;
    if (typeof a.offset !== 'number') return null;
    var c = a.container;
    var maxScroll = Math.max(0, c.scrollHeight - c.clientHeight);
    if (maxScroll < 8) return null;
    if (a.offset > maxScroll + 200) return null;
    var prev = c.scrollTop;
    var target = Math.max(0, Math.min(maxScroll, a.offset - 120));
    if (Math.abs(target - prev) < 8) return null;         // 已经在附近,不用跳
    if (userBusy()) return null;                          // 用户正在操作,让路
    c.scrollTop = target;
    window.__dycScriptScrollAt = Date.now();
    var until = Date.now() + 350;
    while (Date.now() < until) {
      await sleep(80);
      if (aborted(mark)) {
        c.scrollTop = prev;
        window.__dycScriptScrollAt = Date.now();
        return 'abort';
      }
      var r = findRowByKey();
      if (r) return { row: r, container: c, prevScroll: prev };
    }
    c.scrollTop = prev;
    window.__dycScriptScrollAt = Date.now();
    state.anchorHits = 0;
    return null;
  }

  /* 秒档的搜索兜底(2026-10-31 用户追加)。只在「再失败就熔断」的那一轮调用。
   * 还原**不在这里做** —— 搜索成功后还要在同一份(被筛过的)列表里找按钮、看状态,
   * 提前还原会把节点整批换掉。由 doFastCycle 的 finally 统一还原一次,
   * 与分钟档同一套:搜索负责"筛",finally 负责"还"。 */
  async function fastSearch(id, mark) {
    if (!id) return null;
    return locateBySearch(id, mark);
  }

  async function doFastCycle() {
    if (!state.on || state.busy || state.group !== 'sec') return;
    var mark = abortSeq;
    state.busy = true;
    state.busyLabel = '定位中';
    paint();
    var name = state.product;
    var t0 = Date.now();
    var moved = null;
    var isRescue = false;                 // 这一轮是不是「搜索兜底轮」
    try {
      /* L0:行在可视区就直接拿 —— 秒档绝大多数轮次都走这一条,耗时几十毫秒。 */
      var row = findRowByKey();

      /* L1:不在可视区就按记忆单跳一次(≤350ms)。跳不回来先跳过,
       *     **绝不进入 revealRow 的分段滚屏** —— 那是分钟档的活。 */
      if (!row) {
        var hop = await fastHop(mark);
        if (hop === 'abort') { noteDiag('秒档中止(微跳中被喊停)'); return; }
        if (hop && hop.row) { moved = hop; row = hop.row; }
      }

      /* L2:平台搜索兜底 —— **只在「这一轮再失败就熔断」时用一次**(2026-10-31 用户追加)。
       *   为什么不在常规轮用:2.6 秒搜索 + 0.3 秒还原,在 15 秒档吃掉整整一轮,
       *   还会把用户的列表筛成一行再还原(视觉上闪一下)。
       *   为什么还要留:连续两轮都认不回来时,干等熔断不如花 3 秒真去找一次 ——
       *   它能把「刚好被滚走 / 刚好重渲染」这种一次性的假失败救回来。
       *   判定用 skips + 1 >= SKIP_LIMIT:进门时已经跳过 1 次 ⇒ 本轮是最后一轮。 */
      if (!row) {
        isRescue = (state.skips + 1) >= SKIP_LIMIT && !!idOfKey(state.key);
        if (isRescue) {
          state.busyLabel = '搜索中';
          paint();
          noteDiag('秒档最后一轮:用平台搜索兜底一次');
          var sr = await fastSearch(idOfKey(state.key), mark);
          if (sr === 'abort') { noteDiag('秒档中止(搜索兜底被喊停)'); return; }
          if (sr && sr.row) { row = sr.row; moved = null; }
        }
      }

      /* ★ nap9:后台找不到行**也不许熔断**。隐藏标签里虚拟列表可能把行回收掉,
       *   三次就熔断等于"切后台久了自动退出" —— 这又是一种"自己停表"。
       *   后台只记一笔、按正常间隔重来;真要停表只能由用户在看得见的时候决定。 */
      if (!row) {
        if (pageHidden()) {
          noteDiag('盲模式:这一轮看不到商品行,跳过(不停表)');
          state.startedAt = Date.now();
          state.nextAt = state.startedAt + intervalMs();
          paint();
          return;
        }
        skipFast('商品不在当前屏');
        return;
      }

      var blind = pageHidden();
      var lecturing = isLecturing(row);

      /* ★ nap7 记账制(2026-11-01):「该不该补讲」不再用 selfCancelAt 时间窗口猜。
       *   旧机制死局:某轮进门看见「在讲」就把 selfCancelAt 清零(旧 2971 行),
       *   可那一轮的续讲若实际没落实(平台吞了点击 / DOM 假阴性),下一轮进来
       *   商品已不在讲、欠账却被销了 ⇒ 判「商品已停止讲解」⇒ 跳过,两跳即熔断
       *   —— 02:48:49 实机就是这个死法(cycles=1 后连跳两次)。
       *   现在:我方点一次取消就**欠一次补讲**,补讲确认成功才销账;
       *   「用户手动取消」由 onUserCancelClick(isTrusted)即时停表,
       *   能走到「不在讲」且不欠账的,只剩平台自停/别处取消 ⇒ 停表,不猜。 */
      /* ★ 销账条件必须带上「没有待反映的取消」:
       *   盲模式下"界面说在讲"可能只是因为 DOM 冻结,此时账上还挂着那笔取消,
       *   若在此销账,下一轮界面翻成「不在讲」就成了"不欠账却不在讲" ⇒ 误停表。
       *   (nap8 自测里就是这么停的:轮4 读在讲→销账→同轮补讲,轮5 读到不在讲→停。) */
      if (lecturing && !state.cancelPending) state.owedResume = 0;

      /* ★ nap8(2026-11-01 用户:「一切换页面就再也不循环了」):
       *   后台不再拿 DOM 当「该取消还是该补讲」的判据(冻结的 DOM 会让它永远答"还在讲")。
       * ★ nap9(2026-11-01 实机 03:27:18 停表后):**后台彻底删掉停表这条路**。
       *   那次现场是「按钮「讲解」· 欠账无 ⇒ 判他人取消」—— 界面明明已经翻成
       *   「讲解」、补讲机会就在眼前,却因为账上没钱而停表。
       *   而"欠账无"的推理本身就站不住:用户手动取消**只可能发生在前台**
       *   (onUserCancelClick 只认 isTrusted,点下去那一刻就停表了)。
       *   后台看到「不在讲」只有三种来源:平台自停 / 我方取消的后果 / DOM 假阴性
       *   —— **三种都该补讲,没有一种是该停表的**。用户切后台就是为了让它继续跑,
       *   停表是这里最坏的结果(比空转一轮差得多)。
       *   所以盲模式只剩三个动作:补讲 → 点取消开新一轮 → 再补讲,永不自行退出。 */
      if (blind) {
        if (state.cancelPending) {
          /* ★ nap10/nap11:补讲轮只在按钮真的变回「讲解」时才点 ——
           *   DOM 冻着时按钮还写着「取消讲解」,点下去等于再取消一次,补不上讲。
           *   没翻就**每 3 秒**再看一次(BLIND_TICK_MS),而不是等满一个间隔:
           *   实测平台翻盘时间在 5~31 秒之间浮动,15 秒一次经常错过窗口。 */
          var rb2 = findLectureBtn(row);
          var rl2raw = rb2 ? txt(rb2) : '';       // 诊断要原文,判定要态
          var rl2 = rb2 ? kindOf(rb2) : '';
          /* nap14:刚开价时点取消会弹确认框 —— 点【取消】保住讲解卡,本轮跳过 */
          if (dismissCancelConfirm()) {
            noteDiag('盲模式:刚开价不让取消 ⇒ 已点【取消】保住讲解,本轮跳过');
            setStatusLine('刚开价 · 已点「取消」保住讲解卡', 'warn');
            state.cancelPending = 0;
            state.owedResume = 0;
            state.startedAt = Date.now();
            state.nextAt = state.startedAt + intervalMs();
            paint();
            return;
          }
          if (rb2 && rl2 === 'start') {
            fireClick(rb2);
            noteDiag('盲模式补讲:界面已翻 ⇒ 点「讲解」(取消后 ' +
              Math.round((Date.now() - state.cancelPending) / 1000) + ' 秒)');
            state.cancelPending = 0;
            state.blindWaits = 0;
            state.blindSettled = Date.now();     // 进入"等界面反映"观察期
            finishFastCycle(row, name);          // nextAt = 现在 + 间隔
            return;
          }
          state.blindWaits = (state.blindWaits || 0) + 1;
          if (state.blindWaits < BLIND_WAIT_MAX) {
            /* ★ nap12:等了 6 秒还没翻,**主动请平台刷一次列表**,别干等。
             *   隐藏标签的 DOM 不翻,根因是平台自己没去拉新数据(它的定时器被节流),
             *   不是我们读得不够勤。既然干等只能拿 16~31 秒,那不如催它一下。
             *   限 20 秒一次,且每轮最多一次,不会刷屏。 */
            if (state.blindWaits === 2 && Date.now() - (state.blindRefreshAt || 0) > 20000) {
              var rf = findListRefreshBtn();
              if (rf) {
                fireClick(rf);
                state.blindRefreshAt = Date.now();
                noteDiag('盲模式:界面 6 秒没翻 ⇒ 点「刷新列表」催一次');
              } else {
                noteDiag('盲模式:想催刷新但找不到「刷新列表」按钮');
              }
            }
            noteDiag('盲模式:等界面翻(按钮「' + (rl2raw || '无') + '」)· 3 秒后再看');
            state.nextAt = Date.now() + BLIND_TICK_MS;
            paint();
            return;
          }
          noteDiag('盲模式:界面 ' + state.blindWaits + ' 次没翻 ⇒ 强制补讲一次');
          if (rb2) fireClick(rb2);
          state.cancelPending = 0;
          state.blindWaits = 0;
          state.blindSettled = Date.now();
          finishFastCycle(row, name);
          return;
        }
        if (lecturing) {
          /* ★ 2026-11-06:后台也优先弹卡。DOM 冻着照样能派发点击,而弹卡**不需要**
           *   等"界面翻回来"——正好绕开隐藏标签 16~31 秒的翻盘等待。
           *   下一拍密探(3 秒)读一次:还在讲就继续,真掉线了就走下面的补讲。 */
          var pb = findPopBtn(row) || findPopBtnPage();
          if (pb && clickable(pb)) {
            fireClick(pb);
            state.popOk = (state.popOk || 0) + 1;
            noteDiag('盲模式:点「' + txt(pb) + '」弹卡(不断讲解)');
            state.cancelPending = 0;           // 没取消,不欠补讲
            state.owedResume = 0;
            state.blindWaits = 0;
            state.blindSettled = Date.now();
            finishFastCycle(row, name, 'pop');
            state.nextAt = Date.now() + BLIND_TICK_MS;
            return;
          }
          var cb = findStopBtn(row) || findLectureBtn(row);
          if (cb) fireClick(cb);
          noteDiag('盲模式:看见在讲 ⇒ 点「' + (cb ? txt(cb) : '无按钮') + '」开新一轮');
          state.cancelPending = Date.now();
          state.owedResume = Date.now();     // 记一笔,前台恢复时能接上
          state.blindWaits = 0;
          finishFastCycle(row, name);
          /* ★ nap11:取消后进入**密探**节奏(3 秒一次),不再等满间隔 ——
           *   界面一翻就补讲,一轮总时长由平台翻盘速度决定而不是由设定间隔决定。 */
          state.nextAt = Date.now() + BLIND_TICK_MS;
          return;
        }
        /* 不在讲。两种情况要分开:
         *   (a) 刚补讲过,界面还没反映"已在讲" ⇒ **什么都别点**,等它翻
         *       (实机 03:45:54 / 03:46:10:补讲后 1 秒、16 秒各多点了一次讲解,
         *        既没用,还把下一轮的计时重置,白白推后一个间隔);
         *   (b) 真的不在了(平台自停 / 从未讲起来) ⇒ 补讲。 */
        if (state.blindSettled && Date.now() - state.blindSettled < BLIND_SETTLE_MS) {
          noteDiag('盲模式:刚补讲过,界面还没反映 ⇒ 再等等(' +
            Math.round((Date.now() - state.blindSettled) / 1000) + ' 秒)');
          state.nextAt = Date.now() + BLIND_TICK_MS;
          paint();
          return;
        }
        /* 补讲只认 start 态:pop 按钮点一百次也开不了讲解 */
        var rb = findStartBtn(row) || findLectureBtn(row);
        if (rb) fireClick(rb);
        noteDiag('盲模式补讲:看不见讲解 ⇒ 点「' + (rb ? txt(rb) : '无按钮') + '」');
        state.owedResume = 0;
        state.blindSettled = Date.now();
        finishFastCycle(row, name);
        return;
      }

      if (!lecturing) {
        /* ★ nap13(2026-11-01 用户定:「点预热也要继续循环,把商品拉回讲解位」):
         *   前台不再因为「商品不在讲解」就停表。原来这里判 `!owesResume()` ⇒
         *   stopByNoLecture,于是用户一点预热、商品离开讲解位,循环就停了还弹一条
         *   「商品已停止讲解」—— 那不是用户要的,用户只是把商品挪到预热位。
         *   「用户手动取消讲解」已由 onUserCancelClick(isTrusted) 即时停表,
         *   能走到这里的都是:转预热 / 平台自停 / 我们自己的取消还没补上 ⇒ 都该补讲。 */
        noteDiag('秒档:商品不在讲解 ⇒ 补点讲解');
        if (!(await clickLectureAndVerify(mark))) { softSkipFast('补讲未确认'); return; }
        state.owedResume = 0;                // 补讲确认成功 ⇒ 销账
        finishFastCycle(row, name, 're');
        return;
      }

      /* ★ 2026-11-06 弹卡优先(用户定的最优先路径):
       *   商品在讲解中 ⇒ 直接点「弹出讲解卡」把卡重新弹起,**不取消讲解**。
       *   只有这条路不成立(没有这枚按钮 / 点了讲解掉线 / 误触取消)才往下走老流程。
       *   放在预算闸之前:弹卡只要一次点击 + 1.4 秒观察,比「取消→等翻转→再点讲解」省一半时间。 */
      var popped = await tryPopCard(row, mark);
      if (popped === 'abort') return;
      if (popped === 'ok') {
        state.popOk = (state.popOk || 0) + 1;
        state.owedResume = 0;            // 全程没取消,不欠补讲
        state.cancelPending = 0;
        finishFastCycle(row, name, 'pop');
        return;
      }
      if (popped === 'dropped') {
        /* 那枚"弹卡"按钮其实是取消 ⇒ 商品已经空着,立刻补讲,不留空窗 */
        noteDiag('秒档:弹卡后讲解掉了 ⇒ 立刻补讲(走兜底)');
        if (!(await clickLectureAndVerify(mark))) { softSkipFast('弹卡失败且补讲未确认'); return; }
        state.owedResume = 0;
        finishFastCycle(row, name, 're');
        return;
      }

      /* 兜底路径只认 stop 态按钮:新 UI 下行内可能同时挂着 pop,
       * 拿错了就是"点了个不会取消的按钮再等 7 秒"(= 反馈 #131)。 */
      var cancel = findStopBtn(row) || findLectureBtn(row);
      if (!cancel || !clickable(cancel)) { skipFast('未找到讲解按钮'); return; }

      /* 预算闸:还没开始点就已经超预算了 ⇒ 放弃这一轮,别把间隔吃掉。
       * 兜底轮预算放大到 6000ms(搜索本身 2.9 秒),常规轮仍是 3000ms。
       * 盲模式走不到这里(它在上面已经 return),不受这条约束。 */
      var budget = isRescue ? SLOW_BUDGET_MS : FAST_BUDGET_MS;
      if (Date.now() - t0 > budget - 1200) { skipFast('本轮预算不足'); return; }
      if (aborted(mark)) return;

      fireClick(cancel);
      state.owedResume = Date.now();         // ★ nap7:欠一次补讲,补上才销账
      await nap(GAP_MS);
      if (aborted(mark)) return;

      var resume = null;
      var flipUntil = Date.now() + FLIP_WAIT_MS;
      for (var n = 0; n < 40; n++) {
        /* ★ nap14:刚开价时点取消会弹「确认取消讲解？」—— 点【取消】保住讲解卡,
         *   本轮直接结束(别再等按钮翻转,它永远不会翻),循环下一轮照常继续。 */
        if (dismissCancelConfirm()) {
          /* 这一轮什么都没刷新(商品本来就还在讲),**不记轮次**,只按时重排下一次 */
          noteDiag('刚开价不让取消 ⇒ 已点【取消】保住讲解卡,本轮跳过');
          /* 用户 2026-11-01:「需要弹一下提示,但不用收纳进消息盒子」——
           * 只写胶囊状态行(setStatusLine),下一轮成功后会自然清掉;
           * 不走 boxNote,盒子历史里不留这条。 */
          setStatusLine('刚开价 · 已点「取消」保住讲解卡', 'warn');
          state.owedResume = 0;
          state.startedAt = Date.now();
          state.nextAt = state.startedAt + intervalMs();
          paint();
          return;
        }
        var other = findLiveRow();
        if (other && rowKey(other) !== state.key) { skipFast('已切换讲解商品'); return; }
        var current = findRowByKey();
        if (!current) { skipFast('取消后未找到商品'); return; }
        var button = findLectureBtn(current);
        /* 只要文案翻回「讲解」就算取消落实,**不再要求此刻可点**:
         * 平台取消后常把按钮短暂置灰(防连点)或正在重渲染,原来的联合判定
         * 一直不接受 ⇒ 超预算 ⇒ 报「取消讲解未确认」并烧掉熔断额度。
         * 能不能点交给 clickLectureAndVerify 去等。 */
        if (button && kindOf(button) === 'start') { resume = button; break; }
        if (Date.now() > flipUntil) { break; }
        await nap(150);
        if (aborted(mark)) return;
      }
      /* ★ 2026-11-01 修「能成功一两轮就停」(用户实测 01:21:29 超预算 → 01:21:45 商品已停止讲解 → 停表):
       *   原来等按钮翻转超预算就直接 skipFast 跳过整轮。可实际上**取消大概率是成功的**,
       *   只是平台把按钮文案刷回「讲解」比预算慢。于是下一轮进来发现商品已经不在讲解,
       *   判「商品已停止讲解」再跳过一次 —— 两次就到 SKIP_LIMIT,循环直接停。
       *   看起来像"取消没成功",真相是"取消成功了但没等到按钮翻转,于是没人去点续讲"。
       * ⇒ 超时后不直接放弃,再查一次真实状态:商品确实不讲了 ⇒ 取消生效,继续往下点「讲解」;
       *   还在讲 ⇒ 才是真失败,交给 skipFast。 */
      if (!resume) {
        var afterCancel = findRowByKey();
        if (afterCancel && !isLecturing(afterCancel)) {
          var manual = findLectureBtn(afterCancel);
          if (manual && kindOf(manual) === 'start') {
            resume = manual;
            noteDiag('秒档:按钮翻转超预算,但取消已生效 ⇒ 直接续讲');
          }
        }
      }
      if (!resume) {
        /* 把现场摆到报告上:按钮文案 / 是否可点 / 这一轮用了多久。
         * 这条链已经查了三轮,不能再靠猜 —— 上面那行注释里的推论必须能被证伪。 */
        var probe = findRowByKey();
        var pb = probe ? findLectureBtn(probe) : null;
        noteDiag('取消未确认现场:行' + (probe ? '在' : '不在') +
          ' · 按钮「' + (pb ? txt(pb) : '无') + '」' +
          (pb ? (clickable(pb) ? '可点' : '不可点') : '') +
          ' · 讲解中标记 ' + findAllLecturingMarks().length + ' 个' +
          ' · 本轮 ' + Math.round((Date.now() - t0) / 1000) + ' 秒');
        softSkipFast('取消讲解未确认');
        return;
      }
      if (aborted(mark)) return;

      /* 换用统一的「点一次、盯翻转、必要时重点一次」:平台常常吞掉刚取消完的那一次点击,
       * 原来只点一次、等 3 秒,没翻转就判整轮失败。 */
      var ok = await clickLectureAndVerify(mark, resume);
      if (!ok) { softSkipFast('续讲未确认'); return; }
      state.owedResume = 0;                  // 续讲确认成功 ⇒ 销账(nap7)

      finishFastCycle(row, name);
    } catch (e) {
      if (!aborted(mark)) skipFast('执行异常');
    } finally {
      /* 2026-10-31:兜底轮动过搜索框 ⇒ 无论成功、失败、被喊停,都必须把用户的筛选词
       * 与滚动位置还回去。顺序同分钟档:先还原搜索(列表会重排),再还原滚动。 */
      await restoreSearchNow();
      state.busy = false;
      state.busyLabel = '';
      if (moved && moved.container && moved.container.isConnected) {
        try {
          moved.container.scrollTop = moved.prevScroll;
          window.__dycScriptScrollAt = Date.now();
        } catch (e) { /* 忽略 */ }
      }
      paint();
      resetSettle(); place();
      // 停止后立刻手动重开时，旧任务只释放锁，由新状态开始识别，绝不沿旧链点击。
      if (aborted(mark) && state.on) checkNow();
    }
  }

  function checkNow() {
    // 周期拍点已检查最新 DOM 时，吸收尚未执行的观察器唤醒。
    if (wakeTimer) { clearTimeout(wakeTimer); wakeTimer = 0; }
    if (!state.on) return;
    if (state.busy) return;
    /* 无限模式的守夜态单独走一条路:只读探针,不进两档的常规链路。
     * 放在分档之前 —— 守夜是**跨档**的状态,与秒/分无关。 */
    if (state.phase === 'vigil') { vigilTick(); return; }
    if (state.group === 'sec') { checkFastNow(); return; }
    var row = findLiveRow();
    var now = Date.now();

    if (!row) {
      /* ★ 2026-10-25 用户报「手动点掉讲解,计数器还在跳」:
       *   两种情况必须分开 ——
       *     (a) 那一行**还在 DOM 里、只是没有「讲解中」标记** ⇒ 用户真的取消了,立刻停;
       *     (b) 那一行**整个被虚拟滚动回收了** ⇒ 看不见≠停了,继续计时。
       *   连续两拍都命中 (a) 才转 wait,避免平台重渲染瞬间的假阴性。 */
      var sameRow = findRowByKey() || (state.product ? findRowByName(state.product) : null);
      if (sameRow) {
        state.cancelSeen = (state.cancelSeen || 0) + 1;
        if (state.cancelSeen >= 2) {
          diagOnce('cancel', '行还在但讲解中没了 ⇒ 判定手动取消');
          resetToWait();
          return;
        }
        paint();
        return;
      }
      state.cancelSeen = 0;

      /* ★ 2026-10-27(用户问「讲解中直接下架这个商品,你会怎么做」;当天又修一次):
       *   不能只看「按 ID 找不到」就判「不在列表」—— 实测(01:19:36)用户点「下滑到底」
       *   之后平台把**上方的行卸掉了**(rbd 只渲染可视区附近),`rows()` 从 11 变成 10,
       *   我们的商品正好在卸载范围里,于是 1 秒内就误判「商品已不在列表」并停表。
       *   ⇒ 补一条硬证据:**列表总高有没有真变短**。
       *     · 下架 / 移出:总高减少 100px 以上(一行 132 + 间距 8);
       *     · 只是滚走了:总高**不变**(行还在,只是没渲染)。
       *   总高没变 ⇒ 一律当成「行暂时不在 DOM」继续计时,绝不判「不在列表」。
       *   只对 id: 键启用 —— 名字键仍可能因为平台改名而丢,留给下面那条兜底。 */
      if (state.key && state.key.indexOf('id:') === 0 &&
          (state.phase === 'run' || state.phase === 'error')) {
        var listNow = [];
        try { listNow = rows(); } catch (e) { listNow = []; }
        var hNow = listHeight();
        if (listNow.length && !sameRow && hNow && state.listH && (state.listH - hNow) >= 100) {
          state.keyGone = (state.keyGone || 0) + 1;
          if (state.keyGone >= 2) {
            stopByNoLecture('商品已不在列表(下架 / 移出 / 换了 tab)', '商品已不在列表');
            return;
          }
          paint();
          return;
        }
        state.keyGone = 0;
      }

      /* ★ 2026-10-26(#114 / #115 修):**删掉「到点 + 60 秒」这条死线**。
       *   旧逻辑 grace < 180000 && !(now > nextAt + 60000) —— 用户只是滚开去看一眼,
       *   跨过那条线就被判「已不在讲解」并清空商品,滚回来计时从零开始,
       *   这正是用户说的「滑动到看不见的地方,再回来时间就重置了」。
       *   现在只有两种终止:① 连续 15 分钟都找不回来(兜底);② 连续失败 3 次且已丢 40 拍。 */
      if ((state.phase === 'run' || state.phase === 'error') && (state.key || state.product)) {
        if (!state.missingSince) state.missingSince = now;
        state.lostStreak = (state.lostStreak || 0) + 1;
        /* 到点了又看不见行 ⇒ 去「把它找回来再续讲」,不傻等。
         * ★ 2026-10-27(用户:「我很介意重复执行轮询然后大半时间被这个滚动的状态给占用」):
         *   这里**必须再过一道 retryAt 闸门**。旧写法只看 nextAt —— 而失败后 nextAt 仍然
         *   在过去,于是每 2 秒就会再开一轮「搜索 + 最多 8 秒滚屏」,退避的 30s / 60s 形同虚设。
         *   这就是「大半时间都在滚」的真正来源。现在退避期到点前一律不动。 */
        if (state.nextAt && now >= state.nextAt && !state.busy &&
            now >= (state.retryAt || 0)) {
          doCycle(false);
          return;
        }
        var gone = now - state.missingSince;
        // 丢拍数只用来打一条诊断(方便事后看),**不用来重置** —— 重置只认下面那条硬上限
        if (state.lostStreak === LOST_STREAK_LIMIT) {
          diagOnce('lost-streak', '已连续 ' + LOST_STREAK_LIMIT + ' 拍看不见那一行,仍在继续计时');
        }
        if (gone > LOST_GIVEUP_MS) {
          /* 无限模式:15 分钟没找回来也不放弃,转守夜等它回来(2026-11-05)。 */
          if (state.infinite) { enterVigil('15 分钟没找回来'); return; }
          diagOnce('lost', '连续 ' + Math.round(gone / 60000) + ' 分钟找不回来 ⇒ 判定没有在讲解');
          resetToWait();
          return;
        }
        paint();                    // 继续显示倒计时,不退回「待讲解」
        return;
      }
      if (state.phase !== 'wait') {
        /* 无限模式:看不见行不等于停播,转守夜(2026-11-05)。 */
        if (state.infinite && enterVigil('连续找不到那一行')) return;
        diagOnce('lost', '连续找不到那一行 ⇒ 判定没有在讲解');
        resetToWait();
      }
      return;
    }

    state.missingSince = 0;
    state.cancelSeen = 0;
    state.keyGone = 0;
    state.listH = 0;
    state.listHAt = 0;
    state.lostStreak = 0;
    /* 记住「这一栏有多高」,用来区分「下架」与「滚走没渲染」。
     * scrollHostOfAny() 要扫容器,限频 5 秒一次 —— 高度不会每 2 秒变一次。 */
    if (!state.listH || now - (state.listHAt || 0) > 5000) {
      state.listH = listHeight() || state.listH;
      state.listHAt = now;
    }
    var name = rowName(row);
    var key = rowKey(row);
    if (!state.rowAnchor) state.rowAnchor = recordRowAnchor(row);

    /* ★ 2026-10-26(#113 / #117 前半修):换品判定加去抖。
     *   旧口径 name !== state.product 立刻清零 —— 而 name 取的是「行内最长短文本」,
     *   平台重渲染、排序、拖动都会让它抖一下,于是「调动非讲解款」也能把计时清零。
     *   现在:身份用稳定键(rowKey),且**连续两拍同键**才认换品;只是显示名变了就只改名。 */
    if (!state.key && !state.product) {
      if (!key && !name) { paint(); return; }     // 行内容还没渲染出来 ⇒ 下一拍再说
      commitProduct(key, name, now);
      return;
    }

    if (key !== state.key) {
      if (key !== state.pendingKey) {
        state.pendingKey = key;
        state.pendingName = name;
        state.pendingTicks = 0;
      }
      state.pendingTicks += 1;
      if (state.pendingTicks < ID_CONFIRM_TICKS) {
        noteDiag('疑似换品(键 ' + key + ' ≠ ' + state.key + ')⇒ 先按原商品继续计时');
        paint();
        return;
      }
      noteDiag('确认换品 ⇒ ' + shortName(name));
      commitProduct(key, name, now);
      return;
    }
    state.pendingKey = '';
    state.pendingName = '';
    state.pendingTicks = 0;
    if (name && name !== state.product) {
      state.product = name;                    // 同一商品、平台改了显示名 ⇒ 只更新名字
      paint();
    }

    if (state.phase !== 'run') { state.phase = 'run'; paint(); }

    // 睡眠/锁屏醒来:过期太久不补点,直接重新计时
    if (state.lastShotAt && now - state.lastShotAt > state.minutes * 60000 + 120000) {
      state.nextAt = now + state.minutes * 60000;
      state.lastShotAt = now;
      paint();
      return;
    }

    if (state.fails >= FAIL_LIMIT) {
      if (now < state.retryAt) return;
      doCycle(true);
      return;
    }
    if (now < state.nextAt) return;
    /* ★ 2026-10-27:失败后的 30 秒退避同样要在这里生效(见上面 !row 分支的同一段注释)。
     *   少了这一行,第 1、2 次失败之后每 2 秒就会再开一轮,用户看到的是「一直在滚」。 */
    if (now < (state.retryAt || 0)) return;
    doCycle(false);
  }

  /** 认下当前商品并重开计时(2026-10-26:首次识别与确认换品共用一条路径) */
  function commitProduct(key, name, now) {
    // 空键兜底:行既没 id 也没名字时用名称前 8 字占位,否则每拍都会重开计时
    var k = key || ('nm:' + keyOf(name || '').slice(0, 8));
    state.key = k || 'row';
    state.product = name || '';
    state.pendingKey = '';
    state.pendingName = '';
    state.pendingTicks = 0;
    state.startedAt = now;
    state.nextAt = now + intervalMs();
    state.round = 0;
    state.fails = 0;
    state.retryAt = 0;
    state.phase = 'run';
    state.lastShotAt = now;
    state.missingSince = 0;
    state.lostStreak = 0;
    /* ★ 2026-10-27:换品了 ⇒ 旧商品的定位记忆必须作废。
     *   以前这里不清,新商品会带着上一件商品的 offset 当作第一档起点,
     *   结果是「飞到上一个商品那儿看一眼、再开始扫」—— 白花一档,画面还会明显跳一下。 */
    state.rowAnchor = null;
    state.anchorHits = 0;            // 换品 ⇒ 记忆命中计数归零
    endScan();                       // 新商品 ⇒ 断点/圈数清零;若之前停在半路,顺手把视口还回去
    paint();
  }

  /** 回到「待讲解」(唯一的重置出口,保证字段一起清干净) */
  function resetToWait() {
    state.phase = 'wait';
    state.product = '';
    state.key = '';
    state.startedAt = 0;
    state.nextAt = 0;
    state.missingSince = 0;
    state.cancelSeen = 0;
    state.keyGone = 0;
    state.lostStreak = 0;
    state.pendingKey = '';
    state.pendingName = '';
    state.pendingTicks = 0;
    state.rowAnchor = null;
    state.anchorHits = 0;            // 停表 ⇒ 记忆命中计数归零
    /* 2026-10-27:失败计数与退避时刻一起清 —— 停表之后再来新的一轮,
     * 不该继承上一轮遗留的 60 秒退避(否则「刚开讲就显示重试中」)。 */
    state.fails = 0;
    state.retryAt = 0;
    /* 2026-10-30:秒档的计数器与状态行一起清 —— 停表后再开是新的开始,
     * 不该继承上一轮的跳过次数(否则刚开就可能立刻熔断)。 */
    state.skips = 0;
    state.failSince = 0;
    state.status = null;
    state.busyLabel = '';
    endScan();                       // 停表 ⇒ 断点清零,并把用户原来的滚动位置还回去
    paint();
  }

  /** 取消讲解 → 等 1.2 秒 → 再点讲解 */
  /** 分钟档一轮成功的收尾(2026-11-06 从内联块抽出:弹卡与老流程必须共用一份,
   *  否则"弹卡那条路"会漏掉失败清零 / 滚屏额度重置 / 定位记忆重记)。 */
  function finishSlowCycle(row, name0, how) {
    var wasFailing = state.fails >= FAIL_LIMIT;      // 之前是不是处于慢速重试
    state.fails = 0;
    state.retryAt = 0;
    /* 2026-10-31:这一轮找品成功了,滚屏额度必须一起清零 ——
     * 否则跑过几轮之后 scanSeg 会累到上限 / scanDone 一直为真,
     * 从某一轮开始**永久不再滚屏**(用户看到的就是「动不动就放弃」)。 */
    resetScanQuota();
    state.round += 1;
    state.cycles += 1;
    state.phase = 'run';
    state.startedAt = Date.now();
    state.nextAt = state.startedAt + state.minutes * 60000;
    state.lastShotAt = state.startedAt;
    state.rowAnchor = recordRowAnchor(findRowByName(rowName(row) || name0) || row);
    paint();

    /* 2026-10-27 用户报「第一眼没找到就弹失败,后来接上了又说已恢复」:
     *   ⇒ 成功只发**一条**轮数消息;之前单独弹的「已恢复」并进这条的值里,
     *     不再出现「先报失败、再报恢复」这种自相矛盾的两条消息。 */
    reportCycle(name0, wasFailing, how);
    if (wasFailing && typeof debugLog === 'function') {
      debugLog('已从连续失败中恢复续讲:' + (name0 || ''));
    }
  }

  async function doCycle(isSlowRetry) {
    if (state.busy) return;
    /* 2026-10-26(#117):用户在滚/点 ⇒ 让路,顺延 1.2 秒,不发消息、不累计失败 */
    if (userBusy()) { state.retryAt = Date.now() + 1200; return; }
    var mark = abortSeq;                 // ★ 进链记号(关胶囊 / 关总闸 / 用户取消都会 +1)
    state.busy = true;
    paint();                             // 时间槽立刻换成「定位中」,别让用户以为还在倒计时
    var name0 = state.product;
    var moved = null;                    // 为找行动过的滚动位置,收尾要还原
    var searched = false;                // 本轮走没走「按 ID 搜索」(决定停表时怎么说原因)
    pendingSearch = null;                // 本轮有没有动过搜索框(动过就必须还原)
    try {
      var row = findLiveRow();
      var liveAtEntry = !!row;           // 进门时页面上**明明有**「讲解中」的行吗
      /* 2026-10-31:进门先量一次列表总高 —— 结论阶段要用它区分
       * 「商品真被下架 / 移出」(总高变短 ≥100px)与「只是被虚拟列表回收了」(总高不变)。
       * 只在有行的时候量:一行都没渲染时 scrollHeight 没有意义。 */
      var hAtEntry = 0, nAtEntry = 0;
      try {
        nAtEntry = rows().length;
        hAtEntry = nAtEntry ? listHeight() : 0;
      } catch (e) { hAtEntry = 0; nAtEntry = 0; }
      /* ★ 2026-10-27(用户:「下次循环讲解是不是有记忆,瞬间飞过去」):
       *   **记忆优先** —— 上一轮已经知道这行在列表的哪个像素位置,就先飞过去看一眼。
       *   只动滚动、不动筛选(搜索会把列表临时筛成 1 行),命中约 0.1~0.8 秒;
       *   落空不占分段扫的额度、不留错断点,继续照原路走(搜索 → 分段扫)。
       *   注意:进门时页面上**看得见**这一行根本走不到这里(上面已经直接用),
       *   所以探针只在「行被滚走 / 被虚拟列表卸载」时上场 —— 正是记忆该发力的场合。 */
      if ((!row || !findLectureBtn(row)) && state.scanPos < 0) {
        /* 分段扫途中(scanPos ≥ 0)不再探针 —— 记忆已经被证明不准了,
         * 每段都先白飞 0.8 秒纯属浪费;等这一圈扫完 / 被搜索校准后再恢复。 */
        var probed = await probeAnchor(mark);
        if (probed === 'abort') { noteDiag('记忆探针被用户中止'); return; }
        if (probed === 'busy') {
          noteDiag('记忆探针让路:用户正在滚动/点击');
          state.retryAt = Date.now() + 1500;
          return;
        }
        if (probed && probed.row) { row = probed.row; moved = probed; }
      }

      /* 2026-10-25:行可能还在 DOM 里但**在可视区外/尺寸为 0**(虚拟列表的 buffer),
       * 那种行里的按钮 clickable() 判不过,表现出来就是「找到行却找不到按钮」。
       * 所以「没有行」和「有行但没按钮」都先找回来一次。
       *
       * ★ 2026-10-31 用户定 Q1=B(评审稿《两档找品分工》):
       *   顺位固定为 **记忆探针 → 搜索 → 等 5 秒重试搜索一次 → 分段滚屏**。
       *   两条与旧代码的关键差别:
       *     ① 搜索失败**必须先把筛选词还原**,再决定要不要重试 / 滚屏 ——
       *        旧写法在搜索词还留在框里的时候量 rows(),把「被筛成 0 行」当成
       *        「列表里没这件商品」,于是搜一次就停表,滚屏永远轮不到;
       *     ② 「进门没看见那一行」不再等于「用户已取消」(见下面的结论三段)。
       */
      if (!row || !findLectureBtn(row)) {
        /* 已经在**分段续扫**途中(scanPos ≥ 0)就不再重复搜索 ——
         * 搜索一次 2.6 秒,而它上一段已经证明搜不到,每段再搜一遍纯属浪费。 */
        var resuming = state.scanPos >= 0;
        if (!resuming) {
          for (var attempt = 0; attempt <= SEARCH_RETRY_MAX; attempt++) {
            if (attempt > 0) {
              /* 重试前先等一会儿(5 秒,可打断):平台索引 / 渲染都有延迟,
               * 一次没搜到就判死会白滚一趟。等待期间「讲解中」回来了就不必再搜。 */
              setStatusLine('搜索没找到，5 秒后再试一次', 'warn');
              var waited = await waitSearchRetry(SEARCH_RETRY_MS, mark);
              setStatusLine(null);            // 不论等成没成,这句提示只在那 5 秒里成立
              if (waited === 'abort') { noteDiag('搜索重试被用户中止'); return; }
              if (waited === 'returned') {
                var back = findLiveRow();
                if (back && rowKey(back) === state.key) {
                  noteDiag('等待期间讲解中自己回来了 ⇒ 不再重试搜索');
                  row = back;
                  break;
                }
                noteDiag('讲解中回来了但不是本商品 ⇒ 继续重试搜索');
              }
            }
            var bySearch = await locateBySearch(idOfKey(state.key), mark);
            if (bySearch === 'abort') {
              noteDiag('搜索定位被用户中止');
              return;
            }
            /* null = 搜索通道不可用(没搜索框 / 这行没有商品 ID)。
             * 这条道不存在,重试也没意义 —— 直接去滚屏。 */
            if (!bySearch) { noteDiag('搜索通道不可用 ⇒ 直接滚屏'); break; }
            searched = true;                     // 走过搜索通道(成没成都要如实记)
            if (bySearch.row) { row = bySearch.row; break; }
            /* 搜了但没找到:先把用户的筛选词与滚动位置还回去,
             * 让列表回到满长度 —— 否则接下来量到的是被筛过的短列表。 */
            await restoreSearchNow();
            if (attempt < SEARCH_RETRY_MAX) noteDiag('搜索没找到,已还原筛选词,准备重试');
          }
          setStatusLine(null);
        }
        if (!row) {
          if (!allowScroll()) {
            /* 滚屏被闸门拦住(已扫完一圈 / 段数到顶)⇒ 直接走结论 */
            noteDiag('不滚屏:走结论');
          } else {
            var revealed = await revealRow(name0);
            if (revealed === 'abort') {            // 用户喊停 ⇒ 静默收手,不算失败
              noteDiag('找款被用户中止');
              return;
            }
            if (revealed === 'deferred') {          // 用户在操作 ⇒ 顺延,不算失败(#117)
              noteDiag('找款让路:用户正在滚动/点击');
              state.retryAt = Date.now() + 1500;
              return;
            }
            if (revealed === 'bad-container') { failCycle('找不到可滚动的商品列表'); return; }
            /* 这一段没扫完 ⇒ **不算失败、不报消息**,隔 SCAN_GAP_MS 接着扫下一段。
             * 长列表因此是「几段拼起来覆盖全表」,而不是「一次滚到底」或「永远只扫头部」。 */
            if (revealed === 'partial') {
              state.retryAt = Date.now() + SCAN_GAP_MS;
              noteDiag('滚屏这一段没扫完 ⇒ ' + Math.round(SCAN_GAP_MS / 1000) + ' 秒后接着扫');
              return;
            }
            if (revealed === 'exhausted') {
              noteDiag('已扫完一圈仍未找到 ⇒ 不再滚屏');
              /* 落到下面的结论分支(停表 / 记失败),与「没找到」同一出口 */
            } else if (revealed) {
              row = revealed.row;
              moved = revealed;
            }
          }
        }
      }
      if (!row) {
        /* 搜索 + 重试 + 滚屏都没找到那一行。这里只能分「有硬证据」与「没有证据」两种。
         *
         * ★ 2026-10-31 修(这是「分钟档 3.4 秒就停表」的根因):
         *   旧写法拿 `liveAtEntry`(进门时 DOM 里有没有「讲解中」)决定停不停表。
         *   可是小黄车是虚拟滚动 —— **用户往下翻两屏,那一行就不在 DOM 里了,讲解却还在进行**。
         *   于是「我看不见」被读成「你没在讲」,整个功能直接关掉。用户越是用心翻商品越容易中。
         *
         *   现在只有一种停表依据是硬证据:**列表既变短又变矮**——
         *   行数减少且总高少了 ≥100px(一行 132 + 间距 8),说明商品真的被下架 / 移出 / 换了 tab。
         *   两个条件一起用:只看高度会被「切 tab 后列表重新渲染」骗到,
         *   只看行数会被「虚拟列表 buffer 行数浮动」骗到。
         *   都没变 = 行只是没渲染 = 未知,一律记一次失败、退避后再找,绝不停表。
         *   另一种「行在、但没在讲解」的硬证据在下面 isLecturing 那一处判,不在这里。 */
        var gone = false;
        if (hAtEntry && nAtEntry) {
          var hNow = 0, nNow = 0;
          try {
            nNow = rows().length;
            hNow = nNow ? listHeight() : 0;
          } catch (e) { hNow = 0; nNow = 0; }
          if (hNow && nNow && nNow < nAtEntry && (hAtEntry - hNow) >= 100) gone = true;
          if (gone) {
            diagOnce('list-shrank', '列表 ' + nAtEntry + '→' + nNow + ' 行 / 总高 ' +
              Math.round(hAtEntry) + '→' + Math.round(hNow) + ' ⇒ 商品已不在列表(不是被回收)');
          }
        }
        if (gone) {
          stopByNoLecture('列表总高变短 ⇒ 商品已不在列表', '商品已不在列表');
          return;
        }
        /* 没有硬证据 ⇒ 只是「这一轮没找到」,记失败、退避后再找。
         * 文案如实:走过搜索就说搜不到,没走过就说没找到。 */
        failCycle(searched ? '搜不到这件商品,滚屏也没找到' : '找不到那一行商品');
        return;
      }

      /* ★ 进门时没有「讲解中」、靠滚动找回来的行 —— 必须先确认它**真的在讲**。
       *   否则就是把用户已经取消的讲解又点开(既违背意图,又白滚一轮)。 */
      if (!liveAtEntry && !isLecturing(row)) {
        stopByNoLecture('找回的行不是「讲解中」⇒ 用户已取消', '那一行没有在讲解');
        return;
      }

      /* ★ 2026-11-06 弹卡优先(与秒档同一口径,用户定的最优先路径):
       *   商品在讲解中 ⇒ 点「弹出讲解卡」重新弹卡,不取消讲解。
       *   老流程(取消→等翻转→再点讲解)只在弹卡不成立时兜底。 */
      var popped = await tryPopCard(row, mark);
      if (popped === 'abort') return;
      if (popped === 'ok') {
        state.popOk = (state.popOk || 0) + 1;
        state.owedResume = 0;
        finishSlowCycle(row, name0, 'pop');
        return;
      }
      if (popped === 'dropped') {
        noteDiag('分钟档:弹卡后讲解掉了 ⇒ 立刻补讲(走兜底)');
        if (!(await clickLectureAndVerify(mark))) { failCycle('弹卡失败且补讲未确认'); return; }
        state.owedResume = 0;
        finishSlowCycle(row, name0, 're');
        return;
      }

      /* 兜底路径只认 stop 态:新 UI 行内可能同时挂着 pop,拿错了就是
       * "点了个不会取消的按钮,再等 7 秒"(= 反馈 #131 的错法)。 */
      var btn = findStopBtn(row) || findLectureBtn(row);
      if (!btn) {
        if (typeof debugLog === 'function') {
          var texts = $$('button, [role="button"], span, div, a', row)
            .map(function (e) { return txt(e); })
            .filter(function (x) { return x && x.length <= 8; })
            .slice(0, 12);
          debugLog('找不到讲解按钮｜行文本「' + txt(row).slice(0, 40) +
            '」｜候选「' + texts.join(' / ') + '」');
        }
        failCycle('没找到讲解按钮');
        return;
      }
      // 第一次点击:取消讲解
      if (aborted(mark)) { noteDiag('续讲被中止(点击前)'); return; }
      fireClick(btn);
      state.lastShotAt = Date.now();
      await sleep(GAP_MS);
      /* 已点过「取消讲解」但用户这会儿喊停 ⇒ 不再续讲,如实报一句(不偷偷点回去)。
       * 这是唯一会留下「讲解被中断」的中止点,所以必须让用户知道。 */
      if (aborted(mark)) {
        noteDiag('续讲被中止(已取消、未续讲)');
        /* 2026-10-27:同样写在盒子 cycle 那条上(不新增行)—— 否则盒子里会
         * 留着上一条「已续讲 · 第 N 轮」,让人误以为还在跑。
         * 段位同口径:值=商品名,「已中断」是状态,进右端。 */
        boxNote(BOX_CYCLE, 'info', shortName(name0),
          '已中断,可手动点回' + (state.round ? ' · 共 ' + state.round + ' 轮' : ''));
        return;
      }

      /* 平台重渲染后行与按钮都会换新节点 ⇒ 重新找,不缓存引用。
       * 而且**此刻那一行已经不再是「讲解中」**,findLiveRow() 拿不到它,
       * 必须按第一步记下的商品名找回(见 findRowByName 的注释)。
       *
       * 2026-10-25 提速:原来是「固定睡 1.2 秒再找」—— 平台快的时候白等 1.2 秒,
       * 慢的时候 1.2 秒又不够(按钮还写着「取消讲解」,再点一次等于又取消)。
       * 现在改成**等条件**:每 150ms 看一眼按钮文字变回「讲解」就立刻点;
       * 最多等 2 秒,超时就对现有按钮再点一次(当切换处理)。 */
      var key = rowName(row) || name0;
      var btn2 = null;
      for (var w = 0; w < 14; w++) {
        await sleep(150);
        if (aborted(mark)) return;
        var r2 = findRowByName(key);
        var b2 = r2 ? findLectureBtn(r2) : null;
        if (b2 && kindOf(b2) === 'start') { btn2 = b2; break; }
      }
      if (!btn2) {
        var r3 = findRowByName(key);
        btn2 = r3 ? findLectureBtn(r3) : null;
      }
      if (!btn2) {
        failCycle('取消后没找到那一行的讲解按钮');
        return;
      }
      if (aborted(mark)) { noteDiag('续讲被中止(续讲点击前)'); return; }
      fireClick(btn2);

      // 等状态翻转
      var ok = false;
      for (var i = 0; i < Math.ceil(VERIFY_MS / 200); i++) {
        await sleep(200);
        if (aborted(mark)) return;
        if (findLiveRow()) { ok = true; break; }
      }

      if (!ok) { failCycle('续讲后没检测到讲解中'); return; }

      finishSlowCycle(row, name0, 're');
    } catch (e) {
      if (!aborted(mark)) failCycle('动作异常:' + (e && e.message ? e.message : e));
    } finally {
      /* ★ 2026-10-27:先把**用户的筛选条件**还回去(原生搜索通道用过搜索框)。
       *   顺序必须是「先还原搜索 → 再还原滚动」:搜索一清空,列表就重排,
       *   先还原滚动等于白设。被中止时也照做 —— 中途放弃同样不能留下别人的筛选词。
       * 2026-10-31:这段逻辑抽成 restoreSearchNow(),与秒档兜底共用同一份实现。 */
      await restoreSearchNow();
      /* 2026-10-26(#115):还原前停 350ms —— 用户得**看见**它真的滚过去找了,
       * 否则视觉上就是「表面功夫」。停太久会打断点击,350ms 是可见又不碍事的档。
       * 2026-10-27:被中止时不再等这 350ms —— 用户喊停就要立刻停。 */
      if (moved && !aborted(mark)) await sleep(350);
      if (moved && moved.container && moved.container.isConnected) {
        try {
          moved.container.scrollTop = moved.prevScroll;
          window.__dycScriptScrollAt = Date.now();
        } catch (e) { /* 忽略 */ }
      }
      state.busy = false;
      paint();                                   // 时间槽恢复倒计时
      resetSettle();                             // 位置冻结解除 ⇒ 下一拍按实测重贴
      place();
      if (aborted(mark) && state.on) checkNow();
    }
  }

  /* ==========================================================
   * 五·五、守夜(VIGIL)—— 无限模式的常驻态(2026-11-05)
   * ----------------------------------------------------------
   * 用户原话:「做一个无限循环的模式,旨在不会因为短期讲解没有接上就停止……
   *   但为了防止 15 秒状态下每隔 15 秒就操作一下导致页面一直被占用」。
   *
   * 设计要点(与方案评审稿逐条对应):
   *   ① 循环寿命与单次成败解耦:所有「以前会停表」的出口,无限模式下都改成进守夜。
   *   ② 守夜只做 L0 只读探针:每 5~30 秒读一次行内按钮文案,几毫秒,页面无感。
   *   ③ 探针三种结局,决定它不会傻等:
   *        · 行在 + 按钮「取消讲解」⇒ 商品一直在讲,虚惊一场 ⇒ 回倒计时,不点不搜
   *        · 行在 + 按钮「讲解」    ⇒ 真断了            ⇒ 当拍补讲(L1)
   *        · 行不在                ⇒ 继续探,满 60 秒才允许一次重定位(L2)
   *   ④ L2 重定位走**滑窗配额**:最近 5 分钟最多 1 次。用滑窗而不是「距上次计时」,
   *      是因为抖动(接了又断)时后者会被反复刷回 0,配额形同虚设。
   *   ⑤ 唯一的真停:连续 30 分钟页面上一个「讲解」按钮都找不到。
   * ========================================================== */

  /** 守夜期的探针间隔:刚进去加密确认,之后稳定在 30 秒。 */
  function probeGap() {
    var now = Date.now();
    var since = now - state.vigilAt;
    /* 抖动抑制:60 秒内二次进守夜(接了又断),不重新走 5 秒加密 ——
     * 否则反复抖动会退化成「每 5 秒读一次」,虽然还是只读,但没必要。 */
    var warm = (now - state.vigilLeft) >= VIGIL_JITTER_MS;
    if (!warm) return since >= VIGIL_WARM_MS ? VIGIL_PROBE_MS : VIGIL_PROBE_MID_MS;
    if (since < 15000) return VIGIL_PROBE_FAST_MS;
    if (since < VIGIL_WARM_MS) return VIGIL_PROBE_MID_MS;
    return VIGIL_PROBE_MS;
  }

  /**
   * 进守夜。**不停表、不报"已停止"** —— 这是无限模式与旧行为的唯一分叉点。
   * 返回 true 表示已接管(调用方立刻 return,不再走原来的停表逻辑)。
   */
  function enterVigil(why, passive) {
    if (!state.on) return false;
    if (state.phase === 'vigil') {
      /* 已经在守:允许「待命」覆盖普通守夜(用户取消讲解的意图优先级最高),
       * 反方向永远不允许 —— 若让普通守夜把待命降级成"补讲",等于把用户刚关掉的讲解又点开。
       * ⚠ 升级成待命必须重画:否则胶囊还挂着「守候中」,用户看不出这一档已经不会补讲了。 */
      if (passive && !state.passive) {
        state.passive = 1;
        noteDiag('守夜 ⇒ 待命(手动取消覆盖):' + (why || ''));
        boxNote(BOX_FAIL, 'warn', productName(), '待命中 · 等下一个讲解');
        paint();
      }
      return true;
    }
    var now = Date.now();
    state.phase = 'vigil';
    state.passive = passive ? 1 : 0;
    state.vigilAt = now;
    state.vigilWhy = why || '';
    state.probeCount = 0;
    state.probeAt = now + probeGap();
    /* 第一次重定位:进守夜满 60 秒。刚断就搜多半撞上平台还没重渲染完,白花 2.9 秒。 */
    state.relocAt = now + VIGIL_FIRST_RELOC_MS;
    state.resumeAt = 0;
    state.resumeFails = 0;
    if (!state.lastBtnSeen) state.lastBtnSeen = now;
    /* 待命的 30 分钟兜底从「最后一次真动作」起算;从没动过就从现在起算,
     * 否则刚开启就取消会当场被判超时。 */
    if (!state.lastShotAt) state.lastShotAt = now;
    /* 失败计数全部清零:守夜不是失败态,是等待态。
     * 留着它们只会让下次判死提前触发(而无限模式下判死本来就不该存在)。 */
    state.fails = 0;
    state.retryAt = 0;
    state.skips = 0;
    state.softFails = 0;
    state.failSince = 0;
    state.status = null;
    state.busyLabel = '';
    if (state.passive) {
      noteDiag('进待命(手动取消后等下一个讲解):' + (why || ''));
      boxNote(BOX_FAIL, 'warn', productName(),
        '待命中' + (state.round ? ' · 共 ' + state.round + ' 轮' : '') + ' · 等下一个');
    } else {
      noteDiag('进守夜(无限模式):' + (why || ''));
      boxNote(BOX_FAIL, 'warn', productName(), '守候中' + (why ? ' · ' + why : '') + ' · 不停表');
    }
    paint();
    return true;
  }

  /** 守夜 → 正常倒计时。商品其实没断、或补讲已成功时走这条。 */
  function resumeToWait(now, why) {
    state.vigilLeft = now;
    state.phase = 'run';
    state.passive = 0;              // 待命只活到接上为止;回到倒计时就没有"不补讲"这条约束了
    state.startedAt = now;
    state.nextAt = now + intervalMs();
    state.lastShotAt = now;
    state.fails = 0;
    state.retryAt = 0;
    state.skips = 0;
    state.softFails = 0;
    state.failSince = 0;
    state.status = null;
    state.probeAt = 0;
    noteDiag('守夜结束 ⇒ 恢复计时(' + why + ')');
    paint();
  }

  /** 守夜的真停(30 分钟兜底 / 用户关掉无限模式)。 */
  function stopVigil(why) {
    var who = productName();
    var held = state.vigilAt ? fmtLeft(Date.now() - state.vigilAt) : '';
    state.vigilLeft = Date.now();
    noteDiag('守夜停止:' + (why || ''));
    setOn(false, true);                    // 会 resetToWait + paint
    setStatusLine('已停止 · ' + (why || ''), 'stop');
    boxNote(BOX_FAIL, 'alert', who, (held ? '守候 ' + held + ' · ' : '') + (why || '已停止'));
    paint();
  }

  /** 滑窗配额:最近 RELOC_WINDOW_MS 内用掉几次重定位。顺手把过期的丢掉。 */
  function relocAllowed(now) {
    var keep = [];
    for (var i = 0; i < state.relocLog.length; i++) {
      if (now - state.relocLog[i] < RELOC_WINDOW_MS) keep.push(state.relocLog[i]);
    }
    state.relocLog = keep;
    return keep.length < RELOC_MAX;
  }

  /**
   * 待命期:页面上**任意**一行正在讲解 ⇒ 返回它。
   * 只读,不滚不点 —— 为了发现视野外的商品去滚动,等于把页面又抢回来,
   * 与"待命"这个语义正相反(也正是用户抱怨过的"3 次全局滚动搜索")。
   * 优先认按钮文案(取消讲解 / 弹出讲解卡),其次认行内「讲解中」标记。
   */
  function findAnyLecturingRow() {
    var list = [];
    try { list = rows(); } catch (e) { list = []; }
    var markRow = null;
    for (var i = 0; i < list.length; i++) {
      var r = list[i];
      var b = null;
      try { b = findLectureBtn(r); } catch (e) { b = null; }
      var k = b ? kindOf(b) : '';
      if (k === 'stop' || k === 'pop') return r;
      if (!markRow) {
        var lt = false;
        try { lt = isLecturing(r); } catch (e) { lt = false; }
        if (lt) markRow = r;
      }
    }
    return markRow;
  }

  /** 待命接上:把那条正在讲的商品认成新目标,回到正常倒计时。 */
  function adoptPassiveRow(row) {
    var now = Date.now();
    var held = state.vigilAt ? now - state.vigilAt : 0;
    var key = '', name = '';
    try { key = rowKey(row) || ''; } catch (e) { key = ''; }
    try { name = rowName(row) || ''; } catch (e) { name = ''; }
    if (key) state.key = key;
    if (name) state.product = name;
    state.round += 1;
    state.cycles += 1;
    noteDiag('待命接上:' + (name || key || '未具名') + '(待命 ' + Math.round(held / 1000) + ' 秒)');
    resumeToWait(now, '接上新的讲解');
    boxNote(BOX_CYCLE, 'success', productName(),
      '待命 ' + fmtLeft(held) + ' 后接上 · 第 ' + state.round + ' 轮');
    paint();
  }

  /**
   * 待命拍点(2026-11-08 用户定)。
   * ----------------------------------------------------------
   * 与 normal vigil 的区别:**绝不点「讲解」**。用户刚亲手取消了这一品的讲解,
   * 我们再把按钮点回去,等于推翻他的动作。只等页面自己出现"某个品在讲"。
   * 唯一的停:距上一次循环真正介入(成功一轮 / 接上)超过 30 分钟。
   */
  function passiveTick(now) {
    if (now < state.probeAt) {
      if (now - (state.vigilPaintAt || 0) >= 1000) {
        state.vigilPaintAt = now;
        paintStatusLine();
      }
      return;
    }
    state.probeAt = now + probeGap();
    state.probeCount += 1;
    if (userBusy()) { noteDiag('待命探针让路:用户正在操作'); return; }
    /* ★ 30 分钟兜底(用户 2026-11-08 认可):判据是 lastShotAt(真动作),不是 lastBtnSeen。
     *   待命期本来就不点,用"看见按钮"计时会永远不算超时 —— 一条没人管的直播能挂一整夜。 */
    var lastAct = state.lastShotAt || state.vigilAt;
    if (now - lastAct > VIGIL_DEAD_MS) {
      stopVigil('超过 30 分钟没有新的讲解');
      return;
    }
    var row = findAnyLecturingRow();
    if (!row) { noteDiag('待命:暂时没有商品在讲解,继续等'); return; }
    adoptPassiveRow(row);
  }

  /**
   * 守夜拍点。**每拍只读 DOM,绝不点击** —— 点击一律走 doVigilResume。
   * 由 checkNow 在 phase==='vigil' 时直接调用,2 秒一拍,未到 probeAt 时立即返回。
   */
  function vigilTick() {
    if (!state.on || state.phase !== 'vigil' || state.busy) return;
    var now = Date.now();
    /* 待命跟随单独一条路:只扫"有没有品在讲",不补讲、不重定位。 */
    if (state.passive) { passiveTick(now); return; }
    /* 30 分钟兜底:一个「讲解」按钮都没见过 ⇒ 认定已离开商品页 / 列表空了。
     * 这是无限模式唯一会自己停的条件,其余一律守到底。 */
    if (now - state.lastBtnSeen > VIGIL_DEAD_MS) {
      stopVigil('连续 30 分钟没有可讲解的商品');
      return;
    }
    if (now < state.probeAt) {
      /* 没到探针时刻,但文案要跟着秒走 —— 只在守夜期,拍点本身就是 2 秒一次。 */
      if (now - (state.vigilPaintAt || 0) >= 1000) {
        state.vigilPaintAt = now;
        paintStatusLine();
      }
      return;
    }
    state.probeAt = now + probeGap();
    state.probeCount += 1;
    /* 用户正在滚/点 ⇒ 这一拍让路,不读也不抢(下一拍再来)。 */
    if (userBusy()) { noteDiag('守夜探针让路:用户正在操作'); return; }

    var row = null, btn = null;
    try { row = findRowByKey(); } catch (e) { row = null; }
    if (!row && state.product) {
      try { row = findRowByName(state.product); } catch (e) { row = null; }
    }
    if (row) {
      try { btn = findLectureBtn(row); } catch (e) { btn = null; }
    }
    if (btn) {
      state.lastBtnSeen = now;
      var label = kindOf(btn);
      /* ① 还在讲:行只是被虚拟滚动回收了。不点、不搜,回到原来的倒计时。 */
      if (label === 'stop' || label === 'pop' || isLecturing(row)) {
        resumeToWait(now, '商品仍在讲解');
        return;
      }
      /* ② 真断了:当拍补讲,不等一个间隔 —— 这正是「接不上就断」的反面。 */
      if (label === 'start') {
        if (now < state.resumeAt) {
          noteDiag('守夜:补讲冷却中(' +
            Math.round((state.resumeAt - now) / 1000) + ' 秒),下一拍再试');
          return;
        }
        doVigilResume(btn);
        return;
      }
    }
    /* ③ 行不在(或按钮文案不认识):继续守。满 60 秒且配额允许才重定位。 */
    if (now >= state.relocAt && relocAllowed(now)) {
      doVigilReloc();
    }
  }

  /** L1:守夜期的一次补讲(只点一次讲解 + 观察窗,不滚不搜)。 */
  async function doVigilResume(firstBtn) {
    if (state.busy) return;
    var mark = abortSeq;
    state.busy = true;
    state.busyLabel = '补讲中';
    paint();
    try {
      var ok = await clickLectureAndVerify(mark, firstBtn);
      if (aborted(mark)) return;
      if (ok) {
        state.resumeFails = 0;
        state.resumeAt = 0;
        var n = findRowByKey();
        if (n) {
          state.key = rowKey(n);
          state.product = rowName(n) || state.product;
        }
        var held = state.vigilAt ? Math.round((Date.now() - state.vigilAt) / 1000) : 0;
        state.round += 1;
        state.cycles += 1;
        noteDiag('守夜补讲成功 ⇒ 恢复计时(守候 ' + held + ' 秒)');
        resumeToWait(Date.now(), '补讲成功');
        boxNote(BOX_CYCLE, 'success', productName(),
          '守候 ' + fmtLeft(held * 1000) + ' 后接上 · 第 ' + state.round + ' 轮');
        paint();
        return;
      }
      state.resumeFails += 1;
      /* 连续失败到上限就不再主动点,只留探针等重定位窗口 ——
       * 防「按钮看着能点、点了没反应」时被反复空点。 */
      state.resumeAt = Date.now() +
        (state.resumeFails >= RESUME_FAIL_MAX ? 60000 : RESUME_COOLDOWN_MS);
      noteDiag('守夜补讲未确认 ' + state.resumeFails + '/' + RESUME_FAIL_MAX);
      setStatusLine('守候中 · 补讲没确认,稍后再试', 'warn');
    } catch (e) {
      state.resumeFails += 1;
      state.resumeAt = Date.now() + RESUME_COOLDOWN_MS;
      noteDiag('守夜补讲异常:' + (e && e.message ? e.message : e));
    } finally {
      state.busy = false;
      state.busyLabel = '';
      paint();
    }
  }

  /**
   * L2:守夜期的重定位(唯一会真动页面的动作)。
   * 只用平台搜索,不用分段滚屏 —— 滚屏 8 秒一段,在守夜里代价太大,
   * 而「商品被滚走」时 state.key 里的 id 一定还在,搜索够用。
   */
  async function doVigilReloc() {
    if (state.busy) return;
    var now = Date.now();
    state.relocLog.push(now);
    state.relocAt = now + RELOC_WINDOW_MS;
    var id = (state.key && idOfKey(state.key)) || '';
    if (!id) {
      noteDiag('守夜重定位:没有商品 id ⇒ 跳过(只留探针)');
      return;
    }
    var mark = abortSeq;
    var resumeBtn = null;
    var stillLive = false;
    state.busy = true;
    state.busyLabel = '搜索中';
    paint();
    try {
      noteDiag('守夜重定位:平台搜索一次(窗口内第 ' + state.relocLog.length + ' 次)');
      var r = await locateBySearch(id, mark);
      if (r === 'abort') return;
      if (r && r.row) {
        var b = findLectureBtn(r.row);
        var label = b ? kindOf(b) : '';
        if (label === 'start') resumeBtn = b;
        else if (label === 'stop' || label === 'pop' || isLecturing(r.row)) stillLive = true;
      } else {
        noteDiag('守夜重定位没搜到目标');
      }
    } catch (e) {
      noteDiag('守夜重定位异常:' + (e && e.message ? e.message : e));
    } finally {
      /* 先把用户的筛选词还原,再去补讲 —— 否则补讲时点的是被筛过的列表,
       * 平台一还原节点就整批换掉,点了等于白点。 */
      await restoreSearchNow();
      state.busy = false;
      state.busyLabel = '';
      paint();
      if (stillLive) {
        resumeToWait(Date.now(), '重定位发现仍在讲解');
      } else if (resumeBtn) {
        doVigilResume(resumeBtn);
      }
    }
  }

  /**
   * 到点了、页面上却没有任何商品在讲解 ⇒ **停止计时**,不滚、不点、不算失败(2026-10-27)。
   * 用户原话:「我点取消讲解,但是你的按钮没反应过来…… 3 次全局滚动搜索,浪费了我超多时间」。
   * 旧逻辑把「没有讲解中」当成「行被虚拟滚动回收了」,于是每 30 秒滚一遍全表,
   * 连续 3 次。现在只要确认「那一行确实不在讲解」就直接停,并说清是用户自己取消的。
   */
  function stopByNoLecture(why, shown) {
    /* 无限模式:任何「没交接上」的出口都先转守夜,不停表(2026-11-05)。
     * 注意「用户手动取消」不走这里 —— 那条由 onUserCancelClick(isTrusted) 直接停,
     * 以及 checkNow 里 resetToWait 那条(行还在、讲解中没了)。所以这里整段转守夜是安全的。 */
    if (state.infinite && enterVigil(shown || why || '没接上')) return;
    diagOnce('no-lecture', '没有在讲解的商品 ⇒ 停止计时｜' + (why || ''));
    var who = productName();          // 「谁在被执行」先取,reset 之后 state 就空了
    var tail = stopValue();           // 「已停止 · 共 N 轮」
    setOn(false, true);
    /* 右端状态要给用户看得懂的那句,别一律写「当前没有在讲解的商品」——
     * 商品被下架时真正的原因是「不在列表了」,两个场景分开说(2026-10-27)。
     * 2026-10-27 追加:进盒子,但写在 cycle 那条上(不改行数,只刷新内容);
     * 段位同口径 —— 值=商品名,「已停止 + 原因」进右端。 */
    boxNote(BOX_CYCLE, 'info', who, tail + (shown ? ' · ' + shown : ''));
  }

  function failCycle(why) {
    state.fails += 1;
    state.phase = 'error';
    state.retryAt = Date.now() + (state.fails >= FAIL_LIMIT ? SLOW_MS : RETRY_MS);
    paint();
    if (typeof debugLog === 'function') debugLog('续讲失败(' + state.fails + '):' + why);
    /* 2026-10-27:失败只在**连续 FAIL_LIMIT 次都接不上、已放慢重试**时说一次。
     * 前两次静默(还在自己找),这样就不会出现「刚滚到一半先报失败、
     * 滚过去接上了又说已恢复」的自相矛盾。 */
    if (state.fails === FAIL_LIMIT) {
      if (typeof failStatus === 'function') {
        // 三段式:来源｜值｜结果数。值仍是商品名(谁没接上),原因(why)留给调试日志。
        failStatus(productName(), {
          source: SOURCE,
          count: '连续 ' + FAIL_LIMIT + ' 次没接上 · 已放慢重试',
          histKey: BOX_FAIL
        });
      }
    }
    /* ★ 2026-10-27 终点:到了 FAIL_MAX 就**停表**,不再无限慢速重试。
     *   用户在意的是「大半时间被滚动占掉」,那就必须给一条尽头 ——
     *   停表 + 留一条进盒子的消息,让他知道是自动循环自己放弃了,该手动点一次。
     *   这条与「连续 3 次」共用 BOX_FAIL 键 ⇒ 盒子里的失败记录始终只有一格,
     *   内容从「已放慢重试」就地变成「已停止循环」。 */
    if (state.fails >= FAIL_MAX) {
      /* 无限模式:到这里不停表,转守夜(2026-11-05)。 */
      if (state.infinite && enterVigil('连续 ' + FAIL_MAX + ' 次没接上')) return;
      diagOnce('fail-max', '连续 ' + state.fails + ' 次没接上 ⇒ 停止循环｜' + (why || ''));
      var who = productName();        // 同上:先取再 reset
      setOn(false, true);
      boxNote(BOX_FAIL, 'alert', who, '连续 ' + FAIL_MAX + ' 次没接上 · 已停止循环');
    }
  }

  /**
   * 消息口径(2026-10-25 用户定,取代之前「每轮报一条」):
   *   · **只有第 1 轮**说一句「已接管」,而且 keepHistory:false —— 弹一下就完,
   *     不进消息盒子(高频心跳不该占那 100 条的位置,会把别人的消息挤掉);
   *   · 第 2 轮起**完全静默**:按钮上的倒计时就是持续回执,不需要再加一条;
   *   · 失败/恢复才进盒子(见 failCycle 与 recover 分支)——「事后会想知道」的才留痕。
   */
  /* ==========================================================
   * 消息盒子口径(2026-10-27 用户定)
   * ----------------------------------------------------------
   * 用户原话:「循环讲解的相关消息也应该记录在消息盒子里,成功和失败都要进去,
   *   但是条数不能太多了,能少就少」。
   * 矛盾点:成功每 N 分钟一轮,按轮次一条条记 ⇒ 一小时 20 条,100 条的盒子
   *   会被单一功能吃掉;不记又违背「成功也要进去」。
   * 解法:`histKey`(见 dialog.js 的 pushHistory)—— **同一个键只占一条,就地刷新**。
   *   全场最多 2 条:
   *     · autoLoop:cycle —— 成功续讲 / 结束 / 中断(值=商品名,轮次在右端);
   *     · autoLoop:fail  —— 连续失败(3 次,已放慢)/ 放弃(6 次,已停止)。
   *   不管跑多少轮,这两条都只是**改写自己**,不会越长越多。
   *
   * ★ 段位口径修正(2026-10-27 用户报「中间应该是被执行的名字,却写成第 X 轮」):
   *   值段(强)= **商品名**,轮次 / 状态一律进右端弱化位。
   *   原先是反的(值=「已续讲 · 第 N 轮」、商品名塞在弱位),用户一眼看到的
   *   是轮数而不是"谁在被执行",多轮跑起来尤其看不出换没换品。
   * ========================================================== */
  var BOX_CYCLE = 'autoLoop:cycle';
  var BOX_FAIL = 'autoLoop:fail';

  /** 写一条「会原地刷新」的盒子记录(条上照常弹,盒子里只占一格) */
  function boxNote(key, type, value, count) {
    if (typeof toast !== 'function') {
      if (typeof debugLog === 'function') debugLog(SOURCE + '｜' + value + '｜' + (count || ''));
      return;
    }
    toast(value, type, { source: SOURCE, count: count || '', keepHistory: true, histKey: key });
  }

  /** 「谁在被执行」= 值段的内容;停表前先取,resetToWait 之后 state.product 就空了 */
  function productName() {
    return shortName(state.product);
  }

  /** 结束时的**右端状态**:带上总轮次,停表后盒子仍能看出这场一共续了几轮 */
  function stopValue() {
    return '已停止' + (state.round ? ' · 共 ' + state.round + ' 轮' : '');
  }

  /**
   * 每一轮续讲都提示一条(2026-10-25 用户定,推翻上一版「只报第 1 轮」):
   *   · 三段式:来源｜值｜结果数 = 自动循环讲解｜**商品短名**｜第 N 轮;
   *   · 商品名截到 12 字(去掉【店铺前缀】),避免把状态栏撑爆;
   *   · 2026-10-27 起**进消息盒子**,但走 histKey 原地刷新 ⇒ 盒子不随轮次增长。
   * ★ 2026-10-27 用户定:「如果接上了成功了,你就应该按照循环接上的轮数的提示逻辑,
   *   说某某物品循环第 XX 轮这样子的字样」。⇒ 成功**永远只发这一条**,
   *   之前在成功后又单独弹「已恢复」的做法取消 —— 两条消息自相矛盾(先失败后恢复),
   *   现在把「恢复」并进右端状态里。
   */
  /* 2026-11-06:一轮的结果要能区分「弹卡」与「重讲」——
   * 用户会在胶囊里盯这个数字,分不清哪种动作会让"看起来没换卡"。 */
  function reportCycle(name, recovered, how) {
    var tag = how === 'pop' ? ' · 弹卡' : (how === 're' ? ' · 重讲' : '');
    boxNote(BOX_CYCLE, 'success', shortName(name),
      '第 ' + state.round + ' 轮' + tag + (recovered ? ' · 已恢复' : ''));
  }

  /* ==========================================================
   * 七、生命周期
   * ========================================================== */

  var started = false;

  /* ==========================================================
   * 统一闹钟(2026-11-01)
   * ----------------------------------------------------------
   * 用户原话:「放在后台就没法自动循环了」「主要还是保证切页面、没有在前台的
   * 情况下,自动循环讲解能够生效」。
   *
   * 实测(2026-11-01 诊断报告):15 秒档在前台 110 秒走 5 轮(22 秒/轮),
   * 切走之后 354 秒只走 2 轮(177 秒/轮)—— 差 8 倍。根因是浏览器对隐藏标签的
   * 定时器节流:先压到 1 秒一拍,隐藏满 5 分钟再压到 1 分钟一拍。
   *
   * ⇒ 时钟交给离屏文档的 Worker(它不参与可见性节流),这里只负责"到点判断 + 执行"。
   *   判据用绝对时间戳 state.nextAt,**不做累加** —— 中间丢几拍也不会漂移。
   * ========================================================== */
  var lastBeatAt = 0;     // 最后一拍的时间戳(诊断用,判断闹钟活没活着)
  var beatCount = 0;      // 累计收到几拍
  /* 2026-11-01:注册结果必须能被看见。前两轮实机都是「beat.n = 0」却查不出卡在哪,
   * 因为注册失败只进了内部 note,报告里看不见。现在直接摆到报告上:
   *   pending / ok:offscreen(1 秒拍) / ok:alarm(30 秒兜底) / fail:原因 */
  var beatReg = 'pending';
  /* 2026-11-01:监听器有没有注册上也要能看见 —— 万一 IIFE 提前 return(比如防重复注入),
   * 拍子送得到页面也没人接,报告里同样只会显示 beat.n = 0。 */
  var beatListening = false;
  /* 本次改造的代码标记:**只用来判断"页面跑的是哪一版脚本"**。
     版本号在开发期不变(26.10.31.1),连着两次实机反馈都是页面没刷新、
     跑旧代码,白查一轮。以后看报告里「代码=」这一段就能立刻确认。 */
  var LOOP_TAG = 'nap16';
  var lastIdleCheck = 0;  // 空闲态(未锁定讲解中商品)上一次扫描的时间,限 2 秒一次

  /* 自测沙箱里没有 chrome.runtime(纯函数测试不搭扩展环境),所以这里必须防御 ——
     否则整个模块装载就会炸,连带所有纯函数自测一起挂掉。 */
  if (typeof chrome !== 'undefined' && chrome && chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener(function (msg) {
      if (!msg || msg.type !== 'dyc:beat') return false;
      lastBeatAt = msg.at || Date.now();
      beatCount += 1;
      /* ★ 顺序要紧:等待中的那一轮 busy = true,所以放行等待必须排在 busy 判断**之前**,
       *   否则后台的 nap 永远等不到放行,整条 async 链连同 busy 一起卡死。 */
      drainNaps();
      if (!state.on || state.busy) return false;
      /* 2026-11-01 修「第一轮起不来」:
       *   checkFastNow 在没有「讲解中」的商品时会直接 return,**不设 nextAt**;
       *   而这里原来写的是「没有 nextAt 就不响应」—— 两条叠起来就是死锁:
       *   刚开循环、或此刻没有商品在讲解,然后切到后台 ⇒ 页面自己被节流,
       *   「发现有商品开始讲解」这件事一分钟才做一次,循环等于起不来。
       * ⇒ nextAt 为空时也让拍子推一下,把「从无到有」的定位交给它做。 */
      if (!state.nextAt) {
        /* 空闲态(还没锁定讲解中的商品)不能每秒都扫 DOM —— 原来 setInterval 就是
         * 2 秒一次,这里沿用同样的节奏,别因为换了驱动源把空闲开销抬上去。 */
        if (Date.now() - lastIdleCheck >= 2000) {
          lastIdleCheck = Date.now();
          checkNow();
        }
        return false;
      }
      if (Date.now() >= state.nextAt) checkNow();
      return false;
    });
    beatListening = true;
  }

  /* 2026-10-25:DOM 唤醒。列表里「讲解中」标记的出现/消失会触发一次扫描,
   * 不用等下一个拍点。回调只做 300ms 去抖 + 一次轻量 checkNow,
   * 平台自动刷新(每 10 秒重渲染)也只会让它多跑几次判断。 */
  var observer = null;
  var observerTarget = null;
  var wakeTimer = 0;

  function insideOwnUI(node) {
    var el = node && (node.nodeType === 1 ? node : node.parentElement);
    for (var i = 0; el && i < 40; i++, el = el.parentElement) {
      if (el === host || (el.id && /^dy[bc]-/.test(el.id))) return true;
      if (el.getAttribute && el.getAttribute('data-dyc-ar') !== null) return true;
    }
    return false;
  }

  function mutationRelevant(record) {
    if (!record || insideOwnUI(record.target)) return false;
    var lectureRE = /讲解|商品|待上架|已下架|已售罄/;
    if (record.type === 'characterData') {
      // characterData 的旧值也要看：标签由「讲解中」清空时新值本身没有信号。
      return lectureRE.test(String(record.oldValue || '') + txt(record.target));
    }
    if (record.type !== 'childList') return false;
    var nodes = Array.prototype.slice.call(record.addedNodes || []).concat(
      Array.prototype.slice.call(record.removedNodes || []));
    for (var i = 0; i < nodes.length; i++) {
      if (insideOwnUI(nodes[i])) continue;
      // 保留所有平台结构变动，避免漏掉虚拟行回收、节点替换及尚未填字的占位。
      if (nodes[i].nodeType === 1) return true;
      if (lectureRE.test(txt(nodes[i]))) return true;
    }
    return false;
  }

  function ensureObserver() {
    var target = findCartPanel() || document.body;
    if (observer && observerTarget === target && target && target.isConnected) return;
    if (observer) { try { observer.disconnect(); } catch (e) { /* 忽略 */ } }
    if (!target) return;
    observerTarget = target;
    observer = new MutationObserver(function (records) {
      if (!state.on || state.busy || wakeTimer) return;
      if (!records.some(mutationRelevant)) return;
      wakeTimer = setTimeout(function () {
        wakeTimer = 0;
        checkNow();
      }, 300);
    });
    try {
      observer.observe(target, { childList: true, subtree: true, characterData: true, characterDataOldValue: true });
    } catch (e) { observer = null; }
  }

  function start() {
    if (started) return;
    started = true;
    resetToWait();
    if (!state.on) state.phase = 'off';
    slider.cur = sliderValue();
    slider.target = sliderValue();
    lastSliderTxt = '';
    buildUI();

    ensureObserver();

    /* 把本标签登记进离屏闹钟(2026-11-01)。注册不上不算致命:前台靠 tickTimer
       照常跑,只是切到后台会退化成"被节流"的老行为 —— 所以要留痕,不能静默。 */
    try {
      chrome.runtime.sendMessage({ type: 'dyc:beatEnsure' }, function (res) {
        var e = chrome.runtime.lastError;
        if (e) {
          beatReg = 'fail:' + (e.message || '无响应');
          diagOnce('beat', '闹钟注册失败:' + beatReg);
          return;
        }
        if (!res || res.ok === false) {
          beatReg = 'fail:' + ((res && res.error) || '未知原因');
          diagOnce('beat', '闹钟注册失败:' + beatReg);
          return;
        }
        beatReg = 'ok:' + (res.mode || 'offscreen');
      });
    } catch (e) { /* 极老内核没有 runtime,忽略 */ }

    tickTimer = setInterval(checkNow, TICK_MS);
    posTimer = setInterval(function () {
      place();
      if (state.phase === 'run') paint();   // 只更新倒计时数字
      // 秒模式用现有 250ms UI 拍点对时，避免 5 秒设置被 2 秒观察拍点拖成 6 秒。
      if (state.group === 'sec' && state.on && state.nextAt && Date.now() >= state.nextAt) checkNow();
    }, POS_MS);

    /* 2026-10-26(#117):记用户手势 —— 找款期间让路,不和用户抢滚动 */
    var GESTURES = ['pointerdown', 'wheel', 'touchstart', 'keydown'];
    GESTURES.forEach(function (ev) {
      document.addEventListener(ev, noteUserGesture, { capture: true, passive: true });
    });
    start._gestures = GESTURES;

    /* 2026-10-27(用户:「我点取消讲解,但你的按钮没反应过来我已经取消讲解了」):
     * 真人在平台上点「取消讲解 / 结束讲解 / 停止讲解」⇒ **立刻停表** + 中止在跑的链,
     * 不再等两拍轮询(那要 4 秒,足够它把一轮滚屏跑起来)。
     * ★ 只认 isTrusted 的事件:我们自己的 fireClick 派发的是合成事件,
     *   若把它也当成「用户取消」,每轮续讲都会被自己判成取消。 */
    document.addEventListener('click', onUserCancelClick, true);
    start._cancelWatch = onUserCancelClick;

    start._visibility = function () {
      if (!document.hidden) { resetSettle(); place(); checkNow(); }
    };
    document.addEventListener('visibilitychange', start._visibility);
    /* 缩放 / 切回页面后布局一定变了 ⇒ 先清吸附记忆,别让旧坐标挡两拍;
     * 圆钮偏移也要重量(行内间距可能随布局变)。 */
    start._resize = function () { resetSettle(); lampSlotDX = 0; place(); };
    window.addEventListener('resize', start._resize);

    checkNow();
  }

  function stop() {
    if (!started) return;
    started = false;
    abortCycle();                 // ★ 停用时立刻中止在跑的链(关总闸 / 关功能)
    flushNaps();                  // 放行还挂着的后台等待,避免 async 链悬空、busy 卡住
    clearInterval(tickTimer); tickTimer = 0;
    clearInterval(posTimer); posTimer = 0;
    /* 从离屏闹钟摘掉(2026-11-01):不摘的话,闹钟会一直给这个标签打空拍。 */
    try {
      chrome.runtime.sendMessage({ type: 'dyc:beatOff' }, function () { void chrome.runtime.lastError; });
    } catch (e) { /* 忽略 */ }
    if (observer) { try { observer.disconnect(); } catch (e) { /* 忽略 */ } }
    observer = null; observerTarget = null;
    if (wakeTimer) { clearTimeout(wakeTimer); wakeTimer = 0; }
    (start._gestures || []).forEach(function (ev) {
      document.removeEventListener(ev, noteUserGesture, { capture: true });
    });
    document.removeEventListener('click', start._cancelWatch || onUserCancelClick, true);
    document.removeEventListener('scroll', noteScroll, true);
    document.removeEventListener('pointerdown', onDocClick, true);
    document.removeEventListener('click', onDocClick, true);
    document.removeEventListener('visibilitychange', start._visibility);
    window.removeEventListener('resize', start._resize);
    window.removeEventListener('pointerup', bindDrag._end, true);
    if (slider.raf) { cancelAnimationFrame(slider.raf); slider.raf = 0; }
    if (host && host.parentNode) host.parentNode.removeChild(host);
    host = null; shadow = null; refs = {};
    panelOpen = false;
    state.phase = 'off';
    state.product = '';
    state.startedAt = 0;
    state.nextAt = 0;
  }

  function apply(flags) {
    masterEnabled = flags[FLAG] !== false;
    if (!masterEnabled) {
      setupSeq += 1;
      setupPending = false;
      stop();
      return;
    }
    if (started || setupPending) return;
    setupPending = true;
    var mark = ++setupSeq;
    readSettings(mark).then(function () {
      if (mark !== setupSeq || !masterEnabled) return;
      setupPending = false;
      start();
    });
  }

  function boot() {
    if (!/live\/control/.test(location.href)) return;
    dycReadFlags().then(function (flags) {
      // 总开关初始关闭也要订阅，之后开启才能正常恢复控件。
      dycWatchFlags(function (f) { apply(f); });
      apply(flags);
    });

    /* 中控台是 pushState 微前端,切走不重载 document。不跟着收,
     * 圆钮与「讲解」动作会跟到橱窗商品页去 —— 那一页也有商品表格,
     * 行识别会把橱窗商品当成小黄车商品(2026-11-05 用户报)。
     * 离开即停表并摘掉全部 UI;回到中控台重新读一次开关再起。 */
    if (typeof dycWatchLiveScope === 'function') {
      dycWatchLiveScope(function (inScope) {
        if (!inScope) {
          setupSeq += 1;
          setupPending = false;
          stop();
          return;
        }
        dycReadFlags().then(apply);
      });
    }
  }

  /** 状态快照(自测出口与「复制诊断」共用) */
  function snapshot() {
    return {
      on: state.on, phase: state.phase, minutes: state.minutes,
      group: state.group, seconds: state.seconds, skips: state.skips,
      fails: state.fails, round: state.round, busy: state.busy,
      key: state.key, product: state.product ? shortName(state.product) : null,
      lostStreak: state.lostStreak,
      /* 本次开启已跑多久、完成几次动作 ⇒ 报告里直接给「均 X 秒/轮」。
         后台到底跑没跑起来,看这一个数就够,不用再拿时间戳手算。 */
      runSec: state.runSince ? Math.round((Date.now() - state.runSince) / 1000) : 0,
      cycles: state.cycles,
      /* 2026-11-06 弹卡优先通道是否真的在跑:点了多少次 / 确认仍在讲多少次 /
       * 多少次没有可用按钮(后者持续增长 ⇒ 平台又改版了,已自动退回老流程)。 */
      pop: { tries: state.popTries || 0, ok: state.popOk || 0, none: state.popNone || 0 },
      /* 2026-11-08:0 = 没在待命;1 = 手动取消后待命(等下一个讲解的商品,期间绝不点讲解)。 */
      passive: state.passive || 0,
      infinite: !!state.infinite,
      secondsLeft: state.nextAt ? Math.round((state.nextAt - Date.now()) / 1000) : null,
      /* 2026-11-01 统一闹钟活体证据:n = 收过几拍,last = 距今几秒(null = 一拍没收到)。
         切到后台之后循环还动不动,看这两个数就知道,不用再靠猜。 */
      beat: {
        n: beatCount,
        last: lastBeatAt ? Math.round((Date.now() - lastBeatAt) / 1000) : null,
        reg: beatReg,
        listen: beatListening,
        nap: napByBeat,
        fb: napByTimer,
        /* 代码标记:报告里能看见它 = 页面跑的是哪一版脚本。
           2026-11-01 连着两轮实机反馈,页面根本没刷新、跑的还是旧代码,
           光看版本号(26.10.31.1 一直没变)分不出来。 */
        tag: LOOP_TAG
      }
    };
  }

  /* 自测出口:只暴露纯函数与状态快照,不暴露 DOM 引用 */
  window.__DYC_AUTO_LOOP__ = {
    pure: {
      pctOf: pctOf, snapMinute: snapMinute, fmtMinute: fmtMinute,
      adviceOf: adviceOf, zoneOf: zoneOf, fmtLeft: fmtLeft,
      /* 2026-10-26 抖动抑制:吸附三档 + 同行判定,都是纯判断,自测直接调 */
      settle: settle, resetSettle: resetSettle, sameRowBand: sameRowBand,
      /* 2026-10-27 名字清洗(状态词不再污染身份键)+ 身份键 */
      cleanName: cleanName, keyOf: keyOf, shortName: shortName,
      /* 2026-10-27 商品 ID 采集(唯一锚点;货号不算) */
      looksLikeId: looksLikeId, pickIdFromRow: pickIdFromRow,
      /* 2026-10-27 原生搜索定位:键 → 商品 ID(自测直接断言) */
      idOfKey: idOfKey,
      /* 2026-11-06 按钮态分类(讲解 / 取消讲解 / 弹出讲解卡 / 状态标记)—— 纯判断,表驱动自测 */
      kindOfText: kindOfText
    },
    snapshot: snapshot,
    probe: function () {
      var head = findAnchor();
      var list = rows();
      var live = findLiveRow();
      return {
        header: head ? txt(head) : null,
        anchorMode: anchorMode,
        rowLeft: (function () {
          var rr = anchorRow && anchorRow.isConnected ? anchorRow.getBoundingClientRect() : null;
          return rr ? Math.round(rr.left) : null;
        })(),
        capLeft: refs.cap ? Math.round(refs.cap.getBoundingClientRect().left) : null,
        titleOffset: TITLE_OFFSET,
        phase: state.phase,
        on: state.on,
        minutes: state.minutes,
        group: state.group,
        seconds: state.seconds,
        skips: state.skips,
        status: state.status ? state.status.text : null,
        secondsLeft: state.nextAt ? Math.round((state.nextAt - Date.now()) / 1000) : null,
        fails: state.fails,
        round: state.round,
        rows: list.length,
        liveRow: live ? rowName(live).slice(0, 30) : null,
        btn: live ? txt(findLectureBtn(live)) : null,
        /* 2026-11-06:按钮"原文"不够用了 —— 平台把文案换掉时,
         * 报告里得同时看到它被认成哪一态,以及弹卡按钮在不在。 */
        btnKind: live ? kindOf(findLectureBtn(live)) : null,
        popBtn: live ? (function () {
          var pb = findPopBtn(live) || findPopBtnPage();
          return pb ? txt(pb) : null;
        })() : null,
        marks: findAllLecturingMarks().length,
        key: state.key,
        product: state.product ? shortName(state.product) : null,
        lostStreak: state.lostStreak,
        userBusy: userBusy(),
        busy: state.busy,
        scrolled: !!(state.scanPos >= 0 || state.scanDone),   // 滚屏进行中 / 已扫完一圈
        scanPos: Math.round(state.scanPos),                   // 断点位置(诊断:分段续扫走到哪了)
        scanSeg: state.scanSeg || 0,                          // 已扫段数
        scanNeed: state.scanNeed || 0,                        // 按可滚距离推算的整表段数
        /* 2026-10-27:定位记忆 —— 有没有记住、记住的位置、连续命中几次
         * (诊断一眼看出「记忆靠不靠得住」:hits 一直长 = 记忆准;反复 0 = 列表顺序在变) */
        anchorOffset: (state.rowAnchor && typeof state.rowAnchor.offset === 'number')
          ? Math.round(state.rowAnchor.offset) : -1,
        anchorHits: state.anchorHits || 0,
        /* 2026-10-27:原生搜索通道能不能用(能不能定位到那个「请输入商品名称或ID」的框) */
        searchBox: (function () {
          var el = findSearchInput();
          return el ? { ph: (el.getAttribute('placeholder') || '').slice(0, 20), val: String(el.value || '').slice(0, 40) } : null;
        })(),
        mini: !!(refs.cap && refs.cap.classList.contains('mini')),
        lampSlotDX: lampSlotDX,      // 圆钮格实测偏移(0 = 还没量到,按常量 34 预留)
        recent: diagRing.slice(-12),
        rowNames: rows().slice(0, 6).map(function (r) { return keyOf(rowName(r)); }),
        /* 2026-10-27:ID 体检 —— 键有没有落到 id: 上、第一行都挖到了哪些候选属性。
         * 用户问「ID 你看得见吗」,这里就是答案:下次复制诊断直接看 idSample。 */
        rowKeys: rows().slice(0, 6).map(function (r) { return rowKey(r); }),
        idSample: (function () {
          var list = rows();
          if (!list.length) return null;
          var r = list[0];
          var out = { key: rowKey(r), picked: pickIdFromRow(r), hits: [] };
          try {
            var els = [r].concat($$('*', r).slice(0, 80));
            var attrs = ['data-id', 'data-item-id', 'data-product-id', 'data-goods-id',
                         'data-key', 'data-row-key', 'data-clipboard-text', 'title', 'aria-label'];
            for (var i = 0; i < els.length && out.hits.length < 6; i++) {
              var el = els[i];
              if (!el || !el.getAttribute) continue;
              for (var k = 0; k < attrs.length && out.hits.length < 6; k++) {
                var v = el.getAttribute(attrs[k]);
                if (v) out.hits.push(attrs[k] + '=' + String(v).slice(0, 24));
              }
            }
          } catch (e2) { /* 诊断尽力而为 */ }
          /* 2026-10-27 追加:把第一行的 HTML 前 600 字带出来 —— 现场已经证明
           * 属性/文本/链接里都没有 ID,只能看 DOM 本身长什么样再决定往哪儿挖
           * (继续抠 React 内部 props 还是走货号)。只截结构,不做任何推断。 */
          try {
            out.html = String(r.outerHTML || '').replace(/\s+/g, ' ').slice(0, 600);
          } catch (e3) { out.html = ''; }
          return out;
        })(),
        href: location.href
      };
    },
    _start: start, _stop: stop,
    _locateBySearch: locateBySearch,      // 自测:降级行为(没有搜索框 / 没有 ID)必须安静返回
    /* 自测出口:按态取按钮。需要真实 DOM(尺寸 + 可点判定),jsdom 里用 getBoundingClientRect 补丁验。
     * 2026-11-06 起这是"点错按钮"的唯一防线(#131:把弹卡当取消/开始),必须能被单测直接打到。 */
    _findPopBtn: findPopBtn,
    _findStopBtn: findStopBtn,
    _findStartBtn: findStartBtn,
    _findPopBtnPage: findPopBtnPage,
    _kindOf: kindOf
  };

  boot();
})();
