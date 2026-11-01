#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
抖音可可助手（DY-COCO）· Gitee 发行版发布器

⚠️⚠️ 【已停用 · 本仓库禁止创建发行版】⚠️⚠️
    用户 2026-10-11 真机验收自更新通过后明确要求（最高优先级）：
        「之后无论如何都禁止再创建发行版。
          我叫你推送，你就只更新新的代码上去 gitee。」
    因此本脚本**默认模式一律拒绝执行**（硬闸门见 main() 开头）。
    日常推送改用工程根目录的 publish.sh —— 它只推主干与标签。

    保留本文件是为了不丢失历史能力。只读模式（--dry-run / --preflight /
    --audit）仍可使用；若用户再次明确要求建发行版，用环境变量显式解锁：
        DYC_ALLOW_RELEASE=1 python scripts/gitee-release.py

    为什么发行版不再需要：扩展自更新链路（检测读 …/tags.atom、下载读
    …/raw/<标签>/…）完全不依赖发行版；而 Gitee 会清理旧发行版
    （v26.10.10.3/.4/.5 在发布 .8 后不久即从仓库消失），继续维护发行版
    只会让已发给商家的下载链接随时失效。

用途
    把 scripts/make-dist.py 打出的「干净分发包」上传成 Gitee 仓库的
    发行版（Release）附件，并打印商家可以直接使用的下载链接。

为什么需要它
    Gitee 的「标签归档」（…/archive/refs/tags/vX.zip）是**源码快照**，
    里面带着 publish.sh / AGENTS.md / 开发日志.md 等内部文件，
    而且**不含**面向商家的 `!安装说明.txt` 与 `!安装助手.bat`。
    把归档链接发给商家是错的：拿到的是残缺包，装了也加载不起来。

    正确做法：把干净包单独作为 Release 附件上传。

    附件下载链接形态（已实测：匿名可访问、不需要登录，且下载物与本地包 sha256 一致）：
        https://gitee.com/{owner}/{repo}/releases/download/{tag}/{文件名}

    ⚠️ 发给商家就用上面这条「直下链接」。
        https://gitee.com/{owner}/{repo}/releases/latest 只是发行版**页面**
        （302 跳到 releases/tag/{tag}）。页面上除了我们上传的附件，
        还有两个 Gitee 自动生成的源码包（{tag}.zip / {tag}.tar.gz），
        名字和我们的包极像 —— 面向不懂电脑的商家一定会点错，
        所以不要给页面链接。自动生成的源码包无法关闭，只能靠给直下链接规避。

私人令牌
    需要 Gitee 私人令牌，权限勾选 projects（仓库读写）。
    生成入口：https://gitee.com/profile/personal_access_tokens

    按以下顺序查找，**任何情况下都不写入仓库**：
        1. 环境变量 GITEE_TOKEN
        2. 工程目录的上一级下的 .dyc-gitee-token 文件
           （即 C:/Develop project/.dyc-gitee-token，刻意放在仓库外）

设计要点（改这个脚本前请先读）
    1. 【硬性】上传前校验：zip 内 manifest.json 的版本号必须等于待发布版本号。
       防止把上一次的包传成新版本 —— 商家装完发现版本没变，很难排查。
    2. 【幂等】Release 已存在就复用，附件已存在就视为成功。
       重复跑本脚本不会产生重复发行版（Gitee 对同名附件会返回 400）。
    3. 【双通道】上传附件时 access_token 同时放在 query 与 form field。
       Gitee 官方 swagger 标注 access_token 属 formData，但社区示例多用 query，
       两条都带上可避免因接口细节差异导致上传失败。
    4. 绝不硬编码仓库地址 —— owner/repo 从 .gitee-url.bak 解析，
       用户改过仓库名之后脚本仍然可用。
    5. 【硬性】另提供两个「只读体检」模式，给 publish.sh 当闸门用：
         --preflight  推送前探测接口。不通过就中止，避免留下
                      「标签已推、发行版没建」的半发布状态 ——
                      那种状态下商家拿不到下载链接，而且（26.10.10.7 之前）
                      扩展的检测只读 /releases/latest，看不见纯标签版本，
                      会一直显示旧版本。
         --audit      发布后核对本版标签是否有配套发行版，没有就报错，
                      并列出所有「有标签没发行版」的历史版本。
    6. 附件下载链接必须是 releases/download/… 直下形式，不给发行版页面链接。

