/**
 * 小红书千帆（ark）· 商品列表「商品名完整显示」
 * ============================================================
 * 【需求（2026-11-17 用户）】
 *   地址：https://ark.xiaohongshu.com/app-item/list/shelf
 *   原话：「小红书千帆商店，也做商品名称不折叠的功能。」
 *   口径与中控台 xhsNameWrap 完全一致：只让名称完整换行，不改卡片宽度、
 *   不动价格/描述/其它列。
 *
 * 【为什么最初没直接复用 src/live/xhs-name-wrap.js】
 *   那一版是**按类名写死**的（.goods-card__title-block > span.--color-text-title），
 *   依据是中控台导出的结构报告。千帆是**另一个子应用**（ark 域），第一轮
 *   拿不到结构报告，照抄的选择器一旦不命中，表现就是「开关开着、页面毫无变化」
 *   —— 静默失效，用户在真机上只能得出「没用」。所以第一版做成运行时探测。
 *
 * 【结构报告到手后改成两层（2026-11-17 23:18 用户实测，v26.11.17.1）】
 *   ① **类名直通（首选）**：名称 = div.product-main > span.d-text.d-text-block，
 *      实测 268 固定宽、ellipsis + white-space:nowrap（文本宽 492 / 可见 268），
 *      位于表格固定左列 td.d-table__cell--fixed-left 内，行高 111。
 *      有了确凿路径就写静态规则 —— 零 JS、零竞态，平台重渲染碰不到样式表。
 *   ② **探测兜底**：平台哪天换类名，静态规则就落空；这时按下面三段判据
 *      把「确实被折叠的商品名」打上属性标记，再按属性展开，不至于一改就全黑。
 *   两层都保留：① 是常态，② 是保险。用户第一轮给的原话是「以后忘了发结构报告
 *   你就让我发」—— 说明结构还会变，兜底这条不能省。
 *
 * 【探测三段判据（缺一不可，用来把误伤压到最低）】
 *   ① 形态：叶子文本（自身没有块级子元素），长度 12~200 字，
 *      排除价格 / 日期 / 纯数字 / 时间串；
 *   ② 截断：计算样式带 -webkit-line-clamp>0 或 overflow:hidden，
 *      **且内容确实溢出**（scrollHeight > clientHeight，或省略号态下
 *      scrollWidth > clientWidth）—— 不溢出说明没被折叠，不该动它；
 *   ③ 场景：向上 4 层祖先里出现过 <img>（商品图），把「商品名称」与
 *      导航、表头、侧栏里同样被省略的文字区分开；表头（thead 内）一律排除。
 *   三条同时满足才动手。宁可漏（漏了只是没展开，用户会说"这条没生效"），
 *   不可误（误了就是整页布局变形，而且是用户看不懂的那种）。
 *
 * 【为什么用「属性 + 样式表」，不用内联样式】
 *   中控台那一版的三轮事故已经证明：写在 React 管的元素内联样式上，
 *   平台重渲染会把它抹回原值，我们涂一遍它抹一遍，用户看到「时好时坏」。
 *   这里换成：JS 只给命中的元素打 ATTR 标记，展开规则写在一条独立 <style>
 *   里按属性命中 ⇒ 平台管它的内联，我们管我们的样式表，不再抢同一个属性。
 *   标记被重渲染弄丢时由 MutationObserver 补扫重新打（防抖 300ms，幂等）。
 *
 * 【开关】xhsShopNameWrap（2026-11-17：小红书千帆独立分组、独立开关，
 *   与中控台 xhsNameWrap 互不影响 —— 与第一批「小红书专用行」同一口径）。
 *   ★ dycReadFlags() 返回 Promise，必须 .then，同步取用会永远拿到 Promise。
 * ============================================================
 */
