/** 真实源码行为回归:两框互斥、秒档四档、跨重启记忆、停止令牌与秒档短执行链(2026-10-30 新口径)。 */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const source = fs.readFileSync(path.resolve(__dirname, '../src/live/auto-loop-lecture.js'), 'utf8');
let passed = 0;
function check(value, label) { assert.ok(value, label); passed++; }
async function flush() { for (let n=0;n<35;n++) await Promise.resolve(); }
function setup(store = {}, extraHook = '') {
  /* ★ 2026-11-08:本套件回归的是「关掉无限模式」时的旧行为(熔断即停)。
   *   无限模式(守夜/待命)默认改为开之后,这里统一钉成显式关 ——
   *   否则每条用例都在跑新默认,断言口径就串了。待命/守夜另有一套
   *   `自测-无限循环模式.js` 专门覆盖。 */
  store = Object.assign({ dybAutoLoopInfinite: false }, store);
  const dom = new JSDOM('<body></body>', {url:'https://example.com/not-live',runScripts:'outside-only'});
  const w = dom.window, timers = new Map();
  let now = 1000000, timerId=0, mounted=true, clicks=0;
  const row=w.document.createElement('div'); row.dataset.key='id:1234567890123456789';row.dataset.name='当前讲解商品';row.dataset.live='1';
  const button=w.document.createElement('button');button.textContent='取消讲解';row.appendChild(button);w.document.body.appendChild(row);
  w.Date.now=()=>now;
  w.setInterval=fn=>{timers.set(++timerId,fn);return timerId;};w.clearInterval=id=>timers.delete(id);
  w.setTimeout=()=>++timerId;w.clearTimeout=()=>{};
  w.requestAnimationFrame=()=>0;w.cancelAnimationFrame=()=>{};
  const notes=[];
  w.setStatus=(...args)=>notes.push(args);
  // 放行钩子:jsdom 里 isTrusted 恒为 false 且不可改写,带 __real 的才算真人手势
  w.__dycTestTrusted=function (e) { return !!(e && e.__real); };
  w.chrome={storage:{local:{
    get:async keys=>Object.fromEntries((Array.isArray(keys)?keys:[keys]).map(k=>[k,store[k]])),
    set:async data=>Object.assign(store,data)
  }}};
  w.__fixture={
    row:()=>mounted?row:null,
    click:el=>{clicks++;if(w.__clickHook)w.__clickHook(el);else {row.dataset.live=row.dataset.live==='1'?'0':'1';el.textContent=row.dataset.live==='1'?'取消讲解':'讲解';}},
    sleep:ms=>{now+=ms;if(w.__sleepHook)w.__sleepHook();return Promise.resolve();}
  };
  const hook=`
  window.__orig={findLectureBtn:findLectureBtn,findBtnByKind:findBtnByKind};
  findLiveRow = function(){var r=window.__fixture.row();return r&&r.dataset.live==='1'?r:null;};
  findRowByKey = function(){var r=window.__fixture.row();return r&&r.dataset.key===state.key?r:null;};
  rowKey = function(r){return r.dataset.key;}; rowName=function(r){return r.dataset.name;};
  isLecturing=function(r){return r.dataset.live==='1';};findLectureBtn=function(r){return r.querySelector('button');};
  clickable=function(b){return !!b&&!b.disabled;};fireClick=window.__fixture.click;sleep=window.__fixture.sleep;
  findCartPanel=function(){return document.body;};recordRowAnchor=function(){return null;};
  place=function(){if(refs.panel)refs.panel.classList.toggle('open',panelOpen);};
  probeAnchor=locateBySearch=revealRow=function(){throw Error('秒档不允许搜索或滚动');};
  window.__test={state:state,apply:apply,start:start,setOn:setOn,setGroup:setGroup,saveSeconds:saveSeconds,
    checkNow:checkNow,doFastCycle:doFastCycle,doCycle:doCycle,flushWrites:function(){return settingsWrite;},
    advance:function(ms){state.nextAt=Date.now()+ms;},slider:slider,
    setCheckMin:setCheckMin,
    paintReadout:paintReadout,setDragValue:function(fn){valueAt=fn;}};
`;
  assert.ok(source.includes('  boot();'));
  w.eval(fs.readFileSync(path.resolve(__dirname, '../src/content/flags.js'), 'utf8'));
  w.eval(source.replace('  boot();', hook + extraHook));
  /* 2026-11-10:源码新增「检查最小间隔 150ms」(多源合并)。本套件在同一时刻连续
   * 调 checkNow / setOn 验证行为语义,时间不前进 ⇒ 会被合并闸吞掉。这里关掉它。 */
  w.__test.setCheckMin(0);
  return {dom,w,api:w.__test,store,notes,row,button,timers,
    mount:value=>{mounted=value;},clicks:()=>clicks,now:()=>now,advance:ms=>{now+=ms;},
    ui:selector=>w.document.getElementById('dyc-auto-loop-host').shadowRoot.querySelector(selector)};
}

