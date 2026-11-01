/**
 * 微信小店 · 商品名完整显示
 * ============================================================
 * 【解决什么问题】(用户 2026-10-31 提出)
 *
 *   微信小店商品列表把商品名截成一行加省略号,想看全名只能点进详情。
 *   用户原话:「做名称不隐藏的这个功能的兼容」—— 把中控台那套
 *   「名称换行」(src/live/name-wrap.js)的思路搬到微信小店。
 *
 *   真机实测(store.weixin.qq.com/shop/goods/list,1707×929 @1.5x):
 *     商品名元素盒子 288×20,文本宽 321~447,截断来源
 *     `text-overflow: ellipsis + white-space: nowrap`;
 *     文本高/可见高 20/20 —— **没有纵向行数钳制**,纯粹单行省略号。
 *   ⇒ 只要解除 nowrap 并让高度随内容,名字自然折行,不需要动列宽。
 *
 * 【为什么本文件自己穿透 shadow,不用 page-probe.js 的 deepQuery】
 *
 *   页面结构报告能采到列表,是因为探针(page-probe.js)是按需注入的
 *   一次性采集工具;它**不在 manifest 的常驻注入列表里**。本脚本是
 *   常驻功能,不能依赖一个不存在的全局函数,所以自带一套最小穿透。
 *
 *   微信小店是 micro-app 微前端:业务 DOM 在 <micro-app> 的 open
 *   shadowRoot 里(实测 5591 个元素中 5000 个在 shadow 内),顶层
 *   document 只有壳和左侧菜单。micro-app 另有 iframe 沙箱形态
 *   (同源 about:blank),故一并下潜。
 *
 * 【只动名称元素自己,绝不碰表格】
 *
 *   白名单属性(关开关按备份逐个还原):
 *     white-space: normal        解除「不换行」← 核心
 *     word-break: normal         款号作为整体参与折行
 *     overflow-wrap: break-word  只有整串放不下才允许内部折断
 *     text-overflow: clip        去掉省略号(仅 nowrap 下生效,顺手清)
 *     overflow: visible          祖先若曾用 hidden 剪裁,一并放开
 *     height: auto / max-height: none  高度交给内容
 *     display: block + -webkit-line-clamp: none
 *                                仅当平台用 -webkit-box 钳行数时才写
 *
 *   折成两行以上时,再加三项「留白」(2026-10-31 用户反馈「不够美观」):
 *     line-height: 1.55          两行不再贴在一起(平台约 1.43)
 *     text-wrap: balance         两行长度尽量接近,不再是「排满 + 半行」
 *     padding-bottom: 2px        与下方「ID: …」留一点缝
 *   单行名字**不加**这三项 —— 保持平台原样,只治折行后的毛病。
 *
 *   **不设宽高、不改 td/tr/表格宽度、不删节点**。列宽由平台决定,
 *   名字在自己那一格(实测 288px)里折行,行高随内容长高 —— 这是
 *   「完整显示」必须付的代价,开关的 note 已如实写明。
 *
 * 【怎么找商品名 —— 语义类名优先,行为特征兜底】
 *
 *   1. 优先 `.goods_title_1`(报告里实测的平台类名,像手写语义名而非
 *      构建哈希,相对稳);
 *   2. 命中数为 0(平台改版)时退回行为特征扫描:行内有直接文本、
 *      真被横向截断(scrollWidth > clientWidth)、文本像名称
 *      (≥4 字、非价格/纯数字/平台标签)、最靠左的一个。
 *
 *   为什么不一上来就扫特征:一行里的「规格」「时间」列也可能被截断,
 *   全靠特征会把它们一起展开、把不相关的列撑高。语义类名是白名单,
 *   错不了;特征扫描只在白名单失效时当逃生口。
 *
 * 【幂等 = 标记 + 计算值双条件】(沿用 name-wrap 2026-10-15 的教训)
 *
 *   平台重渲染会重写元素的 style 属性,把我们的内联属性整段清空,
 *   而标记(React 不认识的陌生属性)会留下来。只看标记会导致
 *   「样式被抹 → 永不补涂 → 永久省略号」。所以复核计算值:
 *   仍是 nowrap 或仍有横向溢出 ⇒ 视为没处理过,重写一遍。
 *   重写不重复备份(否则备份里会存进我们自己写的值,关开关还原不回去)。
 *
 * 【页面是 SPA,判定放在脚本内部】
 *
 *   微信小店全程前端路由(登录页→后台不刷新),content_scripts 只在
 *   文档导航时注入一次。所以本脚本注入整个 store 域,内部按
 *   location.pathname 判「是不是商品列表」;路由变化由 1 秒轮询
 *   对比 location.href 发现 → 重置缓存 → 重新定位。
 *   ⚠️ 这就是 manifest 的 matches 必须写整域、不能只写 /shop/goods/list
 *      的原因:只写深路径的话,用户从菜单点进商品列表永远不会触发生效。
 *
 * 【触发时机】
 *
 *   · MutationObserver 挂 document.body **和** 找到的 shadowRoot
 *     (shadow 内部变更,顶层 document 的观察器看不到);
 *   · 回调用 rAF 当帧补涂(同帧多次变更合并),再补一次 300ms 尾扫
 *     (平台有时在插入节点的下一个任务里才补齐结构);
 *   · 2 秒兜底轮询:微前端整体重建、tbody 被换掉时重新定位并挂观察器;
 *   · 首屏 [1500, 4000, 8000] 三次补涂,兜住晚渲染。
 *
 * 【消息口径】
 *
 *   · 开关切换:报一声「已开启 / 已关闭」(source: 商品全名);
 *   · 首次成功展开:报一条,带数量。这是**用户确认它真的生效了**的
 *     唯一凭据(页面在 shadow 里,肉眼看不到注入痕迹);
 *   · 之后翻页/筛选重建再补涂:**不再报** —— 那只是同一次动作的延续,
 *     报多了就是噪音。
 *
 * 【已知边界(如实记录,不掩盖)】
 *
 *   1. 名字被**祖先容器 overflow 剪裁**(自身样式没截断)时,本检测
 *      找不到。表现为「开关开了但没变化」,不会乱改布局。
 *   2. 行高会变高(名字折行撑开那一格),列表整体变长 —— 必然结果。
 *   3. 语义类名 `.goods_title_1` 若被平台改掉,退回特征扫描;特征扫描
 *      判据比类名宽,极端情况下可能多处理同行的其他截断文本。
 *   4. 只覆盖商品列表页(/shop/goods/list)。其他页面即使有表格不处理。
 * ============================================================
 */

