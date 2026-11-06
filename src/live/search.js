/**
 * 中控台全能搜索 · 升级页面自带的商品搜索框
 * ============================================================
 *
 * 【2026-10-14 修「全能搜索时关闭浮动框再开启」】
 *
 *   用户报:全能搜索时,滚动到顶的时候浮动搜索框会关闭再开启(闪一下)。
 *   根因:`showResults()` 里**无条件**调 `expandPill()` —— 而 `expandPill()`
 *   每次都会先把胶囊缩成 52.8px 圆点、内容层透明,再从中心撑开到 576px。
 *   胶囊本来就已经展开时再调一次,观感就是「关闭再开启」;每次全能搜索完成
 *   都会重放一遍这个动画(扫描会把列表滚回顶部,所以现象看起来与「滚到顶」
 *   同时发生)。
 *   现改:胶囊已是展开态(`uiState === 'shown'`)→ 只确保可见、内容不透明,
 *   **不重放展开动画**;未展开(首次 / 收拢态 / 隐藏态)才走展开动画。
 *   证据:`.tmp/verify-pill-flicker.js` **8/8** —— 把 pill / fab 的
 *   display / width / opacity 变化记成时间线;「场景 5」是反向对照
 *   (胶囊未展开时发起搜索,必须照常播放 52.8 → 520 的展开动画)。
 *
 * 【2026-10-14 匹配范围收紧:只搜「商品名 + 价格」】
 *
 *   用户报「连库存量都能搜到」。根因两处（都在 `locate.js` 的 `getProductName`）：
 *     · 字段截断表只有 `¥|设置卖点|未设提词|到手价|售价|库存|ID`，且写成
 *       `if (cut > 0)` —— 库存写作「可售 / 剩余 / 销量」、或字段出现在行首时，
 *       字段值整段混进「名称」，数字因此可被搜到；
 *     · 末尾 `slice(0, 40)` 会在字母/数字串中间下刀，款号 `ccc1111a` 被切成
 *       `ccc1111` —— 搜完整款号反而搜不到。
 *   现在：字段分两组 —— **价格类**（到手价/售价/划线价/活动价/拼单价）无条件切；
 *   **数量·时间类**（库存/可售/剩余/现货/在售/已售/销量/佣金/服务费/时间字段）
 *   必须「字段词 + 数字」才算边界（避免误伤「现货 秒发 连衣裙」这类商品名）；
 *   行首字段段先整段剥掉；长度上限不在字母数字串中间下刀。
 *   词表与自测：`locate.js` 的 `NAME_*` 常量区 + `.tmp/verify-search-scope.js`
 *   （8 种真实行形态 × 「该命中 / 不该命中」双向断言）。
 *   ⚠️ 这仍是**黑名单**：平台新增字段时要往 `NAME_NUM_FIELDS` 补词，
 *      否则该字段的值会重新混进匹配范围。
 *
 *   ※ 同日追加修（用户报「我输入 0 的时候能搜到很多东西」）：
 *     价格原先与名称**拼成一串**登记（`raw = name + ' ' + price`），于是价格
 *     数字走的是「名称子串匹配」这条路 —— 搜「0」把所有价格含 0 的商品
 *     （¥136.00 / ¥100 / ¥0.00 …）全捞了出来。现改为：
 *       · 名称与价格**分开登记**：`text / ctext` 只放名称，价格只进 `ptext`；
 *       · 价格按**完整数字段**匹配（`priceHit`）：整数段 / 小数段 / 整价；
 *         搜「136」命中 ¥136.00，搜「0」不再命中它；
 *       · #100(2026-10-20):ptext 收行内**所有** ¥/$ 价格段（原只收第一个段
 *         —— 划线原价排在现价前面时,搜现价「95」永远不中）;段间用「|」
 *         隔开,保证折叠后数字段不粘连。
 *
 *   ※ #100 附（2026-10-20 用户拍板方案 B）：**卖点栏纳入搜索，独立成组**——
 *     匹配范围从「商品名 + 价格」扩为「商品名 + 卖点 + 价格」三组：
 *       · 卖点段由 `locate.js` 的 `getSellPoint` 切出（切段 = 第一个字段起点
 *         → 第一个价格符号，与 getProductName 共用 NAME_CUT_RE 词表）；
 *       · 占位词「设置卖点 / 未设提词」与按钮图标 ✎ 在切段侧剥除，**绝不
 *         成为命中原因**（用户 #100 原话拍板）；
 *       · 登记为 `sptext / spct`（普通/紧凑两版），匹配按**子串**（与名称
 *         口径一致，评审稿问 3 按推荐执行）；
 *       · 高亮按卖点区间涂色；定位校验 hitsKeywords 同源接入（三处口径
 *         不同源 = 搜得到、定位却说没中）；
 *       · 消息盒子不变：仍报商品名，卖点只参与「能不能被搜到」。
 *
 *   ※ #121（2026-10-26 用户定，**更正 #100 附的一处越界**）：**卖点搜索是
 *     「全能搜索」独占的能力，原生搜索一律不认卖点**——
 *       · 只删「原生搜索」这一侧的卖点入口：观察窗兜底 rowHits（原生搜索后按
 *         文本找命中行）不再切卖点段，原生高亮行的染色也传 `{ noSell: true }`
 *         （只涂名称 / 价格，不涂卖点）；
 *       · **全能搜索侧一字未动**：扫描登记（sptext / spct）、匹配三组、
 *         定位校验 hitsKeywords、命中行三段涂色，全部保留；
 *       · 为什么不能两边都认：原生搜索的匹配在平台侧（服务端过滤 + React
 *         状态），卖点不在它的索引里。扩展这一层若认卖点，用户在原生框里
 *         搜卖点词就会看到行被点亮、浮动框自动展开 —— 而平台一条结果都没给，
 *         属于「假命中」，比搜不到更坏。
 *       · 判据：原生搜索路径的 rowHits 只由 名称 + 价格 两组构成；
 *         `scripts/自测-全能搜索卖点段.js` ④ 断言为「不含卖点分支」。
 *
 *     ⚠️ 已知局限见 getSellPoint 注释（提词文本可能卷进卖点段，待探针收窄）。
 *       · 多关键词走 AND：每个词要么命中名称、要么命中价格的完整数字段。
 *     证据 `.tmp/verify-search-scope.js` **22/22**（含用户截图那一行的 13 条断言）。
 *
 * 【二十二轮:输入框原生 + 全能搜索独立按钮(2026-10-12 用户定)】
 *
 *   1. **输入框恢复原生**:撤销对平台输入框的全部改造 —— 不改 placeholder、
 *      不加内边距、不塞任何控件;回车放行给平台原生搜索(原速)。
 *      「清空」按钮整键移除。
 *      ★ 跑位描述永久保留(用户定:记录在案)★
 *        「清空」曾三轮修复错位仍反复跑位(用户 2026-10-12 截图:按钮压进
 *        输入框、placeholder 被截断)。根因:平台 React 受控布局下,
 *        往带边框容器里塞**绝对定位**按钮,包含块被平台 transform 祖先
 *        劫走,历次重校准算法追不上。教训:**不要往平台输入框容器里
 *        绝对定位塞按钮**,以后也不要再加回来。
 *   2. **【全能搜索】独立按钮**:白底 + 蓝放大镜(方案 C,2026-10-12 用户定),
 *      以**文档流兄弟节点**插在平台放大镜键右侧(不绝对定位,由平台 flex
 *      排版,元素平等右移,不存在错位);浮动胶囊里搜索键右侧同款。
 *      点击 = 全量扫描定位(款号片段 / 多关键词 / 价格,¥ 归一)。
 *   3. **搜索全走原生**:原生框回车 / 放大镜 = 平台原生搜索;
 *      胶囊回车 / 搜索键 = 转发平台原生搜索(原速);胶囊保留 ←→ 结果
 *      导航与 N/M 计数(插件展示层,不拖慢搜索)。
 *   4. **价格纳入全能搜索**:登记行文本 = 商品名 + 价格(从截断点抓 ¥ 段),
 *      输入侧把 ¥/千分位归一后可搜「39.9」。
 *   5. **两档模式**(flags.js 开关 omniSearch + dycOmnisearchMode,弹窗二级单选,
 *      默认「默认原生搜索」;2026-10-18 由三档收敛而来):
 *        · 默认原生搜索 —— 回车永远原生,全能只认按钮(默认);
 *        · 默认全能搜索 —— 回车直接全能。
 *      原第三档「事不过三」已按用户决定整档删除(结构性断路,详见
 *      「事不过三」已删除 注释块)。
 *
 * ============================================================
 *
 * 【以下为历史轮次记录】
 *
 * 【解决什么问题】(用户 2026-10-11 反馈)
 *
 *   中控台商品面板自带一个搜索框(placeholder「请输入商品名称或ID」),
 *   平台的原生搜索有两个硬伤:
 *
 *     1. 款号必须输全。款号是「英文+数字+英文」结构(如 NE1C0021W),
 *        只输前半段「NE1C0021」平台直接搜不到,无法定位;
 *     2. 不支持多关键词。想用「粉色 裙」两个词夹出
 *        「粉色蛋糕舒适裙 NE1C0021W」,平台只会把整串当一个词去查。
 *
 *   本脚本把页面**原有的这个框**原地升级成「全能搜索」:
 *
 *     · 连续匹配 —— 输入内容只要是商品行文本里**连续的一段**就命中,
 *       NE1C0021 能命中 NE1C0021W;
 *     · 多关键词 —— 空格分隔(兼容全角空格),每个词都命中**同一行**
 *       才算匹配(与语义,顺序无关);
 *     · 回车触发 —— 不点回车绝不搜索(用户定:免得浪费页面资源);
 *       输入框为空时回车不拦截,保留平台原行为(清空筛选);
 *     · 定位直达 —— 扫描时实测了「首行偏移 + 行距」,目标行的容器内偏移
 *       是精确已知的,命中后**一次滚到位**,等目标行渲染出来再逐级向外
 *       滚进浏览器视口 + 呼吸灯闪烁约 3 秒,全程不点击商品;
 *       地理数据失效时退回 locate.js 的 locateProduct 老路兜底,绝不瞎跳。
 *
 * 【为什么必须自己全量扫描】
 *
 *   商品列表是虚拟滚动(locate.js 实测:DOM 里恒只有可视区约 8 行),
 *   没渲染出来的行读不到文本。所以搜「款号片段」不能只看当前屏,
 *   必须把列表从头到尾滚一遍、边滚边登记每行文本。
 *
 *   序号怎么来(2026-10-18 改,原按行距反推)**不再由几何推算**,而是
 *   按行在容器里的先后顺序**实打实地数**:每屏把渲染出来的行按容器内偏移
 *   升序排,只认偏移严格大于上一行的,数到一个 +1。
 *   旧的「行序号 = round((行顶边偏移 − 首行偏移) / 行距) + 1」假定每行等高,
 *   而「商品名称不折叠」默认开启后行高并不相等 —— 反推出来的序号会撞号,
 *   撞号的行会被「按序号去重」静默丢弃,那几行就永远搜不到(#94)。
 *   新算法同时把每行的**精确偏移与行高**记下来,定位直接查表,不再推算。
 *   一次全量扫描约 2~5 秒(随商品数线性增长),只在回车后发生。
 *
 * 【怎么"升级原有的框"而不干扰平台】
 *
 *   · 在 document 上挂 **capture 阶段** keydown:平台自己的监听都挂在
 *     目标元素或冒泡阶段,capture 先行,preventDefault + stopPropagation
 *     能稳稳压住平台的回车搜索 —— 必须拦:平台搜「NE1C0021」会得到
 *     空结果并把列表清空,不拦的话我们没机会扫;
 *   · 只拦截「目标 = 平台搜索框」的回车,其余按键、其他输入框一律放行;
 *   · 输入框为空 / 列表容器不在 / 功能开关关闭 → 一律不拦截,平台原样;
 *   · placeholder 换成能力提示(款号/名称/多关键词,空格分隔),
 *     原文案备份在 data 属性里,开关关闭时原样还原;
 *   · 中文输入法组词中的回车(isComposing / keyCode 229)不拦截,
 *     否则拼音上屏会被吃掉。
 *
 * 【依赖与加载顺序】
 *
 *   复用 locate.js 的全局:getScrollContainer / getAllProductRows /
 *   getProductItems / locateProduct / waitFor / getProductName
 *   (2026-10-18 起取行一律走 getAllProductRows 的并集集合;
 *    measureRowSpacing 只剩「每步滚多远」一处用途),
 *   以及 dialog.js 的 setStatus(状态栏)。
 *   manifest 里排在 locate.js 之后、toolbar.js(入口层)之前,
 *   满足 check-manifest-order.py 的「功能层」约定。
 *
 * 【二轮优化(2026-10-11 用户实测反馈)】
 *
 *   1. 占位文案「款号/名称/多关键词搜索」(2026-10-25 改为
 *      「货号/商品名/价格/卖点，支持多关键词」,概括全能搜索的四个可搜项);
 *      平台输入框文字贴边框、
 *      右侧有放大镜,接管时补内边距(10px/28px),关开关还原原值;
 *   2. 字母大小写自由换算:首版就已忽略半角大小写,这轮补**全角→半角折叠**
 *      —— 输入法打出的「Ａ」「１」也能命中半角「a」「1」;
 *   3. 检索观感:扫描每步不再固定白等 120ms(改 30ms 快速轮询),
 *      步距加大到「一屏 - 半行」;命中后一次直达目标行,不再「回顶部重算再滚一遍」。
 *
 * 【三轮:底部结果导航条(2026-10-11 用户定)】
 *
 *   搜到结果后,页面底部浮一条白色工具条:
 *     [←] [→]   第X/共N   [搜索框(与平台框双向联动)] [清空]
 *   · ← → 循环切换结果,每按一次直达对应商品 + 呼吸灯;
 *   · 条内搜索框与平台搜索框实时互同步,任一处改词、回车即重搜;
 *   · 平台搜索框右侧统一加「清空」按钮,两个框都有。
 *
 * 【四轮:显隐跟随「回到顶部」临界值(2026-10-11 用户定)】
 *
 *   滚过临界值才展开、滚回临界值以内无论有没有内容都收纳。
 *   (五轮把临界值语义升级为「原生输入框是否滚出视口」,见下。)
 *
 * 【五轮:UI 重做 —— 正中下方搜索按钮 + 胶囊搜索框(2026-10-11 用户定)】
 *
 *   三/四轮的「底部导航条 + 右侧收纳小球」整体重做,新交互:
 *
 *   1. 实体搜索按钮(#dyc-search-fab)放在**页面正中下方**,
 *      设计与【回到顶部】完全一致、大小同步(回到顶部 2026-10-11 缩为
 *      52.8px,本按钮同款 52.8px;SVG 48px 渲染、44 画布设计稿等比):
 *      白底、1px 浅灰描边、柔和投影、半透明(45%)待命、
 *      悬停显形且外圈出现一根变速逆时针绕圈的黑色细线(2.6s 一循环,
 *      与 back-to-top.js 同一套 keyframes 参数)。
 *   2. 显隐口径:**原生输入框滚出视口**(rect.bottom < 0)就浮现,
 *      滚回来自动隐没;平台框找不到(改版/未接管)时退回旧的
 *      「滚过 300px 临界值」兜底,两条路都不会让按钮常驻挡视线。
 *   3. 点击按钮 → 搜索框**以按钮为形变起点从中心向左右两侧同时撑开**
 *      (52.8px 圆 → 400px 胶囊,0.3s;放大镜从圆心滑到左端,
 *      输入区延迟 0.12s 淡入);**点击屏幕外即收纳**,是同一形变的反放。
 *      收纳后内容不清空,重新展开还在。
 *   4. 胶囊内保留结果导航:[←][→] 第X/共N [输入框][清空],
 *      输入框与平台搜索框**双向实时同步**(任一处输入另一处一致,
 *      收纳/展开都不丢词);浮动框 placeholder 与平台框当前文案一致。
 *   5. 平台框「清空」按钮(用户 2026-10-12 再修:输入框错位):不再
 *      改变输入框宽度(加长会破坏平台 flex 布局,把整行挤歪 —— 截图里
 *      「全选」与输入框间距变大、筛选下拉被顶歪的根因),框宽原样保留;
 *      「清空」改为按**输入框右边缘**绝对定位,落在放大镜左侧,文字
 *      加大到 12px(用户定:清空键文字写大一些)。原宽度备份,关开关还原。
 *   6. 搜索状态**只走左下角状态条**(dialog.js setStatus),不再在
 *      搜索框旁弹「搜索中 N」徽标;浮动 UI 自身绝不引发容器滚动
 *      (展开/聚焦都 preventScroll;扫描滚动是虚拟列表读行的必需动作,
 *      与本条不冲突)。
 *   7. 15 秒闲置收纳规则废除(五轮口径:点屏幕外就收,规则简单直给)。
 *
 * 【六轮:显隐信号修正(2026-10-11 用户问出缩放漏洞)】
 *
 *   五轮的「原生框离屏才显示」在页面缩小(Ctrl -)后失效:整页放得下时
 *   原生框恒可见 → 按钮全程不出现。六轮改为三条信号任一命中即显示:
 *     主信号 = 商品列表滚过 300px(内容高度不随缩放变化,缩放无关);
 *     辅助   = 原生框离屏(保留用户原始口径);
 *     兜底   = 外层页面滚过 300px。
 *   列表回顶**且**原生框可见(两条主信号都不命中)才隐藏。
 *
 * 【七轮:与回到顶部显隐同源(2026-10-11 用户定「两个按钮出现时间一致」)】
 *
 *   六轮的三信号与回到顶部的「全容器最大 scrollTop > 300」口径接近但不
 *   完全相等(容器集合、判定时机不同),极端组合下会出现一先一后。
 *   七轮改为:back-to-top.js 把判定函数挂到 window.__dycBackTopIsBeyond,
 *   搜索按钮拿得到就**完全跟随**(同一份数据同一阈值,构造上严格同步);
 *   回到顶部关闭/脚本失效时函数被摘除,搜索按钮退回六轮自己的三条信号。
 *   这是**单向借用不是依赖**:回顶坏了搜索照常,搜索坏了回顶零感知(八轮补:
 *   函数调用抛错同样立即摘除降级,不会让按钮卡死在「不显示」)。
 *
 * 【十一轮:命中文字橙色标记(2026-10-11 用户定)】
 *
 *   「命中的那部分文字」本身变成橙色 —— 只染命中字符(搜中两个字就橙
 *   两个字),不再整名铺底色。实现:关键词在命中行的**纯文本叶子节点**里
 *   逐处定位(逐字符全角折叠+小写的保长折叠,索引一一对应),span 包裹命中段,
 *   命中段之外的文字原样;多个关键词/多处命中合并重叠区间。
 *   保持 **8 秒**后用 1 秒淡出回原文字颜色;改词立刻重搜/跳下一个命中/
 *   关开关时瞬间还原原文。商品列表是虚拟滚动,未渲染的行不存在,
 *   标记只落在当前定位行;名字节点找不到时静默放弃,不拖累主流程。
 *
 *   【组合规则(用户 2026-10-11 定)】多关键词时只染「凑得最近的一组」:
 *   最小覆盖窗(滑窗)选出能同时盖住全部关键词的最短区间,每个关键词取
 *   窗内第一个出现 —— 如搜「粉色 裙」命中「粉色多巴胺裙夏天必备裙」,
 *   只染「粉色+第一个裙」;窗口落在后半段则染「第二个粉色+裙」。
 *   严禁把每个关键词的所有出现全染(粉色裙裙全橙 = 页面污染)。
 *
 *   搜到商品后,定位那行的**商品名节点**挂一层淡橙底色
 *   (rgba(255,152,0,0.22),克制不刺眼);保持 5 秒后用 1 秒缓慢淡出到无色
 *   (用户定:防止误搜的橙底长驻页面造成阅读障碍)。
 *   跳下一个命中 / 立刻改词重搜:旧底**瞬间**撤掉,绝不干扰下一次搜索;
 *   开关关闭时同样立即撤干净。
 *   名字节点靠**行内文本匹配**找最深层包含商品名的节点 —— 平台类名是
 *   构建哈希不可靠,文本匹配才稳。商品列表是虚拟滚动,未渲染的行不存在,
 *   同一时刻最多只有一个标记,无遍历负担。
 *
 * 【十三轮:收尾无动效 + 胶囊布局调整 + 清空错位再修(2026-10-11 用户定)】
 *
 *   1. 胶囊收拢成按钮时**不再接上浮动效**:收拢动画到 52.8px 圆后,
 *      按钮原地直接就位(透明度/位移一步到位);滚动浮现的上浮动效保留。
 *   2. 删掉胶囊**左端**的放大镜装饰;**右端**新增一个可点击的搜索标志
 *      (与回车等效:把当前词发起搜索)。
 *   3. 原生框「清空」错位再修(用户截图:按钮压到筛选区):定位基准从
 *      「容器右缘」改为「输入框右缘」;接管后 600/1600ms 与窗口 resize
 *      时重校准。(2026-10-12 定稿:输入框不再加长,见【五轮】第 5 条。)
 *
 * 【十四轮:浮现阈值跟随行数 + 扫描遮罩 + 细节打磨(2026-10-11 用户定)】
 *
 *   1. 出现阈值改为「列表滚过第 6 行」:由回到顶部统一计算(实测行距×6,
 *      缩放/平台改版自适应),搜索按钮经同源信号跟随 —— 两个按钮同时出现;
 *      回顶不可用时的兜底仍为 300px。
 *   2. 搜索扫描期间给商品列表容器盖白色遮罩(观感=容器不滚动;虚拟列表
 *      必须滚动逐行读取,遮罩把这段运动挡住),进度文字在遮罩与左下角
 *      信息栏同步展示,扫完揭开直接落在命中行。
 *   3. 胶囊「清空」按钮与边框留出余量(inputWrap 右侧 4px → 10px)。
 *   4. 修复:搜索按钮悬停时的「解除透明+绕圈」失效 —— 浮现透明度由
 *      内联样式设置会压住 CSS hover,改为 hover 规则加 !important,
 *      且 .is-show 类随显隐挂摘。
 *   5. 滚动浮现的「从下往上 8px 淡入」动效保留;收纳衔接仍无动效。
 *
 * 【十五轮:动效统一 + 匹配范围收窄(2026-10-11 用户定)】
 *
 *   1. 搜索按钮补**下滑退场**:滚动隐没时 0.2s 淡出 + 8px 下滑(与回到
 *      顶部退场同款),动画结束后才 display:none;胶囊展开接管路径仍瞬时
 *      隐藏(形变衔接不能两个圆叠影);收拢衔接无动效的口径不变。
 *   2. 回到顶部的出/退场过渡曲线统一为同款 .2s ease-out(悬停显形、
 *      绕线环本就一致,两条命令的动效从此逐参数相同)。
 *   3. 匹配范围收窄为**只匹配商品名称**:扫描登记从整行 innerText 改为
 *      getProductName(截断 ¥/到手价/库存/设置卖点 之后的内容),
 *      搜价格/库存词不再误命中(用户:全能搜索的匹配范围错了)。
 *      ※ 本条后来被「二十二轮」放宽为「名称 + 价格」,再由 2026-10-14 的
 *        「匹配范围收紧」重新界定边界(库存/销量/时间仍一律不搜)——
 *        以文件头首段为准。
 *
 * 【十六轮:胶囊 UI 打磨 + 搜索收尾「关闭再开」修复(2026-10-12 用户定)】
 *
 *   1. 胶囊内 [←][→] 结果导航键加大:12px/3px 8px → 15px/5px 11px,
 *      更醒目易点;
 *   2. 右端搜索标志改**圆形框**(34px 圆边框),放大镜图案居中
 *      (SVG 16px + flex 居中,不再是无框裸图标);
 *   3. 修复:全能搜索收尾时胶囊/按钮「关闭再开」—— 根因是定位/还原
 *      刚滚动过列表,迟发的余波 scroll 事件让显隐信号翻转一次,而
 *      lastVisible 还是扫描前的旧值,必然判定「有变化」而动作。
 *      修法:收尾时把 lastVisible 对齐为当前真值,余波事件去抖命中
 *      不动作;用户随后的真实滚动照常翻转响应(机制干净,无定时器)。
 *
 * 【十七轮:平台框内控件组(2026-10-12 用户定)】
 *
 *   1. 平台输入框**适度加长 120px**(「加长一些些」),右边元素随 flex
 *      布局平等地往右挪;溢出容器时自适应回收(十三轮口径),不再重演
 *      上一轮硬加长的溢出错位;
 *   2. 输入框内部新增 [←][→] 结果导航键,**与浮动胶囊共用同一条
 *      cycleMatches 循环路径**(从 buildPill 提出),同步切换结果;
 *   3. 框内超简便计数「N/M」(当前结果/总数):有结果才显示、无结果
 *      隐藏不占位;胶囊计数与平台框计数由 updatePillCount 统一同步;
 *   4. 清空(胶囊或平台框任一处)= 结果态一并复位:计数隐藏、
 *      matches 清空,下次搜索重新计数。
 *
 * 【十八轮:消息盒文案带关键词 + 切换静默(2026-10-12 用户定)】
 *
 *   1. A2 发起:正在搜索「XXXX」……
 *   2. B2 进行:正在搜索「XXXX」,已扫 X%……(主文字与进度合成一句)
 *   3. C1 未搜到:没搜到「XXXX」,换个关键词试试
 *   4. D1 搜到:保持「匹配到第N个/共X个:商品名」不变;
 *   5. 关键词完整保留(shortKw)，盒子内自动换行;
 *   6. **切换静默**(用户反馈「每次点击都变成一条消息,很复杂」):
 *      ←→ 切换/同词回车轮跳不发消息盒(jumpToCursor(silent)),结果
 *      看框内 N/M 计数;只有搜索完成后的第一次定位才报一条。
 *
 * 【十九轮:框内控件撤销 + 胶囊自动展开(2026-10-12 用户定)】
 *
 *   1. 平台框**不加长**、框内不塞 ←→/计数(十七轮方案撤销)——
 *      平台布局零改动,只留「清空」;结果展示与跳转全交给浮动胶囊;
 *   2. **自动展开**:定位完成后的滚动位置若已达到浮动框浮现条件,
 *      直接展开胶囊并把光标切进输入框 —— 去到后排的结果不用再
 *      手点搜索按钮,顺手就能 [→] 跳下一条;没达到(前排结果)不变;
 *   3. 触发点覆盖两处:搜索完成的第一次定位(showResults 达条件即
 *      展开,原有)与 ←→/同词回车轮跳后的每次定位(succeed 补判)。
 *
 * 【二十轮:胶囊 sticky 状态机(2026-10-12 用户定稿)】
 *
 *   撤销「胶囊随滚动信号收起/浮现」的旧机制(「关闭再开」的源头),
 *   新规则全部由「点外部」裁决:
 *   1. 胶囊展开即钉住(sticky):列表怎么滚都不收,滚动跟随只管搜索按钮;
 *   2. 搜完出结果 → 光标自动切进胶囊输入框并展开;
 *   3. 点外部(含滚动列表;脚本扫描/定位滚动不算):搜索框空 → 立即
 *      收缩成按钮待命;有词 → 启动 15 秒无操作计时,到点自动收缩;
 *   4. 计时期间胶囊内任何操作(输入/点←→/清空/搜索标志)都重置计时,
 *      一直开着,直到下一次点外部才重新裁决;
 *   5. 收缩后 = 正中下方搜索按钮待命(入口不丢,用户选 A)。
 *
 * 【二十一轮:显隐口径统一「回顶顶部认定」,机制彻底解耦(2026-10-12 用户定)】
 *
 *   1. 搜索按钮与【回到顶部】改用**同一套「顶部认定」语义**:
 *      锚点 .container-e6f75f 顶边落在「视口顶下方 1H(自身高度)」线
 *      之上 = 已滚过页顶 = 显示;回顶执行完恰落在线上,不显示,口径天然一致;
 *   2. 兜底链与回顶的回顶兜底链一致:锚点未渲染/找不到 → 导航头口径
 *      (顶边过 nav-menu 让出线)→ 全部归零口径(scrollTop > 300);
 *   3. **机制彻底解耦**:删除 window.__dycBackTopIsBeyond 共享信号,
 *      两边各自独立实现同一套判定(用户定「免得一个错全部错,
 *      可以复制学习独立使用」)—— 一边坏了另一边照常工作。
 *
 * 【已知边界(如实记录,不掩盖)】
 *
 *   · 行识别与序号定位共用 locate.js 的语义特征(PRODUCT_HINTS)。
 *     若「购物车」标签页的行结构与商品列表差异过大导致识别不到,
 *     搜索会如实报「未识别到商品列表」,不会乱跳;
 *   · 页面上若同时存在多个「请输入商品名称或ID」输入框(如弹层里也有),
 *     拦截的是当前聚焦的那个,扫描的是页面上占主导的商品列表。
 * ============================================================
 */

