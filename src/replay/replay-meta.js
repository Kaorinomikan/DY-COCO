/**
 * 直播回放下载 · 页面信息读取（本场时间 / 本场时长 / 文件名）
 * ============================================================
 * 【为什么单独一个文件】
 *   这三件事都是「从页面文本里抠信息」，与下载流程无关，但**错一个字就全错**：
 *   时间读错 → 文件名错；时长读错 → 「整场」校验的基准错（把半场当整场）。
 *   拆出来才好逐条写自测（`.tmp/verify-meta.js` 用真实页面文案跑），
 *   也免得这些正则混在 800 行的主流程里没人敢动。
 *
 * 【为什么扫 innerText 而不是按选择器找元素】
 *   两个页面的 class 都是哈希（抖店 aurora- / 罗盘各自一套前缀），
 *   选择器一改版就断；而「开播时间：2026-06-03 16:59:48」这串文案
 *   是产品语义，反而更稳。innerText 一次读取、多条正则复用，代价可忽略。
 *
 * 【已知的文案变体（2026-10-18 从真实页面截图与公开文档收集）】
 *   开播时间:2026-06-03 16:59:48      ← 冒号有全角/半角两种
 *   开播时间 2026-06-03 16:59
 *   直播时长:1小时3分钟49秒
 *   关播时间:2026-06-03 18:03:37      ← 只用来算时长兜底
 *   （OCR/手抄会出现「直时长」「关时间」这类缺字，故时长正则另留裸「时长」档）
 */
