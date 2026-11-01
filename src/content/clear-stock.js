/**
 * 库存清零执行
 *
 * 抖店编辑弹窗内自带「全部清零」功能，本模块的职责是：
 * 1. 打开该商品的编辑弹窗
 * 2. 定位并点击「全部清零」
 * 3. 点击提交并确认结果
 *
 * 相比逐个改输入框，点击官方控件更可靠：
 * - 不需要猜测 SKU 结构
 * - 平台的清零逻辑（含区域库存、阶梯库存的处理规则）由平台自己保证
 * - 交互路径与人工操作一致，平台风险最低
 */

/**
 * 过程提示的延迟闸门（2026-10-29 用户定）
 *
 * 用户原话：「清空库存的过程的提示 2/3 一闪而过，感觉出现重复提示了，
 * 如果结果那么快出就不要展示过程了」。
 *
 * 做法：第一次 say() 只挂计时器、**不立刻**出消息；操作在 DELAY 内就收尾
 * （成功或失败）则一条过程消息都不会出现。超过这个时长的慢路径才把最近的
 * 文案亮出来；之后再 say() 只是改同一句话（running 会就地合并），不叠第二条。
 * 收尾时 stop() 返回「屏幕上是否真有一条过程消息」，调用方据此决定要不要
 * 让结果消息把那条收掉（setStatus 的 dropRunning）。
 */
const PROGRESS_DELAY = 700;

function createProgressGate(source) {
  /* 阈值放在函数里：这块被测是整段切出来跑的，外部常量不会跟着过去。 */
  const DELAY = typeof PROGRESS_DELAY === 'number' ? PROGRESS_DELAY : 700;
  let timer = 0;
  let shown = false;
  let alive = true;
  let text = '';

  return {
    say(next) {
      if (!alive) return;
      if (next) text = next;
      if (shown) {
        setStatus(text, 'running', { source });
        return;
      }
      if (timer) return;
      timer = setTimeout(function () {
        timer = 0;
        if (!alive) return;
        shown = true;
        setStatus(text, 'running', { source });
      }, DELAY);
    },
    /** @returns {boolean} 屏幕上是否真有一条过程消息需要收掉 */
    stop() {
      alive = false;
      if (timer) { clearTimeout(timer); timer = 0; }
      return shown;
    }
  };
}

/**
 * 像人一样点一下（2026-10-29 第三轮诊断）
 *
 * 报告里「点了库存编辑图标」之后 5 秒，编辑区、弹层、库存框一概没出现，
 * 全页也没有任何保存类按钮 —— 很可能是纯 el.click() 打不开：它只派发
 * click，平台把展开逻辑挂在 pointerdown/mousedown 上（React 常见写法）就白点。
 * 这里按真人顺序补齐指针序列；老内核没有 PointerEvent 就跳过那两步。
 *
 * 默认只点一次（保持原行为，避免「先展开又被自己点回去」的双触发），
 * 需要补发时传 { full: true }。
 */
