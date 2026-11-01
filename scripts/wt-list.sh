#!/bin/bash
# ============================================================
# 并行开发 · 看板
#
# 一条命令看清:有哪些并行任务、各自改到哪一步、能不能回收。
#
# 用法:
#   bash scripts/wt-list.sh
# ============================================================

# git 路径自动探测(2026-10-14 修,原因见 中文工具.sh)
GIT="$(ls -d C:/Users/79412/.workbuddy/binaries/PortableGit/versions/*/cmd/git.exe 2>/dev/null | sort -V | tail -1)"
[ -n "$GIT" ] || GIT="$(command -v git)"
REPO="C:/Develop project/DY-COCO"

cd "$REPO"

echo "============================================================"
echo " 并行开发看板   $(date '+%Y-%m-%d %H:%M')"
echo "============================================================"
echo ""

# --- 主工作区 ---
MAIN_HEAD=$("$GIT" rev-parse --short HEAD)
MAIN_DIRTY=$("$GIT" status --porcelain | wc -l | tr -d ' ')
echo "【主工作区】main @ $MAIN_HEAD"
if [ "$MAIN_DIRTY" -gt 0 ]; then
  echo "   ⚠️ 有 $MAIN_DIRTY 个未提交改动(并行开发期间主工作区应保持干净)"
  "$GIT" status --short | sed 's/^/      /'
else
  echo "   ✅ 干净"
fi
echo ""

# --- 各任务分支 ---
# ⚠️ 路径含空格(本工程在 "C:/Develop project" 下),
#    不能用 awk 默认分词取 $2,会截断成 "C:/Develop"。
#    用 substr 去掉 "worktree " 前缀取整行。
TASKS=$("$GIT" worktree list --porcelain | awk '
  /^worktree / { wt = substr($0, 10) }
  /^branch /   { print wt "\t" $2 }
' | grep 'refs/heads/task/' || true)

if [ -z "$TASKS" ]; then
  echo "【并行任务】无"
  echo "   开一个:bash scripts/wt-new.sh <名字> \"任务描述\""
  echo ""
  exit 0
fi

COUNT=$(printf '%s\n' "$TASKS" | wc -l | tr -d ' ')
echo "【并行任务】共 $COUNT 个"
echo ""

printf '%s\n' "$TASKS" | while IFS=$'\t' read -r WTPATH BRANCHREF; do
  BRANCH=${BRANCHREF#refs/heads/}
  NAME=${BRANCH#task/}

  AHEAD=$("$GIT" rev-list --count "main..$BRANCH" 2>/dev/null || echo '?')
  BEHIND=$("$GIT" rev-list --count "$BRANCH..main" 2>/dev/null || echo '?')
  LAST=$("$GIT" log -1 --format='%h %ad %s' --date=format:'%m-%d %H:%M' "$BRANCH" 2>/dev/null)

  DIRTY=""
  if [ -d "$WTPATH" ]; then
    N=$("$GIT" -C "$WTPATH" status --porcelain 2>/dev/null | wc -l | tr -d ' ')
    [ "$N" -gt 0 ] && DIRTY="(目录内还有 $N 个未提交)"
  else
    DIRTY="(目录不存在!)"
  fi

  # 回收预检:能不能快进 / 会冲突吗
  FILES=$("$GIT" diff --name-only "main..$BRANCH" 2>/dev/null)
  CONFLICT="?"
  if "$GIT" merge-tree "$("$GIT" merge-base main "$BRANCH")" main "$BRANCH" 2>/dev/null | grep -q '^<<<<<<<\|changed in both'; then
    CONFLICT="⚠️ 会冲突"
  else
    CONFLICT="✅ 可干净回收"
  fi

  echo "── $NAME ──────────────────────────────────────"
  echo "   分支    : $BRANCH"
  echo "   领先 main: $AHEAD 个提交   落后: $BEHIND 个"
  echo "   最后提交: $LAST"
  echo "   目录    : $WTPATH $DIRTY"
  echo "   回收预检: $CONFLICT"
  echo "   涉及文件:"
  printf '%s\n' "$FILES" | sed 's/^/      /'
  echo ""
done

echo "回收一个任务:bash scripts/wt-merge.sh <名字>"