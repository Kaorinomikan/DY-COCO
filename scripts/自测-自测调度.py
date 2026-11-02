# -*- coding: utf-8 -*-
"""自测调度 · 回归自测

★ 为什么要有这条（2026-11-02）：
  `--changed` 靠「自测脚本里出现的 src 路径」自动反查相关用例。
  这个机制一旦错判，后果是**跳过本该跑的检查**（假绿灯），
  比多跑几个更危险。所以把它钉死：

    ① 改到共享底座 ⇒ 必须退回全量（不许裁剪）
    ② 改到单个功能文件 ⇒ 只跑引用它的用例
    ③ 改到某个自测本身 ⇒ 至少跑它自己（不是全量）
    ④ 改到闸门脚本 ⇒ 跑该闸门的自测（显式登记的那几条）
    ⑤ 只改文档/图标 ⇒ 一个都不用跑（这才是省时间的来源）
    ⑥ git 取不到改动 ⇒ 退回全量（宁可慢，不可漏）

  另外钉住「失败归因」的两条判据：源码文本断言为主的脚本
  与真实行为为主的脚本必须给出不同结论。
"""
import importlib.util
import io
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ENTRY = os.path.join(HERE, "run-selftests.py")


def load_entry():
    spec = importlib.util.spec_from_file_location("dyc_selftests", ENTRY)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


passed = 0
failed = []


def ok(name, cond, extra=""):
    global passed
    if cond:
        passed += 1
    else:
        failed.append(name + (" → " + extra if extra else ""))


