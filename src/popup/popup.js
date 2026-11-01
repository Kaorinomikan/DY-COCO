/**
 * 弹窗逻辑
 *
 * 三件事:
 * 1. 功能开关 —— 按 flags.js 的元数据表(DYC_FLAGS_META)**自动渲染**,
 *    拨动后写 chrome.storage,已打开的页面即时生效(内容脚本自己订阅
 *    storage 变化,这里不用通知)
 * 2. 底部更新区 —— 版本号 / 检查更新 / 项目地址,状态从后台服务读取
 * 3. 安装更新的确认框 —— 用弹窗内联对话框,不用 window.confirm
 *
 * ★ 加一个功能开关时,本文件不需要改 ★
 *   在 src/content/flags.js 的 DYC_FLAGS_META 里追加一项即可,
 *   分组框、开关行、初始状态、事件绑定、作用页反馈全部自动生成。
 *   (2026-10-11 改造前,开关信息硬编码在本文件 + popup.html + flags.js 三处,
 *   多会话并行开发时必然在同一处打架,故收敛成一张元数据表。)
 *
 * 为什么不用 window.confirm:
 *   原生模态框在弹窗里可能让 popup 失焦而被浏览器关闭,
 *   一关闭整个更新链路就断了。内联遮罩层没有这个问题。
 *
 * 为什么确认后要另开窗口而不是在本弹窗里更新:
 *   File System Access 的目录选择/授权会弹出系统对话框,抢走焦点导致
 *   popup 关闭、JS 上下文销毁,写入操作必然中途失败。
 *   所以真正的更新动作放在独立窗口(src/update/update.html)里执行。
 */

/* ==========================================================
 * 一、功能开关:按元数据渲染
 *
 * 依赖 src/content/flags.js(在 popup.html 里最先加载),它提供:
 *   DYC_FLAGS_META / DYC_FLAG_GROUPS / DYC_PAGE_PATTERNS
 *   dycReadAllFlags() / dycWriteFlag()
 * ========================================================== */

// 反馈节点固定在弹窗最底部(三个分组框之外),
// 这样无论哪个开关拨动、无论调试提示是否隐藏,反馈都出现在同一位置。
/* 「读取本页」类入口的页面闸门（导出当前页结构 / 复制诊断报告共用）。
 *
 * ★ 判据必须与 manifest 的 content_scripts / host_permissions 对齐 ★
 *   宽一格只是多给一句人话；**窄一格就会变成「页面里明明注入了调试面板，
 *   弹窗却说本页没有」**，用户根本拿不到证据。
 *   2026-10-19 修：原来只认 jinritemai.com，直播回放那两个页面
 *   （anchor.douyin.com / liveservice.douyin.com）上的两个按钮全被拦死 ——
 *   用户报的「抓不到调试模式、没法反馈这个页面」就是这个。
 *
 * 2026-10-31：不再自己维护一份正则，改用 flags.js 的 dycDetectPlatform ——
 *   平台判定与「本页是否受支持」现在是**同一个判据**。两份正则必然漂移，
 *   而漂移的方向一旦是"平台表宽、这里是窄"，就会出现「弹窗已切到微信、
 *   按钮却说本页不支持」这种自相矛盾。
 */
function onSupportedPage(url) {
  return !!dycDetectPlatform(url);
}

const note = document.getElementById('apply-note');

const flagsRoot = document.getElementById('flags-root');

function flash(text) {
  note.textContent = text;
  // 几秒后自动清空,避免堆积文字
  clearTimeout(note._timer);
  note._timer = setTimeout(() => {
    note.textContent = '';
  }, 4000);
}

/* ---- 剪贴板:三级兜底 ----
 * navigator.clipboard → execCommand → 展开只读文本域。
 * 本机实际环境是 360 极速浏览器X(国产老内核),clipboard API 不保证存在,
 * 所以后两级是必需项,不是锦上添花。
 * 「导出当前页结构」与「复制诊断报告」共用这一份实现。
 */
function legacyCopy(text) {
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return !!ok;
  } catch (e) { return false; }
}

function copyText(text, cb) {
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(
        () => cb(true),
        () => cb(legacyCopy(text))
      );
      return;
    }
  } catch (e) { /* 落到下一级 */ }
  cb(legacyCopy(text));
}

/* ---- 应用反馈 ---- */

/**
 * 把元数据里的 pages 键名解析成「一个标签页是否相关」的判定函数。
 * 多个作用页取并集(如抓手光标修复在商品列表页与中控台都生效)。
 */
function buildPageMatcher(pageKeys) {
  const patterns = (pageKeys || [])
    .map((k) => DYC_PAGE_PATTERNS[k])
    .filter(Boolean);
  return (url) => patterns.some((re) => re.test(url));
}

/**
 * 应用完成的反馈
 *
 * 刻意不做 window.close():弹窗里还有多个开关要操作,
 * 主动关掉会让用户每拨一次就得重新点开。
 */
function reportApplied(pageKeys, enabled) {
  const match = buildPageMatcher(pageKeys);

  chrome.tabs.query({}, (tabs) => {
    let matched = 0;
    tabs.forEach((t) => {
      if (t.url && match(t.url)) matched++;
    });

    flash(
      matched > 0
        ? '设置已保存：' + (enabled ? '已开启' : '已关闭') + '，适用于 ' + matched + ' 个已打开页面'
        : '设置已保存：' + (enabled ? '已开启' : '已关闭') + '，暂无相关页面'
    );
  });
}

/* ---- 渲染 ---- */

/**
 * 问号徽章工厂（2026-10-18 从 buildToggleRow 里提出来，供**任意行**复用）。
 *
 * 为什么提出来：用户定「子菜单的备注放进问号里，不要用「——」注解浪费空间」。
 * 此前徽章机制只建在主开关行上，子菜单里的选项只能靠行内文本解释 ——
 * 于是出现「默认全能搜索 —— 回车直接走全能扫描」这种把说明塞进标签的写法。
 * 现在子菜单的选项、清单项、调试子项都能挂同一枚徽章，标签只留名字。
 *
 * 用法：
 *   attachHelpBadge(nameEl, '基础说明', '操作提示')   两段式（主开关行）
 *   attachHelpBadge(nameEl, '一句话说明')             单段式（子菜单选项）
 * 两者都为空 ⇒ 不挂徽章，行上不出现任何多余元素。
 *
 * 气泡定位仍走 attachHelpFloat（浮动层 + 边界钳制），与旧实现完全一致。
 */
function attachHelpBadge(hostEl, desc, note) {
  if (!desc && !note) return null;
  const badge = document.createElement('span');
  badge.className = 'help-badge';
  badge.textContent = '?';
  badge.tabIndex = 0;
  badge.setAttribute('role', 'button');
  badge.setAttribute('aria-label', '查看说明');
  badge.setAttribute('aria-expanded', 'false');
  const pop = document.createElement('span');
  pop.className = 'help-pop';
  if (desc) {
    const d = document.createElement('span');
    d.className = 'pop-desc';
    d.textContent = desc;
    pop.appendChild(d);
  }
  if (note) {
    const n = document.createElement('span');
    n.className = 'pop-note';
    n.textContent = note;
    pop.appendChild(n);
  }
  badge.appendChild(pop);
  attachHelpFloat(badge, pop);   // 气泡定位(浮动层,见下方专节)
  // 徽章常常住在 <label> 里（子菜单的复选框 / 单选行），而 label 的默认行为是
  // **点里面任何东西都切换选中** —— 点「?」会把勾选改掉，属于实打实的误触。
  // 这里把点击拦下：既不冒泡、也不触发 label 的默认激活。
  badge.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
  });
  hostEl.appendChild(document.createTextNode(' '));
  hostEl.appendChild(badge);
  return badge;
}

/**
 * 生成一行开关。
 * 控件 id 统一为 flag-<key>,与元数据键名一一对应。
 *
 * 问号帮助机制(2026-10-12 用户定:**只允许在弹窗里**,页面一律不注入)——
 * 说明放 flags.js 的 desc / note,由 attachHelpBadge 收进气泡。
 * (原页面工具栏的问号徽章已按用户要求整体删除。)
 */
function buildToggleRow(meta) {
  const row = document.createElement('div');
  row.className = 'toggle-row';

  const left = document.createElement('div');
  const name = document.createElement('div');
  name.className = 'name';

  // 下拉箭头(2026-10-18「开关门控」新增;2026-10-20 #101 改「恒挂占位」):
  // ★ #101 弹窗行首对齐(方案 B,用户 2026-10-20 拍板「两条竖线」):
  //   **所有开关行**名字前恒挂等宽 ▶ 占位 —— 带子面板的行由门控逻辑控制显隐;
  //   无子面板的行永远 visibility:hidden(纯占位,没人会点亮它 ——
  //   foldOpeners 只登记一级行与带面板行)。
  //   此前「只有带子内容的行才有箭头,其余连占位都不留」导致文字起点四条线:
  //   顶层普通行 0 / 一级行与带面板行 13 / 组内普通行 14 / 组内带面板行 27px。
  //   统一占位后顶层一条竖线(13px)、组内一条竖线(14+13=27px),各自完全对齐。
  // 初态一律隐藏 —— 箭头只在「开关开着」时出现(由 renderFlags 的门控逻辑点亮),
  // 用户看到箭头才知道这一行可以点开。
  const caret = document.createElement('span');
  caret.className = 'caret';
  caret.textContent = '▶';
  caret.style.visibility = 'hidden';
  name.appendChild(caret);
  // 直接拼在 className 上而不是 classList.add —— 自检脚本的 DOM 打桩里
  // classList 是空实现,用 classList 会让「有没有带子内容」在断言里查不到。
  if (hasSubPanel(meta)) {
    row.className = 'toggle-row row--fold';
  }

  name.appendChild(document.createTextNode(meta.label));

  // 问号徽章(2026-10-16 弹窗减噪;2026-10-18 泛化为通用函数)
  attachHelpBadge(name, meta.desc, meta.note);

  // 说明文字(.desc)已移入气泡,不再常显 —— 这是弹窗减噪的最大一处
  left.appendChild(name);

  const label = document.createElement('label');
  label.className = 'switch';
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.id = 'flag-' + meta.key;
  const slider = document.createElement('span');
  slider.className = 'slider';
  label.appendChild(input);
  label.appendChild(slider);

  row.appendChild(left);
  row.appendChild(label);
  return { row: row, input: input, left: left, name: name, caret: caret };
}

