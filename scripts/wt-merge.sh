#!/bin/bash
# ============================================================
# 并行开发 · 回收合并(默认只预检,不动任何东西)
#
# 用法:
#   bash scripts/wt-merge.sh <名字>                # 预检:能不能合、会不会冲突
#   bash scripts/wt-merge.sh <名字> --go            # 真合并到 main(仍然不推送)
#   bash scripts/wt-merge.sh <名字> --go --cleanup  # 合并后删掉工作树与分支
#   ... --no-selftest                              # 仅明确知道理由时跳过相关自测
#
# 改过 src/** 或 manifest.json 的任务：真机冒烟**不拦合并**（2026-11-08 口径，
# 见 AGENTS 铁律 1）。合并后代码随 COCO TEST 同步到桌面测试档，真机验证在那里做，
# 验过才允许推送。已验过可加声明：
#   DYC_SMOKE_OK=1 bash scripts/回收.sh <名字>
#
# 若本任务「真回退」了 main 上的内容（删掉 main 的代码，而不是落后于 main），
# --go 合并时必须显式声明这是有意删除：
#   DYC_REVERT_OK=1 bash scripts/回收.sh <名字>
#
# 它与 publish.sh 的分工:
#   · 本脚本只把任务分支**合并进本地 main**;
#   · **绝不推送、绝不打标签、绝不改版本号** —— 那些是 publish.sh 的活,
#     由用户决定什么时候发。合并只是「归总」,不是「发布」。
# ============================================================

# 本脚本所在目录 —— 必须在任何 cd 之前固定成绝对路径。
# 理由：流程中段会 cd 到主仓库，之后 $0 仍是相对的 'scripts/wt-merge.sh'，
# 再由它推目录就会指到主仓库的 scripts/（那里可能还没有本次新增的脚本）。
# 2026-11-07 实测踩到：真回退体检因此找不到 check-revert.sh 而静默跳过。
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# git 路径自动探测(2026-10-14 修,原因见 中文工具.sh)
GIT="$(ls -d C:/Users/79412/.workbuddy/binaries/PortableGit/versions/*/cmd/git.exe 2>/dev/null | sort -V | tail -1)"
[ -n "$GIT" ] || GIT="$(command -v git)"
NODE_BIN="C:/Users/79412/.workbuddy/binaries/node/versions/22.22.2-6/node.exe"
REPO="C:/Develop project/DY-COCO"
WT_ROOT="C:/Develop project/DY-COCO-wt"
# 2026-10-13 用户定:桌面**只保留一个**测试档 COCO TEST,旧档「DY-COCO-调试」取消生成。
# (原第 18 条已删除,口径并入第 19 条 —— 见本文件末尾的 sync_to_coco_test)

NAME="$1"
GO=""
CLEANUP=""
SELFTEST=""
for a in "$@"; do
  [ "$a" = "--go" ] && GO=1
  [ "$a" = "--cleanup" ] && CLEANUP=1
  [ "$a" = "--no-selftest" ] && SELFTEST=0
done

if [ -z "$NAME" ]; then
  echo "用法:bash scripts/wt-merge.sh <名字> [--go] [--cleanup]"
  echo "先用 bash scripts/wt-list.sh 看有哪些任务。"
  exit 1
fi

BRANCH="task/$NAME"
WT_PATH="$WT_ROOT/$NAME"

cd "$REPO"

# ---------- 同步到桌面唯一测试档 COCO TEST ----------
# 统一走 scripts/sync-coco-test.sh —— 那边复制完还会**逐文件 sha256 自证**一致，
# 失败会退非 0；这里不再自己复制一份（两处实现必然漂移）。
# 2026-10-13 用户定：桌面只保留 COCO TEST 一个测试档，
#   旧的「DY-COCO-调试」取消生成；同步失败必须显式报出，不许静默。
sync_to_coco_test() {
  echo ""
  echo "── 同步到 COCO TEST（桌面唯一测试档）──"
  if bash "$REPO/scripts/sync-coco-test.sh"; then
    echo "  ✓ 桌面测试档已与主干逐文件校验一致"
  else
    echo ""
    echo "  [!] ⛔ 同步 COCO TEST 失败（原因见上）。合并本身已完成，"
    echo "      但用户手上的测试档可能与主干不一致 —— 必须手动重跑："
    echo "      bash scripts/sync-coco-test.sh"
    return 2
  fi
}

