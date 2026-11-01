/**
 * 中控台快捷导航 · 定位控件(注册为工具栏的一个扩展位)
 *
 * 设计要点:
 *   1. 自建独立输入框,不复用也不干扰平台任何控件
 *   2. 锚点用「筛选」按钮的可见文字定位 —— 比 placeholder/class 稳定
 *   3. 插在筛选按钮右侧,与平台筛选功能互不影响
 *   4. **只接受数字序号**,不做文本搜索,不匹配款号或商品名
 *   5. 全程不点击商品,只滚动与描边
 *
 * 多域兼容(2026-10-11 补):
 *   中控台有两个域名入口 —— 抖店 fxg.jinritemai.com/ffa/content-tool/live/control、
 *   巨量百应 buyin.jinritemai.com/dashboard/live/control。
 *   两边页面结构大体相同,但工具栏文案未必一致,故锚点查找带
 *   「后期放宽」策略(见 findFilterAnchor)。
 *
 * 架构变更(2026-10-11,并行开发铺路):
 *   本文件原先是工具栏的**宿主** —— 自己找锚点、自己插入、自己维护重试链。
 *   现改为**一个普通的工具栏注册项**:
 *     · 插入、重试、开关启停、SPA 补插 都交给 src/live/toolbar.js
 *     · 本文件只管「这个功能长什么样、点了做什么」,末尾调一次 dycRegisterTool
 *   好处:以后往工具栏加「款号搜索」「快速回到顶部」等新控件,
 *   各自新开文件注册即可,**不需要再改本文件** —— 多会话并行不会在此处冲突。
 *
 *   锚点查找(findFilterAnchor)仍留在本文件,但已通过
 *   window.dycFindFilterAnchor 暴露给渲染器共用,不再是私有拷贝。
 */