/**
 * 一级行(foldHost) —— 可展开的分组行(2026-10-16 新增,2026-10-18 改门控)。
 *
 * 有 key 的(全能搜索 / 页面滚动按钮)右侧挂该开关的 toggle,它同时是那一组的总闸。
 * ★ 2026-10-18 用户定:开关 = **门控**,名字 = **触发**:
 *     开关开 ⇒ 名字可点、▶ 可见、内容**仍然收起**;
 *     开关关 ⇒ ▶ 隐藏、名字变灰不可点;
 *   展开/收起由点名字决定。默认一律收起。
 *   (旧规则「开关开 ⇒ 立即展开」已废:5 个默认开的开关会把弹窗撑到 1011px。)
 * 无 key 的行才是纯分组行(现仅「更多设置」),右侧显示「展开 N 项」,点整行展开。
 *
 * 折叠容器由 renderFlags 紧跟其后插入,所以展开/收起只需操作下一个兄弟节点。
 */
function buildHostRow(meta) {
  const row = document.createElement('div');
  row.className = 'host-row';

  const name = document.createElement('span');
  name.className = 'tname';

  // 下拉箭头:有开关的一级行恒有(可见性由门控态控制);纯分组行恒可见。
  const caret = document.createElement('span');
  caret.className = 'caret';
  caret.textContent = '▶';
  if (meta.key) caret.style.visibility = 'hidden';
  name.appendChild(caret);

  name.appendChild(document.createTextNode(meta.label));

  // 问号徽章(2026-10-18 起一级行也挂 —— 旧版「一级行一律不挂」已废,
  // 因为总闸的说明(例如「只作用于页面滚动链」)同样需要入口)。
  attachHelpBadge(name, meta.desc, meta.note);

  // 右侧容器(2026-10-16 修「一级行开关错位」):
  // 原先这个 span 没有任何布局约束,而 .switch 是 <label>(默认 inline)——
  // inline 元素上 width/height 不生效,开关宽度失控、被挤出分组框。
  // 给它 display:flex(见 popup.html 的 .host-switch),.switch 才成为
  // flex item 而被块化,width:36px 才真正生效。
  const right = document.createElement('span');
  right.className = 'host-switch';
  let input = null;

  if (meta.key) {
    const label = document.createElement('label');
    label.className = 'switch';
    input = document.createElement('input');
    input.type = 'checkbox';
    input.id = 'flag-' + meta.key;
    const slider = document.createElement('span');
    slider.className = 'slider';
    label.appendChild(input);
    label.appendChild(slider);
    right.appendChild(label);
  } else {
    const tip = document.createElement('span');
    tip.className = 'host-tip';
    let n = 0;
    DYC_FLAGS_META.forEach((m) => { if (m.foldGroup === meta.foldHost) n++; });
    tip.textContent = '展开 ' + n + ' 项';
    right.appendChild(tip);
  }

  row.appendChild(name);
  row.appendChild(right);

  // 纯分组行(无开关):点整行展开/收起。
  // 有开关的一级行**不绑**这个 —— 它的展开/收起由 renderFlags 绑在**名字**上
  // (2026-10-18:开关只管门控,点整行不该也触发展开,免得点开关旁边的空白误开)。
  if (!meta.key) {
    row.addEventListener('click', () => {
      const box = row.nextElementSibling;
      if (!box || !box.classList.contains('fold-box')) return;
      box.hidden = !box.hidden;
      row.classList.toggle('open', !box.hidden);
    });
  }

  return { row: row, input: input, caret: caret, name: name };
}

/**
 * 「调试模式」的子菜单面板 —— 一张按需挑选的调试功能清单（2026-10-16 用户定稿）。
 *
 * 形态：开关开着 + 点名字 → 清单展开（2026-10-18 起由名字触发）。
 * 拨开关本身**不执行任何动作**，只是给这一行开门；点名字才把清单摊开，
 * 用户挑哪项才跑哪项。
 *
 * 清单两项（顺序即显示顺序）：
 *   ① 导出当前页结构 —— 读**页面**的结构,写适配代码用
 *   ② 复制诊断报告   —— 读**扩展**的健康档案,纠错用;由页面侧实例跑,轨迹不丢
 *
 * 曾经的第三项「加参数并刷新」已按用户要求删除(2026-10-16):
 * 拨开关本身就能让页面进调试态(页面侧订阅 storage),地址参数不再是必经之路。
 *
 * 2026-10-18 用户定「备注放进问号里」：原先面板顶部那句
 * 「开启后,抖店商品列表页与中控台的左下角显示橙色标记…」整段搬进总开关的
 * 问号气泡（见 flags.js 的 desc / note）；两项功能的灰字说明也各自进问号。
 */
function buildDebugPanel() {
  const el = document.createElement('div');
  el.className = 'hide-panel';       // 复用现有面板样式(浅底 + 圆角)
  // 2026-10-18:顶部那段灰字提示（buildDebugTip）已删 —— 内容搬进总开关的
  // 问号气泡（flags.js 的 desc/note）。弹窗里凡是「一段说明」都收进问号，
  // 面板里只留可操作的东西。
  el.appendChild(buildProbeBox());
  el.appendChild(buildReportBox());

  return {
    el: el,
    setEnabled: (on) => {
      el.style.opacity = on ? '1' : '.45';
      el.style.pointerEvents = on ? 'auto' : 'none';
    }
  };
}

/**
 * 带次级菜单的开关 —— 返回面板 {el, setEnabled} 或 null。
 * 四类:hideElements(复选框清单) / scanShade(白幕两档) / omniSearch(回车两档) /
 *       debug(调试提示 + 导出当前页结构)。
 * 返回的面板由 attachSubPanelToggle 接管展开 / 可用态;
 * 调用方(renderFlags)再把它登记进 foldOpeners,以便按 storage 设初态。
 */
function buildSubPanel(meta) {
  if (!hasSubPanel(meta)) return null;
  if (meta.panel === 'hideElements') return buildHidePanel();
  if (meta.panel === 'debug') return buildDebugPanel();
  if (meta.key === 'scanShade') return buildShadePanel();
  if (meta.key === 'omniSearch') return buildOmniPanel();
  return null;
}

/**
 * 「这一行有没有子内容」—— **唯一判据**（2026-10-18 新增）。
 *
 * 为什么单独立一个函数：`buildToggleRow` 要用它决定「挂不挂下拉箭头」，
 * `buildSubPanel` 要用它决定「建不建面板」。两处口径一旦分家就会出现
 * 「有面板却没箭头」（用户看不出这行能点）或「有箭头却点不出东西」。
 * ⚠️ 注意 scanShade 是**按 key 认**的（它没写 panel 字段），漏掉它就会踩上面那个坑。
 */
function hasSubPanel(meta) {
  if (meta.panel === 'hideElements' && typeof DYC_HIDE_TARGETS !== 'undefined') return true;
  if (meta.panel === 'debug') return true;
  if (meta.key === 'scanShade') return true;
  if (meta.key === 'omniSearch') return true;
  return false;
}

/**
 * 给「带子内容的开关行」挂 **门控 + 名字触发** 交互（2026-10-18 重写）。
 *
 * ★ 现行规则（用户 2026-10-18 定，取代 10-16 的「开关是唯一入口」）：
 *     开关 = 门控，名字 = 触发。两级分工：
 *       开关开 ⇒ 名字可点、▶ 可见、面板**仍然收起**（默认不展开）；
 *       开关关 ⇒ ▶ 隐藏、名字变灰不可点、面板收起且灰显；
 *       点名字 ⇒ 翻转面板的展开态（唯一的展开入口）。
 *   为什么改：旧规则下「开关开 ⇒ 立即展开」，而弹窗里 5 个开关默认就是开的，
 *   于是每次打开都是三层折叠区连选项面板全部撑开（实测 ≈1011px，要滚 411px）。
 *   新规则下 ≈590px，一屏看完。
 *   同时它也把 #89（「没打开按钮就默认看不了子菜单」）一并解决 —— 门控关着时
 *   面板收起且 pointerEvents:none，子项点不动。
 *
 * @param built {row, input, name, caret}  buildToggleRow / buildHostRow 的产物
 * @param panel {el, setEnabled}           子面板
 */
