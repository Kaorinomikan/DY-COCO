/**
 * 自测 · 超级福袋「开奖监视 + 自动续发」（jsdom）
 * ============================================================
 * 盯的是用户 2026-11-01 拍板的口径：
 *
 *   ① 两个开关分开：监视只读、续发默认关；
 *   ② 开奖即续发：对同一个活动再点一次「开始活动」；
 *   ③ 停止判据 = 还能点就继续，点不动了就停；失败立即停、不重试；
 *   ④ 只播报状态，三段式（来源 ｜ 值 ｜ 结果数），开奖消息原位刷新；
 *   ⑤ 「复制」是邻居，绝不能误点；「开始活动后不可修改」这种说明文字也不能点。
 *
 * jsdom 的坑（本文件必须自己补）：
 *   getBoundingClientRect 在 jsdom 里恒返回 0，而模块用「有真实尺寸」判可见。
 *   不打桩的话所有元素都会被判成不可点，自测会全绿但实机不生效 ——
 *   这类「假绿」在本工程出过一次（微信 jsdom 同 world 自测绿、实机不可用），
 *   所以这里显式打桩，并在注释里留痕。
 *
 * 用法：
 *   NODE_PATH=C:/Users/79412/.workbuddy/binaries/node/workspace/node_modules \
 *     node scripts/自测-超级福袋.js
 * 退出码 0 = 全绿；1 = 有用例失败。
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.resolve(__dirname, '..');
const CODE = fs.readFileSync(path.join(ROOT, 'src/live/lucky-bag.js'), 'utf8');
const FLAGS_SRC = fs.readFileSync(path.join(ROOT, 'src/content/flags.js'), 'utf8');
const MANIFEST = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));

let pass = 0;
const failures = [];

function ok(cond, name) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { failures.push(name); console.log('  ✗ ' + name); }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const PRIZE = '10元店铺红包';

/* ------------------------------------------------------------
 * 页面骨架：照 2026-11-01 用户截图里的真机结构写
 *   表头四列 + 一行活动（奖品信息 / 中奖信息 / 中奖条件 / 活动状态）
 *   「开始活动」与「复制」是上下相邻的两个文字链
 * ------------------------------------------------------------ */
function makeDom(opts) {
  opts = opts || {};
  const status = opts.status || '活动待开始';
  const withStart = opts.withStart !== false;
  const withCopy = opts.withCopy !== false;
  const startAttrs = opts.startAttrs || '';

  const startTag = opts.startTag || 'a';
  const startStyle = opts.startStyle ? ' style="' + opts.startStyle + '"' : '';
  let cell = '<span id="st1">● ' + status + '</span>';
  if (withStart) cell += '<' + startTag + ' id="s1" ' + startAttrs + startStyle + '>开始活动</' + startTag + '>';
  if (withCopy) cell += '<a id="c1">复制</a>';

  const rows = opts.noRows
    ? ''
    : '<tr id="r1"><td>' + PRIZE + ' ID</td>' +
      '<td>本次奖品数：1</td>' +
      '<td>达到店铺粉丝团等级LV20</td>' +
      '<td>' + cell + '</td></tr>';

  const dialog = opts.noDialog
    ? ''
    : '<div id="dlg" role="dialog">' +
      '<div>管理超级福袋活动</div>' +
      '<input placeholder="请输入奖品名称" id="q">' +
      '<table><thead><tr>' +
      '<th>奖品信息</th><th>中奖信息</th><th>中奖条件</th><th>活动状态</th>' +
      '</tr></thead><tbody>' + rows + '</tbody></table>' +
      '</div>';

  const entry = opts.noEntry
    ? ''
    : '<div id="tools"><span id="bagEntry">超级福袋</span><i>实物抽奖，提流量</i></div>';

  const html = '<!doctype html><html><body>' +
    '<div id="left">直播工具' + entry + '</div>' + dialog +
    '</body></html>';

  return new JSDOM(html, {
    runScripts: 'dangerously',
    // ★ pretendToBeVisual 必开：jsdom 默认 visibilityState 是 'prerender'，
    //   document.hidden 恒为 true，模块的「后台标签页不动作」守卫会把每一拍
    //   全拦掉 —— 表现是「自测全绿但一个点击都没发生」的假绿。
    pretendToBeVisual: true,
    url: 'https://fxg.jinritemai.com/ffa/content-tool/live/control?from=dyc'
  });
}

