#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
性能常规检查 —— 发布前排查「会导致商家页面卡顿 / 假死」的代码反模式。

用户口径(2026-10-11 定):
  不是给扩展装监视器,而是发布前自己做一遍常规性能检查;
  发现损耗过大的写法就**暂停发布**,并逐条给出原因与优化方案。

用法:
  python scripts/perf-check.py           # 普通模式:输出报告,退出码恒为 0(开发期随时可跑)
  python scripts/perf-check.py --gate    # 闸门模式:存在【拦】级问题 → 退出码 1(publish.sh 用)

检查方式(刻意保持「常规检查」量级):
  静态扫描 src/**/*.js,只查**确定性**反模式,不做运行时基准 ——
  真实耗时受机器与页面状态影响,静态数字不可信;真机手感由真机验收观察。
  零第三方依赖,秒级跑完。

规则分两级:
  【拦】  高概率导致页面卡顿或假死的写法 → 发布暂停,逐条给出优化方案
  【提示】 有性能代价但可接受 / 取决于数据量的写法 → 打印不阻断

局限(如实说明,不夸大能力):
  · 静态扫描查不出「真实耗时」,只能查反模式;
  · 递归无终止、跨函数的布局抖动(读写交错)等模式无法可靠静态判定,不查;
  · 规则命中 ≠ 一定卡,但每一条【拦】都要求:改掉,或在 WHITELIST 写理由豁免。

白名单:
  WHITELIST 里每条 = (文件路径, 规则号, 行号或 None, 理由)。
  豁免必须写清理由 —— 白名单是「已论证过的例外」,不是「嫌烦就加」。
