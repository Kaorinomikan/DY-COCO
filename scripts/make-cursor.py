# -*- coding: utf-8 -*-
"""
抓手光标图生成器 v2 —— 产出 1x(32px) + 2x(64px) PNG 并(可选)注入 cursor-fix.js

为什么要有 2x
------------
用户 2026-10-11 反馈「抓手图标很糊」。原因有二:
  1. 高分屏放大:Windows 显示缩放 125% / 150% 时,Chromium 把 32px 位图
     按 CSS 尺寸 × DPR 放大渲染,32px 源图被拉糊 —— 这是主因;
  2. 绘制链路偏软:4 倍超采样 + 描边环 0.28 倍高斯模糊,边缘本身就有半像素级发虚。

对策(本版 v2):
  · 新增 64px 的 2x 图,经 `-webkit-image-set()` 交给高分屏按原生分辨率渲染;
    低分屏 / 不支持 image-set 的内核走纯 url(32px) 行,行为与旧版完全一致。
    Chromium 自 2012 年起支持 -webkit-image-set 且可用于 cursor 属性,
    热点坐标写在 image-set() 之后、按 1x 图像素给,浏览器自行换算。
  · 超采样 4x → 8x,描边环模糊量 0.28 → 0.18,边缘更立。
  · 尺寸仍远小于 Chromium 128px 光标上限。

用法
----
  # 只看效果与量化指标,不动源码
  py scripts/make-cursor.py

  # 调粗描边到 1.5px 并写回 src/content/cursor-fix.js
  py scripts/make-cursor.py --outline 1.5 --write

  # 换深棕描边(#5B4A38,与扩展图标同色系)
  py scripts/make-cursor.py --color brown --write

  # 换手形
  py scripts/make-cursor.py --shape open   # 张握形(五指张开)
  py scripts/make-cursor.py --shape point  # 单指形(最像「点击的手」)

自证
----
脚本打印两组量化指标:
  · 边界对比 —— 光标叠在白/浅灰/深底上,最外圈与底色的亮度差,>=100 视为
    清晰可辨(「光标会不会隐形」的判据);
  · 过渡像素占比 —— alpha 处于中间灰阶(30~220)的像素占边缘带的比例,
    越低边缘越锐(「糊不糊」的判据)。1x 与 2x 都量。
"""

import argparse
import base64
import io
import os
import re
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

# ------------------------------------------------------------------ 常量

SS = 8                      # 超采样倍数(相对目标尺寸;v1 为 4,提到 8 换更锐边缘)
DESIGN = 128                # 设计坐标空间:所有手形按 128x128 的坐标书写
BASE = 32                   # 1x 基准尺寸;2x = 64

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
CURSOR_JS = os.path.join(ROOT, 'src', 'content', 'cursor-fix.js')

WHITE = (255, 255, 255, 255)
COLORS = {
    'ink': (26, 26, 30, 255),      # 近黑,比纯黑柔和一档
    'brown': (91, 74, 56, 255),    # 与扩展图标同色系
    'white': (255, 255, 255, 255),
}

# 热点:掌心(四指指根与掌体交汇处),按 1x 图(32px)像素坐标给。
# image-set 选中 2x 图时由浏览器按分辨率自行换算,无需另给。
HOTSPOT = {'grab': (15, 18), 'grabbing': (14, 16), 'open': (15, 18),
           'point': (14, 18)}

# ------------------------------------------------------------------ 绘图工具
# (画布尺寸由调用方传入,同一份 128 坐标通吃 32px 与 64px 两档)


def _s(v, W):
    """128 设计坐标 → 工作画布像素"""
    return v * W / float(DESIGN)


def _box(x0, y0, x1, y1, W):
    return (_s(x0, W), _s(y0, W), _s(x1, W), _s(y1, W))


def new_layer(W):
    return Image.new('RGBA', (W, W), (0, 0, 0, 0))


def rr(d, x0, y0, x1, y1, radius, fill, W):
    d.rounded_rectangle(_box(x0, y0, x1, y1, W), radius=_s(radius, W), fill=fill)


