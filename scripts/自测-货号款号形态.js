/**
 * 货号「款号判据」自测 —— 单一真源 + 四个消费方接线
 * ============================================================
 * 判据只有一份：`src/content/item-code.js`（2026-11-12 收敛，此前四份副本）。
 * 本自测分两半：
 *   A. 判据本身（3 位款号 / 斜杠复合款号 / 尺码排除 / 老行为不变 / 两档一致）
 *   B. 四个消费方**确实接到共享判据上**：
 *        · 静态：不许再出现 `function isCodeLike` / `var SIZE_ONLY` 这类本地实现
 *        · 动态：抠出各模块的 guessFromName 注入共享判据，喂真商品名必须取到
 *
 * 做法与「自测-货号取值.js」一致：**从源文件抠真实函数源码跑**，不复制实现。
 *
 * 用法：node scripts/自测-货号款号形态.js   退出码 0 = 全绿
 * ============================================================
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SRC_UNDER_TEST = 'src/content/item-code.js';

/** 消费方（四个页面取的是同一批商品名，判据必须共用一份） */
const CONSUMERS = [
  'src/live/copy-code.js',
  'src/live/compass-table.js',
  'src/live/live-detail.js',
  'src/live/live-screen.js'
];

/** 按函数名抠出源码（花括号配平） */
function sliceFunction(text, name) {
  const key = 'function ' + name + '(';
  const at = text.indexOf(key);
  if (at < 0) throw new Error('源文件里找不到 function ' + name);
  const i = text.indexOf('{', at);
  let depth = 0;
  for (let j = i; j < text.length; j++) {
    const ch = text[j];
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return text.slice(at, j + 1);
    }
  }
  throw new Error('花括号未配平：' + name);
}

/* ============================================================
 * A. 载入共享判据（把整个文件当普通脚本执行，拿它声明的全局）
 * ============================================================ */
const sharedSrc = fs.readFileSync(path.join(ROOT, SRC_UNDER_TEST), 'utf8');

const judge = new Function(
  sharedSrc + '\nreturn { isCodeLike: dycIsCodeLike, isSizeOnly: dycIsSizeOnly, ' +
  'pick: dycPickCodeFromName, official: dycFindOfficialInText, selfCheck: dycCodeSelfCheck };'
)();
const { isCodeLike, pick: guessFromName, official: findOfficial } = judge;

/* ---------- 断言工具 ---------- */
let pass = 0, fail = 0;
const failures = [];

function eq(label, got, want) {
  const ok = got === want;
  if (ok) pass++;
  else { fail++; failures.push(label + ' → 得到 ' + JSON.stringify(got) + '，期望 ' + JSON.stringify(want)); }
  console.log('  ' + (ok ? '✓' : '✗') + ' ' + label.padEnd(50) + '取值=' + JSON.stringify(got));
}

function no(label, got) {
  const ok = got === false;
  if (ok) pass++;
  else { fail++; failures.push(label + ' → 期望 false，得到 ' + JSON.stringify(got)); }
  console.log('  ' + (ok ? '✓' : '✗') + ' ' + label.padEnd(50) + '结果=' + JSON.stringify(got));
}

function noMatch(label, got) {
  const ok = got === '';
  if (ok) pass++;
  else { fail++; failures.push(label + ' → 期望空，得到 ' + JSON.stringify(got)); }
  console.log('  ' + (ok ? '✓' : '✗') + ' ' + label.padEnd(50) + '结果=' + JSON.stringify(got));
}

/** 造一个只有 textContent 的假名称元素 */
function nameOf(t) { return { textContent: t }; }

/* ============================================================
 * 1. 名称尾部取款号（真实商品名，取自用户反馈与真机日志）
 * ============================================================ */
console.log('\n=========== 1. 名称尾部推算 · 真实商品名 ===========');

eq('复合款号（两款式共用链接）',
  guessFromName('【KiKi】【金绒流年】燕麦/乌木色羊毛老钱风背心外套 M609Y0544/0686'),
  'M609Y0544/0686');

eq('3 位款号（#137 现场）',
  guessFromName('ARMS WELL 王囡囡 黑色丝毛侧拉链半身裙（有内衬）S28'),
  'S28');

