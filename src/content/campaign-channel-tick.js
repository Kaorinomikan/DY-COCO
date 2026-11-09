/** 活动广场：由独立按钮补勾已选主商品的渠道品，逐屏扫描、按商品去重并回读最新节点。 */
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
  /* 全选扫描的节点上限：2026-11-08 从 3000 提到 12000。
     3000 只够 6 行左右的普通表格（含页头/侧栏），再往下就没扫到 —— 与用户报的
     「超过 6 个就不联动」正好重合；虚拟列表一屏只有几百个节点，这里给足余量。 */
  var MAX_SWEEP_NODES = 12000;
  /* ---- 逐屏滚动（2026-11-08 新增，虚拟列表） ---- */
  var SCROLL_ROOM_MIN = 40;         // 「内容高 − 可见高」超过这么多才算可滚容器
  var SCROLL_SETTLE_MS = 300;       // 滚一屏后等虚拟列表重渲染
  var SCROLL_IDLE_MS = 620;         // 滚不动时多等一拍再判定到底
  var CLICK_GAP_MS = 70;            // 逐行代点的间隔（平台受控组件，点太快会被吞）
  var STEP_RATIO = 0.55;            // 步长 = 可见高 × 0.55（留重叠，防行被跨过去）
  var STEP_MIN = 240;
  var STEP_MAX = 720;
  var MAX_SWEEP_ROUNDS = 40;        // 最多滚多少屏（40 屏 ≈ 240 行）
  var MAX_SWEEP_TICKS = 400;        // 最多代点多少行（安全阀）
  var MAX_STALE_PER_SCREEN = 40;    // 单屏内允许「平台重渲染导致节点失效」的次数

  var enabled = false;
  var prevFlag = null;              // 首次读到的状态要落进来（否则第一次拨开关静默）

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
    try {
      target.click();
    } catch (e) {
      return false;
    }
    return true;
  }

  /* ==========================================================
   * 二、文案锚点：找「渠道品…报名」这一小段文字
   * ========================================================== */

  function textLooksLikeAnchor(el) {
    /* 先按「原始文本」做两道便宜闸门，再化简：全表扫描节点数上万时，
       tight() 会为每个容器拼一次整棵子树的文本，是这里最贵的一步。 */
    var raw = el && el.textContent;
    if (!raw || raw.length > LABEL_MAX_LEN * 3) return false;
    if (raw.indexOf(ANCHOR_HEAD) < 0) return false;
    var t = tight(raw);
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

  function sleep(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms); });
  }

  function scrollPos(t) {
    if (!t) return 0;
    try { return t.scrollTop || 0; } catch (e) { return 0; }
  }

  function scrollSet(t, v) {
    if (!t) return;
    try { t.scrollTop = v; } catch (e) { /* 老内核忽略 */ }
  }

  /** 商品行所在的可滚动容器：从行往上找「内容高 − 可见高 > 40」的祖先，最内层在前 */
  function scrollTargets(row) {
    var list = [];
    var node = row ? row.parentElement : null;
    var guard = 0;
    while (node && node !== document.body && node !== document.documentElement && guard++ < 30) {
      var room = 0;
      try { room = node.scrollHeight - node.clientHeight; } catch (e) { room = 0; }
      if (room > SCROLL_ROOM_MIN) list.push(node);
      node = node.parentElement;
    }
    var tails = [document.body, document.documentElement];
    for (var i = 0; i < tails.length; i++) {
      var t = tails[i];
      if (!t || list.indexOf(t) >= 0) continue;
      var r = 0;
      try { r = t.scrollHeight - t.clientHeight; } catch (e2) { r = 0; }
      if (r > SCROLL_ROOM_MIN) list.push(t);
    }
    return list;
  }

  /** 滚动器：记住原位 / 回顶 / 滚一步 / 还原。都找不到可滚容器 ⇒ null（= 不用滚） */
  function makeMover(row) {
    var targets = scrollTargets(row);
    if (!targets.length) return null;
    var origin = [];
    var viewH = 0;
    var bestRoom = -1;
    for (var i = 0; i < targets.length; i++) {
      origin.push(scrollPos(targets[i]));
      var room = 0;
      try { room = targets[i].scrollHeight - targets[i].clientHeight; } catch (e) { room = 0; }
      if (room > bestRoom) {
        bestRoom = room;
        viewH = targets[i].clientHeight || 0;
      }
    }
    /* 步长必须按**最内层**（真正装商品行的容器）算：外层页面通常比列表高，
       拿它算步长会一屏跨过中间的行，而虚拟滚动不会渲染被跨过的行 ⇒ 等于漏勾。
       量不到最内层的高度（老内核/无布局）才退回「剩余空间最大」的那个。 */
    var innerH = 0;
    try { innerH = targets[0].clientHeight || 0; } catch (e2) { innerH = 0; }
    if (innerH > 0) viewH = innerH;
    /* 行高：用于保证每步至少重叠一行，绝不跨屏跳过 */
    var rowH = 0;
    try { rowH = row.getBoundingClientRect().height || 0; } catch (e3) { rowH = 0; }
    return {
      viewH: viewH,
      rowH: rowH,
      toTop: function () {
        /* 只把真正承载列表的那一层回顶（第一个还能滚的）；整页跟着滚属于副作用，
           所以一旦有目标回到 0 就停手 —— 收工时统一还原。 */
        for (var k = 0; k < targets.length; k++) {
          if (scrollPos(targets[k]) > 0) { scrollSet(targets[k], 0); return; }
        }
      },
      /** 滚一步。返回实际位移（0 = 到底） */
      stepBy: function (len) {
        for (var k = 0; k < targets.length; k++) {
          var t = targets[k];
          var before = scrollPos(t);
          scrollSet(t, before + len);
          var after = scrollPos(t);
          if (Math.abs(after - before) >= 8) return after - before;
        }
        return 0;
      },
      restore: function () {
        for (var k = 0; k < targets.length; k++) scrollSet(targets[k], origin[k]);
      }
    };
  }

  // 商品 ID 优先；无 ID 的旧页面用稳定的行文案，不能用虚拟列表的 DOM 节点作身份。
  function rowKey(row) {
    var text = tight(row.textContent);
    var id = text.match(/ID[:：]?(\d{6,})/i);
    return id ? id[1] : (row.getAttribute('data-row-key') || text);
  }

  function available(host) {
    var input = host.matches('input') ? host : host.querySelector('input');
    return !(host.getAttribute('aria-disabled') === 'true' ||
      /(^|[-_\s])disabled/i.test(classNameOf(host)) || (input && input.disabled));
  }

  function latestHost(key) {
    var hosts = collectChannelHosts();
    for (var i = 0; i < hosts.length; i++) {
      var row = rowOfHost(hosts[i]);
      if (row && rowKey(row) === key) return hosts[i];
    }
    return null;
  }

  async function syncScreen(stat) {
    var stale = 0;
    while (enabled && stat.seq === runSeq) {
      var hosts = collectChannelHosts();
      var clicked = false;
      for (var i = 0; i < hosts.length; i++) {
        var host = hosts[i];
        if (!host.isConnected) break;
        var row = rowOfHost(host);
        var main = row && mainBoxInRow(row, host);
        if (!main || !stateOf(main)) continue;
        var key = rowKey(row);
        if (stat.seen.has(key)) continue;
        stat.seen.add(key);
        if (stateOf(host)) { stat.ready++; continue; }
        if (!available(host)) { stat.skipped++; continue; }
        if (stat.tried >= MAX_SWEEP_TICKS) { stat.limited = true; return; }
        stat.tried++;
        if (!fireClick(host)) { stat.failed++; continue; }
        await sleep(CLICK_GAP_MS);
        // React 可能已经销毁旧节点；只有当前页面里同一商品的新节点才作成功依据。
        var current = latestHost(key);
        if (current && stateOf(current)) stat.filled++;
        else stat.failed++;
        progress(stat);
        clicked = true;
        break; // 每次点击后重新收集，避免继续使用被重建的这一屏。
      }
      if (!clicked) return;
      if (stale++ >= MAX_STALE_PER_SCREEN) { stat.limited = true; return; }
    }
  }

  /** 多屏时给一条进行中的状态（一屏内不打扰，保持第一版的安静）。
   *  注意 running 态的 count 会被消息层丢掉（dialog.js「running 只显示转圈」），
   *  所以这里不塞数字，进度用户看页面上的勾选框就行。 */
  function progress(stat) {
    if (!stat.scrolled || typeof setStatus !== 'function') return;
    try {
      setStatus('正在检查已选商品渠道品', 'running', { source: SOURCE });
    } catch (e) { /* 忽略 */ }
  }

  /** 步长：按可见高的一半多滚动；已知行高时**至少压住一行**，绝不跨过没渲染的行 */
  function stepLenFor(mover) {
    var len = mover.viewH > 0 ? Math.round(mover.viewH * STEP_RATIO) : STEP_MIN;
    if (mover.viewH > 0 && mover.rowH > 0) {
      len = Math.min(len, Math.round(mover.viewH - mover.rowH));
    }
    return Math.min(STEP_MAX, Math.max(60, len));
  }

  function walkDown(stat, mover) {
    var idle = 0;
    var len = stepLenFor(mover);

    function round() {
      if (!enabled || stat.seq !== runSeq) return Promise.resolve();
      return syncScreen(stat).then(function () {
        if (stat.rounds++ >= MAX_SWEEP_ROUNDS || stat.tried >= MAX_SWEEP_TICKS) { stat.limited = true; return; }
        var moved = mover.stepBy(len);
        if (Math.abs(moved) >= 8) { stat.scrolled = true; idle = 0; } else idle++;
        if (idle >= 2) return;                      // 连续两屏滚不动 = 到底
        progress(stat);
        return sleep(Math.abs(moved) >= 8 ? SCROLL_SETTLE_MS : SCROLL_IDLE_MS).then(round);
      });
    }

    return round();
  }

  var sweeping = false;
  var runSeq = 0;
  var buttonHost = null;
  var actionButton = null;
  var observer = null;
  var mountTimer = null;

  async function sweepRun() {
    var stat = { tried: 0, filled: 0, ready: 0, skipped: 0, failed: 0,
      rounds: 0, scrolled: false, limited: false, seen: new Set(), seq: runSeq };
    var hosts = collectChannelHosts();
    var row = null;
    for (var i = 0; i < hosts.length && !row; i++) row = rowOfHost(hosts[i]);
    var mover = row ? makeMover(row) : null;
    try {
      if (mover) {
        mover.toTop();
        await sleep(SCROLL_SETTLE_MS);
        await walkDown(stat, mover);
      } else await syncScreen(stat);
      return stat;
    } finally {
      if (mover) mover.restore();
    }
  }

  async function sweep() {
    if (!enabled || sweeping) return;
    sweeping = true;
    var seq = runSeq;
    updateButton();
    try {
      var stat = await sweepRun();
      if (!enabled || seq !== runSeq) return;
      var incomplete = stat.failed || stat.skipped || stat.limited;
      say('已选商品的渠道品', incomplete ? 'alert' : 'success', '补勾 ' + stat.filled + ' 项',
        '本次成功补勾 ' + stat.filled + ' 项，原已勾选 ' + stat.ready + ' 项，跳过不可用 ' +
        stat.skipped + ' 项，未确认成功 ' + stat.failed + ' 项。按主商品行计数。' +
        (stat.limited ? '列表较长，本次达到扫描上限，请检查剩余商品。' : ''));
    } catch (e) {
      say('已选商品的渠道品', 'alert', '检查中断', '渠道品检查中断，请手动确认勾选状态后重试。');
    } finally {
      sweeping = false;
      updateButton();
    }
  }

  function updateButton() {
    if (!actionButton) return;
    actionButton.disabled = sweeping;
    actionButton.textContent = sweeping ? '正在勾选渠道品…' : '自动勾选适用的渠道品';
  }

  function mountButton() {
    if (!enabled || !document.body) return;
    var candidates = document.querySelectorAll('button,[role="button"]');
    var anchor = null;
    for (var i = 0; i < candidates.length; i++) {
      if (/^批量修改工具/.test(tight(candidates[i].textContent))) { anchor = candidates[i]; break; }
    }
    if (!anchor) {
      if (buttonHost) buttonHost.remove();
      return;
    }
    if (buttonHost && buttonHost.isConnected && buttonHost.previousElementSibling === anchor) return;
    if (buttonHost) buttonHost.remove();
    buttonHost = document.createElement('span');
    buttonHost.setAttribute('data-dyc-campaign-tick', '');
    buttonHost.style.cssText = 'display:inline-flex;vertical-align:middle;margin-left:16px;flex:0 0 auto;';
    var shadow = buttonHost.attachShadow({ mode: 'open' });
    var style = document.createElement('style');
    style.textContent = ':host{all:initial;display:inline-flex}button{all:initial;box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;width:max-content;white-space:nowrap;height:32px;padding:0 16px;border:1px solid #d9d9d9;border-radius:4px;background:#fff;color:#333;font:14px Arial,sans-serif;cursor:pointer}button:hover{color:#1677ff;border-color:#1677ff}button:focus-visible{outline:2px solid #1677ff;outline-offset:2px}button:disabled{cursor:wait;color:#999}';
    shadow.appendChild(style);
    actionButton = document.createElement('button');
    actionButton.type = 'button';
    actionButton.title = '仅补勾已选主商品的可用渠道品，完成后显示本次补勾数量。';
    actionButton.addEventListener('click', sweep);
    shadow.appendChild(actionButton);
    updateButton();
    anchor.insertAdjacentElement('afterend', buttonHost);
  }

  function pageHasAnchor() {
    return !!document.querySelector('[data-dyc-campaign-tick]');
  }

  function start() {
    if (enabled) return;
    enabled = true;
    mountButton();
    observer = new MutationObserver(function () {
      if (mountTimer !== null) return;
      mountTimer = setTimeout(function () { mountTimer = null; mountButton(); }, 150);
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  function stop() {
    enabled = false;
    runSeq++;
    if (observer) observer.disconnect();
    observer = null;
    clearTimeout(mountTimer);
    mountTimer = null;
    if (buttonHost) buttonHost.remove();
    buttonHost = null;
    actionButton = null;
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
    stateOf: stateOf,
    fireClick: fireClick,
    sweep: sweep,
    sweepRun: sweepRun,
    syncScreen: syncScreen,
    makeMover: makeMover,
    scrollTargets: scrollTargets,
    mountButton: mountButton
  };
})();