function attachSubPanelToggle(built, panel) {
  /** 门控态：能不能展开（= 开关是否开着）。渲染期一律先按「关」处理。 */
  function setGate(open) {
    built.row.classList.toggle('row--gated-off', !open);
    if (built.caret) built.caret.style.visibility = open ? 'visible' : 'hidden';
    if (typeof panel.setEnabled === 'function') panel.setEnabled(open);
    if (!open) setExpanded(false);   // 门一关，展开态一并收回
  }

  /** 展开态：面板是否展开。只由点名字决定。 */
  function setExpanded(expanded) {
    panel.el.hidden = !expanded;
    built.row.classList.toggle('open', expanded);
  }

  // 供「初始状态」段按 storage 的真实值补门控态（渲染期读不到真实值：
  // input.checked 是弹窗渲染完成后才按 storage 赋的）。
  panel.setGate = setGate;
  panel.setExpanded = setExpanded;

  // 名字 = 唯一展开入口。门控关着时点击无效（同时没有手型光标与箭头，看着就不该点）。
  built.name.addEventListener('click', () => {
    if (built.row.classList.contains('row--gated-off')) return;
    setExpanded(!built.row.classList.contains('open'));
  });

  // 开关只改门控，**不**改展开态 —— 这是与旧实现最关键的区别。
  built.input.addEventListener('change', () => {
    setGate(built.input.checked);
  });
}

/* ==========================================================
 * 问号气泡 · 浮动定位(2026-10-16 用户定,计划栏第 4 条)
 *
 * 用户原话:「拓展的菜单,浮动展示」—— 气泡必须完整看得见,
 * 不能被弹窗自己的窗口边缘切掉(截图:文案开头「排」被裁)。
 *
 * 为什么坐标必须由 JS 现算:气泡是 position:fixed 的浮动层,
 * left/top 相对**弹窗视口**而非徽章;徽章在弹窗里的位置随分组、
 * 滚动、缩放而变,只能悬停那一刻实测。
 *
 * 三条硬约束(自检脚本 .tmp/verify-弹窗气泡.js 逐条用例覆盖):
 *   ① 左右各留 HELP_POP_EDGE(8px):气泡永不越出弹窗左右边缘
 *   ② 优先显示在徽章下方;下方放不下就翻到上方;上下都紧则贴底钳制
 *   ③ 箭头横向对准徽章中心,并随气泡一起钳制在气泡内
 *
 * ⚠️ 下面「开始/结束」两处标记是**预览页与自检脚本的抽取锚点**
 *    (output/弹窗问号气泡-修复预览.html 会原样抽走整段,保证预览里跑的
 *    就是扩展里跑的同一份代码),不要改名、不要加第二对。
 * ========================================================== */

/* ==== 问号气泡浮动定位 开始 ==== */

/* ==== dybHelpPopRect 开始 ==== */
const HELP_POP_GAP = 6;    // 气泡与徽章之间的间隙
const HELP_POP_EDGE = 8;   // 与弹窗视口边缘的最小留白

/** 纯计算:给出气泡的最终 left/top(是否翻到上方)与箭头横向位置 */
function dybHelpPopRect(rect, w, h, vw, vh) {
  // ① 横向:先按「与徽章中心对齐」算,再钳制进视口
  let left = rect.left + rect.width / 2 - w / 2;
  const maxLeft = Math.max(HELP_POP_EDGE, vw - w - HELP_POP_EDGE);
  if (left < HELP_POP_EDGE) left = HELP_POP_EDGE;
  if (left > maxLeft) left = maxLeft;

  // ② 纵向:优先下方;下方放不下翻到上方;上下都紧则贴底
  let top = rect.bottom + HELP_POP_GAP;
  let above = false;
  if (top + h > vh - HELP_POP_EDGE) {
    const up = rect.top - h - HELP_POP_GAP;
    if (up >= HELP_POP_EDGE) {
      top = up;
      above = true;
    } else {
      top = Math.max(HELP_POP_EDGE, vh - h - HELP_POP_EDGE);
    }
  }
  // 兜底钳制:徽章被滚到视口极边缘时连上方也放不下 —— 宁可轻微压住徽章,
  // 也不许气泡被裁(「完整可见」是用户定的硬要求)
  if (top + h > vh - HELP_POP_EDGE) {
    top = Math.max(HELP_POP_EDGE, vh - h - HELP_POP_EDGE);
  }

  // ③ 箭头:对准徽章中心,并保证不跑到气泡圆角之外
  let arrowX = rect.left + rect.width / 2 - left;
  if (arrowX < 10) arrowX = 10;
  if (arrowX > w - 10) arrowX = w - 10;

  return { left: left, top: top, above: above, arrowX: arrowX };
}
/* ==== dybHelpPopRect 结束 ==== */

let openHelp = null;   // 当前展开的气泡:同一时刻只允许一个

/** 量尺寸 → 定位 → 展开(重复调用即「重新贴合」,滚动/resize 也走这里) */
function placeHelpPop(badge, pop) {
  const r = badge.getBoundingClientRect();
  pop.classList.add('is-open');
  pop.style.visibility = 'hidden';   // 先参与布局才量得到尺寸(display:none 时 offset 为 0)
  const w = pop.offsetWidth;
  const h = pop.offsetHeight;
  pop.style.visibility = '';

  const box = dybHelpPopRect(r, w, h, window.innerWidth, window.innerHeight);
  pop.style.left = Math.round(box.left) + 'px';
  pop.style.top = Math.round(box.top) + 'px';
  pop.style.setProperty('--dyb-pop-arrow-x', Math.round(box.arrowX) + 'px');
  pop.classList.toggle('is-above', box.above);
}

function hideHelpPop() {
  if (!openHelp) return;
  openHelp.pop.classList.remove('is-open');
  openHelp.badge.setAttribute('aria-expanded', 'false');
  openHelp = null;
}

function showHelpPop(badge, pop) {
  if (openHelp && openHelp.pop !== pop) hideHelpPop();
  placeHelpPop(badge, pop);
  openHelp = { badge: badge, pop: pop };
  badge.setAttribute('aria-expanded', 'true');
}

/** 把浮动气泡挂到徽章上:悬停展开、移开收起(与旧版交互完全一致) */
function attachHelpFloat(badge, pop) {
  badge.addEventListener('mouseenter', () => showHelpPop(badge, pop));
  badge.addEventListener('mouseleave', () => {
    if (document.activeElement !== badge) hideHelpPop();
  });
  badge.addEventListener('focus', () => showHelpPop(badge, pop));
  badge.addEventListener('blur', hideHelpPop);
  badge.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault(); event.stopPropagation(); hideHelpPop();
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault(); event.stopPropagation();
      if (openHelp && openHelp.badge === badge) hideHelpPop();
      else showHelpPop(badge, pop);
    }
  });
}

/* 弹窗滚动 / 缩放后徽章会挪位,浮动层必须跟着重贴 —— 否则气泡会「飘」在
   原地指向别处。低频事件(同时只有一个气泡),开销可忽略。 */
window.addEventListener('scroll', () => {
  if (openHelp) placeHelpPop(openHelp.badge, openHelp.pop);
}, { passive: true });
window.addEventListener('resize', () => {
  if (openHelp) placeHelpPop(openHelp.badge, openHelp.pop);
});

/* ==== 问号气泡浮动定位 结束 ==== */

/**
 * 「搜索扫描白幕」遮罩档位面板(2026-10-12)。
 *
 * 两档固定(用户定,不做自由滑杆):
 *   不透明白 —— 底下完全看不见(最安静,推荐);
 *   半透明 40% —— 隐约看到列表在翻、知道在干活,鬼影不干扰阅读。
 * 单选即时写入 dycScanShadeMode,已打开页面自动生效,无需「保存」键。
 * setEnabled(false) 整块灰显(总开关关闭时),档位保留。
 */
function buildShadePanel() {
  const el = document.createElement('div');
  el.className = 'hide-panel';

  // 2026-10-18 用户定「子菜单的备注放进问号里,不要用注解浪费空间」:
  // 原来这里有一行灰字标题「白幕样式（搜索扫描期间）」,职责与问号气泡重叠 ——
  // 删掉,面板里直接就是选项;每个选项的解释也各挂一枚问号。
  const OPTIONS = [
    { value: 'opaque', label: '不透明白', tip: '底下完全看不见,扫描期间屏幕最安静(推荐)。' },
    { value: 'translucent', label: '半透明 40%', tip: '隐约能看到列表在翻,知道它在干活,又不干扰阅读。' }
  ];
  const radios = [];

  OPTIONS.forEach((opt, i) => {
    const item = document.createElement('label');
    item.className = 'hide-item';
    item.style.cssText = 'display:flex;align-items:center;gap:8px;padding:4px 2px;cursor:pointer;';

    const input = document.createElement('input');
    input.type = 'radio';
    input.name = 'dyc-shade-mode';
    input.value = opt.value;
    if (i === 0) input.checked = true;   // 先按默认勾,读完 storage 再对齐
    input.style.cssText = 'margin:0;';

    const span = document.createElement('span');
    span.style.cssText = 'font-size:12px;color:#1d2129;display:inline-flex;align-items:center;';
    span.textContent = opt.label;
    attachHelpBadge(span, opt.tip);

    item.appendChild(input);
    item.appendChild(span);
    el.appendChild(item);
    radios.push(input);

    input.addEventListener('change', async () => {
      if (!input.checked) return;
      const before = radios.find((radio) => radio._saved);
      radios.forEach((radio) => { radio.disabled = true; });
      try {
        await dycWriteShadeMode(opt.value);
        radios.forEach((radio) => { radio._saved = radio === input; });
        flash('白幕样式已保存：' + opt.label);
      } catch (_) {
        radios.forEach((radio) => { radio.checked = radio === before; });
        flash('白幕样式未保存，请重试');
      } finally { radios.forEach((radio) => { radio.disabled = false; }); }
    });
  });

  // 读取已存档位对齐选中态(storage 异常/无值 = 默认 opaque,与内容脚本同口径)
  if (typeof dycReadShadeMode === 'function') {
    dycReadShadeMode().then((mode) => {
      radios.forEach((r) => { r.checked = r.value === mode; r._saved = r.checked; });
    });
  }

  const setEnabled = (on) => {
    el.style.opacity = on ? '1' : '.45';
    el.style.pointerEvents = on ? 'auto' : 'none';
  };

  return { el: el, setEnabled: setEnabled };
}

