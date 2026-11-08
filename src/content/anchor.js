/**
 * 加载探针:最先执行,用于确认扩展是否注入成功。
 * 页面左下角出现绿色「DY-COCO」标记即说明扩展已注入且页面匹配。
 *
 * 【文案说明 · 2026-10-11 用户定】标记**不再写「已加载」**,只留品牌名。
 * 用户认为页面上常驻「已加载」字样多余且观感差;品牌名足以承担
 * 「探针 + 执行状态锚点」两个职责,不影响排查。
 * 调试态仍以橙色 + 「(调试模式)」后缀区分。
 *
 * 该标记同时是「执行状态」的固定锚点(2026-10-11 重设计):
 * dialog.js 会在此容器内补齐 .dyb-msg-col(层叠消息,最新在最底层紧贴标记)
 * 与 .dyb-history(历史盒子),标记本身变成真矩形直角块。
 *
 * 适用页面：
 *   - 商品管理页 /ffa/g/list（清空库存功能）
 *   - 直播中控台（快捷导航功能），两个入口都要认：
 *       抖店   https://fxg.jinritemai.com/ffa/content-tool/live/control
 *       巨量百应 https://buyin.jinritemai.com/dashboard/live/control
 *     中控台在抖音电商里有两个域名入口（商家走抖店、达人走百应），
 *     2026-10-11 用户反馈百应入口不生效，根因就是只匹配了抖店域名。
 *   - 微信小店（2026-10-30 起，**仅基础设施**）：
 *       微信小店后台   https://channels.weixin.qq.com/shop
 *       视频号助手     https://channels.weixin.qq.com/index（或 /platform）
 *     本期只出左下角标记 + 调试模式 + 诊断 + 消息盒子，**不含任何业务功能**
 *     （用户定：「先做这三个，其他不做，然后根据这个再开始加功能」）。
 *     在扫码登录页就能看到标记，本身就是「扩展已注入、域权限已生效」的证据。
 *     本域是 SPA，公共入口按 manifest 支持范围保持在场。
 *
 * 调试模式的判定来源有两个，取或：
 *   1. URL 带 dyb_debug=1（弹窗开关会自动添加/移除该参数）
 *   2. chrome.storage 中的开关状态（覆盖 URL 已改但页面未刷新的情况）
 * 两者任一为真即进入调试态，标记变橙并追加「（调试模式）」。
 */
(function loadProbe() {
  try {
    var url = location.href;
    // 基础入口跟随实际注入范围，新增页面不再另列探针名单。
    var matched = dycIsSupportedPage(url);
    var debugInUrl = /[?&]dyb_debug=1/.test(url);

    function applyBadge(debug) {
      var bar = document.getElementById('dyb-status-bar');

      if (!bar) {
        bar = document.createElement('div');
        bar.id = 'dyb-status-bar';

        var mark = document.createElement('div');
        mark.className = 'dyb-badge';
        bar.appendChild(mark);

        var attach = function () {
          if (document.body) document.body.appendChild(bar);
          else setTimeout(attach, 200);
        };
        attach();
      }

      // 元素已存在时**只更新状态**,不再直接返回(2026-10-16)。
      // 原实现「已存在就 return」,标记会永远停在首次判定那一刻 ——
      // 开关拨动后换不了色。现在拨开关要能即时换标。
      bar.classList.toggle('dyb-status-bar--debug', !!debug);

      var badge = bar.querySelector('.dyb-badge');
      if (badge) {
        // 调试模式用橙色区分，避免与正常的绿色混淆
        badge.classList.toggle('dyb-badge--debug', !!debug);
        badge.classList.toggle('dyb-badge--normal', !debug);
        badge.textContent = debug ? 'DY-COCO(调试模式)' : 'DY-COCO';
      }
    }

    console.log('[DYB-PROBE] 扩展已注入 | 页面匹配:' + matched +
      ' | URL调试参数:' + debugInUrl + ' | ' + url.substring(0, 60));

    if (!matched) return;

    // 先按 URL 立即出标记，不等 storage，避免闪烁
    applyBadge(debugInUrl);

    // 再读开关状态修正。storage 读不到时保持 URL 判定结果。
    try {
      chrome.storage.local.get('dybDebug', function (r) {
        var on = !!(r && r.dybDebug);
        if (chrome.runtime.lastError) return;
        if (on !== debugInUrl) {
          applyBadge(on);
          console.log('[DYB-PROBE] 按开关状态修正调试态:', on);
        }
      });
    } catch (e) {
      console.warn('[DYB-PROBE] 读取调试开关失败，沿用 URL 判定');
    }

    // 开关变化即时换标(2026-10-16)。
    // 与 debug-panel.js 同一套机制:弹窗拨开关只写 storage、不改地址,
    // 由页面侧订阅就地生效 —— 标记换色不需要刷新页面。
    try {
      if (chrome.storage && chrome.storage.onChanged) {
        chrome.storage.onChanged.addListener(function (changes, area) {
          if (area !== 'local' || !changes || !changes.dybDebug) return;
          applyBadge(!!changes.dybDebug.newValue);
        });
      }
    } catch (e) {
      console.warn('[DYB-PROBE] 订阅调试开关失败');
    }
  } catch (e) {
    console.error('[DYB-PROBE] 异常', e);
  }
})();

