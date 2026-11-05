/**
 * 中控台商品定位器 · 商品项识别
 *
 * 与商品管理页的「清空库存」功能完全独立，两套脚本互不干扰。
 *
 * 页面事实（基于实测诊断）：
 *   - 商品一行一个，纵向排列，间距约 216px
 *   - 页面有竖向滚动条，商品全量渲染在 DOM 中，非虚拟滚动
 *   - 商品列表容器 class 为空、内容高约 31752px
 *
 * 识别策略的核心教训：
 *   单纯「子元素同class 数量最多」会选中侧边栏菜单 ——
 *   侧边栏有 50+ 个菜单项，数量远超商品列表。
 *   必须叠加商品语义校验，不能只看结构数量。
 */

/**
 * 商品行的语义特征。
 *
 * 收窄说明：早期版本含「库存」「讲解」等宽泛词，
 * 导致侧边栏的「直播工具」「资金」等运营菜单也被误判为商品
 * （自测显示误命中 5 个侧边栏节点）。
 * 现在只保留商品行独有的强特征。
 */
const PRODUCT_HINTS = [
  '设置卖点', '未设提词', '到手价', '售出', '货号', '规格'
];

/**
 * 判断一个元素是否是商品行
 */
function isProductRow(el) {
  if (!el) return false;

  const text = el.innerText || '';
  if (text.length < 15 || text.length > 2000) return false;

  const hasHint = PRODUCT_HINTS.some((h) => text.indexOf(h) > -1);
  if (!hasHint) return false;

  const rect = el.getBoundingClientRect();
  if (rect.width < 300 || rect.height < 30) return false;

  // 商品行必然含价格数字。侧边栏菜单不会有。
  if (!/¥\s*\d+|\d+\.\d{2}/.test(text)) return false;

  return true;
}

/**
 * 在给定容器内找出商品行列表
 *
 * 关键实测结论（来自自测输出）：
 *   商品行的 class 是**空字符串**，因此按 class 分组永远失败。
 *   必须改用「内容特征 + 垂直等距」来识别：
 *     1. 直接子元素中命中商品特征的
 *     2. 它们的高度应彼此接近（一行一个，间距固定约 216px）
 *     3. 它们的 top 应按顺序等差递增
 *
 * @param {Element} container
 * @returns {Element[]|null}
 */
function extractProductRows(container) {
  // 第一步：取出所有直接子元素中命中商品特征的
  const candidates = [];
  for (const child of container.children) {
    if (isProductRow(child)) candidates.push(child);
  }
  if (candidates.length < 3) return null;

  // 第二步：要求高度接近。商品行等高，而「父容器 + 商品」的组合
  // 高度会随内容变化。用高度方差过滤掉嵌套层级不对的情况。
  const heights = candidates.map((el) => el.getBoundingClientRect().height);
  const avgH = heights.reduce((a, b) => a + b, 0) / heights.length;
  const uniform = candidates.filter((el) => {
    const h = el.getBoundingClientRect().height;
    return Math.abs(h - avgH) < avgH * 0.3;
  });
  if (uniform.length < 3) return null;

  // 第三步：按 top 排序，商品应是自上而下的顺序
  uniform.sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top);

  return uniform;
}

/**
 * 自顶向下搜索商品列表容器
 */
function findListContainer(root) {
  const all = root.querySelectorAll('div, li');

  let best = null;
  let bestCount = 0;

  for (const el of all) {
    if (el.children.length < 3) continue;

    const products = extractProductRows(el);
    if (products && products.length > bestCount) {
      bestCount = products.length;
      best = products;
    }
  }

  if (best && best.length >= 3) return best;

  // ===== 兜底：自底向上重试 =====
  // 若商品行被包在中间层，父容器的直接子元素就不是商品行本身。
  // 策略：先收集全页所有商品节点，再逐个向上找父级，
  //      统计每个父级下有多少「后代或自身」是商品，取最多的那个父级。
  const productNodes = [];
  for (const el of all) {
    if (isProductRow(el)) productNodes.push(el);
  }
  if (productNodes.length < 3) return best;

  const parentCount = new Map();
  for (const p of productNodes) {
    let cur = p;
    // 最多向上 4 层，避免把整个页面当成容器
    for (let up = 0; up < 4 && cur.parentElement; up++) {
      cur = cur.parentElement;
      parentCount.set(cur, (parentCount.get(cur) || 0) + 1);
    }
  }

  let bestParent = null;
  let maxCount = 0;
  for (const [parent, n] of parentCount) {
    if (n > maxCount) {
      maxCount = n;
      bestParent = parent;
    }
  }

  if (bestParent && maxCount >= 3) {
    // 取该父级下所有商品后代，按 top 排序
    const rows = [];
    const seen = new Set();
    for (const p of productNodes) {
      if (bestParent.contains(p) && !seen.has(p)) {
        seen.add(p);
        rows.push(p);
      }
    }
    rows.sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top);
    if (rows.length >= 3) return rows;
  }

  return best;
}

/**
 * 找到主滚动容器
 *
 * 实测：商品列表所在容器内容高 31752px，是页面最高的可滚动容器。
 *
 * 带缓存：此函数会被高频调用（每次算总数都要用），
 * 而内部要querySelectorAll 遍历全页 DOM，开销不小。
 * 商品列表容器在一场直播内不会变，缓存 10 秒足够安全。
 */
let _scrollerCache = null;
let _scrollerCacheAt = 0;
const SCROLLER_CACHE_MS = 10000;

/**
 * 商品行容器缓存（2026-10-13 性能优化）
 *
 * 【为什么需要】
 *   getProductItems() 是慢路径：在整个滚动容器里 querySelectorAll('div, li')，
 *   对每个 children.length>=3 的候选调 extractProductRows()，而它又要对候选的
 *   每个子元素读 innerText（强制同步布局）判断是不是商品行。146 个商品的页面里
 *   这是**几百~上千次 innerText**。
 *
 *   全能搜索的全量扫描每滚一屏都要重新识别「当前渲染出来的行」，且等新屏
 *   渲染时用的是 30ms 轮询，轮询判据本身就是「再跑一次识别」—— 于是这份昂贵
 *   开销在扫描期间被重复几十~几百次，扫描因此从秒级拖到十秒级。
 *
 * 【怎么做】
 *   第一次识别成功后，记住这批行的**共同父节点**（虚拟列表容器里它的直接
 *   子元素就是商品行，约 8~20 个）。此后直接从该容器的直接子元素取行，
 *   把「几百次 innerText」降为「十几个」。
 *
 * 【失效兜底】结果永远与慢路径等价：
 *   · 容器被 SPA 重建（isConnected 为 false）→ 立刻回慢路径；
 *   · 结构变了导致连续 3 次取不到 3 行 → 丢弃缓存回慢路径；
 *   · 任一步异常 → 回慢路径。
 *   快路径只影响**性能**，不影响任何识别结果。
 */
let _rowsHost = null;
let _rowsHostMiss = 0;

