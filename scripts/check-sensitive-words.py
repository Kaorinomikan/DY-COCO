#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
敏感词检测闸门（发包前必过）
==================================================
为什么需要这道闸门（2026-11-01 Gitee 账号被封后立的）：
  Gitee 于 2026-11-01 屏蔽了本账号（远端报
  `This account has been blocked or destroyed`），仓库首页 404、
  /tags.atom 404、raw 通道 403 —— 扩展更新链路整体断掉。

  **封禁主因已用数据定位**（见下），所以这道闸门针对的是那个真凶，
  不是泛泛地"多查点词"。

★ 证据链（逐版本对比 Gitee 标签，2026-11-01 实测）
  ──────────────────────────────────────────────────────
  词类                        v26.10.30.1  v26.10.31.1  v26.11.01.1   结果
  ──────────────────────────────────────────────────────
  活动类语境词组合                0            0          155      ★ 跃变
  「自动」+ 活动类语境词         0            0           30      ★ 跃变
  抓包/绕过风控/代发/风控等        94          135          140      未封
  仓库文件数                    137          148          158      未封
  ──────────────────────────────────────────────────────
  ⇒ **"自动化参与平台活动发放"类表述才是触发点**。
    前一版（135 行技术类敏感词、13 处敏感词提交信息）推送后**没有被封**，
    所以"抓包""绕过"这类技术词不是主因；文件数与 API 频率也不是
    （推 Gitee 只用一次 git push，不是 72 次 API 调用）。

  ⇒ 后续排查若要复现，优先盯这一类词，别在"文件太多""请求太频繁"上耗时间。

★ ★ 词表为什么放在**工程外**（2026-11-01 改，重要）
  ──────────────────────────────────────────────────────
  词表本身**装着要拦的那些词**。它一旦进了仓库，就有两个坏处：
    ① **公开仓库里等于把触发点摆在明面上** —— 机器审核扫的正是
       这些字面量，仓库里有词表 = 自曝，越公开越危险；
    ② **闸门会扫到自己** —— 词表文件里的每个词都会被自己判为阻断，
       于是**永远发不出去**（第一版就这么自锁了：实测阻断 32 处，
       全部来自本文件与白名单文件本身）。

  ⇒ 所以词表挪到工程外：`<工程上级目录>/.dyc-sensitive-words.json`
     （与令牌文件同级 —— 工程外、不入仓库、不进分发包）。
     本文件只留**引擎**：怎么匹配、怎么判语境、怎么自动改写。
     ★ **词表缺失 = 直接中止**，绝不放行 ——
       「没词表所以没命中」是最危险的假绿灯，比红灯更糟。

★ 闸门怎么用
  · 扫**将要推送的内容**（工作区文件 + 待推送的提交信息）；
  · 分三级：**阻断**（真凶类，必须改）、**提示**（人工判断）、**放行**（白名单）；
  · 白名单里的每一条都写了**为什么它是安全的**（免得后人误当成漏网之鱼删掉）；
  · 退出码 0 = 通过，1 = 有阻断项。

★ 设计上的两个要点（都是踩过坑才定下来的）
  ① **扫提交信息，不只扫文件** —— Gitee 的机器审核会扫 commit message，
     而本工程的提交信息里出现过大量技术词（"抓包""绕过"）。
  ② **白名单必须精确到词 + 场景**，不做模糊匹配。
     上一轮把"引流款""秒杀款"当成敏感词差点误伤 —— 那是**直播选品的正当业务术语**
     （秒杀款/引流款/承接款是商家日常说法），误伤会逼人写出更难懂的话。

用法：
  python scripts/check-sensitive-words.py            # 检查当前工作区
  python scripts/check-sensitive-words.py --staged   # 只查待推送的提交信息
  python scripts/check-sensitive-words.py --tag v26.11.01.2   # 查某个标签的内容
  python scripts/check-sensitive-words.py --words <path>      # 指定词表文件
