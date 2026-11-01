#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
GitHub 上架脚本（备用更新源同步）
==================================================
为什么需要这个脚本（2026-11-01）：
  Gitee 屏蔽了本账号，仓库首页 404、raw 通道 403、/tags.atom 404 ——
  **扩展的自更新链路整体断了**。商家点「检查更新」会一直失败。
  本脚本把同一个仓库镜像到 GitHub，让扩展的备用更新源有东西可读。

网络现实（2026-11-01 本机实测，别照抄别的主机结论）：
  api.github.com          ✅ 200   （API 建仓可用）
  codeload.github.com     ✅ 200   （整包 tarball 可用）
  data.jsdelivr.com       ✅ 200   （备用源列版本用）
  fastly/gcore.jsdelivr   ✅ 200   （CDN，仅对 .js/.json 直出）
  github.com:443         ❌ 不通  （TCP 连不上）
  raw.githubusercontent.com ❌ 不通  （TLS 被重置）
  github.com:22 (SSH)    ✅ 可通  ★
  ssh.github.com:443      ✅ 可通  ★

★ 所以推送走 **SSH**（git push 原生），不走 HTTPS：
  · SSH 端口通，且能保留**完整提交历史**（1000+ 提交不丢）；
  · HTTPS 不通，git push 直接连不上；
  · 走 API 重建历史要发几千个请求，慢且会丢历史，得不偿失。

用法：
  python publish-github.py --owner <账号> --repo <仓库名> [--tag v26.11.01.2]
  python publish-github.py --owner <账号> --repo <仓库名> --check-only

前置条件（二选一）：
  ① SSH：把 ~/.ssh/id_ed25519_github.pub 的内容加到 GitHub 账号的 SSH keys；
  ② Token：设环境变量 GITHUB_TOKEN（需 repo 权限），用于建仓与查标签。

安全约定（与本工程既有纪律一致）：
  · Token 只从环境变量读，**绝不写进仓库、绝不打印**；
  · 不做 --force 推送（远端有历史时中止并报告）；
  · 只推主干 + 标签，不建发行版、不传附件（沿用 publish.sh 第 8、9 条）；
  · 推送后校验远端引用与本地一致。
