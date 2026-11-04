#!/bin/bash
# ============================================================
# 看板 —— 四栏一屏:待推送 / 已开工 / bug 待修复 / 计划中
# ============================================================
# 用法:bash scripts/看板.sh
#
# 设计口径(用户 2026-10-11 定,2026-10-14 扩栏,2026-10-24 改版):
#   ① 美观、一页看完,任何一行都不许宽到要横向滚动
#   ② 分四栏:待推送 / 已开工 / bug 待修复 / 计划中
#     (2026-10-24 用户定「看板要写计划中,已开工,bug 待修复」:
#      原「计划」栏按是否开工拆成「计划中(未动工)」与「已开工(分支已建)」;
#      原「开发中」栏并入「已开工」;「待修复 bug」栏名对齐为「bug 待修复」)
# 数据来源:
#   待推送、已开工、bug 待修复、计划中 ← 开发待办.md 对应章节(### 与 - 开头的行)
#   已开工的工作树动态状态(领先/落后/待提交) ← git worktree 里所有 task/ 分支
# 流转:计划中 --开工.sh 建分支--> 已开工 --wt-merge 回收--> 改动记「待推送」栏
# 想看某任务的逐文件明细,跑 bash scripts/wt-list.sh
# ============================================================

HERE="$(dirname "$0")"
. "$HERE/中文工具.sh"

cd "$REPO" || die "进不去工程目录"

TODO_FILE="$REPO/开发待办.md"
NOW=$(date '+%m-%d %H:%M')

# ---------- 提取 开发待办.md 指定章节的条目 ----------
# 用法:section_items "章节名关键词" [t]
#   不带 t:取该章节内 "### " 与 "- " 开头的行(适合待办列表)
#   带 t  :只取 "### " 开头的标题行(适合待推送栏,不要子项细节)
# 2026-10-19 用户定:看板上每一行都必须是「还要动手的活」 ——
#   已放弃修复的、已修完转「待推送」的,不许再以「（…）」括注形式残留一栏。
#   实操约定:这类去向说明写进章节末尾的引用块(> 开头),不要写成 `- （…）` 条目;
#   万一写成了,这里兜底跳过 —— 以全角/半角括号开头的条目一律不视为待办。
section_items() {
  [ -f "$TODO_FILE" ] || return 0
  awk -v sec="$1" -v titles="${2:-}" '
    { sub(/\r$/, "") }
    /^## /          { insec = (index($0, sec) == 4) }
    insec && /^### /{ print substr($0, 5) }
    insec && /^- / && titles != "t" {
      item = substr($0, 3)
      anno = (substr(item, 1, 1) == "（" || substr(item, 1, 1) == "(")
      if (!anno) print item
    }
  ' "$TODO_FILE"
}

LAST_TAG=$("$GIT" tag --sort=-creatordate 2>/dev/null | head -1)
[ -z "$LAST_TAG" ] && LAST_TAG="(无标签)"
MAIN_DIRTY=$("$GIT" status --porcelain 2>/dev/null | wc -l | tr -d ' ')

echo "══════════════════════════════════════"
echo "  DY-COCO 看板  $NOW"
echo "══════════════════════════════════════"
echo ""

# ================= 一、待推送 =================
# 门槛数字与计点规则**不在本文件里写死** —— 一律问 scripts/计点.sh(唯一事实来源)。
# 起因:这里曾写死 5、文档写 10,两边漂移并误导过一次判断(2026-10-13)。
echo "▌待推送   在线版 $LAST_TAG"
if [ -f "$HERE/计点.sh" ]; then
  bash "$HERE/计点.sh" --board
else
  echo "  [!] 找不到 scripts/计点.sh —— 无法统计待推送项(清单仍在 开发待办.md)"
fi
echo ""