/**
 * 「全能搜索」**两档**单选面板（2026-10-12 创建，2026-10-18 三档改两档）。
 *
 * 总开关 omniSearch（默认开，控制【全能搜索】按钮显隐）；
 * 两档（用户 2026-10-18 定）：
 *   none   —— 默认原生搜索：回车走平台自己的搜索，全能只认按钮（默认）；
 *   always —— 默认全能搜索：回车直接走全能扫描，不先跑原生。
 * 第三档 trial3「事不过三」**已按用户决定整体删除**（用户原话「不修复了，放弃修复」
 * 「事不过三这个功能删掉」）—— 连带 search.js 的三套计数器与回车分支一起删。
 * 旧存档里的 'trial3' 无需迁移：flags.js 的白名单会把它回落成 'none'。
 *
 * 文案口径（2026-10-18 用户定「备注放进问号里，不要用——注解浪费空间」）：
 * 标签**只写名字**，解释全部收进问号气泡 —— 所以不再有「xx —— 说明」这种写法，
 * 也不再单独占一行「回车行为(三档,默认「无」)」的灰字标题。
 * 单选即时写入 dycOmnisearchMode，已打开页面自动生效，无需「保存」键。
 */
function buildOmniPanel() {
  const el = document.createElement('div');
  el.className = 'hide-panel';

  const OPTIONS = [
    { value: 'none', label: '默认原生搜索',
      tip: '回车走平台自己的搜索,最快;全能搜索只在你点【全能搜索】按钮时才用。' },
    { value: 'always', label: '默认全能搜索',
      tip: '回车直接走全能扫描:能搜名称任意片段、多关键词、价格,但每次都要滚动整个商品列表,比原生慢。' }
  ];
  const radios = [];

  OPTIONS.forEach((opt) => {
    const item = document.createElement('label');
    item.className = 'hide-item';
    item.style.cssText = 'display:flex;align-items:flex-start;gap:8px;padding:4px 2px;cursor:pointer;';

    const input = document.createElement('input');
    input.type = 'radio';
    input.name = 'dyc-omni-mode';
    input.value = opt.value;
    if (opt.value === 'none') input.checked = true;   // 先按默认勾,读完 storage 再对齐
    input.style.cssText = 'margin:0;margin-top:3px;';

    const span = document.createElement('span');
    span.style.cssText = 'font-size:12px;color:#1d2129;line-height:1.5;display:inline-flex;align-items:center;';
    span.textContent = opt.label;
    attachHelpBadge(span, opt.tip);   // 2026-10-18:解释收进问号,标签只留名字

    item.appendChild(input);
    item.appendChild(span);
    el.appendChild(item);
    radios.push(input);

    input.addEventListener('change', async () => {
      if (!input.checked) return;
      const before = radios.find((radio) => radio._saved);
      radios.forEach((radio) => { radio.disabled = true; });
      try {
        await dycWriteOmniMode(opt.value);
        radios.forEach((radio) => { radio._saved = radio === input; });
        flash('回车模式已保存：' + opt.label);
      } catch (_) {
        radios.forEach((radio) => { radio.checked = radio === before; });
        flash('回车模式未保存，请重试');
      } finally { radios.forEach((radio) => { radio.disabled = false; }); }
    });
  });

  // 读取已存档位对齐选中态(storage 异常/无值 = 默认 none,与内容脚本同口径)
  if (typeof dycReadOmniMode === 'function') {
    dycReadOmniMode().then((mode) => {
      radios.forEach((r) => { r.checked = r.value === mode; r._saved = r.checked; });
    });
  }

  const setEnabled = (on) => {
    el.style.opacity = on ? '1' : '.45';
    el.style.pointerEvents = on ? 'auto' : 'none';
  };

  return { el: el, setEnabled: setEnabled };
}

/**
 * 「隐藏页面元素」复选框面板。
 *
 * 清单来自 flags.js 的 DYC_HIDE_TARGETS(与内容脚本共用的唯一真源);
 * 勾选只改本地状态,**点「保存勾选」才写 storage** —— 内容脚本只在
 * 存储真正变化时才生效,所以不保存就不会惊动已打开的页面。
 *
 * setEnabled(false) 把整块灰显(总开关关闭时):勾选保留,只是暂不生效,
 * 重新打开总开关后按上次保存的勾选恢复。
 */
function buildHidePanel() {
  const el = document.createElement('div');
  el.className = 'hide-panel';

  const boxes = {};
  DYC_HIDE_TARGETS.forEach((t) => {
    const item = document.createElement('label');
    item.className = 'hide-item';

    const input = document.createElement('input');
    input.type = 'checkbox';
    boxes[t.id] = input;

    const text = document.createElement('span');
    text.className = 'h-text';
    const name = document.createElement('span');
    name.className = 'h-name';
    name.textContent = t.label;
    // 2026-10-18 用户定「子菜单的备注放进问号里」:
    // 每条原来的第二行灰字说明（.h-desc）不再常显，收进问号气泡。
    // 4 项 × 一行说明 ≈ 每项省 16px，面板高度减半；信息一条没丢。
    attachHelpBadge(name, t.desc);
    text.appendChild(name);

    item.appendChild(input);
    item.appendChild(text);
    el.appendChild(item);
  });

  const foot = document.createElement('div');
  foot.className = 'hide-foot';
  const saveBtn = document.createElement('button');
  saveBtn.type = 'button';
  saveBtn.className = 'btn primary';
  saveBtn.textContent = '保存勾选';
  const savedNote = document.createElement('span');
  savedNote.className = 'hide-note';
  foot.appendChild(saveBtn);
  foot.appendChild(savedNote);
  el.appendChild(foot);

  // 初始勾选 = 已保存的清单(键不存在时回落到登记表的默认勾选)
  dycReadHideList().then((list) => {
    DYC_HIDE_TARGETS.forEach((t) => {
      boxes[t.id].checked = list.indexOf(t.id) !== -1;
    });
  });

  saveBtn.addEventListener('click', () => {
    if (saveBtn.disabled) return;
    saveBtn.disabled = true;
    const ids = DYC_HIDE_TARGETS
      .filter((t) => boxes[t.id].checked)
      .map((t) => t.id);
    dycWriteHideList(ids).then(() => {
      savedNote.textContent = '已保存 ✓';
      clearTimeout(savedNote._timer);
      savedNote._timer = setTimeout(() => { savedNote.textContent = ''; }, 3000);
      // 反馈文案与开关行区分开:这里报「生效范围」而不是「已开启/关闭」
      // 2026-10-18:范围由 liveCtrl 一处改为 liveCtrl + shopAll ——
      // 登记表里的目标早已铺到抖店全域(智能助手 / 反馈入口 / summon 浮条),
      // 只数中控台会把「已生效」说成 0 个页面,与实际不符。
      const match = buildPageMatcher(['liveCtrl', 'shopAll']);
      chrome.tabs.query({}, (tabs) => {
        const n = tabs.filter((t) => t.url && match(t.url)).length;
        flash(n > 0
          ? '设置已保存，适用于 ' + n + ' 个已打开页面'
          : '设置已保存，暂无相关页面');
      });
    }).catch(() => {
      savedNote.textContent = '保存失败';
      flash('隐藏设置未保存，请重试');
    }).finally(() => { saveBtn.disabled = false; });
  });

  return {
    el: el,
    setEnabled(on) {
      el.classList.toggle('disabled', !on);
    }
  };
}

// 「其他」组末尾固定追加更新区。
//
// 2026-10-18:原先这里还有一个 buildDebugTip()（一段说明「开启后…左下角显示
// 橙色标记…开关即时生效」）。按用户「备注放进问号里、不要用注解占空间」的口径，
// 这段说明已整体搬进「调试模式」总开关的问号气泡（flags.js 的 desc / note），
// 函数随之删除 —— 面板里只留两枚可操作的按钮。
function buildUpdateBox() {
  const box = document.createElement('div');
  box.className = 'update-box';
  // 2026-10-16 弹窗减噪:三行压成两行 ——
  //   ① 「抖音可可助手版本号:」→「版本」(弹窗标题已写着扩展名,前缀重复)
  //   ② 「项目地址: Gitee」与「遇到问题或有建议? 反馈」合并成一行(左 Gitee、右 反馈)
  //   ③ 「反馈 →」去掉箭头 —— 反馈是在页面内开浮层、不跳转,箭头暗示「跳走」不准确
  //   ④ 状态行改为空时隐藏(见 popup.html 的 .upd-status:empty),不再白占 19px
  box.innerHTML =
    '<div class="upd-row">' +
      '<span class="upd-label">版本 <b id="upd-ver">—</b></span>' +
      '<span class="upd-right">' +
        // 「回退」常驻入口：只要本地存有备份就显示，与「有没有新版本」无关。
        // 这是「更新完成后仍能退回上一版」的唯一入口 —— 详见 update.js 头部注释。
        '<a href="#" id="upd-rollback" class="upd-link" hidden>回退</a>' +
        '<a href="#" id="upd-action" class="upd-action">检查更新</a>' +
      '</span>' +
    '</div>' +
    '<div class="upd-row">' +
      // 源码地址：Gitee 主源已被封（仓库首页 404），改指 GitHub 镜像。
      '<a href="#" id="upd-repo" class="upd-link">GitHub</a>' +
      // 「更新日志」常驻入口（#106）：打开页面内浮层并落在「更新日志」Tab（2026-10-24 迭代）。
      '<a href="#" id="upd-log" class="upd-link">更新日志</a>' +
      '<a href="#" id="upd-feedback" class="upd-feedback">反馈</a>' +
    '</div>' +
    '<div class="upd-status" id="upd-status"></div>';
  return box;
}

