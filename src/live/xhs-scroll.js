/**
 * 小红书中控台 · 页面滚动按钮（上滑到顶 / 下滑到底）
 * ============================================================
 * 【第三版 · 2026-11-17 夜 第二轮真机返工】
 *
 * 用户反馈四条，逐条对因：
 *   ① 按钮太小、风格与抖店不一致          → 尺寸/描边/阴影/半透明全部对齐抖店
 *   ② 点了不能上下滚，页面有两层滚动条    → 单次赋值 scrollTop 被平台回写，
 *                                            改为 rAF 自驱动画（每帧续写，压过回写）
 *   ③ 商品名压在商品 ID 上面              → 名称解开后祖先高度没跟着长（见 xhs-name-wrap）
 *   ④ 复制货号不见了                      → 本批范围外（用户定「两项」），属第二批
 *
 * 【为什么单次 scrollTop 不够（②的根因）】
 *   第一版点一次就 `scrollTop = 目标`。中控台的列表是 React 管的，
 *   程序化改 scrollTop 会触发它的滚动监听并回写状态，几次之内就被拉回原处；
 *   叠加上 `scrollTo({behavior:'smooth'})` 在这类容器上会被内部实现打断，
 *   最终表现就是「点了没反应」「有两层滚动条，不知该动哪层」。
 *   ⇒ 现在自己驱动一段 300ms 动画：每帧写一次 scrollTop，
 *     平台的回写被下一帧覆盖，落点还会补一次原生 scrollTo 兜底。
 *     同时**内外两层容器都滚**（内层商品列表为主、外层页面容器随之归位）。
 *
 * 【视觉对齐抖店（back-to-top.js）】
 *   直径 52.8、白底、1px rgba(0,0,0,.15) 描边、0 2px 8px 阴影、
 *   常态 opacity .55（hover 取消透明）、hover 背景 #f5f6f7、active #ecedee；
 *   图标沿用抖店的「细线环 + 线条箭头」，48×48、viewBox 44，hover 时环绕圈。
 *   两枚间距 8px、组底 56px ⇒ 上面那枚的 bottom 正好 116.8，与抖店完全同构。
 *
 * 【样式一律内联】上一版把样式放进 shadow 的 <style>，那条不生效时按钮就退回
 *   浏览器默认排布（两枚挤在一起、大小不一）。现在 position/尺寸/圆角/阴影
 *   全部内联；唯一需要动画的「环绕圈」用 Web Animations 实现，也不依赖样式表。
 *   普通 DOM 还有一个好处：开发者工具能直接选中。
 *
 * 【位置】默认贴右侧空白区（right 20 / 组底 56），可按住拖动，松手记住
 *   （chrome.storage.local，按 right/bottom 存，窗口缩放后仍贴右并夹在视口内）。
 *
 * 【开关】xhsScrollBtns（总闸）与 xhsBackToTop / xhsBackToBottom 是「与」关系。
 *   ★ dycReadFlags() 返回 **Promise**，必须 .then —— 第一版同步取用导致全黑。
 *
 * 【第五轮 · 2026-11-17 用户报「上下滑动按钮失效」】
 *   结构报告（debugTarget v26.11.17.1）给出两个可滚容器：
 *     外层 div.control-container  内容高 984 / 可见 849 ⇒ 只能滚 135px
 *     内层 div.goods-card-list    内容高 3653 / 可见 672 ⇒ 可滚 2981px
 *   用户的「上下滑」指的是内层商品列表，而旧实现只在首次 bind 扫一遍容器、
 *   存成快照：中控台先出页面外壳、19 张商品卡后到并被 React 反复换节点，
 *   快照一旦过期，点按钮要么只把外层滚 135px（看着像没动），
 *   要么目标节点已脱连 → animateTo 首帧直接静默 return（点了毫无反应）。
 *   ⇒ 现在：① 每次点击**先重扫**再滚；② 落点用「可滚距离最大」的容器做校验，
 *     被平台改回或节点换掉就重扫补滚一次；③ 仍旧滚不动就报一条三段式消息，
 *     **不许静默失效**。
 * ============================================================
 */
