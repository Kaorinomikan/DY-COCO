/**
 * 渠道品页 · 一键「下架并删除」（2026-10-24 新增，计划 #1）
 * ============================================================
 * 【用户口径】
 *   渠道品只有「已下架」状态才允许删除，而平台的删除入口藏在操作列的
 *   「更多」子菜单里 —— 下架、等列表刷新、再进子菜单、再删除，一次要四步。
 *   本功能把它压成**一次点击**：
 *     · 单行按钮：落在操作列里，与「查看 / 编辑 / 下架 / 复制 / 更多」
 *       同一列、同一套竖排样式（用户要求「垂直位置一致」）；
 *     · 批量按钮：勾选 ≥1 个商品后，出现在「更多操作」右侧（用户指定位置）；
 *     · 两处都有确认弹窗（删除不可恢复），批量弹窗列出前几个商品名。
 *
 * 【最终形态（2026-10-25 第四改，定案）】
 *   一次点击，**两个参数直接提交**：下架 POST →（不等）→ 删除 POST。
 *   用户原话：「改成最最开始的，直接提交参数就好了，忽略异常。」
 *   所以：
 *     · 不模拟点击、不等列表刷新、不为了「显得像人」插长间隔；
 *     · 成功或失败只看接口返回与最终结果，不把平台提示预先判为成功或失败；
 *     · 删除被拒（下架状态还没落库）自动短间隔重试两次（1.5s / 2.5s）。
 *   2026-10-25 第五改（用户定）：
 *     · **完成即自动刷新页面** —— 成功结果确认后刷新；失败留在现场便于查看原因；
 *     · **批量按钮常开** —— 未勾选时不隐藏，而是灰底不可点（之前是直接消失）；
 *     · 提示语整体重写：不再讲历史演进，只说用户要做的选择、会发生什么。
 *   走过的弯路（备查）：
 *     · 模拟点击：能跑通但要等整表刷新，用户反馈「用一次就被要求刷新网页」；
 *     · 长间隔直提（停 5 秒）：用户嫌慢，且平台该弹异常还是弹；
 *     · 让用户点两次：用户原话「只会下架不会删除」—— 要的是一次点击跑完全程。
 *
 * 【按钮文案随状态变】售卖中显示「下架并删除」，已下架显示「删除该渠道品」；
 *   批量按钮同理（「批量下架并删除」/「批量删除」）。
 *
 * 【接口（2026-10-24 接口取样实证）】
 *   ① 下架 POST /product/tproduct/update_channel_product_status
 *      body {main_product_id, channel_id, channel_type, status:0, appid, __token, _bid, _lid}
 *   ② 删除 POST /product/tproduct/remove_channel_product
 *      body {main_product_id, channel_id, channel_type, appid, __token, _bid, _lid}
 *   ③ 状态/渠道类型 GET /product/tproduct/list_channel_product?status=-1&…
 *      channel_type **不写死**：接口取样里是 4（专属达人），清库存那套按 3 写死过。
 *
 * 【请求怎么发】经 MAIN world 探针转发（页面世界 XHR 自动带平台请求库注入的安全头）；
 *   探针不在场才退回隔离 fetch；拿不到 __token 直接不发（盲发特征最强）。
 *
 * 【几何】按钮进平台自己的竖排容器，位置交给平台布局决定，不算任何坐标
 *   （#73 歪按钮、search.js 跑位的教训：绝对定位必被 transform 祖先抢占）。
 *
 * 【依赖】flags.js（开关）/ dialog.js（弹窗与消息条）/ stock-net-probe.js（转发）。
 *   三者都排在功能层之前。
 */
