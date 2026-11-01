#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
抖音可可助手（DY-COCO）· 终端用户分发包打包器

用途
    把一个"不懂电脑的商家"能直接用的 zip 打出来：解压后双击安装助手即可安装。
    只放运行必需的文件，开发文件（publish.sh / AGENTS.md / 开发日志.md /
    .git / .gitee-url.bak 等）一律不进包。

设计要点（改这个脚本前请先读）
    1. 【硬性】按 manifest.json 反查引用完整性。
       manifest 里引用的每个文件（图标、内容脚本、样式、弹窗、后台脚本）
       都必须实际存在且在包内，缺一个就直接报错中止。
       —— 历史上曾因 icons/ 未入库导致标签归档里没有图标，
          用户装完扩展直接加载失败。这道闸门就是为此设的。
    2. 【硬性】包内不留外层目录。解压后第一层必须直接是 manifest.json。
    3. 两个面向用户的文件在内存里生成，不落盘：
         !安装说明.txt   UTF-8 with BOM（老版记事本也能正确识别）
         !安装助手.bat   GBK + CRLF（cmd 默认代码页 936，中文才不乱码）
       文件名以 ! 开头是为了在资源管理器里排到最前面，用户一眼看到。
    4. zip 内非 ASCII 条目名按 GBK 写入且不设 UTF-8 标志位。
       Windows 资源管理器对不带该标志位的条目按本地代码页(936)解析，
       中文文件名才能正常显示。

用法
    python make-dist.py                    # 输出到 ../DY-COCO-dist/
    python make-dist.py --out D:\\somewhere
    python make-dist.py --root <仓库根>     # 默认取本脚本的上一级目录
