/**
 * 【全能搜索】标价 95 搜不出修复自检(2026-10-20 · #100)
 * ============================================================
 * 用户报:「标价95价格的衣服,没办法用全能搜索搜出来」。
 *
 * 根因:价格登记只取行文本里**第一个** ¥/$ 段 —— 划线原价(如 ¥1899)
 * 排在现价 ¥95 前面时,登记的 ptext 永远是 "1899",搜「95」必然不中。
 *
 * 修法:priceAllFromText 全取所有 ¥/$ 段;priceJoinedFromText 用「|」
 * 连接(防 foldPrice 折叠后数字段粘连);登记 / rowHits / hitsKeywords
 * 三处同源换用;高亮价格叶子判定改多段集合。
 *
 * 本自检两层:
 *   A. 静态 —— 三处同源、旧函数已删、分隔符就位;
 *   B. 执行 —— 抽生产函数真跑,覆盖划线价在前/千分位/全角/$价/多段
 *      × 命中/不命中双向断言 + 防粘连回归 + 2026-10-14 口径不回归。
 *
 * 跑法:node scripts/自测-全能搜索价格全段.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const SEARCH = fs.readFileSync(path.join(ROOT, 'src/live/search.js'), 'utf8');

let pass = 0;
const fails = [];
function ok(name, cond, extra) {
  if (cond) { pass++; return; }
  fails.push(name + (extra ? '  → ' + extra : ''));
}

/* ============ 切片工具 ============ */

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

/* ============ A. 静态 ============ */