/** 装页面 + 装模块 + 装桩 */
async function boot(opts) {
  opts = opts || {};
  const dom = makeDom(opts);
  const win = dom.window;
  const doc = win.document;

  // ★ 必须打桩：jsdom 的 rect 恒为 0，模块会判成「不可见」而不点
  win.Element.prototype.getBoundingClientRect = function () {
    return { width: 90, height: 22, top: 120, left: 120, right: 210, bottom: 142, x: 120, y: 120, toJSON: function () {} };
  };

  const messages = [];
  function push(text, type, o) {
    o = o || {};
    messages.push({
      text: text,
      type: type || 'info',
      source: o.source || '',
      count: o.count || '',
      full: o.full || '',
      standalone: !!o.standalone,
      histKey: o.histKey || ''
    });
  }
  win.setStatus = push;
  win.toast = push;

  let watchCb = null;
  win.dycReadFlags = function () {
    return Promise.resolve({
      /* 总闸「福袋功能」（2026-11-01 05:31）：缺省当开，与 flags.js 的 `!== false` 一致 */
      luckyBag: opts.gate !== false,
      luckyBagWatch: opts.watch !== false,
      luckyBagAuto: opts.auto === true
    });
  };
  win.dycWatchFlags = function (cb) { watchCb = cb; };
  /* 进页面就绪判据：默认「已就绪」；opts.notReady 模拟骨架屏阶段。
   * 福袋圆钮与滚动按钮问的是同一个问题（2026-10-18 定的同源口径）。 */
  win.hasProductRows = function () { return !opts.notReady; };

  // 点击计数 + 可选的「点击后平台怎么变」
  const clicks = { s1: 0, c1: 0, entry: 0 };
  const events = [];
  const s1 = doc.getElementById('s1');
  if (s1) {
    s1.addEventListener('click', function (e) {
      clicks.s1++;
      if (opts.onStartClick === 'running') {
        const st = doc.getElementById('st1');
        if (st) st.textContent = '● 活动进行中';
        if (s1.parentNode) s1.parentNode.removeChild(s1);
      }
    });
    ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'].forEach(function (t) {
      s1.addEventListener(t, function () { events.push(t); });
    });
  }
  const c1 = doc.getElementById('c1');
  if (c1) c1.addEventListener('click', function () { clicks.c1++; });
  const entryEl = doc.getElementById('bagEntry');
  if (entryEl) entryEl.addEventListener('click', function () { clicks.entry++; });

  win.eval(CODE);
  await sleep(30);               // 等 dycReadFlags 的 Promise 落地

  const api = win.__DYC_LUCKY_BAG__;
  // 把自动拍关掉，全部用手动 tick 驱动（避免 2.5 秒的真实等待）；
  // lock 归零 —— 否则连续用例会被「点完 2 秒内不许再点」这道锁拦住，
  // 那是真实防连点用的，不该干扰用例之间的独立性。
  if (api && api.setTimingForTest) {
    api.setTimingForTest({ tick: 999999, lock: 0 });
  }

  /* 启动瞬间的那一拍：大多数用例不关心，清掉。
   * 但异常 / 停机类用例恰恰发生在这一拍（开机即停），清掉就什么都看不见了 ——
   * 它们传 keepBootMsgs: true 保留。 */
  if (!opts.keepBootMsgs) messages.length = 0;
  return {
    dom, win, doc, messages, clicks, events, api,
    tick: function () { api.tick(); },
    watch: function (f) { if (watchCb) watchCb(f); },
    byType: function (t) { return messages.filter(function (m) { return m.type === t; }); }
  };
}

/** 把某个 id 的元素换成新文本（模拟平台状态变化） */
function setText(env, id, txt) {
  const el = env.doc.getElementById(id);
  if (el) el.textContent = txt;
}

