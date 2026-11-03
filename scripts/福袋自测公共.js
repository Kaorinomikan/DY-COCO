/**
 * 自测 · 超级福袋「开奖监视 + 自动开始下一轮」（jsdom）
 * ============================================================
 * 盯的是用户 2026-11-01 拍板的口径：
 *
 *   ① 两个开关分开：监视只读、开始下一轮默认关；
 *   ② 开奖即开始下一轮：对同一个活动再点一次「开始活动」；
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
      /* 2026-11-04：成功口径要求「确认发出 + 读到倒计时」，所以这里给
       * 「带倒计时的进行中」—— 没有倒计时的那一路由 ㊾ 专验（只读追读 → 失败）。 */
      if (opts.onStartClick === 'runningTimed') {
        const st2 = doc.getElementById('st1');
        if (st2) st2.textContent = '● 活动进行中 距结束 08:00';
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
      /* 2026-11-04：full / standalone / histKey 也要收 —— 结束播报与失败
       * 播报的「条上短、盒子里全」全压在 full 里，不存就验不了。 */
      full: o.full || '', standalone: !!o.standalone, histKey: o.histKey || '',
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

/** 汇总并退出：各分组共用这一份计数，退出码语义与拆分前一致。 */
function summary() {
  console.log('');
  console.log('通过 ' + pass + ' 项' + (failures.length ? '，失败 ' + failures.length + ' 项' : '，全部通过'));
  if (failures.length) {
    failures.forEach(function (f) { console.log('   \u2717 ' + f); });
  }
  process.exit(failures.length ? 1 : 0);
}

module.exports = {
  ROOT: ROOT, CODE: CODE, LIVE_STATE_CODE: LIVE_STATE_CODE,
  FLAGS_SRC: FLAGS_SRC, MANIFEST: MANIFEST, PRIZE: PRIZE,
  ok: ok, sleep: sleep, summary: summary,
  liveTagHtml: liveTagHtml, makeDom: makeDom, boot: boot,
  setText: setText, remove: remove,
  bootDrawer: bootDrawer, drawerHtml: drawerHtml, bootBagPage: bootBagPage,
  cardHtml: cardHtml, waitBag: waitBag,
};
