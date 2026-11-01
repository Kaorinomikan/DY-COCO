/**
 * 直播回放 · 界面层（下载按钮 / 确认卡 / 进度条 / 跳转按钮）
 * ============================================================
 * 【两个页面，两套界面，同一个 Shadow DOM 工具箱】
 *   · anchor.douyin.com/anchor/review（直播复盘）
 *       → 视频右上角一枚「下载回放」；点开后先弹确认卡，再走下载。
 *   · compass.jinritemai.com/screen/live/*（直播大屏专业版）
 *       → 播放器下方一枚「跳转直播服务平台」，**不提供下载**
 *         （用户 2026-10-18 定：大屏只做跳转，下载统一回服务平台做）。
 *
 * 【为什么全部塞进一个 Shadow DOM】
 *   回放页的样式是平台自己的，且会随版本改。按钮要保证「看起来一样、位置一样」，
 *   就必须与页面样式彻底隔开：
 *     · `all: initial` 把继承来的字体 / 行高 / 颜色 / letter-spacing 全部清掉；
 *     · 尺寸一律 **固定 px**，不写 rem / em / %，页面缩放不影响按钮大小
 *       （工程既有硬约定,来自浮动圆钮的三轮返工）。
 *   样式写在 shadow 内部的 <style> 里，**不写进 replay.css**：
 *   外层 CSS 进不了 shadow，写了也没用，还会让人误以为改那里有效。
 *
 * 【为什么不用工程里现成的 dialog.js 的 showConfirmDialog】
 *   那个弹窗是 document 级、带遮罩、danger 红按钮，用来做「不可逆写操作」确认。
 *   这里的确认卡是**说明性**的（这场多长、多大、存成什么名），不该盖住播放器、
 *   不该拦页面操作。所以单独做一张轻量卡，挂在同一个 shadow 里。
 *
 * 【按钮位置怎么定】
 *   不写 `position:fixed` —— 回放页视频容器常带 transform，fixed 会被劫成
 *   relative（search.js 有过三轮修复的教训）。做法是：
 *   把 host 元素插进「视频容器」里、用 absolute 贴右上角，让宿主位置决定坐标。
 *   宿主找不到时退回 fixed（贴视口右上角），至少功能还能用。
 */
