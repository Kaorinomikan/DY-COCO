/**
 * 小黄车「货号」· 平台「复制 ID」按钮右侧并排（反馈 #74 · 方案 ⑤）
 * ============================================================
 * 【需求】用户 2026-10-15 凌晨定（五轮落点迭代后的最终形态）：
 *   按钮文案 =「货号」，点一下把货号写进剪贴板，成功后按钮原地显示「已复制」。
 *   位置 = **紧贴平台自带的「复制 ID」按钮右侧、与它并排**。
 *   用户原话：「感觉还是不对齐，放置【复制ID】的右边怎么样」。
 *   —— 跟着平台那枚按钮走：位置天然与它对齐（各行一致），
 *      又落在商品信息那一块里，不必横跨半个信息栏去点。
 *   **不覆盖平台原有的「点商品名看详情」** —— 所以不拦点击、不 preventDefault、
 *   不 stopPropagation 平台的链路（只在自己的按钮上停掉冒泡，避免误触卡片跳转）。
 *
 * 【落点五轮迭代的收敛（每版为什么被换掉）】
 *   ① 名称右侧   → 与商品名抢同一行横向空间，名称被压缩重排 ⇒ 左右抖动；
 *   ② 右侧操作区 → 位置合适，但当时按钮被放在容器末尾、离「ID」按钮远，
 *                  用户觉得不好用；
 *   ③ 同一行右端 → 位置固定、各行对齐，但仍离商品名远 ⇒「不太好用」；
 *   ④ 名称下方左对齐 → 紧邻商品名，但与商品名没对齐（用户反馈「还是不对齐」）；
 *   ⑤ **紧贴平台「复制 ID」按钮右侧**（本版）：跟平台自己的按钮并排 ——
 *      位置由那枚按钮决定，天然与它对齐、各行一致，又不必横跨信息栏去点。
 *
 * 【怎么落到「复制 ID」按钮右边】
 *   靠**内容特征**找平台那枚 ID 复制按钮（文本恰为「ID」的小按钮，
 *   或 title / aria-label 标了「复制」「ID」的小按钮；不依赖 class 哈希，
 *   口径与 name-wrap.js 的 findIdButton 一致），然后把我们的按钮插到
 *   **它的父容器里、紧跟它之后**（文档流插入，不写 left/top —— 绝对定位会被
 *   平台 transform 祖先劫走包含块，search.js 有过三轮修复的教训）。
 *   找不到那枚按钮的行（平台没渲染）退回「名称之后」，保证功能不消失。
 *
 * 【按钮宽度固定（用户明确要求「宽度不变」）】
 *   点击后文字在「货号 / 已复制 / 无货号」之间切换，长度不同。
 *   宽度**固定 56px**，flash 只换文字与配色、不改宽度。
 *
 * 【点击后的消息提示（2026-10-15 用户定）】
 *   复制成功弹「已复制货号 XXX」、取不到弹「这一行没找到货号」。
 *   两者都**不进消息盒子**（keepHistory:false）—— 复制是高频操作，
 *   全收进盒子会把历史刷满；按钮本身闪的「已复制」已是第一反馈。
 *
 * 【取号优先级 —— 三档，逐级兜底】
 *   ① **官方货号**：行内若有平台自己写出的「货号」值，直接用它。最可靠。
 *   ② **名称尾部推算**：从名称末尾截「≥4 位、且含数字」的字母数字串
 *      （NE1C0021W / 10157 / ABC-123 这类）。
 *      ⚠️ 这一档是**推算**，不是官方数据 —— 平台没在小黄车展示货号时只能这么取。
 *      名称末尾若不是款号（比如是「夏季新款」），它取不到东西，不会瞎猜。
 *   ③ 两档都拿不到 → 按钮点下去只提示「无货号」，**绝不复制半截内容**。
 *
 * 【名称元素怎么定位 —— 结构锚定（2026-10-15 修反馈 #88 / #85）】
 *   第 ② 档要「名称元素」。原先靠 findNameEl 全行扫「文本最长」——
 *   无库存 / 已下架的行，平台会多渲染一句提示（如「商品无库存，用户不可购买」），
 *   它比商品名更长 ⇒ 挑中提示语 ⇒ 末尾推不出款号 ⇒ 闪「无货号」。
 *   现在主路径改为 **findNameElByAnchor**：在平台「复制 ID」按钮的父容器内、
 *   ID 按钮**之前**的兄弟里挑 —— 与按钮落点共用同一个锚（那枚 ID 按钮）。
 *   落点对，取号就对；挑错元素这一整类问题一次性消失。
 *   锚拿不到时（平台没渲染 ID 按钮）才回退全行扫描，并由 HINT_TEXT 挡掉提示语。
 *
 * 【按钮说明（悬停提示）—— 2026-10-15 用户定】
 *   用户口径：「不放宽，但是要写入按钮说明，让人知道运作规则」。
 *   ⇒ 取号逻辑维持三档不变，但把规则写进按钮 title，三态各说清自己：
 *     初始态说明「先平台货号、再名称末尾推算」；取到态标明「来源」（官方 / 推算）；
 *     取不到态说明「为什么取不到」并点明「只认名称末尾」。
 *   判据：用户不该等到出错时才靠猜去理解规则。
 *
 * 【为什么是「文档流内插入」而不是浮层】
 *   search.js 留过一条跑位教训：绝对定位的按钮，包含块会被平台的 transform
 *   祖先劫走，反复错位（三轮修复都栽在这上面）。这里把按钮作为**名称元素之后的
 *   兄弟节点**插进文档流，位置交给平台自己的布局决定 —— 不写 left/top。
 *
 * 【虚拟滚动】
 *   小黄车可视区恒约 8 行，滚动时节点反复重建（同 name-wrap.js 的处境）。
 *   用 MutationObserver + 300ms 防抖补注入，只扫 locate.js 给的**商品行并集**
 *   （getAllProductRows()：等距行 ∪ 结构锚补捞，自带 250ms 缓存）——
 *   2026-10-15 由 getProductItems() 换成并集：后者会把「高度离群」的行整行
 *   剔掉，导致这些行连按钮都拿不到。不做全页扫描。
 *
 * 【开关】
 *   flags.js 的 liveCopyCode（中控台组，默认开）。关掉即时生效：
 *   摘观察器 + 移除已注入的按钮，页面回原样。
 * ============================================================
 */

