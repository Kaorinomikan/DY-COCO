/**
 * 抓手光标可见性修复
 *
 * 【背景 · 用户 2026-10-11 提出】
 *   在巨量百应 / 抖店中控台的商品列表里,鼠标进入可拖拽排序区域时
 *   会变成「抓手」光标。Chromium 内置的 grab 光标只有白色填充、没有描边,
 *   叠在浅色 / 白色商品列表上就与背景糊成一片,用户形容为
 *   「纯白色,根本看不到鼠标了」。
 *
 * 【为什么扩展能修】
 *   网页无法给**内置**光标上色 —— CSS cursor 走关键字时一律取浏览器/系统内置
 *   资源,没有「带描边的手」这个关键字可用。
 *   但 cursor 支持**自定义图片**:cursor: url(图) 热点x 热点y, 兜底关键字。
 *   于是自绘「奶油色猫爪 + 粉色肉垫 + 近黑描边」内联进来,既保住抓取语义,
 *   又保证在浅色 / 白色商品列表上看得见。
 *
 * 【历史:为什么不再用 move】
 *   上一版为「至少看得见」退而求其次选了 move(四向箭头),它在视觉上就是
 *   一个十字架,与用户原意(手型)不符。move 只是权宜之计,现已被自定义图取代。
 *   自定义图加载失败时,兜底关键字仍用 move(而非 grab)——
 *   因为 grab 正是我们要修的那个「看不见的白手」,不能让它当兜底。
 *
 * 【坑:data: 光标受页面 CSP 约束,且失败是静默的】
 *   data: 形式的图片走 img-src 检查。若平台 CSP 未放行 data:,
 *   浏览器会**悄悄丢掉**整张图并落到兜底关键字 —— 控制台不一定报错,
 *   表现为「改了却没生效」。因此这里加了 CSP 探针(见 probeCursorImage),
 *   实测失败就主动退回 move,并打印警告,不留下静默降级。
 *
 * 【难点:怎么找全「哪些元素是抓手」】
 *   平台是 React + 微前端,拖拽区既可能由样式表规则控制,也可能被 JS 动态
 *   改 class / 内联 style,还有 :hover 这种只在悬停瞬间才生效的写法。
 *   更麻烦的是**平台的 CSS 大概率跨域**(CDN 加载),此时
 *   document.styleSheets[i].cssRules 会抛 SecurityError,读不到规则。
 *
 *   因此用三条互补路径,任一条命中即可生效:
 *     路径 A(静态规则)  遍历 CSSOM,读出 cursor:grab 的选择器**原样**翻译成
 *                        带 !important 的覆盖规则。同域时开销为 0 且能覆盖
 *                        :hover 规则;跨域表读不到,交给 B、C。
 *     路径 B(悬停实测)  mouseover / mousedown 时元素**正处于悬停态**,
 *                        此刻 getComputedStyle 返回的正是真实光标 —— 于是
 *                        :hover 规则与跨域表都能被准确识别。命中即打标记。
 *     路径 C(DOM 兜底)  开局分片扫描 + MutationObserver 增量扫描,处理内联
 *                        style="cursor:grab" 这类 CSSOM 够不到的情况。
 *
 *   三条路径最终都汇到同一个出口:给元素打上属性标记
 *   data-dyc-cursor-fix,由一条属性选择器规则统一接管光标。
 *
 * 【默认开启】与其它功能开关口径一致(见 flags.js 注释)。
 */

