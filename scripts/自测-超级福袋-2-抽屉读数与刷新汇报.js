/**
 * 自测 · 超级福袋（第 2/6 组：抽屉读数与刷新汇报）
 * ============================================================
 * 2026-11-04 拆分：原 2855 行单文件按用例段拆成 6 组，交给
 * run-selftests.py 的并发调度并行跑（实测并发零退化）。
 * 断言逐条原样搬运，条数与拆分前一致（已做逐条比对）；
 * 公共件在 福袋自测公共.js。
 *
 * 用法：
 *   NODE_PATH=<node_modules> node scripts/自测-超级福袋-2-抽屉读数与刷新汇报.js
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
  console.log('===== 超级福袋 · 第 2 组（抽屉读数与刷新汇报） =====');
  /* 本组只做赋值、声明在上游组里；补声明以免严格模式报错 */
  let env, bp;

  /* ---------- ㊱ 工具栏福袋按钮已删（2026-11-01 深夜 用户「这个福袋按钮
   *    删掉，我一直说的福袋按钮是福袋浮动框按钮的意思」）---------- */
  ok(!/dycRegisterTool\(/.test(CODE),
    '㊱ 中控台工具栏不再注册「福袋」按钮（开关面板只走右下浮动圆钮）');

  /* ============================================================
   * ㊫ 停机监视 + 阶梯自查（2026-11-01 建立，2026-11-08 改阶梯）
   *    停机不再是终局：圆钮显示「等 mm:ss」（等下一次自查）或「已停 X分」；
   *    还能点就自动补回去。节奏 = 15/30/60/120/300 秒各一次，用完后每 5 分钟
   *    一直兜底，**不再有「连续 3 次彻底停」**（用户 2026-11-08 定稿）。
   *    用户亲手点「结束活动」不在补发范围（我停它就停，红线不变）。
   * ============================================================ */

  /* ㊫①②③④ 阶梯自查四步（2026-11-08 改口径）
   * 时间线：复核失败 → retryFail 第 1 档 → halted（等待期内 tick 不点）
   *        → 到点补发 → 补发再失败 → 第 2 档 → …… → 阶梯用完进兜底，仍 halted。
   * 用例把阶梯压成 [40, 120] + 兜底 400ms，整组几秒跑完。 */
  env = await boot({ watch: true, auto: true, onStartClick: 'nothing' });
  env.api.setTimingForTest({
    verify: 30, reverify: 40, reverifyRetry: 40, scanMs: 40,
    retryLadder: [40, 120], retryFallback: 400
  });
  env.tick();                          // 第 1 次点击（没反应）
  ok(await waitBag(function () {
    if (env.api.snapshot().phase === 'halted') return true;
    env.tick();
    return false;
  }, 8000), '㊫ 铺垫：复核两轮仍没读到 → 停机监视');
  env.messages.length = 0;
  ok(env.api.retryState().left > 0,
    '㊫① 停机后先进阶梯等待（剩 ' + Math.round(env.api.retryState().left) + 'ms）');
  env.tick();                          // 等待期内 → 不点
  ok(env.clicks.s1 === 1, '㊫① 等待期内不补发（不再「立即补」）');
  ok(await waitBag(function () {
    env.tick();
    return env.clicks.s1 === 2;
  }, 3000), '㊫① 第一档到点 → 补发一次（共 2 次点击）');
  ok(env.api.snapshot().resume === 1, '㊫① 补发计数 = 1');
  ok(env.api.snapshot().phase === 'starting' || env.api.snapshot().pending,
    '㊫① 补发点击进入待校验（phase=' + env.api.snapshot().phase +
      ' pending=' + env.api.snapshot().pending + '）');

  /* ㊫② 补发也失败 → 进第 2 档，等待期内不重试 */
  ok(await waitBag(function () {
    if (env.api.snapshot().phase === 'halted') return true;
    env.tick();
    return false;
  }, 8000), '㊫② 铺垫：补发复核也失败 → 回到停机监视');
  env.messages.length = 0;
  env.tick();                          // 第 2 档等待中 → 不点
  ok(env.clicks.s1 === 2, '㊫② 阶梯等待期内不重试（仍 2 次）');
  ok(env.api.snapshot().phase === 'halted', '㊫② 等待期内保持停机监视');
  ok(env.byType('alert').length === 0, '㊫② 补发失败不重复弹「已停止」（只留首次通知）');

  /* ㊫③ 第 2 档到点 → 再补一次 */
  ok(await waitBag(function () {
    env.tick();
    return env.clicks.s1 === 3;
  }, 4000), '㊫③ 第二档到点 → 再补一次（共 3 次）');
  ok(env.api.snapshot().resume === 2, '㊫③ 补发计数 = 2');

  /* ㊫④ 阶梯用完 → 不彻底停，转每 5 分钟兜底一直查（用户 2026-11-08 定稿） */
  ok(await waitBag(function () {
    if (env.api.snapshot().phase === 'halted') return true;
    env.tick();
    return false;
  }, 8000), '㊫④ 铺垫：第二次补发也失败');
  const rs4 = env.api.retryState();
  ok(rs4.step > rs4.ladder.length,
    '㊫④ 阶梯已用完 → 进兜底（第 ' + rs4.step + ' 次，共 ' + rs4.ladder.length + ' 档）');
  ok(rs4.left > 300,
    '㊫④ 兜底等待 = 设定值（剩 ' + Math.round(rs4.left) + 'ms）');
  ok(env.api.snapshot().phase === 'halted' && env.api.snapshot().timers.tick === true,
    '㊫④ 不彻底停：仍在停机监视、定时器还在跑（旧版这里会 stopped）');
  env.messages.length = 0;
  env.tick();
  ok(env.clicks.s1 === 3, '㊫④ 兜底等待期内同样不点');

  /* ㊫⑤ 停机中出现新活动 → 补发成功，播「已补发」，计数清零 */
  env = await boot({ watch: false, auto: true, status: '活动已结束', withStart: false });
  env.watch({ luckyBag: true });                            // 第 1 拍
  env.tick();                                               // 第 2 拍 → halted
  ok(env.api.snapshot().phase === 'halted', '㊫⑤ 铺垫：先停在停机监视');
  const stNew = env.doc.getElementById('st1');
  if (stNew) stNew.textContent = '● 活动待开始';            // 平台上出现可点的新活动
  const aNew = env.doc.createElement('a');
  aNew.id = 's1';
  aNew.textContent = '开始活动';
  aNew.addEventListener('click', function () {
    env.clicks.s1++;
    if (stNew) stNew.textContent = '● 活动进行中 距结束 06:00';
    if (aNew.parentNode) aNew.parentNode.removeChild(aNew);
  });
  env.doc.querySelector('#r1 td:last-child').appendChild(aNew);
  env.messages.length = 0;
  env.tick();                                               // 补发点击
  ok(env.clicks.s1 === 1, '㊫⑤ 停机监视中发现新活动 → 自动补发点击');
  await sleep(60);
  env.tick();                                               // 校验成功
  ok(env.api.snapshot().phase === 'live', '㊫⑤ 补发成功回到进行中');
  ok(env.api.snapshot().halted === false && env.api.snapshot().resume === 0,
    '㊫⑤ 停机标记与补发计数清零');
  ok(env.messages.filter(function (m) { return /已发出/.test(m.count); }).length === 1,
    '㊫⑤ 补发成功播「已发出 · 剩 X」（成功必须有倒计时）');

  /* ㊫⑥ 停机中别人续上了（行变进行中）→ 立即恢复，不再补点 */
  env = await boot({ watch: false, auto: true, status: '活动已结束', withStart: false });
  env.watch({ luckyBag: true });
  env.tick();                                               // halted
  ok(env.api.snapshot().phase === 'halted', '㊫⑥ 铺垫：停机监视中');
  env.doc.getElementById('st1').textContent = '● 活动进行中';
  env.tick();
  ok(env.api.snapshot().phase === 'live', '㊫⑥ 停机中读到「进行中」→ 立即恢复');
  ok(env.api.snapshot().halted === false, '㊫⑥ 恢复后停机标记清零');
  ok(env.api.snapshot().badge === '进行中', '㊫⑥ 圆钮回到「进行中」');
  ok(env.clicks.s1 === 0, '㊫⑥ 平台已在跑，补发不再点（防重复开始）');

  /* ㊫⑦ 弹窗被关掉 → 保持已停（不自动开窗的约束不变），停了多久仍持续可见 */
  env = await boot({ watch: false, auto: true, status: '活动已结束', withStart: false });
  env.watch({ luckyBag: true });
  env.tick();                                               // halted
  const dlgEl = env.doc.getElementById('dlg');
  if (dlgEl && dlgEl.parentNode) dlgEl.parentNode.removeChild(dlgEl);
  env.tick();
  env.tick();
  ok(env.api.snapshot().phase === 'halted', '㊫⑦ 弹窗关着时保持停机监视');
  ok(/^已停/.test(env.api.snapshot().badge), '㊫⑦ 停了多久仍在圆钮上持续可见');

  /* ============================================================
   * ㊬ 防双开 + 自动收抽屉（2026-11-01 定稿）
   *    有「进行中」绝不开第二个；抽屉开着纯属挡视线 →
   *    连续两拍替用户收掉，30 秒冷却防拉锯。
   * ============================================================ */

  /* ㊬① 防双开闸：进行中 + 待开始并存 → 待开始的不点 */
  env = await boot({ watch: true, auto: true });
  env.api.setTimingForTest({ afterDrawLag: 0, resumeQuiet: 0 });   // ㊬② 要验「清零后下一拍就点」，冷却与结束证据归 ㊴/㋅⑭
  const tbA = env.doc.querySelector('#dlg tbody');
  tbA.insertAdjacentHTML('beforeend',
    '<tr id="r0"><td>10元店铺红包 ID0</td><td>本次奖品数：1</td>' +
    '<td>达到店铺粉丝团等级LV20</td><td><span>● 活动进行中</span></td></tr>');
  await sleep(30);
  env.tick();
  env.tick();
  env.tick();
  ok(env.clicks.s1 === 0, '㊬① 有进行中的活动在跑 → 待开始行不点（防双开）');

  /* ㊬② 进行中活动结束（行被平台收走）→ 下一拍正常续点（续轮能力保留） */
  const r0el = env.doc.getElementById('r0');
  if (r0el && r0el.parentNode) r0el.parentNode.removeChild(r0el);
  env.tick();
  ok(env.clicks.s1 === 1, '㊬② 进行中清零后 → 下一拍点候选（正常续轮）');

  /* ㊬③ 自动收抽屉：抽屉开着 + 有进行中（非我们开的）→ 连续两拍收掉
   *     （2026-11-01 补充定稿：整组绑定「自动发福袋」开关，auto 必须开） */
  env = await boot({ watch: true, auto: true, withStart: false });   // 先无进行中
  let escCount = 0;
  env.doc.addEventListener('keydown', function (e) { if (e.key === 'Escape') escCount++; });
  env.tick();                          // 消化启动拍（无进行中，连续计数归零）
  setText(env, 'st1', '● 活动进行中');
  env.tick();                          // 第 1 拍有进行中：只计数不动作
  ok(escCount === 0, '㊬③ 第 1 拍只计数，不动手');
  env.tick();                          // 第 2 拍：连续 2 拍 → 收
  await sleep(50);
  ok(escCount === 1, '㊬③ 连续 2 拍「有进行中 + 抽屉开着」→ 派 Esc 收抽屉');

  /* ㊬④ 冷却：收完 30 秒内不再收（用户马上重开不被秒关） */
  env.tick();
  env.tick();
  await sleep(50);
  ok(escCount === 1, '㊬④ 冷却期内不重复收');

  /* ㊬⑤ 校验期衔接：点完开始的校验通过拍只计 1 拍，下一拍才收 */
  env = await boot({ watch: true, auto: true, onStartClick: 'running' });
  let esc5 = 0;
  env.doc.addEventListener('keydown', function (e) { if (e.key === 'Escape') esc5++; });
  env.tick();                                               // 点 s1 → 行变进行中
  ok(env.clicks.s1 === 1, '㊬⑤ 铺垫：候选已点、进入校验');
  env.tick();                                               // 校验通过拍：streak=1
  ok(esc5 === 0, '㊬⑤ 校验通过拍不立即收（连续 2 拍才动手）');
  env.tick();                                               // 连续第 2 拍 → 收
  await sleep(50);
  ok(esc5 === 1, '㊬⑤ 校验过后连续 2 拍 → 正常收抽屉');

  /* ㊬⑥ 纯监视（自动发福袋关）不收抽屉：只读模式绝不替用户动抽屉 */
  env = await boot({ watch: true, auto: false, withStart: false });
  let esc6 = 0;
  env.doc.addEventListener('keydown', function (e) { if (e.key === 'Escape') esc6++; });
  env.tick();                          // 消化启动拍
  setText(env, 'st1', '● 活动进行中');
  env.tick();
  env.tick();
  env.tick();
  await sleep(50);
  ok(esc6 === 0, '㊬⑥ 自动发福袋关着 → 有进行中也不收抽屉（监视只读）');

  /* ============================================================
   * ㊭ 入口文案改版回退（2026-11-02 凌晨真机）
   *    平台把入口按钮文案改成只剩「超级福袋」，老的
   *    「超级福袋-活动管理」整串在页面上已不存在（pageClues
   *    全页只剩一条「超级福袋」）—— bagEntry 必须按候选链回退，
   *    否则确认节拍/手动刷新永远找不到门。
   *    「推荐使用超级福袋」运营提示多出前缀，与候选不完全相等，
   *    精确匹配天然避开 —— ㊭③ 顺带验证它不被误点。
   * ============================================================ */

  /* ㊭① 改版后短文案：button 里就一句「超级福袋」（当前真机写法） */
  bp = await bootBagPage(null, { entryHtml: '<button id="entry">超级福袋</button>' });
  ok(bp.clicks.entry === 0, '㊭① 进页面不当场开抽屉（留 3 秒给页面渲染完）');
  bp.api.confirmNow();
  ok(bp.clicks.entry === 1, '㊭① 入口只剩「超级福袋」也能找到门并点开');
  await sleep(700);
  ok(!!bp.doc.getElementById('drawer'), '㊭① 抽屉被打开了');
  await sleep(1400);
  ok(/有进行中的福袋/.test(bp.api.snapshot().check.stat),
    '㊭① 确认汇报看上面进行中（不报抽屉行数）：' + bp.api.snapshot().check.stat);
  ok(bp.win.__dycBagPanelOpen === false, '㊭① 读完抽屉关上、让路放开');

  /* ㊭② 「图标+两段裸文本」按钮：没有叶子等于整串 → 控件层整串兜底
   *     （textContent = 超级福袋活动管理，路径②命中） */
  bp = await bootBagPage(null, {
    entryHtml: '<button id="entry"><i></i>超级福袋<i></i>活动管理</button>'
  });
  bp.api.confirmNow();
  ok(bp.clicks.entry === 1, '㊭② 图标+两段裸文本入口点得到（控件层整串匹配）');

  /* ㊭③ 「图标+两行 span」按钮：叶子「超级福袋」命中但爬不到 button
   *     （button 整串 = 超级福袋活动管理）→ 点内层 span 靠冒泡开门；
   *     旁边摆一条「推荐使用超级福袋」运营提示，绝不被误点 */
  bp = await bootBagPage('<span id="promo">推荐使用超级福袋</span>', {
    entryHtml: '<button id="entry"><i></i><span>超级福袋</span><span>活动管理</span></button>'
  });
  const promoEl = bp.doc.getElementById('promo');
  if (promoEl) promoEl.addEventListener('click', function () { bp.clicks.promo = (bp.clicks.promo || 0) + 1; });
  bp.api.confirmNow();
  ok(bp.clicks.entry === 1, '㊭③ 图标+两行 span 入口点得到（内层叶子靠冒泡开门）');
  ok(!bp.clicks.promo, '㊭③ 「推荐使用超级福袋」运营提示不被误点');

  /* ㊭④ 门都没了：提示不再写死旧文案（2026-11-02 起写法会变） */
  bp = await bootBagPage(null, { entryHtml: '' });
  bp.api.confirmNow();
  await sleep(60);
  ok(/没找到福袋抽屉入口/.test(bp.api.snapshot().check.stat),
    '㊭④ 找不到门时报「没找到福袋抽屉入口」：' + bp.api.snapshot().check.stat);
  ok(bp.api.snapshot().check.stat.indexOf('超级福袋-活动管理') < 0,
    '㊭④ 提示里不再出现写死的旧文案');

  /* ㊭⑤ 汇报口径（2026-11-02 凌晨 用户定「不要看下面，看上面才是决定
   * 有没有在进行的福袋」）：抽屉里全是历史行（下面）也不报行数，
   * 上面没有进行中卡片就直说没有。 */
  bp = await bootBagPage(null, { preOpen: true, rowStatus: '活动已结束' });
  bp.api.manualRefresh();                       // 抽屉开着 → 直接用眼前读数
  /* 2026-11-02 深夜起：否定结论先复核一拍（NEG_RECHECK_MS），
   * 所以这里等结论落地，不能读「复核中…」那一刻。 */
  await waitBag(function () {
    const s = bp.api.snapshot().check.stat;
    return /手动刷新｜/.test(s) && !/复核中/.test(s);
  }, 6000);
  ok(/没有进行中的福袋/.test(bp.api.snapshot().check.stat),
    '㊭⑤ 下面全是历史行、上面没卡片 → 报「没有进行中的福袋」：' + bp.api.snapshot().check.stat);
  ok(!/读到 \d+ 行/.test(bp.api.snapshot().check.stat),
    '㊭⑤ 历史行再多也不进汇报（行数≠进行中）');
  summary();
})();
