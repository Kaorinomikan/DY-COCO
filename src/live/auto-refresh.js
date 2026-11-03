/**
 * 小黄车 · 自动刷新（原生【刷新列表】左侧一枚圆钮 + 角标状态灯）
 * ============================================================
 * 【需求】(用户 2026-10-19 反馈 #92;2026-10-20 改为指示灯形态并定稿 A A A B B)
 *   未开播时平台不会自己刷新小黄车列表 ⇒ 库存款、卖出数量不实时。
 *   要「未开播期间每 10 秒刷新一次」,开播后**自动停**(开播后平台会自己刷,
 *   双重刷新会造成卡顿),也要能**手动接管**。
 *
 * 【形态:不做整合按钮,只在原生按钮左边放一盏灯】
 *   用户原话:「不做整合按钮,做在这个原生刷新按钮的左边…用颜色区分,不要有一直旋转的
 *   圈圈,很影响我的注意力,用恒定不跳动的指示灯区分就可以了」。
 *   ⇒ 原生按钮**一个像素都不动、也不改它的任何样式**(上一版那套「设成透明再盖住」
 *     彻底作废);我们只在它左侧放一盏 12px 的小灯。
 *
 * 【三色 —— 颜色表达状态,呼吸表达「在不在干活」】
 *   绿 `#0e9f2a` 自动(未开播) ⇒ 每 10 秒刷一次,光晕**呼吸**
 *   橙 `#cf5f00` 强制(开播也刷) ⇒ 照刷,光晕呼吸,灯珠多一圈**深色描边**(形状上区分)
 *   灰 `#7a828e` 不刷 ⇒ 光晕**静止**(不用看颜色,看动不动就知道在不在刷)
 *
 * 【点击循环按「档位」走,不按颜色走(拍板 ① 定稿)】
 *   绿(自动·未开播)        → 橙
 *   灰(自动·已开播/判不出)   → 橙   ★ 关键:此时变绿等于没变(绿在已开播时就是灰),
 *                                    所以直接给橙 —— 一步到位「开播也要刷」
 *   橙(强制)                → 灰(你手动停)
 *   灰(你手动停的)           → 绿(未开播)/ 橙(直播中或判不出)
 *   ⇒ 所以「灰」有两种来路,点一下的结果不同;靠**悬停说明**交代是哪一种(拍板 ②)。
 *
 * 【#103 修:手动停的灰灯也不能无条件回 auto(2026-10-22 用户反馈)】
 *   原话:直播中点灰灯,语音说「恢复自动」但灯色仍是灰,以为逻辑坏了。
 *   根因:off → auto 无条件执行,而直播中 auto 档本身**就是灰且不刷**
 *        (开播那刻已被「已开播，自动停」置了 autoStopped,canRefresh 也判 false),
 *        切过去等于原地不动 ⇒ 灯色零变化 + 语音与事实矛盾。
 *   修法:判据不再是「从哪个档来」,而是「auto 档此刻到底能不能干活」——
 *        只有 liveState==='prelive' 且没因开播自动停(autoEffective())才回 auto;
 *        否则一步给橙。直播中因此变「灰 ⇄ 橙」两态循环,未开播仍是三态。
 *        「判不出」同样走橙 —— 它与直播中一样是 auto 不干活的死路。
 *
 * 【无记忆(拍板 ③)】三态只存在内存,不写 storage / localStorage ⇒
 *   真刷新(F5 / Ctrl+R)一定回到绿色;站内点菜单换页再切回则保持(脚本没重载)。
 *
 * 【开播怎么判 —— 判据在共享模块,失败偏向停,但要先确认 3 次】
 *   ★ 2026-11-03：判据本体已迁到 src/content/live-state.js（唯一真源），
 *     本文件只调用、不再自己扫页面。原先这里与 lucky-bag.js 各写一份，
 *     两份漂移直接导致「福袋没开播也照开抽屉」（福袋那份停在薄判据上）。
 *   信号分三档（详细口径见 live-state.js 文件头）：
 *     · 在播 —— 【结束直播】/【下播】/【关播】类按钮；或**递增**的 HH:MM:SS 计时器
 *       （递减是开播倒计时，不算）；
 *     · 未开播 —— 播前引导横幅「开播前请使用直播计划」；或「开始直播 / 未开播 /
 *       直播已结束」这类完全相等的文案；
 *     · 判不出 —— 保持上一次的结论继续刷，**连续 3 次（约 6 秒）都判不出**才转灰不刷。
 *
 *   为什么偏向停:把已开播误判成未开播 ⇒ 双方同时刷、列表反复重排(正是用户担心的
 *   卡顿),代价高;反过来只是回到手动点刷新,代价低。两边不对称 ⇒ 拿不准选代价低的那边。
 *   为什么要「连续 3 次」:判定每 2 秒一次,页面正在重渲染时单次判不出是常态,
 *   一次不中就停会让用户莫名其妙(用户 2026-10-20 反馈「即使没开播也会停」)。
 *
 * 【灯挂哪里 —— body + fixed(这一条是上一版验证过的生死线)】
 *   平台是 React。我们每 10 秒点一次刷新会让那一排工具按钮**整个重渲染**,
 *   挂在平台容器里的外来子节点会被一起清掉 ⇒ 灯会周期性闪一下。
 *   挂 body + fixed 后平台怎么重渲染都碰不到我们;代价是 fixed 不跟页内滚动,
 *   所以**每拍重新量一次原生按钮的位置**把灯贴上去,按钮滚出画面就把灯藏起来。
 *
 * 【次级页面(弹层)打开 ⇒ 灯藏起来(#98 用户 2026-10-20 反馈)】
 *   原话:「自动刷新的小绿点,在我打开次级页面添加商品的时候会挡住」。
 *   灯 z-index 近上限,平台弹层压不过它 ⇒ 弹层打开时灯就浮在弹层内容上。
 *   修法(用户拍板「不显示」,不做半透明降级 / 不做可拖动):
 *     弹层开着 ⇒ 灯 display:none;弹层关了 ⇒ 下一拍(≤750ms)自己回来。
 *   判据与「礼貌刷新」**共用同一套 popupOpen()**(平台 auxo modal / drawer /
 *   popover / dropdown + 我们自己的弹窗与消息盒子)—— 弹层开着时刷新本来就
 *   停(canRefresh 里有这条),现在灯跟着一起藏,显隐与「刷不刷」永远一致;
 *   判据若有遗漏,行为也不会比今天更糟(刷新本来就没被它拦住)。
 *   【2026-10-20 深夜补】用户重载后「添加商品」弹层仍不藏 ⇒ 实证该弹层不挂
 *   auxo 精确类名,popupOpen 补两档通用兜底(role="dialog" + body 直子层
 *   浮层词),判据与 search.js #72 的 inOverlay / clear-stock.js 同源。
 *
 * 【滚动时灯暂时隐身(用户 2026-10-20 拍板「方案一」)】
 *   灯 fixed 挂 body,每拍重贴按钮位置;滚动时按钮每帧都在动,灯追不上,
 *   观感「绿点被拖拽」。处置:页面滚动链滚动中灯藏,停稳 350ms 后下一拍贴回。
 *   口径与两枚浮动圆钮同源(整页滚动 + 商品列表容器);链外滚动区(评论列表)
 *   不触发。监听零成本(只记 target+时间戳),链判定放进每拍的 placeLamp。
 *   为什么用缓存版 popupOpenFast():弹层检测 = 8 个选择器逐个查 + 逐个读矩形,
 *   主循环 250ms 一拍不能每拍实跑;加 500ms 缓存 ⇒ 实际检测 ≤ 2 次/秒,
 *   弹层开/关的感知延迟 ≤ 0.75 秒,用户无感。
 *
 * 【程序化滚动豁免(2026-10-21 用户反馈「全能搜索时灯一直闪」)】
 *   全能搜索的全量扫描 = 逐屏写 scrollTop(连续几秒),扫完还要滚回原位、
 *   定位匹配项再滚一次 —— 程序化滚动与手滚在 scroll 事件层面**无法区分**,
 *   全被「滚动中藏灯」当成用户在滚 ⇒ 灯在扫描步进的空隙里反复藏/显 = 一直闪。
 *   修法:扩展自己发起的滚动,在发起时刻写 window.__dycScriptScrollAt
 *   (smooth 滚动另写 __dycScriptScrollFor 加长窗口);markScrollTgt 看到
 *   豁免窗口内的 scroll 事件一律忽略。手动滚动(滚轮/拖动条)没有打点 ⇒
 *   防漂移照旧。打点覆盖:全能搜索(扫描/定位/恢复)、上滑到顶、下滑到底、
 *   序号定位、明细页签对位、本模块自己的滚动回放(restoreScroll)。
 *   ⚠️ 新写程序化滚动必须同步打点,漏了 = 灯又开始闪(见 search.js 565 注)。
 *
 * 【滚出画面 = 不算失败(用户 2026-10-20 反馈后定)】
 *   「点得着」的判据 = 节点还在文档 + 有真实尺寸 + 没禁用 / 不在加载中。
 *   **不再要求它在视口里** —— 按钮在不在画面里与「能不能程序化点到它」毫无关系
 *   (上一版把五点采样用在视口外也照跑,滚出画面时五个点全被跳过 ⇒ 命中 0 ⇒
 *    误判成「点不着」⇒ 约 30 秒后停机;实测数据见方案稿第五节)。
 *   五点采样只在按钮**本来就在视口里**时才跑(那时它才有意义:防被平台浮层盖住)。
 *
 * 【真故障不彻底停机,转「慢速重试」(同轮定)】
 *   连续 3 次点不到(每次间隔一个刷新周期)⇒ **不彻底停**,改为每 30 秒轻试一次;
 *   按钮一回来就**自动恢复** 10 秒的正常节奏,不必刷新页面。
 *   理由:停机是单向的(只能刷新页面),慢速重试是双向的(条件恢复自己回来)。
 *
 * 【礼貌刷新 —— 什么时候「不」刷】
 *   最近 8 秒打过字 / 有弹窗或我们自己的消息盒子 / 页面不在前台 /
 *   上一轮还没刷完 / 刚进页面 3 秒内 ⇒ 本轮跳过。
 *   ⚠️ 「正在打字」判的是**最近有没有输入事件**,不是「光标在不在输入框」——
 *   用户点过商品名搜索框不点走的话焦点会一直留在 input 上,按焦点判会让刷新永久停掉。
 *
 * 【点击怎么转手】我们按钮上的点击是假事件(isTrusted=false),要转手去点平台那枚。
 *   只发**一套**事件:pointerdown → mousedown → pointerup → mouseup → click,每样各一次。
 *   **不能既 btn.click() 又补全套** —— 那会让平台收到两次点击 = 每 10 秒刷两遍。
 *   只发 click 又不行:平台有时在捕获阶段把它吞掉(罗盘货号按钮的实测教训)。
 *
 * 【出声分寸(AGENTS.md 第 21 条 三段式,来源词 = 自动刷新)】
 *   · 每 10 秒那次成功刷新 **完全不出声** —— 灯在呼吸就是心跳;
 *   · 点灯换档 → 按目标档说:`强制刷新` / `已暂停` / `恢复自动`(操作回声,不进盒子);
 *   · 开播后自动停 → `已开播，自动停`(**进盒子**);
 *   · 连续 3 次判不出 → `状态未知，已暂停`(只提醒,不进盒子);
 *   · 转入慢速重试 → `暂时找不到刷新按钮，正在重试`(**进盒子**);
 *   · 慢速重试期间按钮回来了 → `已恢复，自动刷新中`(**进盒子**)。
 *
 * 【开关】flags.js 的 liveAutoRefresh(中控台组,默认开)。
 *   关掉即时生效:摘定时器 + 摘灯。
 *
 * 【依赖】flags.js(开关)、live-state.js(开播判据,必需)、
 *         dialog.js(toast,可选)、locate.js(滚动容器,可选)。
 *         live-state.js 缺失时判据恒为 unknown ⇒ auto 档停刷(安全方向)。
 * ============================================================
 */