# ------------------------------------------------------------------ 三种手形


def hand_grab(W):
    """
    抓握形(grab):四指并拢朝上 + 拇指内收 + 手掌。
    各系统 grab 光标的通用造型,拖拽语义最贴切。
    """
    L = new_layer(W)
    d = ImageDraw.Draw(L)
    rr(d, 40, 62, 96, 110, 14, WHITE, W)      # 手掌主体
    rr(d, 38, 88, 98, 112, 12, WHITE, W)      # 掌根(略宽,增加厚度感)
    rr(d, 22, 62, 46, 88, 11, WHITE, W)       # 拇指:左下斜出
    for (x0, y0, x1, y1, r) in [
        (44, 32, 58, 98, 7),                  # 食指
        (58, 24, 72, 98, 7),                  # 中指(最高)
        (72, 32, 86, 98, 7),                  # 无名指
        (86, 44, 100, 98, 7),                 # 小指
    ]:
        rr(d, x0, y0, x1, y1, r, WHITE, W)
    rr(d, 44, 60, 100, 80, 6, WHITE, W)       # 指根过渡,填掉指缝豁口
    return L


def hand_open(W):
    """张开形(open):五指扇形张开,像「准备抓取」的瞬间。"""
    L = new_layer(W)
    d = ImageDraw.Draw(L)
    rr(d, 36, 66, 94, 112, 15, WHITE, W)      # 手掌
    rr(d, 18, 58, 44, 84, 11, WHITE, W)       # 拇指
    rr(d, 38, 30, 52, 92, 7, WHITE, W)        # 食指,略左倾
    rr(d, 54, 20, 68, 92, 7, WHITE, W)        # 中指(最高)
    rr(d, 70, 28, 84, 92, 7, WHITE, W)        # 无名指
    rr(d, 85, 42, 99, 94, 7, WHITE, W)        # 小指(最低)
    rr(d, 38, 62, 99, 82, 6, WHITE, W)        # 指根过渡
    return L


def hand_point(W):
    """
    单指形(point):只有食指伸出,其余三指蜷起 —— 用户最熟悉的「手」。
    ⚠️ 语义偏「可点击」,用在拖拽区略有歧义。
    """
    L = new_layer(W)
    d = ImageDraw.Draw(L)
    rr(d, 42, 66, 94, 110, 14, WHITE, W)      # 手掌
    rr(d, 40, 88, 96, 112, 12, WHITE, W)      # 掌根
    rr(d, 26, 66, 48, 90, 11, WHITE, W)       # 拇指
    rr(d, 46, 18, 62, 92, 8, WHITE, W)        # 食指(长,伸出)
    rr(d, 62, 46, 76, 92, 7, WHITE, W)        # 中指(蜷)
    rr(d, 76, 52, 90, 92, 7, WHITE, W)        # 无名指(蜷)
    rr(d, 44, 62, 92, 80, 6, WHITE, W)        # 指根过渡
    return L


def hand_grabbing(W):
    """
    握拳形(grabbing):四指蜷起成拳,拇指斜压在前面。
    这是各系统 grabbing 光标的通用形态,用于「已按住 / 正在拖」的即时反馈 ——
    与悬停态的抓握形配成一对:移上去手是张开的,按下去手就握紧。

    刻意不画指节沟槽:小尺寸下深色细线只会糊成一团,反而看不出是拳。
    区分「张开 / 握紧」靠的是轮廓 —— 抓握形是细高的竖指,拳头则矮、宽、方正。
    """
    L = new_layer(W)
    d = ImageDraw.Draw(L)
    rr(d, 34, 56, 100, 108, 16, WHITE, W)     # 拳体:矮而宽,和抓握形的细高正好相反
    rr(d, 36, 84, 102, 112, 13, WHITE, W)     # 掌根
    # 四个蜷起的指节:矮墩墩的小凸起压在拳顶,只露出一线起伏
    for (x0, x1, y0) in [(40, 56, 48), (56, 72, 44), (72, 88, 44), (88, 102, 50)]:
        rr(d, x0, y0, x1, 92, 8, WHITE, W)
    rr(d, 20, 58, 66, 78, 9, WHITE, W)        # 拇指:横向斜压过拳面
    return L


