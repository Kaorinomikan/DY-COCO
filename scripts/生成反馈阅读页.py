#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
生成「反馈阅读页」—— 文字 + 截图同页的 HTML 综合阅读页。

★ 本地零残留（2026-10-13 用户定：「我不需要把反馈图都下载到本地，
  只需要在本地能够阅读到相关的反馈内容，不要把我本地当仓库囤积这些截图」）：
  原图 base64 从云端 RPC 取回后**只在内存里流转**，直接写进 HTML 的 <img src>，
  **不在本地落任何 jpg**。产物只有一份自包含的 HTML（图已在里面），
  看完可留可删；重新生成会覆盖同名文件，不会累积。

  想「囤图」只有一条路：显式跑 scripts/取反馈原图.py（日报附件用，收工即删）。

用法：
  python scripts/生成反馈阅读页.py --items items.json --out "output/反馈阅读-YYYY-MM-DD.html"
  python scripts/生成反馈阅读页.py --items items.json --out ... --title "可可助手 · 反馈阅读"

items.json（反馈文本由助手用 DB 工具查出后落盘，体积很小）：
  [{"id":21,"group":"bug","type":"功能问题","ver":"26.10.13.4","time":"10月13日 13:12",
    "contact":null,"text":"bug修复一下",
    "review":"能不能修：能（…）；有没有必要修：有必要（…）"}, ...]

  · group  —— **流程内的分类**（2026-10-14 用户定「先分类 → 再阅读 → 再规划」），
              取值 bug / 新功能建议 / 其他 / 垃圾反馈；缺省时回退到 type。
  · type   —— 用户提交时自选的类型(功能问题/功能建议/其他),仅作展示参考。
  · review —— 可选。助手的评审结论。两种写法:
              (1) 旧:一个字符串 → 渲染成卡片底部一块浅灰框。
              (2) 新(2026-10-18 起推荐):一个对象
                  {"现象":"...","根因":"...","修法":"...","拍板":"...","去向":"..."}
                  → 「现象/根因/修法/拍板」渲染为「评审意见」块,
                    「去向」渲染为「修改计划」块(去向上色:待修复 bug / 计划 / 当场修 / 不做)。
              缺该字段 → 退化为纯阅读页(与扩展前行为一致)。
  ⚠️ 「评审汇报页」与「图文阅读页」是同一份(2026-10-15 用户定,不再一天出两份);
     评审期请用 --title「可可助手 · 评审汇报」、输出 output/评审汇报-YYYY-MM-DD.html。
  页面按 group 分节展示(顺序 bug → 新功能建议 → 其他 → 垃圾反馈);
  **「垃圾反馈」默认不渲染**（与流程口径一致），要看得加 --show-junk。

密钥来源（与 取反馈原图.py 同）：环境变量 DYC_SHOT_KEY，
否则读工程上级目录的 .dyc-shot-key。
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
ACCENT = {
    # 流程内的分类（2026-10-14 起为准）
    "bug": "#ff7d00",
    "新功能建议": "#165dff",
    "其他": "#86909c",
    "垃圾反馈": "#c9cdd4",
    # 用户提交时自选的 type（兼容旧数据；group 缺省时才用到）
    "功能问题": "#ff7d00",
    "功能建议": "#165dff",
}

# 分节顺序与标题（用户 2026-10-14 定：先分类，再阅读）
GROUP_ORDER = ["bug", "新功能建议", "其他", "垃圾反馈"]
GROUP_TITLE = {
    "bug": "bug",
    "新功能建议": "新功能建议",
    "其他": "其他",
    "垃圾反馈": "垃圾反馈（已隔离，默认不展示）",
}


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
    """库里的值是 data URI；只取逗号后的 base64 部分。"""
    if not value:
        return None
    if value.lstrip().startswith("data:") and "," in value:
        value = value.split(",", 1)[1]
    return value.strip() or None


def _jpeg_size(raw):
    """从 JPEG 字节流读 SOF 段拿宽高（不依赖第三方库）。"""
    i, n = 2, len(raw)
    while i + 9 < n:
        if raw[i] != 0xFF:
            i += 1
            continue
        m = raw[i + 1]
        if m in (0xD8, 0xD9) or 0xD0 <= m <= 0xD7:
            i += 2
            continue
        seg = struct.unpack(">H", raw[i + 2:i + 4])[0]
        if m in (0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7, 0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF):
            h, w = struct.unpack(">HH", raw[i + 5:i + 9])
            return w, h
        i += 2 + seg
    return None, None


