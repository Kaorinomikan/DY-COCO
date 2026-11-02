#!/bin/bash
# ============================================================
# 并行开发 · 回收合并(默认只预检,不动任何东西)
#
# 用法:
#   bash scripts/wt-merge.sh <名字>                # 预检:能不能合、会不会冲突
#   bash scripts/wt-merge.sh <名字> --go            # 真合并到 main(仍然不推送)
#   bash scripts/wt-merge.sh <名字> --go --cleanup  # 合并后删掉工作树与分支
#   ... --no-selftest                              # 跳过「合并前相关自测」（默认会跑）
#
# 它与 publish.sh 的分工:
#   · 本脚本只把任务分支**合并进本地 main**;
#   · **绝不推送、绝不打标签、绝不改版本号** —— 那些是 publish.sh 的活,
#     由用户决定什么时候发。合并只是「归总」,不是「发布」。
# ============================================================

# git 路径自动探测(2026-10-14 修,原因见 中文工具.sh)
GIT="$(ls -d C:/Users/79412/.workbuddy/binaries/PortableGit/versions/*/cmd/git.exe 2>/dev/null | sort -V | tail -1)"
[ -n "$GIT" ] || GIT="$(command -v git)"
NODE_BIN="C:/Users/79412/.workbuddy/binaries/node/versions/22.22.2-6/node.exe"
REPO="C:/Develop project/DY-COCO"
WT_ROOT="C:/Develop project/DY-COCO-wt"
# 2026-10-13 用户定:桌面**只保留一个**测试档 COCO TEST,旧档「DY-COCO-调试」取消生成。
# (原 AGENTS.md 第 18 条作废,口径并入第 19 条 —— 见本文件末尾的 sync_to_coco_test)

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

# 6) 代码自检(2026-10-11 用户定:自检必须在合并**之前**)——
#    分支上改过的每个 .js 都要过语法检查,不合格直接拦在合并前
#    --diff-filter=d 排除「被删除的文件」:删掉的文件在分支上读不到,
#    不加这个会把正常的删除动作误判成「读不到分支上的 xx.js」而挡住合并。
JS_FILES=$("$GIT" diff --name-only --diff-filter=d "main...$BRANCH" | grep '\.js$' || true)
if [ -n "$JS_FILES" ]; then
  JS_N=$(printf '%s\n' "$JS_FILES" | wc -l | tr -d ' ')
  JS_FAIL=0
  # 临时文件同样落进 .tmp/（已忽略），并带任务名，避免并发会话互踩
  mkdir -p "$REPO/.tmp"
  TMP_JS="$REPO/.tmp/nodecheck-$NAME.js"
  for f in $JS_FILES; do
    if ! "$GIT" show "$BRANCH:$f" > "$TMP_JS" 2>/dev/null; then
      echo "[✗] 语法自检:读不到分支上的 $f"
      JS_FAIL=1
      continue
    fi
    if ! "$NODE_BIN" --check "$TMP_JS" >/dev/null 2>&1; then
      echo "[✗] 语法自检不通过:$f(修复后重新提交,再回收)"
      JS_FAIL=1
    fi
  done
  rm -f "$TMP_JS"
  if [ $JS_FAIL -ne 0 ]; then
    FAIL=1
  else
    echo "[✓] 语法自检通过($JS_N 个 .js)"
  fi
else
  echo "[✓] 无 .js 改动,跳过语法自检"
fi

echo ""

# 6.5) 合并**前**跑「与本任务改动相关」的自测（2026-11-02 新增）
# ★ 为什么放在合并前、且只跑相关子集：
#   合并之后才发现红，代价是「重开工作树 → 再改 → 再回收」一整轮；
#   在合并前用 5 秒跑相关用例，能挡掉绝大多数这种返工。
#   必须在**任务工作树**里跑 —— 主工作区那时还是合并前的代码，
#   在上面跑等于测旧版，红了才是误报。
#   全量仍由推送期 publish.sh 负责（这里不重复跑全量）。
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
  echo "确认无误后执行合并(仍然不会推送):"
  echo "   bash scripts/wt-merge.sh $NAME --go"
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