function getScrollContainer(forceRefresh) {
  const now = Date.now();

  // 强制刷新 = 调用方认为页面结构可能已变：行容器缓存一并作废
  if (forceRefresh) _rowsHost = null;

  if (!forceRefresh && _scrollerCache && (now - _scrollerCacheAt) < SCROLLER_CACHE_MS) {
    // 缓存的节点可能已从 DOM 移除，需验证
    if (_scrollerCache.isConnected) return _scrollerCache;
  }

  let best = null;

  for (const el of document.querySelectorAll('div, section, main')) {
    const st = getComputedStyle(el);
    if (st.overflowY !== 'auto' && st.overflowY !== 'scroll') continue;
    if (el.scrollHeight <= el.clientHeight + 30) continue;

    const rect = el.getBoundingClientRect();
    if (rect.width < 200 || rect.height < 200) continue;

    // 商品行高约 208px，容器内容高至少要装得下三行才有意义。
    // 此前缺此校验时曾误选到内容高仅 8px 的退化元素，
    // 加了缓存后该错误被固化，导致总数推算为 0。
    if (el.scrollHeight < 600) continue;

    if (!best || el.scrollHeight > best.scrollHeight) {
      best = el;
    }
  }

  // 未找到合规容器时返回 null，让调用方走兜底，
  // 绝不返回一个内容高 8px 的错误容器。
  _scrollerCache = best;
  _scrollerCacheAt = now;
  return best;
}

/**
 * 获取当前页面全部商品项
 * @returns {Element[]}
 */
function getProductItems() {
  // ===== 快速路径（2026-10-13 性能优化，见 _rowsHost 注释）=====
  if (_rowsHost) {
    let quick = null;
    try { quick = rowsFromHost(_rowsHost); } catch (e) { quick = null; }
    if (quick && quick.length >= 3) {
      _rowsHostMiss = 0;
      return quick;
    }
    if (!_rowsHost.isConnected || !_rowsHost.children) {
      _rowsHost = null;          // 容器没了：立刻作废
    } else if (++_rowsHostMiss >= 3) {
      _rowsHost = null;          // 连续 3 次取不到：结构已变，作废
      _rowsHostMiss = 0;
    }
    // 否则保留缓存，本次仍走慢路径保证结果正确
  }

  // 慢路径：作用域优先级 = 主滚动容器 → 全页
  const scopes = [];
  const scroller = getScrollContainer();
  if (scroller) scopes.push(scroller);
  scopes.push(document.body);

  for (const scope of scopes) {
    const found = findListContainer(scope);
    if (found && found.length >= 3) {
      rememberRowHost(found);   // 记下共同父节点，供下次快速路径使用
      return found;
    }
  }

  return [];
}

/**
 * 全部商品行（并集）—— 内容类功能专用
 *
 * 【为什么需要它（2026-10-15 · 用户反馈「小黄车商品名一直是省略号」）】
 *
 *   getProductItems() 为了「选对容器」，带一道**等高校验**：高度偏离均值
 *   30% 以上的行会被整行剔掉。但**名称折行本身会改变行高** —— 于是已经
 *   折好行的行成了多数，少数还没折行的行反而变成「离群值」被剔除：
 *
 *     折行 → 该行变高 → 未折行的行成为离群 → 被剔出集合
 *          → 名称换行不再扫它、货号按钮也不再注入它
 *          → 它永远不折行 → 继续是离群值（锁死，永久省略号）
 *
 *   真机实测（百应中控台 · 迟采样）：112 行里 100 行折好了、**5 行从未被
 *   处理**，而这 5 行行内**同时**没有扩展的「货号」按钮 —— 两个功能共用
 *   同一个行集合，所以是「行集合漏了行」，不是两个功能各自的逻辑问题。
 *
 * 【本函数怎么做】
 *
 *   在 getProductItems() 之外，再用**结构锚**补捞一遍：平台每行都有一枚
 *   「复制 ID」小按钮（与 copy-code.js 取号用的是同一个锚），从它反查所在行
 *   —— 凡是被等高校验误剔的行，都能这样捞回来。两者取并集、按 top 排序。
 *
 * 【给谁用 —— 影响面隔离】
 *
 *   内容类功能（名称换行 / 货号按钮 / 搜索）用本函数；
 *   **依赖等距几何的「序号定位」仍用 getProductItems()** —— 不让「行高不齐」
 *   污染它的间距推算。原函数因此保持原样、零改动。
 *
 * 带 250ms 短缓存：补涂是高频调用，而补捞要遍历一次 DOM。
 *
 * @param {boolean} [fresh] true = 绕开缓存，强制重新收集。
 *        定位路径必须传 true（见函数体注释：用缓存会拿到滚动前的旧节点）。
 * @returns {Element[]} 至少为空数组，调用方不必判 null
 */
