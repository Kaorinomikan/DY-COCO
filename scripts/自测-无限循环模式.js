/**
 * 自测 · 自动循环讲解的无限模式(守夜 + 重定位配额)
 * ============================================================
 * 跑法:node scripts/自测-无限循环模式.js
 *
 * 覆盖用户 2026-11-05 定的七条口径 + 2026-11-08 待命跟随口径:
 *   ① 无限模式(守夜/待命)默认开、开关值有记忆(显式关掉才是关)
 *   ② 关闭时三轮找不到仍然停表(旧行为一字不变)
 *   ③ 开启时同一场景不停表,转 phase='vigil',胶囊显示「守候中」
 *   ④ 守夜探针三种结局:还在讲 ⇒ 回计时不点;真断了 ⇒ 当拍补讲;行不在 ⇒ 继续守
 *   ⑤ 重定位走 5 分钟滑窗配额,不是「距上次计时」
 *   ⑥ 补讲没确认 ⇒ 30 秒冷却,冷却期内不许再点
 *   ⑦ 30 分钟一个「讲解」按钮都找不到才真停;关掉无限模式时若在守夜也立刻停
 *   ⑧ 待命跟随(2026-11-08):手动取消讲解 ⇒ 不停表、进待命、绝不补讲;
 *      等到别的品在讲才接管;30 分钟无介入才真停;待命期不重定位
 */

'use strict';

const SRC_UNDER_TEST = 'src/live/auto-loop-lecture.js';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const source = fs.readFileSync(path.resolve(__dirname, '..', SRC_UNDER_TEST), 'utf8');
let passed = 0;
function check(value, label) { assert.ok(value, label); passed++; }
async function flush() { for (let n = 0; n < 35; n++) await Promise.resolve(); }

