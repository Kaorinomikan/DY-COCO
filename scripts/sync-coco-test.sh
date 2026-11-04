#!/bin/bash
# ============================================================
# 同步扩展副本到桌面 COCO TEST（实时测试用 · 唯一测试档）
# ============================================================
# 用户口径（2026-10-13）：
#   「测试文件 = 源代码文件，任意时刻发布都必须一样；
#     不能有功能只进了测试档没进源码，也不能进了源码没进测试档。」
#
# 本脚本因此承担两件事：
#   ① 同步：把工程目录里的**扩展本体**镜像到 COCO TEST
#   ② 校验：逐文件 sha256 比对两侧，不一致就退非 0（可当机械闸门用）
#
# 用法：
#   bash scripts/sync-coco-test.sh                    同步主工作区 → 测试档
#   bash scripts/sync-coco-test.sh --check            只校验，不写任何文件
#   bash scripts/sync-coco-test.sh --from <名字>       同步**未合并的工作树** → 测试档
#   bash scripts/sync-coco-test.sh --check --from <名字>
#   bash scripts/sync-coco-test.sh --status           只显示测试档现在装的是哪份代码
#
# 2026-11-05 新增 --from（起因：用户原话「改动还未合并之前，我能从哪里拿到
#   改动后的文件进行测试，每次改动完就问我真机测试，我都不知道在哪测」）：
#   问题根因 —— 并行开发的改动在工作树 C:/Develop project/DY-COCO-wt/<名字> 里，
#   而本脚本的源**写死**为主工作区，未合并的新代码没有任何通道进测试档，
#   于是只能等合并后才测得到，用户全程不知道「测的是哪一版」。
#   现在 --from <名字> 直接把工作树镜像进 COCO TEST：
#     · 扩展目录不变 → 扩展 ID 不变 → 登录态 / 开关 / 设置全部保留
#     · 只需在扩展管理页点一次「重新加载」
#     · 合并回收时 wt-merge.sh 会自动跑一次无参同步，测试档随之切回主干
#   ⚠️ 工作树模式**不覆盖 update-manifest.json**（它是推送期产物，工作树里
#      按铁律不生成），也不参与一致性比对 —— 否则每次都会误报「不一致」。
#   ⚠️ 同步成功会写来源标记 .tmp/coco-test-source。此后不带 --from 的 --check
#      会明确报「测试档还是工作树 xxx 的代码」，防止把未合并代码当成主干汇报。
#
# 2026-10-13 整改：
#   ① 新增 --check 模式（以前没法回答「两边到底一致吗」）
#   ② 不再「先清空整目录再重写」—— COCO TEST 是浏览器**正在加载**的
#      扩展目录，清空瞬间会让扩展被判定为损坏/被禁用。
#      改为增量镜像：覆盖同名文件 + 只删「源码里已不存在」的文件，
#      正常路径下零删除、零空窗。
#   ③ 失败一律非 0 退出 + 中文说明，绝不静默（旧版失败只 echo 一行）。
#   ④ 扩展本体清单集中在本文件，且与 update.js / make-update-manifest.py
#      的清单做交叉断言，防止将来新增顶层目录时同步被漏掉。
# ============================================================

HERE="$(dirname "$0")"
. "$HERE/中文工具.sh"

REPO="C:/Develop project/DY-COCO"
COCO_TEST_DIR="C:/Users/79412/Desktop/COCO TEST"
WT_ROOT="C:/Develop project/DY-COCO-wt"
MARK="$REPO/.tmp/coco-test-source"

# ---------- 扩展本体清单（同步与校验的唯一事实来源）----------
# ⚠️ 新增扩展顶层文件/目录时，必须**同时**改这三处，否则会出现
#    「源码有、测试档没有」：
#      · 本文件 EXT_FILES / EXT_DIRS
#      · src/update/update.js 的 EXT_TOP_DIRS（自更新白名单）
#      · scripts/make-update-manifest.py 的 DIRS（清单扫描范围）
EXT_FILES="manifest.json update-manifest.json"
EXT_DIRS="icons src install"

# 当前解析出的源（由 resolve_source 赋值）
SRC_DIR="$REPO"
SOURCE_MODE="main"      # main | worktree
SRC_LABEL="主干 main"
# 参与比对的顶层文件：工作树模式排除 update-manifest.json
COMPARE_FILES="$EXT_FILES"

