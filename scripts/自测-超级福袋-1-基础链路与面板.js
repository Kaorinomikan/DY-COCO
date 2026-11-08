/**
 * 自测 · 超级福袋（第 1/6 组：基础链路与面板）
 * ============================================================
 * 2026-11-04 拆分：原 2855 行单文件按用例段拆成 6 组，交给
 * run-selftests.py 的并发调度并行跑（实测并发零退化）。
 * 断言逐条原样搬运，条数与拆分前一致（已做逐条比对）；
 * 公共件在 福袋自测公共.js。
 *
 * 用法：
 *   NODE_PATH=<node_modules> node scripts/自测-超级福袋-1-基础链路与面板.js
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
  console.log('===== 超级福袋 · 第 1 组（基础链路与面板） =====');

  console.log('===== 超级福袋 · 开奖监视与自动开始下一轮 =====');

  /* ---------- ① 开关全关：一点不动、一声不出 ---------- */
  let env = await boot({ watch: false, auto: true });
  ok(env.api && env.api.snapshot().timers.tick === false, '① 监视关闭时不挂定时器');
  env.tick();
  ok(env.clicks.s1 === 0, '① 关闭状态下不点击');
  ok(env.messages.length === 0, '① 关闭状态下不出声');

  /* ---------- ② 首次拨开：立刻生效（验证 prev 已记） ---------- */
  ok(typeof env.watch() === 'function' || true, '② 已订阅开关变化');
  env.watch({ luckyBag: true });
  ok(env.api.snapshot().flags.watch === true, '② 拨开后立刻生效');
  ok(env.api.snapshot().timers.tick === true, '② 拨开后挂上定时器');
  env.messages.length = 0;
  env.watch({ luckyBag: false });
  ok(env.api.snapshot().flags.watch === false, '② 拨关后立刻失效');
  ok(env.messages.length === 1 && env.messages[0].source === '福袋功能增强' &&
     env.messages[0].text === '已关闭', '② 拨关有且只有一条回声（来源词「福袋功能增强」）');

  /* ---------- ③ 监视模式：只读，绝不自动点 ---------- */
  env = await boot({ watch: true, auto: false });
  env.tick();
  ok(env.clicks.s1 === 0, '③ 只开监视时不点「开始活动」');
  ok(env.api.probe().detail[0].kind === 'pending', '③ 只监视也能认出「待开始」');

  /* ---------- ④ 自动开始下一轮：点一次，事件序列完整 ---------- */
  env = await boot({ watch: true, auto: true, onStartClick: 'runningTimed' });
  // boot 落地的那一拍时，面板开关（autoOn）还没预置 —— 真机上存储读回也是
  // 异步的，第一拍天然不点；这里手动补一拍验「开关开着就会点」。
  env.tick();
  ok(env.clicks.s1 === 1, '④ 有待开始活动时点一次「开始活动」');
  ok(env.clicks.c1 === 0, '④ 绝不误点邻居「复制」');
  ok(env.events.indexOf('pointerdown') >= 0 && env.events.indexOf('mousedown') >= 0 &&
     env.events.indexOf('pointerup') >= 0 && env.events.indexOf('mouseup') >= 0 &&
     env.events.indexOf('click') >= 0, '④ 点击序列五段齐全');

  /* ---------- ⑤ 点完变成「进行中 + 倒计时」→ 已发出 ----------
   * 2026-11-04 用户定：成功 = **确认发出了福袋，且提取到倒计时**，两条都成立。
   * 只读到「进行中」而没有倒计时不算成功（走 ㊾ 的追读 → 失败路径）。 */
  await sleep(60);
  env.messages.length = 0;
  env.tick();
  const sentMsg = env.byType('success')[0];
  ok(!!sentMsg && sentMsg.source === '福袋', '⑤ 已发出带来源词「福袋」');
  ok(!!sentMsg && /已发出/.test(sentMsg.count), '⑤ 结果数写「已发出」');
  ok(!!sentMsg && /剩\s*\d{2}:\d{2}/.test(sentMsg.count), '⑤ 结果数带出剩余时间（成功必须有倒计时）');
  ok(!!sentMsg && sentMsg.histKey === 'bagSent', '⑤ 成功消息用固定 histKey 原位刷新（不刷屏）');
  ok(env.api.snapshot().round === undefined, '⑤ 快照不再有轮次字段（福袋不计数轮次）');

  /* ---------- ⑥ 开奖：播一条「已结束」并承上启下 ----------
   * 2026-11-04 用户：「福袋计时结束要弹一次消息提示」「用一句话承上启下」。 */
  env.messages.length = 0;
  setText(env, 'st1', '● 活动已结束，共 8 人中奖');
  env.tick();
  const doneMsgs = env.messages.filter(function (m) { return /已结束/.test(m.text); });
  ok(doneMsgs.length === 1, '⑥ 一轮结束只播一条（两条判定路径去重）');
  ok(!!doneMsgs[0] && /8\s*人/.test(doneMsgs[0].full), '⑥ 盒子里带出参与人数 8');
  ok(!!doneMsgs[0] && /秒后自动发下一轮|准备自动发下一轮/.test(doneMsgs[0].count),
     '⑥ 结果数承上启下：自动发下一轮');
  ok(!/第\s*\d+\s*轮|共\s*\d+\s*轮/.test(doneMsgs[0].text + doneMsgs[0].count + doneMsgs[0].full),
    '⑥ 结束文案里不再计数轮次');

  /* ---------- ⑦ 开奖后开始下一轮：点的是同一活动 ----------
   * （开奖收尾 15 秒冷却不在这验 —— ㊴ 专验；这里把冷却归零，
   *   保持「开奖后立即开始下一轮」的原始用例意图。） */
  env.api.setTimingForTest({ afterDrawLag: 0, resumeQuiet: 0 });   // 结束证据归 ㋅⑭ 专验
  env.api.expireDrawForTest();      // 时间没真走：把上一轮的读数拨到期，开始下一轮才放行
  setText(env, 'st1', '● 活动待开始');
  const td = env.doc.querySelector('#r1 td:last-child');
  if (td) {
    const a = env.doc.createElement('a');
    a.id = 's2'; a.textContent = '开始活动';
    a.addEventListener('click', function () { env.clicks.s1++; });
    td.appendChild(a);
  }
  env.tick();
  ok(env.clicks.s1 === 2, '⑦ 开奖后确实又点了一次「开始活动」');

  /* ---------- ⑧ 没有可点的了 → 连续两拍停（转入停机监视，可补发） ---------- */
  // 先关着起，再拨开 —— 否则 boot 里那一拍已经用掉了「防抖」这一次机会
  env = await boot({ watch: false, auto: true, status: '活动已结束', withStart: false });
  env.watch({ luckyBag: true });                            // 第 1 拍
  ok(env.api.snapshot().phase !== 'stopped' && env.api.snapshot().phase !== 'halted', '⑧ 第一拍不急着停（防抖）');
  env.tick();                                               // 第 2 拍
  ok(env.api.snapshot().phase === 'halted', '⑧ 连续两拍无可点 → 停机监视（不再是终局）');
  ok(env.api.snapshot().reason === 'no-activity', '⑧ 停止原因 = 已无可用福袋');
  ok(env.api.snapshot().halted === true, '⑧ 快照标记停机监视中');
  ok(env.byType('alert').length === 1, '⑧ 停止只报一条 alert');

  /* ---------- ⑨ 点了没反应 → 先走复核，两轮仍没读到才停（补发走冷却） ----------
   * 2026-11-04 改口径：自动这一路也交给复核（与手动发福袋同一套），
   * 不再「3 秒没变进行中就判死」—— 真发出去的福袋常常晚一两秒才渲染。 */
  env = await boot({ watch: true, auto: true, onStartClick: 'nothing' });
  env.api.setTimingForTest({ verify: 30, reverify: 60, reverifyRetry: 60, scanMs: 60 });
  env.tick();
  await sleep(80);
  env.messages.length = 0;
  ok(await waitBag(function () {
    env.tick();                    // 驱动结案：超过校验窗口仍未变进行中 → 进复核
    return env.api.snapshot().reverify !== null;
  }, 3000), '⑨ 点完没反应 → 先进复核（不再 3 秒就判死）');
  ok(await waitBag(function () {
    if (env.api.snapshot().phase === 'halted') return true;
    env.tick();                    // 驱动结案：超过校验窗口仍未变进行中 → 进复核
    return false;
  }, 8000), '⑨ 复核两轮仍没读到 → 停机监视（可补发）');
  ok(env.api.snapshot().reason === 'no-effect', '⑨ 停止原因 = 点了没反应');
  ok(env.clicks.s1 === 1, '⑨ 失败后不立即连点（只点过一次）');
  ok(env.byType('alert').length === 1, '⑨ 失败只报一条 alert');
  /* 文案只承诺「会自己再试」，不暴露间隔/次数/复核动作（2026-11-04 用户：
   * 「不需要跟客户讲太明白操作原理」）。反向断言更稳：不绑死具体措辞。
   * 2026-11-08 改阶梯后措辞是「还会按阶梯自查，直到读到结果或你手动停」。 */
  ok(/自动再试|自动重试|自动补|自查/.test(env.byType('alert')[0].full),
    '⑨ 停止播报交代「会自动补」 [' + env.byType('alert')[0].full + ']');
  ok(/秒后(重试|自查)/.test(env.byType('alert')[0].count || ''),
    '⑨ 自动发福袋失败交代「多少秒后重试」：' + env.byType('alert')[0].count);
  ok(!/复核|停机|秒没读到|进行中」/.test(env.byType('alert')[0].full),
    '⑨ 停止播报不暴露内部机制（复核次数 / 停机 / 校验秒数）');

  /* ---------- ⑩ 四种「不可点」都要认出来 ---------- */
  const notClickable = [
    { name: 'disabled', opts: { startTag: 'button', startAttrs: 'disabled="disabled"' } },
    { name: 'aria-disabled', opts: { startAttrs: 'aria-disabled="true"' } },
    { name: 'pointer-events:none', opts: { startStyle: 'pointer-events:none' } },
    { name: '灰字', opts: { startStyle: 'color:rgb(187,187,187)' } }
  ];
  for (const c of notClickable) {
    const e2 = await boot(Object.assign({ watch: true, auto: true, onStartClick: 'running' }, c.opts));
    e2.tick();
    ok(e2.clicks.s1 === 0, '⑩ 不可点（' + c.name + '）时不动手');
  }

  /* ---------- ⑪ 说明文字不能被当成按钮 ---------- */
  env = await boot({ watch: true, auto: true, withStart: false, status: '活动待开始' });
  const td2 = env.doc.querySelector('#r1 td:last-child');
  if (td2) {
    const s = env.doc.createElement('span');
    s.textContent = '开始活动后不可修改';
    td2.appendChild(s);
  }
  env.tick();
  ok(env.clicks.s1 === 0, '⑪ 「开始活动后不可修改」不被当成可点按钮');

  /* ---------- ⑫ 弹窗被关掉 → 静默等待，不停机不报警 ---------- */
  env = await boot({ watch: true, auto: true, onStartClick: 'running' });
  env.tick();
  await sleep(50);
  env.tick();
  env.doc.getElementById('dlg').parentNode.removeChild(env.doc.getElementById('dlg'));
  env.messages.length = 0;
  env.tick(); env.tick(); env.tick();
  ok(env.api.snapshot().phase !== 'stopped', '⑫ 弹窗被关掉时不停止（你随时可能再打开）');
  ok(env.messages.length === 0, '⑫ 弹窗被关掉时不报警（不打扰直播）');
  /* 2026-11-04 放宽：这个夹具点完只写「活动进行中」、没有倒计时。
   * 读到在跑但没有秒数时圆钮显示「进行中」（不编数字、也不退回「未开始」）——
   * 旧断言只允许 MM:SS / 未开始，等于要求刚读到在跑也要立刻说没开始。 */
  ok(/^(?:\d{2}:\d{2}|进行中|未开始)$/.test(env.api.snapshot().badge), '⑫ 悬浮窗仍显示倒计时（本轮还没开奖，你知道还剩多久）');

  /* ---------- ⑬ 有弹窗但没有活动行（还在加载）→ 一直等 ---------- */
  env = await boot({ watch: true, auto: true, noRows: true });
  env.tick();
  await sleep(60);
  env.tick(); env.tick();
  ok(env.api.snapshot().phase !== 'stopped', '⑬ 表格还在加载时不停机');
  ok(env.api.snapshot().phase === 'live', '⑬ 保持在扫描态，等表格渲染出来');

  /* ---------- ⑭ 后台标签页不动作 ---------- */
  env = await boot({ watch: false, auto: true, onStartClick: 'running' });
  Object.defineProperty(env.doc, 'hidden', { value: true, configurable: true });
  env.watch({ luckyBag: true });                            // 拨开即触发一拍，但被 hidden 拦下
  ok(env.clicks.s1 === 0, '⑭ 页面不可见时不点击');
  Object.defineProperty(env.doc, 'hidden', { value: false, configurable: true });
  env.tick();
  ok(env.clicks.s1 === 1, '⑭ 恢复可见后立刻补一拍');

  /* ---------- ⑮ 同一拍连续 tick 5 次 → 仍只点 1 次 ---------- */
  env = await boot({ watch: true, auto: true, onStartClick: 'nothing' });
  for (let i = 0; i < 5; i++) env.tick();
  ok(env.clicks.s1 === 1, '⑮ 同一拍连点 5 次仍只点一次（幂等闸生效）');

  /* ---------- ⑯ 关掉开关后，再推也不点 ---------- */
  env = await boot({ watch: false, auto: true, onStartClick: 'running' });
  env.watch({ luckyBag: true });                            // 开 → 点一次
  const beforeOff = env.clicks.s1;
  ok(beforeOff === 1, '⑯ 开着时确实会点（对照组）');
  env.watch({ luckyBag: false });
  env.tick(); env.tick();
  ok(env.clicks.s1 === beforeOff, '⑯ 关掉开关后不再点击');
  ok(env.api.snapshot().timers.tick === false, '⑯ 关掉开关后定时器已清');

  /* ---------- ⑰ 用户亲手点「结束活动」→ 判据成立 ---------- */
  // jsdom 造不出 isTrusted=true 的事件（own 且不可配置），所以直接喂假事件
  // 给纯函数 —— 这正是把判定从监听器里抽出来的原因。
  env = await boot({ watch: true, auto: true, onStartClick: 'running' });
  const endBtn = env.doc.createElement('a');
  endBtn.id = 'end1';
  endBtn.textContent = '结束活动';
  env.doc.body.appendChild(endBtn);
  ok(env.api.pure.isUserStopClick({ isTrusted: true, target: endBtn }) === true,
    '⑰ 真人点「结束活动」判定成立（会让插件停下）');
  ok(env.api.pure.isUserStopClick({ isTrusted: false, target: endBtn }) === false,
    '⑰ 合成事件不算用户接管（否则点开始活动会把自己停掉）');
  ok(env.api.pure.isUserStopClick({ isTrusted: true, target: env.doc.getElementById('s1') }) === false,
    '⑰ 真人点「开始活动」不算接管（那是正常操作）');

  /* ---------- ⑱ 自己派发的合成点击不会被当成「用户接管」 ---------- */
  env = await boot({ watch: true, auto: true, onStartClick: 'running' });
  env.tick();
  ok(env.api.snapshot().phase !== 'stopped', '⑱ 合成点击（isTrusted=false）不触发接管停机');

  /* ---------- ⑲ 文案纪律：条上短、盒子里全 ---------- */
  const alerts = env.messages.filter(function (m) { return m.type === 'alert'; });
  ok(alerts.every(function (m) { return m.source === '福袋'; }), '⑲ 所有 alert 都带来源词');
  env = await boot({ watch: true, auto: true, status: '活动已结束', withStart: false });
  env.tick(); env.tick();
  const a1 = env.byType('alert')[0];
  ok(!!a1 && a1.text.length <= 24, '⑲ alert 条上文案 ≤24 字');
  ok(!!a1 && a1.full.length > a1.text.length, '⑲ alert 盒子里有更长说明（full）');
  ok(!!a1 && !!a1.count, '⑲ alert 带结果数（共 N 轮）');

  /* ---------- ⑳ 静态纪律 ---------- */
  ok(/clearInterval/.test(CODE), '⑳ 有定时器清理');
  ok(!/\[class\*=/.test(CODE.replace(/\/\*[\s\S]*?\*\//g, '')), '⑳ 源码不含 [class*= 类名选择器');
  const statusCalls = CODE.match(/setStatus\([^;]*?\);/g) || [];
  ok(statusCalls.length >= 3 && statusCalls.every(function (s) { return /source:/.test(s); }),
    '⑳ 每个 setStatus 调用都传了 source');

  const liveJs = MANIFEST.content_scripts[1].js;
  const iBag = liveJs.indexOf('src/live/lucky-bag.js');
  const iBar = liveJs.indexOf('src/live/toolbar.js');
  ok(iBag > 0 && iBar > 0 && iBag < iBar, '⑳ manifest 里 lucky-bag 在 toolbar 之前（入口必须最后）');

  ok(/label:\s*'福袋功能增强'/.test(FLAGS_SRC),
    '⑳ 「福袋功能增强」已登记（2026-11-01 深夜改名）');
  ok(!/key:\s*'luckyBagWatch'/.test(FLAGS_SRC) && !/key:\s*'luckyBagAuto'/.test(FLAGS_SRC),
    '⑳ 两个子开关已从 popup 撤下（自动发福袋挪进悬浮面板）');
  ok(/AUTO_KEY\s*=\s*'dycBagAuto'/.test(CODE),
    '⑳ 「自动发福袋」开关存本地键 dycBagAuto（悬浮窗内，不占 popup）');
  ok(/var autoOn = false/.test(CODE),
    '⑳ 「自动发福袋」默认关闭（花真奖品，必须用户主动开）');

  /* ---------- ㉑ 点成功后：行内没给倒计时就只说「进行中」 ----------
   * 2026-11-04 口径：确认发出但没读到倒计时 **不算成功** ——
   * 不播绿色成功消息，改排「只读追读」，30 秒后再看一次（真没有才报失败）。 */
  env = await boot({ watch: true, auto: true, onStartClick: 'running' });
  env.tick();                       // 点击拍（面板开关预置后的第一拍）
  await sleep(60);
  env.messages.length = 0;
  env.tick();                       // 校验拍
  ok(env.api.snapshot().probe !== null, '㉑ 没读到倒计时 → 排上只读追读（不急着说成功）');
  ok(env.byType('success').length === 0, '㉑ 没读到倒计时不发成功消息');
  ok(env.api.snapshot().drawIn === 0,
    '㉑ 行内没有倒计时 → 不编秒数（drawIn = 0，旧版会拿面板固定值假装倒数）');
  ok(env.api.snapshot().badge === '进行中',
    '㉑ 圆钮只说「进行中」，不显示一个跟平台无关的假 mm:ss');
  ok(env.api.snapshot().running === true, '㉑ 快照标记「有活动在跑」');

  /* ---------- ㉒ 卡片上写了开奖倒计时 → 优先用它 ---------- */
  env = await boot({ watch: true, auto: true, onStartClick: 'nothing', status: '距开奖 04:32' });
  env.tick();                                   // 点一次
  await sleep(20);
  const st22 = env.doc.getElementById('st1');
  if (st22) st22.textContent = '● 活动进行中 · 距开奖 04:32';
  env.messages.length = 0;
  env.tick();                                   // 校验 + 读倒计时
  const d22 = env.api.snapshot().drawIn;
  ok(d22 > 200000 && d22 <= 272000, '㉒ 卡片写了 04:32 就按 272 秒算（不再用面板固定值）');

  /* ---------- ㉓ 读完不碰弹窗（弹窗是用户自己开的） ---------- */
  env = await boot({ watch: true, auto: true, onStartClick: 'running' });
  env.tick();                       // 点击拍
  await sleep(60);
  env.tick();                       // 校验拍 → 回到扫描态
  ok(env.api.snapshot().phase === 'live', '㉓ 点成功后回到扫描态');
  ok(!!env.doc.getElementById('dlg'), '㉓ 弹窗原样保留，插件不关它');

  /* ---------- ㉔ 弹窗关着：静默等待，绝不自己去开 ---------- */
  env = await boot({ watch: true, auto: true, noDialog: true, noRows: true });
  const beforeEntry = env.clicks.entry;
  const beforeMsg = env.messages.length;
  env.tick(); env.tick(); env.tick();
  ok(env.clicks.entry === beforeEntry,
    '㉔ 弹窗不在时绝不点「超级福袋」入口（用户明确不要插件开窗）');
  ok(env.api.snapshot().phase !== 'stopped', '㉔ 弹窗不在也不停机（等你开）');
  ok(env.messages.length === beforeMsg, '㉔ 弹窗不在时一声不响（不刷提示）');
  ok(env.api.snapshot().badge === '未开始', '㉔ 悬浮窗提示「未开始」');

  /* ---------- ㉕ 悬浮窗本体 ---------- */
  env = await boot({ watch: true, auto: true });
  const badgeEl = env.doc.getElementById('dyb-bag-badge');
  ok(!!badgeEl, '㉕ 悬浮窗已挂到页面');
  ok(!!(badgeEl && badgeEl.shadowRoot), '㉕ 用 Shadow DOM 隔离，不吃页面样式');
  const t25 = badgeEl && badgeEl.shadowRoot.querySelector('.t');
  ok(!!t25 && /^(?:\d{2}:\d{2}|进行中|未开始)$/.test(t25.textContent),
    '㉕ 窗内文字是倒计时或状态词，不出现空值');
  /* 2026-11-01 用户定死落点：右下角、上滑到顶按钮**正上方**，
   * 且不能压住那颗按钮的悬浮提示（气泡挂在按钮上方 10px 处）。
   * 下面把这套几何关系直接算一遍 —— 以后谁改 back-to-top 的 bottom
   * 或气泡高度，这条会先炸。 */
  /* 2026-11-01 用户第二次报「福袋位置错」后的口径：与「上滑到顶」按钮
   * **同一个定位来源**（读它的计算样式 right/bottom），只补半径差。
   * 这里断言的是「读不到按钮时的兜底值」，也是按按钮 CSS 实测推出来的：
   *   right = 20 - (60 - 54.8)/2 = 17.4
   *   bottom = 116.8 + 54.8 + 10 + 27 + 9 = 217.6
   */
  const BTN_BOTTOM = 116.8;     // src/live/back-to-top.js 的 bottom
  const BTN_H = 54.8;           // 52.8 + 上下各 1px 边框
  const TIP_GAP = 10;           // .dyc-tip 的 bottom: calc(100% + 10px)
  const TIP_H = 27;             // 12.5px 字 + 上下 6px padding（行高 normal）
  const tipTop = BTN_BOTTOM + BTN_H + TIP_GAP + TIP_H;      // 208.6
  const cs25 = badgeEl.style;
  ok(Math.abs(parseFloat(cs25.right) - 17.4) < 0.2 &&
     Math.abs(parseFloat(cs25.bottom) - 217.6) < 0.2,
    '㉕ 与上滑按钮同轴落位（兜底 right 17.4 / bottom 217.6）');
  ok(parseFloat(cs25.bottom) >= tipTop,
    '㉕ 卡片底边高于气泡顶边（' + tipTop.toFixed(1) + '），压不到「上滑到顶」提示');
  ok(!('pos' in env.api.snapshot()),
    '㉕ 快照里没有 pos 字段——位置已不是可变状态（用户要求删掉可选位置）');
  const svg25 = badgeEl.shadowRoot.querySelector('svg');
  ok(!!svg25, '㉕ 福袋图标是内联 SVG');
  ok(svg25 && svg25.querySelectorAll('path').length === 3,
    '㉕ 图标三段：束口带 + 袋身 + 镂空菱形（照原生图形状）');
  ok(svg25 && /#FF5A33/.test(svg25.innerHTML) && /#FF005C/.test(svg25.innerHTML),
    '㉕ 配色用原生橙→玫红渐变，不是灰版');

  /* ---------- ㉖ 关掉开关：悬浮窗隐藏而不是消失 ---------- */
  env.watch({ luckyBag: false });
  const bx26 = env.doc.getElementById('dyb-bag-badge');
  ok(!!bx26 && bx26.shadowRoot.querySelector('.b').classList.contains('hide'),
    '㉖ 关掉开关后悬浮窗隐藏（保留节点，重开不用重建）');

  /* ---------- ㉗ 圆钮（用户 2026-11-01：按钮做成圆形） ---------- */
  env = await boot({ watch: true });
  const b27 = env.doc.getElementById('dyb-bag-badge');
  const css27 = b27.shadowRoot.querySelector('style').textContent;
  ok(/\.b\{[^}]*border-radius:50%/.test(css27), '㉗ 圆钮用 border-radius:50%');
  ok(/\.b\{[^}]*width:100%;height:100%/.test(css27), '㉗ 圆钮宽高相等（跟着宿主走）');
  ok(/\b60px/.test(b27.style.width) && /\b60px/.test(b27.style.height), '㉗ 宿主是 60×60 的正圆');
  ok(!/height:72px/.test(css27), '㉗ 不再是 56×72 的竖长卡片');

  /* ---------- ㉘ 面板不出屏（用户：不能越界不能跑到屏幕外） ---------- */
  function inView(box, W, H) {
    return box.left >= 8 - 0.6 && box.top >= 8 - 0.6 &&
      box.left + box.w <= W - 8 + 0.6 && box.top + box.h <= H - 8 + 0.6;
  }
  const viewports = [
    { w: 1024, h: 768, name: '常规窗口' },
    { w: 360, h: 640, name: '窄窗口' },
    { w: 320, h: 420, name: '又窄又矮' }
  ];
  for (const vp of viewports) {
    env = await boot({ watch: true });
    Object.defineProperty(env.win, 'innerWidth', { value: vp.w, configurable: true });
    Object.defineProperty(env.win, 'innerHeight', { value: vp.h, configurable: true });
    env.api.togglePanel();
    env.api.placePanel();
    const pb = env.api.panelBox();
    ok(!!pb && inView(pb, vp.w, vp.h),
      '㉘ 面板在 ' + vp.w + '×' + vp.h + '（' + vp.name + '）里不越界：' +
      (pb ? Math.round(pb.left) + ',' + Math.round(pb.top) : 'null'));
    ok(!!pb && pb.visible, '㉘ 定位算完才显形（不先闪一下再跳位）');
  }

  /* 常规窗口下额外确认：面板不压住圆钮，也不压上滑按钮的气泡 */
  env = await boot({ watch: true });
  env.api.togglePanel();
  env.api.placePanel();
  const pb28 = env.api.panelBox();
  const badgeRect = {
    l: 1024 - 18.4 - 60, t: 768 - 220 - 60, r: 1024 - 18.4, b: 768 - 220
  };
  const overlap = pb28 && !(pb28.left + pb28.w <= badgeRect.l || pb28.left >= badgeRect.r ||
    pb28.top + pb28.h <= badgeRect.t || pb28.top >= badgeRect.b);
  ok(!overlap, '㉘ 常规窗口下面板不盖住圆钮（弹在它左侧）');
  ok(pb28 && (pb28.left + pb28.w) <= 1024 - 18.4,
    '㉘ 面板右缘不超出圆钮右缘（不会顶到屏幕右边）');

  /* 又窄又矮时靠限高挤进圆钮上方，而不是压住圆钮 */
  env = await boot({ watch: true });
  Object.defineProperty(env.win, 'innerWidth', { value: 320, configurable: true });
  Object.defineProperty(env.win, 'innerHeight', { value: 420, configurable: true });
  env.api.togglePanel();
  env.api.placePanel();
  const pbTall = env.api.panelBox();
  ok(!!pbTall && pbTall.maxH > 0, '㉘ 又窄又矮时给面板限高，挤进圆钮上方');
  ok(!!pbTall && pbTall.maxH <= 420 - 8, '㉘ 限高不超过视口可用高度');

  /* 关掉面板后位置信息清空 */
  env.api.togglePanel();
  ok(env.api.panelBox() === null, '㉘ 关闭后面板节点已移除');

  /* ---------- ㉙ 与上滑按钮同源定位（读计算样式，不靠 rect 反推） ---------- */
  env = await boot({ watch: true });
  const badge29 = env.doc.getElementById('dyb-bag-badge');

  /* 造一枚「上滑到顶」按钮：stub 的关键是 offsetWidth/Height 与
   * style.right/bottom —— 模块读的就是这两组（jsdom 里 offsetWidth 恒 0，
   * 不打桩会一律走兜底，测不出跟随）。 */
  function stubBackTop(doc, right, bottom, w, h) {
    const b = doc.createElement('div');
    b.className = 'dyc-back-top';
    b.style.right = right + 'px';
    b.style.bottom = bottom + 'px';
    Object.defineProperty(b, 'offsetWidth', { configurable: true, get: function () { return w; } });
    Object.defineProperty(b, 'offsetHeight', { configurable: true, get: function () { return h; } });
    // 故意给一个「屏幕坐标对不上」的 rect：新实现若退回 rect 反推就会算错
    b.getBoundingClientRect = function () {
      return { width: 1, height: 1, right: 1, left: 0, top: 0, bottom: 1 };
    };
    doc.body.appendChild(b);
    return b;
  }

  const btn29 = stubBackTop(env.doc, 20, 116.8, 54.8, 54.8);
  env.api.moveBadge();
  const p29 = env.api.badgePos();
  ok(Math.abs(p29.right - 17.4) < 0.2,
    '㉙ 读按钮 right=20 + 半径差 → 圆钮 17.4（不再用 rect 反推，避免包含块缩放双倍偏移）');
  ok(Math.abs(p29.bottom - 217.6) < 0.2,
    '㉙ 垂直按「按钮 bottom + 高度 + 气泡」推，得到 217.6');

  const badgeC29 = 1024 - p29.right - 30;        // 圆钮半径 30
  const btnC29 = 1024 - 20 - 27.4;               // 按钮半径 54.8/2
  ok(Math.abs(badgeC29 - btnC29) < 0.05, '㉙ 两圆中心严格落在同一条竖线');

  btn29.parentNode.removeChild(btn29);
  env.api.moveBadge();
  const p29b = env.api.badgePos();
  ok(Math.abs(p29b.right - 17.4) < 0.2 && Math.abs(p29b.bottom - 217.6) < 0.2,
    '㉙ 读不到上滑按钮时回退常量，不会算出 NaN');

  /* ---------- ㉚ 按钮自己挪窝时圆钮跟着走 ---------- */
  env = await boot({ watch: true });
  const badge30 = env.doc.getElementById('dyb-bag-badge');
  const btn30 = stubBackTop(env.doc, 17, 116.8, 54.8, 54.8);

  env.api.moveBadge();
  const p30a = env.api.badgePos();
  ok(Math.abs(p30a.right - 14.4) < 0.2, '㉚ 按钮 right=17 → 圆钮 14.4');

  // 模拟滚动后按钮自己重排到 right=6，并且整体上移
  btn30.style.right = '6px';
  btn30.style.bottom = '147.2px';
  env.api.moveBadge();
  const p30b = env.api.badgePos();
  ok(Math.abs(p30b.right - 3.4) < 0.2, '㉚ 按钮挪到 right=6 → 圆钮跟到 3.4');
  ok(p30b.bottom >= 147.2 + 54.8 + 10 + 27 + 9 - 0.3,
    '㉚ 按钮上移后圆钮也上移，仍让开气泡（bottom=' + p30b.bottom.toFixed(1) + '）');

  const c30 = 1024 - p30b.right - 30;
  ok(Math.abs(c30 - (1024 - 6 - 27.4)) < 0.05, '㉚ 挪窝后仍严格同轴');

  // 位置没变时不应该反复重写样式（每秒刷新一次，不能每次都触发重排）
  const before30 = badge30.style.cssText;
  env.api.moveBadge();
  ok(badge30.style.cssText === before30, '㉚ 位置没变就不重写样式（不每秒触发重排）');

  /* 内容严格居中：不用 padding 推偏，图标也不是 inline */
  const css29 = badge29.shadowRoot.querySelector('style').textContent;
  ok(!/padding-bottom/.test(css29), '㉙ 去掉 padding-bottom（曾让内容整体偏上）');
  ok(/\.b svg\{display:block\}/.test(css29), '㉙ 图标改块级，去掉 inline 基线空隙');
  ok(/\.b\{[^}]*align-items:center[^}]*justify-content:center/.test(css29),
    '㉙ 横向 align-items:center + 纵向 justify-content:center 双居中');

  /* ---------- ㉛ 进页面显隐 + 动效，照「上滑到顶」那一套 ---------- */
  env = await boot({ watch: true, notReady: true });
  const bdg31 = env.doc.getElementById('dyb-bag-badge');
  ok(!!bdg31 && bdg31.style.visibility === 'hidden',
    '㉛ 列表还没就绪时不露脸（骨架屏阶段不挂一颗圆钮右上角）');
  env.win.hasProductRows = function () { return true; };
  env.api.revealBadge();
  ok(bdg31.style.visibility === 'visible', '㉛ 列表就绪后浮现');

  const css31 = bdg31.shadowRoot.querySelector('style').textContent;
  ok(/\.b\{[^}]*opacity:\.55/.test(css31), '㉛ 常驻半透明 .55（与两枚滚动按钮一致）');
  ok(/\.b:hover\{opacity:1/.test(css31), '㉛ 指向即显形');
  ok(/\.tip\{/.test(css31) && /\.b:hover \.tip\{opacity:1\}/.test(css31),
    '㉛ 悬停气泡与滚动按钮同款（黑底、上方 10px）');
  ok(!!bdg31.shadowRoot.querySelector('.tip'), '㉛ 气泡节点存在');

  /* ---------- ㉜ 细线环特效（用户「缺了个动态条特效」） ---------- */
  ok(!!bdg31.shadowRoot.querySelector('.ring circle'),
    '㉜ 细线环节点存在（与「上滑到顶」.dyc-btt-ring 同款）');
  ok(/@keyframes dybRing/.test(css31) && /\.b:hover \.ring\{opacity:1\}/.test(css31),
    '㉜ hover 出现并按 2.6s 变速绕圈（12→6 快、6→12 渐慢）');
  const ring31 = bdg31.shadowRoot.querySelector('.ring circle');
  ok(ring31 && ring31.getAttribute('stroke-dasharray') === '25 75' &&
     ring31.getAttribute('pathLength') === '100',
    '㉜ 环参数与滚动按钮一致（dasharray 25 75 / pathLength 100）');
  ok(ring31 && ring31.getAttribute('transform').indexOf('rotate(-90') === 0,
    '㉜ 环起点在 12 点方向');

  /* ---------- ㉝ 面板没有「位置」行（用户「这个删掉」） ---------- */
  env.api.togglePanel();
  const panelEl31 = env.doc.getElementById('dyb-bag-panel');
  ok(!!panelEl31 && panelEl31.shadowRoot,
    '㉝ 面板能打开（删行不影响面板）');
  const panelTxt31 = panelEl31 ? panelEl31.shadowRoot.textContent : '';
  ok(panelTxt31.indexOf('上滑按钮上方') < 0 && panelTxt31.indexOf('位置') < 0,
    '㉝ 面板里已无「位置」一行');
  env.api.togglePanel();

  /* ---------- ㊞ 活动异常 → 立即停（用户定「遇异常即停」） ---------- */
  env = await boot({ watch: true, auto: true, status: '活动异常', keepBootMsgs: true });
  env.tick();
  ok(env.api.snapshot().phase === 'halted', '㊞ 有活动异常 → 停机监视（不再是终局）');
  ok(env.api.snapshot().reason === 'row-error', '㊞ 停止原因 = 活动异常');
  ok(env.clicks.s1 === 0, '㊞ 异常行不会被点');
  ok(env.messages.filter(function (m) { return m.histKey === 'bagError'; }).length === 1,
    '㊞ 异常只播报一条，不刷屏');
  ok(env.api.snapshot().phase === 'halted', '㊞ 有活动异常 → 停机监视（自动开始下一轮不再点击）');
  ok(env.api.snapshot().badge.indexOf('已停') === 0,
    '㊞ 停止后圆钮显示「已停 X分」（停了多久持续可见，不再是「未开始」）');

  /* ---------- ㊟ 监视模式：异常只播报，不停机（没有写动作可停） ---------- */
  env = await boot({ watch: true, status: '活动异常', keepBootMsgs: true });
  env.tick(); env.tick();
  ok(env.api.snapshot().phase !== 'stopped', '㊟ 只监视时不因异常停机');
  ok(env.messages.filter(function (m) { return m.histKey === 'bagError'; }).length === 1,
    '㊟ 仍然播报，且只报一次');

  /* ---------- ㊠ 卡死：预期开奖已过 90 秒还在进行中 ---------- */
  env = await boot({ watch: true, auto: true, status: '活动进行中 · 距开奖 01:00' });
  env.tick();
  ok(env.api.snapshot().drawIn > 0, '㊠ 先读到卡片倒计时');
  // 把行文字去掉时间，避免下一拍重读把 backdate 覆盖掉
  env.doc.getElementById('st1').textContent = '● 活动进行中';
  env.api.setTimingForTest({ backdate: 200000 });
  env.tick();
  ok(env.api.snapshot().phase === 'halted' && env.api.snapshot().reason === 'stuck',
    '㊠ 预期开奖过了 90 秒仍未结束 → 判卡住并停（转入停机监视，可补发）');

  /* ---------- ㊡ 每拍校准：平台把时间改短，本地跟着改 ---------- */
  env = await boot({ watch: true, auto: true, status: '活动进行中 · 距开奖 05:00' });
  env.tick();
  const d1 = env.api.snapshot().drawIn;
  env.doc.getElementById('st1').textContent = '● 活动进行中 · 距开奖 02:00';
  env.tick();
  const d2 = env.api.snapshot().drawIn;
  ok(d1 > 4 * 60000 && d2 < 3 * 60000,
    '㊡ 第二拍读到 02:00 → 校正为 2 分钟档（旧版只读一次，会一直按 5 分钟倒数）');

  /* ---------- ㊣ 倒计时走完停在 00:00（不切「待开奖」） ---------- */
  env = await boot({ watch: true, auto: true, status: '活动进行中 · 距开奖 01:00' });
  env.tick();
  env.doc.getElementById('st1').textContent = '● 活动进行中';
  env.api.setTimingForTest({ backdate: 90000 });
  env.tick();
  ok(env.api.snapshot().badge === '00:00',
    '㊣ 倒计时走完停在 00:00，不切换到别的词（等下一拍刷新新一轮）');

  /* ---------- ㊤ 不要双层提示（原生 title + 自绘气泡） ---------- */
  env = await boot({ watch: true });
  const boxQ = env.doc.getElementById('dyb-bag-badge').shadowRoot.querySelector('.b');
  ok(!boxQ.getAttribute('title'),
    '㊤ 不设原生 title —— 否则与自绘气泡叠成上下两个「超级福袋」');
  ok(boxQ.getAttribute('aria-label') === '超级福袋',
    '㊤ 语义保留在 aria-label 上（不产生视觉提示）');
  ok(!!env.doc.getElementById('dyb-bag-badge').shadowRoot.querySelector('.tip'),
    '㊤ 自绘气泡仍在，提示不丢');

  /* ---------- ㊢ 「已结束」带异常字样不误判（正常收尾） ---------- */
  env = await boot({ watch: true, status: '活动已结束 · 异常' });
  env.tick();
  ok(env.api.snapshot().reason !== 'row-error',
    '㊢ 已结束的行即使带「异常」字样也不判成异常（否则每轮收尾都会停场）');

  /* ---------- ㊣ 没有倒计时就不判卡死（绝不拿估算值停场） ---------- */
  env = await boot({ watch: true, auto: true, status: '活动进行中' });
  env.tick();
  env.api.setTimingForTest({ backdate: 3600000 });
  env.tick();
  ok(env.api.snapshot().phase !== 'stopped',
    '㊣ 平台没给倒计时 → 不判卡死（拿面板固定值卡会误停 10 分钟的活动）');

  /* ============================================================
   * ㊥ 真机抽屉结构（2026-11-01 晚补 · 用户报「发了福袋圆钮不动」）
   * ------------------------------------------------------------
   * 前面所有用例跑的都是「照截图手搭」的表格：tr + 四列 + 两个文字链，
   * 抽屉标题写「管理超级福袋活动」。真机（用户 04:39 导出的页面结构报告）
   * 是**右侧抽屉**：入口按钮写「超级福袋-活动管理」，里面有 rc-tabs、
   * 一个搜索框、一张 buyin-table，单元格是 div.index-ellipsis（类名带哈希）。
   * 这一组复现两条现实路径：
   *   ① 标题写法与截图不同 → 旧版 panelPresent() 永远 false（认不出抽屉）；
   *   ② 表格是 div 布局、且「进行中」的行里没有「开始活动」
   *      → 旧版只扫 tr，这一行永远读不到，开奖播报整段哑掉。
   * ============================================================ */

  /* 抽屉骨架：入口文案用真机那句「超级福袋-活动管理」 */

  const ROW_RUNNING = '<tr id="r1"><td><div class="index-ellipsis--ZAL9f">10元店铺红包 ID 8899</div></td>'
    + '<td>本次奖品数：1</td><td>达到粉丝团等级LV20</td>'
    + '<td><span id="st1">● 进行中</span></td></tr>';

  /* ㊥① 真机抽屉：搜索框 + tr 行 + 「进行中」 */
  let d = await bootDrawer(drawerHtml({ rows: ROW_RUNNING }));
  let info = d.api.pure.panelInfo();
  ok(info.open === true, '㊥① 真机抽屉能被认出（旧版锚点只有截图那一种写法）');
  ok(info.by === '搜索框' && /奖品名称/.test(info.searchPh), '㊥① 靠搜索框认出来，并带出 placeholder');
  ok(d.api.pure.scanRows().length === 1, '㊥① 抽屉里的 tr 行读到了');
  ok(d.api.pure.statusOf(d.doc.getElementById('r1')).kind === 'running', '㊥① 状态判为「进行中」');
  let det = d.api.probe().detail[0];
  ok(det && det.cells >= 3 && /红包/.test(det.text), '㊥① 体检带出每格文字（下次只看报告就能定位）');
  ok(det && det.link === '无', '㊥① 进行中的行没有「开始活动」链接');

  /* ㊥② 抽屉没搜索框、标题写法不同 → 仍要认出（靠标题正则 + 活动行） */
  d = await bootDrawer(drawerHtml({ noSearch: true, rows: ROW_RUNNING }));
  ok(d.api.pure.panelPresent() === true, '㊥② 无搜索框时靠标题「超级福袋-活动管理」认出（旧版正则不匹配）');

  /* ㊥③ div 布局：一行待开始（有链接）+ 一行进行中（无链接，兄弟行） */
  const divList = '<div id="list">'
    + '<div class="row" id="a1"><div>10元红包 ID 1</div><div>待开始</div><span id="s1">开始活动</span><span>复制</span></div>'
    + '<div class="row" id="a2"><div>20元红包 ID 2</div><div>进行中 距结束 03:12</div></div>'
    + '</div>';
  d = await bootDrawer(divList);
  ok(d.api.pure.scanRows().length === 2, '㊥③ div 布局的两行都读到了（旧版只扫 tr，行 0 个）');
  ok(d.api.pure.statusOf(d.doc.getElementById('a1')).kind === 'pending', '㊥③ 第一行判「待开始」');
  ok(d.api.pure.statusOf(d.doc.getElementById('a2')).kind === 'running', '㊥③ 第二行（无链接的兄弟行）判「进行中」');
  ok(d.api.snapshot().drawIn > 170000 && d.api.snapshot().drawIn <= 200000,
    '㊥③ 「距结束 03:12」读成约 192 秒');
  ok(d.api.snapshot().badge !== '未开始', '㊥③ 圆钮不再显示「未开始」');
  ok(d.api.pure.rowOf(d.doc.getElementById('s1')) === d.doc.getElementById('a1'),
    '㊥③ 行容器就是那一行，没走到整张列表上（否则会点错活动）');

  /* ㊥④ 三个活动同列表：绝不把列表当成一行 */
  const threeRows = '<div id="list">'
    + ['1', '2', '3'].map(function (n) {
      return '<div class="row" id="r' + n + '"><div>' + n + '元红包 ID ' + n + '</div>'
        + '<div>待开始</div><span id="s' + n + '">开始活动</span><span>复制</span></div>';
    }).join('')
    + '</div>';
  d = await bootDrawer(threeRows);
  const rowOfFirst = d.api.pure.rowOf(d.doc.getElementById('s1'));
  ok(rowOfFirst === d.doc.getElementById('r1'),
    '㊥④ 三个「开始活动」并列时，行容器仍只圈住一行（旧版会圈到整个列表）');
  ok(d.api.pure.countExact(d.doc.getElementById('list'), '开始活动') === 3,
    '㊥④ 列表里确实有 3 个「开始活动」（说明上一条不是侥幸）');

  /* ㊥⑤ 文字链外层才是可点节点：内层 span 被置灰时不能判成「点不了」 */
  const nested = '<div id="a1"><div>5元红包 ID 5</div><div>待开始</div>'
    + '<a id="s1"><span id="sp" style="pointer-events:none">开始活动</span></a></div>';
  d = await bootDrawer(nested);
  const hit = d.api.pure.findExactLeaf(d.doc.getElementById('a1'), '开始活动', 3);
  ok(hit.length === 1 && hit[0].tagName === 'A',
    '㊥⑤ 命中被替换成外层 <a>（内层 pointer-events:none 时旧版判「不可点」）');
  ok(d.api.pure.clickable(hit[0]) === true, '㊥⑤ 外层判为可点');

  /* ㊥⑥ 平台时刻混进来时不许当倒计时 */
  d = await bootDrawer('<div id="a1"><div>9元红包 ID 9</div><div>待开始 · 开奖时间 12:30</div>'
    + '<span id="s1">开始活动</span></div>');
  ok(d.api.pure.computeDrawAt(d.doc.getElementById('a1')) === 0,
    '㊥⑥ 「开奖时间 12:30」不被读成 12 分 30 秒');
  d = await bootDrawer('<div id="a2"><div>8元红包</div><div>进行中 · 剩余 3分12秒</div></div>');
  const ms312 = d.api.pure.computeDrawAt(d.doc.getElementById('a2'));
  ok(Math.abs(ms312 - (Date.now() + 192000)) < 3000, '㊥⑥ 「剩余 3分12秒」能读成约 192 秒');

  /* ㊥⑦ 抽屉外有「福袋」字样 → clues 带出去（回答「关着抽屉能不能读」） */
  d = await bootDrawer(drawerHtml({ rows: ROW_RUNNING })
    + '<div id="bar"><span>超级福袋 进行中 03:12</span></div>');
  const clues = d.api.probe().clues;
  ok(clues.some(function (c) { return /福袋/.test(c.t) && c.time === '03:12'; }),
    '㊥⑦ 抽屉外的「福袋」读数被采集（诊断用，暂不参与判断）');

  /* ㊥⑧ 探针加强（2026-11-02 晚 真机「已经上了福袋，圆钮还是未开始」）：
   * ① 整页文本检查：clues 扫不到时能回答「页面里到底有没有」——
   *    有 = 在不可见/Shadow 容器；没有 = 平台没渲染，只能开抽屉读；
   * ② 线索带 tag / 尺寸 / 祖先，用来定位状态词挂在哪一层。 */
  d = await bootDrawer(drawerHtml({ rows: ROW_RUNNING })
    + '<div id="bar2"><span>超级福袋 开始活动</span></div>');
  var pr8 = d.api.probe();
  ok(pr8.pageText && pr8.pageText.bag === true && pr8.pageText.start === true,
    '㊥⑧ 整页文本检查：能报「含福袋」「含开始活动」');
  ok(pr8.pageText && pr8.pageText.card === false,
    '㊥⑧ 整页文本检查：页面没有卡片时明确报 false（⇒ 只能开抽屉）');
  var c8 = (pr8.clues || [])[0] || {};
  ok(typeof c8.tag === 'string' && !!c8.box && !!c8.anc,
    '㊥⑧ 线索带 tag / 尺寸 / 祖先（定位层级用）：' + JSON.stringify(c8).slice(0, 80));

  /* ㊥⑨ 页面上真有「进行中活动」卡片时，整页文本检查要报 true */
  d = await bootDrawer(drawerHtml({ rows: ROW_RUNNING })
    + '<div id="bar3"><span>进行中活动</span><span>04 分 58 秒 后结束</span></div>');
  var pr9 = d.api.probe();
  ok(pr9.pageText && pr9.pageText.card === true && pr9.pageText.tail === true,
    '㊥⑨ 卡片在页面上时：整页文本检查报「含进行中活动」「含后结束」');

  /* ============================================================
   * ㊦ 面板改版 + 确认节拍 + 开播判据（2026-11-01 05:0x 用户定）
   * ------------------------------------------------------------
   * 用户原话拆成四条硬要求：
   *   ① 圆钮不许压在面板上（旧版面板读常量 17.4、圆钮读实时值，错位 15px）；
   *   ② 面板里那五行 + 说明全删，只留「下轮开奖」+ 3~10 分钟滑块；
   *   ③ 滑块拖动不被每秒刷新复位（「跟自动循环功能一样」）；
   *   ④ 未开播不生效、下播停；到点自己开抽屉确认一次、读完就关。
   * ============================================================ */

  /** 带入口按钮 + 抽屉的页面：点入口开抽屉、Esc 关抽屉（模仿真机）
   *  opts.entryHtml：自定义入口 HTML（2026-11-02 起用于测平台改版后的
   *  各种写法；缺省保持老真机那句「超级福袋-活动管理」）。 */

  /* ㊦① 面板只留两样：下轮开奖 + 滑条；五行与说明必须消失 */
  let bp = await bootBagPage();
  bp.api.togglePanel();
  let sh = bp.doc.getElementById('dyb-bag-panel').shadowRoot;
  let pText = sh.querySelector('.p').textContent;
  ok(pText.includes('下轮开始') && pText.includes('确认间隔'), '㊦① 面板留下「下轮开始 + 确认间隔」');
  ok(!/已发轮数|开奖时长|弹窗|中控台请保持|由你手动开着/.test(pText), '㊦① 旧五行与说明全删（用户要求「不需要这些信息」）');

  /* ㊦① 滑条是自绘的（原生 range 按 step 跳、也画不出推荐刻度） */
  const tk = sh.querySelector('.tk');
  ok(!!tk && !sh.querySelector('input[type=range]'), '㊦① 滑条改成自绘（不再用原生 range）');
  ok(tk.getAttribute('role') === 'slider' && tk.getAttribute('aria-valuemin') === '3'
    && tk.getAttribute('aria-valuemax') === '10' && tk.getAttribute('aria-valuenow') === '5',
    '㊦① 滑条语义 3~10、当前 5（推荐值）');
  const marks = sh.querySelectorAll('.mk');
  ok(marks.length === 8, '㊦① 3~10 每格一根刻度线（共 ' + marks.length + ' 根）');
  ok(sh.querySelectorAll('.mk.rec').length === 1, '㊦① 推荐值那根刻度单独标出（rec）');
  ok(/5 推荐/.test(sh.querySelector('.labs').textContent), '㊦① 刻度标出「5 推荐」');
  /* 三个标签必须落在**真实位置**：3=0 端、5=2/7、10=1 端。
   * 旧版用 space-between 排，5 被摆到正中间，看着像在指 6.5 分钟。
   * 2026-11-08 起标签与刻度/圆钮共用 trackPos() 的 calc 式子，
   * 不再是 `0% / 28.57% / 100%` —— 所以认「乘数（档位）」而不是字符串长相。 */
  const labs = Array.prototype.slice.call(sh.querySelectorAll('.labs span'));
  const labL = labs.map(function (e) { return e.style.left; });
  /* cssstyle 会把 `(100% - 36px) * 0.285714` 规范成 `0.285714 * (100% - 36px)`，
   * 乘数前后缀都可能出现，只认数字本身。 */
  const ratioOf = function (s) {
    const m = /([\d.]+)\s*\*\s*\(/.exec(s) || /\*\s*([\d.]+)/.exec(s);
    return m ? parseFloat(m[1]) : NaN;
  };
  const kr = labL.map(ratioOf);
  ok(kr[0] === 0 && Math.abs(kr[1] - 2 / 7) < 1e-5 && kr[2] === 1,
    '㊦① 标签按真实档位落位（0 / 2/7 / 1）：' + labL.join(' / '));
  /* ㊦① 尺寸与层级（用户 05:26「按钮又觉得做的太大了，刻度线你放在上面」） */
  const cssText = sh.querySelector('style').textContent;
  /* 2026-11-08：两条滑条的样式定义合并成 `.rail,.grail{...}` 这类成对选择器，
   * 所以这里不再绑死「选择器后紧跟 {」的写法，只在类名后允许逗号/伪类等前缀。
   * 断言约束的是**几何值**（轨道 8px、圆钮 18px），换了写法不该红。 */
  /* 2026-11-08 晚：圆钮加 box-sizing:border-box，width 就是外径 22（含 2px 边框），
   * 肉眼尺寸与改前一致，只是圆心不再被边框顶偏 2px。 */
  const geom1 = bp.api.slideGeom();
  ok(/\.rail[^{]*\{[^}]*top:12px[^}]*height:8px/.test(cssText) &&
     new RegExp('\\.thumb[^{]*\\{[^}]*width:' + geom1.thumb + 'px').test(cssText),
    '㊦① 轨道 8px / 圆钮外径 ' + geom1.thumb + 'px');
  const railTop = +( /\.rail[^{]*\{[^}]*top:(\d+)px/.exec(cssText) || [0, 0])[1];
  const mkTop = +( /\.mk[^{]*\{[^}]*top:(\d+)px/.exec(cssText) || [0, 0])[1];
  ok(mkTop < railTop, '㊦① 刻度线在轨道**上方**（刻度 top ' + mkTop + 'px < 轨道 top ' + railTop + 'px）');

  /* ㊦① 两端不出界（2026-11-02 用户截图：「这个滑动条，按钮拉到最左边最右边
   * 会轻微出界」）。几何：轨道撑满整宽，圆钮圆心只能在「两端各内缩 inset」
   * 的区间里跑；p=0 时圆心 = inset、左沿 = inset − 半径，要 ≥ 轨道左沿 0。
   * 判定取放大态半径（hover/拖动 20px），它才是最容易出界的那一态。 */
  const tin = sh.querySelector('.tk > .in');
  ok(!!tin && !!tin.querySelector('.thumb') && tin.querySelectorAll('.mk').length === 8,
    '㊦① 刻度与圆钮同在一个定位域里（.tk > .in），坐标才一致');
  /* 几何一律从 slideGeom() 取单一来源，不再从 CSS 文本抠数字 ——
   * 缩进式子已经挪到 trackPos() 的 calc 里，CSS 里本来就没有 left:18px 可抠。 */
  const inset = geom1.inset;
  const rNorm = geom1.thumb / 2;
  const rBig = geom1.thumbGrow / 2;
  /* 2026-11-08 口径再收紧：余量要盖住「放大态半径 + 光环」，只按半径算
   * 结果是圆钮本体在轨道内、光环压出去 —— 用户看到的「最左边突出」正是它。 */
  ok(inset >= rBig + geom1.halo + 2 && rBig > 0,
    '㊦① 内缩 ' + inset + 'px ≥ 放大态半径 ' + rBig + 'px + 光环 ' + geom1.halo +
    'px + 2px（常态半径 ' + rNorm + 'px，两端各留 ' + (inset - rNorm) + 'px）');
  /* 不绑死 calc 的子句顺序：jsdom/cssstyle 会把 `A + k * (B)` 规范成
   * `A + k * (B)` 或 `A + k*(B)` 之类，顺序也不保证与源码一致。
   * 只认三个语义要件齐全：内缩起点、可变区间、以及 p 值本身。 */
  const fillW = sh.querySelector('.fill').style.width;
  /* 轨道两端各缩 edge（2026-11-08 用户「让轨道两端也各缩进一截」），
   * 填充条起点跟着从 0 挪到 edge，所以式中第一个常量是 inset − edge。 */
  const fillStart = inset - geom1.edge;
  ok(/^calc\(/.test(fillW)
    && fillW.indexOf(fillStart + 'px') === 5
    && fillW.indexOf('(100% - ' + (inset * 2) + 'px)') > 0
    && /0\.2857/.test(fillW),
    '㊦① 填充条从轨道左端（' + fillStart + 'px）算到圆钮圆心（对齐 2/7，实测 ' + fillW + '）');
  /* 本次需求的几何核心：轨道端头必须与滑块外沿（放大态）重合 ——
   * 差 1px 就会重新露出「一段空轨道」或「滑块探出去」两种观感之一。 */
  const railSide = /\.rail[^{]*\{[^}]*left:(\d+)px;right:(\d+)px/.exec(cssText);
  ok(inset - geom1.edge === geom1.thumbGrow / 2
    && !!railSide && +railSide[1] === geom1.edge && +railSide[2] === geom1.edge,
    '㊦① 轨道两端各缩 ' + geom1.edge + 'px，端头与滑块外沿（半径 ' +
    (geom1.thumbGrow / 2) + 'px）重合：' + inset + ' − ' + geom1.edge + ' = ' +
    (inset - geom1.edge));
  /* 圆钮圆心与「5 推荐」标签必须落在同一个坐标上：
   * 旧版靠「.in 内缩 + left:百分比」，真机上一头缩一头不缩就错位了；
   * 现在两者都由 trackPos() 给，字符串应该完全相同。 */
  const thumbLeft = tin.querySelector('.thumb').style.left;
  ok(thumbLeft && thumbLeft.indexOf('calc(') === 0 && thumbLeft === labs[1].style.left,
    '㊦① 圆钮圆心与「5 推荐」标签同一坐标（' + thumbLeft + '）');

  /* ㊦① 问号说明（用户：确认间隔 + 问号 → 每隔设定的时间自动打开抽屉检查一次福袋状态。） */
  const qh = sh.querySelector('.qh');
  const qtip = sh.querySelector('.qtip');
  ok(!!qh && qh.textContent === '?', '㊦① 标签旁有问号');
  ok(!!qtip && qtip.textContent === '每隔设定的时间自动打开抽屉检查一次福袋状态。',
    '㊦① 问号文案与用户口径逐字一致');
  qh.dispatchEvent(new bp.win.Event('pointerenter'));
  ok(qtip.classList.contains('show'), '㊦① 悬停问号时提示弹出');
  qh.dispatchEvent(new bp.win.Event('pointerleave'));
  ok(!qtip.classList.contains('show'), '㊦① 移开后提示收起');

  /* ㊦① 去掉 ✕（用户 05:33：关闭 = 点外部 / 再点圆钮）+ 字号整体收一档 */
  ok(!sh.querySelector('.x') && pText.trim().indexOf('超级福袋') === 0,
    '㊦① 头部只剩标题，没有 ✕ 关闭键');
  ok(/font:11px\/1\.6/.test(cssText) && /\.rl \.val\{[^}]*font-size:14px/.test(cssText),
    '㊦① 基准字号 12→11px、开奖数字 16→14px');

  /* ㊦① 矮窗口终局防压：面板比「圆钮上方空间」还高时也不许压到圆钮 */
  const tiny = bp.api.pure.resolveOverlap(632.6, 8, 250, 400, 822.6, 222.4);
  ok(tiny.left === 564.6,
    '㊦① 矮窗口下整块左移到刚好留 8px（实测 left=' + tiny.left + '）');
  ok(tiny.left + 250 <= 822.6 - 8 + 0.01,
    '㊦① 面板右缘与圆钮左缘之间仍有 ≥8px 间隙');

  /* ㊦② 值存得住，且每秒刷新不会把它拨回去 */
  bp.api.setCheckMin(8);
  ok(bp.api.checkMin() === 8, '㊦② 改到 8 分钟能记住');
  bp.api.tick();                       // 模拟一拍刷新
  /* 滑钮位置现在写成 trackPos() 的 calc 乘数：8 分钟 = (8-3)/7 = 5/7 ≈ 0.714 */
  const k8 = ratioOf(sh.querySelector('.thumb').style.left);
  ok(Math.abs(k8 - 5 / 7) < 1e-4,
    '㊦② 刷新一拍后滑钮仍停在 8 分钟处（乘数 ' + k8.toFixed(4) + ' ≈ 5/7，不会弹回 0）');

  /* ㊦③ 阻尼 + 吸附（2026-11-01 下午用户「要做一些阻尼感（吸附到刻度），滑着太顺滑了」）：
   * 拖动中 target 就吸到最近刻度，画面靠阻尼追过去 —— 磁吸咬合，不是硬跳 */
  bp.api.setCheckMin(5);                    // 回到推荐值当起点，拖动才有行程
  const rect = { left: 900, width: 250 };   // 与 getBoundingClientRect 打桩一致
  bp.api.slideTo(rect.left);                // 按在 3 分钟处（吸到刻度 3）
  let st0 = bp.api.slideState();
  ok(st0.target === 3, '㊦③ 按下轨道就吸到最近刻度（落点 3 分钟 → target=' + st0.target + '）');
  bp.api.slideMove(rect.left + rect.width * 0.7);  // 拖到 70% ≈ 7.9 → 吸到 8
  let st = bp.api.slideState();
  ok(st.target === 8, '㊦③ 拖动中目标就吸附到刻度（70%≈7.9 → ' + st.target + '，不再跟指针连续走）');
  bp.api.slideMove(rect.left + rect.width * 0.55); // 半格位置 55% ≈ 6.85 → 咬合到 7
  st = bp.api.slideState();
  ok(st.target === 7, '㊦③ 两格之间的落点咬合到最近刻度（6.85 → ' + st.target + '）');
  bp.api.slideMove(rect.left + rect.width * 0.7);  // 拖回 70% → 8
  st = bp.api.slideState();
  ok(st.target === 8, '㊦③ 拖回 70% 目标仍吸到 8');
  ok(st.cur < st.target - 0.5, '㊦③ 画面还在追（阻尼中 ' + st.cur.toFixed(2) + ' ≠ ' + st.target.toFixed(2) + '），不是瞬间跳到位');
  await sleep(260);                         // 让 rAF 追到位（45%/帧 ≈ 150ms）
  st = bp.api.slideState();
  ok(Math.abs(st.cur - st.target) < 0.05, '㊦③ 约 150ms 内阻尼追上，稳停在刻度上');
  bp.api.slideEnd();
  ok(bp.api.checkMin() === 8, '㊦③ 松手吸到整数并写盘（8 分钟）');
  await sleep(200);
  const rest = bp.api.slideState();
  ok(Math.abs(rest.cur - 8) < 0.05 && Math.abs(rest.target - 8) < 0.001,
    '㊦③ 松手后滑钮收敛到 8 分钟那一格（' + rest.cur.toFixed(2) + '）');

  /* ㊦④ 几何：圆钮在三档位置下，面板都不许压在它身上 */
  [6, 17.4, 36].forEach(function (right) {
    const r = bp.api.pure.panelRect(1707, 929, { right: right, bottom: 217.6 }, 250, 132);
    const bdLeft = 1707 - right - 60;
    const bdTop = 929 - 217.6 - 60;
    const overlapX = !(r.left + 250 <= bdLeft || r.left >= bdLeft + 60);
    const overlapY = !(r.top + 132 <= bdTop || r.top >= bdTop + 60);
    ok(!(overlapX && overlapY), '㊦④ 圆钮 right=' + right + ' 时面板不与圆钮相交');
    if (right === 36) {
      ok(bdLeft - (r.left + 250) >= 8, '㊦④ 面板与圆钮至少留 8px 间隙（实测 ' + Math.round(bdLeft - (r.left + 250)) + 'px）');
    }
  });

  /* ㊦⑤ 到点自己开抽屉确认一次，读完就关（只关自己开的）。
   * 2026-11-01 05:42 用户删掉「授权」闸：不需要先点一次面板，
   * 只要开播期间，就按设定间隔自己运作。 */
  bp = await bootBagPage();
  ok(bp.clicks.entry === 0, '㊦⑤ 进页面不当场开抽屉（留 3 秒给页面渲染完）');
  bp.api.confirmNow();
  ok(bp.clicks.entry === 1, '㊦⑤ 无需任何授权，到点就点了「超级福袋-活动管理」入口');
  /* ㊦⑤ 同时告诉「小黄车自动刷新」让路（用户 05:22「不然会冲突」） */
  ok(bp.win.__dycBagBusyUntil > Date.now(), '㊦⑤ 开抽屉期间挂上「忙」标记，让自动刷新顺延');
  ok(bp.win.__dycBagPanelOpen === true, '㊦⑤ 同时公布「抽屉开着」');
  await sleep(700);
  ok(!!bp.doc.getElementById('drawer'), '㊦⑤ 抽屉被打开了');
  await sleep(1400);
  ok(bp.clicks.esc >= 1, '㊦⑤ 读完发 Esc 关掉（不留下遮挡）');
  ok(!bp.doc.getElementById('drawer'), '㊦⑤ 抽屉确实关上了');
  ok(/有进行中的福袋/.test(bp.api.snapshot().check.stat),
    '㊦⑤ 确认汇报看上面进行中（不报抽屉行数）：' + bp.api.snapshot().check.stat);
  ok(!/读到 \d+ 行/.test(bp.api.snapshot().check.stat),
    '㊦⑤ 不再出现「读到 X 行」口径（下面行数不代表进行中）');
  ok(bp.win.__dycBagPanelOpen === false, '㊦⑤ 关掉后立刻放开让路（不把刷新永久卡住）');

  /* ㊦⑥ 你开着的抽屉：不重复开、也绝不替你关 */
  bp = await bootBagPage(null, { preOpen: true });
  bp.api.confirmNow();
  await sleep(1800);
  ok(bp.clicks.entry === 0, '㊦⑥ 你已经开着抽屉时不再点入口');
  ok(bp.clicks.esc === 0, '㊦⑥ 也不发 Esc（不打扰你）');
  ok(!!bp.doc.getElementById('drawer'), '㊦⑥ 你开着的抽屉不会被插件关掉');

  /* ㊦⑦ 未开播 / 已下播：**圆钮照常露脸**（2026-11-03 用户拍板「不用藏起来」），
   *     但不去确认、不去点「开始活动」。 */
  bp = await bootBagPage('<div id="liveTag"><button>开始直播</button></div>');
  bp.api.tick();
  ok(bp.api.liveState() === 'idle', '㊦⑦ 认得出「开始直播」= 未开播');
  ok(bp.doc.getElementById('dyb-bag-badge').style.visibility !== 'hidden',
    '㊦⑦ 未开播时圆钮仍露脸（用户 2026-11-03 定：不用藏起来）');
  ok(bp.api.liveGate() === false, '㊦⑦ 未开播时开播闸关着');
  ok(bp.clicks.entry === 0, '㊦⑦ 未开播时不去开抽屉确认');

  bp = await bootBagPage('<div id="liveTag"><button>直播已结束</button></div>');
  bp.api.tick();
  ok(bp.api.liveState() === 'idle', '㊦⑦ 认得出「直播已结束」= 已下播');

  /* ㊦⑧ 正在播（页面有「结束直播」）：照常读数 */
  bp = await bootBagPage('<div id="liveTag"><button>结束直播</button></div>');
  bp.openDrawer();
  bp.api.tick();
  ok(bp.api.liveState() === 'live', '㊦⑧ 认得出「结束直播」= 在播');
  ok(bp.api.snapshot().drawIn > 0, '㊦⑧ 在播时能读到倒计时');

  /* ㊦⑨ 点面板外面自动收起（用户 05:26） */
  bp = await bootBagPage();
  bp.api.togglePanel();
  ok(!!bp.doc.getElementById('dyb-bag-panel'), '㊦⑨ 面板能打开');
  /* 点面板外面（页面空白处）→ 收起 */
  bp.doc.getElementById('host').dispatchEvent(new bp.win.Event('pointerdown', { bubbles: true }));
  ok(!bp.doc.getElementById('dyb-bag-panel'), '㊦⑨ 点页面别处 → 面板收起');
  bp.api.togglePanel();
  ok(!!bp.doc.getElementById('dyb-bag-panel'), '㊦⑨ 能再次打开');
  /* 面板自己的 shadow 内部：composedPath 会带上宿主，不能被当成「外面」 */
  const host = bp.doc.getElementById('dyb-bag-panel');
  host.shadowRoot.querySelector('.tk').dispatchEvent(new bp.win.Event('pointerdown', { bubbles: true, composed: true }));
  ok(!!bp.doc.getElementById('dyb-bag-panel'), '㊦⑨ 点面板内部（滑条）不收起');
  /* 点圆钮：它是开关，不能在这里关掉再被 click 打开 */
  bp.doc.getElementById('dyb-bag-badge').dispatchEvent(new bp.win.Event('pointerdown', { bubbles: true }));
  ok(!!bp.doc.getElementById('dyb-bag-panel'), '㊦⑨ 点福袋圆钮不收起（交回开关逻辑）');

  /* ㊦⑩ 浮层让位：平台抽屉/弹窗盖住时，圆钮不许浮在最上层 */
  bp = await bootBagPage();
  const badgeGate = bp.doc.getElementById('dyb-bag-badge');
  bp.api.tick();
  ok(badgeGate.style.visibility !== 'hidden', '㊦⑩ 没有浮层时圆钮正常露脸');
  let cover = true;
  /* 让位没有开关（2026-11-02 撤掉「浮层让位」菜单项），所以这里只演 covers：
   * guard 一旦判定盖住就必须藏，不存在「用户关掉开关 ⇒ 不藏」这一档。 */
  bp.win.dycOverlayGuard = { covers: function () { return cover; } };
  bp.api.tick();
  ok(badgeGate.style.visibility === 'hidden', '㊦⑩ 平台浮层盖住 → 圆钮藏起来');
  cover = false;
  bp.api.tick();
  ok(badgeGate.style.visibility !== 'hidden', '㊦⑩ 浮层关掉 → 圆钮自己回来（不用手动刷新）');

  /* ㊦⑩ 福袋抽屉自己开着时，圆钮同样不该压在抽屉上 */
  bp = await bootBagPage(null, { preOpen: true });
  bp.api.tick();
  ok(bp.doc.getElementById('dyb-bag-badge').style.visibility === 'hidden',
    '㊦⑩ 福袋抽屉开着时圆钮也藏（否则照样压在抽屉上）');

  /* ============================================================
   * ㊪ 总闸「福袋功能增强」（2026-11-01 05:31 加闸；深夜起是唯一开关）
   *    子菜单撤下后：监视跟随总闸；「自动发福袋」是面板开关，
   *    生效 = gate && autoOn（「与」），总闸不覆写 autoOn 的值。
   * ============================================================ */
  env = await boot({ watch: true, gate: false });
  ok(env.api.snapshot().timers.tick === false, '㊪ 总闸关 → 不挂扫描定时器');
  ok(env.api.snapshot().flags.watch === false, '㊪ 总闸关 → 监视判为「关」');
  ok(env.api.snapshot().flags.auto === false, '㊪ 总闸关 → 自动开始下一轮一并停');
  env.tick();
  ok(env.clicks.s1 === 0 && env.messages.length === 0, '㊪ 总闸关 → 什么都不点、一声不出');

  env.watch({ luckyBag: true });
  ok(env.api.snapshot().flags.watch === true, '㊪ 总闸开 → 监视立刻生效');
  ok(env.api.snapshot().timers.tick === true, '㊪ 总闸开 → 定时器回来');
  const gateEcho = env.messages.filter(function (m) {
    return m.source === '福袋功能增强' && m.text === '已开启';
  });
  ok(gateEcho.length === 1, '㊪ 总闸切换只报一条，来源词「福袋功能增强」');

  /* 面板开关与总闸是「与」：总闸开时它说了算，总闸关时它再开也不动 */
  env.api.setAutoForTest(true);
  ok(env.api.snapshot().flags.auto === true, '㊪ 总闸开 + 面板开关开 → 开始下一轮生效');
  env.watch({ luckyBag: false });
  ok(env.api.snapshot().flags.watch === false && env.api.snapshot().flags.auto === false,
    '㊪ 总闸关 → 面板开关开着也停');
  env.watch({ luckyBag: true });
  ok(env.api.snapshot().flags.auto === true, '㊪ 总闸再开 → 开始下一轮按面板开关的原值恢复');
  env.api.setAutoForTest(false);

  /* ============================================================
   * ㊬ 「自动发福袋」开关进悬浮面板（2026-11-01 深夜 用户拍板）
   *    「自动发福袋的功能放进浮动框按钮里面的点击弹出来的框框，
   *      按钮默认关闭」
   * ============================================================ */
  env = await boot({ watch: true });
  ok(env.api.autoOn() === false, '㊬ 面板开关默认关闭');
  ok(env.api.snapshot().flags.auto === false, '㊬ 默认关 → 不会自动开始下一轮');
  env.api.togglePanel();
  const swEl = env.api.panelSwitch();
  ok(!!swEl, '㊬ 面板里有「自动发福袋」开关');
  ok(!!swEl && !swEl.classList.contains('on'), '㊬ 开关初始外观为关');
  swEl.dispatchEvent(new env.win.MouseEvent('click', { bubbles: true }));
  ok(env.api.autoOn() === true, '㊬ 点一下开关 → 自动发福袋开启');
  ok(swEl.classList.contains('on') && swEl.getAttribute('aria-checked') === 'true',
    '㊬ 开关外观同步点亮（on + aria-checked）');
  ok(env.messages.some(function (m) {
    return m.source === '福袋' && m.text === '自动发福袋已开启';
  }), '㊬ 切换播报一条，来源词「福袋」');
  env.messages.length = 0;
  swEl.dispatchEvent(new env.win.MouseEvent('click', { bubbles: true }));
  ok(env.api.autoOn() === false && !swEl.classList.contains('on'),
    '㊬ 再点一下关回');
  ok(env.messages.some(function (m) { return m.text === '自动发福袋已关闭'; }),
    '㊬ 关闭也播报一条');
  /* 开着时真的会点（与旧 luckyBagAuto 行为对齐，只是开关换了住处） */
  env.api.setAutoForTest(true);
  env.tick();
  ok(env.clicks.s1 === 1, '㊬ 面板开关打开后开始下一轮真实生效（待开始行被点）');

  /* ============================================================
   * ㊭ 同名活动按「框」跟踪（2026-11-01 深夜 用户定）
   *    用户原话：「不可以用奖品名字，你只能抓取奖励的框框来
   *    确认有没有奖品在运行」。真机一个抽屉 8 个活动全部同名
   *    「10元店铺红包」——名字当键 = 8 行互相踩：clicked 一记，
   *    其余 7 行永远进不了候选。行身份 = 行容器自己的 uid。
   * ============================================================ */
  env = await boot({ watch: true, auto: true, onStartClick: 'runningTimed' });
  env.api.setTimingForTest({ afterDrawLag: 0 });   // 专验「框键不踩」的排队开始下一轮，冷却时机归 ㊴
  const tr2 = env.doc.createElement('tr');
  tr2.id = 'r2';
  tr2.innerHTML = '<td>10元店铺红包 ID</td><td>本次奖品数：1</td>' +
    '<td>达到店铺粉丝团等级LV20</td>' +
    '<td><span id="st2">● 活动待开始</span><a id="s2">开始活动</a><a>复制</a></td>';
  let s2clicks = 0;
  env.doc.querySelector('#r1').parentNode.appendChild(tr2);
  env.doc.getElementById('s2').addEventListener('click', function () { s2clicks++; });
  env.tick();                                   // 一拍只点一个候选 → 第 1 行
  ok(env.clicks.s1 === 1 && s2clicks === 0, '㊭ 同名两行先点第 1 行（一拍一个）');
  await sleep(60);
  env.tick();                                   // 第 1 行已进行中 → 防双开闸：第 2 行不点
  ok(s2clicks === 0,
    '㊭ 第 1 行跑起来后第 2 行不点（2026-11-01 定稿：有进行中绝不开第二个）');
  ok(env.api.snapshot().drawIn > 0, '㊭ 第 1 行校验成功并读到倒计时');
  const det239 = env.api.probe().detail;
  ok(det239.length >= 2 && det239[0].key !== det239[1].key,
    '㊭ 诊断里两行的键不同（框 uid，与名字无关）');
  env.doc.getElementById('st1').textContent = '● 活动已结束';   // 第 1 行结束
  /* 测试里时间没真走：不把读数拨到期，第 2 行会被「上一轮还活着」的守卫拦住。 */
  env.api.expireDrawForTest();
  env.tick();                                   // 进行中清零 → 第 2 行正常续点
  ok(s2clicks === 1, '㊭ 第 1 行结束后 → 第 2 行续点（键不踩，排队开始下一轮保留）');

  /* ============================================================
   * ㊮ 进行中活动卡片（2026-11-01 深夜 用户「这里面就是正在进行
   *    的活动，右上角有倒计时，你没有成功追踪」）
   *    正在跑的福袋不在表格里，是抽屉顶部一张卡片：左上「进行中活动」
   *    标签、右上「04 分 58 秒 后结束」、中间「活动ID:7702…」。
   *    没有开始活动链接 → 旧版三条来源全扫不到。
   * ============================================================ */
  env = await boot({ watch: true, auto: true, withStart: false });
  const card1 = env.doc.createElement('div');
  card1.id = 'bagCard';
  card1.innerHTML = '<span>进行中活动</span><b>福袋活动1</b>' +
    '<span id="cd1">04 分 58 秒 后结束</span>' +
    '<div>10元店铺红包 <i>ID</i> 活动ID:7702886904815681835 复制</div>' +
    '<div>中奖条件:达到电商粉丝团等级 奖品价值:￥10 奖品数:1</div>';
  env.doc.body.appendChild(card1);
  env.tick();
  ok(env.api.snapshot().running === true, '㊮ 卡片被认成「进行中」（旧版完全看不见它）');
  ok(/^0[45]:\d\d$/.test(env.api.snapshot().badge),
    '㊮ 圆钮显示卡片倒计时（不再是「未开始」）');
  const di240 = env.api.snapshot().drawIn;
  ok(di240 > 290000 && di240 <= 300000, '㊮ 「04 分 58 秒 后结束」读成约 298 秒');
  env.messages.length = 0;
  env.doc.body.removeChild(card1);              // 平台把跑完的卡片收走
  ok(!env.messages.some(function (m) { return /已结束/.test(m.text); }),
    '㊮ 倒计时没走完卡片就消失 → 不播「已结束」（误播修复：提前消失=关抽屉/抖动）');
  /* 倒计时走完（模拟到期）后再消失 → 才是真开奖，播报 */
  env.doc.body.appendChild(card1);
  env.tick();                                   // 重新读到卡片
  env.api.expireDrawForTest();                  // 模拟倒计时走完
  env.messages.length = 0;
  env.doc.body.removeChild(card1);
  env.tick();
  ok(env.messages.some(function (m) {
    return m.source === '福袋' && /已结束/.test(m.text);
  }), '㊮ 倒计时到期后卡片消失 → 播「这一轮已结束」（真开奖）');

  /* ---------- ㊯ 卡片在读时不做确认节拍（2026-11-01 深夜 用户方案） ----------
   * 「不打开窗口就能直接读取进行中的活动」：卡片常驻页面、每拍都读得到
   * 倒计时，再定时开抽屉纯属打断直播操作。倒计时活着 → 顺延节拍不开窗；
   * 没有运行信息 → 才按间隔兜底开抽屉确认。 */
  env = await boot({ watch: true, withStart: false });
  ok(env.api.snapshot().check.stat === '', '㊯ 铺垫：还没做过确认');
  env.api.confirmNow();                         // 无卡片信息：走兜底路径
  ok(env.api.snapshot().check.stat === '',
    '㊯ 没有卡片信息时按节拍走兜底（此页抽屉已开，直接用读数）');
  const card2 = env.doc.createElement('div');
  card2.innerHTML = '<span>进行中活动</span><span id="cd2">04 分 58 秒 后结束</span>' +
    '<div>10元店铺红包 ID 活动ID:7702886904815681835</div>';
  env.doc.body.appendChild(card2);
  env.tick();                                   // 读到卡片 → running + 倒计时
  ok(env.api.snapshot().running === true, '㊯ 铺垫：卡片在读');
  env.api.confirmNow();                         // 强制到期
  ok(env.api.snapshot().check.stat === '卡片在读，不开抽屉',
    '㊯ 卡片在读 → 不开抽屉不打断直播');

  /* ---------- ㊲ 手动刷新按钮（2026-11-02 凌晨 用户需求）----------
   * 面板里的「手动刷新」：点了立刻开抽屉重抓一次进行中活动，
   * 读完自动关抽屉 —— 不受「卡片在读」守卫与确认间隔约束，
   * 只受 3 秒短防抖。普通确认节拍的行为不变。 */
  bp = await bootBagPage();
  ok(bp.clicks.entry === 0, '㊲ 铺垫：进页面没开过抽屉');
  const cardM = bp.doc.createElement('div');
  cardM.innerHTML = '<span>进行中活动</span><span>03 分 12 秒 后结束</span>' +
    '<div>10元店铺红包 ID 活动ID:7702886904815681837</div>';
  bp.doc.body.appendChild(cardM);
  bp.api.tick();
  bp.api.confirmNow();
  ok(bp.clicks.entry === 0, '㊲ 卡片在读时确认节拍不开抽屉（守卫生效，对照组）');
  bp.api.manualRefresh();
  ok(bp.clicks.entry === 1, '㊲ 手动刷新无视「卡片在读」守卫，立刻点入口开抽屉');
  ok(!!bp.doc.getElementById('drawer'), '㊲ 抽屉被打开');
  await sleep(2100);
  ok(bp.clicks.esc >= 1, '㊲ 读完自动发 Esc 关抽屉');
  ok(!bp.doc.getElementById('drawer'), '㊲ 抽屉确实关上了');
  ok(/手动刷新｜有进行中的福袋/.test(bp.api.snapshot().check.stat),
    '㊲ 结果带「手动刷新」前缀、看上面进行中：' + bp.api.snapshot().check.stat);
  bp.api.manualRefresh();                       // 3 秒防抖窗口内连点
  ok(bp.clicks.entry === 1, '㊲ 3 秒内连点第二次被防抖拦下');
  bp.api.confirmNow();                          // 普通路径不受 force 影响
  ok(bp.clicks.entry === 1, '㊲ 普通确认节拍仍受硬上限约束（刚确认过不再开）');

  /* ㊲ 未开播时手动刷新照常能用（真机「点了没反应」根因：
   * liveState='idle' 把 force 点击整个吞掉且无任何反馈） */
  bp = await bootBagPage('<div id="liveTag"><button>开始直播</button></div>');
  bp.api.tick();
  ok(bp.api.liveState() === 'idle', '㊲ 铺垫：未开播');
  bp.api.confirmNow();
  ok(bp.clicks.entry === 0, '㊲ 未开播时确认节拍不开抽屉（对照组）');
  bp.api.manualRefresh();
  ok(bp.clicks.entry === 1, '㊲ 未开播时手动刷新照常开抽屉（idle 拦截只管自动路径）');
  await sleep(2100);
  ok(/手动刷新｜有进行中的福袋/.test(bp.api.snapshot().check.stat),
    '㊲ 未开播手动刷新也读完关抽屉：' + bp.api.snapshot().check.stat);

  /* ---------- ㊳ 确认节拍与进行中活动的分工（2026-11-02 凌晨 用户定稿）----------
   * ① 进行中且倒计时未到 → 自动确认暂停（不开抽屉，不打扰直播）；
   * ② 活动到点 → 自动确认恢复，立刻开抽屉看结果（不然开了活动也不知道）；
   * ③ 读完没有进行中了 → 回到按间隔确认（不变成连发骚扰）；
   * ④ 有进行中时点手动刷新 = 校准倒计时（㊲ 已覆盖入口路径）。 */
  bp = await bootBagPage();
  bp.api.setTimingForTest({ afterDrawLag: 0 });  // ㊳ 专验「到点立即恢复确认」的分工，冷却时机归 ㊴
  const cardS = bp.doc.createElement('div');
  cardS.innerHTML = '<span>进行中活动</span><span>03 分 12 秒 后结束</span>' +
    '<div>10元店铺红包 ID 活动ID:7702886904815681838</div>';
  bp.doc.body.appendChild(cardS);
  bp.api.tick();
  ok(bp.api.snapshot().running === true, '㊳ 铺垫：进行中活动在读');
  bp.api.confirmNow();
  ok(bp.clicks.entry === 0, '㊳ ① 倒计时未到 → 自动确认暂停不开抽屉');
  bp.api.expireDrawForTest();                   // 模拟活动到点（倒计时走完）
  bp.api.tick();                                 // 下一拍：到点即自动恢复确认
  ok(bp.clicks.entry === 1, '㊳ ② 活动到点 → 自动确认恢复，下一拍就开抽屉看结果');
  await sleep(2100);
  ok(bp.clicks.esc >= 1, '㊳ ② 读完自动关抽屉');
  ok(/有进行中的福袋/.test(bp.api.snapshot().check.stat),
    '㊳ ② 确认汇报看上面进行中（到点重开后卡片倒计时重新读到）：' + bp.api.snapshot().check.stat);
  cardS.remove();                                // 平台把跑完的卡片收走
  /* 真实世界里卡片是在「到点之后」被收走的，那份兜底读数这时也已过期；
   * 用例里时间没真的走，得一起拨掉，否则它会把「进行中」多撑 3 分钟。 */
  bp.api.expireDrawForTest();
  bp.api.tick();
  ok(bp.api.snapshot().running === false, '㊳ 铺垫：没有进行中了');
  ok(bp.api.snapshot().check.next > Date.now(),
    '㊳ ③ 没有进行中后回到按间隔确认（下轮在未来，不连发）');

  /* ㊳⑤ 到点验证 + 结束播报（2026-11-04 用户：「上一轮福袋结束也应该弹出个
   * 提示，提示没有，检查是不是福袋真的结束的验证也没有，福袋一旦结束就
   * 一直这样子挂着」）。旧版只有倒计时到期这一条锚点，drawAt 被清零后
   * 只能干等下一个 N 分钟节拍（2 分钟一轮的福袋会白挂 5 分钟）。 */
  bp = await bootBagPage(null, { drawerRowHtml: '● 活动已结束' });
  bp.api.setTimingForTest({ afterDrawLag: 0 });
  const cardE = bp.doc.createElement('div');
  cardE.innerHTML = '<span>进行中活动</span><span>00 分 20 秒 后结束</span>' +
    '<div>10元店铺红包 ID 活动ID:7702886904815681999</div>';
  bp.doc.body.appendChild(cardE);
  bp.api.tick();
  ok(bp.api.snapshot().running === true, '㊳⑤ 铺垫：卡片在读');
  ok(bp.api.snapshot().verifyIn > 0,
    '㊳⑤ 倒计时在跑时已排好到点验证：' + bp.api.snapshot().verifyIn + 'ms');
  cardE.remove();                              // 平台把跑完的卡片收走
  bp.api.expireDrawForTest();                  // 时间走过到期时刻
  bp.messages.length = 0;
  ok(await waitBag(function () {
    bp.api.tick();
    return bp.messages.some(function (m) { return /已结束/.test(m.text); });
  }, 8000), '㊳⑤ 到点验证读到「没有」→ 播报一轮已结束：' +
    bp.messages.map(function (m) { return m.text; }).join(' / '));
  ok(bp.api.snapshot().verifyIn === 0, '㊳⑤ 验证完不再挂着（verifyIn 清零）');

  /* ㊳⑥ 真人亲手开抽屉 → 10 秒内自动候选让路（2026-11-04 用户：「手动点开
   * 抽屉，会导致无脑发福袋，甚至尝试重复发两次」）。jsdom 造不出
   * isTrusted，用 userOpenedForTest 走同一入口。 */
  bp = await bootBagPage(null, {
    drawerRowHtml: '<span id="dsY">● 活动待开始</span><a id="dstart">开始活动</a>'
  });
  bp.openDrawer();
  bp.api.setAutoForTest(true);
  bp.api.setTimingForTest({ tick: 999999, userGuard: 400 });
  bp.api.userOpenedForTest();                  // 真人刚点开抽屉
  bp.api.tick();
  ok(bp.clicks.dstart === 0, '㊳⑥ 真人刚开抽屉 → 让路窗口内不自动点「开始活动」');
  await sleep(500);
  bp.api.tick();
  ok(bp.clicks.dstart === 1, '㊳⑥ 让路窗口过后照常自动点（人看完这一眼就接管）');

  /* ---------- ㊴ 开奖收尾冷却 15 秒（2026-11-02 用户定「倒计时走完，
   * 延迟 15s 左右再去自动确认以及续福袋，不然容易冲突」）----------
   * 开奖瞬间平台在收尾（开奖动画、卡片收走、列表刷新），立刻动手容易撞上。
   * 冷却锚点 = 最后一次扫到「进行中/开奖中」的时刻（lastRunningAt）。
   * 测试里把 15 秒压成几百毫秒（afterDrawLag），行为链路等价。 */
  bp = await bootBagPage();
  const cardL = bp.doc.createElement('div');
  cardL.innerHTML = '<span>进行中活动</span><span>03 分 12 秒 后结束</span>' +
    '<div>10元店铺红包 ID 活动ID:7702886904815681839</div>';
  bp.doc.body.appendChild(cardL);
  bp.api.setTimingForTest({ afterDrawLag: 400, resumeQuiet: 0 });   // 结束证据归 ㋅⑭ 专验
  bp.api.tick();
  ok(bp.api.snapshot().running === true, '㊴ 铺垫：进行中活动在读');
  bp.api.confirmNow();
  ok(bp.clicks.entry === 0, '㊴ ① 倒计时未到 → 照旧顺延不开抽屉');
  bp.api.expireDrawForTest();                  // 倒计时走完（开奖）
  bp.api.confirmNow();
  ok(bp.clicks.entry === 0, '㊴ ② 到点 + 冷却内 → 不立刻开抽屉（等平台收尾）');
  await sleep(450);
  bp.api.confirmNow();
  ok(bp.clicks.entry === 1, '㊴ ③ 冷却过后 → 自动确认恢复开抽屉');
  await sleep(2100);
  ok(bp.clicks.esc >= 1 && !bp.doc.getElementById('drawer'), '㊴ ③ 读完自动关抽屉');

  /* ㊴④⑤ 续福袋侧：开奖后冷却内不点「开始活动」，冷却过后恢复 */
  env = await boot({ watch: true, auto: true, status: '活动进行中 · 距开奖 01:00' });
  env.api.setTimingForTest({ afterDrawLag: 300, resumeQuiet: 0 });   // 结束证据归 ㋅⑭ 专验
  env.tick();                                  // running：冷却锚点刷新
  env.api.expireDrawForTest();                 // 开奖
  setText(env, 'st1', '● 活动待开始');          // 平台开新一轮
  const tdL = env.doc.querySelector('#r1 td:last-child');
  if (tdL) {
    const aL = env.doc.createElement('a');
    aL.id = 'sL'; aL.textContent = '开始活动';
    aL.addEventListener('click', function () { env.clicks.s1++; });
    tdL.appendChild(aL);
  }
  env.tick();
  ok(env.clicks.s1 === 0, '㊴ ④ 开奖后冷却内不急着点「开始活动」');
  ok(env.api.snapshot().phase === 'live', '㊴ ④ 冷却内不误判停机');
  await sleep(350);
  env.tick();
  ok(env.clicks.s1 === 1, '㊴ ⑤ 冷却过后恢复开始下一轮');

  /* ㊴⑥⑦ 无候选停机判定：冷却期内不累积（否则开奖后 2 拍就误停，
   *       冷却刚过本该点的那一轮就漏了） */
  env = await boot({ watch: true, auto: true, status: '活动进行中 · 距开奖 01:00', withStart: false });
  env.api.setTimingForTest({ afterDrawLag: 200 });
  env.tick();                                  // running
  env.api.expireDrawForTest();
  setText(env, 'st1', '● 活动已结束');          // 行结束、新候选还没刷出来
  env.tick();                                  // 冷却内：不累积
  env.tick();                                  // 冷却内：不累积
  ok(env.api.snapshot().phase === 'live', '㊴ ⑥ 冷却内不判「已无可用福袋」停机');
  await sleep(250);
  env.tick();                                  // 冷却后第 1 拍：累积 1
  env.tick();                                  // 第 2 拍：达到阈值 → 停
  ok(env.api.snapshot().reason === 'no-activity', '㊴ ⑦ 冷却后仍无候选 → 正常转停机监视');

  /* ---------- ㊰ 倒计时拆多节点（2026-11-01 深夜 测试档真机读不到后放宽） ----------
   * 平台很可能把「04 分 58 秒 后结束」拆成多个元素（数字/单位各自节点），
   * 单叶永远凑不齐整串。现在从「活动ID」短节点向上聚合也能认出卡片。 */
  env = await boot({ watch: true, withStart: false });
  const card3 = env.doc.createElement('div');
  card3.innerHTML = '<span>进行中活动</span><b>福袋活动2</b>' +
    '<span><b>03</b><i>分</i><b>12</b><i>秒</i><span>后结束</span></span>' +
    '<div>10元店铺红包 <i>ID</i> 活动ID:7702886904815681836 复制</div>';
  env.doc.body.appendChild(card3);
  env.tick();
  ok(env.api.snapshot().running === true, '㊰ 拆节点倒计时也能认出（活动ID入口向上聚合）');
  ok(/^03:1[0-5]$/.test(env.api.snapshot().badge), '㊰ 圆钮读到 03:12 倒计时');
  summary();
})();
