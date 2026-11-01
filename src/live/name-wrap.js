/**
 * 小黄车商品名称换行 · 写不下自动换行,完整展示
 * ============================================================
 * 【解决什么问题】(用户 2026-10-11 提出)
 *
 *   中控台小黄车商品列表里,名称被平台截成一行,第一行往往写不完;
 *   想看全名只能点进商品详情把第二行复制出来,很繁琐。
 *
 *   本功能让名称在卡片内自动换行、完整展示:第一行写不完就折到
 *   第二行,名称下方的元素(价格/按钮等)随之往下排一行。
 *
 * 【「不改变商品链接占用大小」怎么保证】
 *
 *   我们**只动名称文本元素自己**的白名单属性,绝不碰商品卡片、
 *   行容器或任何祖先元素(不设宽高、不改间距、不删节点):
 *
 *     white-space: normal     解除「不换行」
 *     word-break: break-word  长款号(英文+数字串)也能折行
 *     text-overflow: clip     去掉省略号(仅在 nowrap 下生效,顺手清掉)
 *     display: block          仅当平台用了 -webkit-box 行数钳制时才设,
 *                             逃离 line-clamp;其余情况不动 display
 *     height: auto / max-height: none
 *                             名称区域高度交给内容,能长到几行就几行
 *
 *   卡片整体尺寸由平台自己的布局决定:卡片高度若固定,内部元素
 *   下移但卡片不变大;若卡片随内容长高,也只长名称折行那一截 ——
 *   我们不额外注入任何尺寸。
 *
 * 【怎么找到名称元素 —— 不依赖平台 class】
 *
 *   平台是 CSS Modules 哈希类名,改版就变,靠 class 必然脆断。
 *   这里复用 locate.js 的内容特征识别(getProductItems)拿到商品行,
 *   再在行内按「行为特征」找名称:
 *
 *     1. 有**直接文本**节点(纯容器不算,避免命中整行);
 *     2. 真被截断了:scrollWidth 超出自身(单行省略号)或
 *        scrollHeight 超出自身(行数钳制),且尺寸非零;
 *     3. 文本像名称:≥4 字符,排除价格(¥/纯数字)、平台标签
 *        (到手价/售出/库存/货号/规格/设置卖点…);
 *     4. 没被我们处理过(data 标记,幂等)。
 *
 * 【虚拟滚动怎么跟】
 *
 *   商品列表是虚拟滚动(可视区恒约 8 行,滚动时反复重建节点),
 *   新渲染的行没有我们的样式。用 MutationObserver 监听节点变化,
 *   **防抖 300ms**后补涂一次 —— 补涂只扫可视区那几行
 *   (getProductItems 走 10 秒缓存),开销有界,不做全页扫描。
 *   另外页面刚打开时补涂 3 次(1.5s/4s/8s),兜住首屏晚渲染。
 *
 * 【开关与还原】
 *
 *   · 弹窗开关 liveNameWrap(默认开),关掉**即时生效**:
 *     摘掉观察器 + 对已处理元素还原内联样式(平台样式都在样式表里,
 *     清掉内联覆盖即回原样;平台自己写过内联的属性会先备份再还原)。
 *   · 已滚出可视区被销毁的节点随 DOM 消失,无需处理。
 *
 * 【已知边界(如实记录,不掩盖)】
 *
 *   1. 名称若不是被自身样式截断、而是被**卡片级 overflow 剪裁**
 *      (元素本身能完整换行、只是被卡片裁掉),本检测找不到,
 *      表现为「开关开了但没变化」—— 如实不生效,不会乱改布局。
 *   2. 若平台卡片高度随内容长高,行距会变,依赖等距几何的
 *      「序号定位 / 全能搜索」可能漂移 —— 关掉本开关即恢复。
 *      (实测中控台行高约 208px,名称区内通常有余量,预期卡片不变高。)
 *   3. 对行内其他被截断的短文本(如卖点)同样生效 —— 特征上与名称
 *      无从区分;若发现不该换行的也被换行了,再收窄特征。
 *
 * 【本轮打磨(2026-10-11 用户反馈)】
 *
 *   1. ~~名称第二行起缩进约一个汉字位~~ —— **2026-10-14 用户要求取消**,
 *      现已不再写 padding-left / text-indent;旧版本已写入的内联值由
 *      clearLegacyIndent() 清理。两个属性仍留在 PROPS 白名单里,
 *      以便关开关时把平台原有的内联值还原干净。
 *   2. 行内「ID」复制按钮(点了复制商品 ID 的平台小按钮)对齐名称
 *      **第一行**:名称折成两行后它原来会垂直居中到两行中间或被挤到
 *      第二行 —— 只对「真的折过行的行」里的 ID 按钮做顶部对齐。
 *      **2026-10-15 追加**:扩展注入的「货号」按钮(copy-code.js)与 ID 按钮
 *      并排,同样走这套对齐 —— 否则 ID 按钮被精调上去、它留在原位,
 *      看起来就像「商品名一长,货号按钮就掉到下面去了」。
 *      二次修正(用户真机反馈第一版无效):按钮外有容器层
 *      (rightContainer-d7a4a8),align-self 写在按钮上穿不透容器;
 *      现改为沿按钮祖先链逐层检查,只修正「正在垂直居中」的那几层
 *      (父级为横向 flex/grid 且 align-items 为 center/baseline),
 *      其余层不碰;链上每个被改元素各自备份,关开关逐个还原。
 *      **2026-10-15 再补(百应入口)**:货号按钮的对齐不再要求「名称折行」——
 *      百应名称容器宽、名称常不折行,若仍按「仅折行行」处理,按钮永远拿不到
 *      精调(按钮 h=20 与平台 ID 按钮 h=16 不等高、平台那枚又非容器居中,
 *      并排即差约 2.5px)。现改为**每一行**都对齐货号按钮;平台 ID 按钮仍只在
 *      折行行对齐(不折行时它没错位,动它会把它推歪)。
 *   3. 三次修正(2026-10-12 用户真机反馈「还是错位」):顶部对齐只保证
 *      按钮贴住名称区块**上沿**,而首行文字的行盒因行高上下均分 +
 *      容器内边距,通常比区块上沿低几像素 —— 真机上按钮看起来仍偏高。
 *      现改为「测量精调」:对齐后用 Range 实测名称首行文字盒与按钮盒
 *      的几何差,差 ≥1px 才补一个 translateY,让按钮精确垂直居中于
 *      第一行文字;测量失败不动(保持顶部对齐兜底)。
 *      (只在折了行的行里测,可视区 ≤8 行,开销有界。)
 *
 * 【2026-10-15 修复：少数行「永不折行」(用户反馈「小黄车商品名一直是省略号」)】
 *
 *   现象:真机迟采样实测 112 行里 100 行折好了,少数行**永远保持省略号**
 *   (用户:鼠标指上去才恢复长文本)。
 *
 *   真因不在本文件,而在 locate.js 的行识别:它为了「选对容器」带一道
 *   **等高校验**(高度偏离均值 30% 的行整行剔除),而**折行本身会改变行高**
 *   —— 折好的行成了多数,还没折行的少数行反而变成离群值被剔出集合:
 *
 *     折行 → 该行变高 → 未折行的行成离群 → 被剔出集合
 *          → 本功能再也扫不到它 → 它永远不折行 → 继续离群(锁死)
 *
 *   同一个集合也被 copy-code.js 用着 ⇒ 这些行连「货号」按钮都没有
 *   (实测 5 行「从未被处理」且同时无按钮),可见问题在行集合而非各自逻辑。
 *
 *   本文件四处改动:
 *     ① 取行改用 locate.js 的 getAllProductRows()(等距行 ∪ 结构锚补捞),
 *        旧版 locate.js 没这个函数时自动退回原路径;
 *     ② 幂等改成「标记 + 计算值仍是展开态」双条件 —— 平台重渲染抹掉内联
 *        样式、或用 !important 压住我们,都能被发现并重写(重写不重复备份,
 *        见 unwrapEl 的 backed 判断,否则备份会存进我们自己写的值);
 *     ③ 调度由「固定防抖 300ms」改成「当帧 rAF 补涂 + 300ms 尾扫」,
 *        消除滚动时省略号闪一下(实测原来要 0.54s 才折好);
 *     ④ 款号整体不拆:word-break 由 break-word 改为 normal +
 *        overflow-wrap: break-word —— 原来会在数字/字母串内部折断,
 *        款号被腰斩成「102 / 4587」。
 *     ⑤ **判定门槛 dx 2 → 0**(同日用户复测后追加):门槛原来是「溢出 > 2px」,
 *        而真机停屏诊断抓到一行 **dx 恰好 = 1** —— 只差 1 像素就放得下,
 *        平台照样画省略号,可 1 > 2 不成立 ⇒ 这一行永远不折行、永久省略号。
 *        正是用户最初那句「**差一点就显示全,也不准用省略号糊弄过去**」。
 *        改成「只要有溢出(> 0)就处理」;纵向仍保持 > 4(那是平台固有样式,
 *        每行盒高比行盒矮 4px 裁掉字底,不画省略号,不是要处理的截断)。
 *
 *   **已知未做(如实记录)**:没有把折行后的行高「压回原值」以彻底消除行高
 *   异质 —— 行容器若带 overflow:hidden,压回会把第二行裁掉,比省略号更差。
 *   因此本版只保证「行集合不漏行」,行高异质由 locate.js 的并集入口隔离
 *   (依赖等距几何的「序号定位」仍用原来的等距集合,不受影响)。
 * ============================================================
 */