# 退出码 2：已合并但同步失败；3：已合并但工作树或分支清理失败。
cleanup_task() {
  local failed=0
  echo "清理工作树与分支 ..."
  if [ -d "$WT_PATH" ]; then
    if "$GIT" worktree remove --force "$WT_PATH"; then
      echo "  工作树已删:$WT_PATH"
    else
      echo "  [中止] 工作树清理失败:$WT_PATH"
      failed=1
    fi
  fi
  if "$GIT" branch -d "$BRANCH"; then
    echo "  分支已删:$BRANCH"
  else
    echo "  [中止] 分支清理失败:$BRANCH"
    failed=1
  fi
  "$GIT" worktree prune || failed=1
  [ "$failed" = "0" ] || return 3
}

# ---------- 闸门 ----------
echo "============================================================"
echo " 回收预检 · $NAME"
echo "============================================================"
echo ""

FAIL=0

# 1) 分支存在
if ! "$GIT" show-ref --verify --quiet "refs/heads/$BRANCH"; then
  echo "[✗] 分支不存在:$BRANCH"
  exit 1
fi
echo "[✓] 分支存在:$BRANCH"

# 本分支相对分叉点真正改了哪些文件。共享文件判定、烟测范围和后续各闸都用这一份，
# 避免再写 `diff main $BRANCH`（分支落后 main 时方向会反）。
MERGE_BASE=$("$GIT" merge-base main "$BRANCH" 2>/dev/null)
if [ -n "$MERGE_BASE" ]; then
  TASK_FILES=$("$GIT" diff --name-only "$MERGE_BASE" "$BRANCH" 2>/dev/null)
else
  TASK_FILES=$("$GIT" diff --name-only main "$BRANCH" 2>/dev/null)
fi

# 2) 该分支目录内无未提交改动(否则会把半成品丢掉)
if [ -d "$WT_PATH" ]; then
  N=$("$GIT" -C "$WT_PATH" status --porcelain | wc -l | tr -d ' ')
  if [ "$N" -gt 0 ]; then
    echo "[✗] 工作树内还有 $N 个未提交改动 —— 让那个会话先 commit 再回收:"
    "$GIT" -C "$WT_PATH" status --short | sed 's/^/      /'
    FAIL=1
  else
    echo "[✓] 工作树内已全部提交"
  fi
else
  echo "[!] 工作树目录不存在(可能已被删),仅按分支继续"
fi

# 3) 主工作区 ── 只在「未提交改动与本次合并涉及的文件有重叠」时才拦
#
# 2026-10-13 整改（用户要求排查「主干被占用导致开发受阻」）：
#   原逻辑是「主工作区只要脏就拦」。后果很实际 —— 别的会话在主工作区
#   改了文档 / 调了脚本（哪怕只是留下一个临时文件），本会话的回收就被
#   堵死，而且没有干净的时候，形成死锁。
#   而 git merge 真正怕的只有一件事：**未提交改动的文件正好也是本次要
#   合并的文件**，那时会报 "Your local changes would be overwritten"。
#   其余情况合并没有任何风险。所以这里改成精确的「文件重叠」判断。
DIRTY_LIST=$("$GIT" status --porcelain | awk '{print $NF}')
if [ -n "$DIRTY_LIST" ]; then
  # ⚠️ 2026-10-27 修:原写法 `diff main $BRANCH` 在**分支落后 main**时方向是反的
  #   —— 它会列出「main 有、分支没有」的文件(即别的会话已提交的),于是只改了
  #   3 个文件的任务,会被判成「和 auto-refresh.js 重叠」而永远回收不了。
  #   正确判据 = 「本分支相对分叉点改了什么」;取不到分叉点才退回旧写法。
  MERGE_BASE=$("$GIT" merge-base main "$BRANCH" 2>/dev/null)
  if [ -n "$MERGE_BASE" ]; then
    MERGE_LIST=$("$GIT" diff --name-only "$MERGE_BASE" "$BRANCH" 2>/dev/null)
  else
    MERGE_LIST=$("$GIT" diff --name-only main "$BRANCH" 2>/dev/null)
  fi
  OVERLAP=$(comm -12 <(printf '%s\n' "$DIRTY_LIST" | LC_ALL=C sort -u) \
                     <(printf '%s\n' "$MERGE_LIST" | LC_ALL=C sort -u) | tr '\n' ' ')
  if [ -n "$OVERLAP" ]; then
    echo "[✗] 主工作区有未提交改动,且与本次合并涉及的文件重叠 —— 先处理这些:"
    printf '%s\n' "$OVERLAP" | tr ' ' '\n' | grep -v '^$' | sed 's/^/      /'
    echo "      (不处理会报「本地改动将被覆盖」。注意:这些是**主工作区**的改动,"
    echo "       不属于 $BRANCH,回收也不会把它们带进主干。)"
    FAIL=1
  else
    echo "[!] 主工作区有未提交改动,但与本任务改动无重叠 —— 不阻塞回收:"
    "$GIT" status --short | sed 's/^/      /'
    echo "      提醒:这些改动不在 $BRANCH 上,本次回收**不会**带上它们。"
  fi
