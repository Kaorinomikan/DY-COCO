#!/bin/bash
# ============================================================
# 并行开发 · 开一个独立工作树
#
# 用途:
#   给一个会话分配一份**物理独立**的代码副本(独立目录 + 独立分支),
#   多个会话同时改代码也不会互相覆盖。
#
# 用法:
#   bash scripts/wt-new.sh <名字> "这个会话要做的任务(一句话)"
#
#   例:
#     bash scripts/wt-new.sh back-to-top "中控台右下角加回到顶部圆形按钮"
#     bash scripts/wt-new.sh sku-search   "中控台款号/商品名搜索"
#
# 产出:
#   · 目录  <开发目录同级>/DY-COCO-wt/<名字>      <- 会话在这里干活
#   · 分支  task/<名字>                            <- 从 main 当前 HEAD 拉出
#   · 任务卡 <上面的目录>/TASK.md                   <- 写给该会话看,已 gitignore
#
# 约定(详见 docs/agents/并行开发.md):
#   · 分支只允许**追加**,不许改别人已提交的东西
#   · 攒批期间不打标签、不推送;推送只走 publish.sh,由主工作区统一做
#   · 完成后用 scripts/wt-list.sh 看板、scripts/wt-merge.sh 回收
#
# 为什么用 git worktree 而不是 git checkout 切分支:
#   切分支是**同一个目录换内容**,两个会话会互相把对方的改动切没了;
#   worktree 是**各自的目录各自的文件**,物理隔离,才能真正并行。
# ============================================================

set -e

# git 路径自动探测(2026-10-14 修,原因见 中文工具.sh)
GIT="$(ls -d C:/Users/79412/.workbuddy/binaries/PortableGit/versions/*/cmd/git.exe 2>/dev/null | sort -V | tail -1)"
[ -n "$GIT" ] || GIT="$(command -v git)"
REPO="C:/Develop project/DY-COCO"
WT_ROOT="C:/Develop project/DY-COCO-wt"

NAME="$1"
TASK="$2"

if [ -z "$NAME" ]; then
  echo "用法:bash scripts/wt-new.sh <名字> \"任务描述\""
  echo "  例:bash scripts/wt-new.sh back-to-top \"中控台右下角加回到顶部按钮\""
  exit 1
fi

# 名字会成为目录名与分支名。只挡真正会出问题的字符。
#
# 2026-10-11:原本这里只允许「字母/数字/连字符/下划线」,把中文全拒了,
# 因为用户明确说看不懂英文(原话「看英文我不会而且容易出错」)。
# 已实测确认 **中文名完全可用**:
#   · git worktree add 分支名 task/回到顶部 → 正常
#   · 目录 C:/.../DY-COCO-wt/回到顶部 → 正常读写
#   · git -C 在中文目录下 status/log → 正常
#   · 配套已设 core.quotepath=false,否则 git 输出会把中文转成八进制看不懂
# 所以现在放开中文,只挡路径与 git 的保留字符。
#
# 用 for 逐字符查,不用 case 的 glob —— 反斜杠这类字符在 case 里
# 转义极易写错(实测踩到:语法错误直接让整个脚本跑不起来)。
for ch in ' ' '/' '\' ':' '?' '*' '<' '>' '|' '~' '^' '%'; do
  case "$NAME" in
    *"$ch"*)
      echo "[拒绝] 名字里不能有这些字符:空格 / \\ : ? * < > | ~ ^ %"
      echo "       请用 2~8 个汉字,例如「回到顶部」「款号搜索」"
      echo "       当前为:$NAME"
      exit 1
      ;;
  esac
done

case "$NAME" in
  ""|.*)
    echo "[拒绝] 名字不能为空,也不能以点开头"
    exit 1
    ;;
  *..*)
    echo "[拒绝] 名字里不能有 .."
    exit 1
    ;;
esac

# git 保留名:做分支名会出问题
case "$NAME" in
  HEAD|main|master)
    echo "[拒绝] 「$NAME」是 git 保留名,换个名字"
    exit 1
    ;;
esac

WT_PATH="$WT_ROOT/$NAME"
BRANCH="task/$NAME"

cd "$REPO"

# 1) 主工作区有未提交改动 —— 只提示,不中止
#
# 2026-10-13 整改（用户要求排查「主干被占用导致开发受阻」）：
#   原先这里是**硬闸门**，理由是「怕把别人的半成品带进新分支的基线」。
#   **这个理由不成立**：`git worktree add -b <分支> <目录> main` 是从
#   **main 的提交对象**检出内容，主工作区里那些未提交的改动根本不会被带过去。
#   而它造成的实际后果是：只要任何一个会话在主工作区动过文件（改文档、调脚本、
#   甚至只是留下一个临时文件），**所有会话都开不了新任务** —— 主干被占用即全线停摆。
#   所以改成提示。真正要在意的只有一件事：别顺手把别人的改动提交掉。
if [ -n "$("$GIT" status --porcelain)" ]; then
  echo "[提示] 主工作区有未提交改动 —— 不影响本次开工作树："
  echo "       工作树的基线是 main 的提交($("$GIT" rev-parse --short main))，"
  echo "       下面这些改动不会被带进新分支："
  "$GIT" status --short | sed 's/^/         /'
  echo "       提醒:它们可能属于别的会话,不要顺手提交。"
  echo ""
fi

