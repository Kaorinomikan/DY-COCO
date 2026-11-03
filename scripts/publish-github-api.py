#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
GitHub 上架脚本 · API 通道
==================================================
背景：本机 `github.com:443` TCP 不通 → `git push`（HTTPS）连不上。
  SSH 22 端口通，但需要用户先把公钥加到 GitHub 账号。
  本脚本改走 **GitHub REST API 的 git data 接口**，不依赖 SSH。

★ 目标（按优先级，扩展只需要最后一件事成立）：
  ① 标签能读到正确内容 —— 扩展的备用更新源靠
     `api.github.com/repos/.../contents/<path>?ref=<tag>` 取文件，
     标签指错或内容不对 = 商家更新失败或拿到错版本。
  ② 提交历史完整 —— 便于浏览与追溯。
  ③ 标签完整 —— 商家可能从任意旧版本升级，缺标签就升不了那一档。

实现要点：
  · **blob 按内容去重**：同一份内容只建一次 blob（GitHub 侧也按 sha 复用），
    所以 N 个提交共享大部分文件，实际 blob 调用数远小于「文件数 × 提交数」。
  · **tree 用 base_tree 增量**：每个提交只提交「相对父提交变化的文件」，
    其余沿用父树 → 单次 tree 请求体小、请求数不变但更省带宽。
  · **commit 逐个重建**：作者名/邮箱/日期与本地一致。
  · **标签用 annotated tag**：保留发布日期与说明（57 个 annotated + 1 个轻量）。

Token 来源（按优先级）：
  1. 环境变量 GITHUB_TOKEN
  2. 文件 C:/Develop project/.dyc-github-token（工程外，不入仓库）

安全约定：Token 只从上述两处读，**绝不写进仓库、绝不打印**；不做强制推送；
只推主干 + 标签，不建发行版、不传附件。

用法：
  python publish-github-api.py --owner <账号> --repo <仓库名> [--tag v26.11.01.2]
  python publish-github-api.py --owner <账号> --repo <仓库名> --dry-run
  python publish-github-api.py --owner <账号> --repo <仓库名> --history 30 --skip-tags