function getAllProductRows(fresh) {
  const now = Date.now();
  /* ★ 2026-10-18(#94 后续:定位超时)新增 fresh 参数。
   *
   * 这个 250ms 缓存是为「补涂高频调用」设计的 —— 对名称换行 / 货号按钮是对的
   * (同一屏内反复扫没有意义)。但**定位**不一样:它刚把 scrollTop 挪走,
   * 紧接着就要问「新的一屏里有没有目标行」。若这一次读命中缓存,
   * 拿回来的是**滚动前**那一批节点 —— 它们要么已经脱离文档(rect 全 0),
   * 要么还在旧偏移上,于是「怎么等都等不到目标」⇒ 定位超时。
   * 所以定位路径必须显式传 fresh=true 绕开缓存。 */
  /* fresh 也不是「每 30ms 都全量重扫一遍」—— 补捞要遍历一次 DOM，轮询里那么干
   * 会白白烧 CPU。所以 fresh 只**绕开 250ms 那条长缓存**，另设一条 80ms 的
   * 「同一次轮询窗口内不重复扫」底线：虚拟列表两屏之间的稳定期远长于 80ms，
   * 这点延迟不影响「滚过去 → 渲染出来 → 认到」的时序。 */
  const ttl = fresh ? FRESH_MIN_TTL : ALL_ROWS_TTL;
  if (_allRowsCache && now - _allRowsCache.t < ttl) return _allRowsCache.rows;

  let out = [];
  try {
    const base = getProductItems();
    if (base && base.length) out = base.slice();
  } catch (e) { /* 主路径异常不影响补捞 */ }

  /* 结构锚补捞：平台「复制 ID」按钮 → 所在行。
   *
   * ★ 2026-10-18 修「定位与全能搜索都超时」—— **收窄补捞范围**。
   *
   *   原来无条件对整个滚动容器做 `querySelectorAll('span,a,button,div,i,b,em')`，
   *   再逐个读 clientWidth / clientHeight（布局读取）。中控台的滚动容器里
   *   商品卡 + 控件 + 隐藏节点合起来是**上万**量级，一次补捞就要几十毫秒；
   *   而这段代码会被 30ms / 100ms 级的轮询反复调到 —— 主线程被它吃满，
   *   虚拟列表拿不到渲染机会，于是轮询永远等不到目标行 ⇒ 表现为「超时」。
   *
   *   收窄依据：_rowsHost 是 getProductItems 已经确认过的「商品行的共同父节点」，
   *   它的直接子元素就是**全部**商品行（快路径只是按等高把它们筛了一遍）。
   *   所以只要在这个容器里找「复制 ID」按钮，就等于覆盖了全量商品行，
   *   而与「页面上有多少无关节点」彻底解耦 —— 候选从上千降到十几个。
   *
   *   只有 _rowsHost 还没建立（首次识别 / 结构刚变）时才退回全容器扫；
   *   那种情况一小时内只会发生个位数次。
   */
  try {
    const host = (_rowsHost && _rowsHost.isConnected) ? _rowsHost : null;
    const scope = host || getScrollContainer() || document.body;
    const seen = new Set(out);

    /* 【2026-11-05 · 反馈 #130 性能】先算「主路径没收录的行」再决定怎么补。
     *
     * 原实现无论缺不缺行，都对整个容器做一次
     * querySelectorAll('span,a,button,div,i,b,em')（硬预算 600），再逐候选读
     * clientWidth / clientHeight（布局读取）。行全部在集合里时（绝大多数时刻，
     * 包括拖拽中的每一帧），这 600 个候选与后续量测**全是白做** —— 112 行规模
     * 下它让单轮补扫稳定吃掉几十毫秒，而补扫每 250~300ms 就跑一次。
     *
     * 现在：漏行很少（真机实测 5/112）时只查这几行；漏行很多（整表重建）
     * 才退回原来的整容器扫 —— 那种情况逐行查反而更贵。语义不变：补捞的
     * 目的本来就是捞回被等高校验误剔的行。
     */
    const miss = [];
    if (host) {
      const kids = host.children;
      for (let i = 0; i < kids.length; i++) {
        if (kids[i] && !seen.has(kids[i])) miss.push(kids[i]);
      }
    }

    if (host && miss.length === 0) {
      /* 一行不缺：本轮无需补捞（最常见的路径，零查询） */
    } else if (host && miss.length <= 12) {
      for (let i = 0; i < miss.length; i++) {
        const kid = miss[i];
        let btns = findIdLikeButtons(kid);
        // 行被包了一层时按钮在内层（与 rowsFromHost 的深度 2 兜底同口径）
        if (!btns.length && kid.children && kid.children.length >= 3) {
          for (let j = 0; j < kid.children.length && !btns.length; j++) {
            btns = findIdLikeButtons(kid.children[j]);
          }
        }
        for (let b = 0; b < btns.length; b++) {
          const row = rowOfIdButton(btns[b]);
          if (row && !seen.has(row)) { seen.add(row); out.push(row); }
        }
      }
    } else {
      const btns = findIdLikeButtons(scope);
      for (let i = 0; i < btns.length; i++) {
        const row = rowOfIdButton(btns[i]);
        if (row && !seen.has(row)) { seen.add(row); out.push(row); }
      }
    }
  } catch (e) { /* 补捞失败就退回主路径结果 */ }

  /* 排序：先把 top 一次性读出来再比较。原来在比较器里读 gBCR，
   * 112 行要读 N log N 次（约 750 次），每次都是一次布局查询。 */
  const tops = new Map();
  for (let i = 0; i < out.length; i++) {
    tops.set(out[i], out[i].getBoundingClientRect().top);
  }
  out.sort((a, b) => (tops.get(a) || 0) - (tops.get(b) || 0));
  _allRowsCache = { t: now, rows: out };
  return out;
}

let _allRowsCache = null;
const ALL_ROWS_TTL = 250;      // 补涂/按钮注入等高频路径用的短缓存
const FRESH_MIN_TTL = 80;      // fresh 调用的下限：轮询窗口内不重复全量扫

/**
 * 找平台自带的「复制 ID」小按钮（内容特征识别，不依赖 class 哈希）。
 * 口径与 copy-code.js / name-wrap.js 一致，三处不打架。
 */
function findIdLikeButtons(scope) {
  const out = [];
  const cands = scope.querySelectorAll('span,a,button,div,i,b,em');
  /* 硬预算：正常路径下 scope 已是「商品行共同父节点」，候选只有十几个；
   * 只有退回全容器扫时才会撞到这个上限。宁可这一轮少补捞几行，
   * 也不让一次调用把主线程占住 —— 超时的代价远大于偶尔漏一行。 */
  const MAX_CANDS = 600;
  const n = Math.min(cands.length, MAX_CANDS);
  for (let i = 0; i < n; i++) {
    const el = cands[i];
    if (el.getAttribute('data-dyc-code-btn') === '1') continue;   // 扩展自己注入的不算
    if (el.clientWidth < 8 || el.clientWidth > 60) continue;      // 只认小按钮
    if (el.clientHeight < 8 || el.clientHeight > 40) continue;
    if (el.children && el.children.length > 2) continue;          // 性能护栏：大容器先排除
    const t = (el.textContent || '').trim();
    if (t !== 'ID' && t !== 'id') {
      const lab = (el.getAttribute('title') || '') + ' ' + (el.getAttribute('aria-label') || '');
      if (t.length > 4 || !/复制|(^|\s)ID(\s|$)/i.test(lab)) continue;
    }
    out.push(el);
  }
  return out;
}

/**
 * 从「复制 ID」按钮反查它所在的商品行。
 *
 * 先按严格口径（isProductRow：语义特征 + 尺寸 + 价格）；拿不到时退到宽松
 * 口径（只要够宽、文本够长、含价格）—— 免得「语义特征词恰好没渲染出来」
 * 的行又被漏掉一次。
 *
 * ★ 2026-10-20（#100-附 用户截图「有些地方的闪烁框会变得不一样」）：
 *   **爬升终点必须与主路径同层级**。主路径的行 = _rowsHost（行的共同父
 *   节点）的直接子元素；这里若在爬升途中遇到「像行」的内层容器就返回，
 *   同一物理行会以**两种盒子**存在于集合里：
 *     · 呼吸灯 highlight() 的框 = 该元素的盒子 ⇒ 补捞行的闪烁框比主路径
 *       行小一圈（信息区容器就满足宽松判据：宽≥300、含价格）——
 *       折行的行（行高偏离均值 30%）恰是主路径剔除、只能走补捞的，
 *       于是「折行行的框小、不折的框大」，观感即「有些地方不一样」；
 *     · 同一行还可能以外层+内层两个条目重复进集合（去重只认同引用），
 *       定位认行认到哪层是碰运气，succeed() 报的名字随之漂。
 *   修法 = 爬升终点对齐 _rowsHost 的直接子元素（与主路径同源）；
 *   _rowsHost 还没建立（首次识别/结构刚变）时退回原判据保底。
 */
function rowOfIdButton(btn) {
  const host = (_rowsHost && _rowsHost.isConnected) ? _rowsHost : null;
  let cur = btn;
  for (let up = 0; up < 12 && cur; up++) {
    if (host) {
      if (cur === host) break;                       // 爬到 host 自己:层级不对,放弃
      if (cur.parentElement === host
          && (isProductRow(cur) || looksLikeRowLoose(cur))) return cur;
    } else if (isProductRow(cur) || looksLikeRowLoose(cur)) {
      return cur;
    }
    cur = cur.parentElement;
  }
  return null;
}