(function () {
  'use strict';

  var HOST_ID = 'dyb-xhs-scroll';
  var POS_KEY = 'dybXhsScrollPos';
  var BTN = 52.8;               // 直径（固定 px，对齐抖店 BTN_SIZE）
  var GAP = 8;                  // 两枚之间（抖店 116.8 - 56 - 52.8 = 8）
  /* 2026-11-17 第四轮：用户要求「浮动按钮可以距离浏览器边界有一段距离」。
   * 中控台右侧从 .control-container(1440) 到视口右(1707) 有 267px 空白，
   * 贴 20px 会紧挨滚动条与窗口边缘；内收到 72px 落在空白区中段，观感更松。 */
  var DEF_RIGHT = 72;           // 默认距视口右
  var DEF_BOTTOM = 56;          // 组底距视口底（抖店下面那枚 56px）
  var MIN_AREA_RATIO = 0.05;    // 可滚容器的最小可见面积（占视口）
  var DRAG_THRESHOLD = 5;       // 超过这个位移算拖动，不算点击
  var SCROLL_MS = 300;          // 自驱动画时长

  /* 图标与抖店同构：细线环 + 线条箭头，48×48 显示在 52.8px 按钮内 */
  function iconSvg(down) {
    /* ★ 箭头 = 抖店原 path 原样（back-to-top.js BUTTON_SVG）：
     *   画布 44、translate(12 12) 把 20×20 造型平移到中心，
     *   杆 M10 16V5 长 11、头 ±5.5，stroke #333 宽 2 圆角 —— 上箭头逐字照抄；
     *   下箭头按同一造型的垂直翻转（V5↔V16、斜边反向），粗细圆角完全一致。 */
    var arrow = down
      ? '<g transform="translate(12 12)"><path d="M10 5V16M10 16l-5.5-5.5M10 16l5.5-5.5" '
        + 'stroke="#333" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/></g>'
      : '<g transform="translate(12 12)"><path d="M10 16V5M10 5l-5.5 5.5M10 5l5.5 5.5" '
        + 'stroke="#333" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/></g>';
    return '<svg width="48" height="48" viewBox="0 0 44 44" aria-hidden="true">'
      /* 细线环平时**不显示**，悬停淡入并绕圈 —— 对齐抖店
       * （back-to-top.js: .dyc-btt-ring{opacity:0; transition:opacity .2s}，
       *   :hover 时 opacity 1 + 变速绕圈 keyframes）。 */
      + '<circle data-role="ring" cx="22" cy="22" r="20.5" pathLength="100" fill="none" '
      + 'stroke="rgba(51,51,51,.8)" stroke-width="1.5" stroke-linecap="round" '
      + 'stroke-dasharray="25 75" stroke-dashoffset="0" transform="rotate(-90 22 22)" '
      + 'opacity="0"/>'
      + arrow
      + '</svg>';
  }

  var host = null;
  var btnUp = null;
  var btnDown = null;
  var scrollers = [];
  var flags = {};
  var flagsReady = false;
  var started = false;
  var watching = false;
  var rafPending = false;
  var recollectTimer = null;
  var mo = null;
  var suppressClick = false;
  var animRafs = [];

  /* ---------- 页面判定 ---------- */
  function onCtrlPage() {
    try {
      var pat = window.DYC_PAGE_PATTERNS;
      return !!(pat && pat.xhsCtrl && pat.xhsCtrl.test(location.href));
    } catch (e) { return false; }
  }

  /* ---------- 可滚容器 ---------- */
  function scrollableBy(el) {
    if (!el || el.nodeType !== 1) return false;
    if (el.id === HOST_ID) return false;
    if (el.clientHeight < 120) return false;                   // 太矮，不是主滚动区
    if (el.scrollHeight - el.clientHeight <= 4) return false;   // 没溢出
    var cs;
    try { cs = getComputedStyle(el); } catch (e) { return false; }
    var oy = cs.overflowY;
    if (oy !== 'auto' && oy !== 'scroll' && oy !== 'overlay') return false;
    return true;
  }

  function collectScrollers() {
    var out = [];
    var doc = document.scrollingElement || document.documentElement;
    if (doc && doc.scrollHeight - doc.clientHeight > 4) out.push(doc);

    var minArea = window.innerWidth * window.innerHeight * MIN_AREA_RATIO;
    var all = document.querySelectorAll('div,section,main,article,ul,ol');
    for (var i = 0; i < all.length; i++) {
      var el = all[i];
      if (el === doc) continue;
      /* 先用两个便宜判据筛掉绝大多数（9000+ 元素里真正可滚的只有个位数），
       * 再对幸存者读 computedStyle。 */
      if (el.clientWidth * el.clientHeight < minArea) continue;
      if (!scrollableBy(el)) continue;
      out.push(el);
    }
    return out;
  }

  function maxTop(el) { return Math.max(0, el.scrollHeight - el.clientHeight); }
  /* 注：原 atTopOf / atBottomOf 已随「两枚常显」一起删除 ——
   * 保留会让人以为还在按顶/底隐显（2026-11-17 第四轮用户定）。 */

  /* ---------- 自驱动画（核心：对抗平台回写） ---------- */
  function cancelAnims() {
    for (var i = 0; i < animRafs.length; i++) {
      try { cancelAnimationFrame(animRafs[i]); } catch (e) {}
    }
    animRafs = [];
  }

  function animateTo(el, target) {
    var start = el.scrollTop;
    if (Math.abs(target - start) < 1) return;
    var span = target - start;
    var t0 = 0;
    function step(ts) {
      if (!el.isConnected) return;
      if (!t0) t0 = ts;
      var p = Math.min(1, (ts - t0) / SCROLL_MS);
      var ease = 1 - Math.pow(1 - p, 3);       // easeOutCubic
      try { el.scrollTop = start + span * ease; } catch (e) { return; }
      if (p < 1) {
        animRafs.push(requestAnimationFrame(step));
        return;
      }
      /* 落点校准：平台若在最后一帧又把值写回去，再压一次 */
      try { el.scrollTop = target; } catch (e) {}
      if (Math.abs(el.scrollTop - target) > 4) {
        try { el.scrollTo(0, target); } catch (e2) {}
      }
    }
    animRafs.push(requestAnimationFrame(step));
  }

  /* 主目标 = 可滚距离最大的容器。外层 .control-container 只有 135px，
   * 商品列表 2981px，取 maxTop 最大者即可无歧义选中「用户真正在看的那一列」。 */
  function scrollTarget() {
    var doc = document.scrollingElement || document.documentElement;
    var best = null;
    var bestTop = 0;
    for (var i = 0; i < scrollers.length; i++) {
      var el = scrollers[i];
      if (el === doc) continue;
      var mt = maxTop(el);
      if (mt > bestTop) { bestTop = mt; best = el; }
    }
    if (best) return best;
    return (doc && maxTop(doc) > 4) ? doc : null;
  }

  function describeEl(el) {
    if (!el || el.nodeType !== 1) return '未知容器';
    if (el === (document.scrollingElement || document.documentElement)) return '整页';
    var cls = (typeof el.className === 'string' && el.className.trim())
      ? el.className.trim().split(/\s+/)[0]
      : el.tagName.toLowerCase();
    return '.' + cls;
  }

  var lastStuckAt = 0;
  /* 只报失败：一次成功的滚动不该留消息（连点两下更不该两条）。
   * 三段式：来源「滚动按钮」｜值「.goods-card-list」｜结果「未滚到底」。 */
  function reportStuck(el, toBottom) {
    var now = Date.now();
    if (now - lastStuckAt < 1500) return;
    lastStuckAt = now;
    if (typeof setStatus !== 'function') return;
    try {
      setStatus(describeEl(el), 'warning', {
        source: '滚动按钮',
        count: toBottom ? '未滚到底' : '未回到顶',
        full: '目标 ' + describeEl(el) + ' 的 scrollTop 被改回（可滚 '
          + maxTop(el) + 'px）。多为列表正在刷新或容器刚被换节点，稍等再点一次。'
      });
    } catch (e) { /* 消息盒子不可用时不影响滚动本身 */ }
  }

  /* 落点校验：动画走完后确认「主目标」真的到位。
   * 没到位 ⇒ 先硬写一次；还不行多半是节点已被 React 换掉，重扫后对新节点
   * 再滚一次；第三次仍不动才报人话（平台回写 / 列表锁定）。 */
  function verifyLanding(want, retried) {
    var target = scrollTarget();
    if (!target) return;                       // 已无滚动区，按钮也随之隐藏，不必打扰
    var goal = want ? maxTop(target) : 0;
    if (target.isConnected && Math.abs(target.scrollTop - goal) <= 8) return;

    if (target.isConnected) {
      try { target.scrollTop = goal; } catch (e) {}
      if (Math.abs(target.scrollTop - goal) <= 8) return;
    }
    if (!retried) {
      recollect();                             // 快照可能指向已脱连的旧节点
      var next = scrollTarget();
      if (next && next !== target) {
        animateTo(next, want ? maxTop(next) : 0);
        setTimeout(function () { verifyLanding(want, true); }, SCROLL_MS + 70);
        return;
      }
    }
    reportStuck(target, want);
  }

  function scrollListTo(toBottom) {
    cancelAnims();
    /* ★ 点击时重扫：不用首次 bind 的死快照 ——
     *   中控台先出页面外壳、19 张商品卡后到且会被 React 换节点。 */
    recollect();
    /* 从内到外：先让商品列表走，再让外层页面容器归位。
     * 反过来的话外层位移会把内层的可视基准一起带走，看起来像「跳了一下」。 */
    var ordered = scrollers.slice().reverse();
    for (var i = 0; i < ordered.length; i++) {
      var el = ordered[i];
      animateTo(el, toBottom ? maxTop(el) : 0);
    }
    if (!toBottom) {
      try { if (window.scrollY > 0) window.scrollTo({ top: 0, behavior: 'smooth' }); } catch (e) {}
    }
    setTimeout(function () { verifyLanding(toBottom, false); }, SCROLL_MS + 70);
  }

  function chainStale() {
    var doc = document.scrollingElement || document.documentElement;
    for (var i = 0; i < scrollers.length; i++) {
      var el = scrollers[i];
      if (el === doc) continue;
      if (!el.isConnected) return true;
    }
    return false;
  }

  /* ---------- 位置 ---------- */
  function applyRightBottom(right, bottom) {
    if (!host) return;
    host.style.right = right + 'px';
    host.style.bottom = bottom + 'px';
    host.style.left = 'auto';
    host.style.top = 'auto';
  }

  function applyLeftTop(left, top) {
    if (!host) return;
    var w = host.offsetWidth || BTN;
    var h = host.offsetHeight || (BTN * 2 + GAP);
    var maxL = Math.max(0, window.innerWidth - w);
    var maxT = Math.max(0, window.innerHeight - h);
    host.style.left = Math.min(Math.max(0, left), maxL) + 'px';
    host.style.top = Math.min(Math.max(0, top), maxT) + 'px';
    host.style.right = 'auto';
    host.style.bottom = 'auto';
  }

  function savePos() {
    try {
      var r = host.getBoundingClientRect();
      var patch = {};
      patch[POS_KEY] = {
        right: Math.round(window.innerWidth - (r.left + r.width)),
        bottom: Math.round(window.innerHeight - (r.top + r.height))
      };
      if (window.chrome && chrome.storage && chrome.storage.local) {
        chrome.storage.local.set(patch);
      }
    } catch (e) { /* 存不下就下次仍用默认位置 */ }
  }

  function restorePos() {
    try {
      if (!(window.chrome && chrome.storage && chrome.storage.local)) return;
      chrome.storage.local.get(POS_KEY, function (r) {
        var p = r && r[POS_KEY];
        if (!p || typeof p.right !== 'number' || typeof p.bottom !== 'number') return;
        if (!host || !host.isConnected) return;
        var keep = 64;
        applyRightBottom(
          Math.max(0, Math.min(p.right, window.innerWidth - keep)),
          Math.max(0, Math.min(p.bottom, window.innerHeight - keep))
        );
      });
    } catch (e) { /* 忽略 */ }
  }

  /* ---------- 拖动 ---------- */
  function bindDrag(btn) {
    var pid = null, sx = 0, sy = 0, sl = 0, st = 0, dragging = false;

    btn.addEventListener('pointerdown', function (ev) {
      if (ev.button !== undefined && ev.button !== 0) return;
      suppressClick = false;
      dragging = false;
      pid = (ev.pointerId === undefined) ? 'mouse' : ev.pointerId;
      sx = ev.clientX; sy = ev.clientY;
      var r = host.getBoundingClientRect();
      sl = r.left; st = r.top;
      try {
        if (btn.setPointerCapture && ev.pointerId !== undefined) btn.setPointerCapture(ev.pointerId);
      } catch (e) { /* 忽略 */ }
    });

    btn.addEventListener('pointermove', function (ev) {
      if (pid === null) return;
      var dx = ev.clientX - sx;
      var dy = ev.clientY - sy;
      if (!dragging) {
        if (Math.abs(dx) + Math.abs(dy) < DRAG_THRESHOLD) return;
        dragging = true;
      }
      applyLeftTop(sl + dx, st + dy);
      ev.preventDefault();
    });

    function end() {
      if (pid === null) return;
      pid = null;
      if (dragging) {
        suppressClick = true;   // 拖动结束不要顺带触发一次滚动
        savePos();
      }
    }
    btn.addEventListener('pointerup', end);
    btn.addEventListener('pointercancel', end);
  }

  /* ---------- 按钮（全内联样式，视觉对齐抖店） ---------- */
  function styleBtn(el, label, down) {
    el.type = 'button';
    el.setAttribute('aria-label', label);
    el.innerHTML = iconSvg(down);

    var s = el.style;
    s.position = 'relative';
    s.width = BTN + 'px';
    s.height = BTN + 'px';
    s.flex = '0 0 ' + BTN + 'px';           // 防 flex 压缩：两枚尺寸必须一致
    s.boxSizing = 'border-box';
    s.borderRadius = '50%';
    s.background = '#ffffff';
    s.border = '1px solid rgba(0,0,0,.15)';
    s.boxShadow = '0 2px 8px rgba(0,0,0,.18)';
    s.display = 'flex';
    s.alignItems = 'center';
    s.justifyContent = 'center';
    s.padding = '0';
    s.margin = '0';
    s.cursor = 'pointer';
    s.pointerEvents = 'auto';
    s.userSelect = 'none';
    s.outline = 'none';
    s.opacity = '.55';                       // 抖店口径：常态半透明
    s.transition = 'opacity .2s ease-out, transform .2s ease-out, background .12s ease';

    /* 悬停气泡：抖店是黑底小字，这里用内联 div（不依赖 ::after 样式） */
    var tip = document.createElement('div');
    tip.textContent = label;
    tip.style.cssText = 'position:absolute;left:50%;transform:translateX(-50%);'
      + 'background:rgba(20,20,20,.92);color:#fff;font-size:12.5px;'
      + 'padding:6px 10px;border-radius:6px;white-space:nowrap;'
      + 'opacity:0;pointer-events:none;transition:opacity .15s ease;'
      + (down ? 'top:calc(100% + 10px);' : 'bottom:calc(100% + 10px);');
    el.appendChild(tip);

    var ringAnim = null;
    el.addEventListener('mouseenter', function () {
      el.style.opacity = '1';
      el.style.background = '#f5f6f7';
      tip.style.opacity = '1';
      /* 环淡入 + 绕圈。节奏对齐抖店 keyframes：2.6s 一圈、匀速无限循环。 */
      var ring = el.querySelector('[data-role="ring"]');
      if (ring) {
        ring.style.opacity = '1';
        if (ring.animate) {
          try {
            ringAnim = ring.animate(
              [{ strokeDashoffset: 0 }, { strokeDashoffset: -100 }],
              { duration: 2600, iterations: Infinity, easing: 'linear' }
            );
          } catch (e) { ringAnim = null; }
        }
      }
    });
    el.addEventListener('mouseleave', function () {
      el.style.opacity = '.55';
      el.style.background = '#ffffff';
      tip.style.opacity = '0';
      var ring = el.querySelector('[data-role="ring"]');
      if (ring) ring.style.opacity = '0';    // 环淡出：对齐抖店 :hover 才可见
      if (ringAnim) { try { ringAnim.cancel(); } catch (e) {} ringAnim = null; }
    });
    el.addEventListener('mousedown', function () { el.style.background = '#ecedee'; });
    el.addEventListener('mouseup', function () { el.style.background = '#f5f6f7'; });
    return el;
  }

  function ensureHost() {
    if (host && host.isConnected) return true;
    host = document.getElementById(HOST_ID);
    if (!host) {
      host = document.createElement('div');
      host.id = HOST_ID;
      host.className = 'dyc-xhs-scroll';
      host.setAttribute('data-dyc-skip', '1');
      var s = host.style;
      s.position = 'fixed';
      s.display = 'flex';
      s.flexDirection = 'column';
      s.gap = GAP + 'px';
      s.zIndex = '2147483000';
      s.pointerEvents = 'none';     // 只有按钮自己接收事件
      s.boxSizing = 'border-box';
      s.margin = '0';
      s.padding = '0';

      btnUp = styleBtn(document.createElement('button'), '上滑到顶', false);
      btnDown = styleBtn(document.createElement('button'), '下滑到底', true);
      btnUp.setAttribute('data-role', 'up');
      btnDown.setAttribute('data-role', 'down');

      btnUp.addEventListener('click', function (ev) {
        ev.preventDefault();
        ev.stopPropagation();
        if (suppressClick) { suppressClick = false; return; }
        scrollListTo(false);
        setTimeout(paint, SCROLL_MS + 60);
      });
      btnDown.addEventListener('click', function (ev) {
        ev.preventDefault();
        ev.stopPropagation();
        if (suppressClick) { suppressClick = false; return; }
        scrollListTo(true);
        setTimeout(paint, SCROLL_MS + 60);
      });
      bindDrag(btnUp);
      bindDrag(btnDown);

      host.appendChild(btnUp);
      host.appendChild(btnDown);
      (document.body || document.documentElement).appendChild(host);
      applyRightBottom(DEF_RIGHT, DEF_BOTTOM);
      restorePos();
    } else {
      btnUp = host.querySelector('[data-role="up"]');
      btnDown = host.querySelector('[data-role="down"]');
    }
    return !!(btnUp && btnDown);
  }

  /* ---------- 显隐 ---------- */
  function enabledFor(which) {
    if (flags.xhsScrollBtns === false) return false;
    return which === 'up' ? flags.xhsBackToTop !== false : flags.xhsBackToBottom !== false;
  }

  function paint() {
    if (!btnUp || !btnDown) return;
    if (chainStale()) scheduleRecollect();
    /* ★ 2026-11-17 第四轮（用户定）：两枚**同时常显**。
     *   旧口径是「在顶藏上滑、到底藏下滑」—— 用户看到的是一枚按钮忽隐忽现，
     *   还以为另一枚没渲染出来（诊断里宿主只有 53px 高就是被藏掉一枚）。
     *   现在只受「页面是否可滚」与各自子开关控制；到顶/到底点一下也无副作用。 */
    var canScroll = scrollers.length > 0;
    var showUp = canScroll && enabledFor('up');
    var showDown = canScroll && enabledFor('down');
    btnUp.style.display = showUp ? 'flex' : 'none';
    btnDown.style.display = showDown ? 'flex' : 'none';
    if (host) host.style.display = (showUp || showDown) ? 'flex' : 'none';
  }

  function schedulepaint() {
    if (rafPending) return;
    rafPending = true;
    (window.requestAnimationFrame || function (fn) { setTimeout(fn, 16); })(function () {
      rafPending = false;
      paint();
    });
  }

  function recollect() {
    scrollers = collectScrollers();
    paint();
  }

  function scheduleRecollect() {
    if (recollectTimer) return;
    recollectTimer = setTimeout(function () {
      recollectTimer = null;
      recollect();
    }, 800);
  }

  function bind() {
    if (watching) return;
    watching = true;
    window.addEventListener('scroll', schedulepaint, { capture: true, passive: true });
    window.addEventListener('resize', scheduleRecollect, { passive: true });
    if (typeof MutationObserver === 'function') {
      /* 只在「找不到可滚容器」或「原容器已脱离文档」时重扫：9000+ 元素页面
       * 无条件重扫等于持续全页样式计算。 */
      mo = new MutationObserver(function () {
        if (!scrollers.length || chainStale()) scheduleRecollect();
      });
      try { mo.observe(document.body, { childList: true, subtree: true }); } catch (e) { mo = null; }
    }
    recollect();
  }

  function unbind() {
    if (!watching) return;
    watching = false;
    cancelAnims();
    window.removeEventListener('scroll', schedulepaint, { capture: true, passive: true });
    window.removeEventListener('resize', scheduleRecollect, { passive: true });
    if (mo) { try { mo.disconnect(); } catch (e) {} mo = null; }
    if (recollectTimer) { clearTimeout(recollectTimer); recollectTimer = null; }
  }

  function removeHost() {
    cancelAnims();
    if (host && host.parentNode) host.parentNode.removeChild(host);
    host = null; btnUp = null; btnDown = null;
    scrollers = [];
  }

  function apply() {
    var shouldRun = flagsReady && onCtrlPage() && (flags.xhsScrollBtns !== false);
    if (!shouldRun) { unbind(); removeHost(); return; }
    if (!ensureHost()) return;
    bind();
    paint();
  }

  function start() {
    if (started) return;
    started = true;
    /* dycReadFlags() 返回 Promise —— 必须 .then（2026-11-17 事故：同步取用导致全黑） */
    dycReadFlags().then(function (f) {
      flags = f || {};
      flagsReady = true;
      apply();
    }, function () { /* 读不到就保持空白，等 onChanged 救场 */ });

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