eq('5 位款号（老行为不变）',
  guessFromName('PM王囡囡 杏色连帽抽绳拉链外套 6XL25'),
  '6XL25');

eq('8 位款号（老行为不变）',
  guessFromName('PM 粉色带扣勃肯鞋（跟高：4cm）NC1D0813'),
  'NC1D0813');

eq('带 W 后缀款号（老行为不变）',
  guessFromName('PM王囡囡 粉格羊毛白鹅绒小香羽绒外套 NE1C1163W'),
  'NE1C1163W');

eq('纯数字货号（用户明确要保留）',
  guessFromName('某测试商品 10086'),
  '10086');

/* ============================================================
 * 2. 尺码不得被当款号（放宽到 3 位后的主要副作用）
 * ============================================================ */
console.log('\n=========== 2. 尺码写法 · 必须不认 ===========');

noMatch('尺码 2XL', guessFromName('某连衣裙 2XL'));
noMatch('尺码 3XL', guessFromName('某连衣裙 3XL'));
noMatch('尺码 2XL/3XL', guessFromName('某连衣裙 2XL/3XL'));
noMatch('尺码 XXL', guessFromName('某连衣裙 XXL'));
noMatch('尺码 XL/S', guessFromName('某连衣裙 XL/S'));

/* ============================================================
 * 3. 不该认的东西
 * ============================================================ */
console.log('\n=========== 3. 无款号 / 中文斜杠 ===========');

noMatch('纯中文名称', guessFromName('羊毛老钱风背心外套'));
noMatch('中文斜杠不算款号', guessFromName('燕麦/乌木色背心外套'));
noMatch('空名称', guessFromName(''));
noMatch('末尾两字符', guessFromName('某外套 A7'));
noMatch('英文词结尾', guessFromName('某外套 summer dress'));

/* ============================================================
 * 4. isCodeLike / 官方档提取
 * ============================================================ */
console.log('\n=========== 4. isCodeLike 与官方档提取 ===========');

eq('3 位款号 S28', isCodeLike('S28'), true);
eq('复合款号 M609Y0544/0686', isCodeLike('M609Y0544/0686'), true);
eq('三段复合 A1B/C2D/E3F', isCodeLike('A1B/C2D/E3F'), true);
eq('5 位 6XL25', isCodeLike('6XL25'), true);
eq('纯数字 10086', isCodeLike('10086'), true);
no('中文斜杠 燕麦/乌木色', isCodeLike('燕麦/乌木色'));
no('单字符 A', isCodeLike('A'));
no('四段 A1/B2/C3/D4', isCodeLike('A1/B2/C3/D4'));
no('空串', isCodeLike(''));
no('超长 31 位', isCodeLike('A'.repeat(31)));

eq('官方档：平台写了整串复合货号', findOfficial('商品名 货号 M609Y0544/0686 库存 3'), 'M609Y0544/0686');
eq('官方档：普通货号', findOfficial('货号：NE1C0021W'), 'NE1C0021W');
noMatch('官方档：正则命中但形态不合法', findOfficial('货号 A1 库存'));

/* ============================================================
 * 5. 两档一致性（#137 的根因就是两档口径分叉）
 * ============================================================ */
console.log('\n=========== 5. 一致性：推算档认的，isCodeLike 必须也认 ===========');

[
  '【KiKi】【金绒流年】燕麦/乌木色羊毛老钱风背心外套 M609Y0544/0686',
  'ARMS WELL 王囡囡 黑色丝毛侧拉链半身裙（有内衬）S28',
  'PM王囡囡 杏色连帽抽绳拉链外套 6XL25',
  'PM 粉色带扣勃肯鞋（跟高：4cm）NC1D0813',
  '某测试商品 10086',
  '某外套 A1B/C2D'
].forEach((n) => {
  const got = guessFromName(n);
  eq('推算结果非空：' + n.slice(-14), got !== '', true);
  if (got) eq('  且 isCodeLike 认可 ' + got, isCodeLike(got), true);
});

/* ============================================================
 * 6. 唯一性护栏（防止有人把判据抄回某个模块）
 * ============================================================ */
console.log('\n=========== 6. 唯一性：四个模块不许再自带判据 ===========');