/** 宽松的行判定：只要求「够宽、文本够长、含价格」 */
function looksLikeRowLoose(el) {
  const text = el.innerText || '';
  if (text.length < 15 || text.length > 2000) return false;
  const rect = el.getBoundingClientRect();
  if (rect.width < 300 || rect.height < 30) return false;
  return /¥\s*\d+|\d+\.\d{2}/.test(text);
}

/**
 * 记下这批商品行的共同父节点（快速路径的缓存锚点）。
 * 只有全部行同父时才缓存 —— 否则「从父节点取子元素」会取错集合。
 */
function rememberRowHost(rows) {
  try {
    const host = rows[0] && rows[0].parentElement;
    if (!host || host === rows[0]) return;
    for (const r of rows) {
      if (r.parentElement !== host) return;   // 不同父：不缓存
    }
    _rowsHost = host;
    _rowsHostMiss = 0;
  } catch (e) { /* 缓存失败只影响性能，不影响结果 */ }
}

/**
 * 从缓存的「行容器」里取当前渲染的商品行。
 *
 * 深度 1：容器的直接子元素即商品行（虚拟列表容器常态）；
 * 深度 2：行被一层包装元素包着时，往下再探一层。
 * 返回不足 3 行视为失败，交给慢路径。
 */
function rowsFromHost(host) {
  if (!host || !host.isConnected || !host.children) return null;
  const kids = host.children;
  if (kids.length < 3 || kids.length > 400) return null;

  let out = collectProductRows(kids);
  if (out.length >= 3) return out;

  // 深度 2 兜底：行被包了一层
  for (let i = 0; i < kids.length; i++) {
    const c = kids[i];
    if (!c || !c.children || c.children.length < 3) continue;
    out = collectProductRows(c.children);
    if (out.length >= 3) return out;
  }
  return null;
}

/**
 * 从一组候选元素里筛出商品行，并做「等高」校验
 * —— 与 extractProductRows 同口径，保证快慢两条路径结果一致。
 */
function collectProductRows(nodes) {
  /* 量测合并（2026-11-05 · 反馈 #130）：等高校验与排序复用同一次
   * getBoundingClientRect。原来高度读两遍（map 一遍、filter 里再一遍）、
   * 排序比较器里又读 top —— 112 行合计 700+ 次布局查询，而这条路径
   * 每 250ms 就被补涂调一次。现在每行固定读一次。 */
  const items = [];
  for (let i = 0; i < nodes.length; i++) {
    const el = nodes[i];
    if (!el) continue;
    if (!isProductRow(el)) continue;
    const r = el.getBoundingClientRect();
    items.push({ el: el, h: r.height, top: r.top });
  }
  if (items.length < 3) return [];

  let sum = 0;
  for (let i = 0; i < items.length; i++) sum += items[i].h;
  const avgH = sum / items.length;

  const uniform = [];
  for (let i = 0; i < items.length; i++) {
    if (Math.abs(items[i].h - avgH) < avgH * 0.3) uniform.push(items[i]);
  }
  if (uniform.length < 3) return [];

  uniform.sort((a, b) => a.top - b.top);
  const out = [];
  for (let i = 0; i < uniform.length; i++) out.push(uniform[i].el);
  return out;
}

/**
 * 商品列表「渲染出行了吗」—— **最便宜的就绪判据**。
 *
 * 为什么单独给一个函数（2026-10-18）：
 *   三个浮动控件都要回答这一个问题（搜索圆钮 / 上滑到顶 / 下滑到底），
 *   而它们的调用点全在**高频路径**上：滚动事件、250ms 就绪轮询、
 *   定位与搜索的 30ms fastWait。用 getProductItems() 虽然已经比补捞便宜，
 *   但在**列表还没出来**的那段时间里它会一直走慢路径
 *   （querySelectorAll('div, li') + 逐候选读 innerText），而这正是
 *   页面加载最吃紧的时候 —— 于是「等就绪」的轮询反而拖慢了「变就绪」。
 *
 * 判据顺序（从最便宜到最贵，命中即返回）：
 *   1. 有 _rowsHost 且仍连着 ⇒ 直接看它有没有 3 个以上子元素（零布局读）；
 *   2. 没有 host ⇒ 只看滚动容器的 scrollHeight 是否够装三行（一次读，便宜）；
 *   3. 两者都不成立 ⇒ 才回落到 getProductItems() 做一次真实识别。
 *
 * 回答「有没有行」不需要精度 —— 精度留给真正需要行集合的地方。
 */
function hasProductRows() {
  try {
    if (_rowsHost && _rowsHost.isConnected && _rowsHost.children
        && _rowsHost.children.length >= 3) {
      return true;
    }
    const sc = getScrollContainer();
    if (!sc) return false;
    // 内容高装不下三行 ⇒ 不可能是渲染好的商品列表（一次布局读）
    if (sc.scrollHeight < 600) return false;
    const items = getProductItems();
    return !!(items && items.length);
  } catch (e) {
    return false;
  }
}

/**
 * 商品总数
 *
 * 虚拟滚动下 DOM 里只有可视区那几个（实测恒为 8 个），
 * 无法通过数节点得到总数。改用「内容高÷ 行距」推算。
 */
function getProductTotal() {
  const scroller = getScrollContainer();
  if (!scroller) return 0;

  // 容器内容高必须装得下至少三行商品，否则不是商品列表容器
  if (scroller.scrollHeight < 600) return 0;

  const spacing = measureRowSpacing();
  if (!spacing || spacing <= 0) return 0;

  // 行距含商品高与间距，直接相除即为总数
  const total = Math.max(0, Math.round(scroller.scrollHeight / spacing));

  // 兜底：推算结果应明显大于 DOM 中可见的商品数，
  // 否则说明间距测错或容器不对，宁可返回 0 也不给错误数字
  // 兜底只做「量级」校验，不需要补捞精度 —— 用便宜路径（_rowsHost 快路径）
  const visible = getProductItems().length;
  if (total < visible) return 0;

  return total;
}

/**
 * 几何类功能（序号定位 / 总数推算 / 兜底定位）的取行入口。
 *
 * 2026-10-18:统一改用**并集行集合**。原先这些地方直接调 getProductItems()，
 * 而它为了「选对容器」带一道等高校验（偏离均值 30% 的行整行剔掉）——
 * 「商品名称不折叠」默认开启后，名字长的行折行变高，少数没折行/折得更长的行
 * 就成了离群值被剔出集合。表现在用户那里是两件事：
 *   · 全能搜索搜不到那几行（已改）；
 *   · 序号定位算出来的总数偏少、翻到后面被告知「超出范围」。
 * 现在三处统一，口径与名称换行 / 货号按钮一致。
 *
 * 注意：并集集合里**行高可能不等**，所以凡是用它做几何推算的地方，
 * 都不能再假定「等距」—— 见 locateProduct 的注释与 search.js 的精确偏移表。
 */