function clickLikeUser(el, opts) {
  if (!el) return false;
  const full = !!(opts && opts.full);

  try {
    /* 只在**看不见**的时候才滚，而且滚最小的距离（2026-10-30 用户反馈「点清空之后页面自动滚动」）。
     * 原来无条件 `block:'center'`：元素本来就在眼前，也要把整页拽到中间 —— 用户的视线
     * 刚落在按钮上，下一秒整页移位，等于把他看的地方抽走。老内核 click() 不需要可见性，
     * 只有「完全不在视口内」时才值得替用户找位置。 */
    const r = el.getBoundingClientRect ? el.getBoundingClientRect() : null;
    const vh = window.innerHeight || document.documentElement.clientHeight || 0;
    const vw = window.innerWidth || document.documentElement.clientWidth || 0;
    const inView = !!(r && r.top >= 0 && r.left >= 0 && r.bottom <= vh && r.right <= vw);
    if (!inView && r) {
      // 程序化滚动打点(项目约定)：不顶标记,两枚浮动滚动钮会当成用户滚了一次而闪灯
      window.__dycScriptScrollAt = Date.now();
      el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
  } catch (e) { /* 忽略 */ }

  const fire = (name, Ctor, extra) => {
    try {
      if (typeof Ctor === 'function' && typeof el.dispatchEvent === 'function') {
        el.dispatchEvent(new Ctor(name, Object.assign(
          { bubbles: true, cancelable: true, view: window, button: 0 }, extra || {}
        )));
      }
    } catch (e) { /* 构造器不被老内核支持 */ }
  };

  if (full) {
    fire('pointerdown', window.PointerEvent, { pointerType: 'mouse', isPrimary: true });
    fire('mousedown', window.MouseEvent);
    fire('pointerup', window.PointerEvent, { pointerType: 'mouse', isPrimary: true });
    fire('mouseup', window.MouseEvent);
  }

  try { el.click(); } catch (e) { return false; }
  return true;
}

/**
 * 库存编辑区是否已经打开（给提示分档用，不参与「要不要重试」的判断）
 *
 * 除库存框之外，弹层类容器出现也算 —— 有些形态打开后只给读数、没有可编辑框。
 * 只用来选文案，所以宁可宽一点；判重试仍用库存框，宽判据会把「没打开」误判成
 * 「打开了」，反而不再重试。
 */
function hasEditorOverlay() {
  try {
    const nodes = document.querySelectorAll(
      '[role="dialog"], [class*="modal"], [class*="Modal"], [class*="drawer"], [class*="Drawer"]'
    );
    for (const el of nodes) {
      if (!el.getBoundingClientRect) continue;
      const r = el.getBoundingClientRect();
      if (r.width > 80 && r.height > 60) return true;
    }
  } catch (e) { /* 判不了就当没有 */ }
  return false;
}

/**
 * 一个输入框的一行描述（诊断用）
 *
 * 报告里只写「10 个库存框」是不够的 —— 上一轮就是没法判断那 10 个框到底是
 * SKU 库存框还是页面顶部的筛选框，只能靠猜。把首个框的标签、id、class、当前值
 * 打出来，一眼就能分清。
 */
function describeInput(inp) {
  if (!inp) return '无';
  try {
    const cls = typeof inp.className === 'string' ? inp.className : '';
    return (inp.tagName || 'input').toLowerCase() +
      '[ph=' + String(inp.getAttribute('placeholder') || '-').slice(0, 12) +
      ' id=' + String(inp.id || '-').slice(0, 16) +
      ' cls=' + (String(cls).slice(0, 20) || '-') +
      ' 值=' + String(inp.value == null ? '' : inp.value).slice(0, 6) + ']';
  } catch (e) { return '?'; }
}

/**
 * 直提说「本来就 0」时，这个结论能不能直接采信
 *
 * 2026-10-30 用户反馈「批量 8 个全部跳过、一个都没清」。根因是直提按 SKU 明细
 * 求和判 0，遇到库存 v2 / 批次结构的店铺（enable_stock_v2）字段读法一变就
 * 算成 0，于是整批被当成「无需清零」放过去，一个请求都不发。
 *
 * 判据：页面行内的总库存 > 0 而接口算 0 ⇒ 两边矛盾，不许采信，回退点击链路
 * 以编辑区里的真实库存为准；两边都是 0 才算真「本就 0」。
 */
function trustAlreadyZero(pageStock) {
  return !(Number(pageStock) > 0);
}

/**
 * 执行入口
 * @param {Element} row 商品行
 * @param {object} info 商品信息
 * @param {object} [opts] 调用方附加约定（2026-10-30）
 *   · quiet=true   不出单条消息，只把结果回调出去（留给批量类调用方，当前无调用点）
 *   · onResult(kind, msg, opt)   quiet 模式下的结果出口
 *     kind: 'ok' 接口确认清零 | 'pending' 已提交待核对 | 'skip' 本就为 0 | 'fail' 没清成
 */
async function startClearStock(row, info, opts) {
  const quiet = !!(opts && opts.quiet);
  const report = (kind, msg, opt) => {
    if (!quiet || typeof opts.onResult !== 'function') return;
    try { opts.onResult(kind, msg, opt || {}); } catch (e) { /* 回调出错不影响执行 */ }
  };

  debugLog('开始执行：' + (info.title || '未知商品'));

  // 一期侦察(2026-10-21 直提升级方案):调试模式下开 30 秒网络监听窗口,
  // 把本次清零链路触发的「库存详情 + 提交」请求原样记录,供二期直提链路取参数。
  // 侦察失败(未注入/未开调试)静默跳过,对原点击链路零影响。
  try {
    if (typeof isDebugMode === 'function' && isDebugMode() &&
        window.__DYC_STOCK_PROBE__ &&
        typeof window.__DYC_STOCK_PROBE__.arm === 'function') {
      window.__DYC_STOCK_PROBE__.arm(30000);
      debugLog('网络监听已开窗 30 秒');
    }
  } catch (e) { /* 侦察失败不影响清零 */ }

  // 二期直提(2026-10-23):接口参数来自真机接口取样(stock-direct.js 头注),
  // 直接提交清零 —— 不展开编辑区、不模拟点击。任何失败**静默**回退到下方
  // 点击链路(用户 2026-10-21 拍板口径);直提失败不弹消息,避免「一次动作
  // 只出一条消息」纪律被中间态破坏 —— 回退链路自带自己的消息。
  try {
    if (window.__DYC_STOCK_DIRECT__ &&
        typeof window.__DYC_STOCK_DIRECT__.tryDirectClearStock === 'function') {
      const direct = await window.__DYC_STOCK_DIRECT__.tryDirectClearStock(info.productId);
      if (direct && direct.ok) {
        debugLog('直提成功(接口提交,未展开编辑区)');
        window.__DYC_STOCK_DIRECT__.updateRowStockDisplay(row);
        // 三段式(2026-10-27):值=商品名(谁),结果进右端弱位
        if (quiet) report('ok', info.title || '该商品', { count: '库存已清零' });
        else finishStatus(info.title || '该商品', { source: '库存清零', count: '库存已清零' });
        // 接口已确认清零 ⇒ 按钮上才给勾（2026-10-29）
        clearStockFeedback(row, 'ok');
        return;
      }
      if (direct && direct.why === 'already-zero') {
        /* 2026-10-30 用户反馈「批量 8 个全部跳过」：
         * 直提是按 SKU 明细求和判「本来就 0」的，遇到库存 v2 / 批次结构
         * （enable_stock_v2 的店铺）字段读法一变就会算成 0，于是整批被当成
         * 「无需清零」放过去 —— 一个请求都不发，用户看到的就是「清空没完成」。
         * 判据改成两边对账：页面行内的总库存明明 > 0 时不信接口这个 0，
         * 回退点击链路，以编辑区里的真实库存为准。两边都是 0 才算真「本就 0」。
         */
        const pageStock = Number(info && info.totalStock);
        if (trustAlreadyZero(pageStock)) {
          // 库存本就为 0:不提交、不展开,直接报无需清零(文案与老链路一致)
          if (quiet) report('skip', info.title || '该商品', { count: '库存已是 0，无需清零' });
          else toast(info.title || '该商品', 'info', { source: '库存清零', count: '库存已是 0，无需清零' });
          return;
        }
        debugLog('直提判「已是 0」，但页面行内总库存是 ' + pageStock + '，回退点击链路核对');
      }
      if (direct) debugLog('直提未走通(' + (direct.why || '?') + '),回退点击链路');
    }
  } catch (e) {
    debugLog('直提异常:' + (e && e.message) + ',回退点击链路');
  }

  // 过程提示：只有慢到需要反馈时才出现，快路径一条都不留（见 createProgressGate）。
  // 三个收尾包装统一先 stop()，把可能已挂出的过程消息交给结果消息收掉 ——
  // 否则「正在保存」会和「失败」一起挂在同一列里，看着就是重复提示。
  const progress = createProgressGate('库存清零');
  // quiet 模式下过程消息一律不出：由调用方自己安排进度，两套进度会互相顶掉
  const say = (t) => {
    if (quiet) return;
    try { progress.say(t); } catch (e) { /* 提示失败不影响执行 */ }
  };

  /* 统一收尾出口：
   * kind 同时决定「屏幕上怎么显示」和「调用方怎么计数」，两件事绑在一起就不会
   * 出现「看着像失败、统计算成功」这种对不上的情况。
   *   ok      接口确认清零成功   → success
   *   pending 只点了保存、没回读 → success（调用方可以单独计数，不冒充成功）
   *   fail    明确失败           → error
   *   blocked 前置条件不满足     → warning（只弹不收录）
   *   skip    本就为 0，无需清零 → info
   * quiet 模式下一条消息都不出，只把 kind 交回去。 */
  const KIND_STYLE = {
    ok: 'success', pending: 'success', fail: 'error',
    blocked: 'warning', warn: 'warning', skip: 'info', info: 'info'
  };
  const finish = (kind, msg, o) => {
    const had = progress.stop();
    const pass = Object.assign({ source: '库存清零', dropRunning: had }, o || {});
    if (quiet) { report(kind, msg, pass); return; }
    const style = KIND_STYLE[kind] || 'warning';
    if (style === 'success') finishStatus(msg, pass);
    else if (style === 'error') failStatus(msg, pass);
    else toast(msg, style, pass);
  };

  // 第一步：点击总库存列旁的编辑图标，展开库存编辑区
  const stockEditIcon = findStockEditIcon(row);
  if (!stockEditIcon) {
    // 五档锚点全部落空的现场信息要留一条：#124「第一个商品清不动」这类
    // 只能靠报告定案，光说「没找到」等于什么都没说。
    debugLog('未找到库存编辑图标（data-kora / style_editIcon / data-btm / 库存格 / 表头列 五档均未命中）');
    debugLog('该行文本采样:' + String(row.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 120));
    // 操作引导类,不是真异常 —— 只弹不收录(2026-10-15 用户定)
    clearStockFeedback(row, 'fail');
    finish('blocked', '没找到库存编辑区，请先展开', { keepHistory: false });
    return;
  }

  // 点之前先把「点的是谁」记下来：诊断里出现「点了编辑图标、编辑区没出现」时，
  // 只有这一行能判断是锚点认错了元素，还是元素对了但点击方式不对。
  try {
    const cls = typeof stockEditIcon.className === 'string' ? stockEditIcon.className : '';
    debugLog('点击库存编辑图标:' + (stockEditIcon.tagName || '?') +
      (cls ? '.' + String(cls).slice(0, 40) : '') +
      ' kora=' + (stockEditIcon.getAttribute('data-kora') || '-'));
  } catch (e) { /* 记不上不影响执行 */ }

  say('正在打开库存编辑区…');
  clickLikeUser(stockEditIcon);

  // 等待编辑区展开（以「全部清零」出现为特征）
  let ready = await waitClearAllButton(1500);

  /* 单击没反应就补发一次完整指针序列（2026-10-29 第三轮诊断）：
   * 上一份报告点完图标 5 秒，编辑区、弹层、库存框一概没有，全页也没有保存类按钮 ——
   * 纯 el.click() 只派发 click，平台若把展开挂在 pointerdown/mousedown 上就白点。
   * 先按原样点一次、不行再补，避免「先展开又被自己点回去」。 */
  if (!ready.ready && !ready.editorOpen) {
    debugLog('单击后编辑区没出现，补发 pointerdown/mousedown 再试一次');
    clickLikeUser(stockEditIcon, { full: true });
    ready = await waitClearAllButton(4000);
  }

  if (!ready.ready) {
    debugLog(ready.reason + (ready.editorOpen ? '（编辑区已展开，缺全清控件）' : '（编辑区没等到）'));

    /* 没有「全部清零」控件时先试逐个填 0（2026-10-29 #124 诊断报告定案）：
     * 时效批次类商品的直提会被接口直接拒（「该种库存类型暂不支持时效批次」），
     * 编辑区里也没有全清按钮，只剩一排库存框 —— 人工就是逐个填 0 再保存。 */
    if (ready.editorOpen) {
      const inputs = findStockInputs();
      debugLog('可用库存框 ' + inputs.length + ' 个(首个:' + describeInput(inputs[0]) + ')');
      const changed = fillStockInputsZero(inputs);
      if (changed > 0) {
        debugLog('改用逐个填 0：' + changed + ' 个库存框已置 0，准备保存');
        say('正在保存…');
        await sleep(300);
        const savedByInputs = clickSaveButton(document);
        if (!savedByInputs) {
          clearStockFeedback(row, 'fail');
          finish('fail', info.title || '该商品', {
            count: '自动保存失败，请手动保存',
            full: (info.title || '该商品') + ' 已把库存填 0，但没点到保存按钮（可能被禁用），请手动核对后点一次保存'
          });
          return;
        }
        await sleep(1200);
        // 只证明点了保存、没有回读落库 ⇒ 不给勾（AGENTS 第 25 条第 4 条）
        finish('pending', info.title || '该商品', { count: '已提交保存，请核对库存' });
        resetInjection();
        setTimeout(() => injectAllRows(), 1500);
        return;
      }
      debugLog('逐个填 0 没做成（可用库存框 ' + inputs.length + ' 个）');
    }

    clearStockFeedback(row, 'fail');
    // 三段式：值=商品名，结果进右端；长解释走 full 进盒子。
    // 两种情形分开讲 —— 统一说「请先展开」会让已经展开的人一头雾水（#124）。
    const overlay = ready.editorOpen || hasEditorOverlay();
    finish('blocked', info.title || '该商品', {
      count: overlay ? '没有「全部清零」控件' : '没等到库存编辑区',
      full: (info.title || '该商品') + (overlay
        ? ' 的库存编辑区已打开，但里面没有「全部清零」按钮，自动填 0 也没找到可用的库存框，请手动逐个规格改。'
        : ' 的库存编辑区没有出现，请点库存旁的编辑图标后再试一次。')
    });
    return;
  }

  // 第二步：点击「全部清零」
  const clearBtn = ready.button;
  debugLog('找到全部清零按钮');

  if (clearBtn.disabled) {
    debugLog('全部清零按钮当前为禁用状态');
    finish('skip', info.title || '该商品', { count: '库存已是 0，无需清零' });
    return;
  }

  // 执行中状态：只在前面的等待已经超时才真正露出来（快路径不显示过程）
  say('正在清零…');

  clickLikeUser(clearBtn);
  debugLog('已点击全部清零');
  await sleep(800);

  // 第三步：点击保存
  // 只尝试一次。点击仅证明已提交保存，不把弹窗消失当成库存已落库——
  // 那个判断不可靠：页面局部重渲染也会让清零按钮消失，但保存其实已生效，
  // 曾导致成功场景被误报为失败并重复点击。
  say('正在保存…');
  const saved = clickSaveButton(document);

  if (!saved) {
    debugLog('未找到保存按钮');
    clearStockFeedback(row, 'fail');
    finish('fail', info.title || '该商品', {
      count: '自动保存失败，请手动保存',
      full: (info.title || '该商品') + ' 库存已填 0，但自动保存没生效，请手动点一次保存'
    });
    resetInjection();
    setTimeout(() => injectAllRows(), 1500);
    return;
  }

  debugLog('已点击保存');
  await sleep(1200);
  finish('pending', info.title || '该商品', { count: '已提交保存，请核对库存' });

  resetInjection();
  setTimeout(() => injectAllRows(), 1500);
}

/**
 * 等待「全部清零」按钮出现
 *
 * 依据实测：该按钮 class 为 optimus_fems-btn optimus_fems-btn-link，
 * 位于编辑库存区内，展开后才渲染。
 *
 * @param {number} timeout
 * @returns {Promise<{ready:boolean, button?:Element, reason?:string}>}
 */
async function waitClearAllButton(timeout = 5000) {
  const start = Date.now();

  while (Date.now() - start < timeout) {
    await sleep(250);

    const btn = findClearAllControl(document);
    if (btn) return { ready: true, button: btn };
  }

  return {
    ready: false,
    reason: '未找到「全部清零」按钮，请先展开库存编辑区',
    // 超时要能分清「编辑区没打开」和「打开了但没有全清控件」（2026-10-29 #124）。
    // 判据只用库存输入框：它出现就意味着编辑区已经展开、只是没有那个按钮。
    // 局限：纯区域库存的商品可能连普通输入框都没有，会被归到「没打开」一档 ——
    // 所以这只是把两种常见情形分开，不冒充精确诊断。
    editorOpen: findStockInputs().length > 0
  };
}
/**
 * 查找库存输入框
 *
 * 依据用户截图：编辑库存展开后，每行 SKU 有黑色边框的数字输入框。
 *
 * 判别方式（2026-10-29 第三轮收紧 —— 之前太松，把页面上无关的框也算进来了）：
 * 旧写法只看「往上 6 层祖先的 textContent 里有『库存』」，而整张表格的祖先
 * 必然包含表头「总库存」，于是页面顶部那些空闲的筛选框、搜索框全被算成库存框，
 * 一口气被填成 0（诊断里「10 个库存框已置 0」但一条保存请求都没发出，就是这回事）。
 *
 * 现在三档同时卡：
 *   ① 位置：筛选栏 / 搜索区 / 工具栏 / 表头里的框一律不算；
 *   ② 取值：值必须是纯数字或空（原有规则）；
 *   ③ 旁证：空值框必须带库存字样（自己身上或 ≤4 层内的小容器），
 *      有数字的框放宽到「容器里提到库存或 SKU」—— 满屏都是 0 的空框不能再靠祖先蒙。
 *
 * @returns {Element[]}
 */
function findStockInputs() {
  const all = document.querySelectorAll('input:not([type="hidden"])');

  const result = [];

  /* 这些区域里的输入框与库存无关：列表页的筛选、搜索、工具栏、表头全在里面。
   * 用 closest 而不是祖先文本判断 —— 「祖先里有没有『库存』」在表格页永远为真。 */
  const OFF_AREA = 'thead, [class*="filter"], [class*="Filter"], [class*="search"], ' +
                   '[class*="Search"], [class*="toolbar"], [class*="Toolbar"], ' +
                   '[class*="query"], [class*="Query"], [class*="nav-menu"]';

  for (const inp of all) {
    if (inp.disabled || inp.readOnly) continue;

    // ① 位置
    try {
      if (inp.closest && inp.closest(OFF_AREA)) continue;
    } catch (e) { /* closest 不被支持就跳过这档 */ }

    // ② 值应为纯数字或空（库存值）
    const val = (inp.value || '').trim();
    if (val !== '' && !/^\d{1,7}$/.test(val)) continue;

    // 排除明显的搜索框
    const ph = (inp.placeholder || '').toLowerCase();
    if (/搜索|请输入商品|货号/.test(ph)) continue;

    // ③ 旁证：自己的属性 / 最近 4 层小容器（文本 ≤ 80 字，避免命中整张表）
    const own = [
      inp.getAttribute('placeholder') || '',
      inp.getAttribute('aria-label') || '',
      inp.getAttribute('title') || '',
      inp.id || '',
      inp.getAttribute('name') || '',
      typeof inp.className === 'string' ? inp.className : ''
    ].join(' ');
    const STOCK_WORD = /库存|stock|sku|inventory/i;

    let hasStockHint = STOCK_WORD.test(own);

    if (!hasStockHint) {
      let node = inp.parentElement;
      for (let d = 0; node && d < 4 && !hasStockHint; d++) {
        const text = String(node.textContent || '');
        // 只看小容器的文本：整张表（几万字）里当然有「库存」
        if (text.length <= 80 && /库存|SKU/i.test(text)) hasStockHint = true;
        node = node.parentElement;
      }
    }

    // 空着手又没有任何库存旁的旁证 ⇒ 不认（宁可不动，也不能把 0 写进别人的框）
    if (hasStockHint || val !== '') result.push(inp);
  }

  return result;
}

/**
 * 设置输入框的值
 * 必须用原生 setter 绕开 React 的值改写，否则页面不感知变化
 */
function setInputValue(input, value) {
  // focus 只是为了让 React 感知焦点，**不要再顺手把页面滚走**：
  // 逐个填 0 时每填一个就 focus 一次，第 N 次落地会把整页拽到最后一个框上
  // （2026-10-29 用户反馈「点完按钮之后突然下滑到页面最下面」）。
  try {
    input.focus({ preventScroll: true });
  } catch (e) {
    input.focus();
  }

  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype, 'value'
  );

  if (setter && setter.set) {
    setter.set.call(input, value);
  } else {
    input.value = value;
  }

  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
  input.blur();
}