else
  echo "[✓] 主工作区干净"
fi

# 4) 分支没有偷改版本号 / 偷打标签
VER_MAIN=$("$GIT" show main:manifest.json | grep '"version":' | head -1)
VER_BRANCH=$("$GIT" show "$BRANCH:manifest.json" | grep '"version":' | head -1)
if [ "$VER_MAIN" != "$VER_BRANCH" ]; then
  echo "[✗] 任务分支改了版本号 —— 版本号只在推送期由 main 统一改:"
  echo "      main   :$VER_MAIN"
  echo "      $BRANCH:$VER_BRANCH"
  FAIL=1
else
  echo "[✓] 未改版本号($VER_MAIN)"
fi

TAGS_ON_BRANCH=$("$GIT" tag --points-at "$BRANCH" | wc -l | tr -d ' ')
if [ "$TAGS_ON_BRANCH" -gt 0 ]; then
  echo "[✗] 任务分支上挂了标签(并行开发期不允许打标签):"
  "$GIT" tag --points-at "$BRANCH" | sed 's/^/      /'
  FAIL=1
else
  echo "[✓] 未打标签"
fi

# 5) 改了哪些文件 + 冲突预判
echo ""
echo "── 本任务改动 ──────────────────────────────"
"$GIT" diff --stat "main...$BRANCH" | sed 's/^/   /'
echo ""
echo "── 涉及文件(★ = 共享文件,回收时重点核对是否只做追加)──"
"$GIT" diff --name-only "main...$BRANCH" | while read -r f; do
  case "$f" in
    src/content/flags.js|manifest.json|src/popup/popup.js|src/popup/popup.html|src/live/tool-slots.js)
      echo "   ★ $f"
      ;;
    *)
      echo "     $f"
      ;;
  esac
done
echo ""

# ---------- 冲突自动解(仅限「共享数组文件」这一种可安全自动的情况) ----------
#
# 背景:两个任务都往 src/content/flags.js 的 DYC_FLAGS_META 里加一项时,
# git 必然报冲突(双方在同一锚点前插入)。实测两条捷径都是坑:
#   ✗ --union:会把两个对象字段揉成一个,语法合法但 backToTop 丢字段 → 静默损坏
#   ✗ 拼冲突块:冲突块里只有对象前半段,拼不出完整对象
# 所以走 scripts/resolve-array-merge.py 的三方语义合并:
# 每个元素都是**从原文件整段抠出来的**,不可能丢字段。
#
# 数组名对照表 —— 只对这张表里的文件自动解,其余一律交人工。
AUTO_ARR="src/content/flags.js:DYC_FLAGS_META"
PY="C:/Users/79412/.workbuddy/binaries/python/versions/3.13.12/python.exe"