function rowListForGeo() {
  /* ★★ 2026-10-18 第二次修正：**几何类功能退回 getProductItems()**。
   *
   * 早先我把这里统一成 getAllProductRows()（并集行集合），想法是「和名称换行 /
   * 货号按钮同一口径」。那是错的，两件事被混在了一起：
   *
   *   · **内容类**（名称换行 / 货号按钮 / 搜索扫描）要的是「把一个都别漏」——
   *     补捞正好补上被等高校验误剔的行，用并集是对的；
   *   · **几何类**（行距 / 总数 / 序号定位）要的是「行高一致」——
   *     而补捞回来的行恰恰是**行高不齐**的那几行。把它们混进来，
   *     行距会测出偏小的值、总数会偏大、findByOrdinal 也会跳偏；
   *     更致命的是补捞本身很贵（全容器通配 + 逐元素读布局），
   *     而这里被 waitFor 以 100ms 一轮反复调用 —— 主线程被吃满，
   *     虚拟列表拿不到渲染机会，于是「第 N 个商品加载超时」。
   *
   * 所以此处恢复为纯 getProductItems()（带 _rowsHost 快路径，只读十几个元素）。
   */
  return getProductItems();
}

/**
 * 测量行距（相邻商品顶边之差）
 *
 * 依赖「当前视口内至少有两个商品节点」，虚拟滚动下总能满足。
 */
function measureRowSpacing() {
  const items = rowListForGeo();
  if (items.length < 2) return 0;

  const sorted = items.slice().sort((a, b) => {
    return a.getBoundingClientRect().top - b.getBoundingClientRect().top;
  });

  // 取多处间距的中位数，避免个别异常值干扰
  const gaps = [];
  for (let i = 1; i < sorted.length; i++) {
    const g = sorted[i].getBoundingClientRect().top -
      sorted[i - 1].getBoundingClientRect().top;
    if (g > 10) gaps.push(g);
  }
  if (gaps.length === 0) return 0;

  gaps.sort((a, b) => a - b);
  return gaps[Math.floor(gaps.length / 2)];
}

/**
 * 滚动到第 N 个商品并高亮
 *
 * 虚拟滚动下的定位策略：
 *   1. 先滚到列表顶部，让第 1 个商品渲染出来，测得它的基准位置
 *   2. 按行距算出第 N 个的目标位置
 *   3. 滚到该位置，等虚拟列表渲染出该节点
 *   4. 在新渲染的节点中找出第 N 个，点亮呼吸灯
 *
 * 全程不调用 click()。
 *
 * @param {number} index 序号，1 起
 * @param {Function} done 回调 (result) => void，定位完成后触发
 */
function locateProduct(index, done) {
  const scroller = getScrollContainer(true);
  if (!scroller) {
    done({ ok: false, message: '没找到商品列表，请确认页面已加载' });
    return;
  }

  const spacing = measureRowSpacing();
  if (!spacing) {
    done({ ok: false, message: '商品列表还没加载好，请稍后再试' });
    return;
  }

  const total = Math.max(0, Math.round(scroller.scrollHeight / spacing));
  if (index < 1 || index > total) {
    done({
      ok: false,
      // 输入错误类(不是真异常):调用方据此不收录进消息盒子(2026-10-15 用户定)
      quiet: true,
      message: '序号超出范围，当前共 ' + total + ' 个商品'
    });
    return;
  }

  // 回到顶部，测得第 1 个的基准位置
  window.__dycScriptScrollAt = Date.now();   // 程序化滚动豁免(auto-refresh 藏灯判定,下同)
  scroller.scrollTop = 0;
  waitFor(() => {
    return rowListForGeo().length > 0;
  }, function () {
    const base = rowListForGeo();
    if (base.length === 0) {
      done({ ok: false, message: '商品列表还没显示出来，请稍后再试' });
      return;
    }

    // 基准：当前视口内 top 最小的那个商品，其相对容器的偏移
    const cRect = scroller.getBoundingClientRect();
    let baseTop = Infinity;
    for (const el of base) {
      const r = el.getBoundingClientRect();
      const rel = r.top - cRect.top + scroller.scrollTop;
      if (rel < baseTop) baseTop = rel;
    }

    // 目标：第 index 个的容器内偏移
    const targetOffset = baseTop + (index - 1) * spacing;

    // 先滚内层商品容器，让目标商品进入渲染范围
    const desired = targetOffset - (scroller.clientHeight / 2 - spacing / 2);
    window.__dycScriptScrollAt = Date.now();
    scroller.scrollTop = Math.max(0, desired);

    // 等虚拟列表把目标商品渲染出来
    waitFor(function () {
      return findByOrdinal(scroller, baseTop, spacing, index) !== null;
    }, function () {
      const target = findByOrdinal(scroller, baseTop, spacing, index);
      if (!target) {
        done({
          ok: false,
          message: '第 ' + index + ' 个商品加载超时，请重试'
        });
        return;
      }

      // 再逐级向外滚，让目标真正进入浏览器视口中央。
      // 内层滚完只是让它渲染出来，页面本身还停在原处。
      scrollElementToViewportCenter(target);

      highlight(target);
      done({
        ok: true,
        message: '序号 ' + index,
        item: target
      });
    });
  }, 2000);
}

/**
 * 把元素滚动到视口中央
 *
 * 中控台是嵌套滚动结构（实测）：
 *   外层页面容器 1135x913，内容高 2163
 *   内层商品容器 961x1178，内容高 31752，top=973（首屏之外）
 *
 * 只滚内层，浏览器窗口不会动，用户依然看不到。
 * 因此必须逐级向上，把所有祖先滚动容器都滚到位。
 */
function scrollElementToViewportCenter(el) {
  const viewportCenter = window.innerHeight / 2;

  // 逐级滚动是程序化滚动,先打点(auto-refresh 的「滚动中藏灯」要豁免它)
  window.__dycScriptScrollAt = Date.now();

  // 目标元素当前的视口坐标
  let target = el.getBoundingClientRect().top + el.getBoundingClientRect().height / 2;

  // 向上遍历所有可滚动的祖先
  let node = el.parentElement;
  while (node && node !== document.body) {
    const st = getComputedStyle(node);
    if ((st.overflowY === 'auto' || st.overflowY === 'scroll') &&
      node.scrollHeight > node.clientHeight + 10) {

      const nodeRect = node.getBoundingClientRect();
      const nodeCenter = nodeRect.top + node.clientHeight / 2;

      // 元素中心与容器中心的差值即为需要滚动的量
      const delta = target - nodeCenter;
      if (Math.abs(delta) > 1) {
        node.scrollTop += delta;
      }
      target = nodeRect.top + node.clientHeight / 2;
    }
    node = node.parentElement;
  }

  // 最后处理页面级滚动（body 或 documentElement）
  const scrollable = document.scrollingElement || document.documentElement;
  if (scrollable && scrollable.scrollHeight > scrollable.clientHeight + 10) {
    const rect = el.getBoundingClientRect();
    const center = rect.top + rect.height / 2;
    scrollable.scrollTop += center - viewportCenter;
  }
}

