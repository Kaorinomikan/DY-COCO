/**
 * 直播回放下载 · 主流程
 * ============================================================
 * 【只有一页：直播服务平台 · 直播复盘 anchor.douyin.com/anchor/review】
 *   原先还打算在电商罗盘直播大屏专业版也做下载，用户 2026-10-18 改了口径：
 *   **大屏不做下载**，只在播放器下方放一枚「跳转直播服务平台」。
 *   那一枚按钮由 replay-link.js 负责，不加载本文件（省掉 400KB 转封装库）。
 *
 * 【用户定的三条硬要求（2026-10-18）】
 *   ① 视频右上角一枚「下载回放」按钮；
 *   ② **整场一个文件**，不要一段一段；
 *   ③ 文件名 = 直播回放 + 当天时间，格式 `直播回放_2026.10.18_20点13分`（不留空格，用 _ 连）；
 *   ④ 点击后**先出确认卡**（场次 / 时长 / 体积 / 清晰度 / 文件名），确认再下。
 *
 * 【「整场」到底靠什么保证 —— 这是本文件的核心，改动前务必读懂】
 *   判定「整场」的标准只有一条：
 *   **清单覆盖的总时长 ÷ 本场直播时长 ≥ 99%**。
 *
 *   候选清单按可靠性排序：
 *     ① VOD 清单（有 #EXT-X-ENDLIST）且总时长最长 —— 一次就是全场，最可靠；
 *     ② master 清单 → 取最高码率子清单，再按 ① 判；
 *     ③ 直链 MP4（少数场次平台直接给一个文件）—— 天然整场。
 *   全部候选都拉一遍清单、算时长，取最长的那条。这比「认 URL 特征」稳：
 *   平台改域名、改参数名都不影响。
 *
 *   ⚠️ **不做「边播边录」**。那需要用户把整场拖一遍，2 小时的直播要陪坐 2 小时。
 *      本文件的下载耗时只与网速有关，与用户有没有播放无关。
 *
 * 【为什么清单要「等一会儿再判」】
 *   播放器往往是先请求 master、再请求子清单，两条请求间隔几百毫秒。
 *   点按钮的瞬间可能只看到 master。所以点下去先等最多 3 秒（有新媒体地址
 *   就提前结束），把候选收齐再评估，避免「急着下，下了个 720p 半场」。
 *
 * 【安全与边界（写进代码，防止以后被越推越远）】
 *   · 只下**当前页面对应的这一场**，不做列表批量、不跟到别的 roomId；
 *   · 只存**当前账号有权观看**的内容，不做去水印、不改画面、不生成分享链接；
 *   · 一次只跑一个任务（第二个任务会提示「已有下载在进行」）。
 */