/**
 * 逐个把库存输入框填 0（给没有「全部清零」控件的库存类型用）
 *
 * 为什么需要它（2026-10-29 用户诊断报告 #124）：
 *   那件商品是「时效批次」库存类型 —— 直提接口直接回
 *   「该种库存类型暂不支持时效批次」，而编辑区里又没有「全部清零」按钮，
 *   只剩一排可编辑的库存框。人工能做的就是逐个填 0 再保存，这里照做。
 *
 * 边界（宁可不动，也不能改错数据）：
 *   · 只动传进来的框，来源是 findStockInputs（已排除禁用/只读、非数字值、搜索框）；
 *   · 自身标签带「到货 / 时间 / 日期」的框一律跳过 —— 时效批次里那类框不是库存；
 *   · 框数超过 20 个直接放弃（超出人能核对的范围，交回用户）；
 *   · 已经是 0 的不重复写，避免无意义的 input 事件。
 *
 * @param {Element[]} inputs 库存输入框
 * @returns {number} 实际填了几个框；0 表示一个都没动
 */
function fillStockInputsZero(inputs) {
  const list = Array.isArray(inputs) ? inputs : [];
  if (list.length === 0 || list.length > 20) {
    if (list.length > 20) debugLog('库存框超过 20 个，放弃自动填写(' + list.length + ')');
    return 0;
  }

  let changed = 0;

  for (const inp of list) {
    if (!inp || !inp.isConnected) continue;

    // 看输入框自己的标签，而不是整行文本：时效批次那一行本来就有
    // 「到货时间」字样，按整行判会把所有框都跳过。
    const own = (inp.getAttribute('placeholder') || '') + ' ' +
                (inp.getAttribute('aria-label') || '') + ' ' +
                (inp.getAttribute('title') || '');
    if (/到货|时间|日期/.test(own)) continue;

    if (String(inp.value == null ? '' : inp.value).trim() === '0') continue;

    setInputValue(inp, '0');
    changed++;
  }

  return changed;
}