/**
 * 在当前渲染的商品中，找出序号为 index 的那个。
 *
 * ⚠️ **只在「每行等高」的列表上可靠（2026-10-18 起降级为兜底路径）。**
 *   它按「首行偏移 + (序号−1)×行距」反推目标位置，这个式子成立的前提
 *   就是等距。而「商品名称不折叠」默认开启后，名字长的行会折行变高，
 *   行距不再均匀 —— 用它定位会越走越偏，越靠后的商品偏得越多。
 *
 *   现在的主路径在 `search.js`：扫描时逐行登记**精确偏移与行高**，
 *   定位直接查表（`findByOffsetNow`）。本函数仍保留，供
 *   · `locateProduct()`（序号定位控件）；
 *   · 搜索的兜底路径（扫描几何失效时）
 *   两处使用 —— 这两处拿不到扫表，也只能用等距近似，属于已知局限。
 *
 * @param {Element} scroller 滚动容器
 * @param {number} baseTop 第 1 个商品相对容器的偏移
 * @param {number} spacing 行距
 * @param {number} index 目标序号，1 起
 * @returns {Element|null}
 */
function findByOrdinal(scroller, baseTop, spacing, index) {
  /* ★★ 2026-10-18 第二次修正：**这里必须用等距行集合**（getProductItems）。
   *
   * 上一版改成并集（含结构锚补捞），结果把「第 N 个商品加载超时」做实了。两个原因：
   *
   *   ① **判据本身矛盾**：本函数是拿 `baseTop + (index-1)×spacing` 这个
   *      **等距假设**去比对的，容差只有半个行距。而补捞回来的行恰恰是
   *      行高不齐的那几行 —— 混进来只会让「最近的那个」被邻行抢走，
   *      或者干脆全部超容差。等距公式配非等距集合，天生不合。
   *   ② **代价太高**：补捞每次要全容器通配 + 逐元素读布局，而本函数被
   *      waitFor 以 100ms 一轮轮询、一次定位要跑好几轮 —— 主线程被吃满，
   *      虚拟列表没机会渲染新行，于是永远等不到。
   *
   * 内容类功能（要把行一个不漏地找出来）继续用并集，那是对的；
   * 几何类功能（按行距推算序号）必须用等距集合，且要便宜。
   */
  const items = getProductItems();
  if (items.length === 0) return null;

  const cRect = scroller.getBoundingClientRect();
  const targetOffset = baseTop + (index - 1) * spacing;

  let best = null;
  let bestDiff = Infinity;

  for (const el of items) {
    const r = el.getBoundingClientRect();
    const rel = r.top - cRect.top + scroller.scrollTop;
    const diff = Math.abs(rel - targetOffset);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = el;
    }
  }

  // 偏差超过半个行距，说明这个节点不是目标商品
  if (bestDiff > spacing / 2) return null;
  return best;
}

/**
 * 轮询等待条件成立
 */
function waitFor(condition, onDone, timeoutMs) {
  const start = Date.now();
  const tick = function () {
    let ok = false;
    try {
      ok = condition();
    } catch (e) {
      ok = false;
    }
    if (ok) {
      onDone();
      return;
    }
    if (Date.now() - start > (timeoutMs || 1500)) {
      onDone();
      return;
    }
    setTimeout(tick, 100);
  };
  setTimeout(tick, 120);
}

/**
 * 确保呼吸灯样式已注入
 *
 * 用 JS 动态注入而非写进 nav.css，原因：
 *   1. 动画关键帧与外层容器样式分离，内聚性更好
 *   2. 避免商品页面 CSS 加载顺序影响动画
 *   3. 高亮是按需功能，不需要时不注入，减少对页面的干扰
 */
let glowStyleInjected = false;
function ensureGlowStyle() {
  if (glowStyleInjected) return;
  if (document.getElementById('dyb-breathe-style')) {
    glowStyleInjected = true;
    return;
  }

  const style = document.createElement('style');
  style.id = 'dyb-breathe-style';
  style.textContent = [
    '.dyb-breathe-glow {',
    '  position: absolute;',
    '  inset: 0;',
    '  pointer-events: none;',
    '  border-radius: 4px;',
    '  background: rgba(255, 160, 60, 0.22);',
    '  box-shadow: 0 0 0 2px rgba(255, 150, 40, 0.55) inset;',
    '  animation: dyb-breathe 1s ease-in-out 3;',
    '}',
    '@keyframes dyb-breathe {',
    '  0%, 100% { opacity: 0.15; }',
    '  50% { opacity: 1; }',
    '}'
  ].join('\n');

  document.head.appendChild(style);
  glowStyleInjected = true;
}

/**
 * 呼吸灯叠加层的圆角(#100-附,2026-10-20 用户反馈):
 * 「闪烁框希望改成圆角,跟小黄车商品的框框是一样的弧度,不然小直角很突兀」。
 *
 * 平台卡片弧度没有离线真值,不硬编码猜数 —— **运行时读被点亮行卡的实际
 * borderRadius 跟随**:小黄车里平台卡片是圆的,呼吸灯自动同弧度;
 * 读不到(行卡 borderRadius 为 0 / 异常内核)兜底 8px —— 比原 4px 明显圆,
 * 不再是「小直角」。
 */
function glowRadiusOf(el) {
  try {
    const r = getComputedStyle(el).borderRadius;
    if (r && r !== '0px') return r;
  } catch (e) { /* 读不到用兜底 */ }
  return '8px';
}

/**
 * 呼吸灯高亮
 *
 * 用一层淡橙色叠加层做三次呼吸，比描边醒目但不刺眼 ——
 * 直播场景下需要快速捕捉到目标商品，但过强的闪烁会很干扰。
 *
 * 时长：单次呼吸 1 秒，共 3 次约 3 秒。
 * 最初设为 0.7 秒共 2.1 秒，用户反馈偏短、远处看不清。
 *
 * 结束后移除叠加层，不改动商品原有样式。
 */
function highlight(el) {
  clearHighlight();
  ensureGlowStyle();

  // 叠加层不改变商品布局，仅覆盖其上
  const glow = document.createElement('div');
  glow.className = 'dyb-breathe-glow';
  glow.setAttribute('data-dyb-breathe', '1');
  // 圆角跟随平台行卡(#100-附):class 里的 4px 只是兜底底色,这里按行覆盖
  try { glow.style.borderRadius = glowRadiusOf(el); } catch (e) { /* 尽力而为 */ }

  // 需为相对定位，否则绝对定位会脱离商品位置
  const prevPosition = el.style.position;
  if (!prevPosition || prevPosition === 'static') {
    el.style.position = 'relative';
    glow.setAttribute('data-dyb-added-position', '1');
  }

  el.appendChild(glow);

  // 三次呼吸共约 2.1 秒：每个周期 0.35s 淡入 + 0.35s 淡出
  setTimeout(() => {
    glow.remove();
    if (glow.getAttribute('data-dyb-added-position')) {
      el.style.position = prevPosition || '';
    }
  }, 3000);
}

function clearHighlight() {
  const marked = document.querySelectorAll('[data-dyb-breathe]');
  for (const glow of marked) {
    const host = glow.parentElement;
    glow.remove();
    if (host && glow.getAttribute('data-dyb-added-position')) {
      host.style.position = '';
    }
  }
}

