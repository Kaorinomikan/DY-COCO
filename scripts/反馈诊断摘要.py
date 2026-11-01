#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
把反馈的「诊断快照」(feedback 表的 diag 列) 转成助手可读的紧凑文本。

定位 (反馈诊断包第 4 层 · 通道①)：
  助手在会话里要读一条反馈的体检报告时，直接对着原始 JSON 看太费上下文；
  这个脚本把它压成几行结构化的中文，一眼能看出「哪个页面 / 哪个控件坏了 / 报了什么错」。

用法：
  python scripts/反馈诊断摘要.py --items rows.json
  python scripts/反馈诊断摘要.py --items rows.json --id 24
  python scripts/反馈诊断摘要.py --items rows.json --brief     # 3 行版，日报邮件用

输入 items.json —— 由助手用 DB 工具查出后落盘（不把大字段带进上下文即可）：
  [{"id":24,"type":"功能问题","ver":"26.10.13.4","time":"10月13日 23:26",
    "text":"打击好好哦哦哦哈哈", "diag":{...}}, ...]

输出：stdout 纯文本，一条反馈一段；diag 为空的写「无诊断信息」。
"""
import argparse
import json
import sys

FROM_TEXT = {"capture": "拍屏", "paste": "粘贴", "file": "选文件"}


def _pad(s, n):
    """按显示宽度补空格（中文字符算 2 列），让多行输出对齐"""
    s = str(s)
    w = sum(2 if ord(c) > 127 else 1 for c in s)
    return s + " " * max(0, n - w)


def _dur(ms):
    try:
        s = float(ms) / 1000.0
    except (TypeError, ValueError):
        return "?"
    if s < 60:
        return "%.0f 秒" % s
    if s < 3600:
        return "%.1f 分钟" % (s / 60.0)
    return "%.1f 小时" % (s / 3600.0)


def _rel(ts, base):
    try:
        return "+%.1fs" % ((float(ts) - float(base)) / 1000.0)
    except (TypeError, ValueError):
        return "?"


def head(it):
    return "#%s %s · v%s · %s" % (
        it.get("id"), it.get("type") or "?", it.get("ver") or "?", it.get("time") or "?")


def brief(it):
    """3 行版：日报邮件用（手机上一眼扫过）"""
    diag = it.get("diag") or {}
    env = diag.get("env") or {}
    if not env:
        return head(it) + "\n  描述：%s\n  无诊断信息" % (it.get("text") or "")
    errs = list(diag.get("errors") or []) + list(diag.get("swErrors") or [])
    groups = (diag.get("widgets") or {}).get("groups") or []
    bad = [g for g in groups if g.get("bad")]
    shots = diag.get("shots") or []
    bits = []
    if env.get("scope") == "extPage":
        # 兜底小窗本身就是要紧信息（说明面板没能注入页面），降级原因一并带上
        bits.append("兜底小窗" + (("（%s）" % str(env.get("why"))[:48]) if env.get("why") else ""))
    else:
        bits.append("%s · %s" % (env.get("kind") or "?", env.get("engine") or "?"))
    if groups:
        bits.append("控件 %d 类%s" % (len(groups), ("（%d 类异常）" % len(bad)) if bad else ""))
    if errs:
        bits.append("报错 %d 条" % len(errs))
    if shots:
        bits.append("图 %d 张" % len(shots))
    line = "  " + " · ".join(bits)
    if errs:
        line += "\n  首条报错：%s" % (errs[0].get("m") or "")[:160]
    return head(it) + "\n  描述：%s\n%s" % (it.get("text") or "", line)


def full(it):
    out = [head(it), "  描述：%s" % (it.get("text") or "")]
    diag = it.get("diag") or {}
    env = diag.get("env") or {}
    if not env:
        out.append("  无诊断信息（提交时取消了勾选，或采集内核未在该页面生效）")
        return "\n".join(out)

    base = env.get("boot")
    if env.get("scope") == "extPage":
        out.append("  位置：兜底小窗（扩展页面）"
                   + ((" · 降级原因：%s" % env.get("why")) if env.get("why") else ""))
    else:
        out.append("  页面：%s · %s" % (env.get("kind") or "?", env.get("url") or "（未采集）"))
        if env.get("title"):
            out.append("  标题：%s" % env["title"])
    out.append("  视口：%s×%s @%s× · 文档高 %spx"
               % (env.get("vw"), env.get("vh"), env.get("dpr"), env.get("docH")))
    out.append("  内核：%s · 扩展已存活 %s" % (env.get("engine") or "?", _dur(env.get("age"))))
    caps = env.get("caps") or {}
    missing = sorted([k for k, v in caps.items() if not v])
    if missing:
        out.append("  缺能力：%s" % "、".join(missing))

    flags = diag.get("flags") or {}
    on = flags.get("on") or {}
    if on:
        out.append("  开关：" + "、".join("%s=%s" % (k, "开" if v else "关")
                                        for k, v in sorted(on.items())))
        mode = flags.get("mode") or {}
        bits = []
        if mode.get("scanShade"):
            bits.append("白幕档=%s" % mode["scanShade"])
        if mode.get("omni"):
            bits.append("全能档=%s" % mode["omni"])
        if isinstance(mode.get("hideList"), list):
            bits.append("隐藏勾选=%d 项" % len(mode["hideList"]))
        if bits:
            out.append("  档位：" + "、".join(bits))

    groups = (diag.get("widgets") or {}).get("groups") or []
    out.append("  控件（%d 类，只列挂上或异常的）：" % len(groups))
    shown = [g for g in groups if g.get("n") or g.get("bad")]
    if not shown:
        out.append("    （页面上没有任何扩展控件）")
    for g in shown:
        # 异常有三种：采集侧标了 bad（零尺寸/被隐藏/不可见），或 vis 明确为 false
        mark = "✗" if (g.get("bad") or g.get("vis") is False) else "✓"
        rect = g.get("rect") or []
        rect_s = "[%s]" % ",".join(str(x) for x in rect) if rect else ""
        note = ("  ← %s" % g["bad"]) if g.get("bad") else ""
        out.append("    %s %s%s×%-4s%s%s" % (
            mark, _pad(g.get("label") or "-", 18), _pad(g.get("id"), 22),
            g.get("n"), _pad(rect_s, 20), note))

    # 自动循环讲解(2026-10-27):该功能跑着时的现场,反馈里已经带着了,这里给一行摘要
    al = diag.get("autoLoop") or {}
    if al:
        st = al.get("状态") or {}
        sc = al.get("现场") or {}
        interval = ("%s 秒" % st.get("seconds", "?")) if st.get("mode") == "second" else ("%s 分钟" % st.get("minutes", "?"))
        line = "  循环讲解：%s · %s · 间隔 %s" % (
            "开" if st.get("on") else "关", st.get("phase") or "?",
            interval)
        if st.get("round"):
            line += " · 第 %s 轮" % st.get("round")
        if st.get("fails"):
            line += " · 连续失败 %s 次" % st.get("fails")
        out.append(line)
        out.append("    键 %s · 商品 %s" % (st.get("key") or "无", st.get("product") or "无"))
        if sc:
            out.append("    现场：行 %s / 标记 %s / 迷你 %s" % (
                sc.get("rows"), sc.get("marks"), "是" if sc.get("mini") else "否"))
            ids = sc.get("idSample") or {}
            if ids:
                out.append("    ID 体检：%s" % (
                    ("picked=" + str(ids.get("picked"))) if ids.get("picked") else "未抓到 ID"))

    errs = list(diag.get("errors") or [])
    for e in (diag.get("swErrors") or []):
        e = dict(e)
        e["s"] = (e.get("s") or "sw") + "(后台)"
        errs.append(e)
    out.append("  报错（%d 条）：" % len(errs))
    if not errs:
        out.append("    （扩展自身未抛异常）")
    for e in errs:
        out.append("    [%s] %s · %s" % (
            _rel(e.get("t"), base) if base else "?", e.get("s") or "?", e.get("m") or ""))
        if e.get("k"):
            for ln in str(e["k"]).splitlines()[:5]:
                out.append("      %s" % ln.strip())

    tl = diag.get("timeline") or []
    out.append("  轨迹（%d 条）：" % len(tl))
    for t in tl:
        seg = "    [%s] %s" % (_rel(t.get("t"), base) if base else "?", t.get("a") or "")
        if t.get("d"):
            seg += " · " + t["d"]
        if t.get("r"):
            seg += "（%s）" % t["r"]      # 用括号包住结果，避免和 detail 的 · 连成两个箭头
        out.append(seg)

    shots = diag.get("shots") or []
    if shots:
        out.append("  截图：" + "；".join(
            "图%d %s %s %s×%s %sKB" % (
                i, FROM_TEXT.get(s.get("from"), s.get("from") or "?"),
                (s.get("fmt") or "?").upper(), s.get("w"), s.get("h"), s.get("kb"))
            for i, s in enumerate(shots, start=1)))
    meta = []
    if diag.get("took") is not None:
        meta.append("采集耗时 %sms" % diag["took"])
    if diag.get("truncated"):
        meta.append("已截断(超 64KB)")
    if meta:
        out.append("  快照：" + " · ".join(meta))
    return "\n".join(out)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--items", required=True, help="反馈条目 JSON（含 diag 字段）")
    ap.add_argument("--id", type=int, default=None, help="只看某一条")
    ap.add_argument("--brief", action="store_true", help="3 行精简版（日报邮件用）")
    args = ap.parse_args()

    with open(args.items, "r", encoding="utf-8") as f:
        items = json.load(f)

    sel = [it for it in items if args.id is None or it.get("id") == args.id]
    if not sel:
        print("没有匹配的条目（--id %s）" % args.id)
        return 1

    render = brief if args.brief else full
    for it in sel:
        print(render(it))
        print("")
    return 0


if __name__ == "__main__":
    sys.exit(main())
