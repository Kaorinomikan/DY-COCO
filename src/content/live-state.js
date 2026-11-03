/**
 * 开播判据 · 共享判定层（2026-11-03）
 * ============================================================
 * 用户口径（2026-11-01 / 2026-11-03 两次定稿）：
 *   · 2026-11-01：「按钮只有在开播后才会生效。未开播不生效。直播结束后也会停止
 *     不再获取信息。」
 *   · 2026-11-03：「福袋的间隔刷新功能，想改成只有在开始直播才开始按照间隔设置
 *     刷新，不然还没开播就一直弹出抽屉」+ 拍板「只认明确在播才自动开抽屉」。
 *
 * 为什么要有这个模块（唯一真源）：
 *   改动前同一套判据在 auto-refresh.js 里写了一份，lucky-bag.js 里另写了一份
 *   更薄的（只认两组文案、判不出就当在播）。两份必然漂移 —— 实际已经漂了：
 *   小黄车那边早就补到「按钮 / 计时器递增 / 播前横幅」三路信号，福袋这边还停在
 *   「只认文案」。于是没开播时福袋判成 unknown、按在播处理、每 N 分钟开一次抽屉。
 *   本模块把这些判据收敛成**唯一真源**：别处只调用，不再自己扫页面。
 *
 * 三路信号（优先级从高到低）：
 *   ① 「结束直播 / 下播 / 关播 / 结束本场直播」按钮 —— 中控台只在直播中出现，
 *      命中即在播。先做纯文本匹配、命中后才判可见（把重排次数压到命中数）。
 *   ② HH:MM:SS 计时器**递增** —— 在播。递减是开播倒计时，不算。
 *   ③ 「开始直播 / 未开播 / 直播已结束」类文案 —— 未开播。
 *      这一档是福袋模块原有的判据（2026-11-01），合并时**不能丢** ——
 *      丢了就等于「页面上明明写着未开播，判据却认不出」。
 *   ④ 播前引导横幅「开播前请使用直播计划」—— 未开播。这条横幅只在开播前出现，
 *      直播中不会撞上（2026-10-23 #108 已删掉「创建直播预告/创建直播计划」两个
 *      弱特定词，它们会误命中直播中的运营浮条）。
 *   都不中 ⇒ unknown。
 *
 * 两个「确认」机制，都保留（各自防一类误判）：
 *   · **连续 MISS_LIMIT 次判不出**才认 unknown —— 平台重渲染的那一两拍判不出是常态，
 *     一次不中就改结论会让下游（小黄车的灯、福袋的节拍）抖个不停。
 *   · **单向锁**：本页生命周期内确认过在播后，「未开播」结论不再采信（降为 unknown）。
 *     理由：SPA 未开播→直播中是无缝转接，转接后部分子页没有「结束直播」按钮，
 *     此时任何「未开播」结论都高度可疑。整页刷新会重建本模块，锁自然解除。
 *
 * ★ 调用节流（MIN_JUDGE_MS）：
 *   现在有两个调用方（auto-refresh 每 2 秒、lucky-bag 每 2.5 秒）。若各自独立推进
 *   「连续判不出」的计数，防抖窗口会被两倍速消耗（≈1.1 秒就转 unknown），
 *   等于把防抖废掉。所以 judge() 自带节流：距上次判定不足 MIN_JUDGE_MS 就直接返回
 *   上次结论，不动计数。顺带省掉一半全页扫描。
 *
 * 边界（不要越推越远）：
 *   · 只读页面、只判状态，**不点任何东西、不改任何样式**；
 *   · 不认识的状态一律 unknown，由调用方按各自的安全方向处置
 *     （福袋：unknown ⇒ 不开抽屉；小黄车：unknown ⇒ 停刷）。
 *
 * 开关：无。判据本身恒生效，要不要据此动作由各功能自己决定。
 * ============================================================
 */