/**
 * 点击保存按钮
 * 依据用户实测 class：aurora-btn-primary aurora-btn-variant-solid
 *
 * @param {Element} scope
 * @returns {boolean}
 */
function clickSaveButton(scope) {
  if (!scope) return false;
  const root = scope === document ? document.body : scope;

  /**
   * 关键：按钮文案可能被拆成多个子元素，
   * 如 <span>保</span><span>存</span>，
   * textContent 拼接后 normalize 会变成「保 存」（中间带空格），
   * 导致 /保存/ 匹配失败。
   * 故统一做去空格处理后再匹配。
   */
  const tight = (s) => (s || '').replace(/\s+/g, '');

  const candidates = [];
  const diagnostics = [];
  const seenDiag = new Set();
  const seenCand = new Set();

  /* 第三轮放宽（2026-10-29）：选择器改成「任何标签 + 类名带 btn」。
   * 抖店这套编辑区用的是 optimus 设计系统（「全部清零」的 class 就是
   * optimus_fems-btn），它的按钮不一定长成 <button>，也可能是 <div>/<span>。
   * 真正拦住误点的仍是文案匹配 + 危险词排除 + 同面板优先。 */
  const SELECTOR = 'button, [class*="btn"], [class*="Btn"], [role="button"]';

  const consider = (el, exactText) => {
    if (!el || !el.getBoundingClientRect) return;

    const rawText = normalize(el.textContent);
    const text = tight(exactText || rawText);

    // 去掉空白后仍为空则跳过；14 字上限给「保存并继续编辑」这类长文案留的余量
    if (!text || text.length > 14) return;

    const cls = typeof el.className === 'string' ? el.className : '';
    const rect = el.getBoundingClientRect();
    // <a>/<span>/<div> 没有 disabled 属性，平台常用 aria-disabled 表达同一种状态
    const isDisabled = el.disabled === true ||
                       el.getAttribute('aria-disabled') === 'true';

    if (!seenDiag.has(el) && diagnostics.length < 80) {
      seenDiag.add(el);
      diagnostics.push(
        text +
        (isDisabled ? '[禁用]' : '') +
        (cls.indexOf('primary') >= 0 ? '[P]' : '') +
        '@' + Math.round(rect.left) + ',' + Math.round(rect.top)
      );
    }

    // 危险动作一律不碰：即便文案里有「确认」，也不能在清零流程里点删除/下架
    if (/删除|下架|清空|取消|关闭/.test(text)) return;

    if (/保存|确定|确认|应用|提交/.test(text) && !seenCand.has(el)) {
      seenCand.add(el);
      candidates.push({ el, text, rawText, cls, disabled: isDisabled });
    }
  };

  try {
    for (const el of root.querySelectorAll(SELECTOR)) consider(el);
  } catch (e) {
    debugLog('按钮选择器不被支持:' + (e && e.message));
  }

  // 第二遍：按文字找 —— 有的面板按钮既不是 <button> 也不带 btn 类
  try {
    for (const hit of findActionButtonsByText(root)) consider(hit.el, hit.text);
  } catch (e) { /* 兜底失败不影响主流程 */ }

  console.log('[DYB] 页面按钮: ' + diagnostics.join(' / '));
  debugLog('页面共' + diagnostics.length + '个按钮');

  /* 清单必须进诊断，而且要**分块**写：轨迹单条上限 140 字，整串塞一条会被
   * 截掉尾巴 —— 上一轮就截在「渠道…」，面板里的按钮一个都没看到。 */
  let line = '';
  let part = 1;
  for (const d of diagnostics) {
    if (line && (line.length + d.length + 3) > 96) {
      debugLog('按钮' + part + ':' + line);
      line = '';
      part++;
      if (part > 8) break;
    }
    line = line ? line + ' / ' + d : d;
  }
  if (line && part <= 8) debugLog('按钮' + part + ':' + line);

  // 库存框所在的弹层：同层里的按钮才可能是这个面板的保存键
  let panel = null;
  try {
    const inputs = findStockInputs();
    if (inputs.length && inputs[0].closest) {
      panel = inputs[0].closest('[role="dialog"], [class*="modal"], [class*="Modal"], ' +
                                '[class*="drawer"], [class*="Drawer"], ' +
                                '[class*="panel"], [class*="Panel"]');
    }
  } catch (e) { panel = null; }

  const usable = candidates.filter((x) => !x.disabled);

  if (usable.length === 0) {
    console.warn('[DYB] 保存类按钮均禁用或不存在。候选: ' +
      candidates.map((x) => x.text + (x.disabled ? '[禁用]' : '')).join(' | '));
    // 区分「压根没找到」和「找到了但都禁用」—— 后者往往是页面校验没过，
    // 用户手动看一眼前面的输入框就能解决。
    debugLog('保存按钮不可用（候选 ' + candidates.length + ' 个' +
      (candidates.length ? '：' + candidates.map((x) => x.text + (x.disabled ? '[禁用]' : '')).join(' / ') : '') +
      '）·库存框所在弹层:' + (panel ? '有' : '无'));
    return false;
  }

  // 评分：同弹层 > footer 内 > primary > 文案精确
  const scored = usable.map((x) => {
    let score = 0;
    try {
      if (panel && panel.contains && panel.contains(x.el)) score += 200;
    } catch (e) { /* contains 不可用就跳过这档 */ }
    if (x.el.closest('[class*="footer-"]')) score += 100;
    if (x.cls.indexOf('primary') >= 0) score += 20;
    if (x.text === '保存') score += 30;
    if (x.cls.indexOf('variant-solid') >= 0) score += 8;
    return { ...x, score };
  });

  scored.sort((a, b) => b.score - a.score);
  const best = scored[0];

  console.log('[DYB] 选中保存按钮:', best.text,
    '| score=' + best.score,
    '| 原始文案="' + best.rawText + '"',
    '| class=' + best.cls.slice(0, 70));

  // 选了谁也要进报告：候选 0 与「选了别的确定」是两种完全不同的失败
  debugLog('选中保存按钮:' + best.text + ' / ' + (best.cls || '无class').slice(0, 30) +
    ' / 同弹层=' + (best.score >= 200 ? '是' : '否'));

  clickLikeUser(best.el);
  debugLog('已点击保存');
  return true;
}