# 断言：清单生成器的扫描目录必须都在本脚本的同步范围内
assert_manifest_agrees() {
  local py="$REPO/scripts/make-update-manifest.py"
  [ -f "$py" ] || return 0
  local dirs
  dirs=$("$PY" - "$py" <<'PYEOF' 2>/dev/null
import re, sys
src = open(sys.argv[1], encoding="utf-8").read()
m = re.search(r'^DIRS\s*=\s*\[([^\]]*)\]', src, re.M)
if m:
    print(" ".join(x.strip().strip('"\'') for x in m.group(1).split(",") if x.strip()))
PYEOF
)
  [ -z "$dirs" ] && return 0
  local d missing=""
  for d in $dirs; do
    case " $EXT_DIRS " in *" $d "*) ;; *) missing="$missing $d" ;; esac
  done
  if [ -n "$missing" ]; then
    echo "  [✗] 同步清单已过期：清单生成器扫描$missing，但同步清单里没有。" >&2
    echo "      请把$missing 补进本文件的 EXT_DIRS，否则商家更新与测试档会漏文件。" >&2
    return 1
  fi
  return 0
}

# ---------- 解析源：空 = 主工作区；名字/路径 = 未合并的工作树 ----------
resolve_source() {
  local arg="$1"

  case "$arg" in
    ""|main|主干|--main)
      SRC_DIR="$REPO"
      SOURCE_MODE="main"
      COMPARE_FILES="$EXT_FILES"
      SRC_LABEL="主干 main（已合并的代码）"
      return 0
      ;;
  esac

  local cand
  case "$arg" in
    /*|[A-Za-z]:*) cand="$arg" ;;
    *)             cand="$WT_ROOT/$arg" ;;
  esac

  if [ ! -d "$cand" ]; then
    echo "  [✗] 找不到工作树：$cand" >&2
    if [ -d "$WT_ROOT" ] && [ -n "$(ls -A "$WT_ROOT" 2>/dev/null)" ]; then
      echo "      现有工作树：" >&2
      ls -1 "$WT_ROOT" 2>/dev/null | sed 's/^/        /' >&2
    else
      echo "      当前没有任何工作树 —— 说明没有未合并的改动，直接跑无参同步即可。" >&2
    fi
    return 1
  fi

  if [ ! -f "$cand/manifest.json" ]; then
    echo "  [✗] 这不是扩展本体（目录里没有 manifest.json）：$cand" >&2
    return 1
  fi

  SRC_DIR="$cand"
  SOURCE_MODE="worktree"
  COMPARE_FILES="manifest.json"
  SRC_LABEL="工作树 $(basename "$cand")（未合并）"
  return 0
}

# ---------- 来源标记：记录测试档现在装的是哪份代码 ----------
write_mark() {
  mkdir -p "$REPO/.tmp" 2>/dev/null || return 0
  {
    echo "name=$(basename "$SRC_DIR")"
    echo "branch=$("$GIT" -C "$SRC_DIR" rev-parse --abbrev-ref HEAD 2>/dev/null)"
    echo "commit=$("$GIT" -C "$SRC_DIR" rev-parse --short HEAD 2>/dev/null)"
    echo "time=$(date '+%Y-%m-%d %H:%M')"
  } > "$MARK" 2>/dev/null || true
  return 0
}

clear_mark() {
  [ -f "$MARK" ] && rm -f "$MARK" 2>/dev/null
  return 0
}

mark_field() {
  [ -f "$MARK" ] || return 1
  sed -n "s/^$1=//p" "$MARK" 2>/dev/null | head -1
}

# 标记存在 = 测试档装的是未合并工作树的代码
mark_name() {
  mark_field name
}

# ---------- 枚举扩展本体相对路径（相对 root）----------
ext_paths() {
  local root="${1:-$SRC_DIR}"
  local f d
  for f in $COMPARE_FILES; do
    [ -f "$root/$f" ] && printf '%s\n' "$f"
  done
  for d in $EXT_DIRS; do
    [ -d "$root/$d" ] || continue
    ( cd "$root" && find "$d" -type f ) || true
  done
}

# ---------- 生成「sha256 + 相对路径」快照 ----------
snapshot() {
  local root="$1"
  local f d
  (
    cd "$root" 2>/dev/null || exit 1
    for f in $COMPARE_FILES; do
      [ -f "$f" ] && sha256sum "$f"
    done
    for d in $EXT_DIRS; do
      [ -d "$d" ] && # 2026-11-02 提速：{} + 一次传参
      #，而不是每个文件启一个进程。
      find "$d" -type f -exec sha256sum {} +
    done
  ) | LC_ALL=C sort -k2
}

# ---------- 校验两侧一致 ----------
check_sync() {
  local tmp="$REPO/.tmp/sync-check.$$"
  mkdir -p "$REPO/.tmp" || return 1

  if [ ! -d "$COCO_TEST_DIR" ]; then
    echo "  [✗] 测试档不存在：$COCO_TEST_DIR"
    return 1
  fi

  # ① 先判「测试档里到底是哪份代码」—— 这是比文件差异更前置的问题。
  #    没有这道判断，工作树代码会被当成主干汇报（用户测的是旧版，
  #    报告里写的却是新版，两边永远对不上）。
  local mk
  mk=$(mark_name 2>/dev/null)
  if [ "$SOURCE_MODE" = "main" ] && [ -n "$mk" ]; then
    echo "  [✗] 测试档里现在装的是**未合并的工作树 $mk** 的代码，不是主干。"
    echo "      提交/分支：$(mark_field branch 2>/dev/null) @ $(mark_field commit 2>/dev/null)"
    echo "      同步于：$(mark_field time 2>/dev/null)"
    echo "      切回主干：bash scripts/sync-coco-test.sh"
    return 1
  fi
  if [ "$SOURCE_MODE" = "worktree" ]; then
    local want
    want=$(basename "$SRC_DIR")
    if [ "$mk" != "$want" ]; then
      echo "  [✗] 测试档来源与本次校验对象不符："
      echo "      现在装的：${mk:-主干 main（无标记）}"
      echo "      要校验的：$want"
      echo "      重同步：bash scripts/sync-coco-test.sh --from $want"
      return 1
    fi
  fi

  # ② 再逐文件比内容
  snapshot "$SRC_DIR"       > "$tmp.src" 2>/dev/null
  snapshot "$COCO_TEST_DIR" > "$tmp.dst" 2>/dev/null

  # 测试档顶层有没有白名单之外的残留（目录内部的多余文件由快照自然覆盖）
  local extra="" item base
  for item in "$COCO_TEST_DIR"/*; do
    [ -e "$item" ] || continue
    base=$(basename "$item")
    case " $EXT_FILES $EXT_DIRS " in
      *" $base "*) ;;
      *) extra="$extra $base" ;;
    esac
  done

  if [ -z "$extra" ] && diff -q "$tmp.src" "$tmp.dst" >/dev/null 2>&1; then
    local n
    n=$(ext_paths "$SRC_DIR" | grep -c . || true)
    if [ "$SOURCE_MODE" = "worktree" ]; then
      echo "  ✓ 测试档 = 工作树 $mk 的代码（$n 个文件逐一 sha256 比对通过）"
    else
      echo "  ✓ 两侧一致（$n 个文件逐一 sha256 比对通过）"
    fi
    rm -f "$tmp.src" "$tmp.dst"
    return 0
  fi

  echo "  [✗] 测试档与源码不一致："
  [ -n "$extra" ] && echo "      测试档多余:  $extra"
  # 快照每行格式为「sha256 路径」（Git Bash 下可能带二进制标记 *），统一剥掉再比
  awk '
    function clean(s) { sub(/^\*/, "", s); return s }
    NR==FNR { p = clean($2); s[p] = $1; next }
    { p = clean($2); d[p] = $1 }
    END {
      for (p in s) if (!(p in d))              print "      测试档缺失:   " p
      for (p in d) if (!(p in s))              print "      测试档多余:   " p
      for (p in s) if ((p in d) && s[p]!=d[p]) print "      内容不一致:   " p
    }
  ' "$tmp.src" "$tmp.dst" | LC_ALL=C sort -u | head -30
  rm -f "$tmp.src" "$tmp.dst"
  if [ "$SOURCE_MODE" = "worktree" ]; then
    echo "      修法：bash scripts/sync-coco-test.sh --from $mk"
  else
    echo "      修法：bash scripts/sync-coco-test.sh"
  fi
  return 1
}