(function dycWxGoodsTitle() {
  'use strict';

  // 防重复注入(SPA 路由回切、脚本意外重跑时不会叠出多个观察器)
  if (window.__DYC_WX_GOODS_TITLE__) return;
  window.__DYC_WX_GOODS_TITLE__ = true;

  /* ---------- 依赖自检 ---------- */
  // flags.js(开关层)与 dialog.js(toast)必须先加载。依赖不齐静默退出,
  // 绝不半途乱猜页面结构。
  if (typeof dycReadFlags !== 'function') return;

  var MARK = 'data-dyc-wxtitle';
  var MARK_ORIG = 'data-dyc-wxtitle-orig';
  // 标记值即「处理到第几版」。2026-10-31 加排版留白后从 '1' 提到 '2' ——
  // 浏览器里已经跑过 v1 的元素（标记为 '1'）会被当成「未完成」重新处理一次，
  // 补上留白。不看版本号的话，老元素已满足幂等条件、永远拿不到新样式。
  var MARK_VER = '2';

  // 我们会写内联的全部属性(还原时按这份清单清)
  // lineHeight / textWrap / paddingBottom 是 2026-10-31「排版留白」新增的,
  // 同样进清单 —— 否则关开关时这三项会留在元素上。
  var PROPS = ['whiteSpace', 'wordBreak', 'overflowWrap', 'textOverflow',
               'overflow', 'display', 'height', 'maxHeight', 'webkitLineClamp',
               'lineHeight', 'textWrap', 'paddingBottom'];

  var NAME_CLASS = 'goods_title_1';   // 平台语义类名(报告实测)
  var PAGE_RE = /^\/shop\/goods\/list/;   // 商品列表页
  var MIN_ROWS = 3;                   // tbody 至少这么多行才算商品表格

  // 穿透上限:与 page-probe.js 同口径(深度 6 / 节点预算 2 万)
  var MAX_DEPTH = 6;
  var NODE_BUDGET = 20000;

  // 平台标签/价格特征:命中的文本不是商品名称
  var NOT_NAME = /^(到手价|售出|已售|库存|货号|规格|ID|时间|销量|佣金)/;
  var ONLY_NUM = /^[\d\s.,:%\-+()（）#¥￥]+$/;

  var flags = null;
  var observers = [];
  var observedRoots = [];      // 与 observers 一一对应,重定位时断开
  var tbody = null;            // 已定位的商品表格
  var tbodyRoot = null;        // 它所在的根(document / shadowRoot / iframe doc)
  var pending = false;
  var tailTimer = null;
  var lastHref = '';           // SPA 路由变化检测
  var prevOn = null;           // 开关切换反馈用
  var pendingRelayout = false; // 刚 resize 过,下次补涂要清残留留白

  function enabled() {
    return !!flags && flags.wxGoodsFullTitle !== false;
  }

  /* ---------- 跨 realm 取样式 ---------- */

  /**
   * iframe 内元素属于**另一个 realm**,主文档的 getComputedStyle 对它
   * 不生效(实测量出来是空值)。必须用元素自己文档的 window。
   */
  function csOf(el) {
    try {
      var doc = el.ownerDocument;
      var win = (doc && doc.defaultView) || window;
      return win.getComputedStyle(el);
    } catch (e) {
      return null;
    }
  }

  /** 扩展自己注入的节点(id 以 dyb- 开头)一律不碰 */
  function isExtNode(el) {
    if (!el || !el.getAttribute) return false;
    if (el.id && el.id.indexOf('dyb-') === 0) return true;
    // 2026-10-31 行内复制按钮(wx-goods-tools.js 注入):它不是页面文本。
    // 兜底扫描若不排除,「复制链接」四个字满足「≥4 字、像名称」,
    // 可能被当成商品名展开。
    if (el.getAttribute('data-dyc-wx-btn') !== null) return true;
    if (el.getAttribute('data-dyc-wx-btnwrap') !== null) return true;
    return false;
  }

  /* ---------- 穿透查找 ---------- */

  function iframeDocOf(el) {
    try {
      var d = el.contentDocument;
      return d && d.documentElement ? d : null;   // 跨域会抛异常,由 catch 兜
    } catch (e) {
      return null;
    }
  }

  /**
   * 收集所有可查询的根:document + open shadowRoot + 同源 iframe 文档。
   * 只在「定位阶段」调用(缓存后不再频繁跑),所以全量遍历可接受;
   * 仍设深度与节点预算双上限,避免大页面把主线程拖住。
   */
  function collectRoots() {
    var roots = [];
    var queue = [{ root: document, depth: 0 }];
    var budget = NODE_BUDGET;

    while (queue.length > 0 && budget > 0) {
      var item = queue.shift();
      if (!item || !item.root) continue;
      roots.push(item.root);
      if (item.depth >= MAX_DEPTH) continue;

      var els;
      try { els = item.root.querySelectorAll('*'); } catch (e) { continue; }
      for (var i = 0; i < els.length && budget > 0; i++) {
        budget--;
        var el = els[i];
        if (isExtNode(el)) continue;
        if (el.shadowRoot) queue.push({ root: el.shadowRoot, depth: item.depth + 1 });
        if (el.tagName === 'IFRAME') {
          var d = iframeDocOf(el);
          if (d) queue.push({ root: d, depth: item.depth + 1 });
        }
      }
    }
    return roots;
  }

  /** 在所有根里找行数最多的 tbody(商品表格),返回 { tbody, root } */
  function locateTable() {
    var roots = collectRoots();
    var best = null;
    var bestRows = 0;

    for (var i = 0; i < roots.length; i++) {
      var list;
      try { list = roots[i].querySelectorAll('tbody'); } catch (e) { continue; }
      for (var j = 0; j < list.length; j++) {
        var tb = list[j];
        if (isExtNode(tb)) continue;
        var n = 0;
        try { n = tb.querySelectorAll('tr').length; } catch (e2) { n = 0; }
        if (n > bestRows) { bestRows = n; best = { tbody: tb, root: roots[i] }; }
      }
    }
    if (!best || bestRows < MIN_ROWS) return null;
    return best;
  }

  /* ---------- 商品名识别 ---------- */

  function hasDirectText(el) {
    var nodes = el.childNodes;
    for (var i = 0; i < nodes.length; i++) {
      var n = nodes[i];
      if (n.nodeType === 3 && String(n.nodeValue || '').trim()) return true;
    }
    return false;
  }

  function looksLikeName(text) {
    var t = String(text || '').trim();
    if (t.length < 4 || t.length > 200) return false;
    if (ONLY_NUM.test(t)) return false;
    if (NOT_NAME.test(t)) return false;
    return true;
  }

  /**
   * 在一行里挑出商品名元素。
   *
   * ① 语义类名优先 —— 白名单,不会误伤规格/时间列;
   * ② 类名没命中说明平台改版,退回行为特征:真被横向截断 + 像名称,
   *    取文档顺序里**第一个**(商品名是该行最靠左的文本列)。
   */
  function pickNameEl(tr) {
    try {
      var byClass = tr.querySelector('.' + NAME_CLASS);
      if (byClass) return byClass;
    } catch (e) { /* 类名选择器异常,走兜底 */ }

    var walker;
    try {
      walker = tr.ownerDocument.createTreeWalker(tr, NodeFilter.SHOW_ELEMENT, null);
    } catch (e2) {
      return null;
    }
    var el;
    while ((el = walker.nextNode())) {
      if (isExtNode(el)) continue;
      if (!hasDirectText(el)) continue;
      if (el.clientWidth < 10 || el.clientHeight < 8) continue;
      // 真截断:横向溢出(单行省略号)。纵向不判 —— 名称区本来就只有一行高。
      if (el.scrollWidth - el.clientWidth <= 0) continue;
      if (!looksLikeName(el.textContent)) continue;
      return el;
    }
    return null;
  }

  /**
   * 已处理过?看**计算值**而不是只看标记(理由见文件头「幂等」)。
   * 平台把样式抹掉、或用 !important 压回来,都能被发现。
   */
  function stillUnwrapped(el) {
    var cs = csOf(el);
    if (!cs) return false;
    if (cs.whiteSpace !== 'normal') return false;                  // 被压回 nowrap
    if (el.scrollWidth - el.clientWidth > 2) return false;         // 仍横向溢出
    if (el.style.height !== 'auto') return false;                  // 内联被抹
    // 折成两行以上却没有行距 —— 可能是窗口变窄后才折的（展开当时是单行，
    // 没走 addBreathing）。补一次，否则窗口一缩就回到「两行贴在一起」。
    if (!el.style.lineHeight && countLines(el) >= 2) return false;
    return true;
  }

  /* ---------- 展开 / 还原 ---------- */

  function unwrapBase(el) {
    var cs = csOf(el);
    var backed = el.getAttribute(MARK_ORIG) !== null;
    if (!backed) {
      var orig = {};
      for (var i = 0; i < PROPS.length; i++) {
        var p = PROPS[i];
        var v = el.style[p];
        if (v) orig[p] = v;
      }
      try { el.setAttribute(MARK_ORIG, JSON.stringify(orig)); } catch (e) { /* 备份失败就不备份,还原时清空 */ }
    }

    el.style.whiteSpace = 'normal';
    el.style.wordBreak = 'normal';          // 款号整体参与折行,不腰斩
    el.style.overflowWrap = 'break-word';   // 整串放不下才允许内部折断
    el.style.textOverflow = 'clip';
    el.style.overflow = 'visible';
    // 仅当平台用 -webkit-box 钳行数时才换 display 逃离;其余 display 一律不动
    if (cs && (cs.display === '-webkit-box' || cs.display === '-webkit-inline-box')) {
      el.style.display = 'block';
      el.style.webkitLineClamp = 'none';
    }
    el.style.height = 'auto';
    el.style.maxHeight = 'none';
    el.setAttribute(MARK, MARK_VER);
  }

  /**
   * 数名字现在折了几行。
   *
   * 用 scrollHeight ÷ line-height 估算,不用 Range —— Range 对每个元素要建
   * 两个 DOM 节点、取 getClientRects,50 行一遍下来开销明显;这里只需要
   * 「是不是 2 行以上」这个粗略判断,估算足够。
   * line-height 为 normal(platform 常见)时按字号 1.2 倍估。
   */
  function countLines(el) {
    var cs = csOf(el);
    var lh = 0;
    var fs = 0;
    try {
      lh = parseFloat(cs && cs.lineHeight);
      fs = parseFloat(cs && cs.fontSize);
    } catch (e) { lh = 0; fs = 0; }
    if (!lh || isNaN(lh)) lh = (fs || 14) * 1.2;
    // 计算样式在浏览器里恒为 px（如 21.7px）；但少数环境（含 jsdom）会把
    // 无单位倍数原样返回。数值 < 5 不可能是行高像素，按倍数换算。
    else if (lh < 5) lh = lh * (fs || 14);
    var h = el.scrollHeight || 0;
    if (!h) return 1;
    return Math.max(1, Math.round(h / lh));
  }

  /**
   * 折行后的「留白」(2026-10-31 用户反馈「感觉不够美观」→ 选「调整排版留白」)。
   *
   * 只对**真的折成两行以上**的名字生效,单行保持平台原样:
   *   line-height 1.55   两行不再贴在一起(平台约 1.43,看着憋)
   *   text-wrap: balance 让两行长度尽量接近 —— 实测第一行排满、第二行只剩
   *                      「袖上衣 NE1C1162W」半行,像断句。balance 后两行
   *                      大致等长,视觉上是「两行名字」而不是「一句被切断的话」。
   *                      **Chromium 114+ 才有**,老内核静默忽略,回退普通折行,
   *                      无副作用 —— 这是渐进增强,不是必需项。
   *   padding-bottom 2px  与下方「ID: …」之间留一点缝
   *
   * 不动的:字号(与平台一致)、列宽(动了右侧指标列要重排)、其他列。
   */
  function addBreathing(el) {
    el.style.lineHeight = '1.55';
    // 属性名带连字符,必须用 setProperty;写成驼峰 textWrap 在部分内核上
    // 静默无效(这条在 2026-10-24 渠道品按钮上踩过,间距整套空转还没报错)
    try { el.style.setProperty('text-wrap', 'balance'); } catch (e) { /* 老内核忽略 */ }
    el.style.paddingBottom = '2px';
  }

  function restoreEl(el) {
    var orig = {};
    try { orig = JSON.parse(el.getAttribute(MARK_ORIG) || '{}') || {}; } catch (e) { orig = {}; }
    for (var i = 0; i < PROPS.length; i++) {
      var p = PROPS[i];
      el.style[p] = orig[p] || '';
    }
    el.removeAttribute(MARK);
    el.removeAttribute(MARK_ORIG);
  }

  /** 在所有根里找已标记元素(顶层 querySelectorAll 看不到 shadow 内) */
  function restoreAll() {
    var roots = collectRoots();
    for (var i = 0; i < roots.length; i++) {
      var list;
      try { list = roots[i].querySelectorAll('[' + MARK + ']'); } catch (e) { continue; }
      for (var j = 0; j < list.length; j++) restoreEl(list[j]);
    }
  }

  /**
   * 清掉「曾经折行、现在变回单行」元素的留白。
   *
   * 窗口拖宽后两行会变回一行，但 line-height / padding-bottom 是内联的、
   * 不会自己消失 —— 留着会让这一行比别的行高 2px、看着参差。
   * 只在 resize 之后跑一次（见 pendingRelayout），不在每次补涂时扫。
   */
  function clearStaleBreathing() {
    if (!tbody || !tbody.isConnected) return;
    var rows;
    try { rows = tbody.querySelectorAll('tr'); } catch (e) { return; }
    for (var i = 0; i < rows.length; i++) {
      var el = pickNameEl(rows[i]);
      if (!el || !el.style.lineHeight) continue;
      if (countLines(el) > 1) continue;
      el.style.lineHeight = '';
      el.style.paddingBottom = '';
      try { el.style.removeProperty('text-wrap'); } catch (e2) { /* 老内核无此属性 */ }
    }
  }

  /* ---------- 补涂主流程 ---------- */

  function isGoodsListPage() {
    try { return PAGE_RE.test(location.pathname); } catch (e) { return false; }
  }

  function applyAll() {
    if (!enabled() || !isGoodsListPage()) return;

    // 窗口刚被拖动过:先清掉「两行变单行」后残留的留白
    if (pendingRelayout) {
      pendingRelayout = false;
      clearStaleBreathing();
    }

    // 表格被换掉(微前端重建、翻页重渲染)时重新定位
    if (!tbody || !tbody.isConnected) {
      var found = locateTable();
      if (!found) return;
      tbody = found.tbody;
      tbodyRoot = found.root;
      watchRoot(tbodyRoot);
    }

    var rows;
    try { rows = tbody.querySelectorAll('tr'); } catch (e) { return; }
    if (!rows || rows.length === 0) return;

    // ① 只读收集
    var todo = [];
    for (var i = 0; i < rows.length; i++) {
      var el = pickNameEl(rows[i]);
      if (!el) continue;
      if (el.getAttribute(MARK) === MARK_VER && stillUnwrapped(el)) continue;   // 幂等双条件
      todo.push(el);
    }
    // ② 统一写基础展开(读-写分离,避免读一行写一行触发强制重排)
    for (var k = 0; k < todo.length; k++) unwrapBase(todo[k]);
    // ③ 再统一测量:只给**真的折成两行以上**的加留白。
    //    测量必须放在 ② 之后 —— 展开前高度是固定 20px,量不出行数。
    var wrapped = [];
    for (var m = 0; m < todo.length; m++) {
      if (countLines(todo[m]) >= 2) wrapped.push(todo[m]);
    }
    for (var n = 0; n < wrapped.length; n++) addBreathing(wrapped[n]);

    // 展开完成**不报消息**（用户 2026-10-31：「商品全名展开，不需要弹出消息提醒」）。
    // 这是纯视觉效果：名字变全了一眼看得到，消息条只会白响一次。
    // 开关切换的那条（下面 dycWatchFlags 里）仍保留 —— 那是用户主动操作的回应。
  }

  /* ---------- 观察器 ---------- */

  function watchRoot(root) {
    if (!root || !root.nodeType) return;
    for (var i = 0; i < observedRoots.length; i++) {
      if (observedRoots[i] === root) return;   // 已观察
    }
    try {
      var ob = new MutationObserver(scheduleApply);
      // 属性变化不跟(childList 足够:行重建等于节点替换);
      // 但平台改 class 不会重建节点,那种情况由 stillUnwrapped 在
      // 下一次补涂时发现 —— 而补涂由 2 秒兜底轮询保证不会漏。
      ob.observe(root, { childList: true, subtree: true });
      observers.push(ob);
      observedRoots.push(root);
    } catch (e) { /* 根不稳定(已被移除)时放弃这次,轮询会再来 */ }
  }

  function dropObservers() {
    for (var i = 0; i < observers.length; i++) {
      try { observers[i].disconnect(); } catch (e) { /* 已断开 */ }
    }
    observers = [];
    observedRoots = [];
  }

  /**
   * 当帧补涂 + 300ms 尾扫(沿用 name-wrap 2026-10-15 的两拍调度):
   * 同帧内先跑我们、再绘制,省略号来不及显示;尾扫兜住「节点插入后
   * 下一任务才补齐结构」的平台行为。
   */
  function scheduleApply() {
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

  /* ---------- 启停 ---------- */

  function start() {
    watchRoot(document.body);
    applyAll();
  }

  function stop() {
    dropObservers();
    if (tailTimer !== null) { clearTimeout(tailTimer); tailTimer = null; }
    pending = false;
    tbody = null;
    tbodyRoot = null;
    restoreAll();
  }

  // 窗口宽度变化会改变折行数:变窄可能多折一行(要补留白),变宽可能变回
  // 单行(要清留白)。重活交给 scheduleApply 合并(rAF + 300ms 尾扫)。
  window.addEventListener('resize', function () {
    pendingRelayout = true;
    scheduleApply();
  });

  // 2 秒兜底:SPA 路由变化、微前端整体重建、tbody 被换掉时重新拉起。
  // 只做两件极轻的事(比对 href、检查 isConnected),不做全页扫描。
  setInterval(function () {
    if (!enabled()) return;
    var href = '';
    try { href = location.href; } catch (e) { return; }
    if (href !== lastHref) {
      lastHref = href;
      tbody = null;          // 换页了,表格引用作废
      tbodyRoot = null;
      if (isGoodsListPage()) start();
      return;
    }
    if (isGoodsListPage() && (!tbody || !tbody.isConnected)) {
      watchRoot(document.body);
      applyAll();
    }
  }, 2000);

  /* ---------- 开关订阅 ---------- */

  dycReadFlags().then(function (f) {
    flags = f;
    prevOn = enabled();
    if (enabled()) start();
  });

  if (typeof dycWatchFlags === 'function') {
    dycWatchFlags(function (f) {
      flags = f;
      var now = enabled();
      if (prevOn !== null && now !== prevOn && typeof toast === 'function') {
        toast(now ? '已开启' : '已关闭', 'info', { source: '商品全名' });
      }
      prevOn = now;
      if (now) start();
      else stop();
    });
  }

  // 首屏兜底:微前端渲染得晚,定时补涂三次
  [1500, 4000, 8000].forEach(function (ms) {
    setTimeout(function () {
      if (enabled()) applyAll();
    }, ms);
  });
})();
