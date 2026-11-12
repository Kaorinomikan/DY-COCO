/**
 * 反馈小窗逻辑(2026-10-13 二次改)
 *
 * 定位:这是**兜底形态**。正常情况下面板以浮层注入到页面右上角(见 panel.js),
 *      只有「当前没有可注入的页面 / 老内核注入不可用」时才开这个独立小窗;
 *      降级原因由 background 经 URL 的 why 参数带进来,显示在顶部黄条里。
 *
 * 2026-10-13 改动(逐条对应用户反馈):
 *  1. **去掉「失焦即关」**。旧行为在用户实测中已确认有害 —— 用第三方截图工具
 *     截图时本窗必然失焦,被判成「点了屏幕外」而闪退,截图根本没法贴进来
 *     (这正是当初改成页面内浮层的原因)。现在只有点 X 才关。
 *  2. **补「截屏」按钮**:点它先把本窗最小化,由后台截底层窗口,截完自动还原 ——
 *     不会把小窗自己拍进图里。
 *  3. **补「粘贴截图」按钮**,与浮层面板一致;Ctrl+V 仍然直接可用。
 *  4. 截图 **1 张 → 3 张**,压缩参数与面板对齐(长边 2400 / 上限 4MB / 质量 0.92-0.8-0.65)。
 *  5. 连发间隔 **10 分钟 → 10 秒**(只挡误触连点,不再妨碍正常补发)。
 *  6. 截图不再走 chrome.storage(匿名上传会 401 MISSING_CREDENTIALS),
 *     压缩后转 base64 随记录一起提交,由后台写入 feedback 库。
 */