(function () {
  'use strict';

  if (typeof window === 'undefined') return;
  if (window.dycLiveState) return;   // 重复注入（同一页两份脚本）时只认第一份

  /* ---------- 常量 ---------- */

  /** 直播中才会出现的主按钮文案（命中任一即在播） */
  var LIVE_TEXTS = ['结束直播', '下播', '关播', '结束本场直播'];

  /**
   * 播前引导横幅文案。
   * ★ 只保留这一条：2026-10-23（#108）删掉了「创建直播预告 / 创建直播计划」——
   *   那两个词同时出现在直播中的运营浮条上，会让直播中被误判回未开播。
   */
  var PRE_LIVE_TEXTS = ['开播前请使用直播计划'];

  /**
   * 未开播文案（**完全相等**匹配，不做 indexOf）。
   *
   * 这一档来自福袋模块 2026-11-01 的原有判据，合并时必须保留：页面上明写着
   * 「开始直播」的时候，判据却报 unknown，是最没道理的失败。
   *
   * 为什么用完全相等而不是包含：这些词都是短词，包含匹配极易误伤 ——
   * 「开始直播」会命中「开始直播预告」「开始直播倒计时」等一切带前缀的运营文案。
   */
  var OFF_TEXTS = ['开始直播', '未开播', '直播已结束', '已结束直播', '本场已结束'];

  /** 计时器形态（只看 HH:MM:SS 叶子） */
  var TIMER_RE = /^\d{1,2}:\d{2}:\d{2}$/;

  /** 横幅判定结果缓存：这一步每拍都可能被问，body 全文读一次不算便宜 */
  var BANNER_TTL = 10000;

  /** 连续判不出这么多次才认 unknown（单次抖动不改结论） */
  var MISS_LIMIT = 3;

  /** 判定节流：两个调用方共用本模块，不能各自推进防抖计数 */
  var MIN_JUDGE_MS = 1800;

  /** 文案长度上限：超过这个长度的元素不可能是按钮文案（省掉大段文本比对） */
  var MAX_TEXT_LEN = 10;

  /* ---------- 状态 ---------- */

  /** 'live' | 'prelive' | 'unknown' —— 已确认的结论 */
  var state = 'unknown';
  var streak = 0;              // 连续判不出的次数
  var everLive = false;        // 单向锁：本页确认过在播
  var lastJudgeAt = 0;         // 上次真判定的时刻（节流用）

  /* 计时器趋势检测的状态 */
  var _timerEl = null;
  var lastTimerVal = null;

  /* 横幅缓存 */
  var _bannerHit = null;
  var _bannerAt = 0;

  /* ---------- 工具 ---------- */

  function now() { return Date.now(); }

  /** 归一化文本：去掉所有空白 —— 平台文案里常有全角空格与换行 */
  function norm(s) {
    return String(s == null ? '' : s).replace(/[\s\u3000]+/g, '');
  }

  /**
   * 是不是扩展自己注入的节点。
   *
   * 判据取「id / class 前缀」而不是固定属性白名单 —— 扩展的注入形态一直在变
   * （圆钮、面板、指示灯、胶囊各有各的标记属性），按前缀判才不会漏。
   */
  function isExtNode(el) {
    if (!el || el.nodeType !== 1) return false;
    var id = el.id ? String(el.id) : '';
    if (/^(dyc|dyb)[-_]/.test(id)) return true;
    var cls = el.className && typeof el.className === 'string' ? el.className : '';
    if (/(^|\s)(dyc|dyb)[-_]/.test(cls)) return true;
    return false;
  }

  /** 沿祖先链上溯，判断是否落在扩展自己注入的子树里（固定 40 层上限） */
  function insideExt(el) {
    var p = el;
    var depth = 0;
    while (p && depth < 40) {
      if (isExtNode(p)) return true;
      p = p.parentElement;
      depth++;
    }
    return false;
  }

  /** 元素是否「有真实尺寸」。只读一次矩形就够，不用 offsetParent 先探一遍 */
  function visible(el) {
    if (!el || !el.isConnected) return false;
    var r;
    try { r = el.getBoundingClientRect(); } catch (e) { return false; }
    return !!r && r.width > 1 && r.height > 1;
  }

  function secsOf(hms) {
    var p = String(hms).split(':');
    return (+p[0]) * 3600 + (+p[1]) * 60 + (+p[2]);
  }

  /* ---------- 三路信号 ---------- */

  /**
   * 页面上有没有「直播中」类按钮。
   *
   * ★ 顺序要紧：先做**纯文本**匹配（不触发布局），命中之后才做可见性判定。
   *   反过来写的话，几百个候选每个都要读矩形 ⇒ 每次判定都强制重排一轮。
   *   文本命中的元素极少。
   */
  function hasLiveButton() {
    var cands;
    try { cands = document.querySelectorAll('button, [role="button"], a'); } catch (e) { return false; }
    for (var i = 0; i < cands.length; i++) {
      var el = cands[i];
      var t = norm(el.textContent);
      if (!t || t.length > MAX_TEXT_LEN) continue;
      var hit = false;
      for (var k = 0; k < LIVE_TEXTS.length; k++) {
        if (t.indexOf(LIVE_TEXTS[k]) >= 0) { hit = true; break; }
      }
      if (!hit) continue;
      if (insideExt(el) || !visible(el)) continue;
      return true;
    }
    return false;
  }

  /**
   * 找页面上形如 HH:MM:SS 的小计时器，并判断它是否在**递增**。
   * 返回 'up'（递增 ⇒ 在播）/ 'down'（递减 ⇒ 开播倒计时）/ null（没看到 / 只看到一次）。
   *
   * ★ 两处收敛：上一拍找到的节点还在就直接读它，不再全页扫；
   *   全页扫只在缓存失效时发生，且首个命中即 break。
   */
  function timerTrend() {
    var found = null;

    // 快路径：上一拍找到的计时器还在、还是那个格式 ⇒ 直接读它
    if (_timerEl && _timerEl.isConnected) {
      var t0 = norm(_timerEl.textContent);
      if (TIMER_RE.test(t0)) found = t0;
    }

    // 慢路径：全页扫一次，首个命中即 break
    if (!found) {
      var nodes;
      try { nodes = document.querySelectorAll('span, div, p, b, strong, i'); } catch (e) { nodes = []; }
      for (var i = 0; i < nodes.length; i++) {
        var el = nodes[i];
        if (insideExt(el)) continue;
        // 只看「自己没有元素子节点」的叶子，避免把整块容器文本读进来
        if (el.firstElementChild) continue;
        var t = norm(el.textContent);
        if (!TIMER_RE.test(t)) continue;
        if (!visible(el)) continue;
        _timerEl = el;
        found = t;
        break;
      }
    }

    if (!found) { lastTimerVal = null; _timerEl = null; return null; }
    if (!lastTimerVal) { lastTimerVal = found; return null; }

    var a = secsOf(lastTimerVal);
    var b = secsOf(found);
    lastTimerVal = found;
    if (b > a) return 'up';
    if (b < a) return 'down';
    return null;   // 同一秒内两次采样，值没变
  }

  /**
   * 未开播引导横幅在不在。
   *
   * ★ 两处优化，理由都是「这一步会被反复问」：
   *   ① 用 textContent 而不是 innerText —— innerText 会**强制布局**；
   *   ② 结果缓存 BANNER_TTL。开播这一跃迁由**便宜的**直播按钮判定兜住，
   *      横幅只用来确认「未开播」这个稳定态。
   */
  function hasPreLiveBanner() {
    if (_bannerHit !== null && now() - _bannerAt < BANNER_TTL) return _bannerHit;
    _bannerAt = now();
    var t = norm(document.body ? document.body.textContent : '');
    if (!t) { _bannerHit = false; return false; }
    for (var i = 0; i < PRE_LIVE_TEXTS.length; i++) {
      if (t.indexOf(norm(PRE_LIVE_TEXTS[i])) >= 0) { _bannerHit = true; return true; }
    }
    _bannerHit = false;
    return false;
  }

  /**
   * 页面上有没有「未开播」类文案。
   *
   * 与 hasLiveButton 同一套写法（先纯文本、再判可见），但匹配口径不同：
   * 这里要求**完全相等**（见 OFF_TEXTS 的注释）。扫描范围是 button / a / span / div，
   * 因为这几个词在中控台上可能是按钮、也可能是纯文本标签。
   */
  function hasOffText() {
    var cands;
    try { cands = document.querySelectorAll('button, a, span, div'); } catch (e) { return false; }
    for (var i = 0; i < cands.length; i++) {
      var el = cands[i];
      if (el.children && el.children.length) continue;   // 只看叶子
      if (isExtNode(el)) continue;
      var t = norm(el.textContent);
      if (!t || t.length > MAX_TEXT_LEN) continue;
      var hit = false;
      for (var k = 0; k < OFF_TEXTS.length; k++) {
        if (t === OFF_TEXTS[k]) { hit = true; break; }
      }
      if (hit) return true;
    }
    return false;
  }

  /**
   * 判一次直播状态（单次采样，可能返回 'unknown'，**不推进防抖计数**）。
   * 优先级：在播信号 > 未开播文案 / 横幅 > unknown。
   */
  function once() {
    if (hasLiveButton()) return 'live';
    if (timerTrend() === 'up') return 'live';
    if (hasOffText()) return 'prelive';
    if (hasPreLiveBanner()) return 'prelive';
    return 'unknown';
  }

  /**
   * 带确认的判定：**连续 MISS_LIMIT 次判不出**才认 unknown。
   *
   * @param {boolean} force 跳过节流（自测 / 调用方明确要求立刻重判时用）
   * @return {string} 已确认的结论 'live' | 'prelive' | 'unknown'
   */
  function judge(force) {
    var t = now();
    if (!force && lastJudgeAt && t - lastJudgeAt < MIN_JUDGE_MS) return state;
    lastJudgeAt = t;

    var j = once();

    /* 单向锁：曾确认在播 ⇒ 「未开播」结论不再采信，按 unknown 走确认节奏。
     * 取舍：若平台「下播」不跳转/不刷新，锁不解 ⇒ 下播后要靠手动刷新解除。
     * 比「直播中被判成未开播」安全，可接受。 */
    if (j === 'prelive' && everLive) j = 'unknown';

    if (j === 'unknown') {
      streak++;
      if (streak >= MISS_LIMIT) state = 'unknown';
      // 未达上限 ⇒ 保持 state 不变（继续按上一次的结论走）
    } else {
      streak = 0;
      state = j;
      if (j === 'live') everLive = true;
    }
    return state;
  }

  /** 清掉状态与全部缓存（整页重建 / 自测用例之间） */
  function reset() {
    state = 'unknown';
    streak = 0;
    everLive = false;
    lastJudgeAt = 0;
    lastTimerVal = null;
    _timerEl = null;
    _bannerHit = null;
    _bannerAt = 0;
  }

  /** 只清缓存、不动结论（页面重渲染后想立刻重判一次时用） */
  function invalidate() {
    _bannerHit = null;
    _bannerAt = 0;
    _timerEl = null;
    lastTimerVal = null;
    lastJudgeAt = 0;
  }

  /** 排查用：把当前判据摊开（写进诊断报告 / 控制台，不弹 UI） */
  function dump() {
    return {
      state: state,
      streak: streak,
      everLive: everLive,
      missLimit: MISS_LIMIT,
      banner: _bannerHit,
      timerEl: !!_timerEl,
      lastTimerVal: lastTimerVal,
      lastJudgeAt: lastJudgeAt
    };
  }

  /** 自测用：改节流窗口（真实运行不要动） */
  function setTimingForTest(ms) {
    if (typeof ms === 'number' && ms >= 0) MIN_JUDGE_MS = ms;
  }

  window.dycLiveState = {
    once: once,
    judge: judge,
    get: function () { return state; },
    isLive: function () { return state === 'live'; },
    reset: reset,
    invalidate: invalidate,
    dump: dump,
    setTimingForTest: setTimingForTest
  };
})();