/**
 * 「导出当前页结构」按钮(2026-10-16 新增)
 *
 * 用途:把当前页面的 DOM 结构导出成报告,交给助手写适配代码。
 *
 * 与调试面板的分工(别混):
 *   调试面板(debug-panel.js)导的是「**扩展自身**的健康档案」——
 *     它只扫 [id^="dyb-"] 这类扩展自己插进去的节点;
 *   本按钮导的是「**目标页面**的结构档案」——
 *     页面骨架 / 列表容器 / 交互元素,扩展自己的节点反而被排除。
 *
 * 实现要点:
 *   · 探针脚本 src/content/page-probe.js 用 chrome.scripting.executeScript
 *     **按需注入**,不进 manifest 的 content_scripts —— 零日常开销。
 *   · 结果不走 executeScript 的返回值(files 形式的返回值不可靠),
 *     由探针用 chrome.runtime.sendMessage 回传。
 *   · 8 秒超时兜底:探针万一没回话,不能让按钮永远卡在「正在读取」。
 */
function buildProbeBox() {
  const wrap = document.createElement('div');
  wrap.className = 'probe-box';

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'btn primary';
  btn.textContent = '导出当前页结构';

  // 2026-10-18:原先按钮下面那行灰字说明（「导出本页 DOM 结构，交给助手写适配
  // 代码」）改挂到按钮右侧的问号上 —— 面板里不再出现说明文字，只留按钮与问号。
  const titleRow = document.createElement('div');
  titleRow.className = 'probe-title';
  titleRow.appendChild(btn);
  attachHelpBadge(titleRow, '导出本页 DOM 结构，交给助手写适配代码。');

  const msg = document.createElement('div');
  msg.className = 'probe-msg';
  msg.hidden = true;

  const fallback = document.createElement('textarea');
  fallback.className = 'probe-fallback';
  fallback.readOnly = true;
  fallback.hidden = true;

  wrap.appendChild(titleRow);
  wrap.appendChild(msg);
  wrap.appendChild(fallback);

  const BTN_TEXT = '导出当前页结构';
  let busy = false;
  let timer = null;
  let msgTimer = null;

  function say(text, kind) {
    msg.textContent = text || '';
    msg.className = 'probe-msg' + (kind ? ' ' + kind : '');
    msg.hidden = !text;
    clearTimeout(msgTimer);
    if (text && kind === 'ok') {
      msgTimer = setTimeout(() => { msg.hidden = true; }, 4000);
    }
  }

  // 剪贴板三级兜底已提到模块级(legacyCopy / copyText),
  // 与「复制诊断报告」共用同一份实现。

  function reset() {
    busy = false;
    btn.disabled = false;
    btn.textContent = BTN_TEXT;
  }

  function onProbeResult(res) {
    if (!res || res.type !== 'dyc:probeResult') return;
    chrome.runtime.onMessage.removeListener(onProbeResult);
    clearTimeout(timer);
    reset();

    if (!res.ok) {
      say(res.error || '采集失败', 'err');
      return;
    }
    copyText(res.text, (ok) => {
      if (ok) {
        say('已复制到剪贴板，粘贴给助手即可', 'ok');
      } else {
        // 复制失败不算失败 —— 展开文本框,用户手选一样能带走
        say('剪贴板不可用，请从下方文本框手动复制', 'err');
        fallback.value = res.text;
        fallback.hidden = false;
        try { fallback.focus(); fallback.select(); } catch (e) {}
      }
    });
  }

  btn.addEventListener('click', async () => {
    if (busy) return;
    busy = true;
    btn.disabled = true;
    btn.textContent = '正在读取页面…';
    say('');
    fallback.hidden = true;

    try {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      const tab = tabs && tabs[0];
      if (!tab || tab.id === undefined) throw new Error('没有找到当前标签页');

      // 与 manifest 的 host_permissions 同口径(见文件头的 onSupportedPage):
      // 范围外的页面注入会被拦,提前判掉能给一句人话,而不是把英文报错甩给用户。
      if (!onSupportedPage(tab.url)) {
        throw new Error('本页不在扩展支持范围（抖店 / 直播回放页 / 微信小店），读不到结构');
      }

      chrome.runtime.onMessage.addListener(onProbeResult);

      timer = setTimeout(() => {
        chrome.runtime.onMessage.removeListener(onProbeResult);
        reset();
        say('读取超时，请刷新页面后重试', 'err');
      }, 8000);

      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['src/content/page-probe.js']
      });
    } catch (e) {
      clearTimeout(timer);
      chrome.runtime.onMessage.removeListener(onProbeResult);
      reset();
      say('读取失败：' + ((e && e.message) || e), 'err');
    }
  });

  return wrap;
}

/**
 * 「复制诊断报告」按钮(2026-10-16 新增,弹窗里的「遥控入口」)。
 *
 * 为什么是「遥控」而不是自己采集:
 *   诊断报告的价值在**操作轨迹** —— 那是页面里累积的(你点了什么、触发了什么)。
 *   弹窗按需注入脚本去采,采到的只是「此刻」的静态快照,轨迹是空的。
 *   所以这里**不做采集**,而是请页面里常驻的调试面板(debug-panel.js)自己跑
 *   一遍 __dycDiag.report() 再回传 —— 等于页面左下角那枚按钮,只是多了个
 *   弹窗入口,轨迹一条不少。
 *
 * 三条前提(不满足就给中文提示,不假装成功):
 *   · 本页须处于调试态 —— 否则页面侧直接回「请先打开调试模式」
 *   · 本页须有调试面板 —— 现覆盖商品列表 / 中控台 / 直播明细 / 罗盘直播大屏 /
 *     商品列表两页 / 直播回放两页 / 微信小店全域（2026-10-30 起）
 *     （manifest 里带 debug-panel.js 的条目）
 *   · 页面须跑着当前版本的脚本 —— 扩展刚更新过时需刷新一次
 */
function buildReportBox() {
  const wrap = document.createElement('div');
  wrap.className = 'probe-box';

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'btn';
  btn.textContent = '复制诊断报告';

  // 2026-10-18:说明文字改挂问号（与「导出当前页结构」同口径）。
  const titleRow = document.createElement('div');
  titleRow.className = 'probe-title';
  titleRow.appendChild(btn);
  attachHelpBadge(titleRow, '读取本页诊断报告，纠错用。本页须处于调试态。');

  const msg = document.createElement('div');
  msg.className = 'probe-msg';
  msg.hidden = true;

  const fallback = document.createElement('textarea');
  fallback.className = 'probe-fallback';
  fallback.readOnly = true;
  fallback.hidden = true;

  wrap.appendChild(titleRow);
  wrap.appendChild(msg);
  wrap.appendChild(fallback);

  const BTN_TEXT = '复制诊断报告';
  let busy = false;
  let timer = null;
  let msgTimer = null;

  function say(text, kind) {
    msg.textContent = text || '';
    msg.className = 'probe-msg' + (kind ? ' ' + kind : '');
    msg.hidden = !text;
    clearTimeout(msgTimer);
    if (text && kind === 'ok') {
      msgTimer = setTimeout(() => { msg.hidden = true; }, 4000);
    }
  }

  function reset() {
    busy = false;
    btn.disabled = false;
    btn.textContent = BTN_TEXT;
  }

  btn.addEventListener('click', async () => {
    if (busy) return;
    busy = true;
    btn.disabled = true;
    btn.textContent = '正在读取…';
    say('');
    fallback.hidden = true;

    try {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      const tab = tabs && tabs[0];
      if (!tab || tab.id === undefined) throw new Error('没有找到当前标签页');

      // 与 manifest 的 host_permissions 同口径(同「导出当前页结构」的判断)
      if (!onSupportedPage(tab.url)) {
        throw new Error('本页不在扩展支持范围（抖店 / 直播回放页 / 微信小店），没有调试面板');
      }

      // 8 秒兜底:页面万一不回话,不能让按钮永远卡在「正在读取」
      timer = setTimeout(() => {
        reset();
        say('读取超时，请刷新页面后重试', 'err');
      }, 8000);

      chrome.tabs.sendMessage(tab.id, { type: 'dyc:requestReport' }, (res) => {
        clearTimeout(timer);
        reset();

        // 页面里没有接收端。三种可能,分开说清楚,不把浏览器英文报错甩给用户。
        if (chrome.runtime.lastError) {
          say('本页读不到调试面板：请确认已打开调试模式，且页面已刷新过'
            + '（扩展刚更新时旧页面里没有接收端）', 'err');
          return;
        }

        if (!res || !res.ok) {
          say((res && res.error) || '诊断报告生成失败', 'err');
          return;
        }

        copyText(res.text, (ok) => {
          if (ok) {
            say('已复制到剪贴板，粘贴给助手即可', 'ok');
          } else {
            // 复制失败不算失败 —— 展开文本框,用户手选一样能带走
            say('剪贴板不可用，请从下方文本框手动复制', 'err');
            fallback.value = res.text;
            fallback.hidden = false;
            try { fallback.focus(); fallback.select(); } catch (e) {}
          }
        });
      });
    } catch (e) {
      clearTimeout(timer);
      reset();
      say('读取失败：' + ((e && e.message) || e), 'err');
    }
  });

  return wrap;
}