resolve_conflicts() {
  local branch="$1"
  RESOLVED_FILES=""

  # update-manifest.json:2026-10-11 改制后开发期一律不生成不提交(推送期产物)。
  # 若旧任务分支仍带了它引发冲突,直接取 main 版(ours)——
  # 推送期改完版本号会整体重生成,分支上的清单没有任何价值。
  if grep -q "^<<<<<<< " "$REPO/update-manifest.json" 2>/dev/null; then
    echo ""
    echo "── 自动解冲突:update-manifest.json(取 main 版,推送期统一重生成)──"
    "$GIT" checkout --ours -- update-manifest.json
    "$GIT" add update-manifest.json
    RESOLVED_FILES="$RESOLVED_FILES update-manifest.json"
  fi

  for pair in $AUTO_ARR; do
    local f="${pair%%:*}" arr="${pair##*:}"
    # 该文件在这次合并里是否处于冲突态?
    grep -q "^<<<<<<< " "$REPO/$f" 2>/dev/null || continue

    echo ""
    echo "── 自动解冲突:$f(数组 $arr)──"
    local base
    base=$("$GIT" rev-parse HEAD^1 2>/dev/null)   # 合并态下 HEAD 就是 ours
    [ -z "$base" ] && base=$("$GIT" merge-base main "$branch")
    # 临时文件一律落进 .tmp/（.gitignore 已忽略）并带任务名 ——
    # 2026-10-13 整改:原先写 .tmp-automerge 在主工作区根下,不被忽略;
    # 一旦脚本被中断就会残留在那里,让主工作区**永久**判定为脏,
    # 从此所有会话既开不了任务也回收不了(死锁)。同理适用于并发会话互踩。
    local tmp="$REPO/.tmp/automerge-$NAME"
    mkdir -p "$REPO/.tmp"
    rm -rf "$tmp"; mkdir -p "$tmp"
    "$GIT" show "$base:$f"    > "$tmp/base"
    "$GIT" show "HEAD:$f"     > "$tmp/ours"
    "$GIT" show "$branch:$f"  > "$tmp/theirs"

    if ! "$PY" "$REPO/scripts/resolve-array-merge.py" \
          "$tmp/base" "$tmp/ours" "$tmp/theirs" "$tmp/result" "$arr"; then
      echo "  [✗] 无法自动解 —— 需人工处理"
      rm -rf "$tmp"
      return 1
    fi

    # 语法自检:解出来的东西必须能过 node --check
    if ! "$NODE_BIN" --check "$tmp/result" >/dev/null 2>&1; then
      echo "  [✗] 自动解的结果语法不合法,已丢弃 —— 需人工处理"
      rm -rf "$tmp"
      return 1
    fi
    echo "  [✓] 自动解完成,语法自检通过"

    cp "$tmp/result" "$REPO/$f"
    "$GIT" add "$f"
    RESOLVED_FILES="$RESOLVED_FILES $f"
    rm -rf "$tmp"
  done

  # 还剩有冲突标记的文件吗?有就说明没解干净
  local left=""
  for f in $RESOLVED_FILES; do
    grep -q "^<<<<<<< " "$REPO/$f" 2>/dev/null && left="$left $f"
  done
  [ -n "$left" ] && return 1

  [ -n "$RESOLVED_FILES" ]
}

# 冲突预判:merge-tree 成功=可干净合并,失败=有冲突
CONFLICT_OUT=$("$GIT" merge-tree --write-tree main "$BRANCH" 2>&1)
MT_RC=$?
if [ $MT_RC -ne 0 ]; then
  echo "[!] 与 main 有冲突(共享文件同位置插入,预期内)"
  printf '%s\n' "$CONFLICT_OUT" | grep -v '^[0-9a-f]' | sed 's/^/      /' | head -10
  echo ""
  echo "  回收时会用 scripts/resolve-array-merge.py 自动解"
  echo "  (仅限 src/content/flags.js 这类共享数组文件;解完自动过语法自检;"
  echo "   update-manifest.json 冲突直接取 main 版,推送期统一重生成)。"
  echo "  现在是预检模式,不做任何改动。"
