# -*- coding: utf-8 -*-
"""敏感词闸门 · 邻近匹配回归自测

★ 为什么要有这个自测（2026-11-01 实测踩坑）：
  中文没有词边界，子串匹配会误伤正常工程用语 ——
  实测「继**续发**布」被当成「活动类词 + 自动」同现而阻断，
  而那句话跟活动毫无关系。同理「循环讲解…续讲当前商品」。

  ⇒ 闸门改成「触发词必须落在语境词邻近窗口内（±4 字）」才算同现。
    这个自测把该行为**钉死**：既不能漏放真表述，也不能误伤正常用语。

★ 依赖：词表在工程外（<工程上级目录>/.dyc-sensitive-words.json）。
  词表缺失 → 本自测**直接判失败**（不跳过、不假装通过）——
  「没词表所以没命中」是假绿灯，比红灯危险。
"""
import importlib.util
import io
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
GATE = os.path.join(HERE, "check-sensitive-words.py")


def load_gate():
    spec = importlib.util.spec_from_file_location("dyc_gate", GATE)
    mod = importlib.util.module_from_spec(spec)
    # 抑制加载期的输出（load_words 的中止提示要留给真实调用）
    real_stdout = sys.stdout
    sys.stdout = io.StringIO()
    try:
        spec.loader.exec_module(mod)
    finally:
        sys.stdout = real_stdout
    return mod


def main():
    g = load_gate()
    words = g.load_words(None)
    if words is None:
        print("✗ 词表缺失 —— 闸门无法工作，自测判失败。")
        print("  词表应位于：<工程上级目录>/.dyc-sensitive-words.json")
        return 1

    g.BLOCK_WORDS = words["block_words"]
    g.CONTEXT_SENSITIVE = words["context_sensitive"]
    g.CONTEXT_TRIGGERS = words["context_triggers"]
    g.WARN_WORDS = words["warn_words"]
    wl = g.load_whitelist(words)

    # ★ 测试样本也从**工程外词表**里读（selftest_cases 字段）——
    #   样本本身含待拦的原词，写在仓库里会让闸门扫自己
    #   （与「自测用可见文案做断言 → 改文案要配套改断言」是同一类坑）。
    #   仓库里只留**不含原词**的正常用语样本。
    cases = words.get("selftest_cases") or {}
    must_block = list(cases.get("must_block") or [])
    # 正常工程/产品用语 —— 必须放行（误伤会逼人写出更难懂的话）
    must_pass = list(cases.get("must_pass") or []) + [
        "自测全绿则继续发布并提交改动",
        "发布闸门自动改写了易触发内容审核的表述",
        "循环讲解：到设定时长后取消并续讲当前商品",
        "内部文档与源码注释的表述改为更中性的说法",
        "更新源改双通道，主源失效时自动走备用镜像",
        "到点自动重新讲解当前商品",
    ]

    if not must_block:
        print("✗ 词表里没有 selftest_cases.must_block —— 无法验证检出能力，判失败。")
        print("  （词表缺样本 = 这道自测形同虚设，宁可判失败也不要假通过）")
        return 1

    failed = []

    print("必须拦下（真表述）：")
    for t in must_block:
        hits, _ = g.scan_text(t, wl)
        ok = len(hits) > 0
        if not ok:
            failed.append("漏放: %s" % t)
        print("  %-18s %s" % (t, "✓" if ok else "✗ 漏放"))

    print()
    print("必须放行（正常用语）：")
    for t in must_pass:
        hits, _ = g.scan_text(t, wl)
        ok = len(hits) == 0
        if not ok:
            failed.append("误伤: %s" % t)
        print("  %-34s %s" % (t[:32], "✓" if ok else "✗ 误伤"))

    print()
    if failed:
        print("✗ %d 项不符：" % len(failed))
        for f in failed:
            print("   - %s" % f)
        return 1
    print("✓ 邻近匹配行为符合预期（%d 拦 + %d 放）"
          % (len(must_block), len(must_pass)))
    return 0


if __name__ == "__main__":
    sys.exit(main())
