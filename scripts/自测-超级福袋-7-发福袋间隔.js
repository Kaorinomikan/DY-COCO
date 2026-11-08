/**
 * 自测 · 超级福袋（第 7/7 组：发福袋间隔滑条）
 * ============================================================
 * 2026-11-05 用户需求（原话）：
 *   「当打开按钮【自动发福袋】之后，他的下方常驻的一个灰色滑动条会恢复颜色，
 *    这个滑动条负责控制发福袋的间隔，可以从 0 分钟拖动到 5 分钟，步进 30 秒。
 *    当倒计时结束后，会自动数这个设定的时间，时间到了才会执行下一轮福袋，
 *    当然在这个前提下，依然遵守自动发福袋的流程，而不是倒计时结束立刻发福袋。」
 *
 * 拆成四类断言：
 *   ① 面板：常驻在开关下方、自绘、0~300 秒 / 30 秒一档、11 根刻度；
 *   ② 灰态：开关关着整组置灰且拖不动，打开即恢复颜色；
 *   ③ 取值：吸附到 30 秒档、两端钳住、文本用「分 秒」不用小数分钟；
 *   ④ 时序：倒计时结束后按设定值等待，到点才走原来的自动流程；
 *      默认 0 时行为与从前完全一致（不额外等）。
 *
 * 用法：
 *   NODE_PATH=<node_modules> node scripts/自测-超级福袋-7-发福袋间隔.js
 * 退出码 0 = 全绿；1 = 有用例失败。
 */
'use strict';

/* 被测源文件：--changed 的反查靠这一行（不写就会被漏跑 = 假绿） */
const SRC_UNDER_TEST = 'src/live/lucky-bag.js';

const B = require('./福袋自测公共.js');
const { ok, boot, bootBagPage, setText, summary } = B;