ok('旧 priceFromText 已删除(不留死代码)', SEARCH.indexOf('function priceFromText') === -1);
ok('旧 getRowPrice 已删除(0 引用死代码)', SEARCH.indexOf('getRowPrice') === -1);
ok('priceAllFromText 存在', /function priceAllFromText\(/.test(SEARCH));
ok('priceJoinedFromText 存在且用「|」连接', /function priceJoinedFromText\(/.test(SEARCH)
  && /\.join\('\|'\)/.test(SEARCH));
ok('全局匹配符 /g 在 priceAllFromText 上(全取所有段)',
  /const ms = t\.match\(\/[^/]*\/g\);/.test(SEARCH));

// 三处消费同源(登记 / 原生观察窗 / 定位校验)
const CAPTURE = sliceFn(SEARCH, 'function capture() {');
ok('① 登记处 capture 用 priceJoinedFromText',
  CAPTURE.indexOf('priceJoinedFromText(rowText)') !== -1
  && CAPTURE.indexOf('priceFromText(') === -1);

const ROWHITS = sliceFn(SEARCH, 'function rowHits(text) {');
ok('② 原生观察窗 rowHits 用 priceJoinedFromText',
  ROWHITS.indexOf('priceJoinedFromText(text)') !== -1
  && ROWHITS.indexOf('priceFromText(') === -1);

const HITKEY = sliceFn(SEARCH, 'function hitsKeywords(el) {');
ok('③ 定位校验 hitsKeywords 用 priceJoinedFromText',
  HITKEY.indexOf('priceJoinedFromText(rowText)') !== -1
  && HITKEY.indexOf('priceFromText(') === -1);

// 高亮处:多段集合判定
const MARK = sliceFn(SEARCH, 'function markNameOnRow(rowEl, opts) {');
ok('④ 高亮价格叶子 = 多段集合包含判定',
  MARK.indexOf('priceAllFromText(rowText).map(foldPrice)') !== -1
  && MARK.indexOf('priceFlats.indexOf(foldPrice(raw)) !== -1') !== -1
  && MARK.indexOf('priceFromText(') === -1);

/* ============ B. 执行 ============ */

const FOLDW = sliceFn(SEARCH, 'function foldWidth(');
const FOLDP = sliceFn(SEARCH, 'function foldPrice(');
const ALL = sliceFn(SEARCH, 'function priceAllFromText(');
const JOIN = sliceFn(SEARCH, 'function priceJoinedFromText(');
const PHIT = sliceFn(SEARCH, 'function priceHit(');
const NHIT = sliceFn(SEARCH, 'function nameHit(');

const ctx = { console: console };
vm.createContext(ctx);
vm.runInContext(FOLDW + '\n' + FOLDP + '\n' + ALL + '\n' + JOIN + '\n'
  + PHIT + '\n' + NHIT + '\n'
  + 'this.__all = priceAllFromText; this.__join = priceJoinedFromText;'
  + 'this.__phit = priceHit; this.__fp = foldPrice; this.__nhit = nameHit;', ctx);

const priceAll = ctx.__all, priceJoined = ctx.__join;
const fp = ctx.__fp, phit = ctx.__phit, nhit = ctx.__nhit;

/** 模拟登记侧:行文本 → ptext(foldPrice 折叠后) */
function ptextOf(rowText) { return fp(priceJoined(rowText) || ''); }
/** 模拟主匹配:关键词是否命中价格 */
function kwHitsPrice(rowText, kw) { return phit(ptextOf(rowText), fp(kw)); }

// --- 核心 #100 场景:划线原价在前,现价 95 在后 ---
ok('#100 划线价在前:¥1899 ¥95 搜「95」命中', kwHitsPrice('¥1899 ¥95', '95'));
ok('#100 划线价在前:搜「1899」也命中(原价也在行内)', kwHitsPrice('¥1899 ¥95', '1899'));
ok('#100 全角￥:￥1899 ￥95 搜「95」命中', kwHitsPrice('￥1899 ￥95', '95'));
ok('#100 千分位:¥1,899 ¥95 搜「1899」命中', kwHitsPrice('¥1,899 ¥95', '1899'));
ok('#100 千分位:¥1,899 ¥95 搜「95」命中', kwHitsPrice('¥1,899 ¥95', '95'));
ok('#100 小数现价:¥1899 ¥95.00 搜「95」命中(整数段)', kwHitsPrice('¥1899 ¥95.00', '95'));
ok('#100 与名称并存:连衣裙…¥1899 ¥95 搜「95」命中', kwHitsPrice('连衣裙 法式碎花 ¥1899 ¥95', '95'));

// --- 分隔符防粘连的关键回归 ---
ok('防粘连:两段不缝成一个数字段(搜「9995」不中)', !kwHitsPrice('¥1899 ¥95', '9995'));
ok('防粘连:「189995」不中(粘连形态的反面断言)', !kwHitsPrice('¥1899 ¥95', '189995'));

// --- 原口径不回归(2026-10-14 收紧的完整数字段) ---
ok('口径:¥136.00 搜「0」不中', !kwHitsPrice('¥136.00', '0'));
ok('口径:¥136.00 搜「136」中', kwHitsPrice('¥136.00', '136'));
ok('口径:¥136.00 搜「00」中(小数段)', kwHitsPrice('¥136.00', '00'));
ok('口径:¥1899 ¥95 搜「99」不中(非完整数字段)', !kwHitsPrice('¥1899 ¥95', '99'));
ok('口径:¥1899 ¥95 搜「899」不中(非完整数字段)', !kwHitsPrice('¥1899 ¥95', '899'));
ok('口径:单价格行为不变 ¥95 搜「9」不中', !kwHitsPrice('¥95', '9'));
ok('口径:单价格行为不变 ¥95 搜「95」中', kwHitsPrice('¥95', '95'));

// --- $ / 多段顺序 ---
ok('$ 价:¥1899 $95 搜「95」命中', kwHitsPrice('¥1899 $95', '95'));
ok('三段:¥199 ¥129 ¥95 搜「129」命中', kwHitsPrice('¥199 ¥129 ¥95', '129'));
ok('三段:¥199 ¥129 ¥95 搜「95」命中', kwHitsPrice('¥199 ¥129 ¥95', '95'));

// --- 空值与异常路径 ---
ok('空文本 → ptext 为空串', ptextOf('') === '');
ok('无 ¥ 符号 → 抓空(根因 b 本期不动,行为不回归)', ptextOf('95 元') === '');
ok('无 ¥ 符号时搜「95」不中(不把名称数字当价格)', !kwHitsPrice('95 元', '95'));

// --- 高亮侧同口径:叶子是否被认成价格叶子 ---
function leafIsPrice(rowText, leafRaw) {
  const flats = priceAll(rowText).map(fp);
  return flats.length > 0 && flats.indexOf(fp(leafRaw)) !== -1;
}
ok('高亮:¥1899 ¥95 行里「¥95」叶子认成价格叶子', leafIsPrice('¥1899 ¥95', '¥95'));
ok('高亮:¥1899 ¥95 行里「¥1899」叶子也认成价格叶子', leafIsPrice('¥1899 ¥95', '¥1899'));
ok('高亮:名称叶子「连衣裙」不认成价格叶子', !leafIsPrice('连衣裙 ¥95', '连衣裙'));

/* ============ 汇总 ============ */

console.log('');
console.log('════════ #100 价格全段修复自检 ════════');
console.log('  通过 ' + pass + ' / ' + (pass + fails.length));
if (fails.length) {
  console.log('  ✗ 失败 ' + fails.length + ' 条:');
  fails.forEach(function (f) { console.log('    - ' + f); });
  process.exit(1);
} else {
  console.log('  ✓ 全部通过');
}