// 渲染期收集:key -> input 元素
const flagInputs = {};
// 门控登记表(2026-10-18 由「展开器 foldOpeners」改名而来):
// 带子内容的行都登记在这里,弹窗渲染完成后按 storage 的真实值统一设**门控态**
// (装配期 input.checked 还不可信)。每项 { key, setGate(on) }。
// ★ 注意:setGate 只决定「能不能展开」,**不**决定展开态 —— 展开态默认恒为收起,
//   这是用户 2026-10-18 定的口径(旧版 setOpen 会在开关开时自动展开)。
const foldOpeners = [];

/**
 * 页脚（2026-10-31 用户定）
 *
 * 用户原话：「把调试模式和版本号放在页面最底部」；最终用红框+蓝框对比图确认：
 *   「把红框视为整体，一直保持沉底状态。底，就是抖音这边同样高度的底部。
 *     如果功能不够多，就在同样高度，中间可以空着。」
 * 所以它是**恒定高度窗口里的恒定元素**：body 写死 600px + 纵向 flex，
 * 页脚 flex:none，主体 flex:1 自己滚 —— 两个平台的页脚 y 坐标一模一样，
 * 微信态中间空着是明确接受的，不要再去"优化"掉那段空白。
 *
 * 里面两件事：
 *   ① 「调试模式」开关行 —— 从 DYC_FLAGS_META 里按 inFooter 取，
 *      所以存值 / 默认值 / 问号气泡 / 子清单都沿用同一套，没有第二份实现；
 *   ② 原更新区（版本号 + 检查更新 + 回退 + Gitee/更新日志/反馈）。
 *
 * 它不在 #flags-root 里，所以切平台不会把它藏掉 —— 两个平台都始终有它。
 */
function buildFooter() {
  const foot = document.getElementById('pop-foot');
  if (!foot) return;

  const dbg = DYC_FLAGS_META.filter((m) => m.inFooter)[0];
  if (dbg) {
    const built = buildToggleRow(dbg);
    if (dbg.key) flagInputs[dbg.key] = built.input;
    foot.appendChild(built.row);

    // 面板必须紧跟在它那一行之后（与主体区同一条规则：顺序恒为「行 → 面板」）
    const panel = buildSubPanel(dbg);
    if (panel) {
      panel.el.hidden = true;      // 渲染期一律收起，门控态由 storage 回填
      foot.appendChild(panel.el);
      attachSubPanelToggle(built, panel);
      foldOpeners.push({ key: dbg.key, setGate: panel.setGate });
    }
  }

  foot.appendChild(buildUpdateBox());
}

function renderFlags() {
  const boxByGroup = {};

  DYC_FLAG_GROUPS.forEach((g) => {
    const box = document.createElement('div');
    box.className = 'group group-' + g.id;
    // 2026-10-31 平台切换要按分组 id 显隐，把归属写在 DOM 上，
    // 切平台时就不必再摸一遍 DYC_FLAG_GROUPS 去反查。
    box.dataset.gid = g.id;

    const head = document.createElement('div');
    head.className = 'group-head';
    const dot = document.createElement('span');
    dot.className = 'dot';
    head.appendChild(dot);
    head.appendChild(document.createTextNode(g.title));

    box.appendChild(head);
    boxByGroup[g.id] = box;
  });

  // 折叠容器表:host 名('search' / 'scroll') → fold-box 元素
  const foldBoxes = {};
  // pinLast 的行延后到主循环结束再补 —— 保证它排在同类开关的最后
  const deferred = [];

  DYC_FLAGS_META.forEach((meta) => {
    /* hidden:true ⇒ **不进弹窗**(2026-10-26 用户定:「删掉这个按钮,保留这个功能」)。
     * 这类开关照样存 dybFeatures、照样有默认值、内容脚本照样读得到,
     * 只是弹窗里不再出一行 —— 改它的入口在功能自己的界面里
     * (现仅 autoLoopDefaultOn:自动循环讲解的胶囊展开面板底部)。
     * ⚠️ 只跳过「建行」;后面两个 forEach(绑事件 / 回填初态)都是按
     *    flagInputs[key] 取的,没建行自然取不到,不需要再判一次。 */
    if (meta.hidden) return;

    /* inFooter(2026-10-31):这一行不进主体区，由 buildFooter() 渲染到固定底栏。
     * 只跳过"建行"，后面的绑定/回填都按 flagInputs[key] 取 —— buildFooter
     * 也会把 input 登记进去，所以那两段循环照样能绑上。 */
    if (meta.inFooter) return;

    const box = boxByGroup[meta.group] || boxByGroup.other;

    /* ---- ① 一级行(foldHost):建行 + 紧跟其后建折叠容器 ---- */
    if (meta.foldHost) {
      const built = buildHostRow(meta);
      if (meta.key) flagInputs[meta.key] = built.input;
      box.appendChild(built.row);

      const foldBox = document.createElement('div');
      foldBox.className = 'fold-box';
      foldBox.hidden = true;         // 一律先收起(2026-10-18:默认不展开是硬要求)
      box.appendChild(foldBox);
      foldBoxes[meta.foldHost] = foldBox;

      // 有开关的一级行:开门控 —— 开关开 ⇒ 名字可点、▶ 可见;关 ⇒ 名字变灰不可点。
      // 展开/收起只由点名字决定,渲染期恒收起。
      // (无开关的纯分组行不绑,维持 buildHostRow 里的点整行展开)
      if (meta.key) {
        const row = built.row;
        function setGate(on) {
          row.classList.toggle('row--gated-off', !on);
          if (built.caret) built.caret.style.visibility = on ? 'visible' : 'hidden';
          if (!on) { foldBox.hidden = true; row.classList.remove('open'); }
        }
        foldOpeners.push({ key: meta.key, setGate: setGate });
        built.input.addEventListener('change', () => setGate(built.input.checked));
        built.name.addEventListener('click', () => {
          if (row.classList.contains('row--gated-off')) return;
          foldBox.hidden = !foldBox.hidden;
          row.classList.toggle('open', !foldBox.hidden);
        });
      }
      return;
    }

    /* ---- ② 普通开关行 ---- */
    const built = buildToggleRow(meta);
    if (meta.key) flagInputs[meta.key] = built.input;

    // 目标容器:声明 foldGroup 的进折叠区,否则进分组框
    // (2026-10-18:「更多设置」折叠层已取消 —— 它只剩「抓手光标」一项,
    //  该项已提为常显行,这一支因此不再被任何 meta 命中,一并删除。)
    let target = box;
    if (meta.foldGroup && foldBoxes[meta.foldGroup]) {
      target = foldBoxes[meta.foldGroup];
    }

    if (meta.pinLast) {
      // 面板要跟着行走 ⇒ 先占位,稍后与行一起落地(见下方 ③)
      deferred.push({ row: built.row, target: target, panel: null });
    } else {
      target.appendChild(built.row);
    }

    /* ---- ③ 带次级菜单的开关:面板挂到**开关行实际所在的容器** ---- */
    // 2026-10-16 修正:原实现一律 append 到分组框(boxByGroup[meta.group]),
    // 开关行一旦进折叠区,面板就会与它「分家」—— 折叠区里看不到面板,
    // 分组框底部却冒出一块孤立的清单。现在跟着 target 走。
    //
    // 2026-10-16 再修(用户报「点开却是向上弹出」):
    //   面板必须与行**成对**落地。此前 pinLast 只延后了「行」,面板照旧立即
    //   append ⇒ 面板先落地、行后落地 ⇒ 面板排到了行的**上方**,点开时
    //   视觉上就是「向上弹出」。pinLast 的开关恰好就是调试模式,所以只有它中招。
    const panel = buildSubPanel(meta);
    if (panel) {
      // 渲染期一律先收起:此刻读不到开关真实值(storage 是异步回填的)。
      // 门控态(可点/灰显)由下面「初始状态」段按 storage 回填。
      panel.el.hidden = true;
      if (meta.pinLast) {
        deferred[deferred.length - 1].panel = panel.el;
      } else {
        target.appendChild(panel.el);
      }
      attachSubPanelToggle(built, panel);
      foldOpeners.push({ key: meta.key, setGate: panel.setGate });
    }
  });

  // pinLast 的行补到各自容器末尾(此刻组里还只有开关行,收尾元素尚未追加)。
  // 带子菜单面板的,面板紧跟其后 —— 顺序恒为「行 → 面板」。
  deferred.forEach((d) => {
    d.target.appendChild(d.row);
    if (d.panel) d.target.appendChild(d.panel);
  });

  // 「其他」组不再追加更新区（2026-10-31 用户定：版本号随调试模式一起沉到固定底栏）。
  // 主体区到这里就只剩纯功能开关 —— 切平台只动这块，底栏一动不动。

  DYC_FLAG_GROUPS.forEach((g) => {
    if (boxByGroup[g.id]) flagsRoot.appendChild(boxByGroup[g.id]);
  });

  buildFooter();
}