/**
 * 语义锚点定位工具
 *
 * 抖店后台是 React SPA，class 名带构建哈希（css-1a2b3c），版本一更新就变。
 * 因此不能依赖 CSS 选择器，必须用「可见文本 + 结构特征」定位元素。
 *
 * 所有定位函数都支持多级回退：先试精确匹配，再试包含匹配，最后放弃。
 */

// 规范化文本：去首尾空白、压缩连续空格、去掉全角空格
function normalize(text) {
  if (!text) return '';
  return String(text)
    .replace(/　/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// 判断元素是否可见（有尺寸且未被隐藏）
function isVisible(el) {
  if (!el || !el.getBoundingClientRect) return false;
  const rect = el.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return false;

  const style = window.getComputedStyle(el);
  if (style.visibility === 'hidden') return false;
  if (style.display === 'none') return false;
  if (parseFloat(style.opacity || '1') === 0) return false;

  return true;
}

/**
 * 按可见文本查找元素
 * @param {string} text 目标文本
 * @param {object} opts
 * @param {string} opts.tag 限定标签名，默认不限
 * @param {boolean} opts.exact true=完全相等，false=包含
 * @param {Element} opts.root 搜索根节点，默认 document
 * @returns {Element|null}
 */
function findByText(text, opts = {}) {
  const {
    tag = null,
    exact = true,
    root = document
  } = opts;

  const target = normalize(text);
  if (!target) return null;

  const selector = tag || '*';
  const nodes = root.querySelectorAll(selector);

  for (const node of nodes) {
    // 跳过脚本与样式内容
    if (node.children.length > 0) continue;
    const content = normalize(node.textContent);
    if (!content) continue;

    if (exact ? content === target : content.includes(target)) {
      if (isVisible(node)) return node;
    }
  }

  return null;
}

/**
 * 向上查找包含指定文本的最近祖先
 * 常用于「找到某个单元格的文本，回溯到整行」
 *
 * @param {string} text
 * @param {object} opts
 * @param {number} opts.maxDepth 最多向上回溯层数
 * @param {Function} opts.validator 自定义校验：返回 true 表示该祖先符合要求
 * @param {Element} opts.root 起始节点，默认 document.body
 */
function findAncestorByText(text, opts = {}) {
  const {
    maxDepth = 15,
    validator = null,
    root = document.body
  } = opts;

  const target = normalize(text);
  const startNodes = findAllByText(text, { exact: false });

  for (const node of startNodes) {
    let current = node;
    let depth = 0;

    while (current && depth < maxDepth) {
      if (current === document.body) break;

      if (!validator || validator(current)) {
        return current;
      }

      current = current.parentElement;
      depth++;
    }
  }

  return null;
}

/**
 * 查找所有包含指定文本的元素
 */
function findAllByText(text, opts = {}) {
  const { exact = false, root = document } = opts;
  const target = normalize(text);
  if (!target) return [];

  const result = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);

  while (walker.nextNode()) {
    const node = walker.currentNode;
    const content = normalize(node.textContent);
    if (!content) continue;

    if (exact ? content === target : content.includes(target)) {
      if (node.parentElement && isVisible(node.parentElement)) {
        result.push(node.parentElement);
      }
    }
  }

  return result;
}

/**
 * 识别商品行
 *
 * 商品行的特征（从截图已知）：
 *   - 包含商品标题链接
 *   - 包含「ID: xxx」文本
 *   - 包含货号文本
 *   - 右侧有「编辑」「下架」等操作按钮
 *
 * 策略：先找到所有「编辑」按钮，它们所在的行就是商品行。
 * 这比从左边找标题更稳定，因为「编辑」是固定文案且数量与商品数一致。
 */
function findProductRows() {
  const editButtons = findAllByText('编辑', { exact: true });

  const rows = [];
  const seen = new Set();

  for (const btn of editButtons) {
    const row = resolveProductRow(btn);
    if (!row) continue;

    if (seen.has(row)) continue;
    seen.add(row);
    rows.push({ row, editButton: btn });
  }

  return rows;
}

/**
 * 从操作按钮回溯到所属商品行
 *
 * 向上查找时，用「是否包含商品信息特征」作为终止条件：
 * 必须同时含 ID 文本与货号文本，才认为是完整的商品行。
 */
function resolveProductRow(btn) {
  let current = btn;
  let depth = 0;

  while (current && depth < 20) {
    if (current === document.body) break;

    const text = normalize(current.textContent);

    // 商品行特征：同时包含 ID 标记与货号
    const hasIdMark = /ID\s*[:：]/.test(text);
    const hasStockHint = /总库存|库存/.test(text);

    if (hasIdMark && text.length > 30) {
      return current;
    }

    // 回退条件：行内包含多个操作文案
    const hasActions = /编辑/.test(text) && /下架|更多/.test(text);
    if (hasActions && hasStockHint && text.length > 30) {
      return current;
    }

    current = current.parentElement;
    depth++;
  }

  return null;
}

/**
 * 从商品行中提取关键信息
 *
 * 重要：字段必须按 DOM 结构就近取值，不能对整行文本跑正则。
 * 早期版本用/text.match(/货号[:：](\S+)/) 导致把整行剩余内容
 * （价格、复制链接、库存、状态、时间）全部吞进货号字段。
 */
function extractProductInfo(row) {
  const text = normalize(row.textContent);

  // 商品标题
  const title = sanitizeTitle(extractTitle(row));

  // 商品 ID：页面文本形如 "ID: 19xxxxxxxxxxxxxxxxx"（19 位数字）
  // 用标签节点定位，取相邻节点的内容
  const productId = extractValueAfterLabel(row, 'ID');
  // 回退：整行正则要求数字紧跟冒号，且不含其他分隔符
  const idFallback = text.match(/ID\s*[:：]\s*(\d{6,})/);
  const finalId = productId || (idFallback ? idFallback[1] : null);

  // 货号：页面文本形如 "货号: XXXXX"（商家自定义的短编号）
  const productCode = sanitizeCode(extractValueAfterLabel(row, '货号'));

  // 总库存：优先走列定位，取不到再退回文本匹配
  const totalStock = extractTotalStock(row, text);

  return {
    title,
    productId: finalId,
    productCode,
    totalStock,
    rowText: text
  };
}

/**
 * 在行内查找「标签: 值」形式的字段，返回值
 *
 * 策略：先找到只含标签文字的节点（如 <span>货号：</span>），
 * 再取它之后最近的、有实际内容的节点。
 * 这样能保证只取到货号本身，不会把后面的价格等一起吞掉。
 *
 * @param {Element} row
 * @param {string} label 标签名，如 '货号' / 'ID'
 * @returns {string|null}
 */
function extractValueAfterLabel(row, label) {
  // 找只包含标签（可带冒号）的节点
  const candidates = findAllByText(label, { exact: false, root: row });

  for (const node of candidates) {
    // 自身文本不能太长，否则说明这不是标签节点
    const own = normalize(node.textContent);
    if (own.length > label.length + 3) continue;

    // 下一跳优先：紧邻的后续节点
    let next = node.nextElementSibling;
    if (next) {
      const value = normalize(next.textContent);
      if (value && value.length <= 40) return value;
    }

    // 父节点内的其他文本节点
    const parent = node.parentElement;
    if (parent) {
      const walker = document.createTreeWalker(parent, NodeFilter.SHOW_TEXT);
      let foundLabel = false;
      while (walker.nextNode()) {
        const t = walker.currentNode;
        const content = normalize(t.textContent);
        if (!content) continue;

        if (!foundLabel) {
          if (content.includes(label)) foundLabel = true;
          continue;
        }

        // 拿到标签之后的第一段有效文本
        const stripped = content.replace(/^[:：]\s*/, '').trim();
        if (stripped && stripped.length <= 40) return stripped;
      }
    }
  }

  return null;
}

/**
 * 货号合理性校验
 *
 * 早期版本把整行内容误当货号，显示为一大串乱码。
 * 后来校验过严导致正常货号也被拦下。
 * 现在的标准：只排除明显是其他字段的值，长度限制放宽。
 *
 * @param {string|null} code
 * @returns {string|null}
 */
function sanitizeCode(code) {
  if (!code) return null;

  const value = normalize(code);
  if (!value) return null;

  // 去掉可能带上冒号的前缀
  const clean = value.replace(/^货号\s*[:：]\s*/, '').trim();
  if (!clean) return null;

  // 长度超限，几乎必然抓到整行内容
  if (clean.length > 25) return null;

  // 含价格符号或明显的状态文案，说明抓到别的字段
  if (/[￥¥]|复制链接|预览|售卖中|已下架|下单|售罄|补库存/.test(clean)) {
    return null;
  }

  // 含多个中文字符且较长，可能是段落文本
  const chineseCount = (clean.match(/[\u4e00-\u9fa5]/g) || []).length;
  if (chineseCount > 6) return null;

  return clean;
}

/**
 * 提取货号
 *
 * 实测特征：货号元素带虚线下边框（border-bottom: 1px dashed）。
 * 同类特征还有「库存合计」，因此需要结合文本内容区分：
 * - 纯数字或短码 → 货号
 * - 含「合计」或数值型文本 → 库存
 *
 * @param {Element} row
 * @returns {string|null}
 */
function extractProductCode(row) {
  // 方式一：虚线边框元素中找符合货号形态的
  const dashedElements = findDashedUnderlineElements(row);

  for (const el of dashedElements) {
    const text = normalize(el.textContent);
    if (!text) continue;

    // 库存合计元素通常含「合计」或较长数字，货号较短
    if (/合计/.test(text)) continue;

    const clean = text.replace(/^货号\s*[:：]?\s*/, '').trim();

    // 货号形态：长度适中，不含中文长句
    if (clean.length >= 1 && clean.length <= 25) {
      const chineseCount = (clean.match(/[\u4e00-\u9fa5]/g) || []).length;
      if (chineseCount <= 2) return clean;
    }
  }

  // 方式二：按「货号:」标签就近取值
  const byLabel = extractValueAfterLabel(row, '货号');
  if (byLabel) return sanitizeCode(byLabel);

  // 方式三：文本匹配
  const m = normalize(row.textContent).match(/货号\s*[:：]\s*(\S{1,25})/);
  return m ? sanitizeCode(m[1]) : null;
}

/**
 * 查找行内带虚线下边框的元素
 *
 * 依据实测：该样式由 border-bottom: 1px dashed 产生，
 * 在 class 名上通常体现为 border-dashed 或类似字样。
 * 也检查内联样式作为兜底。
 *
 * @param {Element} row
 * @returns {Element[]}
 */
function findDashedUnderlineElements(row) {
  const result = [];
  const all = row.querySelectorAll('*');

  for (const el of all) {
    const cls = typeof el.className === 'string' ? el.className : '';

    // class 名含 dashed
    if (/dashed/i.test(cls)) {
      result.push(el);
      continue;
    }

    // 内联样式为虚线边框
    const style = el.getAttribute && el.getAttribute('style');
    if (style && /border-bottom\s*:[^;]*dashed/i.test(style)) {
      result.push(el);
    }
  }

  return result;
}

/**
 * 提取总库存
 *
 * 实测特征：「库存合计」元素带虚线下边框。
 *
 * @param {Element} row
 * @param {string} rowText
 * @returns {number|null}
 */
function extractTotalStock(row, rowText) {
  // 方式一：从虚线元素中找库存值
  const dashedElements = findDashedUnderlineElements(row);

  for (const el of dashedElements) {
    const text = normalize(el.textContent);
    if (!text) continue;

    // 跳过货号（纯数字短码但不含「合计」字样且长度较小）
    if (/合计|库存/.test(text)) {
      const digits = text.match(/(\d+)/);
      if (digits) return parseInt(digits[1], 10);
    }
  }

  // 方式二：按表头横坐标定位
  const byColumn = findStockCell(row);
  if (byColumn) {
    const digits = normalize(byColumn.textContent).match(/(\d+)/);
    if (digits) return parseInt(digits[1], 10);
  }

  // 方式三：文本匹配
  const patterns = [
    /总库存\s*[:：]?\s*(\d+)/,
    /库存\s*[:：]?\s*(\d+)/,
    /售罄/
  ];

  for (const re of patterns) {
    const m = rowText.match(re);
    if (!m) continue;
    if (re.source === '售罄') return 0;
    return parseInt(m[1], 10);
  }

  // 方式四：表头同列找纯数字元素
  const headers = findAllByText('总库存', { exact: true });
  if (headers.length > 0) {
    const headerLeft = headers[0].getBoundingClientRect().left;

    for (const el of row.querySelectorAll('span, div, td, p')) {
      const text = normalize(el.textContent);
      if (!/^\d{1,7}$/.test(text)) continue;

      const rect = el.getBoundingClientRect();
      if (rect.width === 0) continue;

      if (Math.abs(rect.left - headerLeft) < 40) {
        return parseInt(text, 10);
      }
    }
  }

  return null;
}

/**
 * 排除属于其他字段的文案
 */
const NON_TITLE_TEXTS = [
  '复制链接', '预览', '清空库存', '下单', '售罄', '补库存',
  '暂无评价', 'AI智能成片', '快速测款', '一键生成', '优秀', '合格', '较差',
  '售卖中', '已下架', '审核中', '发布', '下架', '更多', '编辑',
  '查看渠道', '发布相似品', '新建复制品'
];

/**
 * 真实 DOM 定位常量
 *
 * 以下特征由用户在页面上用开发者工具实测确认（2026-10-29）。
 * class 名含构建哈希，抖店重新构建后会变，因此只匹配稳定前缀。
 */

/** 商品名：class 前缀 style_productNameNew__ */
/**
 * 商品名 class 前缀（用户 2026-10-29 实测确认）
 *
 * 实测商品名元素上有两个 class：
 *   style_productNameNew__Ui5Cy
 *   style_prductNameHover__CmhnU
 *
 * 注意第二个是 prduct（少一个 o），这是抖店源码实际拼写，不要"纠正"。
 * 末尾哈希每次构建都会变，因此只匹配前缀。
 */
const TITLE_CLASS_PREFIXES = [
  'style_productNameNew__',
  'style_prductNameHover__'
];

/** 货号 / 库存：均带虚线下边框的样式类 */
const DASHED_UNDERLINE_CLASS = /border-dashed|border-bottom.*dashed/;

/**
 * 提取商品标题
 *
 * 主策略：用实测确认的 class 前缀定位，最可靠。
 * 兜底策略：按文本特征回退（标题必在「ID:」之前）。
 */
function extractTitle(row) {
  // 方式一：class 前缀匹配（实测可靠）
  // 两个 class 可能同在元素上，也可能分属内外两层
  const candidates = [];
  for (const prefix of TITLE_CLASS_PREFIXES) {
    const el = findByClassPrefix(row, prefix);
    if (el && !candidates.includes(el)) candidates.push(el);
  }

  // 外层容器常含价格与规格信息，取最内层纯文本才是标题
  for (const el of candidates) {
    const inner = findDeepestTitleText(el);
    if (inner && isPlausibleTitle(inner)) return inner;
  }

  // 方式二：取「ID:」标签之前的文本
  const beforeId = extractTextBeforeId(row);
  if (beforeId && isPlausibleTitle(beforeId)) return beforeId;

  // 方式三：排除已知文案后取最长文本
  const leaves = [];
  const walker = document.createTreeWalker(row, NodeFilter.SHOW_TEXT);

  while (walker.nextNode()) {
    const content = normalize(walker.currentNode.textContent);
    if (!content) continue;
    if (isNonTitleText(content)) continue;
    leaves.push(content);
  }

  leaves.sort((a, b) => b.length - a.length);

  for (const leaf of leaves) {
    if (isPlausibleTitle(leaf)) return leaf;
  }

  return '';
}

/**
 * 按 class 前缀查找元素
 *
 * class 名形如 style_productNameNew__Ui5Cy，
 * 构建哈希部分每次打包都会变，故只匹配前缀。
 *
 * @param {Element} root
 * @param {string} prefix
 * @returns {Element|null}
 */
function findByClassPrefix(root, prefix) {
  const all = root.querySelectorAll('*');

  for (const el of all) {
    const cls = typeof el.className === 'string' ? el.className : '';
    if (!cls) continue;

    for (const token of cls.split(/\s+/)) {
      if (token.startsWith(prefix)) return el;
    }
  }

  return null;
}

/**
 * 取元素内部最长的文本
 */
function findLongestTextInside(el) {
  let best = '';
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);

  while (walker.nextNode()) {
    const content = normalize(walker.currentNode.textContent);
    if (content.length > best.length) best = content;
  }

  return best;
}