(function () {
  'use strict';

  // 防重复注入（SPA 路由回切 / 脚本意外重跑时不重复装观察器）
  if (window.__dycXhsArkNameLoaded) return;
  window.__dycXhsArkNameLoaded = true;

  var STYLE_ID = 'dyc-xhs-ark-name-style';
  var ATTR = 'data-dyc-ark-name';
  var HOST_ATTR = 'data-dyc-ark-name-host';
  var DEBOUNCE = 300;
  var MIN_LEN = 12;          // 12 字以内的名字几乎不可能被折叠，省一次样式计算
  var MAX_LEN = 200;         // 超过 200 字的多半是富文本描述块，不是名称
  var MAX_SCAN = 12000;      // 扫描上限：正常后台整页 DOM 远低于此，防止异常页卡死
  var ANCESTOR_IMG = 4;      // 向上找商品图的层数
  var HOST_DEPTH = 4;        // 向上让位的层数（报告：名称→product-main→d-space→d-table__cell→td）

  /* 结构报告（2026-11-17 23:18 实测）给出的列表页名称路径：
   *   td.d-table__cell--fixed-left > div.d-table__cell
   *     > div.d-space.d-space-horizontal > div.product-main
   *       > span.d-text.d-text-block        ← 268×22，文本宽 492，ellipsis + nowrap */
  var NAME_SEL = 'div.product-main > span.d-text.d-text-block';

  /* 多地址退货策略页（2026-11-17 23:25 实测）：
   *   .sku-card-container > .d-space-horizontal > div
   *     > .d-space-horizontal.d-space-default
   *       > span.d-text.--color-text-paragraph   ← 200×22，文本宽 419，ellipsis + nowrap
   * ⚠️ 类名以 `--` 开头，写成 `.--color-text-paragraph` 在老内核（360 极速X）
   *    上解析不稳（jsdom 能过不代表真机内核能过）⇒ 一律用 CSS2 的
   *    [class~="…"] 属性选择器，兼容性最广。 */
  var NAME_SEL_RETURN = '.sku-card-container span.d-text[class~="--color-text-paragraph"]';

  /* 退货页商品 ID 行（同一份 23:25 报告）：.sku-id，200×20、30 字，
   * 文本宽 202 / 可见 200 —— 只差省略号那几个像素，同样是 ellipsis + nowrap。
   * 用户 2026-11-17 夜：「把商品名称和商品ID做出来不隐藏就可以了」。 */
  var ID_SEL_RETURN = '.sku-card-container .sku-id';

  /* ---------- 样式：类名直通（首选）+ 属性命中（兜底） ---------- */

  /** 一套展开声明：解省略号 / 解钳制 / 解定高。两页与兜底共用同一份。 */
  var UNFOLD = [
    '  white-space: normal !important;',
    '  display: block !important;',
    '  height: auto !important;',
    '  max-height: none !important;',
    '  min-height: 0 !important;',
    '  overflow: visible !important;',
    '  -webkit-line-clamp: unset !important;',
    '  -webkit-box-orient: initial !important;',
    '  text-overflow: clip !important;',
    '  word-break: normal !important;',
    '  overflow-wrap: break-word !important;'
  ];

  /** 只松高度、不碰 overflow —— 给祖先让位用（改 overflow 可能破坏圆角裁剪） */
  var YIELD = [
    '  height: auto !important;',
    '  max-height: none !important;',
    '  min-height: 0 !important;'
  ];

  function rule(sel, decls) { return sel + ' {\n' + decls.join('\n') + '\n}'; }

  var CSS = [
    '/* ── ① 首选路径：按结构报告实测的类名直接命中，不依赖任何 JS 标记 ——',
    '   React 怎么重渲染都改不了我们这条样式表，也就不存在「它涂一遍我涂一遍」。 */',

    '/* 列表页：名称 = div.product-main > span.d-text.d-text-block，268 定宽，',
    '   截断来源 = text-overflow:ellipsis + white-space:nowrap（文本宽 492/可见 268）。 */',
    rule(NAME_SEL, UNFOLD),
    '/* 列表页祖先让位。★ 必须写静态：类名直通之后探测会跳过这些元素、',
    '   不再打 HOST 标记，靠 hostsOf 让位的那条路在这页等于没跑。',
    '   表格 td 的 height 是最小高度语义，放成 auto 不会塌行。 */',
    rule('td.d-table__cell--fixed-left,\n'
       + 'td.d-table__cell--fixed-left .d-table__cell,\n'
       + 'td.d-table__cell--fixed-left .d-space-horizontal,\n'
       + 'div.product-main', YIELD),

    '/* 退货页：名称 = .sku-card-container span.d-text.--color-text-paragraph，',
    '   200 定宽，截断来源同上（文本宽 419/可见 200）。 */',
    rule(NAME_SEL_RETURN, UNFOLD),
    '/* 退货页商品 ID：.sku-id（200×20、30 字，同样 ellipsis + nowrap）。',
    '   ★ 断行规则与名称**不同**：ID 是一长串无空格的字母数字，',
    '   word-break:normal 根本断不开 ⇒ 放开省略号后仍是一整条被列宽截断的长串。',
    '   这里必须 break-all + anywhere，让它在任意字符处折行。 */',
    rule(ID_SEL_RETURN, [
      '  white-space: normal !important;',
      '  display: block !important;',
      '  height: auto !important;',
      '  max-height: none !important;',
      '  min-height: 0 !important;',
      '  overflow: visible !important;',
      '  text-overflow: clip !important;',
      '  word-break: break-all !important;',
      '  overflow-wrap: anywhere !important;',
      '  -webkit-line-clamp: unset !important;',
      '  -webkit-box-orient: initial !important;'
    ]),

    '/* 退货页祖先让位：卡片 290×62、名称行 200×22，名称或 ID 折成多行时都要跟着长高。 */',
    rule('.sku-card-container,\n'
       + '.sku-card-container .d-space-horizontal', YIELD),

    '/* ── ② 兜底路径：平台改类名（结构变了）时由 scan() 打标记命中。',
    '   全部 !important：平台的 clamp / overflow / 定高可能写在类或内联上，',
    '   普通声明压不过（中控台第三轮真机教训：盒高被钉住，文字溢出盖住下一行）。 */',
    rule('[' + ATTR + '="1"]', UNFOLD),
    '/* 祖先让位（兜底路径）：只放开「高度受限 + overflow 裁剪」的最近几层',
    '   （见 hostsOf），范围可控 —— 不写成通配，避免波及整页。 */',
    rule('[' + HOST_ATTR + '="1"]', YIELD.concat(['  overflow: visible !important;']))
  ].join('\n');

  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    var st = document.createElement('style');
    st.id = STYLE_ID;
    st.setAttribute('data-dyc-skip', '1');
    st.textContent = CSS;
    (document.head || document.documentElement).appendChild(st);
  }

  function removeStyle() {
    var st = document.getElementById(STYLE_ID);
    if (st && st.parentNode) st.parentNode.removeChild(st);
  }

  /* ---------- 页面判定 ---------- */

  /**
   * 作用页 = 千帆商品列表 **或** 多地址退货策略页。
   * 两个键都来自 flags.js（页面模式唯一真源），不在这里另写正则。
   */
  function onTargetPage() {
    try {
      var pat = window.DYC_PAGE_PATTERNS;
      if (!pat) return false;
      var href = location.href;
      return !!((pat.xhsArkList && pat.xhsArkList.test(href))
             || (pat.xhsArkReturn && pat.xhsArkReturn.test(href)));
    } catch (e) { return false; }
  }

  /* ---------- 探测 ---------- */

  /** 自身没有块级子元素（高亮关键词时名称会被拆成 span/b，这些算叶子） */
  function isLeafText(el) {
    var kids = el.children;
    if (!kids || !kids.length) return true;
    for (var i = 0; i < kids.length; i++) {
      if (!/^(SPAN|B|I|EM|STRONG|FONT|MARK|BR|S|U)$/.test(kids[i].tagName)) return false;
    }
    return true;
  }

  /** 文本形态像不像商品名（排除价格 / 日期 / 纯数字 / 时间） */
  function looksLikeName(text) {
    if (!text) return false;
    var len = text.length;
    if (len < MIN_LEN || len > MAX_LEN) return false;
    if (/^[¥￥$]?\s*[\d.,]+\s*(元|件|个|%|折)?$/.test(text)) return false;   // 价格
    if (/^\d{4}\s*[-/年.]\s*\d{1,2}/.test(text)) return false;                // 日期
    if (/^[\d\s:.\-+/]+$/.test(text)) return false;                           // 纯数字/时间
    var cjk = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
    return cjk >= 2 || /[A-Za-z]/.test(text);                                 // 至少要有点内容
  }

  /** 祖先里有没有商品图（把「商品名」与导航/侧栏里同样被省略的文字分开） */
  function nearImage(el) {
    var p = el.parentElement;
    for (var i = 0; i < ANCESTOR_IMG && p && p !== document.body; i++, p = p.parentElement) {
      try {
        if (p.querySelector && p.querySelector('img')) return true;
      } catch (e) { return false; }
    }
    return false;
  }

  /** 在表头里（"商品名称"这类列标题本身就短，但仍要挡一道） */
  function inThead(el) {
    var p = el;
    for (var i = 0; i < 6 && p; i++, p = p.parentElement) {
      var tag = p.tagName;
      if (tag === 'THEAD' || tag === 'TH') return true;
    }
    return false;
  }

  /**
   * 判定「这个元素真的被折叠了」→ 返回折叠方式，否则 null。
   * 关键：**内容溢出**与**样式钳制**必须同时成立。只看样式会把
   * 「设了 overflow:hidden 但内容本来就没超」的正常元素也展开。
   */
  function foldedHow(el) {
    var cs;
    try { cs = window.getComputedStyle(el); } catch (e) { return null; }
    if (!cs) return null;
    var clamp = '';
    try { clamp = cs.getPropertyValue('-webkit-line-clamp') || ''; } catch (e) { clamp = ''; }
    if (!clamp) clamp = cs.webkitLineClamp || '';
    var clampN = parseInt(clamp, 10) || 0;
    var hiddenY = cs.overflowY === 'hidden' || cs.overflow === 'hidden';
    var hiddenAny = hiddenY || cs.overflow === 'clip' || cs.overflowY === 'clip';
    var vOver = el.scrollHeight > el.clientHeight + 2;
    var hOver = el.scrollWidth > el.clientWidth + 2;
    if (clampN > 0 && (vOver || hOver)) return 'clamp';
    if (hiddenAny && cs.textOverflow === 'ellipsis' && hOver) return 'ellipsis';
    if (hiddenAny && vOver) return 'vclip';
    return null;
  }

  /**
   * 找出「被钳制的祖先」→ 返回数组（纯读，不写 DOM）。
   * 条件是「overflow 裁剪 + 高度受限」—— 这正是截断容器的特征；
   * 普通的 flex 行、表格单元格不会被误标（它们 overflow 是 visible）。
   */
  function hostsOf(el) {
    var out = [];
    var p = el.parentElement;
    for (var i = 0; i < HOST_DEPTH && p && p !== document.body; i++, p = p.parentElement) {
      if (p.getAttribute(HOST_ATTR) === '1') continue;
      var cs;
      try { cs = window.getComputedStyle(p); } catch (e) { continue; }
      if (!cs) continue;
      var clipped = cs.overflowY === 'hidden' || cs.overflow === 'hidden';
      var capped = (cs.maxHeight !== 'none' && cs.maxHeight !== '') || cs.height !== 'auto';
      if (clipped && capped) out.push(p);
    }
    return out;
  }

  /**
   * 表格结构元素一律不许当作「名称」处理。
   *
   * 【为什么（这条是硬伤，不是洁癖）】
   *   展开规则里有 display:block !important。命中 <td> 就是把单元格改成块级，
   *   整张表的列宽与行结构当场错乱 —— 千帆商品列表很可能就是表格，
   *   而 td 上的 overflow:hidden + 定高在截断实现里恰恰很常见。
   *   宁可这一格不展开，也不能把表拆了：名称通常在 td 内部的 span/div 上，
   *   那个 span 才是我们要打的标记。
   */
  function isLayoutEl(el) {
    return /^(TD|TH|TR|TABLE|TBODY|THEAD|TFOOT|COL|COLGROUP)$/.test(el.tagName);
  }

  /**
   * 这个元素是不是已经被 ① 的类名规则管住了（product-main 下的 d-text-block）。
   * 是就不必再打标记：样式表已经生效，标记只会让诊断数虚高、
   * 并在关开关时多跑一遍清理。
   */
  function coveredByNameRule(el) {
    if (!el.classList) return false;
    var p = el.parentElement;
    // 列表页：div.product-main > span.d-text.d-text-block
    if (el.classList.contains('d-text-block')
        && p && p.classList && p.classList.contains('product-main')) return true;
    // 退货页：.sku-card-container 内、名称行（.d-space-default）里的
    // span.d-text.--color-text-paragraph —— 只认名称行，不认卡片里其它段落文本。
    if (el.classList.contains('--color-text-paragraph')
        && p && p.classList && p.classList.contains('d-space-default')
        && el.closest('.sku-card-container')) return true;
    // 退货页商品 ID 行：已由类名规则展开，且它的断行规则（break-all）与名称不同 ——
    // 让探测再打标记会套上 word-break:normal，把长串重新顶出行外。
    if (el.classList.contains('sku-id') && el.closest('.sku-card-container')) return true;
    return false;
  }

  /**
   * 判定单个元素 → 命中返回 { el, hosts, how, text }，否则 null。
   * 这里只读不写：读-写分离才不会「写一个属性、后面每次读都强制重排」。
   */
  function hitOf(el) {
    if (el.getAttribute(ATTR) === '1') return null;          // 已处理，幂等
    if (el.getAttribute('data-dyc-skip') !== null) return null;
    if (el.getAttribute('data-dyc-xhs-copycode') !== null) return null;
    if (el.getAttribute('data-dyc-xhs-copyid') !== null) return null;
    if (isLayoutEl(el)) return null;
    if (coveredByNameRule(el)) return null;                  // ① 已覆盖
    if (!isLeafText(el)) return null;
    var text = (el.textContent || '').trim();
    if (!looksLikeName(text)) return null;
    if (inThead(el)) return null;
    var how = foldedHow(el);
    if (!how) return null;
    if (!nearImage(el)) return null;
    return { el: el, hosts: hostsOf(el), how: how, text: text };
  }

  /** 从一个根节点（含自身）收集候选；返回扫过的节点数 */
  function collectFrom(root, hits, samples, state) {
    var i;
    if (root.nodeType !== 1) return 0;
    if (!root.isConnected) return 0;       // 已被平台摘掉的节点，样式读不到也不必处理
    var nodes = [root];
    var kids;
    try { kids = root.querySelectorAll('*'); } catch (e) { return 0; }
    for (i = 0; i < kids.length; i++) nodes.push(kids[i]);
    for (i = 0; i < nodes.length; i++) {
      if (state.scanned >= MAX_SCAN) break;
      state.scanned++;
      var hit = hitOf(nodes[i]);
      if (!hit) continue;
      hits.push(hit);
      if (samples.length < 3) {
        var cls = typeof hit.el.className === 'string' ? hit.el.className.slice(0, 40) : '';
        samples.push(hit.how + '｜' + cls + '｜' + hit.text.slice(0, 16));
      }
    }
    return state.scanned;
  }

  /**
   * 扫一轮并落标记。
   *
   * 【增量，不全量】MutationObserver 只把**新增节点**交进来；只有首次启动
   * 时扫整页。列表页 React 改 DOM 很频繁，若每 300ms 物化上万个节点再逐个
   * 判定，光遍历就够把页面拖慢 —— 而绝大多数节点上一轮已经处理过。
   * 标记跟着元素走：平台只改 class/style、保留节点时标记还在，展开照常生效；
   * 节点被重建时标记随之消失，正好由 childList 的 addedNodes 补上。
   */
  function scan(roots) {
    if (!document.body) return 0;
    var hits = [];
    var samples = [];
    var state = { scanned: 0 };
    if (roots && roots.length) {
      for (var r = 0; r < roots.length && state.scanned < MAX_SCAN; r++) {
        collectFrom(roots[r], hits, samples, state);
      }
    } else {
      collectFrom(document.body, hits, samples, state);
    }
    // 写阶段：统一落属性（样式表按属性命中，不碰平台的内联样式）
    for (var i = 0; i < hits.length; i++) {
      hits[i].el.setAttribute(ATTR, '1');
      for (var j = 0; j < hits[i].hosts.length; j++) hits[i].hosts[j].setAttribute(HOST_ATTR, '1');
    }
    if (hits.length) noteDiag(hits.length, samples);
    return hits.length;
  }

  /* ---------- 诊断（与中控台同一套记录点，便于下一轮精确收敛选择器） ---------- */

  var lastStat = '';

  function noteDiag(count, samples) {
    var total = 0;
    try { total = document.querySelectorAll('[' + ATTR + '="1"]').length; } catch (e) { total = 0; }
    var detail = '本轮新标 ' + count + ' 个 · 累计 ' + total + ' 个'
      + (samples && samples.length ? '｜样本 ' + samples.join(' ; ') : '');
    if (detail === lastStat) return;
    lastStat = detail;
    try {
      var d = window.__dycDiag;
      if (d && typeof d.note === 'function') d.note('千帆名称展开', detail, String(total));
    } catch (e) { /* 诊断失败不许影响展开本身 */ }
  }

  /* ---------- 开关 / 生命周期 ---------- */

  var flags = {};
  var flagsReady = false;
  var started = false;
  var timer = null;
  var mo = null;

  function wanted() {
    return flagsReady && flags.xhsShopNameWrap !== false && onTargetPage();
  }

  var pendingRoots = [];       // 待扫的新增节点（增量）
  var pendingFull = false;     // 需要整页重扫（换路由 / 新增节点过多）
  var MAX_ROOTS = 80;          // 超过就退回一次全量：80 次子树遍历比一次整页更贵

  /**
   * 排一轮扫描。
   * @param {boolean} full true = 整页重扫（路由切换）；false = 只扫新增节点
   */
  function schedule(full) {
    if (full) pendingFull = true;
    if (timer) return;
    timer = setTimeout(function () {
      timer = null;
      if (!wanted()) { pendingRoots = []; pendingFull = false; return; }
      var roots = pendingFull || pendingRoots.length > MAX_ROOTS ? null : pendingRoots;
      pendingRoots = [];
      pendingFull = false;
      if (!roots) { scan(null); return; }        // 全量
      if (!roots.length) return;                 // 没有新节点，不必跑
      scan(roots);
    }, DEBOUNCE);
  }

  function onMutations(muts) {
    var added = false;
    for (var i = 0; i < muts.length; i++) {
      var nodes = muts[i].addedNodes;
      for (var j = 0; j < nodes.length; j++) {
        if (nodes[j].nodeType === 1) { pendingRoots.push(nodes[j]); added = true; }
      }
    }
    if (added) schedule(false);
  }

  function start() {
    if (started) return;
    started = true;
    ensureStyle();
    scan(null);                                  // 首轮整页
    if (typeof MutationObserver === 'function') {
      mo = new MutationObserver(onMutations);
      try { mo.observe(document.body, { childList: true, subtree: true }); } catch (e) { mo = null; }
    }
    window.addEventListener('dyc:pagechange', function () { schedule(true); });
  }

  function stop() {
    if (mo) { try { mo.disconnect(); } catch (e) { /* 尽力而为 */ } mo = null; }
    started = false;
    if (timer) { clearTimeout(timer); timer = null; }
    pendingRoots = [];
    pendingFull = false;
    // 关掉必须整片还原：标记 + 让位标记 + 样式表，一个都不留，
    // 否则「关了开关页面还是展开的」会被当成开关坏了。
    var marked = document.querySelectorAll('[' + ATTR + ']');
    for (var i = 0; i < marked.length; i++) marked[i].removeAttribute(ATTR);
    var hosts = document.querySelectorAll('[' + HOST_ATTR + ']');
    for (var j = 0; j < hosts.length; j++) hosts[j].removeAttribute(HOST_ATTR);
    removeStyle();
  }

  function apply() {
    if (wanted()) start();
    else stop();
  }

  function watch() {
    /* dycReadFlags() 返回 Promise —— 必须 .then（2026-11-17 事故：同步取用导致全黑） */
    dycReadFlags().then(function (f) {
      flags = f || {};
      flagsReady = true;
      apply();
    }, function () { /* 读不到就不注入，等 onChanged 救场 */ });

    if (typeof dycWatchFlags === 'function') {
      dycWatchFlags(function (f) { flags = f || {}; flagsReady = true; apply(); });
    }
  }

  (function waitForFlags() {
    var waited = 0;
    function tryStart() {
      if (typeof dycReadFlags === 'function') { watch(); return; }
      waited += 50;
      if (waited < 5000) setTimeout(tryStart, 50);
      else watch();
    }
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', tryStart, { once: true });
    } else {
      tryStart();
    }
  })();
})();