(function dycLiveSearch() {
  'use strict';

  if (window.__DYC_LIVE_SEARCH_INITIALIZED__) return;
  window.__DYC_LIVE_SEARCH_INITIALIZED__ = true;

  // ---------------- 常量 ----------------

  // 平台搜索框的识别特征:placeholder 含「商品名称」即可。
  // 用「包含」而不是全等「请输入商品名称或ID」—— 平台微调文案时不容易失效。
  const PH_HINT = '商品名称';
  // 二十二轮:输入框恢复原生 —— 不再改写 placeholder、不加内边距,
  // 接管只剩「全能搜索」按钮插入与两框联动;PH_OURS 仅用于胶囊输入框提示。
  const PH_OURS = '货号/商品名/价格/卖点，支持多关键词';
  /* 悬浮圆钮的名字(2026-10-29 反馈 #125)。
   * 沿革:#121(10-26)曾把三处悬停说明统一成 PH_OURS 这一句能力描述;
   * 用户看到圆钮后要求「提示语应为【全能搜索】」—— 圆钮是**打开搜索的入口**,
   * 不是输入框,拿一句能力描述当它的名字,用户认不出这是干什么的。
   * 所以只给圆钮一个功能名:aria-label 与悬停气泡都用它。
   * 胶囊 placeholder 与两个按钮的 title 保持 PH_OURS 不动(那是输入框语境)。
   * ⚠️ 副作用要说清:三个入口的悬停说明从此不再逐字相同 —— 用户已知并选择此口径。 */
  const FAB_LABEL = '全能搜索';
  // 原 placeholder 的备份属性 / 已接管标记(padding/宽度备份已随原生恢复撤销)
  const ATTR_ORIG_PH = 'data-dyc-orig-ph';
  const ATTR_OURS = 'data-dyc-search';
  // 五轮 UI 尺寸(与 back-to-top.js 的 52.8px 同步;它再改只改这里一组)
  const BTN_SIZE = '52.8px';     // 按钮直径 / 胶囊收拢态
  // 二十二轮:胶囊加宽 400 → 470(从中心向左右撑开),容纳「全能搜索」按钮
  // 2026-10-13:再增 50px → 520，让输入框有足够空间展示完整提示文字
  // 2026-10-25:再增 40px → 560(用户「两边各加一丢丢」),配合内层左右
  //            内边距统一到 20px,让「全能搜索」按钮离右边框不再贴脸
  // 2026-10-25 二次:再增 40px → 600 —— 占位文案换成
  //            「货号/商品名/价格/卖点，支持多关键词」(19 字),字号 12 → 11.5px
  // 2026-10-25 三次(用户定「往正中心缩短,字放大,刚好不挡字即可」):
  //            600 → 576,字号 11.5 → 12px。实测口径(无头 chromium,微软雅黑):
  //              · 固定占位 = 胶囊宽 − 输入区宽 = 363px(左右内边距 40 + 导航键 30×2
  //                + 计数 40 + 5 处间隙 30 + 搜索键 34 + 全能搜索 ≈90 + 清空 41
  //                + 输入框内边距 22 + 边框 2)
  //              · placeholder 12px 实测宽 ≈202px ⇒ 最短可用 = 202 + 363 = 565px,
  //                取 576 留 11px 余量(换字体/缩放也不会把末尾「关键词」切掉)
  const PILL_W = '576px';        // 胶囊展开态宽度
  const PILL_R = '26.4px';       // 胶囊圆角(= 直径一半,收拢时恰为正圆)
  // 二十二轮:两档全能搜索模式(2026-10-18 三档改两档)
  //   'none'   默认原生搜索 —— 回车走平台原生,全能只认按钮(缺省)
  //   'always' 默认全能搜索 —— 回车直接走全能扫描
  // 原第三档 'trial3'(事不过三)已按用户决定整体删除,见下方「已删除」注释块。
  const OMNI_MODE_KEY = 'dycOmnisearchMode';
  const OMNI_MODES = ['none', 'always'];

  // ---- 平台自带「搜索结果导航」按钮(2026-10-14 真机实测,用户定) ----
  // 平台在**原生搜索出结果后**,于搜索框右侧渲染一对箭头 [←][→]:
  //   <span class="optLeft-bdc6f6 optIcon-bdc6f6 [disabled-bdc6f6]"></span>
  //   <span class="optRight-bdc6f6 optIcon-bdc6f6"></span>
  // 后缀 `bdc6f6` 是平台构建 hash(**会随平台发版变**)⇒ 一律**前缀匹配**,
  // 禁写死全名(这是本项目踩过多次的坑:平台类名 hash 一变,选择器就全失效)。
  // 禁用态由平台自己加 `disabled-` 类(已在第一个/最后一个结果时)——
  // 扩展不自己算边界,读它的类即可。
  const NAV_L_SEL = '[class*="optLeft-"]';
  const NAV_R_SEL = '[class*="optRight-"]';
  // 平台给「当前命中的商品行」加的高亮类(真机实测那一行是:
  //   goodsItem-d7a4a8 rpa_lc__live-goods__goods-item highlight-d7a4a8 rpa_lc__live-goods__goods-item_hl)
  // ⇒ 扩展**不需要自建结果集**,点箭头后平台自己滚、自己加这个类,
  //   我们只读它、给它染色(见 paintNativeResult)。
  const NAV_ROW_HL_SEL = '[class*="goods-item_hl"]';

  // ---------------- 运行状态 ----------------

  const state = {
    flags: null,        // 功能开关(异步读入;读入前不拦截)
    busy: false,        // 正在全量扫描,期间的回车只拦不响应
    lastRaw: null,      // 上一次搜索的原文(同词再按回车 = 跳下一个)
    matches: [],        // 上一次搜索命中的行序号(升序)
    cursor: 0,          // 当前定位在 matches 里的下标
    geo: null,          // 最近一次扫描测得的 {scroller, baseTop, spacing},直达定位用
    // ★ 2026-10-18:扫描结果整份留着（[{ordinal,text,ctext,ptext,offset,height}]）。
    //   定位时靠它「按名称认行」—— 名称比几何稳，折行改不动它。
    rows: null,
    scanInput: null,    // 发起本次扫描的搜索框元素
    platformInput: null,// 已接管的平台搜索框(联动/全能按钮插入的目标)
    nameMarkHoldMs: 15000, // 命中标记保持时长(2026-10-12 用户定:15s 才开始消失)
    nameMarkFadeMs: 1000,  // 标记淡出时长
    omniMode: 'none',   // 回车档位(异步读 storage;读入前按「默认原生搜索」)
    // 2026-10-14:最近一次**原生搜索**的词。非空 = 当前结果来自原生搜索 ⇒
    //   ① 回车跳下一个结果(接平台箭头);② 浮动框 [←][→] 转发平台箭头。
    // 改词 / 转全能 / 清空时置空(见各调用点)。
    nativeRaw: null,
  };

  /* ---- 「事不过三」已删除(2026-10-18 用户定) ----
   *
   * 用户原话:「#93 不修复了,放弃修复」「事不过三这个功能删掉」。
   * 原实现(trial3 档)在这条链上有**三层串联断路**,修不如删:
   *   ① noResult / singleRepeats / emptyCycles 三个计数器只在「全能扫描完成」
   *      回调里自增,而 trial3 档下回车是放行给平台的 ⇒ 计数器恒为 0;
   *   ② omniTrial.key 同样只在 runSearch 里赋值(且被 !omniTriggered 跳过)
   *      ⇒ 轮跳计数入口第一句 `key !== raw` 必然 return;
   *   ③ 回车入口的外层守卫读 state.lastRaw / state.matches,两者也只在
   *      runSearch 里写 ⇒ trial3 整块函数体在旧代码里**根本不可达**。
   * 删除范围:omniTrial / omniCycleBase / omniTrialShouldFire /
   *   omniTrialOnRepeatEnter 四个符号、runSearch 收尾的两段计数块、
   *   keydown 里的 trial3 分支、弹窗里的第三档单选、flags.js 的白名单值。
   * 旧存档里的 'trial3' 不需要迁移脚本:OMNI_MODES 白名单(上方)会把它
   * 判为非法并回落成 'none',恰好就是新的默认值「默认原生搜索」。
   */

  // 五轮 UI 的状态(胶囊 + 正中下方按钮)
  let pill = null;          // {root, inner, lens, prevBtn, nextBtn, countEl, input, clearBtn}
  let uiState = 'hidden';   // hidden(什么都没有) | docked(按钮待命) | shown(胶囊展开)

  /* ★ 2026-10-18 修「页面还没进去，浮动按钮就常驻显示」（用户报的 bug）：
   *
   *   现象：中控台刚打开、商品列表还在骨架屏 / 白屏阶段，正中下方的搜索圆钮
   *         就已经浮在那儿了。等真正进到列表，它又按「第 4 行是否露出」重新
   *         显隐 —— 前半段那一下属于「什么都没准备好就先露脸」。
   *
   *   根因两处，缺一不可：
   *     ① fabShouldShow() 是 **fail-open**：`fabRowGeo()` 量不到几何
   *        （列表还没渲染 ⇒ getScrollContainer 返回 null）时直接 `return true`。
   *        这个默认值本身是对的 —— 它要防的是「页面结构变了导致功能消失」，
   *        但不能连「页面还没准备好」也一并算进去。
   *     ② 判定只发生在**启动那一刻**与**滚动时**。页面加载期往往一次 scroll
   *        都没有，于是「启动时错判为 true」这个结果一直挂到用户第一次滚动
   *        或列表渲染完触发滚动为止。
   *
   *   修法：把「列表是否就绪」单独拎出来判断，就绪前一律不显示，
   *        并且补一条低频轮询专门负责「从不就绪 → 就绪」这一次转变的重新判定。
   *        （不挂 MutationObserver：中控台 DOM 每秒都在变，观察者反而是负担；
   *          轮询只在未就绪期间存在，就绪即停。）
   */
  let readyTimer = null;      // 未就绪期间的轮询句柄
  let readyTries = 0;         // 轮询次数上限（防永久轮询）
  const READY_MAX_TRIES = 200;   // × 250ms ≈ 50 秒
  // 【全能搜索】按钮的兜底自愈句柄（2026-10-19 修 #97，见 startOmniGuard）。
  // 声明放在这里而不是使用处：下面开关监听是异步回调，但把它提到变量区
  // 可以彻底不依赖「谁先执行」，也方便 destroySearchUi 统一停机。
  let omniGuardTimer = null;
  const OMNI_GUARD_MS = 2000;

  /**
   * 等列表就绪：就绪那一刻重判一次显隐，然后停。
   *
   * 为什么必须有它：显隐只在「启动」与「scroll」两个时机算。而页面加载期一次
   * scroll 都没有 —— 启动时判「不就绪」把按钮藏了，如果没人再判一次，
   * 列表渲染完了按钮也不会自己出来，要等用户滚一下。那等于把 bug 换成另一个 bug。
   *
   * 上限 50 秒：中控台万一是别的页面（罗盘直播大屏等，manifest 不注入这里，
   * 但保险），不可能响应到「一直不就绪」时还占着一个 250ms 定时器。
   * 真到上限就静默放弃 —— 之后用户一滚动仍会重判，不会永久失效。
   */
  function waitListReady() {
    if (readyTimer) return;
    readyTries = 0;
    (function tick() {
      readyTimer = null;
      if (!enabled()) return;               // 模块被关掉就不再轮询
      if (listReady()) {
        readyTries = 0;
        syncFabVisibility();                // 就绪这一刻重判一次（这是关键）
        return;
      }
      if (++readyTries >= READY_MAX_TRIES) { readyTries = 0; return; }
      readyTimer = setTimeout(tick, 250);
    })();
  }

  function stopListReadyWatch() {
    if (readyTimer) { clearTimeout(readyTimer); readyTimer = null; }
    readyTries = 0;
  }

  /**
   * 商品列表是否已经渲染出来（能拿到滚动容器、且里面真有行）。
   *
   * 判据刻意用「有行」而不是「容器存在」：中控台骨架屏阶段容器往往已经在了
   * （空壳、scrollHeight 很小），此时算就绪会把按钮提前放出来 —— 那正是用户报的现象。
   * 所以必须落到「真的读到商品行」这一层。
   *
   * ⚠️ 不传 fresh：本判定每 250ms 才问一次，吃 250ms 缓存正合适；
   *    传 fresh 会把 80ms 下限也绕掉，反而给页面加负担。
   */
  function listReady() {
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
  // 【历史,2026-10-14 已删】2026-10-11 曾用一个 searchMode 标志表达「搜索期间
  // 胶囊与按钮不随显隐信号收起」(理由是搜索时列表会瞬间跳回顶部,显隐信号必然
  // 短暂变「隐藏」)。但它**只被赋值、从未被任何地方读取** —— 这层保护从未生效,
  // 正是「搜索中滚过某位置胶囊直接消失」的成因之一。现该语义由「胶囊展开即锁定」
  // 承担(见 syncFabVisibility),死标志已删除。
  let fabEl = null;         // 正中下方的实体搜索按钮
  let onWinResize = null;   // DPR 缩放补偿监听
  let animTimer = null;     // 收拢动画的收尾定时器
  let onDocScroll = null;   // 滚动跟随监听(显隐跟随原生输入框是否在视口)
  // 显隐真值缓存:搜索收尾 / 结果展开时对齐一次,吞掉脚本滚动的迟发余波,
  // 防「关掉再开」。2026-10-13 改几何判据后不再参与去抖,仅被 showResults
  // 读取,用于决定「直接展开胶囊还是保持收纳」。
  let lastVisible = null;

  // ---- 二十轮:胶囊 sticky 状态机(2026-10-12 用户定稿) ----
  //
  // 撤销「胶囊随滚动信号收起/浮现」的旧机制(「关闭再开」的源头):
  // 胶囊一旦展开就钉住(sticky),列表怎么滚都不收;收起只由
  // 「点外部」裁决 —— 空框立即收,有词 15 秒无操作才收,收成按钮待命。
  // 搜索按钮(入口)的浮现仍由滚动信号管理,职责分离。
  const IDLE_COLLAPSE_MS = 15000;   // 有词点外部后,无操作自动收缩时限
  let idleTimer = null;      // 15 秒无操作收缩定时器(有词点外部后才启动)
  let scriptScrollAt = 0;    // 最近一次脚本滚动的时间戳(区分用户滚动)
  // ★ 给 scriptScrollAt 打点的每一处,都同步写 window.__dycScriptScrollAt
  //   (连等赋值)—— auto-refresh.js 的「滚动中藏灯」靠这个全局信号豁免
  //   程序化滚动(2026-10-21 修「全能搜索时指示灯一直闪」)。
  //   漏打点 = 全能搜索扫描/定位期间灯又开始闪。

  // ---- 命中「背景笔」标记(2026-10-12 用户定:不要只染名字文字色) ----
  // 荧光笔样式:背景色块划过命中的那几个字,文字保持深色可读。
  // MARK_STYLE 用户选 = 乙方案(淡橙,2026-10-12 从对比页定稿)。
  const MARK_STYLE = 'orange';   // 'yellow' 荧光黄 | 'orange' 淡橙 | 'underline' 下缘划线
  const MARK_BG = {
    yellow:   '#FCE38A',
    orange:   '#FFD8B0',
    underline: 'transparent',
  };
  let nameMarked = null;   // { nodes:[{node, origText, origClass}], tFade, tCleanup }

  function ensureNameMarkStyle() {
    if (document.getElementById('dyc-name-mark-style')) return;
    const styleText = (function () {
      if (MARK_STYLE === 'yellow' || MARK_STYLE === 'orange') {
        const bg = MARK_BG[MARK_STYLE];
        return [
          '.dyc-mk { background: ' + bg + '; border-radius: 3px; padding: 1px 2px;'
            + ' margin: -1px -2px; box-decoration-break: clone;'
            + ' -webkit-box-decoration-break: clone; }',
          '.dyc-mark-fade .dyc-mk { background: transparent; transition: background '
            + ((state.nameMarkFadeMs || 1000) / 1000) + 's ease; }'
        ];
      }
      // underline:背景笔只划下缘(高度约 40%),像真笔划过下侧
      return [
        '.dyc-mk { position: relative; }',
        '.dyc-mk::before { content: ""; position: absolute; left: -1px; right: -1px;'
          + ' bottom: 0; height: 40%; background: ' + MARK_BG.orange + ';'
          + ' border-radius: 2px; z-index: -1; }',
        '.dyc-mark-fade .dyc-mk::before { opacity: 0; transition: opacity '
          + ((state.nameMarkFadeMs || 1000) / 1000) + 's ease; }'
      ];
    })();
    const st = document.createElement('style');
    st.id = 'dyc-name-mark-style';
    st.textContent = styleText.join('\n');
    (document.head || document.documentElement).appendChild(st);
  }

  function escHtml(t) {
    return String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  /**
   * 立即撤掉橙色标记(新搜索/跳下一个/关开关时调用):
   * 作废未执行的淡出定时器,把每个被改写的节点还原成原文(摘掉 span)、
   * 类名还原 —— 用户定:改词重搜时上一次的颜色必须瞬间消失。
   */
  function clearNameMark() {
    if (nameMarked) {
      if (nameMarked.tFade) clearTimeout(nameMarked.tFade);
      if (nameMarked.tCleanup) clearTimeout(nameMarked.tCleanup);
      for (let i = 0; i < nameMarked.nodes.length; i++) {
        const p = nameMarked.nodes[i];
        if (p.node && p.node.isConnected) {
          try {
            p.node.textContent = p.origText;
            p.node.className = p.origClass || '';
          } catch (e) { /* 尽力而为 */ }
        }
      }
    }
    nameMarked = null;
  }

  /**
   * 把命中行里「命中的那几个字」染成橙色。
   * 找法:遍历行内**纯文本叶子节点**(children 为空,textContent 即全部内容),
   * 用保长折叠(逐字符全角折叠+小写,长度不变、索引一一对应)定位每个
   * 关键词的全部出现区间,合并重叠后用 span 包裹命中段,其余文字原样;
   * 最后用 textContent 还原即可完全摘除(叶子节点原本就是纯文本,无损)。
   * 行名节点找不到 / 关键词没出现在某叶子 → 该叶子跳过,不影响主流程。
   */
  function markNameOnRow(rowEl, opts) {
    /**
     * opts.noSell = 只涂「名称段 + 价格段」,跳过卖点段。
     * 原生搜索路径（平台高亮行 / 观察窗兜底行）一律传它 —— 卖点搜索是
     * **全能搜索独占**（2026-10-26 #121 用户定）,原生搜索既不该「搜得到」
     * 卖点,也不该把卖点里的词染色,否则看着像还在认卖点。
     * 不传 = 全能搜索,名称 / 卖点 / 价格三段照常涂。
     */
    const allowSell = !(opts && opts.noSell);
    clearNameMark();
    try {
      if (!rowEl || typeof rowEl.querySelectorAll !== 'function') return;
      const keywords = state.keywords || [];
      if (!keywords.length) return;
      ensureNameMarkStyle();
      // 2026-10-14:标记范围收窄为**名称段 / 价格段**,不再扫整行所有叶子。
      // ⚠️ 判据不能只看「叶子文本」—— 佣金率 `0%` 的叶子文本就是「0」,而名称里
      //    也有 0,单看文本分不出是哪一个(用户三报:搜 0 时佣金率被标了)。
      //    所以按**文档顺序累积叶子文本**、算出名称段在累积串里的区间,
      //    只标「与名称区间有重叠」的叶子(或价格叶子)。
      const rowText = (typeof rowEl.innerText === 'string') ? rowEl.innerText : '';
      const nameFlat = foldWidth(getProductName(rowEl, rowText)).replace(/\s+/g, '').toLowerCase();
      // #100(2026-10-20):价格叶子判定改为「多段集合」—— 行内所有 ¥/$ 段都算
      // 价格叶子(原实现只认第一个段,划线价排在现价前面时,现价叶子永远标不上色)。
      const priceFlats = priceAllFromText(rowText).map(foldPrice);
      const leaves = rowEl.querySelectorAll('*');
      const items = [];
      let acc = '';
      for (let i = 0; i < leaves.length; i++) {
        const n = leaves[i];
        if ((n.children && n.children.length) || !n.textContent) continue;
        const raw = String(n.textContent);
        const folded = foldWidth(raw).toLowerCase();
        const flat = folded.replace(/\s+/g, '');
        items.push({ n: n, raw: raw, folded: folded, flat: flat, start: acc.length });
        acc += flat;
      }
      // 名称段在累积串里的区间(名称段会剥掉「【高奢女装】」这类营销前缀,
      // 也可能保留尾部「 ID」标签 —— 用「去前缀后的核心」去定位即可)
      const nameCore = nameFlat.replace(/^【[^】]*】/, '');
      const nStart = nameCore ? acc.indexOf(nameCore) : -1;
      const nEnd = nStart < 0 ? -1 : nStart + nameCore.length;
      // #100 附(2026-10-20):卖点段在累积串里的区间 —— 与名称区间同路数。
      // 卖点文本可能被平台拆成多个叶子(逗号分句/样式 span),按「折叠后子串
      // 定位 + 区间重叠」判定;定位落空(拆散顺序异常)时只是卖点不涂色,
      // 不影响命中(匹配侧另有 sptext 兜底)。
      const sellFlat = allowSell
        ? foldWidth(getSellPoint(rowEl, rowText) || '').replace(/\s+/g, '').toLowerCase()
        : '';
      let sStart = -1, sEnd = -1;
      if (sellFlat) {
        sStart = acc.indexOf(sellFlat);
        if (sStart >= 0) sEnd = sStart + sellFlat.length;
      }
      const painted = [];
      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        const n = it.n, raw = it.raw, folded = it.folded;
        const itEnd = it.start + it.flat.length;
        // 与名称/卖点区间**有重叠** → 名称/卖点叶子;否则看它是不是价格叶子。
        // ⚠️ 名称区间算不出来(异常 / 测试沙箱的简化 DOM)→ 不设限,退回旧行为,
        //    避免把标记整块砍掉。
        const inName = nStart >= 0 && it.start < nEnd && itEnd > nStart;
        const inSell = sStart >= 0 && it.start < sEnd && itEnd > sStart;
        const isPriceLeaf = priceFlats.length > 0 && priceFlats.indexOf(foldPrice(raw)) !== -1;
        if (nStart >= 0 && !inName && !inSell && !isPriceLeaf) continue;
        // 每个关键词在本叶子里的全部出现位置
        const lists = [];
        let present = 0;
        for (let k = 0; k < keywords.length; k++) {
          const kw = keywords[k];
          const arr = [];
          // 与匹配口径一致:价格叶子按价格规则(纯数字只认完整数字段 —— ¥196.00
          // 里的单个 0 不标),名称叶子按子串(款号 10157 里的 0 照标)。
          if (kw) {
            const okHere = isPriceLeaf
              ? priceHit(folded, foldPrice(kw))
              : (folded.indexOf(kw) !== -1);
            if (okHere) {
              let idx = folded.indexOf(kw);
              while (idx > -1) {
                arr.push([idx, idx + kw.length]);
                idx = folded.indexOf(kw, idx + kw.length);
              }
            }
          }
          if (arr.length) present++;
          lists.push(arr);
        }
        if (!present) continue;
        // 最小覆盖窗(组合规则):所有出现按起点排序滑窗,盖住全部出现过的
        // 关键词的最短区间 = 「凑得最近的一组命中」;窗内每个关键词取第一个
        const events = [];
        for (let k = 0; k < lists.length; k++) {
          for (let j = 0; j < lists[k].length; j++) {
            events.push({ start: lists[k][j][0], end: lists[k][j][1], k: k });
          }
        }
        events.sort(function (a, b) { return a.start - b.start; });
        const inCnt = {};
        let covered = 0, need = 0, bestL = -1, bestR = -1, head = 0;
        for (let k = 0; k < lists.length; k++) {
          if (lists[k].length) need++;
        }
        for (let tail = 0; tail < events.length; tail++) {
          const e = events[tail];
          inCnt[e.k] = (inCnt[e.k] || 0) + 1;
          if (inCnt[e.k] === 1) covered++;
          while (covered === need) {
            const h = events[head];
            if (bestL === -1 || (e.end - h.start) < (bestR - bestL)) {
              bestL = h.start;
              bestR = e.end;
            }
            inCnt[h.k]--;
            if (inCnt[h.k] === 0) covered--;
            head++;
          }
        }
        if (bestL === -1) continue;
        const chosen = [];
        for (let k = 0; k < lists.length; k++) {
          for (let j = 0; j < lists[k].length; j++) {
            const r = lists[k][j];
            if (r[0] >= bestL && r[1] <= bestR) { chosen.push(r); break; }
          }
        }
        chosen.sort(function (a, b) { return a[0] - b[0]; });
        const merged = [];
        for (let r = 0; r < chosen.length; r++) {
          const lastM = merged[merged.length - 1];
          if (lastM && chosen[r][0] <= lastM[1]) {
            if (chosen[r][1] > lastM[1]) lastM[1] = chosen[r][1];
          } else {
            merged.push([chosen[r][0], chosen[r][1]]);
          }
        }
        if (!merged.length) continue;
        const origClass = n.className || '';
        let html = '';
        let pos = 0;
        for (let m = 0; m < merged.length; m++) {
          if (merged[m][0] > pos) html += escHtml(raw.slice(pos, merged[m][0]));
          html += '<span class="dyc-mk">' + escHtml(raw.slice(merged[m][0], merged[m][1])) + '</span>';
          pos = merged[m][1];
        }
        if (pos < raw.length) html += escHtml(raw.slice(pos));
        n.innerHTML = html;
        n.className = origClass ? origClass + ' dyc-mark-on' : 'dyc-mark-on';
        painted.push({ node: n, origText: raw, origClass: origClass });
      }
      if (!painted.length) return;
      nameMarked = { nodes: painted, tFade: null, tCleanup: null };
      // 消失节奏(2026-10-12 用户定):保持 15s → 1s 淡出。时序在 state 里,自测可缩短。
      const hold = state.nameMarkHoldMs || 15000;
      nameMarked.tFade = setTimeout(function () {
        if (!nameMarked) return;
        for (let i = 0; i < nameMarked.nodes.length; i++) {
          const p = nameMarked.nodes[i];
          if (p.node && p.node.isConnected) {
            try { p.node.className = (p.node.className || '') + ' dyc-mark-fade'; } catch (e) {}
          }
        }
      }, hold);
      nameMarked.tCleanup = setTimeout(function () {
        if (!nameMarked) return;
        for (let i = 0; i < nameMarked.nodes.length; i++) {
          const p = nameMarked.nodes[i];
          if (p.node && p.node.isConnected) {
            try {
              p.node.textContent = p.origText;
              p.node.className = p.origClass || '';
            } catch (e) { /* 尽力而为 */ }
          }
        }
        nameMarked = null;
      }, hold + (state.nameMarkFadeMs || 1000) + 50);
    } catch (e) { /* 标记失败不影响定位主流程 */ }
  }

  // ---------------- 功能开关 ----------------

  function enabled() {
    return !!state.flags && state.flags.liveSearch !== false;
  }

  // 全能搜索独立开关(二十二轮):控制【全能搜索】按钮显隐与回车档位。
  // liveSearch 关 = 整个搜索模块停用(按钮自然也没有);
  // omniSearch 关 = 按钮消失、档位不生效、回车永远原生。
  function omniEnabled() {
    return enabled() && !!state.flags && state.flags.omniSearch !== false;
  }

  if (typeof dycReadFlags === 'function') {
    dycReadFlags().then(function (f) { state.flags = f; });
  }
  /**
   * 档位 → 人话。**必须声明在下面的订阅回调之前** ——
   * 刚在 scanAllRows 里吃过一次 TDZ 的亏(见那边的注释),这里不赌
   * 「回调是否同步触发」:凡回调里要用的 const,一律写在注册监听之前。
   * 值只写档位名,功能名由 source 承担(三段式:来源 ｜ 值 ｜ 结果数)。
   */
  const SHADE_LABEL = { opaque: '不透明白', translucent: '半透明 40%' };
  const OMNI_LABEL = { none: '默认原生搜索', always: '默认全能搜索' };

  /* 白幕档位:初始化 + 订阅(2026-10-12,两档 opaque/translucent,缺省 opaque)。
   *
   * 2026-10-18:「切换档位时左下角应该弹提示」—— 原先切档只有状态变化、没有回声,
   * 用户切完看不出来生没生效。现在档位变更给一声,口径与开关回声一致:
   * **只报真变更**,首次对齐(prev 还是 null)不报,免得页面一加载就冒一条。
   * prev 的初始化就是那次 read —— 所以下面不再单独 read 一遍(读两次会
   * 两路并发回写同一个变量,时序上纯属自找麻烦)。
   */
  var prevShadeMode = null;
  if (typeof dycReadShadeMode === 'function') {
    dycReadShadeMode().then(function (m) {
      prevShadeMode = m;
      state.shadeMode = m;
    });
  }
  if (typeof dycWatchShadeMode === 'function') {
    dycWatchShadeMode(function (m) {
      if (prevShadeMode !== null && m !== prevShadeMode && typeof toast === 'function') {
        toast(SHADE_LABEL[m] || m, 'info', { source: '搜索白幕' });
      }
      prevShadeMode = m;
      state.shadeMode = m;
    });
  }
  // 回车档位(两档):初始化 + 订阅(二十二轮;脏值一律落 'none')
  // 优先走 flags.js 的共享函数(popup 与内容脚本同口径);不在时直连 storage。
  function readOmniMode() {
    if (typeof dycReadOmniMode === 'function') return dycReadOmniMode();
    return chrome.storage.local.get(OMNI_MODE_KEY).then(function (r) {
      const v = r && r[OMNI_MODE_KEY];
      return OMNI_MODES.indexOf(v) > -1 ? v : 'none';
    }).catch(function () { return 'none'; });
  }
  // 2026-10-18 用户定：**切换档位要在左下角弹提示**（原先切成「默认全能搜索」
  // 一声不响，用户只能凭「回车后有没有扫描」猜）。同样只报真变更、首值不报。
  // 这次 read 同时承担「初始化 state.omniMode」与「给回声留基线」两件事。
  var prevOmniMode = null;
  readOmniMode().then(function (m) {
    prevOmniMode = m;
    state.omniMode = m;
  });
  function onOmniModeChanged(m) {
    if (prevOmniMode !== null && m !== prevOmniMode && typeof toast === 'function') {
      toast(OMNI_LABEL[m] || m, 'info', { source: '回车定位' });
    }
    prevOmniMode = m;
    state.omniMode = m;
  }
  if (typeof dycWatchOmniMode === 'function') {
    dycWatchOmniMode(onOmniModeChanged);
  } else if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.onChanged) {
    try {
      chrome.storage.onChanged.addListener(function (changes, area) {
        if (area !== 'local' || !changes[OMNI_MODE_KEY]) return;
        const v = changes[OMNI_MODE_KEY].newValue;
        onOmniModeChanged(OMNI_MODES.indexOf(v) > -1 ? v : 'none');
      });
    } catch (e) { /* 尽力而为 */ }
  }
  if (typeof dycWatchFlags === 'function') {
    // 状态条统一反馈(2026-10-11):开关切换报一声,首次对齐不报
    var prevLiveSearch = null;
    var prevOmniSearch = null;
    var prevScanShade = null;    // 2026-10-15 补:扫描白幕开关回声
    dycWatchFlags(function (f) {
      var was = enabled();
      var wasOmni = omniEnabled();
      state.flags = f;
      var now = enabled();
      var nowOmni = omniEnabled();
      if (prevLiveSearch !== null && was !== now && typeof toast === 'function') {
        toast(now ? '已开启' : '已关闭', 'info', { source: '全能搜索' });
      }
      prevLiveSearch = now;
      // 全能按钮显隐跟随 omniSearch 开关(liveSearch 开着才谈得上)
      if (prevOmniSearch !== null && wasOmni !== nowOmni) {
        if (!nowOmni) {
          removeAllOmniButtons();
          stopOmniGuard();   // 2026-10-19 #97：按钮关了，自愈表也停（别去补插看不见的东西）
          /* 2026-10-18 修:原先这里把 state.omniMode 硬写成 'none' ——
           * 于是「关掉再打开」之后,内存里是 'none' 而 storage 里还是用户选的
           * 'always',回车就一直走原生、与弹窗里的选择对不上。
           * 现在改成**只回落运行时值、不动 storage**,并提示这位用户:
           * 开关关着时档位不生效。重新打开时下面那支会再读一次 storage。 */
          state.omniMode = 'none';
          // 2026-10-18:来源词跟着弹窗改名走 —— 这一行现在叫「回车定位」。
          // 原词「搜索按钮」与页面正中下方那枚**实体搜索圆钮**撞名,
          // 用户看提示分不清说的是哪一个。
          if (typeof toast === 'function') toast('已隐藏', 'info', { source: '回车定位' });
        } else {
          // 重新打开:按 storage 里**用户原本选的那一档**恢复(上面注释那个 bug 的修法)
          readOmniMode().then(function (m) { state.omniMode = m; });
          /* 2026-10-19 修 #97：关掉时按钮已被 removeAllOmniButtons 摘掉，
           * 重新打开却没有谁负责插回来 —— 用户看到「开关是开的、按钮却没有」，
           * 只能刷新页面。这里当场把页面上已接管的搜索框补插一遍
           * （addOmnisearchButton 幂等：健在就早退，不会插出第二枚）。 */
          scanSearchInputs();
          startOmniGuard();
          if (typeof toast === 'function') toast('已显示', 'info', { source: '回车定位' });
        }
      }
      prevOmniSearch = nowOmni;
      // 扫描白幕开关回声(2026-10-15 补):原先切换无提示,与其他开关不一致
      var nowShade = f.scanShade === true;
      if (prevScanShade !== null && nowShade !== prevScanShade && typeof toast === 'function') {
        toast(nowShade ? '已开启' : '已关闭', 'info', { source: '搜索白幕' });
      }
      prevScanShade = nowShade;
      if (!now) {
        restorePlaceholders();
        destroySearchUi();   // 开关关掉:胶囊、按钮、监听一并摘除(停用必须真停)
      } else if (was === false) {
        /* 2026-10-19 修 #97：总闸「关掉再打开」要把搜索框重新接管一遍。
         * destroySearchUi 把接管标记一并摘了（restorePlaceholders），
         * 而之后没有任何东西再扫描 —— 于是按钮永远不回来。 */
        reviveSearchUi();     // 浮动圆钮 / 胶囊（2026-10-19 修「浮动按钮消失」）
        scanSearchInputs();
        startOmniGuard();
      }
    });
  }

  /* 作用域（2026-11-05）：中控台是 pushState 微前端，切走不重载页面。
   * 不跟着收，胶囊与【全能搜索】按钮会挂到橱窗商品页的搜索框上，回车接管
   * 也照样生效 —— 用户在那一页搜商品会被莫名改成全能扫描。
   * 离开复用「开关关掉」那条停机路径；回到中控台按当前开关重建。 */
  if (typeof dycWatchLiveScope === 'function') {
    var scopeSeen = null;
    dycWatchLiveScope(function (inScope) {
      var first = (scopeSeen === null);
      scopeSeen = inScope;
      if (!inScope) {
        destroySearchUi();
        return;
      }
      if (first || !enabled()) return;   // 首次进入由模块自身初始化负责
      reviveSearchUi();
      scanSearchInputs();
      startOmniGuard();
    });
  }

  // ---------------- 搜索框识别与接管 ----------------

  /**
   * 该输入框是否位于**浮层**里（dialog / modal / drawer / overlay / popup）。
   *
   * 2026-10-14 修 #72（用户报「添加商品页这个地方去掉全能搜索按钮」）：
   * 选品、添加商品这类浮层里的输入框，placeholder 同样含「商品名称」，
   * 只按 placeholder 判断会把它们一起接管并插上【全能搜索】按钮 ——
   * 那不是用户要的位置。所以「主搜索区」的判定要排除浮层内的输入框。
   * 判据取两类通用信号：role="dialog"，以及类名里的浮层词（含 CSS Modules
   * 的 `xxx_modal__hash` 形态，用 `_ - 空格` 做词边界）。
   */
  function inOverlay(el) {
    let n = el;
    while (n && n !== document.body) {
      if (n.getAttribute && n.getAttribute('role') === 'dialog') return true;
      const cls = (typeof n.className === 'string' ? n.className : '') || '';
      if (/(^|[-_ ])(modal|dialog|drawer|overlay|popup)([-_ ]|$)/i.test(cls)) return true;
      n = n.parentElement;
    }
    return false;
  }

  function isSearchInput(el) {
    if (!el || el.tagName !== 'INPUT') return false;
    if (el.getAttribute(ATTR_OURS) === '1') return true;   // 已接管的
    if ((el.getAttribute('placeholder') || '').indexOf(PH_HINT) === -1) return false;
    return !inOverlay(el);   // 浮层里的同名输入框不接管（#72）
  }

  /**
   * 接管平台搜索框(二十二轮瘦身):只做三件事 ——
   *   ① 打接管标记(data-dyc-search,平台框识别用);
   *   ② 插【全能搜索】按钮(文档流兄弟节点,见 addOmnisearchButton);
   *   ③ 平台框输入 → 胶囊实时镜像(内容不丢)。
   * 不再改 placeholder、不加内边距、不塞清空按钮 —— 输入框恢复原生。
   */
  function takeOverInput(el) {
    if (!el) return;
    const marked = el.getAttribute(ATTR_OURS) === '1';
    if (!marked) el.setAttribute(ATTR_OURS, '1');
    state.platformInput = el;
    /* 2026-10-19 修 #97：**已接管也要走一遍补插**。
     * 原先这里 `标记在就 return`，于是平台重建搜索区把按钮连带摘掉之后，
     * 标记还留在 input 上 ⇒ 之后每次扫描、每次点搜索框都早退，
     * 按钮再也不回来（用户报「搜索框旁【全能搜索】消失了」）。
     * addOmnisearchButton 本身幂等（健在就早退），所以这里无脑调用是安全的。 */
    if (omniEnabled()) addOmnisearchButton(el);
    if (marked) return;   // 以下只属「首次接管」的对齐动作
    // 平台框输入 → 浮动框镜像**不再挂在节点上**（2026-10-14 修 #77）：
    // 平台重建搜索区换掉节点后监听随之消失，改由文档级委托统一处理
    // （见 dycMirrorToPill）。这里只做「浮动框已存在时把词对齐」。
    if (pill) pill.input.value = el.value;
  }

  /**
   * 页面上所有「已接管 / 该接管」的搜索框补插一遍（2026-10-19 修 #97）。
   * 开关重新打开、总闸重新打开、以及兜底自愈都走这一条路径。
   */
  function scanSearchInputs() {
    /* 作用域兜底（2026-11-06）：非中控台一律不接管、不插按钮。
       首次初始化、开关重开、兜底自愈都走这一条路径 —— 在这里拦一道，
       比只在销毁侧补救可靠（用户报：切到橱窗商品管理页后按钮还在）。 */
    if (typeof dycIsLiveControl === 'function' && !dycIsLiveControl()) return;
    try {
      const inputs = document.querySelectorAll('input');
      for (const el of inputs) {
        if (isSearchInput(el)) takeOverInput(el);
      }
    } catch (e) { /* 尽力而为，绝不打断主流程 */ }
  }

  /**
   * 兜底自愈：每 2 秒看一眼「已接管的搜索框旁边那枚按钮还在不在、看不看得见」，
   * 不在就补插（2026-10-19 修 #97）。
   *
   * 为什么要常驻这一只表：平台的搜索区会被 SPA 局部重建，重建时机我们没有任何
   * 可靠信号（没有自定义事件、MutationObserver 又会踩到页面高频改动）。而这只
   * 表的开销是「一次属性选择器 + 每个框一次 isConnected / 两个 rect」——
   * 常态 1 个输入框，成本可忽略，换来的是「无论平台怎么重建，按钮总会回来」。
   * 停用（总闸关掉）时随 destroySearchUi 一并停，不做常驻空转。
   */
  function startOmniGuard() {
    if (omniGuardTimer) return;
    if (typeof setInterval !== 'function') return;
    omniGuardTimer = setInterval(function () {
      try {
        if (!enabled() || !omniEnabled()) return;
        const marked = document.querySelectorAll('input[' + ATTR_OURS + ']');
        /* 一个已接管的都没有 ⇒ 平台把整个搜索框节点换掉了（标记随旧节点消失）。
         * 这时补插无从下手，只能重扫一遍把新节点接管回来（判据仍是 placeholder，
         * 与首次接管完全同一条路径，不引入第二套识别口径）。 */
        if (!marked.length) { scanSearchInputs(); return; }
        for (const el of marked) {
          if (!omniBtnHealthy(el)) addOmnisearchButton(el);
        }
      } catch (e) { /* 高频路径，绝不抛错 */ }
    }, OMNI_GUARD_MS);
  }

  function stopOmniGuard() {
    if (omniGuardTimer) { clearInterval(omniGuardTimer); omniGuardTimer = null; }
  }

  /**
   * 取「某个原生搜索框」当前内容（2026-10-14 修 #77）。
   *
   * 为什么不再直接读 state.platformInput：
   *   用户报「原生框里输了词，点它旁边的【全能搜索】没反应，提示我没输入」。
   *   平台搜索区会被 SPA 重建，缓存的 state.platformInput 可能已脱离 DOM，
   *   读它必然拿到空值 —— 而按钮本身还挂在**新**节点上，于是「按钮在、词读不到」。
   * 口径：优先读按钮自己所属的那个输入框（由调用方传入），它不在了再退缓存，
   *      最后退「页面上任何已接管且非空的搜索框」。
   */
  function nativeQueryOf(own) {
    if (own && own.isConnected) return (own.value || '').trim();
    const cur = state.platformInput;
    if (cur && cur.isConnected) return (cur.value || '').trim();
    const marked = document.querySelectorAll('input[' + ATTR_OURS + ']');
    for (let i = 0; i < marked.length; i++) {
      const v = (marked[i].value || '').trim();
      if (marked[i].isConnected && v) return v;
    }
    return '';
  }

  /* 原生框 → 浮动框 的镜像（文档级委托，挂一次管全程）
   *
   * 2026-10-14 修 #77：委托到 document 上，平台重建搜索区、换掉 input 节点
   * 也断不了链；顺手把 state.platformInput 刷新成当前真实节点 ——
   * 这正是「点了没反应 / 提示没输入」的另一半根因。
   * capture=true：平台若在冒泡阶段 stopPropagation，我们仍能收到。
   */
  function dycMirrorToPill(e) {
    const t = e.target;
    if (!t || t.tagName !== 'INPUT') return;
    if (t.getAttribute(ATTR_OURS) !== '1') return;   // 只管已接管的搜索框
    state.platformInput = t;
    if (pill && pill.input.value !== t.value) pill.input.value = t.value;
    // 改词 ⇒ 当前结果不再对应框里的词:放大镜恢复无色(用户定)。
    // 不看 nativeRaw 是否为空 —— 全能态下改词同样要恢复(此时 nativeRaw 是 null)。
    if (omniLensOn) setOmniLensActive(false);
  }
  document.addEventListener('input', dycMirrorToPill, true);

  /* ---------- 平台自带「搜索结果导航」按钮(2026-10-14 用户定) ----------
   *
   * 用户原话:「原生输入框放着左右两个按钮,那么回车键 = 按钮右键,
   *            键盘左键接入按钮左键,键盘右键接入按钮右键」。
   *
   * 真机实测(2026-10-14,用户现场探针回采):
   *   · 那对箭头是 `span[class*="optLeft-"]` / `span[class*="optRight-"]`,
   *     16×16,与平台搜索键 `auxo-input-search-button` 同排,顺序 [←][→][🔍];
   *   · 箭头在**输入框的第 3 层祖先**里(搜索键只在第 1 层)⇒ 找法 =
   *     沿输入框祖先链逐层向上,取**最内层成对**的那一对;
   *   · 点箭头后**平台自己完成滚动 + 自己给当前命中行加高亮类** ⇒
   *     扩展不需要自建结果集、不需要自己滚列表,只做两件事:
   *     「键位映射」+「读平台高亮行染色」。
   *
   * 接管边界(用户定,很重要):**改词、或没有结果时完全不接管** ——
   * 键盘原样交给文字编辑与平台搜索,否则在框里按 ← → 就没法移动光标了。
   */
  let navPairCache = { at: 0, pair: null };   // 1 秒轻量缓存(键盘/滚动路径高频调用)
  const NAV_CACHE_MS = 1000;

  /** 找平台那对结果箭头;找不到返回 null(平台改版 ⇒ 本功能静默失效,不影响搜索) */
  function nativeNavPair() {
    const now = Date.now();
    const c = navPairCache;
    if (c.pair && c.pair.L && c.pair.R && c.pair.L.isConnected && c.pair.R.isConnected
        && (now - c.at) < NAV_CACHE_MS) {
      return c.pair;
    }
    let pair = null;
    const input = state.platformInput;
    // ① 主路径:沿输入框祖先链找**最内层成对**的那一对(越内越贴近搜索行)
    if (input && input.isConnected) {
      let p = input;
      for (let d = 0; p && d < 7; d++) {
        const L = p.querySelector(NAV_L_SEL);
        const R = p.querySelector(NAV_R_SEL);
        if (L && R) { pair = { L: L, R: R }; break; }
        p = p.parentElement;
      }
    }
    // ② 兜底:全局找「同一个父容器下成对」的(限小尺寸,避免误伤别处同名类)
    if (!pair) {
      const all = document.querySelectorAll(NAV_L_SEL);
      for (let i = 0; i < all.length; i++) {
        const L = all[i];
        const box = L.parentElement;
        if (!box) continue;
        const R = box.querySelector(NAV_R_SEL);
        if (!R) continue;
        const r = (typeof L.getBoundingClientRect === 'function') ? L.getBoundingClientRect() : null;
        if (r && (r.width > 40 || r.height > 40)) continue;   // 太大 ⇒ 不是这对小箭头
        pair = { L: L, R: R };
        break;
      }
    }
    navPairCache = { at: now, pair: pair };
    return pair;
  }

  /** 平台箭头当前是否禁用(平台自己加的 `disabled-` 类,首/尾结果时出现) */
  function nativeNavDisabled(el) {
    if (!el) return true;
    const cls = (typeof el.className === 'string') ? el.className : String(el.className || '');
    return /disabled/i.test(cls);
  }

  /**
   * 点一下平台的结果箭头 —— 等价于用户用鼠标点它。
   * 只发 mousedown/mouseup + click **各一次**(重复发会让平台翻两下)。
   * 返回 true = 真点了(调用方据此决定要不要吃掉这次按键)。
   */
  function clickNativeNav(which) {
    const pair = nativeNavPair();
    if (!pair) return false;
    const el = (which === 'prev') ? pair.L : pair.R;
    if (!el || !el.isConnected || nativeNavDisabled(el)) return false;
    try {
      el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
      el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
    } catch (e) { /* 尽力而为 */ }
    try { el.click(); } catch (e2) { return false; }
    return true;
  }

  /**
   * 回车跳下一个结果是否该接管(2026-10-20 用户定 #99:「搜索键位导航」开关删除,
   * 行为**常开**、合并进原生搜索的固有行为,不再单独设开关;两条前提,缺一不接管):
   *   ① 原生搜索过、且框里的词**一个字都没改**;
   *   ② 平台那对箭头在页面上。
   */
  function nativeNavReady(input) {
    if (!input || !input.isConnected) return false;
    if (!enabled()) return false;
    const raw = state.nativeRaw;
    if (!raw) return false;
    if ((input.value || '').trim() !== raw) return false;   // 改过词 ⇒ 归还文字编辑
    return !!nativeNavPair();
  }

  /**
   * 读**平台自己的**结果计数(原生搜索后,那对箭头旁边会显示「1/125」)。
   *
   * 2026-10-14 用户定:「原生搜索的结果不同步到浮动搜索栏」——
   * 平台已经把「第几个/共几个」显示在搜索框右侧了,浮动框照抄即可,
   * 不需要扩展自建结果集。
   * 读不到就返回 ''(浮动框计数位留空)—— 不瞎编一个 0/0 误导用户。
   */
  function readNativeCounter() {
    const pair = nativeNavPair();
    if (!pair || !pair.L) return '';
    // 从箭头所在容器起向上找 3 层,取第一个形如 N/M 的短文本
    let box = pair.L.parentElement;
    for (let d = 0; box && d < 3; d++) {
      const txt = String(box.textContent || '').replace(/\s+/g, '');
      const m = txt.match(/(\d{1,4})\/(\d{1,5})/);
      if (m) return m[1] + '/' + m[2];
      box = box.parentElement;
    }
    return '';
  }

  /**
   * 平台自己的结果**总数**(原生搜索后箭头旁「N/M」里的 M)。
   *   · 数字  = 平台承认有这么多条结果
   *   · 0     = 平台说一条都没有
   *   · null  = 没读到(平台还没渲染完 / 结构又变了)
   *
   * 用途只有一个:给「兜底找行」当闸门(#121,2026-10-26 用户定:
   * 原生搜索只做视觉增强,不许把「平台搜不到」变成「我们搜到了」)。
   */
  function nativeResultTotal() {
    const c = readNativeCounter();                 // 'N/M'
    if (!c) return null;
    const m = /^(\d+)\/(\d+)$/.exec(c);
    if (!m) return null;
    return parseInt(m[2], 10);
  }

  /**
   * 浮动框 [←][→] 的可用态与平台箭头同步(用户 2026-10-14 定):
   * 平台箭头灰了(首/尾结果),浮动框对应的键也灰掉、点不动 ——
   * 用户一眼看出「到头了」,不会按半天没反应。
   * 全能搜索场景(结果来自扩展自己的扫描)不禁用,仍走循环。
   */
  function syncPillNavState() {
    if (!pill) return;
    const native = !!state.nativeRaw;
    const pair = native ? nativeNavPair() : null;
    const prevOff = (native && pair) ? nativeNavDisabled(pair.L) : false;
    const nextOff = (native && pair) ? nativeNavDisabled(pair.R) : false;
    try {
      pill.prevBtn.disabled = prevOff;
      pill.nextBtn.disabled = nextOff;
    } catch (e) { /* 尽力而为 */ }
  }

  /**
   * 原生搜索 / 翻页后:把**平台自己高亮的那一行**染色 + 呼吸灯。
   *
   * 为什么不自己找命中行:平台点箭头后自己滚、自己加高亮类,那一行就是
   * 「当前结果」的权威答案(真机实测:高亮类从一行迁到另一行);
   * 自己按匹配口径猜反而会猜错 —— 虚拟列表下屏幕外的行根本读不到。
   * 找不到高亮行就静默返回:不猜、不乱标。
   */
  function paintNativeResult(raw) {
    raw = (raw || '').trim();
    const keywords = parseKeywords(raw);
    if (!keywords.length) return;
    state.keywords = keywords;   // markNameOnRow 按它定位命中文字
    let row = null;
    try {
      const hl = document.querySelectorAll(NAV_ROW_HL_SEL);
      for (let i = 0; i < hl.length; i++) {
        if (hl[i].isConnected) { row = hl[i]; break; }
      }
      if (!row) {
        // 兜底:平台若改了高亮类名 —— 找「类名同时含 highlight 与 goods-item」的行
        const cands = document.querySelectorAll('[class*="highlight-"]');
        for (let j = 0; j < cands.length; j++) {
          const c = (typeof cands[j].className === 'string') ? cands[j].className : '';
          if (/goods-item/i.test(c) && cands[j].isConnected) { row = cands[j]; break; }
        }
      }
    } catch (e) { row = null; }
    if (!row) return;
    markNameOnRow(row, { noSell: true });   // 原生搜索不认卖点(#121)
    try { if (typeof highlight === 'function') highlight(row); } catch (e2) { /* 尽力而为 */ }
  }

  /** 翻页后延迟染色:等平台把列表滚完、把高亮类挪过去(实测约 300ms) */
  let nativePaintTimer = null;
  function scheduleNativePaint() {
    if (nativePaintTimer) clearTimeout(nativePaintTimer);
    nativePaintTimer = setTimeout(function () {
      nativePaintTimer = null;
      if (state.nativeRaw) paintNativeResult(state.nativeRaw);
      syncPillNavState();
      updatePillCount();   // 翻页后平台计数变了,浮动框跟着刷新
    }, 300);
  }

  /* ---------- 【全能搜索】按钮的放大镜状态指示(2026-10-14 用户定) ----------
   *
   * 用户原话:「以全能搜索的这个放大镜是否变色为方案 —— 原生搜索以及默认
   *            的时候,放大镜是无色的,全能搜索进入接手的时候,放大镜是
   *            亮起来的」。
   *
   * 含义 = **当前这批结果是不是全能搜索给的**(不是「正在搜索」):
   *   · 点【全能搜索】/ 「默认全能搜索」档回车转全能 → 亮起(淡蓝底 + 蓝描边);
   *   · 改词、或重新发起原生搜索 → 恢复灰色。
   * 两处按钮(原生框右侧、浮动胶囊里)一起变 —— 同一功能的两个入口。
   */
  let omniLensOn = false;
  const LENS_IDLE = { fill: 'none', stroke: '#888780' };       // 无色:灰描边空心
  const LENS_ACTIVE = { fill: '#E6F1FB', stroke: '#185FA5' };  // 亮起:淡蓝底 + 蓝描边

  function paintLens(svg, on) {
    if (!svg) return;
    const tone = on ? LENS_ACTIVE : LENS_IDLE;
    try {
      const c = svg.querySelector('circle');
      const p = svg.querySelector('path');
      if (c) { c.setAttribute('fill', tone.fill); c.setAttribute('stroke', tone.stroke); }
      if (p) p.setAttribute('stroke', tone.stroke);
    } catch (e) { /* 尽力而为 */ }
  }

  /**
   * 【全能搜索】按钮**整块**高亮(2026-10-15 用户定 · 方案 A「淡蓝底」):
   * 底色变淡蓝、边框与文字变蓝 —— 整个按钮亮起来,但不刺眼。
   * 用 class 切换(样式表在 OMNI_BTN_CSS / ensureUiStyle 里)。
   */
  function paintOmniBtn(btn, on) {
    if (!btn) return;
    try {
      const cur = String(btn.className || '').split(/\s+/).filter(function (c) {
        return c && c !== 'dyc-omni-on';
      });
      if (on) cur.push('dyc-omni-on');
      btn.className = cur.join(' ');
    } catch (e) { /* 尽力而为 */ }
  }

  function setOmniLensActive(on) {
    omniLensOn = !!on;
    try {
      const marked = document.querySelectorAll('input[' + ATTR_OURS + ']');
      for (const el of marked) {
        if (el.__dycOmniBtn) {
          paintLens(el.__dycOmniBtn.querySelector('svg'), omniLensOn);
          paintOmniBtn(el.__dycOmniBtn, omniLensOn);
        }
      }
    } catch (e) { /* 尽力而为 */ }
    if (pill && pill.omniBtn) {
      paintLens(pill.omniBtn.querySelector('svg'), omniLensOn);
      paintOmniBtn(pill.omniBtn, omniLensOn);
    }
  }

  /* ---------- 原生结果导航的键位接管(独立监听;2026-10-14 用户定,2026-10-20 改常开) ----------
   *
   * 回车 = 平台「下一个结果」箭头。← / → 已于 2026-10-14 用户实测后放弃绑定;
   * 2026-10-20 用户定(#99):「搜索键位导航」开关删除,回车跳下一个结果**常开**,
   * 讲解移到弹窗「回车定位」的问号里。
   * 只在「原生搜索过 + 框里的词一个字没改 + 平台箭头在页面上」时接管
   * (见 nativeNavReady);改词或没结果时**完全不接管**,键盘原样交给
   * 文字编辑与平台搜索 —— 否则在框里按 ← → 就没法移动光标了。
   *
   * ⚠️ **本监听必须注册在下面「原生搜索补闪烁」那个 keydown 监听之前**:
   *   那个监听一被触发就会把 state.nativeRaw 写成当前词;若导航接管排在它
   *   后面跑,「用户第一次按回车搜索」也会被判成「词没改 ⇒ 翻下一个」,
   *   于是平台收不到这次回车、搜索根本不会发生。
   *   监听顺序 = 注册顺序,所以这段代码的位置是有意义的,**不要往下挪**。
   */
  document.addEventListener('keydown', function (e) {
    // ⚠️ 2026-10-14 用户实测后**放弃 ← / → 的键位绑定**(原话:「我想放弃左键
    //    右键的绑定」)—— 只保留「回车 = 下一个结果」。
    //    ← / → 在输入框里是移动光标的标准键,即便有「词未改才接管」的限制,
    //    实际用起来仍然别扭;平台箭头 + 浮动框按钮已经够用。
    if (e.key !== 'Enter') return;
    if (e.isComposing || e.keyCode === 229) return;
    const t = e.target;
    if (!isSearchInput(t)) return;
    // 我们自己派发的 Enter(转发平台搜索)不算导航 —— 否则会自我拦截成翻页
    if (dispatchingPlatformEnter) return;
    if (!nativeNavReady(t)) return;
    if (!clickNativeNav('next')) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    e.stopPropagation();
    scheduleNativePaint();
  }, true);

  /* ---------- 原生搜索后的「涂抹 + 补闪烁」（2026-10-14 用户定 #80） ----------
   *
   * 用户原话：「原生搜索定位到的商品，也加入全能搜索定位到商品时候会闪烁的效果」。
   *
   * 【#121（2026-10-26 用户定）把边界钉死】**原生搜索只做视觉增强，不做搜索**：
   *   · 搜什么词、有没有结果、该看哪一条 —— 全归平台（匹配在它的服务端索引里）；
   *   · 扩展只做两件事：① 关键词背景涂抹（markNameOnRow，且不涂卖点）；
   *     ② 呼吸灯闪烁（highlight）。**不改结果数、不自己造命中**；
   *     命中行若跑出视口，补一次滚动把它露出来（否则闪烁在屏幕外等于没闪）。
   *   · 兜底找行（平台高亮类识别不到时）必须过「平台自己说有 M > 0 条」这道闸门；
   *     平台 0 结果就收工 —— 宁可这一轮不涂色，也不替它翻出一条来。
   */
  let lastFlashKey = '';
  let lastFlashAt = 0;

  function flashAfterNativeSearch(raw) {
    raw = (raw || '').trim();
    const keywords = parseKeywords(raw);
    if (!keywords.length) return;
    // 防抖：我们派发的 Enter 会冒泡回委托监听，同一次搜索只跑一遍
    const now = Date.now();
    if (raw === lastFlashKey && now - lastFlashAt < 1500) return;
    lastFlashKey = raw;
    lastFlashAt = now;

    // 2026-10-14:记下「当前结果来自原生搜索」——
    //   回车跳下一个结果与浮动框 [←][→] 的转发都以它为准;
    //   同时把放大镜恢复无色(结果不再来自全能搜索)。
    state.nativeRaw = raw;
    state.keywords = keywords;
    setOmniLensActive(false);
    syncPillNavState();
    updatePillCount();   // 计数跟平台走(平台此刻可能还没渲染完,观察窗里会再刷)

    // ⚠️ 观察窗(2026-10-14 用户实测后修):平台的搜索是**我们派发 Enter 之后**
    //   才由平台执行的,而且列表是 React 重建的 —— 只在第一帧标一次会被随后的
    //   重绘整个冲掉(用户报:「原生搜索会闪烁但是没有涂色关键词背景色」)。
    //   所以 1.5 秒内反复检查,只在「高亮行换了」或「标记被冲掉了」时才重标
    //   —— 不是每轮都标,免得橙底反复闪。
    const started = Date.now();
    const WATCH_MS = 1500;
    let lastPaintedRow = null;
    let paintedOnce = false;   // 观察窗内是否成功染过色(结束时用它决定要不要打诊断)

    /**
     * 一行文本是否命中全部关键词 —— **原生搜索口径:名称 + 价格,不含卖点**
     * （2026-10-26 #121 用户定:卖点搜索是**全能搜索独占**的能力）。
     *
     * 这里刻意不接卖点组,与全能搜索的扫描匹配（三组）**不同源**,是设计要求:
     * 本函数只服务「原生搜索之后」的两条兜底（平台没给高亮类时按文本找命中行、
     * 或退回老路找行）。原生搜索的匹配在平台侧,卖点不在它的索引里 ——
     * 我们这一层若认卖点,用户就在原生框里「搜得到卖点词」,而平台其实一条
     * 结果都没给:现象对了、结果数是假的。卖点只在用户明确点【全能搜索】
     * （或选了「默认全能搜索」档回车）时才参与。
     */
    function rowHits(text) {
      // ★ 名称段必须**切出来**再匹配(#121 真凶):整行 text 里还裹着
      //   卖点 / 库存 / 佣金 / 时间等字段。旧实现直接拿整行当「名称」去做
      //   子串匹配 —— 那等于把卖点也搬进了名称组,删掉卖点分支也照样能搜到
      //   卖点词。切段与扫描侧同源(getProductName),别名即口径一致。
      const name = getProductName({ innerText: text }, text) || '';
      const t = normText(name);
      const ct = compactText(name);
      const pt = foldPrice(priceJoinedFromText(text));   // #100:所有价格段,与扫描登记同源
      for (let k = 0; k < keywords.length; k++) {
        const kw = keywords[k];
        if (nameHit(t, kw) || nameHit(ct, kw)) continue;
        if (priceHit(pt, foldPrice(kw))) continue;
        return false;
      }
      return true;
    }

    /** 2026-10-15 用户定:原生搜索**有结果**就自动打开浮动框(不抢光标) */
    function ensurePillOpen() {
      if (uiState !== 'shown') expandPill({ focus: false });
    }

    (function tick() {
      // ① 首选:平台自己高亮的那一行 —— 它就是平台认定的「当前结果」
      let hl = null;
      try {
        const cands = document.querySelectorAll(NAV_ROW_HL_SEL);
        for (let i = 0; i < cands.length; i++) {
          if (cands[i].isConnected) { hl = cands[i]; break; }
        }
      } catch (e) { hl = null; }
      if (hl) {
        let stillMarked = false;
        try { stillMarked = !!hl.querySelector('.dyc-mk'); } catch (e2) { stillMarked = false; }
        if (hl !== lastPaintedRow || !stillMarked) {
          lastPaintedRow = hl;
          paintNativeResult(raw);
          try { paintedOnce = !!hl.querySelector('.dyc-mk'); } catch (e3) { paintedOnce = false; }
        }
        syncPillNavState();
        updatePillCount();   // 计数跟平台走(用户定:结果要同步到浮动框)
        ensurePillOpen();    // 有结果 → 自动打开浮动框(不抢光标)
        if (Date.now() - started < WATCH_MS) setTimeout(tick, 200);
        return;
      }
      // ★ 闸门(#121 · 2026-10-26 用户定):兜底找行只在「平台自己说有结果」时跑。
      //   原生搜索的能力边界 = 平台的能力边界 —— 平台说 0 条,我们就不许翻出
      //   一条来涂色(那等于把「搜不到」变成「搜到了」);没读到计数就继续等,
      //   宁可这 1.5 秒不涂色,也不替平台下结论。
      const total = nativeResultTotal();
      if (total === 0) return;                       // 平台 0 结果:没有「搜出来的东西」可涂
      if (total === null) {                          // 计数还没渲染出来:等下一轮
        if (Date.now() - started < WATCH_MS) setTimeout(tick, 120);
        return;
      }
      // ② 兜底一:平台没给高亮类(或类名改了)⇒ 直接在**已渲染的商品行**里按
      //    扩展口径找第一个命中行。**不依赖 locate.js 的行识别** ——
      //    真机实测该页面 `getProductItems()` 返回空,老兜底必然扑空。
      let domHit = null;
      try {
        const cands = document.querySelectorAll('[class*="goods-item"]');
        for (let i = 0; i < cands.length; i++) {
          const el = cands[i];
          if (!el.isConnected || !el.innerText) continue;
          if (rowHits(el.innerText)) { domHit = el; break; }
        }
      } catch (e4) { domHit = null; }
      if (domHit) {
        markNameOnRow(domHit, { noSell: true });   // 原生搜索不认卖点(#121)
        try { if (typeof highlight === 'function') highlight(domHit); } catch (e5) { /* 尽力而为 */ }
        try { paintedOnce = !!domHit.querySelector('.dyc-mk'); } catch (e6) { paintedOnce = false; }
        ensurePillOpen();    // 有结果 → 自动打开浮动框(不抢光标)
        if (Date.now() - started < WATCH_MS) setTimeout(tick, 200);
        return;
      }
      // ③ 兜底二:退回 locate.js 的行识别(老路,保留)
      const items = getProductItems();
      let hit = null;
      for (let i = 0; i < items.length; i++) {
        if (rowHits(items[i].innerText || '')) { hit = items[i]; break; }
      }
      if (hit) {
        // 命中行已在视口内就不滚，避免平台刚定位好又被我们挪一下。
        // （2026-10-27 用户定：这段**恢复原样** —— 行在屏幕外时闪烁等于没闪，
        //   补滚动是为了让「涂抹 + 闪烁」真的落在眼前，仍属视觉增强。）
        let inView = false;
        try {
          const r = hit.getBoundingClientRect();
          inView = r.top >= 0 && r.bottom <= (window.innerHeight || 0);
        } catch (e) { inView = false; }
        if (!inView) scrollElementToViewportCenter(hit);
        markNameOnRow(hit, { noSell: true });   // 2026-10-14:原生搜索命中的词也染色(用户定;卖点段不染,#121)
        highlight(hit);
        try { paintedOnce = !!hit.querySelector('.dyc-mk'); } catch (e7) { paintedOnce = false; }
        ensurePillOpen();    // 有结果 → 自动打开浮动框(不抢光标)
        if (Date.now() - started < WATCH_MS) setTimeout(tick, 200);
        return;
      }
      // 到点仍没有命中就静默结束 —— 原生搜索自己会给出结果，不额外报错
      if (Date.now() - started < WATCH_MS) setTimeout(tick, 120);
    })();

    // 观察窗收尾:一次都没染上 ⇒ 往控制台打一条**只读诊断**,便于真机定位
    // (不弹消息盒、不动界面 —— 用户平时看不到,排查时 F12 就有)。
    setTimeout(function () {
      if (paintedOnce) return;
      try {
        console.warn('[DY-COCO] 原生搜索染色未生效 · 诊断', {
          关键词: raw,
          state_keywords: state.keywords,
          平台高亮行数: document.querySelectorAll(NAV_ROW_HL_SEL).length,
          goodsItem行数: document.querySelectorAll('[class*="goods-item"]').length,
          页面dyc_mk数: document.querySelectorAll('.dyc-mk').length,
          样式表已注入: !!document.getElementById('dyc-name-mark-style'),
          getProductName可用: typeof getProductName,
          getProductItems行数: (typeof getProductItems === 'function') ? getProductItems().length : -1
        });
      } catch (e8) { /* 尽力而为 */ }
    }, WATCH_MS + 120);
  }

  /* 触发点①：原生框里回车（真实按键；我们自己派发的 Enter 也会走到这里） */
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Enter' || e.isComposing || e.keyCode === 229) return;
    const t = e.target;
    if (!t || t.tagName !== 'INPUT') return;
    if (t.getAttribute(ATTR_OURS) !== '1') return;
    flashAfterNativeSearch(t.value);
  }, true);

  /* 触发点②：点平台搜索行里的按钮（放大镜 / 「查询」/「搜索」） */
  document.addEventListener('click', function (e) {
    let btn = null;
    try { btn = e.target && e.target.closest ? e.target.closest('button, [role="button"]') : null; } catch (e2) { btn = null; }
    if (!btn) return;
    const box = document.querySelector('input[' + ATTR_OURS + ']');
    if (!box) return;
    // ⚠️ 2026-10-14 补(用户报「原生搜索没有涂色」的根因之一):
    //   平台的搜索放大镜是**纯图标按钮**(textContent 为空),旧口径只认文字
    //   「查询 / 搜索」⇒ 用户点放大镜搜完,我们完全没收到通知 —— 既不补闪烁、
    //   也不染色,连浮动框计数都不会刷新。
    //   新口径:只要这个按钮落在**已接管搜索框的直接父容器**里就算搜索触发。
    //   (真机实测:放大镜 `auxo-input-search-button` 距输入框 1 层,而结果箭头
    //    optLeft/optRight 在 3 层 ⇒ 用「直接父容器」正好把箭头排除在外,
    //    不会把「点箭头翻页」误判成「重新搜索」。)
    let inSearchRow = false;
    try { inSearchRow = !!(box.parentElement && box.parentElement.contains(btn)); } catch (e3) { inSearchRow = false; }
    const label = (btn.textContent || '').trim();
    if (!inSearchRow && label !== '查询' && label !== '搜索') return;
    flashAfterNativeSearch(box.value);
  }, true);

  /**
   * 把已接管的搜索框还原成平台原样(开关关闭/停用):
   * 摘掉【全能搜索】按钮、解除镜像监听、清标记。
   * 二十二轮:placeholder/padding/宽度均已不再接管,无需还原;
   * 旧版本升级时可能残留 data-dyc-orig-pad / -orig-w 备份属性,顺手清掉。
   */
  function restorePlaceholders() {
    const marked = document.querySelectorAll('input[' + ATTR_OURS + '],input[' + ATTR_ORIG_PH + ']');
    for (const el of marked) {
      // 旧版残留:原生 placeholder 备份(若存在,还原一次)
      const orig = el.getAttribute(ATTR_ORIG_PH);
      if (orig !== null) {
        if (orig) el.setAttribute('placeholder', orig);
        else el.removeAttribute('placeholder');
        el.removeAttribute(ATTR_ORIG_PH);
      }
      // 旧版残留:padding / 宽度备份属性直接清(值已在旧版还原时恢复过)
      el.removeAttribute('data-dyc-orig-pad');
      el.removeAttribute('data-dyc-orig-w');
      // 摘掉旧版「清空」按钮(升级残留;新代码不再创建)
      if (el.__dycClear) {
        try {
          if (el.__dycClear.getAttribute('data-dyc-added-pos') && el.__dycClearWrap) {
            el.__dycClearWrap.style.position = '';
          }
          el.__dycClear.remove();
        } catch (e) { /* 尽力而为 */ }
        el.__dycClear = null;
        el.__dycClearWrap = null;
      }
      // 摘掉【全能搜索】按钮(含三修外壳)
      if (el.__dycOmniShell) {
        try { el.__dycOmniShell.remove(); } catch (e0) { /* 尽力而为 */ }
        el.__dycOmniShell = null;
      }
      if (el.__dycOmniBtn) {
        try { el.__dycOmniBtn.remove(); } catch (e) { /* 尽力而为 */ }
        el.__dycOmniBtn = null;
      }
      // 镜像已改「文档级委托」（见 dycMirrorToPill 处），节点上本就没有监听，
      // 摘掉 ATTR_OURS 标记即自动退出委托的管辖范围。
      el.removeAttribute(ATTR_OURS);
    }
    if (state.platformInput) state.platformInput = null;
  }

  // 用户点进搜索框时顺手接管(插全能按钮);页面刚加载时由下面的定时器补两次
  // (中控台是 Garfish 微前端,搜索框渲染得晚,只靠 focusin 会漏掉首屏前)
  document.addEventListener('focusin', function (e) {
    if (!enabled()) return;
    if (isSearchInput(e.target)) takeOverInput(e.target);
  }, true);

  [3000, 8000].forEach(function (ms) {
    setTimeout(function () {
      if (!enabled()) return;
      scanSearchInputs();
    }, ms);
  });
  // 兜底自愈开机（2026-10-19 修 #97）：之后即便平台重建搜索区把按钮冲掉，
  // 最多 2 秒也会自己长回来，不再需要用户刷新页面。
  startOmniGuard();

  // ---------------- 文本归一化与匹配 ----------------
  //
  // 纯函数挂到 window.__DYC_SEARCH_CORE__,供自测脚本直接复用 ——
  // 与 locate.js 暴露 dycFindFilterAnchor 的做法一致:测试测同一份代码,
  // 而不是在测试里抄一份实现(抄会漂移)。

  /**
   * 全角字母数字符号 → 半角(Ａ→A、１→1)。
   * 用户输入法常打着全角,而商品文本是半角 —— 只做 toLowerCase 时
   * 「Ａ」(U+FF21)与「a」永不相等,搜「Ａ」就漏(2026-10-11 用户实测踩到)。
   * FF01~FF5E 与 ASCII 21~7E 一一对应,平移 0xFEE0 即可,其余字符原样保留。
   */
  function foldWidth(s) {
    let out = '';
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i);
      out += (c >= 0xFF01 && c <= 0xFF5E)
        ? String.fromCharCode(c - 0xFEE0)
        : s.charAt(i);
    }
    return out;
  }

  /** 归一化:全角折叠 + 空白压缩成单个空格 + 转小写(大小写自由换算) */
  function normText(s) {
    return foldWidth(String(s || '')).replace(/\s+/g, ' ').trim().toLowerCase();
  }

  /**
   * 紧凑版:去掉全部空白再转小写。
   * 用途:款号可能被平台的样式节点从中间拆开(inner text 出现换行),
   * 普通匹配失败时用紧凑版兜底 —— NE1C0021W 拆成「NE1C00 / 21W」也能命中。
   */
  function compactText(s) {
    return foldWidth(String(s || '')).replace(/\s+/g, '').toLowerCase();
  }

  /** 「粉色 裙」→ ['粉色','裙'];\s 已覆盖全角空格 U+3000,大小写/全半角归一 */
  function parseKeywords(raw) {
    return foldWidth(String(raw || ''))
      .toLowerCase()
      .split(/\s+/)
      .filter(function (s) { return s.length > 0; });
  }

  /**
   * 一行文本是否命中**全部**关键词(与语义,顺序无关)。
   * 普通版(保留空白)或紧凑版(去空白)任一命中即可。
   */
  function rowMatches(text, ctext, keywords) {
    for (let i = 0; i < keywords.length; i++) {
      const kw = keywords[i];
      if (!nameHit(text, kw) && !nameHit(ctext, kw)) return false;
    }
    return true;
  }

  /**
   * 价格归一(二十二轮):把「¥39.9」「39,900」「＄１２３」类的价格段
   * 折叠成可匹配的紧凑数字串。
   * 输入侧:去掉 ¥/$ 前缀、千分位逗号,全角折叠已由 parseKeywords 兜底;
   * 行侧:登记时同时存「名称+价格」原文的普通/紧凑两版,搜索「39.9」
   * 直接命中「¥39.9」。
   */
  function foldPrice(s) {
    return foldWidth(String(s || '')).replace(/[¥￥$＄,\s]/g, '').toLowerCase();
  }

  /**
   * 名称命中判定（2026-10-14 三修：用户报「现在搜索 0 什么都搜不到,明明商品
   * 名字有 0」）。
   *
   * **名称一律按子串匹配** —— 商品名里出现「0」就命中（款号 10157 里的 0 也算）。
   * 上一版把名称也按「完整数字段」收紧是**过度修正**：搜「0」连名称里带 0 的
   * 商品都搜不到了。名称与价格**口径不同是有意的**：
   *   · 名称 = 商品名 —— 用户要的就是「名字里有这个字就能搜到」；
   *   · 价格 = 数字字段 —— 子串匹配会让「0」命中所有含 0 的价钱（¥136.00…），
   *     所以价格侧走 priceHit（完整数字段）。
   */
  function nameHit(text, kw) {
    if (!text || !kw) return false;
    return foldWidth(String(text)).indexOf(kw) !== -1;
  }

  /**
   * 价格命中判定（2026-10-14 收紧：用户首报「输入 0 的时候能搜到很多东西」）。
   *
   * 关键词是**纯数字**时必须命中一个**完整数字段**（整个价格 / 整数部分 /
   * 小数部分），不再允许「只是某个数字的一部分」；非数字关键词仍按子串。
   *   ptext = "136.00" → 段 ["136", "00"]
   *     搜「136」✓   搜「00」✓   搜「136.00」✓   搜「0」✗
   *   ptext = "0"（价格真的是 0）→ 搜「0」✓（段相等）
   *
   * 为什么只对价格严格：价格是纯数字字段，子串匹配会让「0」把所有价格含 0 的
   * 商品（¥136.00 / ¥100 / ¥0.00…）全捞出来 —— 这是用户第一次报的现象。
   */
  function priceHit(ptext, kwp) {
    if (!ptext || !kwp) return false;
    const t = foldWidth(String(ptext));
    if (!/^\d+(?:\.\d+)?$/.test(kwp)) return t.indexOf(kwp) !== -1;
    const segs = t.match(/\d+(?:\.\d+)?/g);
    if (!segs) return false;
    for (let i = 0; i < segs.length; i++) {
      if (segs[i] === kwp) return true;           // 整个数字段
      const parts = segs[i].split('.');
      for (let j = 0; j < parts.length; j++) {
        if (parts[j] === kwp) return true;        // 小数段(整数部分 / 小数部分)
      }
    }
    return false;
  }

  window.__DYC_SEARCH_CORE__ = {
    normText: normText,
    compactText: compactText,
    parseKeywords: parseKeywords,
    rowMatches: rowMatches,
    foldPrice: foldPrice,
    nameHit: nameHit,     // 2026-10-14:名称命中(子串 —— 名字里有这个字就命中),自测脚本用
    priceHit: priceHit,   // 2026-10-14:价格命中(纯数字只认完整数字段),自测脚本用
    state: state,   // 自测脚本用来模拟时间场景
  };

  // ---------------- 状态提示 ----------------
  //
  // 五轮口径:搜索状态**只走左下角状态条**(dialog.js 的 setStatus),
  // 不再弹任何浮层徽标。扫描进度也只在这里报。

  function report(message, type, opts) {
    if (typeof setStatus === 'function') {
      // 生命周期以 dialog.js 为准(AGENTS.md 第 16 条):全部消息统一 3 秒掉落,
      // running/富状态原地合并续期 —— 这里不再按 type 区分 timeout。
      const base = {};
      setStatus(message, type || 'info', Object.assign(base, opts || {}));
    } else {
      console.log('[DYC-SEARCH]', type || '', message);
    }
  }

  /**
   * 消息盒里的关键词展示(2026-10-12 用户定 A2/B2/C1):
   * 保留完整关键词，消息盒子自动换行，避免尾款号丢失。
   */
  function shortKw(raw) {
    raw = (raw || '').trim();
    return raw;
  }

  // ---------------- 快速轮询 ----------------

  /**
   * 快速轮询:30ms 一查,条件成立立刻走人,最多等 timeoutMs。
   *
   * 不复用 locate.js 的 waitFor —— 它首查前固定等 120ms,扫描几十步
   * 每步白等 120ms,「一格一格往下挪」的拖沓观感主要是它拖出来的。
   * 行渲染通常一两帧就完成,30ms 粒度已绰绰有余。
   */
  function fastWait(cond, onDone, timeoutMs) {
    const start = Date.now();
    (function tick() {
      let ok = false;
      try { ok = cond(); } catch (e) { ok = false; }
      if (ok) { onDone(); return; }
      if (Date.now() - start > (timeoutMs || 600)) { onDone(); return; }
      setTimeout(tick, 30);
    })();
  }

  // ---------------- 全量扫描 ----------------

  /**
   * 从整行文本里抓「**所有** ¥/$ 价格段」(#100,2026-10-20)。
   *
   * 原实现只取行内**第一个** ¥/$ 段,前提假设是「第一个 ¥ 段就是到手价」;
   * 用户报「标价 95 的衣服搜 95 搜不出」(#100) —— 实际行里划线原价
   * (如 ¥1899)排在现价 ¥95 前面,只取第一个段就永远只登记 1899,
   * 现价 95 根本进不了匹配范围。改为**全取**:每个「¥/$ + 数字」段都算
   * 价格 —— 搜 95 命中现价 ¥95;搜 1899 也能找到它(原价同样显示在该行)。
   *
   * 容错优先:抓不到就空着,名称照常可搜。
   */
  function priceAllFromText(rawText) {
    try {
      const t = foldWidth(rawText || '').replace(/\s+/g, ' ').trim();
      if (!t) return [];
      const ms = t.match(/[¥￥$＄]\s*[0-9][0-9,]*(?:\.[0-9]+)?/g);
      return ms ? ms.map(function (s) { return s.replace(/\s+/g, ''); }) : [];
    } catch (e) { return []; }
  }

  /**
   * 所有价格段用「|」连接成登记串(#100,2026-10-20)。
   *
   * 必须带分隔符:foldPrice 会把 ¥/,/空白全剔掉,若直接拼接,「¥1899¥95」
   * 会折叠成 "189995" —— 两个价格粘连成一个数字段,priceHit 按段切分后
   * 搜「95」「1899」都反而不中。「|」不在 foldPrice 的剔除表里,
   * 折叠后是 "1899|95",priceHit 切出 ["1899","95"] 两个段,各搜各的。
   */
  function priceJoinedFromText(rawText) {
    return priceAllFromText(rawText).join('|');
  }

  /**
   * 把商品列表从头滚到尾,登记「行序号 → 文本 + 精确偏移 + 行高」。
   *
   * 序号 = 扫描过程中**按出现顺序累加**的计数(见 capture 的注释),
   * 不再与 locate.js 的 findByOrdinal 共用「等距反推」那套几何 ——
   * 行高不等的列表上那套算法会跳偏。定位改为查本函数输出的 offsets 表。
   *
   * 每屏的重叠行靠偏移比较自然跳过,不会重复计数;
   * 空名称的行在 finish 里统一清掉(那不是商品,占序号会连带后面全偏)。
   *
   * ⚠️ 滚动的是**商品列表容器本身**(虚拟列表必须滚到哪才能读到哪,
   * 绕不开);五轮的「不滚动容器」指的是浮动搜索 UI 自身绝不引发
   * 任何容器滚动 —— 两者不冲突。
   *
   * @param {function(Array, Function, Object)} done
   *        扫完回调:done(rows, restore, geo)
   *        rows = [{ordinal, text, ctext}] 按序号升序;
   *        restore() 把列表滚回扫描前的位置(无结果时用,有结果时不必调,
   *        因为定位自己会滚到目标位置);
   *        geo = {scroller, baseTop, spacing} 扫描时实测的行距几何,
   *        供「一次直达」定位复用(免得再回顶部重算一遍)
   * @param {function(number)} [onProgress] 每步回调当前已登记行数
   */
  /**
   * 扫描遮罩(2026-10-12 用户定:做成开关 scanShade,**默认关**):
   *
   * · 开关关(默认)→ 不盖遮罩,扫描实时滚动可见(旧行为);
   * · 开关开 → 盖住商品列表容器可视区并向右多盖 24px 连滚动条一起挡住:
   *     opaque       不透明白,底下怎么滚都看不见(最安静);
   *     translucent  半透明 40%,隐约看到列表在翻、知道在干活,鬼影不干扰阅读。
   *   档位存 dycScanShadeMode,弹窗拨动即时生效。
   *
   * 说明:虚拟列表必须滚动才能逐行渲染(技术上绕不开);开关的价值是
   * 让用户自己选「要不要把这段运动挡在观感之外」。
   */
  function mountScanShade(scroller) {
    try {
      if (state.flags && state.flags.scanShade === false) {
        // 开关关(含默认):不盖遮罩,保持旧行为
        return { setText: function () {}, unmount: function () {} };
      }
      const translucent = state.shadeMode === 'translucent';
      const el = document.createElement('div');
      el.id = 'dyc-scan-shade';
      if (translucent) el.classList.add('dyb-shade-translucent');
      el.textContent = '正在搜索，请稍候…';
      document.body.appendChild(el);
      (function place() {
        const r = scroller.getBoundingClientRect();
        el.style.left = r.left + 'px';
        el.style.top = r.top + 'px';
        el.style.width = (r.width + 24) + 'px';   // 右侧多盖 24px:连滚动条一起遮
        el.style.height = r.height + 'px';
      })();
      return {
        setText: function (t) { try { el.textContent = t; } catch (e) { /* 尽力而为 */ } },
        unmount: function () { try { el.remove(); } catch (e) { /* 尽力而为 */ } }
      };
    } catch (e) {
      return { setText: function () {}, unmount: function () {} };
    }
  }

  function scanAllRows(done, onProgress) {
    const scroller = getScrollContainer(true);
    if (!scroller) { done([], function () {}, null); return; }

    /* ★ 2026-10-18 回归修复:EPS 必须声明在**本函数最前面**。
     *
     * 事故(v26.10.18.1 真机):点【全能搜索】按钮 → 左下角出现「正在搜索…」提示,
     * 然后就没了 —— 控制台 `Cannot access 'EPS' before initialization`。
     *
     * 为什么:EPS 原来是 `const`,写在 capture() 上方;而 capture() 的第一次调用
     * 来自 `fastWait(cond, onDone)` —— fastWait 的 tick 是**同步先跑一次**,
     * 条件成立就立即调 onDone,onDone 里就调 capture()。于是执行顺序是:
     *   声明 EPS 的那一行 → 还没执行(在下面) → capture 里读 EPS → TDZ 报错。
     * 报错发生在 onDone 里(tick 的 try 只包住 cond),直接冒到 runSearch,
     * 整条扫描链就此中断,而「正在搜索」那条提示已经发出去了 —— 观感就是
     * **有提示、无反应**。
     *
     * 教训:函数声明会提升、`const` 不会。凡「被提前调用的函数里引用的 const」,
     * 必须声明在**任何调用点之前**。自检 `.tmp/verify-1018-hints.js` 有一条断言盯这个。
     */
    const EPS = 4;

    ensureUiStyle();
    const shade = mountScanShade(scroller);
    function finishDone(rows2, restore2, geo2) {
      shade.unmount();
      done(rows2, restore2, geo2);
    }

    const savedTop = scroller.scrollTop;
    function restore() {
      // 容器可能已被 SPA 重建,还原前重新找一次
      const sc = getScrollContainer(true);
      if (sc) { window.__dycScriptScrollAt = scriptScrollAt = Date.now(); sc.scrollTop = savedTop; }
    }

    let spacing = 0;        // 名义行距:只用来决定「每次滚多远」,不再用来推序号
    let baseTop = 0;
    let maxRowH = 0;        // 实测最高的行高,决定滚动重叠量(见 step)
    const byOrdinal = {};   // 序号 -> {ordinal, text, ctext, ptext, offset, height}
    let nextOrdinal = 0;    // ★ 真序号计数器:只在「遇到更新的一行」时 +1
    let lastOffset = -Infinity;
    let stepsLeft = 300;    // 步数保险丝:防懒加载无限追加导致死循环

    /**
     * 本模块取行的唯一入口 —— **并集行集合**(等距行 ∪ 结构锚补捞)。
     *
     * 2026-10-18(#94)改:原来三处直接调 getProductItems(),而它带一道
     * 「高度偏离均值 30% 就整行剔掉」的等高校验。可「商品名称不折叠」是
     * **默认开启**的功能,名字长的行折成两行、变高,名字短的行相对变矮 ——
     * 于是谁被剔掉取决于名字长短,而不是取决于它是不是商品行。
     * 被剔掉的行既不进搜索、也拿不到货号按钮,正是用户报的
     * 「有些小黄车搜不到」。
     * getAllProductRows() 在等距行之外再用「复制 ID」按钮这个结构锚补捞,
     * 能把被误剔的行捞回来。名称换行与货号按钮早就换过去了,搜索是最后一个。
     */
    function rowsNow() {
      if (typeof getAllProductRows === 'function') {
        try {
          /* ★ 2026-10-18:**扫描期间必须 fresh**。
           *   scan 的时序是「先 scrollTop 挪一屏，再问这一屏有哪些行」。
           *   不传 fresh 时会命中 250ms 缓存，拿回来的是**上一屏**的节点 ——
           *   capture 按偏移升序数行，旧节点偏移更小，会被当成「已数过」跳过；
           *   于是这一屏的新行一个都数不到，扫描空转、步数耗光（保险丝 300 步），
           *   表现就是「全能搜索超时」。
           *   80ms 下限保证同一屏内不会每 30ms 全量重扫。 */
          const r = getAllProductRows(true);
          if (r && r.length) return r;
        } catch (e) { /* 退回主路径 */ }
      }
      return (typeof getProductItems === 'function') ? getProductItems() : [];
    }

    /**
     * 容器内偏移(滚动无关的绝对位置)。
     * cRect 由调用方**读一次**传进来:循环里反复读容器 rect 会触发强制重排,
     * 而这是逐行循环 —— 正是 perf-check 盯的那类写法。
     */
    function offsetOf(sc, el, cRect) {
      const r = el.getBoundingClientRect();
      return r.top - (cRect || sc.getBoundingClientRect()).top + sc.scrollTop;
    }

    /** 当前渲染行里最靠上的那行的容器内偏移(第 1 行的锚点) */
    function minRelTop(sc) {
      const items = rowsNow();
      const cRect = sc.getBoundingClientRect();   // 读一次,循环里复用
      let min = Infinity;
      for (let i = 0; i < items.length; i++) {
        const rel = offsetOf(sc, items[i], cRect);
        if (rel < min) min = rel;
      }
      return min;
    }

    /**
     * 行距与最高行高 —— 用**并集行集合**现测。
     *
     * 行距只用于「每步滚多远」这一件事(见 step),序号已不再依赖它;
     * 但滚动重叠量必须按**最高的那一行**算:名字折成三行的行可能比
     * 名义行距高出一大截,若仍按行距的一半重叠,一屏就跳过了它。
     */
    function measurePace() {
      const items = rowsNow();
      if (items.length === 0) return;
      const cRect = scroller.getBoundingClientRect();   // 读一次,循环里复用
      const tops = [];
      const hs = [];
      maxRowH = 0;
      for (let i = 0; i < items.length; i++) {
        const r = items[i].getBoundingClientRect();
        tops.push(r.top - cRect.top + scroller.scrollTop);
        hs.push(r.height);
        if (r.height > maxRowH) maxRowH = r.height;
      }
      const sorted = tops.slice().sort(function (a, b) { return a - b; });
      const gaps = [];
      for (let i = 1; i < sorted.length; i++) {
        const g = sorted[i] - sorted[i - 1];
        if (g > 10) gaps.push(g);
      }
      if (gaps.length) {
        gaps.sort(function (a, b) { return a - b; });
        spacing = gaps[Math.floor(gaps.length / 2)];
      }
      if (!spacing && typeof measureRowSpacing === 'function') spacing = measureRowSpacing();
    }

    // 回顶部,等首屏行渲染出来
    window.__dycScriptScrollAt = scriptScrollAt = Date.now();
    scroller.scrollTop = 0;
    fastWait(function () { return rowsNow().length > 0; }, function () {
      measurePace();
      if (!spacing) { finishDone([], restore, null); return; }
      baseTop = minRelTop(scroller);
      capture();
      step();
    }, 2500);

    /**
     * 登记当前渲染出来的行,返回新登记了几行。
     *
     * ★★ 2026-10-18(#94)序号算法重写 —— 这是「有些小黄车搜不到」的第二根因。
     *
     * 【旧算法】
     *     ord = round((行顶边偏移 − 首行偏移) / 行距) + 1
     *   它**假定每行等高**。可「商品名称不折叠」默认开、名字长的行折成两行,
     *   行高立刻不等;此时按固定行距反推出来的序号会**撞到已登记的号上**,
     *   而下面一句 `if (byOrdinal[ord]) continue` 会把它当成「重复」**静默丢弃**:
     *   不报错、不提示、日志里也看不出来 —— 那几行就此永远搜不到。
     *
     * 【新算法】
     *   序号不再由几何反推,而是**按行在容器里的先后顺序实打实地数**:
     *   每次 capture 把当前渲染的行按偏移升序排,只认偏移**严格大于上一次**
     *   的那一行(容差 EPS),数到一个就 +1。这样:
     *     · 行高不等 → 不影响(序号只跟顺序有关);
     *     · 滚动重叠 → 上一屏数过的行偏移更小,自动跳过,不会重复计数;
     *     · 一屏有多行 → 一次数完,不会漏;
     *   并且顺手把**每行的精确偏移 + 行高**一起记下来,后面定位直接用,
     *   不必再拿「首行偏移 + 行距」去猜(那是等距假设的另一处残留)。
     *
     * 容差 EPS=4px:行与行之间至少隔 30px(行高下限),4px 不会把两行并成一行,
     * 又能吸收亚像素抖动与平台重绘时的轻微位置漂移。
     */
    function capture() {
      const items = rowsNow();
      if (items.length === 0) return 0;
      // 按容器内偏移升序 —— 与视觉顺序一致,序号才对得上「第 N 个商品」
      const cRect = scroller.getBoundingClientRect();   // 读一次,循环里复用
      const sorted = items.map(function (el) {
        return { el: el, off: offsetOf(scroller, el, cRect) };
      }).sort(function (a, b) { return a.off - b.off; });

      let fresh = 0;
      for (let i = 0; i < sorted.length; i++) {
        const el = sorted[i].el;
        const off = sorted[i].off;
        if (off <= lastOffset + EPS) continue;   // 上一屏数过的行 / 更靠上的行:跳过
        lastOffset = off;
        nextOrdinal += 1;
        const ord = nextOrdinal;
        // 二十二轮:全能搜索匹配范围 = 商品名 + 价格。
        // 2026-10-14 口径收紧:名称段由 getProductName 切干净 —— 只留商品名
        // (含款号),库存/销量/上架时间等字段值一律不进匹配范围(见文件头首段);
        // 价格段由 priceAllFromText 单独抓,只有「¥/$ + 数字」才算价格。
        // 2026-10-13 提速:整行文本只读一次(innerText 会强制同步布局),
        // 名称与价格都从这一份文本派生。
        // #100 附(2026-10-20):卖点段由 getSellPoint 单独切,第三个匹配组。
        const rowText = (el && el.innerText) || '';
        const name = getProductName(el, rowText) || '';
        const sell = getSellPoint(el, rowText) || '';
        // #100(2026-10-20):价格收行内**所有** ¥/$ 段(「|」分隔),不再只取
        // 第一个段 —— 划线原价排在现价前面时,原实现永远搜不到现价。
        const ptext = foldPrice(priceJoinedFromText(rowText));
        const h = el.getBoundingClientRect().height;
        byOrdinal[ord] = {
          ordinal: ord,
          // 2026-10-14:名称与价格**分开登记**,不再拼成一串。
          // 拼在一起时,价格数字会走「名称子串匹配」这条路 —— 搜「0」把
          // 所有价格含 0 的商品(¥136.00 / ¥100 / ¥0.00…)全捞出来,
          // 用户报「输入 0 能搜到很多东西」。分开后价格只走 priceHit
          // (完整数字段),名称只走子串。
          text: normText(name),
          ctext: compactText(name),
          // #100 附:卖点组独立登记(普通/紧凑两版,与名称对齐),按子串匹配
          // —— 卖点是文本字段,口径跟名称一致(评审稿问 3 按推荐执行)。
          sptext: normText(sell),
          spct: compactText(sell),
          ptext: ptext,   // 价格紧凑串(仅价格段),按完整数字段匹配
          // ★ 2026-10-18:登记**这一行自己的**容器内偏移与行高。
          //   定位时直接用它,不再拿「首行偏移 + 序号×行距」去猜 ——
          //   行高不等的列表里,那个猜法必然越走越偏。
          offset: off,
          height: h,
        };
        fresh++;
      }
      if (fresh > 0) shade.setText('正在搜索,已扫 ' + Object.keys(byOrdinal).length + ' 行…');
      if (fresh > 0 && typeof onProgress === 'function') {
        // 进度百分比 = 列表滚动位置(从头滚到尾,scrollTop/maxScroll 即真实进度)
        const maxScroll = scroller.scrollHeight - scroller.clientHeight;
        const pct = maxScroll > 0 ? Math.min(1, scroller.scrollTop / maxScroll) : 0;
        onProgress(Object.keys(byOrdinal).length, pct);
      }
      return fresh;
    }

    /**
     * 向下滚一屏,等新行渲染,直到到底。
     *
     * ★ 2026-10-18(#94):步进量改为「按**最高行高**留重叠」。
     *   旧式 `clientHeight − spacing/2` 是按「每行都等于名义行距」算的 ——
     *   名字折成三行的行比名义行距更高,半行距的重叠盖不住它,
     *   一滚动就整行跳出渲染区,**连看都没看见就跳过了**(漏行的第三根因)。
     *   现在至少留出 `maxRowH` 的重叠,一行无论多高都不会被一屏跨过去。
     */
    function step() {
      if (stepsLeft-- <= 0) { finish(); return; }

      const maxScroll = scroller.scrollHeight - scroller.clientHeight;
      if (scroller.scrollTop >= maxScroll - 2) { finish(); return; }

      // 每步前进「一屏 − 最高行高 − 余量」:保证相邻两屏重叠 ≥ 一行
      const overlap = Math.max(spacing / 2, maxRowH + 8);
      const pace = Math.max(50, scroller.clientHeight - overlap);
      window.__dycScriptScrollAt = scriptScrollAt = Date.now();
      scroller.scrollTop = Math.min(scroller.scrollTop + pace, maxScroll);

      // 等这一屏渲染出**新**行;等不到(纯重叠/列表尾部)也继续走
      // ⚠️ measurePace 放在 onDone 里、**不进 fastWait 的判定函数** ——
      //   判定函数每 30ms 跑一次,每跑一次都要读 8 行 rect;扫几十屏就是
      //   上万次布局读取,纯属浪费。每屏量一次足够(名称折行是逐步发生的,
      //   一屏的量测精度远高于「按名义行距猜」)。
      fastWait(function () { return capture() > 0; }, function () {
        measurePace();
        step();
      }, 600);
    }

    function finish() {
      const rows = Object.keys(byOrdinal)
        .map(function (k) { return byOrdinal[k]; })
        .sort(function (a, b) { return a.ordinal - b.ordinal; });
      /* ★ 2026-10-18:清掉「名称和价格都读不出来」的行。
       *
       * 为什么不是「名称空就清」:有些行确实能读到价格、只是名称切失败
       * (字段截断规则遇上新写法)。那种行仍然应该能被**价格**搜到,
       * 清掉等于又制造一次「搜不到」。
       * 所以判据放到最松:名称与价格都为空 ⇒ 它不可能是可搜商品,
       * 留着只会白占一个序号(让后面的序号整体偏大)、还会在命中为空时
       * 被误选中。只清这一类。
       */
      const clean = rows.filter(function (r) {
        return !!(r.text || r.ctext || r.ptext);
      });
      // 清行之后序号必须重新编号,否则「第 3 行被清掉」会让后面的行
      // 与平台显示的序号错开一位 —— 用户按序号定位就会跳错商品。
      const before = rows.length;
      clean.forEach(function (r, i) { r.ordinal = i + 1; });
      if (before !== clean.length) {
        // 清过行 ⇒ 记一笔轨迹。清行本身是正常的(识别到了非商品节点),
        // 但如果条数掉得反常,这条轨迹就是唯一线索。
        try {
          if (window.__dycDiag && typeof window.__dycDiag.note === 'function') {
            window.__dycDiag.note('扫描清理', '识别到 ' + before + ' 行,其中 '
              + (before - clean.length) + ' 行名称与价格都读不出,已剔除');
          }
        } catch (e) { /* 记轨迹失败不影响结果 */ }
      }

      /* ★ 表必须从 **clean** 建,不能从 rows 建 ——
       *   clean 的序号已经重排过,用 rows 建出来的键会与命中序号对不上,
       *   表现为「搜到了但跳去隔壁商品」。 */
      const offsets = {};
      const heights = {};
      clean.forEach(function (r) {
        offsets[r.ordinal] = r.offset;
        heights[r.ordinal] = r.height;
      });

      finishDone(clean, restore, {
        scroller: scroller,
        baseTop: baseTop,
        spacing: spacing,
        maxRowH: maxRowH,
        // 序号 → 精确偏移 / 行高:定位时直接查表,不再按行距推算
        offsets: offsets,
        heights: heights,
      });
    }
  }

  // ---------------- 搜索主流程 ----------------

  /**
   * 全能搜索入口(二十二轮)。【全能搜索】按钮与「默认全能搜索」档的回车都走这里。
   * (2026-10-18:事不过三删除后它成为 runSearch 的**唯一**调用方)
   */
  function startOmniSearch(raw, inputEl) {
    if (state.busy) return;
    const el = inputEl || state.platformInput || (pill && pill.input) || null;
    // 2026-10-14:转全能 —— 浮动框 [←][→] 不再转发平台箭头(改走扩展自己的
    // 结果集循环),并把【全能搜索】按钮上的放大镜**亮起**(用户定的状态指示)。
    state.nativeRaw = null;
    setOmniLensActive(true);
    // 全能发起时把词写回平台框(两框联动口径不变)
    if (state.platformInput && el !== state.platformInput) {
      mirrorToPlatformInput(state.platformInput, raw);
    }
    runSearch(raw, el);
  }

  /* 三段式来源标签(2026-10-15;2026-10-18 简化为常量)。
   *
   * 原先靠给输入框打一个临时属性 `__dycOmniFired` 来判断「这次是谁发起的」,
   * 有两个毛病:① 拿不到输入框时属性打不上 ⇒ 全能搜索会被标成「搜索导航」;
   * ② runSearch 的唯一调用方就是 startOmniSearch,所谓「另一个入口」并不存在,
   * 那个分支是死代码。现在写死成常量,标签永远可信。 */
  const SEARCH_SRC = '全能搜索';
  function searchSource() {
    return SEARCH_SRC;
  }

  function runSearch(raw, inputEl) {
    if (state.busy) return;   // 上一轮还在扫:本次回车已被拦下,直接忽略

    const keywords = parseKeywords(raw);
    if (keywords.length === 0) return;
    state.keywords = keywords;   // 命中文字标记要按关键词逐处定位

    // 同一个词再按回车 = 在上次结果里跳下一个(循环;用户定:不发消息盒)
    if (raw === state.lastRaw && state.matches.length > 0) {
      state.cursor = (state.cursor + 1) % state.matches.length;
      updatePillCount();
      jumpToCursor(true);
      return;
    }

    const SRC = searchSource();   // 三段式的来源标签(2026-10-15)
    state.lastRaw = raw;
    clearNameMark();      // 新查询开始,上一轮命中名的橙底一并撤掉
    state.matches = [];   // 新查询先清掉旧结果,避免失败后回车误跳旧匹配
    state.cursor = 0;
    state.busy = true;
    state.scanInput = inputEl || null;
    // 两框联动:从浮动框发起时,把词同步回平台搜索框
    if (state.platformInput && inputEl !== state.platformInput) {
      mirrorToPlatformInput(state.platformInput, raw);
    }
    // 进度条模式(2026-10-11 用户定:搜索不转圈,起始就以 0% 进度条出现)
    // 文案 2026-10-12 用户定 A2:正在搜索「XXXX」……(计数从行数改百分比)
    // 2026-10-12 用户定:计数字只写百分比,不写行数
    report('正在搜索「' + shortKw(raw) + '」……', 'running',
      { source: SRC, count: '0%', track: 0 });

    /* ★ 2026-10-18 事故后的加固:扫描链一旦**同步抛错**,必须有人收尾。
     *
     * v26.10.18.1 的 TDZ 现场就是这样坏的:提示发出去了,scanAllRows 里
     * 同步抛错,state.busy 永远停在 true —— 此后每次回车都在
     * `if (state.busy)` 那一关被静默吞掉,用户看到的是「点了有提示、之后再按都没反应」,
     * 只能刷页面。
     * 所以这里兜一层:出错 → 清 busy → 恢复列表位置 → 报到左下角。
     * 宁可多一条错误提示,也不能让功能静默变砖。
     */
    try {
      scanAllRows(function (rows, restore, geo) {
        state.busy = false;

        if (rows.length === 0) {
          restore();
          endSearchModeQuietly();   // 搜索模式结束(故障),开安静期防关再开
          hideSearchUi();
          report('没找到商品列表，无法搜索', 'alert', { source: SRC });
          return;
        }

        const matches = [];
        for (let i = 0; i < rows.length; i++) {
          const row = rows[i];
          // 匹配范围 = 商品名 + 价格(2026-10-14 口径)。
          // 每个关键词都必须命中:要么命中**名称**(普通版 / 紧凑版,**子串匹配** ——
          // 名字里有这个字就能搜到,含款号 10157 里的 0),要么命中**卖点**
          // (#100 附:卖点组独立成组,文本字段按子串 —— 卖点里有这个词就命中;
          // 占位词「设置卖点」在切段侧已剥,绝不会成为命中原因),
          // 要么命中**价格**
          // (价格是纯数字字段,走 priceHit:纯数字只认完整数字段,搜「0」不会
          // 命中 ¥196.00 —— 用户首报「输入 0 能搜到很多东西」的根因;
          // #100 起价格串含行内所有 ¥/$ 段,「|」分隔,段间互不粘连)。
          let ok = true;
          for (let k = 0; k < keywords.length; k++) {
            const kw = keywords[k];
            if (nameHit(row.text, kw) || nameHit(row.ctext, kw)) continue;
            if (nameHit(row.sptext, kw) || nameHit(row.spct, kw)) continue;
            if (priceHit(row.ptext, foldPrice(kw))) continue;
            ok = false;
            break;
          }
          if (ok) matches.push(row.ordinal);
        }

        if (matches.length === 0) {
          restore();
          endSearchModeQuietly();   // 搜索模式结束(未搜到),开安静期防关再开
          hideSearchUi();
          // (2026-10-18:此处原有「事不过三」的 0 结果计数与第 3 次转全能 —— 已删)
          // 搜索无结果是正常结果之一,屏幕上已给出反馈 —— 只弹不收录(2026-10-15 用户定)
          report('没搜到「' + shortKw(raw) + '」，换个关键词试试', 'alert',
            { source: SRC, keepHistory: false });
          return;
        }

        state.matches = matches;
        state.cursor = 0;
        state.geo = geo;      // 直达定位用的行距几何
        state.rows = rows;    // 定位时按名称认行用（见 findByOffsetNow 注释）
        // (2026-10-18:此处原有「事不过三」的单结果计数与空转轮数基准登记 —— 已删)
        showResults(raw);  // 浮动框:展开还是保持收纳,由「输入框是否滚出视口」决定
        jumpToCursor();
      }, function (n, pct) {
        // 搜索中文案 2026-10-12 用户定 B2:合成一句(词 + 进度连读)
        const shown = Math.round(pct * 100);
        report('正在搜索「' + shortKw(raw) + '」……', 'running',
          { source: SRC, count: shown + '%', track: pct });
      });
    } catch (err) {
      // 扫描同步抛错:收尾 + 说清楚,不让 busy 卡死整条链路
      state.busy = false;
      endSearchModeQuietly();
      hideSearchUi();
      try {
        if (typeof window !== 'undefined' && window.__dycDiag
            && typeof window.__dycDiag.noteError === 'function') {
          window.__dycDiag.noteError(String(err && err.message || err), 'search');
        }
      } catch (e2) { /* 记诊断失败不影响收尾 */ }
      report('搜索出错,已中止(可再试一次)', 'alert', { source: SRC });
    }  }

  /**
   * 定位 state.matches[state.cursor] 指向的行。
   *
   * 扫描刚实测过 baseTop / 行距,目标行的容器内偏移是精确已知的 ——
   * **一次直达**,等目标行渲染出来就逐级向外滚进视口 + 呼吸灯。
   * 不再走 locateProduct 的「回顶部 → 重算 → 二次滚」老路(列表会窜两遍)。
   * 地理数据失效(列表被 SPA 重建等)或直达超时时,退回 locateProduct
   * 老路兜底 —— 宁可慢一点,也不瞎跳。
   *
   * @param {boolean} [silent] 2026-10-12 用户定:←→ 切换/同词回车轮跳时
   *        不发消息盒(用户反馈「每次点击都变成一条消息,很复杂」)——
   *        结果看框内 N/M 计数就够;只有搜索完成后的**第一次**定位才报。
   */
  /** 搜索收尾(2026-10-12 修「关闭再开」):对齐 lastVisible 吞掉脚本滚动的
   *  迟发余波信号,此后用户真实滚动照常翻转响应 */
  function endSearchModeQuietly() {
    lastVisible = fabShouldShow();
  }

  function jumpToCursor(silent) {
    const k = state.cursor;
    const ordinal = state.matches[k];
    const total = state.matches.length;
    const geo = state.geo;
    updatePillCount();   // 浮动框计数跟随(箭头/回车轮跳都走这里)

    function succeed(el) {
      // 文案 2026-10-15 用户定方案 B:统一三段式
      //   「来源(弱) ｜ 值(强) ｜ 结果数(弱)」——
      //   来源 = 全能搜索;值 = 商品名;
      //   结果数 = 多命中「1/8」,唯一命中「唯一」。
      // silent 时只标记不进消息盒。
      // standalone: 结果消息独立成层,不与上一条 success 富状态原地合并 ——
      // 3 秒内连搜两次时,两条结果各自留痕(历史盒子可回看)。
      const tag = (total > 1)
        ? ((k + 1) + '/' + total)
        : '唯一';
      // 对齐 lastVisible:定位刚滚过列表,吞掉迟发余波信号,防「关闭再开」
      lastVisible = fabShouldShow();
      // 自动展开(2026-10-12 用户定,十九轮):定位后的滚动位置若已达到
      // 浮动框的浮现条件,直接展开胶囊并把光标切进去 —— 去到后排的
      // 结果不用再手点搜索按钮,顺手就能 [→] 跳下一条;
      // 没达到浮现条件(结果在前排)则维持现状(原生框照常可见)。
      // 2026-10-15 用户定:定位后**自动打开浮动框**(不再看列表滚到哪),
      // 但不抢光标 —— 光标留在原生框,接着按回车就能翻下一个结果。
      if (uiState !== 'shown') {
        lastVisible = true;
        expandPill({ focus: false });
      }
      if (!silent) report(getProductName(el), 'success', { source: searchSource(), count: tag, standalone: true });
      markNameOnRow(el);   // 命中的那几个字变橙(呼吸灯之外的标记)
    }

    /**
     * 最后兜底：按序号让 locateProduct 用等距近似去猜位置。
     *
     * ★ 2026-10-18 增加落点校验：**猜出来的行也必须真的含关键词**。
     *   等距近似在行高不齐的列表上本来就容易偏一行；偏了还照报，
     *   用户拿到的就是「一个完全不相干的商品名」。
     *   所以这里宁可如实说「定位到第 N 个但没确认到关键词」，
     *   也不把错行的名字当结果报出去 —— 报错名字比报错数字更误导。
     */
    function fallback() {
      locateProduct(ordinal, function (r) {
        if (!r.ok) { endSearchModeQuietly(); report(r.message, 'alert', { source: searchSource() }); return; }
        if (!hitsKeywords(r.item)) {
          endSearchModeQuietly();
          report('第 ' + ordinal + ' 个没确认到「' + shortKw(state.lastRaw || '') + '」，可再试一次',
            'alert', { source: searchSource() });
          return;
        }
        succeed(r.item);
      });
    }

    const sc = (geo && geo.scroller && geo.scroller.isConnected) ? geo.scroller : null;
    /* ★ 2026-10-18(#94):定位只认扫描时登记的**精确偏移表**。
     *
     * 为什么删掉「退回首行偏移 + 序号×行距」那条中间路径:
     *   本函数的序号来自**新算法**(按行在列表里的先后顺序实打实地数),
     *   而行距推算出来的位置对应的是**旧算法**的序号语义。两套编号混用,
     *   行高一旦不等就会「查的是第 25 个、跳去的是第 23 个」——
     *   不报错、但落错行,比直接失败更难查。
     *   所以:有表就用表;表没了(容器被 SPA 重建等)就整条退回 fallback,
     *   让 locateProduct 用它自己那套(等距近似)去处理,编号体系不交叉。
     */
    const exactOffset = (geo && geo.offsets && geo.offsets[ordinal] !== undefined)
      ? geo.offsets[ordinal] : null;
    if (!sc || exactOffset === null) {
      fallback();
      return;
    }

    const rowOffset = exactOffset;
    // 该行的行高也一并带上:滚动居中要的是「这一行」的高度,不是名义行距
    const rowH = (geo.heights && geo.heights[ordinal]) || geo.spacing || 40;

    /**
     * 取当前这一屏的行 —— **必须 fresh**。
     *
     * 并集行集合带 250ms 短缓存（为「补涂 / 注入按钮」那种高频重复扫描设计）。
     * 定位的时序恰好相反：刚刚才改过 scrollTop，紧接着就要问「新一屏里有没有
     * 目标行」。若这一次读命中缓存，拿回来的是**滚动前**那一批节点 ——
     * 虚拟列表已经把旧节点移出文档（rect 全 0），于是怎么轮询都等不到 ⇒ 定位超时。
     */
    function rowsFresh() {
      if (typeof getAllProductRows === 'function') {
        try {
          const r = getAllProductRows(true);
          if (r && r.length) return r;
        } catch (e) { /* 退回主路径 */ }
      }
      return (typeof getProductItems === 'function') ? getProductItems() : [];
    }

    /**
     * 目标行在扫描时记下的名称（归一化后）；拿不到返回 ''。
     *
     * 按 `ordinal` **查**而不是用 `rows[ordinal-1]` 取下标 —— 下标写法隐含
     * 「数组连续、从 1 起、无空洞」三个假设，任何一个被将来的改动破坏，
     * 都会静默认错行（比报错难查得多）。
     */
    function wantName() {
      const rows = state.rows;
      if (!rows || !rows.length) return '';
      for (let i = 0; i < rows.length; i++) {
        if (rows[i].ordinal === ordinal) return rows[i].ctext || rows[i].text || '';
      }
      return '';
    }

    function relOf(el, cRect) {
      return el.getBoundingClientRect().top - cRect.top + sc.scrollTop;
    }

    /**
     * 这一行的名称/价格是否真的命中当前全部关键词。
     *
     * ★ 2026-10-18 新增：这是「不许报错行」的最后一道闸。
     *   命名很直白 —— 但它解决的问题很实际：任何一条定位路径（偏移兜底、
     *   locateProduct 兜底）都可能因为行高漂移、虚拟列表重排而落到邻行。
     *   一旦落错，succeed() 就会把**不相干的商品名**写进消息盒子，
     *   而且一个字符都染不出来 —— 用户看到的就是「全是符合不上的内容 +
     *   没有染色」。与其报一个错的结果，不如承认没认到、再试一次。
     *
     * 判据与 runSearch 的匹配口径**逐字同源**（名称子串 / 价格完整数字段），
     * 避免出现「搜的时候算命中、校验的时候算不命中」这种自相矛盾。
     */
    function hitsKeywords(el) {
      const keywords = state.keywords || [];
      if (!keywords.length) return true;   // 没有关键词（不该发生）就不拦
      try {
        const rowText = (el && el.innerText) || '';
        const name = getProductName(el, rowText) || '';
        const sp = getSellPoint(el, rowText) || '';
        const t = normText(name);
        const c = compactText(name);
        const s = normText(sp);           // #100 附:卖点组,与扫描登记同源
        const sc = compactText(sp);
        const p = foldPrice(priceJoinedFromText(rowText) || '');   // #100:所有价格段
        for (let i = 0; i < keywords.length; i++) {
          const kw = keywords[i];
          if (nameHit(t, kw) || nameHit(c, kw)) continue;
          if (nameHit(s, kw) || nameHit(sc, kw)) continue;
          if (priceHit(p, foldPrice(kw))) continue;
          return false;
        }
        return true;
      } catch (e) {
        return true;   // 读不到就当通过，宁可不动也不误杀（异常路径不参与判断）
      }
    }

    /**
     * 在已渲染的行里认目标行 —— **名称优先，偏移兜底**。
     *
     * ★★ 2026-10-18 修「定位超时」（用户：#94 修好之后出现的新问题）。
     *   「只认偏移」这条路必然超时，两个原因各占一半：
     *
     *   ① **缓存拿到旧节点**：见 rowsFresh。
     *   ② **偏移会漂**：扫描时记下的 offset 是扫描那一刻的几何；而扫描过程中
     *      「商品名称不折叠」会陆续把行从单行改成两行 —— 每折一行，它下面
     *      所有行的真实偏移就整体下移一个行高。误差是**累积**的，命中行排得
     *      越靠后偏得越多，超过原来「半行高」的容差就再也认不出来。
     *
     *   实测（`.tmp/verify-1018-locate.js` 的 30 行模型，5 行折行）：
     *     只认偏移 + 半行容差 → 第 4/9/14/19/24 行直接认不出；
     *     即使把容差放到一行高，也会**认错 26 行**（认出来了但停在隔壁商品上，
     *     比超时更难自查）。所以主路径必须是名称。
     *
     * 两步：
     *   · 先按**名称**认：名称来自扫描结果，与几何无关；同名多行时取偏移最接近
     *     目标的那一行，不会跳去隔壁同名商品。
     *   · 名称认不出（名称读空等）才用偏移：容差放宽到一行高，并优先取
     *     「偏移不小于目标」的第一个（漂移只会让真实位置变大）。
     */
    function findByOffsetNow() {
      const list = rowsFresh();
      if (!list.length) return null;
      const cRect = sc.getBoundingClientRect();

      const want = wantName();
      if (want) {
        let nameBest = null;
        let nameBestDiff = Infinity;
        for (let i = 0; i < list.length; i++) {
          const raw = list[i].innerText || '';
          const t = normText(getProductName(list[i], raw));
          const c = compactText(getProductName(list[i], raw));
          if (t !== want && c !== want) continue;
          const diff = Math.abs(relOf(list[i], cRect) - rowOffset);
          if (diff < nameBestDiff) { nameBestDiff = diff; nameBest = list[i]; }
        }
        if (nameBest) return nameBest;
      }

      let best = null;
      let bestDiff = Infinity;
      let firstNotLess = null;
      let firstNotLessDiff = Infinity;
      for (let i = 0; i < list.length; i++) {
        const d = relOf(list[i], cRect) - rowOffset;
        const diff = Math.abs(d);
        if (diff < bestDiff) { bestDiff = diff; best = list[i]; }
        if (d >= -2 && diff < firstNotLessDiff) { firstNotLessDiff = diff; firstNotLess = list[i]; }
      }
      /* ★ 2026-10-18：偏移兜底也必须过一道「名字真的含关键词」的验。
       *   用户报「搜数字出现的全是符合不上的内容」就是从这里漏出去的：
       *   偏移漂了之后，「最近的」那个可能根本不是目标行，一旦返回它，
       *   后面的 succeed() 就把**那一行的商品名**当结果报出来 ——
       *   用户看到的自然全是无关商品，染色也标不出来。
       *   宁可认不出（→ 走漂移校正，还能救回来），也不能报错行。 */
      const tol = Math.max(rowH, 40);   // 一行高（原来是半行高，盖不住累积漂移）
      if (firstNotLess && firstNotLessDiff <= tol && hitsKeywords(firstNotLess)) return firstNotLess;
      if (best && bestDiff <= tol && hitsKeywords(best)) return best;
      return null;
    }

    /**
     * 估算「真实偏移 − 扫描时偏移」的漂移量。
     *
     * 为什么需要它（这是「定位超时」的最后一块拼图）：
     *   上面那套「名称优先」只能判断**当前这一屏**里有没有目标行。可初始滚动位置
     *   是用漂移过的偏移算出来的 —— 漂得厉害时，目标行根本不在这一屏里，
     *   名称再好也认不到，最后还是走到 locateProduct（等距近似）再超时一次。
     *
     * 怎么估：
     *   拿屏幕上任意几行去扫描表里查它们的名称，查到就同时有了「它的扫描偏移」
     *   与「它的真实偏移」，两者之差就是这一刻的漂移量。取中位数抗个别读错。
     *   一行都查不到（整屏都是扫描后新增的）时才放弃 —— 那种情况实在没有依据。
     *
     * @returns {number|null} 漂移像素（正数=真实位置更靠下）；估不出来返回 null
     */
    function driftEstimate(list, cRect) {
      const rows = state.rows;
      if (!rows || !rows.length) return null;

      /* 同名行（同款不同规格）不能用来估漂移 —— 用名称查表会查到「另一行」的
       * 扫描偏移，算出来的差值纯属噪声。所以只保留**全表唯一**的名称。 */
      const map = {};
      const dup = {};
      for (let i = 0; i < rows.length; i++) {
        const k = rows[i].ctext || rows[i].text;
        if (!k) continue;
        if (map[k] === undefined) map[k] = rows[i].offset;
        else dup[k] = 1;
      }

      const ds = [];
      for (let i = 0; i < list.length; i++) {
        const raw = list[i].innerText || '';
        const name = getProductName(list[i], raw);
        const k1 = normText(name);
        const k2 = compactText(name);
        const key = (map[k1] !== undefined && !dup[k1]) ? k1
          : ((map[k2] !== undefined && !dup[k2]) ? k2 : '');
        if (!key) continue;
        ds.push(relOf(list[i], cRect) - map[key]);
      }
      if (!ds.length) return null;
      // 中位数：个别读错（名称切歪、行识别偏）不影响整体
      ds.sort(function (a, b) { return a - b; });
      return ds[Math.floor(ds.length / 2)];
    }

    /** 把目标行摆到视口中部（按当前认为的偏移） */
    function aimAt(offset) {
      const maxScroll = sc.scrollHeight - sc.clientHeight;
      const t = Math.max(0, Math.min(offset - (sc.clientHeight / 2 - rowH / 2), maxScroll));
      window.__dycScriptScrollAt = scriptScrollAt = Date.now();
      sc.scrollTop = t;
    }

    /**
     * 定位主循环：认行 → 认不到就校正一次漂移再认。
     *
     * 最多校正 2 轮。每轮都重新估漂移（校正后屏幕变了，漂移的样本也变了），
     * 所以即使第一次估得不准，第二轮也能收敛 —— 这比「一次猜到底」稳得多，
     * 也比一直轮询到超时有用（超时是用户能看到的失败，校正往往是静默成功的）。
     */
    let hitEl = null;
    let tries = 0;          // 已做的漂移校正次数
    let waits = 0;          // 已做的「纯等待」次数
    const MAX_FIX = 2;
    const MAX_WAIT = 2;

    function attempt() {
      const list = rowsFresh();
      const cRect = sc.getBoundingClientRect();
      hitEl = findByOffsetNow();
      if (hitEl) { settleOn(hitEl); return; }

      if (tries >= MAX_FIX) { fallback(); return; }   // 校正机会用完 → 老路兜底

      const drift = driftEstimate(list, cRect);
      if (drift === null || Math.abs(drift) < 8) {
        /* ★ 漂移≈0 有**两种**可能，必须分开处理：
         *   ① 位置本来就对，只是目标行还没渲染出来（平台卡顿 / 虚拟列表慢）；
         *   ② 位置对、行也渲染了，但确实认不出（名称读空等）。
         *   上一版一律当 ② 直接 fallback —— 遇到 ① 就会**白白放弃一个本来
         *   能中的定位**（fallback 走的是等距近似，比名称优先差一截）。
         *   所以先给它 MAX_WAIT 次「什么都不动、只再等一会」的机会，用完才兜底。 */
        if (waits < MAX_WAIT) {
          waits++;
          fastWait(function () { return rowsFresh().length > 0; }, attempt, 300);
          return;
        }
        fallback();
        return;
      }
      tries++;
      waits = 0;   // 一旦真的做了校正，纯等待的额度重置（情况变了）
      aimAt(rowOffset + drift);
      // 等这一屏渲染出来再看（虚拟列表换屏需要一两帧）
      fastWait(function () { return rowsFresh().length > 0; }, attempt, 400);
    }

    function settleOn(el) {
      // 内层已经直达,这里只补「逐级向外滚进浏览器视口」那一半
      scrollElementToViewportCenter(el);
      highlight(el);
      succeed(el);
    }

    /* ★★ 2026-10-18 关键修复：**先把列表滚到目标附近，再去认行**。
     *
     *   这是我 21:5x 重构「漂移自校正」时**误删**的一步。原实现（5bde0e7^）里有：
     *       const target = clamp(rowOffset - (clientHeight/2 - rowH/2));
     *       sc.scrollTop = target;
     *   而重构后只剩「认行 → 认不到就估漂移再瞄准」，第一次尝试时列表仍停在
     *   **扫描结束的位置**（列表尾部）。目标是前排商品时它压根不在这一屏里 ——
     *   名称再好也认不到 ⇒ 走 fallback（locateProduct 的等距近似）⇒ 按行距
     *   猜出一个位置 ⇒ **落错行**。
     *
     *   用户看到的现象正是这个：「搜数字，出现的全都是不符合的内容，
     *   没有任何一个关键词对得上，而且没有做关键词染色」——
     *   落错行 ⇒ 消息盒子报的是那一行的商品名（与关键词无关）；
     *   染色也标不出来，因为那一行的名称里确实没有这些字。
     *
     *   所以顺序必须是：**先滚动到位 → 再认行 → 认不到才校正**。
     */
    aimAt(rowOffset);

    /* 先给一次「不校正」的机会（多数情况一次就中），再进入校正循环。
     *
     * 等待第一轮只给 200ms（约 6 帧）：虚拟列表换屏一两帧就够，
     * 超过这个时间还认不到，基本就不是「还没渲染」而是「位置偏了」——
     * 那时候早点进校正循环比在那干等 600ms 强得多。
     * （自检场景 4 实测：600ms 时整轮要 630ms，改 200ms 后降到约 230ms。） */
    fastWait(function () {
      hitEl = findByOffsetNow();
      return hitEl !== null;
    }, function () {
      if (hitEl) { settleOn(hitEl); return; }
      attempt();
    }, 200);
  }

  // ---------------- 浮动搜索 UI(五轮) ----------------
  //
  // 结构(见文件头【五轮】一节):
  //   #dyc-search-fab   正中下方 52.8px 圆形按钮,与【回到顶部】同款设计
  //   #dyc-search-pill  胶囊搜索框,收拢时就是一枚同样的圆,
  //                     展开 = 从中心向左右两侧撑开(52.8 → 400px)
  // 要点:
  //   · 全部元素用 createElement 构建、引用握在自己手里,
  //     沙箱自测能直接拿到同一批节点;
  //   · 动画全部走内联样式 + transition(不依赖 classList 的切换驱动,
  //     沙箱的假元素也能驱动同一套代码路径);
  //   · 收拢动画收尾后才把按钮请回来,避免两个圆叠影。

  /** 把词写进平台输入框。React 受控组件必须走原生 setter + input 事件才认账 */
  function mirrorToPlatformInput(input, value) {
    try {
      const desc = window.HTMLInputElement
        ? Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')
        : null;
      if (desc && desc.set) desc.set.call(input, value);
      else input.value = value;
      if (typeof input.dispatchEvent === 'function') {
        input.dispatchEvent(new window.Event('input', { bubbles: true }));
      }
    } catch (e) {
      try { input.value = value; } catch (e2) { /* 尽力而为 */ }
    }
  }

  /**
   * 触发平台**原生**搜索(二十二轮):胶囊的回车 / 搜索键都走这里。
   * ① 把词同步进平台框(镜像);② 向平台框派发一个真实 Enter keydown
   * ( bubbles,不 capture 不拦) —— 平台自己的监听收到就走原生搜索,
   * 速度与用户在平台框里按回车完全一样。
   * 平台框不在(改版/未渲染)时退回全能扫描兜底 —— 宁可多花几秒,不失效。
   */
  /* 标志:当前这次 Enter 是**扩展自己派发**的(转发平台搜索)。
   * 为什么需要:回车跳下一个结果会拦「原生框里的回车」,而转发搜索用的正是同一个
   * 派发路径 —— 不区分的话,「词没改 + 箭头在」时我们自己派发的回车会被
   * 自己的导航接管,变成「翻下一个」而不是「搜索」。
   * dispatchEvent 是同步的,所以 try/finally 足够(不需要 setTimeout 复位)。 */
  let dispatchingPlatformEnter = false;

  function firePlatformSearch(raw) {
    const input = state.platformInput;
    if (!input || !input.isConnected) {
      startOmniSearch(raw, (pill && pill.input) || null);
      return;
    }
    mirrorToPlatformInput(input, raw);
    // 先清「原生结果态」:这次是**新发起**的搜索,不是在上次结果里翻页。
    // (随后我们派发的 Enter 会走到 flashAfterNativeSearch 里重新写回它。)
    state.nativeRaw = null;
    const opts = {
      key: 'Enter', code: 'Enter', keyCode: 13, which: 13,
      bubbles: true, cancelable: true,
    };
    dispatchingPlatformEnter = true;
    try {
      const e = new window.KeyboardEvent('keydown', opts);
      input.dispatchEvent(e);
      // 平台若只听 keypress/keyup,补发这两个(重复 keydown 无害)
      input.dispatchEvent(new window.KeyboardEvent('keypress', opts));
      input.dispatchEvent(new window.KeyboardEvent('keyup', opts));
    } catch (e2) {
      // 兜底:直接点平台放大镜按钮(input 右侧第一个可视兄弟)
      try {
        const wrap = input.parentElement;
        if (wrap) {
          const kids = wrap.children;
          for (let i = 0; i < kids.length; i++) {
            const s = kids[i];
            if (s !== input && s.getBoundingClientRect().width > 0) {
              s.click(); break;
            }
          }
        }
      } catch (e3) { /* 尽力而为 */ }
    } finally {
      dispatchingPlatformEnter = false;
    }
  }

  /** 清空两个搜索框(胶囊「清空」与平台框「清空」共用);结果态一并复位 */
  function clearAllInputs() {
    if (pill) pill.input.value = '';
    if (state.platformInput) mirrorToPlatformInput(state.platformInput, '');
    state.nativeRaw = null;      // 清空 ⇒ 不再是任何搜索的结果
    setOmniLensActive(false);    // 放大镜恢复无色
    resetMatchState();
    syncPillNavState();          // 浮动框 [←][→] 解除禁用
  }

  /**
   * 平台搜索框右侧的【全能搜索】按钮(二十二轮,方案 C 配色:白底+蓝放大镜)。
   * 插法 = **文档流内的兄弟节点**:挂在 input 的父容器末尾(平台放大镜
   * 键之后),由平台自己的 flex/布局排版 —— 不绝对定位、不压进容器内部,
   * 原有元素平等右移,不存在跑位。
   * ★ 跑位教训永久记录:旧「清空」按钮用绝对定位塞进带边框容器,
   *   包含块被平台 transform 祖先劫走,三轮修复仍反复错位(2026-10-12
   *   用户截图)。本按钮的兄弟节点插法是根治方案,后续维护**不要**
   *   改回绝对定位。
   *
   * 【三修:样式表 !important + span 外壳(2026-10-12 用户再截图:仍竖排)】
   *   二修的内联逐属性重置仍输 —— 平台全局按钮规则带 !important 或
   *   优先级更高(定宽窄容器 + white-space:normal → 竖排三行)。
   *   根治两手:
   *   ① 外面包一层 <span> 壳:平台的选择器直接命中的是壳(button 标签
   *      选择器够不着壳内),壳由我们全权控制;
   *   ② 按钮样式改为 **注入样式表 + !important**(ID 选择器 +
   *      !important = 最高优先级,压平台一切规则)。
   *   壳在文档流内(兄弟节点插法不变,跑位教训依然有效)。
   */
  const OMNI_BTN_CSS = [
    '#dyc-omni-shell {',
    '  display: inline-flex !important;',
    '  align-items: center !important;',
    '  flex: none !important;',
    '  margin: 0 !important; padding: 0 !important;',
    '  border: none !important; background: transparent !important;',
    '  box-shadow: none !important; float: none !important;',
    '  position: static !important; width: auto !important;',
    '  height: auto !important; max-height: none !important;',
    '  overflow: visible !important;',
    '}',
    '#dyc-omni-shell #dyc-omni-btn {',
    '  display: inline-flex !important;',
    '  align-items: center !important; justify-content: center !important;',
    '  gap: 5px !important; flex: none !important;',
    '  box-sizing: border-box !important;',
    '  margin: 0 !important; padding: 0 12px !important;',
    '  height: 32px !important; min-height: 0 !important; max-height: none !important;',
    '  font-size: 13px !important; line-height: 32px !important;',
    '  color: #1d2129 !important; font-weight: normal !important;',
    '  white-space: nowrap !important; word-break: keep-all !important;',
    '  background: #ffffff !important;',
    '  border: 0.5px solid rgba(0,0,0,0.25) !important;',
    '  border-radius: 4px !important; box-shadow: none !important; outline: none !important;',
    '  cursor: pointer !important; vertical-align: middle !important; float: none !important;',
    '  position: static !important; transform: none !important;',
    '  opacity: 1 !important; visibility: visible !important;',
    '  width: auto !important; min-width: 0 !important; max-width: none !important;',
    '  text-align: center !important; text-indent: 0 !important;',
    '  letter-spacing: normal !important; writing-mode: horizontal-tb !important;',
    '  z-index: auto !important; direction: ltr !important;',
    '  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Helvetica Neue", Helvetica, Arial, sans-serif !important;',
    '  font-variant: normal !important; font-variant-numeric: normal !important;',
    '  text-transform: none !important;',
    '}',
    '#dyc-omni-shell #dyc-omni-btn:hover { background: #f5f6f7 !important; }',
    '#dyc-omni-shell #dyc-omni-btn:active { background: #ecedee !important; }',
    /* 全能搜索接手后的**整块高亮**(2026-10-15 用户定 · 方案 A 淡蓝底):
       底色淡蓝 + 边框与文字变蓝。放在 hover/active 之后 —— 全能态恒为淡蓝,
       但保留一档更深的悬停反馈。 */
    '#dyc-omni-shell #dyc-omni-btn.dyc-omni-on {',
    '  background: #E6F1FB !important;',
    '  border-color: #185FA5 !important;',
    '  color: #185FA5 !important;',
    '}',
    '#dyc-omni-shell #dyc-omni-btn.dyc-omni-on:hover {',
    '  background: #D8E8F7 !important;',
    '}',
    '#dyc-omni-shell #dyc-omni-btn .dyc-omni-text {',
    '  display: inline-block !important; vertical-align: baseline !important;',
    '  line-height: 1 !important; font-size: inherit !important;',
    '}',
  ].join('\n');

  function ensureOmniBtnStyle() {
    if (document.getElementById('dyc-omni-btn-style')) return;
    const style = document.createElement('style');
    style.id = 'dyc-omni-btn-style';
    style.textContent = OMNI_BTN_CSS;
    (document.head || document.documentElement).appendChild(style);
  }

  /**
   * 按钮是否「健在且看得见」（2026-10-19 修 #97）。
   *
   * 为什么不能只看 `__dycOmniBtn.isConnected`：
   *   ① 平台重建搜索区时把壳连同按钮一起丢掉，但 input 节点被复用 ⇒
   *      接管标记还留在 input 上，之后的扫描/聚焦全部早退，
   *      **再没有任何人负责补插** —— 用户看到的就是「按钮不见了」；
   *   ② 落点自校准可能把壳塞进一个隐藏祖先，节点 connected 却没有面积，
   *      同样是「看不见」。
   *
   * 判据：壳与按钮都在文档里；且**当输入框自己有面积时**，壳也必须有面积
   *   （输入框自己没面积 = 整块没显示或量不到，不做此判据，避免误判后重插）。
   */
  function omniBtnHealthy(el) {
    const shell = el.__dycOmniShell, btn = el.__dycOmniBtn;
    if (!shell || !btn || !shell.isConnected || !btn.isConnected) return false;
    try {
      const er = el.getBoundingClientRect();
      if (er && er.width > 0 && er.height > 0) {
        const sr = shell.getBoundingClientRect();
        if (!sr || sr.width <= 0 || sr.height <= 0) return false;
      }
    } catch (e) { /* 量不到就按健在算，宁可不动 */ }
    return true;
  }

  function addOmnisearchButton(el) {
    /* 唯一创建点，作用域判定放这里最彻底（2026-11-06）：兜底自愈表、开关回声、
       任何调用方都不可能在这条路径之外把按钮插到别页上。 */
    if (typeof dycIsLiveControl === 'function' && !dycIsLiveControl()) return;
    if (omniBtnHealthy(el)) return;
    /* 不健康：先把残骸摘干净再重插，否则同页会留下第二枚
     * （只摘我们自己创建的节点，绝不碰平台元素）。 */
    if (el.__dycOmniShell) {
      try { el.__dycOmniShell.remove(); } catch (e0) { /* 尽力而为 */ }
      el.__dycOmniShell = null;
    }
    if (el.__dycOmniBtn) {
      try { el.__dycOmniBtn.remove(); } catch (e1) { /* 尽力而为 */ }
      el.__dycOmniBtn = null;
    }
    ensureOmniBtnStyle();
    /**
     * 【六修:锚定「真正的行容器」+ 插入后实测自校准(2026-10-12)】
     *
     * 五修为何仍然错位(用户截图,本机像素实测 1112×183):
     *   壳 y74-121、中心 97.5;同行的输入框/序号/定位/全选中心线都在
     *   y≈122 —— 壳比整行基线高 24.5px(半个按钮高);「筛选」按钮则在
     *   壳正下方(y≈135 起)。三者水平位置几乎重合、垂直错开一整行,
     *   是**竖排(column)包装层**的特征,不是横排行容器。
     *   → 说明 `.product-collection-trigger-button` 的 parentElement
     *     并不等于行容器;靠猜层数(四修 header-)、猜某层语义(五修
     *     parentElement)都不成立。类名 hash 会漂,层级语义也会变。
     *
     * 六修改判据,不再猜:
     *   ① **真行容器判据** —— 从输入框向上找第一个「display 为 row 方向
     *      flex,且同时包含输入框与筛选按钮」的祖先。这一层按定义就是
     *      两者共处的那一行,插进去必然同行、不与输入框抢空间;
     *   ② **插入后实测自校准** —— 插完量壳与输入框的垂直中心差,>6px
     *      就换下一个候选层重插;全部不合格保留最优落点 + relative
     *      微调兜底(relative 不脱离文档流,满足「固定按钮不要浮动」);
     *   ③ 没有筛选按钮锚点时退回原插法(wrap 末尾),不比旧版更糟。
     * 假元素 rect 全 0(沙箱/离屏)时自校准自动跳过,保留默认落点。
     */
    const wrap = el.parentElement;
    if (!wrap) return;
    // span 外壳:平台 button 元素选择器够不着壳内,壳内样式全归我们
    const shell = document.createElement('span');
    shell.id = 'dyc-omni-shell';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.id = 'dyc-omni-btn';
    // 悬停说明 = 浮动搜索框里的那句提示（同一常量 PH_OURS，改一处两处齐变）
    btn.setAttribute('title', PH_OURS);
    btn.setAttribute('data-dyc-omni-btn', '1');
    btn.innerHTML = '<svg width="13" height="13" viewBox="0 0 14 14" aria-hidden="true" style="display:block;flex:none">'
      + '<circle cx="6" cy="6" r="4" fill="none" stroke="#888780" stroke-width="1.6"/>'
      + '<path d="M9 9L12.5 12.5" stroke="#888780" stroke-width="1.6" stroke-linecap="round"/></svg>'
      + '<span class="dyc-omni-text">全能搜索</span>';
    btn.addEventListener('click', function (e) {
      if (e && e.stopPropagation) e.stopPropagation();
      // 读「按钮所属的那个原生框」的内容（2026-10-14 修 #77）——
      // 不再依赖缓存的 state.platformInput，见 nativeQueryOf 注释。
      const raw = nativeQueryOf(el);
      if (!raw) {
        report('先在搜索框输入关键词', 'info', { source: '全能搜索' });
        return;
      }
      startOmniSearch(raw, el);
    });
    shell.appendChild(btn);
    placeOmniShell(el, shell);
    el.__dycOmniBtn = btn;
    el.__dycOmniShell = shell;
    syncOmniBtnSize(el, btn);
    // 平台首帧布局/字体加载会改变输入框高度与容器位置,稍后多次
    // 「对齐高度 + 复检落点」—— 五修正是首帧量到 0 值后落进错层,
    // 之后再无纠正机会,错位就一直留着。
    [300, 1200, 3000].forEach(function (ms) {
      setTimeout(function () {
        syncOmniBtnSize(el, btn);
        recheckOmniPlacement(el, shell);
      }, ms);
    });
  }

  /* ---- 六修:壳的落点(真行容器 + 自校准) ---- */

  /** 元素 rect 的垂直中心;拿不到有效 rect(假元素/离屏)返回 null */
  function rectCenterY(node) {
    try {
      if (!node || typeof node.getBoundingClientRect !== 'function') return null;
      const r = node.getBoundingClientRect();
      if (!r) return null;
      if (!r.height && !r.top && !r.bottom) return null;   // 全 0 = 无布局信息
      return (r.top + r.bottom) / 2;
    } catch (e) { return null; }
  }

  /** 该元素是否为 row 方向的 flex 容器(真「行」的必要条件) */
  function isRowFlex(node) {
    try {
      if (typeof getComputedStyle !== 'function') return false;
      const st = getComputedStyle(node);
      if (!st) return false;
      const d = st.display;
      if (d !== 'flex' && d !== 'inline-flex') return false;
      return st.flexDirection === 'row' || st.flexDirection === 'row-reverse';
    } catch (e) { return false; }
  }

  /** 平台「筛选」按钮(auxo 组件类名,非构建哈希) */
  function omniTrigger() {
    try { return document.querySelector('.product-collection-trigger-button'); }
    catch (e) { return null; }
  }

  /** 插入:尽量紧邻筛选按钮之前(左),拿不到参照就追加到 host 末尾 */
  function insertShell(host, shell, trigger) {
    let ref = null;
    try {
      if (trigger) {
        let a = trigger;
        while (a && a.parentElement && a.parentElement !== host) a = a.parentElement;
        if (a && a.parentElement === host) ref = a;
      }
      if (ref && typeof host.insertBefore === 'function') host.insertBefore(shell, ref);
      else host.appendChild(shell);
    } catch (e) {
      try { host.appendChild(shell); } catch (e2) { /* 尽力而为 */ }
    }
  }

  /**
   * 把壳放进「与输入框同一行」的容器(见 addOmnisearchButton 注释 ①②)。
   * 返回最终落点容器,供测试与诊断使用。
   */
  function placeOmniShell(el, shell) {
    const wrap = el.parentElement;
    const trigger = omniTrigger();

    // 候选:同时包含「输入框」与「筛选按钮」的祖先,由近到远。
    // 有筛选按钮时才做这个收窄 —— 没有它就无法确认哪一层是行,
    // 退回原插法反而更安全(不会更糟)。
    const near = [];
    if (trigger) {
      let n = wrap;
      let guard = 0;
      while (n && n !== document.body && guard++ < 15) {
        if (n.contains(trigger)) near.push(n);
        n = n.parentElement;
      }
    }
    if (!near.length) near.push(wrap);

    // 横排 flex 优先(真行容器),同组内保持由近到远
    const rows = [], rest = [];
    near.forEach(function (node) { (isRowFlex(node) ? rows : rest).push(node); });
    const cands = rows.concat(rest);

    const baseY = rectCenterY(el);          // 基线 = 输入框中心(与整行一致)
    let bestHost = cands[0];
    let bestDiff = Infinity;
    let current = null;                     // 最后一次真正落进去的层

    for (let i = 0; i < cands.length; i++) {
      const host = cands[i];
      insertShell(host, shell, trigger);
      current = host;
      if (baseY === null) { bestHost = host; bestDiff = 0; break; }  // 量不到:首个候选即定
      const cy = rectCenterY(shell);
      if (cy === null) { bestHost = host; bestDiff = 0; break; }
      const d = Math.abs(cy - baseY);
      if (d < bestDiff) { bestDiff = d; bestHost = host; }
      if (d <= 6) break;                    // 已在同一行,收工
    }

    // 最优落点不是最后停下的那个,就搬回去
    // (不用 shell.parentElement 判断:假元素桩不维护它,改用循环记录)
    if (bestHost && current && bestHost !== current) {
      insertShell(bestHost, shell, trigger);
    }

    // 兜底:全都不在同一行 → relative 微调(不脱离文档流)
    if (baseY !== null) {
      const cy = rectCenterY(shell);
      if (cy !== null && Math.abs(cy - baseY) > 1) {
        const off = (baseY - cy).toFixed(1) + 'px';
        try {
          // 必须内联 !important:样式表里写的 `position: static !important`
          // 会压过普通内联样式(内联 !important 才是最高优先级)
          shell.style.setProperty('position', 'relative', 'important');
          shell.style.setProperty('top', off, 'important');
        } catch (e) {
          shell.style.position = 'relative';
          shell.style.top = off;
        }
      }
    }

    if (typeof console !== 'undefined' && console.log) {
      console.log('[DYC-OMNI] 壳落点 host=' + (bestHost && bestHost.tagName ? bestHost.tagName : '?')
        + '.' + (bestHost && bestHost.className ? bestHost.className : '')
        + ' 与输入框中心差=' + (bestDiff === Infinity ? 'n/a' : bestDiff.toFixed(1)) + 'px');
    }
    return bestHost;
  }

  /**
   * 首帧之后复检落点:平台布局/字体加载完成时,壳可能落错了行
   * (rect 无效导致自校准跳过)。偏差 >6px 就清掉微调、重新选层。
   */
  function recheckOmniPlacement(el, shell) {
    try {
      if (!shell || !shell.isConnected || !shell.parentElement) return;
      const baseY = rectCenterY(el);
      const cy = rectCenterY(shell);
      if (baseY === null || cy === null) return;
      if (Math.abs(cy - baseY) <= 6) return;
      try {
        shell.style.removeProperty('position');
        shell.style.removeProperty('top');
      } catch (e0) {
        shell.style.position = '';
        shell.style.top = '';
      }
      shell.remove();
      placeOmniShell(el, shell);
    } catch (e) { /* 尽力而为 */ }
  }

  /**
   * 全能按钮高度对齐输入框(二修):实测输入框 rect,按钮 height 取同值,
   * 垂直基线自然齐平。只写自己按钮的 height,不碰平台任何元素。
   * (沙箱假元素 rect 全 0 时不动作,保留 32px 兜底。)
   */
  function syncOmniBtnSize(el, btn) {
    try {
      if (!btn || !btn.isConnected) return;
      const r = el.getBoundingClientRect();
      if (!r || r.height <= 0) return;
      const h = Math.round(r.height);
      btn.style.height = h + 'px';
      btn.style.lineHeight = h + 'px';
    } catch (e) { /* 尽力而为 */ }
  }

  /** 全能搜索功能关掉时,把平台框上的全能按钮(含外壳)摘掉 */
  function removeAllOmniButtons() {
    try {
      const marked = document.querySelectorAll('input[' + ATTR_OURS + ']');
      for (const el of marked) {
        // 三修:外壳一并摘(壳在,按钮就还在文档里)
        const shell = el.__dycOmniShell;
        if (shell) {
          try { shell.remove(); } catch (e0) { /* 尽力而为 */ }
          el.__dycOmniShell = null;
        }
        if (el.__dycOmniBtn) {
          try { el.__dycOmniBtn.remove(); } catch (e) { /* 尽力而为 */ }
          el.__dycOmniBtn = null;
        }
      }
    } catch (e) { /* 尽力而为 */ }
    removeAllOmniShells();
  }

  /**
   * 按固定 id / 属性全量摘掉【全能搜索】按钮的壳(2026-11-06)。
   *
   * 为什么不能只靠上面那圈遍历:它遍历的是 `input[data-dyc-search]`,
   * 而平台重建搜索区时会把被打过标记的输入框整个换掉 —— 旧节点一脱离 DOM,
   * 挂在它旁边的壳就再也遍历不到,按钮永久留在页面上(用户报:从中控台切到
   * 橱窗商品管理页后,该页仍留着【全能搜索】按钮)。
   * 壳与按钮本身都有固定 id / 属性,按它们全量清,不依赖输入框还在不在。
   * 只摘我们自己建的节点(id 是 dyc- 前缀),绝不碰平台元素。
   */
  function removeAllOmniShells() {
    try {
      const nodes = document.querySelectorAll('#dyc-omni-shell, [data-dyc-omni-btn]');
      for (const n of nodes) {
        try { n.remove(); } catch (e) { /* 尽力而为 */ }
      }
    } catch (e) { /* 尽力而为 */ }
  }

  /**
   * 结果循环切换(模块级,2026-10-12 从 buildPill 提出):胶囊内外的
   * ←→ 共用同一条路径 —— state.cursor 循环步进 + 计数刷新 + 直达定位。
   * silent=true(用户定):切换不发消息盒,结果看胶囊 N/M 计数就够。
   */
  function cycleMatches(delta) {
    if (state.matches.length === 0) return;
    state.cursor = (state.cursor + delta + state.matches.length) % state.matches.length;
    updatePillCount();
    jumpToCursor(true);
  }

  /** 清空时结果态一并复位:计数 0/0,下次搜索重新计数 */
  function resetMatchState() {
    state.matches = [];
    state.cursor = 0;
    state.lastRaw = null;
    updatePillCount();
  }


  /**
   * 浮动搜索按钮浮现判定(2026-10-13 用户定稿,抖店 / 巨量百应通用):
   *   判据 = **商品列表第 4 行是否已完整露出屏幕**:
   *     · 屏幕下方能看到完整的第 4 行 → **显示**;
   *     · 还没到这个高度(第 4 行没露全)→ **隐藏**。
   *
   *   算法(纯几何,不比对任何容器的 scrollTop 阈值):
   *     第 4 行底边的屏幕纵坐标
   *       = 列表容器顶边 + (第1行容器内偏移 + 3×行距 + 行高) - 已滚动量
   *     ≤ 屏幕底边(与列表可视底边取小)即「完整露出」。
   *   随列表滚动单调:一露出来就一直显示,滚到底也显示。
   *   行几何(首行偏移/行距/行高)是**不随滚动变化**的量,
   *   缓存 1 秒复用,滚动每帧只读 1 次容器 rect;
   *   量不到列表 / 行距 / 行高 → 不隐藏。
   */
  const FAB_SHOW_ROW = 4;        // 「能完整看到第几行」就浮现(用户 2026-10-13 定)
  const FAB_GEO_TTL = 1000;      // 行几何缓存有效期(ms)
  let fabGeoAt = 0;
  let fabGeo = null;             // {sc, rows:[{top,bottom,h}]}  2026-10-18 起存实测行位

  /** 量一次行几何:首行容器内偏移 / 行距 / 行高(读布局,已缓存) */
  function fabRowGeo() {
    const sc = (typeof getScrollContainer === 'function') ? getScrollContainer() : null;
    if (!sc) return null;
    const now = Date.now();
    if (fabGeo && fabGeo.sc === sc && (now - fabGeoAt) < FAB_GEO_TTL) return fabGeo;

    /* ★ 2026-10-18(#94):不再用「首行偏移 + 第 N 行 × 行距」推算第 4 行位置。
     *   那是等距假设的又一处残留 —— 名字折行的行比名义行距高,累计误差会让
     *   「第 4 行是否完整露出」判错:要么提前浮出、要么该出不出。
     *   现在直接**按偏移排序取第 FAB_SHOW_ROW 个**渲染行,量它自己的底边。
     *   可视区常驻约 8 行,排序开销可以忽略。
     */
    const items = (typeof getProductItems === 'function') ? getProductItems() : [];
    if (items.length === 0) { fabGeo = null; return null; }

    let cRect = null;
    try { cRect = sc.getBoundingClientRect(); } catch (e) { cRect = null; }
    if (!cRect) return null;

    const rows = [];
    for (let i = 0; i < items.length; i++) {
      let r = null;
      try { r = items[i].getBoundingClientRect(); } catch (e2) { r = null; }
      if (!r || !(r.height > 0)) continue;
      rows.push({ top: r.top, bottom: r.bottom, h: r.height });
    }
    if (rows.length === 0) { fabGeo = null; return null; }
    rows.sort(function (a, b) { return a.top - b.top; });

    fabGeo = { sc: sc, rows: rows };
    fabGeoAt = now;
    return fabGeo;
  }

  function fabShouldShow() {
    try {
      /* ★ 2026-10-18：**列表还没就绪 ⇒ 一律不显示**。
       *   原来这一条落到下面 `if (!geo) return true` 的 fail-open 分支里,
       *   于是「页面还在加载」与「页面结构变了」被当成同一件事。
       *   两者必须分开:
       *     · 列表没就绪 → 不显示（用户看到的就是 bug：什么都没准备就先露脸）;
       *     · 列表就绪、只是量不到几何 → 显示（fail-open 保持不变，
       *       防平台改版把按钮整个弄没）。
       */
      if (!listReady()) return false;

      const geo = fabRowGeo();
      if (!geo) return true;                      // 就绪但量不到几何 → 不隐藏
      const rows = geo.rows;
      // 渲染行不足 FAB_SHOW_ROW 个 ⇒ 列表总共就这么点,直接显示(否则会在
      // 「一共 2 个商品」的短列表上永远不浮出)
      const pick = rows[Math.min(FAB_SHOW_ROW, rows.length) - 1];
      if (!pick) return true;

      let limit = window.innerHeight;             // 屏幕底边
      let cRect = null;
      try { cRect = geo.sc.getBoundingClientRect(); } catch (e) { cRect = null; }
      if (cRect) {
        const scBottom = cRect.top + geo.sc.clientHeight;
        if (scBottom < limit) limit = scBottom;   // 不超出列表自己的可视底边
      }
      return pick.bottom <= limit;   // 第 4 行已完整露出 → 显示
    } catch (e) { /* 高频路径,绝不抛错 */ }
    return true;   // 异常 → 不隐藏
  }

  /* 缩放口径(2026-10-11 用户 22:0x 定稿):两个浮动按钮跟随页面缩放,
   * 与普通页面元素同权 —— 此前「BASE_DPR 基准式 zoom 补偿」
   * (applyUiZoom)已整体删除,缩放/刷新后观感永远一致。 */

  function ensureUiStyle() {
    if (document.getElementById('dyc-search-ui-style')) return;
    const style = document.createElement('style');
    style.id = 'dyc-search-ui-style';
    style.textContent = [
      /* 2026-10-13 用户定:全程半透明0.55显示,位置在底部居中
         2026-10-25 用户定:整体上浮 —— bottom 24 → 56px,与右侧
         【下滑到底】按钮(back-to-bottom.js, bottom: 56px)同一水平线,
         三者同心圆高一致,底边齐平才工整 */
      '#dyc-search-fab {',
      '  position: fixed; left: 50%; bottom: 56px;',
      '  width: ' + BTN_SIZE + '; height: ' + BTN_SIZE + '; border-radius: 50%;',
      '  background: #ffffff; border: 1px solid rgba(0,0,0,.15);',
      '  box-shadow: 0 2px 8px rgba(0,0,0,.18);',
      '  display: flex; align-items: center; justify-content: center;',
      '  cursor: pointer; z-index: 2147483000; padding: 0; outline: none;',
      '  opacity: .55; transform: translate(-50%, 0);',
      '}',
      /* 全程半透明0.55,鼠标指向取消透明 */
      '#dyc-search-fab:hover { opacity: 1; background: #f5f6f7; }',
      '#dyc-search-fab:active { background: #ecedee; }',
      '#dyc-search-fab svg { display: block; }',
      '#dyc-search-fab .dyc-sp-ring { opacity: 0; transition: opacity .2s ease; }',
      '#dyc-search-fab.is-show:hover .dyc-sp-ring {',
      '  opacity: 1;',
      '  animation: dyc-sp-ring 2.6s linear infinite;',
      '}',
      '@keyframes dyc-sp-ring {',
      '  0%   { stroke-dashoffset: 0;   animation-timing-function: linear; }',
      '  36%  { stroke-dashoffset: 50;  animation-timing-function: cubic-bezier(.35,.45,.25,1); }',
      '  86%  { stroke-dashoffset: 100; animation-timing-function: linear; }',
      '  100% { stroke-dashoffset: 100; }',
      '}',
      '#dyc-search-pill {',
      '  position: fixed; left: 50%; bottom: 56px;',
      '  width: ' + BTN_SIZE + '; height: ' + BTN_SIZE + ';',
      '  border-radius: ' + PILL_R + ';',
      '  background: #ffffff; border: 1px solid rgba(0,0,0,.15);',
      '  box-shadow: 0 2px 8px rgba(0,0,0,.18);',
      '  overflow: hidden; box-sizing: border-box; display: none;',
      '  transform: translateX(-50%); z-index: 2147483000;',
      '}',
      /* 左右内边距统一 20px(2026-10-25):右侧原为 12px,「全能搜索」
         按钮几乎贴住胶囊边框,左右不对称也不工整。
         内容层宽度改 100%(= 胶囊内容盒 598px,原写死 PILL_W 会多出 2px
         被 overflow 裁掉,右侧留白实际只剩 18px),留白这才真的是 20px */
      '#dyc-search-pill .dyc-sp-inner {',
      '  position: absolute; left: 0; top: 0; height: 100%; width: 100%;',
      '  display: flex; align-items: center; gap: 6px;',
      '  padding: 0 20px; box-sizing: border-box;',
      '}',
      '#dyc-search-pill button {',
      '  border: 0.5px solid rgba(0,0,0,.25); background: #ffffff; border-radius: 5px;',
      '  padding: 3px 8px; font-size: 12px; line-height: 1.4; color: #333333;',
      '  cursor: pointer; flex: none;',
      '}',
      /* 禁用态(2026-10-14 用户定):与平台自带的结果箭头同步 ——
         平台箭头灰了(已在第一个/最后一个结果),浮动框对应的键也灰掉、点不动,
         用户一眼看出「到头了」,不会按半天没反应 */
      '#dyc-search-pill button:disabled {',
      '  opacity: .35; cursor: default;',
      '}',
      /* 结果导航键加大更明显(2026-10-12 用户定;二十二轮改 30px 大键位 + 18px 粗箭头 SVG) */
      '#dyc-search-pill #dyc-sb-prev, #dyc-search-pill #dyc-sb-next {',
      '  width: 30px; height: 30px; padding: 0; border-radius: 6px;',
      '  display: flex; align-items: center; justify-content: center;',
      '}',
      /* 右端搜索标志:圆形框 + 放大镜居中(2026-10-12 用户定) */
      '#dyc-search-pill #dyc-sb-search {',
      '  width: 34px; height: 34px; padding: 0; border-radius: 50%;',
      '  display: flex; align-items: center; justify-content: center;',
      '}',
      /* 【全能搜索】按钮(二十二轮,方案 C:白底 + 蓝放大镜,与平台框同款) */
      '#dyc-search-pill #dyc-sb-omni {',
      '  height: 30px; padding: 0 11px; border-radius: 4px;',
      '  background: #ffffff; border: 0.5px solid rgba(0,0,0,.25);',
      '  color: #1d2129; font-size: 12.5px;',
      '  display: flex; align-items: center; gap: 5px; white-space: nowrap;',
      '}',
      '#dyc-search-pill #dyc-sb-omni svg { display: block; flex: none; }',
      '#dyc-search-pill #dyc-sb-omni:hover { background: #f5f6f7; }',
      /* 全能搜索接手后的整块高亮(方案 A 淡蓝底,与原生框旁那颗同款) */
      '#dyc-search-pill #dyc-sb-omni.dyc-omni-on {',
      '  background: #E6F1FB; border-color: #185FA5; color: #185FA5;',
      '}',
      '#dyc-search-pill #dyc-sb-omni.dyc-omni-on:hover { background: #D8E8F7; }',
      '#dyc-search-pill #dyc-sb-omni .dyc-omni-text {',
      '  display: inline-block; vertical-align: baseline; line-height: 1;',
      '}',
      '#dyc-search-pill .dyc-sb-count {',
      '  min-width: 40px; text-align: center; font-weight: 500;',
      '  font-size: 12px; color: #333333; flex: none;',
      '}',
      '#dyc-search-pill .dyc-sb-inputwrap {',
      '  display: flex; align-items: center; flex: 1; min-width: 0;',
      '  border: 0.5px solid rgba(0,0,0,.25); border-radius: 999px;',
      '  padding: 3px 10px 3px 12px;',
      '}',
      /* 字号 11.5 → 12px(2026-10-25 三次):胶囊缩到 576px(刚好装下 19 字占位文案)
         后,把缩掉的 0.5px 还给文字;整串实测 202px,输入区可用 213px */
      '#dyc-search-pill input {',
      '  border: none; outline: none; width: 100%; min-width: 0;',
      '  font-size: 12px; color: #333333; background: transparent;',
      '}',
      '#dyc-scan-shade {',
      '  position: fixed; z-index: 2147483640;',
      '  background: #ffffff;',
      '  display: flex; align-items: center; justify-content: center;',
      '  font-size: 12px; color: #86909c;',
      '}',
      '#dyc-scan-shade.dyb-shade-translucent { background: rgba(255,255,255,.4); }',
      /* 悬停气泡(2026-10-11 用户定 A 方案):按钮上方黑底小箭头气泡 */
      '#dyc-search-fab .dyc-tip {',
      '  position: absolute; bottom: calc(100% + 10px); left: 50%;',
      '  transform: translateX(-50%);',
      '  background: rgba(20,20,20,.92); color: #ffffff;',
      '  font-size: 12.5px; padding: 6px 10px; border-radius: 6px;',
      '  white-space: nowrap; opacity: 0; pointer-events: none;',
      '  transition: opacity .15s ease;',
      '}',
      '#dyc-search-fab .dyc-tip::after {',
      '  content: ""; position: absolute; top: 100%; left: 50%; margin-left: -4px;',
      '  border: 4px solid transparent; border-top-color: rgba(20,20,20,.92);',
      '}',
      '#dyc-search-fab:hover .dyc-tip { opacity: 1; }'
    ].join('\n');
    (document.head || document.documentElement).appendChild(style);
  }

  function sbBtn(text, title) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = text;
    b.setAttribute('title', title);
    return b;
  }

  function buildPill() {
    const root = document.createElement('div');
    root.id = 'dyc-search-pill';
    const inner = document.createElement('div');
    inner.className = 'dyc-sp-inner';
    const prevBtn = sbBtn('', '上一个结果(循环)');
    prevBtn.id = 'dyc-sb-prev';
    // ←→ 用 18px 粗箭头 SVG(二十二轮用户定:文字符号太小)
    prevBtn.innerHTML = '<svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true" style="display:block">'
      + '<path d="M11 3.5L5.5 9L11 14.5" fill="none" stroke="#1d2129" stroke-width="2.6" '
      + 'stroke-linecap="round" stroke-linejoin="round"/></svg>';
    const nextBtn = sbBtn('', '下一个结果(循环)');
    nextBtn.id = 'dyc-sb-next';
    nextBtn.innerHTML = '<svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true" style="display:block">'
      + '<path d="M7 3.5L12.5 9L7 14.5" fill="none" stroke="#1d2129" stroke-width="2.6" '
      + 'stroke-linecap="round" stroke-linejoin="round"/></svg>';
    const countEl = document.createElement('span');
    countEl.id = 'dyc-sb-count';
    countEl.className = 'dyc-sb-count';
    const inputWrap = document.createElement('div');
    inputWrap.className = 'dyc-sb-inputwrap';
    const input = document.createElement('input');
    input.type = 'text';
    input.id = 'dyc-sb-bar-input';
    input.placeholder = PH_OURS;
    const clearBtn = sbBtn('清空', '清空两个搜索框');
    clearBtn.id = 'dyc-sb-clear';
    inputWrap.appendChild(input);
    inputWrap.appendChild(clearBtn);
    inner.appendChild(prevBtn);
    inner.appendChild(nextBtn);
    inner.appendChild(countEl);
    inner.appendChild(inputWrap);
    // 右端的搜索标志(十三轮):点击 = 原生搜索(二十二轮:转发平台,原速)。
    const searchBtn = sbBtn('', '搜索(同回车,走平台原生)');
    searchBtn.id = 'dyc-sb-search';
    searchBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 20 20" aria-hidden="true" style="display:block">'
      + '<circle cx="8.5" cy="8.5" r="5.5" fill="none" stroke="#333333" stroke-width="1.8"/>'
      + '<path d="M12.8 12.8L17.2 17.2" stroke="#333333" stroke-width="1.8" stroke-linecap="round"/></svg>';
    inner.appendChild(searchBtn);
    // 【全能搜索】按钮(二十二轮):搜索键右侧,方案 C 配色,同平台框
    const omniBtn = sbBtn('', PH_OURS);   // 悬停说明 = 浮动搜索框提示语(同一常量)
    omniBtn.id = 'dyc-sb-omni';
    // 放大镜默认**无色**(灰描边空心);全能搜索接手时由 setOmniLensActive 点亮
    // (2026-10-14 用户定:默认素净、激活才显色)
    omniBtn.innerHTML = '<svg width="12" height="12" viewBox="0 0 14 14" aria-hidden="true" style="display:block">'
      + '<circle cx="6" cy="6" r="4" fill="none" stroke="#888780" stroke-width="1.6"/>'
      + '<path d="M9 9L12.5 12.5" stroke="#888780" stroke-width="1.6" stroke-linecap="round"/></svg>'
      + '<span class="dyc-omni-text">全能搜索</span>';
    inner.appendChild(omniBtn);
    root.appendChild(inner);
    document.body.appendChild(root);
    /* 浮层让位(2026-11-01，反馈 #126/#127):平台弹窗 / 抽屉 / 下拉面板盖住胶囊时
     * 自动隐藏，浮层关掉恢复。判定与心跳都在 overlay-guard.js，这里只登记节点;
     * 它用 visibility 叠加，与本文件 showPill/hidePill 的 display 状态机互不覆盖。 */
    if (window.dycOverlayGuard && typeof window.dycOverlayGuard.bind === 'function') {
      window.dycOverlayGuard.bind(root);
    }
    inner.style.opacity = '0';

    function cycle(delta) {
      pillTouched();          // 二十轮:胶囊内操作 = 重置 15 秒计时
      // 2026-10-14 用户定:原生搜索场景下,浮动框 [←][→] 与平台自带的
      // 结果箭头**同步** —— 直接转发到那一对按钮(点击转发;禁用态由
      // syncPillNavState 同步),行为/滚动/高亮与用户手点平台箭头完全一致。
      // 全能搜索场景(结果来自扩展自己的扫描)不受影响,仍走 cycleMatches。
      if (state.nativeRaw && nativeNavPair()) {
        if (clickNativeNav(delta > 0 ? 'next' : 'prev')) scheduleNativePaint();
        return;
      }
      cycleMatches(delta);   // 2026-10-12:与平台框内 ←→ 共用同一条循环路径
    }
    prevBtn.addEventListener('click', function (e) {
      if (e && e.stopPropagation) e.stopPropagation();
      cycle(-1);
    });
    nextBtn.addEventListener('click', function (e) {
      if (e && e.stopPropagation) e.stopPropagation();
      cycle(1);
    });
    input.addEventListener('input', function () {
      pillTouched();   // 二十轮:输入 = 有操作
      if (state.platformInput) mirrorToPlatformInput(state.platformInput, input.value);
      // 在浮动框里改词同样算「改词」:放大镜恢复无色(用户定)
      if (omniLensOn) setOmniLensActive(false);
    });
    input.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter' || e.isComposing || e.keyCode === 229) return;
      const raw = (input.value || '').trim();
      if (!raw) return;
      pillTouched();
      // 2026-10-15 用户定:原生搜索场景下、框里的词**没改过** ⇒ 回车 = 「下一个结果」,
      // 与原生框里的回车完全一致(两处行为统一,光标在哪都能按回车往前走)。
      if (state.nativeRaw && raw === state.nativeRaw && clickNativeNav('next')) {
        e.preventDefault();
        scheduleNativePaint();
        return;
      }
      firePlatformSearch(raw);
    });
    clearBtn.addEventListener('click', function (e) {
      if (e && e.stopPropagation) e.stopPropagation();
      pillTouched();
      clearAllInputs();
    });
    searchBtn.addEventListener('click', function (e) {
      if (e && e.stopPropagation) e.stopPropagation();
      if (state.busy) return;
      const raw = (input.value || '').trim();
      if (raw) { pillTouched(); firePlatformSearch(raw); }
    });
    omniBtn.addEventListener('click', function (e) {
      if (e && e.stopPropagation) e.stopPropagation();
      if (state.busy) return;
      const raw = (input.value || '').trim();
      if (!raw) { report('先在搜索框输入关键词', 'info', { source: '全能搜索' }); return; }
      pillTouched();
      startOmniSearch(raw, input);
    });
    return { root: root, inner: inner, prevBtn: prevBtn, nextBtn: nextBtn, countEl: countEl, input: input, clearBtn: clearBtn, searchBtn: searchBtn, omniBtn: omniBtn };
  }

  function updatePillCount() {
    if (pill && uiState !== 'hidden') {
      // 2026-10-14 用户定:原生搜索的结果也要同步到浮动框 ——
      // 计数直接照抄平台那对箭头旁的「1/125」;读不到就留空,不瞎编 0/0 误导。
      if (state.nativeRaw) {
        pill.countEl.textContent = readNativeCounter();
        return;
      }
      pill.countEl.textContent = state.matches.length > 0
        ? ((state.cursor + 1) + '/' + state.matches.length)
        : '0/0';
    }
  }

  /** 搜到结果后:2026-10-15 用户定 —— **自动打开浮动框**(原生、全能一致),
   *  不再看「列表滚到哪」。不抢光标:光标留在原生框,接着按回车就能翻下一个。 */
  function showResults(raw) {
    ensureUiStyle();
    if (!pill) pill = buildPill();
    // 二十二轮:平台框恢复原生后,胶囊提示文案固定用 PH_OURS
    pill.input.value = raw;
    lastVisible = true;
    if (uiState === 'shown') {
      // 2026-10-14 修「全能搜索时会关闭浮动框再开启」(用户报):
      //   expandPill() 每次都会**先把胶囊缩成 52.8px 圆点、内容层透明**,
      //   再从中心撑开到 576px —— 胶囊本来就已经展开时再调一次,观感就是
      //   「关闭再开启」。已展开 → 只确保可见、内容不透明,不重放动画。
      if (pill.root.style.display !== 'block') pill.root.style.display = 'block';
      pill.inner.style.opacity = '1';
      syncPillNavState();
      updatePillCount();
    } else {
      expandPill({ focus: false });
    }
  }

  /** 彻底隐藏(搜索无结果 / 没滚出视口 / 开关关闭) */
  function hideSearchUi() {
    if (pill) pill.root.style.display = 'none';
    hideFab();
    uiState = 'hidden';
  }

  /* ---- 正中下方的实体搜索按钮 ---- */

  function buildFab() {
    ensureUiStyle();
    fabEl = document.createElement('button');
    fabEl.type = 'button';
    fabEl.id = 'dyc-search-fab';
    fabEl.setAttribute('aria-label', FAB_LABEL);
    // 与【回到顶部】同款 SVG:细线环 + 图标,44 画布、48px 渲染
    fabEl.innerHTML = '<svg width="48" height="48" viewBox="0 0 44 44" aria-hidden="true">'
      + '<circle class="dyc-sp-ring" cx="22" cy="22" r="20.5" pathLength="100" '
      + 'fill="none" stroke="rgba(51,51,51,.8)" stroke-width="1.5" '
      + 'stroke-linecap="round" stroke-dasharray="25 75" stroke-dashoffset="0" '
      + 'transform="rotate(-90 22 22)"/>'
      + '<circle cx="20" cy="19.5" r="7" fill="none" stroke="#333333" stroke-width="2"/>'
      + '<path d="M25 24.5L31 30.5" stroke="#333333" stroke-width="2" stroke-linecap="round"/>'
      + '</svg>'
      // 悬停气泡(2026-10-11 用户定,A 方案:上方黑底带箭头)。
      // 文案沿革:#121(10-26)曾统一成 PH_OURS;2026-10-29 反馈 #125 改回功能名
      // 「全能搜索」—— 圆钮是入口,名字要能让人知道它是干什么的。
      // 胶囊输入框的 placeholder 仍是 PH_OURS(那句话本来就是给输入框用的)。
      + '<span class="dyc-tip">' + FAB_LABEL + '</span>';
    document.body.appendChild(fabEl);
    /* 浮层让位(2026-11-01，反馈 #126/#127):与胶囊同一套判定(见 overlay-guard.js)。
     * 圆钮是 search.js 里最显眼的浮动物，用户反馈里「浮出来按钮」主要指它。 */
    if (window.dycOverlayGuard && typeof window.dycOverlayGuard.bind === 'function') {
      window.dycOverlayGuard.bind(fabEl);
    }
    fabEl.addEventListener('click', function (e) {
      if (e && e.stopPropagation) e.stopPropagation();
      if (uiState !== 'shown') expandPill();
    });
    // 二修:窗口 resize/缩放后全能按钮高度重新对齐输入框
    if (!onWinResize) {
      onWinResize = function () {
        try {
          const marked = document.querySelectorAll('input[' + ATTR_OURS + ']');
          for (const el of marked) {
            if (el.__dycOmniBtn) syncOmniBtnSize(el, el.__dycOmniBtn);
          }
        } catch (e) { /* 尽力而为 */ }
      };
      window.addEventListener('resize', onWinResize);
    }
  }

  /**
   * 按钮就位。
   * animate=true:滚动浮现,半透明 + 8px 上浮淡入(出现动效);
   * animate=false:胶囊收拢衔接 —— 原地直接就位,不加任何动效
   * (用户 2026-10-11 定:收拢变按钮之间不用动效)。
   *
   * ⚠️ 待命透明度**一律不写内联**(2026-10-13 用户定:鼠标指向按钮时
   * 必须是实体、不带透明)。内联 opacity 优先级高于样式表的 :hover,
   * 早前这里写死 `style.opacity = '0.45'` 会让 `#dyc-search-fab:hover
   * { opacity: 1 }` 整个失效 —— 悬停仍半透明,正是用户报的现象。
   * 现改法:入场只用内联把 opacity 压到 0 起手,过渡开始前**清空**该内联,
   * 让常驻 .55 / 悬停 1 全部由样式表说了算(与另外两枚浮动圆钮同款)。
   * 退场(hideFab)仍用内联 0 覆盖,那条不涉及悬停,照旧有效。
   */
  function showFab(animate) {
    if (!fabEl) buildFab();
    if (fabEl.__hideTimer) { clearTimeout(fabEl.__hideTimer); fabEl.__hideTimer = null; }
    fabEl.style.display = 'flex';
    fabEl.style.transition = 'none';
    if (animate === false) {
      // 原地就位:清内联后常驻 .55 由样式表给出(悬停可被 :hover 提亮)。
      // 先把无过渡态提交一帧,再恢复过渡 —— 保证「就位」这一步不带任何动效
      fabEl.style.opacity = '';
      fabEl.style.transform = 'translate(-50%, 0)';
      void fabEl.offsetWidth;
      fabEl.style.transition = 'opacity .2s ease-out, transform .2s ease-out';
    } else {
      fabEl.style.opacity = '0';
      fabEl.style.transform = 'translate(-50%, 8px)';
      void fabEl.offsetWidth;
      fabEl.style.transition = 'opacity .2s ease-out, transform .2s ease-out';
      fabEl.style.opacity = '';   // 淡入到样式表的 .55,悬停时交回 :hover 的 1
      fabEl.style.transform = 'translate(-50%, 0)';
    }
    fabEl.style.pointerEvents = 'auto';
    try { fabEl.classList.add('is-show'); } catch (e) { /* 尽力而为 */ }
    if (uiState === 'hidden') uiState = 'docked';
  }

  /**
   * 按钮隐没。instant=true:立即 display:none(胶囊展开接管 —— 形变衔接
   * 不能两个圆叠影);默认:下滑退场 —— 0.2s 淡出 + 8px 下滑,与回到
   * 顶部的退场同款(十五轮,用户定「一样的下滑退场」),动画结束才
   * display:none。showFab 会作废挂起的定时器,退场中再浮现不受影响。
   */
  function hideFab(instant) {
    if (!fabEl) return;
    if (fabEl.style.display === 'none') return;   // 已隐藏,不重复动作
    try { fabEl.classList.remove('is-show'); } catch (e) { /* 尽力而为 */ }
    fabEl.style.pointerEvents = 'none';
    if (instant) {
      if (fabEl.__hideTimer) { clearTimeout(fabEl.__hideTimer); fabEl.__hideTimer = null; }
      fabEl.style.transition = 'none';
      fabEl.style.display = 'none';
      return;
    }
    fabEl.style.transition = 'opacity .2s ease-out, transform .2s ease-out';
    fabEl.style.opacity = '0';
    fabEl.style.transform = 'translate(-50%, 8px)';
    if (fabEl.__hideTimer) clearTimeout(fabEl.__hideTimer);
    fabEl.__hideTimer = setTimeout(function () {
      fabEl.__hideTimer = null;
      if (!fabEl || fabEl.style.opacity !== '0') return;   // 退场中被重新浮现
      fabEl.style.transition = 'none';
      fabEl.style.display = 'none';
    }, 220);
  }

  /**
   * 展开:胶囊以 52.8px 圆的形态出现在按钮原位(与按钮一模一样,
   * 肉眼看是「按钮变成搜索框」),然后宽度 52.8 → 400 从中心向
   * 左右两侧同时撑开;放大镜从圆心滑到左端;输入区延迟淡入。
   */
  function expandPill(opt) {
    // 2026-10-15 用户定:搜索后自动展开浮动框时**不抢光标**(光标留在原生框,
    // 接着按回车就能翻下一个结果);只有用户**主动点圆钮**打开时才聚焦。
    const wantFocus = !opt || opt.focus !== false;
    ensureUiStyle();
    if (!pill) pill = buildPill();
    // 2026-10-14 补两框同步缺口:展开时以**原生框**为准拉一次值 ——
    // 平台 SPA 重建输入框、或平台自己程序化改过值时,胶囊里可能还留着旧值。
    if (state.platformInput && state.platformInput.isConnected) {
      const v = state.platformInput.value || '';
      if (pill.input.value !== v) pill.input.value = v;
    }
    // 浮动框 [←][→] 的可用态跟平台箭头对齐(原生搜索场景),计数同步平台的;
    // 放大镜与按钮整块高亮也按当前状态补一次(防平台重建按钮后丢色)
    syncPillNavState();
    updatePillCount();
    if (pill.omniBtn) {
      paintLens(pill.omniBtn.querySelector('svg'), omniLensOn);
      paintOmniBtn(pill.omniBtn, omniLensOn);
    }
    if (animTimer) { clearTimeout(animTimer); animTimer = null; }
    stopIdleTimer();   // 重新展开:旧计时作废(sticky 起步,点外部才重新裁决)
    hideFab(true);   // 瞬时隐藏:胶囊以同款圆形态接管,不能两个圆叠影
    pill.root.style.display = 'block';
    // 起始态:52.8 圆 + 放大镜居中 + 输入区透明
    pill.root.style.transition = 'none';
    pill.root.style.width = BTN_SIZE;
    pill.inner.style.transition = 'none';
    pill.inner.style.opacity = '0';
    void pill.root.offsetWidth;
    // 形变:宽度从中心向左右两侧同时撑开
    pill.root.style.transition = 'width .3s cubic-bezier(.4,0,.2,1)';
    pill.root.style.width = PILL_W;
    pill.inner.style.transition = 'opacity .15s ease .12s';
    pill.inner.style.opacity = '1';
    uiState = 'shown';
    // 聚焦但不引发任何容器滚动(五轮「不滚动容器」口径)
    if (wantFocus) {
      setTimeout(function () {
        try { pill.input.focus({ preventScroll: true }); }
        catch (e) { try { pill.input.focus(); } catch (e2) { /* 尽力而为 */ } }
      }, 320);
    }
  }

  /** 收纳:与展开正相反,向中间收拢回圆后按钮才回来(避免叠影) */
  function collapsePill() {
    if (uiState !== 'shown') return;
    uiState = 'docked';
    stopIdleTimer();   // 收缩后计时作废(下次点外部重新裁决)
    pill.inner.style.transition = 'opacity .1s ease';
    pill.inner.style.opacity = '0';
    pill.root.style.transition = 'width .3s cubic-bezier(.4,0,.2,1)';
    pill.root.style.width = BTN_SIZE;
    if (animTimer) clearTimeout(animTimer);
    animTimer = setTimeout(function () {
      animTimer = null;
      if (uiState !== 'docked') return;   // 收拢期间被展开打断
      pill.root.style.display = 'none';
      pill.root.style.transition = 'none';
      pill.root.style.width = PILL_W;   // 复位,下次展开从圆起步
      if (fabShouldShow()) showFab(false); else hideSearchUi();
    }, 320);
  }

  // 2026-10-14 用户改口径:
  //   · 圆钮(fab)仍随「商品列表第 4 行是否完整露出屏幕」显隐;
  //   · **胶囊展开期间不参与滚动显隐** —— 展开即锁定(见 syncFabVisibility);
  //   · **滚动不再算「点外部」** —— 一边滚一边看结果时不做收缩裁决;
  //     收起只由「点页面空白处」与「15 秒无操作」决定(用户 2026-10-14 定)。
  /**
   * 挂「滚动跟随显隐」监听。
   *
   * 2026-10-19 抽成函数：原先这条 addEventListener 只写在模块初始化处，
   * 而 destroySearchUi() 会把它连同 onDocScroll 一起摘掉 —— 开关关一次再开，
   * 圆钮的**两个出场入口**（滚动重判 + 就绪轮询）同时消失，只能刷新页面。
   * 现在初始化与「开关重开」共用这一个函数。
   * （重复调用安全：同一 target/type/capture 的 addEventListener 不会重复注册。）
   */
  function bindDocScroll() {
    if (!onDocScroll) {
      onDocScroll = function (e) {
        try {
          if (!enabled()) return;
          // 脚本滚动余波:不打进「外部动作」
          if (Date.now() - scriptScrollAt < 100) return;
          // 只做显隐同步,不再触发 outsideActivity 裁决
          syncFabVisibility();
        } catch (e2) { /* 滚动高频,绝不抛错 */ }
      };
    }
    document.addEventListener('scroll', onDocScroll, { capture: true, passive: true });
  }
  bindDocScroll();
  // 初始化显示按钮
  syncFabVisibility();
  // 启动时列表多半还没渲染完 → 起一个「等就绪」的轮询：就绪那一刻会重判一次。
  // 已经就绪则 waitListReady 的第一跳就判完并停，不留常驻定时器。
  waitListReady();

  /**
   * 搜索按钮与胶囊显隐。
   *
   * 2026-10-13 用户定:圆钮(fab)随「列表第 4 行完整露出屏幕」显隐。
   * 2026-10-14 用户改口径(修「搜索中滚过某位置就消失」):
   *   **胶囊展开期间不参与滚动显隐 —— 展开即锁定,一直留在屏幕上**。
   *   根因:此前 shown 态也用 fabShouldShow() 决定 display,用户搜索时往下滚,
   *   第 4 行一滚出屏幕就把它 display:none 硬抹掉(无动画、无过渡);
   *   而代码里那个本意是「搜索中不随显隐信号收起」的 searchMode 标志
   *   只被赋值、从未被读取,这层保护从未生效。
   *   现口径:展开态的可见性只由「点外部裁决」决定(点页面空白处 / 15 秒无操作),
   *   滚动完全不碰它;第 4 行判据只作用于未展开时的圆钮。
   *
   * 收拢态(docked)与隐藏态(hidden)一律保持 display:none:收拢态的入口
   * 是正中下方的搜索按钮(fab),胶囊不该出现。
   *
   * ⚠️ 2026-10-13 修「胶囊展开且全白」:此前 docked 分支也把 root 改回
   *   display:block。而 collapsePill() 收尾时已把宽度复位成 PILL_W(576px)、
   *   内容层 inner 的 opacity 停在 0 —— 于是收拢之后**每一次滚动**都会把
   *   一条 576px 宽、内容全透明的空白白条显示在页面底部(用户反馈:
   *   「开始直播后浮动搜索栏是展开且全白」;直播开始后商品列表重排会
   *   连发 scroll,故现象在开播后集中出现)。
   *   复现与回归见 .tmp/repro-white-pill.js。
   */
  function syncFabVisibility() {
    const shouldShow = fabShouldShow();
    if (pill) {
      if (uiState === 'shown') {
        // 展开即锁定(2026-10-14 用户定):滚动不得改动展开态胶囊的可见性
        if (pill.root.style.display !== 'block') pill.root.style.display = 'block';
      } else if (!(uiState === 'docked' && animTimer)) {
        // 例外:收拢动画进行中(animTimer 还在)保持可见,让动画收完 ——
        // collapsePill 的收尾会自己 display:none。
        if (pill.root.style.display !== 'none') pill.root.style.display = 'none';
      }
    }
    // 搜索按钮:跟随同一判据显隐(向下消失动效由 hideFab 处理)
    if (shouldShow) {
      if (!fabEl) buildFab();
      if (uiState !== 'shown' && fabEl.style.display !== 'flex') {
        showFab();   // 带浮现动效
      }
    } else {
      hideFab();   // 带向下消失动效
      // 因为「还没就绪」而藏起来时，必须有人负责在就绪那一刻把它放出来；
      // 否则要等用户手动滚一下 —— 那是把「乱显示」换成了「不出来」，同样不对。
      if (!listReady()) waitListReady();
    }
  }

  /**
   * 点外部裁决(二十轮状态机,用户定稿):
   *   · 扫描进行中一律不动;
   *   · 搜索框为空 → 立即收缩(收成按钮待命);
   *   · 搜索框有词 → 启动/重置 15 秒无操作计时器,期间任何胶囊内
   *     操作(输入/点按钮)都重置;到点无操作才收缩。直到下一次
     *     点外部才重新裁决(用户定:「一直开着,直到下一次点击外部」)。
   */
  function outsideActivity() {
    if (uiState !== 'shown' || !pill) return;
    if (state.busy) return;              // 扫描中不动
    const hasText = !!(pill.input.value || '').trim();
    if (!hasText) { stopIdleTimer(); collapsePill(); return; }
    startIdleTimer();
  }

  function startIdleTimer() {
    stopIdleTimer();
    idleTimer = setTimeout(function () {
      idleTimer = null;
      if (uiState !== 'shown' || !pill) return;
      if (state.busy) return;            // 扫描到点也别收(等收尾口径)
      collapsePill();                    // 15 秒无操作:自动收缩(用户定)
    }, IDLE_COLLAPSE_MS);
  }

  function stopIdleTimer() {
    if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; }
  }

  /** 胶囊内的任何操作都算「有操作」:重置 15 秒计时(若在计时中) */
  function pillTouched() {
    if (idleTimer) startIdleTimer();
  }

  /** 开关关闭:胶囊、按钮、监听全部摘除(停用必须真停) */
  function destroySearchUi() {
    if (animTimer) { clearTimeout(animTimer); animTimer = null; }
    if (nativePaintTimer) { clearTimeout(nativePaintTimer); nativePaintTimer = null; }
    stopIdleTimer();
    stopListReadyWatch();   // 停用必须真停：等就绪的轮询一并停掉
    stopOmniGuard();        // 2026-10-19 #97：按钮自愈表也一并停，不留常驻空转
    if (onDocScroll) {
      document.removeEventListener('scroll', onDocScroll, { capture: true });
      onDocScroll = null;
    }
    if (pill) { pill.root.remove(); pill = null; }
    if (fabEl) { fabEl.remove(); fabEl = null; }
    if (onWinResize) { window.removeEventListener('resize', onWinResize); onWinResize = null; }
    lastVisible = null;
    state.nativeRaw = null;   // 原生结果态一并清(回车跳下一个结果随之失效)
    omniLensOn = false;       // 放大镜状态复位
    clearNameMark();   // 橙底标记一并撤干净
    removeAllOmniButtons();   // 全能按钮一并摘掉(停用必须真停)
    uiState = 'hidden';
  }

  /**
   * 开关重新打开：把整套搜索 UI 反向拉起来（2026-10-19 修「浮动按钮消失」）。
   *
   * 用户报：**同一页面，开关一次之后浮动搜索框就不出来了，要刷新网页才行。**
   * 根因：destroySearchUi() 是**单向**的 —— 摘胶囊、摘圆钮（fabEl=null）、
   * 摘滚动监听（onDocScroll=null）、清 lastVisible、停就绪轮询；而重开时
   * 没有任何人反向做一遍。于是圆钮的**两个出场入口同时消失**：
   *   · 滚动 → syncFabVisibility 的监听被摘了；
   *   · 列表就绪 → waitListReady 轮询被停了；
   * 加上 fabEl 已经是 null（节点也被 remove 出文档），页面上就再也见不到它。
   * —— 这正是「必须刷新」的原因：刷新会重跑模块初始化，把上面四样重新建起来。
   *
   * 所以重开必须显式重建：重挂滚动监听 → 立刻判一次显隐 → 未就绪则等就绪。
   * （胶囊不用建：用户点圆钮时 expandPill 会自己 buildPill，与首次加载同一条路径。）
   */
  function reviveSearchUi() {
    /* 作用域兜底（2026-11-06）：不在中控台就不重建任何 UI（胶囊 / 圆钮 / 按钮）。
       这条函数是「叫醒」路径，多一处调用就多一次在别页复活的机会。 */
    if (typeof dycIsLiveControl === 'function' && !dycIsLiveControl()) return;
    uiState = 'hidden';
    lastVisible = null;    // 与初始化一致：让首次显隐判定从头算，不带旧去抖状态
    bindDocScroll();
    syncFabVisibility();   // 已就绪 = 立即出现；未就绪 = 交给下面这行等就绪
    waitListReady();
  }

  /**
   * 点击屏幕外 = 点外部裁决(二十轮状态机,用户定稿):
   * 不属于胶囊的都算屏幕外(含点平台框);裁决规则见 outsideActivity。
   */
  document.addEventListener('click', function (e) {
    if (uiState !== 'shown' || !pill) return;
    const t = e.target;
    if (!t) return;
    if (pill.root.contains(t)) { pillTouched(); return; }   // 胶囊内 = 有操作
    outsideActivity();
  }, true);

  // ---------------- 回车裁决(二十二轮;2026-10-18 两档化) ----------------
  //
  // 原生优先:回车默认放行给平台(原速)。只按**两档**决定要不要接管:
  //   always  —— 默认全能搜索:回车直接全能(拦下平台,走扫描);
  //   none    —— 默认原生搜索:永远放行(缺省)。
  // 原第三档 trial3「事不过三」已整体删除 —— 它原本要在这里按「0 结果 / 单结果 /
  // 多结果空转」三种情形累计到第 3 次再转全能,而那套计数器只在扫描回调里自增、
  // 在 trial3 下永远跑不到,属于结构性断路(详见搜索模块顶部「已删除」注释块)。
  // 拦截仍走 capture 阶段;未拦截时平台监听照常收到,原速搜索。

  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Enter') return;
    // 输入法组词中的回车(拼音上屏)不碰
    if (e.isComposing || e.keyCode === 229) return;

    const t = e.target;
    if (!isSearchInput(t)) return;

    const raw = (t.value || '').trim();
    if (!raw) return;                 // 空输入:不拦,平台原样(清空筛选)
    if (!enabled()) return;           // 开关关闭:不拦,平台原样
    if (state.busy) {                 // 扫描中:拦下重复回车,但不发起新搜索
      e.preventDefault();
      e.stopImmediatePropagation();
      e.stopPropagation();
      return;
    }
    if (state.omniMode !== 'always') {
      return;   // none(缺省 = 默认原生搜索):放行,平台原生搜索
    }

    // always 档:回车直接全能
    // 连商品列表容器都不在时也别接管 —— 平台搜索虽然多半也搜不到,
    // 但强行扫描只会报错,不如把回车还给平台
    if (!getScrollContainer()) return;

    e.preventDefault();
    e.stopImmediatePropagation();
    e.stopPropagation();
    startOmniSearch(raw, t);
  }, true);

})();
