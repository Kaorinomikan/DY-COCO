/**
 * 抖音可可助手 · 更新源访问层（主源 Gitee + 备用源 GitHub）
 * ============================================================
 *
 * 背景（换人接手先看这段）：
 *   浏览器扩展（MV3）无法给自己的更新服务端签名，也上不了应用商店，
 *   所以本项目的"更新"完全由扩展自己完成，数据源就是**代码托管仓库的
 *   版本标签**（git tag `vYY.MM.DD.N`）。本文件是所有访问更新源的代码的
 *   唯一出口，后台 SW 与更新页共用，避免两处各写一套导致行为漂移。
 *
 * ⚠️ 2026-11-01 重大变更：主源 Gitee 被封，改双源架构
 * ──────────────────────────────────────────────────────────
 *   Gitee 于 2026-11-01 屏蔽了本账号（远端返回
 *   `This account has been blocked or destroyed`），仓库首页 404、
 *   /tags.atom 404、raw 通道 403 —— **原单源链路整体失效**，
 *   商家点「检查更新」会一直失败。
 *
 *   现在是**双源**：
 *     · 主源 Gitee —— 逻辑、优先级、行为与原来完全一致，**代码不动**；
 *       万一日后账号解封，自动回到原路径，无需任何改动。
 *     · 备用源 GitHub —— 主源任何一步失败时自动接管。
 *
 *   ★ 为什么备用源不是简单的「换域名」，而是三套不同读法
 *     （这一段是本文件最关键的设计，别随手改）：
 *
 *     本机实测（2026-11-01，Windows + 360 极速 X 同款网络）：
 *
 *       端点                              可达    用途
 *       ────────────────────────────────────────────────────
 *       gitee.com                          ✅     主源（本文件原有链路）
 *       api.github.com                     ✅     GitHub API（读单文件）
 *       codeload.github.com                ✅     GitHub 整包 tarball
 *       data.jsdelivr.com                  ✅     jsDelivr 数据 API（列版本）
 *       fastly/gcore.jsdelivr.net          ✅     jsDelivr CDN（直出部分类型）
 *       cdn.jsdelivr.net                   ❌/✅   本机不通；别的网络可能通 ⇒ 轮换兜底
 *       github.com                         ❌     TCP 443 不通
 *       raw.githubusercontent.com            ❌     TLS 被重置
 *
 *     ★ 同一时刻同一台机器上 jsDelivr 各子域可达性就不同（cdn 不通而
 *       fastly/gcore 通），且会随网络变化 —— 所以 CDN 读文件按
 *       fastly → gcore → cdn 轮换，全挂才降级 GitHub API。
 *
 *     于是备用源按用途分流，各取所长：
 *
 *     ① **检测最新版本** → `data.jsdelivr.com/v1/packages/gh/<owner>/<repo>`
 *        返回 versions 列表（实测与 GitHub 标签一致，仅少一个 `v` 前缀）。
 *        无配额、单次请求。不用 `api.github.com/repos/.../tags` 是因为
 *        那个要消耗匿名配额（60 次/小时），留给读文件用更值。
 *
 *     ② **读清单 / 说明文档**（update-manifest.json、RELEASE_NOTES.md）
 *        → `api.github.com/repos/.../contents/<path>?ref=<tag>`
 *        实测 base64 返回、全类型可用（.md/.html/.png 都行）。
 *        一次更新只需 2 次调用，配额压力可忽略。
 *
 *     ③ **下载扩展本体**（72 个文件、约 2.5 MB）
 *        → `api.github.com/repos/.../contents/<path>?ref=<tag>` 逐文件读。
 *
 *     ★ 为什么下载不用 jsDelivr CDN：实测 jsDelivr 的 CDN 只对
 *       **.js / .json** 直出 200，**.md / .html / .png / .css 一律 301
 *       跳到 raw.githubusercontent.com**（本机不可达 → 000）。
 *       本工程扩展本体含 4 个 .html、3 个 .png、4 个 .css，
 *       走 jsDelivr 必然断在半路，所以只把它当"检测版本"用。
 *
 *     ★ 为什么下载不用 codeload tarball 整包：虽然实测 tarball 可用
 *       （200、含全部类型文件、一次请求拿全量），但**扩展端没有可靠的
 *       gzip 解压能力**（360 老内核的 DecompressionStream 不保证可用），
 *       解 tar 还要处理 512 字节头与「剥掉第一层目录名」，
 *       复杂度与风险都高于逐文件读。
 *       ⇒ tarball 只用于**本机发版校验与灾备取包**，
 *         不进扩展运行时。
 *
 *     ★ 为什么下载不用 API contents 的批量替代：72 个文件就是 72 次调用，
 *       匿名配额 60 次/小时 —— **必然中途 403**，更新直接失败。
 *       所以下载必须**只读清单里真正需要的文件**，且在配额耗尽时
 *       给出人话提示（见 fetchRawFile 的 403 分支），而不是笼统的"下载失败"。
 *
 * 【为什么备用源不改变主源行为】
 *   所有对外 API 的签名与语义保持不变（fetchLatestTag / fetchUpdateManifest /
 *   fetchRawFile / rawUrl / WEB …）。调用方（service-worker.js、update.js、
 *   popup.js）**一行都不用改**。源的选择发生在本文件内部。
 *
 * 挂载方式：把接口挂到 globalThis.DYC_GITEE。
 *   - 后台 SW（经典 worker）用 importScripts 加载
 *   - 页面用 <script src> 加载
 *   两种上下文都能取到，不需要构建步骤。
 */
