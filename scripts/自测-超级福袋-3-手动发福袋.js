/**
 * 自测 · 超级福袋（第 3/6 组：手动发福袋）
 * ============================================================
 * 2026-11-04 拆分：原 2855 行单文件按用例段拆成 6 组，交给
 * run-selftests.py 的并发调度并行跑（实测并发零退化）。
 * 断言逐条原样搬运，条数与拆分前一致（已做逐条比对）；
 * 公共件在 福袋自测公共.js。
 *
 * 用法：
 *   NODE_PATH=<node_modules> node scripts/自测-超级福袋-3-手动发福袋.js
 * 退出码 0 = 全绿；1 = 有用例失败。
 */
'use strict';

/* 被测源文件：本组经公共件间接加载 lucky-bag.js，但 --changed 的反查是
 * 「读正文里出现的 src 路径」，不写这行就会被漏跑（改了源码却只跑 1 组 = 假绿）。 */
const SRC_UNDER_TEST = 'src/live/lucky-bag.js';

const B = require('./福袋自测公共.js');
const {
  ROOT, CODE, LIVE_STATE_CODE, FLAGS_SRC, MANIFEST, PRIZE,
  ok, sleep, summary, liveTagHtml, makeDom, boot, setText, remove,
  bootDrawer, drawerHtml, bootBagPage, cardHtml, waitBag,
} = B;