(function dycCopyCode() {
  'use strict';

  // 防重复注入（SPA 路由回切、脚本意外重跑时不叠按钮）
  if (window.__dycCopyCodeLoaded) return;
  window.__dycCopyCodeLoaded = true;

  var BTN_CLASS = 'dyc-code-btn';
  var STYLE_ID = 'dyc-code-btn-style';
  var NAME_MAX_SCAN = 400;      // 单行最多扫这么多节点，防异常结构拖慢

  /* ---------- 依赖自检（flags.js / locate.js 必须先加载） ---------- */
  if (typeof dycReadFlags !== 'function' ||
      typeof dycWatchFlags !== 'function' ||
      typeof getProductItems !== 'function') {
    return;
  }

  var flags = null;
  var observer = null;
  var pending = false;

  function enabled() {
    return !!flags && flags.liveCopyCode !== false;
  }

  /* ---------- 样式（JS 注入，固定 px + 与平台隔离，不随页面缩放变大小） ---------- */

  var CSS = [
    '.' + BTN_CLASS + ' {',
    '  all: initial;',
    // 行内块：插在平台「复制 ID」按钮之后 ⇒ 与它并排在同一行、贴它右边。
    '  display: inline-flex; align-items: center; justify-content: center;',
    // 宽度固定 56px：用户明确要求「宽度不变」—— flash 换文案时按钮不变宽，
    // 相邻元素就不会被推挤。
    '  width: 56px; height: 20px; padding: 0;',
    // 锁宽（反馈 #88，2026-10-15）：按钮插进平台的 flex 容器后，`all: initial`
    // 会把 flex-shrink 重置成 1 —— 空间不足时按钮被压扁（#88 那页实测宽 48px，
    // 设计值是 56px）。非 flex 容器里这条无副作用。
    '  flex: 0 0 auto;',
    // 与平台「复制 ID」按钮之间留 6px 间隔。
    '  margin-left: 6px;',
    '  border: 1px solid #0075ff; border-radius: 4px;',
    '  background: #fff; color: #0075ff;',
    "  font: 12px/1 -apple-system, 'Microsoft YaHei', sans-serif;",
    '  white-space: nowrap; vertical-align: middle; cursor: pointer;',
    '  box-sizing: border-box;',
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

  /* ---------- 款号识别 ---------- */

  /** 像款号吗：3~30 位的字母数字/连字符/下划线 */
  function isCodeLike(s) {
    return !!s && /^[A-Za-z0-9][A-Za-z0-9\-_]{2,29}$/.test(s);
  }

  /* ---------- 取值输入：剔除扩展自己注入的节点（反馈 #96，2026-10-18） ---------- */

  /**
   * 扩展注入的节点标记。**凡是这些子树里的文本，一律不算页面数据。**
   *
   * 【为什么必须有这一层】
   *   2026-10-18 反馈 #96 真机事故：罗盘直播明细里点「货号」复制到的是
   *   **右边「成交件数」那一格的数字**（340），且**只在 100~999 时**出错。
   *   成因与本文件同源：我们自己注入的按钮文案就是「货号」，它作为 DOM 邻居
   *   把右侧一列的数字卷进了「货号 XXX」这个正则里 —— 而量词正好是 {3,30}，
   *   三位的成交量恰好满足。四位数带千分位逗号（1,234）反而躲过。
   *
   *   ⇒ 判据必须是**结构标记**（认 data-* 属性），不能依赖按钮文案叫什么：
   *     以后按钮改名成「库存」「销量」都不会再污染取值。
   *
   * ⚠️ 用 getAttribute 逐个判，不用 Element.matches —— 老内核（360 极速浏览器X）上
   *    matches 的行为曾因内核版本而异；属性判断没有任何兼容面。
   */
  var EXT_MARKS = ['data-dyc-code-btn', 'data-dyc-ld-btn', 'data-dyc-idbtn'];

  /** 这个元素是不是扩展自己注入的节点 */
  function isExtNode(el) {
    if (!el || !el.getAttribute) return false;
    for (var i = 0; i < EXT_MARKS.length; i++) {
      if (el.getAttribute(EXT_MARKS[i]) !== null) return true;
    }
    return false;
  }

  /**
   * 取元素的「纯页面文本」：遍历文本节点，整棵跳过扩展注入的子树。
   *
   * 为什么不用 innerText / textContent：两者都会把**我们自己**画的按钮文案算进去，
   * 那正是 #96 的成因。只用 TreeWalker + 手工跳过，才能保证读到的都是平台数据。
   *
   * @param {Element|null} root
   * @return {string} 空白折叠后的文本；root 为空时返回 ''
   */
  function textWithoutExt(root) {
    if (!root) return '';
    var parts = [];
    try {
      var walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
        acceptNode: function (n) {
          if (n.nodeType === 1) {
            return isExtNode(n) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_SKIP;
          }
          return NodeFilter.FILTER_ACCEPT;
        }
      });
      var n;
      while ((n = walker.nextNode())) parts.push(n.nodeValue || '');
    } catch (e) {
      return '';   // 读不到宁可走名称末尾推算，也不复制错东西
    }
    return parts.join(' ').replace(/\s+/g, ' ').trim();
  }

  /**
   * ① 官方货号：优先用 anchor.js 的标签取值（商品列表页验证过的那套），
   *    取不到再退回「纯页面文本里找『货号 xxx』」。
   *
   * 【2026-10-18 反馈 #96 加固 —— 两条路都改成「只读页面数据」】
   *   · 取值范围收窄：先取平台「复制 ID」按钮的父容器（我们按钮就插在它后面，
   *     天然是这个范围的边界），退一步用名称所在容器，最后才整行；
   *   · 输入一律经 textWithoutExt()，自家按钮字幕进不来；
   *   · 标签取值额外加一道校验：取回的值必须**出现在纯页面文本里**，
   *     否则说明它是从自家节点旁边刮到的，直接丢弃。
   *   · `isCodeLike` 口径**不动** —— 纯数字货号（如 10086）照读（用户明确要保留）。
   */
  function readOfficialCode(row, nameEl) {
    var idBtn = findPlatformIdButton(row);
    var scope = (idBtn && idBtn.parentElement)
             || (nameEl && nameEl.parentElement)
             || row;
    // 两级范围都算一份「纯页面文本」：收窄的优先，整行兜底
    var nearText = textWithoutExt(scope);
    var rowText = (scope === row) ? nearText : textWithoutExt(row);
    var pageText = nearText || rowText;
    if (!pageText) return '';

    // 标签取值：仅当页面自己确实写了「货号」二字才走（否则唯一的「货号」来自我们）
    // 先试收窄范围，再退整行 —— 保证「平台货号在容器外」的老场景不会因此读不到
    if (/货号/.test(nearText + ' ' + rowText) && typeof extractValueAfterLabel === 'function') {
      var tryScopes = (scope === row) ? [row] : [scope, row];
      for (var i = 0; i < tryScopes.length; i++) {
        try {
          var v = extractValueAfterLabel(tryScopes[i], '货号');
          if (!v) continue;
          v = String(v).replace(/^货号\s*[:：]?\s*/, '').trim();
          // 必须能在这两份「纯页面文本」之一里找到 —— 挡掉从自家按钮旁边刮来的值
          if (isCodeLike(v) && (nearText.indexOf(v) > -1 || rowText.indexOf(v) > -1)) return v;
        } catch (e) { /* 尽力而为 */ }
      }
    }

    // 纯页面文本里的「货号 xxx」正则（先收窄范围，再整行）
    try {
      var m = nearText.match(/货号\s*[:：]?\s*([A-Za-z0-9\-_]{3,30})/)
           || rowText.match(/货号\s*[:：]?\s*([A-Za-z0-9\-_]{3,30})/);
      if (m && isCodeLike(m[1])) return m[1];
    } catch (e2) { /* 尽力而为 */ }
    return '';
  }

  /**
   * ② 名称尾部推算：末尾「≥4 位且含数字」的字母数字串。
   *    必须含数字 —— 纯英文字尾（如 "新款" 的拼音、英文词）多半不是款号。
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
    // nameEl 一并传下去 —— 它决定「读哪一段」（#96 的收窄依据）
    var official = readOfficialCode(row, nameEl);
    if (official) return { code: official, from: 'official' };
    var guessed = guessFromName(nameEl);
    if (guessed) return { code: guessed, from: 'guess' };
    return { code: '', from: 'none' };
  }

  /* ---------- 名称元素识别（不依赖平台 class，只按内容特征） ---------- */

  var NOT_NAME = /^(到手价|售出|已售|库存|货号|规格|设置卖点|未设提词|销量|ID)|[¥￥]/;
  var ONLY_NUM = /^[\d\s.,::%\-+()（）#¥￥]+$/;
  /**
   * 平台提示语（不是商品名）—— 反馈 #88 / #85（2026-10-15）：
   *   无库存 / 已下架 / 讲解中 的行，平台会多渲染一句提示（如「商品无库存，
   *   用户不可购买」）。它比商品名更长，会被「文本最长」判据挑成商品名
   *   ⇒ 名称末尾推不出款号 ⇒ 按钮闪「无货号」。
   *   主路径已改为**结构锚定**（findNameElByAnchor），这一条是兜底 ——
   *   锚定拿不到时仍走全行扫描，此时靠它把提示语挡掉。
   */
  var HINT_TEXT = /无库存|不可购买|已下架|已售罄|暂不支持|无法购买|讲解中/;

  /** 元素是否带「直接文本」节点（纯容器不算，避免命中整行） */
  function hasDirectText(el) {
    var nodes = el.childNodes;
    for (var i = 0; i < nodes.length; i++) {
      if (nodes[i].nodeType === 3 && (nodes[i].textContent || '').trim()) return true;
    }
    return false;
  }

  function looksLikeName(text) {
    text = (text || '').trim();
    if (text.length < 4) return false;
    if (NOT_NAME.test(text)) return false;
    if (HINT_TEXT.test(text)) return false;
    if (ONLY_NUM.test(text)) return false;
    return true;
  }

  /** 行内最像「商品名」的元素：有直接文本、不像价格/标签、且文本最长 */
  function findNameEl(row) {
    var cands;
    try {
      cands = row.querySelectorAll('span, div, p, a, em, b, i, strong, h1, h2, h3');
    } catch (e) {
      return null;
    }
    var best = null;
    var bestLen = 0;
    var limit = Math.min(cands.length, NAME_MAX_SCAN);
    for (var i = 0; i < limit; i++) {
      var el = cands[i];
      if (!hasDirectText(el)) continue;
      var t = (el.textContent || '').trim();
      if (!looksLikeName(t)) continue;
      if (t.length > bestLen) { best = el; bestLen = t.length; }
    }
    return best;
  }

  /**
   * **结构锚定**取名称：在平台「复制 ID」按钮的父容器内、ID 按钮**之前**的
   * 兄弟元素里，找「像商品名」的最长者。
   *
   * 【为什么这样最稳（反馈 #88 / #85，2026-10-15 用户定「结构锚定 + 提示语兜底」）】
   *   按钮的落点本来就锚在这枚 ID 按钮上（插在它之后），取号却一直另走一条路
   *   ——「全行扫文本最长」。两条路各走各的，结果落点是对的、取号是错的：
   *   无库存 / 已下架行多出一句提示，它更长 ⇒ 挑中提示语 ⇒ 末尾推不出款号。
   *   改成同一个锚之后，**落点与取号共用一套判据**，「挑错元素」这一整类问题消失。
   *   百应行结构（2026-10-15 探针实测）：rightContainer(flex) = 名称 + ID 按钮，
   *   名称恰在 ID 按钮之前 —— 正是这里要取的那个兄弟。
   *
   * @param {Element|null} idBtn 平台「复制 ID」按钮（findPlatformIdButton 的结果）
   * @return {Element|null} 取不到时返回 null，由调用方回退全行扫描（findNameEl）
   */
  function findNameElByAnchor(idBtn) {
    var host = idBtn && idBtn.parentElement;
    if (!host) return null;
    var best = null;
    var bestLen = 0;
    var kids = host.children;
    for (var i = 0; i < kids.length; i++) {
      var el = kids[i];
      if (el === idBtn) break;                 // 只看 ID 按钮**之前**的兄弟
      if (el.getAttribute('data-dyc-code-btn') === '1') continue;
      if (!hasDirectText(el)) continue;
      var t = (el.textContent || '').trim();
      if (!looksLikeName(t)) continue;
      if (t.length > bestLen) { best = el; bestLen = t.length; }
    }
    return best;
  }

  /* ---------- 复制 ---------- */

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
   * 弹一条消息提示(2026-10-15 用户定)
   *   · 复制是高频操作 ⇒ 提示只弹 3 秒、**不进消息盒子**(keepHistory:false),
   *     否则盒子里会堆满「已复制货号 XXX」;
   *   · 按钮本身也会闪「已复制」,消息条是给「视线不在按钮上」时的补充反馈。
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
    // 悬停提示 = 这枚按钮的「说明书」（2026-10-15 用户定：不放宽取号逻辑，
    // 但要把运作规则写出来，让人知道它怎么取号、为什么有时取不到）。
    // 三态文案见下面 click 处理器：初始 / 取到 / 取不到。
    btn.title = '点击复制货号 · 优先用平台货号；平台没展示时，取商品名末尾的款号';
    btn.setAttribute('data-dyc-code-btn', '1');
    btn.addEventListener('click', function (e) {
      // 只在自己的按钮上停冒泡 —— 别让这次点击冒到商品卡片上触发跳转
      e.preventDefault();
      e.stopPropagation();
      // 虚拟滚动会重建行内节点 ⇒ 注入时缓存的 nameEl 可能已脱离文档。
      // 点击时按**同一个锚**重算一次（锚不变、结论一致）；重算不到才退回缓存那份。
      var nowName = findNameElByAnchor(findPlatformIdButton(row)) ||
                    findNameEl(row) || nameEl;
      var r = readCode(row, nowName);
      if (!r.code) {
        // 取不到时把「规则」和「为什么」一并写清楚 —— 用户最可能在这一刻
        // 想弄明白「明明名称里有款号，为什么取不到」（款号在中间 / 后面还有字）。
        btn.title = '这一行没找到货号 —— 平台没展示货号，商品名末尾也不是款号'
                  + '（本按钮只认名称末尾的款号）';
        flash(btn, '无货号', true);
        // 消息提示(2026-10-15):取不到也给一声 —— 只靠按钮变色容易被漏看
        say('这一行没找到货号', 'warning', { source: '货号复制' });
        return;
      }
      // 取到时也标明来源 —— 「推算」与「平台货号」的可信度不同，用户有权知道。
      btn.title = '货号：' + r.code +
                  (r.from === 'guess' ? '（按商品名末尾推算，不是平台货号）' : '（平台货号）');
      copyText(r.code, function (ok) {
        flash(btn, ok ? '已复制' : '复制失败', !ok);
        // 三段式(2026-10-31 用户定):值段只写对象(货号),结果词进右端弱位 ——
        // `货号复制 ｜ NE1C1142W ｜ 已复制`。旧写法「已复制货号 X」把结果和对象
        // 挤在同一段里,三段只剩两段,盒子里看着像缺了尾声。
        // standalone:带 count 会被判成「富状态」,不加会与上一条原地合并。
        say(ok ? r.code : '复制失败，请重试',
          ok ? 'success' : 'warning',
          ok ? { source: '货号复制', count: '已复制', standalone: true }
             : { source: '货号复制' });
      });
    });
    return btn;
  }

  /* ---------- 平台「复制 ID」按钮定位（方案 ⑤ 的落点锚） ---------- */

  /**
   * 找行内平台自带的「ID」复制按钮。
   * 识别口径与 name-wrap.js 的 findIdButton 完全一致（同一套内容特征，
   * 不依赖平台 class 哈希），差别有二：
   *   · 不看 name-wrap 的 BTN_MARK（那是它的幂等标记，与本模块无关）；
   *   · 额外排除我们自己的按钮（防自己认自己）。
   */
  function findPlatformIdButton(row) {
    var walker = document.createTreeWalker(row, NodeFilter.SHOW_ELEMENT, null);
    var el;
    while ((el = walker.nextNode())) {
      if (el.getAttribute('data-dyc-code-btn') === '1') continue;
      var tag = el.tagName;
      if (tag !== 'BUTTON' && tag !== 'A' && tag !== 'SPAN' && tag !== 'DIV') continue;
      var t = String(el.textContent || '').trim();
      var label = (el.getAttribute('title') || '') + ' ' +
                  (el.getAttribute('aria-label') || '');
      var byText = t === 'ID' || t === 'id';
      var byLabel = /复制|(^|\s)ID(\s|$)/i.test(label) && t.length <= 4;
      if (!byText && !byLabel) continue;
      if (el.clientWidth < 8 || el.clientWidth > 60) continue;    // 小按钮
      if (el.clientHeight < 8 || el.clientHeight > 40) continue;
      return el;
    }
    return null;
  }

  /* ---------- 注入 ---------- */

  function injectIntoRow(row) {
    if (!row || !row.isConnected) return false;
    if (row.querySelector('.' + BTN_CLASS)) return false;    // 幂等

    // 平台「复制 ID」按钮**同时**是两件事的锚：
    //   · 按钮落点 —— 插在它之后并排；
    //   · 取号 —— 名称元素取它之前的兄弟（findNameElByAnchor）。
    // 先把它找出来，两处共用（反馈 #88 / #85 的修法）。
    var idBtn = findPlatformIdButton(row);
    var nameEl = findNameElByAnchor(idBtn) || findNameEl(row);
    if (!nameEl) return false;

    ensureStyle();
    var btn = makeButton(row, nameEl);

    // 首选：插进平台「复制 ID」按钮的父容器、紧跟它之后 —— 与它并排在同一行
    // 的右侧（用户 2026-10-15 定）。位置由平台那枚按钮决定，天然对齐、各行一致。
    if (idBtn && idBtn.parentElement) {
      try {
        idBtn.parentElement.insertBefore(btn, idBtn.nextSibling);
        return true;
      } catch (e) { /* 插不进去就落兜底 */ }
    }

    // 兜底：该行没有平台「ID」按钮时，退回「名称之后」（保证按钮不消失）。
    var host = nameEl.parentElement;
    if (!host) return false;
    try {
      host.insertBefore(btn, nameEl.nextSibling);
    } catch (e2) {
      try { host.appendChild(btn); } catch (e3) { return false; }
    }
    return true;
  }

  function applyAll() {
    if (!enabled()) return 0;
    if (dragHold()) return 0;    // 拖拽期不往 Draggable 内部插按钮（见 dragHold 注释）
    var items = getRows();
    var n = 0;
    for (var i = 0; i < items.length; i++) {
      try { if (injectIntoRow(items[i])) n++; } catch (e) { /* 单行失败不影响其余 */ }
    }
    return n;
  }

  /**
   * 取本轮要注入的商品行。
   *
   * 【2026-10-15 换成并集】原来直接用 getProductItems()。它为了「选对容器」
   * 带一道等高校验，会把高度偏离均值的行整行剔掉；而名称换行会改变行高 ⇒
   * 少数「还没折行」的行成了离群值被剔出去，于是**这些行既不会被折行、
   * 也不会拿到货号按钮**（真机实测 112 行里 5 行如此）。
   *
   * 改用 locate.js 的 getAllProductRows()（等距行 ∪ 结构锚补捞）；
   * 旧版 locate.js 里没有这个函数时自动退回原路径。
   */
  function getRows() {
    if (typeof getAllProductRows === 'function') {
      try { return getAllProductRows(); } catch (e) { /* 退回主路径 */ }
    }
    return getProductItems();
  }

  /**
   * 拖拽期让路（2026-11-05 · 反馈 #130）
   *
   * 用户按住购物车行首把手调整讲解顺序时，react-beautiful-dnd 会持续插入
   * 拖动克隆与占位节点。我们的补扫如果照常跑，会在这期间 insertBefore 注入
   * 「货号」按钮 —— 等于当场改写 Draggable 的内部结构，rbd 判结构与尺寸
   * 不一致即中止本次拖拽（「一拖就弹回」），同时全量重扫本身也在抢主线程。
   *
   * 所以拖拽期间整体让路，松手 400ms 后由闸门回调补一轮。闸门不存在时
   * （旧构建 / 未注入）退回原行为。
   */
  function dragHold() {
    if (typeof window.__dycDragBusy !== 'function' || !window.__dycDragBusy()) return false;
    if (typeof window.__dycWhenDragIdle === 'function') {
      window.__dycWhenDragIdle(scheduleApply);   // 去重由闸门负责
    }
    return true;
  }

  function scheduleApply() {
    if (dragHold()) return;
    if (pending) return;
    pending = true;
    setTimeout(function () {
      pending = false;
      if (enabled() && !dragHold()) applyAll();
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
    applyAll();
    observer = new MutationObserver(scheduleApply);
    observer.observe(document.body, { childList: true, subtree: true });
  }

  function stop() {
    if (observer) { observer.disconnect(); observer = null; }
    removeAll();
  }

  /* ---------- 开关联动 ---------- */

  dycReadFlags().then(function (f) {
    flags = f;
    if (enabled()) start();
  });
  // 开关切换回声(2026-10-15 补):原先切这个开关没有任何提示,与其他开关不一致。
  var prevCopyCodeOn = null;
  dycWatchFlags(function (f) {
    flags = f;
    var now = enabled();
    if (prevCopyCodeOn !== null && now !== prevCopyCodeOn && typeof toast === 'function') {
      toast(now ? '已开启' : '已关闭', 'info', { source: '货号复制' });
    }
    prevCopyCodeOn = now;
    if (now) start();
    else stop();
  });

  // 中控台是微前端，商品列表渲染得晚 —— 首屏补扫三次兜底
  [1500, 4000, 8000].forEach(function (ms) {
    setTimeout(function () { if (enabled()) applyAll(); }, ms);
  });
})();
