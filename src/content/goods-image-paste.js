/**
 * 商品发布 / 编辑页 · 上传框「剪贴板粘贴」(2026-11-08，用户新增需求)
 * ============================================================
 * 【用户原话】
 *   「对着上传图片的窗口,加入【剪贴板粘贴】的按钮,可以不启用上传图片的系统窗口,
 *     直接把剪贴板的图片直接一步粘贴进图片框当中。这个按钮对着全都点所有这类
 *     上传图片的窗口启用,这个按钮将放置在上传图片的窗口的内部下方。不挡位置,
 *     简明易懂。」+「一次一张」。
 *
 * 【做什么】每个**空白**上传框内下方挂一枚「粘贴图片」：
 *   点一下 ⇒ 读剪贴板里的图片 ⇒ 直接塞进该框的 input[type=file] ⇒ 等平台自己出图。
 *   全程不弹系统文件选择窗。
 *
 * 【为什么只挂空白框】已出图的框平台会在同一块位置叠「编辑 / 删除」,
 *   再挤一个按钮就挡路了(用户要求「不挡位置」)。框出图后按钮自动消失,
 *   想换图走平台自己的「编辑」—— 与手动操作的习惯一致。
 *
 * 【怎么认框(不写死类名)】平台类名是哈希的(style_xxx__Abc12),每次发版都变。
 *   两条互补路径,任一命中即算一个上传框:
 *     ① 结构:  input[type=file][accept*=image] → 向上找一个「看得见的小方块」祖先
 *     ② 文案:  「上传图片」这段文字 → 向上找最近的含 input[type=file] 的祖先
 *   两条都只依赖「有这么个输入框/有这么四个字」,是平台交互的语义,不是样式实现。
 *
 * 【怎么塞文件】三级,逐级验证,前一级出图就不再试下一级(避免重复上传):
 *   ① DataTransfer → input.files + change   (React 受控组件的标准入口)
 *   ② 向框内派发 paste 事件(clipboardData 带同一张图) —— 只认 paste 的组件
 *   ③ 向框内派发 drop 事件 —— 只认拖拽的组件
 *   三级都不出图 ⇒ 如实报「没塞进去」,提示手动上传。**绝不假报成功**。
 *
 * 【消息】三段式(来源 ｜ 值 ｜ 结果数):来源=图片粘贴,值=图片/原因,结果数=已入框/未入框。
 * ============================================================
 */