/**
 * 按文字找动作按钮（2026-10-29 第三轮兜底）
 *
 * 有的面板按钮既不是 <button>，也不带 btn 类，纯靠选择器永远扫不到。
 * 这里反过来从文本节点找：整段文字恰好是「保存 / 确定」这类短词才算，
 * 再往上爬最多 4 层找带按钮语义的祖先；爬不到就用父元素
 * （点父元素与点那两个字等价，事件会冒泡到真正的处理器）。
 *
 * @param {Element} root
 * @returns {{el:Element, text:string}[]}
 */
function findActionButtonsByText(root) {
  const out = [];
  if (!root || typeof document === 'undefined' || !document.createTreeWalker) return out;

  const WORDS = /^(保存|确定|确认|应用|提交|保存修改|保存并关闭|确认修改|确认提交|保存并继续编辑)$/;
  const CLICKABLE = 'button, a, [role="button"], [class*="btn"], [class*="Btn"]';

  let walker = null;
  try {
    walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
  } catch (e) { return out; }

  let guard = 0;
  while (walker.nextNode() && guard < 5000) {
    guard++;
    const node = walker.currentNode;
    const text = (node.nodeValue || '').replace(/\s+/g, '');
    if (!text || text.length > 8 || !WORDS.test(text)) continue;

    let el = node.parentElement;
    let hit = null;
    for (let d = 0; el && d < 4; d++) {
      try {
        if (el.matches && el.matches(CLICKABLE)) { hit = el; break; }
      } catch (e) { /* matches 不支持就继续往上 */ }
      el = el.parentElement;
    }
    if (!hit) hit = node.parentElement;
    if (!hit) continue;

    if (!out.some((x) => x.el === hit)) out.push({ el: hit, text });
  }

  return out;
}/**
 * 计算元素在 DOM 中的深度
 * 用于挑选最内层的容器
 */