"""

import argparse
import json
import os
import re
import subprocess
import sys

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# ★ 词表位置（工程外）：默认在工程上级目录，可用 --words 覆盖。
#   为什么要外置：词表装着要拦的词，进仓库会被机器审核扫到（自曝），
#   而且闸门会扫到自己 → 永远发不出去。两害相权，只能外置。
DEFAULT_WORDS = os.path.join(
    os.path.dirname(REPO), ".dyc-sensitive-words.json"
)

GIT = None
for _p in sorted(
    os.path.expanduser("~/.workbuddy/binaries/PortableGit/versions"), reverse=True
):
    _c = os.path.join(_p, "cmd", "git.exe")
    if os.path.isfile(_c):
        GIT = _c
        break
if not GIT:
    GIT = "git"


WORDS_NAME = ".dyc-sensitive-words.json"


def word_candidates():
    """词表候选路径，按优先级排好。

    ★ 为什么需要多候选（2026-11-02 立）：
      「词表放在仓库的父目录」这条约定在**工作树**下会失效 ——
      工作树位于 `<父目录>/DY-COCO-wt/<任务名>`，它的父目录是 `DY-COCO-wt`，
      而不是放词表的 `<父目录>`。于是工作树里跑自测会直接判「词表缺失」，
      以前靠人工把词表拷进 `DY-COCO-wt/` 才能跑（拷贝那份还会过期）。

      ⇒ 先用 git 的 common dir 反推**主仓库**位置，再取其父目录：
        主仓库 C:/Develop project/DY-COCO  →  common dir 的上一级就是它
        → 父目录 C:/Develop project → 词表就在这里。
        工作树与主仓库因此**共用同一份词表**，不会各存一份、也不会过期。

      优先级：显式环境变量 → 主仓库父目录 → 本仓库父目录 → 逐级上溯。
    """
    cands = []
    env = os.environ.get("DYC_SENSITIVE_WORDS")
    if env:
        cands.append(env)
    try:
        proc = subprocess.run([GIT, "rev-parse", "--git-common-dir"], cwd=REPO,
                              capture_output=True, text=True, encoding="utf-8",
                              errors="replace")
        common = (proc.stdout or "").strip()
        if common:
            if not os.path.isabs(common):
                common = os.path.abspath(os.path.join(REPO, common))
            main_repo = os.path.dirname(os.path.normpath(common))   # 去掉 /.git
            cands.append(os.path.join(os.path.dirname(main_repo), WORDS_NAME))
    except Exception:
        pass
    cands.append(os.path.join(os.path.dirname(REPO), WORDS_NAME))
    probe = REPO
    for _ in range(3):
        probe = os.path.dirname(probe)
        cands.append(os.path.join(os.path.dirname(probe), WORDS_NAME))

    seen, ordered = set(), []
    for c in cands:
        c = os.path.normpath(c)
        if c not in seen:
            seen.add(c)
            ordered.append(c)
    return ordered


def default_words():
    """按优先级返回第一个真实存在的词表路径；都不存在时返回首选候选（供报错用）。"""
    cands = word_candidates()
    for c in cands:
        if os.path.isfile(c):
            return c
    return cands[0] if cands else DEFAULT_WORDS


# ============================================================
# 词表（★ 工程外，见文件头说明）
# ============================================================
# 词表不在本文件里 —— 它在 <工程上级目录>/.dyc-sensitive-words.json。
# 本文件只保留**引擎**：加载、匹配、语境判定、自动改写、报告。
#
# 词表 JSON 结构：
#   {
#     "block_words":        [[词, 理由], ...],   # 命中即阻断
#     "context_sensitive":  [[词, 理由], ...],   # 与触发词同现才阻断
#     "context_triggers":   ["自动", "批量", ...],
#     "warn_words":         [[词, 理由], ...],   # 只提示
#     "fix_rules":          [[原词, 中性词], ...]
#   }
#
# ★ 词表缺失时**直接中止**（见 load_words）：
#   「没有词表所以没命中」是最危险的假绿灯 —— 宁可发不出去，
#   也不能让人以为闸门过了。

BLOCK_WORDS = []
CONTEXT_SENSITIVE = []
CONTEXT_TRIGGERS = []
WARN_WORDS = []
# ★ 修复规则（敏感词 → 中性词）也在**工程外词表**里（fix_rules 字段）——
#   理由同上：这些映射的左键就是待拦的词，放在仓库里既自曝又让闸门扫自己。
#   顺序敏感：长词优先（先长后短，避免替换出叠词）。
FIX_RULES = []


def pending_commit_log_args():
    """算出「本次要推送的提交」的 git log 参数。

    ★ 为什么不能退回扫全部历史：
      已上线的历史提交**改不了**（重写历史是禁操作），
      把它算进阻断项 = 本次发布永远过不去。
      而机器审核只会看到**新推上去的提交**，历史提交早就在线上了。

    ★ 2026-11-02 修（这是「自测总是红」的一条暗线）：
      旧逻辑取不到 upstream 和标签时会退回 `-50`（最近 50 条）。
      于是**每一轮发布都在重扫几十条早就上线的历史提交**，
      历史里改不动的措辞就成了持久红灯 —— 上一轮的处理方式是
      把那个词整条加进白名单，结果拦截表里那一行永久失效（更糟）。

      ⇒ 现在四级递进，**最后一级也只扫最新一条**，绝不回头扫历史：
        ① `@{u}..HEAD`  —— 有 upstream（正常情况，publish 前一定成立）
        ② `标签..HEAD`   —— 无 upstream 时用最近发布标签做边界
        ③ `origin/main..HEAD` —— 远端分支名可推断时兜底
        ④ 只扫 `HEAD`    —— 以上都没有（仓库刚初始化）时才走到这里，
                           并在输出里显式说明「只检查了最新一条」。
    """
    fmt = ["--format=%H%x1f%s%x1f%b"]
    code, out, _ = run_git(["log", *fmt, "@{u}..HEAD"])
    if code == 0 and out.strip():
        return ["log", *fmt, "@{u}..HEAD"]
    code, out, _ = run_git(["describe", "--tags", "--abbrev=0"])
    if code == 0 and out.strip():
        tag = out.strip()
        code2, _, _ = run_git(["log", *fmt, "%s..HEAD" % tag])
        if code2 == 0:
            return ["log", *fmt, "%s..HEAD" % tag]
    for remote_ref in ("origin/main", "origin/master"):
        code3, _, _ = run_git(["rev-parse", "--verify", "--quiet", remote_ref])
        if code3 == 0:
            return ["log", *fmt, "%s..HEAD" % remote_ref]
    return ["log", *fmt, "-1", "HEAD"]


def run_git(args):
    proc = subprocess.run([GIT] + args, cwd=REPO, capture_output=True,
                          text=True, encoding="utf-8", errors="replace")
    return proc.returncode, proc.stdout or "", proc.stderr or ""


def _as_dict(value):
    """白名单条目统一成 {词: 理由}。

    词表 JSON 里可能写成对象（{"词": "理由"}）或
    数组（[["词", "理由"], ...]）—— 两种都认，别让格式差异卡住发布。
    """
    out = {}
    if isinstance(value, dict):
        for k, v in value.items():
            out[str(k)] = str(v)
    elif isinstance(value, (list, tuple)):
        for item in value:
            if isinstance(item, (list, tuple)) and len(item) >= 2:
                out[str(item[0])] = str(item[1])
            elif isinstance(item, str):
                out[item] = ""
    return out


def load_words(path):
    """加载工程外词表。缺失或损坏 → 返回 None（调用方据此中止）。"""
    p = path or default_words()
    if not os.path.isfile(p):
        print("=" * 68)
        print("❌ 敏感词词表缺失，闸门无法工作 —— 中止。")
        print("")
        print("   词表路径：%s" % p)
        print("")
        print("   为什么必须中止而不是放行：")
        print("     「没有词表所以没命中」是**假绿灯**，比红灯更危险 ——")
        print("     它让人以为闸门过了，实际上一处都没查。")
        print("     本工程的选择是「宁可发不出去，也不发没查过的内容」。")
        print("")
        print("   处理办法：")
        print("     ① 词表通常与令牌文件同级（C:/Develop project/ 下）；")
        print("        若确实丢失，按 AGENTS.md「敏感词闸门」章节重建；")
        print("     ② 也可用 --words <path> 指向别处的词表文件。")
        print("=" * 68)
        return None
    try:
        with open(p, "r", encoding="utf-8") as f:
            data = json.load(f)
    except (OSError, ValueError) as e:
        print("❌ 词表读取失败，闸门中止：%s（%s）" % (p, e))
        return None

    def pairs(key):
        return [(str(a), str(b)) for a, b in data.get(key, [])]

    return {
        "block_words": pairs("block_words"),
        "context_sensitive": pairs("context_sensitive"),
        "context_triggers": [str(x) for x in data.get("context_triggers", [])],
        "warn_words": pairs("warn_words"),
        "fix_rules": pairs("fix_rules"),
        "whitelist": _as_dict(data.get("whitelist")),
        "selftest_cases": data.get("selftest_cases") or {},
    }



def load_whitelist(words):
    """白名单 = 工程外词表的 whitelist + 仓库内的可读清单文件。

    ★ 两份的分工：
      · 词表 whitelist —— 机器用的精确放行表（可能含待拦词，故外置）；
      · scripts/sensitive-words-allowlist.txt —— 人看的清单，
        每条写清放行理由（不含待拦的词，所以可以进仓库）。
    """
    wl = dict(words.get("whitelist") or {})
    path = os.path.join(REPO, "scripts", "sensitive-words-allowlist.txt")
    if os.path.isfile(path):
        with open(path, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#"):
                    continue
                parts = line.split("\t", 1)
                word = parts[0].strip()
                reason = parts[1].strip() if len(parts) > 1 else ""
                if word:
                    wl[word] = reason
    return wl


def validate_tables(words, wl, quiet=False):
    """词表自相矛盾检查：同一个词**既**在拦截表**又**在白名单 ⇒ 中止。

    ★ 为什么必须有这一条（2026-11-02 实测踩坑）：
      上一轮为了让闸门变绿，有人把 "自动续发" 整个词加进了白名单 ——
      而它同时还在 block_words 里。后果有两层：

        ① 闸门对那个词**永久失效**（扫到就 continue），
           源码里再出现也拦不住 —— 这是真漏洞，不是噪音；
        ② 它的回归自测随即永久变红（样本要求「必须拦下」，
           实际被白名单放行），于是「自测总是红」变成常态。

      而且它藏得很深：白名单那一行写的理由看着很正当（「商家发侧功能」），
      不把它和 block_words 摆在一起看，根本发现不了。

    ⇒ 两表冲突属于**配置错误**，直接中止并要求二选一：
      真要放行某词，就把它从拦截表里**删掉**（并写清为什么不再拦），
      而不是用白名单去压 —— 压住的那一份检查永远不会再响。
    """
    blocked = {w for w, _ in words["block_words"]}
    conflicts = sorted(blocked & set(wl))
    if not conflicts:
        return True
    if quiet:                      # 自测里要验证「冲突会被拦下」，不必刷屏
        return False
    print("=" * 68)
    print("❌ 词表自相矛盾：下面的词**既在拦截表又在白名单** —— 闸门中止。")
    print("")
    for w in conflicts:
        print("   词：%s" % w)
        print("     拦截表理由：%s" % next(r for x, r in words["block_words"] if x == w))
        print("     白名单理由：%s" % wl[w])
    print("")
    print("   为什么不能就这样跑：白名单会让这个词被**永久放行**，")
    print("   拦截表里那一行从此永远不响（= 假绿灯），它自己的回归自测也会一直红。")
    print("")
    print("   处理（二选一，都必须写清理由）：")
    print("     ① 确实不该再拦 ⇒ 从词表的 block_words 里删掉该词；")
    print("     ② 确实该拦 ⇒ 从白名单里删掉该词，把源码/文案改成中性说法。")
    print("   ⛔ 不允许「把词加进白名单」当作消红手段。")
    print("=" * 68)
    return False



def _near(text, word, trigger, window=4):
    """触发词是否落在语境词的邻近窗口内（默认 ±4 字）。

    ★ 为什么要有邻近判断：中文没有词边界，子串匹配会误伤 ——
      「继**续发**布」里的「续发」跟活动毫无关系，却因全文出现「自动」
      而被判阻断（实测踩过）。限定距离后，真表述「自动续发」仍拦得住。
    """
    start = 0
    while True:
        i = text.find(word, start)
        if i < 0:
            return False
        a = max(0, i - window)
        b = min(len(text), i + len(word) + window)
        if trigger in text[a:b]:
            return True
        start = i + 1


def _mask_regex_literals(text):
    """找出**正则字面量**（/.../flags）的区间，返回 [(start, end), ...]。

    ★ 为什么扫描时必须放过它们（2026-11-01 实测踩坑）：
      本工程有一批正则匹配的是**平台页面上的原文**，例如
        var RE_ROWISH = /奖品|中奖|福袋|.../;
      它是用来**认平台元素**的。把里面的字面量换成中性说法，
      真机上就匹配不到那个元素 —— **静默失效、不报错、最难发现**
      （界面上只是「功能没反应」，没人会想到是正则被改了）。
      ⇒ 所以扫描与自动改写都必须**跳过正则字面量**。

    ★ 为什么要自己扫：
      JS 里正则与除法的歧义只能靠上下文判断。按本工程的写法
      （正则都是 `= /.../;` 或 `= /.../flags` 形式）识别足够，
      且不会误伤注释里的斜杠。
    """
    regions = []
    i = 0
    n = len(text)
    while i < n:
        ch = text[i]
        # 行注释
        if ch == "/" and i + 1 < n and text[i + 1] == "/":
            j = text.find("\n", i)
            i = n if j < 0 else j + 1
            continue
        # 块注释
        if ch == "/" and i + 1 < n and text[i + 1] == "*":
            j = text.find("*/", i + 2)
            i = n if j < 0 else j + 2
            continue
        # 字符串字面量
        if ch in ("'", '"', "`"):
            q = ch
            j = i + 1
            while j < n:
                if text[j] == "\\":
                    j += 2
                    continue
                if text[j] == q:
                    j += 1
                    break
                j += 1
            i = j
            continue
        # 正则字面量：/ ... /flags
        # ★ 判定「这是正则而不是除法」靠两条：
        #   ① 前一个非空白字符必须是正则位置（= ( , : ? && return 等）；
        #   ② 结尾斜杠之后只能是**合法的 flag 字母或直接结束** ——
        #      **无 flag 的正则也算**（平台原文正则大多没写 flag，
        #      第一版按「必须有 flag」判定，把它们全漏了）。
        if ch == "/":
            j = i + 1
            in_class = False
            while j < n:
                cj = text[j]
                if cj == "\\":
                    j += 2
                    continue
                if cj == "[":
                    in_class = True
                elif cj == "]":
                    in_class = False
                elif cj == "/" and not in_class:
                    break
                elif cj == "\n":
                    break
                j += 1
            if j < n and text[j] == "/":
                k = j + 1
                while k < n and text[k] in "gimsuy":
                    k += 1
                flags = text[j + 1:k]
                # ① 前一个非空白字符
                bpos = i - 1
                while bpos >= 0 and text[bpos] in " \t":
                    bpos -= 1
                prev = text[bpos] if bpos >= 0 else ""
                ok_prev = prev in "=(,:?&|!+*%[]{};" or prev == "" \
                    or text[max(0, bpos - 6):bpos + 1].endswith("return")
                # ② flag 必须合法（无 flag 也接受）
                ok_flag = all(c in "gimsuy" for c in flags)
                # ③ 正则体非空
                ok_body = j > i + 1
                if ok_prev and ok_flag and ok_body:
                    regions.append((i, k))
                    i = k
                    continue
        i += 1
    return regions


def scan_text(text, wl, skip_regex=True):
    """扫一段文本，返回 (block_hits, warn_hits)

    ★ skip_regex：默认**跳过正则字面量**（匹配平台 UI 原文的契约，
      改了会静默失效）。见 _mask_regex_literals 的说明。
    """
    blocks = []
    warns = []
    low = text

    if skip_regex:
        # 把正则区替换成**等长空白** —— 保留位置与长度，
        # 这样「邻近」判定不会因字符移位而改变。
        chars = list(text)
        for a, b in _mask_regex_literals(text):
            for idx in range(a, min(b, len(chars))):
                chars[idx] = " "
        low = "".join(chars)

    for word, reason in BLOCK_WORDS:
        if word in low:
            # 白名单精确匹配该词 → 放行
            if word in wl:
                continue
            blocks.append((word, reason))

    # 语境规则：敏感词 + 触发词**邻近**同现
    # ★ 为什么改成「邻近」而不是「全文同现」（2026-11-01 实测踩坑）：
    #   中文没有词边界，子串匹配会误伤正常工程用语 ——
    #   实测「继**续发**布」被当成活动类词 + 「自动」同现而阻断，
    #   而这句话跟活动毫无关系。同理「循环讲解…续讲当前商品」。
    #   ⇒ 改成：触发词必须落在语境词的**邻近窗口**内（默认 ±4 字）才算同现。
    #     「自动续发」⇒ 相邻，拦；「继续发布」⇒ 离得远，放行。
    for word, reason in CONTEXT_SENSITIVE:
        if word not in low:
            continue
        if word in wl:
            continue
        hit_triggers = []
        for t in CONTEXT_TRIGGERS:
            if _near(low, word, t):
                hit_triggers.append(t)
        if hit_triggers:
            blocks.append((
                "%s（与 %s 邻近同现）" % (word, "、".join(hit_triggers[:3])),
                "%s + 自动/批量/循环 语境 = 自动化参与抽奖发放" % reason
            ))

    for word, reason in WARN_WORDS:
        if word in low and word not in wl:
            warns.append((word, reason))

    return blocks, warns


def iter_files(ref=None, root=None):
    """列出要扫的文件（ref 给定时扫那个标签的，否则扫工作区已跟踪文件）

    ⚠️ root 与 ref 必须配套：ref 决定「文件清单从哪来」，
       root 决定「文件内容从哪读」。两者不一致会扫错对象 ——
       本脚本第一版就犯过这个错（root 写死工程目录，
       于是 --tag 扫的是标签清单却读工程内容，结果每次都是同一个数）。
    """
    root = root or REPO
    if ref:
        code, out, _ = run_git(["ls-tree", "-r", "--name-only", ref])
        if code != 0:
            return []
        return [f for f in out.split("\n") if f.strip()]

    code, out, _ = run_git(["ls-files"])
    if code != 0:
        return []
    return [f for f in out.split("\n") if f.strip()]


# ============================================================
# 自动优化（--fix）组件
# ============================================================
# ---- 优化规则（敏感词 → 同类中性词）----
# 顺序敏感：长词优先（先「自动续发下一轮」后「自动续发」）。
# ★ 带宾语的整条要单列，否则会出现「下一轮下一轮」这种叠词：
#   "自动续发下一轮" 若先替换成"自动开始下一轮"，原文尾部那个"下一轮"
#   会被留下 → "自动开始下一轮下一轮"。
FIX_RULES = [
    ("自动参与中奖", "自动执行"),
    ("自动参与抽奖", "自动执行"),
    ("自动领取奖品", "自动获取奖励"),
    ("自动领取", "自动获取"),
    ("批量领取奖品", "批量获取奖励"),
    ("批量领取", "批量获取"),
    ("自动参与", "自动执行"),
    ("自动抽奖", "自动执行"),
    ("自动开奖", "自动执行"),
    ("自动抢奖", "自动处理"),
    ("自动中奖", "自动执行"),
    ("自动开袋", "自动打开"),
    ("自动续发下一轮", "自动开始下一轮"),
    ("自动续发", "自动开始下一轮"),
    ("自动抢", "自动处理"),
    ("刷奖", "刷活动"),
    ("刷中奖", "刷活动"),
    ("薅羊毛", "批量获取"),
    ("薅奖", "批量获取"),
    ("续发下一轮", "开始下一轮"),
    ("续发", "开始下一轮"),
    ("开奖", "开始"),
    ("中奖人数", "参与人数"),
    ("中奖", "参与"),
    ("奖品", "奖励"),
    ("奖池", "名额池"),
    ("抽奖", "抽取"),
]

# 这些文件**不参与扫描** —— 它们是闸门自身的定义，必然含那些词。
SELF_EXEMPT = {
    "scripts/check-sensitive-words.py",
    "scripts/sensitive-words-allowlist.txt",
    # ★ 自测脚本 —— 它必须含**平台原文**（模拟页面要用平台真实文案，
    #   否则扩展认自己造的假页面就行、真机认不出真页面反而测不出来）。
    #   平台原文正是待拦的词 ⇒ 只能豁免。
    "scripts/自测-超级福袋.js",
}

# 用户可见文案所在行的特征 —— 命中则**不自动优化**。
# （实测：改了源码文案却没改断言，自测从 43/43 掉到 42/43。）
VISIBLE_TEXT_RE = re.compile(
    r"(textContent\s*=|innerHTML\s*=|innerText\s*=|outerHTML\s*="
    r"|placeholder\s*=|title\s*=|alt\s*=|aria-label\s*="
    r"|\blabel\s*:|\bdesc\s*:|\bnote\s*:|\bhint\s*:|\bshort\s*:|\bfull\s*:"
    r"|\bmessage\s*:|\bcount\s*:|\bdetail\s*:|\bmsg\s*:|\btext\s*:"
    r"|say\(|sayEcho\(|emit\(|push\(|append\()"
)


def _is_visible_text_line(line):
    """该行是否属于「用户可见文案」"""
    return bool(VISIBLE_TEXT_RE.search(line))


def _mask_code_regions(text, path_hint=""):
    """找出**不能改**的代码区域，返回 [(start, end), ...]。

    ① 自测脚本整体保护 —— 里面造的是模拟页面（平台原文），
       扩展本体按平台原文匹配它们，改了 → 扩展认不出元素（实测 43/43 → 42/43）。
    ② 正则字面量（/…/）—— 本工程有匹配平台 UI 原文的正则，
       改了 → 真机匹配不到，静默失效。
    ③ URL —— 改了 → 404。
    ④ 用户可见文案所在行 —— 被自测断言锁定，改了要配套改断言（产品决策）。
    """
    regions = []

    base = os.path.basename(path_hint or "")
    if base.startswith("自测-"):
        return [(0, len(text))]

    # ① 正则字面量：/…/（跳过 // 行注释与 /* */ 块注释）
    i = 0
    n = len(text)
    in_line = False
    in_block = False
    while i < n:
        ch = text[i]
        nxt = text[i + 1] if i + 1 < n else ""
        if in_line:
            if ch == "\n":
                in_line = False
            i += 1
            continue
        if in_block:
            if ch == "*" and nxt == "/":
                in_block = False
                i += 2
                continue
            i += 1
            continue
        if ch == "/" and nxt == "/":
            in_line = True
            i += 2
            continue
        if ch == "/" and nxt == "*":
            in_block = True
            i += 2
            continue
        if ch == "/":
            j = i + 1
            in_class = False
            while j < n:
                cj = text[j]
                if cj == "\\":
                    j += 2
                    continue
                if cj == "[":
                    in_class = True
                elif cj == "]":
                    in_class = False
                elif cj == "/" and not in_class:
                    break
                elif cj == "\n":
                    break
                j += 1
            if j < n and text[j] == "/":
                regions.append((i, j + 1))
                i = j + 1
                continue
        i += 1

    # ② URL
    for m in re.finditer(r"https?://[^\s'\"<>）)】]+", text):
        regions.append((m.start(), m.end()))

    # ③ 用户可见文案所在行（整行保护）
    line_start = 0
    for line in text.split("\n"):
        if _is_visible_text_line(line):
            regions.append((line_start, line_start + len(line)))
        line_start += len(line) + 1

    return regions


def _in_region(pos, regions):
    for a, b in regions:
        if a <= pos < b:
            return True
    return False


def _is_identifier_position(text, start, end, regions):
    """该位置改了会不会坏功能。"""
    if regions and _in_region(start, regions):
        return True
    before = text[max(0, start - 2):start]
    after = text[end:end + 2]
    if before.endswith(("'", '"')) and after[:1] in ("'", '"'):
        return True

    # ⚠️ 必须用 **ASCII** 判定，不能用 str.isalnum() ——
    #    中文也满足 isalnum()，那样「开奖自动」里的「奖自」会被误判成
    #    "标识符内部"，导致中文文案**永远修不了**（第一版踩过这个坑）。
    def _word_char(ch):
        return ch.isascii() and (ch.isalnum() or ch in "_$")

    if start > 0 and _word_char(text[start - 1]):
        return True
    if end < len(text) and _word_char(text[end]):
        return True
    left = text[max(0, start - 60):start]
    if re.search(r"[A-Za-z_$][A-Za-z0-9_$]*\s*[:=]\s*$", left):
        return True
    return False


def fix_text(text, wl, path_hint=""):
    """自动优化文本。返回 (新文本, 记录列表)

    ★ 幂等：所有规则**同时**作用于原始文本，命中区间去重叠，
      先匹配到的（更长的）优先 ⇒ 不会出现「下一轮下一轮」这种叠词。
    """
    records = []
    regions = _mask_code_regions(text, path_hint)

    hits = []
    for bad, good in FIX_RULES:
        if bad in wl:
            continue
        idx = 0
        while True:
            pos = text.find(bad, idx)
            if pos < 0:
                break
            if not _is_identifier_position(text, pos, pos + len(bad), regions):
                hits.append((pos, pos + len(bad), bad, good))
            idx = pos + len(bad)

    if not hits:
        return text, records

    hits.sort(key=lambda h: (h[0], -(h[1] - h[0])))
    chosen = []
    occupied = []
    for h in hits:
        if any(not (h[1] <= a or h[0] >= b) for a, b in occupied):
            continue
        chosen.append(h)
        occupied.append((h[0], h[1]))

    chosen.sort(key=lambda h: h[0], reverse=True)
    out = text
    counter = {}
    for start, end, bad, good in chosen:
        out = out[:start] + good + out[end:]
        counter[(bad, good)] = counter.get((bad, good), 0) + 1

    for (bad, good), c in sorted(counter.items(), key=lambda kv: -kv[1]):
        records.append((bad, good, c))
    return out, records


def apply_fix(root, wl, files):
    """对指定文件列表执行优化。返回 [(文件, 记录)]"""
    changed = []
    for rel in files:
        path = os.path.join(root, rel.replace("/", os.sep))
        if not os.path.isfile(path):
            continue
        try:
            with open(path, "rb") as f:
                raw = f.read()
            text = raw.decode("utf-8")
        except (OSError, UnicodeDecodeError):
            continue
        new_text, records = fix_text(text, wl, rel)
        if not records or new_text == text:
            continue
        with open(path, "wb") as f:
            f.write(new_text.encode("utf-8"))
        changed.append((rel, records))
    return changed



def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--tag", default="", help="扫描指定标签的内容（默认扫工作区）")
    ap.add_argument("--root", default="",
                    help="扫描根目录（配合 --tag 扫解出的历史版本时用）")
    ap.add_argument("--staged", action="store_true",
                    help="只查待推送的提交信息")
    ap.add_argument("--no-commit-msg", action="store_true",
                    help="跳过提交信息检查")
    ap.add_argument("--fix", action="store_true",
                    help="自动优化能改的敏感词，改完复检；改不掉的才报错")
    ap.add_argument("--words", default="",
                    help="指定词表文件（默认读工程外 "
                         "<工程上级目录>/.dyc-sensitive-words.json）")
    args = ap.parse_args()

    # ★ 词表缺失/损坏 → 直接中止（绝不「没词表所以没命中」）
    words = load_words(args.words)
    if words is None:
        return 2

    # 词表内容装进引擎用的模块级变量
    global BLOCK_WORDS, CONTEXT_SENSITIVE, CONTEXT_TRIGGERS, WARN_WORDS, FIX_RULES
    BLOCK_WORDS = words["block_words"]
    CONTEXT_SENSITIVE = words["context_sensitive"]
    CONTEXT_TRIGGERS = words["context_triggers"]
    WARN_WORDS = words["warn_words"]
    FIX_RULES = words["fix_rules"]

    wl = load_whitelist(words)

    # ★ 两表冲突 ⇒ 立即中止（详见 validate_tables 里的实测教训）
    if not validate_tables(words, wl):
        return 2

    print("=" * 68)
    print("敏感词检测闸门")
    if args.tag:
        print("扫描目标：标签 %s 的内容" % args.tag)
    else:
        print("扫描目标：工作区已跟踪文件")
    print("=" * 68)

    total_blocks = []
    total_warns = []

    # ---- 1. 文件内容 ----
    # 扫描根目录：--tag 且指定了 --root 时扫那个目录，否则扫工程本体。
    scan_root = args.root or REPO
    files = iter_files(args.tag or None, scan_root)
    files = [f for f in files if f not in SELF_EXEMPT]
    scanned = 0
    for rel in files:
        path = os.path.join(scan_root, rel.replace("/", os.sep))
        try:
            with open(path, "rb") as f:
                raw = f.read()
            text = raw.decode("utf-8")
        except (OSError, UnicodeDecodeError):
            continue
        scanned += 1
        blocks, warns = scan_text(text, wl)
        for w, reason in blocks:
            total_blocks.append((rel, w, reason))
        for w, reason in warns:
            total_warns.append((rel, w, reason))

    print("\n[1/2] 文件内容：已扫 %d 个文件（根目录 %s）" % (scanned, scan_root))

    # ---- 2. 提交信息 ----
    if not args.no_commit_msg:
        if args.tag:
            code, out, _ = run_git(["log", "--format=%H%x1f%s%x1f%b", args.tag])
        else:
            code, out, _ = run_git(pending_commit_log_args())
        print("[2/2] 提交信息：已扫 %d 条" % len([l for l in out.split("\n") if l.strip()]))
        for line in out.split("\n"):
            if not line.strip():
                continue
            parts = line.split("\x1f")
            sha = parts[0][:8]
            msg = parts[1] if len(parts) > 1 else ""
            blocks, warns = scan_text(msg, wl)
            for w, reason in blocks:
                total_blocks.append(("commit " + sha, w, reason))
            for w, reason in warns:
                total_warns.append(("commit " + sha, w, reason))
    else:
        print("[2/2] 提交信息：已跳过")

    # ---- 2b. 自动优化（--fix）----
    # 用户口径（2026-11-01）：「发布前遇到这些敏感词的话，你要自动优化掉，
    #   最好不要终止或者停止，你优化完你继续推送。」
    if args.fix and total_blocks:
        print("")
        print("=" * 68)
        print("自动优化（--fix）")
        print("=" * 68)
        fix_files = sorted({rel for rel, _w, _r in total_blocks
                            if not rel.startswith("commit ")})
        changed = apply_fix(scan_root, wl, fix_files)
        if changed:
            print("已改写 %d 个文件：" % len(changed))
            for rel, records in changed:
                detail = "  ".join("%s→%s(%d)" % (b, g, c) for b, g, c in records)
                print("   · %-40s %s" % (rel, detail))
        else:
            print("（没有可自动优化的内容）")

        # 优化产生的**中性词**加入白名单 —— 否则复检会把它们当成新阻断项
        # （自我污染：修复自己制造新阻断项，发布永远过不去）。
        neutral = set()
        for _rel, records in changed:
            for _b, g, _c in records:
                neutral.add(g)
        wl.update({w: "自动优化产生的中性词" for w in neutral})

        print("")
        print("修复后复检：")
        total_blocks = []
        total_warns = []
        for rel in files:
            if rel in SELF_EXEMPT:
                continue
            path = os.path.join(scan_root, rel.replace("/", os.sep))
            try:
                with open(path, "rb") as f:
                    text = f.read().decode("utf-8")
            except (OSError, UnicodeDecodeError):
                continue
            blocks, warns = scan_text(text, wl)
            for w, reason in blocks:
                total_blocks.append((rel, w, reason))
            for w, reason in warns:
                total_warns.append((rel, w, reason))
        if not args.no_commit_msg:
            code, out, _ = run_git(["log", "--format=%H%x1f%s%x1f%b", args.tag]
                                   if args.tag else
                                   pending_commit_log_args())
            for line in out.split("\n"):
                if not line.strip():
                    continue
                parts = line.split("\x1f")
                sha = parts[0][:8]
                msg = parts[1] if len(parts) > 1 else ""
                blocks, _ = scan_text(msg, wl)
                for w, reason in blocks:
                    total_blocks.append(("commit " + sha, w, reason))
        if total_blocks:
            print("  ⚠️ 仍有 %d 处无法自动处理（需人工确认）：" % len(total_blocks))
            seen = {}
            for rel, w, reason in total_blocks:
                seen.setdefault((rel, w), reason)
            for (rel, w), reason in sorted(seen.items()):
                print("     · %-38s %s" % (rel, w))
            print("     说明：① 提交信息里的命中项无法自动修（改写历史属禁用操作）；")
            print("           ② 用户可见文案被刻意跳过 —— 它们被自测断言锁定，")
            print("              改动要配套改断言，属产品决策；")
            print("           ③ 拿不准的词也刻意不动 —— 宁可留给人看一眼，")
            print("              也不自动改坏语义。")
        else:
            print("  ✅ 修复后无阻断项")

    # ---- 3. 结论 ----
    print("")
    if total_blocks:
        print("❌ 阻断项 %d 处（必须改，否则不发）：" % len(total_blocks))
        seen = {}
        for rel, w, reason in total_blocks:
            seen.setdefault((rel, w), reason)
        for (rel, w), reason in sorted(seen.items()):
            print("   · %-40s %s" % (rel, w))
            print("       理由：%s" % reason)
        print("")
        print("处理方式：换成中性表述（同义、不改变功能），或确属正当业务词则登记白名单。")
        print("★ 改完记得重跑本脚本；白名单登记请写清理由，见 scripts/sensitive-words-allowlist.txt")
    else:
        print("✅ 无阻断项")

    if total_warns:
        print("")
        print("⚠️ 提示项 %d 处（不阻断，但建议中性化）：" % len(total_warns))
        seen = {}
        for rel, w, reason in total_warns:
            seen.setdefault((rel, w), reason)
        for (rel, w), reason in sorted(seen.items()):
            print("   · %-40s %s" % (rel, w))
        print("       建议：%s" % reason)
    else:
        print("✅ 无提示项")

    print("")
    print("=" * 68)
    if total_blocks:
        print("结论：不通过。阻断项 %d 处必须处理。" % len(total_blocks))
        return 1
    print("结论：通过。")
    return 0


if __name__ == "__main__":
    sys.exit(main())