(async()=>{
  const f=setup({dybAutoLoopMinutes:8.5,dybAutoLoopSeconds:45,dybAutoLoopGroup:'sec',dybAutoLoopEnabled:false});
  f.api.apply({autoLoopLecture:true});await flush();
  check(!f.api.state.on&&f.api.state.group==='sec'&&f.api.state.seconds===45&&f.api.state.minutes===8.5,'停止状态、组与两个间隔均恢复');
  check(!f.ui('.sw')&&f.ui('.power').textContent==='开启','面板没有右上角开关，启停位常驻胶囊末端');
  check(!f.ui('.gh .gx'),'两档标题不再显示重复的右上角间隔注释');
  for (const seconds of [15,30,45,60]) {
    f.ui('.sg[data-sec="'+seconds+'"]').click();await flush();
    check(f.ui('.r1 b').textContent===(seconds-3)+'~'+seconds+' 秒','底部读数显示 '+seconds+' 档实际范围');
  }
  f.ui('.sg[data-sec="45"]').click();await flush();
  f.ui('.power').click();await flush();
  const d45=f.api.state.nextAt-f.now(); /* 2026-11-01:四档统一 (档位−3) 秒 + 0~3 秒随机,45 档 = 42~45 秒 */
  check(f.api.state.on&&d45>=42000&&d45<=45000,'手动开启先识别当前商品，等待完整间隔(45 档 42~45 秒随机)');
  const deadline=f.api.state.nextAt;
  f.ui('.cap-main').click();f.ui('.cap-main').click();
  check(f.api.state.on&&f.api.state.nextAt===deadline,'展开和收起只改面板，不停机、不重计');
  check(f.ui('.track').querySelectorAll('.tick')[0].style.left==='0%'&&f.ui('.track').querySelectorAll('.tick')[14].style.left==='100%','分钟轨道刻度首尾与轨道对齐');
  check(f.ui('.seg').children.length===4&&f.ui('.seg [data-sec="45"]').getAttribute('aria-pressed')==='true','秒档四按钮渲染且当前档高亮');
  check(f.ui('.ticks [data-v="3"]').style.left.startsWith('14.28'),'3 分钟推荐刻度按真实比例定位');
  const ran=f.api.doFastCycle();await ran;
  check(f.clicks()===2&&f.api.state.round===1,'秒档只取消和续讲各一次，按同一商品确认');
  const d45b=f.api.state.nextAt-f.now();
  check(d45b>=42000&&d45b<=45000&&f.api.state.nextAt>f.now(),'计时起点在成功续讲之后，间隔完整(45 档 42~45 秒)');
  f.api.saveSeconds(15);await flush();
  const d15=f.api.state.nextAt-f.now(); /* 2026-11-01:15 档实际 12~15 秒(12 秒+0~3 秒随机) */
  check(d15>=12000&&d15<=15000&&f.store.dybAutoLoopSeconds===15,'改档重新计时并保存(15 档按 12~15 秒随机)');
  f.ui('.power').click();await flush();f.advance(100000);f.api.checkNow();
  check(!f.api.state.on&&f.store.dybAutoLoopEnabled===false&&f.clicks()===2,'点击停止立即生效且观察器不能自动恢复');
  f.api.setGroup('min');await flush();
  check(f.api.state.group==='min'&&f.api.state.minutes===8.5&&f.api.state.seconds===15,'切组互斥且分别保留各自间隔');
  check([...f.ui('.track').querySelectorAll('.tick.rec')].some(e=>e.style.left==='50%'),'8 分钟推荐刻度保持50%位置');
  check(!/讲解回放|自动切片/.test(f.ui('.readout').textContent),'下方提示没有平台效果假设');
  f.api.setGroup('sec');f.api.setOn(true,true);await flush();
  f.mount(false);
  /* 2026-11-01 nap7:熔断门槛 2 → 3。跳过只剩「找不到行」一种来源
   * (「商品已停止讲解」已改走停表/补讲),3 次给重渲染抖动留足余量。
   * 第 1、2 轮只记跳过;第 3 轮是最后一轮,若这一行有商品 ID 会先做一次搜索兜底,
   * 本例的行没有 ID ⇒ 兜底不触发,第 3 轮直接熔断。 */
  await f.api.doFastCycle();await flush();
  check(f.api.state.on&&f.api.state.skips===1&&f.clicks()===2,'第 1 轮未找到只记跳过，不点击不搜索不滚动');
  await f.api.doFastCycle();await flush();
  check(f.api.state.on&&f.api.state.skips===2&&f.clicks()===2,'第 2 轮未找到仍只记跳过(门槛已放宽到 3)');
  await f.api.doFastCycle();await flush();
  check(!f.api.state.on&&f.clicks()===2,'第 3 轮未找到即熔断停止');
  f.mount(true);f.api.checkNow();check(!f.api.state.on,'商品重新出现仍等待手动开启');
  /* ★ 2026-11-12 用户定(选项 2)：「后台不做取消。」
     旧版后台是「看见在讲 ⇒ 点取消 → 等界面刷回「讲解」→ 再点讲」，
     可隐藏标签里平台要 16~31 秒才刷回来，这段商品一直空着 —— 用户看到的
     就是"切后台只取消、不继续讲解"。现在后台**根本不发起取消**：
     有「弹出讲解卡」就点弹卡，没有就什么都不做，留到回前台再做完整一轮。
     这条用例跑冻结期：断言一次按钮都不点（包括不再点取消）。 */
  const bg=setup({dybAutoLoopSeconds:15,dybAutoLoopGroup:'sec',dybAutoLoopEnabled:false});
  bg.api.apply({autoLoopLecture:true});await flush();
  bg.api.setOn(true,true);await flush();
  try { Object.defineProperty(bg.w.document,'visibilityState',{value:'hidden',configurable:true}); } catch(e) { /* 忽略 */ }
  const seq=[];
  bg.w.__clickHook=el=>{ seq.push(el.textContent); };   // 冻结:点了界面不翻
  for(let i=0;i<3;i++){await bg.api.doFastCycle();await flush();}
  check(seq.length===0,'后台在讲且没有「弹出讲解卡」⇒ 一次都不点(不再发起取消)');
  check(bg.api.state.on,'盲模式推进全程不停表');
  /* 回到前台、商品仍在讲 ⇒ 前台按正常节奏做一轮(取消 → 续讲都做),不再受后台口径影响。 */
  try { Object.defineProperty(bg.w.document,'visibilityState',{value:'visible',configurable:true}); } catch(e) { /* 忽略 */ }
  bg.row.dataset.live='1';bg.button.textContent='取消讲解';
  bg.advance(4000);                                     // 越过回到前台那 2.5 秒静默期
  await bg.api.doFastCycle();await flush();
  check(seq[seq.length-1]==='取消讲解','回前台后照旧做完整一轮(取消→续讲),后台口径不外溢');
  /* 最坏情况:DOM 全程冻结(标签页被系统挂起 / DOM 永不更新)。
     nap9 的立场是**永不停表** —— 用户切后台就是为了让它继续跑,
     宁可这一轮空转,也不能自己退出(切回来立刻能恢复)。 */
  const frozenAll=setup({dybAutoLoopSeconds:15,dybAutoLoopGroup:'sec',dybAutoLoopEnabled:false});
  frozenAll.api.apply({autoLoopLecture:true});await flush();
  frozenAll.api.setOn(true,true);await flush();
  try { Object.defineProperty(frozenAll.w.document,'visibilityState',{value:'hidden',configurable:true}); } catch(e) { /* 忽略 */ }
  frozenAll.w.__clickHook=()=>{};          // 点了界面永不翻
  for(let i=0;i<12;i++){await frozenAll.api.doFastCycle();await flush();}
  check(frozenAll.api.state.on,'DOM 全程冻结也不得自行停表(nap9:后台没有停表出口)');
  /* ★ 2026-11-12 选项 2 的核心路径：后台有「弹出讲解卡」⇒ 只点它，绝不取消。
     弹卡不需要取消，也就没有"等界面刷回来"的空窗，这是后台唯一该做的动作。 */
  const popOnly=setup({dybAutoLoopSeconds:15,dybAutoLoopGroup:'sec',dybAutoLoopEnabled:false},
    'findPopBtn=function(r){return r.querySelector("[data-pop]")||null;};');
  popOnly.api.apply({autoLoopLecture:true});await flush();
  popOnly.api.setOn(true,true);await flush();
  const popBtn=popOnly.w.document.createElement('button');
  popBtn.setAttribute('data-pop','1');popBtn.textContent='弹出讲解卡';
  popOnly.row.appendChild(popBtn);
  try { Object.defineProperty(popOnly.w.document,'visibilityState',{value:'hidden',configurable:true}); } catch(e) { /* 忽略 */ }
  const seq3=[];
  popOnly.w.__clickHook=el=>{ seq3.push(el.textContent); };
  for(let i=0;i<3;i++){await popOnly.api.doFastCycle();await flush();}
  check(seq3.length>=1&&seq3.every(t=>t==='弹出讲解卡'),
    '后台在讲 ⇒ 只点「弹出讲解卡」,一次「取消讲解」都不发(这一轮点了:'+seq3.join('/')+')');
  /* 冻结期还有一种怪现场:行标记说"在讲",但那枚按钮写的是「讲解」。
     旧写法 `findStopBtn(row) || findLectureBtn(row)` 会点它 —— 先开讲再记一笔取消账,
     下一拍又补讲一次(双重点击)。开新一轮必须只认取消态。 */
  const mixed=setup({dybAutoLoopSeconds:15,dybAutoLoopGroup:'sec',dybAutoLoopEnabled:false});
  mixed.api.apply({autoLoopLecture:true});await flush();
  mixed.api.setOn(true,true);await flush();
  try { Object.defineProperty(mixed.w.document,'visibilityState',{value:'hidden',configurable:true}); } catch(e) { /* 忽略 */ }
  const seq4=[];
  mixed.w.__clickHook=el=>{ seq4.push(el.textContent); };
  mixed.button.textContent='讲解';        // 标记说在讲,按钮却是"开始讲解"
  await mixed.api.doFastCycle();await flush();
  check(seq4.length===0,'界面报在讲但按钮写「讲解」时不乱点(开新一轮只认取消态)');
  /* ★ 2026-11-12 用户实机:「在后台点刷新列表没用,生效不了」——
     盲模式里不许再出现"点刷新列表催平台"这条无效动作(它是隐藏标签里的死路)。 */
  check(!/fireClick\(rf/.test(source) && !/盲模式:.*催.*刷新/.test(source),
    '盲模式不再点「刷新列表」催平台(后台点它不生效,用户 2026-11-12 实机确认)');
  /* ★ 2026-11-12:切回前台的头一拍不能立刻动手 —— 隐藏标签的 DOM 是冻结快照,
     那一拍常把"已经翻好的「讲解」"读成「取消讲解」又点一次。
     断言:后台待过之后立刻跑一拍,不许有任何点击;过了静默期必须恢复动作。 */
  const grace=setup({dybAutoLoopSeconds:15,dybAutoLoopGroup:'sec',dybAutoLoopEnabled:false});
  grace.api.apply({autoLoopLecture:true});await flush();
  grace.api.setOn(true,true);await flush();
  grace.w.__clickHook=()=>{};                        // 点了界面不翻,保持状态不变
  try { Object.defineProperty(grace.w.document,'visibilityState',{value:'hidden',configurable:true}); } catch(e) { /* 忽略 */ }
  grace.api.checkNow();await flush();                // 后台这一拍(记录"最后一次在后台")
  const beforeGrace=grace.clicks();
  try { Object.defineProperty(grace.w.document,'visibilityState',{value:'visible',configurable:true}); } catch(e) { /* 忽略 */ }
  await grace.api.doFastCycle();await flush();       // 刚回来:静默期内
  check(grace.clicks()===beforeGrace,'刚回到前台的第一拍只读不点(旧快照容易把讲解读成取消)');
  grace.advance(3000);                               // 越过静默期
  await grace.api.doFastCycle();await flush();
  check(grace.clicks()>beforeGrace,'静默期过后恢复动作,不会一直不干活');
  /* ★ 2026-11-12:账上还挂着"已发取消"(前台点完立刻切后台 / 断点续接),
     这时界面已经刷回「讲解」⇒ 下一拍必须直接补讲,不再空等一次。
     这是选项 2 之后**唯一**还走"取消后补讲"的路径,必须保证它不空转。 */
  const quick=setup({dybAutoLoopSeconds:15,dybAutoLoopGroup:'sec',dybAutoLoopEnabled:false});
  quick.api.apply({autoLoopLecture:true});await flush();
  quick.api.setOn(true,true);await flush();
  try { Object.defineProperty(quick.w.document,'visibilityState',{value:'hidden',configurable:true}); } catch(e) { /* 忽略 */ }
  const seq2=[];
  quick.w.__clickHook=el=>{ seq2.push(el.textContent); };
  quick.api.state.cancelPending=Date.now();      // 模拟"前台已点取消,随即切到后台"
  quick.api.state.owedResume=Date.now();
  quick.api.state.blindWaits=0;
  await quick.api.doFastCycle();await flush();   // 后台但按钮仍写着「取消讲解」
  check(seq2.length===0,'按钮还没翻回「讲解」⇒ 后台不点(点下去又是一次取消)');
  quick.row.dataset.live='0';quick.button.textContent='讲解'; // 平台把界面刷好
  await quick.api.doFastCycle();await flush();   // 这一拍应当直接补讲
  check(seq2.join('|')==='讲解','界面刷好后下一拍直接补讲,账本清干净');
  const restart=setup({...f.store});restart.api.apply({autoLoopLecture:true});await flush();
  check(!restart.api.state.on,'失败停止后刷新或重开仍停止');
  f.api.setOn(true,true);await flush();
  const resume=setup({...f.store});resume.api.apply({autoLoopLecture:true});await flush();
  const d15r=resume.api.state.nextAt-resume.now();
  check(resume.api.state.on&&d15r>=12000&&d15r<=15000,'上次运行中刷新后恢复，并从完整间隔开始(15 档 12~15 秒)');
  f.w.__sleepHook=()=>{f.w.__sleepHook=null;f.api.setOn(false,true);};
  await f.api.doFastCycle();await flush();
  check(f.clicks()===3&&!f.api.state.on&&!f.api.state.busy,'取消后停止能中断续讲，锁会释放');
  f.button.textContent='取消讲解';f.row.dataset.live='1';
  f.api.setOn(true,true);f.w.__clickHook=()=>{};
  await f.api.doFastCycle();await flush();
  check(f.clicks()===4&&f.api.state.on&&f.api.state.softFails===1,'取消状态未翻转时不重试点击，记一次软重试继续等（2026-11-01：状态确认类失败不烧「找不到商品」额度）');
  f.w.__clickHook=null;f.row.dataset.live='1';f.button.textContent='取消讲解';
  f.w.__sleepHook=()=>{f.w.__sleepHook=null;f.api.setGroup('min');};
  await f.api.doFastCycle();await flush();
  check(f.api.state.group==='min'&&!f.api.state.busy,'执行中切组中断旧链，锁释放');
  f.api.setGroup('sec');
  f.api.setOn(true,true);f.api.setOn(false,true);f.api.setOn(true,true);f.api.setOn(false,true);await flush();
  check(f.store.dybAutoLoopEnabled===false,'快速连续启停按最后一次停止保存');
  const race=setup({dybAutoLoopEnabled:true});race.api.apply({autoLoopLecture:true});race.api.apply({autoLoopLecture:false});await flush();
  check(!race.w.document.getElementById('dyc-auto-loop-host'),'迟到的设置读取不能越过已关闭总开关');
  race.api.apply({autoLoopLecture:true});await flush();check(race.w.document.getElementById('dyc-auto-loop-host'),'总开关重开能重新挂载');
  const defaults=setup({dybAutoLoopMinutes:6,dybAutoLoopMode:'bad',dybAutoLoopSeconds:500});defaults.api.apply({autoLoopLecture:true});await flush();
  check(defaults.api.state.on&&defaults.api.state.group==='min'&&defaults.api.state.minutes===6&&defaults.api.state.seconds===60,'旧用户分钟设置保留，非法组走迁移、秒值吸到最近档');
  /* 拖动滑条:平台刷新列表会让指针离开轨道,手势不能断;读数与存盘都要跟手 */
  const dragFix=setup({dybAutoLoopMinutes:5,dybAutoLoopSeconds:30,dybAutoLoopGroup:'sec',dybAutoLoopEnabled:false});
  dragFix.api.apply({autoLoopLecture:true});await flush();
  dragFix.api.setDragValue(function (x) { return Math.max(1, Math.min(15, (x - 100) / 20 + 1)); });
  // 真人手势:isTrusted=true(jsdom 里 dispatchEvent 默认是 false,要显式覆盖才能模拟真人)
  const ptr=function (type,x,btns) {
    const ev=new dragFix.w.MouseEvent(type,{clientX:x,bubbles:true,cancelable:true,button:0,buttons:btns===undefined?1:btns});
    ev.pointerId=1; ev.__real=true;         // 标记成真人手势(见 __dycTestTrusted)
    return ev;
  };
  dragFix.ui('.track').dispatchEvent(ptr('pointerdown',200));
  await flush();
  check(dragFix.api.state.group==='min'&&Math.abs(dragFix.api.slider.target-6)<0.01,'拖滑条即启用分钟档并跟手取值');
  const t1=dragFix.api.slider.target;
  dragFix.w.document.dispatchEvent(ptr('pointermove',350));       // 只发到 document:模拟指针已离开轨道
  await flush();
  check(dragFix.api.slider.target>t1,'指针离开轨道后仍跟手(刷新不卡断)');
  dragFix.api.slider.cur=11;dragFix.api.paintReadout();
  check(/11 分钟/.test(dragFix.ui('.readout').textContent),'读数区随滑钮实时更新');
  check(dragFix.w.__dycUserDragUntil>dragFix.now(),'拖动期间公布「有人在拖」,自动刷新本轮让路');
  /* 自动刷新每 10 秒派发的合成点击:pointerup 冒泡到 window 不能把拖动结束掉 */
  const fakeUp=new dragFix.w.MouseEvent('pointerup',{clientX:350,bubbles:true,cancelable:true,button:0,buttons:1});
  fakeUp.pointerId=1;
  dragFix.w.document.dispatchEvent(fakeUp);
  await flush();
  check(dragFix.api.state.minutes===5&&dragFix.api.state.group==='min','合成 pointerup 不结束拖动(自动刷新不再打断滑动)');
  dragFix.w.document.dispatchEvent(ptr('pointerup',350,0));
  await flush();
  check(dragFix.api.state.minutes===dragFix.api.slider.target,'松手把新的分钟值存下来');
  check(dragFix.store.dybAutoLoopGroup==='min','拖滑条后启用组写进存储');

  /* 滑条两端不出界(2026-11-02 用户截图:福袋那个滑条「拉到最左最右轻微出界」,
   * 这个面板是同一套几何)。滑钮与刻度同装在内缩域 .in 里,内缩量 ≥ 滑钮半径,
   * p=0 / p=100 时外沿才不越过轨道端点;填充条仍从轨道最左端算到滑钮圆心。 */
  const trackEl = dragFix.ui('.track');
  const inEl = trackEl.querySelector('.in');
  const cssTxt = dragFix.w.document.getElementById('dyc-auto-loop-host').shadowRoot.querySelector('style').textContent;
  check(!!inEl && !!inEl.querySelector('.thumb') && !!inEl.querySelector('.marks'),
    '滑钮与刻度同在内缩域里(圆心不会跑出轨道)');
  const insetM = /\.in\{[^}]*left:(\d+)px[^}]*right:(\d+)px/.exec(cssTxt);
  const insetPx = insetM ? +insetM[1] : -1;
  const thumbR = (+( /\.thumb\{[^}]*width:(\d+)px/.exec(cssTxt) || [0,0])[1]) / 2;
  check(insetPx >= thumbR && thumbR > 0, '内缩 '+insetPx+'px ≥ 滑钮半径 '+thumbR+'px,拉到头也不越过轨道端点');
  const fillW = trackEl.querySelector('.fill').style.width;
  check(/^calc\(/.test(fillW) && fillW.indexOf('(100% - '+(insetPx * 2)+'px)') > 0,
    '填充条按内缩区间算宽(实测 '+fillW+')');

  /* ★ 2026-11-06 按态取按钮(真 DOM,不覆盖实现):
     平台新 UI 下一行里可能同时挂着「取消讲解」与「弹出讲解卡」。
     取错一枚就会"点了不会取消的按钮、再等 7 秒"(反馈 #131 的错法)。 */
  const btnFix = setup({dybAutoLoopSeconds:15,dybAutoLoopGroup:'sec',dybAutoLoopEnabled:false}, `
    findLectureBtn = window.__orig.findLectureBtn;
    findBtnByKind = window.__orig.findBtnByKind;
  `);
  const doc2 = btnFix.w.document;
  const mrow = doc2.createElement('div');
  const bStop = doc2.createElement('button'); bStop.textContent = '取消讲解';
  const bPop  = doc2.createElement('button'); bPop.textContent = '弹出讲解卡';
  mrow.appendChild(bStop); mrow.appendChild(bPop); doc2.body.appendChild(mrow);
  const fakeRect = (el, wd, ht) => {
    el.getBoundingClientRect = () => ({ width: wd, height: ht, left: 0, top: 0, right: wd, bottom: ht });
  };
  fakeRect(bStop, 64, 28); fakeRect(bPop, 88, 28);
  check(btnFix.w.__DYC_AUTO_LOOP__._findStopBtn(mrow) === bStop,
    '一行里同时有「取消讲解」和「弹出讲解卡」时,取取消按钮只认取消那枚');
  check(btnFix.w.__DYC_AUTO_LOOP__._findPopBtn(mrow) === bPop,
    '弹卡按钮单独取得到(不退化成"任意讲解按钮")');
  check(btnFix.w.__DYC_AUTO_LOOP__._findStartBtn(mrow) === null,
    '在讲时没有「开始讲解」,按态取就要返回空(而不是拿弹卡顶上)');
  check(btnFix.w.__DYC_AUTO_LOOP__._kindOf(bPop) === 'pop' && btnFix.w.__DYC_AUTO_LOOP__._kindOf(bStop) === 'stop',
    '元素态判定与文案一致');
  doc2.body.removeChild(mrow); doc2.body.appendChild(bPop);   // 左侧浮层形态:按钮在行外
  check(btnFix.w.__DYC_AUTO_LOOP__._findPopBtnPage() === bPop,
    '行内找不到时,能在页面上找到浮层形态的弹卡按钮');
  btnFix.dom.window.close();

  /* ★ 2026-11-06 弹卡优先(用户定:商品在讲解中时,平台左侧会滑出「弹起讲解卡」,
     按它可以在不断开讲解的情况下重新弹卡;所以循环优先点它,弹不起来才走取消+重讲)。
     这条用行为验证,不是源码字符串匹配:在讲 + 有弹卡按钮 ⇒ 一轮只能点它一次、不能点取消。 */
  const popFix = setup({dybAutoLoopSeconds:15,dybAutoLoopGroup:'sec',dybAutoLoopEnabled:false}, `
    window.__popClicks=0;
    var popBtn=document.createElement('button'); popBtn.textContent='弹出讲解卡';
    findPopBtn=function(){return popBtn;};
    findPopBtnPage=function(){return popBtn;};
    findStopBtn=function(){return null;};
    clickable=function(b){return !!b;};
    fireClick=function(){window.__popClicks++;};   // 弹卡不改变"讲解中"状态
  `);
  popFix.api.apply({autoLoopLecture:true});await flush();
  popFix.api.setOn(true,true);await flush();
  await popFix.api.doFastCycle();await flush();
  check(popFix.w.__popClicks===1 && popFix.clicks()===0,
    '在讲 + 有弹卡按钮 ⇒ 只点弹卡一次,绝不取消讲解(clicks='+popFix.clicks()+')');
  check(popFix.api.state.round===1 && popFix.api.state.on,
    '弹卡确认后照常记一轮、继续跑');
  check(popFix.api.state.popOk===1 && popFix.api.state.popTries===1,
    '弹卡账本正确(诊断 pop.ok/pop.tries 能看出新通道在跑)');

  /* 反向:没有弹卡按钮时必须退回老操作(取消 → 等翻转 → 再点讲解),
     否则平台哪天撤掉这枚按钮,循环就整体失效了。 */
  const oldFix = setup({dybAutoLoopSeconds:15,dybAutoLoopGroup:'sec',dybAutoLoopEnabled:false});
  oldFix.api.apply({autoLoopLecture:true});await flush();
  oldFix.api.setOn(true,true);await flush();
  const beforeOld = oldFix.clicks();
  await oldFix.api.doFastCycle();await flush();
  check(oldFix.clicks()-beforeOld===2 && oldFix.api.state.on && oldFix.api.state.round===1,
    '没有弹卡按钮 ⇒ 照旧「取消+续讲」各一次,循环不停(clicks='+(oldFix.clicks()-beforeOld)+')');
  oldFix.dom.window.close();

  /* ★ 2026-11-12 外部重启(用户报:两台电脑同控一个后台,另一台对**同一商品**
     点了「取消讲解」再「讲解」,本机计时没变,到点仍把这个刚讲过的品再讲一遍)。
     口径:off → on 的翻转 = 一次新的讲解开始 ⇒ 计时从头走;只改状态行、不发消息。 */
  const extFix = setup({dybAutoLoopMinutes:5,dybAutoLoopGroup:'min',dybAutoLoopEnabled:false});
  extFix.api.apply({autoLoopLecture:true});await flush();
  extFix.api.setOn(true,true);await flush();
  const baseNext = extFix.api.state.nextAt;
  check(extFix.api.state.on && baseNext===extFix.now()+300000,'分钟档开启后按完整 5 分钟计时');
  extFix.advance(10000);                                   // 已跑 10 秒
  extFix.row.dataset.live='0'; extFix.button.textContent='讲解';   // 隔壁点了取消
  extFix.api.checkNow();
  check(extFix.api.state.nextAt===baseNext,'外部取消只记 off:计时纹丝不动(不提前也不重置)');
  check(extFix.api.state.lectOn===0,'取消已入账(lectOn=0)');
  extFix.advance(3000);                                    // 3 秒后隔壁又点讲解
  extFix.row.dataset.live='1'; extFix.button.textContent='取消讲解';
  extFix.api.checkNow();
  check(extFix.api.state.nextAt===extFix.now()+300000,'外部重讲 ⇒ 计时从头走(完整 5 分钟,不是剩余时间)');
  check(extFix.api.state.extRestarts===1,'外部重启计数 +1(诊断能看出来)');
  check(!!extFix.api.state.status && extFix.api.state.status.kind==='warn',
    '状态行给出提示(warn 档;具体措辞不绑死,改文案不该让这条红)');
  check(extFix.api.state.round===0,'同一个品、同一轮:轮次不因外部重启而累加');
  extFix.dom.window.close();

  /* 窗口上限:off 持续超过 15 秒才讲回来 ⇒ 当「找回」处理,不重置计时。
     否则隔壁关掉讲解十几秒再开,这边也会被判成重启,逻辑上说不通。 */
  const secFix = setup({dybAutoLoopSeconds:60,dybAutoLoopGroup:'sec',dybAutoLoopEnabled:false});
  secFix.api.apply({autoLoopLecture:true});await flush();
  secFix.api.setOn(true,true);await flush();
  const secBase = secFix.api.state.nextAt;
  secFix.advance(2000);
  secFix.row.dataset.live='0'; secFix.button.textContent='讲解';
  secFix.api.checkNow();
  check(secFix.api.state.lectOn===0,'秒档也能采到 off(原来这条链根本不存在)');
  secFix.advance(20000);                                   // 累计 22 秒 > 15 秒窗口
  secFix.row.dataset.live='1'; secFix.button.textContent='取消讲解';
  secFix.api.checkNow();
  check(secFix.api.state.nextAt===secBase,'超过 15 秒窗口不认外部重启,计时不变');
  check(secFix.api.state.extRestarts===0,'窗口外不计外部重启次数');
  secFix.dom.window.close();

  /* 源码纪律:三条防误判必须在场,且「只改状态行」不许被后续改动悄悄破坏。 */
  const bodyOf = function (name) {
    const i = source.indexOf('function ' + name); if (i < 0) return '';
    const rest = source.slice(i + 10);
    const m = rest.match(/\n  (?:async )?function /);
    return m ? rest.slice(0, m.index) : rest;
  };
  const bodySample = bodyOf('sampleLecture'), bodyRefresh = bodyOf('refreshByExternal');
  check(/state\.busy\)\s*return false/.test(bodySample) &&
    /state\.owedResume\s*\|\|\s*state\.cancelPending/.test(bodySample),
    '自家动作期间不采样(否则自家「取消→再讲」会被认成外部重启)');
  check(/prevOff\s*<\s*state\.startedAt/.test(bodySample) && /LECT_REFRESH_MS/.test(bodySample),
    '「off 晚于本轮起点」与「窗口上限」两道闸都在');
  check(/lectureCancelled\(/.test(bodySample),
    'off 必须有明确证据(按钮真的翻成「讲解」),重渲染假阴性不记账');
  check(!/boxNote\(/.test(bodyRefresh) && /setStatusLine\(/.test(bodyRefresh),
    '外部重启只改状态行,不往消息盒子发消息(用户 2026-11-12 定)');
  /* ★ 2026-11-12 用户定:停留时长跟「自动轮次」那条消息一样(3 秒),
     不许再挂 8 秒;而且要引用常量,免得下次改口径只改一处。
     轮次消息的 3 秒来源 = src/content/dialog.js 的 DYC_STATUS_TTL。 */
  check(/statusTtlAt\s*=\s*now\s*\+\s*STATUS_TTL_MS/.test(bodyRefresh) &&
    /var\s+STATUS_TTL_MS\s*=\s*3000/.test(source),
    '状态行停留 3 秒(与轮次消息同长),且走 STATUS_TTL_MS 常量而不是字面量');

  for(const fixture of [f,restart,resume,race,defaults,dragFix,popFix]) fixture.dom.window.close();
  console.log('循环讲解模式行为自测：'+passed+'/'+passed+' 通过');
})().catch(e=>{console.error(e);process.exit(1);});