(function () {
  'use strict';

  if (window.__DYC_REPLAY_META__) return;

  var TEXT_TTL = 15000;      // innerText 缓存时长：页面会变，但不必每次重读
  var cache = { text: '', at: 0 };

  /** 取页面纯文本（带 15 秒缓存；重读是低频操作，不构成性能问题） */
  function pageText() {
    var now = Date.now();
    if (cache.text && now - cache.at < TEXT_TTL) return cache.text;
    var t = '';
    try {
      t = document.body ? (document.body.innerText || '') : '';
    } catch (e) { t = ''; }
    // 归一化：全角空格、不间断空格、零宽字符统统清掉，正则才好写
    t = t.replace(/[\u00a0\u3000\u200b]/g, ' ');
    cache.text = t;
    cache.at = now;
    return t;
  }

  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  /**
   * 从文本里解析开播时间。
   * @returns {{y,m,d,hh,mm}|null}
   */
  function parseSessionTime(text) {
    var t = String(text || '');
    var m = t.match(/开播时间\s*[：:]?\s*(\d{4})[-./](\d{1,2})[-./](\d{1,2})[\sT]*(\d{1,2})[:：](\d{2})/);
    if (m) {
      return { y: +m[1], m: +m[2], d: +m[3], hh: +m[4], mm: +m[5] };
    }
    // 只有日期：补 00:00（日期对、时分缺，比拿今天顶替要好）
    var m2 = t.match(/开播时间\s*[：:]?\s*(\d{4})[-./](\d{1,2})[-./](\d{1,2})/);
    if (m2) return { y: +m2[1], m: +m2[2], d: +m2[3], hh: 0, mm: 0 };
    return null;
  }

  /**
   * 从文本里解析本场时长（秒）。读不到返回 0。
   *
   * 三档，逐级兜底：
   *   ① 「直播时长:1小时3分钟49秒」—— 最准，主播页与大屏页都有；
   *   ② 「直播时长:57分钟15秒」少小时 —— 同一正则天然支持；
   *   ③ 开播 + 关播两个时间戳相减 —— 只在上面都失败时用。
   */
  function parseSessionDuration(text) {
    var t = String(text || '');

    // ① 中文时分秒。三段都可缺省，所以必须显式允许「只有秒」这种极端情形
    //    （不足 1 分钟的场次：文案就是「直播时长:45秒」。漏了这一段，
    //      短场次会掉到「开播/关播相减」甚至直接读不到）。
    var m = t.match(/(?:直播?时长|直?播?时长)\s*[：:]?\s*(?:(\d+)\s*小时)?(?:\s*(\d+)\s*分(?:钟)?)?(?:\s*(\d+)\s*秒)?/);
    if (m && (m[1] || m[2] || m[3])) {
      var sec = (+(m[1] || 0)) * 3600 + (+(m[2] || 0)) * 60 + (+(m[3] || 0));
      if (sec > 0) return sec;
    }

    // ③ 开播 / 关播相减（跨天也成立：用完整时间戳算毫秒差）
    var a = t.match(/开播时间\s*[：:]?\s*(\d{4})[-./](\d{1,2})[-./](\d{1,2})\s*(\d{1,2})[:：](\d{2})(?:[:：](\d{2}))?/);
    var b = t.match(/关播时间\s*[：:]?\s*(\d{4})[-./](\d{1,2})[-./](\d{1,2})\s*(\d{1,2})[:：](\d{2})(?:[:：](\d{2}))?/);
    if (a && b) {
      var t1 = new Date(+a[1], +a[2] - 1, +a[3], +a[4], +a[5], +(a[6] || 0)).getTime();
      var t2 = new Date(+b[1], +b[2] - 1, +b[3], +b[4], +b[5], +(b[6] || 0)).getTime();
      var d = Math.round((t2 - t1) / 1000);
      if (d > 0) return d;
    }

    return 0;
  }

  /* ==========================================================
   * 用户名（用于文件名前缀）
   *
   * 用户 2026-10-18：「直播回放的文件，命名方式前面再自动加上用户名」
   *   ⇒ `用户名_直播回放_2026.10.18_20点13分`（同日追加：整条文件名不留空格，用 `_` 连）
   *
   * 【难点：两个页面的账号名没有一个统一的选择器】
   *   主播页顶栏的昵称、罗盘大屏的店铺名，class 都是哈希（aurora-xxx / 各自一套），
   *   改版就断；页面结构也随屏幕宽度变形。所以这里**不赌单一写法**，
   *   按「可信度从高到低」排一串探针，谁先给出一个**像人名的字符串**就用谁：
   *
   *   ① 语义化的 DOM 线索：data-e2e / class 里带 nickname、user-name、account-name 的元素
   *   ② 带标签的页面文案：「主播昵称：xxx」「昵称：xxx」「账号：xxx」
   *   ③ 页面标题拆段：`小王的直播间 - 抖音直播服务平台` → `小王的直播间`
   *
   * 【为什么必须有「严格校验 + 空串兜底」】
   *   宁可名字里没有用户名（跟老版本一模一样），也绝不能把「下载」「首页」
   *   这种界面词当成账号名拼进文件名 —— 那种错误用户改都改不过来（一次下载几百 MB）。
   *   校验不通过就返回 ''，`fileNameFor` 自动不加前缀。
   * ========================================================== */

  var NAME_TTL = 30000;          // 账号名比时间更稳，缓存久一点（30 秒）
  var nameCache = { v: null, at: 0, from: '', tried: [], avatarCands: [] };

  // 界面词黑名单：这些都不可能是账号名（命中即丢弃）
  var NAME_STOP = {};
  ('首页|全部|更多|搜索|筛选|设置|帮助|消息|通知|登录|退出|返回|确定|取消|账号|昵称|用户|头像|图片|'
    + 'avatar|Avatar|photo|image|'
    + '客服|在线客服|公告|反馈|意见反馈|切换|切换账号|个人中心|我的|工作台|账户|商家中心|收银台|'
    + '退出登录|账号设置|全域推广|千川|新建|管理|'
    + '主播|商家|店铺|小店|达人|抖音|抖音电商|电商|罗盘|直播|回放|复盘|详情|数据|概览|看板|大屏|'
    + '下载|上传|分享|复制|关注|已关注|粉丝|作品|商品|订单|今天|昨天|本周|本月|近7天|近30天|'
    + '直播复盘|直播服务|直播服务平台|巨量百应|电商罗盘|直播大屏|'
    /* 2026-10-19：直播状态标签。用户这一场「账号名」被识别成「播前准备」——
       它是头像旁边的一块直播状态标签，长度、字符全部像人名，只有语义认得出来。
       状态词一律不是账号名，宁可退回不加前缀。 */
    + '播前准备|开播前准备|准备中|未开播|待开播|已开播|直播中|进行中|已结束|已关播|预告中|回放中|'
    + '暂无直播|无直播|'
    /* 2026-10-19：真名被空格判据误杀后，落点成了「我的观众」——
       这类「我的XX」是顶栏里的功能入口，不是账号名。 */
    + '我的观众|观众|粉丝团|粉丝群|观看人数|在线人数|实时在线|我的粉丝'
  ).split('|').forEach(function (w) { NAME_STOP[w] = 1; });

  /* 名字里允许出现的字符：中英文数字 + 少量连接符 + **空格**。
   *
   * ★ 2026-10-19 第四次抓错：真名是「SECRET CIRCLE 高奢女装」，中间有一个空格，
   *   被旧的「不允许空格」判据当成一句话直接丢掉 —— 于是日志里那份真名
   *   带着「（已排除）」躺在候选里，最后的落点是别的模块的「我的观众」。
   *   品牌型昵称（英文 + 中文、两个词）非常常见，空格必须允许。
   *   文件名的空格由 fileNameFor 统一换成 `_`（用户要求文件名零空格），
   *   两件事分开管，别在清洗这一步把名字改形。
   *   `·` 是抖音昵称常见的分隔符。
   */
  var NAME_OK = /^[\u4e00-\u9fa5A-Za-z0-9_\-·. ]+$/;

  /* 出现在候选里就说明它是**界面文案**（按钮名 / 说明句），不可能是账号名。
     用「包含」而不是「全等」判断 —— 用户 2026-10-18 第二次报错抓到的
     「互动指标查看观众分析」就是这类：它连一个标点都没有，长度也没超，
     精确黑名单完全挡不住，只能靠这些动作词。
     宁可判错成「没认出账号名」（文件名退回老格式），也不能把界面文案拼进文件名。 */
  var NAME_STOP_PART = [
    '查看', '点击', '分析', '指标', '统计', '详情', '更多', '设置', '管理', '切换',
    '退出', '登录', '注册', '开通', '了解', '立即', '前往', '报名', '上传', '分享',
    '复制', '关注', '进入', '筛选', '排序', '导出', '刷新', '返回', '确定', '取消',
    '关闭', '展开', '收起', '下载', '互动', '推广', '投放', '报表', '实时', '累计',
    '概况', '概览', '趋势', '环比', '同比', '排行', '榜单', '帮助中心', '客服中心',
    /* 2026-10-19：直播状态词的变体（「播前准备」已抓错一次）。
       「播前」几乎不可能出现在昵称里；「准备中」「未开播」「已关播」同理。 */
    '播前', '开播前', '准备中', '未开播', '待开播', '已开播', '直播中', '已结束', '已关播', '预告中'
  ];

  /**
   * 校验并清洗一个候选账号名。不合格返回 ''。
   * @param {string} s
   * @returns {string}
   */
  function cleanName(s) {
    var v = String(s || '')
      .replace(/[\u00a0\u3000\u200b]/g, ' ')
      .replace(/[\r\n\t]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (!v) return '';
    // 去掉括号之类的附属信息：「小王（已认证）」「小王(官方)」
    v = v.replace(/[（(][^）)]{0,12}[）)]\s*$/, '').trim();
    // 「小王的直播间」→「小王」；只剥这一种最常见的后缀
    v = v.replace(/(?:的)?直播间$/, '').trim();
    // 结尾的点/连字符/竖线是装饰，不是名字的一部分
    v = v.replace(/[·\-_.|]+$/, '').trim();
    if (!v || v.length > 20) return '';
    if (NAME_STOP[v]) return '';
    if (/^\d+$/.test(v)) return '';            // 纯数字多半是 ID / 房间号
    // 允许空格后补一条：词太多的多半是句子（「首页 播前准备 直播大屏 …」）
    if (v.split(' ').length > 4) return '';
    // 含界面动作词 ⇒ 是按钮名 / 说明句（「互动指标查看观众分析」这类）
    for (var i = 0; i < NAME_STOP_PART.length; i++) {
      if (v.indexOf(NAME_STOP_PART[i]) >= 0) return '';
    }
    if (!NAME_OK.test(v)) return '';           // 含冒号、括号、标点 ⇒ 是一句话不是名字
    // Windows 非法文件名字符（理论上 NAME_OK 已挡住，这里兜一层防以后放宽）
    if (/[\\/:*?"<>|]/.test(v)) return '';
    return v;
  }

  /** 探针①：语义化的 DOM 线索 */
  var NAME_SELECTORS = [
    '[data-e2e*="nickname" i]',
    '[data-e2e*="user-name" i]',
    '[data-e2e*="user_name" i]',
    '[data-e2e*="avatar" i]',
    '[class*="nickname" i]',
    '[class*="nick-name" i]',
    '[class*="userName" i]',
    '[class*="user-name" i]',
    '[class*="accountName" i]',
    '[class*="account-name" i]',
    '[class*="shopName" i]',
    '[class*="shop-name" i]',
    '[class*="avatar" i]'          // 头像容器的 alt 常常就是账号名
  ];

  /* 顶栏带：视口最上面这一条才算「页头」。
     昵称在右上角，表格 / 列表 / 商品卡里的字一律不是账号名 ——
     这是用户 2026-10-18 指出「前缀取错了」之后加的硬约束：
     光靠 class 名和文本长相分不出「商品信息」和真名，位置能分。 */
  var HEAD_BAND = 220;

  function rectOf(el) {
    try { return el.getBoundingClientRect ? el.getBoundingClientRect() : null; }
    catch (e) { return null; }
  }

  /**
   * 元素是否在顶栏带内。
   * @returns {boolean|null} true=在带内；false=测到了但在带外；null=测不到（未渲染）
   */
  function inHeadBand(el) {
    var r = rectOf(el);
    if (!r || (!r.width && !r.height)) return null;
    return r.top >= -4 && r.bottom <= HEAD_BAND + 80;
  }

  /**
   * 是不是「界面零件」：链接 / 按钮 / 菜单项 / 带 btn 类名的容器。
   * 昵称不会长在这些里面 —— 用户 2026-10-18 抓到的「互动指标查看观众分析」
   * 就是右上角的一个入口文案。
   *
   * ⚠️ 特意**不看 `cursor:pointer`**：抖音的昵称区域本身也可点（点头像进主页），
   *    按 cursor 判会把真名一起丢掉，得不偿失。
   */
  function isUiChrome(el) {
    try {
      if (el && el.closest) {
        var hit = el.closest('a,button,[role="button"],[role="link"],[role="menuitem"],[role="tab"]'
          + ',[class*="btn" i],[class*="button" i],[class*="menu-item" i],[class*="tab-item" i]');
        if (hit) return true;
      }
    } catch (e) { /* 老内核不认 :i 之类的写法就跳过这条判据 */ }
    return false;
  }

  /**
   * 收集容器内**全部**短文本（不是只取第一个）。
   *
   * 【为什么从「取第一个」改成「全收」】2026-10-19 用户第三次报抓错，
   * 日志写得很清楚：`账号名「播前准备」← 头像旁`。「播前准备」是头像旁边
   * 一块直播状态标签，它在 DOM 里排在昵称前面 —— 取第一个就必然撞上它。
   * 全收回来之后再按「位置」和「语义」两把尺子挑，才有得选。
   *
   * @returns {Array<{text:string, el:Element}>}
   */
  function textsIn(box, skip, depth, out) {
    var kids;
    try { kids = box && box.children; } catch (e) { return out; }
    if (!kids) return out;
    var d = depth || 0;
    for (var i = 0; i < kids.length && i < 20; i++) {
      var e = kids[i];
      if (e === skip) continue;
      if (skip && skip.contains && skip.contains(e)) continue;
      if (isUiChrome(e)) continue;
      if (!e.children || !e.children.length) {          // 叶子
        var raw = String(e.textContent || '').replace(/\s+/g, ' ').trim();
        if (!raw) continue;
        var t = cleanName(raw);
        if (t) {
          if (out.length < 10) out.push({ text: t, el: e });
        } else if (raw.length <= 24 && out.length < 10) {
          // 被 cleanName 拒掉的也留档（状态词 / 界面词）—— 取证时要能看到
          // 「本来有哪几个候选、为什么没用它」，否则诊断报告只会显示一片空
          out.push({ text: '', raw: raw, rejected: true, el: e });
        }
        continue;
      }
      if (d < 3) textsIn(e, skip, d + 1, out);
    }
    return out;
  }

  /**
   * 是不是「头像」形状。旧版判据（14~72px、top≤120、右半区）太松 ——
   * 顶栏 120px 内任何小图标都能中，用户这一场就是被一个非头像的小图带偏的。
   * 真头像的形态很稳定：**近方形、占顶栏第一行**。
   */
  function isAvatarLike(r, vw) {
    if (!r || !r.width || !r.height) return false;
    if (r.width < 16 || r.width > 64) return false;
    if (r.height < 16 || r.height > 64) return false;
    var ratio = r.width / r.height;
    if (ratio < 0.7 || ratio > 1.45) return false;   // 长条图标 / 横幅一律不算
    if (r.top < -2 || r.top > 64) return false;      // 真顶栏只有一行高
    if (r.left < vw * 0.55) return false;            // 右半区
    return true;
  }

  /**
   * 探针⓿-a：**头像旁边的名字**（用户 2026-10-18 补，2026-10-19 重写）。
   *
   * 判据从「容器里第一个短文本」升级成两层：
   *   ① **同一行、头像右侧 240px 内** —— 昵称的产品布局就是这样，
   *      状态标签 / 说明文字很少满足「与头像垂直居中对齐且在其右侧」；
   *   ② 退一步才用「容器里第一个非状态词」（状态词由 cleanName 挡掉）。
   *
   * 每次跑都把容器里的候选记进 `lastAvatarCands`，出报告时能直接看到
   * 「播前准备」和真名分别在哪个位置、是否同行 —— 下一次再错就不用猜了。
   *
   * @returns {string} 认不到返回 ''
   */
  var lastAvatarCands = [];

  function probeAvatarNear() {
    lastAvatarCands = [];
    var vw = 0;
    try { vw = window.innerWidth || 0; } catch (e0) { return ''; }
    if (!vw) return '';
    var list;
    try { list = document.querySelectorAll('img, [class*="avatar" i]'); }
    catch (e1) { return ''; }

    for (var i = 0; i < list.length && i < 40; i++) {
      var el = list[i];
      var r = rectOf(el);
      if (!isAvatarLike(r, vw)) continue;

      var midY = (r.top + r.bottom) / 2;
      var box = el;
      for (var d = 0; d < 3 && box.parentElement; d++) {
        box = box.parentElement;
        var cands = textsIn(box, el, 0, []);

        // 取证：这一层所有候选都记下来（含被排除的原因、是否同行 / 在右侧）
        for (var c = 0; c < cands.length; c++) {
          var cr = rectOf(cands[c].el);
          lastAvatarCands.push({
            layer: d + 1,
            text: cands[c].text || '',
            raw: cands[c].raw || '',
            rejected: !!cands[c].rejected,
            sameRow: !!(cr && Math.abs((cr.top + cr.height / 2) - midY) <= 14),
            right: !!(cr && cr.left >= r.right - 6)
          });
        }

        // ① 同一行 + 头像右侧：昵称的位置（被拒掉的候选不参与）
        for (var k = 0; k < cands.length; k++) {
          if (cands[k].rejected) continue;
          var rr = rectOf(cands[k].el);
          if (!rr) continue;
          if (Math.abs((rr.top + rr.height / 2) - midY) > 14) continue;
          if (rr.left < r.right - 6) continue;
          if (rr.left > r.right + 240) continue;
          return cands[k].text;
        }

        // ② 退一步：同容器里第一个合格的（状态词已被 cleanName 挡掉）
        for (var m = 0; m < cands.length; m++) {
          if (!cands[m].rejected) return cands[m].text;
        }
      }
    }
    return '';
  }

  /**
   * 探针⓿-b：**右上角的短文本**（用户 2026-10-18：「应该是右上角的昵称」）。
   *
   * 【为什么按坐标扫，而不是再加一条 class 选择器】
   *   两个页面的顶栏 class 都是哈希（aurora-xxx 之类），改版就断；
   *   而「昵称在右上角」是产品布局，位置比 class 稳。所以直接在视口右上
   *   打 12px 网格取点，用 elementFromPoint 命中当层元素，读它的短文本。
   *   命中的是叶子节点（`<span>小王</span>`）时 textContent 就是名字；
   *   命中的是容器（含「消息 帮助 小王」）时长度超限会被 cleanName 挡掉，
   *   不会把一串界面词当成名字。
   *
   * 【为什么按「命中格数」排序】
   *   右上角除了昵称还有消息、帮助、头像等图标，每个都是短文本。
   *   昵称的字最多、占的面积最大，网格命中的格数也最多 —— 按格数取最高，
   *   比「取最靠右」「取最靠上」都稳（那两个位置在不同页面会漂）。
   *
   * @returns {string} 认不准返回 ''
   */
  function probeCorner() {
    var vw = 0, vh = 0;
    try { vw = window.innerWidth || 0; vh = window.innerHeight || 0; } catch (e0) { return ''; }
    if (!vw || typeof document.elementFromPoint !== 'function') return '';

    var left = Math.round(vw * 0.55);            // 只扫右侧 45%
    var y1 = Math.min(170, vh);                  // 顶栏高度上限
    var hits = {}, order = [], best = '', bestN = 0;

    for (var y = 6; y <= y1; y += 12) {
      for (var x = left; x <= vw - 4; x += 12) {
        var el = null;
        try { el = document.elementFromPoint(x, y); } catch (e1) { el = null; }
        if (!el) continue;
        // 按钮 / 菜单项里的字是入口文案，不是昵称 —— 用户 2026-10-18 抓到的
        // 「互动指标查看观众分析」正是这类，必须在进候选前就剔掉
        if (isUiChrome(el)) continue;
        var t = cleanName(el.textContent);
        if (!t) continue;
        if (hits[t] == null) { hits[t] = 0; order.push(t); }
        hits[t]++;
      }
    }
    for (var i = 0; i < order.length; i++) {
      var k = order[i];
      // 至少命中 2 格才算「真的占了一块地方」，避免擦边命中的偶发文本
      if (hits[k] > bestN && hits[k] >= 2) { bestN = hits[k]; best = k; }
    }
    return best;
  }

  /** 探针②：语义化的 DOM 线索（顶栏里的优先，顶栏外的只作兜底） */
  function probeDom() {
    var loose = '';                 // 顶栏外 / 测不到渲染位置的候选，只留着保底
    for (var i = 0; i < NAME_SELECTORS.length; i++) {
      var list;
      try { list = document.querySelectorAll(NAME_SELECTORS[i]); } catch (e) { continue; }
      // 只嗅前 5 个：真名一定在页头，越往后越可能是列表里别人的名字
      for (var j = 0; j < list.length && j < 5; j++) {
        var el = list[j];
        var t = cleanName(el.textContent);
        if (!t) t = cleanName(el.getAttribute && el.getAttribute('alt'));
        if (!t) continue;
        var hit = inHeadBand(el);
        if (hit === true) return t;        // 顶栏里的，直接用
        if (hit === null && !loose) loose = t;   // 还没渲染出尺寸（懒加载），先记下
      }
    }
    return loose;
  }

  /** 探针②：带标签的文案 */
  function probeLabeled(text) {
    var t = String(text || '');
    var pats = [
      /主播昵称\s*[：:]?\s*([^\s，,。；;]{1,20})/,
      /昵称\s*[：:]?\s*([^\s，,。；;]{1,20})/,
      /账号\s*[：:]?\s*([^\s，,。；;]{2,20})/,
      /达人\s*[：:]?\s*([^\s，,。；;]{2,20})/
    ];
    for (var i = 0; i < pats.length; i++) {
      var m = t.match(pats[i]);
      var v = m ? cleanName(m[1]) : '';
      if (v) return v;
    }
    return '';
  }

  /** 探针③：页面标题拆段 */
  function probeTitle() {
    var title = '';
    try { title = document.title || ''; } catch (e) { title = ''; }
    if (!title) return '';
    var parts = title.split(/\s*[-–—_|·]\s*/);
    for (var i = 0; i < parts.length; i++) {
      var v = cleanName(parts[i]);
      if (v) return v;
    }
    return '';
  }

  /**
   * 读账号名（带 30 秒缓存）。读不到返回 ''。
   *
   * 顺序就是可信度顺序：
   *   **头像旁的名字 → 右上角短文本 → 语义化 DOM（限顶栏）→ 带标签文案 → 页面标题**
   * （用户 2026-10-18 两次指出前缀取错，从此「位置 + 结构」优先于 class 名）
   *
   * 2026-10-19 追加**取证**：每档的实际返回值都记进 nameCache.tried。
   * 用户第三次报「一直抓错账号名」时，光看结果没法判断是哪一档误命中、
   * 还是五档全空后拼了别的字 —— 把候选摆进诊断报告，一次就能定位。
   * @returns {string}
   */
  function userName() {
    var now = Date.now();
    if (nameCache.v !== null && now - nameCache.at < NAME_TTL) return nameCache.v;

    var tried = [];
    var v = '';
    var from = '';

    /** 跑一档探针：异常一律当「没认到」，但要把异常也记下来 */
    function take(label, fn) {
      var got = '', err = '';
      try { got = fn() || ''; } catch (e) { err = String((e && e.message) || e); got = ''; }
      tried.push({ probe: label, value: got, error: err });
      return got;
    }

    v = take('头像旁', probeAvatarNear);
    if (v) from = '头像旁';
    // 头像容器里的候选快照随手存下（取证用，跟缓存一起失效）
    var avatarCands = lastAvatarCands.slice();
    if (!v) { v = take('右上角', probeCorner); if (v) from = '右上角'; }
    if (!v) { v = take('语义DOM', probeDom); if (v) from = '语义DOM'; }
    if (!v) { v = take('带标签', function () { return probeLabeled(pageText()); }); if (v) from = '带标签'; }
    if (!v) { v = take('页面标题', probeTitle); if (v) from = '页面标题'; }

    nameCache.v = v;
    nameCache.at = now;
    nameCache.from = from;
    nameCache.tried = tried;
    nameCache.avatarCands = avatarCands;
    return v;
  }

  /**
   * 账号名识别过程取证（诊断报告用）。
   *
   * `avatarCands` 是「头像容器里所有候选」的快照（含是否与头像同行、是否在
   * 其右侧）—— 2026-10-19 抓错「播前准备」时，就是靠这类现场才能定住
   * 「该抓的那个名字到底落在哪一层、它同不同行」，而不是继续瞎调判据。
   *
   * @returns {{value:string, from:string, tried:Array, avatarCands:Array}}
   */
  function probeReport() {
    if (nameCache.v === null) userName();
    return {
      value: nameCache.v || '',
      from: nameCache.from || '',
      tried: (nameCache.tried || []).slice(),
      avatarCands: (nameCache.avatarCands || []).slice()
    };
  }

  /**
   * 文件名基准：`直播回放_2026.10.18_20点13分`
   *
   * 用户 2026-10-18 逐字定的格式：**「直播回放」在前，日期用点、时间用「点」「分」**。
   * 用汉字而不是冒号，是为了跨系统复制粘贴不因 `:` 被 Windows 拒存。
   *
   * ⚠️ 2026-10-18 追加：**文件名里一律不留空格，各段之间用 `_` 连接**
   * （用户原话「文件名不要加空格，你换成_这个字符连接」）。
   * 空格在 Windows 资源管理器里会让「复制为路径」多出一对引号，传输/命令行处理时要额外转义，
   * 所以整条文件名只允许 `_` 做分隔符 —— 以后加新的段也照此办，别再插空格。
   *
   * ★ 2026-10-19 用户明确取消账号名前缀：「取消帐号名前缀作为回放的自动生成的名字了」。
   *   **默认不再自动识别账号名、不再拼前缀**（不传 user 就是纯日期名）。
   *   userName() / 探针仍保留在文件里（诊断与将来可能的其它用途），
   *   但**任何自动命名路径都不要再去调它** —— 页面顶栏的昵称结构太不稳定，
   *   三个版本抓错过三次（「互动指标查看观众分析」「播前准备」「我的观众」），
   *   与其猜名字，不如让文件名保持可预测。
   *
   * @param {object} [when] 本场时间；不给就用当前时间
   * @param {string} [user] 账号名；**不传 = 不加前缀**（传了才拼，且空格会转成 `_`）
   */
  function fileNameFor(when, user) {
    var w = when || (function () {
      var n = new Date();
      return { y: n.getFullYear(), m: n.getMonth() + 1, d: n.getDate(),
               hh: n.getHours(), mm: n.getMinutes() };
    })();
    // 空格转下划线：昵称可能自带空格（「SECRET CIRCLE 高奢女装」），
    // 而文件名一旦有空格就要额外转义，用户明确不要。仅用户显式传名时才会走到这里。
    var u = user === undefined ? '' : cleanName(user).replace(/\s+/g, '_');
    var base = '直播回放_' + w.y + '.' + pad2(w.m) + '.' + pad2(w.d)
      + '_' + w.hh + '点' + pad2(w.mm) + '分';
    return (u ? u + '_' : '') + base;
  }

  /**
   * 本场时间：页面优先，读不到退今天。
   * @returns {{when:object, fromPage:boolean}}
   */
  function sessionTime() {
    var w = parseSessionTime(pageText());
    if (w) return { when: w, fromPage: true };
    var n = new Date();
    return {
      when: { y: n.getFullYear(), m: n.getMonth() + 1, d: n.getDate(),
              hh: n.getHours(), mm: n.getMinutes() },
      fromPage: false
    };
  }

  function sessionDuration() {
    var d = parseSessionDuration(pageText());
    if (d > 0) return d;
    // 兜底：播放器自己认的时长（只能读到「已加载的」那一段，故仅当 > 60 秒才采信）
    var vs = document.querySelectorAll ? document.querySelectorAll('video') : [];
    var best = 0;
    for (var i = 0; i < vs.length; i++) {
      var v = vs[i].duration;
      if (isFinite(v) && v > best) best = v;
    }
    return best > 60 ? Math.round(best) : 0;
  }

  /** 人话时长，用于确认卡与提示 */
  function fmtLen(sec) {
    var s = Math.round(sec || 0);
    if (s <= 0) return '未知';
    var h = Math.floor(s / 3600);
    var m = Math.floor((s % 3600) / 60);
    var r = s % 60;
    if (h > 0) return h + ' 小时 ' + m + ' 分';
    if (m > 0) return m + ' 分 ' + r + ' 秒';
    return r + ' 秒';
  }

  window.__DYC_REPLAY_META__ = {
    pageText: pageText,
    parseSessionTime: parseSessionTime,
    parseSessionDuration: parseSessionDuration,
    userName: userName,
    probeReport: probeReport,           // 识别过程取证（诊断报告用）
    cleanName: cleanName,
    probeCorner: probeCorner,           // 右上角昵称探针（离线自测用）
    probeAvatarNear: probeAvatarNear,   // 头像旁昵称探针（离线自测用）
    isUiChrome: isUiChrome,             // 控件判定（离线自测用）
    inHeadBand: inHeadBand,             // 顶栏带判定（离线自测用）
    fileNameFor: fileNameFor,
    sessionTime: sessionTime,
    sessionDuration: sessionDuration,
    fmtLen: fmtLen,
    pad2: pad2,
    invalidate: function () {
      cache.text = ''; cache.at = 0;          // 页面变了，账号名也可能变
      nameCache.v = null; nameCache.at = 0;
      nameCache.from = ''; nameCache.tried = []; nameCache.avatarCands = [];
    }
  };
})();