用法
    python scripts/gitee-release.py                # 自动读 manifest 版本 + 自动找 dist 包
    python scripts/gitee-release.py --dry-run      # 只做本地校验，不发任何网络请求
    python scripts/gitee-release.py --preflight    # 推送前探活：接口通不通，没通就别推标签
    python scripts/gitee-release.py --audit        # 发布后核对：本版标签是否有配套发行版
    python scripts/gitee-release.py --notes R.md   # 用指定文件作为发行版说明
    python scripts/gitee-release.py --commitish main

    --preflight 与 --audit 都只读、不写任何远端内容，退出码即结论（0 通过 / 1 不通过）。
    publish.sh 把这两个模式当闸门用：preflight 在推送前、audit 在发布后。
"""

import argparse
import io
import json
import os
import re
import shutil
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
import zipfile

# 允许在 cmd / git bash 里正常打印中文
try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
PARENT = os.path.dirname(ROOT)

DIST_DIR = os.path.join(PARENT, "DY-COCO-dist")
URL_BAK = os.path.join(ROOT, ".gitee-url.bak")
TOKEN_FILE = os.path.join(PARENT, ".dyc-gitee-token")
NOTES_FILE = os.path.join(ROOT, "RELEASE_NOTES.md")

API = "https://gitee.com/api/v5"

VER_RE = re.compile(r"^[0-9]{1,2}\.[0-9]{1,2}\.[0-9]{1,2}\.[0-9]{1,3}$")


# ---------------------------------------------------------------- 基础工具

def _find_git():
    """定位 git：优先 PATH，其次本机 PortableGit（版本目录会随升级变化，不做硬编码）。

    2026-10-14 修：原先把 versions/1.2.0 写死，PortableGit 升到 1.3.0 后失效。
    """
    found = shutil.which("git")
    if found:
        return found
    import glob
    cands = glob.glob(
        r"C:/Users/79412/.workbuddy/binaries/PortableGit/versions/*/cmd/git.exe")
    if not cands:
        return "git"
    def _key(p):
        nums = re.findall(r"\d+", p.replace("\\", "/").split("versions/")[-1])
        return [int(x) for x in nums]
    return sorted(cands, key=_key)[-1]


def run_git(args, cwd=ROOT):
    """调用 git，失败返回空串（调用方自行兜底，不要让脚本因 git 缺失而崩）。"""
    git = _find_git()
    if not os.path.exists(git) and not shutil.which("git"):
        return ""
    try:
        r = subprocess.run([git] + args, cwd=cwd, capture_output=True, timeout=30)
        return r.stdout.decode("utf-8", "replace").strip()
    except Exception:
        return ""


def request(url, method="GET", data=None, headers=None, timeout=90):
    """统一请求封装：返回 (状态码, 响应字节)。HTTP 错误不抛异常，交给调用方判断。"""
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("User-Agent", "DY-COCO-release/1.0")
    for k, v in (headers or {}).items():
        req.add_header(k, v)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, r.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()
    except Exception as e:
        return 0, str(e).encode("utf-8", "replace")


def as_json(raw):
    try:
        return json.loads(raw.decode("utf-8", "replace"))
    except Exception:
        return None


def api_get(path, params=None):
    url = API + path
    if params:
        url += "?" + urllib.parse.urlencode(params)
    code, raw = request(url)
    return code, as_json(raw), raw


def api_form(path, fields, method="POST", params=None):
    """application/x-www-form-urlencoded 的表单请求（创建 / 更新发行版用）。"""
    url = API + path
    if params:
        url += "?" + urllib.parse.urlencode(params)
    data = urllib.parse.urlencode(fields).encode("utf-8")
    code, raw = request(url, method=method, data=data,
                        headers={"Content-Type": "application/x-www-form-urlencoded"})
    return code, as_json(raw), raw


def build_multipart(fields, files):
    """手工构造 multipart/form-data。files: [(字段名, 文件名, 字节, MIME)]"""
    boundary = "----DYCFormBoundary" + uuid.uuid4().hex
    out = io.BytesIO()
    for name, value in fields:
        out.write(("--%s\r\n" % boundary).encode())
        out.write(('Content-Disposition: form-data; name="%s"\r\n\r\n' % name).encode("utf-8"))
        out.write(str(value).encode("utf-8"))
        out.write(b"\r\n")
    for name, filename, blob, mime in files:
        out.write(("--%s\r\n" % boundary).encode())
        out.write(('Content-Disposition: form-data; name="%s"; filename="%s"\r\n'
                   % (name, filename)).encode("utf-8"))
        out.write(("Content-Type: %s\r\n\r\n" % mime).encode())
        out.write(blob)
        out.write(b"\r\n")
    out.write(("--%s--\r\n" % boundary).encode())
    return out.getvalue(), "multipart/form-data; boundary=%s" % boundary


# ---------------------------------------------------------------- 本地信息

def read_local_version():
    p = os.path.join(ROOT, "manifest.json")
    with io.open(p, encoding="utf-8") as f:
        return str(json.load(f).get("version", "")).strip()


def parse_repo():
    """从 .gitee-url.bak 解析 (owner, repo)。改仓库名后脚本依然正确。"""
    if not os.path.exists(URL_BAK):
        return None, None
    with io.open(URL_BAK, encoding="utf-8") as f:
        url = f.read().strip()
    m = re.search(r"gitee\.com[/:]([^/]+)/([^/]+?)(?:\.git)?/?$", url)
    if not m:
        return None, None
    return m.group(1), m.group(2)


def read_token():
    tok = os.environ.get("GITEE_TOKEN", "").strip()
    if tok:
        return tok, "环境变量 GITEE_TOKEN"
    if os.path.exists(TOKEN_FILE):
        with io.open(TOKEN_FILE, encoding="utf-8") as f:
            tok = f.read().strip()
        if tok:
            return tok, TOKEN_FILE
    return "", ""


def zip_version(zip_path):
    """读 zip 内 manifest.json 的版本号，用于校验传的是不是当前版本。"""
    try:
        with zipfile.ZipFile(zip_path) as z:
            with z.open("manifest.json") as f:
                return str(json.loads(f.read().decode("utf-8")).get("version", "")).strip()
    except Exception as e:
        return "ERROR:" + str(e)


def build_notes(version, notes_file):
    """发行版说明：优先用 RELEASE_NOTES.md，否则用 git 提交记录自动生成。"""
    if notes_file and os.path.exists(notes_file):
        with io.open(notes_file, encoding="utf-8") as f:
            text = f.read().strip()
        if text:
            return text

    lines = ["## 抖音可可助手 %s" % version, ""]

    prev = run_git(["describe", "--tags", "--abbrev=0"])
    if prev and prev != ("v" + version):
        lines.append("### 相对 %s 的变更" % prev)
        log = run_git(["log", "--pretty=- %s", "--no-merges", "%s..HEAD" % prev])
        if log:
            lines.extend(log.splitlines())
        else:
            lines.append("- （无提交记录）")
    else:
        log = run_git(["log", "--pretty=- %s", "-10"])
        if log:
            lines.append("### 提交记录")
            lines.extend(log.splitlines())

    lines += [
        "",
        "### 安装",
        "1. 下载下面的 `DY-COCO-v%s.zip` 并解压到固定文件夹（推荐 `C:\\DY-COCO`）" % version,
        "2. 双击解压出来的 `!安装助手.bat`",
        "3. 按提示在浏览器扩展页点「加载已解压的扩展程序」",
        "",
        "> 已装过旧版的用户不用重新下载：扩展里点图标 → 弹窗底部「检查更新」即可自动升级。",
    ]
    return "\n".join(lines)


# ---------------------------------------------------------------- 网络动作

def find_release(owner, repo, tag, token):
    """按 tag 查发行版。Gitee 在不存在时返回 200 + null，要一并处理。"""
    code, obj, raw = api_get("/repos/%s/%s/releases/tags/%s" % (owner, repo, tag),
                             {"access_token": token})
    if code == 200 and isinstance(obj, dict) and obj.get("id"):
        return obj
    return None


def create_release(owner, repo, tag, name, body, commitish, token):
    fields = [
        ("access_token", token),
        ("tag_name", tag),
        ("name", name),
        ("body", body),
        ("target_commitish", commitish),
        ("prerelease", "false"),
    ]
    code, obj, raw = api_form("/repos/%s/%s/releases" % (owner, repo), fields)
    if code in (200, 201) and isinstance(obj, dict):
        return obj
    print("[中止] 创建发行版失败（HTTP %s）" % code)
    print("       返回：" + raw.decode("utf-8", "replace")[:400])
    return None


def update_release(owner, repo, release_id, name, body, token):
    """已存在的发行版：刷新标题与说明，让「改了说明重跑」能生效。
    Gitee 的 PATCH 支持程度不稳定，失败只警告、不阻断附件上传。"""
    fields = [("access_token", token), ("name", name), ("body", body)]
    code, obj, raw = api_form("/repos/%s/%s/releases/%s" % (owner, repo, release_id),
                              fields, method="PATCH")
    return code in (200, 201), code


def list_assets(owner, repo, release_id, token):
    """列出发行版附件 —— **必须带令牌**。

    【为什么强制带令牌】不带令牌走的是匿名接口，额度极小（约 60 次/小时，
       且按出口 IP 计）。本机实测在这一步撞上
       「403 Forbidden (Rate Limit Exceeded)」，被下面的 `return []` 吞成
       「附件一个都没有」，于是 --audit 在附件**明明传成功**时误报
       「商家按直下链接会 404」。2026-10-11 发布 26.10.10.8 时踩到，
       详见 AGENTS.md 踩坑记录。
       带令牌后额度是 5000 次/小时，不会撞限流。
    """
    code, obj, raw = api_get("/repos/%s/%s/releases/%s/attach_files"
                             % (owner, repo, release_id),
                             {"access_token": token})
    if code == 200 and isinstance(obj, list):
        return obj
    return []


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    """禁止自动跟随 302 —— 判据是「首跳」的状态码。"""
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def probe_download(owner, repo, tag, filename, timeout=30):
    """探测商家「直下链接」是否真的能下载。返回 (可用?, 说明文字)。

    【为什么用它当权威判据，而不是 API 附件列表】
      · 它验的正是最终结果 —— 商家点开链接到底能不能拿到文件；
      · 它不占 API 额度（走 gitee.com 普通路由，不是 /api/v5），
        不会像附件列表那样被匿名限流误伤；
      · 实测（2026-10-11）：附件在 → 首跳 302 到
          …/attach_files/<id>/download/<文件名>
        附件不在（含「发行版在但文件名写错」）→ 直接 404 + application/json。
    """
    url = "https://gitee.com/%s/%s/releases/download/%s/%s" % (
        owner, repo, tag, filename)
    req = urllib.request.Request(url, method="HEAD")
    req.add_header("User-Agent", "DY-COCO-release/1.0")
    opener = urllib.request.build_opener(_NoRedirect)
    try:
        with opener.open(req, timeout=timeout) as r:
            code = r.status
            loc = r.headers.get("Location", "") or ""
    except urllib.error.HTTPError as e:
        code = e.code
        loc = (e.headers.get("Location", "") if e.headers else "") or ""
    except Exception as e:
        return False, "探测异常：%s" % e
    if code == 302 and "attach_files" in loc:
        return True, "HTTP 302 → %s" % loc.split("?")[0]
    if code == 200:
        return True, "HTTP 200"
    return False, "HTTP %s（附件不可下载）" % code


# ---------------------------------------------------------------- 体检动作

def collect_version_tags(owner, repo, token):
    """远端全部版本标签（vYY.MM.DD.N 形式），按接口返回顺序。读不到返回 None。"""
    code, obj, raw = api_get("/repos/%s/%s/tags" % (owner, repo),
                             {"access_token": token, "per_page": 100})
    if code != 200 or not isinstance(obj, list):
        return None
    out = []
    for t in obj:
        if not isinstance(t, dict):
            continue
        name = str(t.get("name", "")).strip()
        if VER_RE.match(name.lstrip("v")):
            out.append(name)
    return out


def collect_release_tags(owner, repo, token):
    """远端全部发行版对应的标签名。读不到返回 None。"""
    code, obj, raw = api_get("/repos/%s/%s/releases" % (owner, repo),
                             {"access_token": token, "per_page": 100})
    if code != 200 or not isinstance(obj, list):
        return None
    return [str(r.get("tag_name", "")).strip()
            for r in obj if isinstance(r, dict)]


def do_preflight(owner, repo, token):
    """推送前的接口探活 —— 只读，不写任何内容。

    【为什么必须有它】
      发布是「先推标签、最后建发行版」两步。如果令牌失效或接口被限流，
      标签已经推上去了、发行版却没建成 —— 这就是「半发布」状态：
        · 商家拿不到下载链接（分发包只在发行版附件里）；
        · 26.10.10.7 之前，扩展的检测只读 /releases/latest（只看发行版），
          根本看不见这个新版本，真机表现是「检查更新像在读旧缓存」。
      所以必须在推送**之前**把接口探通 —— 不通就中止，绝不进入半发布。
    """
    print()
    print("----- preflight：探测 Gitee 接口（只读，不写任何内容）-----")
    code, obj, raw = api_get("/repos/%s/%s/releases" % (owner, repo),
                             {"access_token": token, "per_page": 1})
    if code == 200 and isinstance(obj, list):
        print("[OK] 发行版接口可用（HTTP 200，返回 %d 条）" % len(obj))
        return 0
    print("[中止] 发行版接口不可用（HTTP %s）。" % code)
    print("       返回：%s" % raw.decode("utf-8", "replace")[:300])
    if code in (401, 403):
        print("       多半是令牌失效、权限不足，或接口被限流。")
    print("       先解决再发布 —— 否则会留下「标签已推、发行版没建」的半发布状态。")
    return 1


def do_audit(version, tag, owner, repo, token):
    """核对「远端标签」与「发行版」是否配套。只读，退出码即结论。

    背景：Gitee 上 git 标签与发行版是两样东西，只推标签不会有下载链接。
    """
    print()
    print("----- audit：标签与发行版对照 -----")
    tags = collect_version_tags(owner, repo, token)
    if tags is None:
        print("[中止] 读取远端标签列表失败（令牌或接口异常）")
        return 1
    rels = collect_release_tags(owner, repo, token)
    if rels is None:
        print("[中止] 读取远端发行版列表失败（令牌或接口异常）")
        return 1

    missing = [t for t in tags if t not in rels]
    print("远端版本标签 %d 个，其中配套发行版的 %d 个" % (len(tags), len(tags) - len(missing)))
    for t in tags:
        print("   %-16s %s" % (t, "有发行版" if t in rels else "缺发行版"))
    if missing:
        print()
        print("[注意] 以下标签没有发行版，商家拿不到下载链接：%s" % "、".join(missing))
        print("       历史遗留可以不管；本次发布要是落在里面，必须补建（重跑本脚本）。")

    if tag not in tags:
        print()
        print("[中止] 远端没有标签 %s —— 标签没推成功。" % tag)
        return 1
    if tag in missing:
        print()
        print("[中止] 标签 %s 没有对应发行版，商家拿不到下载链接。" % tag)
        print("       补建：GITEE_TOKEN=... python scripts/gitee-release.py")
        return 1

    # 光有发行版还不够 —— 商家真正下载的是**附件**，所以再核一遍。
    # 判据用「直下链接探测」而不是 API 附件列表：
    #   · 附件列表接口不带令牌会被匿名限流误伤（2026-10-11 就是这么误报的）；
    #   · 直下链接探测验的正是「商家点开能不能下载」这个最终结果，
    #     而且不占 API 额度。API 列表只作补充信息打印。
    want = "DY-COCO-%s.zip" % tag
    url = "https://gitee.com/%s/%s/releases/download/%s/%s" % (owner, repo, tag, want)
    ok, detail = probe_download(owner, repo, tag, want)

    rel = find_release(owner, repo, tag, token)
    names = [a.get("name") or a.get("attach_file_name")
             for a in list_assets(owner, repo, rel.get("id"), token)] if rel else []
    print("       附件列表（接口）：%s" % (names or "读不到，以直下链接探测为准"))

    if not ok:
        print()
        print("[中止] 发行版 %s 的附件探测未通过：%s" % (tag, detail))
        print("       地址：%s" % url)
        print("       商家按直下链接会 404。重跑本脚本即可补传（幂等）。")
        return 1
    print()
    print("[OK] 本版标签、发行版、附件三者都在，商家直下链接实测可下载：")
    print("     %s" % url)
    print("     %s" % detail)
    return 0


def upload_asset(owner, repo, release_id, zip_path, token):
    """上传附件。token 同时放 query 与 form field，规避接口细节差异。"""
    filename = os.path.basename(zip_path)
    with open(zip_path, "rb") as f:
        blob = f.read()

    body, ctype = build_multipart(
        [("access_token", token)],
        [("file", filename, blob, "application/zip")],
    )
    url = "%s/repos/%s/%s/releases/%s/attach_files?access_token=%s" % (
        API, owner, repo, release_id, urllib.parse.quote(token))
    code, raw = request(url, method="POST", data=body, headers={"Content-Type": ctype})

    if code in (200, 201):
        return True, raw.decode("utf-8", "replace")

    text = raw.decode("utf-8", "replace")
    low = text.lower()
    # Gitee 对同名附件返回 400，此时视为已存在（幂等）
    if code == 400 and any(k in low for k in ("exist", "already", "重复", "已存在")):
        return True, "已存在"
    return False, "HTTP %s %s" % (code, text[:300])


# ---------------------------------------------------------------- 主流程

def main():
    ap = argparse.ArgumentParser(add_help=True)
    ap.add_argument("--dry-run", action="store_true", help="只做本地校验，不发网络请求")
    ap.add_argument("--preflight", action="store_true",
                    help="只探测 Gitee 接口是否可用（推送前的闸门，不写任何内容）")
    ap.add_argument("--audit", action="store_true",
                    help="只核对远端「标签 vs 发行版」是否配套（发布后的闸门）")
    ap.add_argument("--notes", default=None, help="发行版说明文件（默认用 RELEASE_NOTES.md）")
    ap.add_argument("--commitish", default=None, help="发行版指向的分支/提交（默认当前分支）")
    ap.add_argument("--token", default=None, help="直接指定令牌（优先级最高，仅调试用）")
    args = ap.parse_args()

    # --- 【硬性闸门】禁止创建发行版 ------------------------------------
    # 用户 2026-10-11 真机验收自更新通过后明确要求（最高优先级）：
    #   「之后无论如何都禁止再创建发行版。
    #     我叫你推送，你就只更新新的代码上去 gitee。」
    #
    # 依据：扩展的自更新链路（检测读 …/tags.atom、下载读 …/raw/<标签>/…）
    # 完全不依赖发行版；而 Gitee 会清理旧发行版（v26.10.10.3/.4/.5 在发布
    # .8 后不久即消失），继续维护发行版只会让发给商家的链接随时失效。
    #
    # 因此：**默认模式一律拒绝执行**。只读模式（--dry-run / --preflight /
    # --audit）不写任何远端内容，仍然放行。
    # 万一将来用户再次明确要求建发行版，用环境变量显式解锁：
    #     DYC_ALLOW_RELEASE=1 python scripts/gitee-release.py
    READONLY = args.dry_run or args.preflight or args.audit
    if not READONLY and os.environ.get("DYC_ALLOW_RELEASE") != "1":
        print("=" * 60)
        print(" [拒绝执行] 本仓库已禁止创建 Gitee 发行版")
        print("=" * 60)
        print()
        print("  用户 2026-10-11 明确要求（最高优先级）：")
        print("    「之后无论如何都禁止再创建发行版。")
        print("      我叫你推送，你就只更新新的代码上去 Gitee。」")
        print()
        print("  扩展自更新只需「主干 + 标签」，不依赖发行版。")
        print("  日常推送请用工程根目录的 publish.sh（只推主干与标签）。")
        print()
        print("  只读模式仍可用：--dry-run / --preflight / --audit")
        print("  若用户再次明确要求建发行版，用环境变量显式解锁：")
        print("      DYC_ALLOW_RELEASE=1 python scripts/gitee-release.py")
        print()
        return 1

    print("=" * 60)
    print(" 抖音可可助手 · Gitee 发行版发布")
    print("=" * 60)
    print()

    # --- 1. 版本号 ---
    version = read_local_version()
    if not VER_RE.match(version):
        print("[中止] manifest.json 版本号不合规：%r（应为 YY.MM.DD.N）" % version)
        return 1
    tag = "v" + version
    print("版本号   ：%s" % version)
    print("发布标签 ：%s" % tag)

    # --- 2. 仓库 ---
    owner, repo = parse_repo()
    if not owner:
        print("[中止] 无法从 %s 解析仓库地址" % URL_BAK)
        return 1
    print("仓库     ：%s/%s" % (owner, repo))

    # --- 2.5 体检模式：preflight / audit（都只读，不写任何远端内容）---
    # 这两个模式要令牌，所以放在这里、而不是像 dry-run 那样完全离线。
    if args.preflight or args.audit:
        if args.token:
            token, token_src = args.token.strip(), "命令行 --token"
        else:
            token, token_src = read_token()
        if not token:
            print()
            print("[中止] %s 需要 Gitee 私人令牌。"
                  % ("--preflight" if args.preflight else "--audit"))
            print("       获取：https://gitee.com/profile/personal_access_tokens")
            return 1
        print("令牌     ：已载入（来源：%s，长度 %d）" % (token_src, len(token)))
        if args.preflight:
            return do_preflight(owner, repo, token)
        return do_audit(version, tag, owner, repo, token)

    # --- 3. 分发包 ---
    zip_path = os.path.join(DIST_DIR, "DY-COCO-%s.zip" % tag)
    if not os.path.isfile(zip_path):
        print("[中止] 找不到分发包：%s" % zip_path)
        print("       请先运行：python scripts/make-dist.py")
        return 1
    size_kb = os.path.getsize(zip_path) / 1024.0
    print("分发包   ：%s（%.1f KB）" % (zip_path, size_kb))

    # 【硬性闸门】包内版本必须等于待发布版本
    inner = zip_version(zip_path)
    if inner != version:
        print("[中止] 分发包内 manifest 的版本是 %r，与待发布版本 %r 不一致。" % (inner, version))
        print("       多半是拿旧包当新版本发。请重新运行 scripts/make-dist.py。")
        return 1
    print("包内版本 ：%s  ✓ 与待发布版本一致" % inner)

    # --- 4. 分支与说明 ---
    commitish = args.commitish or run_git(["rev-parse", "--abbrev-ref", "HEAD"]) or "main"
    if commitish == "HEAD":
        commitish = "main"
    notes = build_notes(version, args.notes or NOTES_FILE)
    print("目标分支 ：%s" % commitish)
    print("说明字数 ：%d" % len(notes))

    download_url = "https://gitee.com/%s/%s/releases/download/%s/DY-COCO-%s.zip" % (
        owner, repo, tag, tag)
    page_url = "https://gitee.com/%s/%s/releases/tag/%s" % (owner, repo, tag)
    latest_url = "https://gitee.com/%s/%s/releases/latest" % (owner, repo)

    # dry-run 刻意放在令牌检查之前：没有令牌也能自查本地是否具备发布条件
    if args.dry_run:
        print()
        print("----- dry-run：本地校验全部通过，未发任何网络请求 -----")
        print("将创建发行版：%s" % tag)
        print("将上传附件  ：%s" % os.path.basename(zip_path))
        print("商家下载链接：%s" % download_url)
        print("发行版页面  ：%s  （仅人工浏览，别给商家）" % latest_url)
        return 0

    # --- 5. 令牌 ---
    token, token_src = "", ""
    if args.token:
        token, token_src = args.token.strip(), "命令行 --token"
    else:
        token, token_src = read_token()
    if not token:
        print()
        print("[中止] 未找到 Gitee 私人令牌。")
        print("       获取：https://gitee.com/profile/personal_access_tokens")
        print("             （勾选 projects 权限，仓库读写）")
        print("       配置二选一：")
        print("         ① 写入 %s （推荐，位于仓库之外）" % TOKEN_FILE)
        print("         ② 设置环境变量 GITEE_TOKEN")
        return 1
    print("令牌     ：已载入（来源：%s，长度 %d）" % (token_src, len(token)))

    print()
    print("=" * 60)

    # --- 6. 取或建发行版 ---
    rel = find_release(owner, repo, tag, token)
    if rel:
        release_id = rel.get("id")
        print("[1/3] 发行版 %s 已存在（id=%s），复用" % (tag, release_id))
        ok, code = update_release(owner, repo, release_id,
                                  "抖音可可助手 %s" % version, notes, token)
        print("      说明已刷新" if ok
              else "      （说明刷新失败 HTTP %s，沿用原说明，不影响附件）" % code)
    else:
        print("[1/3] 创建发行版 %s ..." % tag)
        rel = create_release(owner, repo, tag, "抖音可可助手 %s" % version,
                             notes, commitish, token)
        if not rel:
            return 1
        release_id = rel.get("id")
        print("      已创建（id=%s）" % release_id)

    # --- 7. 上传附件 ---
    existing = [a.get("name") or a.get("attach_file_name")
                for a in list_assets(owner, repo, release_id, token)]
    target = os.path.basename(zip_path)
    if target in existing:
        print("[2/3] 附件 %s 已存在，跳过上传" % target)
    else:
        print("[2/3] 上传附件 %s ..." % target)
        ok, msg = upload_asset(owner, repo, release_id, zip_path, token)
        if not ok:
            print("[中止] 上传失败：%s" % msg)
            return 1
        print("      上传成功" if msg != "已存在" else "      服务端已存在同名附件")

    # --- 8. 复核 ---
    # 判据用「直下链接探测」，不用 API 附件列表：
    # 上传刚完成时附件列表接口可能还没刷新，且它不带令牌会被匿名限流误伤
    # （2026-10-11 就是它误报「附件不在」）。直下链接探测验的是最终结果，
    # 且不占 API 额度。
    ok, detail = probe_download(owner, repo, tag, target)
    if ok:
        print("[3/3] 复核通过：直下链接实测可下载（%s）" % detail)
    else:
        print("[警告] 直下链接探测未通过：%s" % detail)
        print("       地址：%s" % download_url)
        print("       若确有异常，重跑本脚本即可补传（幂等）。")

    print()
    print("=" * 60)
    print(" 完成")
    print("=" * 60)
    print("发行版页面    ：%s" % page_url)
    print("★ 发给商家这条：%s" % download_url)
    print()
    print("提示：发给商家一律用上面的**直下链接**，点开就开始下载，不会有歧义。")
    print("      不要把发行版页面链接给商家 —— 页面上还挂着两个 Gitee 自动生成的")
    print("      源码包（%s.zip / %s.tar.gz），名字和我们的包极像，商家会点错。"
          % (tag, tag))
    return 0


if __name__ == "__main__":
    sys.exit(main())