(function () {
  'use strict';

  if (window.__DYC_CHANNEL_DEL__) return;

  var SOURCE = '下架删除';          // 消息三段式的「来源」段（第 21 条）
  var CLS_ROW = 'dyc-cd-btn';       // 行内「下架并删除」
  var CLS_BATCH = 'dyc-cd-batch';   // 批量「下架并删除」

  var enabled = false;              // 功能开关（dybFeatures.channelOfflineDelete）
  var taskEpoch = 0;
  var activeTask = null;

  function taskValid(task) {
    return enabled && task && task.epoch === taskEpoch && task.url === location.href;
  }

  function invalidateTask() {
    taskEpoch++;
    if (reloadTimer) { clearTimeout(reloadTimer); reloadTimer = null; }
  }

  function checkTask() {
    if (taskValid(activeTask)) return;
    var error = new Error('已停止后续操作；已提交的请求无法撤回，请核对平台结果。');
    error.cancelled = true;
    throw error;
  }

  var running = false;              // 执行锁：同一时刻只跑一个任务
  var observer = null;
  var scanTimer = null;
  var routeTimer = null;
  var lastUrl = location.href;
  var lastScanKey = '';             // 扫描结果去重：状态不变不刷调试日志

  /* ==========================================================
   * 一、基础工具
   * ========================================================== */

  function tight(s) {
    return String(s == null ? '' : s).replace(/\s+/g, '');
  }

  function sleep(ms) {
    return new Promise(function (r) { setTimeout(r, ms); }).then(checkTask);
  }

  function say(msg) {
    if (typeof debugLog === 'function') debugLog('[下架删除] ' + msg);
  }

  /** 当前是否渠道品管理列表页 */
  function onChannelPage() {
    return /^\/ffa\/g\/channel-goods-manage\/list/.test(location.pathname);
  }

  /** 本扩展自己造的节点（含消息条 / 弹窗 / 调试面板 / 注入的样式表），扫描时要跳过 */
  function isOwnNode(node) {
    if (!node || node.nodeType !== 1) return false;
    if (node.id === 'dyb-dialog-root' || node.id === 'dyb-status-bar' ||
        node.id === 'dyb-debug-panel' || node.id === 'dyb-debug-log' ||
        node.id === 'dyc-cd-style') return true;
    if (node.classList) {
      if (node.classList.contains(CLS_ROW) || node.classList.contains(CLS_BATCH)) return true;
      if (node.classList.contains('dyb-status') || node.classList.contains('dyb-panel') ||
          node.classList.contains('dyb-mask')) return true;
    }
    if (node.closest) {
      if (node.closest('.' + CLS_ROW) || node.closest('.' + CLS_BATCH)) return true;
      if (node.closest('#dyb-dialog-root') || node.closest('#dyb-status-bar') ||
          node.closest('#dyb-debug-panel')) return true;
    }
    return false;
  }

  /* ==========================================================
   * 二、行与操作列识别（只用于注入与取 ID，不再用于点击）
   * ========================================================== */

  /** 当前页的渠道品行（真机采样：ecom-g-table-row；兜底认通用表格行） */
  function channelRows() {
    var list = [];
    var rows = document.querySelectorAll('tr[class*="ecom-g-table-row"], tr[class*="table-row"]');
    for (var i = 0; i < rows.length; i++) {
      var tr = rows[i];
      if (!tr.cells || tr.cells.length < 3) continue;
      // 只认渠道品行：行内必须带「渠道ID」标签（主品列表没有这个标签）
      if (!/渠道\s*ID/i.test(tr.textContent || '')) continue;
      list.push(tr);
    }
    return list;
  }

  /** 在 root 里找到「文字完全等于 text」的最深元素 */
  function leafByText(root, text) {
    if (!root) return null;
    var want = tight(text);
    var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    var node, hit = null;
    while ((node = walker.nextNode())) {
      if (tight(node.textContent) !== want) continue;
      var p = node.parentElement;
      if (!p) continue;
      if (!hit || p.contains(hit) === false) hit = p;
    }
    return hit;
  }

  /**
   * 找本行操作列。
   *
   * 判据（2026-10-24 第二改）：**不能再以「更多」为准入门槛** —— 真机截图显示
   * 「商家自卖」类型的渠道品行操作列里根本没有「更多」（只有 查看/编辑/下架/复制），
   * 而「达人带货 / 专属达人带货」才有。按「更多」判活会漏掉一半的渠道品类型。
   *
   * 现在的做法：锚点按「更多 → 复制 → 编辑」依次降级找，再向上收敛到那个
   * 同时含「查看」「编辑」「下架/上架」且**文本很短**的容器（操作列就十来个字；
   * 用长度上限挡住「整行/整格」这种大容器，避免落位到别处）。
   *
   * @returns {{box:Element, more:Element}|null} more = 实际用作样式样板的项
   */
  function findActionColumn(tr) {
    var anchors = ['更多', '复制', '编辑'];
    var anchor = null;
    for (var i = 0; i < anchors.length && !anchor; i++) {
      anchor = leafByText(tr, anchors[i]);
    }
    if (!anchor) return null;

    var box = anchor.parentElement;
    for (var k = 0; k < 6 && box && box !== tr; k++) {
      var t = tight(box.textContent);
      // 「下架|上架」不再作为必备条件（2026-10-24 第九改，用户要求按钮
      // 「无论上架还是下架都要出现」）：审核中/其他状态的行可能两者都没有，
      // 用「复制」兜住 —— 操作列里一定有它。文本长度上限继续挡大容器。
      if (t.length <= 30 &&
          t.indexOf('查看') >= 0 && t.indexOf('编辑') >= 0 &&
          (t.indexOf('下架') >= 0 || t.indexOf('上架') >= 0 || t.indexOf('复制') >= 0)) {
        return { box: box, more: anchor };
      }
      box = box.parentElement;
    }
    return null;
  }

  /** 行内找某个动作项（文案完全匹配），排除本扩展自己注入的节点 */
  function findRowAction(tr, re) {
    if (!tr) return null;
    var col = findActionColumn(tr);
    var scope = col ? col.box : tr;
    var walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT);
    var node;
    while ((node = walker.nextNode())) {
      var t = tight(node.textContent);
      if (!t || !re.test(t)) continue;
      var p = node.parentElement;
      if (!p || isOwnNode(p)) continue;
      return p;
    }
    return null;
  }

  /** 按渠道品 ID 找行（列表刷新后旧引用会失效，用 ID 重新定位） */
  function findRowByChannelId(channelId) {
    if (!channelId) return null;
    var rows = channelRows();
    for (var i = 0; i < rows.length; i++) {
      if (String(rows[i].textContent || '').indexOf(channelId) >= 0) return rows[i];
    }
    return null;
  }

  /** 商品名（行首到「渠道ID」之前的那段，保留完整名称） */
  function rowTitle(tr) {
    var text = String(tr.textContent || '').replace(/\s+/g, ' ').trim();
    var idx = text.search(/渠道\s*ID/i);
    var name = idx > 0 ? text.slice(0, idx).trim() : '';
    if (!name) name = '该渠道品';
    return name;
  }

  /** 渠道品 / 主品双 ID（两个接口都要，缺一不可） */
  function rowMeta(tr) {
    var text = String(tr.textContent || '');
    var ch = text.match(/渠道\s*ID\s*[:：]?\s*(\d{10,})/i);
    var main = text.match(/主品\s*ID\s*[:：]?\s*(\d{10,})/i);
    if (ch && main) return { channelId: ch[1], mainProductId: main[1] };
    if (ch) return { channelId: ch[1], mainProductId: '' };
    return null;
  }

  /* ==========================================================
   * 三、按钮注入
   * ========================================================== */

  /**
   * 从 like 元素复制几何样式（内联 + !important，抗平台样式覆盖）。
   *
   * ⚠️ 2026-10-24 第三改修的真 bug：setProperty 的第一个参数必须是
   * **CSS 属性名（连字符写法）**，写 'fontSize' 这种驼峰在浏览器里等于
   * 什么也没设 —— 上一版整套复制其实一直是空转（按钮看着还行，是平台
   * 自己的 td a 样式在兜着）。这里统一用连字符写法。
   *
   * 不复制 margin* / display：
   *   · 上下间距由调用方显式给（避免与平台自身的 margin 叠成双倍）；
   *   · display 交给父容器布局决定，强行覆盖反而会把 flex 项顶歪。
   */
  function copyLook(el, like) {
    var cs = window.getComputedStyle(like);
    var props = [
      'font-size', 'font-family', 'font-weight', 'line-height', 'letter-spacing',
      'color', 'text-align', 'padding-top', 'padding-bottom',
      'padding-left', 'padding-right', 'border-radius', 'height'
    ];
    for (var i = 0; i < props.length; i++) {
      var v = cs.getPropertyValue(props[i]);
      if (v) el.style.setProperty(props[i], v, 'important');
    }
  }

  /** 造一个与平台操作项同款的文字按钮 */
  function makeActionItem(like, label, tip, onClick) {
    var a = document.createElement('a');
    a.href = 'javascript:void(0)';
    a.className = CLS_ROW;
    a.textContent = label;
    a.title = tip || '';
    copyLook(a, like);
    a.style.setProperty('cursor', 'pointer', 'important');
    a.style.setProperty('text-decoration', 'none', 'important');
    a.style.setProperty('white-space', 'nowrap', 'important');

    // 捕获阶段拦掉，避免平台的表格行点击委托被顺带触发
    a.addEventListener('pointerdown', function (e) { e.stopPropagation(); }, true);
    a.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      onClick();
    }, true);
    return a;
  }

  /**
   * 给一行注入按钮。
   * 文案随行状态变（2026-10-25 用户定「分两步」）：
   *   售卖中 → 「下架该渠道品」（只下架）
   *   已下架 → 「删除该渠道品」（只删除）
   * 已存在的按钮也在这里做一次文案校正 —— 下架成功后页面重扫，标签要自己换。
   */
  function injectRow(tr) {
    var offlineNow = rowLooksOffline(tr);
    var wantLabel = offlineNow ? '删除该渠道品' : '下架并删除';

    var exist = tr.querySelector('.' + CLS_ROW);
    if (exist) {
      if (exist.textContent !== wantLabel) exist.textContent = wantLabel;
      return false;
    }

    var col = findActionColumn(tr);
    if (!col || !col.box) return false;

    // 字号基准取「查看」那一项（操作列里必定存在、且是标准项）；
    // 拿「更多」当样板时真机字号会偏大一圈（用户 2026-10-24 截图指出）。
    var sizeRef = leafByText(tr, '查看') || col.more;

    var item = makeActionItem(
      sizeRef,
      wantLabel,
      offlineNow
        ? '删除该渠道品；删除不可恢复，主品不受影响'
        : '先下架再删除；删除不可恢复，主品不受影响',
      function () { handleSingle(tr); }
    );
    // 与上面一项留出间隔（用户 2026-10-24 反馈「按钮要有一些间隔位」）：
    // 平台各操作项之间的间距来自容器布局，新加的项拿不到，只能自己给。
    item.style.setProperty('margin-top', '8px', 'important');
    // 危险动作走红色，与上面那排蓝色常规操作明确分开（与批量按钮同一套语义）
    item.style.setProperty('color', '#ff4d4f', 'important');
    item.style.setProperty('font-weight', '500', 'important');
    col.box.appendChild(item);

    // 落位自检：与「查看」应当在同一列（left 相差 < 4px）—— 偏差大就记一笔，
    // 用户反馈「歪了」时日志里直接能看到差多少，不用再猜布局。
    try {
      var a = item.getBoundingClientRect();
      var b = sizeRef.getBoundingClientRect();
      if (Math.abs(a.left - b.left) > 4) {
        say('落位偏差：我的 left=' + Math.round(a.left) +
            '，「查看」left=' + Math.round(b.left) +
            '（容器 display=' + window.getComputedStyle(col.box).display + '）');
      }
    } catch (e) { /* 布局读取失败不影响注入 */ }

    return true;
  }

  /** 扫描并注入所有渠道品行的按钮 */
  function injectRows() {
    var rows = channelRows();
    var added = 0, has = 0, noCol = 0;
    for (var i = 0; i < rows.length; i++) {
      var tr = rows[i];
      if (tr.querySelector('.' + CLS_ROW)) { has++; continue; }
      if (injectRow(tr)) added++;
      else noCol++;
    }
    return { rows: rows.length, added: added, has: has, noCol: noCol };
  }

  /**
   * 找批量操作栏（含「批量上架」「批量下架」「更多操作」的那一行）。
   * 找到后缓存节点：这个函数靠全文档 TreeWalker 找锚点，而 scan() 由
   * MutationObserver 每 300ms 就可能跑一次 —— 每次都全文档扫一遍，
   * 在抖店这种频繁刷新的页面上是白烧 CPU。缓存失效（节点离树）才重找。
   */
  var batchBarCache = null;

  function findBatchBar() {
    if (batchBarCache && batchBarCache.isConnected &&
        tight(batchBarCache.textContent).indexOf('更多操作') >= 0) {
      return batchBarCache;
    }
    batchBarCache = null;

    var anchor = leafByText(document.body, '批量上架');
    if (!anchor) return null;
    var box = anchor.parentElement;
    for (var i = 0; i < 8 && box && box !== document.body; i++) {
      var t = tight(box.textContent);
      if (t.indexOf('批量上架') >= 0 && t.indexOf('批量下架') >= 0 &&
          t.indexOf('更多操作') >= 0) {
        batchBarCache = box;
        return box;
      }
      box = box.parentElement;
    }
    return null;
  }

  /** 已勾选数量（从批量栏文案里读「已选 N 条」） */
  function selectedCount(bar) {
    var scope = bar || document.body;
    var m = /已选(?:择)?\s*(\d+)/.exec(tight(scope.textContent));
    if (m) return parseInt(m[1], 10);
    return -1;
  }

  /** 一个渠道品行是否被勾选 */
  function isRowChecked(tr) {
    var cb = tr.querySelector('input[type="checkbox"]');
    if (cb) return !!cb.checked;
    // 平台自绘勾选：首列里带 checked / selected 类
    var first = tr.cells && tr.cells[0];
    if (first && first.querySelector('[class*="checked"], [class*="Checked"], [class*="selected"]')) {
      return true;
    }
    return false;
  }

  /** 当前已勾选的渠道品行 */
  function checkedRows() {
    var rows = channelRows();
    var out = [];
    for (var i = 0; i < rows.length; i++) {
      if (isRowChecked(rows[i])) out.push(rows[i]);
    }
    return out;
  }

  /**
   * 批量按钮的专属样式（hover 需要真 CSS，内联写不了）。
   * 一次性注入，节点带 id —— 扫描时要把它当自己人（见 isOwnNode）。
   */
  function ensureStyle() {
    if (document.getElementById('dyc-cd-style')) return;
    var st = document.createElement('style');
    st.id = 'dyc-cd-style';
    st.textContent =
      '.dyc-cd-batch{transition:background .15s ease,box-shadow .15s ease}' +
      '.dyc-cd-batch:hover{background:#d9363e !important;border-color:#d9363e !important;' +
      'box-shadow:0 2px 6px rgba(217,54,62,.35) !important}' +
      '.dyc-cd-btn:hover{opacity:.72}';
    (document.head || document.documentElement).appendChild(st);
  }

  /**
   * 批量按钮的可用/禁用外观。
   * 2026-10-25 用户定：「批量下架并删除保持常开显示，如果没有勾选商品就是灰色。」
   * 所以按钮**一直挂着**，只是未勾选时灰掉 + 不可点，而不是消失。
   */
  function applyBatchEnabled(btn, on) {
    btn.disabled = !on;
    btn.style.setProperty('cursor', on ? 'pointer' : 'not-allowed', 'important');
    btn.style.setProperty('background', on ? '#ff4d4f' : '#f2f3f5', 'important');
    btn.style.setProperty('color', on ? '#fff' : '#b8bcc4', 'important');
    btn.style.setProperty('border-color', on ? '#ff4d4f' : '#e3e5e9', 'important');
    btn.style.setProperty('box-shadow', on ? '0 1px 2px rgba(255,77,79,.3)' : 'none', 'important');
    btn.title = on
      ? '逐条下架并删除，无法恢复；全部成功后刷新，失败保留页面'
      : '先在左边勾选要处理的渠道品';
  }

  /** 注入 / 更新批量按钮（常开；未勾选时灰色不可点） */
  function syncBatchButton() {
    var bar = findBatchBar();
    var exist = document.querySelector('.' + CLS_BATCH);

    if (!bar) {
      if (exist) exist.remove();
      return 0;
    }

    var n = selectedCount(bar);
    var checked = n >= 0 ? n : checkedRows().length;
    var rows = checkedRows();

    var anyOnline = false;
    for (var i = 0; i < rows.length; i++) {
      if (!rowLooksOffline(rows[i])) { anyOnline = true; break; }
    }

    var wantLabel = anyOnline ? '批量下架并删除' : '批量删除';

    if (exist) {
      if (exist.textContent !== wantLabel) exist.textContent = wantLabel;
      applyBatchEnabled(exist, checked >= 1);
      return 1;
    }

    ensureStyle();

    var like = leafByText(bar, '批量下架');
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = CLS_BATCH;
    btn.textContent = wantLabel;

    // 用户 2026-10-24：「这个按钮要做特殊一些」——
    // 与周围那排描边按钮明确区分：实心红底白字 + 右移 12px，一眼看出是危险动作。
    if (like) {
      var base = like.closest('button') || like;
      copyLook(btn, base);
      var cs = window.getComputedStyle(base);
      if (cs.height) btn.style.setProperty('height', cs.height, 'important');
    } else {
      btn.style.setProperty('height', '32px', 'important');
      btn.style.setProperty('padding', '0 14px', 'important');
      btn.style.setProperty('border-radius', '4px', 'important');
      btn.style.setProperty('font-size', '14px', 'important');
    }
    btn.style.setProperty('border', '1px solid #ff4d4f', 'important');
    btn.style.setProperty('font-weight', '600', 'important');
    btn.style.setProperty('letter-spacing', '0.5px', 'important');
    btn.style.setProperty('padding-left', '14px', 'important');
    btn.style.setProperty('padding-right', '14px', 'important');
    btn.style.setProperty('white-space', 'nowrap', 'important');
    btn.style.setProperty('margin-left', '12px', 'important');

    btn.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      if (btn.disabled) return;
      handleBatch();
    }, true);

    // 用户指定位置：「更多操作」右侧的空白处 —— 排在批量栏末尾
    bar.appendChild(btn);
    applyBatchEnabled(btn, checked >= 1);
    return 1;
  }

  /** 移除本功能注入的全部按钮（关开关 / 离开页面时） */
  function removeAll() {
    var nodes = document.querySelectorAll('.' + CLS_ROW + ', .' + CLS_BATCH);
    for (var i = 0; i < nodes.length; i++) nodes[i].remove();
  }

  /** 统一扫描入口 */
  function scan() {
    if (!enabled) return;
    if (!onChannelPage()) { removeAll(); return; }

    var r = injectRows();
    var b = syncBatchButton();

    var key = r.rows + '|' + r.added + '|' + r.has + '|' + r.noCol + '|' + b;
    if (key !== lastScanKey) {
      lastScanKey = key;
      say('扫描：' + r.rows + ' 行，新增 ' + r.added + '，已有 ' + r.has +
          '，无操作列 ' + r.noCol + '，批量按钮 ' + b);
    }
  }

  function scheduleScan() {
    if (!enabled) return;
    if (scanTimer) clearTimeout(scanTimer);
    scanTimer = setTimeout(function () { scanTimer = null; scan(); }, 300);
  }

  /* ==========================================================
   * 四、接口层
   * ========================================================== */

  /**
   * 会话级 __token：页面自己的列表请求 URL 里就有（数小时内稳定）。
   * 取不到返回空串，请求照发 —— 失败会带出平台原文。
   */
  function findPageToken() {
    try {
      var entries = performance.getEntriesByType('resource') || [];
      for (var i = entries.length - 1; i >= 0; i--) {
        var m = /__token=([0-9a-f]{16,})/i.exec(entries[i].name || '');
        if (m) return m[1];
      }
    } catch (e) { /* 时间线不可用就空手而归 */ }
    return '';
  }

  /** 公共查询参数（接口取样：appid=1 + __token + _bid=ffa_goods + _lid） */
  function apiParams() {
    var p = new URLSearchParams({
      appid: '1',
      _bid: 'ffa_goods',
      _lid: String(Date.now()).slice(-12)
    });
    var token = findPageToken();
    if (token) p.set('__token', token);
    return p;
  }

  /**
   * 发同源请求：优先请页面侧转发（MAIN world XHR 自动带平台请求库注入的
   * 安全头 —— 隔离世界的请求会被平台判「当前环境存在风险」）；探针不在场时
   * 退回隔离 fetch（可能被平台拦，失败文案会带出平台原文）。
   * @returns {Promise<{status:number, text:string, via:string}>}
   */
  async function pageFetch(url, opts) {
    checkTask();
    opts = opts || {};
    var probe = window.__DYC_STOCK_PROBE__;
    var out = null;

    if (probe && typeof probe.sendRequest === 'function') {
      var r = await probe.sendRequest(url, opts);
      checkTask();
      if (r && r.status > 0) {
        out = { status: r.status, text: r.text || '', via: 'main' };
      }
    }
    if (!out) {
      checkTask();
      // 超时兜底（2026-11-01 体检 P0-5）：隔离 fetch 一旦挂起（TCP 黑洞 /
      // 平台不回包），这个 await 永不 settle，上层 running 锁永不释放，
      // 之后所有「下架并删除」点击永远弹「正在处理上一个任务」—— 功能级死锁。
      // 主源转发那档已有 8 秒超时，这里对齐（同文件转发超时同款上限）。
      var ctrl = typeof AbortController === 'function' ? new AbortController() : null;
      var timer = ctrl
        ? setTimeout(function () { try { ctrl.abort(); } catch (e0) { /* 忽略 */ } }, 8000)
        : null;
      try {
        var resp = await fetch(url, {
          method: opts.method || 'GET',
          credentials: 'include',
          headers: opts.body ? { 'Content-Type': 'application/json;charset=UTF-8' } : undefined,
          body: opts.body || undefined,
          signal: ctrl ? ctrl.signal : undefined
        });
        var text = await resp.text();
        out = { status: resp.status, text: text, via: 'isolated' };
      } catch (fe) {
        // 超时/中断统一转成可读失败：上层按请求失败处理并释放锁。
        if (timer) { clearTimeout(timer); }
        throw new Error('隔离兜底请求失败' +
          (fe && fe.name === 'AbortError' ? '（8 秒无响应已超时）' : '') +
          '：' + (fe && fe.message || fe));
      }
      if (timer) { clearTimeout(timer); }
    }

    checkTask();

    // 每个请求都留一条日志（含通道与响应摘要）—— 失败时不用猜是「没发出去」
    // 还是「平台拒了」,诊断报告里直接能看到；这是 2026-10-24 两次「点了没反应」
    // 排查不出结论后加的。
    say('请求 ' + (opts.method || 'GET') + ' ' + shortApi(url) +
        ' → ' + out.status + ' via=' + out.via +
        ' ' + String(out.text || '').slice(0, 160));
    return out;
  }

  /** 日志用的短接口名（去掉 query，只留路径尾段） */
  function shortApi(url) {
    var p = String(url).split('?')[0];
    var i = p.lastIndexOf('/');
    return i >= 0 ? p.slice(i + 1) : p;
  }

  function safeJson(text) {
    try {
      return JSON.parse(text);
    } catch (e) {
      return null;
    }
  }

  /** 平台错误文案（接口三套字段：msg / sub_msg / errno） */
  function apiError(j, r) {
    if (!j) return 'HTTP ' + (r && r.status);
    return j.msg || j.sub_msg || ('code=' + j.code + ' errno=' + j.errno);
  }

  /**
   * 拉列表接口，取每个渠道品的 channel_type / status / operations。
   * channel_type 绝不能写死：本次接口取样的渠道品是 4，而清库存那套按 3 写死过。
   * @param {string[]} needIds 需要查询的渠道品 ID
   * @returns {Promise<{ok:boolean, map?:Object, missing?:string[], msg?:string}>}
   */
  async function listChannelMeta(needIds) {
    var out = {};
    var seen = {};
    var remain = needIds.slice();
    var page = 1;
    // 接口取样里页面自己用的是 pageSize=10。这里先按 20 拉，接口若对页大小有校验
    // （返回非 0 就换 10 再来一次），避免「参数不合规 → 整个功能静默失败」。
    var pageSize = 20;
    var triedSmall = false;

    var seenPages = new Set();
    while (remain.length) {
      checkTask();
      var q = apiParams();
      q.set('page', String(page));
      q.set('pageSize', String(pageSize));
      q.set('status', '-1');              // 全部状态（已下架也要能查到）
      q.set('valid_flag', '0');
      q.set('type_match_flag', '0');
      q.set('adapter_status', 'true');
      q.set('need_query_gift_activity', 'true');
      q.set('needMainProductStockDetail', 'true');

      var r;
      try {
        r = await pageFetch('/product/tproduct/list_channel_product?' + q.toString(), { method: 'GET' });
      } catch (e) {
        if (e && e.cancelled) throw e;
        return { ok: false, map: out, msg: '读取渠道品详情失败（' + (e && e.message || e) + '）' };
      }
      var j = safeJson(r.text);

      if (!j || j.code !== 0 || !Array.isArray(j.data)) {
        // 页大小被拒 → 退回接口取样里的 10 再试一次（只试一次，避免死循环）
        if (!triedSmall && pageSize !== 10) {
          triedSmall = true;
          pageSize = 10;
          page = 1;
          seenPages.clear();
          seen = {};
          say('列表接口拒了 pageSize=' + '20，降到 10 重试');
          continue;
        }
        return {
          ok: false, map: out,
          msg: '拉不到渠道品详情（' + apiError(j, r) + '，via=' + r.via + '）'
        };
      }

      // 整页内容与上一页完全相同 ⇒ 平台没在翻页，明确中止而不是静默当末页
      var pageKey = j.data.map(function (it) { return String(it.channel_id || ''); }).join(',');
      if (j.data.length && seenPages.has(pageKey)) {
        return { ok: false, map: out, msg: '平台重复返回同一页，查询未完成，未执行操作；请刷新后重试。' };
      }
      seenPages.add(pageKey);

      var added = 0;
      for (var i = 0; i < j.data.length; i++) {
        var it = j.data[i] || {};
        var id = String(it.channel_id || '');
        if (!id) continue;
        if (!Object.prototype.hasOwnProperty.call(seen, id)) added++;
        seen[id] = true;
        out[id] = {
          channelType: it.channel_type,
          status: it.status,
          name: it.name || '',
          operations: it.operations || []
        };
        var k = remain.indexOf(id);
        if (k >= 0) remain.splice(k, 1);
      }

      // 不按请求页大小判末页：接口可能自行缩小返回条数；空页或重复页才停止。
      if (!added) break;
      page++;
    }

    return { ok: true, map: out, missing: remain };
  }

  /**
   * 下架：status 0 = 下架（接口取样实证；同一批数据里该渠道品 status 变 0）。
   * channel_type 来自列表接口（info.channelType）—— **不是** meta 里的字段，
   * 也不能写死：接口取样里这个渠道品是 4，清库存那套按 3 写死过。
   */
  async function offlineApi(meta, info) {
    var body = {
      main_product_id: String(meta.mainProductId),
      channel_id: Number(meta.channelId),
      channel_type: info.channelType,
      status: 0,
      appid: 1,
      __token: findPageToken(),
      _bid: 'ffa_goods',
      _lid: String(Date.now()).slice(-12)
    };
    var r = await pageFetch('/product/tproduct/update_channel_product_status?' +
      apiParams().toString(), { method: 'POST', body: JSON.stringify(body) });
    var j = safeJson(r.text);
    if (j && j.code === 0 && j.data === true) return { ok: true };
    return { ok: false, msg: apiError(j, r) };
  }

  /** 删除（只对已下架的渠道品生效，平台侧会自行校验） */
  async function deleteApi(meta, info) {
    var body = {
      main_product_id: String(meta.mainProductId),
      channel_id: Number(meta.channelId),
      channel_type: info.channelType,
      appid: 1,
      __token: findPageToken(),
      _bid: 'ffa_goods',
      _lid: String(Date.now()).slice(-12)
    };
    var r = await pageFetch('/product/tproduct/remove_channel_product?' +
      apiParams().toString(), { method: 'POST', body: JSON.stringify(body) });
    var j = safeJson(r.text);
    if (j && j.code === 0 && j.data === true) return { ok: true };
    return { ok: false, msg: apiError(j, r) };
  }

  /* ==========================================================
   * 五、执行（确认后自动下架并删除）
   *
   * 售卖中的先下架再删除，已下架的直接删除；删除被拒时有限重试。
   * 查询列表取得 channel_type 与状态，直到找到目标或读完列表。
   * 停用或切页后停止后续请求；已提交的请求无法撤回，需核对平台结果。
   * ========================================================== */

  /** 令牌缺失就别发：盲发是最容易被判异常的一种请求 */
  function tokenReady() {
    return !!findPageToken();
  }

  /** 删除成功后把行从 DOM 摘掉（平台下次刷新也是没有的，纯显示层同步） */
  function dropRow(tr) {
    try { if (tr && tr.isConnected) tr.remove(); } catch (e) { /* 摘不掉不影响结果 */ }
  }

  /**
   * 完成后的自动刷新（2026-10-25 用户定）。
   *
   * 平台对「直连接口」的常规反应是弹一次「数据异常请刷新重试」。既然用户已经
   * 明确接受「直接提交参数」，那就由工具**替用户刷新这一下**：页面回到正常态，
   * 那个报错页也就不必出现了。
   * 只在成功（或部分成功）时刷新 —— 失败要留在现场看原因，刷掉就什么都看不到了。
   */
  var reloadTimer = null;

  function scheduleReload(ms) {
    if (reloadTimer || !taskValid(activeTask)) return;
    var task = activeTask;
    // 只进调试日志，不再单独弹一条 —— 刷新提示直接并进最后那条结果消息里。
    // （2026-10-25 用户反馈：一次操作弹三个提示太多，且那条 info 不进盒子，看着像丢了。）
    say('已完成，' + (ms / 1000).toFixed(1) + ' 秒后自动刷新页面');
    reloadTimer = setTimeout(function () {
      reloadTimer = null;
      if (!taskValid(task)) return;
      try { location.reload(); } catch (e) { /* 环境不允许就静默放弃 */ }
    }, ms);
  }

  /** 这一行现在是下架状态吗（只看显示层，用于按钮文案与弹窗措辞） */
  function rowLooksOffline(tr) {
    if (!tr) return false;
    if (findRowAction(tr, /^上架$/)) return true;          // 有「上架」= 已下架
    return /已下架|已停售/.test(tr.textContent || '');
  }

  /** 下架成功后把行内状态字样改成「已下架」，并让扫描把按钮文案换成「删除该渠道品」 */
  function markRowOffline(tr) {
    try {
      if (!tr || !tr.isConnected) return;
      var walker = document.createTreeWalker(tr, NodeFilter.SHOW_TEXT);
      var node;
      while ((node = walker.nextNode())) {
        if (tight(node.textContent) === '售卖中') {
          node.textContent = '已下架';
          break;
        }
      }
      var btn = tr.querySelector('.' + CLS_ROW);
      if (btn) btn.textContent = '删除该渠道品';
    } catch (e) { /* 显示层失败不影响结果 */ }
  }

  /**
   * 一次点击，**两个参数直接提交**（不等待、不模拟点击、不等刷新）。
   *
   * 2026-10-25 定案（用户）：「改成最最开始的，直接提交参数就好了，忽略异常。」
   *   · 下架 POST 之后**不再停 5 秒**，紧接着提交删除 —— 用户要的就是这个手感；
   *   · 平台的「数据异常请刷新重试」当它不存在：判定只看接口返回，
   *     接口说成功就是成功，页面怎么弹都不影响结论；
   *   · 删除若被拒（多半是下架状态还没落库），短间隔重试两次（1.5s / 2.5s），
   *     不用长等待，也不无限重试。
   *
   * @returns {Promise<{ok:boolean, stage:'offline'|'delete'|'', msg?:string}>}
   */
  async function runFull(meta, info, title, onStage) {
    var offlined = false;

    // ① 下架（仅当还没下架）
    if (info.status !== 0) {
      var r1 = await offlineApi(meta, info);
      if (!r1.ok) {
        return { ok: false, stage: 'offline', msg: title + '：下架失败（' + r1.msg + '）' };
      }
      offlined = true;
      say('已提交下架 ' + meta.channelId + '，紧接着提交删除');
      if (typeof onStage === 'function') onStage('offline');
    }

    // ② 删除：直接发；被拒就短间隔重试两次
    if (typeof onStage === 'function') onStage('delete');
    var r2 = await deleteApi(meta, info);
    var waits = [1500, 2500];
    for (var i = 0; !r2.ok && i < waits.length; i++) {
      say('删除被拒（' + r2.msg + '），' + (waits[i] / 1000) + ' 秒后重试');
      await sleep(waits[i]);
      r2 = await deleteApi(meta, info);
    }
    if (!r2.ok) {
      return {
        ok: false, stage: 'delete', offlined: offlined,
        msg: title + (offlined ? '：已下架，但删除失败（' : '：删除失败（') + r2.msg + '）'
      };
    }
    say('已删除 ' + meta.channelId);
    return { ok: true, stage: 'delete', offlined: offlined };
  }

  /** 单条的实际执行：查一次状态，然后自动走完两段 */
  async function doSingle(meta, title, onStage) {
    if (!tokenReady()) {
      return { ok: false, stage: '', msg: title + '：没拿到页面令牌（__token），刷新一次页面再试' };
    }

    var look = await listChannelMeta([meta.channelId]);
    if (!look.ok) return { ok: false, stage: '', msg: title + '：' + look.msg };

    var info = look.map[meta.channelId];
    if (!info) return { ok: false, stage: '', msg: title + '：本次列表查询未找到这个渠道品，未执行操作；请刷新后核对' };
    if (info.channelType == null) return { ok: false, stage: '', msg: title + '：没拿到渠道类型，已取消' };

    return runFull(meta, info, title, onStage);
  }

  /** 单行按钮点击：按当前状态确认后自动完成下架与删除 */
  function handleSingle(tr) {
    var confirmEpoch = taskEpoch;
    var confirmUrl = location.href;
    if (running) {
      toast('正在处理上一个任务，请稍候', 'info', { source: SOURCE });
      return;
    }
    var meta = rowMeta(tr);
    var title = rowTitle(tr);

    if (!meta || !meta.mainProductId) {
      toast('没认出这个渠道品的 ID，已取消操作', 'error', { source: SOURCE });
      return;
    }

    var offlineNow = rowLooksOffline(tr);

    showConfirmDialog({
      title: offlineNow ? '删除这个渠道品？' : '下架并删除这个渠道品？',
      fields: [
        { label: '商品', value: title },
        { label: '渠道品ID', value: meta.channelId },
        { label: '主品ID', value: meta.mainProductId }
      ],
      warning: offlineNow
        ? ('删除不可恢复：主品不受影响，但该渠道的售卖记录与配置会一并消失。')
        : ('先下架，再提交删除。删除不可恢复：主品不受影响，但该渠道的售卖记录与配置会一并消失。\n' +
           '成功后自动刷新页面；失败时保留页面供核对。'),
      confirmText: offlineNow ? '确认删除' : '下架并删除',
      cancelText: '取消',
      danger: true,
      onConfirm: function () {
        if (running || !enabled || confirmEpoch !== taskEpoch || confirmUrl !== location.href) return;
        activeTask = { epoch: taskEpoch, url: location.href };
        running = true;
        updateProgress(1, 1, offlineNow ? '正在删除' : '正在下架', { source: SOURCE });

        // 只更新同一条进度（running 会被合并成一条），不要每阶段各弹一条
        doSingle(meta, title, function (stage) {
          updateProgress(1, 1, stage === 'offline' ? '已下架，正在提交删除' : '正在提交删除',
            { source: SOURCE });
        }).then(function (res) {
          if (!res.ok) {
            if (res.offlined) markRowOffline(tr);
            /* 三段式(2026-10-27):值=商品名(谁),成败进右端弱位,
             * 具体原因走 full 存进盒子 —— 条上一行宽,长原因必然被截成「…」。 */
            failStatus(title, {
              source: SOURCE,
              count: res.offlined ? '已下架 · 删除失败' : '操作失败',
              full: res.msg
            });
            return;
          }
          dropRow(findRowByChannelId(meta.channelId) || tr);
          // 刷新照做，但不写在消息里（2026-10-25 用户：「不用写出来告诉我」）
          finishStatus(title, { source: SOURCE, count: '已下架并删除' });
          scheduleReload(1500);
        }).catch(function (e) {
          failStatus(title, {
            source: SOURCE, count: e && e.cancelled ? '已停止后续操作' : '操作异常',
            full: title + '：' + (e && e.message)
          });
        }).then(function () {
          running = false;
          scheduleScan();
        });
      }
    });
  }

  /** 相同失败原因只写一次，完整商品名逐行保留。 */
  function batchFailureDetails(fails) {
    var groups = new Map();
    fails.forEach(function (failure) {
      var title = failure.title;
      var reason = failure.reason;
      if (!groups.has(reason)) groups.set(reason, []);
      if (title) groups.get(reason).push(title);
    });
    return Array.from(groups, function (group) {
      return group[0] + (group[1].length ? '（' + group[1].length + ' 件）\n' + group[1].join('\n') : '');
    }).join('\n\n');
  }

  /** 批量按钮点击：确认后逐条下架并删除 */
  function handleBatch() {
    var confirmEpoch = taskEpoch;
    var confirmUrl = location.href;
    if (running) {
      toast('正在处理上一个任务，请稍候', 'info', { source: SOURCE });
      return;
    }
    var rows = checkedRows();
    if (!rows.length) {
      toast('请先勾选要处理的渠道品', 'warning', { source: SOURCE });
      return;
    }

    var items = [];
    for (var i = 0; i < rows.length; i++) {
      var m = rowMeta(rows[i]);
      if (!m || !m.mainProductId) continue;
      items.push({ tr: rows[i], meta: m, title: rowTitle(rows[i]) });
    }
    if (!items.length) {
      toast('勾选的商品都没认出渠道品 ID，已取消', 'error', { source: SOURCE });
      return;
    }

    var fields = [{ label: '数量', value: items.length + ' 个渠道品' }];
    for (var n = 0; n < items.length && n < 3; n++) {
      var name = Array.from(items[n].title);
      fields.push({ label: '商品' + (n + 1),
        value: name.length > 18 ? name.slice(0, 17).join('') + '…' : items[n].title });
    }
    if (items.length > 3) {
      fields.push({ label: '其余', value: '另有 ' + (items.length - 3) + ' 个渠道品，将一并处理' });
    }

    showConfirmDialog({
      title: '批量下架并删除这 ' + items.length + ' 个渠道品？',
      fields: fields,
      warning:
        ('逐条下架并删除；已下架的直接删除。删除无法恢复，该渠道售卖记录与配置会消失。\n' +
         '每条间隔 0.2 秒；某条失败后继续处理后续商品。\n' +
         '全部成功后自动刷新；部分失败时保留页面，请核对结果。'),
      confirmText: '全部下架并删除',
      cancelText: '取消',
      danger: true,
      onConfirm: function () {
        if (running || !enabled || confirmEpoch !== taskEpoch || confirmUrl !== location.href) return;
        activeTask = { epoch: taskEpoch, url: location.href };
        running = true;
        runBatch(items).catch(function (e) {
          failStatus('选中商品', { source: SOURCE, count: e && e.cancelled ? '已停止后续操作' : '批量操作异常', full: e && e.message });
        }).then(function () {
          running = false;
          scheduleScan();
        });
      }
    });
  }

  /**
   * 批量：先一次性查状态，然后**每条直接提交两个参数**（下架 → 紧接着删除）。
   * 条与条之间间隔 200 毫秒，不并发提交写请求。
   */
  async function runBatch(items) {
    var total = items.length;
    var ok = 0;
    var fails = [];

    if (!tokenReady()) {
      failStatus('没拿到页面令牌，已取消', {
        source: SOURCE, count: '0/' + total,
        full: '批量操作已取消：没拿到页面令牌（__token），刷新一次页面再试'
      });
      return;
    }

    updateProgress(0, total, '正在读取渠道品详情', { source: SOURCE });

    var ids = items.map(function (it) { return it.meta.channelId; });
    var look = await listChannelMeta(ids);
    // 查询中途失败也保留已取得的详情；仅跳过详情不全的条目。
    if (!look.ok) say('详情查询未完成，将继续处理已查到的渠道品：' + look.msg);

    for (var i = 0; i < total; i++) {
      checkTask();
      var it = items[i];
      var info = look.map[it.meta.channelId];

      if (!info || info.channelType == null) {
        fails.push({ title: it.title, reason: (!look.ok ? look.msg :
          (!info ? '本次列表查询未找到' : '没拿到渠道类型')) + '，未执行操作' });
        continue;
      }

      updateProgress(i + 1, total,
        it.title + (info.status === 0 ? ' 正在删除' : ' 正在下架'),
        { source: SOURCE });

      try {
        var res = await runFull(it.meta, info, it.title, function (stage) {
          updateProgress(i + 1, total,
            it.title + (stage === 'offline' ? ' 已下架，正在删除' : ' 正在删除'),
            { source: SOURCE });
        });
        if (res.ok) {
          ok++;
          dropRow(findRowByChannelId(it.meta.channelId) || it.tr);
        } else {
          if (res.offlined) markRowOffline(it.tr);
          var prefix = it.title + '：';
          fails.push({ title: it.title, reason: res.msg.indexOf(prefix) === 0 ? res.msg.slice(prefix.length) : res.msg });
        }
      } catch (e) {
        if (e && e.cancelled) throw e;
        fails.push({ title: it.title, reason: String(e && e.message || e) });
      }

      if (i < total - 1) await sleep(200);
    }

    // 只有全部成功才自动刷新；有失败就留在现场，让用户看清原因
    if (ok > 0 && !fails.length) {
      scheduleReload(2000);
    }

    if (ok > 0 && !fails.length) {
      finishStatus('选中 ' + total + ' 件',
        { source: SOURCE, count: '已下架并删除 ' + ok + ' 件', standalone: true });
    } else if (ok > 0) {
      // 中段只写选中范围，成功与失败数量留在右段。
      failStatus('选中 ' + total + ' 件', {
        source: SOURCE, count: '成功 ' + ok + ' · 失败 ' + fails.length, standalone: true, details: true,
        full: batchFailureDetails(fails) + '\n\n页面未刷新，请核对失败商品。'
      });
    } else {
      failStatus('选中 ' + total + ' 件', {
        source: SOURCE, count: '全部失败 ' + total + ' 件', standalone: true, details: true,
        full: batchFailureDetails(fails) + '\n\n页面未刷新，请核对失败商品。'
      });
    }
    if (fails.length) say('失败明细：' + batchFailureDetails(fails));
  }

  /* ==========================================================
   * 六、启停
   * ========================================================== */

  function attachWatcher() {
    if (observer) return;
    try {
      observer = new MutationObserver(function (muts) {
        var external = false;
        for (var i = 0; i < muts.length; i++) {
          if (muts[i].type !== 'childList') continue;
          var added = muts[i].addedNodes;
          for (var j = 0; j < added.length; j++) {
            if (added[j].nodeType === 1 && !isOwnNode(added[j])) { external = true; break; }
          }
          if (external) break;
        }
        if (external) scheduleScan();
      });
      observer.observe(document.body, { childList: true, subtree: true });
    } catch (e) { say('监听启动失败：' + (e && e.message)); }
  }

  function detachWatcher() {
    if (observer) { observer.disconnect(); observer = null; }
  }

  function attachRouteWatcher() {
    if (routeTimer) return;
    routeTimer = setInterval(function () {
      if (location.href === lastUrl) return;
      invalidateTask();
      lastUrl = location.href;
      // SPA 切页：旧按钮全部摘掉再重扫（旧行节点已被销毁，留着也是死按钮）
      removeAll();
      lastScanKey = '';
      scheduleScan();
    }, 1000);
  }

  function detachRouteWatcher() {
    if (routeTimer) { clearInterval(routeTimer); routeTimer = null; }
  }

  function start() {
    if (enabled) return;
    enabled = true;
    lastUrl = location.href;
    say('已开启');
    attachWatcher();
    attachRouteWatcher();
    if (document.readyState === 'complete') scheduleScan();
    else window.addEventListener('load', scheduleScan, { once: true });
  }

  function stop() {
    if (!enabled) return;
    enabled = false;
    invalidateTask();
    detachWatcher();
    detachRouteWatcher();
    if (scanTimer) { clearTimeout(scanTimer); scanTimer = null; }
    removeAll();
    lastScanKey = '';
    say('已关闭，按钮已移除');
  }

  window.addEventListener('pagehide', invalidateTask);

  /* ---- 首次读取 + 订阅开关 ----
     首次读到的状态必须先记进 prevFlag（第 21 条）：否则页面加载后用户
     第一次拨开关时 prevFlag 还是 null，会被当成「首次静默」—— 拨了没声音，
     用户以为没生效。2026-10-18 直播回放两个开关踩过这个坑。 */
  var prevFlag = null;

  if (typeof dycReadFlags === 'function') {
    dycReadFlags().then(function (flags) {
      prevFlag = !!(flags && flags.channelOfflineDelete);
      if (prevFlag) start();
    });
  }
  if (typeof dycWatchFlags === 'function') {
    dycWatchFlags(function (flags) {
      var on = !!(flags && flags.channelOfflineDelete);
      if (prevFlag !== null && on !== prevFlag && typeof toast === 'function') {
        toast(on ? '已开启' : '已关闭', 'info', { source: SOURCE });
      }
      prevFlag = on;
      if (on) start(); else stop();
    });
  }

  /* ---- 对外接口（调试 / 自测用） ---- */
  window.__DYC_CHANNEL_DEL__ = {
    scan: scan,
    start: start,
    stop: stop,
    rows: channelRows,
    checkedRows: checkedRows,
    injectRows: injectRows,
    syncBatchButton: syncBatchButton,
    findActionColumn: findActionColumn,
    findRowAction: findRowAction,
    findRowByChannelId: findRowByChannelId,
    rowMeta: rowMeta,
    rowTitle: rowTitle,
    rowLooksOffline: rowLooksOffline,
    runFull: runFull,
    doSingle: doSingle
  };
})();
