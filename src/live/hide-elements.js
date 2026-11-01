/**
 * 隐藏页面元素 · 按弹窗勾选隐藏页面上的指定区块
 * ============================================================
 * 需求(用户 2026-10-11 提出):
 *   「隐藏页面元素」一级功能 —— 弹窗里每个可隐藏区块一个复选框,
 *   勾完点「保存勾选」,已打开的页面**即时生效**,不用刷新。
 *   首个目标:中控台智能助手(.index_wrapper__3UiS6)。
 *   2026-10-14 用户扩到**全抖店**:智能助手与反馈入口在抖店各个页面
 *   (含电商罗盘 compass.jinritemai.com)都有,拦截要跟着铺开 ——
 *   页面范围见 flags.js 的 DYC_PAGE_PATTERNS.shopAll。
 *
 * 实现要点:
 *   1. 用一条 <style> 规则隐藏,而不是删 DOM —— 平台是 React,
 *      删了会被下一轮渲染补回来;CSS 对「以后才挂载」的元素同样生效,
 *      因此**不需要** MutationObserver,常驻开销接近 0。
 *   2. 可隐藏目标登记在 flags.js 的 DYC_HIDE_TARGETS(唯一真源),
 *      弹窗复选框按它渲染;以后加新目标只改 flags.js 一处。
 *   3. 即时生效:双订阅 —— dycWatchFlags(总开关)+ dycWatchHideList(勾选)。
 *      勾选存 chrome.storage.local 的 dybHideList(id 数组)。
 *   4. 选择器统一加 html body 前缀:与平台可能的 !important 同权重规则
 *      竞争时靠更高特异性取胜(与 cursor-fix 同一手法)。
 *   5. 隐藏手法按目标的 mode 分派(display / opacity),规则见下方 ruleFor。
 *      **会被平台按尺寸或可见性预留空间的区块,必须用 opacity** —— 用 display 摘掉、
 *      或用 visibility 隐掉,平台都能察觉,预留一变页面就走样(2026-10-14 那两轮
 *      「商品界面往左缩一个红框」就是这么来的,详见 flags.js 的 mode 说明)。
 *   6. 总开关关闭或清单为空 → 摘掉 <style>,页面恢复原样。
 * ============================================================
 */