def image_info(raw):
    """探测图片真实格式与像素 → (fmt, w, h)。

    为什么要探真实格式（2026-10-13 修）：面板支持「Ctrl+V 粘贴截图」，
    粘进来的可能是 PNG（保持原始编码），而拍屏出来的一律是 JPEG。
    此前无论哪种都按 .jpg / image/jpeg 输出 —— 等于给 PNG 贴了 JPEG 的名字。
    看图软件与邮件客户端按文件头识别还能显示，但严格按扩展名解析的工具会不认。
    现在按真实格式定扩展名与 MIME，日志里的文件名也跟着改。
    """
    if raw[:2] == b"\xff\xd8":
        w, h = _jpeg_size(raw)
        return "jpeg", w, h
    if raw[:8] == b"\x89PNG\r\n\x1a\n":
        try:
            w, h = struct.unpack(">II", raw[16:24])
        except struct.error:
            w, h = None, None
        return "png", w, h
    if raw[:6] in (b"GIF87a", b"GIF89a"):
        try:
            w, h = struct.unpack("<HH", raw[6:10])
        except struct.error:
            w, h = None, None
        return "gif", w, h
    if raw[:4] == b"RIFF" and raw[8:12] == b"WEBP":
        return "webp", None, None
    return "bin", None, None


MIME = {"jpeg": "image/jpeg", "png": "image/png",
        "gif": "image/gif", "webp": "image/webp"}


def mime_of(fmt):
    return MIME.get(fmt, "image/jpeg")


