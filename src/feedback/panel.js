/**
 * 反馈浮层 · 页面内右上角小面板(B 修改版,2026-10-12 用户定)
 *
 * 形态:不占整条右缘,只占右上角 —— 面板固定在视口右上、
 *       宽 340px、高自适应(最高 78vh 内部滚动),无遮罩、不压暗页面。
 * 开关:popup 点「反馈」→ background 注入本脚本 → 面板展开;
 *       点 X 关闭;再次点反馈 = 重新注入并打开(已注入则直接切换显隐)。
 * 截图:① Ctrl+V 粘贴;② 面板上「截屏」小按钮 → chrome.desktopCapture
 *       (需 background 转发)选屏后自动裁全屏并放入面板;最多 3 张。
 * 崩溃防护(2026-10-12 用户实测):旧版小窗「失焦即关」导致第三方截图工具
 *       取屏时被误判为点击屏幕外、面板直接闪退 —— 浮层方案天然不存在
 *       window 失焦问题,面板常驻直到用户主动关闭。
 * 样式隔离:Shadow DOM + all:initial,固定 px,不随页面缩放(个性化第 15 条)。
 */
(function () {
  'use strict';

  if (window.__dycFeedbackPanel) {
    window.__dycFeedbackPanel.toggle(true);
    return;
  }

  var VER = (typeof chrome !== 'undefined' && chrome.runtime)
    ? (chrome.runtime.getManifest().version || '') : '';
  var MAX_SHOTS = 3;
  var DRAFT_KEY = 'dycFeedbackDraft';
  var LEGACY_DRAFT_KEY = 'dyc_fb_draft2';
  var draftQueue = Promise.resolve();
  var draftRevision = 0;
  var draftEpoch = 0;
  var draftCleared = false;
  // 邮件用缩略图规格（2026-10-13 新增）：长边 600、JPEG 质量 0.65，超 120KB 再降到 0.5。
  // 为什么要单独存一份：原图 base64 可达 40 万字符，日报邮件承载不了；
  // 缩略图约 20~50KB，600px 又与邮件正文宽度（约 560px）基本一致，邮件里显示不糊。
  var THUMB_EDGE = 600;
  var THUMB_LIMIT = 120 * 1024;

  // 扩展升级/重载后旧隔离世界被销毁,但注入的 host DOM 仍留在页面里,
  // 表现为「一个关不掉的幽灵面板 + 新面板叠在一起」。启动时先清掉自己的旧 host。
  var staleHost = document.getElementById('dyc-fb-host');
  if (staleHost && staleHost.parentNode) staleHost.parentNode.removeChild(staleHost);

  var host = document.createElement('div');
  host.id = 'dyc-fb-host';
  host.style.cssText = 'position:fixed;top:0;right:0;z-index:2147483647;width:0;height:0;';
  var shadow = host.attachShadow({ mode: 'open' });

  var style = document.createElement('style');
  style.textContent = [
    ':host { all: initial; }',
    '* { box-sizing: border-box; margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, "Microsoft YaHei", sans-serif; }',
    '.panel {',
    '  all: initial;',
    '  position: fixed; top: 12px; right: 12px;',
    '  width: 340px; max-height: 78vh;',
    '  display: flex; flex-direction: column;',
    '  background: #ffffff; color: #1f2329; font-size: 13px;',
    '  border: 1px solid #e5e6eb; border-radius: 12px;',
    '  box-shadow: 0 8px 40px rgba(29,33,41,.18);',
    '  overflow: hidden;',
    '  animation: dycfb-in .22s ease-out;',
    '}',
    '@keyframes dycfb-in { from { opacity: 0; transform: translateY(-8px); } to { opacity: 1; transform: none; } }',
    '.panel.closing { opacity: 0; transform: translateY(-8px); transition: all .16s ease-in; }',
    // 头部(#106 · 2026-10-24 迭代):「反馈/更新日志」双 Tab 平分一行,✕ 固定右端 24px。
    '.head { display: flex; align-items: stretch; padding: 0 8px; flex-shrink: 0; }',
    '.tab { flex: 1 1 0; text-align: center; font-size: 13px; color: #86909c; cursor: pointer;',
    '  padding: 12px 0 9px; position: relative; user-select: none; }',
    '.tab.on { color: #1f2329; font-weight: 600; }',
    '.tab.on::after { content: ""; position: absolute; left: 22%; right: 22%; bottom: 0;',
    '  height: 2px; background: #ff7d00; border-radius: 1px; }',
    '.head .xbtn { flex: 0 0 24px; align-self: center; margin-bottom: 8px; }',
    // 版本号行:Tab 行下常驻一行小灰字,两个视图共用(拍板 ②)。
    '.verline { flex-shrink: 0; font-size: 10px; color: #86909c; padding: 3px 14px;',
    '  border-bottom: 1px solid #f2f3f5; }',
    '.xbtn { width: 24px; height: 24px; border: none; background: transparent; color: #86909c;',
    '  font-size: 14px; line-height: 1; cursor: pointer; border-radius: 4px; }',
    '.xbtn:hover { background: #f2f3f5; color: #1f2329; }',
    '.body { flex: 1; overflow-y: auto; padding: 12px 14px; }',
    '.field { margin-bottom: 11px; }',
    '.field label { display: block; font-size: 12px; color: #4e5969; margin-bottom: 5px; }',
    '.req { color: #f53f3f; }',
    '.types { display: flex; gap: 6px; flex-wrap: wrap; }',
    '.type-btn { padding: 4px 12px; border: 1px solid #d9dce1; border-radius: 5px; font-size: 12px;',
    '  color: #1f2329; background: #fff; cursor: pointer; }',
    '.type-btn.on { border-color: #ff7d00; color: #ff7d00; background: #fff7f0; }',
    'textarea, input[type=text] { width: 100%; border: 1px solid #d9dce1; border-radius: 6px;',
    '  padding: 7px 9px; font-size: 12px; color: #1f2329; font-family: inherit; background: #fff; }',
    'textarea { min-height: 72px; resize: vertical; }',
    'textarea:focus, input:focus { outline: none; border-color: #ff7d00; }',
    '.shot-bar { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }',
    '.shot-bar .lb { font-size: 12px; color: #4e5969; }',
    '.cap-btn { display: inline-flex; align-items: center; gap: 4px; padding: 3px 10px;',
    '  border: 1px solid #d9dce1; border-radius: 5px; background: #fff; color: #1f2329;',
    '  font-size: 11px; cursor: pointer; }',
    '.cap-btn:hover { border-color: #ff7d00; color: #ff7d00; }',
    '.cap-btn[disabled] { color: #c9cdd4; border-color: #e5e6eb; cursor: default; }',
    '.cap-hint { font-size: 10px; color: #86909c; }',
    '.thumbs { display: flex; gap: 6px; flex-wrap: wrap; }',
    '.thumb { position: relative; width: 92px; height: 62px; border: 1px solid #e5e6eb;',
    '  border-radius: 6px; overflow: hidden; background: #f7f8fa; }',
    '.thumb img { width: 100%; height: 100%; object-fit: cover; display: block; cursor: pointer; }',
    '.thumb .rm { position: absolute; top: 2px; right: 2px; width: 16px; height: 16px;',
    '  border-radius: 50%; background: rgba(29,33,41,.55); color: #fff; font-size: 10px;',
    '  line-height: 16px; text-align: center; cursor: pointer; }',
    '.thumb .rm:hover { background: #f53f3f; }',
    '.drop { border: 1px dashed #c9cdd4; border-radius: 6px; padding: 9px; text-align: center;',
    '  color: #86909c; font-size: 11px; line-height: 1.6; cursor: pointer; }',
    '.drop:hover { border-color: #ff7d00; color: #4e5969; }',
    '.note { padding: 7px 9px; background: #f7f8fa; border-radius: 6px; font-size: 10px;',
    '  color: #4e5969; line-height: 1.6; margin-bottom: 10px; }',
    '.foot { display: flex; align-items: center; gap: 8px; padding: 9px 14px; border-top: 1px solid #f2f3f5; flex-shrink: 0; }',
    '.msg { flex: 1; font-size: 11px; min-height: 14px; line-height: 1.5; }',
    '.msg.ok { color: #00b42a; } .msg.err { color: #f53f3f; }',
    '.btn { padding: 5px 14px; border-radius: 5px; font-size: 12px; cursor: pointer; border: 1px solid #d9dce1; background: #fff; color: #1f2329; }',
    '.btn.main { border-color: #ff7d00; background: #ff7d00; color: #fff; }',
    '.btn.main:hover { background: #e56f00; }',
    '.btn.main[disabled] { background: #fbc899; border-color: #fbc899; cursor: default; }',
    '.done { text-align: center; padding: 40px 20px; display: none; }',
    '.done .ic { width: 40px; height: 40px; border-radius: 50%; background: #e8ffea; margin: 0 auto;',
    '  display: flex; align-items: center; justify-content: center; }',
    '.done h2 { font-size: 14px; font-weight: 500; margin-top: 10px; }',
    '.done p { font-size: 11px; color: #86909c; margin-top: 5px; line-height: 1.7; }',
    '.diag { margin-bottom: 10px; padding: 8px 9px; background: #f7f8fa; border-radius: 6px; }',
    '.diag-top { display: flex; align-items: center; gap: 6px; }',
    '.diag-ck { display: flex; align-items: center; gap: 5px; font-size: 11px; color: #1f2329; cursor: pointer; }',
    '.diag-ck input { margin: 0; width: 12px; height: 12px; flex-shrink: 0; }',
    '.diag-sum { flex: 1; font-size: 10px; color: #86909c; text-align: right; overflow: hidden;',
    '  text-overflow: ellipsis; white-space: nowrap; }',
    '.diag-view { flex-shrink: 0; font-size: 10px; color: #ff7d00; cursor: pointer; }',
    '.diag-view:hover { text-decoration: underline; }',
    '.diag-box { margin: 7px 0 0; max-height: 150px; overflow: auto; padding: 7px 8px;',
    '  background: #fff; border: 1px solid #e5e6eb; border-radius: 5px;',
    '  font: 10px/1.55 Consolas, "Courier New", monospace; color: #4e5969;',
    '  white-space: pre-wrap; word-break: break-all; }',
    // 视图容器(#106 迭代):两个 Tab 各自一个 view,切换 = hidden 切换,DOM 状态互不干扰。
    '.view { flex: 1; min-height: 0; display: flex; flex-direction: column; }',
    '.view[hidden] { display: none; }',
    // 更新日志视图(#106 · 2026-10-24 并入):版本卡片列表,与原独立日志页同口径。
    '.cl-body { flex: 1; min-height: 0; overflow-y: auto; padding: 12px 14px; }',
    '.cl-status { font-size: 11px; color: #86909c; line-height: 1.6; margin-bottom: 8px; }',
    '.cl-status.err { color: #f53f3f; }',
    '.cl-card { border: 1px solid #e5e6eb; border-radius: 6px; padding: 8px 10px; margin-bottom: 8px; background: #fff; }',
    '.cl-head { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }',
    '.cl-no { font-size: 12px; font-weight: 600; color: #1f2329; }',
    '.cl-date { font-size: 10px; color: #86909c; }',
    '.cl-now { font-size: 10px; color: #ff7d00; border: 1px solid #ff7d00; border-radius: 3px; padding: 0 4px; }',
    '.cl-sum { font-size: 11px; color: #4e5969; margin-top: 4px; line-height: 1.6; }',
    '.cl-list { margin: 5px 0 0; padding-left: 16px; }',
    '.cl-list li { font-size: 11px; color: #4e5969; line-height: 1.6; }',
    '.cl-miss { font-size: 10px; color: #86909c; margin-top: 4px; line-height: 1.6; }',
    '.cl-foot { font-size: 10px; color: #86909c; line-height: 1.7; margin-top: 2px; }',
    '.cl-foot a { color: #ff7d00; text-decoration: none; cursor: pointer; }',
    '.cl-foot a:hover { text-decoration: underline; }',
    '.cl-retry { text-align: center; padding: 6px 0 2px; }'
  ].join('\n');

  var panel = document.createElement('div');
  panel.className = 'panel';
  panel.innerHTML =
    '<div class="head">' +
      '<div class="tab on" data-tab="feedback">反馈</div>' +
      '<div class="tab" data-tab="changelog">更新日志</div>' +
      '<button class="xbtn" data-x title="关闭">✕</button>' +
    '</div>' +
    '<div class="verline" data-verline></div>' +
    '<div class="view" data-view="feedback">' +
    '<div class="body" data-form>' +
      '<div class="field"><label>反馈类型 <span class="req">*</span></label>' +
        '<div class="types" data-types>' +
          '<span class="type-btn on" data-v="功能问题">功能问题</span>' +
          '<span class="type-btn" data-v="功能建议">功能建议</span>' +
          '<span class="type-btn" data-v="其他">其他</span>' +
        '</div></div>' +
      '<div class="field"><label>问题描述 <span class="req">*</span></label>' +
        '<textarea data-content placeholder="请描述你遇到的问题或想提的建议，越具体越好"></textarea></div>' +
      '<div class="field"><label>截图（可选，最多 3 张）</label>' +
        '<div class="shot-bar">' +
          '<button class="cap-btn" data-cap>' +
            '<svg width="12" height="12" viewBox="0 0 24 24" fill="none"><path d="M4 8h3l2-3h6l2 3h3v11H4V8z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><circle cx="12" cy="13" r="3.2" stroke="currentColor" stroke-width="1.8"/></svg>' +
            '截屏</button>' +
          '<button class="cap-btn" data-paste>' +
            '<svg width="12" height="12" viewBox="0 0 24 24" fill="none"><rect x="5" y="4" width="14" height="17" rx="2" stroke="currentColor" stroke-width="1.8"/><path d="M9 4V2.8A1.8 1.8 0 0 1 10.8 1h2.4A1.8 1.8 0 0 1 15 2.8V4" stroke="currentColor" stroke-width="1.8"/></svg>' +
            '粘贴截图</button>' +
          '<span class="cap-hint">用系统截图工具后点此一键贴入</span>' +
        '</div>' +
        '<div class="thumbs" data-thumbs></div>' +
        '<div class="drop" data-drop style="margin-top:6px;">点击选择图片，或直接 Ctrl+V 粘贴截图<br>大图会自动压缩</div>' +
        '<input type="file" data-file accept="image/*" hidden>' +
      '</div>' +
      '<div class="field"><label>联系方式（可选）</label>' +
        '<input type="text" data-contact placeholder="微信号 / 手机号，方便我们回访"></div>' +
      // 诊断信息行（2026-10-13 用户评审定：显示、默认开、可取消、可展开查看）
      '<div class="diag">' +
        '<div class="diag-top">' +
          '<label class="diag-ck"><input type="checkbox" data-diag checked><span>附带诊断信息</span></label>' +
          '<span class="diag-sum" data-diag-sum></span>' +
          '<span class="diag-view" data-diag-view>查看</span>' +
        '</div>' +
        '<pre class="diag-box" data-diag-box hidden></pre>' +
      '</div>' +
      // 页面结构行（2026-10-22 新增，与诊断行同款交互：显示、默认勾选、可取消、可展开预览）
      '<div class="diag">' +
        '<div class="diag-top">' +
          '<label class="diag-ck"><input type="checkbox" data-domck checked><span>导出页面结构</span></label>' +
          '<span class="diag-sum" data-dom-sum></span>' +
          '<span class="diag-view" data-dom-view>查看</span>' +
        '</div>' +
        '<pre class="diag-box" data-dom-box hidden></pre>' +
      '</div>' +
      '<div class="note">提交时附带扩展版本与勾选的附加信息（页面地址打码、输入内容不采集；各勾选行可展开查看实际内容）。草稿保存于扩展，重启后可恢复；保存失败会提示。</div>' +
    '</div>' +
    '<div class="foot" data-foot>' +
      '<span class="msg" data-msg></span>' +
      '<button class="btn main" data-submit>提交反馈</button>' +
    '</div>' +
    '<div class="done" data-done>' +
      '<div class="ic"><svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M5 12.5L10 17.5L19 7.5" stroke="#00b42a" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg></div>' +
      '<h2>反馈已提交</h2><p>感谢你的反馈！我们每天会汇总查看。</p>' +
    '</div>' +
    '</div>' +
    '<div class="view" data-view="changelog" hidden>' +
      '<div class="cl-body">' +
        '<div class="cl-status" data-cl-status></div>' +
        '<div data-cl-list></div>' +
      '</div>' +
    '</div>';

  shadow.appendChild(style);
  shadow.appendChild(panel);
  document.documentElement.appendChild(host);

  var $ = function (sel) { return panel.querySelector(sel); };
  var elMsg = $('[data-msg]');
  var elThumbs = $('[data-thumbs]');
  var elDrop = $('[data-drop]');
  var elFile = $('[data-file]');
  var elCap = $('[data-cap]');
  var elSubmit = $('[data-submit]');
  var elDiagCk = $('[data-diag]');
  var elDiagSum = $('[data-diag-sum]');
  var elDiagView = $('[data-diag-view]');
  var elDiagBox = $('[data-diag-box]');
  var elDomCk = $('[data-domck]');
  var elDomSum = $('[data-dom-sum]');
  var elDomView = $('[data-dom-view]');
  var elDomBox = $('[data-dom-box]');

  var state = {
    type: '功能问题',
    // [{dataURI, thumb, from, w, h}] —— from/w/h 供诊断包的 shots 元信息使用
    shots: [],
    submitting: false,
    capturing: false
  };
  $('[data-verline]').textContent = VER ? 'v' + VER : '';

  /* ---------- 草稿 ---------- */
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
      if (draftCleared) $('[data-foot]').style.display = '';
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
      type: state.type,
      content: $('[data-content]').value,
      contact: $('[data-contact]').value,
      shots: state.shots.map(function (s) { return { d: s.dataURI, t: s.thumb || '' }; })
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
          // 共享草稿已存在时保留它，确认扩展写入成功后再清旧副本。
          var current = {}; current[DRAFT_KEY] = d;
          migrated = draftStorage('set', current).then(removeLegacyDraft);
        }
        return migrated.catch(function () {
          showMsg('草稿未保存，仍可提交反馈', 'err');
        }).then(function () {
          if (!d || epoch !== draftEpoch || revision !== draftRevision) return;
          state.type = d.type || '功能问题';
          panel.querySelectorAll('.type-btn').forEach(function (b) {
            b.classList.toggle('on', b.getAttribute('data-v') === state.type);
          });
          $('[data-content]').value = d.content || '';
          $('[data-contact]').value = d.contact || '';
          state.shots = [];
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

  /* ---------- 消息 ---------- */
  function showMsg(text, cls) {
    elMsg.textContent = text || '';
    elMsg.className = 'msg' + (cls ? ' ' + cls : '');
  }

  /* ---------- 勾选项复位（#107 · 2026-10-23） ----------
     诊断 / 页面结构两行默认都勾上；「每次打开面板」都要回到这个默认态。
     之前只有 HTML 里的 checked 属性管第一次渲染，之后用户取消勾选的状态
     会一直留着（草稿只存类型 / 描述 / 联系方式 / 截图，不存勾选）——
     于是「上一次没勾、这一次想勾」的人每次都得手动补勾。 */
  function resetChecks() {
    if (elDiagCk) elDiagCk.checked = true;
    if (elDomCk) elDomCk.checked = true;
  }

  /* ---------- 表单复位（2026-10-13 修「成功页粘住、内容清不掉」） ----------
     提交成功后、以及每次打开面板前都走这里：描述 / 联系方式 / 截图 / 类型
     全部清空，表单区与底栏恢复显示，「反馈已提交」页收回。
     之前的写法只调 clearDraft()（只清 localStorage 草稿），DOM 原样留着 ——
     于是成功页一旦出现就再没有复位过：面板是常驻页面里的，只要该标签页不刷新，
     用户关掉面板、关掉浏览器窗口后再点「反馈」（走 dyc:fbToggle 复用同一份面板），
     看到的仍然是那张成功页。 */
  function resetForm() {
    state.type = '功能问题';
    resetChecks();                        // 勾选项一并回到默认（#107）
    panel.querySelectorAll('.type-btn').forEach(function (b) {
      b.classList.toggle('on', b.getAttribute('data-v') === '功能问题');
    });
    $('[data-content]').value = '';
    $('[data-contact]').value = '';
    elFile.value = '';
    state.shots = [];
    renderThumbs();                       // 顺带把 elDrop 的显隐也复位
    $('[data-done]').style.display = 'none';
    $('[data-form]').style.display = '';
    $('[data-foot]').style.display = '';
    elSubmit.disabled = false;
    state.submitting = false;
    showMsg('');
  }
  function isDoneShown() { return $('[data-done]').style.display === 'block'; }

  // 开始写新内容时把上一次的成功/失败提示收掉（不然「反馈已提交」会一直挂在底栏）
  ['[data-content]', '[data-contact]'].forEach(function (sel) {
    $(sel).addEventListener('input', function () {
      if (elMsg.textContent) showMsg('');
      saveDraft();
    });
  });

  /* ---------- 截图管理 ---------- */
  function addShot(dataURI, silent, thumb, from, dims) {
    if (state.shots.length >= MAX_SHOTS) { showMsg('最多放 3 张截图', 'err'); return false; }
    if (!dataURI) return false;
    state.shots.push({
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
    state.shots.splice(i, 1);
    renderThumbs();
    saveDraft();
  }
  function renderThumbs() {
    elThumbs.innerHTML = '';
    state.shots.forEach(function (s, i) {
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
      elThumbs.appendChild(t);
    });
    elDrop.style.display = state.shots.length >= MAX_SHOTS ? 'none' : '';
  }
  function previewShot(dataURI) {
    var pv = document.createElement('div');
    pv.id = 'dyc-fb-pv';   // 截屏前要按 id 把它一起藏起来(它挂在 documentElement 下,不在宿主里)
    pv.style.cssText = 'all:initial;position:fixed;inset:0;z-index:2147483647;' +
      'background:rgba(29,33,41,.72);display:flex;align-items:center;justify-content:center;cursor:zoom-out;';
    var img = document.createElement('img');
    img.src = dataURI;
    img.style.cssText = 'max-width:86vw;max-height:86vh;border-radius:8px;box-shadow:0 8px 40px rgba(0,0,0,.4);';
    pv.appendChild(img);
    document.documentElement.appendChild(pv);
    pv.addEventListener('click', function () { pv.remove(); });
  }

  function takeShot(dataURI, from) {
    if (state.shots.length >= MAX_SHOTS) return showMsg('最多放 3 张截图', 'err');
    // 压缩并做「取更小者」取舍(沿用旧口径)，同时产出一张邮件用缩略图
    var epoch = draftEpoch;
    compressShot(dataURI, function (err, out, origLen, thumb, dims) {
      if (epoch !== draftEpoch) return;
      if (err) return showMsg(err, 'err');
      if (addShot(out, false, thumb, from, dims)) {
        var kb = Math.round((out.length * 0.75) / 1024);
        var oKB = Math.round((origLen * 0.75) / 1024);
        showMsg('已添加截图(' + oKB + 'KB → ' + kb + 'KB' + (out === dataURI ? ',原图已足够小' : '') + ')', 'ok');
      }
    });
  }

  /** 生成邮件用缩略图（长边 600，质量 0.65；仍超 120KB 再降一档）。 */
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

  function compressShot(dataURI, done) {
    var img = new Image();
    img.onload = function () {
      // 2026-10-12 用户反馈「压缩太狠很糊」,三处放宽:
      //   长边 1600→2400(高分屏截图不再缩得面目全非)
      //   首档质量 0.85→0.92,降档序列同步放缓(0.92→0.8→0.65)
      //   入库上限 2MB→4MB(云端 TEXT 列容量足够,XML 日报里引用路径不受影响)
      var MAX = 2400;
      var thumb = makeThumb(img);          // 邮件专用小图，与入库原图分开
      var longEdge = Math.max(img.width, img.height);
      var ratio = longEdge > MAX ? MAX / longEdge : 1;
      var cv = document.createElement('canvas');
      cv.width = Math.round(img.width * ratio);
      cv.height = Math.round(img.height * ratio);
      var ctx = cv.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, cv.width, cv.height);
      ctx.drawImage(img, 0, 0, cv.width, cv.height);
      var qualities = [0.92, 0.8, 0.65];
      var LIMIT = 4 * 1024 * 1024;
      var i = 0;
      var attempt = function () {
        var out = cv.toDataURL('image/jpeg', qualities[i]);
        if (out.length <= LIMIT || i === qualities.length - 1) {
          if (out.length > LIMIT) return done('图片压缩后仍超 4MB,请截小一点再发', null, 0);
          var keep = out.length < dataURI.length ? out : dataURI;
          // 如实报告「最终入库那张」的像素:保留原图时就是原图尺寸
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

  /* ---------- 截图期间「把反馈界面从画面上彻底拿掉」 ---------- */
  // 2026-10-13 四次修(用户报「截图还是截到了反馈界面」)：
  // 只把 panel 设成 display:none、紧接着就发消息去抓帧，是不够的 ——
  // display:none 只是改了样式，浏览器要等下一次合成才真正把它从画面里去掉；
  // 而老内核(360 极速浏览器X)的 captureVisibleTab 常常把「上一帧」交回来，
  // 于是抓到的仍是没藏起来的面板。
  // 现在分三道保险(第③道在 service-worker 的 captureVisibleTabSafe)：
  //   ① 藏的范围放宽到「扩展自己的全部 UI」—— 不只是本面板，还包括大图预览层、
  //      左下角 DY-COCO 品牌标记、历史盒子，以及以后任何以 dyb-/dyc- 命名的注入元素。
  //      做法是「按前缀逐个隐藏 + 记下原值」，而不是往 head 插 <style>：
  //      内联 style 属性不受页面 CSP 对 style-src 的约束，抖店这类严格 CSP 页面也稳。
  //   ② 显式等两帧 + 220ms 再发消息(见 waitPaint)，确保合成真的发生过了。
  var captureHidden = null;
  function hideForCapture() {
    if (captureHidden) return;
    captureHidden = [];
    var list = document.querySelectorAll(
      '[id^="dyb-"],[id^="dyc-"],[class^="dyb-"],[class*=" dyb-"],[class^="dyc-"],[class*=" dyc-"]'
    );
    for (var i = 0; i < list.length; i++) {
      var el = list[i];
      captureHidden.push([el, el.style.display]);
      el.style.display = 'none';
    }
  }
  function showForCapture() {
    if (!captureHidden) return;
    for (var i = 0; i < captureHidden.length; i++) {
      var el = captureHidden[i][0];
      var prev = captureHidden[i][1];
      if (el && el.parentNode) el.style.display = prev;
    }
    captureHidden = null;
  }

  /** 后台透传过来的英文权限报错对用户没意义,翻成可照做的中文提示。 */
  function friendlyErr(msg) {
    var m = msg || '';
    if (/activeTab|<all_urls>/i.test(m)) {
      return '截屏权限已失效，请重新点一次扩展图标（或刷新页面）后再试';
    }
    return m;
  }

  /** 等浏览器真正重绘一帧再回调(双 rAF + 一段缓冲),老内核不支持 rAF 时退化为定时器。 */
  function waitPaint(cb) {
    var raf = window.requestAnimationFrame || function (f) { return setTimeout(f, 17); };
    raf(function () {
      raf(function () {
        setTimeout(cb, 220);
      });
    });
  }

  /* ---------- 唤起截图(captureVisibleTab 经 background 转发) ---------- */
  // 2026-10-12 用户定:点截屏时不能把反馈面板自己截进去。
  elCap.addEventListener('click', function () {
    if (state.capturing) return;
    if (state.shots.length >= MAX_SHOTS) return showMsg('最多放 3 张截图', 'err');
    state.capturing = true;
    elCap.disabled = true;
    hideForCapture();                       // ① 先藏(含宿主与预览层)
    showMsg('正在截取当前页面…');

    // 2026-10-13 用户报「点完久久不回来」：恢复面板原本只写在 sendMessage 的回调里，
    // 老内核上后台不回调（或 SW 被回收后没应答）时，面板就一直藏在 display:none 里，
    // 页面上再也找不到反馈入口。兜底计时器保证「后台答不答，面板一定会回来」。
    var restored = false;
    function restorePanel() {
      if (restored) return;
      restored = true;
      showForCapture();
      state.capturing = false;
      elCap.disabled = false;
    }
    var guard = setTimeout(function () {
      if (restored) return;
      restorePanel();
      showMsg('截屏没有响应，可再点一次；若反复失败请改用 Ctrl+V 粘贴截图', 'err');
    }, 9000);

    // ② 等画面真的更新了再去抓，否则老内核会交回「藏起来之前」的那一帧
    waitPaint(function () {
      chrome.runtime.sendMessage({ type: 'dyc:captureScreenshot' }, function (res) {
        clearTimeout(guard);
        // 无论成败,先恢复(截图已经拍完了,不影响画面)；重复调用是幂等的
        restorePanel();
        if (chrome.runtime.lastError || !res || !res.ok) {
          showMsg('截屏失败:' + friendlyErr((res && res.error) || (chrome.runtime.lastError && chrome.runtime.lastError.message) || '未知原因'), 'err');
          return;
        }
        if (res.error) {
          showMsg('截屏失败：' + friendlyErr(res.error), 'err');
          return;
        }
        takeShot(res.dataURI, 'capture');
      });
    });
  });

  /* ---------- 粘贴截图按钮:一键读剪贴板图片(2026-10-12 用户定) ---------- */
  var elPaste = $('[data-paste]');
  elPaste.addEventListener('click', function () {
    if (state.shots.length >= MAX_SHOTS) return showMsg('最多放 3 张截图', 'err');
    showMsg('正在读取剪贴板…');
    // Clipboard API 读图片需要页面处于焦点(浮层是页面内元素,满足);
    // navigator.clipboard.read 在抖店后台 https 环境可用。
    navigator.clipboard.read().then(function (items) {
      var imgItem = null;
      for (var i = 0; i < items.length; i++) {
        var t = items[i].types || [];
        for (var j = 0; j < t.length; j++) {
          if (t[j].indexOf('image/') === 0) { imgItem = items[i]; break; }
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
      var msg = (err && err.message) || String(err || '');
      if (/denied|NotAllowed/i.test(msg)) {
        showMsg('浏览器没给剪贴板读取权限;可改用 Ctrl+V 直接粘贴到面板', 'err');
      } else if (/focus/i.test(msg)) {
        showMsg('请先点一下页面再点「粘贴截图」', 'err');
      } else {
        showMsg('读取剪贴板失败:' + (msg || '未知原因') + ';可改用 Ctrl+V', 'err');
      }
    });
  });

  /* ---------- 选择 / 粘贴(Ctrl+V) ---------- */
  elDrop.addEventListener('click', function () {
    if (state.shots.length < MAX_SHOTS) elFile.click();
  });
  elFile.addEventListener('change', function (e) {
    var f = e.target.files && e.target.files[0];
    if (!f) return;
    if (f.type.indexOf('image/') !== 0) return showMsg('只支持图片文件', 'err');
    if (f.size > 20 * 1024 * 1024) return showMsg('图片超过 20MB,请换一张小些的', 'err');
    var fr = new FileReader();
    fr.onload = function () { takeShot(fr.result, 'file'); };
    fr.onerror = function () { showMsg('图片读取失败,请换一张', 'err'); };
    fr.readAsDataURL(f);
    elFile.value = '';
  });
  document.addEventListener('paste', function (e) {
    if (!panel.isConnected) return;
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

  /* ---------- 类型选择 ---------- */
  $('[data-types]').addEventListener('click', function (e) {
    var btn = e.target.closest('.type-btn');
    if (!btn) return;
    state.type = btn.getAttribute('data-v');
    panel.querySelectorAll('.type-btn').forEach(function (b) {
      b.classList.toggle('on', b === btn);
    });
    saveDraft();
  });

  /* ---------- 顶部双 Tab(#106 · 2026-10-24 迭代) ----------
     反馈 / 更新日志两个视图互不干扰:切换只是 hidden 切换,表单写一半切去
     日志再切回,内容原样保留(成功页同理)。每次 open() 回到「反馈」,
     除非调用方明确要落在日志(dyc:openFeedback mode:'changelog')。 */
  function setTab(t) {
    panel.querySelectorAll('.tab').forEach(function (el) {
      el.classList.toggle('on', el.getAttribute('data-tab') === t);
    });
    panel.querySelectorAll('.view').forEach(function (el) {
      el.hidden = el.getAttribute('data-view') !== t;
    });
    if (t === 'changelog') loadChangelog(false);
  }
  panel.querySelectorAll('.tab').forEach(function (el) {
    el.addEventListener('click', function () {
      setTab(el.getAttribute('data-tab'));
    });
  });

  /* ---------- 更新日志视图(#106 · 2026-10-24 并入) ----------
     数据一律由后台代拉(content script 的 fetch 以宿主页为源,会被页面 CSP 拦),
     这边只管渲染:Port(dyc-changelog) 收 {progress|done|error} 三种事件。
     渲染口径与原独立日志页一致:单版失败该卡占位,整表失败出重试按钮。 */
  var clPort = null;

  function clCleanup(port) {
    if (clPort === port) clPort = null;
    try { port.disconnect(); } catch (e) { /* 已断则忽略 */ }
  }

  function clEsc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /** ISO → YYYY-MM-DD;解析不出返回空串,卡上不显示日期。 */
  function clFmtDate(iso) {
    var t = Date.parse(iso);
    if (!isFinite(t)) return '';
    var d = new Date(t);
    var p = function (n) { return (n < 10 ? '0' : '') + n; };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }

  function loadChangelog(fresh) {
    if (clPort) clCleanup(clPort);
    var elStatus = $('[data-cl-status]');
    var elList = $('[data-cl-list]');
    elStatus.className = 'cl-status';
    elStatus.textContent = '正在读取版本列表…';
    elList.innerHTML = '';
    var port = clPort = chrome.runtime.connect({ name: 'dyc-changelog' });
    var settled = false;
    port.onMessage.addListener(function (m) {
      if (settled) return;
      if (m && m.type === 'progress') {
        elStatus.textContent = '正在读取各版日志…（' + m.done + '/' + m.total + '）';
        return;
      }
      settled = true;
      if (m && m.type === 'done') renderChangelog(elStatus, elList, m.data || {});
      else clFail(elStatus, elList, (m && m.message) || '后台响应异常');
      clCleanup(port);
    });
    port.onDisconnect.addListener(function () {
      if (clPort === port) clPort = null;
      if (!settled) {
        settled = true;
        clFail(elStatus, elList, '后台连接中断（扩展可能刚更新过）');
      }
    });
    port.postMessage({ cmd: 'get', fresh: !!fresh });
  }

  function clFail(elStatus, elList, why) {
    elStatus.className = 'cl-status err';
    elStatus.textContent = '读取失败：' + why;
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

  function renderChangelog(elStatus, elList, data) {
    var items = data.items || [];
    var cur = 'v' + (data.localVersion || VER);
    var ok = 0;
    var miss = 0;
    elList.innerHTML = '';
    for (var i = 0; i < items.length; i++) {
      var r = items[i];
      if (r.notes) ok++;
      else if (r.error) miss++;
      var card = document.createElement('section');
      card.className = 'cl-card';
      var html = '<div class="cl-head">'
        + '<span class="cl-no">' + clEsc(r.tag) + '</span>'
        + (r.date ? '<span class="cl-date">' + clEsc(clFmtDate(r.date)) + '</span>' : '')
        + (r.tag === cur ? '<span class="cl-now">当前版本</span>' : '')
        + '</div>';
      if (r.notes) {
        if (r.notes.summary) html += '<div class="cl-sum">' + clEsc(r.notes.summary) + '</div>';
        if (r.notes.items && r.notes.items.length) {
          html += '<ul class="cl-list">';
          for (var k = 0; k < r.notes.items.length; k++) {
            html += '<li>' + clEsc(r.notes.items[k]) + '</li>';
          }
          html += '</ul>';
        }
      } else if (r.error) {
        html += '<div class="cl-miss">日志拉取失败：' + clEsc(r.error) + '</div>';
      } else {
        html += '<div class="cl-miss">该版本未附日志说明</div>';
      }
      card.innerHTML = html;
      elList.appendChild(card);
    }
    var msg = ok ? ('共 ' + ok + ' 个版本附日志') : '没能读到任何版本的日志说明';
    if (miss) msg += '，' + miss + ' 个版本暂时拉不到';
    elStatus.className = 'cl-status';
    elStatus.textContent = msg;
    var foot = document.createElement('div');
    foot.className = 'cl-foot';
    foot.innerHTML = '以上说明取自各版本标签随仓库提交的 RELEASE_NOTES，'
      + '完整文档见 <a data-cl-gitee>GitHub 仓库标签页</a>。';
    foot.querySelector('a').addEventListener('click', function () {
      if (data.webUrl) {
        try { window.open(data.webUrl, '_blank'); } catch (e) { /* 页面拦就拦了 */ }
      }
    });
    elList.appendChild(foot);
  }

  /* ---------- 开 / 关 ---------- */
  function open(mode) {
    // 2026-10-13：上次提交完留下的「反馈已提交」页在这里收回。
    // 面板是常驻页面里的，不刷新标签页就永远不会自己复位（用户实测：
    // 关掉面板、关掉浏览器窗口后再点反馈，看到的还是那张成功页）。
    if (isDoneShown()) resetForm();
    if (!state.submitting) restoreDraft();
    resetChecks();         // 勾选项每次打开都恢复默认勾选（#107）——
                           // 只靠 resetForm 不够：那条路只有「成功页出现后」才走，
                           // 取消勾选→关面板→再开（不经提交）也必须回到默认。
    refreshDiagSum();      // 诊断计数随页面状态变，每次打开刷新一行
    refreshDomSum();       // 页面结构计数同理（2026-10-22）
    // 双 Tab(#106 迭代):每次打开都明确落位 —— 缺省「反馈」,
    // 弹窗「更新日志」入口经 dyc:fbToggle mode:'changelog' 落在日志页。
    setTab(mode === 'changelog' ? 'changelog' : 'feedback');
    panel.classList.remove('closing');
    panel.style.display = 'flex';
  }
  function close() {
    if (clPort) clCleanup(clPort);   // 日志拉取若还在飞,断开 Port,别拖着后台常驻
    panel.classList.add('closing');
    setTimeout(function () {
      panel.style.display = 'none';
      panel.classList.remove('closing');
    }, 170);
  }
  $('[data-x]').addEventListener('click', close);

  /* ---------- 诊断信息（2026-10-13 新增 · 反馈诊断包第 3 层入口） ----------
     用户评审口径：面板显示这一行、**默认勾选**、可取消、可展开查看将要发出的内容。
     采集内核是 src/content/diag.js（window.__dycDiag）。它有可能不在场 ——
     扩展刚更新完、页面还开着的旧标签页就是这种情况（manifest 只在页面加载时注入，
     后台注入面板时会补一份，但补不上时不能假装采集成功）。所以这里如实提示。 */

  function diagApi() { return window.__dycDiag || null; }

  function shotMeta() {
    return state.shots.map(function (s) {
      var m = /^data:image\/([a-z0-9.+-]+);base64,/i.exec(s.dataURI || '');
      return {
        from: s.from || 'unknown',          // capture 拍屏 / paste 粘贴 / file 选文件
        fmt: m ? m[1] : 'unknown',          // 真实格式：拍屏是 jpeg，粘贴进来的可能是 png
        w: s.w || 0,
        h: s.h || 0,
        kb: Math.round(((s.dataURI || '').length * 0.75) / 1024)
      };
    });
  }

  function refreshDiagSum() {
    var d = diagApi();
    elDiagSum.textContent = d ? d.countText() : '采集内核未就绪';
  }

  /** 采集诊断快照 → Promise<对象|null>；任何失败都 resolve(null)，绝不阻断提交 */
  function collectDiag(want) {
    return new Promise(function (resolve) {
      if (!want) return resolve(null);
      var d = diagApi();
      if (!d || typeof d.snapshot !== 'function') return resolve(null);
      var fin = false;
      var timer = setTimeout(function () { done(null); }, 1500);   // 采集超时也要能提交
      function done(v) {
        if (fin) return;
        fin = true;
        clearTimeout(timer);
        resolve(v);
      }
      var extra = { shots: shotMeta() };
      function go() { d.snapshot(extra).then(done, function () { done(null); }); }
      // 后台错误单独取一份并进来 —— 后台是另一个上下文，页面侧看不见它的异常
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
  elDiagView.addEventListener('click', function () {
    if (diagPreviewOn) {
      elDiagBox.hidden = true;
      diagPreviewOn = false;
      elDiagView.textContent = '查看';
      return;
    }
    if (!diagApi()) {
      showMsg('诊断采集内核未在当前页面生效（通常是扩展刚更新、页面还没刷新），本条将不带诊断信息', 'err');
      return;
    }
    elDiagView.textContent = '读取中…';
    collectDiag(true).then(function (snap) {
      if (!snap) {
        elDiagView.textContent = '查看';
        showMsg('诊断信息读取失败', 'err');
        return;
      }
      elDiagBox.textContent = JSON.stringify(snap, null, 2);
      elDiagBox.hidden = false;
      diagPreviewOn = true;
      elDiagView.textContent = '收起';
    });
  });

  /* ---------- 页面结构导出（2026-10-22 新增 · 反馈可选项） ----------
     与诊断行同款交互：显示、默认勾选、可取消、可展开预览。
     采集内核 domStructure() 也在 diag.js（window.__dycDiag）里；它不在场时
     如实提示「本条将不带页面结构」，与诊断行同口径。 */

  function domApi() { return window.__dycDiag || null; }

  function refreshDomSum() {
    var d = domApi();
    elDomSum.textContent = (d && typeof d.domCountText === 'function')
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
  elDomView.addEventListener('click', function () {
    if (domPreviewOn) {
      elDomBox.hidden = true;
      domPreviewOn = false;
      elDomView.textContent = '查看';
      return;
    }
    var d = domApi();
    if (!d || typeof d.domStructure !== 'function') {
      showMsg('采集内核未在当前页面生效（通常是扩展刚更新、页面还没刷新），本条将不带页面结构', 'err');
      return;
    }
    elDomView.textContent = '读取中…';
    d.domStructure().then(function (r) {
      if (!r) {
        elDomView.textContent = '查看';
        showMsg('页面结构读取失败', 'err');
        return;
      }
      elDomBox.textContent = d.domTreeText(r);
      elDomBox.hidden = false;
      domPreviewOn = true;
      elDomView.textContent = '收起';
    });
  });

  /* ---------- 提交（交后台转发） ---------- */
  // 2026-10-12 修：面板不再自己调云 SDK。
  // 原因：content script 发出的 fetch 以「宿主页面」为源、受 CORS 约束，而云端网关
  // 不响应 OPTIONS 预检（实测 403 且不回 Access-Control-Allow-*），SDK 又必然带
  // application/json + 自定义头两个非简单头 → 一定触发预检 → 页面内直连必然被拦。
  // 所以把记录整条发给后台，由后台（有 host_permissions，跨源不受此限）写入。
  // 截图的 base64 会一起过消息通道；单张已在前面压到 ≤4MB。
  elSubmit.addEventListener('click', function () {
    if (state.submitting) return;
    var content = $('[data-content]').value.trim();
    if (!content) return showMsg('请先填写问题描述', 'err');
    if (content.length < 5) return showMsg('描述太短啦,至少写 5 个字,越具体越容易处理', 'err');
    if (new Set(content.split('')).size < 4) return showMsg('请描述具体内容,不要重复同一个字符哦', 'err');
    // 2026-10-13 用户定：连发间隔由 10 分钟收紧到 10 秒 —— 只为挡住误触连点，
    // 不再长时间禁止（10 分钟对「漏写了一句话想补发」太苛刻）。
    var lastTs = 0;
    try { lastTs = Number(localStorage.getItem('dyc_fb_last') || 0); } catch (e) {}
    if (Date.now() - lastTs < 10 * 1000) {
      var left = Math.ceil((10 * 1000 - (Date.now() - lastTs)) / 1000);
      return showMsg('刚提交过一条,请 ' + left + ' 秒后再发', 'err');
    }

    state.submitting = true;
    elSubmit.disabled = true;
    showMsg('正在提交…');

    function fail(text) {
      state.submitting = false;
      elSubmit.disabled = false;
      showMsg('提交失败:' + text, 'err');
    }

    // 诊断包与页面结构在这里采集：勾选才采；采不到 / 超时都不阻断提交 —— 反馈本身永远优先。
    // 两项并行采集（诊断 1.5s / 结构 3s 各有超时，总等待取最坏一项）。
    Promise.all([
      collectDiag(!!(elDiagCk && elDiagCk.checked)),
      collectDomStruct(!!(elDomCk && elDomCk.checked))
    ]).then(function (got) {
      var diagSnap = got[0];
      var domSnap = got[1];
      var rec = {
        type: state.type,
        content: content,
        contact: $('[data-contact]').value.trim() || null,
        version: VER || null,
        browser: navigator.userAgent,
        screenshot_data: state.shots.length ? state.shots[0].dataURI : null,
        screenshot_data2: state.shots.length > 1 ? state.shots[1].dataURI : null,
        screenshot_data3: state.shots.length > 2 ? state.shots[2].dataURI : null,
        // 邮件用缩略图（2026-10-13 新增列）：日报靠这三列把图内嵌进邮件正文，
        // 原图太大（单张 base64 可达 40 万字符）邮件根本承载不了。
        screenshot_thumb1: state.shots[0] ? (state.shots[0].thumb || null) : null,
        screenshot_thumb2: state.shots[1] ? (state.shots[1].thumb || null) : null,
        screenshot_thumb3: state.shots[2] ? (state.shots[2].thumb || null) : null
      };
      // 诊断快照（2026-10-13 新增）：取消勾选时整条**不带**这个字段，
      // 让云端的 diag 保持默认空对象，一眼能看出「这条没带体检报告」。
      if (diagSnap) rec.diag = diagSnap;
      // 页面结构（2026-10-22 新增）：取消勾选时整条不带这个字段（同 diag 口径）
      if (domSnap) rec.page_structure = domSnap;

      try {
        chrome.runtime.sendMessage({ type: 'dyc:submitFeedback', record: rec }, function (res) {
          if (chrome.runtime.lastError) return fail(chrome.runtime.lastError.message || '扩展连接已断开');
          if (!res || !res.ok) return fail((res && res.error) || '未知原因');
          try { localStorage.setItem('dyc_fb_last', String(Date.now())); } catch (e) {}
          clearDraft();
          // 2026-10-14 用户定（**推翻 10-13 的「清空 + 保留可继续写」**）：
          // 「反馈功能反馈完就显示反馈结果，然后应该关掉而不是切入新的反馈页面」。
          // 成功页停 1.2 秒给出「已提交」的确认感，随后整体收起；
          // 表单在后台静默复位，下次点开（open() 里对 isDoneShown() 同样复位）是干净的。
          $('[data-form]').style.display = 'none';
          $('[data-foot]').style.display = 'none';
          $('[data-done]').style.display = 'block';
          setTimeout(function () {
            if (elMsg.textContent === '反馈已提交，草稿清理失败') return;
            resetForm();
            close();
          }, 1200);
        });
      } catch (e) {
        // 扩展刚被更新/重载时，页面里旧注入的脚本会失去消息通道，同步抛错
        fail('扩展已更新，请刷新页面后重试');
      }
    });
  });

  /* ---------- 启动 ---------- */
  restoreDraft();
  // 首次注入走的是这条启动路径（不是 open()）：这里不刷一次，汇总行就是空白。
  // 实测踩到过 —— 用户点反馈看到的第一眼就是空的，只有二次点开才有内容。
  refreshDiagSum();
  refreshDomSum();
  panel.style.display = 'flex';

  // 二次唤起:popup 再点「反馈」时,background 先发本消息试探;
  // 已注入则这里直接展开(抛"已打开"错误让 SW 判定走 sendMessage 成功路径)。
  chrome.runtime.onMessage.addListener(function (msg, s, sendResponse) {
    if (msg && msg.type === 'dyc:fbToggle') {
      open(msg.mode);
      sendResponse({ ok: true });
    }
    return false;
  });

  window.__dycFeedbackPanel = {
    toggle: function (show) {
      if (show) open();
      else panel.style.display = panel.style.display === 'none' ? (open(), '') : close();
    },
    open: open,
    close: close
  };
})();
