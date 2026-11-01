# -*- coding: utf-8 -*-
"""推送成功后重置「待推送」清单(开发待办.md)。

用法:
  python scripts/reset-pending.py --version 26.10.13.3 [--points 5] [--dry-run]

为什么需要它(用户 2026-10-13 定「推送后重置」):
  推送门槛按 `开发待办.md` 的「待推送」章节计点。若推送完不把该栏清空,
  下一轮的计数会**接着旧条目往上加**,越攒越虚 —— 用户明确要求推送后重置。
  机械执行放在 publish.sh 里,不靠会话记性。

行为(幂等):
  · 只动 `## 待推送` 章节,其他章节一字不碰;
  · 2026-10-21 修缺陷:旧版按「### + - 子项 + 缩进续行」的**旧栏格式**过滤,
    而栏格式早已演化为「### 标题 + 顶格正文段 + > 细节引用块」—— 顶格正文
    不是子项也不是缩进续行,条目细节引用块又撞上「保留 > 引用块」规则,
    结果标题删了、正文与引用块全残留(35732a4 实测残留 1103 行)。
    现改为:栏内只保留 章头 + 紧随其后的固定计点规则提示引用块 +
    新「上一批」说明行,其余(标题/正文/条目引用块/子项/空行)一律清掉;
  · 无条目但检出「无头残留」(旧版漏删的正文/引用块)同样执行清理 ——
    否则历史残留永远修不掉;
  · 若章节里既没有条目也没有残留 -> 一律不动文件,直接退 0(重复跑安全);
  · 清空后追加一行「上一批(N 项,合计 M 个点)已随 `<版本>` 推送上线…」;
  · 行尾沿用文件原有风格(原本 CRLF 就写回 CRLF)。

注意:publish.sh 是在**推送成功之后**才调用本脚本,所以它造成的改动属于
「推送后才产生的本地改动」,需要由助手提交一次(否则下次推送的
「工作区必须干净」闸门会拦住)。脚本结束时会把这一点打印出来。
"""

import argparse
import io
import os
import sys

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TODO_FILE = os.path.join(REPO, "开发待办.md")

SECTION_HEAD = "## 待推送"


def read_text(path):
    with open(path, "rb") as f:
        raw = f.read()
    newline = "\r\n" if raw.count(b"\r\n") > 0 and raw.count(b"\r\n") == raw.count(b"\n") else "\n"
    return raw.decode("utf-8").replace("\r\n", "\n"), newline


def write_text(path, text, newline):
    data = text if newline == "\n" else text.replace("\n", newline)
    with open(path, "wb") as f:
        f.write(data.encode("utf-8"))


def main():
    ap = argparse.ArgumentParser(add_help=True)
    ap.add_argument("--version", default="(未知版本)", help="本次推送的版本号,例 26.10.13.3")
    ap.add_argument("--points", default="", help="本批合计点数(功能点+基建点,可选,写进说明行)")
    ap.add_argument("--dry-run", action="store_true", help="只打印将要改成什么样,不落盘")
    args = ap.parse_args()

    if not os.path.isfile(TODO_FILE):
        print("[错误] 找不到 %s" % TODO_FILE)
        return 2

    text, newline = read_text(TODO_FILE)
    lines = text.split("\n")

    start = None
    for i, ln in enumerate(lines):
        if ln.startswith("## ") and "待推送" in ln:
            start = i
            break
    if start is None:
        print("[错误] 开发待办.md 里找不到「%s」章节,未改动。" % SECTION_HEAD)
        return 2

    end = len(lines)
    for j in range(start + 1, len(lines)):
        if lines[j].startswith("## "):
            end = j
            break

    # ── 过滤核心(2026-10-21 重写,修「只删标题、正文全残留」缺陷) ──
    # 栏内合法保留:章头后紧随的固定计点规则提示引用块(连续 > 行);
    # 其后的一切(### 标题 / 顶格正文 / 条目 > 引用块 / - 子项 / 空行)
    # 一律清除 —— 按「推送后本栏自动清空」的用户口径。
    kept, items, old_note_dropped = [], [], False

    i = start + 1
    while i < end and not lines[i].strip():
        i += 1                                  # 章头后的空行
    while i < end and lines[i].strip().startswith(">"):
        kept.append(lines[i])                   # 固定计点规则提示块,原样保留
        i += 1

    stray = False                               # 无头残留:旧版脚本漏删的正文等
    for ln in lines[i:end]:
        s = ln.strip()
        if s.startswith("### "):
            items.append(s[4:])
        if s.startswith(">") and "上一批" in s:
            old_note_dropped = True
        elif s and not s.startswith(">"):
            stray = True                        # 顶格正文/子项/「(暂无)」等

    if not items and not stray:
        print("[跳过] 「待推送」栏没有条目(也没有残留),文件未改动。")
        return 0

    # 去掉保留行的尾部空行,再拼新的说明行
    while kept and not kept[-1].strip():
        kept.pop()
    note = "> 上一批(%d 项" % len(items)
    if args.points != "":
        note += ",合计 %s 个点" % args.points
    note += ")已随 `%s` 推送上线,明细见 `RELEASE_NOTES.md` 与 `开发日志.md`。" % args.version

    body = kept + ["", note, ""]
    new_lines = lines[:start + 1] + body + lines[end:]
    new_text = "\n".join(new_lines)

    print("[重置] 待推送栏清空 %d 条(旧的「上一批」说明:%s)%s" % (
        len(items),
        "已替换" if old_note_dropped else "原本没有",
        "" if items else " —— 栏内无标题条目,清的是旧版脚本漏删的无头残留"))
    for it in items:
        print("        - %s" % it)
    print("[重置] 追加说明:%s" % note)

    if args.dry_run:
        print("[预演] 未写盘。")
        return 0

    write_text(TODO_FILE, new_text, newline)
    print("[完成] %s 已重置(本地未提交 —— 请提交一次,否则下次推送会被「工作区干净」闸门拦住)。" % TODO_FILE)
    return 0


if __name__ == "__main__":
    sys.exit(main())
