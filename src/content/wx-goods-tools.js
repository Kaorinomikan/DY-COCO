/**
 * 微信小店 · 商品行快捷复制（货号 / 商品链接）
 * ============================================================
 * 【解决什么问题】(用户 2026-10-31)
 *
 *   ① 「加入复制货号的功能按钮,可以参考之前实现过的按钮。按钮放在名称的最后面」
 *      —— 与中控台/大屏那几个「货号」按钮同思路：点一下把款号写进剪贴板。
 *   ② 「做一个【商品链接】的按钮,点了可以快速复制商品链接……它原生自带了
 *      复制按钮,但是每次都要点开之后才能按,按了之后还没有任何反馈,
 *      希望能简化成一键复制的样子」
 *      —— 平台路径是「商品列表 → 分享 → 复制链接」,要点开面板才能拿到,
 *      而且复制完没有任何提示。
 *
 * 【货号从哪来 —— 权威源是 SKU 编码，三级取号】(2026-10-31 第三轮)
 *
 *   用户定口径:**货号 = 「规格/编码」弹层里商家 SKU 编码的第一个分隔符之前
 *   那一段**。例：SKU 编码 `NE1C1142W-35-38` → 货号 `NE1C1142W`。
 *   并补充事实:「常常会写在商品名最后面,但是有时候商品名漏写,但是 SKU
 *   一般不会」—— 所以名字是**便道**,SKU 才是准的。
 *
 *   据此分三级，越靠前越省事:
 *
 *     L1 页面数据(Vue 组件实例)。按商品 ID **精确**匹配该商品对象,读它的
 *        sku 列表里的编码字段 —— 零点击、零闪烁、且是 SKU 的原文。
 *        (与取链接共用一套 walker;找不到对应关系就放弃,绝不猜。)
 *
 *     L2 商品名末尾「≥4 位且含数字」的字母数字串,并同样按分隔符切第一段。
 *        零点击,但**可能缺**(用户说的「商品名漏写」)、也可能写错。
 *        只在 L1 拿不到时用,拿来即用、不额外开面板。
 *
 *     L3 点开这一行的「规格/编码」弹层,读里面所有 SKU 编码,切第一段。
 *        准,但面板会闪一下。**只在 L1/L2 都没有时**才走;读到后按商品 ID
 *        缓存 10 分钟,同一商品再点不再开面板。
 *
 *   拿不到就显示「无货号」并提示，**绝不复制半截内容**（沿用抖店 2026-10-18 的口径）。
 *
 *   ⚠️ 多个 SKU 的第一段不一致时（等于这一行的 SKU 编码规则本身不统一）:
 *      优先取与商品名末尾一致的那个,否则取出现次数最多的;不一致这件事
 *      会写进调试日志,不闷着。
 *
 * 【商品链接从哪来 —— 四档，前三档都不碰面板】(2026-10-31 第三轮)
 *
 *   用户连续两轮追问：「为什么复制链接会使用兜底」「能不能尽量不使用兜底」，
 *   并给出截图：点「分享」后弹窗里本来就明文写着
 *   `https://store.weixin.qq.com/shop/a/<短码>`，右边还有个「复制」。
 *
 *   上一版为什么**必然**走兜底（这是确定性缺陷，不是偶发）：
 *   内容脚本跑在隔离世界，页面 JS 挂在 DOM 元素上的 `__vue__` /
 *   `__vueParentComponent` 在隔离世界读到的是 undefined —— 同一 DOM 节点在
 *   两个世界是两份包装对象。于是「读 Vue 组件实例」那一档在真机上永远拿不到，
 *   每次都退到模拟点击。自测当时是绿的，因为 jsdom 里 `tr.__vue__` 是同世界
 *   挂在同一个对象上的，**仿真环境缺了「隔离世界」这一层**。
 *
 *   现在的取链接顺序（前面命中就立刻返回，命中不了才往下走）：
 *
 *     L1 主世界接口取样映射 —— `wx-link-main.js` 在 MAIN world 里 hook 页面的
 *        fetch / XHR，凡是商品/分享接口的 JSON 响应，只要某个对象里同时有
 *        「商品 ID」和「/shop/a/ 短链」，就建 `<商品ID> → 链接` 映射。
 *        列表接口一返回就整页商品都有映射 ⇒ **一次点击都不用，面板不打开**。
 *        （用户提议的「把中控台接口取样搬过来」，就是这一档。）
 *
 *     L2 主世界读 Vue 内存 —— 抓不到网络时，在页面 Vue 实例里按商品 ID
 *        **精确**匹配商品对象，取其链接。这一档只有 MAIN world 做得到。
 *
 *     L3 行内明文 —— 行内元素的文本 / title / href / data-* 里若出现
 *        `/shop/a/` 链接（万一平台哪天把它铺到列表上）。零点击。
 *
 *     L4 兜底：绘制前隐藏本次分享浮层，读链接后等关闭完成再恢复样式。
 *
 *   已废弃两条：
 *     · 「扫页面里隐藏的 input」—— 分享面板是全局单例，里面留着上一次分享的
 *       别的商品的链接 ⇒ 给 A 商品复制 B 商品的链接，比取不到严重得多。
 *     · 「点面板里的『复制』按钮再读剪贴板」—— 本扩展只有 clipboardRead、
 *       没有 clipboardWrite；平台写入 + 我再读出 + 我再写入，链路上多两次
 *       剪贴板切换，还会把用户原有剪贴板内容洗掉。**扒文本**一次读取即可，
 *       不依赖剪贴板权限，也不会执行平台的复制副作用。
 *
 *   链接形态（用户截图确认）：`https://store.weixin.qq.com/shop/a/<短码>`。
 *   短码与商品 ID **没有**可推算关系（同一商品的「微信短链」是另一套码），
 *   所以只能"读"，不能"算"。白名单收窄到 `/shop/a/`：宁可不取，也不把
 *   编辑页 / 店铺首页的链接写进剪贴板。
 *
 * 【两个按钮第一版都失败 —— 本轮加固】(用户 2026-10-31 反馈)
 *
 *   · 货号：失败时把「名字候选几个、末尾 20 字是什么」写进调试日志,
 *     不再只闪一个「无货号」让人猜;名字元素改为「取文本最长的那个」,
 *     避免表格里隐藏模板行先命中。
 *   · 点击：同一元素上绑**捕获 + 冒泡**两份监听(平台可能在捕获阶段截断,
 *     记忆里 2026-10-25 踩过同类);用 fired 去重防执行两次。
 *   · 失败一律进 `__dycDiag.note`,导出诊断报告就能看到卡在哪一步。
 *     链接的 note 会带上「接口取样解析了几份 JSON / 命中几条 / 疑似字段名」,
 *     实机跑一次就能看出微信的接口到底把链接放在哪个字段。
 *
 *
 * 【界面】
 *
 *   两个按钮插在「规格/编码 预览 分享」那一行末尾（用户截图红框的位置）。
 *   样式沿用抖店「货号」按钮的口径：`all: initial` 隔离平台样式、固定宽高
 *   不随文案变化抖动、常态半透明、悬停变实心。
 *
 *   ⚠️ 那一行宽度只有 288px,内容已占去大半 ⇒ 插进去空间不够。所以给
 *      容器补一条 `flex-wrap: wrap`（放得下时行为不变、放不下才换行）,
 *      绝不让按钮溢出压到右侧价格列。关开关时这条也一并还原。
 *
 * 【穿透 shadow】
 *
 *   微信小店是 micro-app 微前端,商品表格在 `<micro-app>` 的 open shadowRoot 里。
 *   本文件自带 collectRoots()(document + open shadowRoot + 同源 iframe),
 *   **不依赖 page-probe.js** —— 那是按需注入的采集工具,不在常驻注入列表里。
 *
 * 【已知边界(如实记录)】
 *
 *   1. **接口取样只覆盖「页面已经请求过」的数据**。列表接口若本身不带链接,
 *      第一次还得点一次分享 —— 点完那次分享的响应会被抓下来并按商品缓存,
 *      同一商品之后就是零点击(映射留在内存,页面刷新即散)。
 *      微信把链接放在哪一档,**本工程无法在开发机验证**(登不进商家后台),
 *      所以诊断 note 会回报「解析了几份 JSON / 命中几条 / 疑似字段名」。
 *   2. 分享面板的真实 DOM 结构同样未实机验证。面板读取按「可见浮层里的
 *      明文链接」通用路走, **多个候选时不猜** —— 宁可报取不到。
 *   3. 关面板靠派发 Escape 键 —— 平台若只认遮罩点击,面板可能留在屏幕上,
 *      用户手动关一次即可(提示里不假装已经关掉)。
 *   4. 行高不会变:按钮换行时该行会高出一行按钮(20px),这是"加按钮"的必然代价。
 * ============================================================
 */

