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
  ok(!!gfirst && gfirst.style.left === '0%' && !!glast && glast.style.left === '100%',
     '① 两端刻度压在轨道两端（0% / 100%）');

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
   * 打桩矩形 left=900 / width=250，圆钮圆心内缩 SLIDE_INSET=10。 */
  bp.api.gapTo(1025);                       // 轨道中点（x=115 / 可用 230）
  ok(Math.abs(bp.api.gapState().target - 150) < 1,
     '③ 拖到轨道中点 = 150 秒（0~300 线性映射，含内缩）');
  bp.api.gapEnd();
  ok(bp.api.gapSec() === 150 && bp.api.gapState().live === false,
     '③ 松手写盘（150 秒）且退出拖动态');
  bp.api.gapTo(910);                        // 最左（圆心 0）
  bp.api.gapEnd();
  ok(bp.api.gapSec() === 0, '③ 拖到最左 = 0 秒（圆心不出界）');
  bp.api.gapTo(1140);                       // 最右（圆心 = 轨道右端 - 10）
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

  summary();
})().catch(function (e) {
  console.error(e);
  process.exit(1);
});
