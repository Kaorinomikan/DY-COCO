/**
 * 自测 · 超级福袋（第 4/6 组：读数轮询与多卡）
 * ============================================================
 * 2026-11-04 拆分：原 2855 行单文件按用例段拆成 6 组，交给
 * run-selftests.py 的并发调度并行跑（实测并发零退化）。
 * 断言逐条原样搬运，条数与拆分前一致（已做逐条比对）；
 * 公共件在 福袋自测公共.js。
 *
 * 用法：
 *   NODE_PATH=<node_modules> node scripts/自测-超级福袋-4-读数轮询与多卡.js
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
  console.log('===== 超级福袋 · 第 4 组（读数轮询与多卡） =====');
  /* 本组只做赋值、声明在上游组里；补声明以免严格模式报错 */
  let bp;

  /* ---------- ㊺ 手动刷新读数轮询（2026-11-02 深夜真机「手动刷新还是没
   * 检测到」）----------
   * 抽屉外壳点开就出现，表格/活动卡片要等服务端回包才渲染。原来固定等
   * 1.6 秒读一次，读到空壳就报「没有进行中的福袋」——真机上明明有福袋
   * 在跑，这句话就是假话。改成轮询等行出现，读不到也只说读不到。 */

  /* ㊺① 内容晚 2 秒才渲染 → 轮询仍能读到「有进行中」 */
  bp = await bootBagPage(null, { renderDelayMs: 2000 });
  bp.api.manualRefresh();
  ok(bp.clicks.entry === 1, '㊺ ① 手动刷新照常点入口开抽屉');
  ok(!bp.doc.querySelector('#drawer tr'), '㊺ ① 铺垫：此刻抽屉里还没有行（空壳）');
  await sleep(2700);                    // 1.2 秒首读 + 900ms 后才渲染出来
  ok(/手动刷新｜有进行中的福袋/.test(bp.api.snapshot().check.stat),
    '㊺ ① 内容晚 2 秒渲染也能读到：' + bp.api.snapshot().check.stat);
  ok(!bp.doc.getElementById('drawer'), '㊺ ① 读完后照常关掉自己开的抽屉');

  /* ㊺② 抽屉一直读不到内容、也没有空态文案 → 只说「没读到」，绝不说「没有」 */
  bp = await bootBagPage(null, { emptyDrawer: true });
  bp.api.setTimingForTest({ panelReadMs: 900 });
  bp.api.manualRefresh();
  await waitBag(function () {
    const s = bp.api.snapshot().check.stat;
    return /手动刷新｜/.test(s) && !/复核中/.test(s);
  }, 8000);
  ok(/没读到/.test(bp.api.snapshot().check.stat),
    '㊺ ② 读不到内容 → 报「没读到」：' + bp.api.snapshot().check.stat);
  ok(!/没有进行中的福袋/.test(bp.messages[bp.messages.length - 1].text),
    '㊺ ② 不替平台断言「没有进行中的福袋」：' + bp.messages[bp.messages.length - 1].text);

  /* ㊺③ 抽屉里是平台空态文案（确实没有活动）→ 这时说「没有」才是对的 */
  bp = await bootBagPage('<script type="text/plain">没有进行中的福袋活动</script>', {
    emptyDrawer: true
  });
  bp.api.manualRefresh();
  await waitBag(function () {
    const s = bp.api.snapshot().check.stat;
    return /手动刷新｜/.test(s) && !/复核中/.test(s);
  }, 8000);
  ok(/手动刷新｜没有进行中的福袋/.test(bp.api.snapshot().check.stat),
    '㊺ ③ 平台空态在 → 正常报「没有进行中的福袋」：' + bp.api.snapshot().check.stat);

  /* ㊺④ 抽屉已开着（用户自己开的）时点手动刷新 → 也走轮询，且不替你关 */
  bp = await bootBagPage(null, { renderDelayMs: 1500 });
  bp.openDrawer();
  ok(!!bp.doc.getElementById('drawer'), '㊺ ④ 铺垫：抽屉已开着（用户开的）');
  bp.api.manualRefresh();
  await sleep(2400);
  ok(/有进行中的福袋/.test(bp.api.snapshot().check.stat),
    '㊺ ④ 已开抽屉读不到时也等：' + bp.api.snapshot().check.stat);
  ok(!!bp.doc.getElementById('drawer'), '㊺ ④ 用户自己开的抽屉不替你关');

  /* ---------- ㊺⑤~⑦ 「没有」结论复核（2026-11-02 23:50 真机）----------
   * 用户原话：「刷新网页，第一次点手动刷新福袋状态，第一次必定失败无法
   * 获取福袋倒计时」。诊断报告流水两行互证：
   *   23:49:57 手动刷新｜没有进行中的福袋
   *   23:50:01 手动刷新｜有进行中的福袋，剩 10 分 58 秒
   * 页面重载后平台福袋数据要重新回包，首读拿到的是空壳/历史行 ——
   * 旧版一次读到否定证据就落结论并关抽屉，人必须点第二次。
   * 现在：**读到「有」立刻出结果；读到「没有」先复核 NEG_RECHECK_MS
   * 再看一眼抽屉行与常驻卡片**，两次都否定才报「没有」。 */

  /* ㊺⑤ 首读只有历史行，卡片 1 秒后才渲染 → 复核读到「有」 */
  bp = await bootBagPage(null, { preOpen: true, rowStatus: '活动已结束' });
  setTimeout(function () {
    const d = bp.doc.createElement('div');
    d.innerHTML = '<span>进行中活动</span><span>03 分 12 秒 后结束</span>' +
      '<div>10元店铺红包 ID 活动ID:7702886904815681901</div>';
    bp.doc.body.appendChild(d);
  }, 1000);
  bp.api.manualRefresh();
  ok(await waitBag(function () { return /有进行中/.test(bp.api.snapshot().check.stat); }, 6000),
    '㊺ ⑤ 首读只有历史行、卡片 1 秒后才出现 → 复核读到「有」：' + bp.api.snapshot().check.stat);
  ok(!/没有进行中的福袋/.test(bp.api.snapshot().check.stat),
    '㊺ ⑤ 不把「还没渲染」说成「没有进行中的福袋」');

  /* ㊺⑥ 首读命中平台空态，1.2 秒后卡片才渲染 → 复核同样读到「有」 */
  bp = await bootBagPage('<script type="text/plain">没有进行中的福袋活动</script>', {
    emptyDrawer: true
  });
  setTimeout(function () {
    const d = bp.doc.createElement('div');
    d.innerHTML = '<span>进行中活动</span><span>08 分 05 秒 后结束</span>' +
      '<div>10元店铺红包 ID 活动ID:7702886904815681902</div>';
    bp.doc.body.appendChild(d);
  }, 1200);
  bp.api.manualRefresh();
  ok(await waitBag(function () { return /有进行中/.test(bp.api.snapshot().check.stat); }, 7000),
    '㊺ ⑥ 空态先出现、卡片 1.2 秒后才渲染 → 复核读到「有」：' + bp.api.snapshot().check.stat);

  /* ㊺⑦ 真的没有（空态常在）→ 复核完仍报「没有」，不因复核乱改口 */
  bp = await bootBagPage('<script type="text/plain">没有进行中的福袋活动</script>', {
    emptyDrawer: true
  });
  bp.api.manualRefresh();
  await waitBag(function () {
    const s = bp.api.snapshot().check.stat;
    return /手动刷新｜/.test(s) && !/复核中/.test(s);
  }, 8000);
  ok(/手动刷新｜没有进行中的福袋/.test(bp.api.snapshot().check.stat),
    '㊺ ⑦ 复核完仍无活动 → 照旧报「没有」：' + bp.api.snapshot().check.stat);
  ok(!/复核中/.test(bp.api.snapshot().check.stat), '㊺ ⑦ 结论落地后不留「复核中」字样');

  /* ---------- ㊻ 多卡并行：逐张读、取最早、已有就不发（2026-11-02 深夜）----------
   * 真机 23:17：抽屉开着、福袋活动1/活动2 两张卡都在跑，行扫描却把「说明 +
   * 两张卡 + 状态页签」认成一个 895×833 的大框（页签里有「已结束」）⇒
   * 进行中 0、圆钮未开始、手动发福袋照发第二个。 */

  /* ㊻① 两张卡：认得出 2 张，圆钮与汇总取**最早结束**的那张 */
  bp = await bootBagPage(null, {
    cardsHtml: cardHtml('福袋活动1', '02', '52', 770288809940) +
               cardHtml('福袋活动2', '01', '30', 770288809941)
  });
  bp.openDrawer();
  bp.api.tick();
  ok(bp.api.snapshot().running === true, '㊻ ① 两张卡在跑 → 进行中（行扫描认错也不影响）');
  ok(bp.api.snapshot().runningCards === 2, '㊻ ① 认出的卡片张数 = 2');
  let lefts = bp.api.snapshot().cardLeft;
  ok(lefts.length === 2 && lefts[0] < lefts[1], '㊻ ① 逐张读数并按剩余时间升序');
  ok(lefts[0] > 85000 && lefts[0] <= 90000,
    '㊻ ① 最早那张 = 1 分 30 秒（实际 ' + Math.round(lefts[0] / 1000) + ' 秒）');
  ok(bp.api.snapshot().drawIn <= 91000 && bp.api.snapshot().drawIn > 85000,
    '㊻ ① 汇总取最早：drawIn = ' + bp.api.snapshot().drawIn);
  ok(/^01:2\d$|^01:30$/.test(bp.api.snapshot().badge),
    '㊻ ① 圆钮显示最早那张的倒计时：' + bp.api.snapshot().badge);

  /* ㊻② 抽屉开着 + 已有卡在跑 → 手动发福袋不发、关浮层、原话提示 */
  bp = await bootBagPage(null, { cardsHtml: cardHtml('福袋活动1', '02', '52', 770288809942) });
  bp.openDrawer();
  bp.api.tick();
  bp.api.manualStart();
  await waitBag(function () {
    return bp.messages.some(function (m) { return /已经有福袋在进行中了/.test(m.text); });
  }, 6000);
  ok(bp.clicks.dstart === 0, '㊻ ② 已有进行中 → 一次「开始活动」都没点（不再发第二个）');
  ok(/已经有福袋在进行中了/.test((bp.messages[bp.messages.length - 1] || {}).text || ''),
    '㊻ ② 提示原话：' + (bp.messages[bp.messages.length - 1] || {}).text);
  ok(!bp.doc.getElementById('drawer'), '㊻ ② 有进行中 → 替用户关掉浮层');

  /* ㊻③ 卡片名末尾数字与倒计时紧贴（真机「福袋活动102分52秒」）→ 读 2 分 52 秒 */
  bp = await bootBagPage(null, { cardsHtml: cardHtml('福袋活动1', '02', '52', 770288809943) });
  bp.openDrawer();
  bp.api.tick();
  lefts = bp.api.snapshot().cardLeft;
  ok(lefts[0] > 170000 && lefts[0] <= 172000,
    '㊻ ③ 紧贴写法读成 2 分 52 秒（不是 102 分）：' + Math.round(lefts[0] / 1000) + ' 秒');

  /* ㊻④ 超高整块容器（说明+页签）不再被当成一行 —— 真机误判 drawn 的根因 */
  bp = await bootBagPage('<div style="height:833px">全部 待开始 进行中 已结束 异常 福袋活动说明</div>');
  bp.api.tick();
  ok(bp.api.probe().rows === 0, '㊻ ④ 895×833 的整块容器不再算作一行');

  /* ㊻⑤ 拦截也要把倒计时取出来（2026-11-03 深夜 用户原话：「跳进去抽屉如果确认
   * 有进行中的福袋，需要同时取下倒计时出来，不是关了抽屉弹提醒就完事了」）。 */
  bp = await bootBagPage(null, {
    drawerRowHtml: '<span id="ds20">● 活动进行中 距结束 03:12</span>'
  });
  bp.openDrawer();
  bp.api.setTimingForTest({ tick: 120, scanMs: 200 });
  bp.api.manualStart();
  var blockedMsg = function () { return (bp.messages[bp.messages.length - 1] || {}).text || ''; };
  ok(await waitBag(function () { return /已经有福袋在进行中/.test(blockedMsg()); }, 6000),
    '㊻⑤ 铺垫：拦截提示出来了：' + blockedMsg());
  ok(bp.clicks.dstart === 0, '㊻⑤ 仍然一个都不发');
  ok(bp.api.snapshot().running === true && bp.api.snapshot().drawIn > 0,
    '㊻⑤ 拦截时顺手取到倒计时（旧版关完抽屉就丢了）：' + bp.api.snapshot().drawIn);
  ok(/剩 \d+ 分/.test(blockedMsg()), '㊻⑤ 提示里带上剩余时间：' + blockedMsg());
  ok(!bp.doc.getElementById('drawer'), '㊻⑤ 关抽屉的既有行为不变');
  /* ============================================================
   * ㊮ 抽屉锚点拆节点 + 倒计时窗口（2026-11-02 深夜真机）
   *   真机两份报告互相矛盾：手动刷新报「没有进行中的福袋」（说明读到了
   *   平台空态），同一份报告里抽屉却是「没认出 · 开始活动链接 0 个」。
   *   唯一解释：那串字在整页 textContent 里有、在叶子级找不到 ——
   *   平台把标题/空态/按钮都拆成了多个节点渲染。
   * ============================================================ */

  /* ㊮① 空态与「开始活动」都被拆成两段 → 仍认出抽屉、数得到链接 */
  const SPLIT_DRAWER = '<div id="drawer">'
    + '<div id="empty"><span>没有进行中的福袋</span><span>活动</span></div>'
    + '<table><tbody><tr id="r1"><td>10元店铺红包 ID 8899</td>'
    + '<td><button id="b1"><span>开始</span><span>活动</span></button></td></tr></tbody></table>'
    + '</div>';
  const db1 = await bootDrawer(SPLIT_DRAWER);
  db1.win.Element.prototype.getBoundingClientRect = function () {
    /* 抽屉：贴右、960 宽；其余元素维持小方块（不算抽屉） */
    if (this.id === 'drawer') {
      return { width: 960, height: 700, top: 0, left: 747, right: 1707, bottom: 700, x: 747, y: 0, toJSON: function () {} };
    }
    return { width: 120, height: 40, top: 200, left: 800, right: 920, bottom: 240, x: 800, y: 200, toJSON: function () {} };
  };
  var prA = db1.api.probe();
  ok(prA.panel === true, '㊮① 文案拆成多节点时仍认出抽屉（旧版三路全灭）：' + prA.by);
  ok(prA.startLinks >= 1, '㊮① 「开始活动」拆两段也数得到：' + prA.startLinks);
  ok(db1.api.pure.scanRows().length >= 1, '㊮① 拆节点的行也扫得到');

  /* ㊮② 抽屉关着、页面主区有抽屉专属词但几何不对 → 不许误认成抽屉开着
   *     （误认的代价很重：确认节拍会以为你开着，从此一次都不开） */
  const db2 = await bootDrawer('<div id="main"><div>活动状态 奖品信息 中奖条件 创建活动</div></div>');
  ok(db2.api.probe().panel === false, '㊮② 主区出现抽屉词但几何不满足 → 不误认');

  /* ㊮③ 拆开的「开始活动 + 复制」并排块不能被当成一条链接 */
  const db3 = await bootDrawer('<div id="drawer"><div>8元红包 奖品数 1</div>'
    + '<div id="blk"><span>开始</span><span>活动</span><span>复制</span></div></div>');
  db3.win.Element.prototype.getBoundingClientRect = function () {
    if (this.id === 'drawer') {
      return { width: 960, height: 700, top: 0, left: 747, right: 1707, bottom: 700, x: 747, y: 0, toJSON: function () {} };
    }
    return { width: 120, height: 40, top: 200, left: 800, right: 920, bottom: 240, x: 800, y: 200, toJSON: function () {} };
  };
  var prB = db3.api.probe();
  ok(prB.panel === true, '㊮③ 铺垫：抽屉认得出来（含「开始活动」字样）');
  ok(db3.api.pure.findExactLeaf(db3.doc.body, '开始活动', 12).length === 0 &&
     prB.startLinks === 0,
    '㊮③ 「开始活动+复制」并排块不算链接：' + prB.startLinks);

  /* ㊮④ 倒计时取值窗口（2026-11-02 深夜：旧版 <60 秒、>30 分钟一律丢） */
  function cdOf(txt) {
    const host = db1.doc.createElement('div');
    host.textContent = txt;
    db1.doc.body.appendChild(host);
    const at = db1.api.pure.computeDrawAt(host);
    host.parentNode.removeChild(host);
    return at ? Math.round((at - Date.now()) / 1000) : 0;
  }
  const lA = cdOf('活动进行中 剩 45 秒');
  ok(lA >= 40 && lA <= 50, '㊮④ 只剩 45 秒也读得到（旧版 <60 秒直接丢）：' + lA);
  const lB = cdOf('距结束 00:03:12');
  ok(lB > 180 && lB <= 195, '㊮④ 「时:分:秒」不再被读成 3 分：' + lB);
  const lC = cdOf('剩余 45 分钟');
  ok(lC > 2600 && lC <= 2760, '㊮④ 超过 30 分钟的长福袋也读得到：' + lC);
  ok(cdOf('开奖时间 12:30') === 0, '㊮④ 绝对时间仍不当倒计时（不回归）');
  ok(cdOf('04 分 58 秒 后结束') > 290, '㊮④ 卡片后置倒计时照旧（不回归）');
  summary();
})();
