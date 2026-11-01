/**
 * #96 回归自测 —— 直接抽取**源文件里真实的函数源码**跑，不复制粘贴实现
 * ============================================================
 * 目的：验证「货号取值」在下列两种取值路径下都不会抓到右侧列：
 *   A. src/live/live-detail.js（罗盘直播明细，本次战场：整行 <tr>）
 *   B. src/live/copy-code.js （中控台小黄车，同族隐患：复制 ID 按钮父容器）
 *
 * 做法：从源文件里按函数名抠出源码 → 在一个最小 DOM 垫片上 eval → 断言结果。
 * 好处：源码改了这份自测自动跟着变，不会出现「测试绿了但线上还错」。
 *
 * 用法：
 *   node .tmp/test-96-code-pollution.js
 * 退出码 0 = 全绿；1 = 有用例失败。
 * ============================================================
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

/* ============================================================
 * 1. 最小 DOM 垫片（只实现被测函数用到的那一小撮 API）
 * ============================================================ */

const ELEMENT_NODE = 1;
const TEXT_NODE = 3;

class FakeText {
  constructor(value) { this.nodeType = TEXT_NODE; this.nodeValue = value; }
}

class FakeEl {
  constructor(tag, attrs, kids) {
    this.nodeType = ELEMENT_NODE;
    this.tagName = String(tag).toUpperCase();
    this.attrs = attrs || {};
    this.children = kids || [];
    this.parentElement = null;
    for (const c of this.children) if (c instanceof FakeEl) c.parentElement = this;
  }
  getAttribute(name) {
    return Object.prototype.hasOwnProperty.call(this.attrs, name) ? this.attrs[name] : null;
  }
  matches(sel) {                       // 只支持逗号分隔的 [attr] 选择器
    return sel.split(',').map((s) => s.trim()).some((s) => {
      const m = s.match(/^\[([\w-]+)\]$/);
      return m ? this.getAttribute(m[1]) !== null : false;
    });
  }
  get firstChild() { return this.children[0] || null; }
  /** 模拟 textContent：无分隔符拼接（与浏览器一致，不做空白折叠） */
  get textContent() {
    const buf = [];
    (function walk(n) {
      for (const c of n.children) {
        if (c.nodeType === TEXT_NODE) buf.push(c.nodeValue);
        else walk(c);
      }
    })(this);
    return buf.join('');
  }
  /** 模拟 innerText：把子树所有文本按渲染序拼起来（这正是污染的来源） */
  get innerText() {
    const buf = [];
    (function walk(n) {
      for (const c of n.children) {
        if (c.nodeType === TEXT_NODE) buf.push(c.nodeValue);
        else walk(c);
      }
    })(this);
    return buf.join(' ').replace(/\s+/g, ' ').trim();
  }
}

const NodeFilter = {
  FILTER_ACCEPT: 1, FILTER_REJECT: 2, FILTER_SKIP: 3,
  SHOW_ELEMENT: 0x1, SHOW_TEXT: 0x4
};

/** 简化版 TreeWalker：只做「按文档序前序遍历 + acceptNode」 */
function makeTreeWalker(root, what, filter) {
  const seq = [];
  (function walk(n) {
    for (const c of n.children || []) {
      const type = c.nodeType === TEXT_NODE ? NodeFilter.SHOW_TEXT : NodeFilter.SHOW_ELEMENT;
      if (what & type) {
        const verdict = filter && filter.acceptNode ? filter.acceptNode(c) : NodeFilter.FILTER_ACCEPT;
        if (verdict === NodeFilter.FILTER_REJECT) continue;     // 整棵跳过
        if (verdict === NodeFilter.FILTER_ACCEPT) seq.push(c);
      }
      if (c.nodeType === ELEMENT_NODE) walk(c);
    }
  })(root);
  let i = -1;
  return { nextNode: () => (++i < seq.length ? seq[i] : null) };
}

global.NodeFilter = NodeFilter;
global.document = { createTreeWalker: makeTreeWalker };

/* ============================================================
 * 2. 从源文件抠函数源码（按函数名 + 花括号配平）
 * ============================================================ */

function sliceFunction(src, name) {
  const key = 'function ' + name + '(';
  const at = src.indexOf(key);
  if (at < 0) throw new Error('源文件里找不到 function ' + name);
  let i = src.indexOf('{', at);
  let depth = 0;
  for (let j = i; j < src.length; j++) {
    const ch = src[j];
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return src.slice(at, j + 1);
    }
  }
  throw new Error('花括号未配平：' + name);
}

function sliceVar(src, name) {
  const re = new RegExp('var\\s+' + name + '\\s*=\\s*[^;]+;');
  const m = src.match(re);
  if (!m) throw new Error('源文件里找不到 var ' + name);
  return m[0];
}

/** 把若干片段拼成一个函数体并求值，返回导出对象 */
function buildModule(srcPath, fnNames, varNames, extra) {
  const src = fs.readFileSync(srcPath, 'utf8');
  const parts = [];
  for (const v of varNames || []) parts.push(sliceVar(src, v));
  for (const f of fnNames) parts.push(sliceFunction(src, f));
  const body = (extra || '') + '\n' + parts.join('\n') + '\nreturn {' + fnNames.join(',') + '};';
  return new Function(body)();
}