(function () {
  'use strict';

  var DRAFT_KEY = 'dycFeedbackDraft';
  var LEGACY_DRAFT_KEY = 'dyc_fb_draft';
  var draftQueue = Promise.resolve();
  var draftRevision = 0;
  var draftEpoch = 0;
  var draftCleared = false;
  var MAX_SHOTS = 3;
  var MAX_EDGE = 2400;                    // 长边上限(与面板同口径)
  var MAX_BYTES = 4 * 1024 * 1024;        // 单张入库上限(base64 长度)
  var COOLDOWN_MS = 10 * 1000;            // 连发间隔:10 秒
  // 邮件用缩略图规格（2026-10-13 新增，与浮层面板同口径）：
  // 长边 600、质量 0.65，超 120KB 再降到 0.5。原图 base64 太大，日报邮件装不下。
  var THUMB_EDGE = 600;
  var THUMB_LIMIT = 120 * 1024;

  var $ = function (id) { return document.getElementById(id); };
  var type = '功能问题';
  var shots = [];                         // [{ dataURI }]
  var submitting = false;
  var capturing = false;

  // ---- 初始化:参数 + 草稿恢复 ----
  var qs = new URLSearchParams(location.search);
  var extVersion = qs.get('v') || '';
  var extBrowser = qs.get('b') || navigator.userAgent;
  var why = qs.get('why') || '';
  function sourceId(name) {
    var value = qs.get(name);
    var id = Number(value);
    return value !== null && /^\d+$/.test(value) && Number.isSafeInteger(id) && id >= 0 ? id : null;
  }
  var sourceTabId = sourceId('sourceTabId');
  var sourceWindowId = sourceId('sourceWindowId');

  if (why) {
    var fb = $('fallback');
    fb.hidden = false;
    fb.innerHTML = '<b>当前页面无法显示悬浮反馈面板</b>,已改用独立窗口(原因:'
      + esc(why) + ')。功能完全一致。';
  }
  // 版本号行(#106 · 2026-10-24 迭代):标题栏改双 Tab 后,版本号挪到 Tab 行下。
  // 标题栏改双 Tab 后,「抖音可可助手」名号由降级黄条与窗口标题承担,这里只留版本号。
  $('verline').textContent = extVersion ? 'v' + extVersion : '';

  /* ---------- 顶部双 Tab(#106 · 2026-10-24 迭代,与页面内浮层同款) ---------- */
  function setTab(t) {
    document.querySelectorAll('.tab').forEach(function (el) {
      el.classList.toggle('on', el.getAttribute('data-tab') === t);
    });
    $('view-feedback').hidden = t !== 'feedback';
    $('view-changelog').hidden = t !== 'changelog';
    if (t === 'changelog') loadChangelog(false);
  }
  document.querySelectorAll('.tab').forEach(function (el) {
    el.addEventListener('click', function () {
      setTab(el.getAttribute('data-tab'));
    });
  });

  /* ---------- 更新日志(#106 · 2026-10-24 并入) ----------
     数据由后台代拉(Port dyc-changelog,页面内浮层同一条链路),这边只管渲染;
     渲染规则与 panel.js 同一段(两处各留一份,与表单代码既有的分工一致)。
     口径:单版失败该卡占位,整表失败出重试按钮。
     ★ #132(2026-11-07 用户口径):一次只展开 5 个版本,滑到底自动再展开 5 个;
       未展开的版本不向后台要日志(每个未缓存标签烧一次 API 配额,按需取省大半)。 */
  var clPort = null;
  var CL_PAGE_SIZE = 5;
  var clAll = [];
  var clShown = 0;
  var clCur = '';
  var clWebUrl = '';
  var clLastMoreAt = 0;

  function clCleanup(port) {
    if (clPort === port) clPort = null;
    try { port.disconnect(); } catch (e) { /* 已断则忽略 */ }
  }

  function clFmtDate(iso) {
    var t = Date.parse(iso);
    if (!isFinite(t)) return '';
    var d = new Date(t);
    var p = function (n) { return (n < 10 ? '0' : '') + n; };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }

  function loadChangelog(fresh) {
    if (clPort) clCleanup(clPort);
    var elStatus = $('cl-status');
    var elList = $('cl-list');
    elStatus.className = 'cl-status';
    elStatus.textContent = '正在读取版本列表…';
    elList.innerHTML = '';
    var port = clPort = chrome.runtime.connect({ name: 'dyc-changelog' });
    var started = false;
    port.onMessage.addListener(function (m) {
      if (!m) return;
      // 2026-11-06 起是四段式：done（首屏，含读取中占位）→ progress/patch
      // （边拉边补）→ complete（收尾）。done 之后不能断开，否则补全的历史版
      // 永远进不来（与 panel.js 保持同一口径）。
      if (m.type === 'progress') {
        refreshClStatus(elStatus);
        return;
      }
      if (m.type === 'done') {
        started = true;
        renderChangelog(elStatus, elList, m.data || {});
        return;
      }
      if (m.type === 'patch') {
        if (started) patchChangelog(elStatus, elList, m);
        return;
      }
      if (m.type === 'complete') {
        started = true;
        /* ★ #132:complete 不再断开 Port —— 滑到底还要按批向后台要日志。 */
        refreshClStatus(elStatus, elList);
        return;
      }
      if (m.type === 'error') {
        started = true;
        clFail(elStatus, elList, m.message || '后台响应异常');
        clCleanup(port);
      }
    });
    port.onDisconnect.addListener(function () {
      if (clPort === port) clPort = null;
      if (!started) {
        clFail(elStatus, elList, '后台连接中断（扩展可能刚更新过）');
      }
    });
    port.postMessage({ cmd: 'get', fresh: !!fresh });
    /* #132:滚动到底 → 再展开下一批。滚动容器是列表的父级(.cl-body)。 */
    var elScroll = elList.parentNode;
    if (elScroll) elScroll.__dycClTop = elScroll.scrollTop;
    if (elScroll && !elScroll.__dycClScroll) {
      elScroll.__dycClScroll = true;
      elScroll.addEventListener('scroll', function () {
        var top = elScroll.scrollTop;
        var downward = top > elScroll.__dycClTop;
        elScroll.__dycClTop = top;
        if (downward && top + elScroll.clientHeight >= elScroll.scrollHeight - 1) {
          clLoadMore(elStatus, elList);
        }
      });
    }
  }

  function clFail(elStatus, elList, whyMsg) {
    elStatus.className = 'cl-status err';
    elStatus.textContent = '读取失败：' + whyMsg;
    elList.innerHTML = '';
    var box = document.createElement('div');
    box.className = 'cl-retry';
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn';
    btn.textContent = '重试';
    btn.addEventListener('click', function () { loadChangelog(true); });
    box.appendChild(btn);
    elList.appendChild(box);
  }

  /** 单个版本卡片的正文 HTML。render 与 patch 共用。 */
  function clBodyHtml(r) {
    if (r.notes) {
      var h = '';
      if (r.notes.summary && !(r.notes.items || []).length) h += '<div class="cl-sum">' + esc(r.notes.summary) + '</div>';
      if (r.notes.items && r.notes.items.length) {
        h += '<ul class="cl-list">';
        for (var k = 0; k < r.notes.items.length; k++) {
          var text = r.notes.items[k];
          var split = text.search(/[。！!？?：:]/);
          var title = split < 0 ? text : text.slice(0, split);
          var detail = split < 0 ? '' : text.slice(split + 1).trim();
          h += '<li><strong>' + (k + 1) + '. ' + esc(title) + '</strong>'
            + (detail ? '<div>' + esc(detail) + '</div>' : '') + '</li>';
        }
        h += '</ul>';
      }
      return h;
    }
    if (r.loading) return '<div class="cl-miss">读取中…</div>';
    if (r.error) return '<div class="cl-miss">日志拉取失败：' + esc(r.error) + '</div>';
    return '<div class="cl-miss">该版本未附日志说明</div>';
  }

  function clStateOf(r) {
    if (r.notes) return 'ok';
    if (r.loading) return 'loading';
    if (r.error) return 'error';
    return 'missing';
  }

  /** 只统计已展开版本的结果，未查看的版本不计入读取状态。 */
  function refreshClStatus(elStatus) {
    var ok = 0, missing = 0, err = 0;
    for (var i = 0; i < clShown; i++) {
      var s = clStateOf(clAll[i]);
      if (s === 'ok') ok++;
      else if (s === 'error') err++;
      else if (s === 'missing') missing++;
    }
    var parts = [];
    if (ok) parts.push(ok + ' 个附日志');
    if (missing) parts.push(missing + ' 个未附日志');
    if (err) parts.push(err + ' 个拉取失败');
    elStatus.className = 'cl-status';
    if (!clAll.length) {
      elStatus.textContent = '没能读到任何版本的日志说明';
      return;
    }
    elStatus.textContent = '已展开 ' + clShown + ' / 共 ' + clAll.length + ' 个版本'
      + (parts.length ? ' · ' + parts.join(' · ') : '');
  }

  /** 单张版本卡(#132 抽出:首屏与续展共用)。 */
  function clCardEl(r) {
    var card = document.createElement('section');
    card.className = 'cl-card';
    card.setAttribute('data-cl-tag', r.tag);
    card.setAttribute('data-cl-state', clStateOf(r));
    card.innerHTML = '<div class="cl-head">'
      + '<span class="cl-no">' + esc(r.tag) + '</span>'
      + (r.date ? '<span class="cl-date">' + esc(clFmtDate(r.date)) + '</span>' : '')
      + (r.tag === clCur ? '<span class="cl-now">当前版本</span>' : '')
      + '</div>'
      + '<div class="cl-body">' + clBodyHtml(r) + '</div>';
    return card;
  }

  /** 往列表末尾追加下一批卡片,返回本批 tag(供向后台按需拉日志)。 */
  function clAppend(elList, n) {
    var tags = [];
    var end = Math.min(clShown + n, clAll.length);
    for (var i = clShown; i < end; i++) {
      elList.appendChild(clCardEl(clAll[i]));
      tags.push(clAll[i].tag);
    }
    clShown = end;
    return tags;
  }

  /** 列表末尾提示条:还有存货就提示往下滑,见底了就说见底了。 */
  function clMoreNote(elList) {
    var note = elList.querySelector('[data-cl-more]');
    if (!note) {
      note = document.createElement('div');
      note.className = 'cl-more';
      note.setAttribute('data-cl-more', '');
    }
    note.textContent = clShown >= clAll.length
      ? '已经到最早的版本了'
      : '继续向下滑动，展开更早的版本（每次 ' + CL_PAGE_SIZE + ' 个）';
    elList.appendChild(note);
  }

  /** 滑到底 → 再展开一批,并向后台按需拉这批版本的日志(#132)。 */
  function clLoadMore(elStatus, elList) {
    if (!clAll.length || clShown >= clAll.length) return;
    var now = Date.now();
    if (now - clLastMoreAt < 150) return;
    clLastMoreAt = now;
    var tags = clAppend(elList, CL_PAGE_SIZE);
    clMoreNote(elList);
    refreshClStatus(elStatus, elList);
    if (clPort && tags.length) {
      try { clPort.postMessage({ cmd: 'more', tags: tags }); } catch (e) { /* 断了就算了 */ }
    }
  }

  /** 浅拷贝一个版本条目(#132):done 快照归调用方所有,我们持有自己的副本。 */
  function clCloneItem(r) {
    return {
      tag: r.tag, date: r.date,
      notes: r.notes ? { summary: r.notes.summary, items: (r.notes.items || []).slice() } : null,
      loading: !!r.loading, error: r.error || '', missing: !!r.missing, fromCache: !!r.fromCache
    };
  }

  function renderChangelog(elStatus, elList, data) {
    clAll = (data.items || []).map(clCloneItem);
    clShown = 0;
    clCur = 'v' + (data.localVersion || extVersion);
    clWebUrl = data.webUrl || '';
    elList.innerHTML = '';
    clAppend(elList, data.pageSize || CL_PAGE_SIZE);
    clMoreNote(elList);
    var foot = document.createElement('div');
    foot.className = 'cl-foot';
    foot.innerHTML = '以上说明取自各版本标签随仓库提交的 RELEASE_NOTES，'
      + '完整文档见 <a id="cl-gitee">GitHub 仓库标签页</a>。';
    foot.querySelector('#cl-gitee').addEventListener('click', function () {
      if (clWebUrl) {
        try { window.open(clWebUrl, '_blank'); } catch (e) { /* 拦就拦了 */ }
      }
    });
    elList.appendChild(foot);
    refreshClStatus(elStatus, elList);
  }

  /** 单版结果到达 → 先更新全量数据,再就地替换那张卡(#132)。 */
  function patchChangelog(elStatus, elList, m) {
    var tag = String(m.tag || '');
    if (!tag) return;
    var idx = -1;
    for (var i = 0; i < clAll.length; i++) {
      if (clAll[i].tag === tag) { idx = i; break; }
    }
    if (idx < 0) return;
    clAll[idx] = {
      tag: tag,
      date: clAll[idx].date,
      notes: m.notes || null,
      loading: false,
      error: m.error || '',
      missing: !!m.missing
    };
    var cards = elList.querySelectorAll('.cl-card');
    var card = null;
    for (var j = 0; j < cards.length; j++) {
      if (cards[j].getAttribute('data-cl-tag') === tag) { card = cards[j]; break; }
    }
    if (!card) { refreshClStatus(elStatus, elList); return; }
    card.setAttribute('data-cl-state', clStateOf(clAll[idx]));
    var body = card.querySelector('.cl-body');
    if (body) body.innerHTML = clBodyHtml(clAll[idx]);
    refreshClStatus(elStatus, elList);
  }

  // 初始落位:URL 带 tab=changelog 时直接落在日志页(SW 兜底开窗时传入)。
  setTab(qs.get('tab') === 'changelog' ? 'changelog' : 'feedback');

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  var draftNote = document.querySelector('.note');
  if (draftNote) draftNote.textContent = '提交时附带扩展版本与勾选的附加信息（页面地址打码、输入内容不采集；各勾选行可展开查看实际内容）。草稿保存于扩展，重启后可恢复；保存失败会提示。';
  restoreDraft();

  // ---- 草稿：与浮层共享扩展私有存储，重启后可恢复 ----
  function draftStorage(method, value) {
    return new Promise(function (resolve, reject) {
      try {
        chrome.storage.local[method](value, function (result) {
          var err = chrome.runtime.lastError;
          if (err) reject(new Error(err.message || '草稿存储失败'));
          else resolve(result);
        });
      } catch (e) { reject(e); }
    });
  }
  function queueDraft(job, failure) {
    draftQueue = draftQueue.then(job).catch(function () {
      showMsg(failure, 'err');
      if (draftCleared) $('btns').style.display = '';
    });
    return draftQueue;
  }
  function removeLegacyDraft() {
    try { localStorage.removeItem(LEGACY_DRAFT_KEY); } catch (e) {}
  }
  function saveDraft() {
    draftCleared = false;
    draftRevision++;
    var epoch = draftEpoch;
    var d = {
      type: type,
      content: $('content').value,
      contact: $('contact').value,
      shots: shots.map(function (s) { return { d: s.dataURI, t: s.thumb || '' }; })
    };
    return queueDraft(function () {
      if (epoch !== draftEpoch) return;
      var values = {}; values[DRAFT_KEY] = d;
      return draftStorage('set', values).then(removeLegacyDraft);
    }, '草稿未保存，仍可提交反馈');
  }
  function restoreDraft() {
    var revision = draftRevision;
    var epoch = draftEpoch;
    return queueDraft(function () {
      return draftStorage('get', DRAFT_KEY).then(function (values) {
        if (epoch !== draftEpoch) return;
        var d = values && values[DRAFT_KEY];
        var raw = null;
        try { raw = localStorage.getItem(LEGACY_DRAFT_KEY); } catch (e) {}
        var migrated = Promise.resolve();
        if (!d && raw) {
          try { d = JSON.parse(raw); } catch (e) { return; }
          if (!d || typeof d !== 'object' || Array.isArray(d)) return;
          var next = {}; next[DRAFT_KEY] = d;
          migrated = draftStorage('set', next).then(removeLegacyDraft);
        } else if (d && raw) {
          var current = {}; current[DRAFT_KEY] = d;
          migrated = draftStorage('set', current).then(removeLegacyDraft);
        }
        return migrated.catch(function () {
          showMsg('草稿未保存，仍可提交反馈', 'err');
        }).then(function () {
          if (!d || epoch !== draftEpoch || revision !== draftRevision) return;
          type = d.type || '功能问题';
          document.querySelectorAll('.type-btn').forEach(function (b) {
            b.classList.toggle('on', b.dataset.v === type);
          });
          $('content').value = d.content || '';
          $('contact').value = d.contact || '';
          shots = [];
          (Array.isArray(d.shots) ? d.shots : []).slice(0, MAX_SHOTS).forEach(function (u) {
            if (typeof u === 'string') addShot(u, true);
            else addShot(u && u.d, true, (u && u.t) || '');
          });
          renderThumbs();
        });
      });
    }, '草稿未恢复，仍可填写反馈');
  }
  function clearDraft() {
    draftRevision++;
    draftEpoch++;
    draftCleared = true;
    return queueDraft(function () {
      return draftStorage('remove', DRAFT_KEY).then(removeLegacyDraft);
    }, '反馈已提交，草稿清理失败');
  }

  /**
   * 表单复位（2026-10-13 修，与浮层面板 panel.js 的 resetForm 同口径）。
   * 提交成功后调用：清空描述 / 联系方式 / 截图 / 类型，收回「反馈已提交」页，
   * 窗口留着不关 —— 用户可以直接接着写第二条。
   * （浮层那侧还多一个入口：每次打开面板时若发现停在成功页也要复位，见 panel.js。）
   */
  function resetForm() {
    type = '功能问题';
    document.querySelectorAll('.type-btn').forEach(function (b) {
      b.classList.toggle('on', b.dataset.v === '功能问题');
    });
    $('content').value = '';
    $('contact').value = '';
    $('file').value = '';
    shots = [];
    renderThumbs();
    $('done-view').style.display = 'none';
    $('form-view').style.display = '';
    $('btns').style.display = '';
    $('submit').disabled = false;
    submitting = false;
    showMsg('');
  }

  // ---- 只保留「点 X 才关」;不再监听 blur 自动关(见文件头第 1 条) ----
  $('xbtn').addEventListener('click', function () { window.close(); });
  ['content', 'contact'].forEach(function (id) {
    $(id).addEventListener('input', saveDraft);
  });

  // ---- 类型选择 ----
  $('types').addEventListener('click', function (e) {
    var btn = e.target.closest('.type-btn');
    if (!btn) return;
    type = btn.dataset.v;
    document.querySelectorAll('.type-btn').forEach(function (b) {
      b.classList.toggle('on', b === btn);
    });
    saveDraft();
  });

  /* ---------- 截图管理 ---------- */
  function addShot(dataURI, silent, thumb, from, dims) {
    if (shots.length >= MAX_SHOTS) { showMsg('最多放 3 张截图', 'err'); return false; }
    if (!dataURI) return false;
    shots.push({
      dataURI: dataURI,
      thumb: thumb || '',
      // 来源(capture/paste/file)、最终像素 —— 诊断包要如实报告截图的出处与规格
      from: from || 'unknown',
      w: (dims && dims.w) || 0,
      h: (dims && dims.h) || 0
    });
    renderThumbs();
    if (!silent) saveDraft();
    return true;
  }
  function removeShot(i) {
    shots.splice(i, 1);
    renderThumbs();
    saveDraft();
  }
  function renderThumbs() {
    var box = $('thumbs');
    box.innerHTML = '';
    shots.forEach(function (s, i) {
      var t = document.createElement('div');
      t.className = 'thumb';
      var img = document.createElement('img');
      img.src = s.dataURI;
      img.title = '点击放大预览';
      img.addEventListener('click', function () { previewShot(s.dataURI); });
      var rm = document.createElement('span');
      rm.className = 'rm';
      rm.textContent = '✕';
      rm.title = '移除';
      rm.addEventListener('click', function () { removeShot(i); });
      t.appendChild(img);
      t.appendChild(rm);
      box.appendChild(t);
    });
    $('drop').style.display = shots.length >= MAX_SHOTS ? 'none' : '';
  }
  function previewShot(dataURI) {
    var pv = document.createElement('div');
    pv.className = 'preview';
    var img = document.createElement('img');
    img.src = dataURI;
    pv.appendChild(img);
    document.body.appendChild(pv);
    pv.addEventListener('click', function () { pv.remove(); });
  }

  /** 生成邮件用缩略图（长边 600、质量 0.65；仍超 120KB 再降一档）。 */
  function makeThumb(img) {
    var longEdge = Math.max(img.width, img.height);
    var ratio = longEdge > THUMB_EDGE ? THUMB_EDGE / longEdge : 1;
    var cv = document.createElement('canvas');
    cv.width = Math.max(1, Math.round(img.width * ratio));
    cv.height = Math.max(1, Math.round(img.height * ratio));
    var ctx = cv.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, cv.width, cv.height);
    ctx.drawImage(img, 0, 0, cv.width, cv.height);
    var out = cv.toDataURL('image/jpeg', 0.65);
    if (out.length > THUMB_LIMIT) out = cv.toDataURL('image/jpeg', 0.5);
    return out;
  }

  /** 压缩 + 取舍:压完更大就退回原图(小图/已压缩 JPEG 重编码可能反而变大)。
   *  同时产出一张邮件用缩略图（2026-10-13 新增，与浮层面板同口径）。 */
  function compressShot(dataURI, done) {
    var img = new Image();
    img.onload = function () {
      var thumb = makeThumb(img);
      var longEdge = Math.max(img.width, img.height);
      var ratio = longEdge > MAX_EDGE ? MAX_EDGE / longEdge : 1;
      var cv = document.createElement('canvas');
      cv.width = Math.round(img.width * ratio);
      cv.height = Math.round(img.height * ratio);
      var ctx = cv.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, cv.width, cv.height);
      ctx.drawImage(img, 0, 0, cv.width, cv.height);
      var qualities = [0.92, 0.8, 0.65];
      var i = 0;
      var attempt = function () {
        var out = cv.toDataURL('image/jpeg', qualities[i]);
        if (out.length <= MAX_BYTES || i === qualities.length - 1) {
          if (out.length > MAX_BYTES) return done('图片压缩后仍超 4MB,请截小一点再发', null, 0);
          var keep = out.length < dataURI.length ? out : dataURI;
          // 如实报告「最终入库那张」的像素（保留原图时就是原图尺寸）
          done(null, keep, dataURI.length, thumb, keep === dataURI
            ? { w: img.width, h: img.height }
            : { w: cv.width, h: cv.height });
          return;
        }
        i++;
        attempt();
      };
      attempt();
    };
    img.onerror = function () { done('图片解析失败,请换一张', null, 0); };
    img.src = dataURI;
  }

  function takeShot(dataURI, from) {
    if (shots.length >= MAX_SHOTS) return showMsg('最多放 3 张截图', 'err');
    var epoch = draftEpoch;
    compressShot(dataURI, function (err, out, origLen, thumb, dims) {
      if (epoch !== draftEpoch) return;
      if (err) return showMsg(err, 'err');
      if (addShot(out, false, thumb, from, dims)) {
        var kb = Math.round((out.length * 0.75) / 1024);
        var oKB = Math.round((origLen * 0.75) / 1024);
        showMsg('已添加截图(' + oKB + 'KB → ' + kb + 'KB'
          + (out === dataURI ? ',原图已足够小' : '') + ')', 'ok');
      }
    });
  }

  /* ---------- 截屏:先把自己最小化,截完由后台还原 ---------- */
  // 2026-10-13 用户报「点完久久不回来」：还原动作原本完全托付给后台（SW 的 finally），
  // 后台若不回调（老内核 / SW 被回收）小窗就一直缩在任务栏里找不回来。
  // 加一道兜底：9 秒还没消息就自己还原窗口。
  var capRestored = false;
  function capRestore() {
    if (capRestored) return;
    capRestored = true;
    capturing = false;
    $('cap').disabled = false;
  }
  $('cap').addEventListener('click', function () {
    if (capturing) return;
    if (shots.length >= MAX_SHOTS) return showMsg('最多放 3 张截图', 'err');
    capturing = true;
    $('cap').disabled = true;
    showMsg('正在截取当前页面…');

    capRestored = false;
    var guard = setTimeout(function () {
      if (capRestored) return;
      capRestore();
      try {
        chrome.windows.update(chrome.windows.WINDOW_ID_CURRENT, { state: 'normal', focused: true }, function () {
          void chrome.runtime.lastError;
        });
      } catch (e) { /* 尽力而为 */ }
      showMsg('截屏没有响应，请重试', 'err');
    }, 9000);

    chrome.windows.getCurrent(function (w) {
      void chrome.runtime.lastError;
      var winId = (w && w.id) || null;
      var request = { type: 'dyc:captureScreenshot', hideWindowId: winId };
      if (sourceTabId !== null) request.sourceTabId = sourceTabId;
      if (sourceWindowId !== null) request.sourceWindowId = sourceWindowId;
      chrome.runtime.sendMessage(request, function (res) {
        clearTimeout(guard);
        capRestore();
        if (chrome.runtime.lastError) {
          return showMsg('截屏失败:' + friendlyErr(chrome.runtime.lastError.message || '扩展连接已断开'), 'err');
        }
        if (!res || !res.ok) return showMsg('截屏失败:' + friendlyErr((res && res.error) || '未知原因'), 'err');
        if (res.error) return showMsg('截屏失败：' + friendlyErr(res.error), 'err');
        takeShot(res.dataURI, 'capture');
      });
    });
  });

  /* ---------- 粘贴截图:一键读剪贴板(读不到就提示改用 Ctrl+V) ---------- */
  $('paste').addEventListener('click', function () {
    if (shots.length >= MAX_SHOTS) return showMsg('最多放 3 张截图', 'err');
    showMsg('正在读取剪贴板…');
    navigator.clipboard.read().then(function (items) {
      var imgItem = null;
      for (var i = 0; i < items.length; i++) {
        var ts = items[i].types || [];
        for (var j = 0; j < ts.length; j++) {
          if (ts[j].indexOf('image/') === 0) { imgItem = items[i]; break; }
        }
        if (imgItem) break;
      }
      if (!imgItem) {
        showMsg('剪贴板里没有图片;先用截图工具截图(或复制图片),再点本按钮', 'err');
        return;
      }
      var mime = imgItem.types.filter(function (t) { return t.indexOf('image/') === 0; })[0];
      return imgItem.getType(mime);
    }).then(function (blob) {
      if (!blob) return;   // 上一步已报错
      var fr = new FileReader();
      fr.onload = function () {
        showMsg('已从剪贴板贴入截图', 'ok');
        takeShot(fr.result, 'paste');
      };
      fr.onerror = function () { showMsg('剪贴板图片读取失败', 'err'); };
      fr.readAsDataURL(blob);
    }).catch(function (err) {
      var m = (err && err.message) || String(err || '');
      if (/denied|NotAllowed/i.test(m)) {
        showMsg('浏览器没给剪贴板读取权限;请直接在本窗按 Ctrl+V 粘贴截图', 'err');
      } else if (/focus/i.test(m)) {
        showMsg('请先点一下本窗再点「粘贴截图」', 'err');
      } else {
        showMsg('读取剪贴板失败:' + (m || '未知原因') + ';可改用 Ctrl+V', 'err');
      }
    });
  });

  /* ---------- 选择文件 / Ctrl+V ---------- */
  $('drop').addEventListener('click', function () {
    if (shots.length < MAX_SHOTS) $('file').click();
  });
  $('file').addEventListener('change', function (e) {
    var f = e.target.files && e.target.files[0];
    if (!f) return;
    if (f.type.indexOf('image/') !== 0) return showMsg('只支持图片文件', 'err');
    if (f.size > 20 * 1024 * 1024) return showMsg('图片超过 20MB,请换一张小些的', 'err');
    var fr = new FileReader();
    fr.onload = function () { takeShot(fr.result, 'file'); };
    fr.onerror = function () { showMsg('图片读取失败,请换一张', 'err'); };
    fr.readAsDataURL(f);
    $('file').value = '';
  });
  document.addEventListener('paste', function (e) {
    var items = (e.clipboardData && e.clipboardData.items) || [];
    for (var i = 0; i < items.length; i++) {
      if (items[i].type.indexOf('image/') === 0) {
        var f = items[i].getAsFile();
        if (f) {
          var fr = new FileReader();
          fr.onload = function () { takeShot(fr.result, 'paste'); };
          fr.readAsDataURL(f);
        }
        e.preventDefault();
        return;
      }
    }
  }, true);

  function showMsg(text, cls) {
    $('msg').textContent = text;
    $('msg').className = 'msg ' + (cls || '');
  }

  /** 后台透传过来的英文权限报错对用户没意义,翻成可照做的中文提示(与浮层同口径)。 */
  function friendlyErr(msg) {
    var m = msg || '';
    if (/activeTab|<all_urls>/i.test(m)) {
      return '截屏权限已失效，请重新点一次扩展图标（或刷新页面）后再试';
    }
    return m;
  }

  /* ---------- 诊断信息（2026-10-13 新增 · 反馈诊断包） ----------
     与浮层面板同口径：显示、**默认勾选**、可取消、可展开查看将要发出的内容。
     小窗是兜底形态，采集内核 diag.js 由本页 <script> 引入；它若因故没跑起来，
     如实提示，绝不假装采集成功。 */

  function diagApi() { return window.__dycDiag || null; }

  function shotMeta() {
    return shots.map(function (s) {
      var m = /^data:image\/([a-z0-9.+-]+);base64,/i.exec(s.dataURI || '');
      return {
        from: s.from || 'unknown',
        fmt: m ? m[1] : 'unknown',
        w: s.w || 0,
        h: s.h || 0,
        kb: Math.round(((s.dataURI || '').length * 0.75) / 1024)
      };
    });
  }

  function refreshDiagSum() {
    var d = diagApi();
    $('diag-sum').textContent = d ? d.countText() : '采集内核未就绪';
  }

  /** 采集诊断快照 → Promise<对象|null>；任何失败都 resolve(null)，绝不阻断提交 */
  function collectDiag(want) {
    return new Promise(function (resolve) {
      if (!want) return resolve(null);
      var d = diagApi();
      if (!d || typeof d.snapshot !== 'function') return resolve(null);
      var fin = false;
      var timer = setTimeout(function () { done(null); }, 1500);
      function done(v) {
        if (fin) return;
        fin = true;
        clearTimeout(timer);
        resolve(v);
      }
      // why 是小窗独有的信息 —— 它就是「为什么被迫用了兜底小窗」的原因
      var extra = { shots: shotMeta(), why: why };
      function go() { d.snapshot(extra).then(done, function () { done(null); }); }
      try {
        chrome.runtime.sendMessage({ type: 'dyc:diagCollectSW' }, function (res) {
          if (!chrome.runtime.lastError && res && res.ok && res.errors && res.errors.length) {
            extra.swErrors = res.errors;
          }
          go();
        });
      } catch (e) { go(); }
    });
  }

  var diagPreviewOn = false;
  $('diag-view').addEventListener('click', function () {
    if (diagPreviewOn) {
      $('diag-box').hidden = true;
      diagPreviewOn = false;
      $('diag-view').textContent = '查看';
      return;
    }
    if (!diagApi()) {
      showMsg('诊断采集内核未就绪（通常是扩展刚更新、还没重开反馈窗），本条将不带诊断信息', 'err');
      return;
    }
    $('diag-view').textContent = '读取中…';
    collectDiag(true).then(function (snap) {
      if (!snap) {
        $('diag-view').textContent = '查看';
        showMsg('诊断信息读取失败', 'err');
        return;
      }
      $('diag-box').textContent = JSON.stringify(snap, null, 2);
      $('diag-box').hidden = false;
      diagPreviewOn = true;
      $('diag-view').textContent = '收起';
    });
  });

  refreshDiagSum();

  /* ---------- 页面结构导出（2026-10-22 新增 · 反馈可选项） ----------
     与诊断行同款交互：显示、默认勾选、可取消、可展开预览。
     本窗是扩展页面（extPage），没有宿主页 DOM 可导 —— 采集内核会如实返回
     「无宿主页面结构可导」，预览与提交都不假装成功。 */

  function domApi() { return window.__dycDiag || null; }

  function refreshDomSum() {
    var d = domApi();
    $('dom-sum').textContent = (d && typeof d.domCountText === 'function')
      ? d.domCountText() : '采集内核未就绪';
  }

  /** 采集页面结构 → Promise<对象|null>；任何失败都 resolve(null)，绝不阻断提交 */
  function collectDomStruct(want) {
    return new Promise(function (resolve) {
      if (!want) return resolve(null);
      var d = domApi();
      if (!d || typeof d.domStructure !== 'function') return resolve(null);
      d.domStructure().then(function (r) {
        resolve(r && r.ok ? r : null);
      }, function () { resolve(null); });
    });
  }

  var domPreviewOn = false;
  $('dom-view').addEventListener('click', function () {
    if (domPreviewOn) {
      $('dom-box').hidden = true;
      domPreviewOn = false;
      $('dom-view').textContent = '查看';
      return;
    }
    var d = domApi();
    if (!d || typeof d.domStructure !== 'function') {
      showMsg('采集内核未就绪（通常是扩展刚更新、还没重开反馈窗），本条将不带页面结构', 'err');
      return;
    }
    $('dom-view').textContent = '读取中…';
    d.domStructure().then(function (r) {
      if (!r) {
        $('dom-view').textContent = '查看';
        showMsg('页面结构读取失败', 'err');
        return;
      }
      $('dom-box').textContent = d.domTreeText(r);
      $('dom-box').hidden = false;
      domPreviewOn = true;
      $('dom-view').textContent = '收起';
    });
  });

  refreshDomSum();

  // ---- 提交 ----
  $('submit').addEventListener('click', function () {
    if (submitting) return;
    var content = $('content').value.trim();
    if (!content) return showMsg('请先填写问题描述', 'err');
    if (content.length < 5) return showMsg('描述太短啦,至少写 5 个字,越具体越容易处理', 'err');
    if (new Set(content.split('')).size < 4) return showMsg('请描述具体内容,不要重复同一个字符哦', 'err');

    // 2026-10-13 用户定:连发间隔收到 10 秒,只挡误触连点。
    var lastTs = 0;
    try { lastTs = Number(localStorage.getItem('dyc_fb_last') || 0); } catch (e) {}
    if (Date.now() - lastTs < COOLDOWN_MS) {
      var left = Math.ceil((COOLDOWN_MS - (Date.now() - lastTs)) / 1000);
      return showMsg('刚提交过一条,请 ' + left + ' 秒后再发', 'err');
    }

    submitting = true;
    $('submit').disabled = true;
    showMsg('正在提交…');

    function fail(text) {
      submitting = false;
      $('submit').disabled = false;
      showMsg('提交失败:' + text, 'err');
    }

    // 诊断包与页面结构在这里采集：勾选才采；采不到 / 超时都不阻断提交 —— 反馈本身永远优先。
    // 两项并行采集（诊断 1.5s / 结构 3s 各有超时，总等待取最坏一项）。
    Promise.all([
      collectDiag(!!($('diag') && $('diag').checked)),
      collectDomStruct(!!($('domck') && $('domck').checked))
    ]).then(function (got) {
      var diagSnap = got[0];
      var domSnap = got[1];
      var rec = {
        type: type,
        content: content,
        contact: $('contact').value.trim() || null,
        version: extVersion || null,
        browser: extBrowser || null,
        screenshot_data: shots[0] ? shots[0].dataURI : null,
        screenshot_data2: shots[1] ? shots[1].dataURI : null,
        screenshot_data3: shots[2] ? shots[2].dataURI : null,
        // 邮件用缩略图（2026-10-13 新增列）：日报靠这三列把图内嵌进邮件正文
        screenshot_thumb1: shots[0] ? (shots[0].thumb || null) : null,
        screenshot_thumb2: shots[1] ? (shots[1].thumb || null) : null,
        screenshot_thumb3: shots[2] ? (shots[2].thumb || null) : null
      };
      // 诊断快照（2026-10-13 新增）：取消勾选时整条不带这个字段
      if (diagSnap) rec.diag = diagSnap;
      // 页面结构（2026-10-22 新增）：取消勾选时整条不带这个字段（同 diag 口径）
      if (domSnap) rec.page_structure = domSnap;

      try {
        chrome.runtime.sendMessage({ type: 'dyc:submitFeedback', record: rec }, function (res) {
          if (chrome.runtime.lastError) return fail(chrome.runtime.lastError.message || '扩展连接已断开');
          if (!res || !res.ok) return fail((res && res.error) || '未知原因');
          try { localStorage.setItem('dyc_fb_last', String(Date.now())); } catch (e) {}
          clearDraft();
          // 2026-10-13 用户定：成功后「清空 + 保留可继续写」（与浮层同口径）。
          // 先亮成功页做确认，随后复位成干净表单，窗口留着不关。
          $('form-view').style.display = 'none';
          $('btns').style.display = 'none';
          $('done-view').style.display = 'block';
          setTimeout(function () {
            var cleanupFailed = $('msg').textContent === '反馈已提交，草稿清理失败';
            resetForm();
            showMsg(cleanupFailed ? '反馈已提交，草稿清理失败' : '反馈已提交，感谢你的反馈！', cleanupFailed ? 'err' : 'ok');
          }, 1800);
        });
      } catch (e) {
        fail('扩展已更新,请重新打开反馈窗');
      }
    });
  });
})();
