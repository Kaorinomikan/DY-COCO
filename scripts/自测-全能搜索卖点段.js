/**
 * 【全能搜索】卖点栏纳入搜索自检(2026-10-20 · #100 附 · 方案B)
 * ============================================================
 * 用户拍板:方案 B —— 卖点独立成组。三问中问 2/问 3 按评审稿推荐执行:
 *   问 2 = 占位词只当占位剔除;问 3 = 卖点数字跟名称口径(子串)。
 *
 * 本自检三层:
 *   A. 静态 —— 五处接入(登记/匹配/rowHits/hitsKeywords/高亮)全部就位且同源;
 *   B. 切段 —— getSellPoint 与生产同源真跑:用户截图真实行形态 × 设置/未设置
 *      × 三种已设置形态,占位词「设置卖点」绝不返回;
 *   C. 匹配 —— 卖点组子串命中、价格口径不回归、搜「设置卖点」不命中。
 *
 * 跑法:node scripts/自测-全能搜索卖点段.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const LOCATE = fs.readFileSync(path.join(ROOT, 'src/live/locate.js'), 'utf8');
const SEARCH = fs.readFileSync(path.join(ROOT, 'src/live/search.js'), 'utf8');

let pass = 0;
const fails = [];
function ok(name, cond, extra) {
  if (cond) { pass++; return; }
  fails.push(name + (extra ? '  → ' + extra : ''));
}

/* ============ 切片工具(与生产同源,不手写副本) ============ */

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

/** 抽 const 声明(支持跨行 new RegExp 拼接):扫到深度 0 且遇「;」为止 */
function sliceDecl(src, header) {
  const i = src.indexOf(header);
  if (i < 0) throw new Error('找不到:' + header);
  let j = i, depth = 0;
  while (j < src.length) {
    const c = src[j];
    if (c === '(' || c === '{' || c === '[') depth++;
    else if (c === ')' || c === '}' || c === ']') depth--;
    else if (c === ';' && depth === 0) break;
    j++;
  }
  return src.slice(i, j + 1);
}

/* ============ A. 静态 ============ */