// ⚠️ 这行调用绝不能少。
// 2026-10-16 修复：重构 renderFlags 时它被连带替换掉，函数定义了却从未执行 ——
// 弹窗只剩标题、下方全空（26.10.16.1 的回归）。自检里加了一条断言盯着它。
renderFlags();

/* ==========================================================
 * 一·六、平台切换（2026-10-31 用户定：胶囊双段、图标在前）
 *
 * 用户的四条要求：
 *   ① 顶部右侧一个切换按钮，抖音类 ⇄ 微信小店类，互相切换；
 *   ② 按钮前面带平台图标；
 *   ③ 从抖音页打开就默认抖音，从微信页打开就自动切到微信；
 *   ④ 页脚（调试模式 + 版本号）两个平台都始终有一份 —— 它渲染在 #flags-root
 *      之外，切平台只动 #flags-root 里的分组，页脚天然不受影响。
 *
 * 判定顺序（别反过来）：**先看当前网址，再看上次记住的**。
 *   网址认得出（抖店/中控台/微信小店/视频号）就以网址为准 —— 用户正在
 *   哪个后台，弹窗就该是哪个平台，这条优先于任何历史选择。
 *   网址认不出（比如停在扩展页、空白页）才回落到上次用过的那个。
 *
 * 为什么要记住：用户刚在微信后台切到"抖音"看了一眼，回到空白页再开弹窗，
 *   如果每次都重置成抖音，那他在微信侧的偏好就永远留不住。
 *
 * 切平台只动 DOM 显隐，**不重建、不重写 storage** —— 两个平台的开关值
 * 各自独立存在 dybFeatures 里，切走再切回来必须原样还在。
 * ========================================================== */
const PLAT_STORE_KEY = 'dybLastPlatform';
// 当前平台。空串 = 还没定（初始化是异步的，见 initPlatform）
let currentPlatform = '';
// 初始化是否已完成 —— 超时兜底用，防止某次 chrome.tabs.query 不回调
// 让「plat-pending」永远挂着（那会让主体区一直不可见 = 弹窗看着是空的）
let platInitDone = false;

/** 把平台设成 platId：只切分组框显隐 + 胶囊选中态。 */
function applyPlatform(platId) {
  const owned = dycPlatformGroups(platId);
  // 未知 id（旧存档、手改 storage）回落到第一个平台，绝不让弹窗变成空白
  const pid = owned.length ? platId : DYC_PLATFORMS[0].id;
  const groups = owned.length ? owned : dycPlatformGroups(pid);

  currentPlatform = pid;

  const root = document.getElementById('flags-root');
  if (root) {
    Array.prototype.forEach.call(root.children, (box) => {
      const gid = box.dataset ? box.dataset.gid : '';
      if (!gid) return;
      box.hidden = groups.indexOf(gid) === -1;
    });
  }

  Array.prototype.forEach.call(document.querySelectorAll('.plat-item'), (btn) => {
    const on = btn.dataset.plat === pid;
    btn.classList.toggle('on', on);
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
  });

  platInitDone = true;
  document.body.classList.remove('plat-pending');
}

function rememberPlatform(pid) {
  try {
    const patch = {};
    patch[PLAT_STORE_KEY] = pid;
    chrome.storage.local.set(patch);
  } catch (e) { /* 存不下不影响本次切换，只是下次认不出网址时回到默认 */ }
}

/** 从被点到的节点往上找那枚平台按钮（SVG 里点中的是 <path>，不是按钮）。 */
function platBtnOf(el) {
  let node = el;
  while (node && node !== document) {
    if (node.classList && node.classList.contains('plat-item')) return node;
    node = node.parentNode;
  }
  return null;
}

(function bindPlatformSwitch() {
  const seg = document.getElementById('plat-seg');
  if (!seg) return;
  seg.addEventListener('click', (e) => {
    const btn = platBtnOf(e.target);
    if (!btn) return;
    const next = btn.dataset.plat;
    if (!next || next === currentPlatform) return;   // 点已选中的那段：什么都不做
    applyPlatform(next);
    rememberPlatform(next);
    // 换平台后回到顶部：停在上一平台的中段位置，看新的一组会很莫名
    // （2026-10-31 第八轮：滚动归文档本身，.pop-body 不再是滚动容器）
    window.scrollTo(0, 0);
  });
})();

/** 网址认不出时用上次记住的平台；读不到就用第一个平台。 */
function fallbackPlatform() {
  try {
    chrome.storage.local.get(PLAT_STORE_KEY, (o) => {
      // 超时兜底已经先画过一版了，不必再改一次（避免"先抖音又跳微信"的闪动）
      if (platInitDone) return;
      // 读失败时 o 是 undefined，直接落到默认平台
      applyPlatform((o && o[PLAT_STORE_KEY]) || DYC_PLATFORMS[0].id);
    });
  } catch (e) {
    if (!platInitDone) applyPlatform(DYC_PLATFORMS[0].id);
  }
}

(function initPlatform() {
  // 兜底：800ms 内没定下来就先按抖音画，绝不让主体一直隐身
  setTimeout(() => { if (!platInitDone) applyPlatform(DYC_PLATFORMS[0].id); }, 800);

  try {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const url = (tabs && tabs[0] && tabs[0].url) || '';
      const detected = dycDetectPlatform(url);
      if (detected) {
        applyPlatform(detected);
        rememberPlatform(detected);
        return;
      }
      fallbackPlatform();
    });
  } catch (e) {
    fallbackPlatform();
  }
})();

/* ---- 事件绑定(在渲染之后,对所有开关一视同仁)---- */

DYC_FLAGS_META.forEach((meta) => {
  const input = flagInputs[meta.key];
  if (!input) return;

  input.addEventListener('change', async () => {
    if (input._saving) return;
    const on = input.checked;
    const before = input._savedValue !== undefined ? input._savedValue : !on;
    input._saving = true;
    input.disabled = true;
    try {
      await dycWriteFlag(meta.key, on);
      input._savedValue = on;
      reportApplied(meta.pages, on);
    } catch (_) {
      input.checked = before;
      foldOpeners.forEach((entry) => { if (entry.key === meta.key) entry.setGate(before); });
      flash('设置未保存，已恢复原状态');
    } finally {
      input._saving = false;
      input.disabled = false;
    }
  });
});

// ---- 初始状态 ----
dycReadAllFlags().then((values) => {
  DYC_FLAGS_META.forEach((meta) => {
    const input = flagInputs[meta.key];
    if (!input) return;
    input.checked = values[meta.key] !== false;
    input._savedValue = input.checked;
  });
  // 初始**门控态**(2026-10-18 改口径):
  //   旧版这里是「开关开 ⇒ 展开且可用」,新规则只同步「可点 / 灰显 / 箭头」,
  //   **展开态一律保持收起** —— 用户要的「默认是没有展开」就在这里落实。
  // 必须在这里设、不能在装配行里设:input.checked 是上面那行才赋的,
  // 装配时拿到的是浏览器默认值。此处 values[o.key] 与 input.checked 同源同值,
  // 所以不会出现「开关显示开、名字却灰着点不动」的自相矛盾。
  foldOpeners.forEach((o) => {
    if (typeof o.setGate === 'function') o.setGate(values[o.key] !== false);
  });
});

/* ==========================================================
 * 二、更新区
 * ========================================================== */

// ---- 版本号 ----
// 同步获取。MV3 中回调式 getManifest 在 popup 里偶发不回调,
// 会导致版本号永远停在「加载中...」。
let localVersion = '未知';
try {
  localVersion = chrome.runtime.getManifest().version;
} catch (e) {
  localVersion = '未知';
}

const actionEl = document.getElementById('upd-action');
const statusEl = document.getElementById('upd-status');
const repoEl = document.getElementById('upd-repo');
const logEl = document.getElementById('upd-log');
const feedbackEl = document.getElementById('upd-feedback');
const rollbackEl = document.getElementById('upd-rollback');

document.getElementById('upd-ver').textContent = localVersion;

/* ---- 回退入口 ----
   更新完成后弹窗回到「已是最新」，更新页再也打不开，回退按钮等于消失
   （用户 2026-10-13 反馈）。所以回退入口常驻在这里：只要本地存有备份就显示，
   与「有没有新版本」彻底解耦。备份队列由 src/shared/backup-store.js 提供。 */
function openRollbackWindow() {
  const url = chrome.runtime.getURL('src/update/update.html') + '?mode=rollback';
  if (chrome.windows && chrome.windows.create) {
    // 与「安装更新」同理：目录授权框会抢焦点，popup 承受不住，必须用独立窗口
    chrome.windows.create({ url, type: 'popup', width: 520, height: 660, focused: true });
  } else {
    chrome.tabs.create({ url });
  }
  window.close();
}

if (rollbackEl) {
  rollbackEl.addEventListener('click', (e) => {
    e.preventDefault();
    openRollbackWindow();
  });

  DYC_BACKUP.list().then((list) => {
    if (list && list.length) {
      rollbackEl.hidden = false;
      rollbackEl.title = '打开版本回退，最近备份 v' + list[0].fromVersion
        + '（共 ' + list.length + ' 份备份）';
    }
  }).catch(() => { /* 读不到备份就不显示入口，不影响其他功能 */ });
}

