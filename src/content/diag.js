/**
 * 诊断采集内核 —— 反馈诊断包的第 1 层（2026-10-13 新增，用户评审通过）
 *
 * 定位:给「反馈」采一份体检报告,让助手不用回头追问就能定位到文件与行为。
 *   现状是一句话 + 最多 3 张截图 + 版本号 + UA,页面/报错/控件状态全无,
 *   定位基本靠猜。本文件补齐这一层。
 *
 * 三条硬约束(评审稿第五节):
 *   ① 只采结构、不采内容 —— 页面文本一个字不取;URL 保留 host+path,
 *      query/hash 只留键名、值一律打码成 ***
 *   ② 每项独立兜底 —— 任何一项失败只记 {ok:false,why},绝不让采集把反馈提交带崩
 *   ③ 全部有上限 —— 报错 20 条 / 轨迹 30 条 / 单字段截断 / 整包 64KB
 *
 * 只在内存里留环形缓冲,**不落盘、不写 localStorage、刷新即清**。
 *
 * ★ 技术边界(不要在文档/汇报里夸大):
 *   content script 运行在隔离世界,只能采到**扩展自身**的未捕获异常;
 *   抖店页面自身脚本的报错跨不过隔离边界,采不到(不做 MAIN world 注入 ——
 *   老内核不一定支持,风险不划算)。所以本项是「扩展自身的健康档案」,
 *   不是「页面控制台全量日志」。
 *
 * 对外接口(window.__dycDiag):
 *   note(动作, 细节, 结果)        记一条交互轨迹(各功能模块按需调用)
 *   noteError(消息, 来源)          手动记一条错误(后台错误经此并入)
 *   snapshot(extra)               出快照对象 → Promise(要读 storage,故异步)
 *   report(extra)                 出 Markdown 诊断报告 → Promise(字符串)  ★2026-10-16 新增
 *   clear()                       清空报错与轨迹缓冲                        ★2026-10-16 新增
 *   countText()                   一行计数(面板上显示用,同步、不生成快照)
 *   why                           兜底小窗的降级原因(由调用方写入)
 *
 * ★ 2026-10-16:report() / clear() 是为「调试面板一键复制诊断报告」加的。
 *   报告 = 人类可读的 Markdown 摘要 + 末尾完整原始 JSON,
 *   用途是让用户把一段文本交给 AI,AI 不必追问就能定位到文件与行为。
 *   采集逻辑一行未改,只是把已有快照换一种呈现方式。
 */