SHAPES = {
    'grab': hand_grab,
    'grabbing': hand_grabbing,
    'open': hand_open,
    'point': hand_point,
}

# ------------------------------------------------------------------ 描边


def add_outline(layer, color, thickness):
    """
    给剪影加外描边。

    thickness 单位为「工作画布像素」。
    做法:alpha 做 MaxFilter 膨胀,减去原 alpha 得到环形,
    极轻的高斯模糊只压锯齿、不做柔化(v1 用 0.28 倍,偏软;v2 收到 0.18)。
    """
    alpha = layer.split()[3]
    grown = alpha.filter(ImageFilter.MaxFilter(thickness * 2 + 1))

    a_grown = np.array(grown, dtype=np.int16)
    a_orig = np.array(alpha, dtype=np.int16)
    ring = np.clip(a_grown - a_orig, 0, 255).astype('uint8')

    ring = np.array(Image.fromarray(ring).filter(
        ImageFilter.GaussianBlur(thickness * 0.18)))

    under = Image.new('RGBA', layer.size, color)
    under.putalpha(Image.fromarray(ring))
    return Image.alpha_composite(under, layer)


def render(shape, color, outline_css_px, out_size):
    """
    按目标尺寸出图。同一份 128 设计坐标,画布 = out_size × SS。
    描边粗细按「最终 CSS 像素」折算:2x 图同样画 1 CSS px 厚
    (即 2 图像 px),两张图视觉粗细一致。
    """
    W = out_size * SS
    layer = SHAPES[shape](W)
    t_img = outline_css_px * out_size / float(BASE)   # 描边厚度(图像素)
    t_canvas = max(1, int(round(t_img * SS)))
    big = add_outline(layer, color, t_canvas)
    small = big.resize((out_size, out_size), Image.LANCZOS)
    return small

# ------------------------------------------------------------------ 量化自证


def measure(img):
    a = np.array(img).astype(float)
    alpha = a[..., 3] / 255.0
    lum = 0.2126 * a[..., 0] + 0.7152 * a[..., 1] + 0.0722 * a[..., 2]
    op = alpha > 0.5
    if op.sum() == 0:
        return {'dark': 0.0, 'light': 0.0, 'cover': 0.0, 'soft': 0.0}
    v = lum[op]
    # 过渡像素:alpha 处于中间灰阶 = 边缘发虚的部分。占边缘带比例越低越锐。
    edge_band = (alpha > 0.05) & (alpha < 0.9)
    soft = float(((alpha > 30 / 255.0) & (alpha < 220 / 255.0)).sum()) \
        / max(1.0, float(edge_band.sum()))
    return {
        'dark': round(float((v < 110).mean()) * 100, 1),
        'light': round(float((v >= 200).mean()) * 100, 1),
        'cover': round(float((alpha > 0.05).mean()) * 100, 1),
        'soft': round(soft * 100, 1),
    }


def edge_contrast(img, bg_rgb):
    """
    把光标叠在指定底色上,量「最外圈像素」与底色的亮度差 —— 这是「会不会隐形」
    的直接判据:外圈与底色差得够远,轮廓就立得住。

    取环上「与底色亮度距离最近的 25%」作为最坏情况,浅底深底都成立。
    """
    a = np.array(img).astype(float)
    alpha = a[..., 3] / 255.0
    lum = 0.2126 * a[..., 0] + 0.7152 * a[..., 1] + 0.0722 * a[..., 2]
    bg_lum = (0.2126 * bg_rgb[0] + 0.7152 * bg_rgb[1] + 0.0722 * bg_rgb[2])

    ring = (alpha > 0.05) & (alpha < 0.9)
    if ring.sum() == 0:
        return 0.0
    ring_lum = lum[ring]
    k = max(1, int(ring_lum.size * 0.25))
    nearest = np.sort(np.abs(ring_lum - bg_lum))[:k]
    return round(float(nearest.mean()), 1)