(function dycLiveNameWrap() {
  'use strict';

  // 防重复注入(SPA 路由回切、脚本意外重跑时不会叠出多个观察器)
  if (window.__DYC_LIVE_NAME_WRAP__) return;
  window.__DYC_LIVE_NAME_WRAP__ = true;

  /* ---------- 依赖自检 ---------- */
  // flags.js(开关层)与 locate.js(getProductItems)必须先加载;
  // 依赖不齐就静默退出,绝不半途乱猜页面结构。
  if (typeof dycReadFlags !== 'function' || typeof getProductItems !== 'function') {
    return;
  }

  var MARK = 'data-dyc-namewrap';
  var MARK_ORIG = 'data-dyc-namewrap-orig';

  // 我们会写内联的全部属性(还原时按这份清单清)。
  // paddingLeft / textIndent 已于 2026-10-14 停止写入(第二行缩进取消),
  // 但仍留在清单里 —— 关开关时要把旧版本写过的内联值一并清干净。
  var PROPS = ['whiteSpace', 'wordBreak', 'overflowWrap', 'textOverflow', 'display', 'height',
               'maxHeight', 'paddingLeft', 'textIndent'];

  // ID 复制按钮(对齐名称第一行)会写的属性,还原时按这份清单清
  var BTN_PROPS = ['verticalAlign', 'alignSelf', 'transform'];
  var BTN_MARK = 'data-dyc-idbtn';
  var BTN_MARK_ORIG = 'data-dyc-idbtn-orig';

  // 平台标签/价格特征:命中的文本不是商品名称
  var NOT_NAME = /^(到手价|售出|已售|库存|货号|规格|设置卖点|未设提词|销量|ID)|[¥￥]/;
  var ONLY_NUM = /^[\d\s.,::%\-+()（）#¥￥]+$/;

  var flags = null;
  var observer = null;
  var pending = false;
  var tailTimer = null;   // 300ms 尾扫的定时器句柄（见 scheduleApply）

  function enabled() {
    return !!flags && flags.liveNameWrap !== false;
  }

  /* ---------- 名称元素识别 ---------- */

  /** 元素是否带「直接文本」节点(子元素里的文本不算) */
  function hasDirectText(el) {
    var nodes = el.childNodes;
    for (var i = 0; i < nodes.length; i++) {
      var n = nodes[i];
      if (n.nodeType === 3 && String(n.nodeValue || '').trim()) return true;
    }
    return false;
  }

  /** 文本是否「像名称」:够长、非价格、非平台标签 */
  function looksLikeName(text) {
    var t = String(text || '').trim();
    if (t.length < 4 || t.length > 200) return false;
    if (ONLY_NUM.test(t)) return false;
    if (NOT_NAME.test(t)) return false;
    return true;
  }

  /**
   * 「已处理过」的复核（2026-10-15 幂等双条件）
   *
   * 只看标记不够：平台重渲染会重写元素的 style 属性，把我们的内联属性
   * 整段清空，而标记（React 不认识的陌生属性）会留下来 —— 于是旧实现
   * 「看到标记就跳过」，那一行就永远保持省略号。
   *
   * 这里核对**计算值**而不是只看内联值：即便平台用 !important 规则压住
   * 我们的内联样式，也能被发现（此时 white-space 的计算值仍会是 nowrap）。
   *
   * @returns {boolean} true = 标记与样式都还在，可以跳过
   */
  function stillWrapped(el) {
    try {
      var cs = getComputedStyle(el);
      if (cs.whiteSpace !== 'normal') return false;            // 被压回 nowrap ⇒ 没生效
      if (el.scrollWidth - el.clientWidth > 2) return false;    // 仍在横向截断 ⇒ 没生效
      if (el.style.height !== 'auto') return false;             // 内联值被抹 ⇒ 需要重写
      return true;
    } catch (e) {
      return false;   // 复核失败就当没处理过，重写一遍最安全
    }
  }

  /** 在一行商品里找出所有真被截断、且文本像名称的元素 */
  function findWrappedCandidates(row) {
    var out = [];
    // 用 TreeWalker 只走这一行内部的元素节点
    // (可视区恒约 8 行,行内节点数有限,开销有界;不做全页通配查询)
    var walker = document.createTreeWalker(row, NodeFilter.SHOW_ELEMENT, null);
    var el;
    while ((el = walker.nextNode())) {
      if (el.getAttribute(MARK) === '1') {              // 已处理过
        // 迁移(2026-10-14):旧版本给名称写过第二行缩进的内联样式,本版取消
        // 该效果。已打过标记的元素不会重新走 unwrapEl,这里补一次清理 ——
        // 只在确实存在这两个内联值时才写(绝大多数元素本来就没有)。
        if (el.style.paddingLeft || el.style.textIndent) clearLegacyIndent(el);
        // 【2026-10-15 幂等双条件】光有标记不算数:平台重渲染会重写 style
        // 把我们的内联属性清空,而标记是陌生属性、会留下来 —— 旧实现看到
        // 标记就跳过,于是「样式被抹 → 永不补涂 → 永久省略号」。
        // 现在改成「标记 + 计算值仍是展开态」才算处理过;不成立就落到下面
        // 的判定里重新处理(重写样式,且不会重复备份,见 unwrapEl)。
        if (stillWrapped(el)) continue;
      }
      if (el.clientWidth < 10 || el.clientHeight < 8) continue;  // 不可见/太小
      if (!hasDirectText(el)) continue;                 // 只要带直接文本的
      // 真截断:横向(单行省略号)或纵向(行数钳制)超出自身盒子
      //
      // 【2026-10-15 阈值 2 → 0 · 用户反馈「差一点就显示全,也不准用省略号糊弄」】
      // 原来要求 dx > 2。真机停屏诊断抓到一行 **dx 恰好 = 1**(只差 1 像素就放得下),
      // 平台照样画省略号,而 1 > 2 不成立 ⇒ 这一行永远不会被折行,永久省略号。
      // 改成「只要有溢出(> 0)就处理」。
      // 副作用可接受:极少数行可能是亚像素舍入造成的 1px 假溢出,被处理也只是
      // 多写一次 white-space:normal(文字本来放得下,不会真折行),无可见影响。
      // 纵向仍保持 > 4:实测每行盒高比行盒矮 4px(裁掉字底,不画省略号),
      // 那是平台固有样式,不是要处理的截断。
      var cutH = el.scrollWidth - el.clientWidth > 0;
      var cutV = el.scrollHeight - el.clientHeight > 4;
      if (!cutH && !cutV) continue;
      if (!looksLikeName(el.textContent)) continue;
      out.push(el);
    }
    return out;
  }

  /* ---------- 换行 / 还原 ---------- */

  function unwrapEl(el) {
    var cs = getComputedStyle(el);
    // 平台自己写过的内联值先备份,还原时原样放回(没有的清空)。
    // 【2026-10-15】已有备份就不再覆盖 —— 幂等双条件会让同一个元素被重复
    // 处理(平台抹掉样式后重写),若每次都重备份,备份里存的会变成**我们自己
    // 写的值**,关开关时反而还原不回平台原样。
    var orig = {};
    var backed = el.getAttribute(MARK_ORIG) !== null;
    if (!backed) {
      for (var i = 0; i < PROPS.length; i++) {
        var p = PROPS[i];
        var v = el.style[p];
        if (v) orig[p] = v;
      }
      try {
        el.setAttribute(MARK_ORIG, JSON.stringify(orig));
      } catch (e) { /* 序列化失败极罕见;失败就不备份,还原时清空 */ }
    }

    el.style.whiteSpace = 'normal';
    // 【2026-10-15 款号整体不拆】原来写的是 word-break: break-word ——
    // 它等价于 word-break: normal + overflow-wrap: anywhere,语义上允许在
    // 数字/字母串**内部**折断,款号会被腰斩成「102 / 4587」。
    // 改成 normal + overflow-wrap: break-word:
    //   · 款号作为整体参与折行,放不下就整段下移;
    //   · 只有「整串单独一行也放不下」的极端款号才允许内部折断(逃生口)。
    el.style.wordBreak = 'normal';
    el.style.overflowWrap = 'break-word';
    el.style.textOverflow = 'clip';
    // 仅当平台用 -webkit-box 行数钳制时才换 display 逃离;
    // 其余 display(含 flex 布局容器)一律不动,避免破坏内部图标排布
    if (cs.display === '-webkit-box' || cs.display === '-webkit-inline-box') {
      el.style.display = 'block';
    }
    el.style.height = 'auto';
    el.style.maxHeight = 'none';
    // 第二行缩进已于 2026-10-14 按用户要求取消(原为 padding-left:1em +
    // text-indent:-1em 的悬挂缩进)。此处不再写这两个属性;
    // 它们仍留在 PROPS 白名单里,以便把旧版本写入的内联值还原干净
    // (见 clearLegacyIndent)。
    el.setAttribute(MARK, '1');
  }

  function restoreEl(el) {
    var orig = {};
    try {
      orig = JSON.parse(el.getAttribute(MARK_ORIG) || '{}') || {};
    } catch (e) { orig = {}; }
    for (var i = 0; i < PROPS.length; i++) {
      var p = PROPS[i];
      el.style[p] = orig[p] || '';
    }
    el.removeAttribute(MARK);
    el.removeAttribute(MARK_ORIG);
  }

  /**
   * 清掉旧版本写入的第二行缩进(2026-10-14 用户要求取消该效果)。
   * 有备份的按备份还原(平台自己写过的内联值不能丢),没有的清空;
   * 同时把这两个属性从备份里摘掉,免得下次还原时又被写回去。
   */
  function clearLegacyIndent(el) {
    var orig = {};
    try { orig = JSON.parse(el.getAttribute(MARK_ORIG) || '{}') || {}; } catch (e) { orig = {}; }
    el.style.paddingLeft = orig.paddingLeft || '';
    el.style.textIndent = orig.textIndent || '';
    if ('paddingLeft' in orig) delete orig.paddingLeft;
    if ('textIndent' in orig) delete orig.textIndent;
    try { el.setAttribute(MARK_ORIG, JSON.stringify(orig)); } catch (e2) { /* 备份写不进就算了 */ }
  }

  /* ---------- ID 复制按钮对齐名称第一行 ---------- */

  /**
   * 名称换成两行后,行内那个「ID」复制按钮(点了复制商品 ID 的平台小按钮)
   * 会跟着错位 —— 垂直居中到两行的中间或被挤到第二行。
   * 用户定:让它对齐名称第一行(顶部对齐)。
   *
   * 识别靠内容特征(与全文件口径一致,不依赖平台 class):
   * 文本恰好是「ID」的小尺寸按钮类元素。
   */
  function findIdButton(row) {
    var walker = document.createTreeWalker(row, NodeFilter.SHOW_ELEMENT, null);
    var el;
    while ((el = walker.nextNode())) {
      if (el.getAttribute(BTN_MARK) === '1') continue;   // 已处理,幂等
      // 扩展自己注入的「货号」按钮不算平台的 ID 按钮（它的 title 含「复制」
      // 二字、尺寸也落在下面的判据区间内，不排除就会被误认）
      if (el.getAttribute('data-dyc-code-btn') === '1') continue;
      var tag = el.tagName;
      if (tag !== 'BUTTON' && tag !== 'A' && tag !== 'SPAN' && tag !== 'DIV') continue;
      // 内容特征二选一:文本恰为「ID」;或本身是图标按钮、
      // 靠 title/aria-label 标注(文本为空也别漏)
      var t = String(el.textContent || '').trim();
      var label = (el.getAttribute('title') || '') + ' ' +
                  (el.getAttribute('aria-label') || '');
      var byText = t === 'ID' || t === 'id';
      var byLabel = /复制|(^|\s)ID(\s|$)/i.test(label) && t.length <= 4;
      if (!byText && !byLabel) continue;
      if (el.clientWidth < 8 || el.clientWidth > 60) continue;    // 小按钮
      if (el.clientHeight < 8 || el.clientHeight > 40) continue;
      return el;
    }
    return null;
  }

  /**
   * 找扩展自己注入的「货号」按钮(copy-code.js 注入,与平台 ID 按钮并排)。
   * 它必须和 ID 按钮一起对齐到名称第一行 —— 否则 ID 按钮被 translateY
   * 精调后、它留在原位,看起来就像「商品名一长,货号按钮就掉下去了」。
   * 按 data 属性找,不看尺寸判据(那套判据是给平台按钮用的)。
   * @return {Element|null}
   */
  function findOurCodeButton(row) {
    try {
      return row.querySelector('[data-dyc-code-btn="1"]');
    } catch (e) {
      return null;
    }
  }

  /**
   * 顶部对齐(2026-10-11 二次修正)。
   *
   * 【上一版为什么无效 —— 用户真机反馈「还是没对齐」】
   * 上一版只写按钮**自己**的 align-self / vertical-align。但用户提供的真实
   * 结构显示,按钮外面包着容器层(用户从 DevTools 抄出
   * class="rightContainer-d7a4a8")—— align-self 只对「flex 容器的直接
   * 子项」生效,隔着容器写在按钮上等于没写;vertical-align 也只在按钮
   * 恰好处于文本流时才起作用。所以真机上纹丝不动。
   *
   * 【这一版怎么做】
   * 沿「按钮 → 商品行」的祖先链逐层检查:凡是「父级是 flex/grid 容器、
   * 且正在把子项垂直居中(align-items: center/baseline)」的那一层,
   * 就给这一层写 align-self: flex-start —— 只有真的在做垂直居中的层
   * 会被改,其余层一律不碰:
   *   · 父级 align-items 是 stretch/flex-start → 本来就顶对齐,跳过
   *   · 父级是纵向 flex(居中是水平方向,由 justify-content 管)→ 跳过,
   *     避免把按钮拉到左边
   *   · 按钮本体仍写 vertical-align: top 兜底文本流场景
   * 链上每个被改的元素各自备份原值(同一个标记属性,逐元素存),
   * 关开关时逐个还原。
   */
  function setBtnProp(el, prop, val) {
    var first = el.getAttribute(BTN_MARK_ORIG) === null;
    var orig = {};
    if (!first) {
      try { orig = JSON.parse(el.getAttribute(BTN_MARK_ORIG) || '{}') || {}; } catch (e) { orig = {}; }
    }
    if (!(prop in orig)) orig[prop] = el.style[prop] || '';
    el.style[prop] = val;
    try { el.setAttribute(BTN_MARK_ORIG, JSON.stringify(orig)); } catch (e) {}
    el.setAttribute(BTN_MARK, '1');
  }

  /**
   * 实测「名称第一行文字盒」相对名称区块上沿的偏移,并算出按钮需要
   * 补的 translateY。
   *
   * 【为什么需要这一步(2026-10-12 三修)】
   * 顶部对齐(align-self: flex-start)只能把按钮贴到名称区块的**上沿**,
   * 而首行文字的行盒因为 line-height 的上下均分、容器内边距等原因,
   * 通常比区块上沿低几个像素 —— 用户真机上看到的「还是错位」就是这几
   * 像素。肉眼对的不是区块边框,是文字本身。
   *
   * 【怎么测】
   * 给名称首行造一个 Range(从文本起点到首个换行点附近),取其
   * getBoundingClientRect() 得到真实文字盒;与按钮盒对比:
   *   dy = 文字盒垂直中点 − 按钮盒垂直中点
   * 把按钮往下平移 dy 即垂直居中于第一行。Range 建不出来(极端 DOM)
   * 或几何异常(负宽高/差值过小)返回 0,保持顶部对齐兜底。
   *
   * @return {number} translateY 像素值(可为负;0 表示不用调)
   */
  function measureFirstLineOffset(nameEl, btn) {
    try {
      var w = document.createTreeWalker(nameEl, NodeFilter.SHOW_TEXT, null);
      var tn;
      while ((tn = w.nextNode())) {
        if (String(tn.nodeValue || '').trim()) break;   // 第一个非空文本节点
      }
      if (!tn) return 0;
      var rng = document.createRange();
      rng.setStart(tn, 0);
      // 覆盖首行:量到该文本节点前若干字符(首行放得下 30 字就够代表)
      rng.setEnd(tn, Math.min(30, tn.nodeValue.length));
      var rects = rng.getClientRects();
      if (!rects || rects.length === 0) return 0;
      var line = rects[0];                               // 首行文字盒
      if (line.height <= 0 || line.width <= 0) return 0;
      var b = btn.getBoundingClientRect();
      if (b.height <= 0 || b.width <= 0) return 0;
      var dy = (line.top + line.height / 2) - (b.top + b.height / 2);
      // 差值 <1px 视为已对齐,不写无意义的 transform
      if (dy > -1 && dy < 1) return 0;
      // 防御上限:正常布局差不会超过半行高,超出说明量错了,不动
      if (dy > 40 || dy < -40) return 0;
      return dy;
    } catch (e) {
      return 0;
    }
  }

  function alignIdButton(btn, row) {
    // ① 按钮本体:文本流场景兜底(非文本流时无副作用)
    setBtnProp(btn, 'verticalAlign', 'top');
    var pcs = btn.parentElement ? getComputedStyle(btn.parentElement) : null;
    var parentIsColFlex = !!pcs &&
      (pcs.display === 'flex' || pcs.display === 'inline-flex') &&
      String(pcs.flexDirection || 'row').indexOf('column') === 0;
    if (!parentIsColFlex) setBtnProp(btn, 'alignSelf', 'flex-start');

    // ② 祖先链:修正「隔层居中」 —— 按钮被容器包住时真正居中的是某层祖先
    var el = btn.parentElement;
    while (el && el !== row) {
      var parent = el.parentElement;
      if (parent) {
        var s = getComputedStyle(parent);
        var isFlex = s.display === 'flex' || s.display === 'inline-flex';
        var isGrid = s.display.indexOf('grid') === 0;
        var centered = s.alignItems === 'center' || s.alignItems === 'baseline';
        if ((isFlex || isGrid) && centered) {
          var dir = String(s.flexDirection || 'row');
          // 横向 flex / grid:align-items 管垂直方向 → 顶对齐;
          // 纵向 flex:align-items 管水平方向 → 动了会把按钮拉偏,跳过
          if (isGrid || dir.indexOf('row') === 0) {
            setBtnProp(el, 'alignSelf', 'flex-start');
          }
        }
      }
      el = el.parentElement;
    }

    // ③ 测量精调(2026-10-12 三修):顶部对齐只贴区块上沿,首行文字的
    //    行盒通常比上沿低几像素(行高均分 + 容器内边距)。这里实测
    //    首行文字盒与按钮盒的几何差,补一个 translateY 让按钮垂直
    //    居中于第一行文字本身 —— 差 <1px 或测量失败都不动(兜底保持
    //    顶部对齐)。transform 已进 BTN_PROPS,关开关随清单还原。
    var nameEl = findNameAnchor(btn, row);
    if (nameEl) {
      var dy = measureFirstLineOffset(nameEl, btn);
      if (dy !== 0) {
        setBtnProp(btn, 'transform', 'translateY(' + Math.round(dy * 10) / 10 + 'px)');
      }
    }
  }

  /**
   * 找按钮所在行的「名称元素」(已打换行标记、文本最像名称的那个)。
   * 名称和按钮同属一个商品行,但具体层级关系随平台改版波动 ——
   * 这里按特征找:优先取行内已打 MARK 的名称元素;行内没打过标记
   * (本轮刚折行、顺序未到)时退而求其次,取文本最长的候选。
   * @return {Element|null}
   */
  function findNameAnchor(btn, row) {
    // 已打标记的名称元素:最可靠
    var marked = row.querySelectorAll('[' + MARK + ']');
    if (marked.length > 0) {
      // 取离按钮 DOM 距离最近的一个(同querySelectorAll顺序近似:取含
      // 按钮作为后代者优先,否则取第一个)
      for (var i = 0; i < marked.length; i++) {
        if (marked[i].contains(btn) || btn.contains(marked[i])) return marked[i];
      }
      return marked[0];
    }
    // 未打标记:按「像名称」的文本长度挑最长的(每行 ≤1 个,开销可忽略)
    var walker = document.createTreeWalker(row, NodeFilter.SHOW_ELEMENT, null);
    var el, best = null, bestLen = 0;
    while ((el = walker.nextNode())) {
      if (!hasDirectText(el)) continue;
      var t = String(el.textContent || '').trim();
      if (t.length < 4) continue;
      if (NOT_NAME.test(t) || ONLY_NUM.test(t)) continue;
      if (t.length > bestLen) { best = el; bestLen = t.length; }
    }
    return best;
  }

  function restoreIdButton(btn) {
    var orig = {};
    try { orig = JSON.parse(btn.getAttribute(BTN_MARK_ORIG) || '{}') || {}; } catch (e) {}
    for (var i = 0; i < BTN_PROPS.length; i++) {
      var p = BTN_PROPS[i];
      btn.style[p] = orig[p] || '';
    }
    btn.removeAttribute(BTN_MARK);
    btn.removeAttribute(BTN_MARK_ORIG);
  }

  /* ---------- 补涂主流程 ---------- */

  /**
   * 取本轮要处理的商品行。
   *
   * 【2026-10-15 换成并集 · 用户反馈「小黄车商品名一直是省略号」】
   * 原来直接用 getProductItems()。它为了「选对容器」带一道等高校验,会把
   * 高度偏离均值的行**整行剔掉**;而**名称折行本身会改变行高** ⇒ 已经折好的
   * 行成了多数,少数还没折行的行反而成了离群值被剔出去:
   *
   *   折行 → 行变高 → 未折行的行成离群 → 被剔出集合
   *        → 本功能不再扫它 → 它永远不折行 → 继续离群(锁死)
   *
   * 真机实测(百应中控台 · 迟采样):112 行里 100 行折好了、**5 行从未被处理**,
   * 而这 5 行行内**同时**没有扩展的「货号」按钮 —— 两个功能共用同一个行集合,
   * 所以问题在行集合,不在各自的逻辑里。
   *
   * 改用 locate.js 的 getAllProductRows()(等距行 ∪ 结构锚补捞)。若旧版
   * locate.js 里没有这个函数,自动退回原路径,不会因加载顺序而报错。
   */
  function getRows() {
    if (typeof getAllProductRows === 'function') {
      try { return getAllProductRows(); } catch (e) { /* 退回主路径 */ }
    }
    return getProductItems();
  }

  function applyAll() {
    if (!enabled()) return;
    var rows;
    try {
      rows = getRows();
    } catch (e) {
      return;   // 识别函数异常时本轮放弃,等下一次触发
    }
    if (!rows || rows.length === 0) return;
    // 读-写分离:第一遍纯读收集(不写任何样式),第二遍统一写 ——
    // 避免读一行写一行交错触发强制重排
    var collected = [];
    var rowsWithWrap = [];
    for (var i = 0; i < rows.length; i++) {
      var cands = findWrappedCandidates(rows[i]);
      if (cands.length > 0) rowsWithWrap.push(rows[i]);
      for (var j = 0; j < cands.length; j++) collected.push(cands[j]);
    }
    for (var k = 0; k < collected.length; k++) unwrapEl(collected[k]);

    // ① 平台自带的「ID」复制按钮:只在**名称真折行**的行做对齐。
    //    名称没折的行它本来就没错位,动它反而会把它从容器中心推到上沿。
    for (var r = 0; r < rowsWithWrap.length; r++) {
      var idBtn = findIdButton(rowsWithWrap[r]);
      if (idBtn) alignIdButton(idBtn, rowsWithWrap[r]);
    }

    // ② 扩展注入的「货号」按钮(copy-code.js):**每一行**都对齐到名称首行文字。
    //    【2026-10-15 补 · 用户报「巨量百应中控台货号复制没对齐」】
    //    百应的名称容器宽(实测 342px)、名称普遍**不折行** ⇒ 上面的
    //    rowsWithWrap 为空 ⇒ 按钮从来拿不到精调;而按钮自身高 20px、
    //    平台 ID 按钮高 16px,两者虽同在 rightContainer(align-items:center)
    //    里,平台那枚却并非容器居中(实测偏上 3px、紧贴名称首行文字)——
    //    于是并排时按钮中心比 ID 按钮低约 2.5px,肉眼可见错位。
    //    实测:对齐到名称首行文字后,与 ID 按钮中心差 ≤0.5px。
    //    ⚠️ 这里只对齐**我们自己的**按钮,不碰平台 ID 按钮(理由见 ①)。
    //    开销:可视区约 8 行,每行一次 querySelector + 一次 Range 测量,有界。
    for (var m = 0; m < rows.length; m++) {
      var mine = findOurCodeButton(rows[m]);
      if (mine) alignIdButton(mine, rows[m]);
    }
  }

  /** 关闭开关:全页清一遍标记元素(只在拨开关时跑,频率极低) */
  function restoreAll() {
    var marked = document.querySelectorAll('[' + MARK + ']');
    for (var i = 0; i < marked.length; i++) restoreEl(marked[i]);
    var btns = document.querySelectorAll('[' + BTN_MARK + ']');
    for (var b = 0; b < btns.length; b++) restoreIdButton(btns[b]);
  }

  /* ---------- 触发时机 ---------- */

  /**
   * 补涂调度（2026-10-15 改「当帧补涂」）
   *
   * 原来是固定防抖 300ms —— 行先渲染、省略号先画上，300ms 后才被我们改成
   * 两行（真机实测 0.54 秒），滚动时能看到省略号闪一下。现在改成两拍：
   *
   *   · **当帧补涂**：观察器回调里用 requestAnimationFrame 立即做（同帧多次
   *     变更合并成一次）⇒ 浏览器在同一帧内先跑完我们、再绘制，省略号来不及
   *     显示；
   *   · **300ms 尾扫**：平台有时在插入节点之后的下一个任务里才把结构/样式
   *     补齐，当帧那次可能看不到 —— 尾扫兜住这一种。
   *
   * 补涂本身只扫可视区那几行，开销有界。
   */
  function scheduleApply() {
    if (!pending) {
      pending = true;
      var raf = window.requestAnimationFrame ||
                function (fn) { return setTimeout(fn, 16); };
      raf(function () { pending = false; applyAll(); });
    }
    if (tailTimer === null) {
      tailTimer = setTimeout(function () {
        tailTimer = null;
        applyAll();
      }, 300);
    }
  }

  function start() {
    if (!observer) {
      observer = new MutationObserver(scheduleApply);
      observer.observe(document.body, { childList: true, subtree: true });
    }
    applyAll();
  }

  function stop() {
    if (observer) { observer.disconnect(); observer = null; }
    if (tailTimer !== null) { clearTimeout(tailTimer); tailTimer = null; }
    pending = false;
    restoreAll();
  }

  // 订阅开关:读取初始值 + 监听弹窗拨动(即时生效,不用刷新)
  // 状态条统一反馈(2026-10-11):开关切换报一声,首次对齐不报
  var prevNameWrap = null;
  dycReadFlags().then(function (f) {
    flags = f;
    prevNameWrap = enabled();
    if (enabled()) start();
  });
  if (typeof dycWatchFlags === 'function') {
    dycWatchFlags(function (f) {
      flags = f;
      var now = enabled();
      if (prevNameWrap !== null && now !== prevNameWrap && typeof toast === 'function') {
        toast(now ? '已开启' : '已关闭', 'info', { source: '名称换行' });
      }
      prevNameWrap = now;
      if (now) start();
      else stop();
    });
  }

  // 首屏兜底:中控台是微前端,商品列表渲染得晚,定时补涂三次
  [1500, 4000, 8000].forEach(function (ms) {
    setTimeout(function () {
      if (enabled()) applyAll();
    }, ms);
  });
})();
