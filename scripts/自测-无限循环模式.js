/**
 * 自测 · 自动循环讲解的无限模式(守夜 + 重定位配额)
 * ============================================================
 * 跑法:node scripts/自测-无限循环模式.js
 *
 * 覆盖用户 2026-11-05 定的七条口径:
 *   ① 无限模式默认关闭、开关值有记忆(刷新后恢复)
 *   ② 关闭时三轮找不到仍然停表(旧行为一字不变)
 *   ③ 开启时同一场景不停表,转 phase='vigil',胶囊显示「守候中」
 *   ④ 守夜探针三种结局:还在讲 ⇒ 回计时不点;真断了 ⇒ 当拍补讲;行不在 ⇒ 继续守
 *   ⑤ 重定位走 5 分钟滑窗配额,不是「距上次计时」
 *   ⑥ 补讲没确认 ⇒ 30 秒冷却,冷却期内不许再点
 *   ⑦ 30 分钟一个「讲解」按钮都找不到才真停;关掉无限模式时若在守夜也立刻停
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
  w.setTimeout = () => ++timerId;
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
    row: () => (mounted ? row : null),
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
  rows = function(){var r=window.__fixture.row();return r?[r]:[];};
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
  /* ---------- ① 默认关闭 + 记忆 ---------- */
  const on = setup({}); on.api.apply({ autoLoopLecture: true }); await flush();
  check(on.api.state.infinite === false, '没存过就是关(默认关闭)');

  const remembered = setup({ dybAutoLoopInfinite: true }); remembered.api.apply({ autoLoopLecture: true }); await flush();
  check(remembered.api.state.infinite === true, '存过 true 就恢复成开(有记忆)');

  const asNum = setup({ dybAutoLoopInfinite: 1 }); asNum.api.apply({ autoLoopLecture: true }); await flush();
  check(asNum.api.state.infinite === false, '非布尔值不当成开(只认真正的 true)');

  /* ---------- ② 无限关:三轮找不到仍然停表 ---------- */
  const off = await ready({ dybAutoLoopSeconds: 15, dybAutoLoopGroup: 'sec', dybAutoLoopEnabled: false }, false);
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
  check(f.ui('.inf-mark').hidden === false, '收起态胶囊上出现 ∞ 角标');
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

  /* ---------- 附加:守夜期用户亲手点「取消讲解」⇒ 立刻停 ---------- */
  const k = await ready({ dybAutoLoopSeconds: 15, dybAutoLoopGroup: 'sec', dybAutoLoopEnabled: false }, true);
  await toVigil(k);
  k.mount(true);
  k.row.dataset.live = '1'; k.button.textContent = '取消讲解';
  k.api.userCancel({ isTrusted: true, target: k.button });
  await flush();
  check(k.api.state.on === false, '守夜期用户手动取消 ⇒ 立刻停表');
  check(k.api.state.phase !== 'vigil', '停表后不再留在守夜态');
  /* 反过来:非真人的合成点击不许把循环停掉(自动刷新会派发这种点击) */
  const k2 = await ready({ dybAutoLoopSeconds: 15, dybAutoLoopGroup: 'sec', dybAutoLoopEnabled: false }, true);
  await toVigil(k2);
  k2.mount(true);
  k2.row.dataset.live = '1'; k2.button.textContent = '取消讲解';
  k2.api.userCancel({ isTrusted: false, target: k2.button });
  await flush();
  check(k2.api.state.on === true, '合成点击不会停表(只认真人手势)');

  for (const fixture of [on, remembered, asNum, off, f, g, q, h, d, e, j, k, k2]) fixture.dom.window.close();
  console.log('无限循环模式自测:' + passed + '/' + passed + ' 通过');
})().catch(e => { console.error(e); process.exit(1); });