# ================= 二、已开工 =================
# 工作树动态状态(git worktree 所有 task/ 分支) + 开发待办.md「已开工」章的登记条目。
# 2026-10-24 用户定:原「开发中」栏并入本栏,与「计划中(未动工)」明确分开。
TASKS=$("$GIT" worktree list --porcelain 2>/dev/null | awk '
  /^worktree / { wt = substr($0, 10) }
  /^branch /   { print wt "\t" $2 }
' | grep 'refs/heads/task/' || true)
TCOUNT=$(printf '%s\n' "$TASKS" | grep -c . 2>/dev/null || true)
[ -z "$TASKS" ] && TCOUNT=0

if [ "$MAIN_DIRTY" -gt 0 ]; then
  echo "▌已开工   共 $TCOUNT 个 · ⚠主工作区有 $MAIN_DIRTY 个未提交"
else
  echo "▌已开工   共 $TCOUNT 个 · 主工作区干净"
fi

PLAN_N=0
while IFS= read -r item; do
  [ -z "$item" ] && continue
  PLAN_N=$((PLAN_N + 1))
  echo "  $PLAN_N. $item"
done < <(section_items "已开工")
if [ "$PLAN_N" -eq 0 ]; then
  echo "  (登记条目暂无)"
fi

if [ "$TCOUNT" -eq 0 ]; then
  echo "  (无工作树)"
else
  printf '%s\n' "$TASKS" | while IFS=$'\t' read -r WTPATH BRANCHREF; do
    BRANCH=${BRANCHREF#refs/heads/}
    NAME=${BRANCH#task/}
    AHEAD=$("$GIT" rev-list --count "main..$BRANCH" 2>/dev/null || echo '?')
    BEHIND=$("$GIT" rev-list --count "$BRANCH..main" 2>/dev/null || echo '?')
    DIRTY=0
    [ -d "$WTPATH" ] && DIRTY=$("$GIT" -C "$WTPATH" status --porcelain 2>/dev/null | wc -l | tr -d ' ')
    # 回收判定:没新提交 / 快进会冲突 / 可干净回收
    if [ "$AHEAD" = "0" ]; then
      MARK="·尚无新提交"
    elif "$GIT" merge-tree "$("$GIT" merge-base main "$BRANCH" 2>/dev/null)" main "$BRANCH" 2>/dev/null | grep -q '^<<<<<<<\|changed in both'; then
      MARK="·⚠回收会冲突"
    else
      MARK="·✓可回收"
    fi
    echo "  ● $NAME 领先$AHEAD 落后$BEHIND 待提交$DIRTY $MARK"
  done
  echo "  回收:bash scripts/wt-merge.sh <名字>"
fi

# 测试档同步状态（2026-10-14 用户追问「反馈衍生出的修 bug 会不会绕开同步」后加）。
# 同步本身**挂在流程节点上**（wt-merge 回收成功 / publish 推送成功 /
# make-update-manifest 生成清单，三处自动触发），正常路径不会漏。
# 唯一的薄弱环节是「跳过合并、直接在主工作区改扩展本体」—— 那条靠自觉，
# 这里把状态摆到看板上，漏了一眼就能看到。
# 2026-11-05 加「来源」分支：sync-coco-test.sh 支持 --from <工作树名> 之后，
# 测试档可能**故意**装着未合并的工作树代码（用户在真机验证）。
# 那种状态跑无参 --check 必然报「不一致」，若照旧显示「补同步」，
# 就会把用户指去跑一条会把新代码冲掉的命令。所以先看来源标记。
SYNC_STATE="(未检查)"
SYNC_MARK="$HERE/../.tmp/coco-test-source"
SYNC_FROM=""
[ -f "$SYNC_MARK" ] && SYNC_FROM=$(sed -n 's/^name=//p' "$SYNC_MARK" 2>/dev/null | head -1)
if [ -n "$SYNC_FROM" ]; then
  SYNC_STATE="▶ 正在测未合并的工作树「$SYNC_FROM」(合并时自动切回主干)"
elif [ -f "$HERE/sync-coco-test.sh" ]; then
  if bash "$HERE/sync-coco-test.sh" --check >/dev/null 2>&1; then
    SYNC_STATE="✓ 与主干一致"
  else
    SYNC_STATE="⚠ 不一致 —— 跑 bash scripts/sync-coco-test.sh 补同步"
  fi
fi
echo "  测试档(桌面 COCO TEST):$SYNC_STATE"
echo ""

# ================= 三、bug 待修复 =================
# 评审通过、但**当场修不好**的 bug(需现场探针 / 需用户配合 / 要单独排期)。
# 来源:开发待办.md 的「bug 待修复」章节(原名「待修复 bug」,2026-10-24 用户定对齐栏名)。
echo "▌bug 待修复"
BUG_N=0
while IFS= read -r item; do
  [ -z "$item" ] && continue
  BUG_N=$((BUG_N + 1))
  echo "  $BUG_N. $item"
done < <(section_items "bug 待修复")
if [ "$BUG_N" -eq 0 ]; then
  echo "  (暂无)"
fi
echo ""

# ================= 四、计划中 =================
# 评审通过、值得做的新功能与点子,等排期开工(未动工)。
# 来源:开发待办.md 的「计划中」章节。开工(建分支)后条目移入「已开工」章。
echo "▌计划中"
PLAN2_N=0
while IFS= read -r item; do
  [ -z "$item" ] && continue
  PLAN2_N=$((PLAN2_N + 1))
  echo "  $PLAN2_N. $item"
done < <(section_items "计划中")
if [ "$PLAN2_N" -eq 0 ]; then
  echo "  (暂无)"
fi
echo "  开工:bash scripts/开工.sh <名字> \"一句话描述\"(开工后条目移入「已开工」章)"
echo ""
echo "──────────────────────────────────────"
echo " 明细:bash scripts/wt-list.sh"