# 2) 分支不能已存在
if "$GIT" show-ref --verify --quiet "refs/heads/$BRANCH"; then
  echo "[中止] 分支 $BRANCH 已存在。"
  echo "       若那个任务已结束,先回收:bash scripts/wt-merge.sh $NAME"
  echo "       若只是目录被删了,先清掉登记:$GIT worktree prune"
  exit 1
fi

# 3) 目录不能已存在
if [ -e "$WT_PATH" ]; then
  echo "[中止] 目录已存在:$WT_PATH"
  exit 1
fi

mkdir -p "$WT_ROOT"

# 4) 让 TASK.md 不被 git 看见
#    它写在工作树目录内(方便该会话读),但它是任务卡不是交付物,
#    若不忽略,该会话的 git status 会一直多一个未跟踪文件,
#    回收闸门「工作树内必须全部提交」会因此误判。
#    用 .git/info/exclude(本地忽略,不入库,所有工作树共享),不动 .gitignore。
EXCLUDE_FILE=$("$GIT" rev-parse --git-path info/exclude)
if [ -f "$EXCLUDE_FILE" ] && ! grep -qx 'TASK.md' "$EXCLUDE_FILE" 2>/dev/null; then
  printf '\n# 并行开发任务卡(scripts/wt-new.sh 生成)\nTASK.md\n' >> "$EXCLUDE_FILE"
  echo "[准备] 已将 TASK.md 加入本地忽略:$EXCLUDE_FILE"
fi

# 5) 拉工作树 + 分支(基线 = main 当前 HEAD)
echo "[1/3] 创建独立工作树 ..."
"$GIT" worktree add -b "$BRANCH" "$WT_PATH" main >/dev/null
echo "      目录:$WT_PATH"
echo "      分支:$BRANCH (基线 main@$("$GIT" rev-parse --short main))"

echo "[2/3] 写任务卡 TASK.md ..."
cat > "$WT_PATH/TASK.md" <<EOF
# 任务卡 · $NAME

**分配时间**:$(date '+%Y-%m-%d %H:%M')
**分支**:\`$BRANCH\`
**工作目录**:\`$WT_PATH\`

## 任务

${TASK:-（未填写 —— 请向用户确认后再动手）}

## 开工前必读

1. \`AGENTS.md\` 的「多会话并行开发」一章 —— **文件归属边界**与**共享文件的追加式规则**,
   越界的改动会在回收时被拒。
2. \`AGENTS.md\` 的「二、个性化要求」—— 用户定的硬性规矩(尤其是新功能自带开关)。
3. \`开发待办.md\`(未开发计划都在这里)与 \`开发日志.md\`(历史档案)。

## 本会话的铁律

- **只改自己该改的文件**,共享文件只允许**追加**(见 docs/agents/并行开发.md)。
- **不打标签、不推送、不改 \`manifest.json\` 的 version、不查在线版**。
  推送是主工作区的活,只走 \`publish.sh\`。
- **不生成、不提交 \`update-manifest.json\`**(2026-10-11 改制:它是推送期产物,
  版本号不变就不会被自更新链路用到;推送期会整体重生成,
  开发期做的都是白做,且两个并行分支必冲突)。
- 收工前自查:改动范围内语法通过 + \`python scripts/check-manifest-order.py\` 通过
  (动过 \`manifest.json\` 的 js 数组时才需要)。
  ⚠️ 清单 \`update-manifest.json\` **不要改、不要生成** —— 它是推送期产物
  (2026-10-11 改制后由推送方在 main 上统一重生成),开发期生成的都是白做,
  两个并行分支各自生成还必然全文件冲突。
- 收工后**不需要**自己同步桌面 COCO TEST —— 回收时脚本会自动对齐并逐文件校验。
  桌面测试档代表的永远是「**主干(main)的扩展本体**」,不是未回收的中间分支。
- 收工 = \`git commit\` 到本分支(提交信息写清「做了什么/为什么/怎么验的」),
  然后告诉用户「可以回收了」。

## ★★ 进度续写(重要,中途换会话全靠它)

**会话是会断的** —— 你这次说的话、下一步打算做什么,换个会话就全没了。
所以**每做完一个步骤,立刻回来改这一段**,别攒到最后。

下面这一段每次收工前(或换会话前)都要更新。下一个会话靠它接上。

### 当前状态
(还没开工就写:「未开工」)

### 已经做完
- (每完成一个功能点写一条,一句话说清做了什么)

### 接下来要做
- (明确到「打开哪个文件、改哪一段」这种粒度,别只写「继续开发」)

### 踩过的坑(留给下一个会话)
- (试过但行不通的写法,写下来避免它重走一遍)

### 需要问用户的问题
- (拿不准的地方,列出来;下一个会话可以直接问)

## 交付判定

用户在主工程目录跑 \`bash scripts/看板.sh\` 看进度、
\`bash scripts/回收.sh $NAME\` 做回收预检。
EOF
echo "      $WT_PATH/TASK.md (已加入本地忽略,不会出现在 git status)"

# 6) 自检
echo "[3/3] 自检 ..."
BRANCHES=$("$GIT" worktree list | wc -l)
echo "      当前工作树数量:$BRANCHES"
echo ""
echo "完成。把下面这段给新会话:"
echo "------------------------------------------------------------"
echo "你的工作目录是 $WT_PATH"
echo "先读 $WT_PATH/TASK.md,按里面的任务与铁律开发。"
echo "只在本目录内操作,不要碰 $REPO。"
echo "------------------------------------------------------------"