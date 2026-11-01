#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
按 id 拉取反馈原图（高清），全程不经过模型上下文。

用途：
  - A 通道（日报带高清附件）：自动化任务取图后作为邮件附件发出
  - C 通道（按需导出）：你说「要 21 的图」，跑这个脚本拿高清 jpg

用法：
  python "scripts/取反馈原图.py" 21
  python "scripts/取反馈原图.py" 18 19 21 --out "C:/some/dir"
  python "scripts/取反馈原图.py" 21 --index 1        # 只要第 1 张

密钥来源（按优先级）：
  1. 环境变量 DYC_SHOT_KEY
  2. 工程上级目录的 .dyc-shot-key 文件（默认 ../.dyc-shot-key）

输出：
  <out>/反馈<id>-图<N><真实扩展名>，并在 stdout 打印每个文件的格式、像素尺寸与大小

扩展名按**文件头魔数**判定（2026-10-15 修）：
  原先一律落 .jpg，而反馈里粘贴的图多为 **PNG**（浏览器截图粘贴的默认格式）
  ⇒ 扩展名与内容不符：严格按扩展名解析的程序会失败，脚本自报的尺寸也拿不到
  （jpeg_size 只看 JPEG 头，PNG 直接返回空 ⇒ 打印「尺寸未知」）。
  现在按魔数识别 PNG / JPEG / GIF / WebP（口径与 `生成反馈阅读页.py` 的 image_info() 一致），
  扩展名与尺寸解析都用真实格式（WebP 只认容器、不解析尺寸）；
  未识别的格式保持旧行为（落 .jpg、尺寸未知），不猜。
"""
import argparse
import base64
import json
import os
import struct
import sys
import urllib.request

RPC = "https://dycoco-feedback.app.workbuddy.host/.cloud/database/rest/rpc/dyc_shot"
ACCESS_KEY = "wbpk_TczgSmUCbUzky377FNk3Py_RxDXjaBU8BMDzAgt0Jo1f9AngmMn4f1n"
HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT_KEY_FILE = os.path.join(HERE, "..", "..", ".dyc-shot-key")


def read_key():
    key = os.environ.get("DYC_SHOT_KEY", "").strip()
    if key:
        return key
    path = os.environ.get("DYC_SHOT_KEY_FILE") or DEFAULT_KEY_FILE
    try:
        with open(path, "r", encoding="utf-8") as f:
            return f.read().strip()
    except OSError:
        sys.exit("找不到密钥：既没有 DYC_SHOT_KEY 环境变量，也没有 %s" % os.path.abspath(path))


def fetch(key, fid):
    body = json.dumps({"p_id": fid, "p_key": key}).encode("utf-8")
    req = urllib.request.Request(RPC, data=body, method="POST")
    req.add_header("content-type", "application/json")
    req.add_header("x-wb-webapp-access-key", ACCESS_KEY)
    with urllib.request.urlopen(req, timeout=60) as resp:
        return json.loads(resp.read().decode("utf-8"))


def strip_data_uri(value):
    if not value:
        return None
    if value.lstrip().startswith("data:") and "," in value:
        value = value.split(",", 1)[1]
    return value.strip() or None


def sniff_format(data):
    """按文件头魔数判断真实图片格式，返回 (扩展名, 格式名)。

    口径与 `生成反馈阅读页.py` 的 image_info() **完全一致**（同一套魔数、同一组扩展名）：
      · PNG   89 50 4E 47 0D 0A 1A 0A
      · JPEG  FF D8 FF
      · GIF   "GIF87a" / "GIF89a"
      · WebP  "RIFF" … "WEBP"（容器格式，尺寸不解析 ⇒ 由 image_size 返回 None）
    其余未识别的一律按旧行为落 .jpg（不猜）。
    """
    if data[:8] == b"\x89PNG\r\n\x1a\n":
        return ".png", "PNG"
    if data[:3] == b"\xff\xd8\xff":
        return ".jpg", "JPEG"
    if data[:6] in (b"GIF87a", b"GIF89a"):
        return ".gif", "GIF"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return ".webp", "WEBP"
    return ".jpg", "未知"


def jpeg_size(data):
    """从 JPEG 文件头解析像素尺寸（不依赖第三方库）。"""
    if data[:2] != b"\xff\xd8":
        return None
    i, n = 2, len(data)
    while i + 9 < n:
        if data[i] != 0xFF:
            i += 1
            continue
        marker = data[i + 1]
        if marker in (0xD8, 0xD9) or 0xD0 <= marker <= 0xD7:
            i += 2
            continue
        seg = struct.unpack(">H", data[i + 2:i + 4])[0]
        if marker in (0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6,
                      0xC7, 0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF):
            h = struct.unpack(">H", data[i + 5:i + 7])[0]
            w = struct.unpack(">H", data[i + 7:i + 9])[0]
            return w, h
        i += 2 + seg
    return None


def image_size(data, fmt):
    """按真实格式解析像素尺寸；取不到返回 None（不抛错）。"""
    if fmt == "JPEG":
        return jpeg_size(data)
    if fmt == "PNG":
        # 签名 8 字节 + 长度 4 + 类型 4 ⇒ IHDR 的宽高固定在偏移 16..24（大端）
        if len(data) >= 24:
            w, h = struct.unpack(">II", data[16:24])
            return w, h
        return None
    if fmt == "GIF":
        # 逻辑屏幕宽高：偏移 6，小端 16 位
        if len(data) >= 10:
            w, h = struct.unpack("<HH", data[6:10])
            return w, h
        return None
    return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("ids", nargs="+", type=int)
    ap.add_argument("--out", default=os.getcwd())
    ap.add_argument("--index", default="", help="只取第几张，逗号分隔，如 1,2")
    args = ap.parse_args()

    key = read_key()
    want = set(int(x) for x in args.index.split(",") if x.strip()) if args.index else None
    os.makedirs(args.out, exist_ok=True)

    files, total = 0, 0
    for fid in args.ids:
        try:
            rows = fetch(key, fid)
        except Exception as exc:            # noqa: BLE001
            print("#%d 取图失败：%s" % (fid, exc))
            continue
        if not rows:
            print("#%d 查无此 id" % fid)
            continue
        row = rows[0]
        for idx, raw in enumerate((row.get("d1"), row.get("d2"), row.get("d3")), start=1):
            if want and idx not in want:
                continue
            b64 = strip_data_uri(raw)
            if not b64:
                continue
            try:
                blob = base64.b64decode(b64)
            except Exception as exc:        # noqa: BLE001
                print("#%d 图%d 解码失败：%s" % (fid, idx, exc))
                continue
            ext, fmt = sniff_format(blob)
            out = os.path.join(args.out, "反馈%d-图%d%s" % (fid, idx, ext))
            with open(out, "wb") as f:
                f.write(blob)
            size = len(blob)
            files, total = files + 1, total + size
            dim = image_size(blob, fmt)
            print("#%d 图%d  %-11s %-18s %-5s %.0fKB" % (
                fid, idx, ("%dx%d" % dim) if dim else "尺寸未知",
                os.path.basename(out), fmt, size / 1024.0))

    print("合计 %d 个文件，%.0fKB（%.2fMB）" % (files, total / 1024.0, total / 1048576.0))


if __name__ == "__main__":
    main()