(function () {
  'use strict';

  if (window.__DYC_REPLAY_UI__) return;

  var HOST_ID = 'dyc-replay-host';

  /* ---------- 样式（shadow 内部，全部 px）---------- */
  var CSS = [
    ':host{all:initial}',
    '*{box-sizing:border-box;margin:0;padding:0}',

    /* 按钮（2026-10-18 用户拍板 A1：主色实心）
       与「跳转直播服务平台」同一套蓝，两页的控件看起来是一族。
       尺寸全部固定 px，不随页面缩放变（工程硬约定）。 */
    '.btn{position:relative;z-index:2147483000;',
    '  display:inline-flex;align-items:center;gap:7px;',
    '  height:32px;min-width:118px;justify-content:center;padding:0 15px;border-radius:7px;',
    '  background:#165dff;color:#fff;',
    '  font:600 13.5px/1 -apple-system,"Segoe UI","Microsoft YaHei",sans-serif;',
    '  letter-spacing:0;cursor:pointer;user-select:none;',
    '  border:1px solid #165dff;',
    '  box-shadow:0 4px 14px rgba(22,93,255,.42);',
    '  transition:background .15s,box-shadow .15s,transform .15s}',
    '.btn:hover{background:#0e42d2;border-color:#0e42d2;',
    '  box-shadow:0 6px 18px rgba(14,66,210,.46);transform:translateY(-1px)}',
    '.btn:active{transform:translateY(0)}',
    '.btn.busy{opacity:.88;cursor:default}',
    '.btn.dead{background:#86909c;border-color:#86909c;box-shadow:none;',
    '  opacity:.6;cursor:not-allowed}',
    '.btn svg{width:14px;height:14px;flex:none}',

    /* 确认卡
       ⚠️ 位置改过三轮，别再凭感觉改这一行：
       ① 按钮在播放器右上角（现行）⇒ 卡片右缘对齐按钮右缘、朝**左**展开，
          默认值就写 right:0 / left:auto；
       ② 曾经试过按钮在左上角 ⇒ 那版必须 left:0，否则卡片整块长出屏幕外
          （用户 2026-10-18 截图「看不到对话框」）。
       两个方向都靠 placePop() 用实测矩形再判一次：右边放不下就右对齐、
       下方放不下就翻上去 —— 所以按钮无论落在哪个角，卡片都不会出屏。
       改这里的默认值只影响「placePop 尚未跑」的一瞬，别把它当成唯一依据。 */
    '.card{position:absolute;top:38px;right:0;left:auto;z-index:2147483001;width:302px;',
    '  background:#fff;color:#1f2329;border-radius:8px;',
    '  box-shadow:0 6px 26px rgba(0,0,0,.30);overflow:hidden;',
    '  font:400 12.5px/1.7 -apple-system,"Segoe UI","Microsoft YaHei",sans-serif}',
    '.card[hidden]{display:none}',
    '.hd{padding:11px 14px 9px;font-size:13px;font-weight:600;border-bottom:1px solid #f0f1f3}',
    '.bd{padding:10px 14px 12px}',
    '.kv{display:flex;gap:8px;padding:2px 0}',
    '.kv .k{width:60px;flex:none;color:#86909c}',
    '.kv .v{flex:1;min-width:0;word-break:break-all;font-variant-numeric:tabular-nums}',
    '.kv .v b{font-weight:600}',
    '.nm{display:flex;gap:4px;align-items:center;margin-top:8px;padding-top:8px;border-top:1px dashed #eceef1}',
    '.nm input{flex:1;min-width:0;height:26px;padding:0 7px;border:1px solid #d9dce1;border-radius:5px;',
    '  font:400 12px/1 -apple-system,"Segoe UI","Microsoft YaHei",sans-serif;color:#1f2329;background:#fff}',
    '.nm input:focus{outline:none;border-color:#165dff}',
    '.nm .ext{flex:none;color:#86909c}',
    '.warn{margin-top:9px;padding:7px 9px;background:#fff7e8;border-radius:5px;',
    '  color:#a05a00;font-size:11.5px;line-height:1.65}',
    '.warn.bad{background:#ffece8;color:#cb2634}',
    '.ft{display:flex;gap:8px;justify-content:flex-end;padding:0 14px 12px}',
    '.ft button{height:28px;padding:0 14px;border-radius:5px;border:1px solid #d9dce1;',
    '  background:#fff;color:#4e5969;font:500 12px/1 inherit;cursor:pointer}',
    '.ft button:hover{background:#f7f8fa}',
    '.ft button.go{background:#165dff;border-color:#165dff;color:#fff}',
    '.ft button.go:hover{background:#0e42d2}',
    '.ft button:disabled{opacity:.5;cursor:not-allowed}',

    /* 下载详情卡（2026-10-18 三改：蓝白层次 + 绿色进度条 + 文字一律不换行 + 开合动效）
       ============================================================
       结构分三层，蓝 → 白 → 蓝：
         .pc      蓝色外壳（渐变底 + 内高光 + 蓝调投影）
         .pc-body 白色内衬（圆角面板，进度条与数值都住在里面）
         .pc-ft   按钮留在蓝底上（与外壳同层，收口干净）
       用户原话：「进度条颜色改成绿色，展开的界面改成蓝色和白色的层次感的设计」。
       进度条绿色 = #00b42a 系渐变（成功色），轨道压在白色内衬上才显得出层次；
       文字「不要换行」：meta 两栏一律 nowrap，卡片宽度给到 344px 容得下一整行
       （300px 时「68/1970 段」的「段」会被挤到下一行，很难看）。
       ⚠️ 别再改回「深蓝底 + 浅蓝条」的单层配色：那是上一版，用户明确要蓝白层次。 */
    '.pc{position:absolute;top:38px;right:0;left:auto;z-index:2147483001;',
    '  width:344px;max-width:calc(100vw - 20px);box-sizing:border-box;',
    '  background:linear-gradient(180deg,#2a6bff 0%,#165dff 44%,#0f45c9 100%);color:#fff;',
    '  border-radius:12px;padding:11px 11px 10px;border:1px solid rgba(255,255,255,.22);',
    '  box-shadow:0 14px 34px rgba(10,40,120,.45),0 2px 6px rgba(10,40,120,.26),',
    '   inset 0 1px 0 rgba(255,255,255,.30);',
    '  font:400 12px/1.5 -apple-system,"Segoe UI","Microsoft YaHei",sans-serif;',
    /* 展开/收纳动效：位移 + 轻微缩放 + 淡入，transform-origin 由 placePop 按落点现设
       （朝下展开时从顶边「长出来」，朝上翻时从底边「长出来」） */
    '  transform-origin:top right;opacity:0;visibility:hidden;',
    '  transform:translateY(-8px) scale(.96);',
    '  transition:opacity .16s ease,transform .22s cubic-bezier(.2,.9,.3,1.12),visibility .16s linear}',
    '.pc.in{opacity:1;visibility:visible;transform:none}',
    '.pc[hidden]{display:none}',
    '.pc.fade{opacity:0;transform:translateY(-6px) scale(.97)}',
    '.pc-top{display:flex;align-items:flex-end;gap:10px;padding:1px 3px 9px}',
    '.pc-lab{flex:1;min-width:0}',
    '.pc-t1row{display:flex;align-items:center;gap:6px;min-width:0}',
    '.pc-lab .t1{font:600 12.5px/1.3 inherit;color:#fff;flex:none;',
    '  white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    /* 并发档位小徽标：从右栏挪到标题行，右栏才能保证一行放得下（用户要求不换行） */
    '.pc-badge{flex:none;padding:1px 6px;border-radius:8px;background:rgba(255,255,255,.24);',
    '  color:#eaf2ff;font:600 10px/1.6 inherit;letter-spacing:.2px;white-space:nowrap}',
    '.pc-badge[hidden]{display:none}',
    '.pc-lab .t2{font:400 11px/1.5 inherit;color:#cfe0ff;margin-top:2px;',
    '  white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '.pc-pct{flex:none;font:700 26px/1 inherit;letter-spacing:-.5px;',
    '  font-variant-numeric:tabular-nums;color:#fff;text-shadow:0 1px 2px rgba(8,30,90,.35)}',
    '.pc-pct i{font:600 12px/1 inherit;font-style:normal;margin-left:1px;color:#d6e5ff}',
    /* 白色内衬：进度条与数值的「纸面」 */
    '.pc-body{background:#fff;border-radius:9px;padding:10px 10px 9px;',
    '  box-shadow:0 1px 3px rgba(8,30,90,.20)}',
    '.pc-tr{height:7px;background:#eef1f7;border-radius:4px;overflow:hidden}',
    '.pc-fl{height:100%;width:0;border-radius:4px;',
    '  background:linear-gradient(90deg,#2fd44b,#00b42a);',
    '  transition:width .3s cubic-bezier(.25,.8,.4,1)}',
    '.pc-meta{display:flex;justify-content:space-between;align-items:baseline;gap:10px;',
    '  margin-top:8px;font:400 11px/1.5 inherit;color:#4e5969;',
    '  font-variant-numeric:tabular-nums;white-space:nowrap;overflow:hidden}',
    '.pc-meta span{flex:none;overflow:hidden;text-overflow:ellipsis}',
    '.pc-meta .r{text-align:right;margin-left:auto}',
    '.pc-ft{display:flex;gap:8px;margin-top:10px}',
    '.pc-ft button{height:27px;padding:0 12px;border-radius:6px;border:1px solid rgba(255,255,255,.42);',
    '  background:rgba(255,255,255,.10);color:#fff;font:500 11.5px/1 inherit;cursor:pointer;',
    '  transition:background .15s,border-color .15s,transform .08s}',
    '.pc-ft button:hover{background:rgba(255,255,255,.20);border-color:rgba(255,255,255,.72)}',
    '.pc-ft button:active{transform:translateY(1px)}',
    /* 取消的二次确认态（2026-10-18 用户定：取消要加确认键）：
       按下第一次变红并改文案，4 秒内再按才真取消；红底一眼能认出「这一步会停」。 */
    '.pc-ft button.danger{background:#f53f3f;border-color:#f53f3f;color:#fff;font-weight:600}',
    '.pc-ft button.danger:hover{background:#e02e2e;border-color:#e02e2e;color:#fff}',
    '.pc-ft button.pri{background:#fff;border-color:#fff;color:#165dff;font-weight:600}',
    '.pc-ft button.pri:hover{background:#eaf1ff;border-color:#eaf1ff;color:#0e35a0}',
    '.pc-ft button:disabled{opacity:.5;cursor:default}',
    '.pc.done .pc-pct{color:#b9f5c4}',
    '.pc.warn .pc-pct{color:#ffd08a}',
    '.pc.warn .pc-fl{background:linear-gradient(90deg,#ffb65c,#ff7d00)}',
    '.pc.bad .pc-pct{color:#ffb4ad}',
    '.pc.bad .pc-fl{background:linear-gradient(90deg,#ff8a80,#f53f3f)}',
    /* 按钮「详情已展开」态：告诉用户再点一下能收起（开关式，不写成两种按钮） */
    '.btn.busy.open{box-shadow:0 0 0 3px rgba(255,255,255,.42),0 4px 14px rgba(22,93,255,.42)}',

    /* 轻提示：三段式「来源 ｜ 值 ｜ 结果数」，与中控台消息条同一套口径 */
    '.toast{position:absolute;top:32px;right:0;z-index:2147483002;width:302px;',
    '  display:flex;align-items:baseline;gap:7px;padding:8px 11px;border-radius:6px;',
    '  background:rgba(31,35,41,.95);color:#fff;',
    '  font:400 12px/1.55 -apple-system,"Segoe UI","Microsoft YaHei",sans-serif;',
    '  box-shadow:0 4px 16px rgba(0,0,0,.28)}',
    '.toast[hidden]{display:none}',
    '.toast .src{flex:none;color:#86909c;font-size:11px}',
    '.toast .sep{flex:none;color:#4a5058}',
    '.toast .val{flex:1;min-width:0}',
    '.toast .cnt{flex:none;color:#86909c;font-size:11px;font-variant-numeric:tabular-nums}',
    '.toast.bad .val{color:#ffb4a8}',
    '.toast.warn .val{color:#ffd599}',

    /* 跳转按钮那一页也要能出声（开关回声是工程第 21 条的硬要求）。
       复用 .toast 的全套排版与三段式样式，只换位置与宽度：
       按钮浮在画面右上角，所以提示壳也右对齐、挂在按钮下方，往左展开
       —— 若用 left 对齐，宽提示条会朝右伸出画面外。 */
    '.toast.in-link{right:0;left:auto;top:36px;width:auto;max-width:302px;',
    '  white-space:nowrap;z-index:7}',

    /* ---- 跳转按钮（直播大屏专用，浮在画面右上角）----
       定位方式见「一之四」的长注释：fixed 层 + 按 video 矩形重算，
       不插进页面流 —— 这一页的播放器容器很可能是 flex / grid，
       插块级元素会把右侧面板和下方指标卡挤位。
       阴影是为了「浮在画面上」有层次，不影响点击区域（shrink 到内容宽）。 */
    '.lnk{position:relative;display:inline-flex;align-items:center;gap:6px;',
    '  height:28px;padding:0 13px;border-radius:6px;',
    '  background:#165dff;color:#fff;text-decoration:none;cursor:pointer;',
    '  font:600 12.5px/1 -apple-system,"Segoe UI","Microsoft YaHei",sans-serif;',
    '  letter-spacing:0;border:1px solid #165dff;user-select:none;',
    '  box-shadow:0 2px 10px rgba(0,0,0,.38)}',
    '.lnk:hover{background:#0e42d2;border-color:#0e42d2}',
    '.lnk svg{width:12px;height:12px;flex:none}',
    /* 提示条挂在按钮**下方**、右边缘对齐：按钮在画面右上角，
       朝上或朝右展开都会跑出画面；朝下朝左才是空的画布。 */
    '.tip{position:absolute;right:0;top:34px;z-index:6;width:252px;',
    '  padding:8px 10px;border-radius:6px;background:#1f2329;color:#fff;',
    '  font:400 12px/1.65 -apple-system,"Segoe UI","Microsoft YaHei",sans-serif;',
    '  box-shadow:0 4px 16px rgba(0,0,0,.28);opacity:0;visibility:hidden;',
    '  transition:opacity .15s;pointer-events:none}',
    '.lnk:hover .tip,.lnk:focus .tip{opacity:1;visibility:visible}'
  ].join('\n');

  var ICON = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" '
    + 'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
    + '<path d="M8 2v8"/><path d="M4.5 7 8 10.5 11.5 7"/><path d="M2.5 13h11"/></svg>';

  /* 跳转图标：方框 + 右上箭头（「外链」的通用形状，不依赖字体） */
  var ICON_LINK = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" '
    + 'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
    + '<path d="M9.5 2.5H13.5V6.5"/><path d="M13.5 2.5 7.5 8.5"/>'
    + '<path d="M12 9.5v3a1 1 0 0 1-1 1H3.5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h3"/></svg>';

  var ui = {
    host: null,
    root: null,
    btn: null,
    card: null,
    prog: null,          // 下载详情卡本体（在按钮同一个 shadow 里，2026-10-18 整合）
    toast: null,
    toastCls: 'toast',    // 提示壳的两套位置（下载页 / 跳转页），见 say()
    link: null,           // 跳转按钮（<a>）
    linkHost: null,       // 跳转按钮的 fixed 外壳
    onDownload: null,     // 按钮回调（由主流程设置）
    onAbort: null
  };

  /* ==========================================================
   * 一、找播放器
   *
   * 两个界面（下载按钮 / 跳转按钮）都贴在**播放器外面的右上角**，
   * 所以只需要一样东西：画面本身的矩形。
   * 找法见下面的 findMainVideo 与 computeOuterPos。
   * ========================================================== */

  function isVisible(el) {
    if (!el) return false;
    var r = el.getBoundingClientRect();
    return r.width > 200 && r.height > 120;
  }

  function findVideos() {
    var vs = document.querySelectorAll('video');
    var out = [];
    for (var i = 0; i < vs.length; i++) {
      if (isVisible(vs[i])) out.push(vs[i]);
    }
    return out;
  }

  /* ==========================================================
   * 二、建界面
   * ========================================================== */

  function build() {
    var old = document.getElementById(HOST_ID);
    if (old) old.remove();

    // ⚠️ 按钮态的幂等缓存必须随重建一起失效 —— 这是「幂等早退第三种失效形态」：
    // 判据本身没变，但它描述的 DOM 已经不是眼前这份了。切页 / 换场次时平台会
    // 把按钮壳拆掉、tick 重建，若缓存还留着「busy|下载中」，setBtn 会拒绝给
    // 新按钮写状态 ⇒ 新按钮顶着「下载回放」的字样、内部却是运行中，
    // 点它走详情开关分支（toggleProgress）—— 正是用户 2026-10-21 反馈
    // 「切到顶栏其他分页，回来按钮点不开、不知道有没有在运行」的根因之一。
    lastBtnState = '';

    var host = document.createElement('div');
    host.id = HOST_ID;
    // host 自身不吃事件；里面的按钮自己吃。
    // 尺寸 = 按钮的尺寸（width/height 都是 auto，由 .btn 撑开）：
    //   卡片 / 进度条 / 提示条都用 right:0 相对它定位，才能和按钮右边缘对齐。
    // position:fixed + left/top 由 positionHost 每次重算（播放器外面右上角）。
    host.style.cssText = 'all:initial;position:fixed;left:0;top:0;'
      + 'display:block;width:auto;height:auto;pointer-events:none;z-index:2147483000';

    var root = host.attachShadow({ mode: 'open' });
    var style = document.createElement('style');
    style.textContent = CSS;
    root.appendChild(style);

    var btn = document.createElement('div');
    btn.className = 'btn';
    btn.innerHTML = ICON + '<span>下载回放</span>';
    btn.style.pointerEvents = 'auto';
    root.appendChild(btn);

    var card = document.createElement('div');
    card.className = 'card';
    card.hidden = true;
    card.style.pointerEvents = 'auto';
    root.appendChild(card);

    // 下载详情卡不在这里建：它按需创建（ensureProgCard），但挂在**同一个 root** 里，
    // 所以位置、层级、生命周期都跟按钮一致（2026-10-18 整合进按钮后）。

    var toast = document.createElement('div');
    toast.className = 'toast';
    toast.hidden = true;
    root.appendChild(toast);

    ui.host = host;
    ui.root = root;
    ui.btn = btn;
    ui.card = card;
    ui.toast = toast;
    return host;
  }

  /**
   * 挂下载按钮。
   *
   * 挂到 body + fixed，坐标按播放器矩形算（见 positionHost）。
   * ⚠️ 不再 append 进播放器父容器：那条路在「回放尚未开始播放」时
   *    父容器尺寸为 0 或 overflow:hidden，按钮会直接看不见 —— 这正是
   *    用户 2026-10-18 反馈「直播服务平台没有下载按钮」的根因之一。
   */
  function mount() {
    if (ui.host && document.contains(ui.host)) { positionHost(); return true; }
    // document_start 时 body 还没解析出来 —— 没有 body 就先不挂，
    // 由调用方的补挂定时器稍后再试。直接 appendChild 会抛 NotFoundError。
    if (!document.body) return false;
    var host = build();
    document.body.appendChild(host);
    positionHost();
    acquireLayout();
    return true;
  }

  function unmount() {
    if (ui.host && ui.host.parentNode) ui.host.parentNode.removeChild(ui.host);
    ui.host = ui.root = ui.btn = ui.card = null;
    // 详情卡跟着按钮一起走（同一个 shadow），这里只清引用与定时器
    clearProgTimers();
    ui.prog = null;
    releaseLayout();
    // toast 长在同一个 shadow 里，一并清空 —— 否则 say() 会往脱离文档的元素里写
    if (ui.toastCls !== 'toast in-link') {
      clearTimeout(toastTimer);
      ui.toast = null;
    }
  }

  /* ==========================================================
   * 一之三、找「画面本身」——两个按钮都贴在它外面的右上角
   *
   * 只取 <video> 元素的矩形，**不往上爬容器**。
   *   往上爬到的容器往往还包着顶部标题条与底部控制条，用它算「外沿」
   *   会把按钮推到标题条上面去，看着像乱飘。
   *   ⇒ 直接量 video 自己的 rect（含黑边也无妨，黑边也是画面的一部分）。
   *
   * 找不到 video 连外壳都没有时返回 null，由调用方退到「视口右上角」——
   * 按钮必须一直看得见，用户才能不点播放就先唤起下载。
   * ========================================================== */

  /**
   * 找「播放器」这个盒子的锚点。
   *
   * 三档，依次退：
   *   ① 有尺寸的 <video> 本身（画面最准）
   *   ② 没有可用 video，但 <video> 元素已存在且父容器有尺寸
   *      —— 这就是「播放器外壳已渲染、视频还没加载」的常见形态：
   *         壳子里只有封面图和播放按钮，video 自身 0×0。
   *         用外壳当锚点，按钮仍能贴在播放器右上角，而不是漂到屏幕角落。
   *   ③ 连壳子都没有 → null，由调用方退到视口右上角
   */
  function findMainVideo() {
    var vs = findVideos();
    if (vs.length) {
      var best = null, area = 0;
      for (var i = 0; i < vs.length; i++) {
        var r = vs[i].getBoundingClientRect();
        var a = r.width * r.height;
        if (a > area) { area = a; best = vs[i]; }
      }
      return best;
    }

    // ② 退到「装了 video 的最大容器」
    var all = document.querySelectorAll('video');
    var shell = null, shellArea = 0;
    for (var j = 0; j < all.length; j++) {
      var p = all[j].parentElement;
      if (!p) continue;
      var pr = p.getBoundingClientRect();
      if (pr.width < 200 || pr.height < 120) continue;
      var pa = pr.width * pr.height;
      if (pa > shellArea) { shellArea = pa; shell = p; }
    }
    return shell;
  }

  /* ==========================================================
   * 一之四、跳转按钮（直播大屏专用，浮在画面右上角）
   *
   * 【为什么用 fixed + 每次按视频矩形重算，而不是插进页面流里】
   *   这是这一页最危险的一处改动：播放器所在容器极可能是 flex / grid，
   *   往里插一个块级元素会把右侧面板或下方指标卡挤位、整块布局塌掉。
   *   我们只是「在画面上浮一枚按钮」，不该改变页面排版。
   *   ⇒ 用一个独立的 fixed 层，坐标跟着 video 矩形的**右上角**算：
   *     滚动 / 缩放就重算，画面在视口里露出太少就整个藏起来。
   *
   * 【全屏怎么办】
   *   全屏时浏览器只渲染全屏元素及其后代，挂在 body 上的 fixed 层会看不见。
   *   所以 positionLink 每次都会检查：不在当前全屏元素里就把外壳搬进去。
   *
   * 【为什么用 <a target="_blank">而不是 window.open】
   *   原生链接点击在内容脚本里同样走用户手势链路，不会被拦；也不需要
   *   额外权限。window.open 在某些内核下会被当成弹窗拦掉。
   * ========================================================== */

  var LINK_HOST_ID = 'dyc-replay-link-host';
  var linkTimer = null;
  var LINK_PAD = 10;      // 距画面右上角的内缩（px，固定值，不随页面缩放）

  function buildLinkHost(opts) {
    var host = document.createElement('div');
    host.id = LINK_HOST_ID;
    host.style.cssText = 'all:initial;position:fixed;z-index:2147482999;'
      + 'left:0;top:0;pointer-events:none';

    var root = host.attachShadow({ mode: 'open' });
    var style = document.createElement('style');
    style.textContent = CSS;
    root.appendChild(style);

    var a = document.createElement('a');
    a.className = 'lnk';
    a.href = opts.href;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.style.pointerEvents = 'auto';
    a.innerHTML = ICON_LINK + '<span>' + esc(opts.text) + '</span>'
      + '<span class="tip">' + esc(opts.tip) + '</span>';

    // 这一页没有下载那份界面，开关回声得有自己的落点（第 21 条：
    // 每个开关都要有带 source 的三段式回声），复用 .toast 的排版，只换定位。
    var toast = document.createElement('div');
    toast.className = 'toast in-link';
    toast.hidden = true;
    root.appendChild(toast);
    ui.toast = toast;
    ui.toastCls = 'toast in-link';

    root.appendChild(a);
    ui.linkHost = host;
    ui.link = a;
    return host;
  }

  /**
   * 算按钮坐标（纯函数，便于离线自测）。
   *
   * 【放在「播放器外面」的角上】—— 2026-10-18 用户拍定：
   *   · 下载回放（回放页）→ **左上角**
   *   · 跳转直播服务平台（大屏页）→ **右上角**
   *   两者的共同点：不能压在画面上。所以按「外侧」优先，逐级退让。
   *
   * @param {{top:number,right:number,bottom:number,left:number}} vr 播放器矩形
   * @param {{w:number,h:number}} vp   视口尺寸
   * @param {{w:number,h:number}} size 按钮尺寸
   * @param {number} [pad]             外侧间距
   * @param {'right'|'left'} [side]    贴哪一侧的角，缺省 right
   * @returns {{left:number,top:number,where:string}|null} null = 画面露出太少
   */
  function computeOuterPos(vr, vp, size, pad, side) {
    var P = typeof pad === 'number' ? pad : 10;
    var M = 8;   // 距视口边缘的最小间距

    var vTop = Math.max(vr.top, 0);
    var vBottom = Math.min(vr.bottom, vp.h);
    var vRight = Math.min(vr.right, vp.w);
    var vLeft = Math.max(vr.left, 0);

    // 只算「露在视口里的那一块」：画面滚出视口或只剩一条边时不留按钮
    if (vBottom - vTop < 56 || vRight - vLeft < 160) return null;

    function clampTop(t) { return Math.max(M, Math.min(t, vp.h - size.h - M)); }
    function clampLeft(l) { return Math.max(M, Math.min(l, vp.w - size.w - M)); }

    if (side === 'left') {
      // ① 播放器左边外面（纵向与画面顶部对齐）
      if (vLeft - P - size.w >= M) {
        return { left: Math.round(vLeft - P - size.w), top: Math.round(clampTop(vTop)), where: 'left' };
      }
      // ② 左侧放不下 → 播放器上方外面，左边缘对齐
      if (vTop - P - size.h >= M) {
        return { left: Math.round(clampLeft(vLeft)), top: Math.round(vTop - P - size.h), where: 'top' };
      }
      // ③ 没外侧空间：贴画面内部左上角
      return { left: Math.round(clampLeft(vLeft + P)), top: Math.round(clampTop(vTop + P)), where: 'inside' };
    }

    // ① 播放器右边外面
    if (vRight + P + size.w <= vp.w - M) {
      return { left: Math.round(vRight + P), top: Math.round(clampTop(vTop)), where: 'right' };
    }
    // ② 播放器上方外面
    if (vTop - P - size.h >= M) {
      return { left: Math.round(clampLeft(vRight - size.w)), top: Math.round(vTop - P - size.h), where: 'top' };
    }
    // ③ 实在没外侧空间：贴画面内部右上角
    return { left: Math.round(clampLeft(vRight - size.w - P)), top: Math.round(clampTop(vTop + P)), where: 'inside' };
  }

  /**
   * 找不到播放器时的兜底落点：视口左上 / 右上角（让开平台顶栏）。
   *
   * 【为什么必须兜底，而不是把按钮藏起来】
   *   用户 2026-10-18 反复强调：**不点开播放器就要能看到按钮**。
   *   两页的播放器都是懒渲染的 —— 没点播放时 video 可能还不存在或尺寸为 0，
   *   这时若藏起来，用户会以为「功能没装」，根本没机会去点。
   *   摆在固定位置虽然不贴着播放器，但一直可见、可点。
   *
   * @param {{w:number,h:number}} size 按钮尺寸
   * @param {'left'|'right'} [side]    缺省 right
   */
  function fallbackPos(size, side) {
    return {
      left: side === 'left'
        ? 16
        : Math.max(8, window.innerWidth - size.w - 16),
      top: 72
    };
  }

  /**
   * 下载按钮的定位：按播放器矩形算，找不到播放器就贴视口右上角。
   */
  function positionHost() {
    if (!ui.host) return;
    var size = {
      w: (ui.btn && ui.btn.offsetWidth) || 92,
      h: (ui.btn && ui.btn.offsetHeight) || 26
    };
    var vp = { w: window.innerWidth, h: window.innerHeight };
    var v = findMainVideo();
    var pos = null;

    ui.host.style.display = '';
    if (v) pos = computeOuterPos(v.getBoundingClientRect(), vp, size, LINK_PAD, 'right');
    // 找不到画面 / 画面滚出视口：退到视口兜底位，按钮必须一直能点
    if (!pos) pos = fallbackPos(size, 'right');

    ui.host.style.left = pos.left + 'px';
    ui.host.style.top = pos.top + 'px';

    // 宿主挪了，开着的确认卡 / 提示条也跟着挪（否则会停在上一次的位置）
    placePops();
  }

  /* ---------- 布局跟随（两个界面共用一套监听，用引用计数管）---------- */

  var layoutRefs = 0;
  var layoutTimer = 0;

  function relayoutAll() {
    if (layoutTimer) return;
    layoutTimer = requestAnimationFrame(function () {
      layoutTimer = 0;
      positionHost();
      positionLink();
    });
  }

  function acquireLayout() {
    if (layoutRefs++ > 0) return;
    window.addEventListener('scroll', relayoutAll, true);   // 捕获：内部滚动容器也算
    window.addEventListener('resize', relayoutAll);
  }

  function releaseLayout() {
    if (--layoutRefs > 0) return;
    layoutRefs = 0;
    window.removeEventListener('scroll', relayoutAll, true);
    window.removeEventListener('resize', relayoutAll);
    if (layoutTimer) { cancelAnimationFrame(layoutTimer); layoutTimer = 0; }
  }

  /** 按「播放器外面右上角」重新定位；画面露出太少就藏起来 */
  function positionLink() {
    if (!ui.linkHost) return;

    // 全屏层跟着搬：否则全屏时按钮被挡在全屏元素之外，看不见也点不到
    var fs = document.fullscreenElement || document.webkitFullscreenElement;
    if (fs && fs.tagName === 'VIDEO') fs = fs.parentElement;
    var want = fs || document.body;
    if (want && ui.linkHost.parentNode !== want) {
      try { want.appendChild(ui.linkHost); } catch (e) { /* 个别站点不允许，保持原位 */ }
    }

    var v = findMainVideo();
    if (!v) {
      // 播放器还没渲染出来（没点播放）—— 按钮照样要看得见，
      // 用户明确要求「不点开播放器就可以看到」，见 fallbackPos 的注释。
      var fb = fallbackPos({ w: (ui.link && ui.link.offsetWidth) || 132,
                             h: (ui.link && ui.link.offsetHeight) || 28 });
      ui.linkHost.style.display = '';
      ui.linkHost.style.left = fb.left + 'px';
      ui.linkHost.style.top = fb.top + 'px';
      return;
    }

    ui.linkHost.style.display = '';
    // 先显示再量，否则 display:none 时 offsetWidth 是 0
    var size = { w: (ui.link && ui.link.offsetWidth) || 132,
                 h: (ui.link && ui.link.offsetHeight) || 28 };
    var pos = computeOuterPos(v.getBoundingClientRect(),
      { w: window.innerWidth, h: window.innerHeight }, size, LINK_PAD, 'right');

    if (!pos) {
      // 播放器滚出视口：同样退到视口右上角，别让按钮凭空消失
      var fb2 = fallbackPos(size);
      ui.linkHost.style.left = fb2.left + 'px';
      ui.linkHost.style.top = fb2.top + 'px';
      return;
    }
    ui.linkHost.style.left = pos.left + 'px';
    ui.linkHost.style.top = pos.top + 'px';
  }

  /**
   * 挂跳转按钮。
   *
   * ⚠️ 三处都要幂等，否则长时间开着页面会累积：
   *   · 已挂上 → 直接重定位返回（不重建 DOM）；
   *   · 布局监听 —— 用引用计数，重复 acquire 不会叠；
   *   · 定时器 —— 先清再设。
   *
   * @param {{href:string, text:string, tip:string}} opts
   */
  function mountLink(opts) {
    if (ui.linkHost && document.contains(ui.linkHost)) { positionLink(); return true; }
    if (!document.body) return false;

    if (linkTimer) { clearInterval(linkTimer); linkTimer = null; }

    buildLinkHost(opts);
    document.body.appendChild(ui.linkHost);
    positionLink();
    acquireLayout();

    // 页面是 SPA，播放器大小可能变（切分辨率 / 进全屏），低频补一次位置
    linkTimer = setInterval(positionLink, 1500);
    return true;
  }

  function unmountLink() {
    if (linkTimer) { clearInterval(linkTimer); linkTimer = null; }
    if (ui.linkHost && ui.linkHost.parentNode) ui.linkHost.parentNode.removeChild(ui.linkHost);
    releaseLayout();
    ui.linkHost = ui.link = null;
    // 提示壳长在跳转按钮的 shadow 里，按钮没了它也就没了 —— 槽位要一起清空，
    // 否则下次 say() 会往一个已经脱离文档的元素里写。
    if (ui.toastCls === 'toast in-link') {
      clearTimeout(toastTimer);
      ui.toast = null;
      ui.toastCls = 'toast';
    }
  }

  function linkAlive() {
    return !!(ui.linkHost && document.contains(ui.linkHost));
  }

  /* ==========================================================
   * 三、按钮状态
   * ========================================================== */

  var lastBtnState = '';

  /**
   * @param {'idle'|'busy'|'dead'} state
   * @param {string} [text]
   */
  function setBtn(state, text) {
    if (!ui.btn) return;
    var label = text || '下载回放';
    var key = state + '|' + label;
    if (key === lastBtnState) return;
    lastBtnState = key;
    ui.btn.className = 'btn' + (state === 'busy' ? ' busy' : state === 'dead' ? ' dead' : '');
    ui.btn.innerHTML = ICON + '<span>' + label + '</span>';
  }

  function onBtnClick(fn) {
    if (!ui.btn) return;
    // 用 onclick 而非 addEventListener：重复 mount 时不会叠加监听
    ui.btn.onclick = function (ev) {
      ev.preventDefault();
      ev.stopPropagation();
      fn(ev);
    };
  }

  /* ==========================================================
   * 四、确认卡
   *
   * 字段固定四项：场次时间 / 时长 / 体积 / 分片数，加一个可编辑的文件名。
   * 文件名默认值由主流程算好传进来（日期来自页面的开播时间，不是本机今天）。
   * ========================================================== */

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function fmtBytes(n) {
    if (!n) return '未知';
    var u = ['B', 'KB', 'MB', 'GB'];
    var i = 0;
    var v = n;
    while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
    return (v >= 100 ? v.toFixed(0) : v.toFixed(1)) + ' ' + u[i];
  }

  function fmtDur(sec) {
    if (!sec || !isFinite(sec)) return '未知';
    var s = Math.round(sec);
    var h = Math.floor(s / 3600);
    var m = Math.floor((s % 3600) / 60);
    var r = s % 60;
    if (h > 0) return h + ' 小时 ' + m + ' 分';
    if (m > 0) return m + ' 分 ' + r + ' 秒';
    return r + ' 秒';
  }

  /* ---------- 弹层落点（确认卡 / 轻提示）----------
   *
   * 为什么不能只靠 CSS 的 left/right：
   *   `.card` / `.toast` 早先写死 `right:0`（右缘对齐按钮右缘、朝左展开），
   *   那是按钮在播放器**右上角**时的排版。中途按钮曾挪到左上角，卡片就整块
   *   朝屏幕左外长出去，只剩右半截露在窗外 —— 用户 2026-10-18 截图的
   *   「我看不到对话框」就是这个：卡片弹了，但弹到窗外去了。
   *   按钮现已改回右上角，但**落点不再依赖按钮在哪个角**：
   *
   * 现在按**实测矩形**挑方向，两页（回放 / 大屏）与所有落点（播放器侧外、
   * 上方外、视口兜底）都同一套判断：
   *   横向 —— 默认右缘对齐、朝左展开（按钮在右上角时最自然）；
   *           左边放不下就翻成左对齐、朝右展开；
   *   纵向 —— 默认在按钮下方；下方放不下就翻到上方。
   *
   * 用 left/top 而不是 transform：shadow 内 fixed 宿主已被页面 transform
   * 劫过一次，这里只改定位属性，最不容易再生变。
   */
  var POP_W = 302;        // .card / .toast 的固定宽度（与 CSS 一致）
  var POP_OFF = 38;       // 与按钮的间距：按钮高 32 + 6
  var POP_GAP = 8;        // 与视口边缘的安全距离

  function placePop(el, width, hostRect) {
    if (!el || el.hidden) return;
    // hostRect 只为离线自测保留：真实运行时一律现量宿主
    if (!hostRect && !ui.host) return;
    var r = hostRect || ui.host.getBoundingClientRect();
    var vw = window.innerWidth || document.documentElement.clientWidth || 0;
    var vh = window.innerHeight || document.documentElement.clientHeight || 0;
    if (!vw || !vh) return;

    var w = width || POP_W;
    el.style.maxWidth = '';   // 上一次若因窄窗收窄过，这里先复原再重判

    // 横向：优先「右缘对齐按钮右缘、朝左展开」——
    // 按钮在播放器右上角（现行位置），朝左展开正好压在画面右侧，
    // 卡片始终挂在按钮正下方，视觉上连成一体；
    // 左边放不下（按钮已贴到屏幕左侧）才翻成左对齐朝右展开。
    if (r.right - w - POP_GAP >= 0) {
      el.style.left = 'auto';
      el.style.right = '0px';
    } else if (r.left + w + POP_GAP <= vw) {
      el.style.left = '0px';
      el.style.right = 'auto';
    } else {
      // 两边都放不下（窄窗）：贴左边并收窄，绝不溢出屏幕
      el.style.left = '0px';
      el.style.right = 'auto';
      el.style.maxWidth = Math.max(200, vw - POP_GAP * 2) + 'px';
    }

    // 纵向：先按「下方」试，放不下且上方够就翻上去
    var h = el.offsetHeight || 0;
    var above = false;
    if (r.bottom + POP_OFF + h > vh - POP_GAP && r.top - POP_OFF - h >= POP_GAP) {
      el.style.top = 'auto';
      el.style.bottom = POP_OFF + 'px';
      above = true;
    } else {
      el.style.top = POP_OFF + 'px';
      el.style.bottom = 'auto';
    }

    // 展开动效从「贴着按钮的那条边」长出来：朝下展开从顶边起、朝上翻从底边起；
    // 横向同理（右对齐从右边起）。不然卡片会像从半空里冒出来。
    el.style.transformOrigin = (above ? 'bottom' : 'top')
      + ' ' + (el.style.right === '0px' ? 'right' : 'left');
  }

  /** 弹层开着时，宿主挪了位置就跟着挪（滚动 / 缩放 / 换场次都会触发） */
  function placePops() {
    if (ui.card && !ui.card.hidden) placePop(ui.card, POP_W);
    if (ui.toast && !ui.toast.hidden) placePop(ui.toast, POP_W);
    if (ui.prog && !ui.prog.hidden) placePop(ui.prog, PROG_W);
  }

  /**
   * 清洗用户手改的文件名（纯函数，方便离线自测）。
   *
   * 用户 2026-10-18：「文件名不要加空格，你换成_这个字符连接」——
   * 空格在 Windows 里会让「复制为路径」多出一对引号，命令行/传输都要额外转义，
   * 所以**任何空白一律折成 `_`**，连续下划线也收成一个，尾巴上的点和下划线都削掉。
   * Windows 非法字符（`\ / : * ? " < > |`）直接删掉，不给保存对话框拒绝的机会。
   *
   * @param {string} s 原始输入
   * @returns {string} 可落盘的名字（可能为空串，调用方负责兜底）
   */
  function cleanFileName(s) {
    return String(s == null ? '' : s)
      .replace(/[\r\n\t]+/g, ' ')
      .trim()
      .replace(/[\\/:*?"<>|]/g, '')
      .replace(/\s+/g, '_')
      .replace(/_+/g, '_')
      .replace(/\.(mp4|ts)$/i, '')
      .replace(/[._]+$/, '');
  }

  /**
   * @param {object} info { timeText, durationSec, bytes, segCount, qualityText, fileName, warn }
   * @param {function} onGo (fileName) => void
   * @param {function} onCancel () => void
   */
  function showCard(info, onGo, onCancel) {
    if (!ui.card) return;
    var warn = '';
    if (info.warn) {
      warn = '<div class="warn' + (info.warnBad ? ' bad' : '') + '">' + esc(info.warn) + '</div>';
    }

    ui.card.innerHTML =
      '<div class="hd">下载这场直播回放</div>'
      + '<div class="bd">'
      /* 2026-10-19 用户取消账号名前缀后，这里**不再显示「账号」行**：
         它只服务于命名，名字不拼了就无需展示；而且抓错时显示一行错名字
         比不显示更容易误导（三次抓错都是这一行暴露的）。 */
      + '<div class="kv"><span class="k">场次</span><span class="v">' + esc(info.timeText || '未知') + '</span></div>'
      + '<div class="kv"><span class="k">时长</span><span class="v"><b>' + esc(fmtDur(info.durationSec)) + '</b></span></div>'
      + '<div class="kv"><span class="k">体积</span><span class="v"><b>' + (info.bytes ? '约 ' + esc(fmtBytes(info.bytes)) : '未知') + '</b>'
      + (info.segCount ? '（' + info.segCount + ' 段）' : '') + '</span></div>'
      + '<div class="kv"><span class="k">清晰度</span><span class="v">' + esc(info.qualityText || '默认最高') + '</span></div>'
      + (info.trackText
        ? '<div class="kv"><span class="k">编码</span><span class="v">' + esc(info.trackText) + '</span></div>'
        : '')
      + '<div class="nm"><input type="text" id="dyc-name" value="' + esc(info.fileName || '') + '">'
      + '<span class="ext">' + esc(info.ext || '.mp4') + '</span></div>'
      + warn
      + '</div>'
      + '<div class="ft">'
      + '<button type="button" data-act="cancel">取消</button>'
      + '<button type="button" class="go" data-act="go">开始下载</button>'
      + '</div>';

    ui.card.hidden = false;
    // 先显形再量：hidden 时 offsetHeight 为 0，量不出高度也就判不了「下方够不够」
    placePop(ui.card, POP_W);

    var input = ui.card.querySelector('#dyc-name');
    var goBtn = ui.card.querySelector('[data-act="go"]');
    var cancelBtn = ui.card.querySelector('[data-act="cancel"]');

    function readName() {
      // 清洗规则在 cleanFileName 里（纯函数，可离线自测）
      return cleanFileName(input.value) || info.fileName || '直播回放';
    }

    goBtn.onclick = function (ev) {
      ev.preventDefault();
      ev.stopPropagation();
      if (info.blocked) return;             // 覆盖率不足等硬故障：不给下
      hideCard();
      onGo(readName());
    };
    cancelBtn.onclick = function (ev) {
      ev.preventDefault();
      ev.stopPropagation();
      hideCard();
      if (onCancel) onCancel();
    };

    // 体积很大时补一句实话，让用户知道要等多久
    if (!info.warn && info.bytes > 3 * 1024 * 1024 * 1024) {
      // 3GB 以上：把提示挂在按钮上方，不覆盖原有信息
      var ft = ui.card.querySelector('.ft');
      var tip = document.createElement('div');
      tip.className = 'warn';
      tip.style.margin = '0 14px 10px';
      tip.textContent = '文件较大（' + fmtBytes(info.bytes) + '），下载期间请保持本页开着。';
      ft.parentNode.insertBefore(tip, ft);
    }
  }

  function hideCard() {
    if (ui.card) { ui.card.hidden = true; ui.card.innerHTML = ''; }
  }

  /* ==========================================================
   * 五、进度条
   * ========================================================== */

  var PROG_TITLE = '正在下载回放';
  var PROG_W = 344;       // 详情卡宽度（与 CSS 的 .pc 一致；300px 时 meta 文字会被挤断行）
  var PROG_ANIM_MS = 200; // 收纳动效时长（与 CSS transition 的 .22s 对齐，留一点余量）
  var ABORT_ARM_MS = 4000; // 「再点一次取消」的确认窗口（用户 2026-10-18：取消要加确认键）

  /**
   * 取消按钮的两段式判定（纯函数，便于离线自测）。
   *   第一次点（armedAt=0 或已超窗）→ 'arm'：只把按钮变红改文案，不动下载
   *   窗口内再点                        → 'fire'：真取消
   */
  function abortVerdict(armedAt, now) {
    return (armedAt && (now - armedAt) <= ABORT_ARM_MS) ? 'fire' : 'arm';
  }
  var progTimers = [];    // 淡出 / 隐藏的定时器，重开时要全部清掉

  /**
   * 下载详情卡：挂在**按钮同一个 shadow 宿主**里，从按钮下方展开。
   *
   * 2026-10-18 用户改口径（这一版取代 B1 的「独立钉在右下角」）：
   *   「下载框不要单独放到右下角，整合到这个【下载中】的这个蓝色按钮里面，
   *    最小化形式就是这个蓝色按钮，点开这个按钮就是下载详情框框」。
   *
   * 好处是**只有一处界面**：按钮显示「下载中 10%」，点它开/收详情，
   * 收起就是按钮本身 —— 不再有「按钮在左上、卡片在右下」的两地分居，
   * 也不会出现「卡片被关掉后不知道去哪找回来」。
   *
   * 位置用 placePop() 现算（与确认卡同一套）：横向右对齐朝左展开、
   * 下方放不下就翻上去，任何落点都不会出屏。
   */
  function ensureProgCard() {
    if (ui.prog && document.contains(ui.prog)) return ui.prog;
    if (!ui.host || !ui.root) return null;
    var pc = document.createElement('div');
    pc.className = 'pc';
    pc.hidden = true;
    pc.style.pointerEvents = 'auto';
    ui.root.appendChild(pc);
    ui.prog = pc;
    return pc;
  }

  function clearProgTimers() {
    for (var i = 0; i < progTimers.length; i++) clearTimeout(progTimers[i]);
    progTimers = [];
  }

  function later(fn, ms) {
    progTimers.push(setTimeout(fn, ms));
  }

  /** 按钮上的「详情已展开」提示（开关式：再点一下收起） */
  function markBtnOpen(on) {
    if (!ui.btn) return;
    // 只有「下载中」的按钮才是详情开关；下载结束按钮回到「下载回放」，
    // 这时不该再顶着「点一下收起」的提示（那会让人以为还能收）
    var busy = ui.btn.classList.contains('busy');
    if (on && busy) {
      ui.btn.classList.add('open');
      ui.btn.title = '点一下收起下载详情';
    } else {
      ui.btn.classList.remove('open');
      ui.btn.title = '';
    }
  }

  /** 下一帧（离线自测环境没有 rAF，退回 setTimeout：动效照播，只是时间不精确） */
  function nextFrame(fn) {
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(fn);
    else setTimeout(fn, 16);
  }

  /**
   * 展开详情卡（带动效）。
   *
   * 动效分两步，不能一步到位：同一个帧里「把 display 改回来」和「加 .in」会被浏览器
   * 合并成一次样式计算，transition 不触发 —— 卡片会硬闪出来。
   * 所以先让它以「收起态」（opacity:0 + translateY + scale）进入布局，下一帧再加 .in。
   */
  function openProg() {
    if (!ui.prog) return;
    clearProgTimers();                 // 关掉「淡出/自动隐藏」的旧定时器，免得刚开就被收走
    ui.prog.hidden = false;
    placePop(ui.prog, PROG_W);         // 先定落点：顺便把 transform-origin 设成贴按钮那条边
    nextFrame(function () {
      if (ui.prog && !ui.prog.hidden) ui.prog.classList.add('in');
    });
    markBtnOpen(true);
  }

  /** 收纳详情卡（动效播完再真正隐藏，否则过渡来不及） */
  function closeProg() {
    if (!ui.prog) return;
    clearProgTimers();
    ui.prog.classList.remove('in');
    markBtnOpen(false);
    later(function () { if (ui.prog) ui.prog.hidden = true; }, PROG_ANIM_MS);
  }

  /**
   * 开始（或重开）一次下载：清空旧状态、展开详情卡。
   * @param {string} [fileName] 显示在卡片第二行
   * @param {{silent?:boolean}} [opts] silent = 只重建内容不展开
   *        （按钮壳被平台拆掉重建时用：下载还在跑，但不能硬把卡弹出来打扰人；
   *         数据由下一次 onProgress 回填，点按钮 toggleProgress 照常能开）
   */
  function showProgress(fileName, opts) {
    if (!ensureProgCard()) return;
    clearProgTimers();
    lastRatio = 0;

    var pc = ui.prog;
    pc.className = 'pc';
    pc.innerHTML =
      '<div class="pc-top">'
      +   '<div class="pc-lab">'
      +     '<div class="pc-t1row"><span class="t1">' + PROG_TITLE + '</span>'
      +       '<span class="pc-badge" hidden></span></div>'
      +     '<div class="t2">' + esc(fileName || '') + '</div>'
      +   '</div>'
      +   '<div class="pc-pct">0<i>%</i></div>'
      + '</div>'
      /* 白色内衬：进度条 + 数值都在这块「纸面」上，与蓝色外壳形成蓝白层次 */
      + '<div class="pc-body">'
      +   '<div class="pc-tr"><div class="pc-fl"></div></div>'
      +   '<div class="pc-meta"><span class="l"></span><span class="r"></span></div>'
      + '</div>'
      + '<div class="pc-ft">'
      +   '<button type="button" data-act="fold">收起</button>'
      +   '<button type="button" data-act="abort">取消下载</button>'
      + '</div>';

    if (opts && opts.silent) {
      // 静默重建：保持收起态（hidden 未动），内容骨架已就位。
      // 顺手把按钮上的「详情已展开」提示摘掉 —— 卡没开，不该亮 open 态。
      markBtnOpen(false);
    } else {
      openProg();
    }
    // 「收起」= 收进那枚蓝色按钮（用户定的最小化形态就是按钮本身）
    var fold = pc.querySelector('[data-act="fold"]');
    fold.onclick = function (ev) {
      ev.preventDefault(); ev.stopPropagation();
      closeProg();
    };

    var ab = pc.querySelector('[data-act="abort"]');
    // 取消要二次确认（用户 2026-10-18 定）：误触一次就把已下的几百 MB 丢掉太疼。
    // 第一次点 ⇒ 变红 + 改文案为「再点一次取消」，ABORT_ARM_MS 内再点才真取消；
    // 超时自动复位，不做常驻红按钮（免得看着像「已经进入取消状态」）。
    var armedAt = 0;
    var resetTimer = 0;
    ab.onclick = function (ev) {
      ev.preventDefault(); ev.stopPropagation();
      var now = Date.now();
      if (abortVerdict(armedAt, now) !== 'fire') {
        armedAt = now;
        ab.textContent = '再点一次取消';
        ab.classList.add('danger');
        clearTimeout(resetTimer);
        resetTimer = setTimeout(function () {
          armedAt = 0;
          ab.textContent = '取消下载';
          ab.classList.remove('danger');
        }, ABORT_ARM_MS);
        return;
      }
      clearTimeout(resetTimer);
      armedAt = 0;
      ab.disabled = true;
      ab.textContent = '正在取消…';
      ab.classList.remove('danger');
      if (ui.onAbort) ui.onAbort();
    };
  }

  /**
   * 点按钮时开/收详情卡（下载进行中，按钮的职责从「开始下载」变成「详情开关」）。
   * 没有正在进行的下载时什么都不做 —— 那时按钮该去走下载流程。
   */
  function toggleProgress() {
    if (!ui.prog) return false;
    if (ui.prog.classList.contains('in')) closeProg();
    else openProg();               // 展开时 openProg 会顺带重算落点（滚动后位置可能已变）
    return true;
  }

  var lastRatio = 0;

  /**
   * @param {number} ratio 0~1
   * @param {string|{left?:string,right?:string}} [meta] 副行；字符串则整行放左侧
   */
  function setProgress(ratio, meta) {
    if (!ui.prog) return;
    var r = Math.max(0, Math.min(1, ratio || 0));
    // 只增不减：分片乱序完成 / 重试会让 ratio 回跳，数字往回走比慢更让人怀疑
    if (r < lastRatio) r = lastRatio;
    lastRatio = r;

    var pctNum = Math.floor(r * 100);
    var fl = ui.prog.querySelector('.pc-fl');
    var pct = ui.prog.querySelector('.pc-pct');
    var l = ui.prog.querySelector('.pc-meta .l');
    var rr = ui.prog.querySelector('.pc-meta .r');

    if (fl) fl.style.width = (r * 100).toFixed(1) + '%';
    if (pct) pct.innerHTML = pctNum + '<i>%</i>';

    if (meta && typeof meta === 'object') {
      if (l && meta.left != null) l.textContent = meta.left;
      if (rr && meta.right != null) rr.textContent = meta.right;
      // 并发档位徽标：有就亮，没升档就藏（不占位、不换行）
      var bd = ui.prog.querySelector('.pc-badge');
      if (bd && meta.badge != null) {
        bd.textContent = meta.badge;
        bd.hidden = !meta.badge;
      }
    } else if (meta != null) {
      if (l) l.textContent = meta;
      if (rr) rr.textContent = '';
    }

    // 按钮本身就是「最小化态」：百分比直接显示在按钮上
    if (ui.btn && ui.btn.classList && ui.btn.classList.contains('busy')) {
      var txt = ui.btn.querySelector('span');
      if (txt) txt.textContent = '下载中 ' + pctNum + '%';
    }
  }

  /**
   * 收尾：state = 'ok' | 'warn' | 'bad'
   *
   * 自动淡出：完成 5s / 取消 8s / 失败 12s（沿用 2026-10-18 B1 的节奏）。
   * 收在场里（详情卡被收起）也要展开给用户看 —— 下完了还藏着等于没通知。
   */
  function finishProgress(state, line1, line2) {
    if (!ui.prog) return;
    clearProgTimers();

    // 已经展开的就保持展开（别因为重设 className 把 .in 抹掉 —— 那会让收尾瞬间重播一次展开动效）
    var wasIn = ui.prog.classList.contains('in');
    ui.prog.className = 'pc' + (state === 'bad' ? ' bad' : state === 'warn' ? ' warn' : ' done')
      + (wasIn ? ' in' : '');
    openProg();                       // 收在场里也要展开给用户看（带动效），下完了藏着等于没通知

    var t1 = ui.prog.querySelector('.t1');
    var t2 = ui.prog.querySelector('.t2');
    var pct = ui.prog.querySelector('.pc-pct');
    var fl = ui.prog.querySelector('.pc-fl');
    var ft = ui.prog.querySelector('.pc-ft');

    if (t1) t1.textContent = line1 || '已保存';
    if (t2) t2.textContent = line2 || '';
    if (pct) pct.innerHTML = state === 'ok' ? '100<i>%</i>' : '—';
    if (state === 'ok' && fl) fl.style.width = '100%';

    if (ft) {
      ft.innerHTML = '<button type="button" class="pri" data-act="close">关闭</button>';
      var cl = ft.querySelector('[data-act="close"]');
      if (cl) cl.onclick = function (ev) {
        ev.preventDefault(); ev.stopPropagation(); hideProgress();
      };
    }

    later(function () {
      if (!ui.prog) return;
      ui.prog.classList.add('fade');
      later(function () { hideProgress(); }, 380);
    }, state === 'ok' ? 5000 : state === 'warn' ? 8000 : 12000);
  }

  function hideProgress() {
    clearProgTimers();
    if (ui.prog) {
      ui.prog.hidden = true;
      ui.prog.className = 'pc';
      ui.prog.innerHTML = '';
    }
    markBtnOpen(false);
    lastRatio = 0;
  }

  function isProgressShown() {
    return !!(ui.prog && ui.prog.classList.contains('in'));
  }

  /* ==========================================================
   * 六、提示：优先走消息盒子，盒子不可用才退回自渲染轻提示
   *
   * 演变（2026-10-18 C2）：
   *   早先这两个回放页没有消息盒子 —— style.css 里 #dyb-status-bar 那批规则
   *   当时住在中控台那份样式里，而回放页不带那份 CSS，调 setStatus 只会得到
   *   一条没有样式的裸文字。所以这里自备了一份最小实现。
   *
   *   现在样式拆成了 src/content/msgbox.css，dialog.js 也已注入回放两页与
   *   大屏页（manifest 条目 4 / 5），`setStatus` 全局可用 —— 于是提示统一交给
   *   消息盒子：左下角分层短暂显示 + 按类型进「消息盒子」历史（上限 100 条），
   *   用户事后能回看。**同一句话不再同时在按钮旁弹一遍**，避免两处重复。
   *
   *   本地轻提示保留为兜底：万一某页 dialog.js 没注入（例如后续新增页面
   *   漏配 manifest），提示仍然出得来，不会静默失败。
   *
   * 口径（工程第 21 条）：`来源(弱) ｜ 值(强) ｜ 结果数(弱)`，
   * 不许拼成一句纯文本；凡进盒子的消息都必须带 source。
   * ========================================================== */

  var toastTimer = null;

  /**
   * 显示一条提示。
   *
   * @param {string} text 值（强）
   * @param {'info'|'success'|'warning'|'error'} type
   * @param {object} [opts] { source, count, timeout, keepHistory, full }
   *        full = 进消息盒子的完整文案（条上仍用 text 的短版）
   *        keepHistory 缺省时按 dialog.js 的规则走：
   *        success / error / alert 收录进消息盒子，info / warning 不收录。
   */
  function say(text, type, opts) {
    opts = opts || {};
    type = type || 'info';

    // ---- 首选：消息盒子（dialog.js 的 setStatus）----
    // 它是跨脚本的全局函数；用 typeof 判定，缺失时不抛错。
    if (typeof setStatus === 'function') {
      var box = {
        source: opts.source || '',
        count: opts.count || '',
        timeout: opts.timeout || 3000
      };
      // 只有调用方明确要求时才覆盖默认收录规则（undefined 会被 dialog.js
      // 当作「没指定」，仍按类型判定）
      if (opts.keepHistory !== undefined) box.keepHistory = !!opts.keepHistory;
      // 条上放短文案、盒子里放完整原因（2026-10-19：用户报「报错提示词太长、
      // 盒子收纳不下」）—— 两个诉求一起解：条短、盒子能读全。
      if (opts.full) box.full = opts.full;
      try {
        setStatus(text, type, box);
        return;
      } catch (e) {
        /* 盒子异常时继续走下面的兜底 */
      }
    }

    // ---- 兜底：自渲染轻提示 ----
    if (!ui.toast) return;
    var cls = (ui.toastCls || 'toast') + (type === 'error' ? ' bad' : type === 'warning' ? ' warn' : '');
    ui.toast.className = cls;

    var html = '';
    if (opts.source) {
      html += '<span class="src">' + esc(opts.source) + '</span><span class="sep">｜</span>';
    }
    html += '<span class="val">' + esc(text) + '</span>';
    if (opts.count) html += '<span class="cnt">' + esc(opts.count) + '</span>';
    ui.toast.innerHTML = html;
    ui.toast.hidden = false;
    // 与确认卡同一套落点判断：按钮在左上角时朝右展开，不让提示条长出屏幕。
    // 大屏页那套（.toast.in-link）另有位置约定（贴跳转按钮下方、右对齐），不参与。
    if (ui.toastCls !== 'toast in-link') placePop(ui.toast, POP_W);

    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      if (ui.toast) ui.toast.hidden = true;
    }, opts.timeout || 4200);
  }

  function hideToast() {
    clearTimeout(toastTimer);
    if (ui.toast) ui.toast.hidden = true;
  }

  window.__DYC_REPLAY_UI__ = {
    mount: mount,
    unmount: unmount,
    mountLink: mountLink,
    unmountLink: unmountLink,
    linkAlive: linkAlive,
    setBtn: setBtn,
    onBtnClick: onBtnClick,
    showCard: showCard,
    hideCard: hideCard,
    showProgress: showProgress,
    toggleProgress: toggleProgress,       // 下载中点按钮 = 开/收详情（2026-10-18 整合进按钮）
    openProgress: openProg,               // 带动效展开（自测用）
    closeProgress: closeProg,             // 带动效收纳（自测用）
    PROG_W: PROG_W,
    PROG_ANIM_MS: PROG_ANIM_MS,
    setProgress: setProgress,
    finishProgress: finishProgress,
    hideProgress: hideProgress,
    isProgressShown: isProgressShown,
    positionHost: positionHost,
    mainVideo: findMainVideo,             // 供主流程复用（唤醒播放器时要用）
    computeOuterPos: computeOuterPos,     // 纯函数，离线自测用
    placePop: placePop,                   // 弹层落点，离线自测用（第三参数可直传宿主矩形）
    abortVerdict: abortVerdict,           // 取消两段式判定，离线自测用
    cleanFileName: cleanFileName,         // 文件名清洗（空白 → _），离线自测用
    ABORT_ARM_MS: ABORT_ARM_MS,
    say: say,
    hideToast: hideToast,
    fmtBytes: fmtBytes,
    fmtDur: fmtDur,
    esc: esc,
    setAbortHandler: function (fn) { ui.onAbort = fn; }
  };
})();
