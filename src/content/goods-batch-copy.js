/**
 * 抖店商品管理 · 批量复制商品链接（2026-11-06 用户新增需求）
 * ============================================================
 * 【解决什么问题】
 *
 *   抖店后台商品列表（fxg.jinritemai.com/ffa/g/list）每个商品行都有一枚
 *   「复制链接」。用户要一次上架几十个商品到橱窗/挂车时，只能一个个点 ——
 *   用户原话：「一个一个点太麻烦了，帮我做批量功能」。
 *
 * 【为什么不模拟点击（用户明确要求「不要模拟手动」）】
 *
 *   平台的「复制链接」点下去会**弹一个分享面板**再读链接，逐个点意味着
 *   几十次展开/收起面板 + 几十次剪贴板写入，慢且极易被页面重渲染打断。
 *
 *   关键事实：商品链接不是「点出来」的，而是**算出来的** ——
 *   抖店商品分享链接 = 固定模板 + 商品 ID，而商品 ID 本来就明文写在每一行里
 *   （形如 `ID: 3552430413047811198`）。所以本模块只做三件事：
 *   ① 读行内商品 ID；② 套模板拼链接；③ 一次性写入剪贴板。
 *   全程不点平台按钮、不发任何接口请求 —— 没有网络依赖，也就没有风控与失败面。
 *
 * 【唯一会触碰平台控件的地方：复制成功后取消勾选】
 *
 *   用户 2026-11-06 定「复制完自动取消勾选」。勾选状态由平台自己管理
 *   （受控组件），只改 DOM 属性不触发它的状态机，下次渲染就回滚 ——
 *   所以这里必须真的点一次勾选框。它只用于**复位**，与取值无关。
 *
 * 【30 条上限与提示（用户原话）】
 *
 *   「最高可以同时复制30个，超过不记录，链接超过30个会提示超了30个只保留前30个」。
 *   ⇒ 取前 30 条复制，其余不记录；用顶部消息栏说明「只复制前 30 条」，
 *     不弹确认框（用户明确「不要弹窗」）。
 *   截取顺序 = 页面从上到下（用户 2026-11-06 定），与眼睛看到的顺序一致。
 *
 * 【链接形态】
 *
 *   https://haohuo.jinritemai.com/views/product/item2?id=<商品ID>
 *   —— 抖店官方帮助中心「商品链接如何查看」给的就是这条路径（商品管理 → 复制链接），
 *   实机链接形态亦一致。改这一处模板即可，见 LINK_PREFIX。
 *
 * 【格式】
 *
 *   一行一条，`\n` 分隔，不插空格、不插标点（用户：「首位不要直接相连」）——
 *   可直接整段粘进橱窗「粘贴加橱窗」或挂车输入框。
 */