function depthOf(el) {
  let d = 0;
  let node = el;
  while (node && node !== document.body) {
    d++;
    node = node.parentElement;
  }
  return d;
}/**
 * 找到商品行的库存编辑图标
 *
 * 依据用户截图：总库存数字右侧有个小铅笔图标，
 * 位于「总库存」列内，textContent 可能是「0」或空。
 * 该图标可能无文字，需靠位置定位。
 *
 * @param {Element} row
 * @returns {Element|null}
 */
function findStockEditIcon(row) {
  // 实测结构（用户 2026-10-29 提供）：
  //   <span data-kora="修改库存" data-btm="d905814"
  //     class="ecom-g-sp-icon sp-icon-parcel style_editIcon__AHMYX">
  //     <svg class="icon" aria-hidden="true">…</svg>
  //   </span>  == 0
  //
  // 三个可靠锚点，按可靠性排序：
  //   1. data-kora="修改库存"  —— 平台自标注的用途，最可靠
  //   2. class 前缀 style_editIcon__
  //   3. data-btm="d905814"

  // ---- 方式一：data-kora 语义标签（最可靠）----
  const byKora = row.querySelector('[data-kora="修改库存"]');
  if (byKora) return byKora;

  // ---- 方式二：class 前缀 ----
  const byClass = findByClassPrefix(row, 'style_editIcon__');
  if (byClass) return byClass;

  // ---- 方式三：data-btm 属性 ----
  const byBtm = row.querySelector('[data-btm="d905814"]');
  if (byBtm) return byBtm;

  // ---- 方式四：总库存单元格内查找（兜底）----
  const cell = findByClassPrefix(row, 'style_totalInventory__');
  if (cell) {
    const icon = findIconInCell(cell);
    if (icon) return icon;
  }

  // ---- 方式五：表头横坐标范围（最终兜底）----
  const stockHeader = findAllByText('总库存', { exact: true })[0];
  if (stockHeader) {
    const stockLeft = stockHeader.getBoundingClientRect().left;

    const candidates = [];

    for (const el of row.querySelectorAll('*')) {
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;
      if (rect.width > 32 || rect.height > 32) continue;

      const offset = rect.left - stockLeft;
      if (offset < -10 || offset > 90) continue;

      const text = normalize(el.textContent);
      if (text && !/^\d{1,7}$/.test(text)) continue;

      candidates.push({ el, offset });
    }

    if (candidates.length > 0) {
      candidates.sort((a, b) => b.offset - a.offset);
      for (const item of candidates) {
        const clickable = item.el.closest(
          '[class*="icon"], [class*="edit"], [class*="pencil"], [role="button"], button, a'
        );
        return clickable || item.el.parentElement || item.el;
      }
    }
  }

  return null;
}
/**
 * 在单元格内找出可点击的编辑图标
 *
 * 图标特征：无文本内容，尺寸小（≤32px），位于数值附近。
 *
 * @param {Element} cell 单元格
 * @returns {Element|null}
 */
function findIconInCell(cell) {
  if (!cell) return null;

  // 收集所有子元素
  const items = [];
  for (const el of cell.querySelectorAll('*')) {
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) continue;
    if (rect.width > 32 || rect.height > 32) continue;

    const text = normalize(el.textContent);

    // 有文本的不是图标（除非是纯数字，那是数值本身）
    if (text && !/^\d{1,7}$/.test(text)) continue;

    items.push({ el, rect, text });
  }

  // 优先找带编辑语义类名的
  for (const item of items) {
    const cls = typeof item.el.className === 'string' ? item.el.className : '';
    const tip = item.el.getAttribute && (item.el.getAttribute('title') || item.el.getAttribute('aria-label') || '');

    if (/icon|edit|pencil|write|operate/i.test(cls + ' ' + tip)) {
      return item.el.closest('[class*="icon"], button, a, [role="button"]') || item.el;
    }
  }

  // 否则取纯数字元素右侧的那个（图标通常在数值右边）
  const numItem = items.find((x) => x.text);
  if (numItem) {
    const icons = items.filter((x) => !x.text && x.rect.left >= numItem.rect.left);
    if (icons.length > 0) {
      icons.sort((a, b) => a.rect.left - b.rect.left);
      const target = icons[0].el;
      return target.closest('[class*="icon"], button, a, [role="button"]') || target.parentElement || target;
    }
  }

  // 没有数值则取最靠右的小元素
  if (items.length > 0) {
    items.sort((a, b) => b.rect.left - a.rect.left);
    const target = items[0].el;
    return target.closest('[class*="icon"], button, a, [role="button"]') || target.parentElement || target;
  }

  return null;
}/**
 * 等待「编辑库存」弹窗出现
 * 特征：弹窗内含「批量设置」或「保存货号」等字样
 */
