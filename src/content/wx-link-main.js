/**
 * 微信小店 · 商品链接读取（MAIN world 侧，2026-10-31）
 * ============================================================
 * 【为什么必须有一个 MAIN world 脚本】
 *
 *   上一版 `wx-goods-tools.js` 里写的「从 Vue 组件实例读链接」(L1) 在真机上
 *   是**永远拿不到东西**的：内容脚本跑在隔离世界（isolated world），页面的
 *   JS 挂在 DOM 元素上的 `__vue__` / `__vueParentComponent` 属于页面世界的
 *   包装对象，隔离世界读到的是 undefined。同一 DOM 节点在两个世界里是两份
 *   JS 对象 —— 这条先例本项目早有记录（replay-net.js 头注「为什么不 hook
 *   页面的 fetch / XHR」）。
 *
 *   ⇒ 结果就是 L1 恒失败、每次都落到「打开分享面板」的兜底。用户看到的
 *     「为什么复制链接会使用兜底」根因就在这里。
 *
 * 【本脚本干三件事，全部只读】
 *
 *   ① 接口取样：hook 页面的 fetch / XMLHttpRequest，把**商品相关接口**的 JSON
 *      响应解析一遍，从里面认出「同一个对象里既有商品 ID 又有 shop/a 短链」
 *      的组合，建 `<商品ID> → 链接` 的内存映射。
 *      —— 这是用户提的路子（「中控台的接口取样功能能不能搬过来」），也是唯一
 *         能做到**真正零点击**的来源：只要列表接口或分享接口发过一次，
 *         之后复制就是纯内存查询。
 *
 *   ② 兜底读内存：抓不到网络时，退一步在页面 Vue 实例里按商品 ID 精确
 *      匹配，取该对象上的链接。这条路在 MAIN world 里才有效（隔离世界读
 *      不到 `__vue__`）。
 *
 *   ③ 应答：隔离世界通过 postMessage 发 query，本脚本按 rid 回 link。
 *
 * 【安全口径】
 *
 *   · 只碰本站（store./channels.weixin.qq.com）且像商品 / 分享的接口，
 *     静态资源一律不碰。
 *   · 不保存原始响应体 —— 只留「ID → 链接」这一条映射与少量诊断字段名，
 *     内存上限 400 条，页面关掉即散，不写任何存储、不发任何外发请求。
 *   · **只认 `store.weixin.qq.com/shop/a/<短码>`**（官方网页链接形态）。
 *     宁可取不到，也不把编辑页 / 店铺首页链接写进剪贴板 —— 用户会把链接
 *     发给客户，取错比取不到严重得多。
 *   · 映射必须**精确按商品 ID** 建：列表容器对象里含全部商品 ID，用「包含」
 *     判定会让它先命中，然后取到第一个商品的链接。
 *
 * 【怎么进来的】沿用库存清零探针那套双通道（两条都幂等，哪条先到都一样）：
 *   ① script 标签 + web_accessible_resources（老内核可用，页面 CSP 可能拦）
 *   ② 后台 chrome.scripting.executeScript({world:'MAIN'})（内核 95+）
 * ============================================================
 */