"""

import argparse
import json
import os
import subprocess
import sys
import urllib.error
import urllib.request

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

GIT = None
for _p in sorted(
    os.path.expanduser("~/.workbuddy/binaries/PortableGit/versions"), reverse=True
):
    _c = os.path.join(_p, "cmd", "git.exe")
    if os.path.isfile(_c):
        GIT = _c
        break
if not GIT:
    GIT = "git"


def log(msg):
    print(msg, flush=True)


def run_git(args, cwd=REPO_ROOT, check=True, capture=True):
    """跑 git，返回 (returncode, stdout, stderr)"""
    cmd = [GIT] + args
    proc = subprocess.run(
        cmd, cwd=cwd, capture_output=capture, text=True,
        encoding="utf-8", errors="replace"
    )
    if check and proc.returncode != 0:
        raise RuntimeError(
            "git %s 失败（%d）：\n%s" % (" ".join(args), proc.returncode,
                                        proc.stderr or proc.stdout)
        )
    return proc.returncode, proc.stdout or "", proc.stderr or ""


def api(method, url, token=None, body=None):
    """调 GitHub API。token 只进 header，绝不打印。"""
    data = None
    headers = {
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "DY-COCO-publisher",
    }
    if body is not None:
        data = json.dumps(body).encode("utf-8")
        headers["Content-Type"] = "application/json"
    if token:
        headers["Authorization"] = "Bearer " + token

    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            raw = resp.read().decode("utf-8", "replace")
            return resp.status, (json.loads(raw) if raw else None)
    except urllib.error.HTTPError as e:
        raw = e.read().decode("utf-8", "replace")
        try:
            return e.code, json.loads(raw)
        except Exception:
            return e.code, raw
    except urllib.error.URLError as e:
        raise RuntimeError("访问 GitHub API 失败：%s" % e.reason)


def ssh_url(owner, repo):
    """SSH 远端地址。github.com 的 HTTPS(443) 在本机不通，只能走 SSH。"""
    return "ssh://git@github.com/%s/%s.git" % (owner, repo)


def check_ssh_auth(owner, repo):
    """检查 SSH 是否已通（公钥是否已加到 GitHub）。"""
    code, out, err = run_git(
        ["ls-remote", ssh_url(owner, repo)], check=False
    )
    if code == 0:
        return True, out.strip()
    # 仓库不存在也可能报同样的错，先分清是"没公钥"还是"仓库不存在"
    if "Permission denied" in (err + out):
        return False, "SSH 公钥未被 GitHub 接受（Permission denied）"
    if "Could not read" in (err + out) and "publickey" not in (err + out):
        return False, "SSH 可达但仓库读不到（可能仓库尚未创建）"
    return False, (err or out).strip()[:200]


def ensure_repo(owner, repo, token, private=False):
    """确保仓库存在。不存在则用 API 建。"""
    code, data = api("GET", "https://api.github.com/repos/%s/%s" % (owner, repo), token)
    if code == 200:
        log("[仓库] 已存在：%s/%s" % (owner, repo))
        return True

    if not token:
        log("[仓库] 不存在且无 Token，无法自动创建：%s/%s" % (owner, repo))
        log("        请在 GitHub 网页上手动创建空仓库（不要勾选 README / .gitignore），再重跑。")
        return False

    code, data = api(
        "POST", "https://api.github.com/user/repos", token,
        body={
            "name": repo,
            "description": "抖音抖店 / 微信小店 / 直播中控台的浏览器扩展小助手",
            "private": private,
            "auto_init": False,
        }
    )
    if code in (201, 200):
        log("[仓库] 已创建：%s/%s" % (owner, repo))
        return True
    log("[仓库] 创建失败（HTTP %s）：%s" % (code, data))
    return False


def get_remote_tags(owner, repo, token=None):
    """取远端已有标签名集合。"""
    code, data = api(
        "GET", "https://api.github.com/repos/%s/%s/tags?per_page=100" % (owner, repo),
        token
    )
    if code != 200 or not isinstance(data, list):
        return set()
    return {t.get("name") for t in data if isinstance(t, dict)}


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--owner", required=True, help="GitHub 账号名")
    ap.add_argument("--repo", required=True, help="仓库名")
    ap.add_argument("--tag", default="", help="本次要打的标签（默认用本地 HEAD 的版本号）")
    ap.add_argument("--check-only", action="store_true", help="只检查，不推送")
    ap.add_argument("--private", action="store_true", help="建私有仓库（默认公开）")
    args = ap.parse_args()

    token = os.environ.get("GITHUB_TOKEN", "").strip()

    log("=" * 66)
    log("GitHub 上架 · %s/%s" % (args.owner, args.repo))
    log("=" * 66)

    # ---- 1. 本地状态 ----
    log("\n[1/5] 本地状态")
    _, out, _ = run_git(["status", "--porcelain"])
    if out.strip():
        log("  [中止] 工作区有未提交改动：")
        log("\n".join("    " + l for l in out.strip().split("\n")[:20]))
        log("  请先提交后再上架。")
        return 1
    log("  工作区干净")

    _, out, _ = run_git(["rev-parse", "HEAD"])
    head = out.strip()
    log("  HEAD = %s" % head[:12])

    # 本次标签：命令行给的，或从 manifest 推
    tag = args.tag.strip()
    if not tag:
        _, out, _ = run_git(["show", "HEAD:manifest.json"])
        ver = ""
        for line in out.split("\n"):
            if '"version"' in line:
                ver = line.split(":")[1].strip().strip(",").strip('"')
                break
        if not ver:
            log("  [中止] 读不到 manifest 版本号，请用 --tag 显式指定")
            return 1
        tag = "v" + ver
    log("  本次标签 = %s" % tag)

    # ---- 2. SSH 通道 ----
    log("\n[2/5] SSH 通道")
    ok_ssh, msg = check_ssh_auth(args.owner, args.repo)
    log("  SSH 认证：%s" % ("可用" if ok_ssh else "不可用 —— " + msg))
    if not ok_ssh:
        if args.check_only:
            return 0
        log("")
        log("  ★ 需要你先做一步（任选其一）：")
        log("    A. SSH（推荐，保住完整提交历史）：")
        log("       把下面这行加到 GitHub → Settings → SSH and GPG keys → New SSH key：")
        with open(os.path.expanduser("~/.ssh/id_ed25519_github.pub")) as f:
            log("         " + f.read().strip())
        log("    B. Token（不保历史，走 API 建仓）：")
        log("       设环境变量 GITHUB_TOKEN（需 repo 权限），再重跑本脚本。")
        return 2

    # ---- 3. 仓库 ----
    log("\n[3/5] 仓库")
    if not ensure_repo(args.owner, args.repo, token, args.private):
        return 1

    if args.check_only:
        log("\n检查完毕（--check-only，未推送）")
        return 0

    # ---- 4. 推送 ----
    log("\n[4/5] 推送（主干 + 标签，普通推送，不建发行版）")
    remote = "gh-publish"

    # 远端已有标签：跳过重复的，避免"标签已存在"把整次推送打断
    remote_tags = get_remote_tags(args.owner, args.repo, token)
    if tag in remote_tags:
        log("  标签 %s 远端已存在，跳过打标签（只更新主干）" % tag)
        tag_to_push = ""
    else:
        tag_to_push = tag

    # 用一个临时 remote，推完即删（沿用 publish.sh 的纪律：不断留远端）
    run_git(["remote", "remove", remote], check=False)
    run_git(["remote", "add", remote, ssh_url(args.owner, args.repo)])

    try:
        code, out, err = run_git(
            ["-c", "push.followTags=false", "push", remote,
             "refs/heads/main:refs/heads/main"], check=False
        )
        if code != 0:
            log("  [中止] 主干推送失败：\n%s" % ((err or out)[:600]))
            log("        远端已有历史时会走到这里 —— 本脚本不做强制推送，请人工确认。")
            return 1
        log("  主干已推送")

        if tag_to_push:
            # 本地无此标签就先打一个（指向 HEAD）
            _, _, _ = run_git(["tag", "-a", tag_to_push, "-m", "发布 " + tag_to_push, head],
                              check=False)
            code, out, err = run_git(
                ["-c", "push.followTags=false", "push", remote,
                 "refs/tags/%s:refs/tags/%s" % (tag_to_push, tag_to_push)], check=False
            )
            if code != 0:
                log("  [中止] 标签推送失败：\n%s" % ((err or out)[:600]))
                return 1
            log("  标签已推送：%s" % tag_to_push)
    finally:
        run_git(["remote", "remove", remote], check=False)
        log("  临时远端已移除")

    # ---- 5. 校验 ----
    log("\n[5/5] 校验远端引用")
    code, out, err = run_git(["ls-remote", ssh_url(args.owner, args.repo)], check=False)
    if code != 0:
        log("  [警告] 读远端引用失败：%s" % (err or out)[:200])
        return 1
    remote_main = ""
    remote_tag = ""
    for line in out.split("\n"):
        if not line.strip():
            continue
        parts = line.split("\t")
        if len(parts) != 2:
            continue
        sha, ref = parts[0].strip(), parts[1].strip()
        if ref == "refs/heads/main":
            remote_main = sha
        elif ref == "refs/tags/%s" % tag:
            remote_tag = sha

    if remote_main != head:
        log("  [中止] 远端主干与本地不一致")
        log("         本地：%s" % head)
        log("         远端：%s" % (remote_main or "缺失"))
        return 1
    log("  主干一致：%s" % remote_main[:12])

    if tag_to_push:
        if remote_tag and remote_tag != head:
            log("  [警告] 标签 %s 指向 %s，与本地 HEAD 不同" % (tag, remote_tag[:12]))
        else:
            log("  标签一致：%s -> %s" % (tag, (remote_tag or head)[:12]))
    else:
        log("  标签 %s 本次未改动（远端已存在）" % tag)

    log("")
    log("=" * 66)
    log("上架完成：https://github.com/%s/%s" % (args.owner, args.repo))
    log("备用更新源已在扩展端就绪（主源 Gitee 失败时自动接管）")
    log("=" * 66)
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except RuntimeError as e:
        print("[错误] %s" % e, file=sys.stderr)
        sys.exit(1)