(function dycWxGoodsTools() {
  'use strict';

  // 防重复注入(SPA 路由回切、脚本意外重跑时不会叠出多个观察器)
  if (window.__DYC_WX_GOODS_TOOLS__) return;
  window.__DYC_WX_GOODS_TOOLS__ = true;

  if (typeof dycReadFlags !== 'function') return;

  var BTN_ATTR = 'data-dyc-wx-btn';
  var WRAP_ATTR = 'data-dyc-wx-btnwrap';
  var PAGE_RE = /^\/shop\/goods\/list/;
  var MIN_ROWS = 3;
  var MAX_DEPTH = 6;
  var NODE_BUDGET = 20000;

  // 官方网页链接形态。全部取链接的档位统一用它 —— 只认 /shop/a/<短码>，
  // 宽的 "任何 shop 下的链接" 会把编辑页/店铺首页也认进来，宁可不取。
  var SHOP_SHORT_RE = /https?:\/\/store\.weixin\.qq\.com\/shop\/a\/[A-Za-z0-9_-]+/;

  // 「隐身」标记：自动点开分享面板时给它设 opacity:0，让用户看不到闪动。
  // 判可见时要把这类节点当可见处理，否则读不到里面的链接。
  var VEIL_ATTR = 'data-dyc-veil';
  var VEIL_SEL = [
    '[class*="mask"]', '[class*="Mask"]', '[class*="overlay"]', '[class*="Overlay"]',
    '[class*="modal"]', '[class*="Modal"]', '[class*="popup"]', '[class*="Popup"]',
    '[class*="dialog"]', '[class*="Dialog"]', '[role="dialog"]', '[role="menu"]',
    '[class*="popover"]', '[class*="Popover"]'
  ].join(',');

  var NAME_CLASS = 'goods_title_1';
  var NOT_NAME = /^(到手价|售出|已售|库存|货号|规格|ID|时间|销量|佣金)/;
  var ONLY_NUM = /^[\d\s.,:%\-+()（）#¥￥]+$/;

  // 货号 = SKU 编码第一个分隔符之前那段。半角/全角连字符与下划线、斜杠都算分隔符。
  var SKU_SEP_RE = /[-－—–_＿／\/]/;
  // 组件数据里哪些键名算「SKU 编码」
  var SKU_KEY_RE = /^(sku_?code|sku_?sn|sku_?no|sku_?id|sku_?num|outer_?sku_?id|outer_?id|outer_?code|goods_?code|product_?code|merchant_?code|code)$/i;
  var SKU_GROUP_RE = /sku|spec|sale_?prop/i;

  var flags = null;
  var tbody = null;
  var observers = [];
  var observedRoots = [];
  var pending = false;
  var tailTimer = null;
  var lastHref = '';
  var prevOn = null;
  var busy = false;          // 读面板期间上锁,防连点
  var activeLinkCancel = null;
  var codeCache = {};        // 商品 ID → { h: 货号, t: 时间戳 }
  var CODE_TTL = 10 * 60 * 1000;

  function enabled() {
    return !!flags && flags.wxRowCopy !== false;
  }

  /* ---------- 跨 realm / 穿透 ---------- */

  function csOf(el) {
    try {
      var doc = el.ownerDocument;
      var win = (doc && doc.defaultView) || window;
      return win.getComputedStyle(el);
    } catch (e) { return null; }
  }

  /** 扩展自己注入的节点:认 data 标记,不认文案(改名也不会误判) */
  function isExtNode(el) {
    if (!el || !el.getAttribute) return false;
    if (el.getAttribute(BTN_ATTR) !== null) return true;
    if (el.getAttribute(WRAP_ATTR) !== null) return true;
    if (el.id && el.id.indexOf('dyb-') === 0) return true;
    return false;
  }

  function iframeDocOf(el) {
    try {
      var d = el.contentDocument;
      return d && d.documentElement ? d : null;
    } catch (e) { return null; }
  }

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
        if (n > bestRows) { bestRows = n; best = tb; }
      }
    }
    if (!best || bestRows < MIN_ROWS) return null;
    return best;
  }

  function isGoodsListPage() {
    try { return PAGE_RE.test(location.pathname); } catch (e) { return false; }
  }

  /* ---------- 元素识别 ---------- */

  function textOf(el) {
    return String((el && el.textContent) || '').replace(/\s+/g, ' ').trim();
  }

  /** 商品名元素：语义类名优先（多个时取文本最长的，避开隐藏模板行），退化到行内最长的叶子 */
  function findNameEl(tr) {
    try {
      var list = tr.querySelectorAll('.' + NAME_CLASS);
      if (list && list.length > 0) {
        var best = null;
        var bestLen = -1;
        for (var i = 0; i < list.length; i++) {
          var len = textOf(list[i]).length;
          if (len > bestLen) { best = list[i]; bestLen = len; }
        }
        if (best && bestLen > 0) return best;
      }
    } catch (e) { /* 走兜底 */ }
    var walker;
    try {
      walker = tr.ownerDocument.createTreeWalker(tr, NodeFilter.SHOW_ELEMENT, null);
    } catch (e2) { return null; }
    var el;
    var best = null;
    var bestLen = 0;
    while ((el = walker.nextNode())) {
      if (isExtNode(el)) continue;
      if (el.children.length > 0) continue;      // 只要叶子
      var t = textOf(el);
      if (t.length < 4 || t.length > 200) continue;
      if (ONLY_NUM.test(t) || NOT_NAME.test(t)) continue;
      if (t.length > bestLen) { best = el; bestLen = t.length; }
    }
    return best;
  }

  /**
   * 元信息行:行内文本恰为「分享」的那个叶子元素的父容器。
   * 这一行同时装着「规格/编码 预览 分享」,按钮就插在它末尾(用户截图红框处)。
   */
  function findMetaRow(tr) {
    var walker;
    try {
      walker = tr.ownerDocument.createTreeWalker(tr, NodeFilter.SHOW_ELEMENT, null);
    } catch (e) { return null; }
    var el;
    while ((el = walker.nextNode())) {
      if (isExtNode(el)) continue;
      if (el.children.length > 0) continue;
      if (textOf(el) !== '分享') continue;
      var parent = el.parentElement;
      if (parent && parent !== tr) return parent;
    }
    return null;
  }

  /* ---------- 取号：货号 = SKU 编码的第一段 ---------- */

  /**
   * 名称末尾推算款号:末尾「≥4 位且含数字」的字母数字串。
   * 与抖店 copy-code.js 同口径 —— 纯英文字尾不当款号,必须含数字。
   */
  /**
   * 从商品名末尾取货号候选。
   * 入参可以是元素，也可以直接是名字文本（消息场景只拿得到字符串）。
   */
  function guessFromName(nameEl) {
    var t = (typeof nameEl === 'string') ? nameEl : textOf(nameEl);
    if (!t) return '';
    var m = t.match(/([A-Za-z0-9][A-Za-z0-9\-_]*)\s*$/);
    if (!m) return '';
    var cand = m[1];
    if (cand.length < 4) return '';
    if (!/\d/.test(cand)) return '';
    return cand;
  }

  /** 去掉外面包的括号/引号/顿号 —— 弹层里编码写作「(NE1C1142W-35-38)」 */
  function stripWrap(s) {
    return String(s || '')
      .replace(/^[\s（(\[【「"']+/, '')
      .replace(/[\s）)\]】」"'，,、；;。]+$/, '');
  }

  /** 像不像一个 SKU 编码:纯 ASCII、字母数字、含数字、不带中文 */
  function looksLikeSku(s) {
    var t = stripWrap(s);
    if (!t || t.length < 4 || t.length > 48) return false;
    if (/[\u4e00-\u9fa5\u3000-\u303f\uff00-\uffef]/.test(t)) return false;
    if (!/^[A-Za-z0-9][A-Za-z0-9._\-\/]*$/.test(t)) return false;
    if (!/\d/.test(t)) return false;
    // 纯数字也放过,但要求 6 位以上 —— 弹层里「38」「90」这种规格数字不算编码
    if (!/[A-Za-z]/.test(t)) {
      if (!/^\d[\d._\-\/]*$/.test(t)) return false;
      if (t.replace(/[^0-9]/g, '').length < 6) return false;
    }
    return true;
  }

  /**
   * 取「第一个分隔符之前」那一段。
   * `NE1C1142W-35-38` → `NE1C1142W`；`NE1C1142W` → 原样。
   * 切完太短、或夹中文的，一律当取不到（宁可空，不给半截）。
   */
  function headOf(raw) {
    var s = stripWrap(String(raw || '').trim());
    if (!s) return '';
    var i = s.search(SKU_SEP_RE);
    var head = i > 0 ? s.slice(0, i) : s;
    head = head.replace(/[（(].*$/, '').trim();
    if (head.length < 3 || head.length > 40) return '';
    if (!/\d/.test(head)) return '';
    if (/[\u4e00-\u9fa5]/.test(head)) return '';
    return head;
  }

  /** 一组原始编码 → 去重后的货号列表（保持出现顺序） */
  function headsOf(codes) {
    var out = [];
    for (var i = 0; i < codes.length; i++) {
      var h = headOf(codes[i]);
      if (!h) continue;
      if (out.indexOf(h) >= 0) continue;
      out.push(h);
    }
    return out;
  }

  /**
   * 从一组编码里挑一个货号。
   * prefer = 商品名末尾那段：多 SKU 的货号不一致时优先它，其次取最多的。
   */
  function pickHead(codes, prefer) {
    var count = {};
    var order = [];
    for (var i = 0; i < codes.length; i++) {
      var h = headOf(codes[i]);
      if (!h) continue;
      if (count[h] === undefined) { count[h] = 0; order.push(h); }
      count[h]++;
    }
    if (order.length === 0) return null;
    var head = '';
    if (prefer && count[prefer] !== undefined) {
      head = prefer;
    } else {
      var bestN = 0;
      for (var k = 0; k < order.length; k++) {
        if (count[order[k]] > bestN) { bestN = count[order[k]]; head = order[k]; }
      }
    }
    return { head: head, all: order, mixed: order.length > 1 };
  }

  function cacheGet(goodsId) {
    if (!goodsId) return '';
    var hit = codeCache[goodsId];
    if (!hit) return '';
    if (Date.now() - hit.t > CODE_TTL) { delete codeCache[goodsId]; return ''; }
    return hit.h;
  }

  function cacheSet(goodsId, head) {
    if (!goodsId || !head) return;
    codeCache[goodsId] = { h: head, t: Date.now() };
  }

  /** 行内「规格/编码」入口（点它才出 SKU 弹层） */
  function findSpecTrigger(tr) {
    var walker;
    try {
      walker = tr.ownerDocument.createTreeWalker(tr, NodeFilter.SHOW_ELEMENT, null);
    } catch (e) { return null; }
    var el;
    while ((el = walker.nextNode())) {
      if (isExtNode(el)) continue;
      if (el.children.length > 0) continue;
      var t = textOf(el);
      if (t === '规格/编码' || t === '规格' || /^规格\/?编码?$/.test(t)) return el;
    }
    return null;
  }

  /** 在某个容器里把「像 SKU 编码」的文本片段捞出来（按空白/标点切词） */
  function codeTokensIn(node) {
    var out = [];
    if (!node || !node.ownerDocument) return out;
    var walker;
    try {
      walker = node.ownerDocument.createTreeWalker(node, 4 /* SHOW_TEXT */, null);
    } catch (e) { return out; }
    var n;
    var guard = 4000;
    while ((n = walker.nextNode()) && guard-- > 0) {
      var t = n.nodeValue;
      if (!t || t.length > 240) continue;
      var parts = t.split(/[\s，,、;；|]+/);
      for (var i = 0; i < parts.length; i++) {
        var s = stripWrap(parts[i]);
        if (looksLikeSku(s)) out.push(s);
      }
    }
    return out;
  }

  /** 找文本里含某个词的最内层元素（按文本节点反查，避免对每个元素算 textContent） */
  function anchorElOf(root, words) {
    var doc = root.ownerDocument || document;
    var walker;
    try { walker = doc.createTreeWalker(root, 4 /* SHOW_TEXT */, null); } catch (e) { return null; }
    var n;
    var guard = 6000;
    while ((n = walker.nextNode()) && guard-- > 0) {
      var t = n.nodeValue;
      if (!t) continue;
      for (var i = 0; i < words.length; i++) {
        if (t.indexOf(words[i]) >= 0) return n.parentElement;
      }
    }
    return null;
  }

  /**
   * 读「规格/编码」弹层里的 SKU 编码。
   *
   * 弹层是 body 级浮层，没有稳定类名，所以按内容定位：找「商家SKU编码」标题，
   * 从它往上逐层看谁装着编码，取**编码个数最多且文本不太长**的那层，
   * 这样既能拿到全部 SKU，又不会一路爬到 body 把别处文本也扫进来。
   */
  function skuCodesInPanel() {
    var roots = collectRoots();
    for (var i = 0; i < roots.length; i++) {
      var anchor = anchorElOf(roots[i], ['商家SKU编码', '商家 SKU 编码', 'SKU编码', 'SKU 编码']);
      if (!anchor) continue;
      var node = anchor;
      var best = [];
      for (var up = 0; up < 8 && node; up++) {
        var codes = codeTokensIn(node);
        if (codes.length > best.length) best = codes;
        var len = String(node.textContent || '').length;
        if (len > 3000) break;          // 再往上就是整页了，停
        var parent = node.parentElement;
        if (!parent) break;
        node = parent;
      }
      if (best.length > 0) return best;
    }
    return [];
  }

  /** 点一下元素（先用原生 click，老内核再补一整套指针事件） */
  function tap(el) {
    var ok = false;
    try { el.click(); ok = true; } catch (e) { ok = false; }
    if (ok) return;
    var seq = ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'];
    for (var i = 0; i < seq.length; i++) {
      try {
        var isPointer = seq[i].indexOf('pointer') === 0;
        var Ctor = isPointer ? (window.PointerEvent || window.MouseEvent) : window.MouseEvent;
        el.dispatchEvent(new Ctor(seq[i], { bubbles: true, cancelable: true }));
      } catch (e2) { /* 老内核没有 PointerEvent，跳过 */ }
    }
  }

  /**
   * L3：点开「规格/编码」弹层读 SKU 编码，读完关掉。
   * 最多等 2.5 秒（首次展开组件要渲染，1 秒内常常读不到）。
   */
  function codesFromPanel(tr, done) {
    var trig = findSpecTrigger(tr);
    if (!trig) { done([]); return; }
    busy = true;
    var tries = 0;
    var timer = null;
    var settled = false;

    function finish(list) {
      if (settled) return;
      settled = true;
      if (timer) { clearInterval(timer); timer = null; }
      busy = false;
      closeLayer();
      setTimeout(function () { done(list); }, 120);   // 先关面板，再落剪贴板
    }

    tap(trig);
    timer = setInterval(function () {
      tries++;
      var list = [];
      try { list = skuCodesInPanel(); } catch (e) { list = []; }
      if (list.length > 0) { finish(list); return; }
      if (tries >= 25) finish([]);
    }, 100);
  }

  /* ---------- 剪贴板 ---------- */

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
      try { ta.setSelectionRange(0, text.length); } catch (e0) { /* 老内核 */ }
      // 焦点若不在 textarea 上（按钮在 shadow 内，焦点可能被宿主接走），
      // execCommand('copy') 会失效 —— 显式聚焦一次。
      if (document.activeElement !== ta) {
        try { ta.focus(); } catch (e1) { /* 聚焦失败就按原样试 */ }
      }
      var ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return !!ok;
    } catch (e) {
      return false;
    }
  }

  /**
   * 写剪贴板。**先走 execCommand，再试 Clipboard API**。
   *
   * 为什么倒过来：本扩展的 permissions 只有 `clipboardRead`、没有
   * `clipboardWrite`。在这种上下文里 `navigator.clipboard.writeText()`
   * 不但可能 reject，**还可能一直挂起不 settle** —— 那么 done 永远不被调用，
   * 按钮就卡在「点了没反应」的样子（用户 2026-10-31 报的正是这个）。
   * 抖店那几处货号按钮实际能工作，靠的也是 execCommand 这条兜底路径。
   *
   * execCommand 是同步的，成败立刻知道，反馈不会迟到。
   */
  function copyText(text, done) {
    var settled = false;
    function finish(ok) {
      if (settled) return;
      settled = true;
      done(ok);
    }
    if (fallbackCopy(text)) { finish(true); return; }
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(
          function () { finish(true); },
          function () { finish(false); }
        );
        // 再兜一层：API 若挂起，300ms 后按失败收尾，不让按钮僵住
        setTimeout(function () { finish(false); }, 300);
        return;
      }
    } catch (e) { /* 落到失败 */ }
    finish(false);
  }

  /* ---------- 消息 ---------- */

  function say(text, type, opts) {
    if (typeof toast === 'function') toast(text, type, opts || {});
  }

  /* ---------- 按钮 ---------- */

  var BASE_CSS = {
    all: 'initial',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    height: '20px',
    padding: '0',
    // 固定宽度:flash 换文案时按钮不变宽,相邻元素不被推挤(沿用抖店 #88 口径)
    flex: '0 0 auto',
    border: '1px solid #07c160',
    borderRadius: '4px',
    background: '#fff',
    color: '#07c160',
    font: "12px/1 -apple-system, 'Microsoft YaHei', sans-serif",
    whiteSpace: 'nowrap',
    verticalAlign: 'middle',
    cursor: 'pointer',
    boxSizing: 'border-box',
    opacity: '0.75'
  };

  function applyStyle(btn, extra) {
    var k;
    for (k in BASE_CSS) {
      if (Object.prototype.hasOwnProperty.call(BASE_CSS, k)) {
        // 必须用连字符写法,驼峰在 setProperty 里静默无效
        var name = k.replace(/[A-Z]/g, function (c) { return '-' + c.toLowerCase(); });
        try { btn.style.setProperty(name, BASE_CSS[k]); } catch (e) { btn.style[k] = BASE_CSS[k]; }
      }
    }
    if (extra) {
      for (k in extra) {
        if (Object.prototype.hasOwnProperty.call(extra, k)) {
          var n2 = k.replace(/[A-Z]/g, function (c) { return '-' + c.toLowerCase(); });
          try { btn.style.setProperty(n2, extra[k]); } catch (e2) { btn.style[k] = extra[k]; }
        }
      }
    }
  }

  function bindHover(btn) {
    btn.addEventListener('mouseenter', function () {
      if (btn.disabled) return;
      btn.style.background = '#07c160';
      btn.style.color = '#fff';
      btn.style.opacity = '1';
    });
    btn.addEventListener('mouseleave', function () {
      if (btn.disabled) return;
      btn.style.background = '#fff';
      btn.style.color = '#07c160';
      btn.style.opacity = '0.75';
    });
  }

  function makeBtn(label, width) {
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = label;
    btn.setAttribute(BTN_ATTR, '1');
    applyStyle(btn, { width: width + 'px' });
    bindHover(btn);
    return btn;
  }

  /** 按钮原地闪一下结果,再回原文案(不弹窗,不打断) */
  function flash(btn, text, isErr, restore) {
    btn.textContent = text;
    btn.disabled = true;
    btn.style.background = '#fff';
    btn.style.color = isErr ? '#86909c' : '#07c160';
    btn.style.borderColor = isErr ? '#c9cdd4' : '#07c160';
    btn.style.opacity = '1';
    if (btn.__dycTimer) clearTimeout(btn.__dycTimer);
    btn.__dycTimer = setTimeout(function () {
      btn.textContent = restore;
      btn.disabled = false;
      btn.style.color = '#07c160';
      btn.style.borderColor = '#07c160';
      btn.style.opacity = '0.75';
    }, 1200);
  }

  /* ---------- L1：从页面数据里读（真一键，零点击） ---------- */

  /** 这一行的商品 ID（行内「ID: 10001816614795」） */
  function goodsIdOf(tr) {
    var t = textOf(tr);
    var m = t.match(/ID[：:\s]*([0-9]{6,})/i);
    return m ? m[1] : '';
  }

  /** 元素上挂的 Vue 实例（Vue 2 / Vue 3 都试） */
  function vueOf(el) {
    try {
      if (el.__vue__) return el.__vue__;                            // Vue 2
      if (el.__vueParentComponent) return el.__vueParentComponent;  // Vue 3
      if (el._vnode && el._vnode.component) return el._vnode.component;
    } catch (e) { /* 读不到就当没有 */ }
    return null;
  }

  /** 在一个对象里浅层找形如 shop/a/xxx 的字符串 */
  function scanStrings(obj, maxDepth, budgetLeft) {
    var seen = [];
    var queue = [{ v: obj, d: 0 }];
    var budget = budgetLeft || 300;
    while (queue.length > 0 && budget > 0) {
      budget--;
      var item = queue.shift();
      var v = item.v;
      if (!v || typeof v !== 'object' || item.d > maxDepth) continue;
      if (v.nodeType || v === window || v === document) continue;
      if (seen.indexOf(v) >= 0) continue;
      seen.push(v);
      var keys;
      try { keys = Object.keys(v); } catch (e) { continue; }
      for (var i = 0; i < keys.length; i++) {
        var val;
        try { val = v[keys[i]]; } catch (e2) { continue; }
        if (typeof val === 'string') {
          var m = val.match(SHOP_SHORT_RE);
          if (m) return m[0];
        } else if (val && typeof val === 'object') {
          queue.push({ v: val, d: item.d + 1 });
        }
      }
    }
    return '';
  }

  /**
   * 在组件实例里找「属于这个商品 ID」的对象，并从中取链接。
   *
   * 为什么要按 ID 匹配:列表 50 条商品的数据都挂在同一个组件实例上,
   * 直接取第一个字符串匹配会拿到**别的商品**的链接 —— 那比取不到更糟。
   * 找不到对应关系就返回空,由 L2/L3 接手。
   */
  function linkFromObject(root, goodsId) {
    if (!root || !goodsId) return '';
    var seen = [];
    var queue = [{ v: root, d: 0 }];
    var budget = 4000;
    while (queue.length > 0 && budget > 0) {
      budget--;
      var item = queue.shift();
      var v = item.v;
      if (!v || typeof v !== 'object' || item.d > 7) continue;
      if (v.nodeType || v === window || v === document) continue;
      if (seen.indexOf(v) >= 0) continue;
      seen.push(v);

      var keys;
      try { keys = Object.keys(v); } catch (e) { continue; }

      // ① 这个对象是不是"当前这个商品"：必须**精确等于**商品 ID。
      //    不能用"包含"判定 —— 列表容器对象含有全部商品 ID，包含匹配会让它
      //    命中，然后从里面取到第一个商品的链接（取错比取不到更糟）。
      var isThis = false;
      for (var i = 0; i < keys.length; i++) {
        var val;
        try { val = v[keys[i]]; } catch (e2) { continue; }
        if (val && typeof val !== 'object' && String(val) === goodsId) { isThis = true; break; }
      }

      // ② 是它 → 只在这个对象的两层内找链接（商品对象里的字段通常就在第一层）
      if (isThis) {
        var link = scanStrings(v, 2, 120);
        if (link) return link;
      }

      // ③ 展开下一层（只走对象/数组，跳过函数与基本类型）
      for (var j = 0; j < keys.length; j++) {
        var cv;
        try { cv = v[keys[j]]; } catch (e3) { continue; }
        if (cv && typeof cv === 'object') queue.push({ v: cv, d: item.d + 1 });
      }
    }
    return '';
  }

  /** L1 入口：从行元素往上找组件实例，逐个试 */
  function linkFromRowData(tr) {
    var goodsId = goodsIdOf(tr);
    if (!goodsId) return '';
    var node = tr;
    for (var up = 0; up < 8 && node; up++) {
      var inst = vueOf(node);
      if (inst) {
        var link = linkFromObject(inst, goodsId);
        if (link) return link;
      }
      var parent = node.parentElement;
      if (!parent && node.getRootNode && node.getRootNode().host) {
        parent = node.getRootNode().host;      // 跨出 shadow 继续往上
      }
      node = parent;
    }
    return '';
  }

  /** 在「属于这个商品 ID」的对象里收集 SKU 编码（只看 sku/code 类键，不乱扫） */
  function collectSkuCodes(obj, out, depth) {
    if (!obj || typeof obj !== 'object' || depth > 3 || out.length >= 60) return;
    if (obj.nodeType) return;
    var keys;
    try { keys = Object.keys(obj); } catch (e) { return; }
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i];
      var v;
      try { v = obj[k]; } catch (e2) { continue; }
      if (typeof v === 'string') {
        if (SKU_KEY_RE.test(k) && looksLikeSku(v)) out.push(v);
      } else if (Array.isArray(v)) {
        if (SKU_GROUP_RE.test(k)) {
          for (var j = 0; j < v.length && j < 50; j++) {
            if (v[j] && typeof v[j] === 'object') collectSkuCodes(v[j], out, depth + 1);
          }
        }
      } else if (v && typeof v === 'object' && SKU_GROUP_RE.test(k)) {
        collectSkuCodes(v, out, depth + 1);
      }
    }
  }

  /**
   * L1 取货号：在组件实例里找「属于这个商品 ID」的对象，捞它的 SKU 编码。
   * 与 linkFromObject 同一套原则 —— 必须**精确**等于商品 ID，找不准就放弃，
   * 绝不拿列表里第一个商品的 SKU 充数。
   */
  function codesFromObject(root, goodsId) {
    if (!root || !goodsId) return [];
    var seen = [];
    var queue = [{ v: root, d: 0 }];
    var budget = 4000;
    while (queue.length > 0 && budget > 0) {
      budget--;
      var item = queue.shift();
      var v = item.v;
      if (!v || typeof v !== 'object' || item.d > 7) continue;
      if (v.nodeType || v === window || v === document) continue;
      if (seen.indexOf(v) >= 0) continue;
      seen.push(v);

      var keys;
      try { keys = Object.keys(v); } catch (e) { continue; }

      var isThis = false;
      for (var i = 0; i < keys.length; i++) {
        var val;
        try { val = v[keys[i]]; } catch (e2) { continue; }
        if (val && typeof val !== 'object' && String(val) === goodsId) { isThis = true; break; }
      }
      if (isThis) {
        var out = [];
        collectSkuCodes(v, out, 0);
        if (out.length > 0) return out;
      }

      for (var j = 0; j < keys.length; j++) {
        var cv;
        try { cv = v[keys[j]]; } catch (e3) { continue; }
        if (cv && typeof cv === 'object') queue.push({ v: cv, d: item.d + 1 });
      }
    }
    return [];
  }

  /** L1 入口：从行元素往上找组件实例 */
  function codesFromRowData(tr, goodsId) {
    if (!goodsId) return [];
    var node = tr;
    for (var up = 0; up < 8 && node; up++) {
      var inst = vueOf(node);
      if (inst) {
        var codes = codesFromObject(inst, goodsId);
        if (codes.length > 0) return codes;
      }
      var parent = node.parentElement;
      if (!parent && node.getRootNode && node.getRootNode().host) {
        parent = node.getRootNode().host;
      }
      node = parent;
    }
    return [];
  }

  /* ---------- L2 已废弃（2026-10-31 第二轮） ----------
   * 原计划扫「页面里已存在但被隐藏」的 input 取链接。但分享面板几乎都是
   * **全局单例**：面板里留的是「上一次分享的那个商品」的链接，扫全页取到
   * 第一个 ⇒ 给 A 商品复制了 B 商品的链接。这类错误用户很难发现（粘贴出去
   * 才发现发错货），比"取不到"严重得多。所以干脆不要这条路。
   *
   * 只保留 L1（按商品 ID 精确匹配数据）与 L3（兜底模拟点击，范围天然限定
   * 在当前这一行打开的、属于当前商品的面板上）。
   */

  /* ---------- L4：兜底 —— 模拟点开分享面板 ---------- */

  /**
   * 元素及其祖先是否"看得见"。
   *
   * 为什么必须判：分享面板几乎都是**全局单例** —— 关掉只是 `display:none`，
   * 里面留的是上一次分享的**别的商品**的链接。不判可见性就会把上一单的链接
   * 复制给这一单（用户粘贴出去才发现发错货）。
   * 只判元素自身不够：父级 display:none 时子元素的 computed display 仍是 block,
   * 所以向上走一层层看。
   */
  function isShown(el) {
    var node = el;
    var depth = 0;
    while (node && node.nodeType === 1 && depth++ < 12) {
      var s = csOf(node);
      if (s) {
        if (s.display === 'none' || s.visibility === 'hidden' || s.visibility === 'collapse') return false;
        // 被我们自己「隐身」的面板仍要算可见 —— 链接还得从它里面读出来
        if (s.opacity === '0' && !node.getAttribute(VEIL_ATTR)) return false;
      }
      node = node.parentElement;
    }
    return true;
  }

  /**
   * 扫一遍页面里的 `/shop/a/` 明文链接。
   *
   * 可见性 + **多个不同候选时不猜**（返回空由上层报取不到）：
   * 面板里同时有「微信短链 #微信小店://…」与「网页链接 https://…/shop/a/…」，
   * 前者不匹配本正则，天然被排除。
   */
  function scanLinkOnce(layers) {
    var roots = layers.map(function (item) { return item.el; });
    var found = [];
    function add(v) {
      var m = String(v || '').match(SHOP_SHORT_RE);
      if (!m) return;
      if (found.indexOf(m[0]) < 0) found.push(m[0]);
    }
    for (var i = 0; i < roots.length; i++) {
      var r = roots[i];
      if (!r.isConnected || !isShown(r)) continue;
      add(r.textContent);
      // ① input / textarea 的 value —— "复制链接"最常见的实现
      var fields;
      try { fields = r.querySelectorAll('input,textarea'); } catch (e) { fields = []; }
      for (var j = 0; j < fields.length; j++) {
        if (!isShown(fields[j])) continue;
        add(fields[j].value);
      }
      // ② 浮层容器里的纯文本
      var boxes;
      try {
        boxes = r.querySelectorAll('[role="dialog"],[role="menu"],[class*="popover"],[class*="popup"],[class*="modal"],[class*="share"],[class*="Share"]');
      } catch (e2) { boxes = []; }
      for (var k = 0; k < boxes.length; k++) {
        if (isExtNode(boxes[k])) continue;
        if (!isShown(boxes[k])) continue;
        add(boxes[k].textContent);
      }
    }
    if (found.length === 1) return found[0];
    return '';      // 0 个 = 没读到；多个 = 归属不明，不猜
  }

  /**
   * 关掉分享面板。
   *
   * 只派发 Escape —— 不点遮罩(可能点到页面上别的按钮,风险更大)。
   * 平台若只认遮罩点击,面板会留着;提示语里不假装已经关掉,用户手点一次即可。
   */
  function closeLayer() {
    function fire(type) {
      try {
        var ev = new KeyboardEvent(type, {
          key: 'Escape', code: 'Escape', keyCode: 27, which: 27,
          bubbles: true, cancelable: true
        });
        var target = document.activeElement || document.body;
        target.dispatchEvent(ev);
      } catch (e) { /* 老内核构造不了 KeyboardEvent 就放弃 */ }
    }
    fire('keydown');
    setTimeout(function () { fire('keyup'); }, 80);
  }

  /* ---------- 两个按钮的行为 ---------- */

  function onCopyCode(tr, btn) {
    if (busy) return;
    var goodsId = goodsIdOf(tr);
    var nameEl = findNameEl(tr);
    var nameHead = headOf(guessFromName(nameEl));

    // ① 上次读过（同一个商品）→ 直接用，不再开面板
    var cached = cacheGet(goodsId);
    if (cached) { deliverCode(btn, cached, 'cache'); return; }

    // ② 页面数据里的 SKU 编码（零点击，且是 SKU 原文）
    var codes = [];
    try { codes = codesFromRowData(tr, goodsId); } catch (e1) { codes = []; }
    var picked = pickHead(codes, nameHead);
    if (picked) {
      cacheSet(goodsId, picked.head);
      noteMixed(goodsId, picked);
      deliverCode(btn, picked.head, 'data');
      return;
    }

    // ③ 商品名末尾（零点击，但可能漏写）
    if (nameHead) { deliverCode(btn, nameHead, 'name'); return; }

    // ④ 都没有 → 点开「规格/编码」弹层读一次（会闪一下）
    codesFromPanel(tr, function (list) {
      var p = pickHead(list, nameHead);
      if (!p) { failCode(btn, nameEl, list.length); return; }
      cacheSet(goodsId, p.head);
      noteMixed(goodsId, p);
      deliverCode(btn, p.head, 'panel');
    });
  }

  /** 拿到货号 → 写剪贴板 → 反馈。via 只影响提示措辞，不假装 */
  function deliverCode(btn, head, via) {
    copyText(head, function (ok) {
      if (ok) {
        flash(btn, '已复制', false, '货号');
        btn.title = '货号 ' + head + ' · 点一下复制';
        // 三段式：`货号复制 ｜ NE1C1142W ｜ 已复制`
        // 中段只放对象（货号本身），「已复制」是结果、进右端弱位 ——
        // 写进文案就变成「已复制货号 X」，等于把结果和对象挤在同一段里。
        // 2026-10-31 用户：「不用告诉我兜底」⇒ 成功消息不交代走的哪条路。
        say(head, 'success',
          { source: '货号复制', count: '已复制', standalone: true });
        if (window.__dycDiag && window.__dycDiag.note) {
          window.__dycDiag.note('货号', '取自' + via + '：' + head);
        }
      } else {
        flash(btn, '复制失败', true, '货号');
        say('复制失败，请重试', 'warning', { source: '货号复制' });
        if (window.__dycDiag && window.__dycDiag.note) {
          window.__dycDiag.note('货号', '取到了 ' + head + '，但剪贴板写入被拒');
        }
      }
    });
  }

  /** 一行里的货号不一致时记一笔（等于这行的 SKU 编码规则本身不统一） */
  function noteMixed(goodsId, picked) {
    if (!picked || !picked.mixed) return;
    if (!window.__dycDiag || !window.__dycDiag.note) return;
    window.__dycDiag.note('货号',
      '这个商品的 SKU 编码前缀不一致：' + picked.all.join(' / ') + '，取了 ' + picked.head
      + (goodsId ? '（ID ' + goodsId + '）' : ''));
  }

  /** 取不到货号：如实说，并把线索写进调试日志 */
  function failCode(btn, nameEl, panelCount) {
    var tail = '';
    try { tail = nameEl ? textOf(nameEl).slice(-24) : ''; } catch (e0) { tail = ''; }
    flash(btn, '无货号', true, '货号');
    say('这一行没找到货号', 'warning', { source: '货号复制' });
    btn.title = nameEl
      ? '取不到：名字末尾是「' + tail + '」，规格/编码里也没读到 SKU 编码'
      : '取不到：没找到商品名，规格/编码里也没读到 SKU 编码';
    if (window.__dycDiag && window.__dycDiag.note) {
      window.__dycDiag.note('货号',
        '取不到；名字元素=' + (nameEl ? '有' : '无') + '；末尾=' + (tail || '(空)')
        + '；弹层读到的编码数=' + panelCount);
    }
  }

  /* ---------- MAIN world 桥：接口取样映射 + 页面数据读取 ---------- */

  var BRIDGE_SRC = 'DYC_WX_LINK';
  var BRIDGE_FILE = 'src/content/wx-link-main.js';
  // 单次询问上限。缓存命中时 <50ms；最慢的一档是桥主动请求微信接口
  // （实测百毫秒级），给到 1.5 秒仍不回应才判定无果、转去开面板。
  var BRIDGE_TIMEOUT = 1500;
  var BRIDGE_MAX_TRIES = 3;
  var bridgeReady = false;
  var bridgeTries = 0;
  var bridgeDead = false;         // 连续两次问不到 → 本页不再指望桥
  var bridgeMiss = 0;
  var bridgeSeq = 0;
  var bridgeWait = {};
  var lastBridgeDiag = null;

  function bridgeNote(msg) {
    if (!window.__dycDiag || !window.__dycDiag.note) return;
    window.__dycDiag.note('商品链接', String(msg || '').slice(0, 200));
  }

  function bridgeDiagText(d) {
    if (!d) return '桥无回话';
    var s = '接口取样 JSON=' + d.json + ' 命中=' + d.hit + ' 映射=' + d.size
      + (d.byKey ? '（其中 ' + d.byKey + ' 条由 shareKey 拼出）' : '');
    s += '；主动查接口 成' + (d.apiHit || 0) + '/败' + (d.apiMiss || 0)
      + (d.hasHdr ? '(已抄到页面请求头)' : '(未抄到页面请求头)');
    if (d.apiErr) s += '（' + String(d.apiErr).slice(0, 90) + '）';
    if (d.fields && d.fields.length) s += '；疑似字段=' + d.fields.slice(0, 6).join('/');
    if (d.apis && d.apis.length) {
      s += '；接口=' + d.apis.slice(-2).map(function (a) { return a.p; }).join(' , ');
    }
    return s;
  }

  /* ---------- 给诊断报告的附加段 ---------- */

  /** 各条取源的累计命中次数（只在本页内存里，随页面关闭消散） */
  var viaCount = { net: 0, vue: 0, dom: 0, data: 0, panel: 0, fail: 0 };
  var lastBridgeAt = 0;

  function markVia(via, ok) {
    if (!ok) { viaCount.fail++; return; }
    viaCount[via] = (viaCount[via] || 0) + 1;
  }

  /**
   * 诊断报告的附加段。
   *
   * 为什么需要它：只看页面上的消息，判断不了「接口取样桥到底在不在、抓到了几份
   * 接口、有没有建起映射」—— 而这几件事恰恰决定了下次是零点击还是要开面板。
   * 让报告自己把状态写出来，比让用户复述现象可靠得多。
   */
  function reportSection() {
    var lines = [];
    lines.push('');
    lines.push('## 微信商品链接取源');
    lines.push('- 主世界桥:' + (bridgeReady
      ? '已就位'
      : (bridgeDead
        ? '未报到(连续两次没回话,本页已改为直接开面板)'
        : '未报到(注入尝试 ' + bridgeTries + ' 次)')));
    if (lastBridgeDiag) {
      lines.push('- 最近一次接口取样回话(' + (lastBridgeAt ? new Date(lastBridgeAt).toLocaleTimeString() : '—') + '):'
        + bridgeDiagText(lastBridgeDiag));
    } else {
      lines.push('- 接口取样:本页还没有回话(桥未就位,或还没点过「复制链接」)');
    }
    lines.push('- 取链接累计:接口取样 ' + viaCount.net + ' · 页面数据 ' + viaCount.vue
      + ' · 行内明文 ' + (viaCount.dom + viaCount.data) + ' · 面板 ' + viaCount.panel
      + ' · 取不到 ' + viaCount.fail);
    return lines.join('\n');
  }

  window.__DYC_WX_LINK__ = { reportSection: reportSection };

  /**
   * 把 MAIN world 脚本装进页面。两条通道都发，哪条先到都一样
   * （脚本侧自带防重入）：沿用库存清零探针那套，见 stock-net-probe.js 头注。
   *   ① script 标签 + web_accessible_resources（老内核可用，页面 CSP 可能拦）
   *   ② 后台 chrome.scripting.executeScript({world:'MAIN'})
   */
  function injectBridge() {
    try {
      var s = document.createElement('script');
      s.src = chrome.runtime.getURL(BRIDGE_FILE);
      s.onload = function () { if (s.parentNode) s.parentNode.removeChild(s); };
      s.onerror = function () { if (s.parentNode) s.parentNode.removeChild(s); };
      (document.head || document.documentElement).appendChild(s);
    } catch (e) { /* 扩展刚更新过，chrome.runtime 失联 —— 路②也会失败，走面板 */ }
    try {
      chrome.runtime.sendMessage({ type: 'dyc:wxLinkMain' }, function () {
        if (chrome.runtime.lastError) { /* 静默：桥起不来就走面板那档 */ }
      });
    } catch (e2) { /* 同上 */ }
  }

  /**
   * 确保桥在场。**页面一进来就调用** —— hook 必须早于商品列表接口返回，
   * 否则列表数据抓不到，第一次点击只能走面板。
   */
  function ensureBridge() {
    if (bridgeReady || bridgeDead || bridgeTries >= BRIDGE_MAX_TRIES) return;
    bridgeTries++;
    injectBridge();
  }

  // 桥回包的白名单复核：MAIN world 与页面脚本同世界，页面任意脚本都能伪造
  // {source, rid, link} 回包 —— 链接不过 SHOP_SHORT_RE 复核就写剪贴板，
  // 用户会把恶意链接当「商品链接」发给客户（2026-11-01 体检 P0-2）。
  // 取错比取不到严重得多，所以非本店商品链接一律当没拿到。
  function safeBridgeLink(v) {
    var m = String(v || '').match(SHOP_SHORT_RE);
    return m ? m[0] : '';
  }

  window.addEventListener('message', function (e) {
    // 只认同窗口回包（桥在 MAIN world，postMessage 目标就是本 window）；
    // 其余来源（iframe / 扩展间）一律不收。
    if (e.source !== window) return;
    var d = e.data;
    if (!d || typeof d.source !== 'string') return;
    if (d.source === BRIDGE_SRC) {
      if (d.type === 'ready') bridgeReady = true;
      return;
    }
    if (d.source === BRIDGE_SRC + '_HIT') {
      // 桥刚抓到「我们正在等的那个商品」的链接 —— 面板可以立刻收工，
      // 不必等 DOM 扫描轮询走完（那最多要 2.4 秒，用户看到的就是面板一直亮着）。
      if (panelWait && panelWait.goodsId === d.goodsId && d.link) {
        var hit = safeBridgeLink(d.link);
        if (hit) panelWait.onHit(hit);
      }
      return;
    }
    if (d.source !== BRIDGE_SRC + '_RES') return;
    // 有回话就是到场 —— 可能压根没收到过 ready（document_start 注入的桥
    // 发 ready 时本脚本还没开始监听）。
    bridgeReady = true;
    var w = bridgeWait[d.rid];
    if (typeof w === 'function') w(d);
  }, false);

  // 正在等面板出链接时的状态：{ goodsId, onHit(link) }
  var panelWait = null;

  /** 问桥要链接；回调可能给空（桥没起来 / 页面里也没有），由上层走面板 */
  function askBridge(goodsId, name, cb) {
    if (bridgeDead) { cb({}); return; }

    var rid = ++bridgeSeq;
    var done = false;
    var timer = null;

    function finish(res) {
      if (done) return;
      done = true;
      if (timer) { clearTimeout(timer); timer = null; }
      delete bridgeWait[rid];
      if (!bridgeReady && ++bridgeMiss >= 2) bridgeDead = true;   // 别再让用户等
      cb(res || {});
    }

    bridgeWait[rid] = finish;

    function send() {
      try {
        window.postMessage({
          source: BRIDGE_SRC + '_REQ',
          rid: rid,
          goodsId: goodsId || '',
          name: name || '',
          wantDiag: true
        }, '*');
      } catch (e) { finish({}); return; }
      timer = setTimeout(function () { finish({}); }, BRIDGE_TIMEOUT);
    }

    ensureBridge();
    // 直接问，不等 ready。
    // 桥现在由 manifest 以 `world: MAIN` + `document_start` 直注，它发 ready 的
    // 时候本脚本（document_idle）还没监听 ——「没报到」不等于「不在场」。
    // 问一次就够：在场必定应答，不在场走到超时。
    send();
  }

  /**
   * L1 行内明文：这一行里若已出现 `/shop/a/` 链接（文本 / title / href /
   * data-*），直接取。范围限定在**当前这一行**，天然不会取到别的商品；
   * 多个不同候选时不猜。
   */
  function linkFromRowDom(tr) {
    var found = [];
    function add(v) {
      var m = String(v || '').match(SHOP_SHORT_RE);
      if (!m) return;
      if (found.indexOf(m[0]) < 0) found.push(m[0]);
    }
    add(textOf(tr));
    var els;
    try { els = tr.querySelectorAll('*'); } catch (e) { return ''; }
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      if (isExtNode(el)) continue;
      try {
        add(el.getAttribute('title'));
        add(el.getAttribute('href'));
        add(el.getAttribute('data-url'));
        add(el.getAttribute('data-link'));
        add(el.getAttribute('data-share-url'));
      } catch (e2) { /* 属性读不到就跳过 */ }
    }
    return found.length === 1 ? found[0] : '';
  }

  /**
   * 这条链接对应的货号，**只走零点击的两级**：缓存货号 → 商品名末尾。
   *
   * 两条都是「内存里的字符串」：`cacheGet` 是对象查表，商品名在 onCopyLink
   * 开头就已经读好传进来了 —— **这里不额外碰 DOM、不开弹层**（用户 2026-10-31
   * 问「会不会很吃性能，要读两边消息」：不会，正则跑几十字是微秒级，
   * 相较复制本身几百毫秒的量级可忽略）。
   *
   * 取不到就返回空，由调用方退回最朴素的「已复制商品链接」。
   */
  function codeForMessage(info) {
    var id = (info && info.goodsId) || '';
    var hit = '';
    try { hit = cacheGet(id); } catch (e0) { hit = ''; }
    if (hit) return hit;
    try { return headOf(guessFromName((info && info.name) || '')); } catch (e1) { return ''; }
  }

  /**
   * 拿到链接 → 写剪贴板 → 反馈。
   *
   * **严格三段式**（用户 2026-10-31 定，条与盒子同一套口径）：
   *
   *     来源(弱) ｜ 对象(强) ｜ 结果(弱)
   *     商品链接 ｜ NE1C1142W ｜ 已复制        ← 3 秒条
   *     商品链接 ｜ <商品全名> ｜ 已复制        ← 消息盒子
   *
   * 三条铁律，都是用户一句句纠出来的，别再合回去：
   *   1. **中段只能是「对象」**：条上放货号（短、唯一），盒子里放全名。
   *      中段里出现「已复制」「商品链接」这类词，就说明某个成分跑错段了
   *      ——「已复制」是结果，归右端弱位；「商品链接」是来源，归左端。
   *   2. **右端必须有尾声**：三段式的第三段是「结果」，不是装饰。只写两段
   *      会让人以为这条没有结果状态（2026-10-31 用户：「尾端是不是还有
   *      一个三段式的尾声没有写进来」）。
   *   3. **不预置「已复制」到文案里**：文案只写对象，结果交给 count 槽。
   *
   * 取不到货号 → 不猜商品名，条上回到最初那句 `已复制商品链接`
   * （用户 2026-10-31 定：3 秒条只认货号，取不到就说结果，别拿截断的名字凑）；
   * 盒子照旧给全名。商品 ID 两边都不写，进 `__dycDiag.note`。
   */
  function deliverLink(btn, link, via, info) {
    var name = (info && info.name) || '';
    var code = codeForMessage(info);
    // 中段＝对象：条上只认货号（短、唯一、好对账）
    var subject = code;
    // full 只在有名字时才传；空串会让 dialog 自动回落到条上文案
    var full = name || '';

    copyText(link, function (ok) {
      markVia(via, ok);
      if (ok) {
        flash(btn, '已复制', false, '复制链接');
        // 不交代走的哪条路，只说「复制了谁」+「结果」。
        // standalone：带 count 的消息会被判成「富状态」，不加这个开关，
        // 3 秒内连点两条不同商品会原地合并、盒子里只剩最后一条。
        if (subject) {
          say(subject, 'success',
            { source: '商品链接', count: '已复制', full: full, standalone: true });
        } else {
          say('已复制商品链接', 'success', { source: '商品链接', standalone: true });
        }
        // 走到面板这一档说明前三档都没命中；把桥的状态一起写进时间线，
        // 否则用户只看到「取自panel」，我们还得再要一份完整报告才能判断原因。
        bridgeNote('取自' + via + '：' + link
          + (via === 'panel' ? '；' + bridgeDiagText(lastBridgeDiag) : ''));
      } else {
        flash(btn, '复制失败', true, '复制链接');
        say('复制失败，请重试', 'warning', { source: '商品链接' });
        bridgeNote('已取到 ' + link + '，但剪贴板写入被拒');
      }
    });
  }

  function onCopyLink(tr, btn) {
    if (busy) return;
    busy = true;
    btn.disabled = true;
    btn.textContent = '获取中';
    var cancelled = false;
    var cancelFallback = null;
    activeLinkCancel = function () {
      cancelled = true;
      if (cancelFallback) cancelFallback();
      else release();
    };

    function release() {
      busy = false;
      btn.disabled = false;
      activeLinkCancel = null;
    }

    var goodsId = '';
    var name = '';
    try { goodsId = goodsIdOf(tr); } catch (e0) { goodsId = ''; }
    try { name = textOf(findNameEl(tr)); } catch (e1) { name = ''; }

    var info = { name: name, goodsId: goodsId };

    // ① 行内明文（零点击；万一平台哪天把链接铺进列表行）
    var domLink = '';
    try { domLink = linkFromRowDom(tr); } catch (e2) { domLink = ''; }
    if (domLink) { release(); deliverLink(btn, domLink, 'dom', info); return; }

    // ② 同 world 页面数据（自测 / 注入方式变化时仍有效；真机上永远为空）
    var same = '';
    try { same = linkFromRowData(tr); } catch (e3) { same = ''; }
    if (same) { release(); deliverLink(btn, same, 'data', info); return; }

    // ③ 主世界桥：接口取样映射优先，退页面 Vue 内存（都不点面板）
    askBridge(goodsId, name, function (res) {
      if (cancelled) return;
      if (!enabled() || !isGoodsListPage() || !tr.isConnected) { release(); return; }
      lastBridgeDiag = (res && res.diag) || null;
      lastBridgeAt = Date.now();
      var via = safeBridgeLink(res && res.link);
      if (via) {
        release();
        deliverLink(btn, via, res.via === 'net' ? 'net' : 'vue', info);
        return;
      }
      // ④ 兜底：模拟点开分享面板，读可见浮层里的明文链接
      cancelFallback = fallbackByPanel(tr, btn, release, info);
    });
  }

  /**
   * 最后一档：点「分享」→ 读可见浮层里的明文链接 → 派发 Escape 关面板。
   *
   * 为什么不是「点面板里的复制按钮再读剪贴板」：本扩展只有 clipboardRead、
   * 没有 clipboardWrite，平台写入 → 我读出 → 我再写入，链路上多两次剪贴板
   * 切换，还会把用户原有剪贴板洗掉。扒文本一次读到位，也无副作用。
   */
  // 点击前安装观察器；DOM 变更的微任务先于绘制，避免定时轮询漏出首帧。
  // 只处理浮层语义节点，不碰 body 子节点或整页应用壳；原本可见的浮层保持原样。
  function veilScan(veiled, existing) {
    var roots = collectRoots();
    for (var i = 0; i < roots.length; i++) {
      var nodes;
      try { nodes = roots[i].querySelectorAll(VEIL_SEL); } catch (e) { continue; }
      for (var j = 0; j < nodes.length; j++) {
        var el = nodes[j];
        if (isExtNode(el)) continue;
        if (el.getAttribute(VEIL_ATTR)) continue;
        if (existing.indexOf(el) >= 0 || !isShown(el)) continue;
        var prev = {};
        ['opacity', 'transition', 'animation', 'pointer-events'].forEach(function (key) {
          prev[key] = [el.style.getPropertyValue(key), el.style.getPropertyPriority(key)];
        });
        el.setAttribute(VEIL_ATTR, '1');
        veiled.push({ el: el, prev: prev });
        el.style.setProperty('transition', 'none', 'important');
        el.style.setProperty('animation', 'none', 'important');
        el.style.setProperty('opacity', '0', 'important');
        el.style.setProperty('pointer-events', 'none', 'important');
      }
    }
  }

  function fallbackByPanel(tr, btn, release, info) {
    var goodsId = (info && info.goodsId) || '';
    var shareEl = null;
    try {
      var walker = tr.ownerDocument.createTreeWalker(tr, NodeFilter.SHOW_ELEMENT, null);
      var el;
      while ((el = walker.nextNode())) {
        if (isExtNode(el)) continue;
        if (el.children.length > 0) continue;
        if (textOf(el) !== '分享') continue;
        shareEl = el;
        break;
      }
    } catch (e) { shareEl = null; }

    if (!shareEl) {
      release();
      flash(btn, '取不到', true, '复制链接');
      say('没取到链接，也没找到「分享」入口', 'warning', { source: '商品链接' });
      bridgeNote('行内无「分享」入口；' + bridgeDiagText(lastBridgeDiag));
      return;
    }

    var tries = 0;
    var timer = null;
    var waiting = true;

    var veiled = [];
    var veilObservers = [];
    var veilRoots = [];
    var existing = [];
    var closeTimer = null;
    var focusBefore = tr.ownerDocument.activeElement;
    var scrollBefore = collectRoots().filter(function (r) { return r.nodeType === 9; }).map(function (doc) {
      var el = doc.scrollingElement || doc.documentElement;
      return { el: el, top: el.scrollTop, left: el.scrollLeft };
    });

    function watchVeil() {
      var roots = collectRoots();
      for (var i = 0; i < roots.length; i++) {
        if (veilRoots.indexOf(roots[i]) >= 0) continue;
        var ob = new MutationObserver(watchVeil);
        ob.observe(roots[i], { childList: true, subtree: true, attributes: true,
          attributeFilter: ['class', 'style', 'hidden', 'open'] });
        veilRoots.push(roots[i]);
        veilObservers.push(ob);
      }
      veilScan(veiled, existing);
    }

    function unveil() {
      veilObservers.forEach(function (ob) { ob.disconnect(); });
      if (closeTimer) { clearInterval(closeTimer); closeTimer = null; }
      for (var i = 0; i < veiled.length; i++) {
        try {
          var item = veiled[i];
          Object.keys(item.prev).forEach(function (key) {
            var value = item.prev[key];
            if (value[0]) item.el.style.setProperty(key, value[0], value[1]);
            else item.el.style.removeProperty(key);
          });
          veiled[i].el.removeAttribute(VEIL_ATTR);
        } catch (e) { /* 节点已销毁 */ }
      }
      veiled = [];
    }

    var cancelled = false;
    function finish(result, cancel) {
      if (cancel) cancelled = true;
      if (!waiting) return;
      waiting = false;
      panelWait = null;
      if (timer) { clearInterval(timer); timer = null; }
      // Escape 只是发出关闭请求；退出动画期间仍保持隐藏，确认消失才恢复样式。
      var closeStart = Date.now();
      var retried = false;
      closeLayer();
      closeTimer = setInterval(function () {
        var open = veiled.some(function (item) { return item.el.isConnected && isShown(item.el); });
        if (open && !retried && Date.now() - closeStart >= 160) {
          retried = true;
          // 只点本次浮层中有明确关闭语义的按钮，不点遮罩和页面其他位置。
          try {
            for (var i = 0; i < veiled.length; i++) {
              var close = veiled[i].el.querySelector('[aria-label="关闭"],[aria-label="Close"],[aria-label="close"],.weui-desktop-dialog__close');
              if (close) { close.click(); break; }
            }
          } catch (e) { /* 平台关闭失败仍走有界收尾 */ }
          closeLayer();
        }
        var elapsed = Date.now() - closeStart;
        if (elapsed < 120 || (!veiled.length && elapsed < 2400) || (open && elapsed < 1200)) return;
        unveil();
        release();
        if (focusBefore && focusBefore.isConnected) {
          try { focusBefore.focus({ preventScroll: true }); } catch (e) { /* 不支持则不抢焦点 */ }
        }
        scrollBefore.forEach(function (s) { s.el.scrollTop = s.top; s.el.scrollLeft = s.left; });
        if (cancelled || !enabled() || !isGoodsListPage()) return;
        if (open) {
          flash(btn, '请手动关闭', true, '复制链接');
          say('分享面板未关闭，请手动关闭后重试', 'warning', { source: '商品链接' });
          bridgeNote('分享面板关闭超时，已恢复页面供手动关闭');
        } else if (!result) {
          flash(btn, '取不到', true, '复制链接');
          say('没取到商品链接，请点「分享」手动复制', 'warning', { source: '商品链接' });
          bridgeNote('面板 2.4 秒内没读到链接；' + bridgeDiagText(lastBridgeDiag));
        } else deliverLink(btn, result, 'panel', info);
      }, 25);
    }

    // 面板一打开，页面自己就会去请求商品分享素材接口。桥抓到那条响应后
    // 会直接推送过来 —— 收到就立刻关面板、立刻复制，不必等 DOM 扫描轮询。
    // 收到后开始关闭，隐藏处理一直保留到浮层退出完成。
    panelWait = {
      goodsId: goodsId || '',
      onHit: function (link) {
        if (!waiting) return;
        finish(link);
      }
    };

    try {
      collectRoots().forEach(function (root) {
        var nodes = root.querySelectorAll(VEIL_SEL);
        for (var i = 0; i < nodes.length; i++) {
          if (isShown(nodes[i])) existing.push(nodes[i]);
        }
      });
      if (existing.some(function (el) { return el.getAttribute('role') === 'dialog' && !isExtNode(el); })) {
        panelWait = null;
        release();
        flash(btn, '请先关闭弹窗', true, '复制链接');
        say('请先关闭已打开的弹窗再复制链接', 'warning', { source: '商品链接' });
        return;
      }
      watchVeil();
      shareEl.click();
      watchVeil();
    } catch (e) {
      panelWait = null;
      waiting = false;
      unveil();
      release();
      flash(btn, '打不开', true, '复制链接');
      say('打不开分享面板', 'warning', { source: '商品链接' });
      return;
    }

    // 24 轮 × 100ms = 2.4 秒。第一版只等 1.2 秒，首次打开面板组件还没渲染完
    // 就超时了（用户反馈「第一次必定失败」就是它）。桥命中时根本不进这里。
    timer = setInterval(function () {
      tries++;
      if (!enabled() || !isGoodsListPage() || !tr.isConnected) { finish('', true); return; }
      var link = scanLinkOnce(veiled);
      if (link || tries >= 24) {
        finish(link);
      }
    }, 100);
    return function () { finish('', true); };
  }

  /* ---------- 插入 ---------- */

  /**
   * 给按钮绑点击：**捕获 + 冒泡各绑一份**，用 fired 去重。
   *
   * 为什么绑两份：平台可能在**捕获阶段**截断事件（本项目 2026-10-25 在
   * 渠道品按钮上踩过同类）。绑在按钮自身上时，捕获监听先于页面上的
   * 冒泡委托执行；即便冒泡被吞，捕获那份仍能跑到。两份只执行一次。
   */
  function bindClick(btn, work) {
    var fired = false;
    function run(e) {
      if (fired) return;
      fired = true;
      setTimeout(function () { fired = false; }, 400);
      try { e.preventDefault(); e.stopPropagation(); } catch (err) { /* 事件对象异常，照常执行 */ }
      work();
    }
    btn.addEventListener('click', run, true);
    btn.addEventListener('click', run, false);
  }

  function injectRow(tr) {
    var metaRow = findMetaRow(tr);
    if (!metaRow) return false;
    if (metaRow.querySelector('[' + WRAP_ATTR + ']')) return true;   // 幂等

    var wrap = document.createElement('span');
    wrap.setAttribute(WRAP_ATTR, '1');
    wrap.style.setProperty('display', 'inline-flex');
    wrap.style.setProperty('gap', '6px');
    wrap.style.setProperty('margin-left', '10px');
    wrap.style.setProperty('vertical-align', 'middle');
    wrap.style.setProperty('white-space', 'nowrap');
    wrap.style.setProperty('flex', '0 0 auto');

    var btnCode = makeBtn('货号', 44);
    btnCode.title = '复制货号（SKU 编码第一段）';
    // 悬停时把这一行的货号显示在提示里 —— 不用点也能看清是多少
    btnCode.addEventListener('mouseenter', function () {
      if (btnCode.__dycPrev) return;
      btnCode.__dycPrev = true;
      var id = goodsIdOf(tr);
      var head = cacheGet(id) || headOf(guessFromName(findNameEl(tr)));
      btnCode.title = head
        ? ('货号 ' + head + ' · 点一下复制')
        : '点一下复制货号';
    });
    bindClick(btnCode, function () { onCopyCode(tr, btnCode); });

    var btnLink = makeBtn('复制链接', 62);
    btnLink.title = '一键复制商品链接（优先直接读取，必要时在隐藏的分享面板中获取）';
    bindClick(btnLink, function () { onCopyLink(tr, btnLink); });

    wrap.appendChild(btnCode);
    wrap.appendChild(btnLink);

    // 那一行原本是 nowrap 的单行信息(288px 已被占满)。放不下时让按钮换行,
    // **绝不溢出**压到右侧价格列。放得下时 wrap 不改变任何表现。
    var pcs = csOf(metaRow);
    if (pcs && (pcs.display === 'flex' || pcs.display === 'inline-flex')) {
      if (!metaRow.getAttribute('data-dyc-wx-metawrap')) {
        metaRow.setAttribute('data-dyc-wx-metawrap', metaRow.style.flexWrap || '');
        metaRow.style.flexWrap = 'wrap';
      }
    } else {
      // 非 flex 行:让 wrapper 独占一行,避免挤在「分享」右边被截断
      wrap.style.setProperty('display', 'flex');
      wrap.style.setProperty('margin-top', '4px');
    }

    metaRow.appendChild(wrap);
    return true;
  }

  function restoreAll() {
    var roots = collectRoots();
    for (var i = 0; i < roots.length; i++) {
      var wraps;
      try { wraps = roots[i].querySelectorAll('[' + WRAP_ATTR + ']'); } catch (e) { continue; }
      for (var j = 0; j < wraps.length; j++) {
        var w = wraps[j];
        var parent = w.parentElement;
        if (parent && parent.getAttribute('data-dyc-wx-metawrap') !== null) {
          parent.style.flexWrap = parent.getAttribute('data-dyc-wx-metawrap') || '';
          parent.removeAttribute('data-dyc-wx-metawrap');
        }
        if (w.parentNode) w.parentNode.removeChild(w);
      }
    }
  }

  /* ---------- 主循环 ---------- */

  function applyAll() {
    if (!enabled() || !isGoodsListPage()) return;
    if (!tbody || !tbody.isConnected) {
      var found = locateTable();
      if (!found) return;
      tbody = found;
      watchRoot(tbody);
    }
    var rows;
    try { rows = tbody.querySelectorAll('tr'); } catch (e) { return; }
    for (var i = 0; i < rows.length; i++) {
      try { injectRow(rows[i]); } catch (e2) { /* 单行失败不影响其他行 */ }
    }
  }

  function watchRoot(root) {
    if (!root || !root.nodeType) return;
    for (var i = 0; i < observedRoots.length; i++) {
      if (observedRoots[i] === root) return;
    }
    try {
      var ob = new MutationObserver(scheduleApply);
      ob.observe(root, { childList: true, subtree: true });
      observers.push(ob);
      observedRoots.push(root);
    } catch (e) { /* 根不稳定,轮询会再来 */ }
  }

  function dropObservers() {
    for (var i = 0; i < observers.length; i++) {
      try { observers[i].disconnect(); } catch (e) { /* 已断开 */ }
    }
    observers = [];
    observedRoots = [];
  }

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

  function start() {
    lastHref = location.href;
    // 一进列表页就把接口取样 hook 装进页面：必须早于商品列表接口返回，
    // 否则第一次点「复制链接」只能走面板。装不上也不影响后续流程。
    ensureBridge();
    watchRoot(document.body);
    applyAll();
  }

  function stop() {
    if (activeLinkCancel) activeLinkCancel();
    else busy = false;
    dropObservers();
    if (tailTimer !== null) { clearTimeout(tailTimer); tailTimer = null; }
    pending = false;
    tbody = null;
    restoreAll();
  }

  // 窗口尺寸变化可能让行重建,补一次
  window.addEventListener('resize', scheduleApply);

  // 2 秒兜底:SPA 路由变化、微前端重建、tbody 被换掉
  setInterval(function () {
    if (!enabled()) return;
    var href = '';
    try { href = location.href; } catch (e) { return; }
    if (href !== lastHref) {
      if (activeLinkCancel) activeLinkCancel();
      lastHref = href;
      tbody = null;
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
        toast(now ? '已开启' : '已关闭', 'info', { source: '行内复制' });
      }
      prevOn = now;
      if (now) start();
      else stop();
    });
  }

  [1500, 4000, 8000].forEach(function (ms) {
    setTimeout(function () {
      if (enabled()) applyAll();
    }, ms);
  });
})();
