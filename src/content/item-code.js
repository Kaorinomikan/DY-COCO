/**
 * 商品款号判据 —— ★★ 唯一真源 ★★（2026-11-12 收敛）
 *
 * 一份规则，四个页面共用：
 *   · 中控台小黄车      src/live/copy-code.js
 *   · 罗盘商品表        src/live/compass-table.js
 *   · 罗盘直播明细      src/live/live-detail.js
 *   · 直播大屏          src/live/live-screen.js
 *
 * 【为什么要收敛】
 *   这四个页面取的都是**同一批商品名**（平台同一套数据，只是换了表格壳），
 *   原先各自抄了一份 `isCodeLike` / `guessFromName` / 「货号 xxx」正则 —— 正则逐字相同。
 *   抄四份的代价在 2026-11-12 兑现了：修 #137（3 位款号 S28 取不到）时只改了一处，
 *   另外三处照旧坏着，表现为「中控台能取到、罗盘取不到」这种跨页不一致，
 *   排查时极易误判成平台改版。
 *   ⇒ 判据只留这一份；四个模块只负责**在这张页面上读哪段文本**（那是页面差异，
 *     本来就该各写各的：有的走 textContent，有的要剔除自家按钮的文案）。
 *
 * 【改动纪律】
 *   改这里 = 同时改四个页面。改完必须跑：
 *     node scripts/自测-货号款号形态.js
 *   它除了验行为，还静态检查四个模块里**不许再出现**判据实现（防止有人顺手抄回去）。
 *
 * 【加载顺序】
 *   必须在上面四个模块之前加载（见 manifest.json 各 content_scripts 的 js 数组，
 *   紧跟 flags.js 之后）。否则点按钮时取不到这些全局函数。
 *
 * 【为什么用 var / function 而不是 const / 对象封装】
 *   与 flags.js 同因：内容脚本是普通 <script> 语义，var + function 声明才稳落在
 *   全局对象上，后续脚本直接可见；老内核（360 极速浏览器X）上也没有模块系统可用。
 */

/* ==========================================================
 * 一、款号形态判据
 * ========================================================== */

/** 款号长度区间（含端点） */
var DYC_CODE_MIN = 3;
var DYC_CODE_MAX = 30;

/**
 * 纯尺码写法（不是款号）：2XL / 3XL / XXL / XL / S / XL/S 这类。
 *
 * 【为什么单独列一条】
 *   款号下限是 3 位，而 `2XL` / `3XL` 恰好是「3 位 + 含数字」，形态上会被当成款号
 *   复制出去，用户拿到手才发现是尺码。
 *
 * 【为什么用整串精确匹配，而不是「以 X 结尾就排除」】
 *   `6XL25` 是**真款号**（真机日志里命中过商品），任何前缀 / 包含式规则都会把它误杀。
 *   所以只排除**整串就是一个尺码**（含斜杠写多个尺码）的情况。
 */
var DYC_CODE_SIZE_ONLY = /^(?:X{0,3}[SML]|[2-6]XL)(?:\/(?:X{0,3}[SML]|[2-6]XL))*$/i;

/** 整串（含斜杠分段）是否只是尺码 */
function dycIsSizeOnly(s) {
  return !!s && DYC_CODE_SIZE_ONLY.test(s);
}

/**
 * 像款号吗：3~30 位，字母数字 / 连字符 / 下划线，**允许斜杠分段**（最多 3 段）。
 *
 * 【两条口径的来历】
 *   ① 下限 3 位。原正则 `{2,29}` 合计量词本来就是 3~30，但四个模块的
 *      `guessFromName` 又各写了一道 `length < 4`，把 3 位款号（如 `S28`）挡在门外
 *      —— 同一个串「被判为像款号」却在下一档被否掉，是纯口径不一致（#137 的根因）。
 *   ② 复合款号。平台会把两个款式挂在同一个链接上，为省字数只写一个合成串：
 *      `M609Y0544/0686`（= M609Y0544 + 同前缀补尾号的 0686）。用户要的是**整串**，
 *      所以斜杠必须算款号字符。
 *   ③ 段数上限 3：再多基本是误抓。名称里的「燕麦/乌木色」这类中文斜杠
 *      靠 ASCII 字符集天然排除，不需要额外规则。
 *
 * @param {string} s
 * @return {boolean}
 */