function setup(store = {}) {
  const dom = new JSDOM('<body></body>', { url: 'https://example.com/not-live', runScripts: 'outside-only' });
  const w = dom.window, timers = new Map();
  let now = 2000000, timerId = 0, mounted = true, clicks = 0;

  const row = w.document.createElement('div');
  row.dataset.key = 'id:1234567890123456789';
  row.dataset.name = '当前讲解商品';
  row.dataset.live = '1';
  const button = w.document.createElement('button');
  button.textContent = '取消讲解';
  row.appendChild(button);
  w.document.body.appendChild(row);

  w.Date.now = () => now;
  w.setInterval = fn => { timers.set(++timerId, fn); return timerId; };
  w.clearInterval = id => timers.delete(id);
  /* #133:取消讲解的 800ms 复核走 setTimeout —— 沙箱不自动跑定时器,
   * 回调按注册顺序收进 __timeouts,用例里按源码特征挑出来手动执行。 */
  w.setTimeout = fn => { const id = ++timerId; (w.__timeouts = w.__timeouts || []).push(fn); return id; };
  w.clearTimeout = () => {};
  w.requestAnimationFrame = () => 0;
  w.cancelAnimationFrame = () => {};
  w.setStatus = () => {};
  w.__dycTestTrusted = function (e) { return !!(e && e.__real); };
  w.chrome = {
    storage: {
      local: {
        get: async keys => Object.fromEntries((Array.isArray(keys) ? keys : [keys]).map(k => [k, store[k]])),
        set: async data => Object.assign(store, data)
      }
    }
  };
  w.__fixture = {
    extra: [],
    row: () => (mounted ? row : null),
    /* 2026-11-08 待命跟随:加一条"别人的商品行",用来验证"等下一个品"确实能接上 */
    addRow: (key, name, live) => {
      const r = w.document.createElement('div');
      r.dataset.key = key;
      r.dataset.name = name;
      r.dataset.live = live;
      const b = w.document.createElement('button');
      b.textContent = live === '1' ? '取消讲解' : '讲解';
      r.appendChild(b);
      w.document.body.appendChild(r);
      w.__fixture.extra.push(r);
      return r;
    },
    /* 默认行为:点一下就翻转真实状态(和平台一致)。
     * 测试要模拟「点了没反应」时把 __clickHook 设成空函数即可。 */
    click: el => {
      clicks++;
      if (w.__clickHook) { w.__clickHook(el); return; }
      row.dataset.live = row.dataset.live === '1' ? '0' : '1';
      el.textContent = row.dataset.live === '1' ? '取消讲解' : '讲解';
    },
    sleep: ms => { now += ms; return Promise.resolve(); },
    search: null
  };

  const hook = `
  findLiveRow = function(){var r=window.__fixture.row();return r&&r.dataset.live==='1'?r:null;};
  findRowByKey = function(){var r=window.__fixture.row();return r&&r.dataset.key===state.key?r:null;};
  findRowByName = function(n){var r=window.__fixture.row();return r&&r.dataset.name===n?r:null;};
  rows = function(){var r=window.__fixture.row();var out=r?[r]:[];return out.concat(window.__fixture.extra||[]);};
  rowKey = function(r){return r.dataset.key;}; rowName = function(r){return r.dataset.name;};
  isLecturing = function(r){return r.dataset.live==='1';};
  findLectureBtn = function(r){return r.querySelector('button');};
  clickable = function(b){return !!b&&!b.disabled;};
  fireClick = window.__fixture.click; sleep = window.__fixture.sleep;
  findCartPanel = function(){return document.body;};
  recordRowAnchor = function(){return null;};
  place = function(){if(refs.panel)refs.panel.classList.toggle('open',panelOpen);};
  probeAnchor = revealRow = function(){ return null; };
  locateBySearch = function(id){
    return Promise.resolve(window.__fixture.search ? window.__fixture.search(id) : null);
  };
  window.__test = {
    state:state, apply:apply, start:start, setOn:setOn, setInfinite:setInfinite,
    setGroup:setGroup, saveSeconds:saveSeconds, checkNow:checkNow,
    doFastCycle:doFastCycle, doCycle:doCycle,
    enterVigil:enterVigil, vigilTick:vigilTick, doVigilResume:doVigilResume,
    doVigilReloc:doVigilReloc, relocAllowed:relocAllowed, probeGap:probeGap,
    userCancel:onUserCancelClick,
    flushWrites:function(){return settingsWrite;}
  };
`;
  assert.ok(source.includes('  boot();'), '源码入口 boot(); 不见了');
  w.eval(source.replace('  boot();', hook));
  return {
    dom, w, api: w.__test, store, row, button,
    mount: v => { mounted = v; },
    clicks: () => clicks,
    now: () => now,
    advance: ms => { now += ms; },
    runTimeout: pred => {
      const list = w.__timeouts || [];
      w.__timeouts = [];
      list.forEach((f) => { if (pred(String(f))) f(); });
    },
    ui: sel => w.document.getElementById('dyc-auto-loop-host').shadowRoot.querySelector(sel)
  };
}

/** 开一个「已开启 + 已识别商品」的实例;infinite 决定是否开无限模式 */
async function ready(store, infinite) {
  const f = setup(store);
  f.api.apply({ autoLoopLecture: true }); await flush();
  if (infinite) { f.api.setInfinite(true, true); await flush(); }
  f.api.setOn(true, true); await flush();
  /* 商品身份:正常路径下 checkNow 会自己 commitProduct;这里兜一手,
   * 免得某次改写让 key 为空、后面的探针全成了「行不在」。 */
  if (!f.api.state.key) f.api.state.key = 'id:1234567890123456789';
  if (!f.api.state.product) f.api.state.product = '当前讲解商品';
  return f;
}

async function toVigil(f) {
  f.mount(false);                                   // 行被虚拟滚动回收
  for (let i = 0; i < 3; i++) { await f.api.doFastCycle(); await flush(); }
}