"""

import argparse
import base64
import hashlib
import json
import os
import subprocess
import sys
import time
import urllib.error
import urllib.request

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TOKEN_FILE = r"C:\Develop project\.dyc-github-token"
API_ROOT = "https://api.github.com"


def find_git():
    base = os.path.expanduser("~/.workbuddy/binaries/PortableGit/versions")
    if os.path.isdir(base):
        for name in sorted(os.listdir(base), reverse=True):
            cand = os.path.join(base, name, "cmd", "git.exe")
            if os.path.isfile(cand):
                return cand
    return "git"


GIT = find_git()


def log(msg):
    print(msg, flush=True)


def load_token():
    tok = os.environ.get("GITHUB_TOKEN", "").strip()
    if tok:
        return tok
    if os.path.isfile(TOKEN_FILE):
        with open(TOKEN_FILE, "r", encoding="utf-8") as f:
            return f.read().strip()
    return ""


def git(args, check=True):
    proc = subprocess.run([GIT] + args, cwd=REPO_ROOT, capture_output=True,
                          text=True, encoding="utf-8", errors="replace")
    if check and proc.returncode != 0:
        raise RuntimeError("git %s 失败：%s"
                           % (" ".join(args), (proc.stderr or proc.stdout)[:400]))
    return proc.returncode, proc.stdout or "", proc.stderr or ""


class GitHub:
    def __init__(self, token, owner, repo):
        self.token = token
        self.owner = owner
        self.repo = repo
        self.base = "%s/repos/%s/%s" % (API_ROOT, owner, repo)
        self.calls = 0
        self.blob_by_sha = {}   # 本地 blob sha -> 远端 blob sha
        self.blob_by_content = {}  # 内容 sha1 -> 远端 blob sha

    def _req(self, method, url, body=None):
        data = None
        headers = {
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
            "User-Agent": "DY-COCO-publisher",
        }
        if body is not None:
            data = json.dumps(body).encode("utf-8")
            headers["Content-Type"] = "application/json"
        if self.token:
            headers["Authorization"] = "Bearer " + self.token

        self.calls += 1
        req = urllib.request.Request(url, data=data, headers=headers, method=method)
        last = None
        for attempt in range(5):
            try:
                with urllib.request.urlopen(req, timeout=90) as resp:
                    content = resp.read()
                    return json.loads(content) if content else None
            except urllib.error.HTTPError as e:
                payload = e.read().decode("utf-8", "replace")
                last = "%d：%s" % (e.code, payload[:200])
                low = payload.lower()
                if e.code == 429 or "rate limit" in low or "secondary rate" in low:
                    wait = 30 * (attempt + 1)
                    log("      [退避 %ds] 触发限流，重试中" % wait)
                    time.sleep(wait)
                    continue
                raise RuntimeError("GitHub API %s 返回 %s" % (method, last))
            except urllib.error.URLError as e:
                last = str(e.reason)
                if attempt < 4:
                    time.sleep(5)
                    continue
                raise RuntimeError("访问 GitHub API 失败：%s" % last)
        raise RuntimeError("GitHub API 重试耗尽：%s（%s）" % (method, last))

    # ---------- git data ----------

    def create_blob(self, local_sha, content_bytes):
        """本地 blob sha → 远端 blob sha（内容去重）"""
        if local_sha in self.blob_by_sha:
            return self.blob_by_sha[local_sha]
        content_sha = hashlib.sha1(
            ("blob %d\0" % len(content_bytes)).encode("ascii") + content_bytes
        ).hexdigest()
        if content_sha in self.blob_by_content:
            self.blob_by_sha[local_sha] = self.blob_by_content[content_sha]
            return self.blob_by_content[content_sha]
        data = self._req("POST", self.base + "/git/blobs", body={
            "content": base64.b64encode(content_bytes).decode("ascii"),
            "encoding": "base64",
        })
        self.blob_by_sha[local_sha] = data["sha"]
        self.blob_by_content[content_sha] = data["sha"]
        return data["sha"]

    def create_tree(self, base_tree, entries):
        body = {"tree": entries}
        if base_tree:
            body["base_tree"] = base_tree
        return self._req("POST", self.base + "/git/trees", body=body)["sha"]

    def create_commit(self, message, tree, parents, author):
        return self._req("POST", self.base + "/git/commits", body={
            "message": message, "tree": tree, "parents": parents, "author": author,
        })["sha"]

    def create_tag(self, name, message, commit_sha):
        return self._req("POST", self.base + "/git/tags", body={
            "tag": name, "message": message,
            "object": commit_sha, "type": "commit",
        })["sha"]

    def delete_ref(self, ref):
        """删引用（ref 形如 tags/v1.2.3 或 heads/main）。

        不存在时 GitHub 返回 422 —— 这不算错（本来就是要"确保没有"）。
        """
        try:
            self._req("DELETE", self.base + "/git/refs/" + ref)
            return True
        except RuntimeError as e:
            if "422" in str(e):
                return False
            raise

    def update_ref(self, ref, sha):
        self._req("PATCH", self.base + "/git/refs/" + ref,
                  body={"sha": sha, "force": False})

    def create_ref(self, ref, sha):
        self._req("POST", self.base + "/git/refs",
                  body={"ref": "refs/" + ref, "sha": sha})

    def get_ref(self, ref):
        try:
            return self._req("GET", self.base + "/git/refs/" + ref)["object"]["sha"]
        except RuntimeError:
            return None

    def list_tags(self):
        try:
            data = self._req("GET", self.base + "/tags?per_page=100")
            return [t.get("name") for t in data if isinstance(t, dict)]
        except RuntimeError:
            return []

    def repo_info(self):
        return self._req("GET", self.base)


def read_commit_meta(sha):
    """取提交的完整信息（标题 + 正文 + 作者 + 日期 + 父）"""
    _, out, _ = git(["log", "-1", "--format=%H%x1f%B%x1f%an%x1f%ae%x1f%aI%x1f%P", sha])
    parts = out.rstrip("\n").split("\x1f")
    if len(parts) < 6:
        raise RuntimeError("读提交信息失败：" + sha)
    return {
        "sha": parts[0],
        "message": parts[1],
        "author": {"name": parts[2], "email": parts[3], "date": parts[4]},
        "parents": parts[5].split() if parts[5].strip() else [],
    }


def commit_chain(limit):
    """最近 limit 个提交，从旧到新"""
    _, out, _ = git(["log", "--max-count=%d" % limit,
                     "--format=%H%x1f%an%x1f%ae%x1f%aI%x1f%P"])
    rows = []
    for line in out.strip().split("\n"):
        if not line.strip():
            continue
        p = line.split("\x1f")
        if len(p) < 5:
            continue
        rows.append({"sha": p[0], "an": p[1], "ae": p[2], "adate": p[3],
                     "parents": p[4].split() if p[4].strip() else []})
    rows.reverse()
    return rows


def changed_paths(sha):
    """该提交相对其第一父提交变化的文件（新增/修改/删除）"""
    _, out, _ = git(["diff-tree", "-r", "--no-commit-id", "--name-status",
                     "--root", sha])
    out_files, del_files = [], []
    for line in out.split("\n"):
        if not line.strip():
            continue
        parts = line.split("\t")
        status = parts[0][0]
        path = parts[-1]
        if status == "D":
            del_files.append(path)
        else:
            out_files.append(path)
    return out_files, del_files


def blob_sha_of(sha, path):
    _, out, _ = git(["rev-parse", "%s:%s" % (sha, path)])
    return out.strip()


def blob_content(sha):
    proc = subprocess.run([GIT, "cat-file", "blob", sha], cwd=REPO_ROOT,
                          capture_output=True)
    return proc.stdout



def all_files_at(commit_sha):
    """该提交的**全部**文件（相对路径, mode, blob sha）。"""
    _, out, _ = git(["ls-tree", "-r", "--full-tree", commit_sha])
    entries = []
    for line in out.split("\n"):
        if not line.strip():
            continue
        meta, path = line.split("\t", 1)
        mode, _type, blob_sha = meta.split()
        entries.append((path, mode, blob_sha))
    return entries


def find_bash():
    """找 bash.exe（计点.sh 要跑 bash）。

    PortableGit 自带 bash；先看 git 同目录的版本树，找不到再赌 PATH。
    """
    base = os.path.expanduser("~/.workbuddy/binaries/PortableGit/versions")
    if os.path.isdir(base):
        for name in sorted(os.listdir(base), reverse=True):
            for cand in (
                os.path.join(base, name, "bin", "bash.exe"),
                os.path.join(base, name, "usr", "bin", "bash.exe"),
            ):
                if os.path.isfile(cand):
                    return cand
    return "bash"


def run_main_preflight():
    """复用主发布通道的完整预演，避免 GitHub 通道另维护残缺闸门。

    publish.sh --dry-run 会跑：工作区 / 并行任务 / 版本 / 文档 / 文案 /
    manifest 顺序 / 实质更新 / SW 标记 / 更新清单 / 性能 / 全量自测 /
    敏感词 / 攒批门槛。全部通过才允许进入 API 上架。
    """
    script = os.path.join(REPO_ROOT, "publish.sh")
    log("\n[0/5] 主发布通道预演（与 Gitee 同一口径）")
    if not os.path.isfile(script):
        log("  [中止] 找不到 publish.sh —— 拒绝上架。")
        return False
    try:
        proc = subprocess.run(
            [find_bash(), script, "--dry-run"], cwd=REPO_ROOT,
            capture_output=True, text=True, encoding="utf-8", errors="replace",
        )
    except OSError as e:
        log("  [中止] 跑不了主发布预演：%s —— 拒绝上架。" % e)
        return False
    out = ((proc.stdout or "") + (proc.stderr or "")).strip()
    if out:
        tail = out.splitlines()[-30:]
        log("  " + "\n  ".join(tail))
    if proc.returncode != 0:
        log("  [中止] 主发布预演未通过，本次不上架（未调用任何写接口）。")
        return False
    log("  [✓] 主发布预演全部闸门通过")
    return True


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--owner", required=True)
    ap.add_argument("--repo", required=True)
    ap.add_argument("--tag", default="")
    ap.add_argument("--history", type=int, default=0,
                    help="重建多少个提交（0 = 全部）")
    ap.add_argument("--single", action="store_true",
                    help="单提交模式：只推当前快照一个提交（不推历史），"
                         "并只打本次版本的标签")
    ap.add_argument("--skip-tags", action="store_true")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--description", default="")
    ap.add_argument("--topics", default="")
    ap.add_argument("--homepage", default="")
    args = ap.parse_args()

    if not run_main_preflight():
        return 1

    token = load_token()
    if not token:
        log("[中止] 没有可用 Token。设置环境变量 GITHUB_TOKEN，"
            "或写入 %s" % TOKEN_FILE)
        return 1

    gh = GitHub(token, args.owner, args.repo)

    log("=" * 68)
    log("GitHub 上架（API 通道）· %s/%s" % (args.owner, args.repo))
    log("=" * 68)

    # ---- 1. 仓库信息 ----
    log("\n[1/5] 仓库信息")
    try:
        info = gh.repo_info()
    except RuntimeError as e:
        log("  [中止] 读仓库失败：%s" % e)
        return 1
    log("  仓库存在（public=%s, size=%s KB, description=%r）"
        % (not info.get("private"), info.get("size"), info.get("description")))

    patch = {}
    if args.description:
        patch["description"] = args.description
    elif not info.get("description"):
        patch["description"] = "抖音抖店 / 微信小店 / 直播中控台的浏览器扩展小助手"
    if args.homepage:
        patch["homepage"] = args.homepage
    if args.topics:
        patch["topics"] = [t.strip() for t in args.topics.split(",") if t.strip()]
    elif not info.get("topics"):
        patch["topics"] = ["chrome-extension", "douyin", "ecommerce",
                           "live-commerce", "manifest-v3"]
    if patch:
        if args.dry_run:
            log("  [预演] 将写入 %s" % json.dumps(patch, ensure_ascii=False))
        else:
            gh._req("PATCH", gh.base, body=patch)
            log("  已更新：%s" % json.dumps(patch, ensure_ascii=False))
    else:
        log("  仓库信息已完整")

    # ---- 2. 本地状态 ----
    log("\n[2/5] 本地状态")
    _, out, _ = git(["status", "--porcelain"])
    if out.strip():
        log("  [中止] 工作区有未提交改动，请先提交")
        return 1
    _, out, _ = git(["rev-parse", "HEAD"])
    head = out.strip()
    _, out, _ = git(["rev-list", "--count", "HEAD"])
    total = int(out.strip() or 0)
    log("  工作区干净；HEAD=%s；共 %d 个提交" % (head[:12], total))

    # 敏感词、计点、全量自测、文案与性能等已由 run_main_preflight 统一完成；
    # 这里不再保留第二套实现，避免两通道口径漂移。

    tag = args.tag.strip()
    if not tag:
        _, out, _ = git(["show", "HEAD:manifest.json"])
        ver = ""
        for line in out.split("\n"):
            if '"version"' in line:
                ver = line.split(":")[1].strip().strip(",").strip('"')
                break
        tag = ("v" + ver) if ver else ""

    # ---- 3. 远端现状 ----
    log("\n[3/5] 远端现状")
    remote_main = gh.get_ref("heads/main")
    remote_tags = set(gh.list_tags())
    log("  远端 main：%s" % (remote_main[:12] if remote_main else "（不存在）"))
    log("  远端标签：%d 个" % len(remote_tags))

    # ---- 4. 重建 ----
    if args.single:
        # ★ 单提交模式：只推**当前快照**一个提交，不带历史。
        #   理由（用户 2026-11-01 定 + 数据支持）：
        #     · 全历史里有 **71 个提交**的提交信息含敏感词（130 行），
        #       机器审核扫整个仓库 —— 推全历史等于把这些一起送审，
        #       而历史提交信息**无法自动改**（改写历史属禁用操作）。
        #     · 只推最新提交 = 送审内容最小、且全部可自动优化。
        #     · 扩展的更新机制只依赖**当前版本那个标签**下的文件
        #       （raw/<tag>/update-manifest.json + 清单里的文件），
        #       不依赖历史标签 ⇒ 单提交不影响商家更新。
        chain = commit_chain(1)
        log("\n[4/5] 单提交模式：只推当前快照（%s），不带历史" % chain[-1]["sha"][:8])
    else:
        limit = args.history if args.history > 0 else total
        chain = commit_chain(limit)
        log("\n[4/5] 重建提交（%d 个，%s..%s）"
            % (len(chain), chain[0]["sha"][:8], chain[-1]["sha"][:8]))

    if args.dry_run:
        log("  [预演] 估算：blob 去重后约 %d 次 + commit %d 次 + tree %d 次 + 标签若干"
            % (len(chain) * 2, len(chain), len(chain)))
        log("  [预演] 不推送")
        return 0

    # 本地提交 sha → 远端提交 sha
    sha_map = {}
    prev_tree = None
    prev_remote_commit = None

    for idx, c in enumerate(chain, 1):
        if args.single:
            # ★ 单提交模式：**完整树**（全部文件，不带 base_tree）。
            #   原因：通用分支取的是「相对父提交的变化」+ base_tree 增量，
            #   而单提交模式下父提交不在远端 ⇒ 建出来的树是残缺的。
            #   实测踩过：远端 main 的树里只有 1 个文件，
            #   标签下读 update-manifest.json 恒 404 ⇒ 商家更新直接失败。
            entries = []
            for path, mode, blob_sha in all_files_at(c["sha"]):
                content = blob_content(blob_sha)
                remote_blob = gh.create_blob(blob_sha, content)
                entries.append({"path": path, "mode": mode, "type": "blob",
                                "sha": remote_blob})
            tree = gh.create_tree(None, entries)
        else:
            out_files, del_files = changed_paths(c["sha"])
            entries = []
            for path in out_files:
                local_blob = blob_sha_of(c["sha"], path)
                content = blob_content(local_blob)
                remote_blob = gh.create_blob(local_blob, content)
                mode = "100755" if _is_executable(c["sha"], path) else "100644"
                entries.append({"path": path, "mode": mode, "type": "blob",
                                "sha": remote_blob})
            for path in del_files:
                entries.append({"path": path, "mode": "100644", "type": "blob",
                                "sha": "0000000000000000000000000000000000000000"})

            tree = gh.create_tree(prev_tree, entries)
        parent = prev_remote_commit
        if not parent and c["parents"]:
            # 父提交在本次重建范围外 → 用它的远端 sha（若远端已有）
            parent = sha_map.get(c["parents"][0]) or remote_main
            if not parent:
                parent = []
            else:
                parent = [parent]
        else:
            parent = [parent] if parent else []

        meta = read_commit_meta(c["sha"])
        remote_commit = gh.create_commit(meta["message"], tree, parent,
                                         meta["author"])
        sha_map[c["sha"]] = remote_commit
        prev_tree = tree
        prev_remote_commit = remote_commit

        if idx % 20 == 0 or idx == len(chain):
            log("  进度 %d/%d（API %d 次）" % (idx, len(chain), gh.calls))

    if prev_remote_commit:
        if remote_main:
            gh.update_ref("heads/main", prev_remote_commit)
        else:
            gh.create_ref("heads/main", prev_remote_commit)
        log("  主干已更新：main -> %s" % prev_remote_commit[:12])

    # ---- 5. 标签 ----
    if not args.skip_tags:
        log("\n[5/5] 标签")
        _, tag_list, _ = git(["for-each-ref", "--sort=-creatordate",
                              "--format=%(refname:short)%09%(objecttype)%09%(objectname)%09%(*objectname)%09%(taggername)%09%(taggeremail)%09%(taggerdate:iso-strict)%09%(contents:subject)",
                              "refs/tags"])
        todo = []
        skipped_tags = 0
        for line in tag_list.strip().split("\n"):
            if not line.strip():
                continue
            # ★ for-each-ref **不支持 %x1f**（它只认 %xx 形式的十六进制字节），
            #   实测会原样输出 "%x1f" 字面量 ⇒ 字段切不开 ⇒ 标签一个都收集不到。
            #   它支持 %09（制表符），所以这里用 \t 切。
            p = line.split("\t")
            if len(p) < 7:
                continue
            name, otype, obj, peeled, tagger, temail, tdate, subject = (
                p[0], p[1], p[2], p[3], p[4], p[5], p[6], p[7] if len(p) > 7 else "")
            if name in remote_tags:
                # ★ 单提交模式：本次版本的标签**已存在**时，要重建它。
                #   情况：远端标签是上一轮推的，指向**旧提交**（旧内容）。
                #   而扩展的备用更新源读的就是**标签**（contents/<path>?ref=<tag>）
                #   ⇒ 标签不重指，商家拿到的还是旧版本（哪怕 main 已经更新）。
                #   ⇒ 所以这里不跳过，标记为待重建，交给下面重建。
                if args.single and name == tag:
                    commit_sha = peeled if otype == "tag" else obj
                    todo.append((name, otype, commit_sha, tagger, temail,
                                 tdate, subject))
                continue
            # ★ 单提交模式：**只打本次版本的标签**。
            #   历史标签不推 —— 那些标签指向的历史提交内容没有推到远端，
            #   硬推过去的话，远端标签下的文件其实是当前代码，
            #   标签与内容对不上（比没有这个标签更糟：会误导人）。
            #   而扩展的更新机制只需要**当前版本**这一个标签。
            if args.single and name != tag:
                skipped_tags += 1
                continue
            commit_sha = peeled if otype == "tag" else obj
            todo.append((name, otype, commit_sha, tagger, temail, tdate, subject))

        log("  待建标签：%d 个（远端已有 %d 个跳过）" % (len(todo), len(remote_tags)))
        if args.single and skipped_tags:
            log("  单提交模式：跳过历史标签 %d 个（内容未推远端，不建）" % skipped_tags)
        for i, (name, otype, commit_sha, tagger, temail, tdate, subject) in enumerate(todo, 1):
            if args.single:
                # ★ 单提交模式：标签直接指向**本次新建的 commit**。
                #   原因：本地那个标签指向的历史 commit 在远端不存在
                #   （只推了一个快照），走通用分支会重建它的"相对父提交增量树"，
                #   而父提交不在远端 ⇒ 树是残缺的 ⇒ 标签下取不到更新清单。
                #   实测踩过：标签建出来了，但 contents API 读清单 404。
                #   当前快照的 commit 才是标签该指向的东西（内容 = 当前代码，正确）。
                target = prev_remote_commit
            else:
                target = sha_map.get(commit_sha)
            if not target:
                # 该标签的提交不在重建范围 → 单独重建那个提交的树
                out_files, del_files = changed_paths(commit_sha)
                entries = []
                for path in out_files:
                    lb = blob_sha_of(commit_sha, path)
                    rb = gh.create_blob(lb, blob_content(lb))
                    entries.append({"path": path, "mode": "100644", "type": "blob",
                                    "sha": rb})
                tree = gh.create_tree(None, entries)
                meta = read_commit_meta(commit_sha)
                target = gh.create_commit(meta["message"], tree, [], meta["author"])
                sha_map[commit_sha] = target
            if otype == "tag":
                t_sha = gh.create_tag(name, subject or ("发布 " + name), target)
                # 重建场景：旧引用还在时 POST 会 422，先删（不存在则忽略 422）。
                if gh.delete_ref("tags/" + name):
                    log("    已删旧引用 %s（重建）" % name)
                gh.create_ref("tags/" + name, t_sha)
            else:
                if gh.delete_ref("tags/" + name):
                    log("    已删旧引用 %s（重建）" % name)
                gh.create_ref("tags/" + name, target)
            if i % 10 == 0 or i == len(todo):
                log("  进度 %d/%d（API %d 次）" % (i, len(todo), gh.calls))
    # ---- 清 CDN 缓存（jsDelivr）----
    # ★ 为什么：jsDelivr 对 @tag 内容有缓存，且**同名标签重建后长期给旧内容**，
    #   实测 purge 接口也不立即生效。正常发布（版本号递增、标签永不重推）
    #   没这个问题（新标签 = 新 URL = 无缓存）；这里 purge 是尽力而为的加速，
    #   即使没刷干净，扩展端也有"CDN 内容长度不符 → 降级 API"的防御兜底。
    if args.single:
        log("\n[5.5/5] 清 jsDelivr CDN 缓存（尽力而为）")
        import json as _json
        try:
            mf = _json.load(open(os.path.join(REPO_ROOT, "update-manifest.json"),
                                 encoding="utf-8"))
            paths = [f["path"] for f in mf.get("files", [])]
            purged = 0
            for pp in paths:
                try:
                    urllib.request.urlopen(
                        "https://purge.jsdelivr.net/gh/%s/%s@%s/%s"
                        % (args.owner, args.repo, tag, pp), timeout=15).read()
                    purged += 1
                except Exception:
                    pass
            log("  purge 完成 %d/%d（失败忽略 —— 扩展端有长度防御兜底）"
                % (purged, len(paths)))
        except Exception as e:
            log("  [跳过] 读不到 update-manifest.json：%s" % e)

    # ---- 校验 ----
    log("\n校验")
    final_main = gh.get_ref("heads/main")
    ok_main = final_main == prev_remote_commit
    log("  远端 main = %s %s" % ((final_main or "缺失")[:12],
                                 "✓" if ok_main else "✗"))
    final_tags = set(gh.list_tags())
    if args.single:
        # 单提交模式：只要求本次版本的标签在（历史标签本就不推）
        miss = {tag} - final_tags
        log("  标签：远端 %d 个，本次版本 %s %s"
            % (len(final_tags), tag, ("✓ 在" if not miss else "✗ 缺失")))
        if miss:
            log("  [中止] 本次版本的标签没建成功 —— 商家会读不到更新清单")
            return 1
    else:
        local_tags = set()
        _, tl, _ = git(["tag", "-l"])
        local_tags = {t.strip() for t in tl.split("\n") if t.strip()}
        missing = local_tags - final_tags
        log("  标签：本地 %d / 远端 %d%s"
            % (len(local_tags), len(final_tags),
               ("，缺 " + ", ".join(sorted(missing))) if missing else "，全部齐备 ✓"))
    log("  本次 API 调用：%d 次" % gh.calls)

    log("")
    log("=" * 68)
    log("完成：https://github.com/%s/%s" % (args.owner, args.repo))
    log("=" * 68)
    tags_ok = (tag in final_tags) if args.single else (not missing)
    return 0 if ok_main and tags_ok else 1


def _is_executable(commit_sha, path):
    _, out, _ = git(["ls-tree", commit_sha, "--", path])
    return "100755" in out


if __name__ == "__main__":
    try:
        sys.exit(main())
    except RuntimeError as e:
        print("[错误] %s" % e, file=sys.stderr)
        sys.exit(1)
