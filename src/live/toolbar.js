/**
 * 中控台工具栏 · 渲染器
 *
 * 职责:找一个合适的位置,把 tool-slots.js 里登记的工具渲染出来,
 * 并让它们跟随各自的开关启停。**它不认识任何具体功能** ——
 * 功能都是自己去注册的,所以新增功能不需要改本文件。
 *
 * 锚点策略沿用 nav.js 已验证的那套两段式(2026-10-11 起共用同一个函数,
 * 不再是两份拷贝):
 *   · 前期只认「筛选」—— 避免首屏渲染途中误锚到别处
 *   · 后期才放宽到「排序 / 全部商品 / 商品管理」
 *
 * 与 nav.js 的关系:
 *   nav.js 仍负责「定位」这个功能本身(输入框 + 按钮 + 商品总数),
 *   它现在是工具栏里的**第一个**注册项;本文件负责把工具栏插进页面。
 *   换句话说 nav.js 从「宿主」降级为「一个普通功能」,
 *   以后新增工具栏控件不必再动它。
 *
 * ⚠️ 加载顺序要求(manifest.json 的 js 数组):
 *   flags → 各功能模块(要注册的) → nav.js(提供锚点) → **本文件(最后)**
 *   本文件必须排在最后一个,否则它启动时 DYC_TOOL_SLOTS 还没填满。
 *   新增功能脚本请插在 nav.js 之前。
 */

