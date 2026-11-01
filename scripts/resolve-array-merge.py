#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
三方语义合并 · 面向「数组字面量」文件的自动解冲突

============================================================
为什么需要它(2026-10-11 实测得出,别再用 git 自带方案)
============================================================
两个并行任务都往同一个数组(如 DYC_FLAGS_META)里加一项时,git 必然报冲突。
实测过两条看似可行的路,都被否掉:

  ✗ git merge-file --union
    「两边都保留」在这里是错的。git 会把双方**共有**的尾部
    (default / pages / 收尾的 `},`)当成公共部分挪到冲突块之外,
    union 于是把冲突块内两侧的**前半段**直接堆在一起 ——
    结果是两个对象字段揉成 ONE 个对象:
        { key:'backToTop', ..., key:'skuSearch', ... }
    语法合法(node --check 放行),但 backToTop 丢了 default/pages,
    只有运行时才炸。**静默损坏,比报错更危险。**

  ✗ 手工拼接 <<<<<<< 冲突块
    同上:冲突块里只有对象的前半段,拼不出完整对象。

  ✓ 本脚本:回到三方(base / ours / theirs),按「数组元素」重新组合
    1. 从 base 切出原有元素,作为骨架
    2. ours 相对 base 新增的元素 → ours_new
    3. theirs 相对 base 新增的元素 → theirs_new
    4. 单边改动采用改的那侧;两侧新增按 key 排序追加
    每个元素都是**从原始文件整段抠出来的完整对象字面量**,
    不是重新拼字符串,所以不可能丢字段。

============================================================
适用前提(不满足就报错退出,绝不猜)
============================================================
  · 文件是「一个顶层数组字面量」:形如 var NAME = [ ... ]; 或 const NAME = [ ... ];
  · 每个元素是完整的对象字面量
  · 对象里有 key 字段作为身份标识(缺失则退化为按内容比对)
  · 数组之外只有一行声明头,末尾只有 ]; —— 元素外的代码三方一致

用法:
  python scripts/resolve-array-merge.py <base> <ours> <theirs> <输出> [数组名]

  数组名:可选。一个文件里可能有多个顶层数组(如 flags.js 同时有
  DYC_FLAG_GROUPS 与 DYC_FLAGS_META),**必须指定**才能确定要合哪个。
  缺省则自动选择「元素最多的那个数组」,并在多个并列时报错要求显式指定。

