/**
 * 小红书中控台 · 复制货号按钮
 * UI 与交互 = 照搬巨量百应中控台（src/live/copy-code.js），取值来源 = 小红书卡片
 * ============================================================
 * 【需求（2026-11-17 用户定）】
 *   第一版只做到「能用」：自绘一枚灰白小按钮（45×28、灰边黑字、
 *   「已复制 ✓ / 未取到」），与百应那枚放在一起就不像同一套东西。
 *   用户本轮口径：「照搬巨量百应中控台的 UI 设计」⇒ 视觉、三态文案、
 *   悬停说明、点击后的消息提示一律按百应口径；只有**高度**按小红书行内
 *   按钮对齐（用户定稿：宽 56px 固定、高 28px 与「下架」齐平）。
 *   落点第二轮（同日 21:5x）：用户截图圈出商品信息块，要求「放在这个区域、
 *   商品名称右下角」—— 从卡片底部操作区挪进名称块内部右下角（见 mount()）。
 *   ID 小按钮第三轮（同日 22:2x）：用户要求「放在那一串英文字符的最右边、
 *   尽量做小、点它就复制到这串」⇒ 28×16、紧贴 ID 串右侧（见 mountId()）。
 *   第四轮（同日 22:3x）：截图核实**ID 独立成一行**（标题块里那行 29 字的
 *   --color-text-description），下面那行 `· · · · ✎` 才是推荐语 ——
 *   按钮改为直接挂进 ID 那一行内部、紧跟 ID 串（见 idRowOf()）。
 *   第五轮（同日 22:4x）：用户定稿「还是把 ID 按钮放在货号按钮的左边」
 *   ⇒ 以货号按钮为锚，ID 插在它前面，两枚成组；ID 行内部降为兜底。
 *   第六轮（同日 22:4x）：用户「两枚黏在一起占住右下角，大小统一调一次，
 *   货号太大、ID 太小」⇒ 同高 22px（货号 48 宽、ID 32 宽），字体同一口径。
 *   第七轮（同日 22:5x）：真机上两枚仍被拆在两处 —— 平台重渲染把货号挂到了新容器、
 *   ID 留在原处，而幂等只查「有没有」不查「在不在一起」⇒ 永久分家。
 *   现在每轮补扫都校验 isTogether()，不紧邻就把 ID 挪回货号左侧。
 *   第八轮（同日 23:0x）：DOM 紧邻但视觉分家 —— 货号自带 margin-left:auto 被推到行尾，
 *   ID 留在原处，中间空出 68px（报告实测）。auto 改由 ID 承担，货号紧跟其后。
 *   取值同时改成**多源**（文本 → 链接 → 属性），因为官方没有一键复制、
 *   字段是纯文本且可能混零宽字符，只读一种来源必然漏（见 readId()）。
 *
 * 【照搬了百应的哪些设计（逐项对应）】
 *   ① 视觉：白底 + #0075ff 蓝边蓝字、圆角 4px、常态 55% 透明、
 *      悬停整块反色填充；失败态灰化（#86909c）。宽度固定 56px —— 闪烁换文案
 *      时按钮不变宽，相邻元素不被推挤。
 *      ★ 字号 / 字重 / 字体族**跟随平台「下架」按钮**（2026-11-17 第三轮用户定：
 *      「不要太突兀，搬过来的功能就要入乡随俗」）：运行时读同卡平台按钮的
 *      计算样式套用，不写死；读不到才退回 12px 兜底。
 *   ② 三态文案：`货号 → 已复制 / 无货号 / 复制失败`，1.5s 后复位。
 *   ③ 悬停说明（title）三态：初始讲规则、取到标来源（商品 ID / 名称推算）、
 *      取不到讲清为什么 —— 用户不该等到出错才靠猜理解规则。
 *   ④ 点击后弹一条三段式消息（来源「货号复制」｜值｜已复制），
 *      keepHistory:false —— 复制是高频操作，全收进盒子会把历史刷满。
 *   ⑤ 开关关掉即时摘按钮并移除样式表（百应 stop() 同款）；打开时补扫。
 *   ⑥ 诊断轨迹：注入数 / 商品卡数（数字变化才记）+ 每次点击的取值现场。
 *
 * 【与百应的差异（页面事实决定的，不是省略）】
 *   · 取值来源换掉：百应是「平台货号 → 名称末尾」；小红书卡片没有货号字段，
 *     唯一与 ID 相关的位置是 __subtitle-row 里的商品 ID 链接（2026-11-17 结构报告），
 *     所以第一档换成这枚链接，第二档仍是名称末尾推算，两档都空就报「无货号」。
 *   · 形态判据不自带：一律调 src/content/item-code.js 的 dycIsCodeLike /
 *     dycPickCodeFromName（唯一真源，四个页面共用）。manifest 里小红书这一条
 *     必须在本文件之前加载 item-code.js，否则按钮会「全部取不到」——
 *     这不是兜底能救的错误，只能靠加载顺序保证（check-manifest-order.py 有闸门）。
 *   · 落点：百应贴平台「复制 ID」按钮右侧；小红书卡片没有那枚按钮，
 *     按 2026-11-17 第二轮用户定稿，放**商品名称块右下角**
 *     （.goods-card__title-block 内，与「添加推荐语」同行右端；搭不上车就另起
 *     一行靠右，再把不到名称块才退回卡片底部操作区）。
 *
 * 【React 竞态】按钮是真实节点，平台重渲染会删掉重建 ⇒ MutationObserver
 *   防抖补扫；幂等判据用「卡内是否已有本按钮」，不用卡片属性标记 ——
 *   平台只清空卡片内容、保留卡片节点时，属性标记会把这一卡永久卡住。
 *
 * 【开关】xhsCopyCode（小红书专用行）。★ dycReadFlags() 返回 Promise，必须 .then。
 * ============================================================
 */
