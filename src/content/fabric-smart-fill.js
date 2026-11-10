/**
 * 商品发布 / 编辑页 · 面料材质「智能填写」(2026-11-08，用户新增需求)
 * ============================================================
 * 【用户原话】
 *   「对着面料材质输入框,右边放置一个自建的输入框,输入框右边写着【智能填写】。
 *     我把面料也就是一串文字 比如 棉80 丝绸20,带字符或者不带字符都可以,
 *     然后我点击智能填写的按钮之后,可以把我的面料快速生成到左边的原生框框当中。」
 *   + 2026-11-08 定稿口径:
 *     · 配比合计不满 100 会提示且**不运行**;
 *     · 合计满 100 时,智能填写**可以覆盖**原生框里原有内容;
 *     · 材料名对不上平台字典 → **按我写的名字新建**,不许匹配类似的;
 *     · 一次一张。
 *
 * 【写入策略】优先从平台 React 组件取得整组 value/onChange,按平台原有
 *   数据结构一次提交全部材料与配比;字段、材料标识或提交结果无法确认时,
 *   自动回退到「点开下拉 → 逐项点选 → 填占比」。只改输入框的显示值不算成功。
 *
 * 【兜底落点,每级都有明确失败话术】—— 宁可报错也不写错成分:
 *   ① 逐项:在搜索框输入材料名 → 精确命中就点它
 *   ② 精确没命中:按用户写的名字原样写入(直填=自定义值提交;兜底=回车一试)
 *   ③ 找不到控件/搜索框/占比框:如实报是哪一步,不写半截
 *
 * 【覆盖面】只在本页(flags 的 goodsEdit)生效,开关 fabricSmartFill 默认开。
 * ============================================================
 */