(async function main() {
  console.log('===== 超级福袋 · 第 3 组（手动发福袋） =====');
  /* 本组只做赋值、声明在上游组里；补声明以免严格模式报错 */
  let bp;

  /* ---------- ㊵ 手动发福袋按钮（2026-11-02 晚 用户原话）----------
   * 「加一个按钮，手动发福袋，放在手动刷新的下面。但是发福袋是要先
   * 确认有没有福袋在进行中，有的话就不发并且关闭浮层。弹出提示
   * 【已经有福袋在进行中了】」 */
  bp = await bootBagPage('<div id="bagCardM"><span>进行中活动</span>' +
    '<span>03 分 12 秒 后结束</span>' +
    '<div>10元店铺红包 ID 活动ID:7702886904815681841</div></div>', { preOpen: true });
  ok(bp.clicks.entry === 0, '㊵ 铺垫：进页面没开过抽屉');
  bp.api.manualStart();
  await sleep(60);
  ok(bp.clicks.entry === 0, '㊵ ① 有进行中 → 不发（连抽屉入口都不找）');
  ok(/已经有福袋在进行中了/.test(bp.messages[bp.messages.length - 1].text),
    '㊵ ① 提示原话「已经有福袋在进行中了」：' + bp.messages[bp.messages.length - 1].text);
  ok(!bp.doc.getElementById('drawer'), '㊵ ① 开着的浮层（抽屉）被替用户关掉');

  /* ㊵② 没有进行中 → 开抽屉点一次「开始活动」 */
  bp = await bootBagPage(null, {
    drawerRowHtml: '<span id="ds1">● 活动待开始</span><a id="dstart">开始活动</a>'
  });
  bp.api.manualStart();
  /* 2026-11-03 00:15 起：点「开始活动」前要「多看几眼」（START_PRECHECK_MS），
   * 从点按钮到真正发出最多约 5 秒 —— 这里等事件，不卡固定时长。 */
  ok(await waitBag(function () { return bp.clicks.entry === 1; }, 5000),
    '㊵ ② 没有进行中 → 开抽屉找「开始活动」');
  ok(await waitBag(function () { return bp.clicks.dstart === 1; }, 9000),
    '㊵ ② 「开始活动」链接被点了一次');
  var m2 = bp.messages[bp.messages.length - 1] || {};
  ok(/已点「开始活动」/.test(m2.text || ''),
    '㊵ ② 反馈「已点「开始活动」，等平台确认」：' + m2.text);
  ok(bp.api.snapshot().phase === 'starting', '㊵ ② 点击进入与自动发福袋同一条校验链路');

  /* ㊵③ 抽屉里没有可发的（全已结束）→ 提示并关抽屉 */
  bp = await bootBagPage(null, { drawerRowHtml: '● 活动已结束' });
  bp.api.manualStart();
  await waitBag(function () {
    return bp.messages.some(function (m) { return /没有可发的福袋/.test(m.text); });
  }, 9000);
  ok(bp.clicks.entry === 1, '㊵ ③ 没有进行中 → 照常开抽屉确认');
  ok(bp.clicks.dstart === 0, '㊵ ③ 没有可点候选 → 不点');
  ok(bp.messages.some(function (m) { return /没有可发的福袋/.test(m.text); }),
    '㊵ ③ 提示「没有可发的福袋」：' + (bp.messages[bp.messages.length - 1] || {}).text);
  ok(!bp.doc.getElementById('drawer'), '㊵ ③ 读完自动关抽屉');

  /* ㊵④ 二次确认：预检时没有进行中，开抽屉读到进行中 → 不点、关抽屉 */
  bp = await bootBagPage(null, { drawerRowHtml: '● 活动进行中 · 距结束 02:00' });
  bp.api.manualStart();
  await waitBag(function () {
    return bp.messages.some(function (m) { return /已经有福袋在进行中了/.test(m.text); });
  }, 9000);
  ok(bp.clicks.entry === 1, '㊵ ④ 预检无进行中 → 照常开抽屉');
  ok(bp.clicks.dstart === 0, '㊵ ④ 开抽屉读到进行中 → 不发（二次确认拦住）');
  ok(bp.messages.some(function (m) { return /已经有福袋在进行中了/.test(m.text); }),
    '㊵ ④ 提示原话「已经有福袋在进行中了」：' + (bp.messages[bp.messages.length - 1] || {}).text);
  ok(!bp.doc.getElementById('drawer'), '㊵ ④ 抽屉被关掉');

  /* ---------- ㊶ 抽屉已开着：不重复点入口，直接用眼前行发 ----------
   * 2026-11-02 晚审评修复：bagEntry 的前提是「只在抽屉关闭时调用」；
   * 抽屉开着时点入口会被遮罩挡住、抽屉标题还掺和匹配 → 白点 + 误报
   * 「没找到福袋抽屉入口」。现在抽屉已开就直接扫眼前的行。 */
  bp = await bootBagPage(null, {
    preOpen: true,
    rowStatus: '<span id="ds2">● 活动待开始</span><a id="dstart">开始活动</a>'
  });
  ok(bp.clicks.entry === 0, '㊶ 铺垫：抽屉是用户自己开的（没点过入口）');
  bp.api.manualStart();
  ok(await waitBag(function () { return bp.clicks.dstart === 1; }, 9000),
    '㊶ 直接用眼前的行点「开始活动」');
  ok(bp.clicks.entry === 0, '㊶ 抽屉已开 → 不再点入口（不误报「没找到抽屉入口」）');
  var m6 = bp.messages[bp.messages.length - 1] || {};
  ok(/已点「开始活动」/.test(m6.text || ''),
    '㊶ 反馈「已点「开始活动」，等平台确认」：' + m6.text);
  ok(!!bp.doc.getElementById('drawer'), '㊶ 用户自己开的抽屉不被替用户关掉');

  /* ㊷ 抽屉已开 + 已有进行中 → 按原口径：不发 + 关浮层 + 原话提示 */
  bp = await bootBagPage(null, { preOpen: true, rowStatus: '● 活动进行中 · 距结束 02:00' });
  bp.api.manualStart();
  await waitBag(function () {
    return bp.messages.some(function (m) { return /已经有福袋在进行中了/.test(m.text); });
  }, 6000);
  ok(bp.clicks.entry === 0 && bp.clicks.dstart === 0, '㊷ 抽屉已开 + 有进行中 → 什么都不点');
  ok(bp.messages.some(function (m) { return /已经有福袋在进行中了/.test(m.text); }),
    '㊷ 提示原话「已经有福袋在进行中了」：' + (bp.messages[bp.messages.length - 1] || {}).text);
  ok(!bp.doc.getElementById('drawer'), '㊷ 浮层被关闭（用户口径：有进行中就关浮层）');

  /* ---------- ㊸ 防误发：开抽屉后读不到行时的保守处理 ----------
   * 2026-11-02 晚真机：「明明有一个福袋在跑，它还发了下一个」——
   * 开抽屉后行还没渲染，空页面被误判成「没有进行中」。
   * 现在：轮询等行出现（最多 MANUAL_START_SCAN_MS）；
   *   等不到时 —— 整页有「进行中活动」字样 → 按有进行中拦下；
   *              连字样都没有 → 读不到就不动。 */
  /* 用 script[type=text/plain] 承载字样：进 body.textContent，但不会被
   * 行扫描（只扫 a/button/tr/div…）当成一行 —— 精确模拟「整页有字样、
   * 但行认不出」的真机状态。 */
  bp = await bootBagPage('<script type="text/plain">进行中活动</script>', {
    emptyDrawer: true
  });
  bp.api.setTimingForTest({ scanMs: 300 });
  bp.api.manualStart();
  await sleep(2300);            // 1.6 秒开抽屉窗 + 300ms 轮询超时
  ok(bp.clicks.dstart === 0, '㊸ ① 读不到行、但有「进行中活动」字样 → 不发（保守拦截）');
  ok(/已经有福袋在进行中了/.test(bp.messages[bp.messages.length - 1].text),
    '㊸ ① 提示原话：' + bp.messages[bp.messages.length - 1].text);

  bp = await bootBagPage(null, { emptyDrawer: true });
  bp.api.setTimingForTest({ scanMs: 300 });
  bp.api.manualStart();
  await sleep(2300);
  ok(bp.clicks.dstart === 0, '㊸ ② 读不到行、页面上也没有字样 → 不发（读不到就不动）');
  ok(/没有可发的福袋/.test(bp.messages[bp.messages.length - 1].text),
    '㊸ ② 提示「没有可发的福袋」：' + bp.messages[bp.messages.length - 1].text);

  /* ---------- ㊹ 手动发福袋的生命周期（2026-11-02 晚真机两条反馈）----------
   * ① 发了福袋之后不检测倒计时 —— 根因：纯监视模式下手动点击失败会
   *    doStop('no-effect') → stopLoop() 彻底停扫描，之后再没人读；
   * ② 点了「开始活动」却没生效 —— 确认框弹得慢，350ms 单次查找漏点。 */
  bp = await bootBagPage(null, {
    drawerRowHtml: '<span id="ds3">● 活动待开始</span><a id="dstart">开始活动</a>'
  });
  /* 复核间隔一并压到 200ms（2026-11-04 自测提速）：这条验的是「失败后进复核、
   * 复核完给出手动刷新出路」，结论与轮次都不变，只是不再等产品级 3s+3.5s。
   * 不压这一项时它单条要等 11.6 秒，是本组最大的固定开销。 */
  bp.api.setTimingForTest({ tick: 120, verify: 300, scanMs: 300, precheck: 300, reverify: 200, reverifyRetry: 200 });
  ok(bp.api.snapshot().timers.tick === true, '㊹ 铺垫：扫描在跑');
  bp.api.manualStart();
  await waitBag(function () {
    return bp.messages.some(function (m) { return /发福袋失败/.test(m.text); });
  }, 12000);
  ok(bp.api.snapshot().phase !== 'stopped' && bp.api.snapshot().phase !== 'halted',
    '㊹ ① 手动点击后没变「进行中」→ 不停机（人的动作不把监视干掉）');
  /* 断言按语义要素断（不绑死整句文案）：明说是哪一路失败，并给出下一步。
   * 2026-11-04 起文案不再提「进行中」「复核几次」（用户：别讲操作原理）；
   * 手动失败也不写「30 秒后重试」—— 那是自动开始下一轮才有的结果承诺。 */
  var failMsgs = bp.messages.filter(function (m) { return /发福袋失败/.test(m.text); });
  ok(failMsgs.length === 1,
    '㊹ ① 失败只报一条（明说发福袋失败）：' + failMsgs.length);
  ok(!!failMsgs[0] && !!/\S/.test(failMsgs[0].count) && /手动刷新/.test(failMsgs[0].full),
    '㊹ ① 失败消息给出「手动刷新」出路：' +
      (failMsgs[0] ? (failMsgs[0].count + ' / ' + failMsgs[0].full) : '无消息'));
  ok(bp.api.snapshot().timers.tick === true, '㊹ ① 扫描仍在跑（之后还能读倒计时）');

  /* ㊹② 确认框晚 900ms 才弹 → 靠重试（1200ms 那一档）点到 */
  bp = await bootBagPage(null, {
    drawerRowHtml: '<span id="ds4">● 活动待开始</span><a id="dstart">开始活动</a>'
  });
  let confirmClicks = 0;
  bp.doc.addEventListener('click', function (e) {
    if (!e.target || e.target.id !== 'dstart') return;
    setTimeout(function () {
      const d = bp.doc.createElement('div');
      d.setAttribute('role', 'dialog');
      d.innerHTML = '<button id="cfm">确认开始</button>';
      bp.doc.body.appendChild(d);
      bp.doc.getElementById('cfm').addEventListener('click', function () { confirmClicks++; });
    }, 900);
  });
  bp.api.setTimingForTest({ tick: 3000, scanMs: 300 });
  bp.api.manualStart();
  await waitBag(function () { return confirmClicks >= 1; }, 12000);
  ok(confirmClicks === 1, '㊹ ② 确认框晚 900ms 出现也能被点到（重试机制，实际 ' + confirmClicks + ' 次）');

  /* ---------- ㊺ 手动发福袋：核对多看一眼 + 失败必收抽屉（2026-11-08）----------
   * 用户原话：「手动发福袋后应该做不止一次的确认有没有成功发，而且如果确认
   * 信息失败了，也不能把抽屉开着就结束了。有时候平台延迟就会卡住且抽屉开着，
   * 实际我已经成功发了福袋」。
   * 三个可量化的验点（不绑死文案）：
   *   ① 手动路径核对轮次明显多于自动路径（4 轮 vs 2 轮）；
   *   ② 核对失败必须给出结论，且**抽屉必须收起**（不论谁开的）；
   *   ③ 收尾后状态回到 live、不再挂「核对中」，按钮可再用。 */
  bp = await bootBagPage(null, {
    drawerRowHtml: '<span id="ds5">● 活动待开始</span><a id="dstart">开始活动</a>'
  });
  /* 核对间隔压到 200ms（只验轮次与收尾，不验真实等待时长）；
   * 轮次不压 —— 这条用例验的就是「手动比自动多看几眼」。 */
  bp.api.setTimingForTest({ tick: 120, verify: 300, scanMs: 300, precheck: 300, reverify: 200, reverifyRetry: 200 });
  bp.api.manualStart();
  let maxRound = 0;
  await waitBag(function () {
    const st = bp.api.reverifyState();
    if (st) maxRound = Math.max(maxRound, st.n);
    return bp.messages.some(function (m) { return /发福袋失败/.test(m.text); });
  }, 15000);
  ok(maxRound >= 3,
    '㊺ ① 手动核对至少跑了 3 轮（不止一次确认）：实际观测到第 ' + maxRound + ' 轮');
  ok(bp.messages.filter(function (m) { return /发福袋失败/.test(m.text); }).length === 1,
    '㊺ ② 核对失败只报一条结论');
  ok(!bp.doc.getElementById('drawer'), '㊺ ② 核对失败后抽屉已收起（不能敞着就结束）');
  ok(!bp.api.reverifyState(), '㊺ ③ 收尾清掉核对态（不卡在「核对中」）');
  ok(bp.api.snapshot().phase === 'live', '㊺ ③ 收尾回到 live（人的动作不停机）');

  /* ㊺④ 抽屉是用户自己开的，核对失败也要替他收起（用户 2026-11-08 口径：
   * 「不能把抽屉开着就结束了」—— 失败收尾不再区分谁开的） */
  bp = await bootBagPage(null, {
    preOpen: true,
    rowStatus: '<span id="ds6">● 活动待开始</span><a id="dstart">开始活动</a>'
  });
  bp.api.setTimingForTest({ tick: 120, verify: 300, scanMs: 300, precheck: 300, reverify: 200, reverifyRetry: 200 });
  bp.api.manualStart();
  await waitBag(function () {
    return bp.messages.some(function (m) { return /发福袋失败/.test(m.text); });
  }, 15000);
  ok(bp.clicks.dstart === 1, '㊺ ④ 铺垫：抽屉已开 → 就地点了「开始活动」');
  ok(!bp.doc.getElementById('drawer'), '㊺ ④ 用户自己开的抽屉，核对失败也收起');

  /* ㊺⑤ 平台卡住（读数迟迟不回来）→ 看门狗到点收尾，不永远「核对中」。
   * 把首轮核对推得很远（60 秒）模拟回调不回来，看门狗 600ms 兜底。 */
  bp = await bootBagPage(null, {
    preOpen: true,
    rowStatus: '<span id="ds7">● 活动待开始</span><a id="dstart">开始活动</a>'
  });
  bp.api.setTimingForTest({
    tick: 200, verify: 200, scanMs: 300, precheck: 300,
    reverify: 60000, reverifyRetry: 60000, reverifyWatchdog: 600
  });
  bp.api.manualStart();
  ok(await waitBag(function () {
    return !bp.api.reverifyState() &&
      bp.messages.some(function (m) { return /发福袋失败/.test(m.text); });
  }, 9000), '㊺ ⑤ 核对卡住 → 看门狗到点给结论（不再无限「核对中」）');
  ok(!bp.doc.getElementById('drawer'), '㊺ ⑤ 卡住收尾后抽屉同样收起');
  ok(bp.api.snapshot().phase === 'live', '㊺ ⑤ 卡住收尾后状态回到 live');
  summary();
})();