else
  echo "[✓] 与 main 可干净合并(无冲突)"
fi

echo ""

# 5.5) 真机冒烟声明（软信号，**不拦合并**）
#
# 2026-11-08 改口径：冒烟从「合并硬前提」降为「推送硬前提」。
# 原因：未合并的分支进不了桌面测试档，而 DYC_SMOKE_OK 又只能由真机签 ——
# 两条规则叠起来就是「合并不了 → 验不了 → 更合并不了」，每个任务都卡在等人说「合并」。
# 现在的分工：脚本闸门全过即自动合并（含 src 改动），合并脚本会把代码同步进
# COCO TEST，真机验证在那里做；**没验过不许推送**（AGENTS 铁律 1）。
NEEDS_SMOKE=0
printf '%s\n' "$TASK_FILES" | grep -Eq '^(src/|manifest\.json$)' && NEEDS_SMOKE=1
if [ "$NEEDS_SMOKE" = "1" ]; then
  if [ "${DYC_SMOKE_OK:-0}" = "1" ]; then
    echo "[✓] 已声明本次完成真机冒烟"
  else
    echo "[!] 本任务改过扩展运行内容，未带真机冒烟声明（按 2026-11-08 口径不拦合并）。"
    echo "     合并后代码会随 COCO TEST 同步到桌面测试档；真机验证在测试档做，"
    echo "     验过才允许推送。已验过的话下次可加 DYC_SMOKE_OK=1 记为已验。"
  fi
else
  echo "[✓] 纯脚本/文档任务，无需真机冒烟声明"
fi

echo ""

# 5.6) 真回退体检（2026-11-07）
#
# 为什么需要：任务落后 main 之后，`git diff main..branch` 会把「main 有、分支
# 没跟上」显示成一大片删除，看起来像有人把主干改动退回去了。2026-11-07 我就
# 据此误判过一次（实际零冲突）。真回退与「只是落后」的区别只有一处，判据落在
# scripts/check-revert.sh：删了行、且该文件在共同祖先之后 main 侧**没动过**，
# 才是真删；main 动过的，分支只是没跟上，正常合并会自动补回来。
#
# 与 5.5 冒烟同属「脚本判断不了意图、但判错就要命」的闸门 —— 只要求显式声明，
# 不替人做决定。
REVERT_SH="$SCRIPT_DIR/check-revert.sh"
if [ -f "$REVERT_SH" ]; then
  REVERT_LIST=$( cd "$REPO" && DYC_GIT="$GIT" bash "$REVERT_SH" "$BRANCH" main 2>/dev/null )
  REVERT_RC=$?
  if [ "$REVERT_RC" = "1" ] && [ -n "$REVERT_LIST" ]; then
    if [ "${DYC_REVERT_OK:-0}" = "1" ]; then
      echo "[✓] 有真回退，已声明本次为有意删除："
      printf '%s\n' "$REVERT_LIST" | while IFS=$'\t' read -r n f; do echo "      $f  净删 $n 行"; done
    elif [ -n "$GO" ]; then
      echo "[✗] 本任务删掉了 main 上的内容（不是落后，是真删）："
      printf '%s\n' "$REVERT_LIST" | while IFS=$'\t' read -r n f; do echo "      $f  净删 $n 行"; done
      echo "     确认这些删除是有意的之后，执行："
      echo "       DYC_REVERT_OK=1 bash scripts/回收.sh $NAME"
      exit 1
    else
      echo "[!] 发现真回退（预检不拦；--go 合并时必须带 DYC_REVERT_OK=1）："
      printf '%s\n' "$REVERT_LIST" | while IFS=$'\t' read -r n f; do echo "      $f  净删 $n 行"; done
    fi
  else
    echo "[✓] 没有真回退（相对 main 无删除，或删除的都只是落后于 main）"
  fi
else
  echo "[!] 找不到 scripts/check-revert.sh，跳过真回退体检"
fi


