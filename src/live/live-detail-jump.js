/**
 * 罗盘直播明细 · 跳转直播服务平台
 * ============================================================
 * 【用户需求(2026-10-20)】
 *   「直播明细页和达人明细页，这里加一个跳转到直播服务平台的按钮，
 *     跟直播大屏那个按钮的提示信息是一样的，这边这个按钮要简短一些，
 *     颜色也要特别一些。」(红框 = 「直播大屏」按钮左侧)
 *
 * 【作用页】与 live-detail.js 同样两个入口,一套代码通吃:
 *     compass.jinritemai.com/shop/live-detail      (抖店侧)
 *     compass.jinritemai.com/talent/live-statement (达人侧)
 *
 * 【与大屏那枚的关系】大屏页那枚(src/replay/replay-link.js)浮在播放器右上角;
 *   本页这枚**插进顶部按钮行**、落在「直播大屏」左边 —— 用户红框指定。
 *   提示语一字不差沿用大屏那枚的 BUTTON_TIP;文案用户拍板「去服务平台」,
 *   颜色用户拍板「浅蓝」(底 #D6E9FF / 字与边 #1256B8,对比度按 AA 校过)。
 *
 * 【锚定与幂等(按工程四问 + 状态机四条沉淀写)】
 *   ① 锚点 = 文案全等「直播大屏」的**可点元素**(button/a/[role=button]),
 *      可见、多个命中取最靠顶 —— 本页只有顶部按钮行有这个文案(真机截图核对),
 *      全等而不是 includes,防「跳转直播服务平台」之类长文案误命中。
 *   ② 幂等早退 = 「我上次把它放哪儿了」:按钮自记 data-dyc-lj,
 *      每拍校验「还在文档里 + 紧邻锚点右侧」,不满足才摘掉重插;
 *      锚点被平台重建(SPA 重绘)时按钮跟着重挂,不靠猜。
 *   ③ 找不到锚点就放弃、下拍再试 —— 绝不把按钮插到别的东西旁边。
 *   ④ 用 <a href target=_blank> 原生导航,不依赖 JS click
 *      —— 平台在捕获阶段 stopPropagation 也拦不住原生跳转。
 *
 * 【为什么插进按钮行而不是绝对定位】
 *   按钮行是 flex 容器,插一个 inline-flex 子项天然对齐、随平台排版走;
 *   与「货号按钮」不同,这里要的就是「跟平台按钮排在一起」,
 *   脱离布局流反而要自己算坐标、平台改版就漂。
 *
 * 【开关与回声(工程第 21 条)】
 *   弹窗「跳转服务平台」统一控制大屏和明细页，默认开；
 *   拨动回声来源词 = 「明细跳转」,首次读不出声(与大屏 replay-link.js 同模式)。
 *   挂载 / 摘除按钮本身**不弹消息** —— 那是界面变化不是操作结果,
 *   且本页消息盒子由货号复制等高频功能共用,不为静默的 UI 挂载刷历史。
 */
