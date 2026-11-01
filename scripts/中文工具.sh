#!/bin/bash
# ============================================================
# 中文工具库(被「开工/看板/说明/回收/清理」五个中文入口共用)
# ============================================================
# 存在的理由:底下的 git 是英文程序,输出也是英文,参数也是英文。
# 你不需要看见那些 —— 这一层负责翻译,并做两件保护:
#   ① 拦住会出问题的东西(比如任务名里带空格)
#   ② 失败时说清楚该怎么办,而不是把一屏英文甩给你
# ============================================================

REPO="C:/Develop project/DY-COCO"
WT_ROOT="C:/Develop project/DY-COCO-wt"
# git 路径自动探测(2026-10-14 修):原先硬编码 versions/1.2.0,本机 PortableGit
# 升到 1.3.0 后所有脚本同时报「No such file or directory」—— 既开不了工也回收不了。
# 现在取 versions/ 下版本号最大者,取不到再退回 PATH 里的 git。
GIT="$(ls -d C:/Users/79412/.workbuddy/binaries/PortableGit/versions/*/cmd/git.exe 2>/dev/null | sort -V | tail -1)"
[ -n "$GIT" ] || GIT="$(command -v git)"
PY="C:/Users/79412/.workbuddy/binaries/python/versions/3.13.12/python.exe"

# ---------- 把 git 的英文输出翻成中文 ----------
#
# ⚠️ 重要:这个函数**只能包单条 git 命令**,不能拿去包整段脚本输出。
#   错用会怎样(实测踩到):`wt-new.sh | zh_git` 会让 zh_git 执行
#   `git <脚本输出来的中文当参数>` → git 打印帮助、退出码非 0,
#   外层却以为成功了 —— **失败被吞掉**,比报错危险得多。
#   整段脚本输出要翻译,直接用 zh() 那条管道(它是 STDIN→STDOUT 直通)。
zh_git() {
  "$GIT" "$@" 2>&1 | zh
}

# ---------- STDIN → STDOUT 的文本翻译管道(不执行任何东西)----------
zh() {
  "$PY" -c '
import sys, re
PAIRS = [
 (r"^Preparing worktree", "正在准备工作区…"),
 (r"^HEAD is now at",     "当前版本:"),
 (r"^Switched to branch", "已切到分支:"),
 (r"^Already on branch",  "已在分支:"),
 (r"Auto-merging",        "自动合并"),
 (r"CONFLICT \(content\)","内容冲突"),
 (r"^CONFLICT",           "冲突"),
 (r"Automatic merge failed", "自动合并失败"),
 (r"Merge made by the",   "合并完成"),
 (r"^Deleted branch",     "已删除分支:"),
 (r"\[new tag\]",         "新标签"),
 (r"nothing to commit",   "没有需要提交的内容"),
 (r"^fatal:",             "严重错误:"),
 (r"^error:",             "错误:"),
 (r"^warning:",           "警告:"),
]
for line in sys.stdin:
    t = line.rstrip("\n")
    for pat, rep in PAIRS:
        t = re.sub(pat, rep, t)
    t = t.replace("Everything up-to-date", "内容一致,无需更新")
    t = t.replace("main -> main", "主干已更新")
    t = t.replace("branch", "分支").replace("worktree", "工作区")
    t = t.replace("->", "→")
    print(t)
'
}

# ---------- 出错时:说人话 ----------
die() {
  echo ""
  echo "  ✗ $*"
  echo ""
  exit 1
}

# ---------- 校验任务名 ----------
check_name() {
  [ -z "${1:-}" ] && die "请先写上任务名。例如:
     bash scripts/$(basename "$0") 回到顶部"
  case "$1" in
    *"/"*|*"\\"*|*" "*|*":"*|*"?"*|*"<"*|*">"*|*"|"*)
      die "任务名里不能有 空格 / \\ : * ? < > |
     请用 2~8 个汉字,例如「回到顶部」「款号搜索」" ;;
  esac
}