/**
 * 离屏文档 · 统一闹钟(2026-11-01)
 * ============================================================
 * 【为什么要有这个东西】
 *   用户原话:「放在后台就没法自动循环了」「主要还是保证切页面、没有在前台的
 *   情况下,自动循环讲解能够生效」。
 *
 *   实测证据(2026-11-01 三份诊断报告):配置 15 秒档,开启到采集 354 秒,
 *   只走完 2 轮(平均 177 秒/轮);同一份报告的前 110 秒在前台时走了 5 轮
 *   (平均 22 秒/轮)。差距 8 倍 —— 不是代码算错,是浏览器把后台标签的定时器
 *   节流了:切到后台先压到 1 秒一拍,隐藏满 5 分钟且不出声再压到 1 分钟一拍
 *   (intensive throttling)。
 *
 * 【做法:时钟搬出页面】
 *   原来每个中控台页面自己 setInterval 判断「到点了没」。页面一旦不可见就被
 *   节流,判断自然变慢。现在改成:
 *     离屏文档 Worker 每秒打一拍 → 转发给所有注册的中控台标签
 *     页面收到拍子,只做一件事:比较 Date.now() 与自己的 nextAt
 *
 *   为什么放 Worker 而不是这里的 setInterval:Worker 有独立执行上下文,
 *   **不参与页面可见性节流**。这一层是整套方案能不能成立的关键。
 *
 * 【为什么用 runtime 广播,而不是逐标签精确发送】
 *   本来想用 chrome.tabs.sendMessage 只发给注册过的标签,让 SW 能照常休眠。
 *   但**离屏文档里 chrome.tabs 根本不可用**(Chrome 对 offscreen 只开放 runtime),
 *   实机表现为:闹钟建起来了,beat.n 却一直是 0 —— 静默失败,最难查。
 *   ⇒ 退回 runtime.sendMessage 广播,内容脚本各自判断要不要执行。
 *     代价是 SW 会被广播唤醒;所以只在有标签注册时才开始广播,不开循环就零开销。
 *
 * 【协议】
 *   页面 → {type:'dyc:beatOn'}          注册(每秒开始收拍子)
 *   页面 → {type:'dyc:beatOff'}         注销
 *   后台 → {type:'dyc:beatReg', tabId}  由 SW 在离屏文档建好后补注册
 *   这里 → {type:'dyc:beat', at}        每秒一次,at = 时间戳(毫秒)
 *   任意 → {type:'dyc:beatStat'}        问一次统计(诊断用)
 * ============================================================ */
(function () {
  'use strict';

  var BEAT_MS = 1000;          // 拍点间隔(与 Worker 内部一致)
  var targets = Object.create(null);   // tabId → true
  var worker = null;
  var fallbackTimer = 0;       // Worker 建不起来时的退路
  var lastBeatAt = 0;          // 最后一拍的时间戳(诊断用)
  var beatCount = 0;
  var failCount = 0;
  var startedAt = Date.now();

  function tabIds() {
    return Object.keys(targets);
  }

  /** 把一拍交给 Service Worker 转发。
   *
   * ★ 2026-11-01 第三次实机(报告:注册=ok:offscreen 但 beat.n=0)后的定论:
   *   离屏文档活得好好的 —— 它能收到 beatReg、能回话(否则 registerBeat 会超时降级)。
   *   断的是**它发出的 runtime 广播送不到内容脚本**。
   *   不再跟这条投递较劲:离屏只往 SW 报一个 tick,由 SW 用 chrome.tabs.sendMessage
   *   转发给具体标签 —— 那是工程里用了大半年的通道,确定能通。
   *   代价:SW 每秒被唤醒一次。用户就开一两个中控台,这个开销认了。
   */
  function fire(at) {
    if (!tabIds().length) return;
    lastBeatAt = at;
    beatCount += 1;
    try {
      chrome.runtime.sendMessage({ type: 'dyc:beatTick', at: at }, function () {
        void chrome.runtime.lastError;
      });
    } catch (e) {
      failCount += 1;
    }
  }

  /** 起节拍器。优先 Worker,建不起来退回本页 setInterval(精度差一些但比没有强)。 */
  function startBeat() {
    if (worker || fallbackTimer) return;

    try {
      worker = new Worker('ticker-worker.js');
      worker.onmessage = function (e) {
        fire(typeof e.data === 'number' ? e.data : Date.now());
      };
      worker.onerror = function () {
        // Worker 加载失败(极少见):降级到本地定时器,并留下痕迹供诊断。
        try { worker.terminate(); } catch (e) { /* 忽略 */ }
        worker = null;
        startFallback();
      };
      worker.postMessage('start');
      return;
    } catch (e) {
      worker = null;
    }
    startFallback();
  }

  function startFallback() {
    if (fallbackTimer || worker) return;
    fallbackTimer = setInterval(function () { fire(Date.now()); }, BEAT_MS);
  }

  function stopBeat() {
    if (worker) {
      try { worker.terminate(); } catch (e) { /* 忽略 */ }
      worker = null;
    }
    if (fallbackTimer) { clearInterval(fallbackTimer); fallbackTimer = 0; }
    lastBeatAt = 0;
  }

  function register(id) {
    if (!id) return;
    targets[id] = true;
    startBeat();
  }

  function unregister(id) {
    if (!id) return;
    delete targets[id];
    if (!tabIds().length) stopBeat();
  }

  chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
    if (!msg || !msg.type) return false;

    if (msg.type === 'dyc:beatOn') {
      // 页面自己发的消息:sender.tab 就是来源标签,不用页面报 id。
      register((sender && sender.tab && sender.tab.id) || msg.tabId);
      sendResponse({ ok: true, n: tabIds().length, worker: !!worker });
      return false;
    }

    if (msg.type === 'dyc:beatReg') {
      // 由 SW 转发:离屏文档建好之前发出的注册,在这里补上。
      register(msg.tabId);
      sendResponse({ ok: true, n: tabIds().length, worker: !!worker });
      return false;
    }

    if (msg.type === 'dyc:beatOff') {
      unregister((sender && sender.tab && sender.tab.id) || msg.tabId);
      sendResponse({ ok: true, n: tabIds().length });
      return false;
    }

    if (msg.type === 'dyc:beatStat') {
      sendResponse({
        ok: true,
        n: tabIds().length,
        beat: beatCount,
        fail: failCount,
        last: lastBeatAt,
        worker: !!worker,
        fallback: !!fallbackTimer,
        age: Date.now() - startedAt
      });
      return false;
    }

    return false;
  });
})();