/* ============================================================
 * 3. 构造测试行（照抄截图结构）
 * ============================================================ */

const NAME_TEXT = 'PM王囡囡 黑/白色菱格纹双头拉链领外套 NE1C1091W';

/**
 * 罗盘直播明细的一行：<tr> = 序号 | 商品信息 | 成交件数 | 支付金额 | 点击人数 | 成交率
 * 商品信息格里：缩略图 + 名称 + 我们注入的「货号」按钮
 */
function buildLiveDetailRow(dealText) {
  const name = new FakeEl('div', {}, [new FakeText(NAME_TEXT)]);
  const ourBtn = new FakeEl('button', { 'data-dyc-ld-btn': '1' }, [new FakeText('货号')]);
  const infoCell = new FakeEl('td', {}, [
    new FakeEl('img', {}, []),
    name,
    ourBtn
  ]);
  const tr = new FakeEl('tr', {}, [
    new FakeEl('td', {}, [new FakeText('1')]),
    infoCell,
    new FakeEl('td', {}, [new FakeText(dealText)]),
    new FakeEl('td', {}, [new FakeText('¥131,395.55')]),
    new FakeEl('td', {}, [new FakeText('5,341')]),
    new FakeEl('td', {}, [new FakeText('5.2%')])
  ]);
  return { tr, nameEl: name };
}

/**
 * 中控台小黄车的一行：名称 + 平台「复制 ID」按钮 + 我们注入的「货号」按钮（并排），
 * 之后是「到手价 ¥xxx」等。给一个会「紧挨右列数字」的变体以验证同族隐患已修。
 */
function buildLiveCtrlRow(rightText) {
  const name = new FakeEl('div', {}, [new FakeText(NAME_TEXT)]);
  const idBtn = new FakeEl('span', { title: '复制 ID' }, [new FakeText('ID')]);
  const ourBtn = new FakeEl('button', { 'data-dyc-code-btn': '1' }, [new FakeText('货号')]);
  const host = new FakeEl('div', {}, [name, idBtn, ourBtn]);
  const tr = new FakeEl('div', {}, [host, new FakeEl('div', {}, [new FakeText(rightText)])]);
  return { tr, nameEl: name, idBtn };
}

/* ============================================================
 * 4. 跑两条取值路径，断言「永远是款号，绝不是右列数字」
 * ============================================================ */

const NAME = sliceFunction(fs.readFileSync(path.join(ROOT, 'src/live/live-detail.js'), 'utf8'), 'isCodeLike');
const EXPECT_CODE = 'NE1C1091W';

let pass = 0, fail = 0;
const failures = [];

function check(label, got, from) {
  const ok = got === EXPECT_CODE;
  if (ok) pass++; else { fail++; failures.push(label + ' → 得到 ' + JSON.stringify(got)); }
  console.log('  ' + (ok ? '✓' : '✗') + ' ' + label.padEnd(44) +
    '取值=' + String(got).padEnd(12) + '来源=' + String(from));
}

/* ---------- A. live-detail.js ---------- */
console.log('\n=========== A. src/live/live-detail.js（罗盘直播明细）===========');

const LD = buildModule(
  path.join(ROOT, 'src/live/live-detail.js'),
  ['isCodeLike', 'isExtNode', 'textWithoutExt', 'infoCellOf', 'readOfficialCode', 'guessFromName', 'readCode'],
  ['EXT_MARKS']
);

const DEALS = ['0', '7', '42', '99', '100', '340', '999', '1,000', '1,234', '12,345', '340.5', '340件', '-'];
for (const d of DEALS) {
  const { tr, nameEl } = buildLiveDetailRow(d);
  const r = LD.readCode(tr, nameEl);
  check('成交件数=' + d, r.code, r.from);
}

/* 反向：平台**真的**写了货号时，必须照读（含纯数字货号） */
console.log('  -- 平台真货号（必须照读，含纯数字）--');
for (const official of ['10086', 'NE1C0021W', 'A12']) {
  const name = new FakeEl('div', {}, [new FakeText(NAME_TEXT)]);
  const label = new FakeEl('span', {}, [new FakeText('货号')]);
  const val = new FakeEl('span', {}, [new FakeText(official)]);
  const ourBtn = new FakeEl('button', { 'data-dyc-ld-btn': '1' }, [new FakeText('货号')]);
  const infoCell = new FakeEl('td', {}, [name, label, val, ourBtn]);
  const tr = new FakeEl('tr', {}, [new FakeEl('td', {}, [new FakeText('1')]), infoCell,
    new FakeEl('td', {}, [new FakeText('340')])]);
  const r = LD.readCode(tr, name);
  const ok = r.code === official && r.from === 'official';
  if (ok) pass++; else { fail++; failures.push('平台真货号 ' + official + ' → ' + JSON.stringify(r)); }
  console.log('  ' + (ok ? '✓' : '✗') + ('平台真货号=' + official).padEnd(44) +
    '取值=' + String(r.code).padEnd(12) + '来源=' + r.from);
}

