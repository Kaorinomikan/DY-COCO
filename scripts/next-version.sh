#!/bin/bash
# ============================================================
# 抖音可可助手(DY-COCO)· 版本号推算器
#
# 用途:
#   一次性查清「Gitee 在线版是哪个」,并按用户定的口径
#   算出「本次推送应该用哪个版本号」。
#   把过去在对话里手动 curl 的动作固化成一条命令。
#
# 口径(用户 2026-10-11 定,见 docs/agents/用户要求.md 第 3 条):
#   版本号以**在线版**为基准 +1,格式 YY.MM.DD.N。
#   · 在线版与今天同日 → 只递增最后一段(26.10.11.1 → 26.10.11.2)
#   · 在线版是更早的日期 → 日期刷新、序号归 1(26.10.10.8 → 26.10.11.1)
#
# 何时跑:
#   ⚠️ 只在**推送期**跑,不要每做完一个小功能就跑。
#   开发期一律纯本地(见 AGENTS.md「三、开发流程」)。
#
# 用法:
#   bash scripts/next-version.sh          # 查在线版并推算
#   bash scripts/next-version.sh --offline  # 强制离线(只用本地标签,发警告)
#
# 退出码:
#   0 = 成功;1 = 连不上在线源且未指定 --offline;2 = 参数错误
# ============================================================

set -e

REPO="C:/Develop project/DY-COCO"
# git 路径自动探测(2026-10-14 修,原因见 中文工具.sh)
GIT="$(ls -d C:/Users/79412/.workbuddy/binaries/PortableGit/versions/*/cmd/git.exe 2>/dev/null | sort -V | tail -1)"
[ -n "$GIT" ] || GIT="$(command -v git)"
URL_FILE="$REPO/.gitee-url.bak"

OFFLINE=0
case "${1:-}" in
  ""|--online) OFFLINE=0 ;;
  --offline)   OFFLINE=1 ;;
  -h|--help)
    sed -n '2,30p' "$0"
    exit 0 ;;
  *) echo "[错误] 未知参数:$1(可用 --offline)"; exit 2 ;;
esac

cd "$REPO"

if [ ! -f "$URL_FILE" ]; then
  echo "[错误] 找不到 $URL_FILE(仓库地址备份)。"
  exit 1
fi

REPO_URL=$(cat "$URL_FILE")
REPO_WEB=$(printf '%s' "$REPO_URL" | sed 's/\.git$//')
TODAY=$(date "+%y.%m.%d")

echo "===== 版本号推算 ====="
echo "仓库    :$REPO_WEB"
echo "今天    :20$(echo "$TODAY" | cut -d. -f1) 年$(echo "$TODAY" | cut -d. -f2) 月$(echo "$TODAY" | cut -d. -f3) 日"
echo ""