const maskEl = document.getElementById('confirm-mask');
const confirmTextEl = document.getElementById('confirm-text');

// 'idle' = 显示「检查更新」;'checking' = 检查中;'install' = 显示「安装更新」
let mode = 'idle';
// 本次检查发现的可安装版本
let pendingVersion = '';
let pendingTag = '';

function setStatus(text, kind) {
  statusEl.textContent = text || '';
  statusEl.className = 'upd-status' + (kind ? ' ' + kind : '');
}

function renderAction() {
  if (mode === 'checking') {
    actionEl.textContent = '检查中...';
    actionEl.className = 'upd-action busy';
    return;
  }
  if (mode === 'install') {
    actionEl.textContent = '安装更新';
    actionEl.className = 'upd-action install';
    return;
  }
  actionEl.textContent = '检查更新';
  actionEl.className = 'upd-action';
}

/** 把 ISO 时间转成「x 分钟前」这类相对说法 */
function relTime(iso) {
  const t = Date.parse(iso);
  if (!isFinite(t)) return '';
  const diff = Date.now() - t;
  if (diff < 0) return '刚刚';
  const min = Math.floor(diff / 60000);
  if (min < 1) return '刚刚';
  if (min < 60) return min + ' 分钟前';
  const hour = Math.floor(min / 60);
  if (hour < 24) return hour + ' 小时前';
  return Math.floor(hour / 24) + ' 天前';
}

/** 根据后台返回的状态刷新整块 UI */
function applyState(st) {
  if (!st) st = {};

  // 后台结果可能因浏览器更新而滞后,这里再比对一次本地真实版本,
  // 避免显示一个其实已经装上的“新版本”。
  const newer = st.latestVersion
    && DYC_GITEE.compareVersion(st.latestVersion, localVersion) > 0;

  if (st.updateAvailable && newer) {
    mode = 'install';
    pendingVersion = st.latestVersion;
    pendingTag = st.latestTag || DYC_GITEE.versionToTag(st.latestVersion);
    renderAction();
    setStatus('发现新版本 ' + st.latestVersion, 'warn');
    return;
  }

  mode = 'idle';
  pendingVersion = '';
  pendingTag = '';
  renderAction();

  if (st.lastError) {
    setStatus('检查失败：' + st.lastError, 'err');
  } else if (st.checkedAt) {
    setStatus('已是最新版本 · ' + relTime(st.checkedAt) + '检查过', '');
  } else {
    setStatus('尚未检查过更新', '');
  }
}

/** 向后台要一次状态(不触发检查) */
function loadState() {
  chrome.runtime.sendMessage({ type: 'dyc:getState' }, (res) => {
    if (chrome.runtime.lastError || !res || !res.ok) {
      setStatus('无法连接后台服务', 'err');
      return;
    }
    applyState(res.state);
  });
}

/** 主动发起一次检查 */
function checkNow() {
  mode = 'checking';
  renderAction();
  setStatus('正在向 Gitee 查询最新版本...', '');

  chrome.runtime.sendMessage({ type: 'dyc:checkNow', force: true }, (res) => {
    if (chrome.runtime.lastError || !res || !res.ok) {
      mode = 'idle';
      renderAction();
      setStatus('检查失败：后台服务无响应', 'err');
      return;
    }
    applyState(res.state);
  });
}

/**
 * 弹出安装确认框。
 * `pendingVersion` / `pendingTag` 必须是**刚刚复查过**的那一份,
 * 否则用户可能装到比 Gitee 上现存最新版更旧的版本。
 *
 * fileCount 来自开窗前的清单预检(见 verifyThenConfirm),
 * 让用户在点确认之前就知道这回要动多少个文件。
 */
function openInstallConfirm(fileCount) {
  confirmTextEl.textContent =
    '将从 Gitee 更新到 v' + pendingVersion + '(当前 ' + localVersion + ')。'
    + (fileCount ? '共 ' + fileCount + ' 个文件,' : '')
    + '更新前会自动备份当前版本,出问题可在更新页一键回滚。';
  maskEl.hidden = false;
}

/**
 * 点「安装更新」时的动作:**先强制复查一次最新标签,再弹确认框**。
 *
 * 为什么必须复查:
 *   弹窗显示「安装更新」依据的是后台 state,而那次检查可能是几小时前做的
 *   (定期检查 6 小时一轮)。这期间 Gitee 上完全可能又发了几个新版本。
 *   若直接用旧的 pendingTag 去下载,用户装到的是**上次查到的那个版本**,
 *   而不是此刻的最新版 —— 用户 2026-10-11 明确提出并要求避免这种情况。
 *
 * 复查失败(网络抖动等)不阻断安装:沿用刚才查到的版本继续。
 */
function recheckThenConfirm() {
  const fallbackVersion = pendingVersion;

  mode = 'checking';
  renderAction();
  setStatus('正在确认最新版本...', '');

  chrome.runtime.sendMessage({ type: 'dyc:checkNow', force: true }, (res) => {
    if (!chrome.runtime.lastError && res && res.ok && res.state) {
      applyState(res.state);
    } else {
      // 复查没成功,退回原状态,别让用户卡住
      mode = 'install';
      renderAction();
      setStatus('发现新版本 ' + fallbackVersion, 'warn');
    }
    // 复查后仍处于可安装状态才继续(若已是最新,applyState 会切回 idle)
    if (mode === 'install') verifyThenConfirm();
  });
}

/**
 * 开窗前的最后一道检查:**这个标签真的有可安装的内容吗**。
 *
 * 为什么要多这一步(26.10.11.3):
 *   老流程是「确认后就开独立窗口」,而清单是在**窗口里**才去读的。
 *   若这个标签没有更新清单(本功能上线前发的老版本)、或仓库临时抽风,
 *   用户会看到一个窗口弹出来、然后里面报错 —— 白开一次窗,体验很差。
 *   提前在弹窗里读一次清单,把「有东西可装」变成开窗的前置条件。
 *
 * 预检失败不把状态打回 idle —— 保持「安装更新」可点,
 * 用户网络恢复后能直接重试,不需要重新走一遍检查。
 */
function verifyThenConfirm() {
  mode = 'checking';
  renderAction();
  setStatus('正在确认更新包...', '');

  DYC_GITEE.fetchUpdateManifest(pendingTag)
    .then((mf) => {
      mode = 'install';
      renderAction();
      setStatus('发现新版本 ' + pendingVersion, 'warn');
      openInstallConfirm(mf.files.length);
    })
    .catch((e) => {
      mode = 'install';
      renderAction();
      setStatus('这个版本暂时装不了：' + ((e && e.message) || e), 'err');
    });
}

// ---- 主按钮:文字随状态在「检查更新 / 安装更新」之间切换 ----
actionEl.addEventListener('click', (e) => {
  e.preventDefault();
  if (mode === 'checking') return;      // 检查中,忽略重复点击

  if (mode === 'install') {
    recheckThenConfirm();
    return;
  }

  checkNow();
});

// ---- 项目地址 ----
repoEl.addEventListener('click', (e) => {
  e.preventDefault();
  chrome.tabs.create({ url: DYC_GITEE.GH_WEB });
  window.close();
});

// ---- 更新日志（#106 · 2026-10-23 新增，2026-10-24 迭代改走浮层）----
// 不再开独立 changelog 小窗 —— 与「反馈」同一条注入链路：打开页面内浮层
// 并直接落在「更新日志」Tab；注入失败由后台兜底开独立小窗（同样带双 Tab）。
logEl.addEventListener('click', (e) => {
  e.preventDefault();
  chrome.runtime.sendMessage({ type: 'dyc:openFeedback', mode: 'changelog' });
  window.close();
});

// ---- 反馈入口:当前页面内右上角浮层(不开窗口不开标签页) ----
// 2026-10-12 用户定稿(B 修改版):反馈浮层只占页面右上角,不遮整页;
// 由 background 向活动标签页注入 src/feedback/panel.js(Shadow DOM 隔离)。
// 旧「独立小窗 + 失焦即关」方案有致命缺陷:第三方截图工具取屏时窗口失焦
// 被误判为「点了屏幕外」直接闪退(用户实测);页面内浮层无此问题。
// 注入失败(chrome:// 等特权页)时,后台会自动开一个独立小窗兜底。
feedbackEl.addEventListener('click', (e) => {
  e.preventDefault();
  chrome.runtime.sendMessage({ type: 'dyc:openFeedback' });
  window.close();
});

// ---- 确认框 ----
document.getElementById('confirm-cancel').addEventListener('click', () => {
  maskEl.hidden = true;
});

document.getElementById('confirm-ok').addEventListener('click', () => {
  maskEl.hidden = true;

  const url = chrome.runtime.getURL('src/update/update.html')
    + '?tag=' + encodeURIComponent(pendingTag)
    + '&version=' + encodeURIComponent(pendingVersion);

  // 用独立窗口跑更新:系统目录选择框会抢焦点,弹窗承受不住
  if (chrome.windows && chrome.windows.create) {
    chrome.windows.create({ url, type: 'popup', width: 520, height: 660, focused: true });
  } else {
    chrome.tabs.create({ url });
  }
  window.close();
});

// ---- 启动 ----
loadState();