(async () => {
  /* ---------- ① 缺省开 + 记忆(2026-11-08 口径变更) ----------
   * 用户原话:「经常我没有关掉循环讲解的按钮,但是不知为何它就停止要我手动触发开启,
   *   我不希望这样子,而是让它待命直到发现下一个讲解的品」。
   * ⇒ 默认值必须落在「不停」这一侧;「默认关闭」是 2026-11-05 的旧口径,已作废。 */
  const on = setup({}); on.api.apply({ autoLoopLecture: true }); await flush();
  check(on.api.state.infinite === true, '没存过就是开(待命默认)');
  /* 2026-11-05 二次改:∞ 必须**常驻显示**,关着时也在(灰),否则用户以为功能没做 */
  check(!!on.ui('.inf-mark'), '∞ 入口常驻存在(与开关状态无关)');
  check(on.ui('.inf-mark').classList.contains('on') === true, '开启态 ∞ 上色(蓝)');

  const remembered = setup({ dybAutoLoopInfinite: true }); remembered.api.apply({ autoLoopLecture: true }); await flush();
  check(remembered.api.state.infinite === true, '存过 true 就恢复成开(有记忆)');

  const offStore = setup({ dybAutoLoopInfinite: false }); offStore.api.apply({ autoLoopLecture: true }); await flush();
  check(offStore.api.state.infinite === false, '显式关过就是关(记忆功能没丢)');
  check(offStore.ui('.inf-mark').classList.contains('on') === false, '关闭态 ∞ 不上色(灰)');

  const asNum = setup({ dybAutoLoopInfinite: 1 }); asNum.api.apply({ autoLoopLecture: true }); await flush();
  check(asNum.api.state.infinite === true, '非布尔旧值按「开」处理(只有明确 false/0 才是关)');

  /* ---------- ①·b 外置 ∞ 只是状态灯,点了不生效 ---------- */
  const tap = setup({}); tap.api.apply({ autoLoopLecture: true }); await flush();
  const tapBefore = tap.api.state.infinite;
  tap.ui('.inf-mark').dispatchEvent(new tap.w.MouseEvent('click', { bubbles: true, cancelable: true }));
  await flush();
  check(tap.api.state.infinite === tapBefore, '外置 ∞ 不可点:点了开关不变');
  /* 点它等于点在胶囊上(CSS pointer-events:none 让事件穿透),面板会展开 —— 这是
   * 胶囊本来的行为,符合「要操作就点开框框」的口径,因此不在这里断言「不展开」。 */
  check(source.indexOf('refs.capInf.addEventListener') < 0, '源码没有给外置 ∞ 绑点击(只做状态显示)');
  check(/\.inf-mark\{[\s\S]{0,260}?pointer-events:none/.test(source), '外置 ∞ 关掉鼠标事件(CSS 兜底)');
  check((function () {
    const a = source.indexOf('.inf-mark{width');
    const b = source.indexOf('.inf-mark.on', a);
    return a >= 0 && b > a && source.slice(a, b).indexOf('border') < 0;
  })(), '外置 ∞ 没有边框(不是按钮外观)');
  check((function () {
    const m = /\.inf\{height:(\d+)px/.exec(source);
    return !!m && Number(m[1]) >= 24;
  })(), '面板右上角开关高度不少于 24px(够显眼)');
  check((function () {
    const m = /\.inf-mark\{width:(\d+)px;height:(\d+)px/.exec(source);
    return !!m && Number(m[1]) >= 24 && Number(m[2]) >= 12;
  })(), '外置 ∞ 图形不小于 24x12(用户两次要求放大)');
  check(source.indexOf('viewBox="0 0 28 14"') >= 0, '∞ 用矢量图形,不靠字符基线对位');

  /* ---------- ② 无限关:三轮找不到仍然停表 ---------- */
  const off = await ready({ dybAutoLoopSeconds: 15, dybAutoLoopGroup: 'sec', dybAutoLoopEnabled: false, dybAutoLoopInfinite: false }, false);
  await toVigil(off);
  check(off.api.state.on === false, '无限关:三轮找不到就停表(旧行为不变)');
  check(off.api.state.phase !== 'vigil', '无限关:不会进守夜');

  /* ---------- ③ 无限开:同一场景转守夜,不停表 ---------- */
  const f = await ready({ dybAutoLoopSeconds: 15, dybAutoLoopGroup: 'sec', dybAutoLoopEnabled: false }, true);
  await toVigil(f);
  check(f.api.state.on === true, '无限开:三轮找不到也不停表');
  check(f.api.state.phase === 'vigil', '无限开:转入 vigil 阶段');
  check(f.ui('.slot').textContent === '守候中', '胶囊槽显示「守候中」');
  check(f.ui('.inf').getAttribute('aria-pressed') === 'true', '面板里的「无限」按钮是按下态');
  check(f.ui('.inf-mark').classList.contains('on') === true, '开启态 ∞ 上色(蓝)');
  check(f.api.state.fails === 0 && f.api.state.skips === 0, '进守夜把失败/跳过计数清零(等待态不是失败态)');
  check(f.ui('.r3') && f.ui('.r3').hidden === false, '第三行常驻守候信息');
  check(/守候中/.test(f.ui('.r3').textContent), '第三行写明守候中');

  /* ---------- ④-1 探针看到「还在讲」:回计时,不点击 ---------- */
  const beforeClicks = f.clicks();
  f.mount(true);
  f.row.dataset.live = '1'; f.button.textContent = '取消讲解';
  f.advance(31000);                                  // 越过首探 5 秒
  f.api.vigilTick(); await flush();
  check(f.api.state.phase === 'run', '探针看到仍在讲解 ⇒ 回正常倒计时');
  check(f.clicks() === beforeClicks, '虚惊一场时不点任何按钮(点一下反而打断正在进行的讲解)');
  check(f.api.state.nextAt > f.now(), '回计时后重新给出完整间隔');

  /* ---------- ④-2 探针看到「讲解」:当拍补讲 ---------- */
  const g = await ready({ dybAutoLoopSeconds: 15, dybAutoLoopGroup: 'sec', dybAutoLoopEnabled: false }, true);
  await toVigil(g);
  const c0 = g.clicks();
  const r0 = g.api.state.round;
  g.mount(true);
  g.row.dataset.live = '0'; g.button.textContent = '讲解';
  g.advance(31000);
  g.api.vigilTick();
  for (let i = 0; i < 40; i++) await Promise.resolve();
  check(g.clicks() === c0 + 1, '真断了就当场点一次讲解(不等一个间隔)');
  check(g.api.state.round === r0 + 1, '补讲成功会计一轮');
  check(g.api.state.phase === 'run', '补讲成功后回正常倒计时');
  check(g.api.state.on === true, '补讲成功后循环仍在跑');

  /* ---------- ⑤ 重定位配额是滑窗,不是计时器 ---------- */
  const q = setup({}); q.api.apply({ autoLoopLecture: true }); await flush();
  const t0 = q.now();
  q.api.state.relocLog = [];
  check(q.api.relocAllowed(t0) === true, '滑窗内没用过 ⇒ 允许重定位');
  q.api.state.relocLog = [t0];
  check(q.api.relocAllowed(t0 + 1000) === false, '5 分钟内已用 1 次 ⇒ 拒绝第二次');
  check(q.api.relocAllowed(t0 + 299000) === false, '4 分 59 秒时仍然拒绝');
  check(q.api.relocAllowed(t0 + 301000) === true, '窗口滑过后又能用(证明不是靠计时器归零)');
  /* 抖动场景:接了又断、断了又接,每次恢复都不能把配额刷回可用 */
  q.api.state.relocLog = [t0];
  check(q.api.relocAllowed(t0 + 120000) === false, '恢复后 2 分钟想再搜 ⇒ 仍然被配额挡住');

  /* ---------- ⑥ 补讲没确认 ⇒ 30 秒冷却 ---------- */
  const h = await ready({ dybAutoLoopSeconds: 15, dybAutoLoopGroup: 'sec', dybAutoLoopEnabled: false }, true);
  await toVigil(h);
  h.mount(true);
  h.row.dataset.live = '0'; h.button.textContent = '讲解';
  h.w.__clickHook = () => {};                        // 点了界面不翻(平台没响应)
  h.advance(31000);
  /* 直接驱动一次补讲:这一路要连点 4 次、每次等满 5 秒观察窗,
   * 走 vigilTick 的异步尾巴(不 await)在测试里数不清拍子。 */
  await h.api.doVigilResume(h.button);
  check(h.api.state.resumeFails >= 1, '补讲没确认会记一次失败');
  check(h.api.state.resumeAt > h.now(), '记下冷却截止时刻');
  const cAfterFail = h.clicks();
  h.advance(2000);
  h.api.vigilTick(); await flush();
  check(h.clicks() === cAfterFail, '冷却期内探针不再点(防止 5 秒一次连点把页面占住)');
  h.w.__clickHook = null;

  /* ---------- ⑦ 30 分钟兜底 + 关开关即停 ---------- */
  const d = await ready({ dybAutoLoopSeconds: 15, dybAutoLoopGroup: 'sec', dybAutoLoopEnabled: false }, true);
  await toVigil(d);
  d.api.state.lastBtnSeen = d.now() - 1800001;       // 30 分钟没见过任何讲解按钮
  d.api.vigilTick(); await flush();
  check(d.api.state.on === false, '连续 30 分钟没有可讲解的商品 ⇒ 真停');
  check(/30 分钟/.test(d.api.state.status ? d.api.state.status.text : ''), '停下来时说清是 30 分钟没见到按钮');

  const e = await ready({ dybAutoLoopSeconds: 15, dybAutoLoopGroup: 'sec', dybAutoLoopEnabled: false }, true);
  await toVigil(e);
  check(e.api.state.phase === 'vigil', '前置:确实在守夜');
  e.api.setInfinite(false, true); await flush();
  check(e.api.state.on === false, '关掉无限模式时若正在守夜 ⇒ 立刻按旧规则停表');
  check(e.store.dybAutoLoopInfinite === false, '关闭状态写进存储(下次打开仍是关)');

  /* ---------- 附加:抖动抑制,60 秒内二次进守夜不重新加密 ---------- */
  const j = setup({}); j.api.apply({ autoLoopLecture: true }); await flush();
  j.api.state.on = true;
  j.api.state.vigilLeft = 0; j.api.state.vigilAt = 0;
  j.api.enterVigil('首次断开');
  check(j.api.probeGap() === 5000, '首次进守夜:5 秒加密确认');
  j.api.state.phase = 'wait';
  j.api.state.vigilLeft = j.now() - 10000;           // 10 秒前刚退出
  j.api.enterVigil('抖动二次进入');
  check(j.api.probeGap() === 15000, '60 秒内二次进守夜:从 15 秒起(不重复 5 秒密集探)');

  /* ---------- 附加:守夜期用户亲手点「取消讲解」⇒ 复核确认后**转待命**(不停表) ----------
   * 2026-11-08 用户定:「点了取消讲解不应该停,而是保持等待下一个讲解的品开始讲解才继续跟进」。 */
  const k = await ready({ dybAutoLoopSeconds: 15, dybAutoLoopGroup: 'sec', dybAutoLoopEnabled: false }, true);
  await toVigil(k);
  k.mount(true);
  k.row.dataset.live = '1'; k.button.textContent = '取消讲解';
  k.api.userCancel({ isTrusted: true, target: k.button });
  await flush();
  check(k.api.state.on === true, '点击当场不停表(等 800ms 复核讲解标记)');
  k.button.textContent = '讲解'; k.row.dataset.live = '0';   // 平台翻了按钮、讲解标记消失 = 真被取消
  k.runTimeout(s => s.indexOf('isLecturing') >= 0); await flush();
  check(k.api.state.on === true, '复核确认后也不停表(旧行为是 setOn(false) 硬停)');
  check(k.api.state.phase === 'vigil' && k.api.state.passive === 1, '转成待命跟随(passive),不是普通守夜');
  check(k.ui('.slot').textContent === '待命中', '胶囊槽显示「待命中」(3 字,宽度不变)');
  check(/待命中/.test(k.ui('.r3').textContent), '第三行写明待命中');
  check(k.ui('.r3').textContent.indexOf('补讲') < 0, '待命不显示补讲计数(它压根不会去点)');
  /* 误触:点击后该行标记没消失(按钮还是取消讲解) ⇒ 判误触,继续循环 */
  const k3 = await ready({ dybAutoLoopSeconds: 15, dybAutoLoopGroup: 'sec', dybAutoLoopEnabled: false }, true);
  await toVigil(k3);
  k3.mount(true);
  k3.row.dataset.live = '1'; k3.button.textContent = '取消讲解';
  k3.api.userCancel({ isTrusted: true, target: k3.button });
  k3.runTimeout(s => s.indexOf('isLecturing') >= 0); await flush();
  check(k3.api.state.on === true, '复核时该行仍在讲解中 ⇒ 判误触,不停表');
  /* 反过来:非真人的合成点击不许把循环停掉(自动刷新会派发这种点击) */
  const k2 = await ready({ dybAutoLoopSeconds: 15, dybAutoLoopGroup: 'sec', dybAutoLoopEnabled: false }, true);
  await toVigil(k2);
  k2.mount(true);
  k2.row.dataset.live = '1'; k2.button.textContent = '取消讲解';
  k2.api.userCancel({ isTrusted: false, target: k2.button });
  k2.runTimeout(s => s.indexOf('isLecturing') >= 0); await flush();
  check(k2.api.state.on === true, '合成点击不会停表(只认真人手势)');

  /* ---------- ⑧ 待命跟随:不补讲 / 等下一个品 / 30 分钟兜底 ---------- */
  /* ⑧-1 待命期按钮翻回「讲解」也不点 —— 那正是用户刚关掉的东西 */
  const cBefore = k.clicks();
  k.advance(31000);
  k.api.vigilTick(); await flush();
  check(k.clicks() === cBefore, '待命期绝不点「讲解」(不能把用户刚取消的讲解又点开)');
  check(k.api.state.phase === 'vigil' && k.api.state.passive === 1, '没品在讲就继续待着');

  /* ⑧-2 出现另一个品在讲 ⇒ 接管为新目标,回正常倒计时 */
  const rBefore = k.api.state.round;
  const other = k.w.__fixture.addRow('id:8888888888888888888', '新品甲', '1');
  k.advance(31000);
  k.api.vigilTick(); await flush();
  check(k.api.state.phase === 'run', '发现别的品在讲 ⇒ 立刻接管,回倒计时');
  check(k.api.state.key === other.dataset.key, '新目标就是那条在讲的商品');
  check(k.api.state.product === '新品甲', '商品名跟着换');
  check(k.api.state.round === rBefore + 1, '接上算一轮');
  check(k.api.state.passive === 0, '接管后清掉待命标记(恢复正常的续讲能力)');
  check(k.api.state.on === true, '接管全程没改变开关状态');

  /* ⑧-3 30 分钟兜底:判据是「距上一次循环真介入」,不是「看见过按钮」 */
  const pw = await ready({ dybAutoLoopSeconds: 15, dybAutoLoopGroup: 'sec', dybAutoLoopEnabled: false }, true);
  pw.mount(true);
  pw.row.dataset.live = '1'; pw.button.textContent = '取消讲解';
  pw.api.userCancel({ isTrusted: true, target: pw.button });
  pw.button.textContent = '讲解'; pw.row.dataset.live = '0';
  pw.runTimeout(s => s.indexOf('isLecturing') >= 0); await flush();
  check(pw.api.state.passive === 1, '前置:已进待命');
  /* 待命期页面一直有「讲解」按钮(列表还在),但没有任何品在讲 —— 旧判据(lastBtnSeen)会永不停 */
  pw.api.state.lastShotAt = pw.now() - 1800001;
  pw.advance(31000);
  pw.api.vigilTick(); await flush();
  check(pw.api.state.on === false, '超过 30 分钟没有新的讲解 ⇒ 真停(用户 2026-11-08 认可)');
  check(/30 分钟/.test(pw.api.state.status ? pw.api.state.status.text : ''), '停下来时说清是 30 分钟');

  /* ⑧-4 待命不进重定位:不滚屏、不搜索 */
  const pr = await ready({ dybAutoLoopSeconds: 15, dybAutoLoopGroup: 'sec', dybAutoLoopEnabled: false }, true);
  pr.mount(true);
  pr.row.dataset.live = '1'; pr.button.textContent = '取消讲解';
  pr.api.userCancel({ isTrusted: true, target: pr.button });
  pr.button.textContent = '讲解'; pr.row.dataset.live = '0';
  pr.runTimeout(s => s.indexOf('isLecturing') >= 0); await flush();
  pr.api.state.relocAt = 0;                          // 重定位窗口全开
  pr.api.state.relocLog = [];
  pr.advance(31000);
  pr.api.vigilTick(); await flush();
  check(pr.api.state.relocLog.length === 0, '待命拍不触发重定位(不抢用户的页面)');

  for (const fixture of [on, remembered, offStore, asNum, off, f, g, q, h, d, e, j, k, k2, k3, pw, pr]) fixture.dom.window.close();
  console.log('无限循环模式自测:' + passed + '/' + passed + ' 通过');
})().catch(e => { console.error(e); process.exit(1); });