/**
 * 提取「ID:」标签之前的文本
 * 商品标题必然在这个位置
 */
function extractTextBeforeId(row) {
  const walker = document.createTreeWalker(row, NodeFilter.SHOW_TEXT);

  // 先定位 ID 标签节点
  let idLabel = null;

  while (walker.nextNode()) {
    const text = normalize(walker.currentNode.textContent);
    if (/^ID\s*[:：]/.test(text)) {
      idLabel = walker.currentNode;
      break;
    }
  }

  if (!idLabel) return '';

  // 收集其之前的文本
  const walker2 = document.createTreeWalker(row, NodeFilter.SHOW_TEXT);
  let best = '';

  while (walker2.nextNode()) {
    const node = walker2.currentNode;
    if (node === idLabel) break;

    const content = normalize(node.textContent);
    if (!content) continue;
    if (isNonTitleText(content)) continue;

    if (content.length > best.length) best = content;
  }

  return best;
}

/**
 * 判断文本是否具备商品标题特征
 */
function isPlausibleTitle(text) {
  if (!text) return false;

  const value = normalize(text);

  // 太短或太长都不像标题
  if (value.length < 6) return false;
  if (value.length > 80) return false;

  // 含字段标记说明抓错了
  if (/ID\s*[:：]\s*\d/.test(value)) return false;
  if (/货号\s*[:：]/.test(value)) return false;

  // 必须有中文
  const chineseCount = (value.match(/[\u4e00-\u9fa5]/g) || []).length;
  if (chineseCount < 3) return false;

  // 排除已知非标题文案
  if (isNonTitleText(value)) return false;

  return true;
}