(function () {
  'use strict';

  // 防重复注入:manifest 注入一次、后台注入面板时可能再注入一次,只认第一份
  if (window.__dycDiag) return;

  /* ---------- 上限 ---------- */
  var MAX_ERRS = 20;          // 报错环形缓冲条数
  var MAX_TL = 30;            // 轨迹环形缓冲条数
  var TL_CAP = 400;           // 轨迹内部数组硬上限(防某处狂刷撑爆内存)
  var BUDGET = 64 * 1024;     // 整包体积上限(字符数 ≈ 字节数,JSON 里几乎全是 ASCII 键)
  var MSG_MAX = 400;
  var STACK_MAX = 600;
  var ACT_MAX = 60;
  var DET_MAX = 140;
  var URL_MAX = 300;
  var WIDGET_MAX = 40;        // 控件分组上限

  var extPage = false;
  try { extPage = location.protocol === 'chrome-extension:'; } catch (e) {}

  var bootAt = Date.now();
  var errors = [];
  var timeline = [];
  var inHook = false;         // 防重入:hook 自身抛错不能再进 hook

  /* ---------- 小工具 ---------- */

  function clamp(s, n) {
    s = (s === null || s === undefined) ? '' : String(s);
    return s.length > n ? s.slice(0, n) + '…' : s;
  }

  function safe(fn, fb) {
    try { return fn(); } catch (e) { return fb; }
  }

  /** 把任何被抛出的东西变成一句人话(不依赖 e.message 存在) */
  function thrownText(e) {
    if (e === undefined) return 'undefined';
    if (e === null) return 'null';
    if (typeof e === 'string') return e;
    if (typeof e !== 'object') return typeof e + ': ' + String(e);
    var parts = [];
    ['name', 'message', 'code', 'status', 'statusText'].forEach(function (k) {
      var v = e[k];
      if (v === undefined || v === null || v === '') return;
      parts.push(k + '=' + (typeof v === 'object' ? thrownText(v) : String(v)));
    });
    if (!parts.length) {
      parts.push(safe(function () { return 'JSON=' + JSON.stringify(e); }, '(无法序列化)'));
    }
    return parts.join(' | ');
  }

  /** 取元素的「扩展标识」:优先 id,其次第一个 dyb-/dyc- 前缀的 class */
  function tagOf(el) {
    if (!el || el.nodeType !== 1) return '';
    var id = el.id || '';
    if (/^dy[bc]-/.test(id)) return '#' + id;
    var cl = safe(function () { return el.getAttribute('class'); }, '') || '';
    if (typeof cl !== 'string' || !cl) return '';
    var parts = cl.split(/\s+/);
    for (var i = 0; i < parts.length; i++) {
      if (/^dy[bc]-/.test(parts[i])) return '.' + parts[i];
    }
    return '';
  }

  function isExtTag(t) { return !!t && /^[.#]dy[bc]-/.test(t); }

  /* ---------- 轨迹 / 报错缓冲 ---------- */

  function note(action, detail, result) {
    try {
      var rec = { t: Date.now(), a: clamp(action, ACT_MAX) };
      if (detail) rec.d = clamp(detail, DET_MAX);
      if (result) rec.r = clamp(result, 80);
      timeline.push(rec);
      if (timeline.length > TL_CAP) timeline.splice(0, timeline.length - TL_CAP);
    } catch (e) { /* 记轨迹失败绝不能影响主流程 */ }
  }

  function noteError(msg, from, stack) {
    try {
      var rec = {
        t: Date.now(),
        s: clamp(from || 'content', 20),
        m: clamp(scrubTextUrls(msg || '(空)'), MSG_MAX)
      };
      if (stack) rec.k = clamp(scrubTextUrls(stack), STACK_MAX);
      errors.push(rec);
      if (errors.length > MAX_ERRS) errors.shift();
    } catch (e) { /* 同上 */ }
  }

  /* ---------- 自动监听:扩展自身的异常 ---------- */

  // 隔离世界里的 window 只承载扩展自己的脚本,所以这里收到的都是「我们自己的错」。
  // 资源加载失败(img/link/script)也走 error 事件,但没有 message —— 记成一行短标记,
  // 因为「扩展注入的图片挂掉」本身也是值得知道的信号。
  window.addEventListener('error', function (e) {
    if (inHook) return;
    inHook = true;
    try {
      if (e && e.message) {
        noteError(e.message, 'content',
          (e.error && e.error.stack) || (e.filename ? e.filename + ':' + e.lineno : ''));
      } else if (e && e.target && e.target !== window) {
        var tag = e.target.tagName || '?';
        var src = safe(function () { return e.target.src || e.target.href || ''; }, '');
        noteError('资源加载失败 ' + tag + ' ' + clamp(scrubUrl(src), 120), 'resource');
      }
    } catch (_) {}
    inHook = false;
  }, true);

  window.addEventListener('unhandledrejection', function (e) {
    if (inHook) return;
    inHook = true;
    try {
      var r = e && e.reason;
      noteError('未处理的 Promise 拒绝: ' + thrownText(r), 'promise', r && r.stack);
    } catch (_) {}
    inHook = false;
  });

  /* ---------- 自动监听:扩展自身控件的点击 ---------- */

  /** 取真实点击目标(Send 事件可能来自 Shadow DOM,需要 composedPath 穿透) */
  function realTarget(e) {
    var p = safe(function () { return e.composedPath && e.composedPath(); }, null)
      || safe(function () { return e.path; }, null);
    if (p && p.length && p[0] && p[0].nodeType === 1) return p[0];
    return e.target;
  }

  if (!extPage) {
    document.addEventListener('click', function (e) {
      if (inHook) return;
      inHook = true;
      try {
        var t = realTarget(e);
        // 从真实目标沿路径向上找第一个带扩展标识的元素(含 Shadow DOM 内的按钮)
        var hit = '';
        var p = safe(function () { return e.composedPath && e.composedPath(); }, null)
          || safe(function () { return e.path; }, null);
        var seq = (p && p.length) ? p : [t];
        for (var i = 0; i < seq.length && i < 12; i++) {
          var tag = tagOf(seq[i]);
          if (isExtTag(tag)) { hit = tag; break; }
        }
        if (hit) note('点击控件', hit);
      } catch (_) {}
      inHook = false;
    }, true);
  }

  /* ---------- 自动监听:开关切换 ---------- */

  safe(function () {
    if (!chrome || !chrome.storage || !chrome.storage.onChanged) return;
    var LABEL = {
      dybFeatures: '功能开关',
      dybDebug: '调试模式',
      dybHideList: '隐藏勾选',
      dycScanShadeMode: '扫描白幕档位',
      dycOmnisearchMode: '全能搜索档位'
    };
    chrome.storage.onChanged.addListener(function (changes, area) {
      if (area !== 'local' || !changes) return;
      try {
        Object.keys(changes).forEach(function (k) {
          if (!LABEL[k]) return;                 // 只记与功能相关的键,别的噪音不记
          var c = changes[k];
          note('开关变更', LABEL[k] + ':' + k,
            valText(c.oldValue) + ' → ' + valText(c.newValue));
        });
      } catch (_) {}
    });
  });

  function valText(v) {
    if (v === true) return '开';
    if (v === false) return '关';
    if (v === undefined) return '(缺省)';
    if (Array.isArray(v)) return '[' + v.length + ' 项]';
    return clamp(safe(function () { return JSON.stringify(v); }, String(v)), 40);
  }

  /* ---------- 自动监听:页面跳转(扩展行为与路由强相关) ---------- */

  var lastHref = safe(function () { return location.href; }, '');
  if (!extPage) {
    setInterval(function () {
      var h = safe(function () { return location.href; }, '');
      if (h && h !== lastHref) {
        lastHref = h;
        note('页面跳转', pageKind());
      }
    }, 1200);
  }

  /* ---------- 采集:环境 ---------- */

  function scrubUrl(u) {
    try {
      var s = String(u || '');
      var cut = s.length;
      var qi = s.indexOf('?');
      var hi = s.indexOf('#');
      if (qi >= 0 && qi < cut) cut = qi;
      if (hi >= 0 && hi < cut) cut = hi;
      var base = s.slice(0, cut);
      var tail = '';
      if (qi >= 0 || hi >= 0) {
        var start = (qi >= 0 && (hi < 0 || qi < hi)) ? qi : hi;
        tail = maskParams(s.slice(start));
      }
      return clamp(base + tail, URL_MAX);
    } catch (e) { return '(unavailable)'; }
  }

  /** 报错中的网址先完整脱敏，再截断；保留网址外的括号与句末标点。 */
  function scrubTextUrls(text) {
    return String(text == null ? '' : text).replace(
      /(?:[a-z][a-z\d+.-]*:\/\/|\/\/)[^\s<>"'`()（）【】]+/gi,
      function (url) {
        var suffix = '';
        var end = /[),.;:!?\]}>，。；！？、]+$/.exec(url);
        if (end) { suffix = end[0]; url = url.slice(0, -suffix.length); }
        return scrubUrl(url) + suffix;
      }
    );
  }

  /** 把 a=1&b=2 变成 a=***&b=*** —— 保留键名,值一律打码 */
  function maskParams(seg) {
    try {
      var lead = seg.charAt(0);                       // ? 或 #
      var body = seg.slice(1);
      var hashIdx = body.indexOf('#');
      var rest = '';
      if (lead === '?' && hashIdx >= 0) { rest = body.slice(hashIdx); body = body.slice(0, hashIdx); }
      var masked = body.split('&').map(function (pair) {
        if (!pair) return '';
        var j = pair.indexOf('=');
        if (j < 0) return clamp(pair, 40);            // 无值参数原样留名字
        return clamp(pair.slice(0, j), 40) + '=***';
      }).filter(function (x) { return x; }).join('&');
      return lead + masked + (rest ? maskParams(rest) : '');
    } catch (e) { return '?***'; }
  }

  function pageKind() {
    if (extPage) return 'extensionPage';
    return safe(function () {
      var pat = window.DYC_PAGE_PATTERNS;
      if (!pat) return 'unknown';
      for (var k in pat) {
        if (pat[k] && pat[k].test && pat[k].test(location.href)) return k;
      }
      return 'other';
    }, 'unknown');
  }

  /** 能力探测 —— 用来判断「老内核到底缺什么」,比 UA 靠谱。
   *  ⚠️ 读的时候要结合 env.scope 一起看:content script 看不到 chrome.tabs /
   *     chrome.declarativeNetRequest / chrome.offscreen（那几项只在后台 service worker
   *     里存在），所以页面侧这几个为 false 是**正常的上下文差异**，不代表扩展缺权限。
   *     实测印证：headless Chromium 里页面侧 tabs=false、dnr=false，而 SW 里两者都可用。 */
  function detectCaps() {
    var c = {};
    c.scripting = safe(function () { return !!(chrome && chrome.scripting); }, false);
    c.tabs = safe(function () { return !!(chrome && chrome.tabs); }, false);
    c.dnr = safe(function () { return !!(chrome && chrome.declarativeNetRequest); }, false);
    c.offscreen = safe(function () { return !!(chrome && chrome.offscreen); }, false);
    c.storageSession = safe(function () { return !!(chrome && chrome.storage && chrome.storage.session); }, false);
    c.shadow = safe(function () { return !!Element.prototype.attachShadow; }, false);
    c.clipboard = safe(function () { return !!(navigator.clipboard && navigator.clipboard.read); }, false);
    c.raf = safe(function () { return !!window.requestAnimationFrame; }, false);
    c.idle = safe(function () { return !!window.requestIdleCallback; }, false);
    c.mutation = safe(function () { return typeof MutationObserver === 'function'; }, false);
    c.promise = safe(function () { return typeof Promise === 'function'; }, false);
    c.fetch = safe(function () { return typeof fetch === 'function'; }, false);
    c.uadata = safe(function () { return !!navigator.userAgentData; }, false);
    return c;
  }

  function detectEngine() {
    var ua = safe(function () { return navigator.userAgent; }, '');
    var m = /(Chrome|Chromium|Edg|Firefox)\/([\d.]+)/.exec(ua);
    var out = m ? (m[1] + '/' + m[2].split('.')[0]) : 'unknown';
    var shell = /(360SE|360EE|QIHU|QQBrowser|Sogou|Maxthon|2345Explorer|LBBROWSER|Quark|UCBrowser)/i.exec(ua);
    if (shell) out += ' · ' + shell[1];
    return out;
  }

  function collectEnv(extra) {
    var e = {};
    e.scope = extPage ? 'extPage' : 'content';
    e.kind = pageKind();
    e.url = extPage ? null : scrubUrl(safe(function () { return location.href; }, ''));
    e.title = extPage ? null : clamp(safe(function () { return document.title; }, ''), 80);
    e.vw = safe(function () { return window.innerWidth; }, 0);
    e.vh = safe(function () { return window.innerHeight; }, 0);
    e.dpr = safe(function () { return window.devicePixelRatio || 1; }, 1);
    e.docH = safe(function () { return document.documentElement.scrollHeight; }, 0);
    e.ua = clamp(safe(function () { return navigator.userAgent; }, ''), 300);
    e.engine = detectEngine();
    e.caps = detectCaps();
    e.ver = safe(function () { return chrome.runtime.getManifest().version; }, '');
    e.boot = bootAt;
    e.age = Date.now() - bootAt;
    if (extra && extra.why) e.why = clamp(extra.why, 200);
    return e;
  }

  /* ---------- 采集:功能开关与档位 ---------- */

  function collectFlags() {
    return new Promise(function (resolve) {
      var fin = false;
      function done(v) { if (fin) return; fin = true; resolve(v); }
      // 兜底:storage 读不出来也绝不能拖慢提交
      setTimeout(function () { done(null); }, 1200);
      try {
        if (typeof window.dycReadAllFlags !== 'function') return done(null);
        window.dycReadAllFlags().then(function (on) {
          var out = { on: on, mode: {} };
          var jobs = [
            (typeof window.dycReadShadeMode === 'function') ? window.dycReadShadeMode() : Promise.resolve(null),
            (typeof window.dycReadOmniMode === 'function') ? window.dycReadOmniMode() : Promise.resolve(null),
            (typeof window.dycReadHideList === 'function') ? window.dycReadHideList() : Promise.resolve(null)
          ];
          Promise.all(jobs).then(function (r) {
            out.mode.scanShade = r[0];
            out.mode.omni = r[1];
            out.hideList = r[2];
            done(out);
          }, function () { done(out); });
        }, function () { done(null); });
      } catch (e) { done(null); }
    });
  }

  /* ---------- 采集:注入控件的挂载情况 ---------- */

  // 不写死清单,而是按 dyb-/dyc- 前缀**自动扫描**再取「根元素」分组 ——
  // 这样以后新增控件自动被采到,永远不过时(写死清单迟早会忘)。
  // 过滤掉 <style>/<link>/<script>:它们是样式容器,不是控件。
  function collectWidgets() {
    var all = safe(function () {
      return document.querySelectorAll(
        '[id^="dyb-"],[id^="dyc-"],[class^="dyb-"],[class*=" dyb-"],[class^="dyc-"],[class*=" dyc-"]'
      );
    }, null);
    if (!all) return { ok: false, why: 'DOM 扫描失败' };

    var groups = {};
    var order = [];
    for (var i = 0; i < all.length; i++) {
      var el = all[i];
      var tn = el.tagName;
      if (tn === 'STYLE' || tn === 'LINK' || tn === 'SCRIPT') continue;
      var name = tagOf(el);
      if (!name) continue;
      // 只留「根」:父元素的标识也不带扩展前缀
      if (tagOf(el.parentElement)) continue;
      if (!groups[name]) {
        groups[name] = { id: name, n: 0, first: el };
        order.push(name);
      }
      groups[name].n++;
    }

    var out = [];
    for (var k = 0; k < order.length && out.length < WIDGET_MAX; k++) {
      var g = groups[order[k]];
      var item = { id: g.id, n: g.n };
      safe(function () {
        var el = g.first;
        var r = el.getBoundingClientRect();
        var cs = window.getComputedStyle(el);
        item.rect = [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)];
        item.pos = cs.position;
        item.disp = cs.display;
        item.z = cs.zIndex;
        item.vis = !(r.width === 0 && r.height === 0) && cs.display !== 'none' && cs.visibility !== 'hidden';
        // 只报事实,不猜期望值。两个通用异常标记有**先后**:
        //   display:none / visibility:hidden 的元素,其矩形必然也是 0 —— 若先判尺寸,
        //   「被隐藏」这一支就永远不可达(实测踩到:状态条被标成 zero-size)。
        //   两种问题的排查方向不同(一个是自己藏了/被 hide-elements 隐藏,
        //   一个是被页面样式压扁),所以要分清。
        if (cs.display === 'none' || cs.visibility === 'hidden') item.bad = 'hidden';
        else if (r.width === 0 && r.height === 0) item.bad = 'zero-size';
      });
      out.push(item);
    }
    // 友好的中文名(可选,来自 flags.js 的别名表;没有也不影响)
    var alias = safe(function () { return window.DYC_DIAG_WIDGET_NAMES; }, null);
    if (alias) {
      out.forEach(function (it) { if (alias[it.id]) it.label = String(alias[it.id]); });
    }
    return { ok: true, groups: out, total: all.length };
  }

  /* ---------- 体积闸门 ---------- */

  function sizeOf(o) {
    return safe(function () { return JSON.stringify(o).length; }, 0);
  }

  /** 超预算就按「先砍轨迹、再砍控件细节、最后砍报错」的顺序削到限内 */
  function fit(snap) {
    if (sizeOf(snap) <= BUDGET) return snap;
    snap.truncated = true;
    snap.timeline = snap.timeline.slice(-8);
    if (sizeOf(snap) <= BUDGET) return snap;
    snap.timeline = [];
    if (snap.widgets && snap.widgets.groups) {
      snap.widgets.groups = snap.widgets.groups.slice(0, 12).map(function (g) {
        return { id: g.id, n: g.n, bad: g.bad };
      });
    }
    if (sizeOf(snap) <= BUDGET) return snap;
    snap.errors = snap.errors.slice(-5);
    if (sizeOf(snap) <= BUDGET) return snap;
    snap.errors = snap.errors.slice(-2).map(function (e) { delete e.k; return e; });
    return snap;
  }

  /* ---------- 出快照 ---------- */

  /** 浮条扫描探针读数(hide-elements.js 2026-10-24 #104 注入;可能不存在)。
   *  meta = 最近一次扫描汇总;rejects = 被档位淘汰的候选明细(环形全量,
   *  上限 24 条由 hide-elements.js 控制;报告摘要只展示最近 6 条)。
   *  都没有 = 本页没跑过扫描(功能关/未勾选/页面不匹配),报告里照样给一行,
   *  用来区分「没跑」与「跑了没命中」。 */
  function collectBarScanProbe() {
    var meta = safe(function () { return window.__dycBarScanMeta || null; }, null);
    var log = safe(function () { return (window.__dycBarScanLog || []).slice(); }, []);
    return { meta: meta, rejects: log || [] };
  }

  /**
   * 自动循环讲解的现场(2026-10-27 从胶囊的「长按复制诊断」并进来)。
   * 那个隐藏手势已按用户要求删除,但这份数据确实有用(识别判据 / ID 体检 / 最近流水),
   * 所以挂到**调试模式**的统一诊断报告里:只在功能跑过、暴露了 __DYC_AUTO_LOOP__ 时才采。
   */
  function collectAutoLoop() {
    return safe(function () {
      var api = window.__DYC_AUTO_LOOP__;
      if (!api || typeof api.probe !== 'function') return null;
      return { '状态': typeof api.snapshot === 'function' ? api.snapshot() : null, '现场': api.probe() };
    }, null);
  }

  /* 超级福袋(2026-11-01)：实机判据全靠文案与表格结构，一旦平台改版
   * 这份现场就是唯一的线索 —— 它记录每一行被认成什么状态、键是什么、
   * 以及最近 12 条动作轨迹（点了谁、为什么停）。 */
  function collectLuckyBag() {
    return safe(function () {
      var api = window.__DYC_LUCKY_BAG__;
      if (!api || typeof api.probe !== 'function') return null;
      return { '状态': typeof api.snapshot === 'function' ? api.snapshot() : null, '现场': api.probe() };
    }, null);
  }

  /* 滚动链诊断(2026-11-03):back-to-top.js 导出的 __dycChainDebug,
   * 回答「上滑/下滑圆钮的页面链到底圈了哪些容器」——锚点认没认到、
   * 购物车滚动容器在不在链上、各容器滚动量。不在中控台/模块未注入时为 null。 */
  function collectScrollChain() {
    return safe(function () {
      var fn = window.__dycChainDebug;
      return typeof fn === 'function' ? fn() : null;
    }, null);
  }

  function snapshot(extra) {
    var t0 = Date.now();
    return collectFlags().then(function (flags) {
      var snap = {
        v: 1,
        at: new Date().toISOString(),
        scope: extPage ? 'extPage' : 'content',
        env: collectEnv(extra),
        flags: flags,
        widgets: collectWidgets(),
        barScan: collectBarScanProbe(),
        errors: errors.slice(),
        timeline: timeline.slice(),
        autoLoop: collectAutoLoop(),
        luckyBag: collectLuckyBag(),
        scrollChain: collectScrollChain(),
        /* 中控台作用域与补注入凭据（2026-11-05）。用户报「侧栏切进中控台
         * 功能全不出现」时，这份报告要能直接回答三件事：探子装没装、脚本包
         * 装没装、补注入报了什么错。只有布尔与一句原因，不含页面内容。 */
        liveScope: {
          in: (typeof dycIsLiveControl === 'function') ? dycIsLiveControl() : null,
          installed: !!window.__DYC_LIVE_CTRL_LOADED__,
          agent: !!window.__DYC_LIVE_AGENT__,
          askError: clamp(String(window.__DYC_LIVE_INJECT_ERROR__ || ''), 120)
        }
      };
      if (extra && Array.isArray(extra.swErrors) && extra.swErrors.length) {
        snap.swErrors = extra.swErrors.slice(-MAX_ERRS).map(function (err) {
          err = err || {};
          var rec = {
            t: typeof err.t === 'number' ? err.t : 0,
            s: clamp(scrubTextUrls(err.s || 'background'), 20),
            m: clamp(scrubTextUrls(err.m || '(空)'), MSG_MAX)
          };
          if (err.k) rec.k = clamp(scrubTextUrls(err.k), STACK_MAX);
          return rec;
        });
      }
      if (extra && extra.shots) snap.shots = extra.shots;
      snap.took = Date.now() - t0;
      return fit(snap);
    }, function () {
      return { v: 1, at: new Date().toISOString(), scope: extPage ? 'extPage' : 'content', failed: true };
    });
  }

  /** 同步的计数描述,面板上显示一行用(不生成完整快照) */
  function countText() {
    var parts = [];
    var f = safe(function () { return window.DYC_FLAGS_META; }, null);
    // 2026-10-16:元数据表里新增了「无 key 的纯分组行」(如「页面滚动按钮」),
    // 它不是一个开关,计数时要排除 —— 否则会多报一项。
    var n = 0;
    if (f) {
      for (var i = 0; i < f.length; i++) { if (f[i] && f[i].key) n++; }
    }
    parts.push(n + ' 项开关');
    var w = safe(function () {
      var seen = 0;
      var all = document.querySelectorAll('[id^="dyb-"],[id^="dyc-"]');
      seen = all.length;
      return seen;
    }, 0);
    if (!extPage) parts.push(w + ' 个扩展元素');
    parts.push(errors.length + ' 条报错');
    parts.push(timeline.length + ' 条轨迹');
    return parts.join(' · ');
  }

  /* ---------- 页面结构导出（2026-10-22 新增 · 反馈可选项「导出页面结构」） ----------
   *
   * 为什么要有它：诊断包只看「扩展自己」——控件挂载/开关/报错轨迹，页面本身
   * 长什么样完全没采。而「选择器没命中 / 元素形态枚举没覆盖」恰是本工程最高频
   * 的 bug 类型，评审时全靠截图猜 + 来回追问。本段把整页骨架导出来随反馈提交，
   * class 层级、容器嵌套、扩展控件在页面里的处境一眼可查。
   *
   * 口径（用户 2026-10-22 拍板；与诊断包「页面文本一个字不取」是**两套口径**——
   * 本项是独立勾选、可取消、可展开预览，用户有知情权，文本才放行）：
   *   ① 节点直接文本每处截 20 字 —— 按钮/提示文案是认元素的关键线索
   *   ② 整页裁剪版 —— 全页遍历，靠三层上限兜底（见下）
   *
   * 脱敏硬规则：
   *   - textarea 的文本、一切 value 一律不采（用户输入是最高敏感级）
   *   - href/src 只留 host+path，query/hash 的值一律打码（复用 scrubUrl）
   *   - aria-label/title/placeholder 截 20 字；data-* 只留属性名不留值
   *   - script/style/svg 不递归内部；跨域 iframe 只记 cross 标记，不碰内容
   *
   * 三层上限（超限如实标注 cut/deep/capped，绝不静默）：
   *   深度 26 层 / 每层子节点 60 个 / 总节点 2600 个
   */
  var DS_MAX_DEPTH = 26;
  var DS_MAX_KIDS = 60;
  var DS_MAX_NODES = 2600;
  var DS_TEXT_MAX = 20;
  var DS_STR_MAX = 60;
  var DS_CLASS_MAX = 120;

  /** 压空白 + 截断（class/文本通用；null/undefined 安全） */
  function dsClip(s, n) {
    s = safe(function () { return String(s == null ? '' : s).replace(/\s+/g, ' ').trim(); }, '');
    return s.length > n ? s.slice(0, n) + '…' : s;
  }

  /** URL 只留 host+path、参数值打码（复用 scrubUrl），再截短 */
  function dsUrl(u) {
    var s = scrubUrl(u);
    return s.length > DS_STR_MAX ? s.slice(0, DS_STR_MAX) + '…' : s;
  }

  /** 是否扩展自己的控件（id/class 带 dyb-/dyc- 前缀）——结构树里标 ★，评审一眼认出 */
  function isExtEl(id, cl) {
    if (/^dy[bc]-/.test(id || '')) return true;
    var parts = (cl || '').split(/\s+/);
    for (var i = 0; i < parts.length; i++) {
      if (/^dy[bc]-/.test(parts[i])) return true;
    }
    return false;
  }

  function collectDomStructure() {
    if (extPage) return { ok: false, why: '扩展自身页面，无宿主页面结构可导' };
    var root = safe(function () { return document.documentElement; }, null);
    if (!root) return { ok: false, why: 'document 不可用' };

    var nodes = 0;
    var capped = false;

    function outOfBudget() {
      if (nodes >= DS_MAX_NODES) capped = true;
      return nodes >= DS_MAX_NODES;
    }

    /** 单个元素的属性摘要（全部 safe 包裹，读不到就跳过该字段） */
    function attrs(el) {
      var o = {};
      var id = safe(function () { return el.id || ''; }, '') || '';
      var cl = safe(function () { return el.getAttribute('class'); }, '');
      if (typeof cl !== 'string') cl = '';
      if (id) o.i = dsClip(id, DS_STR_MAX);
      if (cl) {
        var c2 = dsClip(cl, DS_CLASS_MAX);
        if (c2) o.c = c2;
      }
      if (isExtEl(id, cl)) o.e = 1;
      var t = dsClip(safe(function () { return el.getAttribute('title'); }, ''), DS_TEXT_MAX);
      if (t) o.ti = t;
      var al = dsClip(safe(function () { return el.getAttribute('aria-label'); }, ''), DS_TEXT_MAX);
      if (al) o.al = al;
      var ph = dsClip(safe(function () { return el.getAttribute('placeholder'); }, ''), DS_TEXT_MAX);
      if (ph) o.ph = ph;
      // data-* 只留属性名（值常带混淆串/业务数据），最多 4 个
      var am = safe(function () { return el.attributes; }, null);
      if (am) {
        var dn = [];
        for (var k = 0; k < am.length && dn.length < 4; k++) {
          var nm = am[k].name || '';
          if (nm.indexOf('data-') === 0) dn.push(nm.slice(5));
        }
        if (dn.length) o.d = dn.join(',');
      }
      var href = safe(function () { return el.getAttribute('href'); }, '');
      if (href) o.h = dsUrl(href);
      var src = safe(function () { return el.getAttribute('src'); }, '');
      if (src) o.s = dsUrl(src);
      return o;
    }

    function finish(o, kids) {
      if (kids && kids.length) o.k = kids;
      return o;
    }

    /** 递归建树。返回本元素节点对象；预算耗尽返回 null 并标 capped。 */
    function build(el, depth, inputArea) {
      if (outOfBudget()) return null;
      nodes++;
      var tag = safe(function () { return (el.tagName || '?').toLowerCase(); }, '?');
      var editable = safe(function () { return el.getAttribute('contenteditable'); }, null);
      // 可编辑区内即使后代声明 false，也可能包含已输入内容，整棵子树都不采文本。
      inputArea = !!inputArea || tag === 'textarea' || tag === 'input'
        || safe(function () { return el.isContentEditable; }, false)
        || (editable !== null && /^(?:true|plaintext-only)?$/i.test(editable));
      var o = attrs(el);
      o.t = tag;

      var isSvg = safe(function () {
        return el.namespaceURI === 'http://www.w3.org/2000/svg';
      }, false);
      var bare = isSvg || tag === 'script' || tag === 'style' || tag === 'noscript';

      var kids = null;
      function addKid(obj) { if (!kids) kids = []; kids.push(obj); }

      // open shadowRoot：影子树排在普通子树前面（sh=1 标记宿主）
      var sr = safe(function () { return el.shadowRoot; }, null);
      if (sr) {
        o.sh = 1;
        var sk = safe(function () { return sr.childNodes; }, null);
        if (sk && depth < DS_MAX_DEPTH) {
          var sn = 0, sTot = 0;
          for (var a = 0; a < sk.length; a++) {
            var sa = sk[a];
            if (!sa || sa.nodeType !== 1) continue;
            sTot++;
            if (sn >= DS_MAX_KIDS || outOfBudget()) continue;
            var ka = build(sa, depth + 1, inputArea);
            if (ka) { addKid(ka); sn++; }
          }
          if (sTot > sn) o.cut = (o.cut || 0) + (sTot - sn);
        }
      }

      // script/style/svg：只记本身，内部不展开（cut 标数量）。svg 内部是图标路径，无评审价值。
      if (bare) {
        var sc = safe(function () { return el.children ? el.children.length : 0; }, 0);
        if (sc) o.cut = (o.cut || 0) + sc;
        return finish(o, kids);
      }

      // iframe：同源递归其文档（占同一份预算），跨域只记标记不碰内容
      if (tag === 'iframe') {
        var inner = safe(function () { return el.contentDocument; }, null);
        if (inner && inner.documentElement && depth < DS_MAX_DEPTH && !outOfBudget()) {
          var kd = build(inner.documentElement, depth + 1, inputArea);
          if (kd) addKid(kd);
        } else {
          o.cross = 1;
        }
        return finish(o, kids);
      }

      if (depth >= DS_MAX_DEPTH) {
        o.deep = 1;
        return finish(o, kids);
      }

      // 普通页面直接文本合并截 20；输入框和可编辑区域的全部后代不采文本。
      var cn0 = safe(function () { return el.childNodes; }, null);
      if (cn0 && !inputArea) {
        var raw = [];
        for (var i = 0; i < cn0.length; i++) {
          var nd = cn0[i];
          if (nd && nd.nodeType === 3) raw.push(String(nd.nodeValue == null ? '' : nd.nodeValue));
        }
        var txt = dsClip(raw.join(' '), DS_TEXT_MAX);
        if (txt) o.x = txt;
      }

      var cn = safe(function () { return el.childNodes; }, null);
      if (!cn) { o.deep = 1; return finish(o, kids); }
      var shown = 0, total = 0;
      for (var j = 0; j < cn.length; j++) {
        var c = cn[j];
        if (!c || c.nodeType !== 1) continue;
        total++;
        if (shown >= DS_MAX_KIDS || outOfBudget()) continue;
        var kc = build(c, depth + 1, inputArea);
        if (kc) { addKid(kc); shown++; }
      }
      if (total > shown) o.cut = (o.cut || 0) + (total - shown);
      return finish(o, kids);
    }

    var t0 = Date.now();
    var tree = build(root, 0);
    var out = {
      v: 1,
      at: new Date().toISOString(),
      ok: !!tree,
      url: scrubUrl(safe(function () { return location.href; }, '')),
      title: clamp(safe(function () { return document.title; }, ''), 80),
      n: nodes,
      took: Date.now() - t0
    };
    if (tree) out.tree = tree;
    else out.why = capped ? '页面节点数超出预算，未能建树' : '建树失败';
    if (capped) out.capped = true;
    return out;
  }

  /** 出页面结构 → Promise<对象>；失败/超时都 resolve {ok:false,why}，绝不抛错 */
  function domStructure() {
    return new Promise(function (resolve) {
      var fin = false;
      function done(v) { if (fin) return; fin = true; resolve(v); }
      var timer = setTimeout(function () { done({ ok: false, why: '采集超时' }); }, 3000);
      try {
        var r = collectDomStructure();
        clearTimeout(timer);
        done(r);
      } catch (e) {
        clearTimeout(timer);
        done({ ok: false, why: thrownText(e) });
      }
    });
  }

  /** 汇总行用（同步、轻量）：全页元素总数 + 超限提示 */
  function domCountText() {
    if (extPage) return '无宿主页面';
    var n = safe(function () { return document.getElementsByTagName('*').length; }, 0);
    var s = n + ' 个元素';
    if (n > DS_MAX_NODES) s += '（导出时裁剪）';
    return s;
  }

  /** 结构树 → 缩进文本（面板/小窗预览用；阅读页有更完整的 HTML 渲染） */
  function domTreeText(data) {
    if (!data) return '(空)';
    if (!data.ok) return '未导出：' + (data.why || '未知原因');
    var L = [];
    function line(n, ind) {
      if (L.length >= 400) {
        if (L.length === 400) L.push('…（预览只显示前 400 行，完整内容随反馈提交）');
        return;
      }
      var s = ind + (n.t || '?');
      if (n.i) s += '#' + n.i;
      if (n.c) s += '.' + String(n.c).split(/\s+/).join('.');
      if (n.e) s += ' ★';
      var bits = [];
      if (n.x) bits.push('"' + n.x + '"');
      if (n.ti) bits.push('title=' + n.ti);
      if (n.al) bits.push('aria=' + n.al);
      if (n.ph) bits.push('ph=' + n.ph);
      if (n.d) bits.push('data:' + n.d);
      if (n.h) bits.push('> ' + n.h);
      if (n.s) bits.push('src: ' + n.s);
      if (n.sh) bits.push('shadowRoot');
      if (n.cross) bits.push('跨域 iframe');
      if (n.cut) bits.push('…' + n.cut + ' 个子节点未展开');
      if (n.deep) bits.push('…已达深度上限');
      if (bits.length) s += '  ' + bits.join(' | ');
      L.push(s);
      var ks = n.k || [];
      for (var i = 0; i < ks.length; i++) line(ks[i], ind + '  ');
    }
    line(data.tree || { t: '(无树)' }, '');
    if (data.capped) L.push('（节点数已达上限，部分内容未展开）');
    return L.join('\n');
  }

  /* ---------- 生成 Markdown 诊断报告(2026-10-16 新增) ---------- */

  // 页面类型中文名。键取自 flags.js 的 DYC_PAGE_PATTERNS(按声明顺序先匹配先返回),
  // 外加两个特殊值:extensionPage(扩展自身页面)与 unknown/other。
  var KIND_CN = {
    list: '商品列表页',
    liveCtrl: '直播中控台',
    shopAll: '抖店其他页',
    compassLive: '罗盘直播明细页',
    compassTable: '罗盘商品表页',
    debugTarget: '调试目标页',
    // 微信小店（2026-10-30 新增，仅基础设施）。三个键与 flags.js 的
    // DYC_PAGE_PATTERNS 一一对应，报出来是为了让诊断报告里能一眼分清
    // 「用户当时在哪一类微信页面」—— 以后加功能时这是第一手线索。
    wxGoodsList: '微信小店商品列表',
    wxShop: '微信小店后台',
    wxChannels: '视频号助手',
    wxAll: '微信小店其他页',
    extensionPage: '扩展页面',
    other: '其他页面',
    unknown: '未知'
  };

  // 能力探测的中文名。键与 detectCaps() 一一对应。
  var CAP_CN = {
    scripting: '脚本注入', tabs: '标签页 API', dnr: '网络规则', offscreen: '离屏文档',
    storageSession: '会话存储', shadow: 'Shadow DOM', clipboard: '剪贴板读',
    raf: '动画帧', idle: '空闲回调', mutation: 'DOM 监听', promise: 'Promise',
    fetch: 'fetch', uadata: 'UA 提示'
  };

  function kindText(k) { return KIND_CN[k] || String(k || '未知'); }

  /** 开关 key → 中文名(取自 flags.js 的元数据表;取不到就退回 key) */
  function flagLabel(k) {
    var m = safe(function () { return window.DYC_FLAGS_META; }, null);
    if (m) {
      for (var i = 0; i < m.length; i++) {
        if (m[i] && m[i].key === k) return m[i].label || k;
      }
    }
    return k;
  }

  /** 控件标识 → 中文名(取自 flags.js 的别名表;取不到就退回原标识) */
  function widgetLabel(id) {
    var a = safe(function () { return window.DYC_DIAG_WIDGET_NAMES; }, null);
    return (a && a[id]) ? a[id] : id;
  }

  function hhmmss(t) {
    try {
      var d = new Date(t);
      var p = function (n) { return (n < 10 ? '0' : '') + n; };
      return p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
    } catch (e) { return '?'; }
  }

  /**
   * 把快照渲染成 Markdown。
   *
   * 排序刻意按「AI 定位问题时的信息优先级」:
   *   异常 → 控件挂载 → 开关 → 轨迹 → 环境 → 原始 JSON。
   * 有报错时它排第一 —— 那是最该先看的东西。
   * 摘要与轨迹各自截断(报错 10 条 / 轨迹 20 条),完整内容仍留在末尾 JSON 里。
   */
  function renderReport(snap) {
    var L = [];
    var env = snap.env || {};
    var errs = snap.errors || [];
    var tl = snap.timeline || [];
    var wg = snap.widgets || {};
    var groups = wg.groups || [];
    var flags = snap.flags || null;

    var badW = 0;
    groups.forEach(function (g) { if (g.bad) badW++; });

    /* ---- 摘要 ---- */
    L.push('# DY-COCO 诊断报告');
    L.push('');
    L.push('**一句话**:' + kindText(env.kind)
      + ' · v' + (env.ver || '?')
      + ' · ' + (env.engine || '?')
      + ' · ' + errs.length + ' 条报错'
      + ' · ' + groups.length + ' 个扩展控件'
      + (badW ? '(其中 ' + badW + ' 个异常)' : ''));
    if (snap.truncated) L.push('> ⚠ 快照超出体积上限,已按「轨迹 → 控件细节 → 报错」顺序削减。');
    L.push('');

    /* ---- 一、异常与报错 ---- */
    L.push('## 一、异常与报错(' + errs.length + ' 条)');
    if (!errs.length) {
      L.push('(无)');
    } else {
      errs.slice(-10).forEach(function (e, i) {
        L.push((i + 1) + '. `[' + hhmmss(e.t) + '][' + (e.s || '?') + ']` ' + (e.m || '(空)'));
        if (e.k) {
          L.push('   ```');
          String(e.k).split('\n').slice(0, 4).forEach(function (ln) {
            L.push('   ' + ln);
          });
          L.push('   ```');
        }
      });
      if (errs.length > 10) {
        L.push('… 另有 ' + (errs.length - 10) + ' 条,完整内容见末尾 JSON。');
      }
    }
    L.push('');

    /* ---- 二、控件挂载 ---- */
    L.push('## 二、扩展控件挂载(' + groups.length + ' 个)');
    if (!wg.ok) {
      L.push('扫描失败:' + (wg.why || '未知原因'));
    } else if (!groups.length) {
      L.push('(页面内没有扫到任何扩展控件)');
    } else {
      L.push('| 控件 | 中文名 | 数量 | 状态 | 位置 | 尺寸 |');
      L.push('|---|---|---|---|---|---|');
      groups.forEach(function (g) {
        var st = g.bad === 'hidden' ? '⚠ 被隐藏'
          : g.bad === 'zero-size' ? '⚠ 尺寸为 0'
            : '正常';
        var pos = g.rect ? '[' + g.rect[0] + ',' + g.rect[1] + ']' : '-';
        var size = g.rect ? g.rect[2] + '×' + g.rect[3] : '-';
        L.push('| `' + g.id + '` | ' + widgetLabel(g.id) + ' | ' + g.n
          + ' | ' + st + ' | ' + pos + ' | ' + size + ' |');
      });
    }
    L.push('');

    /* ---- 三、功能开关与档位 ---- */
    L.push('## 三、功能开关与档位');
    if (!flags) {
      L.push('(读取失败 —— 通常意味着页面侧读 storage 超时)');
    } else {
      var on = flags.on || {};
      var keys = Object.keys(on);
      if (!keys.length) {
        L.push('(无开关数据)');
      } else {
        keys.forEach(function (k) {
          L.push('- ' + flagLabel(k) + ':`' + k + '` = ' + (on[k] ? '开' : '关'));
        });
      }
      var mode = flags.mode || {};
      if (mode.scanShade) L.push('- 扫描白幕档位 = ' + mode.scanShade);
      if (mode.omni) L.push('- 全能搜索档位 = ' + mode.omni);
      if (flags.hideList) {
        var n = 0;
        if (Array.isArray(flags.hideList)) n = flags.hideList.length;
        else if (typeof flags.hideList === 'object') n = Object.keys(flags.hideList).length;
        if (n) L.push('- 隐藏勾选项:' + n + ' 项');
      }
    }
    /* ---- 浮条扫描探针(2026-10-24 #104):区分「没跑/跑了没命中/预算耗尽没扫全」 ---- */
    var bs = snap.barScan || {};
    var bsMeta = bs.meta;
    var bsRej = bs.rejects || [];
    if (!bsMeta && !bsRej.length) {
      L.push('- 浮条扫描:无读数(本页没跑过扫描 —— 功能关/未勾选/页面不匹配)');
    } else {
      if (bsMeta) {
        L.push('- 浮条扫描(最近一次 ' + (bsMeta.at || '?') + '):配置 ' + bsMeta.cfgs + ' 套'
          + ' · 遍历 ' + bsMeta.nodes + ' 节点'
          + (bsMeta.budgetOut ? ' · ⚠预算耗尽(可能有子树没扫到)' : '')
          + (bsMeta.depthOut ? ' · ⚠深度截断' : '')
          + ' · 打标隐藏 ' + bsMeta.marked + ' 个');
      }
      if (bsRej.length) {
        var bsShow = bsRej.slice(-6);
        L.push('- 浮条候选被档位淘汰(共 ' + bsRej.length + ' 条,展示最近 ' + bsShow.length + ' 条):');
        bsShow.forEach(function (rj) {
          L.push('  - `' + (rj.t || '?') + '` 命中[' + (rj.hit || '?') + '] '
            + (rj.why || '?') + ' | ' + (rj.rect || '?') + ' | ' + (rj.el || '?'));
        });
        L.push('> 判读:词命中却没藏 = 卡在上述某一档;若命中列表为空且无淘汰记录,');
        L.push('> 说明词表没命中(文本预筛就淘汰)或预算耗尽没遍历到 —— 结合上面汇总行定位。');
      }
    }
    L.push('');

    /* ---- 四、操作轨迹 ---- */
    L.push('## 四、操作轨迹(显示最近 ' + Math.min(tl.length, 20) + ' 条,共 ' + tl.length + ' 条)');
    if (!tl.length) {
      L.push('(无)');
    } else {
      tl.slice(-20).forEach(function (r) {
        var s = '- `' + hhmmss(r.t) + '` ' + (r.a || '?');
        if (r.d) s += ' — ' + r.d;
        if (r.r) s += ' → ' + r.r;
        L.push(s);
      });
    }
    L.push('');

    /* ---- 五、自动循环讲解 ---- */
    var al = snap.autoLoop;
    L.push('## 五、自动循环讲解');
    if (!al) {
      L.push('(本页没有自动循环讲解,或它还没启动)');
    } else {
      var st = al['状态'] || {}, sc = al['现场'] || {};
      /* 2026-11-01 修:原来这里判断 st.mode === 'second',但快照导出的字段是 group
       * (值是 'sec')—— 名字和值都对不上,于是无论选哪档都显示成「N 分钟」。
       * 用户按报告判断配置时会被误导(实测 15 秒档被读成 1 分钟)。 */
      L.push('- 状态:' + (st.on ? '开' : '关') + ' · ' + (st.phase || '?') +
        ' · 间隔 ' + (st.group === 'sec' ? ((st.seconds || '?') + ' 秒') : ((st.minutes || '?') + ' 分钟')) +
        (st.round ? (' · 第 ' + st.round + ' 轮') : '') +
        (st.fails ? (' · 连续失败 ' + st.fails + ' 次') : '') +
        (st.busy ? ' · 正在动作' : ''));
      /* 「均 X 秒/轮」:后台到底跑没跑起来,只看这一个数就够。
         round 会在换品时归零,所以用只增不减的 cycles 来算。 */
      if (st.on && st.cycles && st.runSec > 0) {
        var avg = Math.round((st.runSec || 0) / st.cycles);
        L.push('- 节奏:均 ' + avg + ' 秒/轮(已跑 ' + (st.runSec || 0) +
          ' 秒 · 完成 ' + st.cycles + ' 次)' +
          (avg > 45 ? ' ⚠ 偏慢,后台等待可能仍被节流' : ''));
      }
      /* 2026-11-01 统一闹钟:页面切到后台后靠离屏文档打拍子。
       * 这一行是「切走后还动不动」的唯一证据 —— 一拍没收到就直说,别静默。 */
      var bt = st.beat || {};
      L.push('- 闹钟:' + (bt.n
        ? ('已收 ' + bt.n + ' 拍 · 最近 ' + bt.last + ' 秒前' + (bt.last > 65 ? ' ⚠ 疑似停摆' : ''))
        : '未收到拍点(切到后台后循环会失效)') +
        ' · 注册=' + (bt.reg || '?') + ' · 监听=' + (bt.listen ? '是' : '否') +
        ' · 代码=' + (bt.tag || '旧'));
      /* 后台等待走的是拍子还是兜底定时器 —— 这一行直接说明"后台动作靠什么推动"。
         全 0 说明还没在后台跑过一轮,不能当作通了的证据。 */
      if (bt.nap || bt.fb) {
        L.push('- 后台等待:拍子放行 ' + (bt.nap || 0) + ' 次 · 兜底 ' + (bt.fb || 0) + ' 次' +
          (bt.fb > bt.nap ? ' ⚠ 拍子没推动,走的多是兜底' : ''));
      }
      L.push('- 身份键:' + (st.key || '无') + ' · 商品:' + (st.product || '无') +
        (st.secondsLeft === null || st.secondsLeft === undefined ? '' : (' · 距下次续讲 ' + st.secondsLeft + ' 秒')));
      L.push('- 现场:行 ' + (sc.rows || 0) + ' 个 · 讲解中标记 ' + (sc.marks || 0) + ' 个 · 锚点 ' +
        (sc.anchorMode || '?') + ' · 胶囊 left ' + (sc.capLeft === null ? '?' : sc.capLeft) +
        ' · 迷你 ' + (sc.mini ? '是' : '否') + ' · 寻址槽 dx ' + (sc.lampSlotDX === undefined ? '?' : sc.lampSlotDX));
      if (sc.liveRow) L.push('- 讲解中的行:' + clamp(sc.liveRow, 40) + ' · 按钮「' + (sc.btn || '') + '」');
      if (sc.rowKeys && sc.rowKeys.length) L.push('- 前几行身份键:' + sc.rowKeys.join(' / '));
      if (sc.idSample) {
        L.push('- ID 体检:' + (sc.idSample.picked ? ('picked=' + sc.idSample.picked) : '未抓到') +
          (sc.idSample.hits && sc.idSample.hits.length ? (' · 属性:' + sc.idSample.hits.slice(0, 4).join('; ')) : ''));
      }
      if (sc.recent && sc.recent.length) {
        L.push('- 最近流水:');
        sc.recent.slice(-8).forEach(function (r) { L.push('  - ' + String(r)); });
      }
    }
    L.push('');

    /* ---- 六、超级福袋（2026-11-01 晚补）----
     * 为什么要单列一段：用户报「发了福袋没反应」时，报告里只有一个
     * `panel/rows` 的 JSON 读数，无法区分「抽屉没开」和「开了但认不出来」。
     * 现在这一段把「靠什么认出抽屉 / 每行每格写的什么 / 链接可不可点」
     * 全部摊开 —— 用户复制报告即可，不必再教他做什么。 */
    var lb = snap.luckyBag;
    L.push('## 六、超级福袋(中控台)');
    if (!lb) {
      L.push('(本页没有超级福袋模块,或它还没启动)');
    } else {
      var lbSt = lb['状态'] || {}, lbSc = lb['现场'] || {};
      L.push('- 状态:监视 ' + (lbSt.flags && lbSt.flags.watch ? '开' : '关') +
        ' · 开始下一轮 ' + (lbSt.flags && lbSt.flags.auto ? '开' : '关') +
        ' · ' + (lbSt.phase || '?') +
        ' · 圆钮显示「' + (lbSt.badge || '?') + '」');
      L.push('- 计时:扫描 ' + (lbSt.timers && lbSt.timers.tick ? '在跑' : '停了') +
        ' · 圆钮刷新 ' + (lbSt.timers && lbSt.timers.badge ? '在跑' : '停了') +
        (lbSt.drawIn ? (' · 距开始约 ' + Math.round(lbSt.drawIn / 1000) + ' 秒') : ''));
      /* 开播判据与确认节拍（2026-11-01 定，2026-11-03 改口径）。
       * 「未开播不生效」由共享判据 src/content/live-state.js 给出结论，
       * 福袋这边**只有明确在播才动作**（用户 2026-11-03 拍板）。
       *   live    ⇒ 按间隔开抽屉 / 自动发福袋放行；
       *   idle    ⇒ 不动作（未开播 / 已下播）；
       *   unknown ⇒ **也不动作**（旧版按在播处理，正是「没开播一直弹抽屉」的根因）。
       * 这里必须把「认不出」与「认出了但闸关」分开报，否则排查时分不清是判据
       * 失配还是闸门没生效 —— 两者修法完全不同。 */
      var lv = lbSt.live || 'unknown';
      var gateOpen = lbSt.gate === true;
      var lvText = lv === 'live' ? '在播' : (lv === 'idle' ? '**未开播/已下播**' : '认不出');
      L.push('- 开播判据:' + lvText +
        ' · 自动动作' + (gateOpen ? '放行（按间隔确认）' : '**已暂停**（只有明确在播才动作）'));
      var ck = lbSt.check || {};
      if (ck.min) {
        L.push('- 确认节拍:每 ' + ck.min + ' 分钟自己开一次抽屉' +
          (ck.last ? (' · 上次 ' + hhmmss(ck.last)) : ' · 还没开过') +
          (ck.busy ? ' · 正在开' : '') +
          (ck.stat ? (' · ' + ck.stat) : '') +
          (ck.note ? (' · ⚠' + ck.note) : ''));
      }
      /* 续发闸（2026-11-05）：自动发福袋开着却「不续发」时，这条直接回答
       * 「卡在哪一道」。lucky-bag 每拍记最后一次否决原因，这里只负责转述。 */
      if (lbSt.auto) {
        var la = lbSt.auto;
        L.push('- 续发闸:' + (la.why || '?') +
          ' · 下次开抽屉 ' + (la.lookIn > 0 ? (Math.round(la.lookIn / 1000) + ' 秒后') : '已到点') +
          (la.gapSec ? (' · 发福袋间隔 ' + la.gapSec + ' 秒') : ''));
      }
      L.push('- 抽屉:' + (lbSc.panel ? ('已认出(' + (lbSc.by || '?') + ')') : '**没认出**') +
        ' · 行 ' + (lbSc.rows || 0) + ' 个 · 全页「开始活动」链接 ' + (lbSc.startLinks || 0) + ' 个' +
        (lbSc.searchPh ? (' · 搜索框「' + clamp(lbSc.searchPh, 20) + '」') : '') +
        (lbSc.drawerCls ? (' · 容器 ' + lbSc.drawerCls + (lbSc.drawerBox ? (' ' + lbSc.drawerBox) : '')) : ''));
      var lbRows = lbSc.detail || [];
      var pt = lbSc.pageText;
      if (!lbSc.panel && !lbRows.length) {
        if (pt && pt.start) {
          /* 2026-11-02 深夜：这对读数（整页有、叶子级 0）是"平台把文案拆成
           * 多个节点"的铁证 —— 老锚点必然全灭，新版改容器级判定。 */
          L.push('> 判读:整页文本里**有**「开始活动」但叶子级一条都认不到 ⇒');
          L.push('> 平台把按钮/标题拆成了多个节点(整串不再落在单个元素上)。');
          L.push('> 新版已改用容器级判定;若这里仍为 0,请把本报告发回。');
        } else {
          L.push('> 判读:抽屉没认出也没有行。**先确认你打开的是超级福袋抽屉**;');
          L.push('> 开着还这样,就是锚点不匹配 —— 把下面「线索」一并看。');
        }
      }
      if (lbRows.length) {
        L.push('');
        L.push('| # | 状态 | 奖励名 | 链接 | 格数 | 尺寸 | 行文本 |');
        L.push('|---|---|---|---|---|---|---|');
        lbRows.forEach(function (r, i) {
          L.push('| ' + (i + 1) + ' | ' + (r.kind || '?') + ' | ' + (r.key || '-') +
            ' | ' + (r.link || '-') + ' | ' + (r.cells || 0) + ' | ' + (r.rect || '?') +
            ' | ' + clamp(r.text || '', 46) + ' |');
        });
        var multi = lbRows.filter(function (r) { return r.kind === 'running'; }).length;
        var pend = lbRows.filter(function (r) { return r.kind === 'pending'; }).length;
        L.push('> 判读:进行中 ' + multi + ' · 待开始 ' + pend +
          '。圆钮显示倒计时要求「进行中」行里有带标签的倒计时(距结束 03:12)。');
      }
      /* 逐张卡片读数（2026-11-02 深夜）：行扫描认错时这里才是真话 ——
       * 真机出现过「两张卡在跑，行扫描一条进行中都没认出来」。
       * 按剩余时间升序，第一条就是最早结束的那张。 */
      var lbCards = lbSc.cards || [];
      if (lbCards.length) {
        L.push('- 逐张卡片读数(按剩余时间升序):' + lbCards.map(function (c) {
          return '`' + clamp(c.name || '?', 12) + '` 剩 ' + c.left + ' 秒';
        }).join(' · '));
      } else if (lbSc.panel) {
        L.push('- 逐张卡片读数:没读到「…后结束」(抽屉里此刻没有进行中的卡)');
      }
      /* 全页文本检查（2026-11-02 晚）：clues 只扫可见叶子，这里回答
       * 「整页文本里到底有没有」—— 有但扫不到 = 在不可见/Shadow 容器；
       * 整页都没有 = 平台确实没往页面上渲染（抽屉关着），只能开抽屉读。 */
      pt = pt || lbSc.pageText;
      if (pt) {
        L.push('- 全页文本检查:含「进行中活动」' + (pt.card ? '✓' : '✗') +
          ' · 含「后结束」' + (pt.tail ? '✓' : '✗') +
          ' · 含「开始活动」' + (pt.start ? '✓' : '✗') +
          ' · 含「福袋」' + (pt.bag ? '✓' : '✗') +
          ' · 含平台空态「没有进行中的福袋活动」' + (pt.empty ? '✓' : '✗') +
          '（共 ' + pt.len + ' 字）');
        if (pt.card && !lbRows.length) {
          L.push('> 判读:整页文本里有「进行中活动」但行扫不到 —— 多半在不可见容器或 Shadow DOM 里,看下面的线索定位。');
        } else if (!pt.card) {
          L.push('> 判读:整页文本里**没有**「进行中活动」—— 平台当前没往页面上渲染卡片(多半抽屉关着),只能开抽屉读。');
        }
      }
      var cl = lbSc.clues || [];
      if (cl.length) {
        L.push('- 抽屉外福袋相关文字(' + cl.length + ' 条,回答「关着抽屉能不能读」):');
        cl.slice(0, 12).forEach(function (c) {
          L.push('  - `' + clamp(c.t, 30) + '`' +
            (c.time ? (' · 时间 ' + c.time) : '') +
            (c.kind ? (' · ' + c.kind) : '') +
            (c.box ? (' · ' + c.box) : '') +
            (c.tag ? (' · ' + c.tag + (c.cls ? '.' + c.cls : '')) : '') +
            (c.anc ? (' · 祖先 ' + clamp(c.anc, 40)) : ''));
        });
      } else {
        L.push('- 抽屉外福袋相关文字:无(⇒ 关着抽屉读不到,只能开抽屉)');
      }
      var lbRing = lbSt.ring || [];
      if (lbRing.length) {
        L.push('- 最近流水:');
        lbRing.slice(-6).forEach(function (r) {
          L.push('  - ' + hhmmss(r.t) + ' ' + clamp(r.msg, 40));
        });
      }
    }
    L.push('');

    /* ---- 六·五、滚动链(上滑/下滑圆钮) ---- */
    var schn = snap.scrollChain;
    if (schn) {
      L.push('## 六·五、滚动链(上滑/下滑圆钮)');
      L.push('- 页顶锚点:' + (schn.anchorFound ? '认到' : '**没认到**') +
        ' · 购物车容器:' + (schn.cartFound ? '认到' : '**没认到**') +
        ' · 商品行:' + schn.rows + ' · 全页可滚容器:' + schn.scrollableCount +
        ' · 链上:' + schn.chainLen + ' · windowY:' + schn.winY);
      if (schn.cart) {
        L.push('- 购物车容器:' + schn.cart.tag + (schn.cart.id ? '#' + schn.cart.id : '') +
          ' .' + (schn.cart.cls || '').split(' ').join(' .') +
          ' · scrollTop ' + schn.cart.st + ' / 内容高 ' + schn.cart.sh + ' / 可视高 ' + schn.cart.ch +
          ' · overflowY ' + (schn.cart.ov || '?') +
          (schn.cart.rect ? ' · rect ' + schn.cart.rect.join(',') : ''));
      }
      L.push('- 链上容器(' + schn.chain.length + '):');
      schn.chain.forEach(function (c) {
        L.push('  - ' + c.tag + (c.id ? '#' + c.id : '') + ' .' + (c.cls || '').split(' ').join(' .') +
          ' · scrollTop ' + c.st + ' / ' + c.sh + '/' + c.ch + ' · ' + (c.ov || '?') +
          (c.rect ? ' · ' + c.rect.join(',') : ''));
      });
      L.push('- 全页可滚容器(' + schn.scrollables.length + '):');
      schn.scrollables.forEach(function (c) {
        L.push('  - ' + c.tag + (c.id ? '#' + c.id : '') + ' .' + (c.cls || '').split(' ').join(' .') +
          ' · scrollTop ' + c.st + ' / ' + c.sh + '/' + c.ch + ' · ' + (c.ov || '?') +
          (c.rect ? ' · ' + c.rect.join(',') : ''));
      });
      L.push('');
    }

    /* ---- 七、环境 ---- */
    L.push('## 七、环境');
    L.push('- 作用域:' + (env.scope === 'extPage' ? '扩展页面' : '页面内容脚本'));
    if (env.url) L.push('- 地址:' + env.url);
    if (env.title) L.push('- 页面标题:' + env.title);
    L.push('- 视口:' + env.vw + ' × ' + env.vh + ' @' + env.dpr + 'x');
    L.push('- 文档高度:' + env.docH);
    L.push('- 内核:' + env.engine);
    L.push('- UA:' + env.ua);
    L.push('- 扩展版本:' + env.ver);
    L.push('- 已运行:' + Math.round((env.age || 0) / 1000) + ' 秒');
    L.push('- 采集耗时:' + (snap.took || 0) + ' ms');
    if (env.why) L.push('- 降级原因:' + env.why);
    L.push('');

    if (env.caps) {
      var cs = [];
      Object.keys(env.caps).forEach(function (k) {
        cs.push((CAP_CN[k] || k) + (env.caps[k] ? '✓' : '✗'));
      });
      L.push('**能力探测**:' + cs.join(' · '));
      if (env.scope !== 'extPage') {
        L.push('');
        // 不写这句,AI 会把「页面侧看不到 tabs/dnr」误判成「扩展缺权限」。
        L.push('> 注:内容脚本上下文里「标签页 API / 网络规则 / 离屏文档」显示 ✗ 属**正常现象** ——');
        L.push('> 这几项只存在于后台 Service Worker,不代表扩展缺权限。');
      }
      L.push('');
    }

    /* ---- 八、原始 JSON ---- */
    L.push('## 八、原始 JSON(完整快照)');
    L.push('');
    L.push('```json');
    L.push(safe(function () { return JSON.stringify(snap, null, 2); }, '(序列化失败)'));
    L.push('```');

    return L.join('\n');
  }

  /** 出 Markdown 诊断报告 → Promise<string>;任何失败都返回一句可读的说明,不抛错 */
  function report(extra) {
    return snapshot(extra).then(function (snap) {
      if (snap && snap.failed) {
        return '诊断报告生成失败:采集快照时出错。\n\n原始返回:\n```json\n'
          + safe(function () { return JSON.stringify(snap, null, 2); }, '(无法序列化)')
          + '\n```';
      }
      return safe(function () { return renderReport(snap); }, '诊断报告渲染失败。');
    }, function () {
      return '诊断报告生成失败:采集快照超时。';
    });
  }

  /** 清空报错与轨迹缓冲(调试面板的「清空日志」按钮调用) */
  function clear() {
    try {
      errors.length = 0;
      timeline.length = 0;
    } catch (e) { /* 清不掉也不能影响主流程 */ }
  }

  window.__dycDiag = {
    note: note,
    noteError: noteError,
    snapshot: snapshot,
    report: report,
    clear: clear,
    countText: countText,
    // 页面结构导出（2026-10-22 新增，反馈可选项「导出页面结构」）
    domStructure: domStructure,       // Promise<对象>，失败 resolve {ok:false,why}
    domCountText: domCountText,       // 同步一行汇总（面板汇总行用）
    domTreeText: domTreeText,         // 结构树 → 缩进文本（预览框用）
    why: '',
    // 调试用:看当前缓冲(不对外承诺)
    _dump: function () { return { errors: errors.slice(), timeline: timeline.slice() }; }
  };
})();