(function fabricSmartFill() {
  'use strict';

  if (window.__dycFabricSmartFillLoaded) return;
  window.__dycFabricSmartFillLoaded = true;
  if (typeof dycReadFlags !== 'function' || typeof dycWatchFlags !== 'function') return;

  var SOURCE = '智能填写';
  var BOX_CLASS = 'dyc-fabric-box';
  var INPUT_CLASS = 'dyc-fabric-input';
  var BTN_CLASS = 'dyc-fabric-btn';
  var HINT_CLASS = 'dyc-fabric-hint';
  var FIELD_CLASS = 'dyc-fabric-field';
  var CLEAR_CLASS = 'dyc-fabric-clear';
  var BOX_ATTR = 'data-dyc-fabric-box';
  var LABEL_TEXT = '面料材质';
  /* 说明面板(2026-11-10 用户需求):点输入框展开,告诉用户「能填什么」。
     ⛔ 只给看不给点 —— 用户明确说过「不需要点一下就预填内容」,
     所以这里是纯 div/span,没有任何点击行为,点了不会往输入框里塞字。
     示例必须真能解析通过,改这里要同步自测-面料说明面板。 */
  var GUIDE_CLASS = 'dyc-fabric-guide';
  var GUIDE_ROWS = [
    ['棉80 聚酯纤维20', '最简写法'],
    ['面料：棉80%、聚酯纤维20%', '吊牌整段抄'],
    ['68%精棉 30%聚酯纤维 2%氨纶', '三项细分'],
    ['羊毛100', '只有一种']
  ];
  var GUIDE_RULES = [
    ['顺序随意', '先写数字后写名字一样认（80棉 = 棉80）'],
    ['符号随意', '%、空格、逗号、顿号、斜杠、冒号都不影响'],
    ['合计要 100', '不满或多出会当场提示，不会往原生框里乱写']
  ];

  var on = false;
  var busy = false;
  var observer = null;
  var scanTimer = 0;
  /* 挂载时认定的控件。点按钮时优先用它 —— 再跑一次发现逻辑有可能认到别的
     同构控件(一个页面不止一处 select),那就填到别的地方去了。 */
  var lastControl = null;
  /* 疑似笔误提示行(挂在自建框里的第二行) */
  var hintNode = null;
  /* 说明面板的「点外面收起」监听是否已绑(开关来回切时避免重复绑) */
  var guideDocBound = false;

  function log(msg) {
    try { if (typeof debugLog === 'function') debugLog(msg); } catch (e) { /* 日志不影响主流程 */ }
  }

  function say(value, kind, count, full) {
    try {
      if (typeof setStatus !== 'function') return;
      setStatus(value, kind, {
        source: SOURCE,
        count: count,
        full: full,
        keepHistory: kind !== 'success'
      });
    } catch (e) { /* 消息失败不拖垮主流程 */ }
  }

  /**
   * 失败时把控件结构压成一行写进调试日志(只取标签与类名,不取任何业务文本)。
   * 有了这一行,下次校准不必再让用户导一遍页面结构:
   * 调试面板里直接能看到平台真实的类名层级。上限 28 个节点,避免刷屏。
   */
  function signature(root) {
    if (!root) return '(无)';
    var parts = [];
    var nodes = root.querySelectorAll('*');
    for (var i = 0; i < nodes.length && parts.length < 28; i++) {
      var el = nodes[i];
      var cls = (typeof el.className === 'string' ? el.className : '').trim();
      parts.push(el.tagName.toLowerCase() + (cls ? '.' + cls.split(/\s+/).slice(0, 3).join('.') : ''));
    }
    return (root.tagName ? root.tagName.toLowerCase() : '?') + ' > ' + parts.join(' | ');
  }

  function inScope() {
    var p = window.DYC_PAGE_PATTERNS;
    return !!(p && p.goodsEdit && p.goodsEdit.test(location.href));
  }

  function visible(el) {
    if (!el || el.nodeType !== 1) return false;
    if (typeof isVisible === 'function') return isVisible(el);
    var r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }

  function sleep(ms) {
    return new Promise(function (r) { setTimeout(r, ms); });
  }

  /* ==========================================================
   * 一、解析:把吊牌上那一串成分拆成 [{name:'棉', pct:80}, …]
   *
   * 口径(用户 2026-11-08 最新):
   *   · 只提取「数字+材料名」或「材料名+数字」,两种次序等价;
   *   · 百分号、冒号、逗号、空格及其他符号一律忽略,不再逐个维护符号表;
   *   · 全角数字先转半角;仅保留两个数字之间的小数点,其余句点同样忽略;
   *   · 开头「面料/材质/成分」等栏目标签不是材料名,先剥掉再提取。
   * ========================================================== */

  function toHalfWidth(s) {
    var out = '';
    for (var i = 0; i < s.length; i++) {
      var c = s.charCodeAt(i);
      if (c >= 0xFF10 && c <= 0xFF19) out += String.fromCharCode(c - 0xFEE0);   // ０-９
      else if (c === 0xFF0E) out += '.';                                        // ．
      else out += s.charAt(i);
    }
    return out;
  }

  function parseMaterials(raw) {
    var s = toHalfWidth(String(raw || '')).trim();
    if (!s) return { ok: false, reason: '还没输入面料' };

    // 材料名内的括号是名称的一部分；先保护，避免把「纤维（氨纶）」截短。
    s = s.replace(/([\u4e00-\u9fa5A-Za-z·])([（(])([\u4e00-\u9fa5A-Za-z·]+)([）)])/g,
      function (all, prefix, left, inner, right) {
        if (/除外|备注|不含|仅供|另计/.test(inner)) return all;
        return prefix + (left === '（' ? '\uE001' : '\uE003') + inner + (right === '）' ? '\uE002' : '\uE004');
      });
    /* 括号备注不是材料,整段剥掉(如吊牌尾注「（罗纹除外）」)。 */
    s = s.replace(/（[^（）]*）/g, ' ').replace(/\([^()]*\)/g, ' ');

    /* 栏目标签不是材料。其余符号一律忽略,不再区分它是不是分隔符。 */
    s = s.replace(/^\s*(面料成分|材质成分|面料材质|面料配比|面料|材质|成分|含量)\s*/, '');

    /* 小数点只在「数字.数字」里有意义。先用私有区字符保护它,
       再把空白、百分号、括号、连字符、emoji 等所有非名称/数字字符清掉。
       这样「棉~80###丝绸@@20」与「80%棉,20%丝绸」得到完全相同的配对。 */
    var DECIMAL = '\uE000';
    s = s.replace(/(\d)\.(\d)/g, '$1' + DECIMAL + '$2');
    s = s.replace(/[^\u4e00-\u9fa5A-Za-z0-9·\uE000-\uE004]/g, '');

    /* 数字在前必须优先,否则「68精棉」会被错切成名称「精棉」再找下一组数字。 */
    var RE_PAIR =
      /(\d+(?:\uE000\d+)?)([\u4e00-\u9fa5A-Za-z·\uE001-\uE004]+)|([\u4e00-\u9fa5A-Za-z·\uE001-\uE004]+)(\d+(?:\uE000\d+)?)/g;

    var items = [];
    var rest = s;
    var m;

    while ((m = RE_PAIR.exec(s))) {
      var numberText = (m[1] !== undefined ? m[1] : m[4]).split(DECIMAL).join('.');
      var name = m[1] !== undefined ? m[2] : m[3];
      name = name.replace(/\uE001/g, '（').replace(/\uE002/g, '）').replace(/\uE003/g, '(').replace(/\uE004/g, ')');
      var pct = parseFloat(numberText);
      if (!name || !isFinite(pct) || pct <= 0) continue;
      items.push({ name: name, pct: pct });
      rest = rest.replace(m[0], ' ');
    }

    /* 没被任何一对吃掉的残渣 = 看不懂的输入(纯数字/纯百分号不算) */
    var leftover = rest.replace(/[\s%]/g, '').replace(/\d+(?:\.\d+)?/g, '').trim();
    if (leftover) return { ok: false, reason: '这些没看懂:' + leftover };
    if (!items.length) return { ok: false, reason: '没解析出材料' };

    /* 同名合并(用户可能写「棉80 棉20」) */
    var merged = [];
    items.forEach(function (it) {
      for (var i = 0; i < merged.length; i++) {
        if (merged[i].name === it.name) { merged[i].pct += it.pct; return; }
      }
      merged.push({ name: it.name, pct: it.pct });
    });

    var sum = merged.reduce(function (a, b) { return a + b.pct; }, 0);
    sum = Math.round(sum * 100) / 100;

    /* 用户定稿:合计不满 100 会提示且不运行。多于 100 同样不写 —— 平台会校验,
       与其让平台报一句红字,不如我们当场说清楚。 */
    if (Math.abs(sum - 100) > 0.01) {
      return { ok: false, reason: '配比合计 ' + sum + '%,不是 100%', sum: sum, items: merged };
    }

    return { ok: true, items: merged, sum: sum };
  }

  /* ==========================================================
   * 二、找控件
   * ========================================================== */

  function findLabelNode() {
    if (typeof findAllByText !== 'function') return null;
    var nodes = [];
    try { nodes = findAllByText(LABEL_TEXT, { exact: false }) || []; } catch (e) { nodes = []; }
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i].nodeType === 1 ? nodes[i] : nodes[i].parentElement;
      if (el && visible(el)) return el;
    }
    return null;
  }

  /**
   * 控件必须住在「表单」里(2026-11-08 用户反馈:弹窗里的「新建材质」输入框
   * 是平台自己的新建入口,不能往那儿挂智能填写)。
   * 三道判据,由强到弱:
   *   ① 本页有表单容器 #goodsEditScrollContainer ⇒ 控件必须在其内
   *      (弹窗/下拉的 portal 都是 body 直挂,一条就排掉);
   *   ② 不在任何浮层类容器里(下拉 option-list / 虚拟列表 / modal / drawer…)
   *      —— 表单容器不存在时(其他布局)兜底用;
   *   ③ 没有 position:fixed 的祖先(表单控件永远不嵌在浮层里)。
   */
  var FLOAT_SEL = '.rc-virtual-list, [class*="option-list"], [class*="optionList"],'
    + ' [class*="dropdown"], [class*="Dropdown"], [class*="modal"], [class*="Modal"],'
    + ' [class*="dialog"], [class*="Dialog"], [class*="popup"], [class*="Popup"],'
    + ' [class*="drawer"], [class*="Drawer"]';

  function inFormArea(el) {
    if (!el || el.nodeType !== 1) return false;
    var form = null;
    try { form = document.getElementById('goodsEditScrollContainer'); } catch (e) { form = null; }
    if (form && !form.contains(el)) return false;
    try {
      if (el.closest && el.closest(FLOAT_SEL)) return false;
    } catch (e) { /* 老内核 closest 不可用就靠其余判据 */ }
    var node = el.parentElement;
    var guard = 0;
    while (node && node !== document.body && guard < 20) {
      guard++;
      var pos = '';
      try { pos = window.getComputedStyle(node).position || ''; } catch (e) { pos = ''; }
      if (pos === 'fixed') return false;
      node = node.parentElement;
    }
    return true;
  }

  /** 控件本体:优先结构报告里那套类名,再退回「从标签往下找 select」 */
  function findControl() {
    var cands = [];
    try { cands = document.querySelectorAll('[class*="composition-select"]'); } catch (e) { cands = []; }

    var best = null;
    for (var i = 0; i < cands.length; i++) {
      var el = cands[i];
      var cls = String(el.className || '');
      if (/option/i.test(cls)) continue;          // 下拉浮层不是控件本体
      if (el.getAttribute(BOX_ATTR)) continue;
      if (!inFormArea(el)) continue;              // 弹窗里的「新建材质」输入框不挂
      if (!visible(el)) continue;
      var r = el.getBoundingClientRect();
      if (r.height > 120) continue;               // 浮层容器会被算成「高」
      if (!best || r.top < best.getBoundingClientRect().top) best = el;
    }
    if (best) return best;

    /* 二路:不依赖标签与类名,凭「棉 97%」这种芯片文本反找(2026-11-08 加) */
    var byChip = findControlByChipText();
    if (byChip) return byChip;

    /* 三路:标签回溯 —— 只对「还没有任何已选材料」的空控件有效,
       那时页面里没有芯片文本可反找。 */
    var label = findLabelNode();
    if (label) {
      var node = label;
      var guard = 0;
      while (node && guard < 6) {
        guard++;
        var box = node.querySelector('[role="combobox"], .aurora-select, [class*="select"]');
        if (box && visible(box) && inFormArea(box) && box.getBoundingClientRect().height <= 120) return box;
        node = node.parentElement;
      }
    }
    return null;
  }

  /**
   * 不依赖标签、也不依赖类名:凭「芯片文本」反找控件。
   *
   * 已选中的材料一定渲染成「棉 97%」这种形态(用户截图与结构报告都证实),
   * 而输入框就在同一个控件里。所以:在表单容器里找最小的一段「材料名+百分数」
   * 文本,再向上找最近的、含输入框的祖先 —— 就是控件本体。
   *
   * 2026-11-08 修正:上一版这段**要求先找到「面料材质」标签**才肯跑,
   * 而真机日志是「标签✗」⇒ 这条兜底也跟着废了。现在与标签完全解耦。
   * 代价是要扫一遍节点(约 4000 个),所以加两道便宜的前置:
   *   ① 整块文本里没有「%」直接返回(一次 textContent 读);
   *   ② 每个挂载周期最多跑一次(1.5 秒节流),避免重试期间反复全扫。
   */
  var lastChipScanAt = 0;

  function findControlByChipText() {
    var scope = null;
    try {
      scope = document.getElementById('goodsEditScrollContainer') || document.body;
    } catch (e) { scope = null; }
    if (!scope) return null;

    var scopeText = '';
    try { scopeText = scope.textContent || ''; } catch (e) { scopeText = ''; }
    if (scopeText.indexOf('%') < 0) return null;      // 一定还没有芯片

    var now = Date.now();
    if (now - lastChipScanAt < 1500) return null;     // 节流:同一周期不重复全扫
    lastChipScanAt = now;

    var all = [];
    try { all = scope.querySelectorAll('*'); } catch (e) { all = []; }

    for (var i = 0; i < all.length && i < 4000; i++) {
      var el = all[i];
      if (el.children.length > 2) continue;           // 芯片是最小叶子级
      if (el.closest && el.closest('[' + BOX_ATTR + ']')) continue;
      var t = (el.textContent || '').trim();
      if (!/^[\u4e00-\u9fa5A-Za-z·]{1,12}\s*\d+(\.\d+)?\s*%$/.test(t)) continue;

      var node = el.parentElement;
      var guard = 0;
      while (node && guard < 6) {
        guard++;
        var inp = null;
        try { inp = node.querySelector('input, [role="combobox"]'); } catch (e) { inp = null; }
        if (inp && inFormArea(node)) return visible(node) ? node : null;
        node = node.parentElement;
      }
    }
    return null;
  }

  /* ==========================================================
   * 三、挂自建输入框 + 按钮
   * ========================================================== */

  /**
   * 定位(2026-11-08 16:02 按用户口径重做:落下一行、拉通到和原生控件
   * 同等长度、左对齐不留空位,输入框自动撑满、按钮贴右端)。
   *   · 父容器是 flex  → 行内右邻(is-inline),最稳;
   *   · 其余           → 落下一行(is-below),宽度按原生控件实测写死,
   *                      不随父容器变化,左边永不留空位。
   */
  function place(box, control) {
    if (!box || !control || !control.parentNode) return;
    var parent = control.parentNode;

    var disp = '';
    try { disp = window.getComputedStyle(parent).display || ''; } catch (e) { disp = ''; }

    box.classList.remove('is-inline', 'is-below', 'is-float');
    box.style.left = '';
    box.style.top = '';
    box.style.width = '';

    if (/flex/.test(disp)) { box.classList.add('is-inline'); return; }

    var r = null;
    try { r = control.getBoundingClientRect(); } catch (e) { r = null; }
    box.classList.add('is-below');
    if (r && r.width > 0) {
      box.style.width = Math.round(r.width) + 'px';   // 同等长度 = 原生控件实测宽
    }
  }

  /**
   * 说明面板:四条「能填的样子」+ 三条规则,纯展示。
   * 用户 2026-11-10 明确「不需要点一下就预填内容」⇒ 这里没有一个可点元素,
   * 也不绑任何事件;输入框里出现什么,只能由用户自己敲。
   */
  function buildGuide() {
    var wrap = document.createElement('div');
    wrap.className = GUIDE_CLASS;

    var hd = document.createElement('div');
    hd.className = 'dyc-fabric-guide-hd';
    hd.textContent = '下面这些写法都能直接认出来，照着写就行';
    wrap.appendChild(hd);

    for (var i = 0; i < GUIDE_ROWS.length; i++) {
      var line = document.createElement('div');
      line.className = 'dyc-fabric-guide-row';
      var code = document.createElement('b');
      code.textContent = GUIDE_ROWS[i][0];
      var tag = document.createElement('i');
      tag.textContent = GUIDE_ROWS[i][1];
      line.appendChild(code);
      line.appendChild(tag);
      wrap.appendChild(line);
    }

    var sep = document.createElement('div');
    sep.className = 'dyc-fabric-guide-sep';
    wrap.appendChild(sep);

    for (var j = 0; j < GUIDE_RULES.length; j++) {
      var rule = document.createElement('div');
      rule.className = 'dyc-fabric-guide-rule';
      var key = document.createElement('em');
      key.textContent = GUIDE_RULES[j][0];
      rule.appendChild(key);
      rule.appendChild(document.createTextNode(GUIDE_RULES[j][1]));
      wrap.appendChild(rule);
    }

    return wrap;
  }

  /** 点面板外面就收起(捕获阶段:自建框自己的 mousedown 会被 stopPropagation 掉) */
  function onGuideDocDown(ev) {
    var boxes;
    try { boxes = document.querySelectorAll('[' + BOX_ATTR + ']'); } catch (e) { return; }
    for (var i = 0; i < boxes.length; i++) {
      var g = boxes[i].querySelector('.' + GUIDE_CLASS);
      if (!g) continue;
      if (boxes[i].contains(ev.target)) continue;
      g.classList.remove('is-open');
    }
  }

  /** 清扫误挂进弹窗/浮层的自建框(挂载判据收紧前留下的,或平台 portal 挪了位置) */
  function sweepForeignBoxes() {
    var boxes;
    try { boxes = document.querySelectorAll('[' + BOX_ATTR + ']'); } catch (e) { return; }
    for (var i = 0; i < boxes.length; i++) {
      if (!inFormArea(boxes[i])) {
        var p = boxes[i].parentNode;
        if (p) p.removeChild(boxes[i]);
        if (hintNode && !document.contains(hintNode)) hintNode = null;
      }
    }
  }

  function mount() {
    if (!on || !inScope()) return;

    try { sweepForeignBoxes(); } catch (e) { /* 清扫失败不影响挂载 */ }

    var control = findControl();
    if (!control || !control.parentNode) return;

    var exist = control.parentNode.querySelector('[' + BOX_ATTR + ']');
    if (exist) { lastControl = control; place(exist, control); return; }
    lastControl = control;

    var box = document.createElement('div');
    box.className = BOX_CLASS;
    box.setAttribute(BOX_ATTR, '1');

    var input = document.createElement('input');
    input.type = 'text';
    input.className = INPUT_CLASS;
    /* 2026-11-08 用户反馈一:placeholder 不写示例(曾被当成已填好的内容)。
       2026-11-08 用户反馈二:title 悬停浮动提示也删掉(16:28「浮动提示删掉」)。
       ⇒ 灰字只留一句话指引,其余什么都不挂。 */
    input.placeholder = '填写面料+含量，合计100%';
    input.setAttribute('aria-label', '面料配比，写成材料加含量，合计100%');

    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = BTN_CLASS;
    btn.textContent = '智能填写';

    /* 输入框 + 右内侧的「一键清空」(2026-11-08 用户要求)。
       包一层是为了把叉号绝对定位在输入框内部右端 —— 不挤占输入文字的位置,
       也不改输入框自身的宽度。 */
    var field = document.createElement('div');
    field.className = FIELD_CLASS;
    field.appendChild(input);

    var clear = document.createElement('button');
    clear.type = 'button';
    clear.className = CLEAR_CLASS;
    clear.textContent = '×';
    clear.setAttribute('aria-label', '清空面料输入框');
    clear.style.display = 'none';
    field.appendChild(clear);

    box.appendChild(field);
    box.appendChild(btn);

    /* 疑似笔误的提示行(2026-11-08 用户定:下方小红字,**仍按你写的写入**)。
       放在 box 里让它换行到第二行 —— 三种定位方式(inline/float/below)都不用另算坐标。 */
    var hint = document.createElement('div');
    hint.className = HINT_CLASS;
    hint.style.display = 'none';
    box.appendChild(hint);
    hintNode = hint;

    /* 说明面板(2026-11-10):换行到第三行,点输入框展开、打字或点外面收起 */
    var guide = buildGuide();
    box.appendChild(guide);

    control.parentNode.insertBefore(box, control.nextSibling);
    place(box, control);

    input.addEventListener('focus', function () { guide.classList.add('is-open'); });
    input.addEventListener('click', function () { guide.classList.add('is-open'); });
    if (!guideDocBound) {
      guideDocBound = true;
      document.addEventListener('mousedown', onGuideDocDown, true);
    }

    btn.addEventListener('click', function (ev) {
      ev.preventDefault();
      ev.stopPropagation();
      run(input, btn);
    });
    input.addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter') { ev.preventDefault(); run(input, btn); }
    });
    /* 一改输入就收掉旧提示:否则红字会跟实际输入对不上;顺便同步叉号的显隐。
       说明面板同时收起 —— 已经动手写了,不需要再教写法。 */
    input.addEventListener('input', function () {
      showHint(null);
      syncClear();
      guide.classList.remove('is-open');
    });

    function syncClear() {
      clear.style.display = String(input.value || '').length ? 'flex' : 'none';
    }

    clear.addEventListener('mousedown', function (ev) { ev.preventDefault(); });
    clear.addEventListener('click', function (ev) {
      ev.preventDefault();
      ev.stopPropagation();
      /* 只清输入框与红字,**不碰原生框里已经填好的材料** —— 用户要的是清空「这个框」 */
      input.value = '';
      showHint(null);
      syncClear();
      try { input.focus(); } catch (e) { /* 老内核 */ }
    });

    /* 平台容器可能整块可点(点开下拉) —— 别让点我们的框把下拉拉开 */
    box.addEventListener('mousedown', function (ev) { ev.stopPropagation(); });
    box.addEventListener('click', function (ev) { ev.stopPropagation(); });
    syncClear();
  }

  function unmount() {
    var boxes = document.querySelectorAll('[' + BOX_ATTR + ']');
    for (var i = 0; i < boxes.length; i++) {
      if (boxes[i].parentNode) boxes[i].parentNode.removeChild(boxes[i]);
    }
    hintNode = null;
    if (guideDocBound) {
      document.removeEventListener('mousedown', onGuideDocDown, true);
      guideDocBound = false;
    }
  }

  /**
   * 疑似笔误提示(用户 2026-11-08 定:下方小红字,**仍然写入**原样)。
   *
   * 判据只认「平台下拉里存在一个只差一个字的材料名」——不猜、不联想:
   *   · 材料名少于 3 个字不提示(「涤纶/锦纶」只差一个字,却是两种材料);
   *   · 只差 1 个字(增/删/改)才算疑似;
   *   · **绝不自动替换**,写入的仍是用户写的那个名字。
   */
  function showHint(list) {
    var el = (hintNode && document.contains(hintNode)) ? hintNode : null;
    if (!el) return;
    if (!list || !list.length) {
      el.textContent = '';
      el.style.display = 'none';
      return;
    }
    var parts = list.map(function (s) {
      return '「' + s.typed + '」可能是「' + s.likely + '」的笔误';
    });
    el.textContent = parts.join('；') + '（仍按你写的写入）';
    el.style.display = 'block';
  }

  /** 材料名去掉末尾百分比,只比名字 */
  function bareName(s) {
    return String(s || '').trim().replace(/\s*\d+(?:\.\d+)?\s*[%％]?$/, '').trim();
  }

  /** 只回答「编辑距离是不是恰好 1」—— 够用且比完整 DP 便宜 */
  function oneOff(a, b) {
    if (a === b) return false;
    var la = a.length;
    var lb = b.length;
    if (Math.abs(la - lb) > 1) return false;
    var i = 0;
    var j = 0;
    var diff = 0;
    while (i < la && j < lb) {
      if (a.charAt(i) === b.charAt(j)) { i++; j++; continue; }
      diff++;
      if (diff > 1) return false;
      if (la > lb) i++;
      else if (lb > la) j++;
      else { i++; j++; }
    }
    if (i < la || j < lb) diff++;
    return diff === 1;
  }

  /** 在下拉选项里找「只差一个字」的那个(找不到返回 null) */
  function nearestOption(list, name) {
    var want = bareName(name);
    if (want.length < 3) return null;
    for (var i = 0; i < list.length; i++) {
      var cand = bareName(list[i].text);
      if (!cand || cand.length < 3) continue;
      if (cand === want) continue;
      if (oneOff(want, cand)) return { el: list[i].el, text: cand };
    }
    return null;
  }

  function scheduleScan(delay) {
    if (scanTimer) return;
    scanTimer = setTimeout(function () {
      scanTimer = 0;
      try { mount(); } catch (e) { log('面料控件挂载失败:' + ((e && e.message) || e)); }
    }, delay || 400);
  }

  /* ==========================================================
   * 四、写进原生控件
   * ========================================================== */

  function clickEl(el) {
    if (!el) return false;
    var r = el.getBoundingClientRect();
    var opt = { bubbles: true, cancelable: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 };
    /* 只派发事件,不额外调 el.click():click() 会再造一个 click 事件,
       组件监听器收到两次 ⇒ 同材料被选两遍 / 同一叉号被点两次。
       mousedown 是必须的:rc-select 一类的选项是靠 mousedown 触发的。 */
    ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'].forEach(function (t) {
      try {
        var Ctor = (t.indexOf('pointer') === 0 && window.PointerEvent) ? window.PointerEvent : window.MouseEvent;
        el.dispatchEvent(new Ctor(t, opt));
      } catch (e) { /* 个别事件类缺失就跳过,不影响其余 */ }
    });
    return true;
  }

  function openControl(control) {
    var combo = control.matches('[role="combobox"]') ? control : control.querySelector('[role="combobox"]');
    if (combo && combo.getAttribute('aria-expanded') === 'true') return true;
    // Aurora 的 wrapper 没有事件；mousedown 必须落到内层 select 才能展开。
    return clickEl(control.querySelector('.aurora-select') || combo || control);
  }

  /** React 受控输入:必须走原型上的 setter,否则框架的 valueTracker 认为没变 */
  function nativeSet(input, value) {
    var desc = null;
    try {
      desc = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value');
    } catch (e) { desc = null; }
    try {
      if (desc && desc.set) desc.set.call(input, value);
      else input.value = value;
    } catch (e) {
      input.value = value;
    }
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  /* ==========================================================
   * 直填优先:向平台复合组件的 onChange 一次提交完整 value。
   * 只改 input.value 不会进入 React 状态,因此这里必须找到组件数据通道,
   * 并沿用平台已有的材料对象(保留 id 等字段),不能凭空猜一个保存格式。
   * ========================================================== */

  function reactKey(el, prefix) {
    if (!el) return '';
    var keys = [];
    try { keys = Object.getOwnPropertyNames(el); } catch (e) { keys = []; }
    for (var i = 0; i < keys.length; i++) {
      if (keys[i].indexOf(prefix) === 0) return keys[i];
    }
    return '';
  }

  function optionSource(props) {
    var keys = ['options', 'dataSource', 'list'];
    for (var i = 0; i < keys.length; i++) {
      if (Array.isArray(props[keys[i]])) return props[keys[i]];
    }
    return [];
  }

  /** 从宿主节点沿 React fiber 向上找复合组件,而不是拿原生搜索框的 onChange。
   *  真机 2026-11-08 15:04:控件是 aurora-select 结构,首次没找到通道走了逐项兜底。
   *  放宽两处:① pendingProps 兜底(渲染中 fiber 的 memoizedProps 可能还是旧的);
   *  ② value 为空(null/undefined)但带非空 options 也算 —— 空选状态的 select。 */
  function channelOk(props) {
    if (!props || typeof props.onChange !== 'function') return false;
    if (Array.isArray(props.value)) return true;
    return props.value == null && Array.isArray(props.options) && props.options.length > 0;
  }

  function directChannel(control) {
    var nodes = [control];
    try {
      var input = findSearchInput(control);
      if (input) nodes.push(input);
    } catch (e) { /* 找不到搜索框不影响从控件本体找 */ }

    for (var n = 0; n < nodes.length; n++) {
      var node = nodes[n];
      var propsKey = reactKey(node, '__reactProps$');
      if (propsKey) {
        var directProps = node[propsKey];
        if (channelOk(directProps)) return { props: directProps };
      }
      var fiberKey = reactKey(node, '__reactFiber$');
      var fiber = fiberKey ? node[fiberKey] : null;
      var guard = 0;
      while (fiber && guard++ < 30) {
        var props = fiber.memoizedProps || fiber.pendingProps;
        if (channelOk(props)) return { props: props };
        fiber = fiber.return;
      }
    }
    return null;
  }

  function fieldKey(sample, candidates, numeric) {
    if (!sample) return '';
    for (var i = 0; i < candidates.length; i++) {
      var key = candidates[i];
      var value = sample[key];
      if (numeric) {
        if ((typeof value === 'number' || (typeof value === 'string' && value.trim() !== ''))
          && isFinite(Number(value)) && Number(value) >= 0 && Number(value) <= 100) return key;
      } else if (typeof value === 'string' && value.trim()) return key;
    }
    return '';
  }

  function copyRecord(source) {
    var out = {};
    for (var key in source) {
      if (Object.prototype.hasOwnProperty.call(source, key)) out[key] = source[key];
    }
    return out;
  }

  function findRecord(list, nameKey, name) {
    var want = String(name).trim();
    for (var i = 0; i < list.length; i++) {
      var item = list[i];
      if (item && typeof item === 'object' && item[nameKey] === want) return item;
    }
    return null;
  }

  var DIRECT_NAME_KEYS = ['name', 'materialName', 'material', 'label', 'compositionName', 'fabricName', 'title'];

  /** 已知材料沿用平台原对象(保留 id);未知材料给「名字(+配比)」的自定义记录直接提交。
   *  平台的 value 记录里可以没有配比字段(配比是独立的输入框,由 writeItemPercents 写入),
   *  所以缺 pctKey 不再判失败 —— 真机 15:04 就是 value 只带材料标识、配比在框里的形态。 */
  function directValue(props, items) {
    var current = Array.isArray(props.value) ? props.value : [];
    var options = optionSource(props);
    var sample = null;
    var pools = [current, options];
    for (var p = 0; p < pools.length && !sample; p++) {
      for (var i = 0; i < pools[p].length; i++) {
        var cand = pools[p][i];
        if (cand && typeof cand === 'object' && !Array.isArray(cand) && fieldKey(cand, DIRECT_NAME_KEYS, false)) {
          sample = cand;
          break;
        }
      }
    }
    if (!sample) return null;
    if (typeof sample.label === 'string' && typeof sample.value === 'string'
      && ('extra' in sample || 'templateId' in sample)) return null; // Aurora 交给 MAIN 世界按真实结构提交。

    var nameKey = fieldKey(sample, DIRECT_NAME_KEYS, false);
    var pctKey = fieldKey(sample, ['percent', 'percentage', 'ratio', 'proportion', 'content', 'pct', 'composition', 'fabricPercent', 'rate', 'value'], true);

    var next = [];
    for (var j = 0; j < items.length; j++) {
      var source = findRecord(current, nameKey, items[j].name) || findRecord(options, nameKey, items[j].name);
      var row;
      if (source) {
        row = copyRecord(source);
        row[nameKey] = items[j].name;
        if (pctKey) row[pctKey] = typeof source[pctKey] === 'string' ? String(items[j].pct) : items[j].pct;
      } else {
        /* 未知材料:按用户写的名字直接给一条自定义记录,不带任何 id ——
           克隆别的材料的 id 会把两个材料并成同一个。平台不收就渲染不出来,
           验收不过自动回退逐项流程,不会假报成功。(用户 2026-11-08:未知材料支持自定义值直接提交) */
        row = {};
        row[nameKey] = items[j].name;
        if (pctKey) row[pctKey] = typeof sample[pctKey] === 'string' ? String(items[j].pct) : items[j].pct;
      }
      next.push(row);
    }
    return next;
  }

  function waitUntil(test, timeout) {
    return new Promise(function (resolve) {
      var started = Date.now();
      function poll() {
        var ok = false;
        try { ok = !!test(); } catch (e) { ok = false; }
        if (ok) return resolve(true);
        if (Date.now() - started >= timeout) return resolve(false);
        setTimeout(poll, 40);
      }
      poll();
    });
  }

  /** 直填验收第一关:材料名与数量必须整组渲染进原生框;配比由 writeItemPercents 统一写
   *  —— 平台的比例输入框常是半受控的,onChange 之后渲染出来还是旧值,
   *  旧版把「比例没跟上」判成直填失败,白白回退逐项流程还撞上清理问题。 */
  function directChipsOk(control, items) {
    var chips = chipsOf(control);
    if (chips.length !== items.length) return false;
    for (var i = 0; i < items.length; i++) {
      if (!chipHas(control, items[i].name)) return false;
    }
    return true;
  }

  function applyDirectItems(control, items) {
    var channel = directChannel(control);
    if (!channel) {
      log('智能填写:没找到组件数据通道,转逐项写入');
      return Promise.resolve({ ok: false, reason: '没有组件数据通道' });
    }
    var next = directValue(channel.props, items);
    if (!next) {
      log('智能填写:通道在但数据格式还原不了,转逐项写入');
      return Promise.resolve({ ok: false, reason: '不能完整还原平台数据格式' });
    }

    try { channel.props.onChange(next); }
    catch (e) {
      log('智能填写:直填接口异常,转逐项写入 ' + ((e && e.message) || e));
      return Promise.resolve({ ok: false, reason: '直填接口异常' });
    }

    return waitUntil(function () { return directChipsOk(control, items); }, 800).then(function (ok) {
      if (!ok) {
        log('智能填写:直填后原生框未完整更新,转逐项写入');
        return { ok: false, reason: '直填结果未通过核验' };
      }
      /* 材料已整组进框。配比统一走 writeItemPercents(已选面板按名找行优先),
         平台逐项必填 —— 100% 也要写,写不上不算成功。 */
      return writeItemPercents(control, items).then(function (rw) {
        if (!rw.missing.length) {
          log('智能填写:已通过组件数据通道一次提交 ' + items.length + ' 项(配比已写入)');
          return { ok: true };
        }
        var names = rw.missing.map(function (x) { return x.name; }).join('」「');
        log('智能填写:材料进框但「' + names + '」配比没写上');
        return { ok: false, pctMissing: true, filled: items,
          reason: '材料已全部进框,但「' + names + '」的配比没写上(平台要求逐项必填)。请点开面料面板手动补一下配比。' };
      });
    });
  }

  function pressEnter(el) {
    var init = { bubbles: true, cancelable: true, key: 'Enter', code: 'Enter', keyCode: 13, which: 13 };
    ['keydown', 'keypress', 'keyup'].forEach(function (t) {
      try { el.dispatchEvent(new KeyboardEvent(t, init)); } catch (e) { /* 老内核 */ }
    });
  }

  function findSearchInput(control) {
    var inputs = [];
    try { inputs = control.querySelectorAll('input'); } catch (e) { inputs = []; }
    var best = null;
    for (var i = 0; i < inputs.length; i++) {
      var el = inputs[i];
      if (el.getAttribute('type') === 'number') continue;
      if (!visible(el) && el.getBoundingClientRect().width === 0 && el.getBoundingClientRect().height === 0) {
        /* antd 的搜索框常被做成 1px / opacity:0 —— 不能因此排除,留着兜底 */
        if (!best) best = el;
        continue;
      }
      if (/search/i.test(String(el.className || ''))) return el;
      if (!best) best = el;
    }
    return best;
  }

  function optionEntry(el) {
    var row = el.closest('.aurora-select-item-option, [role="option"]') || el;
    var label = row.querySelector('.aurora-dorami-composition-select-option-label') || row;
    return { el: row, text: (row.getAttribute('title') || textWithoutExt(label).split('\n').join('')).trim() };
  }

  function optionNodes() {
    var sel = '[class*="composition-select-option"], [class*="select-item-option"],'
      + ' [class*="select-option"], [class*="option-item"]';
    var nodes = [];
    try { nodes = document.querySelectorAll(sel); } catch (e) { nodes = []; }
    var out = [];
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      if (el.hasAttribute(BOX_ATTR)) continue;
      if (el.closest && el.closest('[' + BOX_ATTR + ']')) continue;
      var cls = String(el.className || '');
      /* 容器不是选项:option-list / dropdown / wrapper 这类是列表壳子
         (真机 15:42:下拉是 aurora 系列,旧特征只认 composition 系列 ⇒ 睁眼瞎) */
      if (/option-list|dropdown|popup|wrapper|container|overlay/i.test(cls)) continue;
      if (!visible(el)) continue;
      var entry = optionEntry(el);
      var t = entry.text;
      if (!t || t.length > 24) continue;
      if (!out.some(function (x) { return x.el === entry.el; })) out.push(entry);
    }
    /* 只留叶子:包含其他命中节点的(整块列表壳)不算单个选项 */
    var leaves = [];
    for (var j = 0; j < out.length; j++) {
      var inner = false;
      for (var k = 0; k < out.length; k++) {
        if (k !== j && out[j].el.contains(out[k].el)) { inner = true; break; }
      }
      if (!inner) leaves.push(out[j]);
    }
    return leaves;
  }

  /** 精确命中才算数(用户:材料名对不上就新建,不许匹配类似的) */
  function matchOption(list, name) {
    var want = String(name).trim();
    for (var i = 0; i < list.length; i++) {
      if (list[i].text.trim() === want) return list[i];
    }
    return null;
  }

  function chipsOf(control) {
    var sel = '[class*="composition-select-selection-item"], [class*="selection-item"], [class*="composition-tag"]';
    var nodes = [];
    try { nodes = control.querySelectorAll(sel); } catch (e) { nodes = []; }
    var out = [];
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      if (el.closest && el.closest('[' + BOX_ATTR + ']')) continue;
      if (/option|dropdown/i.test(String(el.className || ''))) continue;
      var t = (el.textContent || '').trim();
      if (!t) continue;
      /* 去重:同一颗芯片会被内外两层命中(如 aurora 的芯片层与其内容层
         都含 selection-item,真机 16:10 每颗被数成两条)→ 只留外层 */
      var nested = false;
      for (var j = 0; j < nodes.length; j++) {
        if (j !== i && nodes[j].contains(el)) { nested = true; break; }
      }
      if (nested) continue;
      out.push({ el: el, text: t, name: el.getAttribute('title') || bareName(t) });
    }
    return out;
  }

  function chipHas(control, name) {
    var want = String(name).trim();
    var list = chipsOf(control);
    for (var i = 0; i < list.length; i++) {
      if (list[i].name === want) return true;
    }
    return false;
  }

  /** 在一颗芯片里找「叉号」。平台常把叉号做成悬停才可见,所以这里不看可见性
   *  —— 合成事件不走命中测试,隐藏节点的监听器照样触发。 */
  function removeTargetIn(chip) {
    var sels = ['[class*="remove"]', '[class*="close"]', '[class*="delete"]', '[class*="clear"]',
      '[aria-label*="删除"]', '[aria-label*="移除"]'];
    for (var i = 0; i < sels.length; i++) {
      var el = chip.querySelector(sels[i]);
      if (el) return el;
    }
    /* 类名全漂移时的最后兜底:芯片里的小图标(svg/i,≤20px)基本就是叉号 */
    var tiny = [];
    try { tiny = chip.querySelectorAll('svg, i'); } catch (e) { tiny = []; }
    for (var j = 0; j < tiny.length; j++) {
      var r = tiny[j].getBoundingClientRect();
      if (r.width <= 20 && r.height <= 20) return tiny[j];
    }
    return null;
  }

  /** 覆盖语义:先把原生框里的旧值清掉(用户 2026-11-08 定)。
   *  必须逐个点、点一个等一拍再重扫 —— React 点掉一个叉就整块重渲染,
   *  一次性抓出来的节点列表瞬间全部变成游离节点(事件不再冒泡到根监听器),
   *  旧版一循环点 N 个实际只清掉了 1 个 ⇒ 真机「旧值没清干净」。 */
  function clearChips(control) {
    var cleared = 0;
    var deadline = Date.now() + 2000;
    function pass() {
      if (cleared >= 30 || Date.now() > deadline) return Promise.resolve(cleared);
      var chips = chipsOf(control);
      if (!chips.length) return Promise.resolve(cleared);
      var target = null;
      for (var i = 0; i < chips.length && !target; i++) {
        target = removeTargetIn(chips[i].el);
      }
      if (!target) return Promise.resolve(cleared);   // 有芯片但找不到叉号,交给上层验收报错
      clickEl(target);
      cleared++;
      return sleep(80).then(pass);
    }
    return pass();
  }

  function percentInputs(control) {
    var inputs = [];
    try { inputs = control.querySelectorAll('input'); } catch (e) { inputs = []; }
    var out = [];
    for (var i = 0; i < inputs.length; i++) {
      var el = inputs[i];
      if (el.closest && el.closest('[' + BOX_ATTR + ']')) continue;
      var type = String(el.getAttribute('type') || '');
      var cls = String(el.className || '');
      if (type === 'number' || /percent|input-number|ratio|composition-select-input/i.test(cls)) {
        out.push(el);
      }
    }
    return out;
  }

  /* ==========================================================
   * （新建材质弹窗路径已按用户 2026-11-08 要求整体删除 —— 真机上一直没成功过。
   *   未知材料的正路 = 直填通道的自定义值提交;兜底路径只剩回车一试,
   *   回车也建不了就如实报失败,不再去点「新建材质」入口。）
   * ========================================================== */

  /** 某些内核/组件在**打开下拉之后**才把搜索框挂出来 —— 找不到就先点一下再找 */
  function resolveSearch(control) {    var s = findSearchInput(control);
    if (s) return Promise.resolve(s);
    openControl(control);
    return sleep(200).then(function () {
      return findSearchInput(control) || null;
    });
  }

  /* ==========================================================
   * MAIN 世界桥:内容脚本在隔离世界里读不到页面挂在 DOM 上的
   * __reactFiber$/__reactProps$,所以「找通道 + 按平台真实结构
   * (value_name / measure_info)构造 + 提交」必须在主世界做。
   * 桥文件 = fabric-smart-fill-main.js(manifest 以 world: MAIN 注入);
   * 就绪标记 = documentElement 的 data-dyc-fabric-bridge 属性(跨世界可见)。
   * ========================================================== */

  function bridgeArmed() {
    try { return document.documentElement.getAttribute('data-dyc-fabric-bridge') === '1'; }
    catch (e) { return false; }
  }

  function bridgeSubmit(control, items, prepareOnly, inspectOnly) {
    return new Promise(function (resolve) {
      if (!bridgeArmed()) return resolve({ ok: false, why: '桥未就绪' });
      var rid = 'f' + Date.now() + Math.floor(Math.random() * 100000);
      var timer = setTimeout(function () {
        window.removeEventListener('message', onMsg);
        resolve({ ok: false, why: '桥响应超时' });
      }, 1500);
      function onMsg(ev) {
        var d = ev.data;
        if (!d || d.__dycFabricResult !== 1 || d.rid !== rid) return;
        clearTimeout(timer);
        window.removeEventListener('message', onMsg);
        resolve(d.result || { ok: false, why: '桥返回空' });
      }
      window.addEventListener('message', onMsg);
      try {
        control.setAttribute('data-dyc-fabric-target', '1');
        window.postMessage({ __dycFabric: 1, rid: rid, items: items, prepareOnly: !!prepareOnly, inspectOnly: !!inspectOnly }, '*');
      } catch (e) {
        clearTimeout(timer);
        window.removeEventListener('message', onMsg);
        resolve({ ok: false, why: '桥调用异常:' + ((e && e.message) || e) });
      }
    });
  }

  /** 桥与逐项流程统一按完整材料名核验，避免一颗芯片抵算多个材料。 */
  function chipOnBox(control, name) {
    return chipHas(control, name);
  }

  /** 桥提交后平台实际收下了哪些、缺哪些。15:42 教训:平台收下 4/5,
   *  旧验收要求「5 个芯片一个不少」就判失败,转兜底把 4 项清掉重填 ——
   *  自己人打自己人。现在按名字逐项盘点,收下几项保几项。 */
  function bridgeRendered(control, items) {
    var rendered = [];
    var missing = [];
    for (var i = 0; i < items.length; i++) {
      (chipOnBox(control, items[i].name) ? rendered : missing).push(items[i]);
    }
    var chipTexts = chipsOf(control).map(function (c) { return (c.text || '').trim(); });
    return { rendered: rendered, missing: missing, chipTexts: chipTexts };
  }

  function readRendered(control, items) {
    return bridgeSubmit(control, [], false, true).then(function (state) {
      if (!state.ok || !Array.isArray(state.items)) return bridgeRendered(control, items);
      var names = state.items.map(function (x) { return x.name; });
      var rendered = [], missing = [];
      items.forEach(function (it) { (names.indexOf(it.name) >= 0 ? rendered : missing).push(it); });
      return { rendered: rendered, missing: missing, chipTexts: names };
    });
  }

  /** 桥部分收下的收尾:保住已进框的,配比写好,缺的报缺(不清掉重填) */
  /* ============ 面板搜索补勾(用户 16:25「只识别到 3 个」) ============
   * 平台 onChange 会整条拒收字典里不认的材料(「羊驼毛」三连拒),
   * 而平台自己的「已选」面板自带搜索框 —— 把缺的材料名打进面板搜索框:
   * 字典里有 ⇒ 精确命中的那一行点一下就勾上(平台原生路径,非模糊匹配);
   * 字典里没有 ⇒ 把面板现场报进提示,让用户看到平台到底给不给
   * (比如字典里其实叫「羊驼毛纤维」)。 */

  /** 面板搜索框:严格只认 placeholder 含「搜索/材质」或 class 含 search 的
   *  输入框(真机 16:48:宽松兜底把「商品标题」(placeholder 请输入商品标题)
   *  误认成面板搜索框,「羊驼毛」直接写进了标题)。找不到就是找不到,
   *  由调用方先点控件开面板再找,绝不放宽。
   *  control 自身的搜索框绝不算(class 也含 search,必须排除)。 */
  function findPanelSearch(control) {
    var inputs = [];
    try { inputs = document.querySelectorAll('input'); } catch (e) { inputs = []; }
    for (var i = 0; i < inputs.length; i++) {
      var el = inputs[i];
      if (el.closest && el.closest('[' + BOX_ATTR + ']')) continue;
      if (control && control.contains(el)) continue;
      if (!visible(el) || el.disabled) continue;
      var ph = String(el.getAttribute('placeholder') || '');
      if (/材质|面料/.test(ph)) return el;
    }
    return null;
  }

  /** 面板容器 = 「搜索材质」框向上爬、第一个包含配比输入框(placeholder
   *  含「请输入」)的祖先 —— 真机 16:49 截图:面板 = 左侧搜索/字典列表 +
   *  右侧已选(每行 材料名 + 请输入框 + %)。找不到退回最近的浮层类容器。 */
  function panelBox(control) {
    var s = findPanelSearch(control);
    if (!s) return null;
    var node = s.parentElement;
    var hops = 0;
    while (node && node !== document.body && node !== document.documentElement && hops++ < 6) {
      if (control && node.contains(control)) break;
      var pctInputs = [];
      try { pctInputs = node.querySelectorAll('input[placeholder*="请输入"]'); } catch (e) { pctInputs = []; }
      if (pctInputs.length) return node;
      node = node.parentElement;
    }
    var c = s.closest ? s.closest('[class*="dropdown"], [class*="option-list"], [class*="popup"], [class*="panel"]') : null;
    return c && !(control && c.contains(control)) ? c : null;
  }

  /** 面板里与材料名**整串相等**的行(只留叶子,不模糊;已选行带配比输入框,
   *  不能当字典行点)。 */
  function panelExactRow(name, control) {
    var want = String(name).trim();
    var box = panelBox(control);
    if (!box) return null;
    var nodes = [];
    try { nodes = box.querySelectorAll('[class*="option"], [class*="item"], li, label'); } catch (e) { nodes = []; }
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      if (!visible(el)) continue;
      if (control && control.contains(el)) continue;
      if (el.closest && el.closest('[' + BOX_ATTR + ']')) continue;
      if (el.querySelector && el.querySelector('input[placeholder*="请输入"]')) continue;  // 已选行
      var entry = optionEntry(el);
      if (entry.text !== want) continue;
      var nested = false;
      for (var j = 0; j < nodes.length; j++) {
        if (j !== i && el.contains(nodes[j]) && optionEntry(nodes[j]).text === want) { nested = true; break; }
      }
      if (!nested) return entry.el;
    }
    return null;
  }

  function panelVisibleTexts(control) {
    var box = panelBox(control);
    if (!box) return [];
    var out = [];
    var nodes = [];
    try { nodes = box.querySelectorAll('div, span, li, [class*="empty"], [class*="item"]'); } catch (e) { nodes = []; }
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      if (!visible(el) || el.children.length) continue;
      var t = (el.textContent || '').trim();
      if (!t || t.length > 16) continue;
      if (out.indexOf(t) < 0) out.push(t);
      if (out.length >= 6) break;
    }
    return out;
  }

  function selectViaPanelSearch(control, name) {
    function attempt() {
      var row = panelExactRow(name, control);
      if (!row) return null;
      clickEl(row);
      return waitUntil(function () { return chipOnBox(control, name); }, 600).then(function (ok) {
        return { ok: !!ok, detail: ok ? '面板搜索命中并勾选' : '点了面板行但没进框' };
      });
    }
    return Promise.resolve().then(attempt).then(function (r) {
      if (r) return r;
      if (!findPanelSearch(control)) openControl(control);   // 面板没开先点开
      return waitUntil(function () { return !!findPanelSearch(control); }, 800).then(function (found) {
        if (!found) return { ok: false, detail: '没找到面板搜索框(面板没开?)' };
        nativeSet(findPanelSearch(control), name);
        return waitUntil(function () { return !!panelExactRow(name, control); }, 900).then(function () {
          return attempt();
        }).then(function (r2) {
          if (r2) return r2;
          return { ok: false, detail: '面板搜索「' + name + '」的结果:' + (panelVisibleTexts(control).join(' | ') || '(空)') };
        });
      });
    });
  }

  function finishPartial(control, rendered, missing) {
    var filled = rendered.slice();
    var stillMissing = [];
    var notes = [];
    function tryOne(i) {
      if (i >= missing.length) return writeAndReport();
      var it = missing[i];
      return selectViaPanelSearch(control, it.name).then(function (r) {
        if (r.ok) {
          filled.push(it);
          log('智能填写:「' + it.name + '」通过平台面板搜索勾选成功');
        } else {
          stillMissing.push(it.name);
          notes.push('「' + it.name + '」' + (r.detail || '面板搜索没命中'));
        }
        return tryOne(i + 1);
      });
    }
    function writeAndReport() {
      return writeItemPercents(control, filled).then(function (rw) {
        var pctNote = rw.missing.length
          ? '已进框的项里「' + rw.missing.map(function (x) { return x.name; }).join('」「')
            + '」的配比没写上,请手动补。'
          : '已进框的 ' + filled.length + ' 项配比已写好。';
        if (!stillMissing.length && !rw.missing.length) return { ok: true, direct: true, suspects: [] };
        if (!stillMissing.length) {
          return { ok: false, partial: true, step: 'percent', misses: [], filled: filled,
            reason: '材料已全部进框,但配比没写上,请点开面料面板手动补一下配比。', suspects: [] };
        }
        return { ok: false, partial: true, step: 'create', misses: stillMissing, filled: filled,
          reason: '「' + stillMissing.join('」「') + '」平台没有收下;' + notes.join(';') + ';' + pctNote,
          suspects: [] };
      });
    }
    return tryOne(0);
  }

  function applyItems(control, items) {
    /* 用户 16:11 定:先清空原生已写的材料,再进行填写 ——
       平台对 onChange 是「合并」不是「替换」,不清空的话
       旧材料 + 新材料不停叠加,框框都重叠了(真机 16:10 铁证)。 */
    return bridgeSubmit(control, [], true).then(function () {
      return clearChips(control);
    }).then(function (cleared) {
      if (cleared) log('智能填写:先清掉原生已写的 ' + cleared + ' 项');
      return applyDirectItems(control, items).then(function (direct) {
        if (direct.ok) return { ok: true, direct: true, suspects: [] };
        if (direct.pctMissing) {
          /* 材料已在框里,只是配比没写上 —— 不能再转兜底重填,如实报缺 */
          return { ok: false, partial: true, step: 'percent', misses: [], filled: direct.filled,
            reason: direct.reason, suspects: [] };
        }
        /* 平台内部状态可能还有残留(点 × 清不掉的),先通过桥发一条「空」把它清成零,
           等芯片真的清空了再提交新材料,防新旧叠加。 */
        return bridgeSubmit(control, []).then(function (clr) {
          if (clr.ok) log('智能填写:已通过主世界通道清空平台原有材料');
          return waitUntil(function () { return chipsOf(control).length === 0; }, 400).then(function () {
            return bridgeSubmit(control, items).then(function (bridge) {
        if (!bridge.ok) {
          log('智能填写:主世界通道不可用(' + (bridge.why || '未知') + '),转逐项写入');
          return applyItemsBySteps(control, items);
        }
        log('智能填写:已通过主世界数据通道提交 ' + items.length + ' 项(形态 ' + bridge.kind + ')');
        return sleep(80).then(function () { return readRendered(control, items); })
          .then(function (st) {
            log('智能填写:平台收下 ' + st.rendered.length + '/' + items.length + ' 项'
              + (st.missing.length ? ',缺:' + st.missing.map(function (x) { return x.name; }).join('、') : '')
              + ' · 芯片现场:' + (st.chipTexts.join(' | ') || '(空)'));
            if (!st.rendered.length) return applyItemsBySteps(control, items);   // 一项都没收下才走兜底
            if (st.missing.length) return finishPartial(control, st.rendered, st.missing);
            return writeItemPercents(control, items).then(function (rw) {
              if (!rw.missing.length) return { ok: true, direct: true, suspects: [] };
              return { ok: false, partial: true, step: 'percent', misses: [], filled: items,
                reason: '材料已全部进框,但「' + rw.missing.map(function (x) { return x.name; }).join('」「')
                  + '」的配比没写上(平台要求逐项必填)。请点开面料面板手动补一下配比。',
                suspects: [] };
            });
          });
            });
          });
        });
      });
    });
  }

  function applyItemsBySteps(control, items) {
    return clearChips(control).then(function (cleared) {
      if (cleared) log('智能填写:先清掉旧值 ' + cleared + ' 项');
      return applyItemsAfterClear(control, items);
    });
  }

  function applyItemsAfterClear(control, items) {
    return resolveSearch(control).then(function (search) {
      if (!search) return { ok: false, step: 'search', reason: '没找到材料输入框' };

      var suspects = [];
      var misses = [];        // 平台没有、没填进去的材料(用户 2026-11-08:能填的都填上,最后再报错)
      var filled = [];        // 已经选进框的
      var i = 0;
      function step() {
        if (i >= items.length) return Promise.resolve({ ok: true });
        var it = items[i++];

        openControl(control);                   // 打开下拉
        nativeSet(search, it.name);
        return sleep(260).then(function () {
          var opts = optionNodes();
          var opt = matchOption(opts, it.name);
          if (opt) {
            clickEl(opt.el);
            return sleep(160).then(function () {
              if (!chipHas(control, it.name)) {
                misses.push(it.name);
                log('智能填写:「' + it.name + '」点选后未按原名进框,继续下一项');
                return step();
              }
              filled.push(it);
              return step();
            });
          }

          /* 诊断(回答「没搜到还是没搜」):把下拉里实际看见的选项打进日志,
             下轮一眼分清「平台真没有」还是「探测器没看见」。 */
          var seen = [];
          for (var di = 0; di < opts.length && seen.length < 8; di++) {
            seen.push(opts[di].text.slice(0, 12));
          }
          log('智能填写:搜索「' + it.name + '」后下拉可见选项 ' + (seen.length ? seen.join(' | ') : '(一个都没看见)'));
          var near = nearestOption(opts, it.name);
          if (near) {
            var dup = false;
            for (var si = 0; si < suspects.length; si++) {
              if (suspects[si].typed === it.name) { dup = true; break; }
            }
            if (!dup) suspects.push({ typed: it.name, likely: near.text });
          }

          /* 下拉里还有别的选项时**不能按回车** —— 平台会把高亮的相近项勾进去
             (真机 2026-11-08 15:04「勾选错了」:输「聚醋纤维」回车勾了相近材料)。
             只有下拉里一个选项都没有(空态)才试一次回车,靠平台的 tags 模式建档;
             建不了就记一笔,继续填后面的(弹窗路径已按用户要求删除)。 */
          if (opts.length) {
            nativeSet(search, '');
            misses.push(it.name);
            return step();
          }

          pressEnter(search);
          return sleep(240).then(function () {
            if (chipHas(control, it.name)) {
              log('智能填写:「' + it.name + '」平台没有,已按原样新建'
                + (near ? '(疑似「' + near.text + '」的笔误,仅提示)' : ''));
              filled.push(it);
              return step();
            }
            misses.push(it.name);
            return step();
          });
        });
      }

      return step().then(function (res) {
        if (!res.ok) return res;

        var list = chipsOf(control);

        /* 「覆盖」语义的验收:清旧值那条若因类名漂移没点中,这里能当场看出来。
           多出来的项宁可报失败让用户核对,也不要默默追加成 棉80/丝绸20/旧值。 */
        if (list.length > items.length - misses.length) {
          return { ok: false, step: 'clear', reason: '旧值没清干净(' + list.length + ' 项)' };
        }

        /* 部分填写:能填的都已进框并把配比写好,最后统一报哪些没填(用户定稿) */
        if (misses.length) {
          var nearNote = suspects.map(function (s) {
            return '「' + s.typed + '」疑似「' + s.likely + '」的笔误';
          }).join('；');
          if (!filled.length) {
            return { ok: false, step: 'create',
              reason: '「' + misses.join('」「') + '」平台没有,未填入。未知材料走自定义直填;'
                + '直填通道不可用时请先在平台里手动添加一次该材质。' + (nearNote ? '(' + nearNote + ')' : ''),
              misses: misses };
          }
          return writeItemPercents(control, filled).then(function (rw) {
          return { ok: false, partial: true, step: 'create', misses: misses, filled: filled,
            reason: '「' + misses.join('」「') + '」平台没有,未填入;其余 ' + filled.length
              + (rw.missing.length ? ' 项已进框,部分配比未写入。' : ' 项已按配比填好。')
              + '未知材料可在平台里手动添加一次后再试。' + (nearNote ? '(' + nearNote + ')' : ''),
            suspects: suspects };
          });
        }

        return writeItemPercents(control, items).then(function (rw) {
          return rw.missing.length ? { ok: false, partial: true, step: 'percent', misses: [], filled: items,
            reason: '材料已进框,但「' + rw.missing.map(function (x) { return x.name; }).join('」「') + '」配比未写入。' }
            : { ok: true };
        });
      }).then(function (res) {
        res.suspects = res.suspects || suspects;      // 一路带出去,由 run() 决定要不要显示小红字
        return res;
      });
    });
  }

  function textWithoutExt(root) {
    var parts = [];
    var walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
      acceptNode: function (node) {
        if (node.nodeType === 1) {
          return node.hasAttribute(BOX_ATTR) || /^(SCRIPT|STYLE|BUTTON|INPUT|TEXTAREA)$/.test(node.tagName)
            ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_SKIP;
        }
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    var node;
    while ((node = walker.nextNode())) parts.push(node.nodeValue || '');
    return parts.join('\n');
  }

  /** 在「已选」面板里找与材料名同一行的配比输入框(真机 16:49 截图:
   *  面板 = 左侧搜索/字典列表 + 右侧已选,每行 = 材料名 + 「请输入」框 + %)。
   *  只在「搜索材质」框所在的**面板容器内**找 —— 页面其它任何输入框
   *  (商品标题/导购短标题等)碰都不碰,杜绝 16:26/16:48 两次写溢出。 */
  function percentRowInput(name, control) {
    var want = String(name).trim();
    if (!want) return null;
    var box = panelBox(control);
    if (!box) return null;
    if (control && box.contains(control)) return null;   // 防锚到控件自己
    var inputs = [];
    try { inputs = box.querySelectorAll('input'); } catch (e) { inputs = []; }
    var best = null;
    for (var i = 0; i < inputs.length; i++) {
      var el = inputs[i];
      var ph = String(el.getAttribute('placeholder') || '');
      if (/搜索|材质/.test(ph) || /search/i.test(String(el.className || ''))) continue;  // 面板搜索框本身
      var type = String(el.getAttribute('type') || 'text');
      if (/^(checkbox|radio|file|button|submit|hidden)$/i.test(type)) continue;
      var node = el.parentElement;
      var hops = 0;
      var hit = null;
      while (node && box.contains(node) && hops++ < 6) {
        if (node.querySelectorAll('input').length > 1) break;
        var text = textWithoutExt(node);
        // 必填红字不是材料名；只比较独立文本，仍不允许包含匹配。
        var label = node.querySelector('.aurora-dorami-composition-select-selected-label');
        var named = label ? textWithoutExt(label).split('\n').join('').trim() === want
          : text.split('\n').some(function (part) { return part.trim() === want; });
        if (named && /[%％]/.test(text)) { hit = text; break; }
        node = node.parentElement;
      }
      if (!hit) continue;
      if (!best || hit.length < best.t.length) best = { el: el, t: hit };
    }
    return best ? best.el : null;
  }

  /** 配比按完整材料名逐项写入；每次重绘后重找节点，最后回读所有值。 */
  function writeItemPercents(control, items) {
    if (!items.length) return Promise.resolve({ written: [], missing: [] });
    function target(it) {
      if (panelBox(control)) return percentRowInput(it.name, control);
      var chips = chipsOf(control);
      var inputs = percentInputs(control);
      if (chips.length !== inputs.length) return null;
      for (var i = 0; i < chips.length; i++) {
        if (chips[i].name === it.name) return inputs[i];
      }
      return null;
    }
    function ensureTarget(it) {
      var el = target(it);
      if (el) return Promise.resolve(el);
      openControl(control);
      return waitUntil(function () { return !!target(it); }, 800).then(function () { return target(it); });
    }
    function writeOne(i) {
      if (i >= items.length) return Promise.resolve();
      var it = items[i];
      return ensureTarget(it).then(function (el) {
        if (el) {
          try { el.focus(); } catch (e) { /* 不可聚焦 */ }
          nativeSet(el, String(it.pct));
          // 等受控状态重绘再失焦；同一拍 onBlur 会把新数字还原成旧值。
          return sleep(80).then(function () {
            var fresh = target(it);
            if (fresh) {
              try { fresh.blur(); fresh.dispatchEvent(new Event('focusout', { bubbles: true })); } catch (e) { /* 老内核 */ }
            }
            return sleep(80);
          });
        }
      }).then(function () { return writeOne(i + 1); });
    }
    return writeOne(0).then(function () {
      // 失焦可能关闭浮层，隐藏面板的 DOM 仍是旧值；重开后再验收。
      return ensureTarget(items[0]);
    }).then(function () {
      return waitUntil(function () {
        return items.every(function (it) {
          var el = target(it);
          return el && el.value.trim() !== '' && Number(el.value) === it.pct;
        });
      }, 600);
    }).then(function () {
      var written = [], missing = [];
      items.forEach(function (it) {
        var el = target(it);
        (el && el.value.trim() !== '' && Number(el.value) === it.pct ? written : missing).push(it);
      });
      log('智能填写:配比回读 ' + written.length + '/' + items.length + ' 项'
        + (missing.length ? ' · 未写入:' + missing.map(function (it) { return it.name; }).join('、') : ''));
      return { written: written, missing: missing };
    });
  }

  /* ==========================================================
   * 五、一次点击的完整流程
   * ========================================================== */

  function run(input, btn) {
    if (busy) return;
    var raw = String((input && input.value) || '').trim();
    var parsed = parseMaterials(raw);

    if (!parsed.ok) {
      var tip = parsed.reason;
      if (/不是 100%/.test(tip)) {
        say('配比合计不是 100%', 'alert', '未填入', tip + '。请把各项配比调整到合计 100% 再点一次。');
      } else if (/还没输入/.test(tip)) {
        say('请先填面料配比', 'warning', '', '在上面那个框里写「材料+含量」，合计 100%。例：棉80 丝绸20');
      } else {
        say('配比没看懂', 'alert', '未填入', tip + '。例:棉80 丝绸20(合计 100%)。');
      }
      return;
    }

    var control = (lastControl && document.contains(lastControl)) ? lastControl : findControl();
    if (!control) {
      say('没找到面料材质框', 'alert', '未填入',
        '本页没找到「面料材质」控件(可能还没展开或平台改了结构)。请把这一句发给开发者。');
      return;
    }

    busy = true;
    if (btn) { btn.disabled = true; btn.textContent = '填写中…'; }

    var label = parsed.items.map(function (x) { return x.name + x.pct + '%'; }).join(' ');

    showHint(null);      // 每次开跑先清掉上一次的红字

    applyItems(control, parsed.items).then(function (res) {
      /* 疑似笔误只影响提示:直填成功时材料按原样写入,提示「仍按你写的写入」;
         失败时(比如相近项没敢勾)那句就不成立,红字不显示,原因走失败消息。 */
      showHint(res && res.ok ? res.suspects : null);
      if (res.ok) {
        say(label, 'success', '已填入 ' + parsed.items.length + ' 项');
        log('智能填写:完成 ' + label);
      } else if (res.partial) {
        /* 用户 2026-11-08:能填的都填上,最后再报错 —— 部分填写算「带缺口的完成」 */
        var missNames = res.misses || [];
        var okCount = parsed.items.length - missNames.length;
        if (!missNames.length) {
          /* 材料全进了、只有配比没写上(平台逐项必填) */
          say('配比未写入', 'alert', '材料已进框',
            res.reason + ' 已进框:' + (res.filled || []).map(function (x) { return x.name + x.pct + '%'; }).join(' ')
            + '。请核对原生框并补好配比后再保存。');
        } else {
          say('「' + missNames.join('」「') + '」未填入', 'alert', '已填 ' + okCount + '/' + parsed.items.length + ' 项',
            res.reason + ' 已填入的 ' + okCount + ' 项:' + (res.filled || []).map(function (x) { return x.name + x.pct + '%'; }).join(' ')
            + '。请核对原生框后再保存。');
        }
        log('智能填写:部分完成 · ' + res.reason);
      } else {
        say(res.reason, 'alert', '未填入', '智能填写中断于「' + (res.step || '未知') + '」这一步:' + res.reason +
          '。原生框里可能已有部分内容,请核对后再保存。');
        log('智能填写:失败于 ' + res.step + ' · ' + res.reason);
        /* 失败时把控件真实类名打进调试日志 —— 下一轮校准不用再导页面结构 */
        log('智能填写:控件结构 ' + signature(control));
      }
    }).catch(function (e) {
      say('填写出错', 'alert', '未填入', (e && e.message) || String(e));
      log('智能填写异常:' + ((e && e.message) || e));
    }).then(function () {
      busy = false;
      if (btn) { btn.disabled = false; btn.textContent = '智能填写'; }
      scheduleScan(800);
    });
  }

  /* ==========================================================
   * 六、开关与生命周期
   * ========================================================== */

  var mountTries = 0;
  var retryTimer = 0;

  function mountedBox() {
    try { return document.querySelector('[' + BOX_ATTR + ']'); } catch (e) { return null; }
  }

  /** 一句能进诊断时间线的成因说明:卡在哪一步、平台有没有那几样东西 */
  function diagnose() {
    var form = null;
    var text = '';
    try { form = document.getElementById('goodsEditScrollContainer') || document.body; text = form.textContent || ''; } catch (e) { text = ''; }
    var label = false;
    try { label = !!findLabelNode(); } catch (e) { label = false; }
    var combos = 0;
    try { combos = document.querySelectorAll('[class*="composition-select"]').length; } catch (e) { combos = -1; }
    var inputs = 0;
    try { inputs = (form || document).querySelectorAll('input, [role="combobox"]').length; } catch (e) { inputs = -1; }
    return '标签' + (label ? '✓' : '✗')
      + ' · composition 候选' + combos
      + ' · 表单里有「%」' + (text.indexOf('%') >= 0 ? '✓' : '✗')
      + ' · 可交互控件' + inputs
      + ' · 表单文字' + text.length;
  }

  /**
   * 挂载 + 重试(2026-11-08 真机第二次踩到「页面上什么都没有」)。
   *
   * 教训:上一版把 mount() 直接写在 dycReadFlags().then 里 ——
   *   · 表单是异步渲染的,首拍常常还没有「面料材质」这一行 ⇒ 什么也不挂;
   *   · 一旦这里抛异常,整个 then 链 rejects ⇒ **观察器也建不起来**,
   *     之后页面怎么变都不会再试第二次,表现就是「功能静默消失」。
   * 现在:观察器先建好;挂载失败不抛;没挂上按 500ms 重试(最多 20 次 ≈ 10 秒);
   * 彻底挂不上时留一句可诊断的日志(它会出现在诊断报告的时间线里)。
   */
  function safeMount() {
    try {
      mount();
    } catch (e) {
      log('智能填写:挂载异常 ' + ((e && e.message) || e));
    }

    if (mountedBox()) {
      if (mountTries > 0) log('智能填写:已挂载(重试 ' + mountTries + ' 次后)');
      mountTries = 0;
      return;
    }

    mountTries++;
    if (mountTries === 1) log('智能填写:还没找到控件 ' + diagnose());
    /* 20 秒(40 × 500ms):本页表单是分块渲染的,类目属性往往在图片/价格之后才出来 */
    if (mountTries > 40) {
      log('智能填写:20 秒内没出现「面料材质」这一行 ' + diagnose());
      return;
    }
    if (retryTimer) clearTimeout(retryTimer);
    retryTimer = setTimeout(function () {
      retryTimer = 0;
      if (on) safeMount();
    }, 500);
  }

  function boot() {
    if (on) {
      /* 观察器先于挂载建立:挂载抛错也不会让后续变更无人处理 */
      if (!observer) {
        observer = new MutationObserver(function () { scheduleScan(500); });
        observer.observe(document.body || document.documentElement, { childList: true, subtree: true });
      }
      mountTries = 0;
      safeMount();
    } else {
      if (observer) { observer.disconnect(); observer = null; }
      if (retryTimer) { clearTimeout(retryTimer); retryTimer = 0; }
      unmount();
    }
  }

  dycReadFlags().then(function (f) {
    on = !f || f.fabricSmartFill !== false;
    if (on) log('智能填写:已启用');
    boot();
  });

  dycWatchFlags(function (f) {
    var next = !f || f.fabricSmartFill !== false;
    if (next === on) return;
    on = next;
    log('智能填写:' + (on ? '已启用' : '已停用'));
    boot();
  });

  /* 自测用:解析器单独暴露,断言不必造 DOM */
  window.__dycParseFabric = parseMaterials;
})();
