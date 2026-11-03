#!/bin/bash
# ============================================================
# 继续 —— 接着开发一个已经开了的任务
# ============================================================
# 用法:bash scripts/继续.sh 回到顶部
#
# 场景:任务开发到一半,换个对话窗口接着做。
# 这个脚本会把「现在做到哪、代码改了哪些、提交过什么、下一步该干什么」
# 汇成一段现成的话,复制给新窗口即可。
#
# 它只读不写 —— 不会碰任何代码。
# ============================================================

HERE="$(dirname "$0")"
. "$HERE/中文工具.sh"

check_name "$1"
NAME="$1"
WT="$WT_ROOT/$NAME"
TASK="$WT/TASK.md"

cd "$REPO" || die "进不去工程目录"

[ -d "$WT" ] || die "找不到任务「$NAME」的工作目录。
可能它已经回收过了。看当前任务:bash scripts/看板.sh"

echo ""
echo "  正在汇总任务:$NAME"
echo "  ────────────────────────────────────"

# --- 1) 工作区状态 ---
CHANGED=$("$GIT" -C "$WT" status --porcelain | wc -l | tr -d ' ')
COMMITS=$("$GIT" -C "$WT" rev-list --count main..HEAD 2>/dev/null || echo 0)
MODIFIED=$("$GIT" -C "$WT" status --porcelain | head -8)

# --- 2) 任务卡里的进度段 ---
PROGRESS=""
if [ -f "$TASK" ]; then
  # 从「当前状态」到下一个同级标题之间
  PROGRESS=$(awk '/^### 当前状态/{f=1} f&&/^## /&&!/当前状态/{f=0} f' "$TASK" 2>/dev/null)
fi

echo "  工作区  :$WT"
echo "  已提交  :$COMMITS 个提交(相对主干)"
echo "  未提交  :$CHANGED 个改动"
echo "  ────────────────────────────────────"
echo ""
echo "  ═════════════════════════════════════════════════"
echo ""
echo "  你的工作目录是:$WT"
echo ""
echo "  这是一个**接着做**的任务 —— 之前已经有会话开发了一部分。"
echo ""
echo "  ━━━ 第一步:先搞清楚做到哪了 ━━━"
echo ""
echo "  ① 读任务卡,重点看「当前状态 / 已经做完 / 接下来要做 / 踩过的坑」:"
echo "     $TASK"
echo ""
if [ -n "$PROGRESS" ]; then
  echo "  ② 任务卡里记录的进度是这样的:"
  echo "$PROGRESS" | sed 's/^/     /'
  echo ""
else
  echo "  ② ⚠️ 任务卡里的进度段是空的 —— 上一个会话可能没来得及填。"
  echo "     不要盲猜,先看下面的「已提交的改动」和 git 历史弄清状态,"
  echo "     确认后在任务卡里把进度补上。"
  echo ""
fi
if [ "$COMMITS" -gt 0 ]; then
  echo "  ③ 已经提交过的内容(每个提交都说明了当时做了什么):"
  "$GIT" -C "$WT" log --oneline main..HEAD 2>/dev/null | sed 's/^/     /'
  echo ""
  echo "     逐条看提交详情:git show <提交号>"
  echo ""
else
  echo "  ③ 还没有任何提交 —— 说明上一个会话一行都没提交。"
  echo ""
fi
if [ "$CHANGED" -gt 0 ]; then
  echo "  ④ ⚠️ 工作区里有**没提交**的改动(上一个会话可能改到一半就断了):"
  echo "$MODIFIED" | sed 's/^/     /'
  echo ""
  echo "     一定要先看这些文件,它们可能已经改了一半。"
  echo "     看完再决定接着做什么,不要直接覆盖。"
  echo ""
else
  echo "  ④ 工作区干净(没有改到一半的半成品)。"
  echo ""
fi

echo "  ━━━ 第二步:接着干 ━━━"
echo ""
echo "  继续按任务卡里的铁律开发:"
echo "  · 只改自己该改的文件,共享文件只允许**末尾追加**"
echo "  · 五个新文件里的功能先读 $WT/scripts/feature-template.js"
echo "  · 五条红线:不改 version / 不推送 / 不打标签 / 不改 update-manifest.json / 不写三份文档"
echo ""
echo "  ━━━ 第三步:边做边记进度(这是接续的关键)━━━"
echo ""
echo "  每完成一个步骤,立刻回到任务卡的「★★ 进度续写」那一段更新:"
echo "     $TASK"
echo ""
echo "  否则你下次换会话,又要从头摸索一遍。"
echo ""
echo "  ━━━ 做完之后 ━━━"
echo ""
echo "  中间态每轮跑快速语法检查:"
echo "     cd $WT"
echo "     python scripts/check-syntax.py --changed"
echo ""
echo "  口径定稿并完成真机冒烟后回收；回收脚本会自动跑 manifest、文案、"
echo "  性能与相关自测，不需要提前手跑整套。"
echo ""
echo "  ⚠️ 不要跑 make-update-manifest.py、不要碰 update-manifest.json"
echo "     —— 那是推送期在主干上统一生成的产物(红线第 4 条)。"
echo ""
echo "  然后提交,对用户说「任务已收尾,可以回收了」。"
echo ""
echo "  ═════════════════════════════════════════════════"