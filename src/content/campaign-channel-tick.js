/**
 * 活动广场 · 勾选主商品联动渠道品（2026-10-25 新增，计划中功能 #1）
 * ============================================================
 * 【行为】父活动详情 / 报名页（/ffa/merchant/parent-campaign-detail）每一行是
 *   一个主商品，主商品勾选框右侧下方还有一枚「渠道品跟随主品报名 (N)」。
 *   本模块让这一行里的**渠道品勾选状态始终跟主品一致**：勾主商品就补勾渠道品，
 *   取消主商品就一并取消渠道品；表头「全选」/「取消全选」也一次性同步所有已渲染行。
 *
 * 【用户定案的口径】
 *   ① 双向同步（2026-10-25 01:00 追加）：勾上补勾、取消一并取消。
 *      第一版只做补勾，理由是「用户说平台自己会连带取消」——实测平台并不会，
 *      用户随即要求「取消主品报名的时候也帮我取消对应的渠道品」。
 *   ② 手动取消渠道品后再重新勾主商品 —— **再补勾**：每次「未勾 → 已勾」
 *      都是一次报名意图。
 *   ③ 表头全选 —— **也联动**：汇总成一条消息，不逐行刷屏。
 *
 * 【识别策略：认文案，不认 class】
 *   平台这套是 auxo/ecom 组件库，class 带哈希后缀（style_container__1TTrI 之类），
 *   跨版本必变。所以判据全部落在**可见文案**上：
 *     · 行的边界   = 从被点的勾选框往上找，第一个「含「渠道品…报名」文案 +
 *                    文本长度 ≤ 800 字 + 勾选框数 ≤ 12」的祖先；
 *     · 行内主品框 = 行内第一枚不在渠道品控件里的勾选框；
 *     · 渠道品控件 = 「渠道品跟随主品报名」文案最近的、包着勾选框的那层壳。
 *   找不到就当没这回事（宁可不做，也不乱点 —— 这是「渠道品页歪按钮」那次的教训）。
 *
 * 【为什么不模拟接口】
 *   勾选渠道品会随主品一起提交报名，提交参数由平台自己组装；我们只把用户本来
 *   要点的那一下代点了。走真实点击链路，不猜报名接口，也就不会被平台规则盯上。
 *
 * 【时序】点击后一律等 60ms 再读状态：平台是 React 受控组件，勾选态在同一拍里
 *   还没落到 DOM 上。因此「主品是否真勾上」「渠道品是否已勾好」都按延后读取判定，
 *   不看点击瞬间的值。
 *
 * 【零常驻开销】只在 click 捕获阶段响应，不挂 MutationObserver、不轮询扫描：
 *   页面不动的时候本模块一次 DOM 查询都不做。
 */