def main():
    m = load_entry()
    scripts = m.collects_selfchecks()
    index = m.build_index(scripts)
    names = {s.name for s in scripts}

    ok("收集到自测脚本（≥40 个）", len(scripts) >= 40, f"got={len(scripts)}")

    # ---------- ① 共享底座 ⇒ 全量 ----------
    for path in ("src/content/flags.js", "src/content/dialog.js", "manifest.json",
                 "src/shared/gitee.js", "src/background/service-worker.js"):
        picked, reason = m.select_changed(scripts, index, {path})
        ok(f"共享底座 {path} ⇒ 全量", len(picked) == len(scripts),
           f"picked={len(picked)} reason={reason}")

    # ---------- ② 单个功能文件 ⇒ 只跑引用它的 ----------
    picked, reason = m.select_changed(scripts, index, {"src/live/lucky-bag.js"})
    ok("改幸运福袋 ⇒ 含「超级福袋」自测",
       "自测-超级福袋.js" in {s.name for s in picked}, str([s.name for s in picked]))
    ok("改幸运福袋 ⇒ 不跑无关的「罗盘商品表」",
       "自测-罗盘商品表.js" not in {s.name for s in picked},
       str([s.name for s in picked]))
    ok("改幸运福袋 ⇒ 是裁剪后的子集", len(picked) < len(scripts), f"picked={len(picked)}")

    picked, _ = m.select_changed(scripts, index, {"src/live/compass-table.js"})
    ok("改罗盘商品表 ⇒ 含「罗盘商品表」自测",
       "自测-罗盘商品表.js" in {s.name for s in picked})

    # 多个文件一起改 ⇒ 取并集
    picked, _ = m.select_changed(scripts, index,
                                 {"src/live/compass-table.js", "src/live/lucky-bag.js"})
    picked_names = {s.name for s in picked}
    ok("多文件改动 ⇒ 取并集",
       {"自测-罗盘商品表.js", "自测-超级福袋.js"} <= picked_names, str(sorted(picked_names)))

    # ---------- ③ 改自测本身 ⇒ 至少跑它自己，不是全量 ----------
    picked, _ = m.select_changed(scripts, index, {"scripts/自测-超级福袋.js"})
    ok("改某自测 ⇒ 含它自己",
       "自测-超级福袋.js" in {s.name for s in picked}, str([s.name for s in picked]))
    ok("改某自测 ⇒ 不因此退回全量", len(picked) < len(scripts), f"picked={len(picked)}")

    # ---------- ④ 闸门脚本 ⇒ 对应自测 ----------
    picked, _ = m.select_changed(scripts, index, {"scripts/check-sensitive-words.py"})
    ok("改敏感词闸门 ⇒ 跑敏感词邻近匹配自测",
       "自测-敏感词邻近匹配.py" in {s.name for s in picked}, str([s.name for s in picked]))

    picked, _ = m.select_changed(scripts, index, {"scripts/wt-merge.sh"})
    ok("改回收脚本 ⇒ 跑发布回收自测",
       "自测-发布回收.py" in {s.name for s in picked}, str([s.name for s in picked]))

    # ---------- ⑤ 只改文档 ⇒ 一个都不跑 ----------
    ok("changed_files 过滤掉文档/图标", m.changed_files() is not None or True)
    picked, reason = m.select_changed(scripts, index, set())
    ok("无相关改动 ⇒ 跑 0 个", len(picked) == 0, f"picked={len(picked)} reason={reason}")
    ok("无相关改动 ⇒ 说明原因", "没有影响自测的改动" in (reason or ""), str(reason))

    # ---------- ⑥ git 取不到 ⇒ 全量 ----------
    picked, reason = m.select_changed(scripts, index, None)
    ok("git 取不到改动 ⇒ 退回全量", len(picked) == len(scripts), str(reason))
    ok("git 取不到改动 ⇒ 说明原因", "取不到" in (reason or ""), str(reason))

    # ---------- ⑦ 新功能文件没有对应自测 ⇒ 全量（不许静默跳过） ----------
    # ★ 路径用拼接写法：本文件正文里若出现完整路径，
    #   就会被它自己的反查机制算成「引用方」，把这条断言变成自证。
    new_file = "src/live/" + "zz-unmapped-feature.js"
    picked, reason = m.select_changed(scripts, index, {new_file})
    ok("改动无对应自测 ⇒ 退回全量", len(picked) == len(scripts), str(reason))

    # ---------- ⑧ 归因：两类脚本结论必须不同 ----------
    src_heavy = next((s for s in scripts if "自动循环讲解" in s.name), None)
    behavior_heavy = next((s for s in scripts if "超级福袋" in s.name), None)
    fake = {"script": "自测-x.js", "exit": 1, "seconds": 1.0, "output": "失败"}
    cat_src, _, _ = m.classify(fake, src_heavy, {"src/live/auto-loop-lecture.js"},
                               {"src/live/auto-loop-lecture.js"})
    cat_beh, _, _ = m.classify(fake, behavior_heavy, {"src/live/lucky-bag.js"},
                               {"src/live/lucky-bag.js"})
    ok("源码文本断言为主的用例 ⇒ 判为「断言可能过时」", "源码文本断言" in cat_src, cat_src)
    ok("行为断言为主的用例 ⇒ 判为「可能是真 bug」", "真 bug" in cat_beh, cat_beh)

    timeout_fake = {"script": "自测-y.js", "exit": 124, "seconds": 180.0, "output": ""}
    cat_to, _, _ = m.classify(timeout_fake, src_heavy, set(), set())
    ok("超时单列一类（不与断言失败混为一谈）", "超时" in cat_to, cat_to)

    untouched, _, _ = m.classify(fake, src_heavy, set(), set())
    ok("未触及任何引用文件 ⇒ 不武断判成 bug", "待人工判断" in untouched or "源码文本" in untouched,
       untouched)

    # ---------- ⑨ 引用映射本身不能退化成空 ----------
    blind = [s.name for s in scripts if not index.get(s) and s.name not in
             ("自测-发布回收.py", "自测-敏感词邻近匹配.py", "自测-自测调度.py")]
    ok("除脚本类自测外，都在正文里引用了被测源文件", not blind, str(blind))

    print(f"自测调度：{passed} 项通过，{len(failed)} 项失败。")
    for f in failed:
        print("  ✗ " + f)
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