# ---------- 增量镜像同步 ----------
sync_coco_test() {
  echo ""
  echo "── 同步到 COCO TEST ──"
  echo "   源：$SRC_LABEL"

  assert_manifest_agrees || return 1

  if [ ! -d "$SRC_DIR" ]; then
    echo "  [✗] 源目录不存在：$SRC_DIR"
    return 1
  fi

  mkdir -p "$COCO_TEST_DIR" || {
    echo "  [✗] 建不出测试档目录：$COCO_TEST_DIR"
    return 1
  }

  local COPY_OK=1 f d

  # 1) 覆盖同名文件（不清空目录，避免浏览器读到空目录）
  for f in $EXT_FILES; do
    [ -f "$SRC_DIR/$f" ] || continue
    # 工作树**永不**产出 update-manifest.json（推送期产物）：不拿它覆盖测试档，
    # 否则自更新链路会拿"开发期清单"冒充发布清单。
    if [ "$SOURCE_MODE" = "worktree" ] && [ "$f" = "update-manifest.json" ]; then
      continue
    fi
    cp -f "$SRC_DIR/$f" "$COCO_TEST_DIR/$f" || COPY_OK=0
  done
  for d in $EXT_DIRS; do
    [ -d "$SRC_DIR/$d" ] || continue
    mkdir -p "$COCO_TEST_DIR/$d" || { COPY_OK=0; continue; }
    cp -rf "$SRC_DIR/$d/." "$COCO_TEST_DIR/$d/" || COPY_OK=0
  done

  # 2) 测试档是用户桌面目录：只覆盖/新增运行文件，不自动删除任何残留。
  # 如有过期文件，下面的逐文件校验会列出并失败，不能冒充已同步。
  # 清理残留须单独列明具体文件并确认，不在同步流程使用递归删除。

  if [ "$COPY_OK" -ne 1 ]; then
    echo "  [✗] 复制过程中有失败项 —— 测试档可能不完整。"
    echo "      请检查 $COCO_TEST_DIR 是否被占用，然后重跑本脚本。"
    return 1
  fi

  # 3) 先落来源标记，再自证内容 —— 这样校验失败时的报错也能说清来源
  if [ "$SOURCE_MODE" = "worktree" ]; then
    write_mark
  else
    clear_mark
  fi

  # 4) 同步完必须自证：逐文件 sha256 再比一遍
  check_sync || return 1
  return 0
}