(function () {
  'use strict';

  if (window.__DYC_CAMPAIGN_TICK__) return;

  var FLAG = 'campaignChannelTick';
  var SOURCE = '活动广场';          // 三段式来源词（AGENTS 第 21 条词表）

  /* ---- 锚点与上限（全为常量，先声明后使用，AGENTS 第 24 条） ---- */
  var ANCHOR_HEAD = '渠道品';
  var ANCHOR_TAIL = /报名|跟随/;
  var LABEL_MAX_LEN = 40;           // 文案节点自身的文本上限（再长就不是这枚勾选框了）
  var MAX_CLIMB = 15;               // 从勾选框往上找「行」的最大层数
  var MAX_ROW_TEXT = 800;           // 一行的文本上限，超过就说明爬过了头（到整表了）
  var MAX_ROW_BOXES = 12;           // 一行里的勾选框上限
  var MAX_SWEEP_NODES = 3000;       // 全选扫描的节点上限
  var SETTLE_MS = 60;               // 等平台把勾选态落定
  var VERIFY_MS = 120;              // 代点之后再回读一次状态，确认真的勾上了
  var LATE_MS = 260;                // 渠道品控件「勾了主品才渲染」时的补一次
  var SWEEP_SETTLE_MS = 180;        // 全选后等各行勾选态批量落定
  var SWEEP_RETRY_MS = 400;         // 第一次扫不到就再等一拍重扫一次

  var enabled = false;
  var prevFlag = null;              // 首次读到的状态要落进来（否则第一次拨开关静默）
  var selfClicking = 0;             // 自己代点的这一下不回声（防回环）
  var lastSayAt = 0;
  var lastSayText = '';

  /* ==========================================================
   * 一、基础工具
   * ========================================================== */

  function tight(s) {
    return String(s == null ? '' : s).replace(/[\s\u00a0]+/g, '');
  }

  function classNameOf(el) {
    return String((el && el.getAttribute && el.getAttribute('class')) || '');
  }

  /** 勾选框形态：原生 input / role=checkbox / 组件库的 checkbox 壳 */
  function isCheckboxLike(el) {
    if (!el || el.nodeType !== 1) return false;
    if (el.tagName === 'INPUT' && String(el.type || '').toLowerCase() === 'checkbox') return true;
    if (el.getAttribute && el.getAttribute('role') === 'checkbox') return true;
    var cls = classNameOf(el);
    if (!cls) return false;
    if (/checkbox-group|checkboxgroup/i.test(cls)) return false;
    return /checkbox/i.test(cls);
  }

  /** 从被点节点往上找 4 层内的勾选框 */
  function checkboxFrom(target) {
    var node = target, i = 0;
    while (node && node.nodeType === 1 && i++ < 4) {
      if (isCheckboxLike(node)) return node;
      node = node.parentElement;
    }
    return null;
  }

  /** 勾选态：原生用 checked，组件库用 aria-checked / class 上的 checked */
  function stateOf(box) {
    if (!box) return false;
    if (box.tagName === 'INPUT') return !!box.checked;
    var aria = box.getAttribute && box.getAttribute('aria-checked');
    if (aria === 'true') return true;
    if (aria === 'false') return false;
    var inner = box.querySelector && box.querySelector('input[type=checkbox]');
    if (inner) return !!inner.checked;
    var cls = classNameOf(box);
    if (/indeterminate/i.test(cls)) return false;
    if (/(^|[-_\s])checked/i.test(cls)) return true;
    return false;
  }

  /** 容器里包着的勾选框数量（判「这层是不是一整行」用不了，只用来防越界） */
  function countBoxes(el) {
    if (!el || !el.querySelectorAll) return 0;
    return el.querySelectorAll('input[type=checkbox], [role="checkbox"]').length;
  }

  function containsNode(root, node) {
    if (!root || !node) return false;
    return root === node || (root.contains && root.contains(node));
  }

  /** 代点一下：优先点原生 input（组件库的壳会把点击转给内部 input） */
  function fireClick(box) {
    if (!box) return false;
    var target = box;
    if (box.tagName !== 'INPUT') {
      var inner = box.querySelector && box.querySelector('input[type=checkbox]');
      if (inner) target = inner;
    }
    selfClicking++;
    try {
      target.click();
    } catch (e) {
      selfClicking = Math.max(0, selfClicking - 1);
      return false;
    }
    setTimeout(function () { selfClicking = Math.max(0, selfClicking - 1); }, 0);
    return true;
  }

  /* ==========================================================
   * 二、文案锚点：找「渠道品…报名」这一小段文字
   * ========================================================== */

  function textLooksLikeAnchor(el) {
    var t = tight(el && el.textContent);
    if (!t || t.length > LABEL_MAX_LEN) return false;
    if (t.indexOf(ANCHOR_HEAD) < 0) return false;
    return ANCHOR_TAIL.test(t);
  }

  /**
   * 在 root 内收集「最里层」的锚点文案节点。
   * 只有子层不再命中的那层才算 —— 外层容器的 textContent 把整行/整表都拼进来,
   * 长文案本来就会被 LABEL_MAX_LEN 挡掉,这里再按「最里层」收敛一次。
   */
  function anchorLeaves(root) {
    var out = [];
    if (!root || !root.querySelectorAll) return out;
    var nodes = root.querySelectorAll('span,label,div,p,i,em,b,a,font');
    var raw = [];
    for (var i = 0; i < nodes.length; i++) {
      if (textLooksLikeAnchor(nodes[i])) raw.push(nodes[i]);
    }
    for (var j = 0; j < raw.length; j++) {
      var hasInner = false;
      for (var k = 0; k < raw.length; k++) {
        if (raw[k] !== raw[j] && containsNode(raw[j], raw[k])) { hasInner = true; break; }
      }
      if (!hasInner) out.push(raw[j]);
    }
    return out;
  }

  function findAnchorLeaf(root) {
    var leaves = anchorLeaves(root);
    return leaves.length ? leaves[0] : null;
  }

  /** 从文案节点往外找「包着勾选框的那层壳」；**只认勾选框形态的节点**，
   *  绝不往上爬到行/表格那一层（爬上去就会把行当成控件，代点整行）。
   *
   *  2026-10-25 修（双向同步暴露的「假壳」）：旧版在找不到 checkbox 祖先时，
   *  会退而取「某个祖先容器里的第一个 input」—— 那个 input 往往是**主品勾选框**，
   *  于是「补勾」变成「把主品点掉」。现在只认两种形态：
   *    ① 文案的祖先里有 checkbox 形态的节点（label / 组件库壳）；
   *    ② 文案与勾选框是兄弟，且它们共同的父级里**只有这一枚**勾选框。
   *  两条都不满足 ⇒ 返回 null（宁可不认，也不碰别人的框）。
   */
  function controlHostFor(labelEl) {
    var node = labelEl, i = 0;
    while (node && node.nodeType === 1 && i++ < 3) {
      if (isCheckboxLike(node) && countBoxes(node) <= 2) return node;
      node = node.parentElement;
    }
    // 形态 ②：同一父级里只有一枚勾选框
    var p = labelEl.parentElement;
    var guard = 0;
    while (p && p.nodeType === 1 && guard++ < 2) {
      var inputs = p.querySelectorAll('input[type=checkbox], [role="checkbox"]');
      if (inputs.length === 1) {
        var only = inputs[0];
        if (isCheckboxLike(only)) return only;
        if (isCheckboxLike(only.parentElement)) return only.parentElement;
        return only;
      }
      p = p.parentElement;
    }
    return null;
  }

  /* ==========================================================
   * 三、行定位：从被点的主品勾选框爬到它所在的那一行
   * ========================================================== */

  /**
   * @returns {{row:Element, host:Element, label:Element}|null}
   *   null = 这枚勾选框不在「带渠道品的行」里（可能是表头全选、侧栏筛选等）
   */
  function locateRow(startBox) {
    if (!startBox) return null;
    var node = startBox.parentElement;
    var depth = 0;
    while (node && node.nodeType === 1 && node !== document.body && depth++ < MAX_CLIMB) {
      var t = tight(node.textContent);
      if (t.indexOf(ANCHOR_HEAD) >= 0 && ANCHOR_TAIL.test(t) && t.length <= MAX_ROW_TEXT) {
        if (countBoxes(node) > MAX_ROW_BOXES) return null;   // 爬过头了（整张表）
        var leaves = anchorLeaves(node);
        // 一行只该有一枚渠道品勾选框;多枚 = 这层是「多行的容器」,不是行 → 继续不认
        if (leaves.length > 1) return null;
        var label = leaves.length ? leaves[0] : null;
        if (!label) return null;
        var host = controlHostFor(label);
        if (!host) return null;
        // 命中的是我自己这枚 = 用户点的是渠道品勾选框，不是主品 → 不处理
        if (containsNode(host, startBox) || containsNode(startBox, host)) return null;
        return { row: node, host: host, label: label };
      }
      node = node.parentElement;
    }
    return null;
  }

  /** 行内的主品勾选框（第一枚不在渠道品控件里的勾选框） */
  function mainBoxInRow(row, host) {
    if (!row || !row.querySelectorAll) return null;
    var boxes = row.querySelectorAll('input[type=checkbox], [role="checkbox"], [class*="checkbox"]');
    for (var i = 0; i < boxes.length; i++) {
      var b = boxes[i];
      if (!isCheckboxLike(b)) continue;
      if (containsNode(host, b) || containsNode(b, host)) continue;
      if (countBoxes(b) !== 0) continue;      // 只要最里层的那枚
      return b;
    }
    return null;
  }

  /* ==========================================================
   * 四、表头全选
   * ========================================================== */

  /** 这枚勾选框是否就长在某个商品行里（行 = 只含一枚锚点、框数不越界的那层） */
  function insideRowBlock(box) {
    var node = box, depth = 0;
    while (node && node.nodeType === 1 && node !== document.body && depth++ < MAX_CLIMB) {
      var t = tight(node.textContent);
      if (t.indexOf(ANCHOR_HEAD) >= 0 && ANCHOR_TAIL.test(t) && t.length <= MAX_ROW_TEXT &&
          countBoxes(node) <= MAX_ROW_BOXES && anchorLeaves(node).length === 1) {
        return true;
      }
      node = node.parentElement;
    }
    return false;
  }

  /** 这枚勾选框像不像表头「全选」：在 th/thead/表头容器里，或在所有商品行上方 */
  function looksLikeSelectAll(box) {
    var node = box, i = 0;
    while (node && node.nodeType === 1 && i++ < 6) {
      var tag = String(node.tagName || '').toUpperCase();
      if (tag === 'TH' || tag === 'THEAD') return true;
      if (/thead|table-head|tableheader|header-row|list-header/i.test(classNameOf(node))) return true;
      node = node.parentElement;
    }
    // 已经长在某个商品行里（比如用户点的就是渠道品那枚框）⇒ 绝不可能是全选。
    // 2026-10-25 补：少了这道闸门，位置兜底会把「行内的框」误判成全选，
    // 于是用户手动取消渠道品又被一口气补回去。
    if (insideRowBlock(box)) return false;
    // 兜底：位置在所有「带渠道品的行」上方
    try {
      var boxRect = box.getBoundingClientRect();
      var rows = allRows();
      if (!rows.length) return false;
      var top = Infinity;
      for (var k = 0; k < rows.length; k++) {
        var r = rows[k].getBoundingClientRect();
        if (r.height > 0 && r.top < top) top = r.top;
      }
      return boxRect.top < top - 2;
    } catch (e) {
      return false;
    }
  }

  /** 页面上所有「带渠道品控件」的行（只在全选时跑一次，有节点上限） */
  function allRows() {
    var hosts = collectChannelHosts();
    var rows = [];
    for (var i = 0; i < hosts.length; i++) {
      var row = rowOfHost(hosts[i]);
      if (row && rows.indexOf(row) < 0) rows.push(row);
    }
    return rows;
  }

  function collectChannelHosts() {
    var out = [];
    var nodes;
    try {
      nodes = document.querySelectorAll('span,label,div,p,i,em,b,a');
    } catch (e) {
      return out;
    }
    var limit = Math.min(nodes.length, MAX_SWEEP_NODES);
    for (var i = 0; i < limit; i++) {
      var el = nodes[i];
      if (!textLooksLikeAnchor(el)) continue;
      var host = controlHostFor(el);
      if (host && out.indexOf(host) < 0) out.push(host);
    }
    return out;
  }

  /** 从渠道品控件往上找它所在的行：**必须同时装着主品勾选框**，
   *  否则爬到「渠道品那一小块」就停了，扫不到主品状态。 */
  function rowOfHost(host) {
    var node = host, depth = 0;
    while (node && node.nodeType === 1 && node !== document.body && depth++ < MAX_CLIMB) {
      var t = tight(node.textContent);
      if (t.indexOf(ANCHOR_HEAD) >= 0 && ANCHOR_TAIL.test(t) && t.length <= MAX_ROW_TEXT &&
          countBoxes(node) <= MAX_ROW_BOXES && anchorLeaves(node).length === 1) {
        if (mainBoxInRow(node, host)) return node;
      }
      node = node.parentElement;
    }
    return null;
  }

  /* ==========================================================
   * 五、说话（一次动作一条，三段式）
   * ========================================================== */

  function say(text, type, count, full) {
    var now = Date.now();
    if (text === lastSayText && now - lastSayAt < 1200) return;   // 连点不刷屏
    lastSayText = text;
    lastSayAt = now;
    var opts = { source: SOURCE, count: count || '' };
    if (full) opts.full = full;
    if (type === 'error' || type === 'alert') {
      if (typeof setStatus === 'function') { setStatus(text, type, opts); return; }
      if (typeof toast === 'function') { toast(text, type, opts); return; }
      return;
    }
    if (typeof toast === 'function') { toast(text, type || 'success', opts); return; }
    if (typeof setStatus === 'function') { setStatus(text, type || 'success', opts); }
  }

  /* ==========================================================
   * 六、主流程
   * ========================================================== */

  /**
   * 点击落定后判定。双向同步：
   *   · 主品「未勾 → 已勾」⇒ 补勾渠道品；
   *   · 主品「已勾 → 未勾」⇒ 一并取消渠道品（2026-10-25 用户追加：平台上并不会
   *     自动连带取消，所以这一半也要我们做）。
   */
  function afterClick(box) {
    if (!box || !box.isConnected) return;
    var hit = locateRow(box);
    if (hit) { handleRow(box, hit); return; }
    if (looksLikeSelectAll(box)) { sweep(0); return; }
    // 有些活动页的渠道品勾选框是「勾了主品才渲染」——等一拍再确认一次。
    // 仍找不到就什么都不做（宁可不做，也不乱点）。
    setTimeout(function () {
      if (!enabled || !box || !box.isConnected) return;
      var late = locateRow(box);
      if (late) handleRow(box, late);
    }, LATE_MS);
  }

  /** 单行同步：把渠道品拉到与主品一致；点完要**回读状态**再报，没成就说没成（不许谎报） */
  function handleRow(box, hit) {
    var host = hit.host;
    var want = stateOf(box);              // 主品现在的状态 = 渠道品该有的状态
    if (stateOf(host) === want) return;   // 已经一致：不重复点
    var verb = want ? '勾选' : '取消';
    if (!fireClick(host)) {
      say('渠道品没' + verb + '成功，请手动处理', 'alert', '',
        '这一行认出了渠道品勾选框，但代点没有成功，可能是平台改了控件结构。请手动处理，并把这一页反馈给助手。');
      return;
    }
    setTimeout(function () {
      if (stateOf(host) === want) {
        say(want ? '已联动勾选渠道品' : '已联动取消渠道品', 'success', '1 个');
      } else {
        say('渠道品没' + verb + '成功，请手动处理', 'alert', '',
          '已点到渠道品勾选框，但状态没变成预期（可能该渠道品不可报名/已报名，或平台拦下了这次点击）。请手动确认这一行。');
      }
    }, VERIFY_MS);
  }

  /**
   * 全选联动：把每一行的渠道品拉到与主品一致（勾上时补勾、取消时一并取消）。
   * 平台批量落定需要时间，所以先等 180ms；一个都没动成就再等一拍重扫一次
   * （重扫只处理还没一致的，已一致的不会重复点）。
   */
  function sweep(attempt) {
    setTimeout(function () { sweepOnce(attempt); }, attempt === 0 ? SWEEP_SETTLE_MS : SWEEP_RETRY_MS);
  }

  function sweepOnce(attempt) {
    if (!enabled) return;
    var hosts = collectChannelHosts();
    if (!hosts.length) return;                    // 这页没有渠道品，静默
    var tried = [];
    for (var i = 0; i < hosts.length; i++) {
      var host = hosts[i];
      if (!host.isConnected) continue;
      var row = rowOfHost(host);
      if (!row) continue;
      var main = mainBoxInRow(row, host);
      if (!main) continue;
      var want = stateOf(main);
      if (stateOf(host) === want) continue;       // 这一行已经一致
      if (fireClick(host)) tried.push({ host: host, want: want });
    }
    if (!tried.length) {
      // 一枚都没点：可能是各行勾选态还没落定，再等一拍重扫；仍为 0 就静默
      if (attempt === 0) sweep(1);
      return;
    }
    setTimeout(function () {
      var filled = 0, cleared = 0;
      for (var k = 0; k < tried.length; k++) {
        if (stateOf(tried[k].host) === tried[k].want) {
          if (tried[k].want) filled++; else cleared++;
        }
      }
      if (filled + cleared > 0) {
        if (filled && cleared) say('已联动同步渠道品', 'success', (filled + cleared) + ' 个');
        else if (filled) say('已联动勾选渠道品', 'success', filled + ' 个');
        else say('已联动取消渠道品', 'success', cleared + ' 个');
        return;
      }
      if (attempt === 0) { sweep(1); return; }    // 全没落定：再等一拍重扫一次
      say('渠道品没同步成功，请手动处理', 'alert', '',
        '表头全选后点到了渠道品勾选框，但状态没变成预期。请手动确认这些行。');
    }, VERIFY_MS);
  }

  /* ---- 事件：只认真实用户的点击 ---- */
  function onDocumentClick(e) {
    if (!enabled) return;
    if (selfClicking > 0) return;                 // 自己代点的那一下不回环
    var box = checkboxFrom(e.target);
    if (!box) return;
    // 捕获阶段读到的是「点击前」的状态，等平台把受控状态写进 DOM 再判
    setTimeout(function () { afterClick(box); }, SETTLE_MS);
  }

  /* ==========================================================
   * 七、生命周期
   * ========================================================== */

  function pageHasAnchor() {
    try {
      return !!document.body && tight(document.body.textContent).indexOf(ANCHOR_HEAD) >= 0;
    } catch (e) {
      return false;
    }
  }

  function start() {
    if (enabled) return;
    enabled = true;
    document.addEventListener('click', onDocumentClick, true);
  }

  function stop() {
    if (!enabled) return;
    enabled = false;
    document.removeEventListener('click', onDocumentClick, true);
  }

  if (typeof dycReadFlags === 'function') {
    dycReadFlags().then(function (flags) {
      prevFlag = !!(flags && flags[FLAG]);
      if (prevFlag) start();
    });
  }
  if (typeof dycWatchFlags === 'function') {
    dycWatchFlags(function (flags) {
      var on = !!(flags && flags[FLAG]);
      if (prevFlag !== null && on !== prevFlag && pageHasAnchor()) {
        say(on ? '已开启' : '已关闭', 'info');
      }
      prevFlag = on;
      if (on) start(); else stop();
    });
  }

  /* ---- 对外接口（自测 / 调试用） ---- */
  window.__DYC_CAMPAIGN_TICK__ = {
    start: start,
    stop: stop,
    isEnabled: function () { return enabled; },
    locateRow: locateRow,
    controlHostFor: controlHostFor,
    findAnchorLeaf: findAnchorLeaf,
    mainBoxInRow: mainBoxInRow,
    rowOfHost: rowOfHost,
    collectChannelHosts: collectChannelHosts,
    looksLikeSelectAll: looksLikeSelectAll,
    insideRowBlock: insideRowBlock,
    stateOf: stateOf,
    fireClick: fireClick,
    afterClick: afterClick,
    sweepOnce: sweepOnce,
    onDocumentClick: onDocumentClick
  };
})();
