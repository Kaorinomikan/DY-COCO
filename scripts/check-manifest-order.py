#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
manifest.json 脚本顺序闸门

为什么需要它(2026-10-11,并行开发铺路):
  content_scripts 的 js 数组是**有顺序要求**的 —— 后面的脚本要用前面脚本
  定义的全局函数。多会话并行开发时,每个功能都要往这个数组里追加自己的脚本,
  合并时极易把顺序弄乱(例如把功能脚本插到工具脚本前面),
  而这类错误在浏览器里的表现是「某个功能莫名不生效」,极难定位。

  这道闸门把「顺序」变成机械校验:不满足就报错并指出该怎么放。

四段约定(每个 content_scripts 条目都要满足):
  0 开关定义层   src/content/flags.js        —— 必须第 0 位
  1 基础设施层   anchor / dialog / row-scan / tool-slots / locate
                 + cursor-fix(修正类,须早于功能层生效)
  2 功能层       各功能自己的脚本            —— ★ 新增功能往这里追加
  3 入口层       main.js(商品列表页) / toolbar.js(中控台)—— 必须最后一位

判定规则(按文件名,不看内容):
  · flags.js                          → 0
  · 在共享工具名单里                    → 1
  · 在入口名单里                        → 3
  · 其余                               → 2(新功能自动落在这一层,无需改本脚本)

校验内容:
  1. 条目里必须含 flags.js,且在第 0 位
  2. 必须含一个入口脚本,且在最后一位;
     或以「自启动脚本」收尾(轻量条目,见 SELF_BOOTING)
  3. 权重序列非递减(0 ≤ 1 ≤ 2 ≤ 3)
  4. 同一层内不允许重复文件

用法:
  python scripts/check-manifest-order.py            # 校验,不通过则退出码 1
  python scripts/check-manifest-order.py -h         # 帮助