(function () {
  'use strict';

  if (window.__DYC_LIVE_JUMP__) return;

  var TARGET = 'https://liveservice.douyin.com/';
  var BUTTON_TEXT = '去服务平台';
  var BUTTON_TIP = '下载直播回放和看评论，复盘直播明细，点这里';
  var ANCHOR_TEXT = '直播大屏';
  var MARK = 'data-dyc-lj';

  var flags = {};
  var timer = null;      // 低频补挂 / 校验
  var alive = false;     // 当前是否已挂上

  function onThisPage() {
    return location.hostname === 'compass.jinritemai.com'
      && /^\/(?:shop\/live-detail|talent\/live-statement)/.test(location.pathname);
  }

  function enabled() {
    return onThisPage() && flags.servicePlatformJump !== false;
  }

  /** 文本归一:去空白后比较,防平台在文案里夹换行 / 全角空格 */
  function normText(el) {
    return (el.textContent || '').replace(/\s+/g, '').trim();
  }

  /** 是否可点元素:button / a / role=button */
  function isClickable(el) {
    var tag = (el.tagName || '').toLowerCase();
    if (tag === 'button' || tag === 'a') return true;
    return (el.getAttribute && el.getAttribute('role') === 'button');
  }

  /** 找锚点:「直播大屏」可点元素,可见者中取最靠顶的一个 */
  function findAnchor() {
    var nodes = document.querySelectorAll('button, a, [role="button"]');
    var best = null, bestTop = 0;
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      if (normText(el) !== ANCHOR_TEXT) continue;
      var r = el.getBoundingClientRect();
      if (r.width < 8 || r.height < 8) continue;          // 不可见 / 被折叠
      /* 2026-11-05 性能自检:原写法是 `r.top < best.getBoundingClientRect().top`,
       * 每命中一个候选就**重读一次 best 的矩形** —— 布局查询次数随候选数线性增长,
       * 而 best 自己那一拍读过的 top 我们本来就有。改为记在 bestTop 里复用。 */
      if (!best || r.top < bestTop) { best = el; bestTop = r.top; }
    }
    return best;
  }

  function buildButton() {
    var a = document.createElement('a');
    a.href = TARGET;
    a.target = '_blank';
    a.rel = 'noopener';
    a.textContent = BUTTON_TEXT;
    a.title = BUTTON_TIP;
    a.setAttribute(MARK, '1');
    /* 内联样式全部带 !important(工程沉淀:平台 CSS Modules 的规则带 !important,
       不带会被吃掉)。尺寸对齐 antd 默认按钮:高 32px / 圆角 6px / 字号 14px。 */
    a.style.cssText = [
      'display:inline-flex !important',
      'align-items:center !important',
      'flex:none !important',
      'height:32px !important',
      'padding:0 15px !important',
      'margin:0 !important',
      'border-radius:6px !important',
      'background:#D6E9FF !important',
      'color:#1256B8 !important',
      'border:1px solid #9CC3F5 !important',
      'font:500 14px/1 -apple-system,"Segoe UI","Microsoft YaHei",sans-serif !important',
      'letter-spacing:0 !important',
      'text-decoration:none !important',
      'cursor:pointer !important',
      'user-select:none !important',
      'box-sizing:border-box !important',
      'white-space:nowrap !important'
    ].join(';');
    a.addEventListener('mouseenter', function () {
      a.style.setProperty('background', '#C2DEFF', 'important');
    });
    a.addEventListener('mouseleave', function () {
      a.style.setProperty('background', '#D6E9FF', 'important');
    });
    return a;
  }

  /**
   * 补挂:锚点在、我的按钮不在或不在锚点左侧 ⇒ 插;否则不动。
   * 早退判据 = 「上次放的位置还成立」(状态机第 1 条),
   * 不看「它应不应该在别处」—— 那会每拍算出不同答案导致抖动。
   */
  function attach() {
    var anchor = findAnchor();
    if (!anchor || !anchor.parentNode) return;

    var mine = document.querySelector('[' + MARK + ']');
    if (mine && !document.contains(mine)) mine = null;   // 脱离文档 = 没有

    if (mine && mine.nextElementSibling === anchor) {    // 位置仍正确 → 早退
      alive = true;
      return;
    }
    if (mine && mine.parentNode) mine.parentNode.removeChild(mine);

    anchor.parentNode.insertBefore(buildButton(), anchor);
    alive = true;
  }

  function detach() {
    var mine = document.querySelector('[' + MARK + ']');
    if (mine && mine.parentNode) mine.parentNode.removeChild(mine);
    alive = false;
  }

  function start() {
    attach();
    // 本页是 SPA:切场次 / 切页签不重载文档,但按钮行可能被平台重建。
    // 2 秒粒度与大屏那枚(replay-link.js)一致,人眼察觉不到缺席。
    if (timer) clearInterval(timer);
    timer = setInterval(function () {
      if (!enabled()) { detach(); return; }
      attach();
    }, 2000);
  }

  function stop() {
    if (timer) { clearInterval(timer); timer = null; }
    detach();
  }

  var prev = null;      // 上一次「生效与否」;null = 还没读到初始态

  dycReadFlags().then(function (f) {
    flags = f;
    var on = enabled();
    if (prev === null) prev = on;   // 首次读记下,否则第一次拨开关会被吃掉回声
    if (on) start();
  });

  dycWatchFlags(function (f) {
    flags = f;
    var now = enabled();
    if (prev === now) return;
    var first = prev === null;
    prev = now;

    // 顺序不能反(工程第 21 条):开 → 先 start() 建出界面再 say;
    // 关 → 先 say 再 stop(),stop() 会把按钮摘掉。
    if (now) {
      start();
      if (!first) toast('已开启', 'info', { source: '明细跳转' });
    } else {
      if (!first) toast('已关闭', 'info', { source: '明细跳转' });
      stop();
    }
  });

  window.__DYC_LIVE_JUMP__ = {
    start: start,
    stop: stop,
    isOn: function () { return alive; }
  };
})();