"""

import argparse
import json
import os
import sys
import time
import zipfile

# 允许在 cmd 里正常打印中文
try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT_ROOT = os.path.dirname(HERE)

# 要打进包的文件 / 目录（相对仓库根）
ROOT_FILES = ["manifest.json", "LICENSE"]
DIRS = ["icons", "src"]

# 两个内存生成文件在 install/ 下的模板
TPL_NOTE = os.path.join("install", "安装说明.txt")
TPL_BAT = os.path.join("install", "安装助手.bat")

OUT_NOTE = "!安装说明.txt"
OUT_BAT = "!安装助手.bat"

PNG_MAGIC = b"\x89PNG\r\n\x1a\n"


class GbkZipInfo(zipfile.ZipInfo):
    """条目名按 GBK 编码写入，且不设 UTF-8 标志位（Windows 解压中文不乱码）。"""

    def _encodeFilenameFlags(self):
        try:
            return self.filename.encode("gbk"), self.flag_bits & ~0x800
        except UnicodeEncodeError:
            return super()._encodeFilenameFlags()


def fail(msg):
    print("[中止] " + msg)
    sys.exit(1)


def read_names(z):
    """读回 zip 条目名。

    我们自己写入时对非 ASCII 名用 GBK 编码且不设 UTF-8 标志位（为了 Windows
    资源管理器能正确解压），所以 Python 回读时会把无标志位的条目按 cp437
    解成 str。这里做对称还原，才能拿回原始中文名做校验。
    """
    names = []
    for info in z.infolist():
        name = info.filename
        if not (info.flag_bits & 0x800):
            try:
                name = name.encode("cp437").decode("gbk")
            except (UnicodeEncodeError, UnicodeDecodeError):
                pass
        names.append(name)
    return names


def collect_manifest_refs(manifest):
    """按 manifest 反查所有被引用的文件路径。"""
    refs = set()

    for v in (manifest.get("icons") or {}).values():
        refs.add(v)

    action = manifest.get("action") or {}
    for v in (action.get("default_icon") or {}).values():
        refs.add(v)
    if action.get("default_popup"):
        refs.add(action["default_popup"])

    bg = manifest.get("background") or {}
    if bg.get("service_worker"):
        refs.add(bg["service_worker"])
    for v in (bg.get("scripts") or []):
        refs.add(v)

    for cs in manifest.get("content_scripts") or []:
        refs.update(cs.get("js") or [])
        refs.update(cs.get("css") or [])

    # 只保留看起来像文件路径的（排除 matches 里的 URL 模式）
    return {r for r in refs if isinstance(r, str) and not r.startswith(("http", "*", "<"))}


def gather(root):
    """收集要打包的文件，返回 [(绝对路径, 包内相对路径)]，并做完整性校验。"""
    items = []

    manifest_path = os.path.join(root, "manifest.json")
    if not os.path.isfile(manifest_path):
        fail("找不到 manifest.json：%s" % manifest_path)

    try:
        with open(manifest_path, "r", encoding="utf-8") as f:
            manifest = json.load(f)
    except Exception as e:
        fail("manifest.json 解析失败：%s" % e)

    version = manifest.get("version")
    if not version:
        fail("manifest.json 里没有 version 字段")

    for name in ROOT_FILES:
        p = os.path.join(root, name)
        if not os.path.isfile(p):
            fail("缺少必需文件：%s" % name)
        items.append((p, name))

    for d in DIRS:
        base = os.path.join(root, d)
        if not os.path.isdir(base):
            fail("缺少必需目录：%s/" % d)
        for dirpath, _dirnames, filenames in os.walk(base):
            for fn in filenames:
                ap = os.path.join(dirpath, fn)
                items.append((ap, os.path.relpath(ap, root).replace(os.sep, "/")))

    # ---- 闸门一：manifest 引用的文件必须全部在包内 ----
    in_zip = {rel for _ap, rel in items}
    missing = sorted(collect_manifest_refs(manifest) - in_zip)
    if missing:
        fail(
            "manifest.json 引用了包内不存在的文件，装上去会直接加载失败：\n"
            + "\n".join("        - " + m for m in missing)
        )

    # ---- 闸门二：图标必须是真 PNG（不是文本误存成 .png）----
    for _ap, rel in items:
        if rel.lower().endswith(".png"):
            with open(_ap, "rb") as f:
                head = f.read(8)
            if head != PNG_MAGIC:
                fail("%s 不是有效的 PNG 文件（魔数校验失败）" % rel)

    return manifest, version, items


def build(root, out_dir):
    manifest, version, items = gather(root)

    if not os.path.isdir(out_dir):
        os.makedirs(out_dir, exist_ok=True)

    zip_name = "DY-COCO-v%s.zip" % version
    out_path = os.path.join(out_dir, zip_name)

    # ---- 读取两个面向用户文件的模板，转码 ----
    tpl_note = os.path.join(root, TPL_NOTE)
    tpl_bat = os.path.join(root, TPL_BAT)
    for p in (tpl_note, tpl_bat):
        if not os.path.isfile(p):
            fail("缺少安装材料模板：%s" % os.path.relpath(p, root))

    with open(tpl_note, "r", encoding="utf-8") as f:
        note_text = f.read()
    with open(tpl_bat, "r", encoding="utf-8") as f:
        bat_text = f.read()

    # 说明：UTF-8 with BOM，换行统一 CRLF
    note_bytes = note_text.replace("\r\n", "\n").replace("\n", "\r\n").encode("utf-8-sig")
    # 批处理：GBK + CRLF（cmd 默认代码页 936）
    bat_norm = bat_text.replace("\r\n", "\n").replace("\n", "\r\n")
    try:
        bat_bytes = bat_norm.encode("gbk")
    except UnicodeEncodeError as e:
        fail(
            "安装助手.bat 含有 GBK 无法表示的字符：%s\n"
            "        bat 会被 cmd 按本地代码页读取，只能用 GBK 能编的字符。\n"
            "        请把该字符换成普通中文或 ASCII 符号。" % e
        )

    now = time.localtime()[:6]

    if os.path.exists(out_path):
        os.remove(out_path)

    written = []
    with zipfile.ZipFile(out_path, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as z:
        for ap, rel in sorted(items, key=lambda x: x[1]):
            with open(ap, "rb") as f:
                data = f.read()
            zi = GbkZipInfo(rel, date_time=now)
            zi.compress_type = zipfile.ZIP_DEFLATED
            zi.external_attr = 0o644 << 16
            z.writestr(zi, data)
            written.append((rel, len(data)))

        for arcname, data in ((OUT_NOTE, note_bytes), (OUT_BAT, bat_bytes)):
            zi = GbkZipInfo(arcname, date_time=now)
            zi.compress_type = zipfile.ZIP_DEFLATED
            zi.external_attr = 0o644 << 16
            z.writestr(zi, data)
            written.append((arcname, len(data)))

    # ---- 回读校验 ----
    with zipfile.ZipFile(out_path) as z:
        names = read_names(z)
        bad = z.testzip()
        if bad:
            fail("压缩包内文件损坏：%s" % bad)

    # 不得有外层目录（每个条目名里不能出现顶层目录包裹所有文件的情况）
    tops = {n.split("/")[0] for n in names}
    if len(names) > 1 and len(tops) == 1 and "/" in names[0]:
        fail("包内出现了外层目录 %s/，解压后会多套一层，用户会选错文件夹" % names[0].split("/")[0])

    for need in ("manifest.json", OUT_NOTE, OUT_BAT):
        if need not in names:
            fail("压缩包缺少 %s" % need)

    for forbidden in (".git", "publish.sh", "AGENTS.md", "开发日志.md", "开发待办.md", ".gitee-url.bak",
                      "README.md", "RELEASE_NOTES.md", ".gitignore", "scripts", "install"):
        for n in names:
            if n == forbidden or n.startswith(forbidden + "/"):
                fail("开发文件混进了分发包：%s" % n)

    # 包内 manifest 版本必须与预期一致
    with zipfile.ZipFile(out_path) as z:
        inner = json.loads(z.read("manifest.json").decode("utf-8"))
    if inner.get("version") != version:
        fail("包内 manifest 版本 %s 与预期 %s 不一致" % (inner.get("version"), version))

    return out_path, version, written, os.path.getsize(out_path)


def main():
    ap = argparse.ArgumentParser(description="生成终端用户分发包")
    ap.add_argument("--root", default=DEFAULT_ROOT, help="仓库根目录")
    ap.add_argument(
        "--out",
        default=os.path.join(os.path.dirname(DEFAULT_ROOT), "DY-COCO-dist"),
        help="分发包输出目录（默认与仓库同级）",
    )
    args = ap.parse_args()

    root = os.path.abspath(args.root)
    out_dir = os.path.abspath(args.out)

    out_path, version, written, size = build(root, out_dir)

    print("分发包已生成")
    print("  版本    ：%s" % version)
    print("  文件数  ：%d" % len(written))
    print("  大小    ：%.1f KB" % (size / 1024.0))
    print("  输出    ：%s" % out_path)
    print("")
    print("  包内清单：")
    for rel, n in sorted(written):
        print("    %-42s %8.1f KB" % (rel, n / 1024.0))
    print("")
    print("  提醒：把这个 zip 发给商家即可。")
    print("        商家解压后双击 %s，按窗口提示操作。" % OUT_BAT)
    print("")

    return 0


if __name__ == "__main__":
    sys.exit(main())