ok('① locate.js:getSellPoint 存在', /function getSellPoint\(/.test(LOCATE));
ok('① 占位词表只含「未设提词|设置卖点」', /SELL_PLACEHOLDER_RE = \/未设提词\|设置卖点\/g/.test(LOCATE));
ok('① 切段与名称共用 NAME_CUT_RE(单一事实来源)',
  sliceFn(LOCATE, 'function getSellPoint(').indexOf('NAME_CUT_RE') !== -1);

const CAPTURE = sliceFn(SEARCH, 'function capture() {');
ok('② 登记处:sptext / spct 两版都在',
  CAPTURE.indexOf('getSellPoint(el, rowText)') !== -1
  && CAPTURE.indexOf('sptext: normText(sell)') !== -1
  && CAPTURE.indexOf('spct: compactText(sell)') !== -1);

const LOOP = SEARCH.slice(SEARCH.indexOf('const matches = [];'), SEARCH.indexOf('if (ok) matches.push(row.ordinal);'));
ok('③ 匹配循环:卖点分支在价格分支之前(三分支)',
  LOOP.indexOf('nameHit(row.sptext, kw)') !== -1
  && LOOP.indexOf('nameHit(row.spct, kw)') !== -1
  && LOOP.indexOf('nameHit(row.sptext, kw)') < LOOP.indexOf('priceHit(row.ptext'));

const ROWHITS = sliceFn(SEARCH, 'function rowHits(text) {');
ok('④ 原生观察窗 rowHits:**不含**卖点分支(卖点 = 全能搜索独占,#121)',
  ROWHITS.indexOf('getSellPoint') === -1
  && ROWHITS.indexOf('nameHit(st') === -1
  && ROWHITS.indexOf('priceHit(') !== -1);
ok('④ 原生观察窗 rowHits:名称先用 getProductName 切段(整行文本会把卖点带进来)',
  ROWHITS.indexOf('getProductName(') !== -1);

const HITKEY = sliceFn(SEARCH, 'function hitsKeywords(el) {');
ok('④ 定位校验 hitsKeywords:卖点分支接入',
  HITKEY.indexOf('getSellPoint(el, rowText)') !== -1
  && HITKEY.indexOf('nameHit(s, kw)') !== -1);

const MARK = sliceFn(SEARCH, 'function markNameOnRow(rowEl, opts) {');
ok('⑤ 高亮:卖点区间定位 + inSell 重叠判定',
  MARK.indexOf('getSellPoint(rowEl, rowText)') !== -1
  && MARK.indexOf('const inSell = sStart >= 0 && it.start < sEnd && itEnd > sStart;') !== -1
  && MARK.indexOf('!inName && !inSell && !isPriceLeaf') !== -1);

// #121(2026-10-26):原生搜索路径染色同样不认卖点 —— 三处原生调用都带 noSell
const NO_SELL_CALLS = SEARCH.match(/markNameOnRow\([^)]*noSell: true/g) || [];
ok('⑤ 原生染色排除卖点:noSell 开关 + 三处原生调用全带',
  MARK.indexOf('const allowSell = !(opts && opts.noSell);') !== -1
  && MARK.indexOf('const sellFlat = allowSell') !== -1
  && NO_SELL_CALLS.length === 3, '实际调用数:' + NO_SELL_CALLS.length);
// 反过来:全能搜索那处(定位命中行)必须**不传** noSell,否则卖点不涂色
ok('⑤ 全能搜索染色保持三段:定位命中行的调用不带 noSell',
  /markNameOnRow\(el\);/.test(SEARCH));

/* ============ D. 悬停文案(2026-10-26 #121) ============ */

ok('⑥ 浮动框提示语常量是唯一事实来源',
  /const PH_OURS = '货号\/商品名\/价格\/卖点，支持多关键词';/.test(SEARCH));
ok('⑥ 工具栏【全能搜索】按钮 title = 浮动框提示语',
  /setAttribute\(\s*'title',\s*PH_OURS\)/.test(SEARCH));
ok('⑥ 胶囊内【全能搜索】按钮 title = 浮动框提示语',
  /sbBtn\('', PH_OURS\)/.test(SEARCH));
// 2026-10-29 反馈 #125 改口径：圆钮是「打开搜索的入口」，名字用功能名
// 「全能搜索」；胶囊输入框那句能力描述仍归输入框，不跟着改。
ok('⑥ 浮动圆钮的气泡与无障碍名字 = 功能名「全能搜索」(#125)',
  /const FAB_LABEL = '全能搜索';/.test(SEARCH)
  && /'<span class="dyc-tip">' \+ FAB_LABEL \+ '<\/span>'/.test(SEARCH)
  && /setAttribute\('aria-label', FAB_LABEL\)/.test(SEARCH));
ok('⑥ 旧文案已无残留:气泡与 aria-label 都不再写死「搜索小黄车」',
  SEARCH.indexOf('<span class="dyc-tip">搜索小黄车') === -1
  && SEARCH.indexOf("setAttribute('aria-label', '搜索小黄车')") === -1);

/* ============ E. 原生搜索的能力边界(2026-10-26 #121 用户定) ============
 *
 * 用户原话:「原生搜索只能有原生功能,不要有我后加的功能,但是搜出来的东西
 * 要有背景色涂抹和闪烁效果」。→ 断言四件事:
 *   ① 平台说 0 结果 ⇒ 兜底找行立即收工(不许把「搜不到」变成「搜到了」);
 *   ② 计数没读到时等下一轮,不猜;
 *   ③ 不滚屏(滚动是接管视线,属于能力;视觉只有涂抹 + 闪烁);
 *   ④ 涂抹与闪烁两个视觉动作都还在。
 */

const FLASH = sliceFn(SEARCH, 'function flashAfterNativeSearch(raw) {');

ok('⑦ 原生边界:平台 0 结果 → 兜底立即收工(不造命中)',
  FLASH.indexOf('nativeResultTotal()') !== -1
  && FLASH.indexOf('if (total === 0) return;') !== -1);
ok('⑦ 原生边界:计数没读到时等下一轮(不替平台下结论)',
  FLASH.indexOf('if (total === null)') !== -1);
ok('⑦ 原生视觉:命中行跑出视口才补滚动(在视口内不挪,不抢平台定位)',
  FLASH.indexOf('if (!inView) scrollElementToViewportCenter(hit);') !== -1
  && FLASH.indexOf('const r = hit.getBoundingClientRect();') !== -1);
ok('⑦ 原生视觉:涂抹 + 闪烁都还在',
  FLASH.indexOf('markNameOnRow(') !== -1
  && FLASH.indexOf('highlight(') !== -1);
ok('⑦ 结果总数只认平台箭头旁的 N/M,不自己数行',
  /function nativeResultTotal\(\)/.test(SEARCH)
  && /parseInt\(m\[2\], 10\)/.test(SEARCH));

/* ============ B. 切段(生产同源真跑) ============ */

const LOC_DECL = ['NAME_NUM_FIELDS', 'NAME_PRICE_WORDS', 'NAME_MARK_WORDS',
  'NAME_MARK_HEAD_RE', 'NAME_MARK_TAIL_RE', 'NAME_CUT_RE', 'NAME_HEAD_RE',
  'SELL_PLACEHOLDER_RE', 'SELL_NOISE_RE'].map(function (n) {
  return sliceDecl(LOCATE, 'const ' + n + ' =');
}).join('\n');
const LOC_NAME = sliceFn(LOCATE, 'function getProductName(');
const SEARCH_DECL = ['foldWidth', 'normText', 'compactText'].map(function (n) {
  return sliceFn(SEARCH, 'function ' + n + '(');
}).join('\n');

const ctx = { console: console };
vm.createContext(ctx);
vm.runInContext(LOC_DECL + '\n' + LOC_NAME + '\n' + sliceFn(LOCATE, 'function getSellPoint(')
  + '\n' + SEARCH_DECL + '\n'
  + sliceFn(SEARCH, 'function foldPrice(') + '\n'
  + sliceFn(SEARCH, 'function priceAllFromText(') + '\n'
  + sliceFn(SEARCH, 'function priceJoinedFromText(') + '\n'
  + sliceFn(SEARCH, 'function priceHit(') + '\n'
  + sliceFn(SEARCH, 'function nameHit(') + '\n'
  + 'this.__sell = getSellPoint; this.__name = getProductName;'
  + 'this.__nt = normText; this.__ct = compactText;'
  + 'this.__nh = nameHit; this.__ph = priceHit; this.__fp = foldPrice;', ctx);

const sell = ctx.__sell, nameOf = ctx.__name;
const nt = ctx.__nt, ct = ctx.__ct, nh = ctx.__nh, ph = ctx.__ph, fp = ctx.__fp;

// 用户 2026-10-20 截图的真实行形态(未设置卖点):名称 + ID货号按钮 +
// 小字区「未设提词 设置卖点」+ 价格/数量/金额/佣金字段 + 操作按钮
const ROW_NONE = '【高奢女装】圆领T恤条纹撞色上衣A0634 ID 货号 未设提词 设置卖点 '
  + '¥79.00 0/0 到手价 售出/库存 ¥0.00 成交金额 0% 佣金率 营销活动 预热 设置提词 编辑尺码表 下架';

ok('★ 未设置态:切段为空(占位词剥净,无内容可搜)', sell(null, ROW_NONE) === '');
ok('★ 「设置卖点」四字绝不出现 in 切段结果', sell(null, ROW_NONE).indexOf('设置卖点') === -1);

// 已设置形态 1:入口文案被卖点内容替换(平台惯例形态)
const ROW_SET1 = '【高奢女装】圆领T恤条纹撞色上衣A0634 ID 货号 未设提词 透气 冰丝夏装薄款 '
  + '¥79.00 0/0 到手价 ¥0.00 0% 营销活动 预热';
ok('设置态①(文案替换):切出「透气 冰丝夏装薄款」',
  sell(null, ROW_SET1) === '透气 冰丝夏装薄款', '实际:' + JSON.stringify(sell(null, ROW_SET1)));

// 已设置形态 2:带「卖点」标签词(已知局限:标签不剥,内容可命中即可)
const ROW_SET2 = '【高奢女装】圆领T恤条纹撞色上衣A0634 ID 货号 未设提词 卖点 透气 冰丝 '
  + '¥79.00 0/0 到手价 ¥0.00 0% 营销活动';
ok('设置态②(带标签):内容仍在切段里',
  sell(null, ROW_SET2).indexOf('透气 冰丝') !== -1, '实际:' + JSON.stringify(sell(null, ROW_SET2)));

// 已设置形态 3:内容在前、占位按钮仍在后
const ROW_SET3 = '【高奢女装】圆领T恤条纹撞色上衣A0634 ID 货号 未设提词 透气 冰丝 设置卖点 '
  + '¥79.00 0/0 到手价 ¥0.00 0% 营销活动';
ok('设置态③(内容+占位并存):占位词剥净、内容保留',
  sell(null, ROW_SET3) === '透气 冰丝', '实际:' + JSON.stringify(sell(null, ROW_SET3)));

// 名称不受影响(名称与卖点分离,不回归)
// 注:getProductName 旧守卫要求 el 存在(生产里调用方都传真元素),传空壳绕开
const FAKE_EL = {};
ok('名称切分不受卖点影响:名称不含卖点内容',
  nameOf(FAKE_EL, ROW_SET1).indexOf('透气') === -1
  && nameOf(FAKE_EL, ROW_SET1).indexOf('圆领T恤条纹撞色上衣A0634') !== -1,
  '实际:' + JSON.stringify(nameOf(FAKE_EL, ROW_SET1)));

// 行首字段剥离与名称同步(切段不因行首字段拉长)
const ROW_HEAD = '库存 999 透气冰丝吊带裙 未设提词 透气显瘦 ¥59.00 0/0 到手价';
ok('行首有字段时切段仍准:切出「透气显瘦」',
  sell(null, ROW_HEAD) === '透气显瘦', '实际:' + JSON.stringify(sell(null, ROW_HEAD)));

// 异常路径
ok('空文本 → 空', sell(null, '') === '' && sell(null, null) === '');
ok('无字段起点的行 → 空', sell(null, '随便一行文字没有价格') === '');

/* ============ C. 匹配(卖点组子串 + 口径不回归) ============ */

/** 模拟登记+匹配(与 capture/runSearch 同构) */
function kwHits(rowText, raw) {
  const name = nameOf({}, rowText) || '';
  const sp = sell(null, rowText) || '';
  const row = {
    text: nt(name), ctext: ct(name),
    sptext: nt(sp), spct: ct(sp),
    ptext: fp(ctx.__pj ? ctx.__pj(rowText) : ''),
  };
  const kws = raw.split(/\s+/);
  for (let i = 0; i < kws.length; i++) {
    const kw = kws[i];
    if (nh(row.text, kw) || nh(row.ctext, kw)) continue;
    if (nh(row.sptext, kw) || nh(row.spct, kw)) continue;
    if (ph(row.ptext, fp(kw))) continue;
    return false;
  }
  return true;
}
vm.runInContext('this.__pj = priceJoinedFromText;', ctx);

ok('★ 搜「透气」命中(卖点组子串)', kwHits(ROW_SET1, '透气'));
ok('搜「冰丝」命中(卖点组子串)', kwHits(ROW_SET1, '冰丝'));
ok('搜「透气 冰丝」多关键词 AND 命中', kwHits(ROW_SET1, '透气 冰丝'));
ok('搜「设置卖点」不命中(占位词绝不成为命中原因)', !kwHits(ROW_NONE, '设置卖点'));
ok('搜「未设提词」不命中', !kwHits(ROW_NONE, '未设提词'));
ok('价格口径不回归:¥79.00 搜「79」命中(价格组)', kwHits(ROW_SET1, '79'));
// 「0」口径:名称/卖点/价格三组都不含「0」完整形态时,搜「0」不命中
// (款号 A0634 里的 0 走名称子串照命中 —— 那是 2026-10-14 定的名称口径,非回归)
const ROW_NOZERO = '测试连衣裙B21 ID 货号 未设提词 透气 冰丝 ¥79.00 0/0 到手价 0% 营销活动';
ok('价格口径不回归:三组皆无「0」形态时搜「0」不命中', !kwHits(ROW_NOZERO, '0'));
ok('#100 全段化自然结果:行内有 ¥0.00 时搜「0」命中(0 是它的完整整数段,行为正确)',
  kwHits(ROW_SET1, '0'));
ok('卖点数字跟名称口径(子串):搜「95」命中卖点「限时95折」',
  (function () {
    const ROW95 = '测试连衣裙 未设提词 限时95折 ¥199.00 0/0 到手价';
    return kwHits(ROW95, '95');
  })());
ok('未设置卖点时搜卖点词不误捞(名称/价格里没有就不中)', !kwHits(ROW_NONE, '透气'));

/* ---- 原生搜索口径(生产 rowHits 真跑):名称 + 价格,不含卖点 —— #121 ---- */

vm.runInContext(
  'var keywords = [];\n' + ROWHITS + '\n'
  + 'this.__rh = rowHits; this.__setKw = function (k) { keywords = k; };',
  ctx);
const rowHitsNative = ctx.__rh, setKw = ctx.__setKw;

setKw([nt('透气')]);
ok('★ 原生口径:卖点词「透气」不命中(与全能搜索相反)',
  rowHitsNative(ROW_SET1) === false);
setKw([nt('冰丝')]);
ok('★ 原生口径:卖点词「冰丝」不命中', rowHitsNative(ROW_SET1) === false);
setKw([nt('79')]);
ok('原生口径:价格仍命中(缩窄只砍卖点,不误伤价格)', rowHitsNative(ROW_SET1) === true);
setKw([nt('圆领T恤')]);
ok('原生口径:名称仍命中', rowHitsNative(ROW_SET1) === true);
setKw([nt('圆领T恤'), nt('透气')]);
ok('原生口径:名称 + 卖点混搜不命中(卖点那半票拿不到)', rowHitsNative(ROW_SET1) === false);

/* ============ 汇总 ============ */

console.log('');
console.log('════════ #100 附 · 卖点栏纳入搜索自检 ════════');
console.log('  通过 ' + pass + ' / ' + (pass + fails.length));
if (fails.length) {
  console.log('  ✗ 失败 ' + fails.length + ' 条:');
  fails.forEach(function (f) { console.log('    - ' + f); });
  process.exit(1);
} else {
  console.log('  ✓ 全部通过');
}
