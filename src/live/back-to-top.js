/**
 * 中控台上滑到顶 · 右下角浮动圆钮
 * ============================================================
 * 需求(用户 2026-10-10 提出,开发待办「待办二」):
 *   中控台页面右下角一个圆形按钮,内是向上箭头;
 *   点一次,**内层商品容器与外层页面同时上滑到顶**。
 *
 * 页面事实(实测,见开发待办):
 *   中控台是嵌套滚动结构 ——
 *     外层页面容器 1135x913(内容高 2163)
 *     内层商品容器 961x1178(内容高 31752,首屏之外)
 *   只滚 window 或只滚内层都不够,**必须把所有滚出去的容器一起归零**。
 *
 * 实现要点:
 *   1. 自含样式(脚本自己注入 <style>),不碰共享 CSS 文件 —— 并行开发不冲突
 *   2. 开关:backToTop(默认开),dycReadFlags/dycWatchFlags 即时生效
 *   3. 显隐(2026-10-12 用户定稿,二十一轮):按**本功能对「顶部」的认定**
 *      判定 —— 锚点 .container-e6f75f 顶边落在「视口顶下方 1H」线之上
 *      = 已滚过页顶 = 显示;回顶执行完恰落在线上,不显示,口径天然一致。
 *      兜底链与回顶兜底链一致:锚点未渲染/找不到 → 导航头口径
 *      → 全部归零口径(scrollTop > 300)。原先的「行距×6 动态阈值」
 *      与「window.__dycBackTopIsBeyond 共享信号」一并撤销 ——
 *      浮动搜索按钮已改为自行实现同一套认定,两边完全独立
 *      (用户定「机制不可以关联和绑定在一起,免得一个错全部错」)
 *   4. 点击:2026-10-11 用户改口径 —— 让导航头(class navHeader-e6f75f,
 *      兜底 [class*="navHeader-"])对齐浏览器视口顶部:
 *      scrollIntoView 逐层对齐所有可滚祖先,不含导航头的其余容器仍归零;
 *      找不到导航头(抖店改版换哈希)则退回旧的「全部归零」行为
 *      2026-10-11 用户再补:终点要比「贴视口顶」再往上让出
 *      nav-menu_wrapper__3bJBv(兜底 [class*="nav-menu_wrapper"])
 *      那根导航条的高度,导航头落在视口顶下方 H px 处,
 *      贴顶内容才不被盖住(实现见点击分支里的 scroll-margin-top)
 *      2026-10-11 用户 21:4x 定稿:页顶 = container-e6f75f 顶边
 *      再往上两个自身高度(元素最终落在视口顶下方 2H 处)。该元素
 *      位置/高度可能动态变化,故每次点击瞬间实测 rect,把位移从最内层
 *      滚动容器到 window 逐层精确分摊,不依赖 scroll-margin
 *      (content-f7460f 中间方案按用户反馈「还是失败」废弃;
 *       哈希类名不做前缀兜底,找不到走 导航头 → 全部归零 兜底链)
 *   4b. 2026-10-13 重构(用户报「中控台两个容器不受上滑/下滑控制」):
 *      旧版「逐层精确分摊」只在**含锚点的容器链**上做,链上没被分摊到
 *      位移的容器既不归零也不滚动 —— 中控台外层页面容器因此完全失控。
 *      改为 planAlignScroll:链上除最内层**一律归零**,最内层承担把目标
 *      元素对到「视口顶下方 offset」的剩余位移(各归零层令锚点下移的量
 *      一并补偿);不含锚点的其它可滚容器同样归零。锚点 / 导航头 /
 *      全部归零三级路径共用该函数(导航头口径的 offset = nav-menu 高度)。
 *   5. scroll 事件不冒泡但会进捕获阶段 —— 用 document 捕获监听,
 *      内层容器滚动也能被感知,不需要给每个容器单独挂监听
 *   6. 性能(2026-10-11 发布前性能闸门核实后改造):scroll 每帧都会触发,
 *      原版每次都全页通配节点查询 + 逐元素读布局,是可感知的
 *      卡顿源。现改为:全页扫描只在启动 / resize / 滚动停止 800ms 后执行,
 *      收集「可滚容器」(中控台恒为 1~3 个)缓存;scroll 回调只读缓存容器
 *      的 scrollTop。开关关闭时连监听器与定时器一起摘除(停用必须真停)。
 *   7. 2026-10-14 用户定(修「点回顶把左边直播互动栏的评论也一起滚了」):
 *      回顶**只允许作用于「页面滚动链」** —— 所有包含页顶锚点、或包含
 *      商品列表容器(全页 scrollHeight 最大的可滚容器)的可滚容器,
 *      再加 window。链外的滚动容器(左边直播互动栏的评论列表、侧栏
 *      菜单等)一律不碰,它们自成一体的滚动状态必须原样保留。
 *      旧版把「不含锚点的其它滚动容器」也一并归零(见 planAlignScroll
 *      的分支 2),互动栏评论正是被这一支带走的。
 *   8. 2026-10-21 用户报「点击时按钮动效卡,还没开播」:
 *      点击路径原先每次全页扫描(万级节点+逐元素布局读),点击当帧被
 *      同步阻塞,按钮动效当场冻结 —— 开销与开播无关,故没开播也卡。
 *      修法两案(用户拍板两案一起修):
 *      ① 「页面滚动链」缓存化:点击读缓存,失效自愈(容器脱链/锚点变更
 *         才现场重扫),见「页面滚动链缓存」段;
 *      ② 滚动进行期间环动画暂停(300ms 无 scroll 事件即恢复,3s 兜底),
 *         变速绕圈节奏与环外观零改动,见 pauseRingDuringScroll。
 *
 * 外观口径(2026-10-11 用户拍板):
 *   · 浮现后未指向:半透明;指向:显形
 *   · 指向时按钮外圈出现一根细线,变速逆时针绕圈:
 *     12点→6点(经9点)快;6点→12点(经3点)由快到慢;
 *     回到12点停顿一会,再进入下一圈,无限循环
 *   · 图标:纯 SVG 箭头(不依赖字体渲染);滚动动画用平滑 smooth
 *   · 2026-10-11 用户定「置顶箭头优化」:位置贴浏览器右下角
 *     (right/bottom 各 24px,避开横竖两条滚动轴约 17px);
 *     尺寸放大一半 44→66px(SVG 等比放大,观感不变)
 *   · 2026-10-11 用户补充:按钮不随页面缩放变大变小(物理尺寸恒定)
 *     —— 【2026-10-11 用户 22:0x 推翻】:改为**跟随页面缩放**,
 *     与普通页面元素同权,任何缩放/刷新观感一致(补偿机制已删除)
 *   · 2026-10-11 用户再定:整体缩小 20%(66→52.8px,SVG 60→48 等比);
 *     水平位置改到「最右两根竖向滚动条之间的空档」正中间(动态测量
 *     各容器滚动条位置,量不到时退回贴窗口滚动条左侧的旧口径);
 *     纵向仍贴底 24px。位置随 resize / 滚动停止后的校准一起刷新
 *   · 2026-10-11 用户 20:4x 实测纠偏:空档不够宽时按钮会压住两根滚动条 —
 *     改为只落「放得下(按钮 + 两侧各 8px)的最右空档」正中间;
 *     都放不下则贴最左滚动条左侧留 8px;一根都量不到才退回 right=24 旧口径
 *   · 2026-10-11 用户 21:4x 再定:水平位置**贴最右边,但不能碰到滚动条**
 *     —— 右缘 = 窗口滚动条左缘再留 2px。此前「滚动条空档动态找位」
 *     实测无效(直接把按钮放到了滚动条正中间),整套废弃;
 *     只保留一个最可靠的实测量:innerWidth - clientWidth(窗口滚动条宽)
 *   · 2026-10-11 用户 22:1x 再定:按钮放在**商品列表滚动条**与
 *     **浏览器最右滚动条**之间,两墙各留 2px 互不接触;空间不够时
 *     首选不接触商品列表的滚动条(宁可盖到窗口滚动条)。
 *     左墙取「内部容器竖向滚动条的最右缘」,放得下则右缘贴右墙保持贴最右
 * ============================================================ */