"""

import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# 基础设施层:提供跨功能复用的能力,或在功能生效前必须先跑完的修正,
# 必须排在功能脚本之前。
# ⚠️ 同层内部不再校验相对顺序 —— 基础设施之间互不依赖,顺序无关紧要。
SHARED_TOOLS = {
    'src/content/anchor.js',      # 语义定位工具
    'src/content/dialog.js',      # 弹窗与状态栏
    'src/content/row-scan.js',    # 行监听
    'src/live/tool-slots.js',     # 中控台工具栏注册表
    'src/live/locate.js',         # 商品定位
    # 浮层让位判定(2026-11-01 补录):浮动控件的公共判据,必须早于
    # back-to-top / back-to-bottom / search / auto-refresh 等使用方。
    'src/content/overlay-guard.js',
    # 开播判据(2026-11-03 补录):中控台的公共判据,auto-refresh 与 lucky-bag
    # 共用同一份。必须早于所有使用方(第 16 / 21 位),否则两边各判一次、
    # 结论不一致 —— 这正是「没开播还在按间隔开抽屉」的根因。
    'src/content/live-state.js',
    'src/content/cursor-fix.js',  # 光标/焦点修正:只依赖 flags.js,须早于功能层
    # 诊断采集内核(2026-10-14 补录):必须在功能脚本之前挂上错误钩子,
    # 否则它「记录报错」这件事本身就漏掉了功能初始化阶段的异常。
    # 此前漏登记 ⇒ 它被当成功能层,排在基础设施之后,闸门一直误报 10 处。
    'src/content/diag.js',
    # ⚠️ debug-panel.js **不要**登记到这里(2026-10-30 试过,已撤回):
    # 它在抖店两条主条目里是**有意排在各功能脚本之后**的 ——
    # 面板晚挂才能收到功能初始化阶段的全部日志。归到基础设施层会让那两条
    # 立刻触发「层级倒序」误报。它允许「自启动收尾」的资格在 SELF_BOOTING 里,
    # 与层级归属是两件事。
}

# 入口层:负责启动或统一渲染,必须排在最后
ENTRIES = {
    'src/content/main.js',        # 商品列表页入口
    'src/live/toolbar.js',        # 中控台工具栏渲染器
}

# 自启动脚本:IIFE 里自带启动逻辑(自己读开关、自己订阅 storage 变化),
# 不需要入口脚本也能跑起来。允许这类脚本**单独成条**——
# 例如「隐藏页面元素」要铺到抖店各个页面,只带 flags.js + hide-elements.js,
# 不把商品列表页那整套脚本注入到无关页面。
# ⚠️ 只登记确实自启动的脚本;普通功能脚本仍必须挂在入口脚本之前。
SELF_BOOTING = {
    'src/content/shop-header-name.js',  # 抖店全域的店名样式，自行订阅开关。
    'src/live/hide-elements.js',
    # 直播回放下载(2026-10-18):这两个回放页没有工具栏入口,也不需要
    # main.js / toolbar.js —— 主流程自己读开关、自己订阅变化、自己挂按钮,
    # 末尾就是它,故整条只由「自启动脚本」收尾。
    'src/replay/replay-download.js',
    # 直播大屏跳转按钮(2026-10-18):这一页不做下载,只挂一枚「跳转直播服务平台」,
    # 同样自己读开关、自己订阅,不需要 main.js / toolbar.js。
    'src/replay/replay-link.js',
    # 活动广场联动渠道品(2026-10-25):页面没有工具栏入口,脚本自己读开关、
    # 自己订阅变化、自己挂点击监听;整条以 hide-elements.js 收尾,
    # 功能脚本排在它之前即可。
    'src/content/campaign-channel-tick.js',
    # 微信小店基础设施条目(2026-10-30):该域**本期没有任何业务功能**,
    # 整条只由基础设施脚本组成(标记 / 诊断 / 弹窗 / 消息盒子 / 调试面板),
    # 没有 main.js / toolbar.js 可当入口。debug-panel.js 自带 storage 订阅、
    # 全局点击委托与兜底标记,是本条目的最终启动点,故以它收尾。
    # 以后往微信域加真功能时,应把功能脚本排在它之前,并按需改回入口脚本收尾。
    'src/content/debug-panel.js',
}

FLAGS = 'src/content/flags.js'

# 主世界桥条目(2026-10-31):这类条目不提供"页面功能",只把**必须跑在 MAIN world
# 的程序**提前到 document_start 注入(读页面的 Vue 实例、hook 页面的 fetch/XHR)。
# 它**不能**带 flags.js —— flags.js 依赖 chrome.storage,而 MAIN world 里没有
# chrome.* 对象,带上会当场抛错、整条注入作废。同理也没有入口脚本,不参与层级排序。
MAIN_WORLD = {
    'src/content/wx-link-main.js',
}

LAYER_NAMES = {
    0: '开关定义层',
    1: '基础设施层',
    2: '功能层',
    3: '入口层',
}


def layer_of(path):
    if path == FLAGS:
        return 0
    if path in ENTRIES:
        return 3
    if path in SHARED_TOOLS:
        return 1
    return 2


def layer_label(n):
    return LAYER_NAMES.get(n, '未知层')


def main():
    if len(sys.argv) > 1 and sys.argv[1] in ('-h', '--help'):
        print(__doc__)
        return 0

    mf_path = os.path.join(ROOT, 'manifest.json')
    if not os.path.isfile(mf_path):
        print('[错误] 找不到 manifest.json:%s' % mf_path)
        return 1

    with open(mf_path, 'r', encoding='utf-8') as f:
        mf = json.load(f)

    entries = mf.get('content_scripts') or []
    if not entries:
        print('[错误] manifest.json 里没有 content_scripts')
        return 1

    problems = []
    print('===== manifest.json 脚本顺序校验 =====')
    print('%d 个 content_scripts 条目' % len(entries))
    print('')

    for i, cs in enumerate(entries):
        js = cs.get('js') or []
        matches = cs.get('matches') or []
        title = '条目[%d](%s)' % (i, matches[0] if matches else '无 matches')
        print('%s —— %d 个脚本' % (title, len(js)))

        # 0) 主世界桥条目:整条只由 MAIN world 脚本组成,不走开关层/入口/层级那套
        if js and all(p in MAIN_WORLD for p in js):
            print('   (主世界脚本条目 — 不要求 flags.js / 入口脚本,不参与层级排序)')
            for k, p in enumerate(js):
                print('   [%d] %-34s 主世界' % (k, p))
            print('')
            continue

        # 1) flags.js 必须在第 0 位
        if FLAGS not in js:
            problems.append('%s 缺少 %s(开关定义层缺失,所有功能读不到开关)' % (title, FLAGS))
        elif js.index(FLAGS) != 0:
            problems.append(
                '%s 的 %s 在第 %d 位,必须在第 0 位(它定义全局开关函数,'
                '后面所有脚本都依赖)' % (title, FLAGS, js.index(FLAGS)))

        # 2) 入口必须在最后一位,且只允许一个;轻量条目可用自启动脚本收尾
        entry_idx = [k for k, p in enumerate(js) if p in ENTRIES]
        if not entry_idx:
            if js and js[-1] in SELF_BOOTING:
                pass  # 轻量条目:末尾是自启动脚本,功能自己会跑起来
            else:
                problems.append(
                    '%s 没有入口脚本(应为 %s 之一),末尾也不是自启动脚本(%s),'
                    '页面功能不会被启动'
                    % (title, ' 或 '.join(sorted(ENTRIES)), ' 或 '.join(sorted(SELF_BOOTING))))
        else:
            if len(entry_idx) > 1:
                problems.append('%s 有多个入口脚本:%s,只应有一个'
                                % (title, ', '.join(js[k] for k in entry_idx)))
            last = entry_idx[-1]
            if last != len(js) - 1:
                problems.append(
                    '%s 的入口 %s 在第 %d 位,必须在最后一位(第 %d 位)'
                    % (title, js[last], last, len(js) - 1))

        # 3) 权重非递减 + 同层不重复
        prev_layer = -1
        seen = {}
        for k, p in enumerate(js):
            lay = layer_of(p)
            if p in seen:
                problems.append('%s 里 %s 重复出现(第 %d 与第 %d 位)'
                                % (title, p, seen[p], k))
            seen[p] = k
            if lay < prev_layer:
                problems.append(
                    '%s 顺序错:%s(第 %d 位,属%s)排在%s之后 —— '
                    '层级必须按 开关定义 → 基础设施 → 功能 → 入口 递增'
                    % (title, p, k, layer_label(lay), layer_label(prev_layer)))
            prev_layer = max(prev_layer, lay)

        for k, p in enumerate(js):
            mark = '★' if layer_of(p) == 2 else ' '
            print('   %s [%d] %-34s %s' % (mark, k, p, layer_label(layer_of(p))))
        print('')

    if problems:
        print('[不通过] 发现 %d 处问题:' % len(problems))
        for p in problems:
            print('  - %s' % p)
        print('')
        print('约定详见 AGENTS.md「页面匹配 → content_scripts 脚本顺序约定」。')
        print('新增功能脚本请插在「功能层」末尾(入口脚本之前),')
        print('不要插到 flags.js 之前,也不要插到入口脚本之后。')
        return 1

    print('[通过] 各条目的脚本顺序都符合约定。')
    print('  开关定义层在最前、入口层在最后、层级顺序正确、无重复。')
    return 0


if __name__ == '__main__':
    sys.exit(main())