/**
 * 调试：记录商品识别详情
 *
 * 仅在调试模式（弹窗开关或URL 参数）下执行，
 * 用于确认识别到的商品数量是否正确。
 *
 * ⚠️ 当前工程内**没有调用点**（2026-10-16 核查）—— 保留供调试期手动调用。
 *    这道门禁本身也刚修好：此前中控台那组脚本里没有 isDebugMode，
 *    `typeof isDebugMode === 'function'` 恒为 false ⇒ 条件短路 ⇒ 门禁从未生效。
 *    isDebugMode 随 debug-panel.js 进入中控台后，门禁才真正起作用。
 *
 * ⚠️ 隐私红线（diag.js 定：只采结构、不采内容）：
 *    商品数量 / 容器高度是**结构信息**，走 debugLog 进诊断报告；
 *    商品名是**页面内容**，只打 console，绝不进报告。
 */
function debugLogProductIdentify() {
  if (typeof isDebugMode === 'function' && !isDebugMode()) return;

  const items = getProductItems();
  const scroller = getScrollContainer();

  // debug-panel.js 会把 debugLog 挂到隔离世界的 window 上；
  // 万一那份脚本没在场，退回 console，不让调试输出把主流程带崩。
  const log = (typeof debugLog === 'function')
    ? debugLog
    : function (m) { console.log('[DYB-NAV]', m); };

  log('商品识别 · 共 ' + items.length + ' 个'
    + ' · 滚动容器高 ' + (scroller ? scroller.scrollHeight : '未找到'));

  if (items.length > 0) {
    const first = (items[0].innerText || '').replace(/\s+/g, ' ').trim().slice(0, 80);
    const last = (items[items.length - 1].innerText || '').replace(/\s+/g, ' ').trim().slice(0, 80);
    console.log('[DYB-NAV] 首项文本：' + first);
    console.log('[DYB-NAV] 末项文本：' + last);
  }

  return items.length;
}

/**
 * 「名称段」的切分口径（2026-10-14 用户定：全能搜索只搜「商品名 + 价格」，
 * 库存 / 销量 / 上架时间等字段一律不得进入匹配范围）
 *
 * 字段分两类，因为「无条件切」会误伤商品名：
 *   · 价格类（到手价/售价/划线价/活动价/拼单价）—— 商品名里不会出现这些词，
 *     命中即切，不必看后面跟什么；
 *   · 数量/时间类（库存/可售/剩余/现货/在售/已售/销量/佣金/服务费/时间字段）
 *     —— 商品名里**可能**含这些词（例如「现货 秒发 连衣裙」），所以只有
 *     「字段词 + 数字」这种形态才算字段边界；纯词不算。
 */
const NAME_PRICE_WORDS = '到手价|售价|划线价|活动价|拼单价';

const NAME_NUM_FIELDS = '库存|可售|剩余|现货|在售|已售|销量|佣金|服务费'
  + '|上架时间|更新时间|创建时间';

/**
 * 行内标记词（2026-10-14 用户报「高成交 / 讲解中 不应该进入名称当中」）：
 * 平台在商品行里渲染的状态标签文案，商品名里不会出现。
 *
 * ⚠️ 它可能出现在名称**之前**，也可能在名称**之后**，所以不能只当切断点用：
 *    「高成交 商品名」若走 ② 的切断，命中位置是 0，`cut === 0` 会把整段名称
 *    判成空。因此行首那份靠 NAME_MARK_HEAD_RE 先剥掉（见 getProductName ①′），
 *    行尾那份靠 NAME_MARK_TAIL_RE 兜（②″），CUT_RE 里那份负责名称**中间**的。
 *    三处配合，三种位置都干净，且不会把名称整段吃掉。
 */
const NAME_MARK_WORDS = '高成交|讲解中|高点击率';

/** 行首标记词（剥除用）：「高成交 商品名…」 */
const NAME_MARK_HEAD_RE = new RegExp('^(?:' + NAME_MARK_WORDS + ')\\s*');

/** 行尾标记词（剥除用）：「…商品名 高成交」 */
const NAME_MARK_TAIL_RE = new RegExp('\\s*(?:' + NAME_MARK_WORDS + ')\\s*$');

/** 名称段的「字段起点」：命中即从这里切断 */
const NAME_CUT_RE = new RegExp(
  '[¥￥$＄]'                                   // 价格符号，无条件切
  + '|设置卖点|未设提词'                       // 行内按钮文案，无条件切
  + '|' + NAME_MARK_WORDS                      // 状态标记（高成交/讲解中），无条件切
  + '|' + NAME_PRICE_WORDS                     // 价格类字段词，无条件切
  + '|(?:' + NAME_NUM_FIELDS + ')\\s*[:：]?\\s*[\\d]'   // 数量/时间类：词后必须跟数字
  + '|ID\\s*[:：]?\\s*[\\d]'                   // ID 同理（避免误伤含 "ID" 的英文名）
);

/** 行首可整段剥掉的「字段词 + 值」：「库存 999 粉色短袖…」→ 剥掉「库存 999 」 */
const NAME_HEAD_RE = new RegExp(
  '^(?:' + NAME_NUM_FIELDS + '|' + NAME_PRICE_WORDS + ')'
  + '\\s*[:：]?\\s*[\\d][\\d,.\\-:/]*\\s*'
);

/**
 * 提取商品显示名
 *
 * 2026-10-14 修两处（用户报「连库存量都能搜到」）：
 *   ① 此前只用 `¥|设置卖点|未设提词|到手价|售价|库存|ID` 切分，且写成
 *      `if (cut > 0)` —— 于是「库存写作可售/剩余/销量」或「字段出现在行首」
 *      时字段值整段混进名称，数字因此可被搜到（.tmp/verify-search-scope.js 复现）；
 *   ② 末尾 `slice(0, 40)` 会在字母/数字串中间下刀，把款号 ccc1111a 切成
 *      ccc1111 —— 搜完整款号反而搜不到。现在切点落在串中间时整体保留该串。
 *
 * 切法四步：剥行首字段段 → 从第一个字段起点切断 → 剥行尾「ID」按钮 →
 * 保留完整名称和尾款号。
 *
 * ⚠️ 字段词表是黑名单，只能覆盖已知字段。平台新增字段时要往
 *    NAME_NUM_FIELDS / NAME_PRICE_WORDS 里补词，自测脚本
 *    .tmp/verify-search-scope.js 会检查各形态是否仍会漏。
 *
 * @param {Element} el 商品行元素
 * @param {string} [preText] 调用方已读过的整行文本（可选）。
 *        一次搜索要同时取「商品名」与「价格」，两处各读一次 el.innerText
 *        会让每个新行多付一次同步布局的代价；由调用方读一次后传入即可复用。
 *        不传时行为与旧版完全一致。
 */