(function dycBackToTop() {
  'use strict';

  // 防重复注入(SPA 路由回切、脚本意外重跑时不会叠出两个按钮)
  if (window.__dycBackTopLoaded) return;
  window.__dycBackTopLoaded = true;

  var SHOW_AFTER = 300;    // 最终兜底阈值(锚点/导航头都找不到时用)
  var BTN_SIZE = 52.8;     // 按钮直径(66 × 0.8)
  var SCROLL_EVENT_OPTS = { capture: true, passive: true };

  /* ---------- 页面缩放口径(2026-10-11 用户 22:0x 定稿) ----------
   * 两个浮动按钮**跟随页面缩放**:浏览器怎么缩放,按钮就跟着怎么变大变小,
   * 任何缩放状态下刷新,观感都完全一致(与普通页面元素同权)。
   * 此前的「BASE_DPR 基准式 zoom 补偿」已按用户反馈整体删除 ——
   * 那套方案缩放时按钮物理尺寸不变(相对页面显小),刷新后基准重置
   * 又会变回跟随缩放,前后不一致,正是用户要修的问题。 */

  /* ---------- 水平定位(2026-10-11 用户 22:1x 定稿) ----------
   * 按钮放在「商品列表滚动条」与「浏览器最右滚动条」之间,
   * 两墙各留 2px,绝不压条带;空间不够时**首选不接触商品列表的滚动条**。
   *   左墙 = 内部容器竖向滚动条的最右缘(真实渲染了滚动条、且位于
   *          窗口滚动条左侧的;商品列表是最靠右的内部滚动条时,左墙就是它)
   *   右墙 = 窗口滚动条左缘(innerWidth - clientWidth,无则视为贴屏)
   *   空档放得下(按钮 + 两侧各 2px)→ 右缘贴右墙内侧,保持贴最右;
   *   放不下 → 按钮左缘贴左墙 + 2px,宁可盖到窗口滚动条也不碰商品列表。
   * 量不到内部滚动条 → 退回贴窗口滚动条左侧。
   * 定位时机:启动(经 recollect)/ resize / 滚动停止 800ms 后校准,
   * 全部低频,不给滚动帧添负担。按钮跟随页面缩放,间隙按 CSS 像素
   * 恒定,缩放后依旧成立。 */
  var RIGHT_GAP = 2;  // 与右墙(窗口滚动条)的间隙
  var LEFT_GAP = 2;   // 与左墙(商品列表滚动条)的间隙
  var MIN_SB_W = 8;   // 视宽-内容宽 ≥ 此值才算真渲染了竖向滚动条

  function placeBetweenScrollbars(btn, scrollables) {
    var winSB = window.innerWidth - document.documentElement.clientWidth;
    if (!(winSB > 0)) winSB = 0;               // 窗口没渲染滚动条
    var wL = window.innerWidth - winSB;        // 右墙:窗口滚动条左缘

    /* 左墙:内部滚动条条带的最右缘 */
    var pR = -1;
    for (var i = 0; i < scrollables.length; i++) {
      var el = scrollables[i];
      var r, sb;
      try {
        r = el.getBoundingClientRect();
      } catch (e) {
        continue;
      }
      if (!r || r.width <= 0 || r.height <= 0) continue;
      if (r.right <= 0 || r.right > window.innerWidth + 1) continue;
      sb = r.width - el.clientWidth;           // 边框盒宽-内容盒宽 ≈ 滚动条
      if (!(sb >= MIN_SB_W)) continue;         // 没渲染竖向滚动条
      if (r.right <= wL && r.right > pR) pR = r.right;
    }

    var right;
    if (pR > 0 && wL - pR >= BTN_SIZE + RIGHT_GAP + LEFT_GAP) {
      /* 空档放得下:右缘贴右墙内侧(保持贴最右) */
      right = winSB + RIGHT_GAP;
    } else if (pR > 0) {
      /* 放不下:首选不碰商品列表滚动条——左缘贴左墙 + LEFT_GAP,
       * 右侧宁可盖到窗口滚动条(用户 22:1x 定的优先级) */
      right = window.innerWidth - pR - LEFT_GAP - BTN_SIZE;
    } else {
      /* 量不到内部滚动条:退回贴窗口滚动条左侧 */
      right = winSB + RIGHT_GAP;
    }
    if (!(right > 0)) right = 0;
    btn.style.right = right + 'px';
  }

  /* ---------- 样式(自含,类名加 dyc- 前缀防撞) ---------- */
  function injectStyle() {
    if (document.getElementById('dyc-back-top-style')) return;
    var st = document.createElement('style');
    st.id = 'dyc-back-top-style';
    st.textContent = [
      '.dyc-back-top {',
      /* 2026-10-13 用户定:全程半透明0.55显示,不再根据顶部锚点隐藏;
         与下滑到底按钮保持在同一纵轴,right留滚动条间隙。
         2026-10-13 再调:下滑到底的气泡改挂按钮下方,下面那枚按钮需
         下移空间 → 这两枚按钮整体上移 32px;本按钮是上面那枚,
         bottom 84.8 → 116.8px(= 下滑到底 56 + 52.8 + 8 gap),
         两按钮间隙与各自气泡朝向(本按钮气泡仍朝上)均不变 */
      '  position: fixed; right: 20px; bottom: 116.8px;',
      '  width: 52.8px; height: 52.8px; border-radius: 50%;',
      '  background: #ffffff; border: 1px solid rgba(0,0,0,.15);',
      '  box-shadow: 0 2px 8px rgba(0,0,0,.18);',
      '  display: flex; align-items: center; justify-content: center;',
      '  cursor: pointer; z-index: 2147483000;',
      '  opacity: .55; visibility: visible; transform: none;',
      '  transition: opacity .2s ease-out, transform .2s ease-out, visibility .2s;',
      '  padding: 0; outline: none;',
      '}',
      /* 全程半透明0.55,鼠标指向取消透明 */
      '.dyc-back-top:hover { opacity: 1; background: #f5f6f7; }',
      '.dyc-back-top:active { background: #ecedee; }',
      '.dyc-back-top svg { display: block; }',
      /* 细线环:平时不显示,指向按钮时出现并绕圈 */
      '.dyc-back-top .dyc-btt-ring { opacity: 0; transition: opacity .2s ease; }',
      '.dyc-back-top:hover .dyc-btt-ring {',
      '  opacity: 1;',
      '  animation: dyc-btt-ring 2.6s linear infinite;',
      '}',
      /* 变速绕圈:pathLength=100 归一化。
         0→36% 前半圈(12点→6点,经9点)快,线性;
         36%→86% 后半圈(6点→12点,经3点)由快到慢;
         86%→100% 停在12点,然后进入下一圈 */
      '@keyframes dyc-btt-ring {',
      '  0%   { stroke-dashoffset: 0;   animation-timing-function: linear; }',
      '  36%  { stroke-dashoffset: 50;  animation-timing-function: cubic-bezier(.35,.45,.25,1); }',
      '  86%  { stroke-dashoffset: 100; animation-timing-function: linear; }',
      '  100% { stroke-dashoffset: 100; }',
      '}',
      /* 悬停气泡(2026-10-11 用户 22:2x 定,与搜索按钮 .dyc-tip 同款):
         上方黑底小箭头气泡,文案「上滑到顶」;全程显示,hover时气泡出现 */
      '.dyc-back-top .dyc-tip {',
      '  position: absolute; bottom: calc(100% + 10px); left: 50%;',
      '  transform: translateX(-50%);',
      '  background: rgba(20,20,20,.92); color: #ffffff;',
      '  font-size: 12.5px; padding: 6px 10px; border-radius: 6px;',
      '  white-space: nowrap; opacity: 0; pointer-events: none;',
      '  transition: opacity .15s ease;',
      '}',
      '.dyc-back-top .dyc-tip::after {',
      '  content: ""; position: absolute; top: 100%; left: 50%; margin-left: -4px;',
      '  border: 4px solid transparent; border-top-color: rgba(20,20,20,.92);',
      '}',
      '.dyc-back-top:hover .dyc-tip { opacity: 1; }',
      /* 滚动期间暂停环动画(2026-10-21,方案二):smooth 滚动是主线程行为,
         环的 stroke 动画也是主线程重绘,两者叠加时环动画掉帧 ——
         发起滚动后给按钮挂 .dyc-rolling 把环冻住,滚动停止即摘除;
         写在 animation 简写规则之后,同特异性后者层叠胜出。
         变速绕圈节奏与环外观零改动,只是滚动那几秒先冻住 */
      '.dyc-back-top.dyc-rolling .dyc-btt-ring { animation-play-state: paused; }'
    ].join('\n');
    (document.head || document.documentElement).appendChild(st);
  }

  /* 按钮 SVG = 细线环 + 纯 SVG 上箭头(用户定:不依赖字体)。
     画布仍按 44 设计,靠 width/height=48 等比放大到 52.8px 按钮的 48/52.8
     (与旧版 60/66 同比例),线条粗细随之等比缩放,观感不变 */
  var BUTTON_SVG =
    '<svg width="48" height="48" viewBox="0 0 44 44" aria-hidden="true">' +
    // 细线环:pathLength=100 归一化;dasharray「25 75」= 90° 弧;
    // rotate(-90) 把弧起点转到 12 点钟方向;dashoffset 增大时弧逆时针走
    '<circle class="dyc-btt-ring" cx="22" cy="22" r="20.5" pathLength="100" ' +
    'fill="none" stroke="rgba(51,51,51,.8)" stroke-width="1.5" ' +
    'stroke-linecap="round" stroke-dasharray="25 75" stroke-dashoffset="0" ' +
    'transform="rotate(-90 22 22)"/>' +
    // 箭头:沿用原 20x20 造型,平移到 44 画布中心
    '<g transform="translate(12 12)">' +
    '<path d="M10 16V5M10 5l-5.5 5.5M10 5l5.5 5.5" stroke="#333" ' +
    'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" ' +
    'fill="none"/></g>' +
    '</svg>';

  /* ---------- 滚动容器收集 ---------- */

  /**
   * 全页收集「可滚」的容器(scrollHeight > clientHeight)。
   *
   * ⚠️ 只允许在低频时机调用:启动 / resize / 滚动停止 800ms 后。
   * 中控台页面节点上万,scroll 回调里绝不能跑这个(每帧一次全页扫描
   * + 逐元素强制布局,是可感知的卡顿源)—— 滚动进行中容器集合不会变,
   * 读缓存即可,见 start() 里的 onScroll。
   */
  function collectScrollables() {
    var out = [];
    var all = document.querySelectorAll('*');
    for (var i = 0; i < all.length; i++) {
      var el = all[i];
      // 跳过我们自己的按钮容器
      if (el.closest && el.closest('.dyc-back-top')) continue;
      if (el.scrollHeight > el.clientHeight + 1) out.push(el);
    }
    return out;
  }

  /* ---------- 页面滚动链(2026-10-14 用户定) ----------
   * 回顶只允许作用于「页面滚动链」,链外的滚动容器一律不碰 ——
   * 左边直播互动栏的评论列表、侧栏菜单等都自成一体的滚动区,
   * 用户明确要求「无论上滑到顶还是下滑到底,都禁止影响它们的滚动状态」。
   *
   * 怎么把「页面链」和「侧栏面板」分开:不用 class(带构建哈希、会变),
   * 用两个结构参照物 ——
   *   ① 页顶锚点 .container-e6f75f(回顶本来就以它为准)
   *   ② 全页 scrollHeight 最大的可滚容器(实测恒为商品列表容器,
   *      内容高约 31752px;互动栏评论列表、侧栏菜单都远矮于它)
   * 页面链 = 所有**包含任一参照物**的可滚容器。中控台的外层页面容器
   * 与内层商品容器必在链上(一个含锚点、一个含商品列表);左边直播
   * 互动栏的评论列表两者都不含,自然被排除。两个参照物互补:锚点
   * 缺失(平台改版换哈希)时靠②,页面没有长列表时靠①。 */

  /** 页面链参照物:页顶锚点 + 全页最高的可滚容器(去重) */
  function chainRefs(all) {
    var refs = [];
    var anchor = findTopAnchor();
    if (anchor) refs.push(anchor);
    var best = null, bestH = 0;
    for (var i = 0; i < all.length; i++) {
      var el = all[i];
      if (el === document.documentElement || el === document.body) continue;
      if (el.scrollHeight > bestH) { bestH = el.scrollHeight; best = el; }
    }
    if (best && refs.indexOf(best) < 0) refs.push(best);
    return refs;
  }

  /** 页面滚动链:所有包含任一参照物的可滚容器(不含 html/body,页面级交 window) */
  function collectPageChain() {
    var all = collectScrollables();
    var refs = chainRefs(all);
    if (!refs.length) return [];
    var out = [];
    for (var i = 0; i < all.length; i++) {
      var el = all[i];
      if (el === document.documentElement || el === document.body) continue;
      for (var r = 0; r < refs.length; r++) {
        var has = false;
        try { has = el === refs[r] || el.contains(refs[r]); } catch (e) { has = false; }
        if (has) { out.push(el); break; }
      }
    }
    return out;
  }

  /* ---------- 页面滚动链缓存(2026-10-21 修「点击时按钮动效卡」) ----------
   * 点击处理器原先每次都调 collectPageChain() —— 全页通配扫描 + 逐元素
   * 布局读(万级节点),恰在用户盯着按钮动效的点击当帧同步执行,
   * 这一帧被阻塞几百毫秒,按钮动效当场冻结。工程第 6 条实现要点早已
   * 认定这套扫描是可感知的卡顿源,此处把点击路径也摘掉:
   *   链内容稳定(外层页面容器 + 内层商品容器,恒 1~3 个) → 缓存;
   *   点击时先校验缓存,失效才现场重扫一次(失效自愈):
   *     ① 任一容器脱离文档 / 不再可滚 → 失效
   *     ② 页顶锚点与收集时不一致(同一元素引用才算) → 失效
   *     ③ 锚点存在但已不被链上任何容器包含 → 失效
   * resize 时置空缓存(onResize),其余时机靠校验兜住。 */

  var chainCache = null;

  function chainValid(cache) {
    if (!cache || !cache.list || !cache.list.length) return false;
    for (var i = 0; i < cache.list.length; i++) {
      var el = cache.list[i];
      if (!el || !el.isConnected) return false;
      if (el.scrollHeight <= el.clientHeight + 1) return false;
    }
    var anchor = findTopAnchor();
    if (anchor !== (cache.anchorEl || null)) return false;
    if (anchor) {
      for (var j = 0; j < cache.list.length; j++) {
        var c = cache.list[j];
        if (c === anchor) return true;
        try { if (c.contains(anchor)) return true; } catch (e) { /* 试下一个 */ }
      }
      return false;
    }
    return true;
  }

  /** 点击路径入口:读缓存,失效才全页重扫(正常情况零扫描、零布局读) */
  function getChain() {
    if (chainValid(chainCache)) return chainCache.list;
    var anchor = findTopAnchor();
    chainCache = { list: collectPageChain(), anchorEl: anchor || null };
    return chainCache.list;
  }

  /* ---------- 按钮行为 ---------- */

  /* 2026-10-12 用户定稿(覆盖 21:4x 的 2H 口径):页顶锚点 = container-e6f75f,
   * 「以这个元素栏,向上方减掉一个自身的高度,为顶」——
   * 元素顶边最终落在视口顶下方 1H 处(H = 自身框高,点击瞬间实测)。
   * 后缀是构建哈希,不做前缀兜底;找不到走 导航头 → 全部归零 兜底链。
   * (中间方案 content-f7460f 按用户反馈「还是失败」废弃;
   *  aurora-spin-container 曾被提名,同样以失败告终,均不再保留。) */
  var TOP_ANCHOR_SELECTOR = '.container-e6f75f';
  /* 页顶偏移的自身高度倍数(2026-10-12 用户定:1 倍,旧值 2) */
  var TOP_ANCHOR_H_MULT = 1;

  function findTopAnchor() {
    return document.querySelector(TOP_ANCHOR_SELECTOR);
  }

  /**
   * 中控台是否已经「进到页面里」（商品列表真的渲染出行了）。
   *
   * ★ 2026-10-18 修用户报的「还没进网页就常驻显示了」：
   *   两枚滚动钮从 2026-10-13 起是**全程半透明常驻**（不再按页顶锚点隐藏），
   *   而 start() 在 DOMContentLoaded 后就 appendChild —— 于是页面还在骨架屏 /
   *   白屏阶段，右下角就已经挂着两枚圆钮，点它也没东西可滚。用户看到的就是 bug。
   *
   *   判据落在「读到商品行」这一层，不用「锚点元素存在」：
   *   骨架屏阶段 .container-e6f75f 往往已经在 DOM 里了（空壳），按它判会提早露脸。
   *   与 search.js 的 listReady() 保持同一口径 —— 三个浮动控件要么一起出，要么一起不出。
   */
  function pageReady() {
    /* 直接复用 locate.js 的 hasProductRows()（2026-10-18）——
     * 三个浮动控件问的是同一个问题，判据必须同源，否则会出现
     * 「按钮出来了、搜索却说不就绪」这种自相矛盾的状态。
     * 那边已经按「零布局读 → 一次读 → 真识别」三级台阶做过成本优化。 */
    if (typeof hasProductRows === 'function') {
      try { return hasProductRows(); } catch (e) { /* 退回本地判定 */ }
    }
    try {
      if (typeof getScrollContainer !== 'function') return false;
      if (!getScrollContainer()) return false;
      const items = (typeof getProductItems === 'function') ? (getProductItems() || []) : [];
      return !!(items && items.length);
    } catch (e) { return false; }
  }

  /**
   * 换算全部滚动容器的目标 scrollTop,返回一个**完整的滚动计划**。
   *
   * 2026-10-13 重构(用户报「两个容器不受上滑/下滑控制」后):
   *   旧版只在「含锚点的容器链」上逐层分摊位移,链外的容器一律归零、
   *   链上却没被分摊到的容器既不归零也不滚动 —— 于是中控台的外层
   *   页面容器完全不受控。
   *
   *   新口径按「回顶」的语义拆成三类,一次算全:
   *     (1) 链上除最内层外 → **一律归零**(外层页面容器回顶);
   *         归零会让锚点(在其后代里)随之下移,累计进 shift
   *     (2) 不含锚点的其它滚动容器 → 归零(与锚点位置无关)。
   *         2026-10-14 起 scrolled 只传「页面滚动链」,故这一支通常
   *         无事可做;仅在导航头口径(导航头不在内容根之内)时才起作用,
   *         仍保留 —— 它保证回顶时商品容器也一并归零。
   *     (3) 最内层(直接包裹锚点的滚动容器)→ 承担对齐:
   *         目标 = 当前 scrollTop + delta + shift,让目标元素最终停在
   *         视口顶下方 offset 处;window 亦归零(计入 shift)
   *   目标元素不被任何元素容器包含时,由 window 独自承担对齐。
   *   目标元素未渲染(宽高均为 0)返回 null 走兜底链。
   *
   * @param {Element} target       要对齐到视口顶的目标元素(锚点 / 导航头)
   * @param {Element[]} scrolled   页面滚动链(collectPageChain 结果);
   *                               2026-10-14 起不再传「全部可滚容器」——
   *                               链外的侧栏面板(直播互动栏等)不归本功能管
   * @param {number=} fixedOffset  目标元素顶边距视口顶的固定像素;
   *                               省略/传 null 时取 N × 自身高度(锚点口径)
   */
  function planAlignScroll(target, scrolled, fixedOffset) {
    var rect;
    try {
      rect = target.getBoundingClientRect();
    } catch (e) {
      return null;
    }
    if (!rect || !isFinite(rect.top) || !isFinite(rect.height)) return null;
    if (rect.width === 0 && rect.height === 0) return null;  // 未渲染
    var anchor = target;

    /* 含锚点的滚动容器链,内层在前(被包含者排前面)。
       contains 对自身也返回 true —— 锚点若本身就是某个滚动容器,
       它会出现在链首(最内层)。 */
    var docEl = document.documentElement;
    var chain = [];
    for (var i = 0; i < scrolled.length; i++) {
      var el = scrolled[i];
      /* html / body 不作「元素承担层」——页面级滚动统一交给 window,
         否则标准模式下对 body.scrollTop 的写入会被忽略,锚点对不齐 */
      if (el === docEl || el === document.body) continue;
      var has = false;
      try { has = el.contains(anchor); } catch (e) { has = false; }
      if (has) chain.push(el);
    }
    chain.sort(function (a, b) {
      if (a.contains(b)) return 1;
      if (b.contains(a)) return -1;
      return 0;
    });

    var offset = (fixedOffset === undefined || fixedOffset === null)
      ? TOP_ANCHOR_H_MULT * rect.height   // 锚点口径:让出 N 个自身高度
      : fixedOffset;                       // 导航头口径:让出 nav-menu 高度
    var delta = rect.top - offset;         // 目标元素需要的净上移量
    var plan = [];
    var shift = 0;   // 各「归零层」归零后,锚点相对视口下移的累计量

    /* (1) 链上除最内层外全部归零 —— 外层页面容器回到顶部。
           归零 = scrollTop 减小 → 内容下移 → 锚点下移,记入 shift,
           稍后由最内层补偿。 */
    for (var k = chain.length - 1; k >= 1; k--) {
      var cel = chain[k];
      if (cel.scrollTop > 0) {
        plan.push({ el: cel, top: 0 });
        shift += cel.scrollTop;
      }
    }

    /* (2) 不含锚点的其它滚动容器:与锚点位置无关,一律归零
           (html / body 同样跳过,页面级滚动由 (3) 的 window 统一处理) */
    for (var j = 0; j < scrolled.length; j++) {
      var se = scrolled[j];
      if (se === docEl || se === document.body) continue;
      if (chain.indexOf(se) >= 0) continue;
      if (se.scrollTop > 0) {
        plan.push({ el: se, top: 0 });
      }
    }

    /* (3) window 与最内层:最内层负责把锚点停在目标线 */
    var curY = window.scrollY || window.pageYOffset || 0;
    if (chain.length > 0) {
      if (curY > 0) {
        plan.push({ el: null, top: 0 });
        shift += curY;
      }
      var inner = chain[0];
      var max = inner.scrollHeight - inner.clientHeight;
      var innerTop = inner.scrollTop + delta + shift;
      if (innerTop < 0) innerTop = 0;
      if (innerTop > max) innerTop = max;
      plan.push({ el: inner, top: innerTop });
    } else {
      /* 锚点不被任何元素滚动容器包含:window 独自承担对齐 */
      var winMax = Math.max(docEl.scrollHeight - docEl.clientHeight, 0);
      var wy = curY + delta;
      if (wy < 0) wy = 0;
      if (wy > winMax) wy = winMax;
      if (wy !== curY) plan.push({ el: null, top: wy });
    }
    return plan;
  }

  /* 2026-10-11 用户改口径(现降为一级兜底):让导航头对齐浏览器视口顶部。
   * 目标元素 class 为 navHeader-e6f75f —— 后缀是构建哈希,抖店改版可能变,
   * 所以精确选择器找不到时退到前缀匹配 [class*="navHeader-"]。 */
  var HEADER_SELECTOR = '.navHeader-e6f75f';
  var HEADER_SELECTOR_LOOSE = '[class*="navHeader-"]';

  /* 2026-10-11 用户加:顶部要让出的导航条(高度作为回顶偏移量)。
   * 后缀 __3bJBv 是构建哈希,同样做前缀兜底;找不到则偏移为 0(旧行为) */
  var NAV_MENU_SELECTOR = '.nav-menu_wrapper__3bJBv';
  var NAV_MENU_SELECTOR_LOOSE = '[class*="nav-menu_wrapper"]';

  function findNavHeader() {
    return document.querySelector(HEADER_SELECTOR) ||
           document.querySelector(HEADER_SELECTOR_LOOSE);
  }

  function findNavMenu() {
    return document.querySelector(NAV_MENU_SELECTOR) ||
           document.querySelector(NAV_MENU_SELECTOR_LOOSE);
  }

  /* 取元素渲染高度:优先 getBoundingClientRect(带小数精度),
   * 异常或为 0 时退 offsetHeight;都拿不到按 0 处理(不加偏移) */
  function measureHeight(el) {
    var h = 0;
    try {
      var r = el.getBoundingClientRect();
      if (r && isFinite(r.height)) h = r.height;
    } catch (e) { /* 旧内核异常时走 offsetHeight */ }
    if (!(h > 0)) h = el.offsetHeight || 0;
    return h > 0 && isFinite(h) ? h : 0;
  }

  /* 滚动期间暂停环动画(2026-10-21,方案二):
   * 发起滚动前挂 .dyc-rolling;「300ms 无 scroll 事件」判定滚动停止后摘除,
   * 3s 兜底强制恢复(防平滑滚动事件流异常导致环永久冻结)。
   * 监听用 document 捕获(scroll 不冒泡但进捕获阶段,工程既有做法),
   * passive;每个监听只服务一次点击,结束自摘,多次点击各管各的互不干扰。 */
  function pauseRingDuringScroll(btn) {
    btn.classList.add('dyc-rolling');
    var last = Date.now();
    var stopTimer = null;
    function done() {
      clearTimeout(fallback);
      if (stopTimer) clearTimeout(stopTimer);
      document.removeEventListener('scroll', onScroll, SCROLL_EVENT_OPTS);
      btn.classList.remove('dyc-rolling');
    }
    function onScroll() {
      last = Date.now();
      if (stopTimer) clearTimeout(stopTimer);
      stopTimer = setTimeout(function () {
        if (Date.now() - last >= 280) done();
      }, 300);
    }
    var fallback = setTimeout(done, 3000);
    document.addEventListener('scroll', onScroll, SCROLL_EVENT_OPTS);
  }

  function createButton() {
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'dyc-back-top';
    btn.setAttribute('aria-label', '上滑到顶');
    btn.innerHTML = BUTTON_SVG
      // 悬停气泡(2026-10-11 用户 22:2x 定:与搜索按钮同款,上方黑底带箭头)
      + '<span class="dyc-tip">上滑到顶</span>';

    btn.addEventListener('click', function () {
      // 2026-10-21:collectPageChain() 换 getChain() —— 读缓存+失效自愈,
      // 点击当帧不再全页扫描(见「页面滚动链缓存」段)。
      /* 2026-10-14 用户定:只作用于「页面滚动链」(见 collectPageChain)。
       * 链外的滚动容器 —— 左边直播互动栏的评论列表、侧栏菜单等 ——
       * 一律不碰:它们的滚动状态与「页面回顶」无关,不得被改变。 */
      var chain = getChain();
      /* 页顶链:container-e6f75f 实测换算(锚点口径,让出 1H)
       *        → 导航头(让出 nav-menu 高度)
       *        → 页面链全部归零
       * 2026-10-13:三级路径统一走 planAlignScroll —— 链上除最内层一律
       * 归零、最内层承担对齐,保证中控台「外层页面容器」与「内层商品
       * 容器」两个滚动层同时受控(旧版外层容器会失控)。 */
      var plan = null;
      var anchor = findTopAnchor();
      if (anchor) plan = planAlignScroll(anchor, chain, null);

      if (!plan) {
        var header = findNavHeader();
        if (header) {
          var menu = findNavMenu();
          var menuH = menu ? measureHeight(menu) : 0;
          plan = planAlignScroll(header, chain, menuH);
        }
      }

      if (!plan) {
        /* 最终兜底:页面链 + window 全部归零(链外依旧不碰) */
        plan = [{ el: null, top: 0 }];
        for (var z = 0; z < chain.length; z++) {
          if (chain[z].scrollTop > 0) plan.push({ el: chain[z], top: 0 });
        }
      }

      /* 2026-10-18 用户定「检查一下其他按钮有没有漏设计弹提示」:
       * 这一枚原先点了**完全没有回声** —— 只有在「本来就已经在顶部」时才会
       * 显得像坏了(点了、没动、也没话说)。
       *
       * 取舍:正常滚动本身有视觉反馈,不必每次都报一句(那是噪音);
       * 只在这种「点了看起来没反应」的时刻说一声。判据取点击**当帧**的
       * 位置(平滑滚动开始前),最准也最省。
       */
      var alreadyTop = window.scrollY <= 2 || (document.scrollingElement || document.documentElement).scrollTop <= 2;
      if (alreadyTop) {
        for (var c = 0; c < chain.length; c++) {
          if (chain[c].scrollTop > 2) { alreadyTop = false; break; }
        }
      }
      if (alreadyTop && typeof toast === 'function') {
        toast('已经在顶部', 'info', { source: '上滑到顶' });
        return;
      }

      /* 程序化滚动豁免(2026-10-21 修「全能搜索时指示灯一直闪」,圆钮同类):
       * 告诉 auto-refresh 这场滚动是我们发起的,别让「滚动中藏灯」闪灯。
       * smooth 动画的事件流约半秒,窗口给 800ms。 */
      /* 方案二(2026-10-21):滚动进行期间冻结环动画,别让主线程动画挤帧 */
      pauseRingDuringScroll(btn);
      window.__dycScriptScrollAt = Date.now();
      window.__dycScriptScrollFor = 800;
      for (var p = 0; p < plan.length; p++) {
        var t = plan[p];
        try {
          if (t.el) t.el.scrollTo({ top: t.top, left: 0, behavior: 'smooth' });
          else window.scrollTo({ top: t.top, left: 0, behavior: 'smooth' });
        } catch (e) {
          /* 旧内核兜底:直接置位(无动画) */
          if (t.el) t.el.scrollTop = t.top;
          else window.scrollTo(0, t.top);
        }
      }
    });

    return btn;
  }

  /* ---------- 主流程 ---------- */

  function start() {
    injectStyle();

    var btn = createButton();
    /* ★ 2026-10-18：**先藏起来**，等列表就绪再露面。
     *   原来这里直接 appendChild —— 按钮样式是 `opacity:.55; visibility:visible`，
     *   挂上就可见，于是骨架屏阶段就已经在右下角常驻了（用户报的就是这个）。
     *   这里只设初始隐藏，不去动 injectStyle 里的基态：
     *   基态仍是「可见」，重判时把 display 改回来即可，不需要 reset 一堆类。
     */
    btn.style.display = 'none';
    (document.body || document.documentElement).appendChild(btn);
    /* 浮层让位(2026-11-01，反馈 #126/#127):平台弹窗 / 抽屉 / 下拉面板盖住这枚钮时
     * 自动隐藏，浮层关掉自动恢复。判据与心跳都在 src/content/overlay-guard.js，
     * 这里只做节点登记;它用 visibility 叠加，与 paint() 的 display 状态机互不覆盖。 */
    if (window.dycOverlayGuard && typeof window.dycOverlayGuard.bind === 'function') {
      window.dycOverlayGuard.bind(btn);
    }

    /* 可滚容器缓存:全页扫描只在低频时机跑,scroll 回调只读缓存 */
    var scrollables = [];
    var recollectTimer = null;
    var listening = false;

    function recollect() {
      scrollables = collectScrollables();
    }

    function onResize() {
      recollect();
      chainCache = null;   // resize 后布局变了,链缓存作废,下次点击重扫
    }

    function bind() {
      if (listening) return;
      listening = true;
      window.addEventListener('resize', onResize, SCROLL_EVENT_OPTS);
      recollect();  // 进场先收集一次
    }

    /** 停用必须真停:监听器与待执行的校准定时器一起摘除 */
    function unbind() {
      if (!listening) return;
      listening = false;
      window.removeEventListener('resize', onResize, SCROLL_EVENT_OPTS);
      if (recollectTimer) {
        clearTimeout(recollectTimer);
        recollectTimer = null;
      }
    }

    /* 这里**不再无条件 bind()** —— 交给 paint() 按三态决定。
     * 旧版挂上就绑监听，隐藏期间也留着 resize 监听，属「停用没真停」。 */

    // 开关:关掉即摘除监听,再开即重建(与其他功能「即时生效」口径一致)
    // ★ 2026-10-18:本钮现在受**两层**开关约束 —— 一级行 scrollBtns(总闸)
    //   与自身 backToTop(子开关)。两者是「与」关系:总闸关 ⇒ 无论子开关
    //   什么状态都不出现;总闸再开 ⇒ 按子开关自己存的值恢复(总闸不覆写它)。
    //   这是用户给 #90 定的「一键全关」语义 —— 好处是关总闸不会清掉用户的
    //   子开关设置,代价是总闸关着时拨子开关画面不变化。
    /* ★ 2026-10-18：显示与否改成三态判断 ——
     *     · 开关关           → 摘掉（旧行为）
     *     · 开关开、但没就绪 → 挂着但 display:none（等就绪轮询把它放出来）
     *     · 开关开、且已就绪 → display:flex（旧行为）
     *   不做这一步的话，「还没进页面就常驻」修好了也会变成「进来了也不出来」。
     */
    var wantOn = false;      // 开关是否允许显示（不含就绪条件）
    var scrollSyncBound = false;
    var readyTimer = null;
    var readyTries = 0;
    var READY_MAX_TRIES = 200;   // × 250ms ≈ 50 秒

    function paint() {
      if (!wantOn) { unbind(); btn.remove(); return; }
      if (!pageReady()) { btn.style.display = 'none'; waitReady(); return; }
      btn.style.display = '';
      if (!btn.isConnected) {
        (document.body || document.documentElement).appendChild(btn);
      }
      bind();
    }

    /** 等列表就绪：就绪那一刻重判一次，然后停（上限 50 秒，之后靠用户滚动重判） */
    function waitReady() {
      if (readyTimer) return;
      readyTries = 0;
      (function tick() {
        readyTimer = null;
        if (!wantOn) return;
        if (pageReady()) { readyTries = 0; paint(); return; }
        if (++readyTries >= READY_MAX_TRIES) { readyTries = 0; return; }
        readyTimer = setTimeout(tick, 250);
      })();
    }

    function stopReady() {
      if (readyTimer) { clearTimeout(readyTimer); readyTimer = null; }
      readyTries = 0;
    }

    function apply(flagOn) {
      wantOn = !!flagOn;
      if (!wantOn) {
        stopReady();
        if (typeof btn.__dycUnbindScrollSync === 'function') btn.__dycUnbindScrollSync();
      }
      paint();
    }

    if (typeof dycReadFlags === 'function') {
      // 状态条统一反馈(2026-10-11):开关切换报一声,首次对齐不报
      var prevBackToTop = null;
      var prevScrollBtns = null;   // 2026-10-18 补:总闸自己的回声
      dycReadFlags().then(function (flags) {
        prevBackToTop = !!flags.backToTop;
        prevScrollBtns = flags.scrollBtns !== false;
        apply(prevScrollBtns && prevBackToTop);
      });
      if (typeof dycWatchFlags === 'function') {
        dycWatchFlags(function (flags) {
          // 总闸 scrollBtns 缺省为开(flags.js 里 default:true),
          // 所以 `!== false` 而不是 `=== true` —— 老存档里没这个键也要算开。
          var gate = flags.scrollBtns !== false;
          /* ★ 2026-10-18 用户定「检查一下其他按钮有没有漏设计弹提示」:
           *   总闸原先**只改行为、不出声** —— 关掉后两枚圆钮一起消失,
           *   左下角却什么也不说,用户只能自己猜是不是坏了。
           *   回声只在这里发一处(back-to-bottom.js 不再发),否则两个模块
           *   各报一条、同一次操作冒两条一模一样的提示。
           */
          if (prevScrollBtns !== null && gate !== prevScrollBtns && typeof toast === 'function') {
            toast(gate ? '已开启' : '已关闭', 'info', { source: '页面滚动按钮' });
          }
          prevScrollBtns = gate;

          var on = !!flags.backToTop;
          if (prevBackToTop !== null && on !== prevBackToTop && typeof toast === 'function') {
            toast(on ? '已开启' : '已关闭', 'info', { source: '上滑到顶' });
          }
          prevBackToTop = on;
          apply(gate && on);
        });
      }
    }
    /* flags 不可用（老内核 / 注入顺序异常）时的兜底：按「默认开」走三态。
     * 不写这一句的话，dycReadFlags 缺失会让 wantOn 停在 false —— 按钮永不出现，
     * 比原来「一直显示」更糟。 */
    else {
      apply(true);
    }

    /* 用户滚动时顺手重判一次：万一就绪轮询到上限放弃了，滚动这个动作能把状态补回来。
     * 这个监听**必须能摘**（「停用必须真停」是硬规矩）：所以存进变量，
     * 由 unbind() 一并移除，不在闭包里留一个摘不掉的匿名监听。
     * 判据固定为「要不要显示 = wantOn && pageReady()」，与 paint() 同一口径，
     * 免得两处各算一套、越改越乱。 */
    function onScrollSync() {
      if (!wantOn) return;
      var want = pageReady();
      var shown = btn.style.display !== 'none';
      if (want && !shown) paint();
      else if (!want && shown) btn.style.display = 'none';
    }
    if (!scrollSyncBound) {
      scrollSyncBound = true;
      window.addEventListener('scroll', onScrollSync, SCROLL_EVENT_OPTS);
    }
    function unbindScrollSync() {
      if (!scrollSyncBound) return;
      scrollSyncBound = false;
      window.removeEventListener('scroll', onScrollSync, SCROLL_EVENT_OPTS);
    }
    if (btn.__dycUnbindScrollSync) btn.__dycUnbindScrollSync();
    btn.__dycUnbindScrollSync = unbindScrollSync;
  }

  /* 等待 flags.js 的共享函数就绪(最多等 5 秒) */
  function waitForFlagsThenStart() {
    var waited = 0;
    var maxWait = 5000;
    var interval = 50;
    function tryStart() {
      if (typeof dycReadFlags === 'function') {
        start();
        return;
      }
      waited += interval;
      if (waited < maxWait) {
        setTimeout(tryStart, interval);
      } else {
        /* 超时仍尝试启动(函数不存在时内部会静默) */
        start();
      }
    }
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', tryStart, { once: true });
    } else {
      tryStart();
    }
  }
  waitForFlagsThenStart();
})();
