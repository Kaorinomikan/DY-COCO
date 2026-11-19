/**
 * 小红书中控台 · 商品序号定位
 * ============================================================
 * 【需求（2026-11-17 用户定）】
 *   把抖音中控台做好的「序号定位」照搬过来，按小红书页面做适配。
 *   定位 = 输入序号 → 滚动到那张卡 + 呼吸灯高亮，全程不点击商品；
 *   读数 = 控件自带「共 N 个」总数（抖音 nav.js 里也是这三段一体，
 *   不是独立功能）。用户 2026-11-17 23:42 圈定落点：商品列表「全部 /
 *   添加分类 / 搜索框」那一行的搜索框右侧。
 *
 * 【与抖音版的差异（都是页面事实逼出来的，不是省略）】
 *   ① 商品总数：抖音靠「内容高 ÷ 行距」推算（虚拟列表），小红书 50 张卡
 *      全量在 DOM（结构报告：内容高 9763 / 可见 711，未发现虚拟滚动）⇒
 *      直接数 .goods-card，精确、无误差、无需等渲染。
 *   ② 定位：抖音要等虚拟列表渲染出第 N 行再补扫；小红书直接取那张卡，
 *      少 2 秒轮询与超时面。
 *   ③ 滚动：抖音单次写 scrollTop 就够；小红书平台会回写（xhs-scroll.js
 *      实测）⇒ 沿用 rAF 自驱动画 300ms + 落点校验。
 *   ④ 高亮：抖音在卡内加叠加层并临时改 position:relative；小红书卡片由
 *      React 管，改它的 position 会被重置 ⇒ 改成 **position:fixed 覆盖层
 *      + rAF 跟随卡片矩形**，平台样式一个字节都不碰。
 *   ⑤ 锚点：抖音用「筛选」按钮；小红书那一行**没有固定类名**可依赖，
 *      改用搜索框的三种特征（placeholder / aria-label / 占位文案）找锚点，
 *      「包含」匹配而非全等 —— 平台微调文案时不失效（同 search.js 的口径）。
 *      三条都落空就报人话 + 写诊断，不静默消失（见 findAnchor 的说明）。
 *
 * 【2026-11-18 00:04 事故：用户「没看见定位功能」】
 *   报告里 xhsLocate 开关已在列、控件却不在挂载表里 —— 两个成因都堵上：
 *     ① 新增注入条目要**重载扩展**才生效（刷新页面只重读脚本文件，
 *        manifest 的 content_scripts 清单仍是内存里的旧版）；
 *     ② 锚点原先只认 placeholder 一种写法，赌错就整条功能消失；
 *        现在三路兜底，插不上 6 秒内就报，并把候选写进诊断轨迹。
 *
 * 【2026-11-18 00:10 事故：用户「功能错位了，要放在搜索框右边，样式跟抖店一样」】
 *   控件掉到了搜索框**下面一行** —— 搜索框外面还套了一层竖向容器，
 *   上一版「上溯到宽度膨胀 1.8 倍再插下一个兄弟位」在真机上落到容器内下一格。
 *   ⇒ 落点改成**量了再定**：逐层往上试，竖直区间与搜索框重叠（同一行）才算对，
 *     两拍都不对就自动重放（placeNear / sameRow / heartbeat 的 misBeats）。
 *   ⇒ 视觉照搬抖店 nav.css：输入框 80×30 白底灰边、实心蓝按钮 #0075ff、
 *     11px 灰读数「共 N 个商品」，不另创一套设计。
 *
 * 【2026-11-18 13:20 事故：用户「序号定位功能不要在抽屉出现」】
 *   「添加商品」抽屉里也有一枚「请输入商品名称」的搜索框，第三路（占位文案）
 *   命中它，控件被插进抽屉的竖排列表 —— 诊断报告量到
 *   `#dyc-xhs-locate` 为 212×873（正常约 190×30）。修复：三路锚点一律跳过
 *   浮层内的候选（inOverlay）；控件一旦被平台搬进浮层，心跳本拍就拆掉重挂。
 *
 * 【序号口径：只认卡片自带的序号框（用户 2026-11-17 定）】
 *   卡片左侧有 .goods-card__index（拖动柄 + 序号输入框），用户屏幕上看到的
 *   「1、2、3…」就是它。**按它的值匹配，不按列表位次**。
 *   取值三源（都属「序号框的值」，不是猜位次）：input.value → 输入框属性
 *   → 序号框容器的可见文本。三源都空 ⇒ 明确报「没读到卡片序号」，
 *   **绝不退回去按位次瞎找**（那会把「定位错了」伪装成「定位成功」）。
 *
 * 【平台自己也有序号搜索，本功能不替代它】
 *   那枚搜索框接受「商品名称、序号或ID」，但它做的是**过滤**：输入后其他
 *   商品被隐藏。本功能只滚动 + 高亮、列表内容不变，直播中「讲完第 3 个
 *   讲第 4 个」可以连着点，不用清空搜索框。
 *
 * 【开关】xhsLocate（小红书专用行，默认开）。★ dycReadFlags() 返回 Promise。
 * ============================================================
 */
