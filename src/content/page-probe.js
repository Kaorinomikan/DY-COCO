/**
 * 页面结构探针(2026-10-16 新增)
 *
 * 用途:把「目标页面长什么样」导出成一份报告,交给助手去写适配代码。
 *
 * 与 diag.js 的分工(两者互补,不要混):
 *   diag.js      —— 「扩展自身」的健康档案(自己的控件挂载 / 报错 / 轨迹)
 *   本文件        —— 「目标页面」的结构档案(页面的 DOM 骨架 / 列表容器 / 交互元素)
 *   diag.js 的 collectWidgets 只扫 `[id^="dyb-"]` 这类扩展自己的节点,
 *   对「适配一个新页面」毫无帮助 —— 那正是本文件存在的理由。
 *
 * ★ 运行方式:由弹窗按需注入(chrome.scripting.executeScript),**不进 manifest
 *   的 content_scripts** —— 所以它在任何抖店页面上都不常驻,零日常开销。
 *
 * ★ 三条硬约束
 *   ① 只采结构、不采内容 —— 列表项内的文本(商品名/价格/库存)一律不取,
 *      只记**字符长度**;按钮与标签的文本例外(截断 20 字),因为
 *      「<button>编辑</button>」这类线索是适配时最有用的信息,且不含经营数据。
 *   ② 全部有上限 —— 骨架 200 节点 / 候选容器 10 个 / 交互元素 40 个 /
 *      TreeWalker 最多走 20000 个节点 / 被截断文本 24 个 / 报告 48KB。
 *   ③ 只读不写 —— 不滚动页面(会改变用户浏览位置)、不点击、不改 DOM。
 *      虚拟滚动只做**静态判定**(看行元素是否绝对定位),不实际滚动列表。
 *   ④ 穿透 open shadow root 与同源 iframe(2026-10-31 新增)—— 微前端页面
 *      (如微信小店的 micro-app)业务内容要么在 shadow 里、要么在 about:blank
 *      的 iframe 里,不穿透等于什么都采不到。closed shadow 与跨域 iframe 读不到,
 *      报告里会如实写成「只有壳 / 读不到」,不假装成功。
 *
 * ★ 结果回传:采完通过 chrome.runtime.sendMessage 发给弹窗
 *   (executeScript 对 files 形式的返回值不可靠,所以不走返回值这条路)。
 */
