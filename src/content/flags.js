/**
 * 功能开关:定义层 + 读取层(内容脚本与弹窗共用)
 *
 * ★★ 这里是功能开关的**唯一真源** ★★
 *
 *   「加一个功能」的标准动作(三步,互不干扰):
 *     1. 在下面 DYC_FLAGS_META 里追加一项(键名 / 分组 / 标题 / 说明 / 默认值 / 作用页)
 *     2. 自己的功能脚本里用 dycReadFlags() 读值、dycWatchFlags() 订阅变化
 *     3. 把脚本文件加进 manifest.json 的 js 数组
 *   弹窗会自动多出一行开关(含分组框、标题、说明、控件),
 *   **不需要改 popup.html,也不需要改 popup.js**。
 *
 * 为什么这样设计(2026-10-11):
 *   原本开关信息硬编码在三个地方 —— 本文件的默认值表、popup.html 的开关行、
 *   popup.js 的元素引用与事件绑定。加一个开关要同时改三个文件,
 *   多会话并行开发时必然在同一处代码打架(git 冲突)。
 *   收敛成一张元数据表之后,新功能各写各的文件,合并时不再冲突。
 *
 * 存储位置:
 *   · 功能开关统一存 chrome.storage.local 的 dybFeatures 对象
 *     { clearStock: true, liveLocate: true, cursorFix: true }
 *   · 调试模式单独一个键 dybDebug(历史遗留,换键会丢掉老用户已有设置)
 *
 *   **缺省即默认值** —— 老用户升级后 storage 里根本没有这个键,
 *   读出来直接落回默认值,因此不需要任何迁移代码,
 *   也不会因为「键不存在」而误把功能关掉。
 *
 * 默认值口径:
 *   调试模式与搜索扫描白幕默认关闭,其余开关默认开启。
 *
 * 加载顺序:必须在其它内容脚本之前(见 manifest.json 的 js 数组)。
 *   这里刻意用 var + function 声明而非 let/const,
 *   确保绑定落在全局对象上,后续脚本才能取到。
 */

/* ==========================================================
 * 一、页面匹配
 *
 * 中控台有两个域名入口(2026-10-11 补):
 *   抖店       fxg.jinritemai.com/ffa/content-tool/live/control  (商家)
 *   巨量百应   buyin.jinritemai.com/dashboard/live/control       (达人)
 * 两处都要认,否则在百应页面拨开关会说「暂无已打开的相关页面」。
 *
 * ⚠️ 新增页面入口时,要同步改的地方见 AGENTS.md「页面匹配」一节:
 *   manifest.json 的 content_scripts[].matches 与 host_permissions、
 *   锚点探针正则、这里的作用页正则。漏一处就会出现「有的页面行、有的页面不行」。
 * ========================================================== */