(function dycAutoRefresh() {
  'use strict';

  // 防重复注入(SPA 路由回切、脚本意外重跑时不会叠两个定时器)
  if (window.__dycAutoRefreshLoaded) return;
  window.__dycAutoRefreshLoaded = true;

  /* ---------- 依赖自检(flags.js 必须先加载) ---------- */
  if (typeof dycReadFlags !== 'function' || typeof dycWatchFlags !== 'function') {
    return;
  }

  /* ---------- 常量 ---------- */

  var LAMP_CLASS = 'dyc-ar-lamp';     // 指示灯(挂 body + fixed)
  var STYLE_ID = 'dyc-ar-style';
  var MARK_ATTR = 'data-dyc-ar';      // 幂等 / 诊断标记(值为落点版本)
  /**
   * ★ 落点版本号:任何参与渲染的常量变了都要 +1。
   *   为什么:开发期改了灯的结构 / 尺寸 / 类名之后,不刷新页面的用户手里那盏旧灯
   *   会一直停在旧参数上 —— 修好的判据对它不起作用。
   *   v2 = 由「取代型浮层按钮」改为「左侧指示灯」。
   */
  var MARK_VER = '3';

  var TICK_MS = 250;                  // 主循环步长(跟手用;灯不动,不靠它走字)
  var JUDGE_EVERY = 8;                // 每 8 拍(≈2 秒)判一次直播状态
  var INTERVAL_MS = 10000;            // 刷新间隔(用户 2026-10-20 定:10 秒)
  var JITTER_MS = 500;                // 节奏抖动 ±0.5 秒
  var START_DELAY = 3000;             // 进页面先等 3 秒
  var FAIL_LIMIT = 3;                 // 连续点不到这么多次 ⇒ 转「慢速重试」
  var RETRY_INTERVAL_MS = 30000;      // 慢速重试的间隔(不彻底停机)
  var RESTORE_SCROLL_DELAY = 400;     // 刷完多久把滚动位置放回去

  /* 控件几何(全部派生,改一处即可整体联动)
   * 2026-10-25 用户定:形态由「一盏小灯」改为**圆形按钮 + 角标灯**(方案 C)——
   *   中间一枚静态刷新图标、右上角 8px 角标灯表示状态;点一下仍然切档。
   *   保留「不旋转」:2026-10-20 用户明确否掉旋转圈圈,图标恒静。 */
  var LAMP_HIT = 26;                  // 圆钮直径 = 点击命中区边长
  var DOT_SIZE = 8;                   // 角标灯内容尺寸
  var DOT_BORDER = 1.5;               // 角标灯白描边(与按钮白底分离)
  var HALO_SPREAD = 4;                // 角标灯光晕外扩
  var LAMP_GAP = 8;                   // 圆钮**右边缘**距原生按钮左边缘
  /* 找不到原生刷新按钮时的宽限(2026-10-27):平台重渲染会让按钮节点消失一两拍,
   * 以前立刻摘灯、下一拍重建 = 用户看到的「一闪没了又回来」。900ms ≈ 3~4 拍。 */
  var LAMP_MISS_GRACE = 900;
  var ICON_SIZE = 14;                 // 中心图标尺寸
  var DOT_R = (DOT_SIZE + DOT_BORDER * 2) / 2;   // 角标灯外半径(自测与文档用)

  var REFRESH_TEXT = '刷新列表';
  /* 判据相关的常量（LIVE_TEXTS / PRE_LIVE_TEXTS / TIMER_RE / BANNER_TTL /
   * LIVE_MISS_LIMIT）已于 2026-11-03 全部迁到 src/content/live-state.js。
   * 本文件不再保留第二份 —— 留着就一定会有人顺手改错那一份。 */
  var EXT_MARK_ATTRS = ['data-dyc-ar', 'data-dyc-code-btn', 'data-dyc-ld-btn'];

  /* ---------- 状态 ---------- */

  var flags = null;
  var loopTimer = null;
  var tickCount = 0;

  /**
   * 慢速重试态:连续 FAIL_LIMIT 次点不到原生按钮。
   * **不是停机** —— 只是把节奏放宽到 RETRY_INTERVAL_MS,并让灯转灰;
   * 一旦点到就自动恢复 INTERVAL_MS。理由见文件头。
   */
  var slowRetry = false;

  /** 'auto' | 'force' | 'off' —— 无记忆:只在本次页面有效,不写 storage */
  var mode = 'auto';

  /** 已确认的直播状态:'prelive' 未开播 / 'live' 直播中 / 'unknown' 判不出。
   *  ★ 2026-11-03：结论来自共享模块 live-state.js（唯一真源），本变量只是
   *    本模块的状态副本 —— 灯色与挡位切换要拿「上一拍结论」做跃迁播报，
   *    那是本模块的语义，不能直接读全局。
   *    everLive / unknownStreak 两个防抖状态也一并交给共享模块保管了
   *    （两个调用方各自推进计数会把防抖窗口按调用次数成倍消耗）。 */
  var liveState = 'unknown';

  /** auto 模式下因开播而自动停(与用户手动停区分开:前者开播结束自动恢复) */
  var autoStopped = false;

  /** 「状态未知」只说一次(每次开启功能重置) —— 否则观众每次判定都弹一遍 */
  var unknownSaid = false;

  /** 慢速重试的提示也只说一次(恢复时再报一次「已恢复」) */
  var retrySaid = false;

  var nextAt = 0;                     // 下一次该刷的时刻
  var startedAt = 0;                  // 主循环起点(启动延迟用)
  var failCount = 0;                  // 连续点不到的次数
  var busyUntil = 0;                  // 刷新后一小段时间内不叠加
  var lamp = null;                    // 我们的指示灯
  var lampMissAt = 0;                 // 从哪一刻起找不到原生刷新按钮(用于宽限,防闪)
  var prevOn = null;                  // 开关回声用

  /* ---------- 小工具 ---------- */

  function now() { return Date.now(); }

  /** 归一化文本:去掉所有空白 —— 平台文案里常有全角空格与换行 */
  function norm(s) {
    return String(s == null ? '' : s).replace(/[\s\u3000]+/g, '');
  }

  /**
   * 元素是否「有真实尺寸」。
   *
   * ★ 只读**一次**矩形就够 —— 不用 offsetParent 先探一遍。
   *   原写法是 offsetParent === null 时再读一次矩形(为了兼容 fixed 定位),
   *   结果是每个元素两次布局读取;而判定「有尺寸」本来就只需一次矩形。
   */
  function visible(el) {
    if (!el || !el.isConnected) return false;
    var r;
    try { r = el.getBoundingClientRect(); } catch (e) { return false; }
    return !!r && r.width > 1 && r.height > 1;
  }

  function isExtNode(el) {
    if (!el || !el.getAttribute) return false;
    for (var i = 0; i < EXT_MARK_ATTRS.length; i++) {
      if (el.getAttribute(EXT_MARK_ATTRS[i]) !== null) return true;
    }
    return false;
  }

  /** 元素是否落在扩展自己注入的子树里 */
  function insideExt(el) {
    var p = el;
    var depth = 0;
    while (p && depth < 40) {
      if (isExtNode(p)) return true;
      if (p.id && /^dy[bc]-/.test(p.id)) return true;
      p = p.parentElement;
      depth++;
    }
    return false;
  }

  function say(message, type, opts) {
    try {
      if (typeof toast === 'function') toast(message, type, opts || {});
    } catch (e) { /* 消息条不在也不影响刷新本身 */ }
  }

  /* ---------- 找平台【刷新列表】按钮 ---------- */

  /**
   * 判定一个元素是不是那枚「刷新列表」。
   * 只认**语义 + 结构**:文本恰为「刷新列表」(允许前后带图标字符),
   * 且是个小尺寸可点元素。不认 class 哈希(平台改版即断)。
   */
  function looksLikeRefresh(el) {
    if (!el || el.nodeType !== 1) return false;
    if (insideExt(el)) return false;
    var t = norm(el.textContent);
    if (!t) return false;
    // 文本必须「就是」刷新列表(允许外层包一层文字,但长度要接近)
    if (t !== REFRESH_TEXT && t.indexOf(REFRESH_TEXT) !== 0) return false;
    if (t.length > REFRESH_TEXT.length + 2) return false;

    var r = el.getBoundingClientRect();
    if (r.width < 24 || r.width > 180) return false;
    if (r.height < 12 || r.height > 48) return false;
    if (!visible(el)) return false;

    // 有子元素时,挑**最内层**那个(外层往往把「设置商品推荐卡」等一起包住)
    return true;
  }

  var REFRESH_TAGS = ['BUTTON', 'A', 'SPAN', 'DIV', 'I', 'P'];

  /**
   * ★ 缓存:主循环每 250ms 一拍,若每拍都全页 TreeWalker(几千节点),
   *   一分钟就是二十多万次节点访问 —— 白烧 CPU,还会被性能闸门盯上。
   *
   * 策略分两种情形,区别很要紧:
   *   · **缓存还活着**(节点在文档里 + 仍符合判据)⇒ 直接用,零扫描。
   *   · **缓存失效**(平台重渲染把节点换掉了)⇒ **立刻重扫,不节流**。
   *     失效本身就说明「页面变了,该重扫」;若在这里节流,失效后那一拍会拿到 null,
   *     主循环会撤掉灯 —— 用户看到的就是「灯每隔一会儿闪一下」。
   *   · **上一次没找到**(负结果)⇒ 负结果节流 RESCAN_MS,避免页面没渲染完时空扫。
   *
   * ⚠️ 不拿「节点身份」当定位判据(平台重渲染会换节点)—— 它只是**查找加速器**,
   *    每轮仍要重新量矩形,所以换了节点坐标也不会错。
   */
  var RESCAN_MS = 1000;
  var _refreshBtn = null;
  var _refreshMissAt = 0;      // 上一次「没找到」的时刻(负结果节流用)

  /**
   * 快校验(每 250ms 都走这条,必须极省)。
   *
   * 与 looksLikeRefresh 的区别:这里**故意不查「是否扩展自己的节点」** ——
   * 缓存的这枚按钮是全页扫描筛出来的(扫描时已排除扩展节点),
   * 而它自己永远不可能变成扩展节点。省掉这次判断,就省掉一次
   * 「沿祖先链最多 40 层 × 3 个属性」的遍历。
   */
  function refreshRect(el, readings) {
    if (!readings) return el.getBoundingClientRect();
    for (var i = 0; i < readings.length; i++) {
      if (readings[i].el === el) return readings[i].rect;
    }
    var rect = el.getBoundingClientRect();
    readings.push({ el: el, rect: rect });
    return rect;
  }

  function refreshBtnValid(el, readings) {
    if (!el || !el.isConnected) return false;
    var t = norm(el.textContent);
    if (t !== REFRESH_TEXT && t.indexOf(REFRESH_TEXT) !== 0) return false;
    if (t.length > REFRESH_TEXT.length + 2) return false;
    var r;
    try { r = refreshRect(el, readings); } catch (e) { return false; }
    return !!r && r.width >= 24 && r.width <= 180 && r.height >= 12 && r.height <= 48;
  }

  /** 全页找那枚按钮,取「文本最贴近、且包住文字的最内层」 */
  function findRefreshBtn(readings) {
    if (refreshBtnValid(_refreshBtn, readings)) return _refreshBtn;

    // 负结果节流:上一拍刚扫过且没找到 ⇒ 这一拍不重复扫
    if (!_refreshBtn && now() - _refreshMissAt < RESCAN_MS) return null;

    _refreshBtn = scanRefreshBtn();
    if (_refreshBtn) _refreshMissAt = 0;
    else _refreshMissAt = now();
    return _refreshBtn;
  }

  function scanRefreshBtn() {
    var host = document.body;
    if (!host) return null;

    var best = null;
    var bestScore = 1e9;

    var walker = document.createTreeWalker(host, NodeFilter.SHOW_ELEMENT, {
      acceptNode: function (n) {
        if (isExtNode(n)) return NodeFilter.FILTER_REJECT;
        var tag = n.tagName;
        for (var i = 0; i < REFRESH_TAGS.length; i++) {
          if (tag === REFRESH_TAGS[i]) return NodeFilter.FILTER_ACCEPT;
        }
        return NodeFilter.FILTER_SKIP;
      }
    });

    var el;
    while ((el = walker.nextNode())) {
      if (!looksLikeRefresh(el)) continue;
      var t = norm(el.textContent);
      // 越短越贴近正文(=越内层);同分取先出现的
      var score = t.length * 10;
      if (score < bestScore) { bestScore = score; best = el; }
    }

    /* ★ 从「最内层」往**上**爬到真正的按钮本体。
     *
     * 为什么必须爬:那枚按钮通常是「图标 + 文字」两个子节点 ——
     *   图标是 `<i class="iconfont"></i>` 或一个 svg,**本身没有文字**。
     *   所以最内层的匹配元素只是那段文字所在的 span;若以它为基准放灯,
     *   灯会贴到文字的左边而不是按钮的左边(会盖住平台图标)。
     *
     * 爬的判据很硬:往上走后文本**仍然**恰好是「刷新列表」(说明那个父元素
     * 里除了这段文字就只有空图标),且尺寸仍在上限内。一旦文本变长
     * (比如父元素把「设置商品推荐卡」也包进来)立刻停 —— 绝不越爬越大。
     */
    var climb = 0;
    while (best && best.parentElement && climb < 6) {
      var p = best.parentElement;
      if (norm(p.textContent) !== norm(best.textContent)) break;
      var pr;
      try { pr = p.getBoundingClientRect(); } catch (e) { break; }
      if (!pr || pr.width > 180 || pr.height > 48) break;   // 超上限的不认
      best = p;
      climb++;
    }

    return best;
  }

  /* ---------- 直播状态判定 ----------
   *
   * ★ 2026-11-03：判据本体已抽到共享模块 src/content/live-state.js（唯一真源）。
   *   原先这里与 lucky-bag.js 各写一份，两份必然漂移 —— 实际已经漂了：
   *   这边补到三路信号（按钮 / 计时器递增 / 播前横幅），福袋那边还停在
   *   「只认两组文案、判不出当在播」，于是没开播也照开抽屉。
   *   现在这里只保留**调用与状态缓存**，判据本身不再在本文件实现。
   *
   *   为什么还留 judgeLive() 这一层：本文件的 liveState 要参与灯色 / 挡位切换，
   *   是「本模块自己的状态」，不能直接读全局 —— 灯需要「上一拍结论」来做
   *   跃迁播报（开播自动停、恢复自动），那是本模块的语义，不是判据的。
   */

  /**
   * 判一次直播状态（带确认，由共享模块负责防抖）。
   *
   * 共享模块内部的「连续判不出才认 unknown」+「单向锁」原样生效，
   * 本函数只负责把结论落到 liveState 上并返回。
   *
   * @return {string} 已确认的直播状态 'live' | 'prelive' | 'unknown'
   */
  function judgeLive() {
    var g = window.dycLiveState;
    if (!g || typeof g.judge !== 'function') {
      /* 共享模块不在场（注入顺序异常 / 老包）：保守判「未知」。
       * 未知在 auto 档 = 停刷，是安全方向 —— 不会因为判据缺失就乱刷。 */
      liveState = 'unknown';
      return liveState;
    }
    liveState = g.judge();
    return liveState;
  }

  /** 单次采样（不推进防抖计数）。自测与排查用，主循环走 judgeLive() */
  function judgeLiveOnce() {
    var g = window.dycLiveState;
    if (!g || typeof g.once !== 'function') return 'unknown';
    return g.once();
  }

  /**
   * 清掉共享模块的防抖状态。
   *
   * 为什么需要：用户点了灯（切挡）之后不该还背着「刚才连续判不出 2 次」的账 ——
   * 那会让下一次判定立刻落 unknown，表现为「刚点完就判不出」。
   * 只清缓存与计数，不动结论（结论由下一拍 judgeLive 重新给）。
   */
  function resetLiveJudge() {
    var g = window.dycLiveState;
    if (g && typeof g.invalidate === 'function') g.invalidate();
  }

  /* ---------- 「正在打字」判定 ---------- */

  /**
   * 最近一次键盘输入 / 文本编辑的时刻。
   *
   * ★ 为什么判「最近有没有打字」而不是判「光标在不在输入框里」:
   *   后者有个很常见的坑 —— 用户点过搜索框、之后把光标留在框里就不管了。
   *   此时 focus 永远在 input 上,按「焦点在输入框」判会让自动刷新**整段时间
   *   彻底停掉**,列表再也不更新,而用户完全不知道原因。
   */
  var TYPING_IDLE_MS = 8000;
  var _lastTypeAt = 0;

  function markType() { _lastTypeAt = now(); }

  function typingRecently() {
    return now() - _lastTypeAt < TYPING_IDLE_MS;
  }

  try {
    document.addEventListener('keydown', markType, true);
    document.addEventListener('input', markType, true);
    document.addEventListener('compositionstart', markType, true);   // 中文输入法
    document.addEventListener('scroll', markScrollTgt, true);        // 捕获阶段才收得到容器的滚动
  } catch (e) { /* 极端环境下挂不上监听,退回「不判打字」也不致命 */ }

  /**
   * 有没有浮层开着(平台弹窗 / 抽屉 / 下拉菜单 / 我们自己的弹窗与消息盒子)。
   *
   * ⚠️ **刻意不把 `.auxo-tooltip` 算进来**:鼠标停在任意按钮上都会飘出
   *    tooltip,那是浏览页面时的常态,拿它当「用户正在操作」的判据会让刷新
   *    频繁被跳过。这里只认「用户主动打开、需要它一直开着」的那些浮层。
   */
  /* ==========================================================
   * 浮层采集(2026-10-27 重构)
   * ----------------------------------------------------------
   * 用户原话:「自动刷新和讲解循环两个按钮不要因为右上角的小框框弹出就隐藏」。
   * 旧写法只有一个布尔:**页面上存在浮层 ⇒ 灯藏**。选择器里含
   * `.auxo-popover` / `.auxo-dropdown` / role=dialog / body 直子层浮层词 ——
   * 中控台右上角那张「智能推荐」小卡片一弹出来就命中,灯与胶囊(同源判据)双双消失,
   * 而它明明只占一小块角,根本没盖住我们。
   * 新口径:**把矩形一起采出来,再判「有没有真的盖住这块区域」**,
   * 且要求浮层本身够大(面积 ≥ 视口 12%)—— 下拉菜单 / 角标卡片 / 气泡提示一律不算。
   * 这样 #98(「添加商品」那种大弹层不能盖住灯)仍然成立,小卡片不再误伤。
   * ⚠️ canRefresh() 仍用**布尔版** popupOpen():「弹层开着就不自动刷」是另一回事,
   *    它的口径一张没动(本改动不碰刷新节奏)。
   * ========================================================== */
  var OVERLAY_SEL = [
    '.auxo-modal-root', '.auxo-modal-wrap', '.auxo-drawer',
    '.auxo-dropdown', '.auxo-popover', '.auxo-select-dropdown',
    '.dyb-dialog-root', '.dyb-history'
  ];
  /** 面积低于视口 12% 的浮层不算「挡道」(下拉 / 气泡 / 角卡都在这一档以下) */
  var OVERLAY_MIN_AREA = 0.12;
  /** body 直子层的浮层类名词(词边界,含 CSS Modules 的 xxx_modal__hash 形态) */
  var OVERLAY_WORD_RE = /(^|[-_ ])(modal|dialog|drawer|overlay|popup)([-_ ]|$)/i;

  /** 采一份浮层矩形(只在缓存过期时跑) */
  function overlayRects() {
    var out = [];
    function push(el) {
      var r;
      try { r = el.getBoundingClientRect(); } catch (e) { return; }
      if (r && r.width > 16 && r.height > 16) out.push(r);
    }
    for (var i = 0; i < OVERLAY_SEL.length; i++) {
      var els = document.querySelectorAll(OVERLAY_SEL[i]);
      for (var k = 0; k < els.length; k++) push(els[k]);
    }
    /* #98 兜底两档(与旧版一致):
     *   ① role="dialog" —— ARIA 弹层语义,React 生态弹层标配;
     *   ② 弹层 portal 都挂 body 直子层 ⇒ 只扫这一层,类名含浮层词即算。 */
    var dlgs = document.querySelectorAll('[role="dialog"]');
    for (var d = 0; d < dlgs.length; d++) push(dlgs[d]);
    var top = document.body ? document.body.children : [];
    for (var t = 0; t < top.length; t++) {
      var c = top[t];
      if (OVERLAY_WORD_RE.test(classStr(c))) push(c);
    }
    return out;
  }

  /** 浮层是否**真的盖住** rect,且浮层本身够大(小卡片不算) */
  function coveredByOverlay(rect) {
    if (!rect) return false;
    /* 2026-11-01(#126 / #127):判据统一到 src/content/overlay-guard.js。
     * 本文件原来那份把「浮层面积 ≥ 视口 12%」当挡道门槛 —— 那只是「有没有盖住我」
     * 的粗糙代理,代价是「直播工具」这类中等尺寸下拉面板一律不算挡道,
     * 于是用户看到「这些框框都不自动隐藏」。共享判定直接量**交集**
     * (重叠 ≥ 控件面积 35%),面板大小无关。
     * 共享模块缺席时(注入顺序异常 / 独立自测)退回本地旧判据,不让灯因此常显。 */
    var g = window.dycOverlayGuard;
    if (g && typeof g.covers === 'function') {
      return g.covers(rect);
    }
    var list = overlayListFast();
    if (!list.length) return false;
    var vw = window.innerWidth || document.documentElement.clientWidth || 1600;
    var vh = window.innerHeight || document.documentElement.clientHeight || 900;
    var minArea = vw * vh * OVERLAY_MIN_AREA;
    for (var i = 0; i < list.length; i++) {
      var o = list[i];
      if (o.width * o.height < minArea) continue;
      if (rect.left < o.right && rect.right > o.left &&
          rect.top < o.bottom && rect.bottom > o.top) return true;
    }
    return false;
  }

  /** 旧的布尔口径(给 canRefresh 用):页面上有没有浮层 —— 语义与本轮改动前一致 */
  function popupOpen() {
    return overlayRects().length > 0;
  }

  /**
   * 超级福袋的抽屉是不是开着 / 刚开过。
   *
   * 用户 2026-11-01 05:22：「打开抽屉的时候，自动刷新可以让步不刷新。不然会冲突。」
   * 这里的「冲突」是双向的：刷新会派一套合成 pointerdown/up/click（可能点穿到抽屉上），
   * 还会重排列表（福袋刚读到的行与倒计时跟着失效）。
   *
   * 为什么不能只靠 popupOpen()：那是**浮层启发式**（8 个选择器 + role=dialog + 矩形），
   * 抽屉刚弹出、平台还在动画/挂载的那几百毫秒里可能还没被认出来，
   * 而福袋的读数正好落在这几百毫秒里。所以由福袋模块**主动**给两个确定的信号：
   *   · `__dycBagBusyUntil` —— 我们正在开/读/关抽屉（带截止时间，自己会过期）；
   *   · `__dycBagPanelOpen` —— 抽屉当前是否开着（每拍刷新，含用户自己开的）。
   * 任一命中就顺延一轮，600ms 后再看；关掉/读完自然补上，不丢轮次。
   */
  function bagBusy() {
    try {
      if (window.__dycBagPanelOpen) return true;
      if (window.__dycBagBusyUntil && Date.now() < window.__dycBagBusyUntil) return true;
    } catch (e) { /* 读不到就按「不忙」处理 */ }
    return false;
  }

  /**
   * 浮层采集的便宜版(#98 的缓存思路,2026-10-27 沿用):
   *
   * 采集 = 8 个选择器的 querySelectorAll + role=dialog + body 直子层 + 逐个读矩形,
   * 主循环 250ms 一拍,不能每拍实跑。500ms 缓存 ⇒ 实际采集 ≤ 2 次/秒;
   * 浮层打开 → 灯最多 750ms 内让位(500ms 缓存 + 1 拍),关闭同理恢复。
   *
   * canRefresh() 保持用**实时版** popupOpen():它每 10 秒才跑一次,不差这点开销;
   * 缓存只服务「灯的显隐」这一条路径。
   */
  var POPUP_TTL = 500;
  var _popupAt = 0;
  /* 缓存内容 = 浮层矩形数组(null / 复位成 false 时都当空) */
  var _popupHit = null;

  function overlayListFast() {
    var t = now();
    if (_popupAt && (t - _popupAt) < POPUP_TTL) return _popupHit || [];
    _popupAt = t;
    _popupHit = overlayRects();
    return _popupHit || [];
  }

  function popupOpenFast() {
    return overlayListFast().length > 0;
  }

  /** 取元素类名(兼容 SVG 的 SVGAnimatedString) */
  function classStr(el) {
    if (!el) return '';
    var c = el.className;
    if (c && typeof c === 'object' && typeof c.baseVal === 'string') return c.baseVal;
    return String(c || '');
  }

  /** 平台刷新按钮是不是正在加载(按钮进加载态 / 被禁用 / 出现转圈图标) */
  function refreshBusy(btn) {
    if (!btn) return false;
    if (btn.disabled) return true;
    var cls = classStr(btn) + ' ' + classStr(btn.parentElement);
    if (/loading|spin|busy/i.test(cls)) return true;

    /* 再看按钮**内部**有没有转圈图标(平台的加载态常见是
     * <i class="...loading"> 或 <svg class="...spin">)。
     * ⚠️ 范围只取按钮自己,**不扩大到父容器** —— 那一排还并排着
     * 「添加商品」等按钮,它们各自的加载态与我们无关。 */
    if (btn.querySelector) {
      var spins = btn.querySelectorAll('[class*="loading"], [class*="spin"]');
      for (var i = 0; i < spins.length; i++) {
        if (visible(spins[i])) return true;
      }
    }
    return false;
  }

  /**
   * 平台按钮此刻是否还「值得跟」——**它得真的在视口里**。
   *
   * 灯用的是 position:fixed + 视口坐标,所以按钮一旦滚出可视区,
   * 灯就会飘到页面上方/下方的别处去盖住别的东西。
   * 这条判据只用于**灯的显隐** —— 与「能不能刷」无关(见 refreshUsable)。
   *
   * @param {{left:number,top:number,width:number,height:number}} r 平台按钮矩形
   * @param {number} vw 视口宽
   * @param {number} vh 视口高
   * @return {boolean} true = 还看得见,灯该显示
   */
  function inViewport(r, vw, vh) {
    if (!r || !(r.width > 0) || !(r.height > 0)) return false;
    // 允许贴边(按钮压在视口边缘时仍要显示),只要还有可见部分即可
    if (r.right !== undefined) {
      if (r.right <= 0 || r.bottom <= 0) return false;
    } else {
      if (r.left + r.width <= 0 || r.top + r.height <= 0) return false;
    }
    if (r.left >= vw || r.top >= vh) return false;
    return true;
  }

  /**
   * ★★ 「能不能程序化点到它」——这是本轮修的那处缺陷的核心。
   *
   * 判据 = 节点还在文档里 + **有真实尺寸** + 没被禁用 / 不在加载中。
   * **不含「必须在视口里」** —— 按钮在不在画面里,与「程序化点击能不能生效」
   * 毫无关系。上一版把「五点采样」也用在视口外,而五点落在视口外时会被逐个跳过
   * ⇒ 命中数 0 ⇒ 误判「点不着」⇒ 约 30 秒后停机(用户滚到下方看商品时就会遇到)。
   *
   * 尺寸为 0 是**真异常**:常见于按钮被藏在未激活的页签 / 折叠区里,
   * 那时点它确实不会有反应 —— 这种情况才该算失败。
   */
  function refreshUsable(btn) {
    if (!btn || !btn.isConnected) return false;
    var r;
    try { r = btn.getBoundingClientRect(); } catch (e) { return false; }
    if (!r || r.width < 4 || r.height < 4) return false;   // 尺寸塌成 0 ⇒ 真异常
    return true;
  }

  /**
   * 五点采样:确认按钮没被别的浮层盖住。
   * ⚠️ **只在按钮本来就在视口里时才调用** —— 视口外的点会被跳过,
   *    那时这个判据既无意义、又会产生假阴性。
   */
  function clickable(btn) {
    if (!btn || !btn.isConnected) return false;
    // 只读一次矩形,五点采样的坐标全从它算(不逐个点再读一次布局)
    var r = btn.getBoundingClientRect();
    if (r.width < 4 || r.height < 4) return false;
    var pts = [
      [r.left + r.width / 2, r.top + r.height / 2],
      [r.left + 3, r.top + 3],
      [r.right - 3, r.top + 3],
      [r.left + 3, r.bottom - 3],
      [r.right - 3, r.bottom - 3]
    ];
    var hitOk = 0;
    for (var i = 0; i < pts.length; i++) {
      var x = pts[i][0], y = pts[i][1];
      if (x < 0 || y < 0 || x > window.innerWidth || y > window.innerHeight) continue;
      var hit = document.elementFromPoint(x, y);
      if (!hit) continue;
      /* 四种命中都算「点得到」:
       *   ① 命中我们自己的灯;② 命中灯里的灯珠(子节点);
       *   ③ 命中平台原按钮;④ 命中按钮内部节点。 */
      if (hit === lamp || (lamp && lamp.contains(hit)) ||
          hit === btn || btn.contains(hit) || hit.contains(btn)) {
        hitOk++;
      }
    }
    return hitOk >= 3;
  }

  /* ---------- 滚动位置保回 ---------- */

  /**
   * 取商品列表的滚动容器(刷完要把滚动位置放回去)。
   *
   * ① 优先用 locate.js 的 getScrollContainer —— 它自带 10 秒缓存;
   * ② 本文件的兜底只在 locate.js 不在时走,同样带缓存,且改为**两段式**:
   *    先只读 scrollHeight/clientHeight 粗筛,只有尺寸像真滚动容器的少数候选
   *    才去读 getComputedStyle(它是最贵的一步,可能强制布局)。
   */
  var _scroller = null;
  var _scrollerAt = 0;
  var SCROLLER_TTL = 10000;

  /* ---- 滚动中的灯要藏(用户 2026-10-20 拍板「方案一:滚动时暂时隐身,停了再回来」) ----
   * 灯是 fixed 挂 body,每拍(250ms)重贴一次按钮位置;滚动时按钮每帧都在动,
   * 灯 1/4 秒才追一次 ⇒ 滚动期间脱手漂移,用户观感「绿点被拖拽」。
   * 处置:滚动进行中把灯藏起来,整页停稳 SCROLL_QUIET_MS(350ms)后下一拍自动贴回。
   * 口径与两枚浮动圆钮同源(用户 2026-10-14 定):只认「页面滚动链」= 整页滚动 +
   * 商品列表容器;链外滚动区(左侧直播互动栏评论列表等)不触发,灯照常显示。
   * 监听做成零成本:scroll(捕获阶段)回调只记「谁在滚 + 什么时候」,不读任何矩形;
   * 「是不是滚动链」的判定放进每拍一次的 placeLamp 里(scroller 自带 10 秒缓存)。 */
  var SCROLL_QUIET_MS = 350;
  var _scrollTgt = null;
  var _scrollAt = 0;

  /**
   * 程序化滚动豁免窗口(2026-10-21):打点后这么久的 scroll 事件不算用户在滚。
   * 瞬时赋值的事件余波几乎零延迟到达,400ms 绰绰有余;逐屏扫描由每步重新
   * 打点续期,窗口无需覆盖全程;smooth 动画(圆钮)由发起方写
   * __dycScriptScrollFor 加长(Chrome 系 smooth 时长基本恒定,800ms 够)。
   */
  var SCRIPT_SCROLL_WIN_MS = 400;

  /** scroll 事件(捕获)回调 —— 高频,只准写两个变量,不准读布局 */
  function markScrollTgt(e) {
    /* 程序化滚动豁免:扩展自己发起的滚动(全能搜索扫描/定位/恢复、两枚
     * 圆钮、序号定位、明细页签对位)发起时都会打点;窗口内的 scroll 事件
     * 不当作「用户在滚」,灯不因此隐藏 —— 这正是「全能搜索时灯一直闪」的根。
     * 手动滚动没有打点 ⇒ 照旧记录,防漂移逻辑不变。 */
    var ss = window.__dycScriptScrollAt || 0;
    if (ss) {
      var win = window.__dycScriptScrollFor || SCRIPT_SCROLL_WIN_MS;
      if (now() - ss < win) return;
    }
    _scrollTgt = e.target;
    _scrollAt = now();
  }

  /** 这个滚动来源属不属于「页面滚动链」(整页滚动 / 商品列表容器) */
  function inScrollChain(t) {
    if (!t) return false;
    if (t === document || t === document.documentElement || t === document.body) {
      return true;   // 整页滚动(scroll 事件 target = document)
    }
    if (t === window) return true;
    return t === scroller();   // 商品列表容器;评论列表等链外容器 ⇒ false
  }

  /** 现在算不算「页面滚动进行中」(停稳 SCROLL_QUIET_MS 后为 false,灯下一拍回来) */
  function scrollingNow() {
    if (!_scrollTgt) return false;
    if (now() - _scrollAt >= SCROLL_QUIET_MS) return false;
    return inScrollChain(_scrollTgt);
  }

  function scroller() {
    if (typeof getScrollContainer === 'function') {
      try {
        var s0 = getScrollContainer();
        if (s0) return s0;
      } catch (e) { /* 落到本文件的兜底 */ }
    }
    if (_scroller && _scroller.isConnected && now() - _scrollerAt < SCROLLER_TTL) {
      return _scroller;
    }
    _scrollerAt = now();
    var best = null;
    var bestH = 0;
    var divs = document.querySelectorAll('div, section, main');
    var cands = [];
    for (var i = 0; i < divs.length; i++) {
      var el = divs[i];
      var sh = el.scrollHeight, ch = el.clientHeight;
      if (sh <= ch + 30) continue;     // 装得下 ⇒ 不需要滚
      if (sh < 600) continue;          // 太矮 ⇒ 不可能是商品列表
      cands.push(el);
    }
    for (var k = 0; k < cands.length; k++) {
      var e2 = cands[k];
      var st;
      try { st = getComputedStyle(e2); } catch (e) { continue; }
      if (st.overflowY !== 'auto' && st.overflowY !== 'scroll') continue;
      if (e2.scrollHeight > bestH) { bestH = e2.scrollHeight; best = e2; }
    }
    _scroller = best;
    return best;
  }

  var savedScroll = null;

  function saveScroll() {
    var s = scroller();
    savedScroll = s ? { el: s, top: s.scrollTop } : null;
  }

  /**
   * 刷完把滚动位置放回去 —— **只在「被弹回顶部」这一种情况下动手**。
   *
   * 为什么判据这么窄:刷新之后这 400ms 里,用户可能自己滚了。
   * 若无条件写回 scrollTop,就变成「我刚滚到第 80 个商品,它又把我拽回去」。
   * 而真正要解决的坏现象只有一个 —— 平台刷新把列表**重置到顶部**。
   */
  function restoreScroll() {
    if (!savedScroll) return;
    var s = savedScroll.el;
    var top = savedScroll.top;
    savedScroll = null;
    if (!s || !s.isConnected) return;
    if (top < 40) return;                 // 本来就在顶部,没什么可放回的
    if (s.scrollTop > 40) return;         // 位置还在 ⇒ 平台保持了,或用户自己滚的 ⇒ 不动
    window.__dycScriptScrollAt = now();   // 自己的回滚也是程序化滚动,别触发藏灯
    try { s.scrollTop = top; } catch (e) { /* 尽力而为 */ }
  }

  /* ---------- 真正刷一下 ---------- */

  /**
   * 点一次平台按钮(转手)。
   *
   * 只发**一套**点击序列(pointerdown → mousedown → pointerup → mouseup → click),
   * 每样各一次 —— 不能既 btn.click() 又补全套,那会让平台收到两次点击
   * ⇒ 每 10 秒刷两遍,正是用户担心的「双重刷新」。
   *
   * 为什么不用单纯的 btn.click():平台有时在**捕获阶段** stopPropagation
   * 把 click 吞掉(罗盘货号按钮的实测教训),而 pointerdown 更早、很少被拦。
   */
  function clickRefresh(btn) {
    if (!btn) return false;
    saveScroll();

    var r;
    try { r = btn.getBoundingClientRect(); } catch (e) { r = { left: 0, top: 0, width: 0, height: 0 }; }
    var base = {
      bubbles: true, cancelable: true, view: window, button: 0, buttons: 1,
      clientX: r.left + r.width / 2, clientY: r.top + r.height / 2
    };

    function fire(type, usePointer) {
      try {
        var ev = usePointer
          ? new PointerEvent(type, Object.assign({ pointerId: 1, pointerType: 'mouse', isPrimary: true }, base))
          : new MouseEvent(type, base);
        btn.dispatchEvent(ev);
      } catch (e) { /* 老内核不支持 PointerEvent ⇒ 交给 MouseEvent 那条 */ }
    }

    try {
      fire('pointerdown', true);
      fire('mousedown', false);
      fire('pointerup', true);
      fire('mouseup', false);
      fire('click', false);
    } catch (e2) {
      try { btn.click(); } catch (e3) { /* 都失败:本轮算没刷成 */ }
    }

    setTimeout(restoreScroll, RESTORE_SCROLL_DELAY);
    return true;
  }

  /* ---------- 指示灯 ---------- */

  var CSS = [
    /* 指示灯:挂 body + fixed —— 平台是 React,挂在它容器里会被重渲染清掉。
       z-index 取接近上限的值,保证压在平台工具栏之上。 */
    '.' + LAMP_CLASS + ' {',
    '  all: initial;',
    '  position: fixed;                    /* 挂 body + fixed:平台 React 重渲染碰不到 */',
    '  z-index: 2147483000;',
    '  box-sizing: border-box;',
    '  width: ' + LAMP_HIT + 'px; height: ' + LAMP_HIT + 'px;',
    '  display: flex; align-items: center; justify-content: center;',
    '  border-radius: 50%;',
    '  background: #fff; border: 1px solid #e5e6eb;', 
    '  box-shadow: 0 1px 2px rgba(31,35,41,.06);',
    '  cursor: pointer;',
    '  transition: background .12s, border-color .12s;',
    '}',
    '.' + LAMP_CLASS + ':hover { background: #f2f3f5; border-color: #d9dce1; }',

    /* 中心图标:静态,永不旋转(用户 2026-10-20 明确否掉旋转圈圈) */
    '.' + LAMP_CLASS + ' .dyc-ar-ico {',
    '  width: ' + ICON_SIZE + 'px; height: ' + ICON_SIZE + 'px;',
    '  display: block; color: #4e5969;',
    '}',

    /* 角标灯:贴按钮右上角,白描边与按钮底分离,不吃布局 */
    '.' + LAMP_CLASS + ' .dyc-ar-dot {',
    '  position: absolute; right: -2px; top: -2px;',
    '  box-sizing: content-box;',
    '  width: ' + DOT_SIZE + 'px; height: ' + DOT_SIZE + 'px;',
    '  border-radius: 50%;',
    '  border: ' + DOT_BORDER + 'px solid #fff;',
    '  display: block;',
    '  background: #7a828e; color: #7a828e;',
    '}',

    /* 光晕:只改 opacity 呼吸 ⇒ 不改尺寸、不位移、不重排。
       ★ 呼吸只做在光晕上,角标本体恒定满色(否则颜色糊掉,对比度掉到 3:1 以下)。 */
    '.' + LAMP_CLASS + ' .dyc-ar-dot::after {',
    '  content: ""; position: absolute; left: -' + HALO_SPREAD + 'px; top: -' + HALO_SPREAD + 'px; right: -' + HALO_SPREAD + 'px; bottom: -' + HALO_SPREAD + 'px;',
    '  border-radius: 50%; background: currentColor; opacity: .23;',
    '  animation: dyc-ar-breathe 3.6s ease-in-out infinite;',
    '}',
    '@keyframes dyc-ar-breathe { 0%, 100% { opacity: .12; } 50% { opacity: .34; } }',

    /* 三色(对比度实测:绿 3.49 / 橙 3.97 / 灰 3.88,均 ≥ 3:1) */
    '.' + LAMP_CLASS + '[data-c="green"] .dyc-ar-dot { background: #0e9f2a; color: #0e9f2a; }',
    '.' + LAMP_CLASS + '[data-c="orange"] .dyc-ar-dot { background: #cf5f00; color: #cf5f00; }',
    '.' + LAMP_CLASS + '[data-c="gray"] .dyc-ar-dot { background: #7a828e; color: #7a828e; }',

    /* 图标与边框跟着状态着色 —— 圆钮比小灯更需要「远处一眼看出」 */
    '.' + LAMP_CLASS + '[data-c="green"] { border-color: #b7ebc6; background: #f4fdf6; }',
    '.' + LAMP_CLASS + '[data-c="green"] .dyc-ar-ico { color: #0a8f28; }',
    '.' + LAMP_CLASS + '[data-c="orange"] { border-color: #ffd9b3; background: #fffaf3; }',
    '.' + LAMP_CLASS + '[data-c="orange"] .dyc-ar-ico { color: #cf5f00; }',

    /* 灰 = 不干活 ⇒ 光晕静止。「在不在刷」看动不动就知道,不必分辨颜色。 */
    '.' + LAMP_CLASS + '[data-c="gray"] .dyc-ar-dot::after { animation: none; opacity: .14; }',
  ].join('\n');

  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    var st = document.createElement('style');
    st.id = STYLE_ID;
    st.textContent = CSS;
    (document.head || document.documentElement).appendChild(st);
  }

  /* ==========================================================
   * 落位吸附(2026-10-26)
   * ----------------------------------------------------------
   * 用户原话:「这两个自添加的按钮,会因为原生的刷新在刷新,然后会轻微左右抖动,
   *   希望位置固定且不抖动」「两个按钮应该在同一个水平线上,不要因为其他按钮影响而抖动」。
   * 根因不是算错,而是**每拍照抄测量值**:平台刷新期间按钮群会重排、图标会换加载态,
   * getBoundingClientRect 每拍能差 1~3px;灯 250ms 一拍追一次,就是肉眼可见的左右抖。
   * 规则(与 auto-loop-lecture.js 的胶囊同一套,两边各自持有状态):
   *   |Δ| ≤ 2px  ⇒ 当噪声,**不写 style**(位置就此固定)
   *   |Δ| ≥ 10px ⇒ 真移动(切页 / 缩放 / 行重排),立刻跟
   *   中间档     ⇒ 连续两拍指同一个目标才跟(滤掉刷新那一瞬的单拍值)
   * 复位:灯从藏到显、换了灯节点、窗口缩放。
   * ========================================================== */
  /* 吸附阈值与记忆:≤2px 当噪声不动、≥10px 立刻跟(详见 settle 头部) */
  var SETTLE_SMALL = 2;
  var SETTLE_BIG = 10;
  var settleSt = {};
  var settleEl = null;

  function resetSettle() {
    settleSt = {};
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
   * 把灯贴到原生按钮左侧。
   *
   * 位置全部由原生按钮的矩形派生:
   *   灯珠**右边缘**距按钮左边缘 LAMP_GAP(8px)
   *   ⇒ 灯珠中心 X = 按钮左边缘 − LAMP_GAP(8) − DOT_R(随 DOT_SIZE 联动)
   *   ⇒ 命中区 left = 灯珠中心 − LAMP_HIT/2(12)
   *   ⇒ 命中区右边缘 = 灯珠中心 + 12,恒在按钮左边缘左侧(**刻意不探进按钮**,不抢它自己的点击)
   *   纵向与按钮垂直居中对齐。
   *
   * 坐标直接取**视口坐标**,配合 position:fixed —— 不换算成容器内绝对定位,
   * 免得再处理 padding box / clientLeft / 滚动量这一类只属于绝对定位的坑。
   *
   * 按钮滚出视口时把灯藏起来:fixed 元素不跟页内滚动,不藏就会停在屏幕某处盖住别的内容。
   */
  function placeLamp(btn, readings) {
    if (!lamp || !btn || !btn.isConnected) return false;

    /* 换了灯节点(摘掉重建)⇒ 吸附记忆作废 —— 旧坐标对新节点没有意义 */
    if (settleEl !== lamp) { resetSettle(); settleEl = lamp; }

    /* #98:次级页面(弹层)打开 ⇒ 灯让位。
     * ★ 2026-10-27 改口径(用户:「不要因为右上角的小框框弹出就隐藏」):
     *   从「**有浮层**就藏」改成「**浮层真的盖住灯**且浮层够大才藏」——
     *   判据下沉到下面算完 left/top 之后(要用灯的真实矩形去测相交),
     *   这里不再提前 return。 */

    /* 滚动进行中 ⇒ 灯先藏(用户拍板「方案一」,2026-10-20):滚动时按钮每帧都在动,
     * 灯 1/4 秒才追一次会脱手漂移;整页停稳约 0.35 秒后下一拍自动贴回。
     * 与弹层分支同一条显隐通道,两条件并列,互不抢写。 */
    if (scrollingNow()) {
      if (lamp.style.display !== 'none') lamp.style.display = 'none';
      return true;
    }

    var host = document.body;
    if (!host) return false;
    if (lamp.parentElement !== host) {
      try { host.appendChild(lamp); } catch (e) { return false; }
    }

    var r = readings ? refreshRect(btn, readings) : btn.getBoundingClientRect();
    if (!inViewport(r, window.innerWidth, window.innerHeight)) {
      if (lamp.style.display !== 'none') lamp.style.display = 'none';
      return true;                       // 仍是「已挂好」,只是暂时不可见
    }
    var wasHidden = (lamp.style.display === 'none');

    /* 2026-10-26(用户报抖):刷新进行中 ⇒ **冻结坐标**,不重测不重写。
     * 两个信号任一成立就冻:
     *   ① 我们自己刚点过原生刷新(now() < busyUntil,点完 1.2 秒内平台必在重排);
     *   ② 平台按钮进加载态(内部图标在换 / 动画在跑,量出来的矩形每拍差 1~3px)。
     * 只在「本来就在显示」时冻 —— 刚恢复显示的灯必须先把位置写上,不能停在旧坐标。 */
    if (!wasHidden && lamp.style.left !== '') {
      var busyNow = false;
      if (now() < busyUntil) busyNow = true;
      if (!busyNow) {
        try { busyNow = refreshBusy(btn); } catch (e) { busyNow = false; }
      }
      if (busyNow) return true;
    }

    /* 圆钮**右边缘**距原生按钮左边缘 LAMP_GAP(8px),纵向与按钮居中对齐。
     * 命中区就是圆钮本身(26×26),右边缘恒停在按钮左侧 ⇒ 不探进按钮,不抢它的点击。 */
    var centerY = r.top + r.height / 2;
    var left = r.left - LAMP_GAP - LAMP_HIT;
    var top = centerY - LAMP_HIT / 2;

    /* 浮层覆盖判定(2026-10-27):只有**真的盖住这枚圆钮**的大浮层才让灯让位。
     * 返回 true = 已挂好、暂不可见(tick 不会因此摘灯)。 */
    if (coveredByOverlay({
      left: left, top: top,
      right: left + LAMP_HIT, bottom: top + LAMP_HIT
    })) {
      if (lamp.style.display !== 'none') lamp.style.display = 'none';
      return true;
    }
    if (lamp.style.display === 'none') {
      lamp.style.display = '';
      resetSettle();
    }

    // 容差交给 settle():≤2px 当噪声不写、≥10px 立刻跟、中间档两拍确认。
    // (旧版这里是 1.5px 容差 —— 噪声稍大仍会来回写,用户看到的「轻微左右抖」就是这个)
    var s = lamp.style;
    var nx = settle('lampL', left);
    var ny = settle('lampT', top);
    if (nx !== null) s.left = nx + 'px';
    if (ny !== null) s.top = ny + 'px';
    return true;
  }

  /**
   * auto 档此刻是否**真的在干活**(灯也才会是绿)。
   *
   * 判据只有一条:未开播,且没因开播自动停。
   * 直播中 / 判不出 / 已自动停 ⇒ false ⇒ 此时切到 auto 是死路(灯不变、也不刷)。
   * #103 的点灯分支与灯色、悬停说明都走这一条判据,三处口径永远一致。
   */
  function autoEffective() {
    return liveState === 'prelive' && !autoStopped;
  }

  /**
   * 「灰·手动停」点一下之后会回到哪个档(灯色 + 悬停说明 + 实际切档共用这一条)。
   *
   * 未开播 ⇒ true(回 auto,灯变绿);
   * 直播中 / 判不出 ⇒ false(直接给 force,灯变橙)—— 这两态 auto 不干活。
   *
   * 为什么这里不看 autoStopped:切回 auto 时它本来就会被清掉(见 onLampClick),
   * 拿它判会让「刚下播、tick 还没跑到」的一瞬被误判成走 force。
   */
  function offResumesAuto() {
    return liveState === 'prelive';
  }

  /** 灯色 —— 三色映射表(方案稿第七节的判据就落在这里) */
  function lampColor() {
    if (slowRetry) return 'gray';                 // 真故障:灰(慢速重试中)
    if (mode === 'force') return 'orange';        // 强制:开播也刷
    if (mode === 'off') return 'gray';            // 手动停
    // auto:只在「未开播、且没因开播自动停」时是绿
    return autoEffective() ? 'green' : 'gray';
  }

  /** 灯该不该在 —— 开关开着就常驻(慢速重试时也留着,用灰 + 悬停说明交代) */
  function needLamp() {
    return enabled();
  }

  /**
   * 悬停说明(拍板 ② 定稿:两种灰要分开写)。
   * 只改 title,不写别的 DOM —— 平时完全不出现,不抢注意力。
   */
  function lampTitle() {
    if (slowRetry) return '暂时找不到刷新按钮，正在重试（每 30 秒）· 点一下切换到「强制刷新」';
    if (mode === 'force') return '强制刷新中（开播也刷，每 10 秒）· 点一下切换到「不刷」';
    if (mode === 'off') {
      // #103:auto 档此刻不干活时,点灰灯就该给橙,别说「恢复自动」再原地不动
      return offResumesAuto()
        ? '你已手动停止 · 点一下回到「自动」'
        : '你已手动停止 · 点一下改为「强制刷新」';
    }
    if (liveState === 'prelive' && !autoStopped) {
      return '未开播，自动刷新中（每 10 秒）· 点一下切换到「强制」';
    }
    if (autoStopped && liveState === 'live') {
      return '已开播，自动停刷 · 点一下改为强制刷新';
    }
    // 剩下的就是判不出
    return '状态未知，已暂停 · 点一下改为强制刷新';
  }

  /**
   * 画灯。
   *
   * ★ 只在**真的变了**才写 DOM:主循环 250ms 一拍,若每拍都写属性,
   *   就是在平台页面上每 250ms 制造一次 DOM 变更(平台若挂了 MutationObserver
   *   会被刷屏式触发)。灯色与 title 平时几秒才变一次,绝大多数拍什么都不写。
   */
  function paintLamp() {
    if (!lamp) return;
    var c = lampColor();
    if (lamp.getAttribute('data-c') !== c) lamp.setAttribute('data-c', c);
    var t = lampTitle();
    if (lamp.title !== t) lamp.title = t;
  }

  function ensureLamp(btn, readings) {
    btn = btn || findRefreshBtn(readings);
    if (!btn) return false;   // 找不到 ⇒ 交给 tick 撤灯

    ensureStyle();

    /* ★ 落点版本校验:页面上那盏灯若是**旧版本**挂的,直接拆掉重建。
     *   开发期改过灯的结构 / 尺寸 / 类名之后,不刷新页面的用户手里那盏旧灯
     *   会一直停在旧参数上 —— 修好的判据对它不起作用。 */
    if (lamp && lamp.isConnected && lamp.getAttribute(MARK_ATTR) !== MARK_VER) {
      try { lamp.remove(); } catch (e) { /* 尽力而为 */ }
      lamp = null;
    }

    if (!lamp || !lamp.isConnected) {
      lamp = document.createElement('span');
      lamp.className = LAMP_CLASS;
      lamp.setAttribute(MARK_ATTR, MARK_VER);

      /* 圆钮内容:中间静态刷新图标 + 右上角状态灯。
         图标用 innerHTML 一次性写好 —— 这是**我们自己的**节点,
         不含任何用户数据,也不参与平台的 DOM。 */
      lamp.innerHTML =
        '<svg class="dyc-ar-ico" viewBox="0 0 16 16" fill="none" stroke="currentColor"' +
        ' stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">' +
        '<path d="M2.6 6.2A5.6 5.6 0 0 1 13 5.2"/><path d="M13.4 2.6v3h-3"/>' +
        '<path d="M13.4 9.8A5.6 5.6 0 0 1 3 10.8"/><path d="M2.6 13.4v-3h3"/></svg>' +
        '<i class="dyc-ar-dot"></i>';

      /* 点灯 = 切档。按**档位**走,不按颜色走(拍板 ① 定稿)——
       * 所以「灰」有两种来路,点一下的结果不同。 */
      lamp.addEventListener('click', function (e) {
        // 只在自己身上停冒泡 —— 别让这次点击冒到平台页面上去
        e.preventDefault();
        e.stopPropagation();
        onLampClick();
      });
      lamp.addEventListener('pointerdown', function (e) {
        e.stopPropagation();
      });
    }

    return placeLamp(btn, readings);
  }

  function removeLamp() {
    if (lamp && lamp.parentElement) {
      try { lamp.parentElement.removeChild(lamp); } catch (e) { /* 尽力而为 */ }
    }
    lamp = null;

    var st = document.getElementById(STYLE_ID);
    if (st && st.parentElement) st.parentElement.removeChild(st);
  }

  /** 只摘灯、保留 style(下次还要用) —— removeLamp 会连 style 一起摘 */
  function hideLamp() {
    if (lamp && lamp.parentElement) {
      try { lamp.parentElement.removeChild(lamp); } catch (e) { /* 尽力 */ }
    }
    lamp = null;
  }

  /* ---------- 点一下灯 ---------- */

  var lastClickAt = 0;

  /**
   * 点灯切档 —— **按档位走**(拍板 ① 定稿):
   *   橙(强制)               → 灰(你手动停)
   *   灰(你手动停的)          → 绿(未开播)/ 橙(直播中或判不出)
   *   绿 / 灰(自动·已开播或判不出) → 橙(强制)
   *
   * ★ 关键一条:「灰·自动停」→ 橙,不是 → 绿。
   *   因为已开播时绿本身就显示为灰,变绿等于没反应;而用户此时点它,
   *   本意几乎一定是「我要它刷」⇒ 一步到位给橙。
   *
   * ★ #103 补充:同理,「灰·手动停」在直播中也不能 → 绿 ——
   *   auto 档在直播中不干活,切过去灯色不变,用户会以为点了没反应。
   */
  function onLampClick() {
    var t = now();
    if (t - lastClickAt < 600) return;   // 去抖
    lastClickAt = t;

    if (mode === 'force') {
      mode = 'off';
      say('已暂停', 'info', { source: '自动刷新', keepHistory: false });
    } else if (mode === 'off') {
      /* #103:能不能回 auto,取决于 auto 档**此刻是否干活**,而不是「从哪来」。
       *   未开播 ⇒ auto(绿,恢复自动);
       *   直播中 / 判不出 ⇒ force(橙)—— 这两态 auto 都是「灰且不刷」的死路,
       *   切过去灯色零变化、语音还会说「恢复自动」,与事实矛盾(用户反馈原话)。 */
      var backToAuto = offResumesAuto();
      mode = backToAuto ? 'auto' : 'force';
      autoStopped = false;
      resetLiveJudge();          // 用户刚点了灯：别背着上一段的「判不出」计数
      scheduleNext();
      say(backToAuto ? '恢复自动' : '强制刷新', 'info', { source: '自动刷新', keepHistory: false });
    } else {
      mode = 'force';
      autoStopped = false;
      scheduleNext();
      say('强制刷新', 'info', { source: '自动刷新', keepHistory: false });
    }

    if (needLamp()) ensureLamp(); else hideLamp();
    paintLamp();
  }

  /* ---------- 主循环 ---------- */

  function scheduleNext() {
    var base = slowRetry ? RETRY_INTERVAL_MS : INTERVAL_MS;
    nextAt = now() + base + (Math.random() * 2 - 1) * JITTER_MS;
  }

  function canRefresh() {
    if (!enabled()) return false;
    if (mode === 'off') return false;
    if (mode === 'auto' && (liveState !== 'prelive' || autoStopped)) return false;
    if (now() < startedAt + START_DELAY) return false;
    if (now() < busyUntil) return false;
    if (document.hidden) return false;
    if (typingRecently()) return false;
    if (popupOpen()) return false;
    return true;
  }

  /**
   * 一次失败:计数,**并把这轮的间隔往后推**(下一轮按 slowRetry 决定是 10 秒还是 30 秒)。
   *
   * ★ 为什么失败也要 scheduleNext():
   *   主循环是 250ms 一拍,触发条件是「nextAt <= now」。若失败时不推 nextAt,
   *   下一拍又满足条件 ⇒ 立刻重试 ⇒ 750ms 内就连败 3 次直接进慢速重试,
   *   而真机上「找不到按钮」往往只是页面正在重渲染。推后一次间隔,
   *   三次失败就摊到 ~30 秒里,才是「连续三次真的点不到」。
   *
   * 连败满 FAIL_LIMIT ⇒ 转**慢速重试**(不是停机):每 30 秒轻试一次,
   * 按钮一回来就自动恢复。理由见文件头。
   */
  function failOnce() {
    failCount++;
    if (failCount >= FAIL_LIMIT && !slowRetry) {
      slowRetry = true;
      if (!retrySaid) {
        retrySaid = true;
        // 异常要留档(进消息盒)
        say('暂时找不到刷新按钮，正在重试', 'error', { source: '自动刷新' });
      }
    }
    scheduleNext();
  }

  function doRefresh() {
    var btn = findRefreshBtn();
    if (!btn) { failOnce(); return false; }

    // 上一轮还没完,不叠 —— 不算失败
    if (refreshBusy(btn)) { scheduleNext(); return false; }

    // 尺寸塌成 0(藏在未激活页签里)⇒ 真异常
    if (!refreshUsable(btn)) { failOnce(); return false; }

    /* 五点采样(防被浮层盖住)**只在按钮本来就在视口里时才跑** ——
     * 视口外的点会被逐个跳过,那时这个判据既无意义又会产生假阴性。
     * 滚出画面 ⇒ 直接跳过这一步,照点不误。 */
    var r = btn.getBoundingClientRect();
    if (inViewport(r, window.innerWidth, window.innerHeight) && !clickable(btn)) {
      failOnce();
      return false;
    }

    clickRefresh(btn);
    failCount = 0;

    // 慢速重试期间点到了 ⇒ 立刻恢复正常节奏并报一声
    if (slowRetry) {
      slowRetry = false;
      retrySaid = false;
      say('已恢复，自动刷新中', 'success', { source: '自动刷新' });
    }

    busyUntil = now() + 1200;   // 这一小段内不叠加下一轮
    scheduleNext();
    return true;
  }

  function tick() {
    if (!enabled()) return;

    tickCount++;

    // ① 每 2 秒判一次直播状态(带「连续 3 次才认判不出」的确认)
    if (tickCount % JUDGE_EVERY === 1) {
      var prev = liveState;
      judgeLive();

      if (prev !== liveState) {
        if (liveState === 'live' && mode === 'auto') {
          // 开播 ⇒ 自动停(事后会想知道 ⇒ 进盒子)
          autoStopped = true;
          say('已开播，自动停', 'success', { source: '自动刷新' });
        } else if (liveState === 'prelive') {
          unknownSaid = false;          // 状态恢复 ⇒ 允许下一次失效时再提醒一次
          if (autoStopped) {
            autoStopped = false;
            scheduleNext();
          }
        } else if (liveState === 'unknown') {
          /* 判不出(共享模块已连续 MISS_LIMIT 次判不出)⇒ 停,只提醒不进盒子。
           * 两个条件同时满足才说:
           *   ① 已过启动延迟(3 秒)—— 页面刚加载时横幅还没渲染,此时判不出属正常;
           *   ② 这一段失效还没说过 —— 免得每 2 秒重复一遍。 */
          if (!unknownSaid && now() > startedAt + START_DELAY) {
            unknownSaid = true;
            say('状态未知，已暂停', 'info', { source: '自动刷新', keepHistory: false });
          }
        }
      }
    }

    // ② 灯该不该在;在就跟着原生按钮走(平台重排 / 滚动 / 缩放都会动它)
    if (needLamp()) {
      // 只在本拍内复用矩形，下一拍仍实时验证节点及位置。
      var readings = [];
      var b = findRefreshBtn(readings);
      if (b) {
        lampMissAt = 0;
        if (!ensureLamp(b, readings)) hideLamp();
      } else if (lamp) {
        /* 2026-10-27(用户:「不要因为右上角的小框框弹出就隐藏」):
         * 平台一重渲染,按钮节点会短暂消失一两拍;以前这里是**立刻摘灯**,
         * 摘了下一拍又建 —— 用户看到的就是「抖一下没了 / 又回来了」。
         * 现在给 900ms 宽限:节点真走了(切页/换 tab)照样摘,只是别为一次重排闪。 */
        if (!lampMissAt) lampMissAt = now();
        if (now() - lampMissAt > LAMP_MISS_GRACE) hideLamp();
      }
    } else if (lamp) {
      hideLamp();
    }

    // ③ 到点了就刷(用户正拖着循环讲解的滑条 / 福袋抽屉正开着时本轮顺延:
    //    刷新会派发合成点击并重排列表 —— 拖滑条会被刷断,读福袋抽屉会被刷乱)
    if (nextAt <= now() && canRefresh()) {
      if (bagBusy() || (window.__dycUserDragUntil && Date.now() < window.__dycUserDragUntil)) {
        nextAt = Date.now() + 600;          // 600ms 后再看,松手/关抽屉就补上这一轮
      } else {
        doRefresh();
      }
    }

    paintLamp();
  }

  /* ---------- 启停 ---------- */

  function enabled() {
    return !!flags && flags.liveAutoRefresh !== false;
  }

  function start() {
    if (loopTimer) return;
    if (!enabled()) return;
    slowRetry = false;
    retrySaid = false;
    startedAt = now();
    scheduleNext();
    liveState = 'unknown';
    resetLiveJudge();
    autoStopped = false;
    failCount = 0;
    unknownSaid = false;

    /* 首判(页面进来 1.2 秒时):只判状态 + 尝试挂灯,**不报「状态未知」**。
     *
     * 为什么不报:刚进页面时平台自己的横幅往往还没渲染出来,这一拍判不出是
     * 很正常的。在这里就喊「已暂停」等于对用户误报。
     * 「状态未知」一律交给主循环 —— 它只在**过了启动延迟(3 秒)仍判不出**时才说。 */
    setTimeout(function () {
      if (!enabled()) return;
      judgeLive();
      if (needLamp()) ensureLamp();
      paintLamp();
    }, 1200);

    loopTimer = setInterval(tick, TICK_MS);
  }

  function stop() {
    if (loopTimer) { clearInterval(loopTimer); loopTimer = null; }
    removeLamp();
    savedScroll = null;
    nextAt = 0;
  }

  /* ---------- 开关联动 ---------- */

  dycReadFlags().then(function (f) {
    flags = f;
    prevOn = enabled();
    if (prevOn) start();
  });

  dycWatchFlags(function (f) {
    flags = f;
    var nowOn = enabled();
    if (prevOn !== null && nowOn !== prevOn) {
      say(nowOn ? '已开启' : '已关闭', 'info', { source: '自动刷新', keepHistory: false });
    }
    prevOn = nowOn;
    if (nowOn) start();
    else stop();
  });

  /* ---------- 窗口尺寸变化:重新量一次坐标 ---------- */
  window.addEventListener('resize', function () {
    if (!lamp) return;
    resetSettle();          // 布局一定变了 ⇒ 别让旧坐标挡两拍
    var b = findRefreshBtn();
    if (b) placeLamp(b); else hideLamp();
  }, { passive: true });

  /* ---------- 页面变化时补挂 ----------
   * 不做常驻 MutationObserver(每 10 秒刷一次本身就带重渲染,MutationObserver
   * 会被刷屏式触发)。改用主循环里的 placeLamp 兜住 —— 250ms 一拍足够快,
   * 且开销恒定。 */
})();