# ------------------------------------------------------------------ 注入源码

# 锚点:六行 var(四张图 + 两组热点)。2x 两行的匹配放宽为「任意单引号内容」,
# 这样首次接入时占位符(空串)也能被替换。
RE_IDLE = re.compile(r"var CURSOR_PNG = 'data:image/png;base64,[A-Za-z0-9+/=]+';")
RE_ACTIVE = re.compile(
    r"var CURSOR_PNG_ACTIVE = 'data:image/png;base64,[A-Za-z0-9+/=]+';")
RE_IDLE_2X = re.compile(r"var CURSOR_PNG_2X = '[^']*';")
RE_ACTIVE_2X = re.compile(r"var CURSOR_PNG_ACTIVE_2X = '[^']*';")
RE_HOT_IDLE = re.compile(r"var HOTSPOT_X = \d+;\s*\n\s*var HOTSPOT_Y = \d+;")
RE_HOT_ACTIVE = re.compile(
    r"var HOTSPOT_ACTIVE_X = \d+;\s*\n\s*var HOTSPOT_ACTIVE_Y = \d+;")


def to_uri(img):
    buf = io.BytesIO()
    img.save(buf, format='PNG', optimize=True)
    raw = buf.getvalue()
    return ('data:image/png;base64,'
            + base64.b64encode(raw).decode('ascii')), len(raw)


def inject(idle_uri, idle2x_uri, active_uri, active2x_uri,
           hot_idle, hot_active):
    """
    把四张图(悬停 1x/2x、按下 1x/2x)与各自热点写回 cursor-fix.js。

    行尾注意:本文件在工作区与仓库中均为 LF(.gitattributes 锁 src/** 为 eol=lf)。
    Python 在 Windows 上默认会把 \n 写成 \r\n,因此必须 newline='' 逐字节保真,
    否则一次注入就把整个文件的行尾翻成 CRLF —— 会污染 diff 并可能影响清单哈希。
    """
    with open(CURSOR_JS, 'r', encoding='utf-8', newline='') as f:
        src = f.read()

    for name, rx in [('CURSOR_PNG', RE_IDLE), ('CURSOR_PNG_ACTIVE', RE_ACTIVE),
                     ('CURSOR_PNG_2X', RE_IDLE_2X),
                     ('CURSOR_PNG_ACTIVE_2X', RE_ACTIVE_2X),
                     ('HOTSPOT', RE_HOT_IDLE), ('HOTSPOT_ACTIVE', RE_HOT_ACTIVE)]:
        if not rx.search(src):
            raise SystemExit('✗ 未在 cursor-fix.js 找到 %s 锚点,注入中止' % name)

    out = RE_IDLE.sub("var CURSOR_PNG = '" + idle_uri + "';", src, count=1)
    out = RE_IDLE_2X.sub("var CURSOR_PNG_2X = '" + idle2x_uri + "';", out, count=1)
    out = RE_ACTIVE.sub("var CURSOR_PNG_ACTIVE = '" + active_uri + "';", out, count=1)
    out = RE_ACTIVE_2X.sub(
        "var CURSOR_PNG_ACTIVE_2X = '" + active2x_uri + "';", out, count=1)
    out = RE_HOT_IDLE.sub('var HOTSPOT_X = %d;\n  var HOTSPOT_Y = %d;'
                          % hot_idle, out, count=1)
    out = RE_HOT_ACTIVE.sub('var HOTSPOT_ACTIVE_X = %d;\n  var HOTSPOT_ACTIVE_Y = %d;'
                            % hot_active, out, count=1)

    with open(CURSOR_JS, 'w', encoding='utf-8', newline='') as f:
        f.write(out)

    print('✓ 已写回 %s(四张图 + 两组热点)' % os.path.relpath(CURSOR_JS, ROOT))

# ------------------------------------------------------------------ 主流程