退出码:0=成功 / 1=无法自动解,需人工 / 2=用法错误
"""

import hashlib
import io
import re
import sys


class MergeFail(Exception):
    pass


ARRAY_RE = re.compile(
    r"^[ \t]*(?:var|let|const)[ \t]+([A-Za-z_$][\w$]*)[ \t]*=[ \t]*\[", re.M
)


def read_raw(path):
    with io.open(path, 'r', encoding='utf-8', newline='') as f:
        return f.read()


def detect_nl(text):
    if '\r\n' in text:
        return '\r\n'
    return '\n'


def split_lines(text):
    return text.splitlines(True)


def body(line):
    return line.rstrip('\r\n')


def _decl_prefix(line, text, m):
    """声明行只保留到数组 '[' 为止(含 '['),后面的空白丢掉。"""
    if m is None:
        return line
    line_start_off = text.rfind('\n', 0, m.start()) + 1
    keep = text[line_start_off:m.end()]        # 如 "var X = ["
    nl = line[len(line.rstrip('\r\n')):]
    return keep + nl


def scan(text, want_name=None):
    """
    找出顶层数组并切分元素。
    返回 dict(name, prefix, elems, suffix, n_arrays)
      prefix: 数组 '[' 所在行**之前**的所有行
      elems:  [[行, 行, ...], ...] 每个元素一组
      suffix: '];' 所在行**开始**的所有行(含 '];')
    """
    lines = split_lines(text)
    found = []

    for m in ARRAY_RE.finditer(text):
        name = m.group(1)
        open_off = m.end() - 1

        # 从 '[' 之后扫到配平的 ']'(跳过字符串与注释)
        pos = m.end()
        depth = 1
        n = len(text)
        in_s = None
        close_off = -1
        while pos < n:
            ch = text[pos]
            if in_s:
                if ch == '\\':
                    pos += 2
                    continue
                if ch == in_s:
                    in_s = None
            else:
                if ch in '"\'':
                    in_s = ch
                elif ch == '/' and pos + 1 < n and text[pos + 1] == '/':
                    while pos < n and text[pos] != '\n':
                        pos += 1
                    continue
                elif ch in '([{':
                    depth += 1
                elif ch in ')]}':
                    depth -= 1
                    if depth == 0:
                        close_off = pos
                        break
            pos += 1
        if close_off < 0:
            continue    # 没闭合,跳过

        start_line = text[:open_off].count('\n')
        elems = split_elements(text[open_off + 1:close_off])
        found.append({
            'name': name,
            'elems': elems,
            'prefix': lines[:start_line],
            'suffix': None,   # 下面填
            '_start_line': start_line,
            '_open_off': open_off,
            '_close_off': close_off,
            '_m': m,
        })

    if not found:
        raise MergeFail('没找到任何形如 `var NAME = [` 的顶层数组')

    # 选定目标
    if want_name:
        cand = [f for f in found if f['name'] == want_name]
        if not cand:
            raise MergeFail('文件里没有数组 %s(现有:%s)'
                            % (want_name, ', '.join(f['name'] for f in found)))
        chosen = cand[0]
    else:
        # 元素最多的那个
        mx = max(len(f['elems']) for f in found)
        top = [f for f in found if len(f['elems']) == mx]
        if len(top) > 1:
            raise MergeFail('文件里有多个同样大的数组(%s),请显式指定数组名'
                            % ', '.join(f['name'] for f in top))
        chosen = top[0]

    # 切 prefix / suffix
    sl = chosen['_start_line']
    prefix = lines[:sl]
    prefix.append(_decl_prefix(lines[sl], text, chosen['_m']))

    close_line_no = text[:chosen['_close_off']].count('\n')
    suffix = lines[close_line_no:]
    # 该行从行首到 ']' 之前的内容要丢,只保留 ']' 及其后。
    # 注意 lines[] 已经含完整行,这里取 close_off 在行内的偏移来截。
    line_start = text.rfind('\n', 0, chosen['_close_off']) + 1
    suffix[0] = text[line_start:].split('\n', 1)[0]
    # 若 ']' 与 ';' 之间有空格等,这里已原样保留

    chosen['prefix'] = prefix
    chosen['suffix'] = suffix
    return chosen


def split_elements(inner):
    """把数组内部文本按顶层逗号切成若干元素(各为 str,含换行)。"""
    elems = []
    depth = 0
    in_s = None
    buf = []
    i = 0
    n = len(inner)
    while i < n:
        ch = inner[i]
        if in_s:
            buf.append(ch)
            if ch == '\\' and i + 1 < n:
                buf.append(inner[i + 1])
                i += 2
                continue
            if ch == in_s:
                in_s = None
            i += 1
            continue
        if ch in '"\'':
            in_s = ch
            buf.append(ch)
            i += 1
            continue
        if ch == '/' and i + 1 < n and inner[i + 1] == '/':
            j = inner.find('\n', i)
            if j < 0:
                j = n
            buf.append(inner[i:j])
            i = j
            continue
        if ch in '([{':
            depth += 1
        elif ch in ')]}':
            depth -= 1
        if ch == ',' and depth == 0:
            elems.append(''.join(buf))
            buf = []
            i += 1
            continue
        buf.append(ch)
        i += 1
    tail = ''.join(buf)
    if tail.strip():
        elems.append(tail)
    return elems


def elem_key(e):
    """元素身份:优先 key: 'xxx',否则内容哈希。"""
    m = re.search(r"""\bkey\s*:\s*['"]([^'"]+)['"]""", e)
    if m:
        return 'key:' + m.group(1)
    return 'sha:' + hashlib.sha256(norm(e).encode('utf-8')).hexdigest()[:16]


def norm(s):
    return s.replace('\r\n', '\n').strip()


def fingerprint(e):
    return hashlib.sha256(norm(e).encode('utf-8')).hexdigest()


def merge_arrays(base, ours, theirs):
    bm = {elem_key(e): e for e in base}
    om = {elem_key(e): e for e in ours}
    tm = {elem_key(e): e for e in theirs}

    result = []
    for bk, b in bm.items():
        o = om.get(bk)
        t = tm.get(bk)
        bf, of, tf = fingerprint(b), (fingerprint(o) if o else None), (fingerprint(t) if t else None)

        if o is None and t is None:
            raise MergeFail('两侧都删了 base 元素 %s —— 不自动处理' % bk)
        elif o is None:
            result.append(t)
        elif t is None:
            result.append(o)
        elif of == bf and tf == bf:
            result.append(b)
        elif of == bf:
            result.append(t)
        elif tf == bf:
            result.append(o)
        else:
            raise MergeFail(
                '元素 %s 被双方同时改动且内容不同,需人工:\n      ours  : %s\n      theirs: %s'
                % (bk, brief(o), brief(t))
            )

    ours_new = [e for k, e in om.items() if k not in bm]
    theirs_new = [e for k, e in tm.items() if k not in bm]

    if ours_new and theirs_new:
        dup = {elem_key(e) for e in ours_new} & {elem_key(e) for e in theirs_new}
        if dup:
            raise MergeFail('两个任务新增了同名元素 %s —— 必须人工确认'
                            % ', '.join(sorted(dup)))

    added = sorted(ours_new + theirs_new, key=elem_key)
    if added:
        print('  新增 %d 个元素:' % len(added))
        for e in added:
            print('    + %s' % brief(e))
    result.extend(added)
    return result


def brief(e):
    m = re.search(r"""\bkey\s*:\s*['"]([^'"]+)['"]""", e)
    if m:
        return m.group(1)
    return norm(e).splitlines()[0][:40] if norm(e) else '(空)'


def do_merge(base_p, ours_p, theirs_p, out_p, arr_name=None):
    b = scan(read_raw(base_p), arr_name)
    o = scan(read_raw(ours_p), arr_name)
    t = scan(read_raw(theirs_p), arr_name)

    print('目标数组:%s' % b['name'])
    print('元素数: base=%d ours=%d theirs=%d'
          % (len(b['elems']), len(o['elems']), len(t['elems'])))

    merged = merge_arrays(b['elems'], o['elems'], t['elems'])

    # 以 ours 的前后文为准(它可能带了本分支的注释改动)
    nl = detect_nl(read_raw(ours_p))
    prefix = ''.join(o['prefix'])
    if not prefix.endswith(nl):
        prefix += nl

    parts = [prefix]
    for e in merged:
        seg = _indent(e, nl)
        # 逗号跟在最后一个非空行末尾,不能单独占一行
        seg = seg.rstrip('\r\n')
        seg = (seg.rstrip().rstrip(',') + ',') + nl
        parts.append(seg)
    body_txt = ''.join(parts)
    if not body_txt.endswith(nl):
        body_txt += nl

    suffix = ''.join(o['suffix'])
    out = body_txt + suffix
    with io.open(out_p, 'w', encoding='utf-8', newline='') as f:
        f.write(out)
    print('✓ 已写出 %s(元素 %d 个)' % (out_p, len(merged)))


def _indent(e, nl):
    """
    给元素每行补两空格缩进,但**保留原有相对缩进**。
    (早期版本用 strip() 重排,会把源码格式全毁 —— 那是重写不是合并)
    """
    raw = e.replace('\r\n', '\n')
    lines = raw.split('\n')
    # 去掉首尾空行(切分时元素常带前导换行)
    while lines and not lines[0].strip():
        lines.pop(0)
    while lines and not lines[-1].strip():
        lines.pop()
    if not lines:
        return ''
    # 去掉公共前导空白,再统一加两格
    common = min((len(l) - len(l.lstrip()) for l in lines if l.strip()), default=0)
    out = []
    for l in lines:
        stripped = l[common:] if len(l) >= common else l.strip()
        out.append(('  ' + stripped).rstrip() + nl)
    return ''.join(out)


def main(argv):
    args = [a for a in argv[1:] if not a.startswith('-')]
    if len(args) not in (4, 5):
        print(__doc__)
        return 2
    arr_name = args[4] if len(args) == 5 else None
    try:
        do_merge(args[0], args[1], args[2], args[3], arr_name)
    except MergeFail as e:
        print('\n✗ 无法自动合并:')
        print('  %s' % e)
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv))