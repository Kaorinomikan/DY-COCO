/**
 * 抖音可可助手 · 后台服务（MV3 Service Worker）
 *
 * 两件事:
 *   ① **每 6 小时**悄悄检查一次 Gitee 上有没有新版本标签,
 *      把结果写进 chrome.storage.local,供弹窗读取。
 *   ② 代收反馈面板发来的记录,直连云端 REST 端点写入(见文件末尾「反馈提交」一节)。
 *
 * 三条刻意为之的设计（改之前先读，别好心办坏事）：
 *
 * 0. **绝不在浏览器启动时检查。**
 *    用户 2026-10-11 明确要求取消「一开浏览器就查一次」——
 *    他日常同时开四个以上浏览器，每个浏览器启动都发请求等于白白拥堵，
 *    而且这个检查用户根本感知不到（提示只在主动点开弹窗时才显示）。
 *    现在只在 6 小时周期的 alarm 触发时查;浏览器启动只补建定时器。
 *
 * 1. **绝不设置图标徽标（badge）。**
 *    用户明确要求：日常使用时扩展图标上不能出现红点，会很烦人。
 *    所以这里检测到新版本也只是一条 storage 记录，
 *    任何时候都不调用 chrome.action.setBadgeText。
 *    更新提示只在用户主动点开弹窗时才显示文字。
 *
 * 2. **绝不自动跳过用户去下载或安装。**
 *    本文件只做“发现”，不做“安装”。
 *    安装必须由用户在弹窗里点确认、再到更新页里执行。
 *
 * 3. **绝不重启浏览器、绝不关标签页。**
 *    用户可能在直播推流，任何自动重载标签页/关窗口的行为都可能造成事故。
 *    整个更新链路上只有 chrome.runtime.reload()（只重载扩展自身），
 *    且仅在用户确认安装后才调用。
 *
 * 之所以需要 Service Worker：MV3 的 chrome.alarms 必须由后台脚本托管。
 * 本扩展此前没有 background，是本次为了更新检查新增的。
 */

// ┌──────────────────────────────────────────────────────────────────┐
// │ 构建标记（**这行必须随每次发布变化**，别删也别固定不动）          │
// │ 原因：MV3 的 Service Worker 脚本会被浏览器缓存。若只改动了被       │
// │ importScripts 引入的文件、而本文件字节完全没变，浏览器会继续复用   │
// │ 上一次缓存的整个脚本包（连旧的 gitee.js 一起），导致「磁盘已更新、 │
// │ 后台仍跑旧代码」。实测于 360 极速浏览器X：只改 gitee.js 时，       │
// │ 重新加载扩展也不生效；必须让本文件内容变化才会重新注册 SW。       │
// │ 排障与原理详见 AGENTS.md 踩坑记录。                              │
// │                                                                  │
// │ 改这个值的方式：'<版本号>+swN'，N 从 1 开始自增。                │
// │ publish.sh 会机械校验这件事 —— 只要被 importScripts 引入的文件   │
// │ （src/shared/）有改动而本行值没变，                             │
// │ 发布会被直接中止。不需要靠人记。                                 │
// └──────────────────────────────────────────────────────────────────┘
// 全面整改：后台统一设置写入、私有历史与反馈来源截图，更新导入的开关定义。
var DYC_BUILD = '26.11.12.2+sw38';

// classic worker，可以 importScripts（manifest 里没有设 type: module）
importScripts('../shared/gitee.js', '../content/flags.js', '../shared/live-control-assets.js');

// 设置由后台串行更新；失败不阻塞队列中的下一次操作。
var flagWriteQueue = Promise.resolve();

/**
 * 写一个开关。
 *
 * 2026-11-05 放宽「未知键」：旧实现拿不到 meta 就直接拒绝，而 meta 来自本文件
 * importScripts 进来的 flags.js。SW 的脚本包被缓存时，「弹窗已是新版
 * （认识新开关键）、后台还是旧包（不认识）」就会同时成立 —— 用户点开关得到
 * 「设置未保存」，只有重启浏览器才恢复。现在未知键按弹窗随消息带来的 store
 * 落库（弹窗侧已经用同一份 flags.js 校验过，键来自扩展自身，值是布尔）。
 * 写错的唯一后果是 storage 里多一个没人读的键，比「用户设置存不进去」轻得多。
 */
function writeFeatureFlag(key, value, store) {
  if (typeof key !== 'string' || !key || typeof value !== 'boolean') {
    return Promise.reject(new Error('无效设置'));
  }
  var meta = dycFlagMeta(key);
  var where = (meta && meta.store) || (store === 'debug' ? 'debug' : 'features');
  var task = flagWriteQueue.then(function () {
    if (where === 'debug') return dycStorageCallP('set', { dybDebug: value });
    return dycStorageCallP('get', DYC_FLAGS_STORE_KEY).then(function (got) {
      var flags = Object.assign({}, got[DYC_FLAGS_STORE_KEY] || {});
      flags[key] = value;
      return dycStorageCallP('set', { dybFeatures: flags });
    });
  });
  flagWriteQueue = task.catch(function () {});
  return task;
}

// 反馈提交不再引入云 SDK（2026-10-12 二次修：删掉第二处 importScripts）。
// 改为在本文件内直接 POST 平台 REST 端点，理由见下方「反馈提交」一节。

// 消息历史只留在扩展私有存储；同页多标签的更新在后台合并，不写宿主站点。
var historyQueue = Promise.resolve();
var HISTORY_STORE = 'dycPrivateHistory';
function mergeHistoryItems(current, incoming) {
  var keyed = Object.create(null);
  var rows = [];
  (current || []).concat(incoming || []).forEach(function (item) {
    if (!item || typeof item.text !== 'string' || !item.text || !isFinite(item.ts)) return;
    if (['success', 'error', 'alert', 'warning'].indexOf(item.type) < 0) return;
    var row = { type: item.type, source: String(item.source || '').slice(0, 40),
      text: item.text.slice(0, 12000), brief: String(item.brief || '').slice(0, 96), count: String(item.count || '').slice(0, 300),
      time: String(item.time || '').slice(0, 12), ts: Number(item.ts) };
    if (item.key) row.key = String(item.key).slice(0, 100);
    var id = row.key ? 'key:' + row.key : JSON.stringify([row.type, row.source, row.text, row.count, row.ts]);
    var old = keyed[id];
    if (!old) { keyed[id] = row; rows.push(row); }
    else if (row.ts >= old.ts) Object.assign(old, row);
  });
  var merged = [];
  rows.sort(function (a, b) { return a.ts - b.ts; }).forEach(function (row) {
    var previous = merged[merged.length - 1];
    if (previous && previous.type === row.type && previous.source === row.source && previous.text === row.text
        && (previous.key || '') === (row.key || '') && row.ts - previous.ts < 60000) {
      Object.assign(previous, row);
    } else merged.push(row);
  });
  return merged.slice(-100);
}
function historyRequest(type, items, sender) {
  var url;
  try { url = new URL(sender && sender.tab && sender.tab.url || ''); } catch (_) {
    return Promise.reject(new Error('无法确定消息所属页面'));
  }
  // 历史按 origin + pathname 分页保存；只接受 manifest 实际支持的业务页面。
  if (!dycIsSupportedPage(url.href)) {
    return Promise.reject(new Error('不支持的消息页面'));
  }
  var scope = url.origin + url.pathname;
  var task = historyQueue.then(function () {
    return chrome.storage.local.get(HISTORY_STORE).then(function (got) {
      var pages = got[HISTORY_STORE];
      if (!pages || typeof pages !== 'object' || Array.isArray(pages)) pages = {};
      var current = pages[scope] && pages[scope].items || [];
      if (type === 'dyc:historyGet') return { ok: true, items: mergeHistoryItems(current, []) };
      var next = type === 'dyc:historyClear' ? [] : mergeHistoryItems(current, Array.isArray(items) ? items.slice(-100) : []);
      pages[scope] = { at: Date.now(), items: next };
      Object.keys(pages).sort(function (a, b) { return (pages[b].at || 0) - (pages[a].at || 0); })
        .slice(20).forEach(function (key) { delete pages[key]; });
      return chrome.storage.local.set({ dycPrivateHistory: pages }).then(function () { return { ok: true, items: next }; });
    });
  });
  historyQueue = task.catch(function () {});
  return task;
}

var ALARM_NAME = 'dyc-update-check';
var CHECK_PERIOD_MIN = 6 * 60; // 6 小时(用户 2026-10-11 定:24h → 12h → 6h)
var STATE_KEY = 'dycState';

/** 读取检查状态（没有就返回空对象） */
function getState() {
  return chrome.storage.local.get(STATE_KEY).then(function (r) {
    return r[STATE_KEY] || {};
  });
}

/** 合并写入检查状态 */
function patchState(patch) {
  return getState().then(function (cur) {
    var next = Object.assign({}, cur, patch);
    return chrome.storage.local.set({ [STATE_KEY]: next }).then(function () {
      return next;
    });
  });
}

/** 执行一次真实的版本检查 */
function runCheck(reason) {
  var localVersion = chrome.runtime.getManifest().version;

  return DYC_GITEE.fetchLatestTag().then(function (tag) {
    var latestVersion = DYC_GITEE.tagToVersion(tag);
    var updateAvailable = DYC_GITEE.compareVersion(latestVersion, localVersion) > 0;
    return patchState({
      localVersion: localVersion,
      latestTag: tag,
      latestVersion: latestVersion,
      updateAvailable: updateAvailable,
      checkedAt: new Date().toISOString(),
      lastError: null,
      lastReason: reason
    });
  }).catch(function (e) {
    // 检查失败不是错误状态，只是这一次没查到。
    // 保留上一次的 latestVersion / updateAvailable，避免网络抖动把“有更新”抹掉。
    return patchState({
      localVersion: localVersion,
      checkedAt: new Date().toISOString(),
      lastError: String((e && e.message) || e),
      lastReason: reason
    });
  });
}

/** 距上次检查满 6 小时才查;force=true 时强制查(用户手动点“检查更新”) */
function maybeCheck(reason, force) {
  return getState().then(function (st) {
    if (!force && st.checkedAt) {
      var elapsed = Date.now() - Date.parse(st.checkedAt);
      if (isFinite(elapsed) && elapsed >= 0 && elapsed < CHECK_PERIOD_MIN * 60 * 1000) {
        return st;
      }
    }
    return runCheck(reason);
  });
}

/**
 * 注册定时器。只在不存在时创建。
 *
 * ⚠️ 两个坑（都踩过，别改回去）：
 *
 *  1) `chrome.alarms.create` 同名调用会**重置**计时。SW 会被频繁唤醒,
 *     若无条件重建,6 小时的周期永远走不满 —— 所以必须先 get,
 *     存在就一个字都不动。
 *
 *  2) **首次排期不能写死 `delayInMinutes: 1`。** alarm 不保证跨浏览器重启
 *     保留，重启后本函数确实需要补建它；但若固定「1 分钟后首次触发」，
 *     就等价于「每次开浏览器 1 分钟后都查一次」——
 *     用户常同时开四个以上浏览器，这会造成大量无谓请求，
 *     正是用户 2026-10-11 要求取消的那个行为。
 *
 *     现在的做法:首次触发点 = **上次检查时间 + 6 小时**(不会因为重启提前);
 *     只有从未查过(或时间记录不可用)时才退化为 1 分钟后查一次,
 *     保证刚装上的用户能尽快看到状态。
 */
function ensureAlarm() {
  return chrome.alarms.get(ALARM_NAME).then(function (existing) {
    if (existing) return;

    return getState().then(function (st) {
      var periodMs = CHECK_PERIOD_MIN * 60 * 1000;
      var last = Date.parse(st.checkedAt || '');
      var now = Date.now();
      // 最早也要 1 分钟后，避免与当前这一次检查挤在一起
      var when = (isFinite(last) && last > 0)
        ? Math.max(now + 60 * 1000, last + periodMs)
        : now + 60 * 1000;

      chrome.alarms.create(ALARM_NAME, {
        when: when,
        periodInMinutes: CHECK_PERIOD_MIN
      });
    });
  });
}

chrome.runtime.onInstalled.addListener(function () {
  ensureAlarm();
  maybeCheck('installed', false);
});

/**
 * 【用户 2026-10-11 要求】浏览器启动时**不做检查**，只补建定时器。
 *
 * 原因：用户日常同时开四个以上浏览器，每个浏览器每次启动都查一遍会造成
 * 大量无谓请求；而这些请求对用户没有任何价值 —— 更新提示只在用户主动
 * 点开弹窗时才显示，启动时那一查用户看不见。
 *
 * 真正的定期检查完全交给 6 小时的 alarm;`ensureAlarm()` 已把首次触发点
 * 排在「上次检查 + 6 小时」,所以补建也不会让检查提前发生。
 */
chrome.runtime.onStartup.addListener(function () {
  ensureAlarm();
});

chrome.alarms.onAlarm.addListener(function (alarm) {
  if (alarm && alarm.name === ALARM_NAME) {
    // 走 maybeCheck(带 6 小时节流)而不是直接 runCheck:
    // 万一 alarm 因重启被重建、提前触发，这里也会被节流挡住，不会真发请求。
    maybeCheck('alarm', false);
    return;
  }

  // 统一闹钟兜底:离屏文档不可用时的 30 秒拍点。见 startAlarmBeat 上方说明。
  if (alarm && alarm.name === BEAT_ALARM) {
    broadcastBeat();
  }
});

// 标签关闭后把它的拍点登记一并清掉（2026-11-01 体检 P1）：
// 原来条目永久留在内存与 storage.session，兜底闹钟也永远不清 ——
// 开过循环讲解的标签关掉后，SW 整个浏览器会话都被周期性白唤醒。
chrome.tabs.onRemoved.addListener(function (tabId) {
  if (beatTabs[tabId]) {
    delete beatTabs[tabId];
    saveBeatTabs();
    maybeStopBeatAlarm();
  }
});

/**
 * 供弹窗 / 更新页调用的消息接口。
 * 返回 true 表示异步响应，必须保留——漏掉会让 sendResponse 永远发不出去。
 */
chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
  if (!msg || typeof msg.type !== 'string') {
    sendResponse({ ok: false, error: '未知消息' });
    return false;
  }

  // 离屏文档专用消息(2026-10-24):后台自己会发出并收到它,这里必须**不响应**
  // 直接放行,否则会跟离屏文档的真实回执抢答。
  // 2026-11-08 补图片那条:同一个坑再踩一次就是「每次读图都拿到未知消息」。
  if (msg.type === 'dyc:offscreenReadClipboard'
    || msg.type === 'dyc:offscreenReadClipboardImage') return false;

  if (['dyc:historyGet', 'dyc:historyMerge', 'dyc:historyClear'].indexOf(msg.type) >= 0) {
    historyRequest(msg.type, msg.items, sender).then(sendResponse, function (error) {
      sendResponse({ ok: false, error: (error && error.message) || '记录未保存' });
    });
    return true;
  }

  if (msg.type === 'dyc:writeFlag') {
    writeFeatureFlag(msg.key, msg.value, msg.store).then(function () {
      sendResponse({ ok: true });
    }, function (error) {
      sendResponse({ ok: false, error: (error && error.message) || '设置未保存' });
    });
    return true;
  }

  /* ---- 子页补注入（2026-11-05 建，2026-11-08 泛化为多分组）----
   * 从百应主页/侧栏 SPA 切进 /live/control 或 /dashboard/shopwindow/* 时
   * document 不重载，对应那条 content_scripts 根本没有机会命中，
   * 页面里一个功能都没有。由全域探子 src/live/live-agent.js 分区发消息，
   * 这里按与 manifest 同一份清单补注脚本与样式。 */
  if (msg.type === 'dyc:injectLiveControl') {
    injectLiveControl(sender).then(function (r) {
      sendResponse(r);
    }, function (e) {
      sendResponse({ ok: false, error: (e && e.message) || '补注入失败' });
    });
    return true;
  }
  if (msg.type === 'dyc:injectShopwindow') {
    injectAssetGroup(sender, DYC_SHOPWINDOW_ASSETS, '__DYC_SHOPWINDOW_LOADED__', '橱窗').then(function (r) {
      sendResponse(r);
    }, function (e) {
      sendResponse({ ok: false, error: (e && e.message) || '补注入失败' });
    });
    return true;
  }
  /* 通用分组分支（2026-11-08 探子分区制推广到全部路径型注入组）：
     探子统一发 {type:'dyc:injectGroup', group:'分组键'}，这里按注册表分发。
     上面两个旧消息类型保留：防半旧页面（老探子）对上新后台时断链。 */
  if (msg.type === 'dyc:injectGroup') {
    var grp = (typeof DYC_INJECT_GROUPS !== 'undefined' && DYC_INJECT_GROUPS)
      ? DYC_INJECT_GROUPS[msg.group] : null;
    if (!grp) {
      sendResponse({ ok: false, error: '未知补注入分组：' + String(msg.group || '') });
      return true;
    }
    injectAssetGroup(sender, grp, grp.marker, grp.label).then(function (r) {
      sendResponse(r);
    }, function (e) {
      sendResponse({ ok: false, error: (e && e.message) || '补注入失败' });
    });
    return true;
  }

  // ---- 剪贴板代读(2026-10-24):内容脚本读剪贴板被页面权限拦,交离屏文档读 ----
  if (msg.type === 'dyc:readClipboard') {
    readClipboardViaOffscreen().then(function (r) {
      sendResponse(r);
    });
    return true;
  }

  // ---- 剪贴板图片代读(2026-11-08,商品编辑页「图片剪贴板粘贴」)----
  // 与文本那条同一条离屏通道;超时给足 8 秒 —— 大图转 dataURL 比读文本慢得多。
  if (msg.type === 'dyc:readClipboardImage') {
    readClipboardImageViaOffscreen().then(function (r) {
      sendResponse(r);
    });
    return true;
  }

  /* ---- 统一闹钟(2026-11-01) ----
   * 页面切到后台后自己的 setInterval 会被压到 1 秒乃至 1 分钟一拍,
   * 自动循环讲解因此走不动。改由离屏文档的 Worker 打拍子,页面只判断到点。 */

  // 注册:先记下这个标签,再确保离屏文档存在(它按需创建,早发的注册会丢)。
  if (msg.type === 'dyc:beatEnsure') {
    var beatTabId = sender && sender.tab && sender.tab.id;
    if (beatTabId) { beatTabs[beatTabId] = true; saveBeatTabs(); }
    ensureOffscreen().then(function () {
      return registerBeat(beatTabId);
    }).then(function () {
      sendResponse({ ok: true, mode: 'offscreen' });
    }, function (error) {
      /* 离屏文档这条路不通(内核不支持 / reasons 被拒 / 文档建不起来) ⇒ 退到 alarms。
       * 必须把 mode 回给页面:否则又变成"静默降级",报告里只能看到 beat.n = 0,
       * 分不清是闹钟没建起来还是拍子发不出去。 */
      var started = startAlarmBeat();
      sendResponse({
        ok: started,
        mode: started ? 'alarm' : 'none',
        error: started ? '' : ((error && error.message) || '闹钟起不来')
      });
    });
    return true;
  }

  if (msg.type === 'dyc:beatOff') {
    var beatOffId = sender && sender.tab && sender.tab.id;
    if (beatOffId) { delete beatTabs[beatOffId]; saveBeatTabs(); }
    // 没有任何标签在收拍点了 → 兜底闹钟一起停（2026-11-01 体检 P1）：
    // 原来只删登记不清闹钟，30 秒一拍的空转伴随整个浏览器会话。
    maybeStopBeatAlarm();
    // 离屏文档那边也要摘,这里放行不抢答。
    return false;
  }

  /* 离屏文档每秒报一个 tick,由这里转发给标签(2026-11-01 第三次实机后定:
   * 离屏自己发的 runtime 广播送不到内容脚本,但 tabs.sendMessage 通)。 */
  if (msg.type === 'dyc:beatTick') {
    var tickAt = msg.at || Date.now();
    if (beatTabsReady) {
      relayBeat(tickAt);
    } else {
      loadBeatTabs().then(function () { relayBeat(tickAt); });
    }
    return false;
  }

  /* 拍点广播:SW 这里必须**静默放行** —— 每秒一条,回「未知消息类型」纯属噪音。 */
  if (msg.type === 'dyc:beat') return false;

  // 统计:诊断报告里用它判断闹钟活没活着。
  if (msg.type === 'dyc:beatStat') {
    chromeCb(function (done) {
      chrome.runtime.sendMessage({ type: 'dyc:beatStat' }, done);
    }, 2000).then(function (res) {
      sendResponse(res || { ok: false, error: '闹钟无响应' });
    }, function (error) {
      sendResponse({ ok: false, error: (error && error.message) || '闹钟无响应' });
    });
    return true;
  }

  if (msg.type === 'dyc:getState') {
    getState().then(function (st) {
      sendResponse({
        ok: true,
        state: st,
        localVersion: chrome.runtime.getManifest().version
      });
    });
    return true;
  }

  if (msg.type === 'dyc:checkNow') {
    maybeCheck('manual', !!msg.force).then(function (st) {
      sendResponse({ ok: true, state: st });
    });
    return true;
  }

  // 更新页收尾:它要自关窗口,重载扩展改由 SW 执行(页面先关也不影响)。
  // 只重载扩展自身,不碰用户任何标签页/窗口 —— 与设计原则 3 一致。
  /* ---- 更新收尾（2026-11-05 重做）----
   * 旧实现是 setTimeout(900) 之后再 reload。中间这 900ms 里只要内核把
   * 空闲的 SW 掐掉，reload 就**永远不会执行** —— 磁盘已是新版、后台仍跑
   * 旧缓存包，用户看到的就是「设置存不进」「必须手动点重新加载」。
   * 现在改成：先回执（让更新页知道后台已接管），再关更新窗口，关窗回调
   * 里立刻 reload。链路从「延迟执行」变成「回调执行」，少一个被掐的窗口。 */
  if (msg.type === 'dyc:update-finish') {
    var finishWinId = sender && sender.tab && sender.tab.windowId;
    var reloadNow = function () {
      try { chrome.runtime.reload(); } catch (e) { /* 尽力而为 */ }
    };
    sendResponse({ ok: true, armed: true });
    // 先关窗口再重载：反过来会留下一张僵尸页（2026-10-11 实测）。
    if (typeof finishWinId === 'number' && chrome.windows && chrome.windows.remove) {
      try {
        chrome.windows.remove(finishWinId, reloadNow);
        return false;
      } catch (e) { /* 关不掉就直接重载 */ }
    }
    reloadNow();
    return false;
  }

  if (msg.type === 'dyc:markUpdated') {
    patchState({
      localVersion: msg.version || chrome.runtime.getManifest().version,
      updateAvailable: false,
      latestVersion: msg.version || chrome.runtime.getManifest().version,
      lastError: null,
      updatedAt: new Date().toISOString()
    }).then(function () {
      sendResponse({ ok: true });
    });
    return true;
  }

  // ---- 反馈浮层:向活动标签页注入 panel.js(2026-10-12 B 修改版) ----
  // 页面内右上角小面板,不开窗口不开标签页。特权页无法注入时兜底开独立小窗。
  // mode(#106 · 2026-10-24):面板顶部已是「反馈/更新日志」双 Tab,
  // 弹窗「更新日志」入口带 mode:'changelog' 让面板直接落在日志页。
  if (msg.type === 'dyc:openFeedback') {
    openFeedbackPanel(msg.mode).then(function (r) {
      sendResponse(r);
    });
    return true;
  }

  // ---- 反馈浮层的「截屏」按钮:captureVisibleTab 直截当前页 → dataURI ----
  // 面板不能直接调 tabs API,经 background 转发;JPEG dataURI 回传。
  // 兜底小窗调用时会带 hideWindowId,由后台先把该窗口最小化再截,
  // 免得把小窗自己拍进图里(见 captureScreenshot 的 2026-10-13 三次修)。
  if (msg.type === 'dyc:captureScreenshot') {
    var sourceTab = sender && sender.tab;
    var extensionPage = sender && String(sender.url || '').indexOf(chrome.runtime.getURL('src/feedback/feedback.html')) === 0;
    captureScreenshot({
      hideWindowId: extensionPage ? msg.hideWindowId : null,
      sourceTabId: extensionPage ? msg.sourceTabId : (sourceTab ? sourceTab.id : null),
      sourceWindowId: extensionPage ? msg.sourceWindowId : (sourceTab ? sourceTab.windowId : null)
    }).then(function (r) {
      sendResponse(r);
    });
    return true;
  }

  // ---- 反馈提交:必须由后台转发(2026-10-12 修) ----
  // 为什么不在页面里直接调云 SDK:
  //   content script 的 fetch 以「宿主页面」为源,受 CORS 约束;而云端 REST 网关
  //   不响应 OPTIONS 预检(实测 403 且不回 Access-Control-Allow-*),SDK 又必然带
  //   application/json + x-wb-webapp-access-key 两个非简单头 → 一定触发预检 →
  //   在页面里提交必然卡死。后台有 host_permissions,跨源请求不受此限。
  if (msg.type === 'dyc:submitFeedback') {
    submitFeedback(msg.record).then(function (r) {
      sendResponse(r);
    });
    return true;
  }

  // ---- 诊断采集:把后台侧缓存的错误交给页面，合并进同一条快照(2026-10-13 新增) ----
  // 后台是独立上下文，它自己的异常页面侧看不见，只能这样取。
  // 同步响应即可(读的是内存数组)。
  if (msg.type === 'dyc:diagCollectSW') {
    sendResponse({ ok: true, errors: swErrors.slice() });
    return false;
  }

  // ---- 页面结构探针:由**页面里的调试面板**发起(2026-10-18 新增) ----
  // 为什么必须过后台:内容脚本没有 chrome.scripting —— 该 API 只对扩展页面
  // (弹窗 / 后台 / 更新页)开放。面板长在页面里,只能请后台代注入探针。
  // 注入目标就是发消息的那个标签页(= 用户正看着的页面),不猜、不挑别的页。
  // 探针采完的回传不走这里:executeScript 与内容脚本共享同一个隔离世界,
  // 探针直接回调面板挂的 window.__dycProbeSink(见 page-probe.js 的 send)。
  if (msg.type === 'dyc:probePage') {
    var probeTabId = sender && sender.tab && sender.tab.id;
    if (probeTabId === undefined || probeTabId === null) {
      sendResponse({ ok: false, error: '读不到当前标签页,请刷新页面后重试' });
      return false;
    }
    injectProbeScript(probeTabId).then(function () {
      sendResponse({ ok: true });
    }, function (e) {
      sendResponse({ ok: false, error: (e && e.message) || String(e) });
    });
    return true;
  }

  // ---- 库存清零·网络监听 MAIN 直注(2026-10-21 新增) ----
  // 页面 CSP 可能拦 chrome-extension:// 的 script 标签 ⇒ 隔离世界还会请
  // 后台用 chrome.scripting 直注 MAIN world 兜底。两条路都幂等(探针防重入),
  // 哪条成功都行;两条都失败时失败信息进诊断报告,不影响清零原链路。
  if (msg.type === 'dyc:stockProbeMain') {
    var stockProbeTabId = sender && sender.tab && sender.tab.id;
    if (stockProbeTabId === undefined || stockProbeTabId === null) {
      sendResponse({ ok: false, error: '读不到当前标签页' });
      return false;
    }
    injectStockProbeMain(stockProbeTabId).then(function () {
      sendResponse({ ok: true });
    }, function (e) {
      sendResponse({ ok: false, error: (e && e.message) || String(e) });
    });
    return true;
  }

  // ---- 微信小店·商品链接读取 MAIN 直注(2026-10-31 新增) ----
  // 同上一段的双通道思路：页面 CSP 可能拦 chrome-extension:// 的 script 标签,
  // 因此隔离世界同时请后台直注。探针侧自带防重入,两条都到也只会挂一套 hook。
  if (msg.type === 'dyc:wxLinkMain') {
    var wxLinkTabId = sender && sender.tab && sender.tab.id;
    if (wxLinkTabId === undefined || wxLinkTabId === null) {
      sendResponse({ ok: false, error: '读不到当前标签页' });
      return false;
    }
    injectMainFile(wxLinkTabId, 'src/content/wx-link-main.js').then(function () {
      sendResponse({ ok: true });
    }, function (e) {
      sendResponse({ ok: false, error: (e && e.message) || String(e) });
    });
    return true;
  }

  sendResponse({ ok: false, error: '未知消息类型：' + msg.type });
  return false;
});

/* ---------- 反馈提交(后台直发) ---------- */

// 2026-10-12 二次修：改为**直连平台 REST 端点**，不再经过云 SDK。
// 为什么撤掉 SDK（它在当天早些时候才落地，就是本轮的上一版方案）：
//   ① 它把失败原因吞成了空消息 —— 云端拒绝和「请求根本没发出去」都只剩一句
//      「网络异常,请稍后重试」，排障等于瞎猜。用户实测面板报的就是这一句，
//      而 SDK 返回的 error 里取不到可用的 message（其内部链路存在原样抛出非 Error
//      对象的分支），父级 `(e && e.message) || 兜底` 因此永远落到兜底。
//   ② 它靠 importScripts 引入 68KB 产物，叠加 MV3 的 SW 脚本缓存问题
//      （本项目在 360 极速浏览器X 上已实测「只改被 importScripts 的文件不生效」）。
//      值改为内联在本文件后，任何改动都直接改变 SW 本身，这个坑自动消失。
//   ③ 匿名写一条反馈不需要会话与鉴权，SDK 除了拼 URL、加一个头之外没有别的作用。
// SDK 实际发出的请求就是下面三样（已逐字 dump 核对，并与云端核对过响应），
// 所以直发与它等价，而且错误完全可控。
//
// ⚠️ 若哪天平台调整了内部端点，这里会明确报出「云端 HTTP 404」之类的原文，
//    照着改这一处即可 —— 不会再出现「只说网络异常、什么都不知道」的情况。
var FB_ENDPOINT = 'https://dycoco-feedback.app.workbuddy.host';
var FB_REST_PATH = '/.cloud/database/rest/feedback';
var FB_ACCESS_KEY = 'wbpk_TczgSmUCbUzky377FNk3Py_RxDXjaBU8BMDzAgt0Jo1f9AngmMn4f1n';

// ── 云端来源校验修正（2026-10-13 三次修）────────────────────────────────
// 现象:用户在 360 极速浏览器X 上提交,报
//   「云端 HTTP 403 → {"error":"access_denied","error_description":
//     "the request origin is not allowed for this client"}」。
// 实测结论（三方对照，全部真跑过，不是推测）:
//   · curl 带 Origin: chrome-extension://xxx、或任意 https 站点 → 一律 403；
//     不带 Origin、或带本应用自己的域名 → 200。网关只放行「本应用域名」这一个来源。
//   · 真实 Chromium 153（无头）里从扩展后台发同一请求，接口取样显示**请求不带 Origin 头**
//     → 200。即：新版内核不给扩展后台请求附加 Origin。
//   · 由此反推你那边：请求是后台发的，唯一可能被网关判为「不合法」的来源就是扩展自身
//     chrome-extension://<扩展ID> —— 老内核会给扩展后台请求附上它。
//     （这一段是推断，不是实测：本机没有 360 极速浏览器X，无法直接抓它的包。）
//   两种内核行为因此不一致，修法要能同时覆盖两边。
// 修法:用 declarativeNetRequest 把去往本应用端点的请求的 Origin 头**改写成本应用自己的
//   域名**（即 FB_ENDPOINT 的 origin），与网关白名单一致。老内核附加的扩展来源被替换掉，
//   新内核本不放 Origin 的也补上这个合法值 —— 两边行为归一，与内核版本无关。
// 为什么用动态规则而不是静态 rules.json:规则值直接由 FB_ENDPOINT 推导，只有一处常量要维护
//   （应用重新发布会换域名，那时改 FB_ENDPOINT 一处即可，本规则自动跟随）。
// 注意:本规则只匹配本应用的 REST 端点，不影响其他任何请求。
var FB_ORIGIN_RULE_ID = 1;
var fbOriginRuleReady = false;

/** 注册（或重注册）来源改写规则。幂等；失败不抛，只记录。 */
function ensureFeedbackOriginRule() {
  if (fbOriginRuleReady) return Promise.resolve();
  if (!chrome.declarativeNetRequest) return Promise.resolve();
  var origin;
  var host;
  try {
    origin = new URL(FB_ENDPOINT).origin;
    host = new URL(FB_ENDPOINT).host;
  } catch (e) {
    return Promise.resolve();
  }
  return chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: [FB_ORIGIN_RULE_ID],
    addRules: [{
      id: FB_ORIGIN_RULE_ID,
      priority: 1,
      action: {
        type: 'modifyHeaders',
        requestHeaders: [{ header: 'origin', operation: 'set', value: origin }]
      },
      condition: {
        urlFilter: '||' + host + FB_REST_PATH,
        resourceTypes: ['xmlhttprequest']
      }
    }]
  }).then(function () {
    fbOriginRuleReady = true;
  }).catch(function (e) {
    // 注册不上就继开始下一轮请求，让云端错误原样暴露（不在这里制造第二个黑盒）
    console.error('[DY-COCO] 反馈来源修正规则注册失败，老内核上提交可能仍被 403：', e);
  });
}

// 脚本一启动就尝试注册（故意不 await：不要拖慢下面监听器的注册）
ensureFeedbackOriginRule();

/** 把任何被抛出的东西变成一句人话（字符串 / 空值 / Error / 普通对象都要能读出来） */
function describeThrown(e) {
  if (e === undefined) return 'undefined(被 reject 了一个空值)';
  if (e === null) return 'null';
  if (typeof e === 'string') return e;
  if (typeof e !== 'object') return typeof e + ': ' + String(e);
  var parts = [];
  ['name', 'message', 'code', 'status', 'statusText', 'details', 'hint'].forEach(function (k) {
    var v = e[k];
    if (v === undefined || v === null || v === '') return;
    parts.push(k + '=' + (typeof v === 'object' ? describeThrown(v) : String(v)));
  });
  if (!parts.length) {
    try { parts.push('JSON=' + JSON.stringify(e)); } catch (_) { parts.push('(无法序列化)'); }
  }
  return parts.join(' | ');
}

/** 压成一行并截断（响应体可能是整页 HTML，不能原样塞进提示条） */
function shortenText(s, n) {
  var t = String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
  return t.length > n ? t.slice(0, n) + '…' : t;
}

/**
 * 写入一条反馈。返回 {ok:true} 或 {ok:false, error:可读原因}。
 * 注意：record 里的截图是 base64 dataURI，单条可能到十几 MB —— 由面板侧压缩控制。
 * （已实测：云端对 16MB 载荷照样返回 201，所以体积不是拒绝原因。）
 */
/**
 * 客户端持久 ID（2026-10-14 新增）—— 让服务端限流按「人」计，而不是按浏览器 UA。
 *
 * 为什么放在后台、而不是页面侧（评审稿原写的是改 panel.js + feedback.js，此处收窄为一处）：
 *   panel.js 是内容脚本，它的 localStorage 属于**宿主页面域**（抖店有 fxg / buyin 等多个
 *   域名），换域就换 ID；feedback.js 虽在扩展页里，但两边各存一份必然分裂成两个身份。
 *   后台的 chrome.storage.local 是扩展级、跨站一致，一处即可覆盖浮层与小窗两条路径。
 *
 * 取不到（storage 异常）时返回空串 —— 服务端会回退到 UA 指纹，不阻断提交。
 */
var CLIENT_KEY_STORE = 'dyc_client_id';

async function getClientKey() {
  try {
    var got = await chrome.storage.local.get(CLIENT_KEY_STORE);
    var id = got && got[CLIENT_KEY_STORE];
    if (typeof id === 'string' && id.length >= 16) return id;
    id = newClientKey();
    await chrome.storage.local.set({ [CLIENT_KEY_STORE]: id });
    return id;
  } catch (e) {
    return '';
  }
}

/** 32 位十六进制随机串。不用 padStart —— 老内核不一定支持 ES2017。 */
function newClientKey() {
  try {
    var a = new Uint8Array(16);
    crypto.getRandomValues(a);
    var s = '';
    for (var i = 0; i < a.length; i++) s += (a[i] < 16 ? '0' : '') + a[i].toString(16);
    return s;
  } catch (e) {
    var t = '';
    for (var j = 0; j < 32; j++) t += Math.floor(Math.random() * 16).toString(16);
    return t;
  }
}

async function submitFeedback(record) {
  // 客户端 ID：已有则尊重调用方给的值；没有就补一个。
  if (!record.client_key) {
    var ck = await getClientKey();
    if (ck) record.client_key = ck;
  }

  var body;
  try {
    body = JSON.stringify(record);
  } catch (e) {
    return { ok: false, error: '记录无法序列化 → ' + describeThrown(e) };
  }

  var res;
  try {
    // 先把来源改写规则装好（幂等）。装不上也照发，让云端错误原样暴露。
    await ensureFeedbackOriginRule();
    res = await fetch(FB_ENDPOINT + FB_REST_PATH, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-wb-webapp-access-key': FB_ACCESS_KEY
      },
      body: body
    });
  } catch (e) {
    // 「请求根本没发出去」（断网 / 被拦 / 跨源被拒）必须与「云端拒绝」分开报，
    // 否则又会回到「只看到一句网络异常」的老问题。
    console.error('[DY-COCO] 反馈提交：请求未发出', e);
    return { ok: false, error: '请求未发出 → ' + describeThrown(e) };
  }

  var text = '';
  try { text = await res.text(); } catch (e) { text = '(响应体读取失败)'; }

  if (res.status >= 200 && res.status < 300) {
    // 2xx 也看一眼 body：平台正常时返回 {success:true,...}
    try {
      var j = text ? JSON.parse(text) : null;
      if (j && j.error) {
        console.error('[DY-COCO] 反馈提交：2xx 但带错误体', j);
        return { ok: false, error: '云端受理但返回错误 → ' + describeThrown(j.error) };
      }
    } catch (_) { /* 非 JSON 的 2xx 视为成功 */ }
    return { ok: true };
  }

  console.error('[DY-COCO] 反馈提交：云端拒绝', res.status, text);
  return {
    ok: false,
    error: '云端 HTTP ' + res.status + (res.statusText ? ' ' + res.statusText : '') +
      (text ? ' → ' + shortenText(text, 200) : '')
  };
}

/* ---------- 反馈浮层的注入（2026-10-13 三次修：兼容国产老内核） ---------- */

/**
 * 把 callback 风格的 chrome API 包成 Promise。
 *
 * 为什么不用内核自带的 Promise 形式：
 *   本扩展要同时覆盖新版 Chromium 与 360 极速浏览器X 这类国产老内核。
 *   老内核上部分 API（tabs.query / scripting.executeScript 等）不返回 Promise，
 *   await 拿到的是 undefined，于是「查不到标签 → 判定无法注入 → 退回独立小窗」，
 *   用户看到的现象就是「反馈又变回一个独立小窗口」。
 *   统一走 callback + chrome.runtime.lastError，行为与内核版本无关。
 * 超时兜底：个别内核回调不触发时不至于把流程挂死（默认 4 秒）。
 */
function chromeCb(fn, timeoutMs) {
  return new Promise(function (resolve, reject) {
    var settled = false;
    var timer = setTimeout(function () {
      if (settled) return;
      settled = true;
      reject(new Error('调用超时'));
    }, timeoutMs || 4000);
    var fire = function (value, isErr) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (isErr) reject(new Error(value)); else resolve(value);
    };
    try {
      fn(function (res) {
        var err = chrome.runtime.lastError;
        fire(err ? (err.message || String(err)) : res, !!err);
      });
    } catch (e) {
      fire((e && e.message) || String(e), true);
    }
  });
}

function delayMs(ms) {
  return new Promise(function (r) { setTimeout(r, ms); });
}

/**
 * URL 是否落在本扩展 host_permissions 覆盖的站点内。
 * 这些站点无需 activeTab 就能注入面板；其余页面只能靠 activeTab（点扩展图标时
 * 临时授予当前标签）碰运气。**改此处必须同步 manifest.json 的 host_permissions。**
 */
function isHostPermittedUrl(url) {
  return /^https:\/\/(fxg|buyin)\.jinritemai\.com\/|^https:\/\/(?:store|channels)\.weixin\.qq\.com\//i.test(url || '');
}

/**
 * 按「最可能被用户当成当前页」的顺序列出可注入候选标签。
 *
 * 为什么不再用 tabs.query({currentWindow:true})：
 *   360 极速浏览器X 这类内核把扩展弹窗实现成独立窗口，popup 一打开
 *   currentWindow 就指向弹窗自己，其活动标签是扩展页（chrome-extension://），
 *   旧代码据此直接判定「当前页面无法注入」→ 退回独立小窗。
 *   改为遍历所有窗口挑标签，弹窗窗口(type=popup)一律跳过。
 */
async function listCandidateTabs() {
  var wins = await chromeCb(function (done) {
    chrome.windows.getAll({ populate: true }, done);
  });
  var out = [];
  (wins || []).forEach(function (w) {
    if (!w || w.type === 'popup') return;            // 扩展弹窗不是目标
    (w.tabs || []).forEach(function (t) {
      if (!t || t.id == null) return;
      if (!/^https?:/i.test(t.url || '')) return;    // 特权页 / 扩展页跳过
      out.push({ tab: t, focused: !!w.focused, permitted: isHostPermittedUrl(t.url) });
    });
  });
  out.sort(function (a, b) {
    // 优先级：焦点窗口的活动标签 > host_permissions 覆盖的站点 > 最近访问过
    var sa = (a.focused && a.tab.active ? 4 : 0) + (a.permitted ? 2 : 0) + (a.tab.active ? 1 : 0);
    var sb = (b.focused && b.tab.active ? 4 : 0) + (b.permitted ? 2 : 0) + (b.tab.active ? 1 : 0);
    if (sa !== sb) return sb - sa;
    return (b.tab.lastAccessed || 0) - (a.tab.lastAccessed || 0);
  });
  return out.map(function (x) { return x.tab; });
}

/**
 * 向指定标签注入页面结构探针(2026-10-18 新增)。
 *
 * 与 injectPanelScript 同一套兼容策略:新内核走 scripting,老内核回退
 * MV2 的 tabs.executeScript —— 本机实际用的是 360 极速浏览器X(国产老内核),
 * 这条回退不是可选项。
 *
 * 探针自带防重入(window.__dycProbeRunning),连点两次不会采两份。
 * 注意路径:**不**写进 manifest 的 content_scripts —— 它按需注入,零常驻开销。
 */
function injectProbeScript(tabId) {
  if (chrome.scripting && chrome.scripting.executeScript) {
    return chromeCb(function (done) {
      chrome.scripting.executeScript(
        { target: { tabId: tabId }, files: ['src/content/page-probe.js'] },
        done
      );
    }, 8000);
  }
  if (chrome.tabs && chrome.tabs.executeScript) {
    return chromeCb(function (done) {
      chrome.tabs.executeScript(tabId, { file: 'src/content/page-probe.js' }, done);
    }, 8000);
  }
  return Promise.reject(new Error('本内核既无 chrome.scripting 也无 tabs.executeScript'));
}

/**
 * 向指定标签注入「库存清零·网络监听」的 MAIN world 侧(2026-10-21 新增)。
 *
 * 必须进 MAIN world:页面自己发的 fetch/XHR 只有页面世界的包装才看得到,
 * isolated world 里 hook window.fetch 是无效代码(见 replay-net.js 头注)。
 *
 * world:'MAIN' 需要内核 Chromium 95+;老内核不认识该参数,executeScript
 * 会报「Invalid arguments」—— 这里如实把错误抛给调用方(隔离世界),那里
 * 还有 script 标签 + web_accessible_resources 那条路,两条都失败才算失败。
 * 探针自带防重入,与 script 标签通道谁先谁后、重复注入都无副作用。
 */
/**
 * 把指定脚本直注进 MAIN world(2026-10-31 抽出通用版)。
 *
 * 先给库存清零的网络探针用,现在微信小店的商品链接读取复用同一套:
 * 页面 CSP 会拦 chrome-extension:// 的 script 标签,只能让后台用
 * chrome.scripting 直注。文件在 manifest 的 web_accessible_resources 之外,
 * 直注不受那份白名单限制,但**必须**在 host_permissions 覆盖的域上。
 */
function injectMainFile(tabId, file) {
  if (chrome.scripting && chrome.scripting.executeScript) {
    return chromeCb(function (done) {
      chrome.scripting.executeScript(
        { target: { tabId: tabId }, world: 'MAIN', files: [file] },
        done
      );
    }, 8000);
  }
  return Promise.reject(new Error('本内核没有 chrome.scripting,MAIN world 直注不可用'));
}

function injectStockProbeMain(tabId) {
  return injectMainFile(tabId, 'src/content/stock-net-probe-main.js');
}

/**
 * 经离屏文档读剪贴板(2026-10-24,「粘贴加车」配套)。
 *
 * 为什么必须绕这一圈:内容脚本里 navigator.clipboard.readText() 受**页面**的
 * clipboard-read 权限约束,绝大多数站点没给 ⇒ 拒绝或一直悬着(用户实测点了
 * 没反应、日志一条都没有)。离屏文档带扩展的 clipboardRead 权限,读的是同一块
 * 系统剪贴板,稳定可靠。
 *
 * 离屏文档按需建、建了常驻(开销可忽略,避免反复创建销毁)。
 */
var offscreenReady = null;

/* ==========================================================
 * 统一闹钟兜底(2026-11-01)
 * ----------------------------------------------------------
 * 主通道是离屏文档的 Worker(1 秒一拍)。但离屏文档有前提:内核支持、reasons 被认、
 * 文档能建起来。前两轮实机都是 beat.n = 0,说明这条路在某些环境里不通。
 * ⇒ 建不起来就退到 chrome.alarms,30 秒一拍。
 *   30 秒对「分钟档」完全够用;对 15 秒档会慢一半,但底线是「切到后台别彻底不动」。
 * ========================================================== */
var BEAT_ALARM = 'dyc:beatAlarm';

/* 哪些标签要收拍点。存 storage.session:SW 被回收后重建还能接着发,
 * 否则回收一次循环就静默停摆(这正是要修的问题,不能自己再挖一个)。 */
var beatTabs = {};
var beatTabsReady = false;

function loadBeatTabs() {
  if (beatTabsReady) return Promise.resolve();
  beatTabsReady = true;
  if (!chrome.storage || !chrome.storage.session) return Promise.resolve();
  return chrome.storage.session.get('dycBeatTabs').then(function (r) {
    var saved = (r && r.dycBeatTabs) || {};
    /* 合并而不是覆盖:SW 刚被唤醒时可能已经通过 beatEnsure 记了新标签,
     * 直接赋值会把它们冲掉(表现为「刚开的循环怎么都不动」)。 */
    for (var k in saved) { if (!(k in beatTabs)) beatTabs[k] = saved[k]; }
  }, function () { /* 读不到就当空的 */ });
}

function saveBeatTabs() {
  if (!chrome.storage || !chrome.storage.session) return;
  try { chrome.storage.session.set({ dycBeatTabs: beatTabs }); } catch (e) { /* 忽略 */ }
}

/** 把一拍转发给所有在跑循环的标签。
 *  用 tabs.sendMessage 而不是 runtime 广播:离屏文档发的 runtime 广播实测送不到
 *  内容脚本(2026-11-01 第三次实机:注册=ok:offscreen 但 beat.n 一直是 0),
 *  而 tabs.sendMessage 是工程里一直在用的通道。 */
function relayBeat(at) {
  var ids = Object.keys(beatTabs);
  for (var i = 0; i < ids.length; i++) {
    var id = Number(ids[i]);
    if (!id) continue;
    try {
      chrome.tabs.sendMessage(id, { type: 'dyc:beat', at: at }, function () {
        void chrome.runtime.lastError;
      });
    } catch (e) { /* 单个标签失败不影响其他 */ }
  }
}

function broadcastBeat() {
  relayBeat(Date.now());
}

function startAlarmBeat() {
  if (!chrome.alarms || !chrome.alarms.create) return false;
  try {
    chrome.alarms.create(BEAT_ALARM, { periodInMinutes: 0.5 });
    return true;
  } catch (e) {
    return false;
  }
}

/** 没有标签在收拍点了 → 停掉兜底闹钟（2026-11-01 体检 P1）。
 *  原来全项目没有一处 alarms.clear，兜底闹钟一旦建起永不清理。 */
function maybeStopBeatAlarm() {
  if (Object.keys(beatTabs).length) return;
  try {
    if (chrome.alarms && chrome.alarms.clear) chrome.alarms.clear(BEAT_ALARM);
  } catch (e) { /* 忽略 */ }
}

/**
 * 离屏文档:一个扩展同时只能有一个,所以不按用途拆,统一当"离屏宿主"用。
 *   ① 剪贴板代读(2026-10-24)
 *   ② 统一闹钟(2026-11-01):后台标签被浏览器节流后,靠它给中控台页面打拍子
 *
 * reasons 要覆盖实际用途,否则属于理由不实:
 *   CLIPBOARD —— 读剪贴板
 *   WORKERS   —— 闹钟的节拍器跑在 Worker 里(Worker 不参与页面可见性节流)
 */
function ensureOffscreen() {
  if (offscreenReady) return offscreenReady;
  if (!(chrome.offscreen && chrome.offscreen.createDocument)) {
    return Promise.reject(new Error('本内核不支持离屏文档'));
  }
  offscreenReady = new Promise(function (resolve, reject) {
    /* reasons 逐级降级:WORKERS 是为闹钟的 Worker 申请的,万一某个内核不认这个枚举,
     * createDocument 会整体失败 —— 那会把已经稳定的「粘贴加车」一起弄坏。
     * 所以失败就退回只报 CLIPBOARD:退回去之后 ticker 的 Worker 照样能跑
     * (reason 只影响申请用途,不限制文档里能做什么),功能不丢,只是理由窄一点。 */
    var tries = [
      ['CLIPBOARD', 'WORKERS'],
      ['CLIPBOARD']
    ];
    function attempt(i) {
      if (i >= tries.length) {
        offscreenReady = null;   // 失败允许下次重试
        reject(new Error('离屏文档建不起来'));
        return;
      }
      chrome.offscreen.createDocument({
        url: 'src/offscreen/host.html',
        reasons: tries[i],
        justification: '代读剪贴板中的商品链接;并在中控台被切到后台后继续提供统一拍点,保证自动循环讲解不中断'
      }, function () {
        var err = chrome.runtime.lastError;
        if (!err || /already exists/i.test(err.message || '')) {
          resolve(true);
          return;
        }
        if (i + 1 < tries.length) { attempt(i + 1); return; }
        offscreenReady = null;   // 失败允许下次重试
        reject(new Error(err.message || String(err)));
      });
    }
    attempt(0);
  });
  return offscreenReady;
}

/**
 * 把某个中控台标签登记进闹钟(2026-11-01)。
 *
 * 为什么要绕 SW 这一圈:离屏文档可能在内容脚本发消息时**还没建**(它是按需创建的),
 * 那一次注册会丢。所以由这里统一"先确保离屏文档存在,再把 tabId 补登记进去"。
 */
function registerBeat(tabId) {
  if (!tabId) return Promise.resolve(null);
  return ensureOffscreen().then(function () {
    return chromeCb(function (done) {
      chrome.runtime.sendMessage({ type: 'dyc:beatReg', tabId: tabId }, done);
    }, 3000);
  });
}

function readClipboardViaOffscreen() {
  return ensureOffscreen().then(function () {
    return chromeCb(function (done) {
      chrome.runtime.sendMessage({ type: 'dyc:offscreenReadClipboard' }, done);
    }, 5000);
  }).then(function (res) {
    var r = res || {};
    return { ok: !!r.ok, text: r.text || '', error: r.error || '' };
  }, function (e) {
    return { ok: false, text: '', error: (e && e.message) || String(e) };
  });
}

/**
 * 剪贴板里的图片(2026-11-08)。
 *
 * 与 readClipboardViaOffscreen 是同一个离屏文档、同一套代读理由,区别只在:
 *   · 回执是一条 dataURL(图片过不了 runtime 消息,Blob/File 不是可克隆对象)
 *   · 超时放宽到 8 秒:大图 readAsDataURL 在国产老内核上明显更慢
 *
 * 失败一律回 {ok:false,error},由内容脚本决定提示文案 —— 后台不判断"该怎么降级"。
 */
function readClipboardImageViaOffscreen() {
  return ensureOffscreen().then(function () {
    return chromeCb(function (done) {
      chrome.runtime.sendMessage({ type: 'dyc:offscreenReadClipboardImage' }, done);
    }, 8000);
  }).then(function (res) {
    var r = res || {};
    return {
      ok: !!r.ok,
      dataUrl: r.dataUrl || '',
      mime: r.mime || '',
      size: r.size || 0,
      error: r.error || (r.ok ? '' : '剪贴板读取无回执')
    };
  }, function (e) {
    return { ok: false, dataUrl: '', mime: '', size: 0, error: (e && e.message) || String(e) };
  });
}

/**
 * 向指定标签注入反馈面板。新内核走 scripting，老内核回退 MV2 的 tabs.executeScript。
 *
 * 2026-10-13（反馈诊断包）：注入面板前先补一次 diag.js。
 * 为什么必须在这里补：manifest 的 content_scripts **只在页面加载那一刻**注入，
 * 而「扩展刚更新完、页面还开着」是用户最常反馈问题的时刻 —— 那种旧标签页里
 * 没有 diag.js，采集会整项缺失。diag.js 自带防重复（window.__dycDiag 已存在即返回），
 * 所以对已经注入过的新页面重复执行是安全的、无副作用的。
 */
function injectPanelScript(tabId) {
  if (chrome.scripting && chrome.scripting.executeScript) {
    return chromeCb(function (done) {
      chrome.scripting.executeScript(
        { target: { tabId: tabId }, files: ['src/content/diag.js', 'src/feedback/panel.js'] },
        done
      );
    }, 6000);
  }
  if (chrome.tabs && chrome.tabs.executeScript) {
    // 过渡期内核仍保留这个接口，作为最后一条注入路径（不支持数组，需分两次）。
    return chromeCb(function (done) {
      chrome.tabs.executeScript(tabId, { file: 'src/content/diag.js' }, function () {
        void chrome.runtime.lastError;      // 采集内核装不上也不能挡住面板
        chrome.tabs.executeScript(tabId, { file: 'src/feedback/panel.js' }, done);
      });
    }, 6000);
  }
  return Promise.reject(new Error('当前浏览器不支持脚本注入'));
}

/**
 * 注入成功后补发一次「按 mode 打开」（2026-11-03 修 #129 首屏落错 Tab）。
 *
 * 为什么必须补：injectPanelScript 只是把 panel.js 塞进页面。panel.js 首次运行
 * 走的是启动段（只 display='flex'，不调用 open(mode)），Tab 停在 HTML 静态默认
 * 的「反馈」；只有收到 dyc:fbToggle 才会走 open(mode) → setTab。所以「第一次点
 * 更新日志落反馈、第二次才对」的根因就是这里缺了这一发。
 *
 * 为什么带重试：注入是异步的，脚本执行完成与监听器注册之间理论上存在窗口
 * （脚本较长、老内核调度慢）。重复发送是幂等的 —— open() 只改显示状态，
 * 不会叠加第二份面板。
 *
 * @returns {Promise<boolean>} 是否成功送达
 */
async function nudgeFeedbackPanelMode(tabId, mode) {
  var want = mode || 'feedback';
  for (var i = 0; i < 3; i++) {
    try {
      await chromeCb(function (done) {
        chrome.tabs.sendMessage(tabId, { type: 'dyc:fbToggle', mode: want }, done);
      }, 2000);
      return true;
    } catch (e) {
      if (i < 2) await delayMs(120);
    }
  }
  return false;
}

/* ────────────────────────────────────────────────────────────────────
 * 版本日志数据(#106 · 2026-10-24 迭代:并入反馈浮层,独立 changelog 页删除)
 *
 * 为什么由后台代拉(与反馈提交同一道理):
 *   浮层跑在 content script 里,fetch 以「宿主页面」为源 —— 抖音页的 CSP
 *   会拦掉跨域请求,拉标签列表/RELEASE_NOTES 必须在后台做(本文件顶部
 *   importScripts 已引入 gitee.js,WEB/isVersionTag/compareVersion/fetchRawFile 全在)。
 *
 * 链路:面板/兜底小窗连 Port(dyc-changelog) → 这里拉 tags.atom 列标签 +
 *   逐标签 raw 拉 RELEASE_NOTES.md → 解析成卡片数据回传。
 *   · 5 分钟内存缓存:切走再切回秒开,也免得每次开关面板都打仓库;
 *   · fresh=true 跳过内存缓存读(重试按钮用;拉取中途失败本就不写缓存);
 *   · 各版解析结果按 tag 持久缓存在 chrome.storage.local(2026-11-03 新增,见下);
 *   · 解析统一调用 DYC_GITEE.parseReleaseNotes，与更新亮点共用。
 *   · 纯展示数据:不碰更新链路,任何失败都不弹系统对话框。
 * ──────────────────────────────────────────────────────────────────── */
var CL_CACHE_TTL = 5 * 60 * 1000;
var clCache = { at: 0, data: null, list: null };

/* ★ 2026-11-07(#132 用户口径):「更新日志一次只展开 5 个,往下滑再继续展开」。
 *
 * 版本标签列表仍是全量拿(标签源一次能拿全),但**日志正文按需分批拉**:
 *   · 首屏只拉前 CL_PAGE_SIZE 个未缓存标签的 RELEASE_NOTES;
 *   · 用户滑到底,前端发 {cmd:'more', tags:[…]},再拉下一批;
 *   · 未展开的版本一个请求都不发。
 * 为什么必须这样:.md 不走 CDN,每个未缓存标签固定烧 1 次 GitHub 匿名配额
 * (60 次/小时);原来一次打开最多烧 60+,现在最多烧用户真正看到的那些。
 * 单版本要点统一由 DYC_GITEE.parseReleaseNotes 限为 5 条。 */
var CL_PAGE_SIZE = 5;

/* ★ 各版日志的持久缓存（2026-11-03，2026-11-06 扩容）
 *
 * 为什么必须有：RELEASE_NOTES.md 是 .md，按 gitee.js 的混合读法不走 jsDelivr
 * CDN（.md 会被 301 到 raw，部分网络不可达）⇒ 每个标签固定消耗 1 次
 * api.github.com 匿名配额（60 次/小时）。
 *
 * 为什么可以永久缓存：标签一经推送，其内容就视为不可变（AGENTS.md 的
 * 「同名标签不重建、要改就发新版本号」纪律）。所以「某个 tag 的解析结果」
 * 是稳定值，只有**新出现的标签**才值得花那一次配额。
 *
 * schema 版本：解析规则（clParseNotes）或缓存结构变了就 +1，旧缓存自动作废。
 *   2026-11-06 v2：条目新增 m（该版本确实没有日志文件）标记，避免
 *   「两源都 404」的版本每次打开面板都重新请求一遍。
 */
var CL_NOTES_STORE = 'dycChangelogNotes';
var CL_NOTES_SCHEMA = 3;
var CL_NOTES_KEEP = 120;  // 标签总数约 70，留足余量；防键值无限膨胀

// 后台补拉的并发：4 是「够快」与「不打爆 Gitee raw」之间的折中。
var CL_FILL_CONCURRENCY = 4;

/** 缓存结构是否可用（结构不对/版本不符一律当没有）。 */
function clNotesCacheValid(v) {
  return !!v && typeof v === 'object' && v.schema === CL_NOTES_SCHEMA
    && !!v.tags && typeof v.tags === 'object';
}

/** 读持久缓存 → { tag: {s:摘要, i:[要点]} }；读不到或结构不对返回空对象。 */
function clReadNotesCache() {
  try {
    return chrome.storage.local.get(CL_NOTES_STORE).then(function (got) {
      var v = got && got[CL_NOTES_STORE];
      return clNotesCacheValid(v) ? v.tags : {};
    }, function () { return {}; });
  } catch (e) {
    return Promise.resolve({});
  }
}

/** 写持久缓存。写失败只影响下次要不要多花配额，绝不影响本次展示。 */
function clWriteNotesCache(tagsMap) {
  try {
    return chrome.storage.local.set({
      [CL_NOTES_STORE]: { schema: CL_NOTES_SCHEMA, tags: tagsMap }
    }).catch(function () { /* 配额/磁盘异常都忽略 */ });
  } catch (e) {
    return Promise.resolve();
  }
}

/**
 * 裁剪缓存：只留**当前仓库里仍存在**的最新 CL_NOTES_KEEP 个标签。
 * 仓库侧已删掉的标签、以及超出上限的老标签，解析结果留着也没人看。
 */
function clTrimNotesCache(map, tags) {
  var out = {};
  var n = 0;
  for (var i = 0; i < tags.length && n < CL_NOTES_KEEP; i++) {
    var k = tags[i].tag;
    if (Object.prototype.hasOwnProperty.call(map, k)) { out[k] = map[k]; n++; }
  }
  return out;
}

function clParseNotes(text) {
  return DYC_GITEE.parseReleaseNotes(text);
}

/** ArrayBuffer → UTF-8 字符串。TextDecoder 不在的老内核走手工解码兜底。 */
function clDecodeUtf8(buf) {
  if (typeof TextDecoder === 'function') {
    return new TextDecoder('utf-8').decode(buf);
  }
  var b = new Uint8Array(buf);
  var out = '';
  var i = 0;
  while (i < b.length) {
    var c = b[i];
    if (c < 0x80) { out += String.fromCharCode(c); i += 1; }
    else if (c < 0xE0) {
      out += String.fromCharCode(((c & 0x1F) << 6) | (b[i + 1] & 0x3F)); i += 2;
    } else if (c < 0xF0) {
      out += String.fromCharCode(((c & 0x0F) << 12) | ((b[i + 1] & 0x3F) << 6) | (b[i + 2] & 0x3F));
      i += 3;
    } else {
      var cp = ((c & 0x07) << 18) | ((b[i + 1] & 0x3F) << 12)
        | ((b[i + 2] & 0x3F) << 6) | (b[i + 3] & 0x3F);
      cp -= 0x10000;
      out += String.fromCharCode(0xD800 + (cp >> 10), 0xDC00 + (cp & 0x3FF));
      i += 4;
    }
  }
  return out;
}

/**
 * 标签列表：走统一更新源（主源 Gitee，失败自动切备用源 GitHub）。
 *
 * ★ 2026-11-01：原先这里直接 fetch(DYC_GITEE.WEB + '/tags.atom')，
 *   Gitee 被封后该 URL 恒 404 → 版本日志面板整体失效。
 *   现改为调 DYC_GITEE.fetchTagList()，主备切换逻辑集中在 shared/gitee.js，
 *   本文件不再自带任何 Gitee 专属地址。
 */
function clFetchTags() {
  return DYC_GITEE.fetchTagList();
}

/**
 * 限并发跑任务:results 与 tasks 同序;单个失败落 {error} 不拖累整体。
 * onTick(done, total) 用来给面板刷「正在读取 x/y」的进度。
 * onItem(index, result) 每完成一个就回调一次 —— 全量日志靠它边拉边补，
 *   让面板不必等 68 个版本全读完才显示内容（2026-11-06）。
 */
function clPool(tasks, runN, worker, onTick, onItem) {
  return new Promise(function (resolve) {
    var results = new Array(tasks.length);
    var next = 0;
    var done = 0;
    function launch() {
      if (next >= tasks.length) return;
      var i = next++;
      worker(tasks[i]).then(function (r) {
        results[i] = r;
      }, function (e) {
        results[i] = { error: (e && e.message) || String(e) };
      }).then(function () {
        done++;
        try { onTick(done, tasks.length); } catch (e2) { /* 进度回调出错不拖累 */ }
        if (typeof onItem === 'function') {
          try { onItem(i, results[i]); } catch (e3) { /* 增量回调出错不拖累 */ }
        }
        if (done >= tasks.length) resolve(results);
        else launch();
      });
    }
    for (var k = 0; k < runN && k < tasks.length; k++) launch();
  });
}

async function buildChangelog(fresh, emit) {
  var list, items, cached;
  var reuse = !fresh && clCache.data && clCache.list
    && Date.now() - clCache.at < CL_CACHE_TTL;
  if (reuse) {
    // 5 分钟内的重开:列表与已拉结果直接复用,不再打仓库。
    list = clCache.list;
    items = clCache.data.items.slice();
    cached = await clReadNotesCache();
  } else {
    var tags;
    try {
      tags = await clFetchTags();
    } catch (e) {
      emit({ type: 'error', message: (e && e.message) || String(e) });
      return null;
    }
    list = tags;
    cached = await clReadNotesCache();
    items = new Array(list.length);
    for (var i = 0; i < list.length; i++) {
      var tag = list[i].tag;
      if (Object.prototype.hasOwnProperty.call(cached, tag)) {
        items[i] = clItemFromCache(tag, list[i].date, cached[tag]);
      } else {
        // 未缓存:先占位,滑到它时再拉(#132)。
        items[i] = { tag: tag, date: list[i].date, notes: null, loading: true };
      }
    }
  }

  // 首屏立刻出:items 是全量快照(前端自己只展开前 5 个),缓存命中的版本
  // 马上可看,未命中的显示「读取中」。★ 发的是快照不是活引用,理由同旧版。
  emit({
    type: 'done',
    data: {
      items: items.slice(),
      localVersion: chrome.runtime.getManifest().version,
      webUrl: DYC_GITEE.TAGS_PAGE,
      total: list.length,
      pending: 0,
      pageSize: CL_PAGE_SIZE
    }
  });

  var job = clMakeJob(list, items, cached, emit);
  // 只拉首屏那批(#132):其余等前端滑到底、按批来要。
  var first = [];
  for (var j = 0; j < list.length && first.length < CL_PAGE_SIZE; j++) first.push(list[j].tag);
  await clFetchInto(job, first);

  clCache = {
    at: Date.now(),
    data: {
      items: items.slice(),
      localVersion: chrome.runtime.getManifest().version,
      webUrl: DYC_GITEE.TAGS_PAGE,
      total: list.length,
      pending: 0,
      pageSize: CL_PAGE_SIZE
    },
    list: list
  };
  emit({ type: 'complete' });
  return job;
}

/** 一次「打开日志面板」会话的上下文:列表、数据、缓存与回传函数。
 *  Port 在面板开着期间常驻(#132 滑到底还要按批拉),每个 Port 一份。 */
function clMakeJob(list, items, cached, emit) {
  var index = {};
  for (var i = 0; i < list.length; i++) index[list[i].tag] = i;
  return { list: list, items: items, index: index, cached: cached, inflight: {}, dirty: false, emit: emit };
}

/**
 * 保证这批 tag 的日志已拉取(已有结果/在途的跳过),拉完写持久缓存。
 * #132:前端滑到哪批就拉哪批;未展开的版本一个请求都不发。
 */
async function clFetchInto(job, tags) {
  var todo = [];
  for (var i = 0; i < tags.length; i++) {
    var tag = String(tags[i] || '');
    var idx = job.index[tag];
    if (idx === undefined) continue;
    var it = job.items[idx];
    if (it.notes || it.missing || it.error) continue;   // 已有结果
    if (job.inflight[tag]) continue;                    // 在途,别重复烧配额
    job.inflight[tag] = true;
    todo.push(tag);
  }
  if (!todo.length) return;
  await clPool(todo, CL_FILL_CONCURRENCY, function (t) {
    return DYC_GITEE.fetchRawFile(t, 'RELEASE_NOTES.md').then(function (buf) {
      return { notes: clParseNotes(clDecodeUtf8(buf)) };
    }, function (e) {
      // ★ 区分两种失败（2026-11-06）：
      //   noRetry = 两个源都确认没有这个文件 ⇒ 该版本确实没附日志，可缓存；
      //   其它（超时/5xx/限流）= 临时故障 ⇒ 只标错、不缓存，下次再试。
      return { error: (e && e.message) || String(e), missing: !!(e && e.noRetry) };
    });
  }, function (done, total) {
    job.emit({ type: 'progress', done: done, total: total });
  }, function (k, row) {
    var tag = todo[k];
    delete job.inflight[tag];
    var idx = job.index[tag];
    if (idx === undefined) return;
    var date = job.list[idx].date;
    var patch = { type: 'patch', tag: tag };

    if (row && row.missing) {
      // 两源都没有 → 确定性缺失，写进缓存，免得以后再白问一遍
      job.items[idx] = { tag: tag, date: date, notes: null, missing: true };
      job.cached[tag] = { s: '', i: [], m: 1 };
      job.dirty = true;
      patch.missing = true;
    } else if (row && row.error) {
      // 临时故障：只坏这一张卡，不进缓存，下次再试
      job.items[idx] = { tag: tag, date: date, error: row.error };
      patch.error = row.error;
    } else {
      var nn = (row && row.notes) || null;
      job.items[idx] = { tag: tag, date: date, notes: nn };
      job.cached[tag] = { s: (nn && nn.summary) || '', i: (nn && nn.items) || [], m: nn ? 0 : 1 };
      job.dirty = true;
      patch.notes = nn;
    }
    job.emit(patch);
  });
  // 写失败不影响本次展示，只是下次还要再花配额。
  if (job.dirty) {
    job.dirty = false;
    await clWriteNotesCache(clTrimNotesCache(job.cached, job.list));
  }
}

/**
 * 缓存条目 → 面板用的 item。
 * m=1 表示「两个源都确认这个版本没有日志文件」，显示成缺失而不是读取中。
 */
function clItemFromCache(tag, date, c) {
  var v = c || {};
  if (v.m) return { tag: tag, date: date, notes: null, missing: true };
  var has = v.s || (v.i && v.i.length);
  return {
    tag: tag,
    date: date,
    notes: has ? { summary: v.s || '', items: v.i || [] } : null,
    fromCache: true
  };
}

chrome.runtime.onConnect.addListener(function (port) {
  if (!port || port.name !== 'dyc-changelog') return;
  var dead = false;
  var job = null;
  port.onDisconnect.addListener(function () { dead = true; });
  port.onMessage.addListener(function (msg) {
    if (!msg) return;
    if (msg.cmd === 'get') {
      buildChangelog(!!msg.fresh, function (ev) {
        if (dead) return;
        try { port.postMessage(ev); } catch (e) { dead = true; }
      }).then(function (j) { job = j; }, function () { /* 失败已 emit error */ });
      return;
    }
    if (msg.cmd === 'more' && job && !dead) {
      // #132:前端滑到底,把新展开那批的 tag 送来按需拉取。
      clFetchInto(job, msg.tags || []).catch(function () { /* 单批失败不拖垮会话 */ });
    }
  });
});

/**
 * 调一个 chrome API，同时接住「回调形态」与「Promise 形态」（2026-11-08）。
 *
 * 为什么必须两种都接：本机实际内核是 360 极速浏览器X，它对
 * `chrome.scripting.*` 只给 Promise、回调永不触发的情况确实存在 —— 旧封装
 * `chromeCb` 只等回调，于是探针每次 8 秒超时被判「探不到」，补注入直接放弃。
 * 用户看到的现象就是「切进中控台一个按钮都没有，刷新一次又好了」。
 *
 * 两种形态谁先回来用谁，另一个的结果直接丢弃（同一调用不会执行两次：
 * 回调与 Promise 反映的是同一次注入）。
 *
 * @param {function(function(*)): *} invoke 接收 done 回执的函数，返回值可能是 Promise
 * @param {number} timeoutMs 超时上限
 */
function dualCall(invoke, timeoutMs) {
  return new Promise(function (resolve, reject) {
    var settled = false;
    var timer = setTimeout(function () {
      if (settled) return;
      settled = true;
      reject(new Error('调用超时'));
    }, timeoutMs || 8000);

    function fin(err, res) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (err) reject(err instanceof Error ? err : new Error(String(err)));
      else resolve(res);
    }

    try {
      var ret = invoke(function (res) {
        var e = chrome.runtime.lastError;
        fin(e ? (e.message || String(e)) : null, res);
      });
      if (ret && typeof ret.then === 'function') {
        ret.then(function (res) { fin(null, res); },
          function (e) { fin((e && e.message) || String(e)); });
      }
    } catch (e) {
      fin((e && e.message) || String(e));
    }
  });
}

/**
 * 探「某个脚本分组的在场标记是否已置」。
 *
 * 两条通道：新内核走 chrome.scripting 的 func；老内核（MV2 风格、仍保留
 * tabs.executeScript）走 code 片段 —— 两者都在扩展的 isolated world 里执行，
 * 读的是同一个标记。MV3 禁止 new Function，使用静态函数与 args 传参；
 * 旧内核仍走原有 tabs.executeScript 的 code 通道。
 *
 * @param {number} tabId
 * @param {string} markerKey 如 '__DYC_LIVE_CTRL_LOADED__'
 * @returns {Promise<boolean>}
 */
function probeLoaded(tabId, markerKey) {
  var target = { tabId: tabId, frameIds: [0] };
  if (chrome.scripting && chrome.scripting.executeScript) {
    return dualCall(function (done) {
      return chrome.scripting.executeScript({
        target: target,
        func: function (key) { return !!window[key]; },
        args: [markerKey]
      }, done);
    }, 6000).then(function (r) { return !!(r && r[0] && r[0].result); });
  }
  if (chrome.tabs && chrome.tabs.executeScript) {
    return dualCall(function (done) {
      return chrome.tabs.executeScript(tabId,
        { code: 'window["' + markerKey + '"]===true' }, done);
    }, 6000).then(function (r) { return !!(r && r[0]); });
  }
  return Promise.reject(new Error('本内核既无 chrome.scripting 也无 tabs.executeScript'));
}

/**
 * 注入**单个**脚本文件。返回 Promise，失败即 reject（由调用方逐个记账）。
 *
 * 为什么必须逐个注入（2026-11-08）：
 *   `executeScript({files: [26 个]})` 是一个整体调用，其中任一文件抛错，
 *   整个调用就 reject，**后面的文件全部不执行** —— 而清单末位是 toolbar.js，
 *   它不在，工具栏与所有按钮就都不出现。逐文件注入把「一处失败」的爆炸半径
 *   压到那一个文件，并让失败文件可枚举、可写进诊断。
 */
function injectOneLiveFile(tabId, file) {
  var target = { tabId: tabId, frameIds: [0] };
  if (chrome.scripting && chrome.scripting.executeScript) {
    return dualCall(function (done) {
      return chrome.scripting.executeScript({ target: target, files: [file] }, done);
    }, 10000);
  }
  if (chrome.tabs && chrome.tabs.executeScript) {
    return dualCall(function (done) {
      return chrome.tabs.executeScript(tabId, { file: file }, done);
    }, 10000);
  }
  return Promise.reject(new Error('本内核既无 chrome.scripting 也无 tabs.executeScript'));
}

/**
 * 把某个脚本分组补注入到当前标签页（2026-11-05 建，2026-11-08 泛化 + 健壮性重写）。
 *
 * 为什么要补：content_scripts 只在导航时注入。中控台/橱窗那两条 matches 是
 * `…/live/control*`、`…/dashboard/shopwindow/*`，而巨量百应后台是 SPA ——
 * 页签切换是 pushState，document 不重载，matches 永远等不到导航。结果就是
 * 「先开别的页、再切进子页」时所有功能都不出现，必须刷新一次。
 *
 * 为什么先探再注：原生注入与本函数都会往同一个 isolated world 里执行同一批
 * 文件。重复执行的代价不是「多余一次」，而是 ——
 *   · anchor.js / dialog.js / row-scan.js 有**顶层 const**，第二次执行整段
 *     抛 SyntaxError，那三个文件等于没跑；
 *   · 其余模块会叠出第二套 observer 与定时器，讲解/福袋直接双开。
 * 所以标记（live-control-flag.js / shopwindow-flag.js）必须在场即跳过。
 *
 * 2026-11-08 改了三处（用户复报同一现象）：
 *   ① 探针改 dualCall：只认回调会在这台内核上必超时，探不到就永不注入；
 *   ② 逐文件注入：一处失败不再连坐后面的 toolbar.js；
 *   ③ 注入后回探标记，把「装没装上」如实回报给页面侧探子，由它决定是否重试。
 * 2026-11-08 又加一处分组化（用户再报：百应主页分页切橱窗也不生效）：
 *   探子分区后，本函数按 (清单, 标记, 分区名) 参数化，中控台/橱窗共用同一套
 *   「探标记 → 插样式 → 逐个注入 → 回探标记」流程，不再各写一份。
 *
 * @param {Object} sender 消息发送者，取 tabId
 * @param {Object} assets 注入清单（DYC_LIVE_CONTROL_ASSETS / DYC_SHOPWINDOW_ASSETS）
 * @param {string} markerKey 该分组的在场标记（window 属性名）
 * @param {string} label 分区名（进错误信息，便于诊断区分）
 * @returns {Promise<{ok:boolean, skipped?:boolean, installed?:boolean,
 *                    count?:number, total?:number, failed?:string[], error?:string}>}
 */
async function injectAssetGroup(sender, assets, markerKey, label) {
  const tabId = sender && sender.tab && sender.tab.id;
  if (tabId == null) return { ok: false, error: '拿不到标签页' };

  if (!assets || !Array.isArray(assets.js) || !assets.js.length) {
    return { ok: false, error: label + '注入清单缺失' };
  }

  // 探标记：探到失败重试一次（偶发超时不等于通道不可用）
  let loaded = false;
  let probeErr = null;
  for (let i = 0; i < 2; i++) {
    try {
      loaded = await probeLoaded(tabId, markerKey);
      probeErr = null;
      break;
    } catch (e) {
      probeErr = e;
    }
  }
  if (probeErr) {
    /* 探不到就**不注**：宁可这一次没补上（页面侧探子会按退避再问），
     * 也不能重复注入 —— anchor / dialog / row-scan 有顶层 const，
     * 第二次执行整段作废；其余模块会叠出第二套 observer 与定时器。 */
    return { ok: false, error: '探针失败：' + ((probeErr && probeErr.message) || '未知原因') };
  }
  if (loaded) return { ok: true, skipped: true, installed: true };

  // 样式先补：失败不阻断脚本（先有样式再建 DOM，避免闪一下没样式）
  if (Array.isArray(assets.css) && assets.css.length && chrome.scripting && chrome.scripting.insertCSS) {
    try {
      await dualCall(function (done) {
        return chrome.scripting.insertCSS({
          target: { tabId: tabId, frameIds: [0] },
          files: assets.css
        }, done);
      }, 10000);
    } catch (e) {
      /* 硬中止的后果是「功能完全没有」，比「控件没样式」严重得多。 */
    }
  }

  const failed = [];
  let done = 0;
  let firstErr = null;
  // 跨分组复用带顶层 const/let 的底座，避免切页时重声明。
  const sharedMarkers = {
    'src/content/anchor.js': '__DYC_ANCHOR_LOADED__',
    'src/content/dialog.js': '__DYC_DIALOG_LOADED__',
    'src/content/row-scan.js': '__DYC_ROW_SCAN_LOADED__'
  };
  for (let i = 0; i < assets.js.length; i++) {
    const file = assets.js[i];
    try {
      if (sharedMarkers[file] && await probeLoaded(tabId, sharedMarkers[file])) {
        done++;
        continue;
      }
      await injectOneLiveFile(tabId, file);
      done++;
    } catch (e) {
      failed.push(file);
      if (!firstErr) firstErr = (e && e.message) || String(e) || '注入失败';
      /* 头两个就失败 ⇒ 不是「某个文件坏」，而是这条通道根本不通。
         此时继续跑完整个清单只会让页面侧多等十几秒，直接收手。 */
      if (done === 0 && failed.length >= 2) break;
    }
  }

  if (done === 0) {
    return { ok: false, error: '脚本注入失败：' + (firstErr || '未知原因'), failed: failed };
  }

  // 回探：标记在 = 装了；标记不在 = 连 flags/标记文件都没跑起来，交给页面侧重试
  let installed = false;
  try { installed = await probeLoaded(tabId, markerKey); } catch (e) { installed = false; }

  return {
    ok: true,
    installed: installed,
    count: done,
    total: assets.js.length,
    failed: failed
  };
}

/** 中控台分组入口（消息分支与旧调用方沿用这个名字） */
function injectLiveControl(sender) {
  const assets = (typeof DYC_LIVE_CONTROL_ASSETS !== 'undefined') ? DYC_LIVE_CONTROL_ASSETS : null;
  return injectAssetGroup(sender, assets, '__DYC_LIVE_CTRL_LOADED__', '中控台');
}

/**
 * 把反馈面板注入到「最像当前页」的标签上。
 * 成功:{ok:true, injected:true};都失败:回退独立小窗 {ok:true, injected:false, error:失败原因}。
 * mode(#106 · 2026-10-24):'changelog' 时面板/小窗直接落在「更新日志」Tab,缺省「反馈」。
 *
 * 只注入面板本身。云 SDK 不进页面 —— 页面直连会被 CORS 预检拦住,
 * 提交统一由后台转发(见下面的 dyc:submitFeedback)。
 */
async function openFeedbackPanel(mode) {
  var why = '未找到可注入的页面';
  var tabs = [];
  try {
    tabs = await listCandidateTabs();
  } catch (e) {
    why = (e && e.message) || '枚举标签页失败';
  }

  for (var i = 0; i < tabs.length && i < 4; i++) {
    var id = tabs[i].id;

    // 先试「已注入,直接打开」—— 免得重复注入多份面板
    try {
      await chromeCb(function (done) {
        chrome.tabs.sendMessage(id, { type: 'dyc:fbToggle', mode: mode || 'feedback' }, done);
      }, 2500);
      return { ok: true, injected: true, reused: true };
    } catch (e) { /* 尚未注入,继续 */ }

    try {
      await injectPanelScript(id);
      // 注入 ≠ 打开（#129）：panel.js 首次运行只 display，不认 mode。
      // 必须补发一次 toggle，否则「更新日志」入口首屏必然停在「反馈」。
      // 补发失败不改变主流程结论：面板已经显示，只是 Tab 落在默认页。
      await nudgeFeedbackPanelMode(id, mode);
      return { ok: true, injected: true };
    } catch (e) {
      why = (e && e.message) || '注入失败';
    }
  }

  // 兜底:特权页 / 老内核注入不可用 → 开独立小窗(旧形态,至少能用)。
  // 失败原因随 URL 带过去,由小窗显示 —— 免得下次再出现「不知道为什么变成小窗」。
  //
  // 2026-10-13：先看有没有已经开着的小窗 —— 提交成功后小窗不再自动关闭
  // （改为「清空 + 保留可继续写」，见 feedback.js 的 resetForm），不查一下会越点越多。
  try {
    var wins0 = await chromeCb(function (done) {
      chrome.windows.getAll({ populate: true }, done);
    });
    var existWin = null;
    (wins0 || []).forEach(function (w) {
      if (existWin || !w || !w.tabs) return;
      var hit = w.tabs.some(function (t) {
        if (!t || !/\/src\/feedback\/feedback\.html/i.test(t.url || '')) return false;
        try {
          var params = new URL(t.url).searchParams;
          return tabs[0] && params.get('sourceTabId') === String(tabs[0].id)
            && params.get('sourceWindowId') === String(tabs[0].windowId);
        } catch (_) { return false; }
      });
      if (hit) existWin = w;
    });
    if (existWin) {
      await chromeCb(function (done) {
        chrome.windows.update(existWin.id, { state: 'normal', focused: true }, done);
      }, 3000).catch(function () {});
      return { ok: true, injected: false, reused: true };
    }
  } catch (e) { /* 查不到就照常开新窗 */ }

  try {
    var ver = encodeURIComponent(chrome.runtime.getManifest().version || '');
    var url = chrome.runtime.getURL('src/feedback/feedback.html?v=' + ver
      + '&why=' + encodeURIComponent(why)
      + '&tab=' + encodeURIComponent(mode || 'feedback')
      + (tabs[0] && Number.isInteger(tabs[0].id) ? '&sourceTabId=' + tabs[0].id + '&sourceWindowId=' + tabs[0].windowId : ''));
    await chromeCb(function (done) {
      chrome.windows.create({ url: url, type: 'popup', width: 430, height: 660 }, done);
    }, 6000);
    return { ok: true, injected: false, error: why };
  } catch (e2) {
    return { ok: false, error: ((e2 && e2.message) || why || '打开反馈失败') };
  }
}