def main():
    ap = argparse.ArgumentParser(description='生成抓手光标图(1x+2x)并注入 cursor-fix.js')
    ap.add_argument('--shape', default='grab', choices=sorted(SHAPES),
                    help='悬停态手形(默认 grab 抓握形)')
    ap.add_argument('--active-shape', default='grabbing', choices=sorted(SHAPES),
                    help='按下态手形(默认 grabbing 握拳形)')
    ap.add_argument('--outline', type=float, default=1.0,
                    help='描边粗细,单位 CSS px(默认 1.0;1x/2x 图按同视觉厚度折算)')
    ap.add_argument('--color', default='ink', choices=sorted(COLORS),
                    help='描边颜色(默认 ink 近黑)')
    ap.add_argument('--write', action='store_true',
                    help='把结果写回 src/content/cursor-fix.js')
    ap.add_argument('--png', metavar='PATH',
                    help='同时导出 32px PNG(便于目视核对;64px 自动加 @2x 后缀)')
    args = ap.parse_args()

    print('=' * 70)
    print('抓手光标 v2 · 悬停 %s / 按下 %s · outline=%.1fpx color=%s · SS=%d'
          % (args.shape, args.active_shape, args.outline, args.color, SS))
    print('=' * 70)

    hx, hy = HOTSPOT[args.shape]
    ahx, ahy = HOTSPOT[args.active_shape]

    results = {}
    for label, shape in [('悬停', args.shape), ('按下', args.active_shape)]:
        row = {}
        for tag, size in [('1x', BASE), ('2x', BASE * 2)]:
            img = render(shape, COLORS[args.color], args.outline, size)
            uri, nbytes = to_uri(img)
            row[tag] = {'img': img, 'uri': uri, 'bytes': nbytes}
        results[label] = row

    for label in ('悬停', '按下'):
        for tag in ('1x', '2x'):
            r = results[label][tag]
            print('%s %s:PNG %d 字节 / URI %d 字符'
                  % (label, tag, r['bytes'], len(r['uri'])))

    print('-' * 70)
    ok = True
    # 硬门槛只压在浅底上 —— 「白手在浅色商品列表里看不见」才是本功能要修的病灶。
    # 深底不设门槛:那里靠白色填充本身区分,黑色描边贴向深底属正常,不构成隐患。
    for name, bg, required in [('白底', (255, 255, 255), True),
                               ('浅灰', (245, 245, 246), True),
                               ('深底', (43, 47, 54), False)]:
        line = '  边界对比  %s = ' % name
        worst = 1e9
        for label in ('悬停', '按下'):
            for tag in ('1x', '2x'):
                c = edge_contrast(results[label][tag]['img'], bg)
                if required:
                    worst = min(worst, c)
                line += '%s%s %4.0f  ' % (label[0], tag, c)
        if not required:
            line += '(深底靠白色填充区分,不设门槛)'
        elif worst < 100:
            ok = False
            line += '[不足]'
        else:
            line += '[清晰]'
        print(line)

    print('-' * 70)
    print('  锐度(过渡像素占比,越低越锐):')
    for label in ('悬停', '按下'):
        for tag in ('1x', '2x'):
            m = measure(results[label][tag]['img'])
            print('    %s %s:%5.1f%%' % (label, tag, m['soft']))
    print('-' * 70)
    print('判读:浅色底(白/浅灰)对比 >=100 为必需 —— 这正是「白手看不见」的病灶。')
    print('结论:' + ('✓ 浅色商品列表上不会隐形' if ok else '✗ 浅底对比不足,请加粗描边'))

    if args.png:
        p = args.png if os.path.isabs(args.png) else os.path.join(ROOT, args.png)
        results['悬停']['1x']['img'].save(p)
        root, ext = os.path.splitext(p)
        results['悬停']['2x']['img'].save(root + '@2x' + ext)
        print('已导出 PNG:%s 与 %s' % (p, root + '@2x' + ext))

    if args.write:
        inject(results['悬停']['1x']['uri'], results['悬停']['2x']['uri'],
               results['按下']['1x']['uri'], results['按下']['2x']['uri'],
               (hx, hy), (ahx, ahy))
    else:
        print()
        print('(未写回。加 --write 才会更新 src/content/cursor-fix.js)')


if __name__ == '__main__':
    main()
