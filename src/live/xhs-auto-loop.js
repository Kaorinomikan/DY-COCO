/**
 * 小红书中控台 · 循环讲解。
 * 复用抖店循环的间隔、倒计时、无限等待、换品跟随、与后台拍点。
 * 只弹有「结束讲解」证据的商品，15 秒冷却内不点，绝不自动开讲或结束讲解。
 * 成功凭据：点击后同一商品的弹卡按钮进入平台冷却；无反馈或被拒绝不计数。
 */
(function () {
  'use strict';

  /* 防重复注入（SPA 路由回切 / 脚本意外重跑） */
  if (window.__dycXhsAutoLoopLoaded) return;
  window.__dycXhsAutoLoopLoaded = true;

  /* ==========================================================
   * 一、常量（铁律 24：全部声明在最早调用点之前）
   * ========================================================== */

  var BOX_ID = 'dyc-xhs-loop';
  var MAIN_ID = 'dyc-xhs-loop-main';
  var PANEL_ID = 'dyc-xhs-loop-panel';
  var STYLE_ID = 'dyc-xhs-loop-style';

  var SOURCE = '循环讲解';                    // 三段式来源词

  /* 档位：用户 2026-11-18 定，四档，下限锁死 15 秒、默认 30 秒。
   * 这不是"一个量程的四个刻度"，而是四种节奏，点之前就该知道差别。 */
  var TIERS = [15, 30, 45, 60];
  var TIER_DEF = 30;

  /* 小红书秒档 = 设定值 + 每轮随机 0～3 秒，平台按钮冷却另设硬闸。 */
  var POP_MIN_MS = 15000;

  /* 观察平台是否进入弹卡冷却，仍在讲解本身不算成功凭据。 */
  var POP_VERIFY_MS = 1400;

  var TICK_MS = 1000;                         // 拍子：只读 DOM，便宜
  var HEARTBEAT_MS = 1000;                    // 控件落点自愈
  var WARN_AFTER = 6;                         // 插不上 6 秒就报一次人话

  var TIER_KEY = 'dybXhsLoopTier';
  var AUTO_KEY = 'dybXhsLoopAuto';
  var POP_AT_KEY = 'dybXhsPopAt';             // 上次成功弹卡的时间戳（跨刷新）

  /* 卡片与按钮的选择器：结构报告实测（2026-11-18，pgy 中控台）。
   * action-row 里四枚按钮，其中一枚是 div 而非 button ⇒ 用 [class*=] 覆盖两种。 */
  var CARD_SEL = '.goods-card';
  var LIST_SEL = '.goods-card-list';          // 认卡的范围边界（讲解区里也有 .goods-card）
  var ACTION_SEL = '[class*="goods-card__action-btn"]';
  var TITLE_SEL = '.goods-card__title-block';
  var DETAIL_SEL = '.living-detail-container';

  var STOP_TEXTS = ['结束讲解'];
  var START_TEXTS = ['讲解', '开始讲解'];
  /* ★ 2026-11-18 真机结构报告 + 诊断轨迹给出的事实：
   *   讲解中的卡片动作行 = 下架 / 置顶 / **弹卡(52×28)** / 结束讲解(80×28)。
   *   「弹卡」就是平台自己的按钮名，不是"再点一次讲解"。
   *   未讲解的卡片才是 下架 / 置顶 / 讲解。
   *   上一版按"点讲解即重弹卡"实现，于是在讲解中的卡上永远找不到「讲解」——
   *   诊断里那句「在讲但没『讲解』｜卡内: 下架/置顶/弹卡/结束讲解」就是证据。
   *   正则兜底「弹 X 卡」的变体（弹卡片 / 弹一下卡），不穷举整串。 */
  /* ★ 2026-11-18 第二次事故：原来用「$」锚定结尾，只认「弹卡」两个字。
   *   真机上点过一次之后，平台会把按钮改成「弹卡中 / 弹卡(15s)」这类冷却文案，
   *   于是 findPopBtn 再也认不出来 —— 表现就是"只弹了一次，之后再也不动"。
   *   ⇒ 只锚定**开头**：「弹…卡」后面允许带状态尾巴，不做结尾约束。
   *   kindOfText 本身有 ≤12 字上限，不会把商品名当成按钮。 */
  var POP_RE = /^弹[\s\S]{0,3}卡|^(?:重新)?(?:弹出|弹起)讲解卡(?:片)?$/;

  /* 平台限频的 toast 文案特征。
   *
   * ★ 2026-11-18 事故：原来是 /…|稍后|稍候|…/ —— 「稍后」「稍候」**单独出现**
   *   也算命中。页面上一旦有常驻元素带这两个字（"稍后发货""稍后处理"），
   *   或者平台弹一条普通提示，scanRateLimitToast 就每秒把冷却重置成"现在"，
   *   coolLeft 永远 > 0 ⇒ 只弹了第一次就再也不动。
   *   ⇒ 现在只认完整的限频语境（必须带"频繁 / 太快 / 再试 / 请勿重复"），
   *     并且加 12 秒时间窗（见 scanRateLimitToast）：平台报错必然紧随点击，
   *     弹卡过去很久之后还在扫全页既无意义、也最容易误伤。 */
  var RATE_LIMIT_RE = /频繁|太快|过快|请稍后再试|稍后再试|稍候再试|秒后再试|请勿重复/;
  var RATE_WINDOW_MS = 12000;

  /* ==========================================================
   * 二、状态
   * ========================================================== */

  var flags = {};
  var flagsReady = false;
  var started = false;

  var tier = TIER_DEF;          // 秒
  var autoOn = false;           // 自动循环总开关
  var lastPopAt = 0;            // 上次成功弹卡（或平台报错）的时刻
  var rounds = 0;               // 本次会话已弹次数
  var busy = false;             // 正在执行一次弹卡
  var panelOpen = false;

  var boxEl = null;
  var mainEl = null;
  var statusEl = null;
  var panelEl = null;
  var searchAnchor = null;
  var positionFrame = null;

  var missCount = 0;
  var warned = false;
  var lastNoteAt = 0;
  var lastWarnAt = 0;
  var lastDiagNoBtn = 0;
  var lastSkipKey = '';
  var lastSkipAt = 0;
  var tickTimer = null;
  var beatTimer = null;
  var storedPopAt = 0;          // 从 storage 读回的冷却起点（跨刷新）
  var lastLectureKey = '';      // 当前在讲的是哪个商品（换品要重置冷却）
  var nextAt = 0;
  var pendingPop = null;
  var failures = 0;
  var infinite = true;
  var mode = 'sec';
  var minutes = 5;
  var beatOn = false;
  var beatStatus = '未注册';
  var lastTickAt = 0;
  var lastFeedback = '';
  var seenToasts = new WeakMap();
  var platformWaitUntil = 0;
  var offAir = false;

  /* ==========================================================
   * 三、小工具
   * ========================================================== */

  function $(sel, root) {
    try { return (root || document).querySelector(sel); } catch (e) { return null; }
  }

  function $$(sel, root) {
    try { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
    catch (e) { return []; }
  }

  function clean(s) {
    return String(s == null ? '' : s)
      .replace(/[\u200B-\u200F\u202A-\u202E\u2060-\u2064\uFEFF]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function textWithoutExt(el) {
    if (!el || inOwnUI(el)) return '';
    var out = '';
    for (var n = el.firstChild; n; n = n.nextSibling) {
      if (n.nodeType === 3) out += n.nodeValue;
      else if (n.nodeType === 1 && !inOwnUI(n)) out += textWithoutExt(n);
    }
    return out;
  }
  function txt(el) { return clean(textWithoutExt(el)); }

  function visible(el) {
    if (!el || el.nodeType !== 1) return false;
    var r;
    try { r = el.getBoundingClientRect(); } catch (e) { return false; }
    return r.width > 0 && r.height > 0;
  }

  function inOwnUI(el) {
    var n = el;
    for (var i = 0; i < 12 && n; i++) {
      if (n.id === BOX_ID || n.id === 'dyb-debug-panel' || n.id === 'dyb-status-bar') return true;
      if (n.getAttribute && n.getAttribute('data-dyc-skip') !== null) return true;
      n = n.parentNode;
    }
    return false;
  }

  function onCtrlPage() {
    try {
      var pat = window.DYC_PAGE_PATTERNS;
      return !!(pat && pat.xhsCtrl && pat.xhsCtrl.test(location.href));
    } catch (e) { return false; }
  }

  function detectOffAir() {
    // 报告只给出文字和「立即开播」按钮，限定中控台并剪掉商品/评论/扩展子树。
    var root = $('.control-container') || document.body;
    if (!root) return false;
    var walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT, {
      acceptNode: function (el) {
        if (inOwnUI(el) || el.matches('.goods-card-list,.goods-card,.comment-list,.d-modal,.d-drawer,[role="dialog"],script,style')) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    var el;
    while ((el = walker.nextNode())) {
      var label = '';
      if (!el.childElementCount || el.tagName === 'BUTTON' || el.getAttribute('role') === 'button') label = txt(el);
      var startButton = label === '立即开播' && (el.tagName === 'BUTTON' || el.getAttribute('role') === 'button');
      if ((label === '未开播' || startButton) && visible(el)) return true;
    }
    return false;
  }

  function refreshBroadcast() {
    offAir = detectOffAir();
    if (offAir) {
      nextAt = 0; platformWaitUntil = 0; lastLectureKey = '';
      pendingPop = null; busy = false; liveCache = false; liveAt = 0;
    }
    updateBeat();
    return offAir;
  }

  function say(message, type, opts) {
    try {
      if (typeof setStatus === 'function') {
        setStatus(message, type, Object.assign({ source: SOURCE }, opts || {}));
      }
    } catch (e) { /* 消息盒子不可用不影响循环本身 */ }
  }

  function noteDiag(detail, result) {
    try {
      var d = window.__dycDiag;
      if (d && typeof d.note === 'function') d.note(SOURCE, detail, result);
    } catch (e) { /* 诊断失败不许影响功能 */ }
  }

  /* ==========================================================
   * 四、按钮态（照搬抖店四态分类，文案按小红书实测收敛）
   * ========================================================== */

  function kindOfText(t) {
    var s = String(t == null ? '' : t).replace(/\s+/g, '');
    if (!s || s.length > 12) return '';
    /* pop 先判：「弹卡」不含"讲解"字样，但「弹出讲解卡」含 —— 必须先归 pop，
     * 否则会被下面的 start 吃掉，变成"点它开始讲解"这种错解。 */
    if (POP_RE.test(s)) return 'pop';
    if (STOP_TEXTS.indexOf(s) >= 0) return 'stop';
    if (START_TEXTS.indexOf(s) >= 0) return 'start';
    return '';
  }

  function kindOf(el) { return el ? kindOfText(txt(el)) : ''; }

  /** 尺寸闸 + 可见 + 可点：认得出文案但尺寸不像按钮的，一律不算 */
  function looksLikeBtn(el) {
    if (!el || !el.getBoundingClientRect) return false;
    var r;
    try { r = el.getBoundingClientRect(); } catch (e) { return false; }
    if (r.width < 18 || r.width > 220) return false;
    if (r.height < 12 || r.height > 64) return false;
    return true;
  }

  /** 商品列表容器；取不到时退回 document（宁可宽一点，也别整块不工作） */
  function listRoot() { return $(LIST_SEL) || document; }

  /**
   * 找「结束讲解」—— 全页唯一的"正在讲解"证据（用户 2026-11-18 确认）。
   * 只扫两类候选：卡片动作行 与 下方讲解区。不扫全页 ——
   * 页面约 11790 个元素，每秒全扫一遍纯属浪费，而这两处已覆盖实测的全部形态。
   */
  function findStopBtn() {
    var cands = $$(ACTION_SEL + ',' + DETAIL_SEL + ' button,' + DETAIL_SEL + ' [role="button"]');
    for (var i = 0; i < cands.length; i++) {
      var el = cands[i];
      if (kindOf(el) !== 'stop') continue;
      if (!visible(el) || !looksLikeBtn(el)) continue;
      if (inOwnUI(el)) continue;
      return el;
    }
    return null;
  }

  /** 在讲 = 页面上存在「结束讲解」 */
  function inLecture() { return !!findStopBtn(); }

  /* ★ 绘图层用的 400ms 缓存。
   *   findStopBtn 要过一遍 600+ 枚动作按钮（162 张卡 × 4），
   *   而「拍子 / 心跳 / 点一次」都可能各自调一次 paint ——
   *   同一份查询一秒跑四遍是纯浪费。400ms 内状态不可能翻两次（平台冷却 15 秒）。
   *   注意：**真正要动手之前（popOnce）不吃缓存**，宁可多查一次也不点错卡。 */
  var liveCache = false;
  var liveAt = 0;
  function liveNow() {
    var t = Date.now();
    if (t - liveAt < 400) return liveCache;
    liveAt = t;
    liveCache = inLecture();
    return liveCache;
  }

  /** 当前在讲的那张卡；找不到返回 null（宁可不点，也不点错卡） */
  function currentCard() {
    var stop = findStopBtn();
    if (!stop) return null;
    var list = listRoot();

    /* ① 结束讲解就在**列表**某张卡里 ⇒ 直接上溯。
     *
     * ★ 2026-11-18 真机事故：这里原来不限定列表范围。
     *   下方讲解区里那张"讲解卡"同样带着 .goods-card 类，
     *   stop.closest('.goods-card') 先命中了它 —— 于是手里拿的是一张
     *   **只有「结束讲解」、没有「弹卡」** 的卡，findPopBtn 永远返回空。
     *   表现就是诊断里那句「在讲但卡上没找到讲解按钮」，点【弹卡】毫无反应。
     *   ⇒ 认卡必须限定在商品列表容器内；列表找不到就走名字匹配。 */
    if (stop.closest) {
      var own = stop.closest(CARD_SEL);
      if (own && list !== document && list.contains(own)) return own;
    }

    /* ② 它在下方讲解区 ⇒ 按商品名回列表里找那张卡。
     *    只认「标题包含于讲解区文本」，不按位次猜 —— 猜错就是替用户弹了别的品。 */
    var detail = $(DETAIL_SEL);
    if (!detail || !detail.contains(stop) || list === document) return null;
    var dtext = txt(detail);
    if (!dtext) return null;
    var cards = $$(CARD_SEL, list);
    var best = null;
    for (var i = 0; i < cards.length; i++) {
      var name = cardTitle(cards[i]);
      /* 标题太短的不参与匹配：2 个字在讲解区里太容易撞上（"女装""上衣"） */
      if (name.length < 3) continue;
      /* 完整标题唯一匹配；截断或重名时等待平台恢复明确身份。 */
      if (dtext.indexOf(name) >= 0) {
        if (best) return null; // 同名商品无法确定身份，不按顺序猜。
        best = cards[i];
      }
    }
    return best;
  }

  /** 卡内「弹卡」按钮 —— 本功能唯一要点的东西（真机 2026-11-18 实测文案） */
  function findPopBtn(card) {
    if (!card) return null;
    var cands = $$(ACTION_SEL + ',button,[role="button"]', card);
    var hit = null;
    for (var i = 0; i < cands.length; i++) {
      var el = cands[i];
      if (kindOf(el) !== 'pop') continue;
      if (!visible(el) || !looksLikeBtn(el)) continue;
      if (inOwnUI(el)) continue;
      if (isDisabled(el)) continue;                        // 冷却中平台会置灰
      if (platformCooling(el)) continue;
      if (!hit || el.contains(hit) === false) hit = el;     // 取最内层
    }
    return hit;
  }

  function platformCooling(el) {
    return !!(el && kindOf(el) === 'pop' && /[（(]\s*\d+(?:\.\d+)?\s*(?:秒|s)?\s*[）)]|弹卡中/i.test(txt(el)));
  }

  function cardKey(card) {
    if (!card) return '';
    var link = $('a[href]', card);
    return card.getAttribute('data-goods-id') || card.getAttribute('data-id')
      || (link && link.getAttribute('href')) || txt($(TITLE_SEL, card));
  }

  function intervalMs() {
    return mode === 'min' ? minutes * 60000 : (tier + Math.floor(Math.random() * 4)) * 1000;
  }

  function remaining() { return Math.max(coolLeft(), nextAt ? nextAt - Date.now() : 0, platformWaitUntil - Date.now(), 0); }

  function syncPlatformCooldown() {
    platformWaitUntil = 0;
    var card = currentCard();
    if (!card) return;
    $$(ACTION_SEL + ',button,[role="button"]', card).some(function (el) {
      if (kindOf(el) !== 'pop' || inOwnUI(el)) return false;
      var m = txt(el).match(/[（(]\s*(\d+(?:\.\d+)?)\s*(?:秒|s)?\s*[）)]/i);
      if (m) platformWaitUntil = Date.now() + Number(m[1]) * 1000;
      return !!m;
    });
  }

  function resetSchedule() { nextAt = offAir ? 0 : Date.now() + intervalMs(); paint(); }

  function setMode(value) {
    if (value !== 'sec' && value !== 'min') return;
    mode = value; saveSetting('dybXhsLoopMode', mode); resetSchedule();
  }

  function sendBeat(on) {
    try {
      if (!window.chrome || !chrome.runtime || !chrome.runtime.sendMessage) return;
      chrome.runtime.sendMessage({ type: on ? 'dyc:beatEnsure' : 'dyc:beatOff' }, function (res) {
        var err = chrome.runtime.lastError;
        beatStatus = err ? '注册失败' : on ? (res && res.ok !== false ? '后台拍点已连接' : '后台拍点未连接') : '已停止';
        noteDiag('后台拍点', beatStatus);
      });
    } catch (e) { beatStatus = '后台拍点不可用'; }
  }

  function updateBeat() {
    var wanted = shouldRun() && autoOn && !offAir;
    if (wanted === beatOn) return;
    beatOn = wanted; sendBeat(wanted);
  }

  /** 平台禁用态：disabled 属性 / disabled 类 / aria-disabled */
  function isDisabled(el) {
    if (!el) return true;
    if (el.disabled === true) return true;
    if (el.getAttribute && el.getAttribute('aria-disabled') === 'true') return true;
    var cls = (el.className && typeof el.className === 'string') ? (' ' + el.className + ' ') : '';
    return /(?:^|[\s_-])disabled(?:$|[\s_-])/.test(cls);
  }

  /* ==========================================================
   * 五、点击与冷却
   * ========================================================== */

  /**
   * 点一下。**按真人顺序派发完整指针序列**，不只 el.click()。
   *
   * ★ 2026-11-18 用户报「还是不会点弹卡」。
   *   原来第一选择是 `el.click()`：它只派发一个 click，没有 pointerdown/mousedown。
   *   d-design 的按钮常常在 mousedown 时进入按下态、在 mouseup 时判定一次点击；
   *   只给一个 click，有些组件会当成"键盘触发的无障碍点击"而忽略，或要求
   *   先有 pointerdown 才置内部 active 标记 —— 表现就是"点了没反应"。
   *   ⇒ 改成 pointerdown → mousedown → pointerup → mouseup → click，
   *     与抖店 fireClick 同一口径（那边真机验证过多轮）。
   *   顺带：坐标取按钮中心，pointer 事件带 pointerId，贴近真实输入。
   */
  function clickEl(el) {
    if (!el) return false;
    var r;
    try { r = el.getBoundingClientRect(); } catch (e) { r = null; }
    var x = r ? r.left + r.width / 2 : 0;
    var y = r ? r.top + r.height / 2 : 0;

    function fire(type, usePointer) {
      try {
        var opt = {
          bubbles: true, cancelable: true, composed: true, view: window,
          clientX: x, clientY: y, button: 0
        };
        var ev;
        if (usePointer && typeof PointerEvent === 'function') {
          opt.pointerId = 1;
          opt.pointerType = 'mouse';
          opt.isPrimary = true;
          ev = new PointerEvent(type, opt);
        } else {
          ev = new MouseEvent(type, opt);
        }
        el.dispatchEvent(ev);
        return true;
      } catch (e2) { return false; }
    }

    fire('pointerdown', true);
    fire('mousedown', false);
    fire('pointerup', true);
    fire('mouseup', false);
    /* 最后这一下 click 决定平台收不收：dispatch 失败（极老内核没有构造器）才退回 el.click() */
    if (!fire('click', false)) {
      try { if (typeof el.click === 'function') el.click(); } catch (e3) { /* 只能认了 */ }
    }
    return true;
  }

  function coolLeft(now) {
    var base = Math.max(lastPopAt, storedPopAt);
    if (!base) return 0;
    var left = POP_MIN_MS - ((now || Date.now()) - base);
    return left > 0 ? left : 0;
  }

  function markPop(at) {
    lastPopAt = at;
    storedPopAt = at;
    /* 只写本标签页：冷却是最典型的"各干各的"，共享它会让另一个中控台白等 15 秒 */
    sSet(POP_AT_KEY, at);
  }

  function popOnce(reason) {
    if (refreshBroadcast()) { paint(); return 'off-air'; }
    var now = Date.now();
    if (coolLeft(now) > 0) return 'cooling';
    if (busy) return 'busy';
    if (!inLecture()) return 'no-live';
    var card = currentCard();
    if (!card) return 'no-btn';
    var btn = findPopBtn(card);
    if (!btn) return 'no-btn';
    if (!btn.isConnected || currentCard() !== card) return 'no-live';
    var key = cardKey(card);
    pendingPop = { card: card, key: key, name: cardName(card), at: now,
      deadline: now + POP_VERIFY_MS, reason: reason, cooling: false, rejected: '' };
    busy = true;
    // 尝试即占用冷却，失败也不连点；成功次数另等平台凭据。
    markPop(now);
    nextAt = now + intervalMs();
    try {
      if (!clickEl(btn)) throw new Error('点击未发出');
      inspectPending();
      setTimeout(checkPending, POP_VERIFY_MS);
    } catch (e) {
      finishPending(false, '点击失败');
    }
    paint();
    return 'pending';
  }

  function inspectPending() {
    if (!pendingPop) return;
    var card = currentCard();
    if (!card || cardKey(card) !== pendingPop.key) return;
    var buttons = $$(ACTION_SEL + ',button,[role="button"]', card);
    pendingPop.cooling = pendingPop.cooling || buttons.some(function (el) {
      return visible(el) && !inOwnUI(el) && kindOf(el) === 'pop' && platformCooling(el);
    });
  }

  function checkPending() {
    if (!pendingPop) return;
    if (refreshBroadcast()) { paint(); return; }
    scanRateLimitToast();
    inspectPending();
    if (Date.now() < pendingPop.deadline) return;
    var card = currentCard();
    var same = card && cardKey(card) === pendingPop.key;
    var ok = same && pendingPop.cooling && !pendingPop.rejected;
    finishPending(ok, pendingPop.rejected || (!same ? '讲解商品已变化' : '平台未确认弹卡'));
  }

  function finishPending(ok, why) {
    var p = pendingPop;
    if (!p) return;
    pendingPop = null;
    busy = false;
    if (ok) { rounds += 1; failures = 0; }
    else { failures += 1; if (!infinite && failures >= 6) setAuto(false, false); }
    lastFeedback = ok ? '已确认弹卡' : why;
    noteDiag(p.name || '当前讲解商品', lastFeedback);
    say(p.name || '当前讲解商品', ok ? 'success' : 'warning', {
      count: ok ? '第 ' + rounds + ' 次' : why,
      standalone: true, histKey: 'xhs-loop',
      full: ok ? '平台弹卡按钮已进入冷却，确认本次弹卡。'
        : why + '，本次未计数；' + (autoOn ? '等待下个间隔再检查。' : '连续失败已停止循环。')
    });
    paint();
  }

  function cardTitle(card) {
    var el = card && (card.querySelector(TITLE_SEL + ' span.--color-text-title')
                   || card.querySelector(TITLE_SEL + ' span'));
    return txt(el);
  }

  function cardName(card) {
    return cardTitle(card).slice(0, 24);
  }

  /** class 的末段（诊断用：文案认不出时靠它认形态） */
  function tailClass(el) {
    var c = el && el.className;
    if (!c || typeof c !== 'string') return el && el.tagName ? el.tagName.toLowerCase() : '?';
    var parts = c.trim().split(/\s+/);
    return parts[parts.length - 1] || '?';
  }

  /**
   * 一个容器里的可见按钮摘要：`文案(宽×高)[禁]`。
   *
   * ★ 2026-11-18 用户「还是不会点弹卡」：上一版只写文案和尺寸，
   *   看不出"按钮在那里但被禁用"这类情况，等于又少一维线索。
   *   现在带上禁用标记；文案为空（只有图标）时退到 class 末段。
   */
  function describeBtns(root) {
    if (!root) return '无容器';
    var cands = $$(ACTION_SEL + ',button,[role="button"]', root);
    var out = [];
    for (var i = 0; i < cands.length && out.length < 8; i++) {
      var el = cands[i];
      /* 跳过我们自己注入的控件，免得把自家按钮当成平台的 */
      if (inOwnUI(el)) continue;
      var r;
      try { r = el.getBoundingClientRect(); } catch (e) { continue; }
      if (!r.width || !r.height) continue;
      var label = clean(txt(el)).slice(0, 6) || ('/' + tailClass(el));
      out.push(label + '(' + Math.round(r.width) + '×' + Math.round(r.height) + ')'
        + (isDisabled(el) ? '[禁]' : ''));
    }
    return out.join('/') || '无可点元素';
  }

  /* ==========================================================
   * 六、平台报错兜底（命中限频 toast ⇒ 重置冷却，不再连撞）
   * ========================================================== */

  function scanRateLimitToast() {
    var now = Date.now();
    /* 只在「刚点过」的时间窗里扫：平台拒绝一定紧随点击。
     * 没弹过（两个时间戳都是 0）或早已过去 12 秒，直接不扫 ——
     * 这条闸也顺手省掉了每秒一次的全页 toast 查询。 */
    var base = Math.max(lastPopAt, storedPopAt);
    if (!base || now - base > RATE_WINDOW_MS) return;
    if (now - lastNoteAt < 500) return;     // 限频：一秒最多两次
    lastNoteAt = now;
    var nodes = $$('.d-new-toast,[class*="d-message"],[class*="d-toast"],[role="alert"]');
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      if (!visible(el)) continue;
      var t = txt(el);
      if (!t || t.length > 60) continue;
      var rate = RATE_LIMIT_RE.test(t);
      if (!rate && !(pendingPop && /失败|出错|异常|未成功/.test(t))) continue;
      if (seenToasts.get(el) === t) continue;
      seenToasts.set(el, t);
      if (pendingPop) pendingPop.rejected = rate ? '平台限制操作频率' : '平台提示弹卡失败';
      /* 平台已经拒了 ⇒ 冷却从此刻重算。这条不重试，只让用户知道为什么慢下来了。 */
      markPop(now);
      if (pendingPop) return; // 本次动作由 finishPending 统一播报一条结果。
      if (now - lastWarnAt > 8000) {
        lastWarnAt = now;
        noteDiag('平台限频：' + t.slice(0, 20), '冷却重开');
        say('平台提示操作太频繁', 'error', {
          full: '平台返回「' + t + '」，已把冷却重置为 15 秒。'
            + '这不是扩展的间隔设置有问题，是平台对同一张讲解卡的弹卡频率限制。',
          keepHistory: false
        });
      }
      return;
    }
  }

  /* ==========================================================
   * 七、控件
   * ========================================================== */

  // 小红书工具栏：30px 矩形组合按钮，展开后使用同一套小圆角分组与平台蓝。
  var CSS = [
    "#dyc-xhs-loop{all:initial;position:fixed;visibility:hidden;display:inline-flex;align-items:center;width:224px;height:30px;vertical-align:middle;border:1px solid #d9dce1;border-radius:4px;background:#fff;color:#4e5969;font:12px/1.4 -apple-system,BlinkMacSystemFont,\"Microsoft YaHei\",sans-serif;box-sizing:border-box;z-index:2147482500;}",
    "#dyc-xhs-loop *{box-sizing:border-box;font-family:inherit;}",
    "#dyc-xhs-loop :where(button,input){all:unset;box-sizing:border-box;font:inherit;}",
    "#dyc-xhs-loop [hidden]{display:none!important;}",
    "#dyc-xhs-loop button{cursor:pointer;}",
    "#dyc-xhs-loop button:focus-visible,#dyc-xhs-loop input:focus-visible{outline:2px solid #3468ff;outline-offset:2px;}",
    "#dyc-xhs-loop-main{display:flex;align-items:center;gap:5px;flex:none;width:179px;height:28px;padding:0 9px;border-radius:3px 0 0 3px;white-space:nowrap;}",
    "#dyc-xhs-loop-main:hover{background:#f7f8fa;}",
    "#dyc-xhs-loop .txt{flex:1;min-width:0;}",
    "#dyc-xhs-loop .dot{width:6px;height:6px;border-radius:50%;background:#b8bec8;flex:none;}",
    "#dyc-xhs-loop .inf-mark{width:18px;height:12px;flex:none;color:#c9cdd4;pointer-events:none;}",
    "#dyc-xhs-loop .inf-mark.on{color:#3468ff;}",
    "#dyc-xhs-loop .slot{width:40px;text-align:right;font-size:11px;font-variant-numeric:tabular-nums;flex:none;color:#86909c;}",
    "#dyc-xhs-loop .power{width:43px;height:28px;flex:none;text-align:center;border-left:1px solid #e5e6eb;border-radius:0 3px 3px 0;background:#f7f8fa;color:#3468ff;}",
    "#dyc-xhs-loop .power:hover{background:#edf2ff;}",
    "#dyc-xhs-loop.on{border-color:#b9caff;}",
    "#dyc-xhs-loop.on .dot{background:#20a162;}",
    "#dyc-xhs-loop.on .slot{color:#3468ff;font-weight:600;}",
    "#dyc-xhs-loop.on .power{color:#4e5969;}",
    "#dyc-xhs-loop.wait .dot{background:#e69b28;}",
    "#dyc-xhs-loop.wait .slot{color:#b7791f;}",
    "#dyc-xhs-loop.off .slot{color:#86909c;}",
    "#dyc-xhs-loop-panel{position:fixed;z-index:2147482500;width:344px;max-width:calc(100vw - 16px);max-height:calc(100vh - 16px);overflow-y:auto;padding:16px 16px 0;border:1px solid #e5e6eb;border-radius:6px;background:#fff;box-shadow:0 6px 20px rgba(31,35,41,.12);color:#4e5969;text-align:left;white-space:normal;opacity:0;visibility:hidden;transform:translateY(-4px);pointer-events:none;transition:opacity .12s,transform .12s,visibility .12s;}",
    "#dyc-xhs-loop-panel.open{opacity:1;visibility:visible;transform:none;pointer-events:auto;}",
    "#dyc-xhs-loop .ph{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:14px;}",
    "#dyc-xhs-loop .ph b{font-size:14px;font-weight:600;color:#1f2329;}",
    "#dyc-xhs-loop .inf{display:flex;align-items:center;gap:4px;height:26px;padding:0 9px;border:1px solid #d9dce1;border-radius:4px;font-size:12px;background:#fff;color:#86909c;}",
    "#dyc-xhs-loop .inf .ig{font-size:16px;line-height:1;}",
    "#dyc-xhs-loop .inf[aria-pressed=\"true\"]{border-color:#c7d5ff;background:#f0f4ff;color:#3468ff;}",
    "#dyc-xhs-loop .inf:hover{border-color:#3468ff;}",
    "#dyc-xhs-loop .grp{margin-top:10px;padding:12px;border:1px solid #cdd3dd;border-radius:4px;background:#f1f3f6;cursor:pointer;}",
    "#dyc-xhs-loop .grp[aria-pressed=\"true\"]{border-color:#3468ff;background:#eaf0ff;box-shadow:inset 0 0 0 1px #3468ff;cursor:default;}",
    "#dyc-xhs-loop .grp[aria-pressed=\"false\"]:hover{border-color:#8397c6;}",
    "#dyc-xhs-loop .gh{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:10px;}",
    "#dyc-xhs-loop .gh-left{display:flex;align-items:center;gap:6px;}",
    "#dyc-xhs-loop .rd{width:12px;height:12px;flex:none;border:1px solid #c9cdd4;border-radius:2px;background:#fff;}",
    "#dyc-xhs-loop .grp[aria-pressed=\"true\"] .rd{border-color:#3468ff;background:#3468ff;box-shadow:inset 0 0 0 2px #fff;}",
    "#dyc-xhs-loop .gt{font-size:12px;color:#4e5969;}",
    "#dyc-xhs-loop .grp[aria-pressed=\"true\"] .gt{color:#193fae;font-weight:700;}",
    "#dyc-xhs-loop .value{margin-left:auto;font-size:11px;color:#5b6473;font-variant-numeric:tabular-nums;}",
    "#dyc-xhs-loop .grp[aria-pressed=\"true\"] .value{color:#3468ff;}",
    "#dyc-xhs-loop .mode-state{flex:none;padding:1px 5px;border-radius:3px;background:#dfe4ec;color:#4e5969;font-size:10px;}",
    "#dyc-xhs-loop .grp[aria-pressed=\"true\"] .mode-state{background:#2554d8;color:#fff;}",
    "#dyc-xhs-loop .grp[aria-pressed=\"false\"] .tier[aria-pressed=\"true\"]{background:#e1e5ec;border-color:#b8c1d0;color:#4e5969;}",
    "#dyc-xhs-loop .grp[aria-pressed=\"false\"] .tier[aria-pressed=\"true\"] .u{color:#5b6473;}",
    "#dyc-xhs-loop .tiers{display:grid;grid-template-columns:repeat(4,1fr);gap:6px;}",
    "#dyc-xhs-loop .tier{display:flex;align-items:baseline;justify-content:center;gap:3px;height:32px;padding:5px 0;border:1px solid #d9dce1;border-radius:3px;background:#fff;}",
    "#dyc-xhs-loop .tier b{font-size:14px;font-weight:600;line-height:20px;}",
    "#dyc-xhs-loop .tier .u{font-size:10px;color:#86909c;}",
    "#dyc-xhs-loop .tier[aria-pressed=\"true\"]{border-color:#3468ff;background:#3468ff;color:#fff;}",
    "#dyc-xhs-loop .tier[aria-pressed=\"true\"] .u{color:#fff;}",
    "#dyc-xhs-loop input[type=range]{appearance:none;-webkit-appearance:none;display:block;width:100%;height:5px;border-radius:2px;margin:16px 0 8px;background:linear-gradient(90deg,#3468ff 0 var(--fill,0%),#e5e8ee var(--fill,0%) 100%);cursor:pointer;}",
    "#dyc-xhs-loop input[type=range]::-webkit-slider-thumb{appearance:none;width:14px;height:14px;border:2px solid #3468ff;border-radius:3px;background:#fff;box-shadow:0 1px 3px rgba(31,35,41,.12);}",
    "#dyc-xhs-loop .grp[aria-pressed=\"false\"] input[type=range]{background:#e5e8ee;}",
    "#dyc-xhs-loop .grp[aria-pressed=\"false\"] input[type=range]::-webkit-slider-thumb{border-color:#b8bec8;}",
    "#dyc-xhs-loop .scale{display:flex;justify-content:space-between;gap:6px;margin-top:7px;font-size:10px;line-height:1.5;color:#86909c;}",
    "#dyc-xhs-loop .scale button{font-size:10px;}",
    "#dyc-xhs-loop .readout{margin:14px -16px 0;padding:12px 16px;background:#f7f8fa;border-top:1px solid #eef0f3;}",
    "#dyc-xhs-loop .r1{display:flex;align-items:center;justify-content:space-between;gap:8px;color:#1f2329;font-size:12px;line-height:1.6;}",
    "#dyc-xhs-loop .count{font-size:11px;color:#86909c;white-space:nowrap;}",
    "#dyc-xhs-loop .r2{margin-top:4px;font-size:11px;line-height:1.6;color:#86909c;}",
    "#dyc-xhs-loop .st{margin-top:6px;font-size:11px;line-height:1.6;color:#5b6473;overflow-wrap:anywhere;}",
    "@media(prefers-reduced-motion:reduce){#dyc-xhs-loop-panel{transition:none;}}"
  ].join('\n');

  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    var st = document.createElement('style');
    st.id = STYLE_ID;
    st.textContent = CSS;
    (document.head || document.documentElement).appendChild(st);
  }

  function setPanelOpen(open) {
    panelOpen = !!open;
    if (panelEl) { panelEl.classList.toggle('open', panelOpen); panelEl.inert = !panelOpen; }
    if (mainEl) mainEl.setAttribute('aria-expanded', panelOpen ? 'true' : 'false');
    if (panelOpen) placePanel();
  }

  function placePanel() {
    if (!panelEl || !mainEl || !panelOpen) return;
    var r = boxEl.getBoundingClientRect();
    var w = panelEl.offsetWidth || 344;
    var h = panelEl.offsetHeight || 390;
    var left = Math.max(8, Math.min(r.left, window.innerWidth - w - 8));
    var below = r.bottom + 8;
    var top = below + h <= window.innerHeight - 8 ? below : Math.max(8, r.top - h - 8);
    panelEl.style.left = left + 'px'; panelEl.style.top = top + 'px';
    panelEl.style.setProperty('--ox', Math.max(0, Math.min(w, r.left - left)) + 'px');
    panelEl.style.setProperty('--oy', top >= r.bottom ? '0px' : h + 'px');
  }

  function buildBox() {
    var box = document.createElement('span');
    box.id = BOX_ID; box.className = 'dyc-xhs-loop off';
    box.setAttribute('data-dyc-skip', '1');
    var main = document.createElement('button');
    main.id = MAIN_ID; main.type = 'button'; main.setAttribute('aria-expanded', 'false');
    main.setAttribute('aria-controls', PANEL_ID);
    main.innerHTML = '<span class="dot"></span><span class="txt">循环讲解</span>'
      + '<svg class="inf-mark" viewBox="0 0 28 14" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" d="M14 7C11.7 4 10 1.6 7 1.6a5.4 5.4 0 0 0 0 10.8c3 0 4.7-2.4 7-5.4 2.3-3 4-5.4 7-5.4a5.4 5.4 0 0 1 0 10.8c-3 0-4.7-2.4-7-5.4Z"/></svg>'
      + '<span class="slot clock"></span>';
    var power = document.createElement('button');
    power.type = 'button'; power.className = 'power'; power.textContent = '开启';
    power.addEventListener('click', function (e) { e.stopPropagation(); setAuto(!autoOn, true); });
    var panel = document.createElement('div');
    panel.id = PANEL_ID; panel.inert = true; panel.setAttribute('aria-label', '循环讲解设置');
    var html = ['<div class="ph"><b>自动循环讲解</b>',
      '<button type="button" class="infinite inf" aria-pressed="true" title="持续等待讲解商品；关闭后连续失败六次停止"><span class="ig" aria-hidden="true">∞</span> 无限</button></div>',
      '<div class="grp" data-mode="sec" tabindex="0" role="group" aria-label="秒档" aria-pressed="true">',
      '<div class="gh"><span class="gh-left"><span class="rd"></span><span class="gt">秒档</span></span><span class="value sec-value"></span><span class="mode-state"></span></div>',
      '<div class="tiers">'];
    for (var i = 0; i < TIERS.length; i++) html.push('<button type="button" class="tier sg" data-tier="' + TIERS[i] + '" aria-pressed="false"><b>' + TIERS[i] + '</b><span class="u">秒</span></button>');
    html.push('</div><input class="sec-interval" type="range" min="15" max="60" step="1" aria-label="秒档间隔">',
      '<div class="scale"><span>15 秒</span><span>每轮随机加 0～3 秒</span><span>60 秒</span></div></div>',
      '<div class="grp" data-mode="min" tabindex="0" role="group" aria-label="分钟档" aria-pressed="false">',
      '<div class="gh"><span class="gh-left"><span class="rd"></span><span class="gt">分钟档</span></span><span class="value min-value"></span><span class="mode-state"></span></div>',
      '<input class="interval" type="range" min="1" max="15" step="0.5" aria-label="分钟档间隔">',
      '<div class="scale"><button type="button" data-minutes="1">1 分</button><button type="button" data-minutes="5">5 分</button><button type="button" data-minutes="10">10 分</button><button type="button" data-minutes="15">15 分</button></div></div>',
      '<div class="readout"><div class="r1"><span class="interval-label"></span><span class="count"></span></div>',
      '<div class="r2">只弹正在讲解的商品，平台冷却时等待。</div><div class="r3 st" role="status"></div></div>');
    panel.innerHTML = html.join('');
    box.appendChild(main); box.appendChild(power); box.appendChild(panel);
    main.addEventListener('click', function (e) { e.stopPropagation(); setPanelOpen(!panelOpen); });
    panel.addEventListener('click', function (e) {
      e.stopPropagation();
      if (e.target.closest('.infinite')) { infinite = !infinite; saveSetting('dybXhsLoopInfinite', infinite); paint(); return; }
      var group = e.target.closest('[data-mode]');
      if (group && group.getAttribute('data-mode') !== mode) setMode(group.getAttribute('data-mode'));
      var btn = e.target.closest('[data-tier]');
      if (btn) setTier(Number(btn.getAttribute('data-tier')));
      var minuteBtn = e.target.closest('[data-minutes]');
      if (minuteBtn) setMinutes(Number(minuteBtn.getAttribute('data-minutes')));
    });
    panel.addEventListener('keydown', function (e) {
      if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('.grp')) {
        e.preventDefault(); setMode(e.target.getAttribute('data-mode'));
      }
    });
    panel.querySelector('.sec-interval').addEventListener('input', function (e) { if (mode !== 'sec') setMode('sec'); setTier(Number(e.target.value)); });
    panel.querySelector('.interval').addEventListener('input', function (e) { if (mode !== 'min') setMode('min'); setMinutes(Number(e.target.value)); });
    return box;
  }

  function setMinutes(value) {
    if (!Number.isFinite(value) || value < 1 || value > 15 || value * 2 !== Math.round(value * 2)) return;
    minutes = value; saveSetting('dybXhsLoopMinutes', minutes); resetSchedule();
  }

  // 跟随搜索框的视口坐标，不占商品工具栏的宽度。
  function placeControl() {
    positionFrame = null;
    if (!boxEl) return;
    var rect = searchAnchor && searchAnchor.isConnected && searchAnchor.getBoundingClientRect();
    var container = rect && searchAnchor.closest('.control-container');
    var clip = container && container.getBoundingClientRect();
    var shown = rect && rect.width > 0 && rect.height > 0 && rect.top >= 40
      && rect.top < window.innerHeight && rect.right > 0 && rect.left < window.innerWidth
      && (!clip || !clip.height || (rect.top >= clip.top && rect.top < clip.bottom));
    boxEl.style.visibility = shown ? 'visible' : 'hidden';
    if (!shown) {
      if (panelOpen) setPanelOpen(false);
      return;
    }
    boxEl.style.left = rect.left + 'px';
    boxEl.style.top = (rect.top - boxEl.offsetHeight - 10) + 'px';
    placePanel();
  }

  function schedulePosition() {
    if (boxEl && positionFrame === null) positionFrame = window.requestAnimationFrame(placeControl);
  }

  function mount() {
    if (!searchAnchor || !searchAnchor.isConnected || !visible(searchAnchor)) {
      searchAnchor = typeof window.dycFindXhsSearchBox === 'function' ? window.dycFindXhsSearchBox() : null;
    }
    if (boxEl && boxEl.isConnected) {
      schedulePosition();
      return !!searchAnchor;
    }
    if (!searchAnchor) return false;
    ensureStyle();
    panelOpen = false;
    var el = buildBox();
    document.body.appendChild(el);
    boxEl = el;
    mainEl = el.querySelector('#' + MAIN_ID);
    panelEl = el.querySelector('#' + PANEL_ID);
    statusEl = el.querySelector('.st');
    placeControl();
    paint();
    return true;
  }

  function unmount() {
    if (positionFrame !== null) window.cancelAnimationFrame(positionFrame);
    positionFrame = searchAnchor = null;
    if (boxEl && boxEl.parentNode) boxEl.parentNode.removeChild(boxEl);
    boxEl = mainEl = panelEl = statusEl = null;
    panelOpen = false;
    missCount = 0;
  }

  /* ==========================================================
   * 八、绘制
   * ========================================================== */

  function paint() {
    if (!mainEl) return;
    var live = !offAir && liveNow();
    var left = Math.ceil(remaining() / 1000);
    var running = autoOn && live;
    var label = offAir ? '未开播' : !autoOn ? '未开启' : !live ? '待讲解' : busy ? '确认中' : left ? Math.floor(left / 60) + ':' + String(left % 60).padStart(2, '0') : '待弹卡';
    mainEl.querySelector('.clock').textContent = label;
    boxEl.classList.toggle('on', running);
    boxEl.classList.toggle('wait', autoOn && !offAir && !live);
    boxEl.classList.toggle('off', offAir || !autoOn);
    boxEl.querySelector('.inf-mark').classList.toggle('on', infinite);
    var power = boxEl.querySelector('.power');
    power.textContent = autoOn ? '停止' : '开启'; power.setAttribute('aria-pressed', String(autoOn));
    power.title = autoOn ? '停止自动循环讲解' : '开启自动循环讲解，未开播时等待';
    var status = offAir ? '未开播，循环已暂停；开播后重新计时。'
      : !autoOn ? '自动循环未开启。' : !live ? '等待讲解中的商品。'
      : busy ? '等待平台确认本次弹卡。' : left ? '讲解中，' + left + ' 秒后检查弹卡。' : '讲解中，等待平台允许弹卡。';
    mainEl.title = status + ' 点击展开设置';
    if (panelEl) {
      $$('.tier', panelEl).forEach(function (b) { b.setAttribute('aria-pressed', String(Number(b.getAttribute('data-tier')) === tier)); });
      var inf = panelEl.querySelector('.infinite'); inf.setAttribute('aria-pressed', String(infinite));
      var secondsRange = panelEl.querySelector('.sec-interval'); secondsRange.value = tier;
      secondsRange.style.setProperty('--fill', ((tier - 15) / 45 * 100) + '%');
      var minuteRange = panelEl.querySelector('.interval'); minuteRange.value = minutes;
      minuteRange.style.setProperty('--fill', ((minutes - 1) / 14 * 100) + '%');
      panelEl.querySelector('.sec-value').textContent = tier + ' 秒 + 0～3 秒';
      panelEl.querySelector('.min-value').textContent = minutes + ' 分钟';
      panelEl.querySelector('.interval-label').textContent = mode === 'min' ? '每 ' + minutes + ' 分钟弹卡' : '每 ' + tier + '～' + (tier + 3) + ' 秒弹卡';
      panelEl.querySelector('.count').textContent = '已弹 ' + rounds + ' 次';
      $$('[data-mode]', panelEl).forEach(function (group) {
        var selected = group.getAttribute('data-mode') === mode;
        group.setAttribute('aria-pressed', String(selected));
        group.querySelector('.mode-state').textContent = selected ? '当前档位' : '可切换';
      });
    }
    if (statusEl) statusEl.textContent = status + (!offAir && lastFeedback ? ' ' + lastFeedback : '');
    placePanel();
  }

  /* ==========================================================
   * 九、设置
   * ========================================================== */

  /* ---------- 设置与冷却：本页优先，全局只当默认值 ----------
   *
   * ★ 2026-11-18 用户：「同一个浏览器开两个或多个平台的中控台，
   *   不要串起来，各干各的」。
   *   chrome.storage.local 是**整个扩展共享**的：两个标签页会读到同一份
   *   冷却时间戳 —— 这边弹一次、那边跟着进 15 秒冷却；档位也会互相覆盖。
   *   ⇒ 分两层：
   *     · 冷却起点**只存 sessionStorage**：按标签页隔离，刷新保留、关页即弃，
   *       绝不跨标签页传播。
   *     · 档位与自动开关：sessionStorage 是"本页当前值"，chrome.storage.local
   *       只当"新标签页的默认值" —— 本页的调节不干扰别的标签页。
   */
  function sGet(k) {
    try { return window.sessionStorage.getItem(k); } catch (e) { return null; }
  }
  function sSet(k, v) {
    try { window.sessionStorage.setItem(k, String(v)); } catch (e) { /* 无痕模式可能禁用 */ }
  }
  function sNum(k) {
    var raw = sGet(k);
    if (raw === null || raw === '') return null;
    var v = Number(raw);
    return Number.isFinite(v) ? v : null;
  }

  /** 本页生效 + 更新"新标签页的默认值"（后者失败不影响本页） */
  function saveSetting(key, value) {
    sSet(key, value);
    var obj = {};
    obj[key] = value;
    try {
      if (window.chrome && chrome.storage && chrome.storage.local) chrome.storage.local.set(obj);
    } catch (e) { /* 只是新标签页拿不到这个默认值 */ }
  }

  function setTier(v) {
    if (!Number.isInteger(v) || v < 15 || v > 60) return;
    tier = v;
    saveSetting(TIER_KEY, v);
    resetSchedule();
    noteDiag('间隔改为 ' + v + ' 秒', '已保存');
  }

  function setAuto(on, byUser) {
    autoOn = !!on;
    saveSetting(AUTO_KEY, autoOn);
    if (!autoOn) { pendingPop = null; busy = false; }
    else { failures = 0; nextAt = offAir ? 0 : Date.now() + intervalMs(); }
    updateBeat();
    paint();
    if (byUser) {
      noteDiag(autoOn ? '自动弹卡开启' : '自动弹卡关闭', autoOn ? '运行中' : '已停');
    }
  }

  function loadSettings(cb) {
    var ts = sNum(TIER_KEY);          // 本页当前值（优先级最高）
    var as = sGet(AUTO_KEY);
    var at = sNum(POP_AT_KEY);        // 本页冷却起点

    function apply(oTier, oAuto, saved) {
      if (ts !== null && Number.isInteger(ts) && ts >= 15 && ts <= 60) tier = ts;
      else if (Number.isInteger(oTier) && oTier >= 15 && oTier <= 60) tier = oTier;
      else tier = TIER_DEF;

      if (as === '1' || as === '0' || as === 'true' || as === 'false') autoOn = as === '1' || as === 'true';
      else if (oAuto === undefined || oAuto === null) autoOn = true;   // 装完即可用
      else autoOn = !!oAuto;

      storedPopAt = at === null ? 0 : at;
      saved = saved || {};
      mode = sGet('dybXhsLoopMode') || saved.dybXhsLoopMode || 'sec';
      if (mode !== 'min') mode = 'sec';
      var m = sNum('dybXhsLoopMinutes');
      if (m === null) m = Number(saved.dybXhsLoopMinutes || 5);
      minutes = m >= 1 && m <= 15 && m * 2 === Math.round(m * 2) ? m : 5;
      var inf = sGet('dybXhsLoopInfinite');
      infinite = inf === '0' || inf === 'false' ? false : inf === '1' || inf === 'true' ? true : saved.dybXhsLoopInfinite !== false;
      cb();
    }

    try {
      if (!(window.chrome && chrome.storage && chrome.storage.local)) { apply(null, null); return; }
      chrome.storage.local.get([TIER_KEY, AUTO_KEY, 'dybXhsLoopMode', 'dybXhsLoopMinutes', 'dybXhsLoopInfinite'], function (o) {
        o = o || {};
        apply(parseInt(o[TIER_KEY], 10), o[AUTO_KEY], o);
      });
    } catch (e) { apply(null, null); }
  }

  /* ==========================================================
   * 十、循环本体
   * ========================================================== */

  /** 换品重新计时，保留刚发过点击的硬冷却，避免跨商品连点。 */
  function syncLectureKey() {
    var card = currentCard();
    if (!card) return;
    var key = cardKey(card);
    if (!key) return;
    if (key !== lastLectureKey) {
      nextAt = Date.now() + intervalMs();
      noteDiag(cardName(card), '讲解目标已更新，重新计时');
    }
    lastLectureKey = key;
  }

  /**
   * 记「这一拍为什么没弹」。只在该原因**变化**时记一条，5 秒节流。
   *
   * ★ 2026-11-18 用户报「无法自动弹」：那时所有跳过路径都是静默的 ——
   *   自动关掉、当前无人讲、按钮不可点，全都一声不吭，诊断里只剩一条
   *   第一次成功的记录，等于没有线索。现在每个原因都会落到轨迹上。 */
  function noteSkip(why) {
    if (why === lastSkipKey) return;
    var t = Date.now();
    if (t - lastSkipAt < 5000) return;
    lastSkipKey = why;
    lastSkipAt = t;
    noteDiag('未弹：' + why, '等待');
  }

  function tick() {
    if (!started || !shouldRun()) return;
    if (refreshBroadcast()) { paint(); return; }
    var now = Date.now();
    if (now - lastTickAt < 200) return;
    lastTickAt = now;
    scanRateLimitToast();
    checkPending();
    if (!autoOn) { noteSkip('自动未开启'); paint(); return; }
    if (busy) { paint(); return; }
    syncPlatformCooldown();

    if (!liveNow()) {
      /* 用户口径：讲解结束后不停表，等下一个讲解中的品 */
      noteSkip('当前无商品在讲');
      paint();
      return;
    }
    syncLectureKey();
    if (remaining() > 0) { paint(); return; }

    var r = popOnce('自动');
    if (r === 'pending') return;
    if (r === 'no-btn') {
      noteSkip('讲解商品暂时无法定位或平台按钮冷却中');
      paint(); return;
    }
    paint();
  }

  /** 控件被平台重渲染清掉 / 被搬到别处 ⇒ 本拍重挂，不等两拍 */
  function heartbeat() {
    refreshBroadcast();
    if (!mount()) {
      missCount += 1;
      if (missCount === WARN_AFTER && !warned) {
        warned = true;
        noteDiag('插不上：没找到商品搜索框', '未注入');
        say('没找到商品列表工具栏', 'warning', {
          full: '页面上没找到「请输入商品名称」搜索框。'
            + '把调试面板里的结构报告发我。',
          keepHistory: false
        });
      }
    } else {
      missCount = 0;
      warned = false;
      paint();
    }
  }

  /* ==========================================================
   * 十一、启停
   * ========================================================== */

  function shouldRun() {
    return flagsReady && onCtrlPage() && flags.xhsLoop !== false;
  }

  function apply() {
    if (!shouldRun()) {
      if (tickTimer) { clearInterval(tickTimer); tickTimer = null; }
      if (beatTimer) { clearInterval(beatTimer); beatTimer = null; }
      pendingPop = null; busy = false;
      updateBeat();
      unmount();
      return;
    }
    refreshBroadcast();
    mount();
    if (!beatTimer) beatTimer = setInterval(heartbeat, HEARTBEAT_MS);
    if (!tickTimer) tickTimer = setInterval(tick, TICK_MS);
    updateBeat();
    paint();
  }

  function start() {
    if (started) return;
    started = true;
    /* dycReadFlags() 返回 Promise —— 必须 .then */
    dycReadFlags().then(function (f) {
      flags = f || {};
      flagsReady = true;
      loadSettings(apply);
    }, function () { /* 读不到就等 onChanged 救场 */ });

    if (typeof dycWatchFlags === 'function') {
      dycWatchFlags(function (f) { flags = f || {}; flagsReady = true; apply(); });
    }
    window.addEventListener('dyc:pagechange', apply);
    window.addEventListener('resize', schedulePosition);
    window.addEventListener('scroll', schedulePosition, { capture: true, passive: true });
    document.addEventListener('click', function (e) {
      if (panelOpen && boxEl && !boxEl.contains(e.target)) setPanelOpen(false);
    }, true);
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && panelOpen) { setPanelOpen(false); if (mainEl) mainEl.focus(); }
    });
    window.addEventListener('pagehide', function () { sendBeat(false); });
    window.addEventListener('pageshow', function () { beatOn = false; apply(); });
    var feedbackObserver = new MutationObserver(function (records) {
      if (!pendingPop || !records.some(function (r) {
        var el = r.target.nodeType === 1 ? r.target : r.target.parentElement;
        return el && !inOwnUI(el);
      })) return;
      inspectPending(); scanRateLimitToast();
    });
    feedbackObserver.observe(document.documentElement, { childList: true, characterData: true, attributes: true, attributeFilter: ['class', 'disabled', 'aria-disabled'], subtree: true });
    if (window.chrome && chrome.runtime && chrome.runtime.onMessage) {
      chrome.runtime.onMessage.addListener(function (msg) {
        if (msg && msg.type === 'dyc:beat') tick();
        return false;
      });
    }
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

  /* 自测入口（只读探针，不改行为） */
  window.__DYC_XHS_LOOP__ = {
    kindOfText: kindOfText,
    coolLeft: coolLeft,
    popOnce: popOnce,
    inLecture: inLecture,
    currentCard: currentCard,
    findPopBtn: findPopBtn,
    _tick: function () { lastTickAt = 0; tick(); },
    _checkPending: checkPending,
    _setMode: setMode,
    _intervalMs: intervalMs,
    _due: function () { nextAt = Date.now() - 1; },
    _setPopAt: function (t) { lastPopAt = t; storedPopAt = t; },
    _setTier: setTier,
    _setAuto: setAuto,
    _state: function () {
      return { tier: tier, autoOn: autoOn, lastPopAt: lastPopAt, rounds: rounds, busy: busy,
        nextAt: nextAt, mode: mode, minutes: minutes, infinite: infinite, failures: failures, beat: beatStatus, offAir: offAir };
    },
    POP_MIN_MS: POP_MIN_MS
  };
})();