"""

import argparse
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SCAN_DIR = ROOT / "src"

# ---------------------------------------------------------------
# 白名单:(文件相对路径(posix), 规则号, 行号(None=不限), 理由)
# 行号一律填 None:行号随代码增删漂移,按「文件+规则」豁免,
# 理由写清该文件里这类模式的既有设计依据(2026-10-11 逐处人工核实)。
# ---------------------------------------------------------------
WHITELIST = [
    ("src/content/cursor-fix.js", "R5", None,
     "querySelectorAll('*') 共两处:①开局全量收集一次,随后按 400/批 + "
     "requestIdleCallback 分片处理(函数内 CHUNK=400 与 idle() 可证);"
     "②scanDom 只对增量传入的子树收集,变异按 300ms 合批,非每变异全页扫"),
    ("src/content/anchor.js", "R5", None,
     "querySelectorAll('*') 均限定在单个商品行 / 单元素子树内,非全页查询"),
    ("src/content/anchor.js", "R6", None,
     "矩形读取循环均限定单个商品行的小候选集(span/div/td/p 等),N ≤ 单行节点数"),
    ("src/content/clear-stock.js", "R5", None,
     "querySelectorAll('*') 均限定在单行 / 单元格内,非全页查询"),
    ("src/content/clear-stock.js", "R6", None,
     "矩形读取循环限定单行/单元格;调试面板一处有 results>30 提前 break,"
     "且仅在 URL 带 dyb_debug=1 的调试模式运行"),
    ("src/content/dialog.js", "R7", None,
     "确认弹窗字段行构建,fields 为 1~3 个固定字段,N 极小,非批量插节点"),
    ("src/update/update.js", "R7", None,
     "更新页「本版更新要点」渲染,条数上限 MAX_NEWS_ITEMS=5,"
     "且只在静态更新页执行一次,非批量插节点"),
    ("src/live/locate.js", "R6", None,
     "①全页找滚动容器一处,带 10s 缓存(SCROLLER_CACHE_MS=10000),最坏每 10 秒一次;"
     "②其余为虚拟滚动定位的行距数学,读取次数与可见行数同阶,功能真机验收通过;"
     "③2026-10-15 新增 getAllProductRows() 的结构锚补捞 findIdLikeButtons():"
     "循环内只**读** clientWidth/clientHeight(全程不写,不会读写交错触发重排),"
     "先按 children.length>2 排除大容器再读文本,结果带 250ms 缓存"
     "(ALL_ROWS_TTL=250),调用点为补涂时机而非每帧"),
    ("src/live/nav.js", "R6", None,
     "①锚点候选循环 N = 固定文案候选集,极小;"
     "②全页收集文案一处有 texts.length >= 40 提前 break"),
    ("src/live/search.js", "R6", None,
     "getBoundingClientRect 循环的范围 = getProductItems() 返回的当前渲染行,"
     "虚拟滚动下恒为可视区那几行(locate.js 注释:实测恒为 8 个),"
     "且调用点为低频时机(waitFor 就绪回调 / 行捕获),非每帧高频路径"),
    ("src/live/back-to-top.js", "R5", None,
     "collectScrollables 全页收集只在低频时机执行(启动 / resize / "
     "滚动停止 800ms 后 debounce 校准 / 点击归零前一次性),"
     "结果缓存供 scroll 回调复用"),
    ("src/live/back-to-top.js", "R6", None,
     "同上:全页布局读仅发生在 collectScrollables 的低频收集里;"
     "scroll 每帧路径只读缓存容器的 scrollTop(2026-10-11 修复,"
     "原版每帧全页扫描已移除,见该文件头注释第 6 条)"),
    ("src/live/back-to-bottom.js", "R5", None,
     "与 back-to-top.js 同为「页面滚动链」实现:collectScrollables 的全页收集只在"
     "低频时机执行(启动 / resize / 点击归零前一次性),结果缓存复用,非每帧路径"),
    ("src/live/back-to-bottom.js", "R6", None,
     "同上:全页布局读只发生在 collectScrollables 的低频收集与**点击那一次**里;"
     "点击路径上新增的「是否已在底部」判据也只遍历 chain 容器(≤3 个)读一次,"
     "属一次性动作而非循环回调(2026-10-18 补提示时逐处核对)"),
    ("src/live/toolbar.js", "R6", None,
     "①插入期一次性找「筛选」,命中即 return;②向上找 flex 容器固定 3 层上限"),
    ("src/live/name-wrap.js", "R6", None,
     "2026-10-12 商品名称换行:循环内布局读只在「收集候选」第一遍(TreeWalker"
     "限定单行商品内部,可视区约 8 行),且已做读-写分离(收集完再统一写样式);"
     "调用点为 MutationObserver 合批 + 开局 3 次兜底,非每帧高频路径。"
     "2026-10-15 更新:调度由「固定防抖 300ms」改为「当帧 rAF 补涂 + 300ms 尾扫」,"
     "同帧多次变更仍合并成一次;新增的 stillWrapped() 复核只读 getComputedStyle 与 "
     "scroll/client 尺寸,同样在收集阶段完成、不与写入交错"),
    ("src/content/diag.js", "R6", None,
     "2026-10-13 反馈诊断包:控件挂载表按 dyb-/dyc- 前缀扫描扩展**自己注入的元素**,"
     "分组后取根元素读 getBoundingClientRect / getComputedStyle;"
     "**N ≤ WIDGET_MAX=40 硬上限**(超出截断),且只在「用户点提交反馈」那一刻跑一次,"
     "不在页面常驻路径上;实测整包采集 1~6ms"),
    ("src/live/hide-elements.js", "R6", None,
     "2026-10-18 通用浮条扫描:isFloating() 的循环只沿单个候选的**祖先链**向上走,"
     "固定 4 层上限;该函数只对「已通过文本关键词预筛」的少数候选调用(浮条自身文本极短,"
     "全页通常 0~2 个命中),不是对全页节点逐个读布局。整轮扫描另有 BAR_MAX_NODES=3000 "
     "与 BAR_MAX_DEPTH=10 双预算,且由 400ms 防抖合批触发,非每帧高频路径"),    ("src/replay/replay-ui.js", "R6", None,
     "2026-10-18 直播回放:①findMount / findPlayerBox 的循环是「沿父链上溯」,"
     "**硬上限 8 层**(guard < 8),N 与页面规模无关,只与嵌套深度有关;"
     "②调用点为挂载那一刻、滚动/resize(经 rAF 合批,一轮只算一次)、"
     "以及 1.5s 的低频重定位(播放器尺寸会因切分辨率/全屏变化,必须跟),"
     "不在每帧路径上,也不做批量节点扫描;"
     "③只读不写、不与样式写入交错(读取后只写 host 的 left/top 两个属性)"),
    ("src/live/compass-table.js", "R6", None,
     "2026-10-18 罗盘商品表(反馈 #95)名称展开/按钮注入。坐标读取分两处,范围都极小:"
     "① findPlatformIdButton 里读 clientWidth/clientHeight,scope 恒为**名称元素的父容器**"
     "(只有名称 + 平台「复制 ID」按钮 + 我们自己的按钮,3~5 个节点),"
     "且整段只读不写,不与写入交错;"
     "② getRows 里读 tr.clientHeight 只为挡掉高度 0 的测量行/占位行,"
     "范围是 tbody tr(这两页实测 10~11 行,非虚拟滚动),同样只读不写。"
     "调用点:首屏 3 次兜底 + MutationObserver 合批(当帧 rAF 补涂 + 300ms 尾扫),"
     "非每帧高频路径;名称展开的读写在同一轮内按「先读 isCut 再写 style」逐行串行,"
     "行数固定且很小(实测 11 行),未观察到可感知抖动"),
    ("src/live/live-screen.js", "R6", None,
     "2026-10-30 数据大屏商品页签(名称展开 + 货号复制)。唯一的循环内布局读是 "
     "getRows() 里 tr.clientHeight,只用于挡掉高度 0 的测量行/占位行;"
     "范围是 tbody tr —— 用户交来的结构报告实测 51 行(容器 div.ecom-table-body "
     "固定高 724 / 内容 4234,**非虚拟滚动**,行不重建),且整段只读不写;"
     "调用点为首屏 3 次兜底 + MutationObserver 合批(当帧 rAF 补涂 + 300ms 尾扫),"
     "非每帧路径。名称展开的 isCut/stillExpanded 布局读只对「本轮有变化的行」执行 ——"
     "稳态下每行先命中「标记 + 计算值仍是展开态」的快路径,不再读几何"),
    ("src/live/auto-refresh.js", "R6", None,
     "2026-10-19 小黄车自动刷新(反馈 #92)。坐标/布局读取分三处,都做过收敛:"
     "① scroller() 的兜底分支改为**两段式**:先只读 scrollHeight/clientHeight 粗筛,"
     "只有尺寸像真滚动容器的少数候选(0~3 个)才读 getComputedStyle,"
     "样式读取次数从「元素总数」降到「候选数」;且结果带 10 秒缓存,"
     "调用点仅在「刷完放回滚动位置」那一刻;"
     "② placeOverlay() 每拍只读**一个**矩形(平台那枚按钮的),"
     "我们的浮层挂 body + fixed 定位,不需要任何容器换算 ⇒ 无 clientLeft/scrollTop 读取。"
     "另外主循环虽为 250ms 一拍,但全页扫描一律带节流:"
     "findRefreshBtn 缓存活节点命中即返回(零扫描),只在缓存失效时重扫、"
     "且**只对「没找到」这一种负结果做 1 秒节流**"
     "(对失效不节流:节流会让主循环误判「按钮没了」而撤层,表现为按钮每秒闪一下);"
     "hasPreLiveBanner 用 textContent(非 innerText,不强制布局)+ 10 秒缓存;"
     "timerTrend 找到计时器后只读该节点、不再全页扫;"
     "hasLiveButton 改为「先纯文本匹配、命中后才判可见」"
     "(把重排次数从候选数压到命中数);"
     "refreshBtnValid 这条 250ms 热路径刻意不做祖先遍历;灯只在**颜色/悬停文案真变了**才写 DOM(paintLamp),平时每拍什么都不写。"),
    ("src/live/live-detail-tab.js", "R5", None,
     "2026-10-19 直播明细「打开即切商品」。唯一的 querySelectorAll('*') 在 "
     "pickFromMenu() 里,范围**先收进带 tabs-dropdown 的容器**再取其后代"
     "(`panels[i].querySelectorAll('*')`),不是全页查询 —— 那个面板里只有"
     "被折叠的几枚标签,实测个位数节点。之所以要收进容器:页面上别的组件"
     "(下拉筛选 / 级联选择)也用 dropdown-menu-item 类名,全页找会点到不相干的控件。"),
    ("src/live/live-detail-tab.js", "R6", None,
     "同上功能。布局读取都有硬上限、且不在高频路径上:"
     "① isVisible() 的 getBoundingClientRect 只对**标签栏里那几枚标签**"
     "(antd / rc-tabs,实测个位数)与「更多」下拉里的项调用,"
     "用于跳过被折进下拉的 display:none 标签;"
     "② pickCard() 找候选走 TreeWalker 扫**文本节点**(一趟线性),"
     "不遍历元素再逐个读 textContent(2000 个元素逐个读子树是平方级),"
     "候选数另有 CARD_SCAN_MAX=20 封顶。"
     "整条流程只在首屏的 8 次延时重试里跑(命中即停),加上 1.5s 粒度的 URL 变化检查;"
     "**不挂 MutationObserver、不做每帧扫描**。全部只读不写,不与样式写入交错"),
    ("src/live/auto-loop-lecture.js", "R6", None,
     "2026-10-25 自动循环讲解:四处矩形读取都不是高频路径 ——"
     "①findCartHeader 全文先按**文本**粗筛再用矩形复核,候选通常 1~3 个,"
     "且找不到时退避 3 秒(headerMissAt);"
     "②findHeaderByRows 沿祖先链最多 8 层,读一次就 return;"
     "③findLectureBtn 只在**单个商品行内部**的候选上读矩形(行内节点数十个),"
     "调用点是 20 秒一拍的 checkNow;"
     "④findCartPanel 只在面板打开时随 place() 走,最多 6 层。"
     "整体节奏 = 20 秒拍点 + 250ms 跟位(只重读标题行一个矩形),"
     "不挂 MutationObserver、不在循环里写样式"),    ("src/live/lucky-bag.js", "R6", 1377,
     "2026-11-05 性能自检:drawerRootByText 的矩形读发生在**文本粗筛之后** ——"
     "先按 textContent 长度与 DRAWER_MARKS/业务词过一遍,只有词命中者才读矩形,"
     "属「先粗筛后精读」的正确范式;且同日已加正结果缓存,"
     "稳态下每拍只校验缓存节点一次矩形,不再全页扫。"),
    ("src/live/lucky-bag.js", "R6", 4209,
     "2026-11-05 性能自检:pageClues 的全页标签扫描有 budget 递减 + out.length<20"
     "双上限,且矩形读只在文本命中后执行;调用点是**调试诊断包导出**与导出表,"
     "不在业务拍点上,页面静止时根本不跑。"),
    ("src/live/live-detail-jump.js", "R6", None,
     "2026-11-05 性能自检:findAnchor 是 2000ms 一拍的锚点查找,范围是全页"
     "button/a/[role=button](该页量级中等),循环内**只读不写**、不与样式写入交错,"
     "不会触发热重排;原本「对 best 重复读矩形」的浪费已在同轮修掉(改 bestTop 复用),"
     "现在每个候选只读一次,保留循环读是因为「可见性」必须逐个量。"),
    ("src/live/search.js", "R5", None,
     "2026-11-05 性能自检:markNameOnRow 的通配查询范围**限定在单个商品行**"
     "(rowEl,由调用方传入),不是全页查询;后续只对叶子取文本,矩形/样式零读取;"
     "调用点是用户搜索后的染色,不在定时器拍点上。"),

    ("src/content/wx-goods-tools.js", "R1", None,
     "三处 setInterval 全部是「用户点一下、最多跑 2.5 秒」的短时轮询,不是常驻:"
     "①等待「规格/编码」弹层里出现 SKU 行(100ms×25,一命中就在 finish() 里 clearInterval);"
     "②给平台分享面板加隐身(50ms,900ms 到点自清);"
     "③等待面板里出现链接文本(100ms×24=2.4 秒,主世界桥命中时根本不进这段)。"
     "三处共同点:都由点击触发、都有次数上限、结束必 clearInterval ——"
     "页面静止时该文件零定时器。降频到 200ms 会让隐身失效、面板重新「亮 2 秒」"
     "(用户实测反馈过这个观感),故保留原频率并在此登记"),
]

# ---------------------------------------------------------------
# 规则说明(为什么卡 + 怎么改),供报告输出
# ---------------------------------------------------------------
RULE_HELP = {
    "R1": {
        "name": "高频定时器",
        "why": "间隔小于 200ms 的 setInterval 会持续唤醒主线程,叠加页面自身的渲染任务后造成可感知卡顿",
        "fix": "间隔放宽到 1000ms 及以上;能用事件驱动(MutationObserver / storage.onChanged)就不要轮询",
    },
    "R2": {
        "name": "同步网络请求",
        "why": "同步 XHR 会冻结整个页面直到请求结束,网络一慢就是整页假死",
        "fix": "改用 fetch / 异步 XHR,回调里更新 UI",
    },
    "R3": {
        "name": "同步自旋 / 忙等",
        "why": "循环条件只由时间或常量驱动、体内无 await/break/return/throw 时,主线程被独占,页面假死直到循环退出",
        "fix": "循环体内必须让出主线:await sleep(间隔);或改成 setTimeout / requestAnimationFrame 逐帧推进",
    },
    "R4": {
        "name": "较高频定时器",
        "why": "间隔在 200~999ms 的定时器有一定开销,若回调做 DOM 重活会放大",
        "fix": "确认回调足够轻(早退/只比较变量);能事件驱动则替代轮询",
    },
    "R5": {
        "name": "全量通配节点查询",
        "why": "querySelectorAll('*') 在上万节点的中控台页面会一次性物化全部节点,再逐个处理时代价成倍放大",
        "fix": "尽量限定查询范围(容器内查,别从 document 查);必须全量时只做一次收集,处理阶段分片(参考 cursor-fix 的 400/批 + requestIdleCallback)",
    },
    "R6": {
        "name": "循环内读取布局信息",
        "why": "循环内逐个读 getComputedStyle / offset* / client* / scroll* / getBoundingClientRect,每次读都可能触发强制重排,是页面卡顿的头号来源",
        "fix": "批量读完后统一处理(读-写分离);或对扫描分片(requestIdleCallback)+给循环加数量上限",
    },
    "R7": {
        "name": "循环内逐个插节点",
        "why": "循环里逐个 appendChild 会逐次触发重排,节点多时明显卡顿",
        "fix": "先挂到 DocumentFragment,最后一次性挂载;或拼好 innerHTML 一次写入",
    },
    "R8": {
        "name": "MutationObserver 回调内全页查询",
        "why": "页面批量重渲染时回调会被高频触发,回调里再做全页查询等于把全页成本乘以触发次数",
        "fix": "回调内只做轻判读与入队,重活交给合批 + 分片的后续任务(参考 cursor-fix 的 300ms 合批)",
    },
}

BLOCK_RULES = {"R1", "R2", "R3"}          # 【拦】级规则
HINT_RULES = {"R4", "R5", "R6", "R7", "R8"}  # 【提示】级规则

# ---------------------------------------------------------------
# 词法辅助:字符串 / 注释感知的大括号配平
# ---------------------------------------------------------------
class Scanner:
    def __init__(self, text):
        self.lines = text.splitlines()

    # 从 (line_idx, col_idx) 起做括号配平,返回闭括号所在行号。
    # 跳过字符串(含模板串,不处理 ${} 嵌套的极端情况)与注释。
    def match_bracket(self, start_line, start_col, open_ch="{", close_ch="}"):
        depth = 0
        in_str = None       # None | "'" | '"' | '`'
        in_line_comment = False
        in_block_comment = False
        escape = False
        for li in range(start_line, len(self.lines)):
            line = self.lines[li]
            ci0 = start_col if li == start_line else 0
            ci = ci0
            while ci < len(line):
                ch = line[ci]
                nxt = line[ci + 1] if ci + 1 < len(line) else ""
                if in_line_comment:
                    break
                if in_block_comment:
                    if ch == "*" and nxt == "/":
                        in_block_comment = False
                        ci += 2
                        continue
                    ci += 1
                    continue
                if in_str:
                    if escape:
                        escape = False
                    elif ch == "\\":
                        escape = True
                    elif ch == in_str:
                        in_str = None
                    ci += 1
                    continue
                if ch == "/" and nxt == "/":
                    in_line_comment = True
                    ci += 2
                    continue
                if ch == "/" and nxt == "*":
                    in_block_comment = True
                    ci += 2
                    continue
                if ch in ("'", '"', "`"):
                    in_str = ch
                    ci += 1
                    continue
                if ch == open_ch:
                    depth += 1
                elif ch == close_ch:
                    depth -= 1
                    if depth == 0:
                        return li
                ci += 1
            in_line_comment = False
            # 行尾仍是字符串 / 块注释时延续到下一行(escape / in_str / in_block_comment 保留)
        return None  # 未配平(文件截断或极端语法)

    # 取从某行开始的首个块 { ... } 的行号范围;无块则返回该行下一行(单语句)。
    def block_extent(self, head_line):
        for li in range(head_line, min(head_line + 4, len(self.lines))):
            col = self.lines[li].find("{")
            if col != -1:
                end = self.match_bracket(li, col)
                if end is not None:
                    return (li, end)
                break
        return (head_line, min(head_line + 1, len(self.lines) - 1))  # 单语句体

    # setInterval(...) 调用的实参文本(配平括号,取最末参数)
    def call_args_text(self, line_idx, col):
        end = self.match_bracket(line_idx, col, "(", ")")
        if end is None:
            return None, None
        start_text = self.lines[line_idx][col + 1:] if end == line_idx else self.lines[line_idx][col + 1:]
        text = "\n".join(self.lines[line_idx:end + 1])
        inner = text[text.find("(") + 1: text.rfind(")")]
        return inner, end


RE_SETINTERVAL = re.compile(r"setInterval\s*\(")
RE_WHILE = re.compile(r"\bwhile\s*\(")
RE_FOR = re.compile(r"\bfor\s*\(")
RE_YIELD = re.compile(r"\bawait\b|\bbreak\b|\breturn\b|\bthrow\b")
RE_SPIN_COND = re.compile(r"^\s*while\s*\(\s*(true|1|!0)\s*\)")
RE_TIMEWAIT_COND = re.compile(r"^\s*while\s*\(.*(Date\.now\(\)|performance\.now\(\)).*\)")
RE_SYNC_XHR = re.compile(
    r"\.open\s*\(\s*['\"][A-Z]+['\"]\s*,[^,)]+,\s*(?:false|0)\s*\)")
RE_WILDCARD_QSA = re.compile(
    r"querySelectorAll\s*\(\s*['\"]\*['\"]\s*\)|getElementsByTagName\*?\s*\(\s*['\"]\*['\"]\s*\)")
RE_LAYOUT_READ = re.compile(
    r"getComputedStyle\s*\(|\.offsetWidth\b|\.offsetHeight\b|\.offsetLeft\b|\.offsetTop\b"
    r"|\.clientWidth\b|\.clientHeight\b|\.scrollWidth\b|\.scrollHeight\b"
    r"|getBoundingClientRect\s*\(")
RE_APPEND = re.compile(r"appendChild\s*\(")
RE_OBSERVER = re.compile(r"new\s+MutationObserver\s*\(")
RE_OBS_HEAVY = re.compile(r"document\.querySelectorAll|document\.body\.querySelectorAll")


def scan_file(rel, text):
    """返回 [(rule, line_no(1 起), 摘要)]"""
    sc = Scanner(text)
    lines = sc.lines
    hits = []

    # R1/R4 setInterval 间隔
    for i, line in enumerate(lines):
        m = RE_SETINTERVAL.search(line)
        if not m:
            continue
        inner, _ = sc.call_args_text(i, m.start())
        if inner is None:
            continue
        mm = re.search(r",\s*(\d+)\s*$", inner.strip(), re.S)
        if not mm:
            continue  # 间隔为变量,静态判不了,如实跳过
        ms = int(mm.group(1))
        if ms < 200:
            hits.append(("R1", i + 1, "setInterval 间隔 %dms" % ms))
        elif ms < 1000:
            hits.append(("R4", i + 1, "setInterval 间隔 %dms" % ms))

    # R2 同步 XHR
    for i, line in enumerate(lines):
        if RE_SYNC_XHR.search(line):
            hits.append(("R2", i + 1, "XMLHttpRequest.open 第三参为 false(同步请求)"))

    # R3 同步自旋 / 忙等
    for i, line in enumerate(lines):
        if not (RE_SPIN_COND.match(line) or RE_TIMEWAIT_COND.match(line)):
            continue
        head, end = sc.block_extent(i)
        body = "\n".join(lines[head:end + 1])
        if RE_YIELD.search(body):
            continue
        kind = "while(真) 体内无 await/break/return/throw" if RE_SPIN_COND.match(line) \
            else "按时间忙等且体内无 await/break/return/throw"
        hits.append(("R3", i + 1, kind))

    # R5 全量通配查询(逐处)
    for i, line in enumerate(lines):
        if RE_WILDCARD_QSA.search(line):
            hits.append(("R5", i + 1, "全量通配节点查询"))

    # R6/R7 循环体内读布局 / 插节点
    for i, line in enumerate(lines):
        if not (RE_FOR.search(line) or RE_WHILE.search(line)):
            continue
        head, end = sc.block_extent(i)
        if end <= head and head == i:
            body_lines = lines[head:head + 1]
        else:
            body_lines = lines[head:end + 1]
        for j, bl in enumerate(body_lines):
            ln = head + j + 1
            if RE_LAYOUT_READ.search(bl):
                hits.append(("R6", ln, "位于第 %d 行起的循环体内" % (i + 1)))
            if RE_APPEND.search(bl):
                hits.append(("R7", ln, "位于第 %d 行起的循环体内" % (i + 1)))

    # R8 MutationObserver 回调内全页查询
    for i, line in enumerate(lines):
        m = RE_OBSERVER.search(line)
        if not m:
            continue
        head, end = sc.block_extent(i)
        body = "\n".join(lines[head:end + 1])
        if RE_OBS_HEAVY.search(body):
            hits.append(("R8", i + 1, "回调体内出现 document 级全页查询"))

    return hits


def whitelisted(rel, rule, line_no):
    for (w_file, w_rule, w_line, _reason) in WHITELIST:
        if rel.endswith(w_file) and w_rule == rule and (w_line is None or w_line == line_no):
            return True
    return False


def main():
    ap = argparse.ArgumentParser(description="发布前性能常规检查")
    ap.add_argument("--gate", action="store_true", help="闸门模式:有【拦】级命中则退出码 1")
    args = ap.parse_args()

    if not SCAN_DIR.is_dir():
        print("[错误] 找不到扫描目录:%s" % SCAN_DIR)
        return 2

    files = sorted(p for p in SCAN_DIR.rglob("*.js") if p.is_file())
    if not files:
        print("[错误] 扫描目录下没有任何 .js 文件:%s" % SCAN_DIR)
        return 2

    block_hits, hint_hits, waived = [], [], 0
    for p in files:
        rel = p.relative_to(ROOT).as_posix()
        try:
            text = p.read_text(encoding="utf-8", errors="replace")
        except OSError as e:
            print("[错误] 读不了文件 %s:%s" % (rel, e))
            return 2
        for (rule, line_no, note) in scan_file(rel, text):
            if whitelisted(rel, rule, line_no):
                waived += 1
                continue
            item = (rel, rule, line_no, note)
            (block_hits if rule in BLOCK_RULES else hint_hits).append(item)

    print("[性能常规检查] 扫描 %d 个文件(src/**/*.js),规则 8 条(拦 %d / 提示 %d)" %
          (len(files), len(BLOCK_RULES), len(HINT_RULES)))
    print("")

    def emit(items, level):
        for (rel, rule, line_no, note) in items:
            h = RULE_HELP[rule]
            print("  【%s】%s %s  %s:%d" % (level, rule, h["name"], rel, line_no))
            print("        现象:%s" % note)
            print("        为什么会卡:%s" % h["why"])
            print("        优化方案:%s" % h["fix"])
            print("")

    emit(sorted(block_hits), "拦")
    emit(sorted(hint_hits), "提示")

    if waived:
        print("  白名单豁免 %d 处(登记在 scripts/perf-check.py 的 WHITELIST,均附理由)" % waived)
        print("")

    if block_hits:
        print("结论:【拦】级 %d 项 —— 性能损耗过大,**暂停发布**。" % len(block_hits))
        print("      处理路径:按上面逐条优化后重跑;"
              "确属已论证过的例外,在 WHITELIST 补登记(必须写理由)。")
        return 1 if args.gate else 0

    if hint_hits:
        print("结论:【拦】级 0 项;【提示】级 %d 项(不阻断,发布继续)。" % len(hint_hits))
        print("      提示项如确认无害,可登记 WHITELIST 让报告保持干净。")
        return 0

    print("结论:未发现卡顿 / 假死类反模式,性能常规检查通过。")
    return 0


if __name__ == "__main__":
    sys.exit(main())