(function toolbarRenderer() {
  'use strict';

  if (window.__DYC_TOOLBAR_INITIALIZED__) return;
  window.__DYC_TOOLBAR_INITIALIZED__ = true;

  const ROOT_ID = DYC_TOOLBAR_ID;      // 'dyc-toolbar'

  // 与 nav.js 保持同一套锚点策略
  const LATE_STAGE_AT = 12;            // 重试 12 次(≈6 秒)后放宽锚点
  const MAX_ATTEMPTS = 24;
  const RETRY_MS = 500;

  let attempts = 0;
  let inserting = false;
  let started = false;
  let lastFlags = {};

  /** 建工具栏外壳 */
  function buildToolbar() {
    const bar = document.createElement('div');
    bar.id = ROOT_ID;
    return bar;
  }

  /**
   * 渲染一个注册项。flag 为 null 表示常显;否则跟随开关。
   * 返回 true 表示工具栏里确实有内容。
   */
  function renderSlot(bar, slot) {
    let holder = bar.querySelector('[data-dyc-tool="' + slot.id + '"]');
    const enabled = !slot.flag || lastFlags[slot.flag] !== false;

    if (!enabled) {
      if (holder) {
        holder.remove();
        if (typeof slot.onDisable === 'function') slot.onDisable();
      }
      return false;
    }

    if (holder) return true;   // 已渲染

    const ctx = {
      makeButton: makeButton,
      report: function (message, type, opts) {
        report(message, type, Object.assign({ source: slot.source || slot.label || slot.id }, opts || {}));
      },
      bar: bar
    };

    let node;
    try {
      node = slot.render(ctx);
    } catch (e) {
      // 单个功能渲染失败不能拖垮整条工具栏
      console.warn('[DYC-TOOL] 渲染失败:' + slot.id, e);
      return false;
    }
    if (!node) return false;

    holder = document.createElement('span');
    holder.className = 'dyc-tool';
    holder.setAttribute('data-dyc-tool', slot.id);
    if (slot.label) holder.setAttribute('title', slot.label);
    holder.appendChild(node);

    bar.appendChild(holder);

    if (typeof slot.onEnable === 'function') slot.onEnable();
    return true;
  }

  /** 统一样式的按钮工厂,避免每个功能各写一套内联样式 */
  function makeButton(text, onClick) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'dyc-tool-btn';
    btn.textContent = text;
    btn.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      onClick(e);
    });
    return btn;
  }

  /** 状态提示:有 dialog.js 就复用它,没有就退回 console
   *  (AGENTS.md 第 16 条:生命周期以 dialog.js 为准,统一 3 秒掉落) */
  function report(message, type, opts) {
    if (typeof setStatus === 'function') {
      setStatus(message, type, opts);
    } else {
      console.log('[DYC-TOOL]', type, message);
    }
  }

  /**
   * 找工具栏该插的位置。
   *
   * 复用 nav.js 已验证的锚点查找(两段式),避免两处各写一份、
   * 将来页面改版只改了一处 —— 那正是「有的页面行、有的页面不行」的成因。
   * nav.js 通过全局 dycFindFilterAnchor 暴露该函数。
   */
  function findAnchor(lateStage) {
    if (typeof dycFindFilterAnchor === 'function') {
      return dycFindFilterAnchor(lateStage);
    }
    // nav.js 未加载(理论不该发生)时的极简兜底:只认「筛选」二字
    const nodes = document.querySelectorAll('button, [role="button"], span, div');
    for (let i = 0; i < nodes.length; i++) {
      const el = nodes[i];
      if (el.children.length > 0) continue;
      const t = (el.innerText || '').replace(/\s+/g, ' ').trim();
      if (t !== '筛选') continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      return el;
    }
    return null;
  }

  /**
   * 插入并渲染。
   * @returns {boolean} 是否已成功插入
   */
  function tryInsert() {
    if (inserting) return false;
    inserting = true;

    attempts++;

    let bar = document.getElementById(ROOT_ID);
    if (!bar) {
      const anchor = findAnchor(attempts >= LATE_STAGE_AT);
      if (!anchor) {
        if (attempts < MAX_ATTEMPTS) {
          setTimeout(function () { inserting = false; tryInsert(); }, RETRY_MS);
        } else {
          inserting = false;
          console.log('[DYC-TOOL] 重试 ' + attempts + ' 次仍未找到工具栏锚点,放弃插入');
          // 按真实页面数据补锚点,不靠猜(实现由 nav.js 提供并导出)
          if (typeof window.dycDumpAnchorDiagnostics === 'function') {
            window.dycDumpAnchorDiagnostics();
          }
        }
        return false;
      }

      // 与筛选按钮排在同一行:往上找一层 flex 容器
      let host = anchor;
      for (let i = 0; i < 3; i++) {
        const parent = host.parentElement;
        if (!parent) break;
        const st = getComputedStyle(parent);
        if (st.display === 'flex' || st.display === 'inline-flex') {
          host = parent;
          break;
        }
        host = parent;
      }

      bar = buildToolbar();
      host.appendChild(bar);
    }

    refresh();
    inserting = false;
    return true;
  }

  /** 按当前开关状态刷新全部注册项 */
  function refresh() {
    const bar = document.getElementById(ROOT_ID);
    if (!bar) {
      // 工具栏还没插进去(锚点未就绪或已被 SPA 重渲染掉):
      // 由 tryInsert 的重试链负责补插,这里只需保证有链在跑。
      if (started && !inserting) tryInsert();
      return;
    }

    let shown = 0;
    DYC_TOOL_SLOTS.forEach(function (slot) {
      if (renderSlot(bar, slot)) shown++;
    });

    // 一个都没有的时候不占位
    bar.style.display = shown > 0 ? '' : 'none';
  }

  /** 开关变化:即时生效,不必刷新页面 */
  function applyFlags(flags) {
    lastFlags = flags || {};
    refresh();
  }

  function boot() {
    if (!document.body) {
      setTimeout(boot, 200);
      return;
    }
    // 中控台是 Garfish 微前端,插得太早会找不到「筛选」按钮
    setTimeout(tryInsert, 1000);
  }

  // ---------------- 启动 ----------------

  function start() {
    if (started) return;
    started = true;

    if (typeof dycReadFlags === 'function') {
      dycReadFlags().then(function (flags) {
        lastFlags = flags || {};
        if (document.readyState === 'complete') boot();
        else window.addEventListener('load', boot, { once: true });
      });
    } else {
      if (document.readyState === 'complete') boot();
      else window.addEventListener('load', boot, { once: true });
    }
  }

  // 等所有功能模块注册完再启动。
  // manifest 里本文件排在功能模块之后,此刻 DYC_TOOL_SLOTS 已是最终形态;
  // 但 window load 之后若有脚本追加注册,下面的 interval 也能兜住。
  start();

  if (typeof dycWatchFlags === 'function') {
    dycWatchFlags(applyFlags);
  }

  // SPA 切回中控台 / 平台重渲染后补插(重渲染会丢掉工具栏)
  //
  // ★ 2026-10-26(#118「从未开播状态,到开播状态,定位按钮会消失」):
  //   旧口径只由「URL 变了」触发,而「未开播 → 开播」多数是**同路由内的状态切换**,
  //   href 往往不变(至多 query 变)—— 于是平台把 #dyc-toolbar 抹掉之后,
  //   没有任何人负责补插;再加上 attempts 用满 MAX_ATTEMPTS 后 tryInsert 直接放弃,
  //   表现就是「整条工具栏消失,直到手动刷新页面」。
  //   现在改成**节点在心跳**:每秒看一眼节点在不在,丢了就把 attempts 归零重插;
  //   连续插不上就指数退避到 8 秒,不做无意义的空转。
  let lastUrl = location.href;
  let missingSince = 0;
  let reinsertAt = 0;
  let reinsertFails = 0;
  setInterval(function () {
    if (!/live\/control/.test(location.href)) {
      lastUrl = location.href;
      missingSince = 0;
      return;
    }
    const urlChanged = location.href !== lastUrl;
    lastUrl = location.href;

    const bar = document.getElementById(ROOT_ID);
    if (bar) {
      // 节点还在:只在换页后按当前开关重绘一次
      missingSince = 0;
      reinsertAt = 0;
      reinsertFails = 0;
      if (urlChanged) refresh();
      return;
    }
    if (!started) return;

    const now = Date.now();
    if (!missingSince) missingSince = now;
    if (now < reinsertAt) return;
    // 刚丢的前 1.5 秒先让一拍:平台常在同一轮重渲染里把它还回来
    if (reinsertFails === 0 && now - missingSince < 1500) return;

    attempts = 0;
    if (tryInsert()) {
      missingSince = 0;
      reinsertAt = 0;
      reinsertFails = 0;
      return;
    }
    reinsertFails += 1;
    reinsertAt = Date.now() + Math.min(1500 * reinsertFails, 8000);
  }, 1000);
})();