CSS = """
  *{box-sizing:border-box}
  body{margin:0;background:#f2f3f5;color:#1f2329;
       font:15px/1.7 -apple-system,'Segoe UI','Microsoft YaHei',sans-serif}
  .wrap{max-width:880px;margin:0 auto;padding:28px 20px 60px}
  .banner{background:#1f2329;color:#fff;border-radius:12px;padding:22px 24px}
  .banner h1{margin:0;font-size:21px;font-weight:700;letter-spacing:.2px}
  .banner p{margin:8px 0 0;font-size:13px;color:#c9cdd4;line-height:1.7}
  .index{margin:16px 2px 6px;font-size:13px;color:#86909c;line-height:1.9}
  .index b{color:#1f2329}
  .card{background:#fff;border:1px solid #e5e6eb;border-left:4px solid #86909c;
        border-radius:10px;padding:16px 18px;margin:12px 0}
  .head{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
  .no{font-weight:700;font-size:15px}
  .tag{font-size:12px;border:1px solid #e5e6eb;border-radius:999px;padding:1px 9px}
  .ver{font-size:12px;color:#86909c}
  .meta{font-size:12px;color:#86909c;margin-top:4px}
  .dot{margin:0 6px}
  .text{margin-top:9px;font-size:15px;white-space:pre-wrap}
  .noshot{font-size:12px;color:#c9cdd4;margin-top:8px}
  .shotbox{overflow:auto;margin-top:10px}
  .shotbox img{display:block;max-width:100%;border:1px solid #e5e6eb;
               border-radius:8px;cursor:zoom-in;background:#fafafa}
  .shotbox img.zoom{max-width:none;cursor:zoom-out}
  .shotmeta{font-size:12px;color:#86909c;margin-top:6px;line-height:1.6}
  .hint{color:#c9cdd4}
  .foot{margin-top:26px;padding-top:14px;border-top:1px solid #e5e6eb;
        font-size:12px;color:#86909c;line-height:1.9}
  /* 分节标题（按分类分组，2026-10-14） */
  .group{display:flex;align-items:center;gap:8px;margin:28px 2px 10px}
  .gbar{width:4px;height:16px;border-radius:2px;flex:none}
  .gname{font-size:16px;font-weight:700}
  .gcount{font-size:12px;color:#86909c}
  /* 评审结论块 */
  .utype{font-size:11.5px;color:#86909c;margin-left:8px;padding:1px 6px;
    border:1px dashed #c9cdd4;border-radius:999px}
  .review{margin-top:12px;padding:11px 13px;background:#f7f8fa;border:1px solid #e5e6eb;
          border-radius:8px;font-size:13px;line-height:1.85;white-space:pre-wrap}
  .review b{color:#4e5969;margin-right:6px}
  /* 结构化评审(2026-10-18:评审汇报页四块之一「评审意见」) */
  .reviewbox{margin-top:12px;padding:12px 14px;background:#f7f8fa;border:1px solid #e5e6eb;
             border-radius:8px}
  .reviewbox .rv-h{font-size:12px;font-weight:700;color:#4e5969;margin-bottom:8px;
                   letter-spacing:.5px}
  .rv-row{display:flex;gap:8px;font-size:13px;line-height:1.9;margin-top:5px}
  .rv-row .k{flex:none;width:44px;color:#86909c}
  .rv-row .v{flex:1;white-space:pre-wrap}
  /* 修改计划(去向)块 —— 四块之四 */
  .planbox{margin-top:10px;padding:9px 13px;border-radius:8px;font-size:13px;line-height:1.8;
           border:1px solid #e5e6eb;background:#fff}
  .planbox .pl-h{font-weight:700;color:#4e5969;margin-right:8px}
  .plan-todo{background:#fff7e8;border-color:#ffd599}
  .plan-todo .pl-v{color:#d25f00;font-weight:700}
  .plan-plan{background:#e8f3ff;border-color:#bedaff}
  .plan-plan .pl-v{color:#0e42d2;font-weight:700}
  .plan-now{background:#e8ffea;border-color:#aff0b5}
  .plan-now .pl-v{color:#00a11f;font-weight:700}
  .plan-no{background:#f7f8fa;border-color:#e5e6eb}
  .plan-no .pl-v{color:#86909c;font-weight:700}
  .plan-ask{background:#fff1f0;border-color:#ffccc7}
  .plan-ask .pl-v{color:#cf1322;font-weight:700}
  .card.junk{opacity:.6}
  .diag{margin-top:12px;padding:12px 14px;background:#fafbfc;
        border:1px dashed #e5e6eb;border-radius:8px}
  .diag-h{font-size:12px;font-weight:700;color:#4e5969;margin:13px 0 6px}
  .diag-h:first-child{margin-top:0}
  .diag-row{display:flex;gap:8px;font-size:12px;line-height:1.85;color:#1f2329}
  .diag-row .k{flex-shrink:0;width:60px;color:#86909c}
  .diag-row .v{word-break:break-all}
  .diag ul{margin:0;padding-left:18px;font-size:12px;color:#1f2329;line-height:1.85}
  .diag .mono{font:11px/1.7 Consolas,'Courier New',monospace;color:#4e5969;
              word-break:break-all;white-space:pre-wrap;margin:0}
  .diag table{margin:0;font-size:12px}
  .diag td,.diag th{padding:3px 8px}
  .diag .ok{color:#00b42a}
  .diag .bad{color:#f53f3f;font-weight:700}
  .nodiag{margin-top:10px;font-size:12px;color:#c9cdd4}
  /* 页面结构折叠树（2026-10-22 新增）：默认收起，逐层展开 */
  .ds-wrap{margin-top:12px;border:1px dashed #e5e6eb;border-radius:8px;
           background:#fafbfc;padding:8px 12px}
  .ds-wrap>summary{font-size:12px;font-weight:700;color:#4e5969;cursor:pointer}
  .ds-meta{font-weight:400;color:#86909c;margin-left:8px;font-size:11px}
  .ds-body{margin-top:8px;font:11px/1.75 Consolas,'Courier New',monospace;color:#1f2329}
  .ds-node summary{cursor:pointer;list-style:none;padding:1px 0;word-break:break-all}
  .ds-node summary::-webkit-details-marker{display:none}
  .ds-node summary::before{content:'▸ ';color:#86909c}
  .ds-node[open]>summary::before{content:'▾ '}
  .ds-row{padding:1px 0 1px 14px;word-break:break-all;color:#4e5969}
  .ds-kids{margin-left:16px;border-left:1px solid #e5e6eb;padding-left:6px}
  .ds-n{color:#c9cdd4;font-size:10px;margin-left:6px}
  .ds-ext{color:#ff7d00;font-weight:700}
  .ds-cut{color:#f77234}
  .ds-info{color:#86909c}
  .ds-note{margin-top:8px;font-size:11px;color:#86909c;font-family:sans-serif}
"""