(function (root) {
  'use strict';

  /* ==================== 主源：Gitee（原样保留） ==================== */

  var OWNER = 'lyrical-adagio';
  var REPO = 'DY-COCO';
  var API = 'https://gitee.com/api/v5/repos/' + OWNER + '/' + REPO;
  var WEB = 'https://gitee.com/' + OWNER + '/' + REPO;
  var RAW = WEB + '/raw/';

  /* ==================== 备用源：GitHub ==================== */

  // 备用源的仓库坐标。默认与 Gitee 同名同主，改这里即可切换镜像仓库。
  // ★ 2026-11-01：备用源坐标必须指向**真实存在**的 GitHub 仓库，
  //   否则备用源恒 404（比主源失败还糟 —— 商家完全收不到更新）。
  //   这里是用户的 GitHub 账号 Kaorinomikan 与仓库名 DY-COCO。
  //   改 GitHub 账号名或仓库名时，**只改这两行**。
  var GH_OWNER = 'Kaorinomikan';
  var GH_REPO = 'DY-COCO';

  var GH_API = 'https://api.github.com/repos/' + GH_OWNER + '/' + GH_REPO;
  var GH_WEB = 'https://github.com/' + GH_OWNER + '/' + GH_REPO;
  var GH_CODELOAD = 'https://codeload.github.com/' + GH_OWNER + '/' + GH_REPO;
  var GH_JSDELIVR_DATA = 'https://data.jsdelivr.com/v1/packages/gh/'
    + GH_OWNER + '/' + GH_REPO;

  /**
   * 「查看全部版本」给用户点的网页地址。
   *
   * ★ 2026-11-01：原值是 Gitee 的 /tags，但 Gitee 仓库已随账号被封而 404，
   *   点进去是个死链。现改指 GitHub 镜像页。
   *   若日后 Gitee 解封且仓库恢复，把这里换回 WEB + '/tags' 即可。
   */
  var TAGS_PAGE = GH_WEB + '/tags';

  // 更新清单文件名。改这里必须同步改 scripts/make-update-manifest.py 的 OUT_NAME。
  var MANIFEST_FILE = 'update-manifest.json';

  // 单文件上限：防清单被改动或仓库里误放大文件时把内存撑爆。
  // 本工程最大的文件约 67 KB，4 MB 是很宽裕的天花板。
  var MAX_FILE_BYTES = 4 * 1024 * 1024;

  /* ==================== fetch 超时包装（2026-11-01 体检 P0-3） ====================
   *
   * 轮换链（fastly→gcore→cdn→API）的设计假设「失败是快速的」；任一主机
   * TCP 黑洞（连接挂起不返回）时裸 fetch 永不 settle ⇒ Promise.all 卡死，
   * 检测/下载永久停在半路。所以所有更新源请求一律走这里。
   *
   * ★ 2026-11-06 下调下载超时 120s → 30s
   *   本工程最大文件约 67 KB，120 秒对应 0.6KB/s 都算「正常」，等于把
   *   「慢」和「死」混为一谈 —— 一个挂死的请求能把一个 worker 占住两分钟，
   *   叠 3 次重试单文件要 6 分钟。30 秒对应 ≥2.2KB/s，仍是极宽松的门槛，
   *   但能把死连接快速判出去、立刻换备用源。
   *   若将来有超过 100KB 的文件，按 size 动态放宽（见 fetchRawFile）。
   */
  var FETCH_TIMEOUT_DETECT = 10000;
  var FETCH_TIMEOUT_DOWNLOAD = 30000;

  /** 按文件大小给下载超时：小文件 30 秒，大文件按 ≥50KB/s 放宽。 */
  function downloadTimeoutFor(size) {
    var n = Number(size);
    if (!isFinite(n) || n <= 0) return FETCH_TIMEOUT_DOWNLOAD;
    return Math.max(FETCH_TIMEOUT_DOWNLOAD, Math.round(n / 50) * 1000);
  }

  /* ==================== 更新源健康状态（2026-11-06） ====================
   *
   * 两段独立的健康记忆，解决「一次坏链路拖垮整批下载」：
   *
   *   ① 主源熔断：连续失败达到阈值 ⇒ 本批后续文件不再先试主源，直接走
   *      备用源；冷却期后自动恢复重试主源。
   *      修的是「78 个文件各自白等一次主源超时」——主源整体不可用时，
   *      原实现会做 78 次无效等待。
   *
   *   ② CDN 主机记忆：可用主机序号写进 chrome.storage.local，下次更新
   *      （包括浏览器重启后）直接从它开始，不再从不可达的主机撞起。
   *      原实现的记录只在内存，重启即归零。
   *
   * 为什么可以持久化：商家网络环境是稳定的，「上次哪台 CDN 能用」对下次
   * 仍然成立；即便判断错了，最坏也只是多失败一次、自动换下一台。
   *
   * 无扩展环境（自测脚本 node）没有 chrome.storage ⇒ 自动退回内存语义。
   */
  var HEALTH_KEY = 'dycUpdateHealth';
  var MAIN_TRIP_AFTER = 2;                 // 连续失败几次判死主源
  var MAIN_COOLDOWN_MS = 30 * 60 * 1000;   // 熔断冷却 30 分钟后自动重试主源
  var mainFailStreak = 0;
  var mainDownUntil = 0;
  var cdnHealthyIdx = 0;
  var cdnProbe = null;                     // 进行中的预热，避免并发重复探
  var healthLoaded = false;

  function healthStore() {
    try {
      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        return chrome.storage.local;
      }
    } catch (e) { /* 走内存 */ }
    return null;
  }

  /** 读持久化的健康状态。只在首次真正读存储，之后同步返回。 */
  function loadHealth() {
    if (healthLoaded) return Promise.resolve();
    healthLoaded = true;
    var st = healthStore();
    if (!st) return Promise.resolve();
    return Promise.resolve(st.get(HEALTH_KEY)).then(function (got) {
      var v = got && got[HEALTH_KEY];
      if (!v || typeof v !== 'object') return;
      if (typeof v.cdnIdx === 'number' && v.cdnIdx >= 0 && v.cdnIdx <= 2) {
        cdnHealthyIdx = v.cdnIdx;
      }
      if (typeof v.mainDownUntil === 'number' && v.mainDownUntil > Date.now()) {
        mainDownUntil = v.mainDownUntil;
      }
    }, function () { /* 读不到就当没有 */ });
  }

  function saveHealth() {
    var st = healthStore();
    if (!st) return;
    var rec = { cdnIdx: cdnHealthyIdx, mainDownUntil: mainDownUntil };
    var payload = {};
    payload[HEALTH_KEY] = rec;
    try {
      Promise.resolve(st.set(payload)).catch(function () { /* 配额异常忽略 */ });
    } catch (e) { /* 写失败只影响下次要不要多试一台，不影响本次 */ }
  }

  /** 主源当前是否可用（熔断期内为 false）。 */
  function mainSourceUsable() {
    return Date.now() >= mainDownUntil;
  }

  /**
   * 记录一次主源结果。
   * ok=true 立即清零并解除熔断；ok=false 累计，达阈值进入冷却。
   * ⚠️ 调用方不要拿「该版本在主源不存在（404）」来记失败 —— 那是内容缺失，
   *    不是主源不可用，记进去会误伤正常的主源。
   */
  function noteMainSource(ok) {
    if (ok) {
      if (mainFailStreak !== 0 || mainDownUntil !== 0) {
        mainFailStreak = 0;
        mainDownUntil = 0;
        saveHealth();
      }
      return;
    }
    mainFailStreak++;
    if (mainFailStreak >= MAIN_TRIP_AFTER && !mainDownUntil) {
      mainDownUntil = Date.now() + MAIN_COOLDOWN_MS;
      saveHealth();
    }
  }

  function fetchT(url, opts, ms) {
    var o = opts || {};
    var timedOut = false;
    if (typeof AbortController === 'function') {
      var ctrl = new AbortController();
      o.signal = ctrl.signal;
      setTimeout(function () {
        timedOut = true;
        try { ctrl.abort(); } catch (e) { /* 极老内核 abort 可能不支持 */ }
      }, ms);
    }
    return fetch(url, o).catch(function (e) {
      if (timedOut || (e && e.name === 'AbortError')) {
        throw new Error('更新源连接超时（' + Math.round(ms / 1000) + ' 秒无响应）：' + url);
      }
      throw e;
    });
    // 注：成功路径不清计时器 —— 到点后对已完成请求 abort 是无害 no-op，
    // 而保留它能在「headers 已到、body 慢死」时继续兑底（流式
    // reader.read 会随 signal 一起中止）。
  }

  /**
   * 版本号解析：把 "26.10.10.1" / "v26.10.10.1" 解析成 [26,10,10,1]
   *
   * ⚠️ 绝对不能拿版本号字符串直接比大小。
   *    字符串比较下 "26.10.9.1" > "26.10.10.1"，会漏掉真正的更新。
   *    必须逐段转整数比较。
   */
  function parseVersion(v) {
    return String(v == null ? '' : v)
      .trim()
      .replace(/^v/i, '')
      .split('.')
      .map(function (s) { return parseInt(s, 10) || 0; });
  }

  /** 逐段整数比较：a<b 返回 -1，a>b 返回 1，相等返回 0 */
  function compareVersion(a, b) {
    var A = parseVersion(a);
    var B = parseVersion(b);
    var n = Math.max(A.length, B.length);
    for (var i = 0; i < n; i++) {
      var x = A[i] || 0;
      var y = B[i] || 0;
      if (x !== y) return x < y ? -1 : 1;
    }
    return 0;
  }

  /** tag -> 版本号：v26.10.10.1 -> 26.10.10.1 */
  function tagToVersion(tag) {
    return String(tag == null ? '' : tag).trim().replace(/^v/i, '');
  }

  /** 版本号 -> tag：26.10.10.1 -> v26.10.10.1 */
  function versionToTag(ver) {
    return 'v' + String(ver == null ? '' : ver).trim().replace(/^v/i, '');
  }

  /** 是否为合法的版本标签（只认 v1 / v1.2 / v26.10.10.1 这类纯数字点分形式） */
  function isVersionTag(name) {
    return /^v?\d+(\.\d+)*$/.test(String(name == null ? '' : name).trim());
  }

  /* ==================== 通道 3：API（仅检测兜底） ==================== */

  function apiFetch(path) {
    return fetchT(API + path, {
      headers: { Accept: 'application/json' },
      cache: 'no-store'
    }, FETCH_TIMEOUT_DETECT).then(function (res) {
      if (res.status === 403) {
        // Gitee 未登录调用限 60 次/小时，超出返回 403 且响应体是
        // "Rate Limit Exceeded"。给一句人话，别把状态码直接甩给商家。
        throw new Error('Gitee 接口访问太频繁被限流了（403），过一会儿再试即可');
      }
      if (!res.ok) {
        throw new Error('Gitee 接口返回 ' + res.status + '（' + path + '）');
      }
      return res.json();
    });
  }

  /** 从 tags 列表里挑最大的版本标签；找不到就抛错 */
  function pickMaxVersionTag(list) {
    if (!Array.isArray(list) || !list.length) {
      throw new Error('仓库还没有任何标签，无法判断版本');
    }
    var best = null;
    for (var i = 0; i < list.length; i++) {
      var name = String(list[i] && list[i].name || '').trim();
      if (!isVersionTag(name)) continue; // 跳过非版本标签（如临时标记）
      if (best === null || compareVersion(tagToVersion(name), tagToVersion(best)) > 0) {
        best = name;
      }
    }
    if (best === null) throw new Error('未找到符合 YY.MM.DD.N 的版本标签');
    return best;
  }

  /**
   * 【检测·降级通道】API 取标签列表。
   *
   * 只在网页通道失败时才走这里（未登录时受 60 次/小时限流，不可作常规路径）。
   * 保留它的意义：万一 Release 被删、或网页路由改版，检测不会彻底失灵。
   * 用 tags 列表取最大值而不是 releases/latest，是为了兼容"只打 tag 不建
   * Release"的情况（per_page=100 避开默认分页漏掉最新标签）。
   */
  function fetchLatestTagFromApi() {
    return apiFetch('/tags?per_page=100').then(pickMaxVersionTag);
  }

  /* ==================== 通道 1：网页（检测主通道） ==================== */

  /**
   * 【检测·主通道】读仓库的标签订阅源 /tags.atom 取最新版本标签。
   *
   * ── 为什么把主通道从 /releases/latest 换成它（26.10.10.7 的事故）──
   *   Gitee 上「git 标签」与「发行版（Release）」是两样独立的东西。
   *   /releases/latest 只跟着**发行版**走：只推标签、没建发行版时，那里
   *   根本没有这个版本。实测同一个仓库（2026-10-10）：
   *       /releases 页面      → 只有 4 个版本（v26.10.10.3/.4/.5/.6）
   *       /tags.atom          → 有 9 个（多出的正是 5 个没有发行版的标签）
   *
   *   于是只要出现「标签推成功、发行版没建成」的半发布状态，扩展就永远
   *   看不到新版本：本地状态里的 latestTag 一直停在旧值，真机表现是
   *   「检查更新像在读旧缓存」「明明有新版，它还是只想更新上一次那个」。
   *   而 publish.sh 恰好是**先推标签、最后才建发行版**这个顺序，
   *   历史上 Gitee 403 限流那次就卡在最后一步 —— 不是理论担忧。
   *
   * ── 为什么能用它 ──
   *   Atom 订阅源属于网页通道，不参与 /api/v5 的匿名限流。
   *   实测匿名可取：200、application/atom+xml、约 18 KB、含全部标签。
   *
   * ── 解析策略 ──
   *   不依赖条目顺序（那是按打标签时间排的，不是按版本号排的），
   *   把全部 <title>vX.Y.Z</title> 抠出来，逐条 compareVersion 取最大值。
   *   只认纯数字点分形式，feed 自身标题（"Releases&Tags from …"）自动跳过。
   *
   * ── 为什么带 ?t= 时间戳 ──
   *   标签内容虽是 git 对象寻址、不可变，但「最新是哪一个」会变。
   *   带一个每次不同的查询串，即使某一层（CDN / 浏览器 / 中间层）缓存了
   *   这份 feed，换了 key 也必然回源，绝不让检测结果卡在旧值上。
   */
  function fetchLatestTagFromTagsFeed() {
    return fetchT(WEB + '/tags.atom?t=' + Date.now(), {
      redirect: 'follow',
      cache: 'no-store'
    }, FETCH_TIMEOUT_DETECT).then(function (res) {
      if (!res.ok) throw new Error('读取标签列表失败（HTTP ' + res.status + '）');
      return res.text();
    }).then(function (xml) {
      var re = /<title>\s*(v?\d+(?:\.\d+)*)\s*<\/title>/gi;
      var best = null;
      var m;
      while ((m = re.exec(xml)) !== null) {
        var name = m[1].trim();
        if (!isVersionTag(name)) continue;
        if (best === null ||
            compareVersion(tagToVersion(name), tagToVersion(best)) > 0) {
          best = name;
        }
      }
      if (best === null) {
        throw new Error('标签列表里没有符合 YY.MM.DD.N 的版本标签');
      }
      return best;
    });
  }

  /**
   * 【检测·兜底通道】从「最新发行版」网页取标签 —— 不走 /api/v5，不受匿名限流。
   *
   * ⚠️ 它**只反映发行版**，看不到「只有标签、没有发行版」的版本，
   *    所以 26.10.10.7 起降级为兜底：仅在 /tags.atom 取不到时才走这里。
   *
   * 原理：/releases/latest 是网页路由，会 302 到 /releases/tag/<tag>。
   *   跟随重定向后读 res.url 就能拿到标签 —— 落点仍在 gitee.com 同域内，
   *   不涉及跨域，host_permissions 已有 https://gitee.com/*，无需再改。
   *
   * ⚠️ 必须用 HEAD，不能用 GET：
   *   实测 GET /releases/latest 会因内容协商被导到源码归档
   *   （repository/blazearchive/<tag>.zip），而那个归档 URL 带
   *   Expires/Signature 签名，没法自己拼，用 HEAD 就不会真去下归档。
   *
   * ⚠️ 落点有两种，解析必须两者都认（都是实测到的）：
   *     a) .../releases/tag/v26.10.10.3                     ← curl 停在这里
   *     b) .../repository/blazearchive/v26.10.10.3.tar.gz   ← 某些客户端被导去归档
   *   落点取决于对方服务器对请求头的内容协商，不可控；但两种 URL 里
   *   都带着版本号，所以直接从最终 URL 宽松抠出来即可，别写死单一形式。
   *
   * ⚠️ 前置条件：仓库得存在 Release（本项目 publish.sh 每版都会建）。
   *   若哪天 Release 被删，这里拿不到标签会自动降级回 API。
   */
  function fetchLatestTagFromWeb() {
    return fetchT(WEB + '/releases/latest', {
      method: 'HEAD',
      redirect: 'follow',
      cache: 'no-store'
    }, FETCH_TIMEOUT_DETECT).then(function (res) {
      var m = /(?:releases\/tag|blazearchive)\/(v?\d+(?:\.\d+)+)/i.exec(res.url || '');
      if (!m) throw new Error('未从最新发行版的跳转地址里解析出版本标签');
      var tag = decodeURIComponent(m[1]).trim();
      if (!isVersionTag(tag)) throw new Error('最新发行版标签格式不认识：' + tag);
      return tag;
    });
  }

  /* ==================== 备用源：GitHub ==================== */

  /* 注：CDN 健康主机序号 cdnHealthyIdx 已上移到文件开头的「更新源健康状态」块，
   * 因为主源熔断与它同属一份持久化记录（2026-11-06）。 */

  /**
   * jsDelivr 的三台 CDN 主机（按首选顺序）。
   * 抽成函数是为了让「读文件」与「下载前预热」用完全相同的顺序，
   * 两处各写一份必然漂移。
   */
  function cdnHosts(c) {
    return [
      c.jsdelivrCdn,
      'https://gcore.jsdelivr.net/gh/' + c.owner + '/' + c.repo,
      'https://cdn.jsdelivr.net/gh/' + c.owner + '/' + c.repo
    ];
  }

  /**
   * 【下载前预热】并行探三台 CDN，选出可用的一台并持久记住。
   *
   * 为什么需要：原实现「每个文件各自从首选主机开始试」。三台里有任何一台
   * 是 TCP 黑洞时，一批 78 个文件要付出 78 次主机超时；并发 6 也只能把
   * 前 6 个分摊掉。预热把这份代价压成整批一次（最多 4 秒）。
   *
   * 语义：并发探测、谁先成功用谁；全部不可用返回 -1，交给 contents API。
   * 失败不缓存 —— 下次下载会重新探。
   *
   * @returns {Promise<number>} 0/1/2 = 可用主机序号；-1 = 全部不可用
   */
  function warmUpCdn(tag, owner, repo) {
    if (cdnProbe) return cdnProbe;
    var c = ghCoord(owner, repo);
    var t = encodeURIComponent(String(tag == null ? '' : tag).trim());
    if (!t) return Promise.resolve(cdnHealthyIdx);

    var hosts = cdnHosts(c);
    var PROBE_MS = 4000;
    cdnProbe = loadHealth().then(function () {
      return new Promise(function (resolve) {
        var pending = hosts.length;
        var winner = -1;
        var settled = false;
        hosts.forEach(function (base, k) {
          fetchT(base + '@' + t + '/' + MANIFEST_FILE, {
            redirect: 'follow',
            cache: 'no-store'
          }, PROBE_MS)
            .then(function (res) {
              if (!res.ok) throw new Error('预热探测 HTTP ' + res.status);
              // 读完响应体，确保是真能取到内容（不是只通了 TCP）
              return res.arrayBuffer();
            })
            .then(function (buf) {
              if (settled && winner >= 0) return;
              if (!buf || !buf.byteLength) return;
              winner = k;
              cdnHealthyIdx = k;
              saveHealth();
              // ★ 首个成功即返回：三台的可达性会随网络/时刻变化（实测同一台
              //   机器上 fastly 与 gcore 会轮流不通），谁先答应用谁，不浪费
              //   等待其它主机的 4 秒超时。
              if (!settled) { settled = true; resolve(k); }
            })
            .catch(function () { /* 该主机不可用，交给其它主机 */ })
            .then(function () {
              pending--;
              if (pending === 0 && !settled) { settled = true; resolve(-1); }
            });
        });
      });
    }).then(function (k) {
      cdnProbe = null;
      return k;
    }, function () {
      cdnProbe = null;
      return -1;
    });
    return cdnProbe;
  }

  /**
   * 备用源的仓库坐标解析。
   *
   * ★ 为什么允许传 owner/repo 覆盖全局值：
   *   两个真实需求 ——
   *     ① GitHub 上的仓库主名可能与 Gitee 不同（用户改了账号名）；
   *        此时只要改上面的 GH_OWNER / GH_REPO 两行即可，不用改逻辑。
   *   ② 自测脚本要拿一个**已存在的公开仓库**验证降级链路真的通，
   *        而本项目的 GitHub 仓库在首次发布前并不存在。
   *        所以这几个函数都允许显式指定坐标。
   */
  function ghCoord(owner, repo) {
    var o = String(owner || GH_OWNER).trim();
    var r = String(repo || GH_REPO).trim();
    if (!o || !r) throw new Error('GitHub 备用源坐标不完整');
    return {
      owner: o,
      repo: r,
      api: 'https://api.github.com/repos/' + o + '/' + r,
      web: 'https://github.com/' + o + '/' + r,
      codeload: 'https://codeload.github.com/' + o + '/' + r,
      jsdelivrData: 'https://data.jsdelivr.com/v1/packages/gh/' + o + '/' + r,
      /* CDN 读内容用 fastly（gcore 备用）。@tag 直取文件，无配额。 */
      jsdelivrCdn: 'https://fastly.jsdelivr.net/gh/' + o + '/' + r
    };
  }

  /**
   * 【备用源·检测】jsDelivr 数据 API 列版本，取最大者。
   *
   * 为什么用 jsDelivr 而不是 api.github.com/repos/.../tags：
   *   后者消耗 GitHub 匿名配额（60 次/小时）。检测是每次「检查更新」必做的，
   *   而读文件已经把配额用得紧张，检测应该走**无配额**的那条路。
   *
   * 为什么 data.jsdelivr.com 可用：
   *   本机实测（2026-11-01）data.jsdelivr.com 200，返回 versions 数组，
   *   内容与 GitHub 标签一致（**只少一个 `v` 前缀**），实测 24/24 全中。
   *   它读的是 GitHub 仓库内容，不依赖 github.com 主站（后者本机不通）。
   *
   * ⚠️ jsDelivr 对**新仓库**有同步延迟：仓库刚推上去的几十分钟内，
   *   数据 API 可能还列不出标签（404 或版本不全）。
   *   所以备用源检测另有 GitHub API 一档兜底，见 fetchLatestTagFromGitHubApi。
   */
  function fetchLatestTagFromGitHub(owner, repo) {
    var c = ghCoord(owner, repo);
    return fetchT(c.jsdelivrData + '?t=' + Date.now(), {
      cache: 'no-store'
    }, FETCH_TIMEOUT_DETECT).then(function (res) {
      if (!res.ok) throw new Error('GitHub 备用源读取版本列表失败（HTTP ' + res.status + '）');
      return res.json();
    }).then(function (data) {
      var list = [];
      var vs = data && data.versions;
      if (Array.isArray(vs)) {
        for (var i = 0; i < vs.length; i++) {
          var v = vs[i] && vs[i].version;
          if (!v) continue;
          // jsDelivr 返回的版本号没有 `v` 前缀，统一补上再比较。
          list.push({ name: versionToTag(v) });
        }
      }
      if (!list.length) throw new Error('GitHub 备用源里没有可用版本');
      return pickMaxVersionTag(list);
    });
  }

  /**
   * 【备用源·检测·二档】直接问 GitHub API 要标签列表。
   *
   * 存在的理由：jsDelivr 对**新建仓库**有同步延迟（仓库推上去后
   * 可能几十分钟内列不出标签）。这时 GitHub API 已经是准的，
   * 宁可吃一次配额（60 次/小时里的一次）也不能让更新检测失灵。
   *
   * 配额代价：每次「检查更新」最多消耗 1 次配额，且仅在 jsDelivr 那档失败时才用。
   */
  function fetchLatestTagFromGitHubApi(owner, repo) {
    var c = ghCoord(owner, repo);
    return fetchT(c.api + '/tags?per_page=100', {
      headers: { Accept: 'application/vnd.github+json' },
      cache: 'no-store'
    }, FETCH_TIMEOUT_DETECT).then(function (res) {
      if (res.status === 403) {
        throw new Error('GitHub 备用源访问额度用完了（403），请稍后再试');
      }
      if (!res.ok) {
        throw new Error('GitHub 备用源读取版本列表失败（HTTP ' + res.status + '）');
      }
      return res.json();
    }).then(function (data) {
      if (!Array.isArray(data) || !data.length) {
        throw new Error('GitHub 备用源里没有可用版本');
      }
      var list = [];
      for (var i = 0; i < data.length; i++) {
        var name = data[i] && data[i].name;
        if (!name || !isVersionTag(name)) continue;
        list.push({ name: name });
      }
      if (!list.length) throw new Error('GitHub 备用源里没有符合 YY.MM.DD.N 的版本标签');
      return pickMaxVersionTag(list);
    });
  }

  /**
   * 【备用源·读单文件】混合读法：jsDelivr CDN 优先，contents API 兜底。
   *
   * ── 为什么必须混着走（2026-11-01 实测踩到的配额坑）──
   *   GitHub 匿名 API 配额是 **60 次/小时**（按 IP 计）。
   *   一次全量更新要下 72 个文件，若全走 contents API：
   *     72 > 60 ⇒ 第 61 个文件起必 403（rate limit exceeded），
   *     更新**必然中途失败** —— 实测逐文件校验时第 46 个就开始 403
   *     （前面还消耗了检测+清单的调用）。
   *
   * ── 实测的分流依据（本仓库 @tag 逐类型试）──
   *   .js/.json/.css  → jsDelivr 直出 200（**无配额**，走 CDN）
   *   .html/.png      → jsDelivr 301 到 raw.githubusercontent.com
   *                     （部分网络不可达，走 contents API）
   *   72 文件分流结果：65 走 CDN（0 配额）+ 7 走 API ⇒ 单次更新 7 次配额，
   *   多商家同时更新也不挤兑。
   *
   * ── jsDelivr 的同步延迟与兜底 ──
   *   新推的标签 jsDelivr 可能还没同步（404）⇒ 自动降级 contents API。
   *   所以 CDN 失败不是错误，是正常分支；API 永远是兜底。
   *
   * @param {string} tag   版本标签（形如 v26.11.01.2）
   * @param {string} path  仓库内相对路径（形如 src/content/main.js）
   * @param {string} [owner] 可选：覆盖默认仓库主名
   * @param {string} [repo]  可选：覆盖默认仓库名
   * @param {number} [expectSize] 可选：期望字节数（清单里有）。
   *   CDN 路径拿到内容后先对它校验 —— 不符视为 CDN 旧缓存，自动降级 API。
   * @returns {Promise<ArrayBuffer>}
   */
  function fetchGitHubFile(tag, path, owner, repo, expectSize) {
    // 健康状态（上次哪台 CDN 能用）是持久化的，首次调用要先读回来。
    return loadHealth().then(function () {
      return fetchGitHubFileInner(tag, path, owner, repo, expectSize);
    });
  }

  function fetchGitHubFileInner(tag, path, owner, repo, expectSize) {
    var c = ghCoord(owner, repo);
    var t = encodeURIComponent(String(tag == null ? '' : tag).trim());
    var p = String(path == null ? '' : path)
      .split('/')
      .filter(Boolean)
      .map(encodeURIComponent)
      .join('/');
    if (!t || !p) throw new Error('GitHub 备用源路径参数不完整：' + tag + ' / ' + path);

    // 按扩展名分流：CDN 直出类型先用 CDN（无配额），其余直接 API（少绕路）。
    var base = p.slice(p.lastIndexOf('/') + 1);
    var dot = base.lastIndexOf('.');
    var ext = dot >= 0 ? base.slice(dot + 1).toLowerCase() : '';
    var viaCdn = (ext !== 'html' && ext !== 'png' && ext !== 'md');

    var viaApi = function () {
      var url = c.api + '/contents/' + p + '?ref=' + t;
      return fetchT(url, { cache: 'no-store' }, downloadTimeoutFor(expectSize)).then(function (res) {
        if (res.status === 403) {
          // 匿名配额耗尽。这是 GitHub 侧最常见的失败，别只报状态码。
          throw new Error('GitHub 备用源访问额度用完了（403），请稍后再试');
        }
        if (res.status === 404) {
          var e404 = new Error('GitHub 备用源里没有这个文件（' + path + '）');
          e404.noRetry = true;
          throw e404;
        }
        if (!res.ok) {
          throw new Error('GitHub 备用源读取失败（HTTP ' + res.status + '）：' + path);
        }
        return res.json();
      }).then(function (data) {
        if (!data || data.type !== 'file' || !data.content) {
          throw new Error('GitHub 备用源返回的内容不完整：' + path);
        }
        return base64ToBytes(data.content).buffer;
      });
    };

    if (!viaCdn) return viaApi();

    // CDN 路径：多域名轮换 → 全挂才降级 API。
    // ★ 为什么要多域名（2026-11-01 本机实测的实证）：
    //   jsDelivr 的不同子域在大陆的可达性**真实存在差异且会随网络变化** ——
    //   同一时刻同一台机器上 fastly/gcore 通、cdn.jsdelivr.net 直连不通。
    //   写死一个域名 = 某天那个域名在某个商家网络里被堵，更新就断。
    //   顺序：fastly（主）→ gcore → cdn；成功的主机写进持久化的 cdnHealthyIdx，
    //   后续文件与后续更新都直接从它开始。
    // ★ 2026-11-06：优先用上一次探明可用的主机；若下载前已调 warmUpCdn，
    //   cdnHealthyIdx 就是这次实测可用的那台，不会再从黑洞主机撞起。
    var hosts = cdnHosts(c);
    var startIdx = Math.min(Math.max(cdnHealthyIdx, 0), hosts.length - 1);

    function tryCdn(k) {
      if (k >= hosts.length) {
        return Promise.reject(new Error('jsDelivr 各域名均不可达：' + path));
      }
      // ★ 2026-11-06：去掉 `?t=` 防缓存参数。
      //   tag 指向的内容是不可变的（git 对象寻址，且本项目纪律是「标签一经
      //   推送不重建」），加时间戳等于让 jsDelivr 每次都回源 —— 实测每个
      //   文件多花 2~3 秒。去掉后第二次起就命中边缘缓存。
      //   旧缓存风险已有两道闸：① 下面的 expectSize 长度比对；
      //   ② update.js 的 sha256 逐文件校验。
      var url = hosts[k] + '@' + t + '/' + p;
      return fetchT(url, { redirect: 'follow', cache: 'no-store' }, downloadTimeoutFor(expectSize))
        .then(function (res) {
          if (!res.ok) {
            throw new Error('jsDelivr 无此内容（HTTP ' + res.status + '）：' + path);
          }
          return res.arrayBuffer();
        })
        .then(function (buf) {
          // ★ CDN 旧缓存防御（2026-11-01 实测踩到）：
          //   同名标签重建后，jsDelivr 会**长期返回重建前的旧内容**（200、不是 404），
          //   连 purge 接口都不立即生效。长度与清单不符 = 十有八九是旧缓存
          //   ⇒ 当作 CDN 失败降级 API，把真内容拿回来，而不是让 sha256 校验失败。
          if (typeof expectSize === 'number' && buf.byteLength !== expectSize) {
            throw new Error('CDN 内容长度与清单不符（疑似旧缓存）：' + path);
          }
          if (cdnHealthyIdx !== k) {
            cdnHealthyIdx = k;
            saveHealth();
          }
          return buf;
        })
        .catch(function () {
          return tryCdn(k + 1);
        });
    }

    return tryCdn(startIdx).catch(function () {
      return viaApi().then(function (buf) {
        if (typeof expectSize === 'number' && buf.byteLength !== expectSize) {
          throw new Error(
            '文件长度不符（期望 ' + expectSize + '，实得 ' + buf.byteLength + '）：' + path
          );
        }
        return buf;
      });
    });
  }

  /**
   * 取最新版本标签：**双源并行查询，取版本号更大的那个**。
   *
   * ── 为什么不能是「主源成功就停」（2026-11-01 修正的一个真实缺陷）──
   *   最初的实现是串行降级：Gitee 成功拿到标签就 return，不再看 GitHub。
   *   在"Gitee 暂时被封、随后解封"的场景下这会出事：
   *     · 被封期间我们在 GitHub 发了 v26.11.01.2，Gitee 上最新仍是 v26.11.01.1；
   *     · Gitee 解封后，扩展一查 Gitee 就拿到 v26.11.01.1，**直接返回**；
   *     · 于是扩展永远看不到 GitHub 上的 v26.11.01.2 —— **商家再也收不到更新**，
   *       而且现象极隐蔽（"检查更新"一直说已是最新，没人知道为什么）。
   *
   * ── 正确的语义 ──
   *   「保留 Gitee」= **Gitee 仍是首选数据源**，不是「Gitee 一旦能连上就说了算」。
   *   两个源会**暂时不同步**（谁先发、谁后发都可能有），所以必须**都比一遍取最大的**。
   *   代价是每次检测多一轮请求，换来「任何一侧有新版都能被发现」。
   *
   * ── 实现要点 ──
   *   · 两条链**并行**发起（不等一个失败再试另一个），延迟不叠加；
   *   · 任何一侧失败都**不影响**另一侧（settle 语义，永不 reject）；
   *   · 两侧都失败才报错，且把两边的错误都带上，便于排查；
   *   · Gitee 侧内部仍是三级降级（tags.atom → releases → api），
   *     GitHub 侧内部两级（jsDelivr → GitHub API），
   *     合起来最多 5 条通道，取全部成功结果里版本号最大的。
   *
   * @param {string} [owner] 可选：覆盖默认 GitHub 仓库主名（自测用）
   * @param {string} [repo]  可选：覆盖默认 GitHub 仓库名
   * @returns {Promise<string>} 版本标签，形如 v26.11.01.2
   */
  function fetchLatestTag(owner, repo) {
    var giteeChain = fetchLatestTagFromTagsFeed()
      .catch(function () { return fetchLatestTagFromWeb(); })
      .catch(function () { return fetchLatestTagFromApi(); });
    var githubChain = fetchLatestTagFromGitHub(owner, repo)
      .catch(function () { return fetchLatestTagFromGitHubApi(owner, repo); });

    return Promise.all([settle(giteeChain), settle(githubChain)])
      .then(function (res) {
        var giteeTag = res[0].ok ? res[0].value : null;
        var githubTag = res[1].ok ? res[1].value : null;
        if (giteeTag && githubTag) {
          // 两边都有 → 取版本号更大的那个
          return compareVersion(tagToVersion(githubTag), tagToVersion(giteeTag)) > 0
            ? githubTag
            : giteeTag;
        }
        if (giteeTag) return giteeTag;
        if (githubTag) return githubTag;
        // 两边都失败 → 把两边的错误都带上，别只报一边
        throw new Error(
          '读取版本列表失败（Gitee：' + (res[0].reason && res[0].reason.message || '未知') +
          '；GitHub：' + (res[1].reason && res[1].reason.message || '未知') + '）'
        );
      });
  }

  /**
   * 把 promise 变成「永不 reject」的形态：成功给 {ok:true,value}，
   * 失败给 {ok:false,reason}。用于并行比较多个来源，避免一处失败拖垮全部。
   */
  function settle(p) {
    return p.then(
      function (v) { return { ok: true, value: v }; },
      function (e) { return { ok: false, reason: e }; }
    );
  }

  /* ==================== 通道 2：raw（下载主通道） ==================== */

  /**
   * 【版本日志·标签列表】拿全部版本标签（带日期），供 changelog 面板渲染。
   *
   * 为什么放在本文件而不是 service-worker.js：
   *   版本日志与更新检测读的是**同一份数据**（仓库标签）。
   *   两处各写一套 → 主源一挂就有一处先坏、行为不一致。
   *   集中到这里，两边共用同一条降级链。
   *
   * 主源：Gitee /tags.atom（网页通道，含全部标签与日期）
   * 备用：jsDelivr 数据 API 的 versions 列表（无日期，但能拿全量标签）
   *      再兜底 GitHub API 的 tags 列表（新仓库 jsDelivr 未同步时用）
   *
   * ★ 与 fetchLatestTag 同理：**两边都取，合并去重**，不因 Gitee 成功就丢掉 GitHub。
   *   否则"Gitee 解封但版本落后于 GitHub"时，版本日志会漏掉 GitHub 上的新版本，
   *   与更新检测的结论自相矛盾（面板说没有新版本、检查更新说有）。
   *
   * @returns {Promise<Array<{tag:string, date:string}>>} 按版本降序
   */
  function fetchTagList(owner, repo) {
    // ★ 2026-11-06：主源标签列表改走 API 全量接口，atom 降为兜底。
    //
    //   为什么：`/tags.atom` 实测**恒返回最近 10 条**（page/per_page 参数均无效），
    //   而仓库实际有 64 个标签 —— 版本日志永远只能看到 10 个版本。
    //   `/api/v5/tags?per_page=100` 一次就能拿全，代价是 1 次匿名配额
    //   （60 次/小时），对「打开面板」这个低频动作完全可接受。
    //   配额耗尽（403）时自动退回 atom，功能不因此中断。
    var giteeChain = fetchTagListFromGiteeApi(owner, repo)
      .catch(function () { return fetchTagListFromGiteeAtom(); });
    var githubChain = fetchTagListFromGitHub(owner, repo);

    return Promise.all([settle(giteeChain), settle(githubChain)])
      .then(function (res) {
        var merged = {};
        var any = false;
        // Gitee 的条目带日期，优先保留它的（GitHub 侧没有日期字段）
        if (res[1].ok) {
          res[1].value.forEach(function (e) { merged[e.tag] = e; any = true; });
        }
        if (res[0].ok) {
          res[0].value.forEach(function (e) {
            // 两边都有的标签保留带日期的那份
            if (!merged[e.tag] || !merged[e.tag].date) merged[e.tag] = e;
            any = true;
          });
        }
        if (!any) {
          throw new Error(
            '读取版本列表失败（Gitee：' + (res[0].reason && res[0].reason.message || '未知') +
            '；GitHub：' + (res[1].reason && res[1].reason.message || '未知') + '）'
          );
        }
        var out = [];
        for (var k in merged) {
          if (Object.prototype.hasOwnProperty.call(merged, k)) out.push(merged[k]);
        }
        out.sort(function (a, b) {
          return -compareVersion(a.tag, b.tag);
        });
        return out;
      });
  }

  /**
   * 【主源·标签列表·首选】Gitee API v5 全量标签（实测 64/64）。
   * 代价 1 次匿名配额；限流时抛错，由调用方退回 atom。
   */
  function fetchTagListFromGiteeApi(owner, repo) {
    var o = String(owner || OWNER).trim();
    var r = String(repo || REPO).trim();
    var url = 'https://gitee.com/api/v5/repos/' + o + '/' + r + '/tags?per_page=100&t=' + Date.now();
    return fetchT(url, {
      headers: { Accept: 'application/json' },
      cache: 'no-store'
    }, FETCH_TIMEOUT_DETECT).then(function (res) {
      if (res.status === 403) {
        throw new Error('Gitee 接口限流（403），改用网页通道');
      }
      if (!res.ok) throw new Error('读取版本列表失败（HTTP ' + res.status + '）');
      return res.json();
    }).then(function (arr) {
      if (!Array.isArray(arr) || !arr.length) throw new Error('版本列表里没有可用条目');
      var out = [];
      for (var i = 0; i < arr.length; i++) {
        var name = String(arr[i] && arr[i].name || '').trim();
        if (!isVersionTag(name)) continue;
        // 日期口径：优先打标签的时间（tagger.date），没有就用提交时间。
        var date = (arr[i].tagger && arr[i].tagger.date)
          || (arr[i].commit && arr[i].commit.date) || '';
        out.push({ tag: name, date: date });
      }
      if (!out.length) throw new Error('版本列表里没有符合 YY.MM.DD.N 的标签');
      out.sort(function (a, b) { return -compareVersion(a.tag, b.tag); });
      return out;
    });
  }

  /**
   * 【主源·标签列表·兜底】tags.atom（网页通道）。
   * ⚠️ 实测只返回最近 10 条且不支持分页 —— 仅作限流时的降级，
   *    不能当全量来源用。
   */
  function fetchTagListFromGiteeAtom() {
    return fetchT(WEB + '/tags.atom?t=' + Date.now(), {
      redirect: 'follow',
      cache: 'no-store'
    }, FETCH_TIMEOUT_DETECT).then(function (res) {
      if (!res.ok) throw new Error('读取版本列表失败（HTTP ' + res.status + '）');
      return res.text();
    }).then(function (xml) {
      var out = [];
      var re = /<entry>([\s\S]*?)<\/entry>/gi;
      var m;
      while ((m = re.exec(xml)) !== null) {
        var block = m[1];
        var t = block.match(/<title>\s*(v?\d+(?:\.\d+)*)\s*<\/title>/i);
        if (!t || !isVersionTag(t[1])) continue;
        var d = block.match(/<update>([^<]+)<\/update>/i);
        out.push({ tag: t[1], date: d ? d[1] : '' });
      }
      if (!out.length) throw new Error('版本列表里没有可用条目');
      return out;
    });
  }

  /**
   * 【备用源·标签列表】从 GitHub 侧拿全量标签。
   *
   * 两档：
   *   ① jsDelivr 数据 API —— 无配额，能拿全量版本（实测与 GitHub 标签一致，
   *      只少一个 `v` 前缀），但对新仓库有同步延迟；
   *   ② GitHub API tags —— 吃 1 次配额，但新仓库也能立刻读到。
   *
   * @returns {Promise<Array<{tag:string, date:string}>>} 按版本降序
   */
  function fetchTagListFromGitHub(owner, repo) {
    var c = ghCoord(owner, repo);
    function fromVersions(data) {
      var vs = data && data.versions;
      if (!Array.isArray(vs) || !vs.length) {
        throw new Error('GitHub 备用源里没有可用版本');
      }
      var out = [];
      for (var i = 0; i < vs.length; i++) {
        var v = vs[i] && vs[i].version;
        if (!v) continue;
        var tag = versionToTag(v);
        if (!isVersionTag(tag)) continue;
        out.push({ tag: tag, date: '' });
      }
      if (!out.length) throw new Error('GitHub 备用源里没有可用版本');
      out.sort(function (a, b) { return -compareVersion(a.tag, b.tag); });
      return out;
    }
    function fromTags(data) {
      if (!Array.isArray(data) || !data.length) {
        throw new Error('GitHub 备用源里没有可用版本');
      }
      var out = [];
      for (var i = 0; i < data.length; i++) {
        var name = data[i] && data[i].name;
        if (!name || !isVersionTag(name)) continue;
        out.push({ tag: name, date: '' });
      }
      if (!out.length) throw new Error('GitHub 备用源里没有符合 YY.MM.DD.N 的版本标签');
      out.sort(function (a, b) { return -compareVersion(a.tag, b.tag); });
      return out;
    }

    return fetchT(c.jsdelivrData + '?t=' + Date.now(), { cache: 'no-store' }, FETCH_TIMEOUT_DETECT)
      .then(function (res) {
        if (!res.ok) throw new Error('jsDelivr 读取版本列表失败（HTTP ' + res.status + '）');
        return res.json();
      })
      .then(fromVersions)
      .catch(function () {
        // jsDelivr 没同步（新仓库常见）→ 用 GitHub API 的标签列表
        return fetchT(c.api + '/tags?per_page=100', {
          headers: { Accept: 'application/vnd.github+json' },
          cache: 'no-store'
        }, FETCH_TIMEOUT_DETECT).then(function (res) {
          if (res.status === 403) {
            throw new Error('GitHub 备用源访问额度用完了（403），请稍后再试');
          }
          if (!res.ok) {
            throw new Error('GitHub 备用源读取版本列表失败（HTTP ' + res.status + '）');
          }
          return res.json();
        }).then(fromTags);
      });
  }

  /**
   * 拼 raw 通道 URL：/raw/<tag>/<路径>
   *
   * 逐段 encodeURIComponent 而不是整体编码 —— 要保留路径里的斜杠。
   * 本工程目前没有中文文件名，但将来若有，这一步保证它能正常取到。
   *
   * 不加时间戳/随机数：tag 指向的内容是不可变的（git 对象寻址），
   * 没有必要破缓存，加了反而多一轮无用请求。
   */
  function rawUrl(tag, path) {
    var t = encodeURIComponent(String(tag == null ? '' : tag).trim());
    var p = String(path == null ? '' : path)
      .split('/')
      .filter(Boolean)
      .map(encodeURIComponent)
      .join('/');
    if (!t || !p) throw new Error('raw 路径参数不完整：' + tag + ' / ' + path);
    return RAW + t + '/' + p;
  }

  /**
   * 校验更新清单的结构。
   * 主源与备用源拿到的是同一份 JSON，校验逻辑必须一致 —— 故抽成独立函数复用，
   * 免得两处各写一遍、日后改一处漏一处。
   */
  function parseAndValidateManifest(txt) {
    var data;
    try {
      data = JSON.parse(txt);
    } catch (e) {
      throw new Error('更新清单格式损坏，无法解析');
    }
    if (!data || !Array.isArray(data.files) || !data.files.length) {
      throw new Error('更新清单内容为空');
    }
    if (String(data.algorithm || '').toLowerCase() !== 'sha256') {
      throw new Error('更新清单使用了不支持的校验算法：' + data.algorithm);
    }
    for (var i = 0; i < data.files.length; i++) {
      var e = data.files[i];
      if (!e || typeof e.path !== 'string' || !e.path ||
          typeof e.sha256 !== 'string' || !e.sha256) {
        throw new Error('更新清单条目格式不对（第 ' + (i + 1) + ' 条）');
      }
    }
    return data;
  }

  /**
   * 读更新清单：raw/<tag>/update-manifest.json
   *
   * 返回 { version, algorithm:'sha256', files:[{path,size,sha256}] }
   *
   * 「清单缺失」与「清单损坏」分开报错：
   *   404 说明这个 tag 没带清单（只可能是本功能上线之前的老版本），
   *   提示用户改用完整安装包升级 —— 而不是含糊的「下载失败」。
   *
   * ★ 主源 404 也要问备用源（2026-11-01 修正）：
   *   主源 404 的真实含义可能是「该版本尚未同步到主源」，而不是「这个版本没有清单」。
   *   两边都 404 才判定为「这个版本确实没带清单」（那时才标 noRetry）。
   */
  function fetchUpdateManifest(tag, owner, repo) {
    return loadHealth().then(function () {
      return fetchUpdateManifestInner(tag, owner, repo);
    });
  }

  function fetchUpdateManifestInner(tag, owner, repo) {
    var url = rawUrl(tag, MANIFEST_FILE);

    function fromBackup(mainErr) {
      // 主源读不到清单时（例如 Gitee 被封 / raw 通道 403 / 该版本尚未同步），
      // 自动改走 GitHub 备用源。主源一恢复就自动走回主源。
      return fetchGitHubFile(tag, MANIFEST_FILE, owner, repo).then(function (buf) {
        var txt = new TextDecoder('utf-8').decode(new Uint8Array(buf));
        return parseAndValidateManifest(txt);
      }).catch(function (e2) {
        // 备用源也没有 → 两边都缺清单，这才是确定性错误（重试无意义）。
        if (mainErr && mainErr.mainSource404 && e2 && e2.noRetry) {
          e2.noRetry = true;
          throw e2;
        }
        throw e2;
      });
    }

    // 主源熔断期内直接走备用源（2026-11-06）。
    if (!mainSourceUsable()) return fromBackup(null);

    return fetchT(url, { redirect: 'follow', cache: 'no-store' }, FETCH_TIMEOUT_DETECT).then(function (res) {
      if (res.status === 404) {
        var e404 = new Error(
          '这个版本没有提供更新清单（' + tag + '），' +
          '可能发布于本功能上线之前。请改用完整安装包升级。'
        );
        // 先标记「主源没有」，**不**直接标 noRetry ——
        // 还要问备用源，确认两边都没有才算确定性错误。
        e404.mainSource404 = true;
        throw e404;
      }
      if (!res.ok) {
        throw new Error('读取更新清单失败（HTTP ' + res.status + '）');
      }
      return res.text();
    }).then(parseAndValidateManifest).then(function (data) {
      noteMainSource(true);
      return data;
    }).catch(function (e) {
      // 超时/5xx/网络错误计入熔断；主源 404（该版本尚未同步）不计。
      // 清单格式损坏也不计 —— 主源是活的，只是内容不对。
      if (!e || !e.mainSource404) noteMainSource(false);
      return fromBackup(e);
    });
  }

  /**
   * 取单个文件的原始字节：raw/<tag>/<路径>
   *
   * expectSize 传清单里的 size，用来提前拦住超限与长度不符。
   * 注意这里只做长度校验，内容校验（sha256）由调用方做 ——
   * 因为校验要用 crypto.subtle，放在这里会把职责混在一起。
   *
   * onChunk（可选，26.10.11.3 新增）：每读到一个数据块回调一次 `onChunk(块字节数)`。
   *   用途是给更新页显示**真实字节进度**，替掉原来那个「跳到某个数就不动」的假进度条。
   *   拿不到 response.body 的内核会静默退回整体读取 —— 进度的缺失不影响下载本身。
   *
   * ⚠️ 调用方注意：重试（withRetry）会让 onChunk 被重复调用，
   *    所以必须在每次重试前把计数器回退到本次下载开始时的值，
   *    否则进度会虚高、越过 100%。见 update.js 里 prefetchOne 的写法。
   *
   * ★ 2026-11-01：主源 raw 失败时自动改走 GitHub 备用源。
   *   GitHub 侧不走流式（contents API 返回 base64 JSON），所以拿不到
   *   分块的 onChunk —— 此时以字节总数一次性回调，让进度条走完，
   *   而不是卡在 0%。
   *
   * ★ 主源返回 404 时**也要试备用源**（2026-11-01 修正）：
   *   原实现把 404 当成"这个 tag 真没这个文件"，直接抛错不降级。
   *   但"Gitee 解封后版本落后于 GitHub"时，主源 404 的真实含义是
   *   **该版本还没同步到 Gitee**，而备用源**是有**这个文件的。
   *   按原逻辑会直接失败 —— 恰恰在"两个源暂时不同步"这个最需要降级的场景下失灵。
   *   现在：主源 404 → 照样问备用源；两边都 404 才判定为确定性失败（noRetry）。
   */
  function fetchRawFile(tag, path, expectSize, onChunk, owner, repo) {
    if (typeof expectSize === 'number' && expectSize > MAX_FILE_BYTES) {
      return Promise.reject(new Error(
        '文件过大（' + expectSize + ' 字节），超出内置更新能力：' + path
      ));
    }
    // 熔断状态是持久化的，首次调用要先读回来。
    return loadHealth().then(function () {
      return fetchRawFileInner(tag, path, expectSize, onChunk, owner, repo);
    });
  }

  function fetchRawFileInner(tag, path, expectSize, onChunk, owner, repo) {
    var timeoutMs = downloadTimeoutFor(expectSize);

    /** 备用源分支：主源故障或主源明确没有该版本时走这里。 */
    function fromBackup(mainErr) {
      // ★ 主源 404 也要降级（见上方注释）：那可能只是「该版本尚未同步到主源」。
      //   只有**两边都 404** 才判定为确定性失败（标记 noRetry，让调用方别再重试）。
      //   expectSize 传进去：CDN 旧缓存防御需要它（长度不符→自动降级 API）。
      return fetchGitHubFile(tag, path, owner, repo, expectSize).then(function (buf) {
        var bytes = new Uint8Array(buf);
        if (typeof expectSize === 'number' && bytes.length !== expectSize) {
          throw new Error(
            '文件长度不符（期望 ' + expectSize + '，实得 ' + bytes.length + '）：' + path
          );
        }
        // 备用源是一次性拿全量，按字节数补一次进度回调，
        // 让更新页的进度条能走完（主源那种分块回调在备用源不存在）。
        if (typeof onChunk === 'function') {
          try { onChunk(bytes.length); } catch (e2) { /* 进度回调出错不拖累下载 */ }
        }
        return bytes;
      }).catch(function (e2) {
        // 备用源也失败：说明「两边都不通」比「主源不通」更接近真相。
        // 此时立刻解除熔断，让上层重试（update.js 有 3 次重试）能重新试主源 ——
        // 否则一次误判会把商家锁在备用源上整整 30 分钟。
        if (!mainSourceUsable()) {
          mainDownUntil = 0;
          mainFailStreak = 0;
          saveHealth();
        }
        // 备用源也失败：两边都 404 才算「这个版本真的没这个文件」。
        if (mainErr && mainErr.mainSource404 && e2 && e2.noRetry) {
          e2.noRetry = true;
          throw e2;
        }
        throw e2;
      });
    }

    // ★ 2026-11-06 主源熔断：连续失败达阈值后，本批文件跳过主源直接走备用源。
    //   修的是「主源整体挂掉时，78 个文件各自白等一次超时」。
    if (!mainSourceUsable()) return fromBackup(null);

    return fetchT(rawUrl(tag, path), { redirect: 'follow', cache: 'no-store' }, timeoutMs)
      .then(function (res) {
        if (!res.ok) {
          var err = new Error('下载失败（HTTP ' + res.status + '）：' + path);
          // 404 不再标记 noRetry —— 主源 404 只说明「这个源没有」，
          // 备用源可能有（该版本尚未同步到主源）。降级后再定夺。
          err.mainSource404 = (res.status === 404);
          throw err;
        }
        var canStream = typeof onChunk === 'function'
          && res.body
          && typeof res.body.getReader === 'function';
        if (!canStream) return res.arrayBuffer();

        var reader = res.body.getReader();
        var chunks = [];
        var got = 0;
        function pump() {
          return reader.read().then(function (r) {
            if (r.done) return;
            var chunk = r.value;
            got += chunk.length;
            // 流式读取同样要受单文件上限约束，避免被超大响应撑爆内存
            if (got > MAX_FILE_BYTES) {
              throw new Error('响应体超出单文件上限，已中止：' + path);
            }
            chunks.push(chunk);
            try { onChunk(chunk.length); } catch (e) { /* 进度回调出错不拖累下载 */ }
            return pump();
          });
        }
        return pump().then(function () {
          var out = new Uint8Array(got);
          var off = 0;
          for (var i = 0; i < chunks.length; i++) {
            out.set(chunks[i], off);
            off += chunks[i].length;
          }
          return out.buffer;
        });
      })
      .then(function (buf) {
        var bytes = new Uint8Array(buf);
        if (typeof expectSize === 'number' && bytes.length !== expectSize) {
          throw new Error(
            '文件长度不符（期望 ' + expectSize + '，实得 ' + bytes.length + '）：' + path
          );
        }
        noteMainSource(true);
        return bytes;
      })
      .catch(function (e) {
        // 主源 raw 挂了（超时/403/5xx）→ 计入熔断，再走 GitHub 备用源。
        // ⚠️ 主源 404 不算主源不可用（那是内容缺失），只降级、不计数。
        //    长度不符同样不计数 —— 主源是活的，只是内容不对。
        if (!e || !e.mainSource404) noteMainSource(false);
        return fromBackup(e);
      });
  }

  /* ==================== 校验工具 ==================== */

  /**
   * 算 sha256（十六进制小写）。
   * 与 scripts/make-update-manifest.py 里 hashlib.sha256 的输出格式一致。
   */
  function sha256Hex(bytes) {
    return crypto.subtle.digest('SHA-256', bytes).then(function (digest) {
      var arr = new Uint8Array(digest);
      var hex = '';
      for (var i = 0; i < arr.length; i++) {
        hex += ('0' + arr[i].toString(16)).slice(-2);
      }
      return hex;
    });
  }

  /* ==================== base64 互转（快照/回滚用） ==================== */

  function base64ToBytes(b64) {
    var bin = atob(String(b64).replace(/\s/g, ''));
    var out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  function bytesToBase64(bytes) {
    var s = '';
    var CHUNK = 0x8000; // 分块避免超长参数导致栈溢出
    for (var i = 0; i < bytes.length; i += CHUNK) {
      s += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
    }
    return btoa(s);
  }

  root.DYC_GITEE = {
    OWNER: OWNER,
    REPO: REPO,
    API: API,
    WEB: WEB,
    RAW: RAW,
    // 备用源坐标（GitHub）：检测走 jsDelivr 数据 API，读文件走 GitHub API。
    GH_OWNER: GH_OWNER,
    GH_REPO: GH_REPO,
    GH_API: GH_API,
    GH_WEB: GH_WEB,
    GH_CODELOAD: GH_CODELOAD,
    GH_JSDELIVR_DATA: GH_JSDELIVR_DATA,
    // 「查看全部版本」网页地址（主源被封时指向备用镜像页）
    TAGS_PAGE: TAGS_PAGE,
    MANIFEST_FILE: MANIFEST_FILE,
    MAX_FILE_BYTES: MAX_FILE_BYTES,
    parseVersion: parseVersion,
    compareVersion: compareVersion,
    tagToVersion: tagToVersion,
    versionToTag: versionToTag,
    isVersionTag: isVersionTag,
    // 检测
    fetchLatestTag: fetchLatestTag,
    fetchLatestTagFromTagsFeed: fetchLatestTagFromTagsFeed,
    fetchLatestTagFromWeb: fetchLatestTagFromWeb,
    fetchLatestTagFromApi: fetchLatestTagFromApi,
    fetchLatestTagFromGitHub: fetchLatestTagFromGitHub,
    fetchLatestTagFromGitHubApi: fetchLatestTagFromGitHubApi,
    pickMaxVersionTag: pickMaxVersionTag,
    // 标签列表（版本日志面板用，主源失败自动切备用源）
    fetchTagList: fetchTagList,
    fetchTagListFromGitHub: fetchTagListFromGitHub,
    fetchTagListFromGiteeApi: fetchTagListFromGiteeApi,
    fetchTagListFromGiteeAtom: fetchTagListFromGiteeAtom,
    // 下载前预热 + 健康状态（2026-11-06）
    warmUpCdn: warmUpCdn,
    mainSourceUsable: mainSourceUsable,
    noteMainSource: noteMainSource,
    loadHealth: loadHealth,
    healthSnapshot: function () {
      return {
        cdnIdx: cdnHealthyIdx,
        mainDownUntil: mainDownUntil,
        mainFailStreak: mainFailStreak,
        mainUsable: mainSourceUsable()
      };
    },
    // 备用源坐标解析（自测与镜像仓库切换用）
    ghCoord: ghCoord,
    // 下载
    rawUrl: rawUrl,
    fetchUpdateManifest: fetchUpdateManifest,
    fetchRawFile: fetchRawFile,
    fetchGitHubFile: fetchGitHubFile,
    sha256Hex: sha256Hex,
    // 工具
    base64ToBytes: base64ToBytes,
    bytesToBase64: bytesToBase64
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