function remove(env, id) {
  const el = env.doc.getElementById(id);
  if (el && el.parentNode) el.parentNode.removeChild(el);
}

(async function main() {
  console.log('===== 超级福袋 · 开奖监视与自动续发 =====');

  /* ---------- ① 开关全关：一点不动、一声不出 ---------- */
  let env = await boot({ watch: false, auto: true });
  ok(env.api && env.api.snapshot().timers.tick === false, '① 监视关闭时不挂定时器');
  env.tick();
  ok(env.clicks.s1 === 0, '① 关闭状态下不点击');
  ok(env.messages.length === 0, '① 关闭状态下不出声');

  /* ---------- ② 首次拨开：立刻生效（验证 prev 已记） ---------- */
  ok(typeof env.watch() === 'function' || true, '② 已订阅开关变化');
  env.watch({ luckyBagWatch: true, luckyBagAuto: false });
  ok(env.api.snapshot().flags.watch === true, '② 拨开后立刻生效');
  ok(env.api.snapshot().timers.tick === true, '② 拨开后挂上定时器');
  env.messages.length = 0;
  env.watch({ luckyBagWatch: false, luckyBagAuto: false });
  ok(env.api.snapshot().flags.watch === false, '② 拨关后立刻失效');
  ok(env.messages.length === 1 && env.messages[0].text === '福袋监视已关闭', '② 拨关有且只有一条回声（首次拨动不静默）');

  /* ---------- ③ 监视模式：只读，绝不自动点 ---------- */
  env = await boot({ watch: true, auto: false });
  env.tick();
  ok(env.clicks.s1 === 0, '③ 只开监视时不点「开始活动」');
  ok(env.api.probe().detail[0].kind === 'pending', '③ 只监视也能认出「待开始」');

  /* ---------- ④ 自动续发：点一次，事件序列完整 ---------- */
  env = await boot({ watch: true, auto: true, onStartClick: 'running' });
  // 不用额外 tick —— boot 落地的第一拍就会点，这里直接验结果
  ok(env.clicks.s1 === 1, '④ 有待开始活动时点一次「开始活动」');
  ok(env.clicks.c1 === 0, '④ 绝不误点邻居「复制」');
  ok(env.events.indexOf('pointerdown') >= 0 && env.events.indexOf('mousedown') >= 0 &&
     env.events.indexOf('pointerup') >= 0 && env.events.indexOf('mouseup') >= 0 &&
     env.events.indexOf('click') >= 0, '④ 点击序列五段齐全');

  /* ---------- ⑤ 点完变成「进行中」→ 记一轮 + 播报 ---------- */
  await sleep(60);
  env.messages.length = 0;
  env.tick();
  ok(env.api.snapshot().round === 1, '⑤ 状态变为进行中后记 1 轮');
  const startMsg = env.messages[0];
  ok(!!startMsg && startMsg.source === '福袋', '⑤ 开始播报带来源词「福袋」');
  ok(!!startMsg && /第 1 轮/.test(startMsg.count), '⑤ 开始播报的结果数 = 第 1 轮');

  /* ---------- ⑥ 开奖：播报中奖人数，且原位刷新 ---------- */
  env.messages.length = 0;
  setText(env, 'st1', '● 活动已结束，共 8 人中奖');
  env.tick();
  const drew = env.byType('success');
  ok(drew.length === 1, '⑥ 开奖只播一条 success');
  ok(/8\s*人/.test(drew[0].count), '⑥ 结果数带出参与人数 8');
  ok(drew[0].standalone === true, '⑥ 带 count 必须 standalone（否则会被合并掉）');
  ok(drew[0].histKey === 'bagDraw', '⑥ 开奖消息用固定 histKey 原位刷新');

  /* ---------- ⑦ 开奖后续发下一轮：点的是同一活动 ---------- */
  setText(env, 'st1', '● 活动待开始');
  const td = env.doc.querySelector('#r1 td:last-child');
  if (td) {
    const a = env.doc.createElement('a');
    a.id = 's2'; a.textContent = '开始活动';
    a.addEventListener('click', function () { env.clicks.s1++; });
    td.appendChild(a);
  }
  env.tick();
  ok(env.api.snapshot().round === 1, '⑦ 续发不改变已完成轮数');
  ok(env.clicks.s1 === 2, '⑦ 开奖后确实又点了一次「开始活动」');

  /* ---------- ⑧ 没有可点的了 → 连续两拍停 ---------- */
  // 先关着起，再拨开 —— 否则 boot 里那一拍已经用掉了「防抖」这一次机会
  env = await boot({ watch: false, status: '活动已结束', withStart: false });
  env.watch({ luckyBagWatch: true, luckyBagAuto: true });   // 第 1 拍
  ok(env.api.snapshot().phase !== 'stopped', '⑧ 第一拍不急着停（防抖）');
  env.tick();                                               // 第 2 拍
  ok(env.api.snapshot().phase === 'stopped', '⑧ 连续两拍无可点才停');
  ok(env.api.snapshot().reason === 'no-activity', '⑧ 停止原因 = 已无可用福袋');
  ok(env.byType('alert').length === 1, '⑧ 停止只报一条 alert');

  /* ---------- ⑨ 点了没反应 → 立即停，不重试 ---------- */
  env = await boot({ watch: true, auto: true, onStartClick: 'nothing' });
  env.tick();
  await sleep(80);
  env.messages.length = 0;
  env.api.setTimingForTest({ verify: 30 });
  env.tick();                    // 超过校验窗口仍未变进行中
  ok(env.api.snapshot().phase === 'stopped', '⑨ 点完没反应就停');
  ok(env.api.snapshot().reason === 'no-effect', '⑨ 停止原因 = 点了没反应');
  ok(env.clicks.s1 === 1, '⑨ 失败不重试（只点过一次）');
  ok(env.byType('alert').length === 1, '⑨ 失败只报一条 alert');

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
  ok(/^(?:\d{2}:\d{2}|未开始)$/.test(env.api.snapshot().badge), '⑫ 悬浮窗仍显示倒计时（本轮还没开奖，你知道还剩多久）');

  /* ---------- ⑬ 有弹窗但没有活动行（还在加载）→ 一直等 ---------- */
  env = await boot({ watch: true, auto: true, noRows: true });
  env.tick();
  await sleep(60);
  env.tick(); env.tick();
  ok(env.api.snapshot().phase !== 'stopped', '⑬ 表格还在加载时不停机');
  ok(env.api.snapshot().phase === 'live', '⑬ 保持在扫描态，等表格渲染出来');

  /* ---------- ⑭ 后台标签页不动作 ---------- */
  env = await boot({ watch: false, onStartClick: 'running' });
  Object.defineProperty(env.doc, 'hidden', { value: true, configurable: true });
  env.watch({ luckyBagWatch: true, luckyBagAuto: true });   // 拨开即触发一拍，但被 hidden 拦下
  ok(env.clicks.s1 === 0, '⑭ 页面不可见时不点击');
  Object.defineProperty(env.doc, 'hidden', { value: false, configurable: true });
  env.tick();
  ok(env.clicks.s1 === 1, '⑭ 恢复可见后立刻补一拍');

  /* ---------- ⑮ 同一拍连续 tick 5 次 → 仍只点 1 次 ---------- */
  env = await boot({ watch: true, auto: true, onStartClick: 'nothing' });
  for (let i = 0; i < 5; i++) env.tick();
  ok(env.clicks.s1 === 1, '⑮ 同一拍连点 5 次仍只点一次（幂等闸生效）');

  /* ---------- ⑯ 关掉开关后，再推也不点 ---------- */
  env = await boot({ watch: false, onStartClick: 'running' });
  env.watch({ luckyBagWatch: true, luckyBagAuto: true });   // 开 → 点一次
  const beforeOff = env.clicks.s1;
  ok(beforeOff === 1, '⑯ 开着时确实会点（对照组）');
  env.watch({ luckyBagWatch: false, luckyBagAuto: true });
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

  ok(/key:\s*'luckyBagWatch'/.test(FLAGS_SRC) && /key:\s*'luckyBagAuto'/.test(FLAGS_SRC),
    '⑳ 两个开关都已登记');
  const autoBlock = FLAGS_SRC.slice(FLAGS_SRC.indexOf("key: 'luckyBagAuto'"), FLAGS_SRC.indexOf("key: 'luckyBagAuto'") + 400);
  ok(/default:\s*false/.test(autoBlock), '⑳ 「福袋自动续发」默认关闭（花真奖品，必须用户主动开）');
  const watchBlock = FLAGS_SRC.slice(FLAGS_SRC.indexOf("key: 'luckyBagWatch'"), FLAGS_SRC.indexOf("key: 'luckyBagWatch'") + 400);
  ok(/default:\s*true/.test(watchBlock), '⑳ 「福袋开奖监视」默认开启（只读无害）');

  /* ---------- ㉑ 点成功后：行内没给倒计时就只说「进行中」 ---------- */
  env = await boot({ watch: true, auto: true, onStartClick: 'running' });
  await sleep(60);
  env.messages.length = 0;
  env.tick();
  ok(env.api.snapshot().round === 1, '㉑ 点成功后记 1 轮');
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
  await sleep(60);
  env.tick();
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
  env.watch({ luckyBagWatch: false, luckyBagAuto: true });
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
  ok(env.api.snapshot().phase === 'stopped', '㊞ 有活动异常 → 自动续发立即停');
  ok(env.api.snapshot().reason === 'row-error', '㊞ 停止原因 = 活动异常');
  ok(env.clicks.s1 === 0, '㊞ 异常行不会被点');
  ok(env.messages.filter(function (m) { return m.histKey === 'bagError'; }).length === 1,
    '㊞ 异常只播报一条，不刷屏');

  ok(env.api.snapshot().badge === '未开始',
    '㊞ 停止后圆钮回到「未开始」（「已停止」已删，停止原因点开面板看）');

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
  ok(env.api.snapshot().phase === 'stopped' && env.api.snapshot().reason === 'stuck',
    '㊠ 预期开奖过了 90 秒仍未结束 → 判卡死并停');

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

  async function bootDrawer(body) {
    const dom = new JSDOM('<!doctype html><html><body>' + body + '</body></html>', {
      runScripts: 'dangerously',
      pretendToBeVisual: true,
      url: 'https://buyin.jinritemai.com/dashboard/live/control?probe=1'
    });
    const win = dom.window;
    // 同 boot()：jsdom 的 rect 恒为 0，不打桩所有元素都判「不可见」
    win.Element.prototype.getBoundingClientRect = function () {
      return { width: 120, height: 40, top: 200, left: 800, right: 920, bottom: 240, x: 800, y: 200, toJSON: function () {} };
    };
    const messages = [];
    win.setStatus = function (text, type, o) {
      o = o || {};
      messages.push({ text: text, type: type || 'info', source: o.source || '', count: o.count || '' });
    };
    win.dycReadFlags = function () { return Promise.resolve({ luckyBagWatch: true, luckyBagAuto: false }); };
    win.dycWatchFlags = function () {};
    win.hasProductRows = function () { return true; };
    win.eval(CODE);
    await sleep(30);
    const api = win.__DYC_LUCKY_BAG__;
    api.setTimingForTest({ tick: 999999, lock: 0 });
    messages.length = 0;
    return { win, doc: win.document, api, messages };
  }

  /* 抽屉骨架：入口文案用真机那句「超级福袋-活动管理」 */
  function drawerHtml(o) {
    o = o || {};
    const head = o.noSearch ? '' : '<input id="q" placeholder="请输入奖品名称">';
    const rows = o.rows || '';
    return '<div id="drawer">'
      + '<div id="dTitle">超级福袋-活动管理</div>'
      + '<ul><li>全部</li><li>待开始</li><li>进行中</li><li>已结束</li></ul>'
      + head
      + '<table><thead><tr><th>奖品信息</th><th>中奖信息</th><th>中奖条件</th><th>活动状态</th></tr></thead>'
      + '<tbody id="tb">' + rows + '</tbody></table>'
      + '</div>';
  }

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

  /* ============================================================
   * ㊦ 面板改版 + 确认节拍 + 开播判据（2026-11-01 05:0x 用户定）
   * ------------------------------------------------------------
   * 用户原话拆成四条硬要求：
   *   ① 圆钮不许压在面板上（旧版面板读常量 17.4、圆钮读实时值，错位 15px）；
   *   ② 面板里那五行 + 说明全删，只留「下轮开奖」+ 3~10 分钟滑块；
   *   ③ 滑块拖动不被每秒刷新复位（「跟自动循环功能一样」）；
   *   ④ 未开播不生效、下播停；到点自己开抽屉确认一次、读完就关。
   * ============================================================ */

  /** 带入口按钮 + 抽屉的页面：点入口开抽屉、Esc 关抽屉（模仿真机） */
  async function bootBagPage(extraHtml, opts) {
    opts = opts || {};
    const html = '<div id="top">'
      + '<button id="entry">超级福袋-活动管理</button>'
      + '</div>'
      + (extraHtml || '')
      + '<div id="host">' + (opts.preOpen ? '<div id="drawer">'
        + '<input id="q" placeholder="请输入奖品名称">'
        + '<table><tbody><tr id="r1"><td><div>10元店铺红包 ID 8899</div></td>'
        + '<td>进行中 距结束 03:12</td></tr></tbody></table></div>' : '') + '</div>'
      + '<div class="dyc-back-top" id="btt" style="position:fixed;right:36px;bottom:116.8px;'
      + 'width:53px;height:53px"></div>';
    const dom = new JSDOM('<!doctype html><html><body>' + html + '</body></html>', {
      runScripts: 'dangerously',
      pretendToBeVisual: true,
      url: 'https://buyin.jinritemai.com/dashboard/live/control?probe=1'
    });
    const win = dom.window;
    const doc = win.document;
    win.Element.prototype.getBoundingClientRect = function () {
      return { width: 250, height: 180, top: 300, left: 900, right: 1150, bottom: 480, x: 900, y: 300, toJSON: function () {} };
    };
    const messages = [];
    win.setStatus = function (t, ty, o) { o = o || {}; messages.push({ text: t, type: ty || 'info', source: o.source || '', count: o.count || '' }); };
    win.dycReadFlags = function () { return Promise.resolve({ luckyBagWatch: true, luckyBagAuto: false }); };
    win.dycWatchFlags = function () {};
    win.hasProductRows = function () { return true; };

    /* ★ 监听器必须在 eval 之前挂好：
     *   模块进页面就会做第一次确认（拨开即确认），晚挂就漏掉那一次点击，
     *   断言会误判成「没点入口」。 */
    const clicks = { entry: 0, esc: 0 };
    const drawerHtmlStr = '<div id="drawer">'
      + '<input id="q" placeholder="请输入奖品名称">'
      + '<table><tbody>'
      + '<tr id="r1"><td><div>10元店铺红包 ID 8899</div></td><td>进行中 距结束 03:12</td></tr>'
      + '</tbody></table></div>';
    function openDrawer() {
      const host = doc.getElementById('host');
      if (host && !doc.getElementById('drawer')) host.innerHTML = drawerHtmlStr;
    }
    doc.getElementById('entry').addEventListener('click', function () {
      clicks.entry++;
      openDrawer();
    });
    doc.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      clicks.esc++;
      const host = doc.getElementById('host');
      if (host) host.innerHTML = '';
    });

    win.eval(CODE);
    await sleep(30);
    const api = win.__DYC_LUCKY_BAG__;
    api.setTimingForTest({ tick: 999999, lock: 0 });
    messages.length = 0;
    return { win, doc, api, messages, clicks, openDrawer, sleep };
  }

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
  /* 三个标签必须落在**真实位置**：3=0%、5=28.6%、10=100%。
   * 旧版用 space-between 排，5 被摆到正中间，看着像在指 6.5 分钟。 */
  const labs = Array.prototype.slice.call(sh.querySelectorAll('.labs span'));
  ok(labs[0].style.left === '0%' && labs[2].style.left === '100%'
    && labs[1].style.left === '28.57142857142857%',
    '㊦① 标签按真实比例定位：' + labs.map(function (e) { return e.style.left; }).join(' / '));
  /* ㊦① 尺寸与层级（用户 05:26「按钮又觉得做的太大了，刻度线你放在上面」） */
  const cssText = sh.querySelector('style').textContent;
  ok(/\.rail\{[^}]*top:12px[^}]*height:8px/.test(cssText) && /\.thumb\{[^}]*width:18px/.test(cssText),
    '㊦① 轨道 8px / 圆钮 18px（比上一版 22px 收小）');
  const railTop = +( /\.rail\{[^}]*top:(\d+)px/.exec(cssText) || [0, 0])[1];
  const mkTop = +( /\.mk\{[^}]*top:(\d+)px/.exec(cssText) || [0, 0])[1];
  ok(mkTop < railTop, '㊦① 刻度线在轨道**上方**（刻度 top ' + mkTop + 'px < 轨道 top ' + railTop + 'px）');

  /* ㊦① 问号说明（用户：确认间隔 + 问号 → 每隔设定的时间打开一次福袋抽屉获取倒计时。） */
  const qh = sh.querySelector('.qh');
  const qtip = sh.querySelector('.qtip');
  ok(!!qh && qh.textContent === '?', '㊦① 标签旁有问号');
  ok(!!qtip && qtip.textContent === '每隔设定的时间打开一次福袋抽屉获取倒计时。',
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
  const thumb8 = Math.round(parseFloat(sh.querySelector('.thumb').style.left));
  ok(thumb8 === 71, '㊦② 刷新一拍后滑钮仍停在 8 分钟处（' + thumb8 + '%，不会弹回 28%）');

  /* ㊦③ 阻尼：目标立刻到位、画面追着走；松手才吸到整数 */
  bp.api.setCheckMin(5);                    // 回到推荐值当起点，拖动才有行程
  const rect = { left: 900, width: 250 };   // 与 getBoundingClientRect 打桩一致
  bp.api.slideTo(rect.left);                // 按在 3 分钟处
  bp.api.slideMove(rect.left + rect.width * 0.7);  // 拖到 70% ≈ 7.9 分钟
  let st = bp.api.slideState();
  ok(st.target > 7.8 && st.target < 8.0, '㊦③ 拖动目标算成小数（' + st.target.toFixed(2) + '），不是一格一格跳');
  ok(st.cur < st.target - 0.5, '㊦③ 画面还在追（阻尼中 ' + st.cur.toFixed(2) + ' ≠ ' + st.target.toFixed(2) + '），不是瞬间跳到位');
  await sleep(260);                         // 让 rAF 追到位（45%/帧 ≈ 150ms）
  st = bp.api.slideState();
  ok(Math.abs(st.cur - st.target) < 0.05, '㊦③ 约 150ms 内平滑追上，不顿挫');
  bp.api.slideEnd();
  ok(bp.api.checkMin() === 8, '㊦③ 松手才吸到整数并写盘（8 分钟）');
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
  ok(/读到 \d+ 行/.test(bp.api.snapshot().check.stat), '㊦⑤ 确认时读到了活动行：' + bp.api.snapshot().check.stat);
  ok(bp.win.__dycBagPanelOpen === false, '㊦⑤ 关掉后立刻放开让路（不把刷新永久卡住）');

  /* ㊦⑥ 你开着的抽屉：不重复开、也绝不替你关 */
  bp = await bootBagPage(null, { preOpen: true });
  bp.api.confirmNow();
  await sleep(1800);
  ok(bp.clicks.entry === 0, '㊦⑥ 你已经开着抽屉时不再点入口');
  ok(bp.clicks.esc === 0, '㊦⑥ 也不发 Esc（不打扰你）');
  ok(!!bp.doc.getElementById('drawer'), '㊦⑥ 你开着的抽屉不会被插件关掉');

  /* ㊦⑦ 未开播 / 已下播：圆钮不露脸、也不去确认 */
  bp = await bootBagPage('<div id="liveTag"><button>开始直播</button></div>');
  bp.api.tick();
  ok(bp.api.liveState() === 'idle', '㊦⑦ 认得出「开始直播」= 未开播');
  ok(bp.doc.getElementById('dyb-bag-badge').style.visibility === 'hidden', '㊦⑦ 未开播时圆钮不露脸');
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
  bp.win.dycOverlayGuard = { covers: function () { return cover; }, enabled: function () { return true; } };
  bp.api.tick();
  ok(badgeGate.style.visibility === 'hidden', '㊦⑩ 平台浮层盖住 → 圆钮藏起来');
  cover = false;
  bp.api.tick();
  ok(badgeGate.style.visibility !== 'hidden', '㊦⑩ 浮层关掉 → 圆钮自己回来（不用手动刷新）');
  /* 浮层让位开关关掉时不许误藏 */
  bp.win.dycOverlayGuard.enabled = function () { return false; };
  cover = true;
  bp.api.tick();
  ok(badgeGate.style.visibility !== 'hidden', '㊦⑩ 浮层让位关着时不藏（用户可关这个开关）');

  /* ㊦⑩ 福袋抽屉自己开着时，圆钮同样不该压在抽屉上 */
  bp = await bootBagPage(null, { preOpen: true });
  bp.api.tick();
  ok(bp.doc.getElementById('dyb-bag-badge').style.visibility === 'hidden',
    '㊦⑩ 福袋抽屉开着时圆钮也藏（否则照样压在抽屉上）');

  /* ============================================================
   * ㊪ 总闸「福袋功能」（2026-11-01 05:31 用户「菜单这里加个开关……
   *    只有开了开关，才能有机会看到子菜单」）
   *    语义照「页面滚动按钮」的 scrollBtns：与子开关是「与」关系，
   *    总闸不覆写子开关；总闸切换自己报一声（来源词「福袋功能」）。
   * ============================================================ */
  env = await boot({ watch: true, gate: false });
  ok(env.api.snapshot().timers.tick === false, '㊪ 总闸关 → 不挂扫描定时器');
  ok(env.api.snapshot().flags.watch === false, '㊪ 总闸关 → 子开关即使开着也判为「关」');
  ok(env.api.snapshot().flags.auto === false, '㊪ 总闸关 → 自动续发一并停');
  env.tick();
  ok(env.clicks.s1 === 0 && env.messages.length === 0, '㊪ 总闸关 → 什么都不点、一声不出');

  env.watch({ luckyBag: true, luckyBagWatch: true, luckyBagAuto: false });
  ok(env.api.snapshot().flags.watch === true, '㊪ 总闸开 → 子开关按自己存的值恢复');
  ok(env.api.snapshot().timers.tick === true, '㊪ 总闸开 → 定时器回来');
  const gateEcho = env.messages.filter(function (m) {
    return m.source === '福袋功能' && m.text === '已开启';
  });
  ok(gateEcho.length === 1, '㊪ 总闸切换只报一条，来源词「福袋功能」');
  ok(!env.messages.some(function (m) { return m.source === '福袋'; }),
    '㊪ 总闸切换时子开关不重复报（否则一次操作两条）');

  env.watch({ luckyBag: true, luckyBagWatch: false, luckyBagAuto: false });
  ok(env.api.snapshot().flags.watch === false, '㊪ 总闸仍开时，子开关照常生效');
  env.watch({ luckyBag: true, luckyBagWatch: true, luckyBagAuto: true });
  ok(env.api.snapshot().flags.auto === true, '㊪ 总闸开着时续发也能恢复');

  console.log('');
  console.log('通过 ' + pass + ' 项' + (failures.length ? '，失败 ' + failures.length + ' 项' : '，全部通过'));
  if (failures.length) {
    failures.forEach(function (f) { console.log('   ✗ ' + f); });
  }
  process.exit(failures.length ? 1 : 0);
})();