/**
 * 标题合理性校验
 *
 * 商品标题应当是较长的中文短语。若抓到的是字段拼接或标签文字，
 * 说明解析失败，返回 null，宁可留空也不显示错误信息。
 */
function sanitizeTitle(title) {
  if (!title) return null;

  const value = normalize(title);
  if (!value) return null;

  // 过短不是标题
  if (value.length < 6) return null;

  // 过长可能是整行拼接
  if (value.length > 80) return null;

  // 含字段标记说明抓错了
  if (/ID\s*[:：]\s*\d/.test(value)) return null;
  if (/货号\s*[:：]/.test(value)) return null;

  // 含大量操作文案说明抓到的是操作区
  const actionCount = NON_TITLE_TEXTS.filter((w) => value.includes(w)).length;
  if (actionCount >= 2) return null;

  // 必须是中文为主的文本（商品名基本都是中文）
  const chineseCount = (value.match(/[\u4e00-\u9fa5]/g) || []).length;
  if (chineseCount < 3) return null;

  return value;
}

/**
 * 判断文本是否属于其他字段（不是商品名）
 */
function isNonTitleText(text) {
  if (!text) return true;

  // 完全等于某个操作文案
  if (NON_TITLE_TEXTS.includes(text)) return true;

  // 以这些词开头（如「优秀 92」）
  if (/^(优秀|合格|较差|待优化)/.test(text)) return true;

  // 纯数字（库存、销量等）
  if (/^\d+$/.test(text)) return true;

  // 含字段标记的说明性文本
  if (/^ID\s*[:：]|^货号\s*[:：]/.test(text)) return true;

  // 极短的文本（日期、状态标签等）
  if (text.length <= 3) return true;

  return false;
}

