#!/bin/bash
# ============================================================
# 计点器 —— 「攒批推送门槛」的唯一事实来源
# ============================================================
# 用法:
#   bash scripts/计点.sh            人读明细(功能点 / 基建点 / 不计点 + 门槛判定)
#   bash scripts/计点.sh --board    只输出看板「待推送」栏的正文行
#   bash scripts/计点.sh --count    只输出合计点数(给脚本用)
#   bash scripts/计点.sh --gate     达门槛退 0、未达退 1(明细照常打印)
#
# 为什么单独抽一个脚本:
#   门槛数字与计点规则原先散在 看板.sh / publish.sh / 文档 / README.md
#   四处,已经漂移过(看板写 5、文档写 10),还误导过一次判断。
#   现在数字与规则**只在这里定义一次**,别处一律调用本脚本,不许再写死。
#
# 计点规则(用户 2026-10-13 定稿,详见 docs/agents/用户要求.md 第 1 条):
#   ① **功能点**:扩展本体(manifest.json / icons / src / update-manifest.json /
#      install)里**用户可感知的独立特性或修复** —— 新增功能、可观察的行为改进、
#      用户能遇上的 bug 修复。逐项计,**不设上限**。
#   ② **基建点**:文档 / 脚本 / 流程 / 定时任务等**非扩展本体**的改动,
#      无论多少条**合并只算 1 点**(上限 1)。用户 2026-10-13 修订原话:
#      「只动脚本 / 文档 / 定时任务这类更新也要记录 …… 也要记点,但是上限为 1,
#        我担心我没有推送以为没有更新,因为你没记点,所以我不知道本地有修改」。
#      目的:让「本地有改动但没推送」这件事在看板上永远看得见。
#   ③ **不计点**:条目里明确写了 `[不计点]` 的才算(逃生舱,仅用于确实无意义的
#      改动,如临时文件、纯格式微调 —— 必须在条目里注明理由)。
#   ④ **同一处反复修改只算 1 点** —— 同一个文件同一个功能/问题,一修、二修、
#      三修,无论几轮都只算 1 个功能点(用户原话:「重复修改只算一次」)。
#      【2026-10-20 用户强化,最高优先级】★ **同一个「未上线」的功能点,在本地
#      多次修改 / 迭代,计点上限恒为 1** —— 用户原话:「同一个没有上线的新功能点,
#      在本地多次修改和迭代,记点上限最高是一次,防止刷功能点计数,这样没什么意义」。
#      即:只要还没随批次推送上线,攒批期间无论迭代几轮(加提示 → 提速 → 口径定稿 …)
#      都**合并为 1 条 `###` 条目**,不得拆成多条累加;
#      **已上线后的重做 / 改版同样按本条合并计 1 点**(不因跨版本而重新计点)。
#      判据:归属「同一处」(同一功能 / 同一控件 / 同一问题)= 1 点。
#
#   合计 = 功能点 + 基建点,与门槛(默认 5)比较。
#
# 写法:在 开发待办.md 的「待推送」章节里,**一条 = 一个 `### ` 标题行**。
#   功能点:    ### 修复:悬浮搜索按钮悬停半透明
#   基建点:    ### [文档] 更新交接文档
#   不计点:    ### [不计点] 临时文件清理(理由:…)
#   标记 [文档] / [流程] / [基建] / [脚本] 出现任一 → 归入基建点(合计 1 点);
#   `### ` 标题下面的 `- ` 行是子项说明,不单独计数。
# ============================================================

HERE="$(dirname "$0")"
REPO="$(cd "$HERE/.." && pwd)"
TODO_FILE="$REPO/开发待办.md"

# ↓↓↓ 唯一事实来源:改门槛只改这一行 ↓↓↓
PUSH_GATE=5

# 基建点上限(文档/脚本/流程/定时任务类改动,无论多少条最多计这么多点)
INFRA_CAP=1

MODE="${1:---detail}"

if [ ! -f "$TODO_FILE" ]; then
  echo "[计点] 找不到 $TODO_FILE —— 待推送清单不存在,无法计点。" >&2
  exit 2
fi

# 抽出「待推送」章节里的 `### ` 条目,按 Y(功能点)/B(基建点)/N(不计点) 打标。
#   N 优先判(明确不计点),其次 B(文档/脚本/流程/基建标记),其余 Y。
ITEMS=$(awk '
  { sub(/\r$/, "") }
  /^## /  { insec = (index($0, "待推送") > 0) }
  insec && /^### / {
    s = substr($0, 5)
    if (index(s, "[不计点]") > 0) {
      printf "N\t%s\n", s
    } else if (index(s, "[文档]") + index(s, "[流程]") + index(s, "[基建]") + index(s, "[脚本]") > 0) {
      printf "B\t%s\n", s
    } else {
      printf "Y\t%s\n", s
    }
  }
' "$TODO_FILE")

