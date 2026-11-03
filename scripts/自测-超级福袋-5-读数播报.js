/**
 * 自测 · 超级福袋（第 5/6 组：读数播报）
 * ============================================================
 * 2026-11-04 拆分：原 2855 行单文件按用例段拆成 6 组，交给
 * run-selftests.py 的并发调度并行跑（实测并发零退化）。
 * 断言逐条原样搬运，条数与拆分前一致（已做逐条比对）；
 * 公共件在 福袋自测公共.js。
 *
 * 用法：
 *   NODE_PATH=<node_modules> node scripts/自测-超级福袋-5-读数播报.js
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
  console.log('===== 超级福袋 · 第 5 组（读数播报） =====');
  /* 本组只做赋值、声明在上游组里；补声明以免严格模式报错 */
  let bp;

  /* ---------- ㊿ 手动刷新的读数：绿点，但不进消息盒子（2026-11-03 用户定）----------
   * 用户原话：「这个消息用绿色点，但是不存进消息盒子。」
   *   ① 读到有福袋在跑 ⇒ 绿点（success），这条口气就是「一切正常」；
   *   ② 读数只是当下快照，点几次刷新就来几条，不许写进历史盒子
   *      （盒子留给结果与异常，否则正经消息会被读数挤下去）；
   *   ③ 没跑 / 读不到仍是灰点 —— 只有「确有进行中」才配绿。
   * 断言按「点色来源 + 是否落盒」断，不绑死整句文案与空格。 */
  /* 轮询等目标状态：异步用例一律等状态，禁止固定 sleep 卡时间
   * （2026-11-02 实测固定 4300ms 在并发下 5 轮红 2 轮）。 */
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

  /* ============================================================
   * ㊯ 点完「开始活动」之后的死锁（2026-11-03 凌晨真机）
   *   用户原话：「点了手动发福袋，获取不到倒计时，然后重新点手动发福袋，
   *   就提示等他结束再发，但是他自己又不知道有没有成功发。与此同时，
   *   手动刷新也被拦截不能刷新」。
   *   根因：tick 开头 `if (!rows.length) return` 在校验点击之前就返回 ——
   *   平台点完把抽屉收起后行数归零，pendingClick 永远挂着，
   *   phase 停在 starting，两条人工出路全被同一条闸挡住。
   * ============================================================ */

  /* ㊯① 点完平台把抽屉收起（行全没了）→ 先进入延时复核，复核完必须结案。
   * 2026-11-03 晚改口径（用户原话「发了福袋之后本来已经成功发出了，但是
   * 他自己没读到，急急忙忙就提示没发成功。不如改成隔个几秒钟再打开抽屉
   * 确认一次，如果真没有，再弹出提示也不迟」）：
   * 旧断言「看不见行也要立刻结案」已经过时 —— 现在第一次读不到先挂起复核，
   * 复核完（真没有）才播报。 */
  bp = await bootBagPage(null, {
    drawerRowHtml: '<span id="ds9">● 活动待开始</span><a id="dstart">开始活动</a>'
  });
  bp.openDrawer();
  bp.api.setTimingForTest({
    tick: 120, verify: 400, scanMs: 200, reverify: 200, reverifyRetry: 200
  });
  bp.api.manualStart();
  /* 8000ms：手动发福袋现在要先过 START_PRECHECK_MS(3 秒) 才点得下去 */
  ok(await waitBag(function () { return bp.clicks.dstart >= 1; }, 9000),
    '㊯① 铺垫：点了「开始活动」');
  bp.doc.getElementById('host').innerHTML = '';        // 平台收起抽屉
  ok(await waitBag(function () { return bp.api.snapshot().reverify !== null; }, 4000),
    '㊯① 读不到 → 先进延时复核（不急着报没发上）');
  ok(await waitBag(function () { return bp.api.snapshot().phase !== 'starting'; }, 6000),
    '㊯① 复核完一定结案（旧版永远停在 starting）：' + bp.api.snapshot().phase);
  ok(bp.messages.some(function (m) { return /发福袋失败/.test(m.text) && /手动刷新/.test(m.full); }),
    '㊯① 复核也没读到才给出出路');

  /* ㊰① 真机主场景（2026-11-03 晚）：福袋其实发出去了，只是平台晚一两秒
   * 才把「进行中」渲染出来 —— 复核必须认成成功，而不是报「没发上」。 */
  bp = await bootBagPage(null, {
    drawerRowHtml: '<span id="ds12">● 活动待开始</span><a id="dstart">开始活动</a>'
  });
  bp.openDrawer();
  bp.api.setTimingForTest({
    tick: 120, verify: 300, scanMs: 200, reverify: 500, reverifyRetry: 500
  });
  bp.api.manualStart();
  ok(await waitBag(function () { return bp.clicks.dstart >= 1; }, 9000),
    '㊰① 铺垫：点了「开始活动」');
  bp.messages.length = 0;
  bp.doc.getElementById('host').innerHTML = '';        // 平台收起抽屉：这一眼读不到
  /* 复核窗口内平台把「进行中」补上（卡片 1 秒后才渲染） */
  setTimeout(function () {
    const d = bp.doc.createElement('div');
    d.innerHTML = '<span>进行中活动</span><span>03 分 12 秒 后结束</span>' +
      '<div>10元店铺红包 ID 活动ID:7702886904815681901</div>';
    bp.doc.body.appendChild(d);
  }, 700);
  ok(await waitBag(function () {
    return bp.api.snapshot().reverify === null &&
      bp.messages.some(function (m) { return /已发出/.test(m.count || ''); });
  }, 6000), '㊰① 复核读到「进行中 + 倒计时」→ 按成功结案');
  ok(!bp.messages.some(function (m) { return /没发上/.test(m.text); }),
    '㊰① 成功路径绝不报「没发上」：' +
      bp.messages.map(function (m) { return m.text; }).join(' / '));
  ok(bp.messages.some(function (m) {
    return /已发出/.test(m.count || '') && /剩\s*\d{2}:\d{2}/.test(m.count || '');
  }), '㊰① 成功播报带出剩余时间（成功口径 = 确认发出 + 倒计时）');
  /* 复核期间再点「手动发福袋」不许发第二个 */
  const beforeDstart = bp.clicks.dstart;
  bp.api.manualStart();
  await sleep(150);
  ok(bp.clicks.dstart === beforeDstart, '㊰① 复核/结案当场再点也不发第二个');

  /* ㊰② 2026-11-04 真机：复核确实读到了「进行中」，但那一行没有倒计时
   *（倒计时在卡片上、卡片被抽屉收起带走）。旧版结案后 drawAt 仍是 0，
   * 下一拍空现场就把圆钮压回「未开始」—— 人以为没发上，其实活动早在跑。 */
  bp = await bootBagPage(null, {
    drawerRowHtml: '<span id="ds14">● 活动待开始</span><a id="dstart">开始活动</a>'
  });
  bp.openDrawer();
  bp.api.setTimingForTest({
    tick: 120, verify: 300, scanMs: 200, reverify: 500, reverifyRetry: 500
  });
  bp.api.manualStart();
  ok(await waitBag(function () { return bp.clicks.dstart >= 1; }, 9000),
    '㊰② 铺垫：点了「开始活动」');
  bp.messages.length = 0;
  bp.doc.getElementById('host').innerHTML = '';        // 平台收起抽屉
  setTimeout(function () {
    bp.doc.getElementById('host').innerHTML =
      '<div id="drawer"><input id="q" placeholder="请输入奖品名称">' +
      '<table><tbody><tr id="r14"><td><div>10元店铺红包 ID 8899</div></td>' +
      '<td><span>● 活动进行中</span></td></tr></tbody></table></div>';
  }, 700);                                             // 只写状态词，没有秒数
  ok(await waitBag(function () {
    return bp.api.snapshot().reverify === null && bp.api.snapshot().probe !== null;
  }, 6000), '㊰② 读到「进行中」但没倒计时 → 不算成功，转只读追读');
  ok(!bp.messages.some(function (m) { return /已发出/.test(m.count || ''); }),
    '㊰② 没读到倒计时就不发成功消息（成功口径两条都要成立）');
  ok(!/未开始/.test(bp.api.snapshot().badge) && !/^\d{2}:\d{2}$/.test(bp.api.snapshot().badge),
    '㊰② 结案后圆钮不得退回「未开始」（读到在跑、只是没秒数）：' + bp.api.snapshot().badge);
  ok(/已发出/.test(bp.api.snapshot().check.stat),
    '㊰② 结论写回状态（旧版停在「复核中」）：' + bp.api.snapshot().check.stat);
  ok(!/复核中/.test(bp.api.snapshot().check.stat), '㊰② 结案后不留「复核中」字样');

  /* ㊰③ 弱证据：点完那一行的「开始活动」链接消失、状态词又认不出
   *（平台把它拆成多个节点）。同一活动的链接没了 = 点击已生效，
   * 不能因为「读不到进行中」就报没发上。 */
  bp = await bootBagPage(null, {
    drawerRowHtml: '<span id="ds15">● 活动待开始</span><a id="dstart">开始活动</a>'
  });
  bp.openDrawer();                                       // 用户自己开的抽屉：复核不重开
  bp.api.setTimingForTest({
    tick: 120, verify: 300, scanMs: 200, reverify: 500, reverifyRetry: 500
  });
  bp.api.manualStart();
  ok(await waitBag(function () { return bp.clicks.dstart >= 1; }, 9000),
    '㊰③ 铺垫：点了「开始活动」');
  bp.messages.length = 0;
  /* 平台就地更新这一行：链接撤掉、只留一句认不出的「已开始」（节点不变 → 同一个行身份） */
  const td15 = bp.doc.querySelector('#r1 td:last-child');
  if (td15) td15.innerHTML = '<span>● 已开始</span>';
  ok(await waitBag(function () {
    return bp.api.snapshot().reverify === null && bp.api.snapshot().probe !== null;
  }, 6000), '㊰③ 链接消失 = 点击已生效 → 结案并转只读追读（不报没发上）');
  ok(!bp.messages.some(function (m) { return /没发上/.test(m.text); }),
    '㊰③ 弱证据路径也不许报「没发上」：' +
      bp.messages.map(function (m) { return m.text; }).join(' / '));
  ok(/已发出/.test(bp.api.snapshot().check.stat),
    '㊰③ 结论写回状态：' + bp.api.snapshot().check.stat);

  /* ============================================================
   * ㊾ 只读追读（2026-11-04 用户口径，本批的核心）
   *   原话：「等二次开启专门找进行中的行为，真没有发现有倒计时的时候，
   *   就报失败。然后 XX 秒后重试」。
   *   · 确认发出但没倒计时：**不当场下结论**，30 秒后开抽屉只读一眼；
   *   · 追到倒计时 = 成功；追满两次仍没有 = 失败 + 30 秒后重试；
   *   · 全程绝不点「开始活动」—— 那时福袋已经在跑了，再点就是双开。
   * ============================================================ */

  /* ㊾① 追到了 → 成功 */
  bp = await bootBagPage(null, {
    drawerRowHtml: '<span id="ds20">● 活动待开始</span><a id="dstart">开始活动</a>'
  });
  bp.openDrawer();
  bp.api.setTimingForTest({
    tick: 120, verify: 300, scanMs: 200, reverify: 200, reverifyRetry: 200,
    probe: 200, probeMax: 2
  });
  bp.api.manualStart();
  ok(await waitBag(function () { return bp.clicks.dstart >= 1; }, 9000),
    '㊾① 铺垫：点了「开始活动」');
  const td20 = bp.doc.querySelector('#r1 td:last-child');
  if (td20) td20.innerHTML = '<span id="ds20">● 活动进行中</span>';   // 有进行中、无倒计时
  bp.messages.length = 0;
  ok(await waitBag(function () { return bp.api.snapshot().probe !== null; }, 8000),
    '㊾① 确认发出但没倒计时 → 转只读追读（不急着下结论）');
  ok(!bp.messages.some(function (m) {
    return /已发出|已发出|失败/.test(m.text + (m.count || ''));
  }), '㊾① 追读期间不播结论（成功失败都还说不准）');
  if (td20) td20.innerHTML = '<span id="ds20">● 活动进行中 距结束 05:00</span>';
  bp.api.probeNow();
  ok(await waitBag(function () {
    return bp.messages.some(function (m) {
      return /已发出/.test(m.count || '') && /剩\s*\d{2}:\d{2}/.test(m.count || '');
    });
  }, 6000), '㊾① 追到倒计时 → 报成功并带剩余时间');
  ok(bp.api.snapshot().probe === null, '㊾① 成功后追读收工');

  /* ㊾② 两次都没追到 → 报失败 + 交代重试，且绝不立刻重发 */
  bp = await bootBagPage(null, {
    drawerRowHtml: '<span id="ds21">● 活动待开始</span><a id="dstart">开始活动</a>'
  });
  bp.openDrawer();
  bp.api.setTimingForTest({
    tick: 120, verify: 300, scanMs: 200, reverify: 200, reverifyRetry: 200,
    probe: 200, probeMax: 2
  });
  bp.api.manualStart();
  ok(await waitBag(function () { return bp.clicks.dstart >= 1; }, 9000),
    '㊾② 铺垫：点了「开始活动」');
  const td21 = bp.doc.querySelector('#r1 td:last-child');
  if (td21) td21.innerHTML = '<span id="ds21">● 活动进行中</span>';   // 始终不给倒计时
  bp.messages.length = 0;
  ok(await waitBag(function () { return bp.api.snapshot().probe !== null; }, 8000),
    '㊾② 转只读追读');
  bp.api.probeNow();
  ok(await waitBag(function () {
    const p = bp.api.snapshot().probe;
    return p && p.n >= 1;
  }, 6000), '㊾② 第一次没追到 → 再等一轮');
  bp.api.probeNow();
  ok(await waitBag(function () {
    return bp.messages.some(function (m) { return /发福袋失败/.test(m.text); });
  }, 6000), '㊾② 追满两次仍没有倒计时 → 报失败');
  const fail21 = bp.messages.filter(function (m) { return /发福袋失败/.test(m.text); })[0];
  ok(!!fail21 && /\S/.test(fail21.count || ''), '㊾② 失败消息带结果数（手动这一路是「未发出」）');
  ok(!!fail21 && /倒计时/.test(fail21.full || ''), '㊾② 失败原因写清是「没读到倒计时」（不冤枉平台没发出）');
  const c21 = bp.clicks.dstart;
  bp.api.tick();
  await sleep(80);
  bp.api.tick();
  ok(bp.clicks.dstart === c21, '㊾② 报失败后不立刻重发（锁 30 秒，防双开）');

  /* ㊯② 确认窗口内点「手动刷新」：不再被「等它完成再刷新」挡死 */
  bp = await bootBagPage(null, {
    drawerRowHtml: '<span id="ds10">● 活动待开始</span><a id="dstart">开始活动</a>'
  });
  bp.openDrawer();
  bp.api.setTimingForTest({ tick: 120, verify: 5000, scanMs: 200 });
  bp.api.manualStart();
  ok(await waitBag(function () { return bp.clicks.dstart >= 1; }, 9000),
    '㊯② 铺垫：点了「开始活动」，正处于确认窗口');
  bp.messages.length = 0;
  bp.api.manualRefresh();
  await sleep(150);
  ok(bp.messages.some(function (m) { return /确认/.test(m.text) && /自动刷新/.test(m.text); }),
    '㊯② 手动刷新给出「等 N 秒自动刷新」而不是死锁：' +
      bp.messages.map(function (m) { return m.text; }).join(' / '));

  /* ㊯③ 只有进行中卡片、行读不全时，卡片仍要能给出倒计时（独立读数） */
  bp = await bootBagPage(null, { cardsHtml: cardHtml('福袋活动1', '02', '52', 770288809950) });
  bp.openDrawer();
  bp.api.tick();
  ok(bp.api.snapshot().running === true, '㊯③ 卡片在跑 → 判得出「进行中」');
  ok(/^0?2:\d{2}$|^\d{2}:\d{2}$/.test(String(bp.api.snapshot().badge)),
    '㊯③ 圆钮显示卡片倒计时：' + bp.api.snapshot().badge);

  /* ㊯④ 刷新网页后第一次直接点手动发福袋（2026-11-03 00:15 真机，用户原话
   * 「直接点手动发福袋，他就会无视进行中的福袋直接发，太过草率了，是恶性的行为」）：
   * 刷新后内存全清、页面又不渲染进行中卡片，插件「忘了」刚才有福袋在跑 ——
   * 旧版看都不看就把待开始行点掉，多发一个。现在会话存储里那份还没到期的
   * 读数就是第一道防线：预检直接拦，连抽屉入口都不找。 */
  bp = await bootBagPage(null, {
    drawerRowHtml: '<span id="ds11">● 活动待开始</span><a id="dstart">开始活动</a>',
    hold: Date.now() + 9 * 60000
  });
  bp.api.tick();
  ok(bp.api.snapshot().drawIn > 8 * 60000,
    '㊯④ 铺垫：刷新后把「还没到期」的读数接回来（圆钮走秒）：' + bp.api.snapshot().drawIn);
  bp.api.manualStart();
  await waitBag(function () { return bp.messages.length > 0; }, 5000);
  ok(bp.clicks.dstart === 0, '㊯④ 读数没到期 → 一次「开始活动」都没点（不再多发）');
  ok(bp.clicks.entry === 0, '㊯④ 预检就拦下，连抽屉入口都不找');
  ok(/已经有福袋在进行中了/.test((bp.messages[bp.messages.length - 1] || {}).text || ''),
    '㊯④ 提示：' + (bp.messages[bp.messages.length - 1] || {}).text);

  /* ㊯⑤ 读数到期后就别再冒充「进行中」（否则圆钮永远停在假倒计时上） */
  bp = await bootBagPage(null, { hold: Date.now() + 400 });
  bp.api.tick();
  ok(bp.api.snapshot().running === true, '㊯⑤ 铺垫：还没到期 → 按读数走');
  await sleep(600);
  bp.api.tick();
  ok(bp.api.snapshot().running === false, '㊯⑤ 到期后不再声称进行中');

  /* ㊯⑥ 手动刷新读到「有」→ 写进会话存储（刷新后接回 + 防误发都靠它） */
  bp = await bootBagPage(null, {});
  bp.api.manualRefresh();
  ok(await waitBag(function () { return bp.api.snapshot().running === true; }, 8000),
    '㊯⑥ 手动刷新读到「有进行中」');
  var holdRaw = bp.win.sessionStorage.getItem('dycBagHoldDrawAt');
  ok(Number(holdRaw) > Date.now(), '㊯⑥ 读数写进会话存储（刷新后能接回）：' + holdRaw);

  /* ㊯⑦ 抽屉一关、页面不渲染卡片刻画 → 仍按这份读数走秒
   *（旧版下一拍就清零，圆钮约 20 秒后回到「未开始」，人以为福袋没了） */
  bp.doc.getElementById('host').innerHTML = '';
  bp.api.tick();
  ok(bp.api.snapshot().running === true, '㊯⑦ 现场消失后仍按上次读数走秒');
  ok(bp.api.snapshot().drawIn > 0, '㊯⑦ 圆钮倒计时不为 0：' + bp.api.snapshot().drawIn);

  /* ㊯⑧ 读到倒计时 → 卡片还渲染了一两秒（这一拍读到现场）→ 卡片消失
   *（插件读到进行中就会替用户关抽屉），圆钮必须还在走秒。
   * 2026-11-03 00:20 真机：「获取到倒计时，但是一两秒后直接变回未开始」——
   * 旧版在「读到现场」那一拍把读数兜底清掉了，等现场一消失就再没东西兜。 */
  bp = await bootBagPage(null, {});
  bp.api.manualRefresh();
  ok(await waitBag(function () { return bp.api.snapshot().running === true; }, 8000),
    '㊯⑧ 铺垫：手动刷新读到「有进行中」');
  bp.doc.getElementById('host').innerHTML =
    '<div><span>进行中活动</span><span>02 分 40 秒 后结束</span>' +
    '<div>10元店铺红包 ID 活动ID:7702886904815681999</div></div>';
  bp.api.tick();
  ok(bp.api.snapshot().running === true, '㊯⑧ 铺垫：卡片还在，这一拍读到现场');
  bp.doc.getElementById('host').innerHTML = '';          // 卡片消失
  bp.api.tick();
  ok(bp.api.snapshot().running === true,
    '㊯⑧ 现场消失后仍按读数走秒（旧版这里回「未开始」）：' + bp.api.snapshot().badge);
  ok(bp.api.snapshot().drawIn > 0, '㊯⑧ 倒计时不为 0：' + bp.api.snapshot().drawIn);
  summary();
})();
