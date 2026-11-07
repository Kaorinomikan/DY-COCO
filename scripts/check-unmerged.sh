#!/bin/bash
# ============================================================
# 已提交但未回收的任务 —— 机械提醒
# ============================================================
# 为什么需要它(2026-11-08):
#   「自动合并」这条口径写进了 AGENTS 铁律和 TASK.md 模板,但**写过规则不等于会执行** ——
#   会话收工时停在「已提交、未合并」就交差的坑反复出现,用户每次都要下口令「合并」。
#   按 AGENTS 第 0 条闸②(能机械化的落脚本),把这件事做成脚本:任何一次查状态
#   (计点 / 看板)都会把漏合并的任务顶到眼前。
#
# 判据:task/* 分支里有领先 main 的提交。工作树干不干净都算 ——
#   干净 = 该合的没合;脏  = 还在做。
#
# 输出约定:
#   有未回收任务 → 逐行打印提示,退出码 1
#   没有         → 什么都不打印,退出码 0
#
# 用法:bash scripts/check-unmerged.sh
# ============================================================

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HERE/中文工具.sh"

cd "$REPO" 2>/dev/null || { echo "  [!] 进不去工程目录，跳过未回收检查"; exit 0; }

BRANCHES=$("$GIT" for-each-ref --format='%(refname:short)' refs/heads 2>/dev/null | grep '^task/' || true)
[ -n "$BRANCHES" ] || exit 0

FOUND=0
while IFS= read -r b; do
  [ -n "$b" ] || continue
  N=$("$GIT" rev-list --count "main..$b" 2>/dev/null || echo 0)
  [ "$N" -gt 0 ] 2>/dev/null || continue
  NAME="${b#task/}"
  echo "  ⛔ 未回收任务:$NAME（领先 main $N 个提交）"
  echo "     立即执行:bash scripts/回收.sh $NAME"
  echo "     —— 除新功能外一律自动合并,不要等用户口令"
  FOUND=$((FOUND + 1))
done <<EOF
$BRANCHES
EOF

[ "$FOUND" -gt 0 ] && exit 1
exit 0