# 6) 代码自检(2026-10-11 用户定:自检必须在合并**之前**)——
#    快速入口与中间态共用 scripts/check-syntax.py，避免两套实现漂移。
if [ -d "$WT_PATH" ] && [ -f "$WT_PATH/scripts/check-syntax.py" ]; then
  if ( cd "$WT_PATH" && "$PY" scripts/check-syntax.py --changed ); then
    :
  else
    echo "[✗] 语法自检未通过（修复并提交后重跑）"
    FAIL=1
  fi
else
  echo "[✗] 任务工作树缺失或找不到 scripts/check-syntax.py，无法执行语法自检"
  FAIL=1
fi

echo ""

# 6.2) manifest 顺序闸（只在本任务动过 manifest.json 时跑）
if printf '%s\n' "$TASK_FILES" | grep -qx 'manifest.json'; then
  echo "── manifest 脚本顺序检查 ──"
  if ( cd "$WT_PATH" && "$PY" scripts/check-manifest-order.py ); then
    echo "[✓] manifest 顺序通过"
  else
    echo "[✗] manifest 顺序未通过"
    FAIL=1
  fi
  echo ""
fi

# 6.3) 产品文案闸（只在本任务动过开关文案时跑；发布期仍会再查更新说明）
if printf '%s\n' "$TASK_FILES" | grep -qx 'src/content/flags.js'; then
  echo "── 产品文案检查（相对本任务分叉点）──"
  if ( cd "$WT_PATH" && DYC_GIT="$GIT" "$NODE_BIN" scripts/check-product-copy.js --gate --base "$MERGE_BASE" ); then
    echo "[✓] 产品文案新增违规为 0"
  else
    echo "[✗] 产品文案检查未通过"
    FAIL=1
  fi
  echo ""
fi

# 6.4) 性能闸（静态秒级；先于行为自测，便宜的先失败）
# 成功时只显示结论，避免每次回收被几十条既有【提示】淹没；失败才展开全文。
echo "── 性能常规检查 ──"
mkdir -p "$REPO/.tmp"
PERF_LOG="$REPO/.tmp/perf-$NAME.log"
if ( cd "$WT_PATH" && "$PY" scripts/perf-check.py --gate > "$PERF_LOG" 2>&1 ); then
  grep -E '^结论:' "$PERF_LOG" | sed 's/^/   /'
  echo "[✓] 性能闸通过"
else
  sed 's/^/   /' "$PERF_LOG"
  echo "[✗] 性能闸未通过"
  FAIL=1
fi
rm -f "$PERF_LOG"
echo ""

# 6.45) 脆弱断言体检（只在本任务改过自测时提示，不阻断）
if printf '%s\n' "$TASK_FILES" | grep -q '^scripts/自测-'; then
  echo "── 自测断言写法体检（提示，不阻断）──"
  ( cd "$WT_PATH" && "$PY" scripts/selfcheck-assertions.py --changed ) || true
  echo ""
fi

# 6.5) 合并**前**跑「与本任务改动相关」的自测（2026-11-02 新增）
# ★ 只在口径定稿后的回收预检跑，不再要求每轮手跑：
#   中间态口径未稳，红的多是断言没跟上；定稿后一次验证最终内容。
#   必须在**任务工作树**里跑 —— 主工作区那时还是合并前的代码。
#   全量由发布期 publish.sh --release-gate 负责（这里不重复跑全量）。
if [ "$SELFTEST" != "0" ] && [ -d "$WT_PATH" ] && [ -f "$WT_PATH/scripts/run-selftests.py" ]; then
  echo "── 合并前自测（在任务工作树内，只跑与本任务改动相关的用例）──"
  SELFTEST_LOG="$REPO/.tmp/selftest-$NAME.log"
  if ( cd "$WT_PATH" && "$PY" scripts/run-selftests.py --changed > "$SELFTEST_LOG" 2>&1 ); then
    grep -E '按改动筛选|自测脚本：' "$SELFTEST_LOG" | sed 's/^/   /'
    echo "[✓] 相关自测通过"
  else
    sed 's/^/   /' "$SELFTEST_LOG"
    echo "[✗] 相关自测未通过 —— 已拦在合并前（合并后再发现要重开工作树，代价更大）"
    echo "     在 $WT_PATH 里修好并提交后重跑本命令；确属断言过时也要先按新写法更新断言。"
    FAIL=1
  fi
  rm -f "$SELFTEST_LOG"
  echo ""