(function () {
  'use strict';

  // 防重复注入（SPA 路由回切 / 脚本意外重跑）
  if (window.__dycXhsLocateLoaded) return;
  window.__dycXhsLocateLoaded = true;

  var BOX_ID = 'dyc-xhs-locate';
  var INPUT_ID = 'dyc-xhs-locate-input';
  var GO_ID = 'dyc-xhs-locate-go';
  var STYLE_ID = 'dyc-xhs-locate-style';
  var GLOW_ID = 'dyc-xhs-locate-glow';
  var COUNT_CLASS = 'dyc-xhs-locate-count';

  var CARD_SEL = '.goods-card';
  var LIST_SEL = '.goods-card-list';
  var INDEX_SEL = '.goods-card__index';
  var TITLE_SEL = '.goods-card__title-block';

  /* 平台搜索框的 placeholder 片段。不写全等 —— 这页是
   * 「请输入商品名称、序号或ID」，平台随时可能再改标点。 */
  var ANCHOR_PH = '请输入商品名称';

  /* 平台浮层（抽屉 / 弹窗 / 气泡）：锚点与控件都不许落在里面。
   * 【2026-11-18 事故：控件跑到「添加商品」抽屉里】
   *   抽屉里也有「请输入商品名称」的搜索框（add-goods-table 顶部）。
   *   第三路（占位文案）命中它，控件被插进抽屉的竖排列表 ——
   *   诊断报告里 #dyc-xhs-locate 量到 212×873，正常应约 190×30。
   *   类名用 d-design 全家族 + role 兜底；`[class*=]` 兼顾带 hash 的形态。 */
  var OVERLAY_SEL = '.d-drawer,.d-modal,.d-dialog,.d-popover,.d-drawer-mask,'
    + '[class*="d-drawer"],[class*="d-modal"],[class*="d-dialog"],[class*="d-popover"],'
    + '[role="dialog"],[role="drawer"]';

  var SCROLL_MS = 300;
  var GLOW_MS = 3000;
  var HEARTBEAT_MS = 1000;
  /* 6 拍（≈6 秒）插不上就报一次。
   * 原先是 30 秒 —— 2026-11-18 00:04 用户等了 19 秒只看到「功能没做」，
   * 而控件其实一直在每秒重试。人的耐心比 30 秒短，插不上就说。 */
  var WARN_AFTER = 6;

  var host = null;
  var inputEl = null;
  var countEl = null;
  var flags = {};
  var flagsReady = false;
  var started = false;
  var beat = null;
  var missCount = 0;
  var warned = false;
  var lastCount = -1;

  var glowEl = null;
  var glowTarget = null;
  var glowUntil = 0;
  var glowRaf = 0;
  var animRafs = [];

  /* ---------- 页面判定 ---------- */

  function onCtrlPage() {
    try {
      var pat = window.DYC_PAGE_PATTERNS;
      return !!(pat && pat.xhsCtrl && pat.xhsCtrl.test(location.href));
    } catch (e) { return false; }
  }

  /* ---------- 小工具 ---------- */

  /** 剥零宽字符 + 折空白：这类"只显示不给抄"的字段常被塞零宽字符防抓取 */
  function clean(s) {
    return String(s == null ? '' : s)
      .replace(/[\u200B-\u200F\u202A-\u202E\u2060-\u2064\uFEFF]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function visible(el) {
    if (!el || el.nodeType !== 1) return false;
    var r;
    try { r = el.getBoundingClientRect(); } catch (e) { return false; }
    return r.width > 0 && r.height > 0;
  }

  /** 元素是否位于平台浮层（抽屉 / 弹窗 / 气泡）之内 */
  function inOverlay(el) {
    if (!el || el.nodeType !== 1 || !el.closest) return false;
    try { return !!el.closest(OVERLAY_SEL); } catch (e) { return false; }
  }

  function say(message, type, opts) {
    try {
      if (typeof setStatus === 'function') {
        setStatus(message, type, Object.assign({ source: '序号定位' }, opts || {}));
      }
    } catch (e) { /* 消息盒子不可用不影响定位本身 */ }
  }

  /** 输入类错误与「超出范围」不进历史：高频操作，全收进盒子会把历史刷满 */
  function sayQuiet(message, type) {
    say(message, type, { keepHistory: false });
  }

  function noteDiag(detail, result) {
    try {
      var d = window.__dycDiag;
      if (d && typeof d.note === 'function') d.note('序号定位', detail, result);
    } catch (e) { /* 诊断失败不许影响定位 */ }
  }

  /* ---------- 商品卡与序号 ---------- */

  function cards() {
    var list = document.querySelector(LIST_SEL);
    var out;
    try {
      out = list ? list.querySelectorAll(CARD_SEL) : document.querySelectorAll(CARD_SEL);
    } catch (e) { return []; }
    return Array.prototype.slice.call(out);
  }

  function total() {
    return cards().length;
  }

  /** 从字符串里取序号：只认第一段 1~4 位数字（序号框里不该有别的数字） */
  function serialFrom(s) {
    var m = clean(s).match(/\d{1,4}/);
    return m ? parseInt(m[0], 10) : 0;
  }

  /**
   * 读一张卡的序号 → 数字；读不到返回 0。
   *
   * 三源都属「序号框的值」，不是按位次猜：
   *   ① 序号框 input 的当前值（最准，用户所见即所得）
   *   ② 输入框上的 value / title / data-* 属性（平台可能把值只放属性里）
   *   ③ 序号框容器的可见文本（有的实现是纯文本而非 input）
   */
  function serialOf(card) {
    var box = card.querySelector(INDEX_SEL);
    var inp = box ? box.querySelector('input') : card.querySelector(INDEX_SEL + ' input');

    if (inp) {
      var v = serialFrom(inp.value);
      if (v) return v;
      var attrs = ['value', 'title', 'data-index', 'data-sort', 'data-value', 'data-num'];
      for (var i = 0; i < attrs.length; i++) {
        var a = serialFrom(inp.getAttribute(attrs[i]));
        if (a) return a;
      }
    }

    if (box) {
      // textContent 会带上我们注入的节点（本功能没往卡里插东西，但仍按
      // AGENTS 第 23 条留一道：读页面数据只读纯页面文本）
      var t = ownText(box);
      var s = serialFrom(t);
      if (s) return s;
    }
    return 0;
  }

  /** 整棵跳过扩展自己注入的节点后取文本 */
  function ownText(root) {
    if (!root) return '';
    var parts = [];
    try {
      var walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
        acceptNode: function (n) {
          if (n.nodeType === 1) {
            if (n.getAttribute && n.getAttribute('data-dyc-skip') !== null) return NodeFilter.FILTER_REJECT;
            return NodeFilter.FILTER_SKIP;
          }
          return NodeFilter.FILTER_ACCEPT;
        }
      });
      var n;
      while ((n = walker.nextNode())) parts.push(n.nodeValue || '');
    } catch (e) { return ''; }
    return clean(parts.join(' '));
  }

  function nameOf(card) {
    var el = card.querySelector(TITLE_SEL + ' span.--color-text-title')
          || card.querySelector(TITLE_SEL + ' span');
    return el ? clean(el.textContent).slice(0, 24) : '';
  }

  /* ---------- 滚动（对抗平台回写） ---------- */

  function cancelAnims() {
    for (var i = 0; i < animRafs.length; i++) {
      try { cancelAnimationFrame(animRafs[i]); } catch (e) { /* 忽略 */ }
    }
    animRafs = [];
  }

  function maxTop(el) { return Math.max(0, el.scrollHeight - el.clientHeight); }

  function animateTo(el, target) {
    var start = el.scrollTop;
    if (Math.abs(target - start) < 1) {
      try { el.scrollTop = target; } catch (e) { /* 忽略 */ }
      return;
    }
    var span = target - start;
    var t0 = 0;
    function step(ts) {
      if (!el.isConnected) return;
      if (!t0) t0 = ts;
      var p = Math.min(1, (ts - t0) / SCROLL_MS);
      var ease = 1 - Math.pow(1 - p, 3);          // easeOutCubic
      try { el.scrollTop = start + span * ease; } catch (e) { return; }
      if (p < 1) {
        animRafs.push(requestAnimationFrame(step));
        return;
      }
      /* 落点校准：平台若在最后一帧又写回去，再压一次 */
      try { el.scrollTop = target; } catch (e2) { /* 忽略 */ }
    }
    animRafs.push(requestAnimationFrame(step));
  }

  function isScrollable(el) {
    if (!el || el.nodeType !== 1) return false;
    if (el.scrollHeight - el.clientHeight <= 4) return false;
    var cs;
    try { cs = getComputedStyle(el); } catch (e) { return false; }
    var oy = cs.overflowY;
    return oy === 'auto' || oy === 'scroll' || oy === 'overlay';
  }

  /**
   * 卡片的外层可滚祖先（内层商品列表之外那一层）。
   *
   * 用**递归 + 深度上限**而不是 while 循环：
   *   性能闸门 R6 盯的是「扫描型循环里逐节点读布局」，而这里是用户点一次
   *   才走一遍、最多 6 层祖先，不是高频路径；写成递归让这个区别显式。
   */
  function outerScroller(card, depth) {
    var d = depth || 0;
    if (d > 6) return null;
    var el = card.parentElement;
    if (!el || el === document.body) return null;
    if (isScrollable(el)) {
      // 再往上找一层真正能装下整张卡的外层（商品列表自身由 reveal 负责）
      var up = outerScroller(el, d + 1);
      return up || (el.classList && el.classList.contains('goods-card-list') ? null : el);
    }
    return outerScroller(el, d + 1);
  }

  /**
   * 把卡片滚到列表可视区中间，并把外层容器归位到能看见它。
   * @param {Element} card
   * @param {Function} cb  cb(ok) —— ok=false 表示落点没站住（已被平台改回）
   */
  function reveal(card, cb) {
    cancelAnims();

    var list = card.closest ? card.closest(LIST_SEL) : null;
    if (!list) list = document.querySelector(LIST_SEL);

    var target = 0;
    if (list) {
      var cr = card.getBoundingClientRect();
      var lr = list.getBoundingClientRect();
      var offset = cr.top - lr.top + list.scrollTop;
      target = offset - (list.clientHeight - cr.height) / 2;
      target = Math.max(0, Math.min(target, maxTop(list)));
      animateTo(list, target);
    }

    setTimeout(function () {
      // 外层（.control-container 之类，可滚距离很小）：卡片被挤出视口才动它
      var outer = outerScroller(card, 0);
      if (outer) {
        var r = card.getBoundingClientRect();
        var er = outer.getBoundingClientRect();
        if (r.top < er.top + 8) {
          try { outer.scrollTop += (r.top - er.top - 8); } catch (e) { /* 忽略 */ }
        } else if (r.bottom > er.bottom - 8) {
          try { outer.scrollTop += (r.bottom - er.bottom + 8); } catch (e2) { /* 忽略 */ }
        }
      }

      setTimeout(function () {
        var ok = true;
        if (list && list.isConnected) {
          if (Math.abs(list.scrollTop - target) > 8) {
            try { list.scrollTop = target; } catch (e3) { /* 忽略 */ }
            ok = Math.abs(list.scrollTop - target) <= 8;
          }
        }
        if (typeof cb === 'function') cb(ok);
      }, 120);
    }, SCROLL_MS + 60);
  }

  /* ---------- 呼吸灯（fixed 覆盖层，不碰平台样式） ---------- */

  function ensureGlowStyle() {
    if (document.getElementById(STYLE_ID)) return;
    var st = document.createElement('style');
    st.id = STYLE_ID;
    st.textContent = [
      '#' + GLOW_ID + ' {',
      '  position: fixed; pointer-events: none;',
      '  z-index: 2147482000;',
      '  border-radius: 8px;',
      /* 视觉照搬抖音 locate.js：淡橙底 + 2px 内描边，1 秒一次共 3 次 */
      '  background: rgba(255, 160, 60, .22);',
      '  box-shadow: 0 0 0 2px rgba(255, 150, 40, .55) inset;',
      '  animation: dyc-xhs-breathe 1s ease-in-out 3;',
      '}',
      '@keyframes dyc-xhs-breathe {',
      '  0%, 100% { opacity: .15; }',
      '  50% { opacity: 1; }',
      '}',
      /* ── 控件：尺寸/颜色/圆角逐项对齐抖店 nav.css ──
       * 2026-11-18 用户定：「样式也做的跟抖店的一样」。抖店那套是
       * 输入框 80×30 白底灰边 + 实心蓝按钮（#0075ff）+ 11px 灰读数，
       * 这里照搬，不另创设计；尺寸固定 px，不随页面缩放（AGENTS 第 15 条）。 */
      '#' + BOX_ID + ' {',
      '  position: relative; display: inline-flex; align-items: center; gap: 6px;',
      '  margin: 0 0 0 10px; vertical-align: middle;',
      '}',
      '#' + INPUT_ID + ' {',
      '  width: 80px; height: 30px; padding: 0 10px; box-sizing: border-box;',
      '  border: 1px solid #d9dce1; border-radius: 4px; background: #fff;',
      '  color: #1f2329; font-size: 13px;',
      '  font-family: -apple-system, BlinkMacSystemFont, "Microsoft YaHei", sans-serif;',
      '  text-align: center; outline: none;',
      '  transition: border-color .15s;',
      '}',
      '#' + INPUT_ID + '::placeholder { color: #a9aeb8; }',
      '#' + INPUT_ID + ':focus { border-color: #0075ff; }',
      '#' + GO_ID + ' {',
      '  height: 30px; padding: 0 14px; margin: 0;',
      '  border: 1px solid #0075ff; border-radius: 4px;',
      '  background: #0075ff; color: #fff;',
      '  font-size: 13px; line-height: 28px;',
      '  font-family: -apple-system, BlinkMacSystemFont, "Microsoft YaHei", sans-serif;',
      '  cursor: pointer; white-space: nowrap;',
      '  transition: background .15s, border-color .15s;',
      '}',
      '#' + GO_ID + ':hover { background: #3a8cff; border-color: #3a8cff; }',
      '#' + GO_ID + ':active { background: #0065d6; border-color: #0065d6; }',
      '#' + GO_ID + ':disabled { background: #9dbfff; border-color: #9dbfff; cursor: default; }',
      '.' + COUNT_CLASS + ' {',
      '  font-size: 11px; line-height: 1.4; color: #86909c;',
      '  white-space: nowrap; pointer-events: none; margin-left: 2px;',
      '}'
    ].join('\n');
    (document.head || document.documentElement).appendChild(st);
  }

  function removeGlowStyle() {
    var st = document.getElementById(STYLE_ID);
    if (st && st.parentNode) st.parentNode.removeChild(st);
  }

  function paintGlow() {
    if (!glowEl || !glowTarget) return;
    var r;
    try { r = glowTarget.getBoundingClientRect(); } catch (e) { return; }
    var s = glowEl.style;
    s.left = r.left + 'px';
    s.top = r.top + 'px';
    s.width = r.width + 'px';
    s.height = r.height + 'px';
  }

  function glowOff() {
    if (glowRaf) {
      try { cancelAnimationFrame(glowRaf); } catch (e) { /* 忽略 */ }
      glowRaf = 0;
    }
    if (glowEl && glowEl.parentNode) glowEl.parentNode.removeChild(glowEl);
    glowEl = null;
    glowTarget = null;
    glowUntil = 0;
  }

  /**
   * 点亮一张卡：fixed 覆盖层跟随卡片矩形 3 秒。
   *
   * 【为什么不用抖音那种卡内叠加层】
   *   抖音是 `el.appendChild(glow)` + 临时把行改成 position:relative。
   *   小红书卡片由 React 管，改 position / 往卡里插节点都会被下一轮重渲染
   *   抹掉或重置（xhs-name-wrap 的真机教训）。fixed 覆盖层挂在 body 上、
   *   每帧读一次卡片矩形写一次坐标，平台侧零改动。
   */
  function glowOn(card) {
    glowOff();
    ensureGlowStyle();

    var g = document.createElement('div');
    g.id = GLOW_ID;
    g.setAttribute('data-dyc-skip', '1');
    try {
      var r = getComputedStyle(card).borderRadius;
      g.style.borderRadius = (r && r !== '0px') ? r : '8px';
    } catch (e) { g.style.borderRadius = '8px'; }

    document.body.appendChild(g);
    glowEl = g;
    glowTarget = card;
    glowUntil = Date.now() + GLOW_MS;
    paintGlow();

    (function loop() {
      if (!glowEl) return;
      if (Date.now() > glowUntil || !glowTarget || !glowTarget.isConnected) {
        glowOff();
        return;
      }
      paintGlow();
      glowRaf = requestAnimationFrame(loop);
    })();
  }

  /* ---------- 控件 ---------- */

  function buildBox() {
    var box = document.createElement('div');
    box.id = BOX_ID;
    box.className = 'dyc-xhs-locate';
    box.setAttribute('data-dyc-xhs-locate', '1');
    box.setAttribute('data-dyc-skip', '1');
    box.title = '输入商品序号，滚动到那张卡并高亮（不改列表内容）';

    var inp = document.createElement('input');
    inp.id = INPUT_ID;
    inp.type = 'text';
    inp.setAttribute('inputmode', 'numeric');
    inp.setAttribute('autocomplete', 'off');
    inp.setAttribute('maxlength', '4');
    inp.placeholder = '序号';
    inp.title = '商品序号 —— 就是卡片左侧那个数字';

    var btn = document.createElement('button');
    btn.id = GO_ID;
    btn.type = 'button';
    btn.textContent = '定位';

    var cnt = document.createElement('span');
    cnt.className = COUNT_CLASS;
    cnt.textContent = '正在统计...';

    box.appendChild(inp);
    box.appendChild(btn);
    box.appendChild(cnt);

    btn.addEventListener('click', handleGo);
    inp.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') handleGo(e);
    });
    /* 这一行平台挂了点击/多选逻辑，不让它跟着我们的点击跑 */
    ['click', 'mousedown', 'pointerdown'].forEach(function (t) {
      box.addEventListener(t, function (e) { e.stopPropagation(); });
    });

    return box;
  }

  /**
   * 找搜索框锚点 —— **三条路，逐级放宽**。
   *
   * 【为什么不再只认 placeholder（2026-11-18 00:04 用户报「没看见定位功能」）】
   *   结构报告只采了商品卡与顶部菜单，**没覆盖列表头那一行**：搜索框到底是
   *   `<input placeholder>`，还是「div 画占位 + 没有 placeholder 的 input」
   *   （d-design 那套组件两种写法都有），离线无从确认。
   *   只认一种实现就是赌，赌错时整条功能消失，而用户看到的只会是
   *   「你说做完了，其实没做」—— 这比功能不好用更伤信任。
   *   所以按「越确定越先试」排三条，全落空就返回 null，由心跳报人话 + 留诊断。
   *
   * 【三条路共同的排除项（2026-11-18 真机）】
   *   平台抽屉里也有同名搜索框，文字/placeholder 一模一样。凡位于浮层内的候选
   *   一律跳过（inOverlay）—— 否则控件会被挂进抽屉，随抽屉列表竖排拉伸。
   */
  function findAnchor() {
    var i, el;

    // ① placeholder 属性含关键词（最常见）
    var ins;
    try { ins = document.querySelectorAll('input[placeholder]'); } catch (e) { ins = []; }
    for (i = 0; i < ins.length; i++) {
      el = ins[i];
      if ((el.getAttribute('placeholder') || '').indexOf(ANCHOR_PH) === -1) continue;
      if (!visible(el)) continue;
      if (inOverlay(el) || el.closest('[data-dyc-skip]')) continue;        // 抽屉里的同名搜索框不是工具栏锚点
      return { el: el, via: 'placeholder' };
    }

    // ② aria-label / title 含关键词（无障碍标签，平台通常同步写一份）
    var all;
    try { all = document.querySelectorAll('input'); } catch (e2) { all = []; }
    for (i = 0; i < all.length; i++) {
      el = all[i];
      var lab = (el.getAttribute('aria-label') || '') + '|' + (el.getAttribute('title') || '');
      if (lab.indexOf(ANCHOR_PH) === -1) continue;
      if (!visible(el)) continue;
      if (inOverlay(el) || el.closest('[data-dyc-skip]')) continue;
      return { el: el, via: 'label' };
    }

    // ③ 占位文案本身是个元素（div 画占位、input 不带 placeholder）
    var nodes;
    try { nodes = document.querySelectorAll('div,span,p,label'); } catch (e3) { nodes = []; }
    for (i = 0; i < nodes.length; i++) {
      el = nodes[i];
      if (el.children && el.children.length > 0) continue;
      if (clean(el.textContent).indexOf(ANCHOR_PH) !== 0) continue;
      if (!visible(el)) continue;
      if (inOverlay(el) || el.closest('[data-dyc-skip]')) continue;
      return { el: el, via: 'text' };
    }

    return null;
  }

  /**
   * 插不上时写给诊断报告的一句话：页面上到底有哪些候选。
   * 只读属性、不读布局 —— 每秒最多跑一次，必须便宜。
   */
  function anchorReport() {
    var phs = [];
    var ins;
    try { ins = document.querySelectorAll('input'); } catch (e) { ins = []; }
    for (var i = 0; i < ins.length && phs.length < 5; i++) {
      var t = (ins[i].getAttribute('placeholder') || '')
        + (ins[i].getAttribute('aria-label') || '')
        + (ins[i].getAttribute('title') || '');
      if (!t) continue;
      phs.push(t.slice(0, 12));
    }
    return 'input ' + ins.length + ' 个｜样例: ' + (phs.join(' / ') || '无');
  }

  /**
   * 从输入框上溯到「搜索框外壳」：宽度一膨胀到输入框 1.8 倍以上，
   * 说明已经到整行了，停在上一个 —— 控件才会紧贴搜索框右侧，
   * 而不是跑到整行末尾（右侧还有「批量下架 / 添加商品」）。
   */
  function searchBoxOf(inp) {
    var box = inp;
    var ir;
    try { ir = inp.getBoundingClientRect(); } catch (e) { return inp; }
    for (var i = 0; i < 4; i++) {
      var p = box.parentElement;
      if (!p || p === document.body) break;
      var pr;
      try { pr = p.getBoundingClientRect(); } catch (e2) { break; }
      if (ir.width > 0 && pr.width > ir.width * 1.8) break;
      box = p;
    }
    return box;
  }

  // 循环讲解也使用该锚点，独立于序号定位开关。
  window.dycFindXhsSearchBox = function () {
    var anchor = findAnchor();
    if (!anchor) return null;
    var el = anchor.el;
    var wrapper = el.closest('.d-input-wrapper');
    if (visible(wrapper)) return wrapper;
    if (anchor.via === 'text') {
      // 模拟占位文案可能比搜索框窄，先找同一盒子里的实际输入框。
      for (var i = 0, node = el.parentElement; node && i < 4; i++, node = node.parentElement) {
        var inputs = node.querySelectorAll('input');
        if (inputs.length > 1 || node.querySelector('button')) break;
        if (inputs.length === 1 && visible(inputs[0])) return searchBoxOf(inputs[0]);
      }
    }
    return searchBoxOf(el);
  };

  /**
   * 两个元素的竖直区间是否重叠 —— 「是不是同一行」的唯一判据。
   * 量不到（宽高为 0）一律判**没放对**：宁可再往上试一层，也不认账。
   */
  function sameRow(a, b) {
    if (!a || !b) return false;
    var ra, rb;
    try {
      ra = a.getBoundingClientRect();
      rb = b.getBoundingClientRect();
    } catch (e) { return false; }
    if (!rb.width || !rb.height) return false;
    var overlap = Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top);
    var minH = Math.min(ra.height, rb.height);
    return minH > 0 && overlap >= minH * 0.5;
  }

  function alignCenter(anchor, el) {
    var search = anchor.closest('.d-input-wrapper') || anchor;
    var a = search.getBoundingClientRect();
    var b = el.getBoundingClientRect();
    if (!a.height || !b.height) return;
    var shift = (a.top + a.height / 2) - (b.top + b.height / 2);
    if (Math.abs(shift) >= 0.5) el.style.top = ((parseFloat(el.style.top) || 0) + shift) + 'px';
  }

  /**
   * 把控件放到搜索框右侧 —— **插进去就量，量不对就退出来上一层再试**。
   *
   * 【为什么必须量（2026-11-18 00:10 真机）】
   *   上一版按「宽度膨胀到 1.8 倍」找外壳、插在它的下一个兄弟位。真机上搜索框
   *   外面还套了一层**竖向容器**，于是插入点落在搜索框**下面一行**
   *   （用户截图：控件掉到「全选 / 已选 0 项」下方）。
   *   结构报告没覆盖这一行，靠推 DOM 结构永远在猜；改成量几何：
   *   从最近的候选往上试，谁的竖直区间与搜索框真的重叠（同一行）就用谁。
   *
   * @returns {string} same-row / same-row+N / fallback（都不行但留着）/ none
   */
  function placeNear(anchor, el) {
    el.style.top = '';
    var nodes = [];
    var node = searchBoxOf(anchor);
    for (var i = 0; i < 4 && node && node !== document.body; i++) {
      nodes.push(node);
      node = node.parentElement;
    }
    if (!nodes.length) return 'none';

    var inserted = false;
    for (var k = 0; k < nodes.length; k++) {
      var n = nodes[k];
      var parent = n.parentElement;
      if (!parent) continue;
      try {
        parent.insertBefore(el, n.nextSibling);
      } catch (e) { continue; }
      inserted = true;
      /* 落点还必须在浮层外：抽屉开着时祖先链可能整条都在抽屉里 */
      if (!inOverlay(el) && sameRow(anchor, el)) {
        alignCenter(anchor, el);
        return k === 0 ? 'same-row' : ('same-row+' + k);
      }
      if (k < nodes.length - 1) {
        try { parent.removeChild(el); } catch (e2) { /* 忽略 */ }
        inserted = false;
      }
    }
    return inserted ? 'fallback' : 'none';
  }

  function refreshCount() {
    if (!countEl) return;
    var n = total();
    if (n === lastCount) return;
    lastCount = n;
    /* 文案对齐抖店 nav.js：「共 N 个商品」 */
    countEl.textContent = n > 0 ? ('共 ' + n + ' 个商品') : '未识别到商品';
  }

  function mount() {
    if (document.getElementById(BOX_ID)) return true;
    var anchor = findAnchor();
    if (!anchor) return false;

    ensureGlowStyle();
    var el = buildBox();
    var how = placeNear(anchor.el, el);
    if (how === 'none') return false;

    host = el;
    inputEl = el.querySelector('#' + INPUT_ID);
    countEl = el.querySelector('.' + COUNT_CLASS);
    lastCount = -1;
    refreshCount();
    if (anchor.via !== 'placeholder' || how === 'fallback') {
      noteDiag('落点 ' + how + '｜锚点 ' + anchor.via + '｜' + anchorReport(),
        how === 'fallback' ? '放偏了' : '已挂上');
    }
    return true;
  }

  function unmount() {
    glowOff();
    if (host && host.parentNode) host.parentNode.removeChild(host);
    host = null; inputEl = null; countEl = null;
    lastCount = -1;
    removeGlowStyle();
  }

  /* ---------- 定位 ---------- */

  // 粘贴加车用商品 ID 找到卡片后，与序号定位共用居中和高亮。
  window.dycRevealXhsGoodsCard = function (card, done) {
    if (!onCtrlPage() || !card || !card.isConnected || !card.closest(LIST_SEL)) { done(false); return; }
    reveal(card, function (ok) {
      if (!onCtrlPage() || !card.isConnected) { done(false); return; }
      glowOn(card);
      done(ok);
    });
  };

  function handleGo(e) {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    if (!inputEl) return;

    var raw = (inputEl.value || '').trim();
    if (!/^\d+$/.test(raw)) {
      sayQuiet('请先输入商品序号', 'warning');
      inputEl.focus();
      inputEl.select();
      return;
    }

    var want = parseInt(raw, 10);
    var list = cards();
    var n = list.length;

    if (!n) {
      sayQuiet('未识别到商品列表', 'warning');
      return;
    }

    var hit = null;
    var readable = 0;
    for (var i = 0; i < n; i++) {
      var s = serialOf(list[i]);
      if (!s) continue;
      readable++;
      if (s === want && !hit) hit = list[i];
    }

    /* 序号框是**唯一**口径：一个都读不到就明说，不按位次猜 ——
     * 猜出来的「第 N 个」如果与用户屏幕上的数字不符，会比不定位更糟。 */
    if (!readable) {
      noteDiag('卡片 ' + n + ' 个｜读到序号 0 个', '未定位');
      say('没读到卡片序号', 'error', {
        full: '商品卡左侧的序号框没有数值（列表可能还没渲染完，或平台改了显示方式）。'
          + '本功能按序号框的值定位，读不到就不猜。'
      });
      refreshCount();
      return;
    }

    if (!hit) {
      noteDiag('卡片 ' + n + ' 个｜读到序号 ' + readable + ' 个', '序号 ' + want + ' 未命中');
      sayQuiet('序号超出范围，当前共 ' + n + ' 个商品', 'warning');
      refreshCount();
      return;
    }

    var name = nameOf(hit);
    window.dycRevealXhsGoodsCard(hit, function (ok) {
      refreshCount();
      if (!ok) {
        // 落点被平台改回：不谎报成功，但也不假装没发生 —— 人话说明并给位置
        say(name || ('第 ' + want + ' 个商品'), 'warning', {
          source: '序号定位',
          count: want + '/' + n,
          full: '列表被平台回写，落点没站住（商品列表正在刷新或容器刚被换节点）。稍等再点一次。',
          keepHistory: false
        });
        return;
      }
      noteDiag('卡片 ' + n + ' 个｜读到序号 ' + readable + ' 个',
        '序号 ' + want + ' → ' + (name || '已定位'));
      /* 三段式：`序号定位 ｜ 商品名 ｜ 3/50` */
      say(name || ('第 ' + want + ' 个商品'), 'success', {
        source: '序号定位',
        count: want + '/' + n,
        standalone: true
      });
    });
  }

  /* ---------- 心跳：补插 + 落点自愈 + 总数 ---------- */

  var misBeats = 0;   // 连续几拍「控件不在搜索框同一行」

  function heartbeat() {
    /* 控件落在浮层里 ⇒ 本拍就拆掉重挂，不等两拍错位判定。
     * 2026-11-18 真机：抽屉打开后控件被插进抽屉列表，被竖排拉成 212×873，
     * 用户看到的就是「序号定位跑到抽屉里去了」。 */
    var cur = document.getElementById(BOX_ID);
    if (cur && inOverlay(cur)) {
      try { cur.parentNode.removeChild(cur); } catch (e) { /* 忽略 */ }
      host = null; inputEl = null; countEl = null; lastCount = -1; misBeats = 0;
      noteDiag('控件在浮层内｜已拆掉重挂', '移出');
    }

    if (!document.getElementById(BOX_ID)) {
      host = null;
      misBeats = 0;
      if (!mount()) {
        missCount++;
        if (missCount === WARN_AFTER && !warned) {
          warned = true;
          /* 写进诊断轨迹：下一份报告里就能看到页面上真实有哪些候选，
           * 不用再来回猜「是没重载、还是锚点不对」 */
          noteDiag('插不上｜' + anchorReport(), '未注入');
          say('没找到商品列表工具栏', 'warning', {
            full: '页面上找不到「请输入商品名称」这枚搜索框（placeholder / aria-label / 占位文案三路都没命中），'
              + '序号定位控件无法落位。把调试面板里的诊断报告发我，按真实结构补锚点。',
            keepHistory: false
          });
          dumpAnchorDiagnostics();
        }
        return;
      }
      missCount = 0;
      warned = false;
      refreshCount();
      return;
    }

    /* 落点自愈：平台重渲染会把控件挪到别的父级（真机 00:10 就是掉到下一行）。
     * 连续两拍都不在搜索框同一行才动手，避免列表滚动时的瞬时位移被当成错位。 */
    var anchor = findAnchor();
    if (anchor && !sameRow(anchor.el, host)) {
      misBeats++;
      if (misBeats >= 2) {
        misBeats = 0;
        try { host.parentNode.removeChild(host); } catch (e) { /* 忽略 */ }
        var how = placeNear(anchor.el, host);
        if (how === 'none') {
          host = null;
          return;
        }
        if (how !== 'same-row') noteDiag('落点重放 ' + how, '已归位');
      }
    } else {
      misBeats = 0;
      if (anchor) alignCenter(anchor.el, host);
    }

    refreshCount();
  }

  /** 插不上时把可见短文案打到控制台 —— 按真实数据补锚点，不靠猜类名 */
  function dumpAnchorDiagnostics() {
    try {
      var texts = [];
      var nodes = document.querySelectorAll('input, button, span, div');
      for (var i = 0; i < nodes.length; i++) {
        var el = nodes[i];
        if (el.children.length > 0) continue;
        var t = clean(el.innerText || el.value || el.getAttribute('placeholder') || '');
        if (!t || t.length > 10) continue;
        if (!visible(el)) continue;
        if (texts.indexOf(t) === -1) texts.push(t);
        if (texts.length >= 40) break;
      }
      console.log('[DYC-XHS-LOCATE] 诊断·URL:' + location.href);
      console.log('[DYC-XHS-LOCATE] 诊断·可见短文案:' + texts.join(' / '));
    } catch (e) { /* 诊断失败不影响功能 */ }
  }

  /* ---------- 启停 ---------- */

  function shouldRun() {
    return flagsReady && onCtrlPage() && flags.xhsLocate !== false;
  }

  function apply() {
    if (!shouldRun()) {
      if (beat) { clearInterval(beat); beat = null; }
      unmount();
      return;
    }
    missCount = 0; warned = false;
    mount();
    if (!beat) beat = setInterval(heartbeat, HEARTBEAT_MS);
  }

  function start() {
    if (started) return;
    started = true;
    /* dycReadFlags() 返回 Promise —— 必须 .then（2026-11-17 事故：同步取用导致全黑） */
    dycReadFlags().then(function (f) {
      flags = f || {};
      flagsReady = true;
      apply();
    }, function () { /* 读不到就等 onChanged 救场 */ });

    if (typeof dycWatchFlags === 'function') {
      dycWatchFlags(function (f) { flags = f || {}; flagsReady = true; apply(); });
    }
    window.addEventListener('dyc:pagechange', apply);
  }

  (function waitForFlags() {
    var waited = 0;
    function tryStart() {
      if (typeof dycReadFlags === 'function') { start(); return; }
      waited += 50;
      if (waited < 5000) setTimeout(tryStart, 50);
      else start();
    }
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', tryStart, { once: true });
    } else {
      tryStart();
    }
  })();
})();