def esc(s):
    return (str(s).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;"))


# ==========================================================
# 结构化评审渲染(2026-10-18 新增 · 评审汇报页的第 3、4 块)
#
# items JSON 里每条可带 review,两种写法都支持:
#   · 字符串 —— 旧格式,原样渲染成一块浅灰框(行为与扩展前一致)。
#   · 对象   —— 新格式 {"现象":..., "根因":..., "修法":..., "拍板":..., "去向":...}:
#               「现象 / 根因 / 修法 / 拍板」渲染为「评审意见」块,
#               「去向」渲染为「修改计划」块(按去向值上色)。
# 两种写法都不出现时,不渲染任何评审区块 —— 退化为纯阅读页。
# ==========================================================

PLAN_CLASS = {
    "待修复 bug": "plan-todo",
    "bug 待修复": "plan-todo",
    "计划": "plan-plan",
    "计划中": "plan-plan",
    "已开工": "plan-now",
    "当场修": "plan-now",
    "不做": "plan-no",
    "待拍板": "plan-ask",
}


def _plan_class(去向):
    for k, v in PLAN_CLASS.items():
        if k and k in (去向 or ""):
            return v
    return "plan-no"


def render_review(review):
    """review → HTML 字符串。兼容旧的纯文本写法。"""
    if not review:
        return ""
    if isinstance(review, str):
        return '<div class="review"><b>评审</b>%s</div>' % esc(review)
    if not isinstance(review, dict):
        return ""
    rows = []
    for key in ("现象", "根因", "修法", "拍板"):
        val = review.get(key)
        if not val:
            continue
        rows.append('<div class="rv-row"><span class="k">%s</span>'
                    '<span class="v">%s</span></div>' % (key, esc(val)))
    html = ""
    if rows:
        html += ('<div class="reviewbox"><div class="rv-h">评审意见'
                 '(现象 / 根因 / 修法 / 待拍板)</div>%s</div>' % "".join(rows))
    to = review.get("去向")
    if to:
        html += ('<div class="planbox %s"><span class="pl-h">修改计划</span>'
                 '<span class="pl-v">%s</span></div>'
                 % (_plan_class(to), esc(to)))
    return html


# ==========================================================
# 诊断快照渲染（2026-10-13 新增 · 反馈诊断包第 4 层）
#
# 数据来自 feedback 表的 diag 列（jsonb）。助手用 DB 工具查出后写进 items.json，
# 本函数把它渲染成卡片里的一个区块：环境 / 开关 / 控件 / 报错 / 轨迹 / 截图来源。
# 老记录 diag 为 {} → 显示「本条无诊断信息」，不报错。
# ==========================================================

def _dur(ms):
    try:
        s = float(ms) / 1000.0
    except (TypeError, ValueError):
        return "?"
    if s < 60:
        return "%.0f 秒" % s
    if s < 3600:
        return "%.1f 分钟" % (s / 60.0)
    return "%.1f 小时" % (s / 3600.0)


def _rel(ts, base):
    """绝对毫秒时间戳 → 相对扩展启动的偏移，如 +3.2s（跨上下文对齐用）"""
    try:
        return "+%.1fs" % ((float(ts) - float(base)) / 1000.0)
    except (TypeError, ValueError):
        return "?"


def render_diag(diag, present=True):
    # 2026-10-18:items JSON 里**根本没有** diag 字段(评审汇报页不采集诊断)时,
    # 整块不渲染 —— 免得每张卡片都挂一句「本条无诊断信息」的噪音。
    if not present:
        return ""
    if not isinstance(diag, dict) or not diag.get("env"):
        return ('<div class="nodiag">（本条无诊断信息 —— 提交时取消了勾选，'
                '或采集内核未在该页面生效）</div>')

    env = diag.get("env") or {}
    base = env.get("boot")
    out = ['<div class="diag">']

    # ---- 环境 ----
    out.append('<div class="diag-h">环境</div>')
    rows = []
    if env.get("scope") == "extPage":
        rows.append(("位置", "兜底小窗（扩展页面）"
                     + ((" · 降级原因：" + esc(env.get("why"))) if env.get("why") else "")))
    else:
        rows.append(("页面", "%s · %s" % (env.get("kind") or "?", env.get("url") or "（未采集）")))
        if env.get("title"):
            rows.append(("标题", esc(env["title"])))
    rows.append(("视口", "%s×%s @%s× · 文档高 %spx"
                 % (env.get("vw"), env.get("vh"), env.get("dpr"), env.get("docH"))))
    rows.append(("内核", env.get("engine") or "?"))
    rows.append(("版本", "%s · 扩展已存活 %s"
                 % (env.get("ver") or "?", _dur(env.get("age")))))
    caps = env.get("caps") or {}
    missing = sorted([k for k, v in caps.items() if not v])
    if missing:
        rows.append(("缺能力", "、".join(missing) + "（这些 API 在用户内核上不可用）"))
    for k, v in rows:
        out.append('<div class="diag-row"><span class="k">%s</span>'
                   '<span class="v">%s</span></div>' % (k, v))

    # ---- 功能开关 ----
    flags = diag.get("flags") or {}
    on = flags.get("on") or {}
    if on:
        out.append('<div class="diag-h">功能开关与档位</div>')
        pairs = "、".join("%s=%s" % (k, "开" if v else "关") for k, v in sorted(on.items()))
        mode = flags.get("mode") or {}
        bits = []
        if mode.get("scanShade"):
            bits.append("白幕档=%s" % mode["scanShade"])
        if mode.get("omni"):
            bits.append("全能档=%s" % mode["omni"])
        if isinstance(mode.get("hideList"), list):
            bits.append("隐藏勾选=%d 项" % len(mode["hideList"]))
        out.append('<div class="diag-row"><span class="k">开关</span>'
                   '<span class="v">%s</span></div>' % esc(pairs))
        if bits:
            out.append('<div class="diag-row"><span class="k">档位</span>'
                       '<span class="v">%s</span></div>' % esc("、".join(bits)))

    # ---- 注入控件 ----
    w = diag.get("widgets") or {}
    groups = w.get("groups") or []
    out.append('<div class="diag-h">注入控件（%d 类）</div>' % len(groups))
    if not groups:
        out.append('<div class="diag-row"><span class="v">页面上未找到任何扩展控件</span></div>')
    else:
        trs = []
        for g in groups:
            rect = g.get("rect") or []
            rect_s = "[%s]" % ",".join(str(x) for x in rect) if rect else "—"
            vis = g.get("vis")
            bad = g.get("bad")
            if bad == "zero-size":
                state = '<span class="bad">零尺寸</span>'
            elif bad == "hidden":
                state = '<span class="bad">被隐藏</span>'
            elif vis is False:
                state = '<span class="bad">不可见</span>'
            else:
                state = '<span class="ok">正常</span>'
            trs.append("<tr><td>%s</td><td>%s</td><td>%s</td><td>%s</td><td>%s</td></tr>"
                       % (esc(g.get("label") or "—"), esc(g.get("id")),
                          g.get("n"), esc(rect_s), state))
        out.append('<table><tr><th>控件</th><th>标识</th><th>数量</th>'
                   '<th>矩形(左,上,宽,高)</th><th>状态</th></tr>%s</table>' % "".join(trs))

    # ---- 自动循环讲解（2026-10-27 新增：该功能跑着时的现场）----
    # 数据来自 diag.snapshot() 的 autoLoop 字段（扩展侧 collectAutoLoop 采集）。
    # 老记录没有这个字段 ⇒ 整块不渲染，不打扰阅读。
    al = diag.get("autoLoop") or {}
    if al:
        st = al.get("状态") or {}
        sc = al.get("现场") or {}
        out.append('<div class="diag-h">自动循环讲解</div>')
        rows = []

        def _v(x):
            return "?" if x is None or x == "" else str(x)

        interval = ("%s 秒" % _v(st.get("seconds"))) if st.get("mode") == "second" else ("%s 分钟" % _v(st.get("minutes")))
        head_s = "%s · %s · 间隔 %s" % (
            "开" if st.get("on") else "关", _v(st.get("phase")), interval)
        if st.get("round"):
            head_s += " · 第 %s 轮" % st.get("round")
        if st.get("fails"):
            head_s += " · 连续失败 %s 次" % st.get("fails")
        if st.get("busy"):
            head_s += " · 正在动作"
        rows.append(("状态", esc(head_s)))
        rows.append(("身份键", esc(st.get("key") or "无")))
        rows.append(("商品", esc(st.get("product") or "无")))
        if st.get("secondsLeft") is not None:
            rows.append(("倒计时", "%s 秒后到点" % st.get("secondsLeft")))
        if sc:
            rows.append(("现场", esc("行 %s / 讲解中标记 %s / 锚点 %s / 胶囊 left %s / 迷你 %s / 寻址槽 dx %s"
                                     % (_v(sc.get("rows")), _v(sc.get("marks")),
                                        _v(sc.get("anchorMode")), _v(sc.get("capLeft")),
                                        "是" if sc.get("mini") else "否",
                                        _v(sc.get("lampSlotDX"))))))
            if sc.get("liveRow"):
                rows.append(("讲解中的行", esc(str(sc.get("liveRow"))[:40]
                                              + " · 按钮「%s」" % _v(sc.get("btn")))))
            if sc.get("rowKeys"):
                rows.append(("前几行身份键", esc(" / ".join([str(x) for x in sc["rowKeys"][:6]]))))
            ids = sc.get("idSample") or {}
            if ids:
                picked = ids.get("picked") or ""
                hits = ids.get("hits") or []
                rows.append(("ID 体检", esc(("picked=%s" % picked) if picked else "未抓到 ID")
                             + ((" · 属性：" + "；".join([str(h) for h in hits[:4]])) if hits else "")))
        for k, v in rows:
            out.append('<div class="diag-row"><span class="k">%s</span>'
                       '<span class="v">%s</span></div>' % (k, v))
        recent = sc.get("recent") or []
        if recent:
            out.append('<div class="diag-h">最近流水（%d 条）</div>' % len(recent))
            out.append('<ul>%s</ul>' % "".join("<li>%s</li>" % esc(str(r)) for r in recent[-8:]))

    # ---- 报错 ----
    errs = list(diag.get("errors") or [])
    for e in (diag.get("swErrors") or []):
        e = dict(e)
        e["s"] = (e.get("s") or "sw") + "(后台)"
        errs.append(e)
    out.append('<div class="diag-h">报错（%d 条）</div>' % len(errs))
    if not errs:
        out.append('<div class="diag-row"><span class="v">'
                   '<span class="ok">无</span>（扩展自身未抛异常）</span></div>')
    else:
        lis = []
        for e in errs:
            t = _rel(e.get("t"), base) if base else "?"
            src = e.get("s") or "?"
            msg = esc(e.get("m") or "")
            line = "<li>[%s] <b>%s</b> · %s" % (esc(t), esc(src), msg)
            if e.get("k"):
                line += '<div class="mono">%s</div>' % esc(e["k"])
            lis.append(line + "</li>")
        out.append("<ul>%s</ul>" % "".join(lis))

    # ---- 操作轨迹 ----
    tl = diag.get("timeline") or []
    out.append('<div class="diag-h">操作轨迹（%d 条）</div>' % len(tl))
    if not tl:
        out.append('<div class="diag-row"><span class="v">（空）</span></div>')
    else:
        lis = []
        for it in tl:
            t = _rel(it.get("t"), base) if base else "?"
            seg = "[%s] %s" % (esc(t), esc(it.get("a") or ""))
            if it.get("d"):
                seg += " · " + esc(it["d"])
            if it.get("r"):
                seg += " → " + esc(it["r"])
            lis.append("<li>%s</li>" % seg)
        out.append("<ul>%s</ul>" % "".join(lis))

    # ---- 截图来源 ----
    shots = diag.get("shots") or []
    if shots:
        FROM = {"capture": "拍屏", "paste": "粘贴", "file": "选文件"}
        segs = []
        for i, s in enumerate(shots, start=1):
            segs.append("图%d %s · %s · %s×%s · %sKB"
                        % (i, FROM.get(s.get("from"), s.get("from") or "?"),
                           (s.get("fmt") or "?").upper(), s.get("w"), s.get("h"), s.get("kb")))
        out.append('<div class="diag-h">截图来源</div>')
        out.append('<div class="diag-row"><span class="v">%s</span></div>' % esc("；".join(segs)))

    if diag.get("truncated"):
        out.append('<div class="diag-row"><span class="k">注意</span>'
                   '<span class="v"><span class="bad">快照超 64KB，已按优先级截断</span>'
                   '</span></div>')

    out.append("</div>")
    return "".join(out)


# ==========================================================
# 页面结构折叠树渲染（2026-10-22 新增 · 反馈可选项「导出页面结构」）
#
# 数据来自 feedback 表的 page_structure 列（jsonb）。items.json 里每条可带
# page_structure 字段；缺该字段（旧记录/评审期未采集）时整块不渲染。
# 树渲染成嵌套 <details>：顶层默认展开一层，往下逐层手动展开；
# 扩展自己的控件标 ★ 橙色，一眼认出「我们的元素在页面哪里」。
# ==========================================================

def _ds_line(n):
    """结构树节点 → 一行摘要 HTML（不含子层）。字段口径与扩展端 domTreeText 一致。"""
    bits = []
    tag = esc(n.get("t") or "?")
    if n.get("i"):
        tag += '#' + esc(n["i"])
    if n.get("c"):
        tag += '.' + esc(".".join(str(n["c"]).split()))
    if n.get("e"):
        tag += ' <span class="ds-ext">★扩展</span>'
    if n.get("x"):
        bits.append('"%s"' % esc(n["x"]))
    for key, lab in (("ti", "title"), ("al", "aria"), ("ph", "ph")):
        if n.get(key):
            bits.append("%s=%s" % (lab, esc(n[key])))
    if n.get("d"):
        bits.append("data:%s" % esc(n["d"]))
    if n.get("h"):
        bits.append("→ %s" % esc(n["h"]))
    if n.get("s"):
        bits.append("src: %s" % esc(n["s"]))
    if n.get("sh"):
        bits.append("shadowRoot")
    if n.get("cross"):
        bits.append("跨域 iframe")
    if n.get("cut"):
        bits.append('<span class="ds-cut">…%d 个子节点未展开</span>' % n["cut"])
    if n.get("deep"):
        bits.append('<span class="ds-cut">…已达深度上限</span>')
    if bits:
        tag += ' <span class="ds-info">%s</span>' % " ｜ ".join(bits)
    return tag


def _ds_tree(n, depth):
    """节点 → 嵌套 details HTML；depth 0（根）默认展开一层。"""
    kids = n.get("k") or []
    line = _ds_line(n)
    if not kids:
        return '<div class="ds-row">%s</div>' % line
    inner = "".join(_ds_tree(k, depth + 1) for k in kids)
    open_attr = " open" if depth < 1 else ""
    return ('<details class="ds-node"%s><summary>%s'
            '<span class="ds-n">(%d 个子节点)</span></summary>'
            '<div class="ds-kids">%s</div></details>'
            % (open_attr, line, len(kids), inner))


def render_domstruct(ps, present=True):
    """page_structure 列 → 卡片内折叠块。items 无该字段时不渲染。"""
    if not present:
        return ""
    if not isinstance(ps, dict):
        return ""
    if not ps.get("ok"):
        return ('<details class="ds-wrap"><summary>页面结构</summary>'
                '<div class="ds-body">未导出：%s</div></details>'
                % esc(ps.get("why") or "未知原因"))
    meta = []
    if ps.get("n"):
        meta.append("%s 个节点" % ps["n"])
    if ps.get("took") is not None:
        meta.append("采集 %d ms" % ps["took"])
    if ps.get("url"):
        meta.append(esc(ps["url"]))
    if ps.get("title"):
        meta.append("《%s》" % esc(ps["title"]))
    capped_note = ""
    if ps.get("capped"):
        capped_note = "；节点数超限，部分内容未展开"
    return ('<details class="ds-wrap"><summary>页面结构'
            '<span class="ds-meta">%s</span></summary>'
            '<div class="ds-body">%s<div class="ds-note">脱敏裁剪版：文本截 20 字、'
            'URL 打码、输入内容不采集%s</div></div></details>'
            % (" · ".join(meta), _ds_tree(ps.get("tree") or {}, 0), capped_note))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--items", required=True, help="反馈条目 JSON 文件")
    ap.add_argument("--out", required=True, help="输出的 HTML 路径")
    ap.add_argument("--title", default="可可助手 · 反馈阅读")
    ap.add_argument("--subtitle", default="")
    ap.add_argument("--show-junk", action="store_true",
                    help="把「垃圾反馈」也渲染出来（默认不展示，与流程口径一致）")
    args = ap.parse_args()

    with open(args.items, "r", encoding="utf-8") as f:
        items = json.load(f)

    key = read_key()
    n_img, with_shot, failed = 0, [], []
    n_diag = 0
    card_of = {}          # 反馈 id -> 卡片 HTML（先全部渲染好，再按分类拼装）

    for it in items:
        fid = it["id"]
        g = it.get("group") or it.get("type") or "其他"
        # 不展示的组连图都不去云端取（省一次往返；2026-10-14）
        if g == "垃圾反馈" and not args.show_junk:
            continue
        row = {}
        try:
            rows = fetch(key, fid)
            if rows:
                row = rows[0]
        except Exception as exc:                      # noqa: BLE001
            failed.append(fid)
            print("#%d 取图失败：%s" % (fid, exc))

        blocks = []
        for idx, raw in enumerate((row.get("d1"), row.get("d2"), row.get("d3")), start=1):
            b64 = strip_data_uri(raw)
            if not b64:
                continue
            try:
                blob = base64.b64decode(b64)
            except Exception:                          # noqa: BLE001
                continue
            fmt, w, h = image_info(blob)
            n_img += 1
            name = "反馈%d-图%d.%s" % (fid, idx, fmt if fmt != "bin" else "jpg")
            px = "%d×%d" % (w, h) if w else "尺寸未知"
            blocks.append(
                '<div class="shotbox">'
                '<img src="data:%s;base64,%s" alt="%s" '
                'onclick="this.classList.toggle(\'zoom\')">'
                '<div class="shotmeta">%s · %s · %s · %dKB · '
                '<span class="hint">点击图片可放大到原始像素</span></div>'
                '</div>' % (mime_of(fmt), b64, name, name, px, fmt.upper(),
                            round(len(blob) / 1024))
            )
        if blocks:
            with_shot.append((fid, len(blocks)))

        if isinstance(it.get("diag"), dict) and it["diag"].get("env"):
            n_diag += 1

        g = it.get("group") or it.get("type") or "其他"
        color = ACCENT.get(g, "#86909c")
        contact = ('<span class="dot">·</span>联系方式：%s'
                   % esc(it["contact"])) if it.get("contact") else ""
        review = it.get("review")
        review_html = render_review(review)

        # 2026-10-26:用户自选 type 与流程内判定不一致时**两者都标**
        # (用户 2026-10-15 定:自动归类要能与自选类型对照),一致或缺失时不加噪。
        # 2026-10-28 修正:自选类型要读 items 的 utype 字段。
        # 上一版写成 it.get("type") —— 与判定结果取的是同一个键,恒等 ⇒ 标签永不出现,
        # 等于该能力空转。缺 utype 时不标(保持旧行为)。
        utype = it.get("utype")
        utype_html = ""
        # 归一化后比较:自选「功能问题」与判定 bug 属同一件事,不该标成不一致
        UTYPE_ALIAS = {"功能问题": "bug", "功能建议": "新功能建议", "其他": "其他"}
        if utype and UTYPE_ALIAS.get(utype, utype) != g:
            utype_html = '<span class="utype">用户自选：%s</span>' % esc(utype)
        card_of[fid] = (
            '<div class="card%s" style="border-left-color:%s">'
            '<div class="head"><span class="no">#%d</span>'
            '<span class="tag" style="color:%s;border-color:%s">%s</span>'
            '<span class="ver">v%s</span>%s</div>'
            '<div class="meta">%s %s</div>'
            '<div class="text">%s</div>'
            '%s%s%s%s</div>' % (
                " junk" if g == "垃圾反馈" else "",
                color, fid, color, color, esc(g),
                esc(it.get("ver") or ""), utype_html, esc(it.get("time") or ""), contact,
                esc(it.get("text") or ""),
                "".join(blocks) or '<div class="noshot">（该条无截图）</div>',
                review_html,
                render_diag(it.get("diag"), "diag" in it),
                render_domstruct(it.get("page_structure"), "page_structure" in it)
            )
        )

    # ---- 按分类分节（2026-10-14 用户定：先分类 → 再阅读）----
    def group_of(x):
        return x.get("group") or x.get("type") or "其他"

    order = [g for g in GROUP_ORDER if any(group_of(x) == g for x in items)]
    for x in items:
        if group_of(x) not in order:
            order.append(group_of(x))
    if not args.show_junk:
        order = [g for g in order if g != "垃圾反馈"]

    sections = []
    for g in order:
        members = [x for x in items if group_of(x) == g]
        color = ACCENT.get(g, "#86909c")
        sections.append(
            '<div class="group"><span class="gbar" style="background:%s"></span>'
            '<span class="gname" style="color:%s">%s</span>'
            '<span class="gcount">%d 条</span></div>'
            % (color, color, esc(GROUP_TITLE.get(g, g)), len(members))
        )
        sections.extend(card_of[x["id"]] for x in members if x["id"] in card_of)

    cnt = {}
    for x in items:
        cnt[group_of(x)] = cnt.get(group_of(x), 0) + 1
    cnt_text = " · ".join("%s %d" % (GROUP_TITLE.get(g, g).split("（")[0], cnt[g])
                          for g in GROUP_ORDER if cnt.get(g))
    for g, n in cnt.items():
        if g not in GROUP_ORDER:
            cnt_text += (" · " if cnt_text else "") + "%s %d" % (g, n)

    idx_text = "、".join("#%d(%d张)" % (i, n) for i, n in with_shot) or "无"
    doc = """<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>%s</title>
<style>%s</style></head>
<body><div class="wrap">
  <div class="banner">
    <h1>%s</h1>
    <p>共 <b>%d</b> 条反馈：<b>%s</b>。其中 <b>%d</b> 条带截图（共 %d 张，原图内嵌）、
       <b>%d</b> 条带诊断快照。图片点击可放大到原始像素。%s</p>
  </div>
  <div class="index">
    含图反馈：<b>%s</b><br>
    图片编号规则：<b>反馈&lt;编号&gt;-图&lt;第几张&gt;.jpg</b>，与卡片头部的 #编号 一一对应。
  </div>
<!--CARDS-->
  <div class="foot">
    本页为会话内阅读形态：正文与截图同页、图文对照，不需要另开窗口找图。<br>
    图片由本地脚本从云端取回后 base64 内嵌，<b>全程不经过模型上下文，本地不落任何 jpg</b>；
    图永久存在云端库，删掉本页也不会丢。
  </div>
</div></body></html>""" % (
        esc(args.title), CSS, esc(args.title), len(items), cnt_text,
        len(with_shot), n_img, n_diag, esc(args.subtitle), idx_text
    )
    doc = doc.replace("<!--CARDS-->", "\n".join(sections))

    out_dir = os.path.dirname(os.path.abspath(args.out))
    if out_dir:
        os.makedirs(out_dir, exist_ok=True)
    with open(args.out, "w", encoding="utf-8", newline="\n") as f:
        f.write(doc)

    print("条目 %d 条；含图 %d 条、内嵌图片 %d 张" % (len(items), len(with_shot), n_img))
    print("含图编号：%s" % idx_text)
    if failed:
        print("取图失败：%s" % ", ".join("#%d" % i for i in failed))
    print("输出：%s" % args.out)
    print("大小：%.2f MB" % (os.path.getsize(args.out) / 1024 / 1024))
    print("本地残留图片：0 张（原图只在内存里流转）")


if __name__ == "__main__":
    sys.exit(main())