(function navWidget() {
  'use strict';

  if (window.__DYB_NAV_INITIALIZED__) return;
  window.__DYB_NAV_INITIALIZED__ = true;

  const BOX_ID = 'dyb-nav-box';
  const INPUT_ID = 'dyb-nav-input';
  const BTN_ID = 'dyb-nav-go';

  // ---------------- 定位锚点 ----------------

  // 主锚点文案。抖店中控台工具栏固定有「筛选」,一直是首选。
  const PRIMARY_LABEL = '筛选';
  // 备选锚点:仅在**后期重试**阶段才启用(见 findFilterAnchor 的 lateStage)。
  // 用于巨量百应等结构略有差异的入口 —— 与其直接放弃,不如退一步找列表工具栏。
  const FALLBACK_LABELS = ['排序', '全部商品', '商品管理'];

  /**
   * 找平台的列表工具栏锚点,控件会插到它右侧。
   *
   * 用可见文字而非 class 定位。抖店 class 带构建哈希,靠不住。
   *
   * 两段式策略(多域兼容的关键):
   *   · 前期(lateStage=false)只认「筛选」—— 避免页面首屏渲染中途
   *     误锚到别处,把控件插到错误位置(一旦插成功就不会再纠正)。
   *   · 后期(lateStage=true)才放宽到 FALLBACK_LABELS。
   *     走到这里说明已经找了好几秒都没见到「筛选」,此时放宽不会误伤正常页面。
   *
   * 暴露为全局 dycFindFilterAnchor 供 toolbar.js 复用,
   * 避免两处各写一份、改版时只改了一处。
   *
   * @param {boolean} [lateStage] 是否已进入后期重试
   * @returns {Element|null}
   */
  function findFilterAnchor(lateStage) {
    const labels = lateStage
      ? [PRIMARY_LABEL].concat(FALLBACK_LABELS)
      : [PRIMARY_LABEL];

    const candidates = document.querySelectorAll(
      'button, [class*="select"], [class*="filter"], [class*="dropdown"], div, span'
    );

    // 记录命中的元素及其文案优先级,最后统一排序
    const hits = [];
    for (const el of candidates) {
      // 只看直接承载文字的最小节点
      const text = (el.innerText || '').replace(/\s+/g, ' ').trim();
      const rank = labels.indexOf(text);
      if (rank === -1) continue;

      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;

      hits.push({ el: el, rank: rank, top: r.top });
    }

    if (hits.length === 0) return null;

    // 「筛选」优先于任何备选;同优先级里取最靠上的那一个
    hits.sort(function (a, b) {
      return (a.rank - b.rank) || (a.top - b.top);
    });
    return hits[0].el;
  }

  // 把锚点查找暴露给工具栏渲染器(toolbar.js)复用。
  // 2026-10-11:此前「筛选」按钮的查找逻辑只存在于本文件,
  // 新功能要往工具栏加控件就得改本文件 —— 那正是并行开发的冲突点。
  // 暴露成全局函数后,渲染器直接复用同一套两段式策略,
  // 既不必各写一份,也不用再改本文件。
  window.dycFindFilterAnchor = findFilterAnchor;

  // ---------------- 构建控件 ----------------

  function buildWidget() {
    const wrap = document.createElement('div');
    wrap.id = BOX_ID;

    // 单行:输入框 + 定位按钮 + 商品总数
    wrap.innerHTML =
      '<input id="' + INPUT_ID + '" type="text" inputmode="numeric" ' +
      'placeholder="序号" autocomplete="off" maxlength="4">' +
      '<button id="' + BTN_ID + '" type="button">定位</button>' +
      '<span class="dyb-nav-count">正在统计...</span>';

    return wrap;
  }

  /**
   * 刷新商品总数显示
   *
   * 虚拟滚动下商品数量会随增删变化,而总数是由
   * scrollHeight ÷ 行距推算得出,两项都是实时值,
   * 因此重新读取即可自动同步。
   */
  function refreshCount() {
    const el = document.querySelector('#' + BOX_ID + ' .dyb-nav-count');
    if (!el) return;

    const total = getProductTotal();
    if (!total || total <= 0) {
      el.textContent = '未识别到商品列表';
      return;
    }
    el.textContent = '共 ' + total + ' 个商品';
  }

  // ---------------- 定位执行 ----------------

  function handleGo(e) {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }

    const input = document.getElementById(INPUT_ID);
    if (!input) return;

    const raw = (input.value || '').trim();

    // 只接受序号。输入非数字时直接拒绝,不做任何文本匹配。
    if (!/^\d+$/.test(raw)) {
      report('请先输入商品序号', 'warning', { source: '序号定位' });
      input.focus();
      input.select();
      return;
    }

    const index = parseInt(raw, 10);

    // 上限放宽到 999,虚拟滚动下总数由内容高推算,
    // 超出范围时由 locateProduct 内部给出准确提示
    const btn = document.getElementById(BTN_ID);
    if (btn) btn.disabled = true;

    locateProduct(index, function (r) {
      if (btn) btn.disabled = false;

      // 定位过程会滚动列表,可能触发虚拟加载,刷新一次总数
      refreshCount();

      if (!r.ok) {
        // quiet 的消息(如「序号超出范围」这类输入错误)只弹不收录
        report(r.message, 'error', Object.assign(
          { source: '序号定位' },
          r.quiet ? { keepHistory: false } : null
        ));
        return;
      }
      // 文案 2026-10-15 用户定方案 B:统一三段式
      //   「来源(弱) ｜ 值(强) ｜ 结果数(弱)」——
      //   来源 = 序号定位;值 = 商品名;结果数 = 「第几个/总数」。
      const total = getProductTotal();
      report(getProductName(r.item), 'success', {
        source: '序号定位',
        count: total > 0 ? (index + '/' + total) : String(index),
        standalone: true
      });
    });
  }

  // ---------------- 状态提示 ----------------

  function report(message, type, opts) {
    if (typeof setStatus === 'function') {
      // AGENTS.md 第 16 条:生命周期以 dialog.js 为准,统一 3 秒掉落
      setStatus(message, type, opts || {});
    } else {
      console.log('[DYB-NAV]', type, message);
    }
  }

  // ---------------- 放弃插入时的诊断 ----------------

  /**
   * 放弃插入时打印诊断信息。
   *
   * 起因(2026-10-11):中控台有两个入口(抖店 / 巨量百应),工具栏文案
   * 可能不同。锚点全找不到时,只打一句「放弃插入」无法判断页面到底长什么样,
   * 只能靠猜。这里把页面上可见的短文案列出来,便于按真实数据补锚点。
   *
   * 现由 toolbar.js 在重试耗尽时调用(挂在全局供其取用)。
   */
  function dumpAnchorDiagnostics() {
    try {
      const texts = [];
      const nodes = document.querySelectorAll('button, [role="button"], span, div');
      for (const el of nodes) {
        if (el.children.length > 0) continue;
        const t = (el.innerText || '').replace(/\s+/g, ' ').trim();
        if (!t || t.length > 8) continue;
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue;
        if (texts.indexOf(t) === -1) texts.push(t);
        if (texts.length >= 40) break;
      }
      console.log('[DYB-NAV] 诊断·URL:' + location.href);
      console.log('[DYB-NAV] 诊断·可见短文案(最多 40 个):' + texts.join(' / '));
    } catch (e) {
      console.log('[DYB-NAV] 诊断输出失败', e);
    }
  }

  window.dycDumpAnchorDiagnostics = dumpAnchorDiagnostics;

  /**
 * 商品总数自动刷新
 *
 * 频率与开销的权衡:
 *   getProductTotal → measureRowSpacing → getProductItems
 *   而 getProductItems 内部会 querySelectorAll 遍历全页 DOM
 *   并对每个容器读 innerText —— 在抖店这种上万节点的页面上,
 *   单次开销可达数十毫秒。
 *
 * 因此采用「计时器只做轻量检查,重活按需执行」:
 *   · 每秒只读一次 scrollHeight(极廉价)
 *   · 高度变化时才重新推算总数
 *   · 最长 10 秒至少重算一次,防止高度不变时数字失准
 *
 * 这样常规状态下每秒只有一次属性读取,不会造成卡顿。
 */
function startAutoRefresh() {
    if (window.__DYB_COUNT_WATCHER__) return;
    window.__DYB_COUNT_WATCHER__ = true;

    let lastHeight = -1;
    let lastCalcAt = 0;

    setInterval(function () {
      if (!document.getElementById(BOX_ID)) return;

      const scroller = getScrollContainer();
      if (!scroller) return;

      const now = Date.now();
      const height = scroller.scrollHeight;

      // 高度变了立即重算;没变则每 10 秒兜底一次
      if (height === lastHeight && now - lastCalcAt < 10000) return;

      lastHeight = height;
      lastCalcAt = now;
      refreshCount();
    }, 1000);
  }

  // ---------------- 注册到工具栏 ----------------
  //
  // 从这里开始,本文件只回答两个问题:
  //   1. 这个功能长什么样(render)
  //   2. 开关打开 / 关闭时要做什么(onEnable / onDisable)
  // 至于插到哪、什么时候插、失败了怎么重试,全由 toolbar.js 负责。

  // 控件当前是否在页面上(null=尚未首次对齐,用于开关切换的状态条反馈)
  var navSlotShown = null;

  dycRegisterTool({
    id: 'liveLocate',
    flag: 'liveLocate',            // 跟随 dybFeatures.liveLocate
    label: '中控台商品定位',

    render: function () {
      const box = buildWidget();
      // 按钮点击绑定在节点创建时完成 —— 与插入时机无关,重插也不会重复绑
      const btn = box.querySelector('#' + BTN_ID);
      if (btn) btn.addEventListener('click', handleGo);
      return box;
    },

    onEnable: function () {
      // 状态条统一反馈(2026-10-11):只在「关→开」转移时报一声;
      // 首屏渲染(onEnable 首次触发)与重复渲染都不报,避免开场噪音
      if (navSlotShown === false && typeof toast === 'function') {
        toast('已开启', 'info', { source: '序号定位' });
      }
      navSlotShown = true;
      console.log('[DYB-NAV] 中控台定位:已开启');
      // 首次统计可能因列表尚未渲染而失败,稍后重试
      setTimeout(refreshCount, 500);
      startAutoRefresh();
    },

    onDisable: function () {
      // 「开→关」转移才报(onDisable 只在控件已存在时被 toolbar 调)
      if (navSlotShown === true && typeof toast === 'function') {
        toast('已关闭', 'info', { source: '序号定位' });
      }
      navSlotShown = false;
      console.log('[DYB-NAV] 中控台定位:已关闭');
      // 总数刷新计时器不必停:它每秒只读一次 scrollHeight,
      // 且自带「控件不在就直接 return」的判断,删除后自动空转,无开销。
    }
  });

  // 键盘:焦点在输入框时按回车等同于点按钮。
  // 这是文档级监听,只注册一次,与工具栏是否存在无关。
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    const t = e.target;
    if (t && t.id === INPUT_ID) {
      handleGo(e);
    }
  });
})();