(function cursorVisibilityFix() {
  'use strict';

  // 防止重复注入(SPA 路由切换等场景)
  if (window.__DYC_CURSOR_FIX__) return;
  window.__DYC_CURSOR_FIX__ = true;

  var STYLE_ID = 'dyc-cursor-fix-style';

  /**
   * 自绘抓手光标(内联 data URI PNG)—— 一对两态、每态两张分辨率。
   *
   *   CURSOR_PNG           悬停态 1x(32px):猫爪张开露出肉垫,表示「这里可以拖」
   *   CURSOR_PNG_2X        悬停态 2x(64px):同一形状的高分辨率版本
   *   CURSOR_PNG_ACTIVE    按下态 1x(32px):爪子收拢、肉垫挤成一团,表示「正在拖」
   *   CURSOR_PNG_ACTIVE_2X 按下态 2x(64px):同一形状的高分辨率版本
   *
   * 为什么要有按下态:
   *   只有一张图时,按下左键光标毫无变化 —— 拖了半天没有「抓紧了」的实感。
   *   猫爪收拢时轮廓变矮,补上按下反馈;两态热点保持在同一掌心位置。
   *
   * 为什么要有 2x(2026-10-11 用户反馈「抓手很糊」):
   *   Windows 显示缩放 125% / 150% 时,32px 位图被 Chromium 按 DPR 放大渲染,
   *   边缘必然发虚。补一张 64px 的 2x 图,经 -webkit-image-set() 交给高分屏
   *   按原生分辨率渲染;Chromium 自 2012 年起支持且可用于 cursor 属性。
   *   注入样式时同时下发两条 cursor 声明(见 buildCss):
   *     第 1 条 纯 url(32px) —— 所有内核都认,保底行为与旧版一致;
   *     第 2 条 -webkit-image-set(1x, 2x) —— 不认这条声明的内核会整条丢弃,
   *     落回第 1 条;认的内核则按屏幕 DPR 选图(≤1x 用 32px,>1x 用 64px)。
   *   热点写在 image-set() 之后,按 1x 图像素坐标给,浏览器自行按分辨率换算。
   *
   * 来源:scripts/make-cursor.py —— 8 倍超采样绘制后 LANCZOS 缩到 32/64,
   * alpha 膨胀一圈减去原剪影得到外轮廓环,填近黑 #1A1A1E 垫在奶油色猫爪下方;
   * 描边环模糊量 0.28 → 0.18,边缘比旧版更立。
   * 清晰度门槛(1x / 2x 均需达标):白底与浅灰底边界对比 >=100
   * (>=100 即为清晰可辨);锐度(过渡像素占比)见脚本输出。
   *
   * 为什么内联而不是放 icons/ 走文件:
   *   · 不产生网络请求,不会「先显示旧光标再闪一下」;
   *   · 不占用 web_accessible_resources(扩展资源暴露面小一号)。
   * 代价:受页面 CSP 的 img-src 约束 —— 已由 probeCursorImage() 兜底。
   */
  var CURSOR_PNG = 'data:image/png;base64,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';

  var CURSOR_PNG_ACTIVE = 'data:image/png;base64,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';

  // 2x 高分辨率版本(64px),由 scripts/make-cursor.py --write 注入。
  // 占位为空串不影响语法;正式注入前 image-set 行不会被构建(见下方 REPLACE_*)。
  var CURSOR_PNG_2X = 'data:image/png;base64,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';

  var CURSOR_PNG_ACTIVE_2X = 'data:image/png;base64,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';

  // 图内热点:抓取点落在猫爪掌心。
  // 数值为 1x 图(32px)的像素坐标,原点左上。两态用同一热点,避免按下时跳动;
  // image-set 选中 2x 图时由浏览器按分辨率自行换算,无需另给。
  var HOTSPOT_X = 16;
  var HOTSPOT_Y = 20;

  var HOTSPOT_ACTIVE_X = 16;
  var HOTSPOT_ACTIVE_Y = 20;

  var MARK_ATTR = 'data-dyc-cursor-fix';

  /**
   * 当前生效的光标值(悬停态 / 按下态各一)。
   *
   * REPLACE_CURSOR(_ACTIVE)          纯 url(32px) 行:所有内核都认的保底;
   * REPLACE_CURSOR_HIDPI(_ACTIVE)    -webkit-image-set(1x, 2x) 行:
   *                                  高分屏按原生分辨率渲染,消除放大发糊。
   *                                  声明内自带 url(32px) 兜底 —— 即使内核认
   *                                  image-set 但 2x 图被 CSP 拦掉,也会落回
   *                                  同一声明里的 1x url,不会跳变。
   * probeCursorImage() 实测失败时分别退回:FALLBACK_CURSOR / 纯 url 行。
   */
  var FALLBACK_CURSOR = 'move';

  var REPLACE_CURSOR = 'url("' + CURSOR_PNG + '") ' + HOTSPOT_X + ' '
    + HOTSPOT_Y + ', ' + FALLBACK_CURSOR;

  var REPLACE_CURSOR_ACTIVE = 'url("' + CURSOR_PNG_ACTIVE + '") '
    + HOTSPOT_ACTIVE_X + ' ' + HOTSPOT_ACTIVE_Y + ', ' + FALLBACK_CURSOR;

  var REPLACE_CURSOR_HIDPI = REPLACE_CURSOR;
  var REPLACE_CURSOR_HIDPI_ACTIVE = REPLACE_CURSOR_ACTIVE;

  // 2x 图已注入才构建 image-set 行;占位空串时保持纯 url 行,行为同旧版。
  if (CURSOR_PNG_2X && CURSOR_PNG_ACTIVE_2X) {
    REPLACE_CURSOR_HIDPI = '-webkit-image-set(url("' + CURSOR_PNG
      + '") 1x, url("' + CURSOR_PNG_2X + '") 2x) ' + HOTSPOT_X + ' '
      + HOTSPOT_Y + ', ' + REPLACE_CURSOR;

    REPLACE_CURSOR_HIDPI_ACTIVE = '-webkit-image-set(url("' + CURSOR_PNG_ACTIVE
      + '") 1x, url("' + CURSOR_PNG_ACTIVE_2X + '") 2x) '
      + HOTSPOT_ACTIVE_X + ' ' + HOTSPOT_ACTIVE_Y + ', ' + REPLACE_CURSOR_ACTIVE;
  }

  /**
   * 拼一条规则的 cursor 声明:纯 url 行在前, image-set 行在后。
   * 同优先级后者胜出 —— 认 image-set 的内核用高分屏版本,
   * 不认的整条丢弃第 2 条声明,由第 1 条接管(行为与旧版完全一致)。
   */
  function cursorDecls(normal, hidpi) {
    return 'cursor: ' + normal + ' !important; cursor: ' + hidpi
      + ' !important;';
  }

  var enabled = false;
  var scanned = new WeakSet();   // 已做过「非悬停态」扫描的元素
  var hovered = new WeakSet();   // 已做过「悬停态」实测的元素

  /* ==========================================================
   * 基础工具
   * ========================================================== */

  function cursorOf(el) {
    try {
      return window.getComputedStyle(el).cursor || '';
    } catch (e) {
      return '';
    }
  }

  function isGrab(c) {
    return c === 'grab' || c === 'grabbing';
  }

  function mark(el) {
    if (el && el.nodeType === 1 && !el.hasAttribute(MARK_ATTR)) {
      el.setAttribute(MARK_ATTR, '');
    }
  }

  /* ==========================================================
   * 路径 A:从页面样式表收集 grab 规则
   * ========================================================== */

  /** 递归遍历规则表,收集 cursor 含 grab 的选择器 */
  function walkRules(rules, out) {
    for (var i = 0; i < rules.length; i++) {
      var r = rules[i];
      try {
        if (r.selectorText && r.style && r.style.cursor
            && /grab/i.test(r.style.cursor)) {
          if (out.indexOf(r.selectorText) === -1) out.push(r.selectorText);
        }
        // @media / @supports 等嵌套规则继续下探
        if (r.cssRules && r.cssRules.length) walkRules(r.cssRules, out);
      } catch (e) {
        // 个别规则不可读,跳过即可,不影响其余
      }
    }
  }

  /**
   * 收集平台所有 grab 选择器。
   * 跨域样式表会抛 SecurityError —— 静默跳过,由路径 B/C 补位。
   */
  function collectGrabSelectors() {
    var out = [];
    var sheets = document.styleSheets;
    for (var i = 0; i < sheets.length; i++) {
      var rules;
      try {
        rules = sheets[i].cssRules;
      } catch (e) {
        continue;   // 跨域表,读不到
      }
      if (rules) walkRules(rules, out);
    }
    return out;
  }

  /** 拼出完整的覆盖样式 */
  function buildCss() {
    var parts = [];

    // 1) 属性标记规则 —— 路径 B / C 命中的元素由它接管。
    //    前面加 html body 提升优先级,避免被平台同样带 !important 的规则压过。
    parts.push('html body [' + MARK_ATTR + '] { '
      + cursorDecls(REPLACE_CURSOR, REPLACE_CURSOR_HIDPI) + ' }');
    parts.push('html body [' + MARK_ATTR + ']:active { '
      + cursorDecls(REPLACE_CURSOR_ACTIVE, REPLACE_CURSOR_HIDPI_ACTIVE) + ' }');

    // 2) 平台原有 grab 规则的替代规则,选择器原样照搬(含 :hover / :active)
    var sels = collectGrabSelectors();
    for (var i = 0; i < sels.length; i++) {
      var s = sels[i];
      if (/:active/.test(s)) {
        // 选择器本身就带 :active,已是按下态:只出按下光标一条,
        // 不再垫一条悬停光标(多余,且会被同优先级的后者覆盖,纯浪费)
        parts.push(s + ' { ' + cursorDecls(REPLACE_CURSOR_ACTIVE,
          REPLACE_CURSOR_HIDPI_ACTIVE) + ' }');
      } else {
        parts.push(s + ' { ' + cursorDecls(REPLACE_CURSOR,
          REPLACE_CURSOR_HIDPI) + ' }');
        parts.push(s + ':active { ' + cursorDecls(REPLACE_CURSOR_ACTIVE,
          REPLACE_CURSOR_HIDPI_ACTIVE) + ' }');
      }
    }

    return parts.join('\n');
  }

  function apply() {
    if (!enabled) return;
    if (!document.head && !document.documentElement) return;

    var el = document.getElementById(STYLE_ID);
    if (!el) {
      el = document.createElement('style');
      el.id = STYLE_ID;
    }
    el.textContent = buildCss();

    // appendChild 已存在的节点会把它移到末尾 —— 保证我们的规则排在平台
    // 后插入的样式表之后,同优先级下由后者胜出。
    (document.head || document.documentElement).appendChild(el);
  }

  /* ==========================================================
   * 路径 B:悬停态实测
   *
   * 在 mouseover / mousedown 的捕获阶段检查光标。此刻元素正处于悬停
   * (或按下)状态,getComputedStyle 返回的就是用户真实看到的那一个光标,
   * 于是 :hover 规则与跨域样式表都能被准确识别。
   * ========================================================== */

  function probe(el) {
    if (!enabled) return;
    if (!el || el.nodeType !== 1) return;
    if (hovered.has(el)) return;
    hovered.add(el);

    if (el.hasAttribute(MARK_ATTR)) return;
    if (isGrab(cursorOf(el))) el.setAttribute(MARK_ATTR, '');
  }

  function onProbe(e) {
    probe(e.target);
  }

  /* ==========================================================
   * 路径 C:DOM 扫描(内联样式 / 跨域表兜底)
   * ========================================================== */

  function scanList(nodes, force) {
    if (!enabled) return;
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      if (el.nodeType !== 1) continue;
      if (!force) {
        if (scanned.has(el)) continue;
        scanned.add(el);
      }
      if (el.hasAttribute(MARK_ATTR)) continue;
      if (isGrab(cursorOf(el))) el.setAttribute(MARK_ATTR, '');
    }
  }

  /** 节点及其子树 */
  function scanDom(root, force) {
    if (!root) return;
    var nodes = [];
    if (root.nodeType === 1) nodes.push(root);
    try {
      var found = root.querySelectorAll('*');
      for (var i = 0; i < found.length; i++) nodes.push(found[i]);
    } catch (e) { /* 忽略 */ }
    scanList(nodes, force);
  }

  /**
   * 开局全量扫描,分片执行。
   *
   * 抖店 / 百应页面节点上万,一次性对所有节点跑 getComputedStyle 会造成
   * 可感知的卡顿。因此切成小批,优先在浏览器空闲时执行。
   */
  function scanAll() {
    var all = [];
    try {
      var found = document.querySelectorAll('*');
      for (var i = 0; i < found.length; i++) all.push(found[i]);
    } catch (e) {
      return;
    }

    var idx = 0;
    var CHUNK = 400;

    function idle(fn) {
      if (window.requestIdleCallback) {
        window.requestIdleCallback(fn, { timeout: 1000 });
      } else {
        setTimeout(fn, 0);
      }
    }

    function step() {
      if (!enabled) return;
      var end = Math.min(idx + CHUNK, all.length);
      scanList(all.slice(idx, end), false);
      idx = end;
      if (idx < all.length) idle(step);
    }

    idle(step);
  }

  /* ---- 增量监听:新节点 + class/style 变化 ---- */

  var mo = null;

  /* ---------- 变异批次的消费:时间片分片(2026-10-21 性能修复) ----------
   *
   * 【为什么要分片】平台整列表重挂(自动刷新/切直播)时,addedNodes 里
   *   常是一整棵子树、几百上千个元素。原写法在一个 setTimeout 回调里
   *   对全部新元素跑 getComputedStyle —— 形成 50ms 级长任务,且恰好在
   *   平台渲染潮之后,把圆钮这类 CSS 过渡该得的帧全挤掉(用户感知:
   *   「中控台运转时连上滑下滑按钮的动效都卡」)。开局全量 scanAll
   *   一直有 400/批 + 空闲分片,增量路径原本没设防 —— 本次对齐。
   *
   * 【怎么分】不再 querySelectorAll('*') 一次性物化子树,改用 TreeWalker
   *   游标:扫到哪算哪,每片最长 SLICE_MS(8ms)/节点数 NODE_CAP(600) 兜底,
   *   到限就把游标留在队列里等下一个空闲片;先来先扫,不饿死后面的子树。
   *
   * 【不漏的闭环】已扫过的元素走 scanned 缓存跳过(新元素必不在缓存,
   *   照查);被复用/移动的旧元素 cursor 没变就不重查,若它自身
   *   class/style 变了会走 attributes 事件的单元素强制重查 —— 两条路
   *   合起来覆盖原「force 全子树重查」的语义,成本从每批全量降为增量。
   */
  var SLICE_MS = 8;      // 每个时间片的最长主线程占用
  var NODE_CAP = 600;    // 每片节点数兜底(防个别节点异常慢拖垮时间片)

  function observe() {
    if (mo || !window.MutationObserver) return;
    if (!document.documentElement) return;

    var queue = [];   // {el, self} —— self=true:只查元素自身(attributes 路径)
    var timer = 0;

    /* 消费队列:时间片分片,单片最长 SLICE_MS / NODE_CAP 兜底 */
    function flushQueue() {
      function step() {
        var start = Date.now();
        var n = 0;

        while (queue.length > 0) {
          var item = queue[0];
          var el = item.el;

          if (item.self) {
            /* 单元素强制重查(attributes 路径):量级 O(1) */
            queue.shift();
            if (el.isConnected) scanList([el], true);
            n += 1;
          } else {
            /* 子树:懒物化,游标遍历 —— 不一次性物化全部节点 */
            if (!el.isConnected) { queue.shift(); continue; }
            if (!item.walker) {
              try {
                item.walker = document.createTreeWalker(el, NodeFilter.SHOW_ELEMENT, null);
              } catch (e) { queue.shift(); continue; }
            }
            var node = item.walker.nextNode();
            while (node) {
              if (!scanned.has(node)) {
                scanned.add(node);
                if (!node.hasAttribute(MARK_ATTR) && isGrab(cursorOf(node))) {
                  node.setAttribute(MARK_ATTR, '');
                }
              }
              n += 1;
              if (Date.now() - start > SLICE_MS || n > NODE_CAP) break;
              node = item.walker.nextNode();
            }
            if (!node) {
              queue.shift();   /* 本子树遍历完 —— 摘掉,轮到下一个 */
            } else {
              break;           /* 时间片/配额用完 —— 游标留在队列里 */
            }
          }

          if (Date.now() - start > SLICE_MS || n > NODE_CAP) break;
        }

        if (queue.length > 0) {
          if (window.requestIdleCallback) {
            window.requestIdleCallback(step, { timeout: 500 });
          } else {
            setTimeout(step, 0);
          }
        }
      }

      step();
    }

    mo = new MutationObserver(function (muts) {
      if (!enabled) return;

      for (var i = 0; i < muts.length; i++) {
        var m = muts[i];

        if (m.type === 'attributes') {
          /* class / style 变了,元素光标可能刚变成 grab —— 强制重查它**自身**。
           * 【性能 2026-10-21】原写法 push(m.target) 后走 scanDom 子树全扫:
           *   React 高频改 style/class 的元素(进度条/倒计时/人气)每帧触发,
           *   等于每 300ms 对同一子树全量 getComputedStyle —— 运转时卡顿
           *   的另一半主力。cursor 由元素**自身**的样式决定,祖先的
           *   class/style 变更不改变子元素的 computed cursor(除非子元素
           *   显式写 cursor:inherit —— 平台拖拽区实际都把 grab 写在自己
           *   身上);子元素自己的 class/style 变更会触发它自己的
           *   attributes 事件,初次挂载也会被 childList 路径扫到,
           *   收窄到单元素不会漏。 */
          if (m.target && m.target.nodeType === 1) {
            queue.push({ el: m.target, self: true });
          }
          continue;
        }

        var added = m.addedNodes;
        for (var j = 0; j < added.length; j++) {
          if (added[j].nodeType === 1) queue.push({ el: added[j], self: false });
        }
      }

      if (queue.length === 0 || timer) return;

      // 合并一次渲染潮里的所有变化,避免逐个跑 getComputedStyle
      timer = setTimeout(function () {
        timer = 0;
        flushQueue();
      }, 300);
    });

    mo.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['style', 'class']
    });
  }

  /* ==========================================================
   * CSP 探针:确认自定义光标图真的能用
   *
   * data: 形式的图片走页面的 img-src 检查。平台若是严格 CSP,
   * 浏览器会**静默丢弃**光标图并落到兜底关键字 —— 不报错、难排查,
   * 表现就是「改了却没生效」。
   *
   * 这里用 new Image() 加载同一张 data URI 实测:
   *   · 成功 → 保留自定义图
   *   · 失败 → 换回纯关键字(至少保证「看得见」这个底线)
   *
   * 注意 probe 的是图片能否解码,不是 iframe —— 光标图的加载上下文
   * 就是当前文档,与页面 CSP 同源判定,因此这个探针结论是可信的。
   * ========================================================== */

  function probeCursorImage(done) {
    var pending = 4;   // 悬停 1x/2x + 按下 1x/2x,四张都要实测
    var failedAny = false;
    var failed2x = false;
    var settled = false;

    function finish() {
      if (settled) return;
      settled = true;

      if (failedAny) {
        // 任一张 1x 图被拦就整组退回关键字 —— 只退回一张会造成
        // 「悬停有手、按下变箭头」的割裂感,不如整组保持一致的兜底。
        REPLACE_CURSOR = FALLBACK_CURSOR;
        REPLACE_CURSOR_ACTIVE = FALLBACK_CURSOR;
        REPLACE_CURSOR_HIDPI = FALLBACK_CURSOR;
        REPLACE_CURSOR_HIDPI_ACTIVE = FALLBACK_CURSOR;
        console.warn('[DYC-CURSOR] 自定义光标图被 CSP 拦截或无法解码,'
          + '退回关键字 ' + FALLBACK_CURSOR + '(手型将不可用,但不会隐形)');
      } else if (failed2x) {
        // 仅 2x 被拦(理论上少见:CSP 拦 data: 是不分分辨率的):
        // 只退 image-set 行,保底行继续用 1x 自定义图。
        REPLACE_CURSOR_HIDPI = REPLACE_CURSOR;
        REPLACE_CURSOR_HIDPI_ACTIVE = REPLACE_CURSOR_ACTIVE;
        console.warn('[DYC-CURSOR] 2x 光标图不可用,高分屏退回 1x 图');
      }
      done();
    }

    function one(src, is2x) {
      var img = new Image();
      var doneOne = false;
      function settle(ok) {
        if (doneOne) return;
        doneOne = true;
        if (!ok) {
          if (is2x) failed2x = true;
          else failedAny = true;
        }
        if (--pending === 0) finish();
      }
      img.onload = function () { settle(true); };
      img.onerror = function () { settle(false); };
      // 兜底:异常环境下 onload / onerror 可能都不触发,不能一直等
      setTimeout(function () { settle(false); }, 800);
      img.src = src;
    }

    one(CURSOR_PNG, false);
    one(CURSOR_PNG_2X || CURSOR_PNG, true);
    one(CURSOR_PNG_ACTIVE, false);
    one(CURSOR_PNG_ACTIVE_2X || CURSOR_PNG_ACTIVE, true);
  }

  /* ==========================================================
   * 开关
   * ========================================================== */

  /**
   * 延迟补扫。
   *
   * 平台是 Garfish 微前端,子应用挂载后才把样式表分批注入文档。
   * 开局那一次收集只能拿到主应用的样式,因此再排几次补扫,
   * 把后续到位的样式表与 DOM 一并纳入。次数有限,跑完即止。
   */
  function scheduleRescan() {
    var delays = [500, 1500, 3000, 6000, 10000];
    delays.forEach(function (d) {
      setTimeout(function () {
        if (!enabled) return;
        apply();
        scanDom(document.documentElement, false);
      }, d);
    });
  }

  function bindProbes() {
    // 捕获阶段监听,抢在平台自身处理之前拿到目标元素
    document.addEventListener('mouseover', onProbe, true);
    document.addEventListener('mousedown', onProbe, true);
  }

  function enable() {
    if (enabled) return;
    enabled = true;

    // 先探针再注入:探针会把 REPLACE_CURSOR 定下来(可能退回关键字),
    // buildCss() 随后读到的是最终值。异步,不阻塞页面。
    probeCursorImage(function () {
      if (!enabled) return;   // 探针返回前被关掉,不注入

      apply();
      scanAll();
      observe();
      bindProbes();
      scheduleRescan();

      console.log('[DYC-CURSOR] 抓手光标修复:已开启'
        + (REPLACE_CURSOR.indexOf('url(') === 0 ? '(自定义手型)' : '(关键字兜底)'));
    });
  }

  function disable() {
    if (!enabled) return;
    enabled = false;

    var el = document.getElementById(STYLE_ID);
    if (el) el.remove();

    document.removeEventListener('mouseover', onProbe, true);
    document.removeEventListener('mousedown', onProbe, true);

    // 观察器也要断开（2026-11-01 体检 P1）：原来只把 enabled 拍成 false、
    // 回调首行拦一下 —— observer 仍挂在 documentElement（childList+attributes
    // subtree）上，中控台高频属性变更页面上，关掉的开关照样每次 DOM
    // 变更都唤醒回调空跑。enable() 路径会重新 observe()，这里放心断。
    if (mo) {
      try { mo.disconnect(); } catch (e0) { /* 忽略 */ }
      mo = null;
    }

    // 元素上的属性标记保留即可 —— 覆盖样式已移除,不会再影响光标;
    // 若再次开启,enable() 会重新注入样式让标记立即恢复作用。
    console.log('[DYC-CURSOR] 抓手光标修复:已关闭,光标交还页面');
  }

  /* ==========================================================
   * 启动
   * ========================================================== */

  dycReadFlags().then(function (flags) {
    if (flags.cursorFix === false) {
      console.log('[DYC-CURSOR] 抓手光标修复:开关为关闭,跳过');
      return;
    }
    enable();
  });

  // 开关变化即时生效,无需刷新页面
  // 状态条统一反馈(2026-10-11):开关切换报一声,首次对齐不报
  var prevCursorFix = null;
  dycWatchFlags(function (flags) {
    var on = flags.cursorFix !== false;
    if (prevCursorFix !== null && on !== prevCursorFix && typeof toast === 'function') {
      toast(on ? '已开启' : '已关闭', 'info', { source: '抓手光标' });
    }
    prevCursorFix = on;
    if (flags.cursorFix === false) {
      disable();
    } else if (!enabled) {
      enable();
    }
  });
})();
