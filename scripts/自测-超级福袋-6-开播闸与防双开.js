/**
 * 自测 · 超级福袋（第 6/6 组：开播闸与防双开）
 * ============================================================
 * 2026-11-04 拆分：原 2855 行单文件按用例段拆成 6 组，交给
 * run-selftests.py 的并发调度并行跑（实测并发零退化）。
 * 断言逐条原样搬运，条数与拆分前一致（已做逐条比对）；
 * 公共件在 福袋自测公共.js。
 *
 * 用法：
 *   NODE_PATH=<node_modules> node scripts/自测-超级福袋-6-开播闸与防双开.js
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
  console.log('===== 超级福袋 · 第 6 组（开播闸与防双开） =====');
  /* 本组只做赋值、声明在上游组里；补声明以免严格模式报错 */
  let env, bp;

  /* ---------- ㊿ 手动刷新的读数：绿点，但不进消息盒子（2026-11-03 用户定）----------
   * 用户原话：「这个消息用绿色点，但是不存进消息盒子。」
   *   ① 读到有福袋在跑 ⇒ 绿点（success），这条口气就是「一切正常」；
   *   ② 读数只是当下快照，点几次刷新就来几条，不许写进历史盒子；
   *   ③ 没跑 / 读不到仍是灰点 —— 只有「确有进行中」才配绿。
   * 断言按「点色来源 + 是否落盒」断，不绑死整句文案与空格。 */
  bp = await bootBagPage(null, { cardsHtml: cardHtml('福袋活动1', '02', '52', 770288809960) });
  bp.api.manualRefresh();
  ok(await waitBag(function () {
    return bp.messages.some(function (m) { return /进行中/.test(m.text); });
  }, 3000), '㊿① 铺垫：手动刷新读到了「进行中」那条');
  var readMsg = bp.messages.filter(function (m) { return /进行中/.test(m.text); }).pop();
  ok(readMsg.type === 'success', '㊿① 有进行中 → 绿点（success）：' + readMsg.type);
  ok(readMsg.keepHistory === false, '㊿② 读数不进消息盒子（keepHistory:false）');

  /* ㊿③ 没有进行中 ⇒ 仍是灰点，别把「没跑」也说成正常 */
  bp = await bootBagPage('<script type="text/plain">没有进行中的福袋活动</script>', { emptyDrawer: true });
  bp.api.manualRefresh();
  ok(await waitBag(function () {
    return bp.messages.some(function (m) { return /没有进行中的福袋/.test(m.text); });
  }, 3000), '㊿③ 铺垫：读到了「没有进行中」那条');
  var noneMsg = bp.messages.filter(function (m) { return /没有进行中的福袋/.test(m.text); }).pop();
  ok(noneMsg.type === 'info', '㊿③ 没有进行中 → 仍灰点（info）：' + noneMsg.type);

  /* ---------- ㋅ 开播闸改口径（2026-11-03 用户报「还没开播就一直弹出抽屉」）----------
   * 四问定稿：A 只认明确在播才自动开抽屉（unknown 也拦）；B 自动发福袋同闸；
   *          C 未开播圆钮照常露脸；D 判据抽共享模块 live-state.js。
   * 这组用例钉的就是「闸门方向」—— 它一旦被改回「unknown 当在播」，
   * 用户那条反馈就会原样复发，且症状是「安静地弹抽屉」，没人会联想到判据。 */

  /* ㋅① 判不出（页面既无在播信号、也无未开播文案）⇒ 一次都不开抽屉。
   *     这是本次反馈的正面复现：旧版这一档按在播处理，进页面 3 秒弹一次。 */
  bp = await bootBagPage(null, { live: 'none' });
  bp.api.tick();
  ok(bp.api.liveState() === 'unknown', '㋅① 判不出 = unknown（铺垫）');
  ok(bp.api.liveGate() === false, '㋅① unknown 时开播闸关着（旧版这里是开着的）');
  bp.api.confirmNow();                       // 强制到期，模拟「节拍到点了」
  await sleep(1600);
  ok(bp.clicks.entry === 0, '㋅① 判不出时到点也不开抽屉（反馈的根因就在这里）');

  /* ㋅② 明确未开播 ⇒ 同样不开（这条旧版已有，回归钉住） */
  bp = await bootBagPage(null, { live: 'off' });
  bp.api.tick();
  ok(bp.api.liveState() === 'idle', '㋅② 明确未开播 = idle（铺垫）');
  bp.api.confirmNow();
  await sleep(1600);
  ok(bp.clicks.entry === 0, '㋅② 未开播时到点也不开抽屉');

  /* ㋅③ 明确在播 ⇒ 照常开（别把闸做成「永远不开」） */
  bp = await bootBagPage(null, { live: 'on' });
  bp.api.tick();
  ok(bp.api.liveState() === 'live', '㋅③ 明确在播 = live（铺垫）');
  ok(bp.api.liveGate() === true, '㋅③ 在播时开播闸打开');
  bp.api.confirmNow();
  await sleep(1600);
  ok(bp.clicks.entry === 1, '㋅③ 在播时到点照常开抽屉确认');

  /* ㋅④ 自动发福袋同闸：判不出时**不点「开始活动」**（用户拍板 B）。
   *     这一条比抽屉更重要 —— 它真的会消耗奖励。 */
  env = await boot({ watch: true, auto: true, live: 'none', onStartClick: 'running' });
  env.tick();
  await sleep(300);
  ok(env.clicks.s1 === 0, '㋅④ 判不出时自动发福袋不点「开始活动」');
  ok(env.api.snapshot().gate === false, '㋅④ snapshot 里 gate=false（可诊断）');

  /* ㋅⑤ 对照：在播时自动发福袋照常点（同一份用例，只差 live 信号） */
  env = await boot({ watch: true, auto: true, live: 'on', onStartClick: 'running' });
  env.tick();
  await sleep(300);
  ok(env.clicks.s1 === 1, '㋅⑤ 在播时自动发福袋照常点「开始活动」');

  /* ㋅⑥ 未开播时手动刷新仍然可用（人点了就是要现在抓，跟开没开播无关） */
  bp = await bootBagPage(null, { live: 'off' });
  bp.api.tick();
  bp.api.manualRefresh();
  ok(await waitBag(function () { return bp.clicks.entry === 1; }, 3000),
    '㋅⑥ 未开播时手动刷新照常开抽屉（闸只管自动路径）');

  /* ㋅⑦ 面板灰字：非在播时出现「为什么现在不自动刷新」，在播时消失。
   *     口径反转后没有这一行，功能会变成「安静地不工作」。 */
  bp = await bootBagPage(null, { live: 'none' });
  bp.api.tick();
  bp.api.togglePanel();
  var gsh = bp.doc.getElementById('dyb-bag-panel').shadowRoot;
  var gEl = gsh.querySelector('.g8');
  ok(!!gEl && gEl.classList.contains('on'), '㋅⑦ 判不出时面板出现开播闸灰字');
  ok(/未确认在播/.test(gEl.textContent), '㋅⑦ 灰字说明原因：' + gEl.textContent);

  bp = await bootBagPage(null, { live: 'on' });
  bp.api.tick();
  bp.api.togglePanel();
  var gsh2 = bp.doc.getElementById('dyb-bag-panel').shadowRoot;
  var gEl2 = gsh2.querySelector('.g8');
  ok(!!gEl2 && !gEl2.classList.contains('on'), '㋅⑦ 在播时灰字不出现（不占地方）');

  /* ㋅⑧ 开播跃迁：从「判不出」切到「在播」要重新建立基线，
   *     不能沿用上一场残留的 nextConfirmAt（否则开播后白等一整轮）。
   *     ★ 用「反复 tick 直到结论变化」而不是固定 sleep：共享判据有 1.8 秒节流
   *       （两个调用方共用同一个窗口，不能各自推进防抖计数），开播最多 1.8 秒后
   *       才被认出来 —— 这是设计如此，不是缺陷。 */
  bp = await bootBagPage(null, { live: 'none' });
  bp.api.tick();
  ok(bp.api.liveState() === 'unknown', '㋅⑧ 铺垫：起始判不出');
  bp.doc.body.insertAdjacentHTML('beforeend', '<div id="liveTag2"><button id="btnLive">结束直播</button></div>');
  for (var g8i = 0; g8i < 15 && bp.api.liveState() !== 'live'; g8i++) {
    await sleep(200);
    bp.api.tick();
  }
  ok(bp.api.liveState() === 'live', '㋅⑧ 出现「结束直播」→ 判为在播');
  ok(bp.api.snapshot().check.next > Date.now() + 1000,
    '㋅⑧ 跃迁后重新建立确认基线（next 在未来）');

  /* ㋅⑨ 判不出在播时，手动刷新的读数也要能算出倒计时（2026-11-03 晚真机
   * 「用了手动刷新的功能，福袋又不倒计时了」）。
   * 诊断报告现场：running=true、phase=live、badge「进行中」，但 draws={}、
   * drawIn=0 —— 旧版 tick 在开播闸处整拍 return，连读页面都停了，
   * 手动刷新只能用 forceRunningNow 判出「有」，drawAt 永远算不出来。
   * 现在：闸只管写动作，读数照旧。 */
  bp = await bootBagPage(null, { live: 'none' });
  bp.api.tick();
  ok(bp.api.snapshot().gate === false,
    '㋅⑨ 铺垫：判不出在播、又没有福袋现场 → 闸关着');
  bp.api.manualRefresh();
  ok(await waitBag(function () { return bp.api.snapshot().running === true; }, 6000),
    '㋅⑨ 闸关着时手动刷新仍读得到「进行中」');
  ok(bp.api.snapshot().drawIn > 0,
    '㋅⑨ 圆钮拿到倒计时（旧版这里恒为 0）：' + bp.api.snapshot().drawIn);
  ok(/剩/.test(bp.api.snapshot().check.stat),
    '㋅⑨ 读数文案带剩余时间：' + bp.api.snapshot().check.stat);
  /* 读数能维持：抽屉一关、页面又没有卡片，也要继续走秒（hold 兜底） */
  bp.doc.getElementById('host').innerHTML = '';
  bp.api.tick();
  ok(bp.api.snapshot().running === true && bp.api.snapshot().drawIn > 0,
    '㋅⑨ 抽屉收起后仍按这份读数走秒：' + bp.api.snapshot().drawIn);

  /* ㋅⑩ 读数陈旧自愈（2026-11-03 深夜真机「福袋已经停了很久了，按钮还显示
   * 进行中」）：没有到期时刻、又很久没见到现场，圆钮不许再自称「进行中」。
   * 造法：给一份 1.2 秒后就到期的读数 → tick 一拍 → 到期后**不调 tick**
   *（模拟 tick 停摆 / 页面在后台），直接看圆钮。 */
  bp = await bootBagPage(null, { hold: Date.now() + 1200 });
  bp.api.tick();
  ok(bp.api.snapshot().running === true, '㋅⑩ 铺垫：读数还没到期');
  ok(/^\d{2}:\d{2}$/.test(String(bp.api.snapshot().badge)),
    '㋅⑩ 铺垫：圆钮在倒计时：' + bp.api.snapshot().badge);
  await sleep(1400);
  ok(String(bp.api.snapshot().badge) === '未开始',
    '㋅⑩ 读数到期且久未核对 → 圆钮降级「未开始」：' + bp.api.snapshot().badge);
  ok(bp.api.snapshot().running === false, '㋅⑩ 状态一并写回（不留假的进行中）');

  /* ㋅⑪ 手动刷新要能「证伪」（用户原话：「用了手动刷新，他自己也查不出来」）。
   * 造法：先挂一份未到期的旧读数，抽屉里的行是「已结束」，并让 tick 因页面
   * 在后台而早退 —— 旧版这时只会附和旧读数，新版要以眼前的行推翻它。 */
  bp = await bootBagPage(null, { hold: Date.now() + 9 * 60000 });
  bp.api.tick();
  ok(bp.api.snapshot().running === true, '㋅⑪ 铺垫：挂着一份未到期的旧读数');
  /* 平台这时才把抽屉内容摆出来：只有一条「已结束」的历史行 */
  bp.doc.getElementById('host').innerHTML =
    '<div id="drawer"><input id="q" placeholder="请输入奖品名称"><table><tbody>' +
    '<tr id="r1"><td><div>10元店铺红包 ID 8899</div></td><td>活动已结束</td></tr>' +
    '</tbody></table></div>';
  Object.defineProperty(bp.doc, 'hidden', { get: function () { return true; }, configurable: true });
  bp.messages.length = 0;
  bp.api.manualRefresh();
  ok(await waitBag(function () {
    var s = bp.api.snapshot().check.stat;
    return /手动刷新｜/.test(s) && !/复核中/.test(s);
  }, 9000), '㋅⑪ 手动刷新给出结论：' + bp.api.snapshot().check.stat);
  ok(/没有进行中/.test(bp.api.snapshot().check.stat),
    '㋅⑪ 明确判「没有进行中的福袋」：' + bp.api.snapshot().check.stat);
  ok(bp.api.snapshot().running === false, '㋅⑪ 假读数被推翻');

  /* ㋅⑫ 判据认不出时，福袋现场就是「在播」证据（2026-11-03 深夜真机
   * 「福袋结束不会自动续福袋」：判据 everLive 始终 false、streak 89，
   * 开播闸恒关，自动开始下一轮一次都不会发生）。 */
  bp = await bootBagPage(null, { live: 'none', preOpen: true });
  bp.api.tick();
  ok(bp.api.snapshot().running === true, '㋅⑫ 铺垫：抽屉里有进行中的行');
  ok(bp.api.snapshot().gate === true,
    '㋅⑫ 判不出但在播证据在 → 动作闸放开（旧版恒关）：' + bp.api.snapshot().gate);

  /* ㋅⑬ 开始下一轮前先确认上一轮真结束（2026-11-03 深夜 用户原话：「开始下一轮福袋之前，
   * 先检查上一个福袋是不是真的结束，防止倒计时出错了，导致双开福袋。如果遇到
   * 福袋真的有进行中，那就先不发，更正一下时间再继续等续福袋」）。
   * 造法：账上还挂着一份没到期的读数，但抽屉里只有「待开始」行 ——
   * 绝不能因为「行里看不到进行中」就点下去。 */
  bp = await bootBagPage(null, {
    hold: Date.now() + 900,
    drawerRowHtml: '<span id="ds40">● 活动待开始</span><a id="dstart">开始活动</a>'
  });
  bp.api.setAutoForTest(true);
  bp.api.setTimingForTest({ tick: 120, afterDrawLag: 0 });
  bp.openDrawer();
  bp.api.tick();
  ok(bp.clicks.dstart === 0, '㋅⑬ 读数没到期 → 不开始下一轮（防倒计时读错导致双开）');
  await sleep(1100);
  bp.api.tick();
  ok(bp.clicks.dstart === 1, '㋅⑬ 读数到期后才点下一轮（开始下一轮没被拦死）');

  /* ㋅⑭ 没有「已结束」证据时先别续（用户 2026-11-03 深夜：「先检查上一个福袋
   * 是不是真的结束，防止倒计时出错了，导致双开福袋」）。
   * 造法：上一轮刚跑过（lastRunningAt 刚刷新），抽屉里已经换成「待开始」行，
   * 但既没有「已结束」行也没有平台空态 —— 这只是「看不见了」，不是「结束了」。 */
  bp = await bootBagPage(null, {
    drawerRowHtml: '<span id="ds50">● 活动进行中</span>'
  });
  bp.api.setAutoForTest(true);
  bp.api.setTimingForTest({ tick: 120, afterDrawLag: 0, resumeQuiet: 400 });
  bp.openDrawer();
  bp.api.tick();
  ok(bp.api.snapshot().running === true, '㋅⑭ 铺垫：上一轮读到「进行中」');
  bp.doc.getElementById('host').innerHTML =
    '<div id="drawer"><input id="q" placeholder="请输入奖品名称"><table><tbody>' +
    '<tr id="r2"><td><div>10元店铺红包 ID 8899</div></td>' +
    '<td><span id="ds51">● 活动待开始</span><a id="dstart">开始活动</a></td></tr>' +
    '</tbody></table></div>';
  bp.api.tick();
  ok(bp.clicks.dstart === 0, '㋅⑭ 只见「待开始」没有结束证据 → 先不发（防双开）');
  await sleep(500);
  bp.api.tick();
  ok(bp.clicks.dstart === 1, '㋅⑭ 静默期过后才开始下一轮');

  /* ㋅⑮ 一轮结束后的「追下一轮」节奏（2026-11-05 用户报「手动开的福袋
   * 结束后不会续发」）。
   * 现场：确认间隔默认 5 分钟，而只要抽屉开过一次（到点验证 / 手动刷新
   * 都会开），下一次就被推到 5 分钟后 —— 平台渲染下一轮「待开始」行那一两秒
   * 的空窗，代价是 5 分钟盲等；2 分钟一轮的福袋看起来就是「再也不发了」。
   * 口径：自动发福袋开着 + 此刻没有福袋在跑 + 最近 10 分钟内见过一轮
   * ⇒ 下一次开抽屉按 60 秒硬上限追，不按 5 分钟。
   * 反向：关掉自动发福袋，仍是 5 分钟常规节拍（不替只读模式勤开抽屉）。
   * 注意量的是 tick 自带的那次确认（真实链路就是它），不额外调 confirmNow ——
   * 后者会被「一分钟硬上限」挡住，量不到东西。 */
  async function lookGapFor(auto) {
    const e = await bootBagPage();
    e.api.setAutoForTest(auto);
    e.api.setTimingForTest({ tick: 999999, lock: 0, afterDrawLag: 0, resumeQuiet: 0 });
    e.openDrawer();
    e.doc.querySelector('#drawer tbody').innerHTML =
      '<tr id="r1"><td><div>10元店铺红包 ID 8899</div></td>' +
      '<td>进行中 距结束 03:12</td></tr>';
    e.api.tick();                                 // 记下 lastRunningAt
    e.api.expireDrawForTest();                    // 倒计时走到 0（时间没真走）
    e.doc.querySelector('#drawer tbody').innerHTML =
      '<tr id="r1"><td><div>10元店铺红包 ID 8899</div></td>' +
      '<td>已结束 共 8 人中奖</td></tr>';          // 下一轮的「待开始」还没渲染出来
    e.api.tick();                                 // 到点验证这一拍会开一次抽屉
    return (e.api.snapshot().check.next || 0) - Date.now();
  }

  const gapAuto = await lookGapFor(true);
  ok(gapAuto > 0 && gapAuto <= 61000,
    '㋅⑮ 等下一轮时下一次开抽屉按 60 秒上限追（实际 ' + Math.round(gapAuto / 1000) + ' 秒）');

  const gapOff = await lookGapFor(false);
  ok(gapOff > 120000,
    '㋅⑮ 自动发福袋关着 → 仍按确认间隔（实际 ' + Math.round(gapOff / 1000) + ' 秒）');

  /* ㋅⑯ 续发闸诊断（2026-11-05）：自动开着却不续发时，快照要能说清卡在哪一道。
   * 这条只验「有话说、说得出机器码」，不绑具体文案 —— 文案是给人读的。 */
  bp = await bootBagPage();
  bp.api.setAutoForTest(true);
  bp.api.setTimingForTest({ tick: 999999, lock: 0 });
  bp.openDrawer();
  bp.doc.querySelector('#drawer tbody').innerHTML =
    '<tr id="r1"><td><div>10元店铺红包 ID 8899</div></td>' +
    '<td>已结束 共 8 人中奖</td></tr>';           // 只有已结束行：没有可点候选
  bp.api.tick();
  let av = bp.api.snapshot().auto;
  ok(!!av && av.code === 'no-cand',
    '㋅⑯ 没有可点候选 → 诊断给出 no-cand（实际 ' + (av && av.code) + '）');
  ok(!!av && typeof av.why === 'string' && av.why.length > 0, '㋅⑯ 诊断同时带一句人话');
  ok(!!av && typeof av.lookIn === 'number', '㋅⑯ 诊断带「下次开抽屉还有多久」');

  bp.doc.querySelector('#drawer tbody').innerHTML =
    '<tr id="r2"><td><div>5元红包 ID 8898</div></td>' +
    '<td>待开始 <a id="dstart">开始活动</a></td></tr>';
  bp.api.tick();
  ok(bp.api.snapshot().auto.code === '',
    '㋅⑯ 真点出去的那一拍，诊断标记为已放行');

  /* ㋅⑯-b 抽屉关着、但上一轮读数还没到期（2026-11-10 真机诊断报告）。
   * 现场：快照里 runningCards=1 / cardLeft 有值，续发闸却写「看不见现场
   * （抽屉关着、也没有进行中卡片）」—— 自相矛盾，读报告的人会以为它现在
   * 真什么都没看见。口径：读数未到期 ⇒ running-hold + 剩余秒数。 */
  bp = await bootBagPage();
  bp.api.setAutoForTest(true);
  bp.api.setTimingForTest({ tick: 999999, lock: 0 });
  bp.openDrawer();
  bp.doc.querySelector('#drawer tbody').innerHTML =
    '<tr id="r1"><td><div>10元店铺红包 ID 8899</div></td>' +
    '<td>进行中 距结束 03:12</td></tr>';
  bp.api.tick();                                // 读到进行中 ⇒ 记下到期时刻
  bp.doc.getElementById('drawer').remove();     // 抽屉关掉：这一拍什么都读不到
  bp.api.tick();
  av = bp.api.snapshot().auto;
  ok(!!av && av.code === 'running-hold',
    '㋅⑯ 抽屉关着但读数未到期 → 报 running-hold，不是「看不见现场」（实际 ' +
    (av && av.code) + '）');
  ok(!!av && /\d\d:\d\d/.test(av.why),
    '㋅⑯ 那句人话带上剩余时间，与同一份快照的读数对得上：' + (av && av.why));
  ok(bp.api.snapshot().auto.why.indexOf('间隔') > -1,
    '㋅⑯ 顺带说明「结束后按间隔 N 秒发」，间隔设 0 也照样写明');

  summary();
})();