(function () {
  'use strict';

  // 防重复注入（SPA 路由回切 / 脚本意外重跑时不叠按钮）
  if (window.__dycXhsCopyCodeLoaded) return;
  window.__dycXhsCopyCodeLoaded = true;

  var BTN_CLASS = 'dyc-xhs-copycode';
  var ID_BTN_CLASS = 'dyc-xhs-copyid';
  var STYLE_ID = 'dyc-xhs-copycode-style';
  var ROW_SEL = '.goods-card';
  var TITLE_SEL = '.goods-card__title-block';
  var SUBTITLE_SEL = '.goods-card__subtitle-row';
  var ACTION_SEL = '.goods-card__action-row';
  var APPLY_DEBOUNCE = 300;
  var REVERT_MS = 1500;

  /* ---------- 样式：JS 注入 + 类命中（不写在 React 管的属性上） ---------- */

  var CSS = [
    '.' + BTN_CLASS + ' {',
    '  all: initial;',
    // 行内块：与平台「下架」并排，不抢行
    '  display: inline-flex; align-items: center; justify-content: center;',
    // 宽度固定 48px：闪文案时不变宽（2026-11-17 用户定：原来 56 太大，缩到与 ID 同高 22）
    '  width: 48px; height: 22px; padding: 0;',
    // all:initial 把 flex-shrink 重置成 1，空间不足时会被挤扁 ⇒ 锁死
    '  flex: 0 0 auto;',
    '  margin: 0 4px 0 0;',
    '  border: 1px solid #0075ff; border-radius: 4px;',
    '  background: #fff; color: #0075ff;',
    // 12px 只是兜底：正常情况由 applyFont() 读平台「下架」按钮的字号/字重/字体族覆盖
    "  font: 12px/1 -apple-system, 'Microsoft YaHei', sans-serif;",
    '  white-space: nowrap; vertical-align: middle; cursor: pointer;',
    '  box-sizing: border-box;',
    '  opacity: .55;',
    '  transition: opacity .15s, background .15s, color .15s;',
    '}',
    '.' + BTN_CLASS + ':hover { opacity: 1; background: #0075ff; color: #fff; }',
    '.' + BTN_CLASS + '.is-err { border-color: #86909c; color: #86909c; background: #fff; }',
    '.' + BTN_CLASS + '.is-err:hover { background: #86909c; color: #fff; }',
    // 与「添加推荐语」那一行同排时推到最右 —— 名称块右下角，不改变卡片高度
    '.' + BTN_CLASS + '.is-inline { margin-left: auto; margin-right: 0; }',
    // 兜底自建行：块内没有可搭车的行时，独占一行靠右
    '.dyc-xhs-code-row { display: flex; justify-content: flex-end; align-items: center;',
    '  width: 100%; margin: 4px 0 0; }',
    // ── 商品 ID 小按钮「ID」（2026-11-17 用户定：名字就叫 ID） ──
    // 尺寸与「货号」统一：同高 22、同圆角 4、字号同样跟随平台按钮（原来是 28×16/10px，
    // 与货号并排时一大一小很割裂 —— 用户 22:4x 定：「统一做一次大小调整」）。
    '.' + ID_BTN_CLASS + ' {',
    '  all: initial;',
    '  display: inline-flex; align-items: center; justify-content: center;',
    '  width: 32px; height: 22px; padding: 0;',
    '  flex: 0 0 auto;',
    '  margin: 0 0 0 4px;',
    '  border: 1px solid #0075ff; border-radius: 4px;',
    '  background: #fff; color: #0075ff;',
    // 12px 仅兜底：applyFont() 会读平台「下架」按钮的字号/字重/字体族覆盖（与货号同口径）
    "  font: 12px/1 -apple-system, 'Microsoft YaHei', sans-serif;",
    // 与货号 / ID 那串字同排时按中线对齐
    '  vertical-align: middle;',
    '  white-space: nowrap; cursor: pointer; box-sizing: border-box;',
    '  opacity: .55;',
    '  transition: opacity .15s, background .15s, color .15s;',
    '}',
    '.' + ID_BTN_CLASS + ':hover { opacity: 1; background: #0075ff; color: #fff; }',
    '.' + ID_BTN_CLASS + '.is-ok { background: #0075ff; color: #fff; opacity: 1; }',
    '.' + ID_BTN_CLASS + '.is-err { border-color: #86909c; color: #86909c; background: #fff; }',
    '.' + ID_BTN_CLASS + '.is-err:hover { background: #86909c; color: #fff; }',
    // 紧贴 ID 那串字的右端（ID 行内兜底时用）
    '.' + ID_BTN_CLASS + '.is-near { margin-left: 4px; margin-right: 0; }',
    // 排在「货号」按钮左边：接管「推到行右端」的差事。
    //
    // 【为什么 auto 要放在 ID 身上（2026-11-17 真机数据）】
    //   货号按钮原本带 margin-left:auto 负责贴右；ID 插到它前面之后，
    //   auto 仍然只作用于货号自身 ⇒ 货号被推到行尾、ID 留在原处，
    //   中间空出 68px（报告实测：ID x=731 宽 32，货号 x=831，中间 68px 空隙）。
    //   现在让 ID 承担 auto（把整组推到右端），货号紧跟在它后面。
    '.' + ID_BTN_CLASS + '.is-before { margin: 0 4px 0 auto; }',
    // 紧跟在 ID 后面的货号去掉自己的 auto，否则又会把两枚拉开
    '.' + ID_BTN_CLASS + '.is-before + .' + BTN_CLASS + ' { margin-left: 0; }',
    // 没有 ID 链接时：flex 行推到行尾；非 flex 行用右浮动，都不占新行
    '.' + ID_BTN_CLASS + '.is-inline { margin-left: auto; }',
    '.' + ID_BTN_CLASS + '.is-float { float: right; margin-top: 1px; }'
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
    if (st && st.parentNode) st.parentNode.removeChild(st);
  }

  /* ---------- 字体入乡随俗（2026-11-17 用户定） ----------
   *
   * 【为什么读平台按钮，而不是写死一个字号】
   *   用户口径：「字体大小和样式跟官方【下架】按钮一样；原因就是不要太突兀，
   *   搬过来的功能就要入乡随俗」。写死 12px 只是当时的猜测 —— 平台换字号/字重、
   *   或不同账号命中不同主题时，我们的按钮立刻显眼。
   *   直接读同卡平台按钮的计算字体（字号 / 字重 / 字体族），天然与它一致；
   *   读不到（平台没渲染操作按钮）时退回样式表里的 12px 兜底。
   *
   * 【为什么缓存】19 张卡逐个 getComputedStyle 属于「循环内读布局」，
   *   性能闸门会提示；同一页所有操作按钮字体一致，读一次就够。
   *   页面切换（SPA 路由）时清空 —— 换主题后字体可能变。
   */
  var fontCache = null;

  function platformFont() {
    if (fontCache) return fontCache;
    var el = document.querySelector(ACTION_SEL + ' .goods-card__action-btn')
          || document.querySelector(ACTION_SEL + ' button');
    if (!el) return null;
    try {
      var cs = window.getComputedStyle(el);
      if (!cs) return null;
      fontCache = {
        size: cs.fontSize || '',
        weight: cs.fontWeight || '',
        family: cs.fontFamily || ''
      };
    } catch (e) { return null; }
    return fontCache;
  }

  /** 把平台按钮的字体参数套到我们的按钮上（内联优先级高于 all:initial） */
  function applyFont(btn) {
    var f = platformFont();
    if (!f) return;
    if (f.size) btn.style.fontSize = f.size;
    if (f.weight) btn.style.fontWeight = f.weight;
    if (f.family) btn.style.fontFamily = f.family;
  }

  /* ---------- 页面判定 / 取值 ---------- */

  function onCtrlPage() {
    try {
      var pat = window.DYC_PAGE_PATTERNS;
      return !!(pat && pat.xhsCtrl && pat.xhsCtrl.test(location.href));
    } catch (e) { return false; }
  }

  /**
   * 文本归一：折叠空白 + **剥掉不可见字符**。
   *
   * 【为什么要剥零宽字符（2026-11-17 真机事故）】
   *   官方没有一键复制商品 ID，这类"只显示不给抄"的字段常被塞进零宽字符
   *   （U+200B 等）防抓取：眼睛看着是 `商品ID：6afc3b8d…`，正则却匹配不上
   *   —— 表现为按钮永远「无ID」。所以取文本一律经这一道，再交给判据。
   */
  function clean(s) {
    return String(s || '')
      .replace(/[\u200B-\u200F\u202A-\u202E\u2060-\u2064\uFEFF]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /** 卡片上的商品 ID 链接（结构报告：__subtitle-row > a.d-text） */
  function idLinkText(card) {
    var a = card.querySelector('.goods-card__subtitle-row a');
    return a ? clean(a.textContent) : '';
  }

  /** 商品名元素（--color-text-title 只命中名称，描述是 --color-text-description） */
  function nameOf(card) {
    var el = card.querySelector('.goods-card__title-block span.--color-text-title')
          || card.querySelector('.goods-card__title-block span');
    return el ? clean(el.textContent) : '';
  }

  /**
   * 取货号 → { code, from: 'id' | 'guess' | 'none' }
   * 形态判据**不在本文件**：item-code.js 是唯一真源，改一次四页生效。
   * 函数缺失（加载顺序写错）时不猜、不复制，只报取不到 —— 由诊断兜底排查。
   */
  function readCode(card) {
    var t = idLinkText(card);
    if (t && typeof dycIsCodeLike === 'function' && dycIsCodeLike(t)) {
      return { code: t, from: 'id' };
    }
    var name = nameOf(card);
    var g = (name && typeof dycPickCodeFromName === 'function')
      ? dycPickCodeFromName(name)
      : '';
    return g ? { code: g, from: 'guess' } : { code: '', from: 'none' };
  }

  /* ---------- 商品 ID（第二枚小按钮专用） ---------- */

  /**
   * 取元素的「纯页面文本」：整棵跳过我们自己注入的节点。
   *
   * 【为什么必须跳（2026-10-18 反馈 #96 的同一条病）】
   *   ID 小按钮就插在 subtitle-row 里面，它的文案是「ID」「✓」「!」——
   *   直接读 textContent 会把自己的字读进来，正则就会从按钮旁边刮数字。
   *   所以判据只用**结构标记**（data-dyc-*），不靠文案。
   */
  function pageText(root) {
    if (!root) return '';
    var parts = [];
    try {
      var walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
        acceptNode: function (n) {
          if (n.nodeType === 1) {
            if (n.getAttribute && (n.getAttribute('data-dyc-xhs-copyid') !== null
                || n.getAttribute('data-dyc-xhs-copycode') !== null)) {
              return NodeFilter.FILTER_REJECT;
            }
            return NodeFilter.FILTER_SKIP;
          }
          return NodeFilter.FILTER_ACCEPT;
        }
      });
      var n;
      while ((n = walker.nextNode())) parts.push(n.nodeValue || '');
    } catch (e) {
      return '';
    }
    return clean(parts.join(' '));
  }

  /**
   * 从卡片上取商品 ID → { id, from: 'text'|'href'|'data'|'title'|'none' }
   *
   * 【为什么不再只读文本（2026-11-17 真机事故）】
   *   第一版只认「商品ID：xxx」这段文本。真机上这一行读出来是
   *   「············」（12 个占位点，诊断实测）——平台在部分状态下把 ID
   *   显示成掩码，文本里根本没有 ID，两档正则都落空 ⇒ 点按钮永远「无ID」。
   *   所以改成**多源**：文本能用就用文本（最准，所见即所复制），
   *   文本是掩码才退到链接 href、data-* 属性、title —— ID 总能在其中一处找到。
   *   每档都必须过共享判据 dycIsCodeLike，不合格一律跳过，绝不复制半截内容。
   */
  function readId(card) {
    var row = card.querySelector(SUBTITLE_SEL);
    var a = row ? row.querySelector('a') : null;

    // ① 明确标签：整卡任意位置出现「商品ID：xxx」——推荐语把 ID 行挤掉时，
    //    这段文字可能被挪到别处，所以在整卡范围找，不只盯 subtitle-row。
    var m = pageText(card).match(/商品\s*ID\s*[:：]\s*([A-Za-z0-9][A-Za-z0-9_-]{5,40})/i);
    if (m && likeId(m[1])) return { id: m[1], from: 'label' };

    // ② ID 行整行就是那串（无冒号前缀时才敢用，避免把名称末尾款号当 ID）
    var t = pageText(row);
    if (t && !/[:：]/.test(t)) {
      var m2 = t.match(/^([A-Za-z0-9][A-Za-z0-9_-]{5,40})$/);
      if (m2 && likeId(m2[1])) return { id: m2[1], from: 'text' };
    }

    // ③ 商品链接（只认带 goods 语义的 href，见 pickFromUrl）
    var v = pickFromUrl(a && a.getAttribute('href')) || pickFromCardLinks(card);
    if (v) return { id: v, from: 'href' };

    // ④ data-* / title
    v = pickFromData(a) || pickFromData(row) || pickFromData(card);
    if (v) return { id: v, from: 'data' };
    v = clean(a && a.getAttribute('title'));
    if (likeId(v)) return { id: v, from: 'title' };

    // ⑤ 纯文本兜底：这一行里任意 16~32 位十六进制。
    //    官方这串 ID 是**纯文本**（没有链接、没有属性），`商品ID：` 前缀也可能
    //    被零宽字符/全角符号隔开 ⇒ 前几档可能全落空，最后按 ID 的形态直接抓。
    //    限定 16 位以上：商品名、货号、价格都到不了这个长度，误抓风险极低。
    var m3 = (t || '').match(/([0-9a-f]{16,32})/i);
    if (m3 && likeId(m3[1])) return { id: m3[1], from: 'hex' };

    return { id: '', from: 'none' };
  }

  function likeId(s) {
    return !!s && typeof dycIsCodeLike === 'function' && dycIsCodeLike(s);
  }

  /**
   * 从链接取 ID。
   * 【只认带 goods 语义的链接】卡片里还有商品图链接，其 URL 里的长 hex 是
   * 图片 ID、不是商品 ID —— 不设这道门就会把图片 ID 复制给用户（比取不到更糟）。
   */
  function pickFromUrl(href) {
    if (!href) return '';
    var s = String(href);
    if (!/goods/i.test(s)) return '';
    var m = s.match(/[?&](?:id|goods_?id|item_?id|target_?id)=([A-Za-z0-9_-]{6,40})/i)
         || s.match(/\/([0-9a-f]{16,32})(?:[\/?#]|$)/i);
    if (!m) return '';
    return likeId(m[1]) ? m[1] : '';
  }

  /** 卡内其它链接兜底（推荐语把 ID 行换掉时，图片/标题链接往往还带着 ID） */
  function pickFromCardLinks(card) {
    var as;
    try { as = card.querySelectorAll('a[href]'); } catch (e) { return ''; }
    var limit = Math.min(as.length, 12);
    for (var i = 0; i < limit; i++) {
      var v = pickFromUrl(as[i].getAttribute('href'));
      if (v) return v;
    }
    return '';
  }

  /** 从元素上取 ID：只认几个常见主键属性，值必须像 ID */
  function pickFromData(el) {
    if (!el || !el.getAttribute) return '';
    var keys = ['data-id', 'data-goods-id', 'data-goods_id', 'data-item-id', 'data-item_id'];
    for (var i = 0; i < keys.length; i++) {
      var v = clean(el.getAttribute(keys[i]));
      if (likeId(v)) return v;
    }
    return '';
  }

  /* ---------- 复制（三级兜底，与百应/弹窗同口径） ---------- */

  function legacyCopy(text) {
    try {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0';
      document.body.appendChild(ta);
      ta.select();
      var ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return !!ok;
    } catch (e) { return false; }
  }

  function copyText(text, cb) {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(function () { cb(true); }, function () {
          cb(legacyCopy(text));
        });
        return;
      }
    } catch (e) { /* 落到下一级 */ }
    cb(legacyCopy(text));
  }

  /** 三段式消息；消息条不在也不影响复制本身 */
  function say(message, type, opts) {
    try {
      if (typeof toast === 'function') {
        toast(message, type, Object.assign({ keepHistory: false }, opts || {}));
      }
    } catch (e) { /* 尽力而为 */ }
  }

  /* ---------- 诊断（与百应 copy-code 同一套记录点） ---------- */

  var lastInjectStat = '';

  function noteDiag(action, detail, result) {
    try {
      var d = window.__dycDiag;
      if (!d || typeof d.note !== 'function') return;
      d.note(action, detail, result);
    } catch (e) { /* 诊断失败不许影响复制 */ }
  }

  function noteInjectStat(done, rows, modes, idCount, fixCount) {
    // 落点三档各挂了多少个 —— 真机上「卡片有没有被撑高」就靠这一条判断：
    // 全是「同行」说明平台那行是 flex、卡片高度不变；出现「另起行」
    // 说明该卡多了约 30px。诊断不写这个，就只能靠肉眼比对卡片高度。
    // 「归位 > 0」说明这一轮抓到过两枚按钮被平台拆开，正好用来确认这条修复在起作用。
    var detail = '本轮注入 货号 ' + done + ' 个 · ID ' + (idCount || 0) + ' 个'
      + (fixCount ? ' · 归位 ' + fixCount + ' 个' : '')
      + ' / 商品卡 ' + rows + ' 个'
      + '（同行 ' + (modes.inline || 0)
      + ' · 另起行 ' + (modes.row || 0)
      + ' · 兜底 ' + (modes.action || 0) + '）';
    if (detail === lastInjectStat) return;
    lastInjectStat = detail;
    noteDiag('货号按钮', detail, done + '/' + rows);
  }

  function noteIdDiag(card, r) {
    var t = pageText(card.querySelector(SUBTITLE_SEL));
    // 记「行长」是为了区分两种完全不同的故障：
    //   行长 29 却取不到 ⇒ 文本里有别的东西挡住（该查正则/字符）；
    //   行长 12 ⇒ 那一行本身就不是 ID（例如被推荐语换成「添加推荐语」）。
    noteDiag('商品ID取值',
      '档=' + (r.from || 'none') + '｜行长=' + t.length + '｜行文本[' + t.slice(0, 40) + ']',
      r.id || '无ID');
  }

  function noteCodeDiag(card, r) {
    var tail = nameOf(card).slice(-24);
    var link = idLinkText(card).slice(0, 40);
    noteDiag('货号取值',
      'ID链接[' + link + ']｜名称尾[' + tail + ']｜档=' + (r.from || 'none'),
      r.code || '无货号');
  }

  /* ---------- 按钮 ---------- */

  function flash(btn, text, isErr) {
    btn.textContent = text;
    btn.classList.toggle('is-err', !!isErr);
    clearTimeout(btn.__dycTimer);
    btn.__dycTimer = setTimeout(function () {
      btn.textContent = '货号';
      btn.classList.remove('is-err');
    }, REVERT_MS);
  }

  function makeBtn(card) {
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = BTN_CLASS;
    btn.textContent = '货号';
    btn.setAttribute('data-dyc-xhs-copycode', '1');
    btn.setAttribute('aria-label', '复制货号');
    // 字号 / 字重 / 字体族跟随平台「下架」按钮（读不到时才用样式表的 12px 兜底）
    applyFont(btn);
    btn.title = '点击复制货号 · 优先取卡片上的商品 ID；没有时取商品名末尾的款号';

    btn.addEventListener('click', function (ev) {
      ev.preventDefault();
      ev.stopPropagation();          // 不触发平台卡片跳转 / 勾选

      var r = readCode(card);
      noteCodeDiag(card, r);
      if (!r.code) {
        // 取不到时把规则和原因一并说清 —— 用户最可能在这一刻想弄明白为什么
        btn.title = '这一行没找到货号 —— 卡片没显示商品 ID，商品名末尾也不是款号'
                  + '（本按钮只认名称末尾的款号）';
        flash(btn, '无货号', true);
        say('这一行没找到货号', 'warning', { source: '货号复制' });
        return;
      }
      // 取到时标明来源 —— 「推算」与「商品 ID」的可信度不同，用户有权知道
      btn.title = '货号：' + r.code +
                  (r.from === 'guess' ? '（按商品名末尾推算，不是平台货号）' : '（卡片商品 ID）');
      copyText(r.code, function (ok) {
        flash(btn, ok ? '已复制' : '复制失败', !ok);
        if (!ok) {
          say('复制失败，请重试', 'warning', { source: '货号复制' });
          return;
        }
        // 三段式：`货号复制 ｜ 748392 ｜ 已复制`
        // standalone:带 count 会被判成「富状态」,不加会与上一条原地合并。
        say(r.code, 'success', { source: '货号复制', count: '已复制', standalone: true });
      });
    });
    return btn;
  }

  /* ---------- 注入 ---------- */

  var flags = {};
  var flagsReady = false;
  var timer = null;
  var mo = null;
  var started = false;

  /* ---------- 落点：商品名称块右下角（2026-11-17 用户第二轮定） ---------- */

  /** 这个元素是横向 flex 行吗（能用 margin-left:auto 把按钮推到右端） */
  function isFlexRow(el) {
    try {
      var cs = window.getComputedStyle(el);
      var d = cs && cs.display;
      return d === 'flex' || d === 'inline-flex';
    } catch (e) { return false; }
  }

  /** 名称块内最后一个「可搭车」的子元素（跳过我们自己插过的节点） */
  function lastBlockChild(block, btn) {
    var kids = block.children;
    for (var i = kids.length - 1; i >= 0; i--) {
      var el = kids[i];
      if (el === btn) continue;
      if (el.getAttribute('data-dyc-xhs-code-row') === '1') continue;
      if (el.getAttribute('data-dyc-xhs-copycode') !== null) continue;
      return el;
    }
    return null;
  }

  /**
   * 把按钮挂到卡片的「商品名称块」右下角。
   *
   * 【为什么分两档（用户 2026-11-17 定：放在商品名称右下角）】
   *   名称块（结构报告：.goods-card__title-block 228×138）里已经排满
   *   名称 / 描述 / 标签 / 商品 ID / 定向计划 / 添加推荐语，高度刚好 138。
   *   ① 最后一行若是横向 flex（「添加推荐语」这类行内动作行）⇒ 直接塞进去，
   *      margin-left:auto 推到右端，与那行同高 —— **卡片高度不变**，最理想；
   *   ② 没有这样的行 ⇒ 在块末尾插一个自建 flex 行，按钮独占一行靠右。
   *      代价：名称块高约 30px、卡片随之变高。这是位置优先的取舍，
   *      不接受增高时改用 ① 需要平台那一行是 flex（只有真机能确认）。
   *   ③ 连名称块都没有（平台改结构）⇒ 退回卡片底部操作区首位，按钮不消失。
   *
   * 【为什么不用绝对定位】search.js 有三轮教训：绝对定位的包含块会被平台的
   *   transform 祖先劫走，位置随机漂移；给平台元素补 position:relative 又可能
   *   改变它内部既有浮层的包含块。文档流内插入没有这个面。
   */
  function mount(card, btn) {
    var block = card.querySelector(TITLE_SEL);
    if (block) {
      var last = lastBlockChild(block, btn);
      if (last && isFlexRow(last)) {
        try {
          last.appendChild(btn);
          btn.classList.add('is-inline');
          return 'inline';
        } catch (e) { /* 落到 ② */ }
      }
      var line = document.createElement('div');
      line.className = 'dyc-xhs-code-row';
      line.setAttribute('data-dyc-xhs-code-row', '1');
      try {
        line.appendChild(btn);
        block.appendChild(line);
        return 'row';
      } catch (e2) { /* 落到 ③ */ }
    }
    var row = card.querySelector(ACTION_SEL);
    if (!row) return '';
    try {
      row.insertBefore(btn, row.firstChild);
      return 'action';
    } catch (e3) { return ''; }
  }

  /** 这一行是「商品ID：xxx」吗（带标签，或本身就是一长串 hex） */
  function isIdRow(el) {
    if (!el) return false;
    // 用 pageText 而不是 textContent：按钮挂进去之后，textContent 会带上「ID」
    // 这两个字母，「整行就是一串 hex」的判据会被污染。
    var t = pageText(el);
    if (!t || t.length > 80) return false;        // 太长 = 整块容器，不是那一行
    if (/商品\s*ID\s*[:：]/i.test(t)) return true;
    return /^[0-9a-f]{16,32}$/i.test(t);
  }

  /**
   * 找「商品ID：…」那一行的元素。
   *
   * 【真机结构（2026-11-17 结构报告 + 用户截图核实）】
   *   这一行**不是** subtitle-row：
   *     · 描述行 span.--color-text-description（258×20，29 字）= 「商品ID：6afc…」
   *     · subtitle-row（254×28，12 字）= 下面那行推荐语（`· · · · · ·` + ✎）
   *   上一版按「subtitle-row 就是 ID 行」来挂，于是按钮跑到了推荐语行，
   *   离 ID 那串字隔了一行 —— 用户截图里正是这个现象。
   *   现在先认描述行，再退名称块里任何像 ID 行的小元素，最后才轮到 subtitle-row。
   */
  function idRowOf(card) {
    var block = card.querySelector(TITLE_SEL);
    if (!block) return null;
    // 按 DOM 顺序找第一个「像 ID 行」的子元素。
    // 不用 `span.--color-text-description` 这种类选择器：以 -- 开头的类名
    // 在老内核与 jsdom 的匹配行为不一致（自测里就选不中），按文本特征找更稳。
    var kids;
    try { kids = block.querySelectorAll('span, div, p'); } catch (e) { return null; }
    for (var i = 0; i < kids.length; i++) {
      if (isIdRow(kids[i])) return kids[i];
    }
    return isIdRow(block) ? block : null;
  }

  /**
   * 把小按钮「ID」挂到**「货号」按钮的左边**（2026-11-17 用户五次定稿：
   * 「还是把 ID 按钮放在货号按钮的左边吧」）。
   *
   * 【为什么以货号按钮为锚，而不是 ID 那一行】
   *   前四轮一直在追着 ID 文本走（最后一个字后面、红框后面），可平台的行结构
   *   会随推荐语等状态变，落点就跟着飘。两枚按钮本来就该成组出现在同一处，
   *   以「我们自己画的货号按钮」为锚最稳：它在哪，ID 就在它左边。
   *
   * 【四档，逐级兜底（货号开关可能被关掉，锚就没了）】
   *   ① 货号按钮在场 ⇒ 直接插在它前面，同一行、同一容器，天然对齐；
   *   ② 货号按钮不在 ⇒ 回到 ID 那一行内部（紧跟 ID 串）；
   *   ③ 只有 subtitle-row ⇒ 挂行尾；
   *   ④ 都没有 ⇒ 名称块右下自建行，按钮始终在卡片里。
   */
  function mountId(card, btn) {
    // 重挂（归位）时先把上一次的定位类清掉，否则 is-near 与 is-before 会同时生效、
    // margin 互相打架，按钮会偏几个像素。
    btn.classList.remove('is-near');
    btn.classList.remove('is-before');
    btn.classList.remove('is-inline');
    btn.classList.remove('is-float');

    var codeBtn = card.querySelector('.' + BTN_CLASS);
    if (codeBtn && codeBtn.parentNode) {
      try {
        codeBtn.parentNode.insertBefore(btn, codeBtn);
        btn.classList.add('is-before');
        return 'left-of-code';
      } catch (e) { /* 落到 ② */ }
    }

    var idRow = idRowOf(card);
    if (idRow) {
      try {
        idRow.appendChild(btn);
        btn.classList.add('is-near');
        return 'id-row';
      } catch (e) { /* 落到 ② */ }
    }
    var row = card.querySelector(SUBTITLE_SEL);
    if (row) {
      var a = row.querySelector('a');
      try {
        if (a && a.parentNode === row) {
          row.insertBefore(btn, a.nextSibling);
          btn.classList.add('is-near');
          return 'after-id';
        }
        row.appendChild(btn);
        btn.classList.add(isFlexRow(row) ? 'is-inline' : 'is-float');
        return 'row-end';
      } catch (e) { /* 落到 ④ */ }
    }
    var block = card.querySelector(TITLE_SEL);
    if (block) {
      var line = block.querySelector('.dyc-xhs-code-row');
      if (!line) {
        line = document.createElement('div');
        line.className = 'dyc-xhs-code-row';
        line.setAttribute('data-dyc-xhs-code-row', '1');
        try { block.appendChild(line); } catch (e2) { return ''; }
      }
      try {
        line.appendChild(btn);
        return 'code-row';
      } catch (e3) { return ''; }
    }
    return '';
  }

  /**
   * 小按钮只有 28×16，塞不下「已复制」三个字 —— 用符号反馈：
   * 成功「✓」蓝底白字，失败「!」灰化，1.5s 后复原文案「ID」。
   * 说清「复制了什么、结果如何」交给状态条的三段式消息（那里有空间）。
   */
  function flashId(btn, text, mode) {
    btn.textContent = text;
    btn.classList.toggle('is-err', mode === 'err');
    btn.classList.toggle('is-ok', mode === 'ok');
    clearTimeout(btn.__dycTimer);
    btn.__dycTimer = setTimeout(function () {
      btn.textContent = 'ID';
      btn.classList.remove('is-err');
      btn.classList.remove('is-ok');
    }, REVERT_MS);
  }

  function makeIdBtn(card) {
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = ID_BTN_CLASS;
    btn.textContent = 'ID';
    btn.setAttribute('data-dyc-xhs-copyid', '1');
    btn.setAttribute('aria-label', '复制商品 ID');
    // 与「货号」同一套字体（读平台按钮），并排时才对得齐
    applyFont(btn);
    btn.title = '点击复制商品 ID —— 就是左边「商品ID：」后面那串';

    btn.addEventListener('click', function (ev) {
      ev.preventDefault();
      ev.stopPropagation();
      var r = readId(card);
      noteIdDiag(card, r);
      if (!r.id) {
        btn.title = '这一行没找到商品 ID —— 页面上没有「商品ID：」那段，也没有可用的链接/属性';
        flashId(btn, '!', 'err');
        say('这一行没找到商品 ID', 'warning', { source: '商品ID复制' });
        return;
      }
      btn.title = '商品 ID：' + r.id;
      copyText(r.id, function (ok) {
        flashId(btn, ok ? '✓' : '!', ok ? 'ok' : 'err');
        if (!ok) {
          say('复制失败，请重试', 'warning', { source: '商品ID复制' });
          return;
        }
        // 三段式：`商品ID复制 ｜ 6afc… ｜ 已复制`
        say(r.id, 'success', { source: '商品ID复制', count: '已复制', standalone: true });
      });
    });
    return btn;
  }

  /** ID 按钮是不是正紧贴在货号按钮左边（同一容器、前一个兄弟） */
  function isTogether(idBtn, codeBtn) {
    return !!(idBtn && codeBtn && idBtn.parentNode && idBtn.parentNode === codeBtn.parentNode
      && idBtn.nextElementSibling === codeBtn);
  }

  function applyAll() {
    if (!flagsReady || !onCtrlPage()) return 0;
    var wantCode = flags.xhsCopyCode !== false;
    var wantId = flags.xhsCopyId !== false;
    if (!wantCode && !wantId) return 0;

    var cards = document.querySelectorAll(ROW_SEL);
    var n = 0;
    var idN = 0;
    var fixN = 0;
    var modes = { inline: 0, row: 0, action: 0 };
    for (var i = 0; i < cards.length; i++) {
      var card = cards[i];
      // 幂等：卡内已有本按钮就跳过。不用卡片属性标记 —— 平台清空卡片内容
      // 但保留卡片节点时，属性标记会把这一卡永久卡住。
      if (wantCode && !card.querySelector('.' + BTN_CLASS)) {
        ensureStyle();
        var mode = mount(card, makeBtn(card));
        if (mode) {
          n++;
          modes[mode] = (modes[mode] || 0) + 1;
        }
      }
      if (wantId) {
        var codeBtn = card.querySelector('.' + BTN_CLASS);
        var idBtn = card.querySelector('.' + ID_BTN_CLASS);
        if (!idBtn) {
          ensureStyle();
          if (mountId(card, makeIdBtn(card))) idN++;
        } else if (codeBtn && !isTogether(idBtn, codeBtn)) {
          // 【归位】平台是分批渲染的：首屏只画出 ID 那一行、货号行还没出来，
          // 这时 ID 已经按兜底规则挂到了 ID 行；等货号补上时 ID 早就存在，
          // 幂等判断会直接跳过 —— 两枚按钮就永久分在两处（用户 2026-11-17 报的现象）。
          // 所以每轮补扫都校验一次「是否紧邻」，不紧邻就挪回货号左侧。
          if (mountId(card, idBtn)) fixN++;
        }
      }
    }
    noteInjectStat(n, cards.length, modes, idN, fixN);
    return n + idN + fixN;
  }

  function schedule() {
    if (timer) return;
    timer = setTimeout(function () {
      timer = null;
      applyAll();
    }, APPLY_DEBOUNCE);
  }

  /** 只摘货号按钮（含它那条自建行）—— 单开关关闭时不影响 ID 按钮 */
  function removeCode() {
    var btns = document.querySelectorAll('.' + BTN_CLASS);
    for (var i = 0; i < btns.length; i++) {
      try { btns[i].parentNode.removeChild(btns[i]); } catch (e) { /* 尽力而为 */ }
    }
    var rows = document.querySelectorAll('.dyc-xhs-code-row');
    for (var j = 0; j < rows.length; j++) {
      try { rows[j].parentNode.removeChild(rows[j]); } catch (e2) { /* 尽力而为 */ }
    }
  }

  /** 只摘 ID 小按钮 */
  function removeId() {
    var btns = document.querySelectorAll('.' + ID_BTN_CLASS);
    for (var i = 0; i < btns.length; i++) {
      try { btns[i].parentNode.removeChild(btns[i]); } catch (e) { /* 尽力而为 */ }
    }
  }

  function start() {
    if (started) return;
    started = true;
    applyAll();
    if (typeof MutationObserver === 'function') {
      mo = new MutationObserver(schedule);
      try { mo.observe(document.body, { childList: true, subtree: true }); } catch (e) { mo = null; }
    }
    window.addEventListener('dyc:pagechange', function () {
      fontCache = null;          // 换页可能换主题，字体参数重新读一次
      schedule();
    });
  }

  function stop() {
    if (mo) { try { mo.disconnect(); } catch (e) { /* 尽力而为 */ } mo = null; }
    started = false;
    removeCode();
    removeId();
    removeStyle();
  }

  /**
   * 按当前两个开关把页面同步到目标状态。
   * 两个开关各自独立（用户 2026-11-17 定：货号按钮与 ID 按钮可分别开关），
   * 所以关一个只摘一个，另一个留着；两个都关才停观察器、移除样式表。
   */
  function sync() {
    if (!flagsReady) return;
    var wantCode = flags.xhsCopyCode !== false;
    var wantId = flags.xhsCopyId !== false;
    if (!wantCode) removeCode();
    if (!wantId) removeId();
    if (wantCode || wantId) {
      start();
      // 摘除货号按钮会连带删掉它所在的自建行（ID 按钮就排在它左边）
      // ⇒ 立刻补一轮，让 ID 按新锚重新落位；否则「关货号」会把 ID 一起带走。
      applyAll();
    } else {
      stop();
    }
  }

  function watch() {
    /* dycReadFlags() 返回 Promise —— 必须 .then（2026-11-17 事故：同步取用导致全黑） */
    dycReadFlags().then(function (f) {
      flags = f || {};
      flagsReady = true;
      sync();
    }, function () { /* 读不到就不注入，等 onChanged 救场 */ });

    if (typeof dycWatchFlags === 'function') {
      dycWatchFlags(function (f) {
        flags = f || {};
        flagsReady = true;
        sync();
      });
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