CONSUMERS.forEach((file) => {
  const src = fs.readFileSync(path.join(ROOT, file), 'utf8');
  const short = file.replace('src/live/', '');
  eq(short + ' 无本地 isCodeLike', /function\s+isCodeLike\s*\(/.test(src), false);
  eq(short + ' 无本地 SIZE_ONLY', /var\s+SIZE_ONLY\s*=/.test(src), false);
  eq(short + ' 无本地 isSizeOnly', /function\s+isSizeOnly\s*\(/.test(src), false);
  eq(short + ' 接了共享推算', /dycPickCodeFromName\s*\(/.test(src), true);
  eq(short + ' 接了共享官方档', /dycFindOfficialInText\s*\(/.test(src), true);
});

/* ============================================================
 * 7. 接线护栏（静态字符串不算数，真跑一遍各模块的取号函数）
 * ============================================================ */
console.log('\n=========== 7. 接线：四个模块各跑一遍真商品名 ===========');

const NAMES = [
  ['ARMS WELL 王囡囡 黑色丝毛侧拉链半身裙（有内衬）S28', 'S28'],
  ['【KiKi】【金绒流年】燕麦/乌木色羊毛老钱风背心外套 M609Y0544/0686', 'M609Y0544/0686'],
  ['PM王囡囡 杏色连帽抽绳拉链外套 6XL25', '6XL25']
];

CONSUMERS.forEach((file) => {
  const src = fs.readFileSync(path.join(ROOT, file), 'utf8');
  // 罗盘那份的 guessFromName 走 textWithoutExt（TreeWalker），这里给等价桩
  const stub = 'var textWithoutExt = function (el) { return (el && el.textContent) || ""; };\n';
  const fn = new Function(
    sharedSrc + '\n' + stub + sliceFunction(src, 'guessFromName') + '\nreturn guessFromName;'
  )();
  const short = file.replace('src/live/', '');
  NAMES.forEach(([name, want]) => {
    eq(short + ' 取到 ' + want, fn(nameOf(name)), want);
  });
});

/* ---------- 7b. 粘贴加车：剪贴板解析（第五个消费方，同族问题） ---------- */
console.log('\n----------- 7b. 粘贴加车 parseCode（剪贴板）-----------');
{
  const cpSrc = fs.readFileSync(path.join(ROOT, 'src/live/cart-paste.js'), 'utf8');
  const parseCode = new Function(
    sharedSrc + '\n' + sliceFunction(cpSrc, 'parseCode') + '\nreturn parseCode;'
  )();
  eq('剪贴板：整串复合款号', parseCode('M609Y0544/0686'), 'M609Y0544/0686');
  eq('剪贴板：商品名尾部复合款号',
    parseCode('【KiKi】【金绒流年】燕麦/乌木色羊毛老钱风背心外套 M609Y0544/0686'),
    'M609Y0544/0686');
  eq('剪贴板：商品名尾部 3 位款号',
    parseCode('ARMS WELL 王囡囡 黑色丝毛侧拉链半身裙（有内衬）S28'), 'S28');
  eq('剪贴板：普通款号原样', parseCode('ABC123'), 'ABC123');
  noMatch('剪贴板：纯尺码不当款号', parseCode('2XL'));
  const parseBody = sliceFunction(cpSrc, 'parseCode');
  eq('cart-paste 的 parseCode 走共享判据',
    /dycPickCodeFromName\s*\(/.test(parseBody) && /dycIsCodeLike\s*\(/.test(parseBody), true);
}

/* ============================================================
 * 8. 共享文件自带的自检
 * ============================================================ */
console.log('\n=========== 8. item-code.js 自带自检 ===========');
{
  const r = judge.selfCheck();
  eq('dycCodeSelfCheck() 全绿', r.ok, true);
  if (!r.ok) console.log('    失败项：' + r.bad.join(' / '));
}

/* ---------- 收尾 ---------- */
console.log('\n============================================================');
console.log('通过 ' + pass + ' 项，失败 ' + fail + ' 项');
if (fail) {
  console.log('\n失败明细：');
  failures.forEach((f) => console.log('  · ' + f));
  process.exit(1);
}
console.log('全绿。');