# ---------- 只显示来源，不比对 ----------
show_status() {
  local mk
  mk=$(mark_name 2>/dev/null)
  echo ""
  echo "── 测试档来源（$COCO_TEST_DIR）──"
  if [ -n "$mk" ]; then
    echo "   ▶ 未合并的工作树：$mk"
    echo "     分支：$(mark_field branch 2>/dev/null)"
    echo "     提交：$(mark_field commit 2>/dev/null)"
    echo "     同步于：$(mark_field time 2>/dev/null)"
    echo "     合并后切回主干：bash scripts/sync-coco-test.sh"
  else
    echo "   ▶ 主干 main（已合并的代码）"
    local head
    head=$("$GIT" -C "$REPO" rev-parse --short HEAD 2>/dev/null)
    [ -n "$head" ] && echo "     当前提交：$head"
  fi
  return 0
}

usage() {
  cat <<'USAGE'
用法：bash scripts/sync-coco-test.sh [选项]
  （不带参数）              同步主工作区（主干）并校验
  --check                  只校验一致性，不写任何文件
  --from <名字>             同步**未合并的工作树**到测试档（真机验证未合并改动）
  --check --from <名字>     校验测试档是否等于指定工作树
  --status                 只显示测试档现在装的是哪份代码

工作树名字 = scripts/wt-new.sh 时填的名字，也可直接给绝对路径。
同步后到浏览器扩展管理页点一次「重新加载」，测到的才是新代码。
USAGE
}

main() {
  local arg1="${1:-}" arg2="${2:-}" arg3="${3:-}"

  case "$arg1" in
    --help|-h)
      usage
      return 0
      ;;
    --status)
      show_status
      return 0
      ;;
    --check)
      # --check [--from <名字>] / --check <名字>
      if [ "$arg2" = "--from" ]; then
        resolve_source "$arg3" || return 1
      elif [ -n "$arg2" ]; then
        resolve_source "$arg2" || return 1
      else
        resolve_source "" || return 1
      fi
      check_sync
      return $?
      ;;
    --from)
      if [ -z "$arg2" ]; then
        echo "  [✗] --from 后面要跟工作树名字，例如：--from 测试通道" >&2
        echo "      不知道名字就跑 bash scripts/wt-list.sh 看。" >&2
        return 2
      fi
      resolve_source "$arg2" || return 1
      ;;
    ""|--sync)
      resolve_source "" || return 1
      ;;
    *)
      echo "未知参数：$arg1" >&2
      usage >&2
      return 2
      ;;
  esac

  sync_coco_test
  local rc=$?
  if [ $rc -eq 0 ]; then
    echo "  ✓ 已同步：$COCO_TEST_DIR"
    if [ "$SOURCE_MODE" = "worktree" ]; then
      echo ""
      echo "  现在装的是：$SRC_LABEL"
      echo "  ⚠️  去浏览器扩展管理页点一次「重新加载」，否则测到的还是旧代码。"
      echo "  测完切回主干：bash scripts/sync-coco-test.sh"
      echo "  （合并回收时 wt-merge 会自动跑无参同步，标记随之清除）"
    fi
  else
    echo ""
    echo "  ⚠️  同步到 COCO TEST 失败（原因见上）。"
    echo "      ⛔ 在修好之前，不要向用户汇报「改好了」—— 他看到的会是旧版。"
  fi
  return $rc
}

if [ "${BASH_SOURCE[0]}" = "${0}" ]; then
  main "$@"
  exit $?
fi
