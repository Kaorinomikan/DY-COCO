/** 用户反馈 #134/#135：真实执行链换品、找回旧行复核及开播福袋。 */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const SRC_UNDER_TEST = ['src/live/auto-loop-lecture.js', 'src/content/live-state.js', 'src/live/lucky-bag.js'];
const lecture = fs.readFileSync(path.join(__dirname, '..', SRC_UNDER_TEST[0]), 'utf8');
const liveState = fs.readFileSync(path.join(__dirname, '..', SRC_UNDER_TEST[1]), 'utf8');
const B = require('./福袋自测公共.js');
async function flush() { for (let i = 0; i < 40; i++) await Promise.resolve(); }
function setup(group) {
  const dom = new JSDOM('<body></body>', { url: 'https://example.com', runScripts: 'outside-only' });
  const w = dom.window;
  let now = 1000000;
  const store = { dybAutoLoopGroup: group, dybAutoLoopInfinite: true, dybAutoLoopEnabled: false };
  const clicks = [];
  w.Date.now = () => now;
  w.setInterval = w.setTimeout = () => 1;
  w.clearInterval = w.clearTimeout = () => {};
  w.requestAnimationFrame = () => 0;
  w.chrome = { storage: { local: { get: async () => store, set: async o => Object.assign(store, o) } } };
  w.__fixture = {
    rows: [],
    click: b => { clicks.push(b.closest('[data-key]').dataset.key); b.textContent = b.textContent === '讲解' ? '取消讲解' : '讲解'; },
    sleep: async ms => { now += ms; if (w.__sleepHook) w.__sleepHook(); }
  };
  const hook = `
    rows=function(){return window.__fixture.rows.filter(function(r){return r.isConnected;});};
    rowKey=function(r){return r.dataset.key;};rowName=function(r){return r.dataset.name;};
    findRowByKey=function(){return rows().find(function(r){return rowKey(r)===state.key;})||null;};
    findRowByName=function(n){return rows().find(function(r){return rowName(r)===n;})||null;};
    findLectureBtn=function(r){return r.querySelector('button');};
    clickable=function(b){return !!b&&b.isConnected&&!b.disabled;};
    isLecturing=function(r){return !!r&&r.isConnected&&kindOf(findLectureBtn(r))==='stop';};
    findLiveRow=function(){return rows().find(isLecturing)||null;};
    fireClick=window.__fixture.click;sleep=nap=window.__fixture.sleep;
    recordRowAnchor=function(){return null;};place=function(){};
    fastHop=probeAnchor=function(){return window.__hop?window.__hop():null;};
    locateBySearch=revealRow=function(){return null;};
    window.__test={state:state,apply:apply,setOn:setOn,checkNow:checkNow,
      fast:doFastCycle,slow:doCycle,vigil:vigilTick,enter:enterVigil};
  `;
  w.eval(lecture.replace('  boot();', hook));
  function add(key, active) {
    const r = w.document.createElement('div'); r.dataset.key = key; r.dataset.name = key;
    r.innerHTML = '<button>' + (active ? '取消讲解' : '讲解') + '</button>';
    w.document.body.appendChild(r); w.__fixture.rows.push(r); return r;
  }
  return { w, dom, api: w.__test, add, clicks, advance: ms => { now += ms; } };
}
(async () => {
  let failed = 0, passed = 0;
  async function test(name, fn) {
    try { await fn(); passed++; console.log('✓ ' + name); }
    catch (e) { failed++; console.log('✗ ' + name + ': ' + e.message); }
  }
  for (const group of ['sec', 'min']) {
    await test(group + '：旧商品未讲解、新商品在讲，执行前切目标且不点旧品', async () => {
      const f = setup(group);
      try {
        const old = f.add('old', true);
        f.api.apply({ autoLoopLecture: true }); await flush(); f.api.setOn(true, true); await flush();
        old.querySelector('button').textContent = '讲解';
        f.add('new', true);
        await (group === 'sec' ? f.api.fast() : f.api.slow(false));
        assert.equal(f.api.state.key, 'new'); assert.equal(f.clicks.length, 0);
      } finally { f.dom.window.close(); }
    });
    await test(group + '：记忆找回的旧商品已未讲解，进入待命不重开', async () => {
      const f = setup(group);
      try {
        const old = f.add('old', true);
        f.api.apply({ autoLoopLecture: true }); await flush(); f.api.setOn(true, true); await flush();
        old.querySelector('button').textContent = '讲解';
        await (group === 'sec' ? f.api.fast() : f.api.slow(false));
        assert.equal(f.clicks.length, 0); assert.equal(f.api.state.passive, 1);
        old.remove(); f.add('new', true); f.advance(12000); f.api.checkNow(); await flush();
        assert.equal(f.api.state.key, 'new'); assert.equal(f.api.state.phase, 'run');
      } finally { f.dom.window.close(); }
    });
    await test(group + '：搜索期间出现新品讲解，放弃旧品', async () => {
      const f = setup(group);
      try {
        const old = f.add('old', true);
        f.api.apply({ autoLoopLecture: true }); await flush(); f.api.setOn(true, true); await flush();
        old.remove(); old.querySelector('button').textContent = '讲解';
        f.w.__hop = async () => { f.add('new', true); f.w.document.body.appendChild(old); return { row: old }; };
        await (group === 'sec' ? f.api.fast() : f.api.slow(false));
        assert.equal(f.api.state.key, 'new'); assert.equal(f.clicks.length, 0);
      } finally { f.dom.window.close(); }
    });
    await test(group + '：取消后等待续讲期间换品，旧链不得把旧品再点开', async () => {
      const f = setup(group);
      try {
        f.add('old', true);
        f.api.apply({ autoLoopLecture: true }); await flush(); f.api.setOn(true, true); await flush();
        f.w.__sleepHook = () => { if (f.w.__fixture.rows.length === 1) f.add('new', true); };
        await (group === 'sec' ? f.api.fast() : f.api.slow(false));
        assert.equal(f.api.state.key, 'new'); assert.deepEqual(f.clicks, ['old']);
        assert.equal(f.api.state.fails, 0); assert.equal(f.api.state.owedResume, 0);
      } finally { f.dom.window.close(); }
    });
  }
  await test('仅商品讲解信号：未开播→开播能打开自动福袋闸门', async () => {
    const f = await B.bootBagPage(null, { live: 'off' });
    try {
      f.api.setAutoForTest(true); f.api.tick(); assert.equal(f.api.liveGate(), false);
      f.doc.getElementById('liveTag').remove();
      f.doc.body.insertAdjacentHTML('beforeend', '<div data-rbd-draggable-id="123"><span>商品甲</span><button>取消讲解</button></div>');
      f.win.dycLiveState.invalidate(); f.api.tick();
      assert.equal(f.api.liveState(), 'live'); assert.equal(f.api.liveGate(), true);
      f.api.confirmNow();
      assert.ok(await B.waitBag(() => f.clicks.entry > 0, 1000));
    } finally { f.win.close(); }
  });
  await test('手动福袋结束后，自动开关仍开着，按间隔续发且不双开', async () => {
    const f = await B.boot({ live: 'off', onStartClick: 'runningTimed' });
    try {
      let offset = 0; f.win.Date.now = () => Date.now() + offset;
      f.api.setTimingForTest({ precheck: 20 });
      f.doc.getElementById('liveTag').remove();
      f.doc.body.insertAdjacentHTML('beforeend', '<div data-rbd-draggable-id="123"><button>取消讲解</button></div>');
      f.win.dycLiveState.invalidate(); f.api.setAutoForTest(true); f.api.setGapSec(30);
      f.api.manualStart();
      assert.ok(await B.waitBag(() => f.clicks.s1 === 1, 6000), '手动先发一轮');
      f.api.tick();
      assert.equal(f.api.snapshot().phase, 'live');
      assert.equal(f.api.liveGate(), true);
      f.api.tick(); assert.equal(f.clicks.s1, 1, '进行中不重复发');
      // 平台已结束并重新提供候选；时钟走过本轮倒计时、设置间隔及收尾冷却。
      offset += 8 * 60000 + 31000;
      f.doc.getElementById('st1').textContent = '● 活动已结束';
      f.win.dycLiveState.invalidate(); f.api.tick();
      f.doc.getElementById('st1').innerHTML = '● 活动待开始 <a id="s2">开始活动</a>';
      let auto = 0;
      f.doc.getElementById('s2').addEventListener('click', () => { auto++; });
      f.win.dycLiveState.invalidate(); f.api.tick();
      assert.equal(auto, 1, '到期后自动接续');
    } finally { f.win.close(); }
  });
  await test('讲解信号不能来自扩展、商品名、隐藏控件或普通待讲解按钮', async () => {
    const dom = new JSDOM('<body></body>', { runScripts: 'outside-only' });
    try {
      const w = dom.window;
      w.Element.prototype.getBoundingClientRect = function () {
        return { width: this.hasAttribute('hidden') ? 0 : 80, height: 28 };
      };
      w.eval(liveState);
      for (const html of [
        '<div data-rbd-draggable-id="1"><button>讲解</button></div>',
        '<div data-rbd-draggable-id="1"><span>讲解中同款裙子</span></div>',
        '<div id="dyc-injected"><div data-rbd-draggable-id="1"><button>取消讲解</button></div></div>',
        '<div data-rbd-draggable-id="1"><button hidden>取消讲解</button></div>',
        '<div><button>取消讲解</button></div>'
      ]) {
        w.document.body.innerHTML = html; w.dycLiveState.reset();
        assert.equal(w.dycLiveState.judge(true), 'unknown', html);
      }
      for (const label of ['取消讲解', '结束讲解', '停止讲解', '讲解中', '正在讲解', '弹出讲解卡', '弹起讲解卡']) {
        w.document.body.innerHTML = '<div data-rbd-draggable-id="1"><button><span>' + label + '</span></button></div>';
        w.dycLiveState.reset(); assert.equal(w.dycLiveState.judge(true), 'live', label);
      }
    } finally { dom.window.close(); }
  });
  console.log('反馈恢复自测：通过 ' + passed + '，失败 ' + failed);
  process.exitCode = failed ? 1 : 0;
})().catch(e => { console.error(e); process.exitCode = 1; });