(function dycHideElements() {
  'use strict';

  // 防重复注入(SPA 路由回切、脚本意外重跑时不会叠出多条规则)
  if (window.__dycHideElementsLoaded) return;
  window.__dycHideElementsLoaded = true;

  var STYLE_ID = 'dyc-hide-elements-style';

  /**
   * 通用扫描打上的标记属性(2026-10-18)
   *
   * 为什么要有第二条识别路径:右侧浮条在三处页面上长得像但类名完全不同
   * (罗盘直播明细是字节 summon SDK、百应经营页是浅色卡片、直播大屏是深色竖条),
   * 而且后两处的类名**没采到**。光靠登记表里的 selector,新页面必然漏。
   * 所以 selector 管已知的、本扫描兜未知的 —— 扫到的节点打这个属性,
   * 由一条同样的 opacity 规则隐藏。两条路径互不干扰,重复命中也没副作用。
   */
  var BAR_ATTR = 'data-dyc-hide-bar';
  var BAR_CSS =
    'html body [' + BAR_ATTR + '] { opacity: 0 !important; pointer-events: none !important; }\n' +
    'html body [' + BAR_ATTR + '] * { pointer-events: none !important; }';

  /* ---------- 依赖自检(flags.js 必须先加载) ---------- */
  if (typeof dycReadFlags !== 'function' ||
      typeof dycReadHideList !== 'function' ||
      typeof DYC_HIDE_TARGETS === 'undefined') {
    return;
  }

  /** 当前页是否属于目标声明的作用页(pages 为空 = 不限页面) */
  function pageMatch(pages) {
    if (!pages || !pages.length) return true;
    var href = location.href;
    for (var i = 0; i < pages.length; i++) {
      var re = DYC_PAGE_PATTERNS[pages[i]];
      if (re && re.test(href)) return true;
    }
    return false;
  }

  /**
   * 选择器 → 带 html body 前缀的完整选择器串
   *
   * 登记表里允许写**逗号列表**(如 `[class*="summon"], [id*="summon"]`):
   *   一次要覆盖多个候选时,写一条 CSS 比在登记表里堆多条目标更好维护。
   *   但前缀必须**逐个**加 —— 直接 'html body ' + 整串 会让逗号后面那段
   *   丢掉前缀,特异性掉一档,遇到平台的 !important 就抢不过。
   */
  function prefixed(selector) {
    return String(selector).split(',').map(function (s) {
      return 'html body ' + s.trim();
    }).join(', ');
  }

  /**
   * 一个目标 → 一条 CSS 规则(隐藏手法按目标的 mode 分派,登记表见 flags.js)
   *
   * 'opacity'(抖店侧必须用这个,2026-10-14 两轮实测后定):
   *   opacity:0 让元素肉眼不可见,但 **display / 尺寸 / computed visibility 一个都不动** ——
   *   平台用 JS 按右轨的尺寸或可见性预留空间时查不出任何异常,预留不变,页面就不走样。
   *   · 上一版用的 visibility:hidden 被用户实测打回:尺寸虽在,但 computed visibility
   *     变成了 hidden,平台读一眼样式就知道它被藏了。
   *     (实测纠正:`checkVisibility()` 默认**不**检查 visibility,对它仍返回 true。)
   *   · pointer-events:none 必须有:那块看不见的区域不能变成透明挡板,否则
   *     底下压着的商品点不动。它是可继承属性,但子元素可能自己写 auto,故连子元素一起钉死。
   *   · 不必给子元素加 opacity —— 父元素 opacity:0 会让整棵子树一起不可见,
   *     少写一条就少一层「被平台读到异常值」的机会。
   * 'display'(默认,纯浮层):直接摘掉,最干净。
   */
  function ruleFor(t) {
    if (!t.selector) return '';
    if (t.mode === 'opacity') {
      var s = prefixed(t.selector);
      var kids = String(t.selector).split(',').map(function (x) {
        return 'html body ' + x.trim() + ' *';
      }).join(', ');
      return s + ' { opacity: 0 !important; pointer-events: none !important; }\n' +
             kids + ' { pointer-events: none !important; }';
    }
    return prefixed(t.selector) + ' { display: none !important; }';
  }

  /** 按勾选清单拼 CSS;命不中任何目标的清单返回空串 */
  function buildCss(list) {
    var rules = [];
    for (var i = 0; i < DYC_HIDE_TARGETS.length; i++) {
      var t = DYC_HIDE_TARGETS[i];
      if (list.indexOf(t.id) === -1) continue;
      if (!pageMatch(t.pages)) continue;
      var rule = ruleFor(t);
      if (rule) rules.push(rule);
    }
    return rules.join('\n');
  }

  /* ==========================================================
   * 通用浮条扫描(B 套识别,2026-10-18)
   *
   * 与 selector(A 套)并行:selector 管类名已知的页面,本扫描兜类名未知 / 改版后的页面。
   * 判定一条:贴右缘 + 窄 + 竖长 + 命中若干关键词 + 是浮层 ⇒ 打 BAR_ATTR,CSS 负责隐藏。
   *
   * 为什么不做全页通配遍历:中控台/大屏动辄两三千节点,
   * 逐节点读文本会成倍放大开销。这里用「深度 + 预算双上限的 BFS」:
   *   · 只推进到第 BAR_MAX_DEPTH 层,预算 BAR_MAX_NODES 个节点;
   *   · 先只读 textContent(不读布局),文本量大的容器直接跳过 —— 浮条自身文本极短;
   *   · 只有通过文本筛选的少数候选才读矩形与 computed position。
   * 扫描只在「勾选生效 + 页面命中」且 DOM 变化后 400ms 触发一次,非常驻。
   * ========================================================== */

  var BAR_MAX_DEPTH = 14;
  var BAR_MAX_NODES = 8000;
  var BAR_DEBOUNCE = 400;
  var BAR_MAX_WAIT = 1200;    // 变更过于频繁时也保证最多这么久扫一次(防防抖饿死)

  // ★ #104(2026-10-24)预算 3000→8000、深度 10→14:
  //   中控台开播后 DOM 动辄两三千节点(开发日志 2026-10-18 原话),3000 预算的
  //   层序遍历会在中途耗尽 —— 排在遍历序后面的浮条子树根本没被走到,扫描
  //   「静默地」漏掉它(登记 #104 时四候选里漏了这个,复盘补上,列为头号嫌疑:
  //   完美解释「#102 开发时拦得住(未开播节点少)、用户开播实战拦不住」)。
  //   提预算的底气:候选筛选仍只对「children 少 + 文本短」的少数节点做重活,
  //   预算只是遍历计数,不等于重开销线性放大;配套统计见 lastScanStat。

  var barTimer = null;
  var barSince = 0;           // 当前排队是从什么时候开始的
  var barObserver = null;
  var barCfgs = [];           // 当前生效的扫描配置(可多套,空数组 = 不扫)

  /** 收集清单里所有「已勾选 + 页面命中 + 带 barScan」的目标配置
   *  (2026-10-21 #102 起**多套并行**:此前只认第一个,中控台运营浮条
   *  的几何形态与右侧竖条完全不同,必须各跑各的参数,互不干扰。) */
  function collectBarConfigs(list) {
    var out = [];
    for (var i = 0; i < DYC_HIDE_TARGETS.length; i++) {
      var t = DYC_HIDE_TARGETS[i];
      if (!t.barScan) continue;
      if (list.indexOf(t.id) === -1) continue;
      if (!pageMatch(t.pages)) continue;
      out.push(t.barScan);
    }
    return out;
  }

  /** 元素是否浮层(fixed/absolute;自身不是就看至多 6 层祖先)
   *  ★ #104(2026-10-24)3 层→6 层:运营浮条的本体到 fixed 容器之间
   *  常隔 4~5 层包装 div,3 层不够,isFloating 误判「非浮层」漏放。 */
  function isFloating(el) {
    var cur = el;
    for (var i = 0; i < 7 && cur && cur.nodeType === 1; i++) {
      var pos = '';
      try { pos = getComputedStyle(cur).position; } catch (e) { pos = ''; }
      if (pos === 'fixed' || pos === 'absolute') return true;
      cur = cur.parentElement;
    }
    return false;
  }

  /* ---------- 浮条扫描探针(2026-10-24,#104 取证) ----------
   * 文本命中关键词、但被后续档位(长度/几何/浮层)淘汰的候选,把淘汰原因
   * 记进 window.__dycBarScanLog(环形,最近 BAR_LOG_MAX 条);每次扫描的
   * 遍历汇总记进 window.__dycBarScanMeta。诊断报告(diag.js)读这两个
   * 全局量入报 —— 万一放宽后仍漏,用户「复制诊断报告」直接带回
   * 「浮条为什么没被拦」的现场证据,不用再猜。探针只写日志,零副作用。 */
  var BAR_LOG_MAX = 24;
  window.__dycBarScanLog = [];   // 拒绝明细(环形)
  window.__dycBarScanMeta = null; // 最近一次扫描汇总

  function hhmm() {
    try { return new Date().toTimeString().slice(0, 8); } catch (e) { return ''; }
  }

  function barLogPush(entry) {
    try {
      var log = window.__dycBarScanLog;
      // 指纹去重:同一元素同一原因只记一次 —— 重扫每 400ms 就会再命中
      // 同一个候选,不去重会把环形日志整个刷成同一条(与最近 6 条比对足够)
      for (var i = log.length - 1; i >= 0 && i >= log.length - 6; i--) {
        if (log[i].el === entry.el && log[i].why === entry.why && log[i].hit === entry.hit) return;
      }
      entry.t = hhmm();
      log.push(entry);
      if (log.length > BAR_LOG_MAX) {
        log.splice(0, log.length - BAR_LOG_MAX);
      }
    } catch (e) { /* 探针绝不影响主链路 */ }
  }

  /** 元素一句话摘要:tag#id.类名(类名截 60 字),供探针日志定位 */
  function elBrief(el) {
    try {
      var cls = String(el.className || '');
      if (cls.length > 60) cls = cls.slice(0, 60) + '…';
      return (el.tagName || '').toLowerCase() + (el.id ? '#' + el.id : '')
        + (cls ? '.' + cls.replace(/\s+/g, '.') : '');
    } catch (e) { return '?'; }
  }

  /** 文本里命中了词表里的哪些词(返回数组,供候选携带与探针展示) */
  function hitWords(txt, cfg) {
    var out = [];
    for (var k = 0; k < cfg.texts.length; k++) {
      if (txt.indexOf(cfg.texts[k]) !== -1) out.push(cfg.texts[k]);
    }
    return out;
  }

  /** 遍历统计(多套配置累加,scanBars 开头重置) */
  var lastScanStat = { nodes: 0, budgetOut: false, depthOut: false };

  /**
   * 文本预筛:命中足够多关键词的元素送进候选。
   * 返回 [{el, hit}](hit = 命中词,供探针展示);此阶段不读布局。
   */
  function collectBarCandidates(cfg) {
    var out = [];
    var budget = BAR_MAX_NODES;
    var level = [{ el: document.body, d: 0 }];
    var cap = cfg.maxChildren || 8;   // ★ #104:children 上限可按套覆盖(默认 8)

    while (level.length && budget > 0) {
      var next = [];
      for (var i = 0; i < level.length && budget > 0; i++) {
        var item = level[i];
        var el = item.el;
        if (!el || el.nodeType !== 1) continue;
        budget--;
        lastScanStat.nodes++;
        if (budget === 0) lastScanStat.budgetOut = true;  // 探针:预算耗尽=可能有子树没走到
        if (item.d >= BAR_MAX_DEPTH) lastScanStat.depthOut = true;

        // 不动扩展自己注入的节点(标记 / 消息盒子 / 我们加的按钮)
        if (/^dy[bc]-/.test(el.id || '')) continue;

        var kids = el.children;
        if (item.d < BAR_MAX_DEPTH) {
          for (var j = 0; j < kids.length; j++) next.push({ el: kids[j], d: item.d + 1 });
        }

        // 浮条本体:子元素不多、文本很短。大容器直接跳过 —— 既省 textContent 开销,
        // 也避免把「整页有几个客服字样的正文区」误认成浮条。
        if (kids.length < 1 || kids.length > cap) continue;
        var txt = '';
        try { txt = el.textContent || ''; } catch (e) { txt = ''; }
        if (!txt || txt.length > cfg.maxTextLen) {
          // 探针(#104):文本超长但含目标词的记一笔 —— 浮条带「15:01 更新 ·
          // 每1分钟」时间戳与按钮文案时 textContent 可能超上限被静默淘汰,
          // 这里对已读的 txt 补跑一次 indexOf,零额外布局开销。
          if (txt && hitWords(txt, cfg).length) {
            barLogPush({
              why: '文本' + txt.length + '字>上限' + cfg.maxTextLen,
              el: elBrief(el)
            });
          }
          continue;
        }

        var hits = hitWords(txt, cfg);
        if (hits.length >= cfg.minHits) out.push({ el: el, hit: hits.join('+') });
      }
      level = next;
    }
    return out;
  }

  /** 几何判定:按各套配置的尺度判「是浮条」。通过返回 null,否则返回淘汰原因
   *  (原因串直接进探针日志,#104 取证 —— 每一档都带实测值与阈值,一眼看出卡在哪)。
   *  可选参数(不写就不启用,老配置不受影响):
   *    maxHeight —— 上限,拦「贴右但高得离谱」的大块面板(#102 横条档用);
   *    maxTop    —— 只认视口上部,#102 运营浮条在右上(按截图定,留观可调)。 */
  function barRejectReason(el, cfg) {
    var r;
    try { r = el.getBoundingClientRect(); } catch (e) { return 'rect读取异常'; }
    if (!r || r.width === 0 || r.height === 0) return '尺寸为0';
    if (r.width > cfg.maxWidth) return '宽' + Math.round(r.width) + '>上限' + cfg.maxWidth;
    if (cfg.maxHeight && r.height > cfg.maxHeight) return '高' + Math.round(r.height) + '>上限' + cfg.maxHeight;
    if (r.height < cfg.minHeight) return '高' + Math.round(r.height) + '<下限' + cfg.minHeight;
    if (cfg.minAspect && (r.height / r.width) < cfg.minAspect) return '高宽比' + (r.height / r.width).toFixed(2) + '<' + cfg.minAspect;
    if (cfg.maxTop && r.top > cfg.maxTop) return 'top' + Math.round(r.top) + '>上限' + cfg.maxTop;
    if (window.innerWidth - r.right > cfg.rightGap) return '右距' + Math.round(window.innerWidth - r.right) + '>上限' + cfg.rightGap;
    if (!isFloating(el)) return '近6层内无fixed/absolute祖先';
    return null;
  }

  /** 清掉上次扫描留下的标记(切页面/取消勾选/重新扫描前都要清) */
  function clearBarMarks() {
    var marked;
    try { marked = document.querySelectorAll('[' + BAR_ATTR + ']'); } catch (e) { return; }
    for (var i = 0; i < marked.length; i++) {
      marked[i].removeAttribute(BAR_ATTR);
    }
  }

  /** 扫一遍并打标记。cfgs 为空 = 只清标记。
   *  多套配置逐套各跑(词表与几何参数独立),命中集合合并去重后统一取最外层。 */
  function scanBars() {
    if (!barCfgs.length) return;
    lastScanStat.nodes = 0;
    lastScanStat.budgetOut = false;
    lastScanStat.depthOut = false;
    var hits = [];
    for (var c = 0; c < barCfgs.length; c++) {
      var cfg = barCfgs[c];
      var cands = collectBarCandidates(cfg);
      for (var i = 0; i < cands.length; i++) {
        var why = barRejectReason(cands[i].el, cfg);
        if (!why) {
          if (hits.indexOf(cands[i].el) === -1) hits.push(cands[i].el);
        } else {
          // 探针(#104):文本命中但被几何/浮层档淘汰 —— rect 带实测宽高与右距
          var r = null;
          try { r = cands[i].el.getBoundingClientRect(); } catch (e) { r = null; }
          barLogPush({
            hit: cands[i].hit,
            why: why,
            rect: r ? (Math.round(r.width) + 'x' + Math.round(r.height)
              + '@top' + Math.round(r.top)
              + ',右距' + Math.round(window.innerWidth - r.right)) : '?',
            el: elBrief(cands[i].el)
          });
        }
      }
    }
    // ★ 顺序很关键:先做**几何判定**,再在通过者中取最外层。
    //   反过来(先取最外层再判定)会踩坑 —— 浮条的祖先包装(body / #root)的
    //   textContent 同样包含那几个关键词,它们往往有 1 个子元素、文本也短,
    //   于是也进了候选;取最外层时会把包装选中,而包装尺寸是 0×0 或整页,
    //   判定必然不通过,浮条本体就被漏掉了(2026-10-18 自测实测抓到)。
    // 命中集合里若 A 包含 B,则 A 是外包装 —— 保留 A(整条一起藏),
    // 只丢掉被包含的内层,避免同一条浮条被拆成几个标记。
    var picked = hits.filter(function (el) {
      for (var k = 0; k < hits.length; k++) {
        if (hits[k] !== el && hits[k].contains(el)) return false;
      }
      return true;
    });

    // 先清旧标记,再按最新判定重打 —— 元素个位数
    clearBarMarks();
    for (var j = 0; j < picked.length; j++) {
      picked[j].setAttribute(BAR_ATTR, '1');
    }

    // 探针汇总(#104):每次扫描覆盖一条,诊断报告读它区分
    // 「没跑过」/「跑了没命中」/「预算耗尽可能没扫全」三种现场。
    window.__dycBarScanMeta = {
      at: hhmm(),
      cfgs: barCfgs.length,
      nodes: lastScanStat.nodes,
      budgetOut: lastScanStat.budgetOut,
      depthOut: lastScanStat.depthOut,
      marked: picked.length
    };
  }

  /**
   * 合批调度:DOM 频繁变化时只在最后一次变化后 BAR_DEBOUNCE 扫一次。
   * ★ 再加一道「最长等待」上限:直播大屏这类页面 DOM 几乎不停在变,
   *   纯防抖会让扫描被无限推后(永远等不到 400ms 静默窗口)⇒ 浮条迟迟不藏。
   *   因此从排队开始计时,最长 BAR_MAX_WAIT 必扫一次。
   */
  function scheduleScan() {
    if (!barCfgs.length) return;
    var now = Date.now();
    if (!barSince) barSince = now;
    var due = Math.min(BAR_DEBOUNCE, Math.max(0, barSince + BAR_MAX_WAIT - now));
    clearTimeout(barTimer);
    barTimer = setTimeout(function () {
      barTimer = null;
      barSince = 0;
      try { scanBars(); } catch (e) { /* 扫描失败不能影响隐藏总链路 */ }
    }, due);
  }

  /** 开/关扫描:配置变化时重扫,DOM 变化时合批重扫 */
  function setBarScan(cfgs) {
    barCfgs = cfgs || [];
    if (!barCfgs.length) {
      if (barObserver) { barObserver.disconnect(); barObserver = null; }
      clearTimeout(barTimer);
      barTimer = null;
      barSince = 0;
      clearBarMarks();
      return;
    }
    try { scanBars(); } catch (e) { /* 尽力而为 */ }
    if (!barObserver && typeof MutationObserver === 'function' && document.body) {
      // 回调里只做「排一次扫描」,不做任何查询 —— 避免每条变异都触发遍历
      barObserver = new MutationObserver(function () { scheduleScan(); });
      barObserver.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['class', 'style']   // 浮条是懒挂载 + 改 class 显隐
      });
    }
  }

  /** 换装当前规则;css 为空串时摘掉 <style>(元素恢复显示) */
  function applyStyle(css) {
    var old = document.getElementById(STYLE_ID);
    if (old) old.remove();
    if (css) {
      var st = document.createElement('style');
      st.id = STYLE_ID;
      st.textContent = css;
      (document.head || document.documentElement).appendChild(st);
    }
  }

  /* ---------- 双订阅:总开关 + 勾选清单,任一变化都重算 ---------- */

  var curFlags = null;   // 最近一次读到的开关对象
  var curList = null;    // 最近一次读到的勾选清单(id 数组)
  var lastCss = null;    // 上次实际生效的规则(null = 尚未首次对齐)

  /** 当前清单实际命中的目标数(与 buildCss 同口径:过页面规则的才算;
   *  2026-10-21 起纯 barScan 目标(无 selector)也计入 —— 它们同样在隐藏内容) */
  function countTargets(list) {
    var n = 0;
    for (var i = 0; i < DYC_HIDE_TARGETS.length; i++) {
      var t = DYC_HIDE_TARGETS[i];
      if (list.indexOf(t.id) === -1) continue;
      if (!pageMatch(t.pages)) continue;
      if (t.selector || t.barScan) n++;
    }
    return n;
  }

  function rerender() {
    if (!curFlags || !curList) return;  // 两路初始读取都到位才渲染
    var off = (curFlags.hideElements === false);
    var css = off ? '' : buildCss(curList);

    // 硬编码兜底:如果弹窗/存储链路失效,至少隐藏登记表里 defaultOn 的目标
    // (用户反馈"没有开关/不生效"时的保底行为;开关恢复后仍由弹窗控制)
    if (!css && !off) {
      var fallback = [];
      for (var k = 0; k < DYC_HIDE_TARGETS.length; k++) {
        var t = DYC_HIDE_TARGETS[k];
        if (t.defaultOn !== false && pageMatch(t.pages)) {
          var rule = ruleFor(t);
          if (rule) fallback.push(rule);
        }
      }
      if (fallback.length) css = fallback.join('\n');
    }

    // 通用浮条扫描(B 套识别,2026-10-18;2026-10-21 起多套并行):
    //   有配置 → 追加一条「按标记属性生效」的规则,并把扫描打开;
    //   无配置(总开关关 / 该项未勾 / 本页不适用)→ 关扫描并清旧标记,
    //   页面立刻恢复原样,不留残余 opacity。
    var barCfgsNow = off ? [] : collectBarConfigs(curList);
    if (barCfgsNow.length) css = css ? (css + '\n' + BAR_CSS) : BAR_CSS;
    setBarScan(barCfgsNow);

    // 状态条统一反馈(2026-10-11):实际生效内容变化时报一声;
    // 首次对齐(lastCss 为 null)与无变化的重复渲染不报,避免开场噪音
    if (lastCss !== null && css !== lastCss && typeof toast === 'function') {
      var n = countTargets(curList);
      if (off || n === 0) {
        toast('已恢复显示', 'info', { source: '隐藏元素' });
      } else {
        toast('已隐藏 ' + n + ' 个区块', 'info', { source: '隐藏元素' });
      }
    }
    lastCss = css;
    applyStyle(css);
  }

  dycReadFlags().then(function (flags) { curFlags = flags; rerender(); });
  dycReadHideList().then(function (list) { curList = list; rerender(); });

  if (typeof dycWatchFlags === 'function') {
    dycWatchFlags(function (flags) { curFlags = flags; rerender(); });
  }
  if (typeof dycWatchHideList === 'function') {
    dycWatchHideList(function (list) { curList = list; rerender(); });
  }

  /* ---------- SPA 路由感知(2026-10-24,#104) ----------
   * 根因之三:barCfgs 在 rerender 时按「当时」的 location.href 收集
   * (pageMatch 在 collectBarConfigs/buildCss 里各算一遍),而 rerender 只在
   * 开关/勾选 storage 变化时跑 —— 用户从抖店其他页 SPA 切进中控台(不刷新)
   * 时没人重算,liveCtrlOpsBar 根本不在生效清单里,永远不扫;反向切走则
   * 旧配置还残留。hook pushState/replaceState/popstate/hashchange,URL 一变
   * 400ms 后(与扫描防抖同拍)重跑 rerender,让页面规则与扫描配置跟上路由。
   * 噪音控制:URL 没变的重复触发直接忽略;rerender 内部 lastCss 相同也不报 toast。 */
  (function dycWatchRoute() {
    var lastHref = '';
    try { lastHref = location.href; } catch (e) { lastHref = ''; }
    var spaTimer = null;

    function onMaybeRouteChange() {
      try {
        if (location.href === lastHref) return;
        lastHref = location.href;
        clearTimeout(spaTimer);
        spaTimer = setTimeout(function () {
          try { rerender(); } catch (e) { /* 路由重算失败不影响主链路 */ }
        }, 400);
      } catch (e) { /* 探针外圈,兜住 */ }
    }

    try {
      if (typeof history.pushState === 'function') {
        var origPush = history.pushState;
        var origRep = history.replaceState;
        history.pushState = function () {
          var r = origPush.apply(this, arguments);
          onMaybeRouteChange();
          return r;
        };
        history.replaceState = function () {
          var r = origRep.apply(this, arguments);
          onMaybeRouteChange();
          return r;
        };
      }
      window.addEventListener('popstate', onMaybeRouteChange);
      window.addEventListener('hashchange', onMaybeRouteChange);
    } catch (e) { /* hook 失败退回旧行为:刷新进页才能重算 */ }
  })();
})();