(function () {
  'use strict';

  var TAG = 'DYC_WX_LINK';

  // 每次被注入都先报到场（防重入早退之前）—— 隔离世界用它确认注入通道活着
  try { window.postMessage({ source: TAG, type: 'ready' }, '*'); } catch (e) { /* 理论不会失败 */ }

  if (window.__DYC_WX_LINK_MAIN__) return;   // 防重入
  window.__DYC_WX_LINK_MAIN__ = true;

  /** 官方网页链接形态。白名单收窄到 /shop/a/<短码>，短码不可由商品 ID 推算 */
  var SHOP_SHORT_RE = /https?:\/\/store\.weixin\.qq\.com\/shop\/a\/[A-Za-z0-9_-]+/;
  var STORE_SHORT_RE = /https?:\/\/store\.weixin\.qq\.com\/shop\/a\/([A-Za-z0-9_-]+)/;

  /** 只解析这些接口的响应 —— 商品列表 / 商品详情 / 分享 */
  var API_RE = /(goods|product|item|commodity|share|spu|sku)/i;
  /** 静态资源一律不碰 */
  var STATIC_RE = /\.(?:js|mjs|css|png|jpe?g|gif|webp|svg|ico|woff2?|ttf|otf|mp4|ts|m3u8)(?:[?#]|$)/i;

  var MAX_MAP = 400;
  var MAX_FIELDS = 24;
  var MAX_APIS = 12;
  var MAX_TEXT = 800000;      // 单次响应体上限（字符），超过不解析，防卡页面

  var map = {};               // 商品ID → { link, from }
  var mapCount = 0;
  var diag = {
    hooked: 'fetch+xhr',
    json: 0,        // 解析成功的 JSON 响应数
    hit: 0,         // 建成映射的条数
    byKey: 0,       // 其中「接口只给 shareKey、由本地拼成链接」的条数
    byUrlId: 0,     // 其中「ID 取自请求 URL 参数」的条数
    apis: [],       // 命中的接口（路径摘要）
    fields: [],     // 「像链接但没认出全链接」的字段名（只在取不到时回给诊断）
    vueHit: 0,
    vueMiss: 0,
    apiHit: 0,      // 主动请求接口拿到的次数
    apiMiss: 0,
    apiErr: '',     // 最近一次失败现场（HTTP 码 + 响应开头），排查用
  };

  /* ---------- 小工具 ---------- */

  function noteApi(path, n) {
    for (var i = 0; i < diag.apis.length; i++) {
      if (diag.apis[i].p === path) { diag.apis[i].n += n; return; }
    }
    if (diag.apis.length >= MAX_APIS) diag.apis.shift();
    diag.apis.push({ p: path, n: n });
  }

  function noteField(name) {
    if (!name || diag.fields.indexOf(name) >= 0) return;
    if (diag.fields.length >= MAX_FIELDS) diag.fields.shift();
    diag.fields.push(name);
  }

  function pathOf(url) {
    try {
      var u = new URL(url, location.href);
      return u.pathname + (u.search ? u.search.slice(0, 24) : '');
    } catch (e) {
      return String(url || '').slice(0, 40);
    }
  }

  function interested(url) {
    if (!url || typeof url !== 'string') return false;
    if (STATIC_RE.test(url)) return false;
    if (!API_RE.test(url)) return false;
    if (!/^https?:\/\//i.test(url)) return true;
    try {
      var u = new URL(url, location.href);
      return u.hostname === location.hostname ||
             /(?:^|\.)weixin\.qq\.com$/i.test(u.hostname);
    } catch (e) {
      return false;
    }
  }

  // 隔离世界正在等某个商品（它已经开了分享面板在等链接）时记在这里。
  // 一旦抓到它的链接就立刻推过去，让那边马上关面板 —— 面板停留从「最多 2.4 秒」
  // 降到「一次接口往返」。这是用户 2026-10-31 说的「还是会半自动打开窗口」的
  // 唯一止血点：面板已经开了就没法不开，但可以只闪一下。
  var awaitedId = '';

  function put(id, link, from) {
    if (!id || !link) return false;
    if (!map[id] && mapCount >= MAX_MAP) return false;
    if (map[id] && map[id].link === link) return false;
    map[id] = { link: link, from: from || '' };
    mapCount++;
    diag.hit++;
    if (id === awaitedId) {
      awaitedId = '';
      try {
        window.postMessage({ source: TAG + '_HIT', goodsId: id, link: link }, '*');
      } catch (e) { /* 推不出去就等轮询 */ }
    }
    return true;
  }

  /* ---------- 从 JSON 里认「ID + 链接」 ---------- */

  /**
   * 在一个对象自身（深 2 层）里找 shop/a 短链。
   * 优先取键名像链接的字段，避免把子对象里的别家链接捡走。
   */
  /**
   * 短码字段：**精确键名**，不泛化。
   *
   * 实机证据（用户 2026-10-31 接口取样记录）：
   *   GET /shop-faas/mmecnodematerial/getProductPoster?…&shareKey=Lv8Ucss6SLSgQ7e
   *   → 网页链接 https://store.weixin.qq.com/shop/a/Lv8Ucss6SLSgQ7e
   *   **同一串码在 URL 参数与分享链接里完全一致** ⇒ `https://store.weixin.qq.com/shop/a/`
   *   + shareKey 就是网页链接。微信接口里通常只给 shareKey，不给整条链接，
   *   所以只认完整 URL 的话，映射永远建不起来（接口取样的响应里根本没有 URL）。
   *
   * 风险控制：键名必须是这几个之一、值必须是 8~32 位字母数字（含字母），
   * 且**必须能关联到商品 ID**（在 harvest 里判）才拼。宁可少拼，不拼错。
   */
  var SHARE_KEY_RE = /^(?:share_?key|share_?code)$/i;
  var SHORT_TOKEN_RE = /^[A-Za-z0-9_-]{8,32}$/;
  var SHARE_PREFIX = 'https://store.weixin.qq.com/shop/a/';

  /** 在对象自身（深 2 层）里找 shareKey 一类的短码 */
  function findShareKey(node) {
    var keys;
    try { keys = Object.keys(node); } catch (e) { return ''; }
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i];
      if (!SHARE_KEY_RE.test(k)) continue;
      var v;
      try { v = node[k]; } catch (e2) { continue; }
      if (typeof v !== 'string') continue;
      var s = v.trim();
      if (!SHORT_TOKEN_RE.test(s)) continue;
      if (!/[A-Za-z]/.test(s)) continue;        // 纯数字不是短码
      return s;
    }
    return '';
  }

  function findLink(node) {
    var best = '';
    var keys;
    try { keys = Object.keys(node); } catch (e) { return ''; }
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i];
      var v;
      try { v = node[k]; } catch (e2) { continue; }
      if (typeof v === 'string') {
        var m = v.match(SHOP_SHORT_RE);
        if (m) {
          if (/share|link|url|short|href/i.test(k)) return m[0];   // 强优先
          if (!best) best = m[0];
        }
      } else if (v && typeof v === 'object') {
        // 再下潜一层（部分接口把链接包在 {url:{...}} 里）
        var sub;
        try { sub = Object.keys(v); } catch (e3) { continue; }
        for (var j = 0; j < sub.length; j++) {
          var sv;
          try { sv = v[sub[j]]; } catch (e4) { continue; }
          if (typeof sv === 'string') {
            var m2 = sv.match(SHOP_SHORT_RE);
            if (m2 && /share|link|url|short|href/i.test(sub[j])) return m2[0];
          }
        }
      }
    }
    return best;
  }

  /** 强 ID：形状像商品 ID 的字段（goodsId / productId / spuId …） */
  var STRONG_ID_RE = /^(?:goods|product|item|commodity|spu|sku)_?id$/i;
  /** 弱 ID：泛 id —— 只在强 ID 全无时用，且必须 ≥6 位数字 */
  var WEAK_ID_RE = /^(?:id|_id)$/i;

  function idCandidates(node) {
    var strong = '';
    var weak = '';
    var keys;
    try { keys = Object.keys(node); } catch (e) { return { strong: '', weak: '' }; }
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i];
      var v;
      try { v = node[k]; } catch (e2) { continue; }
      if (v === null || typeof v === 'object' || typeof v === 'boolean') continue;
      var s = String(v);
      if (s.length < 6 || s.length > 24) continue;
      if (STRONG_ID_RE.test(k)) { if (!strong) strong = s; continue; }
      if (WEAK_ID_RE.test(k) && /^\d{6,}$/.test(s)) { if (!weak) weak = s; }
    }
    return { strong: strong, weak: weak };
  }

  /** 「像链接但没认出来」的字段名，收进诊断（实机一次就知道真字段叫什么） */
  function collectSuspectFields(node) {
    var keys;
    try { keys = Object.keys(node); } catch (e) { return; }
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i];
      if (!/share|link|url|short|href|code|export/i.test(k)) continue;
      var v;
      try { v = node[k]; } catch (e2) { continue; }
      if (typeof v !== 'string' || v.length < 8 || v.length > 400) continue;
      if (SHOP_SHORT_RE.test(v)) continue;      // 已认出的不算
      noteField(k);                             // 只留字段名，不留值
    }
  }

  /**
   * 遍历一份 JSON，把每个「同时具备商品 ID 与短链」的对象建成映射。
   *
   * 逐对象判定（不是逐整份响应）：列表接口一份响应里有 N 个商品对象，
   * 每个对象各自带自己的 ID 与链接，逐对象处理天然不会串号。
   */
  /**
   * 从请求 URL 里取商品 ID。
   *
   * 为什么必须有这一步（2026-10-31 实机证据）：
   *   GET /shop-faas/mmecnodematerial/product?…&**productId=10001816614795**
   *   响应体 {"code":0,…,"shareUrl":"https://store.weixin.qq.com/shop/a/Lv8U…",
   *           "shareKey":"Lv8U…"} —— **响应里根本没有 productId 字段**，
   *   ID 只在请求参数上。上一版只认响应体里的 ID，于是明明白白抓到了
   *   带 shareUrl 的响应，却因为配不上 ID 而一条映射都建不起来。
   */
  var URL_ID_KEYS = ['productId', 'product_id', 'goodsId', 'goods_id', 'spuId', 'itemId'];

  function idFromUrl(url) {
    try {
      var u = new URL(url, location.href);
      for (var i = 0; i < URL_ID_KEYS.length; i++) {
        var v = u.searchParams.get(URL_ID_KEYS[i]);
        if (v && /^\d{6,}$/.test(v)) return v;
      }
    } catch (e) { /* 相对路径解析失败就算了 */ }
    return '';
  }

  /**
   * 遍历一份 JSON，把「商品 ID + 短链」配成映射。
   *
   * 逐对象判定（不是逐整份响应）：列表接口一份响应里有 N 个商品对象，
   * 每个对象各自带自己的 ID 与链接，逐对象处理天然不会串号。
   *
   * ID 三级来源，优先级递减：
   *   ① 对象自身的 goodsId / productId / spuId（列表接口走这条）
   *   ② 对象自身的泛 id（≥6 位数字）
   *   ③ **请求 URL 上的 productId** —— 只在这份响应里**恰好只有一个**
   *      带链接的对象时才用。有多个就说明是列表类响应，靠 URL 上的 ID
   *      会给整页商品配同一个 ID，宁可放弃。
   */
  function harvest(root, from, urlId) {
    var stack = [root];
    var guard = 0;
    var gained = 0;
    var hits = [];          // [{node, link, via}]

    while (stack.length > 0 && guard < 20000) {
      guard++;
      var node = stack.pop();
      if (!node || typeof node !== 'object') continue;

      if (Array.isArray(node)) {
        for (var a = 0; a < node.length; a++) {
          if (node[a] && typeof node[a] === 'object') stack.push(node[a]);
        }
        continue;
      }

      var link = findLink(node);
      var via = 'url';
      if (!link) {
        // 接口只给短码时自己拼（ID 判据在下面统一处理）
        var sk = findShareKey(node);
        if (sk) { link = SHARE_PREFIX + sk; via = 'key'; }
      }
      if (link) hits.push({ node: node, link: link, via: via });
      else collectSuspectFields(node);

      var keys;
      try { keys = Object.keys(node); } catch (e) { continue; }
      for (var i = 0; i < keys.length; i++) {
        var v;
        try { v = node[keys[i]]; } catch (e2) { continue; }
        if (v && typeof v === 'object') stack.push(v);
      }
    }

    for (var h = 0; h < hits.length; h++) {
      var it = hits[h];
      var ids = idCandidates(it.node);
      var id = ids.strong || ids.weak;
      if (!id && urlId && hits.length === 1) id = urlId;
      if (!id) continue;
      if (put(id, it.link, from)) {
        gained++;
        if (it.via === 'key') diag.byKey++;
        if (!ids.strong && !ids.weak) diag.byUrlId++;
      }
    }
    return gained;
  }

  function consumeText(url, text) {
    if (!text || typeof text !== 'string') return;
    if (text.length > MAX_TEXT) return;
    if (text.charAt(0) !== '{' && text.charAt(0) !== '[') return;
    var json;
    try { json = JSON.parse(text); } catch (e) { return; }
    diag.json++;
    var gained = harvest(json, pathOf(url), idFromUrl(url));
    if (gained > 0) noteApi(pathOf(url), gained);
  }

  /* ---------- 接口取样 ---------- */

  function hookFetch() {
    var of = window.fetch;
    if (typeof of !== 'function') return;
    window.fetch = function (input, init) {
      var url = '';
      try { url = (input && input.url) || String(input || ''); } catch (e) { url = ''; }
      var capHdrs = null;
      if (looksLikeProductApi(url)) {
        try { capHdrs = readInitHeaders(init); } catch (e0) { capHdrs = null; }
      }
      var p = of.apply(this, arguments);
      if (capHdrs && p && typeof p.then === 'function') {
        try {
          p.then(function (res) {
            if (res && res.status === 200) absorbHeaders(capHdrs);
          }, function () { /* 请求失败，头不作数 */ });
        } catch (e1) { /* 记不上就算了 */ }
      }
      if (!interested(url)) return p;
      try {
        p.then(function (res) {
          try {
            if (!res || !res.clone) return;
            var ct = (res.headers && res.headers.get && res.headers.get('content-type')) || '';
            if (ct && ct.indexOf('json') < 0) return;
            res.clone().text().then(function (t) { consumeText(url, t); },
              function () { /* 读不到就算了，不影响页面 */ });
          } catch (e) { /* 任何异常都不许影响页面 */ }
        }, function () { /* 请求失败，无响应可读 */ });
      } catch (e2) { /* 同上 */ }
      return p;
    };
  }

  function hookXhr() {
    var XO = window.XMLHttpRequest;
    if (!XO || !XO.prototype) return;
    var origOpen = XO.prototype.open;
    var origSend = XO.prototype.send;
    if (typeof origOpen !== 'function' || typeof origSend !== 'function') return;

    var origSetHeader = XO.prototype.setRequestHeader;
    if (typeof origSetHeader === 'function') {
      XO.prototype.setRequestHeader = function (k, v) {
        try {
          if (!this.__dycHdrs) this.__dycHdrs = {};
          this.__dycHdrs[String(k)] = String(v);
        } catch (e) { /* 记不上就算了 */ }
        return origSetHeader.apply(this, arguments);
      };
    }

    XO.prototype.open = function (m, u) {
      try { this.__dycUrl = String(u || ''); this.__dycHdrs = null; } catch (e) { /* 只读属性就算了 */ }
      return origOpen.apply(this, arguments);
    };
    XO.prototype.send = function () {
      var self = this;
      try {
        if (interested(self.__dycUrl)) {
          self.addEventListener('load', function () {
            try {
              // 页面自己成功请求过 product 接口 ⇒ 把它这次的头抄下来（含签名）
              if (self.status === 200 && looksLikeProductApi(self.__dycUrl)) {
                absorbHeaders(self.__dycHdrs);
              }
              var ct = self.getResponseHeader('content-type') || '';
              if (ct && ct.indexOf('json') < 0) return;
              consumeText(self.__dycUrl, self.responseText);
            } catch (e) { /* 读不到就算了 */ }
          });
        }
      } catch (e2) { /* 同上 */ }
      return origSend.apply(this, arguments);
    };
  }

  try { hookFetch(); } catch (e1) { /* 页面若冻结了 fetch，直接放弃接口取样 */ }
  try { hookXhr(); } catch (e2) { /* 同上，退到 Vue 读内存 */ }

  /* ---------- Vue 内存读取（抓不到网络时的一档） ---------- */

  var DEEP_MAX = 7;
  var BUDGET = 6000;
  var PRIORITY = /^(setupState|ctx|data|\$data|\$props|props|state|\$store)$/;

  function entriesOf(v) {
    var out = [];
    function push(obj) {
      if (!obj || typeof obj !== 'object') return;
      var keys;
      try { keys = Object.keys(obj); } catch (e) { return; }
      for (var i = 0; i < keys.length; i++) {
        var k = keys[i];
        var val;
        try { val = obj[k]; } catch (e2) { continue; }
        out.push([k, val]);
      }
    }
    if (v.$data) { push(v.$data); push(v.$props); }         // Vue 2
    if (v.setupState) push(v.setupState);                   // Vue 3 <script setup>
    if (v.ctx) push(v.ctx);
    if (v.data) push(v.data);
    if (v.props) push(v.props);
    if (v.$store && v.$store.state) push(v.$store.state);   // Vuex
    if (out.length === 0) push(v);
    return out;
  }

  function scanStrings(root, maxDepth) {
    var seen = [];
    var queue = [{ v: root, d: 0 }];
    var budget = 300;
    while (queue.length > 0 && budget-- > 0) {
      var item = queue.shift();
      var v = item.v;
      if (!v || typeof v !== 'object' || item.d > maxDepth) continue;
      if (v.nodeType || v === window || v === document) continue;
      if (seen.indexOf(v) >= 0) continue;
      seen.push(v);
      var keys;
      try { keys = Object.keys(v); } catch (e) { continue; }
      for (var i = 0; i < keys.length; i++) {
        var val;
        try { val = v[keys[i]]; } catch (e2) { continue; }
        if (typeof val === 'string') {
          var m = val.match(SHOP_SHORT_RE);
          if (m) return m[0];
        } else if (val && typeof val === 'object') {
          queue.push({ v: val, d: item.d + 1 });
        }
      }
    }
    return '';
  }

  function topOf(inst) {
    var p = inst;
    var guard = 0;
    while (p && guard++ < 64) {
      var up = p.$parent || p.parent;
      if (!up) break;
      p = up;
    }
    return p;
  }

  /**
   * 找出页面上所有「组件实例的根」。
   *
   * ⚠️ **必须穿透 shadow**：微信小店是 micro-app 微前端，商品表格在
   * `<micro-app>` 的 open shadowRoot 里，`document.querySelectorAll('*')`
   * 根本进不去 —— 只查主文档会一个实例都找不到（探针 2026-10-31 踩过同类：
   * 导出的 7 个「候选容器」全是左侧菜单）。这里自己做三路下潜：
   * 普通后代 + open shadowRoot（深度 6 / 节点预算 2 万）。
   */
  function rootsOf() {
    var out = [];
    var queue = [{ root: document, depth: 0 }];
    var budget = 20000;
    while (queue.length > 0 && budget > 0) {
      var item = queue.shift();
      var els;
      try { els = item.root.querySelectorAll('*'); } catch (e) { continue; }
      for (var i = 0; i < els.length && budget > 0; i++) {
        budget--;
        var el = els[i];
        var inst = null;
        try {
          inst = el.__vue__ || el.__vueParentComponent ||
            (el._vnode && el._vnode.component) || null;
        } catch (e2) { inst = null; }
        if (inst) {
          var root = topOf(inst);
          if (root && out.indexOf(root) < 0) out.push(root);
        }
        if (item.depth < 6 && el.shadowRoot) {
          queue.push({ root: el.shadowRoot, depth: item.depth + 1 });
        }
      }
    }
    return out;
  }

  function fromVue(goodsId, name) {
    if (!goodsId && !(name && name.length >= 6)) return '';
    var roots = rootsOf();
    if (roots.length === 0) { diag.vueMiss++; return ''; }
    diag.vueHit++;

    for (var r = 0; r < roots.length; r++) {
      var seen = [];
      var queue = [{ v: roots[r], d: 0 }];
      var budget = BUDGET;
      while (queue.length > 0 && budget-- > 0) {
        var item = queue.shift();
        var v = item.v;
        if (!v || typeof v !== 'object' || item.d > DEEP_MAX) continue;
        if (v.nodeType || v === window || v === document) continue;
        if (seen.indexOf(v) >= 0) continue;
        seen.push(v);

        var ents = entriesOf(v);
        var isThis = false;
        for (var i = 0; i < ents.length; i++) {
          var val = ents[i][1];
          if (val === null || typeof val === 'object') continue;
          var s = String(val);
          if (goodsId && s === goodsId) { isThis = true; break; }
          // 名称兜底：必须整串相等（≥6 字），绝不用包含匹配
          if (!goodsId && name && s.trim() === name.trim()) { isThis = true; break; }
        }
        if (isThis) {
          var link = scanStrings(v, 2);
          if (link) { put(goodsId || name, link, 'vue'); return link; }
        }

        for (var j = 0; j < ents.length; j++) {
          var cv = ents[j][1];
          if (!cv || typeof cv !== 'object') continue;
          var next = { v: cv, d: item.d + 1 };
          if (PRIORITY.test(ents[j][0])) queue.unshift(next);
          else queue.push(next);
        }
      }
    }
    diag.vueMiss++;
    return '';
  }

  /* ---------- 应答隔离世界 ---------- */

  function snapshot() {
    return {
      hooked: diag.hooked,
      json: diag.json,
      hit: diag.hit,
      byKey: diag.byKey,
      byUrlId: diag.byUrlId,
      apiHit: diag.apiHit,
      apiMiss: diag.apiMiss,
      apiErr: diag.apiErr,
      hasHdr: !!apiHeaders,
      size: mapCount,
      apis: diag.apis.slice(0, MAX_APIS),
      fields: diag.fields.slice(0)
    };
  }

  /* ---------- 主动向平台查一次（只读 GET） ---------- */

  /**
   * 直接请求微信自己的「商品分享素材」接口拿 shareUrl。
   *
   * 实机接口取样（2026-10-31）确认的形态：
   *   GET /shop-faas/mmecnodematerial/product?token=&lang=zh_CN&productId=<ID>
   *   → {"code":0, "shareUrl":"https://store.weixin.qq.com/shop/a/<短码>",
   *      "shortLink":"#微信小店://…", "shareKey":"<短码>", …}
   *
   * 意义：**这是唯一能做到"一次点击都不碰面板"的路**。之前那几档都要求
   * 页面已经发过这个请求（要用户先点一次「分享」）；这里由我们按商品 ID
   * 主动发一次同源 GET，浏览器自动带上页面自己的登录态。
   *
   * 只说三件不做的：不改参数、不重发别人的请求、不写任何东西 —— 纯读。
   * 失败（接口改版 / 无权限 / 超时 2.5s）一律回空，由隔离世界退到面板那档，
   * 绝不让用户卡在这里。
   */
  /**
   * 页面自己请求 product 接口时用的请求头（含 biz magic 签名）。
   *
   * 微信对这个接口有签名校验，转发一律 403 `biz magic invalid`。签名从哪来
   * 我们没法从前端代码里推，但可以**照抄页面自己那次的请求头** ——
   * 只要签名不与具体 productId 绑定，抄过来就能用，那就真的"一次都不开窗"。
   * 抓不到就退回空头，仍失败就退面板（面板另有隐身处理，用户看不到）。
   */
  var apiHeaders = null;

  /** 浏览器禁止脚本设置的头：抄过来只会被忽略或抛错，直接跳过 */
  var BAD_HEADER_RE = /^(cookie|host|content-length|connection|referer|origin|user-agent|accept-encoding|content-type)$/i;

  function looksLikeProductApi(url) {
    return typeof url === 'string' && url.indexOf('/mmecnodematerial/product') >= 0;
  }

  /** 把 fetch 的 init.headers（Headers / 数组 / 普通对象三种形态）摊平 */
  function readInitHeaders(init) {
    var h = init && init.headers;
    if (!h) return null;
    var flat = {};
    var n = 0;
    try {
      if (Array.isArray(h)) {
        for (var i = 0; i < h.length; i++) { flat[h[i][0]] = h[i][1]; n++; }
      } else if (typeof h.forEach === 'function') {
        h.forEach(function (v, k) { flat[k] = v; n++; });
      } else {
        for (var k in h) {
          if (!Object.prototype.hasOwnProperty.call(h, k)) continue;
          flat[k] = h[k]; n++;
        }
      }
    } catch (e) { return null; }
    return n > 0 ? flat : null;
  }

  function absorbHeaders(h) {
    if (!h) return;
    var out = {};
    var has = false;
    for (var k in h) {
      if (!Object.prototype.hasOwnProperty.call(h, k)) continue;
      var v = h[k];
      if (typeof v !== 'string' && typeof v !== 'number') continue;
      out[String(k)] = String(v);
      has = true;
    }
    if (has) apiHeaders = out;
  }

  var API_CACHE_TTL = 10 * 60 * 1000;
  var apiCache = {};        // goodsId → { link, at }
  var apiInflight = {};     // goodsId → [cb]（同一次点击并发去重）

  /** 从接口响应里取链接（shareUrl 优先，只有 shareKey 时自己拼） */
  function linkOfJson(j) {
    if (!j || typeof j !== 'object') return '';
    if (typeof j.shareUrl === 'string') {
      var m = j.shareUrl.match(SHOP_SHORT_RE);
      if (m) return m[0];
    }
    if (typeof j.shareKey === 'string' && SHORT_TOKEN_RE.test(j.shareKey)) {
      return SHARE_PREFIX + j.shareKey;
    }
    return '';
  }

  /**
   * 发一次 GET，回 {link, note}。note 是失败排查用的现场（HTTP 码 + 响应开头）。
   * 先读 text 再自己 JSON.parse —— 直接用 r.json() 的话，一旦接口回的是 HTML
   * 错误页就只剩一句 "Unexpected token"，什么线索都没有，用户还得再导一次报告。
   */
  function getOnce(url, cb) {
    var settled = false;
    var timer = setTimeout(function () {
      if (settled) return;
      settled = true;
      cb('', '超时2s');
    }, 2000);

    function finish(link, note) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      cb(link || '', note || '');
    }

    try {
      var opt = { credentials: 'include', headers: { 'Accept': 'application/json' } };
      if (apiHeaders) {
        for (var hk in apiHeaders) {
          if (!Object.prototype.hasOwnProperty.call(apiHeaders, hk)) continue;
          if (BAD_HEADER_RE.test(hk)) continue;
          opt.headers[hk] = apiHeaders[hk];
        }
      }
      fetch(url, opt)
        .then(function (r) {
          return r.text().then(
            function (t) { return { st: r.status, t: t }; },
            function () { return { st: r.status, t: '' }; }
          );
        })
        .then(function (o) {
          var j = null;
          try { j = JSON.parse(o.t); } catch (err) { /* 非 JSON 也把开头带回去 */ }
          var link = linkOfJson(j);
          finish(link, 'HTTP' + o.st + ' ' + String(o.t || '').replace(/\s+/g, ' ').slice(0, 70));
        })
        .catch(function (e) {
          finish('', 'fetch异常 ' + ((e && e.message) || 'unknown'));
        });
    } catch (e2) {
      finish('', '构造异常 ' + ((e2 && e2.message) || 'unknown'));
    }
  }

  function fetchShare(goodsId, cb) {
    if (!goodsId) { cb(''); return; }

    var c = apiCache[goodsId];
    if (c && Date.now() - c.at < API_CACHE_TTL) { cb(c.link); return; }
    if (apiInflight[goodsId]) { apiInflight[goodsId].push(cb); return; }
    apiInflight[goodsId] = [cb];

    function done(link, notes) {
      var list = apiInflight[goodsId] || [];
      delete apiInflight[goodsId];
      if (link) {
        apiCache[goodsId] = { link: link, at: Date.now() };
        put(goodsId, link, 'api');
        diag.apiHit++;
      } else {
        diag.apiMiss++;
        diag.apiErr = String((notes || []).join(' | ')).slice(0, 200);
      }
      for (var i = 0; i < list.length; i++) {
        try { list[i](link); } catch (e) { /* 单个回调异常不影响其它 */ }
      }
    }

    // 同一路径试三种形态：相对路径 / 绝对路径 / 加时间戳防缓存。
    // 宁可多试两次（最坏多花几百毫秒），也别因为一个形态不合就白退面板。
    var base = '/shop-faas/mmecnodematerial/product?token=&lang=zh_CN&productId='
      + encodeURIComponent(goodsId);
    var urls = [base, location.origin + base, base + '&_=' + Date.now()];
    var notes = [];

    function attempt(i) {
      if (i >= urls.length) { done('', notes); return; }
      getOnce(urls[i], function (link, note) {
        if (link) { done(link, notes); return; }
        notes.push('#' + (i + 1) + ' ' + note);
        attempt(i + 1);
      });
    }
    attempt(0);
  }

  /* ---------- 应答隔离世界 ---------- */

  function reply(d, link, via) {
    var res = { source: TAG + '_RES', rid: d.rid, link: link || '', via: via || 'none' };
    if (d.wantDiag) res.diag = snapshot();
    try { window.postMessage(res, '*'); } catch (e) { /* 应答失败只能靠超时 */ }
  }

  window.addEventListener('message', function (e) {
    var d = e.data;
    if (!d || d.source !== TAG + '_REQ') return;

    awaitedId = d.goodsId || '';

    var link = '';
    var via = '';
    try {
      if (d.goodsId && map[d.goodsId]) { link = map[d.goodsId].link; via = 'net'; }
      if (!link) {
        var v = fromVue(d.goodsId, d.name);
        if (v) { link = v; via = 'vue'; }
      }
    } catch (err) {
      reply(d, '', 'error');
      return;
    }

    // 前面都没命中才主动查接口 —— 有缓存时这一步是纯内存查询
    if (link) { reply(d, link, via); return; }
    fetchShare(d.goodsId, function (l) { reply(d, l, l ? 'api' : 'none'); });
  }, false);
})();