/**
 * 截当前活动标签页可见区域(captureVisibleTab,2026-10-12 换方案)。
 *
 * 为什么换:desktopCapture 选屏方案在 360 极速内核上实测不可用 ——
 * 选屏器弹出、用户选定后回调仍回空 id,反复表现成「已在选屏器取消」
 * (用户多轮实测确认,重试也无法挽救)。弃用。
 *
 * captureVisibleTab 的优势:不弹任何选屏器,点按钮直接出图 ——
 * 对反馈场景更合适(用户要截的就是当前页面)。
 * 权限:需要目标站 host_permissions,本扩展已具备。
 * 返回 JPEG dataURI(质量 90,反馈截图够用且体积小)。
 *
 * 2026-10-13 三次修:
 *   ① 不再用 currentWindow 取目标窗口 —— 反馈小窗自己就是个 popup 窗口,
 *      它一开着 currentWindow 就指向它,截出来要么空白要么直接报错。
 *      改为在「非 popup 且未最小化」的普通窗口里,优先取焦点窗口的活动标签。
 *   ② 支持 opt.hideWindowId:兜底小窗点截屏时先把自己最小化,避免把小窗
 *      本身拍进图里,截完无论成败都还原。
 *   ③ 全程 callback 包装,老内核同样可用。
 *
 * 2026-10-13 四次修(用户报「截图还是截到了反馈界面」):
 *   症状:交上来的图里能看到当时打开着的反馈面板/小窗。
 *   根因:藏和抓之间没有等 —— 调用方把面板设成 display:none(或请求最小化)
 *        之后立刻就开始抓帧,而浏览器要等下一次合成才真正把它从画面里去掉;
 *        老内核还会把「上一帧」当作结果交回来。
 *   对策:③道保险 —— 调用方藏完等两帧(page 侧 waitPaint);
 *        这里浮层路径再等 160ms;抓帧走 captureVisibleTabSafe 先冲掉旧帧;
 *        小窗路径改为「最小化 → 轮询确认 → 没生效就挪出屏幕」(hideWindowForCapture)。
 */
async function captureScreenshot(opt) {
  opt = opt || {};
  var hideWin = opt.hideWindowId || null;
  var hideInfo = null;
  var target = null;
  try {
    if (hideWin) {
      hideInfo = await hideWindowForCapture(hideWin);
    } else {
      // 浮层路径:面板由页面侧藏的,这里再留一段余量,
      // 免得后台比页面重绘还早就抓了帧。
      await delayMs(160);
    }

    if (!Number.isInteger(opt.sourceTabId) || !Number.isInteger(opt.sourceWindowId)) {
      throw new Error('未关联反馈来源页面，请回到要反馈的页面重新打开反馈');
    }
    var source = await chromeCb(function (done) { chrome.tabs.get(opt.sourceTabId, done); });
    if (!source || source.windowId !== opt.sourceWindowId || !source.active || !/^https?:/i.test(source.url || '')) {
      throw new Error('反馈来源页面已切换，请回到原页面再截屏');
    }
    target = { winId: source.windowId, tabId: source.id };

    // 小窗兜底路径:页面里没有浮层在跑,没人负责藏「扩展自己的 UI」
    // (左下角 DY-COCO 品牌标记等),由后台注入一次来藏。浮层路径不需要,
    // 那边由浮层自己按原值精确隐藏并还原,两套机制不交叉。
    if (hideWin && target.tabId != null) {
      await chromeCb(function (done) {
        chrome.scripting.executeScript(
          { target: { tabId: target.tabId }, func: dycHideExtUIInPage },
          function () { void chrome.runtime.lastError; done(); }
        );
      }, 3000).catch(function () {});
      await delayMs(120);
    }

    // 隐藏反馈界面期间用户可能切页；截图前再核对一次，不能抓到同窗口的别页。
    var active = await chromeCb(function (done) { chrome.tabs.get(target.tabId, done); });
    if (!active || !active.active || active.windowId !== target.winId) throw new Error('来源页面已切换，截屏已取消');
    var dataUrl = await captureVisibleTabSafe(target.winId, target.tabId);

    return { ok: true, dataURI: dataUrl };
  } catch (e) {
    var msg = (e && e.message) || String(e || '截屏失败');
    return { ok: true, canceled: false, error: msg };
  } finally {
    if (hideWin && target && target.tabId != null) {
      await chromeCb(function (done) {
        chrome.scripting.executeScript(
          { target: { tabId: target.tabId }, func: dycShowExtUIInPage },
          function () { void chrome.runtime.lastError; done(); }
        );
      }, 3000).catch(function () {});
    }
    if (hideWin) await restoreWindowAfterCapture(hideWin, hideInfo);
  }
}

/* 下面两个函数是给 chrome.scripting.executeScript 注入用的,必须是自包含的
   (不能引用本文件里的其他变量),Chrome 会把函数体序列化后送进页面隔离世界。
   隐藏范围 = 所有以 dyb-/dyc- 命名的注入元素:反馈面板、大图预览层、
   左下角 DY-COCO 品牌标记、历史盒子,以及以后新增的同类元素。 */
function dycHideExtUIInPage() {
  var list = document.querySelectorAll(
    '[id^="dyb-"],[id^="dyc-"],[class^="dyb-"],[class*=" dyb-"],[class^="dyc-"],[class*=" dyc-"]'
  );
  var saved = [];
  for (var i = 0; i < list.length; i++) {
    saved.push([list[i], list[i].style.display]);
    list[i].style.display = 'none';
  }
  document.__dycCapSaved = saved;
  return saved.length;
}

function dycShowExtUIInPage() {
  var saved = document.__dycCapSaved || [];
  for (var i = 0; i < saved.length; i++) {
    if (saved[i][0] && saved[i][0].parentNode) saved[i][0].style.display = saved[i][1];
  }
  document.__dycCapSaved = null;
  return saved.length;
}

/**
 * 抓帧前先把「上一帧」顶掉(2026-10-13 四次修)。
 * 老内核(360 极速浏览器X 等)的 captureVisibleTab 常把最近一次合成的画面交回来;
 * 调用方刚把面板/小窗藏起来,直接抓就可能抓到「藏之前」的那一帧。
 * 办法:先无用地抓一次把旧帧冲掉,歇一小会儿再抓第二次,用第二次的结果。
 * 代价约 150~250ms,反馈场景完全可接受。
 */
async function captureVisibleTabSafe(winId, tabId) {
  var opts = { format: 'jpeg', quality: 90 };
  async function assertSource() {
    var active = await chromeCb(function (done) { chrome.tabs.get(tabId, done); });
    if (!active || !active.active || active.windowId !== winId) throw new Error('来源页面已切换，截屏已取消');
  }
  await assertSource();
  try {
    await chromeCb(function (done) {
      chrome.tabs.captureVisibleTab(winId, opts, done);
    }, 8000);
  } catch (e) { /* 预热失败不影响正式抓取 */ }
  await delayMs(140);
  await assertSource();
  var result = await chromeCb(function (done) {
    chrome.tabs.captureVisibleTab(winId, opts, done);
  }, 8000);
  await assertSource();
  return result;
}

/**
 * 把兜底小窗「从画面上拿掉」,并返回可还原的信息(2026-10-13 四次修)。
 * 只调一次 windows.update(minimized) 是不够的:部分国产内核会忽略该请求,
 * 而它们的抓帧又可能把屏幕上叠着的其他窗口一起拍进去 —— 小窗于是自己入镜。
 * 所以:最小化 → 轮询确认真的是 minimized → 没生效就退一步把窗口挪出屏幕。
 */
async function hideWindowForCapture(winId) {
  var before = null;
  try {
    before = await chromeCb(function (done) { chrome.windows.get(winId, done); }, 3000);
  } catch (e) { before = null; }

  try {
    await chromeCb(function (done) {
      chrome.windows.update(winId, { state: 'minimized' }, done);
    }, 3000);
  } catch (e) { /* 内核不支持也继续 */ }

  var minimized = false;
  for (var i = 0; i < 8 && !minimized; i++) {   // 最多约 800ms
    await delayMs(100);
    try {
      var w = await chromeCb(function (done) { chrome.windows.get(winId, done); }, 3000);
      minimized = !!(w && w.state === 'minimized');
    } catch (e) { /* 忽略 */ }
  }

  var moved = false;
  if (!minimized && before && typeof before.left === 'number') {
    // 退路:挪到屏幕外(部分内核会把窗口 clamp 回可视区,尽力而为)
    try {
      await chromeCb(function (done) {
        chrome.windows.update(winId, { left: -32000, top: -32000 }, done);
      }, 3000);
      moved = true;
    } catch (e) { /* 忽略 */ }
  }

  await delayMs(240);   // 等最小化动画/位移走完,否则残影会入镜
  return { before: before, minimized: minimized, moved: moved };
}

/** 截完把小窗还原:挪过位置就挪回去,再恢复为正常窗口并聚焦。 */
async function restoreWindowAfterCapture(winId, info) {
  if (info && info.moved && info.before) {
    try {
      await chromeCb(function (done) {
        chrome.windows.update(winId, {
          left: info.before.left, top: info.before.top,
          width: info.before.width, height: info.before.height
        }, done);
      }, 3000);
    } catch (e) { /* 尽力而为 */ }
  }
  try {
    chrome.windows.update(winId, { state: 'normal', focused: true }, function () {
      void chrome.runtime.lastError;
    });
  } catch (e) { /* 尽力而为 */ }
}

// SW 每次被唤醒都确保定时器存在（存在则不动，不会重置周期）
ensureAlarm();

/* ---------- 诊断采集：后台侧错误缓冲（2026-10-13 新增，反馈诊断包） ---------- */
//
// 为什么后台要单独存一份：service worker 是独立上下文，它自己抛的异常
// 页面里的 diag.js 完全看不见。而反馈链路（REST 提交、DNR 规则、注入）
// 恰恰大量跑在后台 —— 「提交总失败」这类问题，答案往往就在这里的几行栈里。
//
// 只管内存：不落盘、不写 storage。SW 被回收即清空（这是可接受的 ——
// 采不到远古错误，但能采到「刚发生的那次」，而反馈场景要的正是它）。
var SW_ERR_MAX = 10;
var swErrors = [];
var swInHook = false;

function swNote(msg, stack) {
  try {
    var rec = { t: Date.now(), s: 'sw', m: shortenText(msg, 400) };
    if (stack) rec.k = shortenText(stack, 600);
    swErrors.push(rec);
    if (swErrors.length > SW_ERR_MAX) swErrors.shift();
  } catch (e) { /* 记错误失败绝不能反过来把 SW 弄挂 */ }
}

self.addEventListener('error', function (e) {
  if (swInHook) return;
  swInHook = true;
  try {
    swNote((e && e.message) || 'service worker error',
      (e && e.error && e.error.stack) || (e && e.filename ? e.filename + ':' + e.lineno : ''));
  } catch (_) {}
  swInHook = false;
});

self.addEventListener('unhandledrejection', function (e) {
  if (swInHook) return;
  swInHook = true;
  try {
    var r = e && e.reason;
    swNote('未处理的 Promise 拒绝: ' + describeThrown(r), r && r.stack);
  } catch (_) {}
  swInHook = false;
});