# ---------- 在线版来源 1:标签列表 tags.atom(含全部标签,不受发行版影响)----------
ONLINE_TAG=""
SOURCE=""
if [ "$OFFLINE" = "0" ]; then
  echo "----- 查在线标签源(tags.atom)-----"
  ATOM=$(curl -sL --max-time 25 "$REPO_WEB/tags.atom?t=$(date +%s)" 2>/dev/null || true)
  if [ -n "$ATOM" ]; then
    ONLINE_TAG=$(printf '%s' "$ATOM" \
      | grep -o '<title>[^<]*</title>' \
      | sed 's/<[^>]*>//g' \
      | grep -E '^v[0-9]{1,2}(\.[0-9]{1,3})+$' \
      | sed 's/^v//' \
      | sort -V | tail -1 || true)
    [ -n "$ONLINE_TAG" ] && SOURCE="tags.atom"
  fi
  if [ -n "$ONLINE_TAG" ]; then
    echo "[OK] 在线最大标签:v$ONLINE_TAG"
  else
    echo "[警告] tags.atom 取不到标签(网络不通?或仓库为空?)"
  fi

  # ---------- 在线版来源 2:主干 manifest.json(交叉印证)----------
  echo ""
  echo "----- 交叉印证(raw/main/manifest.json)-----"
  MAIN_VER=$(curl -sL --max-time 25 "$REPO_WEB/raw/main/manifest.json" 2>/dev/null \
    | grep -m1 '"version"' | cut -d'"' -f4 || true)
  if [ -n "$MAIN_VER" ]; then
    MAIN_VER=$(printf '%s' "$MAIN_VER" | tr -d '\r')
    echo "[OK] 主干 manifest 版本:$MAIN_VER"
  else
    echo "[警告] 读不到主干 manifest(网络不通?)"
  fi

  if [ -z "$ONLINE_TAG" ] && [ -z "$MAIN_VER" ]; then
    echo ""
    echo "[中止] 在线源全部不可达。若确认要离线推算,重跑:"
    echo "       bash scripts/next-version.sh --offline"
    exit 1
  fi

  # 以两者中较大者为准(标签可能存在但主干还没跟上,反之亦然)
  BASE_VER="$ONLINE_TAG"
  if [ -n "$MAIN_VER" ] && [ -n "$BASE_VER" ]; then
    BIG=$(printf '%s\n%s\n' "$MAIN_VER" "$BASE_VER" | sort -V | tail -1)
    if [ "$BIG" != "$BASE_VER" ]; then
      echo "[注意] 在线标签 v$BASE_VER 落后于主干 manifest $MAIN_VER,以后者为准"
      BASE_VER="$MAIN_VER"
      SOURCE="raw/main/manifest.json"
    else
      SOURCE="tags.atom"
    fi
  elif [ -z "$BASE_VER" ]; then
    BASE_VER="$MAIN_VER"
    SOURCE="raw/main/manifest.json"
  fi
else
  echo "----- 离线模式(跳过在线查询)-----"
fi

# ---------- 回退:本地最新标签 ----------
if [ -z "$BASE_VER" ]; then
  BASE_VER=$("$GIT" tag -l 'v*' 2>/dev/null | sed 's/^v//' \
    | grep -E '^[0-9]{1,2}(\.[0-9]{1,3})+$' | sort -V | tail -1 || true)
  MSG="离线模式"
  [ "$OFFLINE" = "0" ] && MSG="在线源不可达"
  if [ -n "$BASE_VER" ]; then
    echo ""
    echo "[警告] $MSG,回退用**本地**最新标签 v$BASE_VER 当基准。"
    echo "       本地标签可能落后于线上真实版本,推送前务必再核对一次!"
    SOURCE="本地标签(fallback)"
  else
    echo ""
    echo "[错误] 没有在线版也读不到本地标签,无法推算。"
    exit 1
  fi
fi

# ---------- 推算下一号 ----------
B_MON=$(echo "$BASE_VER"  | cut -d. -f1-3)
B_SEQ=$(echo "$BASE_VER"  | cut -d. -f4)
B_SEQ=${B_SEQ:-0}

if [ "$B_MON" = "$TODAY" ]; then
  NEXT="$TODAY.$((B_SEQ + 1))"
  RULE="基准与今天同日 → 只递增最后一段"
else
  NEXT="$TODAY.1"
  RULE="基准是更早的日期 → 日期刷新、序号归 1"
fi

echo ""
echo "===== 结论 ====="
echo "基准来源:$SOURCE"
echo "基准版本:$BASE_VER"
echo "推算规则:$RULE"
echo ""
echo "★ 本次应发版本号:$NEXT"
echo "★ 本次标签应打   :v$NEXT"
echo ""
echo "后续(推送期一次性做完,详见 AGENTS.md「三、开发流程」):"
echo "  1. 改 manifest.json 的 \"version\" 为 $NEXT"
echo "  2. 跑 python scripts/check-sw-build.py --fix 同步 SW 构建标记"
echo "     (每发一版都必须变;它决定浏览器会不会重建 SW 脚本包)"
echo "  3. 重新生成更新清单:python scripts/make-update-manifest.py"
echo "  4. 同步 README.md / RELEASE_NOTES.md 两份文档"
echo "  5. 自审通过后:SELF_REVIEW=1 bash publish.sh"