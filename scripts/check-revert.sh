#!/bin/bash
# ============================================================
# 真回退体检 —— 判断「分支相对 main 删掉的代码」是真删还是只是落后
#
# 为什么需要它（2026-11-07 的真实误判）：
#   任务分支落后 main 之后，`git diff main..branch` 会把「main 有、分支没跟上」
#   的文件显示成一大片删除。人（和助手）看到删除行就以为对方「把 main 的改动
#   退回去了」，于是去「恢复」——其实那只是落后，正常合并会自动补上。
#
#   反过来，真有人把 main 上的东西删了，`diff` 里也是同样的删除行，
#   光看 diff 分不出来。区别只有一处：
#     · 落后：该文件在 base..main 之间被 main 改过 ⇒ 分支侧是「没有这些改动」
#     · 真回退：该文件在 base..main 之间 main 没动过 ⇒ 分支侧是「主动删掉了」
#
# 用法：
#   bash scripts/check-revert.sh <分支> [基线分支=main]
#
# 输出（每行一个真回退文件，TAB 分隔）：
#   <净删除行数>\t<路径>
#
# 退出码：
#   0 = 没有真回退
#   1 = 发现真回退（列表已打印到 stdout）
#   2 = 参数/仓库异常（分支不存在等）
#
# 环境变量：
#   DYC_GIT  git 可执行文件路径（默认取 PATH 里的 git）
#
# ⚠️ 已知限制：路径含空格时 `--numstat` 会输出带引号的路径，本脚本按裸路径处理。
#    本项目约定文件名不含空格（用户 2026-10-18 定），所以不做转义解析。
# ============================================================

GIT_BIN="${DYC_GIT:-$(command -v git)}"
BRANCH="${1:-}"
BASE_BRANCH="${2:-main}"

if [ -z "$BRANCH" ]; then
  echo "用法：bash scripts/check-revert.sh <分支> [基线分支=main]" >&2
  exit 2
fi
if ! "$GIT_BIN" rev-parse --verify --quiet "$BRANCH" >/dev/null; then
  echo "分支不存在：$BRANCH" >&2
  exit 2
fi
if ! "$GIT_BIN" rev-parse --verify --quiet "$BASE_BRANCH" >/dev/null; then
  echo "基线分支不存在：$BASE_BRANCH" >&2
  exit 2
fi

BASE=$("$GIT_BIN" merge-base "$BASE_BRANCH" "$BRANCH" 2>/dev/null)
if [ -z "$BASE" ]; then
  echo "两个分支没有共同祖先，无法判断：$BASE_BRANCH / $BRANCH" >&2
  exit 2
fi

RESULT=$(
  "$GIT_BIN" diff --numstat "$BASE_BRANCH..$BRANCH" | while IFS=$'\t' read -r add del path; do
    # 二进制文件 numstat 给的是 `-`，不参与行数判断
    case "$del" in ''|'-') continue ;; esac
    case "$del" in *[!0-9]*) continue ;; esac
    case "$add" in ''|'-') add=0 ;; esac
    case "$add" in *[!0-9]*) add=0 ;; esac
    # ① 必须是「净删除」：改代码时删旧行、加新行是常态，只有删得比加得多
    #    才可能是「把别人的东西拿掉了」。2026-11-07 实测：改成只看 del>0
    #    会把「改写共享脚本」也报成回退，三个本来正常的任务全被拦。
    NET=$((del - add))
    [ "$NET" -gt 0 ] || continue
    # ② 该文件在共同祖先之后，main 侧必须没动过 ——
    #    动过 ⇒ 分支侧只是「没跟上」，正常合并会自动补回来，不算回退。
    if "$GIT_BIN" diff --quiet "$BASE" "$BASE_BRANCH" -- "$path" 2>/dev/null; then
      printf '%s\t%s\n' "$NET" "$path"
    fi
  done
)

if [ -n "$RESULT" ]; then
  printf '%s\n' "$RESULT"
  exit 1
fi
exit 0