fi

if [ $FAIL -ne 0 ]; then
  echo "===== 预检未通过,未做任何改动 ====="
  echo "解决上面 [✗] 的项后重跑。"
  exit 1
fi

echo "===== 预检通过 ====="

if [ -z "$GO" ]; then
  echo ""
  # 2026-11-06 修口径:这行原来写「确认无误后执行合并」,被并行会话读成
  #   「需要用户点头才能合」,于是收工后跑来问用户「要不要合并」。
  #   铁律是自动合并 —— 预检只是自己看状态,不是请示。
  echo "（预检模式：只是看能不能合，不代表要请示用户）"
  echo "正常收工请直接跑:bash scripts/回收.sh $NAME   # 默认就是合并，不需口令"
  echo "下面这条等价于手动深合并(仍然不推送):"
  echo "   bash scripts/wt-merge.sh $NAME --go --cleanup"
  exit 0
fi

# ---------- 已被合并过的情况 ----------
# 上一轮回收已完成、但工作树还留着(比如当时没带 --cleanup)。
# 这时不该再 merge 一次(会生成无意义的空合并),而应该直接走清理。
if "$GIT" merge-base --is-ancestor "$BRANCH" main 2>/dev/null; then
  echo ""
  echo "✓ 该任务已合并进 main(无需再合并)"
  if [ -n "$CLEANUP" ]; then
    echo ""
    echo "内容已在主干上，先同步测试档再清理任务:"
    sync_to_coco_test || exit $?
    cleanup_task || exit $?
    echo ""
    echo "剩余工作树:"
    "$GIT" worktree list | sed 's/^/   /'
  else
    echo "如需清理工作树与分支:bash scripts/wt-merge.sh $NAME --go --cleanup"
  fi
  exit 0
fi

# ---------- 执行合并 ----------
echo ""
echo "开始合并 $BRANCH → main ..."
if ! "$GIT" merge --no-ff --no-edit "$BRANCH" -m "回收并行任务:$NAME"; then
  # 合并失败 → 若冲突文件都在自动解范围内,尝试自动解
  echo ""
  if resolve_conflicts "$BRANCH"; then
    echo ""
    echo "冲突已自动解决,提交合并 ..."
    if ! "$GIT" commit --no-edit -m "回收并行任务:$NAME(自动解共享数组冲突)"; then
      echo "[✗] 收尾提交失败。"
      echo "    正在中止本次合并 ..."
      "$GIT" merge --abort 2>/dev/null \
        && echo "    已中止,仓库回到合并前状态。" \
        || echo "    自动中止失败，请核对合并状态并手动处理。"
      exit 1
    fi
  else
    echo "[✗] 合并失败,且无法自动解冲突。"
    echo "    正在中止本次合并(不留合并残留) ..."
    "$GIT" merge --abort 2>/dev/null \
      && echo "    已中止,仓库回到合并前状态。" \
      || echo "    ⚠️ 自动中止失败,请手动执行:git merge --abort"
    exit 1
  fi
fi

echo "[✓] 已合并到本地 main @ $("$GIT" rev-parse --short HEAD)"
echo ""
echo "    ⚠️ 只是本地合并,**尚未推送** —— 推送仍由 publish.sh 按攒批纪律执行。"
echo ""

# ---------- 同步到桌面唯一测试档 COCO TEST（2026-10-13 用户定）----------
# sync_to_coco_test 函数定义已提到本文件上方（「已合并过」分支也要用它）。
# 2026-10-13 整改：删除旧的「DY-COCO-调试」存档（用户已取消该档）；
#   同步失败必须显式报出来，不能只打一行提示了事。
sync_to_coco_test || exit $?

if [ -n "$CLEANUP" ]; then
  cleanup_task || exit $?
  echo ""
fi

echo "当前 main 最近提交:"
"$GIT" log --oneline -5 | sed 's/^/   /'