function getProductName(el, preText) {
  if (!el) return '';

  const src = (typeof preText === 'string') ? preText : (el.innerText || '');
  const t = src.replace(/\s+/g, ' ').trim();

  let name = t
    .replace(/^(无库存|已下架|售罄)\s*/, '')
    .replace(/^【[^】]*】\s*/, '');

  // ① 剥行首字段段（可连剥，最多 4 段防死循环）
  for (let guard = 0; guard < 4; guard++) {
    const m = name.match(NAME_HEAD_RE);
    if (!m) break;
    name = name.slice(m[0].length);
  }

  // ①′ 剥行首的「序号」与「状态标记」（可连剥，最多 4 段防死循环）：
  //     平台在商品行最前面渲染「第1个」「高成交」这类行内标记，都不属于商品名。
  //     ★ 必须在 ② 之前剥 —— 这些词若留在行首，② 的切断点会落在位置 0，
  //       而 `cut === 0` 的语义是「整段就是字段、没有名称」，名称会被判成空
  //       （「高成交 商品名」→ 名称变空，消息盒子里就是一条空消息）。
  for (let guard = 0; guard < 4; guard++) {
    const before = name;
    name = name.replace(/^第\s*\d+\s*个\s*/, '');
    name = name.replace(NAME_MARK_HEAD_RE, '');
    if (name === before) break;
  }

  // ② 从第一个字段起点切断；整段就是字段（cut === 0）则没有名称可用
  const cut = name.search(NAME_CUT_RE);
  if (cut > 0) name = name.slice(0, cut);
  else if (cut === 0) name = '';

  // ②′ 剥掉行尾的「ID」按钮文案（2026-10-14 用户报「消息盒子把商品右边的
  //     ID 按钮当成商品名写进消息」）：该按钮排在款号/名称之后、价格之前，
  //     ② 的切断点落在价格上，按钮文案「ID」于是残留在名称末尾
  //     （「…夹克外套10157 ID」）。
  //     只剥「末尾独立 ID」，且要求它前一个非空白字符**不是英文字母** ——
  //     ANDROID / NikeID / NIKE ID 这类自带 ID 的英文名不受影响，
  //     中文名或数字款号后面的按钮才会被剥掉。
  //   2026-10-15 扩展：平台也会把「ID」「货号」两个按钮连排
  //     （用户截图「…半身裙C2292 ID 货号」）。原实现只认末尾独立 ID，
  //     ID 后面还跟着「货号」时末尾匹配落空 → 「ID 货号」残留在名称里。
  //     先剥「(ID )?货号」再剥末尾独立 ID；两道都要求前一个非空白字符
  //     不是英文字母，ANDROID / NikeID 这类自带 ID 的英文名仍不受影响。
  // 每轮只删除尾部已知标记/按钮；严格缩短才继续，消除按钮排列顺序依赖。
  // 保留原有英文名边界，ANDROID / NIKE ID 不当作按钮文字。
  while (true) {
    const before = name;
    name = name.replace(NAME_MARK_TAIL_RE, '');
    name = name.replace(/(^|[^\sA-Za-z])\s*(?:ID\s+)?货号\s*$/i, '$1');
    name = name.replace(/(^|[^\sA-Za-z])\s*ID\s*$/i, '$1');
    if (name === before) break;
  }
  // 保留完整名称和尾款号；显示空间由消息组件负责。
  const out = name.trim();
  return out;
}

// ==================== 卖点段切取（#100 附 · 2026-10-20 方案B） ====================

/**
 * 占位/按钮词：卖点区里出现它们只说明「还没设置」，绝不是卖点内容。
 * 用户拍板（评审稿问 2 按推荐执行）：只当占位词剔除 —— 用户自定义卖点
 * 文本里若真写了「设置卖点」四个字，照常可搜。
 */
const SELL_PLACEHOLDER_RE = /未设提词|设置卖点/g;

/** 按钮渲染进 innerText 的编辑图标杂字符 */
const SELL_NOISE_RE = /[✎✏✐]/g;

/**
 * 从行文本里切「卖点段」（#100 附：卖点栏纳入全能搜索，方案 B 独立成组）。
 *
 * ⚠️ 切段判据是「位置法」，与 getProductName 共用同一套字段起点词表
 *    （NAME_CUT_RE —— 单一事实来源，两处不许各写一份）：
 *
 *      切段 = 〔第一个字段起点 → 第一个价格符号〕之间
 *
 *    依据（用户 2026-10-20 截图确认）：卖点栏是商品名下方小字区的
 *    「设置卖点 ✎」入口；未设置时显示按钮文案本身，设置后该位置显示
 *    卖点文本。三种形态都能被同一条判据覆盖：
 *      · 未设置：「…名称… 未设提词 设置卖点 ¥79…」→ 段内全是占位词，
 *        剥完为空 ⇒ 不登记（正确：没有卖点可搜）；
 *      · 设置后（文案替换）：「… 未设提词 透气 冰丝 ¥79…」→ 剥占位词
 *        剩「透气 冰丝」；
 *      · 设置后（占位仍在）：「… 透气 冰丝 设置卖点 ¥79…」→ 同上。
 *
 * ★ 已知局限（待探针收窄，不编造）：
 *   ① 「提词」内容也落在同一小字区（「未设提词」设置后变提词文本），
 *      本判据会把提词文本一并卷进卖点段 —— 提词与卖点同时设置时的
 *      真实行形态未探明，先按「整段收」实现，探针到形态后再收窄；
 *   ② 卖点文本带「卖点」标签词时（如「卖点 透气」）标签不剥 —— 搜
 *      「透气」照常命中，搜「卖点」会多命中（影响极小，先不处理）。
 *
 * 容错优先：切不到就空着，名称/价格照常可搜。
 *
 * @param {Element} el 商品行元素
 * @param {string} [preText] 调用方已读过的整行文本（与 getProductName 同款
 *        复用约定：一次搜索读一次 innerText，名称/卖点/价格共用）。
 */
function getSellPoint(el, preText) {
  const src = (typeof preText === 'string') ? preText : ((el && el.innerText) || '');
  const t = String(src || '').replace(/\s+/g, ' ').trim();
  if (!t) return '';

  // 与 getProductName ①/①′ 同步的行首剥离 —— 让「第一个字段起点」的
  // 位置与名称切断点一致（行首「库存 999」「第1个」「高成交」不把切段
  // 拉长到卷进行首字段值）。
  let s = t
    .replace(/^(无库存|已下架|售罄)\s*/, '')
    .replace(/^【[^】]*】\s*/, '');
  for (let guard = 0; guard < 4; guard++) {
    const m = s.match(NAME_HEAD_RE);
    if (!m) break;
    s = s.slice(m[0].length);
  }
  for (let guard = 0; guard < 4; guard++) {
    const before = s;
    s = s.replace(/^第\s*\d+\s*个\s*/, '');
    s = s.replace(NAME_MARK_HEAD_RE, '');
    if (s === before) break;
  }

  // 切段：第一个字段起点 → 第一个价格符号（不含）。行内没有价格符号时
  // 取到行尾（卖点区之后全是按钮文案，剥不出内容自然为空）。
  const start = s.search(NAME_CUT_RE);
  if (start < 0) return '';
  const priceM = s.slice(start).match(/[¥￥$＄]/);
  const end = priceM ? start + priceM.index : s.length;
  let seg = s.slice(start, end);

  // 剥占位词与按钮图标（占位词绝不参与 —— 用户 #100 原话拍板）
  seg = seg.replace(SELL_NOISE_RE, ' ')
           .replace(SELL_PLACEHOLDER_RE, ' ')
           .replace(/\s+/g, ' ').trim();
  return seg;
}