/**
 * 在商品行中寻找「总库存」列对应的单元格
 * 用于确定按钮插入位置（对齐库存列）
 */
function findStockCell(row) {
  // 找包含「总库存」表头的列位置
  const headers = findAllByText('总库存', { exact: true });
  if (headers.length === 0) return null;

  // 取页面第一个表头作为列参考（表格结构固定）
  const headerCell = headers[0];
  const left = headerCell.getBoundingClientRect().left;

  // 在本行中找 x 坐标最接近该表头的单元格
  const candidates = row.querySelectorAll('td, div, span');
  let best = null;
  let bestDist = Infinity;

  for (const cell of candidates) {
    const rect = cell.getBoundingClientRect();
    if (rect.height === 0 || rect.width === 0) continue;

    // 只考虑在同一水平位置的单元格（允许 30px 误差）
    const dist = Math.abs(rect.left - left);
    if (dist < bestDist) {
      bestDist = dist;
      best = cell;
    }
  }

  // 横向偏差过大说明结构不符合预期，放弃定位
  return bestDist < 30 ? best : null;
}

/**
 * 在元素内找出最内层的标题文本
 * 外层商品名容器常包着价格标签、规格等信息，
 * 真正的标题是其中最深的纯文本节点。
 */
function findDeepestTitleText(el) {
  if (!el) return '';
  if (el.children.length === 0) return normalize(el.textContent);

  const texts = [];
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const content = normalize(walker.currentNode.textContent);
    if (content) texts.push(content);
  }

  if (texts.length === 0) return normalize(el.textContent);

  // 整段拼接若更像标题则优先采用
  const joined = normalize(texts.join(' '));
  if (isPlausibleTitle(joined)) return joined;

  let best = texts[0];
  for (const t of texts) if (t.length > best.length) best = t;
  return best;
}
