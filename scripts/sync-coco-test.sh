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
#   bash scripts/sync-coco-test.sh           同步 + 自动校验
#   bash scripts/sync-coco-test.sh --check   只校验，不写任何文件
#
# 2026-10-13 整改（本次）：
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

# ---------- 扩展本体清单（同步与校验的唯一事实来源）----------
# ⚠️ 新增扩展顶层文件/目录时，必须**同时**改这三处，否则会出现
#    「源码有、测试档没有」：
#      · 本文件 EXT_FILES / EXT_DIRS
#      · src/update/update.js 的 EXT_TOP_DIRS（自更新白名单）
#      · scripts/make-update-manifest.py 的 DIRS（清单扫描范围）
EXT_FILES="manifest.json update-manifest.json"
EXT_DIRS="icons src install"

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

# ---------- 枚举扩展本体相对路径（相对 REPO）----------
ext_paths() {
  local f d
  for f in $EXT_FILES; do
    [ -f "$REPO/$f" ] && printf '%s\n' "$f"
  done
  for d in $EXT_DIRS; do
    [ -d "$REPO/$d" ] || continue
    ( cd "$REPO" && find "$d" -type f ) || true
  done
}

# ---------- 生成「sha256 + 相对路径」快照 ----------
snapshot() {
  local root="$1"
  local f d
  (
    cd "$root" 2>/dev/null || exit 1
    for f in $EXT_FILES; do
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

  snapshot "$REPO"          > "$tmp.src" 2>/dev/null
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
    n=$(printf '%s\n' "$(ext_paths)" | grep -c . || true)
    echo "  ✓ 两侧一致（$n 个文件逐一 sha256 比对通过）"
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
  echo "      修法：bash scripts/sync-coco-test.sh"
  return 1
}

# ---------- 增量镜像同步 ----------
sync_coco_test() {
  echo ""
  echo "── 同步到 COCO TEST ──"

  assert_manifest_agrees || return 1

  mkdir -p "$COCO_TEST_DIR" || {
    echo "  [✗] 建不出测试档目录：$COCO_TEST_DIR"
    return 1
  }

  local COPY_OK=1 f d item base rel

  # 1) 覆盖同名文件（不清空目录，避免浏览器读到空目录）
  for f in $EXT_FILES; do
    [ -f "$REPO/$f" ] || continue
    cp -f "$REPO/$f" "$COCO_TEST_DIR/$f" || COPY_OK=0
  done
  for d in $EXT_DIRS; do
    [ -d "$REPO/$d" ] || continue
    mkdir -p "$COCO_TEST_DIR/$d" || { COPY_OK=0; continue; }
    cp -rf "$REPO/$d/." "$COCO_TEST_DIR/$d/" || COPY_OK=0
  done

  # 2) 测试档是用户桌面目录：只覆盖/新增运行文件，不自动删除任何残留。
  # 如有过期文件，下面的逐文件校验会列出并失败，不能冒充已同步。
  # 清理残留须单独列明具体文件并确认，不在同步流程使用递归删除。

  if [ "$COPY_OK" -ne 1 ]; then
    echo "  [✗] 复制过程中有失败项 —— 测试档可能不完整。"
    echo "      请检查 $COCO_TEST_DIR 是否被占用，然后重跑本脚本。"
    return 1
  fi

  # 3) 同步完必须自证：逐文件 sha256 再比一遍
  check_sync || return 1
  return 0
}

main() {
  case "${1:-}" in
    --check)
      check_sync
      return $?
      ;;
    ""|--sync)
      sync_coco_test
      rc=$?
      if [ $rc -eq 0 ]; then
        echo "  ✓ 已同步：$COCO_TEST_DIR"
      else
        echo ""
        echo "  ⚠️  同步到 COCO TEST 失败（原因见上）。"
        echo "      ⛔ 在修好之前，不要向用户汇报「改好了」—— 他看到的会是旧版。"
      fi
      return $rc
      ;;
    *)
      echo "用法：bash scripts/sync-coco-test.sh [--check]"
      echo "  （不带参数 = 同步并校验；--check = 只校验一致性）"
      return 2
      ;;
  esac
}

if [ "${BASH_SOURCE[0]}" = "${0}" ]; then
  main "$@"
  exit $?
fi