var DYC_PAGE_PATTERNS = {
  // 商品列表页(抖店)
  list: /^https:\/\/fxg\.jinritemai\.com\/ffa\/g\/list/,
  // 直播中控台(两个入口都算)
  liveCtrl:
    /^https:\/\/(?:fxg\.jinritemai\.com\/ffa\/content-tool\/live\/control|buyin\.jinritemai\.com\/dashboard\/live\/control)/,
  // 抖店全域(2026-10-14 用户定:「智能助手」与「反馈入口」全抖店都有,
  // 「隐藏页面元素」要跟着铺开;用户原话「jinritemai.com 这个统称抖店」)。
  // ★ 判据是**整个 jinritemai.com 域名族**(任意子域,含将来新增的),
  //   而不是枚举子域 —— 已见的有:
  //     fxg      抖店主站(商家后台)
  //     buyin    巨量百应(达人侧)
  //     compass  电商罗盘(商品概览 / 直播概览,用户用得最多)
  //     千川 / 学堂等其它子域同样按抖店算
  //   枚举写法的毛病是「平台加一个子域就得回来改代码」,而用户要的是「全抖店」。
  // 末尾用负向先行断言**排除中控台两个入口**:那边有自己的一整套控件
  // (序号定位/搜索/两枚浮动钮),而且「中控台智能助手」是独立勾选项 ——
  // 不排除的话,用户取消勾选「中控台智能助手」却仍勾着「抖店智能助手」时,
  // 抖店那两条规则会顺手把中控台的助手也隐掉(勾选与实际行为对不上)。
  // 橱窗商品管理页(2026-11-06 新增):buyin.jinritemai.com/dashboard/shopwindow/*
  //   「粘贴加橱窗」的作用页。⚠️ 必须排在 shopAll **之前** —— pageKind() 按声明
  //   顺序先匹配先返回,而 shopAll 只排除了中控台两个入口,会把本页吃成「抖店其他页」。
  //   本页**仍属 shopAll**:隐藏页面元素等全域开关走的是独立正则测试
  //   (hide-elements.js 的 pageMatch),与这里的先后顺序无关。
  shopWindow:
    /^https:\/\/buyin\.jinritemai\.com\/dashboard\/shopwindow\//,
  // 抖店「商品发布 / 商品编辑」页(2026-11-08 新增,剪贴板粘贴与智能填写的作用页)
  //   地址形态:fxg.jinritemai.com/ffa/g/create?product_id=…&cid=…&entrance=edit|new
  //   —— **新建**与**编辑**是同一个路径,只靠 query 区分(entrance),故正则只认路径。
  //   ⚠️ 必须排在 shopAll **之前**:diag.js 的 pageKind() 按声明顺序先匹配先返回,
  //      排在后面的话本页永远只报「抖店其他页」,诊断报告里看不出用户在哪一页。
  //   ⚠️ 本页**仍属 shopAll**(「隐藏页面元素」等全域开关照旧生效);
  //      manifest 侧由单独一条 content_scripts 承载,并把本路径写进全域条目的
  //      exclude_matches,避免 flags.js / hide-elements.js 被重复注入两次。
  goodsEdit:
    /^https:\/\/(?:[a-z0-9-]+\.)*jinritemai\.com\/ffa\/g\/create/,
  shopAll:
    /^https:\/\/(?:[a-z0-9-]+\.)*jinritemai\.com\/(?!ffa\/content-tool\/live\/control|dashboard\/live\/control)/,
  // 电商罗盘「直播明细」页(2026-10-15 反馈 #84 新增,方案乙):
  //   抖店侧 /shop/live-detail、达人侧 /talent/live-statement —— 两条路径**不同**,
  //   是两个独立页面(真机实测结构同构:抖店 aurora- / 达人 ecom- 两套主题前缀,
  //   商品信息列均 252px、名称均 line-clamp:2、行内均无平台复制按钮)。
  //   ⚠️ 本页**仍属 shopAll**(要继续保留「隐藏页面元素」),这条只给
  //      「直播明细货号按钮」当作用页;manifest 侧由**单独一条 content_scripts**
  //      承载本页功能,并把这两条路径写进全域条目的 exclude_matches,
  //      避免 flags.js / hide-elements.js 被重复注入两次。
  // 电商罗盘「商品列表」与「商品卡列表」两页(2026-10-18 反馈 #95 新增):
  //   /shop/commodity/product-list   商品列表(标题「商品列表-抖音电商罗盘」)
  //   /shop/merchandise-traffic      商品卡列表(标题「商品卡列表-抖音电商罗盘」,
  //                                  即用户口中的「商品销量榜」)
  //   两页都是 aurora 表格(aurora-table-tbody / 测量行 aurora-table-measure-row),
  //   用户 2026-10-18 明确「这两个网页都要兼容这个功能,就是跟直播明细页的逻辑是一样的」
  //   —— 名称完整显示 + 「货号」复制按钮,由 src/live/compass-table.js 承载。
  //   与 compassLive 同样属 shopAll(继续保留「隐藏页面元素」),
  //   manifest 侧由**单独一条 content_scripts** 承载,并写进全域条目的 exclude_matches,
  //   避免 flags.js / hide-elements.js 被重复注入两次。
  compassTable:
    /^https:\/\/compass\.jinritemai\.com\/shop\/(?:commodity\/product-list|merchandise-traffic)/,
  compassLive:
    /^https:\/\/compass\.jinritemai\.com\/(?:shop\/live-detail|talent\/live-statement)/,
  // 巨量百应「橱窗商品管理」页(2026-11-06 新增):商品名完整展示 + 复制货号。
  //   用户原话:「这个页面要做商品名称不隐藏，还有复制货号的功能」。
  //   本页**仍属 shopAll**(「隐藏页面元素」等全域开关照旧生效),
  //   这里单独立 key 只为把开关的作用页说清楚,并给 manifest 的单条注入当依据。
  //   ⚠️ 刻意排在 shopAll **之后**:diag.js 的 pageKind() 按声明顺序先匹配先返回,
  //      排在前面会让所有抖店子域页面的诊断报告从「抖店其他页」改成这里,
  //      既有诊断记录与自测断言会集体漂移 —— 而这一条只是给弹窗判作用页用的,
  //      不需要参与页面归类。
  shopWindow:
    /^https:\/\/buyin\.jinritemai\.com\/dashboard\/shopwindow\//,
  // 说明:「电商罗盘 · 直播大屏」(/screen/live/*)在**页面归属**上由 shopAll 覆盖
  //   (全域正则只排除中控台两个入口),功能侧无需另立页面;
  //   之所以在 manifest 里给它**单独一条 content_scripts**,是因为本页要带
  //   dialog.js(状态条 / 消息盒子)与下面的回放跳转按钮,而全域轻量条目
  //   按设计只带 flags + hide-elements。
  //   ⇒ 页面「属于哪个模式」与「带哪些脚本」是两件事,不要混为一谈。
  //   ⚠️ 但「直播回放」这一套功能需要精确的两页判定,所以下面仍给它们立了
  //      两个 key —— 那是**功能作用域**,不是页面归属,与 shopAll 并行不冲突。

  // 直播回放 · 两个作用页(2026-10-18 用户定,方案 v2)。
  //   ① 直播服务平台 · 直播复盘
  //      anchor.douyin.com/anchor/review  —— 主播版复盘页
  //      liveservice.douyin.com/…         —— 直播服务平台主站(跳转按钮去这里)
  //      **只有这里做下载**(整场合成一个 MP4)。
  //      两个域名都要:用户 2026-10-18 反馈「在直播服务平台上没看到下载按钮」,
  //      原因是当时只认 anchor.douyin.com —— 而跳转按钮把人送到 liveservice。
  //   ② 电商罗盘 · 直播大屏专业版         compass.jinritemai.com/screen/live/*
  //      注意它**不是** compassLive 那两条路径(那是直播明细),是「直播大屏」。
  //      **这一页不做下载**(用户 2026-10-18 改口径),只放一枚跳转按钮。
  // ⇒ 拆成两个 key:开关各管一页,开关文案才说得清自己在管什么。
  // ⚠️ 2026-10-18 补充:**这里是「功能作用域」,不是「注入范围」**。
  //    manifest 里那一条 content_scripts 已扩到 anchor.douyin.com/* ——
  //    因为这套后台切页走 history.pushState,不刷新页面,而 content_scripts
  //    只在导航时注入;若注入范围也卡死在 /anchor/review,从别的页点进来
  //    切到复盘页时根本没有脚本可用(用户 2026-10-18 报的正是这个)。
  //    注入放宽后由 replay-download.js 的 pageKind() 每拍判一次,
  //    非复盘页不挂按钮、连左下角绿标记一起收掉。
  replayPage:
    /^https:\/\/(?:anchor\.douyin\.com\/anchor\/review|liveservice\.douyin\.com\/)/,
  liveScreenPage:
    /^https:\/\/compass\.jinritemai\.com\/screen\/live\//,
  // 调试作用页直接复用 manifest 注入范围，新增页面无需维护第二张表。
  debugTarget:
    { test: function (url) { return dycIsSupportedPage(url); } },
  // 渠道品管理列表页(2026-10-24 新增,计划 #1):
  //   单行「下架并删除」与批量「下架并删除」只作用于这一页。
  //   本页**仍属 shopAll**(「隐藏页面元素」等全域开关照旧生效),
  //   这里单独立 key 只为把开关的作用页说清楚(弹窗里「已应用到 N 个页面」)。
  channelGoods:
    /^https:\/\/fxg\.jinritemai\.com\/ffa\/g\/channel-goods-manage\/list/,
  // 活动广场(2026-10-25 新增,计划中功能 #1):勾选主商品时联动勾选渠道品。
  //   作用页判据取**整个 /ffa/merchant/ 模块**,而不只是
  //   /ffa/merchant/parent-campaign-detail —— 活动广场列表与父活动详情同属
  //   这个 SPA 模块,平台切换是 pushState(不刷新页面),content_scripts
  //   只在导航时注入;若把 matches 卡在详情页一条路径,从列表点进来的那次
  //   根本没有脚本可用(直播回放 2026-10-18 踩过同一坑)。
  //   manifest 侧由**单独一条 content_scripts** 承载本模块,并把
  //   `https://*.jinritemai.com/ffa/merchant/*` 写进全域条目的 exclude_matches,
  //   避免 flags.js / hide-elements.js 被重复注入两次。
  campaignSignup:
    /^https:\/\/fxg\.jinritemai\.com\/ffa\/merchant\//,

  /* ==========================================================
   * 微信小店 + 视频号助手(两个域:store / channels)—— 2026-10-30 新增,10-31 补域
   *
   * 本期**只铺基础设施**:左下角标记 / 调试模式 / 诊断 / 消息盒子。
   * 不带任何业务功能(清零、讲解、加车一律不做),这是用户定的范围:
   * 「先做调试模式 / 诊断 / 消息盒子,其他的不做,然后我要根据这个功能
   *   再开始加功能」。
   *
   * 三个键与抖店那套**刻意对称**,以后加功能直接往对应键上挂作用页:
   *   wxGoodsList ↔ list  微信小店商品列表(store/shop/goods/list)—— 2026-10-31 新增
   *   wxShop     ↔ list      微信小店后台(store.weixin.qq.com 整域)
   *   wxChannels ↔ liveCtrl  视频号助手(channels.weixin.qq.com 整域,含 /index、/platform)
   *   wxAll      ↔ shopAll   整域兜底(域级开关、隐藏元素、助手面板将来挂这里)
   *
   * ⚠️ wxGoodsList 必须排在 wxShop **之前**:pageKind() 按声明顺序「先匹配先返回」,
   *    wxShop 是整域前缀,排在前面就把商品列表吃成「微信小店后台」,诊断报告
   *    再也分不出具体页面。
   *
   * ⚠️ wxAll 必须排在两个具体键**之后** —— diag.js 的 pageKind() 按对象
   *    声明顺序「先匹配先返回」,反过来会让所有微信页都报成「其他页」。
   * ⚠️ 本域是典型 SPA:登录页→后台走前端路由,不刷新页面,而 anchor.js
   *    只在加载时判一次。所以**域级匹配必须宽**(wxAll 覆盖整域) ——
   *    否则用户在扫码登录页注入、登录后路由一变就成了「非作用页」,
   *    标记和面板会一起消失。这不是冗余,是 SPA 的必要放宽。
   * ⚠️ 前缀匹配不加尾部断言,与抖店几个键的口径一致(/shop、/index 之后
   *    可能是子路径、查询串或 hash,平台随时会调,卡死等于给未来埋雷)。
   * ========================================================== */
  wxGoodsList:
    /^https:\/\/store\.weixin\.qq\.com\/shop\/goods\/list/,
  wxGoodsEdit:
    /^https:\/\/store\.weixin\.qq\.com\/shop\/goods\/entry(?:[/?#]|$)/,
  wxShop:
    /^https:\/\/store\.weixin\.qq\.com\//,
  wxChannels:
    /^https:\/\/channels\.weixin\.qq\.com\//,
  wxAll:
    /^https:\/\/(?:store|channels)\.weixin\.qq\.com\//,
  fxgShop: /^https:\/\/fxg\.jinritemai\.com\//,
};

/* ==========================================================
 * 二、分组(弹窗里的三个框)
 *    颜色定义在 popup.html 的 CSS(.group-live / -shop / -other)
 * ========================================================== */

var DYC_FLAG_GROUPS = [
  { id: 'live', title: '中控台' },
  { id: 'shop', title: '抖店' },
  { id: 'wx', title: '微信小店' },   // 2026-10-31 新增:微信侧第一个业务功能落地
  { id: 'other', title: '其他' },
  { id: 'shared', title: '通用' },
  { id: 'xhsShop', title: '小红书千帆', placeholder: '功能接入后在这里显示' },
  { id: 'xhsHome', title: '小红书主页', placeholder: '功能接入后在这里显示' }
];

/* ==========================================================
 * 二·五、平台分组（2026-10-31 用户定）
 *
 * 「插件名统一叫可可助手」+ 弹窗顶部加平台切换：抖音类 ⇄ 微信小店类。
 * 这里回答两件事——**哪些分组归哪个平台**、**哪个网址算哪个平台**。
 *
 * 为什么把归属写成 groups 数组、而不是在 DYC_FLAG_GROUPS 上加 platform 字段：
 *   分组与平台是多对多关系（将来某个分组可能两个平台共用），写在一处才
 *   不会出现「分组说自己是抖音、平台表却没收它」这种自相矛盾。
 *   ★ groups 是唯一真源。自测会断言 DYC_FLAG_GROUPS 里每个 id 都被某个
 *     平台认领 —— 漏一个，那组在弹窗里永远不会出现。
 *
 * urlRe 的边界（与 manifest 的 content_scripts / host_permissions 对齐）：
 *   宽一格只是把用户送进一个空平台；窄一格会让微信后台里弹窗卡在抖音态。
 *   ⚠️ 2026-10-31 踩过：微信小店是 store.weixin.qq.com，视频号助手是
 *   channels.weixin.qq.com，**两套应用**，缺一个就有用户「连标记都没有」。
 *   微信侧直接复用 DYC_PAGE_PATTERNS.wxAll（域级键），不再另写一份 ——
 *   两份正则必然漂移，而 wxAll 已经在内容脚本里承担同样的判定。
 *
 * ★ 新增平台（淘宝 / 快手 / 小红书…）只改这里 + DYC_FLAG_GROUPS，**不动 popup 样式**。
 *   弹窗布局与平台数量完全解耦：功能少的平台自动「中间留空、页脚黏底」，
 *   功能多的自动「滚到底才见页脚」—— 同一行 margin-top:auto 产生两种表现。
 *   详见 AGENTS.md 第 27 条；守卫是 scripts/自测-弹窗面板.js（禁止平台专属样式）。
 * ========================================================== */

var DYC_PLAT_DY_URL_RE =
  /^https:\/\/(?:(?:[a-z0-9-]+\.)*jinritemai\.com|anchor\.douyin\.com|liveservice\.douyin\.com)\//;

var DYC_PLATFORMS = [
  {
    id: 'dy',
    label: '抖音',
    mark: '抖', color: '#222633', status: '已支持',
    // 「其他」归抖音侧：里面的直播回放 / 大屏跳转 / 明细跳转都只作用于抖音页面，
    // 微信态下拉出来点不动，只会让人以为坏了（2026-10-31 用户认可该分法）。
    groups: ['live', 'shop', 'other', 'shared'],
    urlRe: DYC_PLAT_DY_URL_RE
  },
  {
    id: 'wx',
    label: '微信',
    mark: '微', color: '#18a967', status: '已支持',
    groups: ['wx', 'shared'],
    urlRe: DYC_PAGE_PATTERNS.wxAll
  },
  {
    id: 'xhs', label: '小红书', mark: '红', color: '#ef3457', status: '待接入',
    groups: ['xhsShop', 'xhsHome'],
    urlRe: /^https:\/\/(?:[a-z0-9-]+\.)*xiaohongshu\.com\//
  },
  {
    id: 'ks', label: '快手', mark: '快', color: '#f17a33', status: '暂无功能',
    groups: [],
    urlRe: /^https:\/\/(?:[a-z0-9-]+\.)*(?:kuaishou|kwaixiaodian)\.com\//
  },
  {
    id: 'tb', label: '淘宝', mark: '淘', color: '#f27623', status: '暂无功能',
    groups: [],
    urlRe: /^https:\/\/(?:[a-z0-9-]+\.)*taobao\.com\//
  }
];

/** 这个网址属于哪个平台；认不出返回 ''（由弹窗回落到上次记住的平台）。 */
function dycDetectPlatform(url) {
  var u;
  try { u = new URL(String(url || '')).href; } catch (_) { return ''; }
  for (var i = 0; i < DYC_PLATFORMS.length; i++) {
    if (DYC_PLATFORMS[i].urlRe.test(u)) return DYC_PLATFORMS[i].id;
  }
  return '';
}

/** Chrome 页面匹配规则；不将 host_permissions 中的更新源当成业务页面。 */
function dycMatchPagePattern(pattern, url) {
  var p = /^(\*|https?):\/\/([^/]+)(\/.*)$/.exec(pattern);
  var u;
  try { u = new URL(url); } catch (_) { return false; }
  if (!p || !/^https?:$/.test(u.protocol) || (p[1] !== '*' && u.protocol !== p[1] + ':')) return false;
  var host = p[2];
  if (host !== '*' && u.hostname !== host && !(host.indexOf('*.') === 0 &&
      (u.hostname === host.slice(2) || u.hostname.endsWith('.' + host.slice(2))))) return false;
  var path = p[3].split('*').map(function (s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }).join('.*');
  return new RegExp('^' + path + '$').test(u.pathname + u.search);
}

/** 消息、调试、弹窗与后台历史统一使用实际注入范围。 */
function dycIsSupportedPage(url) {
  // 无扩展运行时的离线工具仍可复用平台定义；真实扩展以 manifest 为准。
  if (typeof chrome === 'undefined' || !chrome.runtime || typeof chrome.runtime.getManifest !== 'function') {
    return !!dycDetectPlatform(url);
  }
  try {
    return (chrome.runtime.getManifest().content_scripts || []).some(function (cs) {
      return cs.world !== 'MAIN' && (cs.matches || []).some(function (p) { return dycMatchPagePattern(p, url); }) &&
        !(cs.exclude_matches || []).some(function (p) { return dycMatchPagePattern(p, url); });
    });
  } catch (_) { return false; }
}

/** 平台 id → 它管的分组 id 数组（未知 id 返回空数组，调用方按"什么都不显示"处理）。 */
function dycPlatformGroups(platId) {
  for (var i = 0; i < DYC_PLATFORMS.length; i++) {
    if (DYC_PLATFORMS[i].id === platId) return DYC_PLATFORMS[i].groups;
  }
  return [];
}

/* ==========================================================
 * 三、开关元数据表(★ 加功能只改这里)
 *
 * 字段说明:
 *   key         在 dybFeatures 对象里的键名;也是弹窗控件 id 的来源
 *               (控件 id 统一为 flag-<key>)
 *   group       归属分组,取值见 DYC_FLAG_GROUPS
 *   platforms   (可选)平台白名单,取值见 DYC_PLATFORMS 的 id。
 *               默认不写 = 随分组显隐(分组归哪个平台就在哪个平台露)。
 *               写了 = **只管这一行的显隐**,与分组归属无关 ——
 *               用于「分组只归一个平台,但这一行两个平台都要用」的情形
 *               (现仅 goodsImagePaste:落在抖音专属的「其他」组,
 *                但微信小店商品编辑页也要它)。见 popup.js 的 applyPlatform()。
 *   label       弹窗里显示的功能名
 *   desc        弹窗里显示的一句话说明
 *   default     默认值(true = 默认开)
 *   pages       作用页(键名取自 DYC_PAGE_PATTERNS),用于「已应用到 N 个页面」反馈
 *   store       'feature'(默认,存 dybFeatures)/ 'debug'(存独立键 dybDebug)
 *   hidden      true = **不进弹窗**(仍是一个真开关:照常存 dybFeatures、照常有默认值、
 *               内容脚本照常读得到),只在功能自己的界面里改。
 *               注:唯一用过它的 autoLoopDefaultOn 已于 2026-10-27 整条删除(用户要求连
 *               面板里那枚开关一起去掉,行为改为「进页面恒开」),机制留着给以后需要时用。
 *
 * 数组顺序 = 弹窗里的显示顺序。
 * ========================================================== */

var DYC_FLAGS_META = [
  /* ──────────────────────────────────────────────────────────
   * 弹窗结构（2026-10-16「弹窗减噪」重排 → 2026-10-18「开关门控」二次重排）
   *
   * 层级字段：
   *   foldHost  —— 我是一级行，值 = 我展开的那个折叠组的名字。
   *                有 key 的（liveSearch / scrollBtns）右侧挂开关，它就是该组总闸；
   *                没 key 的才是纯分组行（现仅「更多设置」，见末条）。
   *   foldGroup —— 我收进哪个折叠组（值 = 宿主的 foldHost 值）。
   *   pinLast   —— 恒排所在折叠组（或全弹窗开关）末位，渲染时排序到组末。
   *
   * ★ 展开交互只有一条规则（2026-10-18 用户定，取代 10-16 的「开关是唯一入口」）：
   *     开关 = **门控**，名字 = **触发**。两级分工，互不抢动作：
   *       开关开  ⇒ 名字可点、显示下拉箭头、内容仍**保持收起**；
   *       开关关  ⇒ 箭头隐藏、名字变灰不可点、子项一并点不动；
   *       展开/收起 只由点名字决定，且**默认一律收起**。
   *   为什么改：旧规则「开关开 ⇒ 立即展开」遇上 5 个默认开的开关，
   *   每次打开弹窗都是三层折叠区连选项面板全部撑开（实测 ≈1011px，要滚 411px）。
   *   新规则下弹窗 ≈590px，一屏看完。
   *   适用全部带子内容的行：liveSearch / scrollBtns（一级行）、omniSearch、
   *   scanShade、hideElements、debug。状态驱动的初态实现在 popup.js 的 foldOpeners。
   * ────────────────────────────────────────────────────────── */

  /* ── 中控台 · 一级行「全能搜索」（放最顶，2026-10-16 用户定）──
   * liveSearch 是**父级总闸**:关掉它,浮动搜索框、全能搜索按钮、
   * 搜索扫描白幕会一起停用
   * （见 src/live/search.js 的 enabled() 与 omniEnabled()）。
   * 所以它渲染成一级行并在右侧挂开关,层级与代码一致。
   * 2026-10-16 弹窗减噪改名:原「中控台全能搜索」→「全能搜索」。
   */
  {
    key: 'liveSearch',
    group: 'live',
    label: '全能搜索',
    // 父开关只解释控制范围与关闭结果;子项配置详见各自面板与 README。
    desc: '增强商品搜索，支持款号、价格和多关键词。',
    // note 用**单串**而不是拼接:文案是产品对外的话,拆成两段既难核对
    // (自检脚本按单引号取值,拼接会让它只读到前半句),也容易漏改一半。
    note: '关闭后停用搜索增强和扫描白幕。',
    default: true,
    pages: ['liveCtrl'],
    foldHost: 'search'
  },

  /* ── 中控台 · 常显 ───────────────────────────────────── */
  {
    key: 'liveLocate',
    group: 'live',
    label: '中控台商品定位',
    desc: '在工具栏输入商品序号，定位到对应商品。',
    default: true,
    pages: ['liveCtrl']
  },
  {
    key: 'liveNameWrap',
    group: 'live',
    label: '商品名完整显示',
    desc: '小黄车商品名自动换行显示。',
    default: true,
    pages: ['liveCtrl']
  },
  {
    // 小黄车复制款号按钮(2026-10-15 用户定稿,反馈 #74 · 方案 ⑤)。
    // 2026-10-16 弹窗减噪改名:原「小黄车货号按钮」→「复制款号按钮」。
    // 平台自带「复制 ID」按钮**右侧并排**一枚小按钮,位置跟着平台那枚走,
    // **不覆盖平台原有的「点名称看详情」**;取号优先官方「货号」字段,
    // 取不到才按名称尾部推算(见 copy-code.js)。
    key: 'liveCopyCode',
    group: 'live',
    label: '复制货号按钮',
    desc: '点击商品旁的「货号」按钮，复制货号。',
    note: '未显示平台货号时，按名称末尾识别。',
    default: true,
    pages: ['liveCtrl']
  },

  /* ── 中控台 · 折叠组「页面滚动按钮」─────
   * 2026-10-18 改造：原为**纯分组行**（无 flag key、不写 storage、右侧不带开关）。
   * 现在补上了总闸 key `scrollBtns`，理由见计划栏 #90 与「开关门控」统一规则：
   * 全弹窗只剩它还得「点名字就能展开」，用户得学两套。
   *
   * 总闸语义（用户 2026-10-18 定，选「一键全关」）：
   *   · 关 ⇒ 两枚滚动钮一律不注入（不管各自子开关是什么状态）；
   *   · 再开 ⇒ 各子开关**按自己存的值**恢复，总闸不覆写子开关。
   *   ⇒ 于是总闸与子开关是「与」关系：实际生效 = scrollBtns && backToTop/bottom。
   *   这样做的代价说清楚：总闸关着时拨子开关，画面不会变化（要等总闸开）；
   *   好处是用户不必担心「我关了总闸，我原来的子开关设置被清掉了」。
   */
  {
    key: 'scrollBtns',
    group: 'live',
    label: '页面滚动按钮',
    // 父开关只解释控制范围与关闭结果,不罗列子项教程。
    desc: '显示回到顶部和滚到底部按钮。',
    note: '关闭后隐藏两类按钮，保留各按钮设置。',
    foldHost: 'scroll',
    default: true,
    pages: ['liveCtrl']
  },
  {
    key: 'backToTop',
    group: 'live',
    label: '上滑到顶',
    desc: '点击按钮，将页面和商品列表滚回顶部。',
    default: true,
    pages: ['liveCtrl'],
    foldGroup: 'scroll'
  },
  {
    key: 'backToBottom',
    group: 'live',
    label: '下滑到底',
    desc: '点击按钮，将页面和商品列表滚到底部。',
    default: true,
    pages: ['liveCtrl'],
    foldGroup: 'scroll'
  },

  {
    // 回车定位(2026-10-12 用户定,二十二轮;2026-10-18 二次改名)。
    // 沿革:原「全能搜索」→ 2026-10-16 改「全能搜索按钮」→ 2026-10-18 改「回车定位」。
    // 为什么不再叫「按钮」:这一行的主要作用是**决定回车按下去走哪条路**,
    // 按钮只是它的副产物(开关关掉时按钮也不出现)。名字按作用取,更好懂。
    // 档位存 dycOmnisearchMode(本开关开时生效),**两档单选**(2026-10-18 起):
    //   'none'   默认原生搜索 —— 回车走平台原生,全能只认按钮(默认)
    //   'always' 默认全能搜索 —— 回车直接走全能扫描
    // (原第三档 'trial3' 事不过三 已于 2026-10-18 用户决定整档删除;
    //  老存档里的 trial3 由读取侧白名单回落成 'none',不需要迁移脚本。)
    key: 'omniSearch',
    group: 'live',
    label: '回车搜索方式',
    // 用户 2026-10-18 原话:「问号也要改一下,写的默认回车键使用原生搜索」。
    desc: '选择按回车时使用平台搜索或全能搜索。',
    note: '关闭后隐藏全能搜索按钮，保留平台搜索。',
    default: true,
    pages: ['liveCtrl'],
    panel: 'omniSearch',
    foldGroup: 'search'
  },
  {
    // 搜索扫描白幕(2026-10-12 用户定):默认关 —— 关掉时扫描遮罩不出现,
    // 屏幕跟着扫描滚动(旧行为);开启后扫描期间盖不透明白幕(观感静止),
    // 并支持半透明档(40%,隐约看到列表在翻)。档位存 scanShadeMode:
    // 'opaque'(不透明白)/ 'translucent'(半透明40%),缺省 = 不透明白。
    // pinLast(2026-10-16 用户定):恒排「全能搜索」折叠组末位。
    key: 'scanShade',
    group: 'live',
    label: '搜索扫描白幕',
    desc: '扫描时遮住列表与滚动条，减少画面跳动。',
    note: '白幕可选不透明或半透明。',
    default: false,
    pages: ['liveCtrl'],
    foldGroup: 'search',
    pinLast: true
  },

  {
    /* 2026-10-18 改造：原属折叠组「更多设置」。
       该组只剩这一项 —— 为一个开关保留一层折叠入口（还多占一行 30px 的
       「更多设置（1）」标题），点开才看到一个开关，纯属多一次点击。
       按用户定「建议采纳」把它提为常显行，位置紧接两枚滚动钮之后。 */
    key: 'cursorFix',
    group: 'live',
    label: '拖拽猫爪光标',
    desc: '拖拽排序时显示猫爪光标，按住时爪子收拢。',
    default: true,
    pages: ['list', 'liveCtrl']
  },

  /* ── 抖店 ──────────────────────────────────────────── */
  {
    key: 'clearStock',
    group: 'shop',
    label: '商品库存清零',
    desc: '在商品列表中添加「清空库存」按钮。',
    note: '清零前确认，只处理各规格普通库存。',
    default: true,
    pages: ['list']
  },
  {
    // 罗盘直播明细「复制款号」按钮(2026-10-15 用户定,反馈 #84 · 方案乙)。
    // 2026-10-16 弹窗减噪改名:原「直播明细货号按钮」→「直播明细复制款号按钮」。
    //   作用页 = 抖店 /shop/live-detail 与达人 /talent/live-statement 两个入口。
    //   做两件事:① 商品名完整显示 —— 缩略图改左浮动、名称跨到图片下方,不再省略;
    //             ② 名称块**右下方**加一枚按钮。
    //   取号三档(官方货号 → 名称末尾推算 → 取不到不复制)与中控台 copy-code.js 同一套。
    //   分组放「抖店」:罗盘属抖店全域,不是中控台。
    key: 'compassCopyCode',
    group: 'shop',
    label: '直播明细复制货号',
    desc: '直播明细显示完整商品名，并添加货号复制按钮。',
    note: '无法识别时显示「无货号」。',
    default: true,
    pages: ['compassLive']
  },

  /* ── 微信小店（2026-10-31 第一个业务功能）───────────── */
  {
    // 商品名完整显示(用户 2026-10-31 提出)。
    // 微信小店商品列表把商品名截成一行加省略号(实测盒子 288×20、
    // 文本宽 321~447),想看全名只能点进详情。本开关让它自动换行。
    //
    // 只作用于商品列表页(wxGoodsList):这是本域第一个"单页"功能,
    // 不是整域开关 —— 所以没有像 wxAll 那样的兜底键。
    key: 'wxGoodsFullTitle',
    group: 'wx',
    label: '商品名完整显示',
    desc: '商品列表中的商品名自动换行显示。',
    note: '名称较长时，商品行会增高。',
    default: true,
    pages: ['wxGoodsList']
  },
  {
    // 商品行快捷复制(用户 2026-10-31):「加入复制货号的功能按钮……按钮放在
    // 名称的最后面」+「做一个【商品链接】的按钮,点了可以快速复制商品链接」。
    //
    // 两个按钮合成一个开关:都是「这一行文字旁边的快捷复制」,一起加、一起关。
    // 「货号」按商品名末尾的款号推算(微信小店列表没有「货号」字段);
    // 「复制链接」内部会短暂打开平台的分享面板读取链接 —— note 里写明。
    key: 'wxRowCopy',
    group: 'wx',
    label: '复制货号和链接',
    desc: '在商品行添加「货号」和「复制链接」按钮。',
    note: '无法直接复制时，打开操作面板。',
    default: true,
    pages: ['wxGoodsList']
  },

  /* ── 其他 ──────────────────────────────────────────── */
  {
    // 隐藏页面元素(2026-10-11 提出)。
    // 2026-10-16 弹窗减噪:分组由「中控台」改为「**其他**」(用户定)。
    // 2026-10-18 展开规则改为「开关门控 + 点名字展开」,默认收起。
    key: 'hideElements',
    group: 'other',
    label: '隐藏页面元素',
    desc: '隐藏勾选的页面区块，保存勾选后生效。',
    note: '取消勾选并保存，可恢复显示。',
    default: true,
    pages: ['liveCtrl', 'shopAll'],
    // panel:弹窗渲染完这行开关后,要在下面追加的面板类型。
    // 当前仅支持 'hideElements'(复选框清单 + 保存按钮),见 popup.js。
    panel: 'hideElements'
  },
  {
    // 调试模式。2026-10-31 起不再排「其他」组末尾，改为**固定沉到弹窗最底部**：
    // 它与版本号一起放进独立底栏（footer），切平台时位置完全不动。
    // 旧口径 pinLast(2026-10-16)随之作废 —— 那条只保证「排在组末」，
    // 组本身还会随内容上下漂。
    key: 'debug',
    group: 'other',
    label: '调试模式',
    // 2026-10-16 改口径:拨开关**不改写页面地址**(改地址 = 整页重载,
    // 会丢掉正在填的内容与滚动位置)。现在只写开关状态,页面侧订阅后就地生效。
    // 曾有一枚「加参数并刷新」按钮做地址改写,同日按用户要求删除 ——
    // 地址参数不再是进调试态的必经之路,故 urlRewrite 标记一并移除。
    // 2026-10-18:开关不再直接弹出面板,改成「点左下角标记才弹」——
    // 调试态常开时那块黑框一直压着左下角,用户反馈碍事。
    // 面板出现后独立常驻(不随消息盒子收起),收起只认面板自带的按钮。
    desc: '显示扩展调试信息，用于排查问题。',
    // 2026-10-18:原来面板顶部那段灰字提示已搬进这里（用户定「备注放进问号里」）。
    note: '开启后点击名称展开功能清单。',
    default: false,
    // 2026-10-30:作用页追加 wxAll —— 微信小店整域也能用调试模式。
    // 本期微信侧**只**铺了基础设施(标记/调试/诊断/消息盒子),没有业务开关,
    // 所以弹窗里唯一与微信页相关的一行就是这条;pages 不含它会导致
    // 「已应用到 N 个页面」在微信页恒为 0,用户会以为开关没生效。
    pages: ['debugTarget', 'wxAll'],
    store: 'debug',
    // inFooter(2026-10-31):这一行不进主体区，由 popup.js 渲染到固定底栏里。
    // ★ 它仍然在 DYC_FLAGS_META 里 —— 只是"换个位置落地"，
    //   所以存值、默认值、事件绑定、问号气泡全部照旧，一处没少。
    inFooter: true,
    // panel(2026-10-16):这个子菜单是一张**调试功能清单** ——
    //   ① 导出当前页结构(读「页面」的结构,写适配代码用)
    //   ② 复制诊断报告(读「扩展」的健康档案,纠错用;由页面侧实例跑,轨迹不丢)
    // 面板随总开关**开门**、随点名字**展开/收起**(2026-10-18 门控规则)。
    // hideElements / omniSearch / scanShade 与两个一级行 liveSearch / scrollBtns
    // 全部同一套规则(2026-10-18 起取代 10-16 的「开关是唯一入口」)。
    panel: 'debug'
  },
  {
    /* 直播回放下载（2026-10-18 用户定，方案 v2 定稿）。
     *
     * 作用页只有一处：直播服务平台 · 直播复盘  anchor.douyin.com/anchor/review
     * （原先还想在大屏页也做下载，用户 2026-10-18 改口径：**大屏不做下载**，
     *   大屏只放一枚「跳转直播服务平台」，下载统一回服务平台做。见下一个开关。）
     *
     * 做什么：视频右上角一枚「下载回放」，点开先出确认卡（场次/时长/体积/
     *   清晰度/文件名），确认后把**整场**合成**一个 MP4**，文件名按开播时间
     *   命名成「直播回放_2026.10.18_20点13分」（各段用 _ 连，不留空格）。
     *
     * 为什么默认**开**：这一页是用户主动进入的专用复盘页，
     *   功能也不会自动跑（必须点按钮才动），不存在「误触发」的可能。
     *   按工程约定「除调试模式外一律默认开」执行。
     *
     * 边界（写在这里，防止以后被越推越远）：
     *   · 只下当前页面对应的这一场，不做批量、不跟到别的场次；
     *   · 只存当前账号有权观看的内容；**不做去水印**、不改画面、不生成分享链接。
     * 分组放「其他」：它不属于中控台，也不属于抖店后台。
     */
    key: 'replayDownload',
    group: 'other',
    label: '直播回放下载',
    desc: '在直播复盘页下载整场 MP4 回放。',
    note: '仅限有权观看的场次，不去水印。',
    default: true,
    pages: ['replayPage']
  },
  {
    key: 'servicePlatformJump',
    group: 'other',
    label: '跳转服务平台',
    desc: '在直播大屏和直播明细页添加服务平台跳转按钮。',
    note: '下载回放需前往直播服务平台。',
    default: true,
    pages: ['liveScreenPage', 'compassLive']
  },/* ── 抖店 · 罗盘商品表(2026-10-18 反馈 #95 追加在末尾)─────────────
   * 用户原话:「商品卡、商品销量榜列表,都是需要加入商品名称扩展和快捷复制按钮」,
   * 并明确「这两个网页都要兼容这个功能,就是跟直播明细页的逻辑是一样的」。
   *
   * 作用页 = 罗盘 /shop/commodity/product-list(商品列表)
   *         罗盘 /shop/merchandise-traffic(商品卡列表 = 用户说的「商品销量榜」)。
   * 做两件事,与直播明细页同一套口径:
   *   ① 商品名完整显示(平台截断的一律放开,不动列宽);
   *   ② 名称附近一枚「货号」按钮,点一下复制款号。
   * 与 compassCopyCode **分开一个开关**的理由:这两页的结构只来自用户交来的
   * 《页面结构报告》(只采到骨架前 3 层),尚未真机验证 —— 万一某页不符,
   * 关它只停这一组,直播明细的功能不受牵连。
   */
  {
    key: 'compassTableCopyCode',
    group: 'shop',
    label: '罗盘商品表复制货号',
    desc: '商品列表和商品卡列表中添加货号复制按钮。',
    note: '优先平台货号，否则取名称末尾款号。',
    default: true,
    pages: ['compassTable']
  },

  {
    /* 小黄车自动刷新（2026-10-19 用户定，反馈 #92，方案评审稿同日 A A A A B A 定稿）。
     *
     * 为什么要有它：**未开播时平台不会自己刷新小黄车列表** ⇒ 库存款、卖出去的
     *   数量都不实时，得手动点【刷新列表】。开了播平台自己会刷，这时再刷就是
     *   双重刷新、列表反复重排（用户原话「实时刷新有可能会造成卡顿」）⇒ 必须自动停。
     *
     * 做什么：未开播期间每 10 秒点一次平台的【刷新列表】；**开播后自动停**；
     *   判不出直播状态也停（拿不准就不刷，见下）；运行期间在平台那枚按钮
     *   **左侧**挂一盏小灯当状态提示（平台按钮保持原样，不替换）。
     *
     * 三档手动接管（点小灯循环切换，只在本次页面有效）：
     *   自动 → 强制刷（开播也照刷，橙色）→ 已停（灰色）→ 自动。
     *   点平台按钮主体仍是「立刻刷一次」，这个职责必须留住。
     *
     * 为什么「判不出就不刷」：判错的两个方向代价不对称 ——
     *   把已开播误判成未开播 ⇒ 双方同时刷、反复重排（正是用户担心的卡顿），代价高；
     *   反过来只是退回手动点刷新，代价低。所以拿不准就选代价低的那边。
     *
     * 为什么默认开：这是用户明确要的自动化，且它自带「开播即停」与
     *   「判不出即停」两道闸；真正会被感知的风险已经收敛在保守一侧。
     */
    key: 'liveAutoRefresh',
    group: 'live',
    label: '小黄车自动刷新',
    desc: '未开播每 10 秒刷新列表，开播或状态未知时暂停。',
    note: '强制模式开播后仍会刷新。',
    default: true,
    pages: ['liveCtrl']
  },
  {
    /** 小黄车粘贴加车:商品链接、款号或标题尾款号;每次只处理一个剪贴板目标。 */
    key: 'cartPaste',
    group: 'live',
    label: '小黄车粘贴加车',
    desc: '读取商品链接、款号或商品名末尾款号，匹配后加车。',
    note: '匹配过多时不加车，避免误加。',
    default: true,
    pages: ['liveCtrl']
  },
  /* ── 抖店 · 直播明细「打开即切商品」 (2026-10-19 追加在末尾) ──────────
   * 用户原话:「当进入直播明细页的时候,第一次刷新进去这个网页的时候,
   *   会直接切到商品页,因为我最经常看的就是商品售卖情况。」
   * 2026-10-20 追加:「切过去的同时,要下滑到【商品明细】这一个地方」。
   * 做两件事:每次打开 / 刷新直播明细页,先自动切到「商品」标签,
   * 再下滑到「商品明细」区块,**各只做一次**;
   * 之后用户手动切到别处 / 自己滚动,一律不再拉回来。
   * 与 compassCopyCode(同页的货号按钮)分开一个开关 —— 两者互不牵连,
   * 不想自动切页的人关掉它,货号按钮照旧。
   */
  {
    key: 'liveDetailAutoTab',
    group: 'shop',
    label: '自动切商品页',
    desc: '打开直播明细后，切到商品并下滑至「商品明细」。',
    note: '只自动执行一次，手动操作后不再介入。',
    default: true,
    pages: ['compassLive']
  },
  /* ── 抖店 · 渠道品「下架并删除」(2026-10-24 新增,计划 #1) ────────────
   * 用户原话:「渠道品只有下架状态才可以做到删除,而且他的删除功能还在
   *   子菜单里面,非常不方便,所以尽量做到一个按钮能够做完这个流程。」
   * 两个入口:
   *   ① 单行 —— 操作列里与「查看/编辑/下架/复制/更多」同一列(垂直位置一致);
   *   ② 批量 —— 勾选 ≥1 个后出现在「更多操作」右侧的空白位。
   * 两处都有确认弹窗(删除不可恢复)。接口提交后以工具结果判定,失败保留现场。
   */
  {
    key: 'channelOfflineDelete',
    group: 'shop',
    label: '渠道品下架并删除',
    desc: '在渠道品列表中单个或批量下架并删除商品。',
    note: '删除无法恢复，下架后还会执行删除。',
    default: true,
    pages: ['channelGoods']
  },
  /* ── 抖店 · 活动广场联动渠道品(2026-10-25 新增,计划中功能 #1) ──────────
   * 用户原话:「当我勾选活动广场的主商品的时候,你帮我自动勾选渠道品也参加活动。」
   * 页面每行的「渠道品跟随主品报名 (N)」要跟主商品勾选框一起勾,逐行手点太烦。
   * 当前口径：只由独立按钮补勾已选商品；主品单选、全选与取消均不触发。
   * 来源词「活动广场」(见脚本 SOURCE),label 含该词(第 21 条口径)。
   */
  {
    key: 'campaignChannelTick',
    group: 'shop',
    label: '活动广场渠道品勾选',
    desc: '活动报名页提供按钮，补勾已选商品的适用渠道品。',
    note: '选好商品后点击按钮，仅补勾，不取消。',
    default: true,
    pages: ['campaignSignup']
  },

  /* ── 中控台 · 自动循环讲解(2026-10-25 新增,方案评审稿 v9) ─────────
   * 用户原话:「对着讲解中的商品,如果到了一定时间,自动取消讲解后重新续上讲解」。
   * 小黄车右上角一枚 20px 浮动胶囊(fixed + Shadow DOM,零布局占位),
   * 到设定时长自动「取消讲解 → 1.2 秒后再点讲解」,时长由面板滑条自定
   * (1–15 分钟 / 步进 30 秒 / 默认 5 / 推荐 3 与 8)。
   * 来源词「自动循环讲解」(第 21 条口径),本行 label 与它一致。
   */
  {
    key: 'autoLoopLecture',
    group: 'live',
    label: '自动循环讲解',
    desc: '讲解到设定时长后自动取消并续讲。',
    note: '保留讲解设置，手动停止后需重新开启。',
    default: true,
    pages: ['liveCtrl']
  },

  /* ── 抖店 · 直播大屏商品名优化(2026-10-30 起，2026-10-31 定名)─────────
   * 用户原话:「数据大屏这里也加入名称完整展示的功能和快速复制款号的功能,
   * 从之前做好的模式搬过来兼容就可以了」;
   * 2026-10-31 定名与范围:「这个开关叫做【直播大屏商品名优化】,功能就是三个:
   * 名称完整展示,快捷复制货号,去掉黑幕。归属于抖店的大类」。
   *   · 去掉黑幕 = 鼠标经过商品名时平台弹出的那个深色「完整名称」气泡
   *     (名字已展开,它纯属重复,还压在货号按钮上导致点不动)。
   *
   * 作用页 = 电商罗盘 · 直播大屏(专业版) compass.jinritemai.com/screen/live/*
   *         (#product 页签里的商品表;抖店侧 /shop 与达人侧 /talent 同骨架)。
   * 为什么与 liveNameWrap / compassTableCopyCode 分开:作用页不同、结构不同
   * (8 列窄表 vs 10~12 列宽表),关一边不影响另一边。
   */
  {
    key: 'liveScreenPolish',
    group: 'shop',
    label: '大屏商品名与货号',
    desc: '完整显示商品名、支持复制货号，并隐藏悬浮黑幕。',
    note: '货号优先平台值，否则取名称末尾款号。',
    default: true,
    pages: ['liveScreenPage']
  },

  /* ── 抖店 · 橱窗商品管理页的「名称不折叠 / 复制货号」已撤下(2026-11-07)────
   * 原两个开关 shopWindowTitle / shopWindowCopyCode，连同
   * src/live/shopwindow-goods.js 一并删除。用户 2026-11-07 定:
   * 「删掉复制货号和商品名称复原的这两个新功能,因为没有实现的可能性」。
   *
   * 原因(已确证,别再重试):平台返回的商品名文本**本身就是截短的**(末尾自带省略号),
   *   不是 CSS 裁字 —— isClipped(名称) 恒为「未裁」,页面级「被截断文本」扫描
   *   也找不到任何商品名。样式层怎么解 clamp / 放高度都不会多出一个字;
   *   元素的 title 里也没有完整名可回填。三条独立判据一致,见开发日志 2026-11-07。
   *
   * 存档里的旧键 shopWindowTitle / shopWindowCopyCode 从此无人读取,留着无害。
   */

  /* ── 中控台 · 浮层让位(2026-11-01 上线，2026-11-02 撤下开关)────────────
   * 原开关 overlayYield 已删(用户 2026-11-02:「删掉这个菜单可选项，这个功能
   *   不做选择，已经写入各个浮动按钮的底层且默认执行了」)。
   * 让位行为本身保留、恒生效：判据在 src/content/overlay-guard.js(唯一真源)，
   * 上滑到顶 / 下滑到底 / 搜索圆钮 / 搜索胶囊 / 刷新指示灯 / 循环讲解胶囊 /
   * 福袋圆钮都在各自底层 bind() 了它，没有开关可关。
   * 老存档里残留的 overlayYield 键从此无人读取，留着无害。
   */

  /* ── 抖店 · 抖店商品名称完整展示(2026-11-01，反馈 #128)───────────────
   * 用户原话两轮:
   *   ①「希望抖店这边也支持全名展示，商品名空间留有很大的余地」；
   *   ②「商品管理的商品名字，尽量两行可以做到吗，右边还有很大空位」。
   * 做什么:抖店后台商品列表(/ffa/g/list)的商品名由「一行 + 省略号」改为
   *   **最多两行**——两行装得下就完整显示,装不下钳两行加省略号;
   *   右侧若有可分配空位,把它加给名字列,让两行装下更多字。
   * 不动:其它列的宽度、表头结构、表格总宽;空位不足 60px 时列宽一个字都不动。
   * 作用页 list = 抖店商品列表(见 DYC_PAGE_PATTERNS)。
   */
  {
    key: 'shopListNameWrap',
    group: 'shop',
    label: '商品名多行显示',
    desc: '加宽商品名称列，最多显示三行名称。',
    note: '超出三行的部分仍会省略。',
    default: true,
    pages: ['list']
  },
  /* ── 橱窗 · 粘贴加橱窗(2026-11-06 用户新增需求)─────────────────────────
   * 用户原话:「给这个页面做一个【粘贴加橱窗的功能】,鼠标指向它就会显示
   *   【粘贴商品链接会一步到位加进橱窗。】」「多条一起,最高 30 条」。
   * 直提平台的解析 + 绑定两个接口,不点「添加商品」弹窗(示范抓包就是这两步)。 */
  {
    key: 'shopPaste',
    group: 'shop',
    label: '粘贴加橱窗',
    desc: '粘贴商品链接，将商品加入橱窗。',
    note: '最多 30 条，跳过已有商品；不支持口令和短链。',
    default: true,
    pages: ['shopWindow']
  },

  /* ── 中控台 · 超级福袋(2026-11-01，用户新增需求)─────────────────────
   * 用户原话两轮:
   *   ①「给抖店做一个自动发放福袋的功能，有两个想做的，
   *     福袋活动状态监视器、福袋自动循环发放」；
   *   ② 福袋活动已在「管理超级福袋活动」弹窗里提前创建好，
   *     「你只需要点击开始活动就可以了」。
   * 做什么:
   *   监视 = 每拍扫一遍福袋活动行，检测到「进行中 → 已结束」就播报参与人数；
   *   开始下一轮 = 开始后对同一活动再点一次「开始活动」，直到没有可点的为止。
   * 不做什么: 不填表单、不选奖励、不改份数、不点「复制」、不切 Tab。
   *
   * 简化(2026-11-01 深夜 用户「这个删掉，开关名改成【福袋功能增强】」+
   *   「自动发福袋的功能放进浮动框按钮里面的点击弹出来的框框，按钮默认关闭」):
   *   popup 里原来挂的折叠子菜单(福袋活动状态监视 / 福袋自动开始下一轮)
   *   整组撤下,只剩这一个开关:
   *     · 监视只读无害 ⇒ 直接跟随本开关(开 = 监视开);
   *     · 「自动发福袋」不再占 popup —— 开关挪进福袋圆钮点开的悬浮面板,
   *       存本地键 dycBagAuto,**默认关**(会真实消耗奖励,必须用户主动开)。
   *   本开关即总闸:关 ⇒ 监视、悬浮窗、自动发福袋全部停。
   *   历史设计(收纳壳 foldHost:'bag' + 两个 foldGroup 子开关)整段退役,
   *   老存档里的 luckyBagWatch / luckyBagAuto 键从此无人读取,留着无害。
   */
  {
    key: 'luckyBag',
    group: 'live',
    label: '福袋监视与自动发送',
    desc: '显示福袋状态悬浮窗，可设置自动发送。',
    note: '自动发送默认关闭，关闭此开关后全部停止。',
    default: true,
    pages: ['liveCtrl']
  },
  {
    key: 'shopHeaderName',
    group: 'shop',
    label: '店铺名称完整显示',
    desc: '右上角完整显示店名。',
    note: '空间不足时换行显示。',
    default: true,
    pages: ['fxgShop']
  },
  /* ── 抖店 · 商品批量复制链接(2026-11-06 用户新增需求)─────────────────
   * 用户原话:「在这个页面做一个批量复制商品链接的功能，按钮放在【更多操作】
   *   的右边，当我勾选多个商品，然后点击这个按钮，可以批量复制多个商品链接」
   *   +「不要模拟手动，不要弹窗」+「最高可以同时复制30个，超过不记录」
   *   +「每行一个链接，首位不要直接相连」。
   * 做什么:读勾选行的商品 ID → 套模板拼链接 → 一次写剪贴板(一行一条)；
   *   不点平台的「复制链接」、不发接口。复制成功后自动取消勾选(用户定)。
   * 落点:实机取样该页批量工具条为「批量下架/批量修改/查看优化记录」,
   *   **没有「更多操作」** ⇒ 按钮追加到这一排最右端(用户确认)。
   */
  {
    key: 'shopBatchCopyLink',
    group: 'shop',
    label: '商品批量复制链接',
    desc: '勾选商品后一键复制多个商品链接。',
    note: '单次最多 30 条，一行一条。',
    default: true,
    pages: ['list']
  },

  /* ── 商品发布 / 编辑页 · 两个小工具(2026-11-08 用户新增需求)─────────────
   * 作用页 = goodsEdit(/ffa/g/create,新建与编辑同路径)。
   * ① 图片剪贴板粘贴:上传框内下方挂一枚按钮,一步贴入剪贴板图片,
   *    不弹系统选择窗。只挂**空白**框 —— 有图的框平台已叠了编辑/删除。
   * ② 面料材质智能填写:原生框右侧自建输入框 + 按钮,把「棉80 丝绸20」
   *    按平台规则填进去。合计不是 100% 只提示、不写;平台没有的材料名
   *    按用户原话**新建**该名字,不做模糊匹配。
   * 两个开关都默认开,互不依赖。
   * ★ 位置:排在表尾(2026-11-08 用户定:弹窗里**最新的排最下面**,
   *   以后新加功能一律追加到 DYC_FLAGS_META 末尾,不要往中间插)。 */
  {
    key: 'goodsImagePaste',
    /* 分组:2026-11-12 用户定「这个功能放到【其他】里面去」(原在「通用」)。
     * 为什么给平台豁免:「其他」组只归抖音侧,而本功能两个平台都要用
     *   (pages 含 wxGoodsEdit)。只改 group 会让微信段弹窗里这一行整条消失
     *   —— 开关仍默认开、功能照跑,用户却没有关它的入口。
     * 所以另挂 platforms:它不随分组显隐,自己声明在两个平台都露。
     * 详见 src/popup/popup.js 的 applyPlatform()。 */
    group: 'other',
    platforms: ['dy', 'wx'],
    label: '粘贴图片',
    desc: '在上传入口和商详工具栏添加「粘贴图片」按钮。',
    note: '无图片或上传失败时提示。',
    default: true,
    pages: ['goodsEdit', 'wxGoodsEdit']
  },
  {
    key: 'fabricSmartFill',
    group: 'shop',
    label: '面料材质快捷填写',
    desc: '输入材质和比例填写面料，合计须 100%。',
    note: '会覆盖原内容；无同名材质时按原名新建。',
    default: true,
    pages: ['goodsEdit']
  },
  {
    key: 'wxClearStock',
    group: 'wx',
    label: '商品库存清零',
    desc: '在商品行添加「清空库存」按钮，清零全部规格。',
    note: '清零前需确认；平台要求额外确认时停止。',
    default: true,
    pages: ['wxGoodsList']
  },
  {
    key: 'replayResume',
    group: 'other',
    label: '回放暂停与续传',
    desc: '回放下载支持暂停、继续和断网恢复。',
    note: '需保持页面打开；直链续传取决于服务器支持。',
    default: true,
    pages: ['replayPage']
  },
  {
    key: 'multiPlatformMenu',
    group: 'shared',
    inFooter: true,
    label: '多平台菜单',
    desc: '按网站显示菜单，也可在右上角手动切换。',
    note: '关闭后只保留抖音与微信切换。',
    default: true,
    pages: []
  }
];/* ==========================================================
 * 四、从元数据派生的常量(保持向后兼容)
 * ========================================================== */

var DYC_FLAGS_STORE_KEY = 'dybFeatures';
var DYC_DEBUG_STORE_KEY = 'dybDebug';

// 兼容旧写法:仍导出「功能开关默认值」对象(不含调试模式,它自成一个键)
var DYC_FLAGS_DEFAULTS = (function () {
  var d = {};
  DYC_FLAGS_META.forEach(function (m) {
    if (!m.key) return;          // 纯分组行(如「页面滚动按钮」)没有开关,跳过
    if (m.store !== 'debug') d[m.key] = m.default !== false;
  });
  return d;
})();

/* ==========================================================
 * 五、读取与写入
 * ========================================================== */

/** 取某个开关的元数据;找不到返回 null */
function dycFlagMeta(key) {
  for (var i = 0; i < DYC_FLAGS_META.length; i++) {
    if (DYC_FLAGS_META[i].key === key) return DYC_FLAGS_META[i];
  }
  return null;
}

/**
 * storage.get 的回调式封装（2026-11-01 体检 P1·老内核兼容）。
 *
 * 为什么不用裸 .then：老 360 极速X 内核部分 chrome.* API 不返回 Promise ——
 * get() 返回 undefined 时 `.then` 直接同步抛 TypeError，**catch 救不了**，
 * flags 层整体瘫猝（所有功能静默按默认值走，用户侧毫无报错）。
 * background 侧早有 chromeCb 包装，这里对齐同一策略：
 * 读存储一律走回调形式，新老内核通吃。失败（lastError/异常）给 null，
 * 由调用方落默认值 —— 与原先 .catch 的容错口径一致。
 */
function dycStorageGet(key, cb) {
  try {
    chrome.storage.local.get(key, function (r) {
      if (chrome.runtime.lastError) { cb(null); return; }
      cb(r || null);
    });
  } catch (e) {
    cb(null);
  }
}

/** 设置读写必须等待真实回执；兼容仅回调内核，并保留存储失败原因。 */
function dycStorageCallP(method, payload) {
  return new Promise(function (resolve, reject) {
    try {
      var pending = chrome.storage.local[method](payload, function (result) {
        var error = chrome.runtime.lastError;
        if (error) reject(new Error(error.message || String(error)));
        else Promise.resolve().then(function () {
          if (!pending || typeof pending.then !== 'function') resolve(result);
        });
      });
      // 同时消费支持 Promise 的实现，避免拒绝成为未处理异常。
      if (pending && typeof pending.then === 'function') pending.then(resolve, reject);
    } catch (error) { reject(error); }
  });
}

/** 旧页面的扩展上下文失效后无法重连，提示用户自行刷新页面。 */
function dycSettingError(error) {
  var message = error && error.message || String(error || '');
  return /Extension context invalidated/i.test(message)
    ? '扩展已更新，请在方便时刷新当前网页后重试'
    : message;
}

/** dycStorageGet 的 Promise 版（内部多个键并行读时用） */
function dycStorageGetP(key) {
  return new Promise(function (resolve) {
    dycStorageGet(key, resolve);
  });
}

/**
 * 读取全部功能开关(不含调试模式)。
 * 读取失败时回退到默认值 —— 宁可功能照常可用,也不要因为
 * 一次 storage 异常就把用户的功能悄悄关掉。
 */
// 旧版任一跳转关闭时先保持关闭；用户设置统一开关后，以新值为准。
function dycNormalizeFlags(stored) {
  var out = Object.assign({}, DYC_FLAGS_DEFAULTS, stored || {});
  if (!stored || stored.servicePlatformJump === undefined) {
    out.servicePlatformJump = out.liveScreenJump !== false && out.liveDetailJump !== false;
  }
  return out;
}

function dycReadFlags() {
  return dycStorageGetP(DYC_FLAGS_STORE_KEY).then(function (r) {
    return dycNormalizeFlags((r && r[DYC_FLAGS_STORE_KEY]) || {});
  });
}

/**
 * 读取「全部开关」的当前值,含调试模式。返回 {key: boolean}。
 * 弹窗渲染初始状态用这个 —— 它不关心存储在哪,只要一个键值对。
 */
function dycReadAllFlags() {
  var featureRead = dycStorageGetP(DYC_FLAGS_STORE_KEY)
    .then(function (r) { return (r && r[DYC_FLAGS_STORE_KEY]) || {}; });

  var debugRead = dycStorageGetP(DYC_DEBUG_STORE_KEY)
    .then(function (r) { return !!(r && r[DYC_DEBUG_STORE_KEY]); });

  return Promise.all([featureRead, debugRead]).then(function (res) {
    var obj = dycNormalizeFlags(res[0]);
    var debugOn = res[1];
    var out = {};
    DYC_FLAGS_META.forEach(function (m) {
      if (!m.key) return;        // 纯分组行没有开关,不进键值对
      if (m.store === 'debug') {
        out[m.key] = debugOn;
      } else {
        out[m.key] = (obj[m.key] !== undefined) ? obj[m.key] : (m.default !== false);
      }
    });
    return out;
  });
}

/**
 * 写单个开关。按元数据声明的 store 分派到对应的存储位置。
 * 功能开关写 dybFeatures 对象(其余成员保持不变);
 * 调试模式写独立键 dybDebug。
 */
function dycWriteFlag(key, value) {
  var meta = dycFlagMeta(key);
  if (!meta) return Promise.reject(new Error('未知开关:' + key));

  // 所有弹窗通过同一个后台队列写入，避免多个窗口同时读改写丢掉另一项。
  // store 随消息带上：万一后台还是旧缓存包、不认识这个键，它仍能按正确位置
  // 落库，而不是直接回「无效设置」（2026-11-05）。
  function send(attempt) {
    return new Promise(function (resolve, reject) {
      try {
        chrome.runtime.sendMessage({
          type: 'dyc:writeFlag', key: key, value: !!value,
          store: meta.store === 'debug' ? 'debug' : 'features'
        }, function (res) {
          var error = chrome.runtime.lastError;
          var message = error && error.message || '';
          if (error && attempt === 0 && /Receiving end does not exist|message port closed|message channel closed/i.test(message)) {
            setTimeout(function () { send(1).then(resolve, reject); }, 200);
            return;
          }
          if (error || !res || !res.ok) {
            reject(new Error(message || (res && res.error) || '设置未保存'));
            return;
          }
          resolve();
        });
      } catch (error) { reject(error); }
    });
  }
  return send(0);
}

/**
 * 订阅开关变化。
 *
 * 走 storage.onChanged 而不是自己搭消息通道:
 *   弹窗只负责写 storage,所有已打开的页面自动收到通知并即时生效,
 *   不需要页面与弹窗之间来回通信,也不需要刷新页面。
 *
 * @param {function(Object)} cb 收到完整功能开关对象(不含调试模式,与 dycReadFlags 同口径)
 */
function dycWatchFlags(cb) {
  chrome.storage.onChanged.addListener(function (changes, area) {
    if (area !== 'local') return;
    if (!changes[DYC_FLAGS_STORE_KEY]) return;
    cb(dycNormalizeFlags(changes[DYC_FLAGS_STORE_KEY].newValue));
  });
}

/* ==========================================================
 * 五·五、中控台作用域(2026-11-05)
 *
 * 只在 boot 时判一次 URL 不够用。中控台是 Garfish 微前端,pushState 换路由
 * **不重载 document**:从 /live/control 切到别的子应用(如橱窗商品管理)时,
 * content script 还活着,于是循环讲解 / 自动刷新 / 福袋 / 粘贴加车 这些
 * 浮动控件跟着页面跑出去 —— 甚至会在别的页面上误认商品行、误点按钮。
 *
 * 这里只回答「此刻是不是中控台」,收什么、回来重建什么由各模块自己决定。
 * 判定口径与各模块原有的 boot 守卫保持一致(两个入口)。
 * ========================================================== */

/**
 * 是否在直播中控台。
 * @param {string} [url] 省略时读 location.href
 * @returns {boolean}
 */
function dycIsLiveControl(url) {
  var u = '';
  if (url === undefined || url === null) {
    try { u = String((typeof location !== 'undefined' && location.href) || ''); } catch (e) { u = ''; }
  } else {
    u = String(url);          // 显式传串就按串判：空串 = 没有 URL，不是「读当前页」
  }
  return /^https:\/\/(?:fxg\.jinritemai\.com\/ffa\/content-tool\/live\/control|buyin\.jinritemai\.com\/dashboard\/live\/control)/.test(u);
}

/**
 * 订阅「是否在中控台」的变化。首次立即回调一次,之后只在真假翻转时回调。
 *
 * 为什么用 500ms 轮询而不是只听 popstate:抖店这套后台切换走 pushState,
 * 不触发任何导航事件;hide-elements.js 早已因此单独 hook 过 history。
 * 轮询一次只是一次字符串判定,代价远小于再多包一层 history。
 *
 * @param {function(boolean)} cb
 */
function dycWatchLiveScope(cb) {
  if (typeof cb !== 'function') return;
  var st = window.__DYC_LIVE_SCOPE__;
  if (!st) st = window.__DYC_LIVE_SCOPE__ = { subs: [], inScope: null, timer: 0 };
  if (st.subs.indexOf(cb) >= 0) return;
  st.subs.push(cb);

  /**
   * @param {boolean} force 越过「没翻转就不通知」
   * @param {function} only 只通知这一个订阅（新订阅的首拍用；否则会把
   *        已有订阅再通知一遍，某些模块会因此重建一遍 UI）
   */
  function evaluate(force, only) {
    var now = dycIsLiveControl();
    if (!force && now === st.inScope) return;
    st.inScope = now;
    (only ? [only] : st.subs.slice()).forEach(function (fn) {
      try { fn(now); } catch (e) { /* 一个订阅出错不影响其它模块 */ }
    });
  }

  if (!st.timer) {
    st.timer = setInterval(function () { evaluate(false); }, 500);
    window.addEventListener('popstate', function () { evaluate(false); });
    window.addEventListener('hashchange', function () { evaluate(false); });
  }
  evaluate(true, cb);
}

/* ==========================================================
 * 六、隐藏页面元素:可隐藏目标登记表 + 勾选存取(2026-10-11 新增)
 *
 * 「隐藏页面元素」是一个**一对多**的功能:一个总开关管着若干个
 * 可隐藏的页面区块,用户在弹窗里按区块勾选、点「保存勾选」才生效。
 *
 * ★ 加一个「可隐藏区块」只改这里一处:
 *     在 DYC_HIDE_TARGETS 末尾追加一项(id/label/desc/selector/pages),
 *     弹窗复选框与内容脚本的 CSS 都会自动跟上,不用改 popup。
 *
 * ★ mode —— 隐藏手法,两种,选错会把页面布局带歪(2026-10-14 踩过两轮):
 *     'display' = display:none !important,元素连布局盒子一起摘掉。
 *                 适合**纯浮层**(fixed/absolute、不占布局位)的区块。
 *     'opacity' = opacity:0 + pointer-events:none,元素**在平台眼里一切正常**
 *                 (display / 尺寸 / visibility 全不变),只是肉眼看不见、点击穿透。
 *                 适合**会被平台按尺寸或可见性预留空间**的区块。
 *   为什么抖店侧必须是 'opacity'(2026-10-14 两轮实测):
 *     ① 第一版用 display:none —— 用户报「商品表最后一列平白宽出一条、表头灰底
 *        不再铺满,整个商品界面像往左缩了一个红框」;
 *     ② 第二版改 visibility:hidden(盒子保留、尺寸不变)—— 用户报**仍未修好**。
 *     真机探针(浏览器实测 fxg.jinritemai.com/ffa/g/list)查清了结构:
 *        `.index_wrapper__3UiS6` 只命中 1 个元素,是 **position:absolute** 的浮动层
 *        (父级 position:fixed、56px 宽的宿主)—— **它根本不在布局流里**;
 *        页面表格是 ecom-g-table(table-layout:fixed + 右侧粘性「操作」列),
 *        列宽是固定值;表头那道灰来自 TH 的 background:rgb(248,249,250)。
 *     推论:那条白槽不是「右轨占位塌了」,而是**平台用 JS 按右轨的尺寸或可见性
 *        预留了右侧空间**;一旦隐藏手法被平台察觉,预留就变,而列宽是死的
 *        ⇒ 右边空出一条。两种已知的暴露面:
 *          · display:none —— 元素尺寸量到 0,任何按尺寸算的预留都会跟着变;
 *          · visibility:hidden —— 尺寸虽在,但 **computed visibility 变成 hidden**,
 *            平台读一眼样式就知道它被藏了。
 *            (实测纠正:`checkVisibility()` 默认**不**检查 visibility,对它仍返回
 *             true —— 暴露面是 computed 值本身,不是这个 API。)
 *     ⇒ 隐藏手法必须让平台**查不出任何异常**:opacity:0 不改 display、不改尺寸、
 *        不改 computed visibility,是三种里唯一「布局与可见性检测面全绿」的写法。
 *     (中控台的助手是纯浮层,display 反而更干净,保持原样。)
 *
 * 存储位置:
 *   勾选清单存 chrome.storage.local 的 dybHideList(id 数组)。
 *   **键不存在 = 默认清单**(defaultOn:true 的项都算勾上),
 *   与功能开关「缺省即默认值」同一口径;键存在但是空数组 = 用户
 *   明确取消全部勾选,要尊重,不当成缺省。
 *
 * ⚠️ selector 是平台构建产物(CSS Modules 哈希类名),平台改版后
 *    **可能变化**。失效的表现是「勾了但不隐藏」,处理:用开发者工具
 *    重新确认该区块的类名,更新 selector 即可。
 *    (同一套组件库在抖店各页面复用,类名一般通用;若某个页面失效,
 *     单独给该页面加一条目标即可,不要动已生效的那条。)
 * ========================================================== */

var DYC_HIDE_LIST_KEY = 'dybHideList';

/**
 * 「已见过」标记的存储键(2026-10-18 新增)
 *
 * 为什么需要它:清单里新增一个 defaultOn 的可隐藏项时,老用户 storage 里
 * **已经存着一份清单**(没有这个新 id)—— 若只把新项写进登记表,老用户永远
 * 勾不到点上,得手动去弹窗勾一次,与「装好即隐藏」不符。
 * 但反过来「缺什么就补什么」也不行:用户**亲手取消**过的旧项会被复活。
 *
 * 于是用一个单独的「已见过」集合区分两件事:
 *   · id 在 seen 里     → 用户对它有决定权,清单里没有就是**他不要**,不许补;
 *   · id 不在 seen 里   → 这是本次更新**新出现**的项,按 defaultOn 补勾一次,
 *                          并把所有 id 记进 seen(此后不再自动干预)。
 * 迁移只跑一次,之后完全回到「清单说了算」的老口径。
 */
var DYC_HIDE_SEEN_KEY = 'dybHideSeen';

var DYC_HIDE_TARGETS = [
  {
    id: 'aiAssistant',
    label: '中控台智能助手',
    desc: '直播间中控台里的「智能助手」浮层区块',
    selector: '.index_wrapper__3UiS6',
    pages: ['liveCtrl'],
    defaultOn: true,
    // 中控台的助手是纯浮层(不占布局位),直接摘掉最干净 —— 见下方 mode 说明。
    mode: 'display'
  },
  {
    id: 'shopAiAssistant',
    label: '抖店智能助手',
    desc: '抖店各页面(含电商罗盘)里的智能助手浮层区块',
    selector: '.index_wrapper__3UiS6',
    pages: ['shopAll'],
    defaultOn: true,
    // ★ 抖店侧必须用 opacity(2026-10-14 两轮实测后定),见下方 mode 说明。
    mode: 'opacity'
  },
  {
    /* ────────────────────────────────────────────────────────
     * 右侧客服 / 反馈浮条(合并项 · 2026-10-18 用户定)
     *
     * 用户原话:「你看看有没有可以整合的，因为每个网页显示的差不多，但是有点不一样。」
     * 此前是三个独立项(抖店反馈入口 / 巨量百应反馈入口 / summon 浮条),
     * 位置都在页面右侧、性质都是「客服 / 反馈 / 调研」入口、开关语义完全相同 ——
     * 合成一项,顺带把「以后又多一个页面」的成本降到零。
     *
     * 三处已见的形态(长得像,细节不同):
     *   ① 电商罗盘「直播明细」(talent/live-statement):蓝色竖条 反馈 / 客服 / 调研问卷
     *      —— 字节 summon 反馈 SDK。结构证据:报告 env 段有
     *      `div.summon-iframe-contrainer.summon-iframe-hidden`(400×556)、
     *      `style#summon-sdk-style`、iframe → summon.bytedance.com。
     *   ② 巨量百应经营页(compass-home/live-list)、③ 直播大屏(screen/live/talent):
     *      浅色卡片「联系客服 / 廉洁举报」、深色竖条「移动 / 反馈」。
     *      ⚠️ 这两处的类名**没有采集到**,页面里也没有 summon 痕迹(大屏连 iframe 都没有)
     *      ⇒ 光靠类名选择器必然漏。
     *
     * ★ 所以用**两套识别方式**兜同一项:
     *   A. selector —— 已知类名,一条 CSS 搞定,零运行时开销;
     *   B. barScan  —— 通用兜底扫描:贴右缘 + 窄 + 竖长 + 命中≥2 个关键词(客服/反馈/
     *      举报/调研/移动…)就判定为浮条,打上 `data-dyc-hide-bar` 属性由 CSS 隐藏。
     *      实现与调度见 src/live/hide-elements.js 的 scanBarOnce。
     *   两套并存:已知页面走 A(精确、便宜),新页面/改名后由 B 兜住;两者都按下同一条规则藏。
     *
     * mode 用 opacity:浮条虽是 fixed 浮层,但平台若按它的尺寸/可见性做过预留,
     *   display:none 会让预留变化(见上方 mode 说明);opacity 三个检测面全绿。
     * ──────────────────────────────────────────────────────── */
    id: 'feedbackBar',
    label: '右侧客服/反馈浮条',
    desc: '页面右侧竖排的客服 / 反馈 / 调研入口浮条(罗盘直播明细、百应经营页、直播大屏等)',
    selector: '.feedbackEntrance-Okk7KM, .athena-survey-entry__inner, [class*="summon"], [id*="summon"]',
    // 用户 2026-10-18 定:抖店全域 + 中控台两个入口一起藏。
    pages: ['shopAll', 'liveCtrl'],
    defaultOn: true,
    mode: 'opacity',
    // B 套:通用扫描参数。改判定尺度只改这里,不用碰 hide-elements.js。
    barScan: {
      // 命中这些词里的 ≥minHits 个,即认定为客服/反馈浮条
      texts: ['客服', '反馈', '举报', '调研', '问卷', '意见', '帮助', '移动'],
      minHits: 2,
      maxWidth: 160,     // 浮条都很窄(实测 56~140px)
      minHeight: 90,     // 太矮的多半是按钮,不是浮条
      minAspect: 1.05,   // 高 / 宽 ≥ 此值才算「竖条」(排除方形小卡)
      rightGap: 60,      // 右缘距视口右边 ≤60px 才算「贴右缘」
      maxTextLen: 80     // 浮条自身文本很短;超过就当普通内容跳过
    }
  },
  {
    /* ────────────────────────────────────────────────────────
     * 中控台运营提示浮条(#102 · 2026-10-21)
     *
     * 拦的是中控台右上「推荐使用超级福袋 / 发布预告留住长效流量」
     * 这类**带更新时间**的运营提示浮条(用户原话「有时间的浮动提示
     * 希望拦截」)。两条提示合并一个开关(2026-10-21 用户拍板);
     * 浮条上「15:01 更新 · 每1分钟/每5分钟」那排刷新频次文案
     * **暂不纳入**,上线后看残留再定(同轮拍板)。
     *
     * ★ 时机特性:这浮条**开播之后才会挂出来**(用户 2026-10-21 点明)。
     *   对拦截无碍 —— 本机制的 CSS 对「以后才挂载」的元素同样生效,
     *   扫描器靠 MutationObserver 兜懒挂载;对**采样**才有碍 ——
     *   未开播时页面里根本没有它,类名采不到。
     *
     * ★ 两步走(2026-10-21 用户拍板「B先行+A固化」):
     *   第一步(本版):无 selector,纯 barScan —— 词表取两条提示
     *   原文里的高特定词,单命中即判;
     *   第二步(留观):用户哪天开播时用「导出当前页结构」采一次
     *   类名,补进 selector 走 A 套精确拦截,barScan 继续兜改版
     *   (与 feedbackBar 同款双保险)。
     *
     * ★ barScan 多套并行(2026-10-21 随本项改造):此前 collectBarConfig
     *   只认清单里第一个带 barScan 的目标;本项加入后改为逐套全跑
     *   (collectBarConfigs,复数),每套的词表/几何参数独立,互不干扰。
     *
     * ★ #105(2026-10-23):第三形态「基于【女装】行业数据分析,日均开播【5】
     *   小时,时均流量获取效率最高!」气泡卡(带「查看」+「创建直播预告/创建
     *   直播计划」按钮)没拦住 —— 原三词一个不含,文本预筛即淘汰;几何档均能
     *   满足,卡点纯在词表。补两个高特定词:「行业数据分析」「流量获取效率」。
     *   ⚠️ 不加「创建直播计划」:它是未开播引导区的功能入口文案,拿它当拦截
     *   词会误伤未开播时的引导浮条(且 auto-refresh 的 PRE_LIVE_TEXTS 教训
     *   见 #108 —— 平台把同一文案用在两种语义的组件上,弱特定词两头翻车)。
     *
     * ★ #104(2026-10-24)档位放宽 + 判定链修洞,四步:
     *   ① 判定链预算:hide-elements.js 的 BFS 3000→8000 节点、深度 10→14 ——
     *      开播中控台 DOM 两三千+,层序遍历中途耗尽,浮条子树根本没被走到
     *      (头号嫌疑,能解释「开发时拦得住、开播实战拦不住」);
     *   ② 本套档位:rightGap 60→120、maxTop 420→600、maxTextLen 120→260、
     *      新增 maxChildren 16(默认 8 是按右侧竖条定的;运营卡片一排文案
     *      节点常超 8,整卡在预筛就被跳过)。误伤可控:词表全是高特定词
     *      单命中即判,几何放宽只影响「命中词后谁被整条藏」;
     *   ③ SPA 路由感知:hide-elements.js hook pushState/replaceState/
     *      popstate/hashchange,URL 变化后重算生效配置 —— 此前从别的抖店页
     *      SPA 切进中控台(不刷新)时 barCfgs 永远是旧页面的,本项不生效;
     *   ④ 几何淘汰探针:文本命中但被档位淘汰的候选记进
     *      window.__dycBarScanLog(环形 24 条)+ 每扫汇总 __dycBarScanMeta,
     *      诊断报告入报 —— 仍漏的话下一份报告直接带回「卡在哪一档」的现场,
     *      不用再猜;之后用户开播时用「导出当前页结构」采类名固化 selector
     *      (原两步走的第二步不变)。
     * ──────────────────────────────────────────────────────── */
    id: 'liveCtrlOpsBar',
    label: '中控台运营提示浮条',
    desc: '中控台右上「推荐使用超级福袋 / 发布预告留住长效流量」这类带更新时间的运营提示浮条(开播后才出现,出现即隐藏)',
    pages: ['liveCtrl'],
    defaultOn: true,
    // 无 selector:类名未采集(浮条开播后才存在)。隐藏手法固定走 BAR_CSS
    // (opacity + pointer-events,与 mode:'opacity' 同一套写法,平台探测面全绿)。
    mode: 'opacity',
    barScan: {
      // 高特定词,单命中即判:取自各形态提示的原文片段,
      // 正常页面正文几乎不会撞上(2026-10-21 按用户截图用词定,#105 补两词)。
      texts: ['超级福袋', '发布预告', '留住长效流量', '行业数据分析', '流量获取效率'],
      minHits: 1,
      maxWidth: 520,     // 右上横条(或堆叠卡),比右侧竖条宽得多
      maxHeight: 220,    // 横条上限:防止把右上区域的大块面板误收进来
      minHeight: 36,     // 太矮的多半是普通按钮/标签
      rightGap: 120,     // #104:60→120(60 按单张截图定;浮条右侧若叠着别的固定件实测右距就超)
      maxTop: 600,       // #104:420→600(页头较高或多条堆叠时,下面那条 top 会超)
      maxTextLen: 260,   // #104:120→260(浮条文本 = 主文案+「15:01 更新」+「每1分钟/每5分钟」+按钮文案,120 很可能撞线被预筛静默淘汰)
      maxChildren: 16    // #104 新增:预筛 children 上限可按套覆盖(默认 8;运营卡片一排文案节点常超 8,整卡被跳过)
    }
  }
];

/** 按登记表取某个可隐藏目标的元数据;找不到返回 null */
function dycHideTargetMeta(id) {
  for (var i = 0; i < DYC_HIDE_TARGETS.length; i++) {
    if (DYC_HIDE_TARGETS[i].id === id) return DYC_HIDE_TARGETS[i];
  }
  return null;
}

/** 默认勾选清单(defaultOn 不为 false 的项) */
function dycDefaultHideList() {
  var out = [];
  DYC_HIDE_TARGETS.forEach(function (t) {
    if (t.defaultOn !== false) out.push(t.id);
  });
  return out;
}

/** 只留登记表里还存在的 id(登记表删过项后,老存储里的脏 id 不外泄) */
function dycSanitizeHideList(ids) {
  var known = {};
  DYC_HIDE_TARGETS.forEach(function (t) { known[t.id] = true; });
  return (Array.isArray(ids) ? ids : []).filter(function (id) { return known[id]; });
}

/**
 * 读勾选清单 → Promise<string[]>。
 * 键不存在(含 storage 异常)= 默认清单;存在则过滤脏 id 后原样返回。
 *
 * ★ 2026-10-18 起多一步「新项补勾」:
 *   清单已存在时,凡是**清单里没有、且不在 seen 记录里**的 defaultOn 目标
 *   (即本次更新新加的项),自动补勾一次并记进 dybHideSeen。
 *   seen 记录存在的价值:用户亲手取消过的项都在 seen 里,永不被复活。
 *   首次迁移(没有 seen 记录)时**也补一次** —— 用户对新增项的明确要求是
 *   「装好即隐藏」;代价是若他此前取消过某个旧项,那一项会重新被勾上,
 *   但弹窗里一眼可见、取消即可,可接受。
 */
function dycReadHideList() {
  return Promise.all([
    dycStorageGetP(DYC_HIDE_LIST_KEY),
    dycStorageGetP(DYC_HIDE_SEEN_KEY)
  ]).then(function (rs) {
    var stored = rs[0] && rs[0][DYC_HIDE_LIST_KEY];
    var seenRaw = rs[1] && rs[1][DYC_HIDE_SEEN_KEY];
    var seen = Array.isArray(seenRaw) ? seenRaw : null;

    // 键不存在 = 首次使用,直接给默认清单,同时把所有 id 记为「已见过」
    if (!Array.isArray(stored)) {
      var def = dycDefaultHideList();
      markSeen(def);
      return def;
    }

    var list = dycSanitizeHideList(stored);
    var added = [];
    DYC_HIDE_TARGETS.forEach(function (t) {
      if (t.defaultOn === false) return;
      if (list.indexOf(t.id) !== -1) return;
      if (seen && seen.indexOf(t.id) !== -1) return;   // 用户见过 → 他的选择说了算
      list.push(t.id);
      added.push(t.id);
    });

    // 补勾结果落库 + 记全 seen(此后不再自动干预)
    if (added.length) dycWriteHideList(list);
    if (added.length || !seen) markSeen(list);
    return list;
  }).catch(function () {
    return dycDefaultHideList();
  });
}

/** 把给定 id 与登记表全集一并记为「已见过」(只为下次判断「哪些是新项」) */
function markSeen(list) {
  var all = {};
  (list || []).forEach(function (id) { all[id] = true; });
  DYC_HIDE_TARGETS.forEach(function (t) { all[t.id] = true; });
  var payload = {};
  payload[DYC_HIDE_SEEN_KEY] = Object.keys(all);
  chrome.storage.local.set(payload);
}
/** 写勾选清单(id 数组)。内容脚本订阅 storage 变化,写完即时生效。 */
function dycWriteHideList(ids) {
  var payload = {};
  payload[DYC_HIDE_LIST_KEY] = dycSanitizeHideList(ids);
  return dycStorageCallP('set', payload);
}

/** 订阅勾选清单变化,回调收到净化后的 id 数组(与 dycReadHideList 同口径) */
function dycWatchHideList(cb) {
  chrome.storage.onChanged.addListener(function (changes, area) {
    if (area !== 'local') return;
    if (!changes[DYC_HIDE_LIST_KEY]) return;
    var next = changes[DYC_HIDE_LIST_KEY].newValue;
    cb(Array.isArray(next) ? dycSanitizeHideList(next) : dycDefaultHideList());
  });
}

/* ==========================================================
 * 七、搜索扫描白幕:遮罩档位存取(2026-10-12 新增)
 *
 * 总开关 scanShade 在 DYC_FLAGS_META(默认关);
 * 档位单独存,两档固定:'opaque' 不透明白 / 'translucent' 半透明40%。
 * 键不存在 = 不透明白(缺省即默认值,不写迁移)。
 * ========================================================== */

var DYC_SHADE_MODE_KEY = 'dycScanShadeMode';
var DYC_SHADE_MODES = ['opaque', 'translucent'];

/** 读档位 → Promise<string>('opaque'|'translucent',脏值/异常一律落 opaque) */
function dycReadShadeMode() {
  return dycStorageGetP(DYC_SHADE_MODE_KEY).then(function (r) {
    var v = r && r[DYC_SHADE_MODE_KEY];
    return DYC_SHADE_MODES.indexOf(v) >= 0 ? v : 'opaque';
  });
}

/** 写档位。内容脚本订阅 storage 变化,写完即时生效。 */
function dycWriteShadeMode(mode) {
  var payload = {};
  payload[DYC_SHADE_MODE_KEY] = DYC_SHADE_MODES.indexOf(mode) >= 0 ? mode : 'opaque';
  return dycStorageCallP('set', payload);
}

/** 订阅档位变化,回调收到净化后的档位字符串(与 dycReadShadeMode 同口径) */
function dycWatchShadeMode(cb) {
  chrome.storage.onChanged.addListener(function (changes, area) {
    if (area !== 'local') return;
    if (!changes[DYC_SHADE_MODE_KEY]) return;
    var next = changes[DYC_SHADE_MODE_KEY].newValue;
    cb(DYC_SHADE_MODES.indexOf(next) >= 0 ? next : 'opaque');
  });
}

/* ==========================================================
 * 八、全能搜索:回车档位存取(2026-10-12 新增,二十二轮;2026-10-18 两档化)
 *
 * 总开关 omniSearch 在 DYC_FLAGS_META(默认开,控制按钮显隐);
 * 档位单独存:'none' 默认原生搜索 / 'always' 默认全能搜索。
 * 键不存在 = 'none'(缺省即默认值,不写迁移)。
 *
 * ★ 2026-10-18:第三档 'trial3'(事不过三)按用户决定整体删除 —— 连带
 *   search.js 里的三套计数器与回车分支。旧存档里的 'trial3' **不需要迁移**:
 *   下面 indexOf 白名单会把它判为非法并回落成 'none',恰好就是新的默认值。
 * ========================================================== */

var DYC_OMNI_MODE_KEY = 'dycOmnisearchMode';
var DYC_OMNI_MODES = ['none', 'always'];

/** 读档位 → Promise<string>('none'|'always',脏值/异常/已删档一律落 none) */
function dycReadOmniMode() {
  return dycStorageGetP(DYC_OMNI_MODE_KEY).then(function (r) {
    var v = r && r[DYC_OMNI_MODE_KEY];
    return DYC_OMNI_MODES.indexOf(v) >= 0 ? v : 'none';
  });
}

/** 写档位。内容脚本订阅 storage 变化,写完即时生效。 */
function dycWriteOmniMode(mode) {
  var payload = {};
  payload[DYC_OMNI_MODE_KEY] = DYC_OMNI_MODES.indexOf(mode) >= 0 ? mode : 'none';
  return dycStorageCallP('set', payload);
}

/** 订阅档位变化,回调收到净化后的档位字符串(与 dycReadOmniMode 同口径) */
function dycWatchOmniMode(cb) {
  chrome.storage.onChanged.addListener(function (changes, area) {
    if (area !== 'local') return;
    if (!changes[DYC_OMNI_MODE_KEY]) return;
    var next = changes[DYC_OMNI_MODE_KEY].newValue;
    cb(DYC_OMNI_MODES.indexOf(next) >= 0 ? next : 'none');
  });
}

/* ==========================================================
 * 九、调试态判定(2026-10-12;2026-10-16 修正)
 *
 * 调试面板自 2026-10-16 起由 src/content/debug-panel.js 独立承载,
 * 商品列表页与中控台**两组都注入** —— 旧注释「中控台不挂调试面板」已作废。
 * 这里只留判定函数,供各页面脚本按需读取调试态。
 *
 * ⚠️ 2026-10-16 修一处死引用:
 *   原实现是 `return DYC_DEBUG_ON || ...`,但 **DYC_DEBUG_ON 从未被定义过**
 *   —— 该函数一旦被调用就抛 ReferenceError。它此前没有任何调用点,所以一直
 *   没暴露(本次核对调试链路时才发现)。现已补上这个缓存变量,并订阅开关
 *   变化保持同步。
 * ========================================================== */

/** 调试开关的本地镜像(storage 是异步的,同步判定需要一个镜像值) */
var DYC_DEBUG_ON = false;

try {
  // 防重复注入守卫（2026-11-01 体检 P1）：本文件其余部分全是幂等的
  // var/function 声明，重复执行无害；唯一有副作用的是这里的 onChanged
  // 订阅 —— 重复注入会叠双份监听。用全局标记拦住。
  if (!window.__DYC_FLAGS_WATCH__) {
    window.__DYC_FLAGS_WATCH__ = true;
    chrome.storage.local.get('dybDebug', function (r) {
      if (chrome.runtime.lastError) return;
      DYC_DEBUG_ON = !!(r && r.dybDebug);
    });
    chrome.storage.onChanged.addListener(function (changes, area) {
      if (area !== 'local' || !changes || !changes.dybDebug) return;
      DYC_DEBUG_ON = !!changes.dybDebug.newValue;
    });
  }
} catch (e) { /* storage 不可用时退回纯 URL 判定 */ }

/** 调试态判定(URL 或开关任一为真),供各页面脚本共用 */
function dycIsDebugMode() {
  return DYC_DEBUG_ON || /[?&]dyb_debug=1/.test(location.href);
}

/* ==========================================================
 * 十、诊断采集:控件的友好名(2026-10-13 新增,反馈诊断包)
 *
 * ⚠️ 这张表**不是**「要采集哪些控件」的登记表 —— 采集侧(diag.js)按
 *    dyb-/dyc- 前缀**自动扫描**全页注入元素并取根元素分组,新增控件
 *    自动跟上,永远不会因为「忘了登记」而漏采。
 *    本表只负责把扫到的标识翻译成中文名,给助手阅读时用。
 *    **没登记的控件照采,只是显示原始标识**(如 .dyb-has-track)。
 *
 * 键 = diag.js 的 tagOf() 产出(优先 #id,其次第一个前缀 class)。
 * ========================================================== */

var DYC_DIAG_WIDGET_NAMES = {
  '#dyb-nav-box': '导航盒子',
  '#dyb-status-bar': '状态条',
  '#dyb-debug-panel': '调试面板',
  '#dyc-search-fab': '实体搜索按钮',
  '#dyc-search-pill': '胶囊搜索框',
  '#dyc-omni-shell': '全能搜索外壳',
  '#dyc-scan-shade': '扫描白幕',
  '#dyc-fb-host': '反馈面板宿主',
  '.dyc-back-top': '上滑到顶按钮',
  '.dyc-back-bottom': '下滑到底按钮',
  '.dyc-tool': '工具栏按钮位',
  '.dyc-tool-btn': '工具栏按钮',
  '.dyc-omni-btn': '全能搜索按钮',
  '.dyc-tip': '悬浮提示',
  '.dyb-badge': '序号徽标',
  '.dyb-clear-btn': '清空库存按钮',
  '.dyb-history': '历史盒子',
  '.dyb-dialog-root': '确认弹窗',
  '.dyb-panel': '弹窗面板',
  '.dyb-status': '状态条目',
  '.dyc-ct-btn': '货号按钮（罗盘商品表）',
  '.dyc-ar-lamp': '自动刷新指示灯（小黄车）',
  // 2026-10-24 渠道品「下架并删除」的两个入口（诊断报告里好认）
  '.dyc-cd-btn': '渠道品「下架并删除」按钮',
  '.dyc-cd-batch': '渠道品批量「下架并删除」按钮'
};