(function () {
  'use strict';

  // 防重入:用户连点按钮时,第二次注入直接跳过
  if (window.__dycProbeRunning) return;
  window.__dycProbeRunning = true;

  /* ---------- 上限 ---------- */
  var MAX_SKELETON = 200;      // 骨架节点总上限
  var PER_LEVEL = 40;          // 骨架每层节点上限
  var SKELETON_DEPTH = 3;      // 骨架展开层数
  var MAX_CANDIDATES = 10;     // 候选列表容器上限
  var MAX_ACTIONS = 40;        // 关键交互元素上限
  var MAX_TREE = 20000;        // TreeWalker 最多走的节点数
  var TEXT_MAX = 20;           // 按钮文本截断长度
  var TITLE_MAX = 60;
  var REPORT_MAX = 48 * 1024;  // 报告体积上限(字符数)

  /* ---------- 小工具 ---------- */

  function clamp(s, n) {
    s = (s === null || s === undefined) ? '' : String(s);
    return s.length > n ? s.slice(0, n) + '…' : s;
  }

  function safe(fn, fb) {
    try { return fn(); } catch (e) { return fb; }
  }

  /** 元素是否属于扩展自身注入的节点(骨架里要排除,否则报告里全是自己) */
  function isExtNode(el) {
    if (!el || el.nodeType !== 1) return false;
    if (/^dy[bc]-/.test(el.id || '')) return true;
    var cl = classOf(el);
    for (var i = 0; i < cl.length; i++) {
      if (/^dy[bc]-/.test(cl[i])) return true;
    }
    return false;
  }

  /** 取 class 列表 —— 用 getAttribute 而非 el.className,SVG 元素的 className 是对象 */
  function classOf(el) {
    var c = safe(function () { return el.getAttribute('class'); }, '') || '';
    return String(c).trim().split(/\s+/).filter(function (x) { return x; });
  }

  /** 元素标识:tag + #id + 前 3 个 class。id 里的长数字串打码(可能是店铺/商品 ID) */
  function tag(el) {
    var t = el.tagName.toLowerCase();
    var id = el.id || '';
    if (id) id = id.replace(/\d{5,}/g, '***');
    var cl = classOf(el).slice(0, 3);
    return t + (id ? '#' + id : '') + (cl.length ? '.' + cl.join('.') : '');
  }

  /** 结构签名:tag + 前 2 个 class —— 用来判断一组子元素是否「长得一样」 */
  function sigOf(el) {
    var cl = classOf(el).slice(0, 2);
    return el.tagName.toLowerCase() + (cl.length ? '.' + cl.join('.') : '');
  }

  /** 文本长度(**不取内容**)。用 textContent 而不是 innerText:
   *  innerText 会触发一次布局计算,遍历里用它代价太高。 */
  function txtLen(el) {
    return safe(function () { return (el.textContent || '').replace(/\s+/g, ' ').trim().length; }, 0);
  }

  function rectOf(el) {
    return safe(function () {
      var r = el.getBoundingClientRect();
      return [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)];
    }, null);
  }

  /** URL 脱敏:保留 host + path,query/hash 的值一律打码 */
  function scrub(u) {
    try {
      var s = String(u || '');
      var cut = s.length;
      var qi = s.indexOf('?');
      var hi = s.indexOf('#');
      if (qi >= 0 && qi < cut) cut = qi;
      if (hi >= 0 && hi < cut) cut = hi;
      return clamp(s.slice(0, cut) + (cut < s.length ? '?***' : ''), 200);
    } catch (e) { return '(unavailable)'; }
  }

  /* ---------- 深度查询:穿透 open shadow root ----------
   *
   * 2026-10-31 新增。微信小店是 **micro-app 微前端**:业务页面挂在
   * `<micro-app>` 元素的 shadow root 里,顶层 document 只剩左侧菜单和壳。
   * 旧版全走 document.querySelectorAll,在那类页面上采出来的「候选列表容器」
   * 清一色是菜单(实测:7 个候选容器、40 个交互元素,全是 a.menu-sub-item),
   * 真正的商品表格一个字都看不到 —— 用户要适配商品列表时等于没有依据。
   *
   * 这里给出「普通后代 + open shadowRoot 后代」的统一遍历:
   *   · closed 模式的 shadow root 读不到,如实反映能力边界(不假装能采)
   *   · 带节点预算,商品列表几千行时也不会把页面拖死
   *
   * ⚠️ shadow 内元素的 getBoundingClientRect 仍是**视口坐标**,可直接用;
   *    但将来写功能时记住:manifest 里的 content css **不会**穿透 shadow root,
   *    要改里面的样式必须往 shadowRoot 里插 <style>。
   */
  var SHADOW_DEPTH = 6;        // 最多下潜几层 shadow / 同源 iframe
  var NODE_BUDGET = 20000;     // 一次深度遍历的节点预算

  /** 取同源 iframe 的 document;跨域会抛 SecurityError,这里吞掉返回 null */
  function iframeDocOf(fr) {
    try {
      var d = fr.contentDocument || (fr.contentWindow && fr.contentWindow.document);
      return d && d.body ? d : null;
    } catch (e) { return null; }
  }

  function deepQuery(pred, limit) {
    var out = [];
    var budget = NODE_BUDGET;

    (function walk(node, depth) {
      if (!node || budget <= 0 || out.length >= limit) return;
      var kids = node.children;
      if (!kids) return;
      for (var i = 0; i < kids.length; i++) {
        if (budget <= 0 || out.length >= limit) return;
        budget--;
        var el = kids[i];
        if (isExtNode(el)) continue;
        if (pred(el)) out.push(el);
        if (depth < SHADOW_DEPTH && el.shadowRoot) walk(el.shadowRoot, depth + 1);
        // 同源 iframe 也要进去(2026-10-31 补):micro-app 除了 shadow 沙箱,
        // 还有 iframe 沙箱 —— 内容在一个 about:blank 的 document 里(同源可读)。
        // 只穿透 shadow 会整块漏掉。跨域的读不到,如实跳过,不假装成功。
        if (depth < SHADOW_DEPTH && el.tagName === 'IFRAME') {
          var idoc = iframeDocOf(el);
          if (idoc) walk(idoc.body, depth + 1);
        }
        walk(el, depth);
      }
    })(document.body, 0);

    return out;
  }

  /** 生成一段能直接照着写选择器的路径;跨 shadow 边界处用 ▸ 标出 */
  function cssPath(el) {
    var parts = [];
    var node = el;
    var guard = 0;
    while (node && node.nodeType === 1 && guard < 5) {
      guard++;
      var s = node.tagName.toLowerCase();
      var cls = classOf(node).slice(0, 2);
      if (cls.length) s += '.' + cls.join('.');
      parts.unshift(s);
      var p = node.parentNode;
      if (p && p.nodeType === 11 && p.host) {     // ShadowRoot —— 边界
        parts.unshift('▸');
        node = p.host;
      } else {
        node = node.parentElement;
      }
    }
    return parts.join('>').replace(/>▸>/g, '▸');
  }

  /* ---------- 一、页面骨架 ---------- */

  function collectSkeleton() {
    var out = [];
    var level = [document.body];
    for (var d = 0; d < SKELETON_DEPTH && level.length && out.length < MAX_SKELETON; d++) {
      var next = [];
      for (var i = 0; i < level.length && out.length < MAX_SKELETON; i++) {
        var el = level[i];
        if (!el || el.nodeType !== 1 || isExtNode(el)) continue;
        var r = rectOf(el);
        out.push({
          d: d,
          // 有 shadow / iframe 的元素标出来:微前端的业务内容就藏在这下面,
          // 不标的话看报告的人会以为「页面就这么点东西」
          t: tag(el) + (el.shadowRoot ? '▸shadow' : '') + (el.tagName === 'IFRAME' ? '▸iframe' : ''),
          n: el.children.length,
          w: r ? r[2] : 0,
          h: r ? r[3] : 0
        });
        for (var j = 0; j < el.children.length && next.length < PER_LEVEL; j++) {
          next.push(el.children[j]);
        }
        // shadow root 的子元素并进下一层(2026-10-31 新增) —— 不展开的话,
        // 微前端页面(微信小店 / 未来其它 micro-app 站点)骨架永远只到壳。
        if (el.shadowRoot) {
          var sk = el.shadowRoot.children;
          for (var m = 0; m < sk.length && next.length < PER_LEVEL; m++) {
            next.push(sk[m]);
          }
        }
        // 同源 iframe 的 body 也展开一层(2026-10-31) —— micro-app 的 iframe 沙箱
        // 会把整页业务 DOM 放进 about:blank 的 document。
        if (el.tagName === 'IFRAME') {
          var idoc = iframeDocOf(el);
          if (idoc && next.length < PER_LEVEL) next.push(idoc.body);
        }
      }
      level = next;
    }
    return out;
  }

  /* ---------- 二、候选列表容器 ---------- */

  /**
   * 找「商品列表」这类容器。判据两条:
   *   ① 直接子元素 ≥ 8(一行一个,数量够多)
   *   ② 结构重复度 ≥ 70%(子元素的 tag+class 组合高度雷同)
   * 抖店的商品行、直播列表行都符合这两条;普通布局容器不符合。
   */
  function collectCandidates() {
    var all = safe(function () {
      return deepQuery(function (el) {
        var t = el.tagName;
        return t === 'DIV' || t === 'UL' || t === 'OL' || t === 'TBODY' || t === 'SECTION';
      }, 6000);
    }, null);
    if (!all) return [];

    var found = [];
    for (var i = 0; i < all.length; i++) {
      var el = all[i];
      if (isExtNode(el)) continue;

      var ch = el.children;
      if (ch.length < 8) continue;

      var counts = {};
      var topSig = '';
      var top = 0;
      for (var j = 0; j < ch.length; j++) {
        var s = sigOf(ch[j]);
        counts[s] = (counts[s] || 0) + 1;
        if (counts[s] > top) { top = counts[s]; topSig = s; }
      }
      var ratio = top / ch.length;
      if (ratio < 0.7) continue;

      found.push({ el: el, n: ch.length, ratio: ratio, sig: topSig });
    }

    // 子元素多且重复度高的排前面
    found.sort(function (a, b) { return (b.n * b.ratio) - (a.n * a.ratio); });
    return found.slice(0, MAX_CANDIDATES);
  }

  /* ---------- 三、行结构样本 ---------- */

  /**
   * 取「真实行」当样本 —— 不能直接用 children[0]。
   *
   * 【2026-11-07 真机教训】auxo-table 的 tbody 第一个子元素是
   * `tr.auxo-table-measure-row`(高 0、只放 10 个空 td 量列宽)。直接取首元素,
   * 采到的永远是测量行 —— 报告里"行结构"全是 0×0 的 td,真实商品行一次都没采到。
   * 后果是照这份结构改代码必然打不中,还自以为有结构依据。
   * 判据:优先 tagName === 'TR' 且实测高度 > 8 的元素;退而求其次取第一个
   * 有尺寸的子元素。measure-row 的类名/size 任一命中都跳过。
   */
  function pickRealRow(container) {
    var kids = container.children || [];
    var limit = Math.min(kids.length, 40);
    var firstSized = null;
    for (var i = 0; i < limit; i++) {
      var el = kids[i];
      if (!el || !el.tagName) continue;
      if (el.classList && el.classList.contains('auxo-table-measure-row')) continue;
      var r = rectOf(el);
      var h = r ? r[3] : 0;
      if (h > 8) {
        if (el.tagName === 'TR') return el;
        if (!firstSized) firstSized = el;
      }
    }
    return firstSized || kids[0] || null;
  }

  function collectRowSample(container) {
    var first = pickRealRow(container);
    if (!first) return [];

    // 展开 4 层:真实商品行是 tr>td>div>div>div(名称在第 5 层),
    // 只展开 2 层的话连名称元素都看不到 —— 2026-11-07 起放宽。
    var out = [];
    (function walk(el, d) {
      if (d > 3 || out.length >= 60) return;
      var r = rectOf(el);
      out.push({
        d: d,
        t: tag(el),
        w: r ? r[2] : 0,
        h: r ? r[3] : 0,
        len: txtLen(el)          // ← 只记长度,不记内容
      });
      for (var i = 0; i < el.children.length && i < 12; i++) {
        walk(el.children[i], d + 1);
      }
    })(first, 0);

    return out;
  }

  /* ---------- 四、关键交互元素 ---------- */

  function collectActions() {
    var all = safe(function () {
      return deepQuery(function (el) {
        var t = el.tagName;
        return t === 'BUTTON'
          || el.getAttribute('role') === 'button'
          || (t === 'A' && el.hasAttribute('href'));
      }, 3000);
    }, null);
    if (!all) return [];

    var out = [];
    var seen = {};
    for (var i = 0; i < all.length && out.length < MAX_ACTIONS; i++) {
      var el = all[i];
      if (isExtNode(el)) continue;

      var r = rectOf(el);
      if (!r || (r[2] === 0 && r[3] === 0)) continue;   // 不可见的不要

      // 按钮/标签文本是适配的关键线索(截断 20 字),但列表项内的商品名不走这里 ——
      // 它们不是 button / [role=button] / a[href],不会被本函数采到。
      var label = safe(function () {
        return (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
      }, '');

      var key = tag(el) + '|' + label.slice(0, TEXT_MAX);
      if (seen[key]) continue;
      seen[key] = 1;

      out.push({
        t: tag(el),
        s: clamp(label, TEXT_MAX),
        x: r[0],
        y: r[1]
      });
    }
    return out;
  }

  /* ---------- 五、环境特性 ---------- */

  // 主题前缀:抖店不同页面/不同子应用用不同的组件库前缀,
  // 知道用哪套前缀,写选择器时就能少走弯路。
  var PREFIXES = ['aurora-', 'ecom-', 'semi-', 'arco-', 'ant-', 'byte-'];

  /** 数一棵子树(含嵌套 shadow)的节点数,只用于给「页面元素总数」补上 shadow 内的部分 */
  function countNodes(root, cap) {
    var c = 0;
    (function walk(node) {
      var kids = node && node.children;
      if (!kids) return;
      for (var i = 0; i < kids.length; i++) {
        if (c >= cap) return;
        c++;
        if (kids[i].shadowRoot) walk(kids[i].shadowRoot);
        walk(kids[i]);
      }
    })(root);
    return c;
  }

  function scanTree() {
    var res = { total: 0, shadow: [], shadowNodes: 0, iframeNodes: 0, iframeBlocked: 0, prefix: {} };

    if (typeof document.createTreeWalker !== 'function') return res;

    var walker;
    try {
      walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT, null);
    } catch (e) { return res; }

    var n = walker.currentNode;
    while (n && res.total < MAX_TREE) {
      res.total++;

      if (isExtNode(n)) { n = walker.nextNode(); continue; }

      // 影子 DOM:open 模式才看得到,closed 的读不出来(如实反映能力边界)
      // 2026-10-31:除了记名字,还把 shadow 内节点数并入总数 —— 否则微前端页面上
      // 「页面元素总数」会严重低估(壳 591 个 / 里面可能上万个)。
      if (n.shadowRoot && res.shadow.length < 10) {
        res.shadow.push(tag(n));
        res.shadowNodes += countNodes(n.shadowRoot, 5000);
      }

      // 同源 iframe 的节点数同样并入总数,跨域的记一笔「读不到」
      if (n.tagName === 'IFRAME') {
        var ifdoc = iframeDocOf(n);
        if (ifdoc) res.iframeNodes += countNodes(ifdoc.body, 5000);
        else res.iframeBlocked++;
      }

      // 主题前缀计数
      var cl = classOf(n);
      for (var i = 0; i < cl.length; i++) {
        for (var p = 0; p < PREFIXES.length; p++) {
          if (cl[i].indexOf(PREFIXES[p]) === 0) {
            res.prefix[PREFIXES[p]] = (res.prefix[PREFIXES[p]] || 0) + 1;
            break;
          }
        }
      }

      // ⚠️ 这里**故意不读 clientHeight / scrollHeight** ——
      //    本循环最多走 20000 个节点,逐个读尺寸会放大成两万次布局读取。
      //    可滚动容器改由 collectScrollables() 沿候选容器的祖先链去找,
      //    范围从「全页」缩到「几十个元素」,既快又准。
      n = walker.nextNode();
    }
    return res;
  }

  /** 尺寸读取统一走这里 —— 把布局读取收在一处,循环里只做判断与累加 */
  function scrollSizeOf(el) {
    return { h: el.clientHeight, s: el.scrollHeight };
  }

  /**
   * 可滚动容器 —— 沿候选列表容器的**祖先链**往上找。
   *
   * 为什么不遍历全页:抖店页面节点上万,逐个读尺寸会拖慢这次采集;
   * 而「列表的滚动容器」几乎必然就是它自己的某个祖先,沿链找既快又准。
   * 深度上限 12 层,最多产出 10 个。
   */
  function collectScrollables(candidates) {
    var out = [];
    var seen = {};
    candidates.forEach(function (c) {
      var el = c.el;
      var depth = 0;
      while (el && el !== document.documentElement && depth < 12) {
        var t = tag(el);
        if (!seen[t]) {
          seen[t] = 1;
          var sz = scrollSizeOf(el);
          if (sz.h > 0 && sz.s > sz.h + 200) {
            out.push({ t: t, sh: sz.s, ch: sz.h });
          }
        }
        el = el.parentElement;
        depth++;
      }
    });
    return out.slice(0, 10);
  }

  function collectIframes() {
    var all = safe(function () {
      return deepQuery(function (el) { return el.tagName === 'IFRAME'; }, 10);
    }, null);
    if (!all) return [];
    var out = [];
    for (var i = 0; i < all.length && i < 10; i++) {
      var fr = all[i];
      // 2026-10-31:多记一个「读不读得到」—— micro-app 的 iframe 沙箱是
      // about:blank 同源文档,能读;跨域广告位之类读不到,报告里要说清楚,
      // 免得看报告的人以为页面里真的没有东西。
      out.push({
        src: scrub(safe(function () { return fr.src; }, '')),
        readable: !!iframeDocOf(fr)
      });
    }
    return out;
  }

  /* ---------- 五之二、被截断的文本元素 ----------
   *
   * 2026-10-31 新增。起因:用户要「商品列表完整显示商品全名」,而「截断」
   * 至少有五种常见写法(line-clamp / ellipsis+nowrap / 固定 max-height /
   * overflow:hidden / 定宽+省略),只看骨架根本看不出是哪一种 ——
   * 猜错一种,解出来的样式就完全不生效。
   *
   * 这一段把「谁被截断了、被哪条规则截断」直接量出来,写解除截断的样式时
   * 不用猜。判据(任一成立即记):
   *   ① -webkit-line-clamp 是数字
   *   ② text-overflow: ellipsis 且 scrollWidth > clientWidth + 1
   *   ③ white-space: nowrap   且 scrollWidth > clientWidth + 1
   *   ④ overflowY 不是 visible 且 scrollHeight > clientHeight + 2
   *
   * 只读不写;每项只记**文本长度**,不记内容(与全文件口径一致)。
   */
  var MAX_CLIPPED = 24;

  function clippedReason(el, cs) {
    var reasons = [];
    var lc = '';
    try { lc = String(cs.webkitLineClamp || cs.getPropertyValue('-webkit-line-clamp') || '').trim(); } catch (e) {}
    if (/^\d+$/.test(lc)) reasons.push('line-clamp:' + lc);
    var sx = el.scrollWidth, cx = el.clientWidth;
    var sy = el.scrollHeight, cy = el.clientHeight;
    if (cs.textOverflow === 'ellipsis' && sx > cx + 1) reasons.push('ellipsis');
    if (cs.whiteSpace === 'nowrap' && sx > cx + 1) reasons.push('nowrap');
    if (cs.overflowY !== 'visible' && sy > cy + 2) reasons.push('overflowY:' + cs.overflowY);
    return reasons;
  }

  function collectClipped() {
    var all = safe(function () {
      return deepQuery(function (el) {
        // 只挑「自己带文本节点」的元素,避免把纯容器算进来
        return el.childNodes && el.childNodes.length > 0;
      }, 9000);
    }, []);
    var out = [];
    for (var i = 0; i < all.length && out.length < MAX_CLIPPED; i++) {
      var el = all[i];
      var r = rectOf(el);
      if (!r || r[2] === 0 || r[3] === 0) continue;
      if (txtLen(el) < 6) continue;              // 太短的多半不是标题
      var cs = safe(function () { return getComputedStyle(el); }, null);
      if (!cs) continue;
      var why = clippedReason(el, cs);
      if (!why.length) continue;
      out.push({
        path: cssPath(el),
        w: r[2], h: r[3],
        cw: el.clientWidth, sw: el.scrollWidth,
        ch: el.clientHeight, sh: el.scrollHeight,
        len: txtLen(el),
        why: why.join(' + ')
      });
    }
    return out;
  }

  /* ---------- 六、虚拟滚动静态判定 ---------- */

  /** 只读静态样式,不滚动页面 —— 滚动会改变用户当前的浏览位置,不能干。 */
  /** 单个元素的定位特征(把 getComputedStyle 收在一处,循环里只做累加) */
  function layoutKind(el) {
    var cs = safe(function () { return getComputedStyle(el); }, null);
    if (!cs) return { abs: false, trans: false };
    return {
      abs: cs.position === 'absolute' || cs.position === 'fixed',
      trans: !!(cs.transform && cs.transform !== 'none')
    };
  }

  function virtualHint(container) {
    var ch = container.children;
    var n = Math.min(ch.length, 20);
    var abs = 0;
    var trans = 0;
    for (var i = 0; i < n; i++) {
      var k = layoutKind(ch[i]);
      if (k.abs) abs++;
      if (k.trans) trans++;
    }
    return { n: n, abs: abs, trans: trans };
  }

  /* ---------- 报告渲染 ---------- */

  function kindOf() {
    return safe(function () {
      var pat = window.DYC_PAGE_PATTERNS;
      if (!pat) return 'unknown';
      for (var k in pat) {
        if (pat[k] && pat[k].test && pat[k].test(location.href)) return k;
      }
      return 'other';
    }, 'unknown');
  }

  function buildReport() {
    var L = [];

    var skeleton = safe(collectSkeleton, []);
    var candidates = safe(collectCandidates, []);
    var actions = safe(collectActions, []);
    var tree = safe(scanTree, { total: 0, shadow: [], prefix: {} });
    var scrollables = safe(function () { return collectScrollables(candidates); }, []);
    var iframes = safe(collectIframes, []);
    var clipped = safe(collectClipped, []);

    var ver = safe(function () { return chrome.runtime.getManifest().version; }, '?');

    L.push('# DY-COCO 页面结构报告');
    L.push('');
    L.push('**一句话**:' + kindOf()
      + ' · v' + ver
      + ' · 骨架 ' + skeleton.length + ' 节点'
      + ' · 候选列表容器 ' + candidates.length + ' 个'
      + ' · 交互元素 ' + actions.length + ' 个'
      + ' · 被截断文本 ' + clipped.length + ' 个'
      + ' · 页面元素总数约 ' + (tree.total + (tree.shadowNodes || 0) + (tree.iframeNodes || 0)));
    L.push('');
    L.push('- 地址:' + scrub(location.href));
    L.push('- 标题:' + clamp(safe(function () { return document.title; }, ''), TITLE_MAX));
    L.push('- 视口:' + window.innerWidth + ' × ' + window.innerHeight + ' @' + (window.devicePixelRatio || 1) + 'x');
    L.push('- 文档高度:' + safe(function () { return document.documentElement.scrollHeight; }, 0));
    L.push('');

    /* ---- 一、页面骨架 ---- */
    L.push('## 一、页面骨架(前 ' + SKELETON_DEPTH + ' 层)');
    if (!skeleton.length) {
      L.push('(未取到)');
    } else {
      skeleton.forEach(function (s) {
        L.push('  '.repeat(s.d) + '- `' + s.t + '` · ' + s.n + ' 子 · '
          + s.w + '×' + s.h);
      });
    }
    L.push('');

    /* ---- 二、候选列表容器 ---- */
    L.push('## 二、候选列表容器(' + candidates.length + ' 个)');
    if (!candidates.length) {
      L.push('(没找到结构重复的容器 —— 可能页面还没渲染出列表,或列表行结构差异较大)');
    } else {
      L.push('| 容器 | 子元素 | 重复度 | 行签名 | 尺寸 | 虚拟滚动线索 |');
      L.push('|---|---|---|---|---|---|');
      candidates.forEach(function (c) {
        var r = rectOf(c.el);
        var vh = virtualHint(c.el);
        var hint = (vh.abs || vh.trans)
          ? ('疑似(绝对定位 ' + vh.abs + ' / transform ' + vh.trans + ')')
          : '未发现';
        L.push('| `' + tag(c.el) + '` | ' + c.n + ' | ' + Math.round(c.ratio * 100) + '%'
          + ' | `' + c.sig + '` | ' + (r ? r[2] + '×' + r[3] : '-') + ' | ' + hint + ' |');
      });
    }
    L.push('');

    /* ---- 三、行结构样本 ---- */
    L.push('## 三、行结构样本(各候选容器的首个真实行,展开 4 层)');
    if (!candidates.length) {
      L.push('(无候选容器)');
    } else {
      candidates.slice(0, 3).forEach(function (c, idx) {
        L.push('### 容器 ' + (idx + 1) + ':`' + tag(c.el) + '`');
        var rows = collectRowSample(c.el);
        if (!rows.length) {
          L.push('(取不到真实行 —— 容器里没有带高度的子元素)');
        } else {
          rows.forEach(function (r) {
            L.push('  '.repeat(r.d) + '- `' + r.t + '` · ' + r.w + '×' + r.h
              + ' · 文本 ' + r.len + ' 字');
          });
        }
        L.push('');
      });
    }
    L.push('');

    /* ---- 四、关键交互元素 ---- */
    L.push('## 四、关键交互元素(' + actions.length + ' 个,最多 40)');
    if (!actions.length) {
      L.push('(无)');
    } else {
      L.push('| 元素 | 文本 | 位置 |');
      L.push('|---|---|---|');
      actions.forEach(function (a) {
        L.push('| `' + a.t + '` | ' + (a.s || '(无文本)') + ' | [' + a.x + ',' + a.y + '] |');
      });
    }
    L.push('');

    /* ---- 五、环境特性 ---- */
    L.push('## 五、环境特性');
    L.push('- 页面元素总数:约 ' + (tree.total + (tree.shadowNodes || 0) + (tree.iframeNodes || 0))
      + (tree.total >= MAX_TREE ? '(顶层已达扫描上限,实际更多)' : '')
      + (tree.shadowNodes ? ',其中 shadow 内 ' + tree.shadowNodes + ' 个' : '')
      + (tree.iframeNodes ? '、同源 iframe 内 ' + tree.iframeNodes + ' 个' : ''));
    L.push('- iframe:' + (iframes.length
      ? iframes.length + ' 个 → ' + iframes.map(function (f) {
        return (f.src || '(about:blank)') + (f.readable ? '【同源可读,已并入采集】' : '【跨域,读不到】');
      }).join(' / ')
      : '无'));
    L.push('- 影子 DOM host:' + (tree.shadow.length ? tree.shadow.join(' / ') : '未发现(closed 模式读不到)'));
    var pk = Object.keys(tree.prefix);
    if (pk.length) {
      pk.sort(function (a, b) { return tree.prefix[b] - tree.prefix[a]; });
      L.push('- 组件库前缀:' + pk.map(function (k) {
        return k + ' ×' + tree.prefix[k];
      }).join(' / '));
    } else {
      L.push('- 组件库前缀:未识别');
    }
    if (scrollables.length) {
      L.push('- 可滚动容器:');
      scrollables.forEach(function (s) {
        L.push('  - `' + s.t + '` · 内容高 ' + s.sh + ' / 可见高 ' + s.ch);
      });
    } else {
      L.push('- 可滚动容器:未发现(整页滚动)');
    }
    L.push('');

    /* ---- 六、被截断的文本元素 ---- */
    L.push('## 六、被截断的文本元素(' + clipped.length + ' 个,最多 ' + MAX_CLIPPED + ')');
    if (!clipped.length) {
      L.push('(没找到被截断的文本 —— 可能列表还没渲染,或截断靠 JS 写内联宽度)');
    } else {
      L.push('| 元素路径 | 盒子 | 文本宽/可见宽 | 文本高/可见高 | 字数 | 截断来源 |');
      L.push('|---|---|---|---|---|---|');
      clipped.forEach(function (c) {
        L.push('| `' + c.path + '` | ' + c.w + '×' + c.h
          + ' | ' + c.sw + '/' + c.cw
          + ' | ' + c.sh + '/' + c.ch
          + ' | ' + c.len + ' | ' + c.why + ' |');
      });
      L.push('');
      L.push('> 路径里 `▸` = 跨 shadow 边界(左边是宿主元素)。要改这些元素的样式,');
      L.push('> 必须把 `<style>` 插进对应的 shadowRoot —— manifest 里登记的 CSS 进不去。');
    }
    L.push('');

    L.push('---');
    L.push('');
    L.push('> 本报告只采结构、不采内容:列表项内的文本(商品名/价格/库存)一律未采集,');
    L.push('> 只记录了字符长度;按钮与标签的文本截断 20 字。页面未被滚动或点击。');

    return L.join('\n');
  }

  /* ---------- 体积闸门 ---------- */

  function fit(text) {
    if (text.length <= REPORT_MAX) return text;
    var head = text.slice(0, REPORT_MAX);
    return head + '\n\n> ⚠ 报告超出体积上限,已截断。';
  }

  /* ---------- 执行并回传 ---------- */

  /**
   * 结果回传。两条通道,优先直投(2026-10-18 新增第一条):
   *
   *   ① `window.__dycProbeSink` —— 页面内调试面板(debug-panel.js)点「导出页面结构」
   *      时挂的接收函数。executeScript 与内容脚本跑在**同一个隔离世界**,`window`
   *      是同一个对象,所以能直接回调 —— 而 chrome.runtime.sendMessage 只到弹窗
   *      与后台,**到不了另一个内容脚本**,面板收不到。
   *   ② chrome.runtime.sendMessage —— 弹窗那条老链路(按钮在弹窗里),行为不变。
   */
  function send(payload) {
    var sink = window.__dycProbeSink;
    if (typeof sink === 'function') {
      window.__dycProbeSink = null;   // 一次性,用完即摘,避免下次误投
      try { sink(payload); return; } catch (e) { /* 落到下面那条通道 */ }
    }
    try {
      chrome.runtime.sendMessage(payload, function () {
        void chrome.runtime.lastError;   // 读掉,弹窗已关时不算错
      });
    } catch (e) { /* 消息通道不可用也不能抛 */ }
  }

  var report;
  try {
    report = fit(buildReport());
  } catch (e) {
    window.__dycProbeRunning = false;
    send({
      type: 'dyc:probeResult',
      ok: false,
      error: '采集出错:' + ((e && e.message) || e)
    });
    return;
  }

  window.__dycProbeRunning = false;
  send({ type: 'dyc:probeResult', ok: true, text: report });
})();
