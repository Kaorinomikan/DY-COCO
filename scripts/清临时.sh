#!/bin/bash
# ============================================================
# 清临时 —— 回收自测/发布跑出来的临时目录
# ============================================================
# 用法:bash scripts/清临时.sh            清掉 3 小时前的临时目录(默认)
#       bash scripts/清临时.sh 看         只报数,不删
#       bash scripts/清临时.sh 全清       不看时间窗,全清(确认没人跑自测时用)
#       bash scripts/清临时.sh --quiet    静默,只出一行(被「回收.sh」自动调用)
#
# 为什么需要:
#   自测每次用 tempfile.mkdtemp 在 .tmp/ 下新建一个 flow-selftest-* 目录,
#   发布指纹校验新建 release-fingerprint-* 目录,跑完都没人删。
#   2026-11-17 一次性清出 4145 个这类目录,单 .tmp 就占 174MB,
#   工程目录从 220MB 缩到 46MB。不自动回收的话一个月又长回来。
#
# 只动 .tmp/ 下这两类目录。以下**永不删除**:
#   selftest-durations.json   自测耗时缓存,run-selftests.py 读它排调度
#   coco-test-source          测试档同步来源标记,看板.sh 读它
#   *.log                     并发会话正在写的日志,删了对方拿不到输出
#
# 为什么留 3 小时时间窗:
#   两个会话可能同时跑自测。删掉对方正在用的目录会让那一次自测莫名失败,
#   排查起来极难(报错指向被测功能,不是清理)。窗口只用来兜住这种情况,
#   正常一次全量自测远不到 3 小时。
# ============================================================

HERE="$(dirname "$0")"
. "$HERE/中文工具.sh"

MODE="${1:-}"
AGE_MIN=180

case "$MODE" in
  "")            DRY="" ; ALL="" ; QUIET="" ;;
  看|预检|试)    DRY="--dry" ; ALL="" ; QUIET="" ;;
  全清|全部)     DRY="" ; ALL="--all" ; QUIET="" ;;
  --quiet|静默)  DRY="" ; ALL="" ; QUIET="--quiet" ;;
  *) die "第二个参数只能不写(默认清 3 小时前的)、「看」、「全清」或 --quiet" ;;
esac

TMP_DIR="$REPO/.tmp"

# ---------- 安全闸:路径不对就一个都不删 ----------
# 这个脚本带 -exec rm -rf,写错路径的代价不可逆,所以宁可多一道校验。
case "$TMP_DIR" in
  */.tmp) : ;;
  *) die "临时目录路径异常:$TMP_DIR —— 为安全起见中止,一个文件都没删" ;;
esac
[ -d "$TMP_DIR" ] || {
  [ -n "$QUIET" ] || echo "  ✓ 没有 .tmp 目录,不需要清理"
  exit 0
}

# ---------- 找目标 ----------
if [ -n "$ALL" ]; then
  AGE_ARGS=()
else
  AGE_ARGS=(-mmin "+$AGE_MIN")
fi

targets() {
  find "$TMP_DIR" -maxdepth 1 -mindepth 1 -type d \
    \( -name 'flow-selftest-*' -o -name 'release-fingerprint-*' \) \
    "${AGE_ARGS[@]}" -print 2>/dev/null
}

COUNT=$(targets | wc -l | tr -d ' ')

if [ "$COUNT" -eq 0 ]; then
  [ -n "$QUIET" ] || echo "  ✓ 没有需要清理的临时目录(当前 0 个)"
  exit 0
fi

# ---------- 只报数 ----------
if [ -n "$DRY" ]; then
  SIZE=$(targets | tr '\n' '\0' | xargs -0 du -sk 2>/dev/null | awk '{s+=$1} END {printf "%.0f", s/1024}')
  echo "  可清理:$COUNT 个临时目录,约 ${SIZE:-0} MB"
  echo "  (只是报数,没有删任何东西。确认后执行:bash scripts/清临时.sh)"
  exit 0
fi

# ---------- 清 ----------
BEFORE=$(du -sk "$TMP_DIR" 2>/dev/null | awk '{print $1}')

targets | tr '\n' '\0' | xargs -0 rm -rf 2>/dev/null

AFTER=$(du -sk "$TMP_DIR" 2>/dev/null | awk '{print $1}')
FREED=$(( (${BEFORE:-0} - ${AFTER:-0}) / 1024 ))
LEFT=$(targets | wc -l | tr -d ' ')

if [ -n "$QUIET" ]; then
  echo "  ✓ 已回收 $((COUNT - LEFT)) 个自测临时目录,释放约 ${FREED} MB"
else
  echo ""
  echo "  已回收 $((COUNT - LEFT)) 个自测临时目录,释放约 ${FREED} MB"
  [ "$LEFT" -gt 0 ] && echo "  仍有 $LEFT 个在 3 小时时间窗内(可能正在被别的会话使用),下次再清"
  echo "  当前 .tmp 体积:$(( ${AFTER:-0} / 1024 )) MB"
fi