(function goodsImagePaste() {
  'use strict';

  if (window.__dycGoodsImagePasteLoaded) return;
  window.__dycGoodsImagePasteLoaded = true;
  if (typeof dycReadFlags !== 'function' || typeof dycWatchFlags !== 'function') return;

  var SOURCE = '图片粘贴';
  var BTN_TEXT = '粘贴图片';
  var BTN_TIP = '点一下把剪贴板里的图片贴进这个框（不会弹选择文件的窗口）';
  var BTN_CLASS = 'dyc-imgpaste-btn';
  var TILE_ATTR = 'data-dyc-imgpaste-tile';
  var BTN_ATTR = 'data-dyc-imgpaste-btn';

  var on = false;
  var observer = null;
  var scanTimer = 0;
  var scrollTimer = 0;
  var busyTile = null;
  var roots = [document];
  var rootTimer = 0;
  var lastHref = '';
  var SHADOW_STYLE = 'data-dyc-imgpaste-style';
  var shadowCss = '.dyc-imgpaste-btn{all:initial;position:absolute;left:6px;right:6px;bottom:6px;box-sizing:border-box;height:24px;margin:0;padding:0 4px;border:1px solid #d6e2ff;border-radius:6px;background:#eef3ff;color:#1664ff;font:12px/22px "Microsoft YaHei",sans-serif;text-align:center;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;cursor:pointer;z-index:3}'
    + '.dyc-imgpaste-btn:hover{background:#1664ff;border-color:#1664ff;color:#fff}'
    + '.dyc-imgpaste-btn:disabled{opacity:.6;cursor:default}'
    + '.dyc-imgpaste-btn.is-compact{height:20px;left:4px;right:4px;bottom:4px;font-size:11px;line-height:18px;border-radius:5px}';

  // 微信商品表单在 micro-app 内；同源 iframe 也可能承载图片编辑区域。
  function collectRoots() {
    var found = [document];
    for (var i = 0; i < found.length && i < 32; i++) {
      var hosts = found[i].querySelectorAll('micro-app, iframe');
      for (var j = 0; j < hosts.length && found.length < 32; j++) {
        var root = hosts[j].shadowRoot;
        try {
          if (hosts[j].tagName === 'IFRAME') root = hosts[j].contentDocument;
        } catch (e) { root = null; }
        if (root && found.indexOf(root) < 0) found.push(root);
      }
    }
    return found;
  }

  function queryRoots(selector) {
    var out = [];
    roots.forEach(function (root) {
      out = out.concat(Array.prototype.slice.call(root.querySelectorAll(selector)));
    });
    return out;
  }

  function refreshRoots() {
    var scoped = inScope();
    // 丢弃旧 root 前先移除其中的控件，SPA 退回列表时 shadowRoot 可能仍保留。
    if (!scoped) {
      unmountAll();
      queryRoots('style[' + SHADOW_STYLE + ']').forEach(function (style) { style.remove(); });
    }
    var next = scoped ? collectRoots() : [document];
    var changed = next.length !== roots.length || next.some(function (root, i) { return root !== roots[i]; });
    if (!changed && observer) return false;
    if (observer) observer.disconnect();
    roots = next;
    observer = new MutationObserver(function () { scheduleScan(400); });
    roots.forEach(function (root) {
      observer.observe(root, { childList: true, subtree: true, attributes: true,
        attributeFilter: ['src', 'accept', 'disabled'] });
    });
    return true;
  }

  function ensureStyle(tile) {
    var root = tile.getRootNode();
    if (root === document || root.querySelector('style[' + SHADOW_STYLE + ']')) return;
    var style = tile.ownerDocument.createElement('style');
    style.setAttribute(SHADOW_STYLE, '1');
    style.textContent = shadowCss;
    (root.head || root).appendChild(style);
  }

  function log(msg) {
    try { if (typeof debugLog === 'function') debugLog(msg); } catch (e) { /* 日志不影响主流程 */ }
  }

  function say(value, kind, count, full) {
    try {
      if (typeof setStatus !== 'function') return;
      setStatus(value, kind, {
        source: SOURCE,
        count: count,
        full: full,
        keepHistory: kind !== 'success'
      });
    } catch (e) { /* 消息失败不拖垮主流程 */ }
  }

  function inScope() {
    var p = window.DYC_PAGE_PATTERNS;
    return !!(p && ((p.goodsEdit && p.goodsEdit.test(location.href))
      || (p.wxGoodsEdit && p.wxGoodsEdit.test(location.href))));
  }

  /* ==========================================================
   * 一、认框
   * ========================================================== */

  function visible(el) {
    if (!el || el.nodeType !== 1) return false;
    if (typeof isVisible === 'function') return isVisible(el);
    var r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }

  function boxOf(el) {
    try { return el.getBoundingClientRect(); } catch (e) { return { width: 0, height: 0 }; }
  }

  /** 已出图的上传框(有真实图片) —— 有图就不挂按钮 */
  function hasImage(tile) {
    var imgs = tile.querySelectorAll('img');
    for (var i = 0; i < imgs.length; i++) {
      var src = imgs[i].getAttribute('src') || '';
      /* 有 src 且看得见就算已出图。平台占位图(空状态插图)也是 img,
         但它在「上传图片」这个空态里本身不会出现 —— 空态的加号是 svg/文字。 */
      if (src && visible(imgs[i])) return true;
    }
    return false;
  }

  function inputForTile(tile) {
    var input = tile.querySelector('input[type="file"]');
    if (input) return input;
    var p = window.DYC_PAGE_PATTERNS;
    if (!p || !p.wxGoodsEdit || !p.wxGoodsEdit.test(location.href)
      || !tile.matches('.picture_add_content')) return null;
    // 微信的隐藏 input 是加号方块的兄弟；只能取同一上传组件内唯一的 input。
    var group = tile.closest('.weui-desktop-new-upload__wrp');
    var inputs = group && group.querySelectorAll('input[type="file"]');
    return inputs && inputs.length === 1 ? inputs[0] : null;
  }

  /**
   * 从 file input 向上找「看得见的小方块」。
   * 判据:宽度 48~420、高度 48~420、面积 > 2000。上传框在本页是 118×118 级别的方块,
   * 再往上就是整行/整列的大容器(会挂到离谱的位置)。
   * 一路都不合尺寸(隐藏框 / 还没渲染)就退回 **input 的直接父元素** ——
   * 绝不用 body/html 当包含块:那会让按钮变成贴在页面角落的浮层。
   */
  function tileFromInput(input) {
    var group = input.closest('.weui-desktop-new-upload__wrp');
    var p = window.DYC_PAGE_PATTERNS;
    if (group && p && p.wxGoodsEdit && p.wxGoodsEdit.test(location.href)) {
      var add = group.querySelector('.picture_add_content');
      return add && inputForTile(add) === input ? add : null;
    }
    var first = input.parentElement;
    var node = first;
    var guard = 0;
    while (node && guard < 7) {
      guard++;
      var r = boxOf(node);
      if (r.width >= 48 && r.width <= 420 && r.height >= 48 && r.height <= 420
        && r.width * r.height > 2000) {
        return node;
      }
      if (node === document.body || node === document.documentElement) break;
      node = node.parentElement;
    }
    return first;
  }

  /** 从「上传图片」文案节点向上找最近的含 file input 的祖先 */
  function tileFromTextNode(node) {
    var el = node.nodeType === 1 ? node : node.parentElement;
    var guard = 0;
    while (el && guard < 6) {
      guard++;
      if (el.querySelector && el.querySelector('input[type="file"]')) return el;
      el = el.parentElement;
    }
    return null;
  }

  /* ——— 这个方块到底是不是「真正的上传框」 ———
   * 2026-11-08 真机教训(用户截图 + 诊断报告 20 个按钮):
   *   页面里还有两类东西也带 file input ——
   *     ① 平台拖拽控制器的**预览克隆**(#DOUXIAOER_DRAG_CONTROLLER 里的小方块);
   *     ② 图片编辑浮层上的工具条。
   *   它们被一并挂上按钮后把平台自己的浮层顶住了(用户原话「导致没法正常使用」)。
   * 所以挂载前必须过外形与语义四关:
   *   · 接受图片的 file input，不依赖空态文案;
   *   · 是方块:56~320,长宽比 0.5~2.2(工具条宽扁、克隆块很小);
   *   · 能点、不是半透明(克隆块常 pointer-events:none / opacity<1);
   *   · 不在拖拽控制器、也不在我们自己的浮层里。
   * 尺寸读不到(尚未布局 / jsdom)时不判尺寸 —— 由 isVisible 那关兜着,
   * 免得把「暂时没尺寸」误杀成「不是上传框」。 */
  /**
   * 空态文案是不是「上传图片」。
   *
   * ⚠️ 2026-11-08 真机第四次:这条**不能当硬门槛**。
   *   诊断日志「候选 28 · 已挂 0」+「不合格 body… · 没有「上传图片」文案」说明
   *   页面上明明有上传框，却一个都不含这四个字 —— 空态文案随类目/商品而变
   *   (「上传主图」「添加图片」「点击上传」…)，写死一句就等于自废武功。
   *   所以它现在只是**加分项**:有它优先、没它也能靠外形与位置成立。
   */
  function hasUploadHint(tile) {
    var text = tile.textContent || '';
    return text.indexOf('上传图片') >= 0;
  }

  function inFloatingChrome(tile) {
    if (tile.closest) {
      if (tile.closest('[id*="DRAG_CONTROLLER"], [class*="draggerContainer"], [class*="DragController"]')) return true;
      if (tile.closest('#dyb-status-bar, #dyb-debug-panel, #dyb-dialog-root')) return true;
    }
    /* 只认「表单里」的上传框:平台把拖拽预览克隆、图片工具条这类浮层
       直接挂在 body 上(不在表单滚动容器内) —— 用户截图里被顶住的就是它们。
       容器找不到时不做这条限制,免得整页一个按钮都不出。 */
    var form = null;
    try { form = document.getElementById('goodsEditScrollContainer'); } catch (e) { form = null; }
    if (form && !form.contains(tile)) return true;
    return false;
  }

  function tileQualifies(tile) {
    if (!tile || tile.nodeType !== 1) return false;
    if (!tile.isConnected) return false;
    if (!visible(tile)) return false;
    if (inFloatingChrome(tile)) return false;
    if (hasImage(tile)) return false;

    /* 结构门槛:框里必须真有一个文件输入框 —— 这是「能把图塞进去」的唯一前提。
       空态文案不再当门槛(见 hasUploadHint 注释),只在没有 file input 时
       拿它当「这是上传区」的旁证。 */
    var hasInput = false;
    try { hasInput = !!inputForTile(tile); } catch (e) { hasInput = false; }
    if (!hasInput && !hasUploadHint(tile)) return false;

    var r = boxOf(tile);
    /* 0×0 = 尺寸未知(还没布局),交给 isVisible 的结论,这里不判 */
    if (r.width > 0 && r.height > 0) {
      if (r.width < 56 || r.height < 56) return false;
      if (r.width > 320 || r.height > 320) return false;
      var ratio = r.width / r.height;
      if (ratio < 0.5 || ratio > 2.2) return false;
    }

    var st = null;
    try { st = window.getComputedStyle(tile); } catch (e) { st = null; }
    if (st) {
      if (st.pointerEvents === 'none') return false;
      var op = parseFloat(st.opacity);
      if (isFinite(op) && op < 0.6) return false;
      if (st.visibility === 'hidden') return false;
    }
    return true;
  }

  /** accept 同时支持图片 MIME 和扩展名列表。 */
  function acceptsImages(input) {
    if (input.disabled) return false;
    var accept = String(input.getAttribute('accept') || '').trim().toLowerCase();
    if (!accept) return true;
    return accept.split(',').some(function (part) {
      var token = part.trim();
      return /^image\//.test(token) || /^\.(png|jpe?g|jfif|gif|webp|bmp|avif|heic|heif|tiff?|svg|ico)$/.test(token);
    });
  }

  function collectTiles() {
    var out = [];
    var seen = [];

    function push(tile) {
      if (!tile || seen.indexOf(tile) >= 0) return;
      var input = inputForTile(tile);
      if (input && !acceptsImages(input)) return;
      seen.push(tile);
      out.push(tile);
    }

    var inputs;
    try { inputs = queryRoots('input[type="file"]'); } catch (e) { inputs = []; }
    for (var i = 0; i < inputs.length; i++) {
      if (!acceptsImages(inputs[i])) continue;
      push(tileFromInput(inputs[i]));
    }

    if (typeof findAllByText === 'function') {
      var nodes = [];
      try { nodes = findAllByText('上传图片') || []; } catch (e) { nodes = []; }
      for (var j = 0; j < nodes.length; j++) {
        if (nodes[j].closest && nodes[j].closest('#' + 'dyb-status-bar')) continue;
        var tile = tileFromTextNode(nodes[j]);
        if (tile) push(tile);
      }
    }

    return out;
  }

  /* ==========================================================
   * 二、挂按钮
   * ========================================================== */

  function makeButton(tile) {
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = BTN_CLASS;
    btn.setAttribute(BTN_ATTR, '1');
    btn.textContent = BTN_TEXT;
    btn.title = BTN_TIP;
    btn.setAttribute('aria-label', BTN_TIP);

    btn.addEventListener('click', function (ev) {
      ev.preventDefault();
      ev.stopPropagation();
      startPaste(tile, btn);
    });
    /* 平台的上传区可能有「点整块就开选择窗」的监听:按钮上的按下与抬起都要截住,
       否则点粘贴会顺手打开系统窗口 —— 正是用户要避免的那一步。 */
    ['mousedown', 'mouseup', 'pointerdown', 'pointerup'].forEach(function (t) {
      btn.addEventListener(t, function (ev) { ev.stopPropagation(); });
    });
    return btn;
  }

  function mount(tile) {
    if (!tile || tile.getAttribute(TILE_ATTR) === '1') return;
    if (!tileQualifies(tile)) return;

    var btn = makeButton(tile);
    ensureStyle(tile);
    /* 定在框内下方:absolute + 底边贴合(样式见 style.css .dyc-imgpaste-btn)。
       包含块需要 relative —— 平台这块多数是 position:static,才补一个;
       已是别的定位就不动它,避免把平台的绝对定位子元素带歪。 */
    try {
      var pos = window.getComputedStyle(tile).position;
      if (!pos || pos === 'static') tile.style.position = 'relative';
    } catch (e) { /* 拿不到样式就按 static 处理 */ }

    tile.appendChild(btn);
    tile.setAttribute(TILE_ATTR, '1');

    /* 小框(详情图那类 80px 的格子)用紧凑版:24px 高的按钮会盖住中间的「+」 */
    var r = boxOf(tile);
    if (r.height > 0 && r.height < 90) btn.classList.add('is-compact');
  }

  function unmountAll() {
    var btns = queryRoots('[' + BTN_ATTR + ']');
    for (var i = 0; i < btns.length; i++) {
      var tile = btns[i].parentElement;
      if (btns[i].parentNode) btns[i].parentNode.removeChild(btns[i]);
      if (tile && tile.getAttribute(TILE_ATTR) === '1') tile.removeAttribute(TILE_ATTR);
    }
  }

  /** 每个框独立判断，主图文案不能屏蔽同页只有「＋ / 0/20」的资质格。 */
  function collectQualified() {
    var tiles = collectTiles();
    return { all: tiles, use: tiles.filter(tileQualifies), tier: '结构' };
  }

  /** 幂等重扫:新框挂上、已出图的框摘掉、被平台重渲染掉的补回来 */
  function scan() {
    if (!on) return;
    if (!inScope()) { unmountAll(); refreshRoots(); return; }
    refreshRoots();
    var q = collectQualified();
    for (var i = 0; i < q.use.length; i++) mount(q.use[i]);

    /* 清理:不在本次名单里的(出图了 / 不再像上传框 / 已离开文档)一律摘掉 */
    var btns = queryRoots('[' + BTN_ATTR + ']');
    for (var j = 0; j < btns.length; j++) {
      var t = btns[j].parentElement;
      var keep = t && t.isConnected && q.use.indexOf(t) >= 0;
      if (!keep) {
        if (btns[j].parentNode) btns[j].parentNode.removeChild(btns[j]);
        if (t && t.getAttribute(TILE_ATTR) === '1') t.removeAttribute(TILE_ATTR);
      }
    }

    summarize(q);
    return q;
  }

  function scheduleScan(delay) {
    if (scanTimer) return;
    scanTimer = setTimeout(function () {
      scanTimer = 0;
      try { scan(); } catch (e) { log('重扫失败:' + ((e && e.message) || e)); }
    }, delay || 350);
  }

  /* ==========================================================
   * 三、读剪贴板图片
   *
   * 2026-11-08 真机(360 极速X,Chrome/148):离屏文档里
   * navigator.clipboard.read() 报「Document is not focused」——
   * 离屏文档天生没有焦点,这个内核没有给 CLIPBOARD reason 开豁免。
   * ⇒ 改成四条路,哪条通用哪条:
   *   ① 内容脚本直读(按钮点击 = 用户手势 + clipboardRead 权限,最正统);
   *   ② 直读报「not focused」时拉回焦点重试一次;
   *   ③ 离屏文档代读(老路径,别的内核可能好使);
   *   ④ execCommand('paste') 塞进隐藏 contenteditable,从 paste 事件拿图。
   * ========================================================== */

  function blobToDataUrl(blob) {
    return new Promise(function (resolve, reject) {
      try {
        var fr = new FileReader();
        fr.onload = function () { resolve(String(fr.result || '')); };
        fr.onerror = function () { reject(new Error('图片数据读不出来')); };
        fr.readAsDataURL(blob);
      } catch (e) { reject(e); }
    });
  }

  var NO_IMAGE = '__NO_IMAGE__';   // 「剪贴板里没图」的统一内部标记

  /** 路径① 内容脚本直读(任何失败都转成 {ok:false,error},不往外抛 rejection) */
  function readDirect() {
    if (!navigator.clipboard || !navigator.clipboard.read) {
      return Promise.resolve({ ok: false, error: '本内核没有 navigator.clipboard' });
    }
    return navigator.clipboard.read().then(function (items) {
      for (var i = 0; i < items.length; i++) {
        var types = items[i].types || [];
        for (var j = 0; j < types.length; j++) {
          if (/^image\//.test(types[j])) {
            var ty = types[j];
            return items[i].getType(ty).then(function (blob) {
              return blobToDataUrl(blob).then(function (dataUrl) {
                return { ok: true, dataUrl: dataUrl, mime: ty, size: blob.size, via: 'direct' };
              });
            });
          }
        }
      }
      return { ok: false, error: NO_IMAGE };
    }).catch(function (e) {
      return { ok: false, error: (e && e.message) || String(e) };
    });
  }

  /** 路径③ 离屏文档代读(老路径) */
  function readOffscreen() {
    return new Promise(function (resolve) {
      var settled = false;
      function done(r) { if (!settled) { settled = true; resolve(r); } }
      try {
        chrome.runtime.sendMessage({ type: 'dyc:readClipboardImage' }, function (res) {
          var err = chrome.runtime.lastError;
          if (err) { done({ ok: false, error: '读剪贴板通道不通:' + err.message }); return; }
          done(res || { ok: false, error: '剪贴板没有回执' });
        });
      } catch (e) {
        done({ ok: false, error: (e && e.message) || '读剪贴板失败' });
      }
      /* 看门狗:后台被回收时回调可能永远不回 —— 不能让按钮永久卡在「禁用」 */
      setTimeout(function () { done({ ok: false, error: '读剪贴板超时' }); }, 9000);
    });
  }

  /** 路径④ execCommand('paste') —— 隐藏 contenteditable,从 paste 事件拿图 */
  function readViaPaste() {
    return new Promise(function (resolve) {
      var holder = document.createElement('div');
      holder.contentEditable = 'true';
      holder.style.cssText = 'position:fixed;left:-9999px;top:0;width:1px;height:1px;opacity:0;';
      document.body.appendChild(holder);

      var settled = false;
      var timer = setTimeout(function () { finish({ ok: false, error: 'execCommand 粘贴没回音' }); }, 2500);

      function finish(r) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        document.removeEventListener('paste', onPaste, true);
        if (holder.parentNode) holder.parentNode.removeChild(holder);
        resolve(r);
      }

      function onPaste(ev) {
        ev.preventDefault();
        ev.stopPropagation();
        var items = (ev.clipboardData && ev.clipboardData.items) || [];
        for (var i = 0; i < items.length; i++) {
          var it = items[i];
          if (it.kind === 'file' && /^image\//.test(it.type || '') && it.getAsFile) {
            var blob = it.getAsFile();
            if (!blob) continue;
            blobToDataUrl(blob).then(function (dataUrl) {
              finish({ ok: true, dataUrl: dataUrl, mime: blob.type || 'image/png', size: blob.size, via: 'execCommand' });
            }, function (e) { finish({ ok: false, error: (e && e.message) || String(e) }); });
            return;
          }
        }
        finish({ ok: false, error: NO_IMAGE });
      }

      document.addEventListener('paste', onPaste, true);
      try { holder.focus(); } catch (e) { /* focus 失败不影响派发 */ }
      var okCmd = false;
      try { okCmd = document.execCommand('paste'); } catch (e) { okCmd = false; }
      if (!okCmd) {
        /* 返回 false 不一定真失败(有的内核异步派发) —— 给一小拍 */
        setTimeout(function () {
          if (!settled && holder.parentNode) return;   // paste 已来或马上来
          finish({ ok: false, error: 'execCommand 粘贴被内核拒绝' });
        }, 350);
      }
    });
  }

  function readImage() {
    var tried = [];
    return readDirect().then(function (r) {
      if (r.ok) return r;
      if (r.error === NO_IMAGE) return { ok: false, error: NO_IMAGE };
      tried.push('直读:' + r.error);
      /* 「没聚焦」⇒ 拉回焦点重试一次(用户手势还在有效期) */
      if (/not focused|聚焦/i.test(r.error || '')) {
        try { window.focus(); } catch (e) { /* 有的内核 window.focus 被禁 */ }
        return new Promise(function (res) { setTimeout(res, 150); }).then(readDirect).then(function (r2) {
          if (r2.ok) return r2;
          if (r2.error === NO_IMAGE) return { ok: false, error: NO_IMAGE };
          tried.push('重试:' + r2.error);
          return null;                          // 继续下一条路
        });
      }
      return null;
    }).then(function (r) {
      if (r) return r;
      return readOffscreen().then(function (r2) {
        if (r2 && r2.ok) { r2.via = 'offscreen'; return r2; }
        var e2 = (r2 && r2.error) || '无回执';
        tried.push('离屏:' + e2);
        /* 离屏明确说「剪贴板里没图」就没必要再试 execCommand 了 */
        if (/没有图片|no image/i.test(e2)) return { ok: false, error: NO_IMAGE };
        return readViaPaste().then(function (r3) {
          if (r3.ok) return r3;
          tried.push('execCommand:' + r3.error);
          if (r3.error === NO_IMAGE) return { ok: false, error: NO_IMAGE };
          return { ok: false, error: tried.join('; ') || '读剪贴板失败' };
        });
      });
    });
  }

  function dataUrlToBlob(dataUrl) {
    var s = String(dataUrl || '');
    var comma = s.indexOf(',');
    if (comma < 0) throw new Error('图片数据不完整');
    var head = s.slice(0, comma);
    var mime = (head.match(/data:([^;]+)/) || [])[1] || 'image/png';
    var bin = atob(s.slice(comma + 1));
    var len = bin.length;
    var buf = new Uint8Array(len);
    for (var i = 0; i < len; i++) buf[i] = bin.charCodeAt(i);
    return new Blob([buf], { type: mime });
  }

  function toFile(img) {
    var blob = dataUrlToBlob(img.dataUrl);
    var mime = blob.type || img.mime || 'image/png';
    var ext = (mime.split('/')[1] || 'png').replace(/[^a-z0-9]/gi, '') || 'png';
    var name = '粘贴图片-' + Date.now() + '.' + ext;
    try { return new File([blob], name, { type: mime }); }
    catch (e) {
      /* 老内核没有 File 构造器:File 是 Blob 的子类,补 name 属性凑合能用 */
      blob.name = name;
      return blob;
    }
  }

  /* ==========================================================
   * 四、塞进上传框(三级,逐级验证)
   * ========================================================== */

  function transferOf(file) {
    var DT = window.DataTransfer;
    if (!DT) return null;
    try {
      var dt = new DT();
      if (dt.items && dt.items.add) dt.items.add(file);
      else if (dt.items) dt.items.add(file);
      return dt;
    } catch (e) { return null; }
  }

  function putByInput(tile, file) {
    var input = inputForTile(tile);
    if (!input) return false;
    var dt = transferOf(file);
    if (!dt) return false;
    try {
      input.files = dt.files;
    } catch (e) {
      return false;
    }
    if (!input.files || !input.files.length) return false;
    try {
      input.dispatchEvent(new Event('change', { bubbles: true }));
    } catch (e) {
      var legacy = document.createEvent('HTMLEvents');
      legacy.initEvent('change', true, false);
      input.dispatchEvent(legacy);
    }
    return true;
  }

  function putByEvent(tile, file, type) {
    var dt = transferOf(file);
    if (!dt) return false;
    var filled = false;
    if (type === 'paste') {
      try {
        tile.dispatchEvent(new ClipboardEvent('paste', {
          bubbles: true, cancelable: true, clipboardData: dt
        }));
        filled = true;
      } catch (e) { filled = false; }
    }
    if (!filled) {
      /* 造不出带 clipboardData 的事件:补一个空 paste 让组件自己走兜底,
         再把文件挂到 tile 上供组件读取(平台组件若读不到也不会出错)。 */
      try {
        tile.__dycPastedFile = file;
        var ev = document.createEvent('HTMLEvents');
        ev.initEvent(type, true, true);
        ev.clipboardData = dt;
        ev.dataTransfer = dt;
        tile.dispatchEvent(ev);
        filled = true;
      } catch (e2) { filled = false; }
    }
    if (type === 'drop' && filled) {
      try {
        tile.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt }));
        tile.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
      } catch (e3) { /* 老内核没有 DragEvent:上面的 HTMLEvents 已发过一次,不重复 */ }
    }
    return filled;
  }

  /* 表单里的 <img> 总数:框被平台整块重渲染时的「出图」判据
     (2026-11-08 真机:塞完文件平台把上传框换成「上传中」节点,
      旧节点永远等不到 img —— 但全表单的图片总数一定会涨)。 */
  function waitImageSmart(tile, ms, imageRoot, base) {
    return new Promise(function (resolve) {
      var start = Date.now();
      (function tick() {
        if (hasImage(tile)) { resolve(true); return; }
        var n = imageRoot.querySelectorAll('img').length;
        if (base >= 0 && n > base) { resolve(true); return; }
        if (Date.now() - start >= ms) { resolve(false); return; }
        setTimeout(tick, 150);
      })();
    });
  }

  /* ==========================================================
   * 五、一次粘贴的完整流程
   * ========================================================== */

  function setBtn(btn, text, disabled) {
    if (!btn) return;
    btn.textContent = text;
    btn.disabled = !!disabled;
  }

  function startPaste(tile, btn) {
    if (!on || !inScope() || !tile.isConnected) return;
    if (busyTile) return;              // 一次只处理一个框:连点两下会重复塞图
    busyTile = tile;
    setBtn(btn, '读取剪贴板…', true);
    log('图片粘贴:开始');

    readImage().then(function (img) {
      if (!img || !img.ok) {
        var why = (!img || !img.error || img.error === NO_IMAGE)
          ? '剪贴板里没有图片'
          : img.error;
        log('图片粘贴失败:' + why);
        say('剪贴板里没有图片', 'alert', '未入框',
          why + '。请先截图或复制一张图片,再点一次「粘贴图片」。');
        return null;
      }
      if (!on || !inScope() || !tile.isConnected) return null;

      var file;
      try {
        file = toFile(img);
      } catch (e) {
        say('图片读不出来', 'alert', '未入框', (e && e.message) || '图片转码失败');
        return null;
      }

      var sizeKb = Math.max(1, Math.round((img.size || 0) / 1024));
      log('图片粘贴:读到图片 ' + sizeKb + 'KB / ' + (img.mime || '')
        + (img.via ? ' / 通道' + img.via : ''));

      /* 三级依次尝试,每级给 1200ms 看平台是否出图 */
      var steps = [
        { name: 'input', run: function () { return putByInput(tile, file); } },
        { name: 'paste', run: function () { return putByEvent(tile, file, 'paste'); } },
        { name: 'drop', run: function () { return putByEvent(tile, file, 'drop'); } }
      ];

      var i = 0;
      var imageRoot = tile.getRootNode();
      imageRoot = imageRoot.querySelector('#goodsEditScrollContainer') || imageRoot;
      var baseImages = imageRoot.querySelectorAll('img').length;
      function next() {
        if (!on || !inScope()) return Promise.resolve(false);
        if (i >= steps.length) return Promise.resolve(false);
        var step = steps[i++];
        var okRoute = false;
        try { okRoute = step.run(); } catch (e) { okRoute = false; }
        if (!okRoute) return next();
        return waitImageSmart(tile, 1200, imageRoot, baseImages).then(function (got) {
          if (got) return true;
          if (!tile.isConnected) {
            /* 框被平台整块重渲染 = 文件已被受理(上传转圈中)。
               ⛔ 不许再打后面的通道 —— 会重复上传;
               改成耐心等:上传完成后 <img> 出现,全表单图片总数会涨。 */
            log('图片粘贴:平台已受理(框被重渲染),等出图…');
            return waitImageSmart(tile, 8000, imageRoot, baseImages);
          }
          log('图片粘贴:通道 ' + step.name + ' 没出图,换下一条');
          return next();
        });
      }

      setBtn(btn, '粘贴中…', true);
      return next().then(function (got) {
        if (got) {
          say('图片', 'success', '已入框');
          log('图片粘贴:成功');
        } else {
          say('图片没能贴进去', 'alert', '未入框',
            '三条通道都没能让平台出图。请点框里原来那个「+ 上传图片」手动选择文件;若每次都不行,把这个提示发给开发者。');
          log('图片粘贴:三条通道全部失败');
        }
      });
    }).catch(function (e) {
      log('图片粘贴异常:' + ((e && e.message) || e));
      say('粘贴出错', 'alert', '未入框', (e && e.message) || String(e));
    }).then(function () {
      busyTile = null;
      setBtn(btn, BTN_TEXT, false);
      scheduleScan(600);
    });
  }

  /* ==========================================================
   * 六、开关与生命周期
   * ========================================================== */

  /* 状态变了才写一条日志(它会出现在诊断报告的时间线里)。
     上一版只有「已启用」一条,页面上一个按钮都没有时无从判断:
     是没找到候选框,还是找到了全被判为不合格。 */
  var lastSummary = '';

  function summarize(q) {
    var mountedCount = 0;
    try { mountedCount = queryRoots('[' + BTN_ATTR + ']').length; } catch (e) { mountedCount = 0; }
    var s = '候选 ' + (q ? q.all.length : 0) + ' · 已挂 ' + mountedCount
      + (q ? ' · 识别' + q.tier : '');
    if (s === lastSummary) return;
    lastSummary = s;
    log('图片粘贴:' + s);
  }

  /** 候选有、但一个都没挂上:把第一张不合格的框长相报出来,便于下一轮校准 */
  function explainRejects(tiles) {
    for (var i = 0; i < tiles.length; i++) {
      var t = tiles[i];
      if (!t) continue;
      var wait = '';
      var shape = '';
      var hasInput = false;
      try { hasInput = !!inputForTile(t); } catch (e) { hasInput = false; }
      var st = null;
      try { st = window.getComputedStyle(t); } catch (e) { st = null; }
      var r = boxOf(t);
      shape = Math.round(r.width) + '×' + Math.round(r.height);

      if (!visible(t)) wait = '不可见';
      else if (inFloatingChrome(t)) wait = '不在表单容器内(浮层/克隆)';
      else if (hasImage(t)) wait = '已有图';
      else if (!hasInput && !hasUploadHint(t)) wait = '里面没有文件输入框';
      else if (r.width > 0 && (r.width < 56 || r.height < 56)) wait = '太小 ' + shape;
      else if (r.width > 0 && (r.width > 320 || r.height > 320)) wait = '太大 ' + shape;
      else if (r.width > 0 && (r.width / r.height < 0.5 || r.width / r.height > 2.2)) wait = '不是方块 ' + shape;
      else if (st && st.pointerEvents === 'none') wait = '不可点(pointer-events:none)';
      else if (st && parseFloat(st.opacity) < 0.6) wait = '半透明(opacity ' + st.opacity + ')';
      else wait = '未通过校验 ' + shape;

      var cls = (typeof t.className === 'string' ? t.className : '').trim().split(/\s+/).slice(0, 2).join('.');
      log('图片粘贴:不合格 ' + t.tagName.toLowerCase() + (cls ? '.' + cls : '') + ' · ' + wait);
      return;
    }
  }

  function boot() {
    if (on) {
      /* 观察器先建好:scan 抛错也不至于让后续变更无人处理(上一版就是这样静默死掉的) */
      refreshRoots();
      // attachShadow 不触发外层 DOM 变更；只检查微前端宿主，不轮询全部上传框。
      if (!rootTimer && location.hostname === 'store.weixin.qq.com') rootTimer = setInterval(function () {
        var href = location.href;
        var changed = refreshRoots();
        if (changed || href !== lastHref) { lastHref = href; scheduleScan(100); }
      }, 1200);
      /* 表单很长(内容高 4000~6000+),新框多半是滚动后才渲染出来的 */
      window.addEventListener('scroll', onScroll, true);

      var q = null;
      try {
        q = scan();
      } catch (e) {
        log('图片粘贴:首扫异常 ' + ((e && e.message) || e));
      }
      if (q && q.all.length && !queryRoots('[' + BTN_ATTR + ']').length) {
        explainRejects(q.all);
      }
    } else {
      if (observer) { observer.disconnect(); observer = null; }
      clearInterval(rootTimer); rootTimer = 0;
      clearTimeout(scanTimer); scanTimer = 0;
      clearTimeout(scrollTimer); scrollTimer = 0;
      window.removeEventListener('scroll', onScroll, true);
      unmountAll();
      queryRoots('style[' + SHADOW_STYLE + ']').forEach(function (style) { style.remove(); });
      roots = [document];
      lastSummary = '';
    }
  }

  function onScroll() {
    if (scrollTimer) return;
    scrollTimer = setTimeout(function () {
      scrollTimer = 0;
      scheduleScan(200);
    }, 300);
  }

  dycReadFlags().then(function (f) {
    on = !f || f.goodsImagePaste !== false;
    if (on) log('图片粘贴:已启用');
    boot();
  });

  dycWatchFlags(function (f) {
    var next = !f || f.goodsImagePaste !== false;
    if (next === on) return;
    on = next;
    log('图片粘贴:' + (on ? '已启用' : '已停用'));
    boot();
  });
})();