/* 反向 2：平台把「货号:X」写在**另一个单元格**里时，仍要能退整行读到 */
console.log('  -- 平台货号在别的单元格（需退整行兜底）--');
for (const official of ['NE1C0021W', '10086']) {
  const name = new FakeEl('div', {}, [new FakeText(NAME_TEXT)]);
  const ourBtn = new FakeEl('button', { 'data-dyc-ld-btn': '1' }, [new FakeText('货号')]);
  const infoCell = new FakeEl('td', {}, [name, ourBtn]);
  const otherCell = new FakeEl('td', {}, [
    new FakeEl('span', {}, [new FakeText('货号')]),
    new FakeEl('span', {}, [new FakeText(official)])
  ]);
  const tr = new FakeEl('tr', {}, [new FakeEl('td', {}, [new FakeText('1')]), infoCell, otherCell,
    new FakeEl('td', {}, [new FakeText('340')])]);
  const r = LD.readCode(tr, name);
  const ok = r.code === official && r.from === 'official';
  if (ok) pass++; else { fail++; failures.push('别格货号 ' + official + ' → ' + JSON.stringify(r)); }
  console.log('  ' + (ok ? '✓' : '✗') + ('别格货号=' + official).padEnd(44) +
    '取值=' + String(r.code).padEnd(12) + '来源=' + r.from);
}

/* ---------- B. copy-code.js ---------- */
console.log('\n=========== B. src/live/copy-code.js（中控台小黄车）===========');

// 该文件依赖 findPlatformIdButton / extractValueAfterLabel，用测试桩顶上
const stubs = `
function findPlatformIdButton(row) {
  var found = null;
  (function walk(n){ for (var i=0;i<(n.children||[]).length;i++){
    var c=n.children[i];
    if (c.nodeType===3) continue;
    if (c.getAttribute('title')==='复制 ID') { found=c; return; }
    walk(c); if (found) return;
  }})(row);
  return found;
}
function extractValueAfterLabel(root, label) {
  // 极简桩：找文本恰为标签的元素，取下一个兄弟的文本
  var hit=null;
  (function walk(n){ for (var i=0;i<(n.children||[]).length;i++){
    var c=n.children[i];
    if (c.nodeType===3) continue;
    if (!hit && c.innerText===label && c.children.length===1 && c.children[0].nodeType===3) hit=c;
    walk(c); if (hit) return;
  }})(root);
  if (!hit || !hit.parentElement) return null;
  var kids=hit.parentElement.children, idx=kids.indexOf(hit);
  for (var k=idx+1;k<kids.length;k++){
    if (kids[k].nodeType===3) continue;
    var t=kids[k].innerText;
    if (t) return t;
  }
  return null;
}
`;

const CC = buildModule(
  path.join(ROOT, 'src/live/copy-code.js'),
  ['isCodeLike', 'isExtNode', 'textWithoutExt', 'readOfficialCode', 'guessFromName', 'readCode'],
  ['EXT_MARKS'],
  stubs
);

for (const d of ['340', '1234', '340.5', '5', '42']) {
  const { tr, nameEl } = buildLiveCtrlRow(d);
  const r = CC.readCode(tr, nameEl);
  check('（同族）右邻裸数字=' + d, r.code, r.from);
}
for (const d of ['¥131,395.55', '5,341', '5.2%']) {
  const { tr, nameEl } = buildLiveCtrlRow(d);
  const r = CC.readCode(tr, nameEl);
  check('（同族）右邻=' + d, r.code, r.from);
}

/* ---------- C. 污染源自证：证明 innerText 确实会拼出「货号 340」 ---------- */
console.log('\n=========== C. 污染源自证（innerText vs textWithoutExt）===========');
{
  const { tr, nameEl } = buildLiveDetailRow('340');
  const dirty = tr.innerText;
  const clean = LD.textWithoutExt(LD.infoCellOf(nameEl));
  const dirtyHit = (dirty.match(/货号\s*[:：]?\s*([A-Za-z0-9\-_]{3,30})/) || [])[1] || null;
  const cleanHit = (clean.match(/货号\s*[:：]?\s*([A-Za-z0-9\-_]{3,30})/) || [])[1] || null;
  console.log('  整行 innerText     : ' + dirty);
  console.log('    └ 正则命中       : ' + dirtyHit + (dirtyHit ? '   ← 这就是 bug' : ''));
  console.log('  纯页面文本(信息格) : ' + (clean || '(空)'));
  console.log('    └ 正则命中       : ' + cleanHit + (cleanHit ? '   ← 不应出现' : '   ← 正确，无污染'));
  const ok = dirtyHit === '340' && cleanHit === null;
  if (ok) pass++; else { fail++; failures.push('污染源自证未按预期'); }
}

/* ---------- 汇总 ---------- */
console.log('\n' + '='.repeat(62));
console.log('通过 ' + pass + ' / ' + (pass + fail));
if (fail) {
  console.log('失败用例：');
  failures.forEach((f) => console.log('  · ' + f));
  process.exit(1);
}
console.log('全绿 ✓  —— 「复制到右列数字」这一类问题在两条取值路径上都不再成立');
