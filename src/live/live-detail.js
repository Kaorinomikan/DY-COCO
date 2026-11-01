/**
 * 罗盘直播明细「货号」按钮 + 商品名完整显示(反馈 #84 · 方案乙)
 * ============================================================
 * 【作用页】电商罗盘「直播明细」—— 两个入口,两条路径**不同**,是两个独立页面:
 *     抖店侧  https://compass.jinritemai.com/shop/live-detail
 *     达人侧  https://compass.jinritemai.com/talent/live-statement
 *   真机实测两侧**结构同构**(抖店 `aurora-` / 达人 `ecom-` 两套主题前缀),
 *   故一套代码通吃;选择器一律用 `[class*="xxx-"]` 前缀匹配,
 *   **不写死 class 哈希**(两侧哈希不同,且平台发版会换)。
 *
 * 【做两件事(用户 2026-10-15 定)】
 *   ① **商品名完整显示** —— 名称过长时平台用 `-webkit-line-clamp:2` + `ellipsis`
 *      截断。方案乙:把商品信息容器由 `flex` 改成**块级**、缩略图改**左浮动**,
 *      名称就跨到图片下方 —— 第一行仍受缩略图挤压,第二行起吃满整宽。
 *      **不动列宽、不新增横向滚动、行高基本不变**(实测:名称区 164→156/220,
 *      2 行容量 328→376px)。
 *   ② **「货号」按钮** —— 文案与中控台小黄车那枚一致,点一下把款号写进剪贴板,
 *      成功后按钮原地显示「已复制」。位置 = **名称块右下方、右对齐**
 *      (方案乙的落点:名称已跨行吃满宽度,右侧没有空位放按钮,故下移一行)。
 *
 * 【为什么按钮在名称下方而不是右侧(2026-10-15 用户在两方案间选定乙)】
 *   方案甲(按钮在名称右侧)要把商品信息列从 252px 加宽到 350px ⇒ 表格
 *   1611→1709px、超出用户视口(1707px)需要横向滚动。用户选乙:宁可按钮下移,
 *   也不要表格变宽。两方案都做过真实尺寸模拟,对比页见会话内
 *   `output/直播明细-布局冲突确认.html`。
 *
 * 【取号优先级 —— 三档,逐级兜底,与中控台 copy-code.js 同一套口径】
 *   ① **官方货号**:行内若有平台写出的「货号」值,直接用。最可靠。
 *   ② **名称尾部推算**:从名称末尾截「≥4 位、且含数字」的字母数字串
 *      (C1919 / NC1D1121 / ND1C1355 这类)。
 *      ⚠️ 这一档是**推算**,不是官方数据;名称末尾若不是款号,它取不到东西,不瞎猜。
 *   ③ 两档都拿不到 → 按钮点下去只提示「无货号」,**绝不复制半截内容**。
 *   ⚠️ 实测两侧行内都**没有**平台自带的复制按钮(中控台那枚「复制 ID」在这里不存在),
 *      所以按钮只能锚在**名称元素**上。
 *
 * 【取值输入必须剔除「我们自己」—— 反馈 #96,2026-10-18】
 *   真机事故:点「货号」复制到的是**右边「成交件数」那一格**的数字(340),
 *   而且**只在成交件数 100~999 时**出错。根因不在正则,在**输入被污染**:
 *   本页一行是原生 `<tr>`,按钮插在商品名之后 ⇒ 读 `row.innerText` 时整行拼成
 *     「… NE1C1091W 货号 340 ¥131,395.55 5,341 5.2%」
 *   按钮文案「货号」与右侧成交件数被空白折叠连成「货号 340」,
 *   而官方货号正则的量词正是 `{3,30}` ⇒ 三位数**恰好**满足:
 *     · 1~2 位(0~99)  → 不足 3 位,不匹配 ⇒ 正常
 *     · **100~999**    → 必错(整数窗口,900 个值无一例外)
 *     · 四位数起        → 平台加千分位逗号「1,234」,「1」后紧跟逗号 ⇒ 反而躲过
 *   右侧另三列永久安全:`¥131,395.55`(¥ 挡)、`5,341` / `5.2%`(逗号与小数点打断)。
 *   ⇒ 修法:**取值一律走 textWithoutExt()**,读到的永远只有页面数据,
 *     且范围先收进「商品信息」单元格、再退整行。**绝不可回退 row.innerText**。
 *
 * 【按钮说明(悬停提示)】沿用中控台口径:初始态说明取号规则、取到态标明来源、
 *   取不到态说明为什么取不到。用户不该等到出错才靠猜去理解规则。
 *
 * 【消息提示(第 21 条三段式)】来源词复用中控台的「货号复制」,值 = 已复制货号 X /
 *   这一行没找到货号;`keepHistory:false` —— 复制是高频操作,全收进盒子会刷满历史。
 *
 * 【行怎么找】罗盘表格是原生 <table>,**含一个高度 0 的测量行**
 *   (`*-table-measure-row`),必须排除;再要求行内**含 img**(商品行必有缩略图),
 *   这样不会误伤页面上别的表格。
 *
 * 【虚拟滚动 / 平台重绘】行节点会被重建 ⇒ MutationObserver + 300ms 防抖补注入。
 *   ⚠️ 名称放宽靠的是**一条全局 CSS**(不是逐行改内联样式),所以行重建后样式自动生效;
 *      只有按钮需要逐行补插。
 *
 * 【开关】flags.js 的 `compassCopyCode`(抖店组,默认开)。关掉即时生效:
 *   摘观察器 + 移除按钮 + **移除名称放宽的样式**(页面恢复平台原样)。
 * ============================================================
 */

(function dycLiveDetail() {
  'use strict';

  // 防重复注入(SPA 路由回切、脚本意外重跑时不叠按钮)
  if (window.__dycLiveDetailLoaded) return;
  window.__dycLiveDetailLoaded = true;

  var BTN_CLASS = 'dyc-ld-btn';
  var STYLE_ID = 'dyc-ld-style';

  /* ---------- 依赖自检(flags.js 必须先加载) ---------- */
  if (typeof dycReadFlags !== 'function' || typeof dycWatchFlags !== 'function') {
    return;
  }

  var flags = null;
  var observer = null;
  var pending = false;

  function enabled() {
    return !!flags && flags.compassCopyCode !== false;
  }

  /* ---------- 样式(JS 注入;含「名称放宽」与「按钮」两部分) ---------- */

  var CSS = [
    /* ===== ① 名称完整显示(方案乙:块级容器 + 缩略图左浮动 ⇒ 名称跨行) ===== */
    /* 容器由 flex 改块级 —— 只有普通块级流才会让文字环绕浮动元素;
       同时用 overflow 包含浮动(否则容器高度会塌陷)。 */
    '[class*="productInfoWrap-"] {',
    '  display: block !important;',
    '  overflow: hidden !important;',
    '}',
    /* 缩略图左浮动:名称第一行避让它、第二行起吃满整宽。 */
    '[class*="productInfoWrap-"] > [class*="productImg-"] {',
    '  float: left !important;',
    '}',
    /* 名称的父容器:解除固定宽,且**不能**是 BFC(overflow:hidden 会变成 BFC,
       那样就与浮动元素错开、不环绕了)。 */
    '[class*="productInfoWrap-"] > div {',
    '  width: auto !important;',
    '  max-width: none !important;',
    '  overflow: visible !important;',
    '}',
    /* 名称元素:解除 2 行截断与省略号(display 一改,-webkit-line-clamp 即失效)。 */
    '[class*="productName-"] {',
    '  display: block !important;',
    '  width: auto !important;',
    '  max-width: none !important;',
    '  -webkit-line-clamp: unset !important;',
    '  -webkit-box-orient: initial !important;',
    '  overflow: visible !important;',
    '  text-overflow: clip !important;',
    '  white-space: normal !important;',
    '}',
    /* ===== ② 「货号」按钮(名称块右下方、右对齐) ===== */
    '.' + BTN_CLASS + ' {',
    '  all: initial;',
    /* 块级 flex:① 让 `margin-left:auto` 能把它推到右侧;② 内容居中。 */
    '  display: flex; align-items: center; justify-content: center;',
    '  width: 56px; height: 20px; padding: 0;',
    /* 名称下方一行、右对齐 —— 用户 2026-10-15 选定的落点(方案乙)。 */
    '  margin: 2px 0 0 auto !important;',
    '  flex: 0 0 auto;',
    '  border: 1px solid #0075ff; border-radius: 4px;',
    '  background: #fff; color: #0075ff;',
    "  font: 12px/1 -apple-system, 'Microsoft YaHei', sans-serif;",
    '  white-space: nowrap; cursor: pointer; box-sizing: border-box;',
    '  opacity: .55;',
    '  transition: opacity .15s, background .15s, color .15s;',
    '}',
    '.' + BTN_CLASS + ':hover { opacity: 1; background: #0075ff; color: #fff; }',
    '.' + BTN_CLASS + '.is-err { border-color: #86909c; color: #86909c; background: #fff; }',
    '.' + BTN_CLASS + '.is-err:hover { background: #86909c; color: #fff; }'
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
    if (st) { try { st.remove(); } catch (e) { /* 尽力而为 */ } }
  }

  /* ---------- 款号识别(三档,与中控台 copy-code.js 同一口径) ---------- */

  /** 像款号吗:3~30 位的字母数字/连字符/下划线 */
  function isCodeLike(s) {
    return !!s && /^[A-Za-z0-9][A-Za-z0-9\-_]{2,29}$/.test(s);
  }

  /* ---------- 取值输入:剔除扩展自己注入的节点(反馈 #96) ---------- */

  /**
   * 扩展注入的节点标记。**凡是这些子树里的文本，一律不算页面数据。**
   *
   * 为什么必须有这一层(2026-10-18 · 反馈 #96 真机事故):
   *   本文件自己的按钮文案就是「货号」二字。它被插在商品名之后 ⇒ 读整行文本时,
   *   按钮文案与**右侧相邻列**(成交件数)被空白折叠拼成「货号 340」⇒
   *   官方货号正则 `货号\s*[:：]?\s*([A-Za-z0-9\-_]{3,30})` 命中,把**成交量当货号**。
   *   ⇒ 判据必须是**结构标记**(认 data-* 属性),不能依赖按钮文案叫什么:
   *     以后按钮改名成「库存」「销量」都不会再污染取值。
   *
   * ⚠️ 用 getAttribute 逐个判，不用 Element.matches —— 老内核(360 极速浏览器X)上
   *    matches 的行为曾因内核版本而异；属性判断没有任何兼容面。
   */
  var EXT_MARKS = ['data-dyc-ld-btn', 'data-dyc-code-btn', 'data-dyc-idbtn'];

  /** 这个元素是不是扩展自己注入的节点 */
  function isExtNode(el) {
    if (!el || !el.getAttribute) return false;
    for (var i = 0; i < EXT_MARKS.length; i++) {
      if (el.getAttribute(EXT_MARKS[i]) !== null) return true;
    }
    return false;
  }

  /**
   * 取元素的「纯页面文本」:遍历文本节点,整棵跳过扩展注入的子树。
   *
   * 为什么不用 innerText / textContent:
   *   两者都会把**我们自己**画的按钮文案算进去 —— 那正是 #96 的成因。
   *   只用 TreeWalker + 手工跳过,才能保证「读到的都是平台数据」。
   *
   * @param {Element|null} root
   * @return {string} 空白折叠后的文本;root 为空时返回 ''
   */
  function textWithoutExt(root) {
    if (!root) return '';
    var parts = [];
    try {
      var walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
        acceptNode: function (n) {
          // 元素:命中扩展标记就整棵拒绝(不进入其子树)
          if (n.nodeType === 1) {
            return isExtNode(n) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_SKIP;
          }
          return NodeFilter.FILTER_ACCEPT;
        }
      });
      var n;
      while ((n = walker.nextNode())) parts.push(n.nodeValue || '');
    } catch (e) {
      // 兜底:实在读不到就给空串,宁可走「名称末尾推算」也不复制错东西
      return '';
    }
    return parts.join(' ').replace(/\s+/g, ' ').trim();
  }

  /**
   * 「商品信息」单元格:namer 元素向上找最近的 <td>。
   *
   * 作用 = 把取值范围从**整行 <tr>**(含右侧所有数字列)收进**商品信息这一格**。
   * 双保险:即便 textWithoutExt 漏了什么,单元格里也只有商品名/缩略图/我们自己的按钮。
   *
   * @param {Element|null} nameEl
   * @return {Element|null} 找不到 <td> 时返回名称的父元素
   */
  function infoCellOf(nameEl) {
    var el = nameEl;
    var guard = 0;
    while (el && guard++ < 12) {
      if (el.tagName === 'TD') return el;
      el = el.parentElement;
    }
    return (nameEl && nameEl.parentElement) || nameEl;
  }

  /**
   * ① 官方货号:在**剔除扩展节点**后的文本里找「货号 xxx」。
   *
   * ⚠️ 绝不可直接读 row.innerText —— 自家按钮文案会被当成平台字段(反馈 #96)。
   *    正确输入 = textWithoutExt(商品信息单元格),退一步才用 textWithoutExt(整行)。
   *    纯数字货号(如 10086)**照读**,isCodeLike 口径不动(用户 2026-10-18 明确要保留)。
   *
   * @param {Element} row 整行(只作兜底范围,正常不会用到)
   * @param {Element} [nameEl] 商品名元素;给了就优先在它所属的单元格里读
   */
  function readOfficialCode(row, nameEl) {
    try {
      var cell = infoCellOf(nameEl || null);
      var t = textWithoutExt(cell);
      // 单元格里没有「货号」二字时，再退整行（两处都已剔除扩展节点）
      if (!/货号/.test(t)) t = textWithoutExt(row) || t;
      if (!t) return '';
      var m = t.match(/货号\s*[:：]?\s*([A-Za-z0-9\-_]{3,30})/);
      if (m && isCodeLike(m[1])) return m[1];
    } catch (e) { /* 尽力而为 */ }
    return '';
  }

  /**
   * ② 名称尾部推算:末尾「≥4 位且含数字」的字母数字串。
   *    必须含数字 —— 纯英文字尾多半不是款号。
   */
  function guessFromName(nameEl) {
    var t = (nameEl && (nameEl.textContent || '') || '').replace(/\s+/g, ' ').trim();
    if (!t) return '';
    var m = t.match(/([A-Za-z0-9][A-Za-z0-9\-_]*)\s*$/);
    if (!m) return '';
    var cand = m[1];
    if (cand.length < 4) return '';
    if (!/\d/.test(cand)) return '';
    return cand;
  }

  /** 取款号 → {code, from:'official'|'guess'|'none'} */
  function readCode(row, nameEl) {
    // 官方货号优先;把 nameEl 一并传下去 —— 它决定「读哪一格」(#96)
    var official = readOfficialCode(row, nameEl);
    if (official) return { code: official, from: 'official' };
    var guessed = guessFromName(nameEl);
    if (guessed) return { code: guessed, from: 'guess' };
    return { code: '', from: 'none' };
  }

  /* ---------- 复制(含降级) ---------- */

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
      var ok = document.execCommand('copy');
      ta.remove();
      return ok;
    } catch (e) {
      return false;
    }
  }

  function copyText(text, done) {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(
          function () { done(true); },
          function () { done(fallbackCopy(text)); }
        );
        return;
      }
    } catch (e) { /* 落到兜底 */ }
    done(fallbackCopy(text));
  }

  /**
   * 弹一条消息提示(第 21 条三段式:来源 ｜ 值 ｜ 结果数)
   *   · 复制是高频操作 ⇒ 只弹 3 秒、**不进消息盒子**(keepHistory:false);
   *   · 来源词复用中控台的「货号复制」(同一功能语义,不另造新词)。
   */
  function say(message, type, opts) {
    try {
      if (typeof toast === 'function') {
        toast(message, type, Object.assign({ keepHistory: false }, opts || {}));
      }
    } catch (e) { /* 消息条不在也不影响复制本身 */ }
  }

  /* ---------- 按钮 ---------- */

  function flash(btn, text, isErr) {
    if (btn.__dycOrigText == null) btn.__dycOrigText = btn.textContent;
    btn.textContent = text;
    btn.classList.toggle('is-err', !!isErr);
    clearTimeout(btn.__dycTimer);
    btn.__dycTimer = setTimeout(function () {
      btn.textContent = btn.__dycOrigText;
      btn.classList.remove('is-err');
    }, 1500);
  }

  function makeButton(row, nameEl) {
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = BTN_CLASS;
    btn.textContent = '货号';
    // 悬停提示 = 这枚按钮的「说明书」:三态文案在 click 里改写。
    btn.title = '点击复制货号 · 优先用平台货号;平台没展示时,取商品名末尾的款号';
    btn.setAttribute('data-dyc-ld-btn', '1');
    btn.addEventListener('click', function (e) {
      // 只在自己的按钮上停冒泡 —— 别让这次点击冒到商品行上触发平台行为
      e.preventDefault();
      e.stopPropagation();
      // 虚拟滚动会重建行内节点 ⇒ 注入时缓存的 nameEl 可能已脱离文档;
      // 点击时按**同一个判据**重算一次,重算不到才退回缓存那份。
      var nowName = row.querySelector('[class*="productName-"]') || nameEl;
      var r = readCode(row, nowName);
      if (!r.code) {
        btn.title = '这一行没找到货号 —— 平台没展示货号,商品名末尾也不是款号'
                  + '(本按钮只认名称末尾的款号)';
        flash(btn, '无货号', true);
        say('这一行没找到货号', 'warning', { source: '货号复制' });
        return;
      }
      btn.title = '货号:' + r.code +
                  (r.from === 'guess' ? '(按商品名末尾推算,不是平台货号)' : '(平台货号)');
      copyText(r.code, function (ok) {
        flash(btn, ok ? '已复制' : '复制失败', !ok);
        // 三段式(2026-10-31 用户定):`货号复制 ｜ NE1C1142W ｜ 已复制` ——
        // 值段只放对象,「已复制」是结果、归右端弱位;三段要齐,别只写两段。
        say(ok ? r.code : '复制失败,请重试',
          ok ? 'success' : 'warning',
          ok ? { source: '货号复制', count: '已复制', standalone: true }
             : { source: '货号复制' });
      });
    });
    return btn;
  }

  /* ---------- 行定位(排除测量行;只认含缩略图的商品行) ---------- */

  function getRows() {
    var out = [];
    var tables;
    try {
      tables = document.querySelectorAll('table');
    } catch (e) {
      return out;
    }
    for (var i = 0; i < tables.length; i++) {
      var trs = tables[i].querySelectorAll('tbody tr');
      if (!trs.length) trs = tables[i].querySelectorAll('tr');
      for (var j = 0; j < trs.length; j++) {
        var tr = trs[j];
        // ⚠️ 测量行(`*-table-measure-row`)高度 0、无内容,必须排除。
        if (/measure/i.test(tr.className || '')) continue;
        // 商品行必有缩略图 —— 用它挡掉页面上别的表格。
        if (!tr.querySelector('img')) continue;
        out.push(tr);
      }
    }
    return out;
  }

  /* ---------- 注入 ---------- */

  function injectIntoRow(row) {
    if (!row || !row.isConnected) return false;
    if (row.querySelector('.' + BTN_CLASS)) return false;      // 幂等

    var nameEl = row.querySelector('[class*="productName-"]');
    if (!nameEl || !nameEl.parentNode) return false;

    var btn = makeButton(row, nameEl);
    try {
      // 插在名称元素**之后**:名称是块级 ⇒ 按钮自然落到下一行,
      // 再由 `margin-left:auto` 右对齐(见 CSS)。
      nameEl.parentNode.insertBefore(btn, nameEl.nextSibling);
    } catch (e) {
      try { nameEl.parentNode.appendChild(btn); } catch (e2) { return false; }
    }
    return true;
  }

  function applyAll() {
    if (!enabled()) return 0;
    var rows = getRows();
    var n = 0;
    for (var i = 0; i < rows.length; i++) {
      try { if (injectIntoRow(rows[i])) n++; } catch (e) { /* 单行失败不影响其余 */ }
    }
    return n;
  }

  function scheduleApply() {
    if (pending) return;
    pending = true;
    setTimeout(function () {
      pending = false;
      if (enabled()) applyAll();
    }, 300);
  }

  function removeAll() {
    var btns = document.querySelectorAll('.' + BTN_CLASS);
    for (var i = 0; i < btns.length; i++) {
      try { btns[i].remove(); } catch (e) { /* 尽力而为 */ }
    }
  }

  function start() {
    if (observer) return;
    ensureStyle();                       // 名称放宽 + 按钮样式
    applyAll();
    observer = new MutationObserver(scheduleApply);
    observer.observe(document.body, { childList: true, subtree: true });
  }

  function stop() {
    if (observer) { observer.disconnect(); observer = null; }
    removeAll();
    removeStyle();                       // 名称恢复平台的 2 行截断
  }

  /* ---------- 开关联动 ---------- */

  dycReadFlags().then(function (f) {
    flags = f;
    if (enabled()) start();
  });

  // 开关切换回声(与中控台各开关一致:拆成 source + 已开启/已关闭)
  var prevOn = null;
  dycWatchFlags(function (f) {
    flags = f;
    var now = enabled();
    if (prevOn !== null && now !== prevOn && typeof toast === 'function') {
      toast(now ? '已开启' : '已关闭', 'info', { source: '货号复制' });
    }
    prevOn = now;
    if (now) start();
    else stop();
  });

  // 罗盘是微前端,表格渲染得晚 —— 首屏补扫三次兜底
  [1500, 4000, 8000].forEach(function (ms) {
    setTimeout(function () { if (enabled()) applyAll(); }, ms);
  });
})();