(async function main() {
  console.log('===== 超级福袋 · 第 7 组（发福袋间隔） =====');

  /* ============================================================
   * ① 面板结构：常驻在「自动发福袋」开关正下方
   * ============================================================ */
  let bp = await bootBagPage();
  bp.api.togglePanel();
  const sh = bp.doc.getElementById('dyb-bag-panel').shadowRoot;

  const gw = sh.querySelector('.gwrap');
  ok(!!gw, '① 面板里有「发福袋间隔」这一组');
  ok(!!gw && gw.previousElementSibling &&
     gw.previousElementSibling.className === 'arow',
     '① 位置在「自动发福袋」开关行的正下方（用户：「他的下方常驻」）');
  ok(/发福袋间隔/.test(gw ? gw.textContent : ''), '① 行标题写「发福袋间隔」');

  const gtk = sh.querySelector('.gtk');
  ok(!!gtk && !sh.querySelector('.gtk input[type=range]'),
     '① 滑条是自绘的（老内核原生 range 按整数跳，且画不出 30 秒刻度）');
  ok(!!gtk && gtk.getAttribute('role') === 'slider', '① 有 slider 语义（无障碍）');
  ok(!!gtk && gtk.getAttribute('aria-valuemin') === '0' &&
     gtk.getAttribute('aria-valuemax') === '300' &&
     gtk.getAttribute('aria-valuenow') === '0',
     '① 量程 0~300 秒、默认 0（不额外等 = 与升级前完全一致）');

  const gmarks = sh.querySelectorAll('.gmk');
  ok(gmarks.length === 11,
     '① 每 30 秒一根刻度，0~5 分钟共 11 根（实际 ' + gmarks.length + ' 根）');
  const gfirst = gmarks[0], glast = gmarks[gmarks.length - 1];
  /* 刻度端点与圆钮圆心共用 trackPos() 坐标系：首尾不再压在轨道极点上，
   * 而是和圆钮一样两端各缩 inset（2026-11-08「最左边突出」的回归点）。 */
  const gInsetPx = bp.api.slideGeom().inset + 'px';
  ok(!!gfirst && !!glast && gfirst.style.left.indexOf(gInsetPx) > -1 &&
     glast.style.left.indexOf(gInsetPx) > -1,
     '① 首尾刻度内缩 ' + gInsetPx + '（与圆钮圆心同一坐标系，不压轨道极点）');

  const glabs = sh.querySelector('.glabs');
  ok(/^0/.test((glabs ? glabs.textContent : '').trim()), '① 左端标「0」');
  ok(/5 分钟/.test(glabs ? glabs.textContent : ''), '① 右端标「5 分钟」（写明单位）');

  /* ============================================================
   * ② 灰态：关着 = 灰且拖不动；打开 = 恢复颜色（用户的核心要求）
   * ============================================================ */
  ok(gw.classList.contains('off'), '② 面板刚打开（自动发福袋关着）时是灰的');
  ok(/防冲突/.test(gw.textContent),
     '② 问号提示写明「0 只是不加等、防冲突间隔照旧」（用户二次强调的语义）');
  ok(gtk.getAttribute('aria-disabled') === 'true' && gtk.getAttribute('tabindex') === '-1',
     '② 灰态同时不可聚焦（键盘也调不了）');
  ok(gw.classList.contains('off') && /\.gwrap\.off \.gfill\{background:#d9d4cb\}/.test(
    sh.querySelector('style').textContent),
     '② 灰态是把填充/圆钮一起退成灰（不只是整体降透明）');

  /* 灰态拖不动：按下不启动拖拽，值不变 */
  bp.api.gapTo(1025);
  ok(bp.api.gapState().live === false && bp.api.gapSec() === 0,
     '② 灰态下拖不动（值仍是 0）');

  bp.api.setAutoForTest(true);
  ok(!gw.classList.contains('off'), '② 打开「自动发福袋」后恢复颜色');
  ok(gtk.getAttribute('aria-disabled') === 'false' && gtk.getAttribute('tabindex') === '0',
     '② 恢复颜色后同时可聚焦');

  bp.api.setAutoForTest(false);
  ok(gw.classList.contains('off'), '② 再关掉开关，又变回灰的（常驻不消失）');

  /* ============================================================
   * ③ 取值：30 秒吸附 + 两端钳住 + 文本格式
   * ============================================================ */
  bp.api.setAutoForTest(true);
  bp.api.setGapSec(70);
  ok(bp.api.gapSec() === 60, '③ 70 秒吸到 60 秒（就近 30 秒档）');
  bp.api.setGapSec(45);
  ok(bp.api.gapSec() === 60, '③ 45 秒吸到 60 秒（半档进位）');
  bp.api.setGapSec(999);
  ok(bp.api.gapSec() === 300, '③ 超上限钳到 300 秒（5 分钟）');
  bp.api.setGapSec(-20);
  ok(bp.api.gapSec() === 0, '③ 低于下限钳到 0');

  bp.api.setGapSec(90);
  ok(bp.api.panelGapValue().textContent === '1 分 30 秒',
     '③ 90 秒显示「1 分 30 秒」（不用 1.5 分钟那种小数）');
  bp.api.setGapSec(300);
  ok(bp.api.panelGapValue().textContent === '5 分钟', '③ 300 秒显示「5 分钟」');
  bp.api.setGapSec(0);
  ok(bp.api.panelGapValue().textContent === '0 分钟', '③ 0 秒显示「0 分钟」');

  /* 拖动映射：轨道两端 = 0 / 300 秒，中点 = 150 秒。
   * 打桩矩形 left=900 / width=250，圆钮圆心内缩 SLIDE_INSET（2026-11-08 起 12）。 */
  bp.api.gapTo(1025);                       // 轨道中点（左右对称，与内缩量无关）
  ok(Math.abs(bp.api.gapState().target - 150) < 1,
     '③ 拖到轨道中点 = 150 秒（0~300 线性映射，含内缩）');
  bp.api.gapEnd();
  ok(bp.api.gapSec() === 150 && bp.api.gapState().live === false,
     '③ 松手写盘（150 秒）且退出拖动态');
  bp.api.gapTo(910);                        // 最左（圆心 0）
  bp.api.gapEnd();
  ok(bp.api.gapSec() === 0, '③ 拖到最左 = 0 秒（圆心不出界）');
  bp.api.gapTo(1140);                       // 最右（超出可用行程 → 钳到端点）
  bp.api.gapEnd();
  ok(bp.api.gapSec() === 300, '③ 拖到最右 = 300 秒');

  /* ============================================================
   * ④ 时序：倒计时结束后数着设定时间，到点才走原来的自动流程
   * ============================================================ */

  /* ④-a 默认 0：没有待冷却的上一轮时，与升级前一致，第一拍就发
   * （不能因为新增参数就改变老行为） */
  let env = await boot({ watch: true, auto: true, onStartClick: 'runningTimed' });
  ok(env.api.gapSec() === 0, '④ 默认间隔 = 0（老用户升级后节奏不变）');
  env.tick();
  ok(env.clicks.s1 === 1, '④ 间隔 0 且没有待冷却的上一轮 → 照旧发（行为与从前一致）');

  /* ④-h 0 档 ≠ 0 秒抢发（2026-11-05 用户二次强调）：
   * 「滑动在 0 的话，不是真的 0 秒杀，依然是我之前设定的时间秒数间隔，
   *  防止前后冲突」。
   * 现场：先让页面「进行中」跑一拍（记下 lastRunningAt），再把倒计时拨到期、
   * 状态翻成「待开始」—— 此时距最后一次见到进行中不足 15 秒收尾冷却，
   * 滑条哪怕是 0 也不许点。冷却过去后才放行。 */
  let env5 = await boot({ watch: true, auto: true, onStartClick: 'runningTimed',
    status: '活动进行中 距结束 00:30' });
  env5.tick();                                   // 读到进行中 → lastRunningAt = now
  ok(env5.api.gapSec() === 0, '④ 0 档现场：间隔值确实是 0');
  ok(env5.clicks.s1 === 0, '④ 进行中时不点（防双开闸先拦住）');
  env5.api.expireDrawForTest();                  // 倒计时走完（时间没真走）
  setText(env5, 'st1', '● 活动待开始');
  env5.tick();
  ok(env5.clicks.s1 === 0, '④ 0 档也不在开奖收尾冷却（15 秒）内抢发');
  env5.api.setTimingForTest({ afterDrawLag: 0, resumeQuiet: 0 });
  env5.tick();
  ok(env5.clicks.s1 === 1, '④ 安全间隔过去后，0 档照常发下一轮');

  /* ④-b 间隔没到：不点 */
  env = await boot({ watch: true, auto: true, onStartClick: 'runningTimed' });
  env.api.setGapSec(120);                                  // 2 分钟
  env.api.setRoundEndAtForTest(Date.now() - 30000);        // 30 秒前刚结束
  env.tick();
  ok(env.clicks.s1 === 0,
     '④ 倒计时结束才 30 秒、设定 2 分钟 → 先等着，不发（用户：「时间到了才会执行下一轮」）');
  ok(env.messages.length === 0, '④ 等待期间不出声（等待不是异常，不刷屏）');

  /* ④-c 到点：放行 */
  env.api.setRoundEndAtForTest(Date.now() - 130000);       // 已过 2 分 10 秒
  env.tick();
  ok(env.clicks.s1 === 1, '④ 到点后发出下一轮');

  /* ④-d 到点也不跳过原流程：仍走「待开始可点」+ 防双开那道闸。
   * 页面里没有「开始活动」链接时，到点也不会瞎点。 */
  let env2 = await boot({ watch: true, auto: true, status: '活动已结束', withStart: false });
  env2.api.setGapSec(30);
  env2.api.setRoundEndAtForTest(Date.now() - 60000);
  env2.tick();
  ok(env2.clicks.s1 === 0, '④ 到点但没有可点的行 → 不点（到点不等于可以发）');

  /* ④-e 开关关着时，间隔不参与（纯监视模式绝不自动发） */
  let env3 = await boot({ watch: true, auto: false, onStartClick: 'runningTimed' });
  env3.api.setGapSec(30);
  env3.api.setRoundEndAtForTest(Date.now() - 600000);
  env3.tick();
  ok(env3.clicks.s1 === 0, '④ 自动发福袋关着时，间隔再久也不发（纯监视只读）');

  /* ④-f tick 自己维护起算锚点：读到「进行中 + 倒计时」就钉下到期时刻 */
  let env4 = await boot({ watch: true, auto: false });
  setText(env4, 'st1', '● 活动进行中 距结束 03:12');
  env4.tick();
  const anchor = env4.api.lastRoundEndAt();
  ok(anchor > Date.now() + 180000 && anchor < Date.now() + 200000,
     '④ 读到「距结束 03:12」→ 到期锚点约 +192 秒（实际 +' +
     Math.round((anchor - Date.now()) / 1000) + ' 秒）');

  /* ④-g 锚点只前进不后退：更短的读数不覆盖已记下的到期时刻。
   * （锚点在判据 unknown ↔ live 抖动时**故意不清**——清了间隔会时灵时不灵，
   *   这条用例锁住「不会因为读到更短的时间就把起算点往回拉」。） */
  setText(env4, 'st1', '● 活动进行中 距结束 01:00');
  env4.tick();
  ok(env4.api.lastRoundEndAt() === anchor,
     '④ 读到更短的倒计时不把锚点往回拉（起算点只前进）');

  /* ============================================================
   * ⑤ 等下一轮期间要有倒计时指示（2026-11-08 用户原话：
   * 「福袋在设定的间隔时间等待下一轮的时候也要有倒计时指示」）
   * ------------------------------------------------------------
   * 口径：等待窗口 = 上一轮倒计时到期（lastRoundEndAt）+ 设定间隔；
   *       与 tick 里那道间隔闸同一本账，显示层只读不算。
   * ============================================================ */
  let env6 = await bootBagPage();
  env6.api.togglePanel();
  const sh6 = env6.doc.getElementById('dyb-bag-panel').shadowRoot;
  env6.api.setAutoForTest(true);
  env6.api.setGapSec(120);                               // 2 分钟
  env6.api.setRoundEndAtForTest(Date.now() - 30000);     // 30 秒前刚结束
  env6.api.setGapSec(120);                               // 触发一次重绘
  const gw6 = env6.api.gapWait();
  ok(gw6 > 85000 && gw6 <= 91000,
     '⑤ 剩余量 = 120 − 30 ≈ 90 秒（实际 ' + Math.round(gw6 / 1000) + ' 秒）');
  ok(/^等 \d\d:\d\d$/.test(env6.api.badgeText()),
     '⑤ 圆钮显示「等 mm:ss」，不是干巴巴的「未开始」：' + env6.api.badgeText());
  const val6 = sh6.querySelector('.rl .val');
  const u6 = sh6.querySelector('.rl .u');
  ok(/^\d\d:\d\d$/.test(val6.textContent) && u6.style.display !== 'none',
     '⑤ 面板「下轮开始」这一行报间隔倒计时（不再写「未读到」）：' + val6.textContent);
  ok(val6.classList.contains('wait'),
     '⑤ 等待态单独一档字色（不会看成「福袋还剩这么多」）');

  /* ⑤-b 到点就不再报（发出去之后该由下一轮的倒计时接管） */
  env6.api.setRoundEndAtForTest(Date.now() - 200000);    // 间隔已过
  ok(env6.api.gapWait() === 0 && env6.api.badgeText() === '未开始',
     '⑤ 间隔走完 → 不再报等待（圆钮回「未开始」等下一拍读数）');

  /* ⑤-c 间隔 = 0 时没有可数的东西（这一层不额外等），不能显示 00:00 */
  env6.api.setGapSec(0);
  env6.api.setRoundEndAtForTest(Date.now() - 30000);
  ok(env6.api.gapWait() === 0 && env6.api.badgeText() === '未开始',
     '⑤ 间隔设 0 时不显示等待倒计时（0 = 这一层不加等）');

  /* ⑤-d 福袋还在跑时不抢：这一行/圆钮该报福袋自己的剩余时间 */
  let env7 = await boot({ watch: true, auto: true, status: '活动进行中 距结束 03:00' });
  env7.api.setGapSec(300);
  env7.tick();
  ok(env7.api.gapWait() === 0, '⑤ 有福袋在跑时不算间隔（不抢它自己的倒计时）');
  ok(/^0[23]:\d\d$/.test(env7.api.badgeText()),
     '⑤ 圆钮仍报福袋剩余时间：' + env7.api.badgeText());

  /* ⑤-e 自动发福袋关着时同样不报（等待只服务于自动续轮） */
  let env8 = await boot({ watch: true, auto: false });
  env8.api.setGapSec(300);
  env8.api.setRoundEndAtForTest(Date.now() - 30000);
  env8.tick();
  ok(env8.api.gapWait() === 0, '⑤ 自动发福袋关着 → 不做间隔倒计时');

  /* ============================================================
   * ⑥ 两条滑条一套尺寸 + 端点留余量（2026-11-08 用户原话：
   * 「这两个设定的滑动条样式不一样，你重新优化一下，而且端末最尽头还有
   *   突出，不太对」）
   * ============================================================ */
  const geom = bp.api.slideGeom();
  /* 端点余量必须盖住「放大态半径 + 光环」：只按半径算的话圆钮本体在轨道内、
   * 那圈 box-shadow 照样压到轨道外 —— 2026-11-08「最左边还是会突出」就是它。 */
  const visualR = geom.thumbGrow / 2 + geom.halo;
  ok(geom.inset >= visualR + 2,
     '⑥ 端点余量：内缩 ' + geom.inset + 'px ≥ 视觉半径（' + geom.thumbGrow / 2 +
     'px 圆钮 + ' + geom.halo + 'px 光环）= ' + visualR + 'px，另留 2px');
  /* 左右同源：拖到最左/最右时圆钮位置都得是「两端各缩 inset」。
   * jsdom 不做布局、量不到像素，就验这两个表达式本身 —— 旧版左端算出来
   * 等于 0%（贴着轨道极点），右端却缩进了，一缩一不缩正是「只有最左边突出」。 */
  const thumbEl = bp.api.panelSlider().querySelector('.thumb');
  const insPx = geom.inset + 'px';
  bp.api.setCheckMin(3);  const leftMin = thumbEl.style.left;
  bp.api.setCheckMin(10); const leftMax = thumbEl.style.left;
  ok(leftMin !== '0%' && leftMax !== '100%' &&
     leftMin.indexOf(insPx) > -1 && leftMax.indexOf(insPx) > -1,
     '⑥ 两端都由 ' + insPx + ' 内缩、左右同一条式子（最左 ' + leftMin + '）');
  /* 两条滑条共用坐标系：间隔条的首尾刻度必须和主条圆钮的两个端点完全重合，
   * 否则「同一套几何」只是看着像，端点处仍会各缩各的。 */
  const gmAll = sh.querySelectorAll('.gmk');
  ok(gmAll.length > 1 && gmAll[0].style.left === leftMin &&
     gmAll[gmAll.length - 1].style.left === leftMax,
     '⑥ 间隔条首尾刻度与主条圆钮端点表达式完全一致（同一坐标系）');
  /* 断言「两条滑条的尺寸一致」而不是「选择器必须写成成对形式」：
   * 前者是用户看得见的结果（样式齐不齐），后者是实现细节，
   * 以后真拆开写也不该红。 */
  const css7 = sh.querySelector('style').textContent;
  const cssNum = function (re) { const m = re.exec(css7); return m ? +m[1] : -1; };
  const tkH = cssNum(/\.tk[^{]*\{[^}]*height:(\d+)px/);
  const gtkH = cssNum(/\.gtk[^{]*\{[^}]*height:(\d+)px/);
  const railH = cssNum(/\.rail[^{]*\{[^}]*height:(\d+)px/);
  const grailH = cssNum(/\.grail[^{]*\{[^}]*height:(\d+)px/);
  const thumbW = cssNum(/\.thumb[^{]*\{[^}]*width:(\d+)px/);
  const gthumbW = cssNum(/\.gthumb[^{]*\{[^}]*width:(\d+)px/);
  ok(tkH > 0 && tkH === gtkH && railH > 0 && railH === grailH &&
     thumbW > 0 && thumbW === gthumbW,
     '⑥ 两条滑条尺寸完全一致（行高 ' + tkH + '/' + gtkH + '、轨道 ' + railH + '/' +
     grailH + '、圆钮 ' + thumbW + '/' + gthumbW + '）');
  ok(railH === 8 && thumbW === geom.thumb && gthumbW === geom.thumb,
     '⑥ 发福袋间隔不再是小一号的轨道 / 圆钮（两条都是轨道 8、圆钮 ' +
     geom.thumb + '）');
  /* 旧版间隔条行高 24、主条 28；现在统一 28（上面已断言两者相等），
   * 这里只钉「.gtk 自己的行高不再是 24」，不去全文搜 24px ——
   * 圆钮放大态本来就是 24px，全文搜会把正常样式判成残留。 */
  ok(!/\.gtk\{[^}]*height:24px/.test(css7),
     '⑥ 旧的 24px 缩小版行高已删除（样式不齐的根源）');
  ok(css7.indexOf('0 0 0 5px') < 0,
     '⑥ 悬停光环由 5px 收到 4px（端点处这块外扩是「突出」的主因）');

  /* ============================================================
   * ⑦ 失败后的阶梯自查（2026-11-08 用户定稿）
   *   「自动发福袋的循环自检，如果失败了多久会再查一次，按照阶梯间隔
   *    帮我设计自查检测」→ 定稿：15/30/60/120/300 秒（5 档），用完后
   *    退成每 5 分钟一直查，直到读到结果 / 下播 / 手动停。
   * ============================================================ */
  let env9 = await boot({ watch: true, auto: true });
  const seq = [];
  for (let i = 0; i < 7; i++) seq.push(env9.api.retryFailForTest('resume'));
  ok(JSON.stringify(seq) === JSON.stringify([15000, 30000, 60000, 120000, 300000, 300000, 300000]),
     '⑦ 阶梯 = 15/30/60/120/300 秒，之后每 5 分钟一直兜底：' + seq.join(' / ') + '（毫秒）');
  ok(env9.api.retryState().step === 7,
     '⑦ 每失败一次推进一档（7 次失败 → 第 7 档）');
  ok(env9.api.retryState().left > 0, '⑦ 等待中：下一次自查还有 ' +
     Math.round(env9.api.retryState().left / 1000) + ' 秒');
  ok(/^等 \d\d:\d\d$/.test(env9.api.badgeText()),
     '⑦ 等待期圆钮显示「等 mm:ss」：' + env9.api.badgeText());

  env9.api.retryResetForTest();
  ok(env9.api.retryState().step === 0 && env9.api.retryState().left === 0,
     '⑦ 读到结果 / 切场 / 手动停 → 阶梯归零');

  /* ⑦-b 归零后再失败，从最短一档重新开始（不是从上次的第 7 档继续） */
  ok(env9.api.retryFailForTest('probe') === 15000,
     '⑦ 归零后重新从 15 秒起（新一场不背上一场的账）');

  /* ============================================================
   * ⑧ 刷新重进：确认「没有福袋在跑」→ 先等设定间隔，再继续发
   *   （2026-11-08 用户：「不做场次记忆……如果刷新重新进来，只要确认没有
   *    福袋进行，就开始等设定的间隔，就可以继续发了」）
   * ============================================================ */
  let env10 = await boot({ watch: true, auto: true, onStartClick: 'runningTimed' });
  env10.api.setGapSec(120);                 // 2 分钟
  ok(env10.api.lastRoundEndAt() === 0, '⑧ 铺垫：刚重载进来没有上一轮锚点');
  env10.tick();
  ok(env10.clicks.s1 === 0, '⑧ 确认没有在跑 → 不立刻发，先等间隔');
  const anchor10 = env10.api.lastRoundEndAt();
  ok(anchor10 > Date.now() - 3000 && anchor10 <= Date.now() + 1000,
    '⑧ 间隔起算点钉在「确认没有在跑」的这一刻（+0 秒，不是凭空跳过）');
  ok(env10.api.gapWait() > 100000,
    '⑧ 等待量 = 设定间隔（剩 ' + Math.round(env10.api.gapWait() / 1000) + ' 秒）');

  env10.api.setRoundEndAtForTest(Date.now() - 130000);   // 拨到间隔已过
  env10.tick();
  ok(env10.clicks.s1 === 1, '⑧ 间隔满了 → 照常发下一轮');

  /* ⑧-b 间隔 = 0 时不受这条影响（老节奏不变，刷新进来照旧立即发） */
  let env11 = await boot({ watch: true, auto: true, onStartClick: 'runningTimed' });
  env11.api.setGapSec(0);
  env11.tick();
  ok(env11.clicks.s1 === 1, '⑧ 间隔设 0 → 重进后照旧立即发（这一层不额外等）');

  /* ⑧-c 上一轮确实还在跑（sessionStorage 里的 holdDrawAt 未到期）→ 锚点用它
   * 自己的到期时刻，不能被改写成「现在」（否则会把还在跑的那一轮当成刚结束，
   * 硬多等一个间隔）。bootBagPage 支持 opts.hold，boot 不支持，所以这里换页面。 */
  const hold12 = Date.now() + 10 * 60 * 1000;
  let env12 = await bootBagPage(null, {
    preOpen: true,
    hold: hold12,
    rowStatus: '<span id="ds12">● 活动待开始</span><a id="dstart">开始活动</a>'
  });
  env12.api.setAutoForTest(true);
  env12.api.setGapSec(120);
  env12.api.tick();
  ok(env12.api.lastRoundEndAt() >= hold12 - 3000,
    '⑧ 重进时上一轮还在跑 → 锚点仍是它自己的到期时刻，不是「现在」');
  ok(env12.clicks.dstart === 0, '⑧ 上一轮还在跑 → 不发（防双开闸照旧生效）');

  /* ============================================================
   * ⑨ 现场读数持久化（2026-11-08 用户：「可以做持久化，就是刚才读的读数，
   *   刷新后仍然记得，这也能降低重复发福袋的概率」）
   *   验三件事：有效档案能接回来、过期档案整份丢弃、进行中凭据过期不背书。
   *   真正的「重启浏览器」不好模拟，所以直接喂档案给恢复函数 ——
   *   恢复逻辑才是这条链路的风险点。
   * ============================================================ */
  let env13 = await boot({ watch: true, auto: true, onStartClick: 'runningTimed' });
  env13.api.setGapSec(120);
  const nowF = Date.now();
  ok(env13.api.applyFactForTest({
    at: nowF,
    hold: nowF + 5 * 60000,
    roundEnd: nowF - 30000,
    running: true,
    runningUntil: nowF + 5 * 60000,
    draw: 0,
    name: '抽奖活动'
  }) === true, '⑨ 有效档案能被接回来（返回 true）');
  ok(env13.api.lastRoundEndAt() === nowF - 30000,
    '⑨ 间隔起算锚点接回来了（不必按「现在」重算）');
  ok(env13.api.gapWait() === 0,
    '⑨ 档案说「还在跑」⇒ 不显示间隔倒计时（在跑时该报它自己的倒计时）');
  ok(env13.api.badgeText() === '进行中',
    '⑨ 「刚才有福袋在跑」被记住 → 圆钮显示进行中（不是未开始）');

  /* ⑨-a 档案里只有锚点（上一轮已结束）→ 间隔接着上次的数走 */
  let env13b = await boot({ watch: true, auto: true, onStartClick: 'runningTimed' });
  env13b.api.setGapSec(120);
  const nowG = Date.now();
  ok(env13b.api.applyFactForTest({
    at: nowG, hold: 0, roundEnd: nowG - 30000,
    running: false, runningUntil: 0, draw: 0, name: ''
  }) === true, '⑨ 只有结束锚点的档案同样能接回来');
  ok(env13b.api.gapWait() > 80000 && env13b.api.gapWait() <= 91000,
    '⑨ 间隔剩余 = 120 − 30 ≈ 90 秒（接着上次的数走）：' +
    Math.round(env13b.api.gapWait() / 1000) + ' 秒');
  ok(env13.win.sessionStorage.getItem('dycBagHoldDrawAt') !== null,
    '⑨ 到期时刻同时写进 sessionStorage（刷新这条快路径也接得上）');

  /* ⑨-b 超过 6 小时上限的档案整份丢弃（跨场残留不得冒充这一场） */
  ok(env13.api.applyFactForTest({
    at: nowF - 7 * 3600 * 1000,
    hold: nowF + 60000,
    roundEnd: nowF - 60000,
    running: true,
    runningUntil: nowF + 60000
  }) === false, '⑨ 超过 6 小时的档案整份丢弃');

  /* ⑨-c 进行中凭据已过期 → 不当成「还在跑」 */
  let env14 = await boot({ watch: true, auto: true });
  ok(env14.api.applyFactForTest({
    at: Date.now(),
    hold: 0,
    roundEnd: 0,
    running: true,
    runningUntil: Date.now() - 1000,
    draw: 0,
    name: ''
  }) === false, '⑨ 进行中凭据已过期 → 不恢复');
  ok(env14.api.badgeText() === '未开始',
    '⑨ 圆钮回「未开始」，不替过期读数背书');

  /* ⑨-d 写盘内容：含写入时刻与间隔锚点（注入 storage 桩，验真实写入路径） */
  let env15 = await boot({ watch: true, auto: true });
  const bagStore = {};
  env15.win.chrome = {
    storage: {
      local: {
        get: function (k, cb) { const o = {}; o[k] = bagStore[k]; cb(o); },
        set: function (o) { Object.keys(o).forEach(function (k) { bagStore[k] = o[k]; }); },
        remove: function (k) { delete bagStore[k]; }
      }
    }
  };
  env15.api.setGapSec(60);
  env15.api.tick();
  env15.api.saveFactForTest();
  const savedFact = bagStore['dycBagFact'];
  ok(!!savedFact && typeof savedFact.at === 'number' && savedFact.roundEnd > 0,
    '⑨ 写盘：档案含写入时刻与间隔锚点（' + (savedFact ? Object.keys(savedFact).join(',') : '无') + '）');

  summary();
})().catch(function (e) {
  console.error(e);
  process.exit(1);
});