async function waitStockDialog(timeout = 5000) {
  const start = Date.now();

  while (Date.now() - start < timeout) {
    await sleep(250);

    // 特征：出现「批量设置」或「7天库存」这类弹窗专属文案
    const hasBatchText = /批量设置|7天库存|未占用库存|SKU信息/.test(document.body.textContent || '');
    if (hasBatchText) {
      // 找到弹窗容器
      const dialogs = getVisibleDialogs();
      return dialogs[dialogs.length - 1] || document.body;
    }
  }

  return null;
}

/**
 * 打开编辑界面并等待其就绪
 *
 * 不依赖「弹窗数量变化」这类脆弱判断，改为轮询真实特征：
 * 编辑界面里会出现库存输入框，或出现「全部清零」按钮。
 *
 * @param {Element} editButton 编辑按钮
 * @returns {Promise<Element|null>} 编辑界面容器
 */
async function openEditSurface(editButton) {
  const MAX_ATTEMPTS = 3;
  const WAIT_MS = 5000;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    // 每次都重新点击，覆盖首次点击未生效的情况
    editButton.click();

    const start = Date.now();
    while (Date.now() - start < WAIT_MS) {
      await sleep(250);

      const surface = findEditSurface();
      if (surface) return surface;

      // URL 变化也算编辑界面打开（部分入口是整页跳转）
      if (location.href !== editButton._urlBefore) {
        return document.body;
      }
    }

    // 记录点击前的 URL，供下次对比
    editButton._urlBefore = location.href;
  }

  return null;
}

/**
 * 在指定范围内定位「全部清零」控件
 *
 * 候选文案（按可能性排序）：
 * - 全部清零 / 清零全部 / 全部置零 / 一键清零
 * - 清空库存 / 库存清零 / 库存全部清零
 * - 重置库存
 *
 * @param {Element} scope 搜索范围，通常为编辑界面容器
 * @returns {Element|null}
 */
function findClearAllControl(scope) {
  if (!scope) return null;
  const root = scope === document ? document.body : scope;

  // 文案可能被拆成多个子元素（如 <span>全</span><span>部清零</span>），
  // textContent 拼接后 normalize 会插入空格，故统一去空格再匹配。
  const tight = (s) => (s || '').replace(/\s+/g, '');

  const candidates = [
    '全部清零', '清零全部', '全部置零', '一键清零',
    '全部清空', '清空全部', '库存全部清零', '全部库存清零',
    '重置库存', '库存重置'
  ];

  // 遍历页面所有按钮，取文案去空格后完全匹配者
  for (const el of root.querySelectorAll('button, [class*="btn"]')) {
    const text = tight(normalize(el.textContent));

    for (const label of candidates) {
      if (text === label) {
        return el;
      }
    }
  }

  // 回退：包含匹配（可能文案更长，如「全部清零（预览货号）」）
  for (const el of root.querySelectorAll('button, [class*="btn"]')) {
    const text = tight(normalize(el.textContent));
    if (!text || text.length > 12) continue;

    for (const label of candidates) {
      if (text.indexOf(label) >= 0) return el;
    }
  }

  return null;
}/**
 * 检查提交后的结果弹窗
 * @returns {{success:boolean, hasDialog:boolean}}
 */
function checkResultDialog() {
  const successTexts = ['成功', '已完成'];
  const failTexts = ['失败', '错误', '不允许', '不能'];

  const dialogs = getVisibleDialogs();
  if (dialogs.length === 0) return { success: false, hasDialog: false };

  for (const d of dialogs) {
    const text = normalize(d.textContent);

    if (failTexts.some((t) => text.includes(t))) {
      // 失败弹窗：关闭它
      closeDialogSafely(d);
      return { success: false, hasDialog: true };
    }

    if (successTexts.some((t) => text.includes(t))) {
      // 成功弹窗：点确定关闭
      const ok = submitDialog(d);
      if (!ok) closeDialogSafely(d);
      return { success: true, hasDialog: true };
    }
  }

  return { success: false, hasDialog: true };
}

/**
 * 从商品行找到编辑按钮（铅笔图标）
 */
function findEditButton(row) {
  const nodes = findAllByText('编辑', { exact: true, root: row });
  if (nodes.length > 0) return nodes[0];

  // 回退：找带编辑图标的元素（铅笔通常是 SVG 或图片）
  const icons = row.querySelectorAll('svg, img, [class*="edit"], [class*="pencil"]');
  for (const icon of icons) {
    const parent = icon.closest('button, a, span');
    if (parent && isVisible(parent)) return parent;
  }

  return null;
}

/**
 * 获取当前可见的弹层列表
 *
 * 抖店使用的弹层形态不止 modal，还可能是抽屉（drawer）、
 * 浮层（popover）等。这里尽可能多地收集，避免漏判。
 */
function getVisibleDialogs() {
  const selectors = [
    '[role="dialog"]',
    '.semi-modal-content',
    '[class*="modal-content"]',
    '[class*="drawer-content"]',
    '[class*="drawer-body"]',
    '.semi-drawer-content',
    '[class*="popover"]',
    '[class*="popup-content"]'
  ];

  // 去重后返回
  const seen = new Set();
  const result = [];

  for (const sel of selectors) {
    const nodes = document.querySelectorAll(sel);
    for (const n of nodes) {
      if (seen.has(n)) continue;
      if (!isVisible(n)) continue;

      // 排除扩展自己的弹窗
      if (n.closest && n.closest('#dyb-dialog-root')) continue;

      seen.add(n);
      result.push(n);
    }

    // 找到一组就够，避免把页面其他浮层也当成弹窗
    if (result.length > 0) return result;
  }

  return result;
}

/**
 * 判断编辑界面是否已打开
 *
 * 不依赖特定选择器，而是用「弹窗里出现编辑相关内容」作为特征：
 * 出现库存输入框、或出现「全部清零」按钮，即说明编辑界面已就绪。
 *
 * @returns {Element|null}
 */