CNT=$(printf '%s\n' "$ITEMS" | grep -c '^Y' || true)          # 功能点
INFRA_CNT=$(printf '%s\n' "$ITEMS" | grep -c '^B' || true)    # 基建条目数
SKIP_CNT=$(printf '%s\n' "$ITEMS" | grep -c '^N' || true)     # 明确不计点条目数

# 基建点:有任意一条基建条目就计 1 点,上限 INFRA_CAP(不按条数累加)。
BASE_PT=0
if [ "$INFRA_CNT" -gt 0 ]; then
  BASE_PT=$INFRA_CAP
fi

TOTAL=$((CNT + BASE_PT))

# 疑似「同一处反复修」提示:把功能点条目去掉空白后的前 9 个字当键,重复即提醒。
# 只作提醒,不自动改数字 —— 最终合并由人(助手)判断。
DUP_HINT=$(printf '%s\n' "$ITEMS" | awk -F'\t' '
  $1 == "Y" {
    k = $2
    gsub(/[ \t]/, "", k)
    key = substr(k, 1, 9)
    if (seen[key]++) print "    ⚠ 疑似同一处:「" $2 "」与前面一条开头相同 —— 同处反复修只算 1 点,请合并成一条"
  }')

case "$MODE" in
  --count)
    printf '%s\n' "$TOTAL"
    exit 0
    ;;
  --board)
    if [ "$CNT" -gt 0 ]; then
      printf '%s\n' "$ITEMS" | awk -F'\t' '$1=="Y"{ n++; printf "  %d. %s\n", n, $2 }'
    else
      echo "  (无功能点)"
    fi
    if [ -n "$DUP_HINT" ]; then
      printf '%s\n' "$DUP_HINT"
    fi
    if [ "$BASE_PT" -gt 0 ]; then
      echo "  基建点 $BASE_PT/$INFRA_CAP —— 另有 $INFRA_CNT 项非扩展本体改动(合并计点):"
      printf '%s\n' "$ITEMS" | awk -F'\t' '$1=="B"{ printf "    · %s\n", $2 }'
    fi
    if [ "$SKIP_CNT" -gt 0 ]; then
      echo "  明确不计点($SKIP_CNT 项):"
      printf '%s\n' "$ITEMS" | awk -F'\t' '$1=="N"{ printf "    · %s\n", $2 }'
    fi
    if [ "$TOTAL" -ge "$PUSH_GATE" ]; then
      echo "  ★ 合计 $TOTAL 点(功能点 $CNT + 基建点 $BASE_PT),已达推送门槛($PUSH_GATE 点) —— 推送须用户下令"
    else
      echo "  合计 $TOTAL/$PUSH_GATE(功能点 $CNT + 基建点 $BASE_PT,还差 $((PUSH_GATE - TOTAL)) 点;攒批提示,推送须用户下令)"
    fi
    exit 0
    ;;
esac

# ---------- 人读明细(默认 / --gate)----------
echo "攒批门槛:功能点 $CNT + 基建点 $BASE_PT = 合计 $TOTAL / $PUSH_GATE"
echo ""
if [ "$CNT" -gt 0 ]; then
  echo "功能点($CNT 个,扩展本体里用户可感知的独立特性/修复):"
  printf '%s\n' "$ITEMS" | awk -F'\t' '$1=="Y"{ n++; printf "  %d. %s\n", n, $2 }'
else
  echo "功能点(0 个):"
  echo "  (无)"
fi
if [ -n "$DUP_HINT" ]; then
  printf '%s\n' "$DUP_HINT"
fi
echo ""
if [ "$BASE_PT" -gt 0 ]; then
  echo "基建点($BASE_PT 个,非扩展本体改动 —— 文档/脚本/流程/定时任务,"
  echo "        无论多少条都只算 1 点):"
  printf '%s\n' "$ITEMS" | awk -F'\t' '$1=="B"{ printf "  · %s\n", $2 }'
  echo ""
fi
if [ "$SKIP_CNT" -gt 0 ]; then
  echo "明确不计点($SKIP_CNT 个,条目里写了 [不计点]):"
  printf '%s\n' "$ITEMS" | awk -F'\t' '$1=="N"{ printf "  · %s\n", $2 }'
  echo ""
fi
echo "规则:扩展本体里的独立特性/修复 = 功能点(逐项计);"
echo "      文档/脚本/流程/定时任务类改动 = 基建点(合并最多 1 点);"
echo "      同一处反复修只算 1 点;合计 = 功能点 + 基建点。"
echo ""

if [ "$MODE" = "--gate" ] || [ "$MODE" = "--detail" ]; then
  if [ "$TOTAL" -ge "$PUSH_GATE" ]; then
    echo "结论:已达门槛(合计 $TOTAL >= $PUSH_GATE) —— 自审通过后等用户下令推送。"
    exit 0
  else
    echo "结论:未达门槛(合计 $TOTAL < $PUSH_GATE),继续攒 —— 还差 $((PUSH_GATE - TOTAL)) 点。"
    exit 1
  fi
fi

echo "[计点] 未知参数:$MODE(可用 --board / --count / --gate)"
exit 2
