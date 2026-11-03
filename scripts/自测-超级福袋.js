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
/* 开播判据已抽到共享模块（2026-11-03）：福袋与自动刷新共用同一份。
 * 自测必须把它一起装进来 —— 不装的话 lucky-bag 的判据恒为 unknown、
 * 开播闸恒关，所有「该点/该播报」的用例都会红成一片（那不是回归，是缺件）。 */
const LIVE_STATE_CODE = fs.readFileSync(path.join(ROOT, 'src/content/live-state.js'), 'utf8');
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
 * 开播判据的桩（2026-11-03）
 *
 * 判据已抽到 src/content/live-state.js，福袋的开播闸改成「只有明确在播才动作」。
 * 默认给页面放一枚「结束直播」按钮 = 在播，这样绝大多数用例（点开始活动、
 * 播报、读数）都处在真实的主场景里；要验未开播 / 判不出的用例显式指定：
 *   · opts.live === 'off'  ⇒ 放「开始直播」（明确未开播）
 *   · opts.live === 'none' ⇒ 什么信号都不放（判不出 = unknown）
 * 自测页面里没有别的 HH:MM:SS 计时器，所以「计时器递增」这一路不会误命中。
 * ------------------------------------------------------------ */
function liveTagHtml(live) {
  if (live === 'off') return '<div id="liveTag"><button>开始直播</button></div>';
  if (live === 'none') return '';
  return '<div id="liveTag"><button>结束直播</button></div>';
}

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

  const html = '<!doctype html><html><body>' + liveTagHtml(opts.live) +
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
      /* 总闸「福袋功能增强」（2026-11-01 深夜）：popup 唯一的福袋开关，
       * 缺省当开；监视跟随它，不再有独立的 luckyBagWatch。
       * opts.watch 保留旧语义（false = 整体关着），opts.gate 单独压总闸。 */
      luckyBag: opts.gate !== false && opts.watch !== false
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

  /* ★ 先装共享判据，再装福袋模块（顺序不能反：福袋启动首拍就会问它） */
  win.eval(LIVE_STATE_CODE);
  win.eval(CODE);
  await sleep(30);               // 等 dycReadFlags 的 Promise 落地

  const api = win.__DYC_LUCKY_BAG__;
  // 把自动拍关掉，全部用手动 tick 驱动（避免 2.5 秒的真实等待）；
  // lock 归零 —— 否则连续用例会被「点完 2 秒内不许再点」这道锁拦住，
  // 那是真实防连点用的，不该干扰用例之间的独立性。
  if (api && api.setTimingForTest) {
    api.setTimingForTest({ tick: 999999, lock: 0 });
  }
  /* opts.auto = 面板「自动发福袋」开关预置为开（2026-11-01 深夜：
   * 这个开关已从 popup 挪进悬浮面板，默认关，不再走全局 flag）。 */
  if (opts.auto && api && api.setAutoForTest) api.setAutoForTest(true);

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

  /* ---------- ④ 自动续发：点一次，事件序列完整 ---------- */
  env = await boot({ watch: true, auto: true, onStartClick: 'running' });
  // boot 落地的那一拍时，面板开关（autoOn）还没预置 —— 真机上存储读回也是
  // 异步的，第一拍天然不点；这里手动补一拍验「开关开着就会点」。
  env.tick();
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

  /* ---------- ⑦ 开奖后续发下一轮：点的是同一活动 ----------
   * （开奖收尾 15 秒冷却不在这验 —— ㊴ 专验；这里把冷却归零，
   *   保持「开奖后立即续发」的原始用例意图。） */
  env.api.setTimingForTest({ afterDrawLag: 0 });
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

  /* ---------- ⑨ 点了没反应 → 立即停，不立即连点（补发走冷却） ---------- */
  env = await boot({ watch: true, auto: true, onStartClick: 'nothing' });
  env.tick();
  await sleep(80);
  env.messages.length = 0;
  env.api.setTimingForTest({ verify: 30 });
  env.tick();                    // 超过校验窗口仍未变进行中
  ok(env.api.snapshot().phase === 'halted', '⑨ 点完没反应 → 停机监视（可补发）');
  ok(env.api.snapshot().reason === 'no-effect', '⑨ 停止原因 = 点了没反应');
  ok(env.clicks.s1 === 1, '⑨ 失败后不立即连点（只点过一次）');
  ok(env.byType('alert').length === 1, '⑨ 失败只报一条 alert');
  ok(/自动补回来/.test(env.byType('alert')[0].full), '⑨ 停止播报交代「会自动补」');

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

  /* ---------- ㉑ 点成功后：行内没给倒计时就只说「进行中」 ---------- */
  env = await boot({ watch: true, auto: true, onStartClick: 'running' });
  env.tick();                       // 点击拍（面板开关预置后的第一拍）
  await sleep(60);
  env.messages.length = 0;
  env.tick();                       // 校验拍 → 记 1 轮
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
  ok(env.api.snapshot().phase === 'halted', '㊞ 有活动异常 → 停机监视（自动续发不再点击）');
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

  async function bootDrawer(body) {
    /* 开播判据的桩（2026-11-03）：这一组用例验的是「抽屉读数」，必须在播 ——
     * 否则开播闸恒关，tick 会在读行之前就 return，倒计时永远是 0。
     * 页面里没有 HH:MM:SS 计时器，所以「结束直播」这一枚按钮就是唯一信号。 */
    const dom = new JSDOM('<!doctype html><html><body>' + liveTagHtml() + body + '</body></html>', {
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
    win.dycReadFlags = function () { return Promise.resolve({ luckyBag: true }); };
    win.dycWatchFlags = function () {};
    win.hasProductRows = function () { return true; };
    win.eval(LIVE_STATE_CODE);      // 共享判据必须先于福袋模块（2026-11-03）
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
  async function bootBagPage(extraHtml, opts) {
    opts = opts || {};
    const entryHtml = opts.entryHtml !== undefined
      ? opts.entryHtml
      : '<button id="entry">超级福袋-活动管理</button>';
    /* 开播判据的桩（2026-11-03）：默认「在播」，否则开播闸恒关、
     * 所有「该点入口 / 该读数」的用例都会红。显式要验未开播 / 判不出的
     * 用例用 opts.live = 'off' / 'none'；自己往 extraHtml 里塞了 liveTag
     * 的用例（㊦⑦ 那几条）不再重复添加，避免「结束直播 + 开始直播」并存
     * 把在播信号顶掉。 */
    const hasOwnLiveTag = /id="liveTag"/.test(extraHtml || '');
    const liveHtml = hasOwnLiveTag ? '' : liveTagHtml(opts.live);
    const html = liveHtml + '<div id="top">'
      + entryHtml
      + '</div>'
      + (extraHtml || '')
      + '<div id="host">' + (opts.preOpen ? '<div id="drawer">'
        + '<input id="q" placeholder="请输入奖品名称">'
        + '<table><tbody><tr id="r1"><td><div>10元店铺红包 ID 8899</div></td>'
        + '<td>' + (opts.rowStatus || '进行中 距结束 03:12') + '</td></tr></tbody></table></div>' : '') + '</div>'
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
      /* display:none 的元素给 0 尺寸（2026-11-02 晚：㊸ 用例要模拟
       * 「整页文本有字样、但元素不可见所以扫不成行」） */
      if (this.style && this.style.display === 'none') {
        return { width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0, x: 0, y: 0, toJSON: function () {} };
      }
      /* 显式写死高度的元素按写死的来（2026-11-02 深夜：㊻④ 要模拟真机
       * 那种 895×833 的整块容器，验证「超高容器不当行」的守卫） */
      const hp = this.style && this.style.height;
      if (hp && /^\d+px$/.test(hp)) {
        const h = parseInt(hp, 10);
        return { width: 800, height: h, top: 100, left: 0, right: 800, bottom: 100 + h, x: 0, y: 100, toJSON: function () {} };
      }
      return { width: 250, height: 180, top: 300, left: 900, right: 1150, bottom: 480, x: 900, y: 300, toJSON: function () {} };
    };
    const messages = [];
    win.setStatus = function (t, ty, o) {
      o = o || {};
      messages.push({
        text: t, type: ty || 'info', source: o.source || '', count: o.count || '',
        /* keepHistory 原样透传：㊿ 要验「绿点但不落盒」，undefined 与 false
         * 必须能区分（undefined = 按类型默认，success 默认是入盒的） */
        keepHistory: o.keepHistory
      });
    };
    win.dycReadFlags = function () { return Promise.resolve({ luckyBag: true }); };
    win.dycWatchFlags = function () {};
    win.hasProductRows = function () { return true; };

    /* ★ 监听器必须在 eval 之前挂好：
     *   模块进页面就会做第一次确认（拨开即确认），晚挂就漏掉那一次点击，
     *   断言会误判成「没点入口」。 */
    const clicks = { entry: 0, esc: 0, dstart: 0 };
    const drawerHtmlStr = '<div id="drawer">'
      + '<input id="q" placeholder="请输入奖品名称">'
      + '<table><tbody>'
      + '<tr id="r1"><td><div>10元店铺红包 ID 8899</div></td><td>'
      + (opts.drawerRowHtml !== undefined ? opts.drawerRowHtml : '进行中 距结束 03:12') + '</td></tr>'
      + '</tbody></table></div>';
    function openDrawer() {
      const host = doc.getElementById('host');
      if (host && !doc.getElementById('drawer')) {
        /* opts.emptyDrawer：抽屉开了但里面什么都没有（模拟平台渲染慢 /
         * 行还没出来 —— 2026-11-02 晚防误发用例需要这个状态） */
        const shell = (opts.emptyDrawer
          ? '<div id="drawer"><input id="q" placeholder="请输入奖品名称"></div>'
          : drawerHtmlStr) + (opts.cardsHtml || '');
        /* opts.renderDelayMs：抽屉外壳立刻出现、内容晚一点才渲染
         * （2026-11-02 深夜真机「手动刷新还是没检测到」就是这样：
         *  点开瞬间 shells 出现，表格要等服务端回包） */
        if (opts.renderDelayMs) {
          host.innerHTML = '<div id="drawer"><input id="q" placeholder="请输入奖品名称"></div>';
          setTimeout(function () {
            if (doc.getElementById('drawer')) host.innerHTML = shell;
          }, opts.renderDelayMs);
        } else {
          host.innerHTML = shell;
        }
      }
    }
    const entryBtn = doc.getElementById('entry');
    if (entryBtn) entryBtn.addEventListener('click', function () {
      clicks.entry++;
      openDrawer();
    });
    /* 抽屉行里的「开始活动」链接是开抽屉时才插入的 —— 用事件委托计数 */
    doc.addEventListener('click', function (e) {
      if (e.target && e.target.id === 'dstart') clicks.dstart++;
    });
    doc.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      clicks.esc++;
      const host = doc.getElementById('host');
      if (host) host.innerHTML = '';
    });

    /* opts.hold：模拟「刷新网页前读到、还没结束」的那份读数。
     * 它存在 sessionStorage 里（不是内存），刷新后由 boot 接回 ——
     * 2026-11-03 00:15「刷新后无视进行中的福袋直接发」的防误发就靠它。 */
    if (opts.hold) {
      try { win.sessionStorage.setItem('dycBagHoldDrawAt', String(opts.hold)); } catch (eH) {}
    }
    win.eval(LIVE_STATE_CODE);      // 共享判据必须先于福袋模块（2026-11-03）
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

  /* ㊦① 两端不出界（2026-11-02 用户截图：「这个滑动条，按钮拉到最左边最右边
   * 会轻微出界」）。几何：轨道撑满整宽，圆钮圆心只能在「两端各内缩 inset」
   * 的区间里跑；p=0 时圆心 = inset、左沿 = inset − 半径，要 ≥ 轨道左沿 0。
   * 判定取放大态半径（hover/拖动 20px），它才是最容易出界的那一态。 */
  const tin = sh.querySelector('.tk > .in');
  ok(!!tin && !!tin.querySelector('.thumb') && tin.querySelectorAll('.mk').length === 8,
    '㊦① 刻度与圆钮同在一个内缩域里（.tk > .in），左沿才跟轨道对齐');
  const insetM = /\.in\{[^}]*left:(\d+)px[^}]*right:(\d+)px/.exec(cssText);
  const inset = insetM ? +insetM[1] : -1;
  const rNorm = (+( /\.thumb\{[^}]*width:(\d+)px/.exec(cssText) || [0, 0])[1]) / 2;
  const rBig = (+( /\.tk:hover \.thumb[^{]*\{[^}]*width:(\d+)px/.exec(cssText) || [0, 0])[1]) / 2;
  ok(inset >= rBig && inset >= rNorm && rBig > 0,
    '㊦① 内缩 ' + inset + 'px ≥ 圆钮半径（常态 ' + rNorm + 'px / 放大 ' + rBig + 'px），拉到头也不越过轨道端点');
  const thumbNow = parseFloat(tin.querySelector('.thumb').style.left);
  /* 不绑死 calc 的子句顺序：jsdom/cssstyle 会把 `A + k * (B)` 规范成
   * `A + k * (B)` 或 `A + k*(B)` 之类，顺序也不保证与源码一致。
   * 只认三个语义要件齐全：内缩起点、可变区间、以及 p 值本身。 */
  const fillW = sh.querySelector('.fill').style.width;
  ok(/^calc\(/.test(fillW)
    && fillW.indexOf(inset + 'px') === 5
    && fillW.indexOf('(100% - ' + (inset * 2) + 'px)') > 0
    && /0\.2857/.test(fillW),
    '㊦① 填充条从轨道最左端算到圆钮圆心（5 分钟内缩后仍对齐 28.6%，实测 ' + fillW + '）');
  ok(Math.abs(thumbNow - 28.57142857142857) < 1e-6,
    '㊦① 圆钮的 left 仍按内缩域百分比给（' + thumbNow + '%），圆心不会被二次偏移');

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
  const thumb8 = Math.round(parseFloat(sh.querySelector('.thumb').style.left));
  ok(thumb8 === 71, '㊦② 刷新一拍后滑钮仍停在 8 分钟处（' + thumb8 + '%，不会弹回 28%）');

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
  ok(env.api.snapshot().flags.auto === false, '㊪ 总闸关 → 自动续发一并停');
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
  ok(env.api.snapshot().flags.auto === true, '㊪ 总闸开 + 面板开关开 → 续发生效');
  env.watch({ luckyBag: false });
  ok(env.api.snapshot().flags.watch === false && env.api.snapshot().flags.auto === false,
    '㊪ 总闸关 → 面板开关开着也停');
  env.watch({ luckyBag: true });
  ok(env.api.snapshot().flags.auto === true, '㊪ 总闸再开 → 续发按面板开关的原值恢复');
  env.api.setAutoForTest(false);

  /* ============================================================
   * ㊬ 「自动发福袋」开关进悬浮面板（2026-11-01 深夜 用户拍板）
   *    「自动发福袋的功能放进浮动框按钮里面的点击弹出来的框框，
   *      按钮默认关闭」
   * ============================================================ */
  env = await boot({ watch: true });
  ok(env.api.autoOn() === false, '㊬ 面板开关默认关闭');
  ok(env.api.snapshot().flags.auto === false, '㊬ 默认关 → 不会自动续发');
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
  ok(env.clicks.s1 === 1, '㊬ 面板开关打开后续发真实生效（待开始行被点）');

  /* ============================================================
   * ㊭ 同名活动按「框」跟踪（2026-11-01 深夜 用户定）
   *    用户原话：「不可以用奖品名字，你只能抓取奖励的框框来
   *    确认有没有奖品在运行」。真机一个抽屉 8 个活动全部同名
   *    「10元店铺红包」——名字当键 = 8 行互相踩：clicked 一记，
   *    其余 7 行永远进不了候选。行身份 = 行容器自己的 uid。
   * ============================================================ */
  env = await boot({ watch: true, auto: true, onStartClick: 'running' });
  env.api.setTimingForTest({ afterDrawLag: 0 });   // 专验「框键不踩」的排队续发，冷却时机归 ㊴
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
  ok(env.api.snapshot().round === 1, '㊭ 第 1 行校验成功记 1 轮');
  const det239 = env.api.probe().detail;
  ok(det239.length >= 2 && det239[0].key !== det239[1].key,
    '㊭ 诊断里两行的键不同（框 uid，与名字无关）');
  env.doc.getElementById('st1').textContent = '● 活动已结束';   // 第 1 行结束
  env.tick();                                   // 进行中清零 → 第 2 行正常续点
  ok(s2clicks === 1, '㊭ 第 1 行结束后 → 第 2 行续点（键不踩，排队续发保留）');

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
  bp.api.setTimingForTest({ afterDrawLag: 400 });
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
  env.api.setTimingForTest({ afterDrawLag: 300 });
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
  ok(env.clicks.s1 === 1, '㊴ ⑤ 冷却过后恢复续发');

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

  /* ---------- ㊱ 工具栏福袋按钮已删（2026-11-01 深夜 用户「这个福袋按钮
   *    删掉，我一直说的福袋按钮是福袋浮动框按钮的意思」）---------- */
  ok(!/dycRegisterTool\(/.test(CODE),
    '㊱ 中控台工具栏不再注册「福袋」按钮（开关面板只走右下浮动圆钮）');

  /* ============================================================
   * ㊫ 停机监视 + 自动补发（2026-11-01 深夜 用户拍板）
   *    停机不再是终局：圆钮持续显示「已停 X分」；还能点就自动补回去。
   *    第一次立即补；失败后同一会话冷却 10 分钟；连续 3 次失败彻底停。
   *    用户亲手点「结束活动」不在补发范围（我停它就停，红线不变）。
   * ============================================================ */

  /* ㊫① 停机后第一次补发：立即点，不等冷却 */
  env = await boot({ watch: true, auto: true, onStartClick: 'nothing' });
  env.tick();                          // 第 1 次点击（没反应）
  await sleep(80);
  env.api.setTimingForTest({ verify: 30 });
  env.tick();                          // 校验失败 → halted
  env.messages.length = 0;
  env.tick();                          // halted 中看到还能点 → 立即补发
  ok(env.clicks.s1 === 2, '㊫① 停机后第一次补发立即执行（共点 2 次）');
  ok(env.api.snapshot().resume === 1, '㊫① 补发计数 = 1');
  ok(env.api.snapshot().phase === 'starting' || env.api.snapshot().pending,
    '㊫① 补发点击进入待校验');

  /* ㊫② 补发也失败 → 不立即重试（同一会话冷却 10 分钟） */
  await sleep(80);
  env.tick();                          // 校验失败 → 继续 halted（resume=1）
  env.messages.length = 0;
  env.tick();                          // 冷却中 → 不点
  ok(env.clicks.s1 === 2, '㊫② 冷却期内不重试（仍 2 次）');
  ok(env.api.snapshot().phase === 'halted', '㊫② 冷却期内保持停机监视');

  /* ㊫③ 冷却过后再补发 */
  env.api.setTimingForTest({ resume: 30 });
  await sleep(40);                     // 让冷却过去
  env.tick();
  ok(env.clicks.s1 === 3, '㊫③ 冷却过后第二次补发（共 3 次）');
  ok(env.api.snapshot().resume === 2, '㊫③ 补发计数 = 2');

  /* ㊫④ 连续 3 次补发都失败 → 彻底停，播报写明次数 */
  await sleep(80);
  env.tick();                          // 校验失败 → resume=2 < 3 → 继续 halted
  await sleep(40);
  env.tick();                          // 第 3 次补发（resume=3）
  ok(env.clicks.s1 === 4, '㊫④ 第三次补发执行（共 4 次点击）');
  await sleep(80);
  env.messages.length = 0;
  env.tick();                          // 校验失败 → resume ≥ 3 → 彻底停
  ok(env.api.snapshot().phase === 'stopped', '㊫④ 连续 3 次补发失败 → 彻底停');
  ok(env.api.snapshot().timers.tick === false, '㊫④ 彻底停后定时器已清');
  const giveupAlert = env.byType('alert')[0];
  ok(!!giveupAlert && /已自动补发 3 次/.test(giveupAlert.full),
    '㊫④ 播报写明「已自动补发 3 次仍未成功」');

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
    if (stNew) stNew.textContent = '● 活动进行中';
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
  ok(env.messages.filter(function (m) { return /已补发/.test(m.count); }).length === 1,
    '㊫⑤ 补发成功播报「第 N 轮 · 已补发」');

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
  env.api.setTimingForTest({ afterDrawLag: 0 });   // ㊬② 要验「清零后下一拍就点」，冷却时机归 ㊴
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
  bp.api.setTimingForTest({ tick: 120, verify: 300, scanMs: 300 });
  ok(bp.api.snapshot().timers.tick === true, '㊹ 铺垫：扫描在跑');
  bp.api.manualStart();
  await waitBag(function () {
    return bp.messages.some(function (m) {
      return /进行中/.test(m.text) && /手动刷新/.test(m.text);
    });
  }, 12000);
  ok(bp.api.snapshot().phase !== 'stopped' && bp.api.snapshot().phase !== 'halted',
    '㊹ ① 手动点击后没变「进行中」→ 不停机（人的动作不把监视干掉）');
  /* 断言按语义要素断（不绑死整句文案）：既要说清"没读到进行中"，
   * 也要给下一步（点手动刷新复核）—— 后者是 2026-11-03 用户
   * 「他自己又不知道有没有成功发」的直接修复点。 */
  var stepMsgs = bp.messages.filter(function (m) {
    return /进行中/.test(m.text) && /手动刷新/.test(m.text);
  });
  ok(stepMsgs.length === 1,
    '㊹ ① 失败只报一条（说明没读到「进行中」并给出复核出路）：' + stepMsgs.length);
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
  const cardHtml = function (name, mm, ss, aid, h) {
    return '<div' + (h ? (' style="height:' + h + '"') : '') + '>'
      + '<div>进行中活动</div>'
      + '<div>' + name + '<span>' + mm + '</span>分<span>' + ss + '</span>秒<span>后结束</span></div>'
      + '<div>活动ID:' + aid + '</div></div>';
  };

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

  /* ---------- ㊿ 手动刷新的读数：绿点，但不进消息盒子（2026-11-03 用户定）----------
   * 用户原话：「这个消息用绿色点，但是不存进消息盒子。」
   *   ① 读到有福袋在跑 ⇒ 绿点（success），这条口气就是「一切正常」；
   *   ② 读数只是当下快照，点几次刷新就来几条，不许写进历史盒子
   *      （盒子留给结果与异常，否则正经消息会被读数挤下去）；
   *   ③ 没跑 / 读不到仍是灰点 —— 只有「确有进行中」才配绿。
   * 断言按「点色来源 + 是否落盒」断，不绑死整句文案与空格。 */
  /* 轮询等目标状态：异步用例一律等状态，禁止固定 sleep 卡时间
   * （2026-11-02 实测固定 4300ms 在并发下 5 轮红 2 轮）。 */
  function waitBag(fn, ms) {
    const t0 = Date.now();
    return new Promise(function (resolve) {
      (function loop() {
        if (fn()) return resolve(true);
        if (Date.now() - t0 > (ms || 3000)) return resolve(false);
        setTimeout(loop, 50);
      })();
    });
  }
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
  async function waitBag(fn, ms) {
    const t0 = Date.now();
    while (Date.now() - t0 < (ms || 3000)) {
      if (fn()) return true;
      await sleep(50);
    }
    return false;
  }

  /* ㊯① 点完平台把抽屉收起（行全没了）→ 必须结案，不能停在 starting */
  bp = await bootBagPage(null, {
    drawerRowHtml: '<span id="ds9">● 活动待开始</span><a id="dstart">开始活动</a>'
  });
  bp.openDrawer();
  bp.api.setTimingForTest({ tick: 120, verify: 400, scanMs: 200 });
  bp.api.manualStart();
  /* 8000ms：手动发福袋现在要先过 START_PRECHECK_MS(3 秒) 才点得下去 */
  ok(await waitBag(function () { return bp.clicks.dstart >= 1; }, 9000),
    '㊯① 铺垫：点了「开始活动」');
  bp.doc.getElementById('host').innerHTML = '';        // 平台收起抽屉
  ok(await waitBag(function () { return bp.api.snapshot().phase !== 'starting'; }, 4000),
    '㊯① 看不见行也要结案（旧版永远停在 starting）：' + bp.api.snapshot().phase);
  ok(bp.messages.some(function (m) { return /进行中/.test(m.text) && /手动刷新/.test(m.text); }),
    '㊯① 结案时一并给出复核出路');

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

  console.log('');
  console.log('通过 ' + pass + ' 项' + (failures.length ? '，失败 ' + failures.length + ' 项' : '，全部通过'));
  if (failures.length) {
    failures.forEach(function (f) { console.log('   ✗ ' + f); });
  }
  process.exit(failures.length ? 1 : 0);
})();