function findEditSurface() {
  // 特征一：存在「全部清零」等清零控件
  const clearControl = findClearAllControl(document);
  if (clearControl) {
    // 向上找到包含「全部清零」与「保存」的最小公共祖先。
    // 做法：从清零控件出发逐级向上，对每一级检查其子树内
    // 是否同时存在清零控件与可点击按钮，满足即停。
    let node = clearControl;

    for (let depth = 0; node && depth < 20; depth++) {
      const hasClear = findClearAllControl(node) !== null;
      const buttons = Array.from(node.querySelectorAll('button'))
        .filter(b => !b.disabled && !(b.closest && b.closest('#dyb-dialog-root')));

      if (hasClear && buttons.length >= 2) {
        return node;
      }

      if (!node.parentElement || node.parentElement === document.body) break;
      node = node.parentElement;
    }

    // 兜底：返回清零控件所在的最大可用容器
    return clearControl.closest('[role="dialog"], [class*="modal-content"], [class*="drawer"]')
      || document.body;
  }

  // 特征二：存在可编辑的库存输入框
  const inputs = document.querySelectorAll('input:not([type="hidden"])');
  for (const inp of inputs) {
    if (inp.disabled || inp.readOnly) continue;

    let node = inp;
    let depth = 0;
    while (node && depth < 4) {
      const text = node.textContent || '';
      if (/库存|可售|数量/.test(text)) {
        return inp.closest('[role="dialog"], [class*="modal-content"], [class*="drawer"]')
          || document.body;
      }
      node = node.parentElement;
      depth++;
    }
  }

  return null;
}
/**
 * 检查提交按钮是否不可用
 *
 * 抖店在库存无变化时会把「保存」置灰。
 * 若清零后保存按钮仍不可用，说明库存本就为 0，
 * 继续提交会得到无意义的错误。
 *
 * @param {Element} dialog
 * @returns {boolean}
 */
function isSubmitDisabled(dialog) {
  if (!dialog) return false;

  const labels = ['保存', '确定', '提交'];

  for (const label of labels) {
    const nodes = findAllByText(label, { exact: true, root: dialog });

    for (const node of nodes) {
      const btn = node.closest('button');
      if (!btn) continue;
      if (btn.disabled) return true;

      // 抖店可能用class 表达禁用态而非 disabled 属性
      const cls = String(btn.className || '');
      if (/disabled|is-disabled|btn-disabled/i.test(cls)) return true;

      // 包裹层也可能带禁用样式
      const wrapper = btn.parentElement;
      if (wrapper) {
        const wcls = String(wrapper.className || '');
        if (/disabled|is-disabled/i.test(wcls)) return true;
      }
    }
  }

  return false;
}

/**
 * 提交弹窗
 * @returns {boolean} 是否成功点击提交按钮
 */
function submitDialog(scope) {
  if (!scope) return false;

  // ---- 方式一：Aurora 主按钮特征（实测确认，最可靠）----
  // class 含aurora-btn-primary 且为 solid 变体
  const auroraPrimary = scope.querySelectorAll(
    '.aurora-btn-primary, [class*="aurora-btn-primary"]'
  );

  for (const el of auroraPrimary) {
    if (el.disabled || el.getAttribute('aria-disabled') === 'true') continue;
    if (el.closest && el.closest('#dyb-dialog-root')) continue;

    const text = normalize(el.textContent);
    // 排除取消类
    if (/取消|关闭/.test(text)) continue;

    console.log('[DYB] 命中 Aurora 主按钮:', text.slice(0, 20));
    el.click();
    return true;
  }

  // ---- 方式二：文案匹配 ----
  const labels = ['保存', '提交', '确定', '确认'];

  for (const label of labels) {
    const nodes = findAllByText(label, { exact: true, root: scope });

    for (const node of nodes) {
      if (node.closest && node.closest('#dyb-dialog-root')) continue;

      // Aurora 按钮可能是 div，需向上找到可点击元素
      const clickable = node.closest('button') ||
        node.closest('[class*="aurora-btn"]') ||
        (node.tagName === 'BUTTON' ? node : null);

      if (!clickable || clickable.disabled) continue;

      const text = normalize(clickable.textContent);
      if (/取消|关闭|清零|清空/.test(text)) continue;

      console.log('[DYB] 命中文案按钮:', text.slice(0, 20));
      clickable.click();
      return true;
    }
  }

  // ---- 方式三：Aurora solid 变体按钮 ----
  const solidBtns = scope.querySelectorAll('[class*="aurora-btn-variant-solid"]');
  for (const btn of solidBtns) {
    if (btn.disabled) continue;
    if (btn.closest && btn.closest('#dyb-dialog-root')) continue;

    const text = normalize(btn.textContent);
    if (/取消|关闭|清零|清空/.test(text)) continue;

    console.log('[DYB] 命中 Aurora solid 按钮:', text.slice(0, 20));
    btn.click();
    return true;
  }

  // ---- 方式四：通用 primary 样式 ----
  for (const sel of ['button[class*="primary"]', '.semi-button-primary', '[class*="btn-primary"]']) {
    const btns = scope.querySelectorAll(sel);
    for (const btn of btns) {
      if (btn.disabled) continue;
      if (btn.closest && btn.closest('#dyb-dialog-root')) continue;

      const text = normalize(btn.textContent);
      if (/取消|关闭|清零|清空/.test(text)) continue;

      console.log('[DYB] 命中通用主按钮:', text.slice(0, 20));
      btn.click();
      return true;
    }
  }

  console.warn('[DYB] 未找到提交按钮，页面上的按钮文案:',
    Array.from(scope.querySelectorAll('button, [class*="aurora-btn"]'))
      .slice(0, 15)
      .map(b => normalize(b.textContent).slice(0, 10) || '(空)')
      .join(' | '));

  return false;
}/**
 * 安全关闭弹窗
 */
function closeDialogSafely(dialog) {
  if (!dialog) return;

  const closeSelectors = [
    '[class*="modal-close"]',
    '[aria-label="close"]',
    '[class*="close"]'
  ];

  for (const sel of closeSelectors) {
    const btn = dialog.querySelector(sel);
    if (btn && !btn.disabled) {
      btn.click();
      return;
    }
  }

  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 调试面板 / 调试日志 / 调试态判定,已于 2026-10-16 **迁出到 src/content/debug-panel.js**。
 *
 * 迁出原因:本文件只注入「商品列表页」一组,于是中控台开了调试模式只有橙色徽标、
 * 没有面板 —— 而中控台恰恰是功能最密集、最需要诊断的页面。
 * 独立成文件后两组都注入,面板自带挂载(不再依赖 main.js)。
 *
 * 本文件内约 20 处 debugLog(...) 调用**保持不变** ——
 * debug-panel.js 会把 debugLog / isDebugMode 挂到隔离世界的 window 上,
 * 同一组脚本共享该全局作用域,裸调用照常可用。
 */