(function () {
  'use strict';

  var W = window.__DYC_REPLAY_WRITER__;
  var UI = window.__DYC_REPLAY_UI__;
  var M3 = window.__DYC_M3U8__;
  var NET = window.__DYC_REPLAY_NET__;
  var META = window.__DYC_REPLAY_META__;
  // 防误点守护（关页确认 / 顶栏拦截 / 标题进度）是 2026-10-21 新增的软依赖：
  // 它缺席时下载本身必须照常能跑，所以不进下面的硬依赖检查。
  var GUARD = window.__DYC_REPLAY_GUARD__ || null;

  if (!W || !UI || !M3 || !NET || !META) return;   // 依赖缺失：静默退出，不报错刷屏

  var CONC_MIN = 2;             // 撞限流后最多退到 2 条，再少就太慢
  var CONC_START = 3;           // 起点与旧版一致（已验证不触发平台校验），不冒进
  var CONC_MAX = 10;            // 2026-10-21 用户要「实打实提速」：抖音 CDN 走 HTTP/2，
                                // 单连接多路复用，「同源 6 连接」是 HTTP/1.1 时代的限制，
                                // 不再构成天花板 —— 提到 10 实打实抢带宽；撞限流
                                // (429/503/509) 自动降档 + 冷却的保险丝仍在，见 doWrite。
  var CONC_UP_AFTER = 6;        // 连续成功这么多片才试探 +1（原 12：从 3 爬到 10 要
                                // 84 片 ≈ 两三分钟，太磨叽；6 片/次 ≈ 一分钟到位，
                                // 升猛了有降档保险丝兜底）
  var CONC_COOLDOWN = 90000;    // 撞过限流后 90 秒内不再升档
  var BUFFER_MAX = 12;          // 「已发出未消费」的分片上限（领先写入指针的最大距离）。
                                // TS 片约 2~4MB，12 片 ≈ 30~50MB 内存峰值，可接受；
                                // 再大只会白白攒内存，再小写盘一慢就饿着网络。
  var SEG_RETRY = 3;            // 单片最多重试次数
  var GATHER_MS = 3000;         // 收候选的最长等待
  var MIN_COVERAGE = 0.99;      // 「整场齐了」的门槛
  var WARN_COVERAGE = 0.5;      // 低于此值视为明显不是整场，禁止下载
  var SPEED_WIN_MS = 5000;      // 速度读数的滑动窗口（2026-10-21 用户拍板 5 秒）：
                                // 把 0.8 秒瞬时窗的忽高忽低摊平成窗口平均，代价是
                                // 网速真变时要滞后 ~5 秒才跟上（用户认可）
  var UI_REFRESH_MS = 2500;     // 进度卡与标题进度的显示节流（2026-10-23 #110 用户拍板）：
                                // 实时读数 2.5 秒统一刷一次，「数字在动」本身就是活信号；
                                // 用户明确不要呼吸灯 / 计时文字，停滞判定仍走 STALL_MS 不变

  /* ---------- 下载中防误点（2026-10-21 用户需求）----------
   * 用户原话：正在下载时不小心点到其他网页或同网页的其他分页，
   * 要防止误点，不然下载就白费了。四道防线：
   *   ① 关页 / 刷新 / 真跳转 → GUARD.begin 挂 beforeunload 弹系统确认框；
   *   ② 顶栏切分页 → GUARD 在捕获阶段 confirm（见 replay-guard.js）；
   *   ③ 标签页标题实时进度 → GUARD.progress，防「忘了自己在下载」；
   *   ④ 停滞自检 → 切到后台被内核挂起（360 这类省电策略）或断网时，
   *      下载会「活着但不动」，用户根本无从发现。超过 STALL_MS 无进展
   *      就主动停掉并把状态报出来，按钮复位，不再让人对着卡死的进度猜。
   * 另有 BUSY_KEY：sessionStorage 记「正在下载」。真导航（刷新 / 跳转）
   * 会杀掉下载但留着这个标记 —— 回来时据此报「上次下载未完成」，
   * 不然用户回来只看到一枚安静的按钮，根本不知道刚才白下了。 */
  var STALL_MS = 30000;         // 超过这么久无进展判停滞（单分片含重试 ~3.5s 内必有结果）
  var STALL_CHECK_MS = 10000;   // 停滞巡检周期
  var BUSY_KEY = '__dycReplayBusy';

  var flags = {};
  var state = {
    running: false,
    aborted: false,
    session: null,            // 已解析好的下载计划（点过一次就复用，避免重复拉清单）
    dlName: null              // 当前下载的文件名（含扩展名）：按钮壳重建时恢复进度卡用
  };

  /* ==========================================================
   * 一、页面判定
   * ========================================================== */

  /**
   * 是不是「直播服务平台」的回放复盘页。
   *
   * 两个域名都算（用户 2026-10-18 反馈：在直播服务平台上没看到下载按钮）：
   *   · anchor.douyin.com  —— 主播后台，复盘页在 /anchor/review
   *   · liveservice.douyin.com/… —— 直播服务平台主站，跳转按钮就是去这里。
   *     这一站首页是门户导航（没有回放），所以只在**路径像复盘页**或
   *     **页面上已经有 video** 时才认，免得在门户上凭空多一枚按钮。
   *
   * ⚠️ anchor 侧用 `location.href` 判（不是 pathname）：平台这套后台既用过
   *    路径路由，也可能把视图挂在 hash 上，只看 pathname 会漏。
   *    `/anchor/review` 这个片段在 anchor 域里够特异，不会误伤别的页面。
   */
  function pageKind() {
    var h = location.hostname;
    // href 优先；个别环境（离线自测桩 / 受限上下文）拿不到 href 就退回 pathname
    var href = location.href || location.pathname || '';
    if (h === 'anchor.douyin.com') {
      if (/\/anchor\/review/i.test(href)) return 'anchor';
      return '';
    }
    if (h === 'liveservice.douyin.com') {
      if (/review|replay|playback/i.test(href)) return 'anchor';
      if (document.querySelector('video')) return 'anchor';
    }
    return '';
  }

  function enabled() {
    return !!pageKind() && flags.replayDownload !== false;
  }

  /* ==========================================================
   * 二、本场时间 / 时长 / 文件名
   *
   * 这三件事全部委托 replay-meta.js —— 它们都是「从页面文本抠字」，
   * 错一个字就全错（文件名错、整场基准错），所以单独一个文件配逐条自测。
   * 这里只保留两个薄封装：把 META 的接口对齐本文件原有的调用名。
   * ========================================================== */

  function readSessionDuration() { return META.sessionDuration(); }

  /**
   * 默认文件名：`直播回放_2026.10.18_20点13分`（可带扩展名，见 ext）
   *
   * ★ 2026-10-19 用户取消账号名前缀：「取消帐号名前缀作为回放的自动生成的名字了」。
   *   这里是唯一的命名入口 —— **第二个参数固定传 ''，不要再接 userName()**。
   *   页面顶栏的昵称结构不稳，抓错过三次（「互动指标查看观众分析」/「播前准备」/
   *   「我的观众」），与其猜，不如让文件名保持可预测。确认卡里可以自己改名。
   *   整条名字不含空格，各段用 `_` 连（用户 2026-10-18 要求）。
   */
  function baseFileName() {
    return META.fileNameFor(META.sessionTime().when, '');
  }

  function pad2(n) { return META.pad2(n); }

  /* ==========================================================
   * 三、收候选清单 → 解析 → 选出「最像整场」的那一条
   * ========================================================== */

  // 音频专用清单的常见命名：页面播放器常把音轨单列一条（audio.m3u8 / only_audio=1）
  var AUDIO_URL_RE = /(?:^|[\/_.\-=])(?:audio|audio_only|audioonly|only_audio|onlyaudio|aac|music)(?:[\/_.\-?&=]|$)/i;

  function looksAudioUrl(u) { return AUDIO_URL_RE.test(String(u || '')); }

  function sleep(ms) {
    return new Promise(function (r) { setTimeout(r, ms); });
  }

  /** 等新媒体地址出现（最多 GATHER_MS），让候选收齐一点 */
  function gather() {
    return new Promise(function (resolve) {
      var done = false;
      var un = NET.watch(function () { /* 只用来提前结束等待 */ if (!done) { done = true; } });
      var startedAt = Date.now();
      (function tick() {
        if (done || Date.now() - startedAt >= GATHER_MS) {
          un();
          resolve();
          return;
        }
        setTimeout(tick, 250);
      })();
    });
  }

  /**
   * 评估一条候选：拉清单、算总时长、抓档位信息。
   * 失败一律返回 null（不抛），由上层过滤 —— 候选里混着统计接口是常态。
   */
  function evaluate(cand) {
    if (cand.kind === 'mp4') {
      return NET.headSize(cand.url).then(function (size) {
        return {
          url: cand.url, type: 'mp4', total: 0, segments: [],
          bytes: size, quality: '原始文件', vod: true, key: null, map: null
        };
      });
    }
    if (cand.kind === 'dash') return Promise.resolve(null);   // DASH 暂不支持

    return M3.load(NET, cand.url).then(function (r) {
      if (!r || r.kind !== 'media') return null;
      if (!r.segments.length) return null;
      var v = pickVariant(r.variants, r.picked);
      return {
        url: cand.url,
        type: 'hls',
        total: r.total,
        segments: r.segments,
        map: r.map,
        key: r.key,
        unsupported: r.unsupported,
        vod: r.vod,
        variants: r.variants || null,
        picked: r.picked || null,
        quality: qualityText(r.variants, r.picked),
        // 码率 / 分辨率：候选之间比「清晰度」用（原来只比时长，会挑到低码率档）
        bandwidth: v ? v.bandwidth : 0,
        height: v ? v.height : 0,
        // 纯音频候选：URL 叫 audio / 只有一档且 CODECS 是 mp4a.*
        audioOnly: looksAudioUrl(cand.url) || (!!v && v.video === false),
        videoCodec: v ? (v.video ? 'video' : 'audio') : '',
        bytes: 0
      };
    }).catch(function () { return null; });
  }

  /** 取 picked 对应的档位（找不到就取最高档） */
  function pickVariant(variants, picked) {
    if (!variants || !variants.length) return null;
    for (var i = 0; i < variants.length; i++) {
      if (variants[i].url === picked) return variants[i];
    }
    return variants[0];
  }

  function qualityText(variants, picked) {
    if (!variants || !variants.length) return '页面默认';
    var v = pickVariant(variants, picked);
    var s = v.height ? (v.height + 'P')
      : (v.bandwidth ? Math.round(v.bandwidth / 1000) + ' kbps' : '页面默认');
    if (variants.length > 1) {
      // 口径跟着选档规则走（2026-10-19 改为「分辨率优先」）：
      // 别再说「已取最高 H.264 档」—— 1080p 的 HEVC 现在也算最高档，
      // 那句话会让人以为自己拿到的是降级版本。
      var topH = 0;
      for (var i = 0; i < variants.length; i++) {
        topH = Math.max(topH, variants[i].height || 0);
      }
      var isTop = (v.height || 0) >= topH;
      s += '（共 ' + variants.length + ' 档，' + (isTop ? '已取最高清晰度' : '还有更高档') + '）';
    }
    return s;
  }

  /**
   * 从所有候选里挑最好的一条。
   * 排序优先级：① 有 VOD 标记 ＞ 没有；② 总时长更长者优先。
   * 注意：**必须先把候选全部评估完再排序** —— 先到的不一定是最全的，
   * 先到先得正是「只下了前半场」这类问题的根源。
   */
  /**
   * 从所有候选里挑最好的一条。
   * 排序优先级：① 有 VOD 标记 ＞ 没有；② 总时长更长者优先。
   *
   * ⚠️ 两个刻意的设计：
   *   1. **必须先把候选全部评估完再排序** —— 先到的不一定是最全的，
   *      「先到先得」正是「只下了前半场」这类问题的根源。
   *   2. 返回 `{ best, unsupported }` 而不是单个对象：当所有候选都因
   *      「加密方式不支持」被筛掉时，必须把那条原因**带出来**给用户看，
   *      而不是笼统说一句「读不出清单」—— 用户会反复重试一个永远不成功的操作。
   */
  function pickBest(cands) {
    if (!cands.length) return Promise.resolve({ best: null, ranked: [], unsupported: '' });
    return Promise.all(cands.map(function (c) {
      return evaluate(c).then(function (r) {
        if (r) r.firstSeen = c.t;
        return r;
      });
    })).then(function (rs) {
      var ok = rs.filter(function (r) {
        return r && r.segments && r.segments.length && !r.unsupported;
      });
      var direct = rs.filter(function (r) { return r && r.type === 'mp4' && r.bytes; });

      // 被「加密方式不支持」挡掉的，留一条原因
      var blocked = rs.filter(function (r) { return r && r.unsupported; });
      var reason = blocked.length ? blocked[0].unsupported : '';

      if (!ok.length) {
        var only = direct.length ? direct[0] : null;
        return { best: only, ranked: only ? [only] : [], unsupported: reason };
      }

      /* 排序口径（2026-10-18 改）：**先保画面，再保清晰度，最后才看时长**。
         原来只比「有无 VOD」和「总时长」—— 纯音频清单的时长同样覆盖整场，
         会跟视频流打平，然后按候选到达顺序胜出 ⇒ 用户下到没画面的文件。
         现在：带画面的 > 时长更全 > 码率更高 > 分辨率更高。 */
      ok.sort(function (a, b) {
        if (!!a.audioOnly !== !!b.audioOnly) return a.audioOnly ? 1 : -1;
        if (a.vod !== b.vod) return a.vod ? -1 : 1;
        if ((a.bandwidth || 0) !== (b.bandwidth || 0)) return (b.bandwidth || 0) - (a.bandwidth || 0);
        if ((a.height || 0) !== (b.height || 0)) return (b.height || 0) - (a.height || 0);
        return b.total - a.total;
      });
      return { best: ok[0], ranked: ok, unsupported: reason };
    });
  }

  /* ==========================================================
   * 三·五、这条流到底有没有画面（2026-10-18 用户实测踩坑后补）
   *
   * 用户报：「几百兆、没有图像，全是声音」。两种成因都很现实：
   *   ① 页面播放器把音轨单列一条清单，被我们当成主候选（时长同样覆盖整场）；
   *   ② 视频是 **H.265（HEVC）**，而 mux.js 只认 H.264 —— 转封装时视频轨被整条丢掉，
   *      输出只剩音频，文件自然只有几百兆。
   * 所以选流之后、出确认卡之前，先抓 128KB 看一眼真实轨道：
   *   · 纯音频 → 换下一条候选，全都不行就明确报错（绝不给人一个没画面的文件）；
   *   · H.265（且是 TS）→ 换 H.264 候选，换不到就拦下并说明原因；
   *   · H.265 但源是 fMP4 → 直通字节即可，画面正常，放行。
   * 探不到（分片加密、CDN 不认 Range）一律不拦 —— 宁可照旧，也不能把能下的拦死。
   * ========================================================== */

  var PROBE_BYTES = 131072;     // 128KB：够覆盖 TS 的 PMT 或 fMP4 的 moov
  var PROBE_TOP = 3;            // 最多探前 3 条候选，别每条都拉一次

  /** 在字节里找 ASCII（只扫前 limit 字节，避免整片遍历） */
  function findAscii(buf, s, limit) {
    var n = Math.min(buf.length, limit == null ? buf.length : limit) - s.length;
    var c0 = s.charCodeAt(0);
    for (var i = 0; i <= n; i++) {
      if (buf[i] !== c0) continue;
      var j = 1;
      for (; j < s.length; j++) if (buf[i + j] !== s.charCodeAt(j)) break;
      if (j === s.length) return i;
    }
    return -1;
  }

  /**
   * TS：读 PMT 的 stream_type。
   *   0x1B=H.264 / 0x24=H.265 / 0x0F=AAC / 0x11=LATM / 0x03·0x04=MPEG 音频
   * @returns {?{container, video, audio}}
   */
  function tsTracks(buf) {
    var n = buf.length;
    var start = -1;
    for (var i = 0; i + 188 * 2 < n && i < 188 * 4; i++) {
      if (buf[i] === 0x47 && buf[i + 188] === 0x47 && buf[i + 376] === 0x47) { start = i; break; }
    }
    if (start < 0) return null;

    var out = { container: 'ts', video: '', audio: false };
    for (var p = start; p + 188 <= n; p += 188) {
      if (buf[p] !== 0x47) continue;
      if (!(buf[p + 1] & 0x40)) continue;              // 只认 payload_unit_start
      var afc = (buf[p + 3] >> 4) & 0x3;
      if (afc === 0 || afc === 2) continue;            // 无 payload（纯调整字段/空包）
      var off = p + 4;
      if (afc === 3) off += 1 + buf[p + 4];
      if (off + 3 >= p + 188) continue;
      var sec = off + 1 + buf[off];                    // 跳过 pointer_field
      if (sec + 12 > p + 188) continue;
      if (buf[sec] !== 0x02) continue;                 // table_id 0x02 = PMT
      var secLen = ((buf[sec + 1] & 0x0f) << 8) | buf[sec + 2];
      var pil = ((buf[sec + 10] & 0x0f) << 8) | buf[sec + 11];
      var q = sec + 12 + pil;
      var end = Math.min(sec + 3 + secLen - 4, p + 188);   // 去掉 CRC32
      while (q + 5 <= end) {
        var st = buf[q];
        var esLen = ((buf[q + 3] & 0x0f) << 8) | buf[q + 4];
        if (st === 0x1b) out.video = 'h264';
        else if (st === 0x24) out.video = out.video || 'h265';
        else if (st === 0x0f || st === 0x11 || st === 0x03 || st === 0x04) out.audio = true;
        q += 5 + esLen;
      }
      return out;                                      // 一张 PMT 就够
    }
    return null;
  }

  /** fMP4 / MP4：看 moov 里的 handler 与采样描述（avc1 / hvc1 / soun …） */
  function fmp4Tracks(buf) {
    var out = { container: 'fmp4', video: '', audio: false };
    var has = function (s) { return findAscii(buf, s, 262144) >= 0; };
    if (has('avc1') || has('avc3') || has('avcC')) out.video = 'h264';
    else if (has('hvc1') || has('hev1') || has('hvcC')) out.video = 'h265';
    else if (has('av01') || has('vp09')) out.video = 'other';
    else if (has('vide')) out.video = 'other';
    out.audio = has('soun') || has('mp4a');
    return out;
  }

  function probeContainer(buf) {
    if (!buf || !buf.length) return null;
    if (findAscii(buf, 'ftyp', 64) >= 0) return fmp4Tracks(buf);
    return tsTracks(buf);
  }

  /** 抓 init 段（优先，含 moov）或第一片，只看头部 128KB */
  function probeTracks(plan) {
    if (!plan || plan.type !== 'hls') return Promise.resolve(null);
    var url = (plan.map && plan.map.url) || (plan.segments[0] && plan.segments[0].url);
    if (!url) return Promise.resolve(null);
    return NET.fetchBuf(url, { range: 'bytes=0-' + (PROBE_BYTES - 1) })
      .then(function (buf) { return probeContainer(buf); })
      .catch(function () { return null; });          // 探不到不阻断
  }

  /**
   * 判定这条流能不能出画面。
   *
   * 【为什么 TS 里的非 H.264 现在也放行（2026-10-19 改口径）】
   *   旧口径把「TS + H.265」判成 codec 直接拦下，理由是 mux.js 只认 H.264、
   *   硬转会只剩声音。但用户实测那场**只有一条 H.265 候选、没有可切的 H.264 档**，
   *   拦下 = 永远下不了。而 TS 分片本来就是可首尾相接的连续流：
   *   原样拼成 `.ts` 画质零损失，PotPlayer / VLC / 剪映都能播。
   *   所以判成 `ts-pass`（字节直通），**不经过 mux.js**，由 doWrite 分流。
   *
   * @returns {'ok'|'ts-pass'|'audio'|'unknown'}
   */
  function verdict(t) {
    if (!t) return 'unknown';
    if (t.video === 'h264') return 'ok';
    // 有视频轨但不是 H.264：fMP4 直通（容器本身就是 mp4），TS 原样拼成 .ts
    if (t.video) return t.container === 'fmp4' ? 'ok' : 'ts-pass';
    if (t.audio) return 'audio';
    return 'unknown';
  }

  /** 「H.264 + AAC」这种给人看的字样 */
  function trackText(t) {
    if (!t) return '';
    var v = t.video === 'h264' ? 'H.264'
      : t.video === 'h265' ? 'H.265'
      : t.video ? '非 H.264' : '';
    var a = t.audio ? 'AAC' : '';
    if (!v && !a) return '';
    return (v || '无画面') + (a ? ' + ' + a : '') + (t.container ? ' · ' + t.container.toUpperCase() : '');
  }

  /**
   * 依次探候选，挑第一条「能出画面」的。
   * @returns {Promise<{plan:?object, reason?:string}>}
   */
  function choosePlayable(ranked) {
    var list = (ranked || []).slice(0, PROBE_TOP);
    var i = 0, sawAudio = false;

    function next() {
      if (i >= list.length) {
        if (sawAudio) {
          return Promise.resolve({
            plan: null,
            reason: '只抓到音频流，先让播放器出画面再点下载',
            detail: '只抓到了音频流（没有画面）。请点一下播放器让它真正播起来（出现画面），再点下载。'
          });
        }
        return Promise.resolve({ plan: list[0] || null });   // 什么都没探到：按原判走
      }
      var p = list[i++];
      if (p.audioOnly) { sawAudio = true; return next(); }
      return probeTracks(p).then(function (t) {
        var v = verdict(t);
        if (v === 'audio') { sawAudio = true; return next(); }
        p.tracks = t;
        // TS 里的非 H.264（典型是 H.265）：不转封装，按顺序原样拼成 .ts。
        // 扩展名必须跟着实际容器走 —— 写成 .mp4 是骗人，播放器一放就废。
        if (v === 'ts-pass') {
          p.passthrough = true;
          p.ext = '.ts';
        }
        return { plan: p };
      });
    }
    return next();
  }

  /** 估算体积：抽样 HEAD 若干分片取平均，× 片数 */
  function estimateBytes(plan) {
    if (plan.type === 'mp4') return Promise.resolve(plan.bytes || 0);
    var segs = plan.segments;
    var picks = [];
    var n = segs.length;
    var step = Math.max(1, Math.floor(n / 6));
    for (var i = 0; i < n && picks.length < 6; i += step) picks.push(segs[i]);
    if (!picks.length) return Promise.resolve(0);

    return Promise.all(picks.map(function (s) {
      // 有字节范围就能直接算，省一次网络请求
      if (s.byterange) {
        var len = parseInt(String(s.byterange).split('@')[0], 10);
        if (isFinite(len) && len > 0) return Promise.resolve(len);
      }
      return NET.headSize(s.url);
    })).then(function (sizes) {
      var valid = sizes.filter(function (x) { return x > 0; });
      if (!valid.length) return 0;
      var avg = valid.reduce(function (a, b) { return a + b; }, 0) / valid.length;
      var mapSize = 0;
      if (plan.map) {
        var ml = plan.map.byterange ? parseInt(String(plan.map.byterange).split('@')[0], 10) : 0;
        mapSize = isFinite(ml) ? ml : 0;
      }
      return Math.round(avg * n + mapSize);
    });
  }

  /**
   * 组装下载计划：候选评估 + 覆盖率校验 + 体积估算。
   * @returns {Promise<{plan, coverage, expected, bytes, blocked, warn}>}
   */
  function buildSession() {
    var cands = NET.media();
    dlog('嗅到媒体候选 ' + cands.length + ' 条');
    if (!cands.length) {
      // noMedia 是给上层看的标记：这类失败可以靠「替用户播一下」自愈，
      // 而清单过期 / 加密不支持之类不行，别乱重试。
      return Promise.resolve({
        plan: null, noMedia: true,
        reason: '还没有回放数据，先点一下播放再下载',
        detail: '页面上还没有出现回放数据。请先让回放播起来（点一下播放），再点下载。'
      });
    }

    return pickBest(cands).then(function (picked) {
      if (!picked.ranked || !picked.ranked.length) {
        // 有「加密方式不支持」这种具体原因时优先给具体原因 —— 笼统的
        // 「读不出来」会让人反复重试一个永远不成功的操作。
        return {
          plan: null,
          reason: picked.unsupported || '清单读不出来，刷新页面再试',
          detail: picked.unsupported
            || '检测到媒体地址，但清单读不出来（可能已过期或格式不受支持）。请刷新页面后再试。'
        };
      }

      // 选流不能只看时长：先确认「这条流有画面」（见「三·五」）
      return choosePlayable(picked.ranked).then(function (ch) {
        // 把「比了哪些、选了哪条」写进诊断报告 —— 出问题时这是唯一能复盘的依据
        picked.ranked.slice(0, 5).forEach(function (p) {
          dlog('候选 ' + shortUrl(p.url)
            + ' · ' + (p.audioOnly ? '疑似纯音频' : '视频')
            + ' · ' + (p.total ? Math.round(p.total) + 's' : '时长未知')
            + (p.height ? ' · ' + p.height + 'P' : '')
            + (p.bandwidth ? ' · ' + Math.round(p.bandwidth / 1000) + 'kbps' : '')
            + (p.vod ? ' · VOD' : ''));
        });
        if (!ch.plan) {
          dlog('没有可用流：' + ch.reason);
          return { plan: null, reason: ch.reason, detail: ch.detail || '' };
        }
        var plan = ch.plan;
        dlog('选定流 ' + shortUrl(plan.url) + ' · ' + (plan.quality || '默认')
          + (plan.passthrough ? ' · TS 原样直通 → ' + (plan.ext || '.ts') : '')
          + (plan.tracks ? ' · 轨道 ' + trackText(plan.tracks) : ' · 轨道未探到（不拦）'));

        // sessionDuration 内部已含「读不到就退播放器 duration」的兜底
        var expected = readSessionDuration() || 0;
        var coverage = 1;
        var warn = '';
        var blocked = false;

        if (plan.type === 'hls' && expected > 0 && plan.total > 0) {
          coverage = plan.total / expected;
          if (coverage < MIN_COVERAGE) {
            var pct = Math.round(coverage * 100);
            if (coverage < WARN_COVERAGE) {
              blocked = true;
              warn = '只覆盖了本场的 ' + pct + '%（' + META.fmtLen(plan.total) + ' / ' + META.fmtLen(expected)
                + '），明显不是整场，已阻止下载。请把回放从头上播一遍、等清单加载完再试。';
            } else {
              warn = '清单覆盖 ' + pct + '%（' + META.fmtLen(plan.total) + ' / ' + META.fmtLen(expected)
                + '），末尾可能缺一小段。可以照常下载，但请知悉。';
            }
          }
        }

        // H.265 直通时文件是能播的，但 Windows 自带播放器不带 HEVC 解码器，
        // 表现就是「只有声音、没有画面」—— 正是用户 2026-10-18 报的现象，先说清楚。
        // 2026-10-19：TS + H.265 改为字节直通成 `.ts`（不再拦），提示同步改口径。
        var vcodec = plan.tracks && plan.tracks.video;
        var trackNote = '';
        if (vcodec === 'h265') {
          trackNote = '这场是 H.265 编码，'
            + (plan.passthrough ? '会按原样打包成 .ts' : '已按原样封装成 .mp4')
            + '（画质零损失、不重新编码）。Windows 自带播放器常常只有声音没画面，'
            + '用 PotPlayer / VLC / 剪映打开就正常 —— 不是文件坏了。';
        } else if (plan.passthrough) {
          trackNote = '这场不是 H.264 编码，会按原样打包成 .ts（画质零损失）。'
            + 'Windows 自带播放器可能打不开，换 PotPlayer / VLC 试试。';
        }
        if (trackNote) warn = warn ? (warn + ' ' + trackNote) : trackNote;

        return estimateBytes(plan).then(function (bytes) {
          dlog('覆盖率 ' + Math.round(coverage * 100) + '%（清单 '
            + Math.round(plan.total) + 's / 本场 ' + Math.round(expected) + 's）'
            + ' · ' + plan.segments.length + ' 段 · 估算 ' + (bytes ? UI.fmtBytes(bytes) : '未知'));
          return { plan: plan, coverage: coverage, expected: expected, bytes: bytes,
                   blocked: blocked, warn: warn, trackText: trackText(plan.tracks),
                   ext: plan.ext || '.mp4' };
        });
      });
    });
  }

  /* ==========================================================
   * 四、解密（只有 AES-128 才走这条路）
   * ========================================================== */

  function hexToBytes(hex) {
    var s = String(hex || '').replace(/^0x/i, '');
    var out = new Uint8Array(s.length / 2);
    for (var i = 0; i < out.length; i++) out[i] = parseInt(s.substr(i * 2, 2), 16);
    return out;
  }

  /** 没有 IV 时按 HLS 规范用分片序号拼 16 字节大端 */
  function ivFromSeq(seq) {
    var iv = new Uint8Array(16);
    var n = seq >>> 0;
    iv[12] = (n >>> 24) & 0xff;
    iv[13] = (n >>> 16) & 0xff;
    iv[14] = (n >>> 8) & 0xff;
    iv[15] = n & 0xff;
    return iv;
  }

  var keyCache = Object.create(null);

  function getKey(url) {
    if (keyCache[url]) return Promise.resolve(keyCache[url]);
    return NET.fetchBuf(url).then(function (buf) {
      // AES-128 的密钥固定 16 字节；不足说明平台用了非常规长度，直接判失败
      if (!buf || buf.byteLength !== 16) throw new Error('密钥长度异常（' + (buf && buf.byteLength) + ' 字节）');
      keyCache[url] = buf;
      return buf;
    });
  }

  function decryptAes128(data, keyBytes, ivBytes) {
    if (!window.crypto || !window.crypto.subtle) {
      return Promise.reject(new Error('当前内核不支持 Web Crypto，无法解密加密回放'));
    }
    // HLS 的 AES-128 是 CBC + PKCS7 填充；subtle 只认「无填充」的原始块，
    // 所以这里按 16 字节整块解密，再手工去填充。
    return window.crypto.subtle.importKey('raw', keyBytes, { name: 'AES-CBC' }, false, ['decrypt'])
      .then(function (k) {
        return window.crypto.subtle.decrypt({ name: 'AES-CBC', iv: ivBytes }, k, data);
      })
      .then(function (out) {
        return new Uint8Array(out);
      });
  }

  /* ==========================================================
   * 五、取片 → 转封装 → 落盘
   *
   * 并发窗口 3：同时最多 3 片在飞，但**按序写入**。
   * 内存峰值 = 3 个分片（约 3~9 MB），与视频时长无关。
   * ========================================================== */

  function fetchSegment(seg, plan, ctl) {
    var opts = {};
    if (seg.byterange) {
      var parts = String(seg.byterange).split('@');
      var len = parseInt(parts[0], 10);
      var off = parts.length > 1 ? parseInt(parts[1], 10) : 0;
      if (isFinite(len) && len > 0) {
        opts.range = 'bytes=' + off + '-' + (off + len - 1);
      }
    }
    if (ctl && ctl.abortCtl) opts.signal = ctl.abortCtl.signal;

    return NET.fetchBuf(seg.url, opts).then(function (buf) {
      if (!plan.key || plan.key.method !== 'AES-128') return buf;
      return getKey(plan.key.url).then(function (k) {
        var iv = plan.key.iv ? hexToBytes(plan.key.iv) : ivFromSeq(seg.seq);
        return decryptAes128(buf, k, iv);
      });
    });
  }

  /**
   * 跑完整下载。
   * @param {object} plan
   * @param {string} fileName 不含扩展名（扩展名按容器定，见下面的 ext）
   */
  /**
   * @param {object} plan    下载计划
   * @param {string} fileName 文件名（不含扩展名）
   * @param {number} [_estBytes] 整场体积估算。
   *        ⚠️ 2026-10-18 起**不再用于进度显示**：估算靠抽样 HEAD，而 CDN 可能把
   *        整个资源的长度回给 HEAD，实测估出过 6.8 GB（实际才百来 MB）。
   *        进度卡的左栏改成「已下载字节 · 已完成段数」，两个都是实测值，
   *        不会再跟百分比打架。参数保留只为不动调用方与确认卡（卡里仍显示「约 X」）。
   */
  function runDownload(plan, fileName, _estBytes) {
    var ctl = { aborted: false, abortCtl: (typeof AbortController === 'function') ? new AbortController() : null, stalled: false };
    state.aborted = false;
    state.running = true;

    // 扩展名跟着实际容器走：H.265 的 TS 只能原样拼成 .ts，其余都是 .mp4
    var ext = plan.ext || '.mp4';

    UI.setAbortHandler(function () {
      ctl.aborted = true;
      state.aborted = true;
      if (ctl.abortCtl) { try { ctl.abortCtl.abort(); } catch (e) {} }
    });
    UI.setBtn('busy', '下载中');
    UI.showProgress(fileName + ext);

    // ---- 防误点守护 + 「正在下载」标记 ----
    // dlName 在按钮壳被平台拆掉重建时（attach）用来静默恢复进度卡；
    // BUSY_KEY 在真导航杀掉下载后仍会留着，回来时报「上次下载未完成」。
    state.dlName = fileName + ext;
    if (GUARD) GUARD.begin();
    try { sessionStorage.setItem(BUSY_KEY, fileName + ext); } catch (e) { /* 隐私模式等场景写不进就放弃 */ }

    dlog('开始下载：' + fileName + ext + ' · ' + plan.segments.length + ' 段 · '
      + plan.type + (plan.map ? ' · fMP4 直通' : (plan.passthrough ? ' · TS 原样直通' : ' · TS 转封装')));

    var startedAt = Date.now();
    // 速度采样：滑动窗口样本队列 [{t: 采样时刻, b: 该时刻累计字节}]，
    // 读数 = 窗口两端字节差 ÷ 时长。变量说明见 onProgress 内注释。
    var samples = [];
    var lastSpeed = 0;        // 速度采样值要"保持"，见下面 onProgress 的注释
    var lastPct10 = -10;      // 诊断日志按整十百分比打，避免刷屏

    var stallLast = 0;
    var stallTimer = 0;
    var lastUiAt = 0;         // 上次刷新进度卡 / 标题的时刻（UI_REFRESH_MS 节流用，#110）

    /**
     * 停滞巡检：写盘真正开始后才启动 —— 挑保存位置的对话框可能开很久，
     * 那不算停滞。发现超过 STALL_MS 无进展就主动停掉，走 catch 的
     * stalled 分支把状态报清楚，别让人对着卡死的进度猜。
     */
    function startStallWatch() {
      stallLast = Date.now();
      stallTimer = setInterval(function () {
        if (!state.running || ctl.aborted) return;
        if (Date.now() - stallLast < STALL_MS) return;
        ctl.stalled = true;
        ctl.aborted = true;
        state.aborted = true;
        if (ctl.abortCtl) { try { ctl.abortCtl.abort(); } catch (e) {} }
      }, STALL_CHECK_MS);
    }

    /** 收尾三件事（成功 / 失败 / 取消都要走）：停巡检、摘守护、清「正在下载」标记 */
    function cleanup() {
      if (stallTimer) { clearInterval(stallTimer); stallTimer = 0; }
      if (GUARD) GUARD.end();
      state.dlName = null;
      try { sessionStorage.removeItem(BUSY_KEY); } catch (e) { /* 尽力而为 */ }
    }

    /**
     * @param {number} done  已完成分片（HLS）或已下载字节（MP4）
     * @param {number} total 总片数 / 总字节
     * @param {number} bytes 已写入字节
     * @param {number} [conc] 当前并发档位（HLS 才有）
     */
    function onProgress(done, total, bytes, conc) {
      var ratio = total ? done / total : 0;
      var now = Date.now();

      // 停滞计时：任何真实进展都算「活着」。⚠️ 这一行必须在下面的显示节流
      // 闸门之外 —— 每次回调都要刷新，否则闸门静默的 2.5 秒会被误判成停滞。
      stallLast = now;

      // 【速度读数 = 最近 SPEED_WIN_MS 的滑动平均】
      // 2026-10-21 用户：「下载速度不够稳定，跳动比较快」。
      //   旧写法 0.8 秒瞬时窗有两个毛病：① 分片落盘是「写完一片涌一大块」，
      //   0.8 秒一会儿撞突发、一会儿撞空窗，算出来的瞬时速度天然忽高忽低；
      //   ② 每 0.8 秒跳一次数字，再稳也显得「跳得快」。改成 5 秒滑动窗口：
      //   每次回调都用「窗口最老样本 → 现在」的字节差 ÷ 时长重算，波动摊平、
      //   读数连续；仍是真实网速的反映，只是网速真变时要滞后 ~5 秒跟上。
      // ⚠️ 样本太短（刚开头 span < 0.8s）不重算，保持上一档读数（开头为 0，
      //    右栏空着 —— 与旧行为一致，不放一个虚高的开屏速度骗人）。
      // ⚠️ 读数不能每回调都清零重算：分片回调可能每 0.2 秒来一次（用户
      //    2026-10-18 反馈「指示器不对」就包含整行空白），lastSpeed 保持上值。
      samples.push({ t: now, b: bytes });
      while (samples.length > 2 && now - samples[0].t > SPEED_WIN_MS) samples.shift();
      var s0 = samples[0];
      var span = now - s0.t;
      if (span >= 800) {
        lastSpeed = (bytes - s0.b) / (span / 1000);
      }

      // 【#110 · 显示节流 2.5 秒】（2026-10-23 用户拍板）
      //   问「活信号要不要呼吸灯 / 秒数计时」时用户拍板：都不要，
      //   「把下载速度等实时信息，调整到2.5s刷新一次，让我看到动态的变化就可以了」。
      //   原写法每次回调（最快 0.2s 一次）都重绘进度卡，数字糊成一团，
      //   反而看不出「这一轮比上一轮多了多少」；统一节流到 2.5s 后，
      //   速度 / 字节 / 段数 / 标题进度一起跳，静止与前进一眼可辨 ——
      //   「数字还在动」本身就是活信号，不用再加任何指示物。
      //   ⚠️ 只节流显示，不节流采样：samples / lastSpeed 上面每回调照算，
      //      闸门打开时用的总是最新值；停滞计时同样不受闸门影响。
      //   ⚠️ 闸门 return 也会跳过诊断日志的中间台阶（最后一块在下面），
      //      下次刷新会按当时的整十百分比补打，只滞后不缺失终点值。
      if (now - lastUiAt < UI_REFRESH_MS) return;
      lastUiAt = now;
      if (GUARD) GUARD.progress(total > 0 ? ratio * 100 : -1);

      // 左栏：已下载字节 + 段进度。**两个数都来自实际，不再放体积估算**。
      //   为什么去掉「/ 估算总量」：估算靠抽样 HEAD，而抖音 CDN 对 HEAD 可能
      //   回整个资源的长度，实测能估到 6.8 GB（实际才百来 MB）。
      //   百分比是按段数算的，两者口径不同，并排放会出现「10% 却只有
      //   10 MB / 6.8 GB」这种自相矛盾的读数（用户 2026-10-18 截图反馈）。
      var left = UI.fmtBytes(bytes);
      if (total) left += ' · ' + done + '/' + total + ' 段';

      // 右栏：速度 · 还剩（剩余量按「已完成片的平均大小」外推，比按时间估稳）
      var right = '';
      if (lastSpeed > 0) {
        right = UI.fmtBytes(lastSpeed) + '/s';
        if (total > done && done > 0) {
          var remaining = (bytes / done) * (total - done);
          var eta = remaining / lastSpeed;
          if (isFinite(eta) && eta > 0) right += ' · 还剩 ' + fmtEta(eta);
        }
      }
      // 提速生效时把档位亮出来，用户能确认「多线程真的开了」。
      // ⚠️ 档位不再塞进右栏：右栏已经有三段（速度 / 还剩 / 线程），拼一起在 340px 卡里
      //    会被挤成两行（用户 2026-10-18 截图：「6 线程」掉到下一行，很难看）。
      //    现在走独立的 badge，挂在标题行右侧。
      var badge = (conc && conc > CONC_START) ? conc + ' 线程' : '';

      UI.setProgress(ratio, { left: left, right: right, badge: badge });

      // 诊断日志：每跨过 10% 记一条（含并发档位），排查「怎么这么慢」时够用
      var pct10 = Math.floor(ratio * 10) * 10;
      if (pct10 >= 10 && pct10 > lastPct10) {
        lastPct10 = pct10;
        dlog('进度 ' + pct10 + '% · ' + done + '/' + total + ' 段 · ' + left
          + (conc ? ' · ' + conc + ' 线程' : ''));
      }
    }

    // 【口径 C（2026-10-21 用户定）：凡没下完的一律删半成品】
    // savedHandle = 本次保存句柄；preSize = 下载前文件大小。
    // preSize 只为一条规则服务：**只删「本次新建」的文件** —— 覆盖已有文件
    // 保存时（preSize > 0）一律不删，删了等于把用户原来的文件也端了。
    // 不支持断点续传，半成品没有任何保留价值，是「删」而不是「留」的底气。
    var savedHandle = null;
    var preSize = -1;

    return W.pickTarget(fileName, ext).then(function (target) {
      if (!target) throw new Error('未选择保存位置');
      savedHandle = target.handle;
      // 探测下载前的文件大小；个别内核 / 桩环境拿不到就记 -1（视为不删，保守）
      return (target.handle && typeof target.handle.getFile === 'function'
        ? target.handle.getFile().then(function (f) { return f && f.size; })
        : Promise.resolve(null)
      ).catch(function () { return null; }).then(function (size0) {
        preSize = (size0 === null || size0 === undefined) ? -1 : size0;
        return W.openSink(target.handle).then(function (sink) {
          startStallWatch();
          return doWrite(sink, plan, ctl, onProgress).then(function (bytes) {
            return sink.close().then(function (written) {
              return { bytes: written || bytes, name: target.name || (fileName + ext), how: target.how };
            });
          }).catch(function (err) {
            return sink.abort().then(function () { throw err; });
          });
        });
      });
    }).then(function (res) {
      cleanup();
      state.running = false;
      UI.setBtn('idle');
      dlog('下载完成：' + res.name + ' · ' + UI.fmtBytes(res.bytes));
      UI.finishProgress('ok', '已保存 ' + res.name, UI.fmtBytes(res.bytes) + ' ｜ 整场完成');
      say('已保存 ' + res.name, 'success', UI.fmtBytes(res.bytes));
    }).catch(function (err) {
      cleanup();
      state.running = false;
      UI.setBtn('idle');
      var msg = (err && err.message) || String(err);
      dlog('下载中断：' + msg + (ctl.stalled ? '（停滞自检）' : ctl.aborted ? '（用户取消）' : ''));

      // ---- 删半成品（口径 C）----
      // 放行条件：句柄在手 + 下载前是新建/空文件（preSize === 0）+ 不是
      // 「未选保存位置」（那时文件压根没创建）。删除失败或老内核没有
      // remove() 都只影响文案（「已保留」），不许把主消息顶掉。
      var isNoTarget = /未选择保存位置/.test(msg);
      var deletable = savedHandle && preSize === 0 && !isNoTarget;
      return (deletable ? W.removeFile(savedHandle) : Promise.resolve(false))
        .catch(function () { return false; })
        .then(function (deleted) {
          // 停滞分支必须放在「已取消」之前：停滞时 ctl.aborted 也被置了 true
          if (ctl.stalled) {
            UI.finishProgress('bad', '下载停滞，已停止',
              '半成品' + (deleted ? '已删除' : '已保留到保存位置') + '；'
              + Math.round(STALL_MS / 1000) + ' 秒无进展，多为切到后台被挂起或网络中断；请重新下载');
            say('下载停滞，已自动停止', 'error', '',
              '回放下载超过 ' + Math.round(STALL_MS / 1000) + ' 秒无进展，已自动停止'
              + (deleted ? '并删除了半成品文件。' : '（半成品文件已保留在保存位置）。')
              + '常见原因：页面切到后台被浏览器省电挂起、或网络中断。请重新下载。');
          } else if (ctl.aborted || /已取消|aborted|AbortError/i.test(msg)) {
            UI.finishProgress('warn', '已取消', '半成品'
              + (deleted ? '已删除' : '已保留到保存位置，可手动删除'));
            say('已取消下载', 'warning', '', deleted
              ? '已取消下载，半成品文件已删除，磁盘不留垃圾。'
              : '已取消下载；当前内核不支持自动删除（或为覆盖保存），半成品文件已保留在保存位置，可手动删除。');
          } else if (isNoTarget) {
            UI.hideProgress();
            say('未选择保存位置，已取消', 'warning');
          } else {
            UI.finishProgress('bad', '下载失败',
              (deleted ? '半成品已删除；' : '') + msg);
            // 条上只留一句（e.message 有时是两三句，比如容器不支持那个），
            // 完整原因进盒子 —— 用户 2026-10-19：「报错的提示词太长了」
            say('下载失败：' + clip(msg, 22), 'error', '',
              '下载失败：' + msg + (deleted ? '（半成品文件已删除）' : ''));
          }
        });
    });
  }

  function fmtEta(sec) {
    var s = Math.round(sec);
    if (s >= 3600) return Math.floor(s / 3600) + ' 小时 ' + Math.floor((s % 3600) / 60) + ' 分';
    if (s >= 60) return Math.floor(s / 60) + ' 分 ' + (s % 60) + ' 秒';
    return s + ' 秒';
  }

  /** 真正写盘：按 plan 类型分流 */
  function doWrite(sink, plan, ctl, onProgress) {
    if (plan.type === 'mp4') {
      // 整场就是一个文件：流式读、边读边写
      var got = 0;
      var total = plan.bytes || 0;
      return NET.streamTo(plan.url, function (chunk) {
        if (ctl.aborted) throw new Error('已取消');
        return sink.write(chunk).then(function () {
          got += chunk.byteLength;
          onProgress(got, total || 0, got);
        });
      }, ctl.abortCtl ? ctl.abortCtl.signal : undefined).then(function (n) {
        onProgress(1, 1, n || got);
        return n || got;
      });
    }

    // HLS：按分片形态选「直通」还是「转封装」
    //
    // 直通有两类：
    //   · fMP4（有 EXT-X-MAP）—— 分片本身就是 mp4 段，直接拼；
    //   · TS + 非 H.264（典型 H.265，见 verdict 的注释）—— mux.js 只认 H.264，
    //     过它会把视频轨整条丢掉，只剩声音。所以字节直通、原样拼成 .ts，
    //     画质零损失，交给 PotPlayer / VLC / 剪映这类认得 HEVC 的播放器。
    // 只有「TS + H.264」才值得转封装：换来 Windows 双击能播的标准 MP4。
    var isFmp4 = !!plan.map;
    var passthrough = isFmp4 || !!plan.passthrough;
    var stream;
    try {
      stream = passthrough ? W.createMp4Stream(sink) : W.createTsStream(sink);
    } catch (e) {
      return Promise.reject(e);
    }

    var initP = Promise.resolve();
    if (isFmp4 && plan.map) {
      initP = fetchSegment({ url: plan.map.url, byterange: plan.map.byterange, seq: -1 }, plan, ctl)
        .then(function (buf) { return stream.init(buf); });
    }

    var n = plan.segments.length;
    var inflight = Object.create(null);
    var bytesWritten = 0;

    /* ---- 并发档位（自适应升降）----
     * 用户 2026-10-18：「下载好慢，能不能多线程加速」；
     * 2026-10-21 追加「实打实优化下载速度」—— 上限 6→10，爬档 12 片/次→6 片/次。
     *
     * 为什么上限能越过 6：
     *   旧注释「浏览器对同源并发连接的上限就是 6，再高只是排队」是 HTTP/1.1
     *   时代的规则；抖音 CDN 走 HTTP/2，单条连接多路复用，fetch 并发不再被 6
     *   封顶 —— 提到 10 是实打实多开请求抢带宽，不是排队假象。
     *
     * 升降策略仍是「从安全值起步、好了再往上探、撞了就立刻退」：
     *     · 起点仍是 3（已验证不触发限流）；
     *     · 连续 CONC_UP_AFTER 片都成功 ⇒ 试探 +1，最多到 CONC_MAX(10)；
     *     · 任一请求回 429 / 503 / 509 ⇒ 立刻 -1，并进入 CONC_COOLDOWN 冷却，
     *       冷却期内不许再升档 —— 免得「升一档、撞一次、再升」反复挠服务器。
     *   链路好的时候跑满 10 条，链路一紧自动收回来，不需要用户操心。
     */
    var conc = CONC_START;
    var okStreak = 0;
    var hitAt = 0;

    function onRateLimited() {
      hitAt = Date.now();
      okStreak = 0;
      if (conc > CONC_MIN) conc--;
    }

    function onSegmentOk() {
      okStreak++;
      if (okStreak < CONC_UP_AFTER) return;
      okStreak = 0;
      if (conc >= CONC_MAX) return;
      if (hitAt && Date.now() - hitAt < CONC_COOLDOWN) return;
      conc++;
    }

    /**
     * 取一片，带重试。
     *
     * 一场下来几百片，任何一片偶发 5xx / 连接重置都会让整场白下 ——
     * 对用户来说「慢」还不如「重来」疼。所以单片最多试 SEG_RETRY 次，
     * 退避 250 / 1000 / 2250 毫秒（attempt² × 250）。
     * 限定类状态码（429/503/509）另外触发降档。
     */
    function fetchOne(i) {
      var attempt = 0;
      function go() {
        return fetchSegment(plan.segments[i], plan, ctl).catch(function (err) {
          if (ctl.aborted) throw err;
          var st = err && err.status;
          if (st === 429 || st === 503 || st === 509) onRateLimited();
          if (attempt >= SEG_RETRY) throw err;
          attempt++;
          return sleep(250 * attempt * attempt).then(go);
        });
      }
      return go();
    }

    var nextFetch = 0;      // 下一个要发出的片号
    var writePtr = 0;       // 下一个要写入的片号
    var nInflight = 0;      // 请求未完成的片数（含重试中；已到手等写入的不算）

    /**
     * 取一片并登记进 inflight。两个与旧写法的关键差异：
     *   ① **失败不 delete 也不裸挂 rejection**：errback 把失败当场消化成
     *      {ok:false, e} 结构化结果存回 inflight[i] —— 失败片从「请求失败」
     *      到「writeLoop 按序推进到它」中间有个窗口（写入循环还在写前面的
     *      片），若挂裸 rejected promise，这段窗口无人认领，浏览器控制台会
     *      报 unhandledrejection。转成普通值后失败照样在写入循环里冒泡、
     *      打断下载，但全程没有无主 rejection。
     *   ② 成功也包成 {ok:true, v}，写入循环按统一结构消费。
     */
    function get(i) {
      if (inflight[i]) return inflight[i];
      nInflight++;
      inflight[i] = fetchOne(i).then(function (buf) {
        nInflight--;
        onSegmentOk();
        schedule();          // 一片到手腾出一个在飞名额（升档后也能立刻多补）
        return { ok: true, v: buf };
      }, function (err) {
        nInflight--;
        schedule();          // 失败同样腾名额；abort 后 schedule 自会闭嘴
        return { ok: false, e: err };
      });
      return inflight[i];
    }

    /* ---- 调度器：fetch 与写入解耦（2026-10-21 实打实提速）----
     * 旧写法 loop(i)：写完第 i 片才把窗口 [i, i+conc) 往前推 —— 写盘一慢
     * （FSA 磁盘 IO 与 mux.js 转封装都在主线程排队），窗口只出不进，
     * 在飞请求数一路掉到 0，带宽整段空转。读数上的表现就是「速度忽快忽慢」。
     *
     * 新写法把两件事拆开：
     *   · schedule() 只管发请求：在飞 < conc 且「已发出未消费」领先 writePtr
     *     不足 BUFFER_MAX 片（内存上限）。每当「任何一片到手 / 失败」或
     *     「写完一片」都补发 —— 网络只要还有名额就永远满载；
     *   · writeLoop(i) 只管按序消费：等 inflight[i] 到手 → 写 → 推进。
     *     写入多慢都不拖累取片。
     *
     * 失败如何冒泡：某片重试耗尽后 inflight[i] 是 rejected promise，
     * writeLoop 消费到它就整体 reject —— 取片失败一定会打断下载，
     * 不会因为解耦而被吞掉。
     */
    function schedule() {
      if (ctl.aborted) return;
      while (nextFetch < n && nextFetch - writePtr < BUFFER_MAX && nInflight < conc) {
        get(nextFetch++);
      }
    }

    function writeLoop(i) {
      if (ctl.aborted) return Promise.reject(new Error('已取消'));
      if (i >= n) return stream.end().then(function (b) { return b || bytesWritten; });
      return Promise.resolve(inflight[i]).then(function (r) {
        if (!r.ok) throw r.e;          // 失败片在这里冒泡打断整场下载
        return stream.write(r.v);
      }).then(function () {
        inflight[i] = null;
        writePtr = i + 1;
        bytesWritten = sink.bytes;
        onProgress(i + 1, n, bytesWritten, conc);
        schedule();          // 写完腾出缓冲名额，立刻补发
        return writeLoop(i + 1);
      });
    }

    return initP.then(function () { schedule(); return writeLoop(0); });
  }

  /* ==========================================================
   * 六、按钮点击 → 确认卡 → 下载
   * ========================================================== */

  /**
   * 无声音地「唤醒」一次播放器，让页面自己去请求回放清单。
   *
   * 【为什么需要这一步】
   *   用户 2026-10-18 的明确要求：不点开播放也能直接唤起下载。
   *   但清单只能从**页面自己发出的网络请求**里嗅到 —— 页面不播就不请求，
   *   我们再怎么找也找不到地址。所以这里替用户点一下：
   *   静音 → play() → 1.8 秒后暂停 → 还原播放进度与静音状态。
   *   对用户来说画面动一下、没有声音；换来的是「不点播放也能下」。
   *
   * @returns {Promise<boolean>} 是否真的唤醒过（没有 video / 已在播 → false）
   */
  function wakePlayer() {
    var v = UI.mainVideo();          // 复用界面层的「最大画面」判定，别再写一遍
    if (!v || !v.paused) return Promise.resolve(false);

    var wasMuted = v.muted;
    var at = v.currentTime || 0;
    var p;
    try {
      v.muted = true;
      p = v.play();
    } catch (e) {
      try { v.muted = wasMuted; } catch (e2) { /* 还原失败不影响主流程 */ }
      return Promise.resolve(false);
    }

    return Promise.resolve(p).then(function () {
      return new Promise(function (resolve) {
        setTimeout(function () {
          try { v.pause(); } catch (e) { /* 已销毁就算了 */ }
          try { if (at > 0.2) v.currentTime = at; } catch (e) { /* 直播流不可 seek */ }
          try { v.muted = wasMuted; } catch (e) { /* 同上 */ }
          resolve(true);
        }, 1800);
      });
    }).catch(function () {
      try { v.muted = wasMuted; } catch (e) { /* 忽略 */ }
      return Promise.resolve(false);
    });
  }

  function onDownloadClick() {
    if (state.running) {
      // 下载进行中，按钮的职责变成「详情开关」（2026-10-18 用户定：
      // 详情框整合进按钮，最小化形态就是按钮本身）—— 点一下开、再点一下收。
      // 不再提示「已有下载在进行」：那句话在旧版（卡片钉在右下角）才有意义，
      // 现在点按钮就是去看进度，不该被打断。
      if (UI.toggleProgress) UI.toggleProgress();
      return;
    }

    UI.setBtn('busy', '正在读取');
    UI.hideCard();
    dlog('点击下载按钮 · 页面=' + pageKind() + ' · ' + location.hostname + location.pathname);

    gather().then(buildSession).then(function (res) {
      if (res.plan || !res.noMedia) return res;
      // 一条媒体地址都没抓到 ⇒ 页面可能还没开始拉流。
      // 替用户静音播一下就自愈，省得他「先点播放、再回来点下载」。
      UI.setBtn('busy', '正在加载回放');
      return wakePlayer().then(function (woke) {
        if (!woke) return res;
        return gather().then(buildSession);
      });
    }).then(function (res) {
      UI.setBtn('idle');

      if (!res.plan) {
        UI.setBtn('dead', '未找到回放');
        say(res.reason || '没有找到可下载的回放', 'error', '', res.detail || '');
        return;
      }

      state.session = res;
      var st = META.sessionTime();
      var t = st.when;
      var expected = res.expected || res.plan.total || 0;

      UI.showCard({
        timeText: (t.y + '-' + pad2(t.m) + '-' + pad2(t.d) + ' ' + pad2(t.hh) + ':' + pad2(t.mm))
          + (st.fromPage ? '' : '（页面未显示开播时间，用今天日期）'),
        durationSec: expected || res.plan.total,
        bytes: res.bytes,
        segCount: res.plan.segments.length,
        qualityText: res.plan.quality + (res.plan.key && res.plan.key.method === 'AES-128' ? ' · 已加密，下载时解密' : ''),
        trackText: res.trackText || '',
        ext: res.ext || '.mp4',
        fileName: baseFileName(),
        warn: res.warn,
        warnBad: res.blocked,
        blocked: res.blocked
      }, function (name) {
        // 用户可能在输入框里改了名；最终以他的为准
        runDownload(res.plan, name, res.bytes);
      });
    }).catch(function (err) {
      UI.setBtn('idle');
      var errMsg = (err && err.message) || String(err);
      dlog('读取回放失败：' + errMsg);
      say('读取回放失败：' + clip(errMsg, 22), 'error', '', '读取回放失败：' + errMsg);
    });
  }

  /**
   * 诊断日志：进调试面板 + 诊断内核的报告。
   *
   * 2026-10-19 用户报「没法复制诊断结果」时才发现：回放模块**一条日志都没打**，
   * 即使面板能打开也全是空的，报告里没有证据 —— 等于白抓。
   * 这里只打「判定依据」：候选、选中哪条、轨道、覆盖率、起止与错误；
   * 每片进度只打整十百分比，避免把面板刷爆。
   */
  function dlog(msg) {
    try {
      if (typeof window.debugLog === 'function') window.debugLog('[回放] ' + msg);
    } catch (e) { /* 面板不在场就算了，日志不该影响下载 */ }
  }

  /** 日志里的地址去掉 query（token 之类既不安全也太长），只留尾部便于对号 */
  function shortUrl(u) {
    var s = String(u || '').split('?')[0];
    return s.length > 64 ? '…' + s.slice(-64) : s;
  }

  /**
   * 条上只留一句。
   *
   * 用户 2026-10-19：「报错的提示词太长了」—— 消息条在左下角只有一行宽，
   * 几十个字必然被截成「…」，还不如一开始就短。所以进条的一律压到一句，
   * 完整原因走第 4 个参数进消息盒子（盒子里每条有 6 行可用）。
   * @param {string} s
   * @param {number} n 上限字数（含省略号）
   */
  function clip(s, n) {
    var t = String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
    return t.length > n ? t.slice(0, n - 1) + '…' : t;
  }

  /**
   * 提示：条上短文案、盒子存全文，两处都按三段式（来源 ｜ 值 ｜ 结果数）。
   *
   * UI.say 会优先调 dialog.js 的 setStatus —— 回放页的 manifest 已带
   * dialog.js + msgbox.css，用的是同一套消息盒子；只有 setStatus 不在场时
   * 才退回 UI 自渲染的轻提示。
   * ⚠️ 旧注释说「回放页没 style.css，调 setStatus 会变成裸文字」，那是
   *    2026-10-18 拆文件之前的事，别按旧结论改回自渲染。
   *
   * @param {string} text 条上的短文案
   * @param {string} type
   * @param {string} [count] 三段式结果数
   * @param {string} [full] 进消息盒子的完整文案（不传就与 text 相同）
   */
  function say(text, type, count, full) {
    UI.say(text, type, { source: '回放下载', count: count || '', full: full || '' });
  }

  /* ==========================================================
   * 七、启动 / 停用
   * ========================================================== */

  var observer = null;
  var remountTimer = null;

  /** 按钮壳是否还在页面上（SPA 切场次时会被平台连播放器一起重建掉） */
  function hostAlive() {
    var el = document.getElementById('dyc-replay-host');
    return !!(el && document.contains(el));
  }

  function attach() {
    UI.mount();
    UI.setBtn(state.running ? 'busy' : 'idle', state.running ? '下载中' : undefined);
    UI.onBtnClick(onDownloadClick);
    // 平台切页 / 换场次会把按钮壳连进度卡一起拆掉重建。下载还在跑时必须把
    // 详情卡静默重建（收起态、内容骨架齐全），否则点按钮 toggleProgress
    // 打开的是一张空卡甚至毫无反应 —— 用户 2026-10-21 实测「切到顶栏其他
    // 分页，回来按钮点不开、不知道有没有在运行」正是这条链。
    // 数据不用手填：onProgress 每片都回调，下一次回调就把新卡填到当前进度。
    if (state.running && state.dlName && typeof UI.showProgress === 'function') {
      UI.showProgress(state.dlName, { silent: true });
    }
  }

  /** 上一次 tick 见到的路由：用于「切走又没被拦住」时补一句状态（初值 null = 尚未记录） */
  var lastRoute = null;

  /** 轮询体：每 2 秒对一次「现在该不该有按钮 / 按钮还在不在」 */
  function tick() {
    // 路由对比：guard 的顶栏 confirm 拦不住的切页（键盘快捷键 / 平台绕开
    // 事件系统）会走到这里 —— 下载还在跑就报一句，用户不用切回复盘页才知道。
    // lastRoute 为 null（首次）只记录不报；confirm 拦成功时路由没变，也不会报。
    var routeNow = location.href;
    if (state.running && lastRoute !== null && routeNow !== lastRoute) {
      say('已切换页面，下载仍在进行', 'info', '勿关此页');
    }
    lastRoute = routeNow;

    if (!enabled()) {
      if (hostAlive()) UI.unmount();
      syncStatusBar(false);
      return;
    }
    syncStatusBar(true);
    if (!hostAlive()) attach();
    // host 在、但播放器可能刚渲染出来 / 刚换场次 ⇒ 顺手重算一次落点，
    // 否则按钮会停在上一次的位置（比如一直贴在视口兜底位）。
    else if (typeof UI.positionHost === 'function') UI.positionHost();
  }

  /**
   * 支持页的消息与调试入口常驻；回放模块只控制自己的下载按钮。
   */
  function syncStatusBar(on) {
    if (on || (typeof dycIsSupportedPage === 'function' && dycIsSupportedPage(location.href))) {
      if (document.getElementById('dyb-status-bar')) return;
      if (document.body && typeof ensureStatusBar === 'function') {
        try { ensureStatusBar(); } catch (e) { /* 尽力而为 */ }
      }
      return;
    }
    var bar = document.getElementById('dyb-status-bar');
    if (bar && bar.parentNode) bar.parentNode.removeChild(bar);
  }

  /* ---------- SPA 路由切换：立刻对一次，不等那 2 秒 ----------
   * 这套后台切页不触发任何导航事件，只调 history.pushState / replaceState。
   * 2 秒轮询是兜底；但用户点一下顶部按钮，按钮就该「立刻」出来，
   * 所以把两个 history 方法包一层，切完就催一拍（80ms 去抖，等页面渲染完）。
   * 只包一次：`__dycReplayHooked` 防重复注入时叠加。
   */
  var routeTimer = 0;

  function scheduleTick() {
    if (routeTimer) return;
    routeTimer = setTimeout(function () { routeTimer = 0; tick(); }, 80);
  }

  function hookRoute() {
    // 整体 try 包住：history / addEventListener 都是「有最好、没有也不致命」的
    // 加速手段，真拿不到就只靠 2s 轮询，功能不能因此挂掉。
    try {
      ['pushState', 'replaceState'].forEach(function (k) {
        var orig = history[k];
        if (typeof orig !== 'function' || orig.__dycReplayHooked) return;
        var wrapped = function () {
          var r = orig.apply(this, arguments);
          scheduleTick();
          return r;
        };
        wrapped.__dycReplayHooked = true;
        try { history[k] = wrapped; } catch (e) { /* history 被冻结 */ }
      });
      window.addEventListener('popstate', scheduleTick);
      window.addEventListener('hashchange', scheduleTick);
    } catch (e) {
      /* 环境不支持：轮询兜底 */
    }
  }

  /**
   * 建轮询（幂等）。
   *
   * ⚠️ **必须无条件建**，不能只在「此刻生效」时建 —— 这是 2026-10-18 用户
   * 反馈「第一次进入这个页面不会出现下载按钮」的根因：
   *   直播服务平台是 SPA，先进门户/列表再点进回放；首帧那一刻页面上还没有
   *   video，`pageKind()` 判不出来 ⇒ enabled() 为 false ⇒ 旧代码直接不 start()
   *   ⇒ 轮询压根没建 ⇒ 等播放器真渲染出来时，没有任何东西会去补挂按钮。
   *   只有刷新一次、赶上 video 已存在的时机，按钮才出现 —— 正是用户描述的
   *   「第一次进入没有、刷新才有」。
   *
   * 用低频轮询（2s）而不是 MutationObserver：页面 DOM 变动太频繁，
   * observer 回调里做查询是明确的性能反模式（perf-check R8），
   * 而这里只需要「按钮还在不在」，2 秒粒度完全够。
   */
  function ensurePoll() {
    if (remountTimer) return;
    remountTimer = setInterval(tick, 2000);
  }

  function start() {
    ensurePoll();
    hookRoute();
    tick();
  }

  function stop() {
    if (remountTimer) { clearInterval(remountTimer); remountTimer = null; }
    if (observer) { observer.disconnect(); observer = null; }
    UI.unmount();
  }

  var prevOn = null;    // 上一次的「生效与否」；null = 还没读到初始态

  /* 「上次下载未完成」回执：真导航（刷新 / 跳转）会杀掉页面里的下载，
   * 但 sessionStorage 的 BUSY_KEY 标记来不及清 —— 回来时据此报一句，
   * 不然用户只看到一枚安静的按钮，根本不知道刚才的下载已经白下了。
   * 标记在下载收尾（成功 / 失败 / 取消）时都会被清掉，只有「页面死了」
   * 这种来不及收尾的情况才会留到这里。延迟 1.2s 是等消息盒子建好。 */
  (function () {
    try {
      var unfinished = sessionStorage.getItem(BUSY_KEY);
      if (unfinished) {
        sessionStorage.removeItem(BUSY_KEY);
        setTimeout(function () {
          say('上次下载未完成：' + clip(unfinished, 14), 'warning', '',
            '上一次的回放下载（' + unfinished + '）没有完成 —— 页面刷新或跳转会导致下载中断。请重新下载。');
        }, 1200);
      }
    } catch (e) { /* sessionStorage 不可用（隐私模式等）就跳过 */ }
  })();

  dycReadFlags().then(function (f) {
    flags = f;
    var on = enabled();
    // 初始态在这里记下来：否则 prevOn 一直是 null，页面加载后**第一次**
    // 拨开关会被当成「首次读」而静默（回声被吃掉，用户以为没生效）。
    if (prevOn === null) prevOn = on;
    // 建轮询这件事与 on 无关（理由见 ensurePoll 的长注释），tick 自己会判。
    start();
  });

  dycWatchFlags(function (f) {
    flags = f;
    var now = enabled();
    if (prevOn === null) { prevOn = now; if (now) start(); return; }
    if (now === prevOn) return;
    prevOn = now;
    // 先出声再停用：stop() 会把提示壳一起摘掉，反了就没了落点
    if (now) { start(); UI.say('已开启', 'info', { source: '回放下载' }); }
    else { UI.say('已关闭', 'info', { source: '回放下载' }); stop(); }
  });

  // 首屏兜底：文档解析 / 播放器渲染都可能比脚本慢，多敲几次「现在该挂了吗」。
  // 轮询已是主力，这里只补前面几百毫秒的空窗，让按钮尽早出现。
  [200, 600, 1200, 3600].forEach(function (ms) {
    setTimeout(tick, ms);
  });

  /* 离线自测钩子（生产路径不受影响）。
   * 并发自适应、单片重试、进度口径这三件事全在 doWrite 的闭包里，
   * 不导出就只能靠真机观察 —— 而这三处恰恰最容易悄悄改坏。
   * 只有自测脚本会先注入 window.__DYC_REPLAY_DEBUG__ 再加载本文件。 */
  if (window.__DYC_REPLAY_DEBUG__) {
    window.__DYC_REPLAY_TEST__ = {
      doWrite: doWrite,
      runDownload: runDownload,
      fetchSegment: fetchSegment,
      pageKind: pageKind,
      enabled: enabled,
      // 轨道探测与选流（2026-10-18 加：用户下到没画面的文件后要能离线自证）
      probeContainer: probeContainer,
      tsTracks: tsTracks,
      fmp4Tracks: fmp4Tracks,
      verdict: verdict,
      trackText: trackText,
      looksAudioUrl: looksAudioUrl,
      evaluate: evaluate,
      pickBest: pickBest,
      choosePlayable: choosePlayable
    };
  }
})();
