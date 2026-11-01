/**
 * 【定位】呼吸灯闪烁框层级统一自检(2026-10-20 · #100-附)
 * ============================================================
 * 用户报(附截图):「有些地方的闪烁框会变得不一样」—— 折行行(款号 BC998
 * 那行,名称折两行)的呼吸灯框只有内层小块,不折行的行是整卡。
 *
 * 根因:getAllProductRows 两条取行路径**层级不同** ——
 *   · 主路径 getProductItems:行 = _rowsHost 的直接子元素(整卡);
 *   · 补捞路径 rowOfIdButton:从「ID」按钮向上爬,**第一个**满足宽松判据
 *     (宽≥300、文本≥15、含价格)的祖先就返回 —— 行内信息区就能满足,
 *     于是补捞行比主路径低一两层。折行的行(行高偏离均值 30%)恰是
 *     主路径剔除、只能走补捞的 ⇒ 框小;不折行走主路径 ⇒ 框大。
 * highlight() 的框 = 该元素的盒子 ⇒ 大小不一。
 *
 * 修法:爬升终点对齐 _rowsHost 的直接子元素(与主路径同源);
 * _rowsHost 未建立时退回原判据保底。
 *
 * 本自检:同源抽 rowOfIdButton/isProductRow/looksLikeRowLoose + 手写假
 * DOM(它们只依赖 innerText/parentElement/getBoundingClientRect),覆盖
 * 层级对齐/保底路径/防误认三条线。
 *
 * 跑法:node scripts/自测-呼吸灯框层级.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const LOCATE = fs.readFileSync(path.join(ROOT, 'src/live/locate.js'), 'utf8');

let pass = 0;
const fails = [];
function ok(name, cond, extra) {
  if (cond) { pass++; return; }
  fails.push(name + (extra ? '  → ' + extra : ''));
}

/* ============ 切片(与生产同源) ============ */

function sliceFn(src, header) {
  const i = src.indexOf(header);
  if (i < 0) throw new Error('找不到:' + header);
  let j = i, depth = 0;
  while (j < src.length) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}') { depth--; if (depth === 0) break; }
    j++;
  }
  return src.slice(i, j + 1);
}

/* ============ 假 DOM(只实现三个函数用到的面) ============ */

function fakeEl(opts) {
  opts = opts || {};
  return {
    innerText: opts.text || '',
    parentElement: opts.parent || null,
    isConnected: opts.isConnected !== false,
    getBoundingClientRect: function () {
      return { width: opts.w || 0, height: opts.h || 0, top: opts.top || 0 };
    },
  };
}

/* 模拟中控台一行:
 *   host(共同父节点)
 *   └─ rowCard(host 直接子元素 = 主路径的行,整卡:名称+款号+ID按钮+价格)
 *      ├─ info(信息区:名称+ID按钮+价格 —— 宽度足够满足宽松判据!)
 *      │  ├─ nameSpan
 *      │  └─ idBtn(innerText='ID')
 *      └─ imgBox
 */
const HINTS_TEXT = '到手价';   // isProductRow 的特征词(取词表里的一个)
const NAME_TEXT = HINTS_TEXT + ' 【高奢女装】V领单排扣针织开衫长袖上衣 BC998 ID ¥168.00';

const idBtn = fakeEl({ text: 'ID' });
const nameSpan = fakeEl({ text: '【高奢女装】V领单排扣针织开衫长袖上衣 BC998' });
const info = fakeEl({
  text: NAME_TEXT,
  w: 620, h: 260, top: 100,           // 宽≥300 + 含价格 ⇒ looksLikeRowLoose 为真
  parent: null,                       // 后面接线
});
info.parentElement = null;            // 先置空,再由 rowCard 反向接线
const rowCard = fakeEl({
  text: NAME_TEXT,
  w: 1100, h: 260, top: 100,          // 整卡,满足 isProductRow
  parent: null,
});
const imgBox = fakeEl({ text: '图', w: 200, h: 200, parent: rowCard });
idBtn.parentElement = info;
nameSpan.parentElement = info;
info.parentElement = rowCard;
const host = fakeEl({ text: '', w: 1200, h: 900, parent: null });
rowCard.parentElement = host;

/* ============ 装载生产函数 ============ */

const hintDecl = LOCATE.slice(LOCATE.indexOf('const PRODUCT_HINTS ='),
  LOCATE.indexOf('];', LOCATE.indexOf('const PRODUCT_HINTS =')) + 2);
const ctx = { console: console };
vm.createContext(ctx);
vm.runInContext(
  hintDecl + '\n'
  + sliceFn(LOCATE, 'function isProductRow(') + '\n'
  + sliceFn(LOCATE, 'function looksLikeRowLoose(') + '\n'
  + sliceFn(LOCATE, 'function rowOfIdButton(') + '\n'
  + 'let _rowsHost = null;\n'
  + 'this.__probe = rowOfIdButton; this.__hostRef = function (v) { _rowsHost = v; };', ctx);

const probe = ctx.__probe;
const setHost = ctx.__hostRef;

/* ============ A. 核心层级对齐 ============ */

setHost(host);
const got = probe(idBtn);
ok('★ 补捞行 = _rowsHost 直接子元素(与主路径同层,框一致)', got === rowCard,
  '实际:' + (got === info ? '信息区(内层,旧 bug)' : got === rowCard ? 'rowCard' : String(got)));
ok('★ 不再返回内层信息区(旧 bug 形态消失)', got !== info);

/* ============ B. 保底路径(_rowsHost 未建立) ============ */

setHost(null);
const got2 = probe(idBtn);
ok('_rowsHost 未建立:退回原判据,返回第一个像行的祖先(信息区)', got2 === info,
  '实际:' + String(got2 === info ? 'info(保底行为不变)' : String(got2)));
setHost(host);

/* ============ C. 防误认 ============ */

// ID 按钮不在 host 子树:行卡挂在别的宿主上,12 层内到不了 host 子级 → null
const otherHost = fakeEl({ text: '', w: 1200, h: 900 });
const otherRow = fakeEl({ text: NAME_TEXT, w: 1100, h: 260, parent: otherHost });
rowCard.parentElement = otherHost;   // 断开与 host 的连接
ok('按钮不在 host 子树 → null(不硬凑)', probe(idBtn) === null);

// host 直接子元素但不是行(不满足任何行判据)→ null
const junk = fakeEl({ text: '分隔线', w: 1100, h: 2, parent: host });
idBtn.parentElement = junk;
info.parentElement = junk;
ok('host 子级但不是行 → null(不把分隔元素当行)', probe(idBtn) === null);

/* ============ 汇总 ============ */

console.log('');
console.log('════════ 呼吸灯框层级统一自检 ════════');
console.log('  通过 ' + pass + ' / ' + (pass + fails.length));
if (fails.length) {
  console.log('  ✗ 失败 ' + fails.length + ' 条:');
  fails.forEach(function (f) { console.log('    - ' + f); });
  process.exit(1);
} else {
  console.log('  ✓ 全部通过');
}