function dycIsCodeLike(s) {
  if (!s) return false;
  if (s.length < DYC_CODE_MIN || s.length > DYC_CODE_MAX) return false;
  return /^[A-Za-z0-9][A-Za-z0-9\-_]*(?:\/[A-Za-z0-9][A-Za-z0-9\-_]*){0,2}$/.test(s);
}

/* ==========================================================
 * 二、两档取号
 * ========================================================== */

/**
 * 名称末尾推算：末尾「≥3 位且含数字」的字母数字串（可含斜杠分段）。
 *
 * 这是**推算**，不是平台数据 —— 平台没在小黄车展示「货号」字段时只能这么取。
 * 名称末尾不是款号（比如以「夏季新款」「dress」结尾）时返回 ''，绝不瞎猜。
 *
 * 必须含数字：纯英文字尾（英文词 / 拼音）多半不是款号。
 *
 * @param {string} text 商品名文本（已折叠空白；调用方负责取到正确的元素）
 * @return {string} 款号；取不到返回 ''
 */
function dycPickCodeFromName(text) {
  var t = String(text || '').replace(/\s+/g, ' ').trim();
  if (!t) return '';
  var m = t.match(/([A-Za-z0-9][A-Za-z0-9\-_]*(?:\/[A-Za-z0-9][A-Za-z0-9\-_]*){0,2})\s*$/);
  if (!m) return '';
  var cand = m[1];
  if (cand.length < DYC_CODE_MIN) return '';
  if (cand.length > DYC_CODE_MAX) return '';
  if (!/\d/.test(cand)) return '';
  if (dycIsSizeOnly(cand)) return '';
  return cand;
}

/**
 * 官方「货号 xxx」提取：在一段**已剔除扩展节点**的页面文本里找平台写的货号。
 *
 * ⚠️ 输入必须不含我们自己注入的按钮文案（按钮就叫「货号」），否则会把右邻列
 *    的数字当货号复制走 —— 2026-10-18 反馈 #96 的真机事故（成交件数 340）。
 *    各模块的 textWithoutExt() 负责这件事，本函数只管从干净文本里取值。
 *
 * 字符集含 `/`：复合款号 `M609Y0544/0686` 在平台里也是一个整体（#137）。
 *
 * @param {string} text
 * @return {string} 货号；没有返回 ''
 */
function dycFindOfficialInText(text) {
  var t = String(text || '');
  if (!t) return '';
  var m = t.match(/货号\s*[:：]?\s*([A-Za-z0-9\-_\/]{3,30})/);
  if (m && dycIsCodeLike(m[1])) return m[1];
  return '';
}

/* ==========================================================
 * 三、自检（只在控制台手动调用，不参与运行时）
 * ========================================================== */

/**
 * 在控制台跑 `dycCodeSelfCheck()` 可确认本文件已正确加载。
 * 加载顺序一旦写错（本文件没进来），这里会是 undefined —— 比按钮默默失灵好排查。
 */
function dycCodeSelfCheck() {
  // [串, isCodeLike 期望, 名称末尾推算期望]
  //   注意 2XL：**形态上像款号**（3 位 + 含数字），isCodeLike 判 true 是对的；
  //   拦住它的是推算档的尺码排除。这两档职责不同，别把期望写混。
  var cases = [
    ['S28', true, 'S28'],
    ['M609Y0544/0686', true, 'M609Y0544/0686'],
    ['6XL25', true, '6XL25'],
    ['NC1D0813', true, 'NC1D0813'],
    ['10086', true, '10086'],
    ['2XL', true, ''],
    ['燕麦/乌木色', false, '']
  ];
  var bad = [];
  for (var i = 0; i < cases.length; i++) {
    var code = cases[i][0];
    var wantOk = cases[i][1];
    var wantPick = cases[i][2];
    if (dycIsCodeLike(code) !== wantOk) bad.push(code + ' · isCodeLike');
    if (dycPickCodeFromName('某商品 ' + code) !== wantPick) bad.push(code + ' · pickFromName');
  }
  return bad.length ? { ok: false, bad: bad } : { ok: true };
}