(function goodsBatchCopy() {
  'use strict';

  if (window.__dycGoodsBatchCopyLoaded) return;
  window.__dycGoodsBatchCopyLoaded = true;
  if (typeof dycReadFlags !== 'function' || typeof dycWatchFlags !== 'function') return;

  var BTN_TEXT = '批量复制链接';
  var SOURCE = '批量复制';

  /* 单次上限（用户 2026-11-06 定） */
  var MAX_LINKS = 30;

  /* 商品链接模板：只换这一处就能改口径 */
  var LINK_PREFIX = 'https://haohuo.jinritemai.com/views/product/item2?id=';

  var CLS_BTN = 'dyc-gbc-btn';
  var STYLE_ID = 'dyc-gbc-style';

  var on = false;
  var btn = null;
  var barCache = null;      // 批量栏缓存（全文档扫很贵，节点离树才重找）
  var tickTimer = null;
  var retryTimer = null;
  var flashTimer = null;
  var busy = false;

  function log(msg) {
    try {
      if (typeof debugLog === 'function') debugLog(msg);
    } catch (e) { /* 日志不影响主流程 */ }
  }

  /**
   * 只在状态**变化**时打印（避免 1.2 秒一次的轮询刷屏）。
   * 排查价值：用户按 F12 一看就知道卡在哪一层 ——
   *   完全没输出  ⇒ 脚本没注入（扩展没重载 / 页面没刷新）；
   *   有「已启动」没「已挂上」⇒ 脚本在跑，是工具条定位没命中。
   */
  var lastNote = '';
  function note(state, msg) {
    if (lastNote === state) return;
    lastNote = state;
    log(msg);
    try { console.log('[DYB] ' + msg); } catch (e) { /* 忽略 */ }
  }

  function tight(el) {
    return el ? String(el.textContent || '').replace(/\s+/g, '') : '';
  }

  function visible(el) {
    if (!el || !el.getBoundingClientRect) return false;
    var r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }

  /** 只在本页干活；SPA 切走要自动摘按钮 */
  function inScope() {
    var p = window.DYC_PAGE_PATTERNS;
    return !!(p && p.list && p.list.test(location.href));
  }

  /** 找「文本正好是 text」的最深元素（不返回祖先，避免抓到整栏） */
  function leafByText(root, text) {
    if (!root) return null;
    var nodes;
    try {
      nodes = root.querySelectorAll('button, a, span, div, li, [role="button"]');
    } catch (e) { return null; }
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      if (tight(el) !== text) continue;
      /* 只取叶子：子元素里不能再有同样的字 */
      var inner = false;
      for (var j = 0; j < el.children.length; j++) {
        if (tight(el.children[j]) === text) { inner = true; break; }
      }
      if (inner) continue;
      /* 2026-11-07 加：必须可见。
         页面上同名文案往往有多份（下拉菜单项、折叠面板、隐藏的备用工具条），
         命中隐藏那份会把按钮挂进一个谁也看不见的容器 —— 现象就是
         「用户报按钮根本没出现」，而代码每一步都"成功"了，极难查。 */
      if (!visible(el)) continue;
      return el;
    }
    return null;
  }

  /** 容器里有几个按钮 —— 用来确认收敛到的是"按钮组"而不是单个按钮的包装层 */
  function countButtons(root) {
    try { return root.querySelectorAll('button, [role="button"]').length; }
    catch (e) { return 0; }
  }

  /* ==========================================================
   * 一、批量操作栏定位（含「批量上架 / 批量下架 / 更多操作」的那一行）
   * ========================================================== */

  /**
   * 判据是「批量下架 + 批量修改同框」，不是类名 —— 该页类名是构建哈希
   * （index_wrapper__3UiS6 这种），写死必随平台改版失效。
   *
   * ⚠️ 2026-11-06 实机取样修正：商品管理页（/ffa/g/list）的批量工具条是
   *   `导出查询商品 / 查看导出记录 / 批量下架 / 批量修改 / 查看优化记录`——
   *   **这一页根本没有「批量上架」，也没有「更多操作」**（渠道品页才有）。
   *   所以旧判据（三个词同框）在本页永远匹配不到。现在改用两页都成立的
   *   `批量下架 + 批量修改`，并要求「批量上架/更多操作」**任一存在即可**不参与判定。
   *
   * 另加 `t.length < 120` 上限：防止向上收敛时一路吃到整页容器
   * （整页文本也含这两个词），那样按钮会被追加到页面底部。
   */
  /**
   * 找批量操作栏。
   *
   * ⚠️ 2026-11-07 第三次修正（用户截图：按钮挂到上一行去了）：
   *   这一页有**两行**工具条 ——
   *     上行（筛选区）：查询 / 重置 / 展开 / 导出查询商品 / 查看导出记录
   *     下行（批量区）：已选20条 / 批量下架 / 批量修改 / 查看优化记录 /
   *                     尺码表自动优化 / 渠道品管理 / 更多操作 ˅
   *   上一版拿「查看优化记录」当第一锚点，**上行也有这个词**，
   *   于是命中上行，按钮挂到「查看导出记录」右边 —— 位置错了。
   *
   *   ⇒ 锚点必须只用**只在下行出现**的词，并按下行独有性排序：
   *     ① 更多操作（用户指定的落点，下行独有）
   *     ② 尺码表自动优化 / 渠道品管理（下行独有，且文案稳定）
   *     ③ 批量下架 / 批量修改（下行独有）
   *   ⛔ 绝不能放：查看优化记录（两行都有）、导出查询商品 / 查看导出记录（只有上行）
   *
   * 缓存：全文档扫很贵（该页约 5000 元素），节点离树/不可见/不再像按钮组才重找。
   */
  function findBatchBar() {
    if (barCache && barCache.isConnected && visible(barCache) &&
        countButtons(barCache) >= 2) {
      return barCache;
    }
    barCache = null;

    var anchors = ['更多操作', '尺码表自动优化', '渠道品管理', '批量下架', '批量修改'];
    for (var a = 0; a < anchors.length; a++) {
      var leaf = leafByText(document.body, anchors[a]);
      if (!leaf) continue;

      var box = leaf.parentElement;
      for (var i = 0; i < 6 && box && box !== document.body; i++) {
        if (visible(box) && countButtons(box) >= 2) {
          barCache = box;
          return box;
        }
        box = box.parentElement;
      }
    }
    return null;
  }

  /* ==========================================================
   * 二、取值：勾选行 → 商品 ID → 链接
   * ========================================================== */

  /**
   * 一行是否被勾选。
   *
   * 三层，从明确到宽松：
   *   ① 真 input[type=checkbox] —— 最可靠；
   *   ② aria-checked="true" —— 平台自绘勾选的语义标记；
   *   ③ 类名里带 checked —— 只认「独立词」形态。
   *
   * ⚠️ 第 ③ 层不能用 `[class*="checked"]`：`checkbox-unchecked` 里也含
   *    "checked" 这个子串，那会把「没勾的」全判成勾了 —— 结果是复制出一堆
   *    用户根本没选的商品。所以必须按词边界匹配，并显式排除 unchecked。
   *    范围限定在首个单元格（勾选列），避免商品名里恰好有类似类名。
   */
  function isRowChecked(tr) {
    /* ① 行自身的选中标记。
       2026-11-07 用户报「勾选了但按钮还是灰的」：ecom/ant 系表格常把选中态
       **挂在 tr 上**（`ecom-g-table-row-selected`），而不是只改勾选框。
       原来只查行内 checkbox 与首列，这类实现就全部识别不到。 */
    var trCls = (typeof tr.className === 'string') ? tr.className : '';
    if (trCls && !/unchecked/i.test(trCls) &&
        /(^|[\s_-])(row-)?(selected|checked)($|[\s_-])/i.test(trCls)) {
      return true;
    }
    if (tr.getAttribute && tr.getAttribute('aria-selected') === 'true') return true;

    /* ② 真 checkbox（最可靠） */
    var cb = tr.querySelector('input[type="checkbox"]');
    if (cb) return !!cb.checked;

    /* ③ 勾选列里的自绘标记 */
    var first = (tr.cells && tr.cells[0]) || tr;
    if (first.querySelector('[aria-checked="true"]')) return true;

    var marked;
    try { marked = first.querySelectorAll('[class]'); } catch (e) { marked = []; }
    for (var i = 0; i < marked.length; i++) {
      var cls = marked[i].className;
      if (typeof cls !== 'string' || !cls) continue;
      if (/unchecked|indeterminate/i.test(cls)) continue;
      if (/(^|[\s_-])checked($|[\s_-])/i.test(cls)) return true;
    }
    return false;
  }

  /**
   * 平台自己渲染的「已选 N 条」。
   *
   * 这是**最权威**的勾选信号 —— 数字是平台算的，不依赖我们去猜 DOM 标记。
   *
   * ⚠️ 2026-11-07 第二次修正（用户截图：已选20条在，按钮还是灰的）：
   *   这一行是**左右分区**布局 —— 左边「已选20条」，右边一排按钮。
   *   findBatchBar 收敛到的是右边那个按钮组容器，**里面不含「已选20条」**，
   *   所以在 bar 内找文本永远找不到。
   *   ⇒ 改为从 bar 向上最多 5 层找，先近后远；一路到 body 就放弃（避免误读整页）。
   */
  function selectedCountFromBar() {
    var bar = findBatchBar();
    if (!bar) return -1;

    var scope = bar;
    for (var i = 0; i < 5 && scope && scope !== document.body; i++) {
      var m = /已选(?:择)?\s*(\d+)\s*条/.exec(tight(scope));
      if (m) return parseInt(m[1], 10);
      scope = scope.parentElement;
    }

    /* 第二路：从表格主体往上找（批量栏在表格上方，左右分区的实现里
       按钮组与「已选 N 条」往往不在同一棵子树下） */
    var table = null;
    try { table = document.querySelector('tbody.ecom-g-table-tbody'); } catch (e) { table = null; }
    scope = table;
    for (var j = 0; j < 8 && scope && scope !== document.body; j++) {
      var m2 = /已选(?:择)?\s*(\d+)\s*条/.exec(tight(scope));
      if (m2) return parseInt(m2[1], 10);
      scope = scope.parentElement;
    }
    return -1;
  }

  /** 当前页所有商品行（不判勾选），保持 DOM 顺序 */
  /**
   * 本页商品行。
   *
   * ⚠️ 2026-11-07 第三次修正（用户报「复制不到任何东西」）：
   *   原来优先用 anchor.js 的 `findProductRows()`，它是**按「编辑」按钮回溯**的。
   *   而本页行操作列是「预览 / 复制链接」，根本没有「编辑」——那套判据在这页
   *   不可靠（返回空或返回错误节点），而它一旦返回"非空但不对"的东西，
   *   我的兜底也不会触发，直接一错到底。
   *
   *   结构报告已实证本页是标准表格：
   *     `tbody.ecom-g-table-tbody > tr.ecom-g-table-row.ecom-g-table-row-level-0`
   *   ⇒ 改为**实证结构优先**，行为判据只当最后的兜底（与本工程别处相反，
   *     因为这里有确切的实测结构，没什么好猜的）。
   */
  function allProductRows() {
    var rows = [];

    /* ① 实证结构：本页表格主体行 */
    try {
      rows = Array.prototype.slice.call(
        document.querySelectorAll('tbody.ecom-g-table-tbody > tr, tbody.ecom-g-table-tbody tr')
      );
    } catch (e0) { rows = []; }

    /* ② 通用表格主体行 */
    if (!rows.length) {
      try {
        rows = Array.prototype.slice.call(document.querySelectorAll('tbody tr'));
      } catch (e1) { rows = []; }
    }

    /* ③ 最后才退到 anchor 的行为判据 */
    if (!rows.length && typeof findProductRows === 'function') {
      try { rows = findProductRows() || []; } catch (e2) { rows = []; }
    }

    var out = [];
    var seen = [];
    for (var i = 0; i < rows.length; i++) {
      var tr = rows[i];
      if (!tr || !tr.isConnected) continue;
      if (seen.indexOf(tr) >= 0) continue;
      /* 表头行剔掉（它也是 tr，但单元格是 th）。 */
      if (tr.querySelector && tr.querySelector('th')) continue;
      /* 虚拟滚动的「测量行」必须剔掉（2026-11-07 取样才发现）：
         `tr.ecom-g-table-measure-row` 高度 0、无内容、无勾选框，
         留在里面会让行数虚高、取样打在它身上全是 0，诊断信息变假。 */
      if (/(^|[\s_-])measure([\s_-]|$)/i.test(String(tr.className || ''))) continue;
      seen.push(tr);
      out.push(tr);
    }
    return out;
  }

  /** 单个勾选控件是否是「已勾」状态 */
  function isControlChecked(el) {
    if (!el) return false;
    if (el.tagName === 'INPUT') return !!el.checked;
    if (el.getAttribute && el.getAttribute('aria-checked') === 'true') return true;
    var cls = (typeof el.className === 'string') ? el.className : '';
    if (!cls) return false;
    if (/unchecked|indeterminate/i.test(cls)) return false;
    return /(^|[\s_-])checked($|[\s_-])/i.test(cls);
  }

  /**
   * 从「勾选控件」反查行（第三路）。
   *
   * 不假设勾选框一定在 tr 里：先找所有像勾选控件的元素，判状态，再 closest('tr')。
   * 覆盖「勾选列与数据行分属两个层」的实现 —— 这类结构下，从 tr 往下找
   * 永远找不到勾选框，而从控件往上找一次就对。
   */
  function rowsByCheckedControls() {
    var marks;
    try {
      marks = document.querySelectorAll(
        'input[type="checkbox"], [role="checkbox"], [class*="checkbox"]'
      );
    } catch (e) { return []; }

    var out = [];
    for (var i = 0; i < marks.length; i++) {
      var el = marks[i];
      if (!isControlChecked(el)) continue;
      var tr = null;
      try { tr = el.closest('tr'); } catch (e2) { tr = null; }
      if (!tr || !tr.isConnected) continue;
      if (tr.querySelector && tr.querySelector('th')) continue;   // 表头全选
      if (out.indexOf(tr) >= 0) continue;
      out.push(tr);
    }
    return out;
  }

  /**
   * 勾选状态取样（2026-11-07，一次性诊断用）
   *
   * 现场情况：用户勾了商品，但行内既找不到 input[type=checkbox]，
   * 也找不到任何带 checkbox / checked 字样的元素 —— 说明勾选控件要么
   * 在 closed shadow root 里，要么类名是哈希/自绘。
   * 与其继续猜，不如把**首列真实结构**打出来，一次看清。
   */
  function dumpRowProbe(rows) {
    if (!rows || !rows.length) {
      log('批量复制链接:取样失败（一行都没读到）');
      return;
    }
    var tr = rows[0];
    var cell = (tr.cells && tr.cells[0]) || tr;
    var info;
    try {
      info = 'input=' + tr.querySelectorAll('input').length +
             ' checkbox类=' + tr.querySelectorAll('[class*="checkbox"]').length +
             ' aria选中=' + tr.querySelectorAll('[aria-selected="true"]').length +
             ' tr类=' + String(tr.className).slice(0, 100);
    } catch (e) {
      info = '统计失败:' + (e && e.message);
    }
    var html = '';
    try {
      html = String(cell.outerHTML || '').replace(/\s+/g, ' ').slice(0, 900);
    } catch (e2) {
      html = '取不到:' + (e2 && e2.message);
    }
    log('批量复制链接:首列统计=' + info);
    log('批量复制链接:首列结构=' + html);
  }

  /** 当前页已勾选的行，保持 DOM 顺序 = 页面从上到下 */
  function checkedRows() {
    var rows = allProductRows();
    var out = [];
    var i;
    for (i = 0; i < rows.length; i++) {
      if (isRowChecked(rows[i])) out.push(rows[i]);
    }
    if (out.length) return out;

    /* 第二路：从勾选控件反查（勾选框不在 tr 内时，第一路必然全军覆没） */
    var byCtrl = rowsByCheckedControls();
    if (byCtrl.length) {
      for (i = 0; i < byCtrl.length; i++) {
        if (rows.indexOf(byCtrl[i]) >= 0) out.push(byCtrl[i]);
      }
      if (out.length) {
        /* 按页面顺序重排，保证「从上到下」 */
        out.sort(function (a, b) {
          var pa = rows.indexOf(a), pb = rows.indexOf(b);
          return pa - pb;
        });
        log('批量复制链接:按勾选控件反查命中 ' + out.length + ' 行');
        return out;
      }
      out = [];
    }

    /* 第三路：全选兜底 —— 平台显示「已选 N 条」且 N = 本页行数 */
    var n = selectedCountFromBar();
    if (n > 0 && n === rows.length) {
      log('批量复制链接:按「已选 ' + n + ' 条 = 全部 ' + rows.length + ' 行」判定为全选');
      return rows;
    }
    return out;
  }

  /**
   * 从一行里取商品 ID。
   *
   * 三层，越往下越宽松：
   *   ① 语义定位 —— anchor.js 的「标签: 值」取值（行内 `<span>ID：</span>` 形态）；
   *   ② 整行文本 —— `ID: 数字` 精确模式（要求 10 位以上，排除 SKU/规格号）；
   *   ③ 行内链接 —— 万一平台把 id 渲染进了 href。
   * 都取不到就返回 null，由调用方计入「认不出」，**绝不拼半截链接**。
   */
  function rowProductId(tr) {
    /* ① 标签取值 */
    if (typeof extractValueAfterLabel === 'function') {
      try {
        var v = extractValueAfterLabel(tr, 'ID');
        if (v) {
          var m1 = /(\d{10,})/.exec(String(v));
          if (m1) return m1[1];
        }
      } catch (e) { /* 落到下一层 */ }
    }

    /* ② 整行文本：取**第一个** `ID: 数字`。
     *
     * ⚠️ 这里不能要求 ID 前面是非字母数字字符（2026-11-06 自测抓到的真 bug）：
     *   商品名与 ID 是两个独立块级元素，textContent 拼接时**没有分隔符**，
     *   而该店商品名普遍以款号结尾（例如「…阔腿裤K610Y0808」），
     *   拼出来就是 `…K610Y0808ID: 3852518618067763426`。
     *   加前置约束会让这类商品**整批取不到 ID**，而它们恰恰是常态。
     *   改为不约束前置字符、只取第一个命中（商品 ID 在商品信息列里最先出现）。 */
    var text = '';
    try { text = String(tr.textContent || ''); } catch (e2) { text = ''; }
    var m2 = /ID\s*[:：]\s*(\d{10,})/.exec(text);
    if (m2) return m2[1];

    /* ③ 行内链接 */
    try {
      var as = tr.querySelectorAll('a[href]');
      for (var i = 0; i < as.length; i++) {
        var href = as[i].getAttribute('href') || '';
        var m3 = /[?&](?:id|product_id)=(\d{10,})/.exec(href) ||
                 /\/product\/(\d{10,})/.exec(href);
        if (m3) return m3[1];
      }
    } catch (e3) { /* 忽略 */ }

    return null;
  }

  /* ==========================================================
   * 三、剪贴板（先 execCommand，再 Clipboard API）
   * ==========================================================
   * 本扩展 permissions 只有 clipboardRead、没有 clipboardWrite，
   * 在这种上下文里 navigator.clipboard.writeText 可能 reject 甚至一直挂起。
   * execCommand 是同步的，成败立刻知道 —— 与微信小店「复制链接」同一口径。
   */
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
        setTimeout(function () { finish(false); }, 300);   // API 挂起也不让按钮僵住
        return;
      }
    } catch (e) { /* 落到失败 */ }
    finish(false);
  }

  /* ==========================================================
   * 四、按钮
   * ========================================================== */

  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    var st = document.createElement('style');
    st.id = STYLE_ID;
    st.textContent =
      '.' + CLS_BTN + '{transition:background .15s ease,color .15s ease,border-color .15s ease}' +
      '.' + CLS_BTN + ':not([disabled]):hover{background:#0d4fdb !important;border-color:#0d4fdb !important}' +
      '.' + CLS_BTN + '[disabled]{cursor:not-allowed !important}';
    (document.head || document.documentElement).appendChild(st);
  }

  /** 借用平台按钮的尺寸/圆角/字号，只覆盖颜色 —— 混在原生按钮里不显突兀 */
  function adoptLook(el, like) {
    if (!like) return;
    try {
      var cs = window.getComputedStyle(like);
      var props = ['height', 'padding', 'padding-left', 'padding-right',
                   'border-radius', 'font-size', 'font-family', 'line-height'];
      for (var i = 0; i < props.length; i++) {
        var v = cs.getPropertyValue(props[i]);
        if (v) el.style.setProperty(props[i], v, 'important');
      }
    } catch (e) { /* 拿不到就用默认值 */ }
  }

  function applyEnabled(state) {
    if (!btn) return;
    btn._enabled = state;
    /* 2026-11-07 用户定：灰态就应该是灰的、点不动 —— 可点的灰按钮没有意义。
       所以恢复真禁用；「判错就永久点不动」这个风险改由**判据本身**兜住：
       「已选 N 条」+ 勾选控件反查 + 全选兜底，三路都失灵才会灰。
       三路都失灵时，日志会打出诊断数字，可一轮定位。 */
    btn.disabled = !state;
    btn.style.setProperty('cursor', state ? 'pointer' : 'not-allowed', 'important');
    btn.style.setProperty('background', state ? '#1664ff' : '#f2f3f5', 'important');
    btn.style.setProperty('color', state ? '#fff' : '#b8bcc4', 'important');
    btn.style.setProperty('border-color', state ? '#1664ff' : '#e3e5e9', 'important');
    btn.title = state
      ? '把已勾选商品的链接一次复制到剪贴板，单次最多 ' + MAX_LINKS + ' 条。'
      : '本页还没读到商品行，稍等一下';
  }

  /** 按钮自身的短反馈（勾/叉），2 秒复原 —— 与清空库存、粘贴加车同一观感 */
  function flash(text, kind) {
    if (!btn) return;
    if (flashTimer) { clearTimeout(flashTimer); flashTimer = null; }
    btn.textContent = text;
    btn.style.setProperty('background', kind === 'fail' ? '#c03532' : '#0f8a5f', 'important');
    btn.style.setProperty('border-color', kind === 'fail' ? '#c03532' : '#0f8a5f', 'important');
    flashTimer = setTimeout(function () {
      flashTimer = null;
      if (!btn || !btn.isConnected) return;
      btn.textContent = BTN_TEXT;
      applyEnabled(btn._enabled !== false);
      syncState();
    }, 2000);
  }

  /** 同步按钮可用态（勾选数 = 0 就灰掉） */
  /** 同步按钮可用态。
   *
   *  2026-11-07 用户定案：「没有勾选，按钮还常亮」不行 ⇒ 恢复门控：
   *  **没勾选就灰、点不动**。前提是勾选识别本身准（现场日志已证实
   *  「勾选 9 行」能正确读到），所以灰态不会再变成"判错就永久点不动"。
   *  判断顺序：平台的「已选 N 条」优先，读不到再数行。 */
  function syncState() {
    if (!btn) return;
    /* 复制过程中不改可用态：整页滚动会把批量栏滚出视口，
       findBatchBar 读不到就判成"没勾选"，按钮会在用户眼前变灰 —— 像是出错了。 */
    if (busy) return;
    var n = selectedCountFromBar();
    if (n >= 0) { applyEnabled(n >= 1); return; }
    applyEnabled(checkedRows().length >= 1);
  }

  function removeButton() {
    if (btn && btn.parentNode) btn.parentNode.removeChild(btn);
    btn = null;
  }

  /**
   * 挂按钮。
   *
   * 位置：用户指定「更多操作」右边。做法是插到批量栏里「更多操作」
   * 那个元素的**同级之后**；若它被包在一层容器里（按钮 + 下拉箭头），
   * 就退到批量栏末尾 —— 两种结果视觉上都在「更多操作」右侧。
   */
  function ensureButton() {
    if (!on) return;
    if (!inScope()) { removeButton(); return; }

    var bar = findBatchBar();
    if (!bar) {
      removeButton();
      note('miss', '批量复制链接:已注入，但没找到批量工具条（每 1.2 秒重试）');
      return;
    }

    ensureStyle();

    if (btn && btn.isConnected && btn.parentNode) {
      if (btn.parentNode !== bar && btn.parentNode.parentNode !== bar) {
        /* 被页面重渲染挤走了 → 重新贴回去 */
        placeButton(bar);
      }
      syncState();
      return;
    }

    var like = leafByText(bar, '更多操作') || leafByText(bar, '批量下架');
    btn = document.createElement('button');
    btn.type = 'button';
    btn.className = CLS_BTN;
    btn.textContent = BTN_TEXT;
    btn.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      onClick();
    }, true);

    if (like) {
      var base = like.closest('button, a, [role="button"]') || like;
      adoptLook(btn, base);
    } else {
      btn.style.setProperty('height', '32px', 'important');
      btn.style.setProperty('padding-left', '14px', 'important');
      btn.style.setProperty('padding-right', '14px', 'important');
      btn.style.setProperty('border-radius', '4px', 'important');
      btn.style.setProperty('font-size', '14px', 'important');
    }
    btn.style.setProperty('border', '1px solid #1664ff', 'important');
    btn.style.setProperty('font-weight', '600', 'important');
    btn.style.setProperty('white-space', 'nowrap', 'important');
    btn.style.setProperty('margin-left', '12px', 'important');

    placeButton(bar);
    syncState();
    note('ok', '批量复制链接:按钮已挂上（工具条末尾）');
  }

  /**
   * 落点（用户 2026-11-06 定）：**这一排最右边**。
   *
   * 商品管理页的批量工具条是「…批量下架 / 批量修改 / 查看优化记录」，
   * 没有「更多操作」；渠道品页才有。所以：
   *   · 有「更多操作」⇒ 贴它右侧（渠道品页沿用旧口径，不破坏已上线行为）；
   *   · 没有 ⇒ 追加到工具条末尾 = 用户说的「这一排最右边」。
   */
  function placeButton(bar) {
    var more = leafByText(bar, '更多操作');
    if (more) {
      var moreBtn = more.closest('button, a, [role="button"]') || more;
      if (moreBtn && moreBtn.parentNode === bar) {
        bar.insertBefore(btn, moreBtn.nextSibling);
        return;
      }
    }
    bar.appendChild(btn);
  }

  /* ==========================================================
   * 五、点击：复制 → 报结果 → 取消勾选
   * ========================================================== */

  /** 复制成功后按用户口径复位勾选（只点勾选框，不碰别的控件） */
  function uncheckRows(rows) {
    var n = 0;
    for (var i = 0; i < rows.length; i++) {
      var tr = rows[i];
      if (!tr || !tr.isConnected) continue;
      var cb = tr.querySelector('input[type="checkbox"]');
      if (cb && cb.checked) {
        try { cb.click(); n++; } catch (e) { /* 单行失败不影响别的 */ }
        continue;
      }
      if (!cb) {
        /* 平台自绘勾选：点它自己的标记 */
        var cell = tr.cells && tr.cells[0];
        var mark = cell && cell.querySelector('[class*="checkbox"]');
        if (mark) {
          try { mark.click(); n++; } catch (e2) { /* 忽略 */ }
        }
      }
    }
    return n;
  }


  /* ==========================================================
   * 五之前 · 逐行点击复制（2026-11-07 用户定案）
   * ==========================================================
   * 用户原话：「其实我只需要你代劳把我把每个商品【复制链接】点一遍，
   *   每次都会在粘贴板生成那个商品的链接，你把它累加起来就可以了」。
   *
   * 这条路比"解析 ID 再拼链接"稳得多：
   *   · 链接由平台自己生成，格式天然正确（不用赌模板带不带参数）；
   *   · 不依赖商品 ID 能不能从行文本里挖出来；
   *   · 平台改版换链接格式，这里一动不动。
   * 代价是慢：每行一次点击 + 一次剪贴板读取，约 200ms/行，30 行约 6 秒。
   *
   * ⚠️ 读剪贴板不能直读：内容脚本里 navigator.clipboard.readText 受页面
   *   clipboard-read 权限约束，实测会一直悬着（点了没反应）。走后台
   *   （chrome.runtime → 离线文档，带扩展 clipboardRead 权限），
   *   与「粘贴加橱窗」同一套通道。
   */

  function sleep(ms) {
    return new Promise(function (r) { setTimeout(r, ms); });
  }

  /** 从链接里取商品 ID（去重用） */
  function idOfLink(u) {
    var m = /[?&]id=(\d{10,})/.exec(String(u || ''));
    return m ? m[1] : '';
  }

  /** 行内的「复制链接」按钮（精确文本，避开「复制货号」之类） */
  function linkButtonIn(tr) {
    if (!tr) return null;
    var nodes;
    try { nodes = tr.querySelectorAll('button, a, [role="button"], span'); }
    catch (e) { return null; }
    for (var i = 0; i < nodes.length; i++) {
      if (tight(nodes[i]) === '复制链接') return nodes[i];
    }
    return null;
  }

  /** 像不像一条完整的链接（不是口令、不是半截文本） */
  function isLinkish(text) {
    var t = String(text || '').trim();
    return /^https?:\/\/\S+$/i.test(t);
  }

  function readClipboard() {
    return new Promise(function (resolve, reject) {
      var settled = false;
      var timer = setTimeout(function () {
        if (settled) return;
        settled = true;
        reject(new Error('读取超时'));
      }, 700);

      function finish(ok, text, why) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (ok) resolve(text); else reject(new Error(why || '读取失败'));
      }

      function direct(why) {
        if (navigator.clipboard && navigator.clipboard.readText) {
          navigator.clipboard.readText().then(
            function (t) { finish(true, t); },
            function (e) { finish(false, '', (e && e.message) || why); }
          );
          return;
        }
        finish(false, '', why);
      }

      try {
        chrome.runtime.sendMessage({ type: 'dyc:readClipboard' }, function (r) {
          var err = chrome.runtime.lastError;
          if (err) { direct(err.message); return; }
          if (r && r.ok) { finish(true, r.text || ''); return; }
          direct((r && r.error) || '后台读取失败');
        });
      } catch (e) {
        direct(e && e.message);
      }
    });
  }

  /**
   * 收集所有「可能承载纵向滚动」的目标，最内层在前，最后一个是 null（= window）。
   *
   * ⚠️ 2026-11-07 第三次修正（用户「还是没有全」，日志里 `滚动=整页`）：
   *   只认 `overflow-y: auto/scroll` 的祖先不够 —— 这页真正在滚的
   *   `div.styles_newContainer` 是靠内容溢出的，computed overflowY 未必是
   *   auto/scroll，于是被判成"不可滚"，退回整页；而整页到 1823px 就到底，
   *   表格下半截（还有 700 多 px）永远扫不到，正好对应少掉的那几条。
   *   ⇒ 判据改成**只看「内容高 − 可见高 > 40」**，不再看 overflow 属性；
   *     也不再假定"只有一个能滚"，逐个试、谁真动了就用谁。
   */
  function scrollTargets() {
    var list = [];
    var el = null;
    try { el = document.querySelector('tbody.ecom-g-table-tbody'); }
    catch (e) { el = null; }

    var guard = 0;
    while (el && el !== document.body && el !== document.documentElement &&
           guard++ < 40) {
      var room = 0;
      try { room = el.scrollHeight - el.clientHeight; } catch (e2) { room = 0; }
      if (room > 40) list.push(el);
      el = el.parentElement;
    }

    /* body / documentElement 自己也可能是滚动的（这页 body 内容高 4065 / 可见 950） */
    var cands = [document.body, document.documentElement];
    for (var i = 0; i < cands.length; i++) {
      var n = cands[i];
      if (!n || list.indexOf(n) >= 0) continue;
      var r = 0;
      try { r = n.scrollHeight - n.clientHeight; } catch (e3) { r = 0; }
      if (r > 40) list.push(n);
    }

    /* 再补一批「按类名认识的可滚容器」：这页的滚动在
       styles_newContainer / subAppContent / app-main 这一层，
       万一 tbody 的祖先链被打断（微前端挂载点），靠类名还能兜住。 */
    var extras = [];
    try {
      extras = document.querySelectorAll(
        '[class*="newContainer"], [class*="subAppContent"], #app-main, ' +
        '.app-content, [class*="responsive-wrapper"]');
    } catch (e4) { extras = []; }
    for (var ei = 0; ei < extras.length; ei++) {
      var ee = extras[ei];
      if (!ee || list.indexOf(ee) >= 0) continue;
      var er = 0;
      try { er = ee.scrollHeight - ee.clientHeight; } catch (e5) { er = 0; }
      if (er > 40) list.push(ee);
    }

    list.push(null);          // null = window.scrollTo 兜底
    return list;
  }

  /** 造一个「滚动器」：逐个目标试，谁真动了就用谁 */
  function makeMover() {
    var targets = scrollTargets();

    function pos(t) {
      if (!t) {
        return window.pageYOffset || document.documentElement.scrollTop || 0;
      }
      return t.scrollTop || 0;
    }
    function setPos(t, v) {
      if (!t) { try { window.scrollTo(0, v); } catch (e) { /* 忽略 */ } return; }
      try { t.scrollTop = v; } catch (e2) { /* 忽略 */ }
    }

    var origin = [];
    for (var i = 0; i < targets.length; i++) origin.push(pos(targets[i]));

    return {
      targets: targets,
      first: targets.length ? targets[0] : null,
      step: function (delta) {
        for (var k = 0; k < targets.length; k++) {
          var t = targets[k];
          var before = pos(t);
          setPos(t, Math.max(0, before + delta));
          var after = pos(t);
          if (Math.abs(after - before) >= 8) {
            return { moved: after - before, target: t };
          }
        }
        return { moved: 0, target: null };
      },
      restore: function () {
        for (var k = 0; k < targets.length; k++) setPos(targets[k], origin[k]);
      },
      /* 把所有目标一次性推到顶/底（scrollTop=1e9 会被浏览器自动夹到最大值）。
         预热要用它：光推"第一个能动的"不够，页面里可能有多层各自要滚。 */
      end: function (dir) {
        for (var k = 0; k < targets.length; k++) {
          setPos(targets[k], dir > 0 ? 1e9 : 0);
        }
      }
    };
  }

  /**
   * 逐行点「复制链接」，把每次剪贴板里新出现的链接累加起来。
   *
   * ⚠️ 2026-11-07 关键修正（用户：「20 个品都在同一页」但只复制出 9 条）：
   *   这张表是**虚拟滚动** —— tbody 里只有视口附近的十几行（还有一个
   *   `ecom-g-table-measure-row` 占位行作证），滚出去的行会被销毁。
   *   用户勾的 20 个横跨好几屏，而 DOM 里同时只存在 9~11 个，
   *   所以"取一次行然后全点一遍"必然漏掉大半。
   *   ⇒ 改为**逐屏滚动收集**：滚到顶 → 点当前屏的勾选行 → 滚一屏 → 再点
   *     → 直到滚到底。链接去重，滚完恢复用户原来的滚动位置。
   *
   * @param {Array} rows 首屏已识别的勾选行（后面每屏重新识别）
   * @returns {Promise<string[]>} 去重后的链接
   */
  async function collectByClick(rows, expect) {
    var total = (typeof expect === 'number' && expect > 0) ? expect : 0;
    var out = [];
    var seenLink = {};
    var seenId = {};       /* 按商品 ID 去重：同一商品点两次会得到同一条链接，
                              第二次因"剪贴板没变化"被判失败、走 ID 兜底时，
                              必须靠它挡住，否则会多出一条格式不同的重复链接 */
    var seenRow = {};
    /* 顺手记下已收商品的名字：数量对不上时打出来，
       用户一眼能看出少的是哪几个，不用再猜。 */
    var outNames = [];
    out.names = outNames;
    var prev = '';
    try { prev = String(await readClipboard() || ''); } catch (e) { prev = ''; }

    /* 点一屏里的行：rowKey 去重，避免滚动后被重复点击 */
    async function takeFrom(list) {
      for (var i = 0; i < list.length && out.length < MAX_LINKS; i++) {
        var tr = list[i];
        /* 行指纹优先用商品 ID：用「文本前 100 字」时，同系列商品名开头一样，
           会被误判成同一行而跳过 —— 这正是「勾 20 只收 18」里少掉的那两条。 */
        var rid = rowProductId(tr);
        var key = rid
          ? ('id:' + rid)
          : ('txt:' + String(tr.textContent || '').replace(/\s+/g, '').slice(-80));
        if (seenRow[key]) continue;

        var b = linkButtonIn(tr);
        if (!b) {
          /* 行里没有「复制链接」按钮（有的商品行动作列是下拉菜单/只有部分按钮）。
             原来这里静默 continue —— 一行日志都没有，等于无声漏掉，
             用户只看到条数少了却查不到原因。
             现在：有商品 ID 就直接用 ID 拼，没有才留到下一屏再试。 */
          var skipId = rowProductId(tr);
          if (skipId && !seenId[skipId]) {
            seenId[skipId] = 1;
            seenRow[key] = 1;
                out.push(LINK_PREFIX + skipId);
            outNames.push(String(tr.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 16));
            log('批量复制链接:本屏第 ' + (i + 1) +
                ' 行没有「复制链接」按钮，直接用 ID 补 · id:' + skipId);
          }
          continue;
        }
        seenRow[key] = 1;

        /* 分母用**预计条数**（勾选了多少），不是上限 30。
           2026-11-07 用户指出：一开始写 `0/30` 让人以为要复制 30 条。 */
        var denom = Math.max(total, out.length);
        setStatus('正在逐条复制 · 已收 ' + out.length + ' 条', 'running', {
          source: SOURCE,
          count: denom ? (out.length + '/' + denom) : (out.length + ' 条')
        });

        try { b.click(); } catch (e2) { continue; }

        var link = '';
        /* fromClip：这条 link 是不是**真从剪贴板读到的**。
           只有它为 true 才能更新 prev（比较基准）。见下面的坑。 */
        var fromClip = false;
        /* 平台写剪贴板是同步的，450ms 足够；原来 8×100 只是把失败情况拖长 */
        for (var w = 0; w < 5; w++) {
          await sleep(90);
          var t = '';
          try { t = String(await readClipboard() || '').trim(); } catch (e3) { t = ''; }
          if (t && t !== prev && isLinkish(t)) { link = t; fromClip = true; break; }
        }

        /* 点了没反应（2026-11-07 用户报「勾 20 只成功 13」）：
           行滚出视口后平台不响应合成点击。
           ⚠️ 重试时**必须重新取按钮元素** —— scrollIntoView 会触发虚拟滚动
           重新渲染，手里那个 b 已经被销毁，再 click() 等于点空气。 */
        if (!link) {
          try { tr.scrollIntoView({ block: 'center' }); } catch (e4) { /* 老内核忽略 */ }
          await sleep(260);
          var b2 = linkButtonIn(tr) || b;
          try { b2.click(); } catch (e5) { /* 忽略 */ }
          for (var w2 = 0; w2 < 8; w2++) {
            await sleep(120);
            var t2 = '';
            try { t2 = String(await readClipboard() || '').trim(); } catch (e6) { t2 = ''; }
            if (t2 && t2 !== prev && isLinkish(t2)) { link = t2; fromClip = true; break; }
          }
        }

        /* 最后兜底：点击怎么也拿不到，就用行内商品 ID 直拼。
           拼出来的链接少几个来源参数，但同样能打开商品页、能被橱窗接口认。
           —— 少一条比"卡在这儿整批失败"好得多。 */
        if (!link) {
          var fallbackId = rowProductId(tr);
          if (fallbackId && !seenId[fallbackId]) {
            link = LINK_PREFIX + fallbackId;
            /* ⚠️ 这里**不能**先 seenId[fallbackId]=1：下面统一按 ID 判重时会
               读到它，然后 continue —— 补出来的链接当场被自己丢掉。
               2026-11-07 实测：第一次点击识别到 12/16/17 行勾选却一条没涨，
               6 次「改用 ID 补全」全部泥牛入海，就是这个原因。
               去重交给下面统一做，这里只负责生成。 */
            log('批量复制链接:本屏第 ' + (i + 1) + ' 行点击无效，改用 ID 补全 · ' + key.slice(0, 24));
          }
        }

        if (!link) {
          log('批量复制链接:本屏第 ' + (i + 1) + ' 行点击与 ID 兜底都失败 · ' + key.slice(0, 24));
          continue;
        }
        /* ⚠️ 坑（2026-11-07 自测抓到，真机「识别 16 行累计不涨」同源）：
           兜底拼出来的链接**没有进过剪贴板**。如果把它写进 prev，
           下一次点击无效时剪贴板里剩的还是上一条旧链接，它与 prev 不相等，
           就被当成"新链接"收下 —— 于是把旧链接挂到这一行头上，
           再被 ID 去重挡掉，整行凭空消失。
           所以只有真从剪贴板读到的，才更新比较基准。 */
        if (fromClip) prev = link;
        var lid = idOfLink(link);
        /* 按商品 ID 判重：同一商品可能以两种格式出现（平台原样 / ID 补全），
           只比链接字符串会漏，最终就会重复。 */
        if (lid && seenId[lid]) continue;
        if (lid) seenId[lid] = 1;
        log('批量复制链接:【调试】收录 ' + link.slice(-20) + ' 累计' + out.length);
        if (!seenLink[link]) {
          seenLink[link] = 1;
          out.push(link);
          outNames.push(String(tr.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 16));
        }
      }
    }

    await takeFrom(rows);

    if (out.length >= MAX_LINKS) return out;

    /* 还差多少：平台说勾了 N 条，我们只收到 M 条 ⇒ 有行没渲染出来。
       ⚠️ 读不到「已选 N 条」时（现场日志出现过 -1）不能直接判"够了" ——
       那样滚动永远不会发生，勾 20 个还是只出 10 个。
       读不到就**无条件滚一遍**，以"滚不动"为终止条件。 */
    var pickedAll = selectedCountFromBar();
    var unknownCount = pickedAll <= 0;
    function stillNeed() {
      return unknownCount ? 1 : (pickedAll - out.length);
    }
    if (!unknownCount && pickedAll <= out.length) return out;

    var mover = makeMover();

    /** 当前页面"能滚多长"的指纹（取所有候选目标里最大的 scrollHeight） */
    function pageHeight() {
      var h = 0;
      try { h = document.documentElement.scrollHeight || 0; } catch (e) { h = 0; }
      for (var pi = 0; pi < mover.targets.length; pi++) {
        var pt = mover.targets[pi];
        if (!pt) continue;
        var ph = 0;
        try { ph = pt.scrollHeight || 0; } catch (e2) { ph = 0; }
        if (ph > h) h = ph;
      }
      return h;
    }

    /* ==========================================================
     * 预热：先把页面拖到底，把底部**懒加载的广告**催出来
     * ==========================================================
     * 用户 2026-11-07 指出：「第一次拉到最底部会加载广告在下面，所以不能用
     *   按钮开始时的页面长度来算。要不试试先滑到底部把广告加载出来，
     *   再开始从头到尾的读取」。
     *
     * 这正是之前"滚到 2181px 就判到底"的真正原因：广告还没加载，
     *   文档就是那么高，于是提前收工，下面的商品行永远没被渲染。
     * 做法：反复滚到底 → 等布局稳定 → 看页面有没有长高；
     *   长高了就继续，直到高度不再变（最多 8 轮，防止无限等待）。
     */
    var heightBefore = pageHeight();
    /* 预热要滚到底等广告，几秒钟没动静会像卡住 —— 先给条进度 */
    if (heightBefore > 0) {
      setStatus('正在加载完整列表', 'running', { source: SOURCE, count: '滚到底部' });
    }
    var warm = 0;
    var stable = 0;
    /* 高度读不到（无布局环境，比如 jsdom 自测）就别白等 —— 预热在那种环境下没有意义 */
    for (; heightBefore > 0 && warm < 10; warm++) {
      var hb = pageHeight();
      mover.end(1);
      await sleep(900);
      var ha = pageHeight();
      if (ha <= hb + 8) {
        /* 连续两轮都不再长高才算加载完。只判一轮会误判 ——
           实测第一次只滚 2 轮就"稳定"在 4061，真正稳定是 4072，
           差的这 11px 下面正好还有商品行，于是"第一次总是不全、第二次能成功"。 */
        stable++;
        if (stable >= 2) break;
      } else {
        stable = 0;
      }
    }
    var heightAfter = pageHeight();
    log('批量复制链接:预热滚底 ' + warm + ' 轮 · 页面高 ' + heightBefore +
        ' → ' + heightAfter + (heightAfter > heightBefore + 8 ? '（底部有新内容）' : '') +
        ' · 本页 ' + allProductRows().length + ' 行');

    /* 预热完回到顶部，从第一屏开始正式扫 */
    mover.end(-1);
    if (heightBefore > 0) await sleep(420);

    /* 步长按「剩余空间最大」的那个容器算：最内层可能只是个矮包装层，
       拿它算步长会导致一次滚过头，中间行来不及渲染就被越过。 */
    var viewH = window.innerHeight || 800;
    var bestRoom = -1;
    for (var ti = 0; ti < mover.targets.length; ti++) {
      var tt = mover.targets[ti];
      if (!tt) continue;
      var room = 0;
      try { room = tt.scrollHeight - tt.clientHeight; } catch (e8) { room = 0; }
      if (room > bestRoom) { bestRoom = room; viewH = tt.clientHeight || viewH; }
    }
    var stepLen = Math.min(720, Math.max(300, Math.round(viewH * 0.62)));

    log('批量复制链接:' + (unknownCount
        ? '读不到「已选 N 条」，逐屏扫一遍'
        : ('还差 ' + stillNeed() + ' 条')) +
        ' · 可用滚动目标 ' + (mover.targets.length - 1) + ' 个（含 window）');

    /** 扫一个方向：dir=1 向下，-1 向上。返回扫了几轮 */
    async function sweep(dir, maxRounds, tag) {
      var rounds = 0;
      var idle = 0;
      while (rounds++ < maxRounds && out.length < MAX_LINKS && stillNeed() > 0) {
        var more = checkedRows();
        if (more.length > total) total = more.length;
        if (!more.length && rounds > 1) {
          log('批量复制链接:' + tag + '第 ' + rounds + ' 屏读到 0 行勾选 · 本页行=' +
              allProductRows().length);
        }
        await takeFrom(more);

        var hBefore = pageHeight();
        var r = mover.step(dir * stepLen);
        var tname = r.target
          ? String(r.target.className || r.target.tagName || '').slice(0, 22)
          : 'window';
        log('批量复制链接:' + tag + '第 ' + rounds + ' 屏 · 勾选 ' + more.length +
            ' 行/总 ' + allProductRows().length + ' 行 · 累计 ' + out.length +
            ' 条 · 移动 ' + Math.round(r.moved) + 'px@' + tname);

        /* 没动就多等一会：虚拟滚动重渲染慢，立刻判"到底"会误杀 */
        await sleep(Math.abs(r.moved) < 8 ? 700 : 420);

        /* 滚不动但页面**长高了**（又加载出广告/内容）⇒ 不是到底，继续滚 */
        var hNow = pageHeight();
        var grew = hNow > hBefore + 8;
        if (grew) log('批量复制链接:' + tag + '页面长高 ' + hBefore + ' → ' + hNow + '，继续');
        idle = (Math.abs(r.moved) < 8 && !grew) ? idle + 1 : 0;
        if (idle >= 2) break;
      }
      return rounds;
    }

    var downRounds = await sweep(1, 30, '');

    /* 反向补扫（2026-11-07 用户「还是没有全」）：
       向下扫时行是"滚过去才渲染"，滚动太快会有行来不及出现在 DOM 里就被越过；
       从底部往回再扫一遍，能把这些漏网行捞回来。 */
    if (stillNeed() > 0 && out.length < MAX_LINKS) {
      log('批量复制链接:向下扫完还差 ' + stillNeed() + ' 条，反向补扫');
      await sweep(-1, 30, '[回扫]');
    }

    /* 恢复用户原来的视图，不因为复制把他滚到别处 */
    mover.restore();

    log('批量复制链接:滚动收集结束 · 下扫 ' + downRounds + ' 屏 · 收 ' + out.length +
        ' 条 · 平台已选=' + pickedAll);
    return out;
  }

  /** 兜底：从行内商品 ID 直拼链接（点击法完全失效时用） */
  function linksFromIds(rows) {
    var seen = {};
    var out = [];
    for (var i = 0; i < rows.length && out.length < MAX_LINKS; i++) {
      var id = rowProductId(rows[i]);
      if (!id || seen[id]) continue;
      seen[id] = 1;
      out.push(LINK_PREFIX + id);
    }
    return out;
  }

  async function onClick() {
    if (!btn || btn.disabled || busy) return;
    busy = true;

    try {
      /* 范围：**只处理已勾选的行**。
         ⚠️ 2026-11-07 用户报「还没勾选就框框复制东西，是 bug」：
           上一版在识别不到勾选时按整页复制，等于替用户做了他没要求的操作 ——
           错数据（多复制几十条进橱窗）比失败麻烦得多。这条永久禁止：
           **没勾选就什么都不复制**，只给提示。 */
      /* ⚠️ 超过上限**直接拦下，不开始**（用户 2026-11-07 定）：
         「勾选了一百个，应该在一开始识别到超过30个就停止，因为超过30个根本用不了」。
         上一版是"滚完所有屏再截前 30"——勾 100 个要滚 19 屏、几十秒，
         结果还是用不了。前置判断，一个问题都不干。 */
      var pickedFirst = selectedCountFromBar();
      if (pickedFirst > MAX_LINKS) {
        setStatus('商品链接', 'alert', {
          source: SOURCE,
          count: '未复制',
          full: '已勾选 ' + pickedFirst + ' 个，超过单次 ' + MAX_LINKS +
                ' 个上限，请减少勾选后再试',
          keepHistory: true
        });
        flash('✗ 超过 ' + MAX_LINKS, 'fail');
        log('批量复制链接:勾选 ' + pickedFirst + ' 个，超过上限，未开始');
        busy = false;
        return;
      }

      var rows = checkedRows();

      if (!rows.length) {
        var picked = selectedCountFromBar();
        var total = allProductRows().length;
        setStatus('商品链接', 'alert', {
          source: SOURCE,
          count: '未复制',
          full: total === 0
            ? '本页没读到商品行，请刷新页面后重试'
            : (picked > 0
                ? ('已勾选 ' + picked + ' 条，与当前页 ' + total +
                   ' 行对不上，请在同一页内勾选后重试')
                : '请先在左边勾选要复制的商品'),
          keepHistory: true
        });
        flash('✗ 未复制', 'fail');
        log('批量复制链接:没有可处理的勾选行 · 已选=' + picked + ' · 本页=' + total);
        dumpRowProbe(allProductRows());
        busy = false;
        return;
      }

      var over = rows.length > MAX_LINKS;

      /* 预计条数 = 平台说勾了多少（读不到就用当前识别到的行数） */
      var expect = selectedCountFromBar();
      if (expect <= 0) expect = rows.length;

      /* 主路径：逐行点「复制链接」+ 读剪贴板累加 */
      var links = await collectByClick(rows, expect);

      /* 兜底：点击法一条都没拿到（平台拦合成点击 / 读不到剪贴板）→ ID 直拼 */
      if (!links.length) {
        log('批量复制链接:点击法没拿到链接，改用 ID 直拼兜底');
        links = linksFromIds(rows);
      }

      if (!links.length) {
        log('批量复制链接:两条路都没拿到链接 · 行=' + rows.length +
            ' · 总行=' + allProductRows().length +
            ' · 已选=' + selectedCountFromBar());
        setStatus('商品链接', 'alert', {
          source: SOURCE,
          count: '未复制',
          full: '点了 ' + rows.length + ' 行但没拿到链接（可能读不到剪贴板），请重试',
          keepHistory: true
        });
        flash('✗ 未复制', 'fail');
        busy = false;
        return;
      }

      /* 最终自检（用户 2026-11-07 要求「检查有没有重复」）：
         写入前再按商品 ID 去一遍。前面每一步都在防重复，这里是不信任前序、
         只信最后结果的一道闸 —— 一旦真有重复，宁可在这一步丢掉，
         也不能让剪贴板里出现两条同商品的链接（加橱窗会被判重复添加）。 */
      var beforeDedup = links.length;
      var finalIds = {};
      links = links.filter(function (u) {
        var id = idOfLink(u);
        if (!id) return true;
        if (finalIds[id]) return false;
        finalIds[id] = 1;
        return true;
      });
      if (beforeDedup !== links.length) {
        log('批量复制链接:最终去重移除 ' + (beforeDedup - links.length) + ' 条重复');
      }
      log('批量复制链接:最终 ' + links.length + ' 条 · 商品 ID 互不相同');

      /* 数量对不上时，把已收到的商品名打出来 —— 用户对着自己勾的 20 个一核，
         立刻能看出少的是哪几条，不用再来回试。 */
      var barSel = selectedCountFromBar();
      if (barSel > links.length && links.names && links.names.length) {
        log('批量复制链接:已收清单(' + links.names.length + ') → ' +
            links.names.join(' | '));
      }

      copyText(links.join('\n'), function (ok) {
        busy = false;

        if (!ok) {
          setStatus('商品链接', 'alert', {
            source: SOURCE,
            count: '复制失败',
            full: '浏览器拒绝了剪贴板写入，请重试',
            keepHistory: true
          });
          flash('✗ 失败', 'fail');
          log('批量复制链接:剪贴板写入失败');
          return;
        }

        var notes = [];
        if (over) notes.push('超过 ' + MAX_LINKS + ' 条上限，只复制了前 ' + links.length + ' 条');
        /* 数量对不上必须交代（2026-11-07 用户多次报「少了 N 条」）：
           原因可能是跨页勾选，也可能是滚太快有行没渲染出来。
           两种都只影响"没拿到的那些"，不能瞒着用户当全成功。 */
        var pickedAll = selectedCountFromBar();
        if (pickedAll > links.length) {
          notes.push('已勾选 ' + pickedAll + ' 条，本次取到 ' + links.length +
                     ' 条；差 ' + (pickedAll - links.length) +
                     ' 条没在页面里找到，再点一次或翻页后可补齐');
        }

        setStatus(links.length + ' 个商品链接', 'success', {
          source: SOURCE,
          count: over ? ('只复制前 ' + links.length + ' 条') : '已复制',
          full: notes.length ? notes.join('；') : undefined,
          keepHistory: true,
          dropRunning: true
        });

        flash('✓ 已复制', 'ok');
        log('批量复制链接:完成 ' + links.length + ' 条 · 勾选 ' + rows.length + ' 行');

        /* 取消勾选（用户定）：只清真正识别出来的勾选行 */
        var rowsToClear = checkedRows();
        setTimeout(function () {
          log('批量复制链接:已取消勾选 ' + uncheckRows(rowsToClear) + ' 行');
        }, 600);
      });
    } catch (err) {
      busy = false;
      setStatus('商品链接', 'alert', {
        source: SOURCE,
        count: '复制失败',
        full: String(err && err.message || err),
        keepHistory: true
      });
      flash('✗ 失败', 'fail');
      log('批量复制链接:异常 ' + (err && err.message));
    }
  }

  /* ==========================================================
   * 六、开关与挂载
   * ========================================================== */

  function start() {
    if (on) return;
    on = true;
    note('start', '批量复制链接:脚本已注入，开始找批量工具条');
    ensureButton();

    if (!start.__keep) {
      /* 批量栏只在勾选后才渲染，所以必须持续盯；findBatchBar 有缓存，
         命中缓存只做一次 textContent 检查，代价很低。 */
      start.__keep = setInterval(function () {
        if (!on) return;
        if (!inScope()) { removeButton(); return; }
        ensureButton();
      }, 1200);
    }

    if (!start.__clickBound) {
      start.__clickBound = true;
      /* 勾选/取消勾选是 click —— 便宜地立刻刷新一次按钮态，
         不必等 1.2 秒轮询。过滤 isTrusted：自己的取消勾选不触发回环。 */
      document.addEventListener('click', function (e) {
        if (!on) return;
        if (e && e.isTrusted === false) return;
        var t = e.target;
        if (!t || !t.closest) return;
        if (!t.closest('input[type="checkbox"], [class*="checkbox"], th, thead')) return;
        if (retryTimer) clearTimeout(retryTimer);
        retryTimer = setTimeout(function () {
          retryTimer = null;
          ensureButton();
        }, 240);
      }, true);
    }
  }

  function stop() {
    on = false;
    if (start.__keep) { clearInterval(start.__keep); start.__keep = null; }
    removeButton();
    var st = document.getElementById(STYLE_ID);
    if (st && st.parentNode) st.parentNode.removeChild(st);
  }

  dycReadFlags().then(function (flags) {
    if (flags.shopBatchCopyLink !== false) start();
  });
  dycWatchFlags(function (flags) {
    if (flags.shopBatchCopyLink !== false) start(); else stop();
